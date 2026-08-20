import { z } from 'zod';

import type { ActionCatalog } from './catalog.js';
import { guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import {
  procedureParameterPathSegmentSchema,
  procedureParameterTransformSchema,
  type ProcedureParameterTransform,
} from './procedure-parameter-projection.js';
import { catalogVersionSchema, stableVersionRangeSchema } from './version.js';

export const interactionTargetKindSchema = z.enum([
  'workspace',
  'editor',
  'mode',
  'menu',
  'menu_item',
  'operator',
  'control',
  'panel',
  'node',
  'socket',
  'canvas',
  'semantic',
]);
export type InteractionTargetKind = z.infer<typeof interactionTargetKindSchema>;

export const interactionStepIntentSchema = z.enum(['navigate', 'configure', 'execute', 'verify']);
export type InteractionStepIntent = z.infer<typeof interactionStepIntentSchema>;

export const interactionTargetSchema = z.strictObject({
  kind: interactionTargetKindSchema,
  hostId: z.string().min(1),
});
export type InteractionTarget = z.infer<typeof interactionTargetSchema>;

export const interactionStepSchema = z.strictObject({
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  label: z.string().min(1),
  intent: interactionStepIntentSchema,
  target: interactionTargetSchema,
});
export type InteractionStep = z.infer<typeof interactionStepSchema>;

export const interactionPreconditionSchema = z.strictObject({
  kind: z.enum(['workspace', 'editor', 'mode', 'selection']),
  label: z.string().min(1),
  value: z.string().min(1),
});
export type InteractionPrecondition = z.infer<typeof interactionPreconditionSchema>;

export const nativeInteractionPathSchema = z.strictObject({
  kind: z.literal('native_path'),
  surfaceId: z.string().min(1),
  preconditions: z.array(interactionPreconditionSchema),
  steps: z.array(interactionStepSchema).min(2),
  execution: z.strictObject({
    stepId: guideStepIdSchema,
    operatorId: z.string().min(1),
    binding: z.literal('accepted_plan_action'),
  }),
  manualReference: z.string().url().optional(),
});
export type NativeInteractionPath = z.infer<typeof nativeInteractionPathSchema>;

export const semanticInteractionPathSchema = z.strictObject({
  kind: z.literal('semantic_path'),
  steps: z.array(interactionStepSchema).min(1),
  reason: z.string().min(1),
  manualReference: z.string().url().optional(),
});
export type SemanticInteractionPath = z.infer<typeof semanticInteractionPathSchema>;

export const interactionPathSchema = z.discriminatedUnion('kind', [
  nativeInteractionPathSchema,
  semanticInteractionPathSchema,
]);
export type InteractionPath = z.infer<typeof interactionPathSchema>;

export const unavailableProcedureMaterializationSchema = z.strictObject({
  availability: z.literal('unavailable'),
  reason: z.string().min(1),
});
export type UnavailableProcedureMaterialization = z.infer<
  typeof unavailableProcedureMaterializationSchema
>;

export const parameterAssignmentSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('literal'),
    value: z.json(),
  }),
  z.strictObject({
    kind: z.literal('action_argument'),
    argumentName: z.string().min(1),
    transform: z.enum([
      'identity',
      'divide_by_two',
      'uniform_vector3',
      'vector3_x',
      'vector3_y',
      'vector3_z',
    ]),
  }),
  z.strictObject({
    kind: z.literal('derived_action_arguments'),
    derivation: z.literal('segment_frame'),
    startArgumentName: z.string().min(1),
    endArgumentName: z.string().min(1),
    output: z.enum(['distance', 'midpoint', 'rotation_euler_xyz_align_z']),
  }),
]);
export type ParameterAssignmentSource = z.infer<typeof parameterAssignmentSourceSchema>;

const parameterAssignmentNamePattern =
  /^(?!(?:__proto__|prototype|constructor)$)[A-Za-z_][A-Za-z0-9_.-]*$/;

export const parameterAssignmentNameSchema = z
  .string()
  .regex(
    parameterAssignmentNamePattern,
    'Parameter assignment names must be portable identifiers and cannot use reserved prototype names',
  );
export type ParameterAssignmentName = z.infer<typeof parameterAssignmentNameSchema>;

export const parameterAssignmentSchema = z.strictObject({
  name: parameterAssignmentNameSchema,
  source: parameterAssignmentSourceSchema,
});
export type ParameterAssignment = z.infer<typeof parameterAssignmentSchema>;

export const postExecutionControlOperationSchema = z.strictObject({
  id: guideStepIdSchema,
  label: z.string().min(1),
  target: z.strictObject({
    kind: z.literal('control'),
    hostId: z.string().min(1),
  }),
  path: z.array(z.string().min(1)).min(1),
  parameters: z.array(parameterAssignmentSchema).min(1),
});
export type PostExecutionControlOperation = z.infer<typeof postExecutionControlOperationSchema>;

export const omittedActionArgumentSchema = z.strictObject({
  argumentName: z.string().min(1),
  reason: z.string().min(1),
});
export type OmittedActionArgument = z.infer<typeof omittedActionArgumentSchema>;

const availableMenuProcedureMaterializationSchema = z.discriminatedUnion('parameterBinding', [
  z.strictObject({
    availability: z.literal('available'),
    source: z.literal('guidance.native_path'),
    semanticBinding: z.literal('all_leaf_operations'),
    parameterBinding: z.literal('accepted_action_arguments'),
  }),
  z.strictObject({
    availability: z.literal('available'),
    source: z.literal('guidance.native_path'),
    semanticBinding: z.literal('all_leaf_operations'),
    parameterBinding: z.literal('ordered_parameter_operations'),
    operatorParameters: z.array(parameterAssignmentSchema),
    controlOperations: z.strictObject({
      insertAfterStepId: guideStepIdSchema,
      operations: z.array(postExecutionControlOperationSchema).min(1),
    }),
    omittedActionArguments: z.array(omittedActionArgumentSchema),
  }),
]);

export const menuProcedureMaterializationSchema = z.union([
  unavailableProcedureMaterializationSchema,
  availableMenuProcedureMaterializationSchema,
]);
export type MenuProcedureMaterialization = z.infer<typeof menuProcedureMaterializationSchema>;

export const orderedShortcutOperationSchema = z.strictObject({
  id: guideStepIdSchema,
  label: z.string().min(1),
  keyMode: z.enum(['chord', 'sequence']),
  keys: z.array(z.string().min(1)).min(1),
  selectionPath: z.array(z.string().min(1)).min(1).optional(),
  parameters: z.array(parameterAssignmentSchema).min(1),
});
export type OrderedShortcutOperation = z.infer<typeof orderedShortcutOperationSchema>;

const shortcutSurfaceSchema = z.strictObject({
  kind: z.literal('adjust_last_operation'),
  hostId: z.literal('screen.redo_last'),
  sourceOperationId: guideStepIdSchema,
  expectedOperatorId: z.string().min(1),
});

export const shortcutKeyInputOperationSchema = z
  .strictObject({
    kind: z.literal('key_input'),
    id: guideStepIdSchema,
    label: z.string().min(1),
    keyMode: z.enum(['chord', 'sequence']),
    keys: z.array(z.string().min(1)).min(1),
    selectionPath: z.array(z.string().min(1)).min(1).optional(),
    parameters: z.array(parameterAssignmentSchema),
    opensSurface: shortcutSurfaceSchema.optional(),
    closesSurfaceOperationId: guideStepIdSchema.optional(),
  })
  .refine(
    (operation) =>
      operation.opensSurface === undefined || operation.closesSurfaceOperationId === undefined,
    { message: 'Shortcut key input cannot open and close a surface in the same operation' },
  );
export type ShortcutKeyInputOperation = z.infer<typeof shortcutKeyInputOperationSchema>;

export const shortcutOperatorPropertyUpdateOperationSchema = z.strictObject({
  kind: z.literal('operator_property_update'),
  id: guideStepIdSchema,
  label: z.string().min(1),
  surfaceOperationId: guideStepIdSchema,
  target: z.strictObject({
    kind: z.literal('control'),
    hostId: z.string().min(1),
  }),
  path: z.array(z.string().min(1)).min(1),
  parameters: z
    .array(parameterAssignmentSchema)
    .length(1)
    .refine((parameters) => parameters[0]?.name === 'value', {
      message: 'Shortcut operator property updates require one value parameter',
    }),
});
export type ShortcutOperatorPropertyUpdateOperation = z.infer<
  typeof shortcutOperatorPropertyUpdateOperationSchema
>;

export const extendedShortcutOperationSchema = z.discriminatedUnion('kind', [
  shortcutKeyInputOperationSchema,
  shortcutOperatorPropertyUpdateOperationSchema,
]);
export type ExtendedShortcutOperation = z.infer<typeof extendedShortcutOperationSchema>;

export const shortcutLedOperationSchema = z.union([
  orderedShortcutOperationSchema,
  extendedShortcutOperationSchema,
]);
export type ShortcutLedOperation = z.infer<typeof shortcutLedOperationSchema>;

export const availableShortcutProcedureMaterializationSchema = z.strictObject({
  availability: z.literal('available'),
  source: z.literal('catalog.ordered_shortcut_operations'),
  semanticBinding: z.literal('all_leaf_operations'),
  parameterBinding: z.literal('ordered_parameter_operations'),
  projection: z.literal('candidate_only'),
  preconditions: z.array(
    z.strictObject({
      kind: z.enum([
        'workspace',
        'editor',
        'mode',
        'selection',
        'keymap',
        'modal_state',
        'scene_state',
      ]),
      label: z.string().min(1),
      value: z.string().min(1),
    }),
  ),
  operations: z.array(shortcutLedOperationSchema).min(1),
  omittedActionArguments: z.array(omittedActionArgumentSchema),
});
export type AvailableShortcutProcedureMaterialization = z.infer<
  typeof availableShortcutProcedureMaterializationSchema
>;

export const shortcutProcedureMaterializationSchema = z.union([
  unavailableProcedureMaterializationSchema,
  availableShortcutProcedureMaterializationSchema,
]);
export type ShortcutProcedureMaterialization = z.infer<
  typeof shortcutProcedureMaterializationSchema
>;

export const availableMcpProcedureMaterializationSchema = z.strictObject({
  availability: z.literal('available'),
  source: z.literal('catalog.action_level_mcp'),
  semanticBinding: z.literal('all_leaf_operations'),
  parameterBinding: z.literal('accepted_action_arguments'),
  serverName: z.literal('operating-line'),
  toolName: z.literal('operatingline.blender.action.execute'),
  authorization: z.literal('accepted_replay_next_step'),
  resultBinding: z.literal('companion_state_report'),
});
export type AvailableMcpProcedureMaterialization = z.infer<
  typeof availableMcpProcedureMaterializationSchema
>;

export const mcpProcedureMaterializationSchema = z.union([
  unavailableProcedureMaterializationSchema,
  availableMcpProcedureMaterializationSchema,
]);
export type McpProcedureMaterialization = z.infer<typeof mcpProcedureMaterializationSchema>;

export const semanticParameterProjectionSchema = z.strictObject({
  id: guideStepIdSchema,
  semanticAction: guideStepIdSchema,
  path: z.array(procedureParameterPathSegmentSchema).min(1).max(32),
  actionArgument: parameterAssignmentNameSchema,
  transform: procedureParameterTransformSchema,
});
export type SemanticParameterProjection = z.infer<typeof semanticParameterProjectionSchema>;

export const semanticProcedureMaterializationSchema = z.strictObject({
  source: z.literal('catalog.semantic_parameter_projections'),
  projections: z.array(semanticParameterProjectionSchema).min(1),
  omittedActionArguments: z.array(omittedActionArgumentSchema),
});
export type SemanticProcedureMaterialization = z.infer<
  typeof semanticProcedureMaterializationSchema
>;

export const procedureMaterializationSchema = z.strictObject({
  semantic: semanticProcedureMaterializationSchema.optional(),
  menu: menuProcedureMaterializationSchema,
  shortcut: shortcutProcedureMaterializationSchema,
  mcp: mcpProcedureMaterializationSchema,
});
export type ProcedureMaterialization = z.infer<typeof procedureMaterializationSchema>;

function isProcedureParameterPathPrefix(
  candidate: SemanticParameterProjection['path'],
  path: SemanticParameterProjection['path'],
): boolean {
  return (
    candidate.length <= path.length &&
    candidate.every((segment, index) => {
      const compared = path[index];
      if (compared === undefined) return false;
      if (segment.kind === 'field') {
        return compared.kind === 'field' && segment.name === compared.name;
      }
      return compared.kind === 'index' && segment.index === compared.index;
    })
  );
}

export const interactionRecipeSchema = z.strictObject({
  id: guideStepIdSchema,
  actionName: z.string().min(1),
  title: z.string().min(1),
  guidance: interactionPathSchema,
  procedureMaterialization: procedureMaterializationSchema.optional(),
});
export type InteractionRecipe = z.infer<typeof interactionRecipeSchema>;

export const interactionCatalogSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  catalogVersion: catalogVersionSchema,
  adapterId: z.string().min(1),
  actionCatalogVersion: catalogVersionSchema,
  adapterVersionRange: stableVersionRangeSchema,
  hostVersionRange: stableVersionRangeSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  recipes: z.array(interactionRecipeSchema).min(1),
});
export type InteractionCatalog = z.infer<typeof interactionCatalogSchema>;

const menuProcedureTargetKinds = new Set<InteractionTargetKind>([
  'workspace',
  'editor',
  'mode',
  'menu',
  'menu_item',
  'operator',
  'control',
]);

function validateParameterNames(
  recipe: InteractionRecipe,
  operationLabel: string,
  parameters: readonly ParameterAssignment[],
): void {
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (!parameterAssignmentNamePattern.test(parameter.name)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${operationLabel} contains unsafe parameter name ${parameter.name}`,
      );
    }
    if (names.has(parameter.name)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${operationLabel} contains duplicate parameter ${parameter.name}`,
      );
    }
    names.add(parameter.name);
  }
}

function isNumericSchema(schema: unknown): boolean {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'type' in schema &&
    (schema.type === 'number' || schema.type === 'integer')
  );
}

function isFixedNumericVector3Schema(schema: unknown): boolean {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'type' in schema &&
    schema.type === 'array' &&
    'items' in schema &&
    isNumericSchema(schema.items) &&
    'minItems' in schema &&
    schema.minItems === 3 &&
    'maxItems' in schema &&
    schema.maxItems === 3
  );
}

function isIdentityProjectionSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null || !('type' in schema)) return false;
  if (
    schema.type === 'boolean' ||
    schema.type === 'string' ||
    schema.type === 'number' ||
    schema.type === 'integer'
  ) {
    return true;
  }
  return (
    schema.type === 'array' &&
    'items' in schema &&
    isNumericSchema(schema.items) &&
    'minItems' in schema &&
    typeof schema.minItems === 'number' &&
    schema.minItems >= 1 &&
    'maxItems' in schema &&
    typeof schema.maxItems === 'number' &&
    schema.maxItems <= 4
  );
}

function validateIdentityProjectionSchema(
  recipe: InteractionRecipe,
  modality: 'semantic' | 'menu' | 'shortcut',
  argumentSchemas: Readonly<Record<string, unknown>>,
  argumentName: string,
  transform: ProcedureParameterTransform,
): void {
  if (
    transform !== 'identity' ||
    !Object.hasOwn(argumentSchemas, argumentName) ||
    isIdentityProjectionSchema(argumentSchemas[argumentName])
  ) {
    return;
  }
  throw new Error(
    `Interaction recipe ${recipe.id} ${modality} identity projection requires a scalar or one-to-four-item numeric array action argument ${argumentName}`,
  );
}

function validateActionArgumentCoverage(
  recipe: InteractionRecipe,
  argumentSchemas: Record<string, unknown>,
  assignments: readonly ParameterAssignment[],
  omittedActionArguments: readonly OmittedActionArgument[],
  modality: 'semantic' | 'menu' | 'shortcut',
): void {
  const coverage = new Map<string, { whole: boolean; components: Set<'x' | 'y' | 'z'> }>();
  const segmentFrameOutputs = ['distance', 'midpoint', 'rotation_euler_xyz_align_z'] as const;
  const segmentFrames = new Map<
    string,
    {
      startArgumentName: string;
      endArgumentName: string;
      outputs: Set<(typeof segmentFrameOutputs)[number]>;
    }
  >();
  const segmentFramePairByArgument = new Map<string, string>();

  for (const assignment of assignments) {
    if (assignment.source.kind !== 'derived_action_arguments') continue;

    const { startArgumentName, endArgumentName, output } = assignment.source;
    if (startArgumentName === endArgumentName) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} segment_frame requires distinct start and end action arguments`,
      );
    }

    for (const argumentName of [startArgumentName, endArgumentName]) {
      if (!Object.hasOwn(argumentSchemas, argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} segment_frame references unknown action argument ${argumentName}`,
        );
      }
      if (!isFixedNumericVector3Schema(argumentSchemas[argumentName])) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} segment_frame requires fixed three-item numeric array action argument ${argumentName}`,
        );
      }
    }

    const pairKey = JSON.stringify([startArgumentName, endArgumentName]);
    for (const argumentName of [startArgumentName, endArgumentName]) {
      const existingPairKey = segmentFramePairByArgument.get(argumentName);
      if (existingPairKey !== undefined && existingPairKey !== pairKey) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} action argument ${argumentName} cannot participate in multiple segment_frame pairs`,
        );
      }
      segmentFramePairByArgument.set(argumentName, pairKey);
    }

    const segmentFrame = segmentFrames.get(pairKey) ?? {
      startArgumentName,
      endArgumentName,
      outputs: new Set<(typeof segmentFrameOutputs)[number]>(),
    };
    if (segmentFrame.outputs.has(output)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} maps segment_frame output ${output} more than once for action arguments ${startArgumentName}, ${endArgumentName}`,
      );
    }
    segmentFrame.outputs.add(output);
    segmentFrames.set(pairKey, segmentFrame);
  }

  for (const assignment of assignments) {
    if (assignment.source.kind !== 'action_argument') continue;

    const { argumentName, transform } = assignment.source;
    if (!Object.hasOwn(argumentSchemas, argumentName)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} references unknown action argument ${argumentName}`,
      );
    }
    if (segmentFramePairByArgument.has(argumentName)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} action argument ${argumentName} cannot be both directly mapped and used in a segment_frame derivation`,
      );
    }

    const state = coverage.get(argumentName) ?? {
      whole: false,
      components: new Set<'x' | 'y' | 'z'>(),
    };
    if (transform === 'uniform_vector3' && !isNumericSchema(argumentSchemas[argumentName])) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} uniform_vector3 requires numeric action argument ${argumentName}`,
      );
    }
    if (transform === 'divide_by_two' && !isNumericSchema(argumentSchemas[argumentName])) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} divide_by_two requires numeric action argument ${argumentName}`,
      );
    }

    if (transform.startsWith('vector3_')) {
      if (!isFixedNumericVector3Schema(argumentSchemas[argumentName])) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} ${transform} requires fixed three-item numeric array action argument ${argumentName}`,
        );
      }
      if (state.whole) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} action argument ${argumentName} cannot mix whole-value and vector3 component mappings`,
        );
      }
      const component = transform.slice(-1) as 'x' | 'y' | 'z';
      if (state.components.has(component)) {
        throw new Error(
          `Interaction recipe ${recipe.id} ${modality} maps action argument ${argumentName} vector3_${component} more than once`,
        );
      }
      state.components.add(component);
    } else {
      if (state.whole || state.components.size > 0) {
        const suffix =
          state.components.size > 0
            ? 'cannot mix whole-value and vector3 component mappings'
            : `maps action argument ${argumentName} more than once`;
        throw new Error(
          state.components.size > 0
            ? `Interaction recipe ${recipe.id} ${modality} action argument ${argumentName} ${suffix}`
            : `Interaction recipe ${recipe.id} ${modality} ${suffix}`,
        );
      }
      state.whole = true;
    }
    coverage.set(argumentName, state);
  }

  for (const [argumentName, state] of coverage) {
    if (!state.whole && state.components.size !== 3) {
      const missingComponents = (['x', 'y', 'z'] as const).filter(
        (component) => !state.components.has(component),
      );
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} action argument ${argumentName} must map vector3 components x, y, and z exactly once; missing: ${missingComponents.join(', ')}`,
      );
    }
  }

  for (const segmentFrame of segmentFrames.values()) {
    const missingOutputs = segmentFrameOutputs.filter(
      (output) => !segmentFrame.outputs.has(output),
    );
    if (missingOutputs.length > 0) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} action arguments ${segmentFrame.startArgumentName}, ${segmentFrame.endArgumentName} must map segment_frame outputs distance, midpoint, and rotation_euler_xyz_align_z exactly once; missing: ${missingOutputs.join(', ')}`,
      );
    }
  }

  const omittedArguments = new Set<string>();
  for (const omitted of omittedActionArguments) {
    if (!Object.hasOwn(argumentSchemas, omitted.argumentName)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} omits unknown action argument ${omitted.argumentName}`,
      );
    }
    if (
      coverage.has(omitted.argumentName) ||
      segmentFramePairByArgument.has(omitted.argumentName)
    ) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} action argument ${omitted.argumentName} cannot be both mapped and omitted`,
      );
    }
    if (omittedArguments.has(omitted.argumentName)) {
      throw new Error(
        `Interaction recipe ${recipe.id} ${modality} omits action argument ${omitted.argumentName} more than once`,
      );
    }
    omittedArguments.add(omitted.argumentName);
  }

  const uncoveredArguments = Object.keys(argumentSchemas).filter(
    (argumentName) =>
      !coverage.has(argumentName) &&
      !segmentFramePairByArgument.has(argumentName) &&
      !omittedArguments.has(argumentName),
  );
  if (uncoveredArguments.length > 0) {
    throw new Error(
      `Interaction recipe ${recipe.id} ${modality} leaves action arguments unmapped: ${uncoveredArguments.sort().join(', ')}`,
    );
  }
}

function validateRecipe(recipe: InteractionRecipe): void {
  const semantic = recipe.procedureMaterialization?.semantic;
  if (semantic !== undefined) {
    const projectionIds = new Set<string>();
    const targetPaths: Array<{
      semanticAction: string;
      path: SemanticParameterProjection['path'];
    }> = [];
    for (const projection of semantic.projections) {
      if (projectionIds.has(projection.id)) {
        throw new Error(
          `Interaction recipe ${recipe.id} repeats semantic parameter projection ${projection.id}`,
        );
      }
      projectionIds.add(projection.id);
      const overlappingTarget = targetPaths.find(
        (target) =>
          target.semanticAction === projection.semanticAction &&
          (isProcedureParameterPathPrefix(target.path, projection.path) ||
            isProcedureParameterPathPrefix(projection.path, target.path)),
      );
      if (overlappingTarget !== undefined) {
        const exactTarget =
          overlappingTarget.path.length === projection.path.length &&
          isProcedureParameterPathPrefix(overlappingTarget.path, projection.path);
        throw new Error(
          exactTarget
            ? `Interaction recipe ${recipe.id} repeats semantic parameter target ${projection.semanticAction}`
            : `Interaction recipe ${recipe.id} overlaps semantic parameter target ${projection.semanticAction}`,
        );
      }
      targetPaths.push({
        semanticAction: projection.semanticAction,
        path: projection.path,
      });
    }
  }
  if (recipe.procedureMaterialization?.menu.availability === 'available') {
    if (
      recipe.guidance.kind !== 'native_path' ||
      recipe.guidance.execution.binding !== 'accepted_plan_action'
    ) {
      throw new Error(
        `Interaction recipe ${recipe.id} available menu materialization requires native_path guidance with accepted_plan_action execution`,
      );
    }
    const unsupportedStep = recipe.guidance.steps.find(
      (step) => !menuProcedureTargetKinds.has(step.target.kind),
    );
    if (unsupportedStep !== undefined) {
      throw new Error(
        `Interaction recipe ${recipe.id} available menu materialization cannot represent ${unsupportedStep.target.kind} targets`,
      );
    }

    const menu = recipe.procedureMaterialization.menu;
    if (menu.parameterBinding === 'ordered_parameter_operations') {
      if (menu.controlOperations.insertAfterStepId !== recipe.guidance.execution.stepId) {
        throw new Error(
          `Interaction recipe ${recipe.id} ordered parameter operations must be inserted after its execution step`,
        );
      }
      validateParameterNames(recipe, 'operator parameters', menu.operatorParameters);

      const guidanceIds = new Set(recipe.guidance.steps.map((step) => step.id));
      const guidanceLabels = new Set(recipe.guidance.steps.map((step) => step.label));
      const controlIds = new Set<string>();
      const controlLabels = new Set<string>();
      for (const control of menu.controlOperations.operations) {
        if (guidanceIds.has(control.id) || controlIds.has(control.id)) {
          throw new Error(
            `Interaction recipe ${recipe.id} control id ${control.id} conflicts with another operation`,
          );
        }
        if (guidanceLabels.has(control.label) || controlLabels.has(control.label)) {
          throw new Error(
            `Interaction recipe ${recipe.id} control label ${control.label} conflicts with another operation`,
          );
        }
        controlIds.add(control.id);
        controlLabels.add(control.label);
        validateParameterNames(recipe, `control ${control.id}`, control.parameters);
      }
    }
  }

  const shortcut = recipe.procedureMaterialization?.shortcut;
  if (shortcut?.availability === 'available') {
    const shortcutSurfaceOperatorId =
      recipe.guidance.kind === 'native_path'
        ? recipe.guidance.execution.operatorId
        : (() => {
            const executeOperatorSteps = recipe.guidance.steps.filter(
              (step) => step.intent === 'execute' && step.target.kind === 'operator',
            );
            return executeOperatorSteps.length === 1
              ? executeOperatorSteps[0]!.target.hostId
              : undefined;
          })();
    const singletonPreconditionKinds = new Set(['workspace', 'editor', 'mode', 'keymap']);
    const singletonPreconditionCounts = new Map<string, number>();
    const preconditionKeys = new Set<string>();
    for (const precondition of shortcut.preconditions) {
      const preconditionKey = `${precondition.kind}\u0000${precondition.label}`;
      if (preconditionKeys.has(preconditionKey)) {
        throw new Error(
          `Interaction recipe ${recipe.id} shortcut contains duplicate precondition ${precondition.kind}:${precondition.label}`,
        );
      }
      preconditionKeys.add(preconditionKey);
      if (singletonPreconditionKinds.has(precondition.kind)) {
        singletonPreconditionCounts.set(
          precondition.kind,
          (singletonPreconditionCounts.get(precondition.kind) ?? 0) + 1,
        );
      }
    }
    const duplicateSingletonKinds = [...singletonPreconditionCounts]
      .filter(([, count]) => count > 1)
      .map(([kind]) => kind)
      .sort();
    if (duplicateSingletonKinds.length > 0) {
      throw new Error(
        `Interaction recipe ${recipe.id} shortcut must declare exactly one precondition for: ${duplicateSingletonKinds.join(', ')}`,
      );
    }
    const preconditionKinds = new Set(
      shortcut.preconditions.map((precondition) => precondition.kind),
    );
    const missingPreconditionKinds = (
      ['workspace', 'editor', 'mode', 'keymap', 'scene_state'] as const
    ).filter((kind) => !preconditionKinds.has(kind));
    if (missingPreconditionKinds.length > 0) {
      throw new Error(
        `Interaction recipe ${recipe.id} shortcut is missing required preconditions: ${missingPreconditionKinds.join(', ')}`,
      );
    }
    const operationIds = new Set<string>();
    const operationLabels = new Set<string>();
    let openSurfaceOperationId: string | undefined;
    let openSurfaceExpectedOperatorId: string | undefined;
    let openSurfacePropertyCount = 0;
    let openSurfacePropertyHostIds = new Set<string>();
    for (const [operationIndex, operation] of shortcut.operations.entries()) {
      if (operationIds.has(operation.id)) {
        throw new Error(
          `Interaction recipe ${recipe.id} shortcut contains duplicate operation id ${operation.id}`,
        );
      }
      if (operationLabels.has(operation.label)) {
        throw new Error(
          `Interaction recipe ${recipe.id} shortcut contains duplicate operation label ${operation.label}`,
        );
      }
      operationIds.add(operation.id);
      operationLabels.add(operation.label);
      validateParameterNames(recipe, `shortcut operation ${operation.id}`, operation.parameters);

      if (!('kind' in operation)) {
        if (openSurfaceOperationId !== undefined) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface ${openSurfaceOperationId} requires contiguous property updates and an explicit close`,
          );
        }
        continue;
      }
      if (operation.kind === 'operator_property_update') {
        if (operation.surfaceOperationId !== openSurfaceOperationId) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut property ${operation.id} references a surface that is not currently open`,
          );
        }
        const expectedHostPrefix = `${openSurfaceExpectedOperatorId}.`;
        if (
          openSurfaceExpectedOperatorId === undefined ||
          !operation.target.hostId.startsWith(expectedHostPrefix) ||
          operation.target.hostId.length === expectedHostPrefix.length
        ) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut property ${operation.id} target ${operation.target.hostId} is outside operator ${openSurfaceExpectedOperatorId ?? 'unknown'}`,
          );
        }
        if (openSurfacePropertyHostIds.has(operation.target.hostId)) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface ${openSurfaceOperationId} repeats property target ${operation.target.hostId}`,
          );
        }
        openSurfacePropertyHostIds.add(operation.target.hostId);
        openSurfacePropertyCount += 1;
        continue;
      }
      if (operation.opensSurface !== undefined) {
        if (openSurfaceOperationId !== undefined) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut cannot open ${operation.id} while ${openSurfaceOperationId} is open`,
          );
        }
        const previousOperation = shortcut.operations[operationIndex - 1];
        if (
          operation.keyMode !== 'sequence' ||
          operation.keys.length !== 1 ||
          operation.keys[0] !== 'F9' ||
          operation.parameters.length !== 0
        ) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface opener ${operation.id} must be a parameterless F9 sequence`,
          );
        }
        if (previousOperation?.id !== operation.opensSurface.sourceOperationId) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface opener ${operation.id} must immediately follow its source operation`,
          );
        }
        if (operation.opensSurface.expectedOperatorId !== shortcutSurfaceOperatorId) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface opener ${operation.id} must bind the guidance execution operator`,
          );
        }
        openSurfaceOperationId = operation.id;
        openSurfaceExpectedOperatorId = operation.opensSurface.expectedOperatorId;
        openSurfacePropertyCount = 0;
        openSurfacePropertyHostIds = new Set<string>();
        continue;
      }
      if (operation.closesSurfaceOperationId !== undefined) {
        if (
          operation.closesSurfaceOperationId !== openSurfaceOperationId ||
          openSurfacePropertyCount === 0
        ) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface closer ${operation.id} does not close an updated open surface`,
          );
        }
        if (
          operation.keyMode !== 'sequence' ||
          operation.keys.length !== 1 ||
          operation.keys[0] !== 'ENTER' ||
          operation.parameters.length !== 0
        ) {
          throw new Error(
            `Interaction recipe ${recipe.id} shortcut surface closer ${operation.id} must be a parameterless ENTER sequence`,
          );
        }
        openSurfaceOperationId = undefined;
        openSurfaceExpectedOperatorId = undefined;
        openSurfacePropertyCount = 0;
        openSurfacePropertyHostIds = new Set<string>();
        continue;
      }
      if (openSurfaceOperationId !== undefined) {
        throw new Error(
          `Interaction recipe ${recipe.id} shortcut surface ${openSurfaceOperationId} requires contiguous property updates and an explicit close`,
        );
      }
    }
    if (openSurfaceOperationId !== undefined) {
      throw new Error(
        `Interaction recipe ${recipe.id} shortcut surface ${openSurfaceOperationId} is not explicitly closed`,
      );
    }
  }

  const mcp = recipe.procedureMaterialization?.mcp;
  if (mcp?.availability === 'available' && recipe.actionName !== 'blender.mesh.create_uv_sphere') {
    throw new Error(
      `Interaction recipe ${recipe.id} action-level MCP is restricted to blender.mesh.create_uv_sphere`,
    );
  }

  const stepIds = new Set<string>();
  const stepOrders = new Set<number>();
  const stepLabels = new Set<string>();
  for (const step of recipe.guidance.steps) {
    if (stepIds.has(step.id)) {
      throw new Error(`Interaction recipe ${recipe.id} contains duplicate step ${step.id}`);
    }
    if (stepOrders.has(step.order)) {
      throw new Error(
        `Interaction recipe ${recipe.id} contains duplicate step order ${step.order}`,
      );
    }
    if (stepLabels.has(step.label)) {
      throw new Error(
        `Interaction recipe ${recipe.id} contains duplicate step label ${step.label}`,
      );
    }
    stepIds.add(step.id);
    stepOrders.add(step.order);
    stepLabels.add(step.label);
  }

  const expectedOrders = recipe.guidance.steps.map((_step, index) => index + 1);
  const actualOrders = [...stepOrders].sort((left, right) => left - right);
  if (actualOrders.some((order, index) => order !== expectedOrders[index])) {
    throw new Error(`Interaction recipe ${recipe.id} step orders must be contiguous from 1`);
  }

  const guidance = recipe.guidance;
  if (guidance.kind !== 'native_path') {
    return;
  }
  const executionStep = guidance.steps.find((step) => step.id === guidance.execution.stepId);
  if (executionStep === undefined) {
    throw new Error(`Interaction recipe ${recipe.id} execution step is missing`);
  }
  if (
    executionStep.intent !== 'execute' ||
    executionStep.target.kind !== 'operator' ||
    executionStep.target.hostId !== guidance.execution.operatorId
  ) {
    throw new Error(
      `Interaction recipe ${recipe.id} execution must bind its operator target exactly`,
    );
  }
  const lastStep = guidance.steps.reduce((latest, step) =>
    step.order > latest.order ? step : latest,
  );
  if (lastStep.id !== executionStep.id) {
    throw new Error(`Interaction recipe ${recipe.id} execution step must be last`);
  }
}

export function validateInteractionCatalog(
  catalog: InteractionCatalog,
  actionCatalog?: ActionCatalog,
): void {
  const recipeIds = new Set<string>();
  const actionNames = new Set<string>();
  for (const recipe of catalog.recipes) {
    if (recipeIds.has(recipe.id)) {
      throw new Error(
        `Interaction catalog ${catalog.adapterId}@${catalog.catalogVersion} contains duplicate recipe ${recipe.id}`,
      );
    }
    if (actionNames.has(recipe.actionName)) {
      throw new Error(
        `Interaction catalog ${catalog.adapterId}@${catalog.catalogVersion} contains duplicate action recipe ${recipe.actionName}`,
      );
    }
    recipeIds.add(recipe.id);
    actionNames.add(recipe.actionName);
    validateRecipe(recipe);
  }

  if (actionCatalog === undefined) {
    return;
  }
  if (
    catalog.adapterId !== actionCatalog.adapterId ||
    catalog.actionCatalogVersion !== actionCatalog.catalogVersion
  ) {
    throw new Error('Interaction catalog does not match its ActionCatalog identity');
  }

  const catalogActions = new Set(actionCatalog.actions.map((action) => action.name));
  const missing = [...catalogActions].filter((actionName) => !actionNames.has(actionName));
  const unknown = [...actionNames].filter((actionName) => !catalogActions.has(actionName));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Interaction catalog action coverage mismatch; missing: ${missing.sort().join(', ') || 'none'}; unknown: ${unknown.sort().join(', ') || 'none'}`,
    );
  }

  const actionsByName = new Map(actionCatalog.actions.map((action) => [action.name, action]));
  for (const recipe of catalog.recipes) {
    const action = actionsByName.get(recipe.actionName)!;
    const argumentSchemas = action.argumentsSchema.properties;
    const semantic = recipe.procedureMaterialization?.semantic;
    if (semantic !== undefined) {
      validateActionArgumentCoverage(
        recipe,
        argumentSchemas,
        semantic.projections.map((projection) => ({
          name: projection.id,
          source: {
            kind: 'action_argument' as const,
            argumentName: projection.actionArgument,
            transform: projection.transform,
          },
        })),
        semantic.omittedActionArguments,
        'semantic',
      );
      for (const projection of semantic.projections) {
        validateIdentityProjectionSchema(
          recipe,
          'semantic',
          argumentSchemas,
          projection.actionArgument,
          projection.transform,
        );
      }

      const menu = recipe.procedureMaterialization?.menu;
      if (menu?.availability === 'available') {
        if (menu.parameterBinding === 'accepted_action_arguments') {
          for (const argumentName of Object.keys(argumentSchemas)) {
            validateIdentityProjectionSchema(
              recipe,
              'menu',
              argumentSchemas,
              argumentName,
              'identity',
            );
          }
        } else {
          for (const assignment of [
            ...menu.operatorParameters,
            ...menu.controlOperations.operations.flatMap((operation) => operation.parameters),
          ]) {
            if (assignment.source.kind !== 'action_argument') continue;
            validateIdentityProjectionSchema(
              recipe,
              'menu',
              argumentSchemas,
              assignment.source.argumentName,
              assignment.source.transform,
            );
          }
        }
      }

      const shortcut = recipe.procedureMaterialization?.shortcut;
      if (shortcut?.availability === 'available') {
        for (const assignment of shortcut.operations.flatMap((operation) => operation.parameters)) {
          if (assignment.source.kind !== 'action_argument') continue;
          validateIdentityProjectionSchema(
            recipe,
            'shortcut',
            argumentSchemas,
            assignment.source.argumentName,
            assignment.source.transform,
          );
        }
      }
    }
    const menu = recipe.procedureMaterialization?.menu;
    if (
      menu?.availability === 'available' &&
      menu.parameterBinding === 'ordered_parameter_operations'
    ) {
      validateActionArgumentCoverage(
        recipe,
        argumentSchemas,
        [
          ...menu.operatorParameters,
          ...menu.controlOperations.operations.flatMap((control) => control.parameters),
        ],
        menu.omittedActionArguments,
        'menu',
      );
    }

    const shortcut = recipe.procedureMaterialization?.shortcut;
    if (shortcut?.availability === 'available') {
      validateActionArgumentCoverage(
        recipe,
        argumentSchemas,
        shortcut.operations.flatMap((operation) => operation.parameters),
        shortcut.omittedActionArguments,
        'shortcut',
      );
    }
  }
}
