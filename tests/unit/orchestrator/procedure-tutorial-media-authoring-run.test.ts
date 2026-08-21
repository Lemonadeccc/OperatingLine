import { describe, expect, it, vi } from 'vitest';

import {
  procedureTutorialMediaAuthoringReviewRequestSchema,
  procedureTutorialMediaAuthoringRunCreateRequestSchema,
} from '../../../packages/protocol/src/procedure-tutorial-media-authoring-run.js';
import { createProcedureTutorialMediaAuthoringRunCoordinator } from '../../../services/orchestrator/src/procedure-tutorial-media-authoring-run.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  run: '22222222-2222-4222-8222-222222222222',
  review: '33333333-3333-4333-8333-333333333333',
  analysis: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555',
  generation: '66666666-6666-4666-8666-666666666666',
} as const;

describe('procedure tutorial media authoring run', () => {
  it('requires exact preparation, packet, candidate, and materialized hashes for store review', () => {
    const review = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: ids.run,
      reviewId: ids.review,
      review: {
        decision: 'store',
        preparationFingerprint: 'a'.repeat(64),
        packetContentSha256: 'b'.repeat(64),
        candidateTreeContentSha256: 'c'.repeat(64),
        materializedTreeContentSha256: 'd'.repeat(64),
        confirmations: {
          exactPreparationReviewed: true,
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: '2026-08-21T08:00:00Z',
    } as const;

    expect(procedureTutorialMediaAuthoringReviewRequestSchema.safeParse(review).success).toBe(true);
    expect(
      procedureTutorialMediaAuthoringReviewRequestSchema.safeParse({
        ...review,
        review: {
          ...review.review,
          confirmations: { ...review.review.confirmations, exactPreparationReviewed: false },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects blocked preparation before resolving or calling a Provider', () => {
    const generateFromPacket = vi.fn();
    const findProcedureAuthor = vi.fn();
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator({
      currentPreparation: () => null,
      generateFromPacket,
      completedGenerationEvidence: () => null,
      materialize: vi.fn(),
      storeWithBinding: vi.fn(),
      restoreStored: () => ({ status: 'absent' }),
      findProcedureAuthor,
      existingEvents: [],
      appendEvent: vi.fn(),
    });
    const blocked = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      preparation: {
        formatVersion: '1.0.0',
        analysisRequestId: ids.analysis,
        analysisJobId: ids.job,
        analysisFingerprint: 'a'.repeat(64),
        fingerprint: 'b'.repeat(64),
        status: 'blocked',
        quality: {
          semanticSegmentCount: 0,
          ordered: true,
          nonOverlapping: true,
          coverage: { asr: 0, frameEvidence: 0, visual: 0, ocr: 0, ui: 0, shortcut: 0 },
          blockers: [
            { code: 'no_semantic_segments', message: 'No segments.', semanticSegmentIds: [] },
          ],
        },
        evidenceBindings: [],
        packet: null,
        sideEffects: {
          providerCalled: false,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      },
      provider: { generationRequestId: ids.generation, authorization: {} },
    };

    expect(procedureTutorialMediaAuthoringRunCreateRequestSchema.safeParse(blocked).success).toBe(
      false,
    );
    expect(() => coordinator.create(blocked as never)).toThrow('invalid');
    expect(findProcedureAuthor).not.toHaveBeenCalled();
    expect(generateFromPacket).not.toHaveBeenCalled();
  });
});
