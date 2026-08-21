import { createHash, randomUUID } from 'node:crypto';

import {
  authorityValidationReceiptSchema,
  authoritySignedContent,
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  canonicalizeProtocolJsonValue,
  decisionCompletionEventSchema,
  decisionConsumptionEventSchema,
  decisionLifecycleEventSchema,
  providerCallAuthorizationSchema,
  trainingUseAuthorizationSchema,
  trainingRunDecisionReceiptSchema,
  type AuthorityValidationReceipt,
  type BlenderExecutionDecisionReceipt,
  type BlenderHistoryTransitionDecisionReceipt,
  type DecisionCompletionEvent,
  type DecisionConsumptionEvent,
  type DecisionLifecycleEvent,
  type ProviderCallAuthorization,
  type TrainingRunDecisionReceipt,
  type TrainingUseAuthorization,
} from '@operatingline/protocol';
import { z } from 'zod';

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function deepFreezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const nested of Object.values(candidate)) freeze(nested);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export type AuthorityConsumptionErrorCode =
  | 'invalid_event_log'
  | 'validation_receipt_mismatch'
  | 'decision_mismatch'
  | 'decision_expired'
  | 'credential_reused'
  | 'operation_mismatch'
  | 'not_consumed'
  | 'already_completed'
  | 'completion_receipt_untrusted';

export class AuthorityConsumptionError extends Error {
  constructor(
    readonly code: AuthorityConsumptionErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AuthorityConsumptionError';
  }
}

export interface AppendOnlyAuthorityConsumptionStore {
  readAll(): readonly DecisionLifecycleEvent[];
  /** Must atomically enforce dual uniqueness of credentialId and singleUseKeySha256. */
  appendConsumptionIfUnused(
    event: Omit<DecisionConsumptionEvent, 'sequence'>,
  ): AuthorityConsumptionAppendResult;
  appendCompletionIfInFlight(
    event: Omit<DecisionCompletionEvent, 'sequence'>,
  ): AuthorityCompletionAppendResult;
}

export type AuthorityConsumptionAppendResult =
  | { readonly status: 'appended'; readonly event: DecisionConsumptionEvent }
  | { readonly status: 'credential_duplicate' }
  | { readonly status: 'single_use_key_duplicate' }
  | { readonly status: 'invalid' };

export type AuthorityCompletionAppendResult =
  | { readonly status: 'appended'; readonly event: DecisionCompletionEvent }
  | { readonly status: 'missing_consumption' }
  | { readonly status: 'already_completed' }
  | { readonly status: 'kind_conflict' }
  | { readonly status: 'operation_conflict' }
  | { readonly status: 'invalid' };

/** In-memory reference store. Production stores must preserve the same atomic append contract. */
export class InMemoryAuthorityConsumptionStore implements AppendOnlyAuthorityConsumptionStore {
  readonly #events: DecisionLifecycleEvent[];

  constructor(events: readonly DecisionLifecycleEvent[] = []) {
    this.#events = events.map((event) =>
      deepFreezeClone(decisionLifecycleEventSchema.parse(event)),
    );
  }

  readAll(): readonly DecisionLifecycleEvent[] {
    return Object.freeze(this.#events.map((event) => deepFreezeClone(event)));
  }

  appendConsumptionIfUnused(
    eventInput: Omit<DecisionConsumptionEvent, 'sequence'>,
  ): AuthorityConsumptionAppendResult {
    const parsed = decisionConsumptionEventSchema.safeParse({
      ...eventInput,
      sequence: this.#events.length,
    });
    if (!parsed.success) return { status: 'invalid' };
    const event = parsed.data;
    if (
      this.#events.some(
        (candidate) =>
          candidate.kind.endsWith('_consumed') && candidate.credentialId === event.credentialId,
      )
    ) {
      return { status: 'credential_duplicate' };
    }
    if (
      this.#events.some(
        (candidate) =>
          candidate.kind.endsWith('_consumed') &&
          (candidate as DecisionConsumptionEvent).singleUseKeySha256 === event.singleUseKeySha256,
      )
    )
      return { status: 'single_use_key_duplicate' };
    if (this.#events.some((candidate) => candidate.eventId === event.eventId)) {
      return { status: 'invalid' };
    }
    const immutableEvent = deepFreezeClone(event);
    this.#events.push(immutableEvent);
    return { status: 'appended', event: deepFreezeClone(immutableEvent) };
  }

  appendCompletionIfInFlight(
    eventInput: Omit<DecisionCompletionEvent, 'sequence'>,
  ): AuthorityCompletionAppendResult {
    const parsed = decisionCompletionEventSchema.safeParse({
      ...eventInput,
      sequence: this.#events.length,
    });
    if (!parsed.success) return { status: 'invalid' };
    const event = parsed.data;
    const matching = this.#events.filter(
      (candidate) => candidate.credentialId === event.credentialId,
    );
    const consumption = matching.find((candidate) => candidate.kind.endsWith('_consumed')) as
      DecisionConsumptionEvent | undefined;
    if (!consumption) return { status: 'missing_consumption' };
    if (consumption.operationId !== event.operationId) return { status: 'operation_conflict' };
    if (!completionKindMatches(consumption.kind, event.kind)) return { status: 'kind_conflict' };
    if (matching.some((candidate) => candidate.kind.endsWith('_completed'))) {
      return { status: 'already_completed' };
    }
    if (this.#events.some((candidate) => candidate.eventId === event.eventId)) {
      return { status: 'invalid' };
    }
    const immutableEvent = deepFreezeClone(event);
    this.#events.push(immutableEvent);
    return { status: 'appended', event: deepFreezeClone(immutableEvent) };
  }
}

interface ReconstructedState {
  readonly consumption: DecisionConsumptionEvent;
  readonly completion?: DecisionCompletionEvent;
}

export interface ConsumptionClaim {
  readonly status: 'started' | 'reconcile_in_flight' | 'completed';
  readonly consumption: DecisionConsumptionEvent;
  readonly completion?: DecisionCompletionEvent;
}

const bindingSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const bindingIdSchema = z.string().trim().min(1).max(256);

export const blenderExecutionBindingSchema = z.strictObject({
  acceptedContentSha256: bindingSha256Schema,
  acceptedContentKind: z.enum(['proposal', 'plan']),
  replayId: z.string().uuid(),
  adapterId: bindingIdSchema,
  instanceId: z.string().uuid(),
  blenderSessionId: bindingIdSchema,
  documentFingerprintSha256: bindingSha256Schema,
  actionCatalogVersion: bindingIdSchema,
  interactionCatalogVersion: bindingIdSchema,
});
export type BlenderExecutionBinding = z.infer<typeof blenderExecutionBindingSchema>;

export interface ProviderCallBinding {
  readonly provider: {
    readonly providerId: string;
    readonly descriptorVersion: string;
    readonly model: string;
  };
  readonly operation: ProviderCallAuthorization['operation'];
  readonly generationRequestSha256: string;
  readonly disclosedDataSha256: string;
  readonly estimatedCost?: {
    readonly currency: string;
    readonly minorUnits: number;
  };
}

export const providerCallBindingSchema = z.strictObject({
  provider: z.strictObject({
    providerId: z.string().trim().min(1).max(256),
    descriptorVersion: z.string().trim().min(1).max(256),
    model: z.string().trim().min(1).max(256),
  }),
  operation: z.enum([
    'planning_generation',
    'semantic_replan_generation',
    'procedure_authoring_generation',
    'procedure_refinement_generation',
  ]),
  generationRequestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  disclosedDataSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  estimatedCost: z
    .strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/u),
      minorUnits: z.number().int().min(0).max(1_000_000_000),
    })
    .optional(),
});

const blenderHistoryTransitionBindingCommonShape = {
  compoundId: z.string().uuid(),
  replayId: z.string().uuid(),
  adapterId: bindingIdSchema,
  instanceId: z.string().uuid(),
  blenderProcessIdentitySha256: bindingSha256Schema,
  blenderSessionUid: bindingIdSchema,
  documentFingerprintSha256: bindingSha256Schema,
  compoundContentSha256: bindingSha256Schema,
  historyLockTokenSha256: bindingSha256Schema,
  currentStateSha256: bindingSha256Schema,
  expectedHistoryHeadSha256: bindingSha256Schema,
  actionCatalogVersion: bindingIdSchema,
  interactionCatalogVersion: bindingIdSchema,
} as const;

export const blenderHistoryTransitionBindingSchema = z.union([
  z.strictObject({
    ...blenderHistoryTransitionBindingCommonShape,
    transition: z.literal('back'),
    expectedStatus: z.enum(['forward_applied_locked', 'reapplied_locked']),
    terminalObservationSha256: z.null(),
    nativeHistoryLossRecorded: z.literal(false),
  }),
  z.strictObject({
    ...blenderHistoryTransitionBindingCommonShape,
    transition: z.literal('redo'),
    expectedStatus: z.literal('restored_locked'),
    terminalObservationSha256: z.null(),
    nativeHistoryLossRecorded: z.literal(false),
  }),
  z.strictObject({
    ...blenderHistoryTransitionBindingCommonShape,
    transition: z.literal('unlock_final'),
    expectedStatus: z.enum(['forward_applied_locked', 'reapplied_locked']),
    terminalObservationSha256: bindingSha256Schema,
    nativeHistoryLossRecorded: z.literal(false),
  }),
  z.strictObject({
    ...blenderHistoryTransitionBindingCommonShape,
    transition: z.literal('abandon_baseline'),
    expectedStatus: z.literal('restored_locked'),
    terminalObservationSha256: bindingSha256Schema,
    nativeHistoryLossRecorded: z.literal(false),
  }),
  z.strictObject({
    ...blenderHistoryTransitionBindingCommonShape,
    transition: z.literal('abandon_baseline'),
    expectedStatus: z.literal('history_lost'),
    terminalObservationSha256: bindingSha256Schema,
    nativeHistoryLossRecorded: z.literal(true),
  }),
]);
export type BlenderHistoryTransitionBinding = z.infer<typeof blenderHistoryTransitionBindingSchema>;

export const trainingRunBindingSchema = z.strictObject({
  releasedManifestSha256: bindingSha256Schema,
  trainingExportSha256: bindingSha256Schema,
  codeSha256: bindingSha256Schema,
  configSha256: bindingSha256Schema,
  modelFamilySha256: bindingSha256Schema,
  runId: z.string().uuid(),
});
export type TrainingRunBinding = z.infer<typeof trainingRunBindingSchema>;

export interface AuthorityConsumptionOptions {
  readonly now?: () => Date;
  readonly maximumClockSkewMs?: number;
  /** Resolves only operator-issued local decisions from trusted local state. */
  readonly isTrustedLocalDecision?: (
    decision:
      | BlenderExecutionDecisionReceipt
      | BlenderHistoryTransitionDecisionReceipt
      | TrainingRunDecisionReceipt,
  ) => boolean;
  /** Resolves the lower durable launcher/provider/host receipt before completion is appended. */
  readonly resolveDurableCompletion?: (input: {
    readonly consumptionKind: DecisionConsumptionEvent['kind'];
    readonly credentialId: string;
    readonly operationId: string;
    readonly bindingSha256: string;
    readonly durableReceiptSha256: string;
  }) => boolean;
  /** Reads the trusted durable Blender lock/current-state binding for a new transition. */
  readonly resolveTrustedHistoryTransitionBinding?: (
    decision: BlenderHistoryTransitionDecisionReceipt,
  ) => BlenderHistoryTransitionBinding | null;
}

export interface LiveProviderAuthorityVerifier {
  verify(request: {
    record: unknown;
    sideEffect: 'provider_call';
    targetSha256: string;
    binding: ProviderCallBinding;
  }): AuthorityValidationReceipt;
}

export interface LiveTrainingAuthorityVerifier {
  verify(request: {
    record: unknown;
    sideEffect: 'training_export';
    targetSha256: string;
    binding: {
      releasedManifestSha256: string;
      purpose: string;
      modelFamily: string;
      scope: 'export_only' | 'export_and_run';
    };
  }): AuthorityValidationReceipt;
}

export class AuthorityConsumptionCoordinator {
  readonly #store: AppendOnlyAuthorityConsumptionStore;
  readonly #state = new Map<string, ReconstructedState>();
  readonly #stateBySingleUseKey = new Map<string, ReconstructedState>();
  readonly #reconstructedCredentialIds = new Set<string>();
  readonly #claimedThisProcess = new Set<string>();
  readonly #now: () => Date;
  readonly #maximumClockSkewMs: number;
  readonly #isTrustedLocalDecision:
    | ((
        decision:
          | BlenderExecutionDecisionReceipt
          | BlenderHistoryTransitionDecisionReceipt
          | TrainingRunDecisionReceipt,
      ) => boolean)
    | undefined;
  readonly #resolveDurableCompletion: AuthorityConsumptionOptions['resolveDurableCompletion'];
  readonly #resolveTrustedHistoryTransitionBinding: AuthorityConsumptionOptions['resolveTrustedHistoryTransitionBinding'];

  constructor(
    store: AppendOnlyAuthorityConsumptionStore,
    options: AuthorityConsumptionOptions = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#maximumClockSkewMs = options.maximumClockSkewMs ?? 5 * 60 * 1_000;
    this.#isTrustedLocalDecision = options.isTrustedLocalDecision;
    this.#resolveDurableCompletion = options.resolveDurableCompletion;
    this.#resolveTrustedHistoryTransitionBinding = options.resolveTrustedHistoryTransitionBinding;
    if (
      !Number.isSafeInteger(this.#maximumClockSkewMs) ||
      this.#maximumClockSkewMs < 0 ||
      this.#maximumClockSkewMs > 5 * 60 * 1_000
    ) {
      throw new AuthorityConsumptionError('invalid_event_log', 'Invalid clock skew');
    }
    this.#reconstruct(store.readAll());
  }

  consumeProviderAuthorization(input: {
    authorization: ProviderCallAuthorization;
    binding: ProviderCallBinding;
    liveVerifier: LiveProviderAuthorityVerifier;
    validationReceipt?: AuthorityValidationReceipt;
    operationId: string;
  }): ConsumptionClaim {
    const authorization = providerCallAuthorizationSchema.parse(input.authorization);
    const parsedBinding = providerCallBindingSchema.parse(input.binding);
    const binding: ProviderCallBinding =
      parsedBinding.estimatedCost === undefined
        ? {
            provider: parsedBinding.provider,
            operation: parsedBinding.operation,
            generationRequestSha256: parsedBinding.generationRequestSha256,
            disclosedDataSha256: parsedBinding.disclosedDataSha256,
          }
        : { ...parsedBinding, estimatedCost: parsedBinding.estimatedCost };
    const singleUseKeySha256 = sha256({
      kind: authorization.kind,
      generationRequestSha256: authorization.generationRequestSha256,
    });
    const bindingSha256 = sha256({
      authorityContentSha256: sha256(authoritySignedContent(authorization)),
      binding,
    });
    const reconstructed = this.#reconcileExisting(
      'provider_authorization_consumed',
      authorization.authorityId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
    if (reconstructed) return reconstructed;
    this.#validateProviderBinding(authorization, binding);
    if (!input.liveVerifier || typeof input.liveVerifier.verify !== 'function') {
      throw new AuthorityConsumptionError(
        'validation_receipt_mismatch',
        'Live authority verification is required',
      );
    }
    // This call is deliberately inside the synchronous claim path: revocation and time are
    // checked at the side-effect instant, not inferred from a prior receipt.
    const receipt = authorityValidationReceiptSchema.parse(
      input.liveVerifier.verify({
        record: authorization,
        sideEffect: 'provider_call',
        targetSha256: authorization.generationRequestSha256,
        binding,
      }),
    );
    if (input.validationReceipt && sha256(input.validationReceipt) !== sha256(receipt)) {
      throw new AuthorityConsumptionError('validation_receipt_mismatch');
    }
    if (
      receipt.authorityKind !== 'ProviderCallAuthorization' ||
      receipt.authorityId !== authorization.authorityId ||
      receipt.authorityContentSha256 !== sha256(authoritySignedContent(authorization)) ||
      receipt.sideEffect !== 'provider_call' ||
      receipt.targetSha256 !== authorization.generationRequestSha256
    ) {
      throw new AuthorityConsumptionError('validation_receipt_mismatch');
    }
    return this.#claim(
      'provider_authorization_consumed',
      authorization.authorityId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
  }

  consumeBlenderDecision(input: {
    decision: BlenderExecutionDecisionReceipt;
    operationId: string;
    binding: BlenderExecutionBinding;
  }): ConsumptionClaim {
    const decision = blenderExecutionDecisionReceiptSchema.parse(input.decision);
    const binding = blenderExecutionBindingSchema.parse(input.binding);
    const singleUseKeySha256 = sha256({ nonce: decision.nonce });
    const bindingSha256 = sha256({ decisionSha256: sha256(decision), binding });
    const reconstructed = this.#reconcileExisting(
      'blender_decision_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
    if (reconstructed) return reconstructed;
    if (this.#isTrustedLocalDecision?.(decision) !== true) {
      throw new AuthorityConsumptionError(
        'decision_mismatch',
        'Decision is not registered in trusted local state',
      );
    }
    this.#validateDecisionTime(decision.issuedAt, decision.expiresAt);
    const expected = binding;
    if (
      decision.acceptedContentSha256 !== expected.acceptedContentSha256 ||
      decision.acceptedContentKind !== expected.acceptedContentKind ||
      decision.replayId !== expected.replayId ||
      decision.target.adapterId !== expected.adapterId ||
      decision.target.instanceId !== expected.instanceId ||
      decision.blenderSessionId !== expected.blenderSessionId ||
      decision.documentFingerprintSha256 !== expected.documentFingerprintSha256 ||
      decision.actionCatalogVersion !== expected.actionCatalogVersion ||
      decision.interactionCatalogVersion !== expected.interactionCatalogVersion
    ) {
      throw new AuthorityConsumptionError('decision_mismatch');
    }
    return this.#claim(
      'blender_decision_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
  }

  consumeBlenderHistoryTransitionDecision(input: {
    decision: BlenderHistoryTransitionDecisionReceipt;
    operationId: string;
    binding: BlenderHistoryTransitionBinding;
  }): ConsumptionClaim {
    const decision = blenderHistoryTransitionDecisionReceiptSchema.parse(input.decision);
    const binding = blenderHistoryTransitionBindingSchema.parse(input.binding);
    const singleUseKeySha256 = sha256({ nonce: decision.nonce });
    const bindingSha256 = sha256({ decisionSha256: sha256(decision), binding });
    const reconstructed = this.#reconcileExisting(
      'blender_history_transition_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
    if (reconstructed) return reconstructed;
    const trustedBindingResult = blenderHistoryTransitionBindingSchema.safeParse(
      this.#resolveTrustedHistoryTransitionBinding?.(decision),
    );
    if (!trustedBindingResult.success || sha256(trustedBindingResult.data) !== sha256(binding)) {
      throw new AuthorityConsumptionError(
        'decision_mismatch',
        'Trusted current-state binding is required for a history transition',
      );
    }
    if (this.#isTrustedLocalDecision?.(decision) !== true) {
      throw new AuthorityConsumptionError(
        'decision_mismatch',
        'Decision is not registered in trusted local state',
      );
    }
    this.#validateDecisionTime(decision.issuedAt, decision.expiresAt);
    const expected = trustedBindingResult.data;
    if (
      decision.transition !== expected.transition ||
      decision.compoundId !== expected.compoundId ||
      decision.replayId !== expected.replayId ||
      decision.target.adapterId !== expected.adapterId ||
      decision.target.instanceId !== expected.instanceId ||
      decision.blenderProcessIdentitySha256 !== expected.blenderProcessIdentitySha256 ||
      decision.blenderSessionUid !== expected.blenderSessionUid ||
      decision.documentFingerprintSha256 !== expected.documentFingerprintSha256 ||
      decision.compoundContentSha256 !== expected.compoundContentSha256 ||
      decision.historyLockTokenSha256 !== expected.historyLockTokenSha256 ||
      decision.currentStateSha256 !== expected.currentStateSha256 ||
      decision.expectedHistoryHeadSha256 !== expected.expectedHistoryHeadSha256 ||
      decision.expectedStatus !== expected.expectedStatus ||
      decision.terminalObservationSha256 !== expected.terminalObservationSha256 ||
      decision.nativeHistoryLossRecorded !== expected.nativeHistoryLossRecorded ||
      decision.actionCatalogVersion !== expected.actionCatalogVersion ||
      decision.interactionCatalogVersion !== expected.interactionCatalogVersion
    ) {
      throw new AuthorityConsumptionError('decision_mismatch');
    }
    return this.#claim(
      'blender_history_transition_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
  }

  consumeTrainingDecision(input: {
    decision: TrainingRunDecisionReceipt;
    trainingUseAuthorization: TrainingUseAuthorization;
    liveVerifier: LiveTrainingAuthorityVerifier;
    operationId: string;
    binding: TrainingRunBinding;
  }): ConsumptionClaim {
    const decision = trainingRunDecisionReceiptSchema.parse(input.decision);
    const binding = trainingRunBindingSchema.parse(input.binding);
    const authorization = trainingUseAuthorizationSchema.parse(input.trainingUseAuthorization);
    const singleUseKeySha256 = sha256({ nonce: decision.nonce });
    const bindingSha256 = sha256({
      decisionSha256: sha256(decision),
      authorityContentSha256: sha256(authoritySignedContent(authorization)),
      binding,
    });
    const reconstructed = this.#reconcileExisting(
      'training_decision_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
    if (reconstructed) return reconstructed;
    if (this.#isTrustedLocalDecision?.(decision) !== true) {
      throw new AuthorityConsumptionError(
        'decision_mismatch',
        'Decision is not registered in trusted local state',
      );
    }
    this.#validateDecisionTime(decision.issuedAt, decision.expiresAt);
    const expected = binding;
    if (!input.liveVerifier || typeof input.liveVerifier.verify !== 'function') {
      throw new AuthorityConsumptionError(
        'validation_receipt_mismatch',
        'Live authority verification is required',
      );
    }
    const embeddedReceipt = decision.trainingUseValidationReceipt;
    const authorizationContentSha256 = sha256(authoritySignedContent(authorization));
    if (
      embeddedReceipt.authorityId !== authorization.authorityId ||
      embeddedReceipt.authorityContentSha256 !== authorizationContentSha256 ||
      embeddedReceipt.targetSha256 !== authorization.releasedManifestSha256 ||
      embeddedReceipt.sideEffect !== 'training_export'
    ) {
      throw new AuthorityConsumptionError('validation_receipt_mismatch');
    }
    if (
      authorization.scope !== 'export_and_run' ||
      decision.modelFamilySha256 !== sha256(authorization.modelFamily)
    ) {
      throw new AuthorityConsumptionError('decision_mismatch');
    }
    const liveReceipt = authorityValidationReceiptSchema.parse(
      input.liveVerifier.verify({
        record: authorization,
        sideEffect: 'training_export',
        targetSha256: authorization.releasedManifestSha256,
        binding: {
          releasedManifestSha256: authorization.releasedManifestSha256,
          purpose: authorization.purpose,
          modelFamily: authorization.modelFamily,
          scope: authorization.scope,
        },
      }),
    );
    if (
      liveReceipt.authorityKind !== 'TrainingUseAuthorization' ||
      liveReceipt.authorityId !== embeddedReceipt.authorityId ||
      liveReceipt.authorityContentSha256 !== embeddedReceipt.authorityContentSha256 ||
      liveReceipt.targetSha256 !== embeddedReceipt.targetSha256 ||
      liveReceipt.sideEffect !== embeddedReceipt.sideEffect
    ) {
      throw new AuthorityConsumptionError('validation_receipt_mismatch');
    }
    if (
      decision.releasedManifestSha256 !== expected.releasedManifestSha256 ||
      decision.trainingExportSha256 !== expected.trainingExportSha256 ||
      decision.codeSha256 !== expected.codeSha256 ||
      decision.configSha256 !== expected.configSha256 ||
      decision.modelFamilySha256 !== expected.modelFamilySha256 ||
      decision.runId !== expected.runId ||
      decision.trainingUseValidationReceipt.targetSha256 !== expected.releasedManifestSha256
    ) {
      throw new AuthorityConsumptionError('decision_mismatch');
    }
    return this.#claim(
      'training_decision_consumed',
      decision.decisionId,
      singleUseKeySha256,
      input.operationId,
      bindingSha256,
    );
  }

  complete(input: {
    credentialId: string;
    operationId: string;
    durableReceiptSha256: string;
  }): DecisionCompletionEvent {
    const state = this.#state.get(input.credentialId);
    if (!state) throw new AuthorityConsumptionError('not_consumed');
    if (state.consumption.operationId !== input.operationId) {
      throw new AuthorityConsumptionError('operation_mismatch');
    }
    if (state.completion) throw new AuthorityConsumptionError('already_completed');
    if (
      this.#resolveDurableCompletion?.({
        consumptionKind: state.consumption.kind,
        credentialId: input.credentialId,
        operationId: input.operationId,
        bindingSha256: state.consumption.bindingSha256,
        durableReceiptSha256: input.durableReceiptSha256,
      }) !== true
    ) {
      throw new AuthorityConsumptionError('completion_receipt_untrusted');
    }
    const completionKind = {
      provider_authorization_consumed: 'provider_call_completed',
      blender_decision_consumed: 'blender_execution_completed',
      blender_history_transition_consumed: 'blender_history_transition_completed',
      training_decision_consumed: 'training_run_completed',
    } as const;
    const eventInput: Omit<DecisionCompletionEvent, 'sequence'> = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      kind: completionKind[state.consumption.kind],
      credentialId: input.credentialId,
      operationId: input.operationId,
      durableReceiptSha256: input.durableReceiptSha256,
      completedAt: this.#safeNow().toISOString(),
    };
    const result = this.#store.appendCompletionIfInFlight(eventInput);
    if (result.status === 'missing_consumption')
      throw new AuthorityConsumptionError('not_consumed');
    if (result.status === 'already_completed') {
      throw new AuthorityConsumptionError('already_completed');
    }
    if (result.status === 'operation_conflict') {
      throw new AuthorityConsumptionError('operation_mismatch');
    }
    if (result.status === 'kind_conflict' || result.status === 'invalid') {
      throw new AuthorityConsumptionError('invalid_event_log');
    }
    const immutableEvent = deepFreezeClone(result.event);
    const completedState = { consumption: state.consumption, completion: immutableEvent };
    this.#state.set(input.credentialId, completedState);
    this.#stateBySingleUseKey.set(state.consumption.singleUseKeySha256, completedState);
    return deepFreezeClone(immutableEvent);
  }

  stateFor(credentialId: string): ConsumptionClaim | undefined {
    const state = this.#state.get(credentialId);
    if (!state) return undefined;
    return deepFreezeClone(
      state.completion
        ? {
            status: 'completed',
            consumption: state.consumption,
            completion: state.completion,
          }
        : {
            status: state.completion ? 'completed' : 'reconcile_in_flight',
            consumption: state.consumption,
          },
    );
  }

  #claim(
    kind: DecisionConsumptionEvent['kind'],
    credentialId: string,
    singleUseKeySha256: string,
    operationId: string,
    bindingSha256: string,
  ): ConsumptionClaim {
    const existing = this.#state.get(credentialId);
    const existingBySingleUseKey = this.#stateBySingleUseKey.get(singleUseKeySha256);
    if (existingBySingleUseKey && existingBySingleUseKey !== existing) {
      throw new AuthorityConsumptionError(
        'credential_reused',
        'Single-use nonce was already consumed',
      );
    }
    if (existing) {
      if (
        existing.consumption.operationId !== operationId ||
        existing.consumption.bindingSha256 !== bindingSha256
      ) {
        throw new AuthorityConsumptionError('credential_reused');
      }
      if (this.#claimedThisProcess.has(credentialId)) {
        throw new AuthorityConsumptionError('credential_reused');
      }
      if (!this.#reconstructedCredentialIds.has(credentialId)) {
        throw new AuthorityConsumptionError('credential_reused');
      }
      this.#claimedThisProcess.add(credentialId);
      return deepFreezeClone(
        existing.completion
          ? {
              status: 'completed',
              consumption: existing.consumption,
              completion: existing.completion,
            }
          : {
              status: existing.completion ? 'completed' : 'reconcile_in_flight',
              consumption: existing.consumption,
            },
      );
    }

    const eventInput: Omit<DecisionConsumptionEvent, 'sequence'> = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      kind,
      credentialId,
      singleUseKeySha256,
      operationId,
      bindingSha256,
      consumedAt: this.#safeNow().toISOString(),
    };
    const result = this.#store.appendConsumptionIfUnused(eventInput);
    if (result.status === 'invalid') {
      throw new AuthorityConsumptionError('invalid_event_log');
    }
    if (result.status !== 'appended') {
      throw new AuthorityConsumptionError('credential_reused');
    }
    const immutableEvent = deepFreezeClone(result.event);
    const state = { consumption: immutableEvent };
    this.#state.set(credentialId, state);
    this.#stateBySingleUseKey.set(singleUseKeySha256, state);
    this.#claimedThisProcess.add(credentialId);
    return deepFreezeClone({ status: 'started', consumption: immutableEvent });
  }

  #reconcileExisting(
    kind: DecisionConsumptionEvent['kind'],
    credentialId: string,
    singleUseKeySha256: string,
    operationId: string,
    bindingSha256: string,
  ): ConsumptionClaim | undefined {
    const existing = this.#state.get(credentialId);
    const existingBySingleUseKey = this.#stateBySingleUseKey.get(singleUseKeySha256);
    if (!existing && !existingBySingleUseKey) return undefined;
    if (
      !existing ||
      existingBySingleUseKey !== existing ||
      existing.consumption.kind !== kind ||
      existing.consumption.operationId !== operationId ||
      existing.consumption.bindingSha256 !== bindingSha256 ||
      this.#claimedThisProcess.has(credentialId) ||
      !this.#reconstructedCredentialIds.has(credentialId)
    ) {
      throw new AuthorityConsumptionError('credential_reused');
    }
    this.#claimedThisProcess.add(credentialId);
    return deepFreezeClone(
      existing.completion
        ? {
            status: 'completed',
            consumption: existing.consumption,
            completion: existing.completion,
          }
        : { status: 'reconcile_in_flight', consumption: existing.consumption },
    );
  }

  #validateProviderBinding(
    authorization: ProviderCallAuthorization,
    binding: ProviderCallBinding,
  ): void {
    const estimatedCost = binding.estimatedCost;
    if (
      binding.provider.providerId !== authorization.provider.providerId ||
      binding.provider.descriptorVersion !== authorization.provider.descriptorVersion ||
      binding.provider.model !== authorization.provider.model ||
      binding.operation !== authorization.operation ||
      binding.generationRequestSha256 !== authorization.generationRequestSha256 ||
      binding.disclosedDataSha256 !== authorization.disclosedDataSha256 ||
      (estimatedCost !== undefined &&
        (!/^[A-Z]{3}$/u.test(estimatedCost.currency) ||
          !Number.isSafeInteger(estimatedCost.minorUnits) ||
          estimatedCost.minorUnits < 0)) ||
      (authorization.costCeiling !== undefined &&
        (estimatedCost === undefined ||
          estimatedCost.currency !== authorization.costCeiling.currency ||
          estimatedCost.minorUnits > authorization.costCeiling.minorUnits))
    ) {
      throw new AuthorityConsumptionError('decision_mismatch', 'Provider call binding mismatch');
    }
  }

  #validateDecisionTime(issuedAt: string, expiresAt: string): void {
    const now = this.#safeNow().getTime();
    if (Date.parse(issuedAt) > now + this.#maximumClockSkewMs) {
      throw new AuthorityConsumptionError(
        'decision_mismatch',
        'Decision issuance is in the future',
      );
    }
    if (Date.parse(expiresAt) <= now) throw new AuthorityConsumptionError('decision_expired');
  }

  #safeNow(): Date {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AuthorityConsumptionError('decision_mismatch', 'Clock returned an invalid instant');
    }
    return now;
  }

  #reconstruct(eventsInput: readonly DecisionLifecycleEvent[]): void {
    const eventIds = new Set<string>();
    for (const [sequence, input] of eventsInput.entries()) {
      const event = deepFreezeClone(decisionLifecycleEventSchema.parse(input));
      if (event.sequence !== sequence || eventIds.has(event.eventId)) {
        throw new AuthorityConsumptionError('invalid_event_log');
      }
      eventIds.add(event.eventId);
      const prior = this.#state.get(event.credentialId);
      if (event.kind.endsWith('_consumed')) {
        const consumption = event as DecisionConsumptionEvent;
        if (prior || this.#stateBySingleUseKey.has(consumption.singleUseKeySha256)) {
          throw new AuthorityConsumptionError('invalid_event_log');
        }
        const state = { consumption };
        this.#state.set(event.credentialId, state);
        this.#stateBySingleUseKey.set(consumption.singleUseKeySha256, state);
        this.#reconstructedCredentialIds.add(event.credentialId);
      } else {
        const completion = event as DecisionCompletionEvent;
        if (
          !prior ||
          prior.completion ||
          prior.consumption.operationId !== completion.operationId ||
          !this.#completionMatches(prior.consumption.kind, completion.kind)
        ) {
          throw new AuthorityConsumptionError('invalid_event_log');
        }
        const state = {
          consumption: prior.consumption,
          completion,
        };
        this.#state.set(event.credentialId, state);
        this.#stateBySingleUseKey.set(prior.consumption.singleUseKeySha256, state);
      }
    }
  }

  #completionMatches(
    consumption: DecisionConsumptionEvent['kind'],
    completion: DecisionCompletionEvent['kind'],
  ): boolean {
    return completionKindMatches(consumption, completion);
  }
}

function completionKindMatches(
  consumption: DecisionConsumptionEvent['kind'],
  completion: DecisionCompletionEvent['kind'],
): boolean {
  return (
    (consumption === 'provider_authorization_consumed' &&
      completion === 'provider_call_completed') ||
    (consumption === 'blender_decision_consumed' && completion === 'blender_execution_completed') ||
    (consumption === 'blender_history_transition_consumed' &&
      completion === 'blender_history_transition_completed') ||
    (consumption === 'training_decision_consumed' && completion === 'training_run_completed')
  );
}
