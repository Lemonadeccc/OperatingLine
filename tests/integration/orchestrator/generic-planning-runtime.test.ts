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
  it('isolates goal planning evidence for Canvas instances sharing an adapter and plan id', async () => {
    const provider = canvasProvider();
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [provider],
    });
    const planId = 'shared-private-plan';
    const first = {
      protocolVersion: '1.1.0',
      requestId: randomUUID(),
      adapterId: 'canvas',
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      instanceId: randomUUID(),
      goal: 'Private goal for the first canvas.',
      planId,
      occurredAt: '2026-08-09T10:00:00Z',
    };
    const unrelatedInstanceId = randomUUID();
    const second = {
      ...first,
      requestId: randomUUID(),
      instanceId: randomUUID(),
      goal: 'Private goal for the second canvas.',
      occurredAt: '2026-08-09T10:00:01Z',
    };

    try {
      expect(
        (await postJson(runtime, '/api/v1/companion/goal-request', first)).response.status,
      ).toBe(200);
      expect(
        (await postJson(runtime, '/api/v1/companion/goal-request', second)).response.status,
      ).toBe(200);

      const firstPrompt = await callMcpTool(runtime, 90, 'operatingline.goal.prompt.get', {
        requestId: first.requestId,
      });
      const secondPrompt = await callMcpTool(runtime, 91, 'operatingline.goal.prompt.get', {
        requestId: second.requestId,
      });
      const firstPacket = JSON.parse(
        firstPrompt.result?.content?.[0]?.text ?? '{}',
      ) as PlanningPromptPacket & Record<string, unknown>;
      const secondPacket = JSON.parse(
        secondPrompt.result?.content?.[0]?.text ?? '{}',
      ) as PlanningPromptPacket & Record<string, unknown>;
      expect(firstPacket.context.goal).toBe(first.goal);
      expect(secondPacket.context.goal).toBe(second.goal);
      expect(firstPacket).not.toHaveProperty('goalRequestId');
      expect(firstPacket).not.toHaveProperty('targetInstanceId');

      const providerSecret = 'UNSCOPED_PROVIDER_GOAL_SECRET';
      const generated = await callMcpTool(
        runtime,
        89,
        'operatingline.planner.generate',
        generationRequest(providerSecret, planId),
      );
      expect(generated.result?.isError).not.toBe(true);
      expect(provider.inputs).toHaveLength(1);

      const firstDraft = buildSyntheticCanvasDraft(firstPacket);
      const proposed = await callMcpTool(runtime, 92, 'operatingline.guide.propose', {
        ...firstDraft,
        goalRequestId: first.requestId,
      });
      expect(proposed.result?.isError).not.toBe(true);
      const proposalId = (
        JSON.parse(proposed.result?.content?.[0]?.text ?? '{}') as { proposalId: string }
      ).proposalId;
      expect(
        (
          await postJson(runtime, '/api/v1/companion/proposal-decision', {
            protocolVersion: '1.1.0',
            decisionId: randomUUID(),
            proposalId,
            adapterId: 'canvas',
            instanceId: first.instanceId,
            decision: 'accepted',
            occurredAt: new Date().toISOString(),
          })
        ).response.status,
      ).toBe(200);

      const revisionRequestId = randomUUID();
      const revisionGoal = 'Privately refine only the document creation step.';
      expect(
        (
          await postJson(runtime, '/api/v1/companion/revision-request', {
            protocolVersion: '1.1.0',
            requestId: revisionRequestId,
            adapterId: 'canvas',
            catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
            instanceId: first.instanceId,
            basePlan: firstDraft.plan,
            references: [{ nodeId: `${planId}.create`, nodeNumber: '1.1.1' }],
            message: revisionGoal,
            revisionThread: {
              threadId: revisionRequestId,
              turn: 1,
              parentRequestId: null,
            },
            occurredAt: new Date().toISOString(),
          })
        ).response.status,
      ).toBe(200);
      const replanned = structuredClone(firstDraft.plan);
      replanned.revision = 2;
      replanned.steps.find((step) => step.id === `${planId}.create`)!.title =
        'Create the privately refined document';
      const replan = await postJson(runtime, '/api/v1/replan/propose', {
        requestId: revisionRequestId,
        catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
        planning: {
          goal: revisionGoal,
          requiredPhaseIds: ['compose'],
          capabilityCoverage: {
            policyVersion: 'catalog_capability_coverage_v1',
            requirements: [
              {
                requirementId: 'document-refinement',
                statement: revisionGoal,
                coverage: [{ capabilityId: 'document.compose', stepIds: [`${planId}.create`] }],
              },
            ],
          },
        },
        plan: replanned,
      });
      expect(replan.response.status).toBe(200);

      const standalone = await postJson<PlanningPromptPacket>(runtime, '/api/v1/planning/prompt', {
        targetAdapterId: 'canvas',
        catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
        goal: 'Unscoped standalone goal.',
        planId,
      });
      expect(standalone.response.status).toBe(200);
      expect(standalone.body).not.toHaveProperty('goalRequestId');
      expect(standalone.body).not.toHaveProperty('targetInstanceId');
      expect(
        (
          await postJson(runtime, '/api/v1/planning/evaluate', {
            targetAdapterId: 'canvas',
            catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
            ...firstDraft.planning,
            plan: firstDraft.plan,
          })
        ).response.status,
      ).toBe(200);

      const exportFor = async (instanceId: string) => {
        const response = await fetch(
          `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=canvas&planId=${planId}&instanceId=${instanceId}`,
          { headers },
        );
        expect(response.status).toBe(200);
        return (await response.json()) as {
          events: Array<{ eventType: string; payload: Record<string, unknown> }>;
        };
      };
      const firstExport = await exportFor(first.instanceId);
      const secondExport = await exportFor(second.instanceId);
      const unrelatedExport = await exportFor(unrelatedInstanceId);

      const firstPlanningEvents = firstExport.events.filter((candidate) =>
        [
          'planning.context.generated',
          'planning.prompt.generated',
          'planning.quality.evaluated',
        ].includes(candidate.eventType),
      );
      expect(firstPlanningEvents.map((event) => event.eventType)).toEqual([
        'planning.context.generated',
        'planning.prompt.generated',
        'planning.quality.evaluated',
        'planning.quality.evaluated',
      ]);
      expect(firstPlanningEvents.slice(0, 3)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              goalRequestId: first.requestId,
              targetInstanceId: first.instanceId,
            }),
          }),
        ]),
      );
      expect(firstPlanningEvents[3]?.payload).toMatchObject({
        revisionRequestId,
        targetInstanceId: first.instanceId,
      });
      expect(firstPlanningEvents[3]?.payload).not.toHaveProperty('goalRequestId');
      expect(JSON.stringify(firstExport.events)).toContain(first.goal);
      expect(JSON.stringify(firstExport.events)).toContain(revisionGoal);
      expect(JSON.stringify(firstExport.events)).not.toContain(second.goal);
      expect(JSON.stringify(firstExport.events)).not.toContain('Unscoped standalone goal.');
      expect(JSON.stringify(firstExport.events)).not.toContain(providerSecret);
      expect(JSON.stringify(secondExport.events)).toContain(second.goal);
      expect(JSON.stringify(secondExport.events)).not.toContain(first.goal);
      expect(JSON.stringify(secondExport.events)).not.toContain('Unscoped standalone goal.');
      expect(JSON.stringify(secondExport.events)).not.toContain(providerSecret);
      expect(
        unrelatedExport.events.filter((event) =>
          [
            'planning.context.generated',
            'planning.prompt.generated',
            'planning.quality.evaluated',
          ].includes(event.eventType),
        ),
      ).toEqual([]);
      expect(JSON.stringify(unrelatedExport.events)).not.toContain(first.goal);
      expect(JSON.stringify(unrelatedExport.events)).not.toContain(second.goal);
      expect(JSON.stringify(unrelatedExport.events)).not.toContain(revisionGoal);
      expect(JSON.stringify(unrelatedExport.events)).not.toContain('Unscoped standalone goal.');
      expect(JSON.stringify(unrelatedExport.events)).not.toContain(providerSecret);
    } finally {
      await runtime.stop();
    }
  });

  it('completes a stored Canvas goal request through MCP and targets only its host instance', async () => {
    const provider = canvasProvider();
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [provider],
    });
    const requestId = randomUUID();
    const instanceId = randomUUID();
    const otherInstanceId = randomUUID();
    const goal = 'Create a launch diagram and deliver it as SVG.';
    const planId = 'requested-launch-diagram';
    const request = {
      protocolVersion: '1.1.0',
      requestId,
      adapterId: 'canvas',
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      instanceId,
      goal,
      planId,
      occurredAt: '2026-08-09T10:00:00+08:00',
    };

    try {
      const accepted = await postJson<{ result: string; requestId: string }>(
        runtime,
        '/api/v1/companion/goal-request',
        request,
      );
      expect(accepted.response.status).toBe(200);
      expect(accepted.body).toEqual({ result: 'accepted', requestId });
      const duplicate = await postJson<{ result: string; requestId: string }>(
        runtime,
        '/api/v1/companion/goal-request',
        request,
      );
      expect(duplicate.body).toEqual({ result: 'duplicate', requestId });
      const racing = await postJson<{ result: string }>(runtime, '/api/v1/companion/goal-request', {
        ...request,
        requestId: randomUUID(),
        planId: 'racing-plan',
      });
      expect(racing.response.status).toBe(409);
      expect(racing.body).toMatchObject({ result: 'conflict' });

      const listed = await callMcpTool(runtime, 101, 'operatingline.goal.requests.list', {
        targetAdapterId: 'canvas',
      });
      expect(JSON.parse(listed.result?.content?.[0]?.text ?? '{}')).toEqual({
        requests: [request],
      });

      const prompt = await callMcpTool(runtime, 102, 'operatingline.goal.prompt.get', {
        requestId,
      });
      expect(prompt.result?.isError).not.toBe(true);
      const packet = JSON.parse(prompt.result?.content?.[0]?.text ?? '{}') as PlanningPromptPacket;
      expect(packet).toMatchObject({
        formatVersion: '1.1.0',
        context: {
          targetAdapterId: 'canvas',
          goal,
          requestedPlanId: planId,
          catalog: { catalogVersion: syntheticCanvasActionCatalog.catalogVersion },
        },
        workflow: { submitToolName: 'operatingline.guide.propose' },
      });
      const draft = buildSyntheticCanvasDraft(packet);
      const proposed = await callMcpTool(runtime, 103, 'operatingline.guide.propose', {
        ...draft,
        goalRequestId: requestId,
      });
      expect(proposed.result?.isError).not.toBe(true);
      const proposalResult = JSON.parse(proposed.result?.content?.[0]?.text ?? '{}') as {
        proposalId: string;
      };
      expect(proposalResult).toMatchObject({
        proposed: true,
        goalRequestId: requestId,
        targetAdapterId: 'canvas',
        targetInstanceId: instanceId,
        planId,
      });

      const targetDelivery = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=canvas&instanceId=${instanceId}`,
        { headers },
      );
      expect(targetDelivery.status).toBe(200);
      await expect(targetDelivery.json()).resolves.toMatchObject({
        proposal: {
          proposalId: proposalResult.proposalId,
          goalRequestId: requestId,
          targetInstanceId: instanceId,
        },
      });
      const otherDelivery = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=canvas&instanceId=${otherInstanceId}`,
        { headers },
      );
      await expect(otherDelivery.json()).resolves.toMatchObject({ proposal: null });

      const duplicateCompletion = await callMcpTool(runtime, 104, 'operatingline.guide.propose', {
        ...draft,
        goalRequestId: requestId,
      });
      expect(duplicateCompletion.result?.isError).toBe(true);
      expect(duplicateCompletion.result?.content?.[0]?.text).toContain('already has a proposal');
      const completedPrompt = await callMcpTool(runtime, 109, 'operatingline.goal.prompt.get', {
        requestId,
      });
      expect(completedPrompt.result?.isError).toBe(true);
      expect(completedPrompt.result?.content?.[0]?.text).toContain('already has a proposal');
      const afterCompletion = await callMcpTool(runtime, 105, 'operatingline.goal.requests.list', {
        targetAdapterId: 'canvas',
      });
      expect(JSON.parse(afterCompletion.result?.content?.[0]?.text ?? '{}')).toEqual({
        requests: [],
      });

      const evalResponse = await fetch(
        `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=canvas&planId=${planId}&instanceId=${instanceId}`,
        { headers },
      );
      expect(evalResponse.status).toBe(200);
      const evalBundle = (await evalResponse.json()) as {
        events: Array<{ eventType: string; payload: unknown }>;
      };
      expect(evalBundle.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'guide.goal.requested', payload: request }),
          expect.objectContaining({ eventType: 'guide.goal.proposed' }),
          expect.objectContaining({ eventType: 'guide.proposal.created' }),
        ]),
      );
      expect(provider.inputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });

  it('keeps invalid goal completions pending and creates no deliverable proposal', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
    });
    const requestId = randomUUID();
    const instanceId = randomUUID();
    const request = {
      protocolVersion: '1.1.0',
      requestId,
      adapterId: 'canvas',
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      instanceId,
      goal: 'Create a launch diagram.',
      planId: 'invalid-launch-diagram',
      occurredAt: '2026-08-09T10:00:00Z',
    };

    try {
      expect(
        (await postJson(runtime, '/api/v1/companion/goal-request', request)).response.status,
      ).toBe(200);
      const prompt = await callMcpTool(runtime, 106, 'operatingline.goal.prompt.get', {
        requestId,
      });
      const packet = JSON.parse(prompt.result?.content?.[0]?.text ?? '{}') as PlanningPromptPacket;
      const draft = buildSyntheticCanvasDraft(packet);
      for (const [submission, expectedMessage] of [
        [
          { ...draft, goalRequestId: requestId, targetAdapterId: 'blender' },
          'does not match requested',
        ],
        [
          { ...draft, goalRequestId: requestId, catalogVersion: '9.9.9' },
          'does not match requested',
        ],
        [
          { ...draft, goalRequestId: requestId, plan: { ...draft.plan, id: 'wrong-plan' } },
          'does not match requested',
        ],
        [
          {
            ...draft,
            goalRequestId: requestId,
            planning: { ...draft.planning, goal: 'A substituted goal.' },
          },
          'does not match the stored goal request',
        ],
      ] as const) {
        const mismatch = await callMcpTool(runtime, 110, 'operatingline.guide.propose', submission);
        expect(mismatch.result?.isError).toBe(true);
        expect(mismatch.result?.content?.[0]?.text).toContain(expectedMessage);
      }
      const executable = draft.plan.steps.find((step) => step.action !== null)!;
      executable.action = { ...executable.action!, name: 'unknown.vendor.action' };

      const rejected = await callMcpTool(runtime, 107, 'operatingline.guide.propose', {
        ...draft,
        goalRequestId: requestId,
      });
      expect(rejected.result?.isError).toBe(true);
      expect(rejected.result?.content?.[0]?.text).toContain('is absent from canvas@');
      const pending = await callMcpTool(runtime, 108, 'operatingline.goal.requests.list', {});
      expect(JSON.parse(pending.result?.content?.[0]?.text ?? '{}')).toEqual({
        requests: [request],
      });
      const delivery = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=canvas&instanceId=${instanceId}`,
        { headers },
      );
      await expect(delivery.json()).resolves.toMatchObject({ proposal: null });
    } finally {
      await runtime.stop();
    }
  });

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
