import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  computeHumanEvalRubricSha256,
  assertProviderIdentityAbsent,
  buildProviderBlindReviewSurface,
  deriveProviderIdentityMarkers,
  HumanEvalDatasetBusyError,
  loadHumanEvalDatasetDirectory,
  sealHumanEvalAdjudication,
  sealHumanEvalAnnotation,
  validateHumanEvalDataset,
  withHumanEvalDatasetWriteLock,
  writeHumanEvalFileAtomicExclusive,
  type HumanEvalDatasetDirectoryOptions,
  type ValidatedHumanEvalDataset,
} from '@operatingline/eval-kit';
import type {
  HumanEvalAdjudication,
  HumanEvalAnnotation,
  HumanEvalCriterionJudgment,
  HumanEvalDataHandling,
  HumanEvalEvidenceKind,
  HumanEvalJudgment,
  HumanEvalRubricCriterion,
  ProviderEvalRun,
} from '@operatingline/protocol';

export type ReviewWorkspaceRole = 'reviewer' | 'adjudicator';

export interface ReviewSessionConfiguration {
  readonly pseudonym: string;
  readonly role: ReviewWorkspaceRole;
  readonly qualificationId: string;
  readonly calibrationVersion: string;
  readonly locale: string;
}

export interface ReviewWorkspaceOpenOptions {
  readonly datasetDirectory: string;
  readonly artifactOptions?: HumanEvalDatasetDirectoryOptions;
  readonly now?: () => Date;
}

export interface ReviewSession {
  readonly sessionToken: string;
}

export interface ReviewEvidenceOption {
  readonly token: string;
  readonly kind: HumanEvalEvidenceKind;
  readonly label: string;
  readonly mediaType: string | null;
}

export interface ReviewerCaseDto {
  readonly opaqueRunId: string;
  readonly versionToken: string;
  readonly title: string;
  readonly task: string;
  readonly requirements: readonly {
    readonly id: string;
    readonly importance: 'must' | 'must_not' | 'should';
    readonly statement: string;
  }[];
  readonly rubric: readonly HumanEvalRubricCriterion[];
  readonly generatedPlan: unknown | null;
  readonly planningQuality: unknown | null;
  readonly evidenceOptions: readonly ReviewEvidenceOption[];
  readonly ownStatus:
    | { readonly state: 'not_submitted' }
    | { readonly state: 'submitted'; readonly annotationToken: string };
}

export interface SubmittedEvidence {
  readonly token: string;
  readonly note: string;
}

export interface SubmittedCriterionJudgment {
  readonly criterionId: string;
  readonly judgment: HumanEvalJudgment;
  readonly rationale: string;
  readonly evidence: readonly SubmittedEvidence[];
}

export interface ReviewerSubmission {
  readonly opaqueRunId: string;
  readonly versionToken: string;
  readonly recommendation: 'accept' | 'revise' | 'unable_to_judge';
  readonly judgments: readonly SubmittedCriterionJudgment[];
}

export interface ReviewerCorrection extends ReviewerSubmission {
  readonly supersedesAnnotationToken: string;
}

export interface SubmissionReceipt {
  readonly annotationToken: string;
}

export interface AdjudicationCaseDto {
  readonly opaqueRunId: string;
  readonly versionToken: string;
  readonly title: string;
  readonly task: string;
  readonly requirements: ReviewerCaseDto['requirements'];
  readonly rubric: readonly HumanEvalRubricCriterion[];
  readonly generatedPlan: unknown | null;
  readonly planningQuality: unknown | null;
  readonly evidenceOptions: readonly ReviewEvidenceOption[];
  readonly annotations: readonly {
    readonly label: string;
    readonly recommendation: 'accept' | 'revise' | 'unable_to_judge';
    readonly judgments: readonly {
      readonly criterionId: string;
      readonly judgment: HumanEvalJudgment;
      readonly rationale: string;
      readonly evidence: readonly {
        readonly kind: HumanEvalEvidenceKind;
        readonly label: string;
        readonly note: string;
      }[];
    }[];
  }[];
}

export interface AdjudicationSubmission {
  readonly opaqueRunId: string;
  readonly versionToken: string;
  readonly judgments: readonly SubmittedCriterionJudgment[];
}

export interface AdjudicationReceipt {
  readonly adjudicationId: string;
}

export interface ResolvedRenderedArtifact {
  readonly mediaType: 'image/png';
  readonly bytes: Uint8Array;
}

export type ReviewWorkspaceErrorCode =
  | 'invalid_session'
  | 'wrong_role'
  | 'unknown_run'
  | 'stale_token'
  | 'duplicate_submission'
  | 'dataset_busy'
  | 'invalid_submission'
  | 'adjudication_unavailable'
  | 'adjudicator_not_independent';

export class ReviewWorkspaceError extends Error {
  constructor(
    readonly code: ReviewWorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewWorkspaceError';
  }
}

interface SessionState extends ReviewSessionConfiguration {
  readonly token: string;
  readonly runAliases: Map<string, string>;
  readonly runAliasesById: Map<string, string>;
  readonly annotationAliases: Map<string, string>;
  readonly annotationAliasesById: Map<string, string>;
}

interface VersionBinding {
  readonly sessionToken: string;
  readonly runId: string;
  readonly ownAnnotationId: string | null;
  readonly annotationIds: readonly string[] | null;
  readonly signoffContentSha256: string;
  readonly issuedAt: string;
}

interface EvidenceBinding {
  readonly sessionToken: string;
  readonly runId: string;
  readonly kind: HumanEvalEvidenceKind;
  readonly locator: string;
  readonly contentSha256: string | null;
}

function currentAnnotations(
  records: readonly HumanEvalAnnotation[],
): readonly HumanEvalAnnotation[] {
  const superseded = new Set(
    records.flatMap((annotation) =>
      annotation.supersedesAnnotationId === null ? [] : [annotation.supersedesAnnotationId],
    ),
  );
  return records.filter((annotation) => !superseded.has(annotation.annotationId));
}

function annotationsDisagree(records: readonly HumanEvalAnnotation[]): boolean {
  const values = new Map<string, Set<HumanEvalJudgment>>();
  for (const record of records) {
    for (const judgment of record.review.judgments) {
      const criterionValues = values.get(judgment.criterionId) ?? new Set<HumanEvalJudgment>();
      criterionValues.add(judgment.judgment);
      values.set(judgment.criterionId, criterionValues);
    }
  }
  return [...values.values()].some((criterionValues) => criterionValues.size > 1);
}

function reviewDataHandling(
  dataset: ValidatedHumanEvalDataset,
  recordKind: 'annotation' | 'adjudication',
): HumanEvalDataHandling {
  return {
    redaction: 'human_reviewed',
    containsPotentiallySensitiveContent: true,
    permittedUses: dataset.suite.dataHandling.permittedUses,
    trainingUse: 'not_authorized',
    publicRelease: 'not_reviewed',
    warning: `This ${recordKind} contains human judgment over potentially sensitive run evidence. It requires a separate public-release review and is not authorized for training.`,
  };
}

function assertReviewDatasetReady(dataset: ValidatedHumanEvalDataset): ValidatedHumanEvalDataset {
  if (dataset.verificationLevel !== 'artifact_verified') {
    throw new Error('Human Eval review requires an artifact-verified dataset');
  }
  if (
    dataset.blindSignoffs.length !== dataset.runs.length ||
    dataset.runs.some((run) => !dataset.blindSignoffsByRunId.has(run.runId))
  ) {
    throw new Error('Human Eval review requires one valid provider-blind sign-off for every run');
  }
  return dataset;
}

function assertSessionConfiguration(configuration: ReviewSessionConfiguration): void {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const locale = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
  if (
    !identifier.test(configuration.pseudonym) ||
    configuration.pseudonym.length > 180 ||
    !identifier.test(configuration.qualificationId) ||
    configuration.qualificationId.length > 180 ||
    !semanticVersion.test(configuration.calibrationVersion) ||
    !locale.test(configuration.locale) ||
    (configuration.role !== 'reviewer' && configuration.role !== 'adjudicator')
  ) {
    throw new ReviewWorkspaceError('invalid_session', 'Review session configuration is invalid');
  }
}

export class HumanEvalReviewWorkspace {
  static async open(options: ReviewWorkspaceOpenOptions): Promise<HumanEvalReviewWorkspace> {
    const dataset = assertReviewDatasetReady(
      await loadHumanEvalDatasetDirectory(options.datasetDirectory, options.artifactOptions),
    );
    return new HumanEvalReviewWorkspace(
      resolve(options.datasetDirectory),
      dataset,
      options.now ?? (() => new Date()),
      options.artifactOptions ?? {},
    );
  }

  readonly #datasetDirectory: string;
  readonly #now: () => Date;
  readonly #artifactOptions: HumanEvalDatasetDirectoryOptions;
  readonly #sessions = new Map<string, SessionState>();
  readonly #versionBindings = new Map<string, VersionBinding>();
  readonly #evidenceBindings = new Map<string, EvidenceBinding>();
  #mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    datasetDirectory: string,
    private dataset: ValidatedHumanEvalDataset,
    now: () => Date,
    artifactOptions: HumanEvalDatasetDirectoryOptions,
  ) {
    this.#datasetDirectory = datasetDirectory;
    this.#now = now;
    this.#artifactOptions = artifactOptions;
  }

  /** Server-side only: callers must authenticate before assigning this configuration. */
  createSession(configuration: ReviewSessionConfiguration): ReviewSession {
    assertSessionConfiguration(configuration);
    const providerMarkers = this.dataset.runs.flatMap((run) =>
      deriveProviderIdentityMarkers(
        run.profile,
        this.dataset.blindSignoffsByRunId.get(run.runId)?.supplementalAliases ?? [],
      ),
    );
    try {
      assertProviderIdentityAbsent(
        {
          pseudonym: configuration.pseudonym,
          qualificationId: configuration.qualificationId,
        },
        [...new Set(providerMarkers)],
      );
    } catch {
      throw new ReviewWorkspaceError(
        'invalid_session',
        'Review session identity metadata must remain provider-blind',
      );
    }
    if (
      this.dataset.blindSignoffs.some((signoff) => signoff.preparedBy === configuration.pseudonym)
    ) {
      throw new ReviewWorkspaceError(
        'invalid_session',
        'A blind-surface preparer cannot review or adjudicate this dataset',
      );
    }
    const token = this.#opaque();
    this.#sessions.set(token, {
      ...configuration,
      token,
      runAliases: new Map(),
      runAliasesById: new Map(),
      annotationAliases: new Map(),
      annotationAliasesById: new Map(),
    });
    return { sessionToken: token };
  }

  /** Refreshes one consistent dataset snapshot so separate reviewer processes observe each other. */
  async refresh(): Promise<void> {
    await this.#serializeMutation(async () => undefined);
  }

  listReviewerCases(sessionToken: string): readonly ReviewerCaseDto[] {
    const session = this.#session(sessionToken, 'reviewer');
    return this.dataset.runs.map((run) => this.#reviewerCase(session, run));
  }

  getReviewerCase(sessionToken: string, opaqueRunId: string): ReviewerCaseDto {
    const session = this.#session(sessionToken, 'reviewer');
    return this.#reviewerCase(session, this.#run(session, opaqueRunId));
  }

  async resolveRenderedArtifact(
    sessionToken: string,
    evidenceToken: string,
  ): Promise<ResolvedRenderedArtifact> {
    const session = this.#sessions.get(sessionToken);
    if (session === undefined) {
      throw new ReviewWorkspaceError('invalid_session', 'Unknown review session');
    }
    const binding = this.#evidenceBindings.get(evidenceToken);
    const run = binding === undefined ? undefined : this.dataset.runsById.get(binding.runId);
    const artifact =
      binding?.kind === 'artifact'
        ? run?.artifacts.find((candidate) => candidate.artifactId === binding.locator)
        : undefined;
    const signedArtifact =
      run === undefined
        ? undefined
        : this.dataset.blindSignoffsByRunId
            .get(run.runId)
            ?.renderedArtifacts.find((candidate) => candidate.artifactId === binding?.locator);
    if (
      binding === undefined ||
      binding.sessionToken !== session.token ||
      (artifact?.kind !== 'rendered_image' && artifact?.kind !== 'manual_review_image') ||
      artifact.mediaType !== 'image/png' ||
      signedArtifact?.mediaType !== 'image/png' ||
      signedArtifact.contentSha256 !== artifact.contentSha256
    ) {
      throw new ReviewWorkspaceError('invalid_submission', 'Artifact token is invalid');
    }
    const path = await this.#artifactPath(artifact.uri);
    const metadata = await stat(path);
    const maxBytes = this.#artifactOptions.maxArtifactBytes ?? 512 * 1024 * 1024;
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new ReviewWorkspaceError('invalid_submission', 'Rendered artifact is unavailable');
    }
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.contentSha256) {
      throw new ReviewWorkspaceError('invalid_submission', 'Rendered artifact integrity changed');
    }
    return { mediaType: 'image/png', bytes };
  }

  async submitReview(
    sessionToken: string,
    submission: ReviewerSubmission,
  ): Promise<SubmissionReceipt> {
    return this.#serializeMutation(async () => {
      const session = this.#session(sessionToken, 'reviewer');
      const run = this.#run(session, submission.opaqueRunId);
      const own = this.#ownCurrentAnnotation(session, run.runId);
      if (own !== undefined) {
        throw new ReviewWorkspaceError(
          'duplicate_submission',
          'This reviewer has already submitted an annotation for the run',
        );
      }
      return this.#persistReview(session, run, submission, null);
    });
  }

  async correctReview(
    sessionToken: string,
    submission: ReviewerCorrection,
  ): Promise<SubmissionReceipt> {
    return this.#serializeMutation(async () => {
      const session = this.#session(sessionToken, 'reviewer');
      const run = this.#run(session, submission.opaqueRunId);
      const own = this.#ownCurrentAnnotation(session, run.runId);
      const boundId = session.annotationAliases.get(submission.supersedesAnnotationToken);
      if (own === undefined || boundId !== own.annotationId) {
        throw new ReviewWorkspaceError(
          'stale_token',
          'Correction must bind the reviewer’s exact current annotation',
        );
      }
      return this.#persistReview(session, run, submission, own.annotationId);
    });
  }

  listAdjudicationCases(sessionToken: string): readonly AdjudicationCaseDto[] {
    const session = this.#session(sessionToken, 'adjudicator');
    return this.dataset.runs.flatMap((run) => {
      const eligible = this.#adjudicationAnnotations(run.runId);
      return eligible === null ||
        eligible.some((record) => record.reviewer.pseudonym === session.pseudonym)
        ? []
        : [this.#adjudicationCase(session, run, eligible)];
    });
  }

  getAdjudicationCase(sessionToken: string, opaqueRunId: string): AdjudicationCaseDto {
    const session = this.#session(sessionToken, 'adjudicator');
    const run = this.#run(session, opaqueRunId);
    const records = this.#adjudicationAnnotations(run.runId);
    if (records === null) {
      throw new ReviewWorkspaceError(
        'adjudication_unavailable',
        'This run is not currently eligible for adjudication',
      );
    }
    if (records.some((record) => record.reviewer.pseudonym === session.pseudonym)) {
      throw new ReviewWorkspaceError(
        'adjudicator_not_independent',
        'An annotating reviewer cannot adjudicate the same run',
      );
    }
    return this.#adjudicationCase(session, run, records);
  }

  async submitAdjudication(
    sessionToken: string,
    submission: AdjudicationSubmission,
  ): Promise<AdjudicationReceipt> {
    return this.#serializeMutation(async () => {
      const session = this.#session(sessionToken, 'adjudicator');
      const run = this.#run(session, submission.opaqueRunId);
      const records = this.#adjudicationAnnotations(run.runId);
      if (records === null) {
        throw new ReviewWorkspaceError(
          'adjudication_unavailable',
          'This run is not currently eligible for adjudication',
        );
      }
      if (records.some((record) => record.reviewer.pseudonym === session.pseudonym)) {
        throw new ReviewWorkspaceError(
          'adjudicator_not_independent',
          'An annotating reviewer cannot adjudicate the same run',
        );
      }
      const binding = this.#versionBinding(session, submission.versionToken, run.runId);
      const exactIds = records.map((record) => record.annotationId).sort();
      if (
        binding.annotationIds === null ||
        binding.annotationIds.length !== exactIds.length ||
        binding.annotationIds.some((id, index) => id !== exactIds[index])
      ) {
        throw new ReviewWorkspaceError(
          'stale_token',
          'The adjudication version no longer matches the current annotations',
        );
      }
      const judgments = this.#resolveJudgments(session, run, submission.judgments);
      const annotationRefs = records.map((record) => ({
        annotationId: record.annotationId,
        annotationContentSha256: record.integrity.contentSha256,
      }));
      const content = {
        formatVersion: '1.0.0' as const,
        adjudicationId: randomUUID(),
        caseRef: run.caseRef,
        runId: run.runId,
        annotationRefs,
        adjudicatorPseudonym: session.pseudonym,
        completedAt: this.#now().toISOString(),
        judgments,
        sourceKind: 'human_adjudication' as const,
        dataHandling: reviewDataHandling(this.dataset, 'adjudication'),
      };
      const record = sealHumanEvalAdjudication(content);
      await this.#acceptCandidate({ adjudication: record });
      return { adjudicationId: record.adjudicationId };
    });
  }

  async #persistReview(
    session: SessionState,
    run: ProviderEvalRun,
    submission: ReviewerSubmission,
    supersedesAnnotationId: string | null,
  ): Promise<SubmissionReceipt> {
    const binding = this.#versionBinding(session, submission.versionToken, run.runId);
    if (binding.ownAnnotationId !== supersedesAnnotationId) {
      throw new ReviewWorkspaceError('stale_token', 'The reviewer version token is stale');
    }
    const judgments = this.#resolveJudgments(session, run, submission.judgments);
    const completedAt = this.#now().toISOString();
    const content = {
      formatVersion: '1.0.0' as const,
      annotationId: randomUUID(),
      caseRef: run.caseRef,
      runId: run.runId,
      runContentSha256: run.integrity.contentSha256,
      rubric: {
        id: this.dataset.suite.rubric.id,
        version: this.dataset.suite.rubric.version,
        contentSha256: computeHumanEvalRubricSha256(this.dataset.suite.rubric),
      },
      reviewer: {
        pseudonym: session.pseudonym,
        qualificationId: session.qualificationId,
        calibrationVersion: session.calibrationVersion,
        locale: session.locale,
      },
      review: {
        providerIdentityVisible: false as const,
        startedAt: binding.issuedAt,
        completedAt,
        recommendation: submission.recommendation,
        judgments,
      },
      sourceKind: 'human_annotation' as const,
      supersedesAnnotationId,
      dataHandling: reviewDataHandling(this.dataset, 'annotation'),
    };
    const record = sealHumanEvalAnnotation(content);
    await this.#acceptCandidate({ annotation: record });
    return { annotationToken: this.#annotationAlias(session, record.annotationId) };
  }

  #reviewerCase(session: SessionState, run: ProviderEvalRun): ReviewerCaseDto {
    const evalCase = this.dataset.casesById.get(run.caseRef.caseId);
    if (evalCase === undefined) {
      throw new ReviewWorkspaceError('unknown_run', 'Run references an unknown case');
    }
    const surface = buildProviderBlindReviewSurface(this.dataset.suite, run);
    const signoff = this.#signoff(run);
    const own = this.#ownCurrentAnnotation(session, run.runId);
    const versionToken = this.#versionToken({
      sessionToken: session.token,
      runId: run.runId,
      ownAnnotationId: own?.annotationId ?? null,
      annotationIds: null,
      signoffContentSha256: signoff.integrity.contentSha256,
      issuedAt: this.#now().toISOString(),
    });
    return this.#assertProviderBlind(run, {
      opaqueRunId: this.#runAlias(session, run.runId),
      versionToken,
      title: surface.title,
      task: surface.task,
      requirements: surface.requirements,
      rubric: surface.rubric,
      generatedPlan: surface.generatedPlan,
      planningQuality: surface.planningQuality,
      evidenceOptions: this.#evidenceOptions(session, run, evalCase.requirements),
      ownStatus:
        own === undefined
          ? { state: 'not_submitted' }
          : {
              state: 'submitted',
              annotationToken: this.#annotationAlias(session, own.annotationId),
            },
    });
  }

  #adjudicationCase(
    session: SessionState,
    run: ProviderEvalRun,
    records: readonly HumanEvalAnnotation[],
  ): AdjudicationCaseDto {
    const evalCase = this.dataset.casesById.get(run.caseRef.caseId);
    if (evalCase === undefined) {
      throw new ReviewWorkspaceError('unknown_run', 'Run references an unknown case');
    }
    const surface = buildProviderBlindReviewSurface(this.dataset.suite, run);
    const signoff = this.#signoff(run);
    const annotationIds = records.map((record) => record.annotationId).sort();
    return this.#assertProviderBlind(run, {
      opaqueRunId: this.#runAlias(session, run.runId),
      versionToken: this.#versionToken({
        sessionToken: session.token,
        runId: run.runId,
        ownAnnotationId: null,
        annotationIds,
        signoffContentSha256: signoff.integrity.contentSha256,
        issuedAt: this.#now().toISOString(),
      }),
      title: surface.title,
      task: surface.task,
      requirements: surface.requirements,
      rubric: surface.rubric,
      generatedPlan: surface.generatedPlan,
      planningQuality: surface.planningQuality,
      evidenceOptions: this.#evidenceOptions(session, run, evalCase.requirements),
      annotations: records.map((record, index) => ({
        label: `Reviewer ${String.fromCharCode(65 + index)}`,
        recommendation: record.review.recommendation,
        judgments: record.review.judgments.map((judgment) => ({
          criterionId: judgment.criterionId,
          judgment: judgment.judgment,
          rationale: judgment.rationale,
          evidence: judgment.evidence.map((evidence) => ({
            kind: evidence.kind,
            label: this.#evidenceLabel(run, evalCase.requirements, evidence.kind, evidence.locator),
            note: evidence.note,
          })),
        })),
      })),
    });
  }

  #adjudicationAnnotations(runId: string): readonly HumanEvalAnnotation[] | null {
    if (this.dataset.adjudications.some((record) => record.runId === runId)) {
      return null;
    }
    const records = currentAnnotations(this.dataset.annotations).filter(
      (record) => record.runId === runId,
    );
    const distinctReviewers = new Set(records.map((record) => record.reviewer.pseudonym));
    return distinctReviewers.size >= 2 && annotationsDisagree(records) ? records : null;
  }

  #resolveJudgments(
    session: SessionState,
    run: ProviderEvalRun,
    submitted: readonly SubmittedCriterionJudgment[],
  ): HumanEvalCriterionJudgment[] {
    this.#assertProviderBlind(run, submitted);
    const evalCase = this.dataset.casesById.get(run.caseRef.caseId);
    if (evalCase === undefined) {
      throw new ReviewWorkspaceError('unknown_run', 'Run references an unknown case');
    }
    const expected = [...evalCase.rubricCriterionIds].sort();
    const actual = submitted.map((entry) => entry.criterionId).sort();
    if (
      expected.length !== actual.length ||
      expected.some((criterionId, index) => criterionId !== actual[index])
    ) {
      throw new ReviewWorkspaceError(
        'invalid_submission',
        'Every applicable criterion must be judged exactly once',
      );
    }
    return submitted.map((entry) => {
      const criterion = this.dataset.suite.rubric.criteria.find(
        (candidate) => candidate.id === entry.criterionId,
      );
      if (criterion === undefined || entry.evidence.length === 0) {
        throw new ReviewWorkspaceError(
          'invalid_submission',
          `Criterion ${entry.criterionId} requires evidence`,
        );
      }
      const evidence = entry.evidence.map((submittedEvidence) => {
        const binding = this.#evidenceBindings.get(submittedEvidence.token);
        if (
          binding === undefined ||
          binding.sessionToken !== session.token ||
          binding.runId !== run.runId ||
          !criterion.evidenceKinds.includes(binding.kind)
        ) {
          throw new ReviewWorkspaceError('invalid_submission', 'Evidence token is invalid');
        }
        return {
          kind: binding.kind,
          locator: binding.locator,
          contentSha256: binding.contentSha256,
          note: submittedEvidence.note,
        };
      });
      return {
        criterionId: entry.criterionId,
        judgment: entry.judgment,
        rationale: entry.rationale,
        evidence,
      };
    });
  }

  #evidenceOptions(
    session: SessionState,
    run: ProviderEvalRun,
    requirements: readonly { readonly id: string; readonly statement: string }[],
  ): readonly ReviewEvidenceOption[] {
    const options: Array<
      Omit<ReviewEvidenceOption, 'token'> & Omit<EvidenceBinding, 'sessionToken' | 'runId'>
    > = [];
    for (const requirement of requirements) {
      options.push({
        kind: 'requirement',
        locator: requirement.id,
        contentSha256: null,
        label: requirement.statement,
        mediaType: null,
      });
    }
    if (run.outcome.status === 'completed') {
      for (const node of run.outcome.result.draft.plan.steps) {
        options.push({
          kind: 'plan_step',
          locator: node.id,
          contentSha256: null,
          label: node.title,
          mediaType: null,
        });
      }
      options.push({
        kind: 'run_output',
        locator: 'outcome.result.draft',
        contentSha256: run.outcome.resultSha256,
        label: 'Generated planning result',
        mediaType: 'application/json',
      });
    }
    for (const event of run.sourceEvents.filter(
      (candidate) => candidate.correlationKind === 'host_execution',
    )) {
      options.push({
        kind: 'execution_event',
        locator: String(event.sequence),
        contentSha256: event.payloadSha256,
        label: 'Verified host execution event',
        mediaType: 'application/json',
      });
    }
    for (const artifact of run.artifacts.filter(
      (candidate) => candidate.kind !== 'eval_export' && candidate.kind !== 'provider_output',
    )) {
      options.push({
        kind: 'artifact',
        locator: artifact.artifactId,
        contentSha256: artifact.contentSha256,
        label: `Verified ${artifact.kind.replaceAll('_', ' ')} artifact`,
        mediaType: artifact.mediaType,
      });
    }
    const signedLabels = buildProviderBlindReviewSurface(this.dataset.suite, run).evidenceLabels;
    if (
      signedLabels.length !== options.length ||
      signedLabels.some(
        (signed, index) =>
          signed.kind !== options[index]!.kind ||
          signed.label !== options[index]!.label ||
          signed.mediaType !== options[index]!.mediaType,
      )
    ) {
      throw new ReviewWorkspaceError(
        'invalid_submission',
        'The review evidence projection no longer matches its provider-blind sign-off',
      );
    }
    return options.map(({ locator, contentSha256, ...safe }) => {
      const token = this.#opaque();
      this.#evidenceBindings.set(token, {
        sessionToken: session.token,
        runId: run.runId,
        kind: safe.kind,
        locator,
        contentSha256,
      });
      return { ...safe, token };
    });
  }

  #evidenceLabel(
    run: ProviderEvalRun,
    requirements: readonly { readonly id: string; readonly statement: string }[],
    kind: HumanEvalEvidenceKind,
    locator: string,
  ): string {
    if (kind === 'requirement') {
      return (
        requirements.find((requirement) => requirement.id === locator)?.statement ?? 'Requirement'
      );
    }
    if (kind === 'plan_step' && run.outcome.status === 'completed') {
      return (
        run.outcome.result.draft.plan.steps.find((step) => step.id === locator)?.title ??
        'Plan step'
      );
    }
    if (kind === 'execution_event') return 'Verified host execution event';
    if (kind === 'artifact') {
      const artifact = run.artifacts.find((candidate) => candidate.artifactId === locator);
      return artifact === undefined
        ? 'Verified artifact'
        : `Verified ${artifact.kind.replaceAll('_', ' ')} artifact`;
    }
    return 'Generated planning result';
  }

  async #acceptCandidate(
    addition:
      | { readonly annotation: HumanEvalAnnotation }
      | { readonly adjudication: HumanEvalAdjudication },
  ): Promise<void> {
    const annotations =
      'annotation' in addition
        ? [...this.dataset.annotations, addition.annotation]
        : this.dataset.annotations;
    const adjudications =
      'adjudication' in addition
        ? [...this.dataset.adjudications, addition.adjudication]
        : this.dataset.adjudications;
    validateHumanEvalDataset({
      suite: this.dataset.suite,
      runs: this.dataset.runs,
      annotations,
      adjudications,
      blindSignoffs: this.dataset.blindSignoffs,
    });
    const record = 'annotation' in addition ? addition.annotation : addition.adjudication;
    const directory = 'annotation' in addition ? 'annotations' : 'adjudications';
    const suffix = 'annotation' in addition ? 'annotation' : 'adjudication';
    const path = resolve(
      this.#datasetDirectory,
      directory,
      `${record.integrity.contentSha256}.${suffix}.json`,
    );
    await writeHumanEvalFileAtomicExclusive(
      path,
      `${JSON.stringify(record)}\n`,
      this.#datasetDirectory,
    );
    try {
      // Prospective validation protects the append; the full reload verifies the persisted
      // directory and every artifact before the new state becomes visible.
      this.dataset = assertReviewDatasetReady(
        await loadHumanEvalDatasetDirectory(this.#datasetDirectory, this.#artifactOptions),
      );
    } catch (error) {
      await rm(path, { force: true });
      this.dataset = await loadHumanEvalDatasetDirectory(
        this.#datasetDirectory,
        this.#artifactOptions,
      );
      throw error;
    }
  }

  async #artifactPath(uri: string): Promise<string> {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(uri);
    let root: string;
    let candidate: string;
    if (match === null) {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) || isAbsolute(uri)) {
        throw new ReviewWorkspaceError('invalid_submission', 'Artifact URI is not local');
      }
      root = this.#datasetDirectory;
      candidate = resolve(root, uri);
    } else {
      root = this.#artifactOptions.artifactRoots?.[match[1]!] ?? '';
      if (root === '' || match[2] === '' || isAbsolute(match[2]!)) {
        throw new ReviewWorkspaceError('invalid_submission', 'Artifact URI root is unavailable');
      }
      candidate = resolve(root, match[2]!);
    }
    const lexicalRoot = resolve(root);
    const lexicalRelative = relative(lexicalRoot, candidate);
    if (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) {
      throw new ReviewWorkspaceError('invalid_submission', 'Artifact URI escapes its local root');
    }
    const [physicalRoot, physicalCandidate] = await Promise.all([
      realpath(lexicalRoot),
      realpath(candidate),
    ]);
    const physicalRelative = relative(physicalRoot, physicalCandidate);
    if (physicalRelative.startsWith('..') || isAbsolute(physicalRelative)) {
      throw new ReviewWorkspaceError('invalid_submission', 'Artifact URI escapes its local root');
    }
    return physicalCandidate;
  }

  #session(token: string, role: ReviewWorkspaceRole): SessionState {
    const session = this.#sessions.get(token);
    if (session === undefined) {
      throw new ReviewWorkspaceError('invalid_session', 'Unknown review session');
    }
    if (session.role !== role) {
      throw new ReviewWorkspaceError('wrong_role', `This operation requires the ${role} role`);
    }
    return session;
  }

  #run(session: SessionState, opaqueRunId: string): ProviderEvalRun {
    const runId = session.runAliases.get(opaqueRunId);
    const run = runId === undefined ? undefined : this.dataset.runsById.get(runId);
    if (run === undefined) {
      throw new ReviewWorkspaceError('unknown_run', 'Unknown blinded run');
    }
    return run;
  }

  #runAlias(session: SessionState, runId: string): string {
    const existing = session.runAliasesById.get(runId);
    if (existing !== undefined) return existing;
    const alias = this.#opaque();
    session.runAliasesById.set(runId, alias);
    session.runAliases.set(alias, runId);
    return alias;
  }

  #annotationAlias(session: SessionState, annotationId: string): string {
    const existing = session.annotationAliasesById.get(annotationId);
    if (existing !== undefined) return existing;
    const alias = this.#opaque();
    session.annotationAliasesById.set(annotationId, alias);
    session.annotationAliases.set(alias, annotationId);
    return alias;
  }

  #ownCurrentAnnotation(session: SessionState, runId: string): HumanEvalAnnotation | undefined {
    return currentAnnotations(this.dataset.annotations).find(
      (record) => record.runId === runId && record.reviewer.pseudonym === session.pseudonym,
    );
  }

  #versionToken(binding: VersionBinding): string {
    const token = this.#opaque();
    this.#versionBindings.set(token, binding);
    return token;
  }

  #versionBinding(session: SessionState, token: string, runId: string): VersionBinding {
    const binding = this.#versionBindings.get(token);
    const run = this.dataset.runsById.get(runId);
    if (
      binding === undefined ||
      binding.sessionToken !== session.token ||
      binding.runId !== runId ||
      run === undefined ||
      binding.signoffContentSha256 !== this.#signoff(run).integrity.contentSha256
    ) {
      throw new ReviewWorkspaceError('stale_token', 'Version token is invalid or stale');
    }
    return binding;
  }

  #signoff(run: ProviderEvalRun) {
    const signoff = this.dataset.blindSignoffsByRunId.get(run.runId);
    if (signoff === undefined) {
      throw new ReviewWorkspaceError(
        'invalid_submission',
        'The run does not have a valid provider-blind sign-off',
      );
    }
    return signoff;
  }

  #assertProviderBlind<T>(run: ProviderEvalRun, value: T): T {
    const signoff = this.#signoff(run);
    const markers = deriveProviderIdentityMarkers(run.profile, signoff.supplementalAliases);
    try {
      assertProviderIdentityAbsent(value, markers);
      return value;
    } catch {
      throw new ReviewWorkspaceError(
        'invalid_submission',
        'Provider identity is not allowed in a blind review surface or submission',
      );
    }
  }

  #opaque(): string {
    return randomUUID();
  }

  #serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const mutate = async (): Promise<T> => {
      try {
        return await withHumanEvalDatasetWriteLock(this.#datasetDirectory, async () => {
          // A different reviewer process may have appended records since this workspace opened.
          // Refresh under the cross-process lock before resolving version tokens or candidates.
          this.dataset = assertReviewDatasetReady(
            await loadHumanEvalDatasetDirectory(this.#datasetDirectory, this.#artifactOptions),
          );
          return operation();
        });
      } catch (error) {
        if (error instanceof HumanEvalDatasetBusyError) {
          throw new ReviewWorkspaceError(
            'dataset_busy',
            'Another local capture or review process is changing this dataset',
          );
        }
        throw error;
      }
    };
    const result = this.#mutationTail.then(mutate, mutate);
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
