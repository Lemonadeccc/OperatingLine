import { randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const datasetWriteLockDirectoryName = '.human-eval-write.lock';
const datasetWriteLockTicketPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const datasetWriteLockTemporaryPattern = /^\..+\.tmp$/u;

export class HumanEvalDatasetBusyError extends Error {
  constructor(readonly lockPath: string) {
    super(`Human Eval dataset is already being changed: ${lockPath}`);
    this.name = 'HumanEvalDatasetBusyError';
  }
}

interface DatasetWriteLockRecord {
  readonly pid: number;
  readonly acquiredAt: string;
}

function lockRecordBytes(): string {
  return `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`;
}

function contentionDelayMilliseconds(ticketId: string, attempt: number): number {
  return 1 + (Number.parseInt(ticketId.slice(0, 8), 16) % 17) + attempt * 17;
}

async function waitForContentionRetry(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function lockTicketNames(lockDirectory: string): Promise<readonly string[]> {
  const entries = await readdir(lockDirectory, { withFileTypes: true });
  const unexpected = entries.filter(
    (entry) =>
      !datasetWriteLockTicketPattern.test(entry.name) &&
      !datasetWriteLockTemporaryPattern.test(entry.name),
  );
  if (unexpected.length > 0) {
    throw new Error('Human Eval dataset lock directory contains an unexpected entry');
  }
  return entries
    .filter((entry) => datasetWriteLockTicketPattern.test(entry.name))
    .map((entry) => entry.name);
}

async function safeLockTicketMetadata(path: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || !currentUserOwns(metadata.uid)) {
    throw new Error('Human Eval dataset lock ticket is not a safe current-user regular file');
  }
  return metadata;
}

async function readLockRecord(path: string): Promise<DatasetWriteLockRecord> {
  try {
    await safeLockTicketMetadata(path);
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'acquiredAt,pid' ||
      !Number.isSafeInteger(value['pid']) ||
      Number(value['pid']) <= 0 ||
      typeof value['acquiredAt'] !== 'string' ||
      !Number.isFinite(Date.parse(value['acquiredAt']))
    ) {
      throw new Error('invalid lock record');
    }
    return { pid: Number(value['pid']), acquiredAt: value['acquiredAt'] };
  } catch (error) {
    throw new Error('Human Eval dataset lock cannot be safely recovered', { cause: error });
  }
}

async function acquireDatasetWriteTicket(
  datasetDirectory: string,
  lockDirectory: string,
): Promise<string> {
  const maximumAttempts = 3;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const ticketId = randomUUID();
    const ticketPath = resolve(lockDirectory, `${ticketId}.json`);
    await writeHumanEvalFileAtomicExclusive(ticketPath, lockRecordBytes(), datasetDirectory);
    let acquired = false;
    try {
      const tickets = await lockTicketNames(lockDirectory);
      let stableSnapshot = true;
      try {
        await Promise.all(
          tickets.map((name) => safeLockTicketMetadata(resolve(lockDirectory, name))),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        stableSnapshot = false;
      }
      if (stableSnapshot && tickets.every((name) => resolve(lockDirectory, name) === ticketPath)) {
        acquired = true;
        return ticketPath;
      }
    } finally {
      if (!acquired) await rm(ticketPath, { force: true });
    }
    if (attempt + 1 < maximumAttempts) {
      await waitForContentionRetry(contentionDelayMilliseconds(ticketId, attempt));
    }
  }
  throw new HumanEvalDatasetBusyError(lockDirectory);
}

function currentUserOwns(uid: number): boolean {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

async function assertExistingAncestorsAreDirectories(root: string, path: string): Promise<void> {
  const relativePath = relative(root, path);
  let current = root;
  for (const segment of relativePath.split(/[\\/]/u).filter((part) => part !== '')) {
    current = resolve(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Human Eval private path contains a non-directory link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

/** Creates (or tightens) a directory used for unredacted Human Eval material. */
export async function preparePrivateHumanEvalDirectory(
  pathInput: string,
  confinementRootInput?: string,
): Promise<string> {
  const path = resolve(pathInput);
  const confinementRoot = resolve(confinementRootInput ?? path);
  if (!isWithin(confinementRoot, path)) {
    throw new Error(`Human Eval private path escapes its configured root: ${path}`);
  }
  await assertExistingAncestorsAreDirectories(confinementRoot, path);
  await mkdir(path, { recursive: true, mode: privateDirectoryMode });
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Human Eval private path is not a physical directory: ${path}`);
  }
  const [physicalRoot, physicalPath] = await Promise.all([
    realpath(confinementRoot),
    realpath(path),
  ]);
  if (!isWithin(physicalRoot, physicalPath)) {
    throw new Error(`Human Eval private path resolves outside its configured root: ${path}`);
  }
  if (!currentUserOwns(metadata.uid)) {
    throw new Error(`Human Eval private directory is not owned by the current user: ${path}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    await chmod(path, privateDirectoryMode);
  }
  return path;
}

/**
 * Writes one complete file without overwriting an existing path. A same-directory hard link is
 * the no-replace commit point; a crash before it can leave only an ignored temporary file.
 */
export async function writeHumanEvalFileAtomicExclusive(
  pathInput: string,
  bytes: string | Uint8Array,
  confinementRootInput?: string,
): Promise<void> {
  const path = resolve(pathInput);
  const directory = await preparePrivateHumanEvalDirectory(dirname(path), confinementRootInput);
  if (basename(path) !== relative(directory, path)) {
    throw new Error(
      `Human Eval file path must be a direct child of its private directory: ${path}`,
    );
  }
  const temporaryPath = resolve(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', privateFileMode);
  let closed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    closed = true;
    await link(temporaryPath, path);
  } finally {
    if (!closed) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

/** Serializes cooperating capture/review writers across processes for one dataset directory. */
export async function withHumanEvalDatasetWriteLock<T>(
  datasetDirectoryInput: string,
  operation: () => Promise<T>,
): Promise<T> {
  const datasetDirectory = resolve(datasetDirectoryInput);
  const lockDirectory = await preparePrivateHumanEvalDirectory(
    resolve(datasetDirectory, datasetWriteLockDirectoryName),
    datasetDirectory,
  );
  const ticketPath = await acquireDatasetWriteTicket(datasetDirectory, lockDirectory);
  try {
    return await operation();
  } finally {
    await rm(ticketPath, { force: true });
  }
}

/**
 * Removes a complete lock only when its recorded process no longer exists. This is deliberately
 * explicit: malformed locks and permission-denied process checks fail closed.
 */
export async function recoverStaleHumanEvalDatasetWriteLock(
  datasetDirectoryInput: string,
): Promise<boolean> {
  const lockDirectory = resolve(datasetDirectoryInput, datasetWriteLockDirectoryName);
  const metadata = await lstat(lockDirectory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (metadata === null) return false;
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || !currentUserOwns(metadata.uid)) {
    throw new Error('Human Eval dataset lock is not a safe current-user directory');
  }
  const ticketPaths = (await lockTicketNames(lockDirectory)).map((name) =>
    resolve(lockDirectory, name),
  );
  if (ticketPaths.length === 0) return false;
  const staleTicketPaths: string[] = [];
  for (const ticketPath of ticketPaths) {
    const record = await readLockRecord(ticketPath);
    try {
      process.kill(record.pid, 0);
      throw new HumanEvalDatasetBusyError(lockDirectory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (error instanceof HumanEvalDatasetBusyError || code === 'EPERM') {
        throw new HumanEvalDatasetBusyError(lockDirectory);
      }
      if (code !== 'ESRCH') throw error;
    }
    staleTicketPaths.push(ticketPath);
  }
  await Promise.all(staleTicketPaths.map((path) => rm(path, { force: true })));
  return staleTicketPaths.length > 0;
}
