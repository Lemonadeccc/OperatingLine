import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guidePlanDiffSchema, guidePlanSchema } from '@operatingline/protocol';
import { computeGuidePlanDiff } from '@operatingline/orchestrator';

function snowmanPlan() {
  return guidePlanSchema.parse(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8')),
  );
}

describe('guide plan diff', () => {
  it('orders exact plan and parameter changes by target tree traversal', () => {
    const base = snowmanPlan();
    const headIndex = base.steps.findIndex((step) => step.id === 'snowman.model.head');
    const target = guidePlanSchema.parse({
      ...base,
      revision: base.revision + 1,
      title: 'Create a snowman with a larger head',
      steps: base.steps.map((step, index) =>
        index === headIndex
          ? {
              ...step,
              title: 'Create the larger head',
              action: {
                ...step.action,
                arguments: { ...step.action?.arguments, radius: 1.16 },
              },
            }
          : step,
      ),
    });

    const diff = computeGuidePlanDiff(base, target);

    expect(diff).toMatchObject({
      basePlan: { id: base.id, revision: base.revision },
      targetPlan: { id: target.id, revision: target.revision },
      summary: {
        planFields: 1,
        addedSteps: 0,
        removedSteps: 0,
        updatedSteps: 1,
        movedSteps: 0,
      },
      planChanges: [{ field: 'title', before: base.title, after: target.title }],
      stepChanges: [
        {
          kind: 'updated',
          stepId: 'snowman.model.head',
          before: { nodeNumber: '1.2.3' },
          after: { nodeNumber: '1.2.3' },
          changes: [
            { field: 'title', before: 'Create the head', after: 'Create the larger head' },
            {
              field: 'action',
              before: expect.objectContaining({
                arguments: expect.objectContaining({ radius: 0.85 }),
              }),
              after: expect.objectContaining({
                arguments: expect.objectContaining({ radius: 1.16 }),
              }),
            },
          ],
        },
      ],
    });
  });

  it('reports moves once and appends removals after target-ordered changes', () => {
    const base = snowmanPlan();
    const removedId = 'snowman.render.preview';
    const movedId = 'snowman.model.head';
    const target = guidePlanSchema.parse({
      ...base,
      revision: base.revision + 1,
      steps: base.steps
        .filter((step) => step.id !== removedId)
        .map((step) =>
          step.id === movedId ? { ...step, parentId: 'snowman', order: 99, dependsOn: [] } : step,
        ),
    });

    const diff = computeGuidePlanDiff(base, target);

    expect(diff.summary).toMatchObject({ removedSteps: 1, updatedSteps: 1, movedSteps: 1 });
    expect(diff.stepChanges.map((change) => [change.kind, change.stepId])).toEqual([
      ['updated', movedId],
      ['removed', removedId],
    ]);
  });

  it('returns an empty content diff for a revision-only successor and rejects invalid lineage', () => {
    const base = snowmanPlan();
    expect(computeGuidePlanDiff(base, { ...base, revision: base.revision + 1 })).toMatchObject({
      summary: {
        planFields: 0,
        addedSteps: 0,
        removedSteps: 0,
        updatedSteps: 0,
        movedSteps: 0,
      },
      planChanges: [],
      stepChanges: [],
    });
    expect(() => computeGuidePlanDiff(base, { ...base, id: 'other', revision: 99 })).toThrow(
      'ids must match',
    );
    expect(() => computeGuidePlanDiff(base, base)).toThrow('must be newer');
  });

  it('captures an observation policy removal as an explicit null value', () => {
    const base = snowmanPlan();
    const stepId = 'snowman.model.head';
    const target = guidePlanSchema.parse({
      ...base,
      revision: base.revision + 1,
      steps: base.steps.map((step) =>
        step.id === stepId ? { ...step, observationPolicy: undefined } : step,
      ),
    });

    const diff = computeGuidePlanDiff(base, target);

    expect(diff.stepChanges).toEqual([
      expect.objectContaining({
        kind: 'updated',
        stepId,
        changes: [
          {
            field: 'observationPolicy',
            before: { mode: 'success_gate', failureStrategy: 'rollback_step' },
            after: null,
          },
        ],
      }),
    ]);
  });

  it('rejects inconsistent portable diff envelopes at the protocol boundary', () => {
    const base = snowmanPlan();
    const diff = computeGuidePlanDiff(base, { ...base, revision: base.revision + 1 });
    expect(
      guidePlanDiffSchema.safeParse({
        ...diff,
        targetPlan: { id: 'different-plan', revision: diff.targetPlan.revision },
      }).success,
    ).toBe(false);
    expect(
      guidePlanDiffSchema.safeParse({
        ...diff,
        stepChanges: [
          {
            kind: 'added',
            stepId: 'new-step',
            after: {
              stepId: 'other-step',
              nodeNumber: '1-2',
              parentId: base.rootStepId,
              order: 1,
              title: 'New step',
            },
          },
        ],
        summary: { ...diff.summary, addedSteps: 1 },
      }).success,
    ).toBe(false);
  });
});
