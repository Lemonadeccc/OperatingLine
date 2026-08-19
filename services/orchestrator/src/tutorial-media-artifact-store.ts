import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  rmdir,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const uriPrefix = 'operatingline-media://sha256/';
const digestPattern = /^[a-f0-9]{64}$/u;
const jobIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const defaultMaximumArtifactBytes = 8 * 1_024 * 1_024 * 1_024;
const defaultMaximumReadBytes = 16 * 1_024 * 1_024;
const verificationChunkBytes = 1 * 1_024 * 1_024;
const defaultStaleTemporarySessionAgeMs = 48 * 60 * 60 * 1_000;

export interface TutorialMediaArtifact {
  readonly uri: `operatingline-media://sha256/${string}`;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type TutorialMediaArtifactStoreErrorCode =
  | 'invalid_artifact_reference'
  | 'invalid_input'
  | 'artifact_too_large'
  | 'artifact_read_too_large'
  | 'artifact_not_found'
  | 'artifact_integrity_failed'
  | 'unsafe_storage'
  | 'storage_failed';

export class TutorialMediaArtifactStoreError extends Error {
  constructor(
    readonly code: TutorialMediaArtifactStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(
      code === 'invalid_artifact_reference'
        ? 'The tutorial media artifact reference is invalid.'
        : code === 'invalid_input'
          ? 'The tutorial media artifact input is invalid.'
          : code === 'artifact_too_large'
            ? 'The tutorial media artifact exceeds its size limit.'
            : code === 'artifact_read_too_large'
              ? 'The tutorial media artifact is too large for an in-memory read.'
              : code === 'artifact_not_found'
                ? 'The tutorial media artifact was not found.'
                : code === 'artifact_integrity_failed'
                  ? 'The tutorial media artifact failed its integrity check.'
                  : code === 'unsafe_storage'
                    ? 'The tutorial media artifact storage is unsafe.'
                    : 'The tutorial media artifact storage operation failed.',
      options,
    );
    this.name = 'TutorialMediaArtifactStoreError';
  }
}

export interface TutorialMediaJobStagingDirectory {
  readonly jobId: string;
  readonly path: string;
  cleanup(): Promise<void>;
}

/** Internal-only filesystem access for trusted local media adapters. */
export interface ResolvedTutorialMediaArtifact extends TutorialMediaArtifact {
  readonly path: string;
}

export interface TutorialMediaPutFileOptions {
  readonly removeSource?: boolean | undefined;
}

export interface TutorialMediaArtifactStore {
  put(source: AsyncIterable<Uint8Array>): Promise<TutorialMediaArtifact>;
  putFile(
    stagingPath: string,
    options?: TutorialMediaPutFileOptions,
  ): Promise<TutorialMediaArtifact>;
  read(reference: string): Promise<Uint8Array>;
  inspect(reference: string): Promise<TutorialMediaArtifact>;
  resolve(reference: string): Promise<ResolvedTutorialMediaArtifact>;
  use<Result>(
    reference: string,
    consumer: (verifiedReadOnlyPath: string) => Promise<Result>,
  ): Promise<Result>;
  createJobStagingDirectory(jobId: string): Promise<TutorialMediaJobStagingDirectory>;
  cleanup(): Promise<void>;
}

export interface TutorialMediaArtifactStoreOptions {
  readonly baseDirectory?: string | undefined;
  readonly maximumArtifactBytes?: number | undefined;
  readonly maximumReadBytes?: number | undefined;
  readonly staleTemporarySessionAgeMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

function artifactUri(digest: string): TutorialMediaArtifact['uri'] {
  return `${uriPrefix}${digest}`;
}

function parseReference(reference: string): string {
  if (reference.includes('\0') || isAbsolute(reference) || !reference.startsWith(uriPrefix)) {
    throw new TutorialMediaArtifactStoreError('invalid_artifact_reference');
  }
  const digest = reference.slice(uriPrefix.length);
  if (!digestPattern.test(digest)) {
    throw new TutorialMediaArtifactStoreError('invalid_artifact_reference');
  }
  return digest;
}

function positiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TutorialMediaArtifactStoreError('invalid_input');
  }
  return value;
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  await handle?.close().catch(() => undefined);
}

interface DirectoryIdentity {
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
}

export function createTutorialMediaArtifactStore(
  options: TutorialMediaArtifactStoreOptions = {},
): TutorialMediaArtifactStore {
  const maximumArtifactBytes = positiveSafeInteger(
    options.maximumArtifactBytes ?? defaultMaximumArtifactBytes,
  );
  const maximumReadBytes = positiveSafeInteger(options.maximumReadBytes ?? defaultMaximumReadBytes);
  const staleTemporarySessionAgeMs = positiveSafeInteger(
    options.staleTemporarySessionAgeMs ?? defaultStaleTemporarySessionAgeMs,
  );
  const userId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const root = join(
    options.baseDirectory ?? tmpdir(),
    `operatingline-tutorial-media-${userId ?? 'current-user'}`,
  );
  const objectsRoot = join(root, 'objects');
  const stagingRoot = join(root, 'staging');
  const temporaryRoot = join(root, 'temporary');
  const temporarySessionRoot = join(temporaryRoot, randomUUID());
  let prepared: Promise<void> | undefined;
  let rootIdentity: DirectoryIdentity | undefined;
  let objectsIdentity: DirectoryIdentity | undefined;
  let stagingIdentity: DirectoryIdentity | undefined;
  let temporaryIdentity: DirectoryIdentity | undefined;
  let temporarySessionIdentity: DirectoryIdentity | undefined;
  let temporarySessionPreparation: Promise<void> | undefined;
  const activeStaging = new Map<string, DirectoryIdentity>();
  const activeTemporary = new Set<string>();
  let stagingMutation: Promise<void> = Promise.resolve();

  function serializeStaging<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = stagingMutation.then(operation, operation);
    stagingMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function ensurePrivateDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw new TutorialMediaArtifactStoreError('storage_failed');
      }
    }
    const info = await lstat(path).catch(() => {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    });
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
    if (userId !== undefined && info.uid !== userId) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
    if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
  }

  function validatePrivateDirectoryInfo(info: Stats): void {
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      (userId !== undefined && info.uid !== userId) ||
      (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700)
    ) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
  }

  async function captureDirectoryIdentity(
    path: string,
    canonicalParent?: string,
  ): Promise<DirectoryIdentity> {
    const info = await lstat(path).catch(() => {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    });
    validatePrivateDirectoryInfo(info);
    const canonicalPath = await realpath(path).catch(() => {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    });
    if (canonicalParent !== undefined && !within(canonicalParent, canonicalPath)) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
    return {
      canonicalPath,
      dev: info.dev,
      ino: info.ino,
      uid: info.uid,
      gid: info.gid,
      mode: info.mode,
    };
  }

  async function validateDirectoryIdentity(
    path: string,
    expected: DirectoryIdentity,
    canonicalParent?: string,
  ): Promise<void> {
    const actual = await captureDirectoryIdentity(path, canonicalParent);
    if (
      actual.canonicalPath !== expected.canonicalPath ||
      actual.dev !== expected.dev ||
      actual.ino !== expected.ino ||
      actual.uid !== expected.uid ||
      actual.gid !== expected.gid ||
      actual.mode !== expected.mode
    ) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
  }

  async function validateFixedHierarchy(): Promise<void> {
    if (!rootIdentity || !objectsIdentity || !stagingIdentity || !temporaryIdentity) {
      throw new TutorialMediaArtifactStoreError('unsafe_storage');
    }
    await validateDirectoryIdentity(root, rootIdentity);
    await validateDirectoryIdentity(objectsRoot, objectsIdentity, rootIdentity.canonicalPath);
    await validateDirectoryIdentity(stagingRoot, stagingIdentity, rootIdentity.canonicalPath);
    await validateDirectoryIdentity(temporaryRoot, temporaryIdentity, rootIdentity.canonicalPath);
    await validateDirectoryIdentity(root, rootIdentity);
  }

  async function ensureTemporarySession(): Promise<void> {
    if (temporarySessionIdentity !== undefined) {
      await validateDirectoryIdentity(
        temporarySessionRoot,
        temporarySessionIdentity,
        temporaryIdentity!.canonicalPath,
      );
      return;
    }
    temporarySessionPreparation ??= (async () => {
      await validateFixedHierarchy();
      try {
        await mkdir(temporarySessionRoot, { mode: 0o700 });
      } catch {
        throw new TutorialMediaArtifactStoreError('unsafe_storage');
      }
      temporarySessionIdentity = await captureDirectoryIdentity(
        temporarySessionRoot,
        temporaryIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
    })();
    await temporarySessionPreparation;
  }

  async function prepare(): Promise<void> {
    prepared ??= (async () => {
      await ensurePrivateDirectory(root);
      await ensurePrivateDirectory(objectsRoot);
      await ensurePrivateDirectory(stagingRoot);
      await ensurePrivateDirectory(temporaryRoot);
      rootIdentity = await captureDirectoryIdentity(root);
      objectsIdentity = await captureDirectoryIdentity(objectsRoot, rootIdentity.canonicalPath);
      stagingIdentity = await captureDirectoryIdentity(stagingRoot, rootIdentity.canonicalPath);
      temporaryIdentity = await captureDirectoryIdentity(temporaryRoot, rootIdentity.canonicalPath);
    })();
    await prepared;
    await validateFixedHierarchy();
    await ensureTemporarySession();
    await validateDirectoryIdentity(
      temporarySessionRoot,
      temporarySessionIdentity!,
      temporaryIdentity!.canonicalPath,
    );
    await validateFixedHierarchy();
  }

  function objectPath(digest: string): string {
    return join(objectsRoot, digest.slice(0, 2), digest);
  }

  async function verifyObject(
    digest: string,
    captureBytes: boolean,
  ): Promise<{ bytes?: Buffer; path: string; sizeBytes: number }> {
    await prepare();
    const path = objectPath(digest);
    const prefix = dirname(path);
    let handle: FileHandle | undefined;
    try {
      await validateFixedHierarchy();
      const pathInfo = await lstat(path);
      const prefixIdentity = await captureDirectoryIdentity(prefix, objectsIdentity!.canonicalPath);
      if (
        pathInfo.isSymbolicLink() ||
        !pathInfo.isFile() ||
        pathInfo.nlink !== 1 ||
        (process.platform !== 'win32' && (pathInfo.mode & 0o777) !== 0o400)
      ) {
        throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
      }
      handle = await open(
        path,
        process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const openedInfo = await handle.stat();
      if (
        !openedInfo.isFile() ||
        openedInfo.nlink !== 1 ||
        openedInfo.size > maximumArtifactBytes ||
        (process.platform !== 'win32' && (openedInfo.mode & 0o777) !== 0o400)
      ) {
        throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
      }
      if (captureBytes && openedInfo.size > maximumReadBytes) {
        throw new TutorialMediaArtifactStoreError('artifact_read_too_large');
      }
      const postOpenPathInfo = await lstat(path);
      const canonicalPath = await realpath(path);
      if (
        postOpenPathInfo.isSymbolicLink() ||
        postOpenPathInfo.dev !== openedInfo.dev ||
        postOpenPathInfo.ino !== openedInfo.ino ||
        !within(objectsIdentity!.canonicalPath, canonicalPath)
      ) {
        throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
      }
      await validateDirectoryIdentity(prefix, prefixIdentity, objectsIdentity!.canonicalPath);
      await validateFixedHierarchy();
      const hash = createHash('sha256');
      const chunks: Buffer[] = [];
      let sizeBytes = 0;
      while (true) {
        const chunk = Buffer.allocUnsafe(
          Math.min(verificationChunkBytes, Math.max(1, openedInfo.size - sizeBytes)),
        );
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        const content = chunk.subarray(0, bytesRead);
        sizeBytes += bytesRead;
        if (sizeBytes > maximumArtifactBytes || sizeBytes > openedInfo.size) {
          throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
        }
        hash.update(content);
        if (captureBytes) chunks.push(Buffer.from(content));
      }
      const finalOpenedInfo = await handle.stat();
      const finalPathInfo = await lstat(path);
      await validateDirectoryIdentity(prefix, prefixIdentity, objectsIdentity!.canonicalPath);
      await validateFixedHierarchy();
      const actualDigest = hash.digest('hex');
      if (
        actualDigest !== digest ||
        sizeBytes !== openedInfo.size ||
        finalOpenedInfo.size !== openedInfo.size ||
        finalOpenedInfo.nlink !== 1 ||
        (process.platform !== 'win32' && (finalOpenedInfo.mode & 0o777) !== 0o400) ||
        finalOpenedInfo.dev !== finalPathInfo.dev ||
        finalOpenedInfo.ino !== finalPathInfo.ino
      ) {
        throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
      }
      return {
        ...(captureBytes ? { bytes: Buffer.concat(chunks, sizeBytes) } : {}),
        path,
        sizeBytes,
      };
    } catch (error) {
      if (error instanceof TutorialMediaArtifactStoreError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new TutorialMediaArtifactStoreError('artifact_not_found');
      }
      throw new TutorialMediaArtifactStoreError('storage_failed');
    } finally {
      await closeQuietly(handle);
    }
  }

  async function put(source: AsyncIterable<Uint8Array>): Promise<TutorialMediaArtifact> {
    await prepare();
    if (source === null || typeof source[Symbol.asyncIterator] !== 'function') {
      throw new TutorialMediaArtifactStoreError('invalid_input');
    }
    const temporaryPath = join(temporarySessionRoot, `${randomUUID()}.part`);
    activeTemporary.add(temporaryPath);
    let handle: FileHandle | undefined;
    const hash = createHash('sha256');
    let sizeBytes = 0;
    try {
      await validateDirectoryIdentity(
        temporarySessionRoot,
        temporarySessionIdentity!,
        temporaryIdentity!.canonicalPath,
      );
      handle = await open(temporaryPath, 'wx', 0o600);
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) {
          throw new TutorialMediaArtifactStoreError('invalid_input');
        }
        const stableChunk = Buffer.from(chunk);
        sizeBytes += stableChunk.byteLength;
        if (sizeBytes > maximumArtifactBytes) {
          throw new TutorialMediaArtifactStoreError('artifact_too_large');
        }
        hash.update(stableChunk);
        await handle.writeFile(stableChunk);
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      const sha256 = hash.digest('hex');
      const destination = objectPath(sha256);
      await validateFixedHierarchy();
      await ensurePrivateDirectory(dirname(destination));
      const prefixIdentity = await captureDirectoryIdentity(
        dirname(destination),
        objectsIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
      await validateDirectoryIdentity(
        temporarySessionRoot,
        temporarySessionIdentity!,
        temporaryIdentity!.canonicalPath,
      );
      try {
        await link(temporaryPath, destination);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      let destinationHandle: FileHandle | undefined;
      try {
        destinationHandle = await open(
          destination,
          process.platform === 'win32'
            ? fsConstants.O_RDONLY
            : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
        const destinationInfo = await destinationHandle.stat();
        if (!destinationInfo.isFile()) {
          throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
        }
        if (process.platform !== 'win32') await destinationHandle.chmod(0o400);
      } finally {
        await closeQuietly(destinationHandle);
      }
      await validateDirectoryIdentity(
        dirname(destination),
        prefixIdentity,
        objectsIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
      await validateDirectoryIdentity(
        temporarySessionRoot,
        temporarySessionIdentity!,
        temporaryIdentity!.canonicalPath,
      );
      await rm(temporaryPath, { force: true });
      await validateFixedHierarchy();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const destinationInfo = await lstat(destination).catch(() => undefined);
        if (destinationInfo?.nlink === 1) break;
        await wait(5);
      }
      const verified = await verifyObject(sha256, false);
      if (verified.sizeBytes !== sizeBytes) {
        throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
      }
      return { sha256, sizeBytes, uri: artifactUri(sha256) };
    } catch (error) {
      if (error instanceof TutorialMediaArtifactStoreError) throw error;
      throw new TutorialMediaArtifactStoreError('storage_failed');
    } finally {
      await closeQuietly(handle);
      try {
        if (temporarySessionIdentity !== undefined) {
          await validateDirectoryIdentity(
            temporarySessionRoot,
            temporarySessionIdentity,
            temporaryIdentity!.canonicalPath,
          );
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      } finally {
        activeTemporary.delete(temporaryPath);
      }
    }
  }

  async function read(reference: string): Promise<Uint8Array> {
    const verified = await verifyObject(parseReference(reference), true);
    return verified.bytes ?? new Uint8Array();
  }

  async function inspect(reference: string): Promise<TutorialMediaArtifact> {
    const sha256 = parseReference(reference);
    const verified = await verifyObject(sha256, false);
    return { sha256, sizeBytes: verified.sizeBytes, uri: artifactUri(sha256) };
  }

  async function resolveArtifact(reference: string): Promise<ResolvedTutorialMediaArtifact> {
    const sha256 = parseReference(reference);
    const verified = await verifyObject(sha256, false);
    return {
      path: verified.path,
      sha256,
      sizeBytes: verified.sizeBytes,
      uri: artifactUri(sha256),
    };
  }

  async function useArtifact<Result>(
    reference: string,
    consumer: (verifiedReadOnlyPath: string) => Promise<Result>,
  ): Promise<Result> {
    if (typeof consumer !== 'function') {
      throw new TutorialMediaArtifactStoreError('invalid_input');
    }
    const digest = parseReference(reference);
    const before = await verifyObject(digest, false);
    let result: Result | undefined;
    let consumerError: unknown;
    try {
      result = await consumer(before.path);
    } catch (error) {
      consumerError = error;
    }
    const after = await verifyObject(digest, false);
    if (after.sizeBytes !== before.sizeBytes) {
      throw new TutorialMediaArtifactStoreError('artifact_integrity_failed');
    }
    if (consumerError !== undefined) throw consumerError;
    return result as Result;
  }

  async function putFile(
    stagingPath: string,
    putOptions: TutorialMediaPutFileOptions = {},
  ): Promise<TutorialMediaArtifact> {
    await prepare();
    if (
      stagingPath.includes('\0') ||
      !isAbsolute(stagingPath) ||
      resolve(stagingPath) !== stagingPath
    ) {
      throw new TutorialMediaArtifactStoreError('invalid_input');
    }
    const containingStagingDirectory = [...activeStaging.keys()].find((directory) =>
      within(directory, stagingPath),
    );
    if (containingStagingDirectory === undefined || stagingPath === containingStagingDirectory) {
      throw new TutorialMediaArtifactStoreError('invalid_input');
    }
    let handle: FileHandle | undefined;
    try {
      const expectedStagingIdentity = activeStaging.get(containingStagingDirectory);
      if (expectedStagingIdentity === undefined) {
        throw new TutorialMediaArtifactStoreError('invalid_input');
      }
      await validateDirectoryIdentity(
        containingStagingDirectory,
        expectedStagingIdentity,
        stagingIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
      const pathInfo = await lstat(stagingPath);
      const canonicalPath = await realpath(stagingPath);
      if (
        pathInfo.isSymbolicLink() ||
        !pathInfo.isFile() ||
        pathInfo.nlink !== 1 ||
        !within(expectedStagingIdentity.canonicalPath, canonicalPath)
      ) {
        throw new TutorialMediaArtifactStoreError('invalid_input');
      }
      handle = await open(
        stagingPath,
        process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const openedInfo = await handle.stat();
      if (
        !openedInfo.isFile() ||
        openedInfo.nlink !== 1 ||
        openedInfo.dev !== pathInfo.dev ||
        openedInfo.ino !== pathInfo.ino ||
        openedInfo.size > maximumArtifactBytes
      ) {
        throw new TutorialMediaArtifactStoreError(
          openedInfo.size > maximumArtifactBytes ? 'artifact_too_large' : 'invalid_input',
        );
      }
      const artifact = await put(handle.createReadStream({ autoClose: false }));
      const finalOpenedInfo = await handle.stat();
      const finalPathInfo = await lstat(stagingPath);
      await validateDirectoryIdentity(
        containingStagingDirectory,
        expectedStagingIdentity,
        stagingIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
      if (
        finalOpenedInfo.size !== openedInfo.size ||
        finalOpenedInfo.nlink !== 1 ||
        finalOpenedInfo.dev !== finalPathInfo.dev ||
        finalOpenedInfo.ino !== finalPathInfo.ino
      ) {
        throw new TutorialMediaArtifactStoreError('invalid_input');
      }
      await handle.close();
      handle = undefined;
      if (putOptions.removeSource === true) {
        await rm(stagingPath);
        await validateDirectoryIdentity(
          containingStagingDirectory,
          expectedStagingIdentity,
          stagingIdentity!.canonicalPath,
        );
      }
      return artifact;
    } catch (error) {
      if (error instanceof TutorialMediaArtifactStoreError) throw error;
      throw new TutorialMediaArtifactStoreError('storage_failed');
    } finally {
      await closeQuietly(handle);
    }
  }

  async function createJobStagingDirectory(
    jobId: string,
  ): Promise<TutorialMediaJobStagingDirectory> {
    if (!jobIdPattern.test(jobId) || jobId.includes('\0')) {
      throw new TutorialMediaArtifactStoreError('invalid_input');
    }
    return serializeStaging(async () => {
      await prepare();
      const path = join(stagingRoot, `${jobId}-${randomUUID()}`);
      await validateFixedHierarchy();
      await mkdir(path, { mode: 0o700 });
      const identity = await captureDirectoryIdentity(path, stagingIdentity!.canonicalPath);
      await validateFixedHierarchy();
      activeStaging.set(path, identity);
      let removed = false;
      return {
        jobId,
        path,
        async cleanup() {
          await serializeStaging(async () => {
            if (removed) return;
            if (!activeStaging.has(path)) {
              removed = true;
              return;
            }
            removed = true;
            activeStaging.delete(path);
            if (
              basename(path).startsWith(`${jobId}-`) &&
              resolve(dirname(path)) === resolve(stagingRoot)
            ) {
              await validateDirectoryIdentity(path, identity, stagingIdentity!.canonicalPath);
              await validateFixedHierarchy();
              await rm(path, { force: true, recursive: true });
              await validateFixedHierarchy();
            }
          });
        },
      };
    });
  }

  async function cleanup(): Promise<void> {
    await serializeStaging(async () => {
      await prepare();
      const paths = [...activeStaging.entries()];
      for (const [path, identity] of paths) {
        await validateDirectoryIdentity(path, identity, stagingIdentity!.canonicalPath);
        await validateFixedHierarchy();
        await rm(path, { force: true, recursive: true });
        await validateFixedHierarchy();
        activeStaging.delete(path);
      }
    });
    await prepare();
    await validateDirectoryIdentity(
      temporarySessionRoot,
      temporarySessionIdentity!,
      temporaryIdentity!.canonicalPath,
    );
    for (const name of await readdir(temporarySessionRoot)) {
      const path = join(temporarySessionRoot, name);
      if (/^[a-f0-9-]+\.part$/iu.test(name) && !activeTemporary.has(path)) {
        await validateDirectoryIdentity(
          temporarySessionRoot,
          temporarySessionIdentity!,
          temporaryIdentity!.canonicalPath,
        );
        await validateFixedHierarchy();
        await rm(path, { force: true });
        await validateDirectoryIdentity(
          temporarySessionRoot,
          temporarySessionIdentity!,
          temporaryIdentity!.canonicalPath,
        );
        await validateFixedHierarchy();
      }
    }
    if (activeTemporary.size === 0) {
      await validateDirectoryIdentity(
        temporarySessionRoot,
        temporarySessionIdentity!,
        temporaryIdentity!.canonicalPath,
      );
      await validateFixedHierarchy();
      try {
        await rmdir(temporarySessionRoot);
      } catch (error) {
        throw new TutorialMediaArtifactStoreError(
          error instanceof Error && 'code' in error && error.code === 'ENOENT'
            ? 'unsafe_storage'
            : 'storage_failed',
          { cause: error },
        );
      }
      temporarySessionIdentity = undefined;
      temporarySessionPreparation = undefined;
    }
    await validateFixedHierarchy();
    const staleBeforeMs = (options.now?.() ?? new Date()).getTime() - staleTemporarySessionAgeMs;
    for (const name of await readdir(temporaryRoot)) {
      if (!/^[a-f0-9-]{36}$/iu.test(name)) continue;
      const path = join(temporaryRoot, name);
      if (path === temporarySessionRoot) continue;
      const info = await lstat(path).catch(() => undefined);
      if (
        info === undefined ||
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        info.mtimeMs >= staleBeforeMs
      ) {
        continue;
      }
      const identity = await captureDirectoryIdentity(path, temporaryIdentity!.canonicalPath);
      const entries = await readdir(path).catch(() => []);
      if (entries.every((entry) => /^[a-f0-9-]+\.part$/iu.test(entry))) {
        await validateDirectoryIdentity(path, identity, temporaryIdentity!.canonicalPath);
        await validateFixedHierarchy();
        await rm(path, { recursive: true });
        await validateFixedHierarchy();
      }
    }
  }

  return {
    cleanup,
    createJobStagingDirectory,
    inspect,
    put,
    putFile,
    read,
    resolve: resolveArtifact,
    use: useArtifact,
  };
}
