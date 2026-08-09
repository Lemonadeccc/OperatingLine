import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  guideGoalPromptRequestSchema,
  guideGoalRequestListSchema,
  guideGoalRequestSchema,
} from '@operatingline/protocol';

describe('guide goal request protocol', () => {
  it('parses one strict vendor-neutral 1.1 request and trims authored text', () => {
    const requestId = randomUUID();
    const instanceId = randomUUID();
    expect(
      guideGoalRequestSchema.parse({
        protocolVersion: '1.1.0',
        requestId,
        adapterId: ' canvas ',
        catalogVersion: '2.3.4',
        instanceId,
        goal: '  Create a launch diagram.  ',
        planId: ' launch-diagram ',
        occurredAt: '2026-08-09T10:00:00+08:00',
      }),
    ).toEqual({
      protocolVersion: '1.1.0',
      requestId,
      adapterId: 'canvas',
      catalogVersion: '2.3.4',
      instanceId,
      goal: 'Create a launch diagram.',
      planId: 'launch-diagram',
      occurredAt: '2026-08-09T10:00:00+08:00',
    });
  });

  it('rejects legacy versions, invalid identities, oversized goals, and unknown fields', () => {
    const valid = {
      protocolVersion: '1.1.0',
      requestId: randomUUID(),
      adapterId: 'canvas',
      catalogVersion: '1.0.0',
      instanceId: randomUUID(),
      goal: 'Create a launch diagram.',
      planId: 'launch-diagram',
      occurredAt: '2026-08-09T10:00:00Z',
    };
    expect(guideGoalRequestSchema.safeParse({ ...valid, protocolVersion: '1.0.0' }).success).toBe(
      false,
    );
    expect(guideGoalRequestSchema.safeParse({ ...valid, requestId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(guideGoalRequestSchema.safeParse({ ...valid, goal: 'x'.repeat(10_001) }).success).toBe(
      false,
    );
    expect(guideGoalRequestSchema.safeParse({ ...valid, providerId: 'automatic' }).success).toBe(
      false,
    );
  });

  it('uses request-id prompt lookup and revision-style pending-list defaults', () => {
    const requestId = randomUUID();
    expect(guideGoalPromptRequestSchema.parse({ requestId })).toEqual({ requestId });
    expect(guideGoalRequestListSchema.parse({})).toEqual({});
    expect(guideGoalRequestListSchema.parse({ targetAdapterId: 'canvas', limit: 100 })).toEqual({
      targetAdapterId: 'canvas',
      limit: 100,
    });
    expect(guideGoalRequestListSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('emits strict public JSON schemas for request boundaries', () => {
    for (const filename of [
      'guide-goal-request.schema.json',
      'guide-goal-request-acknowledgement.schema.json',
      'guide-goal-request-list.schema.json',
      'guide-goal-prompt-request.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
