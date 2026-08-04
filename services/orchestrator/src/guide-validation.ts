import { validateExecutableTaskPlan } from '@operatingline/domain';
import type { GuidePlan } from '@operatingline/protocol';

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
