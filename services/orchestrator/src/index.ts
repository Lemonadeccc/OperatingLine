import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  actionCatalogRequestSchema,
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionStateReportSchema,
  evalExportRequestSchema,
  guidePlanSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
  guideProtocolVersion,
  guideReplanSubmissionSchema,
  guideRevisionRequestListSchema,
  guideRevisionRequestSchema,
  planningContextRequestSchema,
  planningContextSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type GuidePlan,
  type GuideProposal,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { createActionCatalogRegistry } from './action-catalogs.js';
import { createEvalExport, readExecutionEventLedger } from './eval-export.js';
import { computeGuidePlanDiff } from './guide-plan-diff.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuideRevisionRequest,
  validateGuideRevisionThread,
  validateGuidePlanStructure,
  validateProposalTarget,
} from './guide-validation.js';
import { closeAll, throwAfterCleanup, type CleanupStep } from './lifecycle.js';

export interface StartRuntimeOptions {
  databasePath: string;
  accessToken: string;
  adapters?: readonly AppAdapter[];
  actionCatalogs?: readonly ActionCatalog[];
  port?: number;
}

export interface RunningRuntime {
  readonly baseUrl: string;
  readonly mcpEndpoint: string;
  getStatus(): RuntimeStatus;
  stop(): Promise<void>;
}

export const runtimeVersion = '0.1.0';

export async function startRuntime(options: StartRuntimeOptions): Promise<RunningRuntime> {
  if (options.accessToken.length < 16) {
    throw new Error('OperatingLine access token must contain at least 16 characters');
  }
  if (options.databasePath.trim().length === 0) {
    throw new Error('OperatingLine database path must not be empty');
  }
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('OperatingLine port must be an integer between 0 and 65535');
  }

  const configuredAdapters = options.adapters ?? [];
  const [adapterStatuses, adapterCatalogs] = await Promise.all([
    Promise.all(configuredAdapters.map((adapter) => adapter.getStatus())),
    Promise.all(
      configuredAdapters.map((adapter) =>
        adapter.getActionCatalog === undefined ? null : adapter.getActionCatalog(),
      ),
    ),
  ]);
  const adapters = adapterStatuses.map((adapter) => adapterStatusSchema.parse(adapter));
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  if (adapterIds.size !== adapters.length) {
    throw new Error('OperatingLine adapter ids must be unique');
  }
  const actionCatalogRegistry = createActionCatalogRegistry([
    ...(options.actionCatalogs ?? []),
    ...adapterCatalogs.filter((catalog): catalog is ActionCatalog => catalog !== null),
  ]);
  const database = openOperatingLineDatabase(options.databasePath);
  let app: ReturnType<typeof createMcpFastifyApp> | undefined;
  let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
  const cleanupSteps: CleanupStep[] = [
    () => app?.close(),
    () => mcpHandler?.close(),
    () => database.close(),
  ];

  try {
    let status: RuntimeStatus = {
      version: runtimeVersion,
      phase: 'starting',
      database: 'ready',
      adapters,
      mcpEndpoint: null,
    };
    let activePlan: GuidePlan | null = null;
    const latestPublishedRevisionByPlanId = new Map<string, number>();
    const latestProposedRevisionByPlanId = new Map(
      database
        .listLatestGuidePlanRevisions()
        .map(({ planId, revision }) => [planId, revision] as const),
    );

    const getStatus = (): RuntimeStatus => ({
      ...status,
      adapters: status.adapters.map((adapter) => ({
        ...adapter,
        protocolVersions: [...adapter.protocolVersions],
        capabilities: {
          presentation: { ...adapter.capabilities.presentation },
          execution: {
            ...adapter.capabilities.execution,
            rollbackModes: [...adapter.capabilities.execution.rollbackModes],
          },
          runtime: { ...adapter.capabilities.runtime },
        },
      })),
    });

    const listCompanionStates = (): CompanionStateReport[] =>
      database
        .listLatestCompanionStates()
        .map((report) => companionStateReportSchema.parse(report));

    const getPlanningContext = (request: ReturnType<typeof planningContextRequestSchema.parse>) => {
      const catalog = actionCatalogRegistry.get(request);
      const latestRevision =
        request.planId === undefined
          ? null
          : Math.max(
              latestPublishedRevisionByPlanId.get(request.planId) ?? 0,
              latestProposedRevisionByPlanId.get(request.planId) ?? 0,
              activePlan?.id === request.planId ? activePlan.revision : 0,
            );
      const context = planningContextSchema.parse({
        protocolVersion: guideProtocolVersion,
        targetAdapterId: request.targetAdapterId,
        goal: request.goal ?? null,
        requestedPlanId: request.planId ?? null,
        recommendedRevision: latestRevision === null ? null : latestRevision + 1,
        catalog,
        companionStates: listCompanionStates().filter(
          (state) => state.adapterId === request.targetAdapterId,
        ),
        constraints: {
          singleAdapterPlan: true,
          executableActionsMustBeLeaves: true,
          dependenciesMustReferenceExecutableActions: true,
          unknownActionsMustBeRejected: true,
          semanticAnchorsOnly: true,
          immutablePlanRevisions: true,
          humanApprovalRequired: true,
          executionOrder: 'dependsOn_topology_then_order_then_id',
        },
        submission: {
          toolName: 'operatingline.guide.propose',
          targetAdapterId: request.targetAdapterId,
          description:
            'Submit one complete GuidePlan revision for in-host preview and explicit human acceptance.',
        },
      });
      database.appendEvent({
        id: randomUUID(),
        eventType: 'planning.context.generated',
        payload: { request, context },
      });
      return context;
    };

    const getEvalExport = (request: ReturnType<typeof evalExportRequestSchema.parse>) =>
      createEvalExport({
        request,
        availableCatalogs: actionCatalogRegistry.list(),
        events: readExecutionEventLedger(database),
        exportId: randomUUID(),
        exportedAt: new Date().toISOString(),
      });

    const createProposal = (input: {
      targetAdapterId: string;
      targetInstanceId?: string;
      catalogVersion?: string;
      plan: GuidePlan;
      replan?: {
        requestId: string;
        basePlan: GuidePlan;
        revisionThread: NonNullable<
          ReturnType<typeof guideRevisionRequestSchema.parse>['revisionThread']
        >;
      };
    }): GuideProposal => {
      validateProposalTarget(input.plan, input.targetAdapterId);
      const catalog = actionCatalogRegistry.get({
        targetAdapterId: input.targetAdapterId,
        ...(input.catalogVersion === undefined ? {} : { catalogVersion: input.catalogVersion }),
      });
      validateGuidePlanAgainstActionCatalog(input.plan, catalog);
      const latestRevision = latestProposedRevisionByPlanId.get(input.plan.id);
      if (latestRevision !== undefined && input.plan.revision <= latestRevision) {
        throw new Error(
          `Guide plan ${input.plan.id} revision ${input.plan.revision} is not newer than latest proposed revision ${latestRevision}`,
        );
      }
      const proposal = guideProposalSchema.parse({
        protocolVersion: guideProtocolVersion,
        proposalId: randomUUID(),
        targetAdapterId: input.targetAdapterId,
        ...(input.targetInstanceId === undefined
          ? {}
          : { targetInstanceId: input.targetInstanceId }),
        plan: input.plan,
        ...(input.replan === undefined
          ? {}
          : {
              revisionRequestId: input.replan.requestId,
              revisionThread: input.replan.revisionThread,
            }),
        planDiff:
          input.replan === undefined
            ? null
            : computeGuidePlanDiff(input.replan.basePlan, input.plan),
        catalogVersion: catalog.catalogVersion,
        proposedAt: new Date().toISOString(),
      });
      if (input.replan === undefined) {
        database.recordGuideProposal(proposal);
      } else {
        database.recordGuideReplanProposal(proposal, input.replan.requestId);
      }
      latestProposedRevisionByPlanId.set(input.plan.id, input.plan.revision);
      return proposal;
    };

    const proposalResult = (proposal: GuideProposal) => ({
      proposed: true,
      proposalId: proposal.proposalId,
      targetAdapterId: proposal.targetAdapterId,
      targetInstanceId: proposal.targetInstanceId ?? null,
      planId: proposal.plan.id,
      revision: proposal.plan.revision,
      catalogVersion: proposal.catalogVersion,
      revisionRequestId: proposal.revisionRequestId ?? null,
      revisionThread: proposal.revisionThread ?? null,
      planDiff: proposal.planDiff ?? null,
    });

    const runtimeMcpHandler = createMcpHandler(() => {
      const server = new McpServer({ name: 'operating-line', version: runtimeVersion });

      server.registerTool(
        'operatingline.health',
        {
          description:
            'Return the health of the OperatingLine orchestrator and connected adapters.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(getStatus()) }],
        }),
      );

      server.registerTool(
        'operatingline.adapters.list',
        {
          description: 'List connected host adapters and their reported capabilities.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(getStatus().adapters) }],
        }),
      );

      server.registerTool(
        'operatingline.companions.list',
        {
          description: 'List the latest known state reported by each host companion.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(listCompanionStates()) }],
        }),
      );

      server.registerTool(
        'operatingline.action_catalog.get',
        {
          description:
            'Return the selected version of the real allowlisted action catalog for a target host. Call this before authoring executable guide actions.',
          inputSchema: actionCatalogRequestSchema,
        },
        async (requestInput) => {
          const request = actionCatalogRequestSchema.parse(requestInput);
          return {
            content: [{ type: 'text', text: JSON.stringify(actionCatalogRegistry.get(request)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.planning.context',
        {
          description:
            'Return a vendor-neutral planning context containing the real host action catalog, live companion state, immutable revision hint, and GuidePlan constraints.',
          inputSchema: planningContextRequestSchema,
        },
        async (requestInput) => {
          const request = planningContextRequestSchema.parse(requestInput);
          return {
            content: [{ type: 'text', text: JSON.stringify(getPlanningContext(request)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.replan.requests.list',
        {
          description:
            'List pending immutable host-authored revision requests, including their exact base GuidePlan and stable node references.',
          inputSchema: guideRevisionRequestListSchema,
        },
        async (requestInput) => {
          const request = guideRevisionRequestListSchema.parse(requestInput);
          const requests = database
            .listPendingGuideRevisionRequests(request.targetAdapterId, request.limit)
            .map((item) => guideRevisionRequestSchema.parse(item));
          return { content: [{ type: 'text', text: JSON.stringify({ requests }) }] };
        },
      );

      server.registerTool(
        'operatingline.eval.export',
        {
          description:
            'Export a versioned, paginated evidence bundle for one plan and host, including exact action catalogs, proposals, human decisions, step observations, and rollback reports. No quality score is inferred.',
          inputSchema: evalExportRequestSchema,
        },
        async (requestInput) => {
          const request = evalExportRequestSchema.parse(requestInput);
          return {
            content: [{ type: 'text', text: JSON.stringify(getEvalExport(request)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.replan.propose',
        {
          description:
            'Attach one complete newer GuidePlan proposal to a pending revision request. This never patches or executes the base plan and still requires in-host acceptance.',
          inputSchema: guideReplanSubmissionSchema,
        },
        async (submissionInput) => {
          const submission = guideReplanSubmissionSchema.parse(submissionInput);
          const storedRequest = database.getGuideRevisionRequest(submission.requestId);
          if (storedRequest === null) {
            throw new Error(`Unknown guide revision request: ${submission.requestId}`);
          }
          const revisionRequest = guideRevisionRequestSchema.parse(storedRequest);
          if (submission.plan.id !== revisionRequest.basePlan.id) {
            throw new Error(
              `Replanned guide id ${submission.plan.id} must match base plan ${revisionRequest.basePlan.id}`,
            );
          }
          if (submission.plan.revision <= revisionRequest.basePlan.revision) {
            throw new Error(
              `Replanned guide revision ${submission.plan.revision} must be newer than base revision ${revisionRequest.basePlan.revision}`,
            );
          }
          if (submission.catalogVersion !== revisionRequest.catalogVersion) {
            throw new Error(
              `Replan catalog ${submission.catalogVersion} must match revision request catalog ${revisionRequest.catalogVersion}`,
            );
          }
          if (revisionRequest.revisionThread === undefined) {
            throw new Error(
              `Guide revision request ${revisionRequest.requestId} uses legacy protocol without a revision thread`,
            );
          }
          const proposal = createProposal({
            targetAdapterId: revisionRequest.adapterId,
            targetInstanceId: revisionRequest.instanceId,
            catalogVersion: submission.catalogVersion,
            plan: submission.plan,
            replan: {
              requestId: revisionRequest.requestId,
              basePlan: revisionRequest.basePlan,
              revisionThread: revisionRequest.revisionThread,
            },
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(proposalResult(proposal)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.guide.publish',
        {
          description: 'Validate and publish a versioned guide plan for host companions.',
          inputSchema: guidePlanSchema,
        },
        async (planInput) => {
          const plan = guidePlanSchema.parse(planInput);
          validateGuidePlanStructure(plan);
          const latestRevision = latestPublishedRevisionByPlanId.get(plan.id);
          if (latestRevision !== undefined && plan.revision <= latestRevision) {
            throw new Error(
              `Guide plan ${plan.id} revision ${plan.revision} is not newer than latest accepted revision ${latestRevision}`,
            );
          }
          database.appendEvent({
            id: randomUUID(),
            eventType: 'guide.plan.published',
            payload: {
              targetAdapterId:
                plan.steps.find((step) => step.action !== null)?.action?.adapterId ?? null,
              plan,
            },
          });
          activePlan = plan;
          latestPublishedRevisionByPlanId.set(plan.id, plan.revision);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ accepted: true, planId: plan.id, revision: plan.revision }),
              },
            ],
          };
        },
      );

      server.registerTool(
        'operatingline.guide.propose',
        {
          description:
            'Validate and submit an AI-authored guide plan for in-host human review. The proposal cannot execute until the target companion accepts it.',
          inputSchema: guideProposalSubmissionSchema,
        },
        async (submissionInput) => {
          const submission = guideProposalSubmissionSchema.parse(submissionInput);
          const proposal = createProposal({
            targetAdapterId: submission.targetAdapterId,
            plan: submission.plan,
            ...(submission.catalogVersion === undefined
              ? {}
              : { catalogVersion: submission.catalogVersion }),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(proposalResult(proposal)) }],
          };
        },
      );

      return server;
    });
    mcpHandler = runtimeMcpHandler;

    const runtimeApp = createMcpFastifyApp();
    app = runtimeApp;
    const nodeHandler = toNodeHandler(runtimeMcpHandler);

    runtimeApp.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/mcp') && !request.url.startsWith('/api/')) {
        return;
      }

      if (request.headers.authorization !== `Bearer ${options.accessToken}`) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    runtimeApp.get('/health', async () => getStatus());
    runtimeApp.get('/api/v1/guide', async () => ({ plan: activePlan }));
    runtimeApp.get('/api/v1/action-catalog', async (request, reply) => {
      const parsedRequest = actionCatalogRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return actionCatalogRegistry.get(parsedRequest.data);
      } catch (error) {
        return reply.code(404).send({
          error: 'catalog_not_found',
          message: error instanceof Error ? error.message : 'Unknown action catalog error',
        });
      }
    });
    runtimeApp.get('/api/v1/planning/context', async (request, reply) => {
      const parsedRequest = planningContextRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return getPlanningContext(parsedRequest.data);
      } catch (error) {
        return reply.code(404).send({
          error: 'planning_context_unavailable',
          message: error instanceof Error ? error.message : 'Unknown planning context error',
        });
      }
    });
    runtimeApp.get('/api/v1/eval/export', async (request, reply) => {
      const parsedRequest = evalExportRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return getEvalExport(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'eval_export_unavailable',
          message: error instanceof Error ? error.message : 'Unknown eval export error',
        });
      }
    });
    runtimeApp.get('/api/v1/companion/guide', async (request, reply) => {
      const parsedRequest = companionGuideRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }

      const { adapterId, instanceId, knownPlanId, knownRevision, knownProposalId } =
        parsedRequest.data;
      const planAdapterId = activePlan?.steps.find((step) => step.action !== null)?.action
        ?.adapterId;
      const callerHasActiveRevision =
        activePlan !== null &&
        knownPlanId === activePlan.id &&
        knownRevision !== undefined &&
        knownRevision >= activePlan.revision;
      const storedProposal = database.getPendingGuideProposal(adapterId, instanceId);
      const pendingProposal =
        storedProposal === null ? null : guideProposalSchema.parse(storedProposal);
      const callerHasPendingProposal = pendingProposal?.proposalId === knownProposalId;
      return companionGuideDeliverySchema.parse({
        protocolVersion: guideProtocolVersion,
        plan: planAdapterId === adapterId && !callerHasActiveRevision ? activePlan : null,
        proposal: callerHasPendingProposal ? null : pendingProposal,
      });
    });
    runtimeApp.post('/api/v1/companion/revision-request', async (request, reply) => {
      const parsedRequest = guideRevisionRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_revision_request', issues: parsedRequest.error.issues });
      }
      try {
        validateGuideRevisionRequest(
          parsedRequest.data,
          actionCatalogRegistry.get({
            targetAdapterId: parsedRequest.data.adapterId,
            catalogVersion: parsedRequest.data.catalogVersion,
          }),
        );
        if (database.getGuideRevisionRequest(parsedRequest.data.requestId) === null) {
          const thread = parsedRequest.data.revisionThread;
          const rawHead =
            thread === undefined ? null : database.getGuideRevisionThreadHead(thread.threadId);
          const head = rawHead === null ? null : guideRevisionRequestSchema.parse(rawHead);
          const parentProposalId = thread?.parentRequestId;
          const rawParentProposal =
            parentProposalId == null
              ? null
              : database.getGuideReplanProposalForRequest(parentProposalId);
          const parentProposal =
            rawParentProposal === null ? null : guideProposalSchema.parse(rawParentProposal);
          validateGuideRevisionThread(parsedRequest.data, head, parentProposal);
        }
      } catch (error) {
        return reply.code(422).send({
          error: 'invalid_revision_request',
          message: error instanceof Error ? error.message : 'Unknown revision request error',
        });
      }
      const result = database.recordGuideRevisionRequest(parsedRequest.data);
      if (result === 'conflict') {
        return reply.code(409).send({ result });
      }
      return { result, requestId: parsedRequest.data.requestId };
    });
    runtimeApp.post('/api/v1/companion/proposal-decision', async (request, reply) => {
      const parsedDecision = guideProposalDecisionSchema.safeParse(request.body);
      if (!parsedDecision.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_decision', issues: parsedDecision.error.issues });
      }
      const result = database.recordGuideProposalDecision(parsedDecision.data);
      if (result === 'unknown') {
        return reply.code(404).send({ result });
      }
      if (result === 'conflict') {
        return reply.code(409).send({ result });
      }
      return { result };
    });
    runtimeApp.post('/api/v1/companion/state', async (request, reply) => {
      const parsedReport = companionStateReportSchema.safeParse(request.body);
      if (!parsedReport.success) {
        return reply.code(400).send({ error: 'invalid_report', issues: parsedReport.error.issues });
      }
      const result = database.recordCompanionState(parsedReport.data);
      if (result === 'conflict') {
        return reply.code(409).send({ result });
      }
      return { result };
    });
    runtimeApp.get('/api/v1/companions', async () => ({ companions: listCompanionStates() }));
    runtimeApp.all('/mcp', async (request, reply) => {
      reply.hijack();
      await nodeHandler(request.raw as unknown as NodeIncomingMessageLike, reply.raw, request.body);
    });

    await runtimeApp.listen({ host: '127.0.0.1', port });
    const address = runtimeApp.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const mcpEndpoint = `${baseUrl}/mcp`;

    status = {
      ...status,
      phase: 'ready',
      mcpEndpoint,
    };

    database.appendEvent({
      id: randomUUID(),
      eventType: 'runtime.started',
      payload: {
        adapters: adapters.map((adapter) => ({ id: adapter.id, version: adapter.version })),
        actionCatalogs: actionCatalogRegistry.list().map((catalog) => ({
          adapterId: catalog.adapterId,
          catalogVersion: catalog.catalogVersion,
        })),
        mcpEndpoint,
      },
    });

    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopPromise ??= (async () => {
        status = { ...status, phase: 'stopped' };
        try {
          database.appendEvent({
            id: randomUUID(),
            eventType: 'runtime.stopped',
            payload: {},
          });
        } catch (error) {
          return throwAfterCleanup(error, cleanupSteps);
        }
        await closeAll(cleanupSteps);
      })();
      return stopPromise;
    };

    return { baseUrl, mcpEndpoint, getStatus, stop };
  } catch (error) {
    return throwAfterCleanup(error, cleanupSteps);
  }
}

export { createActionCatalogRegistry };
export { canonicalizeEvalContent, computeEvalContentSha256 } from './eval-export.js';
export { computeGuidePlanDiff } from './guide-plan-diff.js';
