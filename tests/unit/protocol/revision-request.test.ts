import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guideReplanSubmissionSchema, guideRevisionRequestSchema } from '@operatingline/protocol';

const readPlan = (): unknown =>
  JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'));

function revisionRequest() {
  return {
    protocolVersion: '1.0.0',
    requestId: randomUUID(),
    adapterId: 'blender',
    catalogVersion: '1.0.0',
    instanceId: randomUUID(),
    basePlan: readPlan(),
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the head slightly larger.',
    occurredAt: '2026-08-04T12:00:00Z',
  };
}

describe('guide revision request protocol', () => {
  it('binds a user message to an immutable base plan and stable node references', () => {
    const request = guideRevisionRequestSchema.parse(revisionRequest());

    expect(request.basePlan).toMatchObject({ id: 'snowman-demo', revision: 4 });
    expect(request.catalogVersion).toBe('1.0.0');
    expect(request.references).toEqual([{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }]);
  });

  it('keeps node references bounded, portable, and strict', () => {
    expect(
      guideRevisionRequestSchema.safeParse({
        ...revisionRequest(),
        references: [{ nodeId: 'snowman.model.head', nodeNumber: '1-2-3' }],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...revisionRequest(),
        references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.0.3' }],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...revisionRequest(),
        references: [],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...revisionRequest(),
        executeImmediately: true,
      }).success,
    ).toBe(false);
  });

  it('requires an exact catalog version and a complete newer-plan candidate for replan', () => {
    const plan = readPlan() as Record<string, unknown>;
    expect(
      guideReplanSubmissionSchema.safeParse({
        requestId: randomUUID(),
        catalogVersion: '1.0.0',
        plan: { ...plan, revision: 5 },
      }).success,
    ).toBe(true);
    expect(
      guideReplanSubmissionSchema.safeParse({
        requestId: randomUUID(),
        plan: { ...plan, revision: 5 },
      }).success,
    ).toBe(false);
  });
});
