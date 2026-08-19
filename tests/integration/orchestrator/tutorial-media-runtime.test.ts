import { describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaCapabilitiesSchema,
  type ProcedureTutorialMediaCapabilities,
} from '@operatingline/protocol';
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
  const capabilities = procedureTutorialMediaCapabilitiesSchema.parse({
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
