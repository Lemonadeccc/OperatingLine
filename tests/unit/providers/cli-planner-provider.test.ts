import { writeFile } from 'node:fs/promises';

import type {
  PlanningPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  CliPlannerProviderError,
  createClaudeCodeCliPlannerProvider,
  createCodexCliPlannerProvider,
  runCliProcess,
  type CliProcessRequest,
  type CliProcessResult,
  type CliProcessRunner,
} from '../../../packages/cli-planner-provider/src/index.js';

const packet = {
  renderedPrompt: 'Return an executable planning proposal as JSON.',
} as PlanningPromptPacket;
const replanPacket = {
  renderedPrompt: 'Return the revised subtree as JSON.',
} as ReplanningPromptPacket;
const successfulResult: CliProcessResult = { exitCode: 0, signal: null, stdout: '' };

function generateInput(signal = new AbortController().signal) {
  return {
    requestId: 'd9428888-122b-4ad5-a375-7f077f2832fc',
    packet,
    signal,
  };
}

describe('local AI CLI planner providers', () => {
  it('runs Codex ephemerally in an empty read-only workspace and parses its final JSON', async () => {
    let request: CliProcessRequest | undefined;
    const runner: CliProcessRunner = vi.fn(async (nextRequest) => {
      request = nextRequest;
      const outputFlag = nextRequest.args.indexOf('--output-last-message');
      const outputPath = nextRequest.args[outputFlag + 1];
      if (outputPath === undefined) {
        throw new Error('missing test output path');
      }
      await writeFile(outputPath, '{"plan":{"id":"snowman"}}', { mode: 0o600 });
      return successfulResult;
    });
    const priorToken = process.env['OPERATINGLINE_ACCESS_TOKEN'];
    process.env['OPERATINGLINE_ACCESS_TOKEN'] = 'must-not-reach-child';

    try {
      const provider = createCodexCliPlannerProvider({
        executable: '/opt/tools/codex',
        model: 'gpt-explicit',
        executableProbe: () => true,
        runner,
      });

      await expect(provider.generate(generateInput())).resolves.toEqual({
        plan: { id: 'snowman' },
      });
      expect(request?.executable).toBe('/opt/tools/codex');
      expect(request?.input).toBe(packet.renderedPrompt);
      expect(request?.args).toEqual(
        expect.arrayContaining([
          'exec',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '--ignore-user-config',
          '--ignore-rules',
          'shell_environment_policy.inherit=none',
          '--model',
          'gpt-explicit',
          '-',
        ]),
      );
      expect(request?.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(request?.environment['OPERATINGLINE_ACCESS_TOKEN']).toBeUndefined();
      expect(provider.descriptor.dataHandling.executionLocation).toBe('remote');
    } finally {
      if (priorToken === undefined) {
        delete process.env['OPERATINGLINE_ACCESS_TOKEN'];
      } else {
        process.env['OPERATINGLINE_ACCESS_TOKEN'] = priorToken;
      }
    }
  });

  it('passes the exact local replan prompt to Codex', async () => {
    let observedPrompt = '';
    const runner: CliProcessRunner = async (request) => {
      observedPrompt = request.input;
      const outputPath = request.args[request.args.indexOf('--output-last-message') + 1];
      if (outputPath === undefined) {
        throw new Error('missing test output path');
      }
      await writeFile(outputPath, '{"requestId":"revision-request"}');
      return successfulResult;
    };
    const provider = createCodexCliPlannerProvider({
      executableProbe: () => true,
      runner,
    });

    await expect(
      provider.replan?.({
        requestId: '57c52870-1a07-450c-84c0-691083751fab',
        packet: replanPacket,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ requestId: 'revision-request' });
    expect(observedPrompt).toBe(replanPacket.renderedPrompt);
  });

  it('runs Claude with customizations and tools disabled, a budget cap, and no persistence', async () => {
    let request: CliProcessRequest | undefined;
    const runner: CliProcessRunner = vi.fn(async (nextRequest) => {
      request = nextRequest;
      return {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '{"plan":{"id":"snowman"}}',
          total_cost_usd: 0.03,
        }),
      };
    });
    const provider = createClaudeCodeCliPlannerProvider({
      model: 'claude-explicit',
      maximumBudgetUsd: 0.75,
      executableProbe: () => true,
      runner,
    });

    await expect(provider.generate(generateInput())).resolves.toEqual({
      plan: { id: 'snowman' },
    });
    expect(request?.input).toBe(packet.renderedPrompt);
    expect(request?.args).toEqual(
      expect.arrayContaining([
        '--print',
        '--safe-mode',
        '--disable-slash-commands',
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--no-session-persistence',
        '--output-format',
        'json',
        '--max-budget-usd',
        '0.75',
        '--model',
        'claude-explicit',
      ]),
    );
    expect(request?.args).not.toContain('--dangerously-skip-permissions');
    expect(provider.descriptor.description).toContain('$0.75 per run');
  });

  it('accepts Claude structured output when the CLI returns it directly', async () => {
    const provider = createClaudeCodeCliPlannerProvider({
      executableProbe: () => true,
      runner: async () => ({
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          type: 'result',
          is_error: false,
          structured_output: { plan: { id: 'structured' } },
        }),
      }),
    });

    await expect(provider.generate(generateInput())).resolves.toEqual({
      plan: { id: 'structured' },
    });
  });

  it('reports unavailable executables without invoking them', async () => {
    const runner = vi.fn<CliProcessRunner>();
    const provider = createCodexCliPlannerProvider({
      executableProbe: () => false,
      runner,
    });

    expect(provider.descriptor.availability).toEqual({
      available: false,
      reason: 'not_configured',
      message: 'Codex CLI is not installed or is not executable.',
    });
    await expect(provider.generate(generateInput())).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('sanitizes invalid, failed, and aborted client responses', async () => {
    const invalidProvider = createClaudeCodeCliPlannerProvider({
      executableProbe: () => true,
      runner: async () => ({ exitCode: 0, signal: null, stdout: 'secret not-json output' }),
    });
    const failedProvider = createClaudeCodeCliPlannerProvider({
      executableProbe: () => true,
      runner: async () => ({ exitCode: 9, signal: null, stdout: 'secret provider output' }),
    });
    const controller = new AbortController();
    const abortedProvider = createClaudeCodeCliPlannerProvider({
      executableProbe: () => true,
      runner: async () => {
        controller.abort();
        throw new Error('secret child-process failure');
      },
    });

    const invalidError = await invalidProvider
      .generate(generateInput())
      .catch((error: unknown) => error);
    const failedError = await failedProvider
      .generate(generateInput())
      .catch((error: unknown) => error);
    const abortedError = await abortedProvider
      .generate(generateInput(controller.signal))
      .catch((error: unknown) => error);

    expect(invalidError).toBeInstanceOf(CliPlannerProviderError);
    expect(invalidError).toMatchObject({ code: 'response_invalid_json' });
    expect(failedError).toMatchObject({ code: 'request_failed' });
    expect(abortedError).toMatchObject({ code: 'request_aborted' });
    expect(String(invalidError)).not.toContain('secret not-json output');
    expect(String(failedError)).not.toContain('secret provider output');
    expect(String(abortedError)).not.toContain('secret child-process failure');
  });

  it('validates executable and budget configuration before registration', () => {
    expect(() => createCodexCliPlannerProvider({ executable: ' codex ' })).toThrow('executable');
    for (const maximumBudgetUsd of [0, 100.01, Number.NaN]) {
      expect(() => createClaudeCodeCliPlannerProvider({ maximumBudgetUsd })).toThrow('budget');
    }
  });

  it('pipes stdin through the real no-shell runner, bounds output, and terminates on abort', async () => {
    const signal = new AbortController().signal;
    await expect(
      runCliProcess({
        executable: process.execPath,
        args: [
          '-e',
          "process.stdin.setEncoding('utf8');let value='';process.stdin.on('data',(chunk)=>value+=chunk);process.stdin.on('end',()=>process.stdout.write(value));",
        ],
        input: 'exact planner packet',
        cwd: process.cwd(),
        environment: process.env,
        signal,
        maximumOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ exitCode: 0, signal: null, stdout: 'exact planner packet' });

    await expect(
      runCliProcess({
        executable: process.execPath,
        args: ['-e', "process.stdout.write('x'.repeat(2048))"],
        input: '',
        cwd: process.cwd(),
        environment: process.env,
        signal,
        maximumOutputBytes: 32,
      }),
    ).rejects.toMatchObject({ code: 'response_too_large' });

    const controller = new AbortController();
    const running = runCliProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      input: '',
      cwd: process.cwd(),
      environment: process.env,
      signal: controller.signal,
      maximumOutputBytes: 1_024,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(running).rejects.toMatchObject({ code: 'request_aborted' });
  });
});
