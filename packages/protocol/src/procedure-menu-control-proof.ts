import { z } from 'zod';

import {
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import { companionNativeUndoCheckpointSchema } from './companion.js';
import { guideStepIdSchema } from './guide.js';
import { menuProofExecutionSchema } from './interaction-catalog.js';
import {
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
} from './procedure-materialization.js';
import { guideProposalSchema } from './proposal.js';
import { catalogVersionSchema } from './version.js';

export const procedureMenuControlProofFormatVersion = '1.0.0' as const;
export const procedureMenuControlProofFormatVersionSchema = z.literal(
  procedureMenuControlProofFormatVersion,
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const integritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: sha256Schema,
});
const exactArgumentsSchema = z.strictObject({
  resourceId: z.literal('proof.uv_sphere.eye'),
  objectName: z.literal('OperatingLine.TutorialEye'),
  radius: z.literal(1.5),
  location: z.tuple([z.literal(1.25), z.literal(-2), z.literal(0.75)]),
});
const pristineStartCheckpointSessionSchema =
  companionNativeUndoCheckpointSchema.shape.session.safeExtend({
    activeStepId: z.null(),
    completedStepIds: z.tuple([]),
    receiptStepIds: z.tuple([]),
  });
const pristineStartNativeUndoCheckpointSchema = companionNativeUndoCheckpointSchema.safeExtend({
  previousCheckpointId: z.null(),
  operation: z.literal('start'),
  session: pristineStartCheckpointSessionSchema,
});

export const uvSphereMenuControlProofOperationIds = [
  'workspace.layout',
  'menu.add',
  'menu.mesh',
  'operator.uv_sphere',
  'control.location',
  'control.scale',
  'control.object_name',
] as const;
export const uvSphereMenuControlProofOperationIdsSchema = z.tuple([
  z.literal(uvSphereMenuControlProofOperationIds[0]),
  z.literal(uvSphereMenuControlProofOperationIds[1]),
  z.literal(uvSphereMenuControlProofOperationIds[2]),
  z.literal(uvSphereMenuControlProofOperationIds[3]),
  z.literal(uvSphereMenuControlProofOperationIds[4]),
  z.literal(uvSphereMenuControlProofOperationIds[5]),
  z.literal(uvSphereMenuControlProofOperationIds[6]),
]);

export const procedureMenuControlProofProposalRequestSchema = z.strictObject({
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  replayId: z.uuid(),
  targetInstanceId: z.uuid(),
  leafId: guideStepIdSchema,
  replayMode: z.literal('native_menu_control_proof'),
  packet: procedureAuthoringMaterializationRequestSchema.shape.packet,
  tree: procedureAuthoringMaterializationRequestSchema.shape.tree,
});
export type ProcedureMenuControlProofProposalRequest = z.infer<
  typeof procedureMenuControlProofProposalRequestSchema
>;

const proposalRecordContentSchema = z.strictObject({
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  recordId: z.uuid(),
  replayId: z.uuid(),
  request: procedureMenuControlProofProposalRequestSchema,
  materialization: procedureAuthoringMaterializationResultSchema,
  proposal: guideProposalSchema,
  packetContentSha256: sha256Schema,
  inputTreeContentSha256: sha256Schema,
  outputTreeContentSha256: sha256Schema,
  materializationContentSha256: sha256Schema,
  proposalContentSha256: sha256Schema,
  planContentSha256: sha256Schema,
  interactionCatalogContentSha256: sha256Schema,
  leafId: guideStepIdSchema,
  recipeId: z.literal('blender.mesh.create_uv_sphere.native'),
  actionName: z.literal('blender.mesh.create_uv_sphere'),
  menuTrackContentSha256: sha256Schema,
  proofExecution: menuProofExecutionSchema,
  claims: z.strictObject({
    approval: z.literal('pending'),
    hostExecutionStarted: z.literal(false),
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
  }),
  createdAt: timestampSchema,
});

export const procedureMenuControlProofProposalRecordSchema = proposalRecordContentSchema
  .safeExtend({ integrity: integritySchema })
  .superRefine((record, context) => {
    const leaf = record.materialization.tree.nodes.find((node) => node.id === record.leafId);
    const leaves = record.materialization.tree.nodes.filter((node) => node.kind === 'leaf');
    const coverage = record.materialization.coverage.filter(
      (entry) => entry.leafId === record.leafId,
    );
    const proposalSteps = record.proposal.plan.steps.filter((step) => step.id === record.leafId);
    const executableSteps = record.proposal.plan.steps.filter((step) => step.action !== null);
    const menuTrack = leaf?.kind === 'leaf' ? leaf.menuTracks[0] : undefined;
    const exactAction = {
      adapterId: 'blender',
      name: 'blender.mesh.create_uv_sphere',
      arguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    };
    if (
      record.request.replayId !== record.replayId ||
      record.request.leafId !== record.leafId ||
      record.proposal.targetInstanceId !== record.request.targetInstanceId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Menu-control proof proposal record must bind its exact request identity',
      });
    }
    if (
      leaves.length !== 1 ||
      record.materialization.coverage.length !== 1 ||
      coverage.length !== 1 ||
      proposalSteps.length !== 1 ||
      executableSteps.length !== 1 ||
      leaf?.kind !== 'leaf' ||
      leaf.action === null ||
      computeProtocolCanonicalJsonSha256(leaf.action) !==
        computeProtocolCanonicalJsonSha256(exactAction) ||
      proposalSteps[0]?.action === null ||
      proposalSteps[0]?.action === undefined ||
      computeProtocolCanonicalJsonSha256(proposalSteps[0].action) !==
        computeProtocolCanonicalJsonSha256(exactAction) ||
      coverage[0]?.recipeId !== record.recipeId ||
      coverage[0]?.menu !== 'materialized' ||
      menuTrack?.availability !== 'available' ||
      leaf.menuTracks.length !== 1 ||
      menuTrack.proofExecution === undefined ||
      menuTrack.operations.length !== uvSphereMenuControlProofOperationIds.length ||
      menuTrack.operations.some(
        (operation, index) => operation.id !== uvSphereMenuControlProofOperationIds[index],
      ) ||
      menuTrack.operations.some((operation) =>
        Object.prototype.hasOwnProperty.call(operation.parameters, 'resourceId'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leafId'],
        message: 'Menu-control proof proposal requires the exact callable UV Sphere menu leaf',
      });
    }
    if (
      menuTrack?.availability !== 'available' ||
      menuTrack.proofExecution === undefined ||
      computeProtocolCanonicalJsonSha256(menuTrack.proofExecution) !==
        computeProtocolCanonicalJsonSha256(record.proofExecution) ||
      computeProtocolCanonicalJsonSha256(menuTrack) !== record.menuTrackContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['menuTrackContentSha256'],
        message: 'Menu-control proof proposal must bind the exact proof-authorized menu track',
      });
    }
    if (
      computeProtocolCanonicalJsonSha256(withoutIntegrity(record.request.packet)) !==
        record.request.packet.integrity.contentSha256 ||
      record.request.packet.integrity.contentSha256 !== record.packetContentSha256 ||
      record.packetContentSha256 !== record.materialization.packetContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.request.tree) !== record.inputTreeContentSha256 ||
      record.inputTreeContentSha256 !== record.materialization.inputTreeContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.materialization.tree) !==
        record.outputTreeContentSha256 ||
      record.outputTreeContentSha256 !== record.materialization.outputTreeContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.materialization) !==
        record.materializationContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.proposal) !== record.proposalContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.proposal.plan) !== record.planContentSha256 ||
      computeProtocolCanonicalJsonSha256(record.materialization.compilation.plan) !==
        record.planContentSha256 ||
      record.materialization.catalogBinding.interactionCatalogContentSha256 !==
        record.interactionCatalogContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializationContentSha256'],
        message: 'Menu-control proof proposal must bind all canonical materialization inputs',
      });
    }
    if (
      record.proposal.targetAdapterId !== 'blender' ||
      record.proposal.targetAdapterId !== record.request.tree.adapterId ||
      record.proposal.catalogVersion !==
        record.materialization.catalogBinding.actionCatalogVersion ||
      record.materialization.catalogBinding.adapterId !== record.request.tree.adapterId ||
      record.materialization.catalogBinding.actionCatalogVersion !==
        record.request.tree.actionCatalogVersion ||
      record.materialization.catalogBinding.interactionCatalogVersion !==
        record.request.tree.interactionCatalogVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization', 'catalogBinding'],
        message: 'Menu-control proof target and catalogs must match the exact request',
      });
    }
    if (
      computeProcedureMenuControlProofProposalRecordContentSha256(record) !==
      record.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Menu-control proof proposal record integrity must match its canonical content',
      });
    }
  });
export type ProcedureMenuControlProofProposalRecord = z.infer<
  typeof procedureMenuControlProofProposalRecordSchema
>;

const bindingContentSchema = z.strictObject({
  formatVersion: procedureMenuControlProofFormatVersionSchema,
  bindingId: z.uuid(),
  proposalRecordContentSha256: sha256Schema,
  proofId: z.uuid(),
  requestId: z.uuid(),
  replayId: z.uuid(),
  target: z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() }),
  proposalId: z.uuid(),
  packetContentSha256: sha256Schema,
  inputTreeContentSha256: sha256Schema,
  outputTreeContentSha256: sha256Schema,
  materializationContentSha256: sha256Schema,
  proposalContentSha256: sha256Schema,
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: guideStepIdSchema,
  recipeId: z.literal('blender.mesh.create_uv_sphere.native'),
  actionName: z.literal('blender.mesh.create_uv_sphere'),
  acceptedAction: z.strictObject({
    adapterId: z.literal('blender'),
    name: z.literal('blender.mesh.create_uv_sphere'),
    arguments: exactArgumentsSchema,
  }),
  targetProfile: z.literal('factory_layout_three_object_ui_scale_2'),
  acceptedDecision: z.strictObject({
    decisionId: z.uuid(),
    proposalId: z.uuid(),
    instanceId: z.uuid(),
    adapterId: z.literal('blender'),
    decision: z.literal('accepted'),
    decidedAt: timestampSchema,
  }),
  startState: z.strictObject({
    reportId: z.uuid(),
    sequence: z.number().int().positive(),
    adapterId: z.literal('blender'),
    instanceId: z.uuid(),
    plan: z.strictObject({ id: z.string().min(1), revision: z.number().int().positive() }),
    planContentSha256: sha256Schema,
    executionId: z.uuid(),
    phase: z.literal('running'),
    activeStepId: z.null(),
    completedStepIds: z.tuple([]),
    transition: z.literal('walkthrough_started'),
    stepId: z.null(),
    observationCount: z.literal(0),
    nativeUndoCheckpoint: pristineStartNativeUndoCheckpointSchema,
    occurredAt: timestampSchema,
  }),
  proofScope: z.strictObject({
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
    omittedAcceptedArguments: z.tuple([z.literal('resourceId')]),
  }),
  materialization: z.strictObject({
    actionCatalogVersion: catalogVersionSchema,
    interactionCatalogVersion: catalogVersionSchema,
    interactionCatalogContentSha256: sha256Schema,
    packetContentSha256: sha256Schema,
    inputTreeContentSha256: sha256Schema,
    outputTreeContentSha256: sha256Schema,
    materializationContentSha256: sha256Schema,
    menuTrackContentSha256: sha256Schema,
  }),
  executorId: z.literal('blender.uv_sphere_menu_controls.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: uvSphereMenuControlProofOperationIdsSchema,
  nativeUndoDepth: z.literal(8),
  createdAt: timestampSchema,
});

export const procedureMenuControlProofBindingSchema = bindingContentSchema
  .safeExtend({ integrity: integritySchema })
  .superRefine((binding, context) => {
    const decisionTime = Date.parse(binding.acceptedDecision.decidedAt);
    const startTime = Date.parse(binding.startState.occurredAt);
    const checkpoint = binding.startState.nativeUndoCheckpoint;
    if (
      binding.acceptedDecision.proposalId !== binding.proposalId ||
      binding.acceptedDecision.instanceId !== binding.target.instanceId ||
      binding.startState.instanceId !== binding.target.instanceId ||
      binding.startState.executionId !== binding.executionId ||
      binding.startState.plan.id !== binding.plan.id ||
      binding.startState.plan.revision !== binding.plan.revision ||
      binding.startState.planContentSha256 !== binding.plan.contentSha256 ||
      checkpoint.session.plan.id !== binding.plan.id ||
      checkpoint.session.plan.revision !== binding.plan.revision ||
      checkpoint.session.planContentSha256 !== binding.plan.contentSha256 ||
      checkpoint.session.executionId !== binding.executionId ||
      decisionTime > Date.parse(checkpoint.committedAt) ||
      Date.parse(checkpoint.committedAt) > startTime ||
      startTime > Date.parse(binding.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedDecision'],
        message: 'Menu-control proof binding requires the exact accepted in-host start state',
      });
    }
    if (
      binding.packetContentSha256 !== binding.materialization.packetContentSha256 ||
      binding.inputTreeContentSha256 !== binding.materialization.inputTreeContentSha256 ||
      binding.outputTreeContentSha256 !== binding.materialization.outputTreeContentSha256 ||
      binding.materializationContentSha256 !== binding.materialization.materializationContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'Menu-control proof binding must preserve every accepted proposal hash',
      });
    }
    if (
      computeProcedureMenuControlProofBindingContentSha256(binding) !==
      binding.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Menu-control proof binding integrity must match its canonical content',
      });
    }
  });
export type ProcedureMenuControlProofBinding = z.infer<
  typeof procedureMenuControlProofBindingSchema
>;

export const procedureMenuControlProofProposalResultSchema = z.strictObject({
  status: z.enum(['accepted', 'duplicate']),
  record: procedureMenuControlProofProposalRecordSchema,
});
export type ProcedureMenuControlProofProposalResult = z.infer<
  typeof procedureMenuControlProofProposalResultSchema
>;

function withoutIntegrity(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integrity'));
}

export function computeProcedureMenuControlProofProposalRecordContentSha256(
  value: Record<string, unknown>,
): string {
  return computeProtocolCanonicalJsonSha256(withoutIntegrity(value));
}

export function computeProcedureMenuControlProofBindingContentSha256(
  value: Record<string, unknown>,
): string {
  return computeProtocolCanonicalJsonSha256(withoutIntegrity(value));
}
