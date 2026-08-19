import {
  procedureTutorialMediaAnalysisRequestSchema,
  type ProcedureTutorialMediaAnalysisRequest,
} from '@operatingline/protocol';
import { z } from 'zod';

const opaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const videoIdSchema = procedureTutorialMediaAnalysisRequestSchema.shape.videoId;
const defaultMaximumConfirmationAgeMs = 24 * 60 * 60 * 1_000;
const maximumClockSkewMs = 5 * 60 * 1_000;

export const youtubeMediaAuthorizationRecordSchema = z
  .strictObject({
    authorizationId: opaqueReferenceSchema,
    videoId: videoIdSchema,
    rightsAuthorization: z.strictObject({
      basis: z.enum(['rights_holder_permission', 'license_verified', 'public_domain_verified']),
      reference: opaqueReferenceSchema,
    }),
    platformDownloadAuthorization: z.strictObject({
      basis: z.literal('youtube_written_approval'),
      reference: opaqueReferenceSchema,
    }),
    validFrom: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    if (record.rightsAuthorization.reference === record.platformDownloadAuthorization.reference) {
      context.addIssue({
        code: 'custom',
        path: ['platformDownloadAuthorization', 'reference'],
        message: 'Rights and platform authorization references must be distinct',
      });
    }
    if (Date.parse(record.expiresAt) <= Date.parse(record.validFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Authorization expiry must follow its validity start',
      });
    }
  });

export const youtubeMediaAuthorizationRegistrySchema = z
  .strictObject({
    formatVersion: z.literal('1.0.0'),
    authorizations: z.array(youtubeMediaAuthorizationRecordSchema).min(1).max(10_000),
  })
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    const bindings = new Set<string>();
    for (const [index, authorization] of registry.authorizations.entries()) {
      const binding = [
        authorization.videoId,
        authorization.rightsAuthorization.basis,
        authorization.rightsAuthorization.reference,
        authorization.platformDownloadAuthorization.reference,
      ].join('\0');
      if (ids.has(authorization.authorizationId)) {
        context.addIssue({
          code: 'custom',
          path: ['authorizations', index, 'authorizationId'],
          message: 'Authorization ids must be unique',
        });
      }
      if (bindings.has(binding)) {
        context.addIssue({
          code: 'custom',
          path: ['authorizations', index],
          message: 'Authorization bindings must be unique',
        });
      }
      ids.add(authorization.authorizationId);
      bindings.add(binding);
    }
  });
export type YouTubeMediaAuthorizationRegistry = z.infer<
  typeof youtubeMediaAuthorizationRegistrySchema
>;

export type YouTubeMediaAuthorizationErrorCode =
  'invalid_configuration' | 'authorization_required' | 'authorization_expired';

export class YouTubeMediaAuthorizationError extends Error {
  constructor(readonly code: YouTubeMediaAuthorizationErrorCode) {
    super(
      code === 'invalid_configuration'
        ? 'The trusted YouTube media authorization registry is invalid.'
        : code === 'authorization_expired'
          ? 'The trusted YouTube media authorization has expired.'
          : 'Trusted YouTube media authorization is required.',
    );
    this.name = 'YouTubeMediaAuthorizationError';
  }
}

export interface YouTubeMediaAuthorizationVerifier {
  verify(request: ProcedureTutorialMediaAnalysisRequest): Promise<void>;
}

export interface YouTubeMediaAuthorizationVerifierOptions {
  readonly now?: () => Date;
  readonly maximumConfirmationAgeMs?: number;
}

export function createYouTubeMediaAuthorizationVerifier(
  registryInput: YouTubeMediaAuthorizationRegistry,
  options: YouTubeMediaAuthorizationVerifierOptions = {},
): YouTubeMediaAuthorizationVerifier {
  const parsedRegistry = youtubeMediaAuthorizationRegistrySchema.safeParse(registryInput);
  const maximumConfirmationAgeMs =
    options.maximumConfirmationAgeMs ?? defaultMaximumConfirmationAgeMs;
  if (
    !parsedRegistry.success ||
    !Number.isSafeInteger(maximumConfirmationAgeMs) ||
    maximumConfirmationAgeMs <= 0
  ) {
    throw new YouTubeMediaAuthorizationError('invalid_configuration');
  }
  const records = parsedRegistry.data.authorizations;

  return {
    async verify(requestInput) {
      const request = procedureTutorialMediaAnalysisRequestSchema.parse(requestInput);
      const record = records.find(
        (candidate) =>
          candidate.videoId === request.videoId &&
          candidate.rightsAuthorization.basis === request.rightsAuthorization.basis &&
          candidate.rightsAuthorization.reference === request.rightsAuthorization.reference &&
          candidate.platformDownloadAuthorization.reference ===
            request.platformDownloadAuthorization.reference,
      );
      if (record === undefined) {
        throw new YouTubeMediaAuthorizationError('authorization_required');
      }
      const nowMs = (options.now?.() ?? new Date()).getTime();
      const validFromMs = Date.parse(record.validFrom);
      const expiresAtMs = Date.parse(record.expiresAt);
      const confirmations = [
        Date.parse(request.rightsAuthorization.confirmedAt),
        Date.parse(request.platformDownloadAuthorization.confirmedAt),
      ];
      if (!Number.isFinite(nowMs) || nowMs < validFromMs - maximumClockSkewMs) {
        throw new YouTubeMediaAuthorizationError('authorization_required');
      }
      if (
        nowMs >= expiresAtMs ||
        confirmations.some(
          (confirmedAtMs) =>
            confirmedAtMs < validFromMs ||
            confirmedAtMs >= expiresAtMs ||
            confirmedAtMs > nowMs + maximumClockSkewMs ||
            nowMs - confirmedAtMs > maximumConfirmationAgeMs,
        )
      ) {
        throw new YouTubeMediaAuthorizationError('authorization_expired');
      }
    },
  };
}
