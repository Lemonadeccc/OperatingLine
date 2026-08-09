import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CompanionInitialPlanRun,
  CompanionInitialPlanRunCreateRequest,
  PlanningPromptPacket,
} from '@operatingline/protocol';
import {
  FakePlannerProvider,
  buildSyntheticCanvasDraft,
  syntheticCanvasActionCatalog,
} from '@operatingline/test-kit';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import { describe, expect, it } from 'vitest';

const accessToken = 'companion-initial-plan-run-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

function provider(
  handler: (input: { packet: PlanningPromptPacket }) => unknown | Promise<unknown>,
) {
  return new FakePlannerProvider(handler, {
    contractVersion: '1.0.0',
    id: 'fake-planner',
    version: '0.1.0',
    displayName: 'Fake Planner',
    description: 'Deterministic planner for asynchronous initial-plan tests.',
    availability: { available: true },
    limits: { maxConcurrency: 1 },
    dataHandling: {
      executionLocation: 'local',
      dataTransmission: 'none',
      credentialManagement: 'provider_managed',
    },
  });
}

async function submitGoal(runtime: RunningRuntime, instanceId = randomUUID()) {
  const requestId = randomUUID();
  const request = {
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'canvas',
    catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
    instanceId,
    goal: 'Create a launch diagram and deliver it as SVG.',
    planId: `launch-diagram-${requestId}`,
    occurredAt: new Date().toISOString(),
  };
  const response = await fetch(`${runtime.baseUrl}/api/v1/companion/goal-request`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
  return request;
}

function runRequest(
  goal: Awaited<ReturnType<typeof submitGoal>>,
  generationRequestId = randomUUID(),
): CompanionInitialPlanRunCreateRequest {
  return {
    generationRequestId,
    goalRequestId: goal.requestId,
    providerId: 'fake-planner',
    providerVersion: '0.1.0',
    targetAdapterId: goal.adapterId,
    targetInstanceId: goal.instanceId,
    authorization: {
      disclosureVersion: '1.0.0',
      dataHandlingAcknowledged: true,
      possibleChargesAcknowledged: true,
      proposalCreationAcknowledged: true,
      authorizedAt: new Date().toISOString(),
    },
  };
}

async function createRun(runtime: RunningRuntime, request: CompanionInitialPlanRunCreateRequest) {
  return fetch(`${runtime.baseUrl}/api/v1/companion/initial-plan-run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
}

async function getRun(runtime: RunningRuntime, generationRequestId: string) {
  const url = new URL('/api/v1/companion/initial-plan-run', runtime.baseUrl);
  url.searchParams.set('generationRequestId', generationRequestId);
  const response = await fetch(url, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as CompanionInitialPlanRun;
}

async function waitForTerminal(runtime: RunningRuntime, generationRequestId: string) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const run = await getRun(runtime, generationRequestId);
    if (run.terminal) {
      return run;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Initial plan run ${generationRequestId} did not become terminal`);
}

function rewindRun(databasePath: string, generationRequestId: string) {
  const sqlite = new DatabaseSync(databasePath);
  try {
    const row = sqlite
      .prepare('SELECT payload FROM companion_initial_plan_runs WHERE generation_request_id = ?')
      .get(generationRequestId) as { payload: string };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    Object.assign(payload, {
      status: 'generating',
      terminal: false,
      proposalId: null,
      error: null,
      needsRevision: null,
      updatedAt: new Date().toISOString(),
    });
    sqlite
      .prepare(
        `UPDATE companion_initial_plan_runs
         SET status = 'generating', updated_at = ?, payload = ?
         WHERE generation_request_id = ?`,
      )
      .run(payload['updatedAt'], JSON.stringify(payload), generationRequestId);
    sqlite
      .prepare('DELETE FROM execution_events WHERE id = ?')
      .run(`companion-initial-plan-run:${generationRequestId}:proposal_created`);
  } finally {
    sqlite.close();
  }
}

async function callMcpTool(runtime: RunningRuntime, name: string, argumentsValue: unknown) {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  const line = (await response.text()).split('\n').find((item) => item.startsWith('data: '));
  return JSON.parse(line!.slice('data: '.length)) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
}

async function callGoalPrompt(runtime: RunningRuntime, requestId: string) {
  const envelope = await callMcpTool(runtime, 'operatingline.goal.prompt.get', { requestId });
  return JSON.parse(envelope.result.content[0]!.text) as PlanningPromptPacket;
}

describe('asynchronous companion initial plan runs', () => {
  it('requires bearer authorization, strict consent, current provider version, and exact target binding', async () => {
    const fakeProvider = provider(({ packet }) => buildSyntheticCanvasDraft(packet));
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const goal = await submitGoal(runtime);
      const request = runRequest(goal);
      const unauthorized = await fetch(`${runtime.baseUrl}/api/v1/companion/initial-plan-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      expect(unauthorized.status).toBe(401);
      expect(
        (
          await createRun(runtime, {
            ...request,
            authorization: {
              ...request.authorization,
              possibleChargesAcknowledged: false as true,
            },
          })
        ).status,
      ).toBe(400);
      const wrongTarget = await createRun(runtime, {
        ...request,
        targetInstanceId: randomUUID(),
      });
      expect(wrongTarget.status).toBe(409);
      await expect(wrongTarget.json()).resolves.toMatchObject({ error: 'target_binding_mismatch' });
      const staleProvider = await createRun(runtime, {
        ...request,
        generationRequestId: randomUUID(),
        providerVersion: '9.9.9',
      });
      expect(staleProvider.status).toBe(409);
      await expect(staleProvider.json()).resolves.toMatchObject({
        error: 'provider_binding_mismatch',
      });
      expect(fakeProvider.inputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });

  it('returns 202 before provider completion, supports polling, and replays idempotently', async () => {
    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseProvider = resolveGate;
    });
    const fakeProvider = provider(async ({ packet }) => {
      await gate;
      return buildSyntheticCanvasDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const goal = await submitGoal(runtime);
      const request = runRequest(goal);
      const response = await Promise.race([
        createRun(runtime, request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('POST initial-plan-run blocked on provider')), 500),
        ),
      ]);
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        generationRequestId: request.generationRequestId,
        status: 'queued',
        terminal: false,
        sceneChanged: false,
      });
      expect((await getRun(runtime, request.generationRequestId)).sceneChanged).toBe(false);
      const duplicate = await createRun(runtime, request);
      expect(duplicate.status).toBe(202);
      releaseProvider();
      const completed = await waitForTerminal(runtime, request.generationRequestId);
      expect(completed).toMatchObject({
        status: 'proposal_created',
        terminal: true,
        sceneChanged: false,
        proposalId: expect.any(String),
        error: null,
      });
      expect(fakeProvider.inputs).toHaveLength(1);
      const replay = await createRun(runtime, request);
      await expect(replay.json()).resolves.toEqual(completed);
      expect(fakeProvider.inputs).toHaveLength(1);

      const guide = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=canvas&instanceId=${goal.instanceId}`,
        { headers },
      );
      await expect(guide.json()).resolves.toMatchObject({
        plan: null,
        proposal: {
          proposalId: completed.proposalId,
          goalRequestId: goal.requestId,
          targetInstanceId: goal.instanceId,
        },
      });

      const evalResponse = await fetch(
        `${runtime.baseUrl}/api/v1/eval/export?targetAdapterId=canvas&planId=${goal.planId}&instanceId=${goal.instanceId}`,
        { headers },
      );
      expect(evalResponse.status).toBe(200);
      const evalBundle = (await evalResponse.json()) as {
        events: Array<{ eventType: string; payload: Record<string, unknown> }>;
      };
      expect(evalBundle.events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining([
          'companion.initial-plan-run.authorized',
          'companion.initial-plan-run.transitioned',
          'planning.provider.generation.requested',
          'planning.provider.generation.completed',
          'planning.provider.generation.proposed',
        ]),
      );
      expect(
        evalBundle.events.find(
          (event) => event.eventType === 'planning.provider.generation.proposed',
        )?.payload,
      ).toMatchObject({
        generationRequestId: request.generationRequestId,
        goalRequestId: goal.requestId,
        proposalId: completed.proposalId,
      });
    } finally {
      releaseProvider();
      await runtime.stop();
    }
  });

  it('exposes needs-revision and sanitized failure without changing the scene', async () => {
    let invocation = 0;
    const fakeProvider = provider(({ packet }) => {
      invocation += 1;
      if (invocation === 1) {
        const draft = buildSyntheticCanvasDraft(packet);
        draft.plan.steps.find((step) => step.action !== null)!.action!.name =
          'unknown.vendor.action';
        return draft;
      }
      throw new Error('PRIVATE_INITIAL_PROVIDER_FAILURE');
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const firstGoal = await submitGoal(runtime);
      const firstRequest = runRequest(firstGoal);
      expect((await createRun(runtime, firstRequest)).status).toBe(202);
      expect(await waitForTerminal(runtime, firstRequest.generationRequestId)).toMatchObject({
        status: 'needs_revision',
        terminal: true,
        sceneChanged: false,
        proposalId: null,
        needsRevision: { planning: { errorCount: expect.any(Number) } },
      });

      const secondGoal = await submitGoal(runtime);
      const secondRequest = runRequest(secondGoal);
      expect((await createRun(runtime, secondRequest)).status).toBe(202);
      const failed = await waitForTerminal(runtime, secondRequest.generationRequestId);
      expect(failed).toMatchObject({
        status: 'failed',
        terminal: true,
        sceneChanged: false,
        proposalId: null,
        error: { code: 'planner_provider_failed', retryMode: 'new_request_id' },
      });
      expect(JSON.stringify(failed)).not.toContain('PRIVATE_INITIAL_PROVIDER_FAILURE');
    } finally {
      await runtime.stop();
    }
  });

  it('does not claim an external proposal that wins the provider-await race', async () => {
    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseProvider = resolveGate;
    });
    const fakeProvider = provider(async ({ packet }) => {
      await gate;
      return buildSyntheticCanvasDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const goal = await submitGoal(runtime);
      const packet = await callGoalPrompt(runtime, goal.requestId);
      const request = runRequest(goal);
      expect((await createRun(runtime, request)).status).toBe(202);
      while (fakeProvider.inputs.length < 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      }
      const externalDraft = buildSyntheticCanvasDraft(packet);
      const proposed = await callMcpTool(runtime, 'operatingline.guide.propose', {
        ...externalDraft,
        goalRequestId: goal.requestId,
      });
      expect(proposed.result.isError).not.toBe(true);
      const external = JSON.parse(proposed.result.content[0]!.text) as { proposalId: string };
      releaseProvider();
      const completed = await waitForTerminal(runtime, request.generationRequestId);
      expect(completed).toMatchObject({
        status: 'failed',
        sceneChanged: false,
        proposalId: null,
        error: { retryMode: 'new_request_id' },
      });
      const guide = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=canvas&instanceId=${goal.instanceId}`,
        { headers },
      );
      await expect(guide.json()).resolves.toMatchObject({
        proposal: { proposalId: external.proposalId },
      });
    } finally {
      releaseProvider();
      await runtime.stop();
    }
  });

  it('recovers only exact host-goal generation provenance after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-initial-run-recovery-'));
    const databasePath = join(directory, 'events.db');
    const firstProvider = provider(({ packet }) => buildSyntheticCanvasDraft(packet));
    const first = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [firstProvider],
    });
    try {
      const goal = await submitGoal(first);
      const request = runRequest(goal);
      expect((await createRun(first, request)).status).toBe(202);
      const original = await waitForTerminal(first, request.generationRequestId);
      expect(original.status).toBe('proposal_created');
      await first.stop();
      rewindRun(databasePath, request.generationRequestId);

      const restartedProvider = provider(({ packet }) => buildSyntheticCanvasDraft(packet));
      const restarted = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [syntheticCanvasActionCatalog],
        plannerProviders: [restartedProvider],
      });
      try {
        expect(await getRun(restarted, request.generationRequestId)).toMatchObject({
          status: 'proposal_created',
          proposalId: original.proposalId,
          sceneChanged: false,
        });
        expect(restartedProvider.inputs).toHaveLength(0);
      } finally {
        await restarted.stop();
      }
    } finally {
      await first.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not let plain initial generation with the same UUID masquerade as host-goal evidence', async () => {
    const fakeProvider = provider(({ packet }) => buildSyntheticCanvasDraft(packet));
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const goal = await submitGoal(runtime);
      const generationRequestId = randomUUID();
      const plain = await fetch(`${runtime.baseUrl}/api/v1/planner/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestId: generationRequestId,
          providerId: 'fake-planner',
          targetAdapterId: goal.adapterId,
          catalogVersion: goal.catalogVersion,
          goal: goal.goal,
          planId: goal.planId,
        }),
      });
      expect(plain.status).toBe(200);
      const request = runRequest(goal, generationRequestId);
      expect((await createRun(runtime, request)).status).toBe(202);
      const completed = await waitForTerminal(runtime, generationRequestId);
      expect(completed).toMatchObject({
        status: 'failed',
        sceneChanged: false,
        proposalId: null,
      });
      expect(fakeProvider.inputs).toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });

  it('includes companion state only for the authorized target instance in the Goal packet', async () => {
    const targetInstanceId = randomUUID();
    const otherInstanceId = randomUUID();
    const fakeProvider = provider(({ packet }) => buildSyntheticCanvasDraft(packet));
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    const report = (instanceId: string) => ({
      protocolVersion: '1.1.0',
      reportId: randomUUID(),
      sequence: 1,
      adapterId: 'canvas',
      instanceId,
      companionVersion: '0.1.0',
      hostVersion: '1.0.0',
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
    });
    try {
      for (const instanceId of [targetInstanceId, otherInstanceId]) {
        const response = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify(report(instanceId)),
        });
        expect(response.status).toBe(200);
      }
      const goal = await submitGoal(runtime, targetInstanceId);
      const request = runRequest(goal);
      expect((await createRun(runtime, request)).status).toBe(202);
      expect((await waitForTerminal(runtime, request.generationRequestId)).status).toBe(
        'proposal_created',
      );
      expect(fakeProvider.inputs[0]?.packet.context.companionStates).toHaveLength(1);
      expect(fakeProvider.inputs[0]?.packet.context.companionStates[0]?.instanceId).toBe(
        targetInstanceId,
      );
    } finally {
      await runtime.stop();
    }
  });
});
