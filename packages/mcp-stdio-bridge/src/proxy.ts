import type { AuthProvider, Client } from '@modelcontextprotocol/client';
import {
  Client as McpClient,
  StreamableHTTPClientTransport,
  type Tool,
} from '@modelcontextprotocol/client';
import { Server, type CallToolResult, type ServerCapabilities } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Readable, Writable } from 'node:stream';

const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const defaultMcpUrl = 'http://127.0.0.1:43123/mcp';
const minimumTokenLength = 16;

export interface McpStdioBridgeConfig {
  readonly endpoint: URL;
  readonly accessToken: string;
}

export interface McpStdioBridgeHandle {
  close(): Promise<void>;
}

export interface McpStdioBridgeOptions {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly onError?: (message: string) => void;
}

export function loadMcpStdioBridgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): McpStdioBridgeConfig {
  const endpoint = parseLoopbackMcpUrl(environment.OPERATINGLINE_MCP_URL ?? defaultMcpUrl);
  const accessToken = environment.OPERATINGLINE_ACCESS_TOKEN;
  if (accessToken === undefined || accessToken.length < minimumTokenLength) {
    throw new Error(
      `OPERATINGLINE_ACCESS_TOKEN must contain at least ${minimumTokenLength} characters`,
    );
  }
  if (accessToken.trim() !== accessToken) {
    throw new Error('OPERATINGLINE_ACCESS_TOKEN must not contain surrounding whitespace');
  }
  return { endpoint, accessToken };
}

export function parseLoopbackMcpUrl(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('OPERATINGLINE_MCP_URL must be a valid URL');
  }
  if (endpoint.protocol !== 'http:') {
    throw new Error('OPERATINGLINE_MCP_URL must use http on the local loopback interface');
  }
  if (!loopbackHosts.has(endpoint.hostname)) {
    throw new Error('OPERATINGLINE_MCP_URL must target 127.0.0.1, ::1, or localhost');
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new Error('OPERATINGLINE_MCP_URL must not contain embedded credentials');
  }
  if (endpoint.search !== '' || endpoint.hash !== '') {
    throw new Error('OPERATINGLINE_MCP_URL must not contain a query string or fragment');
  }
  if (endpoint.pathname.replace(/\/$/u, '') !== '/mcp') {
    throw new Error('OPERATINGLINE_MCP_URL must target the /mcp endpoint');
  }
  endpoint.pathname = '/mcp';
  return endpoint;
}

export async function startMcpStdioBridge(
  config: McpStdioBridgeConfig,
  options: McpStdioBridgeOptions = {},
): Promise<McpStdioBridgeHandle> {
  const reportError = options.onError ?? (() => undefined);
  const authProvider: AuthProvider = {
    token: async () => config.accessToken,
  };
  const upstream = new McpClient(
    { name: 'operating-line-stdio-bridge', version: '0.1.0' },
    { capabilities: {} },
  );
  const upstreamTransport = new StreamableHTTPClientTransport(config.endpoint, {
    authProvider,
  });
  upstream.onerror = (error) => reportError(safeErrorMessage('Upstream MCP error', error));

  await upstream.connect(upstreamTransport);
  const upstreamCapabilities = upstream.getServerCapabilities() ?? {};
  const toolsByName = new Map<string, Tool>();
  const server = createForwardingServer(upstream, upstreamCapabilities, toolsByName);
  server.onerror = (error) => reportError(safeErrorMessage('Local MCP error', error));

  const transport = new StdioServerTransport(options.stdin, options.stdout);
  await server.connect(transport);

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.allSettled([server.close(), upstream.close()]);
    },
  };
}

function createForwardingServer(
  upstream: Client,
  upstreamCapabilities: ServerCapabilities,
  toolsByName: Map<string, Tool>,
): Server {
  const capabilities = forwardedCapabilities(upstreamCapabilities);
  const instructions = upstream.getInstructions();
  const server = new Server(
    { name: 'operating-line', version: '0.1.0' },
    instructions === undefined ? { capabilities } : { capabilities, instructions },
  );

  if (capabilities.tools !== undefined) {
    server.setRequestHandler('tools/list', async (request) => {
      const result = await upstream.listTools(request.params);
      for (const tool of result.tools) {
        toolsByName.set(tool.name, tool);
      }
      return result;
    });
    server.setRequestHandler('tools/call', async (request) => {
      const result = await upstream.callTool(request.params);
      const tool = toolsByName.get(request.params.name);
      return server.projectCallToolResult(
        result as CallToolResult,
        tool?.outputSchema as Readonly<Record<string, unknown>> | undefined,
      );
    });
  }

  if (capabilities.prompts !== undefined) {
    server.setRequestHandler('prompts/list', async (request) =>
      upstream.listPrompts(request.params),
    );
    server.setRequestHandler('prompts/get', async (request) => upstream.getPrompt(request.params));
  }

  if (capabilities.resources !== undefined) {
    server.setRequestHandler('resources/list', async (request) =>
      upstream.listResources(request.params),
    );
    server.setRequestHandler('resources/templates/list', async (request) =>
      upstream.listResourceTemplates(request.params),
    );
    server.setRequestHandler('resources/read', async (request) =>
      upstream.readResource(request.params),
    );
  }

  return server;
}

function forwardedCapabilities(upstream: ServerCapabilities): ServerCapabilities {
  return {
    ...(upstream.tools === undefined ? {} : { tools: { listChanged: false } }),
    ...(upstream.prompts === undefined ? {} : { prompts: { listChanged: false } }),
    ...(upstream.resources === undefined
      ? {}
      : { resources: { listChanged: false, subscribe: false } }),
  };
}

function safeErrorMessage(context: string, error: unknown): string {
  const name = error instanceof Error && error.name !== '' ? error.name : 'Error';
  return `${context}: ${name}`;
}
