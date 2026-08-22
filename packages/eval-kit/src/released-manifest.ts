import {
  authoritySignedContent,
  computeHumanEvalReleasedManifestContentSha256,
  computeProtocolCanonicalJsonSha256,
  humanEvalReleasedManifestSchema,
  protocolJsonValueCanonicalization,
  type AuthorityValidationReceipt,
  type DatasetReleaseAuthorization,
  type HumanEvalReleaseCandidateManifest,
  type HumanEvalReleasedManifest,
} from '@operatingline/protocol';

import { HumanEvalDatasetError } from './dataset.js';
import { validateHumanEvalReleaseCandidateManifest } from './release-candidate.js';

/**
 * Parses a final release envelope and verifies its deterministic hashes.
 *
 * This does not establish that the embedded receipt came from a trusted live verifier. Only the
 * orchestrator's authorization gate can make that trust decision and atomically consume it.
 */
export function validateHumanEvalReleasedManifest(input: unknown): HumanEvalReleasedManifest {
  let manifest: HumanEvalReleasedManifest;
  try {
    manifest = humanEvalReleasedManifestSchema.parse(input);
  } catch (error) {
    throw new HumanEvalDatasetError('Human Eval released manifest parsing failed', [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  validateHumanEvalReleaseCandidateManifest(manifest.releaseCandidate);
  const actual = computeHumanEvalReleasedManifestContentSha256(manifest);
  if (actual !== manifest.integrity.contentSha256) {
    throw new HumanEvalDatasetError('Human Eval released manifest integrity failed', [
      `Released manifest integrity mismatch: expected ${manifest.integrity.contentSha256}, got ${actual}`,
    ]);
  }
  return manifest;
}

/**
 * Builds the deterministic envelope used by the authorized release coordinator.
 *
 * The caller must supply a receipt produced by immediate live authority verification. Building an
 * envelope alone neither consumes the authorization nor completes a dataset release.
 */
export function buildHumanEvalReleasedManifestEnvelope(input: {
  readonly operationId: string;
  readonly releaseCandidate: HumanEvalReleaseCandidateManifest;
  readonly authorization: DatasetReleaseAuthorization;
  readonly validationReceipt: AuthorityValidationReceipt;
}): HumanEvalReleasedManifest {
  const releaseCandidate = validateHumanEvalReleaseCandidateManifest(input.releaseCandidate);
  const content = {
    formatVersion: '1.0.0' as const,
    kind: 'human_eval_released_manifest' as const,
    operationId: input.operationId,
    releaseCandidate,
    authorization: input.authorization,
    authorizationContentSha256: computeProtocolCanonicalJsonSha256(
      authoritySignedContent(input.authorization),
    ),
    validationReceipt: input.validationReceipt,
    validationReceiptSha256: computeProtocolCanonicalJsonSha256(input.validationReceipt),
    release: {
      audience: input.authorization.audience,
      license: input.authorization.license,
      redactionDecisionSha256: input.authorization.redactionDecisionSha256,
      releaseScope: input.authorization.releaseScope,
    },
    dataHandling: {
      trainingUse: 'not_authorized' as const,
    },
  };

  return validateHumanEvalReleasedManifest({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProtocolCanonicalJsonSha256(content),
    },
  });
}
