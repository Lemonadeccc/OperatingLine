import {
  humanEvalAdjudicationSchema,
  humanEvalAnnotationSchema,
  humanEvalSuiteSchema,
  providerEvalRunSchema,
  type HumanEvalAdjudication,
  type HumanEvalAnnotation,
  type HumanEvalCase,
  type HumanEvalSuite,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import {
  computeHumanEvalCaseSha256,
  computeHumanEvalRecordSha256,
  computeHumanEvalRubricSha256,
  computeProviderEvalConditionSha256,
  computeProviderEvalTreatmentSha256,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
} from './integrity.js';

export interface HumanEvalDatasetInput {
  readonly suite: unknown;
  readonly runs?: readonly unknown[];
  readonly annotations?: readonly unknown[];
  readonly adjudications?: readonly unknown[];
}

export interface ValidatedHumanEvalDataset {
  readonly verificationLevel: 'structure_only' | 'artifact_verified';
  readonly suite: HumanEvalSuite;
  readonly casesById: ReadonlyMap<string, HumanEvalCase>;
  readonly runs: readonly ProviderEvalRun[];
  readonly runsById: ReadonlyMap<string, ProviderEvalRun>;
  readonly annotations: readonly HumanEvalAnnotation[];
  readonly adjudications: readonly HumanEvalAdjudication[];
}

export class HumanEvalDatasetError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'HumanEvalDatasetError';
  }
}

function ensureUnique<T>(
  values: readonly T[],
  selectId: (value: T) => string,
  label: string,
  issues: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = selectId(value);
    if (seen.has(id)) {
      issues.push(`Duplicate ${label} id ${id}`);
    }
    seen.add(id);
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function parseRecord<T>(label: string, input: unknown, parse: (value: unknown) => T): T {
  try {
    return parse(input);
  } catch (error) {
    const schemaIssues = (error as { issues?: readonly { message: string; path: PropertyKey[] }[] })
      .issues;
    const issues =
      schemaIssues === undefined
        ? [
            `${label} schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
          ]
        : schemaIssues.map(
            (issue) =>
              `${label} schema validation failed at ${issue.path.join('.') || '<root>'}: ${issue.message}`,
          );
    throw new HumanEvalDatasetError('Human Eval record parsing failed', issues);
  }
}

function checkRecordIntegrity(
  label: string,
  record: { integrity: { contentSha256: string } },
  issues: string[],
): void {
  const actual = computeHumanEvalRecordSha256(record);
  if (record.integrity.contentSha256 !== actual) {
    issues.push(
      `${label} integrity mismatch: expected ${record.integrity.contentSha256}, got ${actual}`,
    );
  }
}

function checkCaseReference(
  label: string,
  suite: HumanEvalSuite,
  evalCase: HumanEvalCase | undefined,
  reference: ProviderEvalRun['caseRef'],
  issues: string[],
): void {
  if (reference.suiteId !== suite.suiteId || reference.suiteVersion !== suite.suiteVersion) {
    issues.push(`${label} references a different suite`);
  }
  if (evalCase === undefined) {
    issues.push(`${label} references unknown case ${reference.caseId}`);
    return;
  }
  const caseHash = computeHumanEvalCaseSha256(evalCase);
  if (reference.caseContentSha256 !== caseHash) {
    issues.push(`${label} case hash does not match ${reference.caseId}`);
  }
}

function checkRun(
  suite: HumanEvalSuite,
  casesById: ReadonlyMap<string, HumanEvalCase>,
  run: ProviderEvalRun,
  issues: string[],
): void {
  const label = `Run ${run.runId}`;
  checkRecordIntegrity(label, run, issues);
  const evalCase = casesById.get(run.caseRef.caseId);
  checkCaseReference(label, suite, evalCase, run.caseRef, issues);
  if (evalCase !== undefined && evalCase.operation !== run.invocation.operation) {
    issues.push(`${label} operation does not match case ${evalCase.id}`);
  }
  if (
    run.generationSettings.parametersSha256 !==
    computeHumanEvalContentSha256(run.generationSettings.normalizedParameters)
  ) {
    issues.push(`${label} generation parameter hash mismatch`);
  }
  if (run.invocation.packetSha256 !== computeHumanEvalContentSha256(run.invocation.packet)) {
    issues.push(`${label} packet hash mismatch`);
  }
  if (
    run.outcome.status === 'completed' &&
    run.outcome.resultSha256 !== computeHumanEvalContentSha256(run.outcome.result)
  ) {
    issues.push(`${label} result hash mismatch`);
  }
  if (
    run.outcome.status === 'failed' &&
    run.outcome.errorSha256 !== computeHumanEvalContentSha256(run.outcome.error)
  ) {
    issues.push(`${label} error hash mismatch`);
  }
  if (
    run.comparability.conditionSha256 !== computeProviderEvalConditionSha256(run) ||
    run.comparability.treatmentSha256 !== computeProviderEvalTreatmentSha256(run)
  ) {
    issues.push(`${label} comparability hash mismatch`);
  }
  if (run.sourceKind === 'live_provider_invocation' && run.sourceEvents.length === 0) {
    issues.push(`${label} claims a live invocation without source events`);
  }
  if (run.sourceKind === 'live_provider_invocation') {
    const prefix =
      run.invocation.operation === 'initial_plan'
        ? 'planning.provider.generation'
        : 'planning.provider.replan';
    const providerEvents = run.sourceEvents.filter(
      (event) => event.correlationKind === 'provider_request',
    );
    const eventTypes = providerEvents.map((event) => event.eventType);
    const expectedTerminal = `${prefix}.${run.outcome.status}`;
    if (
      eventTypes.filter((eventType) => eventType === `${prefix}.requested`).length !== 1 ||
      eventTypes.filter((eventType) =>
        [`${prefix}.completed`, `${prefix}.failed`].includes(eventType),
      ).length !== 1 ||
      eventTypes.filter((eventType) => eventType === expectedTerminal).length !== 1
    ) {
      issues.push(
        `${label} live source events must include exactly one provider request and the matching terminal`,
      );
    }
    const providerTerminalSequence = providerEvents.find(
      (event) => event.eventType === expectedTerminal,
    )?.sequence;
    const expectedPlanContentSha256 =
      run.outcome.status === 'completed' && run.outcome.result.status === 'ready'
        ? computePlanContentSha256(run.outcome.result.draft.plan)
        : null;
    for (const event of run.sourceEvents.filter(
      (candidate) => candidate.correlationKind === 'host_execution',
    )) {
      if (
        expectedPlanContentSha256 === null ||
        event.planContentSha256 !== expectedPlanContentSha256
      ) {
        issues.push(`${label} host source event does not match the exact provider output Plan`);
      }
      if (providerTerminalSequence === undefined || event.sequence <= providerTerminalSequence) {
        issues.push(`${label} host source event must follow its provider terminal event`);
      }
    }
  }
  if (
    run.profile.model.resolution === 'provider_did_not_disclose' &&
    run.comparability.reproducibility === 'reproducible'
  ) {
    issues.push(`${label} cannot be reproducible without a resolved model revision`);
  }
  for (const artifact of run.artifacts) {
    if (artifact.kind !== 'rendered_image' || artifact.visualEnvironment === undefined) {
      continue;
    }
    const visual = artifact.visualEnvironment;
    const terminalEvent = run.sourceEvents.find(
      (event) =>
        event.correlationKind === 'host_execution' &&
        event.sequence === visual.terminalHostEventSequence,
    );
    const expectedPlanContentSha256 =
      run.outcome.status === 'completed' && run.outcome.result.status === 'ready'
        ? computePlanContentSha256(run.outcome.result.draft.plan)
        : null;
    const terminalEventMatches =
      terminalEvent?.correlationKind === 'host_execution' &&
      terminalEvent.planContentSha256 === visual.planContentSha256 &&
      terminalEvent.executionId === visual.executionId &&
      terminalEvent.reportId === visual.terminalHostReportId;
    if (
      expectedPlanContentSha256 === null ||
      visual.planContentSha256 !== expectedPlanContentSha256 ||
      !terminalEventMatches
    ) {
      issues.push(
        `${label} rendered image ${artifact.artifactId} is not bound to its exact host execution`,
      );
    }
  }
  if (evalCase?.operation === 'initial_plan') {
    const request = run.invocation.operation === 'initial_plan' ? run.invocation.request : null;
    const packet = run.invocation.operation === 'initial_plan' ? run.invocation.packet : null;
    if (
      request === null ||
      packet === null ||
      request.targetAdapterId !== evalCase.request.targetAdapterId ||
      request.catalogVersion !== evalCase.request.catalogVersion ||
      request.goal !== evalCase.request.goal ||
      request.planId !== evalCase.request.planId
    ) {
      issues.push(`${label} invocation does not match the initial planning case request`);
    }
    if (
      packet !== null &&
      computeHumanEvalContentSha256(packet.context.catalog) !== evalCase.catalogContentSha256
    ) {
      issues.push(`${label} catalog content does not match the exact evaluation case`);
    }
  } else if (evalCase !== undefined) {
    const packet = run.invocation.operation === 'local_replan' ? run.invocation.packet : null;
    if (
      packet === null ||
      packet.context.revisionRequest.adapterId !== evalCase.targetAdapterId ||
      packet.context.revisionRequest.catalogVersion !== evalCase.catalogVersion ||
      packet.context.revisionRequest.basePlan.id !== evalCase.basePlan.planId ||
      packet.context.revisionRequest.basePlan.revision !== evalCase.basePlan.revision ||
      computePlanContentSha256(packet.context.revisionRequest.basePlan) !==
        evalCase.basePlan.planContentSha256 ||
      computeHumanEvalContentSha256(packet.context.catalog) !== evalCase.catalogContentSha256 ||
      packet.context.revisionRequest.message !== evalCase.revisionMessage ||
      !sameStringSet(
        packet.context.revisionRequest.references.map((reference) => reference.nodeId),
        evalCase.referencedNodeIds,
      )
    ) {
      issues.push(`${label} invocation does not match the local replan case definition`);
    }
  }
}

function checkJudgmentEvidence(
  label: string,
  evalCase: HumanEvalCase,
  run: ProviderEvalRun,
  judgments: HumanEvalAnnotation['review']['judgments'],
  issues: string[],
): void {
  const requirementIds = new Set(evalCase.requirements.map((requirement) => requirement.id));
  const stepIds = new Set(
    run.outcome.status === 'completed'
      ? run.outcome.result.draft.plan.steps.map((step) => step.id)
      : [],
  );
  const eventsBySequence = new Map(
    run.sourceEvents.map((event) => [String(event.sequence), event]),
  );
  const artifactsById = new Map(run.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const outcomeSha256 =
    run.outcome.status === 'completed' ? run.outcome.resultSha256 : run.outcome.errorSha256;
  for (const judgment of judgments) {
    for (const evidence of judgment.evidence) {
      if (evidence.kind === 'requirement' && !requirementIds.has(evidence.locator)) {
        issues.push(`${label} cites unknown requirement ${evidence.locator}`);
      } else if (evidence.kind === 'plan_step' && !stepIds.has(evidence.locator)) {
        issues.push(`${label} cites unknown plan step ${evidence.locator}`);
      } else if (evidence.kind === 'execution_event') {
        const event = eventsBySequence.get(evidence.locator);
        if (event === undefined || evidence.contentSha256 !== event.payloadSha256) {
          issues.push(`${label} cites an unknown or hash-mismatched event ${evidence.locator}`);
        }
      } else if (evidence.kind === 'artifact') {
        const artifact = artifactsById.get(evidence.locator);
        if (artifact === undefined || evidence.contentSha256 !== artifact.contentSha256) {
          issues.push(`${label} cites an unknown or hash-mismatched artifact ${evidence.locator}`);
        }
      } else if (evidence.kind === 'run_output' && evidence.contentSha256 !== outcomeSha256) {
        issues.push(`${label} run-output evidence hash does not match the exact outcome`);
      }
    }
  }
}

function judgmentsDisagree(annotations: readonly HumanEvalAnnotation[]): boolean {
  const judgmentsByCriterion = new Map<string, Set<string>>();
  for (const annotation of annotations) {
    for (const judgment of annotation.review.judgments) {
      const values = judgmentsByCriterion.get(judgment.criterionId) ?? new Set<string>();
      values.add(judgment.judgment);
      judgmentsByCriterion.set(judgment.criterionId, values);
    }
  }
  return [...judgmentsByCriterion.values()].some((judgments) => judgments.size > 1);
}

function isJudgeableJudgment(
  judgment: HumanEvalAnnotation['review']['judgments'][number],
): boolean {
  return judgment.judgment !== 'unable_to_judge' && judgment.judgment !== 'not_applicable';
}

function hasDeclaredStageEvidence(
  evaluationStage: 'execution' | 'artifact',
  judgment: HumanEvalAnnotation['review']['judgments'][number],
  run: ProviderEvalRun,
): boolean {
  if (!isJudgeableJudgment(judgment)) {
    return false;
  }
  if (evaluationStage === 'execution') {
    const eventsBySequence = new Map(
      run.sourceEvents.map((event) => [String(event.sequence), event]),
    );
    return judgment.evidence.some(
      (evidence) =>
        evidence.kind === 'execution_event' &&
        eventsBySequence.get(evidence.locator)?.correlationKind === 'host_execution',
    );
  }
  const artifactsById = new Map(run.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  return judgment.evidence.some((evidence) => {
    if (evidence.kind !== 'artifact') {
      return false;
    }
    const artifact = artifactsById.get(evidence.locator);
    return artifact?.kind === 'rendered_image' && artifact.visualEnvironment !== undefined;
  });
}

function checkReleasedStageEvidence(
  suite: HumanEvalSuite,
  evalCase: HumanEvalCase,
  run: ProviderEvalRun,
  annotations: readonly HumanEvalAnnotation[],
  adjudication: HumanEvalAdjudication | undefined,
  issues: string[],
): void {
  const judgments =
    adjudication === undefined
      ? annotations.flatMap((annotation) => annotation.review.judgments)
      : adjudication.judgments;
  for (const criterionId of evalCase.rubricCriterionIds) {
    const criterion = suite.rubric.criteria.find((candidate) => candidate.id === criterionId);
    if (criterion === undefined || criterion.evaluationStage === 'plan') {
      continue;
    }
    const criterionJudgments = judgments.filter((judgment) => judgment.criterionId === criterionId);
    if (criterionJudgments.length === 0) {
      issues.push(
        `Released run ${run.runId} lacks a ${criterion.evaluationStage} judgment for ${criterionId}`,
      );
      continue;
    }
    const judgeableJudgments = criterionJudgments.filter(isJudgeableJudgment);
    if (
      run.outcome.status === 'completed' &&
      run.outcome.result.status === 'needs_revision' &&
      judgeableJudgments.length > 0
    ) {
      issues.push(
        `Released run ${run.runId} cannot make a judgeable ${criterion.evaluationStage} claim from a needs_revision provider result`,
      );
      continue;
    }
    if (
      criterion.evaluationStage === 'execution' &&
      judgeableJudgments.some((judgment) => !hasDeclaredStageEvidence('execution', judgment, run))
    ) {
      issues.push(
        `Released run ${run.runId} requires verified host execution evidence for ${criterionId}`,
      );
    }
    if (
      criterion.evaluationStage === 'artifact' &&
      judgeableJudgments.some((judgment) => !hasDeclaredStageEvidence('artifact', judgment, run))
    ) {
      issues.push(
        `Released run ${run.runId} requires a rendered image with visual provenance for ${criterionId}`,
      );
    }
  }
}

function activeAnnotations(
  annotations: readonly HumanEvalAnnotation[],
  issues: string[],
): readonly HumanEvalAnnotation[] {
  const byId = new Map(annotations.map((annotation) => [annotation.annotationId, annotation]));
  const superseded = new Set<string>();
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
  return annotations.filter((annotation) => !superseded.has(annotation.annotationId));
}

export function validateHumanEvalDataset(input: HumanEvalDatasetInput): ValidatedHumanEvalDataset {
  const suite = parseRecord('Suite', input.suite, (value) => humanEvalSuiteSchema.parse(value));
  const runs = (input.runs ?? []).map((run, index) =>
    parseRecord(`Run[${index}]`, run, (value) => providerEvalRunSchema.parse(value)),
  );
  const annotations = (input.annotations ?? []).map((annotation, index) =>
    parseRecord(`Annotation[${index}]`, annotation, (value) =>
      humanEvalAnnotationSchema.parse(value),
    ),
  );
  const adjudications = (input.adjudications ?? []).map((adjudication, index) =>
    parseRecord(`Adjudication[${index}]`, adjudication, (value) =>
      humanEvalAdjudicationSchema.parse(value),
    ),
  );
  const issues: string[] = [];

  checkRecordIntegrity(`Suite ${suite.suiteId}@${suite.suiteVersion}`, suite, issues);
  ensureUnique(runs, (run) => run.runId, 'run', issues);
  ensureUnique(annotations, (annotation) => annotation.annotationId, 'annotation', issues);
  ensureUnique(
    adjudications,
    (adjudication) => adjudication.adjudicationId,
    'adjudication',
    issues,
  );

  const casesById = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
  const runsById = new Map(runs.map((run) => [run.runId, run]));
  const generationRequestIds = new Set<string>();
  const replicateKeys = new Set<string>();
  for (const run of runs) {
    checkRun(suite, casesById, run, issues);
    const requestId = run.invocation.request.requestId;
    if (generationRequestIds.has(requestId)) {
      issues.push(`Generation request ${requestId} is reused by more than one run`);
    }
    generationRequestIds.add(requestId);
    const replicateKey = [
      run.caseRef.caseId,
      run.comparability.conditionSha256,
      run.comparability.treatmentSha256,
      String(run.replicateIndex),
    ].join('\u0000');
    if (replicateKeys.has(replicateKey)) {
      issues.push(
        `Case ${run.caseRef.caseId} repeats replicate ${run.replicateIndex} for one condition and treatment`,
      );
    }
    replicateKeys.add(replicateKey);
    if (run.parentRunId !== null) {
      const parent = runsById.get(run.parentRunId);
      if (parent === undefined) {
        issues.push(`Run ${run.runId} references unknown parent run ${run.parentRunId}`);
      } else if (parent.caseRef.caseId !== run.caseRef.caseId) {
        issues.push(`Run ${run.runId} parent must belong to the same case`);
      }
    }
  }
  for (const run of runs) {
    const visited = new Set<string>([run.runId]);
    let parentId = run.parentRunId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        issues.push(`Run parent cycle includes ${run.runId}`);
        break;
      }
      visited.add(parentId);
      parentId = runsById.get(parentId)?.parentRunId ?? null;
    }
  }

  const rubricHash = computeHumanEvalRubricSha256(suite.rubric);
  for (const annotation of annotations) {
    const label = `Annotation ${annotation.annotationId}`;
    checkRecordIntegrity(label, annotation, issues);
    const run = runsById.get(annotation.runId);
    const evalCase = casesById.get(annotation.caseRef.caseId);
    checkCaseReference(label, suite, evalCase, annotation.caseRef, issues);
    if (run === undefined) {
      issues.push(`${label} references unknown run ${annotation.runId}`);
    } else {
      if (
        annotation.caseRef.caseId !== run.caseRef.caseId ||
        annotation.runContentSha256 !== run.integrity.contentSha256
      ) {
        issues.push(`${label} does not match its exact run evidence`);
      }
    }
    if (
      annotation.rubric.id !== suite.rubric.id ||
      annotation.rubric.version !== suite.rubric.version ||
      annotation.rubric.contentSha256 !== rubricHash
    ) {
      issues.push(`${label} rubric reference does not match the suite rubric`);
    }
    if (
      evalCase !== undefined &&
      !sameStringSet(
        annotation.review.judgments.map((judgment) => judgment.criterionId),
        evalCase.rubricCriterionIds,
      )
    ) {
      issues.push(`${label} must judge every applicable case criterion exactly once`);
    }
    if (run !== undefined && evalCase !== undefined) {
      checkJudgmentEvidence(label, evalCase, run, annotation.review.judgments, issues);
    }
    for (const judgment of annotation.review.judgments) {
      const criterion = suite.rubric.criteria.find(
        (candidate) => candidate.id === judgment.criterionId,
      );
      if (
        criterion !== undefined &&
        judgment.evidence.some((evidence) => !criterion.evidenceKinds.includes(evidence.kind))
      ) {
        issues.push(`${label} uses evidence not allowed by criterion ${criterion.id}`);
      }
    }
  }

  const currentAnnotations = activeAnnotations(annotations, issues);
  const currentReviewerKeys = new Set<string>();
  for (const annotation of currentAnnotations) {
    const key = `${annotation.runId}\u0000${annotation.reviewer.pseudonym}`;
    if (currentReviewerKeys.has(key)) {
      issues.push(
        `Run ${annotation.runId} has more than one current annotation from ${annotation.reviewer.pseudonym}`,
      );
    }
    currentReviewerKeys.add(key);
  }
  const currentById = new Map(
    currentAnnotations.map((annotation) => [annotation.annotationId, annotation]),
  );
  const adjudicationsByRun = new Map<string, HumanEvalAdjudication>();
  for (const adjudication of adjudications) {
    const label = `Adjudication ${adjudication.adjudicationId}`;
    checkRecordIntegrity(label, adjudication, issues);
    const evalCase = casesById.get(adjudication.caseRef.caseId);
    const run = runsById.get(adjudication.runId);
    checkCaseReference(label, suite, evalCase, adjudication.caseRef, issues);
    if (run === undefined) {
      issues.push(`${label} references unknown run ${adjudication.runId}`);
    } else if (run.caseRef.caseId !== adjudication.caseRef.caseId) {
      issues.push(`${label} does not match its exact run evidence`);
    }
    if (adjudicationsByRun.has(adjudication.runId)) {
      issues.push(`Run ${adjudication.runId} has more than one adjudication`);
    }
    adjudicationsByRun.set(adjudication.runId, adjudication);
    const referenced = adjudication.annotationRefs
      .map((reference) => currentById.get(reference.annotationId))
      .filter((annotation): annotation is HumanEvalAnnotation => annotation !== undefined);
    if (referenced.length !== adjudication.annotationRefs.length) {
      issues.push(`${label} must reference current annotations`);
    }
    for (const reference of adjudication.annotationRefs) {
      const annotation = currentById.get(reference.annotationId);
      if (
        annotation !== undefined &&
        annotation.integrity.contentSha256 !== reference.annotationContentSha256
      ) {
        issues.push(`${label} annotation reference ${reference.annotationId} hash does not match`);
      }
    }
    if (
      referenced.some(
        (annotation) =>
          annotation.runId !== adjudication.runId ||
          annotation.caseRef.caseId !== adjudication.caseRef.caseId,
      )
    ) {
      issues.push(`${label} annotations must belong to the same case and run`);
    }
    const currentRunAnnotationIds = currentAnnotations
      .filter((annotation) => annotation.runId === adjudication.runId)
      .map((annotation) => annotation.annotationId);
    if (
      !sameStringSet(
        adjudication.annotationRefs.map((reference) => reference.annotationId),
        currentRunAnnotationIds,
      )
    ) {
      issues.push(`${label} must reference every current annotation for its run`);
    }
    if (new Set(referenced.map((annotation) => annotation.reviewer.pseudonym)).size < 2) {
      issues.push(`${label} requires at least two independent reviewers`);
    }
    if (referenced.length >= 2 && !judgmentsDisagree(referenced)) {
      issues.push(`${label} may only resolve a preserved reviewer disagreement`);
    }
    if (
      referenced.some(
        (annotation) => annotation.reviewer.pseudonym === adjudication.adjudicatorPseudonym,
      )
    ) {
      issues.push(`${label} adjudicator must be independent from the referenced reviewers`);
    }
    if (
      evalCase !== undefined &&
      !sameStringSet(
        adjudication.judgments.map((judgment) => judgment.criterionId),
        evalCase.rubricCriterionIds,
      )
    ) {
      issues.push(`${label} must adjudicate every applicable case criterion exactly once`);
    }
    if (run !== undefined && evalCase !== undefined) {
      checkJudgmentEvidence(label, evalCase, run, adjudication.judgments, issues);
    }
    for (const judgment of adjudication.judgments) {
      const criterion = suite.rubric.criteria.find(
        (candidate) => candidate.id === judgment.criterionId,
      );
      if (
        criterion !== undefined &&
        judgment.evidence.some((evidence) => !criterion.evidenceKinds.includes(evidence.kind))
      ) {
        issues.push(`${label} uses evidence not allowed by criterion ${criterion.id}`);
      }
    }
  }

  if (suite.status === 'released') {
    if (suite.dataHandling.publicRelease !== 'reviewed') {
      issues.push('Released suite must be reviewed for public release');
    }
    if (runs.some((run) => run.sourceKind !== 'live_provider_invocation')) {
      issues.push('Released suite cannot contain synthetic runs');
    }
    if (
      runs.some((run) => run.dataHandling.publicRelease !== 'reviewed') ||
      annotations.some((annotation) => annotation.dataHandling.publicRelease !== 'reviewed') ||
      adjudications.some((adjudication) => adjudication.dataHandling.publicRelease !== 'reviewed')
    ) {
      issues.push('Every released run, annotation, and adjudication must pass public review');
    }
    for (const evalCase of suite.cases) {
      const caseRuns = runs.filter(
        (run) =>
          run.caseRef.caseId === evalCase.id && run.sourceKind === 'live_provider_invocation',
      );
      const treatmentsByCondition = new Map<string, Set<string>>();
      for (const run of caseRuns) {
        const treatments =
          treatmentsByCondition.get(run.comparability.conditionSha256) ?? new Set<string>();
        treatments.add(run.comparability.treatmentSha256);
        treatmentsByCondition.set(run.comparability.conditionSha256, treatments);
      }
      if (
        ![...treatmentsByCondition.values()].some(
          (treatments) => treatments.size >= suite.policy.minimumDistinctTreatmentsPerCase,
        )
      ) {
        issues.push(
          `Released case ${evalCase.id} lacks ${suite.policy.minimumDistinctTreatmentsPerCase} live treatments under one condition`,
        );
      }
    }
    for (const run of runs) {
      const runAnnotations = currentAnnotations.filter(
        (annotation) => annotation.runId === run.runId,
      );
      const reviewerCount = new Set(
        runAnnotations.map((annotation) => annotation.reviewer.pseudonym),
      ).size;
      if (reviewerCount < suite.policy.minimumIndependentAnnotationsPerRun) {
        issues.push(
          `Released run ${run.runId} has ${reviewerCount} independent annotations; ${suite.policy.minimumIndependentAnnotationsPerRun} required`,
        );
      }
      if (judgmentsDisagree(runAnnotations) && !adjudicationsByRun.has(run.runId)) {
        issues.push(`Released run ${run.runId} has unresolved reviewer disagreement`);
      }
      const evalCase = casesById.get(run.caseRef.caseId);
      if (evalCase !== undefined) {
        checkReleasedStageEvidence(
          suite,
          evalCase,
          run,
          runAnnotations,
          adjudicationsByRun.get(run.runId),
          issues,
        );
      }
    }
    for (const evalCase of suite.cases) {
      const caseRuns = runs.filter((run) => run.caseRef.caseId === evalCase.id);
      for (const criterionId of evalCase.rubricCriterionIds) {
        const criterion = suite.rubric.criteria.find((candidate) => candidate.id === criterionId);
        if (criterion === undefined || criterion.evaluationStage === 'plan') {
          continue;
        }
        const stage = criterion.evaluationStage;
        const hasCaseCoverage = caseRuns.some((run) => {
          const adjudication = adjudicationsByRun.get(run.runId);
          const judgments =
            adjudication === undefined
              ? currentAnnotations
                  .filter((annotation) => annotation.runId === run.runId)
                  .flatMap((annotation) => annotation.review.judgments)
              : adjudication.judgments;
          return judgments.some(
            (judgment) =>
              judgment.criterionId === criterionId &&
              hasDeclaredStageEvidence(stage, judgment, run),
          );
        });
        if (!hasCaseCoverage) {
          issues.push(
            `Released case ${evalCase.id} lacks any judgeable ${stage} evidence for ${criterionId}`,
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new HumanEvalDatasetError('Human Eval dataset validation failed', issues);
  }
  return {
    verificationLevel: 'structure_only',
    suite,
    casesById,
    runs,
    runsById,
    annotations,
    adjudications,
  };
}
