import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import {
  procedureAuthoringPromptAcquisitionFormatVersion,
  procedureAuthoringPromptFormatVersion,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringTutorialTranscriptDocumentSchema,
  procedureAuthoringYoutubeCaptionTrackIdSchema,
  procedureAuthoringYoutubeVideoIdSchema,
} from './procedure-authoring.js';

export const procedureTutorialYoutubeImportLegacyFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeImportFormatVersion = '1.1.0' as const;
export const procedureTutorialYoutubeImportFormatVersionSchema = z.enum([
  procedureTutorialYoutubeImportLegacyFormatVersion,
  procedureTutorialYoutubeImportFormatVersion,
]);
export const procedureTutorialYoutubeTrackListFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackListFormatVersionSchema = z.literal(
  procedureTutorialYoutubeTrackListFormatVersion,
);
export const procedureTutorialYoutubeTrackRecommendationFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackRecommendationFormatVersionSchema = z.literal(
  procedureTutorialYoutubeTrackRecommendationFormatVersion,
);
export const procedureTutorialYoutubeTrackSelectionFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackSelectionFormatVersionSchema = z.literal(
  procedureTutorialYoutubeTrackSelectionFormatVersion,
);
export const procedureTutorialYoutubeTrackSelectionResultLegacyFormatVersion = '1.0.0' as const;
export const procedureTutorialYoutubeTrackSelectionResultFormatVersion = '1.1.0' as const;
export const procedureTutorialYoutubeTrackSelectionResultFormatVersionSchema = z.enum([
  procedureTutorialYoutubeTrackSelectionResultLegacyFormatVersion,
  procedureTutorialYoutubeTrackSelectionResultFormatVersion,
]);
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

const procedureTutorialYoutubeImportRequestCommonShape = {
  requestId: z.uuid(),
  targetAdapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
  actionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.actionCatalogVersion,
  interactionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.interactionCatalogVersion,
  goal: procedureAuthoringPromptRequestSchema.shape.goal,
  treeId: procedureAuthoringPromptRequestSchema.shape.treeId,
  revision: procedureAuthoringPromptRequestSchema.shape.revision,
  locale: procedureAuthoringPromptRequestSchema.shape.locale,
  youtube: procedureTutorialYoutubeSourceSchema,
} as const;

const procedureTutorialYoutubeImportLegacyRequestSchema = z.strictObject({
  formatVersion: z.literal(procedureTutorialYoutubeImportLegacyFormatVersion),
  ...procedureTutorialYoutubeImportRequestCommonShape,
});
export const procedureTutorialYoutubeImportCurrentRequestSchema = z.strictObject({
  formatVersion: z.literal(procedureTutorialYoutubeImportFormatVersion),
  ...procedureTutorialYoutubeImportRequestCommonShape,
  selectionRequestId: z.uuid(),
});
export type ProcedureTutorialYoutubeImportCurrentRequest = z.infer<
  typeof procedureTutorialYoutubeImportCurrentRequestSchema
>;

export const procedureTutorialYoutubeImportRequestSchema = z.discriminatedUnion('formatVersion', [
  procedureTutorialYoutubeImportLegacyRequestSchema,
  procedureTutorialYoutubeImportCurrentRequestSchema,
]);
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

const procedureTutorialYoutubeTrackSelectionStandardReasonCodeSchema = z.enum([
  'recommended_candidate',
  'language_preference',
  'caption_quality_review',
  'accessibility_requirement',
  'workflow_requirement',
]);

export const procedureTutorialYoutubeTrackSelectionReasonSchema = z.union([
  z.strictObject({
    reasonCode: procedureTutorialYoutubeTrackSelectionStandardReasonCodeSchema,
    note: z.string().min(1).max(1_000).regex(/\S/).optional(),
  }),
  z.strictObject({
    reasonCode: z.literal('other'),
    note: z.string().min(1).max(1_000).regex(/\S/),
  }),
]);
export type ProcedureTutorialYoutubeTrackSelectionReason = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionReasonSchema
>;

export const procedureTutorialYoutubeTrackSelectionRequestSchema = z.strictObject({
  formatVersion: procedureTutorialYoutubeTrackSelectionFormatVersionSchema,
  requestId: z.uuid(),
  trackListRequestId: z.uuid(),
  videoId: procedureAuthoringYoutubeVideoIdSchema,
  captionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema,
  confirmation: z.strictObject({
    explicitlyConfirmedByUser: z.literal(true),
    reason: procedureTutorialYoutubeTrackSelectionReasonSchema,
  }),
  recommendationPreferences:
    procedureTutorialYoutubeTrackRecommendationPreferencesSchema.optional(),
});
export type ProcedureTutorialYoutubeTrackSelectionRequest = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionRequestSchema
>;

const procedureTutorialYoutubeTrackSelectionResultCommonShape = {
  requestId: z.uuid(),
  sourceTrackList: z.strictObject({
    requestId: z.uuid(),
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    listedAt: z.iso.datetime({ offset: true }),
  }),
  selectedTrack: procedureTutorialYoutubeCaptionTrackSchema,
  confirmation: procedureTutorialYoutubeTrackSelectionRequestSchema.shape.confirmation,
  recommendation: z
    .strictObject({
      preferences: procedureTutorialYoutubeTrackRecommendationPreferencesSchema,
      recommendedCaptionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema.nullable(),
      selectedCandidateRank: z.number().int().positive().nullable(),
      selectedTrackWasRecommended: z.boolean(),
    })
    .nullable(),
  sideEffects: z.strictObject({
    captionTrackSelectionRecorded: z.literal(true),
    networkFetched: z.literal(false),
    additionalQuotaUnits: z.literal(0),
    captionContentDownloaded: z.literal(false),
    videoMediaDownloaded: z.literal(false),
    modelCalled: z.literal(false),
    procedureStored: z.literal(false),
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
  }),
  recordedAt: z.iso.datetime({ offset: true }),
} as const;

const procedureTutorialYoutubeTrackSelectionLegacyResultSchema = z.strictObject({
  formatVersion: z.literal(procedureTutorialYoutubeTrackSelectionResultLegacyFormatVersion),
  ...procedureTutorialYoutubeTrackSelectionResultCommonShape,
});
export const procedureTutorialYoutubeTrackSelectionCurrentResultSchema = z.strictObject({
  formatVersion: z.literal(procedureTutorialYoutubeTrackSelectionResultFormatVersion),
  requestFingerprint: evalContentSha256Schema,
  ...procedureTutorialYoutubeTrackSelectionResultCommonShape,
});
export type ProcedureTutorialYoutubeTrackSelectionCurrentResult = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionCurrentResultSchema
>;

export const procedureTutorialYoutubeTrackSelectionResultSchema = z
  .discriminatedUnion('formatVersion', [
    procedureTutorialYoutubeTrackSelectionLegacyResultSchema,
    procedureTutorialYoutubeTrackSelectionCurrentResultSchema,
  ])
  .superRefine((result, context) => {
    if (result.selectedTrack.status !== 'serving') {
      context.addIssue({
        code: 'custom',
        path: ['selectedTrack', 'status'],
        message: 'Recorded YouTube caption track selection must be serving',
      });
    }
    if (
      result.recommendation !== null &&
      result.recommendation.selectedTrackWasRecommended !==
        (result.recommendation.recommendedCaptionTrackId === result.selectedTrack.captionTrackId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'selectedTrackWasRecommended'],
        message: 'YouTube caption selection recommendation outcome is inconsistent',
      });
    }
    if (
      result.confirmation.reason.reasonCode === 'recommended_candidate' &&
      (result.recommendation === null || !result.recommendation.selectedTrackWasRecommended)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['confirmation', 'reason', 'reasonCode'],
        message: 'A recommended-candidate selection must attest the selected first candidate',
      });
    }
    if (
      result.recommendation?.selectedTrackWasRecommended === true &&
      result.recommendation.selectedCandidateRank !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'selectedCandidateRank'],
        message: 'The recommended YouTube caption track must have rank 1',
      });
    }
  });
export type ProcedureTutorialYoutubeTrackSelectionResult = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionResultSchema
>;

export const procedureTutorialYoutubeTrackSelectionErrorCodeSchema = z.enum([
  'youtube_track_selection_source_not_found',
  'youtube_track_selection_source_mismatch',
  'youtube_track_selection_track_not_found',
  'youtube_track_selection_track_not_importable',
  'youtube_track_selection_recommendation_mismatch',
  'youtube_track_selection_conflict',
  'youtube_track_selection_persistence_failed',
  'youtube_track_selection_invalid',
]);
export type ProcedureTutorialYoutubeTrackSelectionErrorCode = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionErrorCodeSchema
>;

export const procedureTutorialYoutubeTrackSelectionCompletedEventSchema = z
  .strictObject({
    request: procedureTutorialYoutubeTrackSelectionRequestSchema,
    requestFingerprint: evalContentSha256Schema,
    result: procedureTutorialYoutubeTrackSelectionResultSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((event, context) => {
    if (
      event.result.requestId !== event.request.requestId ||
      (event.result.formatVersion === procedureTutorialYoutubeTrackSelectionResultFormatVersion &&
        event.result.requestFingerprint !== event.requestFingerprint) ||
      event.result.sourceTrackList.requestId !== event.request.trackListRequestId ||
      event.result.sourceTrackList.videoId !== event.request.videoId ||
      event.result.selectedTrack.captionTrackId !== event.request.captionTrackId ||
      event.result.recordedAt !== event.occurredAt ||
      event.result.confirmation.explicitlyConfirmedByUser !==
        event.request.confirmation.explicitlyConfirmedByUser ||
      event.result.confirmation.reason.reasonCode !==
        event.request.confirmation.reason.reasonCode ||
      event.result.confirmation.reason.note !== event.request.confirmation.reason.note ||
      (event.request.recommendationPreferences === undefined) !==
        (event.result.recommendation === null) ||
      (event.request.recommendationPreferences !== undefined &&
        event.result.recommendation !== null &&
        JSON.stringify(event.result.recommendation.preferences) !==
          JSON.stringify(event.request.recommendationPreferences))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed YouTube caption track selection evidence must match its exact request',
      });
    }
  });
export type ProcedureTutorialYoutubeTrackSelectionCompletedEvent = z.infer<
  typeof procedureTutorialYoutubeTrackSelectionCompletedEventSchema
>;

export const procedureTutorialYoutubeTrackListErrorCodeSchema = z.enum([
  'youtube_track_list_unavailable',
  'youtube_authentication_required',
  'youtube_source_unauthorized',
  'youtube_source_quota_exceeded',
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
  'youtube_import_legacy_request_unsupported',
  'youtube_import_selection_not_found',
  'youtube_import_selection_mismatch',
  'youtube_source_unavailable',
  'youtube_authentication_required',
  'youtube_source_unauthorized',
  'youtube_source_quota_exceeded',
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
  selectionRequestId: z.uuid().nullable().optional(),
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
    const selection = acquisition?.selection;
    const request = event.request;
    const selectionRequestId =
      request.formatVersion === procedureTutorialYoutubeImportFormatVersion
        ? request.selectionRequestId
        : null;
    const expectedPacketFormatVersion =
      selectionRequestId === null
        ? procedureAuthoringPromptAcquisitionFormatVersion
        : procedureAuthoringPromptFormatVersion;
    if (
      packet.formatVersion !== expectedPacketFormatVersion ||
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
      (selectionRequestId === null) !== (selection === undefined) ||
      (selectionRequestId !== null && selection?.requestId !== selectionRequestId) ||
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
