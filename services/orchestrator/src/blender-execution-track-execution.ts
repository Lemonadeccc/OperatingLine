import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionCreateRequestSchema,
  companionExecutionTrackExecutionDeliverySchema,
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionProgressTransitionMatches,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionRecoveryRequestSchema,
  companionExecutionTrackExecutionResultSchema,
  companionExecutionTrackExecutionStatusSchema,
  type CompanionExecutionTrackExecutionBinding,
  type CompanionExecutionTrackExecutionCreateRequest,
  type CompanionExecutionTrackExecutionDelivery,
  type CompanionExecutionTrackExecutionManagedStart,
  type CompanionExecutionTrackExecutionProgress,
  type CompanionExecutionTrackExecutionResult,
} from '@operatingline/protocol';
import type { z } from 'zod';

type CompanionExecutionTrackExecutionManagedStartSubmission = z.infer<
  typeof companionExecutionTrackExecutionManagedStartSubmissionSchema
>;
type CompanionExecutionTrackExecutionRecoveryAck = z.infer<
  typeof companionExecutionTrackExecutionRecoveryAckSchema
>;
type CompanionExecutionTrackExecutionRecoveryRequest = z.infer<
  typeof companionExecutionTrackExecutionRecoveryRequestSchema
>;
type CompanionExecutionTrackExecutionStatus = z.infer<
  typeof companionExecutionTrackExecutionStatusSchema
>;
export type BlenderExecutionTrackExecutionManagedRepairEvidence = Extract<
  CompanionExecutionTrackExecutionRecoveryAck['evidence'],
  { kind: 'managed_repair_terminal' }
>;
type BlenderExecutionTrackExecutionDeterministicEvent = Parameters<
  BlenderExecutionTrackExecutionEventStore['appendEvent']
>[0] & { readonly createdAt: string };

const eventTypes = [
  'blender.execution-track-execution.queued',
  'blender.execution-track-execution.dispatched',
  'blender.execution-track-execution.progressed',
  'blender.execution-track-execution.managed-started',
  'blender.execution-track-execution.completed',
  'blender.execution-track-execution.recovery-required',
  'blender.execution-track-execution.recovery-requested',
  'blender.execution-track-execution.reconciled',
] as const;

type ExecutionEventType = (typeof eventTypes)[number];

export type BlenderExecutionTrackExecutionEventStore = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;

interface StoredExecution {
  readonly status: CompanionExecutionTrackExecutionStatus;
  readonly documentAuthoritySha256: string;
  readonly progressChain: readonly CompanionExecutionTrackExecutionProgress[];
  readonly managedStartSubmission?: CompanionExecutionTrackExecutionManagedStartSubmission;
  readonly recoveryRequest?: CompanionExecutionTrackExecutionRecoveryRequest;
  readonly recoveryAck?: CompanionExecutionTrackExecutionRecoveryAck;
  readonly revision: number;
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function parseSha256(value: string): string {
  if (!sha256Pattern.test(value)) throw new Error('Document authority must be a SHA-256 hash');
  return value;
}

export class BlenderExecutionTrackExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderExecutionTrackExecutionError';
  }
}

export interface BlenderExecutionTrackExecutionCoordinatorOptions {
  /** The event store must have a single coordinator writer. */
  readonly eventStore: BlenderExecutionTrackExecutionEventStore;
  readonly now?: () => string;
  readonly createId?: () => string;
  /** Side-effect-free semantic validation only; this coordinator never invokes an action queue. */
  readonly validateManagedResult: (
    result: CompanionExecutionTrackExecutionResult,
    status: CompanionExecutionTrackExecutionStatus,
  ) => void;
  readonly externalTargetLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

export interface BlenderExecutionTrackExecutionLiveAuthority {
  readonly target: CompanionExecutionTrackExecutionBinding['target'];
  readonly lease: CompanionExecutionTrackExecutionDelivery['lease'];
  readonly documentAuthoritySha256: string;
}

export interface BlenderExecutionTrackExecutionRecoveryAckAuthorization {
  readonly result: 'accepted' | 'duplicate';
}

export interface BlenderExecutionTrackExecutionRecoveryAckCommitOptions {
  /**
   * Atomically persists the exact managed-repair evidence and its coordinator-built event.
   * Returning proves both are durable; the coordinator only then applies the transition in memory.
   */
  readonly commitManagedRepair: (input: {
    readonly evidence: BlenderExecutionTrackExecutionManagedRepairEvidence;
    readonly reconciledEvent: BlenderExecutionTrackExecutionDeterministicEvent;
  }) => ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']>;
}

interface InternalRecoveryAckAuthorization extends BlenderExecutionTrackExecutionRecoveryAckAuthorization {
  readonly ack: CompanionExecutionTrackExecutionRecoveryAck;
  readonly liveAuthority: BlenderExecutionTrackExecutionLiveAuthority;
  readonly authorizedAt: string;
  readonly revision: number;
}

const activeStatuses = new Set<CompanionExecutionTrackExecutionStatus['status']>([
  'queued',
  'dispatched',
  'baseline_attested',
  'proof_in_progress',
  'proof_observed_locked',
  'restore_in_progress',
  'baseline_restored',
  'commit_intent_recorded',
  'managed_action_in_progress',
  'failed_managed',
  'recovery_required',
]);

function targetKey(binding: CompanionExecutionTrackExecutionBinding): string {
  return `${binding.target.adapterId}:${binding.target.instanceId}`;
}

function createRequestFromBinding(
  binding: CompanionExecutionTrackExecutionBinding,
): CompanionExecutionTrackExecutionCreateRequest {
  return companionExecutionTrackExecutionCreateRequestSchema.parse({
    formatVersion: binding.formatVersion,
    requestId: binding.requestId,
    target: binding.target,
    proposalId: binding.proposalId,
    plan: binding.plan,
    executionId: binding.executionId,
    leafId: binding.leafId,
    override: binding.override,
    expectedState: binding.expectedState,
  });
}

function eventTypeFor(status: CompanionExecutionTrackExecutionStatus): ExecutionEventType {
  if (status.status === 'queued') return 'blender.execution-track-execution.queued';
  if (status.status === 'dispatched') return 'blender.execution-track-execution.dispatched';
  if (status.status === 'managed_action_in_progress') {
    return 'blender.execution-track-execution.managed-started';
  }
  if (
    status.status === 'baseline_attested' ||
    status.status === 'proof_in_progress' ||
    status.status === 'proof_observed_locked' ||
    status.status === 'restore_in_progress' ||
    status.status === 'baseline_restored' ||
    status.status === 'commit_intent_recorded'
  ) {
    return 'blender.execution-track-execution.progressed';
  }
  if (status.status === 'recovery_required') {
    return 'blender.execution-track-execution.recovery-required';
  }
  return 'blender.execution-track-execution.completed';
}

interface RecoveryDurableReferences {
  terminalMarkerContentSha256: string | null;
  terminalResultContentSha256?: string | null;
  managedStartContentSha256: string | null;
  baselineContentSha256: string | null;
  commitIntentId: string | null;
  commitIntentContentSha256: string | null;
}

function recoveryReferencesForStored(stored: StoredExecution): RecoveryDurableReferences {
  const references = recoveryReferences(
    stored.status.progress,
    stored.managedStartSubmission?.managedStart,
  );
  if (
    stored.status.status !== 'failed_managed' ||
    stored.status.result?.status !== 'failed_managed'
  )
    return references;
  if (stored.recoveryRequest?.source === 'failed_managed_repair') {
    const repairReferences = stored.recoveryRequest.durableReferences;
    return {
      terminalMarkerContentSha256: repairReferences.terminalMarkerContentSha256,
      ...(repairReferences.terminalResultContentSha256 === undefined
        ? {}
        : { terminalResultContentSha256: repairReferences.terminalResultContentSha256 }),
      managedStartContentSha256: repairReferences.managedStartContentSha256,
      baselineContentSha256: repairReferences.baselineContentSha256,
      commitIntentId: repairReferences.commitIntentId,
      commitIntentContentSha256: repairReferences.commitIntentContentSha256,
    };
  }
  const evidence = stored.recoveryAck?.evidence;
  if (evidence?.kind === 'persisted_managed_terminal')
    return {
      ...references,
      terminalMarkerContentSha256: evidence.terminalMarker.contentSha256,
      terminalResultContentSha256: evidence.terminalResultContentSha256,
    };
  return references;
}

function recoveryReferences(
  progress: CompanionExecutionTrackExecutionProgress | undefined,
  managedStart?: CompanionExecutionTrackExecutionManagedStart,
): RecoveryDurableReferences {
  if (progress?.phase === 'baseline_restored') {
    return {
      terminalMarkerContentSha256: null,
      managedStartContentSha256: null,
      baselineContentSha256: progress.baseline.contentSha256,
      commitIntentId: null,
      commitIntentContentSha256: null,
    };
  }
  if (progress?.phase === 'commit_intent_recorded') {
    return {
      terminalMarkerContentSha256: null,
      managedStartContentSha256: managedStart?.contentSha256 ?? null,
      baselineContentSha256: progress.baseline.contentSha256,
      commitIntentId: progress.intent.intentId,
      commitIntentContentSha256: progress.intent.contentSha256,
    };
  }
  return {
    terminalMarkerContentSha256: null,
    managedStartContentSha256: null,
    baselineContentSha256: null,
    commitIntentId: null,
    commitIntentContentSha256: null,
  };
}

function recoverySourceFor(stored: StoredExecution) {
  if (stored.status.status === 'failed_managed') {
    return stored.recoveryAck?.evidence.kind === 'persisted_managed_terminal' ||
      stored.recoveryRequest?.source === 'failed_managed_repair'
      ? 'failed_managed_repair'
      : 'companion_reported';
  }
  return (
    stored.status.serverRecoveryEvidence?.source ??
    (stored.status.result?.status === 'recovery_required' ? 'companion_reported' : undefined)
  );
}

function assertRecoveryRequestMatchesStored(
  stored: StoredExecution,
  request: CompanionExecutionTrackExecutionRecoveryRequest,
): void {
  const expectedReferences =
    stored.status.serverRecoveryEvidence?.durableReferences ?? recoveryReferencesForStored(stored);
  if (
    (stored.status.status !== 'recovery_required' && stored.status.status !== 'failed_managed') ||
    request.originalDeliveryId !== stored.status.deliveryId ||
    request.bindingContentSha256 !== stored.status.binding.bindingContentSha256 ||
    !isDeepStrictEqual(request.target, stored.status.binding.target) ||
    !isDeepStrictEqual(request.originalLease, stored.status.lease) ||
    !isDeepStrictEqual(request.acceptedProgress, stored.status.progress ?? null) ||
    request.acceptedProgressChainHeadContentSha256 !==
      (stored.status.progress?.contentSha256 ?? null) ||
    !isDeepStrictEqual(request.durableReferences, expectedReferences) ||
    request.source !== recoverySourceFor(stored) ||
    Date.parse(request.replacementLease.expiresAt) <
      Date.parse(currentLeaseForStored(stored)?.expiresAt ?? '')
  ) {
    throw new Error('Recovery request does not mirror durable execution authority');
  }
}

function recoveryRotationMatches(
  previous: CompanionExecutionTrackExecutionRecoveryRequest,
  next: CompanionExecutionTrackExecutionRecoveryRequest,
): boolean {
  const advancedToManagedRepair =
    previous.source !== 'failed_managed_repair' &&
    next.source === 'failed_managed_repair' &&
    previous.durableReferences.terminalResultContentSha256 == null &&
    next.durableReferences.terminalResultContentSha256 != null &&
    next.durableReferences.terminalMarkerContentSha256 !== null;
  return (
    next.requestId === previous.requestId &&
    isDeepStrictEqual(next.target, previous.target) &&
    next.originalDeliveryId === previous.originalDeliveryId &&
    next.bindingContentSha256 === previous.bindingContentSha256 &&
    isDeepStrictEqual(next.originalLease, previous.originalLease) &&
    isDeepStrictEqual(next.acceptedProgress, previous.acceptedProgress) &&
    next.acceptedProgressChainHeadContentSha256 ===
      previous.acceptedProgressChainHeadContentSha256 &&
    (isDeepStrictEqual(next.durableReferences, previous.durableReferences) ||
      advancedToManagedRepair) &&
    (next.source === previous.source || advancedToManagedRepair) &&
    next.mode === previous.mode &&
    next.automaticReplay === previous.automaticReplay &&
    Date.parse(next.requestedAt) > Date.parse(previous.requestedAt) &&
    Date.parse(next.replacementLease.expiresAt) >= Date.parse(previous.replacementLease.expiresAt)
  );
}

function assertRecoveryAckTransition(
  previous: StoredExecution,
  next: StoredExecution,
  ack: CompanionExecutionTrackExecutionRecoveryAck,
): void {
  if (
    previous.recoveryRequest === undefined ||
    !isDeepStrictEqual(ack.request, previous.recoveryRequest) ||
    !isDeepStrictEqual(next.recoveryRequest, previous.recoveryRequest)
  ) {
    throw new Error('Recovery acknowledgement is not for the current challenge');
  }
  if (ack.outcome === 'recovery_required') {
    if (
      ack.evidence.kind !== 'unresolved_current_state' ||
      ack.retainsTargetLock === false ||
      !isDeepStrictEqual(next.status, {
        ...previous.status,
        updatedAt: next.status.updatedAt,
      })
    ) {
      throw new Error('Unresolved recovery acknowledgement changed lock or terminal state');
    }
    return;
  }
  if (ack.evidence.kind === 'managed_repair_terminal') {
    if (
      previous.status.status !== 'failed_managed' ||
      previous.status.result?.status !== 'failed_managed' ||
      !isDeepStrictEqual(previous.status.result, ack.evidence.failedTerminalResult) ||
      next.status.status !== 'failed_managed_repaired' ||
      !isDeepStrictEqual(next.status.result, previous.status.result) ||
      next.status.serverRecoveryEvidence !== undefined ||
      ack.retainsTargetLock
    ) {
      throw new Error('Managed repair acknowledgement changed its failed terminal or repair lock');
    }
    return;
  }
  if (
    ack.evidence.kind === 'unresolved_current_state' ||
    next.status.result === undefined ||
    !isDeepStrictEqual(next.status.result, ack.evidence.terminalResult) ||
    next.status.status !== ack.evidence.terminalResult.status ||
    next.status.serverRecoveryEvidence !== undefined ||
    ack.retainsTargetLock !== (ack.evidence.terminalResult.status === 'failed_managed')
  ) {
    throw new Error('Reconciled recovery acknowledgement changed its terminal result or lock');
  }
}

function sameDelivery(
  status: CompanionExecutionTrackExecutionStatus,
  delivery: CompanionExecutionTrackExecutionDelivery,
): boolean {
  return (
    status.binding.bindingContentSha256 === delivery.binding.bindingContentSha256 &&
    status.deliveryId === delivery.deliveryId &&
    status.dispatchedAt === delivery.dispatchedAt &&
    isDeepStrictEqual(status.lease, delivery.lease)
  );
}

function currentLeaseForStored(stored: StoredExecution) {
  return (
    stored.status.result?.currentLease ??
    stored.managedStartSubmission?.currentLease ??
    stored.status.progress?.currentLease ??
    stored.status.lease
  );
}

function resultManagedStart(status: CompanionExecutionTrackExecutionStatus) {
  const result = status.result;
  return result !== undefined && 'managedStart' in result ? result.managedStart : undefined;
}

function leaseIsMonotonic(
  previous: CompanionExecutionTrackExecutionDelivery['lease'],
  next: CompanionExecutionTrackExecutionDelivery['lease'],
): boolean {
  return (
    previous.leaseId === next.leaseId &&
    previous.sessionId === next.sessionId &&
    previous.documentIncarnationId === next.documentIncarnationId &&
    isDeepStrictEqual(previous.target, next.target) &&
    Date.parse(previous.expiresAt) <= Date.parse(next.expiresAt)
  );
}

function assertLiveAuthority(
  stored: StoredExecution,
  live: BlenderExecutionTrackExecutionLiveAuthority,
  messageLease: CompanionExecutionTrackExecutionDelivery['lease'],
  evidenceAt: string,
  receivedAt: string,
): void {
  const current = currentLeaseForStored(stored);
  if (
    parseSha256(live.documentAuthoritySha256) !== stored.documentAuthoritySha256 ||
    !isDeepStrictEqual(live.target, stored.status.binding.target) ||
    !isDeepStrictEqual(live.lease.target, live.target) ||
    current === undefined ||
    !leaseIsMonotonic(current, live.lease) ||
    !isDeepStrictEqual(messageLease, live.lease) ||
    Date.parse(evidenceAt) > Date.parse(receivedAt) ||
    Date.parse(receivedAt) >= Date.parse(live.lease.expiresAt)
  ) {
    throw new BlenderExecutionTrackExecutionError(
      'execution_track_execution_live_authority',
      409,
      'Message does not match current live target, document, lease, or receive chronology',
    );
  }
}

function assertStoredTransition(
  previous: StoredExecution | undefined,
  next: StoredExecution,
): void {
  const terminalResult = next.status.result;
  if (
    terminalResult !== undefined &&
    (terminalResult.requestId !== next.status.binding.requestId ||
      terminalResult.deliveryId !== next.status.deliveryId ||
      terminalResult.bindingContentSha256 !== next.status.binding.bindingContentSha256 ||
      !isDeepStrictEqual(terminalResult.target, next.status.binding.target) ||
      (terminalResult.status !== next.status.status &&
        !(
          terminalResult.status === 'failed_managed' &&
          next.status.status === 'failed_managed_repaired'
        )) ||
      Date.parse(terminalResult.occurredAt) > Date.parse(next.status.updatedAt) ||
      (next.managedStartSubmission !== undefined &&
        !leaseIsMonotonic(next.managedStartSubmission.currentLease, terminalResult.currentLease)))
  ) {
    throw new Error('Execution terminal result changed persisted delivery or live authority');
  }
  if (next.progressChain.length > 6) throw new Error('Execution progress chain is too long');
  next.progressChain.forEach((progress, index) => {
    companionExecutionTrackExecutionProgressSchema.parse(progress);
    if (progress.sequence !== index + 1)
      throw new Error('Execution progress sequence is not exact');
    if (
      index > 0 &&
      !companionExecutionTrackExecutionProgressTransitionMatches(
        next.progressChain[index - 1]!,
        progress,
      )
    ) {
      throw new Error('Persisted execution progress chain is discontinuous');
    }
  });
  if (
    (next.status.progress === undefined) !== (next.progressChain.length === 0) ||
    (next.status.progress !== undefined &&
      !isDeepStrictEqual(next.status.progress, next.progressChain.at(-1)))
  ) {
    throw new Error('Execution status does not mirror its persisted progress chain');
  }
  if (
    next.managedStartSubmission !== undefined &&
    (!(
      isDeepStrictEqual(next.status.managedStart, next.managedStartSubmission.managedStart) ||
      isDeepStrictEqual(
        resultManagedStart(next.status),
        next.managedStartSubmission.managedStart,
      ) ||
      next.status.serverRecoveryEvidence?.durableReferences.managedStartContentSha256 ===
        next.managedStartSubmission.managedStart.contentSha256
    ) ||
      next.status.deliveryId !== next.managedStartSubmission.deliveryId ||
      next.status.binding.bindingContentSha256 !==
        next.managedStartSubmission.bindingContentSha256 ||
      next.status.progress?.phase !== 'commit_intent_recorded' ||
      !isDeepStrictEqual(next.managedStartSubmission.commitProgress, next.status.progress) ||
      !leaseIsMonotonic(
        next.status.progress.currentLease,
        next.managedStartSubmission.currentLease,
      ))
  ) {
    throw new Error('Execution status does not mirror its managed-start submission');
  }
  if (previous === undefined) {
    if (next.revision !== 1 || next.status.status !== 'queued') {
      throw new Error('Execution history must begin with revision 1 queued');
    }
    return;
  }
  if (next.revision !== previous.revision + 1) throw new Error('Execution event revision fork');
  if (!isDeepStrictEqual(previous.status.binding, next.status.binding)) {
    throw new Error('Execution changed immutable binding authority');
  }
  if (previous.documentAuthoritySha256 !== next.documentAuthoritySha256) {
    throw new Error('Execution changed immutable document authority');
  }
  if (
    previous.managedStartSubmission !== undefined &&
    !isDeepStrictEqual(previous.managedStartSubmission, next.managedStartSubmission)
  ) {
    throw new Error('Execution rewrote its managed-start submission');
  }
  if (
    next.progressChain.length < previous.progressChain.length ||
    !previous.progressChain.every((progress, index) =>
      isDeepStrictEqual(progress, next.progressChain[index]),
    )
  ) {
    throw new Error('Execution rewrote its persisted progress chain');
  }
  if (Date.parse(next.status.updatedAt) < Date.parse(previous.status.updatedAt)) {
    throw new Error('Execution event chronology is not monotonic');
  }
  if (previous.status.deliveryId !== undefined) {
    if (
      previous.status.deliveryId !== next.status.deliveryId ||
      previous.status.dispatchedAt !== next.status.dispatchedAt ||
      !isDeepStrictEqual(previous.status.lease, next.status.lease)
    ) {
      throw new Error('Execution changed immutable original delivery or lease');
    }
  }
  if (previous.status.progress !== undefined && next.status.progress !== undefined) {
    const previousLease = previous.status.progress.currentLease;
    const nextLease = next.status.progress.currentLease;
    if (
      previousLease.leaseId !== nextLease.leaseId ||
      previousLease.sessionId !== nextLease.sessionId ||
      previousLease.documentIncarnationId !== nextLease.documentIncarnationId ||
      !isDeepStrictEqual(previousLease.target, nextLease.target) ||
      Date.parse(nextLease.expiresAt) < Date.parse(previousLease.expiresAt)
    ) {
      throw new Error('Execution current lease is not a monotonic renewal');
    }
  }
  const transition = `${previous.status.status}->${next.status.status}`;
  const allowed = new Set([
    'queued->dispatched',
    'queued->pre_dispatch_authority_expired',
    'dispatched->baseline_attested',
    'dispatched->failed_no_mutation',
    'dispatched->recovery_required',
    'baseline_attested->proof_in_progress',
    'baseline_attested->failed_no_mutation',
    'baseline_attested->recovery_required',
    'proof_in_progress->proof_observed_locked',
    'proof_in_progress->recovery_required',
    'proof_observed_locked->restore_in_progress',
    'proof_observed_locked->recovery_required',
    'restore_in_progress->baseline_restored',
    'restore_in_progress->recovery_required',
    'baseline_restored->commit_intent_recorded',
    'baseline_restored->failed_restored',
    'baseline_restored->recovery_required',
    'commit_intent_recorded->managed_action_in_progress',
    'commit_intent_recorded->recovery_required',
    'managed_action_in_progress->succeeded',
    'managed_action_in_progress->failed_managed',
    'managed_action_in_progress->recovery_required',
    'recovery_required->recovery_required',
    'recovery_required->succeeded',
    'recovery_required->failed_managed',
    'recovery_required->failed_no_mutation',
    'recovery_required->failed_restored',
    'failed_managed->failed_managed',
    'failed_managed->failed_managed_repaired',
  ]);
  if (!allowed.has(transition)) throw new Error(`Invalid execution transition ${transition}`);
}

function assertStoredEvent(
  event: ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']>,
  stored: StoredExecution,
) {
  if (event.id !== eventIdForStored(event.eventType as ExecutionEventType, stored)) {
    throw new Error('Execution event id is not deterministic');
  }
  if (event.createdAt !== stored.status.updatedAt) throw new Error('Execution event time mismatch');
}

function eventIdForStored(eventType: ExecutionEventType, stored: StoredExecution): string {
  let slot: string;
  if (eventType === 'blender.execution-track-execution.queued') slot = 'queued';
  else if (eventType === 'blender.execution-track-execution.dispatched') slot = 'dispatched';
  else if (eventType === 'blender.execution-track-execution.progressed')
    slot = `progress:${stored.status.progress?.sequence ?? 'missing'}`;
  else if (eventType === 'blender.execution-track-execution.managed-started')
    slot = 'managed-started';
  else if (eventType === 'blender.execution-track-execution.recovery-required') slot = 'terminal';
  else if (eventType === 'blender.execution-track-execution.recovery-requested')
    slot = `recovery:${stored.recoveryRequest?.recoveryId ?? 'missing'}`;
  else if (eventType === 'blender.execution-track-execution.reconciled')
    slot = `recovery:${stored.recoveryRequest?.recoveryId ?? 'missing'}:ack`;
  else slot = 'terminal';
  return `blender-execution-track-execution:${stored.status.binding.requestId}:${slot}`;
}

function assertEventTypeMatches(eventType: string, stored: StoredExecution): void {
  if (
    eventType !== eventTypeFor(stored.status) &&
    !(
      eventType === 'blender.execution-track-execution.recovery-requested' &&
      (stored.status.status === 'recovery_required' || stored.status.status === 'failed_managed') &&
      stored.recoveryRequest !== undefined
    ) &&
    !(
      eventType === 'blender.execution-track-execution.reconciled' &&
      stored.recoveryAck !== undefined
    )
  ) {
    throw new Error('Execution event type does not match its status');
  }
}

function assertReplayOwnedSlots(
  eventType: string,
  previous: StoredExecution | undefined,
  stored: StoredExecution,
): void {
  if (previous === undefined) {
    if (
      stored.managedStartSubmission !== undefined ||
      stored.recoveryRequest !== undefined ||
      stored.recoveryAck !== undefined
    ) {
      throw new Error('Initial queued event cannot populate coordinator-owned slots');
    }
    return;
  }

  if (
    eventType !== 'blender.execution-track-execution.progressed' &&
    !isDeepStrictEqual(stored.progressChain, previous.progressChain)
  ) {
    throw new Error('Only progress events may extend the persisted progress chain');
  }

  if (eventType === 'blender.execution-track-execution.managed-started') {
    if (
      previous.managedStartSubmission !== undefined ||
      stored.managedStartSubmission === undefined
    ) {
      throw new Error('Managed-start event must introduce its submission exactly once');
    }
  } else if (!isDeepStrictEqual(stored.managedStartSubmission, previous.managedStartSubmission)) {
    throw new Error('Event changed the coordinator-owned managed-start slot');
  }

  if (eventType === 'blender.execution-track-execution.recovery-requested') {
    if (
      stored.recoveryRequest === undefined ||
      isDeepStrictEqual(stored.recoveryRequest, previous.recoveryRequest) ||
      stored.recoveryAck !== undefined
    ) {
      throw new Error(
        'Recovery-requested event must introduce or rotate a request and clear its ACK',
      );
    }
    return;
  }

  if (eventType === 'blender.execution-track-execution.reconciled') {
    if (
      !isDeepStrictEqual(stored.recoveryRequest, previous.recoveryRequest) ||
      previous.recoveryAck !== undefined ||
      stored.recoveryAck === undefined
    ) {
      throw new Error('Reconciled event must preserve its request and introduce its ACK');
    }
    return;
  }

  if (
    !isDeepStrictEqual(stored.recoveryRequest, previous.recoveryRequest) ||
    !isDeepStrictEqual(stored.recoveryAck, previous.recoveryAck)
  ) {
    throw new Error('Event changed coordinator-owned recovery slots');
  }
}

function assertReplayLiveChronology(eventType: string, stored: StoredExecution): void {
  if (
    stored.status.preDispatchAuthorityExpirationEvidence !== undefined &&
    stored.status.preDispatchAuthorityExpirationEvidence.detectedAt !== stored.status.updatedAt
  ) {
    throw new Error('Pre-dispatch authority evidence time does not match its persisted event');
  }
  if (
    stored.status.serverRecoveryEvidence !== undefined &&
    (eventType === 'blender.execution-track-execution.recovery-required' ||
      eventType === 'blender.execution-track-execution.completed') &&
    stored.status.serverRecoveryEvidence.detectedAt !== stored.status.updatedAt
  ) {
    throw new Error('Server recovery evidence time does not match its persisted event');
  }
  if (
    eventType === 'blender.execution-track-execution.recovery-requested' &&
    stored.recoveryRequest?.requestedAt !== stored.status.updatedAt
  ) {
    throw new Error('Recovery request time does not match its persisted event');
  }
  if (
    eventType === 'blender.execution-track-execution.dispatched' &&
    stored.status.dispatchedAt !== stored.status.updatedAt
  ) {
    throw new Error('Dispatch time does not match its persisted event');
  }

  let evidenceAt: string | undefined;
  let leaseExpiresAt: string | undefined;

  if (eventType === 'blender.execution-track-execution.progressed') {
    evidenceAt = stored.status.progress?.occurredAt;
    leaseExpiresAt = stored.status.progress?.currentLease.expiresAt;
  } else if (eventType === 'blender.execution-track-execution.managed-started') {
    evidenceAt = stored.managedStartSubmission?.managedStart.startedAt;
    leaseExpiresAt = stored.managedStartSubmission?.currentLease.expiresAt;
  } else if (
    (eventType === 'blender.execution-track-execution.completed' ||
      eventType === 'blender.execution-track-execution.recovery-required') &&
    stored.status.result !== undefined
  ) {
    evidenceAt = stored.status.result?.occurredAt;
    leaseExpiresAt = stored.status.result?.currentLease.expiresAt;
  } else if (eventType === 'blender.execution-track-execution.reconciled') {
    evidenceAt = stored.recoveryAck?.occurredAt;
    leaseExpiresAt = stored.recoveryRequest?.replacementLease.expiresAt;
  } else {
    return;
  }

  if (
    evidenceAt === undefined ||
    leaseExpiresAt === undefined ||
    Date.parse(evidenceAt) > Date.parse(stored.status.updatedAt) ||
    Date.parse(stored.status.updatedAt) >= Date.parse(leaseExpiresAt)
  ) {
    throw new Error('Persisted execution event does not retain live receive chronology');
  }
}

function parseStoredExecutionPayload(candidate: unknown): StoredExecution {
  const payload = candidate as StoredExecution;
  return {
    status: companionExecutionTrackExecutionStatusSchema.parse(payload.status),
    documentAuthoritySha256: parseSha256(payload.documentAuthoritySha256),
    progressChain: payload.progressChain.map((progress) =>
      companionExecutionTrackExecutionProgressSchema.parse(progress),
    ),
    ...(payload.managedStartSubmission === undefined
      ? {}
      : {
          managedStartSubmission:
            companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(
              payload.managedStartSubmission,
            ),
        }),
    ...(payload.recoveryRequest === undefined
      ? {}
      : {
          recoveryRequest: companionExecutionTrackExecutionRecoveryRequestSchema.parse(
            payload.recoveryRequest,
          ),
        }),
    ...(payload.recoveryAck === undefined
      ? {}
      : {
          recoveryAck: companionExecutionTrackExecutionRecoveryAckSchema.parse(payload.recoveryAck),
        }),
    revision: payload.revision,
  };
}

export function createBlenderExecutionTrackExecutionCoordinator(
  options: BlenderExecutionTrackExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredExecution>();
  const targetOwners = new Map<string, string>();
  const recoveryAckAuthorizations = new WeakSet<InternalRecoveryAckAuthorization>();

  const apply = (stored: StoredExecution): void => {
    const requestId = stored.status.binding.requestId;
    const key = targetKey(stored.status.binding);
    const owner = targetOwners.get(key);
    if (activeStatuses.has(stored.status.status)) {
      if (owner !== undefined && owner !== requestId) {
        throw new Error(`Executions ${owner} and ${requestId} both own target ${key}`);
      }
      targetOwners.set(key, requestId);
    } else if (owner === requestId) {
      targetOwners.delete(key);
    }
    executions.set(requestId, stored);
  };

  const append = (
    status: CompanionExecutionTrackExecutionStatus,
    recoveryRequest?: CompanionExecutionTrackExecutionRecoveryRequest,
    overrideEventType?: ExecutionEventType,
    recoveryAck?: CompanionExecutionTrackExecutionRecoveryAck,
    clearRecoveryAck = false,
    documentAuthoritySha256?: string,
    managedStartSubmission?: CompanionExecutionTrackExecutionManagedStartSubmission,
    appendEventSink?: (
      input: BlenderExecutionTrackExecutionDeterministicEvent,
    ) => ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']>,
  ): CompanionExecutionTrackExecutionStatus => {
    const parsedStatus = companionExecutionTrackExecutionStatusSchema.parse(status);
    const previous = executions.get(parsedStatus.binding.requestId);
    const previousChain = previous?.progressChain ?? [];
    const progressChain =
      parsedStatus.progress === undefined
        ? previousChain
        : isDeepStrictEqual(previousChain.at(-1), parsedStatus.progress)
          ? previousChain
          : [...previousChain, parsedStatus.progress];
    const stored: StoredExecution = {
      status: parsedStatus,
      documentAuthoritySha256: parseSha256(
        previous?.documentAuthoritySha256 ?? documentAuthoritySha256 ?? '',
      ),
      progressChain,
      ...(managedStartSubmission === undefined
        ? previous?.managedStartSubmission === undefined
          ? {}
          : { managedStartSubmission: previous.managedStartSubmission }
        : {
            managedStartSubmission:
              companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(
                managedStartSubmission,
              ),
          }),
      ...(recoveryRequest === undefined
        ? previous?.recoveryRequest === undefined
          ? {}
          : { recoveryRequest: previous.recoveryRequest }
        : {
            recoveryRequest:
              companionExecutionTrackExecutionRecoveryRequestSchema.parse(recoveryRequest),
          }),
      ...(recoveryAck === undefined
        ? clearRecoveryAck || previous?.recoveryAck === undefined
          ? {}
          : { recoveryAck: previous.recoveryAck }
        : { recoveryAck: companionExecutionTrackExecutionRecoveryAckSchema.parse(recoveryAck) }),
      revision: (previous?.revision ?? 0) + 1,
    };
    assertStoredTransition(previous, stored);
    const eventType = overrideEventType ?? eventTypeFor(parsedStatus);
    assertEventTypeMatches(eventType, stored);
    const eventInput = {
      id: eventIdForStored(eventType, stored),
      eventType,
      payload: stored,
      createdAt: parsedStatus.updatedAt,
    };
    const event =
      appendEventSink === undefined
        ? options.eventStore.appendEvent(eventInput)
        : appendEventSink(eventInput);
    assertStoredEvent(event, stored);
    apply(stored);
    return parsedStatus;
  };

  for (const event of options.eventStore.listExecutionEventsByTypes(eventTypes)) {
    const stored = parseStoredExecutionPayload(event.payload);
    const status = stored.status;
    const previous = executions.get(status.binding.requestId);
    assertEventTypeMatches(event.eventType, stored);
    assertStoredEvent(event, stored);
    assertReplayOwnedSlots(event.eventType, previous, stored);
    assertReplayLiveChronology(event.eventType, stored);
    assertStoredTransition(previous, stored);
    if (event.eventType === 'blender.execution-track-execution.recovery-requested') {
      if (previous === undefined || stored.recoveryRequest === undefined) {
        throw new Error('Recovery request event has no prior execution authority');
      }
      assertRecoveryRequestMatchesStored(previous, stored.recoveryRequest);
      if (
        !isDeepStrictEqual(stored.status, {
          ...previous.status,
          updatedAt: stored.recoveryRequest.requestedAt,
        })
      ) {
        throw new Error('Recovery request event changed execution status authority');
      }
      if (
        previous.recoveryRequest !== undefined &&
        !isDeepStrictEqual(previous.recoveryRequest, stored.recoveryRequest) &&
        !recoveryRotationMatches(previous.recoveryRequest, stored.recoveryRequest)
      ) {
        throw new Error('Persisted recovery challenge rotation is invalid');
      }
    }
    if (event.eventType === 'blender.execution-track-execution.reconciled') {
      if (previous === undefined || stored.recoveryAck === undefined) {
        throw new Error('Recovery acknowledgement event has no current challenge');
      }
      assertRecoveryAckTransition(previous, stored, stored.recoveryAck);
    }
    if (status.result?.status === 'succeeded' || status.result?.status === 'failed_managed') {
      if (previous === undefined) {
        throw new Error('Managed terminal event has no pre-terminal execution status');
      }
      options.validateManagedResult(status.result, previous.status);
    }
    apply(stored);
  }

  const recoverInterrupted = (
    stored: StoredExecution,
    source: 'coordinator_restart' | 'document_authority_drift',
  ) => {
    const status = stored.status;
    if (
      status.status === 'queued' ||
      status.status === 'pre_dispatch_authority_expired' ||
      status.status === 'succeeded' ||
      status.status === 'failed_no_mutation' ||
      status.status === 'failed_restored' ||
      status.status === 'failed_managed' ||
      status.status === 'failed_managed_repaired' ||
      status.status === 'recovery_required'
    ) {
      return status;
    }
    const detectedAt = now();
    const priorStatus = status.status;
    const resolution =
      source === 'document_authority_drift'
        ? 'recovery_required'
        : priorStatus === 'dispatched' && status.progress === undefined
          ? 'failed_no_mutation'
          : priorStatus === 'baseline_restored'
            ? 'failed_restored'
            : 'recovery_required';
    return append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...status,
        status: resolution,
        managedStart: undefined,
        serverRecoveryEvidence: {
          source,
          requestId: status.binding.requestId,
          deliveryId: status.deliveryId,
          bindingContentSha256: status.binding.bindingContentSha256,
          target: status.binding.target,
          leaseId: status.lease?.leaseId,
          sessionId: status.lease?.sessionId,
          documentIncarnationId: status.lease?.documentIncarnationId,
          acceptedProgressChainHeadContentSha256: status.progress?.contentSha256 ?? null,
          durableReferences: recoveryReferences(status.progress, status.managedStart),
          priorStatus,
          detectedAt,
          resolution,
          retainsTargetLock: resolution === 'recovery_required',
          automaticReplay: false,
        },
        updatedAt: detectedAt,
      }),
    );
  };

  for (const stored of [...executions.values()]) recoverInterrupted(stored, 'coordinator_restart');

  const get = (requestId: string) => executions.get(requestId)?.status ?? null;
  const targetLockOwner = (adapterId: 'blender', instanceId: string) => {
    const requestId = targetOwners.get(`${adapterId}:${instanceId}`);
    if (requestId === undefined) return null;
    const status = executions.get(requestId)?.status;
    return status === undefined ? null : { requestId, status: status.status };
  };
  const listTargetLockOwners = () =>
    [...targetOwners.entries()]
      .map(([key, requestId]) => {
        const status = executions.get(requestId)?.status;
        return status === undefined
          ? null
          : {
              targetKey: key,
              adapterId: status.binding.target.adapterId,
              instanceId: status.binding.target.instanceId,
              requestId,
              status: status.status,
            };
      })
      .filter((owner) => owner !== null);
  const ownsTarget = (adapterId: 'blender', instanceId: string) =>
    targetLockOwner(adapterId, instanceId) !== null;

  const reconcileDocumentAuthority = (
    adapterId: 'blender',
    instanceId: string,
    currentDocumentAuthoritySha256: string,
  ) => {
    const authority = parseSha256(currentDocumentAuthoritySha256);
    const reconciled: CompanionExecutionTrackExecutionStatus[] = [];
    for (const stored of [...executions.values()]) {
      if (
        stored.status.binding.target.adapterId !== adapterId ||
        stored.status.binding.target.instanceId !== instanceId ||
        stored.documentAuthoritySha256 === authority ||
        !activeStatuses.has(stored.status.status)
      ) {
        continue;
      }
      if (stored.status.status === 'queued') {
        const detectedAt = now();
        reconciled.push(
          append(
            companionExecutionTrackExecutionStatusSchema.parse({
              ...stored.status,
              status: 'pre_dispatch_authority_expired',
              preDispatchAuthorityExpirationEvidence: {
                source: 'document_authority_drift',
                requestId: stored.status.binding.requestId,
                bindingContentSha256: stored.status.binding.bindingContentSha256,
                target: stored.status.binding.target,
                priorStatus: 'queued',
                detectedAt,
                resolution: 'pre_dispatch_authority_expired',
                retainsTargetLock: false,
                automaticReplay: false,
              },
              updatedAt: detectedAt,
            }),
          ),
        );
      } else {
        reconciled.push(recoverInterrupted(stored, 'document_authority_drift'));
      }
    }
    return reconciled;
  };

  const findForCreate = (input: CompanionExecutionTrackExecutionCreateRequest) => {
    const request = companionExecutionTrackExecutionCreateRequestSchema.parse(input);
    const existing = executions.get(request.requestId)?.status;
    if (existing === undefined) return null;
    if (!isDeepStrictEqual(createRequestFromBinding(existing.binding), request)) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_request_conflict',
        409,
        'The requestId is already bound to different execution create authority',
      );
    }
    return existing;
  };

  const isResultDuplicate = (input: CompanionExecutionTrackExecutionResult): boolean => {
    const result = companionExecutionTrackExecutionResultSchema.parse(input);
    return isDeepStrictEqual(executions.get(result.requestId)?.status.result, result);
  };

  const isRecoveryAckDuplicate = (input: CompanionExecutionTrackExecutionRecoveryAck): boolean => {
    const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse(input);
    return isDeepStrictEqual(executions.get(ack.requestId)?.recoveryAck, ack);
  };

  const adoptDurableManagedRepairAck = (
    input: CompanionExecutionTrackExecutionRecoveryAck,
  ): boolean => {
    const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse(input);
    if (ack.evidence.kind !== 'managed_repair_terminal') {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_repair_adoption_invalid',
        422,
        'Only an exact managed-repair acknowledgement may adopt durable reconciliation',
      );
    }
    const current = executions.get(ack.requestId);
    if (
      current?.status.status === 'failed_managed_repaired' &&
      isDeepStrictEqual(current.recoveryAck, ack)
    ) {
      return true;
    }
    if (
      current === undefined ||
      current.status.status !== 'failed_managed' ||
      current.status.result?.status !== 'failed_managed' ||
      current.recoveryAck !== undefined ||
      !isDeepStrictEqual(current.recoveryRequest, ack.request)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_repair_adoption_conflict',
        409,
        'Durable managed-repair acknowledgement conflicts with current coordinator authority',
      );
    }
    const expectedEventId = `blender-execution-track-execution:${ack.requestId}:recovery:${ack.request.recoveryId}:ack`;
    const durableEvents = options.eventStore
      .listExecutionEventsByTypes(eventTypes)
      .filter((event) => event.id === expectedEventId);
    if (durableEvents.length === 0) return false;
    if (durableEvents.length !== 1) {
      throw new Error('Durable managed-repair reconciliation event is not unique');
    }
    const durableEvent = durableEvents[0]!;
    const durableStored = parseStoredExecutionPayload(durableEvent.payload);
    assertEventTypeMatches(durableEvent.eventType, durableStored);
    assertStoredEvent(durableEvent, durableStored);
    assertReplayOwnedSlots(durableEvent.eventType, current, durableStored);
    assertReplayLiveChronology(durableEvent.eventType, durableStored);
    assertStoredTransition(current, durableStored);
    if (
      durableStored.recoveryAck === undefined ||
      !isDeepStrictEqual(durableStored.recoveryAck, ack)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_repair_adoption_conflict',
        409,
        'Durable managed-repair reconciliation does not contain the exact acknowledgement',
      );
    }
    assertRecoveryAckTransition(current, durableStored, durableStored.recoveryAck);
    apply(durableStored);
    return true;
  };

  const queue = (
    input: CompanionExecutionTrackExecutionBinding,
    documentAuthoritySha256: string,
  ) => {
    const binding = companionExecutionTrackExecutionBindingSchema.parse(input);
    const authority = parseSha256(documentAuthoritySha256);
    const existing = executions.get(binding.requestId);
    if (existing !== undefined) {
      if (
        isDeepStrictEqual(existing.status.binding, binding) &&
        existing.documentAuthoritySha256 === authority
      )
        return existing.status;
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_binding_conflict',
        409,
        'The requestId is already bound to different execution authority',
      );
    }
    const owner = targetOwners.get(targetKey(binding));
    if (owner !== undefined) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_target_locked',
        409,
        `Execution ${owner} owns the target lock`,
      );
    }
    const externalOwner = options.externalTargetLockOwner?.(
      binding.target.adapterId,
      binding.target.instanceId,
    );
    if (externalOwner != null) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_external_target_locked',
        409,
        `Execution ${externalOwner} owns the target lock in another coordinator`,
      );
    }
    return append(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        status: 'queued',
        updatedAt: binding.requestedAt,
      }),
      undefined,
      undefined,
      undefined,
      false,
      authority,
    );
  };

  const dispatch = (input: CompanionExecutionTrackExecutionDelivery) => {
    const delivery = companionExecutionTrackExecutionDeliverySchema.parse(input);
    const stored = executions.get(delivery.binding.requestId);
    if (stored === undefined) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_found',
        404,
        'Execution not found',
      );
    }
    if (stored.status.status === 'dispatched' && sameDelivery(stored.status, delivery)) {
      return stored.status;
    }
    if (
      stored.status.status !== 'queued' ||
      !isDeepStrictEqual(stored.status.binding, delivery.binding)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_delivery_conflict',
        409,
        'Delivery does not match the queued immutable binding',
      );
    }
    return append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        deliveryId: delivery.deliveryId,
        lease: delivery.lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'dispatched',
        updatedAt: delivery.dispatchedAt,
      }),
    );
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    currentDocumentAuthoritySha256: string,
    inputLease: CompanionExecutionTrackExecutionDelivery['lease'],
  ): CompanionExecutionTrackExecutionDelivery | null => {
    const authority = parseSha256(currentDocumentAuthoritySha256);
    const dispatched = [...executions.values()].find(
      ({ status }) =>
        status.status === 'dispatched' &&
        status.progress === undefined &&
        status.binding.target.adapterId === adapterId &&
        status.binding.target.instanceId === instanceId,
    );
    if (dispatched !== undefined) {
      if (dispatched.documentAuthoritySha256 !== authority) {
        reconcileDocumentAuthority(adapterId, instanceId, authority);
        return null;
      }
      if (
        dispatched.status.lease === undefined ||
        !isDeepStrictEqual(inputLease.target, dispatched.status.binding.target) ||
        !leaseIsMonotonic(dispatched.status.lease, inputLease) ||
        Date.parse(now()) >= Date.parse(inputLease.expiresAt)
      ) {
        return null;
      }
      return companionExecutionTrackExecutionDeliverySchema.parse({
        binding: dispatched.status.binding,
        deliveryId: dispatched.status.deliveryId,
        lease: dispatched.status.lease,
        dispatchedAt: dispatched.status.dispatchedAt,
      });
    }
    const pending = [...executions.values()]
      .filter(
        ({ status }) =>
          status.status === 'queued' &&
          status.binding.target.adapterId === adapterId &&
          status.binding.target.instanceId === instanceId,
      )
      .sort(
        (left, right) =>
          left.status.binding.requestedAt.localeCompare(right.status.binding.requestedAt) ||
          left.status.binding.requestId.localeCompare(right.status.binding.requestId),
      )[0];
    if (pending === undefined) return null;
    if (pending.documentAuthoritySha256 !== authority) {
      reconcileDocumentAuthority(adapterId, instanceId, authority);
      return null;
    }
    if (options.externalTargetLockOwner?.(adapterId, instanceId) != null) return null;
    const generated = companionExecutionTrackExecutionDeliverySchema.parse({
      binding: pending.status.binding,
      deliveryId: createId(),
      lease: inputLease,
      dispatchedAt: now(),
    });
    dispatch(generated);
    return generated;
  };

  const acceptProgress = (
    input: CompanionExecutionTrackExecutionProgress,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
  ): 'accepted' | 'duplicate' => {
    const progress = companionExecutionTrackExecutionProgressSchema.parse(input);
    const stored = executions.get(progress.binding.requestId);
    if (stored === undefined)
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_found',
        404,
        'Execution not found',
      );
    const receivedAt = now();
    assertLiveAuthority(
      stored,
      liveAuthority,
      progress.currentLease,
      progress.occurredAt,
      receivedAt,
    );
    if (stored.status.progress !== undefined) {
      const accepted = stored.progressChain[progress.sequence - 1];
      if (accepted !== undefined && isDeepStrictEqual(accepted, progress)) return 'duplicate';
      if (progress.sequence <= stored.status.progress.sequence) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_progress_fork',
          409,
          'Progress is stale or forks the accepted chain',
        );
      }
      if (
        !companionExecutionTrackExecutionProgressTransitionMatches(stored.status.progress, progress)
      ) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_progress_transition',
          409,
          'Progress does not extend the exact accepted chain head',
        );
      }
    } else {
      if (
        stored.status.status !== 'dispatched' ||
        progress.phase !== 'baseline_attested' ||
        progress.sequence !== 1 ||
        progress.previousProgressContentSha256 !== null ||
        !sameDelivery(stored.status, progress)
      ) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_progress_transition',
          409,
          'First progress does not match the immutable delivery',
        );
      }
    }
    if (
      !activeStatuses.has(stored.status.status) ||
      stored.status.status === 'failed_managed' ||
      stored.status.status === 'recovery_required'
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_progressable',
        409,
        'Execution cannot accept progress in its current state',
      );
    }
    append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        status: progress.phase,
        progress,
        updatedAt: receivedAt,
      }),
    );
    return 'accepted';
  };

  const startManaged = (
    input: CompanionExecutionTrackExecutionManagedStartSubmission,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
  ): 'accepted' | 'duplicate' => {
    const submission = companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(input);
    const managedStart = submission.managedStart;
    const stored = executions.get(submission.requestId);
    if (stored === undefined || stored.status.progress?.phase !== 'commit_intent_recorded') {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_commit_intent_not_found',
        404,
        'Commit intent not found',
      );
    }
    const receivedAt = now();
    assertLiveAuthority(
      stored,
      liveAuthority,
      submission.currentLease,
      managedStart.startedAt,
      receivedAt,
    );
    if (!isDeepStrictEqual(submission.commitProgress, stored.status.progress)) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_start_commit_head',
        409,
        'Managed-start submission does not mirror the accepted commit progress head',
      );
    }
    if (
      stored.status.status === 'managed_action_in_progress' &&
      isDeepStrictEqual(stored.managedStartSubmission, submission)
    )
      return 'duplicate';
    if (stored.status.status !== 'commit_intent_recorded') {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_start_conflict',
        409,
        'Managed action cannot start in the current state',
      );
    }
    if (
      submission.deliveryId !== stored.status.deliveryId ||
      submission.bindingContentSha256 !== stored.status.binding.bindingContentSha256 ||
      currentLeaseForStored(stored) === undefined ||
      !leaseIsMonotonic(currentLeaseForStored(stored)!, submission.currentLease)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_start_authority',
        409,
        'Managed-start submission changed delivery, binding, or current lease authority',
      );
    }
    append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        status: 'managed_action_in_progress',
        managedStart,
        updatedAt: receivedAt,
      }),
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      submission,
    );
    return 'accepted';
  };

  const acceptResult = (
    input: CompanionExecutionTrackExecutionResult,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
  ): 'accepted' | 'duplicate' => {
    const result = companionExecutionTrackExecutionResultSchema.parse(input);
    const stored = executions.get(result.requestId);
    if (stored === undefined)
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_found',
        404,
        'Execution not found',
      );
    const receivedAt = now();
    assertLiveAuthority(stored, liveAuthority, result.currentLease, result.occurredAt, receivedAt);
    if (stored.status.result !== undefined) {
      if (isDeepStrictEqual(stored.status.result, result)) return 'duplicate';
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_result_conflict',
        409,
        'Execution already has a different terminal result',
      );
    }
    const lease = currentLeaseForStored(stored);
    if (
      result.deliveryId !== stored.status.deliveryId ||
      result.bindingContentSha256 !== stored.status.binding.bindingContentSha256 ||
      !isDeepStrictEqual(result.target, stored.status.binding.target) ||
      lease === undefined ||
      result.currentLease.leaseId !== lease.leaseId ||
      result.currentLease.sessionId !== lease.sessionId ||
      result.currentLease.documentIncarnationId !== lease.documentIncarnationId ||
      !isDeepStrictEqual(result.currentLease.target, lease.target) ||
      Date.parse(result.currentLease.expiresAt) < Date.parse(lease.expiresAt)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_result_identity',
        409,
        'Result changed delivery or lease authority',
      );
    }
    const expectedStatus =
      result.status === 'failed_no_mutation'
        ? 'baseline_attested'
        : result.status === 'failed_restored'
          ? 'baseline_restored'
          : result.status === 'succeeded' || result.status === 'failed_managed'
            ? 'managed_action_in_progress'
            : stored.status.status;
    if (stored.status.status !== expectedStatus) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_result_phase',
        409,
        'Result is not valid after the accepted progress phase',
      );
    }
    if (result.status === 'recovery_required') {
      const phase = stored.status.progress?.phase;
      const validReason =
        (result.recoveryReason === 'managed_state_indeterminate' &&
          phase === 'commit_intent_recorded' &&
          stored.managedStartSubmission !== undefined) ||
        (result.recoveryReason === 'document_authority_drift' &&
          stored.status.serverRecoveryEvidence?.source === 'document_authority_drift') ||
        (result.recoveryReason === 'proof_history_locked' &&
          (phase === 'proof_observed_locked' || phase === 'restore_in_progress')) ||
        (result.recoveryReason === 'baseline_unproven' &&
          phase !== undefined &&
          phase !== 'commit_intent_recorded');
      if (!validReason) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_recovery_result_phase',
          409,
          'Companion recovery result reason does not match accepted progress authority',
        );
      }
    }
    if (result.status === 'succeeded' || result.status === 'failed_managed') {
      options.validateManagedResult(result, stored.status);
    }
    append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        status: result.status,
        managedStart: undefined,
        result,
        serverRecoveryEvidence: undefined,
        updatedAt: receivedAt,
      }),
    );
    return 'accepted';
  };

  const requestRecovery = (input: CompanionExecutionTrackExecutionRecoveryRequest) => {
    const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse(input);
    const stored = executions.get(request.requestId);
    if (stored === undefined)
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_found',
        404,
        'Execution not found',
      );
    if (stored.status.status !== 'recovery_required' && stored.status.status !== 'failed_managed')
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_recoverable',
        409,
        'Execution does not require recovery',
      );
    try {
      assertRecoveryRequestMatchesStored(stored, request);
    } catch {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_challenge',
        409,
        'Recovery request does not mirror durable execution authority',
      );
    }
    if (stored.recoveryRequest !== undefined) {
      if (isDeepStrictEqual(stored.recoveryRequest, request)) return stored.recoveryRequest;
      if (!recoveryRotationMatches(stored.recoveryRequest, request)) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_recovery_conflict',
          409,
          'Recovery challenge rotation changed immutable authority or chronology',
        );
      }
    }
    append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        updatedAt: request.requestedAt,
      }),
      request,
      'blender.execution-track-execution.recovery-requested',
      undefined,
      true,
    );
    return request;
  };

  const pollRecovery = (
    adapterId: 'blender',
    instanceId: string,
    replacementLease: CompanionExecutionTrackExecutionDelivery['lease'],
  ): CompanionExecutionTrackExecutionRecoveryRequest | null => {
    const pending = [...executions.values()]
      .filter(
        ({ status }) =>
          (status.status === 'recovery_required' || status.status === 'failed_managed') &&
          status.binding.target.adapterId === adapterId &&
          status.binding.target.instanceId === instanceId &&
          status.lease?.sessionId === replacementLease.sessionId &&
          status.lease.documentIncarnationId === replacementLease.documentIncarnationId &&
          isDeepStrictEqual(status.binding.target, replacementLease.target),
      )
      .sort(
        (left, right) =>
          left.status.binding.requestedAt.localeCompare(right.status.binding.requestedAt) ||
          left.status.binding.requestId.localeCompare(right.status.binding.requestId),
      )[0];
    if (pending === undefined || pending.status.lease === undefined) return null;
    const requestedAt = now();
    if (
      pending.recoveryRequest !== undefined &&
      isDeepStrictEqual(pending.recoveryRequest.replacementLease, replacementLease) &&
      Date.parse(requestedAt) < Date.parse(pending.recoveryRequest.replacementLease.expiresAt)
    ) {
      try {
        assertRecoveryRequestMatchesStored(pending, pending.recoveryRequest);
        return pending.recoveryRequest;
      } catch {
        // Durable authority advanced (for example, a marker ACK enabled repair), so rotate below.
      }
    }
    if (Date.parse(requestedAt) >= Date.parse(replacementLease.expiresAt)) return null;
    const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      formatVersion: pending.status.binding.formatVersion,
      recoveryId: createId(),
      requestId: pending.status.binding.requestId,
      target: pending.status.binding.target,
      originalDeliveryId: pending.status.deliveryId,
      bindingContentSha256: pending.status.binding.bindingContentSha256,
      originalLease: pending.status.lease,
      replacementLease,
      acceptedProgress: pending.status.progress ?? null,
      acceptedProgressChainHeadContentSha256: pending.status.progress?.contentSha256 ?? null,
      durableReferences:
        pending.status.serverRecoveryEvidence?.durableReferences ??
        recoveryReferencesForStored(pending),
      source: recoverySourceFor(pending),
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt,
    });
    return requestRecovery(request);
  };

  const processRecoveryAck = (
    input: CompanionExecutionTrackExecutionRecoveryAck,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
    commit: boolean,
    authorizedAt?: string,
    appendEventSink?: (
      input: BlenderExecutionTrackExecutionDeterministicEvent,
    ) => ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']>,
  ): 'accepted' | 'duplicate' => {
    const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse(input);
    const stored = executions.get(ack.requestId);
    if (stored === undefined)
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_not_found',
        404,
        'Execution not found',
      );
    const receivedAt = authorizedAt ?? now();
    if (
      parseSha256(liveAuthority.documentAuthoritySha256) !== stored.documentAuthoritySha256 ||
      !isDeepStrictEqual(liveAuthority.target, stored.status.binding.target) ||
      !isDeepStrictEqual(liveAuthority.lease.target, liveAuthority.target) ||
      Date.parse(ack.occurredAt) > Date.parse(receivedAt) ||
      Date.parse(receivedAt) >= Date.parse(liveAuthority.lease.expiresAt)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_live_authority',
        409,
        'Recovery acknowledgement does not match live replacement authority',
      );
    }
    if (stored.recoveryAck !== undefined && isDeepStrictEqual(stored.recoveryAck, ack)) {
      return 'duplicate';
    }
    if (
      stored.recoveryRequest === undefined ||
      !isDeepStrictEqual(liveAuthority.lease, stored.recoveryRequest.replacementLease)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_live_authority',
        409,
        'Recovery acknowledgement does not match live replacement authority',
      );
    }
    if (
      stored.recoveryRequest === undefined ||
      !isDeepStrictEqual(ack.request, stored.recoveryRequest)
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_ack_challenge',
        409,
        'Recovery acknowledgement does not match the issued challenge',
      );
    }
    if (
      (ack.outcome === 'recovery_required' &&
        (ack.evidence.kind !== 'unresolved_current_state' || !ack.retainsTargetLock)) ||
      (ack.outcome === 'reconciled' &&
        (ack.evidence.kind === 'unresolved_current_state' ||
          ack.retainsTargetLock !==
            (ack.evidence.kind === 'managed_repair_terminal'
              ? false
              : ack.evidence.terminalResult.status === 'failed_managed')))
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_ack_semantics',
        409,
        'Recovery acknowledgement changed its reconciliation or target-lock semantics',
      );
    }
    if (stored.recoveryAck !== undefined) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_ack_conflict',
        409,
        'Recovery already accepted a different acknowledgement',
      );
    }
    if (
      stored.status.result !== undefined &&
      stored.status.result.status !== 'recovery_required' &&
      ack.evidence.kind !== 'unresolved_current_state' &&
      ack.evidence.kind !== 'managed_repair_terminal'
    ) {
      const bindsUnattestedFailedTerminal =
        stored.status.status === 'failed_managed' &&
        stored.recoveryAck === undefined &&
        ack.evidence.kind === 'persisted_managed_terminal' &&
        ack.evidence.terminalResult.status === 'failed_managed' &&
        isDeepStrictEqual(stored.status.result, ack.evidence.terminalResult);
      if (!bindsUnattestedFailedTerminal) {
        if (isDeepStrictEqual(stored.status.result, ack.evidence.terminalResult))
          return 'duplicate';
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_recovery_ack_conflict',
          409,
          'Recovery already reconciled a different result',
        );
      }
    }
    if (ack.outcome === 'recovery_required') {
      if (!commit) return 'accepted';
      append(
        companionExecutionTrackExecutionStatusSchema.parse({
          ...stored.status,
          updatedAt: receivedAt,
        }),
        stored.recoveryRequest,
        'blender.execution-track-execution.reconciled',
        ack,
        false,
        undefined,
        undefined,
        appendEventSink,
      );
      return 'accepted';
    }
    if (ack.evidence.kind === 'unresolved_current_state') {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_ack_invalid',
        422,
        'Reconciled recovery requires terminal evidence',
      );
    }
    if (ack.evidence.kind === 'managed_repair_terminal') {
      if (
        stored.status.status !== 'failed_managed' ||
        stored.status.result?.status !== 'failed_managed' ||
        !isDeepStrictEqual(stored.status.result, ack.evidence.failedTerminalResult)
      ) {
        throw new BlenderExecutionTrackExecutionError(
          'execution_track_execution_managed_repair_terminal',
          409,
          'Managed repair does not bind the exact retained failed terminal',
        );
      }
      if (!commit) return 'accepted';
      append(
        companionExecutionTrackExecutionStatusSchema.parse({
          ...stored.status,
          status: 'failed_managed_repaired',
          serverRecoveryEvidence: undefined,
          // The event must be identical when an atomic store committed before the
          // in-memory apply completed. The signed ACK time is stable across retry;
          // the server receive time is only live-authority validation evidence.
          updatedAt: ack.occurredAt,
        }),
        stored.recoveryRequest,
        'blender.execution-track-execution.reconciled',
        ack,
        false,
        undefined,
        undefined,
        appendEventSink,
      );
      return 'accepted';
    }
    if (
      ack.evidence.kind === 'persisted_managed_terminal' &&
      (stored.managedStartSubmission === undefined ||
        stored.recoveryRequest.durableReferences.managedStartContentSha256 !==
          stored.managedStartSubmission.managedStart.contentSha256 ||
        !isDeepStrictEqual(
          ack.evidence.terminalResult.managedStart,
          stored.managedStartSubmission.managedStart,
        ))
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_unpersisted_managed_start',
        409,
        'Managed terminal cannot be reconciled without the exact persisted managed-start submission',
      );
    }
    const result = ack.evidence.terminalResult;
    if (result.status === 'succeeded' || result.status === 'failed_managed') {
      options.validateManagedResult(result, stored.status);
    }
    if (!commit) return 'accepted';
    append(
      companionExecutionTrackExecutionStatusSchema.parse({
        ...stored.status,
        status: result.status,
        result,
        serverRecoveryEvidence: undefined,
        updatedAt: receivedAt,
      }),
      stored.recoveryRequest,
      'blender.execution-track-execution.reconciled',
      ack,
      false,
      undefined,
      undefined,
      appendEventSink,
    );
    return 'accepted';
  };

  const authorizeRecoveryAck = (
    input: CompanionExecutionTrackExecutionRecoveryAck,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
  ): BlenderExecutionTrackExecutionRecoveryAckAuthorization => {
    const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse(input);
    const authorizedAt = now();
    const result = processRecoveryAck(ack, liveAuthority, false, authorizedAt);
    const stored = executions.get(ack.requestId);
    if (stored === undefined) throw new Error('Authorized recovery acknowledgement disappeared');
    const authorization: InternalRecoveryAckAuthorization = {
      result,
      ack,
      liveAuthority,
      authorizedAt,
      revision: stored.revision,
    };
    recoveryAckAuthorizations.add(authorization);
    return authorization;
  };

  const commitAuthorizedRecoveryAck = (
    input: BlenderExecutionTrackExecutionRecoveryAckAuthorization,
    commitOptions?: BlenderExecutionTrackExecutionRecoveryAckCommitOptions,
  ): 'accepted' | 'duplicate' => {
    const authorization = input as InternalRecoveryAckAuthorization;
    const stored = executions.get(authorization.ack.requestId);
    if (
      !recoveryAckAuthorizations.has(authorization) ||
      stored === undefined ||
      stored.revision !== authorization.revision
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_recovery_authorization_stale',
        409,
        'Recovery acknowledgement authorization is stale or was not issued by this coordinator',
      );
    }
    recoveryAckAuthorizations.delete(authorization);
    const managedRepairEvidence =
      authorization.ack.evidence.kind === 'managed_repair_terminal'
        ? authorization.ack.evidence
        : undefined;
    if (
      authorization.result === 'accepted' &&
      managedRepairEvidence !== undefined &&
      commitOptions?.commitManagedRepair === undefined
    ) {
      throw new BlenderExecutionTrackExecutionError(
        'execution_track_execution_managed_repair_atomic_commit_required',
        409,
        'Managed repair requires atomic evidence and reconciliation-event persistence',
      );
    }
    return processRecoveryAck(
      authorization.ack,
      authorization.liveAuthority,
      true,
      authorization.authorizedAt,
      managedRepairEvidence === undefined || commitOptions?.commitManagedRepair === undefined
        ? undefined
        : (reconciledEvent) =>
            commitOptions.commitManagedRepair({
              evidence: managedRepairEvidence,
              reconciledEvent,
            }),
    );
  };

  const acceptRecoveryAck = (
    input: CompanionExecutionTrackExecutionRecoveryAck,
    liveAuthority: BlenderExecutionTrackExecutionLiveAuthority,
  ): 'accepted' | 'duplicate' =>
    commitAuthorizedRecoveryAck(authorizeRecoveryAck(input, liveAuthority));

  return {
    acceptProgress,
    acceptRecoveryAck,
    adoptDurableManagedRepairAck,
    authorizeRecoveryAck,
    commitAuthorizedRecoveryAck,
    acceptResult,
    findForCreate,
    get,
    isRecoveryAckDuplicate,
    isResultDuplicate,
    listTargetLockOwners,
    ownsTarget,
    poll,
    pollRecovery,
    queue,
    reconcileDocumentAuthority,
    startManaged,
    targetLockOwner,
  };
}

export type BlenderExecutionTrackExecutionCoordinator = ReturnType<
  typeof createBlenderExecutionTrackExecutionCoordinator
>;
