import { describe, expect, it } from 'vitest';

import {
  buildHumanEvalReleasedManifestEnvelope,
  HumanEvalDatasetError,
  validateHumanEvalReleasedManifest,
} from '@operatingline/eval-kit';

import {
  buildDatasetReleaseAuthorizationFixture,
  buildDatasetReleaseValidationReceiptFixture,
  buildHumanEvalReleaseCandidateFixture,
} from '../../support/human-eval-release-fixtures.js';

const operationId = '50000000-0000-4000-8000-000000000001';

describe('Human Eval released manifest envelope', () => {
  it('binds the complete candidate, signed authorization, live receipt, and no training use', () => {
    const releaseCandidate = buildHumanEvalReleaseCandidateFixture();
    const authorization = buildDatasetReleaseAuthorizationFixture(releaseCandidate);
    const validationReceipt = buildDatasetReleaseValidationReceiptFixture(authorization);

    const manifest = buildHumanEvalReleasedManifestEnvelope({
      operationId,
      releaseCandidate,
      authorization,
      validationReceipt,
    });

    expect(validateHumanEvalReleasedManifest(manifest)).toEqual(manifest);
    expect(manifest.releaseCandidate).toEqual(releaseCandidate);
    expect(manifest.authorization).toEqual(authorization);
    expect(manifest.validationReceipt).toEqual(validationReceipt);
    expect(manifest.dataHandling.trainingUse).toBe('not_authorized');
  });

  it('rejects candidate, receipt, and final-manifest mutation', () => {
    const releaseCandidate = buildHumanEvalReleaseCandidateFixture();
    const authorization = buildDatasetReleaseAuthorizationFixture(releaseCandidate);
    const validationReceipt = buildDatasetReleaseValidationReceiptFixture(authorization);
    const manifest = buildHumanEvalReleasedManifestEnvelope({
      operationId,
      releaseCandidate,
      authorization,
      validationReceipt,
    });

    const mutatedCandidate = structuredClone(manifest);
    mutatedCandidate.releaseCandidate.suite.suiteVersion = '1.0.1';
    expect(() => validateHumanEvalReleasedManifest(mutatedCandidate)).toThrow(
      HumanEvalDatasetError,
    );

    const mutatedReceipt = structuredClone(manifest);
    mutatedReceipt.validationReceipt.registryVersion = 'registry-2';
    expect(() => validateHumanEvalReleasedManifest(mutatedReceipt)).toThrow(HumanEvalDatasetError);

    const mutatedRelease = structuredClone(manifest);
    mutatedRelease.release.releaseScope = 'different scope';
    expect(() => validateHumanEvalReleasedManifest(mutatedRelease)).toThrow(HumanEvalDatasetError);
  });

  it('does not treat a structurally matching historical receipt as a trust decision', () => {
    const releaseCandidate = buildHumanEvalReleaseCandidateFixture();
    const authorization = buildDatasetReleaseAuthorizationFixture(releaseCandidate);
    const untrustedReceipt = buildDatasetReleaseValidationReceiptFixture(authorization);

    const envelope = buildHumanEvalReleasedManifestEnvelope({
      operationId,
      releaseCandidate,
      authorization,
      validationReceipt: untrustedReceipt,
    });

    expect(envelope.validationReceipt).toEqual(untrustedReceipt);
    expect(envelope.dataHandling.trainingUse).toBe('not_authorized');
  });
});
