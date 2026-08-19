import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  runTutorialMediaProcessWithOutputFile,
  TutorialMediaProcessError,
  type TutorialMediaProcessRunner,
} from './tutorial-media-process.js';

export type TutorialMediaTranscoderErrorCode =
  'invalid_input' | 'quota_exceeded' | 'audio_failed' | 'frame_extraction_failed';

export class TutorialMediaTranscoderError extends Error {
  constructor(readonly code: TutorialMediaTranscoderErrorCode) {
    super(
      code === 'invalid_input'
        ? 'The media transcoding input is invalid.'
        : code === 'quota_exceeded'
          ? 'The media transcoding output exceeded its quota.'
          : code === 'audio_failed'
            ? 'Audio extraction failed.'
            : 'Evidence frame extraction failed.',
    );
    this.name = 'TutorialMediaTranscoderError';
  }
}

export interface TutorialMediaTranscoder {
  extractAudio(
    sourcePath: string,
    analysisWindow: { readonly startMs: number; readonly endMs: number },
    signal?: AbortSignal,
  ): Promise<string>;
  extractFrame(sourcePath: string, timestampMs: number, signal?: AbortSignal): Promise<string>;
}

export interface TutorialMediaTranscoderOptions {
  readonly runner: TutorialMediaProcessRunner;
  readonly executable: string;
  readonly jobDirectory: string;
  readonly timeoutMs?: number;
  readonly maximumAudioBytes?: number;
  readonly maximumFrameBytes?: number;
}

function validPath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function requireOutput(path: string, maximumBytes: number): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (
    info === undefined ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1 ||
    info.size <= 0 ||
    info.size > maximumBytes
  ) {
    throw new TutorialMediaTranscoderError('invalid_input');
  }
}

async function requireDirectory(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new TutorialMediaTranscoderError('invalid_input');
  }
}

export function createTutorialMediaTranscoder(
  options: TutorialMediaTranscoderOptions,
): TutorialMediaTranscoder {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maximumAudioBytes = options.maximumAudioBytes ?? 512 * 1_024 * 1_024;
  const maximumFrameBytes = options.maximumFrameBytes ?? 32 * 1_024 * 1_024;
  if (
    !validPath(options.executable) ||
    !validPath(options.jobDirectory) ||
    !positiveSafeInteger(timeoutMs) ||
    !positiveSafeInteger(maximumAudioBytes) ||
    !positiveSafeInteger(maximumFrameBytes)
  ) {
    throw new TutorialMediaTranscoderError('invalid_input');
  }
  const audioDirectory = join(options.jobDirectory, 'audio');
  const frameDirectory = join(options.jobDirectory, 'frames');

  async function validateSource(sourcePath: string): Promise<void> {
    if (!validPath(sourcePath)) throw new TutorialMediaTranscoderError('invalid_input');
    const info = await lstat(sourcePath).catch(() => undefined);
    if (info === undefined || info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
      throw new TutorialMediaTranscoderError('invalid_input');
    }
  }

  return {
    async extractAudio(sourcePath, analysisWindow, signal) {
      await validateSource(sourcePath);
      if (
        !Number.isSafeInteger(analysisWindow.startMs) ||
        !Number.isSafeInteger(analysisWindow.endMs) ||
        analysisWindow.startMs < 0 ||
        analysisWindow.endMs <= analysisWindow.startMs ||
        analysisWindow.endMs > 86_400_000
      ) {
        throw new TutorialMediaTranscoderError('invalid_input');
      }
      const outputPath = join(audioDirectory, 'audio.wav');
      try {
        await mkdir(audioDirectory, { recursive: true, mode: 0o700 });
        await requireDirectory(audioDirectory);
        await runTutorialMediaProcessWithOutputFile({
          command: {
            executable: options.executable,
            cwd: options.jobDirectory,
            args: [
              '-nostdin',
              '-n',
              '-ss',
              (analysisWindow.startMs / 1_000).toFixed(3),
              '-i',
              sourcePath,
              '-t',
              ((analysisWindow.endMs - analysisWindow.startMs) / 1_000).toFixed(3),
              '-vn',
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'pcm_s16le',
              '-fs',
              String(maximumAudioBytes),
              outputPath,
            ],
          },
          maximumFileBytes: maximumAudioBytes,
          outputPath,
          runner: options.runner,
          runOptions: { signal, timeoutMs, maximumOutputBytes: 1 * 1_024 * 1_024 },
        });
        await requireOutput(outputPath, maximumAudioBytes);
        return outputPath;
      } catch (error) {
        if (error instanceof TutorialMediaProcessError && error.code === 'output_limit_exceeded') {
          throw new TutorialMediaTranscoderError('quota_exceeded');
        }
        if (error instanceof TutorialMediaTranscoderError && error.code === 'invalid_input') {
          throw new TutorialMediaTranscoderError('audio_failed');
        }
        throw new TutorialMediaTranscoderError('audio_failed');
      }
    },
    async extractFrame(sourcePath, timestampMs, signal) {
      await validateSource(sourcePath);
      if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs > 86_400_000) {
        throw new TutorialMediaTranscoderError('invalid_input');
      }
      const outputPath = join(frameDirectory, `frame-${String(timestampMs).padStart(8, '0')}.png`);
      try {
        await mkdir(frameDirectory, { recursive: true, mode: 0o700 });
        await requireDirectory(frameDirectory);
        await runTutorialMediaProcessWithOutputFile({
          command: {
            executable: options.executable,
            cwd: options.jobDirectory,
            args: [
              '-nostdin',
              '-n',
              '-ss',
              (timestampMs / 1_000).toFixed(3),
              '-i',
              sourcePath,
              '-frames:v',
              '1',
              '-f',
              'image2',
              '-vcodec',
              'png',
              '-fs',
              String(maximumFrameBytes),
              outputPath,
            ],
          },
          maximumFileBytes: maximumFrameBytes,
          outputPath,
          runner: options.runner,
          runOptions: { signal, timeoutMs, maximumOutputBytes: 1 * 1_024 * 1_024 },
        });
        await requireOutput(outputPath, maximumFrameBytes);
        return outputPath;
      } catch (error) {
        if (error instanceof TutorialMediaProcessError && error.code === 'output_limit_exceeded') {
          throw new TutorialMediaTranscoderError('quota_exceeded');
        }
        throw new TutorialMediaTranscoderError('frame_extraction_failed');
      }
    },
  };
}
