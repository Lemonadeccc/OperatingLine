import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  it('classifies persistence failures as internal without exposing SQLite details', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-failure-'));
    const databasePath = join(directory, 'state.db');
    const runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_procedure_storage
        BEFORE INSERT ON procedure_trees
        BEGIN
          SELECT RAISE(FAIL, 'injected private sqlite detail');
        END;
      `);
      injected.close();

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: procedureFixture() }),
      });
      expect(http.status).toBe(500);
      const httpError = JSON.stringify(await http.json());
      expect(httpError).toContain('procedure_tree_storage_failed');
      expect(httpError).not.toContain('injected private sqlite detail');

      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: procedureFixture(),
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain('procedure_tree_storage_failed');
      expect(mcp.result?.content?.[0]?.text).not.toContain('injected private sqlite detail');
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores immutable revisions and serves exact, latest, and paginated reads across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-runtime-'));
    const databasePath = join(directory, 'state.db');
    let runtime: RunningRuntime | undefined;
    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const revisionOne = procedureFixture();
      const storedMcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: revisionOne,
      });
      expect(storedMcp.result?.isError).not.toBe(true);
      const stored = JSON.parse(storedMcp.result?.content?.[0]?.text ?? '{}') as {
        result?: string;
        record?: {
          sequence?: number;
          tree?: { id?: string; revision?: number };
          integrity?: { contentSha256?: string; canonicalization?: string };
          storedAt?: string;
        };
      };
      expect(stored).toMatchObject({
        result: 'accepted',
        record: {
          tree: { id: 'snowman.eye.left.procedure', revision: 1 },
          integrity: { canonicalization: 'operatingline-json-value-v1' },
        },
        validation: { interactionTracks: 'structural_only' },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(stored.record?.integrity?.contentSha256).toMatch(/^[a-f0-9]{64}$/);

      const duplicate = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionOne }),
      });
      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({
        result: 'duplicate',
        record: {
          sequence: stored.record?.sequence,
          storedAt: stored.record?.storedAt,
          integrity: { contentSha256: stored.record?.integrity?.contentSha256 },
        },
      });

      const revisionThree = procedureFixture();
      revisionThree['revision'] = 3;
      revisionThree['title'] = 'Snowman left eye revision 3';
      const newer = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionThree }),
      });
      expect(newer.status).toBe(200);
      await expect(newer.json()).resolves.toMatchObject({
        result: 'accepted',
        record: { tree: { revision: 3 } },
      });

      const revisionTwo = procedureFixture();
      revisionTwo['revision'] = 2;
      const stale = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionTwo }),
      });
      expect(stale.status).toBe(409);
      await expect(stale.json()).resolves.toMatchObject({
        error: 'procedure_tree_revision_stale',
        result: 'stale',
        latestRevision: 3,
      });

      const conflicting = procedureFixture();
      conflicting['title'] = 'Conflicting immutable revision';
      const conflict = await callMcpTool(runtime, 2, 'operatingline.procedure.store', {
        tree: conflicting,
      });
      expect(conflict.result?.isError).toBe(true);
      expect(conflict.result?.content?.[0]?.text).toContain('procedure_tree_revision_conflict');

      const exact = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=1`,
        { headers },
      );
      expect(exact.status).toBe(200);
      await expect(exact.json()).resolves.toMatchObject({ tree: { revision: 1 } });

      const latest = await callMcpTool(runtime, 3, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
      });
      expect(latest.result?.isError).not.toBe(true);
      expect(JSON.parse(latest.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        tree: { revision: 3 },
      });

      const firstPage = await callMcpTool(runtime, 4, 'operatingline.procedure.list', {
        limit: 1,
      });
      const page = JSON.parse(firstPage.result?.content?.[0]?.text ?? '{}') as {
        procedures?: Array<{ sequence?: number; revision?: number; tree?: unknown }>;
        nextAfterSequence?: number | null;
      };
      expect(page.procedures).toMatchObject([{ revision: 1 }]);
      expect(page.procedures?.[0]).not.toHaveProperty('tree');
      expect(page.nextAfterSequence).toBe(page.procedures?.[0]?.sequence);
      const secondPage = await fetch(
        `${runtime.baseUrl}/api/v1/procedures?afterSequence=${page.nextAfterSequence}&limit=1&adapterId=blender`,
        { headers },
      );
      expect(secondPage.status).toBe(200);
      await expect(secondPage.json()).resolves.toMatchObject({
        procedures: [{ revision: 3 }],
        nextAfterSequence: null,
      });

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });
      await runtime.stop();
      runtime = undefined;

      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const restarted = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure`,
        { headers },
      );
      expect(restarted.status).toBe(200);
      await expect(restarted.json()).resolves.toMatchObject({ tree: { revision: 3 } });
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

      const rejectedStore = await callMcpTool(runtime, 4, 'operatingline.procedure.store', {
        tree: mismatched,
      });
      expect(rejectedStore.result).toMatchObject({ isError: true });
      expect(rejectedStore.result?.content?.[0]?.text).toContain(
        'procedure_tree_validation_failed',
      );
      const rejectedStoreHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(rejectedStoreHttp.status).toBe(422);
      await expect(rejectedStoreHttp.json()).resolves.toMatchObject({
        error: 'procedure_tree_validation_failed',
      });

      const booleanRevision = await callMcpTool(runtime, 5, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
        revision: true,
      });
      expect(booleanRevision.result).toMatchObject({ isError: true });
      const booleanLimit = await callMcpTool(runtime, 6, 'operatingline.procedure.list', {
        limit: true,
      });
      expect(booleanLimit.result).toMatchObject({ isError: true });
      const invalidHttpRevision = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=true`,
        { headers },
      );
      expect(invalidHttpRevision.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });
});
