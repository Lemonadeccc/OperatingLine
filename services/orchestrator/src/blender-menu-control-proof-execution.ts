import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionMenuControlProofCreateRequestSchema,
  companionMenuControlProofDeliverySchema,
  companionMenuControlProofProgressSchema,
  companionMenuControlProofResultSchema,
  companionMenuControlProofStatusSchema,
  type CompanionMenuControlProofCreateRequest,
  type CompanionMenuControlProofDelivery,
  type CompanionMenuControlProofProgress,
  type CompanionMenuControlProofResult,
  type CompanionMenuControlProofStatus,
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
  'blender.menu-control-proof.succeeded',
  'blender.menu-control-proof.failed-no-mutation',
  'blender.menu-control-proof.failed-restored',
  'blender.menu-control-proof.failed-checkpointed',
  'blender.menu-control-proof.recovery-required',
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
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);
const storedMenuProofEventSchema = z.strictObject({
  execution: companionMenuControlProofStatusSchema,
  phase: phaseSchema,
  sessionFingerprintSha256: contentSha256Schema,
  progressReceiptChainHeads: z.array(contentSha256Schema).max(7),
});

type MenuProofDatabase = Pick<OperatingLineDatabase, 'appendEvent' | 'listExecutionEventsByTypes'>;
type StoredMenuProof = z.infer<typeof storedMenuProofEventSchema>;
type MenuProofPhase = StoredMenuProof['phase'];
type MenuProofEventType = (typeof menuProofEventTypes)[number];

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
  readonly sessionFingerprintSha256: string;
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

function eventIdFor(stored: StoredMenuProof): string {
  return `blender-menu-control-proof:${stored.execution.requestId}:${stored.phase}`;
}

function assertPhaseEvidence(stored: StoredMenuProof): void {
  const { execution, phase, progressReceiptChainHeads } = stored;
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
}

function assertStoredTransition(
  previous: StoredMenuProof | undefined,
  next: StoredMenuProof,
  eventType: string,
): void {
  assertPhaseEvidence(next);
  if (eventType !== eventTypeFor(next)) {
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
  if (
    !sameImmutableExecution(previous.execution, next.execution) ||
    previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 ||
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

  for (const event of options.database.listExecutionEventsByTypes(menuProofEventTypes)) {
    const parsed = storedMenuProofEventSchema.parse(event.payload);
    if (event.id !== eventIdFor(parsed) || event.createdAt !== parsed.execution.updatedAt) {
      throw new Error(
        `Menu-control proof ${parsed.execution.requestId} has inconsistent persisted event metadata`,
      );
    }
    assertStoredTransition(executions.get(parsed.execution.requestId), parsed, event.eventType);
    executions.set(parsed.execution.requestId, parsed);
  }

  const append = (eventType: MenuProofEventType, value: StoredMenuProof) => {
    const stored = storedMenuProofEventSchema.parse(value);
    assertStoredTransition(executions.get(stored.execution.requestId), stored, eventType);
    options.database.appendEvent({
      id: eventIdFor(stored),
      eventType,
      payload: stored,
      createdAt: stored.execution.updatedAt,
    });
    executions.set(stored.execution.requestId, stored);
    return stored.execution;
  };

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

  const queue = (input: CompanionMenuControlProofStatus, sessionFingerprintSha256: string) => {
    const execution = companionMenuControlProofStatusSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
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
      sessionFingerprintSha256: fingerprint,
      progressReceiptChainHeads: [],
    });
  };

  const poll = (
    input: BlenderMenuControlProofPollInput,
  ): CompanionMenuControlProofDelivery | null => {
    const fingerprint = contentSha256Schema.parse(input.sessionFingerprintSha256);
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
    if (
      pending.sessionFingerprintSha256 !== fingerprint ||
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
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_history_locked',
        409,
        `Executor ${externalOwner} owns the target native-history lock`,
      );
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
      stored.sessionFingerprintSha256 !== fingerprint ||
      !sameDeliveryIdentity(stored.execution, evidence)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_delivery_identity_mismatch',
        409,
        'Evidence does not match the accepted delivery, lease, binding, and Companion session',
      );
    }
    if (
      Date.parse(evidence.occurredAt) < Date.parse(stored.execution.updatedAt) ||
      Date.parse(evidence.occurredAt) > serverNow ||
      serverNow >= Date.parse(evidence.lease.expiresAt)
    ) {
      throw new BlenderMenuControlProofExecutionError(
        'menu_control_proof_evidence_time_invalid',
        409,
        'Evidence is expired or predates the previously accepted evidence',
      );
    }
    return stored;
  };

  const progress = (
    input: CompanionMenuControlProofProgress,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const evidence = companionMenuControlProofProgressSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
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

  const complete = (
    input: CompanionMenuControlProofResult,
    sessionFingerprintSha256: string,
  ): 'accepted' | 'duplicate' => {
    const result = companionMenuControlProofResultSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
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

  return { get, findForCreate, queue, poll, progress, complete, ownsTarget };
}
