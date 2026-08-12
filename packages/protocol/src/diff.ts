import { z } from 'zod';

import { guideNodeNumberSchema, guideStepIdSchema } from './guide.js';

export const guidePlanReferenceSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});
export type GuidePlanReference = z.infer<typeof guidePlanReferenceSchema>;

export const guidePlanFieldSchema = z.enum(['title', 'rootStepId']);
export type GuidePlanField = z.infer<typeof guidePlanFieldSchema>;

export const guideStepFieldSchema = z.enum([
  'parentId',
  'order',
  'dependsOn',
  'title',
  'intent',
  'explanation',
  'state',
  'action',
  'anchors',
  'expectedObservations',
  'observationPolicy',
  'rollback',
]);
export type GuideStepField = z.infer<typeof guideStepFieldSchema>;

const guideFieldChangeSchema = <T extends z.ZodType>(fieldSchema: T) =>
  z.strictObject({
    field: fieldSchema,
    before: z.json(),
    after: z.json(),
  });

export const guidePlanFieldChangeSchema = guideFieldChangeSchema(guidePlanFieldSchema);
export type GuidePlanFieldChange = z.infer<typeof guidePlanFieldChangeSchema>;

export const guideStepFieldChangeSchema = guideFieldChangeSchema(guideStepFieldSchema);
export type GuideStepFieldChange = z.infer<typeof guideStepFieldChangeSchema>;

export const guideDiffNodeSnapshotSchema = z.strictObject({
  stepId: guideStepIdSchema,
  nodeNumber: guideNodeNumberSchema,
  parentId: guideStepIdSchema.nullable(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
});
export type GuideDiffNodeSnapshot = z.infer<typeof guideDiffNodeSnapshotSchema>;

export const guideStepDiffSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('added'),
    stepId: guideStepIdSchema,
    after: guideDiffNodeSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('removed'),
    stepId: guideStepIdSchema,
    before: guideDiffNodeSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('updated'),
    stepId: guideStepIdSchema,
    before: guideDiffNodeSnapshotSchema,
    after: guideDiffNodeSnapshotSchema,
    changes: z.array(guideStepFieldChangeSchema).min(1),
  }),
]);
export type GuideStepDiff = z.infer<typeof guideStepDiffSchema>;

export const guidePlanDiffSchema = z
  .strictObject({
    basePlan: guidePlanReferenceSchema,
    targetPlan: guidePlanReferenceSchema,
    summary: z.strictObject({
      planFields: z.number().int().nonnegative(),
      addedSteps: z.number().int().nonnegative(),
      removedSteps: z.number().int().nonnegative(),
      updatedSteps: z.number().int().nonnegative(),
      movedSteps: z.number().int().nonnegative(),
    }),
    planChanges: z.array(guidePlanFieldChangeSchema),
    stepChanges: z.array(guideStepDiffSchema),
  })
  .superRefine((diff, context) => {
    const planFields = new Set(diff.planChanges.map((change) => change.field));
    const stepIds = new Set(diff.stepChanges.map((change) => change.stepId));
    const counts = {
      addedSteps: diff.stepChanges.filter((change) => change.kind === 'added').length,
      removedSteps: diff.stepChanges.filter((change) => change.kind === 'removed').length,
      updatedSteps: diff.stepChanges.filter((change) => change.kind === 'updated').length,
      movedSteps: diff.stepChanges.filter(
        (change) =>
          change.kind === 'updated' &&
          change.changes.some(
            (fieldChange) => fieldChange.field === 'parentId' || fieldChange.field === 'order',
          ),
      ).length,
    };

    if (diff.basePlan.id !== diff.targetPlan.id) {
      context.addIssue({ code: 'custom', message: 'Plan diff ids must match' });
    }
    if (diff.targetPlan.revision <= diff.basePlan.revision) {
      context.addIssue({ code: 'custom', message: 'Plan diff target revision must be newer' });
    }

    if (planFields.size !== diff.planChanges.length) {
      context.addIssue({ code: 'custom', message: 'Plan diff repeats a plan field' });
    }
    if (stepIds.size !== diff.stepChanges.length) {
      context.addIssue({ code: 'custom', message: 'Plan diff repeats a step id' });
    }
    if (diff.summary.planFields !== diff.planChanges.length) {
      context.addIssue({ code: 'custom', message: 'Plan diff plan-field summary is inconsistent' });
    }
    for (const field of Object.keys(counts) as Array<keyof typeof counts>) {
      if (diff.summary[field] !== counts[field]) {
        context.addIssue({
          code: 'custom',
          message: `Plan diff ${field} summary is inconsistent`,
        });
      }
    }
    for (const change of diff.stepChanges) {
      if (change.kind === 'added' && change.after.stepId !== change.stepId) {
        context.addIssue({
          code: 'custom',
          message: `Added plan diff snapshot must match step ${change.stepId}`,
        });
      }
      if (change.kind === 'removed' && change.before.stepId !== change.stepId) {
        context.addIssue({
          code: 'custom',
          message: `Removed plan diff snapshot must match step ${change.stepId}`,
        });
      }
      if (change.kind !== 'updated') {
        continue;
      }
      if (change.before.stepId !== change.stepId || change.after.stepId !== change.stepId) {
        context.addIssue({
          code: 'custom',
          message: `Updated plan diff snapshots must match step ${change.stepId}`,
        });
      }
      if (
        new Set(change.changes.map((fieldChange) => fieldChange.field)).size !==
        change.changes.length
      ) {
        context.addIssue({
          code: 'custom',
          message: `Plan diff step ${change.stepId} repeats a changed field`,
        });
      }
    }
  });
export type GuidePlanDiff = z.infer<typeof guidePlanDiffSchema>;
