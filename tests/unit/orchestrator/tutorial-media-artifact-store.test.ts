import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTutorialMediaArtifactStore,
  TutorialMediaArtifactStoreError,
} from '../../../services/orchestrator/src/tutorial-media-artifact-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function fixture() {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'operatingline-media-store-'));
  temporaryDirectories.push(baseDirectory);
  const userId = typeof process.getuid === 'function' ? process.getuid() : 'current-user';
  const root = join(baseDirectory, `operatingline-tutorial-media-${userId}`);
  const store = createTutorialMediaArtifactStore({
    baseDirectory,
    maximumArtifactBytes: 1024,
    maximumReadBytes: 16,
  });
  return { baseDirectory, root, store };
}

async function* bytes(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value.slice(0, 2));
  yield Buffer.from(value.slice(2));
}

function objectPath(root: string, digest: string): string {
  return join(root, 'objects', digest.slice(0, 2), digest);
}

describe('tutorial media artifact store', () => {
  it('streams data into a private content-addressed object and exposes no path', async () => {
    const { baseDirectory, root, store } = await fixture();
    await chmod(baseDirectory, 0o755);
    const artifact = await store.put(bytes('artifact'));
    const expectedDigest = createHash('sha256').update('artifact').digest('hex');

    expect(artifact).toEqual({
      sha256: expectedDigest,
      sizeBytes: 8,
      uri: `operatingline-media://sha256/${expectedDigest}`,
    });
    expect(JSON.stringify(artifact)).not.toContain(baseDirectory);
    expect(Buffer.from(await store.read(artifact.uri)).toString('utf8')).toBe('artifact');
    expect(await store.inspect(artifact.uri)).toEqual(artifact);
    expect(await store.resolve(artifact.uri)).toMatchObject({
      ...artifact,
      path: objectPath(root, expectedDigest),
    });
    expect((await lstat(root)).mode & 0o077).toBe(0);
    expect((await lstat(objectPath(root, expectedDigest))).mode & 0o777).toBe(0o400);
    expect((await lstat(baseDirectory)).mode & 0o077).not.toBe(0);
  });

  it('rejects relative, absolute, malformed, and NUL artifact references', async () => {
    const { store } = await fixture();
    for (const reference of [
      'sha256/abc',
      '/tmp/object',
      '../object',
      'operatingline-media://sha256/abc',
      'operatingline-media://sha256/' + 'a'.repeat(64) + '\0',
    ]) {
      await expect(store.read(reference)).rejects.toMatchObject({
        code: 'invalid_artifact_reference',
      });
    }
  });

  it('enforces the streaming size limit and removes temporary data', async () => {
    const { root, store } = await fixture();
    await expect(store.put(bytes('x'.repeat(1025)))).rejects.toMatchObject({
      code: 'artifact_too_large',
    });
    await store.cleanup();
    expect(await readdir(join(root, 'temporary'))).toEqual([]);
  });

  it('reclaims only expired crash-session partials', async () => {
    const { baseDirectory, root } = await fixture();
    const now = new Date('2026-08-18T12:00:00.000Z');
    const store = createTutorialMediaArtifactStore({
      baseDirectory,
      maximumArtifactBytes: 1024,
      maximumReadBytes: 16,
      now: () => now,
      staleTemporarySessionAgeMs: 60_000,
    });
    await store.cleanup();
    const stale = join(root, 'temporary', '11111111-1111-4111-8111-111111111111');
    const recent = join(root, 'temporary', '22222222-2222-4222-8222-222222222222');
    await Promise.all([mkdir(stale, { mode: 0o700 }), mkdir(recent, { mode: 0o700 })]);
    await Promise.all([
      writeFile(join(stale, '33333333-3333-4333-8333-333333333333.part'), 'stale'),
      writeFile(join(recent, '44444444-4444-4444-8444-444444444444.part'), 'recent'),
    ]);
    await utimes(stale, new Date(now.getTime() - 120_000), new Date(now.getTime() - 120_000));
    await store.cleanup();
    await expect(lstat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(recent)).isDirectory()).toBe(true);
  });

  it('refuses in-memory reads above the read limit while inspect and resolve stay streaming', async () => {
    const { store } = await fixture();
    const artifact = await store.put(bytes('x'.repeat(17)));
    await expect(store.read(artifact.uri)).rejects.toMatchObject({
      code: 'artifact_read_too_large',
    });
    expect(await store.inspect(artifact.uri)).toEqual(artifact);
    expect((await store.resolve(artifact.uri)).sizeBytes).toBe(17);
  });

  it('detects object content tampering', async () => {
    const { root, store } = await fixture();
    const artifact = await store.put(bytes('original'));
    const path = objectPath(root, artifact.sha256);
    await chmod(path, 0o600);
    await writeFile(path, 'tampered');
    await expect(store.read(artifact.uri)).rejects.toMatchObject({
      code: 'artifact_integrity_failed',
    });
  });

  it('rejects symlink and hardlink replacement objects', async () => {
    const { baseDirectory, root, store } = await fixture();
    const artifact = await store.put(bytes('linked'));
    const path = objectPath(root, artifact.sha256);
    const outside = join(baseDirectory, 'outside');
    await writeFile(outside, 'linked');
    await rm(path);
    await symlink(outside, path);
    await expect(store.read(artifact.uri)).rejects.toMatchObject({
      code: 'artifact_integrity_failed',
    });
    await rm(path);
    await link(outside, path);
    await expect(store.read(artifact.uri)).rejects.toMatchObject({
      code: 'artifact_integrity_failed',
    });
  });

  it('rejects an objects root moved outside storage and replaced by a symlink', async () => {
    const { baseDirectory, root, store } = await fixture();
    const artifact = await store.put(bytes('relocated-object'));
    const objects = join(root, 'objects');
    const relocatedObjects = join(baseDirectory, 'relocated-objects');
    await rename(objects, relocatedObjects);
    await symlink(relocatedObjects, objects);

    await expect(store.inspect(artifact.uri)).rejects.toMatchObject({
      code: 'unsafe_storage',
    });
  });

  it('rejects a dynamic object prefix moved outside storage and replaced by a symlink', async () => {
    const { baseDirectory, root, store } = await fixture();
    const artifact = await store.put(bytes('relocated-prefix'));
    const prefix = dirname(objectPath(root, artifact.sha256));
    const relocatedPrefix = join(baseDirectory, 'relocated-prefix');
    await rename(prefix, relocatedPrefix);
    await symlink(relocatedPrefix, prefix);

    await expect(store.inspect(artifact.uri)).rejects.toMatchObject({
      code: 'unsafe_storage',
    });
  });

  it('rejects replacement of the pinned storage root after initialization', async () => {
    const { baseDirectory, root, store } = await fixture();
    const artifact = await store.put(bytes('root-replacement'));
    const relocatedRoot = join(baseDirectory, 'relocated-root');
    await rename(root, relocatedRoot);
    await mkdir(root, { mode: 0o700 });

    await expect(store.inspect(artifact.uri)).rejects.toMatchObject({
      code: 'unsafe_storage',
    });
  });

  it('rejects replacement of the pinned temporary root after initialization', async () => {
    const { baseDirectory, root, store } = await fixture();
    await store.cleanup();
    const temporaryRoot = join(root, 'temporary');
    const relocatedTemporaryRoot = join(baseDirectory, 'relocated-temporary-root');
    await rename(temporaryRoot, relocatedTemporaryRoot);
    await symlink(relocatedTemporaryRoot, temporaryRoot);

    await expect(store.cleanup()).rejects.toMatchObject({
      code: 'unsafe_storage',
    });
  });

  it('publishes concurrent identical artifacts as one verified CAS object', async () => {
    const { root, store } = await fixture();
    const artifacts = await Promise.all(
      Array.from({ length: 8 }, () => store.put(bytes('same-content'))),
    );
    expect(new Set(artifacts.map((artifact) => artifact.uri))).toHaveLength(1);
    const path = objectPath(root, artifacts[0]!.sha256);
    expect((await lstat(path)).nlink).toBe(1);
    expect(Buffer.from(await store.read(artifacts[0]!.uri)).toString()).toBe('same-content');
  });

  it('does not delete an active atomic write during concurrent cleanup', async () => {
    const { baseDirectory, store } = await fixture();
    const otherStore = createTutorialMediaArtifactStore({
      baseDirectory,
      maximumArtifactBytes: 1024,
      maximumReadBytes: 16,
    });
    let releaseWrite!: () => void;
    let observedFirstChunk!: () => void;
    const firstChunk = new Promise<void>((resolveFirstChunk) => {
      observedFirstChunk = resolveFirstChunk;
    });
    const continueWrite = new Promise<void>((resolveContinueWrite) => {
      releaseWrite = resolveContinueWrite;
    });
    async function* slowSource() {
      yield Buffer.from('first-');
      observedFirstChunk();
      await continueWrite;
      yield Buffer.from('second');
    }
    const publishing = store.put(slowSource());
    await firstChunk;
    await Promise.all([store.cleanup(), otherStore.cleanup()]);
    releaseWrite();
    const artifact = await publishing;
    expect(Buffer.from(await store.read(artifact.uri)).toString()).toBe('first-second');
  });

  it('revalidates read-only objects after a trusted path consumer returns', async () => {
    const { root, store } = await fixture();
    const artifact = await store.put(bytes('leased'));
    await expect(
      store.use(artifact.uri, async (path) => {
        await chmod(path, 0o600);
        await writeFile(path, 'changed');
      }),
    ).rejects.toMatchObject({ code: 'artifact_integrity_failed' });
    expect((await lstat(objectPath(root, artifact.sha256))).mode & 0o777).toBe(0o600);
  });

  it('creates validated private job staging directories and cleans them idempotently', async () => {
    const { baseDirectory, store } = await fixture();
    const staging = await store.createJobStagingDirectory('job-1');
    expect(staging.path.startsWith(baseDirectory)).toBe(true);
    expect((await lstat(staging.path)).mode & 0o077).toBe(0);
    await Promise.all([staging.cleanup(), staging.cleanup()]);
    await expect(lstat(staging.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.createJobStagingDirectory('../escape')).rejects.toBeInstanceOf(
      TutorialMediaArtifactStoreError,
    );
    await store.cleanup();
  });

  it('does not clean up a staging path whose directory identity was replaced', async () => {
    const { baseDirectory, store } = await fixture();
    const staging = await store.createJobStagingDirectory('replace');
    const relocated = join(baseDirectory, 'relocated-job-staging');
    await rename(staging.path, relocated);
    await mkdir(staging.path, { mode: 0o700 });
    const sentinel = join(staging.path, 'do-not-delete');
    await writeFile(sentinel, 'replacement');

    await expect(staging.cleanup()).rejects.toMatchObject({ code: 'unsafe_storage' });
    expect((await lstat(sentinel)).isFile()).toBe(true);
    expect((await lstat(relocated)).isDirectory()).toBe(true);
  });

  it('rejects cleanup after the pinned staging root is replaced by a symlink', async () => {
    const { baseDirectory, root, store } = await fixture();
    const staging = await store.createJobStagingDirectory('replace-root');
    const stagingRoot = join(root, 'staging');
    const relocatedStagingRoot = join(baseDirectory, 'relocated-staging-root');
    await rename(stagingRoot, relocatedStagingRoot);
    await symlink(relocatedStagingRoot, stagingRoot);

    await expect(staging.cleanup()).rejects.toMatchObject({ code: 'unsafe_storage' });
    expect((await lstat(staging.path)).isDirectory()).toBe(true);
  });

  it('serializes concurrent staging creation and global cleanup', async () => {
    const { store } = await fixture();
    const creating = store.createJobStagingDirectory('concurrent');
    const cleaning = store.cleanup();
    const staging = await creating;
    await cleaning;
    await expect(lstat(staging.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await staging.cleanup();
  });

  it('streams only regular single-link files from owned staging and can remove the source', async () => {
    const { baseDirectory, store } = await fixture();
    const staging = await store.createJobStagingDirectory('ingest');
    const source = join(staging.path, 'video.bin');
    await writeFile(source, 'video-content');
    const artifact = await store.putFile(source, { removeSource: true });
    expect(Buffer.from(await store.read(artifact.uri)).toString()).toBe('video-content');
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });

    const outside = join(baseDirectory, 'outside.bin');
    await writeFile(outside, 'outside');
    await expect(store.putFile(outside)).rejects.toMatchObject({ code: 'invalid_input' });

    const linked = join(staging.path, 'linked.bin');
    await link(outside, linked);
    await expect(store.putFile(linked)).rejects.toMatchObject({ code: 'invalid_input' });
    await rm(linked);
    await symlink(outside, linked);
    await expect(store.putFile(linked)).rejects.toMatchObject({ code: 'invalid_input' });
    await staging.cleanup();
  });
});
