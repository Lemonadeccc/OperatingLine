import { validateExecutableTaskPlan } from '@operatingline/domain';
import type { ActionCatalog, GuidePlan } from '@operatingline/protocol';

export function validateGuidePlanStructure(plan: GuidePlan): string | null {
  const root = plan.steps.find((step) => step.id === plan.rootStepId);
  if (!root || root.parentId !== null) {
    throw new Error('Guide plan rootStepId must reference a root step');
  }

  const taskNodes = plan.steps.map((step) => ({
    id: step.id,
    parentId: step.parentId,
    order: step.order,
    dependsOn: step.dependsOn,
    title: step.title,
    intent: step.intent,
    status: step.state,
  }));
  const structure = validateExecutableTaskPlan(
    taskNodes,
    new Set(plan.steps.filter((step) => step.action !== null).map((step) => step.id)),
  );
  if (!structure.valid) {
    throw new Error(`Invalid guide plan: ${structure.errors.join('; ')}`);
  }

  const actionAdapterIds = new Set(
    plan.steps.flatMap((step) => (step.action === null ? [] : [step.action.adapterId])),
  );
  if (actionAdapterIds.size > 1) {
    throw new Error('Companion protocol v1 guide plans must target a single action adapter');
  }
  return actionAdapterIds.values().next().value ?? null;
}

export function validateProposalTarget(plan: GuidePlan, targetAdapterId: string): void {
  const actionAdapterId = validateGuidePlanStructure(plan);
  if (actionAdapterId !== null && actionAdapterId !== targetAdapterId) {
    throw new Error(
      `Guide plan actions target adapter ${actionAdapterId}, not proposal target ${targetAdapterId}`,
    );
  }
}

export function validateGuidePlanAgainstActionCatalog(
  plan: GuidePlan,
  catalog: ActionCatalog,
): void {
  const entries = new Map(catalog.actions.map((action) => [action.name, action]));
  for (const step of plan.steps) {
    if (step.action === null) {
      continue;
    }
    const entry = entries.get(step.action.name);
    if (entry === undefined) {
      throw new Error(
        `Guide step ${step.id} uses action ${step.action.name}, which is absent from ${catalog.adapterId}@${catalog.catalogVersion}`,
      );
    }

    const argumentNames = new Set(Object.keys(step.action.arguments));
    const declaredNames = new Set(Object.keys(entry.argumentsSchema.properties));
    const missingNames = (entry.argumentsSchema.required ?? []).filter(
      (name) => !argumentNames.has(name),
    );
    const unknownNames = [...argumentNames].filter((name) => !declaredNames.has(name));
    if (missingNames.length > 0 || unknownNames.length > 0) {
      const details = [
        missingNames.length > 0 ? `missing ${missingNames.sort().join(', ')}` : null,
        unknownNames.length > 0 ? `unknown ${unknownNames.sort().join(', ')}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join('; ');
      throw new Error(`Guide step ${step.id} arguments violate ${step.action.name}: ${details}`);
    }

    if (!entry.rollbackModes.includes(step.rollback.mode)) {
      throw new Error(
        `Guide step ${step.id} rollback mode ${step.rollback.mode} is unsupported by ${step.action.name}`,
      );
    }
    for (const anchor of step.anchors) {
      if (!entry.supportedAnchorKinds.includes(anchor.kind)) {
        throw new Error(
          `Guide step ${step.id} anchor kind ${anchor.kind} is unsupported by ${step.action.name}`,
        );
      }
    }
    for (const observation of step.expectedObservations) {
      if (!entry.supportedObservationKinds.includes(observation.kind)) {
        throw new Error(
          `Guide step ${step.id} observation ${observation.kind} is unsupported by ${step.action.name}`,
        );
      }
    }
  }
}
