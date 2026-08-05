import { isDeepStrictEqual } from 'node:util';

import {
  localReplanLocalityReportSchema,
  localReplanScopePolicyVersion,
  localReplanScopeSchema,
  type GuidePlan,
  type GuidePlanDiff,
  type GuideRevisionRequest,
  type GuideStep,
  type LocalReplanFindingCode,
  type LocalReplanLocalityReport,
  type LocalReplanScope,
} from '@operatingline/protocol';

import { computeGuidePlanDiff } from './guide-plan-diff.js';
import { validateGuidePlanStructure } from './guide-validation.js';

export interface LocalReplanScopeEvaluation {
  readonly scope: LocalReplanScope;
  readonly locality: LocalReplanLocalityReport;
  readonly planDiff: GuidePlanDiff | null;
}

interface LocalityFinding {
  readonly code: LocalReplanFindingCode;
  readonly message: string;
  readonly stepIds: readonly string[];
}

function stepMap(plan: GuidePlan): ReadonlyMap<string, GuideStep> {
  return new Map(plan.steps.map((step) => [step.id, step] as const));
}

function ancestorIds(stepId: string, steps: ReadonlyMap<string, GuideStep>): readonly string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>([stepId]);
  let parentId = steps.get(stepId)?.parentId ?? null;
  while (parentId !== null && !visited.has(parentId)) {
    ancestors.push(parentId);
    visited.add(parentId);
    parentId = steps.get(parentId)?.parentId ?? null;
  }
  return ancestors;
}

function owningScopeRoot(
  stepId: string,
  steps: ReadonlyMap<string, GuideStep>,
  normalizedRoots: ReadonlySet<string>,
): string | null {
  if (normalizedRoots.has(stepId)) {
    return stepId;
  }
  return ancestorIds(stepId, steps).find((ancestorId) => normalizedRoots.has(ancestorId)) ?? null;
}

export function normalizeLocalReplanRoots(request: GuideRevisionRequest): readonly string[] {
  const baseSteps = stepMap(request.basePlan);
  const referenced = new Set(request.references.map((reference) => reference.nodeId));
  return request.references
    .map((reference) => reference.nodeId)
    .filter(
      (stepId) => !ancestorIds(stepId, baseSteps).some((ancestorId) => referenced.has(ancestorId)),
    );
}

export function createLocalReplanScope(request: GuideRevisionRequest): LocalReplanScope {
  return localReplanScopeSchema.parse({
    policyVersion: localReplanScopePolicyVersion,
    mode: 'referenced_subtrees',
    referencedRootIds: request.references.map((reference) => reference.nodeId),
    normalizedRootIds: normalizeLocalReplanRoots(request),
    rules: {
      completePlanRequired: true,
      planTitleMutable: false,
      rootStepIdMutable: false,
      outsideScopeMutable: false,
      referencedRootAttachmentMutable: false,
      descendantMoves: 'within_same_normalized_root',
      newSteps: 'within_normalized_roots',
      noOpAllowed: false,
    },
  });
}

function isEmptyDiff(diff: GuidePlanDiff): boolean {
  return diff.planChanges.length === 0 && diff.stepChanges.length === 0;
}

export function evaluateLocalReplanScope(
  request: GuideRevisionRequest,
  targetPlan: GuidePlan,
): LocalReplanScopeEvaluation {
  const scope = createLocalReplanScope(request);
  const findings: LocalityFinding[] = [];
  const addFinding = (
    code: LocalReplanFindingCode,
    message: string,
    stepIds: readonly string[] = [],
  ): void => {
    const normalizedStepIds = [...new Set(stepIds)].sort();
    if (
      findings.some(
        (finding) =>
          finding.code === code &&
          finding.stepIds.length === normalizedStepIds.length &&
          finding.stepIds.every((stepId, index) => stepId === normalizedStepIds[index]),
      )
    ) {
      return;
    }
    findings.push({ code, message, stepIds: normalizedStepIds });
  };

  try {
    validateGuidePlanStructure(targetPlan);
  } catch {
    addFinding(
      'plan_structure_invalid',
      'The complete replanned GuidePlan has an invalid tree or dependency structure.',
    );
  }

  if (targetPlan.title !== request.basePlan.title) {
    addFinding('plan_title_changed', 'Local replanning cannot change the GuidePlan title.');
  }
  if (targetPlan.rootStepId !== request.basePlan.rootStepId) {
    addFinding('root_step_changed', 'Local replanning cannot change the GuidePlan rootStepId.');
  }

  const baseSteps = stepMap(request.basePlan);
  const targetSteps = stepMap(targetPlan);
  for (const rootId of scope.normalizedRootIds) {
    const before = baseSteps.get(rootId);
    const after = targetSteps.get(rootId);
    if (before === undefined || after === undefined) {
      addFinding(
        'scope_root_missing',
        `Referenced scope root ${rootId} must remain in the complete replanned Plan.`,
        [rootId],
      );
      continue;
    }
    if (before.parentId !== after.parentId || before.order !== after.order) {
      addFinding(
        'scope_root_attachment_changed',
        `Referenced scope root ${rootId} cannot change parentId or order.`,
        [rootId],
      );
    }
  }

  let planDiff: GuidePlanDiff | null = null;
  if (!findings.some((finding) => finding.code === 'plan_structure_invalid')) {
    planDiff = computeGuidePlanDiff(request.basePlan, targetPlan);
    if (isEmptyDiff(planDiff)) {
      addFinding(
        'no_local_change',
        'Local replanning must make at least one reviewable Plan or step change.',
      );
    }

    const normalizedRoots = new Set(scope.normalizedRootIds);
    const baseOwners = new Map<string, string>();
    for (const stepId of baseSteps.keys()) {
      const owner = owningScopeRoot(stepId, baseSteps, normalizedRoots);
      if (owner !== null) {
        baseOwners.set(stepId, owner);
      }
    }

    for (const [stepId, before] of baseSteps) {
      const owner = baseOwners.get(stepId);
      const after = targetSteps.get(stepId);
      if (owner === undefined) {
        if (after === undefined || !isDeepStrictEqual(before, after)) {
          addFinding(
            'step_changed_outside_scope',
            `Step ${stepId} is outside every referenced subtree and must remain unchanged.`,
            [stepId],
          );
        }
        continue;
      }
      if (stepId === owner || after === undefined) {
        continue;
      }
      const targetOwner = owningScopeRoot(stepId, targetSteps, normalizedRoots);
      if (targetOwner !== owner) {
        addFinding(
          'step_moved_across_scope',
          `Step ${stepId} cannot move outside its normalized referenced subtree ${owner}.`,
          [stepId, owner, ...(targetOwner === null ? [] : [targetOwner])],
        );
      }
    }

    for (const stepId of targetSteps.keys()) {
      if (baseSteps.has(stepId)) {
        continue;
      }
      if (owningScopeRoot(stepId, targetSteps, normalizedRoots) === null) {
        addFinding(
          'step_added_outside_scope',
          `New step ${stepId} must be attached inside a normalized referenced subtree.`,
          [stepId],
        );
      }
    }
  }

  const locality = localReplanLocalityReportSchema.parse({
    policyVersion: localReplanScopePolicyVersion,
    basePlan: { id: request.basePlan.id, revision: request.basePlan.revision },
    targetPlan: { id: targetPlan.id, revision: targetPlan.revision },
    scopeRootIds: scope.normalizedRootIds,
    valid: findings.length === 0,
    findings,
  });
  return { scope, locality, planDiff };
}
