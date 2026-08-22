import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  authoritySignedContent,
  computeHumanEvalReleasedManifestContentSha256,
  computeProtocolCanonicalJsonSha256,
  humanEvalReleasedManifestSchema,
  humanEvalReleaseRequestSchema,
  humanEvalReleaseResponseSchema,
  humanEvalReleaseCandidateManifestSchema,
  type DatasetReleaseAuthorization,
  type HumanEvalReleasedManifest,
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

function buildReleasedManifest(): HumanEvalReleasedManifest {
  const releaseCandidate = buildCandidate();
  const authorization: DatasetReleaseAuthorization = {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'DatasetReleaseAuthorization',
    authorityId: '30000000-0000-4000-8000-000000000001',
    issuer: 'release.operator',
    notBefore: '2026-08-23T00:00:00.000Z',
    expiresAt: '2026-08-24T00:00:00.000Z',
    releaseCandidateManifestSha256: releaseCandidate.integrity.contentSha256,
    audience: 'organization',
    license: releaseCandidate.suite.licenseId,
    redactionDecisionSha256: hash('c'),
    releaseScope: 'Internal research release',
    signature: {
      signerId: 'release.operator',
      keyId: 'release-key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-23T00:00:00.000Z',
    },
  };
  const authorizationContentSha256 = computeProtocolCanonicalJsonSha256(
    authoritySignedContent(authorization),
  );
  const validationReceipt = {
    formatVersion: '1.0.0' as const,
    receiptId: '40000000-0000-4000-8000-000000000001',
    authorityKind: 'DatasetReleaseAuthorization' as const,
    authorityId: authorization.authorityId,
    authorityContentSha256: authorizationContentSha256,
    signerId: authorization.signature.signerId,
    keyId: authorization.signature.keyId,
    registryVersion: 'registry-v1',
    validatedAt: '2026-08-23T00:01:00.000Z',
    revocationLogHeadSha256: hash('d'),
    targetSha256: releaseCandidate.integrity.contentSha256,
    sideEffect: 'dataset_release' as const,
  };
  const manifest = {
    formatVersion: '1.0.0' as const,
    kind: 'human_eval_released_manifest' as const,
    operationId: '50000000-0000-4000-8000-000000000001',
    releaseCandidate,
    authorization,
    authorizationContentSha256,
    validationReceipt,
    validationReceiptSha256: computeProtocolCanonicalJsonSha256(validationReceipt),
    release: {
      audience: authorization.audience,
      license: authorization.license,
      redactionDecisionSha256: authorization.redactionDecisionSha256,
      releaseScope: authorization.releaseScope,
    },
    dataHandling: { trainingUse: 'not_authorized' as const },
    integrity: {
      algorithm: 'sha256' as const,
      canonicalization: 'operatingline-json-value-v1' as const,
      contentSha256: hash('0'),
    },
  } satisfies HumanEvalReleasedManifest;
  manifest.integrity.contentSha256 = computeHumanEvalReleasedManifestContentSha256(manifest);
  return humanEvalReleasedManifestSchema.parse(manifest);
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

describe('authorized Human Eval final release contract', () => {
  it('leaves candidate content-integrity proof to the eval-kit validator', () => {
    const releasedManifest = buildReleasedManifest();
    const structurallyBoundButUnverified = {
      formatVersion: '1.0.0',
      operationId: releasedManifest.operationId,
      releaseCandidate: {
        ...releasedManifest.releaseCandidate,
        suite: { ...releasedManifest.releaseCandidate.suite, suiteId: 'changed.without.resealing' },
      },
      authorization: releasedManifest.authorization,
    };

    // The protocol can bind the declared candidate hash but cannot recompute the legacy
    // operatingline-json-sort-v1 digest. The coordinator must call the eval-kit validator first.
    expect(humanEvalReleaseRequestSchema.safeParse(structurallyBoundButUnverified).success).toBe(
      true,
    );
  });

  it('binds one explicit operation to a complete authorization and live validation receipt', async () => {
    const releasedManifest = buildReleasedManifest();
    const request = {
      formatVersion: '1.0.0',
      operationId: releasedManifest.operationId,
      releaseCandidate: releasedManifest.releaseCandidate,
      authorization: releasedManifest.authorization,
    };
    const response = {
      formatVersion: '1.0.0',
      operationId: releasedManifest.operationId,
      status: 'created',
      releasedManifestSha256: releasedManifest.integrity.contentSha256,
      releasedManifest,
    };

    expect(humanEvalReleaseRequestSchema.parse(request)).toEqual(request);
    expect(humanEvalReleasedManifestSchema.parse(releasedManifest)).toEqual(releasedManifest);
    expect(humanEvalReleaseResponseSchema.parse(response)).toEqual(response);
    expect(
      humanEvalReleaseResponseSchema.safeParse({
        ...response,
        status: 'already_completed',
      }).success,
    ).toBe(true);
    expect(
      humanEvalReleaseResponseSchema.safeParse({
        ...response,
        releasedManifestSha256: hash('e'),
      }).success,
    ).toBe(false);

    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/human-eval-released-manifest.schema.json'), 'utf8'),
    ) as object;
    await validatePublicJsonSchemaCases(schema, [
      { value: releasedManifest, accepted: true },
      {
        value: {
          ...releasedManifest,
          dataHandling: { trainingUse: 'authorized' },
        },
        accepted: false,
      },
      { value: { ...releasedManifest, trainingUseAuthorization: {} }, accepted: false },
    ]);
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(resolve('protocol/schemas/v1/human-eval-release-request.schema.json'), 'utf8'),
      ) as object,
      [
        { value: request, accepted: true },
        {
          value: { ...request, validationReceipt: releasedManifest.validationReceipt },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(
          resolve('protocol/schemas/v1/human-eval-release-response.schema.json'),
          'utf8',
        ),
      ) as object,
      [
        { value: response, accepted: true },
        { value: { ...response, status: 'already_completed' }, accepted: true },
        { value: { ...response, status: 'released' }, accepted: false },
      ],
    );
  });

  it.each([
    [
      'candidate target',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        authorization: {
          ...manifest.authorization,
          releaseCandidateManifestSha256: hash('e'),
        },
      }),
    ],
    [
      'authorization content hash',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        authorizationContentSha256: hash('e'),
      }),
    ],
    [
      'receipt signer',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: { ...manifest.validationReceipt, signerId: 'other.signer' },
      }),
    ],
    [
      'receipt key',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: { ...manifest.validationReceipt, keyId: 'other-key' },
      }),
    ],
    [
      'receipt target',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: { ...manifest.validationReceipt, targetSha256: hash('e') },
      }),
    ],
    [
      'receipt side effect',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: { ...manifest.validationReceipt, sideEffect: 'training_export' },
      }),
    ],
    [
      'receipt validity window',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: {
          ...manifest.validationReceipt,
          validatedAt: '2026-08-25T00:00:00.000Z',
        },
      }),
    ],
    [
      'receipt at the exclusive expiry boundary',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceipt: {
          ...manifest.validationReceipt,
          validatedAt: manifest.authorization.expiresAt,
        },
      }),
    ],
    [
      'receipt hash',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        validationReceiptSha256: hash('e'),
      }),
    ],
    [
      'release projection',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        release: { ...manifest.release, releaseScope: 'A different release' },
      }),
    ],
    [
      'training use',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        dataHandling: { trainingUse: 'authorized' },
      }),
    ],
    [
      'manifest integrity',
      (manifest: HumanEvalReleasedManifest) => ({
        ...manifest,
        integrity: { ...manifest.integrity, contentSha256: hash('e') },
      }),
    ],
  ])('rejects a mismatched %s', (_label, mutate) => {
    expect(humanEvalReleasedManifestSchema.safeParse(mutate(buildReleasedManifest())).success).toBe(
      false,
    );
  });
});
