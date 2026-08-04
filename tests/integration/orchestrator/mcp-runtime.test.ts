import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { FakeBlenderAdapter } from '@operatingline/test-kit';
import { openOperatingLineDatabase } from '@operatingline/persistence';

import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';

const accessToken = 'test-token-with-at-least-16-characters';

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
  };
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
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP tool call failed with HTTP ${response.status}`);
  }
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  if (dataLine === undefined) {
    throw new Error('MCP tool call did not return an SSE data event');
  }
  return JSON.parse(dataLine.slice('data: '.length)) as McpToolResponse;
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
      expect(JSON.parse(dataLine!.slice('data: '.length))).toMatchObject({
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
            { name: 'operatingline.replan.requests.list' },
            { name: 'operatingline.replan.propose' },
            { name: 'operatingline.guide.publish' },
            { name: 'operatingline.guide.propose' },
          ],
        },
      });

      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
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
      };
      expect(catalog).toMatchObject({ catalogVersion: '1.0.0' });
      expect(catalog.actions).toHaveLength(8);

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
      };
      expect(context).toMatchObject({
        goal,
        recommendedRevision: 1,
        constraints: { humanApprovalRequired: true },
        submission: { toolName: 'operatingline.guide.propose' },
      });

      const fixture = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
      ) as Record<string, unknown>;
      const plan = { ...fixture, id: 'mascot-demo', revision: 1 };
      expect(
        (
          await callMcpTool(runtime, 12, 'operatingline.guide.propose', {
            targetAdapterId: 'blender',
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
        catalog: { catalogVersion: '1.0.0' },
      });

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
      expect(unknownAction.result?.content?.[0]?.text).toContain('absent from blender@1.0.0');

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
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
      ) as Record<string, unknown>;
      const requestId = randomUUID();
      const instanceId = randomUUID();
      const revisionRequest = {
        protocolVersion: '1.0.0',
        requestId,
        adapterId: 'blender',
        catalogVersion: '1.0.0',
        instanceId,
        basePlan,
        references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
        message: 'Make the head larger while preserving the three-part silhouette.',
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

      const invalidReference = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...revisionRequest,
          requestId: randomUUID(),
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
            catalogVersion: '1.0.0',
            basePlan: { id: 'snowman-demo', revision: 3 },
            references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
          },
        ],
      });

      const replanned = {
        ...basePlan,
        revision: 4,
        title: 'Create a snowman with a larger head',
      };
      const wrongCatalog = await callMcpTool(runtime, 18, 'operatingline.replan.propose', {
        requestId,
        catalogVersion: '0.9.0',
        plan: replanned,
      });
      expect(wrongCatalog.result).toMatchObject({ isError: true });
      expect(wrongCatalog.result?.content?.[0]?.text).toContain(
        'must match revision request catalog 1.0.0',
      );
      const proposed = await callMcpTool(runtime, 19, 'operatingline.replan.propose', {
        requestId,
        catalogVersion: '1.0.0',
        plan: replanned,
      });
      expect(JSON.parse(proposed.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        proposed: true,
        planId: 'snowman-demo',
        revision: 4,
        catalogVersion: '1.0.0',
        revisionRequestId: requestId,
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
          catalogVersion: '1.0.0',
          plan: { id: 'snowman-demo', revision: 4 },
        },
      });
      guideUrl.searchParams.set('instanceId', randomUUID());
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toMatchObject({ plan: null, proposal: null });
      await expect(
        fetch(`${runtime.baseUrl}/api/v1/guide`, { headers }).then((response) => response.json()),
      ).resolves.toEqual({ plan: null });

      const secondProposal = await callMcpTool(runtime, 21, 'operatingline.replan.propose', {
        requestId,
        catalogVersion: '1.0.0',
        plan: { ...replanned, revision: 5 },
      });
      expect(secondProposal.result).toMatchObject({ isError: true });
      expect(secondProposal.result?.content?.[0]?.text).toContain('already has a proposal');
    } finally {
      await runtime.stop();
    }
  });

  it('delivers only new guide plans containing actions for the requesting adapter', async () => {
    const runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    const instanceId = randomUUID();
    try {
      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
      ) as { id: string; revision: number };
      expect(
        (await callMcpTool(runtime, 20, 'operatingline.guide.publish', plan)).result?.isError,
      ).not.toBe(true);

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      const delivered = await fetch(guideUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(delivered.status).toBe(200);
      await expect(delivered.json()).resolves.toMatchObject({
        protocolVersion: '1.0.0',
        plan: { id: plan.id, revision: plan.revision },
      });

      guideUrl.searchParams.set('knownPlanId', plan.id);
      guideUrl.searchParams.set('knownRevision', String(plan.revision));
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({ protocolVersion: '1.0.0', plan: null, proposal: null });

      guideUrl.searchParams.set('knownRevision', String(plan.revision + 2));
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({ protocolVersion: '1.0.0', plan: null, proposal: null });
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
      });

      guideUrl.searchParams.set('adapterId', 'different-adapter');
      await expect(
        fetch(guideUrl, { headers: { authorization: `Bearer ${accessToken}` } }).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({ protocolVersion: '1.0.0', plan: null, proposal: null });
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
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
      ) as { id: string; revision: number };
      const proposed = await callMcpTool(runtime, 30, 'operatingline.guide.propose', {
        targetAdapterId: 'blender',
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
        protocolVersion: '1.0.0',
        plan: null,
        proposal: {
          proposalId: proposalResult.proposalId,
          targetAdapterId: 'blender',
          plan: { id: plan.id, revision: plan.revision },
        },
      });

      guideUrl.searchParams.set('knownProposalId', proposalResult.proposalId!);
      await expect(
        fetch(guideUrl, { headers }).then((response) => response.json()),
      ).resolves.toEqual({ protocolVersion: '1.0.0', plan: null, proposal: null });

      const decision = {
        protocolVersion: '1.0.0',
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
      ).resolves.toEqual({ protocolVersion: '1.0.0', plan: null, proposal: null });

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
      readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
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
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
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
