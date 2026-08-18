import { describe, expect, it, vi } from 'vitest';

import {
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
} from '@operatingline/protocol';

import {
  createYouTubeDataApiCaptionSource,
  parseYouTubeDurationMs,
} from '../../../services/orchestrator/src/youtube-caption-source.js';

const accessToken = 'youtube-oauth-test-token';
const request = procedureTutorialYoutubeImportRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: '9cc2ef5e-110f-49fa-b72d-1e047ca38bca',
  targetAdapterId: 'blender',
  goal: 'Create an eye from an authorized YouTube caption track.',
  treeId: 'youtube.caption.eye',
  revision: 1,
  youtube: {
    videoId: 'dQw4w9WgXcQ',
    captionTrackId: 'caption-track-en',
    requestedFormat: 'webvtt',
    expectedTrackLanguage: 'en',
    defaultConfidence: 0.9,
    rightsStatus: 'permission_granted',
    authorization: {
      networkFetchApproved: true,
      quotaCostAcknowledged: true,
      videoEditPermissionExpected: true,
    },
  },
});
const trackListRequest = procedureTutorialYoutubeTrackListRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: '4684a4c2-e800-4a23-89cc-a47f8f74f76d',
  youtube: {
    videoId: request.youtube.videoId,
    authorization: request.youtube.authorization,
  },
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function videoResponse(): Response {
  return jsonResponse({
    items: [
      {
        id: request.youtube.videoId,
        snippet: { title: 'Authorized Blender eye tutorial' },
        contentDetails: { duration: 'PT1M2.5S' },
      },
    ],
  });
}

function captionResponse(status: 'failed' | 'serving' | 'syncing' = 'serving'): Response {
  return jsonResponse({
    items: [
      {
        id: request.youtube.captionTrackId,
        snippet: {
          videoId: request.youtube.videoId,
          lastUpdated: '2026-08-18T08:00:00Z',
          trackKind: 'standard',
          language: 'en',
          isDraft: false,
          isAutoSynced: false,
          status,
        },
      },
    ],
  });
}

describe('YouTube Data API caption source', () => {
  it('rejects malformed runtime credentials before any network request can be made', () => {
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() =>
      createYouTubeDataApiCaptionSource({ accessToken: 'token with whitespace', fetch: fetchImpl }),
    ).toThrow('contain no whitespace or control characters');
    expect(() =>
      createYouTubeDataApiCaptionSource({ accessToken: 'token\nwith-control', fetch: fetchImpl }),
    ).toThrow('contain no whitespace or control characters');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires one unambiguous credential source', () => {
    const accessTokenProvider = {
      getAccessToken: vi.fn(async () => accessToken),
      invalidateAccessToken: vi.fn(),
    };

    expect(() => createYouTubeDataApiCaptionSource({})).toThrow('exactly one');
    expect(() => createYouTubeDataApiCaptionSource({ accessToken, accessTokenProvider })).toThrow(
      'exactly one',
    );
  });

  it('prepares managed authorization without YouTube API traffic and reads the current token per operation', async () => {
    let currentToken = 'first-managed-access-token';
    const accessTokenProvider = {
      getAccessToken: vi.fn(async () => currentToken),
      invalidateAccessToken: vi.fn(),
      close: vi.fn(),
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ items: [] }));
    const source = createYouTubeDataApiCaptionSource({ accessTokenProvider, fetch: fetchImpl });

    await source.prepareAuthorization?.();
    expect(fetchImpl).not.toHaveBeenCalled();

    await source.listTracks(trackListRequest.youtube);
    currentToken = 'second-managed-access-token';
    await source.listTracks(trackListRequest.youtube);

    expect(accessTokenProvider.getAccessToken).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ authorization: 'Bearer first-managed-access-token' }),
      expect.objectContaining({ authorization: 'Bearer second-managed-access-token' }),
    ]);
    await source.close?.();
    expect(accessTokenProvider.close).toHaveBeenCalledOnce();
  });

  it('invalidates a rejected managed access token without replaying quota-bearing API calls', async () => {
    const rejectedToken = 'rejected-managed-access-token';
    const accessTokenProvider = {
      getAccessToken: vi.fn(async () => rejectedToken),
      invalidateAccessToken: vi.fn(),
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const source = createYouTubeDataApiCaptionSource({ accessTokenProvider, fetch: fetchImpl });

    await expect(source.listTracks(trackListRequest.youtube)).rejects.toMatchObject({
      code: 'youtube_source_unauthorized',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(accessTokenProvider.invalidateAccessToken).toHaveBeenCalledOnce();
    expect(accessTokenProvider.invalidateAccessToken).toHaveBeenCalledWith(rejectedToken);
  });

  it('does not invalidate or replay managed credentials for a forbidden resource', async () => {
    const accessTokenProvider = {
      getAccessToken: vi.fn(async () => accessToken),
      invalidateAccessToken: vi.fn(),
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'forbidden' }, 403));
    const source = createYouTubeDataApiCaptionSource({ accessTokenProvider, fetch: fetchImpl });

    await expect(source.listTracks(trackListRequest.youtube)).rejects.toMatchObject({
      code: 'youtube_source_unauthorized',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(accessTokenProvider.invalidateAccessToken).not.toHaveBeenCalled();
  });

  it('classifies quota failures without invalidating credentials or replaying requests', async () => {
    const accessTokenProvider = {
      getAccessToken: vi.fn(async () => accessToken),
      invalidateAccessToken: vi.fn(),
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            errors: [
              { reason: 'forbidden' },
              { reason: 'quotaExceeded', message: `upstream-secret-${accessToken}` },
            ],
          },
        },
        403,
      ),
    );
    const source = createYouTubeDataApiCaptionSource({ accessTokenProvider, fetch: fetchImpl });

    const error = await source
      .listTracks(trackListRequest.youtube)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'youtube_source_quota_exceeded',
      message: 'YouTube Data API quota or rate limit rejected the request',
    });
    expect(JSON.stringify(error)).not.toContain(accessToken);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(accessTokenProvider.invalidateAccessToken).not.toHaveBeenCalled();
  });

  it('fetches exact metadata, verifies the track, and downloads bounded WebVTT', async () => {
    const captionDocument =
      'WEBVTT\n\n00:01.000 --> 00:04.000\nAdd a UV sphere.\n\n00:05.000 --> 00:08.000\nMove it.\n';
    const responses = [videoResponse(), captionResponse(), new Response(captionDocument)];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const source = createYouTubeDataApiCaptionSource({ accessToken, fetch: fetchImpl });

    const result = await source.acquire(request.youtube);

    expect(result).toEqual({
      video: {
        uri: `https://www.youtube.com/watch?v=${request.youtube.videoId}`,
        title: 'Authorized Blender eye tutorial',
        durationMs: 62_500,
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
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const calls = fetchImpl.mock.calls.map(([input, init]) => ({
      url: new URL(String(input)),
      init,
    }));
    expect(calls[0]?.url.pathname).toBe('/youtube/v3/videos');
    expect(calls[0]?.url.searchParams.get('part')).toBe('snippet,contentDetails');
    expect(calls[0]?.url.searchParams.get('id')).toBe(request.youtube.videoId);
    expect(calls[1]?.url.pathname).toBe('/youtube/v3/captions');
    expect(calls[1]?.url.searchParams.get('videoId')).toBe(request.youtube.videoId);
    expect(calls[1]?.url.searchParams.get('id')).toBe(request.youtube.captionTrackId);
    expect(calls[2]?.url.pathname).toBe(`/youtube/v3/captions/${request.youtube.captionTrackId}`);
    expect(calls[2]?.url.searchParams.get('tfmt')).toBe('vtt');
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    }
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it('lists all authorized caption-track metadata without downloading caption content', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            id: 'track-z-failed',
            snippet: {
              videoId: trackListRequest.youtube.videoId,
              lastUpdated: '2026-08-18T08:05:00Z',
              trackKind: 'ASR',
              language: 'zh-Hans',
              name: '简体中文',
              audioTrackType: 'primary',
              isCC: false,
              isLarge: false,
              isEasyReader: false,
              isDraft: true,
              isAutoSynced: true,
              status: 'failed',
              failureReason: 'processingFailed',
            },
          },
          {
            id: 'track-a-serving',
            snippet: {
              videoId: trackListRequest.youtube.videoId,
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
          },
        ],
      }),
    );
    const source = createYouTubeDataApiCaptionSource({ accessToken, fetch: fetchImpl });

    await expect(source.listTracks(trackListRequest.youtube)).resolves.toEqual({
      videoId: trackListRequest.youtube.videoId,
      tracks: [
        {
          captionTrackId: 'track-a-serving',
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
          captionTrackId: 'track-z-failed',
          lastUpdated: '2026-08-18T08:05:00Z',
          trackKind: 'ASR',
          language: 'zh-Hans',
          name: '简体中文',
          audioTrackType: 'primary',
          isCC: false,
          isLarge: false,
          isEasyReader: false,
          isDraft: true,
          isAutoSynced: true,
          status: 'failed',
          failureReason: 'processingFailed',
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe('/youtube/v3/captions');
    expect(url.searchParams.get('part')).toBe('snippet');
    expect(url.searchParams.get('videoId')).toBe(trackListRequest.youtube.videoId);
    expect(url.searchParams.has('id')).toBe(false);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  });

  it('returns safe authorization errors without reading or echoing the upstream body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { message: `upstream-secret-${accessToken}` } }, 403),
    );
    const source = createYouTubeDataApiCaptionSource({ accessToken, fetch: fetchImpl });

    const error = await source.acquire(request.youtube).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'youtube_source_unauthorized',
      message: 'YouTube Data API authorization or resource policy rejected the request',
    });
    expect(JSON.stringify(error)).not.toContain(accessToken);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects non-serving and oversized caption tracks before returning content', async () => {
    const notReadyResponses = [videoResponse(), captionResponse('syncing')];
    const notReadyFetch = vi.fn<typeof fetch>(async () => notReadyResponses.shift()!);
    const notReady = createYouTubeDataApiCaptionSource({
      accessToken,
      fetch: notReadyFetch,
    });
    await expect(notReady.acquire(request.youtube)).rejects.toMatchObject({
      code: 'youtube_caption_not_ready',
    });

    const responses = [
      videoResponse(),
      captionResponse(),
      new Response('too large', {
        headers: { 'content-length': String(262_145) },
      }),
    ];
    const oversized = createYouTubeDataApiCaptionSource({
      accessToken,
      fetch: vi.fn<typeof fetch>(async () => responses.shift()!),
    });
    await expect(oversized.acquire(request.youtube)).rejects.toMatchObject({
      code: 'youtube_caption_too_large',
    });
  });

  it('parses supported YouTube ISO 8601 durations and rejects zero or malformed values', () => {
    expect(parseYouTubeDurationMs('P1DT2H3M4.25S')).toBe(93_784_250);
    expect(() => parseYouTubeDurationMs('PT0S')).toThrow('exceeds the supported range');
    expect(() => parseYouTubeDurationMs('one minute')).toThrow('not a supported ISO 8601 duration');
  });
});
