import { z } from 'zod';

export const supportedGuideProtocolVersions = ['1.0.0', '1.1.0'] as const;
export const guideProtocolVersion = '1.1.0' as const;
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

export const guideStepSchema = z.strictObject({
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
  rollback: z.strictObject({
    mode: z.enum(['native_undo', 'checkpoint_restore', 'compensating_action', 'unsupported']),
    checkpointRequired: z.boolean(),
  }),
});
export type GuideStep = z.infer<typeof guideStepSchema>;

export const guidePlanSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  id: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string().min(1),
  rootStepId: guideStepIdSchema,
  steps: z.array(guideStepSchema).min(1),
});
export type GuidePlan = z.infer<typeof guidePlanSchema>;
