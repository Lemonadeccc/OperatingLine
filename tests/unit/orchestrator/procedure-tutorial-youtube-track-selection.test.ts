import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackSelectionRequestSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  createProcedureTutorialYoutubeTrackSelectionCoordinator,
  procedureTutorialYoutubeTrackSelectionErrorResponse,
  procedureTutorialYoutubeTrackSelectionHttpStatus,
} from '../../../services/orchestrator/src/procedure-tutorial-youtube-track-selection.js';

const trackList = procedureTutorialYoutubeTrackListResultSchema.parse({
  formatVersion: '1.0.0',
  requestId: '3e25e0c3-713f-437d-84ae-8e741d0a3bc1',
  source: 'youtube_data_api_v3',
  authorization: 'oauth_video_edit_permission',
  videoId: 'dQw4w9WgXcQ',
  tracks: [
    {
      captionTrackId: 'standard-en',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en',
      name: 'English',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
    },
    {
      captionTrackId: 'asr-en',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'ASR',
      language: 'en',
      name: 'English automatic',
      audioTrackType: 'primary',
      isCC: false,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: true,
      status: 'serving',
    },
    {
      captionTrackId: 'syncing-en',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en',
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

const recommendationPreferences = {
  preferredLanguages: ['en'],
  languageMatching: 'exact_only',
  allowUnlistedLanguages: false,
  trackKindPriority: ['standard', 'ASR'],
  audioTrackTypePriority: ['primary'],
  allowDraftTracks: false,
  preferClosedCaptions: true,
  preferManualSync: true,
  explicitSelectionRequired: true,
} as const;

const overrideRequest = procedureTutorialYoutubeTrackSelectionRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: '59aeb3ac-daed-4970-b6ba-2ef1f8bf90bb',
  trackListRequestId: trackList.requestId,
  videoId: trackList.videoId,
  captionTrackId: 'asr-en',
  confirmation: {
    explicitlyConfirmedByUser: true,
    reason: {
      reasonCode: 'caption_quality_review',
      note: 'The automatic track has the corrected Blender operator name.',
    },
  },
  recommendationPreferences,
});

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-18T10:00:00Z',
  }));
}

describe('authorized YouTube caption track selection', () => {
  it('persists an explicit recommendation override and restores it idempotently', () => {
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: [],
      completedTrackList: (requestId) => (requestId === trackList.requestId ? trackList : null),
      appendEvent: (event) => events.push(event),
      now: () => '2026-08-18T10:00:00Z',
    });

    const first = coordinator.select(overrideRequest);
    const second = coordinator.select(overrideRequest);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      requestId: overrideRequest.requestId,
      selectedTrack: { captionTrackId: 'asr-en', status: 'serving' },
      confirmation: overrideRequest.confirmation,
      recommendation: {
        recommendedCaptionTrackId: 'standard-en',
        selectedCandidateRank: 2,
        selectedTrackWasRecommended: false,
      },
      sideEffects: {
        captionTrackSelectionRecorded: true,
        networkFetched: false,
        additionalQuotaUnits: 0,
        captionContentDownloaded: false,
        videoMediaDownloaded: false,
        modelCalled: false,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      recordedAt: '2026-08-18T10:00:00Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(
      'procedure.tutorial.youtube.caption-track-selection.completed',
    );
    expect(JSON.stringify(events)).toContain('caption_quality_review');
    expect(JSON.stringify(events)).not.toContain('captionDocument');
    expect(JSON.stringify(events)).not.toContain('WEBVTT');

    expect(() =>
      coordinator.select({ ...overrideRequest, captionTrackId: 'standard-en' }),
    ).toThrowError(expect.objectContaining({ code: 'youtube_track_selection_conflict' }));

    const restarted = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: stored(events),
      completedTrackList: () => {
        throw new Error('A restored selection must not reload its source list.');
      },
      appendEvent: () => {
        throw new Error('A restored selection must not append duplicate evidence.');
      },
    });
    expect(restarted.select(overrideRequest)).toEqual(first);
  });

  it('attests when the user explicitly accepts the recomputed first candidate', () => {
    const coordinator = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: [],
      completedTrackList: () => trackList,
      appendEvent: () => undefined,
      now: () => '2026-08-18T10:00:00Z',
    });
    const result = coordinator.select({
      ...overrideRequest,
      requestId: '29e9834f-33a6-42a4-8141-50c75641c827',
      captionTrackId: 'standard-en',
      confirmation: {
        explicitlyConfirmedByUser: true,
        reason: { reasonCode: 'recommended_candidate' },
      },
    });

    expect(result.recommendation).toMatchObject({
      recommendedCaptionTrackId: 'standard-en',
      selectedCandidateRank: 1,
      selectedTrackWasRecommended: true,
    });
  });

  it('rejects a false recommendation claim and a non-serving track', () => {
    const coordinator = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: [],
      completedTrackList: () => trackList,
      appendEvent: () => undefined,
    });

    for (const testCase of [
      {
        request: {
          ...overrideRequest,
          requestId: 'fbc5df16-7b4c-4c87-ac1f-63577094f237',
          confirmation: {
            explicitlyConfirmedByUser: true as const,
            reason: { reasonCode: 'recommended_candidate' as const },
          },
        },
        code: 'youtube_track_selection_recommendation_mismatch',
        status: 409,
      },
      {
        request: {
          ...overrideRequest,
          requestId: '2945d53c-8c67-4bd2-9439-d8a62065d9e8',
          captionTrackId: 'syncing-en',
        },
        code: 'youtube_track_selection_track_not_importable',
        status: 422,
      },
    ] as const) {
      try {
        coordinator.select(testCase.request);
        throw new Error('Expected selection to fail');
      } catch (error) {
        expect(procedureTutorialYoutubeTrackSelectionHttpStatus(error)).toBe(testCase.status);
        expect(
          procedureTutorialYoutubeTrackSelectionErrorResponse(error, testCase.request.requestId),
        ).toMatchObject({ error: testCase.code, retryMode: 'never' });
      }
    }
  });

  it('allows a safe same-id retry when the source or evidence store is unavailable', () => {
    const missing = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: [],
      completedTrackList: () => null,
      appendEvent: () => undefined,
    });
    expect(() => missing.select(overrideRequest)).toThrowError(
      expect.objectContaining({
        code: 'youtube_track_selection_source_not_found',
        retryMode: 'same_request_id',
      }),
    );

    const failingStore = createProcedureTutorialYoutubeTrackSelectionCoordinator({
      existingEvents: [],
      completedTrackList: () => trackList,
      appendEvent: () => {
        throw new Error('disk full');
      },
    });
    expect(() => failingStore.select(overrideRequest)).toThrowError(
      expect.objectContaining({
        code: 'youtube_track_selection_persistence_failed',
        retryMode: 'same_request_id',
      }),
    );
  });
});
