import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  procedureTutorialMediaAnalysisResultSchema,
  type ProcedureTutorialMediaAnalysisRequest,
} from '@operatingline/protocol';
import { createTutorialMediaArtifactStore } from '../../../services/orchestrator/src/tutorial-media-artifact-store.js';
import {
  createProcedureTutorialMediaPipeline,
  type ProcedureTutorialMediaAdapters,
} from '../../../services/orchestrator/src/procedure-tutorial-media-pipeline.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const mediaContent = 'local-video';
const source = {
  kind: 'user_supplied_local_file' as const,
  sourceIdentitySha256: digest('local-path'),
  contentSha256: digest(mediaContent),
  rightsBasis: 'rights_holder_permission' as const,
  importValidation: {
    authorityId: 'local-import-authority',
    authorityKind: 'local_import_authority' as const,
    sideEffect: 'local_media_import' as const,
    receiptContentSha256: '1'.repeat(64),
    authorityContentSha256: '2'.repeat(64),
  },
  rightsValidation: {
    authorityId: 'local-rights-authority',
    authorityKind: 'media_rights_authority' as const,
    sideEffect: 'rights_validation' as const,
    receiptContentSha256: '3'.repeat(64),
    authorityContentSha256: '4'.repeat(64),
  },
};
const localRequest: ProcedureTutorialMediaAnalysisRequest = {
  formatVersion: '1.1.0',
  requestId: '11111111-1111-4111-8111-111111111111',
  source,
  analysisProfile: 'local_tutorial_evidence_v1',
  locale: 'en',
  analysisWindow: { startMs: 0, endMs: 1_000 },
  requestedStages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  approvals: {
    networkAccessApproved: false,
    mediaDownloadApproved: false,
    retentionApproved: true,
  },
};

async function fixture(options: { readonly driftHash?: boolean; readonly caption?: boolean } = {}) {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'operatingline-local-pipeline-'));
  temporaryDirectories.push(baseDirectory);
  const store = createTutorialMediaArtifactStore({ baseDirectory });
  const toolHash = digest('tool');
  const tool = {
    configurationSha256: toolHash,
    environmentPolicy: 'local_inference_no_network' as const,
    executableSha256: toolHash,
    invocationContractVersion: '1.0.0',
    normalizedInvocationSha256: toolHash,
    modelSha256: toolHash,
    toolId: 'fixture.tool',
    toolVersion: '1.0.0',
    versionOutputSha256: toolHash,
  };
  const toolProvenance = vi.fn(async () => [tool]);
  const transcribe = vi.fn(async () => [
    {
      confidence: 0.8,
      endMs: 1_000,
      locale: 'en',
      metrics: {
        averageLogProbability: null,
        compressionRatio: null,
        noSpeechProbability: null,
      },
      order: 1,
      segmentId: randomUUID(),
      startMs: 0,
      text: 'ASR fallback text.',
    },
  ]);
  const createAdapters = (jobDirectory: string): ProcedureTutorialMediaAdapters => ({
    localSource: {
      async import() {
        const mediaPath = join(jobDirectory, 'imported.mp4');
        await writeFile(mediaPath, mediaContent);
        const captionContent = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nVerified caption text.\n';
        return {
          mediaPath,
          contentSha256: options.driftHash ? digest('wrong') : source.contentSha256,
          sourceIdentitySha256: source.sourceIdentitySha256,
          byteLength: Buffer.byteLength(mediaContent),
          historicalValidationReceipts: [] as never,
          liveValidationReceipts: [] as never,
          caption: options.caption
            ? {
                origin: 'user_supplied',
                format: 'webvtt',
                content: captionContent,
                locale: 'en',
                defaultConfidence: 0.95,
                contentSha256: digest(captionContent),
              }
            : null,
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
    transcoder: {
      async extractAudio() {
        const path = join(jobDirectory, 'audio.wav');
        await writeFile(path, 'audio');
        return path;
      },
      async extractFrame(_path, timestampMs) {
        const path = join(jobDirectory, `frame-${timestampMs}.png`);
        await writeFile(path, `frame:${timestampMs}`);
        return path;
      },
    },
    asr: { transcribe },
    ocr: {
      async analyze() {
        return { ocrCandidates: [], shortcutCandidates: [] };
      },
    },
    toolProvenance,
  });
  const pipeline = createProcedureTutorialMediaPipeline({
    createAdapters,
    frameIntervalMs: 1_000,
    maximumFrames: 2,
    store,
    tools: [tool],
  });
  return { pipeline, store, toolProvenance, transcribe };
}

describe('procedure tutorial local media pipeline seam', () => {
  it('starts at import, performs zero YouTube downloads, and preserves the exact source binding', async () => {
    const { pipeline, toolProvenance } = await fixture();
    const updates: string[] = [];
    const result = await pipeline.analyze(localRequest, randomUUID(), {
      onStage: ({ stage, state }) => updates.push(`${stage}:${state}`),
    });

    expect(procedureTutorialMediaAnalysisResultSchema.parse(result)).toEqual(result);
    expect(toolProvenance).toHaveBeenCalledOnce();
    expect(toolProvenance).toHaveBeenCalledWith({ sourceKind: 'user_supplied_local_file' });
    expect(updates).toEqual(
      localRequest.requestedStages.flatMap((stage) => [`${stage}:started`, `${stage}:completed`]),
    );
    expect(result).toMatchObject({
      source,
      sideEffects: { networkFetched: false, mediaDownloaded: false },
      manifestIntegrity: { source },
    });
    expect(result.artifacts.find((artifact) => artifact.role === 'source_video')?.sha256).toBe(
      source.contentSha256,
    );
    await expect(pipeline.verify(result)).resolves.toEqual(result);
  });

  it('rejects an import hash mismatch before probe and still never calls the downloader', async () => {
    const { pipeline } = await fixture({ driftHash: true });
    await expect(pipeline.analyze(localRequest, randomUUID())).rejects.toMatchObject({
      code: 'integrity_failed',
      stage: 'import',
    });
  });

  it('uses only the verified import caption as transcript evidence when one is present', async () => {
    const { pipeline, store, transcribe } = await fixture({ caption: true });
    const result = await pipeline.analyze(localRequest, randomUUID());
    expect(transcribe).toHaveBeenCalledOnce();
    expect(result.asrSegments.map((segment) => segment.text)).toEqual(['Verified caption text.']);
    const transcript = result.artifacts.find((artifact) => artifact.role === 'asr_transcript')!;
    const evidence = JSON.parse(Buffer.from(await store.read(transcript.uri)).toString('utf8'));
    expect(evidence).toMatchObject({
      captionOrigin: 'verified_local_import',
      captionDocument: {
        contentSha256: digest('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nVerified caption text.\n'),
      },
    });
  });
});
