import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  actionCatalogRequestSchema,
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionReplanRunCreateRequestSchema,
  companionReplanRunStatusRequestSchema,
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
  guideRevisionThreadHistoryRequestSchema,
  planningContextRequestSchema,
  planningContextSchema,
  plannerGenerateRequestSchema,
  plannerGenerationErrorSchema,
  plannerGenerationResultSchema,
  plannerProviderListSchema,
  plannerReplanGenerateRequestSchema,
  plannerReplanGenerationResultSchema,
  planningQualityBaselineVersion,
  planningQualityEvaluationRequestSchema,
  planningPromptRequestSchema,
  replanningPromptPacketSchema,
  replanningPromptRequestSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type GuidePlan,
  type GuideProposal,
  type PlanningIntent,
  type PlanningQualityReport,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { createActionCatalogRegistry } from './action-catalogs.js';
import {
  CompanionReplanRunRequestError,
  createCompanionReplanRunCoordinator,
  type CompanionReplanRunCoordinator,
} from './companion-replan-run.js';
import { createEvalExport, readExecutionEventLedger } from './eval-export.js';
import { computeGuidePlanDiff } from './guide-plan-diff.js';
import { localReplanCoverageStepIds } from './local-replan-scope.js';
import { createGuideRevisionThreadHistory } from './guide-revision-history.js';
import { deferMcpInputValidation } from './mcp-input-validation.js';
import { buildPlanningPromptPacket } from './planning-prompt.js';
import {
  createPlannerGenerationCoordinator,
  PlannerGenerationRuntimeError,
  plannerGenerationEvidenceEventTypes,
  plannerGenerationErrorResponse,
  plannerGenerationHttpStatus,
  restoreInitialPlannerProviderInvocations,
  type PlannerGenerationCoordinator,
} from './planner-generation.js';
import { evaluatePlanningQuality } from './planning-quality.js';
import { createPlannerProviderInvocationManager } from './planner-provider-invocation.js';
import { createPlannerProviderRegistry } from './planner-provider-registry.js';
import {
  createPlannerReplanGenerationCoordinator,
  plannerReplanGenerationEvidenceEventTypes,
  restoreReplanPlannerProviderInvocations,
  type PlannerReplanGenerationCoordinator,
} from './planner-replan-generation.js';
import { createReplanningService } from './replanning-service.js';
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
  plannerProviders?: readonly PlannerProvider[];
  plannerProviderTimeoutMs?: number;
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
  const plannerProviderRegistry = createPlannerProviderRegistry(options.plannerProviders ?? []);
  const database = openOperatingLineDatabase(options.databasePath);
  let app: ReturnType<typeof createMcpFastifyApp> | undefined;
  let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
  let plannerGenerationCoordinator: PlannerGenerationCoordinator | undefined;
  let plannerReplanGenerationCoordinator: PlannerReplanGenerationCoordinator | undefined;
  let companionReplanRunCoordinator: CompanionReplanRunCoordinator | undefined;
  const cleanupSteps: CleanupStep[] = [
    () => companionReplanRunCoordinator?.beginClose(),
    async () => {
      if (plannerGenerationCoordinator !== undefined) {
        await plannerGenerationCoordinator.close();
      } else {
        await plannerReplanGenerationCoordinator?.close();
      }
    },
    () => companionReplanRunCoordinator?.close(),
    () => plannerProviderRegistry.close(),
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
    const publishedPlans = database
      .listExecutionEventsByTypes(['guide.plan.published'])
      .map((event) =>
        guidePlanSchema.parse(
          event.payload !== null &&
            typeof event.payload === 'object' &&
            !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)['plan']
            : undefined,
        ),
      );
    let activePlan: GuidePlan | null = publishedPlans.at(-1) ?? null;
    const latestPublishedRevisionByPlanId = new Map<string, number>();
    for (const plan of publishedPlans) {
      latestPublishedRevisionByPlanId.set(
        plan.id,
        Math.max(latestPublishedRevisionByPlanId.get(plan.id) ?? 0, plan.revision),
      );
    }
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

    const getPlanningContext = (
      request: ReturnType<typeof planningContextRequestSchema.parse>,
      recordEvent = true,
    ) => {
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
        ...(catalog.planningPhases === undefined
          ? {}
          : {
              qualityGate: {
                toolName: 'operatingline.planning.evaluate',
                baselineVersion:
                  catalog.semanticCapabilities === undefined
                    ? '1.0.0'
                    : planningQualityBaselineVersion,
                requiredPhaseSelection: 'planner_declared_from_goal',
                description:
                  'Declare the goal-relevant planning phases, evaluate the complete candidate, and resolve every error before proposal submission.',
              },
            }),
      });
      if (recordEvent) {
        database.appendEvent({
          id: randomUUID(),
          eventType: 'planning.context.generated',
          payload: { request, context },
        });
      }
      return context;
    };

    const getPlanningPrompt = (
      request: ReturnType<typeof planningPromptRequestSchema.parse>,
      recordEvents = true,
    ) => {
      const context = getPlanningContext(
        planningContextRequestSchema.parse({
          targetAdapterId: request.targetAdapterId,
          ...(request.catalogVersion === undefined
            ? {}
            : { catalogVersion: request.catalogVersion }),
          goal: request.goal,
          planId: request.planId,
        }),
        recordEvents,
      );
      const packet = buildPlanningPromptPacket(context);
      if (recordEvents) {
        database.appendEvent({
          id: randomUUID(),
          eventType: 'planning.prompt.generated',
          payload: { request, packet },
        });
      }
      return packet;
    };

    const getEvalExport = (request: ReturnType<typeof evalExportRequestSchema.parse>) =>
      createEvalExport({
        request,
        availableCatalogs: actionCatalogRegistry.list(),
        events: readExecutionEventLedger(database),
        exportId: randomUUID(),
        exportedAt: new Date().toISOString(),
      });

    const getPlanningQuality = (
      request: ReturnType<typeof planningQualityEvaluationRequestSchema.parse>,
      selectedCatalog?: ActionCatalog,
    ): PlanningQualityReport => {
      const catalog =
        selectedCatalog ??
        actionCatalogRegistry.get({
          targetAdapterId: request.targetAdapterId,
          ...(request.catalogVersion === undefined
            ? {}
            : { catalogVersion: request.catalogVersion }),
        });
      const report = evaluatePlanningQuality(request, catalog);
      database.appendEvent({
        id: randomUUID(),
        eventType: 'planning.quality.evaluated',
        payload: {
          targetAdapterId: request.targetAdapterId,
          catalogVersion: catalog.catalogVersion,
          goal: request.goal ?? null,
          requiredPhaseIds: request.requiredPhaseIds,
          ...(request.capabilityCoverage === undefined
            ? {}
            : { capabilityCoverage: request.capabilityCoverage }),
          plan: request.plan,
          report,
        },
      });
      return report;
    };

    const existingPlannerGenerationEvents = database.listExecutionEventsByTypes(
      plannerGenerationEvidenceEventTypes,
    );
    const existingPlannerReplanEvents = database.listExecutionEventsByTypes(
      plannerReplanGenerationEvidenceEventTypes,
    );
    const plannerProviderInvocationManager = createPlannerProviderInvocationManager({
      registry: plannerProviderRegistry,
      ...(options.plannerProviderTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.plannerProviderTimeoutMs }),
      restoredInvocations: [
        ...restoreInitialPlannerProviderInvocations(existingPlannerGenerationEvents),
        ...restoreReplanPlannerProviderInvocations(existingPlannerReplanEvents),
      ],
    });
    plannerGenerationCoordinator = createPlannerGenerationCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingPlannerGenerationEvents,
      buildPacket: (request) => getPlanningPrompt(request, false),
      evaluateDraft: (packet, draft) =>
        evaluatePlanningQuality(
          planningQualityEvaluationRequestSchema.parse({
            targetAdapterId: draft.targetAdapterId,
            catalogVersion: draft.catalogVersion,
            goal: draft.planning.goal,
            requiredPhaseIds: draft.planning.requiredPhaseIds,
            ...(draft.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: draft.planning.capabilityCoverage }),
            plan: draft.plan,
          }),
          packet.context.catalog,
        ),
      appendEvent: (event) => database.appendEvent(event),
    });
    const createProposal = (input: {
      targetAdapterId: string;
      targetInstanceId?: string;
      catalogVersion?: string;
      plan: GuidePlan;
      replan?: {
        requestId: string;
        generationRequestId?: string;
        basePlan: GuidePlan;
        revisionThread: NonNullable<
          ReturnType<typeof guideRevisionRequestSchema.parse>['revisionThread']
        >;
      };
      planning?: PlanningIntent;
    }): { proposal: GuideProposal; planningQuality: PlanningQualityReport } => {
      validateProposalTarget(input.plan, input.targetAdapterId);
      const catalog = actionCatalogRegistry.get({
        targetAdapterId: input.targetAdapterId,
        ...(input.catalogVersion === undefined ? {} : { catalogVersion: input.catalogVersion }),
      });
      validateGuidePlanAgainstActionCatalog(input.plan, catalog);
      const planningQuality = getPlanningQuality(
        planningQualityEvaluationRequestSchema.parse({
          targetAdapterId: input.targetAdapterId,
          catalogVersion: catalog.catalogVersion,
          ...(input.planning === undefined
            ? {}
            : {
                goal: input.planning.goal,
                requiredPhaseIds: input.planning.requiredPhaseIds,
                ...(input.planning.capabilityCoverage === undefined
                  ? {}
                  : { capabilityCoverage: input.planning.capabilityCoverage }),
              }),
          plan: input.plan,
        }),
        catalog,
      );
      if (!planningQuality.valid) {
        const errors = planningQuality.findings
          .filter((finding) => finding.severity === 'error')
          .slice(0, 3)
          .map((finding) => `${finding.code}: ${finding.message}`)
          .join('; ');
        throw new Error(`Planning quality baseline failed: ${errors}`);
      }
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
        database.recordGuideReplanProposal(
          proposal,
          input.replan.requestId,
          input.replan.generationRequestId,
        );
      }
      latestProposedRevisionByPlanId.set(input.plan.id, input.plan.revision);
      return { proposal, planningQuality };
    };

    const proposalResult = (proposal: GuideProposal, planningQuality: PlanningQualityReport) => ({
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
      planningQuality,
    });

    const replanningService = createReplanningService({
      database,
      actionCatalogRegistry,
      listCompanionStates,
      resolveTargetRevision: (planId, baseRevision) =>
        Math.max(
          baseRevision,
          latestPublishedRevisionByPlanId.get(planId) ?? 0,
          latestProposedRevisionByPlanId.get(planId) ?? 0,
          activePlan?.id === planId ? activePlan.revision : 0,
        ) + 1,
      completedGeneration: (requestId) =>
        plannerReplanGenerationCoordinator?.completedResult(requestId) ?? null,
      createProposal,
    });
    plannerReplanGenerationCoordinator = createPlannerReplanGenerationCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingPlannerReplanEvents,
      buildPacket: (request) => replanningService.getPrompt(request, false),
      evaluateDraft: (packet, draft) =>
        evaluatePlanningQuality(
          planningQualityEvaluationRequestSchema.parse({
            targetAdapterId: packet.context.revisionRequest.adapterId,
            catalogVersion: draft.catalogVersion,
            goal: draft.planning.goal,
            requiredPhaseIds: draft.planning.requiredPhaseIds,
            ...(draft.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: draft.planning.capabilityCoverage }),
            plan: draft.plan,
          }),
          packet.context.catalog,
          {
            allowedCoverageStepIds: localReplanCoverageStepIds(
              packet.context.revisionRequest,
              draft.plan,
            ),
          },
        ),
      appendEvent: (event) => database.appendEvent(event),
    });
    companionReplanRunCoordinator = createCompanionReplanRunCoordinator({
      database,
      providerRegistry: plannerProviderRegistry,
      generationCoordinator: plannerReplanGenerationCoordinator,
      replanningService,
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
        'operatingline.planning.evaluate',
        {
          description:
            'Evaluate one complete candidate GuidePlan against the selected host planning phases, teachable hierarchy, semantic guidance, and logical resource dependencies. Returns deterministic findings, not a subjective model score.',
          inputSchema: planningQualityEvaluationRequestSchema,
        },
        async (requestInput) => {
          const request = planningQualityEvaluationRequestSchema.parse(requestInput);
          return {
            content: [{ type: 'text', text: JSON.stringify(getPlanningQuality(request)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.planning.prompt.get',
        {
          description:
            'Build a deterministic, versioned model prompt packet containing the exact host catalog, planning context, GuideProposal JSON contract, and evaluate-then-propose workflow. This does not call a model.',
          inputSchema: planningPromptRequestSchema,
        },
        async (requestInput) => {
          const request = planningPromptRequestSchema.parse(requestInput);
          return {
            content: [{ type: 'text', text: JSON.stringify(getPlanningPrompt(request)) }],
          };
        },
      );

      server.registerTool(
        'operatingline.planner.providers.list',
        {
          description:
            'List explicitly configured planner providers and their availability, concurrency, data-transmission, and credential-management disclosures. The list never contains credentials.',
          inputSchema: z.strictObject({}),
          outputSchema: plannerProviderListSchema,
        },
        async () => {
          const providerList = plannerProviderRegistry.list();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(providerList) }],
            structuredContent: providerList,
          };
        },
      );

      server.registerTool(
        'operatingline.planner.generate',
        {
          description:
            'Explicitly invoke one configured planner provider with a versioned Planner Packet. This may transmit task data or incur provider cost according to the provider disclosure. The result is validated but is not submitted as a GuideProposal and cannot execute in a host.',
          inputSchema: plannerGenerateRequestSchema,
          outputSchema: plannerGenerationResultSchema,
        },
        async (requestInput) => {
          const request = plannerGenerateRequestSchema.parse(requestInput);
          try {
            const result = await plannerGenerationCoordinator!.generate(request);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result),
                },
              ],
              structuredContent: result,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(plannerGenerationErrorResponse(error, request.requestId)),
                },
              ],
            };
          }
        },
      );

      server.registerPrompt(
        'operatingline.plan_and_propose',
        {
          title: 'Plan and propose an OperatingLine guide',
          description:
            'Generate a complete host-specific GuideProposal candidate from a natural-language goal, then validate and submit it through OperatingLine tools.',
          argsSchema: planningPromptRequestSchema,
        },
        async (requestInput) => {
          const request = planningPromptRequestSchema.parse(requestInput);
          const packet = getPlanningPrompt(request);
          return {
            description: `OperatingLine planning workflow for ${request.targetAdapterId}@${packet.context.catalog.catalogVersion}`,
            messages: [
              {
                role: 'user' as const,
                content: { type: 'text' as const, text: packet.renderedPrompt },
              },
            ],
          };
        },
      );

      server.registerTool(
        'operatingline.replan.providers.list',
        {
          description:
            'List configured planner providers that explicitly support typed local replanning. The list never contains credentials.',
          inputSchema: z.strictObject({}),
          outputSchema: plannerProviderListSchema,
        },
        async () => {
          const providerList = plannerProviderRegistry.listReplanners();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(providerList) }],
            structuredContent: providerList,
          };
        },
      );

      server.registerTool(
        'operatingline.replan.prompt.get',
        {
          description:
            'Build a deterministic typed local-replan packet from one pending immutable host request, its exact ActionCatalog, live instance state, and referenced-subtree scope. This does not call a model or create a Proposal.',
          inputSchema: replanningPromptRequestSchema,
          outputSchema: replanningPromptPacketSchema,
        },
        async (requestInput) => {
          const request = replanningPromptRequestSchema.parse(requestInput);
          try {
            const packet = replanningService.getPrompt(request);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(packet) }],
              structuredContent: packet,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(plannerGenerationErrorResponse(error, null)),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.replan.generate',
        {
          description:
            'Explicitly invoke a replan-capable Provider for one pending host revision request. The complete draft passes identity, locality, ActionCatalog, and quality gates but never creates or accepts a Proposal.',
          inputSchema: plannerReplanGenerateRequestSchema,
          outputSchema: plannerReplanGenerationResultSchema,
        },
        async (requestInput) => {
          const request = plannerReplanGenerateRequestSchema.parse(requestInput);
          try {
            const result = await plannerReplanGenerationCoordinator!.generate(request);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(plannerGenerationErrorResponse(error, request.requestId)),
                },
              ],
            };
          }
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
        'operatingline.replan.thread.get',
        {
          description:
            'Return a newest-page-first, vendor-neutral history of one linear revision thread, preserving exact user requests, proposals, Plan diffs, and in-host decisions.',
          inputSchema: guideRevisionThreadHistoryRequestSchema,
        },
        async (requestInput) => {
          const request = guideRevisionThreadHistoryRequestSchema.parse(requestInput);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(createGuideRevisionThreadHistory(database, request)),
              },
            ],
          };
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
          inputSchema: deferMcpInputValidation(guideReplanSubmissionSchema),
        },
        async (submissionInput) => {
          const parsedSubmission = guideReplanSubmissionSchema.safeParse(submissionInput);
          if (!parsedSubmission.success) {
            const error = new PlannerGenerationRuntimeError(
              'planner_invalid_request',
              'Replan proposal submission violates the strict protocol contract',
              'never',
            );
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(plannerGenerationErrorResponse(error, null)),
                },
              ],
            };
          }
          const submission = parsedSubmission.data;
          try {
            const result = replanningService.propose(submission);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result),
                },
              ],
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    plannerGenerationErrorResponse(error, submission.generationRequestId ?? null),
                  ),
                },
              ],
            };
          }
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
          const { proposal, planningQuality } = createProposal({
            targetAdapterId: submission.targetAdapterId,
            plan: submission.plan,
            ...(submission.catalogVersion === undefined
              ? {}
              : { catalogVersion: submission.catalogVersion }),
            ...(submission.planning === undefined ? {} : { planning: submission.planning }),
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(proposalResult(proposal, planningQuality)),
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
    runtimeApp.post('/api/v1/planning/evaluate', async (request, reply) => {
      const parsedRequest = planningQualityEvaluationRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return getPlanningQuality(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'planning_quality_unavailable',
          message: error instanceof Error ? error.message : 'Unknown planning quality error',
        });
      }
    });
    runtimeApp.post('/api/v1/planning/prompt', async (request, reply) => {
      const parsedRequest = planningPromptRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return getPlanningPrompt(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'planning_prompt_unavailable',
          message: error instanceof Error ? error.message : 'Unknown planning prompt error',
        });
      }
    });
    runtimeApp.get('/api/v1/planner/providers', async () => plannerProviderRegistry.list());
    runtimeApp.post('/api/v1/planner/generate', async (request, reply) => {
      const parsedRequest = plannerGenerateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        const requestIdInput =
          request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)['requestId']
            : null;
        const parsedRequestId = z.uuid().safeParse(requestIdInput);
        return reply.code(400).send(
          plannerGenerationErrorSchema.parse({
            error: 'planner_invalid_request',
            requestId: parsedRequestId.success ? parsedRequestId.data : null,
            message: 'Planner generation request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return await plannerGenerationCoordinator!.generate(parsedRequest.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
      }
    });
    runtimeApp.get('/api/v1/replan/providers', async () =>
      plannerProviderRegistry.listReplanners(),
    );
    runtimeApp.post('/api/v1/replan/prompt', async (request, reply) => {
      const parsedRequest = replanningPromptRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send(
          plannerGenerationErrorSchema.parse({
            error: 'planner_invalid_request',
            requestId: null,
            message: 'Planner replan prompt request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return replanningService.getPrompt(parsedRequest.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, null));
      }
    });
    runtimeApp.post('/api/v1/replan/generate', async (request, reply) => {
      const parsedRequest = plannerReplanGenerateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        const requestIdInput =
          request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)['requestId']
            : null;
        const parsedRequestId = z.uuid().safeParse(requestIdInput);
        return reply.code(400).send(
          plannerGenerationErrorSchema.parse({
            error: 'planner_invalid_request',
            requestId: parsedRequestId.success ? parsedRequestId.data : null,
            message: 'Planner replan generation request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return await plannerReplanGenerationCoordinator!.generate(parsedRequest.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
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
    runtimeApp.get('/api/v1/replan/thread', async (request, reply) => {
      const parsedRequest = guideRevisionThreadHistoryRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return createGuideRevisionThreadHistory(database, parsedRequest.data);
      } catch (error) {
        return reply.code(404).send({
          error: 'revision_thread_not_found',
          message: error instanceof Error ? error.message : 'Unknown revision history error',
        });
      }
    });
    runtimeApp.post('/api/v1/replan/propose', async (request, reply) => {
      const parsedSubmission = guideReplanSubmissionSchema.safeParse(request.body);
      if (!parsedSubmission.success) {
        const error = new PlannerGenerationRuntimeError(
          'planner_invalid_request',
          'Replan proposal submission violates the strict protocol contract',
          'never',
        );
        return reply.code(400).send(plannerGenerationErrorResponse(error, null));
      }
      try {
        return replanningService.propose(parsedSubmission.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(
            plannerGenerationErrorResponse(
              error,
              parsedSubmission.data.generationRequestId ?? null,
            ),
          );
      }
    });
    runtimeApp.post('/api/v1/companion/replan-run', async (request, reply) => {
      const parsedRequest = companionReplanRunCreateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion replan run authorization violates the strict public contract',
        });
      }
      try {
        const run = companionReplanRunCoordinator!.create(parsedRequest.data);
        return reply.code(202).send(run);
      } catch (error) {
        if (error instanceof CompanionReplanRunRequestError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        return reply.code(500).send({
          error: 'replan_run_failed',
          message: 'The replan run could not be safely authorized',
        });
      }
    });
    runtimeApp.get('/api/v1/companion/replan-run', async (request, reply) => {
      const parsedRequest = companionReplanRunStatusRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion replan run status request violates the strict public contract',
        });
      }
      try {
        const run = companionReplanRunCoordinator!.get(parsedRequest.data.generationRequestId);
        return run === null
          ? reply.code(404).send({
              error: 'replan_run_not_found',
              message: 'The requested companion replan run was not found',
            })
          : run;
      } catch {
        return reply.code(500).send({
          error: 'replan_run_unavailable',
          message: 'The replan run status could not be read safely',
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
          const rawParentDecision =
            parentProposal === null
              ? null
              : database.getGuideProposalDecision(
                  parentProposal.proposalId,
                  parsedRequest.data.adapterId,
                  parsedRequest.data.instanceId,
                );
          const parentDecision =
            rawParentDecision === null
              ? null
              : guideProposalDecisionSchema.parse(rawParentDecision);
          validateGuideRevisionThread(parsedRequest.data, head, parentProposal, parentDecision);
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
        plannerProviders: plannerProviderRegistry.list().providers.map((provider) => ({
          id: provider.id,
          version: provider.version,
          available: provider.availability.available,
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
export { createGuideRevisionThreadHistory } from './guide-revision-history.js';
export {
  createLocalReplanScope,
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
  normalizeLocalReplanRoots,
} from './local-replan-scope.js';
export { buildPlanningPromptPacket } from './planning-prompt.js';
export {
  createPlannerGenerationCoordinator,
  PlannerGenerationRuntimeError,
  plannerGenerationEvidenceEventTypes,
  plannerGenerationErrorResponse,
  plannerGenerationHttpStatus,
  restoreInitialPlannerProviderInvocations,
} from './planner-generation.js';
export { evaluatePlanningQuality } from './planning-quality.js';
export { createPlannerProviderRegistry } from './planner-provider-registry.js';
export {
  createPlannerReplanGenerationCoordinator,
  plannerReplanGenerationEvidenceEventTypes,
  restoreReplanPlannerProviderInvocations,
} from './planner-replan-generation.js';
export { buildReplanningPromptPacket } from './replanning-prompt.js';
