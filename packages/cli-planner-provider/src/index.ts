import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  PlannerProvider,
  PlannerProviderGenerateInput,
  PlannerProviderReplanInput,
} from '@operatingline/planner-provider-sdk';
import {
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';

const providerVersion = '0.1.0' as const;
const defaultCodexExecutable = 'codex';
const defaultClaudeExecutable = 'claude';
const defaultClaudeMaximumBudgetUsd = 1;
const maximumCapturedOutputBytes = 4 * 1024 * 1024;
const maximumPlannerResponseBytes = 2 * 1024 * 1024;
const executableProbeTimeoutMs = 3_000;

export interface CliProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly input: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly maximumOutputBytes: number;
}

export interface CliProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
}

export type CliProcessRunner = (request: CliProcessRequest) => Promise<CliProcessResult>;
export type CliExecutableProbe = (executable: string) => boolean;

interface CommonCliPlannerProviderOptions {
  readonly executable?: string;
  readonly model?: string;
  readonly runner?: CliProcessRunner;
  readonly executableProbe?: CliExecutableProbe;
}

export interface CodexCliPlannerProviderOptions extends CommonCliPlannerProviderOptions {
  readonly id?: string;
}

export interface ClaudeCodeCliPlannerProviderOptions extends CommonCliPlannerProviderOptions {
  readonly id?: string;
  readonly maximumBudgetUsd?: number;
}

export type CliPlannerProviderErrorCode =
  | 'not_configured'
  | 'request_aborted'
  | 'request_failed'
  | 'response_missing'
  | 'response_invalid_json'
  | 'response_too_large';

export class CliPlannerProviderError extends Error {
  readonly code: CliPlannerProviderErrorCode;

  constructor(code: CliPlannerProviderErrorCode, message: string) {
    super(message);
    this.name = 'CliPlannerProviderError';
    this.code = code;
  }
}

interface CliProviderDefinitionBase {
  readonly executable: string;
  readonly model?: string;
  readonly runner: CliProcessRunner;
  readonly available: boolean;
}

interface CodexProviderDefinition extends CliProviderDefinitionBase {
  readonly kind: 'codex';
}

interface ClaudeProviderDefinition extends CliProviderDefinitionBase {
  readonly kind: 'claude';
  readonly maximumBudgetUsd: number;
}

type CliProviderDefinition = CodexProviderDefinition | ClaudeProviderDefinition;

class CliPlannerProvider implements PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  private readonly definition: CliProviderDefinition;

  constructor(definition: CliProviderDefinition, id: string | undefined) {
    this.definition = definition;
    const isCodex = definition.kind === 'codex';
    const displayName = isCodex ? 'Codex CLI Planner' : 'Claude Code CLI Planner';
    const unavailableMessage = isCodex
      ? 'Codex CLI is not installed or is not executable.'
      : 'Claude Code CLI is not installed or is not executable.';
    const description = isCodex
      ? 'Runs the installed Codex CLI in an ephemeral, read-only session. The planning prompt may be sent to the CLI configured remote model; CLI-managed authentication and usage charges may apply.'
      : `Runs the installed Claude Code CLI in safe non-interactive mode with tools disabled and a maximum budget of $${formatBudget(definition.maximumBudgetUsd)} per run. The planning prompt may be sent to the CLI configured remote model; CLI-managed authentication and usage charges may apply.`;

    this.descriptor = plannerProviderDescriptorSchema.parse({
      contractVersion: plannerProviderContractVersion,
      id: id ?? (isCodex ? 'codex-cli' : 'claude-code-cli'),
      version: providerVersion,
      displayName,
      description,
      availability: definition.available
        ? { available: true }
        : {
            available: false,
            reason: 'not_configured',
            message: unavailableMessage,
          },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'remote',
        dataTransmission: 'provider_managed',
        credentialManagement: 'provider_managed',
      },
    });
  }

  async generate(input: PlannerProviderGenerateInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  async replan(input: PlannerProviderReplanInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  private async requestJson(renderedPrompt: string, signal: AbortSignal): Promise<unknown> {
    if (!this.definition.available) {
      throw new CliPlannerProviderError(
        'not_configured',
        'The selected local AI client is not available.',
      );
    }
    if (signal.aborted) {
      throw abortedError();
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'operating-line-cli-planner-'));
    await chmod(temporaryDirectory, 0o700);
    try {
      return this.definition.kind === 'codex'
        ? await this.runCodex(this.definition, renderedPrompt, signal, temporaryDirectory)
        : await this.runClaude(this.definition, renderedPrompt, signal, temporaryDirectory);
    } catch (error) {
      if (error instanceof CliPlannerProviderError) {
        throw error;
      }
      if (signal.aborted) {
        throw abortedError();
      }
      throw new CliPlannerProviderError(
        'request_failed',
        'The local AI client planner request failed.',
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async runCodex(
    definition: CodexProviderDefinition,
    renderedPrompt: string,
    signal: AbortSignal,
    temporaryDirectory: string,
  ): Promise<unknown> {
    const outputPath = join(temporaryDirectory, 'last-message.json');
    const result = await definition.runner({
      executable: definition.executable,
      args: codexArguments(temporaryDirectory, outputPath, definition.model),
      input: renderedPrompt,
      cwd: temporaryDirectory,
      environment: sanitizedChildEnvironment(),
      signal,
      maximumOutputBytes: maximumCapturedOutputBytes,
    });
    assertSuccessfulExit(result);
    return parseJsonResponse(await readBoundedFile(outputPath));
  }

  private async runClaude(
    definition: ClaudeProviderDefinition,
    renderedPrompt: string,
    signal: AbortSignal,
    temporaryDirectory: string,
  ): Promise<unknown> {
    const result = await definition.runner({
      executable: definition.executable,
      args: claudeArguments(definition.maximumBudgetUsd, definition.model),
      input: renderedPrompt,
      cwd: temporaryDirectory,
      environment: sanitizedChildEnvironment(),
      signal,
      maximumOutputBytes: maximumCapturedOutputBytes,
    });
    assertSuccessfulExit(result);
    return parseClaudeResponse(result.stdout);
  }
}

export function createCodexCliPlannerProvider(
  options: CodexCliPlannerProviderOptions = {},
): PlannerProvider {
  const executable = requireExecutable(options.executable ?? defaultCodexExecutable);
  const model = normalizeOptional(options.model);
  const probe = options.executableProbe ?? defaultExecutableProbe;
  return new CliPlannerProvider(
    {
      kind: 'codex',
      executable,
      ...(model === undefined ? {} : { model }),
      runner: options.runner ?? runCliProcess,
      available: probe(executable),
    },
    options.id,
  );
}

export function createClaudeCodeCliPlannerProvider(
  options: ClaudeCodeCliPlannerProviderOptions = {},
): PlannerProvider {
  const executable = requireExecutable(options.executable ?? defaultClaudeExecutable);
  const maximumBudgetUsd = options.maximumBudgetUsd ?? defaultClaudeMaximumBudgetUsd;
  assertMaximumBudget(maximumBudgetUsd);
  const model = normalizeOptional(options.model);
  const probe = options.executableProbe ?? defaultExecutableProbe;
  return new CliPlannerProvider(
    {
      kind: 'claude',
      executable,
      ...(model === undefined ? {} : { model }),
      maximumBudgetUsd,
      runner: options.runner ?? runCliProcess,
      available: probe(executable),
    },
    options.id,
  );
}

export async function runCliProcess(request: CliProcessRequest): Promise<CliProcessResult> {
  if (request.signal.aborted) {
    throw abortedError();
  }
  if (!Number.isInteger(request.maximumOutputBytes) || request.maximumOutputBytes < 1) {
    throw new TypeError('maximumOutputBytes must be a positive integer.');
  }

  return new Promise<CliProcessResult>((resolve, reject) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    let outputExceeded = false;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: request.environment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const cleanup = (): void => {
      request.signal.removeEventListener('abort', abort);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const stopChild = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill('SIGTERM');
      if (forceKillTimer === undefined) {
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
        forceKillTimer.unref();
      }
    };
    const abort = (): void => stopChild();
    const accountOutput = (bytes: number): void => {
      if (outputExceeded) {
        return;
      }
      if (stdoutBytes + stderrBytes + bytes > request.maximumOutputBytes) {
        outputExceeded = true;
        stopChild();
      }
    };

    request.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      accountOutput(chunk.length);
      if (!outputExceeded) {
        stdoutBytes += chunk.length;
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      accountOutput(chunk.length);
      if (!outputExceeded) {
        stderrBytes += chunk.length;
      }
    });
    child.stdin.on('error', () => undefined);
    child.once('error', fail);
    child.once('close', (exitCode, childSignal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (request.signal.aborted) {
        reject(abortedError());
        return;
      }
      if (outputExceeded) {
        reject(
          new CliPlannerProviderError(
            'response_too_large',
            'The local AI client produced too much output.',
          ),
        );
        return;
      }
      resolve({
        exitCode,
        signal: childSignal,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
      });
    });
    child.stdin.end(request.input);
  });
}

function codexArguments(
  temporaryDirectory: string,
  outputPath: string,
  model: string | undefined,
): readonly string[] {
  return [
    'exec',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    '--config',
    'shell_environment_policy.inherit=none',
    '--cd',
    temporaryDirectory,
    '--output-last-message',
    outputPath,
    ...(model === undefined ? [] : ['--model', model]),
    '-',
  ];
}

function claudeArguments(maximumBudgetUsd: number, model: string | undefined): readonly string[] {
  return [
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
    formatBudget(maximumBudgetUsd),
    ...(model === undefined ? [] : ['--model', model]),
  ];
}

function assertSuccessfulExit(result: CliProcessResult): void {
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new CliPlannerProviderError(
      'request_failed',
      'The local AI client did not complete successfully.',
    );
  }
}

async function readBoundedFile(path: string): Promise<string> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new CliPlannerProviderError(
      'response_missing',
      'The local AI client did not return a planner response.',
    );
  }
  if (size > maximumPlannerResponseBytes) {
    throw new CliPlannerProviderError(
      'response_too_large',
      'The local AI client planner response is too large.',
    );
  }
  return readFile(path, 'utf8');
}

function parseClaudeResponse(stdout: string): unknown {
  const envelope = parseJsonResponse(stdout);
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw invalidJsonError();
  }
  const record = envelope as Record<string, unknown>;
  if (record['is_error'] === true) {
    throw new CliPlannerProviderError(
      'request_failed',
      'The local AI client did not complete successfully.',
    );
  }
  if (record['structured_output'] !== undefined) {
    return record['structured_output'];
  }
  if (typeof record['result'] !== 'string') {
    throw new CliPlannerProviderError(
      'response_missing',
      'The local AI client did not return a planner response.',
    );
  }
  return parseJsonResponse(record['result']);
}

function parseJsonResponse(value: string): unknown {
  try {
    return JSON.parse(value.trim()) as unknown;
  } catch {
    throw invalidJsonError();
  }
}

function invalidJsonError(): CliPlannerProviderError {
  return new CliPlannerProviderError(
    'response_invalid_json',
    'The local AI client returned invalid JSON.',
  );
}

function defaultExecutableProbe(executable: string): boolean {
  const result = spawnSync(executable, ['--version'], {
    env: sanitizedChildEnvironment(),
    shell: false,
    stdio: 'ignore',
    timeout: executableProbeTimeoutMs,
    windowsHide: true,
  });
  return result.status === 0 && result.error === undefined;
}

function sanitizedChildEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined &&
        !name.startsWith('OPERATINGLINE_') &&
        name !== 'MCPB_SIGN_KEY_PATH' &&
        name !== 'MCPB_SIGN_CERT_PATH' &&
        name !== 'MCPB_SIGN_INTERMEDIATE_PATHS',
    ),
  );
}

function requireExecutable(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.includes('\0')
  ) {
    throw new TypeError('CLI executable must be a non-empty path without surrounding whitespace.');
  }
  return value;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') {
    return undefined;
  }
  if (normalized.length > 500 || normalized.includes('\0')) {
    throw new TypeError('CLI model must be at most 500 characters and must not contain NUL.');
  }
  return normalized;
}

function assertMaximumBudget(value: number): void {
  if (!Number.isFinite(value) || value < 0.01 || value > 100) {
    throw new TypeError('Claude Code maximum budget must be between 0.01 and 100 USD.');
  }
}

function formatBudget(value: number): string {
  return value.toFixed(2);
}

function abortedError(): CliPlannerProviderError {
  return new CliPlannerProviderError(
    'request_aborted',
    'The local AI client planner request was aborted.',
  );
}
