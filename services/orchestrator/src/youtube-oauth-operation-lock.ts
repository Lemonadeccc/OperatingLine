import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const accountIdPattern = /^youtube:[a-f0-9]{64}$/u;
const contenderFileSizeLimitBytes = 4_096;
const defaultAcquireTimeoutMs = 180_000;
const defaultCorruptContenderStaleAfterMs = 300_000;
const defaultPollIntervalMs = 25;

interface YouTubeOAuthOperationLockOwner {
  readonly createdAtMs: number;
  readonly nonce: string;
  readonly processId: number;
  readonly ticket?: number;
}

interface ContenderFile {
  readonly fileName: string;
  readonly filePath: string;
  readonly kind: 'choosing' | 'ticket';
  readonly owner: YouTubeOAuthOperationLockOwner;
}

export interface YouTubeOAuthOperationLock {
  runExclusive<Result>(accountId: string, operation: () => Promise<Result>): Promise<Result>;
}

export interface YouTubeOAuthOperationLockOptions {
  readonly acquireTimeoutMs?: number;
  readonly baseDirectory?: string;
  readonly isProcessAlive?: (processId: number) => boolean;
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
  readonly processId?: number;
  readonly staleAfterMs?: number;
}

export class YouTubeOAuthOperationLockError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'YouTubeOAuthOperationLockError';
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new YouTubeOAuthOperationLockError(`${label} must be a positive safe integer.`);
  }
  return resolved;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    );
  }
}

function accountKey(accountId: string): string {
  if (!accountIdPattern.test(accountId)) {
    throw new YouTubeOAuthOperationLockError('The YouTube OAuth credential account ID is invalid.');
  }
  return createHash('sha256').update(accountId, 'utf8').digest('hex');
}

function contenderPattern(account: string): RegExp {
  return new RegExp(`^${account}\\.(choosing|ticket)\\.([0-9]{16}\\.)?([a-f0-9]{32})\\.json$`, 'u');
}

function parseOwner(
  value: unknown,
  kind: 'choosing' | 'ticket',
): YouTubeOAuthOperationLockOwner | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(candidate.processId) ||
    (candidate.processId as number) <= 0 ||
    !Number.isSafeInteger(candidate.createdAtMs) ||
    (candidate.createdAtMs as number) < 0 ||
    typeof candidate.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(candidate.nonce)
  ) {
    return null;
  }
  if (
    kind === 'ticket' &&
    (!Number.isSafeInteger(candidate.ticket) || (candidate.ticket as number) <= 0)
  ) {
    return null;
  }
  return {
    createdAtMs: candidate.createdAtMs as number,
    nonce: candidate.nonce,
    processId: candidate.processId as number,
    ...(kind === 'ticket' ? { ticket: candidate.ticket as number } : {}),
  };
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function publishJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const publishingPath = `${filePath}.publishing-${randomUUID()}`;
  try {
    await writeFile(publishingPath, JSON.stringify(value), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(publishingPath, filePath);
  } finally {
    await rm(publishingPath, { force: true }).catch(() => undefined);
  }
}

function ticketPrecedes(
  first: YouTubeOAuthOperationLockOwner,
  second: YouTubeOAuthOperationLockOwner,
) {
  if (first.ticket !== second.ticket) {
    return (first.ticket ?? Number.MAX_SAFE_INTEGER) < (second.ticket ?? Number.MAX_SAFE_INTEGER);
  }
  return first.nonce < second.nonce;
}

export function createYouTubeOAuthOperationLock(
  options: YouTubeOAuthOperationLockOptions = {},
): YouTubeOAuthOperationLock {
  const acquireTimeoutMs = positiveInteger(
    options.acquireTimeoutMs,
    defaultAcquireTimeoutMs,
    'acquireTimeoutMs',
  );
  const staleAfterMs = positiveInteger(
    options.staleAfterMs,
    defaultCorruptContenderStaleAfterMs,
    'staleAfterMs',
  );
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs,
    defaultPollIntervalMs,
    'pollIntervalMs',
  );
  const currentProcessId = positiveInteger(options.processId, process.pid, 'processId');
  const currentTime = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const userId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const rootDirectory = join(
    options.baseDirectory ?? tmpdir(),
    `operatingline-youtube-oauth-locks-${userId ?? 'current-user'}`,
  );

  async function prepareRoot(): Promise<void> {
    try {
      await mkdir(rootDirectory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw new YouTubeOAuthOperationLockError(
          'Could not create the private YouTube OAuth operation-lock directory.',
          { cause: error },
        );
      }
    }

    let stats;
    try {
      stats = await lstat(rootDirectory);
    } catch (error) {
      throw new YouTubeOAuthOperationLockError(
        'Could not inspect the private YouTube OAuth operation-lock directory.',
        { cause: error },
      );
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new YouTubeOAuthOperationLockError(
        'The private YouTube OAuth operation-lock path must be a real directory.',
      );
    }
    if (userId !== undefined && stats.uid !== userId) {
      throw new YouTubeOAuthOperationLockError(
        'The private YouTube OAuth operation-lock directory is owned by another user.',
      );
    }
    if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
      throw new YouTubeOAuthOperationLockError(
        'The private YouTube OAuth operation-lock directory must not be accessible by other users.',
      );
    }
  }

  async function inspectContenders(account: string): Promise<ContenderFile[]> {
    const pattern = contenderPattern(account);
    const entries = await readdir(rootDirectory);
    const contenders: ContenderFile[] = [];
    for (const fileName of entries) {
      const match = pattern.exec(fileName);
      if (match === null) {
        continue;
      }
      const kind = match[1] as 'choosing' | 'ticket';
      const filePath = join(rootDirectory, fileName);
      let stats;
      try {
        stats = await lstat(filePath);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > contenderFileSizeLimitBytes) {
        if (currentTime() - stats.mtimeMs >= staleAfterMs) {
          await rm(filePath, { force: true });
          continue;
        }
        throw new YouTubeOAuthOperationLockError(
          'A malformed YouTube OAuth operation-lock contender is still within its safety window.',
        );
      }
      let owner: YouTubeOAuthOperationLockOwner | null = null;
      try {
        owner = parseOwner(JSON.parse(await readFile(filePath, 'utf8')), kind);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
      }
      const fileShapeIsValid =
        (kind === 'choosing' && match[2] === undefined) ||
        (kind === 'ticket' && match[2] !== undefined);
      if (!fileShapeIsValid || owner === null || owner.nonce !== match[3]) {
        if (currentTime() - stats.mtimeMs >= staleAfterMs) {
          await rm(filePath, { force: true });
          continue;
        }
        throw new YouTubeOAuthOperationLockError(
          'A malformed YouTube OAuth operation-lock contender is still within its safety window.',
        );
      }
      const fileTicket = kind === 'ticket' ? Number(match[2]?.slice(0, -1)) : undefined;
      if (kind === 'ticket' && owner.ticket !== fileTicket) {
        if (currentTime() - stats.mtimeMs >= staleAfterMs) {
          await rm(filePath, { force: true });
          continue;
        }
        throw new YouTubeOAuthOperationLockError(
          'A malformed YouTube OAuth operation-lock contender is still within its safety window.',
        );
      }
      if (owner.processId !== currentProcessId && !isProcessAlive(owner.processId)) {
        await rm(filePath, { force: true });
        continue;
      }
      contenders.push({ fileName, filePath, kind, owner });
    }
    return contenders;
  }

  async function acquire(accountId: string): Promise<string> {
    const account = accountKey(accountId);
    await prepareRoot();
    const startedAtMs = currentTime();
    const nonce = randomUUID().replaceAll('-', '');
    const choosingFileName = `${account}.choosing.${nonce}.json`;
    const choosingFilePath = join(rootDirectory, choosingFileName);
    const owner = { createdAtMs: startedAtMs, nonce, processId: currentProcessId };
    await publishJsonAtomically(choosingFilePath, owner);

    let ticketFilePath: string | undefined;
    try {
      const initialContenders = await inspectContenders(account);
      const highestTicket = initialContenders.reduce(
        (highest, contender) => Math.max(highest, contender.owner.ticket ?? 0),
        0,
      );
      if (highestTicket >= Number.MAX_SAFE_INTEGER) {
        throw new YouTubeOAuthOperationLockError(
          'The YouTube OAuth operation-lock ticket is exhausted.',
        );
      }
      const ticket = highestTicket + 1;
      const ticketOwner = { ...owner, ticket };
      const paddedTicket = String(ticket).padStart(16, '0');
      ticketFilePath = join(rootDirectory, `${account}.ticket.${paddedTicket}.${nonce}.json`);
      await publishJsonAtomically(ticketFilePath, ticketOwner);
      await rm(choosingFilePath);

      while (true) {
        const contenders = await inspectContenders(account);
        const anotherIsChoosing = contenders.some(
          (contender) => contender.kind === 'choosing' && contender.owner.nonce !== nonce,
        );
        const predecessorExists = contenders.some(
          (contender) =>
            contender.kind === 'ticket' &&
            contender.owner.nonce !== nonce &&
            ticketPrecedes(contender.owner, ticketOwner),
        );
        if (!anotherIsChoosing && !predecessorExists) {
          return ticketFilePath;
        }
        if (currentTime() - startedAtMs >= acquireTimeoutMs) {
          throw new YouTubeOAuthOperationLockError(
            'Timed out while waiting for another YouTube OAuth authorization operation.',
          );
        }
        await delay(pollIntervalMs);
      }
    } catch (error) {
      await Promise.all([
        rm(choosingFilePath, { force: true }).catch(() => undefined),
        ...(ticketFilePath === undefined
          ? []
          : [rm(ticketFilePath, { force: true }).catch(() => undefined)]),
      ]);
      if (error instanceof YouTubeOAuthOperationLockError) {
        throw error;
      }
      throw new YouTubeOAuthOperationLockError(
        'Could not acquire the YouTube OAuth operation lock.',
        { cause: error },
      );
    }
  }

  return {
    async runExclusive<Result>(
      accountId: string,
      operation: () => Promise<Result>,
    ): Promise<Result> {
      const ticketFilePath = await acquire(accountId);
      try {
        return await operation();
      } finally {
        await rm(ticketFilePath, { force: true });
      }
    },
  };
}
