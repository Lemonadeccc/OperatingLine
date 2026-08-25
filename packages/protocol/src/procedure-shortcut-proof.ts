import { z } from 'zod';

import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import { subdivisionSurfaceLeafOperationIds } from './companion-leaf-operation.js';
import { guideStepIdSchema } from './guide.js';
import { shortcutProofExecutionSchema } from './interaction-catalog.js';
import {
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
} from './procedure-materialization.js';
import { guideProposalSchema } from './proposal.js';
import { catalogVersionSchema } from './version.js';

export const procedureShortcutProofFormatVersion = '1.0.0' as const;
export const procedureShortcutProofFormatVersionSchema = z.literal(
  procedureShortcutProofFormatVersion,
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });
const shortcutTargetId = 'tutorial.cube' as const;
const shortcutModifierId = 'tutorial.cube.subdivision_surface' as const;
const shortcutModifierName = 'OperatingLine.Cube.SubdivisionSurface' as const;
const subdivisionSurfaceRecipeTitle = 'Add a bounded Subdivision Surface modifier' as const;
const meshEditSubdivideRecipeTitle =
  'Subdivide an owned mesh through a bounded Edit Mode operation' as const;
const integritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: sha256Schema,
});

export const procedureShortcutProofProposalRequestSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  replayId: z.uuid(),
  targetInstanceId: z.uuid(),
  leafId: guideStepIdSchema,
  replayMode: z.literal('native_shortcut_proof'),
  packet: procedureAuthoringMaterializationRequestSchema.shape.packet,
  tree: procedureAuthoringMaterializationRequestSchema.shape.tree,
});
export type ProcedureShortcutProofProposalRequest = z.infer<
  typeof procedureShortcutProofProposalRequestSchema
>;

const proposalRecordCommonShape = {
  formatVersion: procedureShortcutProofFormatVersionSchema,
  recordId: z.uuid(),
  replayId: z.uuid(),
  request: procedureShortcutProofProposalRequestSchema,
  materialization: procedureAuthoringMaterializationResultSchema,
  proposal: guideProposalSchema,
  planContentSha256: sha256Schema,
  leafId: guideStepIdSchema,
  shortcutTrackContentSha256: sha256Schema,
  claims: z.strictObject({
    approval: z.literal('pending'),
    hostExecutionStarted: z.literal(false),
    managedActionResult: z.literal('pending'),
    managedIdentityVerified: z.literal(false),
  }),
  createdAt: timestampSchema,
} as const;

const proposalRecordContentSchema = z.discriminatedUnion('recipeId', [
  z.strictObject({
    ...proposalRecordCommonShape,
    recipeId: z.literal('blender.modifier.add_subdivision_surface.semantic'),
    actionName: z.literal('blender.modifier.add_subdivision_surface'),
    proofExecution: shortcutProofExecutionSchema.options[0],
    integrity: integritySchema,
  }),
  z.strictObject({
    ...proposalRecordCommonShape,
    recipeId: z.literal('blender.mesh.edit_subdivide.semantic'),
    actionName: z.literal('blender.mesh.edit_subdivide'),
    proofExecution: shortcutProofExecutionSchema.options[1],
    integrity: integritySchema,
  }),
]);

export const procedureShortcutProofProposalRecordSchema = proposalRecordContentSchema.superRefine(
  (record, context) => {
    if (
      record.request.replayId !== record.replayId ||
      record.request.leafId !== record.leafId ||
      record.proposal.targetInstanceId !== record.request.targetInstanceId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Shortcut proof proposal record must bind its exact request identity',
      });
    }
    const leaf = record.materialization.tree.nodes.find((node) => node.id === record.leafId);
    const leaves = record.materialization.tree.nodes.filter((node) => node.kind === 'leaf');
    const coverages = record.materialization.coverage.filter(
      (entry) => entry.leafId === record.leafId,
    );
    const proposalSteps = record.proposal.plan.steps.filter((step) => step.id === record.leafId);
    const executableProposalSteps = record.proposal.plan.steps.filter(
      (step) => step.action !== null,
    );
    const coverage = coverages[0];
    const proposalStep = proposalSteps[0];
    const shortcutTrack = leaf?.kind === 'leaf' ? leaf.shortcutTracks[0] : undefined;
    const objectAnchors =
      leaf?.kind === 'leaf' ? leaf.anchors.filter((anchor) => anchor.kind === 'object') : [];
    const operatorAnchors =
      leaf?.kind === 'leaf' ? leaf.anchors.filter((anchor) => anchor.kind === 'operator') : [];
    const isSubdivisionSurface =
      record.recipeId === 'blender.modifier.add_subdivision_surface.semantic';
    const expectedRecipeTitle = isSubdivisionSurface
      ? subdivisionSurfaceRecipeTitle
      : meshEditSubdivideRecipeTitle;
    const actionArguments =
      leaf?.kind === 'leaf' && leaf.action !== null ? leaf.action.arguments : undefined;
    const orderedSemanticOperations =
      leaf?.kind === 'leaf'
        ? [...leaf.semanticOperations].sort((left, right) => left.order - right.order)
        : [];
    const semanticRefs = orderedSemanticOperations.map((operation) => operation.id);
    const evidenceRefs = [
      ...new Set(orderedSemanticOperations.flatMap((operation) => operation.evidenceRefs)),
    ];
    const expectedActionLevelMcpTrack =
      leaf?.kind === 'leaf' && leaf.action !== null
        ? {
            id: `${record.recipeId}.mcp`,
            availability: 'available',
            title: `${expectedRecipeTitle} action-level MCP projection`,
            preconditions: [],
            modality: 'mcp',
            operations: [
              {
                id: `${record.recipeId}.mcp.execute`,
                order: 1,
                semanticRefs,
                description: `Execute ${leaf.action.name} as the accepted replay next step`,
                evidenceRefs,
                serverName: 'operating-line',
                toolName: 'operatingline.blender.action.execute',
                arguments: {
                  formatVersion: '1.0.0',
                  requestId: '$runtime.requestId',
                  replayId: '$runtime.replayId',
                  expectedState: '$runtime.expectedState',
                },
                argumentSource: 'accepted_leaf_action',
                actionArguments: leaf.action.arguments,
                resultBinding: `${leaf.id}.companion_state_report`,
              },
            ],
          }
        : undefined;
    const subdivisionSurfaceOperationParameters =
      actionArguments === undefined
        ? undefined
        : [
            {
              targetId: actionArguments['targetId'],
              modifierId: actionArguments['modifierId'],
            },
            {},
            {},
            {
              modifierName: actionArguments['modifierName'],
              viewportLevel: actionArguments['viewportLevel'],
            },
          ];
    const expectedSubdivisionSurfaceOperationMcpTrack =
      isSubdivisionSurface &&
      leaf?.kind === 'leaf' &&
      subdivisionSurfaceOperationParameters !== undefined
        ? {
            id: `${record.recipeId}.mcp`,
            availability: 'available',
            title: `${expectedRecipeTitle} operation-level MCP projection`,
            preconditions: [],
            modality: 'mcp',
            operations: subdivisionSurfaceLeafOperationIds.map((sourceOperationId, index) => ({
              id: `${record.recipeId}.mcp.${String(index + 1).padStart(2, '0')}`,
              order: index + 1,
              semanticRefs,
              description: `Execute ${sourceOperationId} as the accepted replay next operation`,
              evidenceRefs,
              serverName: 'operating-line',
              toolName: 'operatingline.blender.modifier.subdivision-surface.execute-next',
              arguments: {
                formatVersion: '1.0.0',
                requestId: '$runtime.requestId',
                replayId: '$runtime.replayId',
                expectedState: '$runtime.expectedState',
              },
              sourceOperationId,
              operationParameters: subdivisionSurfaceOperationParameters[index],
              resultBinding: `${leaf.id}.${sourceOperationId}.companion_leaf_operation_progress`,
            })),
          }
        : undefined;
    const expectedUnavailableMcpTrack = {
      id: `${record.recipeId}.mcp`,
      availability: 'unavailable',
      title: expectedRecipeTitle,
      reason: 'No approved action-level MCP tool is available.',
      modality: 'mcp',
    };
    const mcpTrack = leaf?.kind === 'leaf' ? leaf.mcpTracks[0] : undefined;
    const exactActionLevelMcpTrack =
      coverage?.mcp === 'materialized' &&
      mcpTrack !== undefined &&
      expectedActionLevelMcpTrack !== undefined &&
      hashCanonical(mcpTrack) === hashCanonical(expectedActionLevelMcpTrack);
    const exactSubdivisionSurfaceOperationMcpTrack =
      coverage?.mcp === 'materialized' &&
      mcpTrack !== undefined &&
      expectedSubdivisionSurfaceOperationMcpTrack !== undefined &&
      hashCanonical(mcpTrack) === hashCanonical(expectedSubdivisionSurfaceOperationMcpTrack);
    const exactUnavailableMcpTrack =
      isSubdivisionSurface &&
      coverage?.mcp === 'unavailable' &&
      mcpTrack !== undefined &&
      hashCanonical(mcpTrack) === hashCanonical(expectedUnavailableMcpTrack);
    const exactMcpTrack =
      exactActionLevelMcpTrack ||
      exactSubdivisionSurfaceOperationMcpTrack ||
      exactUnavailableMcpTrack;
    const actionProfileMatches = isSubdivisionSurface
      ? actionArguments?.['targetId'] === shortcutTargetId &&
        actionArguments['modifierId'] === shortcutModifierId &&
        actionArguments['modifierName'] === shortcutModifierName &&
        objectAnchors.length === 1 &&
        objectAnchors[0]?.objectName === 'Cube' &&
        operatorAnchors.length === 0
      : actionArguments?.['targetId'] === shortcutTargetId &&
        typeof actionArguments['resultMeshId'] === 'string' &&
        typeof actionArguments['resultMeshName'] === 'string' &&
        Number.isInteger(actionArguments['cuts']) &&
        typeof actionArguments['cuts'] === 'number' &&
        actionArguments['cuts'] >= 1 &&
        actionArguments['cuts'] <= 8 &&
        typeof actionArguments['smooth'] === 'number' &&
        actionArguments['smooth'] >= 0 &&
        actionArguments['smooth'] <= 1 &&
        objectAnchors.length === 1 &&
        objectAnchors[0]?.objectName === 'Cube' &&
        operatorAnchors.length === 1 &&
        operatorAnchors[0]?.operatorId === 'mesh.subdivide';
    if (
      leaves.length !== 1 ||
      record.materialization.coverage.length !== 1 ||
      executableProposalSteps.length !== 1 ||
      coverages.length !== 1 ||
      proposalSteps.length !== 1 ||
      leaf?.kind !== 'leaf' ||
      leaf.action === null ||
      !actionProfileMatches ||
      coverage?.recipeId !== record.recipeId ||
      coverage.menu !== 'unavailable' ||
      coverage.shortcut !== 'materialized' ||
      proposalStep?.action === null ||
      proposalStep?.action === undefined ||
      hashCanonical(leaf.action) !== hashCanonical(proposalStep.action) ||
      leaf.action.name !== record.actionName ||
      shortcutTrack?.availability !== 'available' ||
      leaf.shortcutTracks.length !== 1 ||
      leaf.menuTracks.length !== 1 ||
      leaf.menuTracks[0]?.availability !== 'unavailable' ||
      leaf.mcpTracks.length !== 1 ||
      !exactMcpTrack
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leafId'],
        message: 'Shortcut proof proposal record requires the exact materialized shortcut leaf',
      });
    }
    if (
      record.request.packet.integrity.contentSha256 !==
        record.materialization.packetContentSha256 ||
      hashCanonical(record.request.tree) !== record.materialization.inputTreeContentSha256 ||
      hashCanonical(record.materialization.tree) !==
        record.materialization.outputTreeContentSha256 ||
      hashCanonical(record.proposal.plan) !== record.planContentSha256 ||
      hashCanonical(record.proposal.plan) !== hashCanonical(record.materialization.compilation.plan)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planContentSha256'],
        message: 'Shortcut proof proposal plan hash must match the full proposal',
      });
    }
    if (
      record.proposal.targetAdapterId !== record.request.tree.adapterId ||
      record.proposal.targetInstanceId !== record.request.targetInstanceId ||
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
        message:
          'Shortcut proof proposal target and catalogs must match the exact request and materialization',
      });
    }
    if (
      shortcutTrack?.availability !== 'available' ||
      shortcutTrack.proofExecution === undefined ||
      hashCanonical(shortcutTrack.proofExecution) !== hashCanonical(record.proofExecution) ||
      hashCanonical(shortcutTrack) !== record.shortcutTrackContentSha256 ||
      shortcutTrack.operations.length !== record.proofExecution.operationIds.length ||
      shortcutTrack.operations.some(
        (operation, index) => operation.id !== record.proofExecution.operationIds[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['shortcutTrackContentSha256'],
        message: 'Shortcut proof proposal must bind the exact proof-authorized shortcut track',
      });
    }
    if (
      computeProcedureShortcutProofProposalRecordContentSha256(record) !==
      record.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Shortcut proof proposal record integrity must match its canonical content',
      });
    }
  },
);
export type ProcedureShortcutProofProposalRecord = z.infer<
  typeof procedureShortcutProofProposalRecordSchema
>;

export const subdivisionSurfaceShortcutProofOperationIds = [
  'shortcut.add_subdivision_surface_level_one',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_viewport_level',
  'shortcut.close_adjust_last_operation',
] as const;

export const subdivisionSurfaceShortcutProofOperationIdsSchema = z.tuple([
  z.literal(subdivisionSurfaceShortcutProofOperationIds[0]),
  z.literal(subdivisionSurfaceShortcutProofOperationIds[1]),
  z.literal(subdivisionSurfaceShortcutProofOperationIds[2]),
  z.literal(subdivisionSurfaceShortcutProofOperationIds[3]),
]);

export const meshEditSubdivideShortcutProofOperationIds = [
  'shortcut.enter_edit_mode',
  'shortcut.select_all_mesh_elements',
  'shortcut.search_subdivide',
  'shortcut.execute_subdivide',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_number_of_cuts',
  'shortcut.set_smoothness',
  'shortcut.close_adjust_last_operation',
  'shortcut.return_to_object_mode',
] as const;

export const meshEditSubdivideShortcutProofOperationIdsSchema = z.tuple([
  z.literal(meshEditSubdivideShortcutProofOperationIds[0]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[1]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[2]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[3]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[4]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[5]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[6]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[7]),
  z.literal(meshEditSubdivideShortcutProofOperationIds[8]),
]);

const subdivisionSurfaceBindingContentSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  bindingId: z.uuid(),
  proposalRecordContentSha256: sha256Schema,
  proofId: z.uuid(),
  requestId: z.uuid(),
  replayId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: guideStepIdSchema,
  recipeId: z.literal('blender.modifier.add_subdivision_surface.semantic'),
  actionName: z.literal('blender.modifier.add_subdivision_surface'),
  acceptedAction: z.strictObject({
    adapterId: z.literal('blender'),
    name: z.literal('blender.modifier.add_subdivision_surface'),
    arguments: z.strictObject({
      targetId: z.literal(shortcutTargetId),
      modifierId: z.literal(shortcutModifierId),
      modifierName: z.literal(shortcutModifierName),
      viewportLevel: z.number().int().min(1).max(3),
    }),
  }),
  targetProfile: z.literal('factory_cube_8_12_6'),
  acceptedDecision: z.strictObject({
    decisionId: z.uuid(),
    proposalId: z.uuid(),
    instanceId: z.uuid(),
    adapterId: z.literal('blender'),
    decision: z.literal('accepted'),
    decidedAt: timestampSchema,
  }),
  proofScope: z.strictObject({
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
    omittedAcceptedArguments: z.tuple([z.literal('modifierId'), z.literal('modifierName')]),
  }),
  materialization: z.strictObject({
    actionCatalogVersion: catalogVersionSchema,
    interactionCatalogVersion: catalogVersionSchema,
    interactionCatalogContentSha256: sha256Schema,
    shortcutTrackContentSha256: sha256Schema,
  }),
  executorId: z.literal('blender.subdivision_surface_f9.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: subdivisionSurfaceShortcutProofOperationIdsSchema,
  startState: expectedStateSchema,
  createdAt: timestampSchema,
});

const meshEditSubdivideBindingContentSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  bindingId: z.uuid(),
  proposalRecordContentSha256: sha256Schema,
  proofId: z.uuid(),
  requestId: z.uuid(),
  replayId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
  }),
  executionId: z.uuid(),
  leafId: guideStepIdSchema,
  recipeId: z.literal('blender.mesh.edit_subdivide.semantic'),
  actionName: z.literal('blender.mesh.edit_subdivide'),
  acceptedAction: z.strictObject({
    adapterId: z.literal('blender'),
    name: z.literal('blender.mesh.edit_subdivide'),
    arguments: z.strictObject({
      targetId: z.literal(shortcutTargetId),
      resultMeshId: z.string().min(1),
      resultMeshName: z.string().min(1),
      cuts: z.number().int().min(1).max(8),
      smooth: z.number().min(0).max(1),
    }),
  }),
  targetProfile: z.literal('factory_cube_single_user_mesh_8_12_6'),
  acceptedDecision: z.strictObject({
    decisionId: z.uuid(),
    proposalId: z.uuid(),
    instanceId: z.uuid(),
    adapterId: z.literal('blender'),
    decision: z.literal('accepted'),
    decidedAt: timestampSchema,
  }),
  proofScope: z.strictObject({
    managedActionResult: z.literal('not_executed'),
    managedIdentityVerified: z.literal(false),
    managedReceiptCreated: z.literal(false),
    managedReplacementMeshCreated: z.literal(false),
    nativeMutationKind: z.literal('in_place_edit_mesh_subdivide'),
    omittedAcceptedArguments: z.tuple([
      z.literal('targetId'),
      z.literal('resultMeshId'),
      z.literal('resultMeshName'),
    ]),
  }),
  materialization: z.strictObject({
    actionCatalogVersion: catalogVersionSchema,
    interactionCatalogVersion: catalogVersionSchema,
    interactionCatalogContentSha256: sha256Schema,
    shortcutTrackContentSha256: sha256Schema,
  }),
  executorId: z.literal('blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'),
  executionBoundary: z.literal('blender_window_event_simulate'),
  authorization: z.literal('accepted_replay_next_step'),
  transport: z.literal('event_simulate'),
  operationIds: meshEditSubdivideShortcutProofOperationIdsSchema,
  nativeUndoDepth: z.literal(4),
  nativeRedoDepth: z.literal(4),
  startState: expectedStateSchema,
  createdAt: timestampSchema,
});

export const procedureShortcutProofBindingSchema = z
  .discriminatedUnion('executorId', [
    subdivisionSurfaceBindingContentSchema.safeExtend({ integrity: integritySchema }),
    meshEditSubdivideBindingContentSchema.safeExtend({ integrity: integritySchema }),
  ])
  .superRefine((binding, context) => {
    if (
      binding.acceptedDecision.proposalId !== binding.proposalId ||
      binding.acceptedDecision.instanceId !== binding.target.instanceId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedDecision'],
        message: 'Shortcut proof binding requires the exact accepted proposal decision',
      });
    }
    if (
      computeProcedureShortcutProofBindingContentSha256(binding) !== binding.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Shortcut proof binding integrity must match its canonical content',
      });
    }
  });
export type ProcedureShortcutProofBinding = z.infer<typeof procedureShortcutProofBindingSchema>;

export const procedureShortcutProofProposalResultSchema = z.strictObject({
  status: z.enum(['accepted', 'duplicate']),
  record: procedureShortcutProofProposalRecordSchema,
});
export type ProcedureShortcutProofProposalResult = z.infer<
  typeof procedureShortcutProofProposalResultSchema
>;

const operationReceiptCommonShape = {
  receiptId: z.uuid(),
  proofId: z.uuid(),
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  bindingContentSha256: sha256Schema,
  order: z.number().int().positive(),
  previousReceiptContentSha256: sha256Schema.nullable(),
  outcome: z.literal('succeeded'),
  occurredAt: timestampSchema,
  contentSha256: sha256Schema,
} as const;
const shortcutContextSchema = z.strictObject({
  windowId: z.string().min(1),
  areaType: z.literal('VIEW_3D'),
  regionType: z.literal('WINDOW'),
  mode: z.literal('OBJECT'),
});
const eventEvidence = <Type extends string, Value extends string>(
  type: Type,
  value: Value,
  ctrl = false,
  unicode?: '1' | '2' | '3',
  pointRole: 'viewport_center' | 'level_control' = 'viewport_center',
) =>
  z.strictObject({
    type: z.literal(type),
    value: z.literal(value),
    ctrl: z.literal(ctrl),
    shift: z.literal(false),
    point: z.strictObject({ x: z.number().int(), y: z.number().int(), role: z.literal(pointRole) }),
    ...(unicode === undefined ? {} : { unicode: z.literal(unicode) }),
  });
const keyReceipt = (
  operationId:
    | (typeof subdivisionSurfaceShortcutProofOperationIds)[0]
    | (typeof subdivisionSurfaceShortcutProofOperationIds)[1]
    | (typeof subdivisionSurfaceShortcutProofOperationIds)[3],
  events: z.ZodType,
) =>
  z.strictObject({
    ...operationReceiptCommonShape,
    operationId: z.literal(operationId),
    kind: z.literal('key_input'),
    context: shortcutContextSchema,
    eventEvidence: events,
    operatorStackBeforeSha256: sha256Schema,
    operatorStackAfterSha256: sha256Schema,
    ...(operationId === subdivisionSurfaceShortcutProofOperationIds[1]
      ? {
          sourceOperationId: z.literal(subdivisionSurfaceShortcutProofOperationIds[0]),
          sourceOperatorId: z.literal('object.subdivision_set'),
        }
      : {}),
    ...(operationId === subdivisionSurfaceShortcutProofOperationIds[3]
      ? {
          surfaceOperationId: z.literal(subdivisionSurfaceShortcutProofOperationIds[1]),
        }
      : {}),
  });
export const subdivisionSurfaceShortcutProofOperationReceiptSchemas = [
  keyReceipt(
    subdivisionSurfaceShortcutProofOperationIds[0],
    z.tuple([eventEvidence('ONE', 'PRESS', true), eventEvidence('ONE', 'RELEASE', true)]),
  ),
  keyReceipt(
    subdivisionSurfaceShortcutProofOperationIds[1],
    z.tuple([eventEvidence('F9', 'PRESS'), eventEvidence('F9', 'RELEASE')]),
  ),
  z.strictObject({
    ...operationReceiptCommonShape,
    operationId: z.literal(subdivisionSurfaceShortcutProofOperationIds[2]),
    kind: z.literal('operator_property_update'),
    surfaceOperationId: z.literal(subdivisionSurfaceShortcutProofOperationIds[1]),
    surfaceOperatorId: z.literal('object.subdivision_set'),
    controlId: z.literal('object.subdivision_set.level'),
    oldValue: z.literal(1),
    newValue: z.number().int().min(1).max(3),
    eventEvidence: z.tuple([
      eventEvidence('MOUSEMOVE', 'NOTHING', false, undefined, 'level_control'),
      eventEvidence('LEFTMOUSE', 'PRESS', false, undefined, 'level_control'),
      eventEvidence('LEFTMOUSE', 'RELEASE', false, undefined, 'level_control'),
      eventEvidence('LEFTMOUSE', 'PRESS', false, undefined, 'level_control'),
      eventEvidence('LEFTMOUSE', 'RELEASE', false, undefined, 'level_control'),
      eventEvidence('A', 'PRESS', true),
      z.discriminatedUnion('type', [
        eventEvidence('ONE', 'PRESS', false, '1'),
        eventEvidence('TWO', 'PRESS', false, '2'),
        eventEvidence('THREE', 'PRESS', false, '3'),
      ]),
      eventEvidence('RET', 'PRESS'),
      eventEvidence('RET', 'RELEASE'),
    ]),
  }),
  keyReceipt(
    subdivisionSurfaceShortcutProofOperationIds[3],
    z.tuple([eventEvidence('RET', 'PRESS'), eventEvidence('RET', 'RELEASE')]),
  ),
] as const;

const editShortcutContextSchema = (mode: 'OBJECT' | 'EDIT_MESH') =>
  z.strictObject({
    windowId: z.string().min(1),
    areaType: z.literal('VIEW_3D'),
    regionType: z.literal('WINDOW'),
    mode: z.literal(mode),
  });
const editEventEvidence = (
  type: string,
  value: 'PRESS' | 'RELEASE' | 'NOTHING' = 'PRESS',
  pointRole: 'viewport_center' | 'number_cuts_control' | 'smoothness_control' = 'viewport_center',
  ctrl = false,
  unicode?: string,
) =>
  z.strictObject({
    type: z.literal(type),
    value: z.literal(value),
    ctrl: z.literal(ctrl),
    shift: z.literal(false),
    point: z.strictObject({
      x: z.number().int(),
      y: z.number().int(),
      role: z.literal(pointRole),
    }),
    ...(unicode === undefined ? {} : { unicode: z.literal(unicode) }),
  });
const editKeyReceipt = <OperationId extends string>(
  operationId: OperationId,
  mode: 'OBJECT' | 'EDIT_MESH',
  events: z.ZodType,
  extraShape: z.ZodRawShape = {},
) =>
  z.strictObject({
    ...operationReceiptCommonShape,
    operationId: z.literal(operationId),
    kind: z.literal('key_input'),
    context: editShortcutContextSchema(mode),
    eventEvidence: events,
    operatorStackBeforeSha256: sha256Schema,
    operatorStackAfterSha256: sha256Schema,
    ...extraShape,
  });
const editPropertyReceipt = (
  operationId:
    | (typeof meshEditSubdivideShortcutProofOperationIds)[5]
    | (typeof meshEditSubdivideShortcutProofOperationIds)[6],
  controlId: 'mesh.subdivide.number_cuts' | 'mesh.subdivide.smoothness',
  pointRole: 'number_cuts_control' | 'smoothness_control',
  valueSchema: z.ZodType,
  enteredTextSchema: z.ZodType<string>,
) =>
  z
    .strictObject({
      ...operationReceiptCommonShape,
      operationId: z.literal(operationId),
      kind: z.literal('operator_property_update'),
      context: editShortcutContextSchema('EDIT_MESH'),
      surfaceOperationId: z.literal(meshEditSubdivideShortcutProofOperationIds[4]),
      surfaceOperatorId: z.literal('mesh.subdivide'),
      controlId: z.literal(controlId),
      newValue: valueSchema,
      enteredText: enteredTextSchema,
      activationEventEvidence: z.tuple([
        editEventEvidence('MOUSEMOVE', 'NOTHING', pointRole),
        editEventEvidence('LEFTMOUSE', 'PRESS', pointRole),
        editEventEvidence('LEFTMOUSE', 'RELEASE', pointRole),
        editEventEvidence('LEFTMOUSE', 'PRESS', pointRole),
        editEventEvidence('LEFTMOUSE', 'RELEASE', pointRole),
      ]),
      selectAllEventEvidence: z.tuple([editEventEvidence('A', 'PRESS', 'viewport_center', true)]),
      textEventEvidence: z
        .array(
          z.strictObject({
            type: z.enum([
              'ZERO',
              'ONE',
              'TWO',
              'THREE',
              'FOUR',
              'FIVE',
              'SIX',
              'SEVEN',
              'EIGHT',
              'NINE',
              'PERIOD',
            ]),
            value: z.literal('PRESS'),
            ctrl: z.literal(false),
            shift: z.literal(false),
            unicode: z.string().regex(/^[0-9.]$/),
            point: z.strictObject({
              x: z.number().int(),
              y: z.number().int(),
              role: z.literal('viewport_center'),
            }),
          }),
        )
        .min(1),
      confirmEventEvidence: z.tuple([
        editEventEvidence('RET'),
        editEventEvidence('RET', 'RELEASE'),
      ]),
    })
    .superRefine((receipt, context) => {
      const typedText = receipt.textEventEvidence.map((event) => event.unicode).join('');
      if (
        typedText !== receipt.enteredText ||
        Number(receipt.enteredText) !== receipt.newValue ||
        receipt.enteredText !== String(receipt.newValue)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['textEventEvidence'],
          message: 'Edit Subdivide property receipt must prove the canonical entered value text',
        });
      }
    });

export const meshEditSubdivideShortcutProofOperationReceiptSchemas = [
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[0],
    'OBJECT',
    z.tuple([editEventEvidence('TAB'), editEventEvidence('TAB', 'RELEASE')]),
    { modeBefore: z.literal('OBJECT'), modeAfter: z.literal('EDIT_MESH') },
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[1],
    'EDIT_MESH',
    z.tuple([editEventEvidence('A'), editEventEvidence('A', 'RELEASE')]),
    { allVisibleMeshElementsSelected: z.literal(true) },
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[2],
    'EDIT_MESH',
    z.tuple([editEventEvidence('F3'), editEventEvidence('F3', 'RELEASE')]),
    {
      query: z.literal('subdivide'),
      selectedOperatorId: z.literal('mesh.subdivide'),
      queryEventEvidence: z.tuple([
        editEventEvidence('S', 'PRESS', 'viewport_center', false, 's'),
        editEventEvidence('U', 'PRESS', 'viewport_center', false, 'u'),
        editEventEvidence('B', 'PRESS', 'viewport_center', false, 'b'),
        editEventEvidence('D', 'PRESS', 'viewport_center', false, 'd'),
        editEventEvidence('I', 'PRESS', 'viewport_center', false, 'i'),
        editEventEvidence('V', 'PRESS', 'viewport_center', false, 'v'),
        editEventEvidence('I', 'PRESS', 'viewport_center', false, 'i'),
        editEventEvidence('D', 'PRESS', 'viewport_center', false, 'd'),
        editEventEvidence('E', 'PRESS', 'viewport_center', false, 'e'),
      ]),
    },
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[3],
    'EDIT_MESH',
    z.tuple([editEventEvidence('RET'), editEventEvidence('RET', 'RELEASE')]),
    { executedOperatorId: z.literal('mesh.subdivide') },
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[4],
    'EDIT_MESH',
    z.tuple([editEventEvidence('F9'), editEventEvidence('F9', 'RELEASE')]),
    {
      sourceOperationId: z.literal(meshEditSubdivideShortcutProofOperationIds[3]),
      sourceOperatorId: z.literal('mesh.subdivide'),
    },
  ),
  editPropertyReceipt(
    meshEditSubdivideShortcutProofOperationIds[5],
    'mesh.subdivide.number_cuts',
    'number_cuts_control',
    z.number().int().min(1).max(8),
    z.string().regex(/^[1-8]$/),
  ),
  editPropertyReceipt(
    meshEditSubdivideShortcutProofOperationIds[6],
    'mesh.subdivide.smoothness',
    'smoothness_control',
    z.number().min(0).max(1),
    z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/),
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[7],
    'EDIT_MESH',
    z.tuple([editEventEvidence('RET'), editEventEvidence('RET', 'RELEASE')]),
    { surfaceOperationId: z.literal(meshEditSubdivideShortcutProofOperationIds[4]) },
  ),
  editKeyReceipt(
    meshEditSubdivideShortcutProofOperationIds[8],
    'EDIT_MESH',
    z.tuple([editEventEvidence('TAB'), editEventEvidence('TAB', 'RELEASE')]),
    { modeBefore: z.literal('EDIT_MESH'), modeAfter: z.literal('OBJECT') },
  ),
] as const;

export const procedureShortcutProofOperationReceiptSchema = z.union([
  ...subdivisionSurfaceShortcutProofOperationReceiptSchemas,
  ...meshEditSubdivideShortcutProofOperationReceiptSchemas,
]);
export type ProcedureShortcutProofOperationReceipt = z.infer<
  typeof procedureShortcutProofOperationReceiptSchema
>;

const subdivisionSurfaceNativeUndoCheckpointSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  evidenceClass: z.literal('companion_reported_shortcut_proof_native_undo_checkpoint'),
  checkpointId: z.uuid(),
  proofId: z.uuid(),
  replayId: z.uuid(),
  previousCheckpointId: z.uuid().nullable(),
  operation: z.literal('shortcut_proof'),
  undoLockId: z.uuid(),
  targetId: z.string().min(1),
  marker: z.strictObject({
    key: z.literal('_operating_line_shortcut_proof_history_v1'),
    matched: z.literal(true),
  }),
  journal: z.strictObject({
    entryPresent: z.literal(true),
    baselineSnapshotPresent: z.literal(true),
    finalSnapshotPresent: z.literal(true),
    undoRedoRoundTripVerified: z.literal(true),
    mutationLeaseHeld: z.literal(true),
  }),
  baselineState: z.strictObject({
    targetId: z.string().min(1),
    modifierCount: z.literal(0),
    activeObjectMode: z.literal('OBJECT'),
    selectedObjectCount: z.literal(1),
  }),
  finalState: z.strictObject({
    targetId: z.string().min(1),
    modifierType: z.literal('SUBSURF'),
    modifierCount: z.literal(1),
    viewportLevel: z.number().int().min(1).max(3),
  }),
  baselineSceneFingerprintSha256: sha256Schema,
  finalSceneFingerprintSha256: sha256Schema,
  receiptChainRootSha256: sha256Schema,
  receiptChainHeadSha256: sha256Schema,
  strongObservationContentSha256: sha256Schema,
  committedAt: timestampSchema,
});

const meshEditSubdivideNativeUndoCheckpointSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  evidenceClass: z.literal('companion_reported_shortcut_proof_native_undo_checkpoint'),
  checkpointId: z.uuid(),
  proofId: z.uuid(),
  replayId: z.uuid(),
  previousCheckpointId: z.uuid().nullable(),
  operation: z.literal('shortcut_proof'),
  undoLockId: z.uuid(),
  targetId: z.string().min(1),
  executorId: z.literal('blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'),
  nativeMutationKind: z.literal('in_place_edit_mesh_subdivide'),
  nativeUndoDepth: z.literal(4),
  nativeRedoDepth: z.literal(4),
  marker: z.strictObject({
    key: z.literal('_operating_line_shortcut_proof_history_v2'),
    matched: z.literal(true),
  }),
  journal: z.strictObject({
    entryPresent: z.literal(true),
    baselineSnapshotPresent: z.literal(true),
    finalSnapshotPresent: z.literal(true),
    undoRedoRoundTripVerified: z.literal(true),
    mutationLeaseHeld: z.literal(true),
  }),
  baselineState: z.strictObject({
    targetId: z.string().min(1),
    objectName: z.literal('Cube'),
    objectPointer: z.number().int().positive(),
    meshPointer: z.number().int().positive(),
    meshUsers: z.literal(1),
    meshDatablockCount: z.literal(1),
    modifierCount: z.literal(0),
    shapeKeyCount: z.literal(0),
    activeObjectMode: z.literal('OBJECT'),
    selectedObjectCount: z.literal(1),
    topologySha256: sha256Schema,
    geometrySha256: sha256Schema,
  }),
  finalState: z.strictObject({
    targetId: z.string().min(1),
    objectName: z.literal('Cube'),
    objectPointer: z.number().int().positive(),
    meshPointer: z.number().int().positive(),
    meshUsers: z.literal(1),
    meshDatablockCount: z.literal(1),
    modifierCount: z.literal(0),
    shapeKeyCount: z.literal(0),
    activeObjectMode: z.literal('OBJECT'),
    selectedObjectCount: z.literal(1),
    cuts: z.number().int().min(1).max(8),
    smooth: z.number().min(0).max(1),
    topologySha256: sha256Schema,
    geometrySha256: sha256Schema,
  }),
  baselineSceneFingerprintSha256: sha256Schema,
  finalSceneFingerprintSha256: sha256Schema,
  receiptChainRootSha256: sha256Schema,
  receiptChainHeadSha256: sha256Schema,
  strongObservationContentSha256: sha256Schema,
  committedAt: timestampSchema,
});

export const procedureShortcutProofNativeUndoCheckpointSchema = z.union([
  subdivisionSurfaceNativeUndoCheckpointSchema,
  meshEditSubdivideNativeUndoCheckpointSchema,
]);

export const subdivisionSurfaceShortcutProofFailureCheckpointSchema = z
  .strictObject({
    formatVersion: procedureShortcutProofFormatVersionSchema,
    evidenceClass: z.literal('companion_reported_shortcut_proof_failure_checkpoint'),
    checkpointId: z.uuid(),
    previousCheckpointId: z.uuid().nullable(),
    operation: z.literal('shortcut_proof_failure'),
    undoLockId: z.uuid(),
    proofId: z.uuid(),
    replayId: z.uuid(),
    targetId: z.string().min(1),
    marker: z.strictObject({
      key: z.literal('_operating_line_shortcut_proof_history_v1'),
      matched: z.literal(true),
    }),
    journal: z.strictObject({
      entryPresent: z.literal(true),
      baselineSnapshotPresent: z.literal(true),
      currentSnapshotPresent: z.literal(true),
      mutationLeaseHeld: z.literal(true),
    }),
    baselineState: z.strictObject({
      targetId: z.string().min(1),
      sceneFingerprintSha256: sha256Schema,
      modifierCount: z.literal(0),
    }),
    currentState: z.strictObject({
      targetId: z.string().min(1),
      sceneFingerprintSha256: sha256Schema,
      modifierCount: z.number().int().min(0),
    }),
    receiptPrefixRootSha256: sha256Schema.nullable(),
    receiptPrefixHeadSha256: sha256Schema.nullable(),
    lastCompletedOperationId: z.enum(subdivisionSurfaceShortcutProofOperationIds).nullable(),
    committedAt: timestampSchema,
  })
  .superRefine((checkpoint, context) => {
    const hasReceipts = checkpoint.lastCompletedOperationId !== null;
    if (
      hasReceipts !== (checkpoint.receiptPrefixRootSha256 !== null) ||
      hasReceipts !== (checkpoint.receiptPrefixHeadSha256 !== null) ||
      checkpoint.baselineState.targetId !== checkpoint.targetId ||
      checkpoint.currentState.targetId !== checkpoint.targetId
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Shortcut failure checkpoint must bind target state and nullable receipt-prefix evidence exactly',
      });
    }
  });

export const meshEditSubdivideShortcutProofFailureCheckpointSchema = z
  .strictObject({
    formatVersion: procedureShortcutProofFormatVersionSchema,
    evidenceClass: z.literal('companion_reported_shortcut_proof_failure_checkpoint'),
    checkpointId: z.uuid(),
    previousCheckpointId: z.uuid().nullable(),
    operation: z.literal('shortcut_proof_failure'),
    undoLockId: z.uuid(),
    proofId: z.uuid(),
    replayId: z.uuid(),
    targetId: z.string().min(1),
    executorId: z.literal('blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'),
    nativeMutationKind: z.literal('in_place_edit_mesh_subdivide'),
    nativeUndoDepth: z.literal(4),
    nativeRedoDepth: z.literal(4),
    marker: z.strictObject({
      key: z.literal('_operating_line_shortcut_proof_history_v2'),
      matched: z.literal(true),
    }),
    journal: z.strictObject({
      entryPresent: z.literal(true),
      baselineSnapshotPresent: z.literal(true),
      currentSnapshotPresent: z.literal(true),
      mutationLeaseHeld: z.literal(true),
    }),
    baselineState: z.strictObject({
      targetId: z.string().min(1),
      sceneFingerprintSha256: sha256Schema,
      objectName: z.literal('Cube'),
      objectPointer: z.number().int().positive(),
      meshPointer: z.number().int().positive(),
      meshUsers: z.literal(1),
      meshDatablockCount: z.literal(1),
      modifierCount: z.literal(0),
      shapeKeyCount: z.literal(0),
      topologySha256: sha256Schema,
      geometrySha256: sha256Schema,
    }),
    currentState: z.strictObject({
      targetId: z.string().min(1),
      sceneFingerprintSha256: sha256Schema,
      objectName: z.literal('Cube'),
      objectPointer: z.number().int().positive(),
      meshPointer: z.number().int().positive(),
      meshUsers: z.literal(1),
      meshDatablockCount: z.literal(1),
      modifierCount: z.literal(0),
      shapeKeyCount: z.literal(0),
      topologySha256: sha256Schema,
      geometrySha256: sha256Schema,
    }),
    receiptPrefixRootSha256: sha256Schema.nullable(),
    receiptPrefixHeadSha256: sha256Schema.nullable(),
    lastCompletedOperationId: z.enum(meshEditSubdivideShortcutProofOperationIds).nullable(),
    committedAt: timestampSchema,
  })
  .superRefine((checkpoint, context) => {
    const hasReceipts = checkpoint.lastCompletedOperationId !== null;
    if (
      hasReceipts !== (checkpoint.receiptPrefixRootSha256 !== null) ||
      hasReceipts !== (checkpoint.receiptPrefixHeadSha256 !== null) ||
      checkpoint.baselineState.targetId !== checkpoint.targetId ||
      checkpoint.currentState.targetId !== checkpoint.targetId ||
      checkpoint.baselineState.objectPointer !== checkpoint.currentState.objectPointer ||
      checkpoint.baselineState.meshPointer !== checkpoint.currentState.meshPointer
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Edit Subdivide failure checkpoint must bind target state and nullable receipt-prefix evidence exactly',
      });
    }
  });

export const procedureShortcutProofFailureCheckpointSchema = z.union([
  subdivisionSurfaceShortcutProofFailureCheckpointSchema,
  meshEditSubdivideShortcutProofFailureCheckpointSchema,
]);

const subdivisionSurfaceAttestationContentSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  attestationId: z.uuid(),
  deliveryId: z.uuid(),
  binding: subdivisionSurfaceBindingContentSchema.safeExtend({ integrity: integritySchema }),
  bindingContentSha256: sha256Schema,
  managedActionResult: z.literal('not_executed'),
  managedIdentityVerified: z.literal(false),
  executor: z.strictObject({
    executorId: z.literal('blender.subdivision_surface_f9.event_simulate.v1'),
    executionBoundary: z.literal('blender_window_event_simulate'),
    transport: z.literal('event_simulate'),
    osHidInput: z.literal(false),
  }),
  operationReceipts: z.tuple(subdivisionSurfaceShortcutProofOperationReceiptSchemas),
  strongObservation: z.strictObject({
    kind: z.literal('subdivision_surface_shortcut_ready'),
    satisfied: z.literal(true),
    observationId: z.uuid(),
    observedAt: timestampSchema,
    contentSha256: sha256Schema,
    targetId: z.string().min(1),
    modifierType: z.literal('SUBSURF'),
    modifierCount: z.literal(1),
    viewportLevel: z.number().int().min(0).max(6),
    subdivisionType: z.literal('CATMULL_CLARK'),
    renderLevels: z.literal(2),
    quality: z.literal(3),
    modifierStackMatches: z.literal(true),
    evaluatedTopologyWithinBounds: z.literal(true),
    sceneFingerprintSha256: sha256Schema,
  }),
  nativeUndoCheckpoint: subdivisionSurfaceNativeUndoCheckpointSchema,
  attestedAt: timestampSchema,
});

export const subdivisionSurfaceShortcutProofAttestationSchema =
  subdivisionSurfaceAttestationContentSchema
    .safeExtend({ integrity: integritySchema })
    .superRefine((attestation, context) => {
      const { binding, operationReceipts, nativeUndoCheckpoint } = attestation;
      if (attestation.bindingContentSha256 !== binding.integrity.contentSha256) {
        context.addIssue({
          code: 'custom',
          path: ['bindingContentSha256'],
          message: 'Shortcut proof attestation must bind the exact binding content',
        });
      }
      if (
        attestation.executor.executorId !== binding.executorId ||
        attestation.executor.executionBoundary !== binding.executionBoundary ||
        attestation.executor.transport !== binding.transport
      ) {
        context.addIssue({
          code: 'custom',
          path: ['executor'],
          message: 'Shortcut proof executor must match the immutable binding',
        });
      }
      let previous: string | null = null;
      let previousOccurredAt = Number.NEGATIVE_INFINITY;
      for (const [index, receipt] of operationReceipts.entries()) {
        const occurredAt = Date.parse(receipt.occurredAt);
        if (
          receipt.proofId !== binding.proofId ||
          receipt.requestId !== binding.requestId ||
          receipt.deliveryId !== attestation.deliveryId ||
          receipt.bindingContentSha256 !== attestation.bindingContentSha256 ||
          receipt.operationId !== binding.operationIds[index] ||
          receipt.order !== index + 1 ||
          receipt.previousReceiptContentSha256 !== previous ||
          occurredAt < previousOccurredAt ||
          receipt.contentSha256 !==
            computeProcedureShortcutProofOperationReceiptContentSha256(receipt)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['operationReceipts', index],
            message:
              'Shortcut proof receipts must form the exact canonical catalog operation hash chain',
          });
        }
        previous = receipt.contentSha256;
        previousOccurredAt = occurredAt;
      }
      if (
        nativeUndoCheckpoint.proofId !== binding.proofId ||
        nativeUndoCheckpoint.replayId !== binding.replayId ||
        nativeUndoCheckpoint.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.baselineState.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.finalState.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.finalState.viewportLevel !==
          binding.acceptedAction.arguments.viewportLevel ||
        nativeUndoCheckpoint.receiptChainRootSha256 !== operationReceipts[0]?.contentSha256 ||
        nativeUndoCheckpoint.receiptChainHeadSha256 !== previous ||
        nativeUndoCheckpoint.strongObservationContentSha256 !==
          attestation.strongObservation.contentSha256 ||
        nativeUndoCheckpoint.finalSceneFingerprintSha256 !==
          attestation.strongObservation.sceneFingerprintSha256 ||
        Date.parse(attestation.strongObservation.observedAt) < previousOccurredAt ||
        Date.parse(nativeUndoCheckpoint.committedAt) <
          Date.parse(attestation.strongObservation.observedAt) ||
        Date.parse(nativeUndoCheckpoint.committedAt) > Date.parse(attestation.attestedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nativeUndoCheckpoint'],
          message:
            'Shortcut Undo checkpoint must bind the completed receipt chain and proof identity',
        });
      }
      const propertyReceipt = operationReceipts[2];
      if (
        propertyReceipt?.operationId !== subdivisionSurfaceShortcutProofOperationIds[2] ||
        propertyReceipt.newValue !== binding.acceptedAction.arguments.viewportLevel ||
        attestation.strongObservation.viewportLevel !==
          binding.acceptedAction.arguments.viewportLevel ||
        attestation.strongObservation.targetId !== binding.acceptedAction.arguments.targetId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['strongObservation'],
          message:
            'Shortcut proof property and strong observation must match the exact accepted action',
        });
      }
      if (
        attestation.strongObservation.contentSha256 !==
        computeProcedureShortcutProofStrongObservationContentSha256(attestation.strongObservation)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['strongObservation', 'contentSha256'],
          message: 'Strong shortcut observation hash must match its strict evidence summary',
        });
      }
      if (
        computeProcedureShortcutProofAttestationContentSha256(attestation) !==
        attestation.integrity.contentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['integrity', 'contentSha256'],
          message: 'Shortcut proof attestation integrity must match its canonical content',
        });
      }
    });

const meshEditSubdivideStrongObservationSchema = z.strictObject({
  kind: z.literal('mesh_edit_subdivide_shortcut_ready'),
  satisfied: z.literal(true),
  observationId: z.uuid(),
  observedAt: timestampSchema,
  contentSha256: sha256Schema,
  targetId: z.string().min(1),
  objectName: z.literal('Cube'),
  objectPointer: z.number().int().positive(),
  meshName: z.string().min(1),
  meshPointer: z.number().int().positive(),
  meshUsers: z.literal(1),
  meshDatablockCount: z.literal(1),
  sameObjectIdentity: z.literal(true),
  sameMeshIdentity: z.literal(true),
  managedReplacementMeshCreated: z.literal(false),
  modifierCount: z.literal(0),
  shapeKeyCount: z.literal(0),
  activeObjectMode: z.literal('OBJECT'),
  selectedObjectCount: z.literal(1),
  operatorId: z.literal('MESH_OT_subdivide'),
  cuts: z.number().int().min(1).max(8),
  smooth: z.number().min(0).max(1),
  topology: z.strictObject({
    vertices: z.number().int().positive(),
    edges: z.number().int().positive(),
    polygons: z.number().int().positive(),
  }),
  topologySha256: sha256Schema,
  geometrySha256: sha256Schema,
  sceneFingerprintSha256: sha256Schema,
});

const meshEditSubdivideAttestationContentSchema = z.strictObject({
  formatVersion: procedureShortcutProofFormatVersionSchema,
  attestationId: z.uuid(),
  deliveryId: z.uuid(),
  binding: meshEditSubdivideBindingContentSchema.safeExtend({ integrity: integritySchema }),
  bindingContentSha256: sha256Schema,
  managedActionResult: z.literal('not_executed'),
  managedIdentityVerified: z.literal(false),
  managedReceiptCreated: z.literal(false),
  managedReplacementMeshCreated: z.literal(false),
  nativeMutationKind: z.literal('in_place_edit_mesh_subdivide'),
  executor: z.strictObject({
    executorId: z.literal('blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'),
    executionBoundary: z.literal('blender_window_event_simulate'),
    transport: z.literal('event_simulate'),
    osHidInput: z.literal(false),
  }),
  operationReceipts: z.tuple(meshEditSubdivideShortcutProofOperationReceiptSchemas),
  strongObservation: meshEditSubdivideStrongObservationSchema,
  nativeUndoCheckpoint: meshEditSubdivideNativeUndoCheckpointSchema,
  attestedAt: timestampSchema,
});

export const meshEditSubdivideShortcutProofAttestationSchema =
  meshEditSubdivideAttestationContentSchema
    .safeExtend({ integrity: integritySchema })
    .superRefine((attestation, context) => {
      const { binding, operationReceipts, nativeUndoCheckpoint, strongObservation } = attestation;
      let previous: string | null = null;
      let previousOccurredAt = Number.NEGATIVE_INFINITY;
      for (const [index, receipt] of operationReceipts.entries()) {
        const occurredAt = Date.parse(receipt.occurredAt);
        if (
          receipt.proofId !== binding.proofId ||
          receipt.requestId !== binding.requestId ||
          receipt.deliveryId !== attestation.deliveryId ||
          receipt.bindingContentSha256 !== attestation.bindingContentSha256 ||
          receipt.operationId !== binding.operationIds[index] ||
          receipt.order !== index + 1 ||
          receipt.previousReceiptContentSha256 !== previous ||
          occurredAt < previousOccurredAt ||
          receipt.contentSha256 !==
            computeProcedureShortcutProofOperationReceiptContentSha256(receipt)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['operationReceipts', index],
            message: 'Edit Subdivide receipts must form the exact canonical nine-operation chain',
          });
        }
        previous = receipt.contentSha256;
        previousOccurredAt = occurredAt;
      }
      const cutsReceipt = operationReceipts[5];
      const smoothReceipt = operationReceipts[6];
      const segmentCount = binding.acceptedAction.arguments.cuts + 1;
      const expectedTopology = {
        vertices: 6 * segmentCount * segmentCount + 2,
        edges: 12 * segmentCount * segmentCount,
        polygons: 6 * segmentCount * segmentCount,
      };
      if (
        attestation.bindingContentSha256 !== binding.integrity.contentSha256 ||
        nativeUndoCheckpoint.proofId !== binding.proofId ||
        nativeUndoCheckpoint.replayId !== binding.replayId ||
        nativeUndoCheckpoint.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.baselineState.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.finalState.targetId !== binding.acceptedAction.arguments.targetId ||
        nativeUndoCheckpoint.finalState.cuts !== binding.acceptedAction.arguments.cuts ||
        nativeUndoCheckpoint.finalState.smooth !== binding.acceptedAction.arguments.smooth ||
        nativeUndoCheckpoint.baselineState.objectPointer !==
          nativeUndoCheckpoint.finalState.objectPointer ||
        nativeUndoCheckpoint.baselineState.meshPointer !==
          nativeUndoCheckpoint.finalState.meshPointer ||
        nativeUndoCheckpoint.baselineState.meshDatablockCount !==
          nativeUndoCheckpoint.finalState.meshDatablockCount ||
        nativeUndoCheckpoint.finalState.meshDatablockCount !==
          strongObservation.meshDatablockCount ||
        nativeUndoCheckpoint.finalState.objectPointer !== strongObservation.objectPointer ||
        nativeUndoCheckpoint.finalState.meshPointer !== strongObservation.meshPointer ||
        nativeUndoCheckpoint.finalState.topologySha256 !== strongObservation.topologySha256 ||
        nativeUndoCheckpoint.finalState.geometrySha256 !== strongObservation.geometrySha256 ||
        nativeUndoCheckpoint.receiptChainRootSha256 !== operationReceipts[0]?.contentSha256 ||
        nativeUndoCheckpoint.receiptChainHeadSha256 !== previous ||
        nativeUndoCheckpoint.strongObservationContentSha256 !== strongObservation.contentSha256 ||
        nativeUndoCheckpoint.finalSceneFingerprintSha256 !==
          strongObservation.sceneFingerprintSha256 ||
        cutsReceipt?.operationId !== meshEditSubdivideShortcutProofOperationIds[5] ||
        !('newValue' in cutsReceipt) ||
        cutsReceipt.newValue !== binding.acceptedAction.arguments.cuts ||
        smoothReceipt?.operationId !== meshEditSubdivideShortcutProofOperationIds[6] ||
        !('newValue' in smoothReceipt) ||
        smoothReceipt.newValue !== binding.acceptedAction.arguments.smooth ||
        strongObservation.targetId !== binding.acceptedAction.arguments.targetId ||
        strongObservation.cuts !== binding.acceptedAction.arguments.cuts ||
        strongObservation.smooth !== binding.acceptedAction.arguments.smooth ||
        strongObservation.topology.vertices !== expectedTopology.vertices ||
        strongObservation.topology.edges !== expectedTopology.edges ||
        strongObservation.topology.polygons !== expectedTopology.polygons ||
        Date.parse(strongObservation.observedAt) < previousOccurredAt ||
        Date.parse(nativeUndoCheckpoint.committedAt) < Date.parse(strongObservation.observedAt) ||
        Date.parse(nativeUndoCheckpoint.committedAt) > Date.parse(attestation.attestedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['strongObservation'],
          message:
            'Edit Subdivide proof evidence must match its exact binding, receipts, and history',
        });
      }
      if (
        strongObservation.contentSha256 !==
        computeProcedureShortcutProofStrongObservationContentSha256(strongObservation)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['strongObservation', 'contentSha256'],
          message: 'Edit Subdivide strong observation hash must match its strict evidence summary',
        });
      }
      if (
        computeProcedureShortcutProofAttestationContentSha256(attestation) !==
        attestation.integrity.contentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['integrity', 'contentSha256'],
          message: 'Edit Subdivide attestation integrity must match its canonical content',
        });
      }
    });

export const procedureShortcutProofAttestationSchema = z.union([
  subdivisionSurfaceShortcutProofAttestationSchema,
  meshEditSubdivideShortcutProofAttestationSchema,
]);
export type ProcedureShortcutProofAttestation = z.infer<
  typeof procedureShortcutProofAttestationSchema
>;

function withoutIntegrity(value: Record<string, unknown>): unknown {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integrity'));
}
const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount));
function hashCanonical(value: unknown): string {
  const bytes = canonicalizeProtocolJsonValue(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const l = words[i - 15]!;
      const r = words[i - 2]!;
      words[i] =
        (words[i - 16]! +
          (rotateRight(l, 7) ^ rotateRight(l, 18) ^ (l >>> 3)) +
          words[i - 7]! +
          (rotateRight(r, 17) ^ rotateRight(r, 19) ^ (r >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const t1 =
        (h! +
          (rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          sha256RoundConstants[i]! +
          words[i]!) >>>
        0;
      const t2 =
        ((rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22)) +
          ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>>
        0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function computeProcedureShortcutProofCanonicalContentSha256(value: unknown): string {
  return hashCanonical(value);
}

export function computeProcedureShortcutProofBindingContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(withoutIntegrity(value));
}
export function computeProcedureShortcutProofProposalRecordContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(withoutIntegrity(value));
}
export function computeProcedureShortcutProofAttestationContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(withoutIntegrity(value));
}
export function computeProcedureShortcutProofOperationReceiptContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentSha256')),
  );
}
export function computeProcedureShortcutProofStrongObservationContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentSha256')),
  );
}

export function computeProcedureShortcutProofNativeObservationContentSha256(
  value: Record<string, unknown>,
): string {
  return hashCanonical(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentSha256')),
  );
}
