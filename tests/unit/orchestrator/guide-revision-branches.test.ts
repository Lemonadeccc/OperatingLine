import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideRevisionRequestSchema,
  type GuidePlan,
  type GuideRevisionOperation,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { computeGuidePlanDiff } from '../../../services/orchestrator/src/guide-plan-diff.js';
import {
  computeGuidePlanThreeWayMerge,
  createGuideRevisionBranchList,
  resolveGuideRevisionMergeContext,
  validateGuideRevisionOperation,
} from '../../../services/orchestrator/src/guide-revision-branches.js';
import { evaluateLocalReplanScope } from '../../../services/orchestrator/src/local-replan-scope.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function actionStep(plan: GuidePlan, stepId: string) {
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (step?.action === null || step?.action === undefined) {
    throw new Error(`Fixture action step is missing: ${stepId}`);
  }
  return step;
}

function request(
  requestId: string,
  instanceId: string,
  plan: GuidePlan,
  thread: { threadId: string; turn: number; parentRequestId: string | null },
  operation: GuideRevisionOperation,
  reference = { nodeId: 'snowman.model.head', nodeNumber: '1.2.3' },
) {
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.4.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId,
    basePlan: plan,
    references: [reference],
    message: `Apply ${operation.kind} revision`,
    revisionThread: thread,
    revisionOperation: operation,
    occurredAt: new Date().toISOString(),
  });
}

function accept(
  database: ReturnType<typeof openOperatingLineDatabase>,
  revisionRequest: ReturnType<typeof request>,
  plan: GuidePlan,
) {
  const proposal = guideProposalSchema.parse({
    protocolVersion: '1.4.0',
    proposalId: randomUUID(),
    targetAdapterId: 'blender',
    targetInstanceId: revisionRequest.instanceId,
    plan,
    revisionRequestId: revisionRequest.requestId,
    revisionThread: revisionRequest.revisionThread,
    revisionOperation: revisionRequest.revisionOperation,
    planDiff: computeGuidePlanDiff(revisionRequest.basePlan, plan),
    catalogVersion: revisionRequest.catalogVersion,
    proposedAt: new Date().toISOString(),
  });
  database.recordGuideReplanProposal(proposal, revisionRequest.requestId);
  const decision = guideProposalDecisionSchema.parse({
    protocolVersion: '1.4.0',
    decisionId: randomUUID(),
    proposalId: proposal.proposalId,
    adapterId: 'blender',
    instanceId: revisionRequest.instanceId,
    decision: 'accepted',
    occurredAt: new Date().toISOString(),
  });
  database.recordGuideProposalDecision(decision);
  return { proposal, decision };
}

describe('revision branch three-way merge', () => {
  it('combines independent action argument changes without changing the target revision', () => {
    const target = structuredClone(basePlan);
    target.revision += 1;
    actionStep(target, 'snowman.model.head').action!.arguments.radius = 1.05;
    const source = structuredClone(basePlan);
    source.revision += 2;
    actionStep(source, 'snowman.model.body_upper').action!.arguments.radius = 1.25;

    const result = computeGuidePlanThreeWayMerge(basePlan, target, source);

    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.plan.revision).toBe(target.revision);
    expect(actionStep(result.plan, 'snowman.model.head').action!.arguments.radius).toBe(1.05);
    expect(actionStep(result.plan, 'snowman.model.body_upper').action!.arguments.radius).toBe(1.25);
  });

  it('combines independent arguments on the same action and preserves absent optional fields', () => {
    const target = structuredClone(basePlan);
    target.revision += 1;
    actionStep(target, 'snowman.model.head').action!.arguments.radius = 1.05;
    const source = structuredClone(basePlan);
    source.revision += 2;
    actionStep(source, 'snowman.model.head').action!.arguments.location = [0, 0, 5.5];

    const result = computeGuidePlanThreeWayMerge(basePlan, target, source);

    expect(result.conflicts).toEqual([]);
    expect(actionStep(result.plan, 'snowman.model.head').action!.arguments).toMatchObject({
      radius: 1.05,
      location: [0, 0, 5.5],
    });
    expect(Object.hasOwn(actionStep(result.plan, 'snowman.model.head'), 'observationPolicy')).toBe(
      Object.hasOwn(actionStep(target, 'snowman.model.head'), 'observationPolicy'),
    );
  });

  it('does not treat absent optional fields as a source change', () => {
    const target = structuredClone(basePlan);
    target.revision += 1;
    const source = structuredClone(basePlan);
    source.revision += 2;

    const result = computeGuidePlanThreeWayMerge(basePlan, target, source);

    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(target);
  });

  it('reports the exact field when both branches change it differently', () => {
    const target = structuredClone(basePlan);
    target.revision += 1;
    actionStep(target, 'snowman.model.head').action!.arguments.radius = 1.05;
    const source = structuredClone(basePlan);
    source.revision += 2;
    actionStep(source, 'snowman.model.head').action!.arguments.radius = 1.15;

    const result = computeGuidePlanThreeWayMerge(basePlan, target, source);

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        path: 'steps.snowman.model.head.action.arguments.radius',
      }),
    ]);
  });

  it('rejects delete-versus-edit conflicts instead of silently choosing a branch', () => {
    const target = structuredClone(basePlan);
    target.revision += 1;
    target.steps = target.steps.filter((step) => step.id !== 'snowman.model.head');
    const source = structuredClone(basePlan);
    source.revision += 2;
    actionStep(source, 'snowman.model.head').title = 'Changed source head';

    const result = computeGuidePlanThreeWayMerge(basePlan, target, source);

    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: 'steps.snowman.model.head' }),
    ]);
  });

  it('persists fork heads and resolves a unique accepted common ancestor for merge', () => {
    const database = openOperatingLineDatabase(':memory:');
    const instanceId = randomUUID();
    try {
      const rootRequestId = randomUUID();
      const rootRequest = request(
        rootRequestId,
        instanceId,
        basePlan,
        { threadId: rootRequestId, turn: 1, parentRequestId: null },
        { kind: 'revise' },
      );
      expect(database.recordGuideRevisionRequest(rootRequest)).toBe('accepted');
      const rootPlan = structuredClone(basePlan);
      rootPlan.revision = 7;
      actionStep(rootPlan, 'snowman.model.head').action!.arguments.radius = 1;
      const rootAccepted = accept(database, rootRequest, rootPlan);

      const forkRequestId = randomUUID();
      const forkRequest = request(
        forkRequestId,
        instanceId,
        rootPlan,
        { threadId: forkRequestId, turn: 1, parentRequestId: null },
        {
          kind: 'fork',
          sourceThreadId: rootRequestId,
          sourceRequestId: rootRequestId,
        },
      );
      validateGuideRevisionOperation(database, forkRequest, blenderActionCatalog);
      expect(database.recordGuideRevisionRequest(forkRequest)).toBe('accepted');
      const forkPlan = structuredClone(rootPlan);
      forkPlan.revision = 8;
      actionStep(forkPlan, 'snowman.model.body_upper').action!.arguments.radius = 1.25;
      accept(database, forkRequest, forkPlan);

      const targetRequestId = randomUUID();
      const targetRequest = request(
        targetRequestId,
        instanceId,
        rootPlan,
        { threadId: rootRequestId, turn: 2, parentRequestId: rootRequestId },
        { kind: 'revise' },
      );
      expect(database.recordGuideRevisionRequest(targetRequest)).toBe('accepted');
      const targetPlan = structuredClone(rootPlan);
      targetPlan.revision = 9;
      actionStep(targetPlan, 'snowman.model.head').action!.arguments.radius = 1.05;
      accept(database, targetRequest, targetPlan);

      const branches = createGuideRevisionBranchList(database, {
        targetAdapterId: 'blender',
        instanceId,
        planId: basePlan.id,
        limit: 100,
      });
      expect(branches.branches).toHaveLength(2);
      expect(branches.branches.map((branch) => branch.threadId)).toEqual(
        expect.arrayContaining([rootRequestId, forkRequestId]),
      );
      expect(branches.branches.every((branch) => branch.status === 'accepted')).toBe(true);

      const mergeRequestId = randomUUID();
      const mergeRequest = request(
        mergeRequestId,
        instanceId,
        targetPlan,
        { threadId: rootRequestId, turn: 3, parentRequestId: targetRequestId },
        {
          kind: 'merge',
          sourceThreadId: forkRequestId,
          sourceRequestId: forkRequestId,
        },
        { nodeId: targetPlan.rootStepId, nodeNumber: '1' },
      );
      validateGuideRevisionOperation(database, mergeRequest, blenderActionCatalog);
      const merge = resolveGuideRevisionMergeContext(
        database,
        mergeRequest,
        blenderActionCatalog,
        10,
      );
      expect(merge).not.toBeNull();
      expect(merge).toMatchObject({
        commonAncestorRequestId: rootRequestId,
        sourceRequestId: forkRequestId,
        expectedMergedPlan: { revision: 10 },
      });
      expect(
        actionStep(merge!.expectedMergedPlan, 'snowman.model.head').action!.arguments.radius,
      ).toBe(1.05);
      expect(
        actionStep(merge!.expectedMergedPlan, 'snowman.model.body_upper').action!.arguments.radius,
      ).toBe(1.25);
      expect(
        evaluateLocalReplanScope(mergeRequest, merge!.expectedMergedPlan, merge).locality,
      ).toEqual(expect.objectContaining({ valid: true, findings: [] }));
      const driftedMerge = structuredClone(merge!.expectedMergedPlan);
      actionStep(driftedMerge, 'snowman.model.head').title = 'Provider-added merge drift';
      expect(evaluateLocalReplanScope(mergeRequest, driftedMerge, merge).locality.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'merge_result_mismatch' })]),
      );
      expect(rootAccepted.decision.decision).toBe('accepted');
    } finally {
      database.close();
    }
  });
});
