import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  plannerProviderDescriptorSchema,
  procedureAuthoringGenerationCompletedEventSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureTreeStoreResultSchema,
  type PlannerProviderDescriptor,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringGenerationResult,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureTree,
  type ProcedureTreeStoreResult,
} from '@operatingline/protocol';
import {
  procedureTutorialMediaAuthoringBindingSchema,
  procedureTutorialMediaAuthoringCompletedEventSchema,
  procedureTutorialMediaAuthoringDiscardedEventSchema,
  procedureTutorialMediaAuthoringFailedEventSchema,
  procedureTutorialMediaAuthoringRecoveryRequiredEventSchema,
  procedureTutorialMediaAuthoringRequestedEventSchema,
  procedureTutorialMediaAuthoringResumedEventSchema,
  procedureTutorialMediaAuthoringReviewRequiredEventSchema,
  procedureTutorialMediaAuthoringReviewedEventSchema,
  procedureTutorialMediaAuthoringReviewRequestSchema,
  procedureTutorialMediaAuthoringRunCreateRequestSchema,
  procedureTutorialMediaAuthoringRunFormatVersion,
  procedureTutorialMediaAuthoringRunStageValues,
  procedureTutorialMediaAuthoringRunStatusSchema,
  procedureTutorialMediaAuthoringStageEventSchema,
  type ProcedureTutorialMediaAuthoringBinding,
  type ProcedureTutorialMediaAuthoringResumeRequest,
  type ProcedureTutorialMediaAuthoringReviewRequest,
  type ProcedureTutorialMediaAuthoringRunCreateRequest,
  type ProcedureTutorialMediaAuthoringRunStage,
  type ProcedureTutorialMediaAuthoringRunStatus,
} from '../../../packages/protocol/src/procedure-tutorial-media-authoring-run.js';
import type { ProcedureAuthoringGenerationCompletedEvidence } from './procedure-authoring-generation.js';
import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';

export const procedureTutorialMediaAuthoringRunEvidenceEventTypes = [
  'procedure.tutorial.media.authoring.requested',
  'procedure.tutorial.media.authoring.stage.started',
  'procedure.tutorial.media.authoring.stage.completed',
  'procedure.tutorial.media.authoring.review.required',
  'procedure.tutorial.media.authoring.reviewed',
  'procedure.tutorial.media.authoring.recovery.required',
  'procedure.tutorial.media.authoring.resumed',
  'procedure.tutorial.media.authoring.discarded',
  'procedure.tutorial.media.authoring.failed',
  'procedure.tutorial.media.authoring.completed',
] as const;

export type ProcedureTutorialMediaAuthoringRunErrorCode =
  | 'invalid_request'
  | 'run_not_found'
  | 'run_conflict'
  | 'provider_not_found'
  | 'provider_unavailable'
  | 'provider_descriptor_mismatch'
  | 'preparation_not_found'
  | 'preparation_mismatch'
  | 'review_not_pending'
  | 'review_conflict'
  | 'review_evidence_mismatch'
  | 'recovery_not_required'
  | 'recovery_conflict'
  | 'capacity_exceeded'
  | 'runtime_stopping'
  | 'authoring_persistence_failed';

export class ProcedureTutorialMediaAuthoringRunError extends Error {
  constructor(
    readonly code: ProcedureTutorialMediaAuthoringRunErrorCode,
    message: string,
    readonly statusCode: 400 | 404 | 409 | 422 | 429 | 500 | 503,
  ) {
    super(message);
    this.name = 'ProcedureTutorialMediaAuthoringRunError';
  }
}

export interface ProcedureTutorialMediaAuthoringRunCoordinatorOptions {
  readonly currentPreparation: (
    analysisRequestId: string,
    analysisJobId: string,
  ) => ProcedureTutorialMediaAuthoringRunCreateRequest['preparation'] | null;
  readonly generateFromPacket: (input: {
    readonly requestId: string;
    readonly providerId: string;
    readonly packet: ProcedureTutorialMediaAuthoringRunCreateRequest['preparation']['packet'];
  }) => Promise<ProcedureAuthoringGenerationResult>;
  readonly completedGenerationEvidence: (
    requestId: string,
  ) => ProcedureAuthoringGenerationCompletedEvidence | null;
  readonly materialize: (input: {
    readonly packet: ProcedureTutorialMediaAuthoringRunCreateRequest['preparation']['packet'];
    readonly tree: ProcedureAuthoringCandidateTree;
  }) => ProcedureAuthoringMaterializationResult;
  readonly storeWithBinding: (input: {
    readonly tree: ProcedureTree;
    readonly binding: ProcedureTutorialMediaAuthoringBinding;
    readonly completedEvent: ExecutionEventInput & { readonly createdAt: string };
  }) => ProcedureTreeStoreResult;
  readonly restoreStored: (input: {
    readonly binding: ProcedureTutorialMediaAuthoringBinding;
    readonly completedEvent: ExecutionEventInput & { readonly createdAt: string };
  }) =>
    | { readonly status: 'completed'; readonly storage: ProcedureTreeStoreResult }
    | { readonly status: 'absent' | 'invalid' };
  readonly isStorageFailureRetryable?: (error: unknown) => boolean;
  readonly findProcedureAuthor: (providerId: string) => PlannerProviderDescriptor | null;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly appendEvent: (event: ExecutionEventInput) => StoredExecutionEvent;
  readonly maximumConcurrentRuns?: number;
  readonly now?: () => string;
}

export interface ProcedureTutorialMediaAuthoringRunCoordinator {
  create(
    request: ProcedureTutorialMediaAuthoringRunCreateRequest,
  ): ProcedureTutorialMediaAuthoringRunStatus;
  status(request: {
    readonly formatVersion: '1.1.0';
    readonly requestId: string;
    readonly runId: string;
  }): ProcedureTutorialMediaAuthoringRunStatus;
  review(
    request: ProcedureTutorialMediaAuthoringReviewRequest,
  ): ProcedureTutorialMediaAuthoringRunStatus;
  resume(
    request: ProcedureTutorialMediaAuthoringResumeRequest,
  ): ProcedureTutorialMediaAuthoringRunStatus;
  beginClose(): void;
  close(): Promise<void>;
}

interface SafeError {
  code: string;
  message: string;
  retryable: boolean;
  stage: ProcedureTutorialMediaAuthoringRunStage;
}
interface RunState {
  request: ProcedureTutorialMediaAuthoringRunCreateRequest;
  requestFingerprint: string;
  runId: string;
  acceptedAt: string;
  updatedAt: string;
  completedStages: ProcedureTutorialMediaAuthoringRunStage[];
  currentStage?: ProcedureTutorialMediaAuthoringRunStage;
  startedAt?: string;
  generation?: ProcedureAuthoringGenerationResult;
  generationEvidence?: ProcedureAuthoringGenerationCompletedEvidence;
  materialization?: ProcedureAuthoringMaterializationResult;
  reviewId?: string;
  awaitingReviewSince?: string;
  review?: ProcedureTutorialMediaAuthoringReviewRequest;
  resumedStage?: 'materialization' | 'storage';
  recoveryId?: string;
  retryFromStage?: 'materialization' | 'storage';
  recoveryError?: SafeError;
  persistenceFault?: ProcedureTutorialMediaAuthoringRunError;
  failed?: { error: SafeError; failedAt: string };
  discardedAt?: string;
  completed?: {
    binding: ProcedureTutorialMediaAuthoringBinding;
    storage: ProcedureTreeStoreResult;
    completedAt: string;
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}
function identity(state: RunState) {
  return {
    formatVersion: procedureTutorialMediaAuthoringRunFormatVersion,
    requestId: state.request.requestId,
    requestFingerprint: state.requestFingerprint,
    runId: state.runId,
    mediaSource: state.request.preparation.source,
  } as const;
}
function summary(value: ProcedureAuthoringMaterializationResult) {
  const { tree: _tree, compilation: _compilation, ...rest } = value;
  void _tree;
  void _compilation;
  return rest;
}
function completedStorage(value: ProcedureTreeStoreResult) {
  return procedureTreeStoreResultSchema.parse({ ...value, result: 'accepted' });
}

function assertStoredTreeMatches(
  state: RunState,
  binding: ProcedureTutorialMediaAuthoringBinding,
  storage: ProcedureTreeStoreResult,
): void {
  const materializedTree = state.materialization?.tree;
  if (
    !materializedTree ||
    !isDeepStrictEqual(storage.record.tree, materializedTree) ||
    storage.record.tree.id !== binding.storage.treeId ||
    storage.record.tree.revision !== binding.storage.revision ||
    storage.record.integrity.contentSha256 !== binding.storage.contentSha256 ||
    storage.proposalCreated !== false ||
    storage.hostExecutionStarted !== false
  ) {
    throw new Error('Stored tree does not match the exact reviewed materialization and binding');
  }
}

function loadExactGenerationEvidence(
  state: RunState,
  evidence: ProcedureAuthoringGenerationCompletedEvidence,
): ProcedureAuthoringGenerationResult {
  const packet = state.request.preparation.packet;
  const completed = procedureAuthoringGenerationCompletedEventSchema.parse(evidence.event);
  const generation = procedureAuthoringGenerationResultSchema.parse(completed.result);
  const expectedFingerprint = plannerProviderRequestFingerprint({
    requestId: state.request.provider.generationRequestId,
    providerId: state.request.provider.authorization.providerDescriptor.id,
    packet,
  });
  if (
    !completed ||
    !('inputMode' in completed) ||
    completed.inputMode !== 'prepared_packet' ||
    evidence.eventId !==
      `procedure-authoring-generation-completed:${state.request.provider.generationRequestId}` ||
    completed.request.requestId !== state.request.provider.generationRequestId ||
    completed.request.providerId !== state.request.provider.authorization.providerDescriptor.id ||
    completed.request.packetContentSha256 !== packet.integrity.contentSha256 ||
    completed.requestFingerprint !== expectedFingerprint ||
    !isDeepStrictEqual(completed.result, generation) ||
    generation.requestId !== completed.request.requestId ||
    generation.provider.id !== completed.request.providerId ||
    generation.provider.version !==
      state.request.provider.authorization.providerDescriptor.version ||
    !isDeepStrictEqual(generation.packet, packet)
  ) {
    throw new Error(
      'Media authoring generation evidence does not bind the exact preparation and Provider result',
    );
  }
  return generation;
}

function assertCoherent(state: RunState): void {
  const packet = state.request.preparation.packet;
  const generation = procedureAuthoringGenerationResultSchema.parse(state.generation);
  const materialization = procedureAuthoringMaterializationResultSchema.parse(
    state.materialization,
  );
  const evidenceGeneration = loadExactGenerationEvidence(state, state.generationEvidence!);
  if (
    !isDeepStrictEqual(evidenceGeneration, generation) ||
    materialization.packetContentSha256 !== packet.integrity.contentSha256 ||
    materialization.inputTreeContentSha256 !== sha256(generation.tree) ||
    materialization.outputTreeContentSha256 !== sha256(materialization.tree)
  ) {
    throw new Error(
      'Media authoring evidence does not bind the exact preparation and Provider result',
    );
  }
}

function buildBinding(state: RunState): ProcedureTutorialMediaAuthoringBinding {
  assertCoherent(state);
  const review = state.review!;
  if (review.review.decision !== 'store') throw new Error('Exact store review is required');
  const preparation = state.request.preparation;
  const generation = state.generation!;
  const materialization = state.materialization!;
  const content = {
    ...identity(state),
    source: {
      kind: 'verified_media_authoring_preparation' as const,
      analysisRequestId: preparation.analysisRequestId,
      analysisJobId: preparation.analysisJobId,
      analysisFingerprint: preparation.analysisFingerprint,
      mediaSource: preparation.source,
      preparationFingerprint: preparation.fingerprint,
      packetContentSha256: preparation.packet.integrity.contentSha256,
    },
    generation: {
      requestId: generation.requestId,
      generationId: generation.generationId,
      providerId: generation.provider.id,
      providerVersion: generation.provider.version,
      completedEventId: state.generationEvidence!.eventId,
      completedEventContentSha256: sha256(state.generationEvidence!.event),
      candidateTreeContentSha256: materialization.inputTreeContentSha256,
    },
    materialization: summary(materialization),
    review: {
      reviewId: review.reviewId,
      reviewedAt: review.reviewedAt,
      preparationFingerprint: review.review.preparationFingerprint,
      packetContentSha256: review.review.packetContentSha256,
      candidateTreeContentSha256: review.review.candidateTreeContentSha256,
      materializedTreeContentSha256: review.review.materializedTreeContentSha256,
    },
    storage: {
      treeId: materialization.tree.id,
      revision: materialization.tree.revision,
      contentSha256: materialization.outputTreeContentSha256,
    },
  };
  return procedureTutorialMediaAuthoringBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: sha256(content),
    },
  });
}

function assertStoreReviewMatches(
  state: RunState,
  review: ProcedureTutorialMediaAuthoringReviewRequest,
) {
  if (review.review.decision !== 'store') return;
  const preparation = state.request.preparation;
  const materialization = state.materialization;
  if (
    !materialization ||
    review.review.preparationFingerprint !== preparation.fingerprint ||
    review.review.packetContentSha256 !== preparation.packet.integrity.contentSha256 ||
    review.review.candidateTreeContentSha256 !== materialization.inputTreeContentSha256 ||
    review.review.materializedTreeContentSha256 !== materialization.outputTreeContentSha256
  ) {
    throw new Error('Store review hashes do not match the exact review checkpoint');
  }
}

export function createProcedureTutorialMediaAuthoringRunCoordinator(
  options: ProcedureTutorialMediaAuthoringRunCoordinatorOptions,
): ProcedureTutorialMediaAuthoringRunCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const maximumConcurrentRuns = options.maximumConcurrentRuns ?? 1;
  if (!Number.isSafeInteger(maximumConcurrentRuns) || maximumConcurrentRuns < 1) {
    throw new Error('maximumConcurrentRuns must be a positive safe integer');
  }
  const runs = new Map<string, RunState>();
  const tasks = new Set<Promise<void>>();
  let closing = false;
  const append = (event: ExecutionEventInput): StoredExecutionEvent => {
    try {
      const stored = options.appendEvent(event);
      if (
        !stored ||
        !Number.isSafeInteger(stored.sequence) ||
        stored.sequence < 1 ||
        stored.id !== event.id ||
        stored.eventType !== event.eventType ||
        stored.createdAt !== event.createdAt ||
        !isDeepStrictEqual(stored.payload, event.payload)
      ) {
        throw new Error('Appended event envelope did not round-trip exactly');
      }
      return stored;
    } catch {
      throw new ProcedureTutorialMediaAuthoringRunError(
        'authoring_persistence_failed',
        'Media authoring evidence could not be persisted.',
        500,
      );
    }
  };
  const event = (
    state: RunState,
    suffix: string,
    payload: unknown,
    at: string,
  ): ExecutionEventInput => ({
    id: `procedure-tutorial-media-authoring-${suffix}:${state.runId}:${randomUUID()}`,
    eventType: `procedure.tutorial.media.authoring.${suffix.replaceAll('-', '.')}`,
    payload,
    createdAt: at,
  });
  const scoped = (state: RunState, occurredAt: string) => ({ ...identity(state), occurredAt });
  const start = (state: RunState, stage: ProcedureTutorialMediaAuthoringRunStage) => {
    const at = now();
    append(
      event(
        state,
        'stage-started',
        procedureTutorialMediaAuthoringStageEventSchema.parse({
          ...scoped(state, at),
          stage,
          state: 'started',
        }),
        at,
      ),
    );
    state.currentStage = stage;
    delete state.resumedStage;
    state.startedAt = at;
    state.updatedAt = at;
  };
  const complete = (
    state: RunState,
    stage: ProcedureTutorialMediaAuthoringRunStage,
    checkpoint?: ProcedureAuthoringGenerationResult | ProcedureAuthoringMaterializationResult,
  ) => {
    const at = now();
    append(
      event(
        state,
        'stage-completed',
        procedureTutorialMediaAuthoringStageEventSchema.parse({
          ...scoped(state, at),
          stage,
          state: 'completed',
          ...(checkpoint ? { checkpoint } : {}),
        }),
        at,
      ),
    );
    state.completedStages.push(stage);
    delete state.currentStage;
    delete state.startedAt;
    state.updatedAt = at;
  };
  const fail = (state: RunState, stage: ProcedureTutorialMediaAuthoringRunStage) => {
    const at = now();
    const error = {
      code: 'media_authoring_stage_failed',
      message:
        stage === 'provider_generation'
          ? 'The external Provider stage stopped and was not replayed automatically.'
          : 'The media authoring stage failed.',
      retryable: false,
      stage,
    };
    append(
      event(
        state,
        'failed',
        procedureTutorialMediaAuthoringFailedEventSchema.parse({
          ...scoped(state, at),
          completedStages: state.completedStages,
          error,
        }),
        at,
      ),
    );
    delete state.currentStage;
    state.failed = { error, failedAt: at };
    state.updatedAt = at;
  };
  const recover = (state: RunState, stage: 'materialization' | 'storage') => {
    const at = now();
    const recoveryId = randomUUID();
    const error = {
      code: 'media_authoring_local_recovery_required',
      message: 'A deterministic local stage requires an explicit recovery receipt.',
      retryable: true,
      stage,
    };
    append(
      event(
        state,
        'recovery-required',
        procedureTutorialMediaAuthoringRecoveryRequiredEventSchema.parse({
          ...scoped(state, at),
          recoveryId,
          retryFromStage: stage,
          error,
        }),
        at,
      ),
    );
    delete state.currentStage;
    state.recoveryId = recoveryId;
    state.retryFromStage = stage;
    state.recoveryError = error;
    state.updatedAt = at;
  };
  const rememberPersistenceFault = (state: RunState, error: unknown) => {
    const fault =
      error instanceof ProcedureTutorialMediaAuthoringRunError &&
      error.code === 'authoring_persistence_failed'
        ? error
        : new ProcedureTutorialMediaAuthoringRunError(
            'authoring_persistence_failed',
            'Media authoring evidence could not be persisted.',
            500,
          );
    state.persistenceFault = fault;
    return fault;
  };
  const recoverOrFault = (state: RunState, stage: 'materialization' | 'storage') => {
    try {
      recover(state, stage);
    } catch (error) {
      throw rememberPersistenceFault(state, error);
    }
  };
  const failOrFault = (state: RunState, stage: ProcedureTutorialMediaAuthoringRunStage) => {
    try {
      fail(state, stage);
    } catch (error) {
      throw rememberPersistenceFault(state, error);
    }
  };
  const requireReview = (state: RunState) => {
    assertCoherent(state);
    const at = now();
    const reviewId = randomUUID();
    append(
      event(
        state,
        'review-required',
        procedureTutorialMediaAuthoringReviewRequiredEventSchema.parse({
          ...scoped(state, at),
          reviewId,
          preparation: state.request.preparation,
          generation: state.generation,
          materialization: state.materialization,
        }),
        at,
      ),
    );
    state.reviewId = reviewId;
    state.awaitingReviewSince = at;
    state.updatedAt = at;
  };
  const completedEvent = (
    state: RunState,
    binding: ProcedureTutorialMediaAuthoringBinding,
    at: string,
  ): ExecutionEventInput & { createdAt: string } => ({
    id: `procedure-tutorial-media-authoring-completed:${state.runId}`,
    eventType: 'procedure.tutorial.media.authoring.completed',
    payload: procedureTutorialMediaAuthoringCompletedEventSchema.parse({
      ...scoped(state, at),
      binding,
      completedAt: at,
    }),
    createdAt: at,
  });
  const store = (state: RunState) => {
    if (state.currentStage !== 'storage') {
      try {
        start(state, 'storage');
      } catch {
        recoverOrFault(state, 'storage');
        return;
      }
    }
    const at = now();
    let binding: ProcedureTutorialMediaAuthoringBinding;
    let completion: ExecutionEventInput & { createdAt: string };
    try {
      binding = buildBinding(state);
      completion = completedEvent(state, binding, at);
    } catch {
      failOrFault(state, 'storage');
      return;
    }
    let storage: ProcedureTreeStoreResult;
    try {
      storage = completedStorage(
        options.storeWithBinding({
          tree: state.materialization!.tree,
          binding,
          completedEvent: completion,
        }),
      );
      const restored = options.restoreStored({ binding, completedEvent: completion });
      if (restored.status !== 'completed')
        throw new Error('Atomic tree storage did not retain the exact completion evidence');
      storage = completedStorage(restored.storage);
    } catch (error) {
      let restored: ReturnType<
        ProcedureTutorialMediaAuthoringRunCoordinatorOptions['restoreStored']
      >;
      try {
        restored = options.restoreStored({ binding, completedEvent: completion });
      } catch (restoreError) {
        throw rememberPersistenceFault(state, restoreError);
      }
      if (restored.status === 'completed') {
        try {
          storage = completedStorage(restored.storage);
        } catch (validationError) {
          throw rememberPersistenceFault(state, validationError);
        }
      } else if (restored.status === 'invalid') {
        throw rememberPersistenceFault(
          state,
          new Error('Stored completion evidence is inconsistent'),
        );
      } else {
        let retryable: boolean | undefined;
        try {
          retryable = options.isStorageFailureRetryable?.(error);
        } catch (classificationError) {
          throw rememberPersistenceFault(state, classificationError);
        }
        if (retryable !== false) {
          recoverOrFault(state, 'storage');
          return;
        }
        failOrFault(state, 'storage');
        return;
      }
    }
    try {
      assertStoredTreeMatches(state, binding, storage);
    } catch (error) {
      throw rememberPersistenceFault(state, error);
    }
    state.completedStages.push('storage');
    delete state.currentStage;
    state.completed = { binding, storage, completedAt: at };
    state.updatedAt = at;
  };
  const execute = async (state: RunState) => {
    if (closing) {
      failOrFault(state, 'provider_generation');
      return;
    }
    try {
      start(state, 'provider_generation');
      state.generation = procedureAuthoringGenerationResultSchema.parse(
        await options.generateFromPacket({
          requestId: state.request.provider.generationRequestId,
          providerId: state.request.provider.authorization.providerDescriptor.id,
          packet: state.request.preparation.packet,
        }),
      );
      const generationEvidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (!generationEvidence) throw new Error('Missing Provider completion evidence');
      const evidenceGeneration = loadExactGenerationEvidence(state, generationEvidence);
      if (!isDeepStrictEqual(evidenceGeneration, state.generation))
        throw new Error('Provider result does not match its durable completion evidence');
      state.generation = evidenceGeneration;
      state.generationEvidence = generationEvidence;
      complete(state, 'provider_generation', state.generation);
    } catch (error) {
      if (
        state.currentStage === 'provider_generation' &&
        state.generation !== undefined &&
        state.generationEvidence !== undefined &&
        isDeepStrictEqual(
          loadExactGenerationEvidence(state, state.generationEvidence),
          state.generation,
        )
      ) {
        // The paid Provider result is already durable. Leave the outer stage unfinished so
        // replay can repair its checkpoint; persisting a terminal failure would discard it.
        rememberPersistenceFault(state, error);
        return;
      }
      failOrFault(state, 'provider_generation');
      return;
    }
    try {
      start(state, 'materialization');
    } catch {
      recoverOrFault(state, 'materialization');
      return;
    }
    try {
      state.materialization = procedureAuthoringMaterializationResultSchema.parse(
        options.materialize({
          packet: state.request.preparation.packet,
          tree: state.generation.tree,
        }),
      );
    } catch {
      recoverOrFault(state, 'materialization');
      return;
    }
    try {
      complete(state, 'materialization', state.materialization);
    } catch (error) {
      rememberPersistenceFault(state, error);
      return;
    }
    try {
      requireReview(state);
    } catch (error) {
      rememberPersistenceFault(state, error);
    }
  };
  const statusOf = (state: RunState): ProcedureTutorialMediaAuthoringRunStatus => {
    if (state.persistenceFault) throw state.persistenceFault;
    const base = { ...identity(state), updatedAt: state.updatedAt };
    if (state.completed)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'completed',
        completedStages: ['provider_generation', 'materialization', 'storage'],
        result: {
          binding: state.completed.binding,
          storage: state.completed.storage,
          sideEffects: {
            providerCalled: true,
            procedureStored: true,
            proposalCreated: false,
            hostExecutionStarted: false,
          },
          completedAt: state.completed.completedAt,
        },
      });
    if (state.discardedAt)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'discarded',
        completedStages: ['provider_generation', 'materialization'],
        reviewId: state.reviewId,
        discardedAt: state.discardedAt,
      });
    if (state.failed)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'failed',
        completedStages: state.completedStages,
        error: state.failed.error,
        failedAt: state.failed.failedAt,
      });
    if (state.recoveryId)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'recovery_required',
        completedStages: state.completedStages,
        recoveryId: state.recoveryId,
        retryFromStage: state.retryFromStage,
        error: state.recoveryError,
      });
    if (state.reviewId && !state.review)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'awaiting_review',
        completedStages: ['provider_generation', 'materialization'],
        reviewId: state.reviewId,
        preview: {
          preparation: state.request.preparation,
          generation: state.generation,
          materialization: state.materialization,
        },
        awaitingReviewSince: state.awaitingReviewSince,
      });
    if (state.currentStage)
      return procedureTutorialMediaAuthoringRunStatusSchema.parse({
        ...base,
        status: 'running',
        currentStage: state.currentStage,
        completedStages: state.completedStages,
        startedAt: state.startedAt,
      });
    return procedureTutorialMediaAuthoringRunStatusSchema.parse({
      ...base,
      status: 'accepted',
      completedStages: [],
      acceptedAt: state.acceptedAt,
    });
  };

  const eventIdPattern = (eventType: string, runId: string) => {
    const suffix = eventType
      .slice('procedure.tutorial.media.authoring.'.length)
      .replaceAll('.', '-');
    const base = `procedure-tutorial-media-authoring-${suffix}:${runId}`;
    return eventType === 'procedure.tutorial.media.authoring.completed'
      ? base
      : new RegExp(
          `^${base}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
          'i',
        );
  };
  const assertEnvelope = (stored: StoredExecutionEvent, payload: Record<string, unknown>) => {
    if (stored.createdAt !== payload['occurredAt'])
      throw new Error('Media authoring event timestamp does not match its envelope');
    const expected = eventIdPattern(stored.eventType, String(payload['runId']));
    if (typeof expected === 'string' ? stored.id !== expected : !expected.test(stored.id))
      throw new Error('Media authoring event id does not match its payload scope');
  };
  const assertScope = (state: RunState, payload: Record<string, unknown>) => {
    if (
      payload['formatVersion'] !== procedureTutorialMediaAuthoringRunFormatVersion ||
      payload['requestId'] !== state.request.requestId ||
      payload['requestFingerprint'] !== state.requestFingerprint ||
      payload['runId'] !== state.runId ||
      !isDeepStrictEqual(payload['mediaSource'], state.request.preparation.source)
    )
      throw new Error('Media authoring event scope does not match its request');
    if (Date.parse(String(payload['occurredAt'])) < Date.parse(state.updatedAt))
      throw new Error('Media authoring event time moves backwards');
  };
  const loadGenerationEvidence = (state: RunState) => {
    const evidence = options.completedGenerationEvidence(
      state.request.provider.generationRequestId,
    );
    if (!evidence) throw new Error('Media authoring generation evidence is missing');
    const generation = loadExactGenerationEvidence(state, evidence);
    if (state.generation !== undefined && !isDeepStrictEqual(state.generation, generation))
      throw new Error('Media authoring generation checkpoint does not match completion evidence');
    state.generation = generation;
    state.generationEvidence = { eventId: evidence.eventId, event: evidence.event };
  };
  const seenEventIds = new Set<string>();
  let previousSequence = 0;
  for (const stored of [...options.existingEvents].sort((a, b) => a.sequence - b.sequence)) {
    if (
      !(procedureTutorialMediaAuthoringRunEvidenceEventTypes as readonly string[]).includes(
        stored.eventType,
      )
    )
      continue;
    if (!Number.isSafeInteger(stored.sequence) || stored.sequence <= previousSequence)
      throw new Error('Media authoring event sequence is invalid');
    previousSequence = stored.sequence;
    if (seenEventIds.has(stored.id)) throw new Error('Duplicate media authoring event id');
    seenEventIds.add(stored.id);
    const raw = stored.payload as Record<string, unknown>;
    assertEnvelope(stored, raw);
    if (stored.eventType === 'procedure.tutorial.media.authoring.requested') {
      const p = procedureTutorialMediaAuthoringRequestedEventSchema.parse(stored.payload);
      const fingerprint = plannerProviderRequestFingerprint(p.request);
      if (
        runs.has(p.requestId) ||
        p.request.requestId !== p.requestId ||
        p.requestFingerprint !== fingerprint
      )
        throw new Error('Media authoring requested evidence is not exactly bound');
      runs.set(p.requestId, {
        request: p.request,
        requestFingerprint: fingerprint,
        runId: p.runId,
        acceptedAt: p.occurredAt,
        updatedAt: p.occurredAt,
        completedStages: [],
      });
      continue;
    }
    const state = runs.get(String(raw['requestId']));
    if (!state) throw new Error('Media authoring evidence precedes request');
    if (state.completed || state.failed || state.discardedAt)
      throw new Error('Media authoring evidence follows a terminal event');
    assertScope(state, raw);
    if (stored.eventType.includes('.stage.')) {
      const p = procedureTutorialMediaAuthoringStageEventSchema.parse(stored.payload);
      if (p.state === 'started') {
        const expectedStage =
          procedureTutorialMediaAuthoringRunStageValues[state.completedStages.length];
        const resumedStage = state.resumedStage;
        if (
          state.currentStage !== undefined ||
          state.recoveryId !== undefined ||
          (resumedStage !== undefined && resumedStage !== p.stage) ||
          p.stage !== expectedStage ||
          p.checkpoint !== undefined ||
          (p.stage === 'storage' && state.review?.review.decision !== 'store') ||
          (p.stage !== 'storage' && state.review !== undefined)
        )
          throw new Error('Media authoring stage start is out of order');
        state.currentStage = p.stage;
        state.startedAt = p.occurredAt;
        delete state.resumedStage;
      } else {
        if (state.currentStage !== p.stage || p.stage === 'storage' || p.checkpoint === undefined)
          throw new Error('Media authoring stage completion is out of order');
        if (p.stage === 'provider_generation') {
          state.generation = procedureAuthoringGenerationResultSchema.parse(p.checkpoint);
          loadGenerationEvidence(state);
        } else {
          state.materialization = procedureAuthoringMaterializationResultSchema.parse(p.checkpoint);
        }
        state.completedStages.push(p.stage);
        delete state.currentStage;
        delete state.startedAt;
      }
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.review.required')) {
      const p = procedureTutorialMediaAuthoringReviewRequiredEventSchema.parse(stored.payload);
      if (
        state.currentStage !== undefined ||
        state.recoveryId !== undefined ||
        state.reviewId !== undefined ||
        state.completedStages.length !== 2 ||
        !isDeepStrictEqual(p.preparation, state.request.preparation) ||
        !isDeepStrictEqual(p.generation, state.generation) ||
        !isDeepStrictEqual(p.materialization, state.materialization)
      )
        throw new Error('Media authoring review checkpoint is out of order or unbound');
      loadGenerationEvidence(state);
      assertCoherent(state);
      state.reviewId = p.reviewId;
      state.awaitingReviewSince = p.occurredAt;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.reviewed')) {
      const p = procedureTutorialMediaAuthoringReviewedEventSchema.parse(stored.payload);
      if (
        !state.reviewId ||
        state.review !== undefined ||
        state.recoveryId !== undefined ||
        p.review.requestId !== state.request.requestId ||
        p.review.runId !== state.runId ||
        p.review.reviewId !== state.reviewId ||
        p.review.reviewedAt !== p.occurredAt
      )
        throw new Error('Media authoring review evidence is out of order or unbound');
      assertStoreReviewMatches(state, p.review);
      state.review = p.review;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.recovery.required')) {
      const p = procedureTutorialMediaAuthoringRecoveryRequiredEventSchema.parse(stored.payload);
      const correctPhase =
        (p.retryFromStage === 'materialization' &&
          (state.currentStage === 'materialization' || state.currentStage === undefined) &&
          state.completedStages.length === 1) ||
        (p.retryFromStage === 'storage' &&
          (state.currentStage === 'storage' || state.currentStage === undefined) &&
          state.review?.review.decision === 'store');
      if (
        !correctPhase ||
        state.recoveryId !== undefined ||
        p.error.stage !== p.retryFromStage ||
        !p.error.retryable ||
        p.error.code !== 'media_authoring_local_recovery_required' ||
        p.error.message !== 'A deterministic local stage requires an explicit recovery receipt.'
      )
        throw new Error('Media authoring recovery evidence is out of order');
      state.recoveryId = p.recoveryId;
      state.retryFromStage = p.retryFromStage;
      state.recoveryError = p.error;
      delete state.currentStage;
      delete state.startedAt;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.resumed')) {
      const p = procedureTutorialMediaAuthoringResumedEventSchema.parse(stored.payload);
      if (
        !state.recoveryId ||
        p.resume.requestId !== state.request.requestId ||
        p.resume.runId !== state.runId ||
        p.resume.recoveryId !== state.recoveryId ||
        p.resume.retryFromStage !== state.retryFromStage
      )
        throw new Error('Media authoring resume evidence is out of order or unbound');
      state.resumedStage = state.retryFromStage;
      delete state.recoveryId;
      delete state.retryFromStage;
      delete state.recoveryError;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.discarded')) {
      const p = procedureTutorialMediaAuthoringDiscardedEventSchema.parse(stored.payload);
      if (
        state.review?.review.decision !== 'discard' ||
        !isDeepStrictEqual(p.review, state.review) ||
        p.discardedAt !== p.occurredAt
      )
        throw new Error('Media authoring discard evidence is out of order or unbound');
      state.discardedAt = p.discardedAt;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.failed')) {
      const p = procedureTutorialMediaAuthoringFailedEventSchema.parse(stored.payload);
      const expectedFailureMessage =
        p.error.stage === 'provider_generation'
          ? 'The external Provider stage stopped and was not replayed automatically.'
          : 'The media authoring stage failed.';
      if (
        !(
          state.currentStage === p.error.stage ||
          (p.error.stage === 'provider_generation' &&
            state.currentStage === undefined &&
            state.completedStages.length === 0)
        ) ||
        !isDeepStrictEqual(p.completedStages, state.completedStages) ||
        p.error.retryable ||
        p.error.code !== 'media_authoring_stage_failed' ||
        p.error.message !== expectedFailureMessage
      )
        throw new Error('Media authoring failure evidence is out of order or unbound');
      state.failed = { error: p.error, failedAt: p.occurredAt };
      delete state.currentStage;
      delete state.startedAt;
      state.updatedAt = p.occurredAt;
    } else if (stored.eventType.endsWith('.completed')) {
      const p = procedureTutorialMediaAuthoringCompletedEventSchema.parse(stored.payload);
      if (
        state.currentStage !== 'storage' ||
        state.review?.review.decision !== 'store' ||
        p.completedAt !== p.occurredAt ||
        p.completedAt !== stored.createdAt
      )
        throw new Error('Media authoring completion evidence is out of order');
      const expectedBinding = buildBinding(state);
      if (!isDeepStrictEqual(p.binding, expectedBinding))
        throw new Error('Media authoring completion binding does not match replayed evidence');
      const completion = {
        id: stored.id,
        eventType: stored.eventType,
        payload: stored.payload,
        createdAt: stored.createdAt,
      };
      if (!isDeepStrictEqual(completion, completedEvent(state, expectedBinding, p.completedAt)))
        throw new Error('Media authoring completed event does not match replayed evidence');
      const restored = options.restoreStored({ binding: p.binding, completedEvent: completion });
      if (restored.status !== 'completed')
        throw new Error('Completed media authoring run has no exact stored tree');
      const storage = completedStorage(restored.storage);
      assertStoredTreeMatches(state, p.binding, storage);
      state.completedStages.push('storage');
      delete state.currentStage;
      delete state.startedAt;
      state.completed = { binding: p.binding, storage, completedAt: p.completedAt };
      state.updatedAt = p.occurredAt;
    }
  }
  for (const state of runs.values()) {
    if (state.completed || state.failed || state.discardedAt || state.recoveryId) continue;
    if (state.review?.review.decision === 'discard') {
      const at = now();
      append(
        event(
          state,
          'discarded',
          procedureTutorialMediaAuthoringDiscardedEventSchema.parse({
            ...scoped(state, at),
            review: state.review,
            discardedAt: at,
          }),
          at,
        ),
      );
      state.discardedAt = at;
      state.updatedAt = at;
    } else if (state.reviewId && !state.review) {
      continue;
    } else if (state.completedStages.length === 2 && !state.reviewId) {
      requireReview(state);
    } else if (state.currentStage === 'provider_generation') {
      const evidence = options.completedGenerationEvidence(
        state.request.provider.generationRequestId,
      );
      if (!evidence) {
        fail(state, 'provider_generation');
        continue;
      }
      state.generation = loadExactGenerationEvidence(state, evidence);
      state.generationEvidence = { eventId: evidence.eventId, event: evidence.event };
      complete(state, 'provider_generation', state.generation);
      recover(state, 'materialization');
    } else if (state.completedStages.length === 0) {
      fail(state, 'provider_generation');
    } else if (
      state.currentStage === 'materialization' ||
      state.completedStages.length === 1 ||
      state.resumedStage === 'materialization'
    ) {
      recover(state, 'materialization');
    } else if (
      state.currentStage === 'storage' ||
      state.review?.review.decision === 'store' ||
      state.resumedStage === 'storage'
    ) {
      recover(state, 'storage');
    }
  }
  const lookup = (requestId: string, runId: string) => {
    const state = runs.get(requestId);
    if (!state || state.runId !== runId)
      throw new ProcedureTutorialMediaAuthoringRunError(
        'run_not_found',
        'The media authoring run was not found.',
        404,
      );
    if (state.persistenceFault) throw state.persistenceFault;
    return state;
  };
  return {
    create(input) {
      if (closing)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'runtime_stopping',
          'The runtime is stopping.',
          503,
        );
      const parsed = procedureTutorialMediaAuthoringRunCreateRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'invalid_request',
          'The media authoring run request is invalid.',
          400,
        );
      const request = parsed.data;
      const fingerprint = plannerProviderRequestFingerprint(request);
      const existing = runs.get(request.requestId);
      if (existing) {
        if (
          existing.requestFingerprint !== fingerprint ||
          !isDeepStrictEqual(existing.request, request)
        )
          throw new ProcedureTutorialMediaAuthoringRunError(
            'run_conflict',
            'requestId is bound to different input.',
            409,
          );
        return structuredClone(statusOf(existing));
      }
      if (tasks.size >= maximumConcurrentRuns) {
        throw new ProcedureTutorialMediaAuthoringRunError(
          'capacity_exceeded',
          'The media authoring run service is at capacity.',
          429,
        );
      }
      const currentPreparation = options.currentPreparation(
        request.preparation.analysisRequestId,
        request.preparation.analysisJobId,
      );
      if (currentPreparation === null)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'preparation_not_found',
          'The verified media authoring preparation was not found.',
          404,
        );
      if (!isDeepStrictEqual(currentPreparation, request.preparation))
        throw new ProcedureTutorialMediaAuthoringRunError(
          'preparation_mismatch',
          'The supplied preparation is not the current verified preparation.',
          409,
        );
      const provider = options.findProcedureAuthor(
        request.provider.authorization.providerDescriptor.id,
      );
      if (!provider)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'provider_not_found',
          'Provider not found.',
          404,
        );
      const parsedProvider = plannerProviderDescriptorSchema.safeParse(provider);
      if (!parsedProvider.success)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'provider_unavailable',
          'Provider unavailable.',
          503,
        );
      if (!parsedProvider.data.availability.available)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'provider_unavailable',
          'Provider unavailable.',
          503,
        );
      if (
        !isDeepStrictEqual(parsedProvider.data, request.provider.authorization.providerDescriptor)
      )
        throw new ProcedureTutorialMediaAuthoringRunError(
          'provider_descriptor_mismatch',
          'Provider descriptor changed after confirmation.',
          409,
        );
      const at = now();
      const state: RunState = {
        request,
        requestFingerprint: fingerprint,
        runId: randomUUID(),
        acceptedAt: at,
        updatedAt: at,
        completedStages: [],
      };
      try {
        append(
          event(
            state,
            'requested',
            procedureTutorialMediaAuthoringRequestedEventSchema.parse({
              ...scoped(state, at),
              request,
            }),
            at,
          ),
        );
      } catch (error) {
        const fault = rememberPersistenceFault(state, error);
        runs.set(request.requestId, state);
        throw fault;
      }
      runs.set(request.requestId, state);
      const task = execute(state)
        .catch((error) => {
          rememberPersistenceFault(state, error);
        })
        .finally(() => tasks.delete(task));
      tasks.add(task);
      return structuredClone(statusOf(state));
    },
    status(input) {
      return structuredClone(statusOf(lookup(input.requestId, input.runId)));
    },
    review(input) {
      const parsed = procedureTutorialMediaAuthoringReviewRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'invalid_request',
          'Review is invalid.',
          400,
        );
      const state = lookup(parsed.data.requestId, parsed.data.runId);
      if (state.review) {
        if (!isDeepStrictEqual(state.review, parsed.data))
          throw new ProcedureTutorialMediaAuthoringRunError(
            'review_conflict',
            'Review already recorded differently.',
            409,
          );
        return structuredClone(statusOf(state));
      }
      if (!state.reviewId || state.reviewId !== parsed.data.reviewId)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'review_not_pending',
          'Exact review is not pending.',
          409,
        );
      if (Date.parse(parsed.data.reviewedAt) < Date.parse(state.awaitingReviewSince!))
        throw new ProcedureTutorialMediaAuthoringRunError(
          'review_evidence_mismatch',
          'Review timestamp precedes the review checkpoint.',
          422,
        );
      if (parsed.data.review.decision === 'store') {
        try {
          assertStoreReviewMatches(state, parsed.data);
        } catch {
          throw new ProcedureTutorialMediaAuthoringRunError(
            'review_evidence_mismatch',
            'Review hashes do not match exact preview.',
            422,
          );
        }
      }
      const at = parsed.data.reviewedAt;
      try {
        append(
          event(
            state,
            'reviewed',
            procedureTutorialMediaAuthoringReviewedEventSchema.parse({
              ...scoped(state, at),
              review: parsed.data,
            }),
            at,
          ),
        );
      } catch (error) {
        throw rememberPersistenceFault(state, error);
      }
      state.review = parsed.data;
      state.updatedAt = at;
      if (parsed.data.review.decision === 'discard') {
        try {
          append(
            event(
              state,
              'discarded',
              procedureTutorialMediaAuthoringDiscardedEventSchema.parse({
                ...scoped(state, at),
                review: parsed.data,
                discardedAt: at,
              }),
              at,
            ),
          );
        } catch (error) {
          throw rememberPersistenceFault(state, error);
        }
        state.discardedAt = at;
      } else store(state);
      return structuredClone(statusOf(state));
    },
    resume(input) {
      const state = lookup(input.requestId, input.runId);
      if (!state.recoveryId)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'recovery_not_required',
          'Recovery is not required.',
          409,
        );
      if (input.recoveryId !== state.recoveryId || input.retryFromStage !== state.retryFromStage)
        throw new ProcedureTutorialMediaAuthoringRunError(
          'recovery_conflict',
          'Recovery receipt does not match.',
          409,
        );
      const at = now();
      try {
        append(
          event(
            state,
            'resumed',
            procedureTutorialMediaAuthoringResumedEventSchema.parse({
              ...scoped(state, at),
              resume: input,
            }),
            at,
          ),
        );
      } catch (error) {
        throw rememberPersistenceFault(state, error);
      }
      const stage = state.retryFromStage!;
      delete state.recoveryId;
      delete state.retryFromStage;
      delete state.recoveryError;
      if (stage === 'materialization') {
        try {
          start(state, stage);
        } catch {
          recoverOrFault(state, stage);
          return structuredClone(statusOf(state));
        }
        try {
          state.materialization = procedureAuthoringMaterializationResultSchema.parse(
            options.materialize({
              packet: state.request.preparation.packet,
              tree: state.generation!.tree,
            }),
          );
        } catch {
          recoverOrFault(state, stage);
          return structuredClone(statusOf(state));
        }
        try {
          complete(state, stage, state.materialization);
        } catch (error) {
          throw rememberPersistenceFault(state, error);
        }
        try {
          requireReview(state);
        } catch (error) {
          throw rememberPersistenceFault(state, error);
        }
      } else store(state);
      return structuredClone(statusOf(state));
    },
    beginClose() {
      closing = true;
    },
    async close() {
      closing = true;
      await Promise.all([...tasks]);
    },
  };
}

export function procedureTutorialMediaAuthoringRunHttpStatus(error: unknown): number {
  return error instanceof ProcedureTutorialMediaAuthoringRunError ? error.statusCode : 500;
}
export function procedureTutorialMediaAuthoringRunErrorResponse(
  error: unknown,
  requestId: string | null,
) {
  const safe =
    error instanceof ProcedureTutorialMediaAuthoringRunError
      ? error
      : new ProcedureTutorialMediaAuthoringRunError(
          'authoring_persistence_failed',
          'Media authoring failed safely.',
          500,
        );
  return { error: safe.code, requestId, message: safe.message };
}
