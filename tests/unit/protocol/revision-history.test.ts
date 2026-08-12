import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  guideRevisionBranchListRequestSchema,
  guideRevisionBranchListSchema,
  guideRevisionThreadHistoryRequestSchema,
  guideRevisionThreadHistorySchema,
} from '@operatingline/protocol';

function historyFixture() {
  const basePlan = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
  ) as Record<string, unknown> & { id: string; revision: number };
  const targetPlan = { ...basePlan, revision: basePlan.revision + 1 };
  const requestId = randomUUID();
  const instanceId = randomUUID();
  const proposalId = randomUUID();
  const thread = { threadId: requestId, turn: 1, parentRequestId: null };
  const request = {
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: '1.1.0',
    instanceId,
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the head slightly larger.',
    revisionThread: thread,
    occurredAt: '2026-08-05T10:00:00Z',
  };
  const proposal = {
    protocolVersion: '1.1.0',
    proposalId,
    targetAdapterId: 'blender',
    targetInstanceId: instanceId,
    plan: targetPlan,
    revisionRequestId: requestId,
    revisionThread: thread,
    planDiff: {
      basePlan: { id: basePlan.id, revision: basePlan.revision },
      targetPlan: { id: targetPlan.id, revision: targetPlan.revision },
      summary: {
        planFields: 0,
        addedSteps: 0,
        removedSteps: 0,
        updatedSteps: 0,
        movedSteps: 0,
      },
      planChanges: [],
      stepChanges: [],
    },
    catalogVersion: '1.1.0',
    proposedAt: '2026-08-05T10:01:00Z',
  };
  const decision = {
    protocolVersion: '1.1.0',
    decisionId: randomUUID(),
    proposalId,
    adapterId: 'blender',
    instanceId,
    decision: 'accepted',
    occurredAt: '2026-08-05T10:02:00Z',
  };
  return {
    protocolVersion: '1.1.0',
    threadId: requestId,
    targetAdapterId: 'blender',
    instanceId,
    planId: basePlan.id,
    latestTurn: 1,
    status: 'accepted',
    turns: [{ turn: 1, state: 'accepted', request, proposal, decision }],
    page: { beforeTurn: null, nextBeforeTurn: null, hasMore: false },
  };
}

describe('guide revision thread history protocol', () => {
  it('preserves the exact request, proposal, diff, and human decision', () => {
    const history = guideRevisionThreadHistorySchema.parse(historyFixture());

    expect(history.turns[0]).toMatchObject({
      state: 'accepted',
      request: { message: 'Make the head slightly larger.' },
      proposal: { planDiff: { summary: { updatedSteps: 0 } } },
      decision: { decision: 'accepted' },
    });
  });

  it('reads legacy history, normalizes implicit revise into current proposals, and rejects 1.0', () => {
    const current = historyFixture();
    current.protocolVersion = '1.3.0';
    current.turns[0]!.request.protocolVersion = '1.3.0';
    current.turns[0]!.proposal!.protocolVersion = '1.3.0';
    current.turns[0]!.decision!.protocolVersion = '1.3.0';
    expect(guideRevisionThreadHistorySchema.safeParse(current).success).toBe(true);

    const normalized = historyFixture();
    normalized.protocolVersion = '1.4.0';
    normalized.turns[0]!.proposal!.protocolVersion = '1.4.0';
    (normalized.turns[0]!.proposal as Record<string, unknown>).revisionOperation = {
      kind: 'revise',
    };
    expect(guideRevisionThreadHistorySchema.safeParse(normalized).success).toBe(true);

    for (const field of ['request', 'proposal', 'decision'] as const) {
      const invalid = historyFixture();
      invalid.turns[0]![field]!.protocolVersion = '1.0.0';
      expect(guideRevisionThreadHistorySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects cross-thread decisions and inconsistent page cursors', () => {
    const history = historyFixture();
    expect(
      guideRevisionThreadHistorySchema.safeParse({
        ...history,
        turns: [
          {
            ...history.turns[0],
            decision: { ...history.turns[0]!.decision, instanceId: randomUUID() },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionThreadHistorySchema.safeParse({
        ...history,
        page: { beforeTurn: null, nextBeforeTurn: 1, hasMore: false },
      }).success,
    ).toBe(false);
  });

  it('uses a bounded newest-first cursor request while returning turns in reading order', () => {
    expect(
      guideRevisionThreadHistoryRequestSchema.parse({
        threadId: randomUUID(),
        targetAdapterId: 'blender',
        instanceId: randomUUID(),
      }),
    ).toMatchObject({ limit: 20 });
    expect(
      guideRevisionThreadHistoryRequestSchema.safeParse({
        threadId: randomUUID(),
        targetAdapterId: 'blender',
        instanceId: randomUUID(),
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it('emits strict language-neutral history request and response schemas', () => {
    for (const filename of [
      'guide-revision-thread-history-request.schema.json',
      'guide-revision-thread-history.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('validates installable branch heads and explicit branch topology', () => {
    const plan = historyFixture().turns[0]!.proposal!.plan;
    const instanceId = randomUUID();
    const threadId = randomUUID();
    const sourceThreadId = randomUUID();
    const branchList = {
      protocolVersion: '1.4.0',
      targetAdapterId: 'blender',
      instanceId,
      planId: plan.id,
      branches: [
        {
          threadId,
          headRequestId: threadId,
          headTurn: 1,
          status: 'accepted',
          operation: {
            kind: 'fork',
            sourceThreadId,
            sourceRequestId: randomUUID(),
          },
          plan,
          planContentSha256: 'a'.repeat(64),
          occurredAt: '2026-08-12T10:00:00Z',
        },
      ],
    } as const;

    expect(guideRevisionBranchListSchema.parse(branchList).branches[0]?.plan).toEqual(plan);
    expect(
      guideRevisionBranchListSchema.safeParse({
        ...branchList,
        branches: [
          {
            ...branchList.branches[0],
            headTurn: 2,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionBranchListRequestSchema.parse({
        targetAdapterId: 'blender',
        instanceId,
        planId: plan.id,
      }),
    ).toMatchObject({ limit: 100 });
  });
});
