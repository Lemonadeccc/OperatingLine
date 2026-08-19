import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTutorialMediaProcessRunner,
  runTutorialMediaProcessWithOutputFile,
  TutorialMediaProcessError,
} from '../../../services/orchestrator/src/tutorial-media-process.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function command(script: string, args: readonly string[] = []) {
  return {
    executable: process.execPath,
    args: ['-e', script, ...args],
    cwd: process.cwd(),
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
  await promise.catch((error: unknown) => {
    expect(error).toBeInstanceOf(TutorialMediaProcessError);
    expect(String(error)).not.toContain(process.execPath);
  });
}

async function waitForProcessExit(processId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(processId, 0);
    } catch {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return false;
}

describe('tutorial media process runner', () => {
  it('runs without a shell and captures bounded stdout and stderr', async () => {
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    const result = await runner.run(
      command("process.stdout.write('out'); process.stderr.write('err')"),
      { timeoutMs: 1_000 },
    );

    expect(Buffer.from(result.stdout).toString('utf8')).toBe('out');
    expect(Buffer.from(result.stderr).toString('utf8')).toBe('err');
    expect(result.exitCode).toBe(0);
    await runner.close();
  });

  it('reports a defensive copy of each validated invocation before spawning it', async () => {
    const invocations: unknown[] = [];
    const runner = createTutorialMediaProcessRunner({
      onInvocation: (invocation) => invocations.push(invocation),
      terminationGraceMs: 25,
    });
    const args = ['-e', "process.stdout.write('ok')"];
    await runner.run(
      { executable: process.execPath, args, cwd: process.cwd() },
      { timeoutMs: 1_000 },
    );
    args[1] = "process.stdout.write('changed')";

    expect(invocations).toEqual([
      {
        args: ['-e', "process.stdout.write('ok')"],
        cwd: process.cwd(),
        environment: undefined,
        executable: process.execPath,
        stdin: undefined,
      },
    ]);
    await expect(
      runner.run({ executable: 'node', cwd: process.cwd() }, { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'invalid_command' });
    expect(invocations).toHaveLength(1);
    await runner.close();
  });

  it('passes bounded stdin and only explicitly safe environment variables', async () => {
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    const previousSecret = process.env.OPERATINGLINE_TEST_SECRET;
    process.env.OPERATINGLINE_TEST_SECRET = 'must-not-leak';
    try {
      const result = await runner.run(
        {
          ...command(`
            let input = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => input += chunk);
            process.stdin.on('end', () => process.stdout.write(JSON.stringify({input, secret: process.env.OPERATINGLINE_TEST_SECRET, lang: process.env.LANG})));
          `),
          stdin: 'hello',
        },
        { timeoutMs: 1_000 },
      );
      expect(JSON.parse(Buffer.from(result.stdout).toString('utf8'))).toEqual({
        input: 'hello',
        lang: process.env.LANG,
      });
    } finally {
      if (previousSecret === undefined) delete process.env.OPERATINGLINE_TEST_SECRET;
      else process.env.OPERATINGLINE_TEST_SECRET = previousSecret;
      await runner.close();
    }
  });

  it('rejects non-absolute commands and secret-shaped environment overrides', async () => {
    const runner = createTutorialMediaProcessRunner();
    await expectCode(
      runner.run({ executable: 'node', cwd: process.cwd() }, { timeoutMs: 100 }),
      'invalid_command',
    );
    await expectCode(
      runner.run(
        { ...command(''), environment: { HTTP_PROXY: 'http://secret.example' } },
        { timeoutMs: 100 },
      ),
      'invalid_command',
    );
    await runner.close();
  });

  it('returns stable errors without exposing argv, output, or filesystem paths', async () => {
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    const secret = 'sensitive-cookie-value';
    const failed = runner.run(
      command(`process.stderr.write(${JSON.stringify(secret)}); process.exit(7)`, [secret]),
      { timeoutMs: 1_000 },
    );
    await expect(failed).rejects.toMatchObject({ code: 'process_failed' });
    await failed.catch((error: unknown) => {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(process.cwd());
    });

    const missingPath = `/operatingline-does-not-exist-${secret}`;
    const spawnFailed = runner.run(
      { executable: missingPath, args: [secret], cwd: process.cwd() },
      { timeoutMs: 1_000 },
    );
    await expect(spawnFailed).rejects.toMatchObject({ code: 'spawn_failed' });
    await spawnFailed.catch((error: unknown) => {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(missingPath);
    });
    await runner.close();
  });

  it('terminates output floods at the combined stdout and stderr limit', async () => {
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    const run = runner.run(
      command(
        "setInterval(() => { process.stdout.write('x'.repeat(4096)); process.stderr.write('y'.repeat(4096)); }, 0)",
      ),
      {
        timeoutMs: 2_000,
        maximumOutputBytes: 8_192,
      },
    );
    await expectCode(run, 'output_limit_exceeded');
    await runner.close();
  });

  it('actively terminates a process that continuously exceeds its file output quota', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-output-'));
    temporaryDirectories.push(temporaryDirectory);
    const outputPath = join(temporaryDirectory, 'output.bin');
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });

    const run = runTutorialMediaProcessWithOutputFile({
      command: command(
        "const { appendFileSync } = require('node:fs'); const path = process.argv[1]; setInterval(() => appendFileSync(path, Buffer.alloc(4096)), 10)",
        [outputPath],
      ),
      maximumFileBytes: 8_192,
      outputPath,
      pollIntervalMs: 5,
      runner,
      runOptions: { timeoutMs: 2_000 },
    });

    await expectCode(run, 'output_limit_exceeded');
    expect((await readFile(outputPath)).byteLength).toBeGreaterThan(8_192);
    await runner.close();
  });

  it('rechecks fast file output, composes cancellation, and accepts a small regular file', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-output-'));
    temporaryDirectories.push(temporaryDirectory);
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    const oversizedPath = join(temporaryDirectory, 'oversized.bin');
    await expectCode(
      runTutorialMediaProcessWithOutputFile({
        command: command("require('node:fs').writeFileSync(process.argv[1], Buffer.alloc(16))", [
          oversizedPath,
        ]),
        maximumFileBytes: 8,
        outputPath: oversizedPath,
        runner,
        runOptions: { timeoutMs: 1_000 },
      }),
      'output_limit_exceeded',
    );

    const cancelledPath = join(temporaryDirectory, 'cancelled.bin');
    const controller = new AbortController();
    const cancelled = runTutorialMediaProcessWithOutputFile({
      command: command('setInterval(() => {}, 1000)'),
      maximumFileBytes: 8,
      outputPath: cancelledPath,
      runner,
      runOptions: { signal: controller.signal, timeoutMs: 1_000 },
    });
    controller.abort();
    await expectCode(cancelled, 'aborted');

    const smallPath = join(temporaryDirectory, 'small.bin');
    await expect(
      runTutorialMediaProcessWithOutputFile({
        command: command("require('node:fs').writeFileSync(process.argv[1], 'ok')", [smallPath]),
        maximumFileBytes: 8,
        outputPath: smallPath,
        runner,
        runOptions: { timeoutMs: 1_000 },
      }),
    ).resolves.toMatchObject({ exitCode: 0 });
    await runner.close();
  });

  it('terminates a process that replaces its output with an unsafe file', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-output-'));
    temporaryDirectories.push(temporaryDirectory);
    const outputPath = join(temporaryDirectory, 'output.bin');
    const targetPath = join(temporaryDirectory, 'target.bin');
    await symlink(targetPath, outputPath);
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });

    await expectCode(
      runTutorialMediaProcessWithOutputFile({
        command: command('setInterval(() => {}, 1000)'),
        maximumFileBytes: 8,
        outputPath,
        pollIntervalMs: 5,
        runner,
        runOptions: { timeoutMs: 1_000 },
      }),
      'unsafe_output',
    );
    await runner.close();
  });

  it('supports timeout, AbortSignal, and idempotent close of active runs', async () => {
    const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
    await expectCode(
      runner.run(command('setInterval(() => {}, 1000)'), { timeoutMs: 25 }),
      'timed_out',
    );

    const controller = new AbortController();
    const aborted = runner.run(command('setInterval(() => {}, 1000)'), {
      signal: controller.signal,
      timeoutMs: 2_000,
    });
    controller.abort();
    await expectCode(aborted, 'aborted');

    const active = runner.run(command('setInterval(() => {}, 1000)'), { timeoutMs: 2_000 });
    const activeAssertion = expectCode(active, 'runner_closed');
    await Promise.all([runner.close(), runner.close()]);
    await activeAssertion;
    await expectCode(runner.run(command(''), { timeoutMs: 100 }), 'runner_closed');
  });

  it.runIf(process.platform !== 'win32')(
    'terminates the complete POSIX process group',
    async () => {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-process-'));
      temporaryDirectories.push(temporaryDirectory);
      const childPidPath = join(temporaryDirectory, 'child.pid');
      const runner = createTutorialMediaProcessRunner({ terminationGraceMs: 25 });
      await expectCode(
        runner.run(
          command(
            `
            const { spawn } = require('node:child_process');
            const { writeFileSync } = require('node:fs');
            const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"]);
            writeFileSync(process.argv[1], String(child.pid));
            setInterval(() => {}, 1000);
          `,
            [childPidPath],
          ),
          { timeoutMs: 100 },
        ),
        'timed_out',
      );
      const childPid = Number(await readFile(childPidPath, 'utf8'));
      expect(await waitForProcessExit(childPid)).toBe(true);
      await runner.close();
    },
  );
});
