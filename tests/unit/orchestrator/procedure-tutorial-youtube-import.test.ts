import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureTutorialYoutubeImportRequestSchema,
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
): ProcedureTutorialYoutubeCaptionSource & { acquire: ReturnType<typeof vi.fn> } {
  return {
    id: 'youtube_data_api_v3',
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
