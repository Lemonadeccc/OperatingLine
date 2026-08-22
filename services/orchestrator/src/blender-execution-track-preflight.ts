import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionExecutionTrackPreflightBindingSchema,
  companionExecutionTrackPreflightCreateRequestSchema,
  companionExecutionTrackPreflightDeliverySchema,
  companionExecutionTrackPreflightLeaseSchema,
  companionExecutionTrackPreflightResultSchema,
  companionExecutionTrackPreflightStatusSchema,
  type CompanionExecutionTrackPreflightBinding,
  type CompanionExecutionTrackPreflightCreateRequest,
  type CompanionExecutionTrackPreflightDelivery,
  type CompanionExecutionTrackPreflightLease,
  type CompanionExecutionTrackPreflightResult,
  type CompanionExecutionTrackPreflightStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

const eventTypes = [
  'blender.execution-track-preflight.queued',
  'blender.execution-track-preflight.dispatched',
  'blender.execution-track-preflight.completed',
  'blender.execution-track-preflight.recovery-required',
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const storedPreflightSchema = z.strictObject({
  preflight: companionExecutionTrackPreflightStatusSchema,
  sessionFingerprintSha256: sha256Schema,
});
type StoredPreflight = z.infer<typeof storedPreflightSchema>;
type PreflightDatabase = Pick<OperatingLineDatabase, 'appendEvent' | 'listExecutionEventsByTypes'>;
type PreflightEventType = (typeof eventTypes)[number];

export class BlenderExecutionTrackPreflightError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderExecutionTrackPreflightError';
  }
}

export interface BlenderExecutionTrackPreflightCoordinatorOptions {
  /**
   * The event store must have one coordinator writer. Replay fails closed when persisted history
   * already contains competing active owners, but this in-memory coordinator cannot arbitrate two
   * processes racing to append against the same target.
   */
  readonly database: PreflightDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly externalHistoryLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

function createRequestFromBinding(
  binding: CompanionExecutionTrackPreflightBinding,
): CompanionExecutionTrackPreflightCreateRequest {
  return companionExecutionTrackPreflightCreateRequestSchema.parse({
    formatVersion: binding.formatVersion,
    requestId: binding.requestId,
    target: binding.target,
    proposalId: binding.proposal.id,
    plan: binding.plan,
    executionId: binding.executionId,
    leafId: binding.leafId,
    override: binding.override,
    expectedState: binding.expectedState,
  });
}

function sameCreateRequest(
  binding: CompanionExecutionTrackPreflightBinding,
  request: CompanionExecutionTrackPreflightCreateRequest,
): boolean {
  return isDeepStrictEqual(createRequestFromBinding(binding), request);
}

function sameImmutablePreflight(
  left: CompanionExecutionTrackPreflightStatus,
  right: CompanionExecutionTrackPreflightStatus,
): boolean {
  return isDeepStrictEqual(left.binding, right.binding);
}

function sameDeliveryIdentity(
  left: CompanionExecutionTrackPreflightStatus,
  right: CompanionExecutionTrackPreflightStatus,
): boolean {
  return (
    left.deliveryId === right.deliveryId &&
    left.dispatchedAt === right.dispatchedAt &&
    isDeepStrictEqual(left.lease, right.lease)
  );
}

function eventTypeForStatus(
  status: CompanionExecutionTrackPreflightStatus['status'],
): PreflightEventType {
  switch (status) {
    case 'queued':
      return 'blender.execution-track-preflight.queued';
    case 'dispatched':
      return 'blender.execution-track-preflight.dispatched';
    case 'verified_unavailable':
    case 'rejected':
      return 'blender.execution-track-preflight.completed';
    case 'recovery_required':
      return 'blender.execution-track-preflight.recovery-required';
  }
}

function eventIdForStatus(preflight: CompanionExecutionTrackPreflightStatus): string {
  return `blender-execution-track-preflight:${preflight.binding.requestId}:${preflight.status}`;
}

function targetKeyFor(preflight: CompanionExecutionTrackPreflightStatus): string {
  return `${preflight.binding.target.adapterId}:${preflight.binding.target.instanceId}`;
}

function assertTargetOwnershipTransition(
  owners: ReadonlyMap<string, string>,
  previous: StoredPreflight | undefined,
  next: StoredPreflight,
): void {
  const requestId = next.preflight.binding.requestId;
  const targetKey = targetKeyFor(next.preflight);
  const owner = owners.get(targetKey);
  if (previous === undefined) {
    if (owner !== undefined && owner !== requestId) {
      throw new Error(
        `Execution-track preflights ${owner} and ${requestId} both own target ${targetKey}`,
      );
    }
    return;
  }
  if (owner !== requestId) {
    throw new Error(
      `Execution-track preflight ${requestId} cannot transition target ${targetKey} owned by ${owner ?? 'nobody'}`,
    );
  }
}

function applyTargetOwnershipTransition(
  owners: Map<string, string>,
  previous: StoredPreflight | undefined,
  next: StoredPreflight,
): void {
  const targetKey = targetKeyFor(next.preflight);
  if (previous === undefined || next.preflight.status === 'dispatched') {
    owners.set(targetKey, next.preflight.binding.requestId);
    return;
  }
  owners.delete(targetKey);
}

function sameResultIdentity(
  preflight: CompanionExecutionTrackPreflightStatus,
  result: CompanionExecutionTrackPreflightResult,
): boolean {
  const binding = preflight.binding;
  return (
    result.formatVersion === binding.formatVersion &&
    result.requestId === binding.requestId &&
    result.replayId === binding.replayId &&
    result.deliveryId === preflight.deliveryId &&
    result.bindingContentSha256 === binding.bindingContentSha256 &&
    isDeepStrictEqual(result.target, binding.target) &&
    result.leaseId === preflight.lease?.leaseId &&
    result.proposalId === binding.proposal.id &&
    result.planId === binding.plan.id &&
    result.planRevision === binding.plan.revision &&
    result.executionId === binding.executionId &&
    result.leafId === binding.leafId
  );
}

function assertStoredTransition(
  previous: StoredPreflight | undefined,
  next: StoredPreflight,
): void {
  if (previous === undefined) {
    if (next.preflight.status !== 'queued') {
      throw new Error(
        `Execution-track preflight ${next.preflight.binding.requestId} is missing queued`,
      );
    }
    return;
  }
  if (!sameImmutablePreflight(previous.preflight, next.preflight)) {
    throw new Error(
      `Execution-track preflight ${next.preflight.binding.requestId} changed immutable authority`,
    );
  }
  const transition = `${previous.preflight.status}->${next.preflight.status}`;
  if (
    transition !== 'queued->dispatched' &&
    transition !== 'dispatched->verified_unavailable' &&
    transition !== 'dispatched->rejected' &&
    transition !== 'dispatched->recovery_required'
  ) {
    throw new Error(
      `Execution-track preflight ${next.preflight.binding.requestId} has invalid transition ${transition}`,
    );
  }
  if (
    previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 &&
    transition !== 'queued->dispatched'
  ) {
    throw new Error(
      `Execution-track preflight ${next.preflight.binding.requestId} changed its session outside dispatch`,
    );
  }
  if (
    previous.preflight.status !== 'queued' &&
    !sameDeliveryIdentity(previous.preflight, next.preflight)
  ) {
    throw new Error(
      `Execution-track preflight ${next.preflight.binding.requestId} changed immutable delivery identity`,
    );
  }
  if (Date.parse(next.preflight.updatedAt) < Date.parse(previous.preflight.updatedAt)) {
    throw new Error(
      `Execution-track preflight ${next.preflight.binding.requestId} has non-monotonic chronology`,
    );
  }
}

function assertStoredEvent(
  event: {
    readonly id: string;
    readonly eventType: string;
    readonly createdAt: string;
  },
  stored: StoredPreflight,
): void {
  if (event.eventType !== eventTypeForStatus(stored.preflight.status)) {
    throw new Error(
      `Execution-track preflight ${stored.preflight.binding.requestId} has mismatched event type`,
    );
  }
  if (event.id !== eventIdForStatus(stored.preflight)) {
    throw new Error(
      `Execution-track preflight ${stored.preflight.binding.requestId} has non-deterministic event id`,
    );
  }
  if (event.createdAt !== stored.preflight.updatedAt) {
    throw new Error(
      `Execution-track preflight ${stored.preflight.binding.requestId} has mismatched event chronology`,
    );
  }
  if (
    stored.preflight.status === 'queued' &&
    stored.preflight.updatedAt !== stored.preflight.binding.requestedAt
  ) {
    throw new Error(
      `Execution-track preflight ${stored.preflight.binding.requestId} queued outside its request time`,
    );
  }
  if (
    stored.preflight.status === 'dispatched' &&
    stored.preflight.updatedAt !== stored.preflight.dispatchedAt
  ) {
    throw new Error(
      `Execution-track preflight ${stored.preflight.binding.requestId} has mismatched dispatch time`,
    );
  }
}

export function createBlenderExecutionTrackPreflightCoordinator(
  options: BlenderExecutionTrackPreflightCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const preflights = new Map<string, StoredPreflight>();
  const activeTargetOwners = new Map<string, string>();

  const append = (
    eventType: PreflightEventType,
    input: StoredPreflight,
  ): CompanionExecutionTrackPreflightStatus => {
    const stored = storedPreflightSchema.parse(input);
    const previous = preflights.get(stored.preflight.binding.requestId);
    assertStoredTransition(previous, stored);
    assertTargetOwnershipTransition(activeTargetOwners, previous, stored);
    if (eventType !== eventTypeForStatus(stored.preflight.status)) {
      throw new Error(
        `Execution-track preflight ${stored.preflight.binding.requestId} has mismatched event type`,
      );
    }
    const event = options.database.appendEvent({
      id: eventIdForStatus(stored.preflight),
      eventType,
      payload: stored,
      createdAt: stored.preflight.updatedAt,
    });
    assertStoredEvent(event, stored);
    applyTargetOwnershipTransition(activeTargetOwners, previous, stored);
    preflights.set(stored.preflight.binding.requestId, stored);
    return stored.preflight;
  };

  for (const event of options.database.listExecutionEventsByTypes(eventTypes)) {
    const stored = storedPreflightSchema.parse(event.payload);
    const previous = preflights.get(stored.preflight.binding.requestId);
    assertStoredEvent(event, stored);
    assertStoredTransition(previous, stored);
    assertTargetOwnershipTransition(activeTargetOwners, previous, stored);
    applyTargetOwnershipTransition(activeTargetOwners, previous, stored);
    preflights.set(stored.preflight.binding.requestId, stored);
  }
  for (const stored of [...preflights.values()]) {
    if (stored.preflight.status !== 'dispatched') continue;
    const recoveredAt = now();
    append('blender.execution-track-preflight.recovery-required', {
      sessionFingerprintSha256: stored.sessionFingerprintSha256,
      preflight: companionExecutionTrackPreflightStatusSchema.parse({
        ...stored.preflight,
        status: 'recovery_required',
        updatedAt: recoveredAt,
      }),
    });
  }

  const get = (requestId: string): CompanionExecutionTrackPreflightStatus | null =>
    preflights.get(requestId)?.preflight ?? null;

  const findForCreate = (
    input: CompanionExecutionTrackPreflightCreateRequest,
  ): CompanionExecutionTrackPreflightStatus | null => {
    const request = companionExecutionTrackPreflightCreateRequestSchema.parse(input);
    const existing = preflights.get(request.requestId)?.preflight;
    if (existing === undefined) return null;
    if (!sameCreateRequest(existing.binding, request)) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_request_conflict',
        409,
        'The requestId is already bound to a different execution-track preflight',
      );
    }
    return existing;
  };

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    [...preflights.values()].some(
      ({ preflight }) =>
        preflight.binding.target.adapterId === adapterId &&
        preflight.binding.target.instanceId === instanceId &&
        (preflight.status === 'queued' || preflight.status === 'dispatched'),
    );

  const queue = (
    input: CompanionExecutionTrackPreflightBinding,
    sessionFingerprintSha256: string,
  ): CompanionExecutionTrackPreflightStatus => {
    const binding = companionExecutionTrackPreflightBindingSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const existing = findForCreate(createRequestFromBinding(binding));
    if (existing !== null) {
      if (!isDeepStrictEqual(existing.binding, binding)) {
        throw new BlenderExecutionTrackPreflightError(
          'execution_track_preflight_binding_conflict',
          409,
          'The accepted request already has a different durable preflight binding',
        );
      }
      return existing;
    }
    const externalOwner = options.externalHistoryLockOwner?.(
      binding.target.adapterId,
      binding.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_history_locked',
        409,
        `Execution ${externalOwner} owns the target native history lock`,
      );
    }
    const conflict = [...preflights.values()].find(
      ({ preflight }) =>
        preflight.binding.target.instanceId === binding.target.instanceId &&
        (preflight.status === 'queued' || preflight.status === 'dispatched'),
    );
    if (conflict !== undefined) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_in_progress',
        409,
        `Preflight ${conflict.preflight.binding.requestId} still owns the target instance`,
      );
    }
    return append('blender.execution-track-preflight.queued', {
      sessionFingerprintSha256: fingerprint,
      preflight: companionExecutionTrackPreflightStatusSchema.parse({
        binding,
        status: 'queued',
        updatedAt: binding.requestedAt,
      }),
    });
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
    inputLease: CompanionExecutionTrackPreflightLease,
  ): CompanionExecutionTrackPreflightDelivery | null => {
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const lease = companionExecutionTrackPreflightLeaseSchema.parse(inputLease);
    const pending = [...preflights.values()]
      .filter(
        ({ preflight }) =>
          preflight.status === 'queued' &&
          preflight.binding.target.adapterId === adapterId &&
          preflight.binding.target.instanceId === instanceId,
      )
      .sort(
        (left, right) =>
          left.preflight.binding.requestedAt.localeCompare(right.preflight.binding.requestedAt) ||
          left.preflight.binding.requestId.localeCompare(right.preflight.binding.requestId),
      )[0];
    if (pending === undefined) return null;
    if (options.externalHistoryLockOwner?.(adapterId, instanceId) != null) return null;
    const dispatchedAt = now();
    const delivery = companionExecutionTrackPreflightDeliverySchema.parse({
      binding: pending.preflight.binding,
      deliveryId: createId(),
      lease,
      dispatchedAt,
    });
    append('blender.execution-track-preflight.dispatched', {
      sessionFingerprintSha256: fingerprint,
      preflight: companionExecutionTrackPreflightStatusSchema.parse({
        ...pending.preflight,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt,
        status: 'dispatched',
        updatedAt: dispatchedAt,
      }),
    });
    return delivery;
  };

  const complete = (
    input: CompanionExecutionTrackPreflightResult,
    sessionFingerprintSha256: string,
    validateResult: (
      result: CompanionExecutionTrackPreflightResult,
      preflight: CompanionExecutionTrackPreflightStatus,
    ) => void,
  ): 'accepted' | 'duplicate' => {
    const result = companionExecutionTrackPreflightResultSchema.parse(input);
    const fingerprint = sha256Schema.parse(sessionFingerprintSha256);
    const stored = preflights.get(result.requestId);
    if (stored === undefined) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_not_found',
        404,
        'The execution-track preflight request was not found',
      );
    }
    const terminal =
      stored.preflight.status === 'verified_unavailable' || stored.preflight.status === 'rejected';
    if (terminal) {
      if (
        stored.sessionFingerprintSha256 !== fingerprint ||
        !sameResultIdentity(stored.preflight, result)
      ) {
        throw new BlenderExecutionTrackPreflightError(
          'execution_track_preflight_result_identity_mismatch',
          409,
          'The preflight result does not match its immutable delivery identity',
        );
      }
      if (isDeepStrictEqual(stored.preflight.result, result)) return 'duplicate';
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_result_conflict',
        409,
        'The preflight already has a different terminal result',
      );
    }
    if (stored.preflight.status !== 'dispatched') {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_not_completable',
        409,
        stored.preflight.status === 'recovery_required'
          ? 'The dispatched preflight became indeterminate after restart'
          : 'The preflight has not been dispatched',
      );
    }
    if (
      stored.sessionFingerprintSha256 !== fingerprint ||
      !sameResultIdentity(stored.preflight, result)
    ) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_result_identity_mismatch',
        409,
        'The preflight result does not match its immutable delivery identity',
      );
    }
    const receivedAt = now();
    if (Date.parse(result.occurredAt) < Date.parse(stored.preflight.dispatchedAt!)) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_result_backdated',
        409,
        'The preflight result occurred before its immutable delivery',
      );
    }
    if (Date.parse(result.occurredAt) > Date.parse(receivedAt)) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_result_from_future',
        409,
        'The preflight result occurred after the server received it',
      );
    }
    if (Date.parse(receivedAt) >= Date.parse(stored.preflight.lease!.expiresAt)) {
      throw new BlenderExecutionTrackPreflightError(
        'execution_track_preflight_lease_expired',
        409,
        'A first terminal preflight result cannot be accepted after its target lease expires',
      );
    }
    validateResult(result, stored.preflight);
    append('blender.execution-track-preflight.completed', {
      sessionFingerprintSha256: fingerprint,
      preflight: companionExecutionTrackPreflightStatusSchema.parse({
        ...stored.preflight,
        status: result.status,
        result,
        updatedAt: receivedAt,
      }),
    });
    return 'accepted';
  };

  return { complete, findForCreate, get, ownsTarget, poll, queue };
}

export type BlenderExecutionTrackPreflightCoordinator = ReturnType<
  typeof createBlenderExecutionTrackPreflightCoordinator
>;
