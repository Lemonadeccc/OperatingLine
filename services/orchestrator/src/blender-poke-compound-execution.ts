import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionPokeCompoundCreateRequestSchema,
  companionPokeCompoundDeliverySchema,
  companionPokeCompoundRecoveryAckSchema,
  companionPokeCompoundRecoveryChallengeSchema,
  companionPokeCompoundResultSchema,
  companionPokeCompoundStatusSchema,
  computeCompanionPokeCompoundDeliveryContentSha256,
  procedureCompoundReplaySchema,
  verifyProcedureCompoundCurrentStateIntegrity,
  verifyProcedureCompoundReplayIntegrity,
  verifyProcedureCompoundRecipeIntegrity,
  type CompanionPokeCompoundCreateRequest,
  type CompanionPokeCompoundDelivery,
  type CompanionPokeCompoundRecoveryAck,
  type CompanionPokeCompoundRecoveryChallenge,
  type CompanionPokeCompoundResult,
  type CompanionPokeCompoundStatus,
  type ProcedureCompoundReplay,
  type ProcedureCompoundReplayEvidenceResolver,
} from '@operatingline/protocol';
import { z } from 'zod';

export const pokeCompoundExecutionEventTypes = [
  'blender.poke-compound.queued',
  'blender.poke-compound.dispatched',
  'blender.poke-compound.recovery-required',
  'blender.poke-compound.recovery-challenged',
  'blender.poke-compound.completed',
  'blender.poke-compound.quarantined',
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const storedPokeCompoundExecutionSchema = z.strictObject({
  request: companionPokeCompoundCreateRequestSchema,
  execution: companionPokeCompoundStatusSchema,
  delivery: companionPokeCompoundDeliverySchema.nullable(),
  dispatchSessionFingerprintSha256: sha256Schema.nullable(),
  completionSessionFingerprintSha256: sha256Schema.nullable(),
  documentAuthoritySha256: sha256Schema,
  recoveryChallenges: z.array(companionPokeCompoundRecoveryChallengeSchema).max(32),
  recoveryAcks: z.array(companionPokeCompoundRecoveryAckSchema).max(32),
});

type PokeCompoundDatabase = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;
type StoredPokeCompoundExecution = z.infer<typeof storedPokeCompoundExecutionSchema>;

export interface BlenderPokeCompoundExecutionCoordinatorOptions {
  readonly database: PokeCompoundDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly externalHistoryLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

export class BlenderPokeCompoundExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderPokeCompoundExecutionError';
  }
}

function initialEvidenceResolver(
  request: CompanionPokeCompoundCreateRequest,
): ProcedureCompoundReplayEvidenceResolver {
  return {
    decisionReceipt: request.decisionReceipt,
    trustedDecisionConsumptionEvent: request.trustedDecisionConsumptionEvent,
    resolveLeafEvidence: () => null,
  };
}

function terminalEvidenceResolver(
  request: CompanionPokeCompoundCreateRequest,
  result: CompanionPokeCompoundResult,
): ProcedureCompoundReplayEvidenceResolver {
  if (result.terminalEvidence === null) {
    throw new BlenderPokeCompoundExecutionError(
      'poke_compound_terminal_evidence_missing',
      409,
      'Poke compound terminal result lacks its three leaf evidence records',
    );
  }
  return {
    decisionReceipt: request.decisionReceipt,
    trustedDecisionConsumptionEvent: request.trustedDecisionConsumptionEvent,
    resolveLeafEvidence: (_leafId, order) => result.terminalEvidence!.leaves[order - 1]!,
  };
}

function sameRequest(
  left: CompanionPokeCompoundCreateRequest,
  right: CompanionPokeCompoundCreateRequest,
): boolean {
  return isDeepStrictEqual(left, right);
}

function sameResultIdentity(
  delivery: CompanionPokeCompoundDelivery,
  result: CompanionPokeCompoundResult,
): boolean {
  return (
    result.requestId === delivery.requestId &&
    result.deliveryId === delivery.deliveryId &&
    result.deliveryContentSha256 === delivery.deliveryContentSha256 &&
    isDeepStrictEqual(result.target, delivery.target) &&
    result.replayId === delivery.replayId &&
    result.compoundId === delivery.compoundId &&
    result.compoundContentSha256 === delivery.compoundContentSha256 &&
    result.historyLockTokenSha256 === delivery.historyLockTokenSha256
  );
}

function replayRootMatches(
  initial: ProcedureCompoundReplay,
  observed: ProcedureCompoundReplay,
): boolean {
  return (
    isDeepStrictEqual(initial.target, observed.target) &&
    initial.planContentSha256 === observed.planContentSha256 &&
    initial.actionCatalogVersion === observed.actionCatalogVersion &&
    initial.interactionCatalogVersion === observed.interactionCatalogVersion &&
    isDeepStrictEqual(initial.recipe, observed.recipe)
  );
}

function validateInitialRequest(request: CompanionPokeCompoundCreateRequest): void {
  const replay = request.replay;
  const expectedStartStatus = replay.recipe.expectedStartStatus;
  if (
    replay.target.adapterId !== 'blender' ||
    replay.currentState.status !== expectedStartStatus ||
    replay.leafProgress.some(
      (progress) => progress.intentSha256 !== null || progress.receiptSha256 !== null,
    ) ||
    !verifyProcedureCompoundRecipeIntegrity(replay.recipe) ||
    !verifyProcedureCompoundCurrentStateIntegrity(replay.currentState) ||
    !verifyProcedureCompoundReplayIntegrity(replay, initialEvidenceResolver(request))
  ) {
    throw new BlenderPokeCompoundExecutionError(
      'poke_compound_initial_replay_invalid',
      409,
      'Poke compound delivery requires an exact untouched recipe start and consumed decision',
    );
  }
}

function validateTerminalResult(
  request: CompanionPokeCompoundCreateRequest,
  result: CompanionPokeCompoundResult,
): ProcedureCompoundReplay {
  if (result.status !== 'succeeded' || result.replay === null) {
    throw new BlenderPokeCompoundExecutionError(
      'poke_compound_terminal_result_invalid',
      409,
      'Poke compound terminal validation requires a succeeded replay',
    );
  }
  const replay = procedureCompoundReplaySchema.parse(result.replay);
  if (
    !replayRootMatches(request.replay, replay) ||
    replay.currentState.status !== replay.recipe.expectedTerminalStatus ||
    replay.currentState.historyLock !== 'held' ||
    replay.leafProgress.some(
      (progress) => progress.intentSha256 === null || progress.receiptSha256 === null,
    ) ||
    !verifyProcedureCompoundReplayIntegrity(replay, terminalEvidenceResolver(request, result))
  ) {
    throw new BlenderPokeCompoundExecutionError(
      'poke_compound_terminal_proof_invalid',
      409,
      'Poke compound result lacks the exact recipe, three-leaf evidence, and locked terminal state',
    );
  }
  return replay;
}

function validateObservedRecoveryState(
  request: CompanionPokeCompoundCreateRequest,
  observed: CompanionPokeCompoundResult['observedCurrentState'],
): NonNullable<CompanionPokeCompoundResult['observedCurrentState']> {
  if (
    observed === null ||
    !verifyProcedureCompoundCurrentStateIntegrity(observed) ||
    observed.compoundId !== request.replay.recipe.compoundId ||
    observed.replayId !== request.replay.recipe.replayId ||
    observed.compoundContentSha256 !== request.replay.recipe.compoundContentSha256 ||
    observed.historyLockTokenSha256 !== request.replay.recipe.historyLockTokenSha256 ||
    !['recovery_required', 'history_lost', 'history_conflict'].includes(observed.status)
  ) {
    throw new BlenderPokeCompoundExecutionError(
      'poke_compound_recovery_state_invalid',
      409,
      'Poke compound recovery state does not match the immutable recipe and lock',
    );
  }
  return observed;
}

function statusFrom(
  stored: Pick<StoredPokeCompoundExecution, 'request' | 'delivery' | 'execution'>,
  updates: Partial<CompanionPokeCompoundStatus>,
): CompanionPokeCompoundStatus {
  const replay = updates.currentState === undefined ? stored.request.replay : null;
  return companionPokeCompoundStatusSchema.parse({
    ...stored.execution,
    ...updates,
    currentState: updates.currentState ?? replay!.currentState,
    deliveryId: updates.deliveryId ?? stored.delivery?.deliveryId ?? stored.execution.deliveryId,
    deliveryContentSha256:
      updates.deliveryContentSha256 ??
      stored.delivery?.deliveryContentSha256 ??
      stored.execution.deliveryContentSha256,
  });
}

export function createBlenderPokeCompoundExecutionCoordinator(
  options: BlenderPokeCompoundExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredPokeCompoundExecution>();

  const append = (
    eventType: (typeof pokeCompoundExecutionEventTypes)[number],
    input: StoredPokeCompoundExecution,
  ): CompanionPokeCompoundStatus => {
    const stored = storedPokeCompoundExecutionSchema.parse(input);
    options.database.appendEvent({
      id: `blender-poke-compound:${stored.execution.requestId}:${stored.execution.status}:${stored.execution.updatedAt}`,
      eventType,
      payload: stored,
      createdAt: stored.execution.updatedAt,
    });
    executions.set(stored.execution.requestId, stored);
    return stored.execution;
  };

  for (const event of options.database.listExecutionEventsByTypes(
    pokeCompoundExecutionEventTypes,
  )) {
    const stored = storedPokeCompoundExecutionSchema.parse(event.payload);
    executions.set(stored.execution.requestId, stored);
  }

  for (const stored of [...executions.values()]) {
    if (stored.execution.status !== 'dispatched') continue;
    const detectedAt = now();
    append('blender.poke-compound.recovery-required', {
      ...stored,
      execution: statusFrom(stored, {
        status: 'recovery_required',
        updatedAt: detectedAt,
      }),
    });
  }

  const get = (requestId: string): CompanionPokeCompoundStatus | null =>
    executions.get(requestId)?.execution ?? null;

  const listTargetLockOwners = () =>
    [...executions.values()]
      .filter(({ execution }) =>
        ['queued', 'dispatched', 'recovery_required', 'quarantined'].includes(execution.status),
      )
      .map(({ execution }) => ({
        adapterId: execution.target.adapterId,
        instanceId: execution.target.instanceId,
        requestId: execution.requestId,
        compoundId: execution.compoundId,
        status: execution.status,
      }));

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    listTargetLockOwners().some(
      (owner) => owner.adapterId === adapterId && owner.instanceId === instanceId,
    );

  const queue = (
    input: CompanionPokeCompoundCreateRequest,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): CompanionPokeCompoundStatus => {
    const request = companionPokeCompoundCreateRequestSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    validateInitialRequest(request);
    const existing = executions.get(request.requestId);
    if (existing !== undefined) {
      if (sameRequest(existing.request, request)) return existing.execution;
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_request_conflict',
        409,
        'Poke compound requestId is already bound to different immutable content',
      );
    }
    const owner = options.externalHistoryLockOwner?.('blender', request.replay.target.instanceId);
    if (owner !== undefined && owner !== null && owner !== request.replay.recipe.compoundId) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_history_locked',
        409,
        `Native history owner ${owner} owns the target instance`,
      );
    }
    const conflicting = listTargetLockOwners().find(
      (candidate) =>
        candidate.adapterId === request.replay.target.adapterId &&
        candidate.instanceId === request.replay.target.instanceId,
    );
    if (conflicting !== undefined) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_in_progress',
        409,
        `Poke compound ${conflicting.compoundId} still owns transport for the target`,
      );
    }
    const requestedAt = now();
    const execution = companionPokeCompoundStatusSchema.parse({
      formatVersion: request.formatVersion,
      requestId: request.requestId,
      target: request.replay.target,
      replayId: request.replay.recipe.replayId,
      compoundId: request.replay.recipe.compoundId,
      status: 'queued',
      deliveryId: null,
      deliveryContentSha256: null,
      requestedAt,
      dispatchedAt: null,
      result: null,
      currentState: request.replay.currentState,
      updatedAt: requestedAt,
    });
    return append('blender.poke-compound.queued', {
      request,
      execution,
      delivery: null,
      dispatchSessionFingerprintSha256: fingerprint,
      completionSessionFingerprintSha256: null,
      documentAuthoritySha256: documentAuthority,
      recoveryChallenges: [],
      recoveryAcks: [],
    });
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): CompanionPokeCompoundDelivery | null => {
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const pending = [...executions.values()]
      .filter(
        ({ execution }) =>
          execution.status === 'queued' &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId,
      )
      .sort((left, right) =>
        left.execution.requestedAt.localeCompare(right.execution.requestedAt),
      )[0];
    if (pending === undefined) return null;
    if (pending.documentAuthoritySha256 !== documentAuthority) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_document_authority_changed',
        409,
        'Poke compound document authority changed before delivery',
      );
    }
    const dispatchedAt = now();
    const content = {
      formatVersion: pending.request.formatVersion,
      requestId: pending.request.requestId,
      deliveryId: createId(),
      target: {
        adapterId: 'blender' as const,
        instanceId: pending.request.replay.target.instanceId,
      },
      replayId: pending.request.replay.recipe.replayId,
      compoundId: pending.request.replay.recipe.compoundId,
      compoundContentSha256: pending.request.replay.recipe.compoundContentSha256,
      historyLockTokenSha256: pending.request.replay.recipe.historyLockTokenSha256,
      replay: pending.request.replay,
      decisionReceipt: pending.request.decisionReceipt,
      trustedDecisionConsumptionEvent: pending.request.trustedDecisionConsumptionEvent,
      requestedAt: pending.execution.requestedAt,
      dispatchedAt,
    };
    const delivery = companionPokeCompoundDeliverySchema.parse({
      ...content,
      deliveryContentSha256: computeCompanionPokeCompoundDeliveryContentSha256(content),
    });
    append('blender.poke-compound.dispatched', {
      ...pending,
      delivery,
      dispatchSessionFingerprintSha256: fingerprint,
      execution: statusFrom(
        { ...pending, delivery },
        {
          status: 'dispatched',
          deliveryId: delivery.deliveryId,
          deliveryContentSha256: delivery.deliveryContentSha256,
          dispatchedAt,
          updatedAt: dispatchedAt,
        },
      ),
    });
    return delivery;
  };

  const complete = (
    input: CompanionPokeCompoundResult,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): 'accepted' | 'duplicate' => {
    const result = companionPokeCompoundResultSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const stored = executions.get(result.requestId);
    if (stored === undefined || stored.delivery === null) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_not_found',
        404,
        'Poke compound delivery was not found',
      );
    }
    if (!sameResultIdentity(stored.delivery, result)) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_result_identity_mismatch',
        409,
        'Poke compound result changed its accepted delivery identity',
      );
    }
    if (['succeeded', 'rejected', 'quarantined'].includes(stored.execution.status)) {
      if (isDeepStrictEqual(stored.execution.result, result)) return 'duplicate';
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_result_conflict',
        409,
        'Poke compound already has a different terminal result',
      );
    }
    if (stored.execution.status !== 'dispatched') {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_required',
        409,
        'Poke compound delivery outcome is indeterminate and requires replacement-lease recovery',
      );
    }
    if (
      stored.dispatchSessionFingerprintSha256 !== fingerprint ||
      stored.documentAuthoritySha256 !== documentAuthority
    ) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_result_authority_mismatch',
        409,
        'Poke compound result does not belong to its dispatch lease and document',
      );
    }
    if (Date.parse(result.occurredAt) < Date.parse(stored.delivery.dispatchedAt)) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_result_time_invalid',
        409,
        'Poke compound result predates its delivery',
      );
    }
    let currentState = stored.request.replay.currentState;
    let status: CompanionPokeCompoundStatus['status'] = result.status;
    let eventType: (typeof pokeCompoundExecutionEventTypes)[number] =
      'blender.poke-compound.completed';
    if (result.status === 'succeeded') {
      currentState = validateTerminalResult(stored.request, result).currentState;
    } else if (result.status === 'recovery_required') {
      currentState = validateObservedRecoveryState(stored.request, result.observedCurrentState);
      status = 'recovery_required';
      eventType = 'blender.poke-compound.recovery-required';
    }
    const updatedAt = result.occurredAt;
    append(eventType, {
      ...stored,
      completionSessionFingerprintSha256:
        result.status === 'recovery_required' ? null : fingerprint,
      execution: statusFrom(stored, {
        status,
        result,
        currentState,
        updatedAt,
      }),
    });
    return 'accepted';
  };

  const pollRecovery = (
    adapterId: 'blender',
    instanceId: string,
    replacementSessionFingerprintSha256: string,
    replacementDocumentAuthoritySha256: string,
  ): CompanionPokeCompoundRecoveryChallenge | null => {
    const fingerprint = sha256Schema.parse(replacementSessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(replacementDocumentAuthoritySha256);
    const delivered = [...executions.values()].find(
      ({ execution }) =>
        execution.status === 'dispatched' &&
        execution.target.adapterId === adapterId &&
        execution.target.instanceId === instanceId,
    );
    if (
      delivered !== undefined &&
      (delivered.dispatchSessionFingerprintSha256 !== fingerprint ||
        delivered.documentAuthoritySha256 !== documentAuthority)
    ) {
      const detectedAt = now();
      append('blender.poke-compound.recovery-required', {
        ...delivered,
        execution: statusFrom(delivered, {
          status: 'recovery_required',
          updatedAt: detectedAt,
        }),
      });
    }
    const stored = [...executions.values()].find(
      ({ execution }) =>
        execution.status === 'recovery_required' &&
        execution.target.adapterId === adapterId &&
        execution.target.instanceId === instanceId,
    );
    if (stored === undefined || stored.delivery === null) return null;
    const previous = stored.recoveryChallenges.at(-1);
    if (
      previous !== undefined &&
      previous.replacementSessionFingerprintSha256 === fingerprint &&
      previous.replacementDocumentAuthoritySha256 === documentAuthority &&
      !stored.recoveryAcks.some((ack) => ack.recoveryId === previous.recoveryId)
    ) {
      return previous;
    }
    const challenge = companionPokeCompoundRecoveryChallengeSchema.parse({
      formatVersion: stored.request.formatVersion,
      recoveryId: createId(),
      originalDelivery: stored.delivery,
      replacementSessionFingerprintSha256: fingerprint,
      replacementDocumentAuthoritySha256: documentAuthority,
      requestedAt: now(),
    });
    append('blender.poke-compound.recovery-challenged', {
      ...stored,
      recoveryChallenges: [...stored.recoveryChallenges, challenge].slice(-32),
      recoveryAcks: stored.recoveryAcks.filter((ack) =>
        [...stored.recoveryChallenges, challenge]
          .slice(-32)
          .some((candidate) => candidate.recoveryId === ack.recoveryId),
      ),
      execution: statusFrom(stored, { updatedAt: challenge.requestedAt }),
    });
    return challenge;
  };

  const acknowledgeRecovery = (
    input: CompanionPokeCompoundRecoveryAck,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): 'accepted' | 'duplicate' => {
    const ack = companionPokeCompoundRecoveryAckSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const requestId = ack.challenge.originalDelivery.requestId;
    const stored = executions.get(requestId);
    if (stored === undefined || stored.delivery === null) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_not_found',
        404,
        'Poke compound recovery delivery was not found',
      );
    }
    const challenge = stored.recoveryChallenges.find(
      (candidate) => candidate.recoveryId === ack.recoveryId,
    );
    if (
      challenge === undefined ||
      !isDeepStrictEqual(challenge, ack.challenge) ||
      challenge.replacementSessionFingerprintSha256 !== fingerprint ||
      challenge.replacementDocumentAuthoritySha256 !== documentAuthority
    ) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_authority_mismatch',
        409,
        'Poke compound recovery acknowledgement changed its replacement authority',
      );
    }
    const previousAck = stored.recoveryAcks.find(
      (candidate) => candidate.recoveryId === ack.recoveryId,
    );
    if (previousAck !== undefined) {
      if (isDeepStrictEqual(previousAck, ack)) return 'duplicate';
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_conflict',
        409,
        'Poke compound recovery challenge already has a different acknowledgement',
      );
    }
    if (stored.execution.status !== 'recovery_required') {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_not_required',
        409,
        'Poke compound no longer requires recovery',
      );
    }
    if (Date.parse(ack.occurredAt) < Date.parse(challenge.requestedAt)) {
      throw new BlenderPokeCompoundExecutionError(
        'poke_compound_recovery_time_invalid',
        409,
        'Poke compound recovery acknowledgement predates its challenge',
      );
    }
    let result: CompanionPokeCompoundResult | null = null;
    let currentState: typeof stored.execution.currentState;
    let status: CompanionPokeCompoundStatus['status'];
    let eventType: (typeof pokeCompoundExecutionEventTypes)[number];
    if (ack.outcome === 'terminal_result') {
      result = ack.terminalResult!;
      if (!sameResultIdentity(stored.delivery, result)) {
        throw new BlenderPokeCompoundExecutionError(
          'poke_compound_recovery_result_identity_mismatch',
          409,
          'Recovered Poke compound terminal result changed its original delivery identity',
        );
      }
      if (
        Date.parse(result.occurredAt) < Date.parse(stored.delivery.dispatchedAt) ||
        Date.parse(result.occurredAt) > Date.parse(ack.occurredAt)
      ) {
        throw new BlenderPokeCompoundExecutionError(
          'poke_compound_recovery_result_time_invalid',
          409,
          'Recovered Poke compound terminal result has an impossible delivery chronology',
        );
      }
      currentState = validateTerminalResult(stored.request, result).currentState;
      status = 'succeeded';
      eventType = 'blender.poke-compound.completed';
    } else {
      currentState = validateObservedRecoveryState(stored.request, ack.observedCurrentState);
      if (currentState.status !== ack.outcome) {
        throw new BlenderPokeCompoundExecutionError(
          'poke_compound_recovery_outcome_mismatch',
          409,
          'Recovered Poke compound state does not match its declared quarantine outcome',
        );
      }
      status = 'quarantined';
      eventType = 'blender.poke-compound.quarantined';
    }
    const execution = statusFrom(stored, {
      status,
      result,
      currentState,
      updatedAt: ack.occurredAt,
    });
    append(eventType, {
      ...stored,
      completionSessionFingerprintSha256: fingerprint,
      recoveryAcks: [...stored.recoveryAcks, ack].slice(-32),
      execution,
    });
    return 'accepted';
  };

  return {
    get,
    queue,
    poll,
    complete,
    pollRecovery,
    acknowledgeRecovery,
    ownsTarget,
    listTargetLockOwners,
  };
}

export type BlenderPokeCompoundExecutionCoordinator = ReturnType<
  typeof createBlenderPokeCompoundExecutionCoordinator
>;
