import { describe, expect, it } from 'vitest';

import {
  procedureZeroBaselineRefinementCreateRequestSchema,
  procedureZeroBaselineRefinementStatusSchema,
  procedureZeroBaselineReviewRequestSchema,
  procedureZeroBaselineSemanticStartRequestSchema,
} from '../../packages/protocol/src/procedure-zero-baseline-refinement.js';

const descriptor = {
  contractVersion: '1.0.0',
  id: 'contract-provider',
  version: '1.0.0',
  displayName: 'Contract provider',
  description: 'Strict staged workflow contract fixture.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

const create = {
  formatVersion: '1.0.0',
  workflowId: '1ef1f5ff-64e3-4f81-bde8-3708f0cc1d61',
  generationRequest: {
    formatVersion: '1.0.0',
    requestId: '115905b1-8f61-4c51-a4e8-a8ad06b07a5f',
    targetAdapterId: 'blender',
    actionCatalogVersion: '1.40.0',
    interactionCatalogVersion: '1.40.0',
    goal: 'Create an eye sphere.',
    locale: 'en-US',
    authorization: {
      providerDescriptor: descriptor,
      explicitlyConfirmedByUser: true,
      goalAndCatalogContextTransmissionAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      confirmedAt: '2026-08-20T02:00:00.000Z',
    },
  },
  authorization: {
    explicitlyConfirmedByUser: true,
    candidateOnlyUntilExactReviewAcknowledged: true,
    noHostExecutionAcknowledged: true,
    confirmedAt: '2026-08-20T02:00:00.000Z',
  },
} as const;

describe('zero-baseline staged refinement protocol', () => {
  it('does not permit pre-generation disclosure of a nonexistent exact candidate', () => {
    expect(procedureZeroBaselineRefinementCreateRequestSchema.parse(create)).toEqual(create);
    expect(
      procedureZeroBaselineRefinementCreateRequestSchema.safeParse({
        ...create,
        exactCandidateTreeDisclosed: true,
      }).success,
    ).toBe(false);
  });

  it('keeps review, semantic retrieval, and refinement as separate strict requests', () => {
    const hash = 'a'.repeat(64);
    expect(
      procedureZeroBaselineReviewRequestSchema.safeParse({
        formatVersion: '1.0.0',
        workflowId: create.workflowId,
        reviewId: 'ef704fa2-40fa-4ef7-929c-fbbde01a90c1',
        binding: {
          workflowRequestContentSha256: hash,
          generationRequestContentSha256: hash,
          baselineResultContentSha256: hash,
          candidateTreeContentSha256: hash,
        },
        decision: { kind: 'store', confirmations: {} },
        reviewedAt: '2026-08-20T02:00:01.000Z',
      }).success,
    ).toBe(false);
    expect(
      procedureZeroBaselineSemanticStartRequestSchema.safeParse({
        formatVersion: '1.0.0',
        workflowId: create.workflowId,
        request: {},
      }).success,
    ).toBe(false);
  });

  it('rejects status claims that imply storage without exact stored-tree evidence', () => {
    expect(
      procedureZeroBaselineRefinementStatusSchema.safeParse({
        formatVersion: '1.0.0',
        workflowId: create.workflowId,
        requestFingerprint: 'a'.repeat(64),
        createRequest: create,
        phase: 'semantic_retrieving',
        terminal: false,
        baseline: null,
        baselineReviewBinding: null,
        baselineReview: null,
        storedBaseline: null,
        semanticRetrieval: null,
        semanticContext: null,
        semanticFailure: null,
        refinement: null,
        sideEffects: {
          procedureStored: true,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        updatedAt: '2026-08-20T02:00:01.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects colliding lifecycle identities at staged request boundaries', () => {
    expect(
      procedureZeroBaselineRefinementCreateRequestSchema.safeParse({
        ...create,
        generationRequest: { ...create.generationRequest, requestId: create.workflowId },
      }).success,
    ).toBe(false);
    expect(
      procedureZeroBaselineReviewRequestSchema.safeParse({
        formatVersion: '1.0.0',
        workflowId: create.workflowId,
        reviewId: create.workflowId,
        binding: {
          workflowRequestContentSha256: 'a'.repeat(64),
          generationRequestContentSha256: 'b'.repeat(64),
          baselineResultContentSha256: 'c'.repeat(64),
          candidateTreeContentSha256: 'd'.repeat(64),
        },
        decision: { kind: 'discard' },
        reviewedAt: '2026-08-20T02:00:01.000Z',
      }).success,
    ).toBe(false);
  });
});
