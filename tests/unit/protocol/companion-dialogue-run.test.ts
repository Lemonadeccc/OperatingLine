import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionDialogueRunCreateRequestSchema,
  companionDialogueRunSchema,
  plannerDialogueMaximumMessageCharacters,
  plannerDialogueProviderResultSchema,
  semanticReplanConfidenceThreshold,
  type GuidePlan,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function createRequest() {
  const dialogueRequestId = randomUUID();
  const replanGenerationRequestId = randomUUID();
  const revisionRequestId = randomUUID();
  const targetInstanceId = randomUUID();
  return {
    dialogueRequestId,
    replanGenerationRequestId,
    providerId: 'fake-dialogue-planner',
    providerVersion: '0.1.0',
    targetAdapterId: 'blender',
    targetInstanceId,
    revisionRequest: {
      protocolVersion: '1.4.0',
      requestId: revisionRequestId,
      adapterId: 'blender',
      catalogVersion: '1.1.0',
      instanceId: targetInstanceId,
      basePlan: { ...basePlan, protocolVersion: '1.4.0' },
      references: [{ nodeId: basePlan.rootStepId, nodeNumber: '1' }],
      message: 'Would making the snowman taller change the animation setup?',
      revisionThread: {
        threadId: revisionRequestId,
        turn: 1,
        parentRequestId: null,
      },
      revisionOperation: { kind: 'revise' },
      occurredAt: '2026-08-12T10:00:00.000Z',
    },
    history: [
      { role: 'user', message: 'Can you explain the current animation?' },
      { role: 'assistant', message: 'It uses keyed transforms on the root.' },
    ],
    authorization: {
      disclosureVersion: '1.0.0',
      dataHandlingAcknowledged: true,
      possibleChargesAcknowledged: true,
      authorizedProviderCallLimit: 2,
      automaticReplanAcknowledged: true,
      proposalCreationAcknowledged: true,
      authorizedAt: '2026-08-12T10:00:01.000Z',
    },
  } as const;
}

function run(status: string) {
  const request = createRequest();
  return {
    contractVersion: '1.0.0',
    dialogueRequestId: request.dialogueRequestId,
    revisionRequestId: request.revisionRequest.requestId,
    replanGenerationRequestId: request.replanGenerationRequestId,
    targetAdapterId: request.targetAdapterId,
    targetInstanceId: request.targetInstanceId,
    provider: {
      id: request.providerId,
      version: request.providerVersion,
      displayName: 'Fake Dialogue Planner',
    },
    status,
    terminal: false,
    sceneChanged: false,
    assistantMessage: '',
    assistantMessageRevision: 0,
    semanticDecision: null,
    revisionRequestRecorded: false,
    proposalId: null,
    error: null,
    needsRevision: null,
    updatedAt: '2026-08-12T10:00:02.000Z',
  };
}

describe('companion dialogue run protocol', () => {
  it('binds one explicit authorization to distinct dialogue, revision, and replan calls', () => {
    const request = createRequest();

    expect(companionDialogueRunCreateRequestSchema.parse(request)).toEqual(request);
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        replanGenerationRequestId: request.dialogueRequestId,
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        authorization: {
          ...request.authorization,
          automaticReplanAcknowledged: false,
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only alternating completed history and ordinary revise operations', () => {
    const request = createRequest();

    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        history: [{ role: 'assistant', message: 'orphan response' }],
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        history: [{ role: 'user', message: 'unfinished turn' }],
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        revisionRequest: {
          ...request.revisionRequest,
          revisionOperation: {
            kind: 'fork',
            sourceThreadId: randomUUID(),
            sourceRequestId: randomUUID(),
          },
        },
      }).success,
    ).toBe(false);
  });

  it('uses one bounded message limit for provider replies, public runs, and later history', () => {
    const maximumReply = 'A'.repeat(plannerDialogueMaximumMessageCharacters);
    const oversizedReply = `${maximumReply}B`;
    const request = createRequest();

    expect(
      plannerDialogueProviderResultSchema.safeParse({
        assistantMessage: maximumReply,
        decision: { kind: 'answer' },
      }).success,
    ).toBe(true);
    expect(
      plannerDialogueProviderResultSchema.safeParse({
        assistantMessage: oversizedReply,
        decision: { kind: 'answer' },
      }).success,
    ).toBe(false);
    for (const decision of [
      { kind: 'answer' as const },
      { kind: 'replan' as const, confidence: 0.9 },
    ]) {
      expect(
        plannerDialogueProviderResultSchema.safeParse({
          assistantMessage: ' '.repeat(plannerDialogueMaximumMessageCharacters),
          decision,
        }).success,
      ).toBe(false);
    }
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        history: [
          { role: 'user', message: request.revisionRequest.message },
          { role: 'assistant', message: maximumReply },
        ],
      }).success,
    ).toBe(true);
    expect(
      companionDialogueRunCreateRequestSchema.safeParse({
        ...request,
        history: [
          { role: 'user', message: request.revisionRequest.message },
          { role: 'assistant', message: oversizedReply },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps streaming phases non-terminal and answer-only results scene safe', () => {
    for (const status of ['queued', 'streaming']) {
      expect(companionDialogueRunSchema.safeParse(run(status)).success).toBe(true);
    }
    const answered = {
      ...run('answered'),
      terminal: true,
      assistantMessage: 'The current animation setup can remain unchanged.',
      assistantMessageRevision: 3,
      semanticDecision: {
        kind: 'answer',
        replanConfidence: 0.61,
        threshold: semanticReplanConfidenceThreshold,
      },
    };
    expect(companionDialogueRunSchema.safeParse(answered).success).toBe(true);
    expect(
      companionDialogueRunSchema.safeParse({
        ...answered,
        semanticDecision: {
          kind: 'answer',
          replanConfidence: semanticReplanConfidenceThreshold,
          threshold: semanticReplanConfidenceThreshold,
        },
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunSchema.safeParse({ ...answered, revisionRequestRecorded: true }).success,
    ).toBe(false);
    expect(companionDialogueRunSchema.safeParse({ ...answered, sceneChanged: true }).success).toBe(
      false,
    );
  });

  it('requires a durable request and threshold-approved decision before replanning', () => {
    const replanning = {
      ...run('replanning'),
      assistantMessage: 'I will prepare a reviewable revision.',
      assistantMessageRevision: 1,
      semanticDecision: {
        kind: 'replan',
        confidence: 0.92,
        threshold: semanticReplanConfidenceThreshold,
      },
      revisionRequestRecorded: true,
    };

    expect(companionDialogueRunSchema.safeParse(replanning).success).toBe(true);
    expect(
      companionDialogueRunSchema.safeParse({
        ...replanning,
        semanticDecision: {
          kind: 'replan',
          confidence: 0.79,
          threshold: semanticReplanConfidenceThreshold,
        },
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunSchema.safeParse({
        ...replanning,
        revisionRequestRecorded: false,
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunSchema.safeParse({
        ...replanning,
        assistantMessage: '',
        assistantMessageRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      companionDialogueRunSchema.safeParse({
        ...run('streaming'),
        assistantMessage: 'Unversioned progress',
      }).success,
    ).toBe(false);
  });
});
