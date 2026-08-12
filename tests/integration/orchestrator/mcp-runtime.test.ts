import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { FakeBlenderAdapter, FakePlannerProvider } from '@operatingline/test-kit';
import { openOperatingLineDatabase } from '@operatingline/persistence';

import {
  computeEvalContentSha256,
  computePlanContentSha256,
  startRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';

const accessToken = 'test-token-with-at-least-16-characters';
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
            'snowman.details.face.eye_left',
            'snowman.details.face.eye_right',
            'snowman.details.face.nose',
            'snowman.details.face.mouth_1',
            'snowman.details.face.mouth_2',
            'snowman.details.face.mouth_3',
            'snowman.details.face.mouth_4',
            'snowman.details.face.mouth_5',
            'snowman.details.buttons.button_1',
            'snowman.details.buttons.button_2',
            'snowman.details.buttons.button_3',
            'snowman.details.arms.left',
            'snowman.details.arms.right',
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
const snowmanHeadCapabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'larger-head',
      statement: 'Make the referenced snowman head larger.',
      coverage: [{ capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] }],
    },
  ],
};

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => {
    probe.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

function failingEventDatabase(eventType: 'runtime.started' | 'runtime.stopped') {
  const directory = mkdtempSync(join(tmpdir(), 'operatingline-runtime-test-'));
  const databasePath = join(directory, 'events.db');
  openOperatingLineDatabase(databasePath).close();
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TRIGGER fail_runtime_event
    BEFORE INSERT ON execution_events
    WHEN NEW.event_type = '${eventType}'
    BEGIN
      SELECT RAISE(FAIL, 'injected ${eventType} failure');
    END;
  `);
  sqlite.close();
  return { directory, databasePath };
}

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
}

interface McpResponse<TResult> {
  result?: TResult;
  error?: { code?: number; message?: string };
}

function companionReport(instanceId: string, sequence: number) {
  return {
    protocolVersion: '1.0.0',
    reportId: randomUUID(),
    sequence,
    adapterId: 'fake-blender',
    instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.0',
    plan: null,
    planContentSha256: null,
    executionId: null,
    phase: 'idle',
    activeStepId: null,
    completedStepIds: [],
    transition: 'connected',
    stepId: null,
    observations: [],
    error: null,
    occurredAt: new Date().toISOString(),
  };
}

async function callMcpTool(
  runtime: RunningRuntime,
  id: number,
  name: string,
  argumentsValue: unknown,
): Promise<McpToolResponse> {
  return callMcpRequest<NonNullable<McpToolResponse['result']>>(runtime, id, 'tools/call', {
    name,
    arguments: argumentsValue,
  });
}

async function callMcpRequest<TResult>(
  runtime: RunningRuntime,
  id: number,
  method: string,
  params?: unknown,
): Promise<McpResponse<TResult>> {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP tool call failed with HTTP ${response.status}`);
  }
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  if (dataLine === undefined) {
    throw new Error('MCP tool call did not return an SSE data event');
  }
  return JSON.parse(dataLine.slice('data: '.length)) as McpResponse<TResult>;
}

describe('OperatingLine runtime', () => {
  it('serves health over HTTP and MCP', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      adapters: [new FakeBlenderAdapter()],
    });

    try {
      const healthResponse = await fetch(`${runtime.baseUrl}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toMatchObject({
        phase: 'ready',
        database: 'ready',
        adapters: [{ id: 'fake-blender', connected: true }],
      });
      const emptyProviders = await fetch(`${runtime.baseUrl}/api/v1/planner/providers`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(emptyProviders.status).toBe(200);
      await expect(emptyProviders.json()).resolves.toEqual({
        contractVersion: '1.0.0',
        generationAvailable: false,
        providers: [],
      });

      const listResponse = await fetch(runtime.mcpEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(listResponse.status).toBe(200);
      expect(listResponse.headers.get('content-type')).toContain('text/event-stream');
      const dataLine = (await listResponse.text())
        .split('\n')
        .find((line) => line.startsWith('data: '));
      expect(dataLine).toBeDefined();
      const toolsPayload = JSON.parse(dataLine!.slice('data: '.length)) as {
        result?: { tools?: Array<{ name?: string; inputSchema?: unknown }> };
      };
      expect(toolsPayload).toMatchObject({
        result: {
          tools: [
            { name: 'operatingline.health' },
            { name: 'operatingline.adapters.list' },
            {
              name: 'operatingline.companions.list',
              description: 'List the latest known state reported by each host companion.',
            },
            { name: 'operatingline.action_catalog.get' },
            { name: 'operatingline.planning.context' },
            { name: 'operatingline.planning.evaluate' },
            { name: 'operatingline.planning.prompt.get' },
            { name: 'operatingline.planner.providers.list' },
            { name: 'operatingline.planner.generate' },
            { name: 'operatingline.goal.requests.list' },
            { name: 'operatingline.goal.prompt.get' },
            { name: 'operatingline.replan.providers.list' },
            { name: 'operatingline.replan.prompt.get' },
            { name: 'operatingline.replan.generate' },
            { name: 'operatingline.replan.requests.list' },
            { name: 'operatingline.replan.thread.get' },
            { name: 'operatingline.eval.export' },
            { name: 'operatingline.replan.propose' },
            { name: 'operatingline.guide.publish' },
            { name: 'operatingline.guide.propose' },
          ],
        },
      });
      expect(
        toolsPayload.result?.tools?.find((tool) => tool.name === 'operatingline.replan.propose')
          ?.inputSchema,
      ).toMatchObject({
        type: 'object',
        required: ['requestId', 'catalogVersion', 'plan'],
        additionalProperties: false,
      });

      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as { id: string; revision: number };
      const publishResponse = await fetch(runtime.mcpEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'operatingline.guide.publish', arguments: plan },
        }),
      });
      expect(publishResponse.status).toBe(200);

      const guideResponse = await fetch(`${runtime.baseUrl}/api/v1/guide`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(guideResponse.status).toBe(200);
      await expect(guideResponse.json()).resolves.toMatchObject({
        plan: { id: plan.id, revision: plan.revision },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('serves a versioned action catalog and goal-specific planning context', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const catalogResponse = await callMcpTool(runtime, 10, 'operatingline.action_catalog.get', {
        targetAdapterId: 'blender',
      });
      expect(catalogResponse.result?.isError).not.toBe(true);
      const catalog = JSON.parse(catalogResponse.result?.content?.[0]?.text ?? '{}') as {
        catalogVersion?: string;
        actions?: Array<{ name?: string }>;
        planningPhases?: Array<{ id?: string }>;
      };
      expect(catalog).toMatchObject({ catalogVersion });
      expect(catalog.actions).toHaveLength(15);
      expect(catalog.planningPhases?.map((phase) => phase.id)).toEqual([
        'geometry',
        'materials',
        'animation',
        'render_setup',
        'output',
      ]);

      const goal = 'Create a simple three-part mascot and render a preview';
      const contextResponse = await callMcpTool(runtime, 11, 'operatingline.planning.context', {
        targetAdapterId: 'blender',
        goal,
        planId: 'mascot-demo',
      });
      const context = JSON.parse(contextResponse.result?.content?.[0]?.text ?? '{}') as {
        goal?: string;
        recommendedRevision?: number;
        constraints?: { humanApprovalRequired?: boolean };
        submission?: { toolName?: string };
        qualityGate?: { toolName?: string; baselineVersion?: string };
      };
      expect(context).toMatchObject({
        goal,
        recommendedRevision: 1,
        constraints: { humanApprovalRequired: true },
        submission: { toolName: 'operatingline.guide.propose' },
        qualityGate: {
          toolName: 'operatingline.planning.evaluate',
          baselineVersion: '1.1.0',
        },
      });

      const promptToolResponse = await callMcpTool(
        runtime,
        110,
        'operatingline.planning.prompt.get',
        {
          targetAdapterId: 'blender',
          goal,
          planId: 'mascot-prompt-demo',
        },
      );
      const promptPacket = JSON.parse(promptToolResponse.result?.content?.[0]?.text ?? '{}') as {
        formatVersion?: string;
        context?: { requestedPlanId?: string; catalog?: { catalogVersion?: string } };
        responseContract?: { schema?: { additionalProperties?: boolean } };
        renderedPrompt?: string;
      };
      expect(promptPacket).toMatchObject({
        formatVersion: '1.1.0',
        context: {
          requestedPlanId: 'mascot-prompt-demo',
          catalog: { catalogVersion },
        },
        responseContract: { schema: { additionalProperties: false } },
      });
      expect(promptPacket.renderedPrompt).toContain('operatingline.planning.evaluate');

      const prompts = await callMcpRequest<{
        prompts?: Array<{ name?: string; title?: string }>;
      }>(runtime, 1101, 'prompts/list');
      expect(prompts.result?.prompts).toContainEqual(
        expect.objectContaining({ name: 'operatingline.plan_and_propose' }),
      );
      const prompt = await callMcpRequest<{
        description?: string;
        messages?: Array<{ content?: { type?: string; text?: string } }>;
      }>(runtime, 1102, 'prompts/get', {
        name: 'operatingline.plan_and_propose',
        arguments: {
          targetAdapterId: 'blender',
          catalogVersion,
          goal,
          planId: 'mascot-prompt-demo',
        },
      });
      expect(prompt.error).toBeUndefined();
      expect(prompt.result?.description).toContain(`blender@${catalogVersion}`);
      expect(prompt.result?.messages?.[0]?.content).toMatchObject({
        type: 'text',
        text: promptPacket.renderedPrompt,
      });

      const fixture = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as Record<string, unknown>;
      const plan = { ...fixture, id: 'mascot-demo', revision: 1 };
      const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
      const qualityResponse = await callMcpTool(runtime, 111, 'operatingline.planning.evaluate', {
        targetAdapterId: 'blender',
        catalogVersion,
        goal,
        requiredPhaseIds,
        capabilityCoverage: snowmanCapabilityCoverage,
        plan,
      });
      expect(JSON.parse(qualityResponse.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        valid: true,
        goal,
        requiredPhaseIds,
        summary: { errorCount: 0, usedPhaseCount: 5 },
      });
      expect(
        (
          await callMcpTool(runtime, 12, 'operatingline.guide.propose', {
            targetAdapterId: 'blender',
            catalogVersion,
            planning: { goal, requiredPhaseIds, capabilityCoverage: snowmanCapabilityCoverage },
            plan,
          })
        ).result?.isError,
      ).not.toBe(true);
      const revisedContext = await callMcpTool(runtime, 13, 'operatingline.planning.context', {
        targetAdapterId: 'blender',
        goal,
        planId: 'mascot-demo',
      });
      expect(JSON.parse(revisedContext.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        recommendedRevision: 2,
      });

      const httpContext = await fetch(
        `${runtime.baseUrl}/api/v1/planning/context?targetAdapterId=blender&goal=${encodeURIComponent(goal)}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(httpContext.status).toBe(200);
      await expect(httpContext.json()).resolves.toMatchObject({
        targetAdapterId: 'blender',
        catalog: { catalogVersion },
        qualityGate: { toolName: 'operatingline.planning.evaluate' },
      });

      const httpQuality = await fetch(`${runtime.baseUrl}/api/v1/planning/evaluate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetAdapterId: 'blender',
          catalogVersion,
          goal,
          requiredPhaseIds,
          capabilityCoverage: snowmanCapabilityCoverage,
          plan,
        }),
      });
      expect(httpQuality.status).toBe(200);
      await expect(httpQuality.json()).resolves.toMatchObject({ valid: true });

      const httpPrompt = await fetch(`${runtime.baseUrl}/api/v1/planning/prompt`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetAdapterId: 'blender',
          catalogVersion,
          goal,
          planId: 'mascot-prompt-demo',
        }),
      });
      expect(httpPrompt.status).toBe(200);
      await expect(httpPrompt.json()).resolves.toEqual(promptPacket);

      const unavailable = await callMcpTool(runtime, 14, 'operatingline.action_catalog.get', {
        targetAdapterId: 'gimp',
      });
      expect(unavailable.result).toMatchObject({ isError: true });
      expect(unavailable.result?.content?.[0]?.text).toContain('No action catalog is installed');

      const planWithUnknownAction = structuredClone(plan) as {
        id: string;
        revision: number;
        steps: Array<{ action: { name: string; arguments: Record<string, unknown> } | null }>;
      };
      planWithUnknownAction.id = 'unknown-action-demo';
      planWithUnknownAction.steps.find((step) => step.action !== null)!.action!.name =
        'blender.python.execute';
      const unknownAction = await callMcpTool(runtime, 15, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        plan: planWithUnknownAction,
      });
      expect(unknownAction.result).toMatchObject({ isError: true });
      expect(unknownAction.result?.content?.[0]?.text).toContain(
        `absent from blender@${catalogVersion}`,
      );

      const planWithUnknownArgument = structuredClone(plan) as {
        id: string;
        revision: number;
        steps: Array<{ action: { name: string; arguments: Record<string, unknown> } | null }>;
      };
      planWithUnknownArgument.id = 'unknown-argument-demo';
      planWithUnknownArgument.steps.find((step) => step.action !== null)!.action!.arguments[
        'python'
      ] = 'bpy.ops.wm.quit_blender()';
      const unknownArgument = await callMcpTool(runtime, 16, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        plan: planWithUnknownArgument,
      });
      expect(unknownArgument.result).toMatchObject({ isError: true });
      expect(unknownArgument.result?.content?.[0]?.text).toContain('unknown python');
    } finally {
      await runtime.stop();
    }
  });

  it('invokes an explicit planner provider without creating a proposal', async () => {
    const fixture = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as Record<string, unknown> & { id: string; revision: number };
    const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
    const provider = new FakePlannerProvider(({ packet }) => ({
      targetAdapterId: packet.context.targetAdapterId,
      catalogVersion: packet.context.catalog.catalogVersion,
      planning: {
        goal: packet.context.goal,
        requiredPhaseIds,
        capabilityCoverage: snowmanCapabilityCoverage,
      },
      plan: {
        ...structuredClone(fixture),
        id: packet.context.requestedPlanId,
        revision: packet.context.recommendedRevision,
      },
    }));
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const generationRequest = {
      requestId: randomUUID(),
      providerId: 'fake-planner',
      targetAdapterId: 'blender',
      catalogVersion,
      goal: 'Create a complete snowman and render a preview.',
      planId: 'provider-generated-snowman',
    };
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };

    try {
      const providerList = await callMcpTool(
        runtime,
        200,
        'operatingline.planner.providers.list',
        {},
      );
      expect(JSON.parse(providerList.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        contractVersion: '1.0.0',
        generationAvailable: true,
        providers: [
          {
            id: 'fake-planner',
            availability: { available: true },
            dataHandling: { credentialManagement: 'provider_managed' },
          },
        ],
      });

      const missingRequest = {
        ...generationRequest,
        requestId: randomUUID(),
        providerId: 'missing-planner',
      };
      const missingMcp = await callMcpTool(
        runtime,
        203,
        'operatingline.planner.generate',
        missingRequest,
      );
      expect(missingMcp.result?.isError).toBe(true);
      const missingMcpError = JSON.parse(missingMcp.result?.content?.[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      expect(missingMcpError).toEqual({
        error: 'planner_provider_not_found',
        requestId: missingRequest.requestId,
        message: 'Planner provider missing-planner is not registered',
        retryMode: 'same_request_id',
      });
      const missingHttp = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(missingRequest),
      });
      expect(missingHttp.status).toBe(404);
      await expect(missingHttp.json()).resolves.toEqual(missingMcpError);

      const invalidRequestId = randomUUID();
      const invalidHttp = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...generationRequest,
          requestId: invalidRequestId,
          apiKey: 'INVALID_REQUEST_SECRET',
        }),
      });
      expect(invalidHttp.status).toBe(400);
      const invalidError = await invalidHttp.json();
      expect(invalidError).toEqual({
        error: 'planner_invalid_request',
        requestId: invalidRequestId,
        message: 'Planner generation request violates the strict public contract',
        retryMode: 'never',
      });
      expect(JSON.stringify(invalidError)).not.toContain('INVALID_REQUEST_SECRET');

      const generated = await callMcpTool(
        runtime,
        201,
        'operatingline.planner.generate',
        generationRequest,
      );
      expect(generated.result?.isError).not.toBe(true);
      const result = JSON.parse(generated.result?.content?.[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      expect(result).toMatchObject({
        requestId: generationRequest.requestId,
        status: 'ready',
        proposalCreated: false,
        draft: {
          targetAdapterId: 'blender',
          catalogVersion,
          plan: { id: generationRequest.planId, revision: 1 },
        },
        planningQuality: { valid: true },
      });
      expect(generated.result?.structuredContent).toEqual(result);

      const httpList = await fetch(`${runtime.baseUrl}/api/v1/planner/providers`, { headers });
      expect(httpList.status).toBe(200);
      await expect(httpList.json()).resolves.toMatchObject({ generationAvailable: true });

      const repeated = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(generationRequest),
      });
      expect(repeated.status).toBe(200);
      await expect(repeated.json()).resolves.toEqual(result);
      expect(provider.inputs).toHaveLength(1);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });

      const evidence = await callMcpTool(runtime, 202, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: generationRequest.planId,
      });
      const bundle = JSON.parse(evidence.result?.content?.[0]?.text ?? '{}') as {
        events?: Array<{ eventType?: string }>;
        summary?: { eventTypeCounts?: Record<string, number> };
      };
      expect(bundle.summary?.eventTypeCounts).toMatchObject({
        'planning.context.generated': 1,
        'planning.prompt.generated': 1,
        'planning.provider.generation.requested': 1,
        'planning.quality.evaluated': 1,
        'planning.provider.generation.completed': 1,
      });
      expect(bundle.events?.map((event) => event.eventType)).not.toContain(
        'guide.proposal.created',
      );
    } finally {
      await runtime.stop();
    }
    expect(provider.closeCalls).toBe(1);
  });

  it('generates a typed local replan before explicitly proposing its exact draft', async () => {
    const basePlan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as {
      id: string;
      revision: number;
      steps: Array<{ id: string; title: string }>;
    };
    const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
    const provider = new FakePlannerProvider(
      () => {
        throw new Error('Initial generation must not run in the local replan flow');
      },
      {
        contractVersion: '1.0.0',
        id: 'fake-planner',
        version: '0.1.0',
        displayName: 'Fake Local Replanner',
        description: 'Deterministic provider for the runtime local replan integration test.',
        availability: { available: true },
        limits: { maxConcurrency: 1 },
        dataHandling: {
          executionLocation: 'local',
          dataTransmission: 'none',
          credentialManagement: 'provider_managed',
        },
      },
      ({ packet }) => {
        const plan = structuredClone(packet.context.revisionRequest.basePlan);
        plan.revision = packet.context.targetRevision;
        const head = plan.steps.find((step) => step.id === 'snowman.model.head');
        if (head === undefined) {
          throw new Error('Snowman fixture is missing the referenced head step');
        }
        head.title = 'Create a larger beginner-friendly snowman head';
        return {
          requestId: packet.context.revisionRequest.requestId,
          catalogVersion: packet.context.catalog.catalogVersion,
          planning: {
            goal: packet.context.revisionRequest.message,
            requiredPhaseIds,
            capabilityCoverage: snowmanHeadCapabilityCoverage,
          },
          plan,
        };
      },
    );
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
    const revisionRequestId = randomUUID();
    const instanceId = randomUUID();
    const revisionRequest = {
      protocolVersion: '1.1.0',
      requestId: revisionRequestId,
      adapterId: 'blender',
      catalogVersion,
      instanceId,
      basePlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Make only the referenced snowman head larger and easier to understand.',
      revisionThread: {
        threadId: revisionRequestId,
        turn: 1,
        parentRequestId: null,
      },
      occurredAt: new Date().toISOString(),
    };
    const generationRequest = {
      requestId: randomUUID(),
      revisionRequestId,
      providerId: 'fake-planner',
    };

    try {
      const revisionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(revisionRequest),
      });
      expect(revisionResponse.status).toBe(200);
      await expect(revisionResponse.json()).resolves.toEqual({
        result: 'accepted',
        requestId: revisionRequestId,
      });

      const providersResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/providers`, {
        headers,
      });
      expect(providersResponse.status).toBe(200);
      await expect(providersResponse.json()).resolves.toMatchObject({
        generationAvailable: true,
        providers: [{ id: 'fake-planner', availability: { available: true } }],
      });

      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ revisionRequestId }),
      });
      expect(promptResponse.status).toBe(200);
      await expect(promptResponse.json()).resolves.toMatchObject({
        formatVersion: '1.1.0',
        operation: 'local_replan',
        context: {
          revisionRequest: { requestId: revisionRequestId },
          targetRevision: basePlan.revision + 1,
          scope: { normalizedRootIds: ['snowman.model.head'] },
        },
        workflow: { submitToolName: 'operatingline.replan.propose' },
      });

      const generateResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(generationRequest),
      });
      expect(generateResponse.status).toBe(200);
      const generated = (await generateResponse.json()) as {
        requestId: string;
        status: string;
        proposalCreated: boolean;
        draft: {
          requestId: string;
          catalogVersion: string;
          planning: { goal: string; requiredPhaseIds: string[] };
          plan: typeof basePlan;
        };
      };
      expect(generated).toMatchObject({
        requestId: generationRequest.requestId,
        status: 'ready',
        proposalCreated: false,
        draft: {
          requestId: revisionRequestId,
          catalogVersion,
          plan: { id: basePlan.id, revision: basePlan.revision + 1 },
        },
      });
      expect(provider.replanInputs).toHaveLength(1);

      const alternateGenerationRequest = {
        ...generationRequest,
        requestId: randomUUID(),
      };
      const alternateGenerateResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(alternateGenerationRequest),
      });
      expect(alternateGenerateResponse.status).toBe(200);
      const alternateGenerated = (await alternateGenerateResponse.json()) as typeof generated;
      expect(alternateGenerated.draft).toEqual(generated.draft);
      expect(provider.replanInputs).toHaveLength(2);

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });

      const exactSubmission = {
        generationRequestId: generationRequest.requestId,
        requestId: revisionRequestId,
        catalogVersion: generated.draft.catalogVersion,
        planning: generated.draft.planning,
        plan: generated.draft.plan,
      };
      const tamperedPlan = structuredClone(generated.draft.plan);
      tamperedPlan.steps.find((step) => step.id === 'snowman.model.head')!.title =
        'Tampered after generation';
      const tamperedResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...exactSubmission, plan: tamperedPlan }),
      });
      expect(tamperedResponse.status).toBe(422);
      await expect(tamperedResponse.json()).resolves.toMatchObject({
        error: 'planner_identity_mismatch',
        requestId: generationRequest.requestId,
        retryMode: 'never',
      });

      const proposeResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(exactSubmission),
      });
      expect(proposeResponse.status).toBe(200);
      const proposed = (await proposeResponse.json()) as {
        proposalId: string;
        duplicate: boolean;
      };
      expect(proposed).toMatchObject({ duplicate: false });
      expect(proposed.proposalId).toEqual(expect.any(String));

      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({
        plan: null,
        planContentSha256: null,
        proposalPlanContentSha256: computePlanContentSha256(generated.draft.plan),
        proposal: {
          proposalId: proposed.proposalId,
          revisionRequestId,
          targetInstanceId: instanceId,
          plan: { id: basePlan.id, revision: basePlan.revision + 1 },
        },
      });

      const repeatedResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(exactSubmission),
      });
      expect(repeatedResponse.status).toBe(200);
      await expect(repeatedResponse.json()).resolves.toMatchObject({
        proposalId: proposed.proposalId,
        duplicate: true,
      });

      const otherGenerationResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...exactSubmission,
          generationRequestId: alternateGenerationRequest.requestId,
        }),
      });
      expect(otherGenerationResponse.status).toBe(409);
      await expect(otherGenerationResponse.json()).resolves.toMatchObject({
        error: 'planner_revision_request_not_pending',
        requestId: alternateGenerationRequest.requestId,
        retryMode: 'never',
      });

      const otherInstanceRevisionRequestId = randomUUID();
      const otherInstanceRevision = {
        ...revisionRequest,
        requestId: otherInstanceRevisionRequestId,
        instanceId: randomUUID(),
        message: 'INSTANCE_B_PRIVATE_REVISION_MESSAGE',
        revisionThread: {
          threadId: otherInstanceRevisionRequestId,
          turn: 1,
          parentRequestId: null,
        },
      };
      const otherRevisionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/revision-request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(otherInstanceRevision),
        },
      );
      expect(otherRevisionResponse.status).toBe(200);
      const otherInstanceGenerationResponse = await fetch(
        `${runtime.baseUrl}/api/v1/replan/generate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            requestId: randomUUID(),
            revisionRequestId: otherInstanceRevisionRequestId,
            providerId: 'fake-planner',
          }),
        },
      );
      expect(otherInstanceGenerationResponse.status).toBe(200);

      const evalUrl = new URL('/api/v1/eval/export', runtime.baseUrl);
      evalUrl.searchParams.set('targetAdapterId', 'blender');
      evalUrl.searchParams.set('planId', basePlan.id);
      evalUrl.searchParams.set('instanceId', instanceId);
      const evalBundle = (await fetch(evalUrl, { headers }).then((response) =>
        response.json(),
      )) as {
        summary: { eventTypeCounts: Record<string, number> };
        events: Array<{ eventType: string; payload: unknown }>;
      };
      expect(evalBundle.summary.eventTypeCounts).toMatchObject({
        'planning.provider.replan.requested': 2,
        'planning.provider.replan.completed': 2,
        'planning.provider.replan.proposed': 1,
      });
      expect(
        evalBundle.events.some((event) => event.eventType === 'planning.provider.replan.proposed'),
      ).toBe(true);
      expect(JSON.stringify(evalBundle)).not.toContain('privateReasoning');
      expect(JSON.stringify(evalBundle)).not.toContain('INSTANCE_B_PRIVATE_REVISION_MESSAGE');
    } finally {
      await runtime.stop();
    }
    expect(provider.closeCalls).toBe(1);
  });

  it('exports a paginated replay bundle with planning, approval, observations, and rollback', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    const instanceId = randomUUID();
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    const plan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as {
      id: string;
      revision: number;
      steps: Array<{ id: string; action: unknown }>;
    };
    const executableStepId = plan.steps.find((step) => step.action !== null)?.id;
    if (executableStepId === undefined) {
      throw new Error('Snowman fixture has no executable step');
    }

    try {
      const goal = 'Create a beginner-friendly snowman and retain every rollback observation.';
      await callMcpTool(runtime, 50, 'operatingline.planning.prompt.get', {
        targetAdapterId: 'blender',
        goal,
        planId: plan.id,
      });
      await callMcpTool(runtime, 501, 'operatingline.planning.context', {
        targetAdapterId: 'blender',
        goal: 'Unrelated plan that must not leak into this export.',
        planId: 'unrelated-plan',
      });
      const proposed = await callMcpTool(runtime, 51, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        catalogVersion,
        planning: {
          goal,
          requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
          capabilityCoverage: snowmanCapabilityCoverage,
        },
        plan,
      });
      const proposal = JSON.parse(proposed.result?.content?.[0]?.text ?? '{}') as {
        proposalId?: string;
      };
      if (proposal.proposalId === undefined) {
        throw new Error('Guide proposal did not return an id');
      }

      const decision = {
        protocolVersion: '1.0.0',
        decisionId: randomUUID(),
        proposalId: proposal.proposalId,
        adapterId: 'blender',
        instanceId,
        decision: 'accepted',
        occurredAt: new Date().toISOString(),
      };
      expect(
        await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
          method: 'POST',
          headers,
          body: JSON.stringify(decision),
        }).then((response) => response.json()),
      ).toEqual({ result: 'accepted' });

      const executionId = randomUUID();
      const report = (
        sequence: number,
        transition: 'step_succeeded' | 'step_rolled_back',
        satisfied: boolean,
      ) => ({
        protocolVersion: '1.0.0',
        reportId: randomUUID(),
        sequence,
        adapterId: 'blender',
        instanceId,
        companionVersion: '0.1.0',
        hostVersion: '4.5.3',
        plan: { id: plan.id, revision: plan.revision },
        planContentSha256: computePlanContentSha256(plan),
        executionId,
        phase: 'running',
        activeStepId: executableStepId,
        completedStepIds: transition === 'step_succeeded' ? [executableStepId] : [],
        transition,
        stepId: executableStepId,
        observations: [
          {
            kind: 'object_exists',
            satisfied,
            details: { logicalId: 'snowman.body.lower', source: 'integration-test' },
          },
        ],
        error: null,
        occurredAt: new Date().toISOString(),
      });
      for (const state of [
        report(1, 'step_succeeded', true),
        report(2, 'step_rolled_back', false),
      ]) {
        const response = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify(state),
        });
        expect(response.status).toBe(200);
      }
      const otherInstanceState = {
        ...report(1, 'step_succeeded', true),
        reportId: randomUUID(),
        instanceId: randomUUID(),
      };
      expect(
        (
          await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
            method: 'POST',
            headers,
            body: JSON.stringify(otherInstanceState),
          })
        ).status,
      ).toBe(200);

      const firstResponse = await callMcpTool(runtime, 52, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        limit: 3,
      });
      expect(firstResponse.result?.isError).not.toBe(true);
      const first = JSON.parse(firstResponse.result?.content?.[0]?.text ?? '{}') as {
        exportId: string;
        exportedAt: string;
        events: Array<{ eventType: string; payload: Record<string, unknown> }>;
        page: {
          snapshotId: string;
          snapshotUpperSequence: number;
          nextAfterSequence: number;
        };
        integrity: { contentSha256: string };
        [key: string]: unknown;
      };
      expect(first).toMatchObject({
        formatVersion: '1.1.0',
        scope: { targetAdapterId: 'blender', planId: plan.id, instanceId },
        catalogs: [{ adapterId: 'blender', catalogVersion }],
        page: { afterSequence: 0, hasMore: true },
        summary: {
          matchedEventCount: 7,
          eventTypeCounts: {
            'planning.context.generated': 1,
            'planning.prompt.generated': 1,
            'planning.quality.evaluated': 1,
            'guide.proposal.created': 1,
            'guide.proposal.decided': 1,
            'companion.state.reported': 2,
          },
          transitionCounts: { step_rolled_back: 1, step_succeeded: 1 },
          decisionCounts: { accepted: 1 },
        },
        dataHandling: { redaction: 'none', containsPotentiallySensitiveContent: true },
      });
      expect(first.events).toHaveLength(3);
      expect(first.events[0]).toMatchObject({
        eventType: 'planning.context.generated',
        payload: { context: { goal, requestedPlanId: plan.id } },
      });
      expect(first.events[1]).toMatchObject({
        eventType: 'planning.prompt.generated',
        payload: {
          packet: {
            formatVersion: '1.1.0',
            context: { goal, requestedPlanId: plan.id },
          },
        },
      });
      expect(first.events[2]).toMatchObject({
        eventType: 'planning.quality.evaluated',
        payload: {
          plan: { id: plan.id, steps: plan.steps },
          capabilityCoverage: snowmanCapabilityCoverage,
          report: {
            valid: true,
            baselineVersion: '1.1.0',
            capabilityCoverage: snowmanCapabilityCoverage,
          },
        },
      });
      expect(
        (first.events[2]?.payload['report'] as Record<string, unknown>)['score'],
      ).toBeUndefined();
      const firstContent = structuredClone(first) as Record<string, unknown>;
      delete firstContent['exportId'];
      delete firstContent['exportedAt'];
      delete firstContent['integrity'];
      expect(first.integrity.contentSha256).toBe(computeEvalContentSha256(firstContent));

      const repeatedResponse = await callMcpTool(runtime, 521, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        limit: 3,
      });
      const repeated = JSON.parse(repeatedResponse.result?.content?.[0]?.text ?? '{}') as {
        exportId: string;
        integrity: { contentSha256: string };
      };
      expect(repeated.exportId).not.toBe(first.exportId);
      expect(repeated.integrity.contentSha256).toBe(first.integrity.contentSha256);

      const lateGoal = 'This event was appended after the eval snapshot was frozen.';
      await callMcpTool(runtime, 522, 'operatingline.planning.context', {
        targetAdapterId: 'blender',
        goal: lateGoal,
        planId: plan.id,
      });

      const secondResponse = await callMcpTool(runtime, 53, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        afterSequence: first.page.nextAfterSequence,
        snapshotId: first.page.snapshotId,
        snapshotUpperSequence: first.page.snapshotUpperSequence,
        limit: 100,
      });
      const second = JSON.parse(secondResponse.result?.content?.[0]?.text ?? '{}') as {
        events: Array<{ eventType: string; payload: Record<string, unknown> }>;
        page: {
          snapshotId: string;
          snapshotUpperSequence: number;
          hasMore: boolean;
        };
        summary: { matchedEventCount: number };
      };
      expect(second.page.hasMore).toBe(false);
      expect(second.page).toMatchObject({
        snapshotId: first.page.snapshotId,
        snapshotUpperSequence: first.page.snapshotUpperSequence,
      });
      expect(second.summary.matchedEventCount).toBe(7);
      expect(JSON.stringify(second)).not.toContain(lateGoal);
      expect(second.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'guide.proposal.decided',
            payload: expect.objectContaining({ decision: 'accepted', instanceId }),
          }),
          expect.objectContaining({
            eventType: 'companion.state.reported',
            payload: expect.objectContaining({
              transition: 'step_rolled_back',
              observations: [expect.objectContaining({ satisfied: false })],
            }),
          }),
        ]),
      );

      const missingSnapshot = await callMcpTool(runtime, 531, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        afterSequence: first.page.nextAfterSequence,
      });
      expect(missingSnapshot.result?.isError).toBe(true);

      const mismatchedSnapshot = await callMcpTool(runtime, 532, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        afterSequence: first.page.nextAfterSequence,
        snapshotId: randomUUID(),
        snapshotUpperSequence: first.page.snapshotUpperSequence,
      });
      expect(mismatchedSnapshot.result?.isError).toBe(true);

      const outOfBoundsCursor = await callMcpTool(runtime, 533, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
        instanceId,
        afterSequence: first.page.snapshotUpperSequence + 1,
        snapshotId: first.page.snapshotId,
        snapshotUpperSequence: first.page.snapshotUpperSequence,
      });
      expect(outOfBoundsCursor.result?.isError).toBe(true);

      const httpUrl = new URL('/api/v1/eval/export', runtime.baseUrl);
      httpUrl.searchParams.set('targetAdapterId', 'blender');
      httpUrl.searchParams.set('planId', plan.id);
      httpUrl.searchParams.set('instanceId', instanceId);
      const httpResponse = await fetch(httpUrl, { headers });
      expect(httpResponse.status).toBe(200);
      await expect(httpResponse.json()).resolves.toMatchObject({
        scope: { instanceId },
        summary: { matchedEventCount: 8 },
      });

      const malformed = await fetch(
        `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=blender`,
        { headers },
      );
      expect(malformed.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });

  it('persists host node references and turns one request into a newer review proposal', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const basePlan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as Record<string, unknown>;
      const requestId = randomUUID();
      const instanceId = randomUUID();
      const revisionRequest = {
        protocolVersion: '1.1.0',
        requestId,
        adapterId: 'blender',
        catalogVersion,
        instanceId,
        basePlan,
        references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
        message: 'Make the head larger while preserving the three-part silhouette.',
        revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
        occurredAt: new Date().toISOString(),
      };

      const accepted = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(revisionRequest),
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toEqual({ result: 'accepted', requestId });

      const duplicate = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(revisionRequest),
      });
      await expect(duplicate.json()).resolves.toEqual({ result: 'duplicate', requestId });

      const conflict = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...revisionRequest, message: 'Conflicting reuse' }),
      });
      expect(conflict.status).toBe(409);

      const invalidRequestId = randomUUID();
      const invalidReference = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...revisionRequest,
          requestId: invalidRequestId,
          revisionThread: {
            threadId: invalidRequestId,
            turn: 1,
            parentRequestId: null,
          },
          references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.9.9' }],
        }),
      });
      expect(invalidReference.status).toBe(422);
      await expect(invalidReference.json()).resolves.toMatchObject({
        message: expect.stringContaining('expected 1.2.3'),
      });

      const pending = await callMcpTool(runtime, 17, 'operatingline.replan.requests.list', {
        targetAdapterId: 'blender',
      });
      expect(JSON.parse(pending.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        requests: [
          {
            requestId,
            catalogVersion,
            basePlan: { id: 'snowman-demo', revision: 5 },
            references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
          },
        ],
      });

      const replanned = {
        ...basePlan,
        revision: 6,
        title: 'Create a snowman with a larger head',
      };
      const malformedSubmission = {
        requestId,
        privateSecret: 'MALFORMED_REPLAN_INPUT_SECRET',
      };
      const malformedHttp = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(malformedSubmission),
      });
      expect(malformedHttp.status).toBe(400);
      const malformedHttpError = await malformedHttp.json();
      const malformedMcp = await callMcpTool(
        runtime,
        179,
        'operatingline.replan.propose',
        malformedSubmission,
      );
      expect(malformedMcp.result).toMatchObject({ isError: true });
      const malformedMcpError = JSON.parse(
        malformedMcp.result?.content?.[0]?.text ?? '{}',
      ) as unknown;
      expect(malformedMcpError).toEqual(malformedHttpError);
      expect(malformedMcpError).toEqual({
        error: 'planner_invalid_request',
        requestId: null,
        message: 'Replan proposal submission violates the strict protocol contract',
        retryMode: 'never',
      });
      expect(JSON.stringify(malformedMcpError)).not.toContain('MALFORMED_REPLAN_INPUT_SECRET');
      const invalidSubmission = {
        requestId,
        catalogVersion: '0.9.0',
        plan: replanned,
      };
      const wrongCatalogHttp = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invalidSubmission),
      });
      expect(wrongCatalogHttp.status).toBe(422);
      const wrongCatalogHttpError = await wrongCatalogHttp.json();
      const wrongCatalog = await callMcpTool(
        runtime,
        18,
        'operatingline.replan.propose',
        invalidSubmission,
      );
      expect(wrongCatalog.result).toMatchObject({ isError: true });
      const wrongCatalogMcpError = JSON.parse(
        wrongCatalog.result?.content?.[0]?.text ?? '{}',
      ) as unknown;
      expect(wrongCatalogMcpError).toEqual(wrongCatalogHttpError);
      expect(wrongCatalogMcpError).toMatchObject({
        error: 'planner_replan_submission_invalid',
        requestId: null,
        message: expect.stringContaining(`must match revision request catalog ${catalogVersion}`),
        retryMode: 'never',
      });
      const proposed = await callMcpTool(runtime, 19, 'operatingline.replan.propose', {
        requestId,
        catalogVersion,
        planning: {
          goal: revisionRequest.message,
          requiredPhaseIds: ['geometry'],
          capabilityCoverage: snowmanHeadCapabilityCoverage,
        },
        plan: replanned,
      });
      expect(JSON.parse(proposed.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        proposed: true,
        planId: 'snowman-demo',
        revision: 6,
        catalogVersion,
        revisionRequestId: requestId,
        revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
        planDiff: {
          basePlan: { id: 'snowman-demo', revision: 5 },
          targetPlan: { id: 'snowman-demo', revision: 6 },
          summary: { planFields: 1 },
        },
      });

      const awaitingDecision = await callMcpTool(runtime, 191, 'operatingline.replan.thread.get', {
        threadId: requestId,
        targetAdapterId: 'blender',
        instanceId,
      });
      expect(JSON.parse(awaitingDecision.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        threadId: requestId,
        latestTurn: 1,
        status: 'awaiting_decision',
        turns: [
          {
            turn: 1,
            state: 'awaiting_decision',
            request: { requestId, message: revisionRequest.message },
            proposal: { revisionRequestId: requestId, planDiff: { summary: { planFields: 1 } } },
            decision: null,
          },
        ],
        page: { beforeTurn: null, nextBeforeTurn: null, hasMore: false },
      });

      const noPending = await callMcpTool(runtime, 20, 'operatingline.replan.requests.list', {
        targetAdapterId: 'blender',
      });
      expect(JSON.parse(noPending.result?.content?.[0]?.text ?? '{}')).toEqual({ requests: [] });

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({
        plan: null,
        proposal: {
          revisionRequestId: requestId,
          targetInstanceId: instanceId,
          catalogVersion,
          plan: { id: 'snowman-demo', revision: 6 },
        },
      });
      guideUrl.searchParams.set('instanceId', randomUUID());
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({ plan: null, proposal: null });
      await expect(
        fetch(`${runtime.baseUrl}/api/v1/guide`, { headers }).then((response) => response.json()),
      ).resolves.toEqual({ plan: null });

      const prematureContinuationId = randomUUID();
      const prematureContinuation = await fetch(
        `${runtime.baseUrl}/api/v1/companion/revision-request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...revisionRequest,
            requestId: prematureContinuationId,
            basePlan: replanned,
            revisionThread: {
              threadId: requestId,
              turn: 2,
              parentRequestId: requestId,
            },
          }),
        },
      );
      expect(prematureContinuation.status).toBe(422);
      await expect(prematureContinuation.json()).resolves.toMatchObject({
        message: expect.stringContaining('must be accepted in the same host instance'),
      });

      const acceptedDecision = {
        protocolVersion: '1.1.0',
        decisionId: randomUUID(),
        proposalId: JSON.parse(proposed.result?.content?.[0]?.text ?? '{}').proposalId,
        adapterId: 'blender',
        instanceId,
        decision: 'accepted',
        occurredAt: new Date().toISOString(),
      };
      const decisionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(acceptedDecision),
        },
      );
      expect(decisionResponse.status).toBe(200);
      await expect(decisionResponse.json()).resolves.toEqual({ result: 'accepted' });

      const historyUrl = new URL('/api/v1/replan/thread', runtime.baseUrl);
      historyUrl.searchParams.set('threadId', requestId);
      historyUrl.searchParams.set('targetAdapterId', 'blender');
      historyUrl.searchParams.set('instanceId', instanceId);
      await expect(
        fetch(historyUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({
        status: 'accepted',
        turns: [{ turn: 1, state: 'accepted', decision: { decision: 'accepted' } }],
      });

      const secondProposal = await callMcpTool(runtime, 21, 'operatingline.replan.propose', {
        requestId,
        catalogVersion,
        plan: { ...replanned, revision: 7 },
      });
      expect(secondProposal.result).toMatchObject({ isError: true });
      expect(secondProposal.result?.content?.[0]?.text).toContain('already has a proposal');

      const continuedRequestId = randomUUID();
      const continuedRequest = {
        ...revisionRequest,
        requestId: continuedRequestId,
        basePlan: replanned,
        message: 'Keep the larger head and make the plan title more explicit.',
        revisionThread: {
          threadId: requestId,
          turn: 2,
          parentRequestId: requestId,
        },
        occurredAt: new Date(Date.now() + 1_000).toISOString(),
      };
      const continued = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(continuedRequest),
      });
      expect(continued.status).toBe(200);
      await expect(continued.json()).resolves.toEqual({
        result: 'accepted',
        requestId: continuedRequestId,
      });

      const branchedRequestId = randomUUID();
      const branched = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...continuedRequest,
          requestId: branchedRequestId,
          revisionThread: {
            threadId: requestId,
            turn: 2,
            parentRequestId: requestId,
          },
        }),
      });
      expect(branched.status).toBe(422);
      await expect(branched.json()).resolves.toMatchObject({
        message: expect.stringContaining('must continue thread head'),
      });

      const continuedPlan = {
        ...replanned,
        revision: 7,
        title: 'Create a reviewed snowman with a larger head',
      };
      const continuedProposal = await callMcpTool(runtime, 22, 'operatingline.replan.propose', {
        requestId: continuedRequestId,
        catalogVersion,
        planning: {
          goal: continuedRequest.message,
          requiredPhaseIds: ['geometry'],
          capabilityCoverage: snowmanHeadCapabilityCoverage,
        },
        plan: continuedPlan,
      });
      expect(JSON.parse(continuedProposal.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        proposed: true,
        revision: 7,
        revisionRequestId: continuedRequestId,
        revisionThread: {
          threadId: requestId,
          turn: 2,
          parentRequestId: requestId,
        },
        planDiff: {
          basePlan: { id: 'snowman-demo', revision: 6 },
          targetPlan: { id: 'snowman-demo', revision: 7 },
          summary: { planFields: 1 },
        },
      });

      const latestHistory = await callMcpTool(runtime, 221, 'operatingline.replan.thread.get', {
        threadId: requestId,
        targetAdapterId: 'blender',
        instanceId,
        limit: 1,
      });
      expect(JSON.parse(latestHistory.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        latestTurn: 2,
        status: 'awaiting_decision',
        turns: [{ turn: 2, request: { requestId: continuedRequestId } }],
        page: { nextBeforeTurn: 2, hasMore: true },
      });
      const previousHistory = await callMcpTool(runtime, 222, 'operatingline.replan.thread.get', {
        threadId: requestId,
        targetAdapterId: 'blender',
        instanceId,
        beforeTurn: 2,
        limit: 1,
      });
      expect(JSON.parse(previousHistory.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        latestTurn: 2,
        status: 'awaiting_decision',
        turns: [{ turn: 1, state: 'accepted', request: { requestId } }],
        page: { beforeTurn: 2, nextBeforeTurn: null, hasMore: false },
      });

      guideUrl.searchParams.set('instanceId', instanceId);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({
        proposal: {
          revisionRequestId: continuedRequestId,
          plan: { id: 'snowman-demo', revision: 7 },
        },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('delivers only new guide plans containing actions for the requesting adapter', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    const instanceId = randomUUID();
    try {
      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as { id: string; revision: number };
      expect(
        (await callMcpTool(runtime, 20, 'operatingline.guide.publish', plan)).result?.isError,
      ).not.toBe(true);
      const publishedEval = await callMcpTool(runtime, 201, 'operatingline.eval.export', {
        targetAdapterId: 'blender',
        planId: plan.id,
      });
      expect(JSON.parse(publishedEval.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        summary: {
          matchedEventCount: 1,
          eventTypeCounts: { 'guide.plan.published': 1 },
        },
        events: [
          {
            eventType: 'guide.plan.published',
            payload: { targetAdapterId: 'blender', plan },
          },
        ],
      });

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      const delivered = await fetch(guideUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(delivered.status).toBe(200);
      await expect(delivered.json()).resolves.toMatchObject({
        protocolVersion: '1.1.0',
        plan: { id: plan.id, revision: plan.revision },
        planContentSha256: computePlanContentSha256(plan),
        proposalPlanContentSha256: null,
      });

      guideUrl.searchParams.set('knownPlanId', plan.id);
      guideUrl.searchParams.set('knownRevision', String(plan.revision));
      guideUrl.searchParams.set('knownPlanContentSha256', computePlanContentSha256(plan));
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });

      guideUrl.searchParams.set('knownPlanContentSha256', '0'.repeat(64));
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toMatchObject({
        plan: { id: plan.id, revision: plan.revision },
        planContentSha256: computePlanContentSha256(plan),
      });
      guideUrl.searchParams.set('knownPlanContentSha256', computePlanContentSha256(plan));

      guideUrl.searchParams.set('knownRevision', String(plan.revision + 2));
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });
      guideUrl.searchParams.set('knownRevision', String(plan.revision));

      const nextRevision = { ...plan, revision: plan.revision + 1 };
      expect(
        (await callMcpTool(runtime, 21, 'operatingline.guide.publish', nextRevision)).result
          ?.isError,
      ).not.toBe(true);
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toMatchObject({
        plan: { id: plan.id, revision: nextRevision.revision },
        planContentSha256: computePlanContentSha256(nextRevision),
      });

      guideUrl.searchParams.set('adapterId', 'different-adapter');
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('delivers AI proposals for explicit in-host decisions without publishing them', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    const instanceId = randomUUID();
    const otherInstanceId = randomUUID();
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as { id: string; revision: number };
      const proposed = await callMcpTool(runtime, 30, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        planning: {
          goal: 'Create and render the complete snowman.',
          requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
          capabilityCoverage: snowmanCapabilityCoverage,
        },
        plan,
      });
      expect(proposed.result?.isError).not.toBe(true);
      const proposalResult = JSON.parse(proposed.result?.content?.[0]?.text ?? '{}') as {
        proposalId?: string;
      };
      expect(proposalResult.proposalId).toEqual(expect.any(String));

      await expect(
        fetch(`${runtime.baseUrl}/api/v1/guide`, { headers }).then((response) => response.json()),
      ).resolves.toEqual({ plan: null });

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      const delivery = await fetch(guideUrl, { headers });
      expect(delivery.status).toBe(200);
      await expect(delivery.json()).resolves.toMatchObject({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposalPlanContentSha256: computePlanContentSha256(plan),
        proposal: {
          proposalId: proposalResult.proposalId,
          targetAdapterId: 'blender',
          plan: { id: plan.id, revision: plan.revision },
        },
      });

      guideUrl.searchParams.set('knownProposalId', proposalResult.proposalId!);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });

      const decision = {
        protocolVersion: '1.1.0',
        decisionId: randomUUID(),
        proposalId: proposalResult.proposalId,
        adapterId: 'blender',
        instanceId,
        decision: 'accepted',
        occurredAt: new Date().toISOString(),
      };
      const accepted = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers,
        body: JSON.stringify(decision),
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toEqual({ result: 'accepted' });

      const duplicate = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers,
        body: JSON.stringify(decision),
      });
      await expect(duplicate.json()).resolves.toEqual({ result: 'duplicate' });

      guideUrl.searchParams.delete('knownProposalId');
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toEqual({
        protocolVersion: '1.1.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      });

      guideUrl.searchParams.set('instanceId', otherInstanceId);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({ proposal: { proposalId: proposalResult.proposalId } });

      const wrongTarget = await callMcpTool(runtime, 31, 'operatingline.guide.propose', {
        targetAdapterId: 'maya',
        plan: { ...plan, id: 'wrong-target-plan' },
      });
      expect(wrongTarget.result).toMatchObject({ isError: true });
      expect(wrongTarget.result?.content?.[0]?.text).toContain('not proposal target maya');
    } finally {
      await runtime.stop();
    }
  });

  it('restores proposed revisions and pending delivery after runtime restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-runtime-proposal-test-'));
    const databasePath = join(directory, 'state.db');
    const plan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as { id: string; revision: number };
    let runtime: RunningRuntime | undefined;
    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const proposed = await callMcpTool(runtime, 40, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        planning: {
          goal: 'Create and render the complete snowman.',
          requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
          capabilityCoverage: snowmanCapabilityCoverage,
        },
        plan,
      });
      expect(proposed.result?.isError).not.toBe(true);
      await runtime.stop();

      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', randomUUID());
      await expect(
        fetch(guideUrl, {
          headers: { authorization: `Bearer ${accessToken}` },
        }).then((response) => response.json()),
      ).resolves.toMatchObject({ proposal: { plan: { id: plan.id, revision: plan.revision } } });

      const stale = await callMcpTool(runtime, 41, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
        planning: {
          goal: 'Create and render the complete snowman.',
          requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
          capabilityCoverage: snowmanCapabilityCoverage,
        },
        plan,
      });
      expect(stale.result).toMatchObject({ isError: true });
      expect(stale.result?.content?.[0]?.text).toContain('latest proposed revision');
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed companion guide queries', async () => {
    const runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    try {
      const badUuid = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=fake-blender&instanceId=bad`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(badUuid.status).toBe(400);

      const missingRevision = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=fake-blender&instanceId=${randomUUID()}&knownPlanId=snowman`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(missingRevision.status).toBe(400);

      const unknownField = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=fake-blender&instanceId=${randomUUID()}&extra=true`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(unknownField.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });

  it('accepts, deduplicates, rejects stale state, and lists latest companions over HTTP and MCP', async () => {
    const runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    const instanceId = randomUUID();
    const first = companionReport(instanceId, 1);
    const stale = companionReport(instanceId, 1);
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    try {
      const post = (report: unknown) =>
        fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify(report),
        });
      await expect(post(first).then((response) => response.json())).resolves.toEqual({
        result: 'accepted',
      });
      await expect(post(first).then((response) => response.json())).resolves.toEqual({
        result: 'duplicate',
      });
      const conflict = await post({ ...first, hostVersion: '4.6.0' });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toEqual({ result: 'conflict' });
      await expect(post(stale).then((response) => response.json())).resolves.toEqual({
        result: 'stale',
      });

      const listResponse = await fetch(`${runtime.baseUrl}/api/v1/companions`, { headers });
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual({ companions: [first] });

      const mcpResponse = await callMcpTool(runtime, 30, 'operatingline.companions.list', {});
      expect(mcpResponse.result?.isError).not.toBe(true);
      expect(JSON.parse(mcpResponse.result?.content?.[0]?.text ?? 'null')).toEqual([first]);

      const invalid = await post({ ...first, reportId: randomUUID(), unknown: true });
      expect(invalid.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });

  it('restores latest companion state after a runtime restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-companion-runtime-test-'));
    const databasePath = join(directory, 'state.db');
    const report = companionReport(randomUUID(), 1);
    try {
      const firstRuntime = await startRuntime({ databasePath, accessToken });
      const accepted = await fetch(`${firstRuntime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(report),
      });
      expect(accepted.status).toBe(200);
      await firstRuntime.stop();

      const restarted = await startRuntime({ databasePath, accessToken });
      try {
        const response = await fetch(`${restarted.baseUrl}/api/v1/companions`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        await expect(response.json()).resolves.toEqual({ companions: [report] });
      } finally {
        await restarted.stop();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores the latest published Plan and its revision watermark after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-plan-runtime-test-'));
    const databasePath = join(directory, 'state.db');
    const plan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as { id: string; revision: number };
    const headers = { authorization: `Bearer ${accessToken}` };
    try {
      const firstRuntime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const published = await callMcpTool(firstRuntime, 60, 'operatingline.guide.publish', plan);
      expect(published.result?.isError).not.toBe(true);
      await firstRuntime.stop();

      const restarted = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      try {
        await expect(
          fetch(`${restarted.baseUrl}/api/v1/guide`, { headers }).then((response) =>
            response.json(),
          ),
        ).resolves.toMatchObject({ plan: { id: plan.id, revision: plan.revision } });
        const contextUrl = new URL('/api/v1/planning/context', restarted.baseUrl);
        contextUrl.searchParams.set('targetAdapterId', 'blender');
        contextUrl.searchParams.set('planId', plan.id);
        await expect(
          fetch(contextUrl, { headers }).then((response) => response.json()),
        ).resolves.toMatchObject({
          requestedPlanId: plan.id,
          recommendedRevision: plan.revision + 1,
        });
      } finally {
        await restarted.stop();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects unauthenticated MCP requests', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      adapters: [new FakeBlenderAdapter()],
    });

    try {
      const response = await fetch(runtime.mcpEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(401);

      const guideResponse = await fetch(`${runtime.baseUrl}/api/v1/guide`);
      expect(guideResponse.status).toBe(401);

      const companionGuideResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=fake-blender&instanceId=${randomUUID()}`,
      );
      expect(companionGuideResponse.status).toBe(401);
      expect((await fetch(`${runtime.baseUrl}/api/v1/companions`)).status).toBe(401);
      expect(
        (
          await fetch(
            `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=blender&planId=snowman`,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(companionReport(randomUUID(), 1)),
          })
        ).status,
      ).toBe(401);
    } finally {
      await runtime.stop();
    }
  });

  it('preserves the active plan when semantic validation or revision checks fail', async () => {
    const runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    try {
      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
      ) as {
        id: string;
        revision: number;
        steps: Array<Record<string, unknown>>;
      };
      const accepted = await callMcpTool(runtime, 10, 'operatingline.guide.publish', plan);
      expect(accepted.result?.isError).not.toBe(true);

      const invalidGraph = structuredClone(plan);
      invalidGraph.revision = plan.revision + 1;
      const action = invalidGraph.steps.find((step) => step.action !== null)?.action;
      const modelBranch = invalidGraph.steps.find((step) => step.id === 'snowman.model');
      if (modelBranch === undefined || action === undefined) {
        throw new Error('Snowman fixture is missing its model branch or executable action');
      }
      modelBranch.action = action;

      const rejectedGraph = await callMcpTool(
        runtime,
        11,
        'operatingline.guide.publish',
        invalidGraph,
      );
      expect(rejectedGraph.result).toMatchObject({ isError: true });
      expect(rejectedGraph.result?.content?.[0]?.text).toContain('must be a hierarchy leaf');

      const rejectedRevision = await callMcpTool(runtime, 12, 'operatingline.guide.publish', plan);
      expect(rejectedRevision.result).toMatchObject({ isError: true });
      expect(rejectedRevision.result?.content?.[0]?.text).toContain(
        `is not newer than latest accepted revision ${plan.revision}`,
      );

      const mixedHostPlan = structuredClone(plan);
      mixedHostPlan.id = 'snowman-mixed-host';
      const mixedHostAction = mixedHostPlan.steps.find((step) => step.action !== null)?.action;
      if (mixedHostAction === null || typeof mixedHostAction !== 'object') {
        throw new Error('Snowman fixture is missing an executable action');
      }
      (mixedHostAction as Record<string, unknown>).adapterId = 'different-adapter';
      const rejectedMixedHost = await callMcpTool(
        runtime,
        13,
        'operatingline.guide.publish',
        mixedHostPlan,
      );
      expect(rejectedMixedHost.result).toMatchObject({ isError: true });
      expect(rejectedMixedHost.result?.content?.[0]?.text).toContain(
        'must target a single action adapter',
      );

      const guideResponse = await fetch(`${runtime.baseUrl}/api/v1/guide`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      await expect(guideResponse.json()).resolves.toMatchObject({
        plan: { id: plan.id, revision: plan.revision },
      });

      const replacementPlan = structuredClone(plan);
      replacementPlan.id = 'snowman-demo-replacement';
      const acceptedReplacement = await callMcpTool(
        runtime,
        14,
        'operatingline.guide.publish',
        replacementPlan,
      );
      expect(acceptedReplacement.result?.isError).not.toBe(true);

      const rejectedAfterSwitch = await callMcpTool(
        runtime,
        15,
        'operatingline.guide.publish',
        plan,
      );
      expect(rejectedAfterSwitch.result).toMatchObject({ isError: true });
      expect(rejectedAfterSwitch.result?.content?.[0]?.text).toContain(
        `is not newer than latest accepted revision ${plan.revision}`,
      );
    } finally {
      await runtime.stop();
    }
  });

  it('rejects unsafe runtime configuration before listening', async () => {
    await expect(
      startRuntime({ databasePath: ':memory:', accessToken: 'too-short' }),
    ).rejects.toThrow('at least 16 characters');
    await expect(startRuntime({ databasePath: '', accessToken })).rejects.toThrow(
      'database path must not be empty',
    );
    await expect(
      startRuntime({ databasePath: ':memory:', accessToken, port: Number.NaN }),
    ).rejects.toThrow('port must be an integer');
  });

  it('closes acquired resources when startup event persistence fails', async () => {
    const { directory, databasePath } = failingEventDatabase('runtime.started');
    const port = await availablePort();
    try {
      await expect(startRuntime({ databasePath, accessToken, port })).rejects.toThrow(
        'injected runtime.started failure',
      );
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('closes the listener even when the stopped event cannot be persisted', async () => {
    const { directory, databasePath } = failingEventDatabase('runtime.stopped');
    const runtime = await startRuntime({ databasePath, accessToken });
    try {
      await expect(runtime.stop()).rejects.toThrow('injected runtime.stopped failure');
      await expect(fetch(`${runtime.baseUrl}/health`)).rejects.toThrow();
      await expect(runtime.stop()).rejects.toThrow('injected runtime.stopped failure');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
