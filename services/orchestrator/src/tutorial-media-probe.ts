import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { TutorialMediaProcessRunner } from './tutorial-media-process.js';

const maximumProbeBytes = 1 * 1_024 * 1_024;

export type TutorialMediaProbeErrorCode = 'invalid_input' | 'probe_failed' | 'unsupported_media';

export class TutorialMediaProbeError extends Error {
  constructor(readonly code: TutorialMediaProbeErrorCode) {
    super(
      code === 'invalid_input'
        ? 'The media probe input is invalid.'
        : code === 'unsupported_media'
          ? 'The media format is unsupported.'
          : 'The media probe failed.',
    );
    this.name = 'TutorialMediaProbeError';
  }
}

export interface TutorialMediaProbeResult {
  readonly container: 'mp4';
  readonly durationMs: number;
  readonly video: {
    readonly codec: 'h264' | 'hevc' | 'vp9' | 'av1';
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly frameCount: number;
  };
  readonly audio: {
    readonly codec: 'aac' | 'opus' | 'mp3';
    readonly channels: number;
    readonly sampleRateHz: number;
  } | null;
}

export interface TutorialMediaProbe {
  probe(sourcePath: string, signal?: AbortSignal): Promise<TutorialMediaProbeResult>;
}

export interface TutorialMediaProbeOptions {
  readonly runner: TutorialMediaProcessRunner;
  readonly executable: string;
  readonly jobDirectory: string;
  readonly timeoutMs?: number;
}

function validPath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}

function finiteNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function rational(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/u.test(value)) return;
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return;
  return numerator / denominator;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseProbe(bytes: Uint8Array): TutorialMediaProbeResult {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumProbeBytes) {
    throw new TutorialMediaProbeError('probe_failed');
  }
  let root: Record<string, unknown> | undefined;
  try {
    root = record(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    throw new TutorialMediaProbeError('probe_failed');
  }
  const format = record(root?.format);
  const streams = Array.isArray(root?.streams) ? root.streams.map(record) : [];
  if (format === undefined || streams.some((stream) => stream === undefined)) {
    throw new TutorialMediaProbeError('probe_failed');
  }
  const formatNames = typeof format.format_name === 'string' ? format.format_name.split(',') : [];
  if (!formatNames.includes('mp4')) {
    throw new TutorialMediaProbeError('unsupported_media');
  }
  const durationSeconds = finiteNumber(format.duration);
  const durationMs = durationSeconds === undefined ? NaN : Math.round(durationSeconds * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 86_400_000) {
    throw new TutorialMediaProbeError('probe_failed');
  }
  const videoStreams = streams.filter((stream) => stream?.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream?.codec_type === 'audio');
  if (videoStreams.length !== 1 || audioStreams.length > 1) {
    throw new TutorialMediaProbeError('unsupported_media');
  }
  const video = videoStreams[0]!;
  const videoCodecs = { h264: 'h264', hevc: 'hevc', vp9: 'vp9', av1: 'av1' } as const;
  const codec =
    typeof video.codec_name === 'string'
      ? videoCodecs[video.codec_name as keyof typeof videoCodecs]
      : undefined;
  const width = finiteNumber(video.width);
  const height = finiteNumber(video.height);
  const frameRate = rational(video.avg_frame_rate) ?? rational(video.r_frame_rate);
  const declaredFrameCount = finiteNumber(video.nb_frames);
  const frameCount =
    declaredFrameCount === undefined && frameRate !== undefined
      ? Math.round((durationMs / 1_000) * frameRate)
      : declaredFrameCount;
  if (
    codec === undefined ||
    !Number.isSafeInteger(width) ||
    width! <= 0 ||
    width! > 16_384 ||
    !Number.isSafeInteger(height) ||
    height! <= 0 ||
    height! > 16_384 ||
    frameRate === undefined ||
    frameRate <= 0 ||
    frameRate > 1_000 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount! <= 0 ||
    frameCount! > 100_000_000
  ) {
    throw new TutorialMediaProbeError('unsupported_media');
  }
  const validatedFrameCount = frameCount!;
  const expectedFrames = (durationMs / 1_000) * frameRate;
  if (Math.abs(validatedFrameCount - expectedFrames) > Math.max(2, expectedFrames * 0.02)) {
    throw new TutorialMediaProbeError('probe_failed');
  }
  let audio: TutorialMediaProbeResult['audio'] = null;
  if (audioStreams.length === 1) {
    const stream = audioStreams[0]!;
    const audioCodecs = { aac: 'aac', opus: 'opus', mp3: 'mp3' } as const;
    const audioCodec =
      typeof stream.codec_name === 'string'
        ? audioCodecs[stream.codec_name as keyof typeof audioCodecs]
        : undefined;
    const channels = finiteNumber(stream.channels);
    const sampleRateHz = finiteNumber(stream.sample_rate);
    if (
      audioCodec === undefined ||
      !Number.isSafeInteger(channels) ||
      channels! < 1 ||
      channels! > 32 ||
      !Number.isSafeInteger(sampleRateHz) ||
      sampleRateHz! < 8_000 ||
      sampleRateHz! > 384_000
    ) {
      throw new TutorialMediaProbeError('unsupported_media');
    }
    audio = { codec: audioCodec, channels: channels!, sampleRateHz: sampleRateHz! };
  }
  return {
    audio,
    container: 'mp4',
    durationMs,
    video: { codec, frameCount: validatedFrameCount, frameRate, height: height!, width: width! },
  };
}

export function createTutorialMediaProbe(options: TutorialMediaProbeOptions): TutorialMediaProbe {
  if (!validPath(options.executable) || !validPath(options.jobDirectory)) {
    throw new TutorialMediaProbeError('invalid_input');
  }
  return {
    async probe(sourcePath, signal) {
      if (!validPath(sourcePath)) throw new TutorialMediaProbeError('invalid_input');
      try {
        const source = await lstat(sourcePath);
        if (source.isSymbolicLink() || !source.isFile() || source.size <= 0 || source.nlink !== 1) {
          throw new TutorialMediaProbeError('invalid_input');
        }
        const result = await options.runner.run(
          {
            executable: options.executable,
            cwd: options.jobDirectory,
            args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', sourcePath],
          },
          {
            signal,
            timeoutMs: options.timeoutMs ?? 60_000,
            maximumOutputBytes: maximumProbeBytes,
          },
        );
        return parseProbe(result.stdout);
      } catch (error) {
        if (error instanceof TutorialMediaProbeError) throw error;
        throw new TutorialMediaProbeError('probe_failed');
      }
    },
  };
}
