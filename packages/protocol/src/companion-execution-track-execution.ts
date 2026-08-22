import { z } from 'zod';

import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';
import { companionNativeUndoCheckpointSchema } from './companion.js';
import {
  companionExecutionTrackPreflightBindingSchema,
  companionExecutionTrackPreflightCreateRequestSchema,
  companionExecutionTrackPreflightLeaseSchema,
} from './companion-execution-track.js';
import {
  companionMenuControlProofOperationReceiptSchema,
  companionMenuControlProofSucceededLockedEvidenceSchema,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
} from './companion-menu-control-proof.js';
import { menuProofExecutionSchema } from './interaction-catalog.js';
import { uvSphereMenuControlProofOperationIds } from './procedure-menu-control-proof.js';

export const companionExecutionTrackExecutionFormatVersion = '2.0.0' as const;
export const companionExecutionTrackExecutionFormatVersionSchema = z.literal(
  companionExecutionTrackExecutionFormatVersion,
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });
const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});

const createShape = companionExecutionTrackPreflightCreateRequestSchema.shape;
export const companionExecutionTrackExecutionCreateRequestSchema = z.strictObject({
  formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
  requestId: createShape.requestId,
  target: createShape.target,
  proposalId: createShape.proposalId,
  plan: createShape.plan,
  executionId: createShape.executionId,
  leafId: createShape.leafId,
  override: createShape.override,
  expectedState: createShape.expectedState,
});
export type CompanionExecutionTrackExecutionCreateRequest = z.infer<
  typeof companionExecutionTrackExecutionCreateRequestSchema
>;

export const companionExecutionTrackExecutionExecutorSchema = z.strictObject({
  executorId: z.literal('blender.uv_sphere_menu_proven_managed_commit.v2'),
  proofExecutorId: z.literal('blender.uv_sphere_menu_controls.event_simulate.v1'),
  targetProfile: z.literal('factory_layout_three_object_ui_scale_2'),
  executionBoundary: z.literal('proof_restore_then_managed_commit'),
  authorization: z.literal('accepted_replay_next_step'),
  proofOperationIds: z.tuple(
    uvSphereMenuControlProofOperationIds.map((id) => z.literal(id)) as [
      z.ZodLiteral<string>,
      ...z.ZodLiteral<string>[],
    ],
  ),
  nativeUndoDepth: z.literal(8),
  commitActionName: z.literal('blender.mesh.create_uv_sphere'),
  automaticReplay: z.literal(false),
});

const pristineStartCheckpointSessionSchema =
  companionNativeUndoCheckpointSchema.shape.session.safeExtend({
    activeStepId: z.null(),
    completedStepIds: z.tuple([]),
    receiptStepIds: z.tuple([]),
  });

export const companionExecutionTrackExecutionStartCheckpointSchema =
  companionNativeUndoCheckpointSchema.safeExtend({
    previousCheckpointId: z.null(),
    operation: z.literal('start'),
    session: pristineStartCheckpointSessionSchema,
  });

export const companionExecutionTrackExecutionStartAttestationSchema = z.strictObject({
  checkpointId: z.uuid(),
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
  sceneFingerprintSha256: sha256Schema,
  identitySnapshot: z.strictObject({
    viewLayerIdentitySha256: sha256Schema,
    objectIdentitySha256: sha256Schema,
    meshIdentitySha256: sha256Schema,
    collectionIdentitySha256: sha256Schema,
    sessionUidDomainSha256: sha256Schema,
    pointerDomainSha256: sha256Schema,
    linksAndSelectionSha256: sha256Schema,
  }),
  documentIncarnationId: z.uuid(),
  sessionId: z.uuid(),
  leaseId: z.uuid(),
  attestedAt: timestampSchema,
  contentSha256: sha256Schema,
});

const bindingContentSchema = z.strictObject({
  formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
  requestId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: createShape.plan,
  executionId: z.uuid(),
  leafId: createShape.leafId,
  override: createShape.override,
  expectedState: expectedStateSchema,
  proofId: z.uuid(),
  preflightBinding: companionExecutionTrackPreflightBindingSchema,
  executor: companionExecutionTrackExecutionExecutorSchema,
  executionScope: z.strictObject({
    kind: z.literal('single_leaf'),
    leafCount: z.literal(1),
    leafId: createShape.leafId,
    procedureTreeContentSha256: sha256Schema,
  }),
  requestedAt: timestampSchema,
});

function bindingSemanticsMatch(binding: z.infer<typeof bindingContentSchema>): boolean {
  const preflight = binding.preflightBinding;
  const track = preflight.selectedTrack;
  return (
    preflight.requestId === binding.requestId &&
    preflight.target.adapterId === binding.target.adapterId &&
    preflight.target.instanceId === binding.target.instanceId &&
    preflight.proposal.id === binding.proposalId &&
    computeProtocolCanonicalJsonSha256(preflight.plan) ===
      computeProtocolCanonicalJsonSha256(binding.plan) &&
    preflight.executionId === binding.executionId &&
    preflight.leafId === binding.leafId &&
    computeProtocolCanonicalJsonSha256(preflight.override) ===
      computeProtocolCanonicalJsonSha256(binding.override) &&
    computeProtocolCanonicalJsonSha256(preflight.expectedState) ===
      computeProtocolCanonicalJsonSha256(binding.expectedState) &&
    preflight.requestedAt === binding.requestedAt &&
    binding.executor.commitActionName === preflight.action.name &&
    preflight.override.modality === 'menu' &&
    track.modality === 'menu' &&
    track.availability === 'available' &&
    track.proofExecution !== undefined &&
    menuProofExecutionSchema.safeParse(track.proofExecution).success &&
    track.proofExecution.executorId === binding.executor.proofExecutorId &&
    track.proofExecution.targetProfile === binding.executor.targetProfile &&
    track.proofExecution.nativeUndoDepth === binding.executor.nativeUndoDepth &&
    computeProtocolCanonicalJsonSha256(track.proofExecution.operationIds) ===
      computeProtocolCanonicalJsonSha256(binding.executor.proofOperationIds) &&
    preflight.step.parentId === preflight.sourceLeaf.parentId &&
    preflight.step.order === preflight.sourceLeaf.order &&
    computeProtocolCanonicalJsonSha256(preflight.step.dependsOn) ===
      computeProtocolCanonicalJsonSha256(preflight.sourceLeaf.dependsOn) &&
    binding.executionScope.leafId === binding.leafId &&
    binding.executionScope.procedureTreeContentSha256 ===
      preflight.artifacts.procedureTreeContentSha256
  );
}

export const companionExecutionTrackExecutionBindingSchema = bindingContentSchema
  .safeExtend({ bindingContentSha256: sha256Schema })
  .superRefine((binding, context) => {
    const { bindingContentSha256, ...content } = binding;
    if (
      !bindingSemanticsMatch(binding) ||
      bindingContentSha256 !== computeProtocolCanonicalJsonSha256(content)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindingContentSha256'],
        message: 'Execution binding must preserve exact preflight authority and canonical content',
      });
    }
  });
export type CompanionExecutionTrackExecutionBinding = z.infer<
  typeof companionExecutionTrackExecutionBindingSchema
>;

export const companionExecutionTrackExecutionDeliverySchema = z
  .strictObject({
    binding: companionExecutionTrackExecutionBindingSchema,
    deliveryId: z.uuid(),
    lease: companionExecutionTrackPreflightLeaseSchema,
    dispatchedAt: timestampSchema,
  })
  .superRefine((delivery, context) => {
    const binding = delivery.binding;
    if (
      computeProtocolCanonicalJsonSha256(delivery.lease.target) !==
        computeProtocolCanonicalJsonSha256(binding.target) ||
      Date.parse(binding.requestedAt) > Date.parse(delivery.dispatchedAt) ||
      Date.parse(delivery.dispatchedAt) >= Date.parse(delivery.lease.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Execution delivery identity or chronology changed',
      });
    }
  });
export type CompanionExecutionTrackExecutionDelivery = z.infer<
  typeof companionExecutionTrackExecutionDeliverySchema
>;

const deliveryShape = companionExecutionTrackExecutionDeliverySchema.shape;
const progressIdentityShape = {
  binding: deliveryShape.binding,
  deliveryId: deliveryShape.deliveryId,
  lease: deliveryShape.lease,
  currentLease: companionExecutionTrackPreflightLeaseSchema,
  dispatchedAt: deliveryShape.dispatchedAt,
  sequence: z.number().int().positive(),
  previousProgressContentSha256: sha256Schema.nullable(),
  occurredAt: timestampSchema,
  contentSha256: sha256Schema,
} as const;

const baselineAttestedSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('baseline_attested'),
  startCheckpoint: companionExecutionTrackExecutionStartCheckpointSchema,
  startAttestation: companionExecutionTrackExecutionStartAttestationSchema,
});

function deliveryAndOccurrenceMatch(value: {
  binding: CompanionExecutionTrackExecutionBinding;
  deliveryId: string;
  lease: z.infer<typeof companionExecutionTrackPreflightLeaseSchema>;
  currentLease: z.infer<typeof companionExecutionTrackPreflightLeaseSchema>;
  dispatchedAt: string;
  occurredAt: string;
}): boolean {
  return (
    companionExecutionTrackExecutionDeliverySchema.safeParse({
      binding: value.binding,
      deliveryId: value.deliveryId,
      lease: value.lease,
      dispatchedAt: value.dispatchedAt,
    }).success &&
    value.currentLease.leaseId === value.lease.leaseId &&
    value.currentLease.sessionId === value.lease.sessionId &&
    value.currentLease.documentIncarnationId === value.lease.documentIncarnationId &&
    computeProtocolCanonicalJsonSha256(value.currentLease.target) ===
      computeProtocolCanonicalJsonSha256(value.lease.target) &&
    Date.parse(value.lease.expiresAt) <= Date.parse(value.currentLease.expiresAt) &&
    Date.parse(value.dispatchedAt) <= Date.parse(value.occurredAt) &&
    Date.parse(value.occurredAt) < Date.parse(value.currentLease.expiresAt)
  );
}

function receiptPrefixMatches(
  receipts: z.infer<typeof companionMenuControlProofOperationReceiptSchema>[],
  value: {
    binding: CompanionExecutionTrackExecutionBinding;
    deliveryId: string;
    dispatchedAt: string;
    occurredAt: string;
  },
): boolean {
  let previous: string | null = null;
  let previousTime = Date.parse(value.dispatchedAt);
  return receipts.every((receipt, index) => {
    const time = Date.parse(receipt.occurredAt);
    const matches =
      receipt.proofId === value.binding.proofId &&
      receipt.requestId === value.binding.requestId &&
      receipt.deliveryId === value.deliveryId &&
      receipt.bindingContentSha256 === value.binding.bindingContentSha256 &&
      receipt.operationId === uvSphereMenuControlProofOperationIds[index] &&
      receipt.order === index + 1 &&
      receipt.previousReceiptContentSha256 === previous &&
      receipt.contentSha256 ===
        computeCompanionMenuControlProofOperationReceiptContentSha256(receipt) &&
      time >= previousTime &&
      time <= Date.parse(value.occurredAt);
    previous = receipt.contentSha256;
    previousTime = time;
    return matches;
  });
}

// The serialized receipt shape is compatible with v1, but every receipt in this
// protocol is newly signed against the v2 execution binding and proof identity.
export const companionExecutionTrackExecutionProofReceiptSchema =
  companionMenuControlProofOperationReceiptSchema;

const proofLockedEvidenceContentSchema =
  companionMenuControlProofSucceededLockedEvidenceSchema.safeExtend({
    managedActionExecuted: z.literal(false),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
  });
const proofLockedEvidenceSchema = proofLockedEvidenceContentSchema.safeExtend({
  proofEvidenceContentSha256: sha256Schema,
});

const undoTransitionSchema = z.strictObject({
  order: z.number().int().min(1).max(8),
  operation: z.literal('native_undo'),
  fromCursor: z.number().int().min(1).max(8),
  toCursor: z.number().int().min(0).max(7),
  beforeSceneFingerprintSha256: sha256Schema,
  afterSceneFingerprintSha256: sha256Schema,
  occurredAt: timestampSchema,
  contentSha256: sha256Schema,
});

export const companionExecutionTrackExecutionBaselineIdentitySchema = z.strictObject({
  sceneFingerprintSha256: sha256Schema,
  viewLayerIdentitySha256: sha256Schema,
  objectIdentitySha256: sha256Schema,
  meshIdentitySha256: sha256Schema,
  collectionIdentitySha256: sha256Schema,
  sessionUidDomainSha256: sha256Schema,
  pointerDomainSha256: sha256Schema,
  linksAndSelectionSha256: sha256Schema,
  startReportId: z.uuid(),
  startCheckpointId: z.uuid(),
  startAttestationContentSha256: sha256Schema,
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
  contentSha256: sha256Schema,
});

function baselineMatchesAttestation(
  baseline: z.infer<typeof companionExecutionTrackExecutionBaselineIdentitySchema>,
  attestation: z.infer<typeof companionExecutionTrackExecutionStartAttestationSchema>,
): boolean {
  const { contentSha256, ...content } = baseline;
  return (
    contentSha256 === computeProtocolCanonicalJsonSha256(content) &&
    baseline.sceneFingerprintSha256 === attestation.sceneFingerprintSha256 &&
    baseline.viewLayerIdentitySha256 === attestation.identitySnapshot.viewLayerIdentitySha256 &&
    baseline.objectIdentitySha256 === attestation.identitySnapshot.objectIdentitySha256 &&
    baseline.meshIdentitySha256 === attestation.identitySnapshot.meshIdentitySha256 &&
    baseline.collectionIdentitySha256 === attestation.identitySnapshot.collectionIdentitySha256 &&
    baseline.sessionUidDomainSha256 === attestation.identitySnapshot.sessionUidDomainSha256 &&
    baseline.pointerDomainSha256 === attestation.identitySnapshot.pointerDomainSha256 &&
    baseline.linksAndSelectionSha256 === attestation.identitySnapshot.linksAndSelectionSha256 &&
    baseline.startReportId === attestation.reportId &&
    baseline.startCheckpointId === attestation.checkpointId &&
    baseline.startAttestationContentSha256 === attestation.contentSha256 &&
    baseline.sessionId === attestation.sessionId &&
    baseline.documentIncarnationId === attestation.documentIncarnationId
  );
}

const baselineReferenceShape = {
  startCheckpointId: z.uuid(),
  startAttestationContentSha256: sha256Schema,
  baselineSceneFingerprintSha256: sha256Schema,
} as const;
const proofReferenceShape = {
  proofEvidenceContentSha256: sha256Schema,
  proofCheckpointId: z.uuid(),
  undoLockId: z.uuid(),
  proofFinalSceneFingerprintSha256: sha256Schema,
} as const;

export const companionExecutionTrackExecutionProofTerminalMarkerIdentitySchema = z.strictObject({
  formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
  kind: z.literal('proof_terminal_marker'),
  proofId: z.uuid(),
  bindingContentSha256: sha256Schema,
  proofCheckpointId: z.uuid(),
  undoLockId: z.uuid(),
  baselineSceneFingerprintSha256: sha256Schema,
  finalSceneFingerprintSha256: sha256Schema,
  proofEvidenceContentSha256: sha256Schema,
});
export type CompanionExecutionTrackExecutionProofTerminalMarkerIdentity = z.infer<
  typeof companionExecutionTrackExecutionProofTerminalMarkerIdentitySchema
>;

export function computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256(
  identity: CompanionExecutionTrackExecutionProofTerminalMarkerIdentity,
): string {
  return computeProtocolCanonicalJsonSha256(
    companionExecutionTrackExecutionProofTerminalMarkerIdentitySchema.parse(identity),
  );
}

const proofInProgressSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('proof_in_progress'),
  ...baselineReferenceShape,
  proofReceipts: z.array(companionExecutionTrackExecutionProofReceiptSchema).min(1).max(7),
  completedOperationIds: z.array(z.enum(uvSphereMenuControlProofOperationIds)).min(1).max(7),
});
const proofObservedLockedSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('proof_observed_locked'),
  ...baselineReferenceShape,
  evidence: proofLockedEvidenceSchema,
});
const restoreInProgressSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('restore_in_progress'),
  ...baselineReferenceShape,
  ...proofReferenceShape,
  transitions: z.array(undoTransitionSchema).min(1).max(8),
  nativeHistoryCursor: z.number().int().min(0).max(7),
});
const baselineRestoredSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('baseline_restored'),
  ...proofReferenceShape,
  transitions: z.array(undoTransitionSchema).length(8),
  nativeHistoryCursor: z.literal(0),
  undoChainHeadContentSha256: sha256Schema,
  baseline: companionExecutionTrackExecutionBaselineIdentitySchema,
});
const commitIntentSchema = z.strictObject({
  ...progressIdentityShape,
  phase: z.literal('commit_intent_recorded'),
  ...proofReferenceShape,
  undoChainHeadContentSha256: sha256Schema,
  baseline: companionExecutionTrackExecutionBaselineIdentitySchema,
  intent: z.strictObject({
    intentId: z.uuid(),
    action: companionExecutionTrackPreflightBindingSchema.shape.action,
    baselineContentSha256: sha256Schema,
    redoBarrier: z.strictObject({
      evidenceClass: z.literal('companion_reported_native_redo_barrier'),
      method: z.literal('view3d_ed_undo_push'),
      message: z.literal('OperatingLine supersede restored menu proof'),
      proofCheckpointId: z.uuid(),
      undoLockId: z.uuid(),
      proofEvidenceContentSha256: sha256Schema,
      proofTerminalMarkerContentSha256: sha256Schema,
      baselineContentSha256: sha256Schema,
      undoChainHeadContentSha256: sha256Schema,
      baselineSceneFingerprintBeforeSha256: sha256Schema,
      baselineSceneFingerprintAfterSha256: sha256Schema,
      markerMatchedBeforeRemoval: z.literal(true),
      markerPresentBeforePush: z.literal(false),
      markerPresentAfterPush: z.literal(false),
      undoPushFinished: z.literal(true),
      redoPollAfterBarrier: z.literal(false),
      controllerSuperseded: z.literal(true),
      controllerCheckpointAbsent: z.literal(true),
      verifiedAt: timestampSchema,
      contentSha256: sha256Schema,
    }),
    managedActionExecuted: z.literal(false),
    managedReceiptCreated: z.literal(false),
    recordedAt: timestampSchema,
    contentSha256: sha256Schema,
  }),
});

export const companionExecutionTrackExecutionProgressSchema = z
  .discriminatedUnion('phase', [
    baselineAttestedSchema,
    proofInProgressSchema,
    proofObservedLockedSchema,
    restoreInProgressSchema,
    baselineRestoredSchema,
    commitIntentSchema,
  ])
  .superRefine((progress, context) => {
    const { contentSha256, ...content } = progress;
    const exactSequence = {
      baseline_attested: 1,
      proof_in_progress: 2,
      proof_observed_locked: 3,
      restore_in_progress: 4,
      baseline_restored: 5,
      commit_intent_recorded: 6,
    }[progress.phase];
    let valid =
      deliveryAndOccurrenceMatch(progress) &&
      contentSha256 === computeProtocolCanonicalJsonSha256(content) &&
      progress.sequence === exactSequence &&
      (progress.sequence === 1
        ? progress.previousProgressContentSha256 === null
        : progress.previousProgressContentSha256 !== null);
    if (progress.phase === 'baseline_attested') {
      const checkpoint = progress.startCheckpoint;
      const attestation = progress.startAttestation;
      const { contentSha256: attestationHash, ...attestationContent } = attestation;
      valid &&=
        checkpoint.session.plan.id === progress.binding.plan.id &&
        checkpoint.session.plan.revision === progress.binding.plan.revision &&
        checkpoint.session.planContentSha256 === progress.binding.plan.contentSha256 &&
        checkpoint.session.executionId === progress.binding.executionId &&
        attestation.checkpointId === checkpoint.checkpointId &&
        attestation.reportId === progress.binding.expectedState.reportId &&
        attestation.sequence === progress.binding.expectedState.sequence &&
        attestation.sessionId === progress.lease.sessionId &&
        attestation.documentIncarnationId === progress.lease.documentIncarnationId &&
        attestation.leaseId === progress.lease.leaseId &&
        attestationHash === computeProtocolCanonicalJsonSha256(attestationContent) &&
        Date.parse(checkpoint.committedAt) <= Date.parse(progress.binding.requestedAt) &&
        Date.parse(progress.binding.requestedAt) <= Date.parse(progress.dispatchedAt) &&
        Date.parse(progress.dispatchedAt) <= Date.parse(attestation.attestedAt) &&
        Date.parse(attestation.attestedAt) <= Date.parse(progress.occurredAt);
    } else if (progress.phase === 'proof_in_progress') {
      valid &&=
        receiptPrefixMatches(progress.proofReceipts, progress) &&
        progress.completedOperationIds.length === progress.proofReceipts.length &&
        progress.completedOperationIds.every(
          (id, index) => id === uvSphereMenuControlProofOperationIds[index],
        );
    } else if (progress.phase === 'proof_observed_locked') {
      const evidence = progress.evidence;
      const receipts = evidence.operationReceipts;
      const { proofEvidenceContentSha256, ...proofEvidenceContent } = evidence;
      valid &&=
        receiptPrefixMatches(receipts, progress) &&
        proofEvidenceContentSha256 === computeProtocolCanonicalJsonSha256(proofEvidenceContent) &&
        evidence.operationSummaries.every(
          (summary, index) =>
            summary.operationId === uvSphereMenuControlProofOperationIds[index] &&
            summary.summaryContentSha256 ===
              computeProtocolCanonicalJsonSha256(receipts[index]?.summary),
        ) &&
        evidence.strongObservation.contentSha256 ===
          computeProtocolCanonicalJsonSha256(
            Object.fromEntries(
              Object.entries(evidence.strongObservation).filter(([key]) => key !== 'contentSha256'),
            ),
          ) &&
        evidence.nativeUndoCheckpoint.receiptChainRootSha256 === receipts[0]?.contentSha256 &&
        evidence.nativeUndoCheckpoint.receiptChainHeadSha256 === receipts.at(-1)?.contentSha256 &&
        evidence.nativeUndoCheckpoint.strongObservationContentSha256 ===
          evidence.strongObservation.contentSha256 &&
        evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 ===
          evidence.strongObservation.sceneFingerprintSha256 &&
        evidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 ===
          progress.baselineSceneFingerprintSha256 &&
        evidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 !==
          evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 &&
        evidence.nativeUndoCheckpoint.restoredSceneFingerprintSha256 ===
          progress.baselineSceneFingerprintSha256 &&
        evidence.nativeUndoCheckpoint.reappliedSceneFingerprintSha256 ===
          evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 &&
        Date.parse(receipts.at(-1)?.occurredAt ?? '') <=
          Date.parse(evidence.strongObservation.observedAt) &&
        Date.parse(evidence.strongObservation.observedAt) <=
          Date.parse(evidence.nativeUndoCheckpoint.committedAt) &&
        Date.parse(evidence.nativeUndoCheckpoint.committedAt) <= Date.parse(progress.occurredAt);
    } else if (progress.phase === 'restore_in_progress') {
      valid &&= undoPrefixMatches(
        progress.transitions,
        progress.nativeHistoryCursor,
        progress.dispatchedAt,
        progress.occurredAt,
      );
    } else if (progress.phase === 'baseline_restored') {
      valid &&=
        undoPrefixMatches(progress.transitions, 0, progress.dispatchedAt, progress.occurredAt) &&
        progress.transitions.at(-1)?.afterSceneFingerprintSha256 ===
          progress.baseline.sceneFingerprintSha256 &&
        progress.undoChainHeadContentSha256 === progress.transitions.at(-1)?.contentSha256;
    } else {
      const { contentSha256, ...intentContent } = progress.intent;
      const { contentSha256: barrierHash, ...barrierContent } = progress.intent.redoBarrier;
      const barrier = progress.intent.redoBarrier;
      const proofTerminalMarkerContentSha256 =
        computeCompanionExecutionTrackExecutionProofTerminalMarkerContentSha256({
          formatVersion: companionExecutionTrackExecutionFormatVersion,
          kind: 'proof_terminal_marker',
          proofId: progress.binding.proofId,
          bindingContentSha256: progress.binding.bindingContentSha256,
          proofCheckpointId: progress.proofCheckpointId,
          undoLockId: progress.undoLockId,
          baselineSceneFingerprintSha256: progress.baseline.sceneFingerprintSha256,
          finalSceneFingerprintSha256: progress.proofFinalSceneFingerprintSha256,
          proofEvidenceContentSha256: progress.proofEvidenceContentSha256,
        });
      valid &&=
        computeProtocolCanonicalJsonSha256(progress.intent.action) ===
          computeProtocolCanonicalJsonSha256(progress.binding.preflightBinding.action) &&
        progress.intent.baselineContentSha256 === progress.baseline.contentSha256 &&
        barrierHash === computeProtocolCanonicalJsonSha256(barrierContent) &&
        barrier.proofCheckpointId === progress.proofCheckpointId &&
        barrier.undoLockId === progress.undoLockId &&
        barrier.proofEvidenceContentSha256 === progress.proofEvidenceContentSha256 &&
        barrier.proofTerminalMarkerContentSha256 === proofTerminalMarkerContentSha256 &&
        barrier.baselineContentSha256 === progress.baseline.contentSha256 &&
        barrier.undoChainHeadContentSha256 === progress.undoChainHeadContentSha256 &&
        barrier.baselineSceneFingerprintBeforeSha256 === progress.baseline.sceneFingerprintSha256 &&
        barrier.baselineSceneFingerprintAfterSha256 === progress.baseline.sceneFingerprintSha256 &&
        contentSha256 === computeProtocolCanonicalJsonSha256(intentContent) &&
        Date.parse(barrier.verifiedAt) <= Date.parse(progress.intent.recordedAt) &&
        Date.parse(progress.dispatchedAt) <= Date.parse(barrier.verifiedAt) &&
        Date.parse(progress.intent.recordedAt) <= Date.parse(progress.occurredAt);
    }
    if (!valid)
      context.addIssue({ code: 'custom', message: 'Execution progress evidence is not canonical' });
  });
export type CompanionExecutionTrackExecutionProgress = z.infer<
  typeof companionExecutionTrackExecutionProgressSchema
>;

function addCanonicalProgressIssue(
  progress: unknown,
  context: z.core.$RefinementCtx<unknown>,
): void {
  if (!companionExecutionTrackExecutionProgressSchema.safeParse(progress).success) {
    context.addIssue({
      code: 'custom',
      message: 'Embedded progress must pass the public execution progress semantic gate',
    });
  }
}

const canonicalCommitIntentProgressSchema =
  commitIntentSchema.superRefine(addCanonicalProgressIssue);
const canonicalRecoveryBaselineProgressSchema = z
  .union([baselineAttestedSchema, baselineRestoredSchema])
  .superRefine(addCanonicalProgressIssue);

function undoPrefixMatches(
  transitions: z.infer<typeof undoTransitionSchema>[],
  cursor: number,
  dispatchedAt: string,
  occurredAt: string,
): boolean {
  let previousTime = Date.parse(dispatchedAt);
  return (
    cursor === 8 - transitions.length &&
    transitions.every((transition, index) => {
      const expectedFrom = 8 - index;
      const { contentSha256, ...content } = transition;
      const transitionTime = Date.parse(transition.occurredAt);
      const valid =
        transition.order === index + 1 &&
        transition.fromCursor === expectedFrom &&
        transition.toCursor === expectedFrom - 1 &&
        contentSha256 === computeProtocolCanonicalJsonSha256(content) &&
        (index === 0 ||
          transitions[index - 1]?.afterSceneFingerprintSha256 ===
            transition.beforeSceneFingerprintSha256) &&
        previousTime <= transitionTime &&
        transitionTime <= Date.parse(occurredAt);
      previousTime = transitionTime;
      return valid;
    })
  );
}

function sameProgressDelivery(
  previous: CompanionExecutionTrackExecutionProgress,
  next: CompanionExecutionTrackExecutionProgress,
): boolean {
  return (
    previous.binding.bindingContentSha256 === next.binding.bindingContentSha256 &&
    previous.deliveryId === next.deliveryId &&
    computeProtocolCanonicalJsonSha256(previous.lease) ===
      computeProtocolCanonicalJsonSha256(next.lease) &&
    previous.currentLease.leaseId === next.currentLease.leaseId &&
    previous.currentLease.sessionId === next.currentLease.sessionId &&
    previous.currentLease.documentIncarnationId === next.currentLease.documentIncarnationId &&
    computeProtocolCanonicalJsonSha256(previous.currentLease.target) ===
      computeProtocolCanonicalJsonSha256(next.currentLease.target) &&
    Date.parse(previous.currentLease.expiresAt) <= Date.parse(next.currentLease.expiresAt) &&
    previous.dispatchedAt === next.dispatchedAt
  );
}

export function companionExecutionTrackExecutionProgressTransitionMatches(
  previous: CompanionExecutionTrackExecutionProgress,
  next: CompanionExecutionTrackExecutionProgress,
): boolean {
  const order = [
    'baseline_attested',
    'proof_in_progress',
    'proof_observed_locked',
    'restore_in_progress',
    'baseline_restored',
    'commit_intent_recorded',
  ] as const;
  let valid =
    sameProgressDelivery(previous, next) &&
    next.sequence === previous.sequence + 1 &&
    next.previousProgressContentSha256 === previous.contentSha256 &&
    Date.parse(previous.occurredAt) <= Date.parse(next.occurredAt) &&
    order.indexOf(next.phase) === order.indexOf(previous.phase) + 1;
  if (previous.phase === 'baseline_attested' && next.phase === 'proof_in_progress') {
    valid &&=
      next.startCheckpointId === previous.startCheckpoint.checkpointId &&
      next.startAttestationContentSha256 === previous.startAttestation.contentSha256 &&
      next.baselineSceneFingerprintSha256 === previous.startAttestation.sceneFingerprintSha256 &&
      Date.parse(previous.occurredAt) <= Date.parse(next.proofReceipts[0]?.occurredAt ?? '');
  } else if (previous.phase === 'proof_in_progress' && next.phase === 'proof_observed_locked') {
    const addedReceipts = next.evidence.operationReceipts.slice(previous.proofReceipts.length);
    valid &&=
      next.startCheckpointId === previous.startCheckpointId &&
      next.startAttestationContentSha256 === previous.startAttestationContentSha256 &&
      next.baselineSceneFingerprintSha256 === previous.baselineSceneFingerprintSha256 &&
      previous.proofReceipts.every(
        (receipt, index) =>
          receipt.contentSha256 === next.evidence.operationReceipts[index]?.contentSha256,
      ) &&
      addedReceipts.every(
        (receipt) => Date.parse(previous.occurredAt) <= Date.parse(receipt.occurredAt),
      ) &&
      Date.parse(previous.occurredAt) <= Date.parse(next.evidence.strongObservation.observedAt);
  } else if (previous.phase === 'proof_observed_locked' && next.phase === 'restore_in_progress') {
    const checkpoint = previous.evidence.nativeUndoCheckpoint;
    valid &&=
      next.startCheckpointId === previous.startCheckpointId &&
      next.startAttestationContentSha256 === previous.startAttestationContentSha256 &&
      next.baselineSceneFingerprintSha256 === previous.baselineSceneFingerprintSha256 &&
      next.proofEvidenceContentSha256 === previous.evidence.proofEvidenceContentSha256 &&
      next.proofCheckpointId === checkpoint.checkpointId &&
      next.undoLockId === checkpoint.undoLockId &&
      next.proofFinalSceneFingerprintSha256 === checkpoint.finalSceneFingerprintSha256 &&
      next.transitions[0]?.beforeSceneFingerprintSha256 ===
        checkpoint.finalSceneFingerprintSha256 &&
      Date.parse(previous.occurredAt) <= Date.parse(next.transitions[0]?.occurredAt ?? '');
  } else if (previous.phase === 'restore_in_progress' && next.phase === 'baseline_restored') {
    const addedTransitions = next.transitions.slice(previous.transitions.length);
    valid &&=
      next.proofEvidenceContentSha256 === previous.proofEvidenceContentSha256 &&
      next.proofCheckpointId === previous.proofCheckpointId &&
      next.undoLockId === previous.undoLockId &&
      next.proofFinalSceneFingerprintSha256 === previous.proofFinalSceneFingerprintSha256 &&
      previous.transitions.every(
        (transition, index) => transition.contentSha256 === next.transitions[index]?.contentSha256,
      ) &&
      addedTransitions.every(
        (transition) => Date.parse(previous.occurredAt) <= Date.parse(transition.occurredAt),
      );
  } else if (previous.phase === 'baseline_restored' && next.phase === 'commit_intent_recorded') {
    valid &&=
      next.proofEvidenceContentSha256 === previous.proofEvidenceContentSha256 &&
      next.proofCheckpointId === previous.proofCheckpointId &&
      next.undoLockId === previous.undoLockId &&
      next.proofFinalSceneFingerprintSha256 === previous.proofFinalSceneFingerprintSha256 &&
      next.undoChainHeadContentSha256 === previous.undoChainHeadContentSha256 &&
      next.baseline.contentSha256 === previous.baseline.contentSha256 &&
      Date.parse(previous.occurredAt) <= Date.parse(next.intent.redoBarrier.verifiedAt) &&
      Date.parse(previous.occurredAt) <= Date.parse(next.intent.recordedAt);
  }
  return valid;
}

export const companionExecutionTrackExecutionProgressTransitionSchema = z
  .strictObject({
    previous: companionExecutionTrackExecutionProgressSchema,
    next: companionExecutionTrackExecutionProgressSchema,
  })
  .superRefine((value, context) => {
    if (!companionExecutionTrackExecutionProgressTransitionMatches(value.previous, value.next)) {
      context.addIssue({
        code: 'custom',
        message: 'Execution progress transition is not continuous',
      });
    }
  });

export const companionExecutionTrackExecutionProgressChainSchema = z
  .array(companionExecutionTrackExecutionProgressSchema)
  .length(6)
  .superRefine((chain, context) => {
    const start = chain[0];
    const observed = chain[2];
    const restored = chain[4];
    const valid =
      chain
        .slice(1)
        .every((next, index) =>
          companionExecutionTrackExecutionProgressTransitionMatches(chain[index]!, next),
        ) &&
      start?.phase === 'baseline_attested' &&
      observed?.phase === 'proof_observed_locked' &&
      restored?.phase === 'baseline_restored' &&
      baselineMatchesAttestation(restored.baseline, start.startAttestation) &&
      observed.evidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 ===
        start.startAttestation.sceneFingerprintSha256;
    if (!valid) {
      context.addIssue({
        code: 'custom',
        message: 'Execution progress chain is not a complete trusted six-phase chain',
      });
    }
  });

const resultIdentityShape = {
  formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  bindingContentSha256: sha256Schema,
  target: targetSchema,
  leaseId: z.uuid(),
  currentLease: companionExecutionTrackPreflightLeaseSchema,
  proposalId: z.uuid(),
  planId: z.string().min(1),
  planRevision: z.number().int().positive(),
  executionId: z.uuid(),
  leafId: createShape.leafId,
  occurredAt: timestampSchema,
} as const;
const noMutationResultSchema = z.strictObject({
  ...resultIdentityShape,
  status: z.literal('failed_no_mutation'),
  startCheckpointId: z.uuid(),
  baselineAttestationContentSha256: sha256Schema,
  lastProgressContentSha256: sha256Schema,
  error: z.string().min(1).max(2_000),
});
const restoredResultSchema = z.strictObject({
  ...resultIdentityShape,
  status: z.literal('failed_restored'),
  baselineContentSha256: sha256Schema,
  proofEvidenceContentSha256: sha256Schema,
  lastProgressContentSha256: sha256Schema,
  error: z.string().min(1).max(2_000),
});
export const companionExecutionTrackExecutionManagedStartSchema = z.strictObject({
  managedStartId: z.uuid(),
  commitIntentId: z.uuid(),
  commitIntentContentSha256: sha256Schema,
  baselineContentSha256: sha256Schema,
  proofEvidenceContentSha256: sha256Schema,
  previousProgressContentSha256: sha256Schema,
  startedAt: timestampSchema,
  contentSha256: sha256Schema,
});
export type CompanionExecutionTrackExecutionManagedStart = z.infer<
  typeof companionExecutionTrackExecutionManagedStartSchema
>;

function managedStartIsCanonical(start: CompanionExecutionTrackExecutionManagedStart): boolean {
  const { contentSha256, ...content } = start;
  return contentSha256 === computeProtocolCanonicalJsonSha256(content);
}

export const companionExecutionTrackExecutionManagedStartSubmissionSchema = z
  .strictObject({
    formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
    requestId: z.uuid(),
    deliveryId: z.uuid(),
    bindingContentSha256: sha256Schema,
    currentLease: companionExecutionTrackPreflightLeaseSchema,
    commitProgress: canonicalCommitIntentProgressSchema,
    managedStart: companionExecutionTrackExecutionManagedStartSchema,
  })
  .superRefine((submission, context) => {
    const progress = submission.commitProgress;
    const start = submission.managedStart;
    if (progress.phase !== 'commit_intent_recorded') {
      context.addIssue({
        code: 'custom',
        path: ['commitProgress', 'phase'],
        message: 'Managed-start submission requires canonical commit intent progress',
      });
      return;
    }
    if (
      submission.requestId !== progress.binding.requestId ||
      submission.deliveryId !== progress.deliveryId ||
      submission.bindingContentSha256 !== progress.binding.bindingContentSha256 ||
      submission.currentLease.leaseId !== progress.currentLease.leaseId ||
      submission.currentLease.sessionId !== progress.currentLease.sessionId ||
      submission.currentLease.documentIncarnationId !==
        progress.currentLease.documentIncarnationId ||
      computeProtocolCanonicalJsonSha256(submission.currentLease.target) !==
        computeProtocolCanonicalJsonSha256(progress.currentLease.target) ||
      Date.parse(progress.currentLease.expiresAt) > Date.parse(submission.currentLease.expiresAt) ||
      start.commitIntentId !== progress.intent.intentId ||
      start.commitIntentContentSha256 !== progress.intent.contentSha256 ||
      start.baselineContentSha256 !== progress.baseline.contentSha256 ||
      start.proofEvidenceContentSha256 !== progress.proofEvidenceContentSha256 ||
      start.previousProgressContentSha256 !== progress.contentSha256 ||
      !managedStartIsCanonical(start) ||
      Date.parse(progress.occurredAt) > Date.parse(start.startedAt) ||
      Date.parse(start.startedAt) >= Date.parse(submission.currentLease.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Managed-start submission is not canonical or lease-current',
      });
    }
  });
export type CompanionExecutionTrackExecutionManagedStartSubmission = z.infer<
  typeof companionExecutionTrackExecutionManagedStartSubmissionSchema
>;

export const companionExecutionTrackExecutionManagedStartAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
const managedResultReferenceShape = {
  startCheckpointId: z.uuid(),
  commitIntentId: z.uuid(),
  commitIntentContentSha256: sha256Schema,
  baselineContentSha256: sha256Schema,
  proofEvidenceContentSha256: sha256Schema,
  lastProgressContentSha256: sha256Schema,
  managedStart: companionExecutionTrackExecutionManagedStartSchema,
} as const;
const managedFailureResultSchema = z.strictObject({
  ...resultIdentityShape,
  status: z.literal('failed_managed'),
  ...managedResultReferenceShape,
  managedReport: z.strictObject({
    reportId: z.uuid(),
    sequence: z.number().int().positive(),
    transition: z.literal('step_observation_failed'),
    stepId: createShape.leafId,
    contentSha256: sha256Schema,
  }),
  managedCheckpoint: z.strictObject({
    checkpointId: z.uuid(),
    previousCheckpointId: z.uuid(),
    operation: z.literal('next'),
    receiptStepIds: z.tuple([createShape.leafId]),
    contentSha256: sha256Schema,
  }),
  observationGate: z.strictObject({
    stepId: createShape.leafId,
    status: z.enum(['repair_required', 'rollback_failed']),
    failureStrategy: z.enum(['retain_for_repair', 'rollback_step']),
    message: z.string().min(1),
  }),
  failedObservation: z.strictObject({
    observationIndex: z.number().int().nonnegative(),
    kind: z.string().min(1),
    satisfied: z.literal(false),
    contentSha256: sha256Schema,
  }),
  retainsTargetLock: z.literal(true),
  error: z.string().min(1).max(2_000),
});
const recoveryResultSchema = z.strictObject({
  ...resultIdentityShape,
  status: z.literal('recovery_required'),
  recoveryReason: z.enum([
    'proof_history_locked',
    'baseline_unproven',
    'managed_state_indeterminate',
    'document_authority_drift',
  ]),
  lastProgressContentSha256: sha256Schema,
  commitIntentId: z.uuid().optional(),
  commitIntentContentSha256: sha256Schema.optional(),
  managedStart: companionExecutionTrackExecutionManagedStartSchema.optional(),
  automaticReplay: z.literal(false),
  error: z.string().min(1).max(2_000),
});
const successResultSchema = z.strictObject({
  ...resultIdentityShape,
  status: z.literal('succeeded'),
  ...managedResultReferenceShape,
  managedReport: z.strictObject({
    reportId: z.uuid(),
    sequence: z.number().int().positive(),
    transition: z.literal('step_succeeded'),
    stepId: createShape.leafId,
    contentSha256: sha256Schema,
  }),
  managedCheckpoint: z.strictObject({
    checkpointId: z.uuid(),
    previousCheckpointId: z.uuid(),
    operation: z.literal('next'),
    receiptStepIds: z.tuple([createShape.leafId]),
    contentSha256: sha256Schema,
  }),
  managedObservation: z.strictObject({
    observationIndex: z.number().int().nonnegative(),
    kind: z.literal('uv_sphere_ready'),
    contentSha256: sha256Schema,
  }),
});
export const companionExecutionTrackExecutionResultSchema = z
  .discriminatedUnion('status', [
    successResultSchema,
    noMutationResultSchema,
    restoredResultSchema,
    managedFailureResultSchema,
    recoveryResultSchema,
  ])
  .superRefine((result, context) => {
    let valid =
      result.currentLease.leaseId === result.leaseId &&
      computeProtocolCanonicalJsonSha256(result.currentLease.target) ===
        computeProtocolCanonicalJsonSha256(result.target) &&
      Date.parse(result.occurredAt) < Date.parse(result.currentLease.expiresAt);
    if (result.status === 'succeeded' || result.status === 'failed_managed') {
      const start = result.managedStart;
      valid &&=
        start.commitIntentId === result.commitIntentId &&
        start.commitIntentContentSha256 === result.commitIntentContentSha256 &&
        start.baselineContentSha256 === result.baselineContentSha256 &&
        start.proofEvidenceContentSha256 === result.proofEvidenceContentSha256 &&
        start.previousProgressContentSha256 === result.lastProgressContentSha256 &&
        managedStartIsCanonical(start) &&
        Date.parse(start.startedAt) <= Date.parse(result.occurredAt);
      valid &&=
        result.managedReport.stepId === result.leafId &&
        result.managedCheckpoint.previousCheckpointId === result.startCheckpointId &&
        result.managedCheckpoint.checkpointId !== result.startCheckpointId;
    }
    if (result.status === 'succeeded') {
      valid &&=
        result.managedCheckpoint.receiptStepIds.length === 1 &&
        result.managedCheckpoint.receiptStepIds[0] === result.leafId;
    } else if (result.status === 'failed_managed') {
      valid &&=
        result.managedCheckpoint.receiptStepIds.length === 1 &&
        result.managedCheckpoint.receiptStepIds[0] === result.leafId &&
        result.observationGate.stepId === result.leafId &&
        ((result.observationGate.status === 'repair_required' &&
          result.observationGate.failureStrategy === 'retain_for_repair') ||
          (result.observationGate.status === 'rollback_failed' &&
            result.observationGate.failureStrategy === 'rollback_step'));
    }
    if (result.status === 'recovery_required') {
      const managed = result.recoveryReason === 'managed_state_indeterminate';
      const hasManagedReferences =
        result.commitIntentId !== undefined &&
        result.commitIntentContentSha256 !== undefined &&
        result.managedStart !== undefined;
      valid &&= managed === hasManagedReferences;
      if (managed && result.managedStart !== undefined) {
        valid &&=
          result.managedStart.commitIntentId === result.commitIntentId &&
          result.managedStart.commitIntentContentSha256 === result.commitIntentContentSha256 &&
          result.managedStart.previousProgressContentSha256 === result.lastProgressContentSha256 &&
          managedStartIsCanonical(result.managedStart);
      }
      if (!managed) {
        valid &&=
          result.commitIntentId === undefined &&
          result.commitIntentContentSha256 === undefined &&
          result.managedStart === undefined;
      }
    }
    if (!valid)
      context.addIssue({ code: 'custom', message: 'Execution result evidence is not durable' });
  });
export type CompanionExecutionTrackExecutionResult = z.infer<
  typeof companionExecutionTrackExecutionResultSchema
>;

export const companionExecutionTrackExecutionStatusValueSchema = z.enum([
  'queued',
  'dispatched',
  'baseline_attested',
  'proof_in_progress',
  'proof_observed_locked',
  'restore_in_progress',
  'baseline_restored',
  'commit_intent_recorded',
  'managed_action_in_progress',
  'pre_dispatch_authority_expired',
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_managed',
  'recovery_required',
]);

const recoveryDurableReferencesSchema = z.strictObject({
  terminalMarkerContentSha256: sha256Schema.nullable(),
  managedStartContentSha256: sha256Schema.nullable(),
  baselineContentSha256: sha256Schema.nullable(),
  commitIntentId: z.uuid().nullable(),
  commitIntentContentSha256: sha256Schema.nullable(),
});
type RecoveryDurableReferences = z.infer<typeof recoveryDurableReferencesSchema>;

function durableReferencesMatchProgress(
  references: RecoveryDurableReferences,
  progress: CompanionExecutionTrackExecutionProgress | null,
): boolean {
  if (progress === null) {
    return Object.values(references).every((value) => value === null);
  }
  if (
    progress.phase === 'baseline_attested' ||
    progress.phase === 'proof_in_progress' ||
    progress.phase === 'proof_observed_locked' ||
    progress.phase === 'restore_in_progress'
  ) {
    return Object.values(references).every((value) => value === null);
  }
  if (progress.phase === 'baseline_restored') {
    return (
      references.terminalMarkerContentSha256 === null &&
      references.managedStartContentSha256 === null &&
      references.baselineContentSha256 === progress.baseline.contentSha256 &&
      references.commitIntentId === null &&
      references.commitIntentContentSha256 === null
    );
  }
  return (
    references.baselineContentSha256 === progress.baseline.contentSha256 &&
    references.commitIntentId === progress.intent.intentId &&
    references.commitIntentContentSha256 === progress.intent.contentSha256
  );
}

const companionExecutionTrackExecutionServerRecoveryEvidenceSchema = z.strictObject({
  source: z.enum(['coordinator_restart', 'document_authority_drift']),
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  bindingContentSha256: sha256Schema,
  target: targetSchema,
  leaseId: z.uuid(),
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
  acceptedProgressChainHeadContentSha256: sha256Schema.nullable(),
  durableReferences: recoveryDurableReferencesSchema,
  priorStatus: z.enum([
    'dispatched',
    'baseline_attested',
    'proof_in_progress',
    'proof_observed_locked',
    'restore_in_progress',
    'baseline_restored',
    'commit_intent_recorded',
    'managed_action_in_progress',
  ]),
  detectedAt: timestampSchema,
  resolution: z.enum(['failed_no_mutation', 'failed_restored', 'recovery_required']),
  retainsTargetLock: z.boolean(),
  automaticReplay: z.literal(false),
});

const companionExecutionTrackExecutionPreDispatchAuthorityExpirationEvidenceSchema = z.strictObject(
  {
    source: z.literal('document_authority_drift'),
    requestId: z.uuid(),
    bindingContentSha256: sha256Schema,
    target: targetSchema,
    priorStatus: z.literal('queued'),
    detectedAt: timestampSchema,
    resolution: z.literal('pre_dispatch_authority_expired'),
    retainsTargetLock: z.literal(false),
    automaticReplay: z.literal(false),
  },
);

export const companionExecutionTrackExecutionStatusSchema = z
  .strictObject({
    binding: companionExecutionTrackExecutionBindingSchema,
    deliveryId: z.uuid().optional(),
    lease: companionExecutionTrackPreflightLeaseSchema.optional(),
    dispatchedAt: timestampSchema.optional(),
    status: companionExecutionTrackExecutionStatusValueSchema,
    progress: companionExecutionTrackExecutionProgressSchema.optional(),
    managedStart: companionExecutionTrackExecutionManagedStartSchema.optional(),
    result: companionExecutionTrackExecutionResultSchema.optional(),
    serverRecoveryEvidence: companionExecutionTrackExecutionServerRecoveryEvidenceSchema.optional(),
    preDispatchAuthorityExpirationEvidence:
      companionExecutionTrackExecutionPreDispatchAuthorityExpirationEvidenceSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((status, context) => {
    const deliveryFieldCount = [status.deliveryId, status.lease, status.dispatchedAt].filter(
      (value) => value !== undefined,
    ).length;
    const delivered = deliveryFieldCount === 3;
    const activePhases = new Set([
      'baseline_attested',
      'proof_in_progress',
      'proof_observed_locked',
      'restore_in_progress',
      'baseline_restored',
      'commit_intent_recorded',
    ]);
    let valid = Date.parse(status.updatedAt) >= Date.parse(status.binding.requestedAt);
    valid &&= deliveryFieldCount === 0 || deliveryFieldCount === 3;
    if (status.status === 'queued') {
      valid &&=
        !delivered &&
        status.updatedAt === status.binding.requestedAt &&
        status.progress === undefined &&
        status.preDispatchAuthorityExpirationEvidence === undefined;
    } else if (status.status === 'pre_dispatch_authority_expired') {
      const evidence = status.preDispatchAuthorityExpirationEvidence;
      valid &&=
        !delivered &&
        status.progress === undefined &&
        status.managedStart === undefined &&
        status.result === undefined &&
        status.serverRecoveryEvidence === undefined &&
        evidence !== undefined &&
        evidence.requestId === status.binding.requestId &&
        evidence.bindingContentSha256 === status.binding.bindingContentSha256 &&
        computeProtocolCanonicalJsonSha256(evidence.target) ===
          computeProtocolCanonicalJsonSha256(status.binding.target) &&
        Date.parse(status.binding.requestedAt) <= Date.parse(evidence.detectedAt) &&
        status.updatedAt === evidence.detectedAt;
    } else valid &&= delivered && status.preDispatchAuthorityExpirationEvidence === undefined;
    if (activePhases.has(status.status)) valid &&= status.progress?.phase === status.status;
    if (status.progress !== undefined) {
      valid &&=
        activePhases.has(status.status) ||
        status.status === 'managed_action_in_progress' ||
        [
          'succeeded',
          'failed_no_mutation',
          'failed_restored',
          'failed_managed',
          'recovery_required',
        ].includes(status.status);
    }
    if (status.status === 'managed_action_in_progress') {
      const managedStartContent =
        status.managedStart === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(status.managedStart).filter(([key]) => key !== 'contentSha256'),
            );
      valid &&=
        status.managedStart !== undefined &&
        status.progress?.phase === 'commit_intent_recorded' &&
        status.managedStart.commitIntentId === status.progress.intent.intentId &&
        status.managedStart.commitIntentContentSha256 === status.progress.intent.contentSha256 &&
        status.managedStart.baselineContentSha256 === status.progress.baseline.contentSha256 &&
        status.managedStart.proofEvidenceContentSha256 ===
          status.progress.proofEvidenceContentSha256 &&
        status.managedStart.previousProgressContentSha256 === status.progress.contentSha256 &&
        status.managedStart.contentSha256 ===
          computeProtocolCanonicalJsonSha256(managedStartContent) &&
        Date.parse(status.progress.occurredAt) <= Date.parse(status.managedStart.startedAt) &&
        Date.parse(status.managedStart.startedAt) <= Date.parse(status.updatedAt);
    } else valid &&= status.managedStart === undefined;
    const terminal = [
      'succeeded',
      'failed_no_mutation',
      'failed_restored',
      'failed_managed',
      'recovery_required',
    ].includes(status.status);
    if (status.status === 'pre_dispatch_authority_expired') {
      valid &&= status.result === undefined && status.serverRecoveryEvidence === undefined;
    } else if (!terminal)
      valid &&= status.result === undefined && status.serverRecoveryEvidence === undefined;
    else if (status.status === 'succeeded' || status.status === 'failed_managed') {
      valid &&=
        status.result?.status === status.status && status.serverRecoveryEvidence === undefined;
    } else {
      valid &&=
        (status.result?.status === status.status) !==
        (status.serverRecoveryEvidence?.resolution === status.status);
    }
    if (delivered) {
      valid &&=
        companionExecutionTrackExecutionDeliverySchema.safeParse({
          binding: status.binding,
          deliveryId: status.deliveryId,
          lease: status.lease,
          dispatchedAt: status.dispatchedAt,
        }).success && Date.parse(status.dispatchedAt!) <= Date.parse(status.updatedAt);
    }
    if (status.progress !== undefined) {
      valid &&=
        status.progress.binding.bindingContentSha256 === status.binding.bindingContentSha256 &&
        status.progress.deliveryId === status.deliveryId &&
        computeProtocolCanonicalJsonSha256(status.progress.lease) ===
          computeProtocolCanonicalJsonSha256(status.lease) &&
        status.progress.currentLease.leaseId === status.lease?.leaseId &&
        status.progress.currentLease.sessionId === status.lease?.sessionId &&
        status.progress.currentLease.documentIncarnationId ===
          status.lease?.documentIncarnationId &&
        computeProtocolCanonicalJsonSha256(status.progress.currentLease.target) ===
          computeProtocolCanonicalJsonSha256(status.lease?.target) &&
        Date.parse(status.lease!.expiresAt) <= Date.parse(status.progress.currentLease.expiresAt) &&
        status.progress.dispatchedAt === status.dispatchedAt &&
        Date.parse(status.progress.occurredAt) <= Date.parse(status.updatedAt);
    }
    if (status.result !== undefined) {
      const result = status.result;
      valid &&=
        result.requestId === status.binding.requestId &&
        result.deliveryId === status.deliveryId &&
        result.bindingContentSha256 === status.binding.bindingContentSha256 &&
        computeProtocolCanonicalJsonSha256(result.target) ===
          computeProtocolCanonicalJsonSha256(status.binding.target) &&
        result.leaseId === status.lease?.leaseId &&
        result.currentLease.leaseId === status.lease?.leaseId &&
        result.currentLease.sessionId === status.lease?.sessionId &&
        result.currentLease.documentIncarnationId === status.lease?.documentIncarnationId &&
        computeProtocolCanonicalJsonSha256(result.currentLease.target) ===
          computeProtocolCanonicalJsonSha256(status.lease?.target) &&
        Date.parse(status.progress?.currentLease.expiresAt ?? status.lease!.expiresAt) <=
          Date.parse(result.currentLease.expiresAt) &&
        result.proposalId === status.binding.proposalId &&
        result.planId === status.binding.plan.id &&
        result.planRevision === status.binding.plan.revision &&
        result.executionId === status.binding.executionId &&
        result.leafId === status.binding.leafId &&
        Date.parse(status.dispatchedAt!) <= Date.parse(result.occurredAt) &&
        Date.parse(result.occurredAt) < Date.parse(result.currentLease.expiresAt) &&
        Date.parse(result.occurredAt) <= Date.parse(status.updatedAt);
      if (result.status === 'failed_no_mutation') {
        valid &&=
          status.progress?.phase === 'baseline_attested' &&
          result.startCheckpointId === status.progress.startCheckpoint.checkpointId &&
          result.baselineAttestationContentSha256 ===
            status.progress.startAttestation.contentSha256 &&
          result.lastProgressContentSha256 === status.progress.contentSha256;
      } else if (result.status === 'failed_restored') {
        valid &&=
          status.progress?.phase === 'baseline_restored' &&
          result.baselineContentSha256 === status.progress.baseline.contentSha256 &&
          result.proofEvidenceContentSha256 === status.progress.proofEvidenceContentSha256 &&
          result.lastProgressContentSha256 === status.progress.contentSha256;
      } else if (result.status === 'recovery_required') {
        const recoveryProgress = status.progress;
        valid &&=
          recoveryProgress !== undefined &&
          result.lastProgressContentSha256 === recoveryProgress.contentSha256;
        if (result.recoveryReason === 'managed_state_indeterminate') {
          valid &&=
            recoveryProgress?.phase === 'commit_intent_recorded' &&
            result.commitIntentId === recoveryProgress?.intent.intentId &&
            result.commitIntentContentSha256 === recoveryProgress?.intent.contentSha256 &&
            result.managedStart?.baselineContentSha256 ===
              recoveryProgress?.baseline.contentSha256 &&
            result.managedStart?.proofEvidenceContentSha256 ===
              recoveryProgress?.proofEvidenceContentSha256;
        }
      } else if (result.status === 'succeeded' || result.status === 'failed_managed') {
        valid &&=
          status.progress?.phase === 'commit_intent_recorded' &&
          result.commitIntentId === status.progress.intent.intentId &&
          result.commitIntentContentSha256 === status.progress.intent.contentSha256 &&
          result.baselineContentSha256 === status.progress.baseline.contentSha256 &&
          result.proofEvidenceContentSha256 === status.progress.proofEvidenceContentSha256 &&
          result.lastProgressContentSha256 === status.progress.contentSha256 &&
          result.startCheckpointId === status.progress.baseline.startCheckpointId &&
          result.managedStart.baselineContentSha256 === status.progress.baseline.contentSha256 &&
          result.managedStart.proofEvidenceContentSha256 ===
            status.progress.proofEvidenceContentSha256 &&
          Date.parse(status.progress.occurredAt) <= Date.parse(result.managedStart.startedAt) &&
          Date.parse(status.progress.intent.recordedAt) <=
            Date.parse(result.managedStart.startedAt) &&
          Date.parse(result.managedStart.startedAt) <= Date.parse(result.occurredAt) &&
          result.managedReport.sequence > status.binding.expectedState.sequence;
      }
    }
    if (status.serverRecoveryEvidence !== undefined) {
      const evidence = status.serverRecoveryEvidence;
      valid &&=
        evidence.requestId === status.binding.requestId &&
        evidence.deliveryId === status.deliveryId &&
        evidence.bindingContentSha256 === status.binding.bindingContentSha256 &&
        computeProtocolCanonicalJsonSha256(evidence.target) ===
          computeProtocolCanonicalJsonSha256(status.binding.target) &&
        evidence.leaseId === status.lease?.leaseId &&
        evidence.sessionId === status.lease?.sessionId &&
        evidence.documentIncarnationId === status.lease?.documentIncarnationId &&
        evidence.acceptedProgressChainHeadContentSha256 ===
          (status.progress?.contentSha256 ?? null) &&
        durableReferencesMatchProgress(evidence.durableReferences, status.progress ?? null) &&
        (status.progress === undefined ||
          Date.parse(status.progress.occurredAt) <= Date.parse(evidence.detectedAt)) &&
        (evidence.priorStatus === 'managed_action_in_progress'
          ? evidence.durableReferences.managedStartContentSha256 !== null
          : evidence.durableReferences.managedStartContentSha256 === null) &&
        (evidence.durableReferences.terminalMarkerContentSha256 === null ||
          (evidence.source === 'coordinator_restart' &&
            evidence.priorStatus === 'managed_action_in_progress' &&
            status.status === 'recovery_required' &&
            status.progress?.phase === 'commit_intent_recorded')) &&
        (evidence.priorStatus === 'dispatched'
          ? status.progress === undefined
          : evidence.priorStatus === 'managed_action_in_progress'
            ? status.progress?.phase === 'commit_intent_recorded'
            : status.progress?.phase === evidence.priorStatus) &&
        evidence.resolution === status.status &&
        evidence.retainsTargetLock === (status.status === 'recovery_required') &&
        (evidence.source === 'document_authority_drift'
          ? status.status === 'recovery_required'
          : evidence.priorStatus === 'dispatched'
            ? status.status === 'failed_no_mutation'
            : evidence.priorStatus === 'baseline_restored'
              ? status.status === 'failed_restored'
              : status.status === 'recovery_required') &&
        (status.progress?.phase !== 'baseline_restored' ||
          evidence.durableReferences.baselineContentSha256 ===
            status.progress.baseline.contentSha256) &&
        (status.progress?.phase !== 'commit_intent_recorded' ||
          (evidence.durableReferences.baselineContentSha256 ===
            status.progress.baseline.contentSha256 &&
            evidence.durableReferences.commitIntentId === status.progress.intent.intentId &&
            evidence.durableReferences.commitIntentContentSha256 ===
              status.progress.intent.contentSha256)) &&
        Date.parse(status.dispatchedAt!) <= Date.parse(evidence.detectedAt) &&
        Date.parse(evidence.detectedAt) <= Date.parse(status.updatedAt);
    }
    if (!valid)
      context.addIssue({ code: 'custom', message: 'Execution status lifecycle is inconsistent' });
  });

export const companionExecutionTrackExecutionStatusRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export const companionExecutionTrackExecutionPollRequestSchema = targetSchema;
export const companionExecutionTrackExecutionPollDeliverySchema = z.strictObject({
  request: companionExecutionTrackExecutionDeliverySchema.nullable(),
});
export const companionExecutionTrackExecutionProgressAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
export const companionExecutionTrackExecutionResultAckSchema =
  companionExecutionTrackExecutionProgressAckSchema;

export const companionExecutionTrackExecutionRecoveryRequestSchema = z
  .strictObject({
    formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
    recoveryId: z.uuid(),
    requestId: z.uuid(),
    target: targetSchema,
    originalDeliveryId: z.uuid(),
    bindingContentSha256: sha256Schema,
    originalLease: companionExecutionTrackPreflightLeaseSchema,
    replacementLease: companionExecutionTrackPreflightLeaseSchema,
    acceptedProgress: companionExecutionTrackExecutionProgressSchema.nullable(),
    acceptedProgressChainHeadContentSha256: sha256Schema.nullable(),
    durableReferences: recoveryDurableReferencesSchema,
    source: z.enum(['coordinator_restart', 'document_authority_drift', 'companion_reported']),
    mode: z.literal('read_only_reconcile'),
    automaticReplay: z.literal(false),
    requestedAt: timestampSchema,
  })
  .superRefine((request, context) => {
    const original = request.originalLease;
    const replacement = request.replacementLease;
    const pairedIntent =
      (request.durableReferences.commitIntentId === null) ===
      (request.durableReferences.commitIntentContentSha256 === null);
    const valid =
      request.target.adapterId === original.target.adapterId &&
      request.target.instanceId === original.target.instanceId &&
      computeProtocolCanonicalJsonSha256(replacement.target) ===
        computeProtocolCanonicalJsonSha256(original.target) &&
      replacement.leaseId !== original.leaseId &&
      replacement.sessionId === original.sessionId &&
      replacement.documentIncarnationId === original.documentIncarnationId &&
      Date.parse(original.expiresAt) <= Date.parse(replacement.expiresAt) &&
      Date.parse(request.requestedAt) < Date.parse(replacement.expiresAt) &&
      pairedIntent &&
      request.acceptedProgressChainHeadContentSha256 ===
        (request.acceptedProgress?.contentSha256 ?? null) &&
      durableReferencesMatchProgress(request.durableReferences, request.acceptedProgress) &&
      (request.acceptedProgress === null ||
        (request.acceptedProgress.binding.requestId === request.requestId &&
          request.acceptedProgress.binding.bindingContentSha256 === request.bindingContentSha256 &&
          request.acceptedProgress.deliveryId === request.originalDeliveryId &&
          computeProtocolCanonicalJsonSha256(request.acceptedProgress.lease) ===
            computeProtocolCanonicalJsonSha256(request.originalLease) &&
          Date.parse(request.acceptedProgress.occurredAt) <= Date.parse(request.requestedAt)));
    if (!valid) {
      context.addIssue({ code: 'custom', message: 'Recovery challenge authority is inconsistent' });
    }
  });

export const companionExecutionTrackExecutionRecoveryPollDeliverySchema = z.strictObject({
  request: companionExecutionTrackExecutionRecoveryRequestSchema.nullable(),
});

const recoveryCurrentStateAttestationSchema = z.strictObject({
  replacementLeaseId: z.uuid(),
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
  sceneFingerprintSha256: sha256Schema,
  viewLayerIdentitySha256: sha256Schema,
  objectIdentitySha256: sha256Schema,
  meshIdentitySha256: sha256Schema,
  collectionIdentitySha256: sha256Schema,
  sessionUidDomainSha256: sha256Schema,
  pointerDomainSha256: sha256Schema,
  linksAndSelectionSha256: sha256Schema,
  observedAt: timestampSchema,
  contentSha256: sha256Schema,
});
export const companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema = z.strictObject({
  kind: z.literal('persisted_managed_terminal'),
  terminalStatus: z.literal('succeeded'),
  terminalResultContentSha256: sha256Schema,
  managedReportId: z.uuid(),
  managedReportSequence: z.number().int().positive(),
  managedCheckpointId: z.uuid(),
  sceneFingerprintSha256: sha256Schema,
  viewLayerIdentitySha256: sha256Schema,
  objectIdentitySha256: sha256Schema,
  meshIdentitySha256: sha256Schema,
  collectionIdentitySha256: sha256Schema,
  sessionUidDomainSha256: sha256Schema,
  pointerDomainSha256: sha256Schema,
  linksAndSelectionSha256: sha256Schema,
  contentSha256: sha256Schema,
});
export type CompanionExecutionTrackExecutionPersistedManagedTerminalMarker = z.infer<
  typeof companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema
>;
const recoveryReconciliationEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('persisted_managed_terminal'),
    terminalResult: successResultSchema,
    terminalResultContentSha256: sha256Schema,
    terminalMarker: companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema,
    currentState: recoveryCurrentStateAttestationSchema,
  }),
  z.strictObject({
    kind: z.literal('baseline_terminal'),
    terminalResult: z.union([noMutationResultSchema, restoredResultSchema]),
    terminalResultContentSha256: sha256Schema,
    progress: canonicalRecoveryBaselineProgressSchema,
    currentState: recoveryCurrentStateAttestationSchema,
  }),
  z.strictObject({
    kind: z.literal('unresolved_current_state'),
    reason: z.enum([
      'proof_or_restore_indeterminate',
      'managed_state_indeterminate',
      'document_authority_drift',
    ]),
    currentState: recoveryCurrentStateAttestationSchema,
  }),
]);

function recoveryResultIdentityMatchesRequest(
  result: CompanionExecutionTrackExecutionResult,
  request: z.infer<typeof companionExecutionTrackExecutionRecoveryRequestSchema>,
): boolean {
  const binding = request.acceptedProgress?.binding;
  return (
    binding !== undefined &&
    result.requestId === request.requestId &&
    result.deliveryId === request.originalDeliveryId &&
    result.bindingContentSha256 === request.bindingContentSha256 &&
    computeProtocolCanonicalJsonSha256(result.target) ===
      computeProtocolCanonicalJsonSha256(request.target) &&
    result.leaseId === request.originalLease.leaseId &&
    result.currentLease.leaseId === request.originalLease.leaseId &&
    result.currentLease.sessionId === request.originalLease.sessionId &&
    result.currentLease.documentIncarnationId === request.originalLease.documentIncarnationId &&
    computeProtocolCanonicalJsonSha256(result.currentLease.target) ===
      computeProtocolCanonicalJsonSha256(request.originalLease.target) &&
    result.proposalId === binding.proposalId &&
    result.planId === binding.plan.id &&
    result.planRevision === binding.plan.revision &&
    result.executionId === binding.executionId &&
    result.leafId === binding.leafId
  );
}

export const companionExecutionTrackExecutionRecoveryAckSchema = z
  .strictObject({
    formatVersion: companionExecutionTrackExecutionFormatVersionSchema,
    request: companionExecutionTrackExecutionRecoveryRequestSchema,
    recoveryId: z.uuid(),
    requestId: z.uuid(),
    originalDeliveryId: z.uuid(),
    bindingContentSha256: sha256Schema,
    replacementLeaseId: z.uuid(),
    acceptedProgressChainHeadContentSha256: sha256Schema.nullable(),
    durableReferences: recoveryDurableReferencesSchema,
    outcome: z.enum(['reconciled', 'recovery_required']),
    evidence: recoveryReconciliationEvidenceSchema,
    retainsTargetLock: z.boolean(),
    automaticReplay: z.literal(false),
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    const request = ack.request;
    const state = ack.evidence.currentState;
    const { contentSha256: stateHash, ...stateContent } = state;
    const mirrors =
      ack.recoveryId === request.recoveryId &&
      ack.requestId === request.requestId &&
      ack.originalDeliveryId === request.originalDeliveryId &&
      ack.bindingContentSha256 === request.bindingContentSha256 &&
      ack.replacementLeaseId === request.replacementLease.leaseId &&
      ack.acceptedProgressChainHeadContentSha256 ===
        request.acceptedProgressChainHeadContentSha256 &&
      computeProtocolCanonicalJsonSha256(ack.durableReferences) ===
        computeProtocolCanonicalJsonSha256(request.durableReferences) &&
      Date.parse(request.requestedAt) <= Date.parse(ack.occurredAt) &&
      Date.parse(ack.occurredAt) < Date.parse(request.replacementLease.expiresAt) &&
      state.replacementLeaseId === request.replacementLease.leaseId &&
      state.sessionId === request.replacementLease.sessionId &&
      state.documentIncarnationId === request.replacementLease.documentIncarnationId &&
      stateHash === computeProtocolCanonicalJsonSha256(stateContent) &&
      state.sequence >= (request.acceptedProgress?.binding.expectedState.sequence ?? 1) &&
      Date.parse(request.requestedAt) <= Date.parse(state.observedAt) &&
      Date.parse(state.observedAt) <= Date.parse(ack.occurredAt);
    let evidenceValid: boolean;
    if (ack.evidence.kind === 'persisted_managed_terminal') {
      const parsedResult = companionExecutionTrackExecutionResultSchema.safeParse(
        ack.evidence.terminalResult,
      );
      if (!parsedResult.success) {
        context.addIssue({ code: 'custom', message: 'Managed terminal evidence is invalid' });
        return;
      }
      const result = parsedResult.data;
      const marker = ack.evidence.terminalMarker;
      const { contentSha256: markerHash, ...markerContent } = marker;
      evidenceValid =
        request.source !== 'document_authority_drift' &&
        ack.outcome === 'reconciled' &&
        !ack.retainsTargetLock &&
        result.status === marker.terminalStatus &&
        ack.evidence.terminalResultContentSha256 === computeProtocolCanonicalJsonSha256(result) &&
        marker.terminalResultContentSha256 === ack.evidence.terminalResultContentSha256 &&
        marker.managedReportId === result.managedReport.reportId &&
        marker.managedReportSequence === result.managedReport.sequence &&
        marker.managedCheckpointId === result.managedCheckpoint.checkpointId &&
        markerHash === computeProtocolCanonicalJsonSha256(markerContent) &&
        (request.durableReferences.terminalMarkerContentSha256 === null ||
          request.durableReferences.terminalMarkerContentSha256 === marker.contentSha256) &&
        request.durableReferences.managedStartContentSha256 !== null &&
        request.durableReferences.managedStartContentSha256 === result.managedStart.contentSha256 &&
        request.durableReferences.baselineContentSha256 === result.baselineContentSha256 &&
        request.durableReferences.commitIntentId === result.commitIntentId &&
        request.durableReferences.commitIntentContentSha256 === result.commitIntentContentSha256 &&
        request.acceptedProgress?.phase === 'commit_intent_recorded' &&
        request.acceptedProgress.contentSha256 === result.lastProgressContentSha256 &&
        recoveryResultIdentityMatchesRequest(result, request) &&
        Date.parse(request.acceptedProgress.currentLease.expiresAt) <=
          Date.parse(result.currentLease.expiresAt) &&
        Date.parse(result.managedStart.startedAt) <= Date.parse(request.requestedAt) &&
        Date.parse(result.occurredAt) <= Date.parse(request.requestedAt) &&
        state.sceneFingerprintSha256 === marker.sceneFingerprintSha256 &&
        state.viewLayerIdentitySha256 === marker.viewLayerIdentitySha256 &&
        state.objectIdentitySha256 === marker.objectIdentitySha256 &&
        state.meshIdentitySha256 === marker.meshIdentitySha256 &&
        state.collectionIdentitySha256 === marker.collectionIdentitySha256 &&
        state.sessionUidDomainSha256 === marker.sessionUidDomainSha256 &&
        state.pointerDomainSha256 === marker.pointerDomainSha256 &&
        state.linksAndSelectionSha256 === marker.linksAndSelectionSha256 &&
        state.reportId === result.managedReport.reportId &&
        state.sequence === result.managedReport.sequence &&
        result.managedReport.sequence > request.acceptedProgress.binding.expectedState.sequence &&
        Date.parse(result.occurredAt) <= Date.parse(state.observedAt);
    } else if (ack.evidence.kind === 'baseline_terminal') {
      const parsedResult = companionExecutionTrackExecutionResultSchema.safeParse(
        ack.evidence.terminalResult,
      );
      if (!parsedResult.success) {
        context.addIssue({ code: 'custom', message: 'Baseline terminal evidence is invalid' });
        return;
      }
      const result = parsedResult.data;
      const progress = ack.evidence.progress;
      const baselineIdentity =
        progress.phase === 'baseline_attested'
          ? {
              sceneFingerprintSha256: progress.startAttestation.sceneFingerprintSha256,
              ...progress.startAttestation.identitySnapshot,
            }
          : progress.phase === 'baseline_restored'
            ? progress.baseline
            : null;
      evidenceValid =
        request.source !== 'document_authority_drift' &&
        ack.outcome === 'reconciled' &&
        !ack.retainsTargetLock &&
        request.durableReferences.terminalMarkerContentSha256 === null &&
        request.durableReferences.managedStartContentSha256 === null &&
        ack.evidence.terminalResultContentSha256 === computeProtocolCanonicalJsonSha256(result) &&
        computeProtocolCanonicalJsonSha256(progress) ===
          computeProtocolCanonicalJsonSha256(request.acceptedProgress) &&
        progress.contentSha256 === request.acceptedProgressChainHeadContentSha256 &&
        progress.contentSha256 === request.acceptedProgress?.contentSha256 &&
        result.lastProgressContentSha256 === progress.contentSha256 &&
        ((result.status === 'failed_no_mutation' &&
          progress.phase === 'baseline_attested' &&
          result.startCheckpointId === progress.startCheckpoint.checkpointId &&
          result.baselineAttestationContentSha256 === progress.startAttestation.contentSha256) ||
          (result.status === 'failed_restored' &&
            progress.phase === 'baseline_restored' &&
            result.baselineContentSha256 === progress.baseline.contentSha256 &&
            result.proofEvidenceContentSha256 === progress.proofEvidenceContentSha256)) &&
        recoveryResultIdentityMatchesRequest(result, request) &&
        Date.parse(progress.currentLease.expiresAt) <= Date.parse(result.currentLease.expiresAt) &&
        Date.parse(progress.occurredAt) <= Date.parse(result.occurredAt) &&
        Date.parse(result.occurredAt) <= Date.parse(request.requestedAt) &&
        baselineIdentity !== null &&
        state.reportId === progress.binding.expectedState.reportId &&
        state.sequence === progress.binding.expectedState.sequence &&
        state.sceneFingerprintSha256 === baselineIdentity.sceneFingerprintSha256 &&
        state.viewLayerIdentitySha256 === baselineIdentity.viewLayerIdentitySha256 &&
        state.objectIdentitySha256 === baselineIdentity.objectIdentitySha256 &&
        state.meshIdentitySha256 === baselineIdentity.meshIdentitySha256 &&
        state.collectionIdentitySha256 === baselineIdentity.collectionIdentitySha256 &&
        state.sessionUidDomainSha256 === baselineIdentity.sessionUidDomainSha256 &&
        state.pointerDomainSha256 === baselineIdentity.pointerDomainSha256 &&
        state.linksAndSelectionSha256 === baselineIdentity.linksAndSelectionSha256;
    } else {
      const acceptedPhase = request.acceptedProgress?.phase;
      const reasonMatchesPhase =
        ack.evidence.reason === 'document_authority_drift'
          ? request.source === 'document_authority_drift'
          : ack.evidence.reason === 'managed_state_indeterminate'
            ? acceptedPhase === 'commit_intent_recorded'
            : acceptedPhase === 'baseline_attested' ||
              acceptedPhase === 'proof_in_progress' ||
              acceptedPhase === 'proof_observed_locked' ||
              acceptedPhase === 'restore_in_progress' ||
              acceptedPhase === 'baseline_restored';
      evidenceValid =
        ack.outcome === 'recovery_required' &&
        ack.retainsTargetLock &&
        (ack.evidence.reason !== 'proof_or_restore_indeterminate' ||
          (request.durableReferences.terminalMarkerContentSha256 === null &&
            request.durableReferences.managedStartContentSha256 === null)) &&
        reasonMatchesPhase;
    }
    if (!mirrors || !evidenceValid) {
      context.addIssue({
        code: 'custom',
        message: 'Recovery acknowledgement changed its challenge',
      });
    }
  });
