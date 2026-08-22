import { describe, expect, it } from 'vitest';

import {
  HumanEvalDatasetError,
  buildHumanEvalReleaseCandidateManifest,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  computeProviderEvalTreatmentSha256,
  contentWithoutIntegrity,
  createHumanEvalIntegrity,
  sealHumanEvalSuite,
  validateHumanEvalDataset,
  validateHumanEvalReleaseCandidateManifest,
  type ValidatedHumanEvalDataset,
} from '@operatingline/eval-kit';
import type { HumanEvalAnnotation, HumanEvalSuite, ProviderEvalRun } from '@operatingline/protocol';

import { markArtifactVerifiedDataset } from '../../../packages/eval-kit/src/verification.js';
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

function makeReleasedSuite(): HumanEvalSuite {
  const content = contentWithoutIntegrity(structuredClone(buildHumanEvalSuiteFixture()));
  content.status = 'released';
  content.cases[0]!.references = [
    {
      artifactId: 'case.benchmark',
      kind: 'planning_benchmark',
      mediaType: 'application/json',
      uri: 'case-benchmark.json',
      contentSha256: '9'.repeat(64),
      metadata: {},
    },
  ];
  return sealHumanEvalSuite(content);
}

// These records are deliberately live-shaped validator fixtures. They exercise release gates only
// and do not claim that an external Provider call or real human review occurred.
function makeStructurallyLiveRun(run: ProviderEvalRun): ProviderEvalRun {
  const live = structuredClone(run);
  if (live.outcome.status !== 'completed') throw new Error('Expected completed fixture run');
  const requestId = live.invocation.request.requestId;
  const planContentSha256 = computePlanContentSha256(live.outcome.result.draft.plan);
  const treatment = { profile: live.profile, generationSettings: live.generationSettings };
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
        executionId: '40000000-0000-4000-8000-000000000002',
        terminalHostReportId: '40000000-0000-4000-8000-000000000003',
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
      executionId: '40000000-0000-4000-8000-000000000002',
      reportId: '40000000-0000-4000-8000-000000000003',
      payloadSha256: 'f'.repeat(64),
    },
  ];
  return reseal(live);
}

function makeSecondTreatment(first: ProviderEvalRun): ProviderEvalRun {
  const second = structuredClone(first);
  second.runId = '10000000-0000-4000-8000-000000000099';
  second.invocation.request.requestId = '10000000-0000-4000-8000-000000000098';
  second.invocation.requestFingerprint = computeHumanEvalContentSha256(
    second.invocation.goalProvenance === null
      ? second.invocation.request
      : { request: second.invocation.request, ...second.invocation.goalProvenance },
  );
  if (second.outcome.status !== 'completed') throw new Error('Expected completed fixture run');
  second.outcome.result.requestId = second.invocation.request.requestId;
  second.outcome.resultSha256 = computeHumanEvalContentSha256(second.outcome.result);
  for (const event of second.sourceEvents) {
    if (event.correlationKind === 'provider_request') {
      event.requestId = second.invocation.request.requestId;
    }
  }
  second.generationSettings.normalizedParameters['temperature'] = 0.25;
  second.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
    second.generationSettings.normalizedParameters,
  );
  if (
    second.runtimeAttestation === null ||
    second.runtimeAttestation.evidenceClass !== 'runtime_attested_provider_output'
  ) {
    throw new Error('Expected runtime output attestation');
  }
  second.runtimeAttestation.requestId = second.invocation.request.requestId;
  second.runtimeAttestation.requestFingerprint = second.invocation.requestFingerprint;
  second.runtimeAttestation.treatment.treatment.generationSettings = second.generationSettings;
  second.runtimeAttestation.treatment.treatmentSha256 = computeHumanEvalContentSha256(
    second.runtimeAttestation.treatment.treatment,
  );
  second.comparability.treatmentSha256 = computeProviderEvalTreatmentSha256(second);
  return reseal(second);
}

function annotationsForRuns(
  suite: HumanEvalSuite,
  runs: readonly ProviderEvalRun[],
): HumanEvalAnnotation[] {
  const firstSuperseded = buildHumanEvalAnnotationFixture(
    suite,
    runs[0]!,
    'reviewer.Z',
    '20000000-0000-4000-8000-000000000001',
  );
  const firstCurrent = structuredClone(
    buildHumanEvalAnnotationFixture(
      suite,
      runs[0]!,
      'reviewer.Z',
      '20000000-0000-4000-8000-000000000002',
    ),
  );
  firstCurrent.supersedesAnnotationId = firstSuperseded.annotationId;
  return [
    firstSuperseded,
    reseal(firstCurrent),
    buildHumanEvalAnnotationFixture(
      suite,
      runs[0]!,
      'reviewer_a',
      '20000000-0000-4000-8000-000000000003',
    ),
    buildHumanEvalAnnotationFixture(
      suite,
      runs[1]!,
      'reviewer.Z',
      '20000000-0000-4000-8000-000000000004',
    ),
    buildHumanEvalAnnotationFixture(
      suite,
      runs[1]!,
      'reviewer_a',
      '20000000-0000-4000-8000-000000000005',
    ),
  ];
}

function buildStructurallyReadyDataset(reverseInput = false): ValidatedHumanEvalDataset {
  const suite = makeReleasedSuite();
  const first = makeStructurallyLiveRun(buildProviderEvalRunFixture(suite));
  const runs = [first, makeSecondTreatment(first)];
  const annotations = annotationsForRuns(suite, runs);
  const blindSignoffs = runs.map((run) => buildProviderBlindSignoffFixture(suite, run));
  return validateHumanEvalDataset({
    suite,
    runs: reverseInput ? [...runs].reverse() : runs,
    annotations: reverseInput ? [...annotations].reverse() : annotations,
    blindSignoffs: reverseInput ? [...blindSignoffs].reverse() : blindSignoffs,
  });
}

function errorIssues(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HumanEvalDatasetError);
    return (error as HumanEvalDatasetError).issues;
  }
  throw new Error('Expected release candidate operation to fail');
}

describe('Human Eval release candidate builder', () => {
  it('builds the same complete manifest repeatedly and independently of input array order', () => {
    const forward = markArtifactVerifiedDataset(buildStructurallyReadyDataset());
    const reversed = markArtifactVerifiedDataset(buildStructurallyReadyDataset(true));

    const first = buildHumanEvalReleaseCandidateManifest(forward);
    const repeated = buildHumanEvalReleaseCandidateManifest(forward);
    const reordered = buildHumanEvalReleaseCandidateManifest(reversed);

    expect(repeated).toEqual(first);
    expect(reordered).toEqual(first);
    expect(first.annotations).toHaveLength(forward.annotations.length);
    expect(first.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          annotationId: '20000000-0000-4000-8000-000000000001',
          status: 'superseded',
          supersededByAnnotationId: '20000000-0000-4000-8000-000000000002',
        }),
      ]),
    );
    expect(first.blindSignoffs).toHaveLength(forward.blindSignoffs.length);
    expect(first.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerKind: 'case', artifactId: 'case.benchmark' }),
        expect.objectContaining({ ownerKind: 'run', artifactId: 'render.preview' }),
      ]),
    );
    expect(first.dataHandling.trainingUse).toBe('not_authorized');
  });

  it('rejects structure-only or forged verification and detects mutation after marking', () => {
    const structureOnly = buildStructurallyReadyDataset();
    expect(errorIssues(() => buildHumanEvalReleaseCandidateManifest(structureOnly))).toContainEqual(
      expect.stringContaining('loadHumanEvalDatasetDirectory'),
    );

    const forged = { ...structureOnly, verificationLevel: 'artifact_verified' as const };
    expect(errorIssues(() => buildHumanEvalReleaseCandidateManifest(forged))).toContainEqual(
      expect.stringContaining('loadHumanEvalDatasetDirectory'),
    );

    const marked = markArtifactVerifiedDataset(buildStructurallyReadyDataset());
    (marked.annotations as HumanEvalAnnotation[]).reverse();
    expect(errorIssues(() => buildHumanEvalReleaseCandidateManifest(marked))).toContainEqual(
      expect.stringContaining('loadHumanEvalDatasetDirectory'),
    );
  });

  it('rejects collecting suites and synthetic records even when marked', () => {
    const liveCollecting = buildStructurallyReadyDataset();
    const collectingSuite = sealHumanEvalSuite({
      ...contentWithoutIntegrity(liveCollecting.suite),
      status: 'collecting',
    });
    const collecting = markArtifactVerifiedDataset({ ...liveCollecting, suite: collectingSuite });
    expect(errorIssues(() => buildHumanEvalReleaseCandidateManifest(collecting))).toContainEqual(
      expect.stringContaining('must have released status'),
    );

    const syntheticSuite = buildHumanEvalSuiteFixture();
    const syntheticRun = buildProviderEvalRunFixture(syntheticSuite);
    const synthetic = markArtifactVerifiedDataset(
      validateHumanEvalDataset({ suite: syntheticSuite, runs: [syntheticRun] }),
    );
    expect(errorIssues(() => buildHumanEvalReleaseCandidateManifest(synthetic))).toContainEqual(
      expect.stringContaining('cannot include synthetic runs'),
    );
  });

  it('rejects a manifest whose sealed content was changed', () => {
    const manifest = buildHumanEvalReleaseCandidateManifest(
      markArtifactVerifiedDataset(buildStructurallyReadyDataset()),
    );
    const tampered = structuredClone(manifest);
    tampered.suite.licenseId = 'Changed-License';

    expect(errorIssues(() => validateHumanEvalReleaseCandidateManifest(tampered))).toContainEqual(
      expect.stringContaining('integrity mismatch'),
    );
  });
});
