import type { HumanEvalAnnotation, ProviderEvalRun } from '@operatingline/protocol';

export interface ActiveHumanEvalAnnotationResolution {
  readonly activeAnnotations: readonly HumanEvalAnnotation[];
  readonly issues: readonly string[];
}

export type HumanEvalRunAnnotationState =
  'missing' | 'incomplete' | 'complete' | 'disagreement_preserved' | 'adjudicated';

export interface HumanEvalRunReviewPolicyState {
  readonly currentIndependentReviewerCount: number;
  readonly meetsIndependentReviewerMinimum: boolean;
  readonly hasCriterionDisagreement: boolean;
  readonly adjudicationPreconditionsSatisfied: boolean;
  readonly adjudicationEligible: boolean;
  readonly annotationState: HumanEvalRunAnnotationState;
}

/** Returns every dataset run that still blocks the review workspace's global sign-off gate. */
export function unsignedHumanEvalRunIds(
  runs: readonly ProviderEvalRun[],
  signedOffRunIds: ReadonlySet<string>,
): readonly string[] {
  return runs
    .filter((run) => !signedOffRunIds.has(run.runId))
    .map((run) => run.runId)
    .sort((left, right) => left.localeCompare(right));
}

/** Resolves the current annotation heads and reports invalid supersession relationships. */
export function resolveActiveHumanEvalAnnotations(
  annotations: readonly HumanEvalAnnotation[],
): ActiveHumanEvalAnnotationResolution {
  const byId = new Map(annotations.map((annotation) => [annotation.annotationId, annotation]));
  const superseded = new Set<string>();
  const issues: string[] = [];
  for (const annotation of annotations) {
    const targetId = annotation.supersedesAnnotationId;
    if (targetId === null) {
      continue;
    }
    const target = byId.get(targetId);
    if (target === undefined) {
      issues.push(
        `Annotation ${annotation.annotationId} supersedes unknown annotation ${targetId}`,
      );
      continue;
    }
    if (
      target.runId !== annotation.runId ||
      target.reviewer.pseudonym !== annotation.reviewer.pseudonym
    ) {
      issues.push(
        `Annotation ${annotation.annotationId} may only supersede the same reviewer's run`,
      );
    }
    if (superseded.has(targetId)) {
      issues.push(`Annotation ${targetId} has more than one successor`);
    }
    superseded.add(targetId);
  }
  for (const annotation of annotations) {
    const visited = new Set<string>([annotation.annotationId]);
    let parentId = annotation.supersedesAnnotationId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        issues.push(`Annotation supersession cycle includes ${annotation.annotationId}`);
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.supersedesAnnotationId ?? null;
    }
  }
  return {
    activeAnnotations: annotations.filter((annotation) => !superseded.has(annotation.annotationId)),
    issues,
  };
}

/** Evaluates one run against the suite's configured independent-review policy. */
export function evaluateHumanEvalRunReviewPolicy(
  activeAnnotationsForRun: readonly HumanEvalAnnotation[],
  options: {
    readonly minimumIndependentAnnotationsPerRun: number;
    readonly hasAdjudication: boolean;
  },
): HumanEvalRunReviewPolicyState {
  const currentIndependentReviewerCount = new Set(
    activeAnnotationsForRun.map((annotation) => annotation.reviewer.pseudonym),
  ).size;
  const judgmentsByCriterion = new Map<string, Set<string>>();
  for (const annotation of activeAnnotationsForRun) {
    for (const judgment of annotation.review.judgments) {
      const judgments = judgmentsByCriterion.get(judgment.criterionId) ?? new Set<string>();
      judgments.add(judgment.judgment);
      judgmentsByCriterion.set(judgment.criterionId, judgments);
    }
  }
  const hasCriterionDisagreement = [...judgmentsByCriterion.values()].some(
    (judgments) => judgments.size > 1,
  );
  const meetsIndependentReviewerMinimum =
    currentIndependentReviewerCount >= options.minimumIndependentAnnotationsPerRun;
  const adjudicationPreconditionsSatisfied =
    meetsIndependentReviewerMinimum && hasCriterionDisagreement;
  const adjudicationEligible = adjudicationPreconditionsSatisfied && !options.hasAdjudication;
  const annotationState: HumanEvalRunAnnotationState =
    activeAnnotationsForRun.length === 0
      ? 'missing'
      : !meetsIndependentReviewerMinimum
        ? 'incomplete'
        : options.hasAdjudication
          ? 'adjudicated'
          : hasCriterionDisagreement
            ? 'disagreement_preserved'
            : 'complete';

  return {
    currentIndependentReviewerCount,
    meetsIndependentReviewerMinimum,
    hasCriterionDisagreement,
    adjudicationPreconditionsSatisfied,
    adjudicationEligible,
    annotationState,
  };
}
