import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  authorityCanonicalization,
  canonicalizeAuthorityJson,
  authorityRecordKindValues,
  externalAuthorityRecordSchema,
} from '@operatingline/protocol';

const hash = 'a'.repeat(64);
const common = (kind: string) => ({
  formatVersion: '1.0.0',
  canonicalization: authorityCanonicalization,
  authorityId: randomUUID(),
  issuer: 'operator-1',
  kind,
  notBefore: '2026-08-21T00:00:00.000Z',
  expiresAt: '2026-08-22T00:00:00.000Z',
  signature: {
    signerId: 'operator-1',
    keyId: 'key-1',
    algorithm: 'ed25519',
    signature: 'A'.repeat(86),
    signedAt: '2026-08-21T00:00:00.000Z',
  },
});

const records = [
  {
    ...common('ProviderCallAuthorization'),
    provider: { providerId: 'provider', descriptorVersion: '1.0.0', model: 'model' },
    operation: 'planning_generation',
    generationRequestSha256: hash,
    disclosedDataSha256: hash,
    maximumCallCount: 1,
  },
  {
    ...common('LocalMediaImportAuthorization'),
    source: { canonicalPathSha256: hash, contentSha256: hash, byteLength: 1 },
    allowedProcessingStages: ['probe'],
    retention: 'delete_after_processing',
  },
  {
    ...common('MediaRightsEvidence'),
    mediaSha256: hash,
    sourceIdentitySha256: hash,
    rightsBasis: 'public_domain_verified',
    rightsHolder: null,
    evidenceReference: 'reference',
    allowedPurposes: ['private_analysis'],
  },
  {
    ...common('YouTubePlatformDownloadAuthorization'),
    videoId: 'abcdefghijk',
    mediaSourceIdentitySha256: hash,
    writtenPlatformApprovalReference: 'reference',
    allowedOperation: 'download_media',
  },
  {
    ...common('DatasetReleaseAuthorization'),
    releaseCandidateManifestSha256: hash,
    audience: 'organization',
    license: 'Apache-2.0',
    redactionDecisionSha256: hash,
    releaseScope: 'one release',
  },
  {
    ...common('TrainingUseAuthorization'),
    releasedManifestSha256: hash,
    purpose: 'fine tuning',
    modelFamily: 'family',
    scope: 'export_and_run',
  },
] as const;

describe('external authority protocol', () => {
  it('matches the authority-v1 cross-implementation canonicalization golden vector', () => {
    const canonical = canonicalizeAuthorityJson({
      unicode: '😀',
      kind: 'ProviderCallAuthorization',
      amount: 100,
    });
    expect(Buffer.from(canonical).toString('utf8')).toBe(
      'o3:9:s6:amount17:d40590000000000007:s4:kind29:s25:ProviderCallAuthorization10:s7:unicode7:s4:😀',
    );
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(
      '54ad26d780fcee79eb5684c297e703b5ce2de1a311fb8c60979f2badd6e34ee9',
    );
  });

  it('defines exactly six independently discriminated signed record kinds', () => {
    expect(authorityRecordKindValues).toEqual(records.map((record) => record.kind));
    expect(records.map((record) => externalAuthorityRecordSchema.parse(record).kind)).toEqual(
      authorityRecordKindValues,
    );
  });

  it('rejects algorithm aliases, unknown fields, invalid time order, and cross-kind substitution', () => {
    expect(
      externalAuthorityRecordSchema.safeParse({
        ...records[0],
        signature: { ...records[0].signature, algorithm: 'EdDSA' },
      }).success,
    ).toBe(false);
    expect(
      externalAuthorityRecordSchema.safeParse({ ...records[0], publicKey: 'request-key' }).success,
    ).toBe(false);
    expect(
      externalAuthorityRecordSchema.safeParse({
        ...records[0],
        expiresAt: records[0].notBefore,
      }).success,
    ).toBe(false);
    for (const [index, record] of records.entries()) {
      for (const otherKind of authorityRecordKindValues) {
        if (otherKind !== record.kind) {
          expect(
            externalAuthorityRecordSchema.safeParse({ ...record, kind: otherKind }).success,
            `${index} substituted as ${otherKind}`,
          ).toBe(false);
        }
      }
    }
  });
});
