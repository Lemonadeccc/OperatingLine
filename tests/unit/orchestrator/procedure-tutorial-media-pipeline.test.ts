import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaVisualCandidateMaxCount,
  type ProcedureTutorialMediaAnalysisRequest,
} from '@operatingline/protocol';
import { createTutorialMediaArtifactStore } from '../../../services/orchestrator/src/tutorial-media-artifact-store.js';
import {
  createProcedureTutorialMediaPipeline,
  ProcedureTutorialMediaPipelineError,
  type ProcedureTutorialMediaAdapters,
} from '../../../services/orchestrator/src/procedure-tutorial-media-pipeline.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableUuid(value: string): string {
  const hex = digest(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

const request: ProcedureTutorialMediaAnalysisRequest = {
  analysisProfile: 'youtube_tutorial_evidence_v1',
  analysisWindow: { endMs: 1_000, startMs: 0 },
  approvals: {
    mediaDownloadApproved: true,
    networkAccessApproved: true,
    retentionApproved: true,
  },
  formatVersion: '1.0.0',
  locale: 'en',
  platformDownloadAuthorization: {
    basis: 'youtube_written_approval',
    confirmedAt: '2026-08-18T00:00:00.000Z',
    reference: 'youtube-approval-1',
  },
  requestId: '11111111-1111-4111-8111-111111111111',
  requestedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  rightsAuthorization: {
    basis: 'rights_holder_permission',
    confirmedAt: '2026-08-18T00:00:00.000Z',
    reference: 'rights-1',
  },
  videoId: 'abcdefghijk',
};

async function fixture(
  options: {
    readonly blockDownload?: boolean;
    readonly blockDownloadAfterWrite?: boolean;
    readonly blockStagingCreation?: boolean;
    readonly candidateCount?: number;
    readonly cleanupFails?: boolean;
    readonly downloadContents?: string;
    readonly downloadDelayMs?: number;
    readonly downloadErrorCode?: string;
    readonly maximumJobRuntimeMs?: number;
    readonly maximumStagingBytes?: number;
    readonly unsafeStagingEntry?: boolean;
  } = {},
) {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-pipeline-'));
  temporaryDirectories.push(baseDirectory);
  const store = createTutorialMediaArtifactStore({ baseDirectory });
  const createAdapters = (jobDirectory: string): ProcedureTutorialMediaAdapters => ({
    asr: {
      async transcribe() {
        return [
          {
            confidence: null,
            endMs: 1_000,
            locale: 'en',
            metrics: {
              averageLogProbability: null,
              compressionRatio: null,
              noSpeechProbability: null,
            },
            order: 1,
            segmentId: stableUuid('asr'),
            startMs: 0,
            text: 'Create an eye.',
          },
        ];
      },
    },
    ocr: {
      async analyze(input) {
        return {
          ocrCandidates: Array.from({ length: options.candidateCount ?? 1 }, (_, index) => ({
            bounds: { height: 0.1, width: 0.1, x: 0, y: 0 },
            candidateId: stableUuid(`${input.frameId}:ocr:${index}`),
            confidence: 0.9,
            frameId: input.frameId,
            locale: input.locale,
            text: `word-${index}`,
          })),
          shortcutCandidates: [],
        };
      },
    },
    probe: {
      async probe() {
        return {
          audio: { channels: 2, codec: 'aac', sampleRateHz: 48_000 },
          container: 'mp4',
          durationMs: 5_000,
          video: { codec: 'h264', frameCount: 150, frameRate: 30, height: 720, width: 1280 },
        };
      },
    },
    source: {
      async download(input) {
        if (options.downloadErrorCode !== undefined) {
          throw Object.assign(new Error('private source failure'), {
            code: options.downloadErrorCode,
          });
        }
        if (options.blockDownload) {
          await new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (input.signal?.aborted) abort();
            else input.signal?.addEventListener('abort', abort, { once: true });
          });
        }
        const mediaPath = join(jobDirectory, 'source.mp4');
        await writeFile(mediaPath, options.downloadContents ?? 'video');
        if (options.unsafeStagingEntry) {
          await symlink(mediaPath, join(jobDirectory, 'unsafe-link'));
        }
        if (options.blockDownloadAfterWrite) {
          await new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (input.signal?.aborted) abort();
            else input.signal?.addEventListener('abort', abort, { once: true });
          });
        }
        if (options.downloadDelayMs !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, options.downloadDelayMs));
        }
        return { durationMs: 1_000, mediaPath, title: 'fixture', videoId: request.videoId };
      },
    },
    transcoder: {
      async extractAudio() {
        const path = join(jobDirectory, 'audio.wav');
        await writeFile(path, 'audio');
        return path;
      },
      async extractFrame(_source, timestampMs) {
        const path = join(jobDirectory, `frame-${timestampMs}.png`);
        await writeFile(path, `frame:${timestampMs}`);
        return path;
      },
    },
  });
  const hash = digest('tool');
  const putFileOptions: ({ readonly removeSource?: boolean | undefined } | undefined)[] = [];
  let releaseStagingCreation = () => undefined;
  let markStagingCreationStarted = () => undefined;
  const stagingCreationStarted = new Promise<void>((resolve) => {
    markStagingCreationStarted = resolve;
  });
  const stagingCreationReleased = new Promise<void>((resolve) => {
    releaseStagingCreation = resolve;
  });
  const observedStore = {
    ...store,
    async createJobStagingDirectory(jobId: string) {
      markStagingCreationStarted();
      if (options.blockStagingCreation) await stagingCreationReleased;
      return store.createJobStagingDirectory(jobId);
    },
    async putFile(path: string, putOptions?: { readonly removeSource?: boolean | undefined }) {
      putFileOptions.push(putOptions);
      return store.putFile(path, putOptions);
    },
  };
  const pipelineStore = options.cleanupFails
    ? {
        ...observedStore,
        async createJobStagingDirectory(jobId: string) {
          const staging = await observedStore.createJobStagingDirectory(jobId);
          return {
            ...staging,
            async cleanup() {
              throw new Error('fixture cleanup failure');
            },
          };
        },
      }
    : observedStore;
  const pipeline = createProcedureTutorialMediaPipeline({
    createAdapters,
    frameIntervalMs: 1_000,
    maximumFrames: 2,
    maximumJobRuntimeMs: options.maximumJobRuntimeMs,
    maximumStagingBytes: options.maximumStagingBytes,
    store: pipelineStore,
    tools: [
      {
        configurationSha256: hash,
        environmentPolicy: 'local_inference_no_network',
        executableSha256: hash,
        invocationContractVersion: '1.0.0',
        normalizedInvocationSha256: hash,
        modelSha256: hash,
        toolId: 'fixture.tool',
        toolVersion: '1.0.0',
        versionOutputSha256: hash,
      },
    ],
  });
  return {
    baseDirectory,
    pipeline,
    putFileOptions,
    releaseStagingCreation,
    stagingCreationStarted,
    store,
  };
}

describe('procedure tutorial media pipeline', () => {
  it('runs all seven stages, creates a verifiable manifest, and exposes candidate evidence only', async () => {
    const { pipeline, putFileOptions, store } = await fixture();
    const updates: string[] = [];
    const result = await pipeline.analyze(request, randomUUID(), {
      onStage: ({ stage, state }) => updates.push(`${stage}:${state}`),
    });

    expect(procedureTutorialMediaAnalysisResultSchema.parse(result)).toEqual(result);
    expect((await pipeline.verify(result)).manifestIntegrity).toEqual(result.manifestIntegrity);
    expect(updates).toEqual(
      request.requestedStages.flatMap((stage) => [`${stage}:started`, `${stage}:completed`]),
    );
    expect(result.uiCandidates).toEqual([]);
    expect(result.sideEffects.providerCalled).toBe(false);
    expect(result.sideEffects.procedureStored).toBe(false);
    expect(putFileOptions).not.toHaveLength(0);
    expect(putFileOptions.every((options) => options?.removeSource === true)).toBe(true);
    for (const artifact of result.artifacts.filter(
      (candidate) => candidate.mediaType === 'application/json',
    )) {
      const json = Buffer.from(await store.read(artifact.uri)).toString('utf8');
      expect(() => JSON.parse(json)).not.toThrow();
    }
    const rerun = await pipeline.analyze(request, randomUUID());
    expect(rerun.frames.map((frame) => frame.frameId)).toEqual(
      result.frames.map((frame) => frame.frameId),
    );
    expect(rerun.ocrCandidates.map((candidate) => candidate.candidateId)).toEqual(
      result.ocrCandidates.map((candidate) => candidate.candidateId),
    );
    expect(rerun.semanticSegments).toEqual(result.semanticSegments);
  });

  it('rejects OCR evidence above the public limit instead of silently truncating it', async () => {
    const { pipeline } = await fixture({
      candidateCount: procedureTutorialMediaVisualCandidateMaxCount + 5,
    });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'quota_exceeded',
      stage: 'ocr',
    });
  });

  it('preserves a download quota failure as a non-retryable quota error', async () => {
    const { pipeline } = await fixture({ downloadErrorCode: 'quota_exceeded' });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'quota_exceeded',
      stage: 'download',
    });
  });

  it('actively monitors aggregate private staging bytes and aborts an in-flight adapter', async () => {
    const { pipeline } = await fixture({
      blockDownloadAfterWrite: true,
      downloadContents: 'too-large',
      maximumStagingBytes: 4,
    });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'quota_exceeded',
      stage: 'download',
    });
  });

  it('enforces the staging quota in a fast final check before importing outputs', async () => {
    const { pipeline } = await fixture({
      downloadContents: 'too-large',
      maximumStagingBytes: 4,
    });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'quota_exceeded',
      stage: 'download',
    });
  });

  it('fails closed when staging contains an unsafe filesystem entry', async () => {
    const { pipeline } = await fixture({ unsafeStagingEntry: true });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'integrity_failed',
      stage: 'download',
    });
  });

  it('preserves deadline precedence when a late output also exceeds the staging quota', async () => {
    const { pipeline } = await fixture({
      downloadContents: 'too-large',
      downloadDelayMs: 30,
      maximumJobRuntimeMs: 5,
      maximumStagingBytes: 4,
    });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'deadline_exceeded',
      stage: 'download',
    });
  });

  it('preserves external cancellation precedence over a concurrent staging overflow', async () => {
    const { pipeline } = await fixture({
      blockDownloadAfterWrite: true,
      downloadContents: 'too-large',
      maximumStagingBytes: 4,
    });
    const controller = new AbortController();
    await expect(
      pipeline.analyze(request, randomUUID(), {
        signal: controller.signal,
        onStage: ({ stage, state }) => {
          if (stage === 'download' && state === 'started') controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled', stage: 'download' });
  });

  it('converts window-relative ASR offsets to absolute tutorial timestamps', async () => {
    const { pipeline } = await fixture();
    const shifted = {
      ...request,
      analysisWindow: { endMs: 2_000, startMs: 1_000 },
      requestId: randomUUID(),
    };
    const result = await pipeline.analyze(shifted, randomUUID());
    expect(result.asrSegments[0]).toMatchObject({ endMs: 2_000, startMs: 1_000 });
    expect(result.frames.every((frame) => frame.timestampMs >= 1_000)).toBe(true);
  });

  it('detects content-addressed artifact tampering during verification', async () => {
    const { baseDirectory, pipeline } = await fixture();
    const result = await pipeline.analyze(request, randomUUID());
    const artifact = result.artifacts.find((item) => item.role === 'ocr_observations')!;
    const userId = typeof process.getuid === 'function' ? process.getuid() : 'current-user';
    const artifactPath = join(
      baseDirectory,
      `operatingline-tutorial-media-${userId}`,
      'objects',
      artifact.sha256.slice(0, 2),
      artifact.sha256,
    );
    await chmod(artifactPath, 0o600);
    await writeFile(artifactPath, 'tampered');
    await expect(pipeline.verify(result)).rejects.toBeInstanceOf(
      ProcedureTutorialMediaPipelineError,
    );
  });

  it('aborts active analysis and waits for it when the pipeline closes', async () => {
    const { pipeline } = await fixture({ blockDownload: true });
    const analyzing = pipeline.analyze(request, randomUUID());
    const rejected = expect(analyzing).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await pipeline.close();
    await rejected;
  });

  it('tracks analysis before staging allocation so close waits for the whole lifecycle', async () => {
    const { pipeline, releaseStagingCreation, stagingCreationStarted } = await fixture({
      blockStagingCreation: true,
    });
    const analyzing = pipeline.analyze(request, randomUUID());
    const rejected = expect(analyzing).rejects.toMatchObject({ code: 'cancelled' });
    await stagingCreationStarted;
    let closeSettled = false;
    const closing = pipeline.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closeSettled).toBe(false);
    releaseStagingCreation();
    await closing;
    await rejected;
  });

  it('does not report success when private staging cleanup fails', async () => {
    const { pipeline } = await fixture({ cleanupFails: true });
    await expect(pipeline.analyze(request, randomUUID())).rejects.toMatchObject({
      code: 'pipeline_failed',
    });
  });
});
