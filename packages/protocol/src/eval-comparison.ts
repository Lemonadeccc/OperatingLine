import { z } from 'zod';

import {
  evalContentSha256Schema,
  humanEvalFormatVersionSchema,
  humanEvalIntegritySchema,
} from './eval-common.js';
import { humanEvalJudgmentSchema } from './eval-annotation.js';
import { guideStepIdSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

const comparisonAnnotationSchema = z.strictObject({
  annotationId: z.uuid(),
  annotationContentSha256: evalContentSha256Schema,
  reviewerPseudonym: guideStepIdSchema,
  recommendation: z.enum(['accept', 'revise', 'unable_to_judge']),
  judgments: z.array(
    z.strictObject({
      criterionId: guideStepIdSchema,
      judgment: humanEvalJudgmentSchema,
    }),
  ),
});

const comparisonAdjudicationSchema = z.strictObject({
  adjudicationId: z.uuid(),
  adjudicationContentSha256: evalContentSha256Schema,
  adjudicatorPseudonym: guideStepIdSchema,
  judgments: z.array(
    z.strictObject({
      criterionId: guideStepIdSchema,
      judgment: humanEvalJudgmentSchema,
    }),
  ),
});

const sourceRecordReferenceSchema = z.strictObject({
  id: z.uuid(),
  contentSha256: evalContentSha256Schema,
});

const sourceRunReferenceSchema = sourceRecordReferenceSchema.extend({
  sourceKind: z.enum(['live_provider_invocation', 'synthetic_test_fixture']),
});

const comparisonRunSchema = z
  .strictObject({
    runId: z.uuid(),
    runContentSha256: evalContentSha256Schema,
    sourceKind: z.enum(['live_provider_invocation', 'synthetic_test_fixture']),
    treatmentSha256: evalContentSha256Schema,
    providerId: guideStepIdSchema,
    providerVersion: catalogVersionSchema,
    requestedModel: z.string().min(1),
    outcome: z.enum(['completed', 'failed']),
    annotationState: z.enum([
      'missing',
      'incomplete',
      'complete',
      'disagreement_preserved',
      'adjudicated',
    ]),
    annotations: z.array(comparisonAnnotationSchema),
    adjudication: comparisonAdjudicationSchema.nullable(),
  })
  .superRefine((run, context) => {
    if ((run.annotationState === 'adjudicated') !== (run.adjudication !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['adjudication'],
        message: 'Adjudicated state must include exactly one run-level adjudication',
      });
    }
  });

export const humanEvalComparisonReportSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    audience: z.enum(['development', 'published']),
    suite: z.strictObject({
      suiteId: guideStepIdSchema,
      suiteVersion: catalogVersionSchema,
      contentSha256: evalContentSha256Schema,
    }),
    sourceRecords: z.strictObject({
      runs: z.array(sourceRunReferenceSchema),
      annotations: z.array(sourceRecordReferenceSchema),
      adjudications: z.array(sourceRecordReferenceSchema),
    }),
    policy: z.strictObject({
      numericScoring: z.literal(false),
      providerRanking: z.literal(false),
      interpretation: z.literal('human_judgments_only'),
    }),
    cases: z.array(
      z.strictObject({
        caseId: guideStepIdSchema,
        conditionGroups: z.array(
          z.strictObject({
            conditionSha256: evalContentSha256Schema,
            runs: z.array(comparisonRunSchema),
          }),
        ),
        missingLiveRun: z.boolean(),
      }),
    ),
    completeness: z.strictObject({
      caseCount: z.number().int().nonnegative(),
      runCount: z.number().int().nonnegative(),
      liveRunCount: z.number().int().nonnegative(),
      includedSyntheticRunCount: z.number().int().nonnegative(),
      excludedSyntheticRunCount: z.number().int().nonnegative(),
      currentAnnotationCount: z.number().int().nonnegative(),
      rawAnnotationRecordCount: z.number().int().nonnegative(),
      adjudicationCount: z.number().int().nonnegative(),
      casesWithoutLiveRuns: z.array(guideStepIdSchema),
      runsBelowAnnotationMinimum: z.array(z.uuid()),
    }),
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((report, context) => {
    const runs = report.cases.flatMap((evalCase) =>
      evalCase.conditionGroups.flatMap((group) => group.runs),
    );
    const annotations = runs.flatMap((run) => run.annotations);
    const adjudications = runs.flatMap((run) =>
      run.adjudication === null ? [] : [run.adjudication],
    );
    const unique = (values: readonly string[]) => new Set(values).size === values.length;
    const sameOrderedValues = (left: readonly string[], right: readonly string[]) =>
      left.length === right.length && left.every((value, index) => value === right[index]);

    if (!unique(report.cases.map((evalCase) => evalCase.caseId))) {
      context.addIssue({ code: 'custom', path: ['cases'], message: 'Case ids must be unique' });
    }
    if (!unique(runs.map((run) => run.runId))) {
      context.addIssue({ code: 'custom', path: ['cases'], message: 'Run ids must be unique' });
    }
    if (!unique(annotations.map((annotation) => annotation.annotationId))) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'Current annotation ids must be unique',
      });
    }
    for (const [label, ids] of [
      ['source run', report.sourceRecords.runs.map((record) => record.id)],
      ['source annotation', report.sourceRecords.annotations.map((record) => record.id)],
      ['source adjudication', report.sourceRecords.adjudications.map((record) => record.id)],
    ] as const) {
      if (!unique(ids)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceRecords'],
          message: `${label} ids must be unique`,
        });
      }
    }
    for (const [caseIndex, evalCase] of report.cases.entries()) {
      if (!unique(evalCase.conditionGroups.map((group) => group.conditionSha256))) {
        context.addIssue({
          code: 'custom',
          path: ['cases', caseIndex, 'conditionGroups'],
          message: 'Condition hashes must be unique within each case',
        });
      }
    }
    if (
      report.audience === 'published' &&
      runs.some((run) => run.sourceKind === 'synthetic_test_fixture')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'Published reports cannot include synthetic test runs',
      });
    }
    const expectedMissingCases = report.cases
      .filter((evalCase) => evalCase.missingLiveRun)
      .map((evalCase) => evalCase.caseId)
      .sort();
    const expectedBelowMinimum = runs
      .filter((run) => run.annotationState === 'missing' || run.annotationState === 'incomplete')
      .map((run) => run.runId)
      .sort();
    const liveRunCount = runs.filter((run) => run.sourceKind === 'live_provider_invocation').length;
    const includedSyntheticRunCount = runs.length - liveRunCount;
    const sourceSyntheticRunCount = report.sourceRecords.runs.filter(
      (run) => run.sourceKind === 'synthetic_test_fixture',
    ).length;
    if (
      report.completeness.caseCount !== report.cases.length ||
      report.completeness.runCount !== runs.length ||
      report.completeness.liveRunCount !== liveRunCount ||
      report.completeness.includedSyntheticRunCount !== includedSyntheticRunCount ||
      report.completeness.excludedSyntheticRunCount !==
        sourceSyntheticRunCount - includedSyntheticRunCount ||
      report.completeness.currentAnnotationCount !== annotations.length ||
      report.completeness.rawAnnotationRecordCount !== report.sourceRecords.annotations.length ||
      report.completeness.adjudicationCount !== adjudications.length ||
      !sameOrderedValues(
        [...report.completeness.casesWithoutLiveRuns].sort(),
        expectedMissingCases,
      ) ||
      !sameOrderedValues(
        [...report.completeness.runsBelowAnnotationMinimum].sort(),
        expectedBelowMinimum,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completeness'],
        message: 'Comparison completeness must match the exact report contents',
      });
    }
    const sourceRunById = new Map(report.sourceRecords.runs.map((run) => [run.id, run]));
    const sourceAnnotationById = new Map(
      report.sourceRecords.annotations.map((annotation) => [annotation.id, annotation]),
    );
    const sourceAdjudicationById = new Map(
      report.sourceRecords.adjudications.map((adjudication) => [adjudication.id, adjudication]),
    );
    for (const run of runs) {
      const sourceRun = sourceRunById.get(run.runId);
      if (
        sourceRun?.contentSha256 !== run.runContentSha256 ||
        sourceRun.sourceKind !== run.sourceKind
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceRecords', 'runs'],
          message: `Run ${run.runId} is not bound to its source record`,
        });
      }
      for (const annotation of run.annotations) {
        if (
          sourceAnnotationById.get(annotation.annotationId)?.contentSha256 !==
          annotation.annotationContentSha256
        ) {
          context.addIssue({
            code: 'custom',
            path: ['sourceRecords', 'annotations'],
            message: `Annotation ${annotation.annotationId} is not bound to its source record`,
          });
        }
      }
      if (
        run.adjudication !== null &&
        sourceAdjudicationById.get(run.adjudication.adjudicationId)?.contentSha256 !==
          run.adjudication.adjudicationContentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceRecords', 'adjudications'],
          message: `Adjudication ${run.adjudication.adjudicationId} is not bound to its source record`,
        });
      }
    }
  });
export type HumanEvalComparisonReport = z.infer<typeof humanEvalComparisonReportSchema>;
