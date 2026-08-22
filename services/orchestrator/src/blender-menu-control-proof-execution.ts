import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionMenuControlProofCreateRequestSchema,
  companionMenuControlProofDeliverySchema,
  companionMenuControlProofExecutionWindowMs,
  companionMenuControlProofHistoryIdentityMatchesResult,
  companionMenuControlProofHistoryIdentityMatchesTerminalHistory,
  companionMenuControlProofHistoryIdentitySchema,
  companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery,
  companionMenuControlProofHistoryTransitionReconciliationAckSchema,
  companionMenuControlProofHistoryTransitionReconciliationDeliverySchema,
  companionMenuControlProofHistoryTransitionReportMatchesResult,
  companionMenuControlProofHistoryTransitionReportSchema,
  companionMenuControlProofProgressSchema,
  companionMenuControlProofResultSchema,
  companionMenuControlProofStatusSchema,
  companionMenuControlProofTerminalReconciliationAckMatchesDelivery,
  companionMenuControlProofTerminalReconciliationAckSchema,
  companionMenuControlProofTerminalReconciliationDeliverySchema,
  companionMenuControlProofTerminalHistoryIdentity,
  companionMenuControlProofTerminalHistoryIdentitySchema,
  type CompanionMenuControlProofCreateRequest,
  type CompanionMenuControlProofDelivery,
  type CompanionMenuControlProofHistoryIdentity,
  type CompanionMenuControlProofHistoryTransitionReconciliationAck,
  type CompanionMenuControlProofHistoryTransitionReconciliationDelivery,
  type CompanionMenuControlProofHistoryTransitionReport,
  type CompanionMenuControlProofProgress,
  type CompanionMenuControlProofResult,
  type CompanionMenuControlProofStatus,
  type CompanionMenuControlProofTerminalReconciliationAck,
  type CompanionMenuControlProofTerminalReconciliationDelivery,
} from '@operatingline/protocol';
import { z } from 'zod';

const menuProofEventTypes = [
  'blender.menu-control-proof.queued',
  'blender.menu-control-proof.dispatched',
  'blender.menu-control-proof.progress-0',
  'blender.menu-control-proof.progress-1',
  'blender.menu-control-proof.progress-2',
  'blender.menu-control-proof.progress-3',
  'blender.menu-control-proof.progress-4',
  'blender.menu-control-proof.progress-5',
  'blender.menu-control-proof.progress-6',
  'blender.menu-control-proof.recovery-pending',
  'blender.menu-control-proof.pre-dispatch-authority-expired',
  'blender.menu-control-proof.succeeded',
  'blender.menu-control-proof.failed-no-mutation',
  'blender.menu-control-proof.failed-restored',
  'blender.menu-control-proof.failed-checkpointed',
  'blender.menu-control-proof.recovery-required',
  'blender.menu-control-proof.terminal-reconciled',
  'blender.menu-control-proof.history-transition-reported',
  'blender.menu-control-proof.history-transition-reconciled',
] as const;

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const phaseSchema = z.enum([
  'queued',
  'dispatched',
  'progress_0',
  'progress_1',
  'progress_2',
  'progress_3',
  'progress_4',
  'progress_5',
  'progress_6',
  'recovery_pending',
  'pre_dispatch_authority_expired',
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);
const storedMenuProofEventSchema = z.strictObject({
  execution: companionMenuControlProofStatusSchema,
  phase: phaseSchema,
  sessionAuthoritySha256: contentSha256Schema,
  documentAuthoritySha256: contentSha256Schema,
  progressReceiptChainHeads: z.array(contentSha256Schema).max(7),
  terminalReconciliationAck: companionMenuControlProofTerminalReconciliationAckSchema.optional(),
  historyBoundary: companionMenuControlProofTerminalHistoryIdentitySchema.nullable().default(null),
  history: companionMenuControlProofHistoryIdentitySchema.nullable().default(null),
  historyCursor: z.number().int().min(0).max(8).nullable().default(null),
  historyStatus: z.enum(['history_locked', 'restored']).nullable().default(null),
  historyLease: companionMenuControlProofDeliverySchema.shape.lease.nullable().default(null),
  historyTransitionOccurredAt: z.string().min(1).nullable().default(null),
  historyTransitionReports: z
    .array(companionMenuControlProofHistoryTransitionReportSchema)
    .max(32)
    .default([]),
  historyTransitionContentSha256s: z.array(contentSha256Schema).max(32).default([]),
  historyTransitionReconciliationAcks: z
    .array(companionMenuControlProofHistoryTransitionReconciliationAckSchema)
    .max(32)
    .default([]),
});
const legacyPhaseSchema = z.enum([
  'queued',
  'dispatched',
  'progress_0',
  'progress_1',
  'progress_2',
  'progress_3',
  'progress_4',
  'progress_5',
  'progress_6',
  'recovery_pending',
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);
const legacyStoredMenuProofEventSchema = z
  .strictObject({
    execution: companionMenuControlProofStatusSchema,
    phase: legacyPhaseSchema,
    sessionFingerprintSha256: contentSha256Schema,
    progressReceiptChainHeads: z.array(contentSha256Schema).max(7),
  })
  .superRefine((stored, context) => {
    if (
      stored.execution.recovery !== undefined &&
      stored.execution.recovery.kind !== 'runtime_restart_after_delivery'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['execution', 'recovery', 'kind'],
        message: 'Legacy menu-control proof persistence cannot contain current recovery evidence',
      });
    }
  });

type MenuProofDatabase = Pick<OperatingLineDatabase, 'appendEvent' | 'listExecutionEventsByTypes'>;
type StoredMenuProof = z.infer<typeof storedMenuProofEventSchema>;
type MenuProofPhase = StoredMenuProof['phase'];
type MenuProofEventType = (typeof menuProofEventTypes)[number];

function historyBoundaryFromResult(result: CompanionMenuControlProofResult) {
  return result.status === 'succeeded' || result.status === 'failed_checkpointed'
    ? companionMenuControlProofTerminalHistoryIdentity(result)
    : null;
}

function historyMatchesBoundary(
  history: CompanionMenuControlProofHistoryIdentity,
  boundary: NonNullable<StoredMenuProof['historyBoundary']>,
): boolean {
  return companionMenuControlProofHistoryIdentityMatchesTerminalHistory(history, boundary);
}

function legacyQuarantineAuthoritySha256(
  kind: 'session' | 'document',
  requestId: string,
  legacySessionFingerprintSha256: string,
): string {
  return createHash('sha256')
    .update(`operatingline:blender-menu-control-proof:legacy-${kind}-authority-quarantine:v1\0`)
    .update(requestId)
    .update('\0')
    .update(legacySessionFingerprintSha256)
    .digest('hex');
}

function parseStoredMenuProofEventPayload(payload: unknown): {
  readonly stored: StoredMenuProof;
  readonly legacy: boolean;
} {
  const current = storedMenuProofEventSchema.safeParse(payload);
  if (current.success) {
    const result = current.data.execution.result;
    const boundary = result === undefined ? null : historyBoundaryFromResult(result);
    if (current.data.historyBoundary === null && boundary !== null) {
      return {
        stored: storedMenuProofEventSchema.parse({
          ...current.data,
          historyBoundary: boundary,
          historyCursor: boundary.checkpointKind === 'success' ? 8 : null,
          historyStatus: 'history_locked',
          historyLease: current.data.execution.lease ?? null,
          historyTransitionOccurredAt: result?.occurredAt ?? null,
        }),
        legacy: false,
      };
    }
    return { stored: current.data, legacy: false };
  }
  const legacy = legacyStoredMenuProofEventSchema.parse(payload);
  const requestId = legacy.execution.requestId;
  return {
    stored: storedMenuProofEventSchema.parse({
      execution: legacy.execution,
      phase: legacy.phase,
      sessionAuthoritySha256: legacyQuarantineAuthoritySha256(
        'session',
        requestId,
        legacy.sessionFingerprintSha256,
      ),
      documentAuthoritySha256: legacyQuarantineAuthoritySha256(
        'document',
        requestId,
        legacy.sessionFingerprintSha256,
      ),
      progressReceiptChainHeads: legacy.progressReceiptChainHeads,
      terminalReconciliationAck: undefined,
    }),
    legacy: true,
  };
}

export class BlenderMenuControlProofExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderMenuControlProofExecutionError';
  }
}

export interface BlenderMenuControlProofExecutionCoordinatorOptions {
  readonly database: MenuProofDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly externalHistoryLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

export interface BlenderMenuControlProofPollInput {
  readonly target: CompanionMenuControlProofDelivery['target'];
  readonly documentAuthoritySha256: string;
  readonly lease: CompanionMenuControlProofDelivery['lease'];
}

function sameCreateRequest(
  execution: CompanionMenuControlProofStatus,
  request: CompanionMenuControlProofCreateRequest,
): boolean {
  return (
    execution.formatVersion === request.formatVersion &&
    execution.requestId === request.requestId &&
    execution.replayId === request.replayId &&
    isDeepStrictEqual(execution.expectedState, request.expectedState)
  );
}

function deliveryIdentity(
  value: CompanionMenuControlProofStatus | CompanionMenuControlProofDelivery,
) {
  return {
    formatVersion: value.formatVersion,
    requestId: value.requestId,
    replayId: value.replayId,
    proofId: value.proofId,
    target: value.target,
    targetProfile: value.targetProfile,
    proposalId: value.proposalId,
    proposalRecordContentSha256: value.proposalRecordContentSha256,
    proposalContentSha256: value.proposalContentSha256,
    plan: value.plan,
    executionId: value.executionId,
    leafId: value.leafId,
    packetContentSha256: value.packetContentSha256,
    inputTreeContentSha256: value.inputTreeContentSha256,
    outputTreeContentSha256: value.outputTreeContentSha256,
    materializationContentSha256: value.materializationContentSha256,
    interactionCatalogVersion: value.interactionCatalogVersion,
    interactionCatalogContentSha256: value.interactionCatalogContentSha256,
    menuTrackContentSha256: value.menuTrackContentSha256,
    bindingContentSha256: value.bindingContentSha256,
    binding: value.binding,
    executorId: value.executorId,
    executionBoundary: value.executionBoundary,
    authorization: value.authorization,
    transport: value.transport,
    operationIds: value.operationIds,
    nativeUndoDepth: value.nativeUndoDepth,
    expectedState: value.expectedState,
    startCheckpoint: value.startCheckpoint,
    requestedAt: value.requestedAt,
    deliveryId: value.deliveryId,
    lease: value.lease,
    dispatchedAt: value.dispatchedAt,
  };
}

function sameImmutableExecution(
  left: CompanionMenuControlProofStatus,
  right: CompanionMenuControlProofStatus,
): boolean {
  const leftIdentity = deliveryIdentity(left);
  const rightIdentity = deliveryIdentity(right);
  return isDeepStrictEqual(
    { ...leftIdentity, deliveryId: undefined, lease: undefined, dispatchedAt: undefined },
    { ...rightIdentity, deliveryId: undefined, lease: undefined, dispatchedAt: undefined },
  );
}

function sameDeliveryIdentity(
  execution: CompanionMenuControlProofStatus,
  evidence: CompanionMenuControlProofProgress | CompanionMenuControlProofResult,
): boolean {
  return isDeepStrictEqual(deliveryIdentity(execution), deliveryIdentity(evidence));
}

function isDeliveredNonterminal(stored: StoredMenuProof): boolean {
  return (
    stored.execution.deliveryId !== undefined &&
    (stored.phase === 'dispatched' || stored.phase.startsWith('progress_'))
  );
}

function retainsTargetLock(stored: StoredMenuProof): boolean {
  if (
    (stored.phase === 'succeeded' || stored.phase === 'failed_checkpointed') &&
    stored.historyStatus === 'restored' &&
    stored.historyCursor === 0
  ) {
    return false;
  }
  return (
    stored.phase === 'queued' ||
    stored.phase === 'dispatched' ||
    stored.phase.startsWith('progress_') ||
    stored.phase === 'succeeded' ||
    stored.phase === 'failed_checkpointed' ||
    stored.phase === 'recovery_pending' ||
    (stored.phase === 'recovery_required' && stored.execution.deliveryId !== undefined)
  );
}

function expectedTransition(previous: MenuProofPhase, next: MenuProofPhase): boolean {
  if (previous === 'queued' && next === 'pre_dispatch_authority_expired') {
    return true;
  }
  if (next === 'recovery_pending') {
    return previous === 'dispatched' || previous.startsWith('progress_');
  }
  if (next === 'recovery_required') {
    return previous === 'dispatched' || previous.startsWith('progress_');
  }
  if (previous === 'queued') return next === 'dispatched';
  if (previous === 'dispatched') {
    return (
      next === 'progress_0' ||
      next === 'failed_no_mutation' ||
      next === 'failed_restored' ||
      next === 'failed_checkpointed'
    );
  }
  if (previous.startsWith('progress_')) {
    const index = Number(previous.slice('progress_'.length));
    return (
      (index < 6 && next === `progress_${index + 1}`) ||
      (index === 6 && next === 'succeeded') ||
      next === 'failed_restored' ||
      next === 'failed_checkpointed'
    );
  }
  return false;
}

function eventTypeFor(stored: StoredMenuProof): MenuProofEventType {
  if (stored.phase.startsWith('progress_')) {
    return `blender.menu-control-proof.progress-${stored.phase.slice('progress_'.length)}` as MenuProofEventType;
  }
  const suffix = stored.phase.replaceAll('_', '-');
  return `blender.menu-control-proof.${suffix}` as MenuProofEventType;
}

function eventIdFor(eventType: MenuProofEventType, stored: StoredMenuProof): string {
  const prefix = `blender-menu-control-proof:${stored.execution.requestId}`;
  if (eventType === 'blender.menu-control-proof.terminal-reconciled') {
    const ack = stored.terminalReconciliationAck;
    if (ack === undefined) {
      throw new Error(
        `Menu-control proof ${stored.execution.requestId} is missing its terminal ack`,
      );
    }
    return `${prefix}:terminal-reconciled:${ack.recoveryId}`;
  }
  if (eventType === 'blender.menu-control-proof.history-transition-reported') {
    const report = stored.historyTransitionReports.at(-1);
    if (report === undefined) {
      throw new Error(
        `Menu-control proof ${stored.execution.requestId} is missing its history transition report`,
      );
    }
    return `${prefix}:history-transition:${report.transition.transitionId}`;
  }
  if (eventType === 'blender.menu-control-proof.history-transition-reconciled') {
    const ack = stored.historyTransitionReconciliationAcks.at(-1);
    if (ack === undefined) {
      throw new Error(
        `Menu-control proof ${stored.execution.requestId} is missing its history transition ack`,
      );
    }
    return `${prefix}:history-transition-reconciled:${ack.recoveryId}`;
  }
  const suffix = eventType.slice('blender.menu-control-proof.'.length).replaceAll('-', '_');
  return `${prefix}:${suffix}`;
}

function terminalReceiptChainHeads(result: CompanionMenuControlProofResult): readonly string[] {
  return result.terminalEvidence.kind === 'succeeded_locked'
    ? result.terminalEvidence.operationReceipts.map((receipt) => receipt.contentSha256)
    : result.terminalEvidence.receiptPrefix.map((receipt) => receipt.contentSha256);
}

function sameLeaseIdentity(
  left: BlenderMenuControlProofPollInput['lease'],
  right: BlenderMenuControlProofPollInput['lease'],
): boolean {
  return (
    left.leaseId === right.leaseId &&
    left.sessionId === right.sessionId &&
    left.documentIncarnationId === right.documentIncarnationId &&
    isDeepStrictEqual(left.target, right.target)
  );
}

function sameDocumentLeaseAuthority(
  left: BlenderMenuControlProofPollInput['lease'],
  right: BlenderMenuControlProofPollInput['lease'],
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.documentIncarnationId === right.documentIncarnationId &&
    isDeepStrictEqual(left.target, right.target)
  );
}

function sameLogicalHistoryTransitionReport(
  left: CompanionMenuControlProofHistoryTransitionReport,
  right: CompanionMenuControlProofHistoryTransitionReport,
): boolean {
  const dynamicKeys = new Set(['currentLease', 'reportedAt']);
  const identity = (value: CompanionMenuControlProofHistoryTransitionReport) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !dynamicKeys.has(key)));
  return isDeepStrictEqual(identity(left), identity(right));
}

function assertPhaseEvidence(stored: StoredMenuProof): void {
  const {
    execution,
    history,
    historyBoundary,
    historyCursor,
    historyStatus,
    phase,
    progressReceiptChainHeads,
  } = stored;
  const expectedStatus = phase.startsWith('progress_') ? 'in_progress' : phase;
  if (execution.status !== expectedStatus) {
    throw new Error(
      `Menu-control proof ${execution.requestId} phase ${phase} does not match status ${execution.status}`,
    );
  }
  if (phase.startsWith('progress_')) {
    const count = Number(phase.slice('progress_'.length)) + 1;
    if (
      progressReceiptChainHeads.length !== count ||
      execution.progress?.operationReceipts.length !== count ||
      execution.progress.receiptChainHeadSha256 !== progressReceiptChainHeads.at(-1) ||
      !isDeepStrictEqual(
        execution.progress.operationReceipts.map((receipt) => receipt.contentSha256),
        progressReceiptChainHeads,
      )
    ) {
      throw new Error(
        `Menu-control proof ${execution.requestId} has inconsistent progress evidence`,
      );
    }
  }
  if ((phase === 'queued' || phase === 'dispatched') && progressReceiptChainHeads.length !== 0) {
    throw new Error(`Menu-control proof ${execution.requestId} has progress before mutation`);
  }
  if (phase === 'pre_dispatch_authority_expired') {
    const expiration = execution.preDispatchAuthorityExpiration;
    if (
      expiration?.kind !== 'document_authority_changed_before_dispatch' ||
      expiration.priorStatus !== 'queued' ||
      expiration.detectedAt !== execution.updatedAt ||
      expiration.automaticReplayAllowed !== false ||
      expiration.retainsTargetLock !== false ||
      execution.deliveryId !== undefined
    ) {
      throw new Error(
        `Menu-control proof ${execution.requestId} has inconsistent pre-dispatch authority expiration evidence`,
      );
    }
  }
  if (phase === 'succeeded') {
    const receipts = execution.result?.terminalEvidence;
    if (
      progressReceiptChainHeads.length !== 7 ||
      receipts?.kind !== 'succeeded_locked' ||
      !isDeepStrictEqual(
        receipts.operationReceipts.map((receipt) => receipt.contentSha256),
        progressReceiptChainHeads,
      )
    ) {
      throw new Error(
        `Menu-control proof ${execution.requestId} changed its successful receipt chain`,
      );
    }
  }
  if (
    phase === 'failed_no_mutation' ||
    phase === 'failed_restored' ||
    phase === 'failed_checkpointed' ||
    phase === 'recovery_required'
  ) {
    const terminal = execution.result?.terminalEvidence;
    const receipts = terminal?.kind === 'succeeded_locked' ? null : terminal?.receiptPrefix;
    if (receipts === null || receipts === undefined) {
      throw new Error(`Menu-control proof ${execution.requestId} lacks failure receipt evidence`);
    }
    if (
      !isDeepStrictEqual(
        receipts.map((receipt) => receipt.contentSha256),
        progressReceiptChainHeads,
      )
    ) {
      throw new Error(
        `Menu-control proof ${execution.requestId} changed its failure receipt chain`,
      );
    }
  }
  if (history !== null) {
    if (
      historyBoundary === null ||
      execution.result === undefined ||
      !historyMatchesBoundary(history, historyBoundary) ||
      !companionMenuControlProofHistoryIdentityMatchesResult(history, execution.result)
    ) {
      throw new Error(`Menu-control proof ${execution.requestId} changed its history identity`);
    }
  }
  if (
    historyBoundary !== null &&
    (execution.result === undefined ||
      !isDeepStrictEqual(historyBoundary, historyBoundaryFromResult(execution.result)) ||
      stored.historyLease === null ||
      !isDeepStrictEqual(stored.historyLease.target, execution.target) ||
      stored.historyTransitionOccurredAt === null ||
      Date.parse(stored.historyTransitionOccurredAt) < Date.parse(execution.result.occurredAt))
  ) {
    throw new Error(`Menu-control proof ${execution.requestId} changed its terminal history`);
  }
  if (
    historyStatus === 'restored'
      ? historyCursor !== 0
      : historyStatus === 'history_locked'
        ? historyBoundary?.checkpointKind === 'success'
          ? historyCursor === null || historyCursor === 0
          : historyCursor !== null
        : historyCursor !== null
  ) {
    throw new Error(`Menu-control proof ${execution.requestId} has inconsistent history cursor`);
  }
}

function assertStoredTransition(
  previous: StoredMenuProof | undefined,
  next: StoredMenuProof,
  eventType: string,
): void {
  assertPhaseEvidence(next);
  if (
    eventType !== eventTypeFor(next) &&
    eventType !== 'blender.menu-control-proof.terminal-reconciled' &&
    eventType !== 'blender.menu-control-proof.history-transition-reported' &&
    eventType !== 'blender.menu-control-proof.history-transition-reconciled'
  ) {
    throw new Error(
      `Menu-control proof ${next.execution.requestId} event type does not match its phase`,
    );
  }
  if (previous === undefined) {
    if (next.phase !== 'queued') {
      throw new Error(`Menu-control proof ${next.execution.requestId} is missing its queued event`);
    }
    return;
  }
  if (eventType === 'blender.menu-control-proof.history-transition-reported') {
    const report = next.historyTransitionReports.at(-1);
    const previousHistory = previous.history;
    if (
      report === undefined ||
      previous.historyBoundary === null ||
      previous.execution.result === undefined ||
      (previous.phase !== 'succeeded' && previous.phase !== 'failed_checkpointed') ||
      next.phase !== previous.phase ||
      !sameImmutableExecution(previous.execution, next.execution) ||
      !isDeepStrictEqual(previous.execution.result, next.execution.result) ||
      !isDeepStrictEqual(previous.terminalReconciliationAck, next.terminalReconciliationAck) ||
      previous.sessionAuthoritySha256 !== next.sessionAuthoritySha256 ||
      previous.documentAuthoritySha256 !== next.documentAuthoritySha256 ||
      !isDeepStrictEqual(previous.historyBoundary, next.historyBoundary) ||
      (previousHistory !== null && !isDeepStrictEqual(previousHistory, next.history)) ||
      next.history === null ||
      !historyMatchesBoundary(next.history, previous.historyBoundary) ||
      !companionMenuControlProofHistoryTransitionReportMatchesResult(
        report,
        previous.execution.result,
      ) ||
      report.serverAcceptedCursor !== previous.historyCursor ||
      report.serverAcceptedStatus !== previous.historyStatus ||
      next.historyCursor !== report.transition.toCursor ||
      next.historyStatus !== report.transition.status ||
      previous.historyLease === null ||
      !isDeepStrictEqual(next.historyLease, report.currentLease) ||
      previous.historyTransitionOccurredAt === null ||
      next.historyTransitionOccurredAt !== report.transition.occurredAt ||
      next.execution.updatedAt !== report.reportedAt ||
      !isDeepStrictEqual(
        next.historyTransitionReports,
        [...previous.historyTransitionReports, report].slice(-32),
      ) ||
      !isDeepStrictEqual(
        next.historyTransitionReconciliationAcks,
        previous.historyTransitionReconciliationAcks,
      ) ||
      !isDeepStrictEqual(
        next.historyTransitionContentSha256s,
        [...previous.historyTransitionContentSha256s, report.transitionContentSha256].slice(-32),
      ) ||
      !isDeepStrictEqual(next.progressReceiptChainHeads, previous.progressReceiptChainHeads)
    ) {
      throw new Error(
        `Menu-control proof ${next.execution.requestId} has invalid history transition evidence`,
      );
    }
    return;
  }
  if (eventType === 'blender.menu-control-proof.history-transition-reconciled') {
    const ack = next.historyTransitionReconciliationAcks.at(-1);
    if (
      ack === undefined ||
      previous.historyBoundary === null ||
      previous.execution.result === undefined ||
      (previous.phase !== 'succeeded' && previous.phase !== 'failed_checkpointed') ||
      next.phase !== previous.phase ||
      !sameImmutableExecution(previous.execution, next.execution) ||
      !isDeepStrictEqual(previous.execution.result, next.execution.result) ||
      !isDeepStrictEqual(previous.terminalReconciliationAck, next.terminalReconciliationAck) ||
      previous.sessionAuthoritySha256 !== next.sessionAuthoritySha256 ||
      previous.documentAuthoritySha256 !== next.documentAuthoritySha256 ||
      !isDeepStrictEqual(previous.historyBoundary, next.historyBoundary) ||
      (previous.history !== null && !isDeepStrictEqual(previous.history, next.history)) ||
      next.history === null ||
      !historyMatchesBoundary(next.history, previous.historyBoundary) ||
      ack.serverAcceptedCursor !== previous.historyCursor ||
      ack.serverAcceptedStatus !== previous.historyStatus ||
      next.historyCursor !== ack.currentCursor ||
      next.historyStatus !== ack.currentStatus ||
      previous.historyLease === null ||
      next.historyLease === null ||
      !sameDocumentLeaseAuthority(previous.historyLease, next.historyLease) ||
      previous.historyLease.leaseId === next.historyLease.leaseId ||
      Date.parse(next.historyLease.expiresAt) <= Date.parse(ack.occurredAt) ||
      previous.historyTransitionOccurredAt === null ||
      next.historyTransitionOccurredAt !==
        (ack.transitions.at(-1)?.occurredAt ?? previous.historyTransitionOccurredAt) ||
      next.execution.updatedAt !== ack.occurredAt ||
      !isDeepStrictEqual(
        next.historyTransitionReconciliationAcks,
        [...previous.historyTransitionReconciliationAcks, ack].slice(-32),
      ) ||
      !isDeepStrictEqual(next.historyTransitionReports, previous.historyTransitionReports) ||
      !isDeepStrictEqual(
        next.historyTransitionContentSha256s,
        [...previous.historyTransitionContentSha256s, ...ack.transitionContentSha256s].slice(-32),
      ) ||
      !isDeepStrictEqual(next.progressReceiptChainHeads, previous.progressReceiptChainHeads)
    ) {
      throw new Error(
        `Menu-control proof ${next.execution.requestId} has invalid reconciled history evidence`,
      );
    }
    return;
  }
  if (eventType === 'blender.menu-control-proof.terminal-reconciled') {
    const ack = next.terminalReconciliationAck;
    const terminalPhase = next.phase === 'succeeded' || next.phase === 'failed_checkpointed';
    const eligiblePrevious =
      previous.phase === 'dispatched' ||
      previous.phase.startsWith('progress_') ||
      previous.phase === 'recovery_pending' ||
      previous.phase === next.phase;
    if (
      ack === undefined ||
      previous.terminalReconciliationAck !== undefined ||
      !terminalPhase ||
      !eligiblePrevious ||
      !sameImmutableExecution(previous.execution, next.execution) ||
      previous.sessionAuthoritySha256 !== next.sessionAuthoritySha256 ||
      previous.documentAuthoritySha256 !== next.documentAuthoritySha256 ||
      !isDeepStrictEqual(next.execution.result, ack.result) ||
      next.execution.updatedAt !== ack.occurredAt ||
      Date.parse(next.execution.updatedAt) < Date.parse(previous.execution.updatedAt) ||
      next.progressReceiptChainHeads.length < previous.progressReceiptChainHeads.length ||
      !isDeepStrictEqual(
        next.progressReceiptChainHeads.slice(0, previous.progressReceiptChainHeads.length),
        previous.progressReceiptChainHeads,
      )
    ) {
      throw new Error(
        `Menu-control proof ${next.execution.requestId} has invalid terminal reconciliation evidence`,
      );
    }
    return;
  }
  if (
    !sameImmutableExecution(previous.execution, next.execution) ||
    previous.sessionAuthoritySha256 !== next.sessionAuthoritySha256 ||
    previous.documentAuthoritySha256 !== next.documentAuthoritySha256 ||
    previous.terminalReconciliationAck !== undefined ||
    next.terminalReconciliationAck !== undefined ||
    !expectedTransition(previous.phase, next.phase) ||
    Date.parse(next.execution.updatedAt) < Date.parse(previous.execution.updatedAt)
  ) {
    throw new Error(
      `Menu-control proof ${next.execution.requestId} has an invalid persisted transition`,
    );
  }
  if (next.phase === 'recovery_pending') {
    const recovery = next.execution.recovery;
    const priorStatus = previous.execution.status;
    if (
      recovery === undefined ||
      (priorStatus !== 'dispatched' && priorStatus !== 'in_progress') ||
      recovery.priorStatus !== priorStatus ||
      recovery.detectedAt !== next.execution.updatedAt
    ) {
      throw new Error(
        `Menu-control proof ${next.execution.requestId} has inconsistent restart recovery evidence`,
      );
    }
  }
  const establishesDelivery =
    previous.phase === 'queued' &&
    next.phase === 'dispatched' &&
    previous.execution.deliveryId === undefined &&
    next.execution.deliveryId !== undefined;
  const preservesDelivery = isDeepStrictEqual(
    {
      deliveryId: previous.execution.deliveryId,
      lease: previous.execution.lease,
      dispatchedAt: previous.execution.dispatchedAt,
    },
    {
      deliveryId: next.execution.deliveryId,
      lease: next.execution.lease,
      dispatchedAt: next.execution.dispatchedAt,
    },
  );
  if (!establishesDelivery && !preservesDelivery) {
    throw new Error(`Menu-control proof ${next.execution.requestId} changed immutable delivery`);
  }
  const addsProgress = next.phase.startsWith('progress_');
  const expectedCount = previous.progressReceiptChainHeads.length + (addsProgress ? 1 : 0);
  if (
    next.progressReceiptChainHeads.length !== expectedCount ||
    !isDeepStrictEqual(
      next.progressReceiptChainHeads.slice(0, previous.progressReceiptChainHeads.length),
      previous.progressReceiptChainHeads,
    )
  ) {
    throw new Error(`Menu-control proof ${next.execution.requestId} changed its receipt SHA chain`);
  }
}

export function createBlenderMenuControlProofExecutionCoordinator(
  options: BlenderMenuControlProofExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredMenuProof>();
  const latestPayloadWasLegacy = new Map<string, boolean>();
  const pendingTerminalReconciliations = new Map<
    string,
    {
      readonly delivery: CompanionMenuControlProofTerminalReconciliationDelivery;
      readonly documentAuthoritySha256: string;
    }
  >();
  const pendingHistoryTransitionReconciliations = new Map<
    string,
    {
      readonly delivery: CompanionMenuControlProofHistoryTransitionReconciliationDelivery;
      readonly documentAuthoritySha256: string;
    }
  >();

  for (const event of options.database.listExecutionEventsByTypes(menuProofEventTypes)) {
    const { stored: parsed, legacy } = parseStoredMenuProofEventPayload(event.payload);
    const eventType = z.enum(menuProofEventTypes).parse(event.eventType);
    assertStoredTransition(executions.get(parsed.execution.requestId), parsed, eventType);
    if (
      event.id !== eventIdFor(eventType, parsed) ||
      event.createdAt !== parsed.execution.updatedAt
    ) {
      throw new Error(
        `Menu-control proof ${parsed.execution.requestId} has inconsistent persisted event metadata`,
      );
    }
    executions.set(parsed.execution.requestId, parsed);
    latestPayloadWasLegacy.set(parsed.execution.requestId, legacy);
  }

  const append = (eventType: MenuProofEventType, value: StoredMenuProof) => {
    const stored = storedMenuProofEventSchema.parse(value);
    assertStoredTransition(executions.get(stored.execution.requestId), stored, eventType);
    options.database.appendEvent({
      id: eventIdFor(eventType, stored),
      eventType,
      payload: stored,
      createdAt: stored.execution.updatedAt,
    });
    executions.set(stored.execution.requestId, stored);
    latestPayloadWasLegacy.set(stored.execution.requestId, false);
    return stored.execution;
  };

  const legacyQueuedExpirations = [...executions.values()]
    .filter(
      (stored) =>
        latestPayloadWasLegacy.get(stored.execution.requestId) === true &&
        stored.phase === 'queued',
    )
    .map((stored) => ({ stored, detectedAt: now() }));
  const queuedTimeRegression = legacyQueuedExpirations.find(
    ({ stored, detectedAt }) => Date.parse(detectedAt) < Date.parse(stored.execution.updatedAt),
  );
  if (queuedTimeRegression !== undefined) {
    throw new BlenderMenuControlProofExecutionError(
      'menu_control_proof_restart_time_regression',
      500,
      `Restart detection for legacy queued menu-control proof ${queuedTimeRegression.stored.execution.requestId} predates accepted evidence`,
    );
  }
  for (const { stored, detectedAt } of legacyQueuedExpirations) {
    append('blender.menu-control-proof.pre-dispatch-authority-expired', {
      ...stored,
      phase: 'pre_dispatch_authority_expired',
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        status: 'pre_dispatch_authority_expired',
        preDispatchAuthorityExpiration: {
          kind: 'document_authority_changed_before_dispatch',
          priorStatus: 'queued',
          detectedAt,
          automaticReplayAllowed: false,
          retainsTargetLock: false,
        },
        updatedAt: detectedAt,
      }),
    });
  }

  const restartRecoveries = [...executions.values()]
    .filter(isDeliveredNonterminal)
    .map((stored) => ({ stored, detectedAt: now() }));
  const timeRegression = restartRecoveries.find(
    ({ stored, detectedAt }) => Date.parse(detectedAt) < Date.parse(stored.execution.updatedAt),
  );
  if (timeRegression !== undefined) {
    throw new BlenderMenuControlProofExecutionError(
      'menu_control_proof_restart_time_regression',
      500,
      `Restart detection for menu-control proof ${timeRegression.stored.execution.requestId} predates accepted evidence`,
    );
  }
  for (const { stored, detectedAt } of restartRecoveries) {
    append('blender.menu-control-proof.recovery-pending', {
      ...stored,
      phase: 'recovery_pending',
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        status: 'recovery_pending',
        progress: undefined,
        result: undefined,
        recovery: {
          kind: 'runtime_restart_after_delivery',
          detectedAt,
          priorStatus: stored.execution.status,
          requiresExplicitRecovery: true,
          automaticReplayAllowed: false,
          retainsTargetLock: true,
        },
        updatedAt: detectedAt,
      }),
    });
  }

  const get = (requestId: string): CompanionMenuControlProofStatus | null =>
    executions.get(requestId)?.execution ?? null;

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    [...executions.values()].some(
      (stored) =>
        stored.execution.target.adapterId === adapterId &&
        stored.execution.target.instanceId === instanceId &&
        retainsTargetLock(stored),
    );

  const findForCreate = (input: CompanionMenuControlProofCreateRequest) => {
    const request = companionMenuControlProofCreateRequestSchema.parse(input);
    const existing = executions.get(request.requestId)?.execution;
    if (existing === undefined) return null;
    if (!sameCreateRequest(existing, request)) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_request_conflict',
        409,
        'The requestId is already bound to a different menu-control proof request',
      );
    }
    return existing;
  };

  const queue = (
    input: CompanionMenuControlProofStatus,
    documentAuthoritySha256: string,
    sessionAuthoritySha256: string = documentAuthoritySha256,
  ) => {
    const execution = companionMenuControlProofStatusSchema.parse(input);
    const documentAuthority = contentSha256Schema.parse(documentAuthoritySha256);
    const sessionAuthority = contentSha256Schema.parse(sessionAuthoritySha256);
    if (execution.status !== 'queued') {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_queued',
        409,
        'Only a fully validated queued menu-control proof may enter the coordinator',
      );
    }
    const existing = findForCreate({
      formatVersion: execution.formatVersion,
      requestId: execution.requestId,
      replayId: execution.replayId,
      expectedState: execution.expectedState,
    });
    if (existing !== null) return existing;
    const externalOwner = options.externalHistoryLockOwner?.(
      execution.target.adapterId,
      execution.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_locked',
        409,
        `Executor ${externalOwner} owns the target native-history lock`,
      );
    }
    const conflict = [...executions.values()].find(
      (candidate) =>
        candidate.execution.target.adapterId === execution.target.adapterId &&
        candidate.execution.target.instanceId === execution.target.instanceId &&
        retainsTargetLock(candidate),
    );
    if (conflict !== undefined) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_in_progress',
        409,
        `Menu-control proof ${conflict.execution.requestId} owns the target instance`,
      );
    }
    return append('blender.menu-control-proof.queued', {
      execution,
      phase: 'queued',
      sessionAuthoritySha256: sessionAuthority,
      documentAuthoritySha256: documentAuthority,
      progressReceiptChainHeads: [],
      terminalReconciliationAck: undefined,
      historyBoundary: null,
      history: null,
      historyCursor: null,
      historyStatus: null,
      historyLease: null,
      historyTransitionOccurredAt: null,
      historyTransitionReports: [],
      historyTransitionContentSha256s: [],
      historyTransitionReconciliationAcks: [],
    });
  };

  const reconcileSessionAuthority = (
    sessionAuthoritySha256: string,
    currentDocumentAuthoritySha256: string,
  ): readonly CompanionMenuControlProofStatus[] => {
    const sessionAuthority = contentSha256Schema.parse(sessionAuthoritySha256);
    const currentDocumentAuthority = contentSha256Schema.parse(currentDocumentAuthoritySha256);
    const detectedAt = now();
    const candidates = [...executions.values()].filter(
      (stored) =>
        stored.sessionAuthoritySha256 === sessionAuthority &&
        stored.documentAuthoritySha256 !== currentDocumentAuthority &&
        (stored.phase === 'queued' || isDeliveredNonterminal(stored)),
    );
    if (
      candidates.some((stored) => Date.parse(detectedAt) < Date.parse(stored.execution.updatedAt))
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_reconciliation_time_regression',
        500,
        'Document-authority reconciliation predates accepted menu-control proof evidence',
      );
    }
    const reconciled: CompanionMenuControlProofStatus[] = [];
    for (const stored of candidates) {
      if (stored.phase === 'queued') {
        reconciled.push(
          append('blender.menu-control-proof.pre-dispatch-authority-expired', {
            ...stored,
            phase: 'pre_dispatch_authority_expired',
            execution: companionMenuControlProofStatusSchema.parse({
              ...stored.execution,
              status: 'pre_dispatch_authority_expired',
              preDispatchAuthorityExpiration: {
                kind: 'document_authority_changed_before_dispatch',
                priorStatus: 'queued',
                detectedAt,
                automaticReplayAllowed: false,
                retainsTargetLock: false,
              },
              updatedAt: detectedAt,
            }),
          }),
        );
      } else if (isDeliveredNonterminal(stored)) {
        reconciled.push(
          append('blender.menu-control-proof.recovery-pending', {
            ...stored,
            phase: 'recovery_pending',
            execution: companionMenuControlProofStatusSchema.parse({
              ...stored.execution,
              status: 'recovery_pending',
              progress: undefined,
              recovery: {
                kind: 'document_authority_changed_after_delivery',
                detectedAt,
                priorStatus: stored.execution.status,
                requiresExplicitRecovery: true,
                automaticReplayAllowed: false,
                retainsTargetLock: true,
              },
              updatedAt: detectedAt,
            }),
          }),
        );
      }
    }
    return reconciled;
  };

  const poll = (
    input: BlenderMenuControlProofPollInput,
  ): CompanionMenuControlProofDelivery | null => {
    const fingerprint = contentSha256Schema.parse(input.documentAuthoritySha256);
    const pending = [...executions.values()]
      .filter(
        ({ phase, execution }) =>
          phase === 'queued' && isDeepStrictEqual(execution.target, input.target),
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (pending === undefined) return null;
    const dispatchedAt = now();
    if (pending.documentAuthoritySha256 !== fingerprint) {
      append('blender.menu-control-proof.pre-dispatch-authority-expired', {
        ...pending,
        phase: 'pre_dispatch_authority_expired',
        execution: companionMenuControlProofStatusSchema.parse({
          ...pending.execution,
          status: 'pre_dispatch_authority_expired',
          preDispatchAuthorityExpiration: {
            kind: 'document_authority_changed_before_dispatch',
            priorStatus: 'queued',
            detectedAt: dispatchedAt,
            automaticReplayAllowed: false,
            retainsTargetLock: false,
          },
          updatedAt: dispatchedAt,
        }),
      });
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_document_authority_changed',
        409,
        'The queued menu-control proof belongs to a different Companion process or document and was rejected without delivery',
      );
    }
    if (
      !isDeepStrictEqual(input.lease.target, input.target) ||
      Date.parse(input.lease.expiresAt) <= Date.parse(dispatchedAt)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_poll_authority_mismatch',
        409,
        'Poll session, target, and current lease must match the queued menu-control proof',
      );
    }
    const externalOwner = options.externalHistoryLockOwner?.(
      input.target.adapterId,
      input.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) {
      return null;
    }
    const delivery = companionMenuControlProofDeliverySchema.parse({
      ...deliveryIdentity(pending.execution),
      deliveryId: createId(),
      lease: input.lease,
      dispatchedAt,
    });
    append('blender.menu-control-proof.dispatched', {
      ...pending,
      phase: 'dispatched',
      execution: companionMenuControlProofStatusSchema.parse({
        ...pending.execution,
        deliveryId: delivery.deliveryId,
        lease: delivery.lease,
        dispatchedAt,
        status: 'dispatched',
        updatedAt: dispatchedAt,
      }),
    });
    return delivery;
  };

  const pollTerminalReconciliation = (
    input: BlenderMenuControlProofPollInput,
  ): CompanionMenuControlProofTerminalReconciliationDelivery | null => {
    const documentAuthority = contentSha256Schema.parse(input.documentAuthoritySha256);
    const recoveryRequestedAt = now();
    const candidate = [...executions.values()]
      .filter((stored) => {
        return (
          stored.execution.deliveryId !== undefined &&
          stored.execution.lease !== undefined &&
          stored.execution.dispatchedAt !== undefined &&
          stored.documentAuthoritySha256 === documentAuthority &&
          isDeepStrictEqual(stored.execution.target, input.target) &&
          stored.execution.lease.leaseId !== input.lease.leaseId &&
          (stored.phase === 'dispatched' ||
            stored.phase.startsWith('progress_') ||
            stored.phase === 'recovery_pending')
        );
      })
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (candidate === undefined) return null;
    if (Date.parse(recoveryRequestedAt) < Date.parse(candidate.execution.updatedAt)) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_reconciliation_time_regression',
        500,
        'Terminal reconciliation challenge predates accepted menu-control proof evidence',
      );
    }
    if (
      !isDeepStrictEqual(input.lease.target, input.target) ||
      Date.parse(input.lease.expiresAt) <= Date.parse(recoveryRequestedAt)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_recovery_authority_mismatch',
        409,
        'Terminal reconciliation requires a current replacement lease for the same target',
      );
    }
    const existing = pendingTerminalReconciliations.get(candidate.execution.requestId);
    if (
      existing !== undefined &&
      existing.documentAuthoritySha256 === documentAuthority &&
      sameLeaseIdentity(existing.delivery.replacementLease, input.lease)
    ) {
      return existing.delivery;
    }
    const delivery = companionMenuControlProofTerminalReconciliationDeliverySchema.parse({
      ...deliveryIdentity(candidate.execution),
      kind: 'native_terminal_reconcile',
      recoveryId: createId(),
      replacementLease: input.lease,
      acknowledgedProgressReceiptChainHeads: candidate.progressReceiptChainHeads,
      recoveryRequestedAt,
    });
    pendingTerminalReconciliations.set(candidate.execution.requestId, {
      delivery,
      documentAuthoritySha256: documentAuthority,
    });
    return delivery;
  };

  const pollHistoryTransitionReconciliation = (
    input: BlenderMenuControlProofPollInput,
  ): CompanionMenuControlProofHistoryTransitionReconciliationDelivery | null => {
    const documentAuthority = contentSha256Schema.parse(input.documentAuthoritySha256);
    const recoveryRequestedAt = now();
    const latest = [...executions.values()]
      .filter(
        (stored) =>
          stored.documentAuthoritySha256 === documentAuthority &&
          isDeepStrictEqual(stored.execution.target, input.target) &&
          stored.phase !== 'pre_dispatch_authority_expired',
      )
      .sort(
        (left, right) =>
          Date.parse(right.execution.requestedAt) - Date.parse(left.execution.requestedAt) ||
          right.execution.requestId.localeCompare(left.execution.requestId),
      )[0];
    const candidate =
      latest !== undefined &&
      latest.historyBoundary !== null &&
      latest.historyStatus !== null &&
      latest.execution.result !== undefined &&
      (latest.phase === 'succeeded' || latest.phase === 'failed_checkpointed') &&
      latest.historyLease !== null &&
      latest.historyLease.leaseId !== input.lease.leaseId
        ? latest
        : undefined;
    if (candidate === undefined || candidate.historyBoundary === null) return null;
    if (candidate.historyStatus === 'restored' && candidate.historyCursor === 0) return null;
    const externalOwner = options.externalHistoryLockOwner?.(
      input.target.adapterId,
      input.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) return null;
    if (
      !isDeepStrictEqual(input.lease.target, input.target) ||
      candidate.historyLease === null ||
      !sameDocumentLeaseAuthority(input.lease, candidate.historyLease) ||
      Date.parse(recoveryRequestedAt) < Date.parse(candidate.execution.updatedAt) ||
      Date.parse(input.lease.expiresAt) <= Date.parse(recoveryRequestedAt)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_reconciliation_authority_mismatch',
        409,
        'History reconciliation requires a current rotated lease for the retained document',
      );
    }
    const existing = pendingHistoryTransitionReconciliations.get(candidate.execution.requestId);
    if (
      existing !== undefined &&
      existing.documentAuthoritySha256 === documentAuthority &&
      sameLeaseIdentity(existing.delivery.replacementLease, input.lease)
    ) {
      return existing.delivery;
    }
    const delivery = companionMenuControlProofHistoryTransitionReconciliationDeliverySchema.parse({
      ...deliveryIdentity(candidate.execution),
      kind: 'native_history_transition_reconcile',
      recoveryId: createId(),
      replacementLease: input.lease,
      history: candidate.historyBoundary,
      serverAcceptedCursor: candidate.historyCursor,
      serverAcceptedStatus: candidate.historyStatus,
      acknowledgedTransitionContentSha256s: candidate.historyTransitionContentSha256s,
      expectedMarkerContentSha256: candidate.historyBoundary.terminalMarkerContentSha256,
      recoveryRequestedAt,
    });
    pendingHistoryTransitionReconciliations.set(candidate.execution.requestId, {
      delivery,
      documentAuthoritySha256: documentAuthority,
    });
    return delivery;
  };

  const reconcileHistoryTransitions = (
    input: CompanionMenuControlProofHistoryTransitionReconciliationAck,
    authority: BlenderMenuControlProofPollInput,
  ): 'accepted' | 'duplicate' => {
    const ack = companionMenuControlProofHistoryTransitionReconciliationAckSchema.parse(input);
    const documentAuthority = contentSha256Schema.parse(authority.documentAuthoritySha256);
    const stored = executions.get(ack.requestId);
    if (stored === undefined) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_found',
        404,
        'The menu-control proof retained history was not found',
      );
    }
    const lastAck = stored.historyTransitionReconciliationAcks.at(-1);
    const receivedAt = now();
    if (
      stored.documentAuthoritySha256 === documentAuthority &&
      stored.historyLease !== null &&
      sameDocumentLeaseAuthority(authority.lease, stored.historyLease) &&
      isDeepStrictEqual(authority.target, stored.execution.target) &&
      lastAck !== undefined &&
      isDeepStrictEqual(lastAck, ack) &&
      Date.parse(ack.occurredAt) <= Date.parse(receivedAt) &&
      Date.parse(authority.lease.expiresAt) > Date.parse(receivedAt)
    ) {
      return 'duplicate';
    }
    const pending = pendingHistoryTransitionReconciliations.get(stored.execution.requestId);
    if (
      pending === undefined ||
      pending.documentAuthoritySha256 !== documentAuthority ||
      stored.documentAuthoritySha256 !== documentAuthority ||
      !isDeepStrictEqual(authority.target, stored.execution.target) ||
      !sameLeaseIdentity(pending.delivery.replacementLease, authority.lease) ||
      ack.recoveryId !== pending.delivery.recoveryId
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_reconciliation_challenge_stale',
        409,
        'The history reconciliation challenge is missing, replaced, or no longer current; poll again',
      );
    }
    if (
      stored.historyBoundary === null ||
      !companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(
        ack,
        pending.delivery,
      ) ||
      !historyMatchesBoundary(ack.history, stored.historyBoundary) ||
      (stored.history !== null && !isDeepStrictEqual(stored.history, ack.history))
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_reconciliation_identity_mismatch',
        409,
        'The reconciled history outbox changed its checkpoint, document, or lease identity',
      );
    }
    if (
      ack.serverAcceptedCursor !== stored.historyCursor ||
      ack.serverAcceptedStatus !== stored.historyStatus ||
      stored.historyTransitionOccurredAt === null ||
      Date.parse(ack.occurredAt) < Date.parse(stored.execution.updatedAt) ||
      Date.parse(ack.occurredAt) > Date.parse(receivedAt) ||
      (ack.transitions[0] !== undefined &&
        Date.parse(ack.transitions[0].occurredAt) <= Date.parse(stored.historyTransitionOccurredAt))
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_transition_conflict',
        409,
        'The transition outbox does not strictly continue the server-accepted cursor',
      );
    }
    if (stored.historyStatus === 'restored' && ack.currentStatus === 'history_locked') {
      const internalOwner = [...executions.values()].find(
        (candidate) =>
          candidate.execution.requestId !== stored.execution.requestId &&
          isDeepStrictEqual(candidate.execution.target, stored.execution.target) &&
          retainsTargetLock(candidate),
      );
      const externalOwner = options.externalHistoryLockOwner?.(
        stored.execution.target.adapterId,
        stored.execution.target.instanceId,
      );
      if (internalOwner !== undefined || (externalOwner !== undefined && externalOwner !== null)) {
        throw new BlenderMenuControlProofExecutionError(
          'menu_control_proof_history_relock_conflict',
          409,
          `Executor ${internalOwner?.execution.requestId ?? externalOwner} acquired the target while menu history was restored`,
        );
      }
    }
    append('blender.menu-control-proof.history-transition-reconciled', {
      ...stored,
      history: ack.history,
      historyCursor: ack.currentCursor,
      historyStatus: ack.currentStatus,
      historyLease: authority.lease,
      historyTransitionOccurredAt:
        ack.transitions.at(-1)?.occurredAt ?? stored.historyTransitionOccurredAt,
      historyTransitionContentSha256s: [
        ...stored.historyTransitionContentSha256s,
        ...ack.transitionContentSha256s,
      ].slice(-32),
      historyTransitionReconciliationAcks: [
        ...stored.historyTransitionReconciliationAcks,
        ack,
      ].slice(-32),
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        updatedAt: ack.occurredAt,
      }),
    });
    pendingHistoryTransitionReconciliations.delete(stored.execution.requestId);
    return 'accepted';
  };

  const reconcileTerminal = (
    input: CompanionMenuControlProofTerminalReconciliationAck,
    authority: BlenderMenuControlProofPollInput,
  ): 'accepted' | 'duplicate' => {
    const ack = companionMenuControlProofTerminalReconciliationAckSchema.parse(input);
    const documentAuthority = contentSha256Schema.parse(authority.documentAuthoritySha256);
    const stored = executions.get(ack.result.requestId);
    if (stored === undefined) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_found',
        404,
        'The menu-control proof request was not found',
      );
    }
    const receivedAt = now();
    const acceptedLease = stored.historyLease ?? stored.execution.lease ?? null;
    if (
      stored.terminalReconciliationAck !== undefined &&
      stored.documentAuthoritySha256 === documentAuthority &&
      acceptedLease !== null &&
      sameDocumentLeaseAuthority(authority.lease, acceptedLease) &&
      isDeepStrictEqual(authority.target, stored.execution.target) &&
      isDeepStrictEqual(stored.terminalReconciliationAck, ack) &&
      isDeepStrictEqual(stored.execution.result, ack.result) &&
      Date.parse(ack.occurredAt) <= Date.parse(receivedAt) &&
      Date.parse(authority.lease.expiresAt) > Date.parse(receivedAt)
    ) {
      return 'duplicate';
    }
    const pending = pendingTerminalReconciliations.get(stored.execution.requestId);
    if (
      pending === undefined ||
      pending.documentAuthoritySha256 !== documentAuthority ||
      stored.documentAuthoritySha256 !== documentAuthority ||
      !sameLeaseIdentity(pending.delivery.replacementLease, authority.lease) ||
      !isDeepStrictEqual(authority.target, stored.execution.target) ||
      ack.recoveryId !== pending.delivery.recoveryId
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_terminal_reconciliation_challenge_stale',
        409,
        'The terminal reconciliation challenge is missing, replaced, or no longer current; poll again',
      );
    }
    if (!companionMenuControlProofTerminalReconciliationAckMatchesDelivery(ack, pending.delivery)) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_terminal_reconciliation_identity_mismatch',
        409,
        'The terminal result does not match its original delivery and current replacement document lease',
      );
    }
    const eligible =
      stored.phase === 'dispatched' ||
      stored.phase.startsWith('progress_') ||
      stored.phase === 'recovery_pending' ||
      stored.phase === ack.result.status;
    if (
      !eligible ||
      (ack.result.status !== 'succeeded' && ack.result.status !== 'failed_checkpointed')
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_terminal_reconciliation_not_allowed',
        409,
        'Only an indeterminate proof or the exact already-locked terminal may be reconciled',
      );
    }
    if (
      (stored.phase === 'succeeded' || stored.phase === 'failed_checkpointed') &&
      !isDeepStrictEqual(stored.execution.result, ack.result)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_result_conflict',
        409,
        'The menu-control proof already has a different locked terminal result',
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
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_receipt_chain_conflict',
        409,
        'The reconciled terminal receipt chain does not extend the server-acknowledged prefix',
      );
    }
    if (
      stored.terminalReconciliationAck !== undefined &&
      isDeepStrictEqual(stored.execution.result, ack.result)
    ) {
      return 'duplicate';
    }
    append('blender.menu-control-proof.terminal-reconciled', {
      ...stored,
      phase: ack.result.status,
      progressReceiptChainHeads: [...terminalHeads],
      terminalReconciliationAck: ack,
      historyBoundary: historyBoundaryFromResult(ack.result),
      historyCursor: ack.result.status === 'succeeded' ? 8 : null,
      historyStatus: 'history_locked',
      historyLease: stored.execution.lease ?? null,
      historyTransitionOccurredAt: ack.result.occurredAt,
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        status: ack.result.status,
        progress: undefined,
        recovery: undefined,
        result: ack.result,
        updatedAt: ack.occurredAt,
      }),
    });
    return 'accepted';
  };

  const assertDelivery = (
    evidence: CompanionMenuControlProofProgress | CompanionMenuControlProofResult,
    fingerprint: string,
  ): StoredMenuProof => {
    const serverNow = Date.parse(now());
    const stored = executions.get(evidence.requestId);
    if (stored === undefined) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_found',
        404,
        'The menu-control proof request was not found',
      );
    }
    if (
      stored.documentAuthoritySha256 !== fingerprint ||
      !sameDeliveryIdentity(stored.execution, evidence)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_delivery_identity_mismatch',
        409,
        'Evidence does not match the accepted delivery, lease, binding, and Companion session',
      );
    }
    const executionDeadline =
      Date.parse(evidence.dispatchedAt) + companionMenuControlProofExecutionWindowMs;
    if (
      Date.parse(evidence.occurredAt) < Date.parse(stored.execution.updatedAt) ||
      Date.parse(evidence.occurredAt) > serverNow ||
      serverNow > executionDeadline
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_evidence_time_invalid',
        409,
        'Evidence falls outside the bounded execution window or predates accepted evidence',
      );
    }
    return stored;
  };

  const progress = (
    input: CompanionMenuControlProofProgress,
    documentAuthoritySha256: string,
  ): 'accepted' | 'duplicate' => {
    const evidence = companionMenuControlProofProgressSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(documentAuthoritySha256);
    const stored = assertDelivery(evidence, fingerprint);
    const count = evidence.operationReceipts.length;
    if (stored.phase === `progress_${count - 1}`) {
      if (isDeepStrictEqual(stored.execution.progress, evidence)) return 'duplicate';
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_progress_conflict',
        409,
        'The logical progress receipt was already reported with different evidence',
      );
    }
    if (
      (stored.phase !== 'dispatched' && !stored.phase.startsWith('progress_')) ||
      count !== stored.progressReceiptChainHeads.length + 1 ||
      !isDeepStrictEqual(
        evidence.operationReceipts
          .slice(0, stored.progressReceiptChainHeads.length)
          .map((receipt) => receipt.contentSha256),
        stored.progressReceiptChainHeads,
      ) ||
      stored.progressReceiptChainHeads.includes(evidence.receiptChainHeadSha256)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_progress_conflict',
        409,
        'Progress must provide the exact next logical receipt prefix and a distinct chain head',
      );
    }
    const phase = `progress_${count - 1}` as MenuProofPhase;
    append(eventTypeFor({ ...stored, phase }) as MenuProofEventType, {
      ...stored,
      phase,
      progressReceiptChainHeads: [
        ...stored.progressReceiptChainHeads,
        evidence.receiptChainHeadSha256,
      ],
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        status: 'in_progress',
        progress: evidence,
        updatedAt: evidence.occurredAt,
      }),
    });
    return 'accepted';
  };

  const reportHistoryTransition = (
    input: CompanionMenuControlProofHistoryTransitionReport,
    documentAuthoritySha256: string,
  ): 'accepted' | 'duplicate' => {
    const report = companionMenuControlProofHistoryTransitionReportSchema.parse(input);
    const documentAuthority = contentSha256Schema.parse(documentAuthoritySha256);
    const stored = executions.get(report.requestId);
    if (stored === undefined) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_found',
        404,
        'The menu-control proof request was not found',
      );
    }
    const acceptedReport = stored.historyTransitionReports.find(
      (candidate) =>
        candidate.transitionContentSha256 === report.transitionContentSha256 &&
        sameLogicalHistoryTransitionReport(candidate, report),
    );
    const receivedAt = now();
    if (
      stored.documentAuthoritySha256 === documentAuthority &&
      stored.historyLease !== null &&
      sameDocumentLeaseAuthority(report.currentLease, stored.historyLease) &&
      isDeepStrictEqual(report.target, stored.execution.target) &&
      acceptedReport !== undefined &&
      Date.parse(report.reportedAt) >= Date.parse(stored.execution.updatedAt) &&
      Date.parse(report.reportedAt) <= Date.parse(receivedAt) &&
      Date.parse(report.currentLease.expiresAt) > Date.parse(receivedAt)
    ) {
      return 'duplicate';
    }
    if (
      stored.documentAuthoritySha256 !== documentAuthority ||
      stored.historyLease === null ||
      !sameDocumentLeaseAuthority(report.currentLease, stored.historyLease) ||
      !isDeepStrictEqual(report.target, stored.execution.target)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_transition_authority_mismatch',
        409,
        'The history transition does not belong to the accepted document lease',
      );
    }
    if (
      stored.historyBoundary === null ||
      stored.execution.result === undefined ||
      (stored.phase !== 'succeeded' && stored.phase !== 'failed_checkpointed') ||
      !companionMenuControlProofHistoryTransitionReportMatchesResult(
        report,
        stored.execution.result,
      ) ||
      !historyMatchesBoundary(report.history, stored.historyBoundary)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_transition_identity_mismatch',
        409,
        'The history transition changed the retained terminal checkpoint identity',
      );
    }
    if (
      report.serverAcceptedCursor !== stored.historyCursor ||
      report.serverAcceptedStatus !== stored.historyStatus ||
      (stored.history !== null && !isDeepStrictEqual(stored.history, report.history)) ||
      stored.historyTransitionOccurredAt === null ||
      Date.parse(report.transition.occurredAt) <= Date.parse(stored.historyTransitionOccurredAt) ||
      Date.parse(report.reportedAt) < Date.parse(report.transition.occurredAt) ||
      Date.parse(report.reportedAt) < Date.parse(stored.execution.updatedAt) ||
      Date.parse(report.reportedAt) > Date.parse(receivedAt) ||
      Date.parse(report.currentLease.expiresAt) <= Date.parse(report.reportedAt)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_transition_conflict',
        409,
        'History transitions must strictly continue the exact accepted native cursor',
      );
    }
    if (stored.historyStatus === 'restored' && report.transition.status === 'history_locked') {
      const internalOwner = [...executions.values()].find(
        (candidate) =>
          candidate.execution.requestId !== stored.execution.requestId &&
          isDeepStrictEqual(candidate.execution.target, stored.execution.target) &&
          retainsTargetLock(candidate),
      );
      const externalOwner = options.externalHistoryLockOwner?.(
        stored.execution.target.adapterId,
        stored.execution.target.instanceId,
      );
      if (internalOwner !== undefined || (externalOwner !== undefined && externalOwner !== null)) {
        throw new BlenderMenuControlProofExecutionError(
          'menu_control_proof_history_relock_conflict',
          409,
          `Executor ${internalOwner?.execution.requestId ?? externalOwner} acquired the target while menu history was restored`,
        );
      }
    }
    append('blender.menu-control-proof.history-transition-reported', {
      ...stored,
      history: report.history,
      historyCursor: report.transition.toCursor,
      historyStatus: report.transition.status,
      historyLease: report.currentLease,
      historyTransitionOccurredAt: report.transition.occurredAt,
      historyTransitionReports: [...stored.historyTransitionReports, report].slice(-32),
      historyTransitionContentSha256s: [
        ...stored.historyTransitionContentSha256s,
        report.transitionContentSha256,
      ].slice(-32),
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        updatedAt: report.reportedAt,
      }),
    });
    return 'accepted';
  };

  const complete = (
    input: CompanionMenuControlProofResult,
    documentAuthoritySha256: string,
  ): 'accepted' | 'duplicate' => {
    const result = companionMenuControlProofResultSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(documentAuthoritySha256);
    const existing = executions.get(result.requestId);
    if (
      existing !== undefined &&
      existing.documentAuthoritySha256 === fingerprint &&
      (existing.phase === 'succeeded' ||
        existing.phase === 'failed_no_mutation' ||
        existing.phase === 'failed_restored' ||
        existing.phase === 'failed_checkpointed' ||
        (existing.phase === 'recovery_required' &&
          existing.execution.status === 'recovery_required')) &&
      isDeepStrictEqual(existing.execution.result, result)
    ) {
      return 'duplicate';
    }
    const stored = assertDelivery(result, fingerprint);
    if (
      stored.phase === 'succeeded' ||
      stored.phase === 'failed_no_mutation' ||
      stored.phase === 'failed_restored' ||
      stored.phase === 'failed_checkpointed' ||
      (stored.phase === 'recovery_required' && stored.execution.status === 'recovery_required')
    ) {
      if (isDeepStrictEqual(stored.execution.result, result)) return 'duplicate';
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_result_conflict',
        409,
        'The menu-control proof already has a different terminal result',
      );
    }
    if (stored.phase === 'recovery_required') {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_not_completable',
        409,
        'A delivered proof made indeterminate by restart cannot be completed automatically',
      );
    }
    if (stored.phase === 'recovery_pending') {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_recovery_pending',
        409,
        'A restart-indeterminate menu-control proof requires explicit recovery',
      );
    }
    const terminal = result.terminalEvidence;
    const receiptHeads =
      terminal.kind === 'succeeded_locked'
        ? terminal.operationReceipts.map((receipt) => receipt.contentSha256)
        : terminal.receiptPrefix.map((receipt) => receipt.contentSha256);
    if (!isDeepStrictEqual(receiptHeads, stored.progressReceiptChainHeads)) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_receipt_chain_conflict',
        409,
        'Terminal evidence does not match the accepted logical receipt chain',
      );
    }
    if (result.status === 'succeeded' && stored.phase !== 'progress_6') {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_progress_incomplete',
        409,
        'Success requires all seven logical progress receipts',
      );
    }
    if (result.status === 'failed_no_mutation' && stored.phase !== 'dispatched') {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_failure_conflict',
        409,
        'A no-mutation failure is valid only immediately after dispatch',
      );
    }
    append(eventTypeFor({ ...stored, phase: result.status }) as MenuProofEventType, {
      ...stored,
      phase: result.status,
      historyBoundary: historyBoundaryFromResult(result),
      historyCursor: result.status === 'succeeded' ? 8 : null,
      historyStatus:
        result.status === 'succeeded' || result.status === 'failed_checkpointed'
          ? 'history_locked'
          : null,
      historyLease:
        result.status === 'succeeded' || result.status === 'failed_checkpointed'
          ? (stored.execution.lease ?? null)
          : null,
      historyTransitionOccurredAt:
        result.status === 'succeeded' || result.status === 'failed_checkpointed'
          ? result.occurredAt
          : null,
      execution: companionMenuControlProofStatusSchema.parse({
        ...stored.execution,
        status: result.status,
        progress: undefined,
        result,
        updatedAt: result.occurredAt,
      }),
    });
    return 'accepted';
  };

  return {
    get,
    findForCreate,
    queue,
    reconcileSessionAuthority,
    poll,
    pollHistoryTransitionReconciliation,
    pollTerminalReconciliation,
    progress,
    reportHistoryTransition,
    complete,
    reconcileTerminal,
    reconcileHistoryTransitions,
    ownsTarget,
  };
}
