import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionShortcutProofCreateRequestSchema,
  companionShortcutProofDeliverySchema,
  companionShortcutProofHistoryIdentitySchema,
  companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery,
  companionShortcutProofHistoryTransitionReconciliationAckSchema,
  companionShortcutProofProgressSchema,
  companionShortcutProofRecoveryAckMatchesDelivery,
  companionShortcutProofRecoveryAckSchema,
  companionShortcutProofRecoveryDeliverySchema,
  companionShortcutProofResultSchema,
  companionShortcutProofStatusSchema,
  companionShortcutProofTerminalReconciliationAckMatchesDelivery,
  companionShortcutProofTerminalReconciliationAckSchema,
  companionShortcutProofTerminalReconciliationDeliverySchema,
  canonicalizeProtocolJsonValue,
  computeCompanionShortcutProofResultContentSha256,
  type CompanionShortcutProofCreateRequest,
  type CompanionShortcutProofDelivery,
  type CompanionShortcutProofProgress,
  type CompanionShortcutProofHistoryTransitionReconciliationAck,
  type CompanionShortcutProofRecoveryAck,
  type CompanionShortcutProofRecoveryDelivery,
  type CompanionShortcutProofResult,
  type CompanionShortcutProofStatus,
  type CompanionShortcutProofTerminalReconciliationAck,
  type CompanionShortcutProofTerminalReconciliationDelivery,
} from '@operatingline/protocol';
import { z } from 'zod';

const shortcutProofEventTypes = [
  'blender.shortcut-proof.queued',
  'blender.shortcut-proof.dispatched',
  'blender.shortcut-proof.progress-0',
  'blender.shortcut-proof.progress-1',
  'blender.shortcut-proof.progress-2',
  'blender.shortcut-proof.progress-3',
  'blender.shortcut-proof.completed',
  'blender.shortcut-proof.failed-checkpointed',
  'blender.shortcut-proof.failed-restored',
  'blender.shortcut-proof.rejected',
  'blender.shortcut-proof.restored',
  'blender.shortcut-proof.reapplied-locked',
  'blender.shortcut-proof.history-recovery-offered',
  'blender.shortcut-proof.history-rebound',
  'blender.shortcut-proof.history-transition-reconciled',
  'blender.shortcut-proof.terminal-reconciliation-offered',
  'blender.shortcut-proof.terminal-reconciled',
  'blender.shortcut-proof.recovery-required',
] as const;

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const phaseSchema = z.enum([
  'queued',
  'dispatched',
  'progress_0',
  'progress_1',
  'progress_2',
  'progress_3',
  'succeeded',
  'failed_checkpointed',
  'failed_restored',
  'rejected',
  'restored',
  'reapplied_locked',
  'recovery_required',
]);
const storedShortcutProofEventSchema = z.strictObject({
  execution: companionShortcutProofStatusSchema,
  phase: phaseSchema,
  sessionFingerprintSha256: contentSha256Schema,
  progressReceiptChainHeads: z.array(contentSha256Schema).max(4),
  history: companionShortcutProofHistoryIdentitySchema.nullable().default(null),
  pendingRecovery: companionShortcutProofRecoveryDeliverySchema.nullable().default(null),
  pendingRecoverySessionFingerprintSha256: contentSha256Schema.nullable().default(null),
  recoveryAcks: z.array(companionShortcutProofRecoveryAckSchema).max(32).default([]),
  historyTransitionReconciliationAcks: z
    .array(companionShortcutProofHistoryTransitionReconciliationAckSchema)
    .max(32)
    .default([]),
  pendingTerminalReconciliation: companionShortcutProofTerminalReconciliationDeliverySchema
    .nullable()
    .default(null),
  pendingTerminalReconciliationSessionFingerprintSha256: contentSha256Schema
    .nullable()
    .default(null),
  terminalReconciliationAcks: z
    .array(companionShortcutProofTerminalReconciliationAckSchema)
    .max(1)
    .default([]),
});

type ShortcutProofDatabase = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;
type StoredShortcutProof = z.infer<typeof storedShortcutProofEventSchema>;
type ShortcutProofPhase = StoredShortcutProof['phase'];

function isLockedPhase(phase: ShortcutProofPhase): boolean {
  return phase === 'succeeded' || phase === 'failed_checkpointed' || phase === 'reapplied_locked';
}

function hasRetainedHistoryPhase(phase: ShortcutProofPhase): boolean {
  return isLockedPhase(phase) || phase === 'restored';
}

function historyFromTerminalResult(
  result: CompanionShortcutProofResult,
): StoredShortcutProof['history'] {
  const evidence = result.terminalEvidence;
  if (evidence.kind === 'succeeded_locked') {
    const checkpoint = evidence.attestation.nativeUndoCheckpoint;
    return {
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      checkpointKind: 'success',
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(result),
    };
  }
  if (evidence.kind === 'failed_checkpointed') {
    return {
      checkpointId: evidence.checkpoint.checkpointId,
      undoLockId: evidence.checkpoint.undoLockId,
      checkpointKind: 'failure',
      baselineSceneFingerprintSha256: evidence.checkpoint.baselineState.sceneFingerprintSha256,
      lockedSceneFingerprintSha256: evidence.checkpoint.currentState.sceneFingerprintSha256,
      terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(result),
    };
  }
  return null;
}

function recoveryMarkerContentSha256(
  execution: CompanionShortcutProofStatus,
  history: NonNullable<StoredShortcutProof['history']>,
): string {
  const marker = {
    formatVersion: '1.0.0',
    executorId: execution.executorId,
    checkpointId: history.checkpointId,
    undoLockId: history.undoLockId,
    proofId: execution.proofId,
    replayId: execution.replayId,
    targetId: execution.binding.acceptedAction.arguments.targetId,
    targetObjectName: 'Cube',
    checkpointKind: history.checkpointKind,
    baselineSceneFingerprintSha256: history.baselineSceneFingerprintSha256,
    finalSceneFingerprintSha256: history.lockedSceneFingerprintSha256,
    terminalResultContentSha256: history.terminalResultContentSha256,
  };
  return createHash('sha256').update(canonicalizeProtocolJsonValue(marker)).digest('hex');
}

function terminalReceiptChainHeads(result: CompanionShortcutProofResult): readonly string[] {
  const evidence = result.terminalEvidence;
  return evidence.kind === 'succeeded_locked'
    ? evidence.attestation.operationReceipts.map((receipt) => receipt.contentSha256)
    : evidence.kind === 'failed_checkpointed'
      ? evidence.receiptPrefix.map((receipt) => receipt.contentSha256)
      : [];
}

export class BlenderShortcutProofExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderShortcutProofExecutionError';
  }
}

export interface BlenderShortcutProofExecutionCoordinatorOptions {
  readonly database: ShortcutProofDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
}

function sameCreateRequest(
  execution: CompanionShortcutProofStatus,
  request: CompanionShortcutProofCreateRequest,
): boolean {
  return (
    execution.formatVersion === request.formatVersion &&
    execution.requestId === request.requestId &&
    execution.replayId === request.replayId &&
    isDeepStrictEqual(execution.expectedState, request.expectedState)
  );
}

function sameDeliveryIdentity(
  execution: CompanionShortcutProofStatus,
  evidence:
    | CompanionShortcutProofProgress
    | CompanionShortcutProofRecoveryDelivery
    | CompanionShortcutProofTerminalReconciliationDelivery
    | CompanionShortcutProofResult,
): boolean {
  return (
    execution.formatVersion === evidence.formatVersion &&
    execution.requestId === evidence.requestId &&
    execution.replayId === evidence.replayId &&
    execution.proofId === evidence.proofId &&
    execution.deliveryId === evidence.deliveryId &&
    isDeepStrictEqual(execution.target, evidence.target) &&
    execution.bindingContentSha256 === evidence.bindingContentSha256 &&
    execution.targetProfile === evidence.targetProfile &&
    isDeepStrictEqual(execution.binding, evidence.binding) &&
    execution.proposalId === evidence.proposalId &&
    isDeepStrictEqual(execution.plan, evidence.plan) &&
    execution.executionId === evidence.executionId &&
    execution.leafId === evidence.leafId &&
    execution.interactionCatalogVersion === evidence.interactionCatalogVersion &&
    execution.interactionCatalogContentSha256 === evidence.interactionCatalogContentSha256 &&
    execution.shortcutTrackContentSha256 === evidence.shortcutTrackContentSha256 &&
    execution.executorId === evidence.executorId &&
    execution.executionBoundary === evidence.executionBoundary &&
    execution.authorization === evidence.authorization &&
    execution.transport === evidence.transport &&
    isDeepStrictEqual(execution.operationIds, evidence.operationIds) &&
    isDeepStrictEqual(execution.expectedState, evidence.expectedState) &&
    execution.requestedAt === evidence.requestedAt &&
    execution.dispatchedAt === evidence.dispatchedAt
  );
}

function sameExecutionExceptUpdatedAt(
  left: CompanionShortcutProofStatus,
  right: CompanionShortcutProofStatus,
): boolean {
  return isDeepStrictEqual({ ...left, updatedAt: right.updatedAt }, right);
}

function sameImmutableExecution(
  left: CompanionShortcutProofStatus,
  right: CompanionShortcutProofStatus,
): boolean {
  return (
    left.formatVersion === right.formatVersion &&
    left.requestId === right.requestId &&
    left.replayId === right.replayId &&
    left.proofId === right.proofId &&
    isDeepStrictEqual(left.target, right.target) &&
    left.bindingContentSha256 === right.bindingContentSha256 &&
    left.targetProfile === right.targetProfile &&
    isDeepStrictEqual(left.binding, right.binding) &&
    left.proposalId === right.proposalId &&
    isDeepStrictEqual(left.plan, right.plan) &&
    left.executionId === right.executionId &&
    left.leafId === right.leafId &&
    left.interactionCatalogVersion === right.interactionCatalogVersion &&
    left.interactionCatalogContentSha256 === right.interactionCatalogContentSha256 &&
    left.shortcutTrackContentSha256 === right.shortcutTrackContentSha256 &&
    left.executorId === right.executorId &&
    left.executionBoundary === right.executionBoundary &&
    left.authorization === right.authorization &&
    left.transport === right.transport &&
    isDeepStrictEqual(left.operationIds, right.operationIds) &&
    isDeepStrictEqual(left.expectedState, right.expectedState) &&
    left.requestedAt === right.requestedAt
  );
}

function assertEvidenceTiming(
  stored: StoredShortcutProof,
  evidence: CompanionShortcutProofProgress | CompanionShortcutProofResult,
): void {
  const dispatchedAt = stored.execution.dispatchedAt;
  if (
    dispatchedAt === undefined ||
    Date.parse(evidence.occurredAt) < Date.parse(dispatchedAt) ||
    Date.parse(evidence.occurredAt) < Date.parse(stored.execution.updatedAt)
  ) {
    throw new BlenderShortcutProofExecutionError(
      'shortcut_proof_evidence_time_invalid',
      409,
      'Shortcut proof evidence predates its immutable delivery or previously accepted evidence',
    );
  }
  if (!('terminalEvidence' in evidence)) return;
  const terminal = evidence.terminalEvidence;
  const receipts =
    terminal.kind === 'succeeded_locked'
      ? terminal.attestation.operationReceipts
      : terminal.kind === 'failed_checkpointed' || terminal.kind === 'failed_restored'
        ? terminal.receiptPrefix
        : [];
  let previousAt = Date.parse(dispatchedAt);
  for (const receipt of receipts) {
    const receiptAt = Date.parse(receipt.occurredAt);
    if (receiptAt < previousAt || receiptAt > Date.parse(evidence.occurredAt)) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_evidence_time_invalid',
        409,
        'Shortcut proof receipt timestamps must follow dispatch in canonical order',
      );
    }
    previousAt = receiptAt;
  }
  const boundaryTimes =
    terminal.kind === 'succeeded_locked'
      ? [
          terminal.attestation.strongObservation.observedAt,
          terminal.attestation.nativeUndoCheckpoint.committedAt,
          terminal.attestation.attestedAt,
        ]
      : terminal.kind === 'failed_checkpointed'
        ? [terminal.checkpoint.committedAt]
        : terminal.kind === 'restored'
          ? [terminal.restoredAt]
          : terminal.kind === 'reapplied_locked'
            ? [terminal.reappliedAt]
            : [evidence.occurredAt];
  for (const boundaryAt of boundaryTimes) {
    const timestamp = Date.parse(boundaryAt);
    if (timestamp < previousAt || timestamp > Date.parse(evidence.occurredAt)) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_evidence_time_invalid',
        409,
        'Shortcut proof terminal evidence timestamp is outside its dispatched evidence interval',
      );
    }
    previousAt = timestamp;
  }
}

function undoIdentity(
  execution: CompanionShortcutProofStatus,
): { checkpointId: string; undoLockId: string } | null {
  const evidence = execution.result?.terminalEvidence;
  if (evidence?.kind === 'succeeded_locked') {
    return {
      checkpointId: evidence.attestation.nativeUndoCheckpoint.checkpointId,
      undoLockId: evidence.attestation.nativeUndoCheckpoint.undoLockId,
    };
  }
  if (evidence?.kind === 'failed_checkpointed') {
    return {
      checkpointId: evidence.checkpoint.checkpointId,
      undoLockId: evidence.checkpoint.undoLockId,
    };
  }
  if (evidence?.kind === 'restored' || evidence?.kind === 'reapplied_locked') {
    return {
      checkpointId: evidence.sourceCheckpointId,
      undoLockId: evidence.undoLockId,
    };
  }
  return null;
}

function expectedTransition(previous: ShortcutProofPhase, next: ShortcutProofPhase): boolean {
  if (next === 'recovery_required') {
    return previous === 'queued' || previous === 'dispatched' || previous.startsWith('progress_');
  }
  const transitions: Readonly<Record<ShortcutProofPhase, readonly ShortcutProofPhase[]>> = {
    queued: ['dispatched'],
    dispatched: ['progress_0', 'failed_checkpointed', 'failed_restored', 'rejected'],
    progress_0: ['progress_1', 'failed_checkpointed', 'failed_restored'],
    progress_1: ['progress_2', 'failed_checkpointed', 'failed_restored'],
    progress_2: ['progress_3', 'failed_checkpointed', 'failed_restored'],
    progress_3: ['succeeded', 'failed_checkpointed', 'failed_restored'],
    succeeded: ['restored'],
    failed_checkpointed: ['restored'],
    failed_restored: [],
    rejected: [],
    restored: ['reapplied_locked'],
    reapplied_locked: ['restored'],
    recovery_required: [],
  };
  return transitions[previous].includes(next);
}

function expectedHistoryTransitionStatus(
  phase: 'succeeded' | 'failed_checkpointed' | 'restored' | 'reapplied_locked',
): 'restored' | 'reapplied_locked' {
  return phase === 'restored' ? 'reapplied_locked' : 'restored';
}

function reconcileHistoryTransitionResults(
  stored: StoredShortcutProof,
  ack: CompanionShortcutProofHistoryTransitionReconciliationAck,
): { phase: 'restored' | 'reapplied_locked'; result: CompanionShortcutProofResult } | null {
  if (!hasRetainedHistoryPhase(stored.phase) || stored.execution.result === undefined) return null;
  if (
    stored.phase !== 'succeeded' &&
    stored.phase !== 'failed_checkpointed' &&
    stored.phase !== 'restored' &&
    stored.phase !== 'reapplied_locked'
  ) {
    return null;
  }
  let phase = stored.phase;
  let current = stored.execution.result;
  for (let index = 0; index < ack.results.length; index += 1) {
    const result = ack.results[index]!;
    if (
      result.status !== expectedHistoryTransitionStatus(phase) ||
      Date.parse(result.occurredAt) <= Date.parse(current.occurredAt)
    ) {
      return null;
    }
    phase = result.status;
    current = result;
  }
  if (phase !== 'restored' && phase !== 'reapplied_locked') return null;
  return { phase, result: current };
}

function assertPhaseEvidence(stored: StoredShortcutProof): void {
  const {
    execution,
    history,
    pendingRecovery,
    pendingTerminalReconciliation,
    phase,
    progressReceiptChainHeads,
  } = stored;
  const expectedStatus = phase.startsWith('progress_')
    ? 'in_progress'
    : phase === 'failed_checkpointed'
      ? 'failed_checkpointed'
      : phase === 'failed_restored'
        ? 'failed_restored'
        : phase;
  if (execution.status !== expectedStatus) {
    throw new Error(
      `Shortcut proof ${execution.requestId} phase ${phase} does not match status ${execution.status}`,
    );
  }
  if (phase.startsWith('progress_')) {
    const progressIndex = Number(phase.slice('progress_'.length));
    if (
      progressReceiptChainHeads.length !== progressIndex + 1 ||
      execution.progress?.completedOperationIds.length !== progressIndex + 1 ||
      execution.progress.receiptChainHeadSha256 !== progressReceiptChainHeads.at(-1)
    ) {
      throw new Error(`Shortcut proof ${execution.requestId} has inconsistent progress evidence`);
    }
  }
  if (
    (phase === 'queued' || phase === 'dispatched' || phase === 'rejected') &&
    progressReceiptChainHeads.length !== 0
  ) {
    throw new Error(`Shortcut proof ${execution.requestId} has progress before mutation`);
  }
  if (phase === 'succeeded' && progressReceiptChainHeads.length !== 4) {
    throw new Error(`Shortcut proof ${execution.requestId} lacks its complete receipt chain`);
  }
  if (
    phase === 'succeeded' &&
    (execution.result?.terminalEvidence.kind !== 'succeeded_locked' ||
      !isDeepStrictEqual(
        execution.result.terminalEvidence.attestation.operationReceipts.map(
          (receipt) => receipt.contentSha256,
        ),
        progressReceiptChainHeads,
      ))
  ) {
    throw new Error(`Shortcut proof ${execution.requestId} success changed its receipt SHA chain`);
  }
  if (phase === 'failed_checkpointed' || phase === 'failed_restored') {
    const evidence = execution.result?.terminalEvidence;
    if (
      (phase === 'failed_checkpointed' && evidence?.kind !== 'failed_checkpointed') ||
      (phase === 'failed_restored' && evidence?.kind !== 'failed_restored') ||
      (evidence?.kind !== 'failed_checkpointed' && evidence?.kind !== 'failed_restored') ||
      !isDeepStrictEqual(
        evidence.receiptPrefix.map((receipt) => receipt.contentSha256),
        progressReceiptChainHeads,
      )
    ) {
      throw new Error(
        `Shortcut proof ${execution.requestId} failure changed its receipt SHA chain`,
      );
    }
  }
  const historyRequired =
    phase === 'succeeded' ||
    phase === 'failed_checkpointed' ||
    phase === 'restored' ||
    phase === 'reapplied_locked';
  const historyForbidden =
    phase === 'queued' ||
    phase === 'dispatched' ||
    phase.startsWith('progress_') ||
    phase === 'failed_restored' ||
    phase === 'rejected';
  if ((historyRequired && history === null) || (historyForbidden && history !== null)) {
    throw new Error(`Shortcut proof ${execution.requestId} has inconsistent history identity`);
  }
  if (pendingRecovery !== null && (!hasRetainedHistoryPhase(phase) || history === null)) {
    throw new Error(
      `Shortcut proof ${execution.requestId} offered recovery outside a locked phase`,
    );
  }
  if ((pendingRecovery === null) !== (stored.pendingRecoverySessionFingerprintSha256 === null)) {
    throw new Error(
      `Shortcut proof ${execution.requestId} has an unbound history recovery session`,
    );
  }
  if (
    pendingTerminalReconciliation !== null &&
    (execution.deliveryId === undefined ||
      (!phase.startsWith('progress_') && phase !== 'dispatched' && phase !== 'recovery_required'))
  ) {
    throw new Error(
      `Shortcut proof ${execution.requestId} offered terminal reconciliation outside an indeterminate delivered phase`,
    );
  }
  if (
    (pendingTerminalReconciliation === null) !==
    (stored.pendingTerminalReconciliationSessionFingerprintSha256 === null)
  ) {
    throw new Error(
      `Shortcut proof ${execution.requestId} has an unbound terminal reconciliation session`,
    );
  }
  if (
    stored.pendingTerminalReconciliationSessionFingerprintSha256 === stored.sessionFingerprintSha256
  ) {
    throw new Error(
      `Shortcut proof ${execution.requestId} offered terminal reconciliation to its original session`,
    );
  }
  if (
    pendingTerminalReconciliation !== null &&
    !isDeepStrictEqual(
      pendingTerminalReconciliation.acknowledgedProgressReceiptChainHeads,
      progressReceiptChainHeads,
    )
  ) {
    throw new Error(
      `Shortcut proof ${execution.requestId} changed acknowledged reconciliation progress`,
    );
  }
  const terminal = execution.result?.terminalEvidence;
  if (history !== null && terminal !== undefined) {
    const expected = historyFromTerminalResult(execution.result!);
    const terminalMatchesHistory =
      expected !== null
        ? isDeepStrictEqual(history, expected)
        : (terminal.kind === 'restored' || terminal.kind === 'reapplied_locked') &&
          terminal.sourceCheckpointId === history.checkpointId &&
          terminal.undoLockId === history.undoLockId &&
          terminal.baselineSceneFingerprintSha256 === history.baselineSceneFingerprintSha256 &&
          terminal.lockedSceneFingerprintSha256 === history.lockedSceneFingerprintSha256;
    if (!terminalMatchesHistory) {
      throw new Error(`Shortcut proof ${execution.requestId} changed its history boundary`);
    }
  }
}

function assertStoredTransition(
  previous: StoredShortcutProof | undefined,
  next: StoredShortcutProof,
): void {
  assertPhaseEvidence(next);
  if (previous === undefined) {
    if (next.phase !== 'queued' || next.execution.status !== 'queued') {
      throw new Error(`Shortcut proof ${next.execution.requestId} is missing its queued event`);
    }
    return;
  }
  const sameExecutionIdentity = sameImmutableExecution(previous.execution, next.execution);
  const recoveryOffered =
    sameExecutionIdentity &&
    sameExecutionExceptUpdatedAt(previous.execution, next.execution) &&
    previous.phase === next.phase &&
    previous.sessionFingerprintSha256 === next.sessionFingerprintSha256 &&
    (previous.pendingRecovery === null ||
      previous.pendingRecoverySessionFingerprintSha256 !==
        next.pendingRecoverySessionFingerprintSha256) &&
    next.pendingRecovery !== null &&
    next.pendingRecoverySessionFingerprintSha256 !== null &&
    isDeepStrictEqual(previous.history, next.history) &&
    isDeepStrictEqual(previous.recoveryAcks, next.recoveryAcks) &&
    isDeepStrictEqual(
      previous.pendingTerminalReconciliationSessionFingerprintSha256,
      next.pendingTerminalReconciliationSessionFingerprintSha256,
    ) &&
    isDeepStrictEqual(
      previous.historyTransitionReconciliationAcks,
      next.historyTransitionReconciliationAcks,
    ) &&
    next.history !== null &&
    sameDeliveryIdentity(next.execution, next.pendingRecovery) &&
    isDeepStrictEqual(next.pendingRecovery.history, next.history) &&
    next.pendingRecovery.expectedStatus === next.phase &&
    next.execution.result !== undefined &&
    next.pendingRecovery.expectedResultContentSha256 ===
      computeCompanionShortcutProofResultContentSha256(next.execution.result) &&
    next.pendingRecovery.expectedMarkerContentSha256 ===
      recoveryMarkerContentSha256(next.execution, next.history) &&
    next.execution.updatedAt === next.pendingRecovery.recoveryRequestedAt &&
    Date.parse(next.execution.updatedAt) >= Date.parse(previous.execution.updatedAt);
  const acceptedRecoveryAck = next.recoveryAcks.at(-1);
  const recoveryAccepted =
    sameExecutionIdentity &&
    sameExecutionExceptUpdatedAt(previous.execution, next.execution) &&
    previous.phase === next.phase &&
    previous.pendingRecovery !== null &&
    next.pendingRecovery === null &&
    previous.pendingRecoverySessionFingerprintSha256 !== null &&
    next.pendingRecoverySessionFingerprintSha256 === null &&
    previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 &&
    next.recoveryAcks.length === previous.recoveryAcks.length + 1 &&
    isDeepStrictEqual(
      next.recoveryAcks.slice(0, previous.recoveryAcks.length),
      previous.recoveryAcks,
    ) &&
    acceptedRecoveryAck !== undefined &&
    companionShortcutProofRecoveryAckMatchesDelivery(
      acceptedRecoveryAck,
      previous.pendingRecovery,
    ) &&
    next.execution.updatedAt === acceptedRecoveryAck.occurredAt &&
    isDeepStrictEqual(previous.history, next.history) &&
    isDeepStrictEqual(
      previous.historyTransitionReconciliationAcks,
      next.historyTransitionReconciliationAcks,
    );
  const historyTransitionAck = next.historyTransitionReconciliationAcks.at(-1);
  const reconciledHistoryTransition =
    historyTransitionAck === undefined
      ? null
      : reconcileHistoryTransitionResults(previous, historyTransitionAck);
  const historyTransitionReconciled =
    sameExecutionIdentity &&
    previous.pendingRecovery !== null &&
    next.pendingRecovery === null &&
    previous.pendingRecoverySessionFingerprintSha256 !== null &&
    next.pendingRecoverySessionFingerprintSha256 === null &&
    previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 &&
    next.historyTransitionReconciliationAcks.length ===
      previous.historyTransitionReconciliationAcks.length + 1 &&
    isDeepStrictEqual(
      next.historyTransitionReconciliationAcks.slice(
        0,
        previous.historyTransitionReconciliationAcks.length,
      ),
      previous.historyTransitionReconciliationAcks,
    ) &&
    historyTransitionAck !== undefined &&
    companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery(
      historyTransitionAck,
      previous.pendingRecovery,
    ) &&
    reconciledHistoryTransition !== null &&
    next.phase === reconciledHistoryTransition.phase &&
    isDeepStrictEqual(next.execution.result, reconciledHistoryTransition.result) &&
    next.execution.status === reconciledHistoryTransition.result.status &&
    next.execution.updatedAt === historyTransitionAck.occurredAt &&
    isDeepStrictEqual(previous.history, next.history) &&
    isDeepStrictEqual(previous.recoveryAcks, next.recoveryAcks) &&
    isDeepStrictEqual(previous.pendingTerminalReconciliation, next.pendingTerminalReconciliation) &&
    isDeepStrictEqual(previous.terminalReconciliationAcks, next.terminalReconciliationAcks);
  const terminalReconciliationOffered =
    sameExecutionIdentity &&
    sameExecutionExceptUpdatedAt(previous.execution, next.execution) &&
    previous.phase === next.phase &&
    previous.sessionFingerprintSha256 === next.sessionFingerprintSha256 &&
    (previous.pendingTerminalReconciliation === null ||
      previous.pendingTerminalReconciliationSessionFingerprintSha256 !==
        next.pendingTerminalReconciliationSessionFingerprintSha256) &&
    next.pendingTerminalReconciliation !== null &&
    next.pendingTerminalReconciliationSessionFingerprintSha256 !== null &&
    (previous.pendingTerminalReconciliation === null ||
      previous.pendingTerminalReconciliation.recoveryId !==
        next.pendingTerminalReconciliation.recoveryId) &&
    isDeepStrictEqual(previous.history, next.history) &&
    isDeepStrictEqual(previous.recoveryAcks, next.recoveryAcks) &&
    isDeepStrictEqual(
      previous.historyTransitionReconciliationAcks,
      next.historyTransitionReconciliationAcks,
    ) &&
    isDeepStrictEqual(previous.terminalReconciliationAcks, next.terminalReconciliationAcks) &&
    sameDeliveryIdentity(next.execution, next.pendingTerminalReconciliation) &&
    next.pendingTerminalReconciliation.recoveryRequestedAt === next.execution.updatedAt &&
    Date.parse(next.execution.updatedAt) >= Date.parse(previous.execution.updatedAt);
  const terminalReconciliationAck = next.terminalReconciliationAcks.at(-1);
  const terminalReconciled =
    sameExecutionIdentity &&
    previous.pendingTerminalReconciliation !== null &&
    next.pendingTerminalReconciliation === null &&
    previous.pendingTerminalReconciliationSessionFingerprintSha256 !== null &&
    next.pendingTerminalReconciliationSessionFingerprintSha256 === null &&
    previous.pendingRecovery === null &&
    next.pendingRecovery === null &&
    previous.pendingRecoverySessionFingerprintSha256 === null &&
    next.pendingRecoverySessionFingerprintSha256 === null &&
    isDeepStrictEqual(previous.recoveryAcks, next.recoveryAcks) &&
    isDeepStrictEqual(
      previous.historyTransitionReconciliationAcks,
      next.historyTransitionReconciliationAcks,
    ) &&
    next.sessionFingerprintSha256 ===
      previous.pendingTerminalReconciliationSessionFingerprintSha256 &&
    next.terminalReconciliationAcks.length === previous.terminalReconciliationAcks.length + 1 &&
    isDeepStrictEqual(
      next.terminalReconciliationAcks.slice(0, previous.terminalReconciliationAcks.length),
      previous.terminalReconciliationAcks,
    ) &&
    terminalReconciliationAck !== undefined &&
    companionShortcutProofTerminalReconciliationAckMatchesDelivery(
      terminalReconciliationAck,
      previous.pendingTerminalReconciliation,
    ) &&
    next.execution.result !== undefined &&
    isDeepStrictEqual(next.execution.result, terminalReconciliationAck.result) &&
    next.execution.updatedAt === terminalReconciliationAck.occurredAt &&
    (next.phase === 'succeeded' || next.phase === 'failed_checkpointed') &&
    isDeepStrictEqual(next.history, historyFromTerminalResult(terminalReconciliationAck.result)) &&
    isDeepStrictEqual(
      next.progressReceiptChainHeads,
      terminalReceiptChainHeads(terminalReconciliationAck.result),
    ) &&
    isDeepStrictEqual(
      next.progressReceiptChainHeads.slice(0, previous.progressReceiptChainHeads.length),
      previous.progressReceiptChainHeads,
    );
  if (
    recoveryOffered ||
    recoveryAccepted ||
    historyTransitionReconciled ||
    terminalReconciliationOffered ||
    terminalReconciled
  ) {
    if (terminalReconciled) return;
    if (!isDeepStrictEqual(previous.progressReceiptChainHeads, next.progressReceiptChainHeads)) {
      throw new Error(`Shortcut proof ${next.execution.requestId} changed its receipt SHA chain`);
    }
    return;
  }
  if (
    !sameExecutionIdentity ||
    previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256
  ) {
    throw new Error(`Shortcut proof ${next.execution.requestId} changed immutable authority`);
  }
  const establishesDelivery =
    previous.phase === 'queued' &&
    next.phase === 'dispatched' &&
    previous.execution.deliveryId === undefined &&
    previous.execution.dispatchedAt === undefined &&
    next.execution.deliveryId !== undefined &&
    next.execution.dispatchedAt !== undefined;
  const preservesDelivery =
    previous.execution.deliveryId === next.execution.deliveryId &&
    previous.execution.dispatchedAt === next.execution.dispatchedAt;
  if (!establishesDelivery && !preservesDelivery) {
    throw new Error(`Shortcut proof ${next.execution.requestId} changed immutable delivery`);
  }
  if (
    previous.pendingRecovery !== null ||
    next.pendingRecovery !== null ||
    previous.pendingRecoverySessionFingerprintSha256 !== null ||
    next.pendingRecoverySessionFingerprintSha256 !== null ||
    !isDeepStrictEqual(previous.recoveryAcks, next.recoveryAcks) ||
    !isDeepStrictEqual(
      previous.historyTransitionReconciliationAcks,
      next.historyTransitionReconciliationAcks,
    ) ||
    previous.pendingTerminalReconciliation !== null ||
    next.pendingTerminalReconciliation !== null ||
    previous.pendingTerminalReconciliationSessionFingerprintSha256 !== null ||
    next.pendingTerminalReconciliationSessionFingerprintSha256 !== null ||
    !isDeepStrictEqual(previous.terminalReconciliationAcks, next.terminalReconciliationAcks)
  ) {
    throw new Error(`Shortcut proof ${next.execution.requestId} changed recovery authority`);
  }
  if (!expectedTransition(previous.phase, next.phase)) {
    throw new Error(
      `Shortcut proof ${next.execution.requestId} has invalid transition ${previous.phase}->${next.phase}`,
    );
  }
  if (next.phase === 'restored' || next.phase === 'reapplied_locked') {
    const previousUndo = undoIdentity(previous.execution);
    const nextUndo = undoIdentity(next.execution);
    if (previousUndo === null || !isDeepStrictEqual(previousUndo, nextUndo)) {
      throw new Error(
        `Shortcut proof ${next.execution.requestId} changed its native Undo identity`,
      );
    }
  }
  const addsProgress = next.phase.startsWith('progress_');
  const expectedHeadCount = addsProgress
    ? previous.progressReceiptChainHeads.length + 1
    : previous.progressReceiptChainHeads.length;
  if (
    next.progressReceiptChainHeads.length !== expectedHeadCount ||
    !isDeepStrictEqual(
      next.progressReceiptChainHeads.slice(0, previous.progressReceiptChainHeads.length),
      previous.progressReceiptChainHeads,
    )
  ) {
    throw new Error(`Shortcut proof ${next.execution.requestId} changed its receipt SHA chain`);
  }
}

export function createBlenderShortcutProofExecutionCoordinator(
  options: BlenderShortcutProofExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredShortcutProof>();

  for (const event of options.database.listExecutionEventsByTypes(shortcutProofEventTypes)) {
    const parsed = storedShortcutProofEventSchema.parse(event.payload);
    const previous = executions.get(parsed.execution.requestId);
    assertStoredTransition(previous, parsed);
    executions.set(parsed.execution.requestId, parsed);
  }

  const append = (
    eventType: (typeof shortcutProofEventTypes)[number],
    stored: StoredShortcutProof,
  ): CompanionShortcutProofStatus => {
    const parsed = storedShortcutProofEventSchema.parse(stored);
    const previous = executions.get(parsed.execution.requestId);
    assertStoredTransition(previous, parsed);
    const recoveryIdentity =
      eventType === 'blender.shortcut-proof.history-recovery-offered'
        ? parsed.pendingRecovery?.recoveryId
        : eventType === 'blender.shortcut-proof.history-rebound'
          ? parsed.recoveryAcks.at(-1)?.recoveryId
          : eventType === 'blender.shortcut-proof.history-transition-reconciled'
            ? parsed.historyTransitionReconciliationAcks.at(-1)?.recoveryId
            : eventType === 'blender.shortcut-proof.terminal-reconciliation-offered'
              ? parsed.pendingTerminalReconciliation?.recoveryId
              : eventType === 'blender.shortcut-proof.terminal-reconciled'
                ? parsed.terminalReconciliationAcks.at(-1)?.recoveryId
                : undefined;
    options.database.appendEvent({
      id:
        recoveryIdentity !== undefined
          ? `blender-shortcut-proof:${parsed.execution.requestId}:${eventType}:${recoveryIdentity}`
          : parsed.phase === 'restored' || parsed.phase === 'reapplied_locked'
            ? `blender-shortcut-proof:${parsed.execution.requestId}:${parsed.phase}:${parsed.execution.updatedAt}`
            : `blender-shortcut-proof:${parsed.execution.requestId}:${parsed.phase}`,
      eventType,
      payload: parsed,
      createdAt: parsed.execution.updatedAt,
    });
    executions.set(parsed.execution.requestId, parsed);
    return parsed.execution;
  };

  for (const stored of [...executions.values()]) {
    if (
      stored.pendingTerminalReconciliation !== null ||
      stored.phase === 'queued' ||
      stored.phase === 'succeeded' ||
      stored.phase === 'failed_checkpointed' ||
      stored.phase === 'failed_restored' ||
      stored.phase === 'rejected' ||
      stored.phase === 'restored' ||
      stored.phase === 'reapplied_locked' ||
      stored.phase === 'recovery_required'
    ) {
      continue;
    }
    const recoveredAt = now();
    append('blender.shortcut-proof.recovery-required', {
      ...stored,
      phase: 'recovery_required',
      execution: companionShortcutProofStatusSchema.parse({
        ...stored.execution,
        status: 'recovery_required',
        progress: undefined,
        updatedAt: recoveredAt,
      }),
    });
  }

  const get = (requestId: string): CompanionShortcutProofStatus | null =>
    executions.get(requestId)?.execution ?? null;

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    [...executions.values()].some(
      ({ execution, phase }) =>
        execution.target.adapterId === adapterId &&
        execution.target.instanceId === instanceId &&
        (phase === 'queued' ||
          phase === 'dispatched' ||
          phase.startsWith('progress_') ||
          phase === 'succeeded' ||
          phase === 'failed_checkpointed' ||
          phase === 'reapplied_locked' ||
          (phase === 'recovery_required' && execution.deliveryId !== undefined)),
    );

  const findForCreate = (
    input: CompanionShortcutProofCreateRequest,
  ): CompanionShortcutProofStatus | null => {
    const request = companionShortcutProofCreateRequestSchema.parse(input);
    const existing = executions.get(request.requestId)?.execution;
    if (existing === undefined) return null;
    if (!sameCreateRequest(existing, request)) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_request_conflict',
        409,
        'The requestId is already bound to a different shortcut proof request',
      );
    }
    return existing;
  };

  const queue = (
    input: CompanionShortcutProofStatus,
    sessionFingerprintSha256: string,
  ): CompanionShortcutProofStatus => {
    const execution = companionShortcutProofStatusSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    if (execution.status !== 'queued') {
      throw new Error('Only a queued shortcut proof can enter the coordinator');
    }
    const existing = findForCreate({
      formatVersion: execution.formatVersion,
      requestId: execution.requestId,
      replayId: execution.replayId,
      expectedState: execution.expectedState,
    });
    if (existing !== null) return existing;
    const conflicting = [...executions.values()].find(
      ({ execution: candidate, phase }) =>
        candidate.target.adapterId === execution.target.adapterId &&
        candidate.target.instanceId === execution.target.instanceId &&
        (phase === 'queued' ||
          phase === 'dispatched' ||
          phase.startsWith('progress_') ||
          phase === 'succeeded' ||
          phase === 'failed_checkpointed' ||
          phase === 'reapplied_locked' ||
          (phase === 'recovery_required' && candidate.deliveryId !== undefined)),
    );
    if (conflicting !== undefined) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_in_progress',
        409,
        `Shortcut proof ${conflicting.execution.requestId} still owns the target instance`,
      );
    }
    return append('blender.shortcut-proof.queued', {
      execution,
      phase: 'queued',
      sessionFingerprintSha256: fingerprint,
      progressReceiptChainHeads: [],
      history: null,
      pendingRecovery: null,
      pendingRecoverySessionFingerprintSha256: null,
      recoveryAcks: [],
      historyTransitionReconciliationAcks: [],
      pendingTerminalReconciliation: null,
      pendingTerminalReconciliationSessionFingerprintSha256: null,
      terminalReconciliationAcks: [],
    });
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
  ): CompanionShortcutProofDelivery | null => {
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const pending = [...executions.values()]
      .filter(
        ({ phase, execution }) =>
          phase === 'queued' &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId,
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (pending === undefined) return null;
    const dispatchedAt = now();
    if (pending.sessionFingerprintSha256 !== fingerprint) {
      append('blender.shortcut-proof.recovery-required', {
        ...pending,
        phase: 'recovery_required',
        execution: companionShortcutProofStatusSchema.parse({
          ...pending.execution,
          status: 'recovery_required',
          updatedAt: dispatchedAt,
        }),
      });
      return null;
    }
    const delivery = companionShortcutProofDeliverySchema.parse({
      formatVersion: pending.execution.formatVersion,
      requestId: pending.execution.requestId,
      replayId: pending.execution.replayId,
      proofId: pending.execution.proofId,
      deliveryId: createId(),
      target: pending.execution.target,
      targetProfile: pending.execution.targetProfile,
      proposalId: pending.execution.proposalId,
      plan: pending.execution.plan,
      executionId: pending.execution.executionId,
      leafId: pending.execution.leafId,
      interactionCatalogVersion: pending.execution.interactionCatalogVersion,
      interactionCatalogContentSha256: pending.execution.interactionCatalogContentSha256,
      shortcutTrackContentSha256: pending.execution.shortcutTrackContentSha256,
      bindingContentSha256: pending.execution.bindingContentSha256,
      binding: pending.execution.binding,
      executorId: pending.execution.executorId,
      executionBoundary: pending.execution.executionBoundary,
      authorization: pending.execution.authorization,
      transport: pending.execution.transport,
      operationIds: pending.execution.operationIds,
      expectedState: pending.execution.expectedState,
      requestedAt: pending.execution.requestedAt,
      dispatchedAt,
    });
    append('blender.shortcut-proof.dispatched', {
      ...pending,
      phase: 'dispatched',
      execution: companionShortcutProofStatusSchema.parse({
        ...pending.execution,
        deliveryId: delivery.deliveryId,
        dispatchedAt,
        status: 'dispatched',
        updatedAt: dispatchedAt,
      }),
    });
    return delivery;
  };

  const assertDelivery = (
    evidence: CompanionShortcutProofProgress | CompanionShortcutProofResult,
    fingerprint: string,
  ): StoredShortcutProof => {
    const stored = executions.get(evidence.requestId);
    if (stored === undefined) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_not_found',
        404,
        'The shortcut proof request was not found',
      );
    }
    if (stored.pendingRecovery !== null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_rebind_pending',
        409,
        'Shortcut proof evidence is blocked until native history is rebound to this Companion session',
      );
    }
    if (stored.pendingTerminalReconciliation !== null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_terminal_reconciliation_pending',
        409,
        'Shortcut proof evidence is blocked while native terminal reconciliation is pending',
      );
    }
    if (
      stored.sessionFingerprintSha256 !== fingerprint ||
      !sameDeliveryIdentity(stored.execution, evidence)
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_delivery_identity_mismatch',
        409,
        'The shortcut proof evidence does not match its accepted delivery and Companion session',
      );
    }
    assertEvidenceTiming(stored, evidence);
    return stored;
  };

  const progress = (
    input: CompanionShortcutProofProgress,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const evidence = companionShortcutProofProgressSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const stored = assertDelivery(evidence, fingerprint);
    const nextIndex = stored.progressReceiptChainHeads.length;
    if (
      stored.phase === `progress_${evidence.completedOperationIds.length - 1}` &&
      isDeepStrictEqual(stored.execution.progress, evidence)
    ) {
      return 'duplicate';
    }
    if (
      (stored.phase !== 'dispatched' && !stored.phase.startsWith('progress_')) ||
      evidence.completedOperationIds.length !== nextIndex + 1
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_progress_conflict',
        409,
        'Shortcut proof progress must report exactly the next operation',
      );
    }
    if (stored.progressReceiptChainHeads.includes(evidence.receiptChainHeadSha256)) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_receipt_chain_conflict',
        409,
        'Shortcut proof progress must advance to a new receipt chain head',
      );
    }
    const phase = `progress_${nextIndex}` as ShortcutProofPhase;
    const occurredAt = evidence.occurredAt;
    append(
      `blender.shortcut-proof.progress-${nextIndex}` as (typeof shortcutProofEventTypes)[number],
      {
        ...stored,
        phase,
        progressReceiptChainHeads: [
          ...stored.progressReceiptChainHeads,
          evidence.receiptChainHeadSha256,
        ],
        execution: companionShortcutProofStatusSchema.parse({
          ...stored.execution,
          status: 'in_progress',
          progress: evidence,
          updatedAt: occurredAt,
        }),
      },
    );
    return 'accepted';
  };

  const complete = (
    input: CompanionShortcutProofResult,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const result = companionShortcutProofResultSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const stored = assertDelivery(result, fingerprint);
    const terminalPhase =
      stored.phase === 'succeeded' ||
      stored.phase === 'failed_checkpointed' ||
      stored.phase === 'failed_restored' ||
      stored.phase === 'rejected' ||
      stored.phase === 'restored' ||
      stored.phase === 'reapplied_locked';
    const allowedTerminalTransition =
      result.status === 'restored' &&
      (stored.phase === 'succeeded' ||
        stored.phase === 'failed_checkpointed' ||
        stored.phase === 'reapplied_locked')
        ? true
        : result.status === 'reapplied_locked' && stored.phase === 'restored';
    if (terminalPhase && !allowedTerminalTransition) {
      if (isDeepStrictEqual(stored.execution.result, result)) return 'duplicate';
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_result_conflict',
        409,
        'The shortcut proof already has a different terminal result',
      );
    }
    if (stored.phase === 'recovery_required') {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_not_completable',
        409,
        'The shortcut proof became indeterminate after restart and cannot be completed automatically',
      );
    }
    if (result.status === 'restored') {
      if (
        stored.phase !== 'succeeded' &&
        stored.phase !== 'failed_checkpointed' &&
        stored.phase !== 'reapplied_locked'
      ) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_not_restorable',
          409,
          'Only a locked shortcut proof can be restored',
        );
      }
      const history = stored.history;
      if (
        history === null ||
        result.terminalEvidence.kind !== 'restored' ||
        result.terminalEvidence.sourceCheckpointId !== history.checkpointId ||
        result.terminalEvidence.undoLockId !== history.undoLockId ||
        result.terminalEvidence.baselineSceneFingerprintSha256 !==
          history.baselineSceneFingerprintSha256 ||
        result.terminalEvidence.lockedSceneFingerprintSha256 !==
          history.lockedSceneFingerprintSha256
      ) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_restore_identity_mismatch',
          409,
          'The restore result does not release the exact retained shortcut proof Undo lock',
        );
      }
      append('blender.shortcut-proof.restored', {
        ...stored,
        phase: 'restored',
        execution: companionShortcutProofStatusSchema.parse({
          ...stored.execution,
          status: 'restored',
          progress: undefined,
          result,
          updatedAt: result.occurredAt,
        }),
      });
      return 'accepted';
    }
    if (result.status === 'reapplied_locked') {
      const restoredEvidence = stored.execution.result?.terminalEvidence;
      const history = stored.history;
      if (
        stored.phase !== 'restored' ||
        history === null ||
        restoredEvidence?.kind !== 'restored' ||
        result.terminalEvidence.kind !== 'reapplied_locked' ||
        result.terminalEvidence.sourceCheckpointId !== history.checkpointId ||
        result.terminalEvidence.undoLockId !== history.undoLockId ||
        result.terminalEvidence.baselineSceneFingerprintSha256 !==
          history.baselineSceneFingerprintSha256 ||
        result.terminalEvidence.lockedSceneFingerprintSha256 !==
          history.lockedSceneFingerprintSha256
      ) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_reapply_identity_mismatch',
          409,
          'The reapply result does not reacquire the exact shortcut proof Undo lock',
        );
      }
      append('blender.shortcut-proof.reapplied-locked', {
        ...stored,
        phase: 'reapplied_locked',
        execution: companionShortcutProofStatusSchema.parse({
          ...stored.execution,
          status: 'reapplied_locked',
          progress: undefined,
          result,
          updatedAt: result.occurredAt,
        }),
      });
      return 'accepted';
    }
    if (result.status === 'rejected') {
      if (stored.phase !== 'dispatched') {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_rejection_too_late',
          409,
          'A shortcut proof may be rejected only during preflight before mutation',
        );
      }
      append('blender.shortcut-proof.rejected', {
        ...stored,
        phase: 'rejected',
        execution: companionShortcutProofStatusSchema.parse({
          ...stored.execution,
          status: 'rejected',
          result,
          updatedAt: result.occurredAt,
        }),
      });
      return 'accepted';
    }
    if (result.status === 'failed_checkpointed' || result.status === 'failed_restored') {
      if (stored.phase !== 'dispatched' && !stored.phase.startsWith('progress_')) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_failure_without_mutation',
          409,
          'A failed shortcut proof must follow dispatch and mutation evidence',
        );
      }
      const failureEvidence = result.terminalEvidence;
      if (
        (result.status === 'failed_checkpointed' &&
          failureEvidence.kind !== 'failed_checkpointed') ||
        (result.status === 'failed_restored' && failureEvidence.kind !== 'failed_restored') ||
        (failureEvidence.kind !== 'failed_checkpointed' &&
          failureEvidence.kind !== 'failed_restored')
      ) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_failure_evidence_invalid',
          409,
          'A shortcut proof failure requires matching terminal evidence',
        );
      }
      const failedHeads = failureEvidence.receiptPrefix.map((receipt) => receipt.contentSha256);
      if (!isDeepStrictEqual(stored.progressReceiptChainHeads, failedHeads)) {
        throw new BlenderShortcutProofExecutionError(
          'shortcut_proof_receipt_chain_conflict',
          409,
          'The failure does not match the dispatched progress receipt SHA chain',
        );
      }
      const failedCheckpointed = result.status === 'failed_checkpointed';
      append(
        failedCheckpointed
          ? 'blender.shortcut-proof.failed-checkpointed'
          : 'blender.shortcut-proof.failed-restored',
        {
          ...stored,
          phase: failedCheckpointed ? 'failed_checkpointed' : 'failed_restored',
          history: failedCheckpointed ? historyFromTerminalResult(result) : null,
          execution: companionShortcutProofStatusSchema.parse({
            ...stored.execution,
            status: result.status,
            result,
            updatedAt: result.occurredAt,
          }),
        },
      );
      return 'accepted';
    }
    if (stored.phase !== 'progress_3' || stored.progressReceiptChainHeads.length !== 4) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_progress_incomplete',
        409,
        'A successful shortcut proof requires all four progress receipts',
      );
    }
    if (result.terminalEvidence.kind !== 'succeeded_locked') {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_success_evidence_invalid',
        409,
        'A successful shortcut proof requires a locked success attestation',
      );
    }
    const attestation = result.terminalEvidence.attestation;
    const attestationHeads = attestation.operationReceipts.map((receipt) => receipt.contentSha256);
    if (!isDeepStrictEqual(stored.progressReceiptChainHeads, attestationHeads)) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_receipt_chain_conflict',
        409,
        'The terminal attestation does not match the dispatched progress receipt SHA chain',
      );
    }
    append('blender.shortcut-proof.completed', {
      ...stored,
      phase: 'succeeded',
      history: historyFromTerminalResult(result),
      execution: companionShortcutProofStatusSchema.parse({
        ...stored.execution,
        status: 'succeeded',
        progress: undefined,
        result,
        updatedAt: result.occurredAt,
      }),
    });
    return 'accepted';
  };

  const pollHistoryRecovery = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
  ): CompanionShortcutProofRecoveryDelivery | null => {
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const locked = [...executions.values()]
      .filter(
        ({ execution, history, phase, sessionFingerprintSha256: acceptedFingerprint }) =>
          hasRetainedHistoryPhase(phase) &&
          history !== null &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId &&
          acceptedFingerprint !== fingerprint,
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (locked === undefined || locked.history === null || locked.execution.result === undefined) {
      return null;
    }
    if (
      locked.pendingRecovery !== null &&
      locked.pendingRecoverySessionFingerprintSha256 === fingerprint
    ) {
      return locked.pendingRecovery;
    }
    const recoveryRequestedAt = now();
    const recovery = companionShortcutProofRecoveryDeliverySchema.parse({
      formatVersion: locked.execution.formatVersion,
      requestId: locked.execution.requestId,
      replayId: locked.execution.replayId,
      proofId: locked.execution.proofId,
      deliveryId: locked.execution.deliveryId,
      target: locked.execution.target,
      targetProfile: locked.execution.targetProfile,
      proposalId: locked.execution.proposalId,
      plan: locked.execution.plan,
      executionId: locked.execution.executionId,
      leafId: locked.execution.leafId,
      interactionCatalogVersion: locked.execution.interactionCatalogVersion,
      interactionCatalogContentSha256: locked.execution.interactionCatalogContentSha256,
      shortcutTrackContentSha256: locked.execution.shortcutTrackContentSha256,
      bindingContentSha256: locked.execution.bindingContentSha256,
      binding: locked.execution.binding,
      executorId: locked.execution.executorId,
      executionBoundary: locked.execution.executionBoundary,
      authorization: locked.execution.authorization,
      transport: locked.execution.transport,
      operationIds: locked.execution.operationIds,
      expectedState: locked.execution.expectedState,
      requestedAt: locked.execution.requestedAt,
      dispatchedAt: locked.execution.dispatchedAt,
      kind: 'native_history_rebind',
      recoveryId: createId(),
      history: locked.history,
      expectedStatus: locked.phase,
      expectedResultContentSha256: computeCompanionShortcutProofResultContentSha256(
        locked.execution.result,
      ),
      expectedMarkerContentSha256: recoveryMarkerContentSha256(locked.execution, locked.history),
      recoveryRequestedAt,
    });
    append('blender.shortcut-proof.history-recovery-offered', {
      ...locked,
      pendingRecovery: recovery,
      pendingRecoverySessionFingerprintSha256: fingerprint,
      execution: companionShortcutProofStatusSchema.parse({
        ...locked.execution,
        updatedAt: recoveryRequestedAt,
      }),
    });
    return recovery;
  };

  const pollTerminalReconciliation = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
  ): CompanionShortcutProofTerminalReconciliationDelivery | null => {
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const indeterminate = [...executions.values()]
      .filter(
        ({ execution, phase, sessionFingerprintSha256: acceptedFingerprint }) =>
          execution.deliveryId !== undefined &&
          execution.dispatchedAt !== undefined &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId &&
          acceptedFingerprint !== fingerprint &&
          (phase === 'dispatched' ||
            phase.startsWith('progress_') ||
            phase === 'recovery_required'),
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (indeterminate === undefined) return null;
    if (
      indeterminate.pendingTerminalReconciliation !== null &&
      indeterminate.pendingTerminalReconciliationSessionFingerprintSha256 === fingerprint
    ) {
      return indeterminate.pendingTerminalReconciliation;
    }
    const recoveryRequestedAt = now();
    const recovery = companionShortcutProofTerminalReconciliationDeliverySchema.parse({
      formatVersion: indeterminate.execution.formatVersion,
      requestId: indeterminate.execution.requestId,
      replayId: indeterminate.execution.replayId,
      proofId: indeterminate.execution.proofId,
      deliveryId: indeterminate.execution.deliveryId,
      target: indeterminate.execution.target,
      targetProfile: indeterminate.execution.targetProfile,
      proposalId: indeterminate.execution.proposalId,
      plan: indeterminate.execution.plan,
      executionId: indeterminate.execution.executionId,
      leafId: indeterminate.execution.leafId,
      interactionCatalogVersion: indeterminate.execution.interactionCatalogVersion,
      interactionCatalogContentSha256: indeterminate.execution.interactionCatalogContentSha256,
      shortcutTrackContentSha256: indeterminate.execution.shortcutTrackContentSha256,
      bindingContentSha256: indeterminate.execution.bindingContentSha256,
      binding: indeterminate.execution.binding,
      executorId: indeterminate.execution.executorId,
      executionBoundary: indeterminate.execution.executionBoundary,
      authorization: indeterminate.execution.authorization,
      transport: indeterminate.execution.transport,
      operationIds: indeterminate.execution.operationIds,
      expectedState: indeterminate.execution.expectedState,
      requestedAt: indeterminate.execution.requestedAt,
      dispatchedAt: indeterminate.execution.dispatchedAt,
      kind: 'native_terminal_reconcile',
      recoveryId: createId(),
      acknowledgedProgressReceiptChainHeads: indeterminate.progressReceiptChainHeads,
      recoveryRequestedAt,
    });
    append('blender.shortcut-proof.terminal-reconciliation-offered', {
      ...indeterminate,
      pendingTerminalReconciliation: recovery,
      pendingTerminalReconciliationSessionFingerprintSha256: fingerprint,
      execution: companionShortcutProofStatusSchema.parse({
        ...indeterminate.execution,
        updatedAt: recoveryRequestedAt,
      }),
    });
    return recovery;
  };

  const reconcileTerminal = (
    input: CompanionShortcutProofTerminalReconciliationAck,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const ack = companionShortcutProofTerminalReconciliationAckSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const stored = executions.get(ack.result.requestId);
    if (stored === undefined) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_not_found',
        404,
        'The shortcut proof request was not found',
      );
    }
    const acceptedAck = stored.terminalReconciliationAcks.at(-1);
    if (
      stored.pendingTerminalReconciliation === null &&
      stored.sessionFingerprintSha256 === fingerprint &&
      acceptedAck !== undefined &&
      isDeepStrictEqual(acceptedAck, ack) &&
      isDeepStrictEqual(stored.execution.result, ack.result)
    ) {
      return 'duplicate';
    }
    if (stored.phase === 'succeeded' || stored.phase === 'failed_checkpointed') {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_result_conflict',
        409,
        'The shortcut proof already has a different terminal result',
      );
    }
    const recovery = stored.pendingTerminalReconciliation;
    if (recovery === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_terminal_reconciliation_not_offered',
        409,
        'The shortcut proof has no pending native terminal reconciliation challenge',
      );
    }
    if (
      stored.sessionFingerprintSha256 === fingerprint ||
      stored.pendingTerminalReconciliationSessionFingerprintSha256 !== fingerprint ||
      !companionShortcutProofTerminalReconciliationAckMatchesDelivery(ack, recovery)
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_terminal_reconciliation_identity_mismatch',
        409,
        'The native terminal result does not match its immutable delivery or replacement Companion session',
      );
    }
    const terminalHeads = terminalReceiptChainHeads(ack.result);
    if (
      terminalHeads.length < stored.progressReceiptChainHeads.length ||
      !isDeepStrictEqual(
        terminalHeads.slice(0, stored.progressReceiptChainHeads.length),
        stored.progressReceiptChainHeads,
      )
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_receipt_chain_conflict',
        409,
        'The reconciled terminal receipt chain does not extend the exact server-acknowledged prefix',
      );
    }
    const terminalPhase = ack.result.status === 'succeeded' ? 'succeeded' : 'failed_checkpointed';
    append('blender.shortcut-proof.terminal-reconciled', {
      ...stored,
      phase: terminalPhase,
      sessionFingerprintSha256: fingerprint,
      progressReceiptChainHeads: [...terminalHeads],
      history: historyFromTerminalResult(ack.result),
      pendingTerminalReconciliation: null,
      pendingTerminalReconciliationSessionFingerprintSha256: null,
      terminalReconciliationAcks: [...stored.terminalReconciliationAcks, ack],
      execution: companionShortcutProofStatusSchema.parse({
        ...stored.execution,
        status: ack.result.status,
        progress: undefined,
        result: ack.result,
        updatedAt: ack.occurredAt,
      }),
    });
    return 'accepted';
  };

  const recoverHistory = (
    input: CompanionShortcutProofRecoveryAck,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const ack = companionShortcutProofRecoveryAckSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const stored = executions.get(ack.requestId);
    if (stored === undefined) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_not_found',
        404,
        'The shortcut proof request was not found',
      );
    }
    const lastAck = stored.recoveryAcks.at(-1);
    if (
      stored.pendingRecovery === null &&
      stored.sessionFingerprintSha256 === fingerprint &&
      lastAck !== undefined &&
      isDeepStrictEqual(lastAck, ack)
    ) {
      return 'duplicate';
    }
    if (!hasRetainedHistoryPhase(stored.phase) || stored.history === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_not_locked',
        409,
        'Only a shortcut proof with retained native history can be rebound',
      );
    }
    if (stored.pendingRecovery === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_rebind_not_offered',
        409,
        'The shortcut proof has no pending native history recovery delivery',
      );
    }
    if (
      stored.pendingRecoverySessionFingerprintSha256 !== fingerprint ||
      !companionShortcutProofRecoveryAckMatchesDelivery(ack, stored.pendingRecovery)
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_rebind_identity_mismatch',
        409,
        'The native history acknowledgement does not match its recovery delivery and replacement Companion session',
      );
    }
    if (stored.recoveryAcks.length >= 32) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_rebind_limit_reached',
        409,
        'The shortcut proof exhausted its retained recovery acknowledgement history',
      );
    }
    append('blender.shortcut-proof.history-rebound', {
      ...stored,
      sessionFingerprintSha256: fingerprint,
      pendingRecovery: null,
      pendingRecoverySessionFingerprintSha256: null,
      recoveryAcks: [...stored.recoveryAcks, ack],
      execution: companionShortcutProofStatusSchema.parse({
        ...stored.execution,
        updatedAt: ack.occurredAt,
      }),
    });
    return 'accepted';
  };

  const reconcileHistoryTransitions = (
    input: CompanionShortcutProofHistoryTransitionReconciliationAck,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const ack = companionShortcutProofHistoryTransitionReconciliationAckSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const requestId = ack.results[0]!.requestId;
    const stored = executions.get(requestId);
    if (stored === undefined) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_not_found',
        404,
        'The shortcut proof request was not found',
      );
    }
    const lastAck = stored.historyTransitionReconciliationAcks.at(-1);
    if (
      stored.pendingRecovery === null &&
      stored.sessionFingerprintSha256 === fingerprint &&
      lastAck !== undefined &&
      isDeepStrictEqual(lastAck, ack)
    ) {
      return 'duplicate';
    }
    if (!hasRetainedHistoryPhase(stored.phase) || stored.history === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_not_retained',
        409,
        'Only a shortcut proof with retained native history can reconcile Undo and Redo',
      );
    }
    const recovery = stored.pendingRecovery;
    if (recovery === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_rebind_not_offered',
        409,
        'The shortcut proof has no pending native history recovery delivery',
      );
    }
    if (
      stored.pendingRecoverySessionFingerprintSha256 !== fingerprint ||
      !companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery(ack, recovery)
    ) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_transition_identity_mismatch',
        409,
        'The native history transitions do not match the retained history recovery delivery',
      );
    }
    const reconciled = reconcileHistoryTransitionResults(stored, ack);
    if (reconciled === null) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_transition_conflict',
        409,
        'The native history transitions do not strictly continue the current server phase',
      );
    }
    if (stored.historyTransitionReconciliationAcks.length >= 32) {
      throw new BlenderShortcutProofExecutionError(
        'shortcut_proof_history_transition_limit_reached',
        409,
        'The shortcut proof exhausted its retained transition reconciliation history',
      );
    }
    append('blender.shortcut-proof.history-transition-reconciled', {
      ...stored,
      phase: reconciled.phase,
      sessionFingerprintSha256: fingerprint,
      pendingRecovery: null,
      pendingRecoverySessionFingerprintSha256: null,
      historyTransitionReconciliationAcks: [...stored.historyTransitionReconciliationAcks, ack],
      execution: companionShortcutProofStatusSchema.parse({
        ...stored.execution,
        status: reconciled.phase,
        progress: undefined,
        result: reconciled.result,
        updatedAt: ack.occurredAt,
      }),
    });
    return 'accepted';
  };

  return {
    complete,
    findForCreate,
    get,
    ownsTarget,
    poll,
    pollHistoryRecovery,
    pollTerminalReconciliation,
    progress,
    queue,
    reconcileHistoryTransitions,
    reconcileTerminal,
    recoverHistory,
  };
}

export type BlenderShortcutProofExecutionCoordinator = ReturnType<
  typeof createBlenderShortcutProofExecutionCoordinator
>;
