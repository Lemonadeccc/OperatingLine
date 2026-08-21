import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

import {
  authorityCanonicalization,
  canonicalizeAuthorityJson,
  authorityRecordKindValues,
  authorityRevocationSchema,
  authorityRevocationSignedContent,
  authoritySideEffectSchema,
  authoritySignatureAlgorithm,
  authoritySignatureDomainPrefix,
  authoritySignedContent,
  authorityValidationReceiptSchema,
  externalAuthorityRecordSchema,
  type AuthorityRecordKind,
  type AuthorityRevocation,
  type AuthoritySideEffect,
  type AuthoritySignerRole,
  type AuthorityValidationReceipt,
  type ExternalAuthorityRecord,
  type LocalMediaImportAuthorization,
  type MediaRightsEvidence,
  type YouTubePlatformDownloadAuthorization,
} from '@operatingline/protocol';
import { z } from 'zod';

const boundedIdSchema = z.string().trim().min(1).max(256);
const maximumTrustedRevocationCount = 4_096;
const trustedSignerSchema = z.strictObject({
  signerId: boundedIdSchema,
  keyId: boundedIdSchema,
  algorithm: z.literal(authoritySignatureAlgorithm),
  canonicalization: z.literal(authorityCanonicalization),
  publicKeyPem: z.string().min(1).max(16_384),
  roles: z
    .array(
      z.enum([
        'provider_call_authorizer',
        'local_media_import_authorizer',
        'media_rights_attestor',
        'youtube_platform_authorizer',
        'dataset_release_authorizer',
        'training_use_authorizer',
        'revocation_authorizer',
      ]),
    )
    .min(1)
    .max(7),
});
export const trustedAuthoritySignerRegistrySchema = z
  .strictObject({
    version: boundedIdSchema,
    revocationLog: z.strictObject({
      length: z.number().int().min(0).max(maximumTrustedRevocationCount),
      headSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    signers: z.array(trustedSignerSchema).min(1).max(1_000),
  })
  .superRefine((registry, context) => {
    const identities = new Set<string>();
    for (const [index, signer] of registry.signers.entries()) {
      const identity = `${signer.signerId}\0${signer.keyId}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['signers', index],
          message: 'Signer/key pairs must be unique',
        });
      }
      if (new Set(signer.roles).size !== signer.roles.length) {
        context.addIssue({
          code: 'custom',
          path: ['signers', index, 'roles'],
          message: 'Roles must be unique',
        });
      }
      identities.add(identity);
    }
  });
export type TrustedAuthoritySignerRegistry = z.infer<typeof trustedAuthoritySignerRegistrySchema>;

const roleByKind = {
  ProviderCallAuthorization: 'provider_call_authorizer',
  LocalMediaImportAuthorization: 'local_media_import_authorizer',
  MediaRightsEvidence: 'media_rights_attestor',
  YouTubePlatformDownloadAuthorization: 'youtube_platform_authorizer',
  DatasetReleaseAuthorization: 'dataset_release_authorizer',
  TrainingUseAuthorization: 'training_use_authorizer',
} as const satisfies Record<AuthorityRecordKind, AuthoritySignerRole>;

const kindBySideEffect = {
  provider_call: 'ProviderCallAuthorization',
  local_media_import: 'LocalMediaImportAuthorization',
  media_rights_validation: 'MediaRightsEvidence',
  youtube_platform_download: 'YouTubePlatformDownloadAuthorization',
  dataset_release: 'DatasetReleaseAuthorization',
  training_export: 'TrainingUseAuthorization',
} as const satisfies Record<AuthoritySideEffect, AuthorityRecordKind>;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function signedMessage(
  kind: AuthorityRecordKind | 'AuthorityRevocation',
  content: unknown,
): Buffer {
  const prefix = Buffer.from(authoritySignatureDomainPrefix(kind), 'utf8');
  const canonical = Buffer.from(canonicalizeAuthorityJson(content));
  return Buffer.concat([prefix, canonical]);
}

function targetFor(record: ExternalAuthorityRecord): string {
  switch (record.kind) {
    case 'ProviderCallAuthorization':
      return record.generationRequestSha256;
    case 'LocalMediaImportAuthorization':
      return record.source.contentSha256;
    case 'MediaRightsEvidence':
      return record.mediaSha256;
    case 'YouTubePlatformDownloadAuthorization':
      return record.mediaSourceIdentitySha256;
    case 'DatasetReleaseAuthorization':
      return record.releaseCandidateManifestSha256;
    case 'TrainingUseAuthorization':
      return record.releasedManifestSha256;
  }
}

export type AuthorityVerificationErrorCode =
  | 'invalid_record'
  | 'wrong_authority_kind'
  | 'wrong_target'
  | 'wrong_side_effect_binding'
  | 'untrusted_signer'
  | 'wrong_signer_role'
  | 'invalid_signature'
  | 'not_yet_valid'
  | 'expired'
  | 'invalid_clock'
  | 'revoked'
  | 'invalid_revocation_log'
  | 'rights_evidence_required';

export class AuthorityVerificationError extends Error {
  constructor(
    readonly code: AuthorityVerificationErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AuthorityVerificationError';
  }
}

export interface AuthorityValidationReceiptSink {
  append(receipt: AuthorityValidationReceipt): void;
}

export interface AuthorityVerifierOptions {
  readonly now?: () => Date;
  readonly maximumClockSkewMs?: number;
  readonly receiptSink?: AuthorityValidationReceiptSink;
}

export interface AuthorityTrustSnapshot {
  readonly registry: TrustedAuthoritySignerRegistry;
  readonly revocations: readonly unknown[];
}

/** Operator-owned source whose read must return one atomic registry/revocation snapshot. */
export interface AuthorityTrustSource {
  readSnapshot(): AuthorityTrustSnapshot;
}

function deepFreezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const nested of Object.values(candidate)) freeze(nested);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function createStaticAuthorityTrustSource(
  registry: TrustedAuthoritySignerRegistry,
  revocations: readonly unknown[] = [],
): AuthorityTrustSource {
  const snapshot = deepFreezeClone({ registry, revocations: [...revocations] });
  return Object.freeze({ readSnapshot: () => snapshot });
}

const sideEffectSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sideEffectTextSchema = z.string().trim().min(1).max(1_000);

export const providerCallSideEffectBindingSchema = z.strictObject({
  provider: z.strictObject({
    providerId: boundedIdSchema,
    descriptorVersion: boundedIdSchema,
    model: z.string().trim().min(1).max(256),
  }),
  operation: z.enum([
    'planning_generation',
    'semantic_replan_generation',
    'procedure_authoring_generation',
    'procedure_refinement_generation',
  ]),
  generationRequestSha256: sideEffectSha256Schema,
  disclosedDataSha256: sideEffectSha256Schema,
  estimatedCost: z
    .strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/u),
      minorUnits: z.number().int().min(0).max(1_000_000_000),
    })
    .optional(),
});
export type ProviderCallSideEffectBinding = z.infer<typeof providerCallSideEffectBindingSchema>;

export const localMediaImportSideEffectBindingSchema = z
  .strictObject({
    canonicalPathSha256: sideEffectSha256Schema,
    contentSha256: sideEffectSha256Schema,
    byteLength: z.number().int().min(1).max(10_737_418_240),
    processingStages: z
      .array(z.enum(['probe', 'audio', 'asr', 'frames', 'ocr', 'recognition', 'segmentation']))
      .min(1)
      .max(7),
    retention: z.enum([
      'private_cas_until_expiry',
      'private_cas_indefinite',
      'delete_after_processing',
    ]),
  })
  .superRefine((binding, context) => {
    if (new Set(binding.processingStages).size !== binding.processingStages.length) {
      context.addIssue({
        code: 'custom',
        path: ['processingStages'],
        message: 'Processing stages must be unique',
      });
    }
  });
export type LocalMediaImportSideEffectBinding = z.infer<
  typeof localMediaImportSideEffectBindingSchema
>;

export const mediaRightsSideEffectBindingSchema = z.strictObject({
  mediaSha256: sideEffectSha256Schema,
  sourceIdentitySha256: sideEffectSha256Schema,
  rightsBasis: z.enum(['rights_holder_permission', 'license_verified', 'public_domain_verified']),
  rightsHolder: z.string().trim().min(1).max(500).nullable(),
  evidenceReference: sideEffectTextSchema,
  purpose: z.enum(['private_analysis', 'dataset_release', 'training_export']),
});
export type MediaRightsSideEffectBinding = z.infer<typeof mediaRightsSideEffectBindingSchema>;

export const youtubeDownloadSideEffectBindingSchema = z.strictObject({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
  mediaSourceIdentitySha256: sideEffectSha256Schema,
  writtenPlatformApprovalReference: sideEffectTextSchema,
  operation: z.literal('download_media'),
});
export type YouTubeDownloadSideEffectBinding = z.infer<
  typeof youtubeDownloadSideEffectBindingSchema
>;

export const datasetReleaseSideEffectBindingSchema = z.strictObject({
  releaseCandidateManifestSha256: sideEffectSha256Schema,
  audience: z.enum(['named_recipients', 'organization', 'public']),
  license: z.string().trim().min(1).max(256),
  redactionDecisionSha256: sideEffectSha256Schema,
  releaseScope: sideEffectTextSchema,
});
export type DatasetReleaseSideEffectBinding = z.infer<typeof datasetReleaseSideEffectBindingSchema>;

export const trainingUseSideEffectBindingSchema = z.strictObject({
  releasedManifestSha256: sideEffectSha256Schema,
  purpose: z.string().trim().min(1).max(500),
  modelFamily: z.string().trim().min(1).max(256),
  scope: z.enum(['export_only', 'export_and_run']),
});
export type TrainingUseSideEffectBinding = z.infer<typeof trainingUseSideEffectBindingSchema>;

export type VerifyAuthorityRequest =
  | {
      readonly record: unknown;
      readonly sideEffect: 'provider_call';
      readonly targetSha256: string;
      readonly binding: ProviderCallSideEffectBinding;
    }
  | {
      readonly record: unknown;
      readonly sideEffect: 'local_media_import';
      readonly targetSha256: string;
      readonly binding: LocalMediaImportSideEffectBinding;
    }
  | {
      readonly record: unknown;
      readonly sideEffect: 'media_rights_validation';
      readonly targetSha256: string;
      readonly binding: MediaRightsSideEffectBinding;
    }
  | {
      readonly record: unknown;
      readonly sideEffect: 'youtube_platform_download';
      readonly targetSha256: string;
      readonly binding: YouTubeDownloadSideEffectBinding;
    }
  | {
      readonly record: unknown;
      readonly sideEffect: 'dataset_release';
      readonly targetSha256: string;
      readonly binding: DatasetReleaseSideEffectBinding;
    }
  | {
      readonly record: unknown;
      readonly sideEffect: 'training_export';
      readonly targetSha256: string;
      readonly binding: TrainingUseSideEffectBinding;
    };

const verifyAuthorityRequestSchema = z.discriminatedUnion('sideEffect', [
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('provider_call'),
    targetSha256: sideEffectSha256Schema,
    binding: providerCallSideEffectBindingSchema,
  }),
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('local_media_import'),
    targetSha256: sideEffectSha256Schema,
    binding: localMediaImportSideEffectBindingSchema,
  }),
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('media_rights_validation'),
    targetSha256: sideEffectSha256Schema,
    binding: mediaRightsSideEffectBindingSchema,
  }),
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('youtube_platform_download'),
    targetSha256: sideEffectSha256Schema,
    binding: youtubeDownloadSideEffectBindingSchema,
  }),
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('dataset_release'),
    targetSha256: sideEffectSha256Schema,
    binding: datasetReleaseSideEffectBindingSchema,
  }),
  z.strictObject({
    record: z.unknown(),
    sideEffect: z.literal('training_export'),
    targetSha256: sideEffectSha256Schema,
    binding: trainingUseSideEffectBindingSchema,
  }),
]);

interface ValidatedAuthorityTrustSnapshot {
  readonly registry: TrustedAuthoritySignerRegistry;
  readonly revocations: readonly AuthorityRevocation[];
  readonly revocationLogHeadSha256: string;
  readonly signersByIdentity: ReadonlyMap<string, TrustedSignerCacheEntry>;
}

interface TrustedSignerCacheEntry {
  readonly signer: TrustedAuthoritySignerRegistry['signers'][number];
  readonly publicKey: KeyObject;
}

export class AuthorityVerifier {
  readonly #trustSource: AuthorityTrustSource;
  readonly #now: () => Date;
  readonly #maximumClockSkewMs: number;
  readonly #receiptSink: AuthorityValidationReceiptSink | undefined;

  constructor(trustSource: AuthorityTrustSource, options: AuthorityVerifierOptions = {}) {
    if (!trustSource || typeof trustSource.readSnapshot !== 'function') {
      throw new AuthorityVerificationError(
        'invalid_revocation_log',
        'An authority trust source is required',
      );
    }
    this.#trustSource = trustSource;
    this.#now = options.now ?? (() => new Date());
    this.#maximumClockSkewMs = options.maximumClockSkewMs ?? 5 * 60 * 1_000;
    this.#receiptSink = options.receiptSink;
    if (
      !Number.isSafeInteger(this.#maximumClockSkewMs) ||
      this.#maximumClockSkewMs < 0 ||
      this.#maximumClockSkewMs > 5 * 60 * 1_000
    ) {
      throw new AuthorityVerificationError(
        'invalid_clock',
        'Clock skew must be between zero and five minutes',
      );
    }
  }

  verify(request: VerifyAuthorityRequest): AuthorityValidationReceipt {
    const parsedRequest = this.#parseVerifyRequest(request);
    const now = this.#safeNow();
    return this.#verifyWithSnapshot(parsedRequest, this.#readValidatedSnapshot(now), now);
  }

  #verifyWithSnapshot(
    request: VerifyAuthorityRequest,
    snapshot: ValidatedAuthorityTrustSnapshot,
    now: Date,
  ): AuthorityValidationReceipt {
    const sideEffect = authoritySideEffectSchema.parse(request.sideEffect);
    const parsed = externalAuthorityRecordSchema.safeParse(request.record);
    if (!parsed.success) throw new AuthorityVerificationError('invalid_record');
    const record = parsed.data;
    if (record.kind !== kindBySideEffect[sideEffect]) {
      throw new AuthorityVerificationError('wrong_authority_kind');
    }
    if (targetFor(record) !== request.targetSha256) {
      throw new AuthorityVerificationError('wrong_target');
    }
    if (!this.#sideEffectBindingMatches(record, request)) {
      throw new AuthorityVerificationError('wrong_side_effect_binding');
    }

    const trustedSigner = this.#trustedSigner(
      snapshot.signersByIdentity,
      record.signature.signerId,
      record.signature.keyId,
    );
    const signer = trustedSigner.signer;
    if (record.issuer !== signer.signerId) {
      throw new AuthorityVerificationError(
        'untrusted_signer',
        'Issuer does not match the trusted signer',
      );
    }
    if (!signer.roles.includes(roleByKind[record.kind])) {
      throw new AuthorityVerificationError('wrong_signer_role');
    }
    this.#verifyDetachedSignature(
      record.kind,
      authoritySignedContent(record),
      record.signature.signature,
      trustedSigner.publicKey,
    );
    this.#validateTimes(record.notBefore, record.expiresAt, record.signature.signedAt, now);

    const contentSha256 = sha256(canonicalizeAuthorityJson(authoritySignedContent(record)));
    const revoked = snapshot.revocations.some(
      (revocation) =>
        revocation.authorityId === record.authorityId &&
        revocation.authorityContentSha256 === contentSha256 &&
        Date.parse(revocation.effectiveAt) <= now.getTime(),
    );
    if (revoked) throw new AuthorityVerificationError('revoked');

    const receipt = authorityValidationReceiptSchema.parse({
      formatVersion: '1.0.0',
      receiptId: randomUUID(),
      authorityKind: record.kind,
      authorityId: record.authorityId,
      authorityContentSha256: contentSha256,
      signerId: signer.signerId,
      keyId: signer.keyId,
      registryVersion: snapshot.registry.version,
      validatedAt: now.toISOString(),
      revocationLogHeadSha256: snapshot.revocationLogHeadSha256,
      targetSha256: request.targetSha256,
      sideEffect,
    });
    this.#receiptSink?.append(receipt);
    return receipt;
  }

  verifyLocalMediaImport(input: {
    importAuthorization: LocalMediaImportAuthorization;
    rightsEvidence: MediaRightsEvidence;
    contentSha256: string;
    sourceIdentitySha256: string;
    importBinding: LocalMediaImportSideEffectBinding;
    rightsBinding: MediaRightsSideEffectBinding;
  }): readonly [AuthorityValidationReceipt, AuthorityValidationReceipt] {
    if (
      input.importAuthorization.source.contentSha256 !== input.contentSha256 ||
      input.rightsEvidence.mediaSha256 !== input.contentSha256 ||
      input.rightsEvidence.sourceIdentitySha256 !== input.sourceIdentitySha256 ||
      input.importAuthorization.source.canonicalPathSha256 !== input.sourceIdentitySha256 ||
      !input.rightsEvidence.allowedPurposes.includes('private_analysis')
    ) {
      throw new AuthorityVerificationError('rights_evidence_required');
    }
    const importRequest = this.#parseVerifyRequest({
      record: input.importAuthorization,
      sideEffect: 'local_media_import',
      targetSha256: input.contentSha256,
      binding: input.importBinding,
    });
    const rightsRequest = this.#parseVerifyRequest({
      record: input.rightsEvidence,
      sideEffect: 'media_rights_validation',
      targetSha256: input.contentSha256,
      binding: input.rightsBinding,
    });
    const now = this.#safeNow();
    const snapshot = this.#readValidatedSnapshot(now);
    return [
      this.#verifyWithSnapshot(importRequest, snapshot, now),
      this.#verifyWithSnapshot(rightsRequest, snapshot, now),
    ];
  }

  verifyYouTubeDownload(input: {
    downloadAuthorization: YouTubePlatformDownloadAuthorization;
    rightsEvidence: MediaRightsEvidence;
    downloadBinding: YouTubeDownloadSideEffectBinding;
    rightsBinding: MediaRightsSideEffectBinding;
  }): readonly [AuthorityValidationReceipt, AuthorityValidationReceipt] {
    if (
      input.downloadAuthorization.mediaSourceIdentitySha256 !==
        input.rightsEvidence.sourceIdentitySha256 ||
      !input.rightsEvidence.allowedPurposes.includes('private_analysis')
    ) {
      throw new AuthorityVerificationError('rights_evidence_required');
    }
    const downloadRequest = this.#parseVerifyRequest({
      record: input.downloadAuthorization,
      sideEffect: 'youtube_platform_download',
      targetSha256: input.downloadAuthorization.mediaSourceIdentitySha256,
      binding: input.downloadBinding,
    });
    const rightsRequest = this.#parseVerifyRequest({
      record: input.rightsEvidence,
      sideEffect: 'media_rights_validation',
      targetSha256: input.rightsEvidence.mediaSha256,
      binding: input.rightsBinding,
    });
    const now = this.#safeNow();
    const snapshot = this.#readValidatedSnapshot(now);
    return [
      this.#verifyWithSnapshot(downloadRequest, snapshot, now),
      this.#verifyWithSnapshot(rightsRequest, snapshot, now),
    ];
  }

  #parseVerifyRequest(request: VerifyAuthorityRequest): VerifyAuthorityRequest {
    const parsedRequest = verifyAuthorityRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new AuthorityVerificationError(
        'wrong_side_effect_binding',
        'Authority side-effect binding is not an exact supported shape',
      );
    }
    return parsedRequest.data;
  }

  #safeNow(): Date {
    const value = this.#now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AuthorityVerificationError('invalid_clock');
    }
    return value;
  }

  #sideEffectBindingMatches(
    record: ExternalAuthorityRecord,
    request: VerifyAuthorityRequest,
  ): boolean {
    switch (record.kind) {
      case 'ProviderCallAuthorization': {
        if (request.sideEffect !== 'provider_call') return false;
        const binding = request.binding;
        const cost = binding.estimatedCost;
        return (
          binding.provider.providerId === record.provider.providerId &&
          binding.provider.descriptorVersion === record.provider.descriptorVersion &&
          binding.provider.model === record.provider.model &&
          binding.operation === record.operation &&
          binding.generationRequestSha256 === record.generationRequestSha256 &&
          binding.disclosedDataSha256 === record.disclosedDataSha256 &&
          (cost === undefined ||
            (/^[A-Z]{3}$/u.test(cost.currency) &&
              Number.isSafeInteger(cost.minorUnits) &&
              cost.minorUnits >= 0)) &&
          (record.costCeiling === undefined ||
            (cost !== undefined &&
              cost.currency === record.costCeiling.currency &&
              cost.minorUnits <= record.costCeiling.minorUnits))
        );
      }
      case 'LocalMediaImportAuthorization':
        return (
          request.sideEffect === 'local_media_import' &&
          request.binding.canonicalPathSha256 === record.source.canonicalPathSha256 &&
          request.binding.contentSha256 === record.source.contentSha256 &&
          request.binding.byteLength === record.source.byteLength &&
          JSON.stringify(request.binding.processingStages) ===
            JSON.stringify(record.allowedProcessingStages) &&
          request.binding.retention === record.retention
        );
      case 'MediaRightsEvidence':
        return (
          request.sideEffect === 'media_rights_validation' &&
          request.binding.mediaSha256 === record.mediaSha256 &&
          request.binding.sourceIdentitySha256 === record.sourceIdentitySha256 &&
          request.binding.rightsBasis === record.rightsBasis &&
          request.binding.rightsHolder === record.rightsHolder &&
          request.binding.evidenceReference === record.evidenceReference &&
          record.allowedPurposes.includes(request.binding.purpose)
        );
      case 'YouTubePlatformDownloadAuthorization':
        return (
          request.sideEffect === 'youtube_platform_download' &&
          request.binding.videoId === record.videoId &&
          request.binding.mediaSourceIdentitySha256 === record.mediaSourceIdentitySha256 &&
          request.binding.writtenPlatformApprovalReference ===
            record.writtenPlatformApprovalReference &&
          request.binding.operation === record.allowedOperation
        );
      case 'DatasetReleaseAuthorization':
        return (
          request.sideEffect === 'dataset_release' &&
          request.binding.releaseCandidateManifestSha256 ===
            record.releaseCandidateManifestSha256 &&
          request.binding.audience === record.audience &&
          request.binding.license === record.license &&
          request.binding.redactionDecisionSha256 === record.redactionDecisionSha256 &&
          request.binding.releaseScope === record.releaseScope
        );
      case 'TrainingUseAuthorization':
        return (
          request.sideEffect === 'training_export' &&
          request.binding.releasedManifestSha256 === record.releasedManifestSha256 &&
          request.binding.purpose === record.purpose &&
          request.binding.modelFamily === record.modelFamily &&
          request.binding.scope === record.scope
        );
    }
  }

  #trustedSigner(
    signersByIdentity: ReadonlyMap<string, TrustedSignerCacheEntry>,
    signerId: string,
    keyId: string,
  ): TrustedSignerCacheEntry {
    const signer = signersByIdentity.get(`${signerId}\0${keyId}`);
    if (!signer) throw new AuthorityVerificationError('untrusted_signer');
    return signer;
  }

  #verifyDetachedSignature(
    kind: AuthorityRecordKind | 'AuthorityRevocation',
    content: unknown,
    signature: string,
    publicKey: KeyObject,
  ): void {
    if (
      !verifySignature(
        null,
        signedMessage(kind, content),
        publicKey,
        Buffer.from(signature, 'base64url'),
      )
    ) {
      throw new AuthorityVerificationError('invalid_signature');
    }
  }

  #validateTimes(notBefore: string, expiresAt: string, signedAt: string, now: Date): void {
    const time = now.getTime();
    if (Date.parse(signedAt) > time + this.#maximumClockSkewMs) {
      throw new AuthorityVerificationError(
        'invalid_clock',
        'Signature time exceeds allowed clock skew',
      );
    }
    if (Date.parse(notBefore) > time) {
      throw new AuthorityVerificationError('not_yet_valid');
    }
    if (Date.parse(expiresAt) <= time) {
      throw new AuthorityVerificationError('expired');
    }
  }

  #readValidatedSnapshot(now: Date): ValidatedAuthorityTrustSnapshot {
    const sourceSnapshot = this.#trustSource.readSnapshot();
    if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
      throw new AuthorityVerificationError(
        'invalid_revocation_log',
        'Trust source returned no snapshot',
      );
    }
    const registry = trustedAuthoritySignerRegistrySchema.parse(sourceSnapshot.registry);
    if (
      !Array.isArray(sourceSnapshot.revocations) ||
      registry.revocationLog.length !== sourceSnapshot.revocations.length ||
      sourceSnapshot.revocations.length > maximumTrustedRevocationCount
    ) {
      throw new AuthorityVerificationError(
        'invalid_revocation_log',
        'Revocation log length is not the trusted bounded length',
      );
    }
    const signersByIdentity = new Map<string, TrustedSignerCacheEntry>();
    for (const signer of registry.signers) {
      let publicKey: KeyObject;
      try {
        publicKey = createPublicKey(signer.publicKeyPem);
      } catch {
        throw new AuthorityVerificationError('untrusted_signer', 'Trusted public key is invalid');
      }
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        throw new AuthorityVerificationError('untrusted_signer', 'Trusted key is not Ed25519');
      }
      signersByIdentity.set(`${signer.signerId}\0${signer.keyId}`, { signer, publicKey });
    }
    const revocations = this.#validateRevocationLog(
      sourceSnapshot.revocations,
      signersByIdentity,
      now,
    );
    const revocationLogHeadSha256 =
      revocations.length === 0
        ? sha256(canonicalizeAuthorityJson([]))
        : sha256(canonicalizeAuthorityJson(revocations.at(-1)!));
    if (
      registry.revocationLog.length !== revocations.length ||
      registry.revocationLog.headSha256 !== revocationLogHeadSha256
    ) {
      throw new AuthorityVerificationError(
        'invalid_revocation_log',
        'Revocation log does not match the trusted length and head',
      );
    }
    return { registry, revocations, revocationLogHeadSha256, signersByIdentity };
  }

  #validateRevocationLog(
    inputs: readonly unknown[],
    signersByIdentity: ReadonlyMap<string, TrustedSignerCacheEntry>,
    now: Date,
  ): readonly AuthorityRevocation[] {
    const revocations: AuthorityRevocation[] = [];
    const ids = new Set<string>();
    let previousRevocationSha256: string | null = null;
    for (const [sequence, input] of inputs.entries()) {
      const parsed = authorityRevocationSchema.safeParse(input);
      if (!parsed.success) throw new AuthorityVerificationError('invalid_revocation_log');
      const revocation = parsed.data;
      if (
        ids.has(revocation.revocationId) ||
        revocation.sequence !== sequence ||
        revocation.previousRevocationSha256 !== previousRevocationSha256
      ) {
        throw new AuthorityVerificationError(
          'invalid_revocation_log',
          'Revocations must form one unique append-only hash chain',
        );
      }
      const trustedSigner = this.#trustedSigner(
        signersByIdentity,
        revocation.signature.signerId,
        revocation.signature.keyId,
      );
      const signer = trustedSigner.signer;
      if (!signer.roles.includes('revocation_authorizer')) {
        throw new AuthorityVerificationError(
          'invalid_revocation_log',
          'Revocation signer lacks its role',
        );
      }
      if (
        Date.parse(revocation.signature.signedAt) > now.getTime() ||
        Date.parse(revocation.signature.signedAt) > Date.parse(revocation.effectiveAt)
      ) {
        throw new AuthorityVerificationError(
          'invalid_revocation_log',
          'Revocation signature time must not be future or follow effectiveAt',
        );
      }
      try {
        this.#verifyDetachedSignature(
          'AuthorityRevocation',
          authorityRevocationSignedContent(revocation),
          revocation.signature.signature,
          trustedSigner.publicKey,
        );
      } catch {
        throw new AuthorityVerificationError(
          'invalid_revocation_log',
          'Revocation signature is invalid',
        );
      }
      ids.add(revocation.revocationId);
      revocations.push(revocation);
      previousRevocationSha256 = sha256(canonicalizeAuthorityJson(revocation));
    }
    return Object.freeze(revocations);
  }
}

export function createStaticAuthorityVerifier(
  registry: TrustedAuthoritySignerRegistry,
  revocations: readonly unknown[] = [],
  options: AuthorityVerifierOptions = {},
): AuthorityVerifier {
  return new AuthorityVerifier(createStaticAuthorityTrustSource(registry, revocations), options);
}

export const externalAuthorityKinds = authorityRecordKindValues;
