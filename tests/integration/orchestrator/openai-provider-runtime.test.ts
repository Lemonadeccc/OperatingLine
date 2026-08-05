import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { createOpenAIResponsesPlannerProvider } from '@operatingline/openai-planner-provider';
import { startRuntime } from '@operatingline/orchestrator';

const accessToken = 'openai-runtime-test-access-token';
const catalogVersion = blenderActionCatalog.catalogVersion;
const snowmanCapabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'complete-snowman',
      statement: 'Create and render the complete snowman.',
      coverage: [
        { capabilityId: 'geometry.ground_plane', stepIds: ['snowman.scene.ground'] },
        {
          capabilityId: 'geometry.primitive_assembly',
          stepIds: [
            'snowman.model.body_lower',
            'snowman.model.body_upper',
            'snowman.model.head',
            'snowman.details.face',
            'snowman.details.buttons',
            'snowman.details.arms',
          ],
        },
        {
          capabilityId: 'appearance.principled_palette',
          stepIds: [
            'snowman.materials.snow',
            'snowman.materials.accessories',
            'snowman.materials.ground',
          ],
        },
        { capabilityId: 'animation.rigid_armature', stepIds: ['snowman.animation.rig'] },
        {
          capabilityId: 'animation.rigid_pose_keyframes',
          stepIds: ['snowman.animation.pose'],
        },
        {
          capabilityId: 'render.scene_setup',
          stepIds: ['snowman.lighting.scene', 'snowman.lighting.rig'],
        },
        { capabilityId: 'output.png_preview', stepIds: ['snowman.render.preview'] },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function openAIResponse(outputText: string): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_operatingline_test',
      object: 'response',
      created_at: 1,
      status: 'completed',
      error: null,
      incomplete_details: null,
      model: 'test-model',
      output: [
        {
          id: 'msg_operatingline_test',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', annotations: [], text: outputText }],
        },
      ],
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_operatingline_test',
      },
    },
  );
}

describe('OpenAI planner provider runtime integration', () => {
  it('uses the official SDK transport once and preserves the no-auto-proposal boundary', async () => {
    const goal = 'Create a complete snowman and render a preview.';
    const planId = 'openai-provider-generated-snowman';
    vi.stubEnv('OPENAI_API_KEY', 'sk-ambient-key-must-not-be-used');
    vi.stubEnv('OPENAI_ADMIN_KEY', 'sk-ambient-admin-must-not-be-used');
    vi.stubEnv('OPENAI_BASE_URL', 'https://unexpected.invalid/v9');
    vi.stubEnv('OPENAI_ORG_ID', 'ambient-organization-must-not-be-used');
    vi.stubEnv('OPENAI_PROJECT_ID', 'ambient-project-must-not-be-used');
    vi.stubEnv('OPENAI_WEBHOOK_SECRET', 'ambient-webhook-secret-must-not-be-used');
    vi.stubEnv(
      'OPENAI_CUSTOM_HEADERS',
      [
        'Authorization: Bearer ambient-credential-must-not-be-used',
        'OpenAI-Organization: ambient-custom-organization',
        'OpenAI-Project: ambient-custom-project',
        'Accept: text/plain',
        'Content-Type: text/plain',
        'User-Agent: ambient-user-agent',
        'X-Stainless-Retry-Count: 99',
        'X-Ambient-Header: must-not-be-sent',
        'malformed custom header without a colon must be ignored',
      ].join('\n'),
    );
    vi.stubEnv('OPENAI_LOG', 'debug');
    const sdkLogSpies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const fixture = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
    ) as Record<string, unknown> & { id: string; revision: number };
    const draft = {
      targetAdapterId: 'blender',
      catalogVersion,
      planning: {
        goal,
        requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
        capabilityCoverage: snowmanCapabilityCoverage,
      },
      plan: { ...fixture, id: planId, revision: 1 },
    };
    const upstreamCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      upstreamCalls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
      return openAIResponse(JSON.stringify(draft));
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-runtime-test-only',
      model: 'test-model',
      fetch: fakeFetch,
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    const generationRequest = {
      requestId: randomUUID(),
      providerId: provider.descriptor.id,
      targetAdapterId: 'blender',
      catalogVersion,
      goal,
      planId,
    };

    try {
      const listed = await fetch(`${runtime.baseUrl}/api/v1/planner/providers`, { headers });
      await expect(listed.json()).resolves.toMatchObject({
        generationAvailable: true,
        providers: [
          {
            id: 'openai-responses:test-model',
            availability: { available: true },
            dataHandling: {
              executionLocation: 'remote',
              dataTransmission: 'provider_managed',
              credentialManagement: 'provider_managed',
            },
          },
        ],
      });

      const generated = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(generationRequest),
      });
      expect(generated.status).toBe(200);
      const result = (await generated.json()) as Record<string, unknown>;
      expect(result).toMatchObject({
        requestId: generationRequest.requestId,
        provider: { id: 'openai-responses:test-model' },
        status: 'ready',
        proposalCreated: false,
        draft: { targetAdapterId: 'blender', catalogVersion, plan: { id: planId, revision: 1 } },
        planningQuality: { valid: true },
      });
      expect(JSON.stringify(result)).not.toContain('sk-runtime-test-only');

      const replayed = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(generationRequest),
      });
      await expect(replayed.json()).resolves.toEqual(result);
      expect(upstreamCalls).toHaveLength(1);

      const upstream = upstreamCalls[0];
      expect(upstream?.input).toBe('https://api.openai.com/v1/responses');
      const upstreamHeaders = new Headers(upstream?.init?.headers);
      expect(upstreamHeaders.get('authorization')).toBe('Bearer sk-runtime-test-only');
      expect(upstreamHeaders.get('openai-organization')).toBeNull();
      expect(upstreamHeaders.get('openai-project')).toBeNull();
      expect(upstreamHeaders.get('accept')).toBe('application/json');
      expect(upstreamHeaders.get('content-type')).toBe('application/json');
      expect(upstreamHeaders.get('user-agent')).toBe('OperatingLine-OpenAI-Planner/0.1.0');
      expect(upstreamHeaders.get('x-stainless-retry-count')).toBe('0');
      expect(upstreamHeaders.get('x-ambient-header')).toBeNull();
      expect(JSON.parse(String(upstream?.init?.body))).toMatchObject({
        model: 'test-model',
        input: expect.stringContaining('"protocolVersion": "1.1.0"'),
        max_output_tokens: 32_768,
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      });

      const activeGuide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(activeGuide.json()).resolves.toEqual({ plan: null });
      const evidence = await fetch(
        `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=blender&planId=${planId}`,
        { headers },
      );
      const bundle = (await evidence.json()) as {
        events?: Array<{ eventType?: string; payload?: Record<string, unknown> }>;
      };
      expect(bundle.events?.map((event) => event.eventType)).not.toContain(
        'guide.proposal.created',
      );
      const qualityEvent = bundle.events?.find(
        (event) => event.eventType === 'planning.quality.evaluated',
      );
      expect(qualityEvent?.payload).toMatchObject({
        capabilityCoverage: snowmanCapabilityCoverage,
        report: {
          baselineVersion: '1.1.0',
          capabilityCoverage: snowmanCapabilityCoverage,
          valid: true,
        },
      });
      expect(
        (qualityEvent?.payload?.['report'] as Record<string, unknown>)['score'],
      ).toBeUndefined();
      const sdkLogs = sdkLogSpies
        .flatMap((spy) => spy.mock.calls)
        .map((arguments_) => format(...arguments_))
        .join('\n');
      expect(sdkLogs).not.toContain(goal);
      expect(sdkLogs).not.toContain(planId);
      expect(sdkLogs).not.toContain('sk-runtime-test-only');
    } finally {
      await runtime.stop();
    }
  });

  it('uses a custom endpoint only when it is explicitly configured', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://ambient.invalid/v1');
    const fakeFetch = vi.fn(async () => openAIResponse('{}'));
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-explicit-endpoint-test-only',
      baseURL: 'https://explicit.example/v2',
      model: 'test-model',
      fetch: fakeFetch,
    });

    await expect(
      provider.generate({
        requestId: randomUUID(),
        packet: { renderedPrompt: 'return JSON' } as never,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(String(fakeFetch.mock.calls[0]?.[0])).toBe('https://explicit.example/v2/responses');
  });

  it('disables official SDK retries and sanitizes upstream failures', async () => {
    const upstreamSecret = 'upstream-body-with-sensitive-detail';
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: upstreamSecret,
              type: 'server_error',
              code: 'server_error',
            },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-failure-test-only',
      model: 'test-model',
      fetch: fakeFetch,
    });

    const error = await provider
      .generate({
        requestId: randomUUID(),
        packet: { renderedPrompt: 'return JSON' } as never,
        signal: new AbortController().signal,
      })
      .catch((caught: unknown) => caught);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'request_failed' });
    expect(String(error)).not.toContain(upstreamSecret);
    expect(String(error)).not.toContain('sk-failure-test-only');
  });
});
