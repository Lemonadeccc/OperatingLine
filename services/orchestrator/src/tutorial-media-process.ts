import { spawn, type ChildProcess } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const defaultMaximumOutputBytes = 8 * 1_024 * 1_024;
const maximumStdinBytes = 1 * 1_024 * 1_024;
const defaultTerminationGraceMs = 2_000;
const defaultOutputFilePollIntervalMs = 25;
const allowedEnvironmentNames = new Set([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
]);

export interface TutorialMediaProcessCommand {
  readonly executable: string;
  readonly args?: readonly string[] | undefined;
  readonly cwd: string;
  readonly stdin?: Uint8Array | string | undefined;
  readonly environment?: Readonly<Record<string, string>> | undefined;
}

export interface TutorialMediaProcessRunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly maximumOutputBytes?: number | undefined;
}

export interface TutorialMediaProcessResult {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export type TutorialMediaProcessErrorCode =
  | 'invalid_command'
  | 'runner_closed'
  | 'spawn_failed'
  | 'stdin_failed'
  | 'output_limit_exceeded'
  | 'unsafe_output'
  | 'timed_out'
  | 'aborted'
  | 'process_failed';

export class TutorialMediaProcessError extends Error {
  constructor(
    readonly code: TutorialMediaProcessErrorCode,
    options?: ErrorOptions,
  ) {
    super(
      code === 'invalid_command'
        ? 'The tutorial media process command is invalid.'
        : code === 'runner_closed'
          ? 'The tutorial media process runner is closed.'
          : code === 'output_limit_exceeded'
            ? 'The tutorial media process exceeded its output limit.'
            : code === 'unsafe_output'
              ? 'The tutorial media process created an unsafe output file.'
              : code === 'timed_out'
                ? 'The tutorial media process timed out.'
                : code === 'aborted'
                  ? 'The tutorial media process was aborted.'
                  : code === 'process_failed'
                    ? 'The tutorial media process exited unsuccessfully.'
                    : 'The tutorial media process could not be started or completed.',
      options,
    );
    this.name = 'TutorialMediaProcessError';
  }
}

export interface TutorialMediaProcessRunner {
  run(
    command: TutorialMediaProcessCommand,
    options: TutorialMediaProcessRunOptions,
  ): Promise<TutorialMediaProcessResult>;
  close(): Promise<void>;
}

export interface TutorialMediaProcessRunnerOptions {
  readonly terminationGraceMs?: number | undefined;
  readonly onInvocation?: ((command: Readonly<TutorialMediaProcessCommand>) => void) | undefined;
}

export interface TutorialMediaOutputFileRunOptions {
  readonly command: TutorialMediaProcessCommand;
  readonly maximumFileBytes: number;
  readonly outputPath: string;
  readonly pollIntervalMs?: number | undefined;
  readonly runOptions: TutorialMediaProcessRunOptions;
  readonly runner: TutorialMediaProcessRunner;
}

function positiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TutorialMediaProcessError('invalid_command');
  }
  return value;
}

function validateCommand(command: TutorialMediaProcessCommand): void {
  if (
    command.executable.includes('\0') ||
    command.cwd.includes('\0') ||
    !isAbsolute(command.executable) ||
    !isAbsolute(command.cwd) ||
    resolve(command.executable) !== command.executable ||
    resolve(command.cwd) !== command.cwd
  ) {
    throw new TutorialMediaProcessError('invalid_command');
  }
  for (const argument of command.args ?? []) {
    if (argument.includes('\0')) throw new TutorialMediaProcessError('invalid_command');
  }
  const stdinBytes =
    typeof command.stdin === 'string'
      ? Buffer.byteLength(command.stdin, 'utf8')
      : (command.stdin?.byteLength ?? 0);
  if (stdinBytes > maximumStdinBytes) throw new TutorialMediaProcessError('invalid_command');
  for (const [name, value] of Object.entries(command.environment ?? {})) {
    if (!allowedEnvironmentNames.has(name) || value.includes('\0')) {
      throw new TutorialMediaProcessError('invalid_command');
    }
  }
}

function safeEnvironment(
  overrides: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowedEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  Object.assign(environment, overrides);
  return environment;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

async function outputFileViolation(
  path: string,
  maximumBytes: number,
): Promise<TutorialMediaProcessErrorCode | undefined> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    return 'unsafe_output';
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) return 'unsafe_output';
  return info.size > maximumBytes ? 'output_limit_exceeded' : undefined;
}

export async function runTutorialMediaProcessWithOutputFile(
  options: TutorialMediaOutputFileRunOptions,
): Promise<TutorialMediaProcessResult> {
  const maximumFileBytes = positiveSafeInteger(options.maximumFileBytes);
  const pollIntervalMs = positiveSafeInteger(
    options.pollIntervalMs ?? defaultOutputFilePollIntervalMs,
  );
  if (
    !isAbsolute(options.outputPath) ||
    resolve(options.outputPath) !== options.outputPath ||
    options.outputPath.includes('\0')
  ) {
    throw new TutorialMediaProcessError('invalid_command');
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.runOptions.signal?.addEventListener('abort', abort, { once: true });
  if (options.runOptions.signal?.aborted) controller.abort();

  let stopped = false;
  let releaseWait: (() => void) | undefined;
  let violation: TutorialMediaProcessErrorCode | undefined;
  const monitor = (async () => {
    while (!stopped) {
      violation = await outputFileViolation(options.outputPath, maximumFileBytes);
      if (violation !== undefined) {
        controller.abort();
        return;
      }
      if (stopped) return;
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, pollIntervalMs);
        releaseWait = () => {
          clearTimeout(timer);
          resolveWait();
        };
      });
      releaseWait = undefined;
    }
  })();

  let result: TutorialMediaProcessResult | undefined;
  let runError: unknown;
  try {
    result = await options.runner.run(options.command, {
      ...options.runOptions,
      signal: controller.signal,
    });
  } catch (error) {
    runError = error;
  } finally {
    stopped = true;
    releaseWait?.();
    options.runOptions.signal?.removeEventListener('abort', abort);
    await monitor;
  }

  violation ??= await outputFileViolation(options.outputPath, maximumFileBytes);
  if (violation !== undefined) throw new TutorialMediaProcessError(violation);
  if (runError !== undefined) throw runError;
  return result!;
}

async function terminateProcessTree(child: ChildProcess, graceMs: number): Promise<void> {
  const processId = child.pid;
  if (processId === undefined) return;

  if (process.platform === 'win32') {
    const windowsRoot =
      process.env.SystemRoot !== undefined && isAbsolute(process.env.SystemRoot)
        ? process.env.SystemRoot
        : 'C:\\Windows';
    const taskkill = join(windowsRoot, 'System32', 'taskkill.exe');
    await new Promise<void>((resolveTermination) => {
      const killer = spawn(taskkill, ['/pid', String(processId), '/t'], {
        env: safeEnvironment(undefined),
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolveTermination());
      killer.once('close', () => resolveTermination());
    });
    await wait(graceMs);
    await new Promise<void>((resolveTermination) => {
      const killer = spawn(taskkill, ['/pid', String(processId), '/t', '/f'], {
        env: safeEnvironment(undefined),
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolveTermination());
      killer.once('close', () => resolveTermination());
    });
    return;
  }

  try {
    process.kill(-processId, 'SIGTERM');
  } catch {
    // The group may already have exited.
  }
  await wait(graceMs);
  try {
    process.kill(-processId, 'SIGKILL');
  } catch {
    // The group may already have exited.
  }
}

export function createTutorialMediaProcessRunner(
  runnerOptions: TutorialMediaProcessRunnerOptions = {},
): TutorialMediaProcessRunner {
  const terminationGraceMs = positiveSafeInteger(
    runnerOptions.terminationGraceMs ?? defaultTerminationGraceMs,
  );
  const activeRuns = new Set<{
    completion: Promise<unknown>;
    terminate(reason: TutorialMediaProcessErrorCode): Promise<void>;
  }>();
  let closed = false;
  let closing: Promise<void> | undefined;

  async function run(
    command: TutorialMediaProcessCommand,
    options: TutorialMediaProcessRunOptions,
  ): Promise<TutorialMediaProcessResult> {
    if (closed) throw new TutorialMediaProcessError('runner_closed');
    validateCommand(command);
    const timeoutMs = positiveSafeInteger(options.timeoutMs);
    const maximumOutputBytes = positiveSafeInteger(
      options.maximumOutputBytes ?? defaultMaximumOutputBytes,
    );
    if (options.signal?.aborted) throw new TutorialMediaProcessError('aborted');

    runnerOptions.onInvocation?.({
      ...command,
      args: command.args === undefined ? undefined : [...command.args],
      environment: command.environment === undefined ? undefined : { ...command.environment },
      stdin: command.stdin instanceof Uint8Array ? Uint8Array.from(command.stdin) : command.stdin,
    });

    let child: ChildProcess;
    try {
      child = spawn(command.executable, [...(command.args ?? [])], {
        cwd: command.cwd,
        detached: process.platform !== 'win32',
        env: safeEnvironment(command.environment),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      throw new TutorialMediaProcessError('spawn_failed');
    }

    let terminateReason: TutorialMediaProcessErrorCode | undefined;
    let terminationStarted: Promise<void> | undefined;
    const requestTermination = (reason: TutorialMediaProcessErrorCode) => {
      terminateReason ??= reason;
      terminationStarted ??= terminateProcessTree(child, terminationGraceMs);
      return terminationStarted;
    };
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let combinedOutputBytes = 0;

    const completion = new Promise<TutorialMediaProcessResult>((resolveRun, rejectRun) => {
      const timeout = setTimeout(() => requestTermination('timed_out'), timeoutMs);
      const abort = () => requestTermination('aborted');
      options.signal?.addEventListener('abort', abort, { once: true });

      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        combinedOutputBytes += chunk.byteLength;
        if (combinedOutputBytes > maximumOutputBytes) {
          requestTermination('output_limit_exceeded');
          return;
        }
        target.push(chunk);
      };
      child.stdout?.on('data', collect(stdoutChunks));
      child.stderr?.on('data', collect(stderrChunks));
      child.once('error', () => {
        terminateReason ??= 'spawn_failed';
      });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (terminateReason !== undefined) {
          rejectRun(new TutorialMediaProcessError(terminateReason));
          return;
        }
        if (exitCode === null || exitCode !== 0) {
          rejectRun(new TutorialMediaProcessError('process_failed'));
          return;
        }
        resolveRun({
          exitCode,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
        });
      });

      child.stdin?.once('error', () => requestTermination('stdin_failed'));
      child.stdin?.end(command.stdin);
    });
    const active = { completion, terminate: requestTermination };
    activeRuns.add(active);
    try {
      return await completion;
    } finally {
      await terminationStarted?.catch(() => undefined);
      activeRuns.delete(active);
    }
  }

  async function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true;
    closing = (async () => {
      const runs = [...activeRuns];
      const completions = Promise.allSettled(runs.map(({ completion }) => completion));
      await Promise.all(runs.map((run) => run.terminate('runner_closed')));
      await completions;
    })();
    return closing;
  }

  return { close, run };
}
