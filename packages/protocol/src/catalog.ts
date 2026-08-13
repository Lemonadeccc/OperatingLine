import { z } from 'zod';

import { rollbackModeSchema } from './adapter.js';
import { validateActionArgumentsSchema } from './action-arguments.js';
import { companionStateReportSchema } from './companion.js';
import { guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import {
  catalogVersionSchema,
  planningQualityBaselineVersion,
  planningQualityBaselineVersionSchema,
  stableVersionRangeSchema,
} from './version.js';

export const planningPhaseSchema = z.strictObject({
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  selectionGuidance: z.string().min(1),
  actionNames: z.array(z.string().min(1)).min(1),
});
export type PlanningPhase = z.infer<typeof planningPhaseSchema>;

export const semanticCapabilitySchema = z.strictObject({
  id: guideStepIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  selectionGuidance: z.string().min(1),
  actionNames: z
    .array(z.string().min(1))
    .min(1)
    .superRefine((actionNames, context) => {
      if (new Set(actionNames).size !== actionNames.length) {
        context.addIssue({ code: 'custom', message: 'Capability action names must be unique' });
      }
    }),
});
export type SemanticCapability = z.infer<typeof semanticCapabilitySchema>;

export const actionArgumentsJsonSchemaSchema = z.strictObject({
  type: z.literal('object'),
  description: z.string().min(1).optional(),
  distinctPropertyValues: z.array(z.string().min(1)).min(2).optional(),
  atLeastOnePositiveProperty: z.array(z.string().min(1)).min(1).optional(),
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

export const actionCatalogJsonSchemaMetadata = {
  allOf: [
    {
      if: { type: 'object', required: ['semanticCapabilities'] },
      then: { type: 'object', required: ['planningPhases'] },
    },
  ],
} as const;

export const actionCatalogSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    catalogVersion: catalogVersionSchema,
    adapterId: z.string().min(1),
    adapterVersionRange: stableVersionRangeSchema,
    hostVersionRange: stableVersionRangeSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    planningNotes: z.array(z.string().min(1)),
    planningPhases: z.array(planningPhaseSchema).min(1).optional(),
    semanticCapabilities: z.array(semanticCapabilitySchema).min(1).optional(),
    actions: z.array(actionCatalogEntrySchema).min(1),
  })
  .meta(actionCatalogJsonSchemaMetadata);
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
    try {
      validateActionArgumentsSchema(
        action.argumentsSchema,
        `action ${action.name}.argumentsSchema`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Action ${action.name} has invalid arguments schema: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  if (catalog.semanticCapabilities !== undefined && catalog.planningPhases === undefined) {
    throw new Error(
      `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} cannot declare semantic capabilities without planning phases`,
    );
  }

  const capabilityIds = new Set<string>();
  for (const capability of catalog.semanticCapabilities ?? []) {
    if (capabilityIds.has(capability.id)) {
      throw new Error(
        `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} contains duplicate semantic capability ${capability.id}`,
      );
    }
    capabilityIds.add(capability.id);
    const capabilityActionNames = new Set<string>();
    for (const actionName of capability.actionNames) {
      if (capabilityActionNames.has(actionName)) {
        throw new Error(
          `Semantic capability ${capability.id} contains duplicate action ${actionName}`,
        );
      }
      capabilityActionNames.add(actionName);
      if (!actionNames.has(actionName)) {
        throw new Error(
          `Semantic capability ${capability.id} references unknown action ${actionName}`,
        );
      }
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

export const planningContextJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: { catalog: { type: 'object', required: ['planningPhases'] } },
        required: ['catalog'],
      },
      then: { type: 'object', required: ['qualityGate'] },
      else: { not: { type: 'object', required: ['qualityGate'] } },
    },
    {
      if: {
        type: 'object',
        properties: { catalog: { type: 'object', required: ['semanticCapabilities'] } },
        required: ['catalog'],
      },
      then: {
        type: 'object',
        properties: {
          qualityGate: {
            type: 'object',
            properties: { baselineVersion: { const: '1.1.0' } },
            required: ['baselineVersion'],
          },
        },
        required: ['qualityGate'],
      },
      else: {
        if: { type: 'object', required: ['qualityGate'] },
        then: {
          type: 'object',
          properties: {
            qualityGate: {
              type: 'object',
              properties: { baselineVersion: { const: '1.0.0' } },
              required: ['baselineVersion'],
            },
          },
        },
      },
    },
  ],
} as const;

export const planningContextSchema = z
  .strictObject({
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
  })
  .superRefine((context, refinement) => {
    if (
      context.targetAdapterId !== context.catalog.adapterId ||
      context.targetAdapterId !== context.submission.targetAdapterId
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['targetAdapterId'],
        message: 'Planning context adapter ids must match the catalog and submission target',
      });
    }
    if (
      context.companionStates.some(
        (companionState) => companionState.adapterId !== context.targetAdapterId,
      )
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['companionStates'],
        message: 'Planning companion states must belong to the target adapter',
      });
    }
    if ((context.catalog.planningPhases !== undefined) !== (context.qualityGate !== undefined)) {
      refinement.addIssue({
        code: 'custom',
        path: ['qualityGate'],
        message: 'Planning quality gate must be present if and only if planning phases exist',
      });
    }
    const expectedQualityBaseline =
      context.catalog.semanticCapabilities === undefined ? '1.0.0' : planningQualityBaselineVersion;
    if (
      context.qualityGate !== undefined &&
      context.qualityGate.baselineVersion !== expectedQualityBaseline
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['qualityGate', 'baselineVersion'],
        message:
          'Planning quality baseline must be 1.1.0 if and only if semantic capabilities exist',
      });
    }
  })
  .meta(planningContextJsonSchemaMetadata);
export type PlanningContext = z.infer<typeof planningContextSchema>;
