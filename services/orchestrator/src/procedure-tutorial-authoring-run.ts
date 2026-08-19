import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  computeProcedureTutorialAuthoringBindingContentSha256,
  plannerProviderDescriptorSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketSchema,
  procedureTreeStoreResultSchema,
  procedureTutorialAuthoringBindingSchema,
  procedureTutorialAuthoringCompletedEventSchema,
  procedureTutorialAuthoringDiscardedEventSchema,
  procedureTutorialAuthoringFailedEventSchema,
  procedureTutorialAuthoringRecoveryRequiredEventSchema,
  procedureTutorialAuthoringRequestedEventSchema,
  procedureTutorialAuthoringResumedEventSchema,
  procedureTutorialAuthoringReviewRequiredEventSchema,
  procedureTutorialAuthoringReviewedEventSchema,
  procedureTutorialAuthoringReviewRequestSchema,
  procedureTutorialAuthoringRunCreateRequestSchema,
  procedureTutorialAuthoringRunFormatVersion,
  procedureTutorialAuthoringRunStatusRequestSchema,
  procedureTutorialAuthoringRunStatusSchema,
  procedureTutorialAuthoringStageEventSchema,
  type PlannerProviderDescriptor,
  type ProcedureAuthoringGenerationResult,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureAuthoringPromptPacket,
  type ProcedureAuthoringCandidateTree,
  type ProcedureTree,
  type ProcedureTreeStoreResult,
  type ProcedureTutorialAuthoringBinding,
  type ProcedureTutorialAuthoringCompletedEvent,
  type ProcedureTutorialAuthoringResumeRequest,
  type ProcedureTutorialAuthoringReviewRequest,
  type ProcedureTutorialAuthoringRunCreateRequest,
  type ProcedureTutorialAuthoringRunStatus,
  type ProcedureTutorialAuthoringStage,
} from '@operatingline/protocol';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import type { ProcedureAuthoringGenerationCompletedEvidence } from './procedure-authoring-generation.js';

export const procedureTutorialAuthoringRunEvidenceEventTypes = [
  'procedure.tutorial.authoring.requested',
  'procedure.tutorial.authoring.stage.started',
  'procedure.tutorial.authoring.stage.completed',
  'procedure.tutorial.authoring.review.required',
  'procedure.tutorial.authoring.reviewed',
  'procedure.tutorial.authoring.recovery.required',
  'procedure.tutorial.authoring.resumed',
  'procedure.tutorial.authoring.discarded',
  'procedure.tutorial.authoring.failed',
  'procedure.tutorial.authoring.completed',
] as const;

type AuthoringEvidenceEventType = (typeof procedureTutorialAuthoringRunEvidenceEventTypes)[number];
type LocalRecoveryStage = 'materialization' | 'storage';

export type ProcedureTutorialAuthoringRunErrorCode =
  | 'invalid_request'
  | 'run_not_found'
  | 'run_conflict'
  | 'provider_not_found'
  | 'provider_unavailable'
  | 'provider_version_mismatch'
  | 'provider_descriptor_mismatch'
  | 'review_not_pending'
  | 'review_conflict'
  | 'review_evidence_mismatch'
  | 'review_timestamp_invalid'
  | 'recovery_not_required'
  | 'recovery_conflict'
  | 'runtime_stopping'
  | 'authoring_persistence_failed'
  | 'authoring_runtime_failed';

export class ProcedureTutorialAuthoringRunError extends Error {
  constructor(
    readonly code: ProcedureTutorialAuthoringRunErrorCode,
    message: string,
    readonly statusCode: 400 | 404 | 409 | 422 | 500 | 503,
  ) {
    super(message);
    this.name = 'ProcedureTutorialAuthoringRunError';
  }
}

export interface ProcedureTutorialAuthoringRunCoordinatorOptions {
  readonly importCaption: (
    request: ProcedureTutorialAuthoringRunCreateRequest['source']['captionImport'],
  ) => Promise<ProcedureAuthoringPromptPacket>;
  readonly completedPacket: (requestId: string) => ProcedureAuthoringPromptPacket | null;
  readonly generateFromPacket: (input: {
    readonly requestId: string;
    readonly providerId: string;
    readonly packet: ProcedureAuthoringPromptPacket;
  }) => Promise<ProcedureAuthoringGenerationResult>;
  readonly completedGenerationEvidence: (
    requestId: string,
  ) => ProcedureAuthoringGenerationCompletedEvidence | null;
  readonly materialize: (input: {
    readonly packet: ProcedureAuthoringPromptPacket;
    readonly tree: ProcedureAuthoringCandidateTree;
  }) => ProcedureAuthoringMaterializationResult;
  readonly storeWithBinding: (input: {
    readonly tree: ProcedureTree;
    readonly binding: ProcedureTutorialAuthoringBinding;
    readonly completedEvent: ExecutionEventInput & { readonly createdAt: string };
  }) => ProcedureTreeStoreResult;
  readonly restoreStored: (input: {
    readonly binding: ProcedureTutorialAuthoringBinding;
    readonly completedEvent: ExecutionEventInput & { readonly createdAt: string };
  }) =>
    | { readonly status: 'completed'; readonly storage: ProcedureTreeStoreResult }
    | { readonly status: 'absent' | 'invalid' };
  readonly isStorageFailureRetryable?: (error: unknown) => boolean;
  readonly findProcedureAuthor: (providerId: string) => PlannerProviderDescriptor | null;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly appendEvent: (event: ExecutionEventInput) => void;
  readonly now?: () => string;
  readonly maxConcurrency?: number;
}

export interface ProcedureTutorialAuthoringRunCoordinator {
  create(request: ProcedureTutorialAuthoringRunCreateRequest): ProcedureTutorialAuthoringRunStatus;
  status(request: {
    readonly formatVersion: typeof procedureTutorialAuthoringRunFormatVersion;
    readonly requestId: string;
    readonly runId: string;
  }): ProcedureTutorialAuthoringRunStatus;
  review(request: ProcedureTutorialAuthoringReviewRequest): ProcedureTutorialAuthoringRunStatus;
  resume(request: ProcedureTutorialAuthoringResumeRequest): ProcedureTutorialAuthoringRunStatus;
  beginClose(): void;
  close(): Promise<void>;
}

interface RunState {
  request: ProcedureTutorialAuthoringRunCreateRequest;
  requestFingerprint: string;
  runId: string;
  acceptedAt: string;
  updatedAt: string;
  completedStages: ProcedureTutorialAuthoringStage[];
  currentStage?: ProcedureTutorialAuthoringStage;
  startedAt?: string;
  storageStartedAt?: string;
  storageAttemptedAt?: string;
  packet?: ProcedureAuthoringPromptPacket;
  generation?: ProcedureAuthoringGenerationResult;
  generationEvidence?: ProcedureAuthoringGenerationCompletedEvidence;
  materialization?: ProcedureAuthoringMaterializationResult;
  reviewId?: string;
  awaitingReviewSince?: string;
  review?: ProcedureTutorialAuthoringReviewRequest;
  recoveryId?: string;
  retryFromStage?: LocalRecoveryStage;
  recoveryError?: SafeStageError;
  resumedReceipts: ProcedureTutorialAuthoringResumeRequest[];
  failed?: { readonly error: SafeStageError; readonly failedAt: string };
  fatalError?: ProcedureTutorialAuthoringRunError;
  discardedAt?: string;
  completed?: {
    readonly event: ProcedureTutorialAuthoringCompletedEvent;
    storage: ProcedureTreeStoreResult;
  };
}

interface SafeStageError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage: ProcedureTutorialAuthoringStage;
}

const safeExternalFailureMessage =
  'The authoring run stopped at an external stage and was not retried automatically.';
const safeLocalFailureMessage =
  'The deterministic authoring stage could not complete and requires an exact recovery receipt.';

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function cloneStatus(
  status: ProcedureTutorialAuthoringRunStatus,
): ProcedureTutorialAuthoringRunStatus {
  return structuredClone(status);
}

function completedStorageResult(storage: ProcedureTreeStoreResult): ProcedureTreeStoreResult {
  return procedureTreeStoreResultSchema.parse({ ...storage, result: 'accepted' });
}

function common(state: RunState) {
  return {
    formatVersion: procedureTutorialAuthoringRunFormatVersion,
    requestId: state.request.requestId,
    requestFingerprint: state.requestFingerprint,
    runId: state.runId,
    updatedAt: state.updatedAt,
  } as const;
}

function identity(state: RunState) {
  return {
    formatVersion: procedureTutorialAuthoringRunFormatVersion,
    requestId: state.request.requestId,
    requestFingerprint: state.requestFingerprint,
    runId: state.runId,
  } as const;
}

function publicStatus(state: RunState): ProcedureTutorialAuthoringRunStatus {
  if (state.fatalError !== undefined) throw state.fatalError;
  const base = common(state);
  if (state.completed !== undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'completed',
      completedStages: ['caption_import', 'provider_generation', 'materialization', 'storage'],
      result: {
        ...identity(state),
        binding: state.completed.event.binding,
        storage: state.completed.storage,
        sideEffects: {
          captionNetworkFetched: true,
          captionContentDownloaded: true,
          providerCalled: true,
          procedureStored: true,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        completedAt: state.completed.event.completedAt,
      },
    });
  }
  if (state.discardedAt !== undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'discarded',
      completedStages: state.completedStages,
      reviewId: state.reviewId,
      discardedAt: state.discardedAt,
    });
  }
  if (state.failed !== undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'failed',
      completedStages: state.completedStages,
      error: state.failed.error,
      failedAt: state.failed.failedAt,
    });
  }
  if (state.recoveryId !== undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'recovery_required',
      completedStages: state.completedStages,
      recoveryId: state.recoveryId,
      retryFromStage: state.retryFromStage,
      error: state.recoveryError,
    });
  }
  if (state.reviewId !== undefined && state.review === undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'awaiting_review',
      completedStages: state.completedStages,
      reviewId: state.reviewId,
      preview: { generation: state.generation, materialization: state.materialization },
      awaitingReviewSince: state.awaitingReviewSince,
    });
  }
  if (state.currentStage !== undefined) {
    return procedureTutorialAuthoringRunStatusSchema.parse({
      ...base,
      status: 'running',
      currentStage: state.currentStage,
      completedStages: state.completedStages,
      startedAt: state.startedAt,
    });
  }
  if (state.completedStages.length !== 0) {
    throw new Error('Authoring run has an incomplete checkpoint without a public status');
  }
  return procedureTutorialAuthoringRunStatusSchema.parse({
    ...base,
    status: 'accepted',
    completedStages: [],
    acceptedAt: state.acceptedAt,
  });
}

function materializationSummary(result: ProcedureAuthoringMaterializationResult) {
  const { tree: _tree, compilation: _compilation, ...summary } = result;
  void _tree;
  void _compilation;
  return summary;
}

function selectionFingerprint(packet: ProcedureAuthoringPromptPacket): string {
  const selection = packet.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
  if (selection === undefined) {
    throw new Error('Prepared tutorial packet is missing selected-caption provenance');
  }
  return selection.requestFingerprint;
}

function assertSelectedCaptionPacketRequest(
  request: ProcedureTutorialAuthoringRunCreateRequest,
  packet: ProcedureAuthoringPromptPacket,
): void {
  const captionImport = request.source.captionImport;
  const acquisition = packet.context.tutorialProvenance?.transcript.document?.acquisition;
  const selection = acquisition?.selection;
  if (
    acquisition === undefined ||
    selection === undefined ||
    selection.requestId !== captionImport.selectionRequestId ||
    acquisition.videoId !== captionImport.youtube.videoId ||
    acquisition.captionTrackId !== captionImport.youtube.captionTrackId ||
    acquisition.requestedFormat !== captionImport.youtube.requestedFormat ||
    (captionImport.youtube.expectedTrackLanguage !== undefined &&
      acquisition.trackLanguage !== captionImport.youtube.expectedTrackLanguage) ||
    packet.context.requestedTreeId !== captionImport.treeId ||
    packet.context.recommendedRevision !== captionImport.revision ||
    packet.context.catalogBinding.adapterId !== captionImport.targetAdapterId ||
    packet.context.catalogBinding.actionCatalog.catalogVersion !==
      captionImport.actionCatalogVersion ||
    packet.context.catalogBinding.interactionCatalog.catalogVersion !==
      captionImport.interactionCatalogVersion
  ) {
    throw new Error('Prepared tutorial packet does not match the exact selected-caption request');
  }
}

function assertStageResultCoherence(state: RunState): void {
  const packet = procedureAuthoringPromptPacketSchema.parse(state.packet);
  const generation = procedureAuthoringGenerationResultSchema.parse(state.generation);
  const materialization = procedureAuthoringMaterializationResultSchema.parse(
    state.materialization,
  );
  const request = state.request;
  assertSelectedCaptionPacketRequest(request, packet);
  const generationEvidence = state.generationEvidence;
  const preparedGenerationEvent =
    generationEvidence !== undefined &&
    'inputMode' in generationEvidence.event &&
    generationEvidence.event.inputMode === 'prepared_packet'
      ? generationEvidence.event
      : undefined;
  const expectedGenerationRequestFingerprint = plannerProviderRequestFingerprint({
    requestId: request.provider.generationRequestId,
    providerId: request.provider.authorization.providerDescriptor.id,
    packet,
  });
  if (
    generationEvidence === undefined ||
    generationEvidence.eventId !==
      `procedure-authoring-generation-completed:${request.provider.generationRequestId}` ||
    preparedGenerationEvent === undefined ||
    preparedGenerationEvent.request.requestId !== request.provider.generationRequestId ||
    preparedGenerationEvent.request.providerId !==
      request.provider.authorization.providerDescriptor.id ||
    preparedGenerationEvent.request.packetContentSha256 !== packet.integrity.contentSha256 ||
    preparedGenerationEvent.requestFingerprint !== expectedGenerationRequestFingerprint ||
    !isDeepStrictEqual(preparedGenerationEvent.result, generation) ||
    generation.requestId !== request.provider.generationRequestId ||
    generation.provider.id !== request.provider.authorization.providerDescriptor.id ||
    generation.provider.version !== request.provider.authorization.providerDescriptor.version ||
    generation.packet.integrity.contentSha256 !== packet.integrity.contentSha256 ||
    !isDeepStrictEqual(generation.packet, packet) ||
    materialization.packetContentSha256 !== packet.integrity.contentSha256 ||
    materialization.inputTreeContentSha256 !== sha256(generation.tree) ||
    materialization.outputTreeContentSha256 !== sha256(materialization.tree)
  ) {
    throw new Error('Authoring stage evidence does not bind the exact selected-caption run');
  }
}

function completedEventInput(
  state: RunState,
  binding: ProcedureTutorialAuthoringBinding,
  completedAt: string,
): ExecutionEventInput & { readonly createdAt: string } {
  return {
    id: `procedure-tutorial-authoring-completed:${state.runId}`,
    eventType: 'procedure.tutorial.authoring.completed',
    payload: procedureTutorialAuthoringCompletedEventSchema.parse({
      ...identity(state),
      binding,
      completedAt,
    }),
    createdAt: completedAt,
  };
}

function buildBinding(state: RunState): ProcedureTutorialAuthoringBinding {
  assertStageResultCoherence(state);
  const packet = state.packet!;
  const generation = state.generation!;
  const materialization = state.materialization!;
  const review = state.review!;
  if (review.review.decision !== 'store') throw new Error('Storage requires an exact store review');
  const content = {
    ...identity(state),
    source: {
      kind: 'selected_youtube_caption' as const,
      captionImportRequestId: state.request.source.captionImport.requestId,
      captionImportRequestFingerprint: plannerProviderRequestFingerprint(
        state.request.source.captionImport,
      ),
      selectionRequestId: state.request.source.captionImport.selectionRequestId,
      selectionRequestFingerprint: selectionFingerprint(packet),
      videoId: state.request.source.captionImport.youtube.videoId,
      captionTrackId: state.request.source.captionImport.youtube.captionTrackId,
      packetContentSha256: packet.integrity.contentSha256,
    },
    generation: {
      requestId: generation.requestId,
      requestFingerprint: plannerProviderRequestFingerprint({
        requestId: state.request.provider.generationRequestId,
        providerId: state.request.provider.authorization.providerDescriptor.id,
        packet,
      }),
      generationId: generation.generationId,
      providerId: generation.provider.id,
      providerVersion: generation.provider.version,
      providerDescriptorContentSha256: sha256(
        state.request.provider.authorization.providerDescriptor,
      ),
      completedEventId: state.generationEvidence!.eventId,
      completedEventContentSha256: sha256(state.generationEvidence!.event),
      ...(state.generationEvidence!.event.runtimeAttestation === undefined
        ? {}
        : {
            runtimeAttestationContentSha256: sha256(
              state.generationEvidence!.event.runtimeAttestation,
            ),
          }),
      candidateTreeContentSha256: materialization.inputTreeContentSha256,
    },
    materialization: materializationSummary(materialization),
    review: {
      requestId: review.requestId,
      reviewId: review.reviewId,
      packetContentSha256: review.review.packetContentSha256,
      candidateTreeContentSha256: review.review.candidateTreeContentSha256,
      materializedTreeContentSha256: review.review.materializedTreeContentSha256,
      reviewedAt: review.reviewedAt,
    },
    storage: {
      treeId: materialization.tree.id,
      revision: materialization.tree.revision,
      contentSha256: materialization.outputTreeContentSha256,
    },
  };
  return procedureTutorialAuthoringBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureTutorialAuthoringBindingContentSha256(content),
    },
  });
}

function safeRequestError(error: unknown): ProcedureTutorialAuthoringRunError {
  if (error instanceof ProcedureTutorialAuthoringRunError) return error;
  return new ProcedureTutorialAuthoringRunError(
    'authoring_runtime_failed',
    'The Procedure tutorial authoring request could not be completed safely.',
    500,
  );
}

export function procedureTutorialAuthoringRunHttpStatus(
  error: unknown,
): 400 | 404 | 409 | 422 | 500 | 503 {
  return safeRequestError(error).statusCode;
}

export function procedureTutorialAuthoringRunErrorResponse(
  error: unknown,
  requestId: string | null,
) {
  const safe = safeRequestError(error);
  return { error: safe.code, requestId, message: safe.message } as const;
}

export function createProcedureTutorialAuthoringRunCoordinator(
  options: ProcedureTutorialAuthoringRunCoordinatorOptions,
): ProcedureTutorialAuthoringRunCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const concurrency = options.maxConcurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('Procedure tutorial authoring concurrency must be an integer from 1 through 8');
  }
  const runs = new Map<string, RunState>();
  const tasks = new Set<Promise<void>>();
  const queue: Array<() => Promise<void>> = [];
  let active = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const append = (event: ExecutionEventInput): void => {
    try {
      options.appendEvent(event);
    } catch {
      throw new ProcedureTutorialAuthoringRunError(
        'authoring_persistence_failed',
        'Procedure tutorial authoring evidence could not be persisted.',
        500,
      );
    }
  };
  const scopedPayload = (state: RunState, occurredAt: string) => ({
    ...identity(state),
    occurredAt,
  });
  const stageEvent = (
    state: RunState,
    stage: ProcedureTutorialAuthoringStage,
    stateValue: 'started' | 'completed',
    occurredAt: string,
  ) => ({
    id: `procedure-tutorial-authoring-${stage}-${stateValue}:${state.runId}:${randomUUID()}`,
    eventType: `procedure.tutorial.authoring.stage.${stateValue}`,
    payload: procedureTutorialAuthoringStageEventSchema.parse({
      ...scopedPayload(state, occurredAt),
      stage,
      state: stateValue,
    }),
    createdAt: occurredAt,
  });
  const startStage = (state: RunState, stage: ProcedureTutorialAuthoringStage): void => {
    const occurredAt = now();
    append(stageEvent(state, stage, 'started', occurredAt));
    state.currentStage = stage;
    state.startedAt = occurredAt;
    if (stage === 'storage' && state.storageStartedAt === undefined) {
      state.storageStartedAt = occurredAt;
    }
    state.updatedAt = occurredAt;
  };
  const completeStage = (state: RunState, stage: ProcedureTutorialAuthoringStage): void => {
    if (state.currentStage !== stage) throw new Error('Authoring stage completion is out of order');
    const occurredAt = now();
    append(stageEvent(state, stage, 'completed', occurredAt));
    state.completedStages.push(stage);
    delete state.currentStage;
    delete state.startedAt;
    state.updatedAt = occurredAt;
  };
  const fail = (state: RunState, stage: ProcedureTutorialAuthoringStage): void => {
    const occurredAt = now();
    const error: SafeStageError = {
      code: 'authoring_stage_failed',
      message: safeExternalFailureMessage,
      retryable: false,
      stage,
    };
    append({
      id: `procedure-tutorial-authoring-failed:${state.runId}`,
      eventType: 'procedure.tutorial.authoring.failed',
      payload: procedureTutorialAuthoringFailedEventSchema.parse({
        ...scopedPayload(state, occurredAt),
        completedStages: state.completedStages,
        error,
      }),
      createdAt: occurredAt,
    });
    delete state.currentStage;
    state.failed = { error, failedAt: occurredAt };
    state.updatedAt = occurredAt;
  };
  const markUnresolvedStorageIntegrity = (state: RunState): void => {
    state.fatalError = new ProcedureTutorialAuthoringRunError(
      'authoring_persistence_failed',
      'Stored completion evidence could not be reconciled safely.',
      500,
    );
  };
  const requireRecovery = (state: RunState, stage: LocalRecoveryStage): void => {
    if (
      stage === 'materialization' &&
      state.currentStage === undefined &&
      state.completedStages.length === 3 &&
      state.reviewId === undefined
    ) {
      state.completedStages.pop();
    }
    if (stage === 'storage') delete state.storageAttemptedAt;
    const occurredAt = now();
    const recoveryId = state.recoveryId ?? randomUUID();
    const error: SafeStageError = {
      code: 'authoring_local_recovery_required',
      message: safeLocalFailureMessage,
      retryable: true,
      stage,
    };
    append({
      id: `procedure-tutorial-authoring-recovery-required:${state.runId}:${recoveryId}`,
      eventType: 'procedure.tutorial.authoring.recovery.required',
      payload: procedureTutorialAuthoringRecoveryRequiredEventSchema.parse({
        ...scopedPayload(state, occurredAt),
        recoveryId,
        retryFromStage: stage,
        error,
      }),
      createdAt: occurredAt,
    });
    delete state.currentStage;
    state.recoveryId = recoveryId;
    state.retryFromStage = stage;
    state.recoveryError = error;
    state.updatedAt = occurredAt;
  };
  const requireReview = (state: RunState): void => {
    assertStageResultCoherence(state);
    const occurredAt = now();
    const reviewId = randomUUID();
    append({
      id: `procedure-tutorial-authoring-review-required:${state.runId}`,
      eventType: 'procedure.tutorial.authoring.review.required',
      payload: procedureTutorialAuthoringReviewRequiredEventSchema.parse({
        ...scopedPayload(state, occurredAt),
        reviewId,
        generation: state.generation,
        materialization: state.materialization,
      }),
      createdAt: occurredAt,
    });
    state.reviewId = reviewId;
    state.awaitingReviewSince = occurredAt;
    state.updatedAt = occurredAt;
  };

  const store = (state: RunState): void => {
    if (state.currentStage !== 'storage') startStage(state, 'storage');
    const storageAttemptedAt = state.storageAttemptedAt ?? now();
    state.storageAttemptedAt = storageAttemptedAt;
    let binding: ProcedureTutorialAuthoringBinding;
    let completedEvent: ExecutionEventInput & { readonly createdAt: string };
    try {
      binding = buildBinding(state);
      completedEvent = completedEventInput(state, binding, storageAttemptedAt);
    } catch {
      fail(state, 'storage');
      return;
    }
    let storage: ProcedureTreeStoreResult;
    try {
      storage = completedStorageResult(
        options.storeWithBinding({ tree: state.materialization!.tree, binding, completedEvent }),
      );
    } catch (error) {
      let restored:
        | { readonly status: 'completed'; readonly storage: ProcedureTreeStoreResult }
        | { readonly status: 'absent' | 'invalid' };
      try {
        restored = options.restoreStored({ binding, completedEvent });
      } catch {
        markUnresolvedStorageIntegrity(state);
        return;
      }
      if (restored.status === 'completed') {
        storage = completedStorageResult(restored.storage);
      } else if (restored.status === 'invalid') {
        markUnresolvedStorageIntegrity(state);
        return;
      } else if (options.isStorageFailureRetryable?.(error) === false) {
        fail(state, 'storage');
        return;
      } else {
        requireRecovery(state, 'storage');
        return;
      }
    }
    const parsedEvent = procedureTutorialAuthoringCompletedEventSchema.parse(
      completedEvent.payload,
    );
    state.completedStages.push('storage');
    delete state.currentStage;
    delete state.startedAt;
    state.completed = { event: parsedEvent, storage };
    state.updatedAt = storageAttemptedAt;
  };

  const execute = async (state: RunState): Promise<void> => {
    if (closing) {
      fail(state, 'caption_import');
      return;
    }
    try {
      startStage(state, 'caption_import');
      state.packet = procedureAuthoringPromptPacketSchema.parse(
        await options.importCaption(state.request.source.captionImport),
      );
      assertSelectedCaptionPacketRequest(state.request, state.packet);
      completeStage(state, 'caption_import');
      if (closing) {
        fail(state, 'provider_generation');
        return;
      }
      startStage(state, 'provider_generation');
      state.generation = procedureAuthoringGenerationResultSchema.parse(
        await options.generateFromPacket({
          requestId: state.request.provider.generationRequestId,
          providerId: state.request.provider.authorization.providerDescriptor.id,
          packet: state.packet,
        }),
      );
      const generationEvidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (generationEvidence === null) {
        throw new Error('Provider generation returned without completed evidence');
      }
      state.generationEvidence = generationEvidence;
      completeStage(state, 'provider_generation');
      if (closing) {
        requireRecovery(state, 'materialization');
        return;
      }
      startStage(state, 'materialization');
      state.materialization = procedureAuthoringMaterializationResultSchema.parse(
        options.materialize({ packet: state.packet, tree: state.generation.tree }),
      );
      completeStage(state, 'materialization');
      requireReview(state);
    } catch {
      const stage =
        state.currentStage ??
        (state.completedStages.length >= 2
          ? 'materialization'
          : state.completedStages.length === 1
            ? 'provider_generation'
            : 'caption_import');
      if (stage === 'materialization') requireRecovery(state, stage);
      else fail(state, stage);
    }
  };

  const pump = (): void => {
    while (active < concurrency && queue.length > 0) {
      const work = queue.shift()!;
      active += 1;
      const task: Promise<void> = Promise.resolve()
        .then(work)
        .finally(() => {
          active -= 1;
          tasks.delete(task);
          pump();
        });
      tasks.add(task);
    }
  };
  const schedule = (work: () => Promise<void>): void => {
    queue.push(work);
    pump();
  };

  const parseOwnEvents = (): void => {
    const ordered = [...options.existingEvents].sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const event of ordered) {
      if (
        !(procedureTutorialAuthoringRunEvidenceEventTypes as readonly string[]).includes(
          event.eventType,
        )
      )
        continue;
      const type = event.eventType as AuthoringEvidenceEventType;
      if (type === 'procedure.tutorial.authoring.requested') {
        const payload = procedureTutorialAuthoringRequestedEventSchema.parse(event.payload);
        if (runs.has(payload.requestId))
          throw new Error('Duplicate tutorial authoring requested evidence');
        runs.set(payload.requestId, {
          request: payload.request,
          requestFingerprint: payload.requestFingerprint,
          runId: payload.runId,
          acceptedAt: payload.occurredAt,
          updatedAt: payload.occurredAt,
          completedStages: [],
          resumedReceipts: [],
        });
        continue;
      }
      const candidate = event.payload as Record<string, unknown>;
      const requestId = String(candidate['requestId']);
      const state = runs.get(requestId);
      if (state === undefined) throw new Error('Tutorial authoring evidence precedes its request');
      if (
        state.completed !== undefined ||
        state.failed !== undefined ||
        state.discardedAt !== undefined
      ) {
        throw new Error('Tutorial authoring evidence follows a terminal event');
      }
      if (
        candidate['requestFingerprint'] !== state.requestFingerprint ||
        candidate['runId'] !== state.runId
      ) {
        throw new Error('Tutorial authoring event scope does not match its request');
      }
      if (
        type === 'procedure.tutorial.authoring.stage.started' ||
        type === 'procedure.tutorial.authoring.stage.completed'
      ) {
        const payload = procedureTutorialAuthoringStageEventSchema.parse(event.payload);
        if (type !== `procedure.tutorial.authoring.stage.${payload.state}`) {
          throw new Error('Tutorial authoring stage event type disagrees with its payload');
        }
        if (payload.state === 'started') {
          if (
            state.currentStage !== undefined ||
            payload.stage !==
              ['caption_import', 'provider_generation', 'materialization', 'storage'][
                state.completedStages.length
              ]
          )
            throw new Error('Tutorial authoring stage start is out of order');
          state.currentStage = payload.stage;
          state.startedAt = payload.occurredAt;
          if (payload.stage === 'storage' && state.storageStartedAt === undefined) {
            state.storageStartedAt = payload.occurredAt;
          }
        } else {
          if (state.currentStage !== payload.stage || payload.stage === 'storage')
            throw new Error('Tutorial authoring stage completion is out of order');
          state.completedStages.push(payload.stage);
          delete state.currentStage;
          delete state.startedAt;
        }
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.review.required') {
        const payload = procedureTutorialAuthoringReviewRequiredEventSchema.parse(event.payload);
        if (state.currentStage !== undefined || state.completedStages.length !== 3)
          throw new Error('Review evidence is out of order');
        state.generation = payload.generation;
        const generationEvidence = options.completedGenerationEvidence(
          state.request.provider.generationRequestId,
        );
        if (generationEvidence === null)
          throw new Error('Review evidence has no exact Provider completion event');
        state.generationEvidence = generationEvidence;
        state.packet = payload.generation.packet;
        state.materialization = payload.materialization;
        assertStageResultCoherence(state);
        state.reviewId = payload.reviewId;
        state.awaitingReviewSince = payload.occurredAt;
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.reviewed') {
        const payload = procedureTutorialAuthoringReviewedEventSchema.parse(event.payload);
        if (
          state.reviewId !== payload.review.reviewId ||
          state.review !== undefined ||
          payload.occurredAt !== payload.review.reviewedAt
        )
          throw new Error('Reviewed evidence is out of order');
        state.review = payload.review;
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.recovery.required') {
        const payload = procedureTutorialAuthoringRecoveryRequiredEventSchema.parse(event.payload);
        const rollsBackCompletedMaterialization =
          payload.retryFromStage === 'materialization' &&
          state.completedStages.length === 3 &&
          state.currentStage === undefined &&
          state.reviewId === undefined;
        const validPosition =
          payload.retryFromStage === 'materialization'
            ? (state.completedStages.length === 2 &&
                (state.currentStage === undefined || state.currentStage === 'materialization')) ||
              rollsBackCompletedMaterialization
            : state.completedStages.length === 3 &&
              (state.currentStage === 'storage' || state.review?.review.decision === 'store');
        if (state.recoveryId !== undefined || !validPosition) {
          throw new Error('Recovery evidence is out of order');
        }
        if (rollsBackCompletedMaterialization) state.completedStages.pop();
        delete state.currentStage;
        state.recoveryId = payload.recoveryId;
        state.retryFromStage = payload.retryFromStage;
        state.recoveryError = payload.error;
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.resumed') {
        const payload = procedureTutorialAuthoringResumedEventSchema.parse(event.payload);
        if (
          state.recoveryId !== payload.resume.recoveryId ||
          state.retryFromStage !== payload.resume.retryFromStage
        )
          throw new Error('Resume evidence does not match recovery receipt');
        delete state.recoveryId;
        delete state.retryFromStage;
        delete state.recoveryError;
        state.resumedReceipts.push(payload.resume);
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.discarded') {
        const payload = procedureTutorialAuthoringDiscardedEventSchema.parse(event.payload);
        if (
          payload.occurredAt !== payload.discardedAt ||
          payload.review.reviewId !== state.reviewId ||
          state.review !== undefined
        )
          throw new Error('Discard evidence timestamps disagree');
        state.review = payload.review;
        state.discardedAt = payload.discardedAt;
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.failed') {
        const payload = procedureTutorialAuthoringFailedEventSchema.parse(event.payload);
        if (!isDeepStrictEqual(payload.completedStages, state.completedStages)) {
          throw new Error('Failed evidence completed-stage prefix disagrees with prior events');
        }
        delete state.currentStage;
        state.failed = { error: payload.error, failedAt: payload.occurredAt };
        state.updatedAt = payload.occurredAt;
      } else if (type === 'procedure.tutorial.authoring.completed') {
        const payload = procedureTutorialAuthoringCompletedEventSchema.parse(event.payload);
        if (
          !(
            state.currentStage === 'storage' ||
            (state.currentStage === undefined && state.storageStartedAt !== undefined)
          ) ||
          state.completedStages.length !== 3 ||
          state.review?.review.decision !== 'store'
        ) {
          throw new Error('Completed evidence is out of order');
        }
        const expectedBinding = buildBinding(state);
        if (!isDeepStrictEqual(payload.binding, expectedBinding)) {
          throw new Error('Completed tutorial authoring binding disagrees with stage evidence');
        }
        const expectedCompletedEvent = completedEventInput(
          state,
          expectedBinding,
          payload.completedAt,
        );
        if (
          event.id !== expectedCompletedEvent.id ||
          event.createdAt !== expectedCompletedEvent.createdAt ||
          !isDeepStrictEqual(event.payload, expectedCompletedEvent.payload)
        ) {
          throw new Error('Completed tutorial authoring event identity is invalid');
        }
        const storage = options.restoreStored({
          binding: payload.binding,
          completedEvent: expectedCompletedEvent,
        });
        if (storage.status !== 'completed')
          throw new Error('Completed tutorial authoring evidence has no exact stored tree');
        state.completedStages = [
          'caption_import',
          'provider_generation',
          'materialization',
          'storage',
        ];
        delete state.currentStage;
        state.completed = {
          event: payload,
          storage: completedStorageResult(storage.storage),
        };
        state.updatedAt = payload.completedAt;
      }
    }
  };
  parseOwnEvents();

  // External stages are never replayed after restart. Local stages require an explicit receipt.
  for (const state of runs.values()) {
    if (
      state.completed ||
      state.failed ||
      state.discardedAt ||
      state.recoveryId ||
      (state.reviewId && !state.review)
    )
      continue;
    if (state.currentStage === 'materialization') {
      const packet = options.completedPacket(state.request.source.captionImport.requestId);
      const generationEvidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (packet !== null) state.packet = packet;
      if (generationEvidence !== null) {
        state.generationEvidence = generationEvidence;
        state.generation = generationEvidence.event.result;
      }
      requireRecovery(state, 'materialization');
    } else if (state.currentStage === 'storage') {
      requireRecovery(state, 'storage');
    } else if (state.review?.review.decision === 'store') {
      startStage(state, 'storage');
      requireRecovery(state, 'storage');
    } else if (state.review?.review.decision === 'discard') {
      throw new Error('Discard review is missing terminal discard evidence');
    } else if (state.completedStages.length === 2) {
      const packet = options.completedPacket(state.request.source.captionImport.requestId);
      const generationEvidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (packet !== null) state.packet = packet;
      if (generationEvidence !== null) {
        state.generationEvidence = generationEvidence;
        state.generation = generationEvidence.event.result;
      }
      requireRecovery(state, 'materialization');
    } else if (state.completedStages.length === 3) {
      const packet = options.completedPacket(state.request.source.captionImport.requestId);
      const generationEvidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (packet !== null) state.packet = packet;
      if (generationEvidence !== null) {
        state.generationEvidence = generationEvidence;
        state.generation = generationEvidence.event.result;
      }
      requireRecovery(state, 'materialization');
    } else {
      fail(
        state,
        state.currentStage ??
          (state.completedStages.length === 1 ? 'provider_generation' : 'caption_import'),
      );
    }
  }

  const lookup = (input: { requestId: string; runId: string }): RunState => {
    const state = runs.get(input.requestId);
    if (state === undefined || state.runId !== input.runId) {
      throw new ProcedureTutorialAuthoringRunError(
        'run_not_found',
        'The authoring run was not found.',
        404,
      );
    }
    return state;
  };

  return {
    create: (input) => {
      if (closing)
        throw new ProcedureTutorialAuthoringRunError(
          'runtime_stopping',
          'The runtime is stopping and cannot accept a new authoring run.',
          503,
        );
      const parsed = procedureTutorialAuthoringRunCreateRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new ProcedureTutorialAuthoringRunError(
          'invalid_request',
          'The authoring run request is invalid.',
          400,
        );
      const request = parsed.data;
      const fingerprint = plannerProviderRequestFingerprint(request);
      const existing = runs.get(request.requestId);
      if (existing !== undefined) {
        if (
          existing.requestFingerprint !== fingerprint ||
          !isDeepStrictEqual(existing.request, request)
        )
          throw new ProcedureTutorialAuthoringRunError(
            'run_conflict',
            'requestId is already bound to different authoring input.',
            409,
          );
        return cloneStatus(publicStatus(existing));
      }
      let providerInput: PlannerProviderDescriptor | null;
      try {
        providerInput = options.findProcedureAuthor(
          request.provider.authorization.providerDescriptor.id,
        );
      } catch {
        throw new ProcedureTutorialAuthoringRunError(
          'provider_unavailable',
          'The requested Procedure authoring provider is unavailable.',
          503,
        );
      }
      if (providerInput === null)
        throw new ProcedureTutorialAuthoringRunError(
          'provider_not_found',
          'The requested Procedure authoring provider was not found.',
          404,
        );
      const parsedProvider = plannerProviderDescriptorSchema.safeParse(providerInput);
      if (!parsedProvider.success)
        throw new ProcedureTutorialAuthoringRunError(
          'provider_unavailable',
          'The requested Procedure authoring provider is unavailable.',
          503,
        );
      const provider = parsedProvider.data;
      if (!provider.availability.available)
        throw new ProcedureTutorialAuthoringRunError(
          'provider_unavailable',
          'The requested Procedure authoring provider is unavailable.',
          503,
        );
      if (provider.version !== request.provider.authorization.providerDescriptor.version)
        throw new ProcedureTutorialAuthoringRunError(
          'provider_version_mismatch',
          'The requested Procedure authoring provider version does not match.',
          409,
        );
      if (!isDeepStrictEqual(provider, request.provider.authorization.providerDescriptor))
        throw new ProcedureTutorialAuthoringRunError(
          'provider_descriptor_mismatch',
          'The live Procedure authoring provider disclosure differs from the authorized snapshot.',
          409,
        );
      const occurredAt = now();
      const state: RunState = {
        request,
        requestFingerprint: fingerprint,
        runId: randomUUID(),
        acceptedAt: occurredAt,
        updatedAt: occurredAt,
        completedStages: [],
        resumedReceipts: [],
      };
      append({
        id: `procedure-tutorial-authoring-requested:${request.requestId}`,
        eventType: 'procedure.tutorial.authoring.requested',
        payload: procedureTutorialAuthoringRequestedEventSchema.parse({
          ...scopedPayload(state, occurredAt),
          request,
        }),
        createdAt: occurredAt,
      });
      runs.set(request.requestId, state);
      schedule(() => execute(state));
      return cloneStatus(publicStatus(state));
    },
    status: (input) =>
      cloneStatus(
        publicStatus(lookup(procedureTutorialAuthoringRunStatusRequestSchema.parse(input))),
      ),
    review: (input) => {
      const parsed = procedureTutorialAuthoringReviewRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new ProcedureTutorialAuthoringRunError(
          'invalid_request',
          'The authoring review request is invalid.',
          400,
        );
      const request = parsed.data;
      const state = lookup(request);
      if (state.review !== undefined) {
        if (!isDeepStrictEqual(state.review, request))
          throw new ProcedureTutorialAuthoringRunError(
            'review_conflict',
            'The review receipt is already bound to different input.',
            409,
          );
        return cloneStatus(publicStatus(state));
      }
      if (closing)
        throw new ProcedureTutorialAuthoringRunError(
          'runtime_stopping',
          'The runtime is stopping and cannot accept new review work.',
          503,
        );
      if (
        state.reviewId !== request.reviewId ||
        state.materialization === undefined ||
        state.generation === undefined
      )
        throw new ProcedureTutorialAuthoringRunError(
          'review_not_pending',
          'The exact authoring run is not awaiting this review receipt.',
          409,
        );
      if (
        request.review.decision === 'store' &&
        (request.review.packetContentSha256 !== state.generation.packet.integrity.contentSha256 ||
          request.review.candidateTreeContentSha256 !==
            state.materialization.inputTreeContentSha256 ||
          request.review.materializedTreeContentSha256 !==
            state.materialization.outputTreeContentSha256)
      )
        throw new ProcedureTutorialAuthoringRunError(
          'review_evidence_mismatch',
          'The review hashes do not match the exact preview.',
          422,
        );
      const observedAt = now();
      if (
        state.awaitingReviewSince === undefined ||
        Date.parse(request.reviewedAt) < Date.parse(state.awaitingReviewSince) ||
        Date.parse(request.reviewedAt) > Date.parse(observedAt)
      )
        throw new ProcedureTutorialAuthoringRunError(
          'review_timestamp_invalid',
          'The review timestamp must fall between the review checkpoint and server receipt.',
          422,
        );
      const occurredAt = request.reviewedAt;
      if (request.review.decision === 'discard') {
        append({
          id: `procedure-tutorial-authoring-discarded:${state.runId}`,
          eventType: 'procedure.tutorial.authoring.discarded',
          payload: procedureTutorialAuthoringDiscardedEventSchema.parse({
            ...scopedPayload(state, occurredAt),
            review: request,
            discardedAt: request.reviewedAt,
          }),
          createdAt: occurredAt,
        });
        state.review = request;
        state.discardedAt = request.reviewedAt;
        state.updatedAt = occurredAt;
        return cloneStatus(publicStatus(state));
      }
      append({
        id: `procedure-tutorial-authoring-reviewed:${state.runId}`,
        eventType: 'procedure.tutorial.authoring.reviewed',
        payload: procedureTutorialAuthoringReviewedEventSchema.parse({
          ...scopedPayload(state, occurredAt),
          review: request,
        }),
        createdAt: occurredAt,
      });
      state.review = request;
      state.updatedAt = occurredAt;
      startStage(state, 'storage');
      schedule(async () => store(state));
      return cloneStatus(publicStatus(state));
    },
    resume: (input) => {
      const parsed = procedureTutorialAuthoringResumedEventSchema.shape.resume.safeParse(input);
      if (!parsed.success)
        throw new ProcedureTutorialAuthoringRunError(
          'invalid_request',
          'The authoring recovery request is invalid.',
          400,
        );
      const request = parsed.data;
      const state = lookup(request);
      const priorResume = state.resumedReceipts.find(
        (receipt) => receipt.recoveryId === request.recoveryId,
      );
      if (priorResume !== undefined) {
        if (!isDeepStrictEqual(priorResume, request))
          throw new ProcedureTutorialAuthoringRunError(
            'recovery_conflict',
            'The recovery receipt is already bound to different resume input.',
            409,
          );
        return cloneStatus(publicStatus(state));
      }
      if (closing)
        throw new ProcedureTutorialAuthoringRunError(
          'runtime_stopping',
          'The runtime is stopping and cannot resume authoring work.',
          503,
        );
      if (
        state.recoveryId !== request.recoveryId ||
        state.retryFromStage !== request.retryFromStage
      )
        throw new ProcedureTutorialAuthoringRunError(
          state.recoveryId === undefined ? 'recovery_not_required' : 'recovery_conflict',
          'The recovery receipt does not match the exact local stage.',
          409,
        );
      const occurredAt = now();
      append({
        id: `procedure-tutorial-authoring-resumed:${state.runId}:${request.recoveryId}`,
        eventType: 'procedure.tutorial.authoring.resumed',
        payload: procedureTutorialAuthoringResumedEventSchema.parse({
          ...scopedPayload(state, occurredAt),
          resume: request,
        }),
        createdAt: occurredAt,
      });
      const retry = state.retryFromStage;
      delete state.recoveryId;
      delete state.retryFromStage;
      delete state.recoveryError;
      state.resumedReceipts.push(request);
      state.updatedAt = occurredAt;
      if (retry === 'materialization') {
        startStage(state, 'materialization');
        schedule(async () => {
          try {
            state.packet = procedureAuthoringPromptPacketSchema.parse(
              options.completedPacket(state.request.source.captionImport.requestId),
            );
            const generationEvidence = options.completedGenerationEvidence(
              state.request.provider.generationRequestId,
            );
            if (generationEvidence === null)
              throw new Error('Materialization recovery has no Provider completion evidence');
            state.generationEvidence = generationEvidence;
            state.generation = procedureAuthoringGenerationResultSchema.parse(
              state.generationEvidence?.event.result,
            );
            state.materialization = procedureAuthoringMaterializationResultSchema.parse(
              options.materialize({ packet: state.packet, tree: state.generation.tree }),
            );
            completeStage(state, 'materialization');
            requireReview(state);
          } catch {
            requireRecovery(state, 'materialization');
          }
        });
      } else {
        state.currentStage = 'storage';
        schedule(async () => store(state));
      }
      return cloneStatus(publicStatus(state));
    },
    beginClose: () => {
      closing = true;
    },
    close: () => {
      closing = true;
      closePromise ??= (async () => {
        while (tasks.size > 0 || queue.length > 0) await Promise.allSettled([...tasks]);
      })();
      return closePromise;
    },
  };
}
