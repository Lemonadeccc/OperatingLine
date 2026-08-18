import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  type ProcedureTutorialYoutubeImportRequest,
} from '@operatingline/protocol';

import {
  buildProcedureTutorialYoutubePromptPacket,
  createProcedureTutorialYoutubeImportCoordinator,
} from '../../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
import {
  ProcedureTutorialYoutubeSourceError,
  type ProcedureTutorialYoutubeCaptionAcquisitionResult,
  type ProcedureTutorialYoutubeCaptionSource,
  type ProcedureTutorialYoutubeCaptionTrackListSourceResult,
} from '../../../services/orchestrator/src/youtube-caption-source.js';

const captionDocument =
  'WEBVTT\n\n00:01.000 --> 00:04.000\nAdd a UV sphere.\n\n00:05.000 --> 00:08.000\nMove it.\n';

const request = procedureTutorialYoutubeImportRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: 'b7ccf359-5043-4596-af31-bde282c6318b',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: 'Create and position an eye from an authorized YouTube caption track.',
  treeId: 'youtube.caption.eye.procedure',
  revision: 1,
  locale: 'en',
  youtube: {
    videoId: 'dQw4w9WgXcQ',
    captionTrackId: 'caption-track-en',
    requestedFormat: 'webvtt',
    expectedTrackLanguage: 'en',
    defaultConfidence: 0.91,
    rightsStatus: 'permission_granted',
    authorization: {
      networkFetchApproved: true,
      quotaCostAcknowledged: true,
      videoEditPermissionExpected: true,
    },
  },
});

const acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult = {
  video: {
    uri: `https://www.youtube.com/watch?v=${request.youtube.videoId}`,
    title: 'Authorized Blender eye tutorial',
    durationMs: 20_000,
  },
  captionDocument: {
    format: 'webvtt',
    content: captionDocument,
    locale: 'en',
    acquisition: {
      source: 'youtube_data_api_v3',
      authorization: 'oauth_video_edit_permission',
      videoId: request.youtube.videoId,
      captionTrackId: request.youtube.captionTrackId,
      trackLanguage: 'en',
      trackKind: 'standard',
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
      lastUpdated: '2026-08-18T08:00:00Z',
      requestedFormat: 'webvtt',
    },
  },
};

const trackListRequest = procedureTutorialYoutubeTrackListRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: 'af653187-ac15-42eb-8652-d4b71b6c43ee',
  youtube: {
    videoId: request.youtube.videoId,
    authorization: request.youtube.authorization,
  },
});

const trackListSourceResult = {
  videoId: trackListRequest.youtube.videoId,
  tracks: [
    {
      captionTrackId: request.youtube.captionTrackId,
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard' as const,
      language: 'en',
      name: 'English',
      audioTrackType: 'primary' as const,
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving' as const,
    },
  ],
};

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-18T00:00:00.000Z',
  }));
}

function source(
  implementation: () => Promise<ProcedureTutorialYoutubeCaptionAcquisitionResult> = async () =>
    acquisition,
  listImplementation: () => Promise<ProcedureTutorialYoutubeCaptionTrackListSourceResult> = async () =>
    trackListSourceResult,
): ProcedureTutorialYoutubeCaptionSource & {
  acquire: ReturnType<typeof vi.fn>;
  listTracks: ReturnType<typeof vi.fn>;
} {
  return {
    id: 'youtube_data_api_v3',
    listTracks: vi.fn(listImplementation),
    acquire: vi.fn(implementation),
  };
}

function buildPacket(
  input: ProcedureTutorialYoutubeImportRequest,
  result: ProcedureTutorialYoutubeCaptionAcquisitionResult,
) {
  return buildProcedureTutorialYoutubePromptPacket(
    input,
    result,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
}

describe('authorized YouTube caption import coordinator', () => {
  it('lists caption tracks once, persists metadata-only evidence, detects conflicts, and restores', async () => {
    const selectedSource = source();
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const first = await coordinator.listTracks(trackListRequest);
    const second = await coordinator.listTracks(trackListRequest);

    expect(second).toEqual(first);
    expect(selectedSource.listTracks).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      formatVersion: '1.0.0',
      requestId: trackListRequest.requestId,
      videoId: trackListRequest.youtube.videoId,
      tracks: trackListSourceResult.tracks,
      sideEffects: {
        networkFetched: true,
        quotaOperation: 'youtube.captions.list',
        documentedQuotaUnits: 50,
        captionContentDownloaded: false,
        videoMediaDownloaded: false,
        modelCalled: false,
      },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption-tracks.requested',
      'procedure.tutorial.youtube.caption-tracks.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('captionDocument');

    await expect(
      coordinator.listTracks({
        ...trackListRequest,
        youtube: { ...trackListRequest.youtube, videoId: 'abcdefghijk' },
      }),
    ).rejects.toMatchObject({ code: 'youtube_track_list_conflict' });
    await coordinator.close();

    const restartedSource = source(async () => acquisition);
    restartedSource.listTracks.mockImplementation(async () => {
      throw new Error('A completed track list must restore without another API call.');
    });
    const restarted = createProcedureTutorialYoutubeImportCoordinator({
      source: restartedSource,
      existingEvents: stored(events),
      buildPacket,
      appendEvent: () => {
        throw new Error('A restored track list must not append duplicate evidence.');
      },
    });
    await expect(restarted.listTracks(trackListRequest)).resolves.toEqual(first);
    expect(restartedSource.listTracks).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('records track-list failure and refuses a hidden same-id quota retry', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedSource = source(
      async () => acquisition,
      async () => {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_source_unauthorized',
          'YouTube Data API authorization is invalid or lacks permission to edit this video',
        );
      },
    );
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.listTracks(trackListRequest)).rejects.toMatchObject({
      code: 'youtube_source_unauthorized',
      retryMode: 'new_request_id',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption-tracks.requested',
      'procedure.tutorial.youtube.caption-tracks.failed',
    ]);
    await expect(coordinator.listTracks(trackListRequest)).rejects.toMatchObject({
      code: 'youtube_track_list_already_attempted',
      retryMode: 'new_request_id',
    });
    expect(selectedSource.listTracks).toHaveBeenCalledTimes(1);
    await coordinator.close();
  });

  it('imports once, persists normalized evidence, detects conflicts, and restores', async () => {
    const selectedSource = source();
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const first = await coordinator.importCaption(request);
    const second = await coordinator.importCaption(request);

    expect(second).toEqual(first);
    expect(selectedSource.acquire).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      formatVersion: '1.3.0',
      context: {
        requestedTreeId: request.treeId,
        tutorialProvenance: {
          source: {
            uri: `https://www.youtube.com/watch?v=${request.youtube.videoId}`,
            title: acquisition.video.title,
            durationMs: acquisition.video.durationMs,
            rightsStatus: 'permission_granted',
          },
          transcript: {
            origin: 'youtube_data_api_v3',
            locale: 'en',
            document: {
              cueCount: 2,
              acquisition: acquisition.captionDocument.acquisition,
            },
            segments: [
              { order: 1, text: 'Add a UV sphere.', confidence: 0.91 },
              { order: 2, text: 'Move it.', confidence: 0.91 },
            ],
          },
        },
        constraints: {
          tutorialTranscriptDocumentBound: true,
          tutorialTranscriptAcquisitionBound: true,
        },
      },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption.requested',
      'procedure.tutorial.youtube.caption.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain(captionDocument);
    expect(JSON.stringify(events)).not.toContain('captionDocument');

    await expect(
      coordinator.importCaption({
        ...request,
        youtube: { ...request.youtube, defaultConfidence: 0.8 },
      }),
    ).rejects.toMatchObject({ code: 'youtube_import_conflict' });
    await coordinator.close();

    const restartedSource = source(async () => {
      throw new Error('A completed YouTube caption import must restore without another API call.');
    });
    const restarted = createProcedureTutorialYoutubeImportCoordinator({
      source: restartedSource,
      existingEvents: stored(events),
      buildPacket,
      appendEvent: () => {
        throw new Error('A restored import must not append duplicate evidence.');
      },
    });
    await expect(restarted.importCaption(request)).resolves.toEqual(first);
    expect(restartedSource.acquire).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('fails before evidence when no authorized source is configured', async () => {
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.importCaption(request)).rejects.toMatchObject({
      code: 'youtube_source_unavailable',
      retryMode: 'same_request_id',
    });
    expect(events).toEqual([]);
    await coordinator.close();
  });

  it('records a safe terminal failure and refuses hidden same-id quota retries', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedSource = source(async () => {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unauthorized',
        'YouTube Data API authorization is invalid or lacks permission to edit this video',
      );
    });
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.importCaption(request)).rejects.toMatchObject({
      code: 'youtube_source_unauthorized',
      retryMode: 'new_request_id',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption.requested',
      'procedure.tutorial.youtube.caption.failed',
    ]);
    expect(JSON.stringify(events)).not.toContain('authorization is invalid');
    await expect(coordinator.importCaption(request)).rejects.toMatchObject({
      code: 'youtube_import_already_attempted',
      retryMode: 'new_request_id',
    });
    expect(selectedSource.acquire).toHaveBeenCalledTimes(1);
    await coordinator.close();
  });
});
