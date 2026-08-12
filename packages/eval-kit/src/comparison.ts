import {
  humanEvalComparisonReportSchema,
  type HumanEvalComparisonReport,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import { HumanEvalDatasetError, type ValidatedHumanEvalDataset } from './dataset.js';
import { computeHumanEvalRecordSha256, createHumanEvalIntegrity } from './integrity.js';
import {
  evaluateHumanEvalRunReviewPolicy,
  resolveActiveHumanEvalAnnotations,
} from './review-policy.js';
import { isArtifactVerifiedDataset } from './verification.js';

export function validateHumanEvalComparisonReport(input: unknown): HumanEvalComparisonReport {
  let report: HumanEvalComparisonReport;
  try {
    report = humanEvalComparisonReportSchema.parse(input);
  } catch (error) {
    throw new HumanEvalDatasetError('Human Eval comparison parsing failed', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const actual = computeHumanEvalRecordSha256(report);
  if (actual !== report.integrity.contentSha256) {
    throw new HumanEvalDatasetError('Human Eval comparison integrity failed', [
      `Comparison integrity mismatch: expected ${report.integrity.contentSha256}, got ${actual}`,
    ]);
  }
  return report;
}

export interface HumanEvalComparisonOptions {
  readonly generatedAt: string;
  readonly audience?: 'development' | 'published';
}

export function buildHumanEvalComparisonReport(
  dataset: ValidatedHumanEvalDataset,
  options: HumanEvalComparisonOptions,
): HumanEvalComparisonReport {
  const activeAnnotations = resolveActiveHumanEvalAnnotations(
    dataset.annotations,
  ).activeAnnotations;
  const annotationsByRun = new Map<string, Array<(typeof activeAnnotations)[number]>>();
  for (const annotation of activeAnnotations) {
    const existing = annotationsByRun.get(annotation.runId) ?? [];
    existing.push(annotation);
    annotationsByRun.set(annotation.runId, existing);
  }
  for (const entries of annotationsByRun.values()) {
    entries.sort((left, right) => left.annotationId.localeCompare(right.annotationId));
  }
  const adjudicationsByRun = new Map(
    dataset.adjudications.map((adjudication) => [adjudication.runId, adjudication]),
  );
  const audience = options.audience ?? 'published';
  if (audience === 'published' && !isArtifactVerifiedDataset(dataset)) {
    throw new HumanEvalDatasetError('Published comparison requires verified artifacts', [
      'Load the dataset through loadHumanEvalDatasetDirectory before building a published report',
    ]);
  }
  const selectedRuns = dataset.runs.filter(
    (run) => audience === 'development' || run.sourceKind === 'live_provider_invocation',
  );
  const runsBelowAnnotationMinimum: string[] = [];
  const casesWithoutLiveRuns: string[] = [];
  const cases = dataset.suite.cases.map((evalCase) => {
    const caseRuns = selectedRuns.filter((run) => run.caseRef.caseId === evalCase.id);
    const liveRuns = dataset.runs.filter(
      (run) => run.caseRef.caseId === evalCase.id && run.sourceKind === 'live_provider_invocation',
    );
    if (liveRuns.length === 0) {
      casesWithoutLiveRuns.push(evalCase.id);
    }
    const groups = new Map<string, ProviderEvalRun[]>();
    for (const run of caseRuns) {
      const group = groups.get(run.comparability.conditionSha256) ?? [];
      group.push(run);
      groups.set(run.comparability.conditionSha256, group);
    }
    return {
      caseId: evalCase.id,
      conditionGroups: [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([conditionSha256, runs]) => ({
          conditionSha256,
          runs: runs
            .sort((left, right) => left.runId.localeCompare(right.runId))
            .map((run) => {
              const annotations = annotationsByRun.get(run.runId) ?? [];
              const adjudication = adjudicationsByRun.get(run.runId);
              const state = evaluateHumanEvalRunReviewPolicy(annotations, {
                minimumIndependentAnnotationsPerRun:
                  dataset.suite.policy.minimumIndependentAnnotationsPerRun,
                hasAdjudication: adjudication !== undefined,
              }).annotationState;
              if (state === 'missing' || state === 'incomplete') {
                runsBelowAnnotationMinimum.push(run.runId);
              }
              return {
                runId: run.runId,
                runContentSha256: run.integrity.contentSha256,
                sourceKind: run.sourceKind,
                treatmentSha256: run.comparability.treatmentSha256,
                providerId: run.profile.descriptor.id,
                providerVersion: run.profile.descriptor.version,
                requestedModel: run.profile.model.requested,
                outcome: run.outcome.status,
                annotationState: state,
                annotations: annotations.map((annotation) => ({
                  annotationId: annotation.annotationId,
                  annotationContentSha256: annotation.integrity.contentSha256,
                  reviewerPseudonym: annotation.reviewer.pseudonym,
                  recommendation: annotation.review.recommendation,
                  judgments: annotation.review.judgments.map((judgment) => ({
                    criterionId: judgment.criterionId,
                    judgment: judgment.judgment,
                  })),
                })),
                adjudication:
                  adjudication === undefined
                    ? null
                    : {
                        adjudicationId: adjudication.adjudicationId,
                        adjudicationContentSha256: adjudication.integrity.contentSha256,
                        adjudicatorPseudonym: adjudication.adjudicatorPseudonym,
                        judgments: adjudication.judgments.map((judgment) => ({
                          criterionId: judgment.criterionId,
                          judgment: judgment.judgment,
                        })),
                      },
              };
            }),
        })),
      missingLiveRun: liveRuns.length === 0,
    };
  });
  const includedRuns = cases.flatMap((evalCase) =>
    evalCase.conditionGroups.flatMap((group) => group.runs),
  );
  const liveRunCount = includedRuns.filter(
    (run) => run.sourceKind === 'live_provider_invocation',
  ).length;
  const includedSyntheticRunCount = includedRuns.length - liveRunCount;
  const sourceSyntheticRunCount = dataset.runs.filter(
    (run) => run.sourceKind === 'synthetic_test_fixture',
  ).length;
  const content = {
    formatVersion: '1.0.0' as const,
    generatedAt: options.generatedAt,
    audience,
    suite: {
      suiteId: dataset.suite.suiteId,
      suiteVersion: dataset.suite.suiteVersion,
      contentSha256: dataset.suite.integrity.contentSha256,
    },
    sourceRecords: {
      runs: dataset.runs
        .map((run) => ({
          id: run.runId,
          contentSha256: run.integrity.contentSha256,
          sourceKind: run.sourceKind,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      annotations: dataset.annotations
        .map((annotation) => ({
          id: annotation.annotationId,
          contentSha256: annotation.integrity.contentSha256,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      adjudications: dataset.adjudications
        .map((adjudication) => ({
          id: adjudication.adjudicationId,
          contentSha256: adjudication.integrity.contentSha256,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
    policy: {
      numericScoring: false as const,
      providerRanking: false as const,
      interpretation: 'human_judgments_only' as const,
    },
    cases,
    completeness: {
      caseCount: dataset.suite.cases.length,
      runCount: includedRuns.length,
      liveRunCount,
      includedSyntheticRunCount,
      excludedSyntheticRunCount: sourceSyntheticRunCount - includedSyntheticRunCount,
      currentAnnotationCount: includedRuns.reduce(
        (count, run) => count + run.annotations.length,
        0,
      ),
      rawAnnotationRecordCount: dataset.annotations.length,
      adjudicationCount: includedRuns.filter((run) => run.adjudication !== null).length,
      casesWithoutLiveRuns,
      runsBelowAnnotationMinimum,
    },
  };
  return validateHumanEvalComparisonReport({
    ...content,
    integrity: createHumanEvalIntegrity(content),
  });
}
