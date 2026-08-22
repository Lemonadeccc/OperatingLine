import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import { describe, expect, it } from 'vitest';

import {
  BlenderActionExecutionError,
  createBlenderActionExecutionCoordinator,
} from '../../../services/orchestrator/src/blender-action-execution.js';

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) {
        throw new Error(`duplicate event ${input.id}`);
      }
      const stored = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-20T10:00:00Z',
      };
      events.push(stored);
      return stored;
    },
    listExecutionEventsByTypes(eventTypes: readonly string[]): StoredExecutionEvent[] {
      return events.filter((event) => eventTypes.includes(event.eventType));
    },
  };
}

function queuedExecution(overrides: Record<string, unknown> = {}) {
  const requestId = randomUUID();
  const replayId = randomUUID();
  const instanceId = randomUUID();
  const proposalId = randomUUID();
  const executionId = randomUUID();
  const reportId = randomUUID();
  return {
    formatVersion: '1.0.0',
    requestId,
    replayId,
    target: { adapterId: 'blender', instanceId },
    proposalId,
    plan: { id: `procedure-replay.${replayId}`, revision: 1 },
    planContentSha256: 'a'.repeat(64),
    executionId,
    expectedState: { reportId, sequence: 7 },
    step: {
      id: 'tutorial.head.eye.create',
      parentId: null,
      order: 0,
      dependsOn: [],
      title: 'Create eye',
      intent: 'Create and position the eye sphere',
      explanation: 'Execute the exact accepted UV Sphere action.',
      state: 'ready',
      action: {
        adapterId: 'blender',
        name: 'blender.mesh.create_uv_sphere',
        arguments: {
          name: 'Eye.L',
          location: [-0.32, -0.88, 1.61],
          radius: 0.18,
          segments: 32,
          ringCount: 16,
        },
      },
      anchors: [],
      expectedObservations: [{ kind: 'uv_sphere_ready', parameters: { objectName: 'Eye.L' } }],
      observationPolicy: {
        mode: 'success_gate',
        failureStrategy: 'rollback_step',
      },
      rollback: { mode: 'native_undo', checkpointRequired: true },
    },
    requestedAt: '2026-08-20T10:00:00Z',
    status: 'queued',
    updatedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  } as const;
}

describe('Blender action execution coordinator', () => {
  it('rejects composable action execution while a compound replay owns native history', () => {
    const database = createEventDatabase();
    const queued = queuedExecution();
    const compoundId = randomUUID();
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      externalHistoryLockOwner: (_adapterId, instanceId) =>
        instanceId === queued.target.instanceId ? compoundId : null,
    });

    expect(() => coordinator.queue(queued, '1'.repeat(64))).toThrowError(
      BlenderActionExecutionError,
    );
    expect(database.events).toHaveLength(0);
  });

  it('rechecks the external history lock before dispatching an already queued action', () => {
    const database = createEventDatabase();
    const queued = queuedExecution();
    let externalOwner: string | null = null;
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      externalHistoryLockOwner: () => externalOwner,
    });
    const fingerprint = '1'.repeat(64);

    coordinator.queue(queued, fingerprint);
    externalOwner = 'blender.menu-control-proof';
    expect(coordinator.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'queued' });

    externalOwner = null;
    expect(coordinator.poll('blender', queued.target.instanceId, fingerprint)).toMatchObject({
      requestId: queued.requestId,
    });
  });

  it('persists an at-most-once queue, dispatch, and terminal result', async () => {
    const database = createEventDatabase();
    const times = ['2026-08-20T10:00:01Z', '2026-08-20T10:00:02Z'];
    const deliveryId = randomUUID();
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      now: () => times.shift()!,
      createId: () => deliveryId,
    });
    const queued = queuedExecution();
    const fingerprint = 'b'.repeat(64);

    expect(coordinator.queue(queued, fingerprint)).toMatchObject({ status: 'queued' });
    expect(
      coordinator.findForCreate({
        formatVersion: '1.0.0',
        requestId: queued.requestId,
        replayId: queued.replayId,
        expectedState: queued.expectedState,
      }),
    ).toMatchObject({ requestId: queued.requestId, status: 'queued' });

    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint);
    expect(delivery).toMatchObject({ requestId: queued.requestId, deliveryId });
    expect(coordinator.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'dispatched' });

    const result = {
      formatVersion: '1.0.0',
      requestId: queued.requestId,
      replayId: queued.replayId,
      deliveryId,
      target: queued.target,
      proposalId: queued.proposalId,
      plan: queued.plan,
      planContentSha256: queued.planContentSha256,
      executionId: queued.executionId,
      expectedState: queued.expectedState,
      stepId: queued.step.id,
      status: 'succeeded',
      report: { reportId: randomUUID(), sequence: 8 },
      error: null,
      occurredAt: '2026-08-20T10:00:01.500Z',
    } as const;
    let validations = 0;
    expect(
      await coordinator.complete(result, fingerprint, () => {
        validations += 1;
      }),
    ).toBe('accepted');
    expect(await coordinator.complete(result, fingerprint, () => undefined)).toBe('duplicate');
    await expect(
      coordinator.complete(result, 'c'.repeat(64), () => undefined),
    ).rejects.toThrowError(/does not match its accepted delivery and Companion session/);
    await expect(
      coordinator.complete(
        { ...result, occurredAt: '2026-08-20T10:00:01.750Z' },
        fingerprint,
        () => undefined,
      ),
    ).rejects.toThrowError(/already has a different terminal result/);
    expect(validations).toBe(1);
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'succeeded', result });
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.action-execution.queued',
      'blender.action-execution.dispatched',
      'blender.action-execution.completed',
    ]);
  });

  it('notifies the failure-replan boundary once only after a trusted terminal failure persists', async () => {
    const database = createEventDatabase();
    const deliveryId = randomUUID();
    const failures: string[] = [];
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      createId: () => deliveryId,
      onTerminalFailure: async (handoff) => {
        failures.push(handoff.requestId);
      },
    });
    const queued = queuedExecution();
    const fingerprint = '9'.repeat(64);
    coordinator.queue(queued, fingerprint);
    coordinator.poll('blender', queued.target.instanceId, fingerprint);
    const result = {
      formatVersion: '1.0.0',
      requestId: queued.requestId,
      replayId: queued.replayId,
      deliveryId,
      target: queued.target,
      proposalId: queued.proposalId,
      plan: queued.plan,
      planContentSha256: queued.planContentSha256,
      executionId: queued.executionId,
      expectedState: queued.expectedState,
      stepId: queued.step.id,
      status: 'failed',
      report: { reportId: randomUUID(), sequence: 8 },
      error: 'Trusted action failure.',
      occurredAt: '2026-08-20T10:00:01.500Z',
    } as const;

    expect(await coordinator.complete(result, fingerprint, () => undefined)).toBe('accepted');
    expect(await coordinator.complete(result, fingerprint, () => undefined)).toBe('duplicate');
    expect(failures).toEqual([queued.requestId]);
  });

  it('does not acknowledge a handoff while its callback Promise is unsettled', async () => {
    const database = createEventDatabase();
    const deliveryId = randomUUID();
    let settle!: () => void;
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      createId: () => deliveryId,
      onTerminalFailure: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    });
    const queued = queuedExecution();
    const fingerprint = '6'.repeat(64);
    coordinator.queue(queued, fingerprint);
    coordinator.poll('blender', queued.target.instanceId, fingerprint);
    const completion = coordinator.complete(
      {
        formatVersion: '1.0.0',
        requestId: queued.requestId,
        replayId: queued.replayId,
        deliveryId,
        target: queued.target,
        proposalId: queued.proposalId,
        plan: queued.plan,
        planContentSha256: queued.planContentSha256,
        executionId: queued.executionId,
        expectedState: queued.expectedState,
        stepId: queued.step.id,
        status: 'rejected',
        report: null,
        error: 'Rejected before mutation.',
        occurredAt: '2026-08-20T10:00:01.500Z',
      },
      fingerprint,
      () => undefined,
    );
    await Promise.resolve();
    expect(
      database.events.some(
        (event) => event.eventType === 'blender.action-execution.failure-handoff-completed',
      ),
    ).toBe(false);
    expect(coordinator.pendingTerminalFailureHandoffs()).toEqual([queued.requestId]);
    settle();
    expect(await completion).toBe('accepted');
    expect(coordinator.pendingTerminalFailureHandoffs()).toEqual([]);
  });

  it('awaits async rejection, preserves terminal completion, and durably retries it', async () => {
    const database = createEventDatabase();
    const deliveryId = randomUUID();
    let shouldFail = true;
    let attempts = 0;
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      createId: () => deliveryId,
      onTerminalFailure: async () => {
        attempts += 1;
        if (shouldFail) await Promise.reject(new Error('temporary handoff failure'));
      },
    });
    const queued = queuedExecution();
    const fingerprint = '8'.repeat(64);
    coordinator.queue(queued, fingerprint);
    coordinator.poll('blender', queued.target.instanceId, fingerprint);
    const result = {
      formatVersion: '1.0.0',
      requestId: queued.requestId,
      replayId: queued.replayId,
      deliveryId,
      target: queued.target,
      proposalId: queued.proposalId,
      plan: queued.plan,
      planContentSha256: queued.planContentSha256,
      executionId: queued.executionId,
      expectedState: queued.expectedState,
      stepId: queued.step.id,
      status: 'rejected',
      report: null,
      error: 'Rejected before mutation.',
      occurredAt: '2026-08-20T10:00:01.500Z',
    } as const;

    expect(await coordinator.complete(result, fingerprint, () => undefined)).toBe('accepted');
    expect(coordinator.get(queued.requestId)?.status).toBe('rejected');
    expect(coordinator.pendingTerminalFailureHandoffs()).toEqual([queued.requestId]);
    shouldFail = false;
    expect(await coordinator.retryTerminalFailureHandoffs()).toEqual([]);
    expect(attempts).toBe(2);
    expect(
      database.events.some(
        (event) => event.eventType === 'blender.action-execution.failure-handoff-completed',
      ),
    ).toBe(true);

    const restarted = createBlenderActionExecutionCoordinator({
      database,
      onTerminalFailure: async () => {
        attempts += 1;
      },
    });
    expect(restarted.pendingTerminalFailureHandoffs()).toEqual([]);
    expect(await restarted.retryTerminalFailureHandoffs()).toEqual([]);
    expect(attempts).toBe(2);
  });

  it('retries the same deterministic handoff after callback success but before durable ack', async () => {
    const storage = createEventDatabase();
    let failAck = true;
    const database = {
      appendEvent(input: ExecutionEventInput) {
        if (failAck && input.eventType === 'blender.action-execution.failure-handoff-completed') {
          throw new Error('simulated crash before outbox ack');
        }
        return storage.appendEvent(input);
      },
      listExecutionEventsByTypes: storage.listExecutionEventsByTypes,
    };
    const deliveryId = randomUUID();
    const handoffIds: string[] = [];
    const callback = async (handoff: { readonly handoffId: string }) => {
      handoffIds.push(handoff.handoffId);
    };
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      createId: () => deliveryId,
      onTerminalFailure: callback,
    });
    const queued = queuedExecution();
    const fingerprint = '7'.repeat(64);
    coordinator.queue(queued, fingerprint);
    coordinator.poll('blender', queued.target.instanceId, fingerprint);
    const result = {
      formatVersion: '1.0.0',
      requestId: queued.requestId,
      replayId: queued.replayId,
      deliveryId,
      target: queued.target,
      proposalId: queued.proposalId,
      plan: queued.plan,
      planContentSha256: queued.planContentSha256,
      executionId: queued.executionId,
      expectedState: queued.expectedState,
      stepId: queued.step.id,
      status: 'rejected',
      report: null,
      error: 'Rejected before mutation.',
      occurredAt: '2026-08-20T10:00:01.500Z',
    } as const;

    expect(await coordinator.complete(result, fingerprint, () => undefined)).toBe('accepted');
    expect(coordinator.pendingTerminalFailureHandoffs()).toEqual([queued.requestId]);
    failAck = false;
    const restarted = createBlenderActionExecutionCoordinator({
      database,
      onTerminalFailure: callback,
    });
    expect(await restarted.retryTerminalFailureHandoffs()).toEqual([]);
    expect(handoffIds).toHaveLength(2);
    expect(new Set(handoffIds).size).toBe(1);
  });

  it('rejects another request while queued and safely rebinds first delivery after reconnect', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderActionExecutionCoordinator({ database });
    const queued = queuedExecution();
    const fingerprint = 'c'.repeat(64);
    coordinator.queue(queued, fingerprint);

    expect(() =>
      coordinator.queue(queuedExecution({ target: queued.target }), fingerprint),
    ).toThrowError(BlenderActionExecutionError);
    expect(coordinator.poll('blender', queued.target.instanceId, 'd'.repeat(64))).toMatchObject({
      requestId: queued.requestId,
    });
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'dispatched' });
  });

  it('rejects conflicting request and result identities before validation', async () => {
    const database = createEventDatabase();
    const deliveryId = randomUUID();
    const coordinator = createBlenderActionExecutionCoordinator({
      database,
      createId: () => deliveryId,
    });
    const queued = queuedExecution();
    const fingerprint = 'e'.repeat(64);
    coordinator.queue(queued, fingerprint);
    expect(() =>
      coordinator.findForCreate({
        formatVersion: '1.0.0',
        requestId: queued.requestId,
        replayId: randomUUID(),
        expectedState: queued.expectedState,
      }),
    ).toThrowError(/different action execution request/);
    coordinator.poll('blender', queued.target.instanceId, fingerprint);

    let validated = false;
    await expect(
      coordinator.complete(
        {
          formatVersion: '1.0.0',
          requestId: queued.requestId,
          replayId: queued.replayId,
          deliveryId,
          target: queued.target,
          proposalId: queued.proposalId,
          plan: queued.plan,
          planContentSha256: queued.planContentSha256,
          executionId: queued.executionId,
          expectedState: queued.expectedState,
          stepId: 'different.step',
          status: 'rejected',
          report: null,
          error: 'Local step identity changed.',
          occurredAt: '2026-08-20T10:00:03Z',
        },
        fingerprint,
        () => {
          validated = true;
        },
      ),
    ).rejects.toThrowError(/does not match its accepted delivery/);
    expect(validated).toBe(false);
  });

  it('converts a dispatched request to recovery_required after restart and never redelivers it', () => {
    const database = createEventDatabase();
    const queued = queuedExecution();
    const fingerprint = 'f'.repeat(64);
    const first = createBlenderActionExecutionCoordinator({ database });
    first.queue(queued, fingerprint);
    first.poll('blender', queued.target.instanceId, fingerprint);

    const restarted = createBlenderActionExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(restarted.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    expect(database.events.at(-1)?.eventType).toBe('blender.action-execution.recovery-required');
  });
});
