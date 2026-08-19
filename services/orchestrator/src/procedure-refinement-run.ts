import { createHash } from 'node:crypto';

import type {
  ExecutionEventInput,
  ProcedureRefinementRunExpectedState,
  ProcedureRefinementRunInput,
  StoredExecutionEvent,
} from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  procedureRefinementDialogueCompletedEventSchema,
  procedureRefinementDialogueFailedEventSchema,
  procedureRefinementCreateRequestSchema,
  procedureRefinementMaximumAssistantMessageCharacters,
  procedureRefinementDialogueProviderResultSchema,
  procedureRefinementDialogueRequestedEventSchema,
  procedureRefinementFormatVersion,
  procedureRefinementGenerationCompletedEventSchema,
  procedureRefinementGenerationFailedEventSchema,
  procedureRefinementGenerationRequestedEventSchema,
  procedureRefinementProviderDisclosureListSchema,
  procedureRefinementProviderResultSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementReviewedEventSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureTreeSchema,
  type ProcedureRefinementCreateRequest,
  type ProcedureRefinementDialogueCompletedEvent,
  type ProcedureRefinementDialogueFailedEvent,
  type ProcedureRefinementDialogueProviderResult,
  type ProcedureRefinementDialogueRequestedEvent,
  type ProcedureRefinementGenerationCompletedEvent,
  type ProcedureRefinementGenerationFailedEvent,
  type ProcedureRefinementGenerationRequestedEvent,
  type ProcedureRefinementProviderDisclosure,
  type ProcedureRefinementProviderDisclosureList,
  type ProcedureRefinementProviderResult,
  type ProcedureRefinementReviewBinding,
  type ProcedureRefinementReviewRequest,
  type ProcedureRefinementRunStatus,
  type ProcedureRefinementSemanticContextBinding,
  type StoredProcedureTree,
} from '@operatingline/protocol';

import {
  PlannerGenerationRuntimeError,
  safePlannerRuntimeError,
} from './planner-provider-errors.js';
import {
  createPlannerProviderInvocationManager,
  plannerProviderRequestFingerprint,
  sanitizePlannerProviderOutput,
  type PlannerProviderInvocationManager,
  type RestoredPlannerProviderInvocation,
} from './planner-provider-invocation.js';
import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import { snapshotPlannerProviderRuntimeTreatment } from './planner-provider-attestation.js';
import {
  buildProcedureRefinementDialoguePromptPacket,
  buildProcedureRefinementPromptPacket,
} from './procedure-refinement-prompt.js';
import {
  createProcedureRefinementScope,
  evaluateProcedureRefinementScope,
} from './procedure-refinement-scope.js';
import type { ProcedureSemanticRetrievalCompletedEvidence } from './procedure-semantic-retrieval.js';

const procedureRefinementProviderEvidenceEventTypes = [
  'procedure.refinement.dialogue.requested',
  'procedure.refinement.dialogue.completed',
  'procedure.refinement.dialogue.failed',
  'procedure.refinement.generation.requested',
  'procedure.refinement.generation.completed',
  'procedure.refinement.generation.failed',
] as const;

export const procedureRefinementEvidenceEventTypes = [
  ...procedureRefinementProviderEvidenceEventTypes,
  'procedure.refinement.reviewed',
] as const;

type ProcedureRefinementEvidenceEventType =
  (typeof procedureRefinementProviderEvidenceEventTypes)[number];

export type ProcedureRefinementDialogueRequestedEvidence =
  ProcedureRefinementDialogueRequestedEvent;
export type ProcedureRefinementDialogueCompletedEvidence =
  ProcedureRefinementDialogueCompletedEvent;
export type ProcedureRefinementDialogueFailedEvidence = ProcedureRefinementDialogueFailedEvent;
export type ProcedureRefinementGenerationRequestedEvidence =
  ProcedureRefinementGenerationRequestedEvent;
export type ProcedureRefinementGenerationCompletedEvidence =
  ProcedureRefinementGenerationCompletedEvent;
export type ProcedureRefinementGenerationFailedEvidence = ProcedureRefinementGenerationFailedEvent;

export type ProcedureRefinementProviderEvidence =
  | ProcedureRefinementDialogueRequestedEvidence
  | ProcedureRefinementDialogueCompletedEvidence
  | ProcedureRefinementDialogueFailedEvidence
  | ProcedureRefinementGenerationRequestedEvidence
  | ProcedureRefinementGenerationCompletedEvidence
  | ProcedureRefinementGenerationFailedEvidence;

export interface ProcedureRefinementCompileResult {
  readonly valid: boolean;
  readonly message?: string;
}

export interface ProcedureRefinementStoreReviewInput {
  readonly currentRun: ProcedureRefinementRunInput;
  readonly reviewRequest: ProcedureRefinementReviewRequest;
  readonly reviewedEvent: ExecutionEventInput & { readonly createdAt: string };
  readonly targetTree: ProcedureRefinementProviderResult['targetTree'];
}

export interface ProcedureRefinementDiscardReviewInput {
  readonly currentRun: ProcedureRefinementRunInput;
  readonly reviewRequest: ProcedureRefinementReviewRequest;
  readonly reviewedEvent: ExecutionEventInput & { readonly createdAt: string };
}

export interface ProcedureRefinementCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly invocationManager?: PlannerProviderInvocationManager;
  readonly timeoutMs?: number;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly getLatestProcedureTree: (treeId: string) => StoredProcedureTree | null;
  readonly completedSemanticEvidence: (
    requestId: string,
  ) => ProcedureSemanticRetrievalCompletedEvidence | null;
  readonly compileCandidate: (
    tree: ProcedureRefinementProviderResult['targetTree'],
  ) => ProcedureRefinementCompileResult | void;
  readonly recordRun: (run: ProcedureRefinementRunInput) => 'accepted' | 'duplicate' | 'conflict';
  readonly getRun: (runId: string) => unknown | null;
  readonly transitionRun: (
    run: ProcedureRefinementRunInput,
    expected: ProcedureRefinementRunExpectedState,
  ) => boolean;
  readonly listActiveRuns: () => readonly unknown[];
  readonly commitStoreReview: (
    input: ProcedureRefinementStoreReviewInput,
  ) => ProcedureRefinementRunStatus;
  readonly commitDiscardReview: (
    input: ProcedureRefinementDiscardReviewInput,
  ) => ProcedureRefinementRunStatus;
  readonly appendEvent: (event: ExecutionEventInput) => StoredExecutionEvent;
  readonly now?: () => Date;
  readonly schedule?: (work: () => Promise<void>) => void;
}

export interface ProcedureRefinementCoordinator {
  listProviders(): ProcedureRefinementProviderDisclosureList;
  getSemanticContextReceipt(requestId: string): ProcedureRefinementSemanticContextBinding | null;
  create(request: ProcedureRefinementCreateRequest): ProcedureRefinementRunStatus;
  get(runId: string): ProcedureRefinementRunStatus | null;
  review(request: ProcedureRefinementReviewRequest): ProcedureRefinementRunStatus;
  beginClose(): void;
  close(): Promise<void>;
}

interface RestoredEvidenceState {
  requested?: {
    readonly sequence: number;
    readonly value:
      ProcedureRefinementDialogueRequestedEvidence | ProcedureRefinementGenerationRequestedEvidence;
  };
  terminal?: {
    readonly sequence: number;
    readonly kind: 'completed' | 'failed';
    readonly value: ProcedureRefinementProviderEvidence;
  };
}

const assistantFlushCharacters = 256;
const assistantFlushMilliseconds = 75;
const providerInputPolicy = {
  exactStoredBaseTreeSent: true,
  exactSemanticRetrievalResultSent: true,
  instructionSent: true,
  dialogueHistorySent: true,
  credentialsIncludedInTaskPayload: false,
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function sameValue(left: unknown, right: unknown): boolean {
  return sha256(left) === sha256(right);
}

function immutableClone<T>(value: T): T {
  return structuredClone(value);
}

function assertStoredEvent(
  stored: StoredExecutionEvent,
  input: ExecutionEventInput,
): StoredExecutionEvent {
  if (
    !Number.isSafeInteger(stored.sequence) ||
    stored.sequence < 1 ||
    !Number.isFinite(Date.parse(stored.createdAt)) ||
    stored.id !== input.id ||
    stored.eventType !== input.eventType ||
    !sameValue(stored.payload, input.payload)
  ) {
    throw new Error('Persisted Procedure refinement evidence does not match its append input');
  }
  return stored;
}

function validateEvidenceEnvelope(stored: StoredExecutionEvent): void {
  if (
    !Number.isSafeInteger(stored.sequence) ||
    stored.sequence < 1 ||
    !Number.isFinite(Date.parse(stored.createdAt))
  ) {
    throw new Error('Procedure refinement stored evidence envelope is invalid');
  }
}

function evidenceKind(eventType: ProcedureRefinementEvidenceEventType): {
  operation: 'procedure_refinement_dialogue' | 'procedure_refinement';
  phase: 'requested' | 'completed' | 'failed';
  idPrefix: string;
} {
  if (eventType.startsWith('procedure.refinement.dialogue.')) {
    return {
      operation: 'procedure_refinement_dialogue',
      phase: eventType.split('.').at(-1) as 'requested' | 'completed' | 'failed',
      idPrefix: 'procedure-refinement-dialogue',
    };
  }
  return {
    operation: 'procedure_refinement',
    phase: eventType.split('.').at(-1) as 'requested' | 'completed' | 'failed',
    idPrefix: 'procedure-refinement-generation',
  };
}

function parseEvidence(stored: StoredExecutionEvent): ProcedureRefinementProviderEvidence {
  validateEvidenceEnvelope(stored);
  const eventType = stored.eventType as ProcedureRefinementEvidenceEventType;
  if (!procedureRefinementProviderEvidenceEventTypes.includes(eventType)) {
    throw new Error('Unknown Procedure refinement evidence event');
  }
  const shape = evidenceKind(eventType);
  const schemas = {
    'procedure.refinement.dialogue.requested': procedureRefinementDialogueRequestedEventSchema,
    'procedure.refinement.dialogue.completed': procedureRefinementDialogueCompletedEventSchema,
    'procedure.refinement.dialogue.failed': procedureRefinementDialogueFailedEventSchema,
    'procedure.refinement.generation.requested': procedureRefinementGenerationRequestedEventSchema,
    'procedure.refinement.generation.completed': procedureRefinementGenerationCompletedEventSchema,
    'procedure.refinement.generation.failed': procedureRefinementGenerationFailedEventSchema,
  } as const;
  const value = schemas[eventType].parse(stored.payload) as ProcedureRefinementProviderEvidence;
  if (stored.id !== `${shape.idPrefix}-${shape.phase}:${value.requestId}`) {
    throw new Error('Procedure refinement evidence identity is invalid');
  }
  if (eventType === 'procedure.refinement.dialogue.completed') {
    const completed = value as ProcedureRefinementDialogueCompletedEvidence;
    if (sha256(completed.result) !== completed.resultContentSha256) {
      throw new Error('Procedure refinement completed evidence hash is invalid');
    }
  }
  if (eventType === 'procedure.refinement.generation.completed') {
    const completed = value as ProcedureRefinementGenerationCompletedEvidence;
    if (completed.outcome.kind !== 'valid') return immutableClone(value);
    const result = completed.outcome.providerResult;
    if (
      sha256(result.targetTree) !== result.targetTreeContentSha256 ||
      result.providerOutputContentSha256 !== result.targetTreeContentSha256
    ) {
      throw new Error('Procedure refinement provider result hash is invalid');
    }
  }
  return immutableClone(value);
}

export function restoreProcedureRefinementProviderInvocations(
  events: readonly StoredExecutionEvent[],
): readonly RestoredPlannerProviderInvocation[] {
  const states = new Map<string, RestoredEvidenceState>();
  for (const stored of events) {
    if (
      !procedureRefinementProviderEvidenceEventTypes.includes(
        stored.eventType as ProcedureRefinementEvidenceEventType,
      )
    ) {
      continue;
    }
    const event = parseEvidence(stored);
    const state = states.get(event.requestId) ?? {};
    const shape = evidenceKind(stored.eventType as ProcedureRefinementEvidenceEventType);
    if (shape.phase === 'requested') {
      if (state.requested !== undefined) {
        throw new Error(`Duplicate Procedure refinement requested evidence ${event.requestId}`);
      }
      state.requested = { sequence: stored.sequence, value: event };
    } else {
      if (state.terminal !== undefined) {
        throw new Error(`Duplicate Procedure refinement terminal evidence ${event.requestId}`);
      }
      state.terminal = { sequence: stored.sequence, kind: shape.phase, value: event };
    }
    states.set(event.requestId, state);
  }

  const restored: RestoredPlannerProviderInvocation[] = [];
  for (const [requestId, state] of states) {
    if (state.requested === undefined) {
      throw new Error(`Procedure refinement terminal evidence lacks request ${requestId}`);
    }
    if (state.terminal !== undefined) {
      if (state.terminal.sequence <= state.requested.sequence) {
        throw new Error(`Procedure refinement evidence order is invalid for ${requestId}`);
      }
      if (
        Date.parse(state.terminal.value.occurredAt) < Date.parse(state.requested.value.occurredAt)
      ) {
        throw new Error(`Procedure refinement evidence time is invalid for ${requestId}`);
      }
      if (
        state.terminal.value.operation !== state.requested.value.operation ||
        state.terminal.value.runId !== state.requested.value.runId ||
        state.terminal.value.requestFingerprint !== state.requested.value.requestFingerprint ||
        state.terminal.value.providerId !== state.requested.value.providerId ||
        state.terminal.value.providerVersion !== state.requested.value.providerVersion ||
        state.terminal.value.packetContentSha256 !== state.requested.value.packetContentSha256 ||
        state.terminal.value.treatmentContentSha256 !== state.requested.value.treatmentContentSha256
      ) {
        throw new Error(`Procedure refinement terminal evidence conflicts for ${requestId}`);
      }
    }
    restored.push({
      requestId,
      operation: state.requested.value.operation,
      fingerprint: state.requested.value.requestFingerprint,
      ...(state.terminal?.kind === 'completed'
        ? {
            result:
              state.terminal.value.operation === 'procedure_refinement_dialogue'
                ? (state.terminal.value as ProcedureRefinementDialogueCompletedEvidence).result
                : (state.terminal.value as ProcedureRefinementGenerationCompletedEvidence).outcome,
          }
        : {}),
    });
  }
  const dialogueByRun = new Map<string, RestoredEvidenceState>();
  const generationByRun = new Map<string, RestoredEvidenceState>();
  for (const state of states.values()) {
    if (state.requested?.value.operation === 'procedure_refinement_dialogue') {
      if (dialogueByRun.has(state.requested.value.runId)) {
        throw new Error(
          `Duplicate Procedure refinement dialogue run ${state.requested.value.runId}`,
        );
      }
      dialogueByRun.set(state.requested.value.runId, state);
    } else if (state.requested?.value.operation === 'procedure_refinement') {
      if (generationByRun.has(state.requested.value.runId)) {
        throw new Error(
          `Duplicate Procedure refinement generation run ${state.requested.value.runId}`,
        );
      }
      generationByRun.set(state.requested.value.runId, state);
    }
  }
  for (const state of states.values()) {
    if (state.requested?.value.operation !== 'procedure_refinement') continue;
    const dialogue = dialogueByRun.get(state.requested.value.runId);
    const dialogueCompleted = dialogue?.terminal?.value as
      ProcedureRefinementDialogueCompletedEvidence | undefined;
    if (
      dialogue?.terminal?.kind !== 'completed' ||
      dialogueCompleted?.operation !== 'procedure_refinement_dialogue' ||
      dialogue.terminal.sequence >= state.requested.sequence ||
      Date.parse(dialogueCompleted.occurredAt) > Date.parse(state.requested.value.occurredAt) ||
      dialogueCompleted.result.decision.kind !== 'refine' ||
      dialogue.requested?.value.providerId !== state.requested.value.providerId ||
      dialogue.requested.value.providerVersion !== state.requested.value.providerVersion
    ) {
      throw new Error(
        `Procedure refinement generation lacks a preceding completed refine decision for ${state.requested.value.runId}`,
      );
    }
  }
  return restored;
}

function buildDisclosure(
  registry: PlannerProviderRegistry,
): ProcedureRefinementProviderDisclosureList {
  const providers = registry
    .listProcedureRefiners()
    .providers.map((descriptor): ProcedureRefinementProviderDisclosure | null => {
      const registered = registry.findProcedureRefiner(descriptor.id);
      if (registered === null || !descriptor.availability.available) return null;
      const dialogueRuntimeTreatment = snapshotPlannerProviderRuntimeTreatment(
        registered.provider,
        registered.descriptor,
        'procedure_refinement_dialogue',
      );
      const refinementRuntimeTreatment = snapshotPlannerProviderRuntimeTreatment(
        registered.provider,
        registered.descriptor,
        'procedure_refinement',
      );
      if (dialogueRuntimeTreatment === undefined || refinementRuntimeTreatment === undefined) {
        return null;
      }
      return procedureRefinementProviderDisclosureListSchema.parse({
        formatVersion: procedureRefinementFormatVersion,
        refinementAvailable: true,
        providers: [
          {
            providerDescriptor: registered.descriptor,
            dialogueRuntimeTreatment,
            refinementRuntimeTreatment,
            inputPolicy: providerInputPolicy,
          },
        ],
      }).providers[0]!;
    })
    .filter((value): value is ProcedureRefinementProviderDisclosure => value !== null);
  return procedureRefinementProviderDisclosureListSchema.parse({
    formatVersion: procedureRefinementFormatVersion,
    refinementAvailable: providers.length > 0,
    providers,
  });
}

function baseStatus(
  request: ProcedureRefinementCreateRequest,
  scope: ReturnType<typeof createProcedureRefinementScope>,
  updatedAt: string,
): ProcedureRefinementRunStatus {
  return procedureRefinementRunStatusSchema.parse({
    formatVersion: procedureRefinementFormatVersion,
    runId: request.runId,
    dialogueRequestId: request.dialogueRequestId,
    refinementRequestId: request.refinementRequestId,
    baseTree: request.baseTree,
    targetRevision: request.targetRevision,
    scope,
    semanticContext: request.semanticContext,
    providerDisclosure: request.providerDisclosure,
    status: 'queued',
    terminal: false,
    assistantMessage: '',
    assistantMessageRevision: 0,
    semanticDecision: null,
    preview: null,
    review: null,
    storedTree: null,
    needsRevision: null,
    error: null,
    sideEffects: {
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    updatedAt,
  });
}

function durableRun(
  request: ProcedureRefinementCreateRequest,
  statusPayload: ProcedureRefinementRunStatus,
): ProcedureRefinementRunInput {
  return {
    runId: request.runId,
    dialogueRequestId: request.dialogueRequestId,
    refinementRequestId: request.refinementRequestId,
    treeId: request.baseTree.tree.id,
    baseRevision: request.baseTree.tree.revision,
    baseContentSha256: request.baseTree.integrity.contentSha256,
    targetRevision: request.targetRevision,
    status: statusPayload.status,
    assistantMessage: statusPayload.assistantMessage,
    assistantMessageRevision: statusPayload.assistantMessageRevision,
    createRequest: request,
    statusPayload,
    updatedAt: statusPayload.updatedAt,
  };
}

function parseDurableRun(value: unknown): ProcedureRefinementRunInput {
  if (value === null || typeof value !== 'object') {
    throw new Error('Procedure refinement persistence returned an invalid run');
  }
  const candidate = value as ProcedureRefinementRunInput;
  const createRequest = procedureRefinementCreateRequestSchema.parse(candidate.createRequest);
  const statusPayload = procedureRefinementRunStatusSchema.parse(candidate.statusPayload);
  const parsed = durableRun(createRequest, statusPayload);
  if (!sameValue(candidate, parsed)) {
    throw new Error('Procedure refinement durable envelope is inconsistent');
  }
  return parsed;
}

function safeError(
  code: NonNullable<ProcedureRefinementRunStatus['error']>['code'],
  message: string,
  retryable = false,
): NonNullable<ProcedureRefinementRunStatus['error']> {
  return { code, message, retryable, retryMode: 'new_request_id' };
}

function providerFailure(error: unknown): NonNullable<ProcedureRefinementRunStatus['error']> {
  const safe = safePlannerRuntimeError(error);
  if (safe.code === 'planner_persistence_failed') {
    return safeError(
      'persistence_failed',
      'Procedure refinement evidence could not be persisted safely.',
      true,
    );
  }
  if (safe.code === 'planner_provider_unavailable') {
    return safeError(
      'provider_unavailable',
      'The selected refinement provider is unavailable.',
      true,
    );
  }
  if (safe.code === 'planner_output_invalid' || safe.code === 'planner_identity_mismatch') {
    return safeError(
      'provider_output_invalid',
      'The refinement provider returned an invalid public result.',
      true,
    );
  }
  return safeError(
    'provider_call_failed',
    'The refinement provider call did not complete successfully.',
    true,
  );
}

function restoredProviderFailure(
  error: ProcedureRefinementDialogueFailedEvidence['error'],
): NonNullable<ProcedureRefinementRunStatus['error']> {
  switch (error.code) {
    case 'persistence_failed':
    case 'provider_unavailable':
    case 'provider_output_invalid':
    case 'provider_call_failed':
      return safeError(error.code, error.message, error.retryable);
    default:
      return safeError(
        'internal_failed',
        'Procedure refinement recovered an invalid provider failure record.',
        false,
      );
  }
}

export function createProcedureRefinementCoordinator(
  options: ProcedureRefinementCoordinatorOptions,
): ProcedureRefinementCoordinator {
  const now = options.now ?? (() => new Date());
  const restoredInvocations = restoreProcedureRefinementProviderInvocations(options.existingEvents);
  const invocationManager =
    options.invocationManager ??
    createPlannerProviderInvocationManager({
      registry: options.registry,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      restoredInvocations,
    });
  const pending = new Set<Promise<void>>();
  const reviewedEvidenceByRun = new Map<
    string,
    ReturnType<typeof procedureRefinementReviewedEventSchema.parse>
  >();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  for (const stored of options.existingEvents) {
    if (stored.eventType !== 'procedure.refinement.reviewed') continue;
    validateEvidenceEnvelope(stored);
    const reviewed = procedureRefinementReviewedEventSchema.parse(stored.payload);
    if (
      stored.id !== `procedure-refinement-reviewed:${reviewed.reviewId}` ||
      stored.createdAt !== reviewed.occurredAt ||
      reviewed.requestFingerprint !== sha256(reviewed.reviewRequest) ||
      reviewed.runId !== reviewed.reviewRequest.runId ||
      reviewed.reviewId !== reviewed.reviewRequest.reviewId
    ) {
      throw new Error('Procedure refinement reviewed evidence identity is invalid');
    }
    const existing = reviewedEvidenceByRun.get(reviewed.runId);
    if (existing !== undefined && !sameValue(existing, reviewed)) {
      throw new Error(`Duplicate Procedure refinement reviewed evidence ${reviewed.runId}`);
    }
    reviewedEvidenceByRun.set(reviewed.runId, immutableClone(reviewed));
  }

  const appendEvidence = (input: ExecutionEventInput): StoredExecutionEvent => {
    try {
      return assertStoredEvent(options.appendEvent(input), input);
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_persistence_failed',
        'Procedure refinement provider evidence could not be persisted',
        'new_request_id',
      );
    }
  };

  const read = (runId: string): ProcedureRefinementRunInput | null => {
    const value = options.getRun(runId);
    return value === null ? null : parseDurableRun(value);
  };

  const timestampAtOrAfter = (minimum: string): string => {
    const candidate = now().toISOString();
    return Date.parse(candidate) >= Date.parse(minimum) ? candidate : minimum;
  };

  const transition = (
    request: ProcedureRefinementCreateRequest,
    prior: ProcedureRefinementRunStatus,
    nextInput: Omit<ProcedureRefinementRunStatus, 'updatedAt'>,
  ): ProcedureRefinementRunStatus => {
    const minimumUpdatedAt =
      nextInput.preview === null ||
      Date.parse(prior.updatedAt) >= Date.parse(nextInput.preview.reviewReadyAt)
        ? prior.updatedAt
        : nextInput.preview.reviewReadyAt;
    const next = procedureRefinementRunStatusSchema.parse({
      ...nextInput,
      updatedAt: timestampAtOrAfter(minimumUpdatedAt),
    });
    if (
      !options.transitionRun(durableRun(request, next), {
        status: prior.status,
        assistantMessageRevision: prior.assistantMessageRevision,
      })
    ) {
      throw new Error(`Procedure refinement run ${request.runId} lost its expected durable state`);
    }
    return next;
  };

  const fail = (
    request: ProcedureRefinementCreateRequest,
    prior: ProcedureRefinementRunStatus,
    error: NonNullable<ProcedureRefinementRunStatus['error']>,
    status: 'failed' | 'interrupted' = 'failed',
  ): ProcedureRefinementRunStatus =>
    transition(request, prior, {
      ...prior,
      status,
      terminal: true,
      error,
    });

  const failActive = (
    request: ProcedureRefinementCreateRequest,
    error: NonNullable<ProcedureRefinementRunStatus['error']>,
    status: 'failed' | 'interrupted' = 'failed',
  ): void => {
    let transitionError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = read(request.runId)?.statusPayload;
      if (current === undefined || current.terminal) return;
      try {
        fail(request, current, error, status);
        return;
      } catch (caught) {
        transitionError = caught;
      }
    }
    const durable = read(request.runId)?.statusPayload;
    if (durable === undefined || !durable.terminal) throw transitionError;
  };

  const flushMessage = (
    request: ProcedureRefinementCreateRequest,
    current: ProcedureRefinementRunStatus,
    assistantMessage: string,
  ): ProcedureRefinementRunStatus => {
    if (assistantMessage === current.assistantMessage) return current;
    if (!assistantMessage.startsWith(current.assistantMessage)) {
      throw new Error('Procedure refinement assistant message must be cumulative');
    }
    return transition(request, current, {
      ...current,
      status: 'streaming',
      terminal: false,
      assistantMessage,
      assistantMessageRevision: current.assistantMessageRevision + 1,
    });
  };

  const gateProviderResult = (
    request: ProcedureRefinementCreateRequest,
    current: ProcedureRefinementRunStatus,
    dialogueResult: ProcedureRefinementDialogueProviderResult,
    providerResult: ProcedureRefinementProviderResult,
    generationCompletedAt: string,
  ): ProcedureRefinementRunStatus => {
    let evaluation: ReturnType<typeof evaluateProcedureRefinementScope>;
    try {
      evaluation = evaluateProcedureRefinementScope(
        request.baseTree.tree,
        providerResult.targetTree,
        request.requestedScopeRootIds,
      );
    } catch {
      return transition(request, current, {
        ...current,
        status: 'needs_revision',
        terminal: true,
        semanticDecision: dialogueResult.decision,
        needsRevision: {
          reason: 'provider_output_invalid',
          message: 'The provider output was not a complete valid ProcedureTree.',
          findings: [],
        },
      });
    }
    if (!evaluation.locality.valid) {
      const noChange = evaluation.locality.findings.some(
        (finding) => finding.code === 'no_local_change',
      );
      return transition(request, current, {
        ...current,
        status: 'needs_revision',
        terminal: true,
        semanticDecision: dialogueResult.decision,
        needsRevision: {
          reason: noChange ? 'no_meaningful_change' : 'locality_validation_failed',
          message: noChange
            ? 'The provider did not make a meaningful change inside the selected scope.'
            : 'The provider output violated the selected ProcedureTree scope.',
          findings: evaluation.locality.findings,
        },
      });
    }
    let compilation: ProcedureRefinementCompileResult | void;
    try {
      compilation = options.compileCandidate(evaluation.targetTree);
    } catch {
      return fail(
        request,
        current,
        safeError(
          'internal_failed',
          'Procedure refinement stopped after an internal deterministic failure.',
          false,
        ),
      );
    }
    if (compilation?.valid === false) {
      return transition(request, current, {
        ...current,
        status: 'needs_revision',
        terminal: true,
        semanticDecision: dialogueResult.decision,
        needsRevision: {
          reason: 'procedure_compilation_failed',
          message:
            compilation.message ??
            'The locally scoped result did not pass deterministic Procedure compilation.',
          findings: [],
        },
      });
    }
    const binding: ProcedureRefinementReviewBinding = {
      runRequestContentSha256: sha256(request),
      baseTreeContentSha256: request.baseTree.integrity.contentSha256,
      targetTreeContentSha256: sha256(evaluation.targetTree),
      scopeContentSha256: sha256(current.scope),
      semanticContextContentSha256: sha256(request.semanticContext),
      assistantMessageContentSha256: sha256(current.assistantMessage),
      refinementPacketContentSha256: providerResult.packetContentSha256,
      providerOutputContentSha256: providerResult.providerOutputContentSha256,
      localityReportContentSha256: sha256(evaluation.locality),
    };
    const candidateReviewReadyAt = now().toISOString();
    const reviewReadyAt =
      Date.parse(candidateReviewReadyAt) >= Date.parse(generationCompletedAt)
        ? candidateReviewReadyAt
        : generationCompletedAt;
    return transition(request, current, {
      ...current,
      status: 'awaiting_review',
      terminal: false,
      semanticDecision: dialogueResult.decision,
      preview: {
        targetTree: evaluation.targetTree,
        providerResult,
        localityReport: evaluation.locality,
        binding,
        reviewReadyAt,
      },
    });
  };

  const runProviderCalls = async (
    request: ProcedureRefinementCreateRequest,
    semanticEvidence: ProcedureSemanticRetrievalCompletedEvidence,
  ): Promise<void> => {
    let current = read(request.runId)?.statusPayload;
    if (current === undefined || current.status !== 'queued') return;
    const dialoguePacket = buildProcedureRefinementDialoguePromptPacket({
      request,
      scope: current.scope,
      semanticRetrieval: semanticEvidence.result,
    });
    const dialogueFingerprint = plannerProviderRequestFingerprint(dialoguePacket);
    let cumulative = current.assistantMessage;
    let bufferedCharacters = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing = Promise.resolve();
    const queueFlush = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (bufferedCharacters === 0) return;
      bufferedCharacters = 0;
      flushing = flushing.then(() => {
        current = flushMessage(request, current!, cumulative);
      });
    };
    const scheduleTimer = (): void => {
      timer ??= setTimeout(queueFlush, assistantFlushMilliseconds);
    };

    let dialogueResult: ProcedureRefinementDialogueProviderResult;
    const dialogueStartedAt = Date.now();
    let dialogueRequested: ProcedureRefinementDialogueRequestedEvidence | undefined;
    let dialogueRequestedPersisted = false;
    let dialogueCompletedAt: string | undefined;
    try {
      dialogueResult = await invocationManager.execute({
        requestId: request.dialogueRequestId,
        providerId: request.providerDisclosure.providerDescriptor.id,
        operation: 'procedure_refinement_dialogue',
        fingerprint: dialogueFingerprint,
        planKey: [request.baseTree.tree.adapterId, request.baseTree.tree.id],
        requiresReplan: false,
        requiresProcedureRefinement: true,
        attempt: async (attemptContext) => {
          const liveTreatment = snapshotPlannerProviderRuntimeTreatment(
            attemptContext.registered.provider,
            attemptContext.registered.descriptor,
            'procedure_refinement_dialogue',
          );
          if (
            liveTreatment === undefined ||
            !sameValue(liveTreatment, request.providerDisclosure.dialogueRuntimeTreatment)
          ) {
            throw new PlannerGenerationRuntimeError(
              'planner_identity_mismatch',
              'Procedure refinement dialogue runtime treatment changed after authorization',
              'new_request_id',
            );
          }
          const requested = procedureRefinementDialogueRequestedEventSchema.parse({
            formatVersion: procedureRefinementFormatVersion,
            operation: 'procedure_refinement_dialogue',
            runId: request.runId,
            requestId: request.dialogueRequestId,
            requestFingerprint: dialogueFingerprint,
            providerId: attemptContext.registered.descriptor.id,
            providerVersion: attemptContext.registered.descriptor.version,
            packetContentSha256: dialoguePacket.integrity.contentSha256,
            treatmentContentSha256:
              request.providerDisclosure.dialogueRuntimeTreatment.treatmentContentSha256,
            occurredAt: now().toISOString(),
          });
          dialogueRequested = requested;
          const requestedStored = appendEvidence({
            id: `procedure-refinement-dialogue-requested:${request.dialogueRequestId}`,
            eventType: 'procedure.refinement.dialogue.requested',
            payload: requested,
          });
          dialogueRequestedPersisted = true;
          attemptContext.markAttempted();
          current = transition(request, current!, {
            ...current!,
            status: 'streaming',
            terminal: false,
          });
          const raw = await attemptContext.invoke((provider, signal) => {
            if (provider.procedureRefinementDialogue === undefined) {
              throw new Error('Procedure refinement dialogue provider disappeared');
            }
            return provider.procedureRefinementDialogue({
              requestId: request.dialogueRequestId,
              packet: immutableClone(dialoguePacket),
              signal,
              emit: (event) => {
                if (
                  event.type !== 'assistant_text_delta' ||
                  event.delta.length === 0 ||
                  event.delta.length > 4_096 ||
                  cumulative.length + event.delta.length >
                    procedureRefinementMaximumAssistantMessageCharacters
                ) {
                  throw new PlannerGenerationRuntimeError(
                    'planner_output_invalid',
                    'Procedure refinement dialogue emitted an invalid assistant text delta',
                    'new_request_id',
                  );
                }
                cumulative += event.delta;
                bufferedCharacters += event.delta.length;
                if (bufferedCharacters >= assistantFlushCharacters) queueFlush();
                else scheduleTimer();
              },
            });
          });
          queueFlush();
          await flushing;
          const result = procedureRefinementDialogueProviderResultSchema.parse(
            sanitizePlannerProviderOutput(raw),
          );
          if (cumulative !== result.assistantMessage) {
            throw new PlannerGenerationRuntimeError(
              'planner_output_invalid',
              'Streamed assistant text did not exactly match the final dialogue result',
              'new_request_id',
            );
          }
          current = flushMessage(request, current!, result.assistantMessage);
          const completed = procedureRefinementDialogueCompletedEventSchema.parse({
            ...requested,
            result,
            resultContentSha256: sha256(result),
            durationMs: Math.max(0, Date.now() - dialogueStartedAt),
            occurredAt: timestampAtOrAfter(requested.occurredAt),
          });
          dialogueCompletedAt = completed.occurredAt;
          const completedStored = appendEvidence({
            id: `procedure-refinement-dialogue-completed:${request.dialogueRequestId}`,
            eventType: 'procedure.refinement.dialogue.completed',
            payload: completed,
          });
          if (completedStored.sequence <= requestedStored.sequence) {
            throw new Error('Dialogue completion evidence was persisted out of order');
          }
          return result;
        },
      });
    } catch (error) {
      if (timer !== undefined) clearTimeout(timer);
      queueFlush();
      await flushing.catch(() => undefined);
      current = read(request.runId)?.statusPayload ?? current;
      let durableFailure = providerFailure(error);
      let failedEvidenceMissing = false;
      if (dialogueRequested !== undefined && dialogueRequestedPersisted) {
        try {
          appendEvidence({
            id: `procedure-refinement-dialogue-failed:${request.dialogueRequestId}`,
            eventType: 'procedure.refinement.dialogue.failed',
            payload: procedureRefinementDialogueFailedEventSchema.parse({
              ...dialogueRequested,
              error: {
                code: durableFailure.code,
                message: durableFailure.message,
                retryable: durableFailure.retryable,
              },
              durationMs: Math.max(0, Date.now() - dialogueStartedAt),
              occurredAt: timestampAtOrAfter(dialogueRequested.occurredAt),
            }),
          });
        } catch (evidenceError) {
          durableFailure = providerFailure(evidenceError);
          failedEvidenceMissing = true;
        }
      }
      if (current !== undefined && !current.terminal) {
        try {
          fail(request, current, durableFailure, failedEvidenceMissing ? 'interrupted' : 'failed');
        } catch (transitionError) {
          const durable = read(request.runId)?.statusPayload;
          if (durable === undefined || !durable.terminal) throw transitionError;
        }
      }
      return;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    current = read(request.runId)?.statusPayload ?? current;
    if (dialogueResult.decision.kind === 'answer') {
      transition(request, current, {
        ...current,
        status: 'answered',
        terminal: true,
        semanticDecision: dialogueResult.decision,
      });
      return;
    }
    current = transition(request, current, {
      ...current,
      status: 'refining',
      terminal: false,
      semanticDecision: dialogueResult.decision,
    });
    const refinementPacket = buildProcedureRefinementPromptPacket({
      request,
      scope: current.scope,
      semanticRetrieval: semanticEvidence.result,
      dialogueResult,
    });
    const refinementFingerprint = plannerProviderRequestFingerprint(refinementPacket);
    const refinementStartedAt = Date.now();
    let refinementRequested: ProcedureRefinementGenerationRequestedEvidence | undefined;
    let refinementRequestedPersisted = false;
    let refinementCompletedAt: string | undefined;
    try {
      const outcome = await invocationManager.execute({
        requestId: request.refinementRequestId,
        providerId: request.providerDisclosure.providerDescriptor.id,
        operation: 'procedure_refinement',
        fingerprint: refinementFingerprint,
        planKey: [request.baseTree.tree.adapterId, request.baseTree.tree.id],
        requiresReplan: false,
        requiresProcedureRefinement: true,
        attempt: async (attemptContext) => {
          const liveTreatment = snapshotPlannerProviderRuntimeTreatment(
            attemptContext.registered.provider,
            attemptContext.registered.descriptor,
            'procedure_refinement',
          );
          if (
            liveTreatment === undefined ||
            !sameValue(liveTreatment, request.providerDisclosure.refinementRuntimeTreatment)
          ) {
            throw new PlannerGenerationRuntimeError(
              'planner_identity_mismatch',
              'Procedure refinement runtime treatment changed after authorization',
              'new_request_id',
            );
          }
          const requested = procedureRefinementGenerationRequestedEventSchema.parse({
            formatVersion: procedureRefinementFormatVersion,
            operation: 'procedure_refinement',
            runId: request.runId,
            requestId: request.refinementRequestId,
            requestFingerprint: refinementFingerprint,
            providerId: attemptContext.registered.descriptor.id,
            providerVersion: attemptContext.registered.descriptor.version,
            packetContentSha256: refinementPacket.integrity.contentSha256,
            treatmentContentSha256:
              request.providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
            occurredAt:
              dialogueCompletedAt === undefined
                ? now().toISOString()
                : timestampAtOrAfter(dialogueCompletedAt),
          });
          refinementRequested = requested;
          const requestedStored = appendEvidence({
            id: `procedure-refinement-generation-requested:${request.refinementRequestId}`,
            eventType: 'procedure.refinement.generation.requested',
            payload: requested,
          });
          refinementRequestedPersisted = true;
          attemptContext.markAttempted();
          const raw = await attemptContext.invoke((provider, signal) => {
            if (provider.refineProcedure === undefined) {
              throw new Error('Procedure refinement provider disappeared');
            }
            return provider.refineProcedure({
              requestId: request.refinementRequestId,
              packet: immutableClone(refinementPacket),
              signal,
            });
          });
          const providerOutput = sanitizePlannerProviderOutput(raw);
          let completedOutcome: ProcedureRefinementGenerationCompletedEvidence['outcome'];
          const parsedTree = procedureTreeSchema.safeParse(providerOutput);
          if (!parsedTree.success) {
            completedOutcome = {
              kind: 'invalid',
              providerOutputContentSha256: sha256(providerOutput),
              safeMessage: 'The provider output was not a complete valid ProcedureTree.',
            };
          } else {
            const result = procedureRefinementProviderResultSchema.parse({
              formatVersion: procedureRefinementFormatVersion,
              runId: request.runId,
              refinementRequestId: request.refinementRequestId,
              treeId: request.baseTree.tree.id,
              targetRevision: request.targetRevision,
              packetContentSha256: refinementPacket.integrity.contentSha256,
              providerOutputContentSha256: sha256(providerOutput),
              targetTreeContentSha256: sha256(parsedTree.data),
              targetTree: parsedTree.data,
            });
            completedOutcome = { kind: 'valid', providerResult: result };
          }
          const completed = procedureRefinementGenerationCompletedEventSchema.parse({
            ...requested,
            outcome: completedOutcome,
            durationMs: Math.max(0, Date.now() - refinementStartedAt),
            occurredAt: timestampAtOrAfter(requested.occurredAt),
          });
          refinementCompletedAt = completed.occurredAt;
          const completedStored = appendEvidence({
            id: `procedure-refinement-generation-completed:${request.refinementRequestId}`,
            eventType: 'procedure.refinement.generation.completed',
            payload: completed,
          });
          if (completedStored.sequence <= requestedStored.sequence) {
            throw new Error('Refinement completion evidence was persisted out of order');
          }
          return completedOutcome;
        },
      });
      current = read(request.runId)?.statusPayload ?? current;
      if (outcome.kind === 'invalid') {
        transition(request, current, {
          ...current,
          status: 'needs_revision',
          terminal: true,
          needsRevision: {
            reason: 'provider_output_invalid',
            message: outcome.safeMessage,
            findings: [],
          },
        });
      } else {
        if (refinementCompletedAt === undefined) {
          throw new Error('Procedure refinement completion time is unavailable');
        }
        gateProviderResult(
          request,
          current,
          dialogueResult,
          outcome.providerResult,
          refinementCompletedAt,
        );
      }
    } catch (error) {
      current = read(request.runId)?.statusPayload ?? current;
      let durableFailure = providerFailure(error);
      let failedEvidenceMissing = false;
      if (refinementRequested !== undefined && refinementRequestedPersisted) {
        try {
          appendEvidence({
            id: `procedure-refinement-generation-failed:${request.refinementRequestId}`,
            eventType: 'procedure.refinement.generation.failed',
            payload: procedureRefinementGenerationFailedEventSchema.parse({
              ...refinementRequested,
              error: {
                code: durableFailure.code,
                message: durableFailure.message,
                retryable: durableFailure.retryable,
              },
              durationMs: Math.max(0, Date.now() - refinementStartedAt),
              occurredAt: timestampAtOrAfter(refinementRequested.occurredAt),
            }),
          });
        } catch (evidenceError) {
          durableFailure = providerFailure(evidenceError);
          failedEvidenceMissing = true;
        }
      }
      if (!current.terminal) {
        fail(request, current, durableFailure, failedEvidenceMissing ? 'interrupted' : 'failed');
      }
    }
  };

  const schedule = (work: () => Promise<void>, scheduleFailure: () => Promise<void>): void => {
    let launch: () => Promise<void>;
    let failLaunch: () => Promise<void>;
    let started = false;
    const promise = new Promise<void>((resolve) => {
      const execute = async (action: () => Promise<void>): Promise<void> => {
        if (started) return;
        started = true;
        try {
          await action();
        } catch {
          // Scheduled work owns its durable public failure transition.
        } finally {
          resolve();
        }
      };
      launch = () => execute(work);
      failLaunch = () => execute(scheduleFailure);
    });
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
    if (options.schedule !== undefined) {
      try {
        options.schedule(launch!);
      } catch {
        void failLaunch!();
      }
    } else void launch!();
  };

  const recover = (): void => {
    const evidenceByRequest = new Map<string, ProcedureRefinementProviderEvidence>();
    const failedEvidenceByRequest = new Map<
      string,
      ProcedureRefinementDialogueFailedEvidence | ProcedureRefinementGenerationFailedEvidence
    >();
    const requestedEvidenceByRequest = new Map<
      string,
      ProcedureRefinementDialogueRequestedEvidence | ProcedureRefinementGenerationRequestedEvidence
    >();
    for (const stored of options.existingEvents) {
      if (
        stored.eventType.endsWith('.completed') &&
        procedureRefinementProviderEvidenceEventTypes.includes(
          stored.eventType as ProcedureRefinementEvidenceEventType,
        )
      ) {
        const evidence = parseEvidence(stored);
        evidenceByRequest.set(evidence.requestId, evidence);
      } else if (
        stored.eventType.endsWith('.failed') &&
        procedureRefinementProviderEvidenceEventTypes.includes(
          stored.eventType as ProcedureRefinementEvidenceEventType,
        )
      ) {
        const evidence = parseEvidence(stored) as
          ProcedureRefinementDialogueFailedEvidence | ProcedureRefinementGenerationFailedEvidence;
        failedEvidenceByRequest.set(evidence.requestId, evidence);
      } else if (
        stored.eventType.endsWith('.requested') &&
        procedureRefinementProviderEvidenceEventTypes.includes(
          stored.eventType as ProcedureRefinementEvidenceEventType,
        )
      ) {
        const evidence = parseEvidence(stored) as
          | ProcedureRefinementDialogueRequestedEvidence
          | ProcedureRefinementGenerationRequestedEvidence;
        requestedEvidenceByRequest.set(evidence.requestId, evidence);
      }
    }
    for (const value of options.listActiveRuns()) {
      const run = parseDurableRun(value);
      let status = run.statusPayload;
      const dialogue = evidenceByRequest.get(run.dialogueRequestId) as
        ProcedureRefinementDialogueCompletedEvidence | undefined;
      const refinement = evidenceByRequest.get(run.refinementRequestId) as
        ProcedureRefinementGenerationCompletedEvidence | undefined;
      const dialogueFailed = failedEvidenceByRequest.get(run.dialogueRequestId) as
        ProcedureRefinementDialogueFailedEvidence | undefined;
      const refinementFailed = failedEvidenceByRequest.get(run.refinementRequestId) as
        ProcedureRefinementGenerationFailedEvidence | undefined;
      const dialogueRequested = requestedEvidenceByRequest.get(run.dialogueRequestId);
      const refinementRequested = requestedEvidenceByRequest.get(run.refinementRequestId);
      const expectedScope = createProcedureRefinementScope(
        run.createRequest.baseTree.tree,
        run.createRequest.requestedScopeRootIds,
      );
      if (!sameValue(status.scope, expectedScope)) {
        throw new Error(`Recovered Procedure refinement scope conflicts for ${run.runId}`);
      }
      const semantic = options.completedSemanticEvidence(
        run.createRequest.semanticContext.requestId,
      );
      if (
        semantic === null ||
        semantic.requestId !== run.createRequest.semanticContext.requestId ||
        semantic.retrievalId !== run.createRequest.semanticContext.retrievalId ||
        semantic.resultContentSha256 !== run.createRequest.semanticContext.resultContentSha256 ||
        semantic.eventContentSha256 !==
          run.createRequest.semanticContext.completedEventContentSha256 ||
        semantic.occurredAt !== run.createRequest.semanticContext.completedAt ||
        semantic.result.hits.length === 0
      ) {
        throw new Error(
          `Recovered Procedure refinement semantic evidence conflicts for ${run.runId}`,
        );
      }
      if (dialogueRequested !== undefined) {
        const dialoguePacket = buildProcedureRefinementDialoguePromptPacket({
          request: run.createRequest,
          scope: expectedScope,
          semanticRetrieval: semantic.result,
        });
        if (
          dialogueRequested.operation !== 'procedure_refinement_dialogue' ||
          dialogueRequested.runId !== run.runId ||
          dialogueRequested.requestId !== run.dialogueRequestId ||
          dialogueRequested.providerId !==
            run.createRequest.providerDisclosure.providerDescriptor.id ||
          dialogueRequested.providerVersion !==
            run.createRequest.providerDisclosure.providerDescriptor.version ||
          dialogueRequested.treatmentContentSha256 !==
            run.createRequest.providerDisclosure.dialogueRuntimeTreatment.treatmentContentSha256 ||
          dialogueRequested.packetContentSha256 !== dialoguePacket.integrity.contentSha256 ||
          dialogueRequested.requestFingerprint !== plannerProviderRequestFingerprint(dialoguePacket)
        ) {
          throw new Error(
            `Recovered Procedure refinement dialogue evidence conflicts for ${run.runId}`,
          );
        }
      }
      if (dialogue !== undefined && refinementRequested !== undefined) {
        if (dialogue.result.decision.kind !== 'refine') {
          throw new Error(`Recovered generation follows a non-refine decision for ${run.runId}`);
        }
        const refinementPacket = buildProcedureRefinementPromptPacket({
          request: run.createRequest,
          scope: expectedScope,
          semanticRetrieval: semantic.result,
          dialogueResult: dialogue.result,
        });
        if (
          refinementRequested.operation !== 'procedure_refinement' ||
          refinementRequested.runId !== run.runId ||
          refinementRequested.requestId !== run.refinementRequestId ||
          refinementRequested.providerId !==
            run.createRequest.providerDisclosure.providerDescriptor.id ||
          refinementRequested.providerVersion !==
            run.createRequest.providerDisclosure.providerDescriptor.version ||
          refinementRequested.treatmentContentSha256 !==
            run.createRequest.providerDisclosure.refinementRuntimeTreatment
              .treatmentContentSha256 ||
          refinementRequested.packetContentSha256 !== refinementPacket.integrity.contentSha256 ||
          refinementRequested.requestFingerprint !==
            plannerProviderRequestFingerprint(refinementPacket)
        ) {
          throw new Error(
            `Recovered Procedure refinement generation evidence conflicts for ${run.runId}`,
          );
        }
      }
      if (dialogueFailed !== undefined) {
        failActive(run.createRequest, restoredProviderFailure(dialogueFailed.error));
        continue;
      }
      if (refinementFailed !== undefined) {
        failActive(run.createRequest, restoredProviderFailure(refinementFailed.error));
        continue;
      }
      if (status.status === 'awaiting_review') {
        if (
          dialogue === undefined ||
          refinement === undefined ||
          refinement.outcome.kind !== 'valid' ||
          status.preview === null
        ) {
          throw new Error(
            `Reviewable Procedure refinement lacks completed evidence for ${run.runId}`,
          );
        }
        const providerResult = refinement.outcome.providerResult;
        const evaluation = evaluateProcedureRefinementScope(
          run.createRequest.baseTree.tree,
          providerResult.targetTree,
          run.createRequest.requestedScopeRootIds,
        );
        let compilation: ProcedureRefinementCompileResult | void;
        try {
          compilation = options.compileCandidate(evaluation.targetTree);
        } catch {
          fail(
            run.createRequest,
            status,
            safeError(
              'internal_failed',
              'Procedure refinement stopped after an internal deterministic failure.',
              false,
            ),
          );
          continue;
        }
        const expectedBinding: ProcedureRefinementReviewBinding = {
          runRequestContentSha256: sha256(run.createRequest),
          baseTreeContentSha256: run.createRequest.baseTree.integrity.contentSha256,
          targetTreeContentSha256: sha256(evaluation.targetTree),
          scopeContentSha256: sha256(expectedScope),
          semanticContextContentSha256: sha256(run.createRequest.semanticContext),
          assistantMessageContentSha256: sha256(status.assistantMessage),
          refinementPacketContentSha256: providerResult.packetContentSha256,
          providerOutputContentSha256: providerResult.providerOutputContentSha256,
          localityReportContentSha256: sha256(evaluation.locality),
        };
        if (
          !evaluation.locality.valid ||
          compilation?.valid === false ||
          status.assistantMessage !== dialogue.result.assistantMessage ||
          !sameValue(status.semanticDecision, dialogue.result.decision) ||
          Date.parse(status.preview.reviewReadyAt) < Date.parse(refinement.occurredAt) ||
          !sameValue(status.preview.providerResult, providerResult) ||
          !sameValue(status.preview.targetTree, evaluation.targetTree) ||
          !sameValue(status.preview.localityReport, evaluation.locality) ||
          !sameValue(status.preview.binding, expectedBinding)
        ) {
          throw new Error(`Reviewable Procedure refinement preview conflicts for ${run.runId}`);
        }
        continue;
      }
      if (dialogue === undefined) {
        fail(
          run.createRequest,
          status,
          safeError(
            'interrupted_before_provider_completion',
            'The prior process stopped before durable provider completion evidence was available.',
            true,
          ),
          'interrupted',
        );
      } else {
        if (!dialogue.result.assistantMessage.startsWith(status.assistantMessage)) {
          throw new Error(`Recovered assistant message conflicts for ${run.runId}`);
        }
        if (status.status === 'queued') {
          status = transition(run.createRequest, status, {
            ...status,
            status: 'streaming',
            terminal: false,
            assistantMessage: dialogue.result.assistantMessage,
            assistantMessageRevision:
              status.assistantMessage === dialogue.result.assistantMessage
                ? status.assistantMessageRevision
                : status.assistantMessageRevision + 1,
          });
        } else if (status.assistantMessage !== dialogue.result.assistantMessage) {
          status = flushMessage(run.createRequest, status, dialogue.result.assistantMessage);
        }
      }
      if (dialogue !== undefined && dialogue.result.decision.kind === 'answer') {
        transition(run.createRequest, status, {
          ...status,
          status: 'answered',
          terminal: true,
          semanticDecision: dialogue.result.decision,
        });
      } else if (dialogue !== undefined && refinement === undefined) {
        fail(
          run.createRequest,
          status,
          safeError(
            'interrupted_before_provider_completion',
            'The prior process stopped before durable refinement completion evidence was available.',
            true,
          ),
          'interrupted',
        );
      } else if (dialogue !== undefined && refinement !== undefined) {
        if (status.status !== 'refining') {
          status = transition(run.createRequest, status, {
            ...status,
            status: 'refining',
            terminal: false,
            semanticDecision: dialogue.result.decision,
          });
        }
        if (refinement.outcome.kind === 'invalid') {
          transition(run.createRequest, status, {
            ...status,
            status: 'needs_revision',
            terminal: true,
            semanticDecision: dialogue.result.decision,
            needsRevision: {
              reason: 'provider_output_invalid',
              message: refinement.outcome.safeMessage,
              findings: [],
            },
          });
        } else {
          gateProviderResult(
            run.createRequest,
            status,
            dialogue.result,
            refinement.outcome.providerResult,
            refinement.occurredAt,
          );
        }
      }
    }
  };

  recover();

  return {
    listProviders: () => immutableClone(buildDisclosure(options.registry)),
    getSemanticContextReceipt: (requestId) => {
      const evidence = options.completedSemanticEvidence(requestId);
      return evidence === null
        ? null
        : immutableClone(
            procedureRefinementSemanticContextBindingSchema.parse({
              status: 'completed',
              requestId: evidence.requestId,
              retrievalId: evidence.retrievalId,
              resultContentSha256: evidence.resultContentSha256,
              completedEventContentSha256: evidence.eventContentSha256,
              completedAt: evidence.occurredAt,
            }),
          );
    },
    create: (requestInput) => {
      if (closing) throw new Error('Procedure refinement coordinator is closing');
      const request = procedureRefinementCreateRequestSchema.parse(requestInput);
      const existing = read(request.runId);
      if (existing !== null) {
        if (sameValue(existing.createRequest, request)) {
          return immutableClone(existing.statusPayload);
        }
        throw new Error('Procedure refinement run conflicts with existing durable state');
      }
      const latest = options.getLatestProcedureTree(request.baseTree.tree.id);
      if (latest === null || !sameValue(latest, request.baseTree)) {
        throw new Error('Procedure refinement base tree is not the exact latest stored revision');
      }
      const semantic = options.completedSemanticEvidence(request.semanticContext.requestId);
      if (
        semantic === null ||
        semantic.requestId !== request.semanticContext.requestId ||
        semantic.retrievalId !== request.semanticContext.retrievalId ||
        semantic.resultContentSha256 !== request.semanticContext.resultContentSha256 ||
        semantic.eventContentSha256 !== request.semanticContext.completedEventContentSha256 ||
        semantic.occurredAt !== request.semanticContext.completedAt ||
        semantic.result.hits.length === 0
      ) {
        throw new Error('Procedure refinement semantic context is unavailable or empty');
      }
      const confirmedAt = Date.parse(request.authorization.confirmedAt);
      if (confirmedAt > now().getTime()) {
        throw new Error('Procedure refinement authorization cannot be in the future');
      }
      const liveDisclosure = buildDisclosure(options.registry).providers.find(
        (provider) =>
          provider.providerDescriptor.id === request.providerDisclosure.providerDescriptor.id,
      );
      if (liveDisclosure === undefined || !sameValue(liveDisclosure, request.providerDisclosure)) {
        throw new Error('Procedure refinement provider disclosure is stale or unavailable');
      }
      const scope = createProcedureRefinementScope(
        request.baseTree.tree,
        request.requestedScopeRootIds,
      );
      const status = baseStatus(request, scope, now().toISOString());
      const recorded = options.recordRun(durableRun(request, status));
      if (recorded === 'conflict') {
        const concurrent = read(request.runId);
        if (concurrent !== null && sameValue(concurrent.createRequest, request)) {
          return immutableClone(concurrent.statusPayload);
        }
        throw new Error('Procedure refinement run conflicts with existing durable state');
      }
      if (recorded === 'accepted') {
        const internalFailure = () =>
          failActive(
            request,
            safeError(
              'internal_failed',
              'Procedure refinement stopped after an internal deterministic failure.',
              false,
            ),
          );
        schedule(
          async () => {
            try {
              await runProviderCalls(request, semantic);
            } catch {
              internalFailure();
            }
          },
          async () => internalFailure(),
        );
      }
      return immutableClone(recorded === 'duplicate' ? read(request.runId)!.statusPayload : status);
    },
    get: (runId) => immutableClone(read(runId)?.statusPayload ?? null),
    review: (requestInput) => {
      const review = procedureRefinementReviewRequestSchema.parse(requestInput);
      const durable = read(review.runId);
      if (durable === null) {
        throw new Error('Procedure refinement run is not awaiting review');
      }
      const current = durable.statusPayload;
      if (current.status === 'completed' || current.status === 'discarded') {
        const reviewed = reviewedEvidenceByRun.get(review.runId);
        if (
          reviewed !== undefined &&
          reviewed.requestFingerprint === sha256(review) &&
          sameValue(reviewed.reviewRequest, review) &&
          reviewed.finalStatus === current.status &&
          current.review?.reviewId === reviewed.reviewId &&
          current.review.decision === reviewed.reviewRequest.decision.kind &&
          current.review.reviewedAt === reviewed.reviewRequest.reviewedAt &&
          current.preview !== null &&
          sameValue(current.preview.binding, reviewed.previewBinding)
        ) {
          return immutableClone(current);
        }
        throw new Error('Procedure refinement run was already reviewed with different evidence');
      }
      if (durable.status !== 'awaiting_review') {
        throw new Error('Procedure refinement run is not awaiting review');
      }
      if (
        current.preview === null ||
        !sameValue(review.binding, current.preview.binding) ||
        Date.parse(review.reviewedAt) < Date.parse(current.preview.reviewReadyAt) ||
        Date.parse(review.reviewedAt) > now().getTime()
      ) {
        throw new Error('Procedure refinement review does not bind the current preview and time');
      }
      const occurredAt = now().toISOString();
      const reviewedPayload = procedureRefinementReviewedEventSchema.parse({
        formatVersion: procedureRefinementFormatVersion,
        operation: 'procedure_refinement_review',
        runId: review.runId,
        reviewId: review.reviewId,
        requestFingerprint: sha256(review),
        providerId: current.providerDisclosure.providerDescriptor.id,
        providerVersion: current.providerDisclosure.providerDescriptor.version,
        packetContentSha256: current.preview.binding.refinementPacketContentSha256,
        treatmentContentSha256:
          current.providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
        previewBinding: current.preview.binding,
        reviewRequest: review,
        finalStatus: review.decision.kind === 'store' ? 'completed' : 'discarded',
        procedureStored: review.decision.kind === 'store',
        durationMs: Math.max(0, Date.parse(occurredAt) - Date.parse(review.reviewedAt)),
        occurredAt,
      });
      const event: ExecutionEventInput & { createdAt: string } = {
        id: `procedure-refinement-reviewed:${review.reviewId}`,
        eventType: 'procedure.refinement.reviewed',
        payload: reviewedPayload,
        createdAt: occurredAt,
      };
      const committed = procedureRefinementRunStatusSchema.parse(
        review.decision.kind === 'store'
          ? options.commitStoreReview({
              currentRun: durable,
              reviewRequest: review,
              reviewedEvent: event,
              targetTree: current.preview.targetTree,
            })
          : options.commitDiscardReview({
              currentRun: durable,
              reviewRequest: review,
              reviewedEvent: event,
            }),
      );
      if (
        committed.runId !== review.runId ||
        committed.status !== (review.decision.kind === 'store' ? 'completed' : 'discarded') ||
        committed.review?.reviewId !== review.reviewId ||
        committed.review.decision !== review.decision.kind ||
        !sameValue(committed.preview?.binding, current.preview.binding)
      ) {
        throw new Error('Atomic Procedure refinement review returned inconsistent final state');
      }
      reviewedEvidenceByRun.set(review.runId, immutableClone(reviewedPayload));
      return immutableClone(committed);
    },
    beginClose: () => {
      closing = true;
    },
    close: () => {
      closing = true;
      closePromise ??= Promise.allSettled([...pending])
        .then(() => invocationManager.close())
        .then(() => undefined);
      return closePromise;
    },
  };
}
