import { describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaCapabilitiesSchema,
  type ProcedureTutorialMediaAnalysisResult,
  type ProcedureTutorialMediaArtifactRef,
  type ProcedureTutorialMediaCapabilities,
} from '@operatingline/protocol';
import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import { FakeBlenderAdapter } from '@operatingline/test-kit';
import type { ProcedureTutorialMediaRuntime } from '../../../services/orchestrator/src/procedure-tutorial-media-runtime.js';
import type { ProcedureTutorialMediaPipeline } from '../../../services/orchestrator/src/procedure-tutorial-media-pipeline.js';
import { startRuntime } from '@operatingline/orchestrator';

const accessToken = 'tutorial-media-test-token-1234';

const unavailableRuntime = {
  capabilities: procedureTutorialMediaCapabilitiesSchema.parse({
    availability: 'unavailable',
    formatVersion: '1.0.0',
    serviceId: 'operatingline.youtube_tutorial_media',
    serviceVersion: '0.1.0',
    unavailableReasons: ['not_configured'],
  }),
} satisfies ProcedureTutorialMediaRuntime;

function availableCapabilities() {
  return procedureTutorialMediaCapabilitiesSchema.parse({
    analysisProfiles: ['youtube_tutorial_evidence_v1'],
    artifactMediaTypes: ['video/mp4', 'audio/wav', 'image/png', 'application/json'],
    availability: 'available',
    features: {
      contentAddressedArtifacts: true,
      credentialFreePublicProtocol: true,
      deterministicSegmentation: true,
      explicitFullRestartAfterFailure: true,
      ocrTextCandidates: true,
      resumableJobs: false,
      shortcutCandidates: true,
      uiElementRecognition: false,
    },
    formatVersion: '1.0.0',
    limits: {
      maxAnalysisWindowMs: 60_000,
      maxConcurrentJobs: 1,
      maxFrames: 10,
      maxJobRuntimeMs: 60_000,
      maxVideoDurationMs: 86_400_000,
    },
    serviceId: 'operatingline.youtube_tutorial_media',
    serviceVersion: '0.1.0',
    stages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
    supportedLocales: ['en'],
  }) as Extract<ProcedureTutorialMediaCapabilities, { readonly availability: 'available' }>;
}

function blockingAvailableRuntime(
  onClose: () => void = () => undefined,
): ProcedureTutorialMediaRuntime {
  const pipeline: ProcedureTutorialMediaPipeline = {
    async analyze(_request, _jobId, options) {
      return await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    },
    async close() {
      onClose();
    },
    async verify(result) {
      return result;
    },
  };
  const capabilities = availableCapabilities();
  return { capabilities, maximumConcurrentJobs: 1, pipeline };
}

const analysisRequest = procedureTutorialMediaAnalysisRequestSchema.parse({
  analysisProfile: 'youtube_tutorial_evidence_v1',
  analysisWindow: { endMs: 10_000, startMs: 0 },
  approvals: {
    mediaDownloadApproved: true,
    networkAccessApproved: true,
    retentionApproved: true,
  },
  formatVersion: '1.0.0',
  locale: 'en',
  platformDownloadAuthorization: {
    basis: 'youtube_written_approval',
    confirmedAt: '2026-08-19T00:00:00.000Z',
    reference: 'platform-approval-1',
  },
  requestId: '4b43c8cb-7240-4b15-9cae-37e39d67e4c9',
  requestedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  rightsAuthorization: {
    basis: 'rights_holder_permission',
    confirmedAt: '2026-08-19T00:00:00.000Z',
    reference: 'rights-approval-1',
  },
  videoId: 'abcdefghijk',
});

const mediaCompletedAt = '2026-08-20T00:00:00.000Z';
const mediaSourceSha256 = '1'.repeat(64);

function mediaArtifact(
  role: ProcedureTutorialMediaArtifactRef['role'],
  mediaType: ProcedureTutorialMediaArtifactRef['mediaType'],
  digit: string,
): ProcedureTutorialMediaArtifactRef {
  const sha256 = digit.repeat(64);
  return {
    uri: `operatingline-media://sha256/${sha256}`,
    role,
    mediaType,
    sha256,
    bytes: 10,
    ...(role === 'source_video' ? {} : { sourceSha256: mediaSourceSha256 }),
    createdAt: mediaCompletedAt,
  };
}

function completedAnalysis(
  request: typeof analysisRequest,
  jobId: string,
): ProcedureTutorialMediaAnalysisResult {
  const source = mediaArtifact('source_video', 'video/mp4', '1');
  const audio = mediaArtifact('audio_track', 'audio/wav', '2');
  const frame = mediaArtifact('evidence_frame', 'image/png', '3');
  const transcript = mediaArtifact('asr_transcript', 'application/json', '4');
  const observations = mediaArtifact('ocr_observations', 'application/json', '5');
  const manifest = mediaArtifact('analysis_manifest', 'application/json', '6');
  const asrId = '11111111-1111-4111-8111-111111111112';
  const frameId = '22222222-2222-4222-8222-222222222223';
  const ocrId = '33333333-3333-4333-8333-333333333334';
  const uiId = '44444444-4444-4444-8444-444444444445';
  const shortcutId = '55555555-5555-4555-8555-555555555556';
  return procedureTutorialMediaAnalysisResultSchema.parse({
    formatVersion: request.formatVersion,
    requestId: request.requestId,
    jobId,
    videoId: request.videoId,
    analysisProfile: request.analysisProfile,
    locale: request.locale,
    analysisWindow: request.analysisWindow,
    completedStages: request.requestedStages,
    artifacts: [source, audio, frame, transcript, observations, manifest],
    tools: [
      {
        toolId: 'fixture.asr',
        toolVersion: '1.0.0',
        invocationContractVersion: '1.0.0',
        executableSha256: '7'.repeat(64),
        versionOutputSha256: '8'.repeat(64),
        normalizedInvocationSha256: '9'.repeat(64),
        configurationSha256: 'a'.repeat(64),
        environmentPolicy: 'local_inference_no_network',
        modelSha256: 'b'.repeat(64),
      },
    ],
    probe: {
      sourceArtifactUri: source.uri,
      container: 'mp4',
      durationMs: request.analysisWindow.endMs,
      video: {
        codec: 'h264',
        width: 1280,
        height: 720,
        frameRate: 30,
        frameCount: 300,
      },
      audio: { codec: 'aac', channels: 2, sampleRateHz: 48_000 },
    },
    asrSegments: [
      {
        segmentId: asrId,
        order: 1,
        startMs: 0,
        endMs: 10_000,
        text: 'Add a UV sphere, move it, scale it, and name the eye.',
        locale: 'en',
        confidence: 0.94,
        metrics: {
          averageLogProbability: -0.1,
          noSpeechProbability: 0.01,
          compressionRatio: 1,
        },
      },
    ],
    frames: [{ frameId, order: 1, timestampMs: 5_000, artifact: frame }],
    ocrCandidates: [
      {
        candidateId: ocrId,
        frameId,
        bounds: { x: 0, y: 0, width: 0.2, height: 0.1 },
        confidence: 0.8,
        text: 'UV Sphere',
        locale: 'en',
      },
    ],
    uiCandidates: [
      {
        candidateId: uiId,
        frameId,
        bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
        confidence: 0.82,
        role: 'menu_item',
        label: 'UV Sphere',
      },
    ],
    shortcutCandidates: [
      {
        candidateId: shortcutId,
        frameId,
        timestampMs: 5_000,
        keys: ['Shift', 'A'],
        confidence: 0.85,
      },
    ],
    semanticSegments: [
      {
        segmentId: '66666666-6666-4666-8666-666666666667',
        order: 1,
        startMs: 0,
        endMs: 10_000,
        canonicalDescription: 'Create and adjust the eye sphere.',
        confidence: 0.9,
        asrSegmentIds: [asrId],
        ocrCandidateIds: [ocrId],
        uiCandidateIds: [uiId],
        shortcutCandidateIds: [shortcutId],
        evidence: [{ artifactUri: frame.uri, frameId, timestampMs: 5_000 }],
      },
    ],
    segmentation: {
      algorithmId: 'operatingline.deterministic_tutorial_segmentation',
      algorithmVersion: '1.0.0',
      inputSha256: 'c'.repeat(64),
      outputSha256: 'd'.repeat(64),
    },
    sideEffects: {
      networkFetched: true,
      mediaDownloaded: true,
      audioDerived: true,
      framesDerived: true,
      localAsrModelRun: true,
      localOcrRun: true,
      providerCalled: false,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    manifestIntegrity: {
      manifestArtifactUri: manifest.uri,
      manifestSha256: manifest.sha256,
      artifactCount: 6,
      rootSha256: 'e'.repeat(64),
      generatedAt: mediaCompletedAt,
    },
    completedAt: mediaCompletedAt,
  });
}

function completedAnalysisWithoutSemanticSegments(
  request: typeof analysisRequest,
  jobId: string,
): ProcedureTutorialMediaAnalysisResult {
  return procedureTutorialMediaAnalysisResultSchema.parse({
    ...completedAnalysis(request, jobId),
    semanticSegments: [],
  });
}

function successfulAvailableRuntime(
  onVerify: () => void | Promise<void>,
  analyze: typeof completedAnalysis = completedAnalysis,
): ProcedureTutorialMediaRuntime {
  const pipeline: ProcedureTutorialMediaPipeline = {
    async analyze(request, jobId) {
      return analyze(request as typeof analysisRequest, jobId);
    },
    async verify(result) {
      await onVerify();
      return result;
    },
    async close() {},
  };
  return { capabilities: availableCapabilities(), maximumConcurrentJobs: 1, pipeline };
}

async function mcpJson<T>(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify(body),
  });
  const line = (await response.text())
    .split('\n')
    .find((candidate) => candidate.startsWith('data: '));
  if (line === undefined) throw new Error('MCP response did not contain an SSE data event');
  return { status: response.status, payload: JSON.parse(line.slice('data: '.length)) as T };
}

describe('tutorial media runtime integration', () => {
  it('protects capabilities with bearer auth and reports unavailable safely', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      // The cast keeps this test forward-compatible while the runtime option is integrated.
      tutorialMediaRuntime: unavailableRuntime,
    } as Parameters<typeof startRuntime>[0]);
    try {
      await expect(
        fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/capabilities`),
      ).resolves.toMatchObject({ status: 401 });
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/capabilities`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(unavailableRuntime.capabilities);
    } finally {
      await runtime.stop();
    }
  });

  it('exposes media MCP tools and rejects unavailable create requests without leaking details', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      tutorialMediaRuntime: unavailableRuntime,
    } as Parameters<typeof startRuntime>[0]);
    try {
      const listed = await mcpJson<{ result?: { tools?: Array<{ name?: string }> } }>(
        runtime.mcpEndpoint,
        accessToken,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      );
      expect(listed.payload.result?.tools?.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'operatingline.procedure.tutorial.media.capabilities',
          'operatingline.procedure.tutorial.media.jobs.create',
          'operatingline.procedure.tutorial.media.jobs.status',
          'operatingline.procedure.tutorial.media.jobs.restart',
          'operatingline.procedure.tutorial.media.authoring.prepare',
          'operatingline.procedure.tutorial.media.authoring.runs.create',
          'operatingline.procedure.tutorial.media.authoring.runs.status',
          'operatingline.procedure.tutorial.media.authoring.runs.review',
        ]),
      );

      const create = await mcpJson<{ result?: { isError?: boolean; content?: unknown[] } }>(
        runtime.mcpEndpoint,
        accessToken,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'operatingline.procedure.tutorial.media.jobs.create',
            arguments: { requestId: 'not-a-request' },
          },
        },
      );
      expect(create.status).toBe(200);
      expect(create.payload.result?.isError).toBe(true);
      expect(JSON.stringify(create.payload)).not.toMatch(/yt-dlp|whisper|tesseract|\/Users\//u);
    } finally {
      await runtime.stop();
    }
  });

  it('rejects malformed media authoring run create, status, and review requests over HTTP and MCP', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      tutorialMediaRuntime: unavailableRuntime,
    } as Parameters<typeof startRuntime>[0]);
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    const routes = [
      {
        path: 'runs',
        tool: 'operatingline.procedure.tutorial.media.authoring.runs.create',
        error: 'invalid_procedure_tutorial_media_authoring_run_create_request',
      },
      {
        path: 'runs/status',
        tool: 'operatingline.procedure.tutorial.media.authoring.runs.status',
        error: 'invalid_procedure_tutorial_media_authoring_run_status_request',
      },
      {
        path: 'runs/review',
        tool: 'operatingline.procedure.tutorial.media.authoring.runs.review',
        error: 'invalid_procedure_tutorial_media_authoring_review_request',
      },
    ] as const;
    try {
      for (const [index, route] of routes.entries()) {
        const response = await fetch(
          `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/${route.path}`,
          { method: 'POST', headers, body: JSON.stringify({}) },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: route.error });

        const called = await mcpJson<{
          result?: { isError?: boolean; content?: Array<{ text?: string }> };
        }>(runtime.mcpEndpoint, accessToken, {
          jsonrpc: '2.0',
          id: 30 + index,
          method: 'tools/call',
          params: { name: route.tool, arguments: {} },
        });
        expect(called.status).toBe(200);
        expect(called.payload.result?.isError).toBe(true);
        expect(JSON.stringify(called.payload)).toContain(route.error);
        expect(JSON.stringify(called.payload)).not.toMatch(/yt-dlp|whisper|tesseract|\/Users\//u);
      }
    } finally {
      await runtime.stop();
    }
  });

  it('rejects invalid HTTP create/status/restart bodies with safe 400 responses', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      tutorialMediaRuntime: unavailableRuntime,
    } as Parameters<typeof startRuntime>[0]);
    try {
      for (const path of ['jobs', 'jobs/status', 'jobs/restart']) {
        const response = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).not.toMatch(/yt-dlp|whisper|tesseract|\/Users\//u);
      }
    } finally {
      await runtime.stop();
    }
  });

  it('creates and reads an idempotent available job through the authenticated HTTP surface', async () => {
    let closeCount = 0;
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      tutorialMediaRuntime: blockingAvailableRuntime(() => {
        closeCount += 1;
      }),
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const created = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(analysisRequest),
      });
      expect(created.status).toBe(202);
      const accepted = (await created.json()) as {
        jobId: string;
        requestId: string;
        status: string;
      };
      expect(accepted).toMatchObject({ requestId: analysisRequest.requestId, status: 'accepted' });

      const status = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs/status`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          formatVersion: '1.0.0',
          jobId: accepted.jobId,
          requestId: analysisRequest.requestId,
        }),
      });
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        jobId: accepted.jobId,
        requestId: analysisRequest.requestId,
        status: expect.stringMatching(/^(accepted|running)$/u),
      });

      const repeated = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(analysisRequest),
      });
      expect(repeated.status).toBe(202);
      await expect(repeated.json()).resolves.toMatchObject({ jobId: accepted.jobId });
    } finally {
      await runtime.stop();
    }
    expect(closeCount).toBe(1);
  });

  it('prepares a verified completed media job for authoring without calling a Provider', async () => {
    let verifyCount = 0;
    let releaseVerification!: () => void;
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
      tutorialMediaRuntime: successfulAvailableRuntime(async () => {
        verifyCount += 1;
        markVerificationStarted();
        await verificationGate;
      }),
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const created = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(analysisRequest),
      });
      expect(created.status).toBe(202);
      const accepted = (await created.json()) as { jobId: string };
      let completed: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = await fetch(
          `${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs/status`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              formatVersion: '1.0.0',
              requestId: analysisRequest.requestId,
              jobId: accepted.jobId,
            }),
          },
        );
        const body = (await status.json()) as Record<string, unknown>;
        if (body['status'] === 'completed') {
          completed = body;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(completed).toBeDefined();

      const prepareRequest = {
        formatVersion: '1.0.0',
        analysisRequestId: analysisRequest.requestId,
        analysisJobId: accepted.jobId,
        request: {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Recreate the eye demonstrated by the authorized media.',
          treeId: 'tutorial.media.eye.procedure',
          revision: 1,
          locale: 'en',
        },
        video: {
          title: 'Authorized eye tutorial',
        },
      };
      const preparedPromise = fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        { method: 'POST', headers, body: JSON.stringify(prepareRequest) },
      );
      await verificationStarted;

      const concurrentRepeat = mcpJson<{
        result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
      }>(runtime.mcpEndpoint, accessToken, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'operatingline.procedure.tutorial.media.authoring.prepare',
          arguments: prepareRequest,
        },
      });
      const conflicting = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...prepareRequest,
            request: { ...prepareRequest.request, goal: 'Build a different object.' },
          }),
        },
      );
      expect(conflicting.status).toBe(409);
      await expect(conflicting.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_authoring_conflict',
        requestId: analysisRequest.requestId,
      });
      const atCapacity = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...prepareRequest,
            analysisRequestId: '77777777-7777-4777-8777-777777777777',
            analysisJobId: '88888888-8888-4888-8888-888888888888',
          }),
        },
      );
      expect(atCapacity.status).toBe(429);
      await expect(atCapacity.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_authoring_capacity_exceeded',
        requestId: '77777777-7777-4777-8777-777777777777',
      });
      releaseVerification();

      const prepared = await preparedPromise;
      expect(prepared.status).toBe(200);
      const preparation = (await prepared.json()) as Record<string, unknown>;
      expect(preparation).toMatchObject({
        formatVersion: '1.0.0',
        analysisRequestId: analysisRequest.requestId,
        analysisJobId: accepted.jobId,
        status: 'ready',
        quality: {
          semanticSegmentCount: 1,
          blockers: [],
          coverage: { asr: 1, frameEvidence: 1, visual: 1 },
        },
        evidenceBindings: [
          {
            promptSegmentOrder: 1,
            semanticSegmentId: '66666666-6666-4666-8666-666666666667',
          },
        ],
        sideEffects: {
          providerCalled: false,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });
      expect(verifyCount).toBe(1);

      const concurrentPreparation = await concurrentRepeat;
      expect(concurrentPreparation.payload.result?.isError).not.toBe(true);
      expect(concurrentPreparation.payload.result?.structuredContent).toEqual(preparation);
      expect(verifyCount).toBe(1);

      const repeated = await mcpJson<{
        result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
      }>(runtime.mcpEndpoint, accessToken, {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'operatingline.procedure.tutorial.media.authoring.prepare',
          arguments: prepareRequest,
        },
      });
      expect(repeated.payload.result?.isError).not.toBe(true);
      expect(repeated.payload.result?.structuredContent).toEqual(preparation);
      expect(verifyCount).toBe(2);

      const forgedRights = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...prepareRequest,
            video: { title: 'Authorized eye tutorial', rightsStatus: 'public_domain' },
          }),
        },
      );
      expect(forgedRights.status).toBe(400);
      await expect(forgedRights.json()).resolves.toMatchObject({
        error: 'invalid_procedure_tutorial_media_authoring_prepare_request',
        requestId: analysisRequest.requestId,
      });
      expect(verifyCount).toBe(2);
    } finally {
      await runtime.stop();
    }
  });

  it('returns a blocked null packet over HTTP and MCP when verified analysis has no semantic segments', async () => {
    let verifyCount = 0;
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
      tutorialMediaRuntime: successfulAvailableRuntime(() => {
        verifyCount += 1;
      }, completedAnalysisWithoutSemanticSegments),
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const created = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(analysisRequest),
      });
      expect(created.status).toBe(202);
      const accepted = (await created.json()) as { jobId: string };
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = await fetch(
          `${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs/status`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              formatVersion: '1.0.0',
              requestId: analysisRequest.requestId,
              jobId: accepted.jobId,
            }),
          },
        );
        const body = (await status.json()) as Record<string, unknown>;
        if (body['status'] === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const prepareRequest = {
        formatVersion: '1.0.0',
        analysisRequestId: analysisRequest.requestId,
        analysisJobId: accepted.jobId,
        request: {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Recreate the eye demonstrated by the authorized media.',
          treeId: 'tutorial.media.eye.blocked.procedure',
          revision: 1,
          locale: 'en',
        },
        video: {
          title: 'Authorized eye tutorial without semantic segments',
        },
      };
      const prepared = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        { method: 'POST', headers, body: JSON.stringify(prepareRequest) },
      );
      expect(prepared.status).toBe(200);
      const preparation = (await prepared.json()) as Record<string, unknown>;
      expect(preparation).toMatchObject({
        status: 'blocked',
        packet: null,
        evidenceBindings: [],
        quality: {
          semanticSegmentCount: 0,
          blockers: [{ code: 'no_semantic_segments', semanticSegmentIds: [] }],
        },
        sideEffects: {
          providerCalled: false,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });
      expect(verifyCount).toBe(1);

      const repeated = await mcpJson<{
        result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
      }>(runtime.mcpEndpoint, accessToken, {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'operatingline.procedure.tutorial.media.authoring.prepare',
          arguments: prepareRequest,
        },
      });
      expect(repeated.payload.result?.isError).not.toBe(true);
      expect(repeated.payload.result?.structuredContent).toEqual(preparation);
      expect(verifyCount).toBe(2);
    } finally {
      await runtime.stop();
    }
  });

  it('closes an available media pipeline when coordinator construction fails', async () => {
    let closeCount = 0;
    const configured = blockingAvailableRuntime(() => {
      closeCount += 1;
    });
    const invalidRuntime = {
      ...configured,
      maximumConcurrentJobs: 0,
    } as unknown as ProcedureTutorialMediaRuntime;

    await expect(
      startRuntime({
        accessToken,
        databasePath: ':memory:',
        tutorialMediaRuntime: invalidRuntime,
      }),
    ).rejects.toThrow();
    expect(closeCount).toBe(1);
  });

  it('closes an available media pipeline when adapter initialization fails', async () => {
    let closeCount = 0;
    class FailingStatusAdapter extends FakeBlenderAdapter {
      override async getStatus(): Promise<never> {
        throw new Error('adapter startup failed');
      }
    }

    await expect(
      startRuntime({
        accessToken,
        adapters: [new FailingStatusAdapter()],
        databasePath: ':memory:',
        tutorialMediaRuntime: blockingAvailableRuntime(() => {
          closeCount += 1;
        }),
      }),
    ).rejects.toThrow('adapter startup failed');
    expect(closeCount).toBe(1);
  });
});
