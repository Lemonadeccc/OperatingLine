import { describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisStartRequestSchema,
  procedureTutorialMediaCapabilitiesSchema,
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
  onAnalyze: () => void = () => undefined,
): ProcedureTutorialMediaRuntime {
  const pipeline: ProcedureTutorialMediaPipeline = {
    async analyze(_request, _jobId, options) {
      onAnalyze();
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

const currentAnalysisRequest = procedureTutorialMediaAnalysisStartRequestSchema.parse({
  formatVersion: '1.1.0',
  requestId: analysisRequest.requestId,
  source: {
    kind: 'authorized_youtube_download',
    videoId: analysisRequest.videoId,
    sourceIdentitySha256: '0'.repeat(64),
    contentSha256: '1'.repeat(64),
    rightsBasis: 'rights_holder_permission',
    platformDownloadValidation: {
      authorityId: 'youtube-platform-authority-fixture',
      authorityKind: 'youtube_platform_authority',
      sideEffect: 'youtube_media_download',
      receiptContentSha256: '2'.repeat(64),
      authorityContentSha256: '3'.repeat(64),
    },
    rightsValidation: {
      authorityId: 'rights-authority-fixture',
      authorityKind: 'media_rights_authority',
      sideEffect: 'rights_validation',
      receiptContentSha256: '4'.repeat(64),
      authorityContentSha256: '5'.repeat(64),
    },
  },
  analysisProfile: analysisRequest.analysisProfile,
  locale: analysisRequest.locale,
  analysisWindow: analysisRequest.analysisWindow,
  requestedStages: analysisRequest.requestedStages,
  approvals: analysisRequest.approvals,
});
const currentLocalAnalysisRequest = procedureTutorialMediaAnalysisStartRequestSchema.parse({
  ...currentAnalysisRequest,
  requestId: '5c54d9dc-8351-4c26-8dbf-48f4ae78f5da',
  source: {
    kind: 'user_supplied_local_file',
    sourceIdentitySha256: '6'.repeat(64),
    contentSha256: '7'.repeat(64),
    rightsBasis: 'rights_holder_permission',
    importValidation: {
      authorityId: 'local-import-authority-fixture',
      authorityKind: 'local_import_authority',
      sideEffect: 'local_media_import',
      receiptContentSha256: '8'.repeat(64),
      authorityContentSha256: '9'.repeat(64),
    },
    rightsValidation: {
      authorityId: 'rights-authority-local-fixture',
      authorityKind: 'media_rights_authority',
      sideEffect: 'rights_validation',
      receiptContentSha256: 'a'.repeat(64),
      authorityContentSha256: 'b'.repeat(64),
    },
  },
  analysisProfile: 'local_tutorial_evidence_v1',
  requestedStages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  approvals: {
    networkAccessApproved: false,
    mediaDownloadApproved: false,
    retentionApproved: true,
  },
});

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

  it('rejects legacy starts and fails closed for current sources before the legacy pipeline', async () => {
    let closeCount = 0;
    let analyzeCount = 0;
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      tutorialMediaRuntime: blockingAvailableRuntime(
        () => {
          closeCount += 1;
        },
        () => {
          analyzeCount += 1;
        },
      ),
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
      expect(created.status).toBe(400);
      await expect(created.json()).resolves.toMatchObject({
        error: 'invalid_procedure_tutorial_media_analysis_request',
      });
      const unsupported = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(currentAnalysisRequest),
      });
      expect(unsupported.status).toBe(422);
      await expect(unsupported.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_source_not_supported',
        requestId: currentAnalysisRequest.requestId,
      });
      const unsupportedLocal = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`,
        { method: 'POST', headers, body: JSON.stringify(currentLocalAnalysisRequest) },
      );
      expect(unsupportedLocal.status).toBe(422);
      await expect(unsupportedLocal.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_source_not_supported',
        requestId: currentLocalAnalysisRequest.requestId,
      });
      for (const currentRequest of [currentAnalysisRequest, currentLocalAnalysisRequest]) {
        const mcpResponse = await mcpJson<{
          result?: { isError?: boolean; content?: Array<{ text?: string }> };
        }>(runtime.mcpEndpoint, accessToken, {
          jsonrpc: '2.0',
          id: currentRequest.requestId,
          method: 'tools/call',
          params: {
            name: 'operatingline.procedure.tutorial.media.jobs.create',
            arguments: currentRequest,
          },
        });
        expect(mcpResponse.payload.result?.isError).toBe(true);
        expect(JSON.parse(mcpResponse.payload.result?.content?.[0]?.text ?? '{}')).toMatchObject({
          error: 'procedure_tutorial_media_source_not_supported',
          requestId: currentRequest.requestId,
        });
      }
    } finally {
      await runtime.stop();
    }
    expect(closeCount).toBe(1);
    expect(analyzeCount).toBe(0);
  });

  it('blocks YouTube authoring preparation when Phase 0 cannot complete a current analysis job', async () => {
    let analyzeCount = 0;
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
      tutorialMediaRuntime: blockingAvailableRuntime(
        () => undefined,
        () => {
          analyzeCount += 1;
        },
      ),
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const created = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(currentAnalysisRequest),
      });
      expect(created.status).toBe(422);
      await expect(created.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_source_not_supported',
        requestId: currentAnalysisRequest.requestId,
      });

      const prepareRequest = {
        formatVersion: '1.1.0',
        analysisRequestId: currentAnalysisRequest.requestId,
        analysisJobId: '88888888-8888-4888-8888-888888888888',
        source: currentAnalysisRequest.source,
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
          uri: `https://www.youtube.com/watch?v=${currentAnalysisRequest.source.videoId}`,
        },
      };
      const prepared = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/tutorial/media/authoring/prepare`,
        { method: 'POST', headers, body: JSON.stringify(prepareRequest) },
      );
      expect(prepared.status).toBe(404);
      await expect(prepared.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_not_found',
        requestId: currentAnalysisRequest.requestId,
      });
      expect(analyzeCount).toBe(0);
    } finally {
      await runtime.stop();
    }
  });

  it('blocks local authoring preparation over MCP when Phase 0 cannot complete a current analysis job', async () => {
    let analyzeCount = 0;
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
      tutorialMediaRuntime: blockingAvailableRuntime(
        () => undefined,
        () => {
          analyzeCount += 1;
        },
      ),
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const created = await fetch(`${runtime.baseUrl}/api/v1/procedure/tutorial/media/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(currentLocalAnalysisRequest),
      });
      expect(created.status).toBe(422);
      await expect(created.json()).resolves.toMatchObject({
        error: 'procedure_tutorial_media_source_not_supported',
        requestId: currentLocalAnalysisRequest.requestId,
      });

      const prepareRequest = {
        formatVersion: '1.1.0',
        analysisRequestId: currentLocalAnalysisRequest.requestId,
        analysisJobId: '99999999-9999-4999-8999-999999999999',
        source: currentLocalAnalysisRequest.source,
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
          title: 'Authorized local eye tutorial',
          uri: `operatingline-media://sha256/${currentLocalAnalysisRequest.source.contentSha256}`,
        },
      };
      const prepared = await mcpJson<{
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      }>(runtime.mcpEndpoint, accessToken, {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'operatingline.procedure.tutorial.media.authoring.prepare',
          arguments: prepareRequest,
        },
      });
      expect(prepared.payload.result?.isError).toBe(true);
      expect(JSON.parse(prepared.payload.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        error: 'procedure_tutorial_media_not_found',
        requestId: currentLocalAnalysisRequest.requestId,
      });
      expect(analyzeCount).toBe(0);
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
