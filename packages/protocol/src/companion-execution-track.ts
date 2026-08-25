import { z } from 'zod';

import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';
import { guideExecutionTrackOverrideSchema, guideStepIdSchema, guideStepSchema } from './guide.js';
import {
  menuProcedureTrackSchema,
  procedureLeafNodeSchema,
  shortcutProcedureTrackSchema,
} from './procedure-tree.js';
import { guideProposalDecisionSchema } from './proposal.js';
import { catalogVersionSchema } from './version.js';

export const companionExecutionTrackPreflightFormatVersion = '1.0.0' as const;
export const companionExecutionTrackPreflightFormatVersionSchema = z.literal(
  companionExecutionTrackPreflightFormatVersion,
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });
const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});
const planSchema = z.strictObject({
  protocolVersion: z.enum(['1.6.0', '1.7.0']),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  contentSha256: sha256Schema,
});
const reviewSchema = z.strictObject({ id: z.uuid(), contentSha256: sha256Schema });
const replaySchema = z.strictObject({ id: z.uuid(), bindingContentSha256: sha256Schema });
const revisionSchema = z.strictObject({
  requestContentSha256: sha256Schema,
  diffContentSha256: sha256Schema,
});
const durableProposalSchema = z.strictObject({
  id: z.uuid(),
  contentSha256: sha256Schema,
});
const artifactHashesSchema = z.strictObject({
  procedureTreeContentSha256: sha256Schema,
  sourceLeafContentSha256: sha256Schema,
});
const catalogAuthoritySchema = z.strictObject({
  action: z.strictObject({ version: catalogVersionSchema, contentSha256: sha256Schema }),
  interaction: z.strictObject({
    version: catalogVersionSchema,
    contentSha256: sha256Schema,
    recipeId: guideStepIdSchema,
  }),
});
const acceptedDecisionSchema = guideProposalDecisionSchema.safeExtend({
  protocolVersion: z.enum(['1.6.0', '1.7.0']),
  adapterId: z.literal('blender'),
  decision: z.literal('accepted'),
});
const acceptanceSchema = z.strictObject({
  decision: acceptedDecisionSchema,
  decisionContentSha256: sha256Schema,
  receipt: z.strictObject({
    sequence: z.number().int().positive(),
    subjectType: z.literal('guide_proposal_decision'),
    subjectId: z.uuid(),
    authentication: z.literal('negotiated_companion_lease'),
    adapterId: z.literal('blender'),
    instanceId: z.uuid(),
    sessionFingerprintSha256: sha256Schema,
    receivedAt: timestampSchema,
  }),
});

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return computeProtocolCanonicalJsonSha256(left) === computeProtocolCanonicalJsonSha256(right);
}

export const companionExecutionTrackPreflightLeaseSchema = z.strictObject({
  leaseId: z.uuid(),
  sessionId: z.uuid(),
  target: targetSchema,
  documentIncarnationId: z.uuid(),
  expiresAt: timestampSchema,
});
export type CompanionExecutionTrackPreflightLease = z.infer<
  typeof companionExecutionTrackPreflightLeaseSchema
>;

const selectedTrackSchema = z
  .union([menuProcedureTrackSchema, shortcutProcedureTrackSchema])
  .superRefine((track, context) => {
    if (track.availability !== 'available' || track.proofExecution === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Execution-track preflight requires an available proof-backed track',
      });
    }
  });
export type CompanionExecutionTrackPreflightSelectedTrack = z.infer<typeof selectedTrackSchema>;

const createIdentityShape = {
  formatVersion: companionExecutionTrackPreflightFormatVersionSchema,
  requestId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: planSchema,
  executionId: z.uuid(),
  leafId: guideStepIdSchema,
  override: guideExecutionTrackOverrideSchema,
  expectedState: expectedStateSchema,
} as const;

export const companionExecutionTrackPreflightCreateRequestSchema =
  z.strictObject(createIdentityShape);
export type CompanionExecutionTrackPreflightCreateRequest = z.infer<
  typeof companionExecutionTrackPreflightCreateRequestSchema
>;

const bindingContentShape = {
  formatVersion: createIdentityShape.formatVersion,
  requestId: createIdentityShape.requestId,
  target: createIdentityShape.target,
  proposal: durableProposalSchema,
  plan: createIdentityShape.plan,
  executionId: createIdentityShape.executionId,
  leafId: createIdentityShape.leafId,
  override: createIdentityShape.override,
  expectedState: createIdentityShape.expectedState,
  replayId: z.uuid(),
  step: guideStepSchema,
  review: reviewSchema,
  revision: revisionSchema,
  replay: replaySchema,
  artifacts: artifactHashesSchema,
  catalogs: catalogAuthoritySchema,
  acceptance: acceptanceSchema,
  action: procedureLeafNodeSchema.shape.action.unwrap(),
  sourceLeaf: procedureLeafNodeSchema,
  selectedTrack: selectedTrackSchema,
  requestedAt: timestampSchema,
} as const;

const bindingContentSchema = z.strictObject(bindingContentShape);

function bindingSemanticsMatch(value: z.infer<typeof bindingContentSchema>): boolean {
  const track = value.selectedTrack;
  if (track.availability !== 'available' || track.proofExecution === undefined) return false;
  const sourceTracks =
    value.override.modality === 'menu'
      ? value.sourceLeaf.menuTracks
      : value.sourceLeaf.shortcutTracks;
  const sourceTrack = sourceTracks.find((candidate) => candidate.id === value.override.trackId);
  return (
    value.replay.id === value.replayId &&
    value.acceptance.decision.protocolVersion === value.plan.protocolVersion &&
    value.acceptance.decisionContentSha256 ===
      computeProtocolCanonicalJsonSha256(value.acceptance.decision) &&
    value.acceptance.decision.proposalId === value.proposal.id &&
    value.acceptance.decision.instanceId === value.target.instanceId &&
    value.acceptance.receipt.subjectId === value.acceptance.decision.decisionId &&
    value.acceptance.receipt.adapterId === value.target.adapterId &&
    value.acceptance.receipt.instanceId === value.target.instanceId &&
    Date.parse(value.acceptance.decision.occurredAt) <=
      Date.parse(value.acceptance.receipt.receivedAt) &&
    Date.parse(value.acceptance.receipt.receivedAt) <= Date.parse(value.requestedAt) &&
    value.sourceLeaf.id === value.leafId &&
    value.step.id === value.leafId &&
    value.sourceLeaf.action !== null &&
    value.step.action !== null &&
    value.action.adapterId === value.target.adapterId &&
    value.step.executionTrackOverride !== undefined &&
    sameCanonicalJson(value.step.executionTrackOverride, value.override) &&
    sameCanonicalJson(value.sourceLeaf.action, value.action) &&
    sameCanonicalJson(value.step.action, value.action) &&
    value.selectedTrack.modality === value.override.modality &&
    value.selectedTrack.id === value.override.trackId &&
    value.catalogs.interaction.version === value.override.interactionCatalogVersion &&
    value.catalogs.interaction.contentSha256 === value.override.interactionCatalogContentSha256 &&
    value.catalogs.interaction.recipeId === value.override.recipeId &&
    sourceTrack !== undefined &&
    sameCanonicalJson(sourceTrack, value.selectedTrack) &&
    value.override.trackContentSha256 === computeProtocolCanonicalJsonSha256(value.selectedTrack) &&
    value.override.proofExecutionContentSha256 ===
      computeProtocolCanonicalJsonSha256(track.proofExecution) &&
    value.override.interactionCatalogVersion.length > 0 &&
    value.override.recipeId.length > 0 &&
    value.artifacts.sourceLeafContentSha256 === computeProtocolCanonicalJsonSha256(value.sourceLeaf)
  );
}

export const companionExecutionTrackPreflightBindingSchema = bindingContentSchema
  .safeExtend({ bindingContentSha256: sha256Schema })
  .superRefine((binding, context) => {
    if (!bindingSemanticsMatch(binding)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedTrack'],
        message: 'Preflight binding must preserve its exact source leaf and proof-backed override',
      });
    }
    const { bindingContentSha256, ...content } = binding;
    if (bindingContentSha256 !== computeProtocolCanonicalJsonSha256(content)) {
      context.addIssue({
        code: 'custom',
        path: ['bindingContentSha256'],
        message: 'Preflight binding hash must match its canonical content',
      });
    }
  });
export type CompanionExecutionTrackPreflightBinding = z.infer<
  typeof companionExecutionTrackPreflightBindingSchema
>;

type DeliveredPreflightIdentity = {
  readonly binding: CompanionExecutionTrackPreflightBinding;
  readonly lease: CompanionExecutionTrackPreflightLease;
  readonly dispatchedAt: string;
};

function deliverySemanticsMatch(delivery: DeliveredPreflightIdentity): boolean {
  return (
    sameCanonicalJson(delivery.lease.target, delivery.binding.target) &&
    Date.parse(delivery.binding.requestedAt) <= Date.parse(delivery.dispatchedAt) &&
    Date.parse(delivery.dispatchedAt) < Date.parse(delivery.lease.expiresAt)
  );
}

export const companionExecutionTrackPreflightDeliverySchema = z
  .strictObject({
    binding: companionExecutionTrackPreflightBindingSchema,
    deliveryId: z.uuid(),
    lease: companionExecutionTrackPreflightLeaseSchema,
    dispatchedAt: timestampSchema,
  })
  .superRefine((delivery, context) => {
    if (!deliverySemanticsMatch(delivery)) {
      context.addIssue({
        code: 'custom',
        path: ['lease'],
        message: 'Preflight delivery requires a live lease for the exact bound target',
      });
    }
  });
export type CompanionExecutionTrackPreflightDelivery = z.infer<
  typeof companionExecutionTrackPreflightDeliverySchema
>;

export const companionExecutionTrackPreflightReasonCodeSchema = z.enum([
  'executor_unavailable',
  'modality_not_supported',
  'authority_invalid',
  'binding_invalid',
  'history_locked',
  'preflight_rejected',
]);

const terminalResultIdentityShape = {
  formatVersion: companionExecutionTrackPreflightFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  deliveryId: z.uuid(),
  bindingContentSha256: sha256Schema,
  target: targetSchema,
  leaseId: z.uuid(),
  proposalId: z.uuid(),
  planId: z.string().min(1),
  planRevision: z.number().int().positive(),
  executionId: z.uuid(),
  leafId: guideStepIdSchema,
} as const;

export const companionExecutionTrackPreflightResultSchema = z
  .strictObject({
    ...terminalResultIdentityShape,
    status: z.enum(['verified_unavailable', 'rejected']),
    authorityVerified: z.boolean(),
    capability: z.literal('preflight_only'),
    reasonCode: companionExecutionTrackPreflightReasonCodeSchema,
    error: z.string().min(1).max(2_000),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (result.authorityVerified !== (result.status === 'verified_unavailable')) {
      context.addIssue({
        code: 'custom',
        path: ['authorityVerified'],
        message: 'Only verified_unavailable may assert verified preflight authority',
      });
    }
    if (
      result.status === 'verified_unavailable' &&
      result.reasonCode !== 'executor_unavailable' &&
      result.reasonCode !== 'modality_not_supported'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'Verified unavailability requires an unavailable capability reason',
      });
    }
    if (
      result.status === 'rejected' &&
      (result.reasonCode === 'executor_unavailable' ||
        result.reasonCode === 'modality_not_supported')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'Rejected preflight cannot use a verified capability-unavailability reason',
      });
    }
  });
export type CompanionExecutionTrackPreflightResult = z.infer<
  typeof companionExecutionTrackPreflightResultSchema
>;

export const companionExecutionTrackPreflightStatusValueSchema = z.enum([
  'queued',
  'dispatched',
  'verified_unavailable',
  'rejected',
  'recovery_required',
]);

export const companionExecutionTrackPreflightStatusSchema = z
  .strictObject({
    binding: companionExecutionTrackPreflightBindingSchema,
    deliveryId: z.uuid().optional(),
    lease: companionExecutionTrackPreflightLeaseSchema.optional(),
    dispatchedAt: timestampSchema.optional(),
    status: companionExecutionTrackPreflightStatusValueSchema,
    result: companionExecutionTrackPreflightResultSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((status, context) => {
    const hasAnyDelivery =
      status.deliveryId !== undefined ||
      status.lease !== undefined ||
      status.dispatchedAt !== undefined;
    const hasDelivery =
      status.deliveryId !== undefined &&
      status.lease !== undefined &&
      status.dispatchedAt !== undefined;
    const terminal = status.status === 'verified_unavailable' || status.status === 'rejected';
    const requestedAt = Date.parse(status.binding.requestedAt);
    const updatedAt = Date.parse(status.updatedAt);
    if (updatedAt < requestedAt) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Preflight status cannot predate its immutable request',
      });
    }
    if (
      status.status === 'queued' &&
      (hasAnyDelivery || status.result !== undefined || updatedAt !== requestedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Queued preflight cannot have delivery evidence or a later update timestamp',
      });
      return;
    }
    if (
      (status.status === 'dispatched' || status.status === 'recovery_required') &&
      (!hasDelivery || status.result !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${status.status} requires delivery evidence and no terminal result`,
      });
      return;
    }
    if (
      hasDelivery &&
      (!deliverySemanticsMatch({
        binding: status.binding,
        lease: status.lease!,
        dispatchedAt: status.dispatchedAt!,
      }) ||
        updatedAt < Date.parse(status.dispatchedAt!))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lease'],
        message: 'Delivered status must preserve the exact live lease and dispatch chronology',
      });
    }
    if (!terminal) return;
    if (!hasDelivery || status.result === undefined || status.result.status !== status.status) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Terminal preflight requires matching delivery evidence and result',
      });
      return;
    }
    const result = status.result;
    const binding = status.binding;
    const occurredAt = Date.parse(result.occurredAt);
    const dispatchedAt = Date.parse(status.dispatchedAt!);
    if (
      occurredAt < dispatchedAt ||
      occurredAt > updatedAt ||
      occurredAt >= Date.parse(status.lease!.expiresAt) ||
      updatedAt >= Date.parse(status.lease!.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'occurredAt'],
        message: 'Terminal preflight result violates delivery, update, or lease chronology',
      });
    }
    if (
      result.formatVersion !== binding.formatVersion ||
      result.requestId !== binding.requestId ||
      result.replayId !== binding.replayId ||
      result.deliveryId !== status.deliveryId ||
      result.bindingContentSha256 !== binding.bindingContentSha256 ||
      !sameCanonicalJson(result.target, binding.target) ||
      result.leaseId !== status.lease?.leaseId ||
      result.proposalId !== binding.proposal.id ||
      result.planId !== binding.plan.id ||
      result.planRevision !== binding.plan.revision ||
      result.executionId !== binding.executionId ||
      result.leafId !== binding.leafId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Terminal result must mirror the immutable preflight delivery identity',
      });
    }
  });
export type CompanionExecutionTrackPreflightStatus = z.infer<
  typeof companionExecutionTrackPreflightStatusSchema
>;

export const companionExecutionTrackPreflightStatusRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type CompanionExecutionTrackPreflightStatusRequest = z.infer<
  typeof companionExecutionTrackPreflightStatusRequestSchema
>;

export const companionExecutionTrackPreflightPollRequestSchema = targetSchema;
export type CompanionExecutionTrackPreflightPollRequest = z.infer<
  typeof companionExecutionTrackPreflightPollRequestSchema
>;

export const companionExecutionTrackPreflightPollDeliverySchema = z.strictObject({
  request: companionExecutionTrackPreflightDeliverySchema.nullable(),
});
export type CompanionExecutionTrackPreflightPollDelivery = z.infer<
  typeof companionExecutionTrackPreflightPollDeliverySchema
>;

export const companionExecutionTrackPreflightResultAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
export type CompanionExecutionTrackPreflightResultAck = z.infer<
  typeof companionExecutionTrackPreflightResultAckSchema
>;
