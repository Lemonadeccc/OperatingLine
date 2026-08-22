import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionMenuControlProofCreateRequestSchema,
  companionMenuControlProofDeliverySchema,
  companionMenuControlProofHistoryIdentityMatchesResult,
  companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery,
  companionMenuControlProofHistoryTransitionReconciliationAckSchema,
  companionMenuControlProofHistoryTransitionReconciliationDeliverySchema,
  companionMenuControlProofHistoryTransitionReportMatchesResult,
  companionMenuControlProofHistoryTransitionReportSchema,
  companionMenuControlProofPollDeliverySchema,
  companionMenuControlProofPollRequestSchema,
  companionMenuControlProofProgressSchema,
  companionMenuControlProofRecoveryRequestSchema,
  companionMenuControlProofResultSchema,
  companionMenuControlProofStatusSchema,
  companionMenuControlProofTerminalReconciliationAckMatchesDelivery,
  companionMenuControlProofTerminalReconciliationAckSchema,
  companionMenuControlProofTerminalReconciliationDeliverySchema,
  companionMenuControlProofTerminalMarkerIdentity,
  companionMenuControlProofTerminalHistoryIdentity,
  computeCompanionMenuControlProofFailureCheckpointContentSha256,
  computeCompanionMenuControlProofHistoryTransitionContentSha256,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
  computeCompanionMenuControlProofResultContentSha256,
  computeCompanionMenuControlProofTerminalMarkerContentSha256,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

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
        journal: {
          entryPresent: true,
          snapshotMatchesSession: true,
          artifactsBackedUp: true,
        },
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

function delivery() {
  const accepted = binding();
  return {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    proofId: ids.proof,
    deliveryId: ids.delivery,
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
    lease: {
      leaseId: ids.lease,
      sessionId: ids.session,
      target: accepted.target,
      documentIncarnationId: ids.document,
      expiresAt: '2026-08-22T10:05:00+08:00',
    },
    requestedAt: '2026-08-22T10:00:03+08:00',
    dispatchedAt: '2026-08-22T10:00:04+08:00',
  } as const;
}

function summaries() {
  return [
    { status: 'precondition_verified', path: ['Layout'] },
    { status: 'control_executed', path: ['Layout', 'Add'] },
    { status: 'control_executed', path: ['Layout', 'Add', 'Mesh'] },
    {
      status: 'control_executed',
      path: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
      radius: 1,
    },
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

function receipts() {
  let previousReceiptContentSha256: string | null = null;
  return operationIds.map((operationId, index) => {
    const content = {
      receiptId: `${index + 1}0000000-0000-4000-8000-000000000000`,
      proofId: ids.proof,
      requestId: ids.request,
      deliveryId: ids.delivery,
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

function progress(count = 4) {
  const prefix = receipts().slice(0, count);
  const mutationCount = [0, 0, 0, 1, 4, 7, 8][count - 1]!;
  return {
    ...delivery(),
    status: 'in_progress',
    completedOperationIds: operationIds.slice(0, count),
    operationReceipts: prefix,
    receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
    nativeHistoryCursor: mutationCount,
    completedMutationStages: mutationStages.slice(0, mutationCount),
    occurredAt: '2026-08-22T10:01:00+08:00',
  } as const;
}

function strongObservation() {
  const content = {
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
    observedAt: '2026-08-22T10:01:01+08:00',
  } as const;
  return { ...content, contentSha256: computeProtocolCanonicalJsonSha256(content) } as const;
}

function result() {
  const allReceipts = receipts();
  const observation = strongObservation();
  return {
    ...delivery(),
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
        committedAt: '2026-08-22T10:01:02+08:00',
      },
    },
    error: null,
    occurredAt: '2026-08-22T10:01:03+08:00',
  } as const;
}

function historyIdentity() {
  const terminal = result();
  return {
    checkpointId: terminal.terminalEvidence.nativeUndoCheckpoint.checkpointId,
    undoLockId: terminal.terminalEvidence.nativeUndoCheckpoint.undoLockId,
    checkpointKind: 'success',
    stageFingerprints: [
      hash('b'),
      hash('c'),
      hash('d'),
      hash('e'),
      hash('f'),
      hash('1'),
      hash('2'),
      hash('3'),
      hash('a'),
    ],
    terminalResultContentSha256: computeCompanionMenuControlProofResultContentSha256(terminal),
    terminalMarkerContentSha256:
      computeCompanionMenuControlProofTerminalMarkerContentSha256(terminal),
  } as const;
}

function historyTransition(fromCursor: number, toCursor: number, seconds = 30) {
  const history = historyIdentity();
  const stages = [
    'baseline',
    'sphere_created',
    'location_x',
    'location_y',
    'location_z',
    'scale_x',
    'scale_y',
    'scale_z',
    'renamed_final',
  ] as const;
  return {
    transitionId: `${seconds.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
    checkpointId: history.checkpointId,
    undoLockId: history.undoLockId,
    direction: toCursor < fromCursor ? ('undo' as const) : ('redo' as const),
    fromCursor,
    toCursor,
    stage: stages[toCursor]!,
    status: toCursor === 0 ? ('restored' as const) : ('history_locked' as const),
    sceneFingerprintSha256: history.stageFingerprints[toCursor],
    occurredAt: `2026-08-22T10:02:${seconds.toString().padStart(2, '0')}+08:00`,
  } as const;
}

function historyTransitionReport() {
  const transition = historyTransition(8, 7, 30);
  return {
    ...delivery(),
    kind: 'native_history_transition' as const,
    currentLease: delivery().lease,
    history: historyIdentity(),
    serverAcceptedCursor: 8,
    serverAcceptedStatus: 'history_locked' as const,
    transition,
    transitionContentSha256:
      computeCompanionMenuControlProofHistoryTransitionContentSha256(transition),
    reportedAt: '2026-08-22T10:02:31+08:00',
  };
}

function historyReconciliationDelivery() {
  const boundary = companionMenuControlProofTerminalHistoryIdentity(result());
  return {
    ...delivery(),
    kind: 'native_history_transition_reconcile' as const,
    recoveryId: '13572468-1357-4357-8357-135724681357',
    replacementLease: {
      ...delivery().lease,
      leaseId: '24681357-2468-4468-8468-246813572468',
      expiresAt: '2026-08-22T10:10:00+08:00',
    },
    history: boundary,
    serverAcceptedCursor: 7,
    serverAcceptedStatus: 'history_locked' as const,
    acknowledgedTransitionContentSha256s: [historyTransitionReport().transitionContentSha256],
    expectedMarkerContentSha256: boundary.terminalMarkerContentSha256,
    recoveryRequestedAt: '2026-08-22T10:06:00+08:00',
  };
}

function historyReconciliationAck() {
  const history = historyIdentity();
  const transition = historyTransition(7, 6, 31);
  return {
    ...delivery(),
    kind: 'native_history_transition_reconcile' as const,
    recoveryId: historyReconciliationDelivery().recoveryId,
    history,
    serverAcceptedCursor: 7,
    serverAcceptedStatus: 'history_locked' as const,
    transitions: [transition],
    transitionContentSha256s: [
      computeCompanionMenuControlProofHistoryTransitionContentSha256(transition),
    ],
    terminalResultContentSha256: history.terminalResultContentSha256,
    expectedMarkerContentSha256: history.terminalMarkerContentSha256,
    currentCursor: 6,
    currentStatus: 'history_locked' as const,
    currentSceneFingerprintSha256: history.stageFingerprints[6],
    occurredAt: '2026-08-22T10:06:01+08:00',
  };
}

function queuedStatus() {
  const delivered = delivery();
  const base = Object.fromEntries(
    Object.entries(delivered).filter(
      ([key]) => !['deliveryId', 'lease', 'dispatchedAt'].includes(key),
    ),
  );
  return { ...base, status: 'queued', updatedAt: '2026-08-22T10:00:03+08:00' } as const;
}

function recoveryPendingStatus(priorStatus: 'dispatched' | 'in_progress' = 'dispatched') {
  return {
    ...delivery(),
    status: 'recovery_pending',
    recovery: {
      kind: 'runtime_restart_after_delivery',
      detectedAt: '2026-08-22T10:06:00+08:00',
      priorStatus,
      requiresExplicitRecovery: true,
      automaticReplayAllowed: false,
      retainsTargetLock: true,
    },
    updatedAt: '2026-08-22T10:06:01+08:00',
  } as const;
}

describe('companion menu-control proof protocol', () => {
  it('binds terminal reconciliation to the original delivery and a distinct live replacement lease', () => {
    const terminal = result();
    const challenge = companionMenuControlProofTerminalReconciliationDeliverySchema.parse({
      ...delivery(),
      kind: 'native_terminal_reconcile',
      recoveryId: '13572468-1357-4357-8357-135724681357',
      replacementLease: {
        ...delivery().lease,
        leaseId: '24681357-2468-4468-8468-246813572468',
        expiresAt: '2026-08-22T10:10:00+08:00',
      },
      acknowledgedProgressReceiptChainHeads: receipts()
        .slice(0, 3)
        .map((receipt) => receipt.contentSha256),
      recoveryRequestedAt: '2026-08-22T10:06:00+08:00',
    });
    const ack = companionMenuControlProofTerminalReconciliationAckSchema.parse({
      kind: 'native_terminal_reconcile',
      recoveryId: challenge.recoveryId,
      result: terminal,
      terminalResultContentSha256: computeCompanionMenuControlProofResultContentSha256(terminal),
      expectedMarkerContentSha256:
        computeCompanionMenuControlProofTerminalMarkerContentSha256(terminal),
      currentSceneFingerprintSha256:
        terminal.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
      occurredAt: '2026-08-22T10:06:01+08:00',
    });
    expect(companionMenuControlProofTerminalMarkerIdentity(terminal)).toEqual({
      formatVersion: '1.0.0',
      executorId: terminal.executorId,
      checkpointId: terminal.terminalEvidence.nativeUndoCheckpoint.checkpointId,
      undoLockId: terminal.terminalEvidence.nativeUndoCheckpoint.undoLockId,
      proofId: terminal.proofId,
      replayId: terminal.replayId,
      targetId: 'proof.uv_sphere.eye',
      checkpointKind: 'success',
      baselineSceneFingerprintSha256:
        terminal.terminalEvidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256:
        terminal.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
      terminalResultContentSha256: computeCompanionMenuControlProofResultContentSha256(terminal),
    });
    expect(companionMenuControlProofTerminalReconciliationAckMatchesDelivery(ack, challenge)).toBe(
      true,
    );
    expect(
      companionMenuControlProofTerminalReconciliationDeliverySchema.safeParse({
        ...challenge,
        replacementLease: challenge.lease,
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofTerminalReconciliationAckSchema.safeParse({
        ...ack,
        terminalResultContentSha256: hash('f'),
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofTerminalReconciliationAckSchema.safeParse({
        ...ack,
        currentSceneFingerprintSha256: hash('f'),
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofTerminalReconciliationAckSchema.safeParse({
        ...ack,
        expectedMarkerContentSha256: hash('f'),
      }).success,
    ).toBe(false);
  });

  it('reports adjacent native history transitions and reconciles an exact persisted outbox', () => {
    const history = historyIdentity();
    const first = historyTransition(8, 7, 30);
    const report = companionMenuControlProofHistoryTransitionReportSchema.parse({
      ...delivery(),
      kind: 'native_history_transition',
      currentLease: delivery().lease,
      history,
      serverAcceptedCursor: 8,
      serverAcceptedStatus: 'history_locked',
      transition: first,
      transitionContentSha256:
        computeCompanionMenuControlProofHistoryTransitionContentSha256(first),
      reportedAt: '2026-08-22T10:02:31+08:00',
    });
    expect(companionMenuControlProofHistoryIdentityMatchesResult(history, result())).toBe(true);
    expect(companionMenuControlProofHistoryTransitionReportMatchesResult(report, result())).toBe(
      true,
    );

    const boundary = companionMenuControlProofTerminalHistoryIdentity(result());
    const challenge = companionMenuControlProofHistoryTransitionReconciliationDeliverySchema.parse({
      ...delivery(),
      kind: 'native_history_transition_reconcile',
      recoveryId: '13572468-1357-4357-8357-135724681357',
      replacementLease: {
        ...delivery().lease,
        leaseId: '24681357-2468-4468-8468-246813572468',
        expiresAt: '2026-08-22T10:10:00+08:00',
      },
      history: boundary,
      serverAcceptedCursor: 7,
      serverAcceptedStatus: 'history_locked',
      acknowledgedTransitionContentSha256s: [report.transitionContentSha256],
      expectedMarkerContentSha256: boundary.terminalMarkerContentSha256,
      recoveryRequestedAt: '2026-08-22T10:06:00+08:00',
    });
    const second = historyTransition(7, 6, 31);
    const ack = companionMenuControlProofHistoryTransitionReconciliationAckSchema.parse({
      ...delivery(),
      kind: 'native_history_transition_reconcile',
      recoveryId: challenge.recoveryId,
      history,
      serverAcceptedCursor: 7,
      serverAcceptedStatus: 'history_locked',
      transitions: [second],
      transitionContentSha256s: [
        computeCompanionMenuControlProofHistoryTransitionContentSha256(second),
      ],
      terminalResultContentSha256: history.terminalResultContentSha256,
      expectedMarkerContentSha256: history.terminalMarkerContentSha256,
      currentCursor: 6,
      currentStatus: 'history_locked',
      currentSceneFingerprintSha256: history.stageFingerprints[6],
      occurredAt: '2026-08-22T10:06:01+08:00',
    });
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(ack, challenge),
    ).toBe(true);
    expect(companionMenuControlProofRecoveryRequestSchema.parse(ack)).toEqual(ack);
    expect(companionMenuControlProofPollDeliverySchema.parse({ request: challenge })).toEqual({
      request: challenge,
    });

    const emptyAck = {
      ...ack,
      transitions: [],
      transitionContentSha256s: [],
      currentCursor: 7,
      currentSceneFingerprintSha256: history.stageFingerprints[7],
    };
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckSchema.safeParse(emptyAck).success,
    ).toBe(true);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckSchema.safeParse({
        ...ack,
        transitions: [historyTransition(7, 5, 31)],
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckSchema.safeParse({
        ...ack,
        transitions: [{ ...second, sceneFingerprintSha256: hash('9') }],
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReportSchema.safeParse({
        ...report,
        transition: { ...first, stage: 'scale_x' },
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReportSchema.safeParse({
        ...report,
        transitionContentSha256: hash('9'),
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReportSchema.safeParse({
        ...report,
        currentLease: {
          ...report.currentLease,
          documentIncarnationId: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
        },
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(
        { ...ack, recoveryId: 'abcdefab-cdef-4abc-8def-abcdefabcdef' },
        challenge,
      ),
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(
        { ...ack, deliveryId: 'abcdefab-cdef-4abc-8def-abcdefabcdef' },
        challenge,
      ),
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckSchema.safeParse({
        ...ack,
        target: { ...ack.target, instanceId: 'abcdefab-cdef-4abc-8def-abcdefabcdef' },
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(
        {
          ...ack,
          history: { ...ack.history, checkpointId: 'abcdefab-cdef-4abc-8def-abcdefabcdef' },
        },
        challenge,
      ),
    ).toBe(false);
  });

  it('expresses the failure checkpoint native history boundary as null to baseline', () => {
    const successHistory = historyIdentity();
    const history = {
      ...successHistory,
      checkpointKind: 'failure' as const,
      stageFingerprints: [hash('b'), ...Array.from({ length: 8 }, () => hash('a'))] as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ],
    };
    const transition = {
      transitionId: '87654321-4321-4321-8321-123456789abc',
      checkpointId: history.checkpointId,
      undoLockId: history.undoLockId,
      direction: 'undo' as const,
      fromCursor: null,
      toCursor: 0,
      stage: 'baseline' as const,
      status: 'restored' as const,
      sceneFingerprintSha256: history.stageFingerprints[0],
      occurredAt: '2026-08-22T10:02:30+08:00',
    };
    expect(
      companionMenuControlProofHistoryTransitionReportSchema.safeParse({
        ...delivery(),
        kind: 'native_history_transition',
        currentLease: delivery().lease,
        history,
        serverAcceptedCursor: null,
        serverAcceptedStatus: 'history_locked',
        transition,
        transitionContentSha256:
          computeCompanionMenuControlProofHistoryTransitionContentSha256(transition),
        reportedAt: '2026-08-22T10:02:31+08:00',
      }).success,
    ).toBe(true);
  });

  it('keeps the caller request opaque and rejects native input injection', () => {
    const request = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      replayId: ids.replay,
      expectedState: { reportId: ids.report, sequence: 7 },
    } as const;
    expect(companionMenuControlProofCreateRequestSchema.parse(request)).toEqual(request);
    for (const key of ['events', 'coordinates', 'operatorId', 'action', 'arguments']) {
      expect(
        companionMenuControlProofCreateRequestSchema.safeParse({ ...request, [key]: [] }).success,
      ).toBe(false);
    }
  });

  it('seals the accepted binding, start checkpoint, lease target, and document session', () => {
    const value = delivery();
    expect(companionMenuControlProofDeliverySchema.parse(value)).toEqual(value);
    expect(companionMenuControlProofPollRequestSchema.parse(value.target)).toEqual(value.target);
    expect(companionMenuControlProofPollDeliverySchema.parse({ request: value })).toEqual({
      request: value,
    });
    const foreign = structuredClone(value);
    foreign.lease.target.instanceId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(companionMenuControlProofDeliverySchema.safeParse(foreign).success).toBe(false);
    const predatesBinding = structuredClone(value);
    predatesBinding.requestedAt = '2026-08-22T10:00:01+08:00';
    expect(companionMenuControlProofDeliverySchema.safeParse(predatesBinding).success).toBe(false);
  });

  it('requires an exact seven-operation hash chain while keeping history cursor independent', () => {
    expect(companionMenuControlProofProgressSchema.parse(progress())).toEqual(progress());
    expect(companionMenuControlProofProgressSchema.parse(progress(7)).nativeHistoryCursor).toBe(8);
    const reordered = structuredClone(progress());
    reordered.operationReceipts.reverse();
    expect(companionMenuControlProofProgressSchema.safeParse(reordered).success).toBe(false);
    const tampered = structuredClone(progress());
    tampered.operationReceipts[1]!.summary.path = ['Layout'] as ['Layout', 'Add'];
    expect(companionMenuControlProofProgressSchema.safeParse(tampered).success).toBe(false);
    const wrongCursor = structuredClone(progress());
    wrongCursor.nativeHistoryCursor = 2;
    expect(companionMenuControlProofProgressSchema.safeParse(wrongCursor).success).toBe(false);
    const predatesBinding = structuredClone(progress());
    predatesBinding.requestedAt = '2026-08-22T10:00:01+08:00';
    expect(companionMenuControlProofProgressSchema.safeParse(predatesBinding).success).toBe(false);
    const lateReceipt = structuredClone(progress());
    lateReceipt.operationReceipts.at(-1)!.occurredAt = '2026-08-22T10:02:00+08:00';
    lateReceipt.operationReceipts.at(-1)!.contentSha256 =
      computeCompanionMenuControlProofOperationReceiptContentSha256(
        lateReceipt.operationReceipts.at(-1)!,
      );
    expect(companionMenuControlProofProgressSchema.safeParse(lateReceipt).success).toBe(false);
    const earlyReceipt = structuredClone(progress(1));
    earlyReceipt.operationReceipts[0]!.occurredAt = '2026-08-22T10:00:03+08:00';
    earlyReceipt.operationReceipts[0]!.contentSha256 =
      computeCompanionMenuControlProofOperationReceiptContentSha256(
        earlyReceipt.operationReceipts[0]!,
      );
    earlyReceipt.receiptChainHeadSha256 = earlyReceipt.operationReceipts[0]!.contentSha256;
    expect(companionMenuControlProofProgressSchema.safeParse(earlyReceipt).success).toBe(false);

    const renewedSessionProgress = structuredClone(progress(1));
    renewedSessionProgress.lease.expiresAt = '2026-08-22T10:00:05+08:00';
    expect(companionMenuControlProofProgressSchema.parse(renewedSessionProgress)).toEqual(
      renewedSessionProgress,
    );
    const outsideExecutionWindow = structuredClone(progress(1));
    outsideExecutionWindow.occurredAt = '2026-08-22T10:02:05+08:00';
    expect(companionMenuControlProofProgressSchema.safeParse(outsideExecutionWindow).success).toBe(
      false,
    );
  });

  it('requires seven summaries and receipts plus strong observation and depth-eight checkpoint', () => {
    const value = result();
    expect(companionMenuControlProofResultSchema.parse(value)).toEqual(value);
    expect(computeCompanionMenuControlProofResultContentSha256(value)).toMatch(/^[a-f0-9]{64}$/);
    const wrongDepth = structuredClone(value);
    wrongDepth.terminalEvidence.nativeUndoCheckpoint.nativeHistoryCursor = 7 as 8;
    expect(companionMenuControlProofResultSchema.safeParse(wrongDepth).success).toBe(false);
    const tampered = structuredClone(value);
    tampered.terminalEvidence.strongObservation.meshSha256 = hash('f');
    expect(companionMenuControlProofResultSchema.safeParse(tampered).success).toBe(false);
    const lateCheckpoint = structuredClone(value);
    lateCheckpoint.terminalEvidence.nativeUndoCheckpoint.committedAt = '2026-08-22T10:02:00+08:00';
    expect(companionMenuControlProofResultSchema.safeParse(lateCheckpoint).success).toBe(false);
    const unchanged = structuredClone(value);
    unchanged.terminalEvidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 =
      unchanged.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256;
    unchanged.terminalEvidence.nativeUndoCheckpoint.restoredSceneFingerprintSha256 =
      unchanged.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256;
    expect(companionMenuControlProofResultSchema.safeParse(unchanged).success).toBe(false);
    const foreignLease = structuredClone(value);
    foreignLease.lease.target.instanceId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(companionMenuControlProofResultSchema.safeParse(foreignLease).success).toBe(false);

    const renewedSessionResult = structuredClone(value);
    renewedSessionResult.lease.expiresAt = '2026-08-22T10:00:05+08:00';
    expect(companionMenuControlProofResultSchema.parse(renewedSessionResult)).toEqual(
      renewedSessionResult,
    );
    const outsideExecutionWindow = structuredClone(value);
    outsideExecutionWindow.occurredAt = '2026-08-22T10:02:05+08:00';
    expect(companionMenuControlProofResultSchema.safeParse(outsideExecutionWindow).success).toBe(
      false,
    );
  });

  it('models no-mutation and recovery-required failures without automatic replay', () => {
    const noMutation = {
      ...delivery(),
      status: 'failed_no_mutation',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'failed_no_mutation',
        receiptPrefix: [],
        lastCompletedOperationId: null,
        internalHistoryCursor: 0,
        completedMutationStages: [],
        automaticReplay: false,
      },
      error: 'Menu not available.',
      occurredAt: '2026-08-22T10:01:00+08:00',
    } as const;
    expect(companionMenuControlProofResultSchema.parse(noMutation)).toEqual(noMutation);
    const recovery = {
      ...noMutation,
      status: 'recovery_required',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'recovery_required',
        receiptPrefix: receipts().slice(0, 3),
        lastCompletedOperationId: operationIds[2],
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('c'),
        automaticReplay: false,
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(recovery)).toEqual(recovery);
    for (const nativeHistoryCursor of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const probeFailure = {
        ...recovery,
        terminalEvidence: {
          ...recovery.terminalEvidence,
          receiptPrefix: receipts(),
          lastCompletedOperationId: operationIds[6],
          internalHistoryCursor: nativeHistoryCursor,
          completedMutationStages: mutationStages,
        },
      } as const;
      expect(companionMenuControlProofResultSchema.parse(probeFailure)).toEqual(probeFailure);
    }
    expect(
      companionMenuControlProofResultSchema.safeParse({
        ...recovery,
        requiresUndoToUnlock: false,
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.parse({
        ...delivery(),
        status: 'recovery_required',
        result: recovery,
        updatedAt: '2026-08-22T10:01:01+08:00',
      }).result?.terminalEvidence.kind,
    ).toBe('recovery_required');
    const impossibleRecovery = structuredClone(recovery);
    impossibleRecovery.terminalEvidence.internalHistoryCursor = 2;
    impossibleRecovery.terminalEvidence.completedMutationStages = mutationStages.slice(0, 2);
    expect(companionMenuControlProofResultSchema.safeParse(impossibleRecovery).success).toBe(false);
    const nonProbeCursorMismatch = structuredClone(recovery);
    nonProbeCursorMismatch.terminalEvidence.internalHistoryCursor = 0;
    expect(companionMenuControlProofResultSchema.safeParse(nonProbeCursorMismatch).success).toBe(
      false,
    );

    const prefix = receipts().slice(0, 4);
    const checkpointContent = {
      formatVersion: '1.0.0',
      checkpointId: '23456789-2345-4234-8234-23456789abcd',
      undoLockId: '3456789a-3456-4345-8345-3456789abcde',
      proofId: ids.proof,
      replayId: ids.replay,
      target: {
        adapterId: 'blender',
        instanceId: ids.instance,
        resourceId: 'proof.uv_sphere.eye',
      },
      internalHistoryCursor: 1,
      completedMutationStages: mutationStages.slice(0, 1),
      baselineSceneFingerprintSha256: hash('b'),
      currentSceneFingerprintSha256: hash('c'),
      receiptChainRootSha256: prefix[0]!.contentSha256,
      receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
      committedAt: '2026-08-22T10:00:30+08:00',
    } as const;
    const checkpointed = {
      ...noMutation,
      status: 'failed_checkpointed',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'failed_checkpointed',
        receiptPrefix: prefix,
        lastCompletedOperationId: operationIds[3],
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('c'),
        automaticReplay: false,
        checkpoint: {
          ...checkpointContent,
          contentSha256:
            computeCompanionMenuControlProofFailureCheckpointContentSha256(checkpointContent),
        },
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(checkpointed)).toEqual(checkpointed);
    const forgedCheckpoint = structuredClone(checkpointed);
    forgedCheckpoint.terminalEvidence.checkpoint.currentSceneFingerprintSha256 = hash('d');
    expect(companionMenuControlProofResultSchema.safeParse(forgedCheckpoint).success).toBe(false);

    const restoredReceipts = receipts();
    const restored = {
      ...noMutation,
      status: 'failed_restored',
      terminalEvidence: {
        kind: 'failed_restored',
        receiptPrefix: restoredReceipts,
        lastCompletedOperationId: operationIds[6],
        internalHistoryCursor: 0,
        completedMutationStages: mutationStages,
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('b'),
        automaticReplay: false,
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(restored)).toEqual(restored);
    const ordinaryRestored = {
      ...restored,
      terminalEvidence: {
        ...restored.terminalEvidence,
        receiptPrefix: prefix,
        lastCompletedOperationId: operationIds[3],
        completedMutationStages: mutationStages.slice(0, 1),
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(ordinaryRestored)).toEqual(ordinaryRestored);
    const badCheckpoint = {
      ...recovery,
      status: 'failed_checkpointed',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        ...recovery.terminalEvidence,
        kind: 'failed_checkpointed',
        internalHistoryCursor: 0,
        completedMutationStages: [],
      },
    } as const;
    expect(companionMenuControlProofResultSchema.safeParse(badCheckpoint).success).toBe(false);
    const badRestored = {
      ...recovery,
      status: 'failed_restored',
      terminalEvidence: {
        ...recovery.terminalEvidence,
        kind: 'failed_restored',
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        currentSceneFingerprintSha256: hash('b'),
      },
    } as const;
    expect(companionMenuControlProofResultSchema.safeParse(badRestored).success).toBe(false);
  });

  it('keeps queued status pre-delivery and mirrors every nested evidence identity', () => {
    const queued = queuedStatus();
    expect(companionMenuControlProofStatusSchema.parse(queued)).toEqual(queued);
    expect(
      companionMenuControlProofStatusSchema.safeParse({ ...queued, deliveryId: ids.delivery })
        .success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...queued,
        requestedAt: '2026-08-22T10:00:01+08:00',
      }).success,
    ).toBe(false);
    const invalidDeliveredStatus = {
      ...delivery(),
      requestedAt: '2026-08-22T10:00:01+08:00',
      status: 'dispatched',
      updatedAt: '2026-08-22T10:00:04+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(invalidDeliveredStatus).success).toBe(
      false,
    );

    const nested = structuredClone(progress());
    nested.requestId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const status = {
      ...delivery(),
      status: 'in_progress',
      progress: nested,
      updatedAt: '2026-08-22T10:01:01+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(status).success).toBe(false);

    const terminalStatus = structuredClone({
      ...delivery(),
      status: 'succeeded' as const,
      result: result(),
      updatedAt: '2026-08-22T10:01:04+08:00',
    });
    terminalStatus.menuTrackContentSha256 = hash('f');
    terminalStatus.binding.materialization.menuTrackContentSha256 = hash('f');
    terminalStatus.binding.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(terminalStatus.binding);
    terminalStatus.bindingContentSha256 = terminalStatus.binding.integrity.contentSha256;
    const parsed = companionMenuControlProofStatusSchema.safeParse(terminalStatus);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === 'result')).toBe(true);
    }
    const stale = {
      ...delivery(),
      status: 'in_progress',
      progress: progress(),
      updatedAt: '2026-08-22T10:00:30+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(stale).success).toBe(false);

    const foreignLease = structuredClone({
      ...delivery(),
      status: 'in_progress' as const,
      progress: progress(),
      updatedAt: '2026-08-22T10:01:01+08:00',
    });
    foreignLease.progress.lease.expiresAt = '2026-08-22T10:06:00+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(foreignLease).success).toBe(false);
    const foreignRequestedAt = structuredClone({
      ...delivery(),
      status: 'in_progress' as const,
      progress: progress(),
      updatedAt: '2026-08-22T10:01:01+08:00',
    });
    foreignRequestedAt.progress.requestedAt = '2026-08-22T10:00:03.500+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(foreignRequestedAt).success).toBe(false);
  });

  it('makes pre-dispatch document-authority expiration terminal and strictly undelivered', () => {
    const expired = {
      ...queuedStatus(),
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpiration: {
        kind: 'document_authority_changed_before_dispatch',
        priorStatus: 'queued',
        detectedAt: '2026-08-22T10:00:04+08:00',
        automaticReplayAllowed: false,
        retainsTargetLock: false,
      },
      updatedAt: '2026-08-22T10:00:04+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.parse(expired)).toEqual(expired);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...expired,
        deliveryId: ids.delivery,
        lease: delivery().lease,
        dispatchedAt: delivery().dispatchedAt,
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({ ...expired, progress: progress() }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({ ...expired, result: result() }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...expired,
        recovery: recoveryPendingStatus().recovery,
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...expired,
        updatedAt: '2026-08-22T10:00:05+08:00',
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...expired,
        requestedAt: '2026-08-22T10:00:05+08:00',
      }).success,
    ).toBe(false);
  });

  it('represents a post-delivery runtime restart without fabricating progress or a result', () => {
    for (const priorStatus of ['dispatched', 'in_progress'] as const) {
      const pending = recoveryPendingStatus(priorStatus);
      expect(companionMenuControlProofStatusSchema.parse(pending)).toEqual(pending);
      expect(Date.parse(pending.recovery.detectedAt)).toBeGreaterThan(
        Date.parse(pending.lease.expiresAt),
      );
    }

    const missingRecovery = structuredClone(recoveryPendingStatus());
    delete (missingRecovery as { recovery?: unknown }).recovery;
    expect(companionMenuControlProofStatusSchema.safeParse(missingRecovery).success).toBe(false);

    for (const evidenceKey of [
      'kind',
      'detectedAt',
      'priorStatus',
      'requiresExplicitRecovery',
      'automaticReplayAllowed',
      'retainsTargetLock',
    ] as const) {
      const incomplete = structuredClone(recoveryPendingStatus());
      delete (incomplete.recovery as Record<string, unknown>)[evidenceKey];
      expect(companionMenuControlProofStatusSchema.safeParse(incomplete).success).toBe(false);
    }

    for (const evidenceKey of [
      'sceneFingerprintSha256',
      'receipt',
      'currentCursor',
      'companionClaim',
    ]) {
      expect(
        companionMenuControlProofStatusSchema.safeParse({
          ...recoveryPendingStatus(),
          recovery: { ...recoveryPendingStatus().recovery, [evidenceKey]: 'fabricated' },
        }).success,
      ).toBe(false);
    }

    const statusesWithoutRecovery = [
      queuedStatus(),
      {
        ...delivery(),
        status: 'dispatched' as const,
        updatedAt: '2026-08-22T10:00:04+08:00',
      },
      {
        ...delivery(),
        status: 'in_progress' as const,
        progress: progress(),
        updatedAt: '2026-08-22T10:06:01+08:00',
      },
      {
        ...delivery(),
        status: 'succeeded' as const,
        result: result(),
        updatedAt: '2026-08-22T10:06:01+08:00',
      },
    ];
    for (const status of statusesWithoutRecovery) {
      expect(companionMenuControlProofStatusSchema.parse(status)).toEqual(status);
      expect(
        companionMenuControlProofStatusSchema.safeParse({
          ...status,
          recovery: recoveryPendingStatus().recovery,
        }).success,
      ).toBe(false);
    }
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...recoveryPendingStatus(),
        progress: progress(),
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...recoveryPendingStatus(),
        result: result(),
      }).success,
    ).toBe(false);

    const predeliveryDetection = structuredClone(recoveryPendingStatus());
    predeliveryDetection.recovery.detectedAt = '2026-08-22T10:00:03+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(predeliveryDetection).success).toBe(
      false,
    );
    const staleUpdate = structuredClone(recoveryPendingStatus());
    staleUpdate.updatedAt = '2026-08-22T10:05:59+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(staleUpdate).success).toBe(false);

    const partialDelivery = structuredClone(recoveryPendingStatus());
    delete (partialDelivery as { deliveryId?: unknown }).deliveryId;
    expect(companionMenuControlProofStatusSchema.safeParse(partialDelivery).success).toBe(false);
    const foreignLeaseTarget = structuredClone(recoveryPendingStatus());
    foreignLeaseTarget.lease.target.instanceId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(companionMenuControlProofStatusSchema.safeParse(foreignLeaseTarget).success).toBe(false);
  });

  it('publishes strict Draft-7 Fastify/Ajv-compatible public schemas', async () => {
    const cases = [
      [
        'companion-menu-control-proof-create-request.schema.json',
        {
          formatVersion: '1.0.0',
          requestId: ids.request,
          replayId: ids.replay,
          expectedState: { reportId: ids.report, sequence: 7 },
        },
      ],
      ['companion-menu-control-proof-delivery.schema.json', delivery()],
      ['companion-menu-control-proof-progress.schema.json', progress()],
      ['companion-menu-control-proof-result.schema.json', result()],
      ['companion-menu-control-proof-poll-request.schema.json', delivery().target],
      ['companion-menu-control-proof-poll-delivery.schema.json', { request: delivery() }],
      ['companion-menu-control-proof-status-request.schema.json', { requestId: ids.request }],
      ['companion-menu-control-proof-status.schema.json', recoveryPendingStatus()],
      ['companion-menu-control-proof-progress-ack.schema.json', { result: 'accepted' }],
      ['companion-menu-control-proof-result-ack.schema.json', { result: 'accepted' }],
      [
        'companion-menu-control-proof-history-transition-report.schema.json',
        historyTransitionReport(),
      ],
      [
        'companion-menu-control-proof-history-transition-reconciliation-delivery.schema.json',
        historyReconciliationDelivery(),
      ],
      [
        'companion-menu-control-proof-history-transition-reconciliation-ack.schema.json',
        historyReconciliationAck(),
      ],
      [
        'companion-menu-control-proof-terminal-reconciliation-delivery.schema.json',
        companionMenuControlProofTerminalReconciliationDeliverySchema.parse({
          ...delivery(),
          kind: 'native_terminal_reconcile',
          recoveryId: '13572468-1357-4357-8357-135724681357',
          replacementLease: {
            ...delivery().lease,
            leaseId: '24681357-2468-4468-8468-246813572468',
            expiresAt: '2026-08-22T10:10:00+08:00',
          },
          acknowledgedProgressReceiptChainHeads: [],
          recoveryRequestedAt: '2026-08-22T10:06:00+08:00',
        }),
      ],
      [
        'companion-menu-control-proof-terminal-reconciliation-ack.schema.json',
        {
          kind: 'native_terminal_reconcile',
          recoveryId: '13572468-1357-4357-8357-135724681357',
          result: result(),
          terminalResultContentSha256:
            computeCompanionMenuControlProofResultContentSha256(result()),
          expectedMarkerContentSha256:
            computeCompanionMenuControlProofTerminalMarkerContentSha256(result()),
          currentSceneFingerprintSha256:
            result().terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
          occurredAt: '2026-08-22T10:06:01+08:00',
        },
      ],
      ['companion-menu-control-proof-recovery-ack-response.schema.json', { result: 'accepted' }],
    ] as const;
    for (const [filename, valid] of cases) {
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      expect(schema['additionalProperties']).toBe(false);
      if (
        [
          'companion-menu-control-proof-delivery.schema.json',
          'companion-menu-control-proof-progress.schema.json',
          'companion-menu-control-proof-result.schema.json',
          'companion-menu-control-proof-status.schema.json',
        ].includes(filename)
      ) {
        expect(schema['$comment']).toContain('semantic validation gate');
      }
      await validatePublicJsonSchemaCases(schema, [
        { value: valid, accepted: true },
        { value: { ...valid, forbidden: true }, accepted: false },
      ]);
    }
  });
});
