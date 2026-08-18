import {
  procedureAuthoringTutorialTranscriptDocumentMaxBytes,
  procedureAuthoringYoutubeCaptionAcquisitionSchema,
  procedureTutorialYoutubeCaptionTrackMaxCount,
  procedureTutorialYoutubeCaptionTrackSchema,
  type ProcedureAuthoringYoutubeCaptionAcquisition,
  type ProcedureTutorialYoutubeCaptionTrack,
  type ProcedureTutorialYoutubeImportRequest,
  type ProcedureTutorialYoutubeTrackListRequest,
} from '@operatingline/protocol';
import { z } from 'zod';

const youtubeDataApiBaseUrl = 'https://www.googleapis.com/youtube/v3/';
const defaultYoutubeCaptionSourceTimeoutMs = 30_000;
const maximumYoutubeCaptionSourceTimeoutMs = 120_000;
const maximumYoutubeJsonResponseBytes = 1_048_576;

const youtubeVideoListResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string() }),
        contentDetails: z.object({ duration: z.string() }),
      }),
    )
    .max(1),
});

const youtubeCaptionSnippetCoreSchema = z.object({
  videoId: z.string(),
  lastUpdated: z.iso.datetime({ offset: true }),
  trackKind: z.enum(['ASR', 'forced', 'standard']),
  language: z.string().min(1).max(64).regex(/^\S+$/),
  isDraft: z.boolean(),
  isAutoSynced: z.boolean(),
  status: z.enum(['failed', 'serving', 'syncing']),
});

const youtubeCaptionResourceCoreSchema = z.object({
  id: z.string(),
  snippet: youtubeCaptionSnippetCoreSchema,
});

const youtubeCaptionListResponseSchema = z.object({
  items: z
    .array(youtubeCaptionResourceCoreSchema)
    .max(procedureTutorialYoutubeCaptionTrackMaxCount),
});

const youtubeCaptionTrackListResponseSchema = z.object({
  items: z
    .array(
      youtubeCaptionResourceCoreSchema.extend({
        snippet: youtubeCaptionSnippetCoreSchema.extend({
          name: z.string().max(150),
          audioTrackType: z.enum(['commentary', 'descriptive', 'primary', 'unknown']),
          isCC: z.boolean(),
          isLarge: z.boolean(),
          isEasyReader: z.boolean(),
          failureReason: z
            .enum(['processingFailed', 'unknownFormat', 'unsupportedFormat'])
            .optional(),
        }),
      }),
    )
    .max(procedureTutorialYoutubeCaptionTrackMaxCount),
});

export type ProcedureTutorialYoutubeSourceErrorCode =
  | 'youtube_source_unauthorized'
  | 'youtube_video_not_found'
  | 'youtube_caption_not_found'
  | 'youtube_caption_not_ready'
  | 'youtube_caption_too_large'
  | 'youtube_source_failed';

export class ProcedureTutorialYoutubeSourceError extends Error {
  constructor(
    readonly code: ProcedureTutorialYoutubeSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProcedureTutorialYoutubeSourceError';
  }
}

export interface ProcedureTutorialYoutubeCaptionAcquisitionResult {
  readonly video: {
    readonly uri: string;
    readonly title: string;
    readonly durationMs: number;
  };
  readonly captionDocument: {
    readonly format: 'webvtt' | 'srt';
    readonly content: string;
    readonly locale: string;
    readonly acquisition: ProcedureAuthoringYoutubeCaptionAcquisition;
  };
}

export interface ProcedureTutorialYoutubeCaptionTrackListSourceResult {
  readonly videoId: string;
  readonly tracks: readonly ProcedureTutorialYoutubeCaptionTrack[];
}

export interface ProcedureTutorialYoutubeCaptionSource {
  readonly id: 'youtube_data_api_v3';
  listTracks(
    request: ProcedureTutorialYoutubeTrackListRequest['youtube'],
  ): Promise<ProcedureTutorialYoutubeCaptionTrackListSourceResult>;
  acquire(
    request: ProcedureTutorialYoutubeImportRequest['youtube'],
  ): Promise<ProcedureTutorialYoutubeCaptionAcquisitionResult>;
  close?(): Promise<void> | void;
}

export interface YouTubeDataApiCaptionSourceOptions {
  readonly accessToken: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function safeSourceError(error: unknown): ProcedureTutorialYoutubeSourceError {
  return error instanceof ProcedureTutorialYoutubeSourceError
    ? error
    : new ProcedureTutorialYoutubeSourceError(
        'youtube_source_failed',
        'YouTube Data API caption acquisition failed without a safe public error',
      );
}

function responseError(
  response: Response,
  notFoundCode: 'youtube_video_not_found' | 'youtube_caption_not_found',
): ProcedureTutorialYoutubeSourceError {
  if (response.status === 401 || response.status === 403) {
    return new ProcedureTutorialYoutubeSourceError(
      'youtube_source_unauthorized',
      'YouTube Data API authorization is invalid or lacks permission to edit this video',
    );
  }
  if (response.status === 404) {
    return new ProcedureTutorialYoutubeSourceError(
      notFoundCode,
      notFoundCode === 'youtube_video_not_found'
        ? 'The authorized YouTube video could not be found'
        : 'The authorized YouTube caption track could not be found',
    );
  }
  return new ProcedureTutorialYoutubeSourceError(
    'youtube_source_failed',
    `YouTube Data API request failed with HTTP ${response.status}`,
  );
}

async function readLimitedUtf8(
  response: Response,
  maximumBytes: number,
  tooLargeCode: ProcedureTutorialYoutubeSourceErrorCode,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    throw new ProcedureTutorialYoutubeSourceError(
      tooLargeCode,
      `YouTube response exceeds ${maximumBytes} UTF-8 bytes`,
    );
  }
  if (response.body === null) {
    throw new ProcedureTutorialYoutubeSourceError(
      'youtube_source_failed',
      'YouTube Data API returned an empty response body',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      byteLength += item.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new ProcedureTutorialYoutubeSourceError(
          tooLargeCode,
          `YouTube response exceeds ${maximumBytes} UTF-8 bytes`,
        );
      }
      chunks.push(item.value);
    }
  } catch (error) {
    throw safeSourceError(error);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProcedureTutorialYoutubeSourceError(
      'youtube_source_failed',
      'YouTube Data API response is not valid UTF-8',
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await readLimitedUtf8(
    response,
    maximumYoutubeJsonResponseBytes,
    'youtube_source_failed',
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProcedureTutorialYoutubeSourceError(
      'youtube_source_failed',
      'YouTube Data API returned invalid JSON',
    );
  }
}

export function parseYouTubeDurationMs(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (match === null || match.slice(1).every((component) => component === undefined)) {
    throw new ProcedureTutorialYoutubeSourceError(
      'youtube_source_failed',
      'YouTube video duration is not a supported ISO 8601 duration',
    );
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const durationMs = Math.round((((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new ProcedureTutorialYoutubeSourceError(
      'youtube_source_failed',
      'YouTube video duration exceeds the supported range',
    );
  }
  return durationMs;
}

function containsWhitespaceOrControl(value: string): boolean {
  return (
    /\s/u.test(value) ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
    })
  );
}

export function createYouTubeDataApiCaptionSource(
  options: YouTubeDataApiCaptionSourceOptions,
): ProcedureTutorialYoutubeCaptionSource {
  if (
    options.accessToken.length === 0 ||
    options.accessToken.length > 8_192 ||
    options.accessToken.trim() !== options.accessToken ||
    containsWhitespaceOrControl(options.accessToken)
  ) {
    throw new Error(
      'YouTube OAuth access token must be non-empty and contain no whitespace or control characters',
    );
  }
  const timeoutMs = options.timeoutMs ?? defaultYoutubeCaptionSourceTimeoutMs;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > maximumYoutubeCaptionSourceTimeoutMs
  ) {
    throw new Error(
      `YouTube caption source timeout must be between 100 and ${maximumYoutubeCaptionSourceTimeoutMs}ms`,
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const authorization = `Bearer ${options.accessToken}`;

  const runAuthorized = async <Result>(
    operation: (authorizedFetch: (url: URL) => Promise<Response>) => Promise<Result>,
  ): Promise<Result> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const authorizedFetch = async (url: URL): Promise<Response> => {
      try {
        return await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json, application/octet-stream', authorization },
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_source_failed',
          controller.signal.aborted
            ? 'YouTube Data API caption acquisition timed out'
            : 'YouTube Data API request failed',
        );
      }
    };
    try {
      return await operation(authorizedFetch);
    } catch (error) {
      throw safeSourceError(error);
    } finally {
      clearTimeout(timeout);
    }
  };

  const listTracks: ProcedureTutorialYoutubeCaptionSource['listTracks'] = async (request) =>
    runAuthorized(async (authorizedFetch) => {
      const captionsUrl = new URL('captions', youtubeDataApiBaseUrl);
      captionsUrl.searchParams.set('part', 'snippet');
      captionsUrl.searchParams.set('videoId', request.videoId);
      const captionsResponse = await authorizedFetch(captionsUrl);
      if (!captionsResponse.ok) {
        throw responseError(captionsResponse, 'youtube_video_not_found');
      }
      const captionList = youtubeCaptionTrackListResponseSchema.safeParse(
        await readJson(captionsResponse),
      );
      if (!captionList.success) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_source_failed',
          'YouTube Data API returned invalid caption track list metadata',
        );
      }
      const trackIds = new Set<string>();
      const tracks = captionList.data.items.map((caption) => {
        if (caption.snippet.videoId !== request.videoId || trackIds.has(caption.id)) {
          throw new ProcedureTutorialYoutubeSourceError(
            'youtube_source_failed',
            'YouTube Data API returned inconsistent caption track list metadata',
          );
        }
        trackIds.add(caption.id);
        return procedureTutorialYoutubeCaptionTrackSchema.parse({
          captionTrackId: caption.id,
          lastUpdated: caption.snippet.lastUpdated,
          trackKind: caption.snippet.trackKind,
          language: caption.snippet.language,
          name: caption.snippet.name,
          audioTrackType: caption.snippet.audioTrackType,
          isCC: caption.snippet.isCC,
          isLarge: caption.snippet.isLarge,
          isEasyReader: caption.snippet.isEasyReader,
          isDraft: caption.snippet.isDraft,
          isAutoSynced: caption.snippet.isAutoSynced,
          status: caption.snippet.status,
          ...(caption.snippet.status !== 'failed' || caption.snippet.failureReason === undefined
            ? {}
            : { failureReason: caption.snippet.failureReason }),
        });
      });
      tracks.sort((left, right) =>
        left.captionTrackId < right.captionTrackId
          ? -1
          : left.captionTrackId > right.captionTrackId
            ? 1
            : 0,
      );
      return { videoId: request.videoId, tracks };
    });

  const acquire: ProcedureTutorialYoutubeCaptionSource['acquire'] = async (request) =>
    runAuthorized(async (authorizedFetch) => {
      const videoUrl = new URL('videos', youtubeDataApiBaseUrl);
      videoUrl.searchParams.set('part', 'snippet,contentDetails');
      videoUrl.searchParams.set('id', request.videoId);
      const videoResponse = await authorizedFetch(videoUrl);
      if (!videoResponse.ok) throw responseError(videoResponse, 'youtube_video_not_found');
      const videoList = youtubeVideoListResponseSchema.safeParse(await readJson(videoResponse));
      if (!videoList.success) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_source_failed',
          'YouTube Data API returned invalid video metadata',
        );
      }
      const video = videoList.data.items[0];
      if (video === undefined || video.id !== request.videoId) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_video_not_found',
          'The authorized YouTube video could not be found',
        );
      }

      const captionsUrl = new URL('captions', youtubeDataApiBaseUrl);
      captionsUrl.searchParams.set('part', 'snippet');
      captionsUrl.searchParams.set('videoId', request.videoId);
      captionsUrl.searchParams.set('id', request.captionTrackId);
      const captionsResponse = await authorizedFetch(captionsUrl);
      if (!captionsResponse.ok) {
        throw responseError(captionsResponse, 'youtube_caption_not_found');
      }
      const captionList = youtubeCaptionListResponseSchema.safeParse(
        await readJson(captionsResponse),
      );
      if (!captionList.success) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_source_failed',
          'YouTube Data API returned invalid caption metadata',
        );
      }
      const caption = captionList.data.items[0];
      if (
        captionList.data.items.length !== 1 ||
        caption === undefined ||
        caption.id !== request.captionTrackId ||
        caption.snippet.videoId !== request.videoId
      ) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_caption_not_found',
          'The authorized YouTube caption track could not be found for this video',
        );
      }
      if (caption.snippet.status !== 'serving') {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_caption_not_ready',
          'The authorized YouTube caption track is not in serving state',
        );
      }
      if (
        request.expectedTrackLanguage !== undefined &&
        caption.snippet.language !== request.expectedTrackLanguage
      ) {
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_caption_not_found',
          'The authorized YouTube caption track language does not match the request',
        );
      }

      const downloadUrl = new URL(
        `captions/${encodeURIComponent(request.captionTrackId)}`,
        youtubeDataApiBaseUrl,
      );
      downloadUrl.searchParams.set('tfmt', request.requestedFormat === 'webvtt' ? 'vtt' : 'srt');
      const downloadResponse = await authorizedFetch(downloadUrl);
      if (!downloadResponse.ok) {
        throw responseError(downloadResponse, 'youtube_caption_not_found');
      }
      const content = await readLimitedUtf8(
        downloadResponse,
        procedureAuthoringTutorialTranscriptDocumentMaxBytes,
        'youtube_caption_too_large',
      );
      const acquisition = procedureAuthoringYoutubeCaptionAcquisitionSchema.parse({
        source: 'youtube_data_api_v3',
        authorization: 'oauth_video_edit_permission',
        videoId: request.videoId,
        captionTrackId: caption.id,
        trackLanguage: caption.snippet.language,
        trackKind: caption.snippet.trackKind,
        isDraft: caption.snippet.isDraft,
        isAutoSynced: caption.snippet.isAutoSynced,
        status: caption.snippet.status,
        lastUpdated: caption.snippet.lastUpdated,
        requestedFormat: request.requestedFormat,
      });
      return {
        video: {
          uri: `https://www.youtube.com/watch?v=${request.videoId}`,
          title: video.snippet.title,
          durationMs: parseYouTubeDurationMs(video.contentDetails.duration),
        },
        captionDocument: {
          format: request.requestedFormat,
          content,
          locale: caption.snippet.language,
          acquisition,
        },
      };
    });

  return { id: 'youtube_data_api_v3', listTracks, acquire };
}
