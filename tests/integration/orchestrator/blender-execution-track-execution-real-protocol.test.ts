import { spawnSync } from 'node:child_process';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionResultSchema,
  computeProtocolCanonicalJsonSha256,
} from '@operatingline/protocol';
import { expect, it } from 'vitest';

import { createBlenderExecutionTrackExecutionCoordinator } from '../../../services/orchestrator/src/blender-execution-track-execution.js';
import {
  hashScenarioContent as hashContent,
  managedExecutionTrackBaseline,
  managedExecutionTrackBinding,
  managedExecutionTrackProgressTail,
  managedExecutionTrackStartReport,
} from '../../support/managed-execution-track-scenario.js';
import {
  executionTrackPreflightLease,
  preflightIds,
} from '../../unit/support/execution-track-preflight-fixture.js';

type EventStore = Pick<OperatingLineDatabase, 'appendEvent' | 'listExecutionEventsByTypes'>;

class MemoryEventStore implements EventStore {
  readonly events: ReturnType<EventStore['appendEvent']>[] = [];

  appendEvent(input: Parameters<EventStore['appendEvent']>[0]) {
    if (this.events.some((event) => event.id === input.id)) throw new Error('duplicate event id');
    const event = {
      ...structuredClone(input),
      sequence: this.events.length + 1,
      createdAt: input.createdAt ?? '2026-08-22T10:00:01Z',
    };
    this.events.push(event);
    return event;
  }

  listExecutionEventsByTypes(types: readonly string[]) {
    return this.events.filter((event) => types.includes(event.eventType));
  }
}

it('accepts the Blender fail-closed consumer output through the strict protocol coordinator', () => {
  const events = new MemoryEventStore();
  const binding = managedExecutionTrackBinding();
  const lease = {
    ...executionTrackPreflightLease(),
    expiresAt: '2099-08-22T10:10:00Z',
  };
  let currentTime = '2026-08-22T10:00:01Z';
  const coordinator = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => currentTime,
    createId: () => '90000000-0000-4000-8000-000000000004',
    validateManagedResult: () => undefined,
  });
  coordinator.queue(binding, 'd'.repeat(64));
  const delivery = coordinator.poll('blender', binding.target.instanceId, 'd'.repeat(64), lease);
  if (delivery === null) throw new Error('expected delivery');
  const startReport = managedExecutionTrackStartReport(
    delivery,
    managedExecutionTrackBaseline(delivery),
  );
  const python = String.raw`
from importlib import import_module
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

payload = json.load(sys.stdin)
package_root = Path.cwd() / "adapters" / "blender" / "extension" / "operating_line"
package_name = "operating_line_execution_track_cross_protocol"
fake_bpy = ModuleType("bpy")
fake_bpy.context = SimpleNamespace()
sys.modules.setdefault("bpy", fake_bpy)
package = ModuleType(package_name)
package.__path__ = [str(package_root)]
sys.modules[package_name] = package
infrastructure = ModuleType(f"{package_name}.infrastructure")
infrastructure.__path__ = [str(package_root / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
consumer = import_module(f"{package_name}.infrastructure.execution_track_execution")
consumer._scene_snapshot = lambda: payload["snapshot"]
consumer.compute_scene_fingerprint_sha256 = lambda _snapshot: "a" * 64
outbox = consumer.build_fail_closed_outbox(
    payload["delivery"],
    instance_id=payload["instanceId"],
    last_report=payload["lastReport"],
    current_lease=payload["currentLease"],
)
json.dump(outbox, sys.stdout, separators=(",", ":"), sort_keys=True)
`;
  const generated = spawnSync('python3', ['-c', python], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: JSON.stringify({
      delivery,
      instanceId: binding.target.instanceId,
      lastReport: startReport,
      currentLease: lease,
      snapshot: {
        activeObject: 'Cube',
        selectedObjects: ['Cube'],
        objects: [{ name: 'Cube', type: 'MESH', mesh: { vertices: 8 } }],
      },
    }),
  });
  expect(generated.status, generated.stderr).toBe(0);
  const outbox = JSON.parse(generated.stdout) as Record<string, unknown>;
  const progress = companionExecutionTrackExecutionProgressSchema.parse(outbox['progress']);
  const result = companionExecutionTrackExecutionResultSchema.parse(outbox['result']);
  currentTime = progress.occurredAt;
  const liveAuthority = {
    target: binding.target,
    lease,
    documentAuthoritySha256: 'd'.repeat(64),
  };
  expect(coordinator.acceptProgress(progress, liveAuthority)).toBe('accepted');
  currentTime = result.occurredAt;
  expect(coordinator.acceptResult(result, liveAuthority)).toBe('accepted');
  expect(coordinator.get(binding.requestId)?.status).toBe('failed_no_mutation');
  expect(coordinator.ownsTarget('blender', binding.target.instanceId)).toBe(false);
});

it('runs and replays a real protocol six-phase managed execution', () => {
  const events = new MemoryEventStore();
  const binding = managedExecutionTrackBinding();
  const lease = {
    ...executionTrackPreflightLease(),
    expiresAt: '2026-08-22T10:10:00Z',
  };
  let currentTime = '2026-08-22T10:00:01Z';
  const coordinator = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => currentTime,
    createId: () => '90000000-0000-4000-8000-000000000004',
    validateManagedResult: () => undefined,
  });

  coordinator.queue(binding, 'd'.repeat(64));
  const delivery = coordinator.poll('blender', binding.target.instanceId, 'd'.repeat(64), lease);

  expect(delivery?.binding).toEqual(binding);
  expect(delivery?.lease).toEqual(lease);
  if (delivery === null) throw new Error('expected delivery');
  const checkpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: '90000000-0000-4000-8000-000000000003',
    previousCheckpointId: null,
    operation: 'start',
    committedAt: '2026-08-22T09:59:59Z',
    marker: { key: '_operating_line_native_history_v1', matched: true },
    journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
    session: {
      plan: { id: binding.plan.id, revision: binding.plan.revision },
      planContentSha256: binding.plan.contentSha256,
      executionId: binding.executionId,
      activeStepId: null,
      completedStepIds: [],
      receiptStepIds: [],
    },
  };
  const attestationContent = {
    checkpointId: checkpoint.checkpointId,
    reportId: binding.expectedState.reportId,
    sequence: binding.expectedState.sequence,
    sceneFingerprintSha256: 'a'.repeat(64),
    identitySnapshot: {
      viewLayerIdentitySha256: 'b'.repeat(64),
      objectIdentitySha256: 'c'.repeat(64),
      meshIdentitySha256: 'd'.repeat(64),
      collectionIdentitySha256: 'e'.repeat(64),
      sessionUidDomainSha256: '1'.repeat(64),
      pointerDomainSha256: '2'.repeat(64),
      linksAndSelectionSha256: '3'.repeat(64),
    },
    documentIncarnationId: lease.documentIncarnationId,
    sessionId: lease.sessionId,
    leaseId: lease.leaseId,
    attestedAt: '2026-08-22T10:00:02Z',
  };
  const startAttestation = {
    ...attestationContent,
    contentSha256: computeProtocolCanonicalJsonSha256(attestationContent),
  };
  const progressContent = {
    ...delivery,
    currentLease: lease,
    phase: 'baseline_attested',
    sequence: 1,
    previousProgressContentSha256: null,
    occurredAt: '2026-08-22T10:00:02Z',
    startCheckpoint: checkpoint,
    startAttestation,
  };
  const progress = companionExecutionTrackExecutionProgressSchema.parse({
    ...progressContent,
    contentSha256: computeProtocolCanonicalJsonSha256(progressContent),
  });
  if (progress.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  currentTime = '2026-08-22T10:00:03Z';

  expect(
    coordinator.acceptProgress(progress, {
      target: binding.target,
      lease,
      documentAuthoritySha256: 'd'.repeat(64),
    }),
  ).toBe('accepted');
  const tail = managedExecutionTrackProgressTail(delivery, progress);
  const receiveTimes = [
    '2026-08-22T10:00:10Z',
    '2026-08-22T10:00:12Z',
    '2026-08-22T10:00:13Z',
    '2026-08-22T10:00:20Z',
    '2026-08-22T10:00:21Z',
  ];
  tail.forEach((nextProgress, index) => {
    currentTime = receiveTimes[index]!;
    expect(
      coordinator.acceptProgress(nextProgress, {
        target: binding.target,
        lease: nextProgress.currentLease,
        documentAuthoritySha256: 'd'.repeat(64),
      }),
    ).toBe('accepted');
  });
  const commit = tail.at(-1)!;
  if (commit.phase !== 'commit_intent_recorded') throw new Error('expected commit progress');
  const managedStart = hashContent({
    managedStartId: '90000000-0000-4000-8000-000000000009',
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
    previousProgressContentSha256: commit.contentSha256,
    startedAt: '2026-08-22T10:00:21Z',
  });
  const submission = companionExecutionTrackExecutionManagedStartSubmissionSchema.parse({
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    currentLease: commit.currentLease,
    commitProgress: commit,
    managedStart,
  });
  currentTime = '2026-08-22T10:00:22Z';
  expect(
    coordinator.startManaged(submission, {
      target: binding.target,
      lease: submission.currentLease,
      documentAuthoritySha256: 'd'.repeat(64),
    }),
  ).toBe('accepted');
  const result = companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    currentLease: submission.currentLease,
    proposalId: binding.proposalId,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    occurredAt: '2026-08-22T10:00:23Z',
    status: 'succeeded',
    startCheckpointId: progress.startCheckpoint.checkpointId,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
    lastProgressContentSha256: commit.contentSha256,
    managedStart,
    managedReport: {
      reportId: preflightIds.report,
      sequence: binding.expectedState.sequence + 1,
      transition: 'step_succeeded',
      stepId: binding.leafId,
      contentSha256: '1'.repeat(64),
    },
    managedCheckpoint: {
      checkpointId: '90000000-0000-4000-8000-000000000030',
      previousCheckpointId: progress.startCheckpoint.checkpointId,
      operation: 'next',
      receiptStepIds: [binding.leafId],
      contentSha256: '2'.repeat(64),
    },
    managedObservation: {
      observationIndex: 0,
      kind: 'uv_sphere_ready',
      contentSha256: '3'.repeat(64),
    },
  });
  currentTime = '2026-08-22T10:00:24Z';
  expect(
    coordinator.acceptResult(result, {
      target: binding.target,
      lease: result.currentLease,
      documentAuthoritySha256: 'd'.repeat(64),
    }),
  ).toBe('accepted');
  const replayContexts: string[] = [];
  const replayed = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => '2026-08-22T10:00:25Z',
    validateManagedResult: (_result, status) => replayContexts.push(status.status),
  });

  expect(replayed.get(binding.requestId)?.status).toBe('succeeded');
  expect(replayed.ownsTarget('blender', binding.target.instanceId)).toBe(false);
  expect(replayContexts).toEqual(['managed_action_in_progress']);
  expect(events.events.map((event) => event.eventType)).toEqual([
    'blender.execution-track-execution.queued',
    'blender.execution-track-execution.dispatched',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.progressed',
    'blender.execution-track-execution.managed-started',
    'blender.execution-track-execution.completed',
  ]);

  const renewedEvents = new MemoryEventStore();
  let renewedTime = '2026-08-22T10:00:01Z';
  const renewedCoordinator = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: renewedEvents,
    now: () => renewedTime,
    createId: (() => {
      let calls = 0;
      return () => (calls++ === 0 ? delivery.deliveryId : '90000000-0000-4000-8000-000000000014');
    })(),
    validateManagedResult: () => undefined,
  });
  renewedCoordinator.queue(binding, 'd'.repeat(64));
  const renewedDelivery = renewedCoordinator.poll(
    'blender',
    binding.target.instanceId,
    'd'.repeat(64),
    lease,
  );
  if (renewedDelivery === null) throw new Error('expected renewed delivery');
  expect(renewedDelivery).toEqual(delivery);
  renewedTime = '2026-08-22T10:00:03Z';
  renewedCoordinator.acceptProgress(progress, {
    target: binding.target,
    lease: progress.currentLease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  tail.forEach((nextProgress, index) => {
    renewedTime = receiveTimes[index]!;
    renewedCoordinator.acceptProgress(nextProgress, {
      target: binding.target,
      lease: nextProgress.currentLease,
      documentAuthoritySha256: 'd'.repeat(64),
    });
  });
  renewedTime = '2026-08-22T10:00:22Z';
  renewedCoordinator.startManaged(submission, {
    target: binding.target,
    lease: submission.currentLease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  const resultLease = {
    ...submission.currentLease,
    expiresAt: '2026-08-22T10:20:00Z',
  };
  const recoveryResult = companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    currentLease: resultLease,
    proposalId: binding.proposalId,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    occurredAt: '2026-08-22T10:00:23Z',
    status: 'recovery_required',
    recoveryReason: 'managed_state_indeterminate',
    lastProgressContentSha256: commit.contentSha256,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    managedStart,
    automaticReplay: false,
    error: 'Managed result requires reconciliation after a renewed heartbeat.',
  });
  renewedTime = '2026-08-22T10:00:24Z';
  renewedCoordinator.acceptResult(recoveryResult, {
    target: binding.target,
    lease: resultLease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  expect(() =>
    renewedCoordinator.pollRecovery('blender', binding.target.instanceId, {
      ...lease,
      leaseId: '90000000-0000-4000-8000-000000000015',
      expiresAt: '2026-08-22T10:15:00Z',
    }),
  ).toThrowError(/durable execution authority/i);
  const sufficientReplacement = {
    ...lease,
    leaseId: '90000000-0000-4000-8000-000000000016',
    expiresAt: '2026-08-22T10:30:00Z',
  };
  const recoveryRequest = renewedCoordinator.pollRecovery(
    'blender',
    binding.target.instanceId,
    sufficientReplacement,
  );
  expect(recoveryRequest?.replacementLease).toEqual(sufficientReplacement);
  const renewedReplay = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: renewedEvents,
    now: () => '2026-08-22T10:00:25Z',
    validateManagedResult: () => undefined,
  });
  expect(renewedReplay.get(binding.requestId)?.result?.currentLease).toEqual(resultLease);
  expect(
    renewedReplay.pollRecovery('blender', binding.target.instanceId, sufficientReplacement),
  ).toEqual(recoveryRequest);
}, 30_000);

it('reconciles a real companion-reported recovery result with baseline terminal evidence', () => {
  const events = new MemoryEventStore();
  const binding = managedExecutionTrackBinding();
  const lease = {
    ...executionTrackPreflightLease(),
    expiresAt: '2026-08-22T10:10:00Z',
  };
  let currentTime = '2026-08-22T10:00:01Z';
  let generatedId = 3;
  const coordinator = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => currentTime,
    createId: () => `90000000-0000-4000-8000-00000000000${++generatedId}`,
    validateManagedResult: () => undefined,
  });
  coordinator.queue(binding, 'd'.repeat(64));
  const delivery = coordinator.poll('blender', binding.target.instanceId, 'd'.repeat(64), lease);
  if (delivery === null) throw new Error('expected delivery');
  const checkpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: '90000000-0000-4000-8000-000000000003',
    previousCheckpointId: null,
    operation: 'start',
    committedAt: '2026-08-22T09:59:59Z',
    marker: { key: '_operating_line_native_history_v1', matched: true },
    journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
    session: {
      plan: { id: binding.plan.id, revision: binding.plan.revision },
      planContentSha256: binding.plan.contentSha256,
      executionId: binding.executionId,
      activeStepId: null,
      completedStepIds: [],
      receiptStepIds: [],
    },
  };
  const attestationContent = {
    checkpointId: checkpoint.checkpointId,
    reportId: binding.expectedState.reportId,
    sequence: binding.expectedState.sequence,
    sceneFingerprintSha256: 'a'.repeat(64),
    identitySnapshot: {
      viewLayerIdentitySha256: 'b'.repeat(64),
      objectIdentitySha256: 'c'.repeat(64),
      meshIdentitySha256: 'd'.repeat(64),
      collectionIdentitySha256: 'e'.repeat(64),
      sessionUidDomainSha256: '1'.repeat(64),
      pointerDomainSha256: '2'.repeat(64),
      linksAndSelectionSha256: '3'.repeat(64),
    },
    documentIncarnationId: lease.documentIncarnationId,
    sessionId: lease.sessionId,
    leaseId: lease.leaseId,
    attestedAt: '2026-08-22T10:00:02Z',
  };
  const startAttestation = hashContent(attestationContent);
  const baseline = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent({
      ...delivery,
      currentLease: lease,
      phase: 'baseline_attested',
      sequence: 1,
      previousProgressContentSha256: null,
      occurredAt: '2026-08-22T10:00:02Z',
      startCheckpoint: checkpoint,
      startAttestation,
    }),
  );
  currentTime = '2026-08-22T10:00:03Z';
  coordinator.acceptProgress(baseline, {
    target: binding.target,
    lease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  const recoveryResult = companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    currentLease: lease,
    proposalId: binding.proposalId,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    status: 'recovery_required',
    recoveryReason: 'baseline_unproven',
    lastProgressContentSha256: baseline.contentSha256,
    automaticReplay: false,
    error: 'Baseline state requires read-only reconciliation.',
    occurredAt: '2026-08-22T10:00:04Z',
  });
  currentTime = '2026-08-22T10:00:05Z';
  coordinator.acceptResult(recoveryResult, {
    target: binding.target,
    lease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  const replacementLease = {
    ...lease,
    leaseId: '90000000-0000-4000-8000-000000000011',
    expiresAt: '2026-08-22T10:20:00Z',
  };
  currentTime = '2026-08-22T10:00:06Z';
  const request = coordinator.pollRecovery('blender', binding.target.instanceId, replacementLease);
  if (request === null) throw new Error('expected recovery request');
  const terminalResult = companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    currentLease: lease,
    proposalId: binding.proposalId,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    status: 'failed_no_mutation',
    startCheckpointId: checkpoint.checkpointId,
    baselineAttestationContentSha256: startAttestation.contentSha256,
    lastProgressContentSha256: baseline.contentSha256,
    error: 'No mutation occurred before reconciliation.',
    occurredAt: '2026-08-22T10:00:03Z',
  });
  const currentStateFor = (currentReplacementLease: typeof replacementLease, observedAt: string) =>
    hashContent({
      authentication: 'replacement_lease_recovery_post',
      replacementLeaseId: currentReplacementLease.leaseId,
      sessionId: currentReplacementLease.sessionId,
      documentIncarnationId: currentReplacementLease.documentIncarnationId,
      reportId: startAttestation.reportId,
      sequence: startAttestation.sequence,
      sceneFingerprintSha256: startAttestation.sceneFingerprintSha256,
      ...startAttestation.identitySnapshot,
      observedAt,
    });
  const unresolvedAck = companionExecutionTrackExecutionRecoveryAckSchema.parse({
    formatVersion: '2.0.0',
    request,
    recoveryId: request.recoveryId,
    requestId: request.requestId,
    originalDeliveryId: request.originalDeliveryId,
    bindingContentSha256: request.bindingContentSha256,
    replacementLeaseId: replacementLease.leaseId,
    acceptedProgressChainHeadContentSha256: request.acceptedProgressChainHeadContentSha256,
    durableReferences: request.durableReferences,
    outcome: 'recovery_required',
    evidence: {
      kind: 'unresolved_current_state',
      reason: 'proof_or_restore_indeterminate',
      currentState: currentStateFor(replacementLease, '2026-08-22T10:00:07Z'),
    },
    retainsTargetLock: true,
    automaticReplay: false,
    occurredAt: '2026-08-22T10:00:07Z',
  });
  currentTime = '2026-08-22T10:00:08Z';
  expect(
    coordinator.acceptRecoveryAck(unresolvedAck, {
      target: binding.target,
      lease: replacementLease,
      documentAuthoritySha256: 'd'.repeat(64),
    }),
  ).toBe('accepted');

  const afterUnresolved = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => currentTime,
    createId: () => '90000000-0000-4000-8000-000000000013',
    validateManagedResult: () => undefined,
  });
  expect(afterUnresolved.get(binding.requestId)).toMatchObject({
    status: 'recovery_required',
    result: recoveryResult,
  });
  expect(afterUnresolved.ownsTarget('blender', binding.target.instanceId)).toBe(true);

  const rotatedReplacementLease = {
    ...replacementLease,
    leaseId: '90000000-0000-4000-8000-000000000012',
    expiresAt: '2026-08-22T10:30:00Z',
  };
  currentTime = '2026-08-22T10:00:09Z';
  const rotatedRequest = afterUnresolved.pollRecovery(
    'blender',
    binding.target.instanceId,
    rotatedReplacementLease,
  );
  if (rotatedRequest === null) throw new Error('expected rotated recovery request');
  expect(rotatedRequest.recoveryId).not.toBe(request.recoveryId);
  expect(events.events.at(-1)?.payload).not.toHaveProperty('recoveryAck');
  const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse({
    formatVersion: '2.0.0',
    request: rotatedRequest,
    recoveryId: rotatedRequest.recoveryId,
    requestId: rotatedRequest.requestId,
    originalDeliveryId: rotatedRequest.originalDeliveryId,
    bindingContentSha256: rotatedRequest.bindingContentSha256,
    replacementLeaseId: rotatedReplacementLease.leaseId,
    acceptedProgressChainHeadContentSha256: rotatedRequest.acceptedProgressChainHeadContentSha256,
    durableReferences: rotatedRequest.durableReferences,
    outcome: 'reconciled',
    evidence: {
      kind: 'baseline_terminal',
      terminalResult,
      terminalResultContentSha256: computeProtocolCanonicalJsonSha256(terminalResult),
      progress: baseline,
      currentState: currentStateFor(rotatedReplacementLease, '2026-08-22T10:00:10Z'),
    },
    retainsTargetLock: false,
    automaticReplay: false,
    occurredAt: '2026-08-22T10:00:10Z',
  });
  currentTime = '2026-08-22T10:00:11Z';

  const eventsBeforeAuthorization = events.events.length;
  const authorization = afterUnresolved.authorizeRecoveryAck(ack, {
    target: binding.target,
    lease: rotatedReplacementLease,
    documentAuthoritySha256: 'd'.repeat(64),
  });
  expect(authorization.result).toBe('accepted');
  expect(events.events).toHaveLength(eventsBeforeAuthorization);
  expect(afterUnresolved.get(binding.requestId)?.status).toBe('recovery_required');
  expect(afterUnresolved.commitAuthorizedRecoveryAck(authorization)).toBe('accepted');
  expect(afterUnresolved.get(binding.requestId)?.status).toBe('failed_no_mutation');
  expect(afterUnresolved.ownsTarget('blender', binding.target.instanceId)).toBe(false);

  const replayed = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    now: () => '2026-08-22T10:00:12Z',
    validateManagedResult: () => undefined,
  });
  expect(replayed.get(binding.requestId)?.status).toBe('failed_no_mutation');
  expect(replayed.ownsTarget('blender', binding.target.instanceId)).toBe(false);
});
