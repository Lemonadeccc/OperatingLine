import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guideReplanSubmissionSchema, guideRevisionRequestSchema } from '@operatingline/protocol';

const readPlan = (): unknown =>
  JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'));

function revisionRequest() {
  const requestId = randomUUID();
  return {
    protocolVersion: '1.4.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: '1.0.0',
    instanceId: randomUUID(),
    basePlan: readPlan(),
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the head slightly larger.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    revisionOperation: { kind: 'revise' as const },
    occurredAt: '2026-08-04T12:00:00Z',
  };
}

describe('guide revision request protocol', () => {
  it('binds a user message to an immutable base plan and stable node references', () => {
    const request = guideRevisionRequestSchema.parse(revisionRequest());

    expect(request.basePlan).toMatchObject({ id: 'snowman-demo', revision: 6 });
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
    const generationRequestId = randomUUID();
    expect(
      guideReplanSubmissionSchema.safeParse({
        generationRequestId,
        requestId: randomUUID(),
        catalogVersion: '1.0.0',
        plan: { ...plan, revision: 7 },
      }).success,
    ).toBe(true);
    expect(
      guideReplanSubmissionSchema.safeParse({
        requestId: randomUUID(),
        plan: { ...plan, revision: 7 },
      }).success,
    ).toBe(false);
    expect(
      guideReplanSubmissionSchema.safeParse({
        generationRequestId,
        requestId: randomUUID(),
        catalogVersion: '1.0.0',
        plan: { ...plan, revision: 7 },
        generationResult: 'must-not-be-embedded',
      }).success,
    ).toBe(false);
  });

  it('requires explicit, linear thread lineage in protocol 1.1+ requests', () => {
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
        revisionOperation: undefined,
      }).success,
    ).toBe(true);
  });

  it('accepts typed parameter edits as the complete revision intent in protocol 1.4', () => {
    const request = revisionRequest();
    const parameterEdit = {
      nodeId: 'snowman.model.head',
      argumentName: 'radius',
      before: 0.85,
      after: 1.05,
    };

    expect(
      guideRevisionRequestSchema.parse({
        ...request,
        message: '',
        parameterEdits: [parameterEdit],
      }),
    ).toMatchObject({ message: '', parameterEdits: [parameterEdit] });
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        parameterEdits: [{ ...parameterEdit, nodeId: 'snowman.model.body_upper' }],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        parameterEdits: [{ ...parameterEdit, after: parameterEdit.before }],
      }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        parameterEdits: [parameterEdit, parameterEdit],
      }).success,
    ).toBe(false);
  });

  it('keeps protocol 1.2 message-only and requires at least one intent source', () => {
    const request = revisionRequest();
    const parameterEdits = [
      {
        nodeId: 'snowman.model.head',
        argumentName: 'radius',
        before: 0.85,
        after: 1.05,
      },
    ];

    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        protocolVersion: '1.2.0',
        parameterEdits,
        revisionOperation: undefined,
      }).success,
    ).toBe(false);
    expect(guideRevisionRequestSchema.safeParse({ ...request, message: '' }).success).toBe(false);
  });

  it('requires explicit fork and merge topology in protocol 1.4', () => {
    const request = revisionRequest();
    const sourceThreadId = randomUUID();
    const sourceRequestId = randomUUID();
    expect(
      guideRevisionRequestSchema.safeParse({ ...request, revisionOperation: undefined }).success,
    ).toBe(false);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        revisionOperation: { kind: 'fork', sourceThreadId, sourceRequestId },
      }).success,
    ).toBe(true);
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        revisionOperation: { kind: 'merge', sourceThreadId, sourceRequestId },
      }).success,
    ).toBe(false);

    const continuedRequestId = randomUUID();
    expect(
      guideRevisionRequestSchema.safeParse({
        ...request,
        requestId: continuedRequestId,
        revisionThread: {
          threadId: request.requestId,
          turn: 2,
          parentRequestId: request.requestId,
        },
        revisionOperation: { kind: 'merge', sourceThreadId, sourceRequestId },
      }).success,
    ).toBe(true);
  });

  it('emits protocol-version and turn conditions for non-TypeScript hosts', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/guide-revision-request.schema.json'), 'utf8'),
    ) as { allOf?: unknown[]; properties?: { revisionThread?: { allOf?: unknown[] } } };
    expect(schema.allOf).toHaveLength(3);
    expect(schema.properties?.revisionThread?.allOf).toHaveLength(2);
  });
});
