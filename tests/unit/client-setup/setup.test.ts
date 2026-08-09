import { describe, expect, it } from 'vitest';

import {
  buildClaudeAddCommand,
  buildCodexAddCommand,
  parseClientSetupArguments,
  setupAiClients,
  type CommandInvocation,
  type CommandRunner,
} from '@operatingline/client-setup';

class ScriptedRunner implements CommandRunner {
  readonly invocations: CommandInvocation[] = [];

  constructor(private readonly resultFor: (invocation: CommandInvocation) => number) {}

  run(invocation: CommandInvocation) {
    this.invocations.push(invocation);
    return { status: this.resultFor(invocation), stdout: '', stderr: '' };
  }
}

describe('AI client setup', () => {
  it('builds secret-free Codex and Claude registrations', () => {
    const options = parseClientSetupArguments([]);
    expect(buildCodexAddCommand(options)).toEqual({
      command: 'codex',
      args: [
        'mcp',
        'add',
        'operating-line',
        '--url',
        'http://127.0.0.1:43123/mcp',
        '--bearer-token-env-var',
        'OPERATINGLINE_ACCESS_TOKEN',
      ],
    });
    const claude = buildClaudeAddCommand(options);
    expect(claude.args).toContain('--scope');
    expect(claude.args).toContain('user');
    expect(claude.args.at(-1)).toContain('Bearer ${OPERATINGLINE_ACCESS_TOKEN}');
    expect(JSON.stringify([buildCodexAddCommand(options), claude])).not.toContain(
      'local-token-with-16-plus-characters',
    );
  });

  it('rejects remote endpoints, invalid environment names, and unknown flags', () => {
    expect(() => parseClientSetupArguments(['--url', 'https://example.com/mcp'])).toThrow(
      'loopback',
    );
    expect(() => parseClientSetupArguments(['--token-env', 'lowercase-token'])).toThrow(
      'uppercase environment variable',
    );
    expect(() => parseClientSetupArguments(['--unknown', 'value'])).toThrow(
      'Unknown setup argument',
    );
  });

  it('configures installed clients, skips unavailable clients, and is idempotent', async () => {
    const runner = new ScriptedRunner((invocation) => {
      if (invocation.command === 'claude' && invocation.args[0] === '--version') {
        return 1;
      }
      if (invocation.command === 'codex' && invocation.args[1] === 'get') {
        const addCount = runner.invocations.filter(
          (item) => item.command === 'codex' && item.args[1] === 'add',
        ).length;
        return addCount === 0 ? 1 : 0;
      }
      return 0;
    });
    const options = parseClientSetupArguments([]);

    await expect(setupAiClients(options, runner)).resolves.toEqual([
      expect.objectContaining({ client: 'codex', status: 'configured' }),
      expect.objectContaining({ client: 'claude', status: 'unavailable' }),
    ]);
    await expect(setupAiClients(options, runner)).resolves.toEqual([
      expect.objectContaining({ client: 'codex', status: 'unchanged' }),
      expect.objectContaining({ client: 'claude', status: 'unavailable' }),
    ]);
  });

  it('replaces only the exact named client entry when force is explicit', async () => {
    const runner = new ScriptedRunner(() => 0);
    const options = parseClientSetupArguments(['--client', 'claude', '--force']);
    await expect(setupAiClients(options, runner)).resolves.toEqual([
      expect.objectContaining({ client: 'claude', status: 'configured' }),
    ]);
    expect(runner.invocations.map((invocation) => invocation.args.slice(0, 3))).toEqual([
      ['--version'],
      ['mcp', 'get', 'operating-line'],
      ['mcp', 'remove', 'operating-line'],
      ['mcp', 'add-json', '--scope'],
      ['mcp', 'get', 'operating-line'],
    ]);
  });

  it('supports a no-side-effect dry run even when no client is installed', async () => {
    const runner = new ScriptedRunner(() => {
      throw new Error('dry run must not invoke a command');
    });
    const options = parseClientSetupArguments(['--', '--dry-run']);
    await expect(setupAiClients(options, runner)).resolves.toEqual([
      expect.objectContaining({ client: 'codex', status: 'planned' }),
      expect.objectContaining({ client: 'claude', status: 'planned' }),
    ]);
    expect(runner.invocations).toEqual([]);
  });
});
