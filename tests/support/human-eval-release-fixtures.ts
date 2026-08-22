import {
  authoritySignedContent,
  computeProtocolCanonicalJsonSha256,
  type AuthorityValidationReceipt,
  type DatasetReleaseAuthorization,
  type HumanEvalReleaseCandidateManifest,
} from '@operatingline/protocol';
import { computeHumanEvalContentSha256 } from '../../packages/eval-kit/src/integrity.js';

const hash = (character: string): string => character.repeat(64);
const firstRunId = '10000000-0000-4000-8000-000000000001';
const secondRunId = '10000000-0000-4000-8000-000000000002';

export function buildHumanEvalReleaseCandidateFixture(): HumanEvalReleaseCandidateManifest {
  const content = {
    formatVersion: '1.0.0' as const,
    kind: 'human_eval_release_candidate' as const,
    suite: {
      suiteId: 'human-eval.release',
      suiteVersion: '1.0.0',
      contentSha256: hash('a'),
      status: 'released' as const,
      licenseId: 'Apache-2.0',
    },
    policy: {
      numericScoring: 'prohibited' as const,
      providerRanking: 'prohibited' as const,
      minimumIndependentAnnotationsPerRun: 2,
      minimumDistinctTreatmentsPerCase: 2,
      providerIdentityBlinding: 'required' as const,
      disagreementHandling: 'preserve_and_adjudicate' as const,
      missingRuns: 'report_as_missing' as const,
      syntheticRunsInPublishedComparison: 'prohibited' as const,
    },
    dataHandling: {
      contentSha256: hash('b'),
      redaction: 'human_reviewed' as const,
      containsPotentiallySensitiveContent: false,
      permittedUses: ['local_eval', 'research'] as const,
      trainingUse: 'not_authorized' as const,
      publicRelease: 'reviewed' as const,
    },
    cases: [{ caseId: 'case.alpha', contentSha256: hash('c') }],
    runs: [
      {
        runId: firstRunId,
        contentSha256: hash('d'),
        caseId: 'case.alpha',
        sourceKind: 'live_provider_invocation' as const,
        outcome: 'completed' as const,
        conditionSha256: hash('e'),
        treatmentSha256: hash('f'),
        runtimeAttestation: {
          evidenceClass: 'runtime_attested_provider_output' as const,
          treatmentSha256: hash('f'),
          outputSha256: hash('1'),
        },
      },
      {
        runId: secondRunId,
        contentSha256: hash('2'),
        caseId: 'case.alpha',
        sourceKind: 'live_provider_invocation' as const,
        outcome: 'failed' as const,
        conditionSha256: hash('e'),
        treatmentSha256: hash('3'),
        runtimeAttestation: {
          evidenceClass: 'runtime_attested_provider_treatment' as const,
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
        status: 'current' as const,
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000002',
        contentSha256: hash('5'),
        runId: firstRunId,
        reviewerPseudonym: 'reviewer_a',
        status: 'current' as const,
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000003',
        contentSha256: hash('6'),
        runId: secondRunId,
        reviewerPseudonym: 'reviewer.alpha',
        status: 'current' as const,
        supersededByAnnotationId: null,
      },
      {
        annotationId: '20000000-0000-4000-8000-000000000004',
        contentSha256: hash('7'),
        runId: secondRunId,
        reviewerPseudonym: 'reviewer.beta',
        status: 'current' as const,
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
  };
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

export function buildDatasetReleaseAuthorizationFixture(
  candidate = buildHumanEvalReleaseCandidateFixture(),
  overrides: Partial<DatasetReleaseAuthorization> = {},
): DatasetReleaseAuthorization {
  return {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'DatasetReleaseAuthorization',
    authorityId: '30000000-0000-4000-8000-000000000001',
    issuer: 'release.operator',
    notBefore: '2026-08-22T10:00:00.000Z',
    expiresAt: '2026-08-22T12:00:00.000Z',
    releaseCandidateManifestSha256: candidate.integrity.contentSha256,
    audience: 'organization',
    license: candidate.suite.licenseId,
    redactionDecisionSha256: hash('e'),
    releaseScope: 'approved evaluation evidence only',
    signature: {
      signerId: 'release.operator',
      keyId: 'release-key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-22T10:00:00.000Z',
    },
    ...overrides,
  };
}

export function buildDatasetReleaseValidationReceiptFixture(
  authorization: DatasetReleaseAuthorization,
  overrides: Partial<AuthorityValidationReceipt> = {},
): AuthorityValidationReceipt {
  return {
    formatVersion: '1.0.0',
    receiptId: '40000000-0000-4000-8000-000000000001',
    authorityKind: 'DatasetReleaseAuthorization',
    authorityId: authorization.authorityId,
    authorityContentSha256: computeProtocolCanonicalJsonSha256(
      authoritySignedContent(authorization),
    ),
    signerId: authorization.signature.signerId,
    keyId: authorization.signature.keyId,
    registryVersion: 'registry-1',
    validatedAt: '2026-08-22T11:00:00.000Z',
    revocationLogHeadSha256: hash('f'),
    targetSha256: authorization.releaseCandidateManifestSha256,
    sideEffect: 'dataset_release',
    ...overrides,
  };
}
