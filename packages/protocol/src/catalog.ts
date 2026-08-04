import { z } from 'zod';

import { rollbackModeSchema } from './adapter.js';
import { companionStateReportSchema } from './companion.js';
import { guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { catalogVersionSchema, planningQualityBaselineVersionSchema } from './version.js';

export const planningPhaseSchema = z.strictObject({
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  selectionGuidance: z.string().min(1),
  actionNames: z.array(z.string().min(1)).min(1),
});
export type PlanningPhase = z.infer<typeof planningPhaseSchema>;

export const actionArgumentsJsonSchemaSchema = z.strictObject({
  type: z.literal('object'),
  description: z.string().min(1).optional(),
  required: z.array(z.string().min(1)).optional(),
  properties: z.record(z.string(), z.unknown()),
  additionalProperties: z.literal(false),
});
export type ActionArgumentsJsonSchema = z.infer<typeof actionArgumentsJsonSchemaSchema>;

export const actionResourceEffectSchema = z.strictObject({
  access: z.enum(['create', 'read', 'mutate', 'artifact']),
  resourceType: z.string().min(1),
  argumentPath: z.string().min(1),
  derivedResourceTypes: z.array(z.string().min(1)),
  description: z.string().min(1),
});
export type ActionResourceEffect = z.infer<typeof actionResourceEffectSchema>;

export const actionSafetySchema = z.strictObject({
  sideEffect: z.enum(['read', 'scene_write', 'managed_file_write']),
  requiresPlanApproval: z.boolean(),
  networkAccess: z.boolean(),
  fileAccess: z.enum(['none', 'managed_temp']),
});
export type ActionSafety = z.infer<typeof actionSafetySchema>;

export const actionCatalogEntrySchema = z.strictObject({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  argumentsSchema: actionArgumentsJsonSchemaSchema,
  resourceEffects: z.array(actionResourceEffectSchema),
  supportedAnchorKinds: z.array(
    z.enum(['object', 'world_position', 'operator', 'owned_control', 'unavailable']),
  ),
  supportedObservationKinds: z.array(z.string().min(1)),
  rollbackModes: z.array(rollbackModeSchema).min(1),
  safety: actionSafetySchema,
});
export type ActionCatalogEntry = z.infer<typeof actionCatalogEntrySchema>;

export const actionCatalogSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  catalogVersion: catalogVersionSchema,
  adapterId: z.string().min(1),
  adapterVersionRange: z.string().min(1),
  hostVersionRange: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  planningNotes: z.array(z.string().min(1)),
  planningPhases: z.array(planningPhaseSchema).min(1).optional(),
  actions: z.array(actionCatalogEntrySchema).min(1),
});
export type ActionCatalog = z.infer<typeof actionCatalogSchema>;

export function validateActionCatalog(catalog: ActionCatalog): void {
  const actionNames = new Set<string>();
  for (const action of catalog.actions) {
    if (actionNames.has(action.name)) {
      throw new Error(
        `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} contains duplicate action ${action.name}`,
      );
    }
    actionNames.add(action.name);

    const propertyNames = new Set(Object.keys(action.argumentsSchema.properties));
    for (const requiredName of action.argumentsSchema.required ?? []) {
      if (!propertyNames.has(requiredName)) {
        throw new Error(`Action ${action.name} requires unknown argument property ${requiredName}`);
      }
    }
    if (
      new Set(action.argumentsSchema.required ?? []).size !==
      (action.argumentsSchema.required ?? []).length
    ) {
      throw new Error(`Action ${action.name} repeats a required argument property`);
    }
  }

  if (catalog.planningPhases === undefined) {
    return;
  }
  const phaseIds = new Set<string>();
  const phaseOrders = new Set<number>();
  const assignedActions = new Set<string>();
  for (const phase of catalog.planningPhases) {
    if (phaseIds.has(phase.id)) {
      throw new Error(
        `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} repeats planning phase ${phase.id}`,
      );
    }
    if (phaseOrders.has(phase.order)) {
      throw new Error(
        `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} repeats planning phase order ${phase.order}`,
      );
    }
    phaseIds.add(phase.id);
    phaseOrders.add(phase.order);
    for (const actionName of phase.actionNames) {
      if (!actionNames.has(actionName)) {
        throw new Error(`Planning phase ${phase.id} references unknown action ${actionName}`);
      }
      if (assignedActions.has(actionName)) {
        throw new Error(`Action ${actionName} is assigned to more than one planning phase`);
      }
      assignedActions.add(actionName);
    }
  }
  const unassignedActions = [...actionNames].filter(
    (actionName) => !assignedActions.has(actionName),
  );
  if (unassignedActions.length > 0) {
    throw new Error(
      `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} leaves actions outside planning phases: ${unassignedActions.sort().join(', ')}`,
    );
  }
}

export const actionCatalogRequestSchema = z.strictObject({
  targetAdapterId: z.string().min(1),
  catalogVersion: catalogVersionSchema.optional(),
});
export type ActionCatalogRequest = z.infer<typeof actionCatalogRequestSchema>;

export const planningContextRequestSchema = z.strictObject({
  targetAdapterId: z.string().min(1),
  catalogVersion: catalogVersionSchema.optional(),
  goal: z.string().trim().min(1).max(10_000).optional(),
  planId: z.string().trim().min(1).max(180).optional(),
});
export type PlanningContextRequest = z.infer<typeof planningContextRequestSchema>;

export const planningContextSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  targetAdapterId: z.string().min(1),
  goal: z.string().min(1).nullable(),
  requestedPlanId: z.string().min(1).nullable(),
  recommendedRevision: z.number().int().positive().nullable(),
  catalog: actionCatalogSchema,
  companionStates: z.array(companionStateReportSchema),
  constraints: z.strictObject({
    singleAdapterPlan: z.literal(true),
    executableActionsMustBeLeaves: z.literal(true),
    dependenciesMustReferenceExecutableActions: z.literal(true),
    unknownActionsMustBeRejected: z.literal(true),
    semanticAnchorsOnly: z.literal(true),
    immutablePlanRevisions: z.literal(true),
    humanApprovalRequired: z.literal(true),
    executionOrder: z.literal('dependsOn_topology_then_order_then_id'),
  }),
  submission: z.strictObject({
    toolName: z.literal('operatingline.guide.propose'),
    targetAdapterId: z.string().min(1),
    description: z.string().min(1),
  }),
  qualityGate: z
    .strictObject({
      toolName: z.literal('operatingline.planning.evaluate'),
      baselineVersion: planningQualityBaselineVersionSchema,
      requiredPhaseSelection: z.literal('planner_declared_from_goal'),
      description: z.string().min(1),
    })
    .optional(),
});
export type PlanningContext = z.infer<typeof planningContextSchema>;
