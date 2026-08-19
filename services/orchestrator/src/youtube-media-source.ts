import { lstat, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { ProcedureTutorialMediaAnalysisRequest } from '@operatingline/protocol';

import type { TutorialMediaProcessRunner } from './tutorial-media-process.js';
import {
  YouTubeMediaAuthorizationError,
  type YouTubeMediaAuthorizationVerifier,
} from './youtube-media-authorization.js';

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/u;
const maximumMetadataBytes = 256 * 1_024;
const defaultMaximumDownloadBytes = 8 * 1_024 * 1_024 * 1_024;
const maximumDownloadDirectoryEntries = 10_000;
const downloadSizePollIntervalMs = 100;

export type YouTubeMediaSourceErrorCode =
  | 'authorization_required'
  | 'authorization_expired'
  | 'quota_exceeded'
  | 'invalid_input'
  | 'download_failed'
  | 'invalid_download';

export class YouTubeMediaSourceError extends Error {
  constructor(readonly code: YouTubeMediaSourceErrorCode) {
    super(
      code === 'authorization_required'
        ? 'YouTube media download authorization is required.'
        : code === 'authorization_expired'
          ? 'YouTube media download authorization has expired.'
          : code === 'quota_exceeded'
            ? 'The YouTube media download exceeded its configured size limit.'
            : code === 'invalid_input'
              ? 'The YouTube media download input is invalid.'
              : code === 'invalid_download'
                ? 'The downloaded YouTube media failed validation.'
                : 'The YouTube media download failed.',
    );
    this.name = 'YouTubeMediaSourceError';
  }
}

export interface YouTubeMediaDownload {
  readonly videoId: string;
  readonly mediaPath: string;
  readonly title: string | null;
  readonly durationMs: number | null;
}

export interface YouTubeMediaSource {
  download(input: {
    readonly request: ProcedureTutorialMediaAnalysisRequest;
    readonly signal?: AbortSignal;
  }): Promise<YouTubeMediaDownload>;
}

export interface YouTubeMediaSourceOptions {
  readonly runner: TutorialMediaProcessRunner;
  readonly executable: string;
  readonly ffmpegExecutable: string;
  readonly jobDirectory: string;
  readonly authorizationVerifier: YouTubeMediaAuthorizationVerifier;
  readonly timeoutMs?: number;
  readonly maximumDownloadBytes?: number;
}

function absoluteNormalizedPath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function parseMetadata(
  bytes: Uint8Array,
  expectedVideoId: string,
  expectedMediaPath: string,
): {
  title: string | null;
  durationMs: number | null;
} {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumMetadataBytes) {
    throw new YouTubeMediaSourceError('invalid_download');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new YouTubeMediaSourceError('invalid_download');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new YouTubeMediaSourceError('invalid_download');
  }
  const metadata = value as Record<string, unknown>;
  if (metadata.id !== expectedVideoId) throw new YouTubeMediaSourceError('invalid_download');
  if (metadata.filepath !== expectedMediaPath) {
    throw new YouTubeMediaSourceError('invalid_download');
  }
  const title =
    metadata.title === undefined || metadata.title === null
      ? null
      : typeof metadata.title === 'string' &&
          metadata.title.length <= 4_096 &&
          !hasControlCharacter(metadata.title)
        ? metadata.title
        : undefined;
  if (title === undefined) throw new YouTubeMediaSourceError('invalid_download');
  const duration = metadata.duration;
  const durationMs =
    duration === undefined || duration === null
      ? null
      : typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? Math.round(duration * 1_000)
        : undefined;
  if (durationMs === undefined || (durationMs !== null && durationMs > 86_400_000)) {
    throw new YouTubeMediaSourceError('invalid_download');
  }
  return { durationMs, title };
}

async function downloadDirectoryBytes(directory: string): Promise<number> {
  const entries = await readdir(directory);
  if (entries.length > maximumDownloadDirectoryEntries) return Number.POSITIVE_INFINITY;
  let bytes = 0;
  for (const name of entries) {
    const info = await lstat(join(directory, name));
    if (info.isSymbolicLink() || !info.isFile()) return Number.POSITIVE_INFINITY;
    bytes += info.size;
    if (!Number.isSafeInteger(bytes)) return Number.POSITIVE_INFINITY;
  }
  return bytes;
}

export function createYouTubeMediaSource(options: YouTubeMediaSourceOptions): YouTubeMediaSource {
  const maximumDownloadBytes = options.maximumDownloadBytes ?? defaultMaximumDownloadBytes;
  if (
    !absoluteNormalizedPath(options.executable) ||
    !absoluteNormalizedPath(options.ffmpegExecutable) ||
    !absoluteNormalizedPath(options.jobDirectory) ||
    !Number.isSafeInteger(options.timeoutMs ?? 1_800_000) ||
    (options.timeoutMs ?? 1_800_000) <= 0 ||
    !Number.isSafeInteger(maximumDownloadBytes) ||
    maximumDownloadBytes <= 0 ||
    options.authorizationVerifier === null ||
    typeof options.authorizationVerifier?.verify !== 'function'
  ) {
    throw new YouTubeMediaSourceError('invalid_input');
  }
  const sourceDirectory = join(options.jobDirectory, 'source');
  const outputTemplate = join(sourceDirectory, 'media.%(ext)s');

  return {
    async download(input): Promise<YouTubeMediaDownload> {
      if (!videoIdPattern.test(input.request.videoId)) {
        throw new YouTubeMediaSourceError('invalid_input');
      }
      try {
        await options.authorizationVerifier.verify(input.request);
      } catch (error) {
        if (error instanceof YouTubeMediaAuthorizationError) {
          throw new YouTubeMediaSourceError(
            error.code === 'authorization_expired'
              ? 'authorization_expired'
              : 'authorization_required',
          );
        }
        throw new YouTubeMediaSourceError('authorization_required');
      }
      const videoId = input.request.videoId;
      try {
        await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
        const sourceDirectoryInfo = await lstat(sourceDirectory);
        if (sourceDirectoryInfo.isSymbolicLink() || !sourceDirectoryInfo.isDirectory()) {
          throw new YouTubeMediaSourceError('invalid_download');
        }
        const existing = await readdir(sourceDirectory);
        if (existing.length !== 0) throw new YouTubeMediaSourceError('invalid_download');
        const downloadController = new AbortController();
        const abortDownload = () => downloadController.abort();
        input.signal?.addEventListener('abort', abortDownload, { once: true });
        if (input.signal?.aborted) downloadController.abort();
        let monitorStopped = false;
        let quotaExceeded = false;
        const monitor = (async () => {
          while (!monitorStopped) {
            if ((await downloadDirectoryBytes(sourceDirectory)) > maximumDownloadBytes) {
              quotaExceeded = true;
              downloadController.abort();
              return;
            }
            await delay(downloadSizePollIntervalMs);
          }
        })();
        let result: Awaited<ReturnType<TutorialMediaProcessRunner['run']>>;
        let runError: unknown;
        try {
          result = await options.runner.run(
            {
              executable: options.executable,
              cwd: options.jobDirectory,
              args: [
                '--ignore-config',
                '--no-playlist',
                '--no-progress',
                '--no-overwrites',
                '--no-cache-dir',
                '--no-cookies',
                '--restrict-filenames',
                '--format',
                'bestvideo*+bestaudio/best',
                '--max-filesize',
                String(maximumDownloadBytes),
                '--ffmpeg-location',
                options.ffmpegExecutable,
                '--merge-output-format',
                'mp4',
                '--remux-video',
                'mp4',
                '--output',
                outputTemplate,
                '--print',
                'after_move:{"id":%(id)j,"title":%(title)j,"duration":%(duration)j,"filepath":%(filepath)j}',
                `https://www.youtube.com/watch?v=${videoId}`,
              ],
            },
            {
              signal: downloadController.signal,
              timeoutMs: options.timeoutMs ?? 1_800_000,
              maximumOutputBytes: maximumMetadataBytes,
            },
          );
        } catch (error) {
          runError = error;
        } finally {
          monitorStopped = true;
          input.signal?.removeEventListener('abort', abortDownload);
          await monitor;
        }
        if (quotaExceeded) throw new YouTubeMediaSourceError('quota_exceeded');
        if (runError !== undefined) throw runError;
        const mediaPath = join(sourceDirectory, 'media.mp4');
        const metadata = parseMetadata(result!.stdout, videoId, mediaPath);
        const entries = await readdir(sourceDirectory);
        if (entries.length !== 1 || entries[0] !== 'media.mp4') {
          throw new YouTubeMediaSourceError('invalid_download');
        }
        const info = await lstat(mediaPath);
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          info.size <= 0 ||
          info.size > maximumDownloadBytes ||
          info.nlink !== 1
        ) {
          throw new YouTubeMediaSourceError('invalid_download');
        }
        return { videoId, mediaPath, ...metadata };
      } catch (error) {
        if (error instanceof YouTubeMediaSourceError) throw error;
        throw new YouTubeMediaSourceError('download_failed');
      }
    },
  };
}
