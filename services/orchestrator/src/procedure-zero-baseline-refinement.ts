import { createHash } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  procedureRefinementCreateRequestSchema,
  procedureSemanticRetrievalResultSchema,
  storedProcedureTreeSchema,
  type ProcedureRefinementRunStatus,
  type ProcedureTree,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import {
  procedureZeroBaselineNativeRefinementStartedEventSchema,
  procedureZeroBaselineReadyForReviewEventSchema,
  procedureZeroBaselineRefinementCreateRequestSchema,
  procedureZeroBaselineRefinementFormatVersion,
  procedureZeroBaselineRefinementStartRequestSchema,
  procedureZeroBaselineRefinementStatusSchema,
  procedureZeroBaselineReviewBindingSchema,
  procedureZeroBaselineReviewedEventSchema,
  procedureZeroBaselineReviewRequestSchema,
  procedureZeroBaselineSemanticFailedEventSchema,
  procedureZeroBaselineSemanticReadyEventSchema,
  procedureZeroBaselineSemanticStartedEventSchema,
  procedureZeroBaselineSemanticStartRequestSchema,
  procedureZeroBaselineWorkflowCreatedEventSchema,
  type ProcedureZeroBaselineRefinementCreateRequest,
  type ProcedureZeroBaselineRefinementStartRequest,
  type ProcedureZeroBaselineRefinementStatus,
  type ProcedureZeroBaselineReviewBinding,
  type ProcedureZeroBaselineReviewRequest,
  type ProcedureZeroBaselineSemanticStartRequest,
  type ProcedureZeroBaselineStorageBinding,
} from '../../../packages/protocol/src/procedure-zero-baseline-refinement.js';
import type { ProcedureZeroBaselineGenerationCoordinator } from './procedure-zero-baseline-generation.js';
import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import type { ProcedureRefinementCoordinator } from './procedure-refinement-run.js';
import type { ProcedureSemanticRetrievalCoordinator } from './procedure-semantic-retrieval.js';

export const procedureZeroBaselineRefinementEvidenceEventTypes = [
  'procedure.zero-baseline.workflow.created',
  'procedure.zero-baseline.workflow.baseline-ready',
  'procedure.zero-baseline.workflow.baseline-reviewed',
  'procedure.zero-baseline.workflow.semantic-started',
  'procedure.zero-baseline.workflow.semantic-ready',
  'procedure.zero-baseline.workflow.semantic-failed',
  'procedure.zero-baseline.workflow.refinement-started',
] as const;

export interface ProcedureZeroBaselineAtomicStoreInput {
  readonly tree: ProcedureTree;
  readonly evidence: ExecutionEventInput & { readonly createdAt: string };
}

export interface ProcedureZeroBaselineAtomicStoreResult {
  readonly storedTree: StoredProcedureTree;
  readonly storedEvent: StoredExecutionEvent;
}

export interface ProcedureZeroBaselineRefinementCoordinatorOptions {
  readonly generation: ProcedureZeroBaselineGenerationCoordinator;
  readonly semanticRetrieval: Pick<
    ProcedureSemanticRetrievalCoordinator,
    'search' | 'completedResult'
  >;
  readonly refinement: Pick<
    ProcedureRefinementCoordinator,
    'create' | 'get' | 'getSemanticContextReceipt'
  >;
  readonly getProcedureTree: (treeId: string, revision: number) => StoredProcedureTree | null;
  readonly getLatestProcedureTree: (treeId: string) => StoredProcedureTree | null;
  readonly storeWithEvidence: (
    input: ProcedureZeroBaselineAtomicStoreInput,
  ) => ProcedureZeroBaselineAtomicStoreResult;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly appendEvent: (event: ExecutionEventInput) => StoredExecutionEvent;
  readonly now?: () => Date;
}

export interface ProcedureZeroBaselineRefinementCoordinator {
  create(
    request: ProcedureZeroBaselineRefinementCreateRequest,
  ): Promise<ProcedureZeroBaselineRefinementStatus>;
  review(request: ProcedureZeroBaselineReviewRequest): ProcedureZeroBaselineRefinementStatus;
  startSemantic(
    request: ProcedureZeroBaselineSemanticStartRequest,
  ): Promise<ProcedureZeroBaselineRefinementStatus>;
  startRefinement(
    request: ProcedureZeroBaselineRefinementStartRequest,
  ): ProcedureZeroBaselineRefinementStatus;
  get(workflowId: string): ProcedureZeroBaselineRefinementStatus | null;
}

export class ProcedureZeroBaselinePersistenceFaultError extends Error {
  readonly code = 'procedure_zero_baseline_persistence_outcome_unknown' as const;

  constructor(workflowId: string, cause?: unknown) {
    super(`Zero-baseline workflow persistence outcome is unknown for ${workflowId}`, { cause });
    this.name = 'ProcedureZeroBaselinePersistenceFaultError';
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function sameValue(left: unknown, right: unknown): boolean {
  return sha256(left) === sha256(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertDistinctIdentities(identities: readonly string[]): void {
  if (new Set(identities).size !== identities.length) {
    throw new Error('Zero-baseline workflow lifecycle identities must all differ');
  }
}

function semanticFailure(error: unknown): { code: string; message: string; retryable: false } {
  const value = error as { code?: unknown; message?: unknown };
  const rawCode = typeof value?.code === 'string' ? value.code.trim() : '';
  const rawMessage = typeof value?.message === 'string' ? value.message.trim() : '';
  const code = rawCode.length > 0 ? rawCode.slice(0, 200) : 'semantic_retrieval_failed';
  const message = rawMessage.length > 0 ? rawMessage.slice(0, 1_000) : 'Semantic retrieval failed';
  return { code, message, retryable: false };
}

function validateStoredEnvelope(event: StoredExecutionEvent): void {
  if (
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    !Number.isFinite(Date.parse(event.createdAt))
  ) {
    throw new Error('Zero-baseline workflow stored evidence envelope is invalid');
  }
}

function assertStoredEvent(
  stored: StoredExecutionEvent,
  input: ExecutionEventInput,
): StoredExecutionEvent {
  validateStoredEnvelope(stored);
  if (
    stored.id !== input.id ||
    stored.eventType !== input.eventType ||
    stored.createdAt !== input.createdAt ||
    !sameValue(stored.payload, input.payload)
  ) {
    throw new Error('Persisted zero-baseline workflow evidence does not match append input');
  }
  return stored;
}

function reviewBinding(
  request: ProcedureZeroBaselineRefinementCreateRequest,
  baseline: Awaited<ReturnType<ProcedureZeroBaselineGenerationCoordinator['generate']>>,
): ProcedureZeroBaselineReviewBinding {
  if (
    baseline.generation.requestId !== request.generationRequest.requestId ||
    baseline.requestFingerprint !== plannerProviderRequestFingerprint(request.generationRequest)
  ) {
    throw new Error('Zero-baseline generation result does not bind the exact generation request');
  }
  return procedureZeroBaselineReviewBindingSchema.parse({
    workflowRequestContentSha256: sha256(request),
    generationRequestContentSha256: sha256(request.generationRequest),
    baselineResultContentSha256: sha256(baseline),
    candidateTreeContentSha256: sha256(baseline.generation.tree),
  });
}

function assertSemanticRequestBinding(
  request: ProcedureZeroBaselineSemanticStartRequest['request'],
  storedBaseline: StoredProcedureTree,
): void {
  const filters = request.filters;
  const tree = storedBaseline.tree;
  if (
    filters?.adapterId !== tree.adapterId ||
    filters.actionCatalogVersion !== tree.actionCatalogVersion ||
    filters.interactionCatalogVersion !== tree.interactionCatalogVersion
  ) {
    throw new Error('Semantic retrieval must be pinned to the exact stored baseline catalogs');
  }
}

function assertStoredBaseline(
  tree: ProcedureTree,
  storedInput: StoredProcedureTree,
  binding?: ProcedureZeroBaselineStorageBinding,
): StoredProcedureTree {
  const stored = storedProcedureTreeSchema.parse(storedInput);
  if (
    !sameValue(stored.tree, tree) ||
    stored.integrity.contentSha256 !== sha256(tree) ||
    stored.tree.revision !== 1 ||
    (binding !== undefined &&
      (stored.tree.id !== binding.treeId ||
        stored.tree.revision !== binding.revision ||
        stored.integrity.contentSha256 !== binding.contentSha256 ||
        stored.storedAt !== binding.storedAt))
  ) {
    throw new Error('Atomic baseline store returned a different ProcedureTree');
  }
  return stored;
}

function statusAt(
  request: ProcedureZeroBaselineRefinementCreateRequest,
  phase: ProcedureZeroBaselineRefinementStatus['phase'],
  updatedAt: string,
  partial: Partial<ProcedureZeroBaselineRefinementStatus> = {},
): ProcedureZeroBaselineRefinementStatus {
  const storedBaseline = partial.storedBaseline ?? null;
  const refinement = partial.refinement ?? null;
  return procedureZeroBaselineRefinementStatusSchema.parse({
    formatVersion: procedureZeroBaselineRefinementFormatVersion,
    workflowId: request.workflowId,
    requestFingerprint: sha256(request),
    createRequest: request,
    phase,
    terminal:
      phase === 'baseline_discarded' ||
      phase === 'semantic_failed' ||
      (phase === 'refinement' && refinement?.terminal === true),
    baseline: partial.baseline ?? null,
    baselineReviewBinding: partial.baselineReviewBinding ?? null,
    baselineReview: partial.baselineReview ?? null,
    storedBaseline,
    semanticRetrieval: partial.semanticRetrieval ?? null,
    semanticContext: partial.semanticContext ?? null,
    semanticFailure: partial.semanticFailure ?? null,
    refinement,
    sideEffects: {
      procedureStored: storedBaseline !== null,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    updatedAt,
  });
}

export function createProcedureZeroBaselineRefinementCoordinator(
  options: ProcedureZeroBaselineRefinementCoordinatorOptions,
): ProcedureZeroBaselineRefinementCoordinator {
  const now = options.now ?? (() => new Date());
  const statuses = new Map<string, ProcedureZeroBaselineRefinementStatus>();
  const semanticRequests = new Map<string, ProcedureZeroBaselineSemanticStartRequest['request']>();
  const reviewRequests = new Map<string, ProcedureZeroBaselineReviewRequest>();
  const refinementRequests = new Map<
    string,
    ProcedureZeroBaselineRefinementStartRequest['request']
  >();
  const createInFlight = new Map<string, Promise<ProcedureZeroBaselineRefinementStatus>>();
  const semanticInFlight = new Map<string, Promise<ProcedureZeroBaselineRefinementStatus>>();
  const persistenceFaults = new Set<string>();
  let priorSequence = 0;

  const assertNoPersistenceFault = (workflowId: string): void => {
    if (persistenceFaults.has(workflowId)) {
      throw new ProcedureZeroBaselinePersistenceFaultError(workflowId);
    }
  };

  const persistenceFault = (workflowId: string, cause: unknown): never => {
    persistenceFaults.add(workflowId);
    throw new ProcedureZeroBaselinePersistenceFaultError(workflowId, cause);
  };

  const append = (workflowId: string, input: ExecutionEventInput): StoredExecutionEvent => {
    try {
      return assertStoredEvent(options.appendEvent(input), input);
    } catch (error) {
      return persistenceFault(workflowId, error);
    }
  };

  for (const stored of options.existingEvents) {
    if (!procedureZeroBaselineRefinementEvidenceEventTypes.includes(stored.eventType as never)) {
      continue;
    }
    validateStoredEnvelope(stored);
    if (stored.sequence <= priorSequence) {
      throw new Error('Zero-baseline workflow evidence must be strictly sequence ordered');
    }
    priorSequence = stored.sequence;
    const evidenceTime = (stored.payload as { occurredAt?: unknown }).occurredAt;
    if (typeof evidenceTime !== 'string' || stored.createdAt !== evidenceTime) {
      throw new Error('Zero-baseline workflow evidence timestamp binding is invalid');
    }

    if (stored.eventType === 'procedure.zero-baseline.workflow.created') {
      const event = procedureZeroBaselineWorkflowCreatedEventSchema.parse(stored.payload);
      if (
        stored.id !== `procedure-zero-baseline-workflow-created:${event.workflowId}` ||
        event.workflowId !== event.request.workflowId ||
        event.requestFingerprint !== sha256(event.request) ||
        statuses.has(event.workflowId)
      ) {
        throw new Error('Zero-baseline workflow created evidence is invalid');
      }
      statuses.set(event.workflowId, statusAt(event.request, 'generating', event.occurredAt));
      continue;
    }

    const raw = stored.payload as { workflowId?: unknown };
    if (typeof raw.workflowId !== 'string') {
      throw new Error('Zero-baseline workflow evidence is missing workflow identity');
    }
    const current = statuses.get(raw.workflowId);
    if (current === undefined) {
      throw new Error('Zero-baseline workflow evidence is missing its created predecessor');
    }
    if (Date.parse(stored.createdAt) < Date.parse(current.updatedAt)) {
      throw new Error('Zero-baseline workflow evidence time ordering is invalid');
    }
    if (stored.eventType === 'procedure.zero-baseline.workflow.baseline-ready') {
      const event = procedureZeroBaselineReadyForReviewEventSchema.parse(stored.payload);
      const binding = reviewBinding(current.createRequest, event.baseline);
      assertDistinctIdentities([
        event.workflowId,
        current.createRequest.generationRequest.requestId,
        event.baseline.generation.generationId,
      ]);
      if (
        stored.id !== `procedure-zero-baseline-workflow-baseline-ready:${event.workflowId}` ||
        current.phase !== 'generating' ||
        event.requestFingerprint !== current.requestFingerprint ||
        !sameValue(event.binding, binding)
      ) {
        throw new Error('Zero-baseline ready-for-review evidence is invalid');
      }
      statuses.set(
        event.workflowId,
        statusAt(current.createRequest, 'awaiting_baseline_review', event.occurredAt, {
          baseline: event.baseline,
          baselineReviewBinding: event.binding,
        }),
      );
    } else if (stored.eventType === 'procedure.zero-baseline.workflow.baseline-reviewed') {
      const event = procedureZeroBaselineReviewedEventSchema.parse(stored.payload);
      const store = event.reviewRequest.decision.kind === 'store';
      assertDistinctIdentities([
        event.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        event.reviewRequest.reviewId,
      ]);
      if (
        stored.id !==
          `procedure-zero-baseline-workflow-baseline-reviewed:${event.reviewRequest.reviewId}` ||
        current.phase !== 'awaiting_baseline_review' ||
        event.requestFingerprint !== current.requestFingerprint ||
        event.reviewRequest.workflowId !== event.workflowId ||
        !sameValue(event.reviewRequest.binding, current.baselineReviewBinding) ||
        event.finalStatus !== (store ? 'stored' : 'discarded') ||
        store !== (event.storageBinding !== null)
      ) {
        throw new Error('Zero-baseline reviewed evidence is invalid');
      }
      const storedBaseline =
        event.storageBinding === null
          ? null
          : (() => {
              const restored = options.getProcedureTree(
                event.storageBinding.treeId,
                event.storageBinding.revision,
              );
              if (restored === null) {
                throw new Error('Stored zero-baseline referenced by review evidence is missing');
              }
              return assertStoredBaseline(
                current.baseline!.generation.tree,
                restored,
                event.storageBinding,
              );
            })();
      if (
        Date.parse(event.reviewRequest.reviewedAt) < Date.parse(current.updatedAt) ||
        Date.parse(event.occurredAt) < Date.parse(event.reviewRequest.reviewedAt)
      ) {
        throw new Error('Zero-baseline reviewed evidence time ordering is invalid');
      }
      reviewRequests.set(event.workflowId, event.reviewRequest);
      statuses.set(
        event.workflowId,
        statusAt(
          current.createRequest,
          store ? 'awaiting_semantic' : 'baseline_discarded',
          event.occurredAt,
          {
            baseline: current.baseline,
            baselineReviewBinding: current.baselineReviewBinding,
            baselineReview: {
              reviewId: event.reviewRequest.reviewId,
              decision: event.reviewRequest.decision.kind,
              reviewedAt: event.reviewRequest.reviewedAt,
            },
            storedBaseline,
          },
        ),
      );
    } else if (stored.eventType === 'procedure.zero-baseline.workflow.semantic-started') {
      const event = procedureZeroBaselineSemanticStartedEventSchema.parse(stored.payload);
      assertDistinctIdentities([
        event.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        current.baselineReview!.reviewId,
        event.request.requestId,
      ]);
      if (
        stored.id !==
          `procedure-zero-baseline-workflow-semantic-started:${event.request.requestId}` ||
        current.phase !== 'awaiting_semantic' ||
        semanticRequests.has(event.workflowId) ||
        event.requestFingerprint !== current.requestFingerprint ||
        event.requestContentSha256 !== sha256(event.request) ||
        event.storedBaselineContentSha256 !== sha256(current.storedBaseline)
      ) {
        throw new Error('Zero-baseline semantic-started evidence is invalid');
      }
      assertSemanticRequestBinding(event.request, current.storedBaseline!);
      semanticRequests.set(event.workflowId, event.request);
      statuses.set(
        event.workflowId,
        statusAt(current.createRequest, 'semantic_retrieving', event.occurredAt, {
          ...current,
        }),
      );
    } else if (stored.eventType === 'procedure.zero-baseline.workflow.semantic-failed') {
      const event = procedureZeroBaselineSemanticFailedEventSchema.parse(stored.payload);
      const semanticRequest = semanticRequests.get(event.workflowId);
      assertDistinctIdentities([
        event.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        current.baselineReview!.reviewId,
        event.failure.requestId,
      ]);
      if (
        stored.id !==
          `procedure-zero-baseline-workflow-semantic-failed:${event.failure.requestId}` ||
        current.phase !== 'semantic_retrieving' ||
        semanticRequest === undefined ||
        event.requestFingerprint !== current.requestFingerprint ||
        event.failure.requestId !== semanticRequest.requestId ||
        event.failure.requestContentSha256 !== sha256(semanticRequest) ||
        event.failure.failedAt !== event.occurredAt
      ) {
        throw new Error('Zero-baseline semantic-failed evidence is invalid');
      }
      statuses.set(
        event.workflowId,
        statusAt(current.createRequest, 'semantic_failed', event.occurredAt, {
          ...current,
          semanticFailure: event.failure,
        }),
      );
    } else if (stored.eventType === 'procedure.zero-baseline.workflow.semantic-ready') {
      const event = procedureZeroBaselineSemanticReadyEventSchema.parse(stored.payload);
      const semanticRequest = semanticRequests.get(event.workflowId);
      const liveContext = options.refinement.getSemanticContextReceipt(event.result.requestId);
      if (
        stored.id !== `procedure-zero-baseline-workflow-semantic-ready:${event.result.requestId}` ||
        current.phase !== 'semantic_retrieving' ||
        semanticRequest === undefined ||
        event.result.requestId !== semanticRequest.requestId ||
        event.result.hits.length === 0 ||
        event.semanticContext.requestId !== event.result.requestId ||
        event.semanticContext.retrievalId !== event.result.retrievalId ||
        event.semanticContext.resultContentSha256 !== sha256(event.result) ||
        liveContext === null ||
        !sameValue(liveContext, event.semanticContext)
      ) {
        throw new Error('Zero-baseline semantic-ready evidence is invalid');
      }
      statuses.set(
        event.workflowId,
        statusAt(current.createRequest, 'awaiting_refinement', event.occurredAt, {
          ...current,
          semanticRetrieval: event.result,
          semanticContext: event.semanticContext,
        }),
      );
    } else if (stored.eventType === 'procedure.zero-baseline.workflow.refinement-started') {
      const event = procedureZeroBaselineNativeRefinementStartedEventSchema.parse(stored.payload);
      assertDistinctIdentities([
        event.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        current.baselineReview!.reviewId,
        current.semanticRetrieval!.requestId,
        event.request.runId,
        event.request.dialogueRequestId,
        event.request.refinementRequestId,
      ]);
      if (
        stored.id !==
          `procedure-zero-baseline-workflow-refinement-started:${event.request.runId}` ||
        current.phase !== 'awaiting_refinement' ||
        refinementRequests.has(event.workflowId) ||
        event.requestFingerprint !== current.requestFingerprint ||
        event.requestContentSha256 !== sha256(event.request)
      ) {
        throw new Error('Zero-baseline refinement-started evidence is invalid');
      }
      const latest = options.getLatestProcedureTree(current.storedBaseline!.tree.id);
      if (
        latest === null ||
        !sameValue(latest, current.storedBaseline) ||
        !sameValue(event.request.baseTree, current.storedBaseline) ||
        !sameValue(event.request.semanticContext, current.semanticContext)
      ) {
        throw new Error('Restored native refinement does not bind the exact latest baseline');
      }
      refinementRequests.set(event.workflowId, event.request);
      const refinement = options.refinement.create(event.request);
      statuses.set(
        event.workflowId,
        statusAt(current.createRequest, 'refinement', event.occurredAt, {
          ...current,
          refinement,
        }),
      );
    }
  }

  const project = (workflowId: string): ProcedureZeroBaselineRefinementStatus | null => {
    const current = statuses.get(workflowId);
    if (current === undefined) return null;
    if (current.phase !== 'refinement') return clone(current);
    const request = refinementRequests.get(workflowId);
    if (request === undefined) throw new Error('Native refinement request is missing');
    const refinement = options.refinement.get(request.runId);
    if (refinement === null) throw new Error('Native refinement durable state is missing');
    const projected = statusAt(current.createRequest, 'refinement', refinement.updatedAt, {
      ...current,
      refinement,
    });
    statuses.set(workflowId, projected);
    return clone(projected);
  };

  return {
    create: async (requestInput) => {
      const request = procedureZeroBaselineRefinementCreateRequestSchema.parse(requestInput);
      assertNoPersistenceFault(request.workflowId);
      const existing = statuses.get(request.workflowId);
      if (existing !== undefined) {
        if (!sameValue(existing.createRequest, request)) {
          throw new Error('Zero-baseline workflow identity conflicts with durable request');
        }
        if (existing.phase !== 'generating') return project(request.workflowId)!;
      }
      const running = createInFlight.get(request.workflowId);
      if (running !== undefined) return clone(await running);
      const promise = (async () => {
        let current = statuses.get(request.workflowId);
        if (current === undefined) {
          const occurredAt = now().toISOString();
          const event = procedureZeroBaselineWorkflowCreatedEventSchema.parse({
            formatVersion: procedureZeroBaselineRefinementFormatVersion,
            workflowId: request.workflowId,
            requestFingerprint: sha256(request),
            request,
            sideEffects: {
              procedureStored: false,
              proposalCreated: false,
              hostExecutionStarted: false,
            },
            occurredAt,
          });
          append(request.workflowId, {
            id: `procedure-zero-baseline-workflow-created:${request.workflowId}`,
            eventType: 'procedure.zero-baseline.workflow.created',
            payload: event,
            createdAt: occurredAt,
          });
          current = statusAt(request, 'generating', occurredAt);
          statuses.set(request.workflowId, current);
        }
        const baseline = await options.generation.generate(request.generationRequest);
        assertDistinctIdentities([
          request.workflowId,
          request.generationRequest.requestId,
          baseline.generation.generationId,
        ]);
        const binding = reviewBinding(request, baseline);
        const occurredAt = now().toISOString();
        const event = procedureZeroBaselineReadyForReviewEventSchema.parse({
          formatVersion: procedureZeroBaselineRefinementFormatVersion,
          workflowId: request.workflowId,
          requestFingerprint: sha256(request),
          baseline,
          binding,
          sideEffects: {
            procedureStored: false,
            proposalCreated: false,
            hostExecutionStarted: false,
          },
          occurredAt,
        });
        append(request.workflowId, {
          id: `procedure-zero-baseline-workflow-baseline-ready:${request.workflowId}`,
          eventType: 'procedure.zero-baseline.workflow.baseline-ready',
          payload: event,
          createdAt: occurredAt,
        });
        const next = statusAt(request, 'awaiting_baseline_review', occurredAt, {
          baseline,
          baselineReviewBinding: binding,
        });
        statuses.set(request.workflowId, next);
        return clone(next);
      })().finally(() => createInFlight.delete(request.workflowId));
      createInFlight.set(request.workflowId, promise);
      return clone(await promise);
    },
    review: (requestInput) => {
      const request = procedureZeroBaselineReviewRequestSchema.parse(requestInput);
      assertNoPersistenceFault(request.workflowId);
      const current = statuses.get(request.workflowId);
      if (current === undefined || current.phase === 'generating') {
        throw new Error('Zero-baseline candidate is not ready for review');
      }
      if (current.baselineReview !== null) {
        if (sameValue(reviewRequests.get(request.workflowId), request)) {
          return project(request.workflowId)!;
        }
        throw new Error('Zero-baseline workflow already has a different review');
      }
      assertDistinctIdentities([
        request.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        request.reviewId,
      ]);
      if (
        current.phase !== 'awaiting_baseline_review' ||
        !sameValue(current.baselineReviewBinding, request.binding) ||
        Date.parse(request.reviewedAt) < Date.parse(current.updatedAt) ||
        Date.parse(request.reviewedAt) > now().getTime()
      ) {
        throw new Error('Zero-baseline review does not bind the current candidate and time');
      }
      const occurredAt = now().toISOString();
      const storageBinding: ProcedureZeroBaselineStorageBinding | null =
        request.decision.kind === 'store'
          ? {
              treeId: current.baseline!.generation.tree.id,
              revision: 1,
              contentSha256: sha256(current.baseline!.generation.tree),
              storedAt: occurredAt,
            }
          : null;
      const evidence = (() => {
        const payload = procedureZeroBaselineReviewedEventSchema.parse({
          formatVersion: procedureZeroBaselineRefinementFormatVersion,
          workflowId: request.workflowId,
          requestFingerprint: current.requestFingerprint,
          reviewRequest: request,
          finalStatus: request.decision.kind === 'store' ? 'stored' : 'discarded',
          storageBinding,
          sideEffects: {
            procedureStored: request.decision.kind === 'store',
            proposalCreated: false,
            hostExecutionStarted: false,
          },
          occurredAt,
        });
        return {
          id: `procedure-zero-baseline-workflow-baseline-reviewed:${request.reviewId}`,
          eventType: 'procedure.zero-baseline.workflow.baseline-reviewed',
          payload,
          createdAt: occurredAt,
        } satisfies ExecutionEventInput & { createdAt: string };
      })();
      let storedBaseline: StoredProcedureTree | null = null;
      if (request.decision.kind === 'store') {
        try {
          const committed = options.storeWithEvidence({
            tree: current.baseline!.generation.tree,
            evidence,
          });
          storedBaseline = assertStoredBaseline(
            current.baseline!.generation.tree,
            committed.storedTree,
            storageBinding!,
          );
          assertStoredEvent(committed.storedEvent, evidence);
        } catch (error) {
          return persistenceFault(request.workflowId, error);
        }
      } else {
        append(request.workflowId, evidence);
      }
      const next = statusAt(
        current.createRequest,
        request.decision.kind === 'store' ? 'awaiting_semantic' : 'baseline_discarded',
        occurredAt,
        {
          baseline: current.baseline,
          baselineReviewBinding: current.baselineReviewBinding,
          baselineReview: {
            reviewId: request.reviewId,
            decision: request.decision.kind,
            reviewedAt: request.reviewedAt,
          },
          storedBaseline,
        },
      );
      reviewRequests.set(request.workflowId, request);
      statuses.set(request.workflowId, next);
      return clone(next);
    },
    startSemantic: async (requestInput) => {
      const request = procedureZeroBaselineSemanticStartRequestSchema.parse(requestInput);
      assertNoPersistenceFault(request.workflowId);
      const current = statuses.get(request.workflowId);
      if (current === undefined) {
        throw new Error('A reviewed stored zero-baseline is required before semantic retrieval');
      }
      const priorRequest = semanticRequests.get(request.workflowId);
      if (priorRequest !== undefined && !sameValue(priorRequest, request.request)) {
        throw new Error('Zero-baseline semantic request conflicts with durable evidence');
      }
      if (
        priorRequest !== undefined &&
        (current.phase === 'awaiting_refinement' || current.phase === 'refinement')
      ) {
        return project(request.workflowId)!;
      }
      if (
        !['awaiting_semantic', 'semantic_retrieving'].includes(current.phase) ||
        current.storedBaseline === null
      ) {
        throw new Error('A reviewed stored zero-baseline is required before semantic retrieval');
      }
      assertDistinctIdentities([
        request.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        current.baselineReview!.reviewId,
        request.request.requestId,
      ]);
      assertSemanticRequestBinding(request.request, current.storedBaseline);
      const running = semanticInFlight.get(request.workflowId);
      if (running !== undefined) return clone(await running);
      const promise = (async () => {
        if (priorRequest === undefined) {
          const occurredAt = now().toISOString();
          const event = procedureZeroBaselineSemanticStartedEventSchema.parse({
            formatVersion: procedureZeroBaselineRefinementFormatVersion,
            workflowId: request.workflowId,
            requestFingerprint: current.requestFingerprint,
            request: request.request,
            requestContentSha256: sha256(request.request),
            storedBaselineContentSha256: sha256(current.storedBaseline),
            sideEffects: {
              procedureStored: true,
              proposalCreated: false,
              hostExecutionStarted: false,
            },
            occurredAt,
          });
          append(request.workflowId, {
            id: `procedure-zero-baseline-workflow-semantic-started:${request.request.requestId}`,
            eventType: 'procedure.zero-baseline.workflow.semantic-started',
            payload: event,
            createdAt: occurredAt,
          });
          semanticRequests.set(request.workflowId, request.request);
          statuses.set(
            request.workflowId,
            statusAt(current.createRequest, 'semantic_retrieving', occurredAt, {
              ...current,
            }),
          );
        }
        let result: ReturnType<typeof procedureSemanticRetrievalResultSchema.parse>;
        let semanticContext: NonNullable<ProcedureZeroBaselineRefinementStatus['semanticContext']>;
        try {
          const searched = procedureSemanticRetrievalResultSchema.parse(
            await options.semanticRetrieval.search(request.request),
          );
          const completed = options.semanticRetrieval.completedResult(request.request.requestId);
          if (completed === null || !sameValue(completed, searched)) {
            throw new Error(
              'Semantic retrieval success is missing its exact durable completion result',
            );
          }
          result = procedureSemanticRetrievalResultSchema.parse(completed);
          const receipt = options.refinement.getSemanticContextReceipt(request.request.requestId);
          if (
            result.requestId !== request.request.requestId ||
            result.hits.length === 0 ||
            receipt === null ||
            receipt.requestId !== result.requestId ||
            receipt.retrievalId !== result.retrievalId ||
            receipt.resultContentSha256 !== sha256(result)
          ) {
            throw new Error('Semantic retrieval did not produce exact nonempty refinement context');
          }
          semanticContext = receipt;
        } catch (error) {
          const failedAt = now().toISOString();
          const event = procedureZeroBaselineSemanticFailedEventSchema.parse({
            formatVersion: procedureZeroBaselineRefinementFormatVersion,
            workflowId: request.workflowId,
            requestFingerprint: current.requestFingerprint,
            failure: {
              requestId: request.request.requestId,
              requestContentSha256: sha256(request.request),
              error: semanticFailure(error),
              failedAt,
            },
            sideEffects: {
              procedureStored: true,
              proposalCreated: false,
              hostExecutionStarted: false,
            },
            occurredAt: failedAt,
          });
          append(request.workflowId, {
            id: `procedure-zero-baseline-workflow-semantic-failed:${request.request.requestId}`,
            eventType: 'procedure.zero-baseline.workflow.semantic-failed',
            payload: event,
            createdAt: failedAt,
          });
          statuses.set(
            request.workflowId,
            statusAt(current.createRequest, 'semantic_failed', failedAt, {
              ...current,
              semanticFailure: event.failure,
            }),
          );
          throw error;
        }
        const occurredAt = now().toISOString();
        const event = procedureZeroBaselineSemanticReadyEventSchema.parse({
          formatVersion: procedureZeroBaselineRefinementFormatVersion,
          workflowId: request.workflowId,
          requestFingerprint: current.requestFingerprint,
          result,
          semanticContext,
          sideEffects: {
            procedureStored: true,
            proposalCreated: false,
            hostExecutionStarted: false,
          },
          occurredAt,
        });
        append(request.workflowId, {
          id: `procedure-zero-baseline-workflow-semantic-ready:${result.requestId}`,
          eventType: 'procedure.zero-baseline.workflow.semantic-ready',
          payload: event,
          createdAt: occurredAt,
        });
        const next = statusAt(current.createRequest, 'awaiting_refinement', occurredAt, {
          ...current,
          semanticRetrieval: result,
          semanticContext,
        });
        statuses.set(request.workflowId, next);
        return clone(next);
      })().finally(() => semanticInFlight.delete(request.workflowId));
      semanticInFlight.set(request.workflowId, promise);
      return clone(await promise);
    },
    startRefinement: (requestInput) => {
      const wrapper = procedureZeroBaselineRefinementStartRequestSchema.parse(requestInput);
      assertNoPersistenceFault(wrapper.workflowId);
      const request = procedureRefinementCreateRequestSchema.parse(wrapper.request);
      const current = statuses.get(wrapper.workflowId);
      const priorRequest = refinementRequests.get(wrapper.workflowId);
      if (priorRequest !== undefined) {
        if (!sameValue(priorRequest, request)) {
          throw new Error('Zero-baseline refinement request conflicts with durable evidence');
        }
        return project(wrapper.workflowId)!;
      }
      if (current === undefined || current.phase !== 'awaiting_refinement') {
        throw new Error('Exact semantic context is required before native refinement');
      }
      const latest = options.getLatestProcedureTree(current.storedBaseline!.tree.id);
      const identities = [
        wrapper.workflowId,
        current.createRequest.generationRequest.requestId,
        current.baseline!.generation.generationId,
        current.baselineReview!.reviewId,
        current.semanticRetrieval!.requestId,
        request.runId,
        request.dialogueRequestId,
        request.refinementRequestId,
      ];
      assertDistinctIdentities(identities);
      if (
        latest === null ||
        !sameValue(latest, current.storedBaseline) ||
        !sameValue(request.baseTree, current.storedBaseline) ||
        !sameValue(request.semanticContext, current.semanticContext) ||
        request.semanticContext.requestId !== current.semanticRetrieval!.requestId
      ) {
        throw new Error(
          'Native refinement request does not bind the exact latest grounded baseline',
        );
      }
      const occurredAt = now().toISOString();
      const event = procedureZeroBaselineNativeRefinementStartedEventSchema.parse({
        formatVersion: procedureZeroBaselineRefinementFormatVersion,
        workflowId: wrapper.workflowId,
        requestFingerprint: current.requestFingerprint,
        request,
        requestContentSha256: sha256(request),
        sideEffects: {
          procedureStored: true,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        occurredAt,
      });
      append(wrapper.workflowId, {
        id: `procedure-zero-baseline-workflow-refinement-started:${request.runId}`,
        eventType: 'procedure.zero-baseline.workflow.refinement-started',
        payload: event,
        createdAt: occurredAt,
      });
      refinementRequests.set(wrapper.workflowId, request);
      const refinement: ProcedureRefinementRunStatus = options.refinement.create(request);
      const next = statusAt(current.createRequest, 'refinement', occurredAt, {
        ...current,
        refinement,
      });
      statuses.set(wrapper.workflowId, next);
      return clone(next);
    },
    get: (workflowId) => {
      assertNoPersistenceFault(workflowId);
      return project(workflowId);
    },
  };
}
