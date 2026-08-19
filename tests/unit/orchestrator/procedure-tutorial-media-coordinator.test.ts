import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type {
  ProcedureTutorialMediaAnalysisRequest,
  ProcedureTutorialMediaAnalysisResult,
  ProcedureTutorialMediaStage,
} from '@operatingline/protocol';
import {
  createProcedureTutorialMediaCoordinator,
  ProcedureTutorialMediaCoordinatorError,
} from '../../../services/orchestrator/src/procedure-tutorial-media-coordinator.js';
import {
  ProcedureTutorialMediaPipelineError,
  type ProcedureTutorialMediaPipeline,
} from '../../../services/orchestrator/src/procedure-tutorial-media-pipeline.js';

const stages = [
  'download',
  'probe',
  'audio',
  'asr',
  'frames',
  'ocr',
  'segmentation',
] as const satisfies readonly ProcedureTutorialMediaStage[];
const timestamp = '2026-08-18T00:00:00.000Z';
const hash = (digit: string) => digit.repeat(64);
const uri = (digit: string) => `operatingline-media://sha256/${hash(digit)}` as const;

function analysisRequest(requestId = randomUUID()): ProcedureTutorialMediaAnalysisRequest {
  return {
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
      confirmedAt: timestamp,
      reference: 'platform-approval',
    },
    requestId,
    requestedStages: [...stages],
    rightsAuthorization: {
      basis: 'rights_holder_permission',
      confirmedAt: timestamp,
      reference: 'rights-approval',
    },
    videoId: 'abcdefghijk',
  };
}

function completedResult(
  request: ProcedureTutorialMediaAnalysisRequest,
  jobId: string,
): ProcedureTutorialMediaAnalysisResult {
  const source = {
    bytes: 5,
    createdAt: timestamp,
    mediaType: 'video/mp4' as const,
    role: 'source_video' as const,
    sha256: hash('1'),
    uri: uri('1'),
  };
  const derived = (
    digit: string,
    role:
      | 'audio_track'
      | 'evidence_frame'
      | 'asr_transcript'
      | 'ocr_observations'
      | 'analysis_manifest',
    mediaType: 'audio/wav' | 'image/png' | 'application/json',
  ) => ({
    bytes: 5,
    createdAt: timestamp,
    mediaType,
    role,
    sha256: hash(digit),
    sourceSha256: source.sha256,
    uri: uri(digit),
  });
  const audio = derived('2', 'audio_track', 'audio/wav');
  const frameArtifact = derived('3', 'evidence_frame', 'image/png');
  const transcript = derived('4', 'asr_transcript', 'application/json');
  const ocr = derived('5', 'ocr_observations', 'application/json');
  const manifest = derived('6', 'analysis_manifest', 'application/json');
  return {
    analysisProfile: request.analysisProfile,
    analysisWindow: request.analysisWindow,
    artifacts: [source, audio, transcript, frameArtifact, ocr, manifest],
    asrSegments: [],
    completedAt: timestamp,
    completedStages: [...stages],
    formatVersion: request.formatVersion,
    frames: [{ artifact: frameArtifact, frameId: randomUUID(), order: 1, timestampMs: 0 }],
    jobId,
    locale: request.locale,
    manifestIntegrity: {
      artifactCount: 6,
      generatedAt: timestamp,
      manifestArtifactUri: manifest.uri,
      manifestSha256: manifest.sha256,
      rootSha256: hash('7'),
    },
    ocrCandidates: [],
    probe: {
      audio: { channels: 2, codec: 'aac', sampleRateHz: 48_000 },
      container: 'mp4',
      durationMs: 1_000,
      sourceArtifactUri: source.uri,
      video: { codec: 'h264', frameCount: 30, frameRate: 30, height: 720, width: 1280 },
    },
    requestId: request.requestId,
    segmentation: {
      algorithmId: 'operatingline.deterministic_tutorial_segmentation',
      algorithmVersion: '1.0.0',
      inputSha256: hash('8'),
      outputSha256: hash('9'),
    },
    semanticSegments: [],
    shortcutCandidates: [],
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
      {
        configurationSha256: hash('a'),
        environmentPolicy: 'local_inference_no_network',
        executableSha256: hash('a'),
        invocationContractVersion: '1.0.0',
        normalizedInvocationSha256: hash('a'),
        modelSha256: hash('a'),
        toolId: 'fixture.tool',
        toolVersion: '1.0.0',
        versionOutputSha256: hash('a'),
      },
    ],
    uiCandidates: [],
    videoId: request.videoId,
  };
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    createdAt: timestamp,
    eventType: event.eventType,
    id: event.id,
    payload: event.payload,
    sequence: index + 1,
  }));
}

async function terminalStatus(
  coordinator: ReturnType<typeof createProcedureTutorialMediaCoordinator>,
  requestId: string,
  jobId: string,
) {
  for (let index = 0; index < 100; index += 1) {
    const status = coordinator.status(requestId, jobId);
    if (
      status.status === 'completed' ||
      status.status === 'failed' ||
      status.status === 'recovery_required'
    )
      return status;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('job did not reach a terminal state');
}

function successfulPipeline(): ProcedureTutorialMediaPipeline {
  return {
    async analyze(request, jobId, options) {
      for (const stage of stages) {
        await options?.onStage?.({ stage, state: 'started' });
        await options?.onStage?.({ stage, state: 'completed' });
      }
      return completedResult(request, jobId);
    },
    async close() {},
    async verify(result) {
      return result;
    },
  };
}

describe('procedure tutorial media coordinator', () => {
  it('returns immediately, completes asynchronously, and is idempotent for identical input', async () => {
    const events: ExecutionEventInput[] = [];
    const request = analysisRequest();
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => events.push(event),
      existingEvents: [],
      pipeline: successfulPipeline(),
    });
    const accepted = coordinator.create(request);
    expect(accepted.status).toBe('accepted');
    expect(coordinator.create(request)).toEqual(accepted);
    const completed = await terminalStatus(coordinator, request.requestId, accepted.jobId);
    expect(completed.status).toBe('completed');
    expect(coordinator.create(request)).toEqual(completed);
    expect(events.filter((event) => event.eventType.endsWith('.requested'))).toHaveLength(1);

    expect(() => coordinator.create({ ...request, locale: 'fr' })).toThrowError(
      ProcedureTutorialMediaCoordinatorError,
    );
  });

  it('requires an exact recovery receipt and explicitly restarts from download', async () => {
    const events: ExecutionEventInput[] = [];
    let attempts = 0;
    const pipeline: ProcedureTutorialMediaPipeline = {
      async analyze(request, jobId, options) {
        attempts += 1;
        await options?.onStage?.({ stage: 'download', state: 'started' });
        if (attempts === 1)
          throw new ProcedureTutorialMediaPipelineError('pipeline_failed', 'download');
        for (const stage of stages) {
          if (stage !== 'download') await options?.onStage?.({ stage, state: 'started' });
          await options?.onStage?.({ stage, state: 'completed' });
        }
        return completedResult(request, jobId);
      },
      async close() {},
      async verify(result) {
        return result;
      },
    };
    const request = analysisRequest();
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => events.push(event),
      existingEvents: [],
      pipeline,
    });
    const accepted = coordinator.create(request);
    const recovery = await terminalStatus(coordinator, request.requestId, accepted.jobId);
    expect(recovery).toMatchObject({
      completedStages: [],
      retryFromStage: 'download',
      status: 'recovery_required',
    });
    if (recovery.status !== 'recovery_required') throw new Error('expected recovery');
    expect(() =>
      coordinator.resume({
        approvals: request.approvals,
        formatVersion: request.formatVersion,
        jobId: accepted.jobId,
        recoveryId: randomUUID(),
        requestId: request.requestId,
        retryFromStage: 'download',
      }),
    ).toThrowError(ProcedureTutorialMediaCoordinatorError);
    coordinator.resume({
      approvals: request.approvals,
      formatVersion: request.formatVersion,
      jobId: accepted.jobId,
      recoveryId: recovery.recoveryId,
      requestId: request.requestId,
      retryFromStage: 'download',
    });
    const completed = await terminalStatus(coordinator, request.requestId, accepted.jobId);
    expect(completed.status).toBe('completed');
    expect(attempts).toBe(2);
    expect(new Set(events.map((event) => event.id))).toHaveLength(events.length);
    let replayed = false;
    const restarted = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: stored(events),
      pipeline: {
        async analyze() {
          replayed = true;
          throw new Error('completed jobs must not replay');
        },
        async close() {},
        async verify(result) {
          return result;
        },
      },
    });
    await restarted.ready();
    expect(restarted.status(request.requestId, accepted.jobId)).toEqual(completed);
    expect(replayed).toBe(false);
  });

  it('restores an interrupted request as recovery-required without replaying it', () => {
    const events: ExecutionEventInput[] = [];
    const request = analysisRequest();
    const first = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => events.push(event),
      existingEvents: [],
      pipeline: {
        async analyze() {
          return await new Promise<never>(() => undefined);
        },
        async close() {},
        async verify(result) {
          return result;
        },
      },
    });
    const accepted = first.create(request);
    let replayed = false;
    const restarted = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: stored(events),
      pipeline: {
        async analyze() {
          replayed = true;
          throw new Error('must not run');
        },
        async close() {},
        async verify(result) {
          return result;
        },
      },
    });
    expect(restarted.status(request.requestId, accepted.jobId)).toMatchObject({
      completedStages: [],
      retryFromStage: 'download',
      status: 'recovery_required',
    });
    expect(replayed).toBe(false);
  });

  it('rejects impossible persisted resume and terminal transitions', async () => {
    const recoveryEvents: ExecutionEventInput[] = [];
    const request = analysisRequest();
    const recovering = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => recoveryEvents.push(event),
      existingEvents: [],
      pipeline: {
        async analyze() {
          throw new ProcedureTutorialMediaPipelineError('pipeline_failed', 'download');
        },
        async close() {},
        async verify(result) {
          return result;
        },
      },
    });
    const accepted = recovering.create(request);
    const recovery = await terminalStatus(recovering, request.requestId, accepted.jobId);
    if (recovery.status !== 'recovery_required') throw new Error('expected recovery');
    recovering.resume({
      approvals: request.approvals,
      formatVersion: request.formatVersion,
      jobId: accepted.jobId,
      recoveryId: recovery.recoveryId,
      requestId: request.requestId,
      retryFromStage: 'download',
    });
    const requested = recoveryEvents.find((event) => event.eventType.endsWith('.requested'))!;
    const resumed = recoveryEvents.find((event) => event.eventType.endsWith('.resumed'))!;
    expect(() =>
      createProcedureTutorialMediaCoordinator({
        appendEvent: () => undefined,
        existingEvents: stored([requested, resumed]),
        pipeline: successfulPipeline(),
      }),
    ).toThrowError(ProcedureTutorialMediaCoordinatorError);

    const completionEvents: ExecutionEventInput[] = [];
    const completedCoordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => completionEvents.push(event),
      existingEvents: [],
      pipeline: successfulPipeline(),
    });
    const completionAccepted = completedCoordinator.create(analysisRequest());
    await terminalStatus(
      completedCoordinator,
      completionAccepted.requestId,
      completionAccepted.jobId,
    );
    const mismatched = completionEvents.map((event) =>
      event.eventType === 'procedure.tutorial.media.completed'
        ? { ...event, eventType: 'procedure.tutorial.media.failed' }
        : event,
    );
    expect(() =>
      createProcedureTutorialMediaCoordinator({
        appendEvent: () => undefined,
        existingEvents: stored(mismatched),
        pipeline: successfulPipeline(),
      }),
    ).toThrowError(ProcedureTutorialMediaCoordinatorError);
  });

  it('revalidates restored completed artifacts before exposing their status', async () => {
    const events: ExecutionEventInput[] = [];
    const request = analysisRequest();
    const first = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => events.push(event),
      existingEvents: [],
      pipeline: successfulPipeline(),
    });
    const accepted = first.create(request);
    await terminalStatus(first, request.requestId, accepted.jobId);
    const restarted = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: stored(events),
      pipeline: {
        async analyze() {
          throw new Error('must not replay');
        },
        async close() {},
        async verify() {
          throw new Error('artifact missing');
        },
      },
    });

    await expect(restarted.ready()).rejects.toMatchObject({ code: 'integrity_failed' });
    expect(() => restarted.status(request.requestId, accepted.jobId)).toThrowError(
      ProcedureTutorialMediaCoordinatorError,
    );
  });

  it('maps a download quota failure to a terminal non-retryable job error', async () => {
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: [],
      pipeline: {
        async analyze() {
          throw new ProcedureTutorialMediaPipelineError('quota_exceeded', 'download');
        },
        async close() {},
        async verify(result) {
          return result;
        },
      },
    });
    const request = analysisRequest();
    const accepted = coordinator.create(request);
    await expect(
      terminalStatus(coordinator, request.requestId, accepted.jobId),
    ).resolves.toMatchObject({
      error: { code: 'quota_exceeded', retryable: false, stage: 'download' },
      status: 'failed',
    });
  });

  it('invalidates an old recovery receipt when a resumed attempt is interrupted', async () => {
    const events: ExecutionEventInput[] = [];
    let attempts = 0;
    const pipeline: ProcedureTutorialMediaPipeline = {
      async analyze(_request, _jobId, options) {
        attempts += 1;
        if (attempts === 1)
          throw new ProcedureTutorialMediaPipelineError('pipeline_failed', 'download');
        await options?.onStage?.({ stage: 'download', state: 'started' });
        return await new Promise<never>(() => undefined);
      },
      async close() {},
      async verify(result) {
        return result;
      },
    };
    const request = analysisRequest();
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: (event) => events.push(event),
      existingEvents: [],
      pipeline,
    });
    const accepted = coordinator.create(request);
    const firstRecovery = await terminalStatus(coordinator, request.requestId, accepted.jobId);
    if (firstRecovery.status !== 'recovery_required') throw new Error('expected recovery');
    coordinator.resume({
      approvals: request.approvals,
      formatVersion: request.formatVersion,
      jobId: accepted.jobId,
      recoveryId: firstRecovery.recoveryId,
      requestId: request.requestId,
      retryFromStage: 'download',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const restarted = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: stored(events),
      pipeline: successfulPipeline(),
    });
    const secondRecovery = restarted.status(request.requestId, accepted.jobId);
    expect(secondRecovery).toMatchObject({
      retryFromStage: 'download',
      status: 'recovery_required',
    });
    if (secondRecovery.status !== 'recovery_required') throw new Error('expected recovery');
    expect(secondRecovery.recoveryId).not.toBe(firstRecovery.recoveryId);
    expect(() =>
      restarted.resume({
        approvals: request.approvals,
        formatVersion: request.formatVersion,
        jobId: accepted.jobId,
        recoveryId: firstRecovery.recoveryId,
        requestId: request.requestId,
        retryFromStage: 'download',
      }),
    ).toThrowError(ProcedureTutorialMediaCoordinatorError);
  });

  it('enforces concurrency and converts terminal persistence loss into observable failure', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline: ProcedureTutorialMediaPipeline = {
      async analyze(request, jobId) {
        await blocked;
        return completedResult(request, jobId);
      },
      async close() {
        release();
      },
      async verify(result) {
        return result;
      },
    };
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: [],
      maximumConcurrentJobs: 1,
      pipeline,
    });
    coordinator.create(analysisRequest());
    expect(() => coordinator.create(analysisRequest())).toThrowError(
      ProcedureTutorialMediaCoordinatorError,
    );
    release();
    await coordinator.close();

    let terminalAppend = false;
    const request = analysisRequest();
    const persistenceCoordinator = createProcedureTutorialMediaCoordinator({
      appendEvent(event) {
        if (event.eventType === 'procedure.tutorial.media.completed') {
          terminalAppend = true;
          throw new Error('disk full');
        }
      },
      existingEvents: [],
      pipeline: successfulPipeline(),
    });
    const accepted = persistenceCoordinator.create(request);
    const status = await terminalStatus(persistenceCoordinator, request.requestId, accepted.jobId);
    expect(terminalAppend).toBe(true);
    expect(status).toMatchObject({
      error: { code: 'internal_error', retryable: false, stage: null },
      status: 'failed',
    });
  });

  it('reserves concurrency before accepting an explicit restart', async () => {
    const attempts = new Map<string, number>();
    const pipeline: ProcedureTutorialMediaPipeline = {
      async analyze(request) {
        const attempt = (attempts.get(request.requestId) ?? 0) + 1;
        attempts.set(request.requestId, attempt);
        if (attempt === 1)
          throw new ProcedureTutorialMediaPipelineError('pipeline_failed', 'download');
        return await new Promise<never>(() => undefined);
      },
      async close() {},
      async verify(result) {
        return result;
      },
    };
    const coordinator = createProcedureTutorialMediaCoordinator({
      appendEvent: () => undefined,
      existingEvents: [],
      maximumConcurrentJobs: 1,
      pipeline,
    });
    const firstRequest = analysisRequest();
    const firstAccepted = coordinator.create(firstRequest);
    const firstRecovery = await terminalStatus(
      coordinator,
      firstRequest.requestId,
      firstAccepted.jobId,
    );
    if (firstRecovery.status !== 'recovery_required') throw new Error('expected recovery');
    const secondRequest = analysisRequest();
    const secondAccepted = coordinator.create(secondRequest);
    const secondRecovery = await terminalStatus(
      coordinator,
      secondRequest.requestId,
      secondAccepted.jobId,
    );
    if (secondRecovery.status !== 'recovery_required') throw new Error('expected recovery');
    coordinator.resume({
      approvals: firstRequest.approvals,
      formatVersion: firstRequest.formatVersion,
      jobId: firstAccepted.jobId,
      recoveryId: firstRecovery.recoveryId,
      requestId: firstRequest.requestId,
      retryFromStage: 'download',
    });
    expect(() =>
      coordinator.resume({
        approvals: secondRequest.approvals,
        formatVersion: secondRequest.formatVersion,
        jobId: secondAccepted.jobId,
        recoveryId: secondRecovery.recoveryId,
        requestId: secondRequest.requestId,
        retryFromStage: 'download',
      }),
    ).toThrowError(ProcedureTutorialMediaCoordinatorError);
  });
});
