import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import {
  openOperatingLineDatabase,
  type StoredProcedureOperationIndex as DatabaseStoredProcedureOperationIndex,
  type StoredProcedureTreeRecord as DatabaseStoredProcedureTreeRecord,
  type StoredProcedureTreeSummary as DatabaseStoredProcedureTreeSummary,
} from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  actionCatalogRequestSchema,
  adapterStatusSchema,
  companionDialogueRunCreateRequestSchema,
  companionDialogueRunStatusRequestSchema,
  companionHeartbeatRequestSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionInitialPlanRunCreateRequestSchema,
  companionInitialPlanRunStatusRequestSchema,
  companionReplanRunCreateRequestSchema,
  companionReplanRunStatusRequestSchema,
  companionSessionHelloRequestSchema,
  companionStateReportSchema,
  evalExportRequestSchema,
  guideGoalPromptRequestSchema,
  guideGoalRequestAcknowledgementSchema,
  guideGoalRequestListSchema,
  guideGoalRequestSchema,
  guidePlanSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
  guideProtocolVersion,
  guideReplanSubmissionSchema,
  guideRevisionRequestListSchema,
  guideRevisionRequestSchema,
  guideRevisionBranchListRequestSchema,
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
  canonicalizeProtocolJsonValue,
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringGenerateRequestSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
  procedureTutorialTranscriptGenerateRequestSchema,
  procedureTutorialTranscriptImportRequestSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
  procedureTutorialYoutubeTrackRecommendationResultSchema,
  procedureAuthoringValidationRequestSchema,
  procedureAuthoringValidationResultSchema,
  procedureOperationSearchHitSchema,
  procedureOperationSearchRequestSchema,
  procedureOperationSearchResultSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayCurrentStateRequestSchema,
  procedureLeafReplayCurrentStateRequestResultSchema,
  procedureLeafReplayCurrentStateStatusRequestSchema,
  procedureLeafReplayCurrentStateStatusResultSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  procedureLeafReplayFailureRecoveryFinalizeRequestSchema,
  procedureLeafReplayFailureRecoveryFinalizeResultSchema,
  procedureLeafReplayFinalizeRequestSchema,
  procedureLeafReplayFinalizeResultSchema,
  procedureLeafReplayProposalRequestSchema,
  procedureLeafReplayProposalResultSchema,
  procedureCompilationRequestSchema,
  procedureCompilationResultSchema,
  procedureTreeGetRequestSchema,
  procedureTreeListRequestSchema,
  procedureTreeListResultSchema,
  procedureTreeStoreRequestSchema,
  procedureTreeStoreResultSchema,
  procedureTreeSummarySchema,
  protocolJsonValueCanonicalization,
  storedProcedureTreeSchema,
  compileProcedureTreeToGuidePlan,
  parseProcedureTree,
  replanningPromptPacketSchema,
  replanningPromptRequestSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type GuidePlan,
  type GuideGoalRequest,
  type GuideProposal,
  type InteractionCatalog,
  type PlanningIntent,
  type PlanningQualityReport,
  type ProcedureLeafReplayBinding,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { createActionCatalogRegistry } from './action-catalogs.js';
import {
  CompanionDialogueRunRequestError,
  createCompanionDialogueRunCoordinator,
  type CompanionDialogueRunCoordinator,
} from './companion-dialogue-run.js';
import {
  CompanionInitialPlanRunRequestError,
  createCompanionInitialPlanRunCoordinator,
  type CompanionInitialPlanRunCoordinator,
} from './companion-initial-plan-run.js';
import {
  CompanionReplanRunRequestError,
  createCompanionReplanRunCoordinator,
  type CompanionReplanRunCoordinator,
} from './companion-replan-run.js';
import {
  CompanionLeaseError,
  createCompanionLeaseManager,
  type CompanionLeaseManagerOptions,
} from './companion-leases.js';
import { operatingLineMcpInstructions } from './mcp-instructions.js';
import {
  computePlanContentSha256,
  createEvalExport,
  readExecutionEventLedger,
} from './eval-export.js';
import { computeGuidePlanDiff } from './guide-plan-diff.js';
import { createGuideRevisionRequestService } from './guide-revision-requests.js';
import { localReplanCoverageStepIds } from './local-replan-scope.js';
import { createGuideRevisionThreadHistory } from './guide-revision-history.js';
import { createGuideRevisionBranchList } from './guide-revision-branches.js';
import { deferMcpInputValidation } from './mcp-input-validation.js';
import { createInteractionCatalogRegistry } from './interaction-catalogs.js';
import { buildPlanningPromptPacket } from './planning-prompt.js';
import { materializeProcedureAuthoringCandidate } from './procedure-authoring-materialization.js';
import {
  createProcedureAuthoringGenerationCoordinator,
  procedureAuthoringGenerationEvidenceEventTypes,
  restoreProcedureAuthoringProviderInvocations,
  type ProcedureAuthoringGenerationCoordinator,
} from './procedure-authoring-generation.js';
import { createProcedureLeafReplayCurrentStateCoordinator } from './procedure-replay-current-state.js';
import {
  buildProcedureLeafReplayAttestation,
  buildProcedureLeafReplayBinding,
  buildProcedureLeafReplayFailureRecoveryAttestation,
  prepareProcedureLeafReplay,
  ProcedureLeafReplayError,
  sameProcedureLeafReplayValue,
} from './procedure-replay.js';
import {
  buildProcedureAuthoringPromptPacket,
  procedureAuthoringTutorialInputFromPacket,
  validateProcedureAuthoringCandidate,
  validateProcedureAuthoringPromptPacketIntegrity,
  type ProcedureAuthoringPromptPacketBuildOptions,
} from './procedure-authoring-prompt.js';
import { buildProcedureTutorialTranscriptPromptPacket } from './procedure-tutorial-transcript-import.js';
import {
  buildProcedureTutorialYoutubePromptPacket,
  createProcedureTutorialYoutubeImportCoordinator,
  procedureTutorialYoutubeImportErrorResponse,
  procedureTutorialYoutubeEvidenceEventTypes,
  procedureTutorialYoutubeImportHttpStatus,
  procedureTutorialYoutubeTrackListErrorResponse,
  procedureTutorialYoutubeTrackListHttpStatus,
  type ProcedureTutorialYoutubeImportCoordinator,
} from './procedure-tutorial-youtube-import.js';
import {
  procedureTutorialYoutubeTrackRecommendationErrorResponse,
  procedureTutorialYoutubeTrackRecommendationHttpStatus,
  recommendProcedureTutorialYoutubeCaptionTracks,
} from './procedure-tutorial-youtube-track-recommendation.js';
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
  validateGuidePlanStructure,
  validateProposalTarget,
} from './guide-validation.js';
import { closeAll, throwAfterCleanup, type CleanupStep } from './lifecycle.js';
import { isStableVersionRangeSubset } from './stable-version-ranges.js';
import type { ProcedureTutorialYoutubeCaptionSource } from './youtube-caption-source.js';

export interface StartRuntimeOptions {
  databasePath: string;
  accessToken: string;
  adapters?: readonly AppAdapter[];
  actionCatalogs?: readonly ActionCatalog[];
  interactionCatalogs?: readonly InteractionCatalog[];
  plannerProviders?: readonly PlannerProvider[];
  plannerProviderTimeoutMs?: number;
  youtubeCaptionSource?: ProcedureTutorialYoutubeCaptionSource;
  companionLeases?: CompanionLeaseManagerOptions;
  port?: number;
}

export interface RunningRuntime {
  readonly baseUrl: string;
  readonly mcpEndpoint: string;
  getStatus(): RuntimeStatus;
  stop(): Promise<void>;
}

export const runtimeVersion = '0.1.0';

const procedureRuntimeValidation = {
  procedureStructure: 'validated',
  actionCatalogBinding: 'validated',
  hostVersionRange: 'validated_against_action_catalog',
  interactionTracks: 'structural_only',
} as const;

const positiveIntegerQuerySchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive());
const nonnegativeIntegerQuerySchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative());
const procedureTreeGetHttpQuerySchema = z.strictObject({
  treeId: procedureTreeGetRequestSchema.shape.treeId,
  revision: positiveIntegerQuerySchema.optional(),
});
const procedureTreeListHttpQuerySchema = z.strictObject({
  adapterId: procedureTreeListRequestSchema.shape.adapterId,
  afterSequence: nonnegativeIntegerQuerySchema.optional(),
  limit: positiveIntegerQuerySchema.pipe(z.number().max(100)).optional(),
});

class ProcedureTreeRevisionError extends Error {
  constructor(
    readonly result: 'stale' | 'conflict',
    readonly treeId: string,
    readonly revision: number,
    readonly latestRevision: number,
  ) {
    super(
      `Procedure tree ${treeId} revision ${revision} is ${result}; latest stored revision is ${latestRevision}`,
    );
    this.name = 'ProcedureTreeRevisionError';
  }
}

class ProcedureTreeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcedureTreeValidationError';
  }
}

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
  const interactionCatalogRegistry = createInteractionCatalogRegistry(
    options.interactionCatalogs ?? [],
    actionCatalogRegistry,
  );
  const companionLeaseManager = createCompanionLeaseManager(options.companionLeases);
  const plannerProviderRegistry = createPlannerProviderRegistry(options.plannerProviders ?? []);
  const database = openOperatingLineDatabase(options.databasePath);
  const procedureLeafReplayCurrentStateCoordinator =
    createProcedureLeafReplayCurrentStateCoordinator(database);
  const guideRevisionRequestService = createGuideRevisionRequestService({
    database,
    actionCatalogRegistry,
  });
  let app: ReturnType<typeof createMcpFastifyApp> | undefined;
  let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
  let plannerGenerationCoordinator: PlannerGenerationCoordinator | undefined;
  let plannerReplanGenerationCoordinator: PlannerReplanGenerationCoordinator | undefined;
  let procedureAuthoringGenerationCoordinator: ProcedureAuthoringGenerationCoordinator | undefined;
  let procedureTutorialYoutubeImportCoordinator:
    ProcedureTutorialYoutubeImportCoordinator | undefined;
  let companionInitialPlanRunCoordinator: CompanionInitialPlanRunCoordinator | undefined;
  let companionReplanRunCoordinator: CompanionReplanRunCoordinator | undefined;
  let companionDialogueRunCoordinator: CompanionDialogueRunCoordinator | undefined;
  const cleanupSteps: CleanupStep[] = [
    () => companionInitialPlanRunCoordinator?.beginClose(),
    () => companionReplanRunCoordinator?.beginClose(),
    () => {
      companionDialogueRunCoordinator?.beginClose();
      procedureTutorialYoutubeImportCoordinator?.beginClose();
    },
    async () => {
      if (plannerGenerationCoordinator !== undefined) {
        await plannerGenerationCoordinator.close();
      } else if (procedureAuthoringGenerationCoordinator !== undefined) {
        await procedureAuthoringGenerationCoordinator.close();
      } else {
        await plannerReplanGenerationCoordinator?.close();
      }
    },
    () => procedureTutorialYoutubeImportCoordinator?.close(),
    () => companionInitialPlanRunCoordinator?.close(),
    () => companionReplanRunCoordinator?.close(),
    () => companionDialogueRunCoordinator?.close(),
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

    const listKnownCompanionStates = (): CompanionStateReport[] =>
      database
        .listLatestCompanionStates()
        .map((report) => companionStateReportSchema.parse(report));
    const listCompanionStates = (): CompanionStateReport[] =>
      listKnownCompanionStates().filter((report) =>
        companionLeaseManager.hasActivePresence(report.adapterId, report.instanceId),
      );

    const getPlanningContext = (
      request: ReturnType<typeof planningContextRequestSchema.parse>,
      recordEvent = true,
      provenance?: { goalRequestId: string; targetInstanceId: string },
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
          (state) =>
            state.adapterId === request.targetAdapterId &&
            (provenance === undefined || state.instanceId === provenance.targetInstanceId),
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
          payload: { request, context, ...provenance },
        });
      }
      return context;
    };

    const getPlanningPrompt = (
      request: ReturnType<typeof planningPromptRequestSchema.parse>,
      recordEvents = true,
      provenance?: { goalRequestId: string; targetInstanceId: string },
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
        provenance,
      );
      const packet = buildPlanningPromptPacket(context);
      if (recordEvents) {
        database.appendEvent({
          id: randomUUID(),
          eventType: 'planning.prompt.generated',
          payload: { request, packet, ...provenance },
        });
      }
      return packet;
    };

    const getProcedureAuthoringPrompt = (
      request: ReturnType<typeof procedureAuthoringPromptRequestSchema.parse>,
      options: ProcedureAuthoringPromptPacketBuildOptions = {},
    ) => {
      const actionCatalog = actionCatalogRegistry.get({
        targetAdapterId: request.targetAdapterId,
        ...(request.actionCatalogVersion === undefined
          ? {}
          : { catalogVersion: request.actionCatalogVersion }),
      });
      const interactionCatalog = interactionCatalogRegistry.get({
        targetAdapterId: request.targetAdapterId,
        actionCatalogVersion: actionCatalog.catalogVersion,
        ...(request.interactionCatalogVersion === undefined
          ? {}
          : { interactionCatalogVersion: request.interactionCatalogVersion }),
      });
      return buildProcedureAuthoringPromptPacket(
        request,
        actionCatalog,
        interactionCatalog,
        options,
      );
    };

    const importProcedureTutorialTranscript = (
      request: ReturnType<typeof procedureTutorialTranscriptImportRequestSchema.parse>,
    ) => {
      const actionCatalog = actionCatalogRegistry.get({
        targetAdapterId: request.targetAdapterId,
        ...(request.actionCatalogVersion === undefined
          ? {}
          : { catalogVersion: request.actionCatalogVersion }),
      });
      const interactionCatalog = interactionCatalogRegistry.get({
        targetAdapterId: request.targetAdapterId,
        actionCatalogVersion: actionCatalog.catalogVersion,
        ...(request.interactionCatalogVersion === undefined
          ? {}
          : { interactionCatalogVersion: request.interactionCatalogVersion }),
      });
      return buildProcedureTutorialTranscriptPromptPacket(
        request,
        actionCatalog,
        interactionCatalog,
      );
    };

    const getGuideGoalRequest = (requestId: string): GuideGoalRequest => {
      const stored = database.getGuideGoalRequest(requestId);
      if (stored === null) {
        throw new Error(`Guide goal request was not found: ${requestId}`);
      }
      return guideGoalRequestSchema.parse(stored);
    };

    const getGuideGoalPrompt = (request: ReturnType<typeof guideGoalPromptRequestSchema.parse>) => {
      const goalRequest = getGuideGoalRequest(request.requestId);
      if (database.getGuideGoalProposalForRequest(goalRequest.requestId) !== null) {
        throw new Error(`Guide goal request already has a proposal: ${goalRequest.requestId}`);
      }
      return getPlanningPrompt(
        {
          targetAdapterId: goalRequest.adapterId,
          catalogVersion: goalRequest.catalogVersion,
          goal: goalRequest.goal,
          planId: goalRequest.planId,
        },
        true,
        {
          goalRequestId: goalRequest.requestId,
          targetInstanceId: goalRequest.instanceId,
        },
      );
    };

    const getEvalExport = (request: ReturnType<typeof evalExportRequestSchema.parse>) =>
      createEvalExport({
        request,
        availableCatalogs: actionCatalogRegistry.list(),
        events: readExecutionEventLedger(database),
        exportId: randomUUID(),
        exportedAt: new Date().toISOString(),
      });

    const validateAndCompileProcedureTree = (treeInput: unknown) => {
      const tree = parseProcedureTree(treeInput);
      const catalog = actionCatalogRegistry.get({
        targetAdapterId: tree.adapterId,
        catalogVersion: tree.actionCatalogVersion,
      });
      if (!isStableVersionRangeSubset(tree.hostVersionRange, catalog.hostVersionRange)) {
        throw new Error(
          `Procedure tree host range ${tree.hostVersionRange} is not contained by ${catalog.adapterId}@${catalog.catalogVersion} range ${catalog.hostVersionRange}`,
        );
      }
      const plan = compileProcedureTreeToGuidePlan(tree);
      validateGuidePlanStructure(plan);
      validateGuidePlanAgainstActionCatalog(plan, catalog);
      return { tree, plan };
    };

    const compileProcedure = (
      request: ReturnType<typeof procedureCompilationRequestSchema.parse>,
    ) => {
      const { tree, plan } = validateAndCompileProcedureTree(request.tree);
      return procedureCompilationResultSchema.parse({
        formatVersion: tree.formatVersion,
        procedureTreeId: tree.id,
        procedureTreeRevision: tree.revision,
        adapterId: tree.adapterId,
        actionCatalogVersion: tree.actionCatalogVersion,
        interactionCatalogVersion: tree.interactionCatalogVersion,
        validation: procedureRuntimeValidation,
        plan,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    };

    const validateProcedureAuthoringInput = (
      request: ReturnType<typeof procedureAuthoringValidationRequestSchema.parse>,
    ) => {
      const packet = validateProcedureAuthoringPromptPacketIntegrity(request.packet);
      const tutorial = procedureAuthoringTutorialInputFromPacket(packet);
      const tutorialTranscriptDocument = packet.context.tutorialProvenance?.transcript.document;
      const expectedPacket = getProcedureAuthoringPrompt(
        {
          targetAdapterId: packet.context.catalogBinding.adapterId,
          actionCatalogVersion: packet.context.catalogBinding.actionCatalog.catalogVersion,
          interactionCatalogVersion:
            packet.context.catalogBinding.interactionCatalog.catalogVersion,
          goal: packet.context.goalProvenance.source.text,
          treeId: packet.context.requestedTreeId,
          revision: packet.context.recommendedRevision,
          ...(packet.context.goalProvenance.source.locale === undefined
            ? {}
            : { locale: packet.context.goalProvenance.source.locale }),
          ...(tutorial === undefined ? {} : { tutorial }),
        },
        {
          ...(tutorialTranscriptDocument === undefined ? {} : { tutorialTranscriptDocument }),
        },
      );
      if (packet.integrity.contentSha256 !== expectedPacket.integrity.contentSha256) {
        throw new Error(
          'Procedure authoring packet does not match the installed catalog snapshots',
        );
      }
      const tree = validateProcedureAuthoringCandidate(packet, request.tree);
      const compilation = compileProcedure({ tree });
      return { packet, tree, compilation };
    };

    const validateProcedureAuthoring = (
      request: ReturnType<typeof procedureAuthoringValidationRequestSchema.parse>,
    ) => {
      const { packet, compilation } = validateProcedureAuthoringInput(request);
      return procedureAuthoringValidationResultSchema.parse({
        formatVersion: packet.formatVersion,
        packetContentSha256: packet.integrity.contentSha256,
        validation: {
          packetIntegrity: 'validated',
          installedCatalogBinding: 'validated',
          authoringCandidateContract: 'validated',
          procedureCompilation: 'validated',
        },
        compilation,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    };

    const materializeProcedureAuthoring = (
      request: ReturnType<typeof procedureAuthoringMaterializationRequestSchema.parse>,
    ) => {
      const { packet, tree } = validateProcedureAuthoringInput(request);
      const actionCatalog = actionCatalogRegistry.get({
        targetAdapterId: tree.adapterId,
        catalogVersion: tree.actionCatalogVersion,
      });
      const interactionCatalog = interactionCatalogRegistry.get({
        targetAdapterId: tree.adapterId,
        actionCatalogVersion: tree.actionCatalogVersion,
        interactionCatalogVersion: tree.interactionCatalogVersion,
      });
      const materialized = materializeProcedureAuthoringCandidate(
        tree,
        actionCatalog,
        interactionCatalog,
      );
      const compilation = compileProcedure({ tree: materialized.tree });
      return procedureAuthoringMaterializationResultSchema.parse({
        formatVersion: materialized.formatVersion,
        packetContentSha256: packet.integrity.contentSha256,
        inputTreeContentSha256: materialized.inputTreeContentSha256,
        outputTreeContentSha256: materialized.outputTreeContentSha256,
        catalogBinding: {
          adapterId: interactionCatalog.adapterId,
          actionCatalogVersion: interactionCatalog.actionCatalogVersion,
          interactionCatalogVersion: interactionCatalog.catalogVersion,
          interactionCatalogContentSha256: materialized.interactionCatalogContentSha256,
        },
        coverage: materialized.coverage,
        validation: {
          packetIntegrity: 'validated',
          installedCatalogBinding: 'validated',
          authoringCandidateContract: 'validated',
          procedureCompilation: 'validated',
          interactionGrounding: 'validated_against_installed_interaction_catalog',
        },
        tree: materialized.tree,
        compilation,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    };

    const computeProcedureTreeContentSha256 = (tree: unknown): string =>
      createHash('sha256').update(canonicalizeProtocolJsonValue(tree)).digest('hex');

    const publicProcedureTreeRecord = (record: DatabaseStoredProcedureTreeRecord) => {
      const tree = parseProcedureTree(record.tree);
      if (
        tree.id !== record.treeId ||
        tree.revision !== record.revision ||
        tree.title !== record.title ||
        tree.adapterId !== record.adapterId ||
        tree.actionCatalogVersion !== record.actionCatalogVersion ||
        tree.interactionCatalogVersion !== record.interactionCatalogVersion ||
        tree.hostVersionRange !== record.hostVersionRange
      ) {
        throw new Error(
          `Stored procedure tree metadata does not match payload: ${record.treeId}@${record.revision}`,
        );
      }
      const contentSha256 = computeProcedureTreeContentSha256(tree);
      if (contentSha256 !== record.contentSha256) {
        throw new Error(
          `Stored procedure tree integrity check failed: ${record.treeId}@${record.revision}`,
        );
      }
      return storedProcedureTreeSchema.parse({
        sequence: record.sequence,
        tree,
        integrity: {
          algorithm: 'sha256',
          canonicalization: protocolJsonValueCanonicalization,
          contentSha256,
        },
        storedAt: record.storedAt,
      });
    };

    const publicProcedureTreeSummary = (record: DatabaseStoredProcedureTreeSummary) =>
      procedureTreeSummarySchema.parse({
        sequence: record.sequence,
        treeId: record.treeId,
        revision: record.revision,
        title: record.title,
        adapterId: record.adapterId,
        actionCatalogVersion: record.actionCatalogVersion,
        interactionCatalogVersion: record.interactionCatalogVersion,
        hostVersionRange: record.hostVersionRange,
        integrity: {
          algorithm: 'sha256',
          canonicalization: protocolJsonValueCanonicalization,
          contentSha256: record.contentSha256,
        },
        storedAt: record.storedAt,
      });

    const storeProcedureTree = (
      request: ReturnType<typeof procedureTreeStoreRequestSchema.parse>,
    ) => {
      const tree = (() => {
        try {
          return validateAndCompileProcedureTree(request.tree).tree;
        } catch (error) {
          throw new ProcedureTreeValidationError(
            error instanceof Error ? error.message : 'Unknown procedure validation error',
          );
        }
      })();
      const contentSha256 = computeProcedureTreeContentSha256(tree);
      const stored = database.recordProcedureTree({
        treeId: tree.id,
        revision: tree.revision,
        title: tree.title,
        adapterId: tree.adapterId,
        actionCatalogVersion: tree.actionCatalogVersion,
        interactionCatalogVersion: tree.interactionCatalogVersion,
        hostVersionRange: tree.hostVersionRange,
        contentSha256,
        tree,
      });
      if (!('record' in stored)) {
        throw new ProcedureTreeRevisionError(
          stored.result,
          tree.id,
          tree.revision,
          stored.latestRevision,
        );
      }
      return procedureTreeStoreResultSchema.parse({
        result: stored.result,
        record: publicProcedureTreeRecord(stored.record),
        validation: procedureRuntimeValidation,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    };

    const getProcedureTree = (request: ReturnType<typeof procedureTreeGetRequestSchema.parse>) => {
      const stored = database.getProcedureTree(request.treeId, request.revision);
      return stored === null ? null : publicProcedureTreeRecord(stored);
    };

    const listProcedureTrees = (
      request: ReturnType<typeof procedureTreeListRequestSchema.parse>,
    ) => {
      const afterSequence = request.afterSequence ?? 0;
      const limit = request.limit ?? 50;
      const records = database.listProcedureTrees(afterSequence, limit + 1, request.adapterId);
      const hasMore = records.length > limit;
      const visible = records.slice(0, limit).map(publicProcedureTreeSummary);
      return procedureTreeListResultSchema.parse({
        procedures: visible,
        nextAfterSequence: hasMore ? (visible.at(-1)?.sequence ?? null) : null,
      });
    };

    const sameStringArray = (
      left: readonly string[] | null,
      right: readonly string[] | null,
    ): boolean =>
      left === null || right === null
        ? left === right
        : left.length === right.length && left.every((value, index) => value === right[index]);

    type CachedProcedureSearchTree = {
      stored: DatabaseStoredProcedureTreeRecord;
      record: ReturnType<typeof publicProcedureTreeRecord>;
    };

    const materializeProcedureOperationSearchHit = (
      indexed: DatabaseStoredProcedureOperationIndex,
      treeCache: Map<string, CachedProcedureSearchTree>,
    ) => {
      const treeKey = `${indexed.treeId}@${indexed.treeRevision}`;
      let cached = treeCache.get(treeKey);
      if (cached === undefined) {
        const stored = database.getProcedureTree(indexed.treeId, indexed.treeRevision);
        if (stored === null) {
          throw new Error(
            `Indexed procedure tree is missing: ${indexed.treeId}@${indexed.treeRevision}`,
          );
        }
        cached = { stored, record: publicProcedureTreeRecord(stored) };
        treeCache.set(treeKey, cached);
      }
      const { stored, record } = cached;
      const tree = record.tree;
      if (stored.sequence !== indexed.treeSequence || tree.adapterId !== indexed.adapterId) {
        throw new Error(
          `Indexed procedure tree identity is inconsistent: ${indexed.treeId}@${indexed.treeRevision}`,
        );
      }
      const nodeById = new Map(tree.nodes.map((node) => [node.id, node]));
      const leaf = nodeById.get(indexed.leafId);
      if (leaf?.kind !== 'leaf') {
        throw new Error(`Indexed procedure leaf is missing: ${indexed.leafId}`);
      }
      if (
        leaf.validation.status !== indexed.validationStatus ||
        (leaf.action?.name ?? null) !== indexed.actionName
      ) {
        throw new Error(`Indexed procedure leaf metadata is inconsistent: ${indexed.leafId}`);
      }
      const semanticById = new Map(
        leaf.semanticOperations.map((operation) => [operation.id, operation]),
      );
      let operation: unknown;
      let track: { id: string; title: string; preconditions: unknown[] } | null = null;
      let semanticActions: string[];
      let evidenceRefs: string[];
      switch (indexed.modality) {
        case 'semantic': {
          const found = leaf.semanticOperations.find(
            (candidate) => candidate.id === indexed.operationId,
          );
          if (found === undefined || indexed.trackId !== null) {
            throw new Error(`Indexed semantic operation is missing: ${indexed.operationId}`);
          }
          operation = found;
          semanticActions = [found.semanticAction];
          evidenceRefs = found.evidenceRefs;
          break;
        }
        case 'menu': {
          const foundTrack = leaf.menuTracks.find((candidate) => candidate.id === indexed.trackId);
          if (foundTrack?.availability !== 'available') {
            throw new Error(`Indexed menu track is unavailable: ${indexed.trackId ?? ''}`);
          }
          const found = foundTrack.operations.find(
            (candidate) => candidate.id === indexed.operationId,
          );
          if (
            found === undefined ||
            found.target.hostId !== indexed.menuTargetHostId ||
            !sameStringArray(found.path, indexed.menuPath)
          ) {
            throw new Error(`Indexed menu operation is inconsistent: ${indexed.operationId}`);
          }
          operation = found;
          track = {
            id: foundTrack.id,
            title: foundTrack.title,
            preconditions: foundTrack.preconditions,
          };
          semanticActions = found.semanticRefs.map((reference) => {
            const semantic = semanticById.get(reference);
            if (semantic === undefined) {
              throw new Error(`Indexed menu operation has an unknown semantic ref: ${reference}`);
            }
            return semantic.semanticAction;
          });
          evidenceRefs = found.evidenceRefs;
          break;
        }
        case 'shortcut': {
          const foundTrack = leaf.shortcutTracks.find(
            (candidate) => candidate.id === indexed.trackId,
          );
          if (foundTrack?.availability !== 'available') {
            throw new Error(`Indexed shortcut track is unavailable: ${indexed.trackId ?? ''}`);
          }
          const found = foundTrack.operations.find(
            (candidate) => candidate.id === indexed.operationId,
          );
          const shortcutContextIsConsistent = (() => {
            if (found === undefined) return false;
            if ('kind' in found && found.kind === 'operator_property_update') {
              const surface = foundTrack.operations.find(
                (candidate) => candidate.id === found.surfaceOperationId,
              );
              const expectedOperatorId =
                surface !== undefined &&
                'kind' in surface &&
                surface.kind === 'key_input' &&
                surface.opensSurface !== undefined
                  ? surface.opensSurface.expectedOperatorId
                  : null;
              return (
                indexed.operationKind === 'operator_property_update' &&
                indexed.shortcutKeys === null &&
                found.target.hostId === indexed.targetHostId &&
                sameStringArray(found.path, indexed.interactionPath) &&
                found.surfaceOperationId === indexed.surfaceOperationId &&
                expectedOperatorId === indexed.expectedOperatorId
              );
            }
            const opensSurface = 'opensSurface' in found ? found.opensSurface : undefined;
            const closesSurfaceOperationId =
              'closesSurfaceOperationId' in found ? found.closesSurfaceOperationId : undefined;
            const closedSurface =
              closesSurfaceOperationId === undefined
                ? undefined
                : foundTrack.operations.find(
                    (candidate) => candidate.id === closesSurfaceOperationId,
                  );
            const expectedOperatorId =
              opensSurface?.expectedOperatorId ??
              (closedSurface as { opensSurface?: { expectedOperatorId: string } } | undefined)
                ?.opensSurface?.expectedOperatorId ??
              null;
            return (
              indexed.operationKind === 'shortcut_key_input' &&
              sameStringArray(found.keys, indexed.shortcutKeys) &&
              sameStringArray(found.selectionPath ?? null, indexed.interactionPath) &&
              (opensSurface?.hostId ?? null) === indexed.targetHostId &&
              (opensSurface === undefined ? (closesSurfaceOperationId ?? null) : found.id) ===
                indexed.surfaceOperationId &&
              expectedOperatorId === indexed.expectedOperatorId
            );
          })();
          if (!shortcutContextIsConsistent || found === undefined) {
            throw new Error(`Indexed shortcut operation is inconsistent: ${indexed.operationId}`);
          }
          operation = found;
          track = {
            id: foundTrack.id,
            title: foundTrack.title,
            preconditions: foundTrack.preconditions,
          };
          semanticActions = found.semanticRefs.map((reference) => {
            const semantic = semanticById.get(reference);
            if (semantic === undefined) {
              throw new Error(
                `Indexed shortcut operation has an unknown semantic ref: ${reference}`,
              );
            }
            return semantic.semanticAction;
          });
          evidenceRefs = found.evidenceRefs;
          break;
        }
        case 'mcp': {
          const foundTrack = leaf.mcpTracks.find((candidate) => candidate.id === indexed.trackId);
          if (foundTrack?.availability !== 'available') {
            throw new Error(`Indexed MCP track is unavailable: ${indexed.trackId ?? ''}`);
          }
          const found = foundTrack.operations.find(
            (candidate) => candidate.id === indexed.operationId,
          );
          if (
            found === undefined ||
            found.serverName !== indexed.mcpServerName ||
            found.toolName !== indexed.mcpToolName
          ) {
            throw new Error(`Indexed MCP operation is inconsistent: ${indexed.operationId}`);
          }
          operation = found;
          track = {
            id: foundTrack.id,
            title: foundTrack.title,
            preconditions: foundTrack.preconditions,
          };
          semanticActions = found.semanticRefs.map((reference) => {
            const semantic = semanticById.get(reference);
            if (semantic === undefined) {
              throw new Error(`Indexed MCP operation has an unknown semantic ref: ${reference}`);
            }
            return semantic.semanticAction;
          });
          evidenceRefs = found.evidenceRefs;
          break;
        }
      }
      if (!sameStringArray(semanticActions, indexed.semanticActions)) {
        throw new Error(`Indexed semantic alignment is inconsistent: ${indexed.operationId}`);
      }
      const evidenceIds = new Set(evidenceRefs);
      const evidence = tree.evidence.filter((item) => evidenceIds.has(item.id));
      if (evidence.length !== evidenceIds.size) {
        throw new Error(`Indexed operation evidence is incomplete: ${indexed.operationId}`);
      }
      const sourceIds = new Set(evidence.map((item) => item.sourceId));
      const sources = tree.sources.filter((source) => sourceIds.has(source.id));
      if (sources.length !== sourceIds.size) {
        throw new Error(`Indexed operation sources are incomplete: ${indexed.operationId}`);
      }
      const nodePath: Array<{
        id: string;
        kind: 'group' | 'leaf';
        order: number;
        title: string;
      }> = [];
      let currentId: string | null = leaf.id;
      while (currentId !== null) {
        const node = nodeById.get(currentId);
        if (node === undefined) {
          throw new Error(`Indexed operation path is incomplete: ${indexed.operationId}`);
        }
        nodePath.unshift({ id: node.id, kind: node.kind, order: node.order, title: node.title });
        currentId = node.parentId;
      }
      return procedureOperationSearchHitSchema.parse({
        indexSequence: indexed.sequence,
        tree: publicProcedureTreeSummary(stored),
        nodePath,
        leafId: leaf.id,
        leafTitle: leaf.title,
        leafIntent: leaf.intent,
        leafAction: leaf.action,
        leafValidation: leaf.validation,
        semanticActions,
        sources,
        evidence,
        modality: indexed.modality,
        track,
        operation,
      });
    };

    const searchProcedureOperations = (
      request: ReturnType<typeof procedureOperationSearchRequestSchema.parse>,
    ) => {
      const limit = request.limit ?? 50;
      const indexed = database.searchProcedureOperations({
        afterSequence: request.afterSequence ?? 0,
        limit: limit + 1,
        ...(request.treeId === undefined ? {} : { treeId: request.treeId }),
        ...(request.revision === undefined ? {} : { treeRevision: request.revision }),
        ...(request.adapterId === undefined ? {} : { adapterId: request.adapterId }),
        ...(request.leafId === undefined ? {} : { leafId: request.leafId }),
        ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
        ...(request.modality === undefined ? {} : { modality: request.modality }),
        ...(request.operationKind === undefined ? {} : { operationKind: request.operationKind }),
        ...(request.validationStatus === undefined
          ? {}
          : { validationStatus: request.validationStatus }),
        ...(request.actionName === undefined ? {} : { actionName: request.actionName }),
        ...(request.semanticAction === undefined ? {} : { semanticAction: request.semanticAction }),
        ...(request.menuTargetHostId === undefined
          ? {}
          : { menuTargetHostId: request.menuTargetHostId }),
        ...(request.menuPath === undefined ? {} : { menuPath: request.menuPath }),
        ...(request.shortcutKeys === undefined ? {} : { shortcutKeys: request.shortcutKeys }),
        ...(request.targetHostId === undefined ? {} : { targetHostId: request.targetHostId }),
        ...(request.interactionPath === undefined
          ? {}
          : { interactionPath: request.interactionPath }),
        ...(request.surfaceOperationId === undefined
          ? {}
          : { surfaceOperationId: request.surfaceOperationId }),
        ...(request.expectedOperatorId === undefined
          ? {}
          : { expectedOperatorId: request.expectedOperatorId }),
        ...(request.mcpServerName === undefined ? {} : { mcpServerName: request.mcpServerName }),
        ...(request.mcpToolName === undefined ? {} : { mcpToolName: request.mcpToolName }),
      });
      const hasMore = indexed.length > limit;
      const visible = indexed.slice(0, limit);
      const treeCache = new Map<string, CachedProcedureSearchTree>();
      return procedureOperationSearchResultSchema.parse({
        operations: visible.map((operation) =>
          materializeProcedureOperationSearchHit(operation, treeCache),
        ),
        nextAfterSequence: hasMore ? (visible.at(-1)?.sequence ?? null) : null,
        matching: 'exact_structured_filters',
        similarityScoreProduced: false,
        hostExecutionStarted: false,
      });
    };

    const getPlanningQuality = (
      request: ReturnType<typeof planningQualityEvaluationRequestSchema.parse>,
      selectedCatalog?: ActionCatalog,
      provenance?: {
        targetInstanceId: string;
        goalRequestId?: string;
        revisionRequestId?: string;
        generationRequestId?: string;
      },
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
          ...provenance,
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
    const existingProcedureAuthoringGenerationEvents = database.listExecutionEventsByTypes(
      procedureAuthoringGenerationEvidenceEventTypes,
    );
    const existingProcedureTutorialYoutubeEvents = database.listExecutionEventsByTypes(
      procedureTutorialYoutubeEvidenceEventTypes,
    );
    procedureTutorialYoutubeImportCoordinator = createProcedureTutorialYoutubeImportCoordinator({
      ...(options.youtubeCaptionSource === undefined
        ? {}
        : { source: options.youtubeCaptionSource }),
      existingEvents: existingProcedureTutorialYoutubeEvents,
      buildPacket: (request, acquisition) => {
        const actionCatalog = actionCatalogRegistry.get({
          targetAdapterId: request.targetAdapterId,
          ...(request.actionCatalogVersion === undefined
            ? {}
            : { catalogVersion: request.actionCatalogVersion }),
        });
        const interactionCatalog = interactionCatalogRegistry.get({
          targetAdapterId: request.targetAdapterId,
          actionCatalogVersion: actionCatalog.catalogVersion,
          ...(request.interactionCatalogVersion === undefined
            ? {}
            : { interactionCatalogVersion: request.interactionCatalogVersion }),
        });
        return buildProcedureTutorialYoutubePromptPacket(
          request,
          acquisition,
          actionCatalog,
          interactionCatalog,
        );
      },
      appendEvent: (event) => database.appendEvent(event),
    });
    const plannerProviderInvocationManager = createPlannerProviderInvocationManager({
      registry: plannerProviderRegistry,
      ...(options.plannerProviderTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.plannerProviderTimeoutMs }),
      restoredInvocations: [
        ...restoreInitialPlannerProviderInvocations(existingPlannerGenerationEvents),
        ...restoreReplanPlannerProviderInvocations(existingPlannerReplanEvents),
        ...restoreProcedureAuthoringProviderInvocations(existingProcedureAuthoringGenerationEvents),
      ],
    });
    procedureAuthoringGenerationCoordinator = createProcedureAuthoringGenerationCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingProcedureAuthoringGenerationEvents,
      buildPacket: getProcedureAuthoringPrompt,
      buildTutorialTranscriptPacket: importProcedureTutorialTranscript,
      validateCandidate: (packet, tree) => validateProcedureAuthoring({ packet, tree }),
      appendEvent: (event) => database.appendEvent(event),
    });
    plannerGenerationCoordinator = createPlannerGenerationCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingPlannerGenerationEvents,
      buildPacket: (request, provenance) => getPlanningPrompt(request, false, provenance),
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
      goalRequestId?: string;
      goalGenerationRequestId?: string;
      replan?: {
        requestId: string;
        generationRequestId?: string;
        basePlan: GuidePlan;
        revisionThread: NonNullable<
          ReturnType<typeof guideRevisionRequestSchema.parse>['revisionThread']
        >;
        revisionOperation?: ReturnType<
          typeof guideRevisionRequestSchema.parse
        >['revisionOperation'];
        mergeBaseRequestId?: string;
      };
      planning?: PlanningIntent;
      persistProposal?: (proposal: GuideProposal) => void;
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
        input.targetInstanceId === undefined
          ? undefined
          : input.goalRequestId !== undefined
            ? {
                goalRequestId: input.goalRequestId,
                targetInstanceId: input.targetInstanceId,
              }
            : input.replan === undefined
              ? undefined
              : {
                  revisionRequestId: input.replan.requestId,
                  ...(input.replan.generationRequestId === undefined
                    ? {}
                    : { generationRequestId: input.replan.generationRequestId }),
                  targetInstanceId: input.targetInstanceId,
                },
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
              revisionOperation: input.replan.revisionOperation ?? { kind: 'revise' },
              ...(input.replan.mergeBaseRequestId === undefined
                ? {}
                : { mergeBaseRequestId: input.replan.mergeBaseRequestId }),
            }),
        ...(input.goalRequestId === undefined ? {} : { goalRequestId: input.goalRequestId }),
        planDiff:
          input.replan === undefined
            ? null
            : computeGuidePlanDiff(input.replan.basePlan, input.plan),
        catalogVersion: catalog.catalogVersion,
        proposedAt: new Date().toISOString(),
      });
      if (input.persistProposal !== undefined) {
        if (input.goalRequestId !== undefined || input.replan !== undefined) {
          throw new Error('Custom proposal persistence is limited to standalone proposals');
        }
        input.persistProposal(proposal);
      } else if (input.goalRequestId !== undefined) {
        database.recordGuideGoalProposal(
          proposal,
          input.goalRequestId,
          input.goalGenerationRequestId,
        );
      } else if (input.replan === undefined) {
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
      goalRequestId: proposal.goalRequestId ?? null,
      revisionRequestId: proposal.revisionRequestId ?? null,
      revisionThread: proposal.revisionThread ?? null,
      revisionOperation: proposal.revisionOperation ?? null,
      mergeBaseRequestId: proposal.mergeBaseRequestId ?? null,
      planDiff: proposal.planDiff ?? null,
      planningQuality,
    });

    const proposeProcedureLeafReplay = (
      request: ReturnType<typeof procedureLeafReplayProposalRequestSchema.parse>,
    ) => {
      const existingPayload = database.getProcedureLeafReplay(request.replayId);
      if (existingPayload !== null) {
        const existing = procedureLeafReplayBindingSchema.parse(existingPayload);
        if (!sameProcedureLeafReplayValue(existing.request, request)) {
          throw new ProcedureLeafReplayError(
            `Replay id ${request.replayId} is already bound to different input`,
            409,
          );
        }
        return procedureLeafReplayProposalResultSchema.parse({
          status: 'duplicate',
          binding: existing,
        });
      }

      const materialization = materializeProcedureAuthoring({
        packet: request.packet,
        tree: request.tree,
      });
      const actionCatalog = actionCatalogRegistry.get({
        targetAdapterId: materialization.catalogBinding.adapterId,
        catalogVersion: materialization.catalogBinding.actionCatalogVersion,
      });
      const prepared = prepareProcedureLeafReplay(request, materialization, actionCatalog);
      const plan = materialization.compilation.plan;
      const planContentSha256 = computePlanContentSha256(plan);
      let binding: ProcedureLeafReplayBinding | undefined;
      let persistenceResult: 'accepted' | 'duplicate' | undefined;
      createProposal({
        targetAdapterId: actionCatalog.adapterId,
        targetInstanceId: request.targetInstanceId,
        catalogVersion: actionCatalog.catalogVersion,
        plan,
        planning: prepared.planning,
        persistProposal: (proposal) => {
          const candidateBinding = buildProcedureLeafReplayBinding({
            request,
            materialization,
            proposal,
            planContentSha256,
            recipeId: prepared.recipeId,
            actionName: prepared.actionName,
            createdAt: proposal.proposedAt,
          });
          const result = database.recordProcedureLeafReplayProposal(proposal, {
            replayId: candidateBinding.replayId,
            proposalId: proposal.proposalId,
            treeId: candidateBinding.materialization.tree.id,
            treeRevision: candidateBinding.materialization.tree.revision,
            leafId: candidateBinding.leafId,
            adapterId: candidateBinding.materialization.tree.adapterId,
            instanceId: candidateBinding.targetInstanceId,
            bindingContentSha256: candidateBinding.integrity.contentSha256,
            payload: candidateBinding,
            createdAt: candidateBinding.createdAt,
          });
          if (result === 'conflict') {
            throw new ProcedureLeafReplayError(
              'Replay proposal conflicts with an existing proposal or replay binding',
              409,
            );
          }
          binding = candidateBinding;
          persistenceResult = result;
        },
      });
      if (binding === undefined || persistenceResult === undefined) {
        throw new Error('Replay proposal persistence did not return a binding');
      }
      return procedureLeafReplayProposalResultSchema.parse({
        status: persistenceResult,
        binding,
      });
    };

    const loadProcedureLeafReplayEvidence = (replayId: string) => {
      const bindingPayload = database.getProcedureLeafReplay(replayId);
      if (bindingPayload === null) {
        throw new ProcedureLeafReplayError(`Unknown replay: ${replayId}`, 404);
      }
      const binding = procedureLeafReplayBindingSchema.parse(bindingPayload);
      const proposalPayload = database.getGuideProposal(binding.proposal.proposalId);
      if (
        proposalPayload === null ||
        !sameProcedureLeafReplayValue(proposalPayload, binding.proposal)
      ) {
        throw new ProcedureLeafReplayError(
          'Stored replay proposal is missing or differs from its binding',
          409,
        );
      }
      const decisionPayload = database.getGuideProposalDecision(
        binding.proposal.proposalId,
        binding.proposal.targetAdapterId,
        binding.targetInstanceId,
      );
      if (decisionPayload === null) {
        throw new ProcedureLeafReplayError(
          'Replay proposal has no persisted decision for the target instance',
          409,
        );
      }
      const decision = guideProposalDecisionSchema.parse(decisionPayload);
      const proposalReceipt = database.getManagedReplayReceipt(
        'replay_proposal',
        binding.proposal.proposalId,
      );
      const decisionReceipt = database.getManagedReplayReceipt(
        'guide_proposal_decision',
        decision.decisionId,
      );
      if (proposalReceipt === null || decisionReceipt === null) {
        throw new ProcedureLeafReplayError(
          'Replay evidence lacks its proposal or decision receipt',
          409,
        );
      }
      return { binding, decision, proposalReceipt, decisionReceipt };
    };

    const finalizeProcedureLeafReplay = (
      request: ReturnType<typeof procedureLeafReplayFinalizeRequestSchema.parse>,
    ) => {
      const existingPayload = database.getProcedureLeafReplayAttestation(request.replayId);
      if (existingPayload !== null) {
        const parsedExisting = procedureLeafReplayAttestationSchema.safeParse(existingPayload);
        if (!parsedExisting.success) {
          throw new ProcedureLeafReplayError(
            `Replay ${request.replayId} already has a failure/recovery attestation`,
            409,
          );
        }
        const existing = parsedExisting.data;
        if (
          existing.attestationId !== request.attestationId ||
          existing.report.reportId !== request.reportId
        ) {
          throw new ProcedureLeafReplayError(
            `Replay ${request.replayId} already has a different attestation`,
            409,
          );
        }
        return procedureLeafReplayFinalizeResultSchema.parse({
          status: 'duplicate',
          attestation: existing,
        });
      }

      const { binding, decision, proposalReceipt, decisionReceipt } =
        loadProcedureLeafReplayEvidence(request.replayId);
      const reportPayload = database.getCompanionStateReport(request.reportId);
      if (reportPayload === null) {
        throw new ProcedureLeafReplayError(
          `Unknown companion state report: ${request.reportId}`,
          404,
        );
      }
      const report = companionStateReportSchema.parse(reportPayload);
      const reportReceipt = database.getManagedReplayReceipt(
        'companion_state_report',
        report.reportId,
      );
      if (reportReceipt === null) {
        throw new ProcedureLeafReplayError(
          'Replay evidence lacks its authenticated report receipt',
          409,
        );
      }
      const attestation = buildProcedureLeafReplayAttestation({
        binding,
        decision,
        report,
        proposalReceipt,
        decisionReceipt,
        reportReceipt,
        attestationId: request.attestationId,
        attestedAt: new Date().toISOString(),
      });
      const persistenceResult = database.recordProcedureLeafReplayAttestation({
        attestationId: attestation.attestationId,
        replayId: attestation.replayId,
        reportId: attestation.report.reportId,
        executionId: attestation.execution.execution.id,
        contentSha256: attestation.integrity.contentSha256,
        payload: attestation,
        attestedAt: attestation.attestedAt,
      });
      if (persistenceResult === 'conflict') {
        throw new ProcedureLeafReplayError(
          'Replay attestation conflicts with existing append-only evidence',
          409,
        );
      }
      return procedureLeafReplayFinalizeResultSchema.parse({
        status: persistenceResult,
        attestation,
      });
    };

    const finalizeProcedureLeafReplayFailureRecovery = (
      request: ReturnType<typeof procedureLeafReplayFailureRecoveryFinalizeRequestSchema.parse>,
    ) => {
      const existingPayload = database.getProcedureLeafReplayAttestation(request.replayId);
      if (existingPayload !== null) {
        const parsedExisting =
          procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(existingPayload);
        if (!parsedExisting.success) {
          throw new ProcedureLeafReplayError(
            `Replay ${request.replayId} already has a successful attestation`,
            409,
          );
        }
        const existing = parsedExisting.data;
        if (
          existing.attestationId !== request.attestationId ||
          existing.failureReport.reportId !== request.failureReportId ||
          (existing.recoveryReport?.reportId ?? undefined) !== request.recoveryReportId
        ) {
          throw new ProcedureLeafReplayError(
            `Replay ${request.replayId} already has a different failure/recovery attestation`,
            409,
          );
        }
        return procedureLeafReplayFailureRecoveryFinalizeResultSchema.parse({
          status: 'duplicate',
          attestation: existing,
        });
      }

      const { binding, decision, proposalReceipt, decisionReceipt } =
        loadProcedureLeafReplayEvidence(request.replayId);
      const failurePayload = database.getCompanionStateReport(request.failureReportId);
      if (failurePayload === null) {
        throw new ProcedureLeafReplayError(
          `Unknown companion failure report: ${request.failureReportId}`,
          404,
        );
      }
      const failureReport = companionStateReportSchema.parse(failurePayload);
      const recoveryReport =
        request.recoveryReportId === undefined
          ? null
          : (() => {
              const payload = database.getCompanionStateReport(request.recoveryReportId);
              if (payload === null) {
                throw new ProcedureLeafReplayError(
                  `Unknown companion recovery report: ${request.recoveryReportId}`,
                  404,
                );
              }
              return companionStateReportSchema.parse(payload);
            })();
      const failureReportReceipt = database.getManagedReplayReceipt(
        'companion_state_report',
        failureReport.reportId,
      );
      const recoveryReportReceipt =
        recoveryReport === null
          ? null
          : database.getManagedReplayReceipt('companion_state_report', recoveryReport.reportId);
      if (
        failureReportReceipt === null ||
        (recoveryReport !== null && recoveryReportReceipt === null)
      ) {
        throw new ProcedureLeafReplayError(
          'Failure/recovery evidence lacks an authenticated report receipt',
          409,
        );
      }
      const attestation = buildProcedureLeafReplayFailureRecoveryAttestation({
        binding,
        decision,
        failureReport,
        recoveryReport,
        proposalReceipt,
        decisionReceipt,
        failureReportReceipt,
        recoveryReportReceipt,
        attestationId: request.attestationId,
        attestedAt: new Date().toISOString(),
      });
      const finalReport = attestation.recoveryReport ?? attestation.failureReport;
      const persistenceResult = database.recordProcedureLeafReplayAttestation({
        attestationId: attestation.attestationId,
        replayId: attestation.replayId,
        reportId: finalReport.reportId,
        evidenceReportIds: [
          attestation.failureReport.reportId,
          ...(attestation.recoveryReport === null ? [] : [attestation.recoveryReport.reportId]),
        ],
        executionId: attestation.execution.execution.id,
        contentSha256: attestation.integrity.contentSha256,
        payload: attestation,
        attestedAt: attestation.attestedAt,
      });
      if (persistenceResult === 'conflict') {
        throw new ProcedureLeafReplayError(
          'Failure/recovery attestation conflicts with existing append-only evidence',
          409,
        );
      }
      return procedureLeafReplayFailureRecoveryFinalizeResultSchema.parse({
        status: persistenceResult,
        attestation,
      });
    };

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
    companionDialogueRunCoordinator = createCompanionDialogueRunCoordinator({
      database,
      providerRegistry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      generationCoordinator: plannerReplanGenerationCoordinator,
      replanningService,
      revisionRequestService: guideRevisionRequestService,
    });
    companionInitialPlanRunCoordinator = createCompanionInitialPlanRunCoordinator({
      database,
      providerRegistry: plannerProviderRegistry,
      generationCoordinator: plannerGenerationCoordinator,
      createProposal: (input) => createProposal(input).proposal,
    });

    const runtimeMcpHandler = createMcpHandler(() => {
      const server = new McpServer(
        { name: 'operating-line', version: runtimeVersion },
        { instructions: operatingLineMcpInstructions },
      );

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
          description: 'List the latest state snapshot for each actively present host companion.',
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
        'operatingline.procedure.tutorial.import',
        {
          description:
            'Strictly parse one user-provided WebVTT or SRT caption document, bind its exact digest and normalized cues to a rights-declared HTTPS tutorial, and return a deterministic Procedure authoring packet. This performs no network fetch, transcription, model call, storage, proposal, or host execution.',
          inputSchema: deferMcpInputValidation(procedureTutorialTranscriptImportRequestSchema),
          outputSchema: procedureAuthoringPromptPacketSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureTutorialTranscriptImportRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_tutorial_transcript_import_request',
                    message:
                      'Procedure tutorial transcript import request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const packet = importProcedureTutorialTranscript(parsedRequest.data);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: packet.formatVersion,
                    packetContentSha256: packet.integrity.contentSha256,
                    message: 'The complete authoring packet is in structuredContent.',
                  }),
                },
              ],
              structuredContent: packet,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_tutorial_transcript_import_failed',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Procedure tutorial transcript import failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.youtube.tracks.list',
        {
          description:
            'Explicitly spend the documented 50-unit YouTube Data API quota cost to list caption-track metadata for one video owned or managed by the authenticated account. This returns track ids, languages, names, kinds, accessibility flags, draft/sync state, and processing status so the caller can explicitly select a track for a later import. It does not download caption content or video media, call a model, store a tree, create a Proposal, or execute the host. OAuth credentials are runtime-managed and must never be included in this request.',
          inputSchema: deferMcpInputValidation(procedureTutorialYoutubeTrackListRequestSchema),
          outputSchema: procedureTutorialYoutubeTrackListResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureTutorialYoutubeTrackListRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            const requestIdInput =
              requestInput !== null &&
              typeof requestInput === 'object' &&
              !Array.isArray(requestInput)
                ? (requestInput as Record<string, unknown>)['requestId']
                : null;
            const parsedRequestId = z.uuid().safeParse(requestIdInput);
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'youtube_track_list_invalid',
                    requestId: parsedRequestId.success ? parsedRequestId.data : null,
                    message:
                      'YouTube caption track list request violates the strict public contract',
                    retryMode: 'never',
                  }),
                },
              ],
            };
          }
          try {
            const result = await procedureTutorialYoutubeImportCoordinator!.listTracks(
              parsedRequest.data,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: result.formatVersion,
                    videoId: result.videoId,
                    trackCount: result.tracks.length,
                    message: 'The complete caption track list is in structuredContent.',
                  }),
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
                  text: JSON.stringify(
                    procedureTutorialYoutubeTrackListErrorResponse(
                      error,
                      parsedRequest.data.requestId,
                    ),
                  ),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.youtube.tracks.recommend',
        {
          description:
            'Deterministically rank one previously completed authorized YouTube caption-track list using explicit ordered language, track-kind, audio-track, draft, closed-caption, and synchronization preferences. This local advisory operation performs no network request, spends no additional API quota, downloads no caption or video content, calls no model, and never selects a track. Present the ranked and excluded tracks to the user, then require an explicit caption-track id in a later import request.',
          inputSchema: deferMcpInputValidation(
            procedureTutorialYoutubeTrackRecommendationRequestSchema,
          ),
          outputSchema: procedureTutorialYoutubeTrackRecommendationResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureTutorialYoutubeTrackRecommendationRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            const requestIdInput =
              requestInput !== null &&
              typeof requestInput === 'object' &&
              !Array.isArray(requestInput)
                ? (requestInput as Record<string, unknown>)['requestId']
                : null;
            const parsedRequestId = z.uuid().safeParse(requestIdInput);
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'youtube_track_recommendation_invalid',
                    requestId: parsedRequestId.success ? parsedRequestId.data : null,
                    message:
                      'YouTube caption track recommendation request violates the strict public contract',
                    retryMode: 'never',
                  }),
                },
              ],
            };
          }
          try {
            const source = procedureTutorialYoutubeImportCoordinator!.completedTrackList(
              parsedRequest.data.trackListRequestId,
            );
            const result = recommendProcedureTutorialYoutubeCaptionTracks(
              parsedRequest.data,
              source,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: result.formatVersion,
                    videoId: result.sourceTrackList.videoId,
                    recommendedCaptionTrackId: result.recommendedCaptionTrackId,
                    candidateCount: result.rankedCandidates.length,
                    excludedCount: result.excludedTracks.length,
                    selectionRequired: true,
                    message:
                      'The complete local ranking is in structuredContent; no caption track was selected.',
                  }),
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
                  text: JSON.stringify(
                    procedureTutorialYoutubeTrackRecommendationErrorResponse(
                      error,
                      parsedRequest.data.requestId,
                    ),
                  ),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.youtube.import',
        {
          description:
            'Explicitly use a configured OAuth-authorized YouTube Data API source to read video metadata, verify one exact caption track belongs to that video, and download it as SRT or WebVTT before returning a document-bound Procedure authoring packet. The authorized account must be able to edit the video; the call consumes YouTube API quota but never downloads video media, calls a model, stores a tree, creates a Proposal, or executes the host. OAuth credentials are runtime-managed and must never be included in this request.',
          inputSchema: deferMcpInputValidation(procedureTutorialYoutubeImportRequestSchema),
          outputSchema: procedureAuthoringPromptPacketSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTutorialYoutubeImportRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            const requestIdInput =
              requestInput !== null &&
              typeof requestInput === 'object' &&
              !Array.isArray(requestInput)
                ? (requestInput as Record<string, unknown>)['requestId']
                : null;
            const parsedRequestId = z.uuid().safeParse(requestIdInput);
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'youtube_packet_invalid',
                    requestId: parsedRequestId.success ? parsedRequestId.data : null,
                    message: 'YouTube caption import request violates the strict public contract',
                    retryMode: 'never',
                  }),
                },
              ],
            };
          }
          try {
            const packet = await procedureTutorialYoutubeImportCoordinator!.importCaption(
              parsedRequest.data,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: packet.formatVersion,
                    packetContentSha256: packet.integrity.contentSha256,
                    message: 'The complete authoring packet is in structuredContent.',
                  }),
                },
              ],
              structuredContent: packet,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    procedureTutorialYoutubeImportErrorResponse(
                      error,
                      parsedRequest.data.requestId,
                    ),
                  ),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.generate',
        {
          description:
            'Explicitly parse one user-provided WebVTT or SRT caption document into a document-bound Procedure authoring packet, then invoke one configured Procedure authoring provider. This may transmit normalized caption text and task data or incur provider cost according to the selected provider disclosure. The candidate is immediately validated and compiled, but is not stored, proposed, accepted, or executed; no video or caption URL is fetched.',
          inputSchema: procedureTutorialTranscriptGenerateRequestSchema,
          outputSchema: procedureAuthoringGenerationResultSchema,
        },
        async (requestInput) => {
          const request = procedureTutorialTranscriptGenerateRequestSchema.parse(requestInput);
          try {
            const result =
              await procedureAuthoringGenerationCoordinator!.generateTutorialTranscript(request);
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
        'operatingline.procedure.prompt.get',
        {
          description:
            'Build a deterministic, provider-neutral authoring packet for one natural-language goal and, optionally, a rights-declared HTTPS tutorial with ordered user-supplied transcript segments. It pins exact catalogs and provenance, requires a candidate-only ProcedureTree with unavailable interaction tracks, and does not download or transcribe video, call a model, store a tree, create a Proposal, or execute host work.',
          inputSchema: deferMcpInputValidation(procedureAuthoringPromptRequestSchema),
          outputSchema: procedureAuthoringPromptPacketSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureAuthoringPromptRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_authoring_prompt_request',
                    message:
                      'Procedure authoring prompt request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const packet = getProcedureAuthoringPrompt(parsedRequest.data);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: packet.formatVersion,
                    packetContentSha256: packet.integrity.contentSha256,
                    message: 'The complete authoring packet is in structuredContent.',
                  }),
                },
              ],
              structuredContent: packet,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_authoring_prompt_unavailable',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Procedure authoring prompt is unavailable',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.authoring.providers.list',
        {
          description:
            'List explicitly configured planner providers that support ProcedureTree authoring, including availability, concurrency, data-transmission, and credential-management disclosures. The list never contains credentials.',
          inputSchema: z.strictObject({}),
          outputSchema: plannerProviderListSchema,
        },
        async () => {
          const providerList = plannerProviderRegistry.listProcedureAuthors();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(providerList) }],
            structuredContent: providerList,
          };
        },
      );

      server.registerTool(
        'operatingline.procedure.authoring.generate',
        {
          description:
            'Explicitly invoke one configured Procedure authoring provider with the exact catalog- and provenance-bound packet, including supplied tutorial transcript segments when present. This may transmit task data or incur provider cost according to the selected provider disclosure. The returned candidate is immediately validated and compiled, but is not stored, proposed, accepted, or executed.',
          inputSchema: procedureAuthoringGenerateRequestSchema,
          outputSchema: procedureAuthoringGenerationResultSchema,
        },
        async (requestInput) => {
          const request = procedureAuthoringGenerateRequestSchema.parse(requestInput);
          try {
            const result = await procedureAuthoringGenerationCoordinator!.generate(request);
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
        'operatingline.procedure.authoring.validate',
        {
          description:
            'Validate a ProcedureTree candidate against the exact authoring packet, installed catalog snapshots, candidate-only trust boundary, and existing compilation rules. This does not store, propose, accept, or execute anything.',
          inputSchema: deferMcpInputValidation(procedureAuthoringValidationRequestSchema),
          outputSchema: procedureAuthoringValidationResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureAuthoringValidationRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_authoring_validation_request',
                    message:
                      'Procedure authoring validation request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = validateProcedureAuthoring(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_authoring_validation_failed',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Procedure authoring validation failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.authoring.materialize',
        {
          description:
            'Revalidate a candidate against its exact authoring packet, then deterministically materialize only InteractionCatalog-declared tracks. Catalog-grounded menu paths, ordered teaching controls, and explicitly candidate-only shortcut projections may become available; none proves host-state equivalence, and undeclared shortcuts or MCP tracks remain unavailable. This does not store, propose, accept, or execute anything.',
          inputSchema: deferMcpInputValidation(procedureAuthoringMaterializationRequestSchema),
          outputSchema: procedureAuthoringMaterializationResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureAuthoringMaterializationRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_authoring_materialization_request',
                    message:
                      'Procedure authoring materialization request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = materializeProcedureAuthoring(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_authoring_materialization_failed',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Procedure authoring materialization failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.replay.propose',
        {
          description:
            'Revalidate and materialize one bounded UV Sphere, Icosphere, Cube, Plane, Torus, Cone, or Cylinder leaf, create a human-reviewable instance-bound GuideProposal, and atomically store the complete replay binding. This does not accept or execute the proposal; menu and shortcut tracks remain unexecuted or explicitly unavailable provenance.',
          inputSchema: deferMcpInputValidation(procedureLeafReplayProposalRequestSchema),
          outputSchema: procedureLeafReplayProposalResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureLeafReplayProposalRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_leaf_replay_proposal_request',
                    message: 'Procedure leaf replay proposal violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = proposeProcedureLeafReplay(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_leaf_replay_proposal_failed',
                    message:
                      error instanceof Error ? error.message : 'Procedure leaf replay failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.replay.finalize',
        {
          description:
            'Append one managed-action replay attestation only after the exact proposal was accepted and a stored terminal Companion report proves its strong action-specific primitive success gate. It never upgrades menu or shortcut tracks to executed.',
          inputSchema: procedureLeafReplayFinalizeRequestSchema,
          outputSchema: procedureLeafReplayFinalizeResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureLeafReplayFinalizeRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_leaf_replay_finalize_request',
                    message:
                      'Procedure leaf replay finalization violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = finalizeProcedureLeafReplay(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_leaf_replay_finalize_failed',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Procedure leaf replay finalization failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.replay.failure-recovery.finalize',
        {
          description:
            'Append one mutually exclusive managed replay outcome attestation for either a successful automatic rollback after an Observation failure or a checkpointed blocked failure followed by a strong recovered Observation. It does not claim menu, shortcut, or action-level MCP execution.',
          inputSchema: deferMcpInputValidation(
            procedureLeafReplayFailureRecoveryFinalizeRequestSchema,
          ),
          outputSchema: procedureLeafReplayFailureRecoveryFinalizeResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureLeafReplayFailureRecoveryFinalizeRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_leaf_replay_failure_recovery_finalize_request',
                    message: 'Replay failure/recovery finalization violates the strict contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = finalizeProcedureLeafReplayFailureRecovery(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_leaf_replay_failure_recovery_finalize_failed',
                    message:
                      error instanceof ProcedureLeafReplayError
                        ? error.message
                        : 'Replay failure/recovery finalization failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.replay.current-state.request',
        {
          description:
            'Queue one read-only, nonce-bound current-state recheck for a finalized managed Procedure replay. The exact target Blender instance evaluates its present Observation and native Undo journal on the main thread; no scene action is executed.',
          inputSchema: procedureLeafReplayCurrentStateRequestSchema,
          outputSchema: procedureLeafReplayCurrentStateRequestResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureLeafReplayCurrentStateRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_leaf_replay_current_state_request',
                    message: 'Procedure replay current-state request violates the strict contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = procedureLeafReplayCurrentStateCoordinator.request(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_leaf_replay_current_state_request_failed',
                    message:
                      error instanceof ProcedureLeafReplayError
                        ? error.message
                        : 'Procedure replay current-state request failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.replay.current-state.get',
        {
          description:
            'Read a pending or completed nonce-bound managed Procedure replay current-state verification.',
          inputSchema: procedureLeafReplayCurrentStateStatusRequestSchema,
          outputSchema: procedureLeafReplayCurrentStateStatusResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureLeafReplayCurrentStateStatusRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_leaf_replay_current_state_status_request',
                    message: 'Procedure replay current-state status request is invalid',
                  }),
                },
              ],
            };
          }
          const result = procedureLeafReplayCurrentStateCoordinator.get(
            parsedRequest.data.verificationId,
          );
          if (result === null) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_leaf_replay_current_state_not_found',
                    message: 'Procedure replay current-state verification was not found',
                  }),
                },
              ],
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        },
      );

      server.registerTool(
        'operatingline.procedure.compile',
        {
          description:
            'Validate a source-grounded ProcedureTree, bind its exact installed ActionCatalog, and compile it into a GuidePlan without persisting, proposing, accepting, or executing anything. Interaction tracks receive structural validation only until a host-specific catalog verifier is registered.',
          inputSchema: deferMcpInputValidation(procedureCompilationRequestSchema),
          outputSchema: procedureCompilationResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureCompilationRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_compilation_request',
                    message: 'Procedure compilation request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = compileProcedure(parsedRequest.data);
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
                  text: JSON.stringify({
                    error: 'procedure_compilation_failed',
                    message: error instanceof Error ? error.message : 'Unknown compilation error',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.store',
        {
          description:
            'Validate and immutably store one ProcedureTree revision as a structural knowledge artifact. Duplicate identical revisions are idempotent; stale or conflicting revisions are rejected. Generic store does not retain MaterializationResult attestation, so a standalone stored tree cannot prove catalog grounding. This never proposes or executes Blender work.',
          inputSchema: deferMcpInputValidation(procedureTreeStoreRequestSchema),
          outputSchema: procedureTreeStoreResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTreeStoreRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_tree_store_request',
                    message: 'Procedure tree store request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = storeProcedureTree(parsedRequest.data);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            const revisionError = error instanceof ProcedureTreeRevisionError ? error : null;
            const validationError = error instanceof ProcedureTreeValidationError;
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error:
                      revisionError === null
                        ? validationError
                          ? 'procedure_tree_validation_failed'
                          : 'procedure_tree_storage_failed'
                        : `procedure_tree_revision_${revisionError.result}`,
                    message:
                      revisionError !== null || validationError
                        ? error instanceof Error
                          ? error.message
                          : 'Procedure tree validation failed'
                        : 'Procedure tree storage failed',
                    ...(revisionError === null
                      ? {}
                      : {
                          treeId: revisionError.treeId,
                          revision: revisionError.revision,
                          latestRevision: revisionError.latestRevision,
                        }),
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.get',
        {
          description:
            'Read one exact immutable ProcedureTree revision, or the latest revision when revision is omitted. This does not compile, propose, or execute it.',
          inputSchema: procedureTreeGetRequestSchema,
          outputSchema: storedProcedureTreeSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTreeGetRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_tree_get_request',
                    message: 'Procedure tree get request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = getProcedureTree(parsedRequest.data);
            if (result === null) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: 'procedure_tree_not_found',
                      treeId: parsedRequest.data.treeId,
                      revision: parsedRequest.data.revision ?? null,
                    }),
                  },
                ],
              };
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_tree_read_failed',
                    message: 'Procedure tree read failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.list',
        {
          description:
            'List immutable ProcedureTree revision summaries in stable storage order with bounded cursor pagination. Tree payloads are omitted.',
          inputSchema: procedureTreeListRequestSchema,
          outputSchema: procedureTreeListResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTreeListRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_tree_list_request',
                    message: 'Procedure tree list request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = listProcedureTrees(parsedRequest.data);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_tree_list_failed',
                    message: 'Procedure tree list failed',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.search',
        {
          description:
            'Search immutable ProcedureTree operations using exact structured selectors for semantic actions, ActionCatalog actions, menu targets and paths, shortcut keys and operator-property surface context, MCP tools, validation state, and revision provenance. Returns no similarity score and never executes host work.',
          inputSchema: deferMcpInputValidation(procedureOperationSearchRequestSchema),
          outputSchema: procedureOperationSearchResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureOperationSearchRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_procedure_operation_search_request',
                    message:
                      'Procedure operation search request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const result = searchProcedureOperations(parsedRequest.data);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            app?.log.error(error, 'Procedure operation search failed');
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'procedure_operation_search_failed',
                    message: 'Procedure operation search failed',
                  }),
                },
              ],
            };
          }
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

      server.registerTool(
        'operatingline.goal.requests.list',
        {
          description:
            'List pending immutable host-authored goal requests that do not yet have a linked Proposal.',
          inputSchema: guideGoalRequestListSchema,
        },
        async (requestInput) => {
          const request = guideGoalRequestListSchema.parse(requestInput);
          const requests = database
            .listPendingGuideGoalRequests(request.targetAdapterId, request.limit ?? 20)
            .map((item) => guideGoalRequestSchema.parse(item));
          return { content: [{ type: 'text', text: JSON.stringify({ requests }) }] };
        },
      );

      server.registerTool(
        'operatingline.goal.prompt.get',
        {
          description:
            "Build the exact deterministic Planner Prompt Packet from one pending stored host goal request and its pinned ActionCatalog. Add the same requestId as goalRequestId to the packet's complete draft when calling operatingline.guide.propose. This never calls a Provider.",
          inputSchema: guideGoalPromptRequestSchema,
        },
        async (requestInput) => {
          const request = guideGoalPromptRequestSchema.parse(requestInput);
          try {
            const packet = getGuideGoalPrompt(request);
            return { content: [{ type: 'text', text: JSON.stringify(packet) }] };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'goal_prompt_unavailable',
                    requestId: request.requestId,
                    message: error instanceof Error ? error.message : 'Unknown goal prompt error',
                  }),
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
        'operatingline.replan.branches.list',
        {
          description:
            'List durable revision branch heads for one exact host instance and Plan id.',
          inputSchema: guideRevisionBranchListRequestSchema,
        },
        async (requestInput) => {
          const request = guideRevisionBranchListRequestSchema.parse(requestInput);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(createGuideRevisionBranchList(database, request)),
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
            'Validate and submit an AI-authored guide plan for in-host human review. For a stored host goal, submit the complete Planner draft unchanged plus goalRequestId; adapter, catalog, plan, and goal evidence must match the immutable request. The proposal cannot execute until the target companion accepts it.',
          inputSchema: guideProposalSubmissionSchema,
        },
        async (submissionInput) => {
          const submission = guideProposalSubmissionSchema.parse(submissionInput);
          try {
            const goalRequest =
              submission.goalRequestId === undefined
                ? null
                : getGuideGoalRequest(submission.goalRequestId);
            if (goalRequest !== null) {
              if (database.getGuideGoalProposalForRequest(goalRequest.requestId) !== null) {
                throw new Error(
                  `Guide goal request already has a proposal: ${goalRequest.requestId}`,
                );
              }
              if (submission.plan.id !== goalRequest.planId) {
                throw new Error(
                  `Guide plan id ${submission.plan.id} does not match requested ${goalRequest.planId}`,
                );
              }
              if (submission.targetAdapterId !== goalRequest.adapterId) {
                throw new Error(
                  `Proposal adapter ${submission.targetAdapterId} does not match requested ${goalRequest.adapterId}`,
                );
              }
              if (submission.catalogVersion !== goalRequest.catalogVersion) {
                throw new Error(
                  `Proposal catalog ${submission.catalogVersion} does not match requested ${goalRequest.catalogVersion}`,
                );
              }
              if (submission.planning?.goal !== goalRequest.goal) {
                throw new Error('Planning evidence goal does not match the stored goal request');
              }
            }
            const { proposal, planningQuality } = createProposal({
              targetAdapterId: goalRequest?.adapterId ?? submission.targetAdapterId,
              ...(goalRequest === null
                ? submission.catalogVersion === undefined
                  ? {}
                  : { catalogVersion: submission.catalogVersion }
                : {
                    targetInstanceId: goalRequest.instanceId,
                    catalogVersion: goalRequest.catalogVersion,
                    goalRequestId: goalRequest.requestId,
                  }),
              plan: submission.plan,
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
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'guide_proposal_rejected',
                    goalRequestId: submission.goalRequestId ?? null,
                    message: error instanceof Error ? error.message : 'Unknown proposal error',
                  }),
                },
              ],
            };
          }
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
    runtimeApp.post('/api/v1/companion/session', async (request, reply) => {
      const parsedRequest = companionSessionHelloRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_companion_session',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        const catalog = actionCatalogRegistry.get({
          targetAdapterId: parsedRequest.data.adapterId,
          catalogVersion: parsedRequest.data.catalogVersion,
        });
        return companionLeaseManager.establish(parsedRequest.data, catalog);
      } catch (error) {
        if (error instanceof CompanionLeaseError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.code(422).send({
          error: 'companion_session_rejected',
          message: error instanceof Error ? error.message : 'Companion session was rejected',
        });
      }
    });
    runtimeApp.post('/api/v1/companion/heartbeat', async (request, reply) => {
      const parsedRequest = companionHeartbeatRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_companion_heartbeat',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return companionLeaseManager.heartbeat(parsedRequest.data);
      } catch (error) {
        if (error instanceof CompanionLeaseError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    });
    runtimeApp.post('/api/v1/companion/goal-request', async (request, reply) => {
      const parsedRequest = guideGoalRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_goal_request', issues: parsedRequest.error.issues });
      }
      try {
        actionCatalogRegistry.get({
          targetAdapterId: parsedRequest.data.adapterId,
          catalogVersion: parsedRequest.data.catalogVersion,
        });
      } catch (error) {
        return reply.code(422).send({
          error: 'invalid_goal_request',
          message: error instanceof Error ? error.message : 'Unknown goal request error',
        });
      }
      const result = database.recordGuideGoalRequest(parsedRequest.data);
      if (result === 'conflict') {
        return reply.code(409).send({ result, requestId: parsedRequest.data.requestId });
      }
      return guideGoalRequestAcknowledgementSchema.parse({
        result,
        requestId: parsedRequest.data.requestId,
      });
    });
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
    runtimeApp.post('/api/v1/procedure/prompt', async (request, reply) => {
      const parsedRequest = procedureAuthoringPromptRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_authoring_prompt_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return getProcedureAuthoringPrompt(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'procedure_authoring_prompt_unavailable',
          message:
            error instanceof Error ? error.message : 'Procedure authoring prompt is unavailable',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/import', async (request, reply) => {
      const parsedRequest = procedureTutorialTranscriptImportRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_transcript_import_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return importProcedureTutorialTranscript(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'procedure_tutorial_transcript_import_failed',
          message:
            error instanceof Error ? error.message : 'Procedure tutorial transcript import failed',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/youtube/tracks', async (request, reply) => {
      const parsedRequest = procedureTutorialYoutubeTrackListRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        const requestIdInput =
          request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)['requestId']
            : null;
        const parsedRequestId = z.uuid().safeParse(requestIdInput);
        return reply.code(400).send({
          error: 'youtube_track_list_invalid',
          requestId: parsedRequestId.success ? parsedRequestId.data : null,
          message: 'YouTube caption track list request violates the strict public contract',
          retryMode: 'never',
        });
      }
      try {
        return await procedureTutorialYoutubeImportCoordinator!.listTracks(parsedRequest.data);
      } catch (error) {
        return reply
          .code(procedureTutorialYoutubeTrackListHttpStatus(error))
          .send(
            procedureTutorialYoutubeTrackListErrorResponse(error, parsedRequest.data.requestId),
          );
      }
    });
    runtimeApp.post(
      '/api/v1/procedure/tutorial/youtube/tracks/recommend',
      async (request, reply) => {
        const parsedRequest = procedureTutorialYoutubeTrackRecommendationRequestSchema.safeParse(
          request.body,
        );
        if (!parsedRequest.success) {
          const requestIdInput =
            request.body !== null &&
            typeof request.body === 'object' &&
            !Array.isArray(request.body)
              ? (request.body as Record<string, unknown>)['requestId']
              : null;
          const parsedRequestId = z.uuid().safeParse(requestIdInput);
          return reply.code(400).send({
            error: 'youtube_track_recommendation_invalid',
            requestId: parsedRequestId.success ? parsedRequestId.data : null,
            message:
              'YouTube caption track recommendation request violates the strict public contract',
            retryMode: 'never',
          });
        }
        try {
          const source = procedureTutorialYoutubeImportCoordinator!.completedTrackList(
            parsedRequest.data.trackListRequestId,
          );
          return recommendProcedureTutorialYoutubeCaptionTracks(parsedRequest.data, source);
        } catch (error) {
          return reply
            .code(procedureTutorialYoutubeTrackRecommendationHttpStatus(error))
            .send(
              procedureTutorialYoutubeTrackRecommendationErrorResponse(
                error,
                parsedRequest.data.requestId,
              ),
            );
        }
      },
    );
    runtimeApp.post('/api/v1/procedure/tutorial/youtube/import', async (request, reply) => {
      const parsedRequest = procedureTutorialYoutubeImportRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        const requestIdInput =
          request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)['requestId']
            : null;
        const parsedRequestId = z.uuid().safeParse(requestIdInput);
        return reply.code(400).send({
          error: 'youtube_packet_invalid',
          requestId: parsedRequestId.success ? parsedRequestId.data : null,
          message: 'YouTube caption import request violates the strict public contract',
          retryMode: 'never',
        });
      }
      try {
        return await procedureTutorialYoutubeImportCoordinator!.importCaption(parsedRequest.data);
      } catch (error) {
        return reply
          .code(procedureTutorialYoutubeImportHttpStatus(error))
          .send(procedureTutorialYoutubeImportErrorResponse(error, parsedRequest.data.requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/generate', async (request, reply) => {
      const parsedRequest = procedureTutorialTranscriptGenerateRequestSchema.safeParse(
        request.body,
      );
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
            message:
              'Procedure tutorial transcript generation request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return await procedureAuthoringGenerationCoordinator!.generateTutorialTranscript(
          parsedRequest.data,
        );
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
      }
    });
    runtimeApp.get('/api/v1/procedure/authoring/providers', async () =>
      plannerProviderRegistry.listProcedureAuthors(),
    );
    runtimeApp.post('/api/v1/procedure/authoring/generate', async (request, reply) => {
      const parsedRequest = procedureAuthoringGenerateRequestSchema.safeParse(request.body);
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
            message: 'Procedure authoring generation request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return await procedureAuthoringGenerationCoordinator!.generate(parsedRequest.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/authoring/validate', async (request, reply) => {
      const parsedRequest = procedureAuthoringValidationRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_authoring_validation_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return validateProcedureAuthoring(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'procedure_authoring_validation_failed',
          message: error instanceof Error ? error.message : 'Procedure authoring validation failed',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/authoring/materialize', async (request, reply) => {
      const parsedRequest = procedureAuthoringMaterializationRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_authoring_materialization_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return materializeProcedureAuthoring(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'procedure_authoring_materialization_failed',
          message:
            error instanceof Error ? error.message : 'Procedure authoring materialization failed',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/replay/propose', async (request, reply) => {
      const parsedRequest = procedureLeafReplayProposalRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_leaf_replay_proposal_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return proposeProcedureLeafReplay(parsedRequest.data);
      } catch (error) {
        const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 422;
        return reply.code(statusCode).send({
          error: 'procedure_leaf_replay_proposal_failed',
          message: error instanceof Error ? error.message : 'Procedure leaf replay proposal failed',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/replay/finalize', async (request, reply) => {
      const parsedRequest = procedureLeafReplayFinalizeRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_leaf_replay_finalize_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return finalizeProcedureLeafReplay(parsedRequest.data);
      } catch (error) {
        const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 422;
        return reply.code(statusCode).send({
          error: 'procedure_leaf_replay_finalize_failed',
          message:
            error instanceof Error ? error.message : 'Procedure leaf replay finalization failed',
        });
      }
    });
    runtimeApp.post(
      '/api/v1/procedure/replay/failure-recovery/finalize',
      async (request, reply) => {
        const parsedRequest = procedureLeafReplayFailureRecoveryFinalizeRequestSchema.safeParse(
          request.body,
        );
        if (!parsedRequest.success) {
          return reply.code(400).send({
            error: 'invalid_procedure_leaf_replay_failure_recovery_finalize_request',
            issues: parsedRequest.error.issues,
          });
        }
        try {
          return finalizeProcedureLeafReplayFailureRecovery(parsedRequest.data);
        } catch (error) {
          const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 500;
          return reply.code(statusCode).send({
            error: 'procedure_leaf_replay_failure_recovery_finalize_failed',
            message:
              error instanceof ProcedureLeafReplayError
                ? error.message
                : 'Replay failure/recovery finalization failed',
          });
        }
      },
    );
    runtimeApp.post('/api/v1/procedure/replay/current-state/request', async (request, reply) => {
      const parsedRequest = procedureLeafReplayCurrentStateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_leaf_replay_current_state_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return procedureLeafReplayCurrentStateCoordinator.request(parsedRequest.data);
      } catch (error) {
        const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 500;
        return reply.code(statusCode).send({
          error: 'procedure_leaf_replay_current_state_request_failed',
          message:
            error instanceof ProcedureLeafReplayError
              ? error.message
              : 'Procedure replay current-state request failed',
        });
      }
    });
    runtimeApp.get('/api/v1/procedure/replay/current-state', async (request, reply) => {
      const parsedRequest = procedureLeafReplayCurrentStateStatusRequestSchema.safeParse(
        request.query,
      );
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_leaf_replay_current_state_status_request',
          issues: parsedRequest.error.issues,
        });
      }
      const result = procedureLeafReplayCurrentStateCoordinator.get(
        parsedRequest.data.verificationId,
      );
      return result === null
        ? reply.code(404).send({
            error: 'procedure_leaf_replay_current_state_not_found',
            message: 'Procedure replay current-state verification was not found',
          })
        : result;
    });
    runtimeApp.post('/api/v1/procedure/compile', async (request, reply) => {
      const parsedRequest = procedureCompilationRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_compilation_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return compileProcedure(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'procedure_compilation_failed',
          message: error instanceof Error ? error.message : 'Unknown compilation error',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/store', async (request, reply) => {
      const parsedRequest = procedureTreeStoreRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tree_store_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return storeProcedureTree(parsedRequest.data);
      } catch (error) {
        if (error instanceof ProcedureTreeRevisionError) {
          return reply.code(409).send({
            error: `procedure_tree_revision_${error.result}`,
            result: error.result,
            treeId: error.treeId,
            revision: error.revision,
            latestRevision: error.latestRevision,
            message: error.message,
          });
        }
        if (error instanceof ProcedureTreeValidationError) {
          return reply.code(422).send({
            error: 'procedure_tree_validation_failed',
            message: error.message,
          });
        }
        request.log.error(error, 'Procedure tree storage failed');
        return reply.code(500).send({
          error: 'procedure_tree_storage_failed',
          message: 'Procedure tree storage failed',
        });
      }
    });
    runtimeApp.get('/api/v1/procedure', async (request, reply) => {
      const parsedRequest = procedureTreeGetHttpQuerySchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tree_get_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        const result = getProcedureTree(parsedRequest.data);
        if (result === null) {
          return reply.code(404).send({
            error: 'procedure_tree_not_found',
            treeId: parsedRequest.data.treeId,
            revision: parsedRequest.data.revision ?? null,
          });
        }
        return result;
      } catch (error) {
        request.log.error(error, 'Procedure tree read failed');
        return reply.code(500).send({
          error: 'procedure_tree_read_failed',
          message: 'Procedure tree read failed',
        });
      }
    });
    runtimeApp.get('/api/v1/procedures', async (request, reply) => {
      const parsedRequest = procedureTreeListHttpQuerySchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tree_list_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return listProcedureTrees(parsedRequest.data);
      } catch (error) {
        request.log.error(error, 'Procedure tree list failed');
        return reply.code(500).send({
          error: 'procedure_tree_list_failed',
          message: 'Procedure tree list failed',
        });
      }
    });
    runtimeApp.post('/api/v1/procedure/search', async (request, reply) => {
      const parsedRequest = procedureOperationSearchRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_operation_search_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return searchProcedureOperations(parsedRequest.data);
      } catch (error) {
        request.log.error(error, 'Procedure operation search failed');
        return reply.code(500).send({
          error: 'procedure_operation_search_failed',
          message: 'Procedure operation search failed',
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
    runtimeApp.get('/api/v1/dialogue/providers', async () =>
      plannerProviderRegistry.listDialogueReplanners(),
    );
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
    runtimeApp.post('/api/v1/companion/initial-plan-run', async (request, reply) => {
      const parsedRequest = companionInitialPlanRunCreateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion initial plan run authorization violates the strict public contract',
        });
      }
      try {
        const run = companionInitialPlanRunCoordinator!.create(parsedRequest.data);
        return reply.code(202).send(run);
      } catch (error) {
        if (error instanceof CompanionInitialPlanRunRequestError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        return reply.code(500).send({
          error: 'initial_plan_run_failed',
          message: 'The initial plan run could not be safely authorized',
        });
      }
    });
    runtimeApp.get('/api/v1/companion/initial-plan-run', async (request, reply) => {
      const parsedRequest = companionInitialPlanRunStatusRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion initial plan run status request violates the strict public contract',
        });
      }
      try {
        const run = companionInitialPlanRunCoordinator!.get(parsedRequest.data.generationRequestId);
        return run === null
          ? reply.code(404).send({
              error: 'initial_plan_run_not_found',
              message: 'The requested companion initial plan run was not found',
            })
          : run;
      } catch {
        return reply.code(500).send({
          error: 'initial_plan_run_unavailable',
          message: 'The initial plan run status could not be read safely',
        });
      }
    });
    runtimeApp.post('/api/v1/companion/dialogue-run', async (request, reply) => {
      const parsedRequest = companionDialogueRunCreateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion dialogue authorization violates the strict public contract',
        });
      }
      try {
        const run = companionDialogueRunCoordinator!.create(parsedRequest.data);
        return reply.code(202).send(run);
      } catch (error) {
        if (error instanceof CompanionDialogueRunRequestError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        return reply.code(500).send({
          error: 'dialogue_run_failed',
          message: 'The dialogue run could not be safely authorized',
        });
      }
    });
    runtimeApp.get('/api/v1/companion/dialogue-run', async (request, reply) => {
      const parsedRequest = companionDialogueRunStatusRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Companion dialogue status request violates the strict public contract',
        });
      }
      try {
        const run = companionDialogueRunCoordinator!.get(parsedRequest.data.dialogueRequestId);
        return run === null
          ? reply.code(404).send({
              error: 'dialogue_run_not_found',
              message: 'The requested companion dialogue run was not found',
            })
          : run;
      } catch {
        return reply.code(500).send({
          error: 'dialogue_run_unavailable',
          message: 'The dialogue run status could not be read safely',
        });
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
    runtimeApp.get('/api/v1/replan/branches', async (request, reply) => {
      const parsedRequest = guideRevisionBranchListRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }
      try {
        return createGuideRevisionBranchList(database, parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'revision_branch_list_invalid',
          message: error instanceof Error ? error.message : 'Unknown revision branch error',
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

      const {
        adapterId,
        instanceId,
        knownPlanId,
        knownRevision,
        knownPlanContentSha256,
        knownProposalId,
      } = parsedRequest.data;
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      let replayCurrentStateAuthorized = false;
      if (leaseHeader !== undefined) {
        if (typeof leaseHeader !== 'string') {
          return reply.code(400).send({ error: 'invalid_companion_lease' });
        }
        try {
          const session = companionLeaseManager.authorize(leaseHeader, adapterId, instanceId);
          replayCurrentStateAuthorized = session.lease.negotiatedGuideProtocolVersion === '1.5.0';
        } catch (error) {
          if (error instanceof CompanionLeaseError) {
            return reply.code(error.statusCode).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      } else {
        try {
          companionLeaseManager.authorizeLegacy(adapterId, instanceId);
        } catch (error) {
          if (error instanceof CompanionLeaseError) {
            return reply.code(error.statusCode).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      }
      const planAdapterId = activePlan?.steps.find((step) => step.action !== null)?.action
        ?.adapterId;
      const activePlanContentSha256 =
        activePlan === null ? null : computePlanContentSha256(activePlan);
      const callerHasActiveRevision =
        activePlan !== null &&
        knownPlanId === activePlan.id &&
        knownRevision !== undefined &&
        (knownRevision > activePlan.revision ||
          (knownRevision === activePlan.revision &&
            knownPlanContentSha256 === activePlanContentSha256));
      const storedProposal = database.getPendingGuideProposal(adapterId, instanceId);
      const pendingProposal =
        storedProposal === null ? null : guideProposalSchema.parse(storedProposal);
      const callerHasPendingProposal = pendingProposal?.proposalId === knownProposalId;
      const replayCurrentStateRequest = replayCurrentStateAuthorized
        ? procedureLeafReplayCurrentStateCoordinator.pendingFor(adapterId, instanceId)
        : null;
      return companionGuideDeliverySchema.parse({
        protocolVersion: guideProtocolVersion,
        plan: planAdapterId === adapterId && !callerHasActiveRevision ? activePlan : null,
        planContentSha256:
          planAdapterId === adapterId && !callerHasActiveRevision ? activePlanContentSha256 : null,
        proposal: callerHasPendingProposal ? null : pendingProposal,
        proposalPlanContentSha256:
          callerHasPendingProposal || pendingProposal === null
            ? null
            : computePlanContentSha256(pendingProposal.plan),
        ...(replayCurrentStateRequest === null
          ? {}
          : { procedureReplayCurrentStateRequest: replayCurrentStateRequest }),
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
        guideRevisionRequestService.validate(parsedRequest.data);
      } catch (error) {
        return reply.code(422).send({
          error: 'invalid_revision_request',
          message: error instanceof Error ? error.message : 'Unknown revision request error',
        });
      }
      const result = guideRevisionRequestService.record(parsedRequest.data);
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
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      const replayProposalReceipt = database.getManagedReplayReceipt(
        'replay_proposal',
        parsedDecision.data.proposalId,
      );
      if (leaseHeader === undefined && replayProposalReceipt !== null) {
        return reply.code(409).send({
          error: 'companion_lease_required',
          message: 'Managed replay proposal decisions require a negotiated Companion lease',
        });
      }
      let authenticatedSessionProvenance: { sessionFingerprintSha256: string } | undefined;
      if (leaseHeader !== undefined) {
        if (typeof leaseHeader !== 'string') {
          return reply.code(400).send({ error: 'invalid_companion_lease' });
        }
        try {
          const session = companionLeaseManager.authorize(
            leaseHeader,
            parsedDecision.data.adapterId,
            parsedDecision.data.instanceId,
          );
          if (
            session.lease.negotiatedGuideProtocolVersion !== parsedDecision.data.protocolVersion
          ) {
            return reply.code(409).send({
              error: 'companion_session_identity_mismatch',
              message: 'Proposal decision protocol differs from its negotiated session',
            });
          }
          authenticatedSessionProvenance = {
            sessionFingerprintSha256: createHash('sha256').update(leaseHeader).digest('hex'),
          };
        } catch (error) {
          if (error instanceof CompanionLeaseError) {
            return reply.code(error.statusCode).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      }
      const result = database.recordGuideProposalDecision(
        parsedDecision.data,
        authenticatedSessionProvenance,
      );
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
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      let legacyReport = false;
      let authenticatedSessionProvenance: { sessionFingerprintSha256: string } | undefined;
      if (leaseHeader !== undefined) {
        if (typeof leaseHeader !== 'string') {
          return reply.code(400).send({ error: 'invalid_companion_lease' });
        }
        try {
          const session = companionLeaseManager.authorize(
            leaseHeader,
            parsedReport.data.adapterId,
            parsedReport.data.instanceId,
          );
          if (
            session.hello.companionVersion !== parsedReport.data.companionVersion ||
            session.hello.hostVersion !== parsedReport.data.hostVersion ||
            session.lease.negotiatedGuideProtocolVersion !== parsedReport.data.protocolVersion
          ) {
            return reply.code(409).send({
              error: 'companion_session_identity_mismatch',
              message: 'State report identity or protocol differs from its negotiated session',
            });
          }
          authenticatedSessionProvenance = {
            sessionFingerprintSha256: createHash('sha256').update(leaseHeader).digest('hex'),
          };
        } catch (error) {
          if (error instanceof CompanionLeaseError) {
            return reply.code(error.statusCode).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      } else {
        try {
          companionLeaseManager.authorizeLegacy(
            parsedReport.data.adapterId,
            parsedReport.data.instanceId,
          );
          legacyReport = true;
        } catch (error) {
          if (error instanceof CompanionLeaseError) {
            return reply.code(error.statusCode).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      }
      if (parsedReport.data.transition === 'current_state_rechecked') {
        if (authenticatedSessionProvenance === undefined) {
          return reply.code(409).send({
            error: 'companion_lease_required',
            message: 'Replay current-state responses require a negotiated Companion lease',
          });
        }
        try {
          procedureLeafReplayCurrentStateCoordinator.authorizeReport(parsedReport.data);
        } catch (error) {
          const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 409;
          return reply.code(statusCode).send({
            error: 'procedure_leaf_replay_current_state_response_rejected',
            message:
              error instanceof ProcedureLeafReplayError
                ? error.message
                : 'Procedure replay current-state response was rejected',
          });
        }
      }
      const result = database.recordCompanionState(
        parsedReport.data,
        authenticatedSessionProvenance,
      );
      if (result === 'conflict') {
        return reply.code(409).send({ result });
      }
      if (legacyReport && (result === 'accepted' || result === 'duplicate')) {
        companionLeaseManager.observeLegacy(
          parsedReport.data.adapterId,
          parsedReport.data.instanceId,
        );
      }
      if (
        parsedReport.data.transition === 'current_state_rechecked' &&
        (result === 'accepted' || result === 'duplicate')
      ) {
        const receipt = database.getManagedReplayReceipt(
          'companion_state_report',
          parsedReport.data.reportId,
        );
        if (receipt === null) {
          return reply.code(409).send({
            error: 'procedure_leaf_replay_current_state_receipt_missing',
            message: 'Replay current-state response lacks an authenticated server receipt',
          });
        }
        try {
          procedureLeafReplayCurrentStateCoordinator.complete(parsedReport.data, receipt);
        } catch (error) {
          const statusCode = error instanceof ProcedureLeafReplayError ? error.statusCode : 500;
          return reply.code(statusCode).send({
            error: 'procedure_leaf_replay_current_state_completion_failed',
            message:
              error instanceof ProcedureLeafReplayError
                ? error.message
                : 'Procedure replay current-state verification could not be stored',
          });
        }
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
        youtubeCaptionSource:
          options.youtubeCaptionSource === undefined
            ? null
            : { id: options.youtubeCaptionSource.id, available: true },
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
export { createInteractionCatalogRegistry } from './interaction-catalogs.js';
export {
  CompanionLeaseError,
  companionHeartbeatIntervalMs,
  companionLeaseTtlMs,
  createCompanionLeaseManager,
  type ActiveCompanionSession,
  type CompanionLeaseErrorCode,
  type CompanionLeaseManager,
  type CompanionLeaseManagerOptions,
} from './companion-leases.js';
export {
  canonicalizeEvalContent,
  computeEvalContentSha256,
  computePlanContentSha256,
} from './eval-export.js';
export { computeGuidePlanDiff } from './guide-plan-diff.js';
export {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from './guide-validation.js';
export {
  computeGuidePlanThreeWayMerge,
  createGuideRevisionBranchList,
  resolveGuideRevisionMergeContext,
  validateGuideRevisionOperation,
} from './guide-revision-branches.js';
export { operatingLineMcpInstructions } from './mcp-instructions.js';
export { createGuideRevisionThreadHistory } from './guide-revision-history.js';
export {
  createLocalReplanScope,
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
  normalizeLocalReplanRoots,
} from './local-replan-scope.js';
export { buildPlanningPromptPacket } from './planning-prompt.js';
export { materializeProcedureAuthoringCandidate } from './procedure-authoring-materialization.js';
export {
  createProcedureAuthoringGenerationCoordinator,
  procedureAuthoringGenerationEvidenceEventTypes,
  restoreProcedureAuthoringProviderInvocations,
} from './procedure-authoring-generation.js';
export {
  buildProcedureAuthoringPromptPacket,
  computeProcedureAuthoringPromptPacketContentSha256,
  procedureAuthoringPromptPacketContent,
  procedureAuthoringTutorialInputFromPacket,
  validateProcedureAuthoringCandidate,
  validateProcedureAuthoringPromptPacketIntegrity,
  type ProcedureAuthoringPromptPacketBuildOptions,
} from './procedure-authoring-prompt.js';
export {
  buildProcedureTutorialTranscriptPromptPacket,
  parseProcedureTutorialTranscriptImport,
  type ParsedProcedureTutorialTranscriptImport,
} from './procedure-tutorial-transcript-import.js';
export {
  buildProcedureTutorialYoutubePromptPacket,
  createProcedureTutorialYoutubeImportCoordinator,
  procedureTutorialYoutubeEvidenceEventTypes,
  procedureTutorialYoutubeImportErrorResponse,
  procedureTutorialYoutubeImportEvidenceEventTypes,
  procedureTutorialYoutubeImportHttpStatus,
  procedureTutorialYoutubeTrackListErrorResponse,
  procedureTutorialYoutubeTrackListEvidenceEventTypes,
  procedureTutorialYoutubeTrackListHttpStatus,
  restoreProcedureTutorialYoutubeImports,
  restoreProcedureTutorialYoutubeTrackLists,
  ProcedureTutorialYoutubeImportError,
  ProcedureTutorialYoutubeTrackListError,
  type ProcedureTutorialYoutubeImportCoordinator,
  type ProcedureTutorialYoutubeImportCoordinatorOptions,
  type ProcedureTutorialYoutubeImportRetryMode,
  type ProcedureTutorialYoutubeRetryMode,
  type ProcedureTutorialYoutubeTrackListRetryMode,
} from './procedure-tutorial-youtube-import.js';
export {
  ProcedureTutorialYoutubeTrackRecommendationError,
  procedureTutorialYoutubeTrackRecommendationErrorResponse,
  procedureTutorialYoutubeTrackRecommendationHttpStatus,
  recommendProcedureTutorialYoutubeCaptionTracks,
  type ProcedureTutorialYoutubeTrackRecommendationRetryMode,
} from './procedure-tutorial-youtube-track-recommendation.js';
export {
  createYouTubeDataApiCaptionSource,
  parseYouTubeDurationMs,
  ProcedureTutorialYoutubeSourceError,
  type ProcedureTutorialYoutubeCaptionAcquisitionResult,
  type ProcedureTutorialYoutubeCaptionSource,
  type ProcedureTutorialYoutubeCaptionTrackListSourceResult,
  type ProcedureTutorialYoutubeSourceErrorCode,
  type YouTubeDataApiCaptionSourceOptions,
} from './youtube-caption-source.js';
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
export {
  isStableVersionRangeSubset,
  satisfiesStableVersionRange,
} from './stable-version-ranges.js';
