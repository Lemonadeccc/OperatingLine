import {
  companionPokeCompoundResultSchema,
  sealProcedureCompoundCurrentState,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  BlenderPokeCompoundExecutionError,
  createBlenderPokeCompoundExecutionCoordinator,
  pokeCompoundExecutionEventTypes,
} from '../../../services/orchestrator/src/blender-poke-compound-execution.js';
import { createPokeCompoundHistoryLockOwnerReader } from '../../../services/orchestrator/src/procedure-replay.js';
import { createPokeCompoundTransportFixture } from '../../support/poke-compound-fixture.js';

function eventDatabase() {
  const events: Array<{
    sequence: number;
    id: string;
    eventType: string;
    payload: unknown;
    createdAt: string;
  }> = [];
  return {
    events,
    appendEvent(input: { id: string; eventType: string; payload: unknown; createdAt: string }) {
      const stored = { sequence: events.length + 1, ...input };
      events.push(stored);
      return stored;
    },
    listExecutionEventsByTypes(types: readonly string[]) {
      return events.filter((event) => types.includes(event.eventType));
    },
  };
}

function clock(...instants: string[]) {
  let index = 0;
  return () => instants[Math.min(index++, instants.length - 1)]!;
}

function resultFor(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderPokeCompoundExecutionCoordinator>['poll']>
  >,
  fixture: ReturnType<typeof createPokeCompoundTransportFixture>,
) {
  return companionPokeCompoundResultSchema.parse({
    formatVersion: '1.0.0',
    requestId: delivery.requestId,
    deliveryId: delivery.deliveryId,
    deliveryContentSha256: delivery.deliveryContentSha256,
    target: delivery.target,
    replayId: delivery.replayId,
    compoundId: delivery.compoundId,
    compoundContentSha256: delivery.compoundContentSha256,
    historyLockTokenSha256: delivery.historyLockTokenSha256,
    status: 'succeeded',
    replay: fixture.terminalReplay,
    terminalEvidence: fixture.terminalEvidence,
    observedCurrentState: null,
    error: null,
    occurredAt: '2026-08-24T00:00:20.000Z',
  });
}

describe('Blender Poke compound execution coordinator', () => {
  it('durably queues, delivers, validates all three leaves, and deduplicates the ACK', () => {
    const fixture = createPokeCompoundTransportFixture();
    const database = eventDatabase();
    const coordinator = createBlenderPokeCompoundExecutionCoordinator({
      database: database as never,
      now: clock('2026-08-24T00:00:10.000Z', '2026-08-24T00:00:11.000Z'),
      createId: () => '74000000-0000-4000-8000-000000000001',
    });
    const queued = coordinator.queue(fixture.request, 'a'.repeat(64), 'b'.repeat(64));
    expect(queued.status).toBe('queued');
    const delivery = coordinator.poll(
      'blender',
      fixture.request.replay.target.instanceId,
      'a'.repeat(64),
      'b'.repeat(64),
    );
    if (delivery === null) throw new Error('Expected Poke compound delivery');
    const result = resultFor(delivery, fixture);
    expect(coordinator.complete(result, 'a'.repeat(64), 'b'.repeat(64))).toBe('accepted');
    expect(coordinator.complete(result, 'a'.repeat(64), 'b'.repeat(64))).toBe('duplicate');
    expect(coordinator.get(fixture.request.requestId)).toMatchObject({
      status: 'succeeded',
      currentState: { status: 'forward_applied_locked', historyLock: 'held' },
    });
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.poke-compound.queued',
      'blender.poke-compound.dispatched',
      'blender.poke-compound.completed',
    ]);
    const lockOwner = createPokeCompoundHistoryLockOwnerReader(database);
    expect(lockOwner('blender', fixture.request.replay.target.instanceId)).toBe(
      fixture.request.replay.recipe.compoundId,
    );
  });

  it('turns a delivered runtime restart into replacement-lease terminal recovery without replay', () => {
    const fixture = createPokeCompoundTransportFixture();
    const database = eventDatabase();
    const first = createBlenderPokeCompoundExecutionCoordinator({
      database: database as never,
      now: clock('2026-08-24T00:00:10.000Z', '2026-08-24T00:00:11.000Z'),
      createId: () => '74000000-0000-4000-8000-000000000002',
    });
    first.queue(fixture.request, 'a'.repeat(64), 'b'.repeat(64));
    const delivery = first.poll(
      'blender',
      fixture.request.replay.target.instanceId,
      'a'.repeat(64),
      'b'.repeat(64),
    );
    if (delivery === null) throw new Error('Expected Poke compound delivery');
    const retainedResult = resultFor(delivery, fixture);

    const recovered = createBlenderPokeCompoundExecutionCoordinator({
      database: database as never,
      now: clock('2026-08-24T00:00:30.000Z', '2026-08-24T00:00:31.000Z'),
      createId: () => '74000000-0000-4000-8000-000000000003',
    });
    expect(recovered.get(fixture.request.requestId)?.status).toBe('recovery_required');
    expect(
      recovered.poll(
        'blender',
        fixture.request.replay.target.instanceId,
        'c'.repeat(64),
        'b'.repeat(64),
      ),
    ).toBeNull();
    const challenge = recovered.pollRecovery(
      'blender',
      fixture.request.replay.target.instanceId,
      'c'.repeat(64),
      'b'.repeat(64),
    );
    if (challenge === null) throw new Error('Expected Poke compound recovery challenge');
    const ack = {
      formatVersion: '1.0.0' as const,
      recoveryId: challenge.recoveryId,
      challenge,
      outcome: 'terminal_result' as const,
      terminalResult: retainedResult,
      observedCurrentState: null,
      automaticReplay: false as const,
      retainsTargetLock: true,
      occurredAt: '2026-08-24T00:00:32.000Z',
    };
    expect(recovered.acknowledgeRecovery(ack, 'c'.repeat(64), 'b'.repeat(64))).toBe('accepted');
    expect(recovered.acknowledgeRecovery(ack, 'c'.repeat(64), 'b'.repeat(64))).toBe('duplicate');
    expect(recovered.get(fixture.request.requestId)?.status).toBe('succeeded');
    expect(
      database.events.filter((event) => event.eventType === 'blender.poke-compound.dispatched'),
    ).toHaveLength(1);
  });

  it('quarantines a new-process history-loss proof and rejects hostile terminal evidence', () => {
    const fixture = createPokeCompoundTransportFixture();
    const database = eventDatabase();
    const first = createBlenderPokeCompoundExecutionCoordinator({
      database: database as never,
      now: clock('2026-08-24T00:00:10.000Z', '2026-08-24T00:00:11.000Z'),
      createId: () => '74000000-0000-4000-8000-000000000004',
    });
    first.queue(fixture.request, 'a'.repeat(64), 'b'.repeat(64));
    const delivery = first.poll(
      'blender',
      fixture.request.replay.target.instanceId,
      'a'.repeat(64),
      'b'.repeat(64),
    );
    if (delivery === null) throw new Error('Expected Poke compound delivery');
    const hostile = structuredClone(resultFor(delivery, fixture));
    hostile.replay!.leafProgress[1]!.receiptSha256 = '0'.repeat(64);
    expect(() => first.complete(hostile, 'a'.repeat(64), 'b'.repeat(64))).toThrow(
      BlenderPokeCompoundExecutionError,
    );

    const recovered = createBlenderPokeCompoundExecutionCoordinator({
      database: database as never,
      now: clock('2026-08-24T00:00:30.000Z', '2026-08-24T00:00:31.000Z'),
      createId: () => '74000000-0000-4000-8000-000000000005',
    });
    const challenge = recovered.pollRecovery(
      'blender',
      fixture.request.replay.target.instanceId,
      'c'.repeat(64),
      'd'.repeat(64),
    );
    if (challenge === null) throw new Error('Expected Poke compound recovery challenge');
    const lost = sealProcedureCompoundCurrentState(
      {
        ...fixture.request.replay.currentState,
        blenderProcessIdentitySha256: 'e'.repeat(64),
        status: 'history_lost',
        lifecycleState: 'unknown',
        mode: 'UNKNOWN',
        historyLock: 'quarantined',
        historyContinuity: 'lost_permanently',
        nativeHistoryLossRecorded: true,
        inProgressLeafId: null,
        permittedHistoryTransitions: ['abandon_baseline'],
      },
      fixture.request.replay.recipe,
    );
    expect(
      recovered.acknowledgeRecovery(
        {
          formatVersion: '1.0.0',
          recoveryId: challenge.recoveryId,
          challenge,
          outcome: 'history_lost',
          terminalResult: null,
          observedCurrentState: lost,
          automaticReplay: false,
          retainsTargetLock: true,
          occurredAt: '2026-08-24T00:00:32.000Z',
        },
        'c'.repeat(64),
        'd'.repeat(64),
      ),
    ).toBe('accepted');
    expect(recovered.get(fixture.request.requestId)).toMatchObject({
      status: 'quarantined',
      currentState: { status: 'history_lost', historyContinuity: 'lost_permanently' },
    });
    expect(pokeCompoundExecutionEventTypes).toContain('blender.poke-compound.quarantined');
  });
});
