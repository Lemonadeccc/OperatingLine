import { z } from 'zod';

import { canonicalizeProtocolJsonValue } from './canonical-json-value.js';

export const authorityFormatVersion = '1.0.0' as const;
export const authorityFormatVersionSchema = z.literal(authorityFormatVersion);
export const authorityCanonicalization = 'operatingline-authority-json-v1' as const;
export const authorityCanonicalizationSchema = z.literal(authorityCanonicalization);
export const authoritySignatureAlgorithm = 'ed25519' as const;
export const authoritySignatureAlgorithmSchema = z.literal(authoritySignatureAlgorithm);
export const authoritySignatureDomain = 'OperatingLine Authority v1' as const;

/** Fixed authority-v1 JSON mapping shared by signers and verifiers. */
export function canonicalizeAuthorityJson(value: unknown): Uint8Array {
  return canonicalizeProtocolJsonValue(value);
}

export const authorityRecordKindValues = [
  'ProviderCallAuthorization',
  'LocalMediaImportAuthorization',
  'MediaRightsEvidence',
  'YouTubePlatformDownloadAuthorization',
  'DatasetReleaseAuthorization',
  'TrainingUseAuthorization',
] as const;
export const authorityRecordKindSchema = z.enum(authorityRecordKindValues);
export type AuthorityRecordKind = z.infer<typeof authorityRecordKindSchema>;

export const authoritySha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const authorityIdSchema = z.string().uuid();
const boundedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const boundedTextSchema = z.string().trim().min(1).max(1_000);
const instantSchema = z.iso.datetime({ offset: true });

export const authorityDetachedSignatureSchema = z.strictObject({
  signerId: boundedIdSchema,
  keyId: boundedIdSchema,
  algorithm: authoritySignatureAlgorithmSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
  signedAt: instantSchema,
});
export type AuthorityDetachedSignature = z.infer<typeof authorityDetachedSignatureSchema>;

const commonAuthorityShape = {
  formatVersion: authorityFormatVersionSchema,
  canonicalization: authorityCanonicalizationSchema,
  authorityId: authorityIdSchema,
  issuer: boundedIdSchema,
  notBefore: instantSchema,
  expiresAt: instantSchema,
  signature: authorityDetachedSignatureSchema,
} as const;

function timeOrdered<T extends z.ZodType>(schema: T): T {
  return schema.superRefine((record, context) => {
    const value = record as {
      notBefore: string;
      expiresAt: string;
      signature: { signedAt: string };
    };
    if (Date.parse(value.expiresAt) <= Date.parse(value.notBefore)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must follow notBefore',
      });
    }
    if (Date.parse(value.signature.signedAt) > Date.parse(value.expiresAt)) {
      context.addIssue({
        code: 'custom',
        path: ['signature', 'signedAt'],
        message: 'Signature time must not follow expiry',
      });
    }
  }) as T;
}

export const providerCallOperationValues = [
  'planning_generation',
  'semantic_replan_generation',
  'procedure_authoring_generation',
  'procedure_refinement_generation',
] as const;

export const providerCallAuthorizationSchema = timeOrdered(
  z.strictObject({
    ...commonAuthorityShape,
    kind: z.literal('ProviderCallAuthorization'),
    provider: z.strictObject({
      providerId: boundedIdSchema,
      descriptorVersion: boundedIdSchema,
      model: z.string().trim().min(1).max(256),
    }),
    operation: z.enum(providerCallOperationValues),
    generationRequestSha256: authoritySha256Schema,
    disclosedDataSha256: authoritySha256Schema,
    maximumCallCount: z.literal(1),
    costCeiling: z
      .strictObject({
        currency: z.string().regex(/^[A-Z]{3}$/u),
        minorUnits: z.number().int().min(0).max(1_000_000_000),
      })
      .optional(),
  }),
);
export type ProviderCallAuthorization = z.infer<typeof providerCallAuthorizationSchema>;

export const localMediaProcessingStageValues = [
  'probe',
  'audio',
  'asr',
  'frames',
  'ocr',
  'recognition',
  'segmentation',
] as const;
export const localMediaImportAuthorizationSchema = timeOrdered(
  z
    .strictObject({
      ...commonAuthorityShape,
      kind: z.literal('LocalMediaImportAuthorization'),
      source: z.strictObject({
        canonicalPathSha256: authoritySha256Schema,
        contentSha256: authoritySha256Schema,
        byteLength: z.number().int().min(1).max(10_737_418_240),
      }),
      allowedProcessingStages: z.array(z.enum(localMediaProcessingStageValues)).min(1).max(7),
      retention: z.enum([
        'private_cas_until_expiry',
        'private_cas_indefinite',
        'delete_after_processing',
      ]),
    })
    .superRefine((record, context) => {
      if (new Set(record.allowedProcessingStages).size !== record.allowedProcessingStages.length) {
        context.addIssue({
          code: 'custom',
          path: ['allowedProcessingStages'],
          message: 'Stages must be unique',
        });
      }
    }),
);
export type LocalMediaImportAuthorization = z.infer<typeof localMediaImportAuthorizationSchema>;

export const mediaRightsEvidenceSchema = timeOrdered(
  z
    .strictObject({
      ...commonAuthorityShape,
      kind: z.literal('MediaRightsEvidence'),
      mediaSha256: authoritySha256Schema,
      sourceIdentitySha256: authoritySha256Schema,
      rightsBasis: z.enum([
        'rights_holder_permission',
        'license_verified',
        'public_domain_verified',
      ]),
      rightsHolder: z.string().trim().min(1).max(500).nullable(),
      evidenceReference: boundedTextSchema,
      allowedPurposes: z
        .array(z.enum(['private_analysis', 'dataset_release', 'training_export']))
        .min(1)
        .max(3),
    })
    .superRefine((record, context) => {
      if (new Set(record.allowedPurposes).size !== record.allowedPurposes.length) {
        context.addIssue({
          code: 'custom',
          path: ['allowedPurposes'],
          message: 'Purposes must be unique',
        });
      }
      if (record.rightsBasis !== 'public_domain_verified' && record.rightsHolder === null) {
        context.addIssue({
          code: 'custom',
          path: ['rightsHolder'],
          message: 'Rights holder is required',
        });
      }
    }),
);
export type MediaRightsEvidence = z.infer<typeof mediaRightsEvidenceSchema>;

export const youtubePlatformDownloadAuthorizationSchema = timeOrdered(
  z.strictObject({
    ...commonAuthorityShape,
    kind: z.literal('YouTubePlatformDownloadAuthorization'),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    mediaSourceIdentitySha256: authoritySha256Schema,
    writtenPlatformApprovalReference: boundedTextSchema,
    allowedOperation: z.literal('download_media'),
  }),
);
export type YouTubePlatformDownloadAuthorization = z.infer<
  typeof youtubePlatformDownloadAuthorizationSchema
>;

export const datasetReleaseAuthorizationSchema = timeOrdered(
  z.strictObject({
    ...commonAuthorityShape,
    kind: z.literal('DatasetReleaseAuthorization'),
    releaseCandidateManifestSha256: authoritySha256Schema,
    audience: z.enum(['named_recipients', 'organization', 'public']),
    license: z.string().trim().min(1).max(256),
    redactionDecisionSha256: authoritySha256Schema,
    releaseScope: z.string().trim().min(1).max(1_000),
  }),
);
export type DatasetReleaseAuthorization = z.infer<typeof datasetReleaseAuthorizationSchema>;

export const trainingUseAuthorizationSchema = timeOrdered(
  z.strictObject({
    ...commonAuthorityShape,
    kind: z.literal('TrainingUseAuthorization'),
    releasedManifestSha256: authoritySha256Schema,
    purpose: z.string().trim().min(1).max(500),
    modelFamily: z.string().trim().min(1).max(256),
    scope: z.enum(['export_only', 'export_and_run']),
  }),
);
export type TrainingUseAuthorization = z.infer<typeof trainingUseAuthorizationSchema>;

export const externalAuthorityRecordSchema = z.discriminatedUnion('kind', [
  providerCallAuthorizationSchema,
  localMediaImportAuthorizationSchema,
  mediaRightsEvidenceSchema,
  youtubePlatformDownloadAuthorizationSchema,
  datasetReleaseAuthorizationSchema,
  trainingUseAuthorizationSchema,
]);
export type ExternalAuthorityRecord = z.infer<typeof externalAuthorityRecordSchema>;

export type AuthoritySignedContent = Omit<ExternalAuthorityRecord, 'signature'> & {
  readonly signature: Omit<AuthorityDetachedSignature, 'signature'>;
};

/** Returns the exact JSON value covered by an authority record's detached signature. */
export function authoritySignedContent(
  recordInput: ExternalAuthorityRecord,
): AuthoritySignedContent {
  const record = externalAuthorityRecordSchema.parse(recordInput);
  const { signature, ...content } = record;
  return {
    ...content,
    signature: {
      signerId: signature.signerId,
      keyId: signature.keyId,
      algorithm: signature.algorithm,
      signedAt: signature.signedAt,
    },
  };
}

/** Domain prefix used before canonical signed bytes. */
export function authoritySignatureDomainPrefix(
  kind: AuthorityRecordKind | 'AuthorityRevocation',
): string {
  return `${authoritySignatureDomain}\0${kind}\0`;
}

export const authoritySignerRoleValues = [
  'provider_call_authorizer',
  'local_media_import_authorizer',
  'media_rights_attestor',
  'youtube_platform_authorizer',
  'dataset_release_authorizer',
  'training_use_authorizer',
  'revocation_authorizer',
] as const;
export const authoritySignerRoleSchema = z.enum(authoritySignerRoleValues);
export type AuthoritySignerRole = z.infer<typeof authoritySignerRoleSchema>;

export const authoritySideEffectValues = [
  'provider_call',
  'local_media_import',
  'media_rights_validation',
  'youtube_platform_download',
  'dataset_release',
  'training_export',
] as const;
export const authoritySideEffectSchema = z.enum(authoritySideEffectValues);
export type AuthoritySideEffect = z.infer<typeof authoritySideEffectSchema>;

export const authorityValidationReceiptSchema = z.strictObject({
  formatVersion: authorityFormatVersionSchema,
  receiptId: z.string().uuid(),
  authorityKind: authorityRecordKindSchema,
  authorityId: authorityIdSchema,
  authorityContentSha256: authoritySha256Schema,
  signerId: boundedIdSchema,
  keyId: boundedIdSchema,
  registryVersion: boundedIdSchema,
  validatedAt: instantSchema,
  revocationLogHeadSha256: authoritySha256Schema,
  targetSha256: authoritySha256Schema,
  sideEffect: authoritySideEffectSchema,
});
export type AuthorityValidationReceipt = z.infer<typeof authorityValidationReceiptSchema>;

export const authorityRevocationSchema = z.strictObject({
  formatVersion: authorityFormatVersionSchema,
  canonicalization: authorityCanonicalizationSchema,
  kind: z.literal('AuthorityRevocation'),
  revocationId: z.string().uuid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  previousRevocationSha256: authoritySha256Schema.nullable(),
  authorityId: authorityIdSchema,
  authorityContentSha256: authoritySha256Schema,
  effectiveAt: instantSchema,
  reason: boundedTextSchema,
  signature: authorityDetachedSignatureSchema,
});
export type AuthorityRevocation = z.infer<typeof authorityRevocationSchema>;

export type AuthorityRevocationSignedContent = Omit<AuthorityRevocation, 'signature'> & {
  readonly signature: Omit<AuthorityDetachedSignature, 'signature'>;
};

export function authorityRevocationSignedContent(
  revocationInput: AuthorityRevocation,
): AuthorityRevocationSignedContent {
  const revocation = authorityRevocationSchema.parse(revocationInput);
  const { signature, ...content } = revocation;
  return {
    ...content,
    signature: {
      signerId: signature.signerId,
      keyId: signature.keyId,
      algorithm: signature.algorithm,
      signedAt: signature.signedAt,
    },
  };
}
