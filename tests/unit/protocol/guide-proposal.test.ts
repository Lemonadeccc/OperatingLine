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
  JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'));

describe('guide proposal protocol', () => {
  it('keeps AI submission, server envelope, and companion decision strict', () => {
    const submission = guideProposalSubmissionSchema.parse({
      targetAdapterId: 'blender',
      plan: readPlan(),
    });
    const proposalId = randomUUID();
    expect(
      guideProposalSchema.safeParse({
        protocolVersion: '1.0.0',
        proposalId,
        targetAdapterId: submission.targetAdapterId,
        plan: submission.plan,
        proposedAt: '2026-08-04T10:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      guideProposalDecisionSchema.safeParse({
        protocolVersion: '1.0.0',
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
        protocolVersion: '1.0.0',
        decisionId: randomUUID(),
        proposalId: randomUUID(),
        adapterId: 'blender',
        instanceId: randomUUID(),
        decision: 'deferred',
        occurredAt: '2026-08-04T10:01:00Z',
      }).success,
    ).toBe(false);
  });

  it('emits dedicated language-neutral schemas for proposal boundaries', () => {
    for (const filename of [
      'guide-proposal-submission.schema.json',
      'guide-proposal.schema.json',
      'guide-proposal-decision.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
