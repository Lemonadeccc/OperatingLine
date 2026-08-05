import { z } from 'zod';

import {
  evalArtifactReferenceSchema,
  evalContentSha256Schema,
  humanEvalDataHandlingSchema,
  humanEvalFormatVersionSchema,
  humanEvalIntegritySchema,
} from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import { planningPromptRequestSchema } from './prompt.js';
import { catalogVersionSchema } from './version.js';

const uniqueIds = <T extends { id: string }>(
  values: readonly T[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
) => {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path, message: `${label} ids must be unique` });
  }
};

export const humanEvalCriterionDimensionSchema = z.enum([
  'goal_decomposition',
  'capability_honesty',
  'parameter_semantics',
  'teaching_clarity',
  'execution_outcome',
  'visual_alignment',
]);
export type HumanEvalCriterionDimension = z.infer<typeof humanEvalCriterionDimensionSchema>;

export const humanEvalEvidenceKindSchema = z.enum([
  'requirement',
  'plan_step',
  'execution_event',
  'artifact',
  'run_output',
]);
export type HumanEvalEvidenceKind = z.infer<typeof humanEvalEvidenceKindSchema>;

export const humanEvalRubricCriterionSchema = z.strictObject({
  id: guideStepIdSchema,
  title: z.string().trim().min(1).max(180),
  dimension: humanEvalCriterionDimensionSchema,
  evaluationStage: z.enum(['plan', 'execution', 'artifact']),
  question: z.string().trim().min(1).max(2_000),
  guidance: z.string().trim().min(1).max(4_000),
  evidenceKinds: z
    .array(humanEvalEvidenceKindSchema)
    .min(1)
    .superRefine((kinds, context) => {
      if (new Set(kinds).size !== kinds.length) {
        context.addIssue({ code: 'custom', message: 'Evidence kinds must be unique' });
      }
    }),
});
export type HumanEvalRubricCriterion = z.infer<typeof humanEvalRubricCriterionSchema>;

export const humanEvalRubricSchema = z
  .strictObject({
    id: guideStepIdSchema,
    version: catalogVersionSchema,
    title: z.string().trim().min(1).max(180),
    criteria: z.array(humanEvalRubricCriterionSchema).min(1).max(64),
  })
  .superRefine((rubric, context) => uniqueIds(rubric.criteria, context, ['criteria'], 'Criterion'));
export type HumanEvalRubric = z.infer<typeof humanEvalRubricSchema>;

export const humanEvalRequirementSchema = z.strictObject({
  id: guideStepIdSchema,
  importance: z.enum(['must', 'must_not', 'should']),
  statement: z.string().trim().min(1).max(2_000),
});
export type HumanEvalRequirement = z.infer<typeof humanEvalRequirementSchema>;

const humanEvalCaseCommonSchema = z.strictObject({
  id: guideStepIdSchema,
  lineageId: guideStepIdSchema,
  title: z.string().trim().min(1).max(180),
  difficulty: z.enum(['basic', 'intermediate', 'adversarial']),
  language: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  tags: z
    .array(guideStepIdSchema)
    .min(1)
    .max(32)
    .superRefine((tags, context) => {
      if (new Set(tags).size !== tags.length) {
        context.addIssue({ code: 'custom', message: 'Case tags must be unique' });
      }
    }),
  requirements: z.array(humanEvalRequirementSchema).min(1).max(64),
  rubricCriterionIds: z.array(guideStepIdSchema).min(1).max(64),
  catalogContentSha256: evalContentSha256Schema,
  references: z.array(evalArtifactReferenceSchema).max(16).default([]),
});

export const humanEvalInitialPlanningCaseSchema = humanEvalCaseCommonSchema.extend({
  operation: z.literal('initial_plan'),
  request: planningPromptRequestSchema.extend({ catalogVersion: catalogVersionSchema }),
});

export const humanEvalLocalReplanCaseSchema = humanEvalCaseCommonSchema.extend({
  operation: z.literal('local_replan'),
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema,
  basePlan: z.strictObject({
    artifactId: guideStepIdSchema,
    planId: z.string().trim().min(1).max(180),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    planContentSha256: evalContentSha256Schema,
  }),
  revisionMessage: z.string().trim().min(1).max(10_000),
  referencedNodeIds: z
    .array(guideStepIdSchema)
    .min(1)
    .max(8)
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: 'Referenced node ids must be unique' });
      }
    }),
});

export const humanEvalCaseSchema = z
  .discriminatedUnion('operation', [
    humanEvalInitialPlanningCaseSchema,
    humanEvalLocalReplanCaseSchema,
  ])
  .superRefine((evalCase, context) => {
    uniqueIds(evalCase.requirements, context, ['requirements'], 'Requirement');
    if (new Set(evalCase.rubricCriterionIds).size !== evalCase.rubricCriterionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['rubricCriterionIds'],
        message: 'Rubric criterion ids must be unique',
      });
    }
    const artifactIds = new Set(evalCase.references.map((reference) => reference.artifactId));
    if (artifactIds.size !== evalCase.references.length) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Case artifact ids must be unique',
      });
    }
    if (evalCase.operation === 'local_replan') {
      const basePlanArtifact = evalCase.references.find(
        (reference) => reference.artifactId === evalCase.basePlan.artifactId,
      );
      if (basePlanArtifact === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['basePlan', 'artifactId'],
          message: 'Local replan base plan must reference one declared case artifact',
        });
      } else if (
        basePlanArtifact.kind !== 'guide_plan' ||
        basePlanArtifact.mediaType !== 'application/json'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['basePlan', 'artifactId'],
          message: 'Local replan base plan artifact must be a JSON GuidePlan',
        });
      }
    }
  });
export type HumanEvalCase = z.infer<typeof humanEvalCaseSchema>;

export const humanEvalSuiteSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    suiteId: guideStepIdSchema,
    suiteVersion: catalogVersionSchema,
    status: z.enum(['collecting', 'released', 'retired']),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(4_000),
    licenseId: z.string().trim().min(1).max(180),
    rubric: humanEvalRubricSchema,
    policy: z.strictObject({
      numericScoring: z.literal('prohibited'),
      providerRanking: z.literal('prohibited'),
      minimumIndependentAnnotationsPerRun: z.number().int().min(2).max(10),
      minimumDistinctTreatmentsPerCase: z.number().int().min(2).max(20),
      providerIdentityBlinding: z.literal('required'),
      disagreementHandling: z.literal('preserve_and_adjudicate'),
      missingRuns: z.literal('report_as_missing'),
      syntheticRunsInPublishedComparison: z.literal('prohibited'),
    }),
    cases: z.array(humanEvalCaseSchema).min(1).max(1_000),
    dataHandling: humanEvalDataHandlingSchema,
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((suite, context) => {
    uniqueIds(suite.cases, context, ['cases'], 'Case');
    const criterionIds = new Set(suite.rubric.criteria.map((criterion) => criterion.id));
    for (const [caseIndex, evalCase] of suite.cases.entries()) {
      for (const [criterionIndex, criterionId] of evalCase.rubricCriterionIds.entries()) {
        if (!criterionIds.has(criterionId)) {
          context.addIssue({
            code: 'custom',
            path: ['cases', caseIndex, 'rubricCriterionIds', criterionIndex],
            message: `Unknown rubric criterion ${criterionId}`,
          });
        }
      }
    }
  });
export type HumanEvalSuite = z.infer<typeof humanEvalSuiteSchema>;
