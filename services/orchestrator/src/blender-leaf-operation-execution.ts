import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionLeafOperationCreateRequestSchema,
  companionLeafOperationDeliverySchema,
  companionLeafOperationRecoveryAckSchema,
  companionLeafOperationRecoveryAuthorityProofSchema,
  companionLeafOperationRecoveryChallengeSchema,
  companionLeafOperationResultSchema,
  companionLeafOperationStatusSchema,
  type CompanionLeafOperationCreateRequest,
  type CompanionLeafOperationDelivery,
  type CompanionLeafOperationRecoveryAck,
  type CompanionLeafOperationRecoveryAuthorityProof,
  type CompanionLeafOperationRecoveryChallenge,
  type CompanionLeafOperationResult,
  type CompanionLeafOperationStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

const leafOperationEventTypes = [
  'blender.leaf-operation.queued',
  'blender.leaf-operation.dispatched',
  'blender.leaf-operation.pre-dispatch-authority-expired',
  'blender.leaf-operation.completed',
  'blender.leaf-operation.recovery-required',
  'blender.leaf-operation.recovery-challenged',
  'blender.leaf-operation.recovery-acknowledged',
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const storedLeafOperationEventSchema = z
  .strictObject({
    execution: companionLeafOperationStatusSchema,
    sessionFingerprintSha256: sha256Schema,
    dispatchSessionId: z.uuid().nullable().default(null),
    completionSessionFingerprintSha256: sha256Schema.optional(),
    documentAuthoritySha256: sha256Schema,
    recoveryChallenges: z.array(companionLeafOperationRecoveryChallengeSchema).max(32).default([]),
    recoveryAcks: z.array(companionLeafOperationRecoveryAckSchema).max(32).default([]),
  })
  .superRefine((stored, context) => {
    const terminal =
      stored.execution.status === 'succeeded' ||
      stored.execution.status === 'failed' ||
      stored.execution.status === 'rejected';
    if (terminal !== (stored.completionSessionFingerprintSha256 !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['completionSessionFingerprintSha256'],
        message: 'Only a terminal leaf operation records its authenticated completion lease',
      });
    }
    const challengeIds = stored.recoveryChallenges.map((challenge) => challenge.recoveryId);
    const ackIds = stored.recoveryAcks.map((ack) => ack.recoveryId);
    if (
      new Set(challengeIds).size !== challengeIds.length ||
      new Set(ackIds).size !== ackIds.length ||
      stored.recoveryAcks.some(
        (ack) =>
          !stored.recoveryChallenges.some(
            (challenge) =>
              challenge.recoveryId === ack.recoveryId &&
              isDeepStrictEqual(challenge, ack.challenge),
          ),
      ) ||
      ((stored.recoveryChallenges.length > 0 || stored.recoveryAcks.length > 0) &&
        stored.execution.status !== 'recovery_required' &&
        stored.execution.status !== 'failed' &&
        stored.execution.status !== 'succeeded')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryChallenges'],
        message: 'Stored recovery challenge and acknowledgement ledger is inconsistent',
      });
    }
  });

type LeafOperationDatabase = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;
type StoredLeafOperation = z.infer<typeof storedLeafOperationEventSchema>;
type StoredLeafOperationInput = z.input<typeof storedLeafOperationEventSchema>;

function recoveryLedgerWithChallenge(
  stored: StoredLeafOperation,
  challenge: CompanionLeafOperationRecoveryChallenge,
) {
  const recoveryChallenges = [...stored.recoveryChallenges, challenge].slice(-32);
  const retainedIds = new Set(recoveryChallenges.map((candidate) => candidate.recoveryId));
  return {
    recoveryChallenges,
    recoveryAcks: stored.recoveryAcks.filter((ack) => retainedIds.has(ack.recoveryId)).slice(-32),
  };
}

function retiresDocumentIncarnation(stored: StoredLeafOperation): boolean {
  return stored.recoveryAcks.some((ack) => ack.evidence.kind === 'document_incarnation_retired');
}

export class BlenderLeafOperationExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderLeafOperationExecutionError';
  }
}

export function continuesAuthorizedLeafOperationCheckpoint(
  authorizedCheckpointId: string,
  checkpointId: string | null | undefined,
  previousCheckpointId: string | null | undefined,
  lineageCheckpointIds?: readonly string[],
  operationCount?: number,
): boolean {
  if (lineageCheckpointIds !== undefined) {
    if (
      operationCount === undefined ||
      !Number.isSafeInteger(operationCount) ||
      operationCount < 1 ||
      checkpointId === undefined ||
      checkpointId === null ||
      previousCheckpointId === undefined ||
      previousCheckpointId === null ||
      new Set(lineageCheckpointIds).size !== lineageCheckpointIds.length
    ) {
      return false;
    }
    const authorizedIndex = lineageCheckpointIds.indexOf(authorizedCheckpointId);
    const authorizedSuffix = authorizedIndex < 0 ? [] : lineageCheckpointIds.slice(authorizedIndex);
    return (
      authorizedSuffix.length === operationCount + 1 &&
      authorizedSuffix[0] === authorizedCheckpointId &&
      authorizedSuffix.at(-1) === checkpointId &&
      authorizedSuffix.at(-2) === previousCheckpointId &&
      checkpointId !== authorizedCheckpointId &&
      checkpointId !== previousCheckpointId
    );
  }
  // Legacy companions committed one native checkpoint for the whole leaf. Keep
  // accepting that direct edge even when the server knows the operation count;
  // a supplied lineage opts the report into the stricter per-operation proof.
  return (
    previousCheckpointId === authorizedCheckpointId &&
    checkpointId !== undefined &&
    checkpointId !== null &&
    checkpointId !== authorizedCheckpointId &&
    checkpointId !== previousCheckpointId
  );
}

export interface BlenderLeafOperationExecutionCoordinatorOptions {
  readonly database: LeafOperationDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly externalHistoryLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

function sameCreateRequest(
  execution: CompanionLeafOperationStatus,
  request: CompanionLeafOperationCreateRequest,
): boolean {
  return (
    execution.formatVersion === request.formatVersion &&
    execution.requestId === request.requestId &&
    execution.replayId === request.replayId &&
    isDeepStrictEqual(execution.expectedState, request.expectedState)
  );
}

function sameDeliveryIdentity(
  execution: CompanionLeafOperationStatus,
  result: CompanionLeafOperationResult,
): boolean {
  return (
    execution.formatVersion === result.formatVersion &&
    execution.requestId === result.requestId &&
    execution.replayId === result.replayId &&
    execution.deliveryId === result.deliveryId &&
    isDeepStrictEqual(execution.target, result.target) &&
    execution.proposalId === result.proposalId &&
    isDeepStrictEqual(execution.plan, result.plan) &&
    execution.planContentSha256 === result.planContentSha256 &&
    execution.executionId === result.executionId &&
    execution.leafId === result.leafId &&
    execution.stepId === result.stepId &&
    execution.actionName === result.actionName &&
    execution.recipeId === result.recipeId &&
    execution.catalogVersion === result.catalogVersion &&
    execution.interactionCatalogContentSha256 === result.interactionCatalogContentSha256 &&
    execution.materializationContentSha256 === result.materializationContentSha256 &&
    execution.mcpTrackContentSha256 === result.mcpTrackContentSha256 &&
    isDeepStrictEqual(execution.expectedState, result.expectedState) &&
    isDeepStrictEqual(execution.operationIds, result.operationIds) &&
    execution.operationOrdinal === result.operationOrdinal &&
    execution.sourceOperationId === result.sourceOperationId &&
    isDeepStrictEqual(execution.operationParameters, result.operationParameters) &&
    execution.operationBindingSha256 === result.operationBindingSha256 &&
    execution.requestedAt === result.requestedAt &&
    execution.dispatchedAt === result.dispatchedAt
  );
}

function deliveryFromExecution(
  execution: CompanionLeafOperationStatus,
): CompanionLeafOperationDelivery {
  const delivery: Record<string, unknown> = { ...execution };
  delete delivery.status;
  delete delivery.result;
  delete delivery.preDispatchAuthorityExpirationEvidence;
  delete delivery.recoveryEvidence;
  delete delivery.updatedAt;
  return companionLeafOperationDeliverySchema.parse(delivery);
}

function sameImmutableExecution(
  left: CompanionLeafOperationStatus,
  right: CompanionLeafOperationStatus,
): boolean {
  return (
    left.formatVersion === right.formatVersion &&
    left.requestId === right.requestId &&
    left.replayId === right.replayId &&
    isDeepStrictEqual(left.target, right.target) &&
    left.proposalId === right.proposalId &&
    isDeepStrictEqual(left.plan, right.plan) &&
    left.planContentSha256 === right.planContentSha256 &&
    left.executionId === right.executionId &&
    left.leafId === right.leafId &&
    left.stepId === right.stepId &&
    left.actionName === right.actionName &&
    left.recipeId === right.recipeId &&
    left.catalogVersion === right.catalogVersion &&
    left.interactionCatalogContentSha256 === right.interactionCatalogContentSha256 &&
    left.materializationContentSha256 === right.materializationContentSha256 &&
    left.mcpTrackContentSha256 === right.mcpTrackContentSha256 &&
    isDeepStrictEqual(left.expectedState, right.expectedState) &&
    isDeepStrictEqual(left.operationIds, right.operationIds) &&
    left.operationOrdinal === right.operationOrdinal &&
    left.sourceOperationId === right.sourceOperationId &&
    isDeepStrictEqual(left.operationParameters, right.operationParameters) &&
    left.operationBindingSha256 === right.operationBindingSha256 &&
    left.requestedAt === right.requestedAt
  );
}

function assertStoredTransition(
  previous: StoredLeafOperation | undefined,
  next: StoredLeafOperation,
): void {
  const { execution } = next;
  if (previous === undefined) {
    if (execution.status !== 'queued') {
      throw new Error(`Leaf operation ${execution.requestId} is missing its queued event`);
    }
    return;
  }
  if (
    !sameImmutableExecution(previous.execution, execution) ||
    previous.documentAuthoritySha256 !== next.documentAuthoritySha256 ||
    (previous.dispatchSessionId !== next.dispatchSessionId &&
      `${previous.execution.status}->${execution.status}` !== 'queued->dispatched') ||
    (previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 &&
      `${previous.execution.status}->${execution.status}` !== 'queued->dispatched')
  ) {
    throw new Error(`Leaf operation ${execution.requestId} changed immutable authority`);
  }
  const challengesUnchanged = isDeepStrictEqual(
    previous.recoveryChallenges,
    next.recoveryChallenges,
  );
  const challengeAppended =
    previous.recoveryChallenges.length < 32 &&
    next.recoveryChallenges.length === previous.recoveryChallenges.length + 1 &&
    previous.recoveryChallenges.every((challenge, index) =>
      isDeepStrictEqual(challenge, next.recoveryChallenges[index]),
    );
  const challengeWindowAdvanced =
    previous.recoveryChallenges.length === 32 &&
    next.recoveryChallenges.length === 32 &&
    previous.recoveryChallenges
      .slice(1)
      .every((challenge, index) => isDeepStrictEqual(challenge, next.recoveryChallenges[index]));
  const retainedChallengeIds = new Set(
    next.recoveryChallenges.map((challenge) => challenge.recoveryId),
  );
  const retainedPreviousAcks = previous.recoveryAcks.filter((ack) =>
    retainedChallengeIds.has(ack.recoveryId),
  );
  const acknowledgementsValid =
    (next.recoveryAcks.length === retainedPreviousAcks.length ||
      next.recoveryAcks.length === retainedPreviousAcks.length + 1) &&
    retainedPreviousAcks.every((ack, index) => isDeepStrictEqual(ack, next.recoveryAcks[index]));
  if (
    (!challengesUnchanged && !challengeAppended && !challengeWindowAdvanced) ||
    !acknowledgementsValid
  ) {
    throw new Error(`Leaf operation ${execution.requestId} rewrote its recovery ledger`);
  }
  const transition = `${previous.execution.status}->${execution.status}`;
  if (
    transition === 'recovery_required->recovery_required' &&
    !isDeepStrictEqual(previous.execution, execution)
  ) {
    throw new Error(`Leaf operation ${execution.requestId} rewrote its recovery status`);
  }
  if (
    transition !== 'queued->dispatched' &&
    transition !== 'queued->pre_dispatch_authority_expired' &&
    transition !== 'dispatched->succeeded' &&
    transition !== 'dispatched->failed' &&
    transition !== 'dispatched->rejected' &&
    transition !== 'dispatched->recovery_required' &&
    transition !== 'recovery_required->recovery_required' &&
    transition !== 'recovery_required->failed' &&
    transition !== 'recovery_required->succeeded'
  ) {
    throw new Error(`Leaf operation ${execution.requestId} has invalid transition ${transition}`);
  }
}

function sameReplayLeafIdentity(
  left: CompanionLeafOperationStatus,
  right: CompanionLeafOperationStatus,
): boolean {
  return (
    left.formatVersion === right.formatVersion &&
    left.replayId === right.replayId &&
    isDeepStrictEqual(left.target, right.target) &&
    left.proposalId === right.proposalId &&
    isDeepStrictEqual(left.plan, right.plan) &&
    left.planContentSha256 === right.planContentSha256 &&
    left.executionId === right.executionId &&
    left.leafId === right.leafId &&
    left.stepId === right.stepId &&
    left.actionName === right.actionName &&
    left.recipeId === right.recipeId &&
    left.catalogVersion === right.catalogVersion &&
    left.interactionCatalogContentSha256 === right.interactionCatalogContentSha256 &&
    left.materializationContentSha256 === right.materializationContentSha256 &&
    left.mcpTrackContentSha256 === right.mcpTrackContentSha256 &&
    isDeepStrictEqual(left.expectedState, right.expectedState) &&
    isDeepStrictEqual(left.operationIds, right.operationIds)
  );
}

function validateSuccessfulReplayLedger(
  replayId: string,
  storedExecutions: readonly StoredLeafOperation[],
): void {
  const successful = storedExecutions
    .filter(({ execution }) => execution.replayId === replayId && execution.status === 'succeeded')
    .sort((left, right) => left.execution.operationOrdinal - right.execution.operationOrdinal);
  if (successful.length === 0) return;
  const first = successful[0]!;
  const firstProgress = first.execution.result?.progress;
  if (firstProgress === null || firstProgress === undefined) {
    throw new Error(`Leaf operation replay ${replayId} is missing successful progress`);
  }
  for (const [index, stored] of successful.entries()) {
    const expectedOrdinal = index + 1;
    const { execution } = stored;
    const progress = execution.result?.progress;
    if (
      execution.operationOrdinal !== expectedOrdinal ||
      progress === null ||
      progress === undefined ||
      progress.completedOperationIds.length !== expectedOrdinal
    ) {
      throw new Error(
        `Leaf operation replay ${replayId} does not form a unique contiguous successful prefix`,
      );
    }
    if (
      !sameReplayLeafIdentity(first.execution, execution) ||
      stored.documentAuthoritySha256 !== first.documentAuthoritySha256 ||
      progress.runId !== firstProgress.runId ||
      progress.bindingSha256 !== firstProgress.bindingSha256 ||
      progress.latestObservation.details.receiptId !==
        firstProgress.latestObservation.details.receiptId
    ) {
      throw new Error(`Leaf operation replay ${replayId} changed its durable leaf-run identity`);
    }
    const previous = successful[index - 1]?.execution.result?.progress;
    if (
      previous !== undefined &&
      previous !== null &&
      previous.latestObservation.details.afterFingerprintSha256 !==
        progress.latestObservation.details.beforeFingerprintSha256
    ) {
      throw new Error(`Leaf operation replay ${replayId} broke its Blender fingerprint chain`);
    }
  }
}

function validateActiveTargetLocks(storedExecutions: readonly StoredLeafOperation[]): void {
  const owners = new Map<string, string>();
  for (const { execution } of storedExecutions) {
    if (
      execution.status !== 'queued' &&
      execution.status !== 'dispatched' &&
      execution.status !== 'recovery_required'
    ) {
      continue;
    }
    const targetKey = `${execution.target.adapterId}:${execution.target.instanceId}`;
    const existing = owners.get(targetKey);
    if (existing !== undefined && existing !== execution.requestId) {
      throw new Error(
        `Leaf operation target ${targetKey} has conflicting durable lock owners ${existing} and ${execution.requestId}`,
      );
    }
    owners.set(targetKey, execution.requestId);
  }
}

export function createBlenderLeafOperationExecutionCoordinator(
  options: BlenderLeafOperationExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredLeafOperation>();

  for (const event of options.database.listExecutionEventsByTypes(leafOperationEventTypes)) {
    const parsed = storedLeafOperationEventSchema.parse(event.payload);
    const previous = executions.get(parsed.execution.requestId);
    assertStoredTransition(previous, parsed);
    executions.set(parsed.execution.requestId, parsed);
  }
  for (const replayId of new Set(
    [...executions.values()].map(({ execution }) => execution.replayId),
  )) {
    validateSuccessfulReplayLedger(replayId, [...executions.values()]);
  }
  validateActiveTargetLocks([...executions.values()]);

  const append = (
    eventType: (typeof leafOperationEventTypes)[number],
    stored: StoredLeafOperationInput,
    eventId = `blender-leaf-operation:${stored.execution.requestId}:${stored.execution.status}`,
    createdAt = stored.execution.updatedAt,
  ): CompanionLeafOperationStatus => {
    const parsed = storedLeafOperationEventSchema.parse(stored);
    assertStoredTransition(executions.get(parsed.execution.requestId), parsed);
    options.database.appendEvent({
      id: eventId,
      eventType,
      payload: parsed,
      createdAt,
    });
    executions.set(parsed.execution.requestId, parsed);
    return parsed.execution;
  };

  for (const stored of [...executions.values()]) {
    if (stored.execution.status !== 'dispatched') continue;
    const recoveredAt = now();
    append('blender.leaf-operation.recovery-required', {
      sessionFingerprintSha256: stored.sessionFingerprintSha256,
      dispatchSessionId: stored.dispatchSessionId,
      documentAuthoritySha256: stored.documentAuthoritySha256,
      execution: companionLeafOperationStatusSchema.parse({
        ...stored.execution,
        status: 'recovery_required',
        recoveryEvidence: {
          source: 'coordinator_restart',
          reason: 'runtime_restart_after_delivery',
          priorStatus: 'dispatched',
          detectedAt: recoveredAt,
          requiresExplicitRecovery: true,
          automaticReplay: false,
          retainsTargetLock: true,
        },
        updatedAt: recoveredAt,
      }),
    });
  }

  const get = (requestId: string): CompanionLeafOperationStatus | null =>
    executions.get(requestId)?.execution ?? null;

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    [...executions.values()].some(
      ({ execution }) =>
        execution.target.adapterId === adapterId &&
        execution.target.instanceId === instanceId &&
        (execution.status === 'queued' ||
          execution.status === 'dispatched' ||
          execution.status === 'recovery_required'),
    );

  const listTargetLockOwners = () =>
    [...executions.values()]
      .map(({ execution }) => execution)
      .filter(
        (execution) =>
          execution.status === 'queued' ||
          execution.status === 'dispatched' ||
          execution.status === 'recovery_required',
      )
      .map((execution) => ({
        targetKey: `${execution.target.adapterId}:${execution.target.instanceId}`,
        adapterId: execution.target.adapterId,
        instanceId: execution.target.instanceId,
        requestId: execution.requestId,
        status: execution.status,
      }))
      .sort(
        (left, right) =>
          left.targetKey.localeCompare(right.targetKey) ||
          left.requestId.localeCompare(right.requestId),
      );

  const findForCreate = (
    input: CompanionLeafOperationCreateRequest,
  ): CompanionLeafOperationStatus | null => {
    const request = companionLeafOperationCreateRequestSchema.parse(input);
    const stored = executions.get(request.requestId);
    if (stored === undefined) return null;
    if (retiresDocumentIncarnation(stored)) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_document_incarnation_retired',
        409,
        'This leaf-operation request belongs to a quarantined Blender document incarnation',
      );
    }
    const existing = stored.execution;
    if (!sameCreateRequest(existing, request)) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_request_conflict',
        409,
        'The requestId is already bound to a different leaf operation request',
      );
    }
    return existing;
  };

  const reconcileDocumentAuthority = (
    adapterId: 'blender',
    instanceId: string,
    currentDocumentAuthoritySha256: string,
    currentSessionId?: string,
  ): CompanionLeafOperationStatus[] => {
    const documentAuthority = sha256Schema.parse(currentDocumentAuthoritySha256);
    const sessionId = currentSessionId === undefined ? undefined : z.uuid().parse(currentSessionId);
    const reconciled: CompanionLeafOperationStatus[] = [];
    for (const pending of [...executions.values()]) {
      if (
        (pending.execution.status !== 'queued' && pending.execution.status !== 'dispatched') ||
        pending.execution.target.adapterId !== adapterId ||
        pending.execution.target.instanceId !== instanceId
      ) {
        continue;
      }
      const documentChanged = pending.documentAuthoritySha256 !== documentAuthority;
      const dispatchedSessionChanged =
        pending.execution.status === 'dispatched' &&
        sessionId !== undefined &&
        pending.dispatchSessionId !== null &&
        pending.dispatchSessionId !== sessionId;
      if (!documentChanged && !dispatchedSessionChanged) continue;
      const detectedAt = now();
      if (pending.execution.status === 'dispatched') {
        reconciled.push(
          append('blender.leaf-operation.recovery-required', {
            ...pending,
            execution: companionLeafOperationStatusSchema.parse({
              ...pending.execution,
              status: 'recovery_required',
              recoveryEvidence: {
                source: documentChanged ? 'document_authority_drift' : 'session_authority_drift',
                reason: documentChanged
                  ? 'document_authority_changed_after_delivery'
                  : 'companion_session_changed_after_delivery',
                priorStatus: 'dispatched',
                detectedAt,
                requiresExplicitRecovery: true,
                automaticReplay: false,
                retainsTargetLock: true,
              },
              updatedAt: detectedAt,
            }),
          }),
        );
        continue;
      }
      reconciled.push(
        append('blender.leaf-operation.pre-dispatch-authority-expired', {
          sessionFingerprintSha256: pending.sessionFingerprintSha256,
          dispatchSessionId: pending.dispatchSessionId,
          documentAuthoritySha256: pending.documentAuthoritySha256,
          execution: companionLeafOperationStatusSchema.parse({
            ...pending.execution,
            status: 'pre_dispatch_authority_expired',
            preDispatchAuthorityExpirationEvidence: {
              source: 'document_authority_drift',
              requestId: pending.execution.requestId,
              operationBindingSha256: pending.execution.operationBindingSha256,
              target: pending.execution.target,
              priorStatus: 'queued',
              detectedAt,
              resolution: 'pre_dispatch_authority_expired',
              retainsTargetLock: false,
              automaticReplay: false,
            },
            updatedAt: detectedAt,
          }),
        }),
      );
    }
    return reconciled;
  };

  const queue = (
    input: CompanionLeafOperationStatus,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): CompanionLeafOperationStatus => {
    const execution = companionLeafOperationStatusSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    if (execution.status !== 'queued') {
      throw new Error('Only a queued leaf operation can enter the coordinator');
    }
    const retiredDocument = [...executions.values()].find(
      (candidate) =>
        candidate.documentAuthoritySha256 === documentAuthority &&
        retiresDocumentIncarnation(candidate),
    );
    if (retiredDocument !== undefined) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_document_incarnation_retired',
        409,
        `Document incarnation ${documentAuthority} was quarantined by leaf operation ${retiredDocument.execution.requestId}; a fresh document incarnation is required`,
      );
    }
    const existing = findForCreate({
      formatVersion: execution.formatVersion,
      requestId: execution.requestId,
      replayId: execution.replayId,
      expectedState: execution.expectedState,
    });
    if (existing !== null) return existing;

    const successfulForReplay = [...executions.values()]
      .filter(
        ({ execution: candidate }) =>
          candidate.replayId === execution.replayId && candidate.status === 'succeeded',
      )
      .sort((left, right) => left.execution.operationOrdinal - right.execution.operationOrdinal);
    const expectedOrdinal = successfulForReplay.length + 1;
    const firstSuccessful = successfulForReplay[0]?.execution;
    if (
      execution.operationOrdinal !== expectedOrdinal ||
      (firstSuccessful !== undefined && !sameReplayLeafIdentity(firstSuccessful, execution))
    ) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_sequence_conflict',
        409,
        `Leaf operation ${execution.requestId} is not the authorized next operation for its durable replay prefix`,
      );
    }

    const externalOwner = options.externalHistoryLockOwner?.(
      execution.target.adapterId,
      execution.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_history_locked',
        409,
        `Native history owner ${externalOwner} owns the target instance`,
      );
    }
    const conflicting = [...executions.values()].find(
      ({ execution: candidate }) =>
        candidate.target.adapterId === execution.target.adapterId &&
        candidate.target.instanceId === execution.target.instanceId &&
        (candidate.status === 'queued' ||
          candidate.status === 'dispatched' ||
          candidate.status === 'recovery_required'),
    );
    if (conflicting !== undefined) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_in_progress',
        409,
        `Leaf operation ${conflicting.execution.requestId} still owns the target instance`,
      );
    }
    return append('blender.leaf-operation.queued', {
      execution,
      sessionFingerprintSha256: fingerprint,
      dispatchSessionId: null,
      documentAuthoritySha256: documentAuthority,
    });
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
    currentSessionId: string | null = null,
  ): CompanionLeafOperationDelivery | null => {
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const sessionId = currentSessionId === null ? null : z.uuid().parse(currentSessionId);
    reconcileDocumentAuthority(adapterId, instanceId, documentAuthority, sessionId ?? undefined);
    const pending = [...executions.values()]
      .filter(
        ({ execution }) =>
          execution.status === 'queued' &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId,
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (pending === undefined) return null;
    const externalOwner = options.externalHistoryLockOwner?.(adapterId, instanceId);
    if (externalOwner !== undefined && externalOwner !== null) return null;
    const dispatchedAt = now();
    const deliveryAuthority: Record<string, unknown> = { ...pending.execution };
    delete deliveryAuthority.deliveryId;
    delete deliveryAuthority.dispatchedAt;
    delete deliveryAuthority.status;
    delete deliveryAuthority.result;
    delete deliveryAuthority.updatedAt;
    const delivery = companionLeafOperationDeliverySchema.parse({
      ...deliveryAuthority,
      deliveryId: createId(),
      dispatchedAt,
    });
    append('blender.leaf-operation.dispatched', {
      sessionFingerprintSha256: fingerprint,
      dispatchSessionId: sessionId,
      documentAuthoritySha256: pending.documentAuthoritySha256,
      execution: companionLeafOperationStatusSchema.parse({
        ...pending.execution,
        deliveryId: delivery.deliveryId,
        dispatchedAt,
        status: 'dispatched',
        updatedAt: dispatchedAt,
      }),
    });
    return delivery;
  };

  const complete = (
    input: CompanionLeafOperationResult,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
    validateResult: (
      result: CompanionLeafOperationResult,
      execution: CompanionLeafOperationStatus,
    ) => void,
  ): 'accepted' | 'duplicate' => {
    const result = companionLeafOperationResultSchema.parse(input);
    const completionFingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const stored = executions.get(result.requestId);
    if (stored === undefined) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_not_found',
        404,
        'The leaf operation request was not found',
      );
    }
    const terminal = ['succeeded', 'failed', 'rejected'].includes(stored.execution.status);
    if (terminal) {
      if (
        stored.documentAuthoritySha256 !== documentAuthority ||
        !sameDeliveryIdentity(stored.execution, result)
      ) {
        throw new BlenderLeafOperationExecutionError(
          'leaf_operation_result_identity_mismatch',
          409,
          'The leaf operation result does not match its accepted delivery and Companion document',
        );
      }
      if (isDeepStrictEqual(stored.execution.result, result)) return 'duplicate';
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_result_conflict',
        409,
        'The leaf operation already has a different terminal result',
      );
    }
    if (stored.execution.status === 'recovery_required') {
      if (
        result.status === 'recovery_required' &&
        stored.documentAuthoritySha256 === documentAuthority &&
        sameDeliveryIdentity(stored.execution, result) &&
        isDeepStrictEqual(stored.execution.result, result)
      ) {
        return 'duplicate';
      }
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_required',
        409,
        'The operation outcome is indeterminate and requires explicit read-only recovery',
      );
    }
    if (stored.execution.status !== 'dispatched') {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_not_completable',
        409,
        'The leaf operation has not been dispatched',
      );
    }
    if (
      stored.documentAuthoritySha256 !== documentAuthority ||
      !sameDeliveryIdentity(stored.execution, result)
    ) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_result_identity_mismatch',
        409,
        'The leaf operation result does not match its accepted delivery and Companion document',
      );
    }
    if (result.status === 'recovery_required') {
      append('blender.leaf-operation.recovery-required', {
        sessionFingerprintSha256: stored.sessionFingerprintSha256,
        dispatchSessionId: stored.dispatchSessionId,
        documentAuthoritySha256: stored.documentAuthoritySha256,
        recoveryChallenges: stored.recoveryChallenges,
        recoveryAcks: stored.recoveryAcks,
        execution: companionLeafOperationStatusSchema.parse({
          ...stored.execution,
          status: 'recovery_required',
          result,
          recoveryEvidence: {
            source: 'companion_reported',
            reason: result.recoveryReason!.kind,
            priorStatus: 'dispatched',
            detectedAt: result.occurredAt,
            requiresExplicitRecovery: true,
            automaticReplay: false,
            retainsTargetLock: true,
          },
          updatedAt: result.occurredAt,
        }),
      });
      return 'accepted';
    }
    validateResult(result, stored.execution);
    const completedAt = now();
    const completedStored = storedLeafOperationEventSchema.parse({
      sessionFingerprintSha256: stored.sessionFingerprintSha256,
      dispatchSessionId: stored.dispatchSessionId,
      completionSessionFingerprintSha256: completionFingerprint,
      documentAuthoritySha256: stored.documentAuthoritySha256,
      execution: companionLeafOperationStatusSchema.parse({
        ...stored.execution,
        status: result.status,
        result,
        updatedAt: completedAt,
      }),
    });
    if (result.status === 'succeeded') {
      validateSuccessfulReplayLedger(result.replayId, [...executions.values(), completedStored]);
    }
    append('blender.leaf-operation.completed', completedStored);
    return 'accepted';
  };

  const issueRecoveryChallenge = (
    requestId: string,
    replacementSessionFingerprintSha256: string,
    documentAuthoritySha256: string,
    inputAuthorityProof: CompanionLeafOperationRecoveryAuthorityProof,
  ): CompanionLeafOperationRecoveryChallenge => {
    const replacementFingerprint = sha256Schema.parse(replacementSessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const authorityProof =
      companionLeafOperationRecoveryAuthorityProofSchema.parse(inputAuthorityProof);
    const stored = executions.get(requestId);
    if (stored === undefined || stored.execution.status !== 'recovery_required') {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_not_required',
        409,
        'The leaf operation does not have an indeterminate delivered outcome',
      );
    }
    if (stored.documentAuthoritySha256 !== documentAuthority) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_document_mismatch',
        409,
        'Recovery must remain on the original durable Companion document',
      );
    }
    if (stored.sessionFingerprintSha256 === replacementFingerprint) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_lease_not_rotated',
        409,
        'Recovery requires a replacement authenticated Companion lease',
      );
    }

    const latestChallenge = stored.recoveryChallenges.at(-1);
    const latestAcknowledged =
      latestChallenge === undefined
        ? undefined
        : stored.recoveryAcks.find((ack) => ack.recoveryId === latestChallenge.recoveryId);
    if (
      latestChallenge !== undefined &&
      latestAcknowledged === undefined &&
      latestChallenge.replacementSessionFingerprintSha256 === replacementFingerprint &&
      isDeepStrictEqual(latestChallenge.authorityProof, authorityProof)
    ) {
      return latestChallenge;
    }
    if (
      latestChallenge?.replacementSessionFingerprintSha256 === replacementFingerprint &&
      latestAcknowledged !== undefined
    ) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_lease_already_acknowledged',
        409,
        'An acknowledged unresolved recovery requires another replacement lease',
      );
    }

    const successfulPrefix = [...executions.values()]
      .filter(
        ({ execution }) =>
          execution.replayId === stored.execution.replayId && execution.status === 'succeeded',
      )
      .sort((left, right) => left.execution.operationOrdinal - right.execution.operationOrdinal);
    if (successfulPrefix.length !== stored.execution.operationOrdinal - 1) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_prefix_mismatch',
        409,
        'Recovery cannot bind a non-contiguous accepted leaf-operation prefix',
      );
    }
    const latestProgress = successfulPrefix.at(-1)?.execution.result?.progress ?? null;
    const acceptedPrefix = {
      completedOperationIds: latestProgress?.completedOperationIds ?? [],
      runId: latestProgress?.runId ?? null,
      bindingSha256: latestProgress?.bindingSha256 ?? null,
      receiptId: latestProgress?.latestObservation.details.receiptId ?? null,
      nextOrdinal: latestProgress?.nextOrdinal ?? 1,
      latestFingerprintSha256:
        latestProgress?.latestObservation.details.afterFingerprintSha256 ?? null,
    };
    const runtimeRequestedAt = now();
    const requestedAt =
      Date.parse(runtimeRequestedAt) < Date.parse(stored.execution.updatedAt)
        ? stored.execution.updatedAt
        : runtimeRequestedAt;
    const challenge = companionLeafOperationRecoveryChallengeSchema.parse({
      formatVersion: stored.execution.formatVersion,
      recoveryId: createId(),
      originalDelivery: deliveryFromExecution(stored.execution),
      originalSessionFingerprintSha256: stored.sessionFingerprintSha256,
      replacementSessionFingerprintSha256: replacementFingerprint,
      expectedState: stored.execution.expectedState,
      acceptedPrefix,
      authorityProof,
      nativeUndoGuard: stored.execution.result?.recoveryReason?.nativeUndoGuard ?? null,
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt,
    });
    append(
      'blender.leaf-operation.recovery-challenged',
      {
        ...stored,
        ...recoveryLedgerWithChallenge(stored, challenge),
      },
      `blender-leaf-operation:${requestId}:recovery:${challenge.recoveryId}:challenge`,
      requestedAt,
    );
    return challenge;
  };

  const pollRecovery = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
  ): CompanionLeafOperationRecoveryChallenge | null => {
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    for (const stored of [...executions.values()]) {
      if (
        stored.execution.status !== 'recovery_required' ||
        stored.execution.target.adapterId !== adapterId ||
        stored.execution.target.instanceId !== instanceId ||
        stored.documentAuthoritySha256 !== documentAuthority
      ) {
        continue;
      }
      const challenge = stored.recoveryChallenges.at(-1);
      if (
        challenge !== undefined &&
        challenge.replacementSessionFingerprintSha256 === fingerprint &&
        !stored.recoveryAcks.some((ack) => ack.recoveryId === challenge.recoveryId)
      ) {
        return challenge;
      }
    }
    return null;
  };

  const acknowledgeRecovery = (
    input: CompanionLeafOperationRecoveryAck,
    sessionFingerprintSha256: string,
    documentAuthoritySha256: string,
    validateRecovery: (
      ack: CompanionLeafOperationRecoveryAck,
      execution: CompanionLeafOperationStatus,
    ) => void,
  ): 'accepted' | 'duplicate' => {
    const ack = companionLeafOperationRecoveryAckSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const documentAuthority = sha256Schema.parse(documentAuthoritySha256);
    const stored = executions.get(ack.requestId);
    if (stored === undefined) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_not_pending',
        409,
        'The leaf operation has no pending recovery challenge',
      );
    }
    const latestChallenge = stored.recoveryChallenges.at(-1);
    if (
      latestChallenge === undefined ||
      latestChallenge.recoveryId !== ack.recoveryId ||
      !isDeepStrictEqual(latestChallenge, ack.challenge)
    ) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_stale',
        409,
        'The recovery acknowledgement does not match the latest recovery challenge',
      );
    }
    if (stored.documentAuthoritySha256 !== documentAuthority) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_authority_mismatch',
        409,
        'The recovery acknowledgement is not authenticated by its replacement lease and document',
      );
    }
    const acceptedAck = stored.recoveryAcks.find(
      (candidate) => candidate.recoveryId === ack.recoveryId,
    );
    if (acceptedAck !== undefined) {
      if (isDeepStrictEqual(acceptedAck, ack)) {
        if (
          stored.execution.status === 'succeeded' ||
          stored.execution.status === 'failed' ||
          latestChallenge.replacementSessionFingerprintSha256 === fingerprint
        ) {
          return 'duplicate';
        }
        throw new BlenderLeafOperationExecutionError(
          'leaf_operation_recovery_authority_mismatch',
          409,
          'The unresolved recovery acknowledgement requires its replacement lease',
        );
      }
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_ack_conflict',
        409,
        'The recovery challenge already has a different acknowledgement',
      );
    }
    if (latestChallenge.replacementSessionFingerprintSha256 !== fingerprint) {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_authority_mismatch',
        409,
        'A new acknowledgement requires the exact replacement Companion lease',
      );
    }
    if (stored.execution.status !== 'recovery_required') {
      throw new BlenderLeafOperationExecutionError(
        'leaf_operation_recovery_not_pending',
        409,
        'The leaf operation has no pending recovery challenge',
      );
    }
    validateRecovery(ack, stored.execution);
    const recoveryAcks = [...stored.recoveryAcks, ack];
    if (ack.outcome === 'unresolved_current_state') {
      append(
        'blender.leaf-operation.recovery-acknowledged',
        { ...stored, recoveryAcks },
        `blender-leaf-operation:${ack.requestId}:recovery:${ack.recoveryId}:ack`,
        ack.occurredAt,
      );
      return 'accepted';
    }

    if (ack.evidence.kind === 'operation_applied') {
      const resolvedAuthority: Record<string, unknown> = { ...stored.execution };
      delete resolvedAuthority.status;
      delete resolvedAuthority.result;
      delete resolvedAuthority.recoveryEvidence;
      delete resolvedAuthority.updatedAt;
      const completedStored = storedLeafOperationEventSchema.parse({
        sessionFingerprintSha256: stored.sessionFingerprintSha256,
        dispatchSessionId: stored.dispatchSessionId,
        completionSessionFingerprintSha256: fingerprint,
        documentAuthoritySha256: stored.documentAuthoritySha256,
        recoveryChallenges: stored.recoveryChallenges,
        recoveryAcks,
        execution: companionLeafOperationStatusSchema.parse({
          ...resolvedAuthority,
          status: 'succeeded',
          result: ack.evidence.terminalResult,
          updatedAt: ack.occurredAt,
        }),
      });
      validateSuccessfulReplayLedger(ack.evidence.terminalResult.replayId, [
        ...executions.values(),
        completedStored,
      ]);
      append('blender.leaf-operation.completed', completedStored);
      return 'accepted';
    }

    const failedResult = companionLeafOperationResultSchema.parse({
      ...latestChallenge.originalDelivery,
      status: 'failed',
      progress: null,
      error:
        ack.evidence.kind === 'document_incarnation_retired'
          ? `Recovery evidence was lost after reload (${ack.evidence.reason}); the document incarnation is retired and its mutation outcome remains indeterminate.`
          : 'Explicit recovery proved the durable accepted operation prefix was restored.',
      occurredAt: ack.occurredAt,
    });
    const resolvedAuthority: Record<string, unknown> = { ...stored.execution };
    delete resolvedAuthority.status;
    delete resolvedAuthority.result;
    delete resolvedAuthority.recoveryEvidence;
    delete resolvedAuthority.updatedAt;
    append('blender.leaf-operation.completed', {
      sessionFingerprintSha256: stored.sessionFingerprintSha256,
      dispatchSessionId: stored.dispatchSessionId,
      completionSessionFingerprintSha256: fingerprint,
      documentAuthoritySha256: stored.documentAuthoritySha256,
      recoveryChallenges: stored.recoveryChallenges,
      recoveryAcks,
      execution: companionLeafOperationStatusSchema.parse({
        ...resolvedAuthority,
        status: 'failed',
        result: failedResult,
        updatedAt: ack.occurredAt,
      }),
    });
    return 'accepted';
  };

  const latestSucceededForReplay = (replayId: string): CompanionLeafOperationStatus | null =>
    [...executions.values()]
      .map(({ execution }) => execution)
      .filter((execution) => execution.replayId === replayId && execution.status === 'succeeded')
      .sort(
        (left, right) =>
          right.operationOrdinal - left.operationOrdinal ||
          right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null;

  const successfulExecutionsForReplay = (
    replayId: string,
  ): readonly CompanionLeafOperationStatus[] =>
    [...executions.values()]
      .map(({ execution }) => execution)
      .filter((execution) => execution.replayId === replayId && execution.status === 'succeeded')
      .sort((left, right) => left.operationOrdinal - right.operationOrdinal);

  return {
    acknowledgeRecovery,
    complete,
    findForCreate,
    get,
    latestSucceededForReplay,
    listTargetLockOwners,
    ownsTarget,
    poll,
    pollRecovery,
    queue,
    reconcileDocumentAuthority,
    issueRecoveryChallenge,
    successfulExecutionsForReplay,
  };
}

export type BlenderLeafOperationExecutionCoordinator = ReturnType<
  typeof createBlenderLeafOperationExecutionCoordinator
>;
