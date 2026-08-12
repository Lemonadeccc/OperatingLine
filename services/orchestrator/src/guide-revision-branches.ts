import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideRevisionBranchListSchema,
  guideRevisionRequestSchema,
  guideProtocolVersion,
  type ActionCatalog,
  type GuidePlan,
  type GuideProposal,
  type GuideRevisionBranchList,
  type GuideRevisionBranchListRequest,
  type GuideRevisionMergeContext,
  type GuideRevisionRequest,
  type GuideRevisionTurnState,
  type GuideStep,
} from '@operatingline/protocol';

import { computePlanContentSha256 } from './eval-export.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from './guide-validation.js';

const MISSING = Symbol('missing');
type MergeValue = unknown | typeof MISSING;

function isJsonRecord(value: MergeValue): value is Record<string, unknown> {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(record: Record<string, unknown>, key: string): MergeValue {
  return Object.hasOwn(record, key) ? record[key] : MISSING;
}

export interface GuidePlanMergeConflict {
  readonly path: string;
  readonly message: string;
}

export interface GuidePlanThreeWayMerge {
  readonly plan: GuidePlan;
  readonly conflicts: readonly GuidePlanMergeConflict[];
  readonly changed: boolean;
}

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
] as const satisfies readonly (keyof GuideStep)[];

function mergeValue(
  path: string,
  ancestor: MergeValue,
  target: MergeValue,
  source: MergeValue,
  conflicts: GuidePlanMergeConflict[],
): MergeValue {
  if (isDeepStrictEqual(target, source)) {
    return cloneMergeValue(target);
  }
  if (isDeepStrictEqual(target, ancestor)) {
    return cloneMergeValue(source);
  }
  if (isDeepStrictEqual(source, ancestor)) {
    return cloneMergeValue(target);
  }
  if (isJsonRecord(ancestor) && isJsonRecord(target) && isJsonRecord(source)) {
    const merged = structuredClone(target);
    const keys = new Set([
      ...Object.keys(ancestor),
      ...Object.keys(target),
      ...Object.keys(source),
    ]);
    for (const key of keys) {
      const value = mergeValue(
        `${path}.${key}`,
        recordValue(ancestor, key),
        recordValue(target, key),
        recordValue(source, key),
        conflicts,
      );
      if (value === MISSING) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }
  conflicts.push({
    path,
    message: `Target and source changed ${path} differently from their common ancestor`,
  });
  return cloneMergeValue(target);
}

function cloneMergeValue<T extends MergeValue>(value: T): T {
  return value === MISSING ? value : (structuredClone(value) as T);
}

function mergeStep(
  stepId: string,
  ancestor: GuideStep | undefined,
  target: GuideStep | undefined,
  source: GuideStep | undefined,
  conflicts: GuidePlanMergeConflict[],
): GuideStep | undefined {
  if (ancestor === undefined) {
    const merged = mergeValue(
      `steps.${stepId}`,
      MISSING,
      target ?? MISSING,
      source ?? MISSING,
      conflicts,
    );
    return merged === MISSING ? undefined : (merged as GuideStep);
  }
  if (target === undefined || source === undefined) {
    const merged = mergeValue(
      `steps.${stepId}`,
      ancestor,
      target ?? MISSING,
      source ?? MISSING,
      conflicts,
    );
    return merged === MISSING ? undefined : (merged as GuideStep);
  }

  const merged = structuredClone(target);
  for (const field of stepFields) {
    const value = mergeValue(
      `steps.${stepId}.${field}`,
      recordValue(ancestor, field),
      recordValue(target, field),
      recordValue(source, field),
      conflicts,
    );
    if (value === MISSING) {
      delete merged[field];
    } else {
      merged[field] = value as never;
    }
  }
  return merged;
}

export function computeGuidePlanThreeWayMerge(
  commonAncestor: GuidePlan,
  target: GuidePlan,
  source: GuidePlan,
): GuidePlanThreeWayMerge {
  const conflicts: GuidePlanMergeConflict[] = [];
  for (const [field, ancestorValue, targetValue, sourceValue] of [
    ['id', commonAncestor.id, target.id, source.id],
    [
      'protocolVersion',
      commonAncestor.protocolVersion,
      target.protocolVersion,
      source.protocolVersion,
    ],
    ['rootStepId', commonAncestor.rootStepId, target.rootStepId, source.rootStepId],
  ] as const) {
    if (
      !isDeepStrictEqual(ancestorValue, targetValue) ||
      !isDeepStrictEqual(targetValue, sourceValue)
    ) {
      conflicts.push({
        path: field,
        message: `Branch merge cannot change Plan identity field ${field}`,
      });
    }
  }

  const mergedTitle = mergeValue(
    'title',
    commonAncestor.title,
    target.title,
    source.title,
    conflicts,
  );
  if (!isDeepStrictEqual(mergedTitle, target.title)) {
    conflicts.push({
      path: 'title',
      message: 'Deterministic branch merge does not import Plan title changes',
    });
  }
  const ancestorSteps = new Map(commonAncestor.steps.map((step) => [step.id, step] as const));
  const targetSteps = new Map(target.steps.map((step) => [step.id, step] as const));
  const sourceSteps = new Map(source.steps.map((step) => [step.id, step] as const));
  const stepIds = new Set([...ancestorSteps.keys(), ...targetSteps.keys(), ...sourceSteps.keys()]);
  const mergedSteps = new Map<string, GuideStep>();
  for (const stepId of stepIds) {
    const merged = mergeStep(
      stepId,
      ancestorSteps.get(stepId),
      targetSteps.get(stepId),
      sourceSteps.get(stepId),
      conflicts,
    );
    if (merged !== undefined) {
      mergedSteps.set(stepId, merged);
    }
  }
  const orderedIds = [
    ...target.steps.map((step) => step.id),
    ...source.steps.map((step) => step.id).filter((stepId) => !targetSteps.has(stepId)),
  ];
  const plan = {
    ...structuredClone(target),
    title: cloneMergeValue(mergedTitle) as string,
    steps: orderedIds.flatMap((stepId) => {
      const step = mergedSteps.get(stepId);
      return step === undefined ? [] : [step];
    }),
  };
  return {
    plan,
    conflicts,
    changed: !isDeepStrictEqual(plan, target),
  };
}

interface AcceptedRevision {
  readonly request: GuideRevisionRequest;
  readonly proposal: GuideProposal;
}

function storedRequest(database: OperatingLineDatabase, requestId: string): GuideRevisionRequest {
  const value = database.getGuideRevisionRequest(requestId);
  if (value === null) {
    throw new Error(`Unknown guide revision request: ${requestId}`);
  }
  return guideRevisionRequestSchema.parse(value);
}

function acceptedRevision(
  database: OperatingLineDatabase,
  requestId: string,
  adapterId: string,
  instanceId: string,
): AcceptedRevision {
  const request = storedRequest(database, requestId);
  const rawProposal = database.getGuideReplanProposalForRequest(requestId);
  if (rawProposal === null) {
    throw new Error(`Revision branch source has no linked Proposal: ${requestId}`);
  }
  const proposal = guideProposalSchema.parse(rawProposal);
  const rawDecision = database.getGuideProposalDecision(proposal.proposalId, adapterId, instanceId);
  const decision = rawDecision === null ? null : guideProposalDecisionSchema.parse(rawDecision);
  if (
    request.adapterId !== adapterId ||
    request.instanceId !== instanceId ||
    proposal.targetAdapterId !== adapterId ||
    proposal.targetInstanceId !== instanceId ||
    decision?.proposalId !== proposal.proposalId ||
    decision.decision !== 'accepted'
  ) {
    throw new Error(`Revision branch source must be accepted in this host instance: ${requestId}`);
  }
  return { request, proposal };
}

function requestParents(request: GuideRevisionRequest): readonly string[] {
  const parents: string[] = [];
  const primary = request.revisionThread?.parentRequestId;
  if (primary !== null && primary !== undefined) {
    parents.push(primary);
  }
  const operation = request.revisionOperation;
  if (operation?.kind === 'fork' || operation?.kind === 'merge') {
    if (!parents.includes(operation.sourceRequestId)) {
      parents.push(operation.sourceRequestId);
    }
  }
  return parents;
}

function ancestorDistances(
  database: OperatingLineDatabase,
  requestId: string,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<{ requestId: string; distance: number }> = [{ requestId, distance: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const knownDistance = distances.get(current.requestId);
    if (knownDistance !== undefined && knownDistance <= current.distance) {
      continue;
    }
    distances.set(current.requestId, current.distance);
    const request = storedRequest(database, current.requestId);
    for (const parentRequestId of requestParents(request)) {
      queue.push({ requestId: parentRequestId, distance: current.distance + 1 });
    }
  }
  return distances;
}

function commonAncestorRequestId(
  database: OperatingLineDatabase,
  targetRequestId: string,
  sourceRequestId: string,
): string {
  const targetDistances = ancestorDistances(database, targetRequestId);
  const sourceDistances = ancestorDistances(database, sourceRequestId);
  const candidates = [...targetDistances.keys()].filter((requestId) =>
    sourceDistances.has(requestId),
  );
  if (candidates.length === 0) {
    throw new Error('Revision branches do not share an accepted common ancestor');
  }
  const ancestorSets = new Map(
    candidates.map((requestId) => [requestId, ancestorDistances(database, requestId)] as const),
  );
  const lowestCandidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other !== candidate && (ancestorSets.get(other)?.get(candidate) ?? 0) > 0,
      ),
  );
  if (lowestCandidates.length !== 1) {
    throw new Error('Revision branches have ambiguous nearest common ancestors');
  }
  return lowestCandidates[0]!;
}

function assertSameBranchScope(request: GuideRevisionRequest, source: AcceptedRevision): void {
  if (
    source.request.adapterId !== request.adapterId ||
    source.request.instanceId !== request.instanceId ||
    source.request.catalogVersion !== request.catalogVersion ||
    source.proposal.plan.id !== request.basePlan.id
  ) {
    throw new Error('Revision branches cannot cross adapter, instance, catalog, or Plan id');
  }
}

export function resolveGuideRevisionMergeContext(
  database: OperatingLineDatabase,
  request: GuideRevisionRequest,
  catalog: ActionCatalog,
  targetRevision: number,
): GuideRevisionMergeContext | null {
  const operation = request.revisionOperation;
  if (operation?.kind !== 'merge') {
    return null;
  }
  const thread = request.revisionThread;
  if (thread?.parentRequestId === null || thread?.parentRequestId === undefined) {
    throw new Error('A branch merge requires an accepted target branch parent');
  }
  const rawSourceHead = database.getGuideRevisionThreadHead(operation.sourceThreadId);
  const sourceHead =
    rawSourceHead === null ? null : guideRevisionRequestSchema.parse(rawSourceHead);
  if (sourceHead?.requestId !== operation.sourceRequestId) {
    throw new Error(
      `Merge source ${operation.sourceRequestId} must be the current head of branch ${operation.sourceThreadId}`,
    );
  }
  const source = acceptedRevision(
    database,
    operation.sourceRequestId,
    request.adapterId,
    request.instanceId,
  );
  assertSameBranchScope(request, source);
  const sourceThread = source.request.revisionThread;
  if (sourceThread?.threadId !== operation.sourceThreadId) {
    throw new Error('Merge source request does not belong to the declared source branch');
  }
  const ancestorRequestId = commonAncestorRequestId(
    database,
    thread.parentRequestId,
    operation.sourceRequestId,
  );
  const ancestor = acceptedRevision(
    database,
    ancestorRequestId,
    request.adapterId,
    request.instanceId,
  );
  assertSameBranchScope(request, ancestor);
  const merged = computeGuidePlanThreeWayMerge(
    ancestor.proposal.plan,
    request.basePlan,
    source.proposal.plan,
  );
  if (merged.conflicts.length > 0) {
    const paths = merged.conflicts
      .slice(0, 5)
      .map((conflict) => conflict.path)
      .join(', ');
    throw new Error(`Revision branch merge has unresolved conflicts: ${paths}`);
  }
  if (!merged.changed) {
    throw new Error('Revision branch source has no changes to merge into the target branch');
  }
  const expectedMergedPlan = { ...merged.plan, revision: targetRevision };
  validateGuidePlanStructure(expectedMergedPlan);
  validateGuidePlanAgainstActionCatalog(expectedMergedPlan, catalog);
  return {
    sourceThreadId: operation.sourceThreadId,
    sourceRequestId: operation.sourceRequestId,
    commonAncestorRequestId: ancestorRequestId,
    commonAncestorPlan: ancestor.proposal.plan,
    sourcePlan: source.proposal.plan,
    expectedMergedPlan,
  };
}

export function validateGuideRevisionOperation(
  database: OperatingLineDatabase,
  request: GuideRevisionRequest,
  catalog: ActionCatalog,
): void {
  const operation = request.revisionOperation;
  if (operation === undefined || operation.kind === 'revise') {
    return;
  }
  const rawSourceHead = database.getGuideRevisionThreadHead(operation.sourceThreadId);
  const sourceHead =
    rawSourceHead === null ? null : guideRevisionRequestSchema.parse(rawSourceHead);
  if (sourceHead?.requestId !== operation.sourceRequestId) {
    throw new Error(
      `Revision source ${operation.sourceRequestId} must be the current head of branch ${operation.sourceThreadId}`,
    );
  }
  const source = acceptedRevision(
    database,
    operation.sourceRequestId,
    request.adapterId,
    request.instanceId,
  );
  assertSameBranchScope(request, source);
  if (source.request.revisionThread?.threadId !== operation.sourceThreadId) {
    throw new Error('Revision source request does not belong to its declared branch');
  }
  if (operation.kind === 'fork') {
    if (!isDeepStrictEqual(source.proposal.plan, request.basePlan)) {
      throw new Error('A fork must use its accepted source branch Plan as the exact base');
    }
    return;
  }
  if (
    request.references.length !== 1 ||
    request.references[0]?.nodeId !== request.basePlan.rootStepId
  ) {
    throw new Error('A branch merge must reference exactly the target Plan root');
  }
  resolveGuideRevisionMergeContext(database, request, catalog, request.basePlan.revision + 1);
}

function turnState(
  proposal: GuideProposal | null,
  decision: ReturnType<typeof guideProposalDecisionSchema.parse> | null,
): GuideRevisionTurnState {
  if (proposal === null) {
    return 'awaiting_proposal';
  }
  return decision?.decision ?? 'awaiting_decision';
}

export function createGuideRevisionBranchList(
  database: OperatingLineDatabase,
  request: GuideRevisionBranchListRequest,
): GuideRevisionBranchList {
  const branches = database
    .listGuideRevisionThreadHeads(
      request.targetAdapterId,
      request.instanceId,
      request.planId,
      request.limit,
    )
    .map((row) => {
      const revisionRequest = guideRevisionRequestSchema.parse(row.request);
      const thread = revisionRequest.revisionThread;
      if (thread === undefined) {
        throw new Error('Revision branch list cannot contain a legacy request');
      }
      const proposal = row.proposal === null ? null : guideProposalSchema.parse(row.proposal);
      const decision =
        row.decision === null ? null : guideProposalDecisionSchema.parse(row.decision);
      const status = turnState(proposal, decision);
      const plan = status === 'accepted' && proposal !== null ? proposal.plan : null;
      return {
        threadId: thread.threadId,
        headRequestId: revisionRequest.requestId,
        headTurn: thread.turn,
        status,
        operation: revisionRequest.revisionOperation ?? { kind: 'revise' as const },
        plan,
        planContentSha256: plan === null ? null : computePlanContentSha256(plan),
        occurredAt: revisionRequest.occurredAt,
      };
    });
  return guideRevisionBranchListSchema.parse({
    protocolVersion: guideProtocolVersion,
    targetAdapterId: request.targetAdapterId,
    instanceId: request.instanceId,
    planId: request.planId,
    branches,
  });
}
