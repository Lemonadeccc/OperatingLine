import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { access, chmod, lstat, mkdir, open, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  canonicalizeProtocolJsonValue,
  procedureTutorialMediaCapabilitiesSchema,
  procedureTutorialMediaFrameMaxCount,
  type ProcedureTutorialMediaCapabilities,
  type ProcedureTutorialMediaAnalysisResult,
} from '@operatingline/protocol';

import {
  createProcedureTutorialMediaPipeline,
  type ProcedureTutorialMediaPipeline,
} from './procedure-tutorial-media-pipeline.js';
import { createTutorialMediaArtifactStore } from './tutorial-media-artifact-store.js';
import { createTutorialMediaAsr } from './tutorial-media-asr.js';
import { createTutorialMediaOcr, resolveTesseractLanguageCode } from './tutorial-media-ocr.js';
import {
  createTutorialMediaProcessRunner,
  type TutorialMediaProcessCommand,
} from './tutorial-media-process.js';
import { createTutorialMediaProbe } from './tutorial-media-probe.js';
import { createTutorialMediaTranscoder } from './tutorial-media-transcoder.js';
import {
  createYouTubeMediaAuthorizationVerifier,
  youtubeMediaAuthorizationRegistrySchema,
  type YouTubeMediaAuthorizationRegistry,
} from './youtube-media-authorization.js';
import { createYouTubeMediaSource } from './youtube-media-source.js';

const serviceVersion = '0.1.0';
const invocationContractVersion = '1.0.0';
const maximumVideoDurationMs = 86_400_000;
const defaultMaximumAnalysisWindowMs = 4 * 60 * 60 * 1_000;
const defaultMaximumJobRuntimeMs = 2 * 60 * 60 * 1_000;
const defaultMaximumFrames = 120;
const defaultMaximumConcurrentJobs = 1;
const maximumAudioArtifactBytes = 512 * 1_024 * 1_024;
const maximumFrameArtifactBytes = 32 * 1_024 * 1_024;
const maximumTranscriptArtifactBytes = 16 * 1_024 * 1_024;
const maximumPcmAnalysisWindowMs = Math.floor(
  ((maximumAudioArtifactBytes - 4_096) / (16_000 * 1 * 2)) * 1_000,
);
const versionTimeoutMs = 10_000;
const versionMaximumOutputBytes = 1 * 1_024 * 1_024;
const maximumAuthorizationRegistryBytes = 4 * 1_024 * 1_024;

const environmentNames = {
  artifactBaseDirectory: 'OPERATINGLINE_YOUTUBE_MEDIA_ROOT',
  authorizationRegistryPath: 'OPERATINGLINE_YOUTUBE_MEDIA_AUTHORIZATION_REGISTRY_PATH',
  ffmpegExecutable: 'OPERATINGLINE_FFMPEG_BIN',
  ffprobeExecutable: 'OPERATINGLINE_FFPROBE_BIN',
  frameIntervalMs: 'OPERATINGLINE_YOUTUBE_MEDIA_FRAME_INTERVAL_MS',
  maximumAnalysisWindowMs: 'OPERATINGLINE_YOUTUBE_MEDIA_MAX_ANALYSIS_WINDOW_MS',
  maximumConcurrentJobs: 'OPERATINGLINE_YOUTUBE_MEDIA_MAX_CONCURRENT_JOBS',
  maximumDownloadBytes: 'OPERATINGLINE_YOUTUBE_MEDIA_MAX_DOWNLOAD_BYTES',
  maximumFrames: 'OPERATINGLINE_YOUTUBE_MEDIA_MAX_FRAMES',
  maximumJobRuntimeMs: 'OPERATINGLINE_YOUTUBE_MEDIA_MAX_JOB_RUNTIME_MS',
  supportedLocales: 'OPERATINGLINE_YOUTUBE_MEDIA_LOCALES',
  tesseractExecutable: 'OPERATINGLINE_TESSERACT_BIN',
  tesseractDataDirectory: 'OPERATINGLINE_TESSDATA_DIR',
  whisperExecutable: 'OPERATINGLINE_WHISPER_CPP_BIN',
  whisperModelPath: 'OPERATINGLINE_WHISPER_CPP_MODEL',
  ytDlpExecutable: 'OPERATINGLINE_YT_DLP_BIN',
} as const;

type ToolProvenance = ProcedureTutorialMediaAnalysisResult['tools'][number];
type ToolId = 'yt-dlp' | 'ffprobe' | 'ffmpeg' | 'whisper.cpp' | 'tesseract';

interface ToolDefinition {
  readonly toolId: ToolId;
  readonly executable: string;
  readonly versionArguments: readonly string[];
  readonly environmentPolicy: ToolProvenance['environmentPolicy'];
  readonly dataDirectory?: string | undefined;
  readonly modelPath?: string | undefined;
  readonly trainedDataPaths?: readonly string[] | undefined;
}

interface PreflightTool extends ToolDefinition {
  readonly executableSha256: string;
  readonly modelSha256?: string | undefined;
  readonly toolVersion: string;
  readonly versionOutputSha256: string;
  readonly trainedDataLanguagesSha256?: string | undefined;
}

interface RuntimeToolSnapshots {
  readonly definitions: readonly ToolDefinition[];
  readonly directories: readonly string[];
  readonly root: string;
}

class ProcedureTutorialMediaRuntimeCleanupError extends AggregateError {
  readonly code = 'runtime_cleanup_failed' as const;

  constructor(failures: readonly ('pipeline' | 'snapshots')[]) {
    super(
      failures.map(
        (failure) =>
          new Error(
            failure === 'pipeline'
              ? 'Tutorial media pipeline cleanup failed.'
              : 'Tutorial media snapshot cleanup failed.',
          ),
      ),
      'Tutorial media runtime initialization cleanup failed.',
    );
    this.name = 'ProcedureTutorialMediaRuntimeCleanupError';
  }
}

export interface ProcedureTutorialMediaRuntimeConfiguration {
  readonly artifactBaseDirectory?: string | undefined;
  readonly ytDlpExecutable?: string | undefined;
  readonly ffmpegExecutable?: string | undefined;
  readonly ffprobeExecutable?: string | undefined;
  readonly whisperExecutable?: string | undefined;
  readonly whisperModelPath?: string | undefined;
  readonly tesseractExecutable?: string | undefined;
  readonly tesseractDataDirectory?: string | undefined;
  readonly supportedLocales?: readonly string[] | undefined;
  readonly tesseractLanguageCodes?: Readonly<Record<string, string>> | undefined;
  readonly authorizationRegistry?: YouTubeMediaAuthorizationRegistry | undefined;
  readonly maximumFrames?: number | undefined;
  readonly maximumConcurrentJobs?: number | undefined;
  readonly maximumAnalysisWindowMs?: number | undefined;
  readonly maximumJobRuntimeMs?: number | undefined;
  readonly frameIntervalMs?: number | undefined;
  readonly maximumDownloadBytes?: number | undefined;
}

export type ProcedureTutorialMediaRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type ProcedureTutorialMediaRuntime =
  | {
      readonly capabilities: Extract<
        ProcedureTutorialMediaCapabilities,
        { readonly availability: 'unavailable' }
      >;
      readonly pipeline?: undefined;
      readonly maximumConcurrentJobs?: undefined;
    }
  | {
      readonly capabilities: Extract<
        ProcedureTutorialMediaCapabilities,
        { readonly availability: 'available' }
      >;
      readonly pipeline: ProcedureTutorialMediaPipeline;
      readonly maximumConcurrentJobs: number;
    };

function unavailable(
  reasons: Extract<
    ProcedureTutorialMediaCapabilities,
    { readonly availability: 'unavailable' }
  >['unavailableReasons'],
): ProcedureTutorialMediaRuntime {
  return {
    capabilities: procedureTutorialMediaCapabilitiesSchema.parse({
      availability: 'unavailable',
      formatVersion: '1.0.0',
      serviceId: 'operatingline.youtube_tutorial_media',
      serviceVersion,
      unavailableReasons: [...new Set(reasons)],
    }) as Extract<ProcedureTutorialMediaCapabilities, { readonly availability: 'unavailable' }>,
  };
}

function normalizedAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    resolve(value) === value
  );
}

function positiveSafeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function within(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function requireRegularFile(path: string, executable: boolean): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0 || info.nlink !== 1) {
    throw new Error('unsafe local tool configuration');
  }
  await access(path, executable ? fsConstants.R_OK | fsConstants.X_OK : fsConstants.R_OK);
}

async function prepareArtifactBaseDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700)
  ) {
    throw new Error('unsafe artifact base directory');
  }
}

async function copyRuntimeSnapshot(
  sourcePath: string,
  destinationPath: string,
  executable: boolean,
): Promise<void> {
  await requireRegularFile(sourcePath, executable);
  const sourceHandle = await open(
    sourcePath,
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isFile() || sourceInfo.size <= 0 || sourceInfo.nlink !== 1) {
      throw new Error('unsafe local tool configuration');
    }
    destinationHandle = await open(destinationPath, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(1 * 1_024 * 1_024);
    let copiedBytes = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      let writtenBytes = 0;
      while (writtenBytes < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          writtenBytes,
          bytesRead - writtenBytes,
          null,
        );
        if (result.bytesWritten <= 0) throw new Error('runtime snapshot write failed');
        writtenBytes += result.bytesWritten;
      }
      copiedBytes += bytesRead;
      if (!Number.isSafeInteger(copiedBytes)) throw new Error('runtime snapshot is too large');
    }
    await destinationHandle.sync();
    const finalSourceInfo = await sourceHandle.stat();
    const destinationInfo = await destinationHandle.stat();
    if (
      finalSourceInfo.dev !== sourceInfo.dev ||
      finalSourceInfo.ino !== sourceInfo.ino ||
      finalSourceInfo.size !== sourceInfo.size ||
      destinationInfo.size !== copiedBytes ||
      !destinationInfo.isFile() ||
      destinationInfo.nlink !== 1
    ) {
      throw new Error('runtime snapshot source changed');
    }
    await destinationHandle.chmod(executable ? 0o500 : 0o400);
  } finally {
    await destinationHandle?.close().catch(() => undefined);
    await sourceHandle.close().catch(() => undefined);
  }
}

async function createRuntimeToolSnapshots(
  artifactBaseDirectory: string,
  definitions: readonly ToolDefinition[],
): Promise<RuntimeToolSnapshots> {
  const container = join(artifactBaseDirectory, 'runtime-snapshots');
  await mkdir(container, { mode: 0o700, recursive: true });
  const containerInfo = await lstat(container);
  if (
    containerInfo.isSymbolicLink() ||
    !containerInfo.isDirectory() ||
    (typeof process.getuid === 'function' && containerInfo.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (containerInfo.mode & 0o777) !== 0o700)
  ) {
    throw new Error('unsafe runtime snapshot directory');
  }
  const root = join(container, randomUUID());
  const directories = [root, ...definitions.map((definition) => join(root, definition.toolId))];
  for (const directory of directories) {
    await mkdir(directory, { mode: 0o700 });
    const info = await lstat(directory);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700)
    ) {
      throw new Error('unsafe runtime snapshot directory');
    }
  }
  const snapshots: ToolDefinition[] = [];
  try {
    for (const definition of definitions) {
      const directory = join(root, definition.toolId);
      const executable = join(directory, basename(definition.executable));
      await copyRuntimeSnapshot(definition.executable, executable, true);
      let modelPath: string | undefined;
      if (definition.modelPath !== undefined) {
        modelPath = join(directory, basename(definition.modelPath));
        if (modelPath === executable) throw new Error('runtime snapshot path collision');
        await copyRuntimeSnapshot(definition.modelPath, modelPath, false);
      }
      let dataDirectory: string | undefined;
      let trainedDataPaths: string[] | undefined;
      if (definition.trainedDataPaths !== undefined) {
        if (definition.dataDirectory === undefined || definition.trainedDataPaths.length === 0) {
          throw new Error('invalid runtime model bundle');
        }
        dataDirectory = join(directory, 'tessdata');
        await mkdir(dataDirectory, { mode: 0o700 });
        directories.push(dataDirectory);
        const dataInfo = await lstat(dataDirectory);
        if (
          dataInfo.isSymbolicLink() ||
          !dataInfo.isDirectory() ||
          (typeof process.getuid === 'function' && dataInfo.uid !== process.getuid()) ||
          (process.platform !== 'win32' && (dataInfo.mode & 0o777) !== 0o700)
        ) {
          throw new Error('unsafe runtime snapshot directory');
        }
        trainedDataPaths = [];
        for (const sourcePath of definition.trainedDataPaths) {
          const destinationPath = join(dataDirectory, basename(sourcePath));
          await copyRuntimeSnapshot(sourcePath, destinationPath, false);
          trainedDataPaths.push(destinationPath);
        }
      }
      snapshots.push({
        ...definition,
        ...(dataDirectory === undefined ? {} : { dataDirectory }),
        executable,
        ...(modelPath === undefined ? {} : { modelPath }),
        ...(trainedDataPaths === undefined ? {} : { trainedDataPaths }),
      });
    }
    for (const directory of [...directories].reverse()) await chmod(directory, 0o500);
    return { definitions: snapshots, directories, root };
  } catch (error) {
    await cleanupFailedRuntimeInitialization({ definitions: [], directories, root });
    throw error;
  }
}

async function cleanupRuntimeToolSnapshots(snapshots: RuntimeToolSnapshots): Promise<void> {
  for (const directory of [...snapshots.directories].reverse()) {
    await chmod(directory, 0o700).catch(() => undefined);
  }
  await rm(snapshots.root, { force: true, recursive: true });
}

async function cleanupFailedRuntimeInitialization(
  snapshots: RuntimeToolSnapshots,
  pipeline?: ProcedureTutorialMediaPipeline,
): Promise<void> {
  const failures: Array<'pipeline' | 'snapshots'> = [];
  if (pipeline !== undefined) {
    try {
      await pipeline.close();
    } catch {
      failures.push('pipeline');
    }
  }
  try {
    await cleanupRuntimeToolSnapshots(snapshots);
  } catch {
    failures.push('snapshots');
  }
  if (failures.length > 0) throw new ProcedureTutorialMediaRuntimeCleanupError(failures);
}

async function readPrivateAuthorizationRegistry(
  path: string,
): Promise<YouTubeMediaAuthorizationRegistry> {
  if (!normalizedAbsolutePath(path)) throw new Error('invalid registry path');
  const pathInfo = await lstat(path);
  if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
    throw new Error('unsafe authorization registry');
  }
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.dev !== pathInfo.dev ||
      info.ino !== pathInfo.ino ||
      info.size <= 0 ||
      info.size > maximumAuthorizationRegistryBytes ||
      info.nlink !== 1 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    ) {
      throw new Error('unsafe authorization registry');
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== info.size) throw new Error('authorization registry changed');
    return youtubeMediaAuthorizationRegistrySchema.parse(JSON.parse(bytes.toString('utf8')));
  } finally {
    await handle.close();
  }
}

function environmentValue(
  environment: ProcedureTutorialMediaRuntimeEnvironment,
  name: string,
): string | undefined {
  const value = environment[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function environmentPositiveInteger(
  environment: ProcedureTutorialMediaRuntimeEnvironment,
  name: string,
): number | undefined {
  const value = environmentValue(environment, name);
  if (value === undefined) return;
  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

function environmentLocales(
  environment: ProcedureTutorialMediaRuntimeEnvironment,
): readonly string[] | undefined {
  const value = environmentValue(environment, environmentNames.supportedLocales);
  if (value === undefined) return;
  return value.split(',').map((locale) => locale.trim());
}

function toolVersion(output: Uint8Array): string {
  const text = Buffer.from(output).toString('utf8');
  const match = text.match(/\b\d+(?:\.\d+){1,3}(?:[-+._][A-Za-z0-9]+)*\b/u)?.[0];
  if (match === undefined || match.length > 64) throw new Error('unusable tool version');
  return match;
}

function toolDefinitions(config: {
  readonly ytDlpExecutable: string;
  readonly ffmpegExecutable: string;
  readonly ffprobeExecutable: string;
  readonly whisperExecutable: string;
  readonly whisperModelPath: string;
  readonly tesseractExecutable: string;
  readonly tesseractDataDirectory: string;
  readonly tesseractLanguages: readonly string[];
}): readonly ToolDefinition[] {
  return [
    {
      environmentPolicy: 'network_download_only',
      executable: config.ytDlpExecutable,
      toolId: 'yt-dlp',
      versionArguments: ['--version'],
    },
    {
      environmentPolicy: 'local_media_processing_no_network',
      executable: config.ffprobeExecutable,
      toolId: 'ffprobe',
      versionArguments: ['-version'],
    },
    {
      environmentPolicy: 'local_media_processing_no_network',
      executable: config.ffmpegExecutable,
      toolId: 'ffmpeg',
      versionArguments: ['-version'],
    },
    {
      environmentPolicy: 'local_inference_no_network',
      executable: config.whisperExecutable,
      modelPath: config.whisperModelPath,
      toolId: 'whisper.cpp',
      versionArguments: ['--version'],
    },
    {
      dataDirectory: config.tesseractDataDirectory,
      environmentPolicy: 'local_inference_no_network',
      executable: config.tesseractExecutable,
      trainedDataPaths: config.tesseractLanguages.map((language) =>
        join(config.tesseractDataDirectory, `${language}.traineddata`),
      ),
      toolId: 'tesseract',
      versionArguments: ['--version'],
    },
  ];
}

async function modelBundleSha256(definition: ToolDefinition): Promise<string | undefined> {
  const paths = [
    ...(definition.modelPath === undefined ? [] : [definition.modelPath]),
    ...(definition.trainedDataPaths ?? []),
  ];
  if (paths.length === 0) return;
  const entries = await Promise.all(
    paths.map(async (path) => ({ name: basename(path), sha256: await fileSha256(path) })),
  );
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries.length === 1
    ? entries[0]!.sha256
    : sha256(canonicalizeProtocolJsonValue({ files: entries }));
}

async function preflightTools(
  definitions: readonly ToolDefinition[],
): Promise<{ readonly tools: readonly PreflightTool[]; readonly tesseractLanguages: Set<string> }> {
  const runner = createTutorialMediaProcessRunner();
  try {
    const tools: PreflightTool[] = [];
    for (const definition of definitions) {
      await requireRegularFile(definition.executable, true);
      if (definition.modelPath !== undefined) await requireRegularFile(definition.modelPath, false);
      for (const path of definition.trainedDataPaths ?? []) await requireRegularFile(path, false);
      const result = await runner.run(
        {
          args: definition.versionArguments,
          cwd: resolve(definition.executable, '..'),
          executable: definition.executable,
        },
        { maximumOutputBytes: versionMaximumOutputBytes, timeoutMs: versionTimeoutMs },
      );
      const versionOutput = Buffer.concat([result.stdout, result.stderr]);
      const modelSha256 = await modelBundleSha256(definition);
      tools.push({
        ...definition,
        executableSha256: await fileSha256(definition.executable),
        ...(modelSha256 === undefined ? {} : { modelSha256 }),
        toolVersion: toolVersion(versionOutput),
        versionOutputSha256: sha256(versionOutput),
      });
    }
    const tesseract = definitions.find((tool) => tool.toolId === 'tesseract')!;
    const languagesResult = await runner.run(
      {
        args: [
          '--list-langs',
          ...(tesseract.dataDirectory === undefined
            ? []
            : ['--tessdata-dir', tesseract.dataDirectory]),
        ],
        cwd: resolve(tesseract.executable, '..'),
        executable: tesseract.executable,
      },
      { maximumOutputBytes: versionMaximumOutputBytes, timeoutMs: versionTimeoutMs },
    );
    const languageOutput = Buffer.from(languagesResult.stdout);
    const languages = new Set(
      languageOutput
        .toString('utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z0-9_]{2,32}$/u.test(line)),
    );
    if (languages.size === 0) throw new Error('no tesseract languages');
    const tesseractIndex = tools.findIndex((tool) => tool.toolId === 'tesseract');
    tools[tesseractIndex] = {
      ...tools[tesseractIndex]!,
      trainedDataLanguagesSha256: sha256(languageOutput),
    };
    return { tesseractLanguages: languages, tools };
  } finally {
    await runner.close();
  }
}

function normalizeInvocationValue(
  value: string,
  jobDirectory: string,
  artifactBaseDirectory: string,
  tools: readonly PreflightTool[],
): string {
  const executable = tools.find((tool) => tool.executable === value);
  if (executable !== undefined) return `<tool:${executable.toolId}>`;
  const model = tools.find((tool) => tool.modelPath === value);
  if (model !== undefined) return `<model:${model.toolId}>`;
  const dataDirectory = tools.find((tool) => tool.dataDirectory === value);
  if (dataDirectory !== undefined) return `<model-directory:${dataDirectory.toolId}>`;
  if (!normalizedAbsolutePath(value)) return value;
  if (within(jobDirectory, value)) {
    const suffix = relative(jobDirectory, value).split(sep).join('/');
    return suffix === '' ? '<job>' : `<job>/${suffix}`;
  }
  if (within(artifactBaseDirectory, value)) {
    const suffix = relative(artifactBaseDirectory, value).split(sep).join('/');
    return suffix === '' ? '<cas>' : `<cas>/${suffix}`;
  }
  return '<absolute-local-path>';
}

function configurationSha256(
  tool: PreflightTool,
  config: {
    readonly supportedLocales: readonly string[];
    readonly tesseractLanguageCodes: Readonly<Record<string, string>>;
    readonly maximumFrames: number;
    readonly maximumAnalysisWindowMs: number;
    readonly maximumJobRuntimeMs: number;
    readonly frameIntervalMs: number;
    readonly maximumDownloadBytes: number;
    readonly authorizationRegistrySha256: string;
  },
): string {
  return sha256(
    canonicalizeProtocolJsonValue({
      executableSha256: tool.executableSha256,
      authorizationRegistrySha256:
        tool.toolId === 'yt-dlp' ? config.authorizationRegistrySha256 : null,
      invocationContractVersion,
      maximumAnalysisWindowMs: config.maximumAnalysisWindowMs,
      maximumDownloadBytes: config.maximumDownloadBytes,
      maximumFrames: config.maximumFrames,
      maximumJobRuntimeMs: config.maximumJobRuntimeMs,
      frameIntervalMs: config.frameIntervalMs,
      modelSha256: tool.modelSha256 ?? null,
      supportedLocales: config.supportedLocales,
      tesseractLanguageCodes: tool.toolId === 'tesseract' ? config.tesseractLanguageCodes : {},
      trainedDataLanguagesSha256: tool.trainedDataLanguagesSha256 ?? null,
      toolId: tool.toolId,
      versionOutputSha256: tool.versionOutputSha256,
    }),
  );
}

function createJobProvenance(
  tools: readonly PreflightTool[],
  jobDirectory: string,
  artifactBaseDirectory: string,
  config: Parameters<typeof configurationSha256>[1],
) {
  const invocations = new Map<ToolId, unknown[]>();
  const toolByExecutable = new Map(tools.map((tool) => [tool.executable, tool]));
  const observe = (command: Readonly<TutorialMediaProcessCommand>) => {
    const tool = toolByExecutable.get(command.executable);
    if (tool === undefined) throw new Error('unrecognized tutorial media executable');
    const normalized = {
      args: (command.args ?? []).map((argument) =>
        normalizeInvocationValue(argument, jobDirectory, artifactBaseDirectory, tools),
      ),
      cwd: normalizeInvocationValue(command.cwd, jobDirectory, artifactBaseDirectory, tools),
      environmentNames: Object.keys(command.environment ?? {}).sort(),
      executable: `<tool:${tool.toolId}>`,
      stdinSha256:
        command.stdin === undefined
          ? null
          : sha256(
              typeof command.stdin === 'string'
                ? Buffer.from(command.stdin, 'utf8')
                : command.stdin,
            ),
    };
    invocations.set(tool.toolId, [...(invocations.get(tool.toolId) ?? []), normalized]);
  };
  const provenance = (): readonly ToolProvenance[] =>
    tools.map((tool) => {
      const actualInvocations = invocations.get(tool.toolId) ?? [];
      if (actualInvocations.length === 0) throw new Error('required media tool was not invoked');
      return {
        configurationSha256: configurationSha256(tool, config),
        environmentPolicy: tool.environmentPolicy,
        executableSha256: tool.executableSha256,
        invocationContractVersion,
        ...(tool.modelSha256 === undefined ? {} : { modelSha256: tool.modelSha256 }),
        normalizedInvocationSha256: sha256(canonicalizeProtocolJsonValue(actualInvocations)),
        toolId: tool.toolId,
        toolVersion: tool.toolVersion,
        versionOutputSha256: tool.versionOutputSha256,
      };
    });
  return { observe, provenance };
}

export async function createProcedureTutorialMediaRuntime(
  input: ProcedureTutorialMediaRuntimeConfiguration,
): Promise<ProcedureTutorialMediaRuntime> {
  if (input.authorizationRegistry === undefined) {
    return unavailable(['authorization_registry_missing']);
  }
  if (process.platform === 'win32') return unavailable(['unsupported_platform']);
  const pathValues = [
    input.artifactBaseDirectory,
    input.ytDlpExecutable,
    input.ffmpegExecutable,
    input.ffprobeExecutable,
    input.whisperExecutable,
    input.whisperModelPath,
    input.tesseractExecutable,
    input.tesseractDataDirectory,
  ];
  if (pathValues.some((value) => !normalizedAbsolutePath(value))) {
    return unavailable(['not_configured']);
  }
  const supportedLocales = input.supportedLocales?.map((locale) => locale.toLowerCase());
  const maximumFrames = input.maximumFrames ?? defaultMaximumFrames;
  const maximumConcurrentJobs = input.maximumConcurrentJobs ?? defaultMaximumConcurrentJobs;
  const maximumAnalysisWindowMs = input.maximumAnalysisWindowMs ?? defaultMaximumAnalysisWindowMs;
  const maximumJobRuntimeMs = input.maximumJobRuntimeMs ?? defaultMaximumJobRuntimeMs;
  const frameIntervalMs = input.frameIntervalMs ?? 5_000;
  const maximumDownloadBytes = input.maximumDownloadBytes ?? 8 * 1_024 * 1_024 * 1_024;
  if (
    supportedLocales === undefined ||
    supportedLocales.length === 0 ||
    supportedLocales.length > 1_000 ||
    new Set(supportedLocales).size !== supportedLocales.length ||
    supportedLocales.some(
      (locale) =>
        locale.length < 2 || locale.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(locale),
    ) ||
    !positiveSafeInteger(maximumFrames, procedureTutorialMediaFrameMaxCount) ||
    !positiveSafeInteger(maximumConcurrentJobs, 1_000) ||
    !positiveSafeInteger(
      maximumAnalysisWindowMs,
      Math.min(maximumVideoDurationMs, maximumPcmAnalysisWindowMs),
    ) ||
    !positiveSafeInteger(maximumJobRuntimeMs, maximumVideoDurationMs) ||
    !positiveSafeInteger(frameIntervalMs, maximumVideoDurationMs) ||
    !positiveSafeInteger(maximumDownloadBytes, 100_000_000_000)
  ) {
    return unavailable(['not_configured']);
  }
  const configuredPaths = {
    artifactBaseDirectory: input.artifactBaseDirectory!,
    ffmpegExecutable: input.ffmpegExecutable!,
    ffprobeExecutable: input.ffprobeExecutable!,
    tesseractDataDirectory: input.tesseractDataDirectory!,
    tesseractExecutable: input.tesseractExecutable!,
    whisperExecutable: input.whisperExecutable!,
    whisperModelPath: input.whisperModelPath!,
    ytDlpExecutable: input.ytDlpExecutable!,
  };
  let authorizationVerifier;
  try {
    authorizationVerifier = createYouTubeMediaAuthorizationVerifier(input.authorizationRegistry);
  } catch {
    return unavailable(['authorization_registry_missing']);
  }
  try {
    await prepareArtifactBaseDirectory(configuredPaths.artifactBaseDirectory);
  } catch {
    return unavailable(['preflight_failed']);
  }
  const tesseractLanguageCodes = input.tesseractLanguageCodes ?? {};
  const resolvedTesseractLanguages = supportedLocales.map((locale) => ({
    language: locale.split('-')[0],
    tesseract: resolveTesseractLanguageCode(locale, tesseractLanguageCodes),
  }));
  if (
    resolvedTesseractLanguages.some(
      ({ language, tesseract }) =>
        language === undefined || !/^[a-z]{2,3}$/u.test(language) || tesseract === undefined,
    )
  ) {
    return unavailable(['preflight_failed']);
  }
  const tesseractLanguages = [
    ...new Set(resolvedTesseractLanguages.map(({ tesseract }) => tesseract!)),
  ].sort();
  const configuredDefinitions = toolDefinitions({
    ...configuredPaths,
    tesseractLanguages,
  });
  let snapshots: RuntimeToolSnapshots | undefined;
  let preflight: Awaited<ReturnType<typeof preflightTools>>;
  try {
    snapshots = await createRuntimeToolSnapshots(
      configuredPaths.artifactBaseDirectory,
      configuredDefinitions,
    );
    preflight = await preflightTools(snapshots.definitions);
  } catch (error) {
    if (error instanceof ProcedureTutorialMediaRuntimeCleanupError) throw error;
    if (snapshots !== undefined) await cleanupFailedRuntimeInitialization(snapshots);
    const missingTool = await Promise.all(
      configuredDefinitions.map((tool) => lstat(tool.executable).catch(() => undefined)),
    );
    const modelPaths = configuredDefinitions.flatMap((definition) => [
      ...(definition.modelPath === undefined ? [] : [definition.modelPath]),
      ...(definition.trainedDataPaths ?? []),
    ]);
    const models = await Promise.all(modelPaths.map((path) => lstat(path).catch(() => undefined)));
    if (missingTool.some((info) => info === undefined)) return unavailable(['tool_missing']);
    if (models.some((info) => info === undefined)) return unavailable(['model_missing']);
    return unavailable(['preflight_failed']);
  }
  if (snapshots === undefined) return unavailable(['preflight_failed']);
  const runtimeSnapshots = snapshots;
  let initializedPipeline: ProcedureTutorialMediaPipeline | undefined;
  try {
    const snapshotByToolId = new Map(
      runtimeSnapshots.definitions.map((definition) => [definition.toolId, definition]),
    );
    const paths = {
      artifactBaseDirectory: configuredPaths.artifactBaseDirectory,
      ffmpegExecutable: snapshotByToolId.get('ffmpeg')!.executable,
      ffprobeExecutable: snapshotByToolId.get('ffprobe')!.executable,
      tesseractDataDirectory: snapshotByToolId.get('tesseract')!.dataDirectory!,
      tesseractExecutable: snapshotByToolId.get('tesseract')!.executable,
      whisperExecutable: snapshotByToolId.get('whisper.cpp')!.executable,
      whisperModelPath: snapshotByToolId.get('whisper.cpp')!.modelPath!,
      ytDlpExecutable: snapshotByToolId.get('yt-dlp')!.executable,
    };
    if (tesseractLanguages.some((language) => !preflight.tesseractLanguages.has(language))) {
      await cleanupFailedRuntimeInitialization(runtimeSnapshots);
      return unavailable(['preflight_failed']);
    }
    const runtimeConfig = {
      authorizationRegistrySha256: sha256(
        canonicalizeProtocolJsonValue(input.authorizationRegistry),
      ),
      frameIntervalMs,
      maximumAnalysisWindowMs,
      maximumDownloadBytes,
      maximumFrames,
      maximumJobRuntimeMs,
      supportedLocales,
      tesseractLanguageCodes,
    };
    const placeholderInvocationSha256 = sha256(canonicalizeProtocolJsonValue([]));
    const store = createTutorialMediaArtifactStore({
      baseDirectory: paths.artifactBaseDirectory,
      maximumArtifactBytes: Math.max(
        maximumDownloadBytes,
        maximumAudioArtifactBytes,
        maximumFrameArtifactBytes,
        maximumTranscriptArtifactBytes,
      ),
    });
    const basePipeline = createProcedureTutorialMediaPipeline({
      createAdapters(jobDirectory) {
        const jobProvenance = createJobProvenance(
          preflight.tools,
          jobDirectory,
          paths.artifactBaseDirectory,
          runtimeConfig,
        );
        const runner = createTutorialMediaProcessRunner({ onInvocation: jobProvenance.observe });
        return {
          asr: createTutorialMediaAsr({
            executable: paths.whisperExecutable,
            jobDirectory,
            modelPath: paths.whisperModelPath,
            runner,
          }),
          async close() {
            await runner.close();
          },
          ocr: createTutorialMediaOcr({
            executable: paths.tesseractExecutable,
            jobDirectory,
            languageCodes: tesseractLanguageCodes,
            runner,
            tessdataDirectory: paths.tesseractDataDirectory,
          }),
          probe: createTutorialMediaProbe({
            executable: paths.ffprobeExecutable,
            jobDirectory,
            runner,
          }),
          source: createYouTubeMediaSource({
            authorizationVerifier,
            executable: paths.ytDlpExecutable,
            ffmpegExecutable: paths.ffmpegExecutable,
            jobDirectory,
            maximumDownloadBytes,
            runner,
          }),
          toolProvenance: async () => jobProvenance.provenance(),
          transcoder: createTutorialMediaTranscoder({
            executable: paths.ffmpegExecutable,
            jobDirectory,
            maximumAudioBytes: maximumAudioArtifactBytes,
            maximumFrameBytes: maximumFrameArtifactBytes,
            runner,
          }),
        };
      },
      frameIntervalMs,
      maximumAnalysisWindowMs,
      maximumFrames,
      maximumJobRuntimeMs,
      maximumStagingBytes: Math.max(
        maximumDownloadBytes,
        maximumAudioArtifactBytes,
        maximumFrameArtifactBytes,
        maximumTranscriptArtifactBytes,
      ),
      store,
      supportedLocales,
      tools: preflight.tools.map((tool) => ({
        configurationSha256: configurationSha256(tool, runtimeConfig),
        environmentPolicy: tool.environmentPolicy,
        executableSha256: tool.executableSha256,
        invocationContractVersion,
        ...(tool.modelSha256 === undefined ? {} : { modelSha256: tool.modelSha256 }),
        normalizedInvocationSha256: placeholderInvocationSha256,
        toolId: tool.toolId,
        toolVersion: tool.toolVersion,
        versionOutputSha256: tool.versionOutputSha256,
      })),
    });
    initializedPipeline = basePipeline;
    let closePromise: Promise<void> | undefined;
    const pipeline: ProcedureTutorialMediaPipeline = {
      analyze: (...arguments_) => basePipeline.analyze(...arguments_),
      close() {
        closePromise ??= (async () => {
          const errors: unknown[] = [];
          try {
            await basePipeline.close();
          } catch (error) {
            errors.push(error);
          }
          try {
            await cleanupRuntimeToolSnapshots(runtimeSnapshots);
          } catch (error) {
            errors.push(error);
          }
          if (errors.length > 0) {
            throw new AggregateError(errors, 'Tutorial media runtime cleanup failed.');
          }
        })();
        return closePromise;
      },
      verify: (...arguments_) => basePipeline.verify(...arguments_),
    };
    const capabilities = procedureTutorialMediaCapabilitiesSchema.parse({
      analysisProfiles: ['youtube_tutorial_evidence_v1'],
      artifactMediaTypes: ['video/mp4', 'audio/wav', 'image/png', 'application/json'],
      availability: 'available',
      features: {
        contentAddressedArtifacts: true,
        credentialFreePublicProtocol: true,
        deterministicSegmentation: true,
        explicitFullRestartAfterFailure: true,
        ocrTextCandidates: true,
        resumableJobs: false,
        shortcutCandidates: true,
        uiElementRecognition: false,
      },
      formatVersion: '1.0.0',
      limits: {
        maxAnalysisWindowMs: maximumAnalysisWindowMs,
        maxConcurrentJobs: maximumConcurrentJobs,
        maxFrames: maximumFrames,
        maxJobRuntimeMs: maximumJobRuntimeMs,
        maxVideoDurationMs: maximumVideoDurationMs,
      },
      serviceId: 'operatingline.youtube_tutorial_media',
      serviceVersion,
      stages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
      supportedLocales,
    }) as Extract<ProcedureTutorialMediaCapabilities, { readonly availability: 'available' }>;
    return { capabilities, maximumConcurrentJobs, pipeline };
  } catch (error) {
    if (error instanceof ProcedureTutorialMediaRuntimeCleanupError) throw error;
    await cleanupFailedRuntimeInitialization(runtimeSnapshots, initializedPipeline);
    return unavailable(['preflight_failed']);
  }
}

export async function createProcedureTutorialMediaRuntimeFromEnvironment(
  environment: ProcedureTutorialMediaRuntimeEnvironment,
): Promise<ProcedureTutorialMediaRuntime> {
  const knownNames = Object.values(environmentNames);
  if (knownNames.every((name) => environmentValue(environment, name) === undefined)) {
    return unavailable(['not_configured']);
  }
  if (process.platform === 'win32') return unavailable(['unsupported_platform']);
  const artifactBaseDirectory = environmentValue(
    environment,
    environmentNames.artifactBaseDirectory,
  );
  const ytDlpExecutable = environmentValue(environment, environmentNames.ytDlpExecutable);
  const ffmpegExecutable = environmentValue(environment, environmentNames.ffmpegExecutable);
  const ffprobeExecutable = environmentValue(environment, environmentNames.ffprobeExecutable);
  const whisperExecutable = environmentValue(environment, environmentNames.whisperExecutable);
  const whisperModelPath = environmentValue(environment, environmentNames.whisperModelPath);
  const tesseractExecutable = environmentValue(environment, environmentNames.tesseractExecutable);
  const tesseractDataDirectory = environmentValue(
    environment,
    environmentNames.tesseractDataDirectory,
  );
  const supportedLocales = environmentLocales(environment);
  if (
    [
      artifactBaseDirectory,
      ytDlpExecutable,
      ffmpegExecutable,
      ffprobeExecutable,
      whisperExecutable,
      whisperModelPath,
      tesseractExecutable,
      tesseractDataDirectory,
      supportedLocales,
    ].some((value) => value === undefined)
  ) {
    return unavailable(['not_configured']);
  }
  const registryPath = environmentValue(environment, environmentNames.authorizationRegistryPath);
  if (registryPath === undefined) return unavailable(['authorization_registry_missing']);
  let authorizationRegistry: YouTubeMediaAuthorizationRegistry;
  try {
    authorizationRegistry = await readPrivateAuthorizationRegistry(registryPath);
  } catch {
    return unavailable(['preflight_failed']);
  }
  return createProcedureTutorialMediaRuntime({
    artifactBaseDirectory,
    authorizationRegistry,
    ffmpegExecutable,
    ffprobeExecutable,
    frameIntervalMs: environmentPositiveInteger(environment, environmentNames.frameIntervalMs),
    maximumAnalysisWindowMs: environmentPositiveInteger(
      environment,
      environmentNames.maximumAnalysisWindowMs,
    ),
    maximumConcurrentJobs: environmentPositiveInteger(
      environment,
      environmentNames.maximumConcurrentJobs,
    ),
    maximumDownloadBytes: environmentPositiveInteger(
      environment,
      environmentNames.maximumDownloadBytes,
    ),
    maximumFrames: environmentPositiveInteger(environment, environmentNames.maximumFrames),
    maximumJobRuntimeMs: environmentPositiveInteger(
      environment,
      environmentNames.maximumJobRuntimeMs,
    ),
    supportedLocales,
    tesseractDataDirectory,
    tesseractExecutable,
    whisperExecutable,
    whisperModelPath,
    ytDlpExecutable,
  });
}
