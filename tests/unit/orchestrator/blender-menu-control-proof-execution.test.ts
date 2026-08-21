import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  computeCompanionMenuControlProofFailureCheckpointContentSha256,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  BlenderMenuControlProofExecutionError,
  createBlenderMenuControlProofExecutionCoordinator,
} from '../../../services/orchestrator/src/blender-menu-control-proof-execution.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  replay: '22222222-2222-4222-8222-222222222222',
  proof: '33333333-3333-4333-8333-333333333333',
  delivery: '44444444-4444-4444-8444-444444444444',
  instance: '55555555-5555-4555-8555-555555555555',
  proposal: '66666666-6666-4666-8666-666666666666',
  execution: '77777777-7777-4777-8777-777777777777',
  report: '88888888-8888-4888-8888-888888888888',
  binding: '99999999-9999-4999-8999-999999999999',
  decision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lease: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  document: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;
const hash = (digit: string) => digit.repeat(64);
const fingerprint = hash('f');
const executionClock = () => {
  let calls = 0;
  return () => (calls++ === 0 ? '2026-08-22T10:00:04+08:00' : '2026-08-22T10:02:00+08:00');
};
const operationIds = [
  'workspace.layout',
  'menu.add',
  'menu.mesh',
  'operator.uv_sphere',
  'control.location',
  'control.scale',
  'control.object_name',
] as const;
const mutationStages = [
  'uv_sphere_created',
  'location_x_set',
  'location_y_set',
  'location_z_set',
  'scale_x_set',
  'scale_y_set',
  'scale_z_set',
  'object_name_set',
] as const;

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) throw new Error(`duplicate ${input.id}`);
      const event = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-22T10:00:00+08:00',
      };
      events.push(event);
      return event;
    },
    listExecutionEventsByTypes(types: readonly string[]) {
      return events.filter((event) => types.includes(event.eventType));
    },
  };
}

function binding() {
  const content = {
    formatVersion: '1.0.0',
    bindingId: ids.binding,
    proposalRecordContentSha256: hash('0'),
    proofId: ids.proof,
    requestId: ids.request,
    replayId: ids.replay,
    target: { adapterId: 'blender', instanceId: ids.instance },
    proposalId: ids.proposal,
    packetContentSha256: hash('1'),
    inputTreeContentSha256: hash('2'),
    outputTreeContentSha256: hash('3'),
    materializationContentSha256: hash('4'),
    proposalContentSha256: hash('5'),
    plan: { id: 'plan.uv-sphere', revision: 1, contentSha256: hash('6') },
    executionId: ids.execution,
    leafId: 'leaf.uv-sphere',
    recipeId: 'blender.mesh.create_uv_sphere.native',
    actionName: 'blender.mesh.create_uv_sphere',
    acceptedAction: {
      adapterId: 'blender',
      name: 'blender.mesh.create_uv_sphere',
      arguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    },
    targetProfile: 'factory_layout_three_object_ui_scale_2',
    acceptedDecision: {
      decisionId: ids.decision,
      proposalId: ids.proposal,
      instanceId: ids.instance,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-22T10:00:00+08:00',
    },
    startState: {
      reportId: ids.report,
      sequence: 7,
      adapterId: 'blender',
      instanceId: ids.instance,
      plan: { id: 'plan.uv-sphere', revision: 1 },
      planContentSha256: hash('6'),
      executionId: ids.execution,
      phase: 'running',
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      stepId: null,
      observationCount: 0,
      nativeUndoCheckpoint: {
        formatVersion: '1.0.0',
        evidenceClass: 'companion_reported_native_undo_checkpoint',
        checkpointId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        previousCheckpointId: null,
        operation: 'start',
        committedAt: '2026-08-22T10:00:01+08:00',
        marker: { key: '_operating_line_native_history_v1', matched: true },
        journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
        session: {
          plan: { id: 'plan.uv-sphere', revision: 1 },
          planContentSha256: hash('6'),
          executionId: ids.execution,
          activeStepId: null,
          completedStepIds: [],
          receiptStepIds: [],
        },
      },
      occurredAt: '2026-08-22T10:00:01+08:00',
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['resourceId'],
    },
    materialization: {
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.39.0',
      interactionCatalogContentSha256: hash('7'),
      packetContentSha256: hash('1'),
      inputTreeContentSha256: hash('2'),
      outputTreeContentSha256: hash('3'),
      materializationContentSha256: hash('4'),
      menuTrackContentSha256: hash('8'),
    },
    executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    nativeUndoDepth: 8,
    createdAt: '2026-08-22T10:00:02+08:00',
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofBindingContentSha256(content),
    },
  } as const;
}

function queuedStatus() {
  const accepted = binding();
  return {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    proofId: ids.proof,
    target: accepted.target,
    targetProfile: accepted.targetProfile,
    proposalId: accepted.proposalId,
    proposalRecordContentSha256: accepted.proposalRecordContentSha256,
    proposalContentSha256: accepted.proposalContentSha256,
    plan: accepted.plan,
    executionId: accepted.executionId,
    leafId: accepted.leafId,
    packetContentSha256: accepted.packetContentSha256,
    inputTreeContentSha256: accepted.inputTreeContentSha256,
    outputTreeContentSha256: accepted.outputTreeContentSha256,
    materializationContentSha256: accepted.materializationContentSha256,
    interactionCatalogVersion: accepted.materialization.interactionCatalogVersion,
    interactionCatalogContentSha256: accepted.materialization.interactionCatalogContentSha256,
    menuTrackContentSha256: accepted.materialization.menuTrackContentSha256,
    bindingContentSha256: accepted.integrity.contentSha256,
    binding: accepted,
    executorId: accepted.executorId,
    executionBoundary: accepted.executionBoundary,
    authorization: accepted.authorization,
    transport: accepted.transport,
    operationIds,
    nativeUndoDepth: 8,
    expectedState: { reportId: ids.report, sequence: 7 },
    startCheckpoint: accepted.startState,
    requestedAt: '2026-08-22T10:00:03+08:00',
    status: 'queued',
    updatedAt: '2026-08-22T10:00:03+08:00',
  } as const;
}

function distinctQueuedStatus() {
  const value: unknown = structuredClone(queuedStatus());
  const mutable = value as {
    requestId: string;
    replayId: string;
    proofId: string;
    proposalId: string;
    executionId: string;
    startCheckpoint: {
      executionId: string;
      nativeUndoCheckpoint: { session: { executionId: string } };
    };
    bindingContentSha256: string;
    binding: {
      bindingId: string;
      requestId: string;
      replayId: string;
      proofId: string;
      proposalId: string;
      executionId: string;
      acceptedDecision: { proposalId: string };
      startState: {
        executionId: string;
        nativeUndoCheckpoint: { session: { executionId: string } };
      };
      integrity: { contentSha256: string };
    };
  };
  mutable.requestId = '10111111-1111-4111-8111-111111111111';
  mutable.replayId = '20222222-2222-4222-8222-222222222222';
  mutable.proofId = '30333333-3333-4333-8333-333333333333';
  mutable.proposalId = '60666666-6666-4666-8666-666666666666';
  mutable.executionId = '70777777-7777-4777-8777-777777777777';
  mutable.startCheckpoint.executionId = mutable.executionId;
  mutable.startCheckpoint.nativeUndoCheckpoint.session.executionId = mutable.executionId;
  mutable.binding.bindingId = '90999999-9999-4999-8999-999999999999';
  mutable.binding.requestId = mutable.requestId;
  mutable.binding.replayId = mutable.replayId;
  mutable.binding.proofId = mutable.proofId;
  mutable.binding.proposalId = mutable.proposalId;
  mutable.binding.executionId = mutable.executionId;
  mutable.binding.acceptedDecision.proposalId = mutable.proposalId;
  mutable.binding.startState.executionId = mutable.executionId;
  mutable.binding.startState.nativeUndoCheckpoint.session.executionId = mutable.executionId;
  mutable.binding.integrity.contentSha256 = computeProcedureMenuControlProofBindingContentSha256(
    mutable.binding,
  );
  mutable.bindingContentSha256 = mutable.binding.integrity.contentSha256;
  return value as ReturnType<typeof queuedStatus>;
}

function lease(overrides: Record<string, unknown> = {}) {
  return {
    leaseId: ids.lease,
    sessionId: ids.session,
    target: queuedStatus().target,
    documentIncarnationId: ids.document,
    expiresAt: '2026-08-22T10:05:00+08:00',
    ...overrides,
  } as const;
}

function summaries() {
  return [
    { status: 'precondition_verified', path: ['Layout'] },
    { status: 'control_executed', path: ['Layout', 'Add'] },
    { status: 'control_executed', path: ['Layout', 'Add', 'Mesh'] },
    { status: 'control_executed', path: ['Layout', 'Add', 'Mesh', 'UV Sphere'], radius: 1 },
    {
      status: 'control_executed',
      path: ['Sidebar', 'Item', 'Transform', 'Location'],
      value: [1.25, -2, 0.75],
    },
    {
      status: 'control_executed',
      path: ['Sidebar', 'Item', 'Transform', 'Scale'],
      value: [1.5, 1.5, 1.5],
    },
    {
      status: 'control_executed',
      path: ['Properties', 'Object', 'Name'],
      value: 'OperatingLine.TutorialEye',
    },
  ] as const;
}

function receipts(delivery: ReturnType<typeof dispatch>) {
  let previousReceiptContentSha256: string | null = null;
  return operationIds.map((operationId, index) => {
    const content = {
      receiptId: `${index + 1}0000000-0000-4000-8000-000000000000`,
      proofId: ids.proof,
      requestId: ids.request,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded',
      summary: summaries()[index]!,
      occurredAt: `2026-08-22T10:00:${10 + index}+08:00`,
    } as const;
    const receipt = {
      ...content,
      contentSha256: computeCompanionMenuControlProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function progressFor(delivery: ReturnType<typeof dispatch>, count: number) {
  const prefix = receipts(delivery).slice(0, count);
  const mutationCount = [0, 0, 0, 1, 4, 7, 8][count - 1]!;
  return {
    ...delivery,
    status: 'in_progress',
    completedOperationIds: operationIds.slice(0, count),
    operationReceipts: prefix,
    receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
    nativeHistoryCursor: mutationCount,
    completedMutationStages: mutationStages.slice(0, mutationCount),
    occurredAt: `2026-08-22T10:01:0${count}+08:00`,
  } as const;
}

function dispatch(database = createEventDatabase()) {
  const coordinator = createBlenderMenuControlProofExecutionCoordinator({
    database,
    now: executionClock(),
    createId: () => ids.delivery,
  });
  coordinator.queue(queuedStatus(), fingerprint);
  return coordinator.poll({
    target: queuedStatus().target,
    documentAuthoritySha256: fingerprint,
    lease: lease(),
  })!;
}

function successfulResult(delivery: ReturnType<typeof dispatch>) {
  const allReceipts = receipts(delivery);
  const observationContent = {
    kind: 'uv_sphere_menu_controls_ready',
    satisfied: true,
    observationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    objectName: 'OperatingLine.TutorialEye',
    objectType: 'MESH',
    location: [1.25, -2, 0.75],
    scale: [1.5, 1.5, 1.5],
    meshTopology: { vertices: 482, edges: 992, polygons: 512 },
    meshSha256: hash('9'),
    sceneFingerprintSha256: hash('a'),
    observedAt: '2026-08-22T10:01:08+08:00',
  } as const;
  const observation = {
    ...observationContent,
    contentSha256: computeProtocolCanonicalJsonSha256(observationContent),
  } as const;
  return {
    ...delivery,
    status: 'succeeded',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'succeeded_locked',
      operationSummaries: allReceipts.map((receipt) => ({
        operationId: receipt.operationId,
        summaryContentSha256: computeProtocolCanonicalJsonSha256(receipt.summary),
      })),
      operationReceipts: allReceipts,
      strongObservation: observation,
      nativeUndoCheckpoint: {
        checkpointId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        undoLockId: '12345678-1234-4234-8234-123456789abc',
        nativeUndoDepth: 8,
        nativeHistoryCursor: 8,
        mutationStages,
        baselineSceneFingerprintSha256: hash('b'),
        finalSceneFingerprintSha256: observation.sceneFingerprintSha256,
        restoredSceneFingerprintSha256: hash('b'),
        reappliedSceneFingerprintSha256: observation.sceneFingerprintSha256,
        receiptChainRootSha256: allReceipts[0]!.contentSha256,
        receiptChainHeadSha256: allReceipts.at(-1)!.contentSha256,
        strongObservationContentSha256: observation.contentSha256,
        committedAt: '2026-08-22T10:01:09+08:00',
      },
    },
    error: null,
    occurredAt: '2026-08-22T10:01:10+08:00',
  } as const;
}

function failureResult(
  delivery: ReturnType<typeof dispatch>,
  status: 'failed_no_mutation' | 'failed_restored' | 'failed_checkpointed' | 'recovery_required',
  count = status === 'failed_no_mutation' ? 0 : 4,
) {
  const prefix = receipts(delivery).slice(0, count);
  const completedMutationStages = mutationStages.slice(0, count === 0 ? 0 : 1);
  const common = {
    ...delivery,
    status,
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    requiresUndoToUnlock: status === 'failed_checkpointed' || status === 'recovery_required',
    error: 'Menu execution failed.',
    occurredAt: '2026-08-22T10:01:10+08:00',
  } as const;
  if (status === 'failed_no_mutation') {
    return {
      ...common,
      status,
      terminalEvidence: {
        kind: status,
        receiptPrefix: [],
        lastCompletedOperationId: null,
        internalHistoryCursor: 0,
        completedMutationStages: [],
        automaticReplay: false,
      },
    } as const;
  }
  const evidenceCommon = {
    receiptPrefix: prefix,
    lastCompletedOperationId: operationIds[count - 1]!,
    internalHistoryCursor: status === 'failed_restored' ? 0 : 1,
    completedMutationStages,
    baselineSceneFingerprintSha256: hash('b'),
    currentSceneFingerprintSha256: status === 'failed_restored' ? hash('b') : hash('c'),
    automaticReplay: false,
  } as const;
  if (status === 'failed_checkpointed') {
    const checkpointContent = {
      formatVersion: '1.0.0',
      checkpointId: '23456789-2345-4234-8234-23456789abcd',
      undoLockId: '3456789a-3456-4345-8345-3456789abcde',
      proofId: ids.proof,
      replayId: ids.replay,
      target: { ...delivery.target, resourceId: 'proof.uv_sphere.eye' },
      internalHistoryCursor: 1,
      completedMutationStages,
      baselineSceneFingerprintSha256: hash('b'),
      currentSceneFingerprintSha256: hash('c'),
      receiptChainRootSha256: prefix[0]!.contentSha256,
      receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
      committedAt: '2026-08-22T10:01:09+08:00',
    } as const;
    return {
      ...common,
      status,
      terminalEvidence: {
        kind: status,
        ...evidenceCommon,
        checkpoint: {
          ...checkpointContent,
          contentSha256:
            computeCompanionMenuControlProofFailureCheckpointContentSha256(checkpointContent),
        },
      },
    } as const;
  }
  return {
    ...common,
    status,
    terminalEvidence: { kind: status, ...evidenceCommon },
  } as const;
}

function activeDatabase(progressCount = 0) {
  const database = createEventDatabase();
  const coordinator = createBlenderMenuControlProofExecutionCoordinator({
    database,
    now: executionClock(),
    createId: () => ids.delivery,
  });
  coordinator.queue(queuedStatus(), fingerprint);
  const delivery = coordinator.poll({
    target: queuedStatus().target,
    documentAuthoritySha256: fingerprint,
    lease: lease(),
  })!;
  for (let count = 1; count <= progressCount; count += 1) {
    coordinator.progress(progressFor(delivery, count), fingerprint);
  }
  return database;
}

function rewriteEventsAsHeadLegacyPayload(database: ReturnType<typeof createEventDatabase>): void {
  for (const event of database.events) {
    const current = event.payload as {
      execution: unknown;
      phase: unknown;
      progressReceiptChainHeads: unknown;
    };
    event.payload = {
      execution: current.execution,
      phase: current.phase,
      sessionFingerprintSha256: fingerprint,
      progressReceiptChainHeads: current.progressReceiptChainHeads,
    };
  }
}

describe('Blender menu-control proof execution coordinator', () => {
  it('accepts all seven exact receipt prefixes, reaches native cursor 8, and locks success', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    coordinator.queue(queuedStatus(), fingerprint);
    const delivery = coordinator.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    })!;
    for (let count = 1; count <= 7; count += 1) {
      const progress = progressFor(delivery, count);
      expect(coordinator.progress(progress, fingerprint)).toBe('accepted');
      expect(coordinator.progress(progress, fingerprint)).toBe('duplicate');
    }
    expect(coordinator.get(ids.request)?.progress?.nativeHistoryCursor).toBe(8);
    expect(coordinator.complete(successfulResult(delivery), fingerprint)).toBe('accepted');
    expect(coordinator.complete(successfulResult(delivery), fingerprint)).toBe('duplicate');
    expect(coordinator.ownsTarget('blender', ids.instance)).toBe(true);
    expect(database.events.map((event) => event.eventType)).toHaveLength(10);
    expect(
      createBlenderMenuControlProofExecutionCoordinator({ database }).ownsTarget(
        'blender',
        ids.instance,
      ),
    ).toBe(true);
  });

  it('rejects conflicting progress, wrong session/lease identity, and external locks', () => {
    const database = createEventDatabase();
    let serverNow = '2026-08-22T10:00:04+08:00';
    const coordinator = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => serverNow,
      createId: () => ids.delivery,
    });
    coordinator.queue(queuedStatus(), fingerprint);
    expect(() =>
      coordinator.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: hash('e'),
        lease: lease(),
      }),
    ).toThrowError(BlenderMenuControlProofExecutionError);
    expect(coordinator.get(ids.request)).toMatchObject({
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpiration: {
        kind: 'document_authority_changed_before_dispatch',
        priorStatus: 'queued',
        automaticReplayAllowed: false,
        retainsTargetLock: false,
      },
    });
    expect(coordinator.ownsTarget('blender', ids.instance)).toBe(false);

    const activeCoordinator = createBlenderMenuControlProofExecutionCoordinator({
      database: createEventDatabase(),
      now: () => serverNow,
      createId: () => ids.delivery,
    });
    activeCoordinator.queue(queuedStatus(), fingerprint);
    const delivery = activeCoordinator.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    })!;
    serverNow = '2026-08-22T10:02:00+08:00';
    expect(() => activeCoordinator.progress(progressFor(delivery, 1), hash('e'))).toThrowError(
      BlenderMenuControlProofExecutionError,
    );
    const foreignLease = structuredClone(progressFor(delivery, 1));
    foreignLease.lease.documentIncarnationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    expect(() => activeCoordinator.progress(foreignLease, fingerprint)).toThrow();
    activeCoordinator.progress(progressFor(delivery, 1), fingerprint);
    const conflict = structuredClone(progressFor(delivery, 1));
    conflict.occurredAt = '2026-08-22T10:01:02+08:00';
    expect(() => activeCoordinator.progress(conflict, fingerprint)).toThrowError(
      BlenderMenuControlProofExecutionError,
    );

    const locked = createBlenderMenuControlProofExecutionCoordinator({
      database: createEventDatabase(),
      externalHistoryLockOwner: () => 'shortcut-proof',
    });
    expect(() => locked.queue(queuedStatus(), fingerprint)).toThrowError(
      expect.objectContaining({ code: 'menu_control_proof_history_locked' }),
    );
    expect(() =>
      coordinator.findForCreate({
        formatVersion: '1.0.0',
        requestId: ids.request,
        replayId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        expectedState: queuedStatus().expectedState,
      }),
    ).toThrowError(expect.objectContaining({ code: 'menu_control_proof_request_conflict' }));
  });

  it('reconciles queued and delivered work when the same Companion process loads another document', () => {
    const sessionAuthority = hash('c');
    const queuedDatabase = createEventDatabase();
    const queuedCoordinator = createBlenderMenuControlProofExecutionCoordinator({
      database: queuedDatabase,
      now: () => '2026-08-22T10:00:05+08:00',
    });
    queuedCoordinator.queue(queuedStatus(), fingerprint, sessionAuthority);
    expect(queuedCoordinator.reconcileSessionAuthority(sessionAuthority, hash('e'))).toHaveLength(
      1,
    );
    expect(queuedCoordinator.get(ids.request)).toMatchObject({
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpiration: {
        priorStatus: 'queued',
        automaticReplayAllowed: false,
        retainsTargetLock: false,
      },
    });
    expect(queuedCoordinator.ownsTarget('blender', ids.instance)).toBe(false);

    let serverNow = '2026-08-22T10:00:04+08:00';
    const deliveredCoordinator = createBlenderMenuControlProofExecutionCoordinator({
      database: createEventDatabase(),
      now: () => serverNow,
      createId: () => ids.delivery,
    });
    deliveredCoordinator.queue(queuedStatus(), fingerprint, sessionAuthority);
    deliveredCoordinator.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    });
    serverNow = '2026-08-22T10:00:05+08:00';
    expect(
      deliveredCoordinator.reconcileSessionAuthority(sessionAuthority, hash('e')),
    ).toHaveLength(1);
    expect(deliveredCoordinator.get(ids.request)).toMatchObject({
      status: 'recovery_pending',
      recovery: {
        kind: 'document_authority_changed_after_delivery',
        priorStatus: 'dispatched',
        automaticReplayAllowed: false,
        retainsTargetLock: true,
      },
    });
    expect(
      deliveredCoordinator.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: hash('e'),
        lease: lease(),
      }),
    ).toBeNull();
  });

  it('rejects future-dated progress and results without mutation and accepts serverNow equality', () => {
    for (const kind of ['progress', 'result'] as const) {
      const database = createEventDatabase();
      let serverNow = '2026-08-22T10:00:04+08:00';
      const coordinator = createBlenderMenuControlProofExecutionCoordinator({
        database,
        now: () => serverNow,
        createId: () => ids.delivery,
      });
      coordinator.queue(queuedStatus(), fingerprint);
      const delivery = coordinator.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease(),
      })!;
      if (kind === 'progress') {
        const evidence = progressFor(delivery, 1);
        serverNow = '2026-08-22T10:01:00+08:00';
        expect(() => coordinator.progress(evidence, fingerprint)).toThrowError(
          expect.objectContaining({
            code: 'menu_control_proof_evidence_time_invalid',
            statusCode: 409,
          }),
        );
        expect(database.events).toHaveLength(2);
        expect(coordinator.get(ids.request)?.status).toBe('dispatched');
        serverNow = evidence.occurredAt;
        expect(coordinator.progress(evidence, fingerprint)).toBe('accepted');
      } else {
        const evidence = failureResult(delivery, 'failed_no_mutation');
        serverNow = '2026-08-22T10:01:09+08:00';
        expect(() => coordinator.complete(evidence, fingerprint)).toThrowError(
          expect.objectContaining({
            code: 'menu_control_proof_evidence_time_invalid',
            statusCode: 409,
          }),
        );
        expect(database.events).toHaveLength(2);
        expect(coordinator.get(ids.request)?.status).toBe('dispatched');
        serverNow = evidence.occurredAt;
        expect(coordinator.complete(evidence, fingerprint)).toBe('accepted');
      }
    }
  });

  it.each([
    ['2026-08-22T10:00:04+08:00', 'equal'],
    ['2026-08-22T10:00:03+08:00', 'expired'],
  ])('rejects a %s poll lease without dispatch', (expiresAt) => {
    const database = createEventDatabase();
    const coordinator = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:00:04+08:00',
      createId: () => ids.delivery,
    });
    coordinator.queue(queuedStatus(), fingerprint);
    expect(() =>
      coordinator.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease({ expiresAt }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'menu_control_proof_poll_authority_mismatch',
        statusCode: 409,
      }),
    );
    expect(database.events).toHaveLength(1);
    expect(coordinator.get(ids.request)?.status).toBe('queued');
  });

  it.each([
    ['failed_no_mutation', 0, false],
    ['failed_restored', 4, false],
    ['failed_checkpointed', 4, true],
    ['recovery_required', 4, true],
  ] as const)('%s has the required target lock disposition', (status, count, retained) => {
    const database = createEventDatabase();
    const coordinator = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    coordinator.queue(queuedStatus(), fingerprint);
    const delivery = coordinator.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    })!;
    for (let index = 1; index <= count; index += 1) {
      coordinator.progress(progressFor(delivery, index), fingerprint);
    }
    coordinator.complete(failureResult(delivery, status, count), fingerprint);
    expect(coordinator.ownsTarget('blender', ids.instance)).toBe(retained);
    expect(
      createBlenderMenuControlProofExecutionCoordinator({ database }).ownsTarget(
        'blender',
        ids.instance,
      ),
    ).toBe(retained);
  });

  it.each([
    ['queued', true],
    ['dispatched', true],
    ['progress', true],
    ['succeeded', true],
    ['failed_checkpointed', true],
    ['recovery_required', true],
    ['failed_no_mutation', false],
    ['failed_restored', false],
  ] as const)('enforces target mutual exclusion in %s', (phase, locked) => {
    const database = createEventDatabase();
    const coordinator = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    coordinator.queue(queuedStatus(), fingerprint);
    let delivery: ReturnType<typeof dispatch> | null = null;
    if (phase !== 'queued') {
      delivery = coordinator.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease(),
      });
    }
    const progressCount =
      phase === 'progress'
        ? 1
        : ['succeeded', 'failed_checkpointed', 'recovery_required', 'failed_restored'].includes(
              phase,
            )
          ? 4
          : 0;
    for (let count = 1; count <= progressCount; count += 1) {
      coordinator.progress(progressFor(delivery!, count), fingerprint);
    }
    if (phase === 'succeeded') {
      for (let count = 5; count <= 7; count += 1) {
        coordinator.progress(progressFor(delivery!, count), fingerprint);
      }
      coordinator.complete(successfulResult(delivery!), fingerprint);
    } else if (
      phase === 'failed_checkpointed' ||
      phase === 'recovery_required' ||
      phase === 'failed_no_mutation' ||
      phase === 'failed_restored'
    ) {
      coordinator.complete(
        failureResult(delivery!, phase, phase === 'failed_no_mutation' ? 0 : 4),
        fingerprint,
      );
    }
    if (locked) {
      expect(() => coordinator.queue(distinctQueuedStatus(), fingerprint)).toThrowError(
        expect.objectContaining({ code: 'menu_control_proof_in_progress' }),
      );
    } else {
      expect(coordinator.queue(distinctQueuedStatus(), fingerprint).status).toBe('queued');
    }
  });

  it('keeps queued work dispatchable and persists dispatched restart recovery exactly once', () => {
    const queuedDatabase = createEventDatabase();
    const firstQueued = createBlenderMenuControlProofExecutionCoordinator({
      database: queuedDatabase,
    });
    firstQueued.queue(queuedStatus(), fingerprint);
    const restartedQueued = createBlenderMenuControlProofExecutionCoordinator({
      database: queuedDatabase,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    expect(
      restartedQueued.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease(),
      }),
    ).not.toBeNull();

    const deliveredDatabase = createEventDatabase();
    const delivery = dispatch(deliveredDatabase);
    const restarted = createBlenderMenuControlProofExecutionCoordinator({
      database: deliveredDatabase,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    expect(deliveredDatabase.events).toHaveLength(3);
    expect(deliveredDatabase.events.at(-1)?.eventType).toBe(
      'blender.menu-control-proof.recovery-pending',
    );
    expect(restarted.get(ids.request)).toMatchObject({
      status: 'recovery_pending',
      progress: undefined,
      result: undefined,
      recovery: {
        kind: 'runtime_restart_after_delivery',
        detectedAt: '2026-08-22T10:06:00+08:00',
        priorStatus: 'dispatched',
        requiresExplicitRecovery: true,
        automaticReplayAllowed: false,
        retainsTargetLock: true,
      },
      updatedAt: '2026-08-22T10:06:00+08:00',
    });
    expect(restarted.ownsTarget('blender', ids.instance)).toBe(true);
    expect(() => restarted.queue(distinctQueuedStatus(), fingerprint)).toThrowError(
      expect.objectContaining({ code: 'menu_control_proof_in_progress' }),
    );
    expect(() => restarted.progress(progressFor(delivery, 1), fingerprint)).toThrowError(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(() =>
      restarted.complete(failureResult(delivery, 'failed_no_mutation'), fingerprint),
    ).toThrowError(expect.objectContaining({ statusCode: 409 }));
    expect(
      restarted.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease(),
      }),
    ).toBeNull();
    expect(deliveredDatabase.events).toHaveLength(3);
    const restartedAgain = createBlenderMenuControlProofExecutionCoordinator({
      database: deliveredDatabase,
      now: () => '2026-08-22T10:07:00+08:00',
    });
    expect(restartedAgain.get(ids.request)?.status).toBe('recovery_pending');
    expect(deliveredDatabase.events).toHaveLength(3);

    const tamperedDatabase = createEventDatabase();
    dispatch(tamperedDatabase);
    const payload = tamperedDatabase.events[1]!.payload as { phase: string };
    payload.phase = 'progress_6';
    expect(() =>
      createBlenderMenuControlProofExecutionCoordinator({ database: tamperedDatabase }),
    ).toThrow();
  });

  it('quarantines exact HEAD queued persistence and expires it once without delivery', () => {
    const database = createEventDatabase();
    createBlenderMenuControlProofExecutionCoordinator({ database }).queue(
      queuedStatus(),
      fingerprint,
    );
    rewriteEventsAsHeadLegacyPayload(database);

    const restarted = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    expect(restarted.get(ids.request)).toMatchObject({
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpiration: {
        priorStatus: 'queued',
        automaticReplayAllowed: false,
        retainsTargetLock: false,
      },
    });
    expect(restarted.ownsTarget('blender', ids.instance)).toBe(false);
    expect(
      restarted.poll({
        target: queuedStatus().target,
        documentAuthoritySha256: fingerprint,
        lease: lease(),
      }),
    ).toBeNull();
    expect(database.events).toHaveLength(2);
    const migratedPayload = database.events[1]!.payload as Record<string, unknown>;
    expect(migratedPayload).toMatchObject({
      phase: 'pre_dispatch_authority_expired',
      sessionAuthoritySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      documentAuthoritySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(migratedPayload).not.toMatchObject({
      sessionAuthoritySha256: fingerprint,
    });
    expect(migratedPayload['sessionAuthoritySha256']).not.toBe(
      migratedPayload['documentAuthoritySha256'],
    );
    expect(migratedPayload).not.toHaveProperty('sessionFingerprintSha256');

    const restartedAgain = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:07:00+08:00',
    });
    expect(restartedAgain.get(ids.request)?.status).toBe('pre_dispatch_authority_expired');
    expect(database.events).toHaveLength(2);
  });

  it.each([0, 2])(
    'quarantines exact HEAD delivered persistence with %i progress receipts into recovery once',
    (progressCount) => {
      const database = activeDatabase(progressCount);
      rewriteEventsAsHeadLegacyPayload(database);
      const expectedEventCount = database.events.length + 1;
      const restarted = createBlenderMenuControlProofExecutionCoordinator({
        database,
        now: () => '2026-08-22T10:06:00+08:00',
      });
      expect(restarted.get(ids.request)).toMatchObject({
        status: 'recovery_pending',
        progress: undefined,
        recovery: {
          kind: 'runtime_restart_after_delivery',
          priorStatus: progressCount === 0 ? 'dispatched' : 'in_progress',
          automaticReplayAllowed: false,
          retainsTargetLock: true,
        },
      });
      expect(restarted.ownsTarget('blender', ids.instance)).toBe(true);
      expect(database.events).toHaveLength(expectedEventCount);
      expect(database.events.at(-1)!.payload).not.toMatchObject({
        documentAuthoritySha256: fingerprint,
      });

      const restartedAgain = createBlenderMenuControlProofExecutionCoordinator({
        database,
        now: () => '2026-08-22T10:07:00+08:00',
      });
      expect(restartedAgain.get(ids.request)?.status).toBe('recovery_pending');
      expect(database.events).toHaveLength(expectedEventCount);
    },
  );

  it('replays exact HEAD terminal and recovery-pending payloads without changing semantics', () => {
    const terminalDatabase = createEventDatabase();
    const terminalCoordinator = createBlenderMenuControlProofExecutionCoordinator({
      database: terminalDatabase,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    terminalCoordinator.queue(queuedStatus(), fingerprint);
    const terminalDelivery = terminalCoordinator.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    })!;
    terminalCoordinator.complete(
      failureResult(terminalDelivery, 'failed_no_mutation'),
      fingerprint,
    );
    rewriteEventsAsHeadLegacyPayload(terminalDatabase);
    const terminalEventCount = terminalDatabase.events.length;
    const terminalRestart = createBlenderMenuControlProofExecutionCoordinator({
      database: terminalDatabase,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    expect(terminalRestart.get(ids.request)?.status).toBe('failed_no_mutation');
    expect(terminalRestart.ownsTarget('blender', ids.instance)).toBe(false);
    expect(terminalDatabase.events).toHaveLength(terminalEventCount);
    expect(
      createBlenderMenuControlProofExecutionCoordinator({
        database: terminalDatabase,
        now: () => '2026-08-22T10:07:00+08:00',
      }).get(ids.request)?.status,
    ).toBe('failed_no_mutation');
    expect(terminalDatabase.events).toHaveLength(terminalEventCount);

    const recoveryDatabase = activeDatabase();
    createBlenderMenuControlProofExecutionCoordinator({
      database: recoveryDatabase,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    rewriteEventsAsHeadLegacyPayload(recoveryDatabase);
    const recoveryEventCount = recoveryDatabase.events.length;
    const recoveryRestart = createBlenderMenuControlProofExecutionCoordinator({
      database: recoveryDatabase,
      now: () => '2026-08-22T10:07:00+08:00',
    });
    expect(recoveryRestart.get(ids.request)?.status).toBe('recovery_pending');
    expect(recoveryRestart.ownsTarget('blender', ids.instance)).toBe(true);
    expect(recoveryDatabase.events).toHaveLength(recoveryEventCount);
    expect(
      createBlenderMenuControlProofExecutionCoordinator({
        database: recoveryDatabase,
        now: () => '2026-08-22T10:08:00+08:00',
      }).get(ids.request)?.status,
    ).toBe('recovery_pending');
    expect(recoveryDatabase.events).toHaveLength(recoveryEventCount);
  });

  it('rejects malformed payloads that match neither strict current nor exact HEAD persistence', () => {
    const database = createEventDatabase();
    createBlenderMenuControlProofExecutionCoordinator({ database }).queue(
      queuedStatus(),
      fingerprint,
    );
    rewriteEventsAsHeadLegacyPayload(database);
    (database.events[0]!.payload as Record<string, unknown>)['unexpected'] = true;
    expect(() => createBlenderMenuControlProofExecutionCoordinator({ database })).toThrow();
  });

  it('rejects legacy top-level persistence mixed with current-only recovery evidence', () => {
    const database = activeDatabase();
    createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    rewriteEventsAsHeadLegacyPayload(database);
    const recoveryEvent = database.events.at(-1)!;
    const legacyPayload = recoveryEvent.payload as {
      execution: { recovery?: { kind?: string } };
    };
    if (legacyPayload.execution.recovery === undefined) {
      throw new Error('Expected legacy recovery fixture');
    }
    legacyPayload.execution.recovery.kind = 'document_authority_changed_after_delivery';

    expect(() => createBlenderMenuControlProofExecutionCoordinator({ database })).toThrow();
  });

  it('persists progress-state restart recovery with its receipt heads and no replay', () => {
    const database = createEventDatabase();
    const first = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: executionClock(),
      createId: () => ids.delivery,
    });
    first.queue(queuedStatus(), fingerprint);
    const delivery = first.poll({
      target: queuedStatus().target,
      documentAuthoritySha256: fingerprint,
      lease: lease(),
    })!;
    first.progress(progressFor(delivery, 1), fingerprint);
    first.progress(progressFor(delivery, 2), fingerprint);
    expect(database.events).toHaveLength(4);
    const expectedHeads = receipts(delivery)
      .slice(0, 2)
      .map((receipt) => receipt.contentSha256);
    const restarted = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:06:00+08:00',
    });
    expect(restarted.get(ids.request)).toMatchObject({
      status: 'recovery_pending',
      progress: undefined,
      recovery: { priorStatus: 'in_progress' },
    });
    expect(database.events).toHaveLength(5);
    expect(
      (database.events.at(-1)?.payload as { progressReceiptChainHeads: string[] })
        .progressReceiptChainHeads,
    ).toEqual(expectedHeads);
    expect(() => restarted.progress(progressFor(delivery, 3), fingerprint)).toThrowError(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(database.events).toHaveLength(5);
    const restartedAgain = createBlenderMenuControlProofExecutionCoordinator({
      database,
      now: () => '2026-08-22T10:07:00+08:00',
    });
    expect(restartedAgain.get(ids.request)?.status).toBe('recovery_pending');
    expect(database.events).toHaveLength(5);
  });

  it('fails closed when restart detection time would regress', () => {
    const database = activeDatabase(1);
    expect(database.events).toHaveLength(3);
    expect(() =>
      createBlenderMenuControlProofExecutionCoordinator({
        database,
        now: () => '2026-08-22T10:00:59+08:00',
      }),
    ).toThrowError(expect.objectContaining({ code: 'menu_control_proof_restart_time_regression' }));
    expect(database.events).toHaveLength(3);
  });

  it.each(['id', 'eventType', 'createdAt', 'immutableDelivery', 'receiptChain'] as const)(
    'rejects persisted %s tampering',
    (kind) => {
      const database = activeDatabase(
        kind === 'receiptChain' ? 2 : kind === 'immutableDelivery' ? 1 : 0,
      );
      if (kind === 'id') {
        database.events[0]!.id = 'tampered-event-id';
      } else if (kind === 'eventType') {
        database.events[0]!.eventType = 'blender.menu-control-proof.dispatched';
      } else if (kind === 'createdAt') {
        database.events[0]!.createdAt = '2026-08-22T10:00:02+08:00';
      } else if (kind === 'immutableDelivery') {
        const payload = database.events[1]!.payload as {
          execution: { deliveryId: string };
        };
        payload.execution.deliveryId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      } else {
        const payload = database.events[2]!.payload as {
          progressReceiptChainHeads: string[];
        };
        payload.progressReceiptChainHeads[0] = hash('d');
      }
      const expectedMessage =
        kind === 'eventType'
          ? 'event type does not match its phase'
          : kind === 'immutableDelivery'
            ? 'changed immutable delivery'
            : kind === 'receiptChain'
              ? 'inconsistent progress evidence'
              : 'inconsistent persisted event metadata';
      expect(() => createBlenderMenuControlProofExecutionCoordinator({ database })).toThrowError(
        expectedMessage,
      );
    },
  );
});
