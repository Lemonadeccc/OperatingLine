import {
  guidePlanDiffSchema,
  type GuidePlan,
  type GuidePlanDiff,
  type GuideStep,
  type GuideStepField,
} from '@operatingline/protocol';

import { guidePlanNodeNumbers, validateGuidePlanStructure } from './guide-validation.js';

const planFields = ['title', 'rootStepId'] as const;
const stepFields = [
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
] as const satisfies readonly GuideStepField[];

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return candidate;
  };
  const serialized = JSON.stringify(normalize(value === undefined ? null : value));
  if (serialized === undefined) {
    throw new Error('Guide plan diff values must be JSON serializable');
  }
  return serialized;
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(canonicalJson(value)) as unknown;
}

function snapshot(step: GuideStep, nodeNumber: string) {
  return {
    stepId: step.id,
    nodeNumber,
    parentId: step.parentId,
    order: step.order,
    title: step.title,
  };
}

/**
 * Compute a deterministic, host-neutral review summary between two immutable
 * revisions. Added/updated nodes follow target DFS order; removed nodes follow
 * base DFS order. Exact before/after values remain JSON data, not display text.
 */
export function computeGuidePlanDiff(basePlan: GuidePlan, targetPlan: GuidePlan): GuidePlanDiff {
  validateGuidePlanStructure(basePlan);
  validateGuidePlanStructure(targetPlan);
  if (basePlan.id !== targetPlan.id) {
    throw new Error(`Guide plan diff ids must match: ${basePlan.id} != ${targetPlan.id}`);
  }
  if (targetPlan.revision <= basePlan.revision) {
    throw new Error(
      `Guide plan diff target revision ${targetPlan.revision} must be newer than ${basePlan.revision}`,
    );
  }

  const baseNumbers = guidePlanNodeNumbers(basePlan);
  const targetNumbers = guidePlanNodeNumbers(targetPlan);
  const baseSteps = new Map(basePlan.steps.map((step) => [step.id, step] as const));
  const targetSteps = new Map(targetPlan.steps.map((step) => [step.id, step] as const));
  const planChanges = planFields.flatMap((field) =>
    canonicalJson(basePlan[field]) === canonicalJson(targetPlan[field])
      ? []
      : [
          {
            field,
            before: jsonValue(basePlan[field]),
            after: jsonValue(targetPlan[field]),
          },
        ],
  );
  const stepChanges: Array<Record<string, unknown>> = [];

  for (const stepId of targetNumbers.keys()) {
    const after = targetSteps.get(stepId);
    const afterNumber = targetNumbers.get(stepId);
    if (after === undefined || afterNumber === undefined) {
      throw new Error(`Target guide plan traversal lost step ${stepId}`);
    }
    const before = baseSteps.get(stepId);
    if (before === undefined) {
      stepChanges.push({ kind: 'added', stepId, after: snapshot(after, afterNumber) });
      continue;
    }

    const changes = stepFields.flatMap((field) =>
      canonicalJson(before[field]) === canonicalJson(after[field])
        ? []
        : [
            {
              field,
              before: jsonValue(before[field]),
              after: jsonValue(after[field]),
            },
          ],
    );
    if (changes.length === 0) {
      continue;
    }
    const beforeNumber = baseNumbers.get(stepId);
    if (beforeNumber === undefined) {
      throw new Error(`Base guide plan traversal lost step ${stepId}`);
    }
    stepChanges.push({
      kind: 'updated',
      stepId,
      before: snapshot(before, beforeNumber),
      after: snapshot(after, afterNumber),
      changes,
    });
  }

  for (const stepId of baseNumbers.keys()) {
    if (targetSteps.has(stepId)) {
      continue;
    }
    const before = baseSteps.get(stepId);
    const beforeNumber = baseNumbers.get(stepId);
    if (before === undefined || beforeNumber === undefined) {
      throw new Error(`Base guide plan traversal lost removed step ${stepId}`);
    }
    stepChanges.push({ kind: 'removed', stepId, before: snapshot(before, beforeNumber) });
  }

  const addedSteps = stepChanges.filter((change) => change.kind === 'added').length;
  const removedSteps = stepChanges.filter((change) => change.kind === 'removed').length;
  const updatedSteps = stepChanges.filter((change) => change.kind === 'updated').length;
  const movedSteps = stepChanges.filter(
    (change) =>
      change.kind === 'updated' &&
      Array.isArray(change.changes) &&
      change.changes.some(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          'field' in candidate &&
          (candidate.field === 'parentId' || candidate.field === 'order'),
      ),
  ).length;

  return guidePlanDiffSchema.parse({
    basePlan: { id: basePlan.id, revision: basePlan.revision },
    targetPlan: { id: targetPlan.id, revision: targetPlan.revision },
    summary: {
      planFields: planChanges.length,
      addedSteps,
      removedSteps,
      updatedSteps,
      movedSteps,
    },
    planChanges,
    stepChanges,
  });
}
