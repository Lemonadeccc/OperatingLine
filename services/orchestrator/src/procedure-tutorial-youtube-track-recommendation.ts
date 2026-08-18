import {
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
  procedureTutorialYoutubeTrackRecommendationResultSchema,
  type ProcedureTutorialYoutubeCaptionTrack,
  type ProcedureTutorialYoutubeTrackListResult,
  type ProcedureTutorialYoutubeTrackRecommendationCandidate,
  type ProcedureTutorialYoutubeTrackRecommendationErrorCode,
  type ProcedureTutorialYoutubeTrackRecommendationExcludedTrack,
  type ProcedureTutorialYoutubeTrackRecommendationPreferences,
  type ProcedureTutorialYoutubeTrackRecommendationRequest,
  type ProcedureTutorialYoutubeTrackRecommendationResult,
} from '@operatingline/protocol';

export type ProcedureTutorialYoutubeTrackRecommendationRetryMode = 'same_request_id' | 'never';

export class ProcedureTutorialYoutubeTrackRecommendationError extends Error {
  constructor(
    readonly code: ProcedureTutorialYoutubeTrackRecommendationErrorCode,
    message: string,
    readonly retryMode: ProcedureTutorialYoutubeTrackRecommendationRetryMode,
  ) {
    super(message);
    this.name = 'ProcedureTutorialYoutubeTrackRecommendationError';
  }
}

type LanguageMatch =
  | {
      readonly kind: 'exact' | 'primary_subtag';
      readonly preferenceIndex: number;
      readonly category: 0 | 1;
    }
  | {
      readonly kind: 'unlisted';
      readonly preferenceIndex: null;
      readonly category: 2;
    };

interface CandidateForSorting {
  readonly track: ProcedureTutorialYoutubeCaptionTrack;
  readonly languageMatch: LanguageMatch;
  readonly trackKindPreferenceIndex: number;
  readonly audioTrackTypePreferenceIndex: number;
  readonly draftPenalty: 0 | 1;
  readonly closedCaptionPenalty: 0 | 1;
  readonly automaticSyncPenalty: 0 | 1;
}

function asciiCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function primaryLanguageSubtag(language: string): string {
  return language.toLowerCase().split('-', 1)[0]!;
}

function matchLanguage(
  language: string,
  preferences: ProcedureTutorialYoutubeTrackRecommendationPreferences,
): LanguageMatch | null {
  const normalizedLanguage = language.toLowerCase();
  const normalizedPreferences = preferences.preferredLanguages.map((preferred) =>
    preferred.toLowerCase(),
  );
  const exactIndex = normalizedPreferences.indexOf(normalizedLanguage);
  if (exactIndex >= 0) {
    return { kind: 'exact', preferenceIndex: exactIndex, category: 0 };
  }
  if (preferences.languageMatching === 'primary_subtag_fallback') {
    const primary = primaryLanguageSubtag(normalizedLanguage);
    const primaryIndex = normalizedPreferences.findIndex(
      (preferred) => primaryLanguageSubtag(preferred) === primary,
    );
    if (primaryIndex >= 0) {
      return { kind: 'primary_subtag', preferenceIndex: primaryIndex, category: 1 };
    }
  }
  return preferences.allowUnlistedLanguages
    ? { kind: 'unlisted', preferenceIndex: null, category: 2 }
    : null;
}

function compareCandidates(left: CandidateForSorting, right: CandidateForSorting): number {
  const leftLanguageIndex = left.languageMatch.preferenceIndex ?? Number.MAX_SAFE_INTEGER;
  const rightLanguageIndex = right.languageMatch.preferenceIndex ?? Number.MAX_SAFE_INTEGER;
  const comparisons = [
    left.languageMatch.category - right.languageMatch.category,
    leftLanguageIndex - rightLanguageIndex,
    left.trackKindPreferenceIndex - right.trackKindPreferenceIndex,
    left.audioTrackTypePreferenceIndex - right.audioTrackTypePreferenceIndex,
    left.draftPenalty - right.draftPenalty,
    left.closedCaptionPenalty - right.closedCaptionPenalty,
    left.automaticSyncPenalty - right.automaticSyncPenalty,
  ];
  for (const comparison of comparisons) {
    if (comparison !== 0) return comparison;
  }
  return asciiCompare(left.track.captionTrackId, right.track.captionTrackId);
}

function recommendableTrack(
  track: ProcedureTutorialYoutubeCaptionTrack,
  preferences: ProcedureTutorialYoutubeTrackRecommendationPreferences,
): CandidateForSorting | ProcedureTutorialYoutubeTrackRecommendationExcludedTrack {
  const reasons: ProcedureTutorialYoutubeTrackRecommendationExcludedTrack['reasons'][number][] = [];
  if (track.status !== 'serving') reasons.push('not_serving');
  if (track.isDraft && !preferences.allowDraftTracks) reasons.push('draft_disallowed');
  const languageMatch = matchLanguage(track.language, preferences);
  if (languageMatch === null) reasons.push('language_not_allowed');
  const trackKindPreferenceIndex = preferences.trackKindPriority.indexOf(track.trackKind);
  if (trackKindPreferenceIndex < 0) reasons.push('track_kind_not_allowed');
  const audioTrackTypePreferenceIndex = preferences.audioTrackTypePriority.indexOf(
    track.audioTrackType,
  );
  if (audioTrackTypePreferenceIndex < 0) reasons.push('audio_track_type_not_allowed');

  if (
    reasons.length > 0 ||
    languageMatch === null ||
    trackKindPreferenceIndex < 0 ||
    audioTrackTypePreferenceIndex < 0
  ) {
    return { track: structuredClone(track), reasons };
  }
  return {
    track: structuredClone(track),
    languageMatch,
    trackKindPreferenceIndex,
    audioTrackTypePreferenceIndex,
    draftPenalty: track.isDraft ? 1 : 0,
    closedCaptionPenalty: preferences.preferClosedCaptions && !track.isCC ? 1 : 0,
    automaticSyncPenalty: preferences.preferManualSync && track.isAutoSynced ? 1 : 0,
  };
}

function isExcludedTrack(
  track: CandidateForSorting | ProcedureTutorialYoutubeTrackRecommendationExcludedTrack,
): track is ProcedureTutorialYoutubeTrackRecommendationExcludedTrack {
  return 'reasons' in track;
}

function safeRecommendationError(error: unknown): ProcedureTutorialYoutubeTrackRecommendationError {
  if (error instanceof ProcedureTutorialYoutubeTrackRecommendationError) return error;
  return new ProcedureTutorialYoutubeTrackRecommendationError(
    'youtube_track_recommendation_invalid',
    'YouTube caption track recommendation could not satisfy the strict result contract',
    'never',
  );
}

export function recommendProcedureTutorialYoutubeCaptionTracks(
  requestInput: ProcedureTutorialYoutubeTrackRecommendationRequest,
  sourceInput: ProcedureTutorialYoutubeTrackListResult | null,
): ProcedureTutorialYoutubeTrackRecommendationResult {
  try {
    const request = procedureTutorialYoutubeTrackRecommendationRequestSchema.parse(requestInput);
    if (sourceInput === null) {
      throw new ProcedureTutorialYoutubeTrackRecommendationError(
        'youtube_track_recommendation_source_not_found',
        `Completed YouTube caption track list ${request.trackListRequestId} was not found`,
        'same_request_id',
      );
    }
    const source = procedureTutorialYoutubeTrackListResultSchema.parse(sourceInput);
    if (source.requestId !== request.trackListRequestId || source.videoId !== request.videoId) {
      throw new ProcedureTutorialYoutubeTrackRecommendationError(
        'youtube_track_recommendation_source_mismatch',
        'YouTube caption track recommendation source identity does not match its request',
        'never',
      );
    }

    const candidates: CandidateForSorting[] = [];
    const excludedTracks: ProcedureTutorialYoutubeTrackRecommendationExcludedTrack[] = [];
    for (const track of source.tracks) {
      const recommendation = recommendableTrack(track, request.preferences);
      if (isExcludedTrack(recommendation)) excludedTracks.push(recommendation);
      else candidates.push(recommendation);
    }
    candidates.sort(compareCandidates);
    excludedTracks.sort((left, right) =>
      asciiCompare(left.track.captionTrackId, right.track.captionTrackId),
    );

    const rankedCandidates: ProcedureTutorialYoutubeTrackRecommendationCandidate[] = candidates.map(
      (candidate, index) => ({
        rank: index + 1,
        track: candidate.track,
        rankingSignals: {
          languageMatch: candidate.languageMatch.kind,
          languagePreferenceIndex: candidate.languageMatch.preferenceIndex,
          trackKindPreferenceIndex: candidate.trackKindPreferenceIndex,
          audioTrackTypePreferenceIndex: candidate.audioTrackTypePreferenceIndex,
          draftPenalty: candidate.draftPenalty,
          closedCaptionPenalty: candidate.closedCaptionPenalty,
          automaticSyncPenalty: candidate.automaticSyncPenalty,
        },
      }),
    );

    return procedureTutorialYoutubeTrackRecommendationResultSchema.parse({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      sourceTrackList: {
        requestId: source.requestId,
        videoId: source.videoId,
        listedAt: source.listedAt,
        trackCount: source.tracks.length,
      },
      preferences: request.preferences,
      recommendedCaptionTrackId: rankedCandidates[0]?.track.captionTrackId ?? null,
      rankedCandidates,
      excludedTracks,
      selection: {
        required: true,
        automaticallySelected: false,
        selectedCaptionTrackId: null,
      },
      sideEffects: {
        networkFetched: false,
        additionalQuotaUnits: 0,
        captionContentDownloaded: false,
        videoMediaDownloaded: false,
        modelCalled: false,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
    });
  } catch (error) {
    throw safeRecommendationError(error);
  }
}

export function procedureTutorialYoutubeTrackRecommendationHttpStatus(
  error: unknown,
): 404 | 409 | 422 {
  switch (safeRecommendationError(error).code) {
    case 'youtube_track_recommendation_source_not_found':
      return 404;
    case 'youtube_track_recommendation_source_mismatch':
      return 409;
    case 'youtube_track_recommendation_invalid':
      return 422;
  }
}

export function procedureTutorialYoutubeTrackRecommendationErrorResponse(
  error: unknown,
  requestId: string | null,
): {
  readonly error: ProcedureTutorialYoutubeTrackRecommendationErrorCode;
  readonly requestId: string | null;
  readonly message: string;
  readonly retryMode: ProcedureTutorialYoutubeTrackRecommendationRetryMode;
} {
  const safeError = safeRecommendationError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}
