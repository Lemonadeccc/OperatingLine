import { z } from 'zod';

import {
  computeProcedureShortcutProofCanonicalContentSha256,
  computeProcedureShortcutProofNativeObservationContentSha256,
  computeProcedureShortcutProofOperationReceiptContentSha256,
  procedureShortcutProofAttestationSchema,
  procedureShortcutProofBindingSchema,
  procedureShortcutProofFormatVersionSchema,
  procedureShortcutProofFailureCheckpointSchema,
  procedureShortcutProofOperationReceiptSchema,
  subdivisionSurfaceShortcutProofOperationIds,
  subdivisionSurfaceShortcutProofOperationIdsSchema,
} from './procedure-shortcut-proof.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });

const deliveryIdentityShape = {
  formatVersion: procedureShortcutProofFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  proofId: z.uuid(),
  deliveryId: z.uuid(),
  target: targetSchema,
  targetProfile: z.literal('factory_cube_8_12_6'),
  proposalId: z.uuid(),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: z.string().min(1),
  interactionCatalogVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
  interactionCatalogContentSha256: sha256Schema,
  shortcutTrackContentSha256: sha256Schema,
  bindingContentSha256: sha256Schema,
  binding: procedureShortcutProofBindingSchema,
  executorId: z.literal('blender.subdivision_surface_f9.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: subdivisionSurfaceShortcutProofOperationIdsSchema,
  expectedState: expectedStateSchema,
  requestedAt: timestampSchema,
  dispatchedAt: timestampSchema,
} as const;

export const companionShortcutProofCreateRequestSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  expectedState: expectedStateSchema,
});
export type CompanionShortcutProofCreateRequest = z.infer<
  typeof companionShortcutProofCreateRequestSchema
>;

export const companionShortcutProofStatusRequestSchema = z.strictObject({ requestId: z.uuid() });
export type CompanionShortcutProofStatusRequest = z.infer<
  typeof companionShortcutProofStatusRequestSchema
>;

function bindingIdentityMatches(value: {
  requestId: string;
  replayId: string;
  proofId: string;
  target: { instanceId: string };
  targetProfile: 'factory_cube_8_12_6';
  proposalId: string;
  plan: { id: string; revision: number; contentSha256: string };
  executionId: string;
  leafId: string;
  interactionCatalogVersion: string;
  interactionCatalogContentSha256: string;
  shortcutTrackContentSha256: string;
  bindingContentSha256: string;
  expectedState: { reportId: string; sequence: number };
  binding: z.infer<typeof procedureShortcutProofBindingSchema>;
}): boolean {
  const binding = value.binding;
  return (
    binding.integrity.contentSha256 === value.bindingContentSha256 &&
    binding.requestId === value.requestId &&
    binding.replayId === value.replayId &&
    binding.proofId === value.proofId &&
    binding.target.instanceId === value.target.instanceId &&
    binding.targetProfile === value.targetProfile &&
    binding.proposalId === value.proposalId &&
    binding.plan.id === value.plan.id &&
    binding.plan.revision === value.plan.revision &&
    binding.plan.contentSha256 === value.plan.contentSha256 &&
    binding.executionId === value.executionId &&
    binding.leafId === value.leafId &&
    binding.materialization.interactionCatalogVersion === value.interactionCatalogVersion &&
    binding.materialization.interactionCatalogContentSha256 ===
      value.interactionCatalogContentSha256 &&
    binding.materialization.shortcutTrackContentSha256 === value.shortcutTrackContentSha256 &&
    binding.startState.reportId === value.expectedState.reportId &&
    binding.startState.sequence === value.expectedState.sequence
  );
}

type ShortcutProofReceipt = z.infer<typeof procedureShortcutProofOperationReceiptSchema>;

function receiptPrefixIsCanonical(
  receipts: ShortcutProofReceipt[],
  identity: {
    proofId: string;
    requestId: string;
    deliveryId: string;
    bindingContentSha256: string;
  },
): boolean {
  let previous: string | null = null;
  let previousOccurredAt = Number.NEGATIVE_INFINITY;
  for (const [index, receipt] of receipts.entries()) {
    const occurredAt = Date.parse(receipt.occurredAt);
    if (
      receipt.proofId !== identity.proofId ||
      receipt.requestId !== identity.requestId ||
      receipt.deliveryId !== identity.deliveryId ||
      receipt.bindingContentSha256 !== identity.bindingContentSha256 ||
      receipt.operationId !== subdivisionSurfaceShortcutProofOperationIds[index] ||
      receipt.order !== index + 1 ||
      receipt.previousReceiptContentSha256 !== previous ||
      occurredAt < previousOccurredAt ||
      receipt.contentSha256 !== computeProcedureShortcutProofOperationReceiptContentSha256(receipt)
    ) {
      return false;
    }
    previous = receipt.contentSha256;
    previousOccurredAt = occurredAt;
  }
  return true;
}

export const companionShortcutProofDeliverySchema = z
  .strictObject(deliveryIdentityShape)
  .superRefine((delivery, context) => {
    if (!bindingIdentityMatches(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Shortcut proof authority binding must mirror immutable delivery identity',
      });
    }
  });
export type CompanionShortcutProofDelivery = z.infer<typeof companionShortcutProofDeliverySchema>;

export const companionShortcutProofHistoryIdentitySchema = z.strictObject({
  checkpointId: z.uuid(),
  undoLockId: z.uuid(),
  checkpointKind: z.enum(['success', 'failure']),
  baselineSceneFingerprintSha256: sha256Schema,
  lockedSceneFingerprintSha256: sha256Schema,
  terminalResultContentSha256: sha256Schema,
});
export type CompanionShortcutProofHistoryIdentity = z.infer<
  typeof companionShortcutProofHistoryIdentitySchema
>;

export const companionShortcutProofHistoryStatusSchema = z.enum([
  'succeeded',
  'failed_checkpointed',
  'restored',
  'reapplied_locked',
]);
export type CompanionShortcutProofHistoryStatus = z.infer<
  typeof companionShortcutProofHistoryStatusSchema
>;

export const companionShortcutProofRecoveryDeliverySchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_history_rebind'),
    recoveryId: z.uuid(),
    history: companionShortcutProofHistoryIdentitySchema,
    expectedStatus: companionShortcutProofHistoryStatusSchema,
    expectedResultContentSha256: sha256Schema,
    expectedMarkerContentSha256: sha256Schema,
    recoveryRequestedAt: timestampSchema,
  })
  .superRefine((delivery, context) => {
    if (!bindingIdentityMatches(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Shortcut proof recovery must preserve the exact immutable delivery identity',
      });
    }
    if (Date.parse(delivery.recoveryRequestedAt) < Date.parse(delivery.dispatchedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryRequestedAt'],
        message: 'Shortcut proof recovery must be requested after its original delivery',
      });
    }
  });
export type CompanionShortcutProofRecoveryDelivery = z.infer<
  typeof companionShortcutProofRecoveryDeliverySchema
>;

export const companionShortcutProofTerminalReconciliationDeliverySchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_terminal_reconcile'),
    recoveryId: z.uuid(),
    acknowledgedProgressReceiptChainHeads: z.array(sha256Schema).max(4),
    recoveryRequestedAt: timestampSchema,
  })
  .superRefine((delivery, context) => {
    if (!bindingIdentityMatches(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message:
          'Shortcut proof terminal reconciliation must preserve the exact immutable delivery identity',
      });
    }
    if (Date.parse(delivery.recoveryRequestedAt) < Date.parse(delivery.dispatchedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryRequestedAt'],
        message: 'Shortcut proof terminal reconciliation must follow its original delivery',
      });
    }
    if (
      new Set(delivery.acknowledgedProgressReceiptChainHeads).size !==
      delivery.acknowledgedProgressReceiptChainHeads.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgedProgressReceiptChainHeads'],
        message: 'Acknowledged shortcut proof receipt heads must be unique and ordered',
      });
    }
  });
export type CompanionShortcutProofTerminalReconciliationDelivery = z.infer<
  typeof companionShortcutProofTerminalReconciliationDeliverySchema
>;

export const companionShortcutProofRecoveryAckSchema = z
  .strictObject({
    kind: z.literal('native_history_rebind'),
    formatVersion: procedureShortcutProofFormatVersionSchema,
    requestId: z.uuid(),
    replayId: z.uuid(),
    proofId: z.uuid(),
    deliveryId: z.uuid(),
    target: targetSchema,
    bindingContentSha256: sha256Schema,
    recoveryId: z.uuid(),
    history: companionShortcutProofHistoryIdentitySchema,
    status: companionShortcutProofHistoryStatusSchema,
    expectedMarkerContentSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    mutationLocked: z.boolean(),
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    const restored = ack.status === 'restored';
    const expectedFingerprint = restored
      ? ack.history.baselineSceneFingerprintSha256
      : ack.history.lockedSceneFingerprintSha256;
    if (ack.currentSceneFingerprintSha256 !== expectedFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['currentSceneFingerprintSha256'],
        message: 'Shortcut proof recovery acknowledgement must prove its expected history phase',
      });
    }
    if (ack.mutationLocked === restored) {
      context.addIssue({
        code: 'custom',
        path: ['mutationLocked'],
        message: 'Shortcut proof recovery acknowledgement lock must match its history phase',
      });
    }
  });
export type CompanionShortcutProofRecoveryAck = z.infer<
  typeof companionShortcutProofRecoveryAckSchema
>;

export function companionShortcutProofRecoveryAckMatchesDelivery(
  ack: CompanionShortcutProofRecoveryAck,
  delivery: CompanionShortcutProofRecoveryDelivery,
): boolean {
  return (
    ack.formatVersion === delivery.formatVersion &&
    ack.requestId === delivery.requestId &&
    ack.replayId === delivery.replayId &&
    ack.proofId === delivery.proofId &&
    ack.deliveryId === delivery.deliveryId &&
    ack.target.adapterId === delivery.target.adapterId &&
    ack.target.instanceId === delivery.target.instanceId &&
    ack.bindingContentSha256 === delivery.bindingContentSha256 &&
    ack.recoveryId === delivery.recoveryId &&
    ack.status === delivery.expectedStatus &&
    ack.history.checkpointId === delivery.history.checkpointId &&
    ack.history.undoLockId === delivery.history.undoLockId &&
    ack.history.checkpointKind === delivery.history.checkpointKind &&
    ack.history.baselineSceneFingerprintSha256 ===
      delivery.history.baselineSceneFingerprintSha256 &&
    ack.history.lockedSceneFingerprintSha256 === delivery.history.lockedSceneFingerprintSha256 &&
    ack.history.terminalResultContentSha256 === delivery.history.terminalResultContentSha256 &&
    ack.expectedMarkerContentSha256 === delivery.expectedMarkerContentSha256 &&
    Date.parse(ack.occurredAt) >= Date.parse(delivery.recoveryRequestedAt)
  );
}

export const companionShortcutProofProgressSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    status: z.literal('in_progress'),
    completedOperationIds: z
      .array(z.enum(subdivisionSurfaceShortcutProofOperationIds))
      .min(1)
      .max(4),
    receiptChainHeadSha256: sha256Schema,
    occurredAt: timestampSchema,
  })
  .superRefine((progress, context) => {
    if (!bindingIdentityMatches(progress)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Shortcut proof progress must preserve the exact authority binding',
      });
    }
    if (progress.completedOperationIds.some((id, index) => id !== progress.operationIds[index])) {
      context.addIssue({
        code: 'custom',
        path: ['completedOperationIds'],
        message: 'Shortcut proof progress must report an exact operation prefix',
      });
    }
  });
export type CompanionShortcutProofProgress = z.infer<typeof companionShortcutProofProgressSchema>;

const resultStatusSchema = z.enum([
  'succeeded',
  'failed_checkpointed',
  'failed_restored',
  'rejected',
  'restored',
  'reapplied_locked',
]);
const terminalEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('succeeded_locked'),
    attestation: procedureShortcutProofAttestationSchema,
  }),
  z.strictObject({
    kind: z.literal('failed_checkpointed'),
    checkpoint: procedureShortcutProofFailureCheckpointSchema,
    receiptPrefix: z.array(procedureShortcutProofOperationReceiptSchema).max(4),
    lastCompletedOperationId: z.enum(subdivisionSurfaceShortcutProofOperationIds).nullable(),
    baselineSceneFingerprintSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    mutationStarted: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal('rejected_before_mutation'),
    mutationStarted: z.literal(false),
  }),
  z.strictObject({
    kind: z.literal('failed_restored'),
    receiptPrefix: z.array(procedureShortcutProofOperationReceiptSchema).max(4),
    lastCompletedOperationId: z.enum(subdivisionSurfaceShortcutProofOperationIds).nullable(),
    baselineSceneFingerprintSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    nativeUndoObservation: z.strictObject({
      satisfied: z.literal(true),
      restorationObservationId: z.uuid(),
      sceneFingerprintSha256: sha256Schema,
      contentSha256: sha256Schema,
    }),
    mutationStarted: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal('restored'),
    sourceCheckpointId: z.uuid(),
    undoLockId: z.uuid(),
    baselineSceneFingerprintSha256: sha256Schema,
    lockedSceneFingerprintSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    nativeUndoObservation: z.strictObject({
      satisfied: z.literal(true),
      restorationObservationId: z.uuid(),
      sceneFingerprintSha256: sha256Schema,
      contentSha256: sha256Schema,
    }),
    restoredAt: timestampSchema,
  }),
  z.strictObject({
    kind: z.literal('reapplied_locked'),
    sourceCheckpointId: z.uuid(),
    undoLockId: z.uuid(),
    baselineSceneFingerprintSha256: sha256Schema,
    lockedSceneFingerprintSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    nativeRedoObservation: z.strictObject({
      satisfied: z.literal(true),
      redoObservationId: z.uuid(),
      sceneFingerprintSha256: sha256Schema,
      contentSha256: sha256Schema,
    }),
    reappliedAt: timestampSchema,
  }),
]);
export const companionShortcutProofResultSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    status: resultStatusSchema,
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    requiresUndoToUnlock: z.boolean(),
    terminalEvidence: terminalEvidenceSchema,
    error: z.string().min(1).nullable(),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (!bindingIdentityMatches(result)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Shortcut proof result must preserve the exact authority binding',
      });
    }
    const evidenceMatches =
      (result.status === 'succeeded' &&
        result.terminalEvidence.kind === 'succeeded_locked' &&
        result.error === null) ||
      (result.status === 'failed_checkpointed' &&
        result.terminalEvidence.kind === 'failed_checkpointed' &&
        result.error !== null) ||
      (result.status === 'failed_restored' &&
        result.terminalEvidence.kind === 'failed_restored' &&
        result.error !== null) ||
      (result.status === 'rejected' &&
        result.terminalEvidence.kind === 'rejected_before_mutation' &&
        result.error !== null) ||
      (result.status === 'restored' &&
        result.terminalEvidence.kind === 'restored' &&
        result.error === null) ||
      (result.status === 'reapplied_locked' &&
        result.terminalEvidence.kind === 'reapplied_locked' &&
        result.error === null);
    if (!evidenceMatches) {
      context.addIssue({
        code: 'custom',
        message: 'Shortcut proof result status must match attestation and error evidence',
      });
    }
    if (
      result.requiresUndoToUnlock !==
      (result.status === 'succeeded' ||
        result.status === 'failed_checkpointed' ||
        result.status === 'reapplied_locked')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requiresUndoToUnlock'],
        message: 'Mutated shortcut proof results must retain the Undo lock until restored',
      });
    }
    const attestation =
      result.terminalEvidence.kind === 'succeeded_locked'
        ? result.terminalEvidence.attestation
        : null;
    if (
      attestation !== null &&
      (attestation.binding.requestId !== result.requestId ||
        attestation.binding.replayId !== result.replayId ||
        attestation.binding.proofId !== result.proofId ||
        attestation.deliveryId !== result.deliveryId ||
        attestation.binding.target.instanceId !== result.target.instanceId ||
        attestation.bindingContentSha256 !== result.bindingContentSha256)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['attestation'],
        message: 'Shortcut proof result attestation must mirror immutable delivery identity',
      });
    }
    if (result.terminalEvidence.kind === 'failed_checkpointed') {
      const evidence = result.terminalEvidence;
      const lastReceipt = evidence.receiptPrefix.at(-1);
      if (
        evidence.checkpoint.proofId !== result.proofId ||
        evidence.checkpoint.replayId !== result.replayId ||
        evidence.checkpoint.targetId !== result.binding.acceptedAction.arguments.targetId ||
        !receiptPrefixIsCanonical(evidence.receiptPrefix, result) ||
        evidence.checkpoint.baselineState.sceneFingerprintSha256 !==
          evidence.baselineSceneFingerprintSha256 ||
        evidence.checkpoint.currentState.sceneFingerprintSha256 !==
          evidence.currentSceneFingerprintSha256 ||
        (lastReceipt?.operationId ?? null) !== evidence.lastCompletedOperationId ||
        evidence.checkpoint.lastCompletedOperationId !== evidence.lastCompletedOperationId ||
        (evidence.receiptPrefix[0]?.contentSha256 ?? null) !==
          evidence.checkpoint.receiptPrefixRootSha256 ||
        (lastReceipt?.contentSha256 ?? null) !== evidence.checkpoint.receiptPrefixHeadSha256 ||
        Date.parse(evidence.checkpoint.committedAt) <
          Date.parse(lastReceipt?.occurredAt ?? result.dispatchedAt) ||
        Date.parse(evidence.checkpoint.committedAt) > Date.parse(result.occurredAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['terminalEvidence'],
          message:
            'Failed shortcut proof evidence must bind its checkpoint, receipt prefix, and mutated state',
        });
      }
    }
    if (
      result.terminalEvidence.kind === 'restored' &&
      (result.terminalEvidence.baselineSceneFingerprintSha256 !==
        result.terminalEvidence.currentSceneFingerprintSha256 ||
        result.terminalEvidence.nativeUndoObservation.sceneFingerprintSha256 !==
          result.terminalEvidence.currentSceneFingerprintSha256 ||
        result.terminalEvidence.nativeUndoObservation.contentSha256 !==
          computeProcedureShortcutProofNativeObservationContentSha256(
            result.terminalEvidence.nativeUndoObservation,
          ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidence'],
        message: 'Restored shortcut proof must prove return to the baseline fingerprint',
      });
    }
    if (result.terminalEvidence.kind === 'failed_restored') {
      const evidence = result.terminalEvidence;
      const lastReceipt = evidence.receiptPrefix.at(-1);
      if (
        evidence.baselineSceneFingerprintSha256 !== evidence.currentSceneFingerprintSha256 ||
        !receiptPrefixIsCanonical(evidence.receiptPrefix, result) ||
        evidence.nativeUndoObservation.sceneFingerprintSha256 !==
          evidence.currentSceneFingerprintSha256 ||
        evidence.nativeUndoObservation.contentSha256 !==
          computeProcedureShortcutProofNativeObservationContentSha256(
            evidence.nativeUndoObservation,
          ) ||
        (lastReceipt?.operationId ?? null) !== evidence.lastCompletedOperationId ||
        Date.parse(lastReceipt?.occurredAt ?? result.dispatchedAt) > Date.parse(result.occurredAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['terminalEvidence'],
          message:
            'Failed-restored shortcut proof must prove baseline restoration and receipt prefix',
        });
      }
    }
    if (
      result.terminalEvidence.kind === 'reapplied_locked' &&
      (result.terminalEvidence.lockedSceneFingerprintSha256 !==
        result.terminalEvidence.currentSceneFingerprintSha256 ||
        result.terminalEvidence.nativeRedoObservation.sceneFingerprintSha256 !==
          result.terminalEvidence.currentSceneFingerprintSha256 ||
        result.terminalEvidence.nativeRedoObservation.contentSha256 !==
          computeProcedureShortcutProofNativeObservationContentSha256(
            result.terminalEvidence.nativeRedoObservation,
          ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidence'],
        message: 'Reapplied shortcut proof must prove return to the locked final fingerprint',
      });
    }
    const terminalBoundaryAt =
      result.terminalEvidence.kind === 'succeeded_locked'
        ? result.terminalEvidence.attestation.attestedAt
        : result.terminalEvidence.kind === 'restored'
          ? result.terminalEvidence.restoredAt
          : result.terminalEvidence.kind === 'reapplied_locked'
            ? result.terminalEvidence.reappliedAt
            : result.occurredAt;
    if (
      Date.parse(result.requestedAt) > Date.parse(result.dispatchedAt) ||
      Date.parse(result.dispatchedAt) > Date.parse(terminalBoundaryAt) ||
      Date.parse(terminalBoundaryAt) > Date.parse(result.occurredAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'Shortcut proof result chronology must follow request, dispatch, and evidence',
      });
    }
  });
export type CompanionShortcutProofResult = z.infer<typeof companionShortcutProofResultSchema>;

export function computeCompanionShortcutProofResultContentSha256(
  result: CompanionShortcutProofResult,
): string {
  return computeProcedureShortcutProofCanonicalContentSha256(
    companionShortcutProofResultSchema.parse(result),
  );
}

function lockedHistoryFromTerminalResult(result: CompanionShortcutProofResult) {
  if (result.terminalEvidence.kind === 'succeeded_locked') {
    const checkpoint = result.terminalEvidence.attestation.nativeUndoCheckpoint;
    return {
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      checkpointKind: 'success' as const,
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      finalSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
    };
  }
  if (result.terminalEvidence.kind === 'failed_checkpointed') {
    const checkpoint = result.terminalEvidence.checkpoint;
    return {
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      checkpointKind: 'failure' as const,
      baselineSceneFingerprintSha256: checkpoint.baselineState.sceneFingerprintSha256,
      finalSceneFingerprintSha256: checkpoint.currentState.sceneFingerprintSha256,
    };
  }
  return null;
}

export function computeCompanionShortcutProofTerminalMarkerContentSha256(
  result: CompanionShortcutProofResult,
): string {
  const parsed = companionShortcutProofResultSchema.parse(result);
  const history = lockedHistoryFromTerminalResult(parsed);
  if (history === null) {
    throw new Error('Native terminal marker requires a locked shortcut proof result');
  }
  const marker = {
    formatVersion: '1.0.0',
    executorId: parsed.executorId,
    checkpointId: history.checkpointId,
    undoLockId: history.undoLockId,
    proofId: parsed.proofId,
    replayId: parsed.replayId,
    targetId: parsed.binding.acceptedAction.arguments.targetId,
    targetObjectName: 'Cube',
    checkpointKind: history.checkpointKind,
    baselineSceneFingerprintSha256: history.baselineSceneFingerprintSha256,
    finalSceneFingerprintSha256: history.finalSceneFingerprintSha256,
    terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(parsed),
  };
  return computeProcedureShortcutProofCanonicalContentSha256(marker);
}

export const companionShortcutProofTerminalReconciliationAckSchema = z
  .strictObject({
    kind: z.literal('native_terminal_reconcile'),
    recoveryId: z.uuid(),
    result: companionShortcutProofResultSchema,
    expectedMarkerContentSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    const history = lockedHistoryFromTerminalResult(ack.result);
    if (
      history === null ||
      (ack.result.status !== 'succeeded' && ack.result.status !== 'failed_checkpointed')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Terminal reconciliation accepts only a locked success or failure checkpoint',
      });
      return;
    }
    if (ack.currentSceneFingerprintSha256 !== history.finalSceneFingerprintSha256) {
      context.addIssue({
        code: 'custom',
        path: ['currentSceneFingerprintSha256'],
        message: 'Terminal reconciliation must prove the locked final scene fingerprint',
      });
    }
    if (
      ack.expectedMarkerContentSha256 !==
      computeCompanionShortcutProofTerminalMarkerContentSha256(ack.result)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedMarkerContentSha256'],
        message: 'Terminal reconciliation marker must bind the complete terminal result',
      });
    }
    if (Date.parse(ack.occurredAt) < Date.parse(ack.result.occurredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'Terminal reconciliation acknowledgement must follow its terminal result',
      });
    }
  });
export type CompanionShortcutProofTerminalReconciliationAck = z.infer<
  typeof companionShortcutProofTerminalReconciliationAckSchema
>;

export function companionShortcutProofTerminalReconciliationAckMatchesDelivery(
  ack: CompanionShortcutProofTerminalReconciliationAck,
  delivery: CompanionShortcutProofTerminalReconciliationDelivery,
): boolean {
  const result = ack.result;
  return (
    ack.recoveryId === delivery.recoveryId &&
    result.formatVersion === delivery.formatVersion &&
    result.requestId === delivery.requestId &&
    result.replayId === delivery.replayId &&
    result.proofId === delivery.proofId &&
    result.deliveryId === delivery.deliveryId &&
    isSameTarget(result.target, delivery.target) &&
    result.bindingContentSha256 === delivery.bindingContentSha256 &&
    result.targetProfile === delivery.targetProfile &&
    result.proposalId === delivery.proposalId &&
    result.plan.id === delivery.plan.id &&
    result.plan.revision === delivery.plan.revision &&
    result.plan.contentSha256 === delivery.plan.contentSha256 &&
    result.executionId === delivery.executionId &&
    result.leafId === delivery.leafId &&
    result.interactionCatalogVersion === delivery.interactionCatalogVersion &&
    result.interactionCatalogContentSha256 === delivery.interactionCatalogContentSha256 &&
    result.shortcutTrackContentSha256 === delivery.shortcutTrackContentSha256 &&
    result.executorId === delivery.executorId &&
    result.executionBoundary === delivery.executionBoundary &&
    result.authorization === delivery.authorization &&
    result.transport === delivery.transport &&
    result.operationIds.every(
      (operationId, index) => operationId === delivery.operationIds[index],
    ) &&
    result.expectedState.reportId === delivery.expectedState.reportId &&
    result.expectedState.sequence === delivery.expectedState.sequence &&
    result.requestedAt === delivery.requestedAt &&
    result.dispatchedAt === delivery.dispatchedAt &&
    Date.parse(ack.occurredAt) >= Date.parse(delivery.recoveryRequestedAt)
  );
}

const companionShortcutProofHistoryTransitionResultSchema =
  companionShortcutProofResultSchema.refine(
    (result) => result.status === 'restored' || result.status === 'reapplied_locked',
    {
      message:
        'History transition reconciliation accepts only restored or reapplied_locked results',
    },
  );

export const companionShortcutProofHistoryTransitionReconciliationAckSchema = z
  .strictObject({
    kind: z.literal('native_history_transition_reconcile'),
    recoveryId: z.uuid(),
    results: z.array(companionShortcutProofHistoryTransitionResultSchema).min(1).max(32),
    expectedResultContentSha256: sha256Schema,
    expectedMarkerContentSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    for (let index = 0; index < ack.results.length; index += 1) {
      const result = ack.results[index]!;
      const previous = ack.results[index - 1];
      if (previous !== undefined) {
        if (previous.status === result.status) {
          context.addIssue({
            code: 'custom',
            path: ['results', index, 'status'],
            message: 'History transition results must strictly alternate native Undo and Redo',
          });
        }
        if (Date.parse(result.occurredAt) <= Date.parse(previous.occurredAt)) {
          context.addIssue({
            code: 'custom',
            path: ['results', index, 'occurredAt'],
            message: 'History transition results must be strictly chronological',
          });
        }
      }
    }
    const finalResult = ack.results.at(-1)!;
    const finalEvidence = finalResult.terminalEvidence;
    if (finalEvidence.kind !== 'restored' && finalEvidence.kind !== 'reapplied_locked') return;
    if (ack.currentSceneFingerprintSha256 !== finalEvidence.currentSceneFingerprintSha256) {
      context.addIssue({
        code: 'custom',
        path: ['currentSceneFingerprintSha256'],
        message: 'History transition acknowledgement must prove its final scene fingerprint',
      });
    }
    if (Date.parse(ack.occurredAt) < Date.parse(finalResult.occurredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'History transition acknowledgement must follow its final result',
      });
    }
  });
export type CompanionShortcutProofHistoryTransitionReconciliationAck = z.infer<
  typeof companionShortcutProofHistoryTransitionReconciliationAckSchema
>;

export function companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery(
  ack: CompanionShortcutProofHistoryTransitionReconciliationAck,
  delivery: CompanionShortcutProofRecoveryDelivery,
): boolean {
  if (
    ack.recoveryId !== delivery.recoveryId ||
    ack.expectedResultContentSha256 !== delivery.expectedResultContentSha256 ||
    ack.expectedMarkerContentSha256 !== delivery.expectedMarkerContentSha256 ||
    Date.parse(ack.occurredAt) < Date.parse(delivery.recoveryRequestedAt)
  ) {
    return false;
  }
  return ack.results.every((result) => {
    const evidence = result.terminalEvidence;
    if (evidence.kind !== 'restored' && evidence.kind !== 'reapplied_locked') return false;
    return (
      companionShortcutProofTerminalReconciliationAckMatchesDelivery(
        {
          kind: 'native_terminal_reconcile',
          recoveryId: delivery.recoveryId,
          result,
          expectedMarkerContentSha256: delivery.expectedMarkerContentSha256,
          currentSceneFingerprintSha256: evidence.currentSceneFingerprintSha256,
          occurredAt: ack.occurredAt,
        },
        {
          ...delivery,
          kind: 'native_terminal_reconcile',
          acknowledgedProgressReceiptChainHeads: [],
        },
      ) &&
      evidence.sourceCheckpointId === delivery.history.checkpointId &&
      evidence.undoLockId === delivery.history.undoLockId &&
      evidence.baselineSceneFingerprintSha256 === delivery.history.baselineSceneFingerprintSha256 &&
      evidence.lockedSceneFingerprintSha256 === delivery.history.lockedSceneFingerprintSha256
    );
  });
}

function isSameTarget(
  left: { adapterId: 'blender'; instanceId: string },
  right: { adapterId: 'blender'; instanceId: string },
): boolean {
  return left.adapterId === right.adapterId && left.instanceId === right.instanceId;
}

const statusValueSchema = z.enum([
  'queued',
  'dispatched',
  'in_progress',
  'succeeded',
  'failed_checkpointed',
  'failed_restored',
  'rejected',
  'recovery_required',
  'restored',
  'reapplied_locked',
]);
const statusIdentityShape = {
  formatVersion: procedureShortcutProofFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  proofId: z.uuid(),
  deliveryId: z.uuid().optional(),
  target: targetSchema,
  targetProfile: z.literal('factory_cube_8_12_6'),
  bindingContentSha256: sha256Schema,
  binding: procedureShortcutProofBindingSchema,
  proposalId: z.uuid(),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: z.string().min(1),
  interactionCatalogVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
  interactionCatalogContentSha256: sha256Schema,
  shortcutTrackContentSha256: sha256Schema,
  executorId: z.literal('blender.subdivision_surface_f9.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: subdivisionSurfaceShortcutProofOperationIdsSchema,
  expectedState: expectedStateSchema,
  requestedAt: timestampSchema,
  dispatchedAt: timestampSchema.optional(),
} as const;
export const companionShortcutProofStatusSchema = z
  .strictObject({
    ...statusIdentityShape,
    status: statusValueSchema,
    progress: companionShortcutProofProgressSchema.optional(),
    result: companionShortcutProofResultSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((status, context) => {
    if (!bindingIdentityMatches(status)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Shortcut proof status must preserve the exact authority binding',
      });
    }
    const delivered = status.deliveryId !== undefined && status.dispatchedAt !== undefined;
    if ((status.deliveryId === undefined) !== (status.dispatchedAt === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Shortcut proof delivery id and dispatch time must be present together',
      });
      return;
    }
    const terminal = [
      'succeeded',
      'failed_checkpointed',
      'failed_restored',
      'rejected',
      'restored',
      'reapplied_locked',
    ].includes(status.status);
    if (
      status.status === 'queued' &&
      (delivered || status.progress !== undefined || status.result !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Queued shortcut proof cannot contain delivery, progress, or result evidence',
      });
      return;
    }
    if (
      ['dispatched', 'in_progress'].includes(status.status) &&
      (!delivered || status.result !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${status.status} shortcut proof requires delivery and no terminal result`,
      });
      return;
    }
    if (
      status.status === 'recovery_required' &&
      (status.result !== undefined || status.progress !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Recovery-required shortcut proof cannot contain progress or terminal evidence',
      });
      return;
    }
    if (status.status === 'in_progress' && status.progress === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['progress'],
        message: 'In-progress shortcut proof requires progress evidence',
      });
      return;
    }
    if (
      status.progress !== undefined &&
      (status.progress.requestId !== status.requestId ||
        status.progress.replayId !== status.replayId ||
        status.progress.proofId !== status.proofId ||
        status.progress.deliveryId !== status.deliveryId ||
        status.progress.bindingContentSha256 !== status.bindingContentSha256 ||
        status.progress.target.instanceId !== status.target.instanceId ||
        status.progress.executionId !== status.executionId ||
        status.progress.leafId !== status.leafId ||
        status.progress.shortcutTrackContentSha256 !== status.shortcutTrackContentSha256)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['progress'],
        message: 'Shortcut proof progress must mirror immutable status identity',
      });
    }
    if (!terminal) return;
    if (!delivered || status.result === undefined || status.result.status !== status.status) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Terminal shortcut proof requires matching delivery and result evidence',
      });
      return;
    }
    const result = status.result;
    if (
      result.requestId !== status.requestId ||
      result.replayId !== status.replayId ||
      result.proofId !== status.proofId ||
      result.deliveryId !== status.deliveryId ||
      result.bindingContentSha256 !== status.bindingContentSha256 ||
      result.target.instanceId !== status.target.instanceId ||
      result.proposalId !== status.proposalId ||
      result.executionId !== status.executionId ||
      result.leafId !== status.leafId ||
      result.plan.contentSha256 !== status.plan.contentSha256 ||
      result.shortcutTrackContentSha256 !== status.shortcutTrackContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Terminal shortcut proof result must mirror immutable status identity',
      });
    }
  });
export type CompanionShortcutProofStatus = z.infer<typeof companionShortcutProofStatusSchema>;

export const companionShortcutProofPollRequestSchema = z.strictObject({
  adapterId: z.literal('blender'),
  instanceId: z.uuid(),
});
export type CompanionShortcutProofPollRequest = z.infer<
  typeof companionShortcutProofPollRequestSchema
>;

export const companionShortcutProofPollDeliverySchema = z.strictObject({
  request: z
    .union([
      companionShortcutProofDeliverySchema,
      companionShortcutProofRecoveryDeliverySchema,
      companionShortcutProofTerminalReconciliationDeliverySchema,
    ])
    .nullable(),
});
export type CompanionShortcutProofPollDelivery = z.infer<
  typeof companionShortcutProofPollDeliverySchema
>;

const shortcutProofAckSchema = z.strictObject({ result: z.enum(['accepted', 'duplicate']) });

export const companionShortcutProofProgressAckSchema = shortcutProofAckSchema;
export type CompanionShortcutProofProgressAck = z.infer<
  typeof companionShortcutProofProgressAckSchema
>;

export const companionShortcutProofResultAckSchema = shortcutProofAckSchema;
export type CompanionShortcutProofResultAck = z.infer<typeof companionShortcutProofResultAckSchema>;

export const companionShortcutProofRecoveryAckResponseSchema = shortcutProofAckSchema;
export type CompanionShortcutProofRecoveryAckResponse = z.infer<
  typeof companionShortcutProofRecoveryAckResponseSchema
>;

export const companionShortcutProofRecoveryRequestSchema = z.union([
  companionShortcutProofRecoveryAckSchema,
  companionShortcutProofTerminalReconciliationAckSchema,
  companionShortcutProofHistoryTransitionReconciliationAckSchema,
]);
export type CompanionShortcutProofRecoveryRequest = z.infer<
  typeof companionShortcutProofRecoveryRequestSchema
>;
