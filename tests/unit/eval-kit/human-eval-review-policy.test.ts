import { describe, expect, it } from 'vitest';

import {
  contentWithoutIntegrity,
  createHumanEvalIntegrity,
  evaluateHumanEvalRunReviewPolicy,
  resolveActiveHumanEvalAnnotations,
} from '@operatingline/eval-kit';

import {
  buildHumanEvalAnnotationFixture,
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const reviewerMinimums = [3, 4, 5, 6, 7, 8, 9, 10] as const;

function annotationId(index: number): string {
  return `20000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function buildAnnotations(count: number) {
  const suite = buildHumanEvalSuiteFixture();
  const run = buildProviderEvalRunFixture(suite);
  const annotations = Array.from({ length: count }, (_, index) =>
    buildHumanEvalAnnotationFixture(
      suite,
      run,
      `reviewer.${index + 1}`,
      annotationId(index + 1),
      index === count - 1 ? 'not_met' : 'met',
    ),
  );
  return { annotations, run, suite };
}

describe('human eval review policy', () => {
  it.each(reviewerMinimums)(
    'does not allow adjudication with minimum %i when one reviewer is missing',
    (minimumIndependentAnnotationsPerRun) => {
      const { annotations } = buildAnnotations(minimumIndependentAnnotationsPerRun - 1);
      const resolved = resolveActiveHumanEvalAnnotations(annotations);
      const policy = evaluateHumanEvalRunReviewPolicy(resolved.activeAnnotations, {
        minimumIndependentAnnotationsPerRun,
        hasAdjudication: false,
      });

      expect(resolved.issues).toEqual([]);
      expect(policy).toMatchObject({
        currentIndependentReviewerCount: minimumIndependentAnnotationsPerRun - 1,
        meetsIndependentReviewerMinimum: false,
        hasCriterionDisagreement: true,
        adjudicationPreconditionsSatisfied: false,
        adjudicationEligible: false,
        annotationState: 'incomplete',
      });
    },
  );

  it.each(reviewerMinimums)(
    'allows adjudication with minimum %i after the final reviewer introduces disagreement',
    (minimumIndependentAnnotationsPerRun) => {
      const { annotations } = buildAnnotations(minimumIndependentAnnotationsPerRun);
      const resolved = resolveActiveHumanEvalAnnotations(annotations);
      const policy = evaluateHumanEvalRunReviewPolicy(resolved.activeAnnotations, {
        minimumIndependentAnnotationsPerRun,
        hasAdjudication: false,
      });

      expect(policy).toMatchObject({
        currentIndependentReviewerCount: minimumIndependentAnnotationsPerRun,
        meetsIndependentReviewerMinimum: true,
        hasCriterionDisagreement: true,
        adjudicationPreconditionsSatisfied: true,
        adjudicationEligible: true,
        annotationState: 'disagreement_preserved',
      });
    },
  );

  it.each(reviewerMinimums)(
    'does not allow another adjudication with minimum %i after the run is adjudicated',
    (minimumIndependentAnnotationsPerRun) => {
      const { annotations } = buildAnnotations(minimumIndependentAnnotationsPerRun);
      const resolved = resolveActiveHumanEvalAnnotations(annotations);
      const policy = evaluateHumanEvalRunReviewPolicy(resolved.activeAnnotations, {
        minimumIndependentAnnotationsPerRun,
        hasAdjudication: true,
      });

      expect(policy).toMatchObject({
        adjudicationPreconditionsSatisfied: true,
        adjudicationEligible: false,
        annotationState: 'adjudicated',
      });
    },
  );

  it.each(reviewerMinimums)(
    'counts a superseding correction as one active reviewer with minimum %i',
    (minimumIndependentAnnotationsPerRun) => {
      const { annotations, run, suite } = buildAnnotations(minimumIndependentAnnotationsPerRun - 1);
      const original = annotations[0]!;
      const replacementContent = contentWithoutIntegrity(
        buildHumanEvalAnnotationFixture(
          suite,
          run,
          original.reviewer.pseudonym,
          annotationId(100 + minimumIndependentAnnotationsPerRun),
          'partially_met',
        ),
      );
      replacementContent.supersedesAnnotationId = original.annotationId;
      const replacement = {
        ...replacementContent,
        integrity: createHumanEvalIntegrity(replacementContent),
      };

      const resolved = resolveActiveHumanEvalAnnotations([...annotations, replacement]);
      const policy = evaluateHumanEvalRunReviewPolicy(resolved.activeAnnotations, {
        minimumIndependentAnnotationsPerRun,
        hasAdjudication: false,
      });

      expect(resolved.issues).toEqual([]);
      expect(resolved.activeAnnotations).toHaveLength(minimumIndependentAnnotationsPerRun - 1);
      expect(resolved.activeAnnotations).toContainEqual(
        expect.objectContaining({ annotationId: replacement.annotationId }),
      );
      expect(policy.currentIndependentReviewerCount).toBe(minimumIndependentAnnotationsPerRun - 1);
      expect(policy.adjudicationEligible).toBe(false);
    },
  );
});
