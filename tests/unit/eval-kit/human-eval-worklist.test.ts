import { describe, expect, it } from 'vitest';

import {
  buildHumanEvalCollectionWorklist,
  contentWithoutIntegrity,
  createHumanEvalIntegrity,
  type ValidatedHumanEvalDataset,
} from '@operatingline/eval-kit';
import type {
  HumanEvalAdjudication,
  HumanEvalAnnotation,
  HumanEvalSuite,
  ProviderEvalRun,
} from '@operatingline/protocol';

import {
  buildHumanEvalAnnotationFixture,
  buildHumanEvalSuiteFixture,
  buildProviderBlindSignoffFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

function reseal<T extends { integrity: unknown }>(record: T): T {
  const content = contentWithoutIntegrity(record);
  return { ...content, integrity: createHumanEvalIntegrity(content) } as T;
}

function runWith(
  base: ProviderEvalRun,
  options: {
    readonly runId: string;
    readonly sourceKind?: ProviderEvalRun['sourceKind'];
    readonly conditionSha256?: string;
    readonly treatmentSha256?: string;
  },
): ProviderEvalRun {
  return {
    ...base,
    runId: options.runId,
    sourceKind: options.sourceKind ?? 'live_provider_invocation',
    comparability: {
      ...base.comparability,
      conditionSha256: options.conditionSha256 ?? base.comparability.conditionSha256,
      treatmentSha256: options.treatmentSha256 ?? base.comparability.treatmentSha256,
    },
  };
}

function datasetWith(
  runs: readonly ProviderEvalRun[],
  options: {
    readonly annotations?: readonly HumanEvalAnnotation[];
    readonly adjudications?: readonly HumanEvalAdjudication[];
    readonly signedRunIds?: readonly string[];
    readonly suiteStatus?: HumanEvalSuite['status'];
  } = {},
): ValidatedHumanEvalDataset {
  const baseSuite = buildHumanEvalSuiteFixture();
  const suite =
    options.suiteStatus === undefined
      ? baseSuite
      : reseal({ ...baseSuite, status: options.suiteStatus });
  const blindSignoffs = runs
    .filter((run) => options.signedRunIds?.includes(run.runId))
    .map((run) => buildProviderBlindSignoffFixture(suite, run));
  return {
    verificationLevel: 'structure_only',
    suite,
    casesById: new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase])),
    runs,
    runsById: new Map(runs.map((run) => [run.runId, run])),
    annotations: options.annotations ?? [],
    adjudications: options.adjudications ?? [],
    blindSignoffs,
    blindSignoffsByRunId: new Map(blindSignoffs.map((signoff) => [signoff.runId, signoff])),
  };
}

function supersedingAnnotation(
  annotation: HumanEvalAnnotation,
  annotationId: string,
  judgment: 'met' | 'partially_met' | 'not_met',
): HumanEvalAnnotation {
  const replacement = structuredClone(annotation);
  replacement.annotationId = annotationId;
  replacement.supersedesAnnotationId = annotation.annotationId;
  replacement.review.recommendation = judgment === 'not_met' ? 'revise' : 'accept';
  replacement.review.judgments = replacement.review.judgments.map((entry) => ({
    ...entry,
    judgment,
  }));
  return reseal(replacement);
}

describe('buildHumanEvalCollectionWorklist', () => {
  it('excludes synthetic runs from signoff, review, and adjudication work', () => {
    const suite = buildHumanEvalSuiteFixture();
    const synthetic = buildProviderEvalRunFixture(suite);

    const worklist = buildHumanEvalCollectionWorklist(datasetWith([synthetic]));

    expect(worklist.captureStatusByCase).toEqual([
      {
        caseId: 'canvas.launch_diagram',
        requiredDistinctTreatments: 2,
        conditionGroups: [],
        bestDistinctTreatmentCount: 0,
        remainingDistinctTreatments: 2,
      },
    ]);
    expect(worklist.signoffs).toEqual([]);
    expect(worklist.reviews).toEqual([]);
    expect(worklist.adjudications).toEqual([]);
    expect(worklist.reviewStage).toEqual({
      status: 'blocked_by_unsigned_runs',
      blockedByUnsignedRunIds: [synthetic.runId],
    });
    expect(worklist.releaseReadiness).toBe('not_assessed');
    expect(worklist.collectionPolicyMinimumsMet).toBe(false);
  });

  it('groups live captures by condition, counts distinct treatments, and lists exact run deficits', () => {
    const suite = buildHumanEvalSuiteFixture();
    const base = buildProviderEvalRunFixture(suite);
    const conditionA = 'a'.repeat(64);
    const conditionB = 'b'.repeat(64);
    const first = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000011',
      conditionSha256: conditionA,
      treatmentSha256: '1'.repeat(64),
    });
    const repeatedTreatment = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000012',
      conditionSha256: conditionA,
      treatmentSha256: '1'.repeat(64),
    });
    const otherCondition = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000013',
      conditionSha256: conditionB,
      treatmentSha256: '2'.repeat(64),
    });
    const firstReview = buildHumanEvalAnnotationFixture(
      suite,
      first,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000011',
    );
    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([otherCondition, repeatedTreatment, first], {
        annotations: [firstReview],
        signedRunIds: [first.runId],
      }),
    );

    expect(worklist.captureStatusByCase[0]).toMatchObject({
      conditionGroups: [
        { conditionSha256: conditionA, liveRunCount: 2, distinctTreatmentCount: 1 },
        { conditionSha256: conditionB, liveRunCount: 1, distinctTreatmentCount: 1 },
      ],
      bestDistinctTreatmentCount: 1,
      remainingDistinctTreatments: 1,
    });
    expect(worklist.signoffs).toEqual([
      { caseId: 'canvas.launch_diagram', runId: repeatedTreatment.runId },
      { caseId: 'canvas.launch_diagram', runId: otherCondition.runId },
    ]);
    expect(worklist.reviewStage).toEqual({
      status: 'blocked_by_unsigned_runs',
      blockedByUnsignedRunIds: [repeatedTreatment.runId, otherCondition.runId],
    });
    expect(worklist.reviews).toEqual([]);
    expect(JSON.stringify(worklist)).toBe(
      JSON.stringify(
        buildHumanEvalCollectionWorklist(
          datasetWith([otherCondition, repeatedTreatment, first], {
            annotations: [firstReview],
            signedRunIds: [first.runId],
          }),
        ),
      ),
    );
  });

  it('uses only active superseding annotations when deciding whether disagreement remains', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = runWith(buildProviderEvalRunFixture(suite), {
      runId: '10000000-0000-4000-8000-000000000021',
    });
    const original = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000021',
      'met',
    );
    const replacement = supersedingAnnotation(
      original,
      '20000000-0000-4000-8000-000000000022',
      'not_met',
    );
    const agreeingReview = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.beta',
      '20000000-0000-4000-8000-000000000023',
      'not_met',
    );

    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([run], {
        annotations: [original, replacement, agreeingReview],
        signedRunIds: [run.runId],
      }),
    );

    expect(worklist.reviews).toEqual([]);
    expect(worklist.adjudications).toEqual([]);
  });

  it('opens review actions only after the global sign-off gate is clear', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = runWith(buildProviderEvalRunFixture(suite), {
      runId: '10000000-0000-4000-8000-000000000024',
    });
    const firstReview = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000024',
    );

    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([run], {
        annotations: [firstReview],
        signedRunIds: [run.runId],
      }),
    );

    expect(worklist.reviewStage).toEqual({
      status: 'open',
      blockedByUnsignedRunIds: [],
    });
    expect(worklist.reviews).toEqual([
      {
        caseId: 'canvas.launch_diagram',
        runId: run.runId,
        currentIndependentReviewerCount: 1,
        requiredIndependentReviewerCount: 2,
        remainingIndependentReviewerCount: 1,
      },
    ]);
  });

  it('queues sufficient current disagreement until the exact run is adjudicated', () => {
    const suite = buildHumanEvalSuiteFixture();
    const base = buildProviderEvalRunFixture(suite);
    const first = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000031',
      conditionSha256: 'a'.repeat(64),
      treatmentSha256: '1'.repeat(64),
    });
    const second = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000032',
      conditionSha256: 'a'.repeat(64),
      treatmentSha256: '2'.repeat(64),
    });
    const annotations = [first, second].flatMap((run, index) => [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        `20000000-0000-4000-8000-00000000003${index * 2 + 1}`,
        'met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        `20000000-0000-4000-8000-00000000003${index * 2 + 2}`,
        'not_met',
      ),
    ]);
    const adjudication = {
      runId: first.runId,
    } as HumanEvalAdjudication;
    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([second, first], {
        annotations,
        adjudications: [adjudication],
        signedRunIds: [first.runId, second.runId],
      }),
    );

    expect(worklist.adjudications).toEqual([
      { caseId: 'canvas.launch_diagram', runId: second.runId },
    ]);
    expect(worklist.collectionPolicyMinimumsMet).toBe(false);

    const completed = buildHumanEvalCollectionWorklist(
      datasetWith([second, first], {
        annotations,
        adjudications: [adjudication, { runId: second.runId } as HumanEvalAdjudication],
        signedRunIds: [first.runId, second.runId],
      }),
    );
    expect(completed.collectionPolicyMinimumsMet).toBe(true);
    expect(completed.releaseReadiness).toBe('not_assessed');
  });

  it('does not report collection minimums met while an unsigned non-live run blocks review', () => {
    const suite = buildHumanEvalSuiteFixture();
    const base = buildProviderEvalRunFixture(suite);
    const first = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000041',
      conditionSha256: 'a'.repeat(64),
      treatmentSha256: '1'.repeat(64),
    });
    const second = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000042',
      conditionSha256: 'a'.repeat(64),
      treatmentSha256: '2'.repeat(64),
    });
    const synthetic = runWith(base, {
      runId: '10000000-0000-4000-8000-000000000043',
      sourceKind: 'synthetic_test_fixture',
    });
    const annotations = [first, second].flatMap((run, index) =>
      ['reviewer.alpha', 'reviewer.beta'].map((reviewer, reviewerIndex) =>
        buildHumanEvalAnnotationFixture(
          suite,
          run,
          reviewer,
          `20000000-0000-4000-8${index}0${reviewerIndex}-000000000040`,
          'met',
        ),
      ),
    );

    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([first, second, synthetic], {
        annotations,
        signedRunIds: [first.runId, second.runId],
      }),
    );

    expect(worklist.captureStatusByCase[0]?.remainingDistinctTreatments).toBe(0);
    expect(worklist.reviewStage).toEqual({
      status: 'blocked_by_unsigned_runs',
      blockedByUnsignedRunIds: [synthetic.runId],
    });
    expect(worklist.collectionPolicyMinimumsMet).toBe(false);
  });

  it('marks retired suites non-actionable without emitting collection tasks', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = runWith(buildProviderEvalRunFixture(suite), {
      runId: '10000000-0000-4000-8000-000000000051',
    });

    const worklist = buildHumanEvalCollectionWorklist(
      datasetWith([run], { suiteStatus: 'retired' }),
    );

    expect(worklist.actionability).toBe('retired_suite');
    expect(worklist.reviewStage).toEqual({
      status: 'not_actionable_retired_suite',
      blockedByUnsignedRunIds: [run.runId],
    });
    expect(worklist.signoffs).toEqual([]);
    expect(worklist.reviews).toEqual([]);
    expect(worklist.adjudications).toEqual([]);
    expect(worklist.collectionPolicyMinimumsMet).toBe(false);
  });
});
