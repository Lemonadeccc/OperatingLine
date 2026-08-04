import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionStateReportSchema,
  guidePlanSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
  guideProtocolVersion,
  type CompanionStateReport,
  type GuidePlan,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { validateGuidePlanStructure, validateProposalTarget } from './guide-validation.js';
import { closeAll, throwAfterCleanup, type CleanupStep } from './lifecycle.js';

export interface StartRuntimeOptions {
  databasePath: string;
  accessToken: string;
  adapters?: readonly AppAdapter[];
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

  const adapterStatuses = await Promise.all(
    (options.adapters ?? []).map((adapter) => adapter.getStatus()),
  );
  const adapters = adapterStatuses.map((adapter) => adapterStatusSchema.parse(adapter));
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  if (adapterIds.size !== adapters.length) {
    throw new Error('OperatingLine adapter ids must be unique');
  }
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
              planId: plan.id,
              revision: plan.revision,
              protocolVersion: plan.protocolVersion,
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
          validateProposalTarget(submission.plan, submission.targetAdapterId);
          const latestRevision = latestProposedRevisionByPlanId.get(submission.plan.id);
          if (latestRevision !== undefined && submission.plan.revision <= latestRevision) {
            throw new Error(
              `Guide plan ${submission.plan.id} revision ${submission.plan.revision} is not newer than latest proposed revision ${latestRevision}`,
            );
          }
          const proposal = guideProposalSchema.parse({
            protocolVersion: guideProtocolVersion,
            proposalId: randomUUID(),
            targetAdapterId: submission.targetAdapterId,
            plan: submission.plan,
            proposedAt: new Date().toISOString(),
          });
          database.recordGuideProposal(proposal);
          latestProposedRevisionByPlanId.set(submission.plan.id, submission.plan.revision);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  proposed: true,
                  proposalId: proposal.proposalId,
                  targetAdapterId: proposal.targetAdapterId,
                  planId: proposal.plan.id,
                  revision: proposal.plan.revision,
                }),
              },
            ],
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
