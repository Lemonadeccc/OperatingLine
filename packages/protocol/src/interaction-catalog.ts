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

export const interactionRecipeSchema = z.strictObject({
  id: guideStepIdSchema,
  actionName: z.string().min(1),
  title: z.string().min(1),
  guidance: interactionPathSchema,
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

function validateRecipe(recipe: InteractionRecipe): void {
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
}
