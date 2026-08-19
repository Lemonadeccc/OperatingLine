import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  canonicalizeProtocolJsonValue,
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaAsrSegmentMaxCount,
  procedureTutorialMediaFrameMaxCount,
  procedureTutorialMediaSemanticSegmentMaxCount,
  procedureTutorialMediaVisualCandidateMaxCount,
  type ProcedureTutorialMediaAnalysisRequest,
  type ProcedureTutorialMediaAnalysisResult,
  type ProcedureTutorialMediaArtifactRef,
  type ProcedureTutorialMediaStage,
} from '@operatingline/protocol';

import type { TutorialMediaArtifactStore } from './tutorial-media-artifact-store.js';
import type { TutorialMediaAsr } from './tutorial-media-asr.js';
import type { TutorialMediaOcr } from './tutorial-media-ocr.js';
import type { TutorialMediaProbe } from './tutorial-media-probe.js';
import {
  createTutorialFrameTimestamps,
  segmentTutorialTimeline,
} from './tutorial-media-timeline.js';
import type { TutorialMediaTranscoder } from './tutorial-media-transcoder.js';
import type { YouTubeMediaSource } from './youtube-media-source.js';

const canonicalStages = [
  'download',
  'probe',
  'audio',
  'asr',
  'frames',
  'ocr',
  'segmentation',
] as const satisfies readonly ProcedureTutorialMediaStage[];
const defaultMaximumAnalysisWindowMs = 4 * 60 * 60 * 1_000;
const defaultMaximumJobRuntimeMs = 2 * 60 * 60 * 1_000;
const defaultMaximumStagingBytes = 8 * 1_024 * 1_024 * 1_024;
const maximumStagingEntries = 20_000;
const stagingPollIntervalMs = 25;
const defaultStageTimeoutsMs: Readonly<Record<ProcedureTutorialMediaStage, number>> = {
  download: 30 * 60 * 1_000,
  probe: 2 * 60 * 1_000,
  audio: 15 * 60 * 1_000,
  asr: 60 * 60 * 1_000,
  frames: 30 * 60 * 1_000,
  ocr: 30 * 60 * 1_000,
  segmentation: 2 * 60 * 1_000,
};

type ToolProvenance = ProcedureTutorialMediaAnalysisResult['tools'][number];

export interface ProcedureTutorialMediaAdapters {
  readonly source: YouTubeMediaSource;
  readonly probe: TutorialMediaProbe;
  readonly transcoder: TutorialMediaTranscoder;
  readonly asr: TutorialMediaAsr;
  readonly ocr: TutorialMediaOcr;
  readonly toolProvenance?: (() => Promise<readonly ToolProvenance[]>) | undefined;
  readonly close?: (() => Promise<void>) | undefined;
}

export interface ProcedureTutorialMediaPipelineOptions {
  readonly store: TutorialMediaArtifactStore;
  readonly createAdapters: (jobDirectory: string) => ProcedureTutorialMediaAdapters;
  readonly tools: readonly ToolProvenance[];
  readonly maximumFrames?: number | undefined;
  readonly maximumAnalysisWindowMs?: number | undefined;
  readonly maximumJobRuntimeMs?: number | undefined;
  readonly maximumStagingBytes?: number | undefined;
  readonly stageTimeoutsMs?:
    Partial<Readonly<Record<ProcedureTutorialMediaStage, number>>> | undefined;
  readonly supportedLocales?: readonly string[] | undefined;
  readonly frameIntervalMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface ProcedureTutorialMediaPipelineRunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onStage?:
    | ((update: {
        readonly stage: ProcedureTutorialMediaStage;
        readonly state: 'started' | 'completed';
      }) => void | Promise<void>)
    | undefined;
}

export interface ProcedureTutorialMediaPipeline {
  analyze(
    request: ProcedureTutorialMediaAnalysisRequest,
    jobId: string,
    options?: ProcedureTutorialMediaPipelineRunOptions,
  ): Promise<ProcedureTutorialMediaAnalysisResult>;
  verify(
    result: ProcedureTutorialMediaAnalysisResult,
  ): Promise<ProcedureTutorialMediaAnalysisResult>;
  close(): Promise<void>;
}

export type ProcedureTutorialMediaPipelineErrorCode =
  | 'invalid_input'
  | 'authorization_required'
  | 'authorization_expired'
  | 'quota_exceeded'
  | 'unsupported_media'
  | 'unsupported_locale'
  | 'integrity_failed'
  | 'deadline_exceeded'
  | 'cancelled'
  | 'pipeline_failed';

export class ProcedureTutorialMediaPipelineError extends Error {
  constructor(
    readonly code: ProcedureTutorialMediaPipelineErrorCode,
    readonly stage: ProcedureTutorialMediaStage | null,
    options?: ErrorOptions,
  ) {
    super(
      code === 'invalid_input'
        ? 'The tutorial media analysis input is invalid.'
        : code === 'authorization_required'
          ? 'Tutorial media download authorization is required.'
          : code === 'authorization_expired'
            ? 'Tutorial media download authorization has expired.'
            : code === 'quota_exceeded'
              ? 'Tutorial media analysis exceeded a configured resource limit.'
              : code === 'unsupported_media'
                ? 'The tutorial media source is unsupported.'
                : code === 'unsupported_locale'
                  ? 'The tutorial media analysis locale is unsupported.'
                  : code === 'integrity_failed'
                    ? 'Tutorial media artifact integrity verification failed.'
                    : code === 'deadline_exceeded'
                      ? 'Tutorial media analysis exceeded its execution deadline.'
                      : code === 'cancelled'
                        ? 'Tutorial media analysis was cancelled.'
                        : 'Tutorial media analysis failed.',
      options,
    );
    this.name = 'ProcedureTutorialMediaPipelineError';
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableUuid(parts: readonly (string | number)[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

async function* oneChunk(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield value;
}

async function stagingDirectoryBytes(directory: string): Promise<number> {
  const root = await lstat(directory);
  const userId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    root.isSymbolicLink() ||
    !root.isDirectory() ||
    (userId !== undefined && root.uid !== userId) ||
    (process.platform !== 'win32' && (root.mode & 0o777) !== 0o700)
  ) {
    throw Object.assign(new Error('Unsafe tutorial media staging directory.'), {
      code: 'unsafe_storage',
    });
  }

  let bytes = 0;
  let entryCount = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const name of await readdir(current)) {
      entryCount += 1;
      if (entryCount > maximumStagingEntries) return Number.POSITIVE_INFINITY;
      const path = join(current, name);
      let info;
      try {
        info = await lstat(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
      if (info.isSymbolicLink() || (userId !== undefined && info.uid !== userId)) {
        throw Object.assign(new Error('Unsafe tutorial media staging entry.'), {
          code: 'unsafe_storage',
        });
      }
      if (info.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1 || !Number.isSafeInteger(info.size)) {
        throw Object.assign(new Error('Unsafe tutorial media staging entry.'), {
          code: 'unsafe_storage',
        });
      }
      bytes += info.size;
      if (!Number.isSafeInteger(bytes)) return Number.POSITIVE_INFINITY;
    }
  }
  return bytes;
}

function artifactRef(
  artifact: { readonly uri: string; readonly sha256: string; readonly sizeBytes: number },
  role: ProcedureTutorialMediaArtifactRef['role'],
  mediaType: ProcedureTutorialMediaArtifactRef['mediaType'],
  createdAt: string,
  sourceSha256?: string,
): ProcedureTutorialMediaArtifactRef {
  return {
    bytes: artifact.sizeBytes,
    createdAt,
    mediaType,
    role,
    sha256: artifact.sha256,
    ...(sourceSha256 === undefined ? {} : { sourceSha256 }),
    uri: artifact.uri as ProcedureTutorialMediaArtifactRef['uri'],
  };
}

function abortError(
  stage: ProcedureTutorialMediaStage | null,
): ProcedureTutorialMediaPipelineError {
  return new ProcedureTutorialMediaPipelineError('cancelled', stage);
}

function publicPipelineError(
  error: unknown,
  stage: ProcedureTutorialMediaStage | null,
): ProcedureTutorialMediaPipelineError {
  if (error instanceof ProcedureTutorialMediaPipelineError) return error;
  if (error instanceof Error && error.name === 'AbortError') return abortError(stage);
  if (error instanceof Error && 'code' in error && error.code === 'authorization_required') {
    return new ProcedureTutorialMediaPipelineError('authorization_required', stage, {
      cause: error,
    });
  }
  if (error instanceof Error && 'code' in error && error.code === 'authorization_expired') {
    return new ProcedureTutorialMediaPipelineError('authorization_expired', stage, {
      cause: error,
    });
  }
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'quota_exceeded' ||
      error.code === 'artifact_too_large' ||
      error.code === 'artifact_read_too_large')
  ) {
    return new ProcedureTutorialMediaPipelineError('quota_exceeded', stage, { cause: error });
  }
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'artifact_integrity_failed' ||
      error.code === 'unsafe_storage' ||
      error.code === 'invalid_download')
  ) {
    return new ProcedureTutorialMediaPipelineError('integrity_failed', stage, { cause: error });
  }
  const code =
    error instanceof Error && 'code' in error && error.code === 'unsupported_media'
      ? 'unsupported_media'
      : 'pipeline_failed';
  return new ProcedureTutorialMediaPipelineError(code, stage, { cause: error });
}

function manifestProjection(
  result: Omit<ProcedureTutorialMediaAnalysisResult, 'manifestIntegrity'>,
) {
  return {
    analysisProfile: result.analysisProfile,
    analysisWindow: result.analysisWindow,
    artifacts: result.artifacts.filter((artifact) => artifact.role !== 'analysis_manifest'),
    asrSegments: result.asrSegments,
    completedAt: result.completedAt,
    completedStages: result.completedStages,
    formatVersion: result.formatVersion,
    frames: result.frames,
    jobId: result.jobId,
    locale: result.locale,
    ocrCandidates: result.ocrCandidates,
    probe: result.probe,
    requestId: result.requestId,
    segmentation: result.segmentation,
    semanticSegments: result.semanticSegments,
    shortcutCandidates: result.shortcutCandidates,
    sideEffects: result.sideEffects,
    tools: result.tools,
    uiCandidates: result.uiCandidates,
    videoId: result.videoId,
  };
}

export function createProcedureTutorialMediaPipeline(
  options: ProcedureTutorialMediaPipelineOptions,
): ProcedureTutorialMediaPipeline {
  const maximumFrames = options.maximumFrames ?? procedureTutorialMediaFrameMaxCount;
  const maximumAnalysisWindowMs = options.maximumAnalysisWindowMs ?? defaultMaximumAnalysisWindowMs;
  const maximumJobRuntimeMs = options.maximumJobRuntimeMs ?? defaultMaximumJobRuntimeMs;
  const maximumStagingBytes = options.maximumStagingBytes ?? defaultMaximumStagingBytes;
  const stageTimeoutsMs = { ...defaultStageTimeoutsMs, ...options.stageTimeoutsMs };
  const supportedLocales = (options.supportedLocales ?? ['en']).map((locale) =>
    locale.toLowerCase(),
  );
  const frameIntervalMs = options.frameIntervalMs ?? 5_000;
  if (
    options.tools.length === 0 ||
    !Number.isSafeInteger(maximumFrames) ||
    maximumFrames <= 0 ||
    maximumFrames > procedureTutorialMediaFrameMaxCount ||
    !Number.isSafeInteger(maximumAnalysisWindowMs) ||
    maximumAnalysisWindowMs <= 0 ||
    !Number.isSafeInteger(maximumJobRuntimeMs) ||
    maximumJobRuntimeMs <= 0 ||
    !Number.isSafeInteger(maximumStagingBytes) ||
    maximumStagingBytes <= 0 ||
    supportedLocales.length === 0 ||
    new Set(supportedLocales).size !== supportedLocales.length ||
    supportedLocales.some((locale) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(locale)) ||
    canonicalStages.some(
      (stage) => !Number.isSafeInteger(stageTimeoutsMs[stage]) || stageTimeoutsMs[stage] <= 0,
    ) ||
    !Number.isSafeInteger(frameIntervalMs) ||
    frameIntervalMs <= 0
  ) {
    throw new ProcedureTutorialMediaPipelineError('invalid_input', null);
  }
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const active = new Map<AbortController, Promise<void>>();
  let closing = false;

  async function verify(
    input: ProcedureTutorialMediaAnalysisResult,
  ): Promise<ProcedureTutorialMediaAnalysisResult> {
    let result: ProcedureTutorialMediaAnalysisResult;
    try {
      result = procedureTutorialMediaAnalysisResultSchema.parse(input);
      const inspected: Awaited<ReturnType<TutorialMediaArtifactStore['inspect']>>[] = [];
      for (const artifact of result.artifacts) {
        inspected.push(await options.store.inspect(artifact.uri));
      }
      for (const [index, actual] of inspected.entries()) {
        const declared = result.artifacts[index]!;
        if (
          actual.uri !== declared.uri ||
          actual.sha256 !== declared.sha256 ||
          actual.sizeBytes !== declared.bytes
        ) {
          throw new Error('artifact declaration mismatch');
        }
      }
      const manifestArtifact = result.artifacts.find(
        (artifact) => artifact.role === 'analysis_manifest',
      )!;
      const manifestBytes = await options.store.read(manifestArtifact.uri);
      const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as {
        artifactUris?: unknown;
        formatVersion?: unknown;
        jobId?: unknown;
        requestId?: unknown;
        rootSha256?: unknown;
      };
      const expectedProjection = manifestProjection(result);
      const expectedArtifactUris = expectedProjection.artifacts.map((artifact) => artifact.uri);
      if (
        sha256(manifestBytes) !== result.manifestIntegrity.manifestSha256 ||
        manifest.formatVersion !== result.formatVersion ||
        manifest.requestId !== result.requestId ||
        manifest.jobId !== result.jobId ||
        manifest.rootSha256 !== result.manifestIntegrity.rootSha256 ||
        sha256(canonicalizeProtocolJsonValue(expectedProjection)) !==
          result.manifestIntegrity.rootSha256 ||
        Buffer.compare(
          Buffer.from(canonicalizeProtocolJsonValue(manifest.artifactUris)),
          Buffer.from(canonicalizeProtocolJsonValue(expectedArtifactUris)),
        ) !== 0
      ) {
        throw new Error('manifest mismatch');
      }
    } catch (error) {
      throw new ProcedureTutorialMediaPipelineError('integrity_failed', null, { cause: error });
    }
    return structuredClone(result);
  }

  return {
    async analyze(requestInput, jobId, runOptions = {}) {
      if (closing) throw abortError(null);
      const requestResult = procedureTutorialMediaAnalysisRequestSchema.safeParse(requestInput);
      if (
        !requestResult.success ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          jobId,
        ) ||
        requestResult.data.requestId === jobId
      ) {
        throw new ProcedureTutorialMediaPipelineError('invalid_input', null);
      }
      const request = requestResult.data;
      const normalizedLocale = request.locale.toLowerCase();
      const primaryLocale = normalizedLocale.split('-')[0]!;
      if (
        !supportedLocales.includes(normalizedLocale) &&
        !supportedLocales.includes(primaryLocale)
      ) {
        throw new ProcedureTutorialMediaPipelineError('unsupported_locale', null);
      }
      if (request.analysisWindow.endMs - request.analysisWindow.startMs > maximumAnalysisWindowMs) {
        throw new ProcedureTutorialMediaPipelineError('quota_exceeded', 'audio');
      }
      const controller = new AbortController();
      let cancellationRequested = false;
      const abort = () => {
        cancellationRequested = true;
        controller.abort();
      };
      runOptions.signal?.addEventListener('abort', abort, { once: true });
      if (runOptions.signal?.aborted) abort();
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      active.set(controller, completion);
      let staging: Awaited<ReturnType<TutorialMediaArtifactStore['createJobStagingDirectory']>>;
      try {
        staging = await options.store.createJobStagingDirectory(jobId);
      } catch (error) {
        runOptions.signal?.removeEventListener('abort', abort);
        active.delete(controller);
        resolveCompletion();
        throw cancellationRequested || closing
          ? abortError(null)
          : publicPipelineError(error, null);
      }
      if (closing) controller.abort();
      let currentStage: ProcedureTutorialMediaStage | null = 'download';
      let deadlineStage: ProcedureTutorialMediaStage | null = null;
      let monitorError: ProcedureTutorialMediaPipelineError | undefined;
      let stopMonitor!: () => void;
      let monitorStopped = false;
      const monitorStop = new Promise<void>((resolve) => {
        stopMonitor = resolve;
      });
      const enforceStagingQuota = async (stageName: ProcedureTutorialMediaStage | null) => {
        let bytes: number;
        try {
          bytes = await stagingDirectoryBytes(staging.path);
        } catch (error) {
          throw publicPipelineError(error, stageName);
        }
        if (bytes > maximumStagingBytes) {
          throw new ProcedureTutorialMediaPipelineError('quota_exceeded', stageName);
        }
      };
      const stagingMonitor = (async () => {
        while (!monitorStopped) {
          try {
            await enforceStagingQuota(currentStage);
          } catch (error) {
            monitorError = publicPipelineError(error, currentStage);
            controller.abort();
            return;
          }
          await Promise.race([
            monitorStop,
            new Promise<void>((resolve) => setTimeout(resolve, stagingPollIntervalMs)),
          ]);
        }
      })();
      let stageTimer: NodeJS.Timeout | undefined;
      const jobTimer = setTimeout(() => {
        deadlineStage ??= currentStage ?? 'download';
        controller.abort();
      }, maximumJobRuntimeMs);
      const startStageDeadline = (name: ProcedureTutorialMediaStage) => {
        clearTimeout(stageTimer);
        stageTimer = setTimeout(() => {
          deadlineStage ??= name;
          controller.abort();
        }, stageTimeoutsMs[name]);
      };
      const clearStageDeadline = () => {
        clearTimeout(stageTimer);
        stageTimer = undefined;
      };
      const stage = async <Value>(
        name: ProcedureTutorialMediaStage,
        operation: () => Promise<Value>,
      ): Promise<Value> => {
        currentStage = name;
        if (controller.signal.aborted) throw abortError(name);
        startStageDeadline(name);
        try {
          await runOptions.onStage?.({ stage: name, state: 'started' });
          const value = await operation();
          if (controller.signal.aborted) throw abortError(name);
          await enforceStagingQuota(name);
          await runOptions.onStage?.({ stage: name, state: 'completed' });
          return value;
        } finally {
          clearStageDeadline();
        }
      };
      let primaryError: ProcedureTutorialMediaPipelineError | undefined;
      let completedResult: ProcedureTutorialMediaAnalysisResult | undefined;
      let adapters: ProcedureTutorialMediaAdapters | undefined;
      try {
        const jobAdapters = options.createAdapters(staging.path);
        adapters = jobAdapters;
        const source = await stage('download', async () => {
          const downloaded = await jobAdapters.source.download({
            request,
            signal: controller.signal,
          });
          await enforceStagingQuota('download');
          const stored = await options.store.putFile(downloaded.mediaPath, { removeSource: true });
          return artifactRef(stored, 'source_video', 'video/mp4', now());
        });
        const probe = await stage('probe', async () => {
          const probed = await options.store.use(source.uri, (sourcePath) =>
            jobAdapters.probe.probe(sourcePath, controller.signal),
          );
          if (probed.audio === null || probed.durationMs < request.analysisWindow.endMs) {
            throw new ProcedureTutorialMediaPipelineError('unsupported_media', 'probe');
          }
          return { ...probed, sourceArtifactUri: source.uri };
        });

        const audio = await stage('audio', async () => {
          const audioPath = await options.store.use(source.uri, (sourcePath) =>
            jobAdapters.transcoder.extractAudio(
              sourcePath,
              request.analysisWindow,
              controller.signal,
            ),
          );
          await enforceStagingQuota('audio');
          const stored = await options.store.putFile(audioPath, { removeSource: true });
          return artifactRef(stored, 'audio_track', 'audio/wav', now(), source.sha256);
        });
        const { asrSegments, transcript } = await stage('asr', async () => {
          const all = await options.store.use(audio.uri, (audioPath) =>
            jobAdapters.asr.transcribe(audioPath, request.locale, controller.signal),
          );
          const withinWindow = all
            .map((segment) => {
              const startMs = segment.startMs + request.analysisWindow.startMs;
              const endMs = segment.endMs + request.analysisWindow.startMs;
              return {
                ...segment,
                endMs,
                segmentId: stableUuid([request.locale, startMs, endMs, segment.text]),
                startMs,
              };
            })
            .filter(
              (segment) =>
                segment.startMs >= request.analysisWindow.startMs &&
                segment.endMs <= request.analysisWindow.endMs,
            );
          if (withinWindow.length > procedureTutorialMediaAsrSegmentMaxCount) {
            throw new ProcedureTutorialMediaPipelineError('quota_exceeded', 'asr');
          }
          const asrSegments = withinWindow.map((segment, index) => ({
            ...segment,
            order: index + 1,
          }));
          const stored = await options.store.put(
            oneChunk(Buffer.from(JSON.stringify({ asrSegments }), 'utf8')),
          );
          return {
            asrSegments,
            transcript: artifactRef(
              stored,
              'asr_transcript',
              'application/json',
              now(),
              source.sha256,
            ),
          };
        });

        const timestamps = createTutorialFrameTimestamps({
          asrSegments,
          intervalMs: frameIntervalMs,
          maximumFrames,
          windowEndMs: request.analysisWindow.endMs,
          windowStartMs: request.analysisWindow.startMs,
        });
        const frames = await stage('frames', async () => {
          const records: ProcedureTutorialMediaAnalysisResult['frames'] = [];
          for (const [index, timestampMs] of timestamps.entries()) {
            const framePath = await options.store.use(source.uri, (sourcePath) =>
              jobAdapters.transcoder.extractFrame(sourcePath, timestampMs, controller.signal),
            );
            await enforceStagingQuota('frames');
            const stored = await options.store.putFile(framePath, { removeSource: true });
            records.push({
              artifact: artifactRef(stored, 'evidence_frame', 'image/png', now(), source.sha256),
              frameId: stableUuid([source.sha256, timestampMs]),
              order: index + 1,
              timestampMs,
            });
          }
          return records;
        });

        const { observations, ocrArtifact } = await stage('ocr', async () => {
          const ocrCandidates: ProcedureTutorialMediaAnalysisResult['ocrCandidates'] = [];
          const shortcutCandidates: ProcedureTutorialMediaAnalysisResult['shortcutCandidates'] = [];
          for (const frame of frames) {
            const result = await options.store.use(frame.artifact.uri, (framePath) =>
              jobAdapters.ocr.analyze({
                frameId: frame.frameId,
                framePath,
                height: probe.video.height,
                locale: request.locale,
                signal: controller.signal,
                timestampMs: frame.timestampMs,
                width: probe.video.width,
              }),
            );
            if (
              ocrCandidates.length + result.ocrCandidates.length >
                procedureTutorialMediaVisualCandidateMaxCount ||
              shortcutCandidates.length + result.shortcutCandidates.length >
                procedureTutorialMediaVisualCandidateMaxCount
            ) {
              throw new ProcedureTutorialMediaPipelineError('quota_exceeded', 'ocr');
            }
            ocrCandidates.push(...result.ocrCandidates);
            shortcutCandidates.push(
              ...result.shortcutCandidates.map((candidate) => ({
                ...candidate,
                keys: [...candidate.keys],
              })),
            );
          }
          const observations = { ocrCandidates, shortcutCandidates };
          const stored = await options.store.put(
            oneChunk(Buffer.from(JSON.stringify(observations), 'utf8')),
          );
          return {
            observations,
            ocrArtifact: artifactRef(
              stored,
              'ocr_observations',
              'application/json',
              now(),
              source.sha256,
            ),
          };
        });

        const segmentationInput = {
          asrSegments,
          frames: frames.map((frame) => ({
            artifactUri: frame.artifact.uri,
            frameId: frame.frameId,
            timestampMs: frame.timestampMs,
          })),
          ocrCandidates: observations.ocrCandidates,
          shortcutCandidates: observations.shortcutCandidates,
          transcriptArtifactUri: transcript.uri,
          uiCandidates: [],
          windowEndMs: request.analysisWindow.endMs,
          windowStartMs: request.analysisWindow.startMs,
        };
        currentStage = 'segmentation';
        if (controller.signal.aborted) throw abortError('segmentation');
        startStageDeadline('segmentation');
        await runOptions.onStage?.({ stage: 'segmentation', state: 'started' });
        const segmented = segmentTutorialTimeline(segmentationInput);
        if (segmented.length > procedureTutorialMediaSemanticSegmentMaxCount) {
          throw new ProcedureTutorialMediaPipelineError('quota_exceeded', 'segmentation');
        }
        const semanticSegments = segmented.map((segment) => ({
          ...segment,
          asrSegmentIds: [...segment.asrSegmentIds],
          evidence: segment.evidence.map((evidence) => ({ ...evidence })),
          ocrCandidateIds: [...segment.ocrCandidateIds],
          shortcutCandidateIds: [...segment.shortcutCandidateIds],
          uiCandidateIds: [...segment.uiCandidateIds],
        }));
        const segmentationInputSha256 = sha256(canonicalizeProtocolJsonValue(segmentationInput));
        const segmentationOutputSha256 = sha256(canonicalizeProtocolJsonValue(semanticSegments));
        const completedAt = now();
        const nonManifestArtifacts = [
          source,
          audio,
          transcript,
          ...frames.map((frame) => frame.artifact),
          ocrArtifact,
        ];
        const draft = {
          analysisProfile: request.analysisProfile,
          analysisWindow: request.analysisWindow,
          artifacts: nonManifestArtifacts,
          asrSegments,
          completedAt,
          completedStages: [...canonicalStages],
          formatVersion: request.formatVersion,
          frames,
          jobId,
          locale: request.locale,
          ocrCandidates: observations.ocrCandidates,
          probe,
          requestId: request.requestId,
          segmentation: {
            algorithmId: 'operatingline.deterministic_tutorial_segmentation' as const,
            algorithmVersion: '1.0.0',
            inputSha256: segmentationInputSha256,
            outputSha256: segmentationOutputSha256,
          },
          semanticSegments,
          shortcutCandidates: observations.shortcutCandidates,
          sideEffects: {
            audioDerived: true,
            framesDerived: true,
            hostExecutionStarted: false,
            localAsrModelRun: true,
            localOcrRun: true,
            mediaDownloaded: true,
            networkFetched: true,
            procedureStored: false,
            proposalCreated: false,
            providerCalled: false,
          },
          tools: [
            ...(jobAdapters.toolProvenance === undefined
              ? options.tools
              : await jobAdapters.toolProvenance()),
          ],
          uiCandidates: [],
          videoId: request.videoId,
        } satisfies Omit<ProcedureTutorialMediaAnalysisResult, 'manifestIntegrity'>;
        const rootSha256 = sha256(canonicalizeProtocolJsonValue(manifestProjection(draft)));
        const manifestBytes = Buffer.from(
          JSON.stringify({
            artifactUris: nonManifestArtifacts.map((artifact) => artifact.uri),
            formatVersion: request.formatVersion,
            jobId,
            requestId: request.requestId,
            rootSha256,
          }),
          'utf8',
        );
        const manifestStored = await options.store.put(oneChunk(manifestBytes));
        const manifest = artifactRef(
          manifestStored,
          'analysis_manifest',
          'application/json',
          completedAt,
          source.sha256,
        );
        const result = procedureTutorialMediaAnalysisResultSchema.parse({
          ...draft,
          artifacts: [...nonManifestArtifacts, manifest],
          manifestIntegrity: {
            artifactCount: nonManifestArtifacts.length + 1,
            generatedAt: manifest.createdAt,
            manifestArtifactUri: manifest.uri,
            manifestSha256: manifest.sha256,
            rootSha256,
          },
        });
        const verified = await verify(result);
        if (controller.signal.aborted) throw abortError('segmentation');
        await enforceStagingQuota('segmentation');
        await runOptions.onStage?.({ stage: 'segmentation', state: 'completed' });
        clearStageDeadline();
        completedResult = verified;
      } catch (error) {
        primaryError =
          deadlineStage === null
            ? cancellationRequested || closing
              ? abortError(currentStage)
              : (monitorError ??
                (controller.signal.aborted
                  ? abortError(currentStage)
                  : publicPipelineError(error, currentStage)))
            : new ProcedureTutorialMediaPipelineError('deadline_exceeded', deadlineStage, {
                cause: error,
              });
      }
      monitorStopped = true;
      stopMonitor();
      await stagingMonitor;
      if (primaryError === undefined) {
        primaryError =
          deadlineStage !== null
            ? new ProcedureTutorialMediaPipelineError('deadline_exceeded', deadlineStage)
            : cancellationRequested || closing
              ? abortError(currentStage)
              : (monitorError ??
                (controller.signal.aborted ? abortError(currentStage) : undefined));
      }
      clearStageDeadline();
      clearTimeout(jobTimer);
      runOptions.signal?.removeEventListener('abort', abort);
      const cleanupErrors: unknown[] = [];
      try {
        await adapters?.close?.();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await staging.cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
      active.delete(controller);
      resolveCompletion();
      if (cleanupErrors.length > 0) {
        const cleanupError = new AggregateError(
          cleanupErrors,
          'Tutorial media task resources could not be fully cleaned up.',
        );
        if (primaryError !== undefined) {
          throw new ProcedureTutorialMediaPipelineError(primaryError.code, primaryError.stage, {
            cause: new AggregateError(
              [primaryError, cleanupError],
              'Tutorial media analysis and staging cleanup both failed.',
            ),
          });
        }
        throw new ProcedureTutorialMediaPipelineError('pipeline_failed', currentStage, {
          cause: cleanupError,
        });
      }
      if (primaryError !== undefined) throw primaryError;
      if (completedResult === undefined)
        throw new ProcedureTutorialMediaPipelineError('pipeline_failed', currentStage);
      return completedResult;
    },
    verify,
    async close() {
      closing = true;
      const completions = [...active.values()];
      for (const controller of active.keys()) controller.abort();
      await Promise.all(completions);
      await options.store.cleanup();
    },
  };
}
