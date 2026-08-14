import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';

const accessToken = 'procedure-runtime-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: unknown;
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

function procedureFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('procedure compilation runtime', () => {
  it('compiles through MCP and HTTP without publishing, proposing, or executing', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const tree = procedureFixture();
      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.compile', { tree });
      expect(mcp.result?.isError).not.toBe(true);
      const result = JSON.parse(mcp.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      expect(result).toMatchObject({
        formatVersion: '1.0.0',
        procedureTreeId: 'snowman.eye.left.procedure',
        adapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: {
          protocolVersion: '1.5.0',
          rootStepId: 'snowman',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(mcp.result?.structuredContent).toEqual(result);

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree }),
      });
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toEqual(result);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      expect(guide.status).toBe(200);
      await expect(guide.json()).resolves.toEqual({ plan: null });
    } finally {
      await runtime.stop();
    }
  });

  it('fails closed for malformed trees and mismatched host-version boundaries', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const malformed = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: { unexpected: true },
      });
      expect(malformed.result).toMatchObject({ isError: true });
      expect(malformed.result?.content?.[0]?.text).toContain(
        'invalid_procedure_compilation_request',
      );

      const mismatched = procedureFixture();
      mismatched['hostVersionRange'] = '>=6.0.0 <6.1.0';
      const mcp = await callMcpTool(runtime, 3, 'operatingline.procedure.compile', {
        tree: mismatched,
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain('is not contained by blender@1.12.0 range');

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(http.status).toBe(422);
      await expect(http.json()).resolves.toMatchObject({
        error: 'procedure_compilation_failed',
      });
    } finally {
      await runtime.stop();
    }
  });
});
