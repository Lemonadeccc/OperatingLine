import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guideReplanSubmissionSchema, guideRevisionRequestSchema } from '@operatingline/protocol';

const readPlan = (): unknown =>
  JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'));

function revisionRequest() {
  const requestId = randomUUID();
  return {
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: '1.0.0',
    instanceId: randomUUID(),
    basePlan: readPlan(),
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the head slightly larger.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    occurredAt: '2026-08-04T12:00:00Z',
  };
}

describe('guide revision request protocol', () => {
  it('binds a user message to an immutable base plan and stable node references', () => {
    const request = guideRevisionRequestSchema.parse(revisionRequest());

    expect(request.basePlan).toMatchObject({ id: 'snowman-demo', revision: 4 });
    expect(request.catalogVersion).toBe('1.0.0');
    expect(request.references).toEqual([{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }]);
    expect(request.revisionThread).toEqual({
      threadId: request.requestId,
      turn: 1,
      parentRequestId: null,
    });
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

  it('requires explicit, linear thread lineage in protocol 1.1 requests', () => {
    const first = revisionRequest();
    expect(
      guideRevisionRequestSchema.safeParse({ ...first, revisionThread: undefined }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...first,
        revisionThread: {
          threadId: randomUUID(),
          turn: 1,
          parentRequestId: null,
        },
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...first,
        requestId: randomUUID(),
        revisionThread: {
          threadId: first.requestId,
          turn: 2,
          parentRequestId: first.requestId,
        },
      }).success,
    ).toBe(true);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...first,
        protocolVersion: '1.0.0',
        revisionThread: undefined,
      }).success,
    ).toBe(true);
  });

  it('emits protocol-version and turn conditions for non-TypeScript hosts', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/guide-revision-request.schema.json'), 'utf8'),
    ) as { allOf?: unknown[]; properties?: { revisionThread?: { allOf?: unknown[] } } };
    expect(schema.allOf).toHaveLength(1);
    expect(schema.properties?.revisionThread?.allOf).toHaveLength(2);
  });
});
