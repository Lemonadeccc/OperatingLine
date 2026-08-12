import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HumanEvalDatasetError,
  buildHumanEvalComparisonReport,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  computeProviderEvalConditionSha256,
  computeProviderEvalTreatmentSha256,
  createHumanEvalIntegrity,
  contentWithoutIntegrity,
  loadHumanEvalDatasetDirectory,
  sealHumanEvalAdjudication,
  sealHumanEvalSuite,
  validateHumanEvalComparisonReport,
  validateHumanEvalDataset,
} from '@operatingline/eval-kit';

import {
  buildHumanEvalAnnotationFixture,
  buildHumanEvalSuiteFixture,
  buildProviderBlindSignoffFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

function issuesFrom(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HumanEvalDatasetError);
    return (error as HumanEvalDatasetError).issues;
  }
  throw new Error('Expected Human Eval validation to fail');
}

async function issuesFromAsync(action: () => Promise<unknown>): Promise<readonly string[]> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HumanEvalDatasetError);
    return (error as HumanEvalDatasetError).issues;
  }
  throw new Error('Expected asynchronous Human Eval validation to fail');
}

function reseal<T extends { integrity: unknown }>(record: T): T {
  const content = contentWithoutIntegrity(record);
  return { ...content, integrity: createHumanEvalIntegrity(content) } as T;
}

function makeStructurallyLiveRun(
  run: ReturnType<typeof buildProviderEvalRunFixture>,
  requestId = run.invocation.request.requestId,
) {
  const live = structuredClone(run);
  if (live.outcome.status !== 'completed') {
    throw new Error('Expected completed fixture for structural live evidence');
  }
  const planContentSha256 = computePlanContentSha256(live.outcome.result.draft.plan);
  const executionId = '40000000-0000-4000-8000-000000000002';
  const reportId = '40000000-0000-4000-8000-000000000003';
  const treatment = {
    profile: live.profile,
    generationSettings: live.generationSettings,
  };
  live.runtimeAttestation = {
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_output',
    operation: live.invocation.operation,
    requestId,
    requestFingerprint: live.invocation.requestFingerprint,
    packetSha256: live.invocation.packetSha256,
    outputSha256: computeHumanEvalContentSha256(live.outcome.result.draft),
    treatment: {
      formatVersion: '1.0.0',
      evidenceClass: 'runtime_attested_provider_treatment',
      operation: live.invocation.operation,
      treatment,
      treatmentSha256: computeHumanEvalContentSha256(treatment),
    },
    occurredAt: live.outcome.result.generatedAt,
  };
  live.sourceKind = 'live_provider_invocation';
  live.sourceEvidence = {
    kind: 'eval_export_snapshot',
    snapshotId: '40000000-0000-4000-8000-000000000001',
    snapshotUpperSequence: 3,
    evalExportArtifactIds: ['eval.export'],
  };
  live.artifacts = [
    {
      artifactId: 'eval.export',
      kind: 'eval_export',
      mediaType: 'application/json',
      uri: 'eval-export.json',
      contentSha256: 'a'.repeat(64),
      metadata: {},
    },
    {
      artifactId: 'host.project',
      kind: 'host_project',
      mediaType: 'application/x-blender',
      uri: 'scene.blend',
      contentSha256: 'b'.repeat(64),
      metadata: {},
    },
    {
      artifactId: 'render.preview',
      kind: 'rendered_image',
      mediaType: 'image/png',
      uri: 'preview.png',
      contentSha256: 'c'.repeat(64),
      metadata: {},
      visualEnvironment: {
        width: 512,
        height: 512,
        frame: 1,
        renderEngine: 'BLENDER_EEVEE_NEXT',
        colorManagement: 'AgX / Medium High Contrast',
        hostVersion: '4.5.0',
        adapterVersion: '1.0.0',
        planContentSha256,
        executionId,
        terminalHostReportId: reportId,
        terminalHostEventSequence: 3,
        hostProjectSha256: 'b'.repeat(64),
      },
    },
  ];
  live.sourceEvents = [
    {
      sequence: 1,
      eventId: 'provider.requested',
      eventType: 'planning.provider.generation.requested',
      correlationKind: 'provider_request',
      requestId,
      payloadSha256: 'd'.repeat(64),
    },
    {
      sequence: 2,
      eventId: 'provider.completed',
      eventType: 'planning.provider.generation.completed',
      correlationKind: 'provider_request',
      requestId,
      payloadSha256: 'e'.repeat(64),
    },
    {
      sequence: 3,
      eventId: 'host.completed',
      eventType: 'companion.state.reported',
      correlationKind: 'host_execution',
      planId:
        live.invocation.operation === 'initial_plan'
          ? live.invocation.packet.context.requestedPlanId
          : live.invocation.packet.context.revisionRequest.basePlan.id,
      planContentSha256,
      instanceId: null,
      executionId,
      reportId,
      payloadSha256: 'f'.repeat(64),
    },
  ];
  return reseal(live);
}

function makeNeedsRevisionRun(run: ReturnType<typeof buildProviderEvalRunFixture>) {
  const changed = structuredClone(run);
  if (changed.outcome.status !== 'completed') {
    throw new Error('Expected completed fixture for needs-revision evidence');
  }
  changed.outcome.result.status = 'needs_revision';
  changed.outcome.result.planningQuality.valid = false;
  changed.outcome.result.planningQuality.summary.errorCount = 1;
  changed.outcome.result.planningQuality.findings = [
    {
      code: 'test.invalid_plan',
      severity: 'error',
      message: 'Synthetic quality failure keeps this provider result non-executable.',
      stepIds: [],
      phaseIds: [],
    },
  ];
  changed.outcome.resultSha256 = computeHumanEvalContentSha256(changed.outcome.result);
  return reseal(changed);
}

function suiteWithReviewerMinimum(minimumIndependentAnnotationsPerRun: number) {
  const content = contentWithoutIntegrity(structuredClone(buildHumanEvalSuiteFixture()));
  content.policy.minimumIndependentAnnotationsPerRun = minimumIndependentAnnotationsPerRun;
  return sealHumanEvalSuite(content);
}

function buildAdjudicationFixture(
  suite: ReturnType<typeof buildHumanEvalSuiteFixture>,
  run: ReturnType<typeof buildProviderEvalRunFixture>,
  annotations: readonly ReturnType<typeof buildHumanEvalAnnotationFixture>[],
) {
  return sealHumanEvalAdjudication({
    formatVersion: '1.0.0',
    adjudicationId: '30000000-0000-4000-8000-000000000099',
    caseRef: run.caseRef,
    runId: run.runId,
    annotationRefs: annotations.map((annotation) => ({
      annotationId: annotation.annotationId,
      annotationContentSha256: annotation.integrity.contentSha256,
    })),
    adjudicatorPseudonym: 'reviewer.adjudicator',
    completedAt: '2026-08-05T00:00:02.000Z',
    judgments: suite.cases[0]!.rubricCriterionIds.map((criterionId) => ({
      criterionId,
      judgment: 'partially_met' as const,
      rationale: `Independent adjudication for ${criterionId}.`,
      evidence: [
        {
          kind: 'run_output' as const,
          locator: 'outcome.result.draft',
          contentSha256: run.outcome.status === 'completed' ? run.outcome.resultSha256 : null,
          note: 'Adjudicated against the exact parsed provider outcome.',
        },
      ],
    })),
    sourceKind: 'human_adjudication',
    dataHandling: run.dataHandling,
  });
}

async function writeDataset(
  directory: string,
  records: {
    suite: unknown;
    runs?: readonly { runId: string }[];
    annotations?: readonly { annotationId: string }[];
    adjudications?: readonly { adjudicationId: string }[];
    blindSignoffs?: readonly { runId: string }[];
  },
): Promise<void> {
  await Promise.all(
    ['runs', 'annotations', 'adjudications', 'blind-signoffs'].map((name) =>
      mkdir(join(directory, name), { recursive: true }),
    ),
  );
  await writeFile(join(directory, 'suite.json'), JSON.stringify(records.suite));
  await Promise.all([
    ...(records.runs ?? []).map((run) =>
      writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run)),
    ),
    ...(records.annotations ?? []).map((annotation) =>
      writeFile(
        join(directory, 'annotations', `${annotation.annotationId}.annotation.json`),
        JSON.stringify(annotation),
      ),
    ),
    ...(records.adjudications ?? []).map((adjudication) =>
      writeFile(
        join(directory, 'adjudications', `${adjudication.adjudicationId}.adjudication.json`),
        JSON.stringify(adjudication),
      ),
    ),
    ...(records.blindSignoffs ?? []).map((signoff) =>
      writeFile(
        join(directory, 'blind-signoffs', `${signoff.runId}.provider-blind.json`),
        JSON.stringify(signoff),
      ),
    ),
  ]);
}

describe('human eval dataset', () => {
  it('loads the seven-case public Blender suite and reports missing evidence honestly', async () => {
    const dataset = await loadHumanEvalDatasetDirectory(
      resolve('protocol/fixtures/v1/eval/blender-core'),
      { artifactRoots: { repo: resolve('.') } },
    );
    const report = buildHumanEvalComparisonReport(dataset, {
      generatedAt: '2026-08-05T00:00:00.000Z',
    });

    expect(dataset.suite).toMatchObject({
      suiteId: 'blender.core_planning',
      status: 'collecting',
      policy: { numericScoring: 'prohibited', providerRanking: 'prohibited' },
    });
    expect(dataset.suite.cases).toHaveLength(7);
    expect(new Set(dataset.suite.cases.map((evalCase) => evalCase.lineageId)).size).toBe(6);
    expect(report).toMatchObject({
      audience: 'published',
      policy: { numericScoring: false, providerRanking: false },
      completeness: {
        caseCount: 7,
        runCount: 0,
        liveRunCount: 0,
        currentAnnotationCount: 0,
        rawAnnotationRecordCount: 0,
      },
    });
    expect(report.completeness.casesWithoutLiveRuns).toHaveLength(7);
    expect(report.cases.every((evalCase) => evalCase.missingLiveRun)).toBe(true);
    expect(report).not.toHaveProperty('score');
    expect(report).not.toHaveProperty('ranking');

    const tamperedReport = structuredClone(report);
    tamperedReport.completeness.caseCount = 999;
    expect(issuesFrom(() => validateHumanEvalComparisonReport(tamperedReport))).toContainEqual(
      expect.stringContaining('Comparison completeness'),
    );
  });

  it('keeps synthetic test runs out of verified published reports and preserves judgments', async () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const annotations = [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        '20000000-0000-4000-8000-000000000001',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        '20000000-0000-4000-8000-000000000002',
      ),
    ];
    const dataset = validateHumanEvalDataset({
      suite,
      runs: [run],
      annotations,
      blindSignoffs: [buildProviderBlindSignoffFixture(suite, run)],
    });
    expect(() =>
      buildHumanEvalComparisonReport(dataset, {
        generatedAt: '2026-08-05T00:00:00.000Z',
      }),
    ).toThrow('Published comparison requires verified artifacts');
    const forgedMarker = { ...dataset, verificationLevel: 'artifact_verified' as const };
    expect(() =>
      buildHumanEvalComparisonReport(forgedMarker, {
        generatedAt: '2026-08-05T00:00:00.000Z',
      }),
    ).toThrow('Published comparison requires verified artifacts');
    const development = buildHumanEvalComparisonReport(dataset, {
      generatedAt: '2026-08-05T00:00:00.000Z',
      audience: 'development',
    });
    expect(development.cases[0]?.conditionGroups[0]?.runs[0]).toMatchObject({
      sourceKind: 'synthetic_test_fixture',
      annotationState: 'complete',
      annotations: [
        { reviewerPseudonym: 'reviewer.alpha', recommendation: 'accept' },
        { reviewerPseudonym: 'reviewer.beta', recommendation: 'accept' },
      ],
    });

    const directory = await mkdtemp(join(tmpdir(), 'operatingline-human-eval-published-'));
    try {
      await writeDataset(directory, {
        suite,
        runs: [run],
        annotations,
        blindSignoffs: dataset.blindSignoffs,
      });
      const verified = await loadHumanEvalDatasetDirectory(directory);
      const published = buildHumanEvalComparisonReport(verified, {
        generatedAt: '2026-08-05T00:00:00.000Z',
      });
      expect(published.completeness).toMatchObject({
        runCount: 0,
        liveRunCount: 0,
        includedSyntheticRunCount: 0,
        excludedSyntheticRunCount: 1,
      });
      expect(published.cases[0]?.conditionGroups).toEqual([]);
      const mutatedAfterVerification = verified as unknown as { suite: { title: string } };
      mutatedAfterVerification.suite.title = 'Changed after artifact verification';
      expect(() =>
        buildHumanEvalComparisonReport(verified, {
          generatedAt: '2026-08-05T00:00:00.000Z',
        }),
      ).toThrow('Published comparison requires verified artifacts');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects tampered records, comparability drift, and unreproducible claims', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const tampered = structuredClone(run);
    tampered.generationSettings.normalizedParameters['temperature'] = 0.8;
    expect(issuesFrom(() => validateHumanEvalDataset({ suite, runs: [tampered] }))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('integrity mismatch'),
        expect.stringContaining('generation parameter hash mismatch'),
        expect.stringContaining('comparability hash mismatch'),
      ]),
    );

    const unresolved = structuredClone(run);
    unresolved.profile.model.resolvedRevision = null;
    unresolved.profile.model.resolution = 'provider_did_not_disclose';
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(unresolved)] })),
    ).toContainEqual(expect.stringContaining('Reproducible runs require'));

    for (const determinism of ['non_deterministic', 'unknown'] as const) {
      const unstable = structuredClone(run);
      unstable.generationSettings.determinism = determinism;
      expect(
        issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(unstable)] })),
      ).toContainEqual(expect.stringContaining('Reproducible runs require'));
    }

    const missingBuildIdentity = structuredClone(run);
    missingBuildIdentity.environment.sourceCommit = null;
    missingBuildIdentity.environment.adapterVersion = null;
    missingBuildIdentity.environment.hostVersion = null;
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(missingBuildIdentity)] })),
    ).toContainEqual(expect.stringContaining('Reproducible runs require'));

    const seedless = structuredClone(run);
    seedless.generationSettings.determinism = 'seeded_best_effort';
    seedless.generationSettings.seed = null;
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(seedless)] })),
    ).toContainEqual(expect.stringContaining('requires an explicit seed'));

    const seededBestEffort = structuredClone(run);
    seededBestEffort.generationSettings.determinism = 'seeded_best_effort';
    seededBestEffort.generationSettings.seed = 42;
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(seededBestEffort)] })),
    ).toContainEqual(expect.stringContaining('fully deterministic'));

    const duplicateTrial = structuredClone(run);
    duplicateTrial.runId = '10000000-0000-4000-8000-000000000099';
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [run, reseal(duplicateTrial)] })),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('is reused by more than one run'),
        expect.stringContaining('repeats replicate'),
      ]),
    );

    const cyclic = structuredClone(run);
    cyclic.parentRunId = cyclic.runId;
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(cyclic)] })),
    ).toContainEqual(expect.stringContaining('Run parent cycle'));

    const liveNeedsRevision = makeNeedsRevisionRun(makeStructurallyLiveRun(run));
    const evidenceOnly = structuredClone(liveNeedsRevision);
    evidenceOnly.sourceEvidence = {
      ...evidenceOnly.sourceEvidence,
      snapshotUpperSequence: 2,
    };
    evidenceOnly.sourceEvents = evidenceOnly.sourceEvents.filter(
      (event) => event.correlationKind === 'provider_request',
    );
    evidenceOnly.artifacts = evidenceOnly.artifacts.filter(
      (artifact) => artifact.kind === 'eval_export',
    );
    expect(() => validateHumanEvalDataset({ suite, runs: [reseal(evidenceOnly)] })).not.toThrow();
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [liveNeedsRevision] })),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('host source event does not match the exact provider output Plan'),
        expect.stringContaining('rendered image render.preview is not bound'),
      ]),
    );
  });

  it('rejects a failed run carrying runtime-attested provider output', () => {
    const suite = buildHumanEvalSuiteFixture();
    const failed = structuredClone(makeStructurallyLiveRun(buildProviderEvalRunFixture(suite)));
    const error = {
      error: 'planner_provider_failed' as const,
      requestId: failed.invocation.request.requestId,
      message: 'Synthetic provider failure after runtime output attestation.',
      retryMode: 'never' as const,
    };
    failed.outcome = {
      status: 'failed',
      operation: 'initial_plan',
      error,
      errorSha256: computeHumanEvalContentSha256(error),
    };
    failed.sourceEvidence = { ...failed.sourceEvidence, snapshotUpperSequence: 2 };
    failed.sourceEvents = failed.sourceEvents
      .filter((event) => event.correlationKind === 'provider_request')
      .map((event) =>
        event.eventType === 'planning.provider.generation.completed'
          ? { ...event, eventType: 'planning.provider.generation.failed' as const }
          : event,
      );
    failed.artifacts = failed.artifacts.filter((artifact) => artifact.kind === 'eval_export');

    expect(issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(failed)] }))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Provider output attestation must match a completed invocation'),
      ]),
    );
  });

  it('requires complete, independent, exact-rubric human annotations', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const first = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000003',
    );
    const duplicateReviewer = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000004',
    );
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({ suite, runs: [run], annotations: [first, duplicateReviewer] }),
      ),
    ).toContainEqual(expect.stringContaining('more than one current annotation'));

    const incomplete = structuredClone(first);
    incomplete.review.judgments = incomplete.review.judgments.slice(0, 1);
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({ suite, runs: [run], annotations: [reseal(incomplete)] }),
      ),
    ).toContainEqual(expect.stringContaining('must judge every applicable case criterion'));

    const mismatchedEvidence = structuredClone(first);
    mismatchedEvidence.review.judgments[0]!.evidence[0]!.contentSha256 = 'f'.repeat(64);
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations: [reseal(mismatchedEvidence)],
        }),
      ),
    ).toContainEqual(expect.stringContaining('run-output evidence hash'));
  });

  it('binds adjudication to exact current annotations and exposes it at run level', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const annotations = [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        '20000000-0000-4000-8000-000000000011',
        'met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        '20000000-0000-4000-8000-000000000012',
        'not_met',
      ),
    ];
    const adjudication = sealHumanEvalAdjudication({
      formatVersion: '1.0.0',
      adjudicationId: '30000000-0000-4000-8000-000000000001',
      caseRef: run.caseRef,
      runId: run.runId,
      annotationRefs: annotations.map((annotation) => ({
        annotationId: annotation.annotationId,
        annotationContentSha256: annotation.integrity.contentSha256,
      })),
      adjudicatorPseudonym: 'reviewer.gamma',
      completedAt: '2026-08-05T00:00:02.000Z',
      judgments: suite.cases[0]!.rubricCriterionIds.map((criterionId) => ({
        criterionId,
        judgment: 'partially_met' as const,
        rationale: `Independent adjudication for ${criterionId}.`,
        evidence: [
          {
            kind: 'run_output' as const,
            locator: 'outcome.result.draft',
            contentSha256: run.outcome.status === 'completed' ? run.outcome.resultSha256 : null,
            note: 'Adjudicated against the exact parsed provider outcome.',
          },
        ],
      })),
      sourceKind: 'human_adjudication',
      dataHandling: run.dataHandling,
    });
    const dataset = validateHumanEvalDataset({
      suite,
      runs: [run],
      annotations,
      adjudications: [adjudication],
      blindSignoffs: [buildProviderBlindSignoffFixture(suite, run)],
    });
    const report = buildHumanEvalComparisonReport(dataset, {
      generatedAt: '2026-08-05T00:00:03.000Z',
      audience: 'development',
    });
    expect(report.cases[0]?.conditionGroups[0]?.runs[0]).toMatchObject({
      annotationState: 'adjudicated',
      annotations: [
        { annotationId: annotations[0]!.annotationId },
        { annotationId: annotations[1]!.annotationId },
      ],
      adjudication: {
        adjudicationId: adjudication.adjudicationId,
        adjudicatorPseudonym: 'reviewer.gamma',
      },
    });

    const wrongHash = structuredClone(adjudication);
    wrongHash.annotationRefs[0]!.annotationContentSha256 = 'f'.repeat(64);
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations,
          adjudications: [reseal(wrongHash)],
        }),
      ),
    ).toContainEqual(expect.stringContaining('annotation reference'));

    const dependent = structuredClone(adjudication);
    dependent.adjudicatorPseudonym = 'reviewer.alpha';
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations,
          adjudications: [reseal(dependent)],
        }),
      ),
    ).toContainEqual(expect.stringContaining('adjudicator must be independent'));

    const unreferencedCurrent = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.delta',
      '20000000-0000-4000-8000-000000000013',
      'met',
    );
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations: [...annotations, unreferencedCurrent],
          adjudications: [adjudication],
        }),
      ),
    ).toContainEqual(expect.stringContaining('every current annotation'));
  });

  it('rejects adjudication below the suite independent-reviewer minimum', () => {
    const suite = suiteWithReviewerMinimum(3);
    const run = buildProviderEvalRunFixture(suite);
    const annotations = [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        '20000000-0000-4000-8000-000000000021',
        'met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        '20000000-0000-4000-8000-000000000022',
        'not_met',
      ),
    ];
    const adjudication = buildAdjudicationFixture(suite, run, annotations);

    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations,
          adjudications: [adjudication],
          blindSignoffs: [buildProviderBlindSignoffFixture(suite, run)],
        }),
      ),
    ).toContainEqual(expect.stringContaining('requires 3 independent reviewers'));
  });

  it('accepts adjudication at the suite independent-reviewer minimum when reviews disagree', () => {
    const suite = suiteWithReviewerMinimum(3);
    const run = buildProviderEvalRunFixture(suite);
    const annotations = [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        '20000000-0000-4000-8000-000000000031',
        'met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        '20000000-0000-4000-8000-000000000032',
        'not_met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.gamma',
        '20000000-0000-4000-8000-000000000033',
        'met',
      ),
    ];
    const adjudication = buildAdjudicationFixture(suite, run, annotations);

    expect(() =>
      validateHumanEvalDataset({
        suite,
        runs: [run],
        annotations,
        adjudications: [adjudication],
        blindSignoffs: [buildProviderBlindSignoffFixture(suite, run)],
      }),
    ).not.toThrow();
  });

  it('gates released suites on live treatments, human review, host execution, and render evidence', () => {
    const baseSuite = buildHumanEvalSuiteFixture();
    const suiteContent = contentWithoutIntegrity(structuredClone(baseSuite));
    suiteContent.status = 'released';
    suiteContent.rubric.criteria.push(
      {
        id: 'execution.host_outcome',
        title: 'Host execution outcome',
        dimension: 'execution_outcome',
        evaluationStage: 'execution',
        question: 'Did the exact host execution reach a reviewable terminal state?',
        guidance: 'Use a host event from the frozen Eval export.',
        evidenceKinds: ['execution_event', 'run_output'],
      },
      {
        id: 'artifact.visual_alignment',
        title: 'Rendered artifact alignment',
        dimension: 'visual_alignment',
        evaluationStage: 'artifact',
        question: 'Does the rendered artifact visibly satisfy the requested goal?',
        guidance: 'Use a content-addressed rendered image with visual provenance.',
        evidenceKinds: ['artifact', 'run_output'],
      },
    );
    suiteContent.cases[0]!.rubricCriterionIds.push(
      'execution.host_outcome',
      'artifact.visual_alignment',
    );
    const suite = sealHumanEvalSuite(suiteContent);
    const first = makeStructurallyLiveRun(buildProviderEvalRunFixture(suite));
    const second = structuredClone(first);
    second.runId = '10000000-0000-4000-8000-000000000099';
    second.invocation.request.requestId = '10000000-0000-4000-8000-000000000098';
    second.invocation.requestFingerprint = computeHumanEvalContentSha256(
      second.invocation.goalProvenance === null
        ? second.invocation.request
        : { request: second.invocation.request, ...second.invocation.goalProvenance },
    );
    if (second.outcome.status === 'completed') {
      second.outcome.result.requestId = second.invocation.request.requestId;
      second.outcome.resultSha256 = computeHumanEvalContentSha256(second.outcome.result);
    }
    for (const event of second.sourceEvents) {
      if (event.correlationKind === 'provider_request') {
        event.requestId = second.invocation.request.requestId;
      }
    }
    second.generationSettings.normalizedParameters['temperature'] = 0.25;
    second.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
      second.generationSettings.normalizedParameters,
    );
    if (second.runtimeAttestation === null) throw new Error('Expected runtime attestation');
    second.runtimeAttestation.requestId = second.invocation.request.requestId;
    second.runtimeAttestation.requestFingerprint = second.invocation.requestFingerprint;
    second.runtimeAttestation.treatment.treatment.generationSettings = second.generationSettings;
    second.runtimeAttestation.treatment.treatmentSha256 = computeHumanEvalContentSha256(
      second.runtimeAttestation.treatment.treatment,
    );
    second.comparability.treatmentSha256 = computeProviderEvalTreatmentSha256(second);
    const secondSealed = reseal(second);
    const runs = [first, secondSealed];
    const annotations = runs.flatMap((run, runIndex) =>
      ['reviewer.alpha', 'reviewer.beta'].map((reviewer, reviewerIndex) => {
        const annotation = buildHumanEvalAnnotationFixture(
          suite,
          run,
          reviewer,
          `20000000-0000-4000-8${runIndex}0${reviewerIndex}-000000000020`,
        );
        const execution = annotation.review.judgments.find(
          (judgment) => judgment.criterionId === 'execution.host_outcome',
        )!;
        execution.evidence = [
          {
            kind: 'execution_event',
            locator: '3',
            contentSha256: 'f'.repeat(64),
            note: 'Exact host state event from the frozen source snapshot.',
          },
        ];
        const artifact = annotation.review.judgments.find(
          (judgment) => judgment.criterionId === 'artifact.visual_alignment',
        )!;
        artifact.evidence = [
          {
            kind: 'artifact',
            locator: 'render.preview',
            contentSha256: 'c'.repeat(64),
            note: 'Exact rendered preview with environment provenance.',
          },
        ];
        return reseal(annotation);
      }),
    );

    const structurallyReady = validateHumanEvalDataset({
      suite,
      runs,
      annotations,
      blindSignoffs: runs.map((run) => buildProviderBlindSignoffFixture(suite, run)),
    });
    expect(structurallyReady.verificationLevel).toBe('structure_only');
    expect(() =>
      buildHumanEvalComparisonReport(structurallyReady, {
        generatedAt: '2026-08-05T00:00:04.000Z',
      }),
    ).toThrow('Published comparison requires verified artifacts');

    const needsRevisionFirst = makeNeedsRevisionRun(first);
    const needsRevisionAnnotations = annotations.slice(0, 2).map((annotation) => {
      const changed = structuredClone(annotation);
      changed.runContentSha256 = needsRevisionFirst.integrity.contentSha256;
      if (needsRevisionFirst.outcome.status !== 'completed') {
        throw new Error('Expected needs-revision outcome');
      }
      for (const judgment of changed.review.judgments) {
        for (const evidence of judgment.evidence) {
          if (evidence.kind === 'run_output') {
            evidence.contentSha256 = needsRevisionFirst.outcome.resultSha256;
          }
        }
      }
      return reseal(changed);
    });
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [needsRevisionFirst, secondSealed],
          annotations: [...needsRevisionAnnotations, ...annotations.slice(2)],
        }),
      ),
    ).toContainEqual(expect.stringContaining('needs_revision provider result'));

    const missingExecution = structuredClone(annotations[0]!);
    missingExecution.review.judgments.find(
      (judgment) => judgment.criterionId === 'execution.host_outcome',
    )!.evidence = [
      {
        kind: 'run_output',
        locator: 'outcome.result.draft',
        contentSha256: first.outcome.status === 'completed' ? first.outcome.resultSha256 : null,
        note: 'A parsed draft is not host execution evidence.',
      },
    ];
    const missingRender = structuredClone(annotations[1]!);
    missingRender.review.judgments.find(
      (judgment) => judgment.criterionId === 'artifact.visual_alignment',
    )!.evidence = [
      {
        kind: 'run_output',
        locator: 'outcome.result.draft',
        contentSha256: first.outcome.status === 'completed' ? first.outcome.resultSha256 : null,
        note: 'A parsed draft is not a rendered visual artifact.',
      },
    ];
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs,
          annotations: [reseal(missingExecution), reseal(missingRender), ...annotations.slice(2)],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('requires verified host execution evidence'),
        expect.stringContaining('requires a rendered image with visual provenance'),
      ]),
    );
  });

  it('rejects mismatched record references, rubric hashes, and dangling evidence', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const annotation = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000007',
    );

    const mismatchedRun = structuredClone(run);
    mismatchedRun.caseRef.caseContentSha256 = 'e'.repeat(64);
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(mismatchedRun)] })),
    ).toContainEqual(expect.stringContaining('case hash does not match'));

    const mismatchedCatalog = structuredClone(run);
    mismatchedCatalog.invocation.packet.context.catalog.adapterVersionRange = '>=999.0.0';
    mismatchedCatalog.invocation.packetSha256 = computeHumanEvalContentSha256(
      mismatchedCatalog.invocation.packet,
    );
    mismatchedCatalog.comparability.conditionSha256 =
      computeProviderEvalConditionSha256(mismatchedCatalog);
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(mismatchedCatalog)] })),
    ).toContainEqual(expect.stringContaining('catalog content does not match'));

    const mismatchedOutcome = structuredClone(run);
    if (mismatchedOutcome.outcome.status === 'completed') {
      mismatchedOutcome.outcome.result.draft.planning.goal = 'A different evaluation goal.';
      mismatchedOutcome.outcome.result.planningQuality.goal = 'A different evaluation goal.';
      mismatchedOutcome.outcome.resultSha256 = computeHumanEvalContentSha256(
        mismatchedOutcome.outcome.result,
      );
    }
    expect(
      issuesFrom(() => validateHumanEvalDataset({ suite, runs: [reseal(mismatchedOutcome)] })),
    ).toContainEqual(expect.stringContaining('exact captured planning packet'));

    const mismatchedAnnotation = structuredClone(annotation);
    mismatchedAnnotation.caseRef.caseContentSha256 = 'd'.repeat(64);
    mismatchedAnnotation.runContentSha256 = 'c'.repeat(64);
    mismatchedAnnotation.rubric.contentSha256 = 'b'.repeat(64);
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite,
          runs: [run],
          annotations: [reseal(mismatchedAnnotation)],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('case hash does not match'),
        expect.stringContaining('does not match its exact run evidence'),
        expect.stringContaining('rubric reference does not match'),
      ]),
    );

    const suiteContent = contentWithoutIntegrity(structuredClone(suite));
    suiteContent.rubric.criteria[0]!.evidenceKinds = [
      'requirement',
      'plan_step',
      'execution_event',
      'artifact',
      'run_output',
    ];
    const evidenceSuite = sealHumanEvalSuite(suiteContent);
    const evidenceRun = buildProviderEvalRunFixture(evidenceSuite);
    const danglingEvidence = buildHumanEvalAnnotationFixture(
      evidenceSuite,
      evidenceRun,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000008',
    );
    danglingEvidence.review.judgments[0]!.evidence = [
      {
        kind: 'requirement',
        locator: 'missing.requirement',
        contentSha256: null,
        note: 'Missing requirement reference.',
      },
      {
        kind: 'plan_step',
        locator: 'missing.step',
        contentSha256: null,
        note: 'Missing plan-step reference.',
      },
      {
        kind: 'execution_event',
        locator: '999',
        contentSha256: 'a'.repeat(64),
        note: 'Missing execution-event reference.',
      },
      {
        kind: 'artifact',
        locator: 'missing.artifact',
        contentSha256: 'b'.repeat(64),
        note: 'Missing artifact reference.',
      },
    ];
    expect(
      issuesFrom(() =>
        validateHumanEvalDataset({
          suite: evidenceSuite,
          runs: [evidenceRun],
          annotations: [reseal(danglingEvidence)],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown requirement'),
        expect.stringContaining('unknown plan step'),
        expect.stringContaining('unknown or hash-mismatched event'),
        expect.stringContaining('unknown or hash-mismatched artifact'),
      ]),
    );
  });

  it('rejects missing and hash-mismatched local reference artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-human-eval-'));
    try {
      const suite = buildHumanEvalSuiteFixture();
      const suiteContent = contentWithoutIntegrity(structuredClone(suite));
      suiteContent.cases[0]!.references = [
        {
          artifactId: 'canvas.reference',
          kind: 'planning_benchmark',
          mediaType: 'application/json',
          uri: 'reference.json',
          contentSha256: 'a'.repeat(64),
          metadata: {},
        },
      ];
      const suiteWithReference = sealHumanEvalSuite(suiteContent);
      await writeFile(join(directory, 'suite.json'), JSON.stringify(suiteWithReference));

      expect(await issuesFromAsync(() => loadHumanEvalDatasetDirectory(directory))).toContainEqual(
        expect.stringContaining('is unreadable'),
      );

      await writeFile(join(directory, 'reference.json'), '{}');
      expect(await issuesFromAsync(() => loadHumanEvalDatasetDirectory(directory))).toContainEqual(
        expect.stringContaining('artifact canvas.reference hash mismatch'),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves disagreement instead of collapsing it into a score or winner', () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const annotations = [
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.alpha',
        '20000000-0000-4000-8000-000000000005',
        'met',
      ),
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'reviewer.beta',
        '20000000-0000-4000-8000-000000000006',
        'not_met',
      ),
    ];
    const dataset = validateHumanEvalDataset({
      suite,
      runs: [run],
      annotations,
      blindSignoffs: [buildProviderBlindSignoffFixture(suite, run)],
    });
    const report = buildHumanEvalComparisonReport(dataset, {
      generatedAt: '2026-08-05T00:00:00.000Z',
      audience: 'development',
    });

    expect(report.cases[0]?.conditionGroups[0]?.runs[0]?.annotationState).toBe(
      'disagreement_preserved',
    );
    expect(report.cases[0]?.conditionGroups[0]?.runs[0]?.annotations).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('"winner"');
    expect(JSON.stringify(report)).not.toContain('"score"');
  });
});
