import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  runTutorialMediaProcessWithOutputFile,
  TutorialMediaProcessError,
  type TutorialMediaProcessRunner,
} from './tutorial-media-process.js';

const maximumTranscriptBytes = 16 * 1_024 * 1_024;

export type TutorialMediaAsrErrorCode = 'invalid_input' | 'quota_exceeded' | 'asr_failed';

export class TutorialMediaAsrError extends Error {
  constructor(readonly code: TutorialMediaAsrErrorCode) {
    super(
      code === 'invalid_input'
        ? 'The speech recognition input is invalid.'
        : code === 'quota_exceeded'
          ? 'The speech recognition output exceeded its quota.'
          : 'Speech recognition failed.',
    );
    this.name = 'TutorialMediaAsrError';
  }
}

export interface TutorialMediaAsrSegment {
  readonly segmentId: string;
  readonly order: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly locale: string;
  readonly confidence: null;
  readonly metrics: {
    readonly averageLogProbability: number | null;
    readonly noSpeechProbability: number | null;
    readonly compressionRatio: number | null;
  };
}

export interface TutorialMediaAsr {
  transcribe(
    audioPath: string,
    locale: string,
    signal?: AbortSignal,
  ): Promise<readonly TutorialMediaAsrSegment[]>;
}

export interface TutorialMediaAsrOptions {
  readonly runner: TutorialMediaProcessRunner;
  readonly executable: string;
  readonly modelPath: string;
  readonly jobDirectory: string;
  readonly timeoutMs?: number;
}

function validPath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteMetric(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function stableUuid(parts: readonly (string | number)[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function offset(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 86_400_000
    ? (value as number)
    : undefined;
}

function whisperLanguage(locale: string): string | undefined {
  const language = locale.split('-')[0]?.toLowerCase();
  return language !== undefined && /^[a-z]{2,3}$/u.test(language) ? language : undefined;
}

function parseTranscript(bytes: Uint8Array, locale: string): readonly TutorialMediaAsrSegment[] {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumTranscriptBytes) {
    throw new TutorialMediaAsrError('asr_failed');
  }
  let root: Record<string, unknown> | undefined;
  try {
    root = record(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    throw new TutorialMediaAsrError('asr_failed');
  }
  const result = record(root?.result);
  const expectedLanguage = whisperLanguage(locale);
  if (
    record(root?.params) === undefined ||
    result === undefined ||
    expectedLanguage === undefined ||
    result.language !== expectedLanguage ||
    !Array.isArray(root?.transcription)
  ) {
    throw new TutorialMediaAsrError('asr_failed');
  }
  const segments: TutorialMediaAsrSegment[] = [];
  let previousEndMs = 0;
  for (const [index, item] of root.transcription.entries()) {
    const segment = record(item);
    const offsets = record(segment?.offsets);
    const startMs = offset(offsets?.from);
    const endMs = offset(offsets?.to);
    const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
    if (
      startMs === undefined ||
      endMs === undefined ||
      endMs <= startMs ||
      startMs < previousEndMs ||
      text.length === 0 ||
      text.length > 20_000
    ) {
      throw new TutorialMediaAsrError('asr_failed');
    }
    const metrics = record(segment?.metrics) ?? segment!;
    segments.push({
      confidence: null,
      endMs,
      locale,
      metrics: {
        averageLogProbability: finiteMetric(
          metrics.avg_logprob ?? metrics.average_log_probability,
          -100,
          0,
        ),
        compressionRatio: finiteMetric(metrics.compression_ratio, 0, 100),
        noSpeechProbability: finiteMetric(
          metrics.no_speech_prob ?? metrics.no_speech_probability,
          0,
          1,
        ),
      },
      order: index + 1,
      segmentId: stableUuid([locale, startMs, endMs, text]),
      startMs,
      text,
    });
    previousEndMs = endMs;
  }
  return segments;
}

export function createTutorialMediaAsr(options: TutorialMediaAsrOptions): TutorialMediaAsr {
  if (
    !validPath(options.executable) ||
    !validPath(options.modelPath) ||
    !validPath(options.jobDirectory)
  ) {
    throw new TutorialMediaAsrError('invalid_input');
  }
  const outputBase = join(options.jobDirectory, 'asr', 'transcript');
  const outputPath = `${outputBase}.json`;
  return {
    async transcribe(audioPath, locale, signal) {
      const language = whisperLanguage(locale);
      if (
        !validPath(audioPath) ||
        !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(locale) ||
        language === undefined
      ) {
        throw new TutorialMediaAsrError('invalid_input');
      }
      try {
        const [audio, model] = await Promise.all([lstat(audioPath), lstat(options.modelPath)]);
        if (
          audio.isSymbolicLink() ||
          !audio.isFile() ||
          audio.size <= 0 ||
          model.isSymbolicLink() ||
          !model.isFile() ||
          model.size <= 0
        ) {
          throw new TutorialMediaAsrError('invalid_input');
        }
        const outputDirectory = join(options.jobDirectory, 'asr');
        await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
        const outputDirectoryInfo = await lstat(outputDirectory);
        if (outputDirectoryInfo.isSymbolicLink() || !outputDirectoryInfo.isDirectory()) {
          throw new TutorialMediaAsrError('asr_failed');
        }
        await runTutorialMediaProcessWithOutputFile({
          command: {
            executable: options.executable,
            cwd: options.jobDirectory,
            args: [
              '-m',
              options.modelPath,
              '-f',
              audioPath,
              '-l',
              language,
              '-ojf',
              '-of',
              outputBase,
              '-np',
            ],
          },
          maximumFileBytes: maximumTranscriptBytes,
          outputPath,
          runner: options.runner,
          runOptions: {
            signal,
            timeoutMs: options.timeoutMs ?? 1_800_000,
            maximumOutputBytes: 1 * 1_024 * 1_024,
          },
        });
        const info = await lstat(outputPath);
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          info.size <= 0 ||
          info.size > maximumTranscriptBytes
        ) {
          throw new TutorialMediaAsrError('asr_failed');
        }
        return parseTranscript(await readFile(outputPath), locale);
      } catch (error) {
        if (error instanceof TutorialMediaAsrError && error.code === 'invalid_input') throw error;
        if (error instanceof TutorialMediaProcessError && error.code === 'output_limit_exceeded') {
          throw new TutorialMediaAsrError('quota_exceeded');
        }
        throw new TutorialMediaAsrError('asr_failed');
      }
    },
  };
}
