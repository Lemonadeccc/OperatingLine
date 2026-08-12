import {
  evaluateHumanEvalCaseCapturePolicy,
  type HumanEvalCaseCapturePolicyStatus,
} from './collection-policy.js';
import type { ValidatedHumanEvalDataset } from './dataset.js';
import {
  evaluateHumanEvalRunReviewPolicy,
  resolveActiveHumanEvalAnnotations,
  unsignedHumanEvalRunIds,
} from './review-policy.js';

export interface HumanEvalCollectionSignoff {
  readonly caseId: string;
  readonly runId: string;
}

export interface HumanEvalCollectionReview {
  readonly caseId: string;
  readonly runId: string;
  readonly currentIndependentReviewerCount: number;
  readonly requiredIndependentReviewerCount: number;
  readonly remainingIndependentReviewerCount: number;
}

export interface HumanEvalCollectionAdjudication {
  readonly caseId: string;
  readonly runId: string;
}

export type HumanEvalCollectionReviewStage =
  | {
      readonly status: 'open';
      readonly blockedByUnsignedRunIds: readonly [];
    }
  | {
      readonly status: 'blocked_by_unsigned_runs';
      readonly blockedByUnsignedRunIds: readonly string[];
    }
  | {
      readonly status: 'not_actionable_retired_suite';
      readonly blockedByUnsignedRunIds: readonly string[];
    };

export interface HumanEvalCollectionWorklist {
  readonly formatVersion: '1.0.0';
  readonly suite: {
    readonly suiteId: string;
    readonly suiteVersion: string;
    readonly status: 'collecting' | 'released' | 'retired';
  };
  readonly target: 'collection_policy_minimums';
  readonly actionability: 'actionable' | 'retired_suite';
  readonly releaseReadiness: 'not_assessed';
  readonly captureStatusByCase: readonly HumanEvalCaseCapturePolicyStatus[];
  readonly signoffs: readonly HumanEvalCollectionSignoff[];
  readonly reviewStage: HumanEvalCollectionReviewStage;
  readonly reviews: readonly HumanEvalCollectionReview[];
  readonly adjudications: readonly HumanEvalCollectionAdjudication[];
  readonly collectionPolicyMinimumsMet: boolean;
}

function compareCaseAndRun(
  left: { readonly caseId: string; readonly runId: string },
  right: { readonly caseId: string; readonly runId: string },
): number {
  return left.caseId.localeCompare(right.caseId) || left.runId.localeCompare(right.runId);
}

/**
 * Builds a deterministic, JSON-ready list of collection work remaining for live Provider runs.
 * This intentionally does not assign providers or run IDs and does not validate release readiness.
 */
export function buildHumanEvalCollectionWorklist(
  dataset: ValidatedHumanEvalDataset,
): HumanEvalCollectionWorklist {
  const requiredDistinctTreatments = dataset.suite.policy.minimumDistinctTreatmentsPerCase;
  const requiredIndependentReviewers = dataset.suite.policy.minimumIndependentAnnotationsPerRun;
  const liveRuns = dataset.runs
    .filter((run) => run.sourceKind === 'live_provider_invocation')
    .sort(
      (left, right) =>
        left.caseRef.caseId.localeCompare(right.caseRef.caseId) ||
        left.runId.localeCompare(right.runId),
    );
  const captureStatusByCase = dataset.suite.cases
    .map((evalCase) =>
      evaluateHumanEvalCaseCapturePolicy(evalCase.id, liveRuns, requiredDistinctTreatments),
    )
    .sort((left, right) => left.caseId.localeCompare(right.caseId));

  const signedOffRunIds = new Set(dataset.blindSignoffs.map((signoff) => signoff.runId));
  const pendingSignoffs = liveRuns
    .filter((run) => !signedOffRunIds.has(run.runId))
    .map((run) => ({ caseId: run.caseRef.caseId, runId: run.runId }))
    .sort(compareCaseAndRun);
  const blockedByUnsignedRunIds = unsignedHumanEvalRunIds(dataset.runs, signedOffRunIds);
  const retired = dataset.suite.status === 'retired';
  const reviewStage: HumanEvalCollectionReviewStage = retired
    ? { status: 'not_actionable_retired_suite', blockedByUnsignedRunIds }
    : blockedByUnsignedRunIds.length > 0
      ? { status: 'blocked_by_unsigned_runs', blockedByUnsignedRunIds }
      : { status: 'open', blockedByUnsignedRunIds: [] };

  const activeAnnotations = resolveActiveHumanEvalAnnotations(
    dataset.annotations,
  ).activeAnnotations;
  const annotationsByRun = new Map<string, Array<(typeof activeAnnotations)[number]>>();
  for (const annotation of activeAnnotations) {
    const existing = annotationsByRun.get(annotation.runId) ?? [];
    existing.push(annotation);
    annotationsByRun.set(annotation.runId, existing);
  }
  const adjudicatedRunIds = new Set(
    dataset.adjudications.map((adjudication) => adjudication.runId),
  );
  const pendingReviews: HumanEvalCollectionReview[] = [];
  const pendingAdjudications: HumanEvalCollectionAdjudication[] = [];
  if (!retired) {
    for (const run of liveRuns) {
      const annotations = annotationsByRun.get(run.runId) ?? [];
      const reviewPolicy = evaluateHumanEvalRunReviewPolicy(annotations, {
        minimumIndependentAnnotationsPerRun: requiredIndependentReviewers,
        hasAdjudication: adjudicatedRunIds.has(run.runId),
      });
      if (!reviewPolicy.meetsIndependentReviewerMinimum) {
        pendingReviews.push({
          caseId: run.caseRef.caseId,
          runId: run.runId,
          currentIndependentReviewerCount: reviewPolicy.currentIndependentReviewerCount,
          requiredIndependentReviewerCount: requiredIndependentReviewers,
          remainingIndependentReviewerCount:
            requiredIndependentReviewers - reviewPolicy.currentIndependentReviewerCount,
        });
        continue;
      }
      if (reviewPolicy.adjudicationEligible) {
        pendingAdjudications.push({ caseId: run.caseRef.caseId, runId: run.runId });
      }
    }
  }
  pendingReviews.sort(compareCaseAndRun);
  pendingAdjudications.sort(compareCaseAndRun);
  const reviewActionsOpen = reviewStage.status === 'open';
  const signoffs = retired ? [] : pendingSignoffs;
  const reviews = reviewActionsOpen ? pendingReviews : [];
  const adjudications = reviewActionsOpen ? pendingAdjudications : [];

  return {
    formatVersion: '1.0.0',
    suite: {
      suiteId: dataset.suite.suiteId,
      suiteVersion: dataset.suite.suiteVersion,
      status: dataset.suite.status,
    },
    target: 'collection_policy_minimums',
    actionability: retired ? 'retired_suite' : 'actionable',
    releaseReadiness: 'not_assessed',
    captureStatusByCase,
    signoffs,
    reviewStage,
    reviews,
    adjudications,
    collectionPolicyMinimumsMet:
      !retired &&
      captureStatusByCase.every((capture) => capture.remainingDistinctTreatments === 0) &&
      blockedByUnsignedRunIds.length === 0 &&
      pendingSignoffs.length === 0 &&
      pendingReviews.length === 0 &&
      pendingAdjudications.length === 0,
  };
}
