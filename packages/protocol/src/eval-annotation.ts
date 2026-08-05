import { z } from 'zod';

import {
  evalContentSha256Schema,
  humanEvalCaseReferenceSchema,
  humanEvalDataHandlingSchema,
  humanEvalFormatVersionSchema,
  humanEvalIntegritySchema,
} from './eval-common.js';
import { humanEvalEvidenceKindSchema } from './eval-suite.js';
import { guideStepIdSchema } from './guide.js';

export const humanEvalJudgmentSchema = z.enum([
  'met',
  'partially_met',
  'not_met',
  'unable_to_judge',
  'not_applicable',
]);
export type HumanEvalJudgment = z.infer<typeof humanEvalJudgmentSchema>;

export const humanEvalEvidenceReferenceSchema = z.strictObject({
  kind: humanEvalEvidenceKindSchema,
  locator: z.string().trim().min(1).max(2_000),
  contentSha256: evalContentSha256Schema.nullable(),
  note: z.string().trim().min(1).max(2_000),
});
export type HumanEvalEvidenceReference = z.infer<typeof humanEvalEvidenceReferenceSchema>;

export const humanEvalCriterionJudgmentSchema = z.strictObject({
  criterionId: guideStepIdSchema,
  judgment: humanEvalJudgmentSchema,
  rationale: z.string().trim().min(1).max(4_000),
  evidence: z.array(humanEvalEvidenceReferenceSchema).min(1).max(32),
});
export type HumanEvalCriterionJudgment = z.infer<typeof humanEvalCriterionJudgmentSchema>;

export const humanEvalAnnotationSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    annotationId: z.uuid(),
    caseRef: humanEvalCaseReferenceSchema,
    runId: z.uuid(),
    runContentSha256: evalContentSha256Schema,
    rubric: z.strictObject({
      id: guideStepIdSchema,
      version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
      contentSha256: evalContentSha256Schema,
    }),
    reviewer: z.strictObject({
      pseudonym: guideStepIdSchema,
      qualificationId: guideStepIdSchema,
      calibrationVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
      locale: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
    }),
    review: z.strictObject({
      providerIdentityVisible: z.literal(false),
      startedAt: z.iso.datetime({ offset: true }),
      completedAt: z.iso.datetime({ offset: true }),
      recommendation: z.enum(['accept', 'revise', 'unable_to_judge']),
      judgments: z.array(humanEvalCriterionJudgmentSchema).min(1).max(64),
    }),
    sourceKind: z.literal('human_annotation'),
    supersedesAnnotationId: z.uuid().nullable(),
    dataHandling: humanEvalDataHandlingSchema,
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((annotation, context) => {
    const criterionIds = annotation.review.judgments.map((judgment) => judgment.criterionId);
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['review', 'judgments'],
        message: 'An annotation may judge each criterion only once',
      });
    }
    if (Date.parse(annotation.review.completedAt) < Date.parse(annotation.review.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['review', 'completedAt'],
        message: 'Review completion cannot precede its start',
      });
    }
    if (annotation.supersedesAnnotationId === annotation.annotationId) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesAnnotationId'],
        message: 'An annotation cannot supersede itself',
      });
    }
  });
export type HumanEvalAnnotation = z.infer<typeof humanEvalAnnotationSchema>;

export const humanEvalAnnotationReferenceSchema = z.strictObject({
  annotationId: z.uuid(),
  annotationContentSha256: evalContentSha256Schema,
});
export type HumanEvalAnnotationReference = z.infer<typeof humanEvalAnnotationReferenceSchema>;

export const humanEvalAdjudicationSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    adjudicationId: z.uuid(),
    caseRef: humanEvalCaseReferenceSchema,
    runId: z.uuid(),
    annotationRefs: z.array(humanEvalAnnotationReferenceSchema).min(2).max(10),
    adjudicatorPseudonym: guideStepIdSchema,
    completedAt: z.iso.datetime({ offset: true }),
    judgments: z.array(humanEvalCriterionJudgmentSchema).min(1).max(64),
    sourceKind: z.literal('human_adjudication'),
    dataHandling: humanEvalDataHandlingSchema,
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((adjudication, context) => {
    const annotationIds = adjudication.annotationRefs.map((reference) => reference.annotationId);
    if (new Set(annotationIds).size !== annotationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['annotationRefs'],
        message: 'Adjudication annotation references must use unique ids',
      });
    }
    const criterionIds = adjudication.judgments.map((judgment) => judgment.criterionId);
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['judgments'],
        message: 'Adjudication may judge each criterion only once',
      });
    }
  });
export type HumanEvalAdjudication = z.infer<typeof humanEvalAdjudicationSchema>;
