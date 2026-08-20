import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import {
  openOperatingLineDatabase,
  type ExecutionEventInput,
  type StoredProcedureOperationIndex as DatabaseStoredProcedureOperationIndex,
  type StoredProcedureTreeRecord as DatabaseStoredProcedureTreeRecord,
  type StoredProcedureTreeSummary as DatabaseStoredProcedureTreeSummary,
} from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  actionCatalogRequestSchema,
  adapterStatusSchema,
  companionActionExecutionCreateRequestSchema,
  companionActionExecutionResultSchema,
  companionActionExecutionStatusRequestSchema,
  companionActionExecutionStatusSchema,
  companionActionPollDeliverySchema,
  companionActionPollRequestSchema,
  companionActionResultAckSchema,
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
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaCapabilitiesSchema,
  procedureTutorialMediaJobStatusRequestSchema,
  procedureTutorialMediaJobStatusSchema,
  procedureTutorialMediaResumeRequestSchema,
  procedureTutorialAuthoringResumeRequestSchema,
  procedureTutorialAuthoringReviewRequestSchema,
  procedureTutorialAuthoringRunCreateRequestSchema,
  procedureTutorialAuthoringRunStatusRequestSchema,
  procedureTutorialAuthoringRunStatusSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
  procedureTutorialYoutubeTrackRecommendationResultSchema,
  procedureTutorialYoutubeTrackSelectionRequestSchema,
  procedureTutorialYoutubeTrackSelectionResultSchema,
  procedureAuthoringValidationRequestSchema,
  procedureAuthoringValidationResultSchema,
  procedureOperationSearchHitSchema,
  procedureOperationSearchRequestSchema,
  procedureOperationSearchResultSchema,
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalResultSchema,
  procedureRefinementCreateRequestSchema,
  procedureRefinementProviderDisclosureListSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementReviewedEventSchema,
  procedureRefinementRunStatusRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureRefinementSemanticContextReceiptRequestSchema,
  procedureLeafReplayActionNameSchema,
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
  procedureTreeEditorBranchCreateRequestSchema,
  procedureTreeEditorBranchGetRequestSchema,
  procedureTreeEditorBranchHistoryRequestSchema,
  procedureTreeEditorBranchListRequestSchema,
  procedureTreeEditorCommentCreateRequestSchema,
  procedureTreeEditorCommentListRequestSchema,
  procedureTreeEditorCommitRequestSchema,
  procedureTreeEditorEditPreviewRequestSchema,
  procedureTreeEditorMergePreviewRequestSchema,
  procedureTreeEditorParameterFormRequestSchema,
  procedureTreeEditorWorkspaceRequestSchema,
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
  type CompanionActionExecutionCreateRequest,
  type CompanionActionExecutionResult,
  type CompanionActionExecutionStatus,
  type CompanionStateReport,
  type GuidePlan,
  type GuideGoalRequest,
  type GuideProposal,
  type InteractionCatalog,
  type PlanningIntent,
  type PlanningQualityReport,
  type ProcedureLeafReplayBinding,
  type ProcedureTutorialAuthoringBinding,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { createActionCatalogRegistry } from './action-catalogs.js';
import {
  BlenderActionExecutionError,
  createBlenderActionExecutionCoordinator,
} from './blender-action-execution.js';
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
import {
  materializeProcedureAuthoringCandidate,
  validateProcedureTreeParameterProjectionCatalog,
} from './procedure-authoring-materialization.js';
import {
  createProcedureAuthoringGenerationCoordinator,
  procedureAuthoringGenerationEvidenceEventTypes,
  restoreProcedureAuthoringProviderInvocations,
  type ProcedureAuthoringGenerationCoordinator,
} from './procedure-authoring-generation.js';
import {
  createProcedureSemanticRetrievalCoordinator,
  procedureSemanticRetrievalEvidenceEventTypes,
  restoreProcedureSemanticRetrievalInvocations,
  type ProcedureSemanticRetrievalCoordinator,
} from './procedure-semantic-retrieval.js';
import {
  createProcedureTreeEditorCoordinator,
  ProcedureTreeEditorError,
} from './procedure-tree-editor-coordinator.js';
import { resolveProcedureTreeEditorUiAsset } from './procedure-tree-editor-ui.js';
import {
  createProcedureRefinementCoordinator,
  procedureRefinementEvidenceEventTypes,
  restoreProcedureRefinementProviderInvocations,
  type ProcedureRefinementCoordinator,
} from './procedure-refinement-run.js';
import {
  createProcedureTutorialAuthoringRunCoordinator,
  procedureTutorialAuthoringRunErrorResponse,
  procedureTutorialAuthoringRunEvidenceEventTypes,
  procedureTutorialAuthoringRunHttpStatus,
  type ProcedureTutorialAuthoringRunCoordinator,
} from './procedure-tutorial-authoring-run.js';
import { createProcedureLeafReplayCurrentStateCoordinator } from './procedure-replay-current-state.js';
import {
  buildProcedureLeafReplayAttestation,
  buildProcedureLeafReplayBinding,
  buildProcedureLeafReplayFailureRecoveryAttestation,
  prepareProcedureLeafReplay,
  ProcedureLeafReplayError,
  sameProcedureLeafReplayValue,
  validateStrongProcedureLeafReplayObservation,
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
  createProcedureTutorialMediaCoordinator,
  procedureTutorialMediaCoordinatorErrorResponse,
  procedureTutorialMediaCoordinatorHttpStatus,
  procedureTutorialMediaEvidenceEventTypes,
  type ProcedureTutorialMediaCoordinator,
} from './procedure-tutorial-media-coordinator.js';
import type { ProcedureTutorialMediaRuntime } from './procedure-tutorial-media-runtime.js';
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
  createProcedureTutorialYoutubeTrackSelectionCoordinator,
  procedureTutorialYoutubeTrackSelectionErrorResponse,
  procedureTutorialYoutubeTrackSelectionHttpStatus,
  type ProcedureTutorialYoutubeTrackSelectionCoordinator,
} from './procedure-tutorial-youtube-track-selection.js';
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
  tutorialMediaRuntime?: ProcedureTutorialMediaRuntime;
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

function requestIdFromUnknown(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const requestId = z.uuid().safeParse((input as Record<string, unknown>)['requestId']);
  return requestId.success ? requestId.data : null;
}

function tutorialMediaUnavailableResponse(
  requestId: string | null,
  runtime: ProcedureTutorialMediaRuntime,
): {
  readonly error: 'procedure_tutorial_media_unavailable';
  readonly requestId: string | null;
  readonly message: string;
  readonly capabilities: ProcedureTutorialMediaRuntime['capabilities'];
} {
  return {
    error: 'procedure_tutorial_media_unavailable',
    requestId,
    message: 'The server-side tutorial media analysis pipeline is unavailable.',
    capabilities: runtime.capabilities,
  };
}

function mcpError(response: object) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  };
}

function mcpStructuredResult<Value extends Record<string, unknown>>(value: Value) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

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

function procedureTreeEditorHttpError(error: unknown): {
  readonly statusCode: number;
  readonly body: {
    readonly error: string;
    readonly code: ProcedureTreeEditorError['code'];
    readonly message: string;
  };
} | null {
  if (!(error instanceof ProcedureTreeEditorError)) return null;
  return {
    statusCode: error.statusCode,
    body: {
      error: `procedure_tree_editor_${error.code}`,
      code: error.code,
      message: error.message,
    },
  };
}

export async function startRuntime(options: StartRuntimeOptions): Promise<RunningRuntime> {
  const tutorialMediaRuntime =
    options.tutorialMediaRuntime ??
    ({
      capabilities: {
        availability: 'unavailable',
        formatVersion: '1.0.0',
        serviceId: 'operatingline.youtube_tutorial_media',
        serviceVersion: runtimeVersion,
        unavailableReasons: ['not_configured'],
      },
    } satisfies ProcedureTutorialMediaRuntime);
  let tutorialMediaPipelineForCleanup = tutorialMediaRuntime.pipeline;
  const {
    port,
    adapters,
    actionCatalogRegistry,
    interactionCatalogRegistry,
    companionLeaseManager,
    plannerProviderRegistry,
    database,
    procedureLeafReplayCurrentStateCoordinator,
    guideRevisionRequestService,
  } = await (async () => {
    let databaseForCleanup: ReturnType<typeof openOperatingLineDatabase> | undefined;
    let plannerProviderRegistryForCleanup:
      ReturnType<typeof createPlannerProviderRegistry> | undefined;

    try {
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
      plannerProviderRegistryForCleanup = plannerProviderRegistry;
      const database = openOperatingLineDatabase(options.databasePath, {
        procedureRefinementValidation: {
          computeCanonicalContentSha256: (input) =>
            createHash('sha256').update(canonicalizeProtocolJsonValue(input)).digest('hex'),
          parseCreateRequest: (input) => procedureRefinementCreateRequestSchema.parse(input),
          parseReviewRequest: (input) => procedureRefinementReviewRequestSchema.parse(input),
          parseReviewedEvent: (input) => procedureRefinementReviewedEventSchema.parse(input),
          parseRunStatus: (input) => procedureRefinementRunStatusSchema.parse(input),
        },
      });
      databaseForCleanup = database;
      const procedureLeafReplayCurrentStateCoordinator =
        createProcedureLeafReplayCurrentStateCoordinator(database);
      const guideRevisionRequestService = createGuideRevisionRequestService({
        database,
        actionCatalogRegistry,
      });

      return {
        port,
        adapters,
        actionCatalogRegistry,
        interactionCatalogRegistry,
        companionLeaseManager,
        plannerProviderRegistry,
        database,
        procedureLeafReplayCurrentStateCoordinator,
        guideRevisionRequestService,
      };
    } catch (error) {
      const tutorialMediaPipeline = tutorialMediaPipelineForCleanup;
      tutorialMediaPipelineForCleanup = undefined;
      return throwAfterCleanup(error, [
        () => tutorialMediaPipeline?.close(),
        () => plannerProviderRegistryForCleanup?.close(),
        () => databaseForCleanup?.close(),
      ]);
    }
  })();
  let app: ReturnType<typeof createMcpFastifyApp> | undefined;
  let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
  let plannerGenerationCoordinator: PlannerGenerationCoordinator | undefined;
  let plannerReplanGenerationCoordinator: PlannerReplanGenerationCoordinator | undefined;
  let procedureAuthoringGenerationCoordinator: ProcedureAuthoringGenerationCoordinator | undefined;
  let procedureSemanticRetrievalCoordinator: ProcedureSemanticRetrievalCoordinator | undefined;
  let procedureRefinementCoordinator: ProcedureRefinementCoordinator | undefined;
  let procedureTutorialAuthoringRunCoordinator:
    ProcedureTutorialAuthoringRunCoordinator | undefined;
  let procedureTutorialYoutubeImportCoordinator:
    ProcedureTutorialYoutubeImportCoordinator | undefined;
  let procedureTutorialYoutubeTrackSelectionCoordinator:
    ProcedureTutorialYoutubeTrackSelectionCoordinator | undefined;
  let procedureTutorialMediaCoordinator: ProcedureTutorialMediaCoordinator | undefined;
  let companionInitialPlanRunCoordinator: CompanionInitialPlanRunCoordinator | undefined;
  let companionReplanRunCoordinator: CompanionReplanRunCoordinator | undefined;
  let companionDialogueRunCoordinator: CompanionDialogueRunCoordinator | undefined;
  const cleanupSteps: CleanupStep[] = [
    () => companionInitialPlanRunCoordinator?.beginClose(),
    () => companionReplanRunCoordinator?.beginClose(),
    () => {
      companionDialogueRunCoordinator?.beginClose();
      procedureRefinementCoordinator?.beginClose();
      procedureTutorialAuthoringRunCoordinator?.beginClose();
      procedureTutorialYoutubeImportCoordinator?.beginClose();
      procedureTutorialMediaCoordinator?.beginClose();
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
    () => procedureTutorialAuthoringRunCoordinator?.close(),
    () => procedureTutorialMediaCoordinator?.close(),
    () => tutorialMediaPipelineForCleanup?.close(),
    () => companionInitialPlanRunCoordinator?.close(),
    () => companionReplanRunCoordinator?.close(),
    () => companionDialogueRunCoordinator?.close(),
    () => procedureRefinementCoordinator?.close(),
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
      if (
        tree.nodes.some((node) => node.kind === 'leaf' && node.parameterProjection !== undefined)
      ) {
        const interactionCatalog = interactionCatalogRegistry.get({
          targetAdapterId: tree.adapterId,
          actionCatalogVersion: tree.actionCatalogVersion,
          interactionCatalogVersion: tree.interactionCatalogVersion,
        });
        validateProcedureTreeParameterProjectionCatalog(tree, interactionCatalog);
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

    const listAllProcedureTreeSummaries = () => {
      const summaries: ReturnType<typeof publicProcedureTreeSummary>[] = [];
      let afterSequence = 0;
      while (true) {
        const page = database.listProcedureTrees(afterSequence, 100);
        summaries.push(...page.map(publicProcedureTreeSummary));
        const lastSequence = page.at(-1)?.sequence;
        if (page.length < 100) return summaries;
        if (lastSequence === undefined || lastSequence <= afterSequence) {
          throw new Error('ProcedureTree pagination did not advance');
        }
        afterSequence = lastSequence;
      }
    };

    type ProcedureTreeInput = ReturnType<typeof procedureTreeStoreRequestSchema.parse>['tree'];
    type AtomicProcedureTreeEvidence = NonNullable<
      Parameters<typeof database.recordProcedureTree>[0]['atomicEvidence']
    >;
    const persistProcedureTree = (
      treeInput: ProcedureTreeInput,
      atomicEvidence?: AtomicProcedureTreeEvidence,
    ) => {
      const tree = (() => {
        try {
          return validateAndCompileProcedureTree(treeInput).tree;
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
        ...(atomicEvidence === undefined ? {} : { atomicEvidence }),
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
    const storeProcedureTree = (
      request: ReturnType<typeof procedureTreeStoreRequestSchema.parse>,
    ) => persistProcedureTree(request.tree);

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

    const procedureTreeEditorCoordinator = createProcedureTreeEditorCoordinator({
      database,
      loadTree: (treeId, revision) => {
        const stored = database.getProcedureTree(treeId, revision);
        return stored === null ? null : publicProcedureTreeRecord(stored);
      },
      validateTree: (tree) => validateAndCompileProcedureTree(tree).tree,
      computeContentSha256: computeProcedureTreeContentSha256,
      getActionCatalog: (tree) =>
        actionCatalogRegistry.get({
          targetAdapterId: tree.adapterId,
          catalogVersion: tree.actionCatalogVersion,
        }),
      getInteractionCatalog: (tree) =>
        interactionCatalogRegistry.get({
          targetAdapterId: tree.adapterId,
          actionCatalogVersion: tree.actionCatalogVersion,
          interactionCatalogVersion: tree.interactionCatalogVersion,
        }),
    });

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
    const existingProcedureSemanticRetrievalEvents = database.listExecutionEventsByTypes(
      procedureSemanticRetrievalEvidenceEventTypes,
    );
    const existingProcedureRefinementEvents = database.listExecutionEventsByTypes(
      procedureRefinementEvidenceEventTypes,
    );
    const existingProcedureTutorialYoutubeEvents = database.listExecutionEventsByTypes(
      procedureTutorialYoutubeEvidenceEventTypes,
    );
    const existingProcedureTutorialAuthoringRunEvents = database.listExecutionEventsByTypes(
      procedureTutorialAuthoringRunEvidenceEventTypes,
    );
    if (
      tutorialMediaRuntime.capabilities.availability === 'available' &&
      tutorialMediaRuntime.pipeline !== undefined
    ) {
      procedureTutorialMediaCoordinator = createProcedureTutorialMediaCoordinator({
        pipeline: tutorialMediaRuntime.pipeline,
        existingEvents: database.listExecutionEventsByTypes(
          procedureTutorialMediaEvidenceEventTypes,
        ),
        appendEvent: (event) => database.appendEvent(event),
        maximumAnalysisWindowMs: tutorialMediaRuntime.capabilities.limits.maxAnalysisWindowMs,
        maximumConcurrentJobs: tutorialMediaRuntime.maximumConcurrentJobs,
        supportedLocales: tutorialMediaRuntime.capabilities.supportedLocales,
      });
      tutorialMediaPipelineForCleanup = undefined;
      await procedureTutorialMediaCoordinator.ready();
    }
    procedureTutorialYoutubeImportCoordinator = createProcedureTutorialYoutubeImportCoordinator({
      ...(options.youtubeCaptionSource === undefined
        ? {}
        : { source: options.youtubeCaptionSource }),
      existingEvents: existingProcedureTutorialYoutubeEvents,
      completedTrackSelection: (requestId) =>
        procedureTutorialYoutubeTrackSelectionCoordinator!.completedSelection(requestId),
      buildPacket: (request, acquisition, selection) => {
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
          selection,
        );
      },
      appendEvent: (event) => database.appendEvent(event),
    });
    procedureTutorialYoutubeTrackSelectionCoordinator =
      createProcedureTutorialYoutubeTrackSelectionCoordinator({
        existingEvents: existingProcedureTutorialYoutubeEvents,
        completedTrackList: (requestId) =>
          procedureTutorialYoutubeImportCoordinator!.completedTrackList(requestId),
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
        ...restoreProcedureSemanticRetrievalInvocations(existingProcedureSemanticRetrievalEvents),
        ...restoreProcedureRefinementProviderInvocations(existingProcedureRefinementEvents),
      ],
    });
    procedureSemanticRetrievalCoordinator = createProcedureSemanticRetrievalCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingProcedureSemanticRetrievalEvents,
      listProcedureTrees: listAllProcedureTreeSummaries,
      getProcedureTree: (treeId, revision) => getProcedureTree({ treeId, revision }),
      appendEvent: (event) => database.appendEvent(event),
    });
    procedureRefinementCoordinator = createProcedureRefinementCoordinator({
      registry: plannerProviderRegistry,
      invocationManager: plannerProviderInvocationManager,
      existingEvents: existingProcedureRefinementEvents,
      getLatestProcedureTree: (treeId) => getProcedureTree({ treeId }),
      completedSemanticEvidence: (requestId) =>
        procedureSemanticRetrievalCoordinator!.completedEvidence(requestId),
      compileCandidate: (tree) => {
        validateAndCompileProcedureTree(tree);
        return { valid: true };
      },
      recordRun: (run) => database.recordProcedureRefinementRun(run),
      getRun: (runId) => database.getProcedureRefinementRun(runId),
      transitionRun: (run, expected) => database.transitionProcedureRefinementRun(run, expected),
      listActiveRuns: () => database.listActiveProcedureRefinementRuns(),
      commitStoreReview: (input) => {
        const result = database.commitProcedureRefinementStoreReview({
          ...input,
          buildCompletedRun: (storedTree) => {
            const statusPayload = procedureRefinementRunStatusSchema.parse({
              ...input.currentRun.statusPayload,
              status: 'completed',
              terminal: true,
              review: {
                reviewId: input.reviewRequest.reviewId,
                decision: 'store',
                reviewedAt: input.reviewRequest.reviewedAt,
              },
              storedTree: publicProcedureTreeRecord(storedTree),
              sideEffects: {
                procedureStored: true,
                proposalCreated: false,
                hostExecutionStarted: false,
              },
              updatedAt: input.reviewedEvent.createdAt,
            });
            return {
              ...input.currentRun,
              status: statusPayload.status,
              statusPayload,
              updatedAt: statusPayload.updatedAt,
            };
          },
        });
        if (result.result === 'conflict') {
          throw new Error('Procedure refinement store review conflicts with durable state');
        }
        return result.run.statusPayload;
      },
      commitDiscardReview: (input) => {
        const result = database.commitProcedureRefinementDiscardReview({
          ...input,
          buildDiscardedRun: () => {
            const statusPayload = procedureRefinementRunStatusSchema.parse({
              ...input.currentRun.statusPayload,
              status: 'discarded',
              terminal: true,
              review: {
                reviewId: input.reviewRequest.reviewId,
                decision: 'discard',
                reviewedAt: input.reviewRequest.reviewedAt,
              },
              sideEffects: {
                procedureStored: false,
                proposalCreated: false,
                hostExecutionStarted: false,
              },
              updatedAt: input.reviewedEvent.createdAt,
            });
            return {
              ...input.currentRun,
              status: statusPayload.status,
              statusPayload,
              updatedAt: statusPayload.updatedAt,
            };
          },
        });
        if (result.result === 'conflict') {
          throw new Error('Procedure refinement discard review conflicts with durable state');
        }
        return result.run.statusPayload;
      },
      appendEvent: (event) => database.appendEvent(event),
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
    const restoreTutorialAuthoringStoredTree = (input: {
      binding: ProcedureTutorialAuthoringBinding;
      completedEvent: ExecutionEventInput & { readonly createdAt: string };
    }) => {
      const { binding, completedEvent } = input;
      const storedEvidence = database.getExecutionEvent(completedEvent.id);
      if (storedEvidence === null) return { status: 'absent' as const };
      if (
        storedEvidence.eventType !== completedEvent.eventType ||
        storedEvidence.createdAt !== completedEvent.createdAt ||
        !isDeepStrictEqual(storedEvidence.payload, completedEvent.payload)
      ) {
        return { status: 'invalid' as const };
      }
      const stored = database.getProcedureTree(binding.storage.treeId, binding.storage.revision);
      if (stored === null) return { status: 'invalid' as const };
      try {
        const record = publicProcedureTreeRecord(stored);
        if (
          record.tree.id !== binding.storage.treeId ||
          record.tree.revision !== binding.storage.revision ||
          record.integrity.contentSha256 !== binding.storage.contentSha256
        ) {
          return { status: 'invalid' as const };
        }
        return {
          status: 'completed' as const,
          storage: procedureTreeStoreResultSchema.parse({
            result: 'duplicate',
            record,
            validation: procedureRuntimeValidation,
            proposalCreated: false,
            hostExecutionStarted: false,
          }),
        };
      } catch {
        return { status: 'invalid' as const };
      }
    };
    procedureTutorialAuthoringRunCoordinator = createProcedureTutorialAuthoringRunCoordinator({
      importCaption: (request) => procedureTutorialYoutubeImportCoordinator!.importCaption(request),
      completedPacket: (requestId) =>
        procedureTutorialYoutubeImportCoordinator!.completedPacket(requestId),
      generateFromPacket: (input) =>
        procedureAuthoringGenerationCoordinator!.generateFromPacket(input),
      completedGenerationEvidence: (requestId) =>
        procedureAuthoringGenerationCoordinator!.completedEvidence(requestId),
      materialize: ({ packet, tree }) => materializeProcedureAuthoring({ packet, tree }),
      storeWithBinding: ({ tree, completedEvent }) => persistProcedureTree(tree, completedEvent),
      restoreStored: restoreTutorialAuthoringStoredTree,
      isStorageFailureRetryable: (error) =>
        !(error instanceof ProcedureTreeRevisionError) &&
        !(error instanceof ProcedureTreeValidationError),
      findProcedureAuthor: (providerId) =>
        plannerProviderRegistry.findProcedureAuthor(providerId)?.descriptor ?? null,
      existingEvents: existingProcedureTutorialAuthoringRunEvents,
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

    const actionExecutionCoordinator = createBlenderActionExecutionCoordinator({ database });

    const actionExecutionRejected = (
      message: string,
      statusCode: number = 409,
      code = 'action_execution_not_authorized',
    ): never => {
      throw new BlenderActionExecutionError(code, statusCode, message);
    };

    const requireManagedPrimitiveMcpTrack = (binding: ProcedureLeafReplayBinding) => {
      const leaf = binding.materialization.tree.nodes.find(
        (node) => node.kind === 'leaf' && node.id === binding.leafId,
      );
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        return actionExecutionRejected('Replay binding has no executable leaf');
      }
      const action = leaf.action;
      const parsedActionName = procedureLeafReplayActionNameSchema.safeParse(action.name);
      if (
        !parsedActionName.success ||
        parsedActionName.data !== binding.actionName ||
        action.adapterId !== 'blender' ||
        action.name !== binding.actionName
      ) {
        return actionExecutionRejected(
          'This action-level executor is restricted to the managed Blender primitive set',
          422,
          'action_execution_unsupported_action',
        );
      }
      const track = leaf.mcpTracks[0];
      const operation =
        track?.availability === 'available' && track.operations.length === 1
          ? track.operations[0]
          : undefined;
      if (
        leaf.mcpTracks.length !== 1 ||
        track?.availability !== 'available' ||
        operation === undefined ||
        operation.serverName !== 'operating-line' ||
        operation.toolName !== 'operatingline.blender.action.execute' ||
        operation.argumentSource !== 'accepted_leaf_action' ||
        !sameProcedureLeafReplayValue(operation.actionArguments, action.arguments) ||
        !sameProcedureLeafReplayValue(operation.arguments, {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        }) ||
        operation.resultBinding !== `${leaf.id}.companion_state_report`
      ) {
        return actionExecutionRejected(
          'Replay binding lacks the exact catalog-grounded managed primitive MCP call',
        );
      }
      return { action, leaf, operation };
    };

    const authorizeBlenderActionExecution = (
      request: CompanionActionExecutionCreateRequest,
    ): {
      execution: CompanionActionExecutionStatus;
      sessionFingerprintSha256: string;
    } => {
      const { binding, decision, proposalReceipt, decisionReceipt } =
        loadProcedureLeafReplayEvidence(request.replayId);
      if (decision.decision !== 'accepted') {
        return actionExecutionRejected('The replay proposal was not accepted by the target user');
      }
      const { action } = requireManagedPrimitiveMcpTrack(binding);
      const proposal = binding.proposal;
      if (
        proposal.targetAdapterId !== 'blender' ||
        proposal.targetInstanceId !== binding.targetInstanceId ||
        decision.adapterId !== 'blender' ||
        decision.instanceId !== binding.targetInstanceId ||
        decision.proposalId !== proposal.proposalId
      ) {
        return actionExecutionRejected('Replay proposal, decision, and target identities differ');
      }
      if (
        proposalReceipt.subjectType !== 'replay_proposal' ||
        proposalReceipt.subjectId !== proposal.proposalId ||
        proposalReceipt.authentication !== 'orchestrator_internal' ||
        proposalReceipt.adapterId !== 'blender' ||
        proposalReceipt.instanceId !== binding.targetInstanceId ||
        proposalReceipt.sessionFingerprintSha256 !== null ||
        decisionReceipt.subjectType !== 'guide_proposal_decision' ||
        decisionReceipt.subjectId !== decision.decisionId ||
        decisionReceipt.authentication !== 'negotiated_companion_lease' ||
        decisionReceipt.adapterId !== 'blender' ||
        decisionReceipt.instanceId !== binding.targetInstanceId ||
        decisionReceipt.sessionFingerprintSha256 === null
      ) {
        return actionExecutionRejected(
          'The accepted replay lacks a negotiated Companion session receipt',
        );
      }
      const planContentSha256 = computePlanContentSha256(proposal.plan);
      if (planContentSha256 !== binding.planContentSha256) {
        return actionExecutionRejected('Replay proposal plan hash differs from its binding');
      }
      const executableSteps = proposal.plan.steps.filter((step) => step.action !== null);
      const step = executableSteps[0];
      if (
        executableSteps.length !== 1 ||
        step?.id !== binding.leafId ||
        step.action?.adapterId !== 'blender' ||
        step.action.name !== binding.actionName ||
        step.action.name !== action.name ||
        !sameProcedureLeafReplayValue(step.action.arguments, action.arguments)
      ) {
        return actionExecutionRejected(
          'Accepted replay plan does not contain the exact single managed primitive leaf action',
        );
      }

      const latest = listCompanionStates().find(
        (report) =>
          report.adapterId === 'blender' && report.instanceId === binding.targetInstanceId,
      );
      if (latest === undefined) {
        return actionExecutionRejected(
          'The accepted target Companion is not currently present',
          409,
          'action_execution_companion_unavailable',
        );
      }
      if (
        latest.reportId !== request.expectedState.reportId ||
        latest.sequence !== request.expectedState.sequence
      ) {
        return actionExecutionRejected(
          'The expected Companion state is stale; refresh companions and retry with a new requestId',
          409,
          'action_execution_state_changed',
        );
      }
      if (
        latest.plan?.id !== proposal.plan.id ||
        latest.plan.revision !== proposal.plan.revision ||
        latest.planContentSha256 !== planContentSha256 ||
        latest.executionId === null ||
        latest.phase !== 'running' ||
        latest.transition !== 'walkthrough_started' ||
        latest.activeStepId !== null ||
        latest.completedStepIds.length !== 0 ||
        latest.nativeUndoCheckpoint?.operation !== 'start' ||
        (latest.observationGate !== undefined && latest.observationGate !== null) ||
        latest.error !== null
      ) {
        return actionExecutionRejected(
          'The target Companion is not at the started, untouched accepted replay cursor',
          409,
          'action_execution_state_not_ready',
        );
      }
      const reportReceipt = database.getManagedReplayReceipt(
        'companion_state_report',
        latest.reportId,
      );
      if (
        reportReceipt === null ||
        reportReceipt.subjectType !== 'companion_state_report' ||
        reportReceipt.subjectId !== latest.reportId ||
        reportReceipt.authentication !== 'negotiated_companion_lease' ||
        reportReceipt.adapterId !== 'blender' ||
        reportReceipt.instanceId !== binding.targetInstanceId ||
        reportReceipt.sessionFingerprintSha256 !== decisionReceipt.sessionFingerprintSha256 ||
        proposalReceipt.sequence >= decisionReceipt.sequence ||
        decisionReceipt.sequence >= reportReceipt.sequence ||
        Date.parse(proposalReceipt.receivedAt) > Date.parse(decisionReceipt.receivedAt) ||
        Date.parse(decisionReceipt.receivedAt) > Date.parse(reportReceipt.receivedAt) ||
        Date.parse(decision.occurredAt) > Date.parse(latest.occurredAt)
      ) {
        return actionExecutionRejected(
          'The expected Companion state is not an ordered receipt after replay acceptance',
          409,
          'action_execution_evidence_order_invalid',
        );
      }
      const requestedAt = new Date().toISOString();
      return {
        execution: companionActionExecutionStatusSchema.parse({
          formatVersion: request.formatVersion,
          requestId: request.requestId,
          replayId: request.replayId,
          target: { adapterId: 'blender', instanceId: binding.targetInstanceId },
          proposalId: proposal.proposalId,
          plan: { id: proposal.plan.id, revision: proposal.plan.revision },
          planContentSha256,
          executionId: latest.executionId,
          expectedState: request.expectedState,
          step,
          requestedAt,
          status: 'queued',
          updatedAt: requestedAt,
        }),
        sessionFingerprintSha256: decisionReceipt.sessionFingerprintSha256,
      };
    };

    const validateBlenderActionExecutionResult = (
      result: CompanionActionExecutionResult,
      sessionFingerprintSha256: string,
      execution: CompanionActionExecutionStatus,
    ): void => {
      if (result.status === 'rejected') {
        if (result.report !== null) {
          return actionExecutionRejected(
            'A locally rejected action request must not claim an execution report',
          );
        }
        return;
      }
      if (result.report === null) {
        return actionExecutionRejected('Executed action result must reference its state report');
      }
      const reportPayload = database.getCompanionStateReport(result.report.reportId);
      if (reportPayload === null) {
        return actionExecutionRejected(
          'Action result references an unknown Companion state report',
          409,
          'action_execution_report_missing',
        );
      }
      const report = companionStateReportSchema.parse(reportPayload);
      const latestReport = listKnownCompanionStates().find(
        (candidate) =>
          candidate.adapterId === result.target.adapterId &&
          candidate.instanceId === result.target.instanceId,
      );
      if (latestReport?.reportId !== report.reportId || latestReport.sequence !== report.sequence) {
        return actionExecutionRejected(
          'Action result report is no longer the target Companion current state',
          409,
          'action_execution_report_stale',
        );
      }
      const reportReceipt = database.getManagedReplayReceipt(
        'companion_state_report',
        report.reportId,
      );
      if (
        reportReceipt === null ||
        reportReceipt.authentication !== 'negotiated_companion_lease' ||
        reportReceipt.adapterId !== result.target.adapterId ||
        reportReceipt.instanceId !== result.target.instanceId ||
        reportReceipt.sessionFingerprintSha256 !== sessionFingerprintSha256
      ) {
        return actionExecutionRejected(
          'Action result report is not authenticated by the dispatched Companion session',
        );
      }
      if (
        report.reportId !== result.report.reportId ||
        report.sequence !== result.report.sequence ||
        report.sequence <= result.expectedState.sequence ||
        report.adapterId !== result.target.adapterId ||
        report.instanceId !== result.target.instanceId ||
        report.plan?.id !== result.plan.id ||
        report.plan.revision !== result.plan.revision ||
        report.planContentSha256 !== result.planContentSha256 ||
        report.executionId !== result.executionId ||
        report.stepId !== result.stepId
      ) {
        return actionExecutionRejected(
          'Action result report differs from the dispatched plan, cursor, or step identity',
        );
      }
      const dispatchedAt = execution.dispatchedAt;
      if (
        dispatchedAt === undefined ||
        Date.parse(reportReceipt.receivedAt) <= Date.parse(dispatchedAt) ||
        Date.parse(report.occurredAt) < Date.parse(dispatchedAt) ||
        Date.parse(result.occurredAt) < Date.parse(report.occurredAt)
      ) {
        return actionExecutionRejected(
          'Action result evidence predates its immutable delivery',
          409,
          'action_execution_evidence_predates_dispatch',
        );
      }
      if (result.status === 'succeeded') {
        const checkpoint = report.nativeUndoCheckpoint;
        const authorizedStartPayload = database.getCompanionStateReport(
          execution.expectedState.reportId,
        );
        const parsedAuthorizedStart = companionStateReportSchema.safeParse(authorizedStartPayload);
        const authorizedStart = parsedAuthorizedStart.success
          ? parsedAuthorizedStart.data
          : undefined;
        const authorizedStartReceipt = database.getManagedReplayReceipt(
          'companion_state_report',
          execution.expectedState.reportId,
        );
        const startCheckpoint = authorizedStart?.nativeUndoCheckpoint;
        let actionReplayBinding: ProcedureLeafReplayBinding;
        try {
          ({ binding: actionReplayBinding } = loadProcedureLeafReplayEvidence(execution.replayId));
        } catch (error) {
          if (!(error instanceof ProcedureLeafReplayError)) throw error;
          return actionExecutionRejected(
            'Succeeded action result cannot be verified against its immutable replay evidence',
            409,
            'action_execution_replay_evidence_invalid',
          );
        }
        try {
          validateStrongProcedureLeafReplayObservation(actionReplayBinding, report);
        } catch (error) {
          if (!(error instanceof ProcedureLeafReplayError)) throw error;
          return actionExecutionRejected(
            'Succeeded action result does not match the dispatched Observation success gate',
            409,
            'action_execution_observation_mismatch',
          );
        }
        if (
          authorizedStart === undefined ||
          authorizedStartReceipt === null ||
          authorizedStartReceipt.authentication !== 'negotiated_companion_lease' ||
          authorizedStartReceipt.adapterId !== execution.target.adapterId ||
          authorizedStartReceipt.instanceId !== execution.target.instanceId ||
          authorizedStartReceipt.sessionFingerprintSha256 !== sessionFingerprintSha256 ||
          authorizedStart.reportId !== execution.expectedState.reportId ||
          authorizedStart.sequence !== execution.expectedState.sequence ||
          authorizedStart.adapterId !== execution.target.adapterId ||
          authorizedStart.instanceId !== execution.target.instanceId ||
          authorizedStart.plan?.id !== execution.plan.id ||
          authorizedStart.plan.revision !== execution.plan.revision ||
          authorizedStart.planContentSha256 !== execution.planContentSha256 ||
          authorizedStart.executionId !== execution.executionId ||
          startCheckpoint?.operation !== 'start' ||
          checkpoint?.previousCheckpointId !== startCheckpoint.checkpointId
        ) {
          return actionExecutionRejected(
            'Succeeded action result does not continue its authorized Start native Undo checkpoint',
            409,
            'action_execution_checkpoint_chain_invalid',
          );
        }
        if (
          report.transition !== 'step_succeeded' ||
          report.phase !== 'completed' ||
          report.activeStepId !== result.stepId ||
          report.completedStepIds.length !== 1 ||
          report.completedStepIds[0] !== result.stepId ||
          (report.observationGate !== undefined && report.observationGate !== null) ||
          report.error !== null ||
          checkpoint?.operation !== 'next' ||
          Date.parse(checkpoint.committedAt) < Date.parse(dispatchedAt) ||
          checkpoint.session.receiptStepIds.length !== 1 ||
          checkpoint.session.receiptStepIds[0] !== result.stepId
        ) {
          return actionExecutionRejected(
            'Succeeded action result lacks its Observation success gate or native Undo receipt',
          );
        }
        return;
      }
      if (report.transition !== 'error' && report.transition !== 'step_observation_failed') {
        return actionExecutionRejected(
          'Failed action result must reference an error or Observation-gate failure report',
        );
      }
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
        'operatingline.blender.action.execute',
        {
          description:
            'Queue exactly one Catalog-authorized UV Sphere, Icosphere, Cube, Plane, Torus, Cone, or Cylinder leaf from an already human-accepted, instance-bound Procedure replay. The request is compare-and-set against an authenticated Companion state receipt; the server derives the action and all parameters from the immutable replay binding. This never accepts arbitrary actions, Python, plan ids, step ids, or parameters.',
          inputSchema: companionActionExecutionCreateRequestSchema,
          outputSchema: companionActionExecutionStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = companionActionExecutionCreateRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_action_execution_request',
                    message: 'Action execution request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          try {
            const existing = actionExecutionCoordinator.findForCreate(parsedRequest.data);
            const execution =
              existing ??
              (() => {
                const authorization = authorizeBlenderActionExecution(parsedRequest.data);
                return actionExecutionCoordinator.queue(
                  authorization.execution,
                  authorization.sessionFingerprintSha256,
                );
              })();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(execution) }],
              structuredContent: execution,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error:
                      error instanceof BlenderActionExecutionError
                        ? error.code
                        : 'action_execution_failed',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Action execution could not be safely authorized',
                  }),
                },
              ],
            };
          }
        },
      );

      server.registerTool(
        'operatingline.blender.action.status',
        {
          description:
            'Return the durable state of one previously queued Blender action execution. A recovery_required result means delivery became indeterminate after restart and will never be replayed automatically.',
          inputSchema: companionActionExecutionStatusRequestSchema,
          outputSchema: companionActionExecutionStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = companionActionExecutionStatusRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'invalid_action_execution_status_request',
                    message: 'Action execution status request violates the strict public contract',
                  }),
                },
              ],
            };
          }
          const execution = actionExecutionCoordinator.get(parsedRequest.data.requestId);
          if (execution === null) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'action_execution_not_found',
                    message: 'The action execution request was not found',
                  }),
                },
              ],
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(execution) }],
            structuredContent: execution,
          };
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.media.capabilities',
        {
          description:
            'Report whether the server-side authorized YouTube media analysis pipeline is configured, including its deterministic stages, supported locales, limits, and evidence features. This performs no download or analysis.',
          inputSchema: z.strictObject({}),
          outputSchema: procedureTutorialMediaCapabilitiesSchema,
        },
        async () => ({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(tutorialMediaRuntime.capabilities),
            },
          ],
          structuredContent: tutorialMediaRuntime.capabilities,
        }),
      );

      server.registerTool(
        'operatingline.procedure.tutorial.media.jobs.create',
        {
          description:
            'Start the complete authorized YouTube tutorial media evidence pipeline. Authorization references must already exist in the trusted server-side registry; this request never accepts credentials, executable paths, model paths, or arbitrary download URLs.',
          inputSchema: deferMcpInputValidation(procedureTutorialMediaAnalysisRequestSchema),
          outputSchema: procedureTutorialMediaJobStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTutorialMediaAnalysisRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_media_analysis_request',
              requestId,
              message: 'Tutorial media analysis request violates the strict public contract.',
            });
          }
          if (procedureTutorialMediaCoordinator === undefined) {
            return mcpError(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
          }
          try {
            const job = procedureTutorialMediaCoordinator.create(parsedRequest.data);
            return mcpStructuredResult(job);
          } catch (error) {
            return mcpError(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.media.jobs.status',
        {
          description:
            'Read the latest persisted state of one tutorial media analysis job. Both the original request id and server-generated job id are required.',
          inputSchema: deferMcpInputValidation(procedureTutorialMediaJobStatusRequestSchema),
          outputSchema: procedureTutorialMediaJobStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureTutorialMediaJobStatusRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_media_job_status_request',
              requestId,
              message: 'Tutorial media job status request violates the strict public contract.',
            });
          }
          if (procedureTutorialMediaCoordinator === undefined) {
            return mcpError(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
          }
          try {
            return mcpStructuredResult(
              procedureTutorialMediaCoordinator.status(
                parsedRequest.data.requestId,
                parsedRequest.data.jobId,
              ),
            );
          } catch (error) {
            return mcpError(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.media.jobs.restart',
        {
          description:
            'Explicitly restart a recoverable tutorial media job from the download stage using the exact server recovery receipt and renewed network, download, and retention approvals. Partial artifact reuse is forbidden.',
          inputSchema: deferMcpInputValidation(procedureTutorialMediaResumeRequestSchema),
          outputSchema: procedureTutorialMediaJobStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureTutorialMediaResumeRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_media_restart_request',
              requestId,
              message: 'Tutorial media restart request violates the strict public contract.',
            });
          }
          if (procedureTutorialMediaCoordinator === undefined) {
            return mcpError(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
          }
          try {
            return mcpStructuredResult(
              procedureTutorialMediaCoordinator.resume(parsedRequest.data),
            );
          } catch (error) {
            return mcpError(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
          }
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
        'operatingline.procedure.tutorial.youtube.tracks.select',
        {
          description:
            'Persist one explicit user-confirmed caption-track choice from a previously completed authorized YouTube track list. The request records a bounded reason and may include the exact recommendation preferences so the runtime can attest whether the user accepted or overrode the recomputed first candidate. Reason notes are retained in the local evidence ledger and may enter evidence exports. This performs no network request, spends no additional API quota, downloads no content, calls no model, and does not import captions, store a Procedure, create a Proposal, or execute the host.',
          inputSchema: deferMcpInputValidation(procedureTutorialYoutubeTrackSelectionRequestSchema),
          outputSchema: procedureTutorialYoutubeTrackSelectionResultSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureTutorialYoutubeTrackSelectionRequestSchema.safeParse(requestInput);
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
                    error: 'youtube_track_selection_invalid',
                    requestId: parsedRequestId.success ? parsedRequestId.data : null,
                    message:
                      'YouTube caption track selection request violates the strict public contract',
                    retryMode: 'never',
                  }),
                },
              ],
            };
          }
          try {
            const result = procedureTutorialYoutubeTrackSelectionCoordinator!.select(
              parsedRequest.data,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    formatVersion: result.formatVersion,
                    videoId: result.sourceTrackList.videoId,
                    captionTrackId: result.selectedTrack.captionTrackId,
                    selectedTrackWasRecommended:
                      result.recommendation?.selectedTrackWasRecommended ?? null,
                    selectionEvidenceStored: true,
                    message:
                      'The explicit caption-track selection receipt is in structuredContent; no caption content was downloaded.',
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
                    procedureTutorialYoutubeTrackSelectionErrorResponse(
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
            'Import request 1.1.0 requires a previously persisted explicit caption-track selectionRequestId. Before any network or quota use, the runtime verifies that receipt matches the requested YouTube video and caption track, then uses the configured OAuth-authorized YouTube Data API source to download SRT or WebVTT and returns a selection-bound Procedure authoring packet. Legacy request 1.0.0 remains compatibility-only. The authorized account must be able to edit the video; the call never downloads video media, calls a model, stores a tree, creates a Proposal, or executes the host. OAuth credentials are runtime-managed and must never be included in this request.',
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
        'operatingline.procedure.tutorial.authoring.runs.create',
        {
          description:
            'Start one asynchronous, selection-bound authoring run from a previously recorded exact YouTube caption track. The authorization must echo the exact available Provider descriptor previously reviewed by the user; any live disclosure drift is rejected before evidence or side effects. The run may perform the authorized caption network/quota operation and one explicitly selected Provider call that can transmit normalized captions and incur cost. It validates and materializes the candidate, then pauses for review of the exact packet, candidate, and materialized-tree hashes. It does not create a Proposal or execute the host, and it stores no ProcedureTree before a separate exact review approval.',
          inputSchema: deferMcpInputValidation(procedureTutorialAuthoringRunCreateRequestSchema),
          outputSchema: procedureTutorialAuthoringRunStatusSchema,
        },
        async (requestInput) => {
          const parsed = procedureTutorialAuthoringRunCreateRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsed.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_authoring_run_create_request',
              requestId,
              message: 'Tutorial authoring run request violates the strict public contract.',
            });
          }
          try {
            return mcpStructuredResult(
              procedureTutorialAuthoringRunCoordinator!.create(parsed.data),
            );
          } catch (error) {
            return mcpError(procedureTutorialAuthoringRunErrorResponse(error, requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.authoring.runs.status',
        {
          description:
            'Read the exact asynchronous selected-caption authoring run. Awaiting-review returns the complete Provider generation and deterministic materialization preview; completion means an immutable catalog-grounded candidate ProcedureTree was stored, not that Blender executed or verified it.',
          inputSchema: deferMcpInputValidation(procedureTutorialAuthoringRunStatusRequestSchema),
          outputSchema: procedureTutorialAuthoringRunStatusSchema,
        },
        async (requestInput) => {
          const parsed = procedureTutorialAuthoringRunStatusRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsed.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_authoring_run_status_request',
              requestId,
              message: 'Tutorial authoring status request violates the strict public contract.',
            });
          }
          try {
            return mcpStructuredResult(
              procedureTutorialAuthoringRunCoordinator!.status(parsed.data),
            );
          } catch (error) {
            return mcpError(procedureTutorialAuthoringRunErrorResponse(error, requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.authoring.runs.review',
        {
          description:
            'Store or discard one awaiting selected-caption authoring result. Store requires the exact review id, packet hash, candidate-tree hash, materialized-tree hash, and all three explicit confirmations; accepted storage atomically binds the full provenance event to the immutable candidate tree. This never creates or accepts a Proposal and never executes Blender.',
          inputSchema: deferMcpInputValidation(procedureTutorialAuthoringReviewRequestSchema),
          outputSchema: procedureTutorialAuthoringRunStatusSchema,
        },
        async (requestInput) => {
          const parsed = procedureTutorialAuthoringReviewRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsed.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_authoring_review_request',
              requestId,
              message: 'Tutorial authoring review request violates the strict public contract.',
            });
          }
          try {
            return mcpStructuredResult(
              procedureTutorialAuthoringRunCoordinator!.review(parsed.data),
            );
          } catch (error) {
            return mcpError(procedureTutorialAuthoringRunErrorResponse(error, requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.tutorial.authoring.runs.resume',
        {
          description:
            'Resume only an exact recovery_required local materialization or atomic-storage stage. Caption download and Provider generation are never retried by this operation, preventing repeated quota use, billing, or a different selected track.',
          inputSchema: deferMcpInputValidation(procedureTutorialAuthoringResumeRequestSchema),
          outputSchema: procedureTutorialAuthoringRunStatusSchema,
        },
        async (requestInput) => {
          const parsed = procedureTutorialAuthoringResumeRequestSchema.safeParse(requestInput);
          const requestId = requestIdFromUnknown(requestInput);
          if (!parsed.success) {
            return mcpError({
              error: 'invalid_procedure_tutorial_authoring_resume_request',
              requestId,
              message: 'Tutorial authoring resume request violates the strict public contract.',
            });
          }
          try {
            return mcpStructuredResult(
              procedureTutorialAuthoringRunCoordinator!.resume(parsed.data),
            );
          } catch (error) {
            return mcpError(procedureTutorialAuthoringRunErrorResponse(error, requestId));
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
        'operatingline.procedure.semantic.providers.list',
        {
          description:
            'List configured providers that support real Procedure leaf embeddings. Each exact disclosure includes the descriptor, embedding model, API/runtime settings, availability, data handling, and cost policy. The list contains no credentials and does not call an embedding endpoint.',
          inputSchema: z.strictObject({}),
          outputSchema: procedureSemanticRetrievalProviderDisclosureListSchema,
        },
        async () => {
          const providerList = procedureSemanticRetrievalCoordinator!.listProviders();
          return mcpStructuredResult(providerList);
        },
      );

      server.registerTool(
        'operatingline.procedure.semantic.search',
        {
          description:
            'Search the latest stored ProcedureTree leaves with true embedding cosine similarity. The caller must copy and explicitly authorize the exact Provider descriptor, embedding model, API/runtime settings, data handling, and cost policy returned by providers.list; live drift is rejected before any embedding call. Validation defaults to verified. Returns ranked public leaves without vectors and never stores a ProcedureTree, creates a Proposal, or starts host execution.',
          inputSchema: deferMcpInputValidation(procedureSemanticRetrievalRequestSchema),
          outputSchema: procedureSemanticRetrievalResultSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureSemanticRetrievalRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return mcpError(
              plannerGenerationErrorSchema.parse({
                error: 'planner_invalid_request',
                requestId: requestIdFromUnknown(requestInput),
                message: 'Procedure semantic retrieval request violates the strict public contract',
                retryMode: 'never',
              }),
            );
          }
          try {
            return mcpStructuredResult(
              await procedureSemanticRetrievalCoordinator!.search(parsedRequest.data),
            );
          } catch (error) {
            return mcpError(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.refinement.providers.list',
        {
          description:
            'List available providers for streamed semantic ProcedureTree refinement, including the exact runtime-treatment and input-policy attestations that a create request must authorize.',
          inputSchema: z.strictObject({}),
          outputSchema: procedureRefinementProviderDisclosureListSchema,
        },
        async () => mcpStructuredResult(procedureRefinementCoordinator!.listProviders()),
      );

      server.registerTool(
        'operatingline.procedure.refinement.semantic-context.get',
        {
          description:
            'Return the exact durable completion receipt needed to bind a prior Procedure semantic retrieval result into a refinement create request.',
          inputSchema: deferMcpInputValidation(
            procedureRefinementSemanticContextReceiptRequestSchema,
          ),
          outputSchema: procedureRefinementSemanticContextBindingSchema,
        },
        async (requestInput) => {
          const parsedRequest =
            procedureRefinementSemanticContextReceiptRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_refinement_semantic_context_receipt_request',
              message:
                'Procedure refinement semantic context receipt request violates the strict public contract',
            });
          }
          const receipt = procedureRefinementCoordinator!.getSemanticContextReceipt(
            parsedRequest.data.requestId,
          );
          return receipt === null
            ? mcpError({
                error: 'procedure_refinement_semantic_context_receipt_not_found',
                requestId: parsedRequest.data.requestId,
              })
            : mcpStructuredResult(receipt);
        },
      );

      server.registerTool(
        'operatingline.procedure.refinement.run.create',
        {
          description:
            'Create a durable streamed dialogue run that may produce a locally validated, reviewable ProcedureTree refinement. This never stores the candidate or starts host execution.',
          inputSchema: deferMcpInputValidation(procedureRefinementCreateRequestSchema),
          outputSchema: procedureRefinementRunStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureRefinementCreateRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_refinement_create_request',
              requestId: requestIdFromUnknown(requestInput),
              message: 'Procedure refinement create request violates the strict public contract',
            });
          }
          try {
            return mcpStructuredResult(procedureRefinementCoordinator!.create(parsedRequest.data));
          } catch (error) {
            return mcpError({
              error: 'procedure_refinement_create_failed',
              requestId: parsedRequest.data.runId,
              message:
                error instanceof Error ? error.message : 'Procedure refinement create failed',
            });
          }
        },
      );

      server.registerTool(
        'operatingline.procedure.refinement.run.status',
        {
          description:
            'Read the latest durable status and cumulative streamed assistant message for a ProcedureTree refinement run.',
          inputSchema: deferMcpInputValidation(procedureRefinementRunStatusRequestSchema),
          outputSchema: procedureRefinementRunStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureRefinementRunStatusRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_refinement_status_request',
              message: 'Procedure refinement status request violates the strict public contract',
            });
          }
          const status = procedureRefinementCoordinator!.get(parsedRequest.data.runId);
          return status === null
            ? mcpError({
                error: 'procedure_refinement_run_not_found',
                runId: parsedRequest.data.runId,
              })
            : mcpStructuredResult(status);
        },
      );

      server.registerTool(
        'operatingline.procedure.refinement.run.review',
        {
          description:
            'Atomically store or discard an exact review-bound ProcedureTree refinement preview. Storage never creates a proposal or starts host execution.',
          inputSchema: deferMcpInputValidation(procedureRefinementReviewRequestSchema),
          outputSchema: procedureRefinementRunStatusSchema,
        },
        async (requestInput) => {
          const parsedRequest = procedureRefinementReviewRequestSchema.safeParse(requestInput);
          if (!parsedRequest.success) {
            return mcpError({
              error: 'invalid_procedure_refinement_review_request',
              message: 'Procedure refinement review request violates the strict public contract',
            });
          }
          try {
            return mcpStructuredResult(procedureRefinementCoordinator!.review(parsedRequest.data));
          } catch (error) {
            return mcpError({
              error: 'procedure_refinement_review_failed',
              runId: parsedRequest.data.runId,
              message:
                error instanceof Error ? error.message : 'Procedure refinement review failed',
            });
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

    const registerProcedureTreeEditorRoute = (
      path: string,
      schema: z.ZodType,
      handler: (input: unknown) => unknown,
      options: { readonly nullIsNotFound?: boolean } = {},
    ): void => {
      runtimeApp.post(path, async (request, reply) => {
        const parsedRequest = schema.safeParse(request.body);
        if (!parsedRequest.success) {
          return reply.code(400).send({
            error: 'invalid_procedure_tree_editor_request',
            path,
            issues: parsedRequest.error.issues,
          });
        }
        try {
          const result = handler(parsedRequest.data);
          if (result === null && options.nullIsNotFound === true) {
            return reply.code(404).send({
              error: 'procedure_tree_editor_not_found',
              message: 'The requested ProcedureTree editor resource was not found',
            });
          }
          return result;
        } catch (error) {
          const expected = procedureTreeEditorHttpError(error);
          if (expected !== null) return reply.code(expected.statusCode).send(expected.body);
          request.log.error(error, 'ProcedureTree editor request failed');
          return reply.code(500).send({
            error: 'procedure_tree_editor_failed',
            message: 'ProcedureTree editor request failed',
          });
        }
      });
    };

    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/branches/create',
      procedureTreeEditorBranchCreateRequestSchema,
      (input) => procedureTreeEditorCoordinator.createBranch(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/branches/get',
      procedureTreeEditorBranchGetRequestSchema,
      (input) => procedureTreeEditorCoordinator.getBranch(input),
      { nullIsNotFound: true },
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/branches/list',
      procedureTreeEditorBranchListRequestSchema,
      (input) => procedureTreeEditorCoordinator.listBranches(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/workspaces/get',
      procedureTreeEditorWorkspaceRequestSchema,
      (input) => procedureTreeEditorCoordinator.workspace(input),
      { nullIsNotFound: true },
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/history/list',
      procedureTreeEditorBranchHistoryRequestSchema,
      (input) => procedureTreeEditorCoordinator.history(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/edits/preview',
      procedureTreeEditorEditPreviewRequestSchema,
      (input) => procedureTreeEditorCoordinator.previewEdit(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/merges/preview',
      procedureTreeEditorMergePreviewRequestSchema,
      (input) => procedureTreeEditorCoordinator.previewMerge(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/commits/create',
      procedureTreeEditorCommitRequestSchema,
      (input) => procedureTreeEditorCoordinator.commit(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/comments/create',
      procedureTreeEditorCommentCreateRequestSchema,
      (input) => procedureTreeEditorCoordinator.createComment(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/comments/list',
      procedureTreeEditorCommentListRequestSchema,
      (input) => procedureTreeEditorCoordinator.listComments(input),
    );
    registerProcedureTreeEditorRoute(
      '/api/v1/procedure/editor/parameters/form',
      procedureTreeEditorParameterFormRequestSchema,
      (input) => procedureTreeEditorCoordinator.parameterForm(input),
    );

    for (const path of [
      '/procedure-editor',
      '/procedure-editor/',
      '/procedure-editor/app.js',
      '/procedure-editor/styles.css',
    ]) {
      runtimeApp.get(path, async (_request, reply) => {
        const asset = resolveProcedureTreeEditorUiAsset(path);
        if (asset === undefined) return reply.code(404).send({ error: 'not_found' });
        return reply.headers(asset.headers).type(asset.contentType).send(asset.body);
      });
    }

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
    runtimeApp.get('/api/v1/procedure/tutorial/media/capabilities', async () =>
      procedureTutorialMediaCapabilitiesSchema.parse(tutorialMediaRuntime.capabilities),
    );
    runtimeApp.post('/api/v1/procedure/tutorial/media/jobs', async (request, reply) => {
      const parsedRequest = procedureTutorialMediaAnalysisRequestSchema.safeParse(request.body);
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_media_analysis_request',
          requestId,
          message: 'Tutorial media analysis request violates the strict public contract.',
        });
      }
      if (procedureTutorialMediaCoordinator === undefined) {
        return reply
          .code(503)
          .send(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
      }
      try {
        const job = procedureTutorialMediaCoordinator.create(parsedRequest.data);
        return reply
          .code(job.status === 'accepted' || job.status === 'running' ? 202 : 200)
          .send(job);
      } catch (error) {
        return reply
          .code(procedureTutorialMediaCoordinatorHttpStatus(error))
          .send(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/media/jobs/status', async (request, reply) => {
      const parsedRequest = procedureTutorialMediaJobStatusRequestSchema.safeParse(request.body);
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_media_job_status_request',
          requestId,
          message: 'Tutorial media job status request violates the strict public contract.',
        });
      }
      if (procedureTutorialMediaCoordinator === undefined) {
        return reply
          .code(503)
          .send(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
      }
      try {
        return procedureTutorialMediaCoordinator.status(
          parsedRequest.data.requestId,
          parsedRequest.data.jobId,
        );
      } catch (error) {
        return reply
          .code(procedureTutorialMediaCoordinatorHttpStatus(error))
          .send(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/media/jobs/restart', async (request, reply) => {
      const parsedRequest = procedureTutorialMediaResumeRequestSchema.safeParse(request.body);
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_media_restart_request',
          requestId,
          message: 'Tutorial media restart request violates the strict public contract.',
        });
      }
      if (procedureTutorialMediaCoordinator === undefined) {
        return reply
          .code(503)
          .send(tutorialMediaUnavailableResponse(requestId, tutorialMediaRuntime));
      }
      try {
        return reply.code(202).send(procedureTutorialMediaCoordinator.resume(parsedRequest.data));
      } catch (error) {
        return reply
          .code(procedureTutorialMediaCoordinatorHttpStatus(error))
          .send(procedureTutorialMediaCoordinatorErrorResponse(error, requestId));
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
    runtimeApp.post('/api/v1/procedure/tutorial/youtube/tracks/select', async (request, reply) => {
      const parsedRequest = procedureTutorialYoutubeTrackSelectionRequestSchema.safeParse(
        request.body,
      );
      if (!parsedRequest.success) {
        const requestIdInput =
          request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)['requestId']
            : null;
        const parsedRequestId = z.uuid().safeParse(requestIdInput);
        return reply.code(400).send({
          error: 'youtube_track_selection_invalid',
          requestId: parsedRequestId.success ? parsedRequestId.data : null,
          message: 'YouTube caption track selection request violates the strict public contract',
          retryMode: 'never',
        });
      }
      try {
        return procedureTutorialYoutubeTrackSelectionCoordinator!.select(parsedRequest.data);
      } catch (error) {
        return reply
          .code(procedureTutorialYoutubeTrackSelectionHttpStatus(error))
          .send(
            procedureTutorialYoutubeTrackSelectionErrorResponse(
              error,
              parsedRequest.data.requestId,
            ),
          );
      }
    });
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
    runtimeApp.post('/api/v1/procedure/tutorial/authoring/runs', async (request, reply) => {
      const parsedRequest = procedureTutorialAuthoringRunCreateRequestSchema.safeParse(
        request.body,
      );
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_authoring_run_create_request',
          requestId,
          message: 'Tutorial authoring run request violates the strict public contract.',
        });
      }
      try {
        const status = procedureTutorialAuthoringRunCoordinator!.create(parsedRequest.data);
        return reply
          .code(status.status === 'accepted' || status.status === 'running' ? 202 : 200)
          .send(status);
      } catch (error) {
        return reply
          .code(procedureTutorialAuthoringRunHttpStatus(error))
          .send(procedureTutorialAuthoringRunErrorResponse(error, requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/authoring/runs/status', async (request, reply) => {
      const parsedRequest = procedureTutorialAuthoringRunStatusRequestSchema.safeParse(
        request.body,
      );
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_authoring_run_status_request',
          requestId,
          message: 'Tutorial authoring status request violates the strict public contract.',
        });
      }
      try {
        return procedureTutorialAuthoringRunCoordinator!.status(parsedRequest.data);
      } catch (error) {
        return reply
          .code(procedureTutorialAuthoringRunHttpStatus(error))
          .send(procedureTutorialAuthoringRunErrorResponse(error, requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/authoring/runs/review', async (request, reply) => {
      const parsedRequest = procedureTutorialAuthoringReviewRequestSchema.safeParse(request.body);
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_authoring_review_request',
          requestId,
          message: 'Tutorial authoring review request violates the strict public contract.',
        });
      }
      try {
        const status = procedureTutorialAuthoringRunCoordinator!.review(parsedRequest.data);
        return reply.code(status.status === 'running' ? 202 : 200).send(status);
      } catch (error) {
        return reply
          .code(procedureTutorialAuthoringRunHttpStatus(error))
          .send(procedureTutorialAuthoringRunErrorResponse(error, requestId));
      }
    });
    runtimeApp.post('/api/v1/procedure/tutorial/authoring/runs/resume', async (request, reply) => {
      const parsedRequest = procedureTutorialAuthoringResumeRequestSchema.safeParse(request.body);
      const requestId = requestIdFromUnknown(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_tutorial_authoring_resume_request',
          requestId,
          message: 'Tutorial authoring resume request violates the strict public contract.',
        });
      }
      try {
        const status = procedureTutorialAuthoringRunCoordinator!.resume(parsedRequest.data);
        return reply.code(status.status === 'running' ? 202 : 200).send(status);
      } catch (error) {
        return reply
          .code(procedureTutorialAuthoringRunHttpStatus(error))
          .send(procedureTutorialAuthoringRunErrorResponse(error, requestId));
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
    runtimeApp.get('/api/v1/procedure/semantic/providers', async () =>
      procedureSemanticRetrievalCoordinator!.listProviders(),
    );
    runtimeApp.post('/api/v1/procedure/semantic/search', async (request, reply) => {
      const parsedRequest = procedureSemanticRetrievalRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send(
          plannerGenerationErrorSchema.parse({
            error: 'planner_invalid_request',
            requestId: requestIdFromUnknown(request.body),
            message: 'Procedure semantic retrieval request violates the strict public contract',
            retryMode: 'never',
          }),
        );
      }
      try {
        return await procedureSemanticRetrievalCoordinator!.search(parsedRequest.data);
      } catch (error) {
        return reply
          .code(plannerGenerationHttpStatus(error))
          .send(plannerGenerationErrorResponse(error, parsedRequest.data.requestId));
      }
    });
    runtimeApp.get('/api/v1/procedure/refinement/providers', async () =>
      procedureRefinementCoordinator!.listProviders(),
    );
    runtimeApp.get(
      '/api/v1/procedure/refinement/semantic-context/:requestId',
      async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const parsedRequest = procedureRefinementSemanticContextReceiptRequestSchema.safeParse({
          ...query,
          ...(request.params as Record<string, unknown>),
        });
        if (!parsedRequest.success || Object.hasOwn(query, 'requestId')) {
          return reply.code(400).send({
            error: 'invalid_procedure_refinement_semantic_context_receipt_request',
            issues: parsedRequest.success ? [] : parsedRequest.error.issues,
          });
        }
        const receipt = procedureRefinementCoordinator!.getSemanticContextReceipt(
          parsedRequest.data.requestId,
        );
        return receipt === null
          ? reply.code(404).send({
              error: 'procedure_refinement_semantic_context_receipt_not_found',
              requestId: parsedRequest.data.requestId,
            })
          : receipt;
      },
    );
    runtimeApp.post('/api/v1/procedure/refinement/runs', async (request, reply) => {
      const parsedRequest = procedureRefinementCreateRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_refinement_create_request',
          requestId: requestIdFromUnknown(request.body),
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return reply.code(202).send(procedureRefinementCoordinator!.create(parsedRequest.data));
      } catch (error) {
        return reply.code(409).send({
          error: 'procedure_refinement_create_failed',
          requestId: parsedRequest.data.runId,
          message: error instanceof Error ? error.message : 'Procedure refinement create failed',
        });
      }
    });
    runtimeApp.get('/api/v1/procedure/refinement/runs/:runId', async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const parsedRequest = procedureRefinementRunStatusRequestSchema.safeParse({
        ...query,
        ...(request.params as Record<string, unknown>),
      });
      if (!parsedRequest.success || Object.hasOwn(query, 'runId')) {
        return reply.code(400).send({
          error: 'invalid_procedure_refinement_status_request',
          issues: parsedRequest.success ? [] : parsedRequest.error.issues,
        });
      }
      const status = procedureRefinementCoordinator!.get(parsedRequest.data.runId);
      return status === null
        ? reply.code(404).send({
            error: 'procedure_refinement_run_not_found',
            runId: parsedRequest.data.runId,
          })
        : status;
    });
    runtimeApp.post('/api/v1/procedure/refinement/reviews', async (request, reply) => {
      const parsedRequest = procedureRefinementReviewRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_procedure_refinement_review_request',
          issues: parsedRequest.error.issues,
        });
      }
      try {
        return procedureRefinementCoordinator!.review(parsedRequest.data);
      } catch (error) {
        return reply.code(409).send({
          error: 'procedure_refinement_review_failed',
          runId: parsedRequest.data.runId,
          message: error instanceof Error ? error.message : 'Procedure refinement review failed',
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
    runtimeApp.get('/api/v1/companion/action', async (request, reply) => {
      const parsedRequest = companionActionPollRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'invalid_action_poll_request',
          message: 'Companion action poll violates the strict public contract',
        });
      }
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      if (typeof leaseHeader !== 'string') {
        return reply.code(409).send({
          error: 'companion_lease_required',
          message: 'Action execution delivery requires a negotiated Companion lease',
        });
      }
      try {
        const session = companionLeaseManager.authorize(
          leaseHeader,
          parsedRequest.data.adapterId,
          parsedRequest.data.instanceId,
        );
        if (session.lease.negotiatedGuideProtocolVersion !== '1.5.0') {
          return reply.code(409).send({
            error: 'action_execution_protocol_unsupported',
            message: 'Action execution requires Guide protocol 1.5 native Undo evidence',
          });
        }
        const sessionFingerprintSha256 = createHash('sha256').update(leaseHeader).digest('hex');
        const delivery = actionExecutionCoordinator.poll(
          parsedRequest.data.adapterId,
          parsedRequest.data.instanceId,
          sessionFingerprintSha256,
        );
        return companionActionPollDeliverySchema.parse({ request: delivery });
      } catch (error) {
        if (error instanceof CompanionLeaseError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        if (error instanceof BlenderActionExecutionError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    });
    runtimeApp.post('/api/v1/companion/action-result', async (request, reply) => {
      const parsedResult = companionActionExecutionResultSchema.safeParse(request.body);
      if (!parsedResult.success) {
        return reply.code(400).send({
          error: 'invalid_action_execution_result',
          message: 'Companion action result violates the strict public contract',
        });
      }
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      if (typeof leaseHeader !== 'string') {
        return reply.code(409).send({
          error: 'companion_lease_required',
          message: 'Action execution results require a negotiated Companion lease',
        });
      }
      try {
        const session = companionLeaseManager.authorize(
          leaseHeader,
          parsedResult.data.target.adapterId,
          parsedResult.data.target.instanceId,
        );
        if (session.lease.negotiatedGuideProtocolVersion !== '1.5.0') {
          return reply.code(409).send({
            error: 'action_execution_protocol_unsupported',
            message: 'Action execution results require Guide protocol 1.5 evidence',
          });
        }
        const sessionFingerprintSha256 = createHash('sha256').update(leaseHeader).digest('hex');
        const result = actionExecutionCoordinator.complete(
          parsedResult.data,
          sessionFingerprintSha256,
          (candidate, execution) =>
            validateBlenderActionExecutionResult(candidate, sessionFingerprintSha256, execution),
        );
        return companionActionResultAckSchema.parse({ result });
      } catch (error) {
        if (error instanceof CompanionLeaseError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        if (error instanceof BlenderActionExecutionError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        }
        throw error;
      }
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
        tutorialMedia: tutorialMediaRuntime.capabilities,
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
  type ProcedureAuthoringGenerationCompletedEvidence,
  type ProcedureAuthoringGenerationCoordinator,
  type ProcedureAuthoringGenerationCoordinatorOptions,
} from './procedure-authoring-generation.js';
export {
  createProcedureTutorialAuthoringRunCoordinator,
  procedureTutorialAuthoringRunErrorResponse,
  procedureTutorialAuthoringRunEvidenceEventTypes,
  procedureTutorialAuthoringRunHttpStatus,
  ProcedureTutorialAuthoringRunError,
  type ProcedureTutorialAuthoringRunCoordinator,
  type ProcedureTutorialAuthoringRunCoordinatorOptions,
  type ProcedureTutorialAuthoringRunErrorCode,
} from './procedure-tutorial-authoring-run.js';
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
  createProcedureTutorialMediaCoordinator,
  procedureTutorialMediaCoordinatorErrorResponse,
  procedureTutorialMediaCoordinatorHttpStatus,
  procedureTutorialMediaEvidenceEventTypes,
  ProcedureTutorialMediaCoordinatorError,
  type ProcedureTutorialMediaCoordinator,
  type ProcedureTutorialMediaCoordinatorErrorCode,
  type ProcedureTutorialMediaCoordinatorOptions,
} from './procedure-tutorial-media-coordinator.js';
export {
  createProcedureTutorialMediaRuntime,
  createProcedureTutorialMediaRuntimeFromEnvironment,
  type ProcedureTutorialMediaRuntime,
  type ProcedureTutorialMediaRuntimeConfiguration,
  type ProcedureTutorialMediaRuntimeEnvironment,
} from './procedure-tutorial-media-runtime.js';
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
  buildProcedureTutorialYoutubeTrackSelection,
  createProcedureTutorialYoutubeTrackSelectionCoordinator,
  procedureTutorialYoutubeTrackSelectionErrorResponse,
  procedureTutorialYoutubeTrackSelectionEvidenceEventTypes,
  procedureTutorialYoutubeTrackSelectionHttpStatus,
  restoreProcedureTutorialYoutubeTrackSelections,
  ProcedureTutorialYoutubeTrackSelectionError,
  type ProcedureTutorialYoutubeTrackSelectionCoordinator,
  type ProcedureTutorialYoutubeTrackSelectionCoordinatorOptions,
  type ProcedureTutorialYoutubeTrackSelectionRetryMode,
} from './procedure-tutorial-youtube-track-selection.js';
export {
  createYouTubeDataApiCaptionSource,
  parseYouTubeDurationMs,
  ProcedureTutorialYoutubeSourceError,
  type ProcedureTutorialYoutubeCaptionAcquisitionResult,
  type ProcedureTutorialYoutubeCaptionSource,
  type ProcedureTutorialYoutubeCaptionTrackListSourceResult,
  type ProcedureTutorialYoutubeSourceErrorCode,
  type YouTubeOAuthAccessTokenProvider,
  type YouTubeDataApiCaptionSourceOptions,
} from './youtube-caption-source.js';
export {
  createDefaultYouTubeOAuthCredentialStore,
  YouTubeOAuthCredentialStoreError,
  type YouTubeOAuthCredentialCommand,
  type YouTubeOAuthCredentialCommandResult,
  type YouTubeOAuthCredentialCommandRunner,
  type YouTubeOAuthCredentialStore,
  type YouTubeOAuthCredentialStoreErrorCode,
} from './youtube-oauth-credential-store.js';
export {
  authorizeYouTubeOAuthInstalledApp,
  createYouTubeOAuthAuthorizationUrl,
  type YouTubeOAuthAuthorizationUrlOptions,
  type YouTubeOAuthInstalledAppAuthorizationOptions,
} from './youtube-oauth-flow.js';
export {
  createYouTubeOAuthOperationLock,
  YouTubeOAuthOperationLockError,
  type YouTubeOAuthOperationLock,
  type YouTubeOAuthOperationLockOptions,
} from './youtube-oauth-operation-lock.js';
export {
  createYouTubeOAuthAccessTokenProvider,
  exchangeYouTubeOAuthAuthorizationCode,
  getYouTubeOAuthAuthorizationStatus,
  logoutYouTubeOAuth,
  parseYouTubeOAuthClientId,
  parseYouTubeOAuthLoopbackRedirectUri,
  youtubeOAuthAuthorizationEndpoint,
  youtubeOAuthCredentialAccountId,
  youtubeOAuthRevocationEndpoint,
  youtubeOAuthScope,
  youtubeOAuthTokenEndpoint,
  YouTubeOAuthOperationError,
  type YouTubeOAuthAuthorizationCodeExchangeOptions,
  type YouTubeOAuthAuthorizationCodeExchangeResult,
  type YouTubeOAuthAuthorizationStatus,
  type YouTubeOAuthLogoutOptions,
  type YouTubeOAuthLogoutResult,
  type YouTubeOAuthOperationErrorCode,
  type YouTubeOAuthTokenProviderOptions,
} from './youtube-oauth.js';
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
  createProcedureSemanticRetrievalCoordinator,
  procedureSemanticRetrievalEvidenceEventTypes,
  restoreProcedureSemanticRetrievalInvocations,
} from './procedure-semantic-retrieval.js';
export {
  computeProcedureTreeThreeWayMerge,
  diffProcedureTrees,
  type ProcedureTreeDiffEntry,
  type ProcedureTreeMergeConflict,
  type ProcedureTreeThreeWayMerge,
} from './procedure-tree-editor.js';
export { applyProcedureTreeEditorMutationPolicy } from './procedure-tree-editor-mutation-policy.js';
export {
  createProcedureTreeEditorCoordinator,
  ProcedureTreeEditorError,
  type ProcedureTreeEditorCoordinator,
  type ProcedureTreeEditorCoordinatorOptions,
  type ProcedureTreeEditorErrorCode,
} from './procedure-tree-editor-coordinator.js';
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
