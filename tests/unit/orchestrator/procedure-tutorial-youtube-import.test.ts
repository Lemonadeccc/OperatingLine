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
  type ProcedureTutorialYoutubeTrackSelectionCurrentResult,
} from '@operatingline/protocol';

import {
  buildProcedureTutorialYoutubePromptPacket,
  createProcedureTutorialYoutubeImportCoordinator,
  procedureTutorialYoutubeImportErrorResponse,
  procedureTutorialYoutubeImportHttpStatus,
  procedureTutorialYoutubeTrackListHttpStatus,
} from '../../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
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

const selectionRequestId = '68e3cc4a-fb97-42e9-8d31-c0fe7679eea0';
const boundRequest = procedureTutorialYoutubeImportRequestSchema.parse({
  ...request,
  formatVersion: '1.1.0',
  requestId: '8bfbbf5a-b535-4eeb-9a44-09f96d2bda19',
  selectionRequestId,
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

const selection: ProcedureTutorialYoutubeTrackSelectionCurrentResult = {
  formatVersion: '1.1.0',
  requestId: selectionRequestId,
  requestFingerprint: 'a'.repeat(64),
  sourceTrackList: {
    requestId: trackListRequest.requestId,
    videoId: request.youtube.videoId,
    listedAt: '2026-08-18T09:00:00Z',
  },
  selectedTrack: trackListSourceResult.tracks[0]!,
  confirmation: {
    explicitlyConfirmedByUser: true,
    reason: {
      reasonCode: 'caption_quality_review',
      note: 'This local note must not enter the provider packet.',
    },
  },
  recommendation: null,
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
  selectedTrack?: ProcedureTutorialYoutubeTrackSelectionCurrentResult,
) {
  return buildProcedureTutorialYoutubePromptPacket(
    input,
    result,
    blenderActionCatalog,
    blenderInteractionCatalog,
    selectedTrack,
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
          'youtube_source_quota_exceeded',
          'YouTube Data API quota or rate limit rejected the request',
        );
      },
    );
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const failure = await coordinator.listTracks(trackListRequest).catch((error) => error);
    expect(failure).toMatchObject({
      code: 'youtube_source_quota_exceeded',
      retryMode: 'new_request_id',
    });
    expect(procedureTutorialYoutubeTrackListHttpStatus(failure)).toBe(429);
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

  it('keeps authorization preflight outside track-list evidence and permits same-id recovery', async () => {
    let authorized = false;
    const events: ExecutionEventInput[] = [];
    const selectedSource = {
      ...source(),
      prepareAuthorization: vi.fn(async () => {
        if (!authorized) {
          throw new ProcedureTutorialYoutubeSourceError(
            'youtube_authentication_required',
            'YouTube authorization is required; run the local login command',
          );
        }
      }),
    };
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.listTracks(trackListRequest)).rejects.toMatchObject({
      code: 'youtube_authentication_required',
      retryMode: 'same_request_id',
    });
    expect(events).toEqual([]);
    expect(selectedSource.listTracks).not.toHaveBeenCalled();

    authorized = true;
    await expect(coordinator.listTracks(trackListRequest)).resolves.toMatchObject({
      requestId: trackListRequest.requestId,
    });
    expect(selectedSource.listTracks).toHaveBeenCalledOnce();
    await coordinator.close();
  });

  it('coalesces a same-id track list after asynchronous authorization preflight', async () => {
    let releaseAuthorization: (() => void) | undefined;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const events: ExecutionEventInput[] = [];
    const selectedSource = {
      ...source(),
      prepareAuthorization: vi.fn(() => authorizationGate),
    };
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const first = coordinator.listTracks(trackListRequest);
    const second = coordinator.listTracks(trackListRequest);
    releaseAuthorization?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ requestId: trackListRequest.requestId }),
      expect.objectContaining({ requestId: trackListRequest.requestId }),
    ]);

    expect(selectedSource.prepareAuthorization).toHaveBeenCalledTimes(2);
    expect(selectedSource.listTracks).toHaveBeenCalledOnce();
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption-tracks.requested',
      'procedure.tutorial.youtube.caption-tracks.completed',
    ]);
    await coordinator.close();
  });

  it('waits for track-list authorization preflight during close without writing evidence', async () => {
    let releaseAuthorization: (() => void) | undefined;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const events: ExecutionEventInput[] = [];
    const selectedSource = {
      ...source(),
      prepareAuthorization: vi.fn(() => authorizationGate),
      close: vi.fn(),
    };
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const listing = coordinator.listTracks(trackListRequest);
    await vi.waitFor(() => expect(selectedSource.prepareAuthorization).toHaveBeenCalledOnce());
    const closing = coordinator.close();
    await Promise.resolve();
    expect(selectedSource.close).not.toHaveBeenCalled();

    releaseAuthorization?.();
    await expect(listing).rejects.toMatchObject({
      code: 'youtube_track_list_unavailable',
      retryMode: 'same_request_id',
    });
    await closing;
    expect(events).toEqual([]);
    expect(selectedSource.listTracks).not.toHaveBeenCalled();
    expect(selectedSource.close).toHaveBeenCalledOnce();
  });

  it('builds packet 1.3.0 for legacy evidence, rejects fresh legacy imports, and restores history', async () => {
    const packet = buildPacket(request, acquisition);
    expect(packet).toMatchObject({
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

    const selectedSource = source();
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.importCaption(request)).rejects.toMatchObject({
      code: 'youtube_import_legacy_request_unsupported',
      retryMode: 'never',
    });
    expect(
      procedureTutorialYoutubeImportHttpStatus(
        await coordinator.importCaption(request).catch((error) => error),
      ),
    ).toBe(422);
    expect(selectedSource.acquire).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    await coordinator.close();

    const requestFingerprint = plannerProviderRequestFingerprint(request);
    const historicalEvents: ExecutionEventInput[] = [
      {
        id: `procedure-tutorial-youtube-caption-requested:${request.requestId}`,
        eventType: 'procedure.tutorial.youtube.caption.requested',
        payload: {
          requestId: request.requestId,
          requestFingerprint,
          videoId: request.youtube.videoId,
          captionTrackId: request.youtube.captionTrackId,
          requestedFormat: request.youtube.requestedFormat,
          occurredAt: '2026-08-18T10:00:00Z',
        },
      },
      {
        id: `procedure-tutorial-youtube-caption-completed:${request.requestId}`,
        eventType: 'procedure.tutorial.youtube.caption.completed',
        payload: {
          request,
          requestFingerprint,
          packet,
          occurredAt: '2026-08-18T10:01:00Z',
        },
      },
    ];
    const restartedSource = source(async () => {
      throw new Error('Historical legacy import evidence must restore without another API call.');
    });
    const restarted = createProcedureTutorialYoutubeImportCoordinator({
      source: restartedSource,
      existingEvents: stored(historicalEvents),
      buildPacket,
      appendEvent: () => {
        throw new Error('A restored import must not append duplicate evidence.');
      },
    });
    await expect(restarted.importCaption(request)).resolves.toEqual(packet);
    expect(restartedSource.acquire).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('restores a historical failed import event without a selection field', async () => {
    const selectedSource = source();
    const requestFingerprint = plannerProviderRequestFingerprint(request);
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: stored([
        {
          id: `procedure-tutorial-youtube-caption-failed:${request.requestId}`,
          eventType: 'procedure.tutorial.youtube.caption.failed',
          payload: {
            requestId: request.requestId,
            requestFingerprint,
            videoId: request.youtube.videoId,
            captionTrackId: request.youtube.captionTrackId,
            requestedFormat: request.youtube.requestedFormat,
            error: 'youtube_source_unauthorized',
            occurredAt: '2026-08-18T10:00:00Z',
          },
        },
      ]),
      buildPacket,
      appendEvent: () => {
        throw new Error('Historical failed evidence must prevent a duplicate import attempt.');
      },
    });

    await expect(coordinator.importCaption(request)).rejects.toMatchObject({
      code: 'youtube_import_already_attempted',
      retryMode: 'new_request_id',
    });
    expect(selectedSource.acquire).not.toHaveBeenCalled();
    await coordinator.close();
  });

  it('binds a persisted selection receipt before importing and restores packet 1.4.0', async () => {
    const selectedSource = source();
    const events: ExecutionEventInput[] = [];
    const completedTrackSelection = vi.fn((requestId: string) =>
      requestId === selection.requestId ? selection : null,
    );
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      completedTrackSelection,
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const first = await coordinator.importCaption(boundRequest);
    const second = await coordinator.importCaption(boundRequest);

    expect(second).toEqual(first);
    expect(completedTrackSelection).toHaveBeenCalledTimes(1);
    expect(completedTrackSelection).toHaveBeenCalledWith(selectionRequestId);
    expect(selectedSource.acquire).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      formatVersion: '1.4.0',
      context: {
        tutorialProvenance: {
          transcript: {
            document: {
              acquisition: {
                videoId: boundRequest.youtube.videoId,
                captionTrackId: boundRequest.youtube.captionTrackId,
                selection: {
                  requestId: selectionRequestId,
                  requestFingerprint: selection.requestFingerprint,
                  trackListRequestId: selection.sourceTrackList.requestId,
                  confirmedAt: selection.recordedAt,
                  reasonCode: 'caption_quality_review',
                  selectedTrackWasRecommended: null,
                  selectedCandidateRank: null,
                },
              },
            },
          },
        },
        constraints: { tutorialTranscriptSelectionBound: true },
      },
    });
    expect(JSON.stringify(first)).not.toContain(selection.confirmation.reason.note);
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption.requested',
      'procedure.tutorial.youtube.caption.completed',
    ]);
    expect(events[0]?.payload).toMatchObject({ selectionRequestId });
    await expect(
      coordinator.importCaption({
        ...boundRequest,
        selectionRequestId: '0386dad4-0c8b-4df6-91c1-a76ae9c08aba',
      }),
    ).rejects.toMatchObject({ code: 'youtube_import_conflict' });
    await coordinator.close();

    const restartedSource = source(async () => {
      throw new Error('A completed selection-bound import must restore without an API call.');
    });
    const restartedSelectionLookup = vi.fn(() => {
      throw new Error('A completed selection-bound import must restore without a receipt lookup.');
    });
    const restarted = createProcedureTutorialYoutubeImportCoordinator({
      source: restartedSource,
      existingEvents: stored(events),
      completedTrackSelection: restartedSelectionLookup,
      buildPacket,
      appendEvent: () => {
        throw new Error('A restored selection-bound import must not append duplicate evidence.');
      },
    });
    await expect(restarted.importCaption(boundRequest)).resolves.toEqual(first);
    expect(restartedSelectionLookup).not.toHaveBeenCalled();
    expect(restartedSource.acquire).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('allows the same bound request after its missing selection receipt is recorded', async () => {
    let recorded = false;
    const selectedSource = source();
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      completedTrackSelection: () => (recorded ? selection : null),
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    let missingError: unknown;
    try {
      await coordinator.importCaption(boundRequest);
    } catch (error) {
      missingError = error;
    }
    expect(missingError).toMatchObject({
      code: 'youtube_import_selection_not_found',
      retryMode: 'same_request_id',
    });
    expect(procedureTutorialYoutubeImportHttpStatus(missingError)).toBe(404);
    expect(
      procedureTutorialYoutubeImportErrorResponse(missingError, boundRequest.requestId),
    ).toEqual(expect.objectContaining({ error: 'youtube_import_selection_not_found' }));
    expect(selectedSource.acquire).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    recorded = true;
    await expect(coordinator.importCaption(boundRequest)).resolves.toMatchObject({
      formatVersion: '1.4.0',
    });
    expect(selectedSource.acquire).toHaveBeenCalledTimes(1);
    await coordinator.close();
  });

  it('rejects a receipt for another video or track before API use', async () => {
    for (const mismatchedSelection of [
      {
        ...selection,
        sourceTrackList: { ...selection.sourceTrackList, videoId: 'abcdefghijk' },
      },
      {
        ...selection,
        selectedTrack: { ...selection.selectedTrack, captionTrackId: 'another-track' },
      },
    ]) {
      const selectedSource = source();
      const events: ExecutionEventInput[] = [];
      const coordinator = createProcedureTutorialYoutubeImportCoordinator({
        source: selectedSource,
        existingEvents: [],
        completedTrackSelection: () => mismatchedSelection,
        buildPacket,
        appendEvent: (event) => events.push(event),
      });

      let mismatchError: unknown;
      try {
        await coordinator.importCaption(boundRequest);
      } catch (error) {
        mismatchError = error;
      }
      expect(mismatchError).toMatchObject({
        code: 'youtube_import_selection_mismatch',
        retryMode: 'never',
      });
      expect(procedureTutorialYoutubeImportHttpStatus(mismatchError)).toBe(409);
      expect(selectedSource.acquire).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      await coordinator.close();
    }
  });

  it('fails before evidence when no authorized source is configured', async () => {
    const events: ExecutionEventInput[] = [];
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      existingEvents: [],
      completedTrackSelection: () => selection,
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.importCaption(boundRequest)).rejects.toMatchObject({
      code: 'youtube_source_unavailable',
      retryMode: 'same_request_id',
    });
    expect(events).toEqual([]);
    await coordinator.close();
  });

  it('keeps authorization preflight outside import evidence and permits same-id relogin', async () => {
    let authorized = false;
    const events: ExecutionEventInput[] = [];
    const selectedSource = {
      ...source(),
      prepareAuthorization: vi.fn(async () => {
        if (!authorized) {
          throw new ProcedureTutorialYoutubeSourceError(
            'youtube_authentication_required',
            'Stored YouTube authorization is no longer valid; run the local login command again',
          );
        }
      }),
    };
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      completedTrackSelection: () => selection,
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const error = await coordinator.importCaption(boundRequest).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'youtube_authentication_required',
      retryMode: 'same_request_id',
    });
    expect(procedureTutorialYoutubeImportHttpStatus(error)).toBe(503);
    expect(events).toEqual([]);
    expect(selectedSource.acquire).not.toHaveBeenCalled();

    authorized = true;
    await expect(coordinator.importCaption(boundRequest)).resolves.toMatchObject({
      formatVersion: '1.4.0',
    });
    expect(selectedSource.acquire).toHaveBeenCalledOnce();
    await coordinator.close();
  });

  it('waits for import authorization preflight during close without writing evidence', async () => {
    let releaseAuthorization: (() => void) | undefined;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const events: ExecutionEventInput[] = [];
    const selectedSource = {
      ...source(),
      prepareAuthorization: vi.fn(() => authorizationGate),
      close: vi.fn(),
    };
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      completedTrackSelection: () => selection,
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const importing = coordinator.importCaption(boundRequest);
    await vi.waitFor(() => expect(selectedSource.prepareAuthorization).toHaveBeenCalledOnce());
    const closing = coordinator.close();
    await Promise.resolve();
    expect(selectedSource.close).not.toHaveBeenCalled();

    releaseAuthorization?.();
    await expect(importing).rejects.toMatchObject({
      code: 'youtube_source_unavailable',
      retryMode: 'same_request_id',
    });
    await closing;
    expect(events).toEqual([]);
    expect(selectedSource.acquire).not.toHaveBeenCalled();
    expect(selectedSource.close).toHaveBeenCalledOnce();
  });

  it('records a safe terminal failure and refuses hidden same-id quota retries', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedSource = source(async () => {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_quota_exceeded',
        'YouTube Data API quota or rate limit rejected the request',
      );
    });
    const coordinator = createProcedureTutorialYoutubeImportCoordinator({
      source: selectedSource,
      existingEvents: [],
      completedTrackSelection: () => selection,
      buildPacket,
      appendEvent: (event) => events.push(event),
    });

    const failure = await coordinator.importCaption(boundRequest).catch((error) => error);
    expect(failure).toMatchObject({
      code: 'youtube_source_quota_exceeded',
      retryMode: 'new_request_id',
    });
    expect(procedureTutorialYoutubeImportHttpStatus(failure)).toBe(429);
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.tutorial.youtube.caption.requested',
      'procedure.tutorial.youtube.caption.failed',
    ]);
    expect(JSON.stringify(events)).not.toContain('authorization is invalid');
    await expect(coordinator.importCaption(boundRequest)).rejects.toMatchObject({
      code: 'youtube_import_already_attempted',
      retryMode: 'new_request_id',
    });
    expect(selectedSource.acquire).toHaveBeenCalledTimes(1);
    await coordinator.close();
  });
});
