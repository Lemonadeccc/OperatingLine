import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import {
  procedureAuthoringPromptFormatVersion,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringTutorialTranscriptDocumentSchema,
  procedureAuthoringYoutubeCaptionTrackIdSchema,
  procedureAuthoringYoutubeVideoIdSchema,
} from './procedure-authoring.js';

export const procedureTutorialYoutubeImportFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeImportFormatVersionSchema = z.literal(
  procedureTutorialYoutubeImportFormatVersion,
);
export const procedureTutorialYoutubeTrackListFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackListFormatVersionSchema = z.literal(
  procedureTutorialYoutubeTrackListFormatVersion,
);
export const procedureTutorialYoutubeCaptionTrackMaxCount = 2_000 as const;

export const procedureTutorialYoutubeAuthorizationSchema = z.strictObject({
  networkFetchApproved: z.literal(true),
  quotaCostAcknowledged: z.literal(true),
  videoEditPermissionExpected: z.literal(true),
});

const youtubeImportCommonShape = {
  videoId: procedureAuthoringYoutubeVideoIdSchema,
  captionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema,
  requestedFormat: procedureAuthoringTutorialTranscriptDocumentSchema.shape.format,
  expectedTrackLanguage: z.string().min(1).max(64).regex(/^\S+$/).optional(),
  defaultConfidence:
    procedureAuthoringTutorialTranscriptDocumentSchema.shape.confidence.shape.value,
  authorization: procedureTutorialYoutubeAuthorizationSchema,
} as const;

const procedureTutorialYoutubeSourceSchema = z.discriminatedUnion('rightsStatus', [
  z.strictObject({
    ...youtubeImportCommonShape,
    rightsStatus: z.literal('permission_granted'),
    license: z.string().min(1).max(1_000).regex(/\S/).optional(),
  }),
  z.strictObject({
    ...youtubeImportCommonShape,
    rightsStatus: z.literal('license_verified'),
    license: z.string().min(1).max(1_000).regex(/\S/),
  }),
  z.strictObject({
    ...youtubeImportCommonShape,
    rightsStatus: z.literal('public_domain'),
    license: z.string().min(1).max(1_000).regex(/\S/).optional(),
  }),
]);

export const procedureTutorialYoutubeImportRequestSchema = z.strictObject({
  formatVersion: procedureTutorialYoutubeImportFormatVersionSchema,
  requestId: z.uuid(),
  targetAdapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
  actionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.actionCatalogVersion,
  interactionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.interactionCatalogVersion,
  goal: procedureAuthoringPromptRequestSchema.shape.goal,
  treeId: procedureAuthoringPromptRequestSchema.shape.treeId,
  revision: procedureAuthoringPromptRequestSchema.shape.revision,
  locale: procedureAuthoringPromptRequestSchema.shape.locale,
  youtube: procedureTutorialYoutubeSourceSchema,
});
export type ProcedureTutorialYoutubeImportRequest = z.infer<
  typeof procedureTutorialYoutubeImportRequestSchema
>;

export const procedureTutorialYoutubeTrackListRequestSchema = z.strictObject({
  formatVersion: procedureTutorialYoutubeTrackListFormatVersionSchema,
  requestId: z.uuid(),
  youtube: z.strictObject({
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    authorization: procedureTutorialYoutubeAuthorizationSchema,
  }),
});
export type ProcedureTutorialYoutubeTrackListRequest = z.infer<
  typeof procedureTutorialYoutubeTrackListRequestSchema
>;

export const procedureTutorialYoutubeCaptionTrackFailureReasonSchema = z.enum([
  'processingFailed',
  'unknownFormat',
  'unsupportedFormat',
]);

const youtubeCaptionTrackCommonShape = {
  captionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema,
  lastUpdated: z.iso.datetime({ offset: true }),
  trackKind: z.enum(['ASR', 'forced', 'standard']),
  language: z.string().min(1).max(64).regex(/^\S+$/),
  name: z.string().max(150),
  audioTrackType: z.enum(['commentary', 'descriptive', 'primary', 'unknown']),
  isCC: z.boolean(),
  isLarge: z.boolean(),
  isEasyReader: z.boolean(),
  isDraft: z.boolean(),
  isAutoSynced: z.boolean(),
} as const;

export const procedureTutorialYoutubeCaptionTrackSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...youtubeCaptionTrackCommonShape, status: z.literal('serving') }),
  z.strictObject({ ...youtubeCaptionTrackCommonShape, status: z.literal('syncing') }),
  z.strictObject({
    ...youtubeCaptionTrackCommonShape,
    status: z.literal('failed'),
    failureReason: procedureTutorialYoutubeCaptionTrackFailureReasonSchema.optional(),
  }),
]);
export type ProcedureTutorialYoutubeCaptionTrack = z.infer<
  typeof procedureTutorialYoutubeCaptionTrackSchema
>;

export const procedureTutorialYoutubeTrackListResultSchema = z
  .strictObject({
    formatVersion: procedureTutorialYoutubeTrackListFormatVersionSchema,
    requestId: z.uuid(),
    source: z.literal('youtube_data_api_v3'),
    authorization: z.literal('oauth_video_edit_permission'),
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    tracks: z
      .array(procedureTutorialYoutubeCaptionTrackSchema)
      .max(procedureTutorialYoutubeCaptionTrackMaxCount),
    sideEffects: z.strictObject({
      networkFetched: z.literal(true),
      quotaOperation: z.literal('youtube.captions.list'),
      documentedQuotaUnits: z.literal(50),
      captionContentDownloaded: z.literal(false),
      videoMediaDownloaded: z.literal(false),
      modelCalled: z.literal(false),
      procedureStored: z.literal(false),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
    listedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((result, context) => {
    const trackIds = new Set<string>();
    for (const [index, track] of result.tracks.entries()) {
      if (trackIds.has(track.captionTrackId)) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'captionTrackId'],
          message: 'YouTube caption track ids must be unique within one list result',
        });
      }
      trackIds.add(track.captionTrackId);
    }
  });
export type ProcedureTutorialYoutubeTrackListResult = z.infer<
  typeof procedureTutorialYoutubeTrackListResultSchema
>;

export const procedureTutorialYoutubeTrackListErrorCodeSchema = z.enum([
  'youtube_track_list_unavailable',
  'youtube_source_unauthorized',
  'youtube_video_not_found',
  'youtube_source_failed',
  'youtube_track_list_invalid',
  'youtube_track_list_conflict',
  'youtube_track_list_already_attempted',
  'youtube_track_list_persistence_failed',
]);
export type ProcedureTutorialYoutubeTrackListErrorCode = z.infer<
  typeof procedureTutorialYoutubeTrackListErrorCodeSchema
>;

const procedureTutorialYoutubeTrackListEvidenceScopeSchema = z.strictObject({
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  videoId: procedureAuthoringYoutubeVideoIdSchema,
});

export const procedureTutorialYoutubeTrackListRequestedEventSchema =
  procedureTutorialYoutubeTrackListEvidenceScopeSchema.extend({
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureTutorialYoutubeTrackListRequestedEvent = z.infer<
  typeof procedureTutorialYoutubeTrackListRequestedEventSchema
>;
export const procedureTutorialYoutubeTrackListFailedEventSchema =
  procedureTutorialYoutubeTrackListEvidenceScopeSchema.extend({
    error: procedureTutorialYoutubeTrackListErrorCodeSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureTutorialYoutubeTrackListFailedEvent = z.infer<
  typeof procedureTutorialYoutubeTrackListFailedEventSchema
>;
export const procedureTutorialYoutubeTrackListCompletedEventSchema = z
  .strictObject({
    request: procedureTutorialYoutubeTrackListRequestSchema,
    requestFingerprint: evalContentSha256Schema,
    result: procedureTutorialYoutubeTrackListResultSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((event, context) => {
    if (
      event.result.requestId !== event.request.requestId ||
      event.result.videoId !== event.request.youtube.videoId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed YouTube caption track list evidence must match its exact request',
      });
    }
  });
export type ProcedureTutorialYoutubeTrackListCompletedEvent = z.infer<
  typeof procedureTutorialYoutubeTrackListCompletedEventSchema
>;

export const procedureTutorialYoutubeImportErrorCodeSchema = z.enum([
  'youtube_source_unavailable',
  'youtube_source_unauthorized',
  'youtube_video_not_found',
  'youtube_caption_not_found',
  'youtube_caption_not_ready',
  'youtube_caption_too_large',
  'youtube_source_failed',
  'youtube_packet_invalid',
  'youtube_import_conflict',
  'youtube_import_already_attempted',
  'youtube_import_persistence_failed',
]);
export type ProcedureTutorialYoutubeImportErrorCode = z.infer<
  typeof procedureTutorialYoutubeImportErrorCodeSchema
>;

const procedureTutorialYoutubeImportEvidenceScopeSchema = z.strictObject({
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  videoId: procedureAuthoringYoutubeVideoIdSchema,
  captionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema,
  requestedFormat: procedureAuthoringTutorialTranscriptDocumentSchema.shape.format,
});

export const procedureTutorialYoutubeImportRequestedEventSchema =
  procedureTutorialYoutubeImportEvidenceScopeSchema.extend({
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureTutorialYoutubeImportRequestedEvent = z.infer<
  typeof procedureTutorialYoutubeImportRequestedEventSchema
>;

export const procedureTutorialYoutubeImportFailedEventSchema =
  procedureTutorialYoutubeImportEvidenceScopeSchema.extend({
    error: procedureTutorialYoutubeImportErrorCodeSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureTutorialYoutubeImportFailedEvent = z.infer<
  typeof procedureTutorialYoutubeImportFailedEventSchema
>;

export const procedureTutorialYoutubeImportCompletedEventSchema = z
  .strictObject({
    request: procedureTutorialYoutubeImportRequestSchema,
    requestFingerprint: evalContentSha256Schema,
    packet: procedureAuthoringPromptPacketSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((event, context) => {
    const packet = event.packet;
    const packetContext = packet.context;
    const tutorial = packetContext.tutorialProvenance;
    const acquisition = tutorial?.transcript.document?.acquisition;
    const request = event.request;
    if (
      packet.formatVersion !== procedureAuthoringPromptFormatVersion ||
      packetContext.requestedTreeId !== request.treeId ||
      packetContext.recommendedRevision !== request.revision ||
      packetContext.catalogBinding.adapterId !== request.targetAdapterId ||
      packetContext.goalProvenance.source.text !== request.goal ||
      tutorial?.source.uri !== `https://www.youtube.com/watch?v=${request.youtube.videoId}` ||
      tutorial.source.rightsStatus !== request.youtube.rightsStatus ||
      tutorial.source.license !== request.youtube.license ||
      tutorial.transcript.origin !== 'youtube_data_api_v3' ||
      tutorial.transcript.document?.format !== request.youtube.requestedFormat ||
      tutorial.transcript.document.confidence.value !== request.youtube.defaultConfidence ||
      acquisition?.videoId !== request.youtube.videoId ||
      acquisition.captionTrackId !== request.youtube.captionTrackId ||
      acquisition.requestedFormat !== request.youtube.requestedFormat ||
      (request.youtube.expectedTrackLanguage !== undefined &&
        acquisition.trackLanguage !== request.youtube.expectedTrackLanguage) ||
      (request.actionCatalogVersion !== undefined &&
        packetContext.catalogBinding.actionCatalog.catalogVersion !==
          request.actionCatalogVersion) ||
      (request.interactionCatalogVersion !== undefined &&
        packetContext.catalogBinding.interactionCatalog.catalogVersion !==
          request.interactionCatalogVersion)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed YouTube caption import evidence must match its exact request',
      });
    }
  });
export type ProcedureTutorialYoutubeImportCompletedEvent = z.infer<
  typeof procedureTutorialYoutubeImportCompletedEventSchema
>;
