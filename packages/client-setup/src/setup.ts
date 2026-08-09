import { spawnSync } from 'node:child_process';

import { parseLoopbackMcpUrl } from '@operatingline/mcp-stdio-bridge';

export type AiClientTarget = 'all' | 'claude' | 'codex';
export type ClaudeConfigurationScope = 'local' | 'project' | 'user';

export interface ClientSetupOptions {
  readonly client: AiClientTarget;
  readonly endpoint: URL;
  readonly tokenEnvironmentName: string;
  readonly claudeScope: ClaudeConfigurationScope;
  readonly force: boolean;
  readonly dryRun: boolean;
}

export interface CommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(invocation: CommandInvocation): CommandResult;
}

export interface ClientSetupResult {
  readonly client: Exclude<AiClientTarget, 'all'>;
  readonly status: 'configured' | 'planned' | 'unchanged' | 'unavailable';
  readonly commands: readonly CommandInvocation[];
}

const serverName = 'operating-line';
const defaultTokenEnvironmentName = 'OPERATINGLINE_ACCESS_TOKEN';

export function parseClientSetupArguments(argv: readonly string[]): ClientSetupOptions {
  let client: AiClientTarget = 'all';
  let endpoint = parseLoopbackMcpUrl('http://127.0.0.1:43123/mcp');
  let tokenEnvironmentName = defaultTokenEnvironmentName;
  let claudeScope: ClaudeConfigurationScope = 'user';
  let force = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${String(argument)}`);
    }
    if (argument === '--client') {
      client = parseClient(value);
    } else if (argument === '--url') {
      endpoint = parseLoopbackMcpUrl(value);
    } else if (argument === '--token-env') {
      tokenEnvironmentName = parseEnvironmentName(value);
    } else if (argument === '--claude-scope') {
      claudeScope = parseClaudeScope(value);
    } else {
      throw new Error(`Unknown setup argument: ${String(argument)}`);
    }
    index += 1;
  }

  return { client, endpoint, tokenEnvironmentName, claudeScope, force, dryRun };
}

export function buildCodexAddCommand(options: ClientSetupOptions): CommandInvocation {
  return {
    command: 'codex',
    args: [
      'mcp',
      'add',
      serverName,
      '--url',
      options.endpoint.href,
      '--bearer-token-env-var',
      options.tokenEnvironmentName,
    ],
  };
}

export function buildClaudeAddCommand(options: ClientSetupOptions): CommandInvocation {
  const configuration = JSON.stringify({
    type: 'http',
    url: options.endpoint.href,
    headers: {
      Authorization: `Bearer \${${options.tokenEnvironmentName}}`,
    },
  });
  return {
    command: 'claude',
    args: ['mcp', 'add-json', '--scope', options.claudeScope, serverName, configuration],
  };
}

export async function setupAiClients(
  options: ClientSetupOptions,
  runner: CommandRunner = systemCommandRunner,
): Promise<readonly ClientSetupResult[]> {
  const targets = options.client === 'all' ? (['codex', 'claude'] as const) : [options.client];
  const results: ClientSetupResult[] = [];
  for (const client of targets) {
    results.push(configureClient(client, options, runner));
  }
  return results;
}

function configureClient(
  client: Exclude<AiClientTarget, 'all'>,
  options: ClientSetupOptions,
  runner: CommandRunner,
): ClientSetupResult {
  const addCommand =
    client === 'codex' ? buildCodexAddCommand(options) : buildClaudeAddCommand(options);
  if (options.dryRun) {
    return { client, status: 'planned', commands: [addCommand] };
  }

  const versionResult = runner.run({ command: client, args: ['--version'] });
  if (versionResult.status !== 0) {
    if (options.client === 'all') {
      return { client, status: 'unavailable', commands: [] };
    }
    throw new Error(`${client} CLI is not installed or is not available on PATH`);
  }

  const getCommand = clientGetCommand(client);
  const existing = runner.run(getCommand).status === 0;
  if (existing && !options.force) {
    return { client, status: 'unchanged', commands: [getCommand] };
  }

  const commands: CommandInvocation[] = [];
  if (existing) {
    const removeCommand = clientRemoveCommand(client);
    requireSuccessfulCommand(runner, removeCommand, client);
    commands.push(removeCommand);
  }
  requireSuccessfulCommand(runner, addCommand, client);
  commands.push(addCommand);
  requireSuccessfulCommand(runner, getCommand, client);
  commands.push(getCommand);
  return { client, status: 'configured', commands };
}

function clientGetCommand(client: Exclude<AiClientTarget, 'all'>): CommandInvocation {
  return {
    command: client,
    args: client === 'codex' ? ['mcp', 'get', serverName, '--json'] : ['mcp', 'get', serverName],
  };
}

function clientRemoveCommand(client: Exclude<AiClientTarget, 'all'>): CommandInvocation {
  return { command: client, args: ['mcp', 'remove', serverName] };
}

function requireSuccessfulCommand(
  runner: CommandRunner,
  invocation: CommandInvocation,
  client: Exclude<AiClientTarget, 'all'>,
): void {
  const result = runner.run(invocation);
  if (result.status !== 0) {
    throw new Error(
      `${client} MCP setup failed while running ${invocation.args.slice(0, 2).join(' ')}`,
    );
  }
}

function parseClient(value: string): AiClientTarget {
  if (value === 'all' || value === 'claude' || value === 'codex') {
    return value;
  }
  throw new Error('--client must be codex, claude, or all');
}

function parseClaudeScope(value: string): ClaudeConfigurationScope {
  if (value === 'local' || value === 'project' || value === 'user') {
    return value;
  }
  throw new Error('--claude-scope must be local, project, or user');
}

function parseEnvironmentName(value: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(value)) {
    throw new Error('--token-env must be an uppercase environment variable name');
  }
  return value;
}

const systemCommandRunner: CommandRunner = {
  run(invocation) {
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};
