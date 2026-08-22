import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionCreateRequestSchema,
  companionExecutionTrackExecutionDeliverySchema,
  companionExecutionTrackExecutionManagedStartAckSchema,
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionProgressChainSchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionProgressTransitionMatches,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionRecoveryPollDeliverySchema,
  companionExecutionTrackExecutionRecoveryRequestSchema,
  companionExecutionTrackExecutionResultSchema,
  companionExecutionTrackExecutionStatusSchema,
  companionExecutionTrackPreflightBindingSchema,
  companionMenuControlProofResultSchema,
  computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
  type CompanionExecutionTrackExecutionProgress,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';
import {
  executionTrackPreflightFixture,
  executionTrackPreflightLease,
  preflightIds,
} from '../support/execution-track-preflight-fixture.js';

const ids = {
  proof: '90000000-0000-4000-8000-000000000002',
  checkpoint: '90000000-0000-4000-8000-000000000003',
  delivery: '90000000-0000-4000-8000-000000000004',
  intent: '90000000-0000-4000-8000-000000000005',
  observation: '90000000-0000-4000-8000-000000000006',
  proofCheckpoint: '90000000-0000-4000-8000-000000000007',
  undoLock: '90000000-0000-4000-8000-000000000008',
  managedStart: '90000000-0000-4000-8000-000000000009',
  recovery: '90000000-0000-4000-8000-000000000010',
  replacementLease: '90000000-0000-4000-8000-000000000011',
} as const;

function hashContent<T extends Record<string, unknown>>(content: T) {
  return { ...content, contentSha256: computeProtocolCanonicalJsonSha256(content) };
}

function fixture() {
  const preflight = executionTrackPreflightFixture();
  const lease = {
    ...executionTrackPreflightLease(),
    expiresAt: '2026-08-22T10:00:16Z',
  } as const;
  const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
    ...preflight.request,
    formatVersion: '2.0.0',
  });
  const content = {
    ...request,
    proofId: ids.proof,
    preflightBinding: preflight.binding,
    executor: {
      executorId: 'blender.uv_sphere_menu_proven_managed_commit.v2',
      proofExecutorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      targetProfile: 'factory_layout_three_object_ui_scale_2',
      executionBoundary: 'proof_restore_then_managed_commit',
      authorization: 'accepted_replay_next_step',
      proofOperationIds: [
        'workspace.layout',
        'menu.add',
        'menu.mesh',
        'operator.uv_sphere',
        'control.location',
        'control.scale',
        'control.object_name',
      ],
      nativeUndoDepth: 8,
      commitActionName: 'blender.mesh.create_uv_sphere',
      automaticReplay: false,
    },
    executionScope: {
      kind: 'single_root_leaf',
      leafCount: 1,
      rootLeafId: request.leafId,
      procedureTreeContentSha256: preflight.binding.artifacts.procedureTreeContentSha256,
    },
    requestedAt: preflight.binding.requestedAt,
  };
  const binding = companionExecutionTrackExecutionBindingSchema.parse({
    ...content,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(content),
  });
  const delivery = companionExecutionTrackExecutionDeliverySchema.parse({
    binding,
    deliveryId: ids.delivery,
    lease,
    dispatchedAt: '2026-08-22T10:00:01Z',
  });
  return { binding, delivery, lease, request };
}

function progressContent(
  delivery: ReturnType<typeof fixture>['delivery'],
  phase: string,
  sequence: number,
  previousProgressContentSha256: string | null,
  occurredAt: string,
  evidence: Record<string, unknown>,
) {
  const renewedExpiry = [
    '2026-08-22T10:00:16Z',
    '2026-08-22T10:00:16Z',
    '2026-08-22T10:00:20Z',
    '2026-08-22T10:00:20Z',
    '2026-08-22T10:00:25Z',
    '2026-08-22T10:00:25Z',
  ][sequence - 1]!;
  return {
    ...delivery,
    currentLease: { ...delivery.lease, expiresAt: renewedExpiry },
    phase,
    sequence,
    previousProgressContentSha256,
    ...evidence,
    occurredAt,
  };
}

function receiptSpecs() {
  return [
    ['workspace.layout', { status: 'precondition_verified', path: ['Layout'] }],
    ['menu.add', { status: 'control_executed', path: ['Layout', 'Add'] }],
    ['menu.mesh', { status: 'control_executed', path: ['Layout', 'Add', 'Mesh'] }],
    [
      'operator.uv_sphere',
      { status: 'control_executed', path: ['Layout', 'Add', 'Mesh', 'UV Sphere'], radius: 1 },
    ],
    [
      'control.location',
      {
        status: 'control_executed',
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        value: [1.25, -2, 0.75],
      },
    ],
    [
      'control.scale',
      {
        status: 'control_executed',
        path: ['Sidebar', 'Item', 'Transform', 'Scale'],
        value: [1.5, 1.5, 1.5],
      },
    ],
    [
      'control.object_name',
      {
        status: 'control_executed',
        path: ['Properties', 'Object', 'Name'],
        value: 'OperatingLine.TutorialEye',
      },
    ],
  ] as const;
}

function makeReceipts(binding: ReturnType<typeof fixture>['binding'], deliveryId: string) {
  let previousReceiptContentSha256: string | null = null;
  return receiptSpecs().map(([operationId, summary], index) => {
    const content = {
      receiptId: `90000000-0000-4000-8000-00000000002${index}`,
      proofId: binding.proofId,
      requestId: binding.requestId,
      deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: `2026-08-22T10:00:0${index + 3}Z`,
      operationId,
      summary,
    };
    const receipt = {
      ...content,
      contentSha256: computeCompanionMenuControlProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function v1SucceededProofResult() {
  const operationIds = receiptSpecs().map(([operationId]) => operationId);
  const target = { adapterId: 'blender' as const, instanceId: preflightIds.instance };
  const plan = { id: 'plan.uv-sphere', revision: 1, contentSha256: '6'.repeat(64) };
  const startCheckpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: ids.checkpoint,
    previousCheckpointId: null,
    operation: 'start',
    committedAt: '2026-08-22T10:00:01Z',
    marker: { key: '_operating_line_native_history_v1', matched: true },
    journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
    session: {
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256: plan.contentSha256,
      executionId: preflightIds.execution,
      activeStepId: null,
      completedStepIds: [],
      receiptStepIds: [],
    },
  } as const;
  const bindingContent = {
    formatVersion: '1.0.0',
    bindingId: '90000000-0000-4000-8000-000000000040',
    proposalRecordContentSha256: '0'.repeat(64),
    proofId: ids.proof,
    requestId: preflightIds.request,
    replayId: preflightIds.replay,
    target,
    proposalId: preflightIds.proposal,
    packetContentSha256: '1'.repeat(64),
    inputTreeContentSha256: '2'.repeat(64),
    outputTreeContentSha256: '3'.repeat(64),
    materializationContentSha256: '4'.repeat(64),
    proposalContentSha256: '5'.repeat(64),
    plan,
    executionId: preflightIds.execution,
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
      decisionId: preflightIds.decision,
      proposalId: preflightIds.proposal,
      instanceId: preflightIds.instance,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-22T10:00:00Z',
    },
    startState: {
      reportId: preflightIds.report,
      sequence: 7,
      adapterId: 'blender',
      instanceId: preflightIds.instance,
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256: plan.contentSha256,
      executionId: preflightIds.execution,
      phase: 'running',
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      stepId: null,
      observationCount: 0,
      nativeUndoCheckpoint: startCheckpoint,
      occurredAt: '2026-08-22T10:00:01Z',
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
      interactionCatalogContentSha256: '7'.repeat(64),
      packetContentSha256: '1'.repeat(64),
      inputTreeContentSha256: '2'.repeat(64),
      outputTreeContentSha256: '3'.repeat(64),
      materializationContentSha256: '4'.repeat(64),
      menuTrackContentSha256: '8'.repeat(64),
    },
    executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    nativeUndoDepth: 8,
    createdAt: '2026-08-22T10:00:02Z',
  } as const;
  const binding = {
    ...bindingContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofBindingContentSha256(bindingContent),
    },
  } as const;
  const delivery = {
    formatVersion: '1.0.0',
    requestId: binding.requestId,
    replayId: binding.replayId,
    proofId: binding.proofId,
    deliveryId: ids.delivery,
    target,
    targetProfile: binding.targetProfile,
    proposalId: binding.proposalId,
    proposalRecordContentSha256: binding.proposalRecordContentSha256,
    proposalContentSha256: binding.proposalContentSha256,
    plan,
    executionId: binding.executionId,
    leafId: binding.leafId,
    packetContentSha256: binding.packetContentSha256,
    inputTreeContentSha256: binding.inputTreeContentSha256,
    outputTreeContentSha256: binding.outputTreeContentSha256,
    materializationContentSha256: binding.materializationContentSha256,
    interactionCatalogVersion: binding.materialization.interactionCatalogVersion,
    interactionCatalogContentSha256: binding.materialization.interactionCatalogContentSha256,
    menuTrackContentSha256: binding.materialization.menuTrackContentSha256,
    bindingContentSha256: binding.integrity.contentSha256,
    binding,
    executorId: binding.executorId,
    executionBoundary: binding.executionBoundary,
    authorization: binding.authorization,
    transport: binding.transport,
    operationIds,
    nativeUndoDepth: 8,
    expectedState: { reportId: preflightIds.report, sequence: 7 },
    startCheckpoint: binding.startState,
    lease: {
      leaseId: preflightIds.lease,
      sessionId: preflightIds.session,
      target,
      documentIncarnationId: preflightIds.document,
      expiresAt: '2026-08-22T10:05:00Z',
    },
    requestedAt: '2026-08-22T10:00:03Z',
    dispatchedAt: '2026-08-22T10:00:04Z',
  } as const;
  let previousReceiptContentSha256: string | null = null;
  const receipts = receiptSpecs().map(([operationId, summary], index) => {
    const content = {
      receiptId: `90000000-0000-4000-8000-00000000005${index}`,
      proofId: binding.proofId,
      requestId: binding.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: binding.integrity.contentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      summary,
      occurredAt: `2026-08-22T10:00:${String(index + 10).padStart(2, '0')}Z`,
    };
    const receipt = {
      ...content,
      contentSha256: computeCompanionMenuControlProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
  const strongObservation = hashContent({
    kind: 'uv_sphere_menu_controls_ready',
    satisfied: true,
    observationId: ids.observation,
    objectName: 'OperatingLine.TutorialEye',
    objectType: 'MESH',
    location: [1.25, -2, 0.75],
    scale: [1.5, 1.5, 1.5],
    meshTopology: { vertices: 482, edges: 992, polygons: 512 },
    meshSha256: '9'.repeat(64),
    sceneFingerprintSha256: 'a'.repeat(64),
    observedAt: '2026-08-22T10:00:17Z',
  });
  return companionMenuControlProofResultSchema.parse({
    ...delivery,
    status: 'succeeded',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'succeeded_locked',
      operationSummaries: receipts.map((receipt) => ({
        operationId: receipt.operationId,
        summaryContentSha256: computeProtocolCanonicalJsonSha256(receipt.summary),
      })),
      operationReceipts: receipts,
      strongObservation,
      nativeUndoCheckpoint: {
        checkpointId: ids.proofCheckpoint,
        undoLockId: ids.undoLock,
        nativeUndoDepth: 8,
        nativeHistoryCursor: 8,
        mutationStages: [
          'uv_sphere_created',
          'location_x_set',
          'location_y_set',
          'location_z_set',
          'scale_x_set',
          'scale_y_set',
          'scale_z_set',
          'object_name_set',
        ],
        baselineSceneFingerprintSha256: 'b'.repeat(64),
        finalSceneFingerprintSha256: strongObservation.sceneFingerprintSha256,
        restoredSceneFingerprintSha256: 'b'.repeat(64),
        reappliedSceneFingerprintSha256: strongObservation.sceneFingerprintSha256,
        receiptChainRootSha256: receipts[0]!.contentSha256,
        receiptChainHeadSha256: receipts.at(-1)!.contentSha256,
        strongObservationContentSha256: strongObservation.contentSha256,
        committedAt: '2026-08-22T10:00:18Z',
      },
    },
    error: null,
    occurredAt: '2026-08-22T10:00:19Z',
  });
}

function sixPhaseChain(): CompanionExecutionTrackExecutionProgress[] {
  const { binding, delivery, lease } = fixture();
  const startCheckpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: ids.checkpoint,
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
    checkpointId: ids.checkpoint,
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
    hashContent(
      progressContent(delivery, 'baseline_attested', 1, null, '2026-08-22T10:00:02Z', {
        startCheckpoint,
        startAttestation,
      }),
    ),
  );
  const receipts = makeReceipts(binding, delivery.deliveryId);
  const baselineRefs = {
    startCheckpointId: ids.checkpoint,
    startAttestationContentSha256: startAttestation.contentSha256,
    baselineSceneFingerprintSha256: startAttestation.sceneFingerprintSha256,
  };
  const proof = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent(
      progressContent(
        delivery,
        'proof_in_progress',
        2,
        baseline.contentSha256,
        '2026-08-22T10:00:09Z',
        {
          ...baselineRefs,
          proofReceipts: receipts,
          completedOperationIds: receipts.map((receipt) => receipt.operationId),
        },
      ),
    ),
  );
  const observation = hashContent({
    kind: 'uv_sphere_menu_controls_ready',
    satisfied: true,
    observationId: ids.observation,
    objectName: 'OperatingLine.TutorialEye',
    objectType: 'MESH',
    location: [1.25, -2, 0.75],
    scale: [1.5, 1.5, 1.5],
    meshTopology: { vertices: 482, edges: 992, polygons: 512 },
    meshSha256: '4'.repeat(64),
    sceneFingerprintSha256: '5'.repeat(64),
    observedAt: '2026-08-22T10:00:10Z',
  });
  const proofEvidenceContent = {
    kind: 'succeeded_locked',
    operationSummaries: receipts.map((receipt) => ({
      operationId: receipt.operationId,
      summaryContentSha256: computeProtocolCanonicalJsonSha256(receipt.summary),
    })),
    operationReceipts: receipts,
    strongObservation: observation,
    nativeUndoCheckpoint: {
      checkpointId: ids.proofCheckpoint,
      undoLockId: ids.undoLock,
      nativeUndoDepth: 8,
      nativeHistoryCursor: 8,
      mutationStages: [
        'uv_sphere_created',
        'location_x_set',
        'location_y_set',
        'location_z_set',
        'scale_x_set',
        'scale_y_set',
        'scale_z_set',
        'object_name_set',
      ],
      baselineSceneFingerprintSha256: startAttestation.sceneFingerprintSha256,
      finalSceneFingerprintSha256: observation.sceneFingerprintSha256,
      restoredSceneFingerprintSha256: startAttestation.sceneFingerprintSha256,
      reappliedSceneFingerprintSha256: observation.sceneFingerprintSha256,
      receiptChainRootSha256: receipts[0]!.contentSha256,
      receiptChainHeadSha256: receipts.at(-1)!.contentSha256,
      strongObservationContentSha256: observation.contentSha256,
      committedAt: '2026-08-22T10:00:11Z',
    },
    managedActionExecuted: false,
    managedIdentityVerified: false,
    managedReceiptCreated: false,
  };
  const evidence = {
    ...proofEvidenceContent,
    proofEvidenceContentSha256: computeProtocolCanonicalJsonSha256(proofEvidenceContent),
  };
  const observed = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent(
      progressContent(
        delivery,
        'proof_observed_locked',
        3,
        proof.contentSha256,
        '2026-08-22T10:00:11Z',
        { ...baselineRefs, evidence },
      ),
    ),
  );
  const fingerprints = [
    observation.sceneFingerprintSha256,
    '6'.repeat(64),
    '7'.repeat(64),
    '8'.repeat(64),
    '9'.repeat(64),
    '0'.repeat(64),
    'f'.repeat(64),
    '4'.repeat(64),
    startAttestation.sceneFingerprintSha256,
  ];
  const transitions = Array.from({ length: 8 }, (_, index) =>
    hashContent({
      order: index + 1,
      operation: 'native_undo',
      fromCursor: 8 - index,
      toCursor: 7 - index,
      beforeSceneFingerprintSha256: fingerprints[index],
      afterSceneFingerprintSha256: fingerprints[index + 1],
      occurredAt: `2026-08-22T10:00:${String(index + 12).padStart(2, '0')}Z`,
    }),
  );
  const proofRefs = {
    proofEvidenceContentSha256: evidence.proofEvidenceContentSha256,
    proofCheckpointId: ids.proofCheckpoint,
    undoLockId: ids.undoLock,
    proofFinalSceneFingerprintSha256: observation.sceneFingerprintSha256,
  };
  const restoring = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent(
      progressContent(
        delivery,
        'restore_in_progress',
        4,
        observed.contentSha256,
        '2026-08-22T10:00:12Z',
        {
          ...baselineRefs,
          ...proofRefs,
          transitions: transitions.slice(0, 1),
          nativeHistoryCursor: 7,
        },
      ),
    ),
  );
  const baselineIdentity = hashContent({
    sceneFingerprintSha256: startAttestation.sceneFingerprintSha256,
    ...startAttestation.identitySnapshot,
    startReportId: startAttestation.reportId,
    startCheckpointId: ids.checkpoint,
    startAttestationContentSha256: startAttestation.contentSha256,
    sessionId: lease.sessionId,
    documentIncarnationId: lease.documentIncarnationId,
  });
  const restored = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent(
      progressContent(
        delivery,
        'baseline_restored',
        5,
        restoring.contentSha256,
        '2026-08-22T10:00:19Z',
        {
          ...proofRefs,
          transitions,
          nativeHistoryCursor: 0,
          undoChainHeadContentSha256: transitions.at(-1)!.contentSha256,
          baseline: baselineIdentity,
        },
      ),
    ),
  );
  const redoBarrier = hashContent({
    evidenceClass: 'companion_reported_native_redo_barrier',
    method: 'view3d_ed_undo_push',
    message: 'OperatingLine supersede restored menu proof',
    proofCheckpointId: ids.proofCheckpoint,
    undoLockId: ids.undoLock,
    proofEvidenceContentSha256: proofRefs.proofEvidenceContentSha256,
    proofTerminalMarkerContentSha256:
      computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256({
        formatVersion: '2.0.0',
        kind: 'proof_terminal_marker',
        proofId: binding.proofId,
        bindingContentSha256: binding.bindingContentSha256,
        proofCheckpointId: ids.proofCheckpoint,
        undoLockId: ids.undoLock,
        baselineSceneFingerprintSha256: baselineIdentity.sceneFingerprintSha256,
        finalSceneFingerprintSha256: proofRefs.proofFinalSceneFingerprintSha256,
        proofEvidenceContentSha256: proofRefs.proofEvidenceContentSha256,
      }),
    baselineContentSha256: baselineIdentity.contentSha256,
    undoChainHeadContentSha256: transitions.at(-1)!.contentSha256,
    baselineSceneFingerprintBeforeSha256: baselineIdentity.sceneFingerprintSha256,
    baselineSceneFingerprintAfterSha256: baselineIdentity.sceneFingerprintSha256,
    markerMatchedBeforeRemoval: true,
    markerPresentBeforePush: false,
    markerPresentAfterPush: false,
    undoPushFinished: true,
    redoPollAfterBarrier: false,
    controllerSuperseded: true,
    controllerCheckpointAbsent: true,
    verifiedAt: '2026-08-22T10:00:20Z',
  });
  const intent = hashContent({
    intentId: ids.intent,
    action: binding.preflightBinding.action,
    baselineContentSha256: baselineIdentity.contentSha256,
    redoBarrier,
    managedActionExecuted: false,
    managedReceiptCreated: false,
    recordedAt: '2026-08-22T10:00:20Z',
  });
  const commit = companionExecutionTrackExecutionProgressSchema.parse(
    hashContent(
      progressContent(
        delivery,
        'commit_intent_recorded',
        6,
        restored.contentSha256,
        '2026-08-22T10:00:20Z',
        {
          ...proofRefs,
          undoChainHeadContentSha256: transitions.at(-1)!.contentSha256,
          baseline: baselineIdentity,
          intent,
        },
      ),
    ),
  );
  return [baseline, proof, observed, restoring, restored, commit];
}

function resultIdentity(occurredAt = '2026-08-22T10:00:21Z', currentLease = fixture().lease) {
  const { binding, delivery, lease } = fixture();
  return {
    formatVersion: '2.0.0',
    requestId: binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    currentLease,
    proposalId: binding.proposalId,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    occurredAt,
  };
}

describe('Companion execution-track v2 protocol', () => {
  it('keeps create client-known and binding menu-only without pre-delivery baseline evidence', () => {
    const { binding, request } = fixture();
    expect(Object.keys(request).sort()).toEqual(
      [
        'executionId',
        'expectedState',
        'formatVersion',
        'leafId',
        'override',
        'plan',
        'proposalId',
        'requestId',
        'target',
      ].sort(),
    );
    expect(binding).not.toHaveProperty('startCheckpoint');
    expect(binding).not.toHaveProperty('startAttestation');
    expect(
      companionExecutionTrackExecutionBindingSchema.safeParse({ ...binding, startCheckpoint: {} })
        .success,
    ).toBe(false);
    const preflightContent = Object.fromEntries(
      Object.entries(binding.preflightBinding).filter(([key]) => key !== 'bindingContentSha256'),
    );
    const forgedPreflightContent = {
      ...preflightContent,
      override: { ...binding.preflightBinding.override, modality: 'shortcut' },
    };
    const forgedPreflight = {
      ...forgedPreflightContent,
      bindingContentSha256: computeProtocolCanonicalJsonSha256(forgedPreflightContent),
    };
    const bindingContent = Object.fromEntries(
      Object.entries(binding).filter(([key]) => key !== 'bindingContentSha256'),
    );
    const forgedBindingContent = { ...bindingContent, preflightBinding: forgedPreflight };
    expect(
      companionExecutionTrackExecutionBindingSchema.safeParse({
        ...forgedBindingContent,
        bindingContentSha256: computeProtocolCanonicalJsonSha256(forgedBindingContent),
      }).success,
    ).toBe(false);
  });

  it('accepts one real continuous six-phase chain and rejects hostile chain changes', () => {
    const chain = sixPhaseChain();
    expect(chain.map((progress) => progress.phase)).toEqual([
      'baseline_attested',
      'proof_in_progress',
      'proof_observed_locked',
      'restore_in_progress',
      'baseline_restored',
      'commit_intent_recorded',
    ]);
    expect(companionExecutionTrackExecutionProgressChainSchema.parse(chain)).toEqual(chain);
    for (let index = 1; index < chain.length; index += 1) {
      expect(
        companionExecutionTrackExecutionProgressTransitionMatches(chain[index - 1]!, chain[index]!),
      ).toBe(true);
    }
    const proof = chain[1]!;
    const proofContent = Object.fromEntries(
      Object.entries(proof).filter(([key]) => key !== 'contentSha256'),
    );
    const brokenPreviousContent = {
      ...proofContent,
      previousProgressContentSha256: 'f'.repeat(64),
    };
    const brokenPrevious = companionExecutionTrackExecutionProgressSchema.parse(
      hashContent(brokenPreviousContent),
    );
    expect(
      companionExecutionTrackExecutionProgressChainSchema.safeParse([
        chain[0],
        brokenPrevious,
        ...chain.slice(2),
      ]).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(chain[0]!, {
        ...chain[1]!,
        deliveryId: preflightIds.delivery,
      }),
    ).toBe(false);
    const baselineStart = chain[0];
    if (baselineStart?.phase === 'baseline_attested') {
      const lateCheckpointContent = {
        ...Object.fromEntries(
          Object.entries(baselineStart).filter(([key]) => key !== 'contentSha256'),
        ),
        startCheckpoint: {
          ...baselineStart.startCheckpoint,
          committedAt: '2026-08-22T10:00:01Z',
        },
      };
      expect(
        companionExecutionTrackExecutionProgressSchema.safeParse(hashContent(lateCheckpointContent))
          .success,
      ).toBe(false);
    }
    const restored = chain[4];
    expect(restored?.phase).toBe('baseline_restored');
    if (restored?.phase === 'baseline_restored') {
      const forgedBaseline = hashContent({
        ...Object.fromEntries(
          Object.entries(restored.baseline).filter(([key]) => key !== 'contentSha256'),
        ),
        pointerDomainSha256: 'a'.repeat(64),
      });
      const forgedContent = {
        ...Object.fromEntries(Object.entries(restored).filter(([key]) => key !== 'contentSha256')),
        baseline: forgedBaseline,
      };
      expect(
        companionExecutionTrackExecutionProgressChainSchema.safeParse([
          ...chain.slice(0, 4),
          companionExecutionTrackExecutionProgressSchema.parse(hashContent(forgedContent)),
          chain[5],
        ]).success,
      ).toBe(false);
    }
  });

  it('rejects lease rollback, cross-boundary time travel, unchanged proof, and forged redo barriers', () => {
    const chain = sixPhaseChain();
    const [baseline, proof, observed, restoring, restored, commit] = chain;
    if (
      baseline?.phase !== 'baseline_attested' ||
      proof?.phase !== 'proof_in_progress' ||
      observed?.phase !== 'proof_observed_locked' ||
      restoring?.phase !== 'restore_in_progress' ||
      restored?.phase !== 'baseline_restored' ||
      commit?.phase !== 'commit_intent_recorded'
    ) {
      throw new Error('expected complete execution chain');
    }

    const restoringContent = Object.fromEntries(
      Object.entries(restoring).filter(([key]) => key !== 'contentSha256'),
    );
    const rolledBackLease = companionExecutionTrackExecutionProgressSchema.parse(
      hashContent({
        ...restoringContent,
        currentLease: { ...restoring.currentLease, expiresAt: '2026-08-22T10:00:18Z' },
      }),
    );
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(observed, rolledBackLease),
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressSchema.safeParse(
        hashContent({
          ...Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'contentSha256')),
          currentLease: {
            ...proof.currentLease,
            sessionId: '90000000-0000-4000-8000-000000000099',
          },
        }),
      ).success,
    ).toBe(false);

    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(
        { ...baseline, occurredAt: '2026-08-22T10:00:04Z' },
        proof,
      ),
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(
        { ...proof, occurredAt: '2026-08-22T10:00:10.500Z' },
        observed,
      ),
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(observed, {
        ...restoring,
        transitions: [{ ...restoring.transitions[0]!, occurredAt: '2026-08-22T10:00:10Z' }],
      }),
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(
        { ...restoring, occurredAt: '2026-08-22T10:00:18Z' },
        restored,
      ),
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionProgressTransitionMatches(restored, {
        ...commit,
        intent: {
          ...commit.intent,
          redoBarrier: { ...commit.intent.redoBarrier, verifiedAt: '2026-08-22T10:00:18Z' },
        },
      }),
    ).toBe(false);

    const unchangedCheckpoint = {
      ...observed.evidence.nativeUndoCheckpoint,
      baselineSceneFingerprintSha256:
        observed.evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
      restoredSceneFingerprintSha256:
        observed.evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
    };
    const unchangedEvidenceContent = {
      ...Object.fromEntries(
        Object.entries(observed.evidence).filter(([key]) => key !== 'proofEvidenceContentSha256'),
      ),
      nativeUndoCheckpoint: unchangedCheckpoint,
    };
    const unchangedObservedContent = {
      ...Object.fromEntries(Object.entries(observed).filter(([key]) => key !== 'contentSha256')),
      baselineSceneFingerprintSha256:
        observed.evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256,
      evidence: {
        ...unchangedEvidenceContent,
        proofEvidenceContentSha256: computeProtocolCanonicalJsonSha256(unchangedEvidenceContent),
      },
    };
    expect(
      companionExecutionTrackExecutionProgressSchema.safeParse(
        hashContent(unchangedObservedContent),
      ).success,
    ).toBe(false);

    for (const redoBarrierPatch of [
      { proofTerminalMarkerContentSha256: 'f'.repeat(64) },
      { baselineContentSha256: 'f'.repeat(64) },
      { undoChainHeadContentSha256: 'f'.repeat(64) },
      { baselineSceneFingerprintAfterSha256: 'f'.repeat(64) },
    ]) {
      const barrier = hashContent({
        ...Object.fromEntries(
          Object.entries(commit.intent.redoBarrier).filter(([key]) => key !== 'contentSha256'),
        ),
        ...redoBarrierPatch,
      });
      const intent = hashContent({
        ...Object.fromEntries(
          Object.entries(commit.intent).filter(([key]) => key !== 'contentSha256'),
        ),
        redoBarrier: barrier,
      });
      expect(
        companionExecutionTrackExecutionProgressSchema.safeParse(
          hashContent({
            ...Object.fromEntries(
              Object.entries(commit).filter(([key]) => key !== 'contentSha256'),
            ),
            intent,
          }),
        ).success,
      ).toBe(false);
    }
  });

  it('requires phase-exact durable recovery references', () => {
    const { binding, delivery, lease } = fixture();
    const replacementLease = {
      ...lease,
      leaseId: ids.replacementLease,
      expiresAt: '2026-08-22T10:10:00Z',
    };
    const chain = sixPhaseChain();
    for (const progress of chain) {
      const durableReferences =
        progress.phase === 'baseline_restored'
          ? {
              terminalMarkerContentSha256: null,
              managedStartContentSha256: null,
              baselineContentSha256: progress.baseline.contentSha256,
              commitIntentId: null,
              commitIntentContentSha256: null,
            }
          : progress.phase === 'commit_intent_recorded'
            ? {
                terminalMarkerContentSha256: null,
                managedStartContentSha256: null,
                baselineContentSha256: progress.baseline.contentSha256,
                commitIntentId: progress.intent.intentId,
                commitIntentContentSha256: progress.intent.contentSha256,
              }
            : {
                terminalMarkerContentSha256: null,
                managedStartContentSha256: null,
                baselineContentSha256: null,
                commitIntentId: null,
                commitIntentContentSha256: null,
              };
      const request = {
        formatVersion: '2.0.0',
        recoveryId: ids.recovery,
        requestId: binding.requestId,
        target: binding.target,
        originalDeliveryId: delivery.deliveryId,
        bindingContentSha256: binding.bindingContentSha256,
        originalLease: lease,
        replacementLease,
        acceptedProgress: progress,
        acceptedProgressChainHeadContentSha256: progress.contentSha256,
        durableReferences,
        source: 'coordinator_restart',
        mode: 'read_only_reconcile',
        automaticReplay: false,
        requestedAt: '2026-08-22T10:05:00Z',
      };
      expect(companionExecutionTrackExecutionRecoveryRequestSchema.safeParse(request).success).toBe(
        true,
      );
      expect(
        companionExecutionTrackExecutionRecoveryRequestSchema.safeParse({
          ...request,
          durableReferences: {
            ...durableReferences,
            baselineContentSha256:
              durableReferences.baselineContentSha256 === null ? 'f'.repeat(64) : null,
          },
        }).success,
      ).toBe(false);
    }
  });

  it('keeps v1 and v2 succeeded-locked proof evidence equally hostile to semantic mutations', () => {
    const v1Result = v1SucceededProofResult();
    if (v1Result.terminalEvidence.kind !== 'succeeded_locked') {
      throw new Error('expected v1 succeeded proof');
    }
    const v1Evidence = v1Result.terminalEvidence;
    const observed = sixPhaseChain()[2];
    if (observed?.phase !== 'proof_observed_locked') throw new Error('expected observed proof');

    type SucceededEvidence = typeof v1Evidence;
    const mutations: Array<{
      name: string;
      mutate: (evidence: SucceededEvidence) => void;
    }> = [
      {
        name: 'receipt order',
        mutate: (evidence) => {
          const receipt = evidence.operationReceipts[0]!;
          receipt.order = 2;
          receipt.contentSha256 =
            computeCompanionMenuControlProofOperationReceiptContentSha256(receipt);
        },
      },
      {
        name: 'summary order',
        mutate: (evidence) => {
          [evidence.operationSummaries[0], evidence.operationSummaries[1]] = [
            evidence.operationSummaries[1]!,
            evidence.operationSummaries[0]!,
          ];
        },
      },
      {
        name: 'summary hash',
        mutate: (evidence) => {
          evidence.operationSummaries[0]!.summaryContentSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'receipt root',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.receiptChainRootSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'receipt head',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.receiptChainHeadSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'observation hash',
        mutate: (evidence) => {
          evidence.strongObservation.contentSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'checkpoint observation hash',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.strongObservationContentSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'checkpoint final scene fingerprint',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'checkpoint restored scene fingerprint',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.restoredSceneFingerprintSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'checkpoint reapplied scene fingerprint',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.reappliedSceneFingerprintSha256 = 'f'.repeat(64);
        },
      },
      {
        name: 'native undo depth',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.nativeUndoDepth = 7 as 8;
        },
      },
      {
        name: 'native history cursor',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.nativeHistoryCursor = 7 as 8;
        },
      },
      {
        name: 'receipt after observation',
        mutate: (evidence) => {
          const receipt = evidence.operationReceipts.at(-1)!;
          receipt.occurredAt = '2026-08-22T10:00:10.500Z';
          receipt.contentSha256 =
            computeCompanionMenuControlProofOperationReceiptContentSha256(receipt);
        },
      },
      {
        name: 'observation after checkpoint',
        mutate: (evidence) => {
          evidence.strongObservation.observedAt = '2026-08-22T10:00:11.500Z';
          const observationContent = Object.fromEntries(
            Object.entries(evidence.strongObservation).filter(([key]) => key !== 'contentSha256'),
          );
          evidence.strongObservation.contentSha256 =
            computeProtocolCanonicalJsonSha256(observationContent);
          evidence.nativeUndoCheckpoint.strongObservationContentSha256 =
            evidence.strongObservation.contentSha256;
        },
      },
      {
        name: 'checkpoint after terminal occurrence',
        mutate: (evidence) => {
          evidence.nativeUndoCheckpoint.committedAt = '2026-08-22T10:00:30Z';
        },
      },
    ];

    for (const { name, mutate } of mutations) {
      const mutatedV1 = structuredClone(v1Evidence);
      mutate(mutatedV1);
      expect(
        companionMenuControlProofResultSchema.safeParse({
          ...v1Result,
          terminalEvidence: mutatedV1,
        }).success,
        `v1 accepted ${name}`,
      ).toBe(false);

      const {
        proofEvidenceContentSha256: _proofEvidenceContentSha256,
        ...mutatedV2EvidenceContent
      } = structuredClone(observed.evidence);
      void _proofEvidenceContentSha256;
      mutate(mutatedV2EvidenceContent);
      const mutatedV2Evidence = {
        ...mutatedV2EvidenceContent,
        proofEvidenceContentSha256: computeProtocolCanonicalJsonSha256(mutatedV2EvidenceContent),
      };
      const mutatedProgressContent = {
        ...Object.fromEntries(Object.entries(observed).filter(([key]) => key !== 'contentSha256')),
        evidence: mutatedV2Evidence,
      };
      expect(
        companionExecutionTrackExecutionProgressSchema.safeParse(
          hashContent(mutatedProgressContent),
        ).success,
        `v2 accepted ${name}`,
      ).toBe(false);
    }
  });

  it('binds managed-start persistence to the exact commit delivery before mutation', () => {
    const commit = sixPhaseChain()[5];
    if (commit?.phase !== 'commit_intent_recorded') throw new Error('expected commit');
    const managedStart = hashContent({
      managedStartId: ids.managedStart,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      previousProgressContentSha256: commit.contentSha256,
      startedAt: '2026-08-22T10:00:21Z',
    });
    const submission = {
      formatVersion: '2.0.0',
      requestId: commit.binding.requestId,
      deliveryId: commit.deliveryId,
      bindingContentSha256: commit.binding.bindingContentSha256,
      currentLease: commit.currentLease,
      commitProgress: commit,
      managedStart,
    } as const;
    expect(companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(submission)).toEqual(
      submission,
    );
    expect(
      companionExecutionTrackExecutionManagedStartAckSchema.parse({ result: 'duplicate' }),
    ).toEqual({ result: 'duplicate' });

    const rehashStart = (patch: Record<string, unknown>) =>
      hashContent({
        ...Object.fromEntries(
          Object.entries(managedStart).filter(([key]) => key !== 'contentSha256'),
        ),
        ...patch,
      });
    const hostile = [
      { ...submission, requestId: ids.proof },
      { ...submission, deliveryId: ids.proof },
      { ...submission, bindingContentSha256: 'f'.repeat(64) },
      {
        ...submission,
        currentLease: { ...submission.currentLease, leaseId: ids.replacementLease },
      },
      {
        ...submission,
        currentLease: { ...submission.currentLease, sessionId: ids.replacementLease },
      },
      {
        ...submission,
        currentLease: {
          ...submission.currentLease,
          documentIncarnationId: ids.replacementLease,
        },
      },
      {
        ...submission,
        currentLease: {
          ...submission.currentLease,
          target: { ...submission.currentLease.target, instanceId: ids.replacementLease },
        },
      },
      {
        ...submission,
        currentLease: { ...submission.currentLease, expiresAt: '2026-08-22T10:00:24Z' },
      },
      { ...submission, commitProgress: { ...commit, contentSha256: 'f'.repeat(64) } },
      { ...submission, commitProgress: { ...commit, sequence: 5 } },
      {
        ...submission,
        commitProgress: { ...commit, previousProgressContentSha256: null },
      },
      { ...submission, commitProgress: { ...commit, deliveryId: ids.proof } },
      {
        ...submission,
        commitProgress: {
          ...commit,
          currentLease: { ...commit.currentLease, leaseId: ids.replacementLease },
        },
      },
      {
        ...submission,
        commitProgress: {
          ...commit,
          intent: { ...commit.intent, contentSha256: 'f'.repeat(64) },
        },
      },
      {
        ...submission,
        commitProgress: {
          ...commit,
          intent: {
            ...commit.intent,
            redoBarrier: { ...commit.intent.redoBarrier, contentSha256: 'f'.repeat(64) },
          },
        },
      },
      { ...submission, managedStart: rehashStart({ commitIntentId: ids.proof }) },
      {
        ...submission,
        managedStart: rehashStart({ commitIntentContentSha256: 'f'.repeat(64) }),
      },
      { ...submission, managedStart: rehashStart({ baselineContentSha256: 'f'.repeat(64) }) },
      {
        ...submission,
        managedStart: rehashStart({ proofEvidenceContentSha256: 'f'.repeat(64) }),
      },
      {
        ...submission,
        managedStart: rehashStart({ previousProgressContentSha256: 'f'.repeat(64) }),
      },
      { ...submission, managedStart: { ...managedStart, contentSha256: 'f'.repeat(64) } },
      { ...submission, managedStart: rehashStart({ startedAt: '2026-08-22T10:00:19Z' }) },
      { ...submission, managedStart: rehashStart({ startedAt: commit.currentLease.expiresAt }) },
    ];
    for (const value of hostile) {
      expect(
        companionExecutionTrackExecutionManagedStartSubmissionSchema.safeParse(value).success,
      ).toBe(false);
    }
    expect(
      companionExecutionTrackExecutionManagedStartAckSchema.safeParse({
        result: 'accepted',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('requires complete delivery/progress status and exact managed terminal references', async () => {
    const { binding, delivery, lease } = fixture();
    const chain = sixPhaseChain();
    const commit = chain[5];
    if (commit?.phase !== 'commit_intent_recorded') throw new Error('expected commit');
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        status: 'queued',
        updatedAt: binding.requestedAt,
      }).status,
    ).toBe('queued');
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        status: 'queued',
        updatedAt: '2026-08-22T10:00:01Z',
      }).success,
    ).toBe(false);
    const preDispatchAuthorityExpirationEvidence = {
      source: 'document_authority_drift',
      requestId: binding.requestId,
      bindingContentSha256: binding.bindingContentSha256,
      target: binding.target,
      priorStatus: 'queued',
      detectedAt: '2026-08-22T10:00:01Z',
      resolution: 'pre_dispatch_authority_expired',
      retainsTargetLock: false,
      automaticReplay: false,
    } as const;
    const preDispatchExpired = {
      binding,
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpirationEvidence,
      updatedAt: preDispatchAuthorityExpirationEvidence.detectedAt,
    } as const;
    expect(companionExecutionTrackExecutionStatusSchema.parse(preDispatchExpired)).toEqual(
      preDispatchExpired,
    );
    for (const value of [
      { ...preDispatchExpired, deliveryId: delivery.deliveryId },
      {
        ...preDispatchExpired,
        preDispatchAuthorityExpirationEvidence: {
          ...preDispatchAuthorityExpirationEvidence,
          source: 'coordinator_restart',
        },
      },
      {
        ...preDispatchExpired,
        preDispatchAuthorityExpirationEvidence: {
          ...preDispatchAuthorityExpirationEvidence,
          requestId: ids.proof,
        },
      },
      {
        ...preDispatchExpired,
        preDispatchAuthorityExpirationEvidence: {
          ...preDispatchAuthorityExpirationEvidence,
          bindingContentSha256: 'f'.repeat(64),
        },
      },
      {
        ...preDispatchExpired,
        preDispatchAuthorityExpirationEvidence: {
          ...preDispatchAuthorityExpirationEvidence,
          detectedAt: '2026-08-22T09:59:59Z',
        },
        updatedAt: '2026-08-22T09:59:59Z',
      },
      { ...preDispatchExpired, updatedAt: '2026-08-22T10:00:02Z' },
    ]) {
      expect(companionExecutionTrackExecutionStatusSchema.safeParse(value).success).toBe(false);
    }
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        status: 'dispatched',
        updatedAt: delivery.dispatchedAt,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'baseline_attested',
        updatedAt: chain[0]!.occurredAt,
      }).success,
    ).toBe(false);
    const managedStart = hashContent({
      managedStartId: ids.managedStart,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      previousProgressContentSha256: commit.contentSha256,
      startedAt: '2026-08-22T10:00:21Z',
    });
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'managed_action_in_progress',
        progress: commit,
        managedStart,
        updatedAt: '2026-08-22T10:00:21Z',
      }).status,
    ).toBe('managed_action_in_progress');
    for (const managedStartPatch of [
      { baselineContentSha256: 'f'.repeat(64) },
      { proofEvidenceContentSha256: 'f'.repeat(64) },
    ]) {
      const hostileManagedStart = hashContent({
        ...Object.fromEntries(
          Object.entries(managedStart).filter(([key]) => key !== 'contentSha256'),
        ),
        ...managedStartPatch,
      });
      expect(
        companionExecutionTrackExecutionStatusSchema.safeParse({
          binding,
          deliveryId: delivery.deliveryId,
          lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'managed_action_in_progress',
          progress: commit,
          managedStart: hostileManagedStart,
          updatedAt: '2026-08-22T10:00:21Z',
        }).success,
      ).toBe(false);
    }
    const commonManaged = {
      ...resultIdentity('2026-08-22T10:00:21Z', commit.currentLease),
      status: 'succeeded',
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      lastProgressContentSha256: commit.contentSha256,
      managedStart,
      startCheckpointId:
        chain[0]!.phase === 'baseline_attested'
          ? chain[0].startCheckpoint.checkpointId
          : ids.checkpoint,
      managedReport: {
        reportId: preflightIds.report,
        sequence: 8,
        transition: 'step_succeeded',
        stepId: binding.leafId,
        contentSha256: '1'.repeat(64),
      },
      managedCheckpoint: {
        checkpointId: '90000000-0000-4000-8000-000000000030',
        previousCheckpointId: ids.checkpoint,
        operation: 'next',
        receiptStepIds: [binding.leafId],
        contentSha256: '2'.repeat(64),
      },
      managedObservation: {
        observationIndex: 0,
        kind: 'uv_sphere_ready',
        contentSha256: '3'.repeat(64),
      },
    } as const;
    const success = companionExecutionTrackExecutionResultSchema.parse(commonManaged);
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'succeeded',
        progress: commit,
        result: success,
        updatedAt: success.occurredAt,
      }).status,
    ).toBe('succeeded');
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...commonManaged,
        commitIntentId: ids.proof,
      }).success,
    ).toBe(false);
    const failedManaged = companionExecutionTrackExecutionResultSchema.parse({
      ...Object.fromEntries(
        Object.entries(commonManaged).filter(
          ([key]) => !['managedObservation', 'managedReport', 'managedCheckpoint'].includes(key),
        ),
      ),
      status: 'failed_managed',
      managedReport: {
        reportId: preflightIds.report,
        sequence: 8,
        transition: 'step_observation_failed',
        stepId: binding.leafId,
        contentSha256: '4'.repeat(64),
      },
      managedCheckpoint: {
        checkpointId: '90000000-0000-4000-8000-000000000033',
        previousCheckpointId: ids.checkpoint,
        operation: 'next',
        receiptStepIds: [binding.leafId],
        contentSha256: '5'.repeat(64),
      },
      observationGate: {
        stepId: binding.leafId,
        status: 'repair_required',
        failureStrategy: 'retain_for_repair',
        message: 'Observation failed; retaining the managed checkpoint for repair.',
      },
      failedObservation: {
        observationIndex: 0,
        kind: 'uv_sphere_ready',
        satisfied: false,
        contentSha256: '6'.repeat(64),
      },
      retainsTargetLock: true,
      error: 'Managed action failed durably.',
    });
    expect(failedManaged.status).toBe('failed_managed');
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'failed_managed',
        progress: commit,
        result: failedManaged,
        updatedAt: failedManaged.occurredAt,
      }).status,
    ).toBe('failed_managed');
    const backdatedManagedStart = hashContent({
      ...Object.fromEntries(
        Object.entries(managedStart).filter(([key]) => key !== 'contentSha256'),
      ),
      startedAt: '2026-08-22T10:00:19Z',
    });
    for (const terminal of [success, failedManaged]) {
      expect(
        companionExecutionTrackExecutionStatusSchema.safeParse({
          binding,
          deliveryId: delivery.deliveryId,
          lease,
          dispatchedAt: delivery.dispatchedAt,
          status: terminal.status,
          progress: commit,
          result: { ...terminal, managedStart: backdatedManagedStart },
          updatedAt: terminal.occurredAt,
        }).success,
      ).toBe(false);
    }
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...failedManaged,
        managedCheckpoint: undefined,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...failedManaged,
        observationGate: {
          ...failedManaged.observationGate,
          failureStrategy: 'rollback_step',
        },
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...failedManaged,
        failedObservation: undefined,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...success,
        serverValidation: { authenticatedReceiptContentSha256: 'f'.repeat(64) },
      }).success,
    ).toBe(false);
    const resultJsonSchema = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1', 'companion-execution-track-execution-result.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    await validatePublicJsonSchemaCases(resultJsonSchema, [
      { value: failedManaged, accepted: true },
      {
        value: {
          ...failedManaged,
          observationGate: {
            ...failedManaged.observationGate,
            failureStrategy: 'rollback_step',
          },
        },
        accepted: false,
      },
      {
        value: {
          ...success,
          serverValidation: { authenticatedReceiptContentSha256: 'f'.repeat(64) },
        },
        accepted: false,
      },
    ]);

    const baselineProgress = chain[0]!;
    const serverEvidence = {
      source: 'document_authority_drift',
      requestId: binding.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      target: binding.target,
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      documentIncarnationId: lease.documentIncarnationId,
      acceptedProgressChainHeadContentSha256: baselineProgress.contentSha256,
      durableReferences: {
        terminalMarkerContentSha256: null,
        managedStartContentSha256: null,
        baselineContentSha256: null,
        commitIntentId: null,
        commitIntentContentSha256: null,
      },
      priorStatus: 'baseline_attested',
      detectedAt: '2026-08-22T10:00:03Z',
      resolution: 'recovery_required',
      retainsTargetLock: true,
      automaticReplay: false,
    } as const;
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: baselineProgress,
        serverRecoveryEvidence: serverEvidence,
        updatedAt: serverEvidence.detectedAt,
      }).status,
    ).toBe('recovery_required');
    const preparedMarkerRecoveryEvidence = {
      source: 'coordinator_restart',
      requestId: binding.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      target: binding.target,
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      documentIncarnationId: lease.documentIncarnationId,
      acceptedProgressChainHeadContentSha256: commit.contentSha256,
      durableReferences: {
        terminalMarkerContentSha256: 'f'.repeat(64),
        managedStartContentSha256: managedStart.contentSha256,
        baselineContentSha256: commit.baseline.contentSha256,
        commitIntentId: commit.intent.intentId,
        commitIntentContentSha256: commit.intent.contentSha256,
      },
      priorStatus: 'managed_action_in_progress',
      detectedAt: '2026-08-22T10:00:22Z',
      resolution: 'recovery_required',
      retainsTargetLock: true,
      automaticReplay: false,
    } as const;
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: commit,
        serverRecoveryEvidence: preparedMarkerRecoveryEvidence,
        updatedAt: preparedMarkerRecoveryEvidence.detectedAt,
      }).status,
    ).toBe('recovery_required');
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: commit,
        serverRecoveryEvidence: {
          ...preparedMarkerRecoveryEvidence,
          priorStatus: 'commit_intent_recorded',
        },
        updatedAt: preparedMarkerRecoveryEvidence.detectedAt,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: commit,
        serverRecoveryEvidence: {
          ...preparedMarkerRecoveryEvidence,
          detectedAt: '2026-08-22T10:00:19Z',
        },
        updatedAt: '2026-08-22T10:00:19Z',
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: baselineProgress,
        serverRecoveryEvidence: {
          ...serverEvidence,
          durableReferences: {
            ...serverEvidence.durableReferences,
            terminalMarkerContentSha256: 'f'.repeat(64),
          },
        },
        updatedAt: serverEvidence.detectedAt,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'failed_no_mutation',
        progress: baselineProgress,
        serverRecoveryEvidence: {
          ...serverEvidence,
          resolution: 'failed_no_mutation',
          retainsTargetLock: false,
        },
        updatedAt: serverEvidence.detectedAt,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        progress: baselineProgress,
        serverRecoveryEvidence: { ...serverEvidence, source: 'coordinator_restart' },
        updatedAt: serverEvidence.detectedAt,
      }).status,
    ).toBe('recovery_required');
    const dispatchedRecoveryEvidence = {
      ...serverEvidence,
      source: 'coordinator_restart',
      acceptedProgressChainHeadContentSha256: null,
      priorStatus: 'dispatched',
      resolution: 'failed_no_mutation',
      retainsTargetLock: false,
    } as const;
    expect(
      companionExecutionTrackExecutionStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'failed_no_mutation',
        serverRecoveryEvidence: dispatchedRecoveryEvidence,
        updatedAt: dispatchedRecoveryEvidence.detectedAt,
      }).status,
    ).toBe('failed_no_mutation');
    expect(
      companionExecutionTrackExecutionResultSchema.safeParse({
        ...commonManaged,
        managedReport: { ...commonManaged.managedReport, stepId: 'wrong.step' },
      }).success,
    ).toBe(false);
  }, 20_000);

  it('uses an exact read-only replacement-lease recovery challenge', async () => {
    const { binding, delivery, lease } = fixture();
    const chain = sixPhaseChain();
    const replacementLease = {
      ...lease,
      leaseId: ids.replacementLease,
      expiresAt: '2026-08-22T10:10:00Z',
    };
    const restored = chain[4];
    if (restored?.phase !== 'baseline_restored') throw new Error('expected restored');
    const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      formatVersion: '2.0.0',
      recoveryId: ids.recovery,
      requestId: binding.requestId,
      target: binding.target,
      originalDeliveryId: delivery.deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      originalLease: lease,
      replacementLease,
      acceptedProgress: restored,
      acceptedProgressChainHeadContentSha256: restored.contentSha256,
      durableReferences: {
        terminalMarkerContentSha256: null,
        managedStartContentSha256: null,
        baselineContentSha256: restored.baseline.contentSha256,
        commitIntentId: null,
        commitIntentContentSha256: null,
      },
      source: 'coordinator_restart',
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt: '2026-08-22T10:05:00Z',
    });
    expect(companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse({ request })).toEqual({
      request,
    });
    expect(
      companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse({ request: null }),
    ).toEqual({ request: null });
    expect(
      companionExecutionTrackExecutionRecoveryPollDeliverySchema.safeParse({
        request,
        extra: true,
      }).success,
    ).toBe(false);
    const terminalResult = companionExecutionTrackExecutionResultSchema.parse({
      ...resultIdentity('2026-08-22T10:00:20Z', restored.currentLease),
      status: 'failed_restored',
      baselineContentSha256: restored.baseline.contentSha256,
      proofEvidenceContentSha256: restored.proofEvidenceContentSha256,
      lastProgressContentSha256: restored.contentSha256,
      error: 'Restored before reconciliation.',
    });
    const currentState = hashContent({
      replacementLeaseId: replacementLease.leaseId,
      sessionId: replacementLease.sessionId,
      documentIncarnationId: replacementLease.documentIncarnationId,
      reportId: preflightIds.report,
      sequence: binding.expectedState.sequence,
      sceneFingerprintSha256: restored.baseline.sceneFingerprintSha256,
      viewLayerIdentitySha256: restored.baseline.viewLayerIdentitySha256,
      objectIdentitySha256: restored.baseline.objectIdentitySha256,
      meshIdentitySha256: restored.baseline.meshIdentitySha256,
      collectionIdentitySha256: restored.baseline.collectionIdentitySha256,
      sessionUidDomainSha256: restored.baseline.sessionUidDomainSha256,
      pointerDomainSha256: restored.baseline.pointerDomainSha256,
      linksAndSelectionSha256: restored.baseline.linksAndSelectionSha256,
      observedAt: '2026-08-22T10:05:01Z',
    });
    const ack = {
      formatVersion: '2.0.0',
      request,
      recoveryId: request.recoveryId,
      requestId: request.requestId,
      originalDeliveryId: request.originalDeliveryId,
      bindingContentSha256: request.bindingContentSha256,
      replacementLeaseId: request.replacementLease.leaseId,
      acceptedProgressChainHeadContentSha256: request.acceptedProgressChainHeadContentSha256,
      durableReferences: request.durableReferences,
      outcome: 'reconciled',
      evidence: {
        kind: 'baseline_terminal',
        terminalResult,
        terminalResultContentSha256: computeProtocolCanonicalJsonSha256(terminalResult),
        progress: restored,
        currentState,
      },
      retainsTargetLock: false,
      automaticReplay: false,
      occurredAt: '2026-08-22T10:05:01Z',
    };
    expect(companionExecutionTrackExecutionRecoveryAckSchema.parse(ack).outcome).toBe('reconciled');
    const semanticallyInvalidTerminalAck = {
      ...ack,
      evidence: {
        ...ack.evidence,
        terminalResult: {
          ...terminalResult,
          currentLease: { ...terminalResult.currentLease, expiresAt: terminalResult.occurredAt },
        },
      },
    };
    expect(() =>
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse(semanticallyInvalidTerminalAck),
    ).not.toThrow();
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse(semanticallyInvalidTerminalAck)
        .success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...ack,
        evidence: {
          ...ack.evidence,
          progress: {
            ...restored,
            baseline: { ...restored.baseline, objectIdentitySha256: 'f'.repeat(64) },
          },
        },
      }).success,
    ).toBe(false);
    const withRestoredResult = (mutatedResult: typeof terminalResult) => ({
      ...ack,
      evidence: {
        ...ack.evidence,
        terminalResult: mutatedResult,
        terminalResultContentSha256: computeProtocolCanonicalJsonSha256(mutatedResult),
      },
    });
    for (const mutatedResult of [
      { ...terminalResult, baselineContentSha256: 'f'.repeat(64) },
      { ...terminalResult, proofEvidenceContentSha256: 'f'.repeat(64) },
      { ...terminalResult, leaseId: ids.replacementLease },
      { ...terminalResult, requestId: ids.proof },
    ]) {
      expect(
        companionExecutionTrackExecutionRecoveryAckSchema.safeParse(
          withRestoredResult(mutatedResult),
        ).success,
      ).toBe(false);
    }
    const renewedTerminalLease = {
      ...terminalResult.currentLease,
      expiresAt: '2026-08-22T10:10:00Z',
    };
    for (const mutatedResult of [
      { ...terminalResult, occurredAt: '2026-08-22T10:00:18.500Z' },
      {
        ...terminalResult,
        currentLease: renewedTerminalLease,
        occurredAt: '2026-08-22T10:05:00.500Z',
      },
      {
        ...terminalResult,
        currentLease: renewedTerminalLease,
        occurredAt: '2026-08-22T10:05:02Z',
      },
    ]) {
      expect(companionExecutionTrackExecutionResultSchema.safeParse(mutatedResult).success).toBe(
        true,
      );
      expect(
        companionExecutionTrackExecutionRecoveryAckSchema.safeParse(
          withRestoredResult(mutatedResult),
        ).success,
      ).toBe(false);
    }
    const baseline = chain[0];
    if (baseline?.phase !== 'baseline_attested') throw new Error('expected baseline');
    const noMutationRequest = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      ...request,
      acceptedProgress: baseline,
      acceptedProgressChainHeadContentSha256: baseline.contentSha256,
      durableReferences: {
        terminalMarkerContentSha256: null,
        managedStartContentSha256: null,
        baselineContentSha256: null,
        commitIntentId: null,
        commitIntentContentSha256: null,
      },
    });
    const noMutationResult = companionExecutionTrackExecutionResultSchema.parse({
      ...resultIdentity('2026-08-22T10:00:03Z', baseline.currentLease),
      status: 'failed_no_mutation',
      startCheckpointId: baseline.startCheckpoint.checkpointId,
      baselineAttestationContentSha256: baseline.startAttestation.contentSha256,
      lastProgressContentSha256: baseline.contentSha256,
      error: 'No mutation before restart.',
    });
    const noMutationState = hashContent({
      replacementLeaseId: replacementLease.leaseId,
      sessionId: replacementLease.sessionId,
      documentIncarnationId: replacementLease.documentIncarnationId,
      reportId: baseline.startAttestation.reportId,
      sequence: baseline.startAttestation.sequence,
      sceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
      ...baseline.startAttestation.identitySnapshot,
      observedAt: '2026-08-22T10:05:01Z',
    });
    const noMutationAck = {
      ...ack,
      request: noMutationRequest,
      acceptedProgressChainHeadContentSha256: baseline.contentSha256,
      durableReferences: noMutationRequest.durableReferences,
      evidence: {
        kind: 'baseline_terminal',
        terminalResult: noMutationResult,
        terminalResultContentSha256: computeProtocolCanonicalJsonSha256(noMutationResult),
        progress: baseline,
        currentState: noMutationState,
      },
    } as const;
    expect(companionExecutionTrackExecutionRecoveryAckSchema.parse(noMutationAck)).toEqual(
      noMutationAck,
    );
    for (const mutatedResult of [
      { ...noMutationResult, startCheckpointId: ids.proof },
      { ...noMutationResult, baselineAttestationContentSha256: 'f'.repeat(64) },
      { ...noMutationResult, lastProgressContentSha256: 'f'.repeat(64) },
      { ...noMutationResult, leaseId: ids.replacementLease },
    ]) {
      expect(
        companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
          ...noMutationAck,
          evidence: {
            ...noMutationAck.evidence,
            terminalResult: mutatedResult,
            terminalResultContentSha256: computeProtocolCanonicalJsonSha256(mutatedResult),
          },
        }).success,
      ).toBe(false);
    }
    const unresolved = {
      ...ack,
      outcome: 'recovery_required',
      evidence: {
        kind: 'unresolved_current_state',
        reason: 'proof_or_restore_indeterminate',
        currentState,
      },
      retainsTargetLock: true,
    };
    expect(companionExecutionTrackExecutionRecoveryAckSchema.parse(unresolved).outcome).toBe(
      'recovery_required',
    );
    const companionReportedRequest = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      ...request,
      source: 'companion_reported',
    });
    expect(companionReportedRequest.mode).toBe('read_only_reconcile');
    expect(companionReportedRequest.automaticReplay).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.parse({
        ...unresolved,
        request: companionReportedRequest,
      }).outcome,
    ).toBe('recovery_required');
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...unresolved,
        evidence: { ...unresolved.evidence, reason: 'managed_state_indeterminate' },
      }).success,
    ).toBe(false);
    const recoveryAckJsonSchema = JSON.parse(
      readFileSync(
        resolve(
          'protocol/schemas/v1',
          'companion-execution-track-execution-recovery-ack.schema.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    await validatePublicJsonSchemaCases(recoveryAckJsonSchema, [
      { value: ack, accepted: true },
      { value: unresolved, accepted: true },
      {
        value: { ...ack, evidence: { ...ack.evidence, progress: chain[0] } },
        accepted: false,
      },
      {
        value: { ...unresolved, outcome: 'reconciled', retainsTargetLock: false },
        accepted: false,
      },
    ]);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...unresolved,
        outcome: 'reconciled',
        retainsTargetLock: false,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryRequestSchema.safeParse({
        ...request,
        mode: 'abandon',
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryRequestSchema.safeParse({
        ...request,
        replacementLease: { ...replacementLease, leaseId: lease.leaseId },
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...ack,
        evidence: {
          ...ack.evidence,
          currentState: hashContent({
            ...Object.fromEntries(
              Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
            ),
            pointerDomainSha256: 'f'.repeat(64),
          }),
        },
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...ack,
        evidence: {
          ...ack.evidence,
          currentState: hashContent({
            ...Object.fromEntries(
              Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
            ),
            sequence: currentState.sequence + 1,
          }),
        },
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackExecutionRecoveryAckSchema.safeParse({
        ...ack,
        request: { ...request, source: 'document_authority_drift' },
      }).success,
    ).toBe(false);
  }, 20_000);

  it('rejects hostile persisted managed-terminal recovery acknowledgements', () => {
    const { binding, delivery, lease } = fixture();
    const commit = sixPhaseChain()[5];
    if (commit?.phase !== 'commit_intent_recorded') throw new Error('expected commit');
    const managedStart = hashContent({
      managedStartId: ids.managedStart,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      previousProgressContentSha256: commit.contentSha256,
      startedAt: '2026-08-22T10:00:21Z',
    });
    const terminalResult = companionExecutionTrackExecutionResultSchema.parse({
      ...resultIdentity('2026-08-22T10:00:22Z', commit.currentLease),
      status: 'succeeded',
      startCheckpointId: ids.checkpoint,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      lastProgressContentSha256: commit.contentSha256,
      managedStart,
      managedReport: {
        reportId: preflightIds.report,
        sequence: 8,
        transition: 'step_succeeded',
        stepId: binding.leafId,
        contentSha256: '1'.repeat(64),
      },
      managedCheckpoint: {
        checkpointId: '90000000-0000-4000-8000-000000000030',
        previousCheckpointId: ids.checkpoint,
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
    const terminalResultContentSha256 = computeProtocolCanonicalJsonSha256(terminalResult);
    const managedIdentity = {
      viewLayerIdentitySha256: '5'.repeat(64),
      objectIdentitySha256: '6'.repeat(64),
      meshIdentitySha256: '7'.repeat(64),
      collectionIdentitySha256: '8'.repeat(64),
      sessionUidDomainSha256: '9'.repeat(64),
      pointerDomainSha256: '0'.repeat(64),
      linksAndSelectionSha256: 'a'.repeat(64),
    };
    const terminalMarker = hashContent({
      kind: 'persisted_managed_terminal',
      terminalStatus: 'succeeded',
      terminalResultContentSha256,
      managedReportId: terminalResult.managedReport.reportId,
      managedReportSequence: terminalResult.managedReport.sequence,
      managedCheckpointId: terminalResult.managedCheckpoint.checkpointId,
      sceneFingerprintSha256: '4'.repeat(64),
      ...managedIdentity,
    });
    const replacementLease = {
      ...lease,
      leaseId: ids.replacementLease,
      expiresAt: '2026-08-22T10:10:00Z',
    };
    const durableReferences = {
      terminalMarkerContentSha256: null,
      managedStartContentSha256: managedStart.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
    };
    const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      formatVersion: '2.0.0',
      recoveryId: ids.recovery,
      requestId: binding.requestId,
      target: binding.target,
      originalDeliveryId: delivery.deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      originalLease: lease,
      replacementLease,
      acceptedProgress: commit,
      acceptedProgressChainHeadContentSha256: commit.contentSha256,
      durableReferences,
      source: 'coordinator_restart',
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt: '2026-08-22T10:05:00Z',
    });
    const currentState = hashContent({
      replacementLeaseId: replacementLease.leaseId,
      sessionId: replacementLease.sessionId,
      documentIncarnationId: replacementLease.documentIncarnationId,
      reportId: terminalResult.managedReport.reportId,
      sequence: terminalResult.managedReport.sequence,
      sceneFingerprintSha256: terminalMarker.sceneFingerprintSha256,
      ...managedIdentity,
      observedAt: '2026-08-22T10:05:01Z',
    });
    const ack = {
      formatVersion: '2.0.0',
      request,
      recoveryId: request.recoveryId,
      requestId: request.requestId,
      originalDeliveryId: request.originalDeliveryId,
      bindingContentSha256: request.bindingContentSha256,
      replacementLeaseId: replacementLease.leaseId,
      acceptedProgressChainHeadContentSha256: commit.contentSha256,
      durableReferences,
      outcome: 'reconciled',
      evidence: {
        kind: 'persisted_managed_terminal',
        terminalResult,
        terminalResultContentSha256,
        terminalMarker,
        currentState,
      },
      retainsTargetLock: false,
      automaticReplay: false,
      occurredAt: '2026-08-22T10:05:01Z',
    } as const;
    expect(companionExecutionTrackExecutionRecoveryAckSchema.parse(ack)).toEqual(ack);

    const terminalMarkerContent = Object.fromEntries(
      Object.entries(terminalMarker).filter(([key]) => key !== 'contentSha256'),
    );
    const rehashTerminalMarker = (patch: Record<string, unknown>) =>
      hashContent({ ...terminalMarkerContent, ...patch });
    const withTerminalMarker = (mutatedMarker: ReturnType<typeof rehashTerminalMarker>) => {
      const mutatedDurableReferences = {
        ...durableReferences,
        terminalMarkerContentSha256: mutatedMarker.contentSha256,
      };
      return {
        ...ack,
        request: { ...request, durableReferences: mutatedDurableReferences },
        durableReferences: mutatedDurableReferences,
        evidence: { ...ack.evidence, terminalMarker: mutatedMarker },
      };
    };
    const withTerminalResult = (mutatedResult: typeof terminalResult) => {
      const mutatedResultHash = computeProtocolCanonicalJsonSha256(mutatedResult);
      const mutatedAck = withTerminalMarker(
        rehashTerminalMarker({ terminalResultContentSha256: mutatedResultHash }),
      );
      return {
        ...mutatedAck,
        evidence: {
          ...mutatedAck.evidence,
          terminalResult: mutatedResult,
          terminalResultContentSha256: mutatedResultHash,
        },
      };
    };
    const equalSequenceResult = {
      ...terminalResult,
      managedReport: {
        ...terminalResult.managedReport,
        sequence: binding.expectedState.sequence,
      },
    };
    const equalSequenceResultHash = computeProtocolCanonicalJsonSha256(equalSequenceResult);
    const equalSequenceAck = withTerminalMarker(
      rehashTerminalMarker({
        terminalResultContentSha256: equalSequenceResultHash,
        managedReportSequence: binding.expectedState.sequence,
      }),
    );
    const equalSequenceCurrentState = hashContent({
      ...Object.fromEntries(
        Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
      ),
      sequence: binding.expectedState.sequence,
    });

    const hostileAcks: Array<{ name: string; value: unknown }> = [
      {
        name: 'managed report did not advance expected state',
        value: {
          ...equalSequenceAck,
          evidence: {
            ...equalSequenceAck.evidence,
            terminalResult: equalSequenceResult,
            terminalResultContentSha256: equalSequenceResultHash,
            currentState: equalSequenceCurrentState,
          },
        },
      },
      {
        name: 'terminal produced after recovery challenge',
        value: {
          ...ack,
          request: { ...request, requestedAt: '2026-08-22T10:00:21.500Z' },
        },
      },
      {
        name: 'persisted terminal without accepted managed start',
        value: {
          ...ack,
          request: {
            ...request,
            durableReferences: { ...durableReferences, managedStartContentSha256: null },
          },
          durableReferences: { ...durableReferences, managedStartContentSha256: null },
        },
      },
      {
        name: 'wrong accepted managed start',
        value: {
          ...ack,
          request: {
            ...request,
            durableReferences: {
              ...durableReferences,
              managedStartContentSha256: 'f'.repeat(64),
            },
          },
          durableReferences: {
            ...durableReferences,
            managedStartContentSha256: 'f'.repeat(64),
          },
        },
      },
      {
        name: 'terminal marker hash',
        value: {
          ...ack,
          evidence: {
            ...ack.evidence,
            terminalMarker: { ...terminalMarker, contentSha256: 'f'.repeat(64) },
          },
        },
      },
      {
        name: 'terminal result hash',
        value: {
          ...ack,
          evidence: { ...ack.evidence, terminalResultContentSha256: 'f'.repeat(64) },
        },
      },
      {
        name: 'managed report id',
        value: withTerminalMarker(rehashTerminalMarker({ managedReportId: ids.proof })),
      },
      {
        name: 'managed report sequence',
        value: withTerminalMarker(rehashTerminalMarker({ managedReportSequence: 9 })),
      },
      {
        name: 'managed checkpoint',
        value: withTerminalMarker(rehashTerminalMarker({ managedCheckpointId: ids.undoLock })),
      },
      {
        name: 'managed scene',
        value: withTerminalMarker(rehashTerminalMarker({ sceneFingerprintSha256: 'f'.repeat(64) })),
      },
      {
        name: 'current state report id',
        value: {
          ...ack,
          evidence: {
            ...ack.evidence,
            currentState: hashContent({
              ...Object.fromEntries(
                Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
              ),
              reportId: ids.proof,
            }),
          },
        },
      },
      {
        name: 'current state sequence',
        value: {
          ...ack,
          evidence: {
            ...ack.evidence,
            currentState: hashContent({
              ...Object.fromEntries(
                Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
              ),
              sequence: currentState.sequence + 1,
            }),
          },
        },
      },
      {
        name: 'current lease id',
        value: withTerminalResult({
          ...terminalResult,
          currentLease: { ...terminalResult.currentLease, leaseId: ids.replacementLease },
        }),
      },
      {
        name: 'current lease session id',
        value: withTerminalResult({
          ...terminalResult,
          currentLease: { ...terminalResult.currentLease, sessionId: ids.replacementLease },
        }),
      },
      {
        name: 'current lease document incarnation id',
        value: withTerminalResult({
          ...terminalResult,
          currentLease: {
            ...terminalResult.currentLease,
            documentIncarnationId: ids.replacementLease,
          },
        }),
      },
      {
        name: 'current lease expiry rollback',
        value: withTerminalResult({
          ...terminalResult,
          currentLease: { ...terminalResult.currentLease, expiresAt: '2026-08-22T10:00:23Z' },
        }),
      },
      {
        name: 'current lease already expired',
        value: withTerminalResult({
          ...terminalResult,
          currentLease: { ...terminalResult.currentLease, expiresAt: terminalResult.occurredAt },
        }),
      },
      {
        name: 'current state before recovery request',
        value: {
          ...ack,
          evidence: {
            ...ack.evidence,
            currentState: hashContent({
              ...Object.fromEntries(
                Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
              ),
              observedAt: '2026-08-22T10:04:59Z',
            }),
          },
        },
      },
      {
        name: 'current state after acknowledgement',
        value: {
          ...ack,
          evidence: {
            ...ack.evidence,
            currentState: hashContent({
              ...Object.fromEntries(
                Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
              ),
              observedAt: '2026-08-22T10:05:02Z',
            }),
          },
        },
      },
      {
        name: 'durable terminal marker',
        value: {
          ...ack,
          request: {
            ...request,
            durableReferences: {
              ...durableReferences,
              terminalMarkerContentSha256: 'f'.repeat(64),
            },
          },
          durableReferences: {
            ...durableReferences,
            terminalMarkerContentSha256: 'f'.repeat(64),
          },
        },
      },
    ];
    for (const identityField of Object.keys(managedIdentity) as Array<
      keyof typeof managedIdentity
    >) {
      hostileAcks.push(
        {
          name: `terminal marker ${identityField}`,
          value: {
            ...withTerminalMarker(rehashTerminalMarker({ [identityField]: 'f'.repeat(64) })),
          },
        },
        {
          name: `current state ${identityField}`,
          value: {
            ...ack,
            evidence: {
              ...ack.evidence,
              currentState: hashContent({
                ...Object.fromEntries(
                  Object.entries(currentState).filter(([key]) => key !== 'contentSha256'),
                ),
                [identityField]: 'f'.repeat(64),
              }),
            },
          },
        },
      );
    }
    for (const hostile of hostileAcks) {
      expect(
        companionExecutionTrackExecutionRecoveryAckSchema.safeParse(hostile.value).success,
        `accepted hostile ${hostile.name}`,
      ).toBe(false);
    }
  });

  it('exports strict public schemas and preserves v1 preflight parsing', async () => {
    const { binding, delivery, request } = fixture();
    const chain = sixPhaseChain();
    const failedNoMutation = companionExecutionTrackExecutionResultSchema.parse({
      ...resultIdentity('2026-08-22T10:00:03Z', chain[0]!.currentLease),
      status: 'failed_no_mutation',
      startCheckpointId:
        chain[0]!.phase === 'baseline_attested'
          ? chain[0].startCheckpoint.checkpointId
          : ids.checkpoint,
      baselineAttestationContentSha256:
        chain[0]!.phase === 'baseline_attested'
          ? chain[0].startAttestation.contentSha256
          : 'a'.repeat(64),
      lastProgressContentSha256: chain[0]!.contentSha256,
      error: 'No mutation.',
    });
    const recoveryLease = {
      ...delivery.lease,
      leaseId: ids.replacementLease,
      expiresAt: '2026-08-22T10:10:00Z',
    };
    const recoveryRequest = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
      formatVersion: '2.0.0',
      recoveryId: ids.recovery,
      requestId: binding.requestId,
      target: binding.target,
      originalDeliveryId: delivery.deliveryId,
      bindingContentSha256: binding.bindingContentSha256,
      originalLease: delivery.lease,
      replacementLease: recoveryLease,
      acceptedProgress: chain[0],
      acceptedProgressChainHeadContentSha256: chain[0]!.contentSha256,
      durableReferences: {
        terminalMarkerContentSha256: null,
        managedStartContentSha256: null,
        baselineContentSha256: null,
        commitIntentId: null,
        commitIntentContentSha256: null,
      },
      source: 'coordinator_restart',
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt: '2026-08-22T10:05:00Z',
    });
    const recoveryStart = chain[0];
    if (recoveryStart?.phase !== 'baseline_attested') throw new Error('expected baseline');
    const recoveryCurrentState = hashContent({
      replacementLeaseId: recoveryLease.leaseId,
      sessionId: recoveryLease.sessionId,
      documentIncarnationId: recoveryLease.documentIncarnationId,
      reportId: recoveryStart.startAttestation.reportId,
      sequence: recoveryStart.startAttestation.sequence,
      sceneFingerprintSha256: recoveryStart.startAttestation.sceneFingerprintSha256,
      ...recoveryStart.startAttestation.identitySnapshot,
      observedAt: '2026-08-22T10:05:01Z',
    });
    const commit = chain[5];
    if (commit?.phase !== 'commit_intent_recorded') throw new Error('expected commit');
    const managedStart = hashContent({
      managedStartId: ids.managedStart,
      commitIntentId: commit.intent.intentId,
      commitIntentContentSha256: commit.intent.contentSha256,
      baselineContentSha256: commit.baseline.contentSha256,
      proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
      previousProgressContentSha256: commit.contentSha256,
      startedAt: '2026-08-22T10:00:21Z',
    });
    const cases = [
      ['create-request', request],
      ['binding', binding],
      ['baseline-identity', chain[4]!.phase === 'baseline_restored' ? chain[4].baseline : {}],
      ['delivery', delivery],
      [
        'managed-start-submission',
        {
          formatVersion: '2.0.0',
          requestId: binding.requestId,
          deliveryId: delivery.deliveryId,
          bindingContentSha256: binding.bindingContentSha256,
          currentLease: commit.currentLease,
          commitProgress: commit,
          managedStart,
        },
      ],
      ['managed-start-ack', { result: 'accepted' }],
      ['progress', chain[0]],
      ['progress-transition', { previous: chain[0], next: chain[1] }],
      ['progress-chain', chain],
      ['progress-ack', { result: 'accepted' }],
      ['result', failedNoMutation],
      ['result-ack', { result: 'duplicate' }],
      ['status-request', { requestId: binding.requestId }],
      [
        'status',
        {
          binding,
          deliveryId: delivery.deliveryId,
          lease: delivery.lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'failed_no_mutation',
          progress: chain[0],
          result: failedNoMutation,
          updatedAt: failedNoMutation.occurredAt,
        },
      ],
      ['poll-request', binding.target],
      ['poll-delivery', { request: delivery }],
      ['recovery-request', recoveryRequest],
      ['recovery-poll-delivery', { request: recoveryRequest }],
      ['recovery-poll-delivery', { request: null }],
      [
        'recovery-ack',
        {
          formatVersion: '2.0.0',
          request: recoveryRequest,
          recoveryId: recoveryRequest.recoveryId,
          requestId: recoveryRequest.requestId,
          originalDeliveryId: recoveryRequest.originalDeliveryId,
          bindingContentSha256: recoveryRequest.bindingContentSha256,
          replacementLeaseId: recoveryRequest.replacementLease.leaseId,
          acceptedProgressChainHeadContentSha256:
            recoveryRequest.acceptedProgressChainHeadContentSha256,
          durableReferences: recoveryRequest.durableReferences,
          outcome: 'reconciled',
          evidence: {
            kind: 'baseline_terminal',
            terminalResult: failedNoMutation,
            terminalResultContentSha256: computeProtocolCanonicalJsonSha256(failedNoMutation),
            progress: recoveryStart,
            currentState: recoveryCurrentState,
          },
          retainsTargetLock: false,
          automaticReplay: false,
          occurredAt: '2026-08-22T10:05:01Z',
        },
      ],
    ] as const;
    for (const [kind, value] of cases) {
      const filename = `companion-execution-track-execution-${kind}.schema.json`;
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      await validatePublicJsonSchemaCases(schema, [
        { value, accepted: true },
        { value: { ...value, extra: true }, accepted: false },
      ]);
    }
    const managedStartSubmissionJsonSchema = JSON.parse(
      readFileSync(
        resolve(
          'protocol/schemas/v1',
          'companion-execution-track-execution-managed-start-submission.schema.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    await validatePublicJsonSchemaCases(managedStartSubmissionJsonSchema, [
      {
        value: {
          formatVersion: '2.0.0',
          requestId: binding.requestId,
          deliveryId: delivery.deliveryId,
          bindingContentSha256: binding.bindingContentSha256,
          currentLease: commit.currentLease,
          commitProgress: chain[0],
          managedStart,
        },
        accepted: false,
      },
    ]);
    const statusJsonSchema = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1', 'companion-execution-track-execution-status.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const preDispatchAuthorityExpirationEvidence = {
      source: 'document_authority_drift',
      requestId: binding.requestId,
      bindingContentSha256: binding.bindingContentSha256,
      target: binding.target,
      priorStatus: 'queued',
      detectedAt: '2026-08-22T10:00:01Z',
      resolution: 'pre_dispatch_authority_expired',
      retainsTargetLock: false,
      automaticReplay: false,
    } as const;
    await validatePublicJsonSchemaCases(statusJsonSchema, [
      {
        value: {
          binding,
          status: 'pre_dispatch_authority_expired',
          preDispatchAuthorityExpirationEvidence,
          updatedAt: preDispatchAuthorityExpirationEvidence.detectedAt,
        },
        accepted: true,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          status: 'pre_dispatch_authority_expired',
          preDispatchAuthorityExpirationEvidence,
          updatedAt: preDispatchAuthorityExpirationEvidence.detectedAt,
        },
        accepted: false,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          lease: delivery.lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'baseline_attested',
          updatedAt: chain[0]!.occurredAt,
        },
        accepted: false,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          status: 'dispatched',
          updatedAt: delivery.dispatchedAt,
        },
        accepted: false,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          lease: delivery.lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'dispatched',
          progress: chain[0],
          updatedAt: chain[0]!.occurredAt,
        },
        accepted: false,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          lease: delivery.lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'baseline_attested',
          progress: chain[0],
          result: failedNoMutation,
          updatedAt: failedNoMutation.occurredAt,
        },
        accepted: false,
      },
      {
        value: {
          binding,
          deliveryId: delivery.deliveryId,
          lease: delivery.lease,
          dispatchedAt: delivery.dispatchedAt,
          status: 'failed_no_mutation',
          progress: chain[0],
          result: failedNoMutation,
          serverRecoveryEvidence: {
            source: 'coordinator_restart',
            requestId: binding.requestId,
            deliveryId: delivery.deliveryId,
            bindingContentSha256: binding.bindingContentSha256,
            target: binding.target,
            leaseId: delivery.lease.leaseId,
            sessionId: delivery.lease.sessionId,
            documentIncarnationId: delivery.lease.documentIncarnationId,
            acceptedProgressChainHeadContentSha256: chain[0]!.contentSha256,
            durableReferences: {
              terminalMarkerContentSha256: null,
              managedStartContentSha256: null,
              baselineContentSha256: null,
              commitIntentId: null,
              commitIntentContentSha256: null,
            },
            priorStatus: 'baseline_attested',
            detectedAt: failedNoMutation.occurredAt,
            resolution: 'recovery_required',
            retainsTargetLock: true,
            automaticReplay: false,
          },
          updatedAt: failedNoMutation.occurredAt,
        },
        accepted: false,
      },
    ]);
    const existing = executionTrackPreflightFixture();
    expect(companionExecutionTrackPreflightBindingSchema.parse(existing.binding)).toEqual(
      existing.binding,
    );
  }, 20_000);
});
