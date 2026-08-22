import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import { canonicalizeProtocolJsonValue, type GuidePlan } from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  createProcedureExecutionFailureReplanReviewCoordinator,
  procedureExecutionFailureReplanReviewPreviewRequestSchema,
  procedureExecutionFailureReplanReviewRequestSchema,
  procedureExecutionFailureReplanReviewResultSchema,
  type TrustedProcedureExecutionFailureReplanReviewEvidence,
} from '../../../services/orchestrator/src/procedure-execution-failure-replan-review.js';
import {
  procedureExecutionFailureReplanOutcomeSchema,
  type ProcedureExecutionFailureReplanOutcome,
} from '../../../services/orchestrator/src/procedure-execution-failure-replan.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const failureProposalId = '22222222-2222-4222-8222-222222222222';
const targetInstanceId = '33333333-3333-4333-8333-333333333333';
const reviewId = '44444444-4444-4444-8444-444444444444';
const reviewedAt = '2026-08-21T10:05:00Z';
const proposedAt = '2026-08-21T10:00:00Z';
const expiresAt = '2026-08-21T10:10:00Z';

const fixturePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function proposalWithIntegrity<T extends Record<string, unknown>>(content: T) {
  return {
    ...content,
    integrity: { algorithm: 'sha256' as const, contentSha256: hash(content) },
  };
}

function parameterOutcome(): ProcedureExecutionFailureReplanOutcome {
  const step = fixturePlan.steps.find((candidate) => candidate.id === 'snowman.model.head');
  if (step?.action === null || step?.action === undefined) throw new Error('Expected action step');
  const before = step.action.arguments['radius'];
  const after = Number(before) * 0.5;
  return procedureExecutionFailureReplanOutcomeSchema.parse({
    kind: 'parameter_repair_proposed',
    proposal: proposalWithIntegrity({
      formatVersion: '1.0.0',
      proposalId: failureProposalId,
      status: 'pending',
      kind: 'parameter_repair',
      failureEnvelopeSha256: 'a'.repeat(64),
      base: {
        planId: fixturePlan.id,
        revision: fixturePlan.revision,
        planContentSha256: hash(fixturePlan),
      },
      catalogs: {
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      },
      diff: {
        actionName: step.action.name,
        argument: 'radius',
        before,
        after,
      },
      observationObligations: step.expectedObservations.map((observation) => ({
        ...observation,
        parameters: Object.prototype.hasOwnProperty.call(observation.parameters, 'radius')
          ? { ...observation.parameters, radius: after }
          : observation.parameters,
      })),
      proposedAt,
      expiresAt,
    }),
  });
}

function unsupportedOutcome(kind: 'strategy_switch' | 'semantic_replan') {
  const parameter = parameterOutcome();
  if (parameter.kind !== 'parameter_repair_proposed') throw new Error('Expected parameter repair');
  const common = Object.fromEntries(
    Object.entries(parameter.proposal).filter(
      ([key]) => key !== 'kind' && key !== 'diff' && key !== 'integrity',
    ),
  );
  const proposal =
    kind === 'strategy_switch'
      ? proposalWithIntegrity({
          ...common,
          kind,
          diff: {
            semanticLeafId: 'snowman.model.head',
            modality: 'menu',
            fromTrackId: 'current.mcp',
            toTrackId: 'alternate.menu',
            verifiedTrackContentSha256: 'b'.repeat(64),
          },
        })
      : proposalWithIntegrity({
          ...common,
          kind,
          diff: {
            candidatePlanContentSha256: 'c'.repeat(64),
            localScopeStepIds: ['snowman.model.head'],
            confidence: 0.8,
            threshold: 0.8,
          },
        });
  return procedureExecutionFailureReplanOutcomeSchema.parse({
    kind: kind === 'strategy_switch' ? 'strategy_switch_proposed' : 'semantic_replan_proposed',
    proposal,
  });
}

function evidence(
  plan: GuidePlan = fixturePlan,
): TrustedProcedureExecutionFailureReplanReviewEvidence {
  return {
    currentPlan: plan,
    failedStepId: 'snowman.model.head',
    targetAdapterId: 'blender',
    targetInstanceId,
    actionCatalog: blenderActionCatalog,
    interactionCatalog: blenderInteractionCatalog,
    candidateEventContentSha256: '1'.repeat(64),
    sourceBindingSha256: '2'.repeat(64),
    terminalActionEventContentSha256: '3'.repeat(64),
    replayBindingContentSha256: '4'.repeat(64),
    rollbackAttestationContentSha256: '5'.repeat(64),
  };
}

function setup(input?: {
  outcome?: ProcedureExecutionFailureReplanOutcome | null;
  evidence?: TrustedProcedureExecutionFailureReplanReviewEvidence | null;
  now?: string;
}) {
  let currentOutcome = input && 'outcome' in input ? input.outcome : parameterOutcome();
  let currentEvidence = input && 'evidence' in input ? input.evidence : evidence();
  const coordinator = createProcedureExecutionFailureReplanReviewCoordinator({
    outcomes: { get: () => currentOutcome ?? null },
    trustedEvidence: { resolve: () => currentEvidence ?? null },
    now: () => input?.now ?? reviewedAt,
  });
  return {
    coordinator,
    setOutcome: (value: ProcedureExecutionFailureReplanOutcome | null) => {
      currentOutcome = value;
    },
    setEvidence: (value: TrustedProcedureExecutionFailureReplanReviewEvidence | null) => {
      currentEvidence = value;
    },
  };
}

describe('procedure execution failure replan review', () => {
  it('previews and accepts one exact parameter repair with deterministic revision artifacts', () => {
    const first = setup().coordinator.preview({ requestId });
    const second = setup().coordinator.preview({ requestId });
    expect(first).toEqual(second);
    expect(first.status).toBe('reviewable');
    if (first.status !== 'reviewable') throw new Error('Expected reviewable preview');
    expect(first.evidenceBinding).toEqual({
      candidateContentSha256: first.proposal.integrity.contentSha256,
      candidateEventContentSha256: '1'.repeat(64),
      sourceBindingSha256: '2'.repeat(64),
      terminalActionEventContentSha256: '3'.repeat(64),
      replayBindingContentSha256: '4'.repeat(64),
      rollbackAttestationContentSha256: '5'.repeat(64),
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      actionCatalogContentSha256: hash(blenderActionCatalog),
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      interactionCatalogContentSha256: hash(blenderInteractionCatalog),
      adapterId: 'blender',
      instanceId: targetInstanceId,
      failedStepId: 'snowman.model.head',
      basePlanId: fixturePlan.id,
      basePlanRevision: fixturePlan.revision,
      basePlanContentSha256: hash(fixturePlan),
    });
    if (first.acceptance.status !== 'available') throw new Error('Expected available acceptance');
    const { artifacts } = first.acceptance;
    expect(artifacts.revisionRequest).toMatchObject({
      requestId: artifacts.revisionRequest.revisionThread?.threadId,
      parameterEdits: [
        {
          nodeId: 'snowman.model.head',
          argumentName: 'radius',
          before: 0.85,
          after: 0.425,
        },
      ],
      revisionOperation: { kind: 'revise' },
    });
    expect(artifacts.guideProposal).toMatchObject({
      revisionRequestId: artifacts.revisionRequest.requestId,
      targetInstanceId,
    });
    expect(artifacts.revisedPlan.revision).toBe(fixturePlan.revision + 1);
    expect(
      artifacts.revisedPlan.steps.find((step) => step.id === 'snowman.model.head')?.action
        ?.arguments['radius'],
    ).toBe(0.425);

    const accepted = setup().coordinator.review({
      formatVersion: '1.0.0',
      requestId,
      reviewId,
      proposalId: failureProposalId,
      reviewBindingSha256: first.reviewBindingSha256,
      decision: {
        kind: 'accept',
        confirmations: {
          exactCandidateReviewed: true,
          exactBasePlanReviewed: true,
          noProviderCallAcknowledged: true,
          noHostExecutionAcknowledged: true,
        },
      },
      reviewedAt,
    });
    expect(accepted).toMatchObject({ status: 'accepted', reviewId, artifacts });
    expect(procedureExecutionFailureReplanReviewResultSchema.parse(accepted)).toEqual(accepted);
  });

  it('discards without producing a GuideProposal or revision artifacts', () => {
    const preview = setup().coordinator.preview({ requestId });
    if (preview.status !== 'reviewable') throw new Error('Expected reviewable preview');
    const result = setup().coordinator.review({
      formatVersion: '1.0.0',
      requestId,
      reviewId,
      proposalId: failureProposalId,
      reviewBindingSha256: preview.reviewBindingSha256,
      decision: { kind: 'discard', reason: 'Do not apply this repair.' },
      reviewedAt,
    });
    expect(result).toEqual({
      status: 'discarded',
      requestId,
      reviewId,
      proposalId: failureProposalId,
      evidenceBinding: preview.evidenceBinding,
      reviewBindingSha256: preview.reviewBindingSha256,
      discardedAt: reviewedAt,
    });
    expect(result).not.toHaveProperty('artifacts');
  });

  it.each(['strategy_switch', 'semantic_replan'] as const)(
    'fails closed when accepting a %s proposal',
    (kind) => {
      const value = setup({ outcome: unsupportedOutcome(kind) });
      const preview = value.coordinator.preview({ requestId });
      expect(preview).toMatchObject({
        status: 'reviewable',
        requestId,
        acceptance: {
          status: 'unavailable',
          reason:
            kind === 'strategy_switch'
              ? 'strategy_track_not_representable_in_guide_protocol'
              : 'semantic_replan_requires_signed_provider_authority',
        },
      });
      if (preview.status !== 'reviewable') throw new Error('Expected reviewable preview');
      expect(() =>
        value.coordinator.review({
          formatVersion: '1.0.0',
          requestId,
          reviewId,
          proposalId: failureProposalId,
          reviewBindingSha256: preview.reviewBindingSha256,
          decision: {
            kind: 'accept',
            confirmations: {
              exactCandidateReviewed: true,
              exactBasePlanReviewed: true,
              noProviderCallAcknowledged: true,
              noHostExecutionAcknowledged: true,
            },
          },
          reviewedAt,
        }),
      ).toThrow('cannot be accepted');
      expect(
        value.coordinator.review({
          formatVersion: '1.0.0',
          requestId,
          reviewId,
          proposalId: failureProposalId,
          reviewBindingSha256: preview.reviewBindingSha256,
          decision: { kind: 'discard' },
          reviewedAt,
        }),
      ).toMatchObject({ status: 'discarded', reviewId });
    },
  );

  it('rejects expiry, stale bases, catalog drift, and changed review bindings', () => {
    const expired = setup({ now: expiresAt });
    const expiredPreview = expired.coordinator.preview({ requestId });
    expect(expiredPreview).toMatchObject({
      status: 'reviewable',
      acceptance: { status: 'unavailable', reason: 'proposal_expired' },
    });
    if (expiredPreview.status !== 'reviewable') throw new Error('Expected expired preview');
    expect(
      expired.coordinator.review({
        formatVersion: '1.0.0',
        requestId,
        reviewId,
        proposalId: failureProposalId,
        reviewBindingSha256: expiredPreview.reviewBindingSha256,
        decision: { kind: 'discard', reason: 'Expired repair is no longer useful.' },
        reviewedAt: expiresAt,
      }),
    ).toMatchObject({ status: 'discarded', reviewId });
    expect(() =>
      expired.coordinator.review({
        formatVersion: '1.0.0',
        requestId,
        reviewId,
        proposalId: failureProposalId,
        reviewBindingSha256: expiredPreview.reviewBindingSha256,
        decision: {
          kind: 'accept',
          confirmations: {
            exactCandidateReviewed: true,
            exactBasePlanReviewed: true,
            noProviderCallAcknowledged: true,
            noHostExecutionAcknowledged: true,
          },
        },
        reviewedAt: expiresAt,
      }),
    ).toThrow('proposal_expired');

    const stalePlan = structuredClone(fixturePlan);
    stalePlan.revision += 1;
    expect(
      setup({ evidence: evidence(stalePlan) }).coordinator.preview({ requestId }),
    ).toMatchObject({ status: 'unavailable', reason: 'stale_current_evidence' });

    const drift = evidence();
    drift.interactionCatalog = {
      ...drift.interactionCatalog,
      catalogVersion: '1.41.0',
    };
    expect(setup({ evidence: drift }).coordinator.preview({ requestId })).toMatchObject({
      status: 'unavailable',
      reason: 'catalog_drift',
    });

    const originalBinding = setup().coordinator.preview({ requestId });
    const changedEvidenceHash = evidence();
    changedEvidenceHash.terminalActionEventContentSha256 = '6'.repeat(64);
    const changedBinding = setup({ evidence: changedEvidenceHash }).coordinator.preview({
      requestId,
    });
    expect(originalBinding.status).toBe('reviewable');
    expect(changedBinding.status).toBe('reviewable');
    if (originalBinding.status !== 'reviewable' || changedBinding.status !== 'reviewable') {
      throw new Error('Expected reviewable evidence-binding previews');
    }
    expect(changedBinding.evidenceBinding.terminalActionEventContentSha256).toBe('6'.repeat(64));
    expect(changedBinding.reviewBindingSha256).not.toBe(originalBinding.reviewBindingSha256);

    const mutable = setup();
    const preview = mutable.coordinator.preview({ requestId });
    if (preview.status !== 'reviewable') throw new Error('Expected reviewable preview');
    const changed = structuredClone(fixturePlan);
    changed.title = `${changed.title} changed`;
    mutable.setEvidence(evidence(changed));
    expect(() =>
      mutable.coordinator.review({
        formatVersion: '1.0.0',
        requestId,
        reviewId,
        proposalId: failureProposalId,
        reviewBindingSha256: preview.reviewBindingSha256,
        decision: {
          kind: 'accept',
          confirmations: {
            exactCandidateReviewed: true,
            exactBasePlanReviewed: true,
            noProviderCallAcknowledged: true,
            noHostExecutionAcknowledged: true,
          },
        },
        reviewedAt,
      }),
    ).toThrow('unavailable');
  });

  it('keeps all public review objects strict', () => {
    expect(
      procedureExecutionFailureReplanReviewPreviewRequestSchema.safeParse({
        requestId,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      procedureExecutionFailureReplanReviewRequestSchema.safeParse({
        formatVersion: '1.0.0',
        requestId,
        reviewId,
        proposalId: failureProposalId,
        reviewBindingSha256: 'a'.repeat(64),
        decision: { kind: 'accept', extra: true },
        reviewedAt,
      }).success,
    ).toBe(false);
  });
});
