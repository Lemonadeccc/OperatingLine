import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  computeProtocolCanonicalJsonSha256,
  type CompanionExecutionTrackPreflightBinding,
  type CompanionExecutionTrackPreflightStatus,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  BlenderExecutionTrackPreflightError,
  createBlenderExecutionTrackPreflightCoordinator,
} from '../../../services/orchestrator/src/blender-execution-track-preflight.js';
import {
  executionTrackPreflightFixture,
  executionTrackPreflightLease,
  preflightIds,
} from '../support/execution-track-preflight-fixture.js';

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) throw new Error('duplicate event');
      const event = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-22T10:00:00Z',
      };
      events.push(event);
      return event;
    },
    listExecutionEventsByTypes(eventTypes: readonly string[]): StoredExecutionEvent[] {
      return events.filter((event) => eventTypes.includes(event.eventType));
    },
  };
}

function resultFor(
  binding: ReturnType<typeof executionTrackPreflightFixture>['binding'],
  status: 'verified_unavailable' | 'rejected' = 'verified_unavailable',
) {
  return {
    formatVersion: binding.formatVersion,
    requestId: binding.requestId,
    replayId: binding.replayId,
    deliveryId: preflightIds.delivery,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: preflightIds.lease,
    proposalId: binding.proposal.id,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    status,
    authorityVerified: status === 'verified_unavailable',
    capability: 'preflight_only' as const,
    reasonCode:
      status === 'verified_unavailable'
        ? ('executor_unavailable' as const)
        : ('preflight_rejected' as const),
    error:
      status === 'verified_unavailable'
        ? 'No mutation-capable execution-track adapter is installed.'
        : 'Preflight authority was rejected.',
    occurredAt: '2026-08-22T10:00:02Z',
  } as const;
}

function payloadOf(event: StoredExecutionEvent): {
  preflight: CompanionExecutionTrackPreflightStatus;
  sessionFingerprintSha256: string;
} {
  return event.payload as {
    preflight: CompanionExecutionTrackPreflightStatus;
    sessionFingerprintSha256: string;
  };
}

function bindingWithRequestId(
  binding: CompanionExecutionTrackPreflightBinding,
  requestId: string,
): CompanionExecutionTrackPreflightBinding {
  const content = structuredClone(binding) as Omit<
    CompanionExecutionTrackPreflightBinding,
    'bindingContentSha256'
  > & { bindingContentSha256?: string };
  delete content.bindingContentSha256;
  const changed = { ...content, requestId };
  return {
    ...changed,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(changed),
  };
}

describe('Blender execution-track preflight coordinator', () => {
  it('persists the zero-side-effect lifecycle with idempotent create and result', () => {
    const database = createEventDatabase();
    const { binding, request } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    const fingerprint = 'a'.repeat(64);

    expect(coordinator.queue(binding, fingerprint)).toMatchObject({ status: 'queued' });
    expect(coordinator.queue(binding, fingerprint)).toMatchObject({ status: 'queued' });
    expect(coordinator.findForCreate(request)).toMatchObject({ status: 'queued' });
    const delivery = coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    expect(delivery).toMatchObject({ deliveryId: preflightIds.delivery, binding });
    expect(
      coordinator.poll(
        'blender',
        binding.target.instanceId,
        fingerprint,
        executionTrackPreflightLease(),
      ),
    ).toBeNull();

    const result = resultFor(binding);
    let validations = 0;
    expect(
      coordinator.complete(result, fingerprint, () => {
        validations += 1;
      }),
    ).toBe('accepted');
    expect(coordinator.complete(result, fingerprint, () => undefined)).toBe('duplicate');
    expect(validations).toBe(1);
    expect(coordinator.get(binding.requestId)).toMatchObject({
      status: 'verified_unavailable',
      result,
    });
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.execution-track-preflight.queued',
      'blender.execution-track-preflight.dispatched',
      'blender.execution-track-preflight.completed',
    ]);
  });

  it('conflicts on changed request or result identity', () => {
    const database = createEventDatabase();
    const { binding, request } = executionTrackPreflightFixture();
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:01Z',
      createId: () => preflightIds.delivery,
    });
    const fingerprint = 'b'.repeat(64);
    coordinator.queue(binding, fingerprint);
    expect(() =>
      coordinator.findForCreate({
        ...request,
        expectedState: { ...request.expectedState, sequence: 8 },
      }),
    ).toThrowError(BlenderExecutionTrackPreflightError);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    expect(() =>
      coordinator.complete(
        { ...resultFor(binding), bindingContentSha256: 'f'.repeat(64) },
        fingerprint,
        () => undefined,
      ),
    ).toThrowError(/immutable delivery identity/);
  });

  it('recovers a dispatched preflight as indeterminate after restart', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const fingerprint = 'c'.repeat(64);
    const first = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:01Z',
      createId: () => preflightIds.delivery,
    });
    first.queue(binding, fingerprint);
    first.poll('blender', binding.target.instanceId, fingerprint, executionTrackPreflightLease());

    const restarted = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:04Z',
    });
    expect(restarted.get(binding.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(() => restarted.complete(resultFor(binding), fingerprint, () => undefined)).toThrowError(
      /became indeterminate/,
    );
  });

  it('releases recovered target ownership so a new request can queue', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const fingerprint = 'c'.repeat(64);
    const first = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:01Z',
      createId: () => preflightIds.delivery,
    });
    first.queue(binding, fingerprint);
    first.poll('blender', binding.target.instanceId, fingerprint, executionTrackPreflightLease());

    const restarted = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:04Z',
    });
    const nextBinding = bindingWithRequestId(binding, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(restarted.ownsTarget('blender', binding.target.instanceId)).toBe(false);
    expect(restarted.queue(nextBinding, 'd'.repeat(64))).toMatchObject({ status: 'queued' });
    expect(restarted.get(binding.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(() => restarted.complete(resultFor(binding), fingerprint, () => undefined)).toThrowError(
      /became indeterminate/,
    );
  });

  it('transfers a queued binding to the currently authorized polling session', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    coordinator.queue(binding, 'a'.repeat(64));

    expect(
      coordinator.poll(
        'blender',
        binding.target.instanceId,
        'b'.repeat(64),
        executionTrackPreflightLease(),
      ),
    ).toMatchObject({ binding, deliveryId: preflightIds.delivery });
    expect(coordinator.complete(resultFor(binding), 'b'.repeat(64), () => undefined)).toBe(
      'accepted',
    );
    expect(() =>
      coordinator.complete(resultFor(binding), 'a'.repeat(64), () => undefined),
    ).toThrowError(/immutable delivery identity/);
  });

  it('checks external history ownership and the exact live target lease before dispatch', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    let historyOwner: string | null = null;
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:01Z',
      createId: () => preflightIds.delivery,
      externalHistoryLockOwner: () => historyOwner,
    });
    const fingerprint = 'd'.repeat(64);
    coordinator.queue(binding, fingerprint);
    historyOwner = 'compound-replay';
    expect(
      coordinator.poll(
        'blender',
        binding.target.instanceId,
        fingerprint,
        executionTrackPreflightLease(),
      ),
    ).toBeNull();
    historyOwner = null;
    expect(() =>
      coordinator.poll('blender', binding.target.instanceId, fingerprint, {
        ...executionTrackPreflightLease(),
        target: { ...binding.target, instanceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      }),
    ).toThrowError(/live lease for the exact bound target/);
  });

  it('rejects incomplete queued results without appending an event', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({ database });
    const fingerprint = 'e'.repeat(64);
    coordinator.queue(binding, fingerprint);

    expect(() =>
      coordinator.complete(resultFor(binding), fingerprint, () => undefined),
    ).toThrowError(/has not been dispatched/);
    expect(database.events).toHaveLength(1);
  });

  it.each([
    {
      name: 'backdated before dispatch',
      occurredAt: '2026-08-22T10:00:00Z',
      receivedAt: '2026-08-22T10:00:03Z',
      status: 'verified_unavailable' as const,
      message: /before its immutable delivery/,
    },
    {
      name: 'dated after receipt',
      occurredAt: '2026-08-22T10:00:04Z',
      receivedAt: '2026-08-22T10:00:03Z',
      status: 'verified_unavailable' as const,
      message: /after the server received it/,
    },
    {
      name: 'received at lease expiry',
      occurredAt: '2026-08-22T10:04:59Z',
      receivedAt: '2026-08-22T10:05:00Z',
      status: 'verified_unavailable' as const,
      message: /cannot be accepted after its target lease expires/,
    },
    {
      name: 'rejection received at lease expiry',
      occurredAt: '2026-08-22T10:04:59Z',
      receivedAt: '2026-08-22T10:05:00Z',
      status: 'rejected' as const,
      message: /cannot be accepted after its target lease expires/,
    },
  ])(
    'rejects a first terminal result $name without appending',
    ({ occurredAt, receivedAt, status, message }) => {
      const database = createEventDatabase();
      const { binding } = executionTrackPreflightFixture();
      const times = ['2026-08-22T10:00:01Z', receivedAt];
      const coordinator = createBlenderExecutionTrackPreflightCoordinator({
        database,
        now: () => times.shift()!,
        createId: () => preflightIds.delivery,
      });
      const fingerprint = 'f'.repeat(64);
      coordinator.queue(binding, fingerprint);
      coordinator.poll(
        'blender',
        binding.target.instanceId,
        fingerprint,
        executionTrackPreflightLease(),
      );

      expect(() =>
        coordinator.complete(
          { ...resultFor(binding, status), occurredAt },
          fingerprint,
          () => undefined,
        ),
      ).toThrowError(message);
      expect(database.events).toHaveLength(2);
    },
  );

  it('accepts a rejected result and records the single server receipt time', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '1'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );

    expect(coordinator.complete(resultFor(binding, 'rejected'), fingerprint, () => undefined)).toBe(
      'accepted',
    );
    expect(database.events.at(-1)).toMatchObject({
      eventType: 'blender.execution-track-preflight.completed',
      createdAt: '2026-08-22T10:00:03Z',
    });
    expect(coordinator.get(binding.requestId)).toMatchObject({
      status: 'rejected',
      updatedAt: '2026-08-22T10:00:03Z',
    });
  });

  it('does not append for wrong identity, wrong session, or failed result validation', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '2'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );

    expect(() =>
      coordinator.complete(resultFor(binding), '3'.repeat(64), () => undefined),
    ).toThrowError(/immutable delivery identity/);
    expect(() =>
      coordinator.complete(
        { ...resultFor(binding), deliveryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        fingerprint,
        () => undefined,
      ),
    ).toThrowError(/immutable delivery identity/);
    expect(() =>
      coordinator.complete(resultFor(binding), fingerprint, () => {
        throw new Error('local authority validation failed');
      }),
    ).toThrowError(/local authority validation failed/);
    expect(database.events).toHaveLength(2);
  });

  it('keeps exact duplicates idempotent after expiry and rejects terminal conflicts', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift() ?? '2026-08-22T10:06:00Z',
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '4'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    const result = resultFor(binding);
    coordinator.complete(result, fingerprint, () => undefined);

    expect(coordinator.complete(result, fingerprint, () => undefined)).toBe('duplicate');
    expect(() =>
      coordinator.complete(
        { ...result, error: 'A conflicting terminal explanation.' },
        fingerprint,
        () => undefined,
      ),
    ).toThrowError(/different terminal result/);
    expect(database.events).toHaveLength(3);
  });

  it.each([
    {
      name: 'event type',
      mutate(event: StoredExecutionEvent) {
        event.eventType = 'blender.execution-track-preflight.dispatched';
      },
      message: /mismatched event type/,
    },
    {
      name: 'event id',
      mutate(event: StoredExecutionEvent) {
        event.id = 'blender-execution-track-preflight:tampered:queued';
      },
      message: /non-deterministic event id/,
    },
    {
      name: 'created time',
      mutate(event: StoredExecutionEvent) {
        event.createdAt = '2026-08-22T09:59:59Z';
      },
      message: /mismatched event chronology/,
    },
  ])('rejects replay with a tampered $name', ({ mutate, message }) => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({ database });
    coordinator.queue(binding, '5'.repeat(64));
    mutate(database.events[0]!);

    expect(() => createBlenderExecutionTrackPreflightCoordinator({ database })).toThrowError(
      message,
    );
  });

  it('rejects replay of an out-of-order durable history', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => '2026-08-22T10:00:01Z',
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '8'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    database.events.reverse();

    expect(() => createBlenderExecutionTrackPreflightCoordinator({ database })).toThrowError(
      /missing queued/,
    );
  });

  it('fails closed on transient overlapping owners hidden by final folded state', () => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '9'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    coordinator.complete(resultFor(binding), fingerprint, () => undefined);
    const competing = bindingWithRequestId(binding, 'abababab-abab-4bab-8bab-abababababab');
    database.events.splice(1, 0, {
      sequence: 2,
      id: `blender-execution-track-preflight:${competing.requestId}:queued`,
      eventType: 'blender.execution-track-preflight.queued',
      payload: {
        sessionFingerprintSha256: 'a'.repeat(64),
        preflight: {
          binding: competing,
          status: 'queued',
          updatedAt: competing.requestedAt,
        },
      },
      createdAt: competing.requestedAt,
    });
    database.events.forEach((event, index) => {
      event.sequence = index + 1;
    });

    expect(() => createBlenderExecutionTrackPreflightCoordinator({ database })).toThrowError(
      /both own target/,
    );
  });

  it.each([
    {
      name: 'delivery identity',
      mutate(event: StoredExecutionEvent) {
        payloadOf(event).preflight.lease = {
          ...payloadOf(event).preflight.lease!,
          documentIncarnationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        };
      },
      message: /changed immutable delivery identity/,
    },
    {
      name: 'binding',
      mutate(event: StoredExecutionEvent) {
        const binding = payloadOf(event).preflight.binding;
        const content = structuredClone(binding) as Omit<
          CompanionExecutionTrackPreflightBinding,
          'bindingContentSha256'
        > & { bindingContentSha256?: string };
        delete content.bindingContentSha256;
        const changed = {
          ...content,
          artifacts: { ...content.artifacts, procedureTreeContentSha256: 'f'.repeat(64) },
        };
        payloadOf(event).preflight.binding = {
          ...changed,
          bindingContentSha256: computeProtocolCanonicalJsonSha256(changed),
        };
        payloadOf(event).preflight.result = {
          ...payloadOf(event).preflight.result!,
          bindingContentSha256: payloadOf(event).preflight.binding.bindingContentSha256,
        };
      },
      message: /changed immutable authority/,
    },
    {
      name: 'session fingerprint',
      mutate(event: StoredExecutionEvent) {
        payloadOf(event).sessionFingerprintSha256 = '6'.repeat(64);
      },
      message: /changed its session outside dispatch/,
    },
    {
      name: 'chronology',
      mutate(event: StoredExecutionEvent) {
        payloadOf(event).preflight.updatedAt = '2026-08-22T10:00:00Z';
        event.createdAt = '2026-08-22T10:00:00Z';
      },
      message: /dispatch chronology|result violates delivery/,
    },
  ])('rejects replay with tampered terminal $name', ({ mutate, message }) => {
    const database = createEventDatabase();
    const { binding } = executionTrackPreflightFixture();
    const times = ['2026-08-22T10:00:01Z', '2026-08-22T10:00:03Z'];
    const coordinator = createBlenderExecutionTrackPreflightCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => preflightIds.delivery,
    });
    const fingerprint = '7'.repeat(64);
    coordinator.queue(binding, fingerprint);
    coordinator.poll(
      'blender',
      binding.target.instanceId,
      fingerprint,
      executionTrackPreflightLease(),
    );
    coordinator.complete(resultFor(binding), fingerprint, () => undefined);
    mutate(database.events[2]!);

    expect(() => createBlenderExecutionTrackPreflightCoordinator({ database })).toThrowError(
      message,
    );
  });
});
