import { createHash, randomUUID } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcedureTutorialMediaAnalysisRequest } from '@operatingline/protocol';
import {
  createProcedureTutorialMediaRuntime,
  createProcedureTutorialMediaRuntimeFromEnvironment,
} from '../../../services/orchestrator/src/procedure-tutorial-media-runtime.js';

const temporaryDirectories: string[] = [];

async function makeDirectoryTreeWritable(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) return;
  await chmod(path, 0o700);
  for (const name of await readdir(path)) {
    await makeDirectoryTreeWritable(join(path, name));
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

const fakeTool = `#!${process.execPath}
const { basename, dirname } = require('node:path');
const { isAbsolute } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
const argument = (name) => args[args.indexOf(name) + 1];
if (args.includes('--version') || args.includes('-version')) {
  process.stdout.write(tool + ' version 1.2.3\\n');
  process.exit(0);
}
if (tool === 'tesseract' && args.includes('--list-langs')) {
  process.stdout.write('List of available languages in fixture (2):\\neng\\nchi_sim\\n');
  process.exit(0);
}
if (tool === 'yt-dlp') {
  const ffmpeg = argument('--ffmpeg-location');
  if (!isAbsolute(ffmpeg)) process.exit(41);
  const template = argument('--output');
  const output = template.replace('%(ext)s', 'mp4');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, 'fixture-video');
  const url = args.at(-1);
  process.stdout.write(JSON.stringify({
    id: new URL(url).searchParams.get('v'),
    title: 'Fixture tutorial',
    duration: 5,
    filepath: output,
  }));
  process.exit(0);
}
if (tool === 'ffprobe') {
  process.stdout.write(JSON.stringify({
    format: { duration: '5.000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', nb_frames: '150' },
      { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' },
    ],
  }));
  process.exit(0);
}
if (tool === 'ffmpeg') {
  const output = args.at(-1);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, output.endsWith('.wav') ? 'fixture-audio' : 'fixture-frame:' + output);
  process.exit(0);
}
if (tool === 'whisper') {
  const output = argument('-of') + '.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({
    params: {},
    result: { language: argument('-l') },
    transcription: [{ offsets: { from: 0, to: 1000 }, text: 'Create an eye.' }],
  }));
  process.exit(0);
}
if (tool === 'tesseract') {
  process.stdout.write('level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n5\\t1\\t1\\t1\\t1\\t1\\t10\\t10\\t80\\t20\\t95\\tShift+A\\n');
  process.exit(0);
}
process.exit(42);
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'operatingline-media-runtime-'));
  temporaryDirectories.push(root);
  const toolPaths = {
    ffmpegExecutable: join(root, 'ffmpeg'),
    ffprobeExecutable: join(root, 'ffprobe'),
    tesseractExecutable: join(root, 'tesseract'),
    whisperExecutable: join(root, 'whisper'),
    ytDlpExecutable: join(root, 'yt-dlp'),
  };
  await Promise.all(
    Object.values(toolPaths).map(async (path) => {
      await writeFile(path, fakeTool, { mode: 0o700 });
      await chmod(path, 0o700);
    }),
  );
  const whisperModelPath = join(root, 'model.bin');
  await writeFile(whisperModelPath, 'fixture-model', { mode: 0o600 });
  const tesseractDataDirectory = join(root, 'tessdata');
  await mkdir(tesseractDataDirectory, { mode: 0o700 });
  await Promise.all([
    writeFile(join(tesseractDataDirectory, 'eng.traineddata'), 'fixture-eng-traineddata', {
      mode: 0o600,
    }),
    writeFile(join(tesseractDataDirectory, 'chi_sim.traineddata'), 'fixture-zh-traineddata', {
      mode: 0o600,
    }),
  ]);
  const now = new Date();
  const confirmedAt = now.toISOString();
  const validFrom = new Date(now.getTime() - 60_000).toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1_000).toISOString();
  const authorizationRegistry = {
    authorizations: [
      {
        authorizationId: 'authorization-1',
        expiresAt,
        platformDownloadAuthorization: {
          basis: 'youtube_written_approval' as const,
          reference: 'youtube-approval-1',
        },
        rightsAuthorization: {
          basis: 'rights_holder_permission' as const,
          reference: 'rights-1',
        },
        validFrom,
        videoId: 'abcdefghijk',
      },
    ],
    formatVersion: '1.0.0' as const,
  };
  return {
    config: {
      artifactBaseDirectory: join(root, 'artifacts'),
      authorizationRegistry,
      ...toolPaths,
      maximumAnalysisWindowMs: 10_000,
      maximumConcurrentJobs: 2,
      maximumFrames: 2,
      maximumJobRuntimeMs: 60_000,
      supportedLocales: ['en'],
      tesseractDataDirectory,
      whisperModelPath,
    },
    confirmedAt,
    root,
  };
}

async function runtimeEnvironment(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
): Promise<Readonly<Record<string, string>>> {
  const registryPath = join(fixtureValue.root, 'authorization-registry.json');
  await writeFile(registryPath, JSON.stringify(fixtureValue.config.authorizationRegistry), {
    mode: 0o600,
  });
  await chmod(registryPath, 0o600);
  return {
    OPERATINGLINE_FFMPEG_BIN: fixtureValue.config.ffmpegExecutable,
    OPERATINGLINE_FFPROBE_BIN: fixtureValue.config.ffprobeExecutable,
    OPERATINGLINE_TESSERACT_BIN: fixtureValue.config.tesseractExecutable,
    OPERATINGLINE_TESSDATA_DIR: fixtureValue.config.tesseractDataDirectory,
    OPERATINGLINE_WHISPER_CPP_BIN: fixtureValue.config.whisperExecutable,
    OPERATINGLINE_WHISPER_CPP_MODEL: fixtureValue.config.whisperModelPath,
    OPERATINGLINE_YOUTUBE_MEDIA_AUTHORIZATION_REGISTRY_PATH: registryPath,
    OPERATINGLINE_YOUTUBE_MEDIA_FRAME_INTERVAL_MS: '500',
    OPERATINGLINE_YOUTUBE_MEDIA_LOCALES: 'en, zh-CN',
    OPERATINGLINE_YOUTUBE_MEDIA_MAX_ANALYSIS_WINDOW_MS: '10000',
    OPERATINGLINE_YOUTUBE_MEDIA_MAX_CONCURRENT_JOBS: '3',
    OPERATINGLINE_YOUTUBE_MEDIA_MAX_DOWNLOAD_BYTES: '1000000',
    OPERATINGLINE_YOUTUBE_MEDIA_MAX_FRAMES: '4',
    OPERATINGLINE_YOUTUBE_MEDIA_MAX_JOB_RUNTIME_MS: '60000',
    OPERATINGLINE_YOUTUBE_MEDIA_ROOT: fixtureValue.config.artifactBaseDirectory,
    OPERATINGLINE_YT_DLP_BIN: fixtureValue.config.ytDlpExecutable,
  };
}

function request(confirmedAt: string, startMs: number): ProcedureTutorialMediaAnalysisRequest {
  return {
    analysisProfile: 'youtube_tutorial_evidence_v1',
    analysisWindow: { endMs: startMs + 1_000, startMs },
    approvals: {
      mediaDownloadApproved: true,
      networkAccessApproved: true,
      retentionApproved: true,
    },
    formatVersion: '1.0.0',
    locale: 'en',
    platformDownloadAuthorization: {
      basis: 'youtube_written_approval',
      confirmedAt,
      reference: 'youtube-approval-1',
    },
    requestId: randomUUID(),
    requestedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
    rightsAuthorization: {
      basis: 'rights_holder_permission',
      confirmedAt,
      reference: 'rights-1',
    },
    videoId: 'abcdefghijk',
  };
}

describe('procedure tutorial media runtime', () => {
  it('preflights trusted tools and reports limits that are used by the pipeline', async () => {
    const { config, confirmedAt } = await fixture();
    const runtime = await createProcedureTutorialMediaRuntime(config);
    expect(runtime.capabilities).toMatchObject({
      availability: 'available',
      limits: {
        maxAnalysisWindowMs: 10_000,
        maxConcurrentJobs: 2,
        maxFrames: 2,
        maxJobRuntimeMs: 60_000,
      },
      supportedLocales: ['en'],
    });
    if (runtime.capabilities.availability !== 'available') throw new Error('fixture unavailable');

    const first = await runtime.pipeline.analyze(request(confirmedAt, 0), randomUUID());
    const second = await runtime.pipeline.analyze(request(confirmedAt, 1_000), randomUUID());
    expect(first.frames).toHaveLength(2);
    expect(first.tools.map((tool) => tool.toolId)).toEqual([
      'yt-dlp',
      'ffprobe',
      'ffmpeg',
      'whisper.cpp',
      'tesseract',
    ]);
    expect(first.tools.find((tool) => tool.toolId === 'whisper.cpp')?.modelSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(
      first.tools.find((tool) => tool.toolId === 'ffmpeg')?.normalizedInvocationSha256,
    ).not.toBe(second.tools.find((tool) => tool.toolId === 'ffmpeg')?.normalizedInvocationSha256);
    expect(JSON.stringify(first)).not.toContain(config.artifactBaseDirectory);
    expect(JSON.stringify(first)).not.toContain(config.whisperModelPath);
    await runtime.pipeline.close();
  }, 20_000);

  it('executes immutable private tool and model snapshots after configured files are replaced', async () => {
    const { config, confirmedAt } = await fixture();
    const expectedExecutableSha256 = createHash('sha256').update(fakeTool).digest('hex');
    const expectedModelSha256 = createHash('sha256').update('fixture-model').digest('hex');
    const expectedTesseractModelSha256 = createHash('sha256')
      .update('fixture-eng-traineddata')
      .digest('hex');
    const runtime = await createProcedureTutorialMediaRuntime(config);
    if (runtime.capabilities.availability !== 'available') throw new Error('fixture unavailable');

    await Promise.all([
      writeFile(config.ffmpegExecutable, '#!/bin/sh\nexit 97\n', { mode: 0o700 }),
      writeFile(config.whisperExecutable, '#!/bin/sh\nexit 98\n', { mode: 0o700 }),
      writeFile(config.whisperModelPath, 'replacement-model', { mode: 0o600 }),
      writeFile(join(config.tesseractDataDirectory, 'eng.traineddata'), 'replacement-traineddata', {
        mode: 0o600,
      }),
    ]);

    try {
      const result = await runtime.pipeline.analyze(request(confirmedAt, 0), randomUUID());
      expect(result.tools.find((tool) => tool.toolId === 'ffmpeg')?.executableSha256).toBe(
        expectedExecutableSha256,
      );
      expect(result.tools.find((tool) => tool.toolId === 'whisper.cpp')).toMatchObject({
        executableSha256: expectedExecutableSha256,
        modelSha256: expectedModelSha256,
      });
      expect(result.tools.find((tool) => tool.toolId === 'tesseract')?.modelSha256).toBe(
        expectedTesseractModelSha256,
      );
      expect(JSON.stringify(result)).not.toContain('runtime-snapshots');
    } finally {
      await runtime.pipeline.close();
    }

    expect(await readdir(join(config.artifactBaseDirectory, 'runtime-snapshots'))).toEqual([]);
  }, 20_000);

  it('returns path-free unavailable capabilities for missing and unsafe local configuration', async () => {
    const missing = `/private/sensitive/${randomUUID()}/whisper`;
    const runtime = await createProcedureTutorialMediaRuntime({
      artifactBaseDirectory: '/tmp/media-cas',
      authorizationRegistry: undefined,
      ffmpegExecutable: missing,
      ffprobeExecutable: missing,
      supportedLocales: ['en'],
      tesseractExecutable: missing,
      whisperExecutable: missing,
      whisperModelPath: missing,
      ytDlpExecutable: missing,
    });
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['authorization_registry_missing'],
    });
    expect(JSON.stringify(runtime)).not.toContain(missing);
  });

  it('rejects configured locales whose traineddata is not installed', async () => {
    const { config } = await fixture();
    const runtime = await createProcedureTutorialMediaRuntime({
      ...config,
      supportedLocales: ['fr'],
    });
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['model_missing'],
    });
  });

  it('rejects analysis windows that cannot fit the enforced PCM audio artifact limit', async () => {
    const { config } = await fixture();
    const runtime = await createProcedureTutorialMediaRuntime({
      ...config,
      maximumAnalysisWindowMs: 24 * 60 * 60 * 1_000,
    });
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['not_configured'],
    });
  });

  it('rejects overlong locales before snapshot allocation', async () => {
    const { config } = await fixture();
    const snapshotContainer = join(config.artifactBaseDirectory, 'runtime-snapshots');
    await mkdir(snapshotContainer, { mode: 0o700, recursive: true });
    const runtime = await createProcedureTutorialMediaRuntime({
      ...config,
      supportedLocales: [`en-${'a'.repeat(62)}`],
    });
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['not_configured'],
    });
    expect(await readdir(snapshotContainer)).toEqual([]);
  });

  it('cleans private snapshots when post-preflight initialization fails', async () => {
    const { config } = await fixture();
    const runtime = await createProcedureTutorialMediaRuntime({
      ...config,
      tesseractLanguageCodes: {
        unused: (() => undefined) as unknown as string,
      },
    });
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['preflight_failed'],
    });
    expect(await readdir(join(config.artifactBaseDirectory, 'runtime-snapshots'))).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    'surfaces a path-free error when failed initialization cannot clean its snapshots',
    async () => {
      const { config, root } = await fixture();
      const snapshotContainer = join(config.artifactBaseDirectory, 'runtime-snapshots');
      const movedSnapshotContainer = join(config.artifactBaseDirectory, 'blocked-snapshots');
      let replaced = false;
      const tesseractLanguageCodes: Record<string, string> = {};
      Object.defineProperty(tesseractLanguageCodes, 'unused', {
        enumerable: true,
        get() {
          if (!replaced) {
            renameSync(snapshotContainer, movedSnapshotContainer);
            writeFileSync(snapshotContainer, 'not-a-directory');
            replaced = true;
          }
          return (() => undefined) as unknown as string;
        },
      });

      let error: unknown;
      try {
        error = await createProcedureTutorialMediaRuntime({
          ...config,
          tesseractLanguageCodes,
        }).catch((value: unknown) => value);
      } finally {
        if (replaced) {
          unlinkSync(snapshotContainer);
          renameSync(movedSnapshotContainer, snapshotContainer);
          await makeDirectoryTreeWritable(snapshotContainer);
          await rm(snapshotContainer, { force: true, recursive: true });
        }
      }

      expect(error).toMatchObject({
        message: 'Tutorial media runtime initialization cleanup failed.',
        name: 'ProcedureTutorialMediaRuntimeCleanupError',
      });
      expect(String(error)).not.toContain(root);
    },
  );

  it('builds the trusted runtime from an explicit read-only environment', async () => {
    const fixtureValue = await fixture();
    const environment = await runtimeEnvironment(fixtureValue);
    const runtime = await createProcedureTutorialMediaRuntimeFromEnvironment(environment);

    expect(runtime.capabilities).toMatchObject({
      availability: 'available',
      limits: {
        maxAnalysisWindowMs: 10_000,
        maxConcurrentJobs: 3,
        maxFrames: 4,
        maxJobRuntimeMs: 60_000,
      },
      supportedLocales: ['en', 'zh-cn'],
    });
    if (runtime.capabilities.availability !== 'available') throw new Error('fixture unavailable');
    await runtime.pipeline.close();
  }, 10_000);

  it('returns not_configured for an empty environment or invalid numeric settings', async () => {
    expect(
      (await createProcedureTutorialMediaRuntimeFromEnvironment({})).capabilities,
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['not_configured'],
    });
    const fixtureValue = await fixture();
    const environment = {
      ...(await runtimeEnvironment(fixtureValue)),
      OPERATINGLINE_YOUTUBE_MEDIA_MAX_FRAMES: '2 frames',
    };
    const runtime = await createProcedureTutorialMediaRuntimeFromEnvironment(environment);
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['not_configured'],
    });
  });

  it.runIf(process.platform !== 'win32')(
    'rejects non-private and symlinked authorization registries without leaking them',
    async () => {
      const fixtureValue = await fixture();
      const baseEnvironment = await runtimeEnvironment(fixtureValue);
      const registryPath = baseEnvironment.OPERATINGLINE_YOUTUBE_MEDIA_AUTHORIZATION_REGISTRY_PATH;
      const secret = 'registry-secret-value';
      await writeFile(registryPath, secret, { mode: 0o644 });
      await chmod(registryPath, 0o644);
      const publicResult =
        await createProcedureTutorialMediaRuntimeFromEnvironment(baseEnvironment);
      expect(publicResult.capabilities).toMatchObject({
        availability: 'unavailable',
        unavailableReasons: ['preflight_failed'],
      });

      await chmod(registryPath, 0o600);
      const invalidSchemaResult =
        await createProcedureTutorialMediaRuntimeFromEnvironment(baseEnvironment);
      expect(invalidSchemaResult.capabilities).toMatchObject({
        availability: 'unavailable',
        unavailableReasons: ['preflight_failed'],
      });
      const linkPath = join(fixtureValue.root, 'authorization-registry-link.json');
      await symlink(registryPath, linkPath);
      const linkResult = await createProcedureTutorialMediaRuntimeFromEnvironment({
        ...baseEnvironment,
        OPERATINGLINE_YOUTUBE_MEDIA_AUTHORIZATION_REGISTRY_PATH: linkPath,
      });
      expect(linkResult.capabilities).toMatchObject({
        availability: 'unavailable',
        unavailableReasons: ['preflight_failed'],
      });
      expect(JSON.stringify([publicResult, invalidSchemaResult, linkResult])).not.toContain(secret);
      expect(JSON.stringify([publicResult, invalidSchemaResult, linkResult])).not.toContain(
        registryPath,
      );
    },
  );

  it('rejects oversized authorization registries before parsing them', async () => {
    const fixtureValue = await fixture();
    const environment = await runtimeEnvironment(fixtureValue);
    const registryPath = environment.OPERATINGLINE_YOUTUBE_MEDIA_AUTHORIZATION_REGISTRY_PATH;
    await writeFile(registryPath, 'x'.repeat(4 * 1_024 * 1_024 + 1), { mode: 0o600 });
    await chmod(registryPath, 0o600);
    const runtime = await createProcedureTutorialMediaRuntimeFromEnvironment(environment);
    expect(runtime.capabilities).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: ['preflight_failed'],
    });
  });
});
