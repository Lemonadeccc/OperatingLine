import { z } from 'zod';

import { catalogVersionSchema } from './version.js';

export const supportedGuideProtocolVersions = [
  '1.0.0',
  '1.1.0',
  '1.2.0',
  '1.3.0',
  '1.4.0',
  '1.5.0',
  '1.6.0',
  '1.7.0',
] as const;
export const guideProtocolVersion = '1.7.0' as const;
export const guideProtocolVersionSchema = z.enum(supportedGuideProtocolVersions);

export const guideStepIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const guideStepIdSchema = z
  .string()
  .regex(
    guideStepIdPattern,
    'Step ids must use the portable ASCII form [A-Za-z0-9][A-Za-z0-9._:-]*',
  );

export const guideNodeNumberPattern = /^[1-9]\d*(?:\.[1-9]\d*)*$/;
export const guideNodeNumberSchema = z
  .string()
  .regex(guideNodeNumberPattern, 'Node numbers must use dotted positive integers');

export const guideStepStateSchema = z.enum([
  'draft',
  'ready',
  'running',
  'waiting_approval',
  'verifying',
  'succeeded',
  'failed',
  'stale',
  'rolled_back',
]);
export type GuideStepState = z.infer<typeof guideStepStateSchema>;

export const semanticAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('object'),
    objectName: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('world_position'),
    position: z.array(z.number()).length(3),
  }),
  z.strictObject({
    kind: z.literal('operator'),
    operatorId: z.string().min(1),
    menuPath: z.array(z.string().min(1)).optional(),
  }),
  z.strictObject({
    kind: z.literal('owned_control'),
    surfaceId: z.string().min(1),
    controlId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('unavailable'),
    reason: z.string().min(1),
  }),
]);
export type SemanticAnchor = z.infer<typeof semanticAnchorSchema>;

export const actionBindingSchema = z.strictObject({
  adapterId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export type ActionBinding = z.infer<typeof actionBindingSchema>;

export const observationExpectationSchema = z.strictObject({
  kind: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});
export type ObservationExpectation = z.infer<typeof observationExpectationSchema>;

export const observationFailureStrategySchema = z.enum(['rollback_step', 'retain_for_repair']);
export type ObservationFailureStrategy = z.infer<typeof observationFailureStrategySchema>;

export const observationRetryPolicySchema = z.strictObject({
  mode: z.literal('automatic_bounded'),
  maxAttempts: z.number().int().min(2).max(3),
});
export type ObservationRetryPolicy = z.infer<typeof observationRetryPolicySchema>;

export const observationPolicySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('telemetry') }),
  z
    .strictObject({
      mode: z.literal('success_gate'),
      failureStrategy: observationFailureStrategySchema,
      retryPolicy: observationRetryPolicySchema.optional(),
    })
    .superRefine((policy, context) => {
      if (policy.retryPolicy !== undefined && policy.failureStrategy !== 'rollback_step') {
        context.addIssue({
          code: 'custom',
          path: ['retryPolicy'],
          message: 'Automatic Observation retries require rollback_step',
        });
      }
    })
    .meta({
      allOf: [
        {
          if: { required: ['retryPolicy'] },
          then: { properties: { failureStrategy: { const: 'rollback_step' } } },
        },
      ],
    }),
]);
export type ObservationPolicy = z.infer<typeof observationPolicySchema>;

const guideContentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const guideExecutionTrackOverrideSchema = z.strictObject({
  kind: z.literal('interaction_catalog_proof'),
  interactionCatalogVersion: catalogVersionSchema,
  interactionCatalogContentSha256: guideContentSha256Schema,
  recipeId: guideStepIdSchema,
  modality: z.enum(['menu', 'shortcut']),
  trackId: guideStepIdSchema,
  trackContentSha256: guideContentSha256Schema,
  proofExecutionContentSha256: guideContentSha256Schema,
});
export type GuideExecutionTrackOverride = z.infer<typeof guideExecutionTrackOverrideSchema>;

const guideCandidateMenuOperationSchema = z.strictObject({
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  semanticRefs: z.array(guideStepIdSchema).min(1),
  description: z.string().min(1),
  evidenceRefs: z.array(guideStepIdSchema),
  intent: z.enum(['navigate', 'configure', 'execute', 'verify']),
  target: z
    .strictObject({
      kind: z.enum([
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
      ]),
      hostId: z.string().min(1),
      connection: z
        .strictObject({
          fromNode: z.string().min(1),
          fromSocket: z.string().min(1),
          toNode: z.string().min(1),
          toSocket: z.string().min(1),
        })
        .optional(),
    })
    .superRefine((target, context) => {
      if (target.connection !== undefined && target.kind !== 'semantic') {
        context.addIssue({
          code: 'custom',
          path: ['connection'],
          message: 'Machine-readable node connections require a semantic target',
        });
      }
    }),
  path: z.array(z.string().min(1)).min(1),
  parameters: z.record(z.string().min(1), z.json()),
});

const guideNativeMenuCandidateEvidenceSchema = z.strictObject({
  kind: z.literal('bounded_blender_ui_probe'),
  executorId: z.string().min(1),
  hostVersions: z.array(z.string().min(1)).min(1),
  managedActionExecuted: z.literal(false),
  managedReceiptCreated: z.literal(false),
  managedReplacementMeshCreated: z.literal(false),
  nativeMutationKind: z.string().min(1),
  operationIds: z.array(guideStepIdSchema).min(1),
  nativeUndoCheckpointRequired: z.literal(true),
  nativeUndoDepth: z.number().int().positive(),
  nativeRedoDepth: z.number().int().positive(),
});

export const guideCandidateMenuProjectionSchema = z
  .strictObject({
    projection: z.literal('candidate_only'),
    interactionCatalogVersion: catalogVersionSchema,
    id: guideStepIdSchema,
    modality: z.literal('menu'),
    equivalence: z.literal('not_equivalent_to_managed_action'),
    executionAuthority: z.literal('none'),
    title: z.string().min(1),
    reason: z.string().min(1),
    preconditions: z
      .array(
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
      )
      .min(1),
    operations: z.array(guideCandidateMenuOperationSchema).min(1),
    omittedActionArguments: z.array(
      z.strictObject({ argumentName: z.string().min(1), reason: z.string().min(1) }),
    ),
    nativeEvidence: guideNativeMenuCandidateEvidenceSchema.optional(),
  })
  .superRefine((projection, context) => {
    const ids = new Set<string>();
    for (const [index, operation] of projection.operations.entries()) {
      if (operation.order !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'order'],
          message: 'Candidate menu projection operations must be contiguous and ordered',
        });
      }
      if (ids.has(operation.id)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'id'],
          message: 'Candidate menu projection operation ids must be unique',
        });
      }
      ids.add(operation.id);
    }
    if (projection.nativeEvidence !== undefined) {
      const operationIds = projection.operations.map((operation) => operation.id);
      if (
        operationIds.length !== projection.nativeEvidence.operationIds.length ||
        operationIds.some(
          (operationId, index) => operationId !== projection.nativeEvidence?.operationIds[index],
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nativeEvidence', 'operationIds'],
          message: 'Native candidate evidence must bind the exact ordered operation ids',
        });
      }
      if (
        new Set(projection.nativeEvidence.hostVersions).size !==
        projection.nativeEvidence.hostVersions.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nativeEvidence', 'hostVersions'],
          message: 'Native candidate evidence host versions must be unique',
        });
      }
    }
  });
export type GuideCandidateMenuProjection = z.infer<typeof guideCandidateMenuProjectionSchema>;

export const guideStepSchema = z
  .strictObject({
    id: guideStepIdSchema,
    parentId: guideStepIdSchema.nullable(),
    order: z.number().int().nonnegative(),
    dependsOn: z.array(guideStepIdSchema),
    title: z.string().min(1),
    intent: z.string().min(1),
    explanation: z.string().min(1),
    state: guideStepStateSchema,
    action: actionBindingSchema.nullable(),
    anchors: z.array(semanticAnchorSchema),
    expectedObservations: z.array(observationExpectationSchema),
    observationPolicy: observationPolicySchema.optional(),
    executionTrackOverride: guideExecutionTrackOverrideSchema.optional(),
    candidateMenuProjection: guideCandidateMenuProjectionSchema.optional(),
    rollback: z.strictObject({
      mode: z.enum(['native_undo', 'checkpoint_restore', 'compensating_action', 'unsupported']),
      checkpointRequired: z.boolean(),
    }),
  })
  .superRefine((step, context) => {
    if (step.observationPolicy !== undefined && step.action === null) {
      context.addIssue({
        code: 'custom',
        path: ['observationPolicy'],
        message: 'Only executable steps can declare an observation policy',
      });
    }
    if (step.executionTrackOverride !== undefined && step.action === null) {
      context.addIssue({
        code: 'custom',
        path: ['executionTrackOverride'],
        message: 'Only executable steps can declare an execution track override',
      });
    }
    if (step.candidateMenuProjection !== undefined && step.action === null) {
      context.addIssue({
        code: 'custom',
        path: ['candidateMenuProjection'],
        message: 'Only executable steps can carry a candidate menu projection',
      });
    }
    if (step.observationPolicy?.mode === 'success_gate' && step.expectedObservations.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['expectedObservations'],
        message: 'A success-gated step requires at least one expected observation',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { required: ['observationPolicy'] },
        then: { properties: { action: { type: 'object' } } },
      },
      {
        if: { required: ['executionTrackOverride'] },
        then: { properties: { action: { type: 'object' } } },
      },
      {
        if: { required: ['candidateMenuProjection'] },
        then: { properties: { action: { type: 'object' } } },
      },
      {
        if: {
          properties: {
            observationPolicy: {
              properties: { mode: { const: 'success_gate' } },
              required: ['mode'],
            },
          },
          required: ['observationPolicy'],
        },
        then: { properties: { expectedObservations: { minItems: 1 } } },
      },
    ],
  });
export type GuideStep = z.infer<typeof guideStepSchema>;

export const guidePlanSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    id: z.string().min(1),
    revision: z.number().int().positive(),
    title: z.string().min(1),
    rootStepId: guideStepIdSchema,
    steps: z.array(guideStepSchema).min(1),
  })
  .superRefine((plan, context) => {
    const supportsObservationPolicies =
      plan.protocolVersion === '1.2.0' ||
      plan.protocolVersion === '1.3.0' ||
      plan.protocolVersion === '1.4.0' ||
      plan.protocolVersion === '1.5.0' ||
      plan.protocolVersion === '1.6.0' ||
      plan.protocolVersion === '1.7.0';
    const parentIds = new Set(
      plan.steps.flatMap((step) => (step.parentId === null ? [] : [step.parentId])),
    );
    for (const [index, step] of plan.steps.entries()) {
      if (
        step.executionTrackOverride !== undefined &&
        plan.protocolVersion !== '1.6.0' &&
        plan.protocolVersion !== '1.7.0'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'executionTrackOverride'],
          message: 'Execution track overrides require guide protocol 1.6',
        });
      }
      if (step.executionTrackOverride !== undefined && parentIds.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'executionTrackOverride'],
          message: 'Only leaf steps can declare an execution track override',
        });
      }
      if (step.candidateMenuProjection !== undefined && plan.protocolVersion !== '1.7.0') {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'candidateMenuProjection'],
          message: 'Candidate menu projections require guide protocol 1.7',
        });
      }
      if (step.candidateMenuProjection !== undefined && parentIds.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'candidateMenuProjection'],
          message: 'Only leaf steps can carry a candidate menu projection',
        });
      }
      if (step.observationPolicy !== undefined && !supportsObservationPolicies) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'observationPolicy'],
          message: 'Observation policies require guide protocol 1.2+',
        });
      }
      if (
        step.observationPolicy !== undefined &&
        step.observationPolicy.mode === 'success_gate' &&
        step.observationPolicy.retryPolicy !== undefined &&
        plan.protocolVersion !== '1.5.0' &&
        plan.protocolVersion !== '1.6.0' &&
        plan.protocolVersion !== '1.7.0'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'observationPolicy', 'retryPolicy'],
          message: 'Automatic Observation retries require guide protocol 1.5+',
        });
      }
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            protocolVersion: {
              enum: ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
            },
          },
          required: ['protocolVersion'],
        },
        else: {
          properties: {
            steps: { items: { not: { required: ['observationPolicy'] } } },
          },
        },
      },
      {
        if: {
          properties: { protocolVersion: { enum: ['1.6.0', '1.7.0'] } },
          required: ['protocolVersion'],
        },
        else: {
          properties: {
            steps: { items: { not: { required: ['executionTrackOverride'] } } },
          },
        },
      },
      {
        if: {
          properties: { protocolVersion: { const: '1.7.0' } },
          required: ['protocolVersion'],
        },
        else: {
          properties: {
            steps: { items: { not: { required: ['candidateMenuProjection'] } } },
          },
        },
      },
      {
        if: {
          properties: {
            protocolVersion: { enum: ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0'] },
          },
          required: ['protocolVersion'],
        },
        then: {
          properties: {
            steps: {
              items: {
                properties: {
                  observationPolicy: { not: { required: ['retryPolicy'] } },
                },
              },
            },
          },
        },
      },
    ],
  });
export type GuidePlan = z.infer<typeof guidePlanSchema>;
