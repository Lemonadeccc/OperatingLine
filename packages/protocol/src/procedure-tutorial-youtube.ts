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
export const procedureTutorialYoutubeTrackRecommendationFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackRecommendationFormatVersionSchema = z.literal(
  procedureTutorialYoutubeTrackRecommendationFormatVersion,
);
export const procedureTutorialYoutubeCaptionTrackMaxCount = 2_000 as const;
export const procedureTutorialYoutubePreferredLanguageMaxCount = 32 as const;

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

const procedureTutorialYoutubeTrackKindSchema = z.enum(['ASR', 'forced', 'standard']);
const procedureTutorialYoutubeAudioTrackTypeSchema = z.enum([
  'commentary',
  'descriptive',
  'primary',
  'unknown',
]);

export const procedureTutorialYoutubeTrackRecommendationPreferencesSchema = z
  .strictObject({
    preferredLanguages: z
      .array(z.string().min(1).max(64).regex(/^\S+$/))
      .min(1)
      .max(procedureTutorialYoutubePreferredLanguageMaxCount),
    languageMatching: z.enum(['exact_only', 'primary_subtag_fallback']),
    allowUnlistedLanguages: z.boolean(),
    trackKindPriority: z.array(procedureTutorialYoutubeTrackKindSchema).min(1).max(3),
    audioTrackTypePriority: z.array(procedureTutorialYoutubeAudioTrackTypeSchema).min(1).max(4),
    allowDraftTracks: z.boolean(),
    preferClosedCaptions: z.boolean(),
    preferManualSync: z.boolean(),
    explicitSelectionRequired: z.literal(true),
  })
  .superRefine((preferences, context) => {
    const normalizedLanguages = preferences.preferredLanguages.map((language) =>
      language.toLowerCase(),
    );
    if (new Set(normalizedLanguages).size !== normalizedLanguages.length) {
      context.addIssue({
        code: 'custom',
        path: ['preferredLanguages'],
        message: 'Preferred YouTube caption languages must be unique case-insensitively',
      });
    }
    if (new Set(preferences.trackKindPriority).size !== preferences.trackKindPriority.length) {
      context.addIssue({
        code: 'custom',
        path: ['trackKindPriority'],
        message: 'YouTube caption track-kind priorities must be unique',
      });
    }
    if (
      new Set(preferences.audioTrackTypePriority).size !== preferences.audioTrackTypePriority.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audioTrackTypePriority'],
        message: 'YouTube caption audio-track priorities must be unique',
      });
    }
  });
export type ProcedureTutorialYoutubeTrackRecommendationPreferences = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationPreferencesSchema
>;

export const procedureTutorialYoutubeTrackRecommendationRequestSchema = z.strictObject({
  formatVersion: procedureTutorialYoutubeTrackRecommendationFormatVersionSchema,
  requestId: z.uuid(),
  trackListRequestId: z.uuid(),
  videoId: procedureAuthoringYoutubeVideoIdSchema,
  preferences: procedureTutorialYoutubeTrackRecommendationPreferencesSchema,
});
export type ProcedureTutorialYoutubeTrackRecommendationRequest = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationRequestSchema
>;

export const procedureTutorialYoutubeTrackRecommendationLanguageMatchSchema = z.enum([
  'exact',
  'primary_subtag',
  'unlisted',
]);

export const procedureTutorialYoutubeTrackRecommendationCandidateSchema = z.strictObject({
  rank: z.number().int().positive(),
  track: procedureTutorialYoutubeCaptionTrackSchema,
  rankingSignals: z.strictObject({
    languageMatch: procedureTutorialYoutubeTrackRecommendationLanguageMatchSchema,
    languagePreferenceIndex: z.number().int().nonnegative().nullable(),
    trackKindPreferenceIndex: z.number().int().nonnegative(),
    audioTrackTypePreferenceIndex: z.number().int().nonnegative(),
    draftPenalty: z.union([z.literal(0), z.literal(1)]),
    closedCaptionPenalty: z.union([z.literal(0), z.literal(1)]),
    automaticSyncPenalty: z.union([z.literal(0), z.literal(1)]),
  }),
});
export type ProcedureTutorialYoutubeTrackRecommendationCandidate = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationCandidateSchema
>;

export const procedureTutorialYoutubeTrackRecommendationExclusionReasonSchema = z.enum([
  'not_serving',
  'draft_disallowed',
  'language_not_allowed',
  'track_kind_not_allowed',
  'audio_track_type_not_allowed',
]);

export const procedureTutorialYoutubeTrackRecommendationExcludedTrackSchema = z.strictObject({
  track: procedureTutorialYoutubeCaptionTrackSchema,
  reasons: z.array(procedureTutorialYoutubeTrackRecommendationExclusionReasonSchema).min(1).max(5),
});
export type ProcedureTutorialYoutubeTrackRecommendationExcludedTrack = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationExcludedTrackSchema
>;

export const procedureTutorialYoutubeTrackRecommendationResultSchema = z
  .strictObject({
    formatVersion: procedureTutorialYoutubeTrackRecommendationFormatVersionSchema,
    requestId: z.uuid(),
    sourceTrackList: z.strictObject({
      requestId: z.uuid(),
      videoId: procedureAuthoringYoutubeVideoIdSchema,
      listedAt: z.iso.datetime({ offset: true }),
      trackCount: z.number().int().nonnegative().max(procedureTutorialYoutubeCaptionTrackMaxCount),
    }),
    preferences: procedureTutorialYoutubeTrackRecommendationPreferencesSchema,
    recommendedCaptionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema.nullable(),
    rankedCandidates: z
      .array(procedureTutorialYoutubeTrackRecommendationCandidateSchema)
      .max(procedureTutorialYoutubeCaptionTrackMaxCount),
    excludedTracks: z
      .array(procedureTutorialYoutubeTrackRecommendationExcludedTrackSchema)
      .max(procedureTutorialYoutubeCaptionTrackMaxCount),
    selection: z.strictObject({
      required: z.literal(true),
      automaticallySelected: z.literal(false),
      selectedCaptionTrackId: z.null(),
    }),
    sideEffects: z.strictObject({
      networkFetched: z.literal(false),
      additionalQuotaUnits: z.literal(0),
      captionContentDownloaded: z.literal(false),
      videoMediaDownloaded: z.literal(false),
      modelCalled: z.literal(false),
      procedureStored: z.literal(false),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
  })
  .superRefine((result, context) => {
    const seenTrackIds = new Set<string>();
    for (const [index, candidate] of result.rankedCandidates.entries()) {
      if (candidate.rank !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['rankedCandidates', index, 'rank'],
          message: 'YouTube caption recommendation ranks must be consecutive and ordered',
        });
      }
      if (seenTrackIds.has(candidate.track.captionTrackId)) {
        context.addIssue({
          code: 'custom',
          path: ['rankedCandidates', index, 'track', 'captionTrackId'],
          message: 'YouTube caption recommendation track ids must be unique',
        });
      }
      seenTrackIds.add(candidate.track.captionTrackId);
    }
    for (const [index, excluded] of result.excludedTracks.entries()) {
      if (seenTrackIds.has(excluded.track.captionTrackId)) {
        context.addIssue({
          code: 'custom',
          path: ['excludedTracks', index, 'track', 'captionTrackId'],
          message: 'YouTube caption recommendation track ids must be unique',
        });
      }
      seenTrackIds.add(excluded.track.captionTrackId);
    }
    if (seenTrackIds.size > procedureTutorialYoutubeCaptionTrackMaxCount) {
      context.addIssue({
        code: 'custom',
        message: 'YouTube caption recommendation exceeds the source track limit',
      });
    }
    if (seenTrackIds.size !== result.sourceTrackList.trackCount) {
      context.addIssue({
        code: 'custom',
        path: ['sourceTrackList', 'trackCount'],
        message: 'YouTube caption recommendation must account for every source track exactly once',
      });
    }
    const expectedRecommendation = result.rankedCandidates[0]?.track.captionTrackId ?? null;
    if (result.recommendedCaptionTrackId !== expectedRecommendation) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedCaptionTrackId'],
        message: 'YouTube caption recommendation must reference the first ranked candidate',
      });
    }
  });
export type ProcedureTutorialYoutubeTrackRecommendationResult = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationResultSchema
>;

export const procedureTutorialYoutubeTrackRecommendationErrorCodeSchema = z.enum([
  'youtube_track_recommendation_source_not_found',
  'youtube_track_recommendation_source_mismatch',
  'youtube_track_recommendation_invalid',
]);
export type ProcedureTutorialYoutubeTrackRecommendationErrorCode = z.infer<
  typeof procedureTutorialYoutubeTrackRecommendationErrorCodeSchema
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
