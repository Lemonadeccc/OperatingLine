import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import {
  FakePlannerProvider,
  buildSyntheticCanvasDraft,
  syntheticCanvasActionCatalog,
  syntheticCanvasActionCatalogs,
  syntheticCanvasHistoricalActionCatalog,
} from '@operatingline/test-kit';
import {
  plannerProviderContractVersion,
  type ActionCatalog,
  type PlannerGenerationResult,
  type PlanningContext,
  type PlanningPromptPacket,
  type PlanningQualityReport,
} from '@operatingline/protocol';

const accessToken = 'generic-planning-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
  };
}

async function callMcpTool(
  runtime: RunningRuntime,
  id: number,
  name: string,
  argumentsValue: unknown,
): Promise<McpToolResponse> {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  expect(response.status).toBe(200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice('data: '.length)) as McpToolResponse;
}

async function postJson<T>(runtime: RunningRuntime, path: string, body: unknown) {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as T };
}

function generationRequest(goal: string, planId: string, catalogVersion?: string) {
  return {
    requestId: randomUUID(),
    providerId: 'generic-canvas-planner',
    targetAdapterId: 'canvas',
    ...(catalogVersion === undefined ? {} : { catalogVersion }),
    goal,
    planId,
  };
}

function canvasProvider(maxConcurrency = 1) {
  return new FakePlannerProvider(({ packet }) => buildSyntheticCanvasDraft(packet), {
    contractVersion: plannerProviderContractVersion,
    id: 'generic-canvas-planner',
    version: '1.0.0',
    displayName: 'Generic Canvas Planner',
    description: 'Deterministic provider for host-neutral planning runtime tests.',
    availability: { available: true },
    limits: { maxConcurrency },
    dataHandling: {
      executionLocation: 'local',
      dataTransmission: 'none',
      credentialManagement: 'provider_managed',
    },
  });
}

describe('generic planning runtime', () => {
  it('carries a non-Blender catalog through context, prompt, generation, quality, and proposal', async () => {
    const provider = canvasProvider();
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: syntheticCanvasActionCatalogs,
      plannerProviders: [provider],
    });
    const goal = 'Create a launch diagram and deliver it as SVG.';
    const planId = 'launch-diagram';

    try {
      const catalogResponse = await fetch(
        `${runtime.baseUrl}/api/v1/action-catalog?targetAdapterId=canvas`,
        { headers },
      );
      expect(catalogResponse.status).toBe(200);
      const catalog = (await catalogResponse.json()) as ActionCatalog;
      expect(catalog).toMatchObject({
        adapterId: 'canvas',
        catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      });
      expect(catalog.planningPhases.map((phase: { id: string }) => phase.id)).toEqual([
        'compose',
        'deliver',
      ]);

      const contextResponse = await fetch(
        `${runtime.baseUrl}/api/v1/planning/context?targetAdapterId=canvas&goal=${encodeURIComponent(goal)}&planId=${planId}`,
        { headers },
      );
      expect(contextResponse.status).toBe(200);
      const context = (await contextResponse.json()) as PlanningContext;
      expect(context).toMatchObject({
        targetAdapterId: 'canvas',
        goal,
        requestedPlanId: planId,
        catalog: { catalogVersion: syntheticCanvasActionCatalog.catalogVersion },
        qualityGate: { baselineVersion: '1.1.0' },
      });

      const promptResult = await postJson<PlanningPromptPacket>(
        runtime,
        '/api/v1/planning/prompt',
        {
          targetAdapterId: 'canvas',
          goal,
          planId,
        },
      );
      expect(promptResult.response.status).toBe(200);
      expect(promptResult.body).toMatchObject({
        formatVersion: '1.1.0',
        context: { goal, requestedPlanId: planId },
      });
      expect(promptResult.body.renderedPrompt).toContain('document.compose');
      expect(JSON.stringify(promptResult.body).toLowerCase()).not.toContain('blender');
      expect(JSON.stringify(promptResult.body).toLowerCase()).not.toContain('snowman');

      const generatedResult = await postJson<PlannerGenerationResult>(
        runtime,
        '/api/v1/planner/generate',
        generationRequest(goal, planId),
      );
      expect(generatedResult.response.status).toBe(200);
      expect(generatedResult.body).toMatchObject({
        status: 'ready',
        proposalCreated: false,
        packetFormatVersion: '1.1.0',
        draft: {
          targetAdapterId: 'canvas',
          catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
          planning: { goal, requiredPhaseIds: ['compose', 'deliver'] },
          plan: { id: planId, revision: 1 },
        },
        planningQuality: {
          valid: true,
          baselineVersion: '1.1.0',
          summary: { errorCount: 0, usedPhaseCount: 2 },
        },
      });

      const draft = generatedResult.body.draft;
      const qualityInput = {
        targetAdapterId: draft.targetAdapterId,
        catalogVersion: draft.catalogVersion,
        goal: draft.planning.goal,
        requiredPhaseIds: draft.planning.requiredPhaseIds,
        capabilityCoverage: draft.planning.capabilityCoverage,
        plan: draft.plan,
      };
      const [firstQuality, secondQuality] = await Promise.all([
        postJson<PlanningQualityReport>(runtime, '/api/v1/planning/evaluate', qualityInput),
        postJson<PlanningQualityReport>(runtime, '/api/v1/planning/evaluate', qualityInput),
      ]);
      expect(firstQuality.response.status).toBe(200);
      expect(secondQuality.response.status).toBe(200);
      expect(firstQuality.body).toEqual(secondQuality.body);
      expect(firstQuality.body).not.toHaveProperty('score');

      const proposalResponse = await callMcpTool(runtime, 1, 'operatingline.guide.propose', draft);
      expect(proposalResponse.result?.isError).not.toBe(true);
      expect(JSON.parse(proposalResponse.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        proposed: true,
        targetAdapterId: 'canvas',
        catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
        planId,
        revision: 1,
        planningQuality: { valid: true },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('reports invalid capability-to-step coverage without inventing semantic scoring', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
    });

    try {
      const promptResult = await postJson<PlanningPromptPacket>(
        runtime,
        '/api/v1/planning/prompt',
        {
          targetAdapterId: 'canvas',
          goal: 'Create a canvas document and export SVG.',
          planId: 'invalid-coverage',
        },
      );
      const draft = buildSyntheticCanvasDraft(promptResult.body);
      draft.planning.capabilityCoverage!.requirements[0]!.coverage[0] = {
        capabilityId: 'artifact.svg',
        stepIds: ['invalid-coverage.create'],
      };

      const quality = await postJson<PlanningQualityReport>(runtime, '/api/v1/planning/evaluate', {
        targetAdapterId: draft.targetAdapterId,
        catalogVersion: draft.catalogVersion,
        goal: draft.planning.goal,
        requiredPhaseIds: draft.planning.requiredPhaseIds,
        capabilityCoverage: draft.planning.capabilityCoverage,
        plan: draft.plan,
      });
      expect(quality.response.status).toBe(200);
      expect(quality.body).toMatchObject({ valid: false, summary: { errorCount: 1 } });
      expect(quality.body.findings).toContainEqual(
        expect.objectContaining({
          code: 'coverage.action_mismatch',
          stepIds: ['invalid-coverage.create'],
        }),
      );
      expect(quality.body).not.toHaveProperty('score');
    } finally {
      await runtime.stop();
    }
  });

  it('keeps the historical phased catalog compatible without semantic coverage', async () => {
    const provider = canvasProvider();
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: syntheticCanvasActionCatalogs,
      plannerProviders: [provider],
    });
    const goal = 'Create a legacy canvas document and export it.';
    const planId = 'legacy-canvas';

    try {
      const generated = await postJson<PlannerGenerationResult>(
        runtime,
        '/api/v1/planner/generate',
        generationRequest(goal, planId, syntheticCanvasHistoricalActionCatalog.catalogVersion),
      );
      expect(generated.response.status).toBe(200);
      expect(generated.body).toMatchObject({
        packetFormatVersion: '1.0.0',
        status: 'ready',
        draft: {
          catalogVersion: syntheticCanvasHistoricalActionCatalog.catalogVersion,
          planning: { goal, requiredPhaseIds: ['compose', 'deliver'] },
          plan: { id: planId },
        },
        planningQuality: { valid: true, baselineVersion: '1.0.0' },
      });
      expect(generated.body.draft.planning).not.toHaveProperty('capabilityCoverage');
      expect(generated.body.planningQuality).not.toHaveProperty('capabilityCoverage');

      const proposal = await callMcpTool(
        runtime,
        2,
        'operatingline.guide.propose',
        generated.body.draft,
      );
      expect(proposal.result?.isError).not.toBe(true);
      expect(JSON.parse(proposal.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        proposed: true,
        catalogVersion: syntheticCanvasHistoricalActionCatalog.catalogVersion,
        planningQuality: { valid: true, baselineVersion: '1.0.0' },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('isolates exact goal, catalog, and plan identity across repeated concurrent requests', async () => {
    const provider = canvasProvider(2);
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: syntheticCanvasActionCatalogs,
      plannerProviders: [provider],
    });

    try {
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const requests = [
          generationRequest(`Compose alpha diagram ${iteration}.`, `alpha-${iteration}`),
          generationRequest(`Compose beta diagram ${iteration}.`, `beta-${iteration}`),
        ];
        const results = await Promise.all(
          requests.map((request) =>
            postJson<PlannerGenerationResult>(runtime, '/api/v1/planner/generate', request),
          ),
        );

        for (const [index, result] of results.entries()) {
          const request = requests[index]!;
          expect(result.response.status).toBe(200);
          expect(result.body).toMatchObject({
            requestId: request.requestId,
            status: 'ready',
            draft: {
              catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
              planning: { goal: request.goal },
              plan: { id: request.planId, revision: 1 },
            },
            planningQuality: {
              goal: request.goal,
              plan: { id: request.planId, revision: 1 },
            },
          });
        }
      }

      expect(provider.inputs).toHaveLength(8);
      expect(
        provider.inputs
          .map(({ packet }) => ({
            goal: packet.context.goal,
            planId: packet.context.requestedPlanId,
            catalogVersion: packet.context.catalog.catalogVersion,
          }))
          .sort((left, right) => left.planId.localeCompare(right.planId)),
      ).toEqual(
        Array.from({ length: 4 }, (_, iteration) => [
          {
            goal: `Compose alpha diagram ${iteration}.`,
            planId: `alpha-${iteration}`,
            catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
          },
          {
            goal: `Compose beta diagram ${iteration}.`,
            planId: `beta-${iteration}`,
            catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
          },
        ])
          .flat()
          .sort((left, right) => left.planId.localeCompare(right.planId)),
      );
    } finally {
      await runtime.stop();
    }
  });
});
