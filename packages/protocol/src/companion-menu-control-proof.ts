import { z } from 'zod';

import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';
import {
  procedureMenuControlProofBindingSchema,
  procedureMenuControlProofFormatVersionSchema,
  uvSphereMenuControlProofOperationIds,
  uvSphereMenuControlProofOperationIdsSchema,
} from './procedure-menu-control-proof.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
export const companionMenuControlProofExecutionWindowMs = 120_000;
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });
const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});
const mutationStageValues = [
  'uv_sphere_created',
  'location_x_set',
  'location_y_set',
  'location_z_set',
  'scale_x_set',
  'scale_y_set',
  'scale_z_set',
  'object_name_set',
] as const;
export const uvSphereMenuControlProofMutationStagesSchema = z.tuple([
  z.literal(mutationStageValues[0]),
  z.literal(mutationStageValues[1]),
  z.literal(mutationStageValues[2]),
  z.literal(mutationStageValues[3]),
  z.literal(mutationStageValues[4]),
  z.literal(mutationStageValues[5]),
  z.literal(mutationStageValues[6]),
  z.literal(mutationStageValues[7]),
]);
const mutationStagePrefixSchema = z.array(z.enum(mutationStageValues)).max(8);
const historyStageValues = [
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
const historyStageFingerprintsSchema = z.tuple([
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
  sha256Schema,
]);

const leaseSchema = z.strictObject({
  leaseId: z.uuid(),
  sessionId: z.uuid(),
  target: targetSchema,
  documentIncarnationId: z.uuid(),
  expiresAt: timestampSchema,
});

const baseIdentityShape = {
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  proofId: z.uuid(),
  target: targetSchema,
  targetProfile: z.literal('factory_layout_three_object_ui_scale_2'),
  proposalId: z.uuid(),
  proposalRecordContentSha256: sha256Schema,
  proposalContentSha256: sha256Schema,
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: z.string().min(1),
  packetContentSha256: sha256Schema,
  inputTreeContentSha256: sha256Schema,
  outputTreeContentSha256: sha256Schema,
  materializationContentSha256: sha256Schema,
  interactionCatalogVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
  interactionCatalogContentSha256: sha256Schema,
  menuTrackContentSha256: sha256Schema,
  bindingContentSha256: sha256Schema,
  binding: procedureMenuControlProofBindingSchema,
  executorId: z.literal('blender.uv_sphere_menu_controls.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: uvSphereMenuControlProofOperationIdsSchema,
  nativeUndoDepth: z.literal(8),
  expectedState: expectedStateSchema,
  startCheckpoint: procedureMenuControlProofBindingSchema.shape.startState,
  requestedAt: timestampSchema,
} as const;
const deliveryIdentityShape = {
  ...baseIdentityShape,
  deliveryId: z.uuid(),
  lease: leaseSchema,
  dispatchedAt: timestampSchema,
} as const;

export const companionMenuControlProofCreateRequestSchema = z.strictObject({
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  expectedState: expectedStateSchema,
});
export type CompanionMenuControlProofCreateRequest = z.infer<
  typeof companionMenuControlProofCreateRequestSchema
>;

export const companionMenuControlProofStatusRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type CompanionMenuControlProofStatusRequest = z.infer<
  typeof companionMenuControlProofStatusRequestSchema
>;

function bindingIdentityMatches(value: z.infer<z.ZodObject<typeof baseIdentityShape>>): boolean {
  const binding = value.binding;
  return (
    binding.integrity.contentSha256 === value.bindingContentSha256 &&
    binding.requestId === value.requestId &&
    binding.replayId === value.replayId &&
    binding.proofId === value.proofId &&
    binding.target.instanceId === value.target.instanceId &&
    binding.targetProfile === value.targetProfile &&
    binding.proposalId === value.proposalId &&
    binding.proposalRecordContentSha256 === value.proposalRecordContentSha256 &&
    binding.proposalContentSha256 === value.proposalContentSha256 &&
    binding.plan.id === value.plan.id &&
    binding.plan.revision === value.plan.revision &&
    binding.plan.contentSha256 === value.plan.contentSha256 &&
    binding.executionId === value.executionId &&
    binding.leafId === value.leafId &&
    binding.packetContentSha256 === value.packetContentSha256 &&
    binding.inputTreeContentSha256 === value.inputTreeContentSha256 &&
    binding.outputTreeContentSha256 === value.outputTreeContentSha256 &&
    binding.materializationContentSha256 === value.materializationContentSha256 &&
    binding.materialization.interactionCatalogVersion === value.interactionCatalogVersion &&
    binding.materialization.interactionCatalogContentSha256 ===
      value.interactionCatalogContentSha256 &&
    binding.materialization.menuTrackContentSha256 === value.menuTrackContentSha256 &&
    binding.startState.reportId === value.expectedState.reportId &&
    binding.startState.sequence === value.expectedState.sequence &&
    computeProtocolCanonicalJsonSha256(binding.startState) ===
      computeProtocolCanonicalJsonSha256(value.startCheckpoint)
  );
}

type DeliveredIdentity = z.infer<z.ZodObject<typeof deliveryIdentityShape>>;

function deliverySemanticsMatch(value: DeliveredIdentity): boolean {
  return (
    bindingIdentityMatches(value) &&
    value.lease.target.adapterId === value.target.adapterId &&
    value.lease.target.instanceId === value.target.instanceId &&
    Date.parse(value.binding.createdAt) <= Date.parse(value.requestedAt) &&
    Date.parse(value.requestedAt) <= Date.parse(value.dispatchedAt) &&
    Date.parse(value.dispatchedAt) < Date.parse(value.lease.expiresAt)
  );
}

function occursWithinExecutionWindow(value: {
  readonly dispatchedAt: string;
  readonly occurredAt: string;
}): boolean {
  const elapsedMs = Date.parse(value.occurredAt) - Date.parse(value.dispatchedAt);
  return elapsedMs >= 0 && elapsedMs <= companionMenuControlProofExecutionWindowMs;
}

export const companionMenuControlProofDeliverySchema = z
  .strictObject(deliveryIdentityShape)
  .superRefine((delivery, context) => {
    if (!deliverySemanticsMatch(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Menu-control proof delivery must preserve its immutable accepted binding',
      });
    }
  });
export type CompanionMenuControlProofDelivery = z.infer<
  typeof companionMenuControlProofDeliverySchema
>;

const receiptCommonShape = {
  receiptId: z.uuid(),
  proofId: z.uuid(),
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  bindingContentSha256: sha256Schema,
  order: z.number().int().min(1).max(7),
  previousReceiptContentSha256: sha256Schema.nullable(),
  outcome: z.literal('succeeded'),
  occurredAt: timestampSchema,
  contentSha256: sha256Schema,
} as const;
const receipt = <Id extends (typeof uvSphereMenuControlProofOperationIds)[number]>(
  id: Id,
  summary: z.ZodType,
) =>
  z.strictObject({
    ...receiptCommonShape,
    operationId: z.literal(id),
    summary,
  });
export const companionMenuControlProofOperationReceiptSchema = z.discriminatedUnion('operationId', [
  receipt(
    'workspace.layout',
    z.strictObject({
      status: z.literal('precondition_verified'),
      path: z.tuple([z.literal('Layout')]),
    }),
  ),
  receipt(
    'menu.add',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([z.literal('Layout'), z.literal('Add')]),
    }),
  ),
  receipt(
    'menu.mesh',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([z.literal('Layout'), z.literal('Add'), z.literal('Mesh')]),
    }),
  ),
  receipt(
    'operator.uv_sphere',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([
        z.literal('Layout'),
        z.literal('Add'),
        z.literal('Mesh'),
        z.literal('UV Sphere'),
      ]),
      radius: z.literal(1),
    }),
  ),
  receipt(
    'control.location',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([
        z.literal('Sidebar'),
        z.literal('Item'),
        z.literal('Transform'),
        z.literal('Location'),
      ]),
      value: z.tuple([z.literal(1.25), z.literal(-2), z.literal(0.75)]),
    }),
  ),
  receipt(
    'control.scale',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([
        z.literal('Sidebar'),
        z.literal('Item'),
        z.literal('Transform'),
        z.literal('Scale'),
      ]),
      value: z.tuple([z.literal(1.5), z.literal(1.5), z.literal(1.5)]),
    }),
  ),
  receipt(
    'control.object_name',
    z.strictObject({
      status: z.literal('control_executed'),
      path: z.tuple([z.literal('Properties'), z.literal('Object'), z.literal('Name')]),
      value: z.literal('OperatingLine.TutorialEye'),
    }),
  ),
]);
export type CompanionMenuControlProofOperationReceipt = z.infer<
  typeof companionMenuControlProofOperationReceiptSchema
>;

export function computeCompanionMenuControlProofOperationReceiptContentSha256(
  value: Record<string, unknown>,
): string {
  return computeProtocolCanonicalJsonSha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentSha256')),
  );
}

export function computeCompanionMenuControlProofFailureCheckpointContentSha256(
  value: Record<string, unknown>,
): string {
  return computeProtocolCanonicalJsonSha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentSha256')),
  );
}

function receiptPrefixIsCanonical(
  receipts: CompanionMenuControlProofOperationReceipt[],
  identity: {
    proofId: string;
    requestId: string;
    deliveryId: string;
    bindingContentSha256: string;
    dispatchedAt: string;
    occurredAt: string;
  },
): boolean {
  let previous: string | null = null;
  let previousOccurredAt = Number.NEGATIVE_INFINITY;
  for (const [index, receiptValue] of receipts.entries()) {
    const occurredAt = Date.parse(receiptValue.occurredAt);
    if (
      receiptValue.proofId !== identity.proofId ||
      receiptValue.requestId !== identity.requestId ||
      receiptValue.deliveryId !== identity.deliveryId ||
      receiptValue.bindingContentSha256 !== identity.bindingContentSha256 ||
      receiptValue.operationId !== uvSphereMenuControlProofOperationIds[index] ||
      receiptValue.order !== index + 1 ||
      receiptValue.previousReceiptContentSha256 !== previous ||
      occurredAt < Date.parse(identity.dispatchedAt) ||
      occurredAt > Date.parse(identity.occurredAt) ||
      occurredAt < previousOccurredAt ||
      receiptValue.contentSha256 !==
        computeCompanionMenuControlProofOperationReceiptContentSha256(receiptValue)
    ) {
      return false;
    }
    previous = receiptValue.contentSha256;
    previousOccurredAt = occurredAt;
  }
  return true;
}

export const companionMenuControlProofProgressSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    status: z.literal('in_progress'),
    completedOperationIds: z.array(z.enum(uvSphereMenuControlProofOperationIds)).min(1).max(7),
    operationReceipts: z.array(companionMenuControlProofOperationReceiptSchema).min(1).max(7),
    receiptChainHeadSha256: sha256Schema,
    nativeHistoryCursor: z.number().int().min(0).max(8),
    completedMutationStages: mutationStagePrefixSchema,
    occurredAt: timestampSchema,
  })
  .superRefine((progress, context) => {
    const expectedMutationCount = [0, 0, 0, 1, 4, 7, 8][progress.operationReceipts.length - 1];
    if (
      !deliverySemanticsMatch(progress) ||
      progress.completedOperationIds.length !== progress.operationReceipts.length ||
      progress.completedOperationIds.some((id, index) => id !== progress.operationIds[index]) ||
      !receiptPrefixIsCanonical(progress.operationReceipts, progress) ||
      progress.receiptChainHeadSha256 !== progress.operationReceipts.at(-1)?.contentSha256 ||
      progress.completedMutationStages.some(
        (stage, index) => stage !== mutationStageValues[index],
      ) ||
      progress.nativeHistoryCursor !== expectedMutationCount ||
      progress.completedMutationStages.length !== expectedMutationCount ||
      Date.parse(progress.operationReceipts.at(-1)?.occurredAt ?? '') >
        Date.parse(progress.occurredAt) ||
      !occursWithinExecutionWindow(progress)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Menu-control proof progress must be an exact logical receipt and mutation prefix',
      });
    }
  });
export type CompanionMenuControlProofProgress = z.infer<
  typeof companionMenuControlProofProgressSchema
>;

const strongObservationSchema = z.strictObject({
  kind: z.literal('uv_sphere_menu_controls_ready'),
  satisfied: z.literal(true),
  observationId: z.uuid(),
  objectName: z.literal('OperatingLine.TutorialEye'),
  objectType: z.literal('MESH'),
  location: z.tuple([z.literal(1.25), z.literal(-2), z.literal(0.75)]),
  scale: z.tuple([z.literal(1.5), z.literal(1.5), z.literal(1.5)]),
  meshTopology: z.strictObject({
    vertices: z.literal(482),
    edges: z.literal(992),
    polygons: z.literal(512),
  }),
  meshSha256: sha256Schema,
  sceneFingerprintSha256: sha256Schema,
  observedAt: timestampSchema,
  contentSha256: sha256Schema,
});
const checkpointSchema = z.strictObject({
  checkpointId: z.uuid(),
  undoLockId: z.uuid(),
  nativeUndoDepth: z.literal(8),
  nativeHistoryCursor: z.literal(8),
  mutationStages: uvSphereMenuControlProofMutationStagesSchema,
  baselineSceneFingerprintSha256: sha256Schema,
  finalSceneFingerprintSha256: sha256Schema,
  restoredSceneFingerprintSha256: sha256Schema,
  reappliedSceneFingerprintSha256: sha256Schema,
  receiptChainRootSha256: sha256Schema,
  receiptChainHeadSha256: sha256Schema,
  strongObservationContentSha256: sha256Schema,
  committedAt: timestampSchema,
});
const failureCheckpointSchema = z.strictObject({
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  checkpointId: z.uuid(),
  undoLockId: z.uuid(),
  proofId: z.uuid(),
  replayId: z.uuid(),
  target: targetSchema.safeExtend({ resourceId: z.literal('proof.uv_sphere.eye') }),
  internalHistoryCursor: z.number().int().min(1).max(8),
  completedMutationStages: mutationStagePrefixSchema,
  baselineSceneFingerprintSha256: sha256Schema,
  currentSceneFingerprintSha256: sha256Schema,
  receiptChainRootSha256: sha256Schema,
  receiptChainHeadSha256: sha256Schema,
  committedAt: timestampSchema,
  contentSha256: sha256Schema,
});
const failureEvidenceCommonShape = {
  receiptPrefix: z.array(companionMenuControlProofOperationReceiptSchema).max(7),
  lastCompletedOperationId: z.enum(uvSphereMenuControlProofOperationIds).nullable(),
  internalHistoryCursor: z.number().int().min(0).max(8),
  completedMutationStages: mutationStagePrefixSchema,
  baselineSceneFingerprintSha256: sha256Schema,
  currentSceneFingerprintSha256: sha256Schema,
  automaticReplay: z.literal(false),
} as const;
const succeededLockedEvidenceSchema = z.strictObject({
  kind: z.literal('succeeded_locked'),
  operationSummaries: z
    .array(
      z.strictObject({
        operationId: z.enum(uvSphereMenuControlProofOperationIds),
        summaryContentSha256: sha256Schema,
      }),
    )
    .length(7),
  operationReceipts: z.array(companionMenuControlProofOperationReceiptSchema).length(7),
  strongObservation: strongObservationSchema,
  nativeUndoCheckpoint: checkpointSchema,
});
const terminalEvidenceSchema = z.discriminatedUnion('kind', [
  succeededLockedEvidenceSchema,
  z.strictObject({
    kind: z.literal('failed_no_mutation'),
    receiptPrefix: z.tuple([]),
    lastCompletedOperationId: z.null(),
    internalHistoryCursor: z.literal(0),
    completedMutationStages: z.tuple([]),
    automaticReplay: z.literal(false),
  }),
  z.strictObject({ ...failureEvidenceCommonShape, kind: z.literal('failed_restored') }),
  z.strictObject({
    ...failureEvidenceCommonShape,
    kind: z.literal('failed_checkpointed'),
    checkpoint: failureCheckpointSchema,
  }),
  z.strictObject({ ...failureEvidenceCommonShape, kind: z.literal('recovery_required') }),
]);

// Public aliases for v2 composition. These aliases intentionally reuse the
// existing v1 schema instances so the v1 wire contract and generated schemas
// remain byte-for-byte unchanged.
export const companionMenuControlProofStrongObservationSchema = strongObservationSchema;
export const companionMenuControlProofNativeUndoCheckpointSchema = checkpointSchema;
export const companionMenuControlProofSucceededLockedEvidenceSchema = succeededLockedEvidenceSchema;
const resultStatusSchema = z.enum([
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);

export const companionMenuControlProofResultSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    status: resultStatusSchema,
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
    requiresUndoToUnlock: z.boolean(),
    terminalEvidence: terminalEvidenceSchema,
    error: z.string().min(1).nullable(),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (!deliverySemanticsMatch(result)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Result binding identity changed',
      });
    }
    const expectedKind = result.status === 'succeeded' ? 'succeeded_locked' : result.status;
    if (
      result.terminalEvidence.kind !== expectedKind ||
      (result.status === 'succeeded') !== (result.error === null) ||
      result.requiresUndoToUnlock !==
        (result.status === 'succeeded' ||
          result.status === 'failed_checkpointed' ||
          result.status === 'recovery_required')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Menu-control proof status and terminal evidence disagree',
      });
    }
    const evidence = result.terminalEvidence;
    if (evidence.kind === 'succeeded_locked') {
      const receipts = evidence.operationReceipts;
      if (
        !receiptPrefixIsCanonical(receipts, result) ||
        evidence.operationSummaries.some(
          (summary, index) =>
            summary.operationId !== uvSphereMenuControlProofOperationIds[index] ||
            summary.summaryContentSha256 !==
              computeProtocolCanonicalJsonSha256(receipts[index]?.summary),
        ) ||
        evidence.strongObservation.contentSha256 !==
          computeProtocolCanonicalJsonSha256(
            Object.fromEntries(
              Object.entries(evidence.strongObservation).filter(([key]) => key !== 'contentSha256'),
            ),
          ) ||
        evidence.nativeUndoCheckpoint.receiptChainRootSha256 !== receipts[0]?.contentSha256 ||
        evidence.nativeUndoCheckpoint.receiptChainHeadSha256 !== receipts.at(-1)?.contentSha256 ||
        evidence.nativeUndoCheckpoint.strongObservationContentSha256 !==
          evidence.strongObservation.contentSha256 ||
        evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 !==
          evidence.strongObservation.sceneFingerprintSha256 ||
        evidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 ===
          evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 ||
        evidence.nativeUndoCheckpoint.restoredSceneFingerprintSha256 !==
          evidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 ||
        evidence.nativeUndoCheckpoint.reappliedSceneFingerprintSha256 !==
          evidence.nativeUndoCheckpoint.finalSceneFingerprintSha256 ||
        Date.parse(receipts.at(-1)?.occurredAt ?? '') >
          Date.parse(evidence.strongObservation.observedAt) ||
        Date.parse(evidence.strongObservation.observedAt) >
          Date.parse(evidence.nativeUndoCheckpoint.committedAt) ||
        Date.parse(evidence.nativeUndoCheckpoint.committedAt) > Date.parse(result.occurredAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['terminalEvidence'],
          message: 'Success evidence is not canonical',
        });
      }
    } else {
      const receipts = evidence.receiptPrefix;
      const [minimumStageCount, maximumStageCount] = ([
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 1],
        [1, 4],
        [4, 7],
        [7, 8],
        [8, 8],
      ][receipts.length] ?? [0, 0]) as [number, number];
      const stageCount = evidence.completedMutationStages.length;
      if (
        !receiptPrefixIsCanonical(receipts, result) ||
        (receipts.at(-1)?.operationId ?? null) !== evidence.lastCompletedOperationId ||
        evidence.completedMutationStages.some(
          (stage, index) => stage !== mutationStageValues[index],
        ) ||
        stageCount < minimumStageCount ||
        stageCount > maximumStageCount ||
        Date.parse(receipts.at(-1)?.occurredAt ?? result.dispatchedAt) >
          Date.parse(result.occurredAt) ||
        (evidence.kind === 'failed_restored' &&
          (evidence.internalHistoryCursor !== 0 ||
            evidence.currentSceneFingerprintSha256 !== evidence.baselineSceneFingerprintSha256)) ||
        (evidence.kind === 'failed_checkpointed' &&
          (evidence.internalHistoryCursor !== stageCount ||
            stageCount < 1 ||
            evidence.currentSceneFingerprintSha256 === evidence.baselineSceneFingerprintSha256 ||
            evidence.checkpoint.proofId !== result.proofId ||
            evidence.checkpoint.replayId !== result.replayId ||
            evidence.checkpoint.target.adapterId !== result.target.adapterId ||
            evidence.checkpoint.target.instanceId !== result.target.instanceId ||
            evidence.checkpoint.internalHistoryCursor !== evidence.internalHistoryCursor ||
            computeProtocolCanonicalJsonSha256(evidence.checkpoint.completedMutationStages) !==
              computeProtocolCanonicalJsonSha256(evidence.completedMutationStages) ||
            evidence.checkpoint.baselineSceneFingerprintSha256 !==
              evidence.baselineSceneFingerprintSha256 ||
            evidence.checkpoint.currentSceneFingerprintSha256 !==
              evidence.currentSceneFingerprintSha256 ||
            evidence.checkpoint.receiptChainRootSha256 !== receipts[0]?.contentSha256 ||
            evidence.checkpoint.receiptChainHeadSha256 !== receipts.at(-1)?.contentSha256 ||
            evidence.checkpoint.contentSha256 !==
              computeCompanionMenuControlProofFailureCheckpointContentSha256(evidence.checkpoint) ||
            Date.parse(evidence.checkpoint.committedAt) <
              Date.parse(receipts.at(-1)?.occurredAt ?? result.dispatchedAt) ||
            Date.parse(evidence.checkpoint.committedAt) > Date.parse(result.occurredAt))) ||
        (evidence.kind === 'recovery_required' &&
          (evidence.internalHistoryCursor > stageCount ||
            (evidence.internalHistoryCursor !== stageCount &&
              (receipts.length !== 7 || stageCount !== mutationStageValues.length))))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['terminalEvidence'],
          message: 'Failure evidence prefix is not canonical',
        });
      }
    }
    if (!occursWithinExecutionWindow(result)) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'Result falls outside the bounded menu-control proof execution window',
      });
    }
  });
export type CompanionMenuControlProofResult = z.infer<typeof companionMenuControlProofResultSchema>;

export function computeCompanionMenuControlProofResultContentSha256(
  result: CompanionMenuControlProofResult,
): string {
  return computeProtocolCanonicalJsonSha256(companionMenuControlProofResultSchema.parse(result));
}

function lockedMenuControlProofSceneFingerprint(
  result: CompanionMenuControlProofResult,
): string | null {
  if (result.status === 'succeeded' && result.terminalEvidence.kind === 'succeeded_locked') {
    return result.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256;
  }
  if (
    result.status === 'failed_checkpointed' &&
    result.terminalEvidence.kind === 'failed_checkpointed'
  ) {
    return result.terminalEvidence.checkpoint.currentSceneFingerprintSha256;
  }
  return null;
}

export function companionMenuControlProofTerminalMarkerIdentity(
  result: CompanionMenuControlProofResult,
) {
  const parsed = companionMenuControlProofResultSchema.parse(result);
  const terminalResultContentSha256 = computeCompanionMenuControlProofResultContentSha256(parsed);
  if (parsed.status === 'succeeded' && parsed.terminalEvidence.kind === 'succeeded_locked') {
    const checkpoint = parsed.terminalEvidence.nativeUndoCheckpoint;
    return {
      formatVersion: '1.0.0' as const,
      executorId: parsed.executorId,
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      proofId: parsed.proofId,
      replayId: parsed.replayId,
      targetId: parsed.binding.acceptedAction.arguments.resourceId,
      checkpointKind: 'success' as const,
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      terminalResultContentSha256,
    };
  }
  if (
    parsed.status === 'failed_checkpointed' &&
    parsed.terminalEvidence.kind === 'failed_checkpointed'
  ) {
    const checkpoint = parsed.terminalEvidence.checkpoint;
    return {
      formatVersion: '1.0.0' as const,
      executorId: parsed.executorId,
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      proofId: parsed.proofId,
      replayId: parsed.replayId,
      targetId: parsed.binding.acceptedAction.arguments.resourceId,
      checkpointKind: 'failure' as const,
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256: checkpoint.currentSceneFingerprintSha256,
      terminalResultContentSha256,
    };
  }
  throw new Error('Menu-control terminal marker requires a locked terminal result');
}

export function computeCompanionMenuControlProofTerminalMarkerContentSha256(
  result: CompanionMenuControlProofResult,
): string {
  return computeProtocolCanonicalJsonSha256(
    companionMenuControlProofTerminalMarkerIdentity(result),
  );
}

export const companionMenuControlProofTerminalReconciliationDeliverySchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_terminal_reconcile'),
    recoveryId: z.uuid(),
    replacementLease: leaseSchema,
    acknowledgedProgressReceiptChainHeads: z.array(sha256Schema).max(7),
    recoveryRequestedAt: timestampSchema,
  })
  .superRefine((delivery, context) => {
    if (!deliverySemanticsMatch(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message:
          'Menu-control terminal reconciliation must preserve the original immutable delivery',
      });
    }
    if (
      delivery.replacementLease.leaseId === delivery.lease.leaseId ||
      delivery.replacementLease.sessionId !== delivery.lease.sessionId ||
      delivery.replacementLease.target.adapterId !== delivery.target.adapterId ||
      delivery.replacementLease.target.instanceId !== delivery.target.instanceId ||
      delivery.replacementLease.documentIncarnationId !== delivery.lease.documentIncarnationId ||
      Date.parse(delivery.recoveryRequestedAt) < Date.parse(delivery.dispatchedAt) ||
      Date.parse(delivery.recoveryRequestedAt) >= Date.parse(delivery.replacementLease.expiresAt) ||
      new Set(delivery.acknowledgedProgressReceiptChainHeads).size !==
        delivery.acknowledgedProgressReceiptChainHeads.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['replacementLease'],
        message:
          'Terminal reconciliation requires a distinct current lease for the same live document and an ordered server receipt prefix',
      });
    }
  });
export type CompanionMenuControlProofTerminalReconciliationDelivery = z.infer<
  typeof companionMenuControlProofTerminalReconciliationDeliverySchema
>;

export const companionMenuControlProofTerminalReconciliationAckSchema = z
  .strictObject({
    kind: z.literal('native_terminal_reconcile'),
    recoveryId: z.uuid(),
    result: companionMenuControlProofResultSchema,
    terminalResultContentSha256: sha256Schema,
    expectedMarkerContentSha256: sha256Schema,
    currentSceneFingerprintSha256: sha256Schema,
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    const sceneFingerprint = lockedMenuControlProofSceneFingerprint(ack.result);
    if (sceneFingerprint === null) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message:
          'Terminal reconciliation accepts only a persisted locked success or checkpointed failure',
      });
      return;
    }
    if (
      ack.terminalResultContentSha256 !==
      computeCompanionMenuControlProofResultContentSha256(ack.result)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalResultContentSha256'],
        message: 'Terminal reconciliation result hash must bind the complete persisted result',
      });
    }
    if (ack.currentSceneFingerprintSha256 !== sceneFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['currentSceneFingerprintSha256'],
        message: 'Terminal reconciliation must prove the locked current Scene fingerprint',
      });
    }
    if (
      ack.expectedMarkerContentSha256 !==
      computeCompanionMenuControlProofTerminalMarkerContentSha256(ack.result)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedMarkerContentSha256'],
        message: 'Terminal reconciliation marker hash must bind the locked terminal identity',
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
export type CompanionMenuControlProofTerminalReconciliationAck = z.infer<
  typeof companionMenuControlProofTerminalReconciliationAckSchema
>;

export function companionMenuControlProofTerminalReconciliationAckMatchesDelivery(
  ack: CompanionMenuControlProofTerminalReconciliationAck,
  delivery: CompanionMenuControlProofTerminalReconciliationDelivery,
): boolean {
  return (
    ack.recoveryId === delivery.recoveryId &&
    isDeepStrictDeliveryIdentity(ack.result, delivery) &&
    Date.parse(ack.occurredAt) >= Date.parse(delivery.recoveryRequestedAt)
  );
}

function isDeepStrictDeliveryIdentity(
  result: Record<string, unknown>,
  delivery: Record<string, unknown>,
): boolean {
  return (
    computeProtocolCanonicalJsonSha256(
      Object.fromEntries(Object.keys(deliveryIdentityShape).map((key) => [key, result[key]])),
    ) ===
    computeProtocolCanonicalJsonSha256(
      Object.fromEntries(Object.keys(deliveryIdentityShape).map((key) => [key, delivery[key]])),
    )
  );
}

const historyCursorSchema = z.number().int().min(0).max(8).nullable();
const historyStatusSchema = z.enum(['history_locked', 'restored']);

export const companionMenuControlProofHistoryIdentitySchema = z
  .strictObject({
    checkpointId: z.uuid(),
    undoLockId: z.uuid(),
    checkpointKind: z.enum(['success', 'failure']),
    stageFingerprints: historyStageFingerprintsSchema,
    terminalResultContentSha256: sha256Schema,
    terminalMarkerContentSha256: sha256Schema,
  })
  .superRefine((history, context) => {
    const valid =
      history.checkpointKind === 'success'
        ? new Set(history.stageFingerprints).size === 9
        : history.stageFingerprints[0] !== history.stageFingerprints[1] &&
          history.stageFingerprints
            .slice(1)
            .every((fingerprint) => fingerprint === history.stageFingerprints[1]);
    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['stageFingerprints'],
        message:
          'Success history requires nine distinct stages; failure history requires one baseline and one repeated locked stage',
      });
    }
  });
export type CompanionMenuControlProofHistoryIdentity = z.infer<
  typeof companionMenuControlProofHistoryIdentitySchema
>;

export const companionMenuControlProofTerminalHistoryIdentitySchema = z.strictObject({
  checkpointId: z.uuid(),
  undoLockId: z.uuid(),
  checkpointKind: z.enum(['success', 'failure']),
  baselineSceneFingerprintSha256: sha256Schema,
  lockedSceneFingerprintSha256: sha256Schema,
  terminalResultContentSha256: sha256Schema,
  terminalMarkerContentSha256: sha256Schema,
});
export type CompanionMenuControlProofTerminalHistoryIdentity = z.infer<
  typeof companionMenuControlProofTerminalHistoryIdentitySchema
>;

export function companionMenuControlProofTerminalHistoryIdentity(
  result: CompanionMenuControlProofResult,
): CompanionMenuControlProofTerminalHistoryIdentity {
  const marker = companionMenuControlProofTerminalMarkerIdentity(result);
  return {
    checkpointId: marker.checkpointId,
    undoLockId: marker.undoLockId,
    checkpointKind: marker.checkpointKind,
    baselineSceneFingerprintSha256: marker.baselineSceneFingerprintSha256,
    lockedSceneFingerprintSha256: marker.lockedSceneFingerprintSha256,
    terminalResultContentSha256: marker.terminalResultContentSha256,
    terminalMarkerContentSha256:
      computeCompanionMenuControlProofTerminalMarkerContentSha256(result),
  };
}

export function companionMenuControlProofHistoryIdentityMatchesTerminalHistory(
  history: CompanionMenuControlProofHistoryIdentity,
  terminalHistory: CompanionMenuControlProofTerminalHistoryIdentity,
): boolean {
  const lockedIndex = terminalHistory.checkpointKind === 'success' ? 8 : 1;
  return (
    history.checkpointId === terminalHistory.checkpointId &&
    history.undoLockId === terminalHistory.undoLockId &&
    history.checkpointKind === terminalHistory.checkpointKind &&
    history.stageFingerprints[0] === terminalHistory.baselineSceneFingerprintSha256 &&
    history.stageFingerprints[lockedIndex] === terminalHistory.lockedSceneFingerprintSha256 &&
    history.terminalResultContentSha256 === terminalHistory.terminalResultContentSha256 &&
    history.terminalMarkerContentSha256 === terminalHistory.terminalMarkerContentSha256
  );
}

export function companionMenuControlProofHistoryIdentityMatchesResult(
  history: CompanionMenuControlProofHistoryIdentity,
  result: CompanionMenuControlProofResult,
): boolean {
  const parsedHistory = companionMenuControlProofHistoryIdentitySchema.parse(history);
  const parsedResult = companionMenuControlProofResultSchema.parse(result);
  return companionMenuControlProofHistoryIdentityMatchesTerminalHistory(
    parsedHistory,
    companionMenuControlProofTerminalHistoryIdentity(parsedResult),
  );
}

export const companionMenuControlProofHistoryTransitionSchema = z.strictObject({
  transitionId: z.uuid(),
  checkpointId: z.uuid(),
  undoLockId: z.uuid(),
  direction: z.enum(['undo', 'redo']),
  fromCursor: historyCursorSchema,
  toCursor: historyCursorSchema,
  stage: z.enum([...historyStageValues, 'failure_checkpoint']),
  status: historyStatusSchema,
  sceneFingerprintSha256: sha256Schema,
  occurredAt: timestampSchema,
});
export type CompanionMenuControlProofHistoryTransition = z.infer<
  typeof companionMenuControlProofHistoryTransitionSchema
>;

export function computeCompanionMenuControlProofHistoryTransitionContentSha256(
  transition: CompanionMenuControlProofHistoryTransition,
): string {
  return computeProtocolCanonicalJsonSha256(
    companionMenuControlProofHistoryTransitionSchema.parse(transition),
  );
}

function historyCursorStatusMatches(
  history: { checkpointKind: 'success' | 'failure' },
  cursor: number | null,
  status: z.infer<typeof historyStatusSchema>,
): boolean {
  return history.checkpointKind === 'success'
    ? cursor !== null && status === (cursor === 0 ? 'restored' : 'history_locked')
    : (cursor === null && status === 'history_locked') || (cursor === 0 && status === 'restored');
}

function historyTransitionMatches(
  transition: CompanionMenuControlProofHistoryTransition,
  history: CompanionMenuControlProofHistoryIdentity,
  fromCursor: number | null,
  fromStatus: z.infer<typeof historyStatusSchema>,
): boolean {
  if (
    transition.checkpointId !== history.checkpointId ||
    transition.undoLockId !== history.undoLockId ||
    transition.fromCursor !== fromCursor ||
    !historyCursorStatusMatches(history, fromCursor, fromStatus) ||
    !historyCursorStatusMatches(history, transition.toCursor, transition.status)
  ) {
    return false;
  }
  if (history.checkpointKind === 'failure') {
    const undo =
      transition.direction === 'undo' &&
      transition.fromCursor === null &&
      transition.toCursor === 0;
    const redo =
      transition.direction === 'redo' &&
      transition.fromCursor === 0 &&
      transition.toCursor === null;
    return (
      (undo || redo) &&
      transition.stage === (transition.toCursor === 0 ? 'baseline' : 'failure_checkpoint') &&
      transition.sceneFingerprintSha256 ===
        history.stageFingerprints[transition.toCursor === 0 ? 0 : 1]
    );
  }
  if (transition.fromCursor === null || transition.toCursor === null) return false;
  return (
    transition.toCursor - transition.fromCursor === (transition.direction === 'undo' ? -1 : 1) &&
    transition.stage === historyStageValues[transition.toCursor] &&
    transition.sceneFingerprintSha256 === history.stageFingerprints[transition.toCursor]
  );
}

function currentLeaseMatchesOriginalDocument(
  currentLease: z.infer<typeof leaseSchema>,
  originalLease: z.infer<typeof leaseSchema>,
  target: z.infer<typeof targetSchema>,
): boolean {
  return (
    currentLease.sessionId === originalLease.sessionId &&
    currentLease.target.adapterId === target.adapterId &&
    currentLease.target.instanceId === target.instanceId &&
    currentLease.documentIncarnationId === originalLease.documentIncarnationId
  );
}

export const companionMenuControlProofHistoryTransitionReportSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_history_transition'),
    currentLease: leaseSchema,
    history: companionMenuControlProofHistoryIdentitySchema,
    serverAcceptedCursor: historyCursorSchema,
    serverAcceptedStatus: historyStatusSchema,
    transition: companionMenuControlProofHistoryTransitionSchema,
    transitionContentSha256: sha256Schema,
    reportedAt: timestampSchema,
  })
  .superRefine((report, context) => {
    if (
      !deliverySemanticsMatch(report) ||
      !currentLeaseMatchesOriginalDocument(report.currentLease, report.lease, report.target) ||
      !historyTransitionMatches(
        report.transition,
        report.history,
        report.serverAcceptedCursor,
        report.serverAcceptedStatus,
      ) ||
      report.transitionContentSha256 !==
        computeCompanionMenuControlProofHistoryTransitionContentSha256(report.transition) ||
      Date.parse(report.transition.occurredAt) < Date.parse(report.dispatchedAt) ||
      Date.parse(report.transition.occurredAt) > Date.parse(report.reportedAt) ||
      Date.parse(report.reportedAt) >= Date.parse(report.currentLease.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Menu-control history transition report must bind one exact adjacent native transition to the current live document',
      });
    }
  });
export type CompanionMenuControlProofHistoryTransitionReport = z.infer<
  typeof companionMenuControlProofHistoryTransitionReportSchema
>;

export function companionMenuControlProofHistoryTransitionReportMatchesResult(
  report: CompanionMenuControlProofHistoryTransitionReport,
  result: CompanionMenuControlProofResult,
): boolean {
  return (
    isDeepStrictDeliveryIdentity(result, report) &&
    companionMenuControlProofHistoryIdentityMatchesResult(report.history, result)
  );
}

export const companionMenuControlProofHistoryTransitionReconciliationDeliverySchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_history_transition_reconcile'),
    recoveryId: z.uuid(),
    replacementLease: leaseSchema,
    history: companionMenuControlProofTerminalHistoryIdentitySchema,
    serverAcceptedCursor: historyCursorSchema,
    serverAcceptedStatus: historyStatusSchema,
    acknowledgedTransitionContentSha256s: z.array(sha256Schema).max(32),
    expectedMarkerContentSha256: sha256Schema,
    recoveryRequestedAt: timestampSchema,
  })
  .superRefine((challenge, context) => {
    if (
      !deliverySemanticsMatch(challenge) ||
      challenge.replacementLease.leaseId === challenge.lease.leaseId ||
      !currentLeaseMatchesOriginalDocument(
        challenge.replacementLease,
        challenge.lease,
        challenge.target,
      ) ||
      !historyCursorStatusMatches(
        challenge.history,
        challenge.serverAcceptedCursor,
        challenge.serverAcceptedStatus,
      ) ||
      new Set(challenge.acknowledgedTransitionContentSha256s).size !==
        challenge.acknowledgedTransitionContentSha256s.length ||
      challenge.expectedMarkerContentSha256 !== challenge.history.terminalMarkerContentSha256 ||
      Date.parse(challenge.recoveryRequestedAt) < Date.parse(challenge.dispatchedAt) ||
      Date.parse(challenge.recoveryRequestedAt) >= Date.parse(challenge.replacementLease.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Menu-control history reconciliation must bind the accepted cursor to a distinct current lease for the same document',
      });
    }
  });
export type CompanionMenuControlProofHistoryTransitionReconciliationDelivery = z.infer<
  typeof companionMenuControlProofHistoryTransitionReconciliationDeliverySchema
>;

export const companionMenuControlProofHistoryTransitionReconciliationAckSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    kind: z.literal('native_history_transition_reconcile'),
    recoveryId: z.uuid(),
    history: companionMenuControlProofHistoryIdentitySchema,
    serverAcceptedCursor: historyCursorSchema,
    serverAcceptedStatus: historyStatusSchema,
    transitions: z.array(companionMenuControlProofHistoryTransitionSchema).max(32),
    transitionContentSha256s: z.array(sha256Schema).max(32),
    terminalResultContentSha256: sha256Schema,
    expectedMarkerContentSha256: sha256Schema,
    currentCursor: historyCursorSchema,
    currentStatus: historyStatusSchema,
    currentSceneFingerprintSha256: sha256Schema,
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    let cursor = ack.serverAcceptedCursor;
    let status = ack.serverAcceptedStatus;
    let previousOccurredAt = Number.NEGATIVE_INFINITY;
    let valid =
      deliverySemanticsMatch(ack) &&
      historyCursorStatusMatches(ack.history, cursor, status) &&
      ack.transitions.length === ack.transitionContentSha256s.length &&
      ack.terminalResultContentSha256 === ack.history.terminalResultContentSha256 &&
      ack.expectedMarkerContentSha256 === ack.history.terminalMarkerContentSha256;
    for (const [index, transition] of ack.transitions.entries()) {
      valid &&=
        historyTransitionMatches(transition, ack.history, cursor, status) &&
        ack.transitionContentSha256s[index] ===
          computeCompanionMenuControlProofHistoryTransitionContentSha256(transition) &&
        Date.parse(transition.occurredAt) > previousOccurredAt;
      cursor = transition.toCursor;
      status = transition.status;
      previousOccurredAt = Date.parse(transition.occurredAt);
    }
    const fingerprintIndex = cursor === null ? 1 : cursor;
    valid &&=
      cursor === ack.currentCursor &&
      status === ack.currentStatus &&
      ack.currentSceneFingerprintSha256 === ack.history.stageFingerprints[fingerprintIndex] &&
      Date.parse(ack.occurredAt) >= previousOccurredAt;
    if (!valid) {
      context.addIssue({
        code: 'custom',
        message:
          'Menu-control history reconciliation must prove the exact chronological adjacent transition outbox and final Scene',
      });
    }
  });
export type CompanionMenuControlProofHistoryTransitionReconciliationAck = z.infer<
  typeof companionMenuControlProofHistoryTransitionReconciliationAckSchema
>;

export function companionMenuControlProofHistoryTransitionReconciliationAckMatchesDelivery(
  ack: CompanionMenuControlProofHistoryTransitionReconciliationAck,
  delivery: CompanionMenuControlProofHistoryTransitionReconciliationDelivery,
): boolean {
  return (
    ack.recoveryId === delivery.recoveryId &&
    isDeepStrictDeliveryIdentity(ack, delivery) &&
    companionMenuControlProofHistoryIdentityMatchesTerminalHistory(ack.history, delivery.history) &&
    ack.serverAcceptedCursor === delivery.serverAcceptedCursor &&
    ack.serverAcceptedStatus === delivery.serverAcceptedStatus &&
    ack.expectedMarkerContentSha256 === delivery.expectedMarkerContentSha256 &&
    Date.parse(ack.occurredAt) >= Date.parse(delivery.recoveryRequestedAt)
  );
}

export const companionMenuControlProofPollRequestSchema = targetSchema;
export type CompanionMenuControlProofPollRequest = z.infer<
  typeof companionMenuControlProofPollRequestSchema
>;
export const companionMenuControlProofPollDeliverySchema = z.strictObject({
  request: z
    .union([
      companionMenuControlProofDeliverySchema,
      companionMenuControlProofTerminalReconciliationDeliverySchema,
      companionMenuControlProofHistoryTransitionReconciliationDeliverySchema,
    ])
    .nullable(),
});
export type CompanionMenuControlProofPollDelivery = z.infer<
  typeof companionMenuControlProofPollDeliverySchema
>;

const ackSchema = z.strictObject({ result: z.enum(['accepted', 'duplicate']) });
export const companionMenuControlProofProgressAckSchema = ackSchema;
export const companionMenuControlProofResultAckSchema = ackSchema;
export const companionMenuControlProofRecoveryAckResponseSchema = ackSchema;
export const companionMenuControlProofRecoveryRequestSchema = z.union([
  companionMenuControlProofTerminalReconciliationAckSchema,
  companionMenuControlProofHistoryTransitionReconciliationAckSchema,
]);
export type CompanionMenuControlProofRecoveryRequest = z.infer<
  typeof companionMenuControlProofRecoveryRequestSchema
>;

const statusValueSchema = z.enum([
  'queued',
  'dispatched',
  'in_progress',
  'recovery_pending',
  'pre_dispatch_authority_expired',
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);
const terminalResultStatusValues = [
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
] as const;
const terminalResultStatuses = new Set<string>(terminalResultStatusValues);

export const companionMenuControlProofRecoveryEvidenceSchema = z.strictObject({
  kind: z.enum(['runtime_restart_after_delivery', 'document_authority_changed_after_delivery']),
  detectedAt: timestampSchema,
  priorStatus: z.enum(['dispatched', 'in_progress']),
  requiresExplicitRecovery: z.literal(true),
  automaticReplayAllowed: z.literal(false),
  retainsTargetLock: z.literal(true),
});
export const companionMenuControlProofPreDispatchAuthorityEvidenceSchema = z.strictObject({
  kind: z.literal('document_authority_changed_before_dispatch'),
  priorStatus: z.literal('queued'),
  detectedAt: timestampSchema,
  automaticReplayAllowed: z.literal(false),
  retainsTargetLock: z.literal(false),
});
export type CompanionMenuControlProofRecoveryEvidence = z.infer<
  typeof companionMenuControlProofRecoveryEvidenceSchema
>;

export const companionMenuControlProofStatusSchema = z
  .strictObject({
    ...baseIdentityShape,
    deliveryId: z.uuid().optional(),
    lease: leaseSchema.optional(),
    dispatchedAt: timestampSchema.optional(),
    status: statusValueSchema,
    progress: companionMenuControlProofProgressSchema.optional(),
    result: companionMenuControlProofResultSchema.optional(),
    recovery: companionMenuControlProofRecoveryEvidenceSchema.optional(),
    preDispatchAuthorityExpiration:
      companionMenuControlProofPreDispatchAuthorityEvidenceSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((status, context) => {
    if (
      !bindingIdentityMatches(status) ||
      Date.parse(status.binding.createdAt) > Date.parse(status.requestedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Status binding identity or request chronology changed',
      });
    }
    const deliveryFieldCount = [status.deliveryId, status.lease, status.dispatchedAt].filter(
      (value) => value !== undefined,
    ).length;
    const delivered = deliveryFieldCount === 3;
    const terminalResult = terminalResultStatuses.has(status.status);
    const authorityExpiredBeforeDelivery = status.status === 'pre_dispatch_authority_expired';
    if (
      (deliveryFieldCount !== 0 && !delivered) ||
      (status.status === 'queued' && delivered) ||
      (authorityExpiredBeforeDelivery && delivered) ||
      (status.status !== 'queued' && !authorityExpiredBeforeDelivery && !delivered) ||
      (status.status === 'in_progress') !== (status.progress !== undefined) ||
      terminalResult !== (status.result !== undefined) ||
      (status.status === 'recovery_pending') !== (status.recovery !== undefined) ||
      authorityExpiredBeforeDelivery !== (status.preDispatchAuthorityExpiration !== undefined) ||
      (status.result !== undefined && status.result.status !== status.status)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Menu-control proof status evidence is inconsistent',
      });
    }
    if (
      status.preDispatchAuthorityExpiration !== undefined &&
      (status.progress !== undefined ||
        status.result !== undefined ||
        status.recovery !== undefined ||
        Date.parse(status.requestedAt) >
          Date.parse(status.preDispatchAuthorityExpiration.detectedAt) ||
        status.updatedAt !== status.preDispatchAuthorityExpiration.detectedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preDispatchAuthorityExpiration'],
        message:
          'Pre-dispatch authority expiration must be terminal, undelivered, and chronologically exact',
      });
    }
    if (
      status.deliveryId !== undefined &&
      status.lease !== undefined &&
      status.dispatchedAt !== undefined &&
      !deliverySemanticsMatch({
        ...status,
        deliveryId: status.deliveryId,
        lease: status.lease,
        dispatchedAt: status.dispatchedAt,
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lease'],
        message: 'Delivered status must preserve exact delivery chronology and lease target',
      });
    }
    const nested = status.progress ?? status.result;
    if (
      nested !== undefined &&
      (nested.requestId !== status.requestId ||
        nested.replayId !== status.replayId ||
        nested.proofId !== status.proofId ||
        nested.deliveryId !== status.deliveryId ||
        nested.bindingContentSha256 !== status.bindingContentSha256 ||
        nested.target.instanceId !== status.target.instanceId ||
        nested.proposalId !== status.proposalId ||
        nested.plan.id !== status.plan.id ||
        nested.plan.revision !== status.plan.revision ||
        nested.plan.contentSha256 !== status.plan.contentSha256 ||
        nested.executionId !== status.executionId ||
        nested.leafId !== status.leafId ||
        nested.menuTrackContentSha256 !== status.menuTrackContentSha256 ||
        nested.requestedAt !== status.requestedAt ||
        nested.dispatchedAt !== status.dispatchedAt ||
        nested.lease.leaseId !== status.lease?.leaseId ||
        nested.lease.sessionId !== status.lease?.sessionId ||
        nested.lease.target.adapterId !== status.lease?.target.adapterId ||
        nested.lease.target.instanceId !== status.lease?.target.instanceId ||
        nested.lease.documentIncarnationId !== status.lease?.documentIncarnationId ||
        nested.lease.expiresAt !== status.lease?.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: [status.progress === undefined ? 'result' : 'progress'],
        message: 'Nested menu-control proof evidence must mirror immutable status identity',
      });
    }
    if (
      status.recovery !== undefined &&
      Date.parse(status.recovery.detectedAt) < Date.parse(status.dispatchedAt ?? '')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recovery', 'detectedAt'],
        message: 'Runtime restart detection must not predate delivery',
      });
    }
    const latestEvidenceAt =
      status.preDispatchAuthorityExpiration?.detectedAt ??
      status.recovery?.detectedAt ??
      nested?.occurredAt ??
      status.dispatchedAt ??
      status.requestedAt;
    if (Date.parse(status.updatedAt) < Date.parse(latestEvidenceAt)) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Menu-control proof status update must follow its latest nested evidence',
      });
    }
  });
export type CompanionMenuControlProofStatus = z.infer<typeof companionMenuControlProofStatusSchema>;
