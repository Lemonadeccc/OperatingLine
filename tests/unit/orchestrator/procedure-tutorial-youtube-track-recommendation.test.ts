import {
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  recommendProcedureTutorialYoutubeCaptionTracks,
  procedureTutorialYoutubeTrackRecommendationErrorResponse,
  procedureTutorialYoutubeTrackRecommendationHttpStatus,
} from '../../../services/orchestrator/src/procedure-tutorial-youtube-track-recommendation.js';

const trackList = procedureTutorialYoutubeTrackListResultSchema.parse({
  formatVersion: '1.0.0',
  requestId: '09a14ff8-cb41-4b0a-bca9-89c64ca30351',
  source: 'youtube_data_api_v3',
  authorization: 'oauth_video_edit_permission',
  videoId: 'dQw4w9WgXcQ',
  tracks: [
    {
      captionTrackId: 'standard-en-gb',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en-GB',
      name: 'English (United Kingdom)',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
    },
    {
      captionTrackId: 'asr-en-us',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'ASR',
      language: 'en-US',
      name: 'English (automatic)',
      audioTrackType: 'primary',
      isCC: false,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: true,
      status: 'serving',
    },
    {
      captionTrackId: 'standard-zh-hans',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'zh-Hans',
      name: '简体中文',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
    },
    {
      captionTrackId: 'draft-en-us',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en-US',
      name: 'Draft English',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: true,
      isAutoSynced: false,
      status: 'serving',
    },
    {
      captionTrackId: 'forced-en-us',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'forced',
      language: 'en-US',
      name: 'Forced English',
      audioTrackType: 'primary',
      isCC: false,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
    },
    {
      captionTrackId: 'syncing-en-us',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en-US',
      name: 'Syncing English',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'syncing',
    },
  ],
  sideEffects: {
    networkFetched: true,
    quotaOperation: 'youtube.captions.list',
    documentedQuotaUnits: 50,
    captionContentDownloaded: false,
    videoMediaDownloaded: false,
    modelCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  listedAt: '2026-08-18T09:00:00Z',
});

const request = procedureTutorialYoutubeTrackRecommendationRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: '34193133-f3b0-4382-abfe-2c88434c3679',
  trackListRequestId: trackList.requestId,
  videoId: trackList.videoId,
  preferences: {
    preferredLanguages: ['en-US', 'zh-CN'],
    languageMatching: 'primary_subtag_fallback',
    allowUnlistedLanguages: false,
    trackKindPriority: ['standard', 'ASR'],
    audioTrackTypePriority: ['primary'],
    allowDraftTracks: false,
    preferClosedCaptions: true,
    preferManualSync: true,
    explicitSelectionRequired: true,
  },
});

describe('authorized YouTube caption track recommendation', () => {
  it('ranks eligible tracks deterministically and explains every exclusion without side effects', () => {
    const first = recommendProcedureTutorialYoutubeCaptionTracks(request, trackList);
    const second = recommendProcedureTutorialYoutubeCaptionTracks(request, trackList);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      sourceTrackList: {
        requestId: trackList.requestId,
        videoId: trackList.videoId,
        listedAt: trackList.listedAt,
      },
      recommendedCaptionTrackId: 'asr-en-us',
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
    expect(first.rankedCandidates.map(({ track }) => track.captionTrackId)).toEqual([
      'asr-en-us',
      'standard-en-gb',
      'standard-zh-hans',
    ]);
    expect(first.rankedCandidates.map(({ rank }) => rank)).toEqual([1, 2, 3]);
    expect(first.rankedCandidates[0]?.rankingSignals).toEqual({
      languageMatch: 'exact',
      languagePreferenceIndex: 0,
      trackKindPreferenceIndex: 1,
      audioTrackTypePreferenceIndex: 0,
      draftPenalty: 0,
      closedCaptionPenalty: 1,
      automaticSyncPenalty: 1,
    });
    expect(first.rankedCandidates[1]?.rankingSignals.languageMatch).toBe('primary_subtag');
    expect(first.excludedTracks).toEqual([
      expect.objectContaining({
        track: expect.objectContaining({ captionTrackId: 'draft-en-us' }),
        reasons: ['draft_disallowed'],
      }),
      expect.objectContaining({
        track: expect.objectContaining({ captionTrackId: 'forced-en-us' }),
        reasons: ['track_kind_not_allowed'],
      }),
      expect.objectContaining({
        track: expect.objectContaining({ captionTrackId: 'syncing-en-us' }),
        reasons: ['not_serving'],
      }),
    ]);
  });

  it('returns no recommendation when explicit preferences exclude every track', () => {
    const result = recommendProcedureTutorialYoutubeCaptionTracks(
      {
        ...request,
        preferences: {
          ...request.preferences,
          preferredLanguages: ['fr-FR'],
          languageMatching: 'exact_only',
        },
      },
      trackList,
    );

    expect(result.recommendedCaptionTrackId).toBeNull();
    expect(result.rankedCandidates).toEqual([]);
    expect(result.excludedTracks).toHaveLength(trackList.tracks.length);
    expect(
      result.excludedTracks.every(({ reasons }) => reasons.includes('language_not_allowed')),
    ).toBe(true);
  });

  it('fails safely when the completed source list is unavailable or mismatched', () => {
    for (const testCase of [
      {
        source: null,
        code: 'youtube_track_recommendation_source_not_found',
        status: 404,
        retryMode: 'same_request_id',
      },
      {
        source: { ...trackList, videoId: 'abcdefghijk' },
        code: 'youtube_track_recommendation_source_mismatch',
        status: 409,
        retryMode: 'never',
      },
    ] as const) {
      try {
        recommendProcedureTutorialYoutubeCaptionTracks(request, testCase.source);
        throw new Error('Expected recommendation to fail');
      } catch (error) {
        expect(procedureTutorialYoutubeTrackRecommendationHttpStatus(error)).toBe(testCase.status);
        expect(
          procedureTutorialYoutubeTrackRecommendationErrorResponse(error, request.requestId),
        ).toMatchObject({
          error: testCase.code,
          requestId: request.requestId,
          retryMode: testCase.retryMode,
        });
      }
    }
  });
});
