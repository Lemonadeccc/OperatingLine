import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  humanEvalReleaseCandidateManifestSchema,
  type HumanEvalReleaseCandidateManifest,
} from '@operatingline/protocol';

import {
  validatePublicJsonSchemaCases,
  type PublicJsonSchemaCase,
} from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const hash = (character: string): string => character.repeat(64);
const firstRunId = '10000000-0000-4000-8000-000000000001';
const secondRunId = '10000000-0000-4000-8000-000000000002';

function buildCandidate(): HumanEvalReleaseCandidateManifest {
  return {
    formatVersion: '1.0.0',
    kind: 'human_eval_release_candidate',
    suite: {
      suiteId: 'human-eval.release',
      suiteVersion: '1.0.0',
      contentSha256: hash('a'),
      status: 'released',
      licenseId: 'Apache-2.0',
    },
    policy: {
      numericScoring: 'prohibited',
      providerRanking: 'prohibited',
      minimumIndependentAnnotationsPerRun: 2,
      minimumDistinctTreatmentsPerCase: 2,
      providerIdentityBlinding: 'required',
      disagreementHandling: 'preserve_and_adjudicate',
      missingRuns: 'report_as_missing',
      syntheticRunsInPublishedComparison: 'prohibited',
    },
    dataHandling: {
      contentSha256: hash('b'),
      redaction: 'human_reviewed',
      containsPotentiallySensitiveContent: false,
      permittedUses: ['local_eval', 'research'],
      trainingUse: 'not_authorized',
      publicRelease: 'reviewed',
    },
    cases: [{ caseId: 'case.alpha', contentSha256: hash('c') }],
    runs: [
      {
        runId: firstRunId,
        contentSha256: hash('d'),
        caseId: 'case.alpha',
        sourceKind: 'live_provider_invocation',
        outcome: 'completed',
        conditionSha256: hash('e'),
        treatmentSha256: hash('f'),
        runtimeAttestation: {
          evidenceClass: 'runtime_attested_provider_output',
          treatmentSha256: hash('f'),
          outputSha256: hash('1'),
        },
      },
      {
        runId: secondRunId,
        contentSha256: hash('2'),
        caseId: 'case.alpha',
        sourceKind: 'live_provider_invocation',
        outcome: 'failed',
        conditionSha256: hash('e'),
        treatmentSha256: hash('3'),
        runtimeAttestation: {
          evidenceClass: 'runtime_attested_provider_treatment',
          treatmentSha256: hash('3'),
          outputSha256: null,
        },
      },
    ],
    annotations: [
      {
        annotationId: '20000000-0000-4000-8000-000000000001',
        contentSha256: hash('4'),
        runId: firstRunId,
        reviewerPseudonym: 'reviewer.Z',
        status: 'current',
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000002',
        contentSha256: hash('5'),
        runId: firstRunId,
        reviewerPseudonym: 'reviewer_a',
        status: 'current',
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000003',
        contentSha256: hash('6'),
        runId: secondRunId,
        reviewerPseudonym: 'reviewer.alpha',
        status: 'current',
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000004',
        contentSha256: hash('7'),
        runId: secondRunId,
        reviewerPseudonym: 'reviewer.beta',
        status: 'current',
        supersededByAnnotationId: null,
      },
    ],
    adjudications: [],
    blindSignoffs: [
      {
        runId: firstRunId,
        runContentSha256: hash('d'),
        contentSha256: hash('8'),
        projectionContentSha256: hash('9'),
        renderedArtifacts: [],
      },
      {
        runId: secondRunId,
        runContentSha256: hash('2'),
        contentSha256: hash('0'),
        projectionContentSha256: hash('a'),
        renderedArtifacts: [],
      },
    ],
    artifacts: [],
    inventory: {
      caseCount: 1,
      runCount: 2,
      completedRunCount: 1,
      failedRunCount: 1,
      annotationCount: 4,
      currentAnnotationCount: 4,
      supersededAnnotationCount: 0,
      adjudicationCount: 0,
      blindSignoffCount: 2,
      artifactCount: 0,
      caseArtifactCount: 0,
      runArtifactCount: 0,
    },
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: hash('b'),
    },
  };
}

async function expectPublicSchema(...cases: readonly PublicJsonSchemaCase[]): Promise<void> {
  const schema = JSON.parse(
    readFileSync(
      resolve('protocol/schemas/v1/human-eval-release-candidate-manifest.schema.json'),
      'utf8',
    ),
  ) as object;
  await validatePublicJsonSchemaCases(schema, cases);
}

describe('Human Eval release candidate manifest contract', () => {
  it('accepts a deterministic released candidate without granting training use', async () => {
    const candidate = buildCandidate();

    expect(humanEvalReleaseCandidateManifestSchema.parse(candidate)).toEqual(candidate);
    await expectPublicSchema(
      { value: candidate, accepted: true },
      {
        value: { ...candidate, generatedAt: '2026-08-23T00:00:00.000Z' },
        accepted: false,
      },
      {
        value: {
          ...candidate,
          dataHandling: { ...candidate.dataHandling, trainingUse: 'authorized' },
        },
        accepted: false,
      },
      { value: { ...candidate, datasetReleaseAuthorization: {} }, accepted: false },
      { value: { ...candidate, sourceDirectory: '/private/eval' }, accepted: false },
    );
  });

  it('rejects nondeterministic ordering, incomplete evidence, and mismatched inventory', () => {
    const candidate = buildCandidate();

    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        runs: [...candidate.runs].reverse(),
      }).success,
    ).toBe(false);
    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        runs: candidate.runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                runtimeAttestation: {
                  ...run.runtimeAttestation,
                  evidenceClass: 'runtime_attested_provider_treatment',
                  outputSha256: null,
                },
              }
            : run,
        ),
      }).success,
    ).toBe(false);
    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        inventory: { ...candidate.inventory, runCount: 3 },
      }).success,
    ).toBe(false);
  });

  it('rejects missing blind review and insufficient independent treatments or reviews', () => {
    const candidate = buildCandidate();

    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        blindSignoffs: candidate.blindSignoffs.slice(0, 1),
        inventory: { ...candidate.inventory, blindSignoffCount: 1 },
      }).success,
    ).toBe(false);
    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        runs: candidate.runs.map((run) => ({
          ...run,
          treatmentSha256: hash('f'),
          runtimeAttestation: { ...run.runtimeAttestation, treatmentSha256: hash('f') },
        })),
      }).success,
    ).toBe(false);
    expect(
      humanEvalReleaseCandidateManifestSchema.safeParse({
        ...candidate,
        annotations: candidate.annotations.filter(
          (annotation) =>
            annotation.runId !== firstRunId || annotation.reviewerPseudonym === 'reviewer.alpha',
        ),
        inventory: {
          ...candidate.inventory,
          annotationCount: 3,
          currentAnnotationCount: 3,
        },
      }).success,
    ).toBe(false);
  });
});
