import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createYouTubeOAuthOperationLock,
  YouTubeOAuthOperationLockError,
} from '../../../services/orchestrator/src/youtube-oauth-operation-lock.js';

const accountId = `youtube:${'a'.repeat(64)}`;
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'operatingline-oauth-lock-test-'));
  temporaryRoots.push(root);
  return root;
}

function lockRoot(baseDirectory: string): string {
  const userId = typeof process.getuid === 'function' ? process.getuid() : 'current-user';
  return join(baseDirectory, `operatingline-youtube-oauth-locks-${userId}`);
}

function accountKey(): string {
  return createHash('sha256').update(accountId, 'utf8').digest('hex');
}

function runLockWorker(baseDirectory: string, criticalDirectory: string): Promise<void> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'services/orchestrator/src/youtube-oauth-operation-lock.ts'),
  ).href;
  const source = `
    import { mkdir, rm } from 'node:fs/promises';
    import { setTimeout as delay } from 'node:timers/promises';
    import { createYouTubeOAuthOperationLock } from ${JSON.stringify(moduleUrl)};
    const lock = createYouTubeOAuthOperationLock({
      acquireTimeoutMs: 20_000,
      baseDirectory: ${JSON.stringify(baseDirectory)},
      pollIntervalMs: 5,
    });
    await lock.runExclusive(${JSON.stringify(accountId)}, async () => {
      await mkdir(${JSON.stringify(criticalDirectory)});
      try {
        await delay(15);
      } finally {
        await rm(${JSON.stringify(criticalDirectory)}, { force: true, recursive: true });
      }
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', source],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`OAuth lock worker exited ${exitCode}: ${stderr.slice(0, 8_192)}`));
    });
  });
}

async function seedTicket(
  baseDirectory: string,
  options: { nonce: string; processId: number; ticket: number },
): Promise<string> {
  const root = lockRoot(baseDirectory);
  await mkdir(root, { mode: 0o700, recursive: true });
  const fileName = `${accountKey()}.ticket.${String(options.ticket).padStart(16, '0')}.${options.nonce}.json`;
  await writeFile(join(root, fileName), JSON.stringify({ ...options, createdAtMs: 1 }), {
    mode: 0o600,
  });
  return fileName;
}

async function seedChoosing(
  baseDirectory: string,
  options: { nonce: string; processId: number },
): Promise<string> {
  const root = lockRoot(baseDirectory);
  await mkdir(root, { mode: 0o700, recursive: true });
  const fileName = `${accountKey()}.choosing.${options.nonce}.json`;
  await writeFile(join(root, fileName), JSON.stringify({ ...options, createdAtMs: 1 }), {
    mode: 0o600,
  });
  return fileName;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('YouTube OAuth cross-process operation lock', () => {
  it('serializes authorization mutations for the same credential account', async () => {
    const baseDirectory = await temporaryRoot();
    const firstLock = createYouTubeOAuthOperationLock({ baseDirectory });
    const secondLock = createYouTubeOAuthOperationLock({ baseDirectory });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = firstLock.runExclusive(accountId, async () => {
      order.push('first-enter');
      await firstGate;
      order.push('first-exit');
    });
    await vi.waitFor(() => expect(order).toEqual(['first-enter']));
    const second = secondLock.runExclusive(accountId, async () => {
      order.push('second-enter');
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(order).toEqual(['first-enter']);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-enter', 'first-exit', 'second-enter']);
  });

  it(
    'atomically publishes contenders across independent processes',
    { timeout: 30_000 },
    async () => {
      const baseDirectory = await temporaryRoot();
      const criticalDirectory = join(baseDirectory, 'critical-section');

      await Promise.all(
        Array.from({ length: 16 }, () => runLockWorker(baseDirectory, criticalDirectory)),
      );

      await expect(readdir(lockRoot(baseDirectory))).resolves.toEqual([]);
    },
  );

  it('releases its unique contender after an operation fails', async () => {
    const baseDirectory = await temporaryRoot();
    const lock = createYouTubeOAuthOperationLock({ baseDirectory });

    await expect(
      lock.runExclusive(accountId, async () => {
        throw new Error('expected operation failure');
      }),
    ).rejects.toThrow('expected operation failure');
    await expect(lock.runExclusive(accountId, async () => 'recovered')).resolves.toBe('recovered');
    await expect(readdir(lockRoot(baseDirectory))).resolves.toEqual([]);
  });

  it('removes only an abandoned contender whose owner process is gone', async () => {
    const baseDirectory = await temporaryRoot();
    const abandonedFile = await seedTicket(baseDirectory, {
      nonce: 'a'.repeat(32),
      processId: 999_999,
      ticket: 1,
    });
    const lock = createYouTubeOAuthOperationLock({
      baseDirectory,
      isProcessAlive: (processId) => processId !== 999_999,
    });

    await expect(lock.runExclusive(accountId, async () => 'recovered')).resolves.toBe('recovered');
    expect(await readdir(lockRoot(baseDirectory))).not.toContain(abandonedFile);
  });

  it('never reclaims a live owner merely because it is older than the stale threshold', async () => {
    const baseDirectory = await temporaryRoot();
    await seedTicket(baseDirectory, {
      nonce: 'b'.repeat(32),
      processId: 888_888,
      ticket: 1,
    });
    const operation = vi.fn(async () => undefined);
    const lock = createYouTubeOAuthOperationLock({
      acquireTimeoutMs: 50,
      baseDirectory,
      isProcessAlive: (processId) => processId === 888_888,
      pollIntervalMs: 5,
      staleAfterMs: 1,
    });

    await expect(lock.runExclusive(accountId, operation)).rejects.toThrow('Timed out');
    expect(operation).not.toHaveBeenCalled();
    expect(await readdir(lockRoot(baseDirectory))).toContain(
      `${accountKey()}.ticket.0000000000000001.${'b'.repeat(32)}.json`,
    );
  });

  it('keeps three contenders mutually exclusive while cleaning a distinct dead ticket', async () => {
    const baseDirectory = await temporaryRoot();
    const deadFile = await seedTicket(baseDirectory, {
      nonce: 'c'.repeat(32),
      processId: 777_777,
      ticket: 1,
    });
    const locks = Array.from({ length: 3 }, () =>
      createYouTubeOAuthOperationLock({
        baseDirectory,
        isProcessAlive: (processId) => processId !== 777_777,
      }),
    );
    let active = 0;
    let maximumActive = 0;

    await Promise.all(
      locks.map((lock) =>
        lock.runExclusive(accountId, async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
        }),
      ),
    );

    expect(maximumActive).toBe(1);
    expect(await readdir(lockRoot(baseDirectory))).not.toContain(deadFile);
    expect(await readdir(lockRoot(baseDirectory))).toEqual([]);
  });

  it('waits safely while an immutable choosing file overlaps its published ticket', async () => {
    const baseDirectory = await temporaryRoot();
    const nonce = 'e'.repeat(32);
    const processId = 666_666;
    const choosingFile = await seedChoosing(baseDirectory, { nonce, processId });
    const ticketFile = await seedTicket(baseDirectory, { nonce, processId, ticket: 1 });
    const root = lockRoot(baseDirectory);
    const lock = createYouTubeOAuthOperationLock({
      acquireTimeoutMs: 1_000,
      baseDirectory,
      isProcessAlive: (candidate) => candidate === processId,
      pollIntervalMs: 5,
    });

    const acquired = lock.runExclusive(accountId, async () => 'acquired');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rm(join(root, choosingFile));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rm(join(root, ticketFile));

    await expect(acquired).resolves.toBe('acquired');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('removes only the unique stale malformed contender file', async () => {
    const baseDirectory = await temporaryRoot();
    const root = lockRoot(baseDirectory);
    await mkdir(root, { mode: 0o700 });
    const corruptFile = `${accountKey()}.ticket.0000000000000001.${'d'.repeat(32)}.json`;
    const unrelatedFile = 'unrelated.json';
    await writeFile(join(root, corruptFile), '{not-json', { mode: 0o600 });
    await writeFile(join(root, unrelatedFile), 'keep', { mode: 0o600 });
    await utimes(join(root, corruptFile), new Date(0), new Date(0));
    const lock = createYouTubeOAuthOperationLock({ baseDirectory, staleAfterMs: 1 });

    await expect(lock.runExclusive(accountId, async () => 'recovered')).resolves.toBe('recovered');
    expect(await readdir(root)).toEqual([unrelatedFile]);
  });

  it.skipIf(process.platform === 'win32')(
    'creates a private dedicated root without changing caller-directory permissions',
    async () => {
      const baseDirectory = await temporaryRoot();
      const before = (await lstat(baseDirectory)).mode & 0o777;
      const lock = createYouTubeOAuthOperationLock({ baseDirectory });

      await lock.runExclusive(accountId, async () => undefined);

      expect((await lstat(baseDirectory)).mode & 0o777).toBe(before);
      expect((await lstat(lockRoot(baseDirectory))).mode & 0o777).toBe(0o700);
    },
  );

  it('rejects unsafe account paths before running an operation', async () => {
    const baseDirectory = await temporaryRoot();
    const operation = vi.fn(async () => undefined);
    const lock = createYouTubeOAuthOperationLock({ baseDirectory });

    await expect(lock.runExclusive('../unsafe', operation)).rejects.toBeInstanceOf(
      YouTubeOAuthOperationLockError,
    );
    expect(operation).not.toHaveBeenCalled();
  });
});
