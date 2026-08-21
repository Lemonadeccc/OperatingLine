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
      Date.parse(progress.occurredAt) < Date.parse(progress.dispatchedAt) ||
      Date.parse(progress.occurredAt) >= Date.parse(progress.lease.expiresAt)
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
const terminalEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
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
  }),
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
        (evidence.kind === 'recovery_required' && evidence.internalHistoryCursor > stageCount)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['terminalEvidence'],
          message: 'Failure evidence prefix is not canonical',
        });
      }
    }
    if (
      Date.parse(result.occurredAt) < Date.parse(result.dispatchedAt) ||
      Date.parse(result.occurredAt) >= Date.parse(result.lease.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'Result predates delivery',
      });
    }
  });
export type CompanionMenuControlProofResult = z.infer<typeof companionMenuControlProofResultSchema>;

export function computeCompanionMenuControlProofResultContentSha256(
  result: CompanionMenuControlProofResult,
): string {
  return computeProtocolCanonicalJsonSha256(companionMenuControlProofResultSchema.parse(result));
}

export const companionMenuControlProofPollRequestSchema = targetSchema;
export type CompanionMenuControlProofPollRequest = z.infer<
  typeof companionMenuControlProofPollRequestSchema
>;
export const companionMenuControlProofPollDeliverySchema = z.strictObject({
  request: companionMenuControlProofDeliverySchema.nullable(),
});
export type CompanionMenuControlProofPollDelivery = z.infer<
  typeof companionMenuControlProofPollDeliverySchema
>;

const ackSchema = z.strictObject({ result: z.enum(['accepted', 'duplicate']) });
export const companionMenuControlProofProgressAckSchema = ackSchema;
export const companionMenuControlProofResultAckSchema = ackSchema;

const statusValueSchema = z.enum([
  'queued',
  'dispatched',
  'in_progress',
  'succeeded',
  'failed_no_mutation',
  'failed_restored',
  'failed_checkpointed',
  'recovery_required',
]);
export const companionMenuControlProofStatusSchema = z
  .strictObject({
    ...baseIdentityShape,
    deliveryId: z.uuid().optional(),
    lease: leaseSchema.optional(),
    dispatchedAt: timestampSchema.optional(),
    status: statusValueSchema,
    progress: companionMenuControlProofProgressSchema.optional(),
    result: companionMenuControlProofResultSchema.optional(),
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
    const terminal = !['queued', 'dispatched', 'in_progress'].includes(status.status);
    if (
      (deliveryFieldCount !== 0 && !delivered) ||
      (status.status === 'queued' && delivered) ||
      (status.status !== 'queued' && !delivered) ||
      (status.status === 'in_progress') !== (status.progress !== undefined) ||
      terminal !== (status.result !== undefined) ||
      (status.result !== undefined && status.result.status !== status.status)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Menu-control proof status evidence is inconsistent',
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
    const latestEvidenceAt = nested?.occurredAt ?? status.dispatchedAt ?? status.requestedAt;
    if (Date.parse(status.updatedAt) < Date.parse(latestEvidenceAt)) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Menu-control proof status update must follow its latest nested evidence',
      });
    }
  });
export type CompanionMenuControlProofStatus = z.infer<typeof companionMenuControlProofStatusSchema>;
