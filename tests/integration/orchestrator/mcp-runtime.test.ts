import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

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
            { name: 'operatingline.guide.publish' },
          ],
        },
      });

      const plan = JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
      ) as unknown;
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
        plan: { id: 'snowman-demo', revision: 1 },
      });
    } finally {
      await runtime.stop();
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
      invalidGraph.revision = 2;
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
        'is not newer than latest accepted revision 1',
      );

      const guideResponse = await fetch(`${runtime.baseUrl}/api/v1/guide`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      await expect(guideResponse.json()).resolves.toMatchObject({
        plan: { id: plan.id, revision: 1 },
      });

      const replacementPlan = structuredClone(plan);
      replacementPlan.id = 'snowman-demo-replacement';
      const acceptedReplacement = await callMcpTool(
        runtime,
        13,
        'operatingline.guide.publish',
        replacementPlan,
      );
      expect(acceptedReplacement.result?.isError).not.toBe(true);

      const rejectedAfterSwitch = await callMcpTool(
        runtime,
        14,
        'operatingline.guide.publish',
        plan,
      );
      expect(rejectedAfterSwitch.result).toMatchObject({ isError: true });
      expect(rejectedAfterSwitch.result?.content?.[0]?.text).toContain(
        'is not newer than latest accepted revision 1',
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
