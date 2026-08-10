import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
} from '@operatingline/protocol';

const readPlan = (): unknown =>
  JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'));

describe('guide proposal protocol', () => {
  it('keeps AI submission, server envelope, and companion decision strict', () => {
    const submission = guideProposalSubmissionSchema.parse({
      targetAdapterId: 'blender',
      plan: readPlan(),
    });
    const proposalId = randomUUID();
    expect(
      guideProposalSchema.safeParse({
        protocolVersion: '1.1.0',
        proposalId,
        targetAdapterId: submission.targetAdapterId,
        plan: submission.plan,
        planDiff: null,
        proposedAt: '2026-08-04T10:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      guideProposalDecisionSchema.safeParse({
        protocolVersion: '1.1.0',
        decisionId: randomUUID(),
        proposalId,
        adapterId: 'blender',
        instanceId: randomUUID(),
        decision: 'accepted',
        occurredAt: '2026-08-04T10:01:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects unversioned fields and unsupported decision values', () => {
    expect(
      guideProposalSubmissionSchema.safeParse({
        targetAdapterId: 'blender',
        plan: readPlan(),
        executeImmediately: true,
      }).success,
    ).toBe(false);
    expect(
      guideProposalDecisionSchema.safeParse({
        protocolVersion: '1.1.0',
        decisionId: randomUUID(),
        proposalId: randomUUID(),
        adapterId: 'blender',
        instanceId: randomUUID(),
        decision: 'deferred',
        occurredAt: '2026-08-04T10:01:00Z',
      }).success,
    ).toBe(false);
  });

  it('supports an instance-targeted goal-request audit link without changing standalone input', () => {
    const goalRequestId = randomUUID();
    expect(
      guideProposalSubmissionSchema.safeParse({
        goalRequestId,
        targetAdapterId: 'blender',
        catalogVersion: '1.0.0',
        planning: {
          goal: 'Create a snowman.',
          requiredPhaseIds: ['model'],
        },
        plan: readPlan(),
      }).success,
    ).toBe(true);
    expect(
      guideProposalSubmissionSchema.safeParse({
        goalRequestId,
        targetAdapterId: 'blender',
        catalogVersion: '1.0.0',
        plan: readPlan(),
      }).success,
    ).toBe(false);
    expect(
      guideProposalSchema.safeParse({
        protocolVersion: '1.1.0',
        proposalId: randomUUID(),
        targetAdapterId: 'blender',
        targetInstanceId: randomUUID(),
        goalRequestId,
        catalogVersion: '1.0.0',
        plan: readPlan(),
        planDiff: null,
        proposedAt: '2026-08-04T10:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      guideProposalSchema.safeParse({
        protocolVersion: '1.1.0',
        proposalId: randomUUID(),
        targetAdapterId: 'blender',
        targetInstanceId: randomUUID(),
        goalRequestId,
        revisionRequestId: randomUUID(),
        catalogVersion: '1.0.0',
        plan: readPlan(),
        planDiff: null,
        proposedAt: '2026-08-04T10:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('requires explicit diff review for protocol 1.1 while reading legacy envelopes', () => {
    const proposalId = randomUUID();
    const requestId = randomUUID();
    const common = {
      proposalId,
      targetAdapterId: 'blender',
      plan: readPlan(),
      proposedAt: '2026-08-04T10:00:00Z',
    };
    expect(guideProposalSchema.safeParse({ protocolVersion: '1.0.0', ...common }).success).toBe(
      true,
    );
    expect(
      guideProposalSchema.safeParse({
        protocolVersion: '1.1.0',
        ...common,
        targetInstanceId: randomUUID(),
        revisionRequestId: requestId,
        revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
        catalogVersion: '1.1.0',
        planDiff: null,
      }).success,
    ).toBe(false);
  });

  it('emits dedicated language-neutral schemas for proposal boundaries', () => {
    for (const filename of [
      'guide-proposal-submission.schema.json',
      'guide-proposal.schema.json',
      'guide-proposal-decision.schema.json',
      'guide-plan-diff.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
        allOf?: unknown[];
      };
      expect(schema.additionalProperties).toBe(false);
      if (filename === 'guide-proposal.schema.json') {
        expect(schema.allOf?.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
