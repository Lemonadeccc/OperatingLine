import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Protocol from '@operatingline/protocol';

vi.mock('@operatingline/protocol', async (load) => {
  const actual = await load<typeof Protocol>();
  const identity = { parse: <T>(value: T) => value };
  return {
    ...actual,
    companionExecutionTrackExecutionBindingSchema: identity,
    companionExecutionTrackExecutionCreateRequestSchema: identity,
    companionExecutionTrackExecutionDeliverySchema: identity,
    companionExecutionTrackExecutionManagedStartSchema: identity,
    companionExecutionTrackExecutionManagedStartSubmissionSchema: identity,
    companionExecutionTrackExecutionProgressSchema: identity,
    companionExecutionTrackExecutionRecoveryAckSchema: identity,
    companionExecutionTrackExecutionRecoveryRequestSchema: identity,
    companionExecutionTrackExecutionResultSchema: identity,
    companionExecutionTrackExecutionStatusSchema: identity,
    companionExecutionTrackExecutionProgressTransitionMatches: (
      previous: {
        sequence: number;
        contentSha256: string;
        currentLease: { expiresAt: string };
      },
      next: {
        sequence: number;
        previousProgressContentSha256: string;
        currentLease: { expiresAt: string };
      },
    ) =>
      next.sequence === previous.sequence + 1 &&
      next.previousProgressContentSha256 === previous.contentSha256 &&
      Date.parse(String(next.currentLease.expiresAt)) >=
        Date.parse(String(previous.currentLease.expiresAt)),
  };
});

import {
  createBlenderExecutionTrackExecutionCoordinator,
  type BlenderExecutionTrackExecutionEventStore,
} from '../../../services/orchestrator/src/blender-execution-track-execution.js';
import type { BlenderExecutionTrackExecutionError } from '../../../services/orchestrator/src/blender-execution-track-execution.js';

const target = {
  adapterId: 'blender' as const,
  instanceId: '00000000-0000-4000-8000-000000000001',
};
const documentAuthoritySha256 = 'd'.repeat(64);
const lease = {
  leaseId: '00000000-0000-4000-8000-000000000002',
  sessionId: '00000000-0000-4000-8000-000000000003',
  documentIncarnationId: '00000000-0000-4000-8000-000000000004',
  target,
  expiresAt: '2026-08-22T12:00:00Z',
};
const liveAuthority = (currentLease = lease) => ({
  target,
  lease: currentLease,
  documentAuthoritySha256,
});
const recoveryLiveAuthority = (request: { replacementLease: typeof lease }) =>
  liveAuthority(request.replacementLease);

function binding(requestId = '00000000-0000-4000-8000-000000000010') {
  return {
    formatVersion: '2.0.0',
    requestId,
    target,
    requestedAt: '2026-08-22T10:00:00Z',
    bindingContentSha256: requestId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
    expectedState: { reportId: 'report', sequence: 1 },
    plan: { id: 'plan', revision: 1 },
    proposalId: 'proposal',
    executionId: 'execution',
    leafId: 'leaf',
    override: { modality: 'menu' },
  };
}

function delivery(value = binding()) {
  return {
    binding: value,
    deliveryId: '00000000-0000-4000-8000-000000000020',
    lease,
    dispatchedAt: '2026-08-22T10:00:01Z',
  };
}

const phases = [
  'baseline_attested',
  'proof_in_progress',
  'proof_observed_locked',
  'restore_in_progress',
  'baseline_restored',
  'commit_intent_recorded',
] as const;

function progressChain(value = delivery()) {
  return phases.map((phase, index) => ({
    ...value,
    currentLease: {
      ...lease,
      expiresAt: `2026-08-22T12:00:${String(index).padStart(2, '0')}Z`,
    },
    phase,
    sequence: index + 1,
    previousProgressContentSha256: index === 0 ? null : `progress-${index}`,
    contentSha256: `progress-${index + 1}`,
    occurredAt: `2026-08-22T10:00:0${index + 2}Z`,
    ...(phase === 'baseline_restored'
      ? { baseline: { contentSha256: 'baseline' } }
      : phase === 'commit_intent_recorded'
        ? {
            baseline: { contentSha256: 'baseline' },
            intent: { intentId: 'intent', contentSha256: 'intent-hash' },
          }
        : {}),
  }));
}

function managedStartSubmission(sent: ReturnType<typeof delivery>, chain = progressChain(sent)) {
  return {
    requestId: sent.binding.requestId,
    deliveryId: sent.deliveryId,
    bindingContentSha256: sent.binding.bindingContentSha256,
    currentLease: chain.at(-1)!.currentLease,
    commitProgress: chain.at(-1)!,
    managedStart: {
      commitIntentId: 'intent',
      contentSha256: 'managed-start',
      startedAt: '2026-08-22T10:00:09Z',
    },
  };
}

class MemoryEvents implements BlenderExecutionTrackExecutionEventStore {
  readonly events: ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']>[] = [];

  appendEvent(
    input: Parameters<BlenderExecutionTrackExecutionEventStore['appendEvent']>[0],
  ): ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']> {
    if (this.events.some((event) => event.id === input.id)) {
      throw new Error(`UNIQUE constraint failed: execution_events.id (${input.id})`);
    }
    const event = {
      ...structuredClone(input),
      sequence: this.events.length + 1,
      createdAt: input.createdAt ?? now(),
    };
    this.events.push(event);
    return event;
  }

  listExecutionEventsByTypes(
    types: readonly string[],
  ): ReturnType<BlenderExecutionTrackExecutionEventStore['listExecutionEventsByTypes']> {
    return this.events.filter((event) => types.includes(event.eventType));
  }
}

let clock = 0;
const now = () => `2026-08-22T11:00:${String(clock++).padStart(2, '0')}Z`;

function coordinator(events = new MemoryEvents(), validateManagedResult = () => undefined) {
  return {
    events,
    coordinator: createBlenderExecutionTrackExecutionCoordinator({
      eventStore: events,
      now,
      validateManagedResult,
    }),
  };
}

function dispatchedHarness(validateManagedResult = () => undefined) {
  const harness = coordinator(new MemoryEvents(), validateManagedResult);
  const request = binding();
  harness.coordinator.queue(request as never, documentAuthoritySha256);
  const sent = harness.coordinator.poll(
    'blender',
    target.instanceId,
    documentAuthoritySha256,
    lease as never,
  );
  if (sent === null) throw new Error('expected polled delivery');
  return { ...harness, request, sent };
}

function reportProgress(
  subject: ReturnType<typeof createBlenderExecutionTrackExecutionCoordinator>,
  progress: ReturnType<typeof progressChain>[number],
) {
  return subject.acceptProgress(progress as never, liveAuthority(progress.currentLease));
}

function reportManagedStart(
  subject: ReturnType<typeof createBlenderExecutionTrackExecutionCoordinator>,
  submission: ReturnType<typeof managedStartSubmission>,
) {
  return subject.startManaged(submission as never, liveAuthority(submission.currentLease));
}

beforeEach(() => {
  clock = 0;
});

describe('Blender execution-track v2 coordinator', () => {
  it('deduplicates canonical progress and rejects stale forks', () => {
    const { coordinator: subject, sent } = dispatchedHarness();
    const first = progressChain(sent)[0]!;
    const second = progressChain(sent)[1]!;

    expect(reportProgress(subject, first)).toBe('accepted');
    expect(reportProgress(subject, first)).toBe('duplicate');
    expect(() =>
      subject.acceptProgress(first as never, {
        ...liveAuthority(first.currentLease),
        documentAuthoritySha256: 'e'.repeat(64),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_live_authority',
      }),
    );
    expect(() => reportProgress(subject, { ...first, contentSha256: 'fork' })).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_progress_fork',
      }),
    );
    expect(reportProgress(subject, second)).toBe('accepted');
    expect(() => reportProgress(subject, first)).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_live_authority',
      }),
    );
    expect(subject.get(first.binding.requestId)).not.toBeNull();
  });

  it('finds an exact create idempotently and rejects reused request authority', () => {
    const { coordinator: subject, request } = dispatchedHarness();
    const create = {
      formatVersion: request.formatVersion,
      requestId: request.requestId,
      target: request.target,
      proposalId: request.proposalId,
      plan: request.plan,
      executionId: request.executionId,
      leafId: request.leafId,
      override: request.override,
      expectedState: request.expectedState,
    };

    expect(subject.findForCreate(create as never)?.binding).toEqual(request);
    expect(() => subject.findForCreate({ ...create, executionId: 'forked' } as never)).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_request_conflict',
      }),
    );
  });

  it('enforces one active lock per adapter and instance', () => {
    const { coordinator: subject } = coordinator();
    subject.queue(binding() as never, documentAuthoritySha256);

    expect(() =>
      subject.queue(
        binding('00000000-0000-4000-8000-000000000011') as never,
        documentAuthoritySha256,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_target_locked',
      }),
    );
    expect(subject.ownsTarget('blender', target.instanceId)).toBe(true);
  });

  it('fails closed when another coordinator owns the target', () => {
    const events = new MemoryEvents();
    const subject = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: events,
      now,
      validateManagedResult: () => undefined,
      externalTargetLockOwner: () => 'shortcut-proof:owner',
    });

    expect(() => subject.queue(binding() as never, documentAuthoritySha256)).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_external_target_locked',
      }),
    );
    expect(events.events).toHaveLength(0);
  });

  it('uses deterministic logical event slots so a parallel fork hits storage uniqueness', () => {
    const { events, coordinator: subject } = coordinator();
    subject.queue(binding() as never, documentAuthoritySha256);
    const queued = events.events[0]!;

    expect(queued.id.endsWith(':queued')).toBe(true);
    expect(() => events.appendEvent({ ...queued, payload: { fork: true } })).toThrowError(
      /UNIQUE constraint/,
    );
  });

  it('preserves the original lease while accepting monotonic current-lease renewal', () => {
    const { coordinator: subject, sent } = dispatchedHarness();
    const first = progressChain(sent)[0]!;
    const second = progressChain(sent)[1]!;
    reportProgress(subject, first);
    reportProgress(subject, second);

    expect(subject.get(sent.binding.requestId)?.lease).toEqual(lease);
    expect(subject.get(sent.binding.requestId)?.progress?.currentLease.expiresAt).toBe(
      '2026-08-22T12:00:01Z',
    );
    expect(() =>
      reportProgress(subject, {
        ...progressChain(sent)[2]!,
        currentLease: { ...lease, expiresAt: '2026-08-22T11:59:59Z' },
      }),
    ).toThrowError();
  });

  it('accepts a phase-matched Companion recovery result and issues companion-reported recovery', () => {
    const harness = dispatchedHarness();
    const first = progressChain(harness.sent)[0]!;
    reportProgress(harness.coordinator, first);

    expect(
      harness.coordinator.acceptResult(
        {
          requestId: harness.sent.binding.requestId,
          deliveryId: harness.sent.deliveryId,
          bindingContentSha256: harness.sent.binding.bindingContentSha256,
          target,
          currentLease: first.currentLease,
          status: 'recovery_required',
          recoveryReason: 'baseline_unproven',
          occurredAt: '2026-08-22T10:00:04Z',
        } as never,
        liveAuthority(first.currentLease),
      ),
    ).toBe('accepted');
    expect(harness.coordinator.ownsTarget('blender', target.instanceId)).toBe(true);
    const request = harness.coordinator.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'companion-replacement',
      expiresAt: '2026-08-22T12:20:00Z',
    } as never);
    expect(request?.source).toBe('companion_reported');
  });

  it('requires semantic validation for failed managed terminal results', () => {
    const validator = vi.fn();
    const harness = dispatchedHarness(validator);
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const submission = managedStartSubmission(harness.sent, chain);
    reportManagedStart(harness.coordinator, submission);

    harness.coordinator.acceptResult(
      {
        requestId: harness.sent.binding.requestId,
        deliveryId: harness.sent.deliveryId,
        bindingContentSha256: harness.sent.binding.bindingContentSha256,
        target,
        currentLease: submission.currentLease,
        status: 'failed_managed',
        managedStart: submission.managedStart,
        occurredAt: '2026-08-22T10:00:10Z',
      } as never,
      liveAuthority(submission.currentLease),
    );

    expect(validator).toHaveBeenCalledOnce();

    const replayValidator = vi.fn();
    createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: replayValidator,
    });
    expect(replayValidator).toHaveBeenCalledOnce();
    expect(replayValidator.mock.calls[0]?.[1]).toMatchObject({
      status: 'managed_action_in_progress',
    });
  });

  it('attests a directly accepted failed terminal before issuing its repair challenge', () => {
    const harness = dispatchedHarness();
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const submission = managedStartSubmission(harness.sent, chain);
    reportManagedStart(harness.coordinator, submission);
    const failedResult = {
      requestId: harness.sent.binding.requestId,
      deliveryId: harness.sent.deliveryId,
      bindingContentSha256: harness.sent.binding.bindingContentSha256,
      target,
      currentLease: submission.currentLease,
      status: 'failed_managed',
      managedStart: submission.managedStart,
      managedReport: { reportId: 'direct-failed-report', sequence: 2 },
      managedCheckpoint: { checkpointId: 'direct-failed-checkpoint' },
      failedObservation: { contentSha256: 'direct-failed-observation' },
      occurredAt: '2026-08-22T10:00:10Z',
    } as const;
    harness.coordinator.acceptResult(failedResult as never, liveAuthority(submission.currentLease));

    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => 'direct-failed-marker-challenge',
      validateManagedResult: () => undefined,
    });
    const markerLease = {
      ...lease,
      leaseId: 'direct-failed-marker-lease',
      expiresAt: '2026-08-22T12:20:00Z',
    } as never;
    const markerRequest = restarted.pollRecovery('blender', target.instanceId, markerLease)!;
    const eventsAfterMarkerChallenge = harness.events.events.length;
    expect(restarted.pollRecovery('blender', target.instanceId, markerLease)).toEqual(
      markerRequest,
    );
    expect(restarted.pollRecovery('blender', target.instanceId, markerLease)).toEqual(
      markerRequest,
    );
    expect(harness.events.events).toHaveLength(eventsAfterMarkerChallenge);
    expect(markerRequest.source).toBe('companion_reported');
    expect(markerRequest.durableReferences).toMatchObject({
      terminalMarkerContentSha256: null,
    });
    expect(markerRequest.durableReferences).not.toHaveProperty('terminalResultContentSha256');
    const markerAck = {
      request: markerRequest,
      requestId: markerRequest.requestId,
      outcome: 'reconciled',
      evidence: {
        kind: 'persisted_managed_terminal',
        terminalResult: failedResult,
        terminalResultContentSha256: 'direct-failed-result-hash',
        terminalMarker: { contentSha256: 'direct-failed-marker-hash' },
      },
      retainsTargetLock: true,
      occurredAt: markerRequest.requestedAt,
    } as const;
    expect(() =>
      restarted.acceptRecoveryAck(
        {
          ...markerAck,
          evidence: {
            ...markerAck.evidence,
            terminalResult: { ...failedResult, occurredAt: '2026-08-22T10:00:09Z' },
          },
        } as never,
        recoveryLiveAuthority(markerRequest),
      ),
    ).toThrowError(/different result/i);
    expect(
      restarted.acceptRecoveryAck(markerAck as never, recoveryLiveAuthority(markerRequest)),
    ).toBe('accepted');
    expect(
      restarted.acceptRecoveryAck(markerAck as never, recoveryLiveAuthority(markerRequest)),
    ).toBe('duplicate');
    expect(restarted.get(markerRequest.requestId)?.status).toBe('failed_managed');
    expect(restarted.ownsTarget('blender', target.instanceId)).toBe(true);

    const afterMarkerRestart = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => 'direct-failed-repair-challenge',
      validateManagedResult: () => undefined,
    });
    const repairLease = {
      ...lease,
      leaseId: 'direct-failed-repair-lease',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never;
    const repairRequest = afterMarkerRestart.pollRecovery(
      'blender',
      target.instanceId,
      repairLease,
    )!;
    const eventsAfterRepairChallenge = harness.events.events.length;
    expect(afterMarkerRestart.pollRecovery('blender', target.instanceId, repairLease)).toEqual(
      repairRequest,
    );
    expect(harness.events.events).toHaveLength(eventsAfterRepairChallenge);
    expect(repairRequest.source).toBe('failed_managed_repair');
    expect(repairRequest.durableReferences).toMatchObject({
      terminalResultContentSha256: 'direct-failed-result-hash',
      terminalMarkerContentSha256: 'direct-failed-marker-hash',
    });
  });

  it('uses a renewed result lease as recovery replacement authority after managed start', () => {
    const harness = dispatchedHarness();
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const submission = managedStartSubmission(harness.sent, chain);
    const commit = chain.at(-1)!;
    if (!('intent' in commit)) throw new Error('expected commit progress');
    reportManagedStart(harness.coordinator, submission);
    const resultLease = {
      ...submission.currentLease,
      expiresAt: '2026-08-22T12:30:00Z',
    };
    harness.coordinator.acceptResult(
      {
        requestId: harness.request.requestId,
        deliveryId: harness.sent.deliveryId,
        bindingContentSha256: harness.request.bindingContentSha256,
        target,
        currentLease: resultLease,
        status: 'recovery_required',
        recoveryReason: 'managed_state_indeterminate',
        commitIntentId: submission.managedStart.commitIntentId,
        commitIntentContentSha256: commit.intent.contentSha256,
        managedStart: submission.managedStart,
        occurredAt: '2026-08-22T10:00:10Z',
      } as never,
      liveAuthority(resultLease),
    );

    expect(() =>
      harness.coordinator.pollRecovery('blender', target.instanceId, {
        ...lease,
        leaseId: 'replacement-before-result-expiry',
        expiresAt: '2026-08-22T12:20:00Z',
      } as never),
    ).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_recovery_challenge',
      }),
    );

    const replacementLease = {
      ...lease,
      leaseId: 'replacement-after-result-expiry',
      expiresAt: '2026-08-22T12:40:00Z',
    };
    const request = harness.coordinator.pollRecovery(
      'blender',
      target.instanceId,
      replacementLease as never,
    );
    expect(request?.replacementLease).toEqual(replacementLease);

    const replayed = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });
    expect(replayed.get(harness.request.requestId)?.result?.currentLease).toEqual(resultLease);
    expect(replayed.pollRecovery('blender', target.instanceId, replacementLease as never)).toEqual(
      request,
    );
  });

  it.each([
    ['dispatched', 'failed_no_mutation', false],
    ['baseline_attested', 'recovery_required', true],
    ['proof_in_progress', 'recovery_required', true],
    ['proof_observed_locked', 'recovery_required', true],
    ['restore_in_progress', 'recovery_required', true],
    ['baseline_restored', 'failed_restored', false],
    ['commit_intent_recorded', 'recovery_required', true],
  ] as const)('maps restart from %s to %s', (phase, expected, locked) => {
    const { coordinator: subject, events, sent } = dispatchedHarness();
    const chain = progressChain(sent);
    const progressCount = phase === 'dispatched' ? 0 : phases.indexOf(phase) + 1;
    for (const progress of chain.slice(0, progressCount)) reportProgress(subject, progress);

    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: events,
      now,
      validateManagedResult: () => undefined,
    });

    expect(restarted.get(sent.binding.requestId)?.status).toBe(expected);
    expect(restarted.ownsTarget('blender', target.instanceId)).toBe(locked);
  });

  it('replays a restart-generated terminal outcome across a second restart', () => {
    const harness = dispatchedHarness();
    createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });

    const restartedAgain = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });

    expect(restartedAgain.get(harness.request.requestId)?.status).toBe('failed_no_mutation');
  });

  it('always maps document authority drift to recovery-required', () => {
    const { coordinator: subject, sent } = dispatchedHarness();

    subject.reconcileDocumentAuthority('blender', target.instanceId, 'e'.repeat(64));

    expect(subject.get(sent.binding.requestId)?.status).toBe('recovery_required');
    expect(subject.ownsTarget('blender', target.instanceId)).toBe(true);
  });

  it('expires stale queued authority, blocks stale poll delivery, and exposes lock owners', () => {
    const { coordinator: subject } = coordinator();
    const request = binding();
    subject.queue(request as never, documentAuthoritySha256);

    expect(subject.targetLockOwner('blender', target.instanceId)).toEqual({
      requestId: request.requestId,
      status: 'queued',
    });
    expect(subject.listTargetLockOwners()).toHaveLength(1);
    expect(subject.poll('blender', target.instanceId, 'e'.repeat(64), lease as never)).toBeNull();
    expect(subject.get(request.requestId)?.status).toBe('pre_dispatch_authority_expired');
    expect(subject.ownsTarget('blender', target.instanceId)).toBe(false);

    const delivered = dispatchedHarness();
    delivered.coordinator.reconcileDocumentAuthority('blender', target.instanceId, 'e'.repeat(64));
    expect(delivered.coordinator.get(delivered.request.requestId)?.status).toBe(
      'recovery_required',
    );
    expect(delivered.coordinator.ownsTarget('blender', target.instanceId)).toBe(true);
  });

  it('redelivers the immutable dispatch after a lost poll response under a live heartbeat', () => {
    const { coordinator: subject } = coordinator();
    const request = binding();
    subject.queue(request as never, documentAuthoritySha256);
    const first = subject.poll(
      'blender',
      target.instanceId,
      documentAuthoritySha256,
      lease as never,
    );
    const heartbeat = { ...lease, expiresAt: '2026-08-22T12:05:00Z' };

    expect(
      subject.poll('blender', target.instanceId, documentAuthoritySha256, heartbeat as never),
    ).toEqual(first);
  });

  it('persists an exact managed-start submission before acknowledging mutation authority', () => {
    const harness = dispatchedHarness();
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const submission = managedStartSubmission(harness.sent, chain);
    submission.currentLease = {
      ...submission.currentLease,
      expiresAt: '2026-08-22T12:01:00Z',
    };

    expect(() =>
      reportManagedStart(harness.coordinator, { ...submission, deliveryId: 'fork' }),
    ).toThrowError();
    expect(reportManagedStart(harness.coordinator, submission)).toBe('accepted');
    expect(harness.events.events.at(-1)).toMatchObject({
      eventType: 'blender.execution-track-execution.managed-started',
    });
    expect(harness.events.events.at(-1)?.id.endsWith(':managed-started')).toBe(true);
    expect(reportManagedStart(harness.coordinator, submission)).toBe('duplicate');
  });

  it('unlocks reconciled success but retains unresolved and failed-managed locks', () => {
    const makeRecovery = () => {
      clock = 0;
      const harness = dispatchedHarness();
      const chain = progressChain(harness.sent);
      for (const progress of chain) reportProgress(harness.coordinator, progress);
      reportManagedStart(harness.coordinator, managedStartSubmission(harness.sent, chain));
      const restarted = createBlenderExecutionTrackExecutionCoordinator({
        eventStore: harness.events,
        now,
        validateManagedResult: () => undefined,
      });
      const recovery = restarted.pollRecovery('blender', target.instanceId, {
        ...lease,
        leaseId: 'replacement',
        expiresAt: '2026-08-22T12:10:00Z',
      } as never)!;
      expect(restarted.get(recovery.requestId)?.updatedAt).toBe(recovery.requestedAt);
      return { ...harness, restarted, recovery };
    };

    const unresolved = makeRecovery();
    const unresolvedAck = {
      request: unresolved.recovery,
      requestId: unresolved.recovery.requestId,
      outcome: 'recovery_required',
      evidence: { kind: 'unresolved_current_state' },
      retainsTargetLock: true,
      occurredAt: unresolved.recovery.requestedAt,
    };
    expect(unresolved.restarted.isRecoveryAckDuplicate(unresolvedAck as never)).toBe(false);
    expect(
      unresolved.restarted.acceptRecoveryAck(
        unresolvedAck as never,
        recoveryLiveAuthority(unresolved.recovery),
      ),
    ).toBe('accepted');
    expect(unresolved.restarted.isRecoveryAckDuplicate(unresolvedAck as never)).toBe(true);
    expect(
      unresolved.restarted.isRecoveryAckDuplicate({
        ...unresolvedAck,
        occurredAt: 'later',
      } as never),
    ).toBe(false);
    expect(
      unresolved.restarted.acceptRecoveryAck(
        unresolvedAck as never,
        recoveryLiveAuthority(unresolved.recovery),
      ),
    ).toBe('duplicate');
    expect(unresolved.restarted.ownsTarget('blender', target.instanceId)).toBe(true);
    expect(unresolved.restarted.get(unresolved.recovery.requestId)?.updatedAt).toBe(
      (unresolved.events.events.at(-1)?.payload as { status: { updatedAt: string } }).status
        .updatedAt,
    );
    const rotatedRecovery = unresolved.restarted.pollRecovery('blender', target.instanceId, {
      ...unresolved.recovery.replacementLease,
      leaseId: 'replacement-rotated',
      expiresAt: '2026-08-22T12:20:00Z',
    } as never)!;
    expect(rotatedRecovery.recoveryId).not.toBe(unresolved.recovery.recoveryId);
    expect(() =>
      unresolved.restarted.acceptRecoveryAck(
        unresolvedAck as never,
        recoveryLiveAuthority(unresolved.recovery),
      ),
    ).toThrowError();

    const reconciled = makeRecovery();
    const reconciledAck = {
      request: reconciled.recovery,
      requestId: reconciled.recovery.requestId,
      outcome: 'reconciled',
      retainsTargetLock: false,
      evidence: {
        kind: 'persisted_managed_terminal',
        terminalResult: {
          requestId: reconciled.sent.binding.requestId,
          deliveryId: reconciled.sent.deliveryId,
          bindingContentSha256: reconciled.sent.binding.bindingContentSha256,
          target,
          status: 'succeeded',
          currentLease: managedStartSubmission(reconciled.sent).currentLease,
          managedStart: managedStartSubmission(reconciled.sent).managedStart,
          occurredAt: reconciled.recovery.requestedAt,
        },
      },
      occurredAt: reconciled.recovery.requestedAt,
    };
    expect(
      reconciled.restarted.acceptRecoveryAck(
        reconciledAck as never,
        recoveryLiveAuthority(reconciled.recovery),
      ),
    ).toBe('accepted');
    expect(
      reconciled.restarted.acceptRecoveryAck(
        reconciledAck as never,
        recoveryLiveAuthority(reconciled.recovery),
      ),
    ).toBe('duplicate');
    expect(reconciled.restarted.ownsTarget('blender', target.instanceId)).toBe(false);

    const managed = dispatchedHarness();
    const chain = progressChain(managed.sent);
    for (const progress of chain) reportProgress(managed.coordinator, progress);
    reportManagedStart(managed.coordinator, managedStartSubmission(managed.sent, chain));
    const failedManagedResult = {
      requestId: managed.sent.binding.requestId,
      deliveryId: managed.sent.deliveryId,
      bindingContentSha256: managed.sent.binding.bindingContentSha256,
      target,
      currentLease: chain.at(-1)!.currentLease,
      status: 'failed_managed',
      managedStart: managedStartSubmission(managed.sent, chain).managedStart,
      occurredAt: '2026-08-22T10:00:10Z',
    } as const;
    expect(managed.coordinator.isResultDuplicate(failedManagedResult as never)).toBe(false);
    managed.coordinator.acceptResult(
      failedManagedResult as never,
      liveAuthority(chain.at(-1)!.currentLease),
    );
    expect(managed.coordinator.isResultDuplicate(failedManagedResult as never)).toBe(true);
    expect(
      managed.coordinator.isResultDuplicate({
        ...failedManagedResult,
        occurredAt: 'later',
      } as never),
    ).toBe(false);
    expect(managed.coordinator.ownsTarget('blender', target.instanceId)).toBe(true);
  });

  it('reconciles a failed managed result persisted across the managed-start crash window', () => {
    const harness = dispatchedHarness();
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const submission = managedStartSubmission(harness.sent, chain);
    reportManagedStart(harness.coordinator, submission);

    const validator = vi.fn();
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => 'failed-managed-recovery',
      validateManagedResult: validator,
    });
    const recovery = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'failed-managed-replacement',
      expiresAt: '2026-08-22T12:10:00Z',
    } as never)!;
    const failedResult = {
      requestId: harness.sent.binding.requestId,
      deliveryId: harness.sent.deliveryId,
      bindingContentSha256: harness.sent.binding.bindingContentSha256,
      target,
      currentLease: submission.currentLease,
      status: 'failed_managed',
      managedStart: submission.managedStart,
      managedReport: { reportId: 'failed-report', sequence: 2 },
      managedCheckpoint: { checkpointId: 'failed-checkpoint' },
      failedObservation: { contentSha256: 'failed-observation' },
      occurredAt: '2026-08-22T10:00:10Z',
    } as const;

    expect(
      restarted.acceptRecoveryAck(
        {
          request: recovery,
          requestId: recovery.requestId,
          outcome: 'reconciled',
          evidence: {
            kind: 'persisted_managed_terminal',
            terminalResult: failedResult,
            terminalResultContentSha256: 'failed-result-hash',
            terminalMarker: { contentSha256: 'failed-marker-hash' },
          },
          retainsTargetLock: true,
          occurredAt: recovery.requestedAt,
        } as never,
        recoveryLiveAuthority(recovery),
      ),
    ).toBe('accepted');
    expect(validator).toHaveBeenCalledWith(
      failedResult,
      expect.objectContaining({ status: 'recovery_required' }),
    );
    expect(restarted.get(recovery.requestId)?.status).toBe('failed_managed');
    expect(restarted.ownsTarget('blender', target.instanceId)).toBe(true);

    const replayValidator = vi.fn();
    const replayed = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => 'managed-repair-recovery',
      validateManagedResult: replayValidator,
    });
    expect(replayed.get(recovery.requestId)?.status).toBe('failed_managed');
    expect(replayValidator).toHaveBeenCalledOnce();

    const repair = replayed.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'managed-repair-replacement',
      expiresAt: '2026-08-22T12:20:00Z',
    } as never)!;
    expect(repair.source).toBe('failed_managed_repair');
    expect(repair.durableReferences).toMatchObject({
      terminalResultContentSha256: 'failed-result-hash',
      terminalMarkerContentSha256: 'failed-marker-hash',
    });
    const repairedAck = {
      request: repair,
      requestId: repair.requestId,
      outcome: 'reconciled',
      evidence: {
        kind: 'managed_repair_terminal',
        failedTerminalResult: failedResult,
        failedTerminalResultContentSha256: 'failed-result-hash',
        failedTerminalMarker: { contentSha256: 'failed-marker-hash' },
        recoveredReport: {
          reportId: 'repaired-report',
          sequence: 3,
          nativeUndoCheckpoint: {
            checkpointId: 'repaired-checkpoint',
            previousCheckpointId: 'failed-checkpoint',
          },
        },
        recoveredReportContentSha256: 'repaired-report-hash',
        currentState: { reportId: 'repaired-report', sequence: 3 },
      },
      retainsTargetLock: false,
      occurredAt: repair.requestedAt,
    } as const;
    const eventsBeforeAuthorization = harness.events.events.length;
    const authorization = replayed.authorizeRecoveryAck(
      repairedAck as never,
      recoveryLiveAuthority(repair),
    );
    expect(authorization.result).toBe('accepted');
    expect(harness.events.events).toHaveLength(eventsBeforeAuthorization);
    expect(replayed.get(repair.requestId)?.status).toBe('failed_managed');
    expect(replayed.ownsTarget('blender', target.instanceId)).toBe(true);
    expect(() => replayed.commitAuthorizedRecoveryAck(authorization)).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_managed_repair_atomic_commit_required',
      }),
    );
    expect(replayed.get(repair.requestId)?.status).toBe('failed_managed');
    expect(replayed.ownsTarget('blender', target.instanceId)).toBe(true);
    const failedCommitAuthorization = replayed.authorizeRecoveryAck(
      repairedAck as never,
      recoveryLiveAuthority(repair),
    );
    expect(() =>
      replayed.commitAuthorizedRecoveryAck(failedCommitAuthorization, {
        commitManagedRepair: ({ evidence, reconciledEvent }) => {
          expect(evidence).toEqual(repairedAck.evidence);
          expect(reconciledEvent).toMatchObject({
            id: `blender-execution-track-execution:${repair.requestId}:recovery:${repair.recoveryId}:ack`,
            eventType: 'blender.execution-track-execution.reconciled',
            createdAt: repair.requestedAt,
          });
          throw new Error('injected atomic persistence failure');
        },
      }),
    ).toThrowError('injected atomic persistence failure');
    expect(replayed.get(repair.requestId)?.status).toBe('failed_managed');
    expect(replayed.ownsTarget('blender', target.instanceId)).toBe(true);
    const retryAuthorization = replayed.authorizeRecoveryAck(
      repairedAck as never,
      recoveryLiveAuthority(repair),
    );
    const durableAdopter = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });
    const tamperRejector = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });
    expect(durableAdopter.adoptDurableManagedRepairAck(repairedAck as never)).toBe(false);
    let durableReconciledEvent:
      ReturnType<BlenderExecutionTrackExecutionEventStore['appendEvent']> | undefined;
    expect(() =>
      replayed.commitAuthorizedRecoveryAck(retryAuthorization, {
        commitManagedRepair: ({ reconciledEvent }) => {
          durableReconciledEvent = harness.events.appendEvent(reconciledEvent);
          throw new Error('injected crash after durable atomic commit');
        },
      }),
    ).toThrowError('injected crash after durable atomic commit');
    expect(durableReconciledEvent).toBeDefined();
    expect(replayed.get(repair.requestId)?.status).toBe('failed_managed');
    expect(replayed.ownsTarget('blender', target.instanceId)).toBe(true);
    expect(durableAdopter.adoptDurableManagedRepairAck(repairedAck as never)).toBe(true);
    expect(durableAdopter.get(repair.requestId)?.status).toBe('failed_managed_repaired');
    expect(durableAdopter.ownsTarget('blender', target.instanceId)).toBe(false);
    expect(durableAdopter.adoptDurableManagedRepairAck(repairedAck as never)).toBe(true);

    const durableEventIndex = harness.events.events.findIndex(
      (event) => event.id === durableReconciledEvent?.id,
    );
    const exactDurableEvent = structuredClone(harness.events.events[durableEventIndex]!);
    harness.events.events[durableEventIndex] = {
      ...exactDurableEvent,
      payload: {
        ...(exactDurableEvent.payload as object),
        revision: (exactDurableEvent.payload as { revision: number }).revision + 1,
      },
    };
    expect(() => tamperRejector.adoptDurableManagedRepairAck(repairedAck as never)).toThrowError(
      /revision fork/i,
    );
    expect(tamperRejector.get(repair.requestId)?.status).toBe('failed_managed');
    expect(tamperRejector.ownsTarget('blender', target.instanceId)).toBe(true);
    harness.events.events[durableEventIndex] = exactDurableEvent;

    const applyRetryAuthorization = replayed.authorizeRecoveryAck(
      repairedAck as never,
      recoveryLiveAuthority(repair),
    );
    expect(
      replayed.commitAuthorizedRecoveryAck(applyRetryAuthorization, {
        commitManagedRepair: ({ reconciledEvent }) => {
          expect(reconciledEvent).toEqual(
            expect.objectContaining({
              id: durableReconciledEvent?.id,
              eventType: durableReconciledEvent?.eventType,
              payload: durableReconciledEvent?.payload,
              createdAt: durableReconciledEvent?.createdAt,
            }),
          );
          return durableReconciledEvent!;
        },
      }),
    ).toBe('accepted');
    expect(() => replayed.commitAuthorizedRecoveryAck(authorization)).toThrowError(/stale/i);
    expect(replayed.acceptRecoveryAck(repairedAck as never, recoveryLiveAuthority(repair))).toBe(
      'duplicate',
    );
    const rotatedAuthority = {
      ...recoveryLiveAuthority(repair),
      lease: {
        ...repair.replacementLease,
        leaseId: 'rotated-repair-lease',
        expiresAt: '2026-08-22T13:00:00Z',
      },
    } as never;
    expect(replayed.acceptRecoveryAck(repairedAck as never, rotatedAuthority)).toBe('duplicate');
    expect(() =>
      replayed.acceptRecoveryAck(
        { ...repairedAck, occurredAt: '2026-08-22T11:00:59Z' } as never,
        rotatedAuthority,
      ),
    ).toThrowError(/live replacement authority/i);
    expect(replayed.get(repair.requestId)?.status).toBe('failed_managed_repaired');
    expect(replayed.ownsTarget('blender', target.instanceId)).toBe(false);

    const repairedReplay = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
    });
    expect(repairedReplay.get(repair.requestId)?.status).toBe('failed_managed_repaired');
    expect(repairedReplay.ownsTarget('blender', target.instanceId)).toBe(false);
  });

  it('issues marker-free recovery authority and preserves the persisted managed-start hash', () => {
    const { events, sent } = dispatchedHarness();
    const seed = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: events,
      now,
      validateManagedResult: () => undefined,
    });
    expect(seed.get(sent.binding.requestId)?.status).toBe('failed_no_mutation');

    const managed = dispatchedHarness();
    const chain = progressChain(managed.sent);
    for (const progress of chain) reportProgress(managed.coordinator, progress);
    reportManagedStart(managed.coordinator, managedStartSubmission(managed.sent, chain));
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: managed.events,
      now,
      validateManagedResult: () => undefined,
    });
    const request = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'replacement',
      expiresAt: '2026-08-22T12:10:00Z',
    } as never)!;

    expect(request.durableReferences).toMatchObject({
      terminalMarkerContentSha256: null,
      managedStartContentSha256: 'managed-start',
      baselineContentSha256: 'baseline',
      commitIntentId: 'intent',
      commitIntentContentSha256: 'intent-hash',
    });
  });

  it('server-issues and idempotently reuses a current recovery challenge', () => {
    const managed = dispatchedHarness();
    const chain = progressChain(managed.sent);
    for (const progress of chain) reportProgress(managed.coordinator, progress);
    reportManagedStart(managed.coordinator, managedStartSubmission(managed.sent, chain));
    let recoverySequence = 0;
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: managed.events,
      now,
      validateManagedResult: () => undefined,
      createId: () => `server-recovery-${++recoverySequence}`,
    });
    const replacement = {
      ...lease,
      leaseId: 'server-replacement',
      expiresAt: '2026-08-22T12:30:00Z',
    };

    const issued = restarted.pollRecovery('blender', target.instanceId, replacement as never)!;
    expect(issued.durableReferences).toMatchObject({
      terminalMarkerContentSha256: null,
      managedStartContentSha256: 'managed-start',
    });
    expect(restarted.pollRecovery('blender', target.instanceId, replacement as never)).toEqual(
      issued,
    );
    const rotated = restarted.pollRecovery('blender', target.instanceId, {
      ...replacement,
      leaseId: 'server-replacement-rotated',
      expiresAt: '2026-08-22T12:40:00Z',
    } as never)!;
    expect(rotated.recoveryId).not.toBe(issued.recoveryId);
    expect(rotated.requestedAt > issued.requestedAt).toBe(true);
    expect(
      restarted.pollRecovery('blender', target.instanceId, {
        ...replacement,
        sessionId: 'different-session',
      } as never),
    ).toBeNull();
  });

  it('rejects recovered managed success when no managed-start submission was acknowledged', () => {
    const harness = dispatchedHarness();
    const chain = progressChain(harness.sent);
    for (const progress of chain) reportProgress(harness.coordinator, progress);
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      validateManagedResult: () => undefined,
      createId: () => 'recovery-without-start',
    });
    const request = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'replacement-without-start',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never)!;
    expect(request.durableReferences.managedStartContentSha256).toBeNull();

    expect(() =>
      restarted.acceptRecoveryAck(
        {
          request,
          requestId: request.requestId,
          outcome: 'reconciled',
          retainsTargetLock: false,
          evidence: {
            kind: 'persisted_managed_terminal',
            terminalResult: {
              status: 'succeeded',
              currentLease: lease,
              managedStart: managedStartSubmission(harness.sent, chain).managedStart,
            },
          },
          occurredAt: request.requestedAt,
        } as never,
        recoveryLiveAuthority(request),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<BlenderExecutionTrackExecutionError>>({
        code: 'execution_track_execution_unpersisted_managed_start',
      }),
    );
  });

  it('rejects hostile replay that rewrites an accepted progress-chain slot', () => {
    const harness = dispatchedHarness();
    const first = progressChain(harness.sent)[0]!;
    const second = progressChain(harness.sent)[1]!;
    reportProgress(harness.coordinator, first);
    reportProgress(harness.coordinator, second);
    const progressed = harness.events.events.filter((event) =>
      event.eventType.endsWith('.progressed'),
    );
    expect(progressed.map((event) => event.id.slice(event.id.lastIndexOf(':progress')))).toEqual([
      ':progress:1',
      ':progress:2',
    ]);
    const latest = progressed.at(-1)!;
    const payload = structuredClone(latest.payload) as {
      progressChain: Array<Record<string, unknown>>;
    };
    payload.progressChain[0] = { ...payload.progressChain[0], contentSha256: 'rewritten' };
    (latest as { payload: unknown }).payload = payload;

    expect(() =>
      createBlenderExecutionTrackExecutionCoordinator({
        eventStore: harness.events,
        now,
        validateManagedResult: () => undefined,
      }),
    ).toThrowError(/progress chain|discontinuous|rewrote/i);
  });

  it.each(['companion-terminal', 'server-recovery-terminal'] as const)(
    'rejects hostile replay where a %s event appends progress',
    (terminalKind) => {
      const harness = dispatchedHarness();
      const first = progressChain(harness.sent)[0]!;
      const second = progressChain(harness.sent)[1]!;
      if (terminalKind === 'companion-terminal') {
        reportProgress(harness.coordinator, first);
        harness.coordinator.acceptResult(
          {
            requestId: harness.request.requestId,
            deliveryId: harness.sent.deliveryId,
            bindingContentSha256: harness.request.bindingContentSha256,
            target,
            currentLease: first.currentLease,
            status: 'failed_no_mutation',
            occurredAt: '2026-08-22T10:00:04Z',
          } as never,
          liveAuthority(first.currentLease),
        );
      } else {
        createBlenderExecutionTrackExecutionCoordinator({
          eventStore: harness.events,
          now,
          validateManagedResult: () => undefined,
        });
      }
      const event = harness.events.events.at(-1)!;
      const payload = structuredClone(event.payload) as {
        status: { progress?: typeof first | typeof second };
        progressChain: Array<typeof first | typeof second>;
      };
      const injectedProgress = terminalKind === 'companion-terminal' ? second : first;
      payload.status.progress = injectedProgress;
      payload.progressChain.push(injectedProgress);
      (event as { payload: unknown }).payload = payload;

      expect(() =>
        createBlenderExecutionTrackExecutionCoordinator({
          eventStore: harness.events,
          now,
          validateManagedResult: () => undefined,
        }),
      ).toThrowError(/only progress events/i);
    },
  );

  it.each(['recoveryRequest', 'recoveryAck', 'managedStartSubmission'] as const)(
    'rejects hostile replay that injects the coordinator-owned %s slot',
    (slot) => {
      const harness = dispatchedHarness();
      reportProgress(harness.coordinator, progressChain(harness.sent)[0]!);
      const event = harness.events.events.at(-1)!;
      const payload = structuredClone(event.payload) as Record<string, unknown>;
      payload[slot] = { forged: true };
      (event as { payload: unknown }).payload = payload;

      expect(() =>
        createBlenderExecutionTrackExecutionCoordinator({
          eventStore: harness.events,
          now,
          validateManagedResult: () => undefined,
        }),
      ).toThrowError(/coordinator-owned|managed-start|recovery/i);
    },
  );

  it('rejects replay when a rotated recovery request retains the prior ACK', () => {
    const harness = dispatchedHarness();
    reportProgress(harness.coordinator, progressChain(harness.sent)[0]!);
    let recoverySequence = 0;
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => `rotation-${++recoverySequence}`,
      validateManagedResult: () => undefined,
    });
    const firstRequest = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'rotation-lease-1',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never)!;
    restarted.acceptRecoveryAck(
      {
        request: firstRequest,
        requestId: firstRequest.requestId,
        outcome: 'recovery_required',
        evidence: { kind: 'unresolved_current_state' },
        retainsTargetLock: true,
        occurredAt: firstRequest.requestedAt,
      } as never,
      recoveryLiveAuthority(firstRequest),
    );
    const priorAck = structuredClone(
      (harness.events.events.at(-1)!.payload as { recoveryAck: unknown }).recoveryAck,
    );
    restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'rotation-lease-2',
      expiresAt: '2026-08-22T12:40:00Z',
    } as never);
    const rotationEvent = harness.events.events.at(-1)!;
    const payload = structuredClone(rotationEvent.payload) as { recoveryAck?: unknown };
    payload.recoveryAck = priorAck;
    (rotationEvent as { payload: unknown }).payload = payload;

    expect(() =>
      createBlenderExecutionTrackExecutionCoordinator({
        eventStore: harness.events,
        now,
        validateManagedResult: () => undefined,
      }),
    ).toThrowError(/clear its ACK/i);
  });

  it.each(['recovery-requested', 'unresolved-reconciled'] as const)(
    'rejects replay when %s changes status fields other than updatedAt',
    (eventKind) => {
      const harness = dispatchedHarness();
      reportProgress(harness.coordinator, progressChain(harness.sent)[0]!);
      const restarted = createBlenderExecutionTrackExecutionCoordinator({
        eventStore: harness.events,
        now,
        createId: () => `exact-status-${eventKind}`,
        validateManagedResult: () => undefined,
      });
      const request = restarted.pollRecovery('blender', target.instanceId, {
        ...lease,
        leaseId: `exact-status-lease-${eventKind}`,
        expiresAt: '2026-08-22T12:30:00Z',
      } as never)!;
      if (eventKind === 'unresolved-reconciled') {
        restarted.acceptRecoveryAck(
          {
            request,
            requestId: request.requestId,
            outcome: 'recovery_required',
            evidence: { kind: 'unresolved_current_state' },
            retainsTargetLock: true,
            occurredAt: request.requestedAt,
          } as never,
          recoveryLiveAuthority(request),
        );
      }
      const event = harness.events.events.at(-1)!;
      const payload = structuredClone(event.payload) as {
        status: Record<string, unknown>;
      };
      payload.status.injectedReplayState = true;
      (event as { payload: unknown }).payload = payload;

      expect(() =>
        createBlenderExecutionTrackExecutionCoordinator({
          eventStore: harness.events,
          now,
          validateManagedResult: () => undefined,
        }),
      ).toThrowError(/changed execution status authority|changed lock or terminal state/i);
    },
  );

  it('rejects replay when persisted live receive chronology reaches the lease expiry', () => {
    const expireLastEventAt = (events: MemoryEvents, expiresAt: string) => {
      const event = events.events.at(-1)!;
      const payload = structuredClone(event.payload) as { status: { updatedAt: string } };
      payload.status.updatedAt = expiresAt;
      (event as { payload: unknown; createdAt: string }).payload = payload;
      (event as { createdAt: string }).createdAt = expiresAt;
    };
    const expectReplayChronologyFailure = (events: MemoryEvents) => {
      expect(() =>
        createBlenderExecutionTrackExecutionCoordinator({
          eventStore: events,
          now,
          validateManagedResult: () => undefined,
        }),
      ).toThrowError(/live receive chronology/i);
    };

    const progressed = dispatchedHarness();
    const first = progressChain(progressed.sent)[0]!;
    reportProgress(progressed.coordinator, first);
    expireLastEventAt(progressed.events, first.currentLease.expiresAt);
    expectReplayChronologyFailure(progressed.events);

    const managed = dispatchedHarness();
    const managedChain = progressChain(managed.sent);
    for (const progress of managedChain) reportProgress(managed.coordinator, progress);
    const submission = managedStartSubmission(managed.sent, managedChain);
    reportManagedStart(managed.coordinator, submission);
    expireLastEventAt(managed.events, submission.currentLease.expiresAt);
    expectReplayChronologyFailure(managed.events);

    const completed = dispatchedHarness();
    const completedChain = progressChain(completed.sent);
    for (const progress of completedChain) reportProgress(completed.coordinator, progress);
    const completedSubmission = managedStartSubmission(completed.sent, completedChain);
    reportManagedStart(completed.coordinator, completedSubmission);
    completed.coordinator.acceptResult(
      {
        requestId: completed.sent.binding.requestId,
        deliveryId: completed.sent.deliveryId,
        bindingContentSha256: completed.sent.binding.bindingContentSha256,
        target,
        currentLease: completedSubmission.currentLease,
        status: 'failed_managed',
        managedStart: completedSubmission.managedStart,
        occurredAt: '2026-08-22T10:00:10Z',
      } as never,
      liveAuthority(completedSubmission.currentLease),
    );
    expireLastEventAt(completed.events, completedSubmission.currentLease.expiresAt);
    expectReplayChronologyFailure(completed.events);

    const reconciled = dispatchedHarness();
    reportProgress(reconciled.coordinator, progressChain(reconciled.sent)[0]!);
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: reconciled.events,
      now,
      createId: () => 'chronology-recovery',
      validateManagedResult: () => undefined,
    });
    const request = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'chronology-replacement',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never)!;
    restarted.acceptRecoveryAck(
      {
        request,
        requestId: request.requestId,
        outcome: 'recovery_required',
        evidence: { kind: 'unresolved_current_state' },
        retainsTargetLock: true,
        occurredAt: request.requestedAt,
      } as never,
      recoveryLiveAuthority(request),
    );
    expireLastEventAt(reconciled.events, request.replacementLease.expiresAt);
    expectReplayChronologyFailure(reconciled.events);
  });

  it('rejects replay when coordinator-generated event times drift from their evidence', () => {
    const recovery = dispatchedHarness();
    reportProgress(recovery.coordinator, progressChain(recovery.sent)[0]!);
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: recovery.events,
      now,
      createId: () => 'evidence-time-recovery',
      validateManagedResult: () => undefined,
    });
    const request = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'evidence-time-replacement',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never)!;
    const requestEvent = recovery.events.events.at(-1)!;
    const requestPayload = structuredClone(requestEvent.payload) as {
      status: { updatedAt: string };
    };
    requestPayload.status.updatedAt = '2026-08-22T11:59:59Z';
    (requestEvent as { payload: unknown; createdAt: string }).payload = requestPayload;
    (requestEvent as { createdAt: string }).createdAt = requestPayload.status.updatedAt;

    expect(() =>
      createBlenderExecutionTrackExecutionCoordinator({
        eventStore: recovery.events,
        now,
        validateManagedResult: () => undefined,
      }),
    ).toThrowError(/recovery request time/i);
    expect(request.requestedAt).not.toBe(requestPayload.status.updatedAt);

    const serverRecovery = dispatchedHarness();
    reportProgress(serverRecovery.coordinator, progressChain(serverRecovery.sent)[0]!);
    createBlenderExecutionTrackExecutionCoordinator({
      eventStore: serverRecovery.events,
      now,
      validateManagedResult: () => undefined,
    });
    const recoveryEvent = serverRecovery.events.events.at(-1)!;
    const recoveryPayload = structuredClone(recoveryEvent.payload) as {
      status: { serverRecoveryEvidence: { detectedAt: string } };
    };
    recoveryPayload.status.serverRecoveryEvidence.detectedAt = '2026-08-22T10:59:59Z';
    (recoveryEvent as { payload: unknown }).payload = recoveryPayload;

    expect(() =>
      createBlenderExecutionTrackExecutionCoordinator({
        eventStore: serverRecovery.events,
        now,
        validateManagedResult: () => undefined,
      }),
    ).toThrowError(/server recovery evidence time/i);
  });

  it('rejects replay whose recovery ACK no longer matches the current challenge state', () => {
    const harness = dispatchedHarness();
    reportProgress(harness.coordinator, progressChain(harness.sent)[0]!);
    const restarted = createBlenderExecutionTrackExecutionCoordinator({
      eventStore: harness.events,
      now,
      createId: () => 'replay-recovery',
      validateManagedResult: () => undefined,
    });
    const request = restarted.pollRecovery('blender', target.instanceId, {
      ...lease,
      leaseId: 'replay-replacement',
      expiresAt: '2026-08-22T12:30:00Z',
    } as never)!;
    restarted.acceptRecoveryAck(
      {
        request,
        requestId: request.requestId,
        outcome: 'recovery_required',
        evidence: { kind: 'unresolved_current_state' },
        retainsTargetLock: true,
        occurredAt: request.requestedAt,
      } as never,
      recoveryLiveAuthority(request),
    );
    const ackEvent = harness.events.events.at(-1)!;
    const payload = structuredClone(ackEvent.payload) as { status: { status: string } };
    payload.status.status = 'succeeded';
    (ackEvent as { payload: unknown }).payload = payload;

    expect(() =>
      createBlenderExecutionTrackExecutionCoordinator({
        eventStore: harness.events,
        now,
        validateManagedResult: () => undefined,
      }),
    ).toThrowError(/acknowledgement|terminal|lock/i);
  });
});
