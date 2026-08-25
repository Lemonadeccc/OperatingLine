import {
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionCreateRequestSchema,
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionResultSchema,
  companionStateReportSchema,
  computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
  computeProtocolCanonicalJsonSha256,
  guideProtocolVersion,
  type CompanionNativeUndoCheckpoint,
  type CompanionExecutionTrackExecutionDelivery,
  type CompanionExecutionTrackExecutionProgress,
} from '@operatingline/protocol';
import type { companionExecutionTrackExecutionRecoveryRequestSchema } from '@operatingline/protocol';

import { executionTrackPreflightFixture } from '../unit/support/execution-track-preflight-fixture.js';

export function managedExecutionTrackBinding() {
  const preflight = executionTrackPreflightFixture();
  const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
    ...preflight.request,
    formatVersion: '2.0.0',
  });
  const startCheckpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: '90000000-0000-4000-8000-000000000003',
    previousCheckpointId: null,
    operation: 'start',
    committedAt: '2026-08-22T09:59:59Z',
    marker: { key: '_operating_line_native_history_v1', matched: true },
    journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
    session: {
      plan: { id: request.plan.id, revision: request.plan.revision },
      planContentSha256: request.plan.contentSha256,
      executionId: request.executionId,
      activeStepId: null,
      completedStepIds: [],
      receiptStepIds: [],
    },
  } as const;
  const startReport = companionStateReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    reportId: request.expectedState.reportId,
    sequence: request.expectedState.sequence,
    adapterId: request.target.adapterId,
    instanceId: request.target.instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: request.plan.id, revision: request.plan.revision },
    planContentSha256: request.plan.contentSha256,
    executionId: request.executionId,
    phase: 'running',
    activeStepId: null,
    completedStepIds: [],
    transition: 'walkthrough_started',
    stepId: null,
    observations: [],
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: startCheckpoint,
    error: null,
    occurredAt: '2026-08-22T10:00:00Z',
  });
  const content = {
    ...request,
    proofId: '90000000-0000-4000-8000-000000000002',
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
      kind: 'single_leaf',
      leafId: request.leafId,
      procedureTreeContentSha256: preflight.binding.artifacts.procedureTreeContentSha256,
    },
    authorizedStartState: {
      reportContentSha256: computeProtocolCanonicalJsonSha256(startReport),
      checkpoint: {
        checkpointId: startCheckpoint.checkpointId,
        previousCheckpointId: startCheckpoint.previousCheckpointId,
        operation: startCheckpoint.operation,
        contentSha256: computeProtocolCanonicalJsonSha256(startCheckpoint),
      },
      activeStepId: startCheckpoint.session.activeStepId,
      completedStepIds: startCheckpoint.session.completedStepIds,
      receiptStepIds: startCheckpoint.session.receiptStepIds,
      successPhase: 'completed',
    },
    requestedAt: preflight.binding.requestedAt,
  } as const;
  return companionExecutionTrackExecutionBindingSchema.parse({
    ...content,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(content),
  });
}

export function hashScenarioContent<T extends Record<string, unknown>>(content: T) {
  return { ...content, contentSha256: computeProtocolCanonicalJsonSha256(content) };
}

export type ManagedExecutionTrackTimeline = (offsetMilliseconds: number) => string;

export function managedExecutionTrackTimeline(startedAt: string): ManagedExecutionTrackTimeline {
  const start = Date.parse(startedAt);
  return (offsetMilliseconds) => new Date(start + offsetMilliseconds).toISOString();
}

export function managedExecutionTrackBaseline(
  delivery: CompanionExecutionTrackExecutionDelivery,
  timeline?: ManagedExecutionTrackTimeline,
  authorizedStartCheckpoint?: CompanionNativeUndoCheckpoint,
) {
  const checkpoint =
    authorizedStartCheckpoint ??
    ({
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: '90000000-0000-4000-8000-000000000003',
      previousCheckpointId: null,
      operation: 'start',
      committedAt: '2026-08-22T09:59:59Z',
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
      session: {
        plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
        planContentSha256: delivery.binding.plan.contentSha256,
        executionId: delivery.binding.executionId,
        activeStepId: null,
        completedStepIds: [],
        receiptStepIds: [],
      },
    } as const);
  const startAttestation = hashScenarioContent({
    checkpointId: checkpoint.checkpointId,
    reportId: delivery.binding.expectedState.reportId,
    sequence: delivery.binding.expectedState.sequence,
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
    documentIncarnationId: delivery.lease.documentIncarnationId,
    sessionId: delivery.lease.sessionId,
    leaseId: delivery.lease.leaseId,
    attestedAt: timeline?.(2) ?? '2026-08-22T10:00:02Z',
  });
  return companionExecutionTrackExecutionProgressSchema.parse(
    hashScenarioContent({
      ...delivery,
      currentLease: delivery.lease,
      phase: 'baseline_attested',
      sequence: 1,
      previousProgressContentSha256: null,
      occurredAt: timeline?.(2) ?? '2026-08-22T10:00:02Z',
      startCheckpoint: checkpoint,
      startAttestation,
    }),
  );
}

const receiptSpecs = [
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

export function managedExecutionTrackProgressTail(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
  timeline?: ManagedExecutionTrackTimeline,
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  let previousReceiptContentSha256: string | null = null;
  const receipts = receiptSpecs.map(([operationId, summary], index) => {
    const content = {
      receiptId: `90000000-0000-4000-8000-00000000002${index}`,
      proofId: delivery.binding.proofId,
      requestId: delivery.binding.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: delivery.binding.bindingContentSha256,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: timeline?.(3 + index) ?? `2026-08-22T10:00:0${index + 3}Z`,
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
  const baselineReferences = {
    startCheckpointId: baseline.startCheckpoint.checkpointId,
    startAttestationContentSha256: baseline.startAttestation.contentSha256,
    baselineSceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
  };
  const makeProgress = (
    phase: string,
    sequence: number,
    previousProgressContentSha256: string,
    occurredAt: string,
    evidence: Record<string, unknown>,
  ) =>
    companionExecutionTrackExecutionProgressSchema.parse(
      hashScenarioContent({
        ...delivery,
        currentLease: delivery.lease,
        phase,
        sequence,
        previousProgressContentSha256,
        ...evidence,
        occurredAt,
      }),
    );
  const proof = makeProgress(
    'proof_in_progress',
    2,
    baseline.contentSha256,
    timeline?.(9) ?? '2026-08-22T10:00:09Z',
    {
      ...baselineReferences,
      proofReceipts: receipts,
      completedOperationIds: receipts.map((receipt) => receipt.operationId),
    },
  );
  const observation = hashScenarioContent({
    kind: 'uv_sphere_menu_controls_ready',
    satisfied: true,
    observationId: '90000000-0000-4000-8000-000000000006',
    objectName: 'OperatingLine.TutorialEye',
    objectType: 'MESH',
    location: [1.25, -2, 0.75],
    scale: [1.5, 1.5, 1.5],
    meshTopology: { vertices: 482, edges: 992, polygons: 512 },
    meshSha256: '4'.repeat(64),
    sceneFingerprintSha256: '5'.repeat(64),
    observedAt: timeline?.(10) ?? '2026-08-22T10:00:10Z',
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
      checkpointId: '90000000-0000-4000-8000-000000000007',
      undoLockId: '90000000-0000-4000-8000-000000000008',
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
      baselineSceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
      finalSceneFingerprintSha256: observation.sceneFingerprintSha256,
      restoredSceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
      reappliedSceneFingerprintSha256: observation.sceneFingerprintSha256,
      receiptChainRootSha256: receipts[0]!.contentSha256,
      receiptChainHeadSha256: receipts.at(-1)!.contentSha256,
      strongObservationContentSha256: observation.contentSha256,
      committedAt: timeline?.(11) ?? '2026-08-22T10:00:11Z',
    },
    managedActionExecuted: false,
    managedIdentityVerified: false,
    managedReceiptCreated: false,
  } as const;
  const evidence = {
    ...proofEvidenceContent,
    proofEvidenceContentSha256: computeProtocolCanonicalJsonSha256(proofEvidenceContent),
  };
  const observed = makeProgress(
    'proof_observed_locked',
    3,
    proof.contentSha256,
    timeline?.(11) ?? '2026-08-22T10:00:11Z',
    { ...baselineReferences, evidence },
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
    baseline.startAttestation.sceneFingerprintSha256,
  ];
  const transitions = Array.from({ length: 8 }, (_, index) =>
    hashScenarioContent({
      order: index + 1,
      operation: 'native_undo',
      fromCursor: 8 - index,
      toCursor: 7 - index,
      beforeSceneFingerprintSha256: fingerprints[index],
      afterSceneFingerprintSha256: fingerprints[index + 1],
      occurredAt:
        timeline?.(12 + index) ?? `2026-08-22T10:00:${String(index + 12).padStart(2, '0')}Z`,
    }),
  );
  const proofReferences = {
    proofEvidenceContentSha256: evidence.proofEvidenceContentSha256,
    proofCheckpointId: '90000000-0000-4000-8000-000000000007',
    undoLockId: '90000000-0000-4000-8000-000000000008',
    proofFinalSceneFingerprintSha256: observation.sceneFingerprintSha256,
  };
  const restoring = makeProgress(
    'restore_in_progress',
    4,
    observed.contentSha256,
    timeline?.(12) ?? '2026-08-22T10:00:12Z',
    {
      ...baselineReferences,
      ...proofReferences,
      transitions: transitions.slice(0, 1),
      nativeHistoryCursor: 7,
    },
  );
  const baselineIdentity = hashScenarioContent({
    sceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
    ...baseline.startAttestation.identitySnapshot,
    startReportId: baseline.startAttestation.reportId,
    startCheckpointId: baseline.startCheckpoint.checkpointId,
    startAttestationContentSha256: baseline.startAttestation.contentSha256,
    sessionId: delivery.lease.sessionId,
    documentIncarnationId: delivery.lease.documentIncarnationId,
  });
  const restored = makeProgress(
    'baseline_restored',
    5,
    restoring.contentSha256,
    timeline?.(19) ?? '2026-08-22T10:00:19Z',
    {
      ...proofReferences,
      transitions,
      nativeHistoryCursor: 0,
      undoChainHeadContentSha256: transitions.at(-1)!.contentSha256,
      baseline: baselineIdentity,
    },
  );
  const redoBarrier = hashScenarioContent({
    evidenceClass: 'companion_reported_native_redo_barrier',
    method: 'view3d_ed_undo_push',
    message: 'OperatingLine supersede restored menu proof',
    proofCheckpointId: proofReferences.proofCheckpointId,
    undoLockId: proofReferences.undoLockId,
    proofEvidenceContentSha256: proofReferences.proofEvidenceContentSha256,
    proofTerminalMarkerContentSha256:
      computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256({
        formatVersion: '2.0.0',
        kind: 'proof_terminal_marker',
        proofId: delivery.binding.proofId,
        bindingContentSha256: delivery.binding.bindingContentSha256,
        proofCheckpointId: proofReferences.proofCheckpointId,
        undoLockId: proofReferences.undoLockId,
        baselineSceneFingerprintSha256: baselineIdentity.sceneFingerprintSha256,
        finalSceneFingerprintSha256: proofReferences.proofFinalSceneFingerprintSha256,
        proofEvidenceContentSha256: proofReferences.proofEvidenceContentSha256,
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
    verifiedAt: timeline?.(20) ?? '2026-08-22T10:00:20Z',
  });
  const intent = hashScenarioContent({
    intentId: '90000000-0000-4000-8000-000000000005',
    action: delivery.binding.preflightBinding.action,
    baselineContentSha256: baselineIdentity.contentSha256,
    redoBarrier,
    managedActionExecuted: false,
    managedReceiptCreated: false,
    recordedAt: timeline?.(20) ?? '2026-08-22T10:00:20Z',
  });
  const commit = makeProgress(
    'commit_intent_recorded',
    6,
    restored.contentSha256,
    timeline?.(20) ?? '2026-08-22T10:00:20Z',
    {
      ...proofReferences,
      undoChainHeadContentSha256: transitions.at(-1)!.contentSha256,
      baseline: baselineIdentity,
      intent,
    },
  );
  return [proof, observed, restoring, restored, commit] as const;
}

export function managedExecutionTrackManagedStart(
  delivery: CompanionExecutionTrackExecutionDelivery,
  commit: CompanionExecutionTrackExecutionProgress,
  timeline?: ManagedExecutionTrackTimeline,
) {
  if (commit.phase !== 'commit_intent_recorded') throw new Error('expected commit progress');
  const managedStart = hashScenarioContent({
    managedStartId: '90000000-0000-4000-8000-000000000009',
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
    previousProgressContentSha256: commit.contentSha256,
    startedAt: timeline?.(21) ?? '2026-08-22T10:00:21Z',
  });
  return companionExecutionTrackExecutionManagedStartSubmissionSchema.parse({
    formatVersion: '2.0.0',
    requestId: delivery.binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: delivery.binding.bindingContentSha256,
    currentLease: commit.currentLease,
    commitProgress: commit,
    managedStart,
  });
}

export function managedExecutionTrackStartReport(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  return companionStateReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    reportId: delivery.binding.expectedState.reportId,
    sequence: delivery.binding.expectedState.sequence,
    adapterId: delivery.binding.target.adapterId,
    instanceId: delivery.binding.target.instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
    planContentSha256: delivery.binding.plan.contentSha256,
    executionId: delivery.binding.executionId,
    phase: 'running',
    activeStepId: null,
    completedStepIds: [],
    transition: 'walkthrough_started',
    stepId: null,
    observations: [],
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: baseline.startCheckpoint,
    error: null,
    occurredAt: '2026-08-22T10:00:00Z',
  });
}

export function managedExecutionTrackSuccessReport(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
  options: {
    readonly reportId?: string;
    readonly sequence?: number;
    readonly occurredAt?: string;
    readonly checkpointId?: string;
    readonly phase?: 'running' | 'completed';
  } = {},
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  const occurredAt = options.occurredAt ?? '2026-08-22T10:00:23Z';
  const completedStepIds = [
    ...baseline.startCheckpoint.session.completedStepIds,
    delivery.binding.leafId,
  ];
  const receiptStepIds = [
    ...baseline.startCheckpoint.session.receiptStepIds,
    delivery.binding.leafId,
  ];
  return companionStateReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    reportId: options.reportId ?? '90000000-0000-4000-8000-000000000010',
    sequence: options.sequence ?? delivery.binding.expectedState.sequence + 1,
    adapterId: delivery.binding.target.adapterId,
    instanceId: delivery.binding.target.instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
    planContentSha256: delivery.binding.plan.contentSha256,
    executionId: delivery.binding.executionId,
    phase: options.phase ?? 'completed',
    activeStepId: delivery.binding.leafId,
    completedStepIds,
    transition: 'step_succeeded',
    stepId: delivery.binding.leafId,
    observations: [
      {
        kind: 'uv_sphere_ready',
        satisfied: true,
        details: delivery.binding.preflightBinding.step.expectedObservations[0]!.parameters,
      },
    ],
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: options.checkpointId ?? '90000000-0000-4000-8000-000000000030',
      previousCheckpointId: baseline.startCheckpoint.checkpointId,
      operation: 'next',
      committedAt: occurredAt,
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
      session: {
        plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
        planContentSha256: delivery.binding.plan.contentSha256,
        executionId: delivery.binding.executionId,
        activeStepId: delivery.binding.leafId,
        completedStepIds,
        receiptStepIds,
      },
    },
    error: null,
    occurredAt,
  });
}

export function managedExecutionTrackSuccessResult(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
  commit: CompanionExecutionTrackExecutionProgress,
  submission: ReturnType<typeof managedExecutionTrackManagedStart>,
  report: ReturnType<typeof managedExecutionTrackSuccessReport>,
  occurredAt = '2026-08-22T10:00:24Z',
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  if (commit.phase !== 'commit_intent_recorded') throw new Error('expected commit progress');
  const checkpoint = report.nativeUndoCheckpoint;
  if (checkpoint === undefined) throw new Error('expected managed checkpoint');
  const observation = report.observations[0];
  if (observation === undefined) throw new Error('expected managed observation');
  return companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: delivery.binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: delivery.binding.bindingContentSha256,
    target: delivery.binding.target,
    leaseId: delivery.lease.leaseId,
    currentLease: submission.currentLease,
    proposalId: delivery.binding.proposalId,
    planId: delivery.binding.plan.id,
    planRevision: delivery.binding.plan.revision,
    executionId: delivery.binding.executionId,
    leafId: delivery.binding.leafId,
    occurredAt,
    status: 'succeeded',
    startCheckpointId: baseline.startCheckpoint.checkpointId,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
    lastProgressContentSha256: commit.contentSha256,
    managedStart: submission.managedStart,
    managedReport: {
      reportId: report.reportId,
      sequence: report.sequence,
      transition: report.transition,
      stepId: delivery.binding.leafId,
      contentSha256: computeProtocolCanonicalJsonSha256(report),
    },
    managedCheckpoint: {
      checkpointId: checkpoint.checkpointId,
      previousCheckpointId: checkpoint.previousCheckpointId,
      operation: checkpoint.operation,
      receiptStepIds: checkpoint.session.receiptStepIds,
      contentSha256: computeProtocolCanonicalJsonSha256(checkpoint),
    },
    managedObservation: {
      observationIndex: 0,
      kind: observation.kind,
      contentSha256: computeProtocolCanonicalJsonSha256(observation),
    },
  });
}

export function managedExecutionTrackFailureReport(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
  options: {
    readonly reportId?: string;
    readonly sequence?: number;
    readonly checkpointId?: string;
    readonly occurredAt?: string;
  } = {},
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  const occurredAt = options.occurredAt ?? '2026-08-22T10:00:23Z';
  const receiptStepIds = [
    ...baseline.startCheckpoint.session.receiptStepIds,
    delivery.binding.leafId,
  ];
  return companionStateReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    reportId: options.reportId ?? '90000000-0000-4000-8000-000000000050',
    sequence: options.sequence ?? delivery.binding.expectedState.sequence + 1,
    adapterId: delivery.binding.target.adapterId,
    instanceId: delivery.binding.target.instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
    planContentSha256: delivery.binding.plan.contentSha256,
    executionId: delivery.binding.executionId,
    phase: 'blocked',
    activeStepId: delivery.binding.leafId,
    completedStepIds: baseline.startCheckpoint.session.completedStepIds,
    transition: 'step_observation_failed',
    stepId: delivery.binding.leafId,
    observations: [
      {
        kind: 'uv_sphere_ready',
        satisfied: false,
        details: { reason: 'managed repair fixture failure' },
      },
    ],
    observationGate: {
      stepId: delivery.binding.leafId,
      status: 'repair_required',
      failureStrategy: 'retain_for_repair',
      message: 'Observation failed; retain the managed checkpoint for repair.',
    },
    artifactAttestation: null,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: options.checkpointId ?? '90000000-0000-4000-8000-000000000051',
      previousCheckpointId: baseline.startCheckpoint.checkpointId,
      operation: 'next',
      committedAt: occurredAt,
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
      session: {
        plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
        planContentSha256: delivery.binding.plan.contentSha256,
        executionId: delivery.binding.executionId,
        activeStepId: delivery.binding.leafId,
        completedStepIds: baseline.startCheckpoint.session.completedStepIds,
        receiptStepIds,
      },
    },
    error: null,
    occurredAt,
  });
}

export function managedExecutionTrackFailureResult(
  delivery: CompanionExecutionTrackExecutionDelivery,
  baseline: CompanionExecutionTrackExecutionProgress,
  commit: CompanionExecutionTrackExecutionProgress,
  submission: ReturnType<typeof managedExecutionTrackManagedStart>,
  report: ReturnType<typeof managedExecutionTrackFailureReport>,
  occurredAt = '2026-08-22T10:00:24Z',
) {
  if (baseline.phase !== 'baseline_attested') throw new Error('expected baseline progress');
  if (commit.phase !== 'commit_intent_recorded') throw new Error('expected commit progress');
  const checkpoint = report.nativeUndoCheckpoint;
  const observation = report.observations[0];
  const observationGate = report.observationGate;
  if (checkpoint === undefined || observation === undefined || observationGate === null)
    throw new Error('expected failure evidence');
  return companionExecutionTrackExecutionResultSchema.parse({
    formatVersion: '2.0.0',
    requestId: delivery.binding.requestId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: delivery.binding.bindingContentSha256,
    target: delivery.binding.target,
    leaseId: delivery.lease.leaseId,
    currentLease: submission.currentLease,
    proposalId: delivery.binding.proposalId,
    planId: delivery.binding.plan.id,
    planRevision: delivery.binding.plan.revision,
    executionId: delivery.binding.executionId,
    leafId: delivery.binding.leafId,
    occurredAt,
    status: 'failed_managed',
    startCheckpointId: baseline.startCheckpoint.checkpointId,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
    lastProgressContentSha256: commit.contentSha256,
    managedStart: submission.managedStart,
    managedReport: {
      reportId: report.reportId,
      sequence: report.sequence,
      transition: 'step_observation_failed',
      stepId: delivery.binding.leafId,
      contentSha256: computeProtocolCanonicalJsonSha256(report),
    },
    managedCheckpoint: {
      checkpointId: checkpoint.checkpointId,
      previousCheckpointId: checkpoint.previousCheckpointId,
      operation: 'next',
      receiptStepIds: checkpoint.session.receiptStepIds,
      contentSha256: computeProtocolCanonicalJsonSha256(checkpoint),
    },
    observationGate,
    failedObservation: {
      observationIndex: 0,
      kind: observation.kind,
      satisfied: false,
      contentSha256: computeProtocolCanonicalJsonSha256(observation),
    },
    retainsTargetLock: true,
    error: observationGate.message,
  });
}

const managedRepairIdentity = {
  sceneFingerprintSha256: '4'.repeat(64),
  viewLayerIdentitySha256: '5'.repeat(64),
  objectIdentitySha256: '6'.repeat(64),
  meshIdentitySha256: '7'.repeat(64),
  collectionIdentitySha256: '8'.repeat(64),
  sessionUidDomainSha256: '9'.repeat(64),
  pointerDomainSha256: '0'.repeat(64),
  linksAndSelectionSha256: 'a'.repeat(64),
} as const;

export function managedExecutionTrackFailedTerminalMarker(
  result: ReturnType<typeof managedExecutionTrackFailureResult>,
) {
  if (result.status !== 'failed_managed') throw new Error('expected failed managed result');
  const content = {
    kind: 'persisted_managed_terminal',
    terminalStatus: 'failed_managed',
    terminalResultContentSha256: computeProtocolCanonicalJsonSha256(result),
    managedReportId: result.managedReport.reportId,
    managedReportSequence: result.managedReport.sequence,
    managedCheckpointId: result.managedCheckpoint.checkpointId,
    failedObservationContentSha256: result.failedObservation.contentSha256,
    ...managedRepairIdentity,
  } as const;
  return companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema.parse(
    hashScenarioContent(content),
  );
}

export function managedExecutionTrackRecoveredReport(
  delivery: CompanionExecutionTrackExecutionDelivery,
  result: ReturnType<typeof managedExecutionTrackFailureResult>,
  options: {
    readonly reportId?: string;
    readonly checkpointId?: string;
    readonly observationAt?: string;
    readonly checkpointAt?: string;
    readonly reportAt?: string;
  } = {},
) {
  if (result.status !== 'failed_managed') throw new Error('expected failed managed result');
  const reportId = options.reportId ?? '90000000-0000-4000-8000-000000000052';
  const checkpointId = options.checkpointId ?? '90000000-0000-4000-8000-000000000053';
  const sequence = result.managedReport.sequence + 1;
  const completedStepIds = [
    ...delivery.binding.authorizedStartState.completedStepIds,
    delivery.binding.leafId,
  ];
  const strongObservation = hashScenarioContent({
    evidenceClass: 'managed_repair_strong_observation',
    observationIndex: result.failedObservation.observationIndex + 1,
    reportId,
    reportSequence: sequence,
    checkpointId,
    ...managedRepairIdentity,
    observedAt: options.observationAt ?? '2026-08-22T10:05:01Z',
  });
  return companionStateReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    reportId,
    sequence,
    adapterId: delivery.binding.target.adapterId,
    instanceId: delivery.binding.target.instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
    planContentSha256: delivery.binding.plan.contentSha256,
    executionId: delivery.binding.executionId,
    phase: delivery.binding.authorizedStartState.successPhase,
    activeStepId: delivery.binding.leafId,
    completedStepIds,
    transition: 'observation_recovered',
    stepId: delivery.binding.leafId,
    observations: [
      { kind: result.failedObservation.kind, satisfied: true, details: strongObservation },
    ],
    observationGate: {
      stepId: delivery.binding.leafId,
      status: 'recovered',
      failureStrategy: result.observationGate.failureStrategy,
      message: 'The retained managed observation was rechecked successfully.',
    },
    artifactAttestation: null,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId,
      previousCheckpointId: result.managedCheckpoint.checkpointId,
      operation: 'recheck',
      committedAt: options.checkpointAt ?? '2026-08-22T10:05:02Z',
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
      session: {
        plan: { id: delivery.binding.plan.id, revision: delivery.binding.plan.revision },
        planContentSha256: delivery.binding.plan.contentSha256,
        executionId: delivery.binding.executionId,
        activeStepId: delivery.binding.leafId,
        completedStepIds,
        receiptStepIds: result.managedCheckpoint.receiptStepIds,
      },
    },
    error: null,
    occurredAt: options.reportAt ?? '2026-08-22T10:05:03Z',
  });
}

type ManagedRecoveryRequest = ReturnType<
  typeof companionExecutionTrackExecutionRecoveryRequestSchema.parse
>;

export function managedExecutionTrackRepairCurrentState(
  request: ManagedRecoveryRequest,
  recoveredReport: ReturnType<typeof managedExecutionTrackRecoveredReport>,
  observedAt = '2026-08-22T10:05:04Z',
) {
  const details = recoveredReport.observations[0]?.details;
  if (details === undefined) throw new Error('expected recovered strong observation');
  return hashScenarioContent({
    authentication: 'replacement_lease_recovery_post',
    replacementLeaseId: request.replacementLease.leaseId,
    sessionId: request.replacementLease.sessionId,
    documentIncarnationId: request.replacementLease.documentIncarnationId,
    reportId: recoveredReport.reportId,
    sequence: recoveredReport.sequence,
    sceneFingerprintSha256: details['sceneFingerprintSha256'],
    viewLayerIdentitySha256: details['viewLayerIdentitySha256'],
    objectIdentitySha256: details['objectIdentitySha256'],
    meshIdentitySha256: details['meshIdentitySha256'],
    collectionIdentitySha256: details['collectionIdentitySha256'],
    sessionUidDomainSha256: details['sessionUidDomainSha256'],
    pointerDomainSha256: details['pointerDomainSha256'],
    linksAndSelectionSha256: details['linksAndSelectionSha256'],
    observedAt,
  });
}

export function managedExecutionTrackRepairAck(
  request: ManagedRecoveryRequest,
  failedResult: ReturnType<typeof managedExecutionTrackFailureResult>,
  failedMarker: ReturnType<typeof managedExecutionTrackFailedTerminalMarker>,
  recoveredReport: ReturnType<typeof managedExecutionTrackRecoveredReport>,
  occurredAt = '2026-08-22T10:05:05Z',
) {
  if (failedResult.status !== 'failed_managed') throw new Error('expected failed managed result');
  const currentState = managedExecutionTrackRepairCurrentState(
    request,
    recoveredReport,
    new Date(Date.parse(occurredAt) - 1).toISOString(),
  );
  return companionExecutionTrackExecutionRecoveryAckSchema.parse({
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
      kind: 'managed_repair_terminal',
      failedTerminalResult: failedResult,
      failedTerminalResultContentSha256: computeProtocolCanonicalJsonSha256(failedResult),
      failedTerminalMarker: failedMarker,
      recoveredReport,
      recoveredReportContentSha256: computeProtocolCanonicalJsonSha256(recoveredReport),
      currentState,
    },
    retainsTargetLock: false,
    automaticReplay: false,
    occurredAt,
  });
}
