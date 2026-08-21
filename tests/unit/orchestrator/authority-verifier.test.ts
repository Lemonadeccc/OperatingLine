import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  authorityRevocationSignedContent,
  authoritySignatureDomainPrefix,
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
  type AuthorityRevocation,
  type ExternalAuthorityRecord,
  type LocalMediaImportAuthorization,
  type MediaRightsEvidence,
  type ProviderCallAuthorization,
} from '@operatingline/protocol';
import {
  AuthorityVerifier,
  AuthorityVerificationError,
  createStaticAuthorityVerifier,
  type TrustedAuthoritySignerRegistry,
  type VerifyAuthorityRequest,
} from '../../../services/orchestrator/src/authority-verifier.js';

const hash = (character = 'a') => character.repeat(64);
const now = new Date('2026-08-21T12:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();

function message(kind: string, content: unknown): Buffer {
  return Buffer.concat([
    Buffer.from(authoritySignatureDomainPrefix(kind as never)),
    Buffer.from(canonicalizeProtocolJsonValue(content)),
  ]);
}

function authorization(
  overrides: Partial<ProviderCallAuthorization> = {},
): ProviderCallAuthorization {
  const unsigned = {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'ProviderCallAuthorization',
    authorityId: randomUUID(),
    issuer: 'operator',
    notBefore: '2026-08-21T11:00:00.000Z',
    expiresAt: '2026-08-21T13:00:00.000Z',
    provider: { providerId: 'provider', descriptorVersion: '1.0.0', model: 'model' },
    operation: 'planning_generation',
    generationRequestSha256: hash(),
    disclosedDataSha256: hash('b'),
    maximumCallCount: 1,
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T11:00:00.000Z',
    },
    ...overrides,
  } as ProviderCallAuthorization;
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        message(unsigned.kind, authoritySignedContent(unsigned)),
        keys.privateKey,
      ).toString('base64url'),
    },
  };
}

function providerGateBinding(record: ProviderCallAuthorization) {
  return {
    provider: record.provider,
    operation: record.operation,
    generationRequestSha256: record.generationRequestSha256,
    disclosedDataSha256: record.disclosedDataSha256,
    ...(record.costCeiling
      ? {
          estimatedCost: {
            currency: record.costCeiling.currency,
            minorUnits: record.costCeiling.minorUnits,
          },
        }
      : {}),
  };
}

function providerVerification(
  record: ProviderCallAuthorization,
  targetSha256 = record.generationRequestSha256,
) {
  return {
    record,
    sideEffect: 'provider_call' as const,
    targetSha256,
    binding: providerGateBinding(record),
  };
}

function signAuthorityRecord<T extends ExternalAuthorityRecord>(record: T): T {
  return {
    ...record,
    signature: {
      ...record.signature,
      signature: sign(
        null,
        message(record.kind, authoritySignedContent(record)),
        keys.privateKey,
      ).toString('base64url'),
    },
  } as T;
}

function allAuthorityRecords(): readonly ExternalAuthorityRecord[] {
  const common = {
    formatVersion: '1.0.0' as const,
    canonicalization: 'operatingline-authority-json-v1' as const,
    issuer: 'operator',
    notBefore: '2026-08-21T11:00:00.000Z',
    expiresAt: '2026-08-21T13:00:00.000Z',
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519' as const,
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T11:00:00.000Z',
    },
  };
  return [
    authorization(),
    signAuthorityRecord({
      ...common,
      kind: 'LocalMediaImportAuthorization',
      authorityId: randomUUID(),
      source: { canonicalPathSha256: hash('c'), contentSha256: hash(), byteLength: 10 },
      allowedProcessingStages: ['probe'],
      retention: 'delete_after_processing',
    }),
    signAuthorityRecord({
      ...common,
      kind: 'MediaRightsEvidence',
      authorityId: randomUUID(),
      mediaSha256: hash(),
      sourceIdentitySha256: hash('c'),
      rightsBasis: 'public_domain_verified',
      rightsHolder: null,
      evidenceReference: 'public-domain-record',
      allowedPurposes: ['private_analysis'],
    }),
    signAuthorityRecord({
      ...common,
      kind: 'YouTubePlatformDownloadAuthorization',
      authorityId: randomUUID(),
      videoId: 'abcdefghijk',
      mediaSourceIdentitySha256: hash('c'),
      writtenPlatformApprovalReference: 'approval-record',
      allowedOperation: 'download_media',
    }),
    signAuthorityRecord({
      ...common,
      kind: 'DatasetReleaseAuthorization',
      authorityId: randomUUID(),
      releaseCandidateManifestSha256: hash(),
      audience: 'organization',
      license: 'Apache-2.0',
      redactionDecisionSha256: hash('d'),
      releaseScope: 'internal-release',
    }),
    signAuthorityRecord({
      ...common,
      kind: 'TrainingUseAuthorization',
      authorityId: randomUUID(),
      releasedManifestSha256: hash(),
      purpose: 'fine-tuning',
      modelFamily: 'family',
      scope: 'export_and_run',
    }),
  ];
}

function verificationFor(record: ExternalAuthorityRecord) {
  switch (record.kind) {
    case 'ProviderCallAuthorization':
      return providerVerification(record);
    case 'LocalMediaImportAuthorization':
      return {
        record,
        sideEffect: 'local_media_import' as const,
        targetSha256: record.source.contentSha256,
        binding: {
          canonicalPathSha256: record.source.canonicalPathSha256,
          contentSha256: record.source.contentSha256,
          byteLength: record.source.byteLength,
          processingStages: record.allowedProcessingStages,
          retention: record.retention,
        },
      };
    case 'MediaRightsEvidence':
      return {
        record,
        sideEffect: 'media_rights_validation' as const,
        targetSha256: record.mediaSha256,
        binding: {
          mediaSha256: record.mediaSha256,
          sourceIdentitySha256: record.sourceIdentitySha256,
          rightsBasis: record.rightsBasis,
          rightsHolder: record.rightsHolder,
          evidenceReference: record.evidenceReference,
          purpose: record.allowedPurposes[0]!,
        },
      };
    case 'YouTubePlatformDownloadAuthorization':
      return {
        record,
        sideEffect: 'youtube_platform_download' as const,
        targetSha256: record.mediaSourceIdentitySha256,
        binding: {
          videoId: record.videoId,
          mediaSourceIdentitySha256: record.mediaSourceIdentitySha256,
          writtenPlatformApprovalReference: record.writtenPlatformApprovalReference,
          operation: record.allowedOperation,
        },
      };
    case 'DatasetReleaseAuthorization':
      return {
        record,
        sideEffect: 'dataset_release' as const,
        targetSha256: record.releaseCandidateManifestSha256,
        binding: {
          releaseCandidateManifestSha256: record.releaseCandidateManifestSha256,
          audience: record.audience,
          license: record.license,
          redactionDecisionSha256: record.redactionDecisionSha256,
          releaseScope: record.releaseScope,
        },
      };
    case 'TrainingUseAuthorization':
      return {
        record,
        sideEffect: 'training_export' as const,
        targetSha256: record.releasedManifestSha256,
        binding: {
          releasedManifestSha256: record.releasedManifestSha256,
          purpose: record.purpose,
          modelFamily: record.modelFamily,
          scope: record.scope,
        },
      };
  }
}

const registry = (
  roles = ['provider_call_authorizer', 'revocation_authorizer'],
  revocations: readonly AuthorityRevocation[] = [],
): TrustedAuthoritySignerRegistry => ({
  version: 'registry-v1',
  revocationLog: {
    length: revocations.length,
    headSha256: createHash('sha256')
      .update(canonicalizeProtocolJsonValue(revocations.length === 0 ? [] : revocations.at(-1)!))
      .digest('hex'),
  },
  signers: [
    {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      canonicalization: 'operatingline-authority-json-v1',
      publicKeyPem,
      roles: roles as never,
    },
  ],
});

function revocation(
  record: ProviderCallAuthorization,
  sequence = 0,
  previousRevocationSha256: string | null = null,
): AuthorityRevocation {
  const contentSha256 = createHash('sha256')
    .update(canonicalizeProtocolJsonValue(authoritySignedContent(record)))
    .digest('hex');
  const unsigned = {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'AuthorityRevocation',
    revocationId: randomUUID(),
    sequence,
    previousRevocationSha256,
    authorityId: record.authorityId,
    authorityContentSha256: contentSha256,
    effectiveAt: '2026-08-21T11:30:00.000Z',
    reason: 'operator revoked',
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T11:29:00.000Z',
    },
  } as AuthorityRevocation;
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        message(unsigned.kind, authorityRevocationSignedContent(unsigned)),
        keys.privateKey,
      ).toString('base64url'),
    },
  };
}

function resignRevocation(
  record: AuthorityRevocation,
  signedAt: string,
  effectiveAt = record.effectiveAt,
): AuthorityRevocation {
  const unsigned = {
    ...record,
    effectiveAt,
    signature: { ...record.signature, signedAt, signature: 'A'.repeat(86) },
  };
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        message(unsigned.kind, authorityRevocationSignedContent(unsigned)),
        keys.privateKey,
      ).toString('base64url'),
    },
  };
}

describe('authority verifier', () => {
  it('verifies Ed25519 canonical content and persists exact receipt bindings', () => {
    const record = authorization();
    const receipt = createStaticAuthorityVerifier(registry(), [], { now: () => now }).verify(
      providerVerification(record),
    );
    expect(receipt).toMatchObject({
      authorityId: record.authorityId,
      authorityKind: record.kind,
      signerId: 'operator',
      keyId: 'key-1',
      registryVersion: 'registry-v1',
      validatedAt: now.toISOString(),
      targetSha256: hash(),
      sideEffect: 'provider_call',
    });
  });

  it('reads a fresh atomic trust snapshot for every new side effect', () => {
    const record = authorization();
    let snapshot = { registry: registry(), revocations: [] as readonly AuthorityRevocation[] };
    const verifier = new AuthorityVerifier({ readSnapshot: () => snapshot }, { now: () => now });
    expect(verifier.verify(providerVerification(record)).authorityId).toBe(record.authorityId);

    const revoked = revocation(record);
    snapshot = { registry: registry(undefined, [revoked]), revocations: [revoked] };
    expect(() => verifier.verify(providerVerification(record))).toThrow(/revoked/);
  });

  it('rejects the true 6x5 cross-gate substitution matrix', () => {
    const records = allAuthorityRecords();
    const verifier = createStaticAuthorityVerifier(
      registry([
        'provider_call_authorizer',
        'local_media_import_authorizer',
        'media_rights_attestor',
        'youtube_platform_authorizer',
        'dataset_release_authorizer',
        'training_use_authorizer',
        'revocation_authorizer',
      ]),
      [],
      { now: () => now },
    );
    for (const record of records)
      expect(() => verifier.verify(verificationFor(record))).not.toThrow();
    let rejected = 0;
    for (const candidate of records) {
      for (const gate of records) {
        if (candidate.kind === gate.kind) continue;
        const request = { ...verificationFor(gate), record: candidate } as VerifyAuthorityRequest;
        expect(() => verifier.verify(request)).toThrow(/wrong_authority_kind/);
        rejected += 1;
      }
    }
    expect(rejected).toBe(30);
  });

  it('rejects scope-field drift at each of the six correct gates', () => {
    const records = allAuthorityRecords();
    const verifier = createStaticAuthorityVerifier(
      registry([
        'provider_call_authorizer',
        'local_media_import_authorizer',
        'media_rights_attestor',
        'youtube_platform_authorizer',
        'dataset_release_authorizer',
        'training_use_authorizer',
        'revocation_authorizer',
      ]),
      [],
      { now: () => now },
    );
    const requests = records.map(verificationFor);
    const drifted: VerifyAuthorityRequest[] = [
      {
        ...requests[0]!,
        binding: {
          ...(requests[0] as ReturnType<typeof providerVerification>).binding,
          provider: {
            ...(requests[0] as ReturnType<typeof providerVerification>).binding.provider,
            model: 'wrong-model',
          },
        },
      },
      {
        ...(requests[1] as Extract<VerifyAuthorityRequest, { sideEffect: 'local_media_import' }>),
        binding: {
          ...(requests[1] as Extract<VerifyAuthorityRequest, { sideEffect: 'local_media_import' }>)
            .binding,
          retention: 'private_cas_indefinite',
        },
      },
      {
        ...(requests[2] as Extract<
          VerifyAuthorityRequest,
          { sideEffect: 'media_rights_validation' }
        >),
        binding: {
          ...(
            requests[2] as Extract<
              VerifyAuthorityRequest,
              { sideEffect: 'media_rights_validation' }
            >
          ).binding,
          purpose: 'training_export',
        },
      },
      {
        ...(requests[3] as Extract<
          VerifyAuthorityRequest,
          { sideEffect: 'youtube_platform_download' }
        >),
        binding: {
          ...(
            requests[3] as Extract<
              VerifyAuthorityRequest,
              { sideEffect: 'youtube_platform_download' }
            >
          ).binding,
          videoId: 'zyxwvutsrqp',
        },
      },
      {
        ...(requests[4] as Extract<VerifyAuthorityRequest, { sideEffect: 'dataset_release' }>),
        binding: {
          ...(requests[4] as Extract<VerifyAuthorityRequest, { sideEffect: 'dataset_release' }>)
            .binding,
          license: 'wrong-license',
        },
      },
      {
        ...(requests[5] as Extract<VerifyAuthorityRequest, { sideEffect: 'training_export' }>),
        binding: {
          ...(requests[5] as Extract<VerifyAuthorityRequest, { sideEffect: 'training_export' }>)
            .binding,
          modelFamily: 'wrong-family',
        },
      },
    ];
    for (const request of drifted) {
      expect(() => verifier.verify(request)).toThrow(/wrong_side_effect_binding/);
    }
  });

  it('rejects unmodeled side effects at each of the six authority gates', () => {
    const verifier = createStaticAuthorityVerifier(
      registry([
        'provider_call_authorizer',
        'local_media_import_authorizer',
        'media_rights_attestor',
        'youtube_platform_authorizer',
        'dataset_release_authorizer',
        'training_use_authorizer',
        'revocation_authorizer',
      ]),
      [],
      { now: () => now },
    );
    for (const record of allAuthorityRecords()) {
      const request = verificationFor(record);
      const requestWithUnknownBindingField = {
        ...request,
        binding: {
          ...request.binding,
          unreviewedSideEffect: { python: 'evil' },
        },
      } as unknown as VerifyAuthorityRequest;
      try {
        verifier.verify(requestWithUnknownBindingField);
        throw new Error('Expected an exact-binding rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorityVerificationError);
        expect((error as AuthorityVerificationError).code).toBe('wrong_side_effect_binding');
      }
    }
  });

  it('uses one atomic trust snapshot for a paired local-import verification', () => {
    const common = {
      formatVersion: '1.0.0' as const,
      canonicalization: 'operatingline-authority-json-v1' as const,
      issuer: 'operator',
      notBefore: '2026-08-21T11:00:00.000Z',
      expiresAt: '2026-08-21T13:00:00.000Z',
      signature: {
        signerId: 'operator',
        keyId: 'key-1',
        algorithm: 'ed25519' as const,
        signature: 'A'.repeat(86),
        signedAt: '2026-08-21T11:00:00.000Z',
      },
    };
    const contentSha256 = hash();
    const sourceIdentitySha256 = hash('b');
    const importAuthorization = signAuthorityRecord({
      ...common,
      kind: 'LocalMediaImportAuthorization',
      authorityId: randomUUID(),
      source: { canonicalPathSha256: sourceIdentitySha256, contentSha256, byteLength: 1 },
      allowedProcessingStages: ['probe'],
      retention: 'delete_after_processing',
    } satisfies LocalMediaImportAuthorization);
    const rightsEvidence = signAuthorityRecord({
      ...common,
      kind: 'MediaRightsEvidence',
      authorityId: randomUUID(),
      mediaSha256: contentSha256,
      sourceIdentitySha256,
      rightsBasis: 'public_domain_verified',
      rightsHolder: null,
      evidenceReference: 'public-domain-record',
      allowedPurposes: ['private_analysis'],
    } satisfies MediaRightsEvidence);
    let reads = 0;
    const snapshot = {
      registry: registry([
        'local_media_import_authorizer',
        'media_rights_attestor',
        'revocation_authorizer',
      ]),
      revocations: [],
    };
    const verifier = new AuthorityVerifier(
      {
        readSnapshot: () => {
          reads += 1;
          return snapshot;
        },
      },
      { now: () => now },
    );
    const importBinding = {
      canonicalPathSha256: sourceIdentitySha256,
      contentSha256,
      byteLength: 1,
      processingStages: ['probe'] as const,
      retention: 'delete_after_processing' as const,
    };
    const rightsBinding = {
      mediaSha256: contentSha256,
      sourceIdentitySha256,
      rightsBasis: 'public_domain_verified' as const,
      rightsHolder: null,
      evidenceReference: 'public-domain-record',
      purpose: 'private_analysis' as const,
    };
    expect(
      verifier.verifyLocalMediaImport({
        importAuthorization,
        rightsEvidence,
        contentSha256,
        sourceIdentitySha256,
        importBinding,
        rightsBinding,
      }),
    ).toHaveLength(2);
    expect(reads).toBe(1);
    for (const invalidBindings of [
      {
        importBinding: {
          ...importBinding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
        rightsBinding,
      },
      {
        importBinding,
        rightsBinding: {
          ...rightsBinding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
      },
    ]) {
      try {
        verifier.verifyLocalMediaImport({
          importAuthorization,
          rightsEvidence,
          contentSha256,
          sourceIdentitySha256,
          ...invalidBindings,
        });
        throw new Error('Expected an exact-binding rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorityVerificationError);
        expect((error as AuthorityVerificationError).code).toBe('wrong_side_effect_binding');
      }
    }
    expect(reads).toBe(1);
  });

  it('strictly parses both bindings before paired YouTube verification', () => {
    const records = allAuthorityRecords();
    const rightsEvidence = records.find(
      (record): record is Extract<ExternalAuthorityRecord, { kind: 'MediaRightsEvidence' }> =>
        record.kind === 'MediaRightsEvidence',
    )!;
    const downloadAuthorization = records.find(
      (
        record,
      ): record is Extract<
        ExternalAuthorityRecord,
        { kind: 'YouTubePlatformDownloadAuthorization' }
      > => record.kind === 'YouTubePlatformDownloadAuthorization',
    )!;
    const downloadRequest = verificationFor(downloadAuthorization);
    const rightsRequest = verificationFor(rightsEvidence);
    let reads = 0;
    const verifier = new AuthorityVerifier(
      {
        readSnapshot: () => {
          reads += 1;
          return {
            registry: registry([
              'youtube_platform_authorizer',
              'media_rights_attestor',
              'revocation_authorizer',
            ]),
            revocations: [],
          };
        },
      },
      { now: () => now },
    );
    expect(
      verifier.verifyYouTubeDownload({
        downloadAuthorization,
        rightsEvidence,
        downloadBinding: downloadRequest.binding,
        rightsBinding: rightsRequest.binding,
      }),
    ).toHaveLength(2);
    expect(reads).toBe(1);
    for (const invalidBindings of [
      {
        downloadBinding: {
          ...downloadRequest.binding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
        rightsBinding: rightsRequest.binding,
      },
      {
        downloadBinding: downloadRequest.binding,
        rightsBinding: {
          ...rightsRequest.binding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
      },
    ]) {
      try {
        verifier.verifyYouTubeDownload({
          downloadAuthorization,
          rightsEvidence,
          ...invalidBindings,
        });
        throw new Error('Expected an exact-binding rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorityVerificationError);
        expect((error as AuthorityVerificationError).code).toBe('wrong_side_effect_binding');
      }
    }
    expect(reads).toBe(1);
  });

  it.each([
    [
      'payload',
      (record: ProviderCallAuthorization) => ({ ...record, disclosedDataSha256: hash('c') }),
    ],
    [
      'signedAt',
      (record: ProviderCallAuthorization) => ({
        ...record,
        signature: { ...record.signature, signedAt: '2026-08-21T10:59:00.000Z' },
      }),
    ],
    [
      'signerId',
      (record: ProviderCallAuthorization) => ({
        ...record,
        signature: { ...record.signature, signerId: 'attacker' },
      }),
    ],
    [
      'keyId',
      (record: ProviderCallAuthorization) => ({
        ...record,
        signature: { ...record.signature, keyId: 'other-key' },
      }),
    ],
  ])('rejects %s tampering', (_name, tamper) => {
    const verifier = createStaticAuthorityVerifier(registry(), [], { now: () => now });
    const altered = tamper(authorization()) as ProviderCallAuthorization;
    expect(() => verifier.verify(providerVerification(altered))).toThrow(
      AuthorityVerificationError,
    );
  });

  it('rejects wrong role, wrong target, expiry, and effective signed revocation', () => {
    const record = authorization();
    expect(() =>
      createStaticAuthorityVerifier(registry(['revocation_authorizer']), [], {
        now: () => now,
      }).verify(providerVerification(record)),
    ).toThrow(/wrong_signer_role/);
    expect(() =>
      createStaticAuthorityVerifier(registry(), [], { now: () => now }).verify(
        providerVerification(record, hash('f')),
      ),
    ).toThrow(/wrong_target/);
    expect(() =>
      createStaticAuthorityVerifier(registry(), [], {
        now: () => new Date('2026-08-22T00:00:00.000Z'),
        maximumClockSkewMs: 0,
      }).verify(providerVerification(record)),
    ).toThrow(/expired/);
    expect(() =>
      (() => {
        const revoked = revocation(record);
        return createStaticAuthorityVerifier(registry(undefined, [revoked]), [revoked], {
          now: () => now,
        }).verify(providerVerification(record));
      })(),
    ).toThrow(/revoked/);
  });

  it('rejects algorithm/version/canonicalization/domain and bounded-clock downgrades', () => {
    const verifier = createStaticAuthorityVerifier(registry(), [], { now: () => now });
    const record = authorization();
    for (const invalid of [
      { ...record, formatVersion: '0.9.0' },
      { ...record, canonicalization: 'operatingline-json-value-v1' },
      { ...record, signature: { ...record.signature, algorithm: 'EdDSA' } },
    ]) {
      expect(() =>
        verifier.verify(providerVerification(invalid as ProviderCallAuthorization)),
      ).toThrow(AuthorityVerificationError);
    }
    const wrongDomain = {
      ...record,
      signature: {
        ...record.signature,
        signature: sign(
          null,
          Buffer.concat([
            Buffer.from('Wrong Domain\0ProviderCallAuthorization\0'),
            Buffer.from(canonicalizeProtocolJsonValue(authoritySignedContent(record))),
          ]),
          keys.privateKey,
        ).toString('base64url'),
      },
    };
    expect(() => verifier.verify(providerVerification(wrongDomain))).toThrow(/invalid_signature/);
    const futureSignature = authorization({
      signature: { ...record.signature, signedAt: '2026-08-21T12:06:00.000Z' },
    });
    expect(() => verifier.verify(providerVerification(futureSignature))).toThrow(/clock skew/);
  });

  it('rejects tampered signed revocation metadata', () => {
    const record = authorization();
    const signedRevocation = revocation(record);
    for (const altered of [
      {
        ...signedRevocation,
        signature: { ...signedRevocation.signature, signedAt: '2026-08-21T11:28:00.000Z' },
      },
      {
        ...signedRevocation,
        signature: { ...signedRevocation.signature, signerId: 'attacker' },
      },
      {
        ...signedRevocation,
        signature: { ...signedRevocation.signature, keyId: 'other-key' },
      },
    ]) {
      expect(() =>
        createStaticAuthorityVerifier(
          registry(undefined, [altered as AuthorityRevocation]),
          [altered],
          {
            now: () => now,
          },
        ).verify(providerVerification(record)),
      ).toThrow(AuthorityVerificationError);
    }
  });

  it('rejects revocation reorder, trusted-head truncation, duplicate, and broken links', () => {
    const first = revocation(authorization());
    const second = revocation(
      authorization(),
      1,
      createHash('sha256').update(canonicalizeProtocolJsonValue(first)).digest('hex'),
    );
    const trusted = registry(undefined, [first, second]);
    const verification = providerVerification(authorization());
    expect(() =>
      createStaticAuthorityVerifier(trusted, [second, first], { now: () => now }).verify(
        verification,
      ),
    ).toThrow(AuthorityVerificationError);
    expect(() =>
      createStaticAuthorityVerifier(trusted, [first], { now: () => now }).verify(verification),
    ).toThrow(AuthorityVerificationError);
    expect(() =>
      createStaticAuthorityVerifier(registry(undefined, [first, first]), [first, first], {
        now: () => now,
      }).verify(verification),
    ).toThrow(AuthorityVerificationError);
    const broken = { ...second, previousRevocationSha256: hash('f') };
    expect(() =>
      createStaticAuthorityVerifier(registry(undefined, [first, broken]), [first, broken], {
        now: () => now,
      }).verify(verification),
    ).toThrow(AuthorityVerificationError);
  });

  it('rejects revocations signed in the future or after their effective instant', () => {
    const record = authorization();
    const base = revocation(record);
    for (const invalid of [
      resignRevocation(base, '2026-08-21T12:01:00.000Z', '2026-08-21T13:00:00.000Z'),
      resignRevocation(base, '2026-08-21T11:31:00.000Z'),
    ]) {
      expect(() =>
        createStaticAuthorityVerifier(registry(undefined, [invalid]), [invalid], {
          now: () => now,
        }).verify(providerVerification(record)),
      ).toThrow(/Revocation signature time/);
    }
  });
});
