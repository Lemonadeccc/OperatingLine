import { z } from 'zod';

import type { ActionCatalog } from './catalog.js';
import { guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
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
    transform: z.enum(['identity', 'uniform_vector3']),
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

export const procedureMaterializationSchema = z.strictObject({
  menu: menuProcedureMaterializationSchema,
  shortcut: unavailableProcedureMaterializationSchema,
  mcp: unavailableProcedureMaterializationSchema,
});
export type ProcedureMaterialization = z.infer<typeof procedureMaterializationSchema>;

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

function validateRecipe(recipe: InteractionRecipe): void {
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
    const menu = recipe.procedureMaterialization?.menu;
    if (
      menu?.availability !== 'available' ||
      menu.parameterBinding !== 'ordered_parameter_operations'
    ) {
      continue;
    }

    const action = actionsByName.get(recipe.actionName)!;
    const argumentSchemas = action.argumentsSchema.properties;
    const coveredArguments = new Set<string>();
    const assignments = [
      ...menu.operatorParameters,
      ...menu.controlOperations.operations.flatMap((control) => control.parameters),
    ];
    for (const assignment of assignments) {
      if (assignment.source.kind !== 'action_argument') {
        continue;
      }
      const argumentName = assignment.source.argumentName;
      if (!Object.hasOwn(argumentSchemas, argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} references unknown action argument ${argumentName}`,
        );
      }
      if (coveredArguments.has(argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} maps action argument ${argumentName} more than once`,
        );
      }
      if (assignment.source.transform === 'uniform_vector3') {
        const argumentSchema = argumentSchemas[argumentName];
        if (
          typeof argumentSchema !== 'object' ||
          argumentSchema === null ||
          !('type' in argumentSchema) ||
          (argumentSchema.type !== 'number' && argumentSchema.type !== 'integer')
        ) {
          throw new Error(
            `Interaction recipe ${recipe.id} uniform_vector3 requires numeric action argument ${argumentName}`,
          );
        }
      }
      coveredArguments.add(argumentName);
    }

    const omittedArguments = new Set<string>();
    for (const omitted of menu.omittedActionArguments) {
      if (!Object.hasOwn(argumentSchemas, omitted.argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} omits unknown action argument ${omitted.argumentName}`,
        );
      }
      if (coveredArguments.has(omitted.argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} action argument ${omitted.argumentName} cannot be both mapped and omitted`,
        );
      }
      if (omittedArguments.has(omitted.argumentName)) {
        throw new Error(
          `Interaction recipe ${recipe.id} omits action argument ${omitted.argumentName} more than once`,
        );
      }
      omittedArguments.add(omitted.argumentName);
    }

    const uncoveredArguments = Object.keys(argumentSchemas).filter(
      (argumentName) => !coveredArguments.has(argumentName) && !omittedArguments.has(argumentName),
    );
    if (uncoveredArguments.length > 0) {
      throw new Error(
        `Interaction recipe ${recipe.id} leaves action arguments unmapped: ${uncoveredArguments.sort().join(', ')}`,
      );
    }
  }
}
