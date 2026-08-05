import { isDeepStrictEqual } from 'node:util';

import { validateExecutableTaskPlan } from '@operatingline/domain';
import type {
  ActionCatalog,
  GuidePlan,
  GuideProposal,
  GuideProposalDecision,
  GuideRevisionRequest,
} from '@operatingline/protocol';
import { validateActionArguments } from '@operatingline/protocol';

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

    const argumentErrors = validateActionArguments(step.action.arguments, entry.argumentsSchema);
    if (argumentErrors.length > 0) {
      throw new Error(
        `Guide step ${step.id} arguments violate ${step.action.name}: ${argumentErrors.join('; ')}`,
      );
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

export function guidePlanNodeNumbers(plan: GuidePlan): ReadonlyMap<string, string> {
  validateGuidePlanStructure(plan);
  const children = new Map<string | null, GuidePlan['steps']>();
  for (const step of plan.steps) {
    const siblings = children.get(step.parentId) ?? [];
    siblings.push(step);
    children.set(step.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  }

  const numbers = new Map<string, string>();
  const visit = (stepId: string, number: string): void => {
    numbers.set(stepId, number);
    for (const [index, child] of (children.get(stepId) ?? []).entries()) {
      visit(child.id, `${number}.${index + 1}`);
    }
  };
  visit(plan.rootStepId, '1');
  return numbers;
}

export function validateGuideRevisionRequest(
  request: GuideRevisionRequest,
  catalog: ActionCatalog,
): void {
  validateProposalTarget(request.basePlan, request.adapterId);
  validateGuidePlanAgainstActionCatalog(request.basePlan, catalog);
  const numbers = guidePlanNodeNumbers(request.basePlan);
  const referencedNodeIds = new Set<string>();
  for (const reference of request.references) {
    if (referencedNodeIds.has(reference.nodeId)) {
      throw new Error(`Guide revision request repeats node ${reference.nodeId}`);
    }
    referencedNodeIds.add(reference.nodeId);
    const expectedNumber = numbers.get(reference.nodeId);
    if (expectedNumber === undefined) {
      throw new Error(`Guide revision request references unknown node ${reference.nodeId}`);
    }
    if (reference.nodeNumber !== expectedNumber) {
      throw new Error(
        `Guide revision request node ${reference.nodeId} uses number ${reference.nodeNumber}; expected ${expectedNumber}`,
      );
    }
  }
}

export function validateGuideRevisionThread(
  request: GuideRevisionRequest,
  threadHead: GuideRevisionRequest | null,
  parentProposal: GuideProposal | null,
  parentDecision: GuideProposalDecision | null,
): void {
  const thread = request.revisionThread;
  if (thread === undefined) {
    return;
  }
  if (thread.turn === 1) {
    if (threadHead !== null) {
      throw new Error(`Guide revision thread already exists: ${thread.threadId}`);
    }
    return;
  }
  if (threadHead === null || threadHead.revisionThread === undefined) {
    throw new Error(`Unknown guide revision thread: ${thread.threadId}`);
  }
  if (
    threadHead.requestId !== thread.parentRequestId ||
    threadHead.revisionThread.threadId !== thread.threadId ||
    threadHead.revisionThread.turn + 1 !== thread.turn
  ) {
    throw new Error(
      `Guide revision turn ${thread.turn} must continue thread head ${threadHead.requestId} at turn ${threadHead.revisionThread.turn}`,
    );
  }
  if (
    threadHead.adapterId !== request.adapterId ||
    threadHead.instanceId !== request.instanceId ||
    threadHead.catalogVersion !== request.catalogVersion
  ) {
    throw new Error('A guide revision thread cannot change adapter, instance, or catalog version');
  }
  if (parentProposal === null || parentProposal.revisionRequestId !== threadHead.requestId) {
    throw new Error(`Guide revision thread parent has no linked proposal: ${threadHead.requestId}`);
  }
  if (
    parentDecision === null ||
    parentDecision.proposalId !== parentProposal.proposalId ||
    parentDecision.adapterId !== request.adapterId ||
    parentDecision.instanceId !== request.instanceId ||
    parentDecision.decision !== 'accepted'
  ) {
    throw new Error(
      `Guide revision thread parent proposal must be accepted in the same host instance: ${parentProposal.proposalId}`,
    );
  }
  if (!isDeepStrictEqual(parentProposal.plan, request.basePlan)) {
    throw new Error(
      'A continued revision request must use its parent proposal as the exact base plan',
    );
  }
}
