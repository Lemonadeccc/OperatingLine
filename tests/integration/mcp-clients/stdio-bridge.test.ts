import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';

const accessToken = 'stdio-bridge-test-token-with-16-characters';
const activeRuntimes: RunningRuntime[] = [];

afterEach(async () => {
  await Promise.all(activeRuntimes.splice(0).map((runtime) => runtime.stop()));
});

describe('Claude Desktop stdio bridge', () => {
  it('forwards instructions, tool discovery, and calls to the loopback runtime', async () => {
    const runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    activeRuntimes.push(runtime);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve('node_modules/tsx/dist/cli.mjs'),
        resolve('packages/mcp-stdio-bridge/src/cli.ts'),
      ],
      env: {
        ...environment,
        OPERATINGLINE_MCP_URL: runtime.mcpEndpoint,
        OPERATINGLINE_ACCESS_TOKEN: accessToken,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-bridge-test', version: '0.1.0' });

    try {
      await client.connect(transport);
      expect(client.getInstructions()).toContain('connection never permits host execution');
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('operatingline.health');
      const health = await client.callTool({ name: 'operatingline.health', arguments: {} });
      expect(health.isError).not.toBe(true);
      expect(health.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('"phase":"ready"') }),
      ]);
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain(
        'operatingline.plan_and_propose',
      );
    } finally {
      await client.close();
    }
  }, 20_000);
});
