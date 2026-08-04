import {
  actionCatalogSchema,
  guideProtocolVersion,
  planningQualityBaselineVersion,
  planningQualityEvaluationRequestSchema,
  planningQualityReportSchema,
  type ActionCatalog,
  type GuidePlan,
  type GuideStep,
  type PlanningQualityEvaluationRequest,
  type PlanningQualityFinding,
  type PlanningQualityReport,
} from '@operatingline/protocol';

import {
  validateGuidePlanAgainstActionCatalog,
  validateProposalTarget,
} from './guide-validation.js';

function valuesAtArgumentPath(
  argumentsValue: Record<string, unknown>,
  argumentPath: string,
): unknown[] {
  if (argumentPath.startsWith('$managed.')) {
    return [argumentPath.slice('$managed.'.length)];
  }
  let values: unknown[] = [argumentsValue];
  for (const rawSegment of argumentPath.split('.')) {
    const expandsArray = rawSegment.endsWith('[]');
    const segment = expandsArray ? rawSegment.slice(0, -2) : rawSegment;
    const nextValues: unknown[] = [];
    for (const value of values) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const child = (value as Record<string, unknown>)[segment];
      if (expandsArray) {
        if (Array.isArray(child)) {
          nextValues.push(...child);
        }
      } else if (child !== undefined) {
        nextValues.push(child);
      }
    }
    values = nextValues;
  }
  return values;
}

function directRootChild(
  step: GuideStep,
  rootStepId: string,
  stepsById: ReadonlyMap<string, GuideStep>,
): GuideStep | null {
  let current = step;
  while (current.parentId !== rootStepId) {
    if (current.parentId === null) {
      return null;
    }
    const parent = stepsById.get(current.parentId);
    if (parent === undefined) {
      return null;
    }
    current = parent;
  }
  return current;
}

function dependencyAncestors(plan: GuidePlan): ReadonlyMap<string, ReadonlySet<string>> {
  const dependencies = new Map(plan.steps.map((step) => [step.id, step.dependsOn]));
  const memo = new Map<string, ReadonlySet<string>>();
  const collect = (stepId: string): ReadonlySet<string> => {
    const cached = memo.get(stepId);
    if (cached !== undefined) {
      return cached;
    }
    const result = new Set<string>();
    for (const dependency of dependencies.get(stepId) ?? []) {
      result.add(dependency);
      for (const ancestor of collect(dependency)) {
        result.add(ancestor);
      }
    }
    memo.set(stepId, result);
    return result;
  };
  for (const step of plan.steps) {
    collect(step.id);
  }
  return memo;
}

function sortedFindings(findings: PlanningQualityFinding[]): PlanningQualityFinding[] {
  return findings.sort(
    (left, right) =>
      (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1) ||
      left.code.localeCompare(right.code) ||
      left.stepIds.join(',').localeCompare(right.stepIds.join(',')) ||
      left.message.localeCompare(right.message),
  );
}

export function evaluatePlanningQuality(
  input: PlanningQualityEvaluationRequest,
  catalogInput: ActionCatalog,
): PlanningQualityReport {
  const request = planningQualityEvaluationRequestSchema.parse(input);
  const catalog = actionCatalogSchema.parse(catalogInput);
  if (catalog.adapterId !== request.targetAdapterId) {
    throw new Error(
      `Planning quality catalog targets ${catalog.adapterId}, not ${request.targetAdapterId}`,
    );
  }
  if (request.catalogVersion !== undefined && request.catalogVersion !== catalog.catalogVersion) {
    throw new Error(
      `Planning quality catalog ${catalog.catalogVersion} does not match requested ${request.catalogVersion}`,
    );
  }

  const findings: PlanningQualityFinding[] = [];
  const findingKeys = new Set<string>();
  const addFinding = (finding: PlanningQualityFinding): void => {
    const key = JSON.stringify(finding);
    if (!findingKeys.has(key)) {
      findingKeys.add(key);
      findings.push(finding);
    }
  };

  let structureValid = true;
  try {
    validateProposalTarget(request.plan, request.targetAdapterId);
  } catch (error) {
    structureValid = false;
    addFinding({
      code: 'plan.structure',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Guide plan structure is invalid',
      stepIds: [],
      phaseIds: [],
    });
  }
  let catalogValid = true;
  try {
    validateGuidePlanAgainstActionCatalog(request.plan, catalog);
  } catch (error) {
    catalogValid = false;
    addFinding({
      code: 'plan.catalog_contract',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Guide plan violates the action catalog',
      stepIds: [],
      phaseIds: [],
    });
  }

  const requiredPhaseIds = new Set(request.requiredPhaseIds);
  const planningPhases = [...(catalog.planningPhases ?? [])].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  const knownPhaseIds = new Set(planningPhases.map((phase) => phase.id));
  for (const requiredPhaseId of request.requiredPhaseIds) {
    if (!knownPhaseIds.has(requiredPhaseId)) {
      addFinding({
        code: 'phase.unknown_required',
        severity: 'error',
        message: `Required planning phase ${requiredPhaseId} is absent from ${catalog.adapterId}@${catalog.catalogVersion}`,
        stepIds: [],
        phaseIds: [requiredPhaseId],
      });
    }
  }

  const actionPhaseIds = new Map<string, string>();
  const phaseActionStepIds = new Map<string, Set<string>>();
  const phaseGroupStepIds = new Map<string, Set<string>>();
  for (const phase of planningPhases) {
    phaseActionStepIds.set(phase.id, new Set());
    phaseGroupStepIds.set(phase.id, new Set());
    for (const actionName of phase.actionNames) {
      actionPhaseIds.set(actionName, phase.id);
    }
  }

  const executableSteps = request.plan.steps.filter(
    (step): step is GuideStep & { action: NonNullable<GuideStep['action']> } =>
      step.action !== null,
  );
  const stepsById = new Map(request.plan.steps.map((step) => [step.id, step]));

  if (planningPhases.length === 0) {
    addFinding({
      code: 'phase.profile_unavailable',
      severity: request.requiredPhaseIds.length > 0 ? 'error' : 'warning',
      message: `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} has no planning phase profile`,
      stepIds: [],
      phaseIds: request.requiredPhaseIds,
    });
  } else if (structureValid && catalogValid) {
    const groupPhases = new Map<string, Set<string>>();
    for (const step of executableSteps) {
      const phaseId = actionPhaseIds.get(step.action.name);
      if (phaseId === undefined) {
        addFinding({
          code: 'phase.unclassified_action',
          severity: 'error',
          message: `Action ${step.action.name} has no planning phase`,
          stepIds: [step.id],
          phaseIds: [],
        });
        continue;
      }
      phaseActionStepIds.get(phaseId)?.add(step.id);
      const group = directRootChild(step, request.plan.rootStepId, stepsById);
      if (group === null || group.action !== null) {
        addFinding({
          code: 'phase.missing_group',
          severity: 'error',
          message: `Executable step ${step.id} must be nested under a root-level phase group`,
          stepIds: [step.id],
          phaseIds: [phaseId],
        });
        continue;
      }
      const phases = groupPhases.get(group.id) ?? new Set<string>();
      phases.add(phaseId);
      groupPhases.set(group.id, phases);
      phaseGroupStepIds.get(phaseId)?.add(group.id);
    }

    const orderedGroups = request.plan.steps
      .filter((step) => step.parentId === request.plan.rootStepId)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    let previousPhaseOrder = 0;
    for (const group of orderedGroups) {
      const groupPhaseIds = [...(groupPhases.get(group.id) ?? [])].sort();
      if (groupPhaseIds.length > 1) {
        addFinding({
          code: 'phase.mixed_group',
          severity: 'error',
          message: `Root group ${group.id} mixes planning phases ${groupPhaseIds.join(', ')}`,
          stepIds: [group.id],
          phaseIds: groupPhaseIds,
        });
        continue;
      }
      const phase = planningPhases.find((candidate) => candidate.id === groupPhaseIds[0]);
      if (phase === undefined) {
        continue;
      }
      if (phase.order < previousPhaseOrder) {
        addFinding({
          code: 'phase.order',
          severity: 'error',
          message: `Root group ${group.id} places phase ${phase.id} after a later phase`,
          stepIds: [group.id],
          phaseIds: [phase.id],
        });
      }
      previousPhaseOrder = Math.max(previousPhaseOrder, phase.order);
    }

    for (const phase of planningPhases) {
      if (requiredPhaseIds.has(phase.id) && phaseActionStepIds.get(phase.id)?.size === 0) {
        addFinding({
          code: 'phase.required_missing',
          severity: 'error',
          message: `Plan does not implement required phase ${phase.id}`,
          stepIds: [],
          phaseIds: [phase.id],
        });
      }
    }

    const catalogEntries = new Map(catalog.actions.map((action) => [action.name, action]));
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      const phaseId = actionPhaseIds.get(step.action.name);
      if (step.anchors.length === 0) {
        addFinding({
          code: 'guidance.anchor_missing',
          severity: 'error',
          message: `Executable step ${step.id} has no semantic guidance anchor`,
          stepIds: [step.id],
          phaseIds: phaseId === undefined ? [] : [phaseId],
        });
      }
      if (
        (entry?.supportedObservationKinds.length ?? 0) > 0 &&
        step.expectedObservations.length === 0
      ) {
        addFinding({
          code: 'guidance.observation_missing',
          severity: 'error',
          message: `Executable step ${step.id} has no expected observation`,
          stepIds: [step.id],
          phaseIds: phaseId === undefined ? [] : [phaseId],
        });
      }
    }

    const creators = new Map<string, Set<string>>();
    const managedResourceIds = new Set<string>();
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      for (const effect of entry?.resourceEffects ?? []) {
        if (effect.access !== 'create' && effect.access !== 'artifact') {
          continue;
        }
        const resourceIds = valuesAtArgumentPath(step.action.arguments, effect.argumentPath).filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        );
        for (const resourceId of resourceIds) {
          const stepIds = creators.get(resourceId) ?? new Set<string>();
          stepIds.add(step.id);
          creators.set(resourceId, stepIds);
          if (effect.argumentPath.startsWith('$managed.')) {
            managedResourceIds.add(resourceId);
          }
        }
      }
    }
    for (const [resourceId, stepIds] of creators) {
      if (stepIds.size > 1 && !managedResourceIds.has(resourceId)) {
        addFinding({
          code: 'resource.duplicate_creator',
          severity: 'error',
          message: `Logical resource ${resourceId} is created by multiple steps`,
          stepIds: [...stepIds].sort(),
          phaseIds: [],
        });
      }
    }

    const ancestors = dependencyAncestors(request.plan);
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      const consumedResourceIds = new Set<string>();
      for (const effect of entry?.resourceEffects ?? []) {
        if (effect.access !== 'read' && effect.access !== 'mutate') {
          continue;
        }
        for (const value of valuesAtArgumentPath(step.action.arguments, effect.argumentPath)) {
          if (typeof value === 'string' && value.length > 0) {
            consumedResourceIds.add(value);
          }
        }
      }
      for (const resourceId of [...consumedResourceIds].sort()) {
        const creatorStepIds = creators.get(resourceId);
        if (creatorStepIds === undefined || creatorStepIds.size === 0) {
          addFinding({
            code: 'resource.missing_creator',
            severity: 'error',
            message: `Step ${step.id} consumes logical resource ${resourceId} without a plan creator`,
            stepIds: [step.id],
            phaseIds: [],
          });
          continue;
        }
        const dependencySet = ancestors.get(step.id) ?? new Set<string>();
        if (![...creatorStepIds].some((creatorStepId) => dependencySet.has(creatorStepId))) {
          addFinding({
            code: 'resource.missing_dependency',
            severity: 'error',
            message: `Step ${step.id} must depend on a creator of logical resource ${resourceId}`,
            stepIds: [step.id, ...creatorStepIds].sort(),
            phaseIds: [],
          });
        }
      }
    }
  }

  const phases = planningPhases.map((phase) => {
    const actionStepIds = [...(phaseActionStepIds.get(phase.id) ?? [])].sort();
    return {
      phaseId: phase.id,
      order: phase.order,
      title: phase.title,
      required: requiredPhaseIds.has(phase.id),
      used: actionStepIds.length > 0,
      groupStepIds: [...(phaseGroupStepIds.get(phase.id) ?? [])].sort(),
      actionStepIds,
    };
  });
  const orderedFindings = sortedFindings(findings);
  const errorCount = orderedFindings.filter((finding) => finding.severity === 'error').length;
  return planningQualityReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    baselineVersion: planningQualityBaselineVersion,
    targetAdapterId: request.targetAdapterId,
    catalogVersion: catalog.catalogVersion,
    goal: request.goal ?? null,
    plan: { id: request.plan.id, revision: request.plan.revision },
    requiredPhaseIds: request.requiredPhaseIds,
    valid: errorCount === 0,
    summary: {
      errorCount,
      warningCount: orderedFindings.length - errorCount,
      executableStepCount: executableSteps.length,
      groupStepCount: request.plan.steps.length - executableSteps.length,
      usedPhaseCount: phases.filter((phase) => phase.used).length,
      requiredPhaseCount: request.requiredPhaseIds.length,
    },
    phases,
    findings: orderedFindings,
  });
}
