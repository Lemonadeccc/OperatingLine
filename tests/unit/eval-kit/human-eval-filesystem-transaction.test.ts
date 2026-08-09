import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HumanEvalDatasetBusyError,
  preparePrivateHumanEvalDirectory,
  recoverStaleHumanEvalDatasetWriteLock,
  withHumanEvalDatasetWriteLock,
  writeHumanEvalFileAtomicExclusive,
} from '@operatingline/eval-kit';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-transaction-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Human Eval filesystem transactions', () => {
  it('stores private files atomically and never overwrites an existing record', async () => {
    const root = await temporaryDirectory();
    const directory = await preparePrivateHumanEvalDirectory(join(root, 'records'));
    const path = join(directory, 'sealed.json');

    await writeHumanEvalFileAtomicExclusive(path, 'first');
    await expect(writeHumanEvalFileAtomicExclusive(path, 'second')).rejects.toMatchObject({
      code: 'EEXIST',
    });

    expect(await readFile(path, 'utf8')).toBe('first');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects a concurrent writer and releases its dataset lock afterward', async () => {
    const root = await temporaryDirectory();
    let release!: () => void;
    let markEntered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const first = withHumanEvalDatasetWriteLock(root, async () => {
      markEntered();
      return held;
    });
    await entered;
    await expect(withHumanEvalDatasetWriteLock(root, async () => undefined)).rejects.toBeInstanceOf(
      HumanEvalDatasetBusyError,
    );
    release();
    await first;

    await expect(
      withHumanEvalDatasetWriteLock(root, async () => {
        await writeFile(join(root, 'completed'), 'yes');
      }),
    ).resolves.toBeUndefined();
  });

  it('recovers only a complete lock whose recorded process no longer exists', async () => {
    const root = await temporaryDirectory();
    const lockDirectory = join(root, '.human-eval-write.lock');
    await mkdir(lockDirectory);
    const staleTicketPath = join(lockDirectory, '00000000-0000-4000-8000-000000000001.json');
    await writeFile(
      staleTicketPath,
      `${JSON.stringify({ pid: 2_147_483_647, acquiredAt: '2026-08-09T00:00:00.000Z' })}\n`,
    );

    await expect(recoverStaleHumanEvalDatasetWriteLock(root)).resolves.toBe(true);
    await expect(recoverStaleHumanEvalDatasetWriteLock(root)).resolves.toBe(false);

    const liveTicketPath = join(lockDirectory, '00000000-0000-4000-8000-000000000002.json');
    await writeFile(
      liveTicketPath,
      `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
    );
    await expect(recoverStaleHumanEvalDatasetWriteLock(root)).rejects.toBeInstanceOf(
      HumanEvalDatasetBusyError,
    );
  });

  it('cannot delete a newly acquired writer while stale tickets are recovered concurrently', async () => {
    const root = await temporaryDirectory();
    const lockDirectory = join(root, '.human-eval-write.lock');
    await mkdir(lockDirectory);
    await Promise.all(
      [1, 2].map((suffix) =>
        writeFile(
          join(lockDirectory, `00000000-0000-4000-8000-00000000000${suffix}.json`),
          `${JSON.stringify({ pid: 2_147_483_647, acquiredAt: '2026-08-09T00:00:00.000Z' })}\n`,
        ),
      ),
    );

    const recoveryResults = await Promise.allSettled([
      recoverStaleHumanEvalDatasetWriteLock(root),
      recoverStaleHumanEvalDatasetWriteLock(root),
    ]);
    expect(recoveryResults.some((result) => result.status === 'fulfilled')).toBe(true);

    let release!: () => void;
    let markEntered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const writer = withHumanEvalDatasetWriteLock(root, async () => {
      markEntered();
      await held;
    });
    await entered;

    const whileLive = await Promise.allSettled([
      recoverStaleHumanEvalDatasetWriteLock(root),
      recoverStaleHumanEvalDatasetWriteLock(root),
    ]);
    expect(
      whileLive.every(
        (result) =>
          result.status === 'rejected' && result.reason instanceof HumanEvalDatasetBusyError,
      ),
    ).toBe(true);
    await expect(withHumanEvalDatasetWriteLock(root, async () => undefined)).rejects.toBeInstanceOf(
      HumanEvalDatasetBusyError,
    );
    release();
    await writer;
  });

  it('rejects a private output directory symlink before writing outside the dataset', async () => {
    if (process.platform === 'win32') return;
    const root = await temporaryDirectory();
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'records'), 'dir');

    await expect(preparePrivateHumanEvalDirectory(join(root, 'records'), root)).rejects.toThrow(
      /non-directory link|physical directory/,
    );
    await expect(readdir(outside)).resolves.toEqual([]);
  });
});
