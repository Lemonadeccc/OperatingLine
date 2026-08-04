import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  guideRevisionThreadHistoryRequestSchema,
  guideRevisionThreadHistorySchema,
} from '@operatingline/protocol';

function historyFixture() {
  const basePlan = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
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
});
