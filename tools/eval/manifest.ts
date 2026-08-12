import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildProviderEvalCaptureManifestTemplate,
  computeHumanEvalContentSha256,
  preparePrivateHumanEvalDirectory,
  writeHumanEvalFileAtomicExclusive,
  type ProviderEvalCapturePageInput,
} from '@operatingline/eval-kit';
import {
  currentEvalExportBundleSchema,
  humanEvalSuiteSchema,
  type CurrentEvalExportBundle,
  type HumanEvalDataHandling,
} from '@operatingline/protocol';

import type { EvalCaptureManifestV1 } from './capture.js';
import {
  assertAvailableHostArtifactIds,
  readLocalHostArtifactFiles,
  resolveAuthorizedHostCapture,
  verifyRuntimeHostArtifactFiles,
} from './host-artifact-evidence.js';

const maximumJsonBytes = 32 * 1024 * 1024;
const maximumSnapshotBytes = 256 * 1024 * 1024;
const maximumSnapshotPages = 10_000;

interface StoredSnapshotManifest {
  readonly formatVersion: '1.0.0';
  readonly scope: CurrentEvalExportBundle['scope'];
  readonly snapshotId: string;
  readonly snapshotUpperSequence: number;
  readonly pages: readonly {
    readonly filename: string;
    readonly exportId: string;
    readonly contentSha256: string;
  }[];
}

export interface EvalManifestCliOptions {
  readonly suitePath: string;
  readonly snapshotDirectory: string;
  readonly caseId: string;
  readonly generationRequestId: string;
  readonly runId: string;
  readonly replicateIndex: number;
  readonly parentRunId: string | null;
  readonly recorderName: string;
  readonly recorderVersion: string;
  readonly vendorRequestId: string | null;
  readonly operatingLineVersion: string;
  readonly sourceCommit: string | null;
  readonly hostExecutionId: string | null;
  readonly terminalHostReportId: string | null;
  readonly hostProjectPath: string | null;
  readonly renderedImagePath: string | null;
  readonly outputRoot: string;
  readonly outputPath: string;
}

const localDataHandling: HumanEvalDataHandling = {
  redaction: 'none',
  containsPotentiallySensitiveContent: true,
  permittedUses: ['local_eval'],
  trainingUse: 'not_authorized',
  publicRelease: 'not_reviewed',
  warning:
    'Offline capture contains unredacted local evaluation evidence. It is not reviewed for public release and is not authorized for training use.',
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

async function readRegularFile(pathInput: string, label: string): Promise<Buffer> {
  const path = resolve(pathInput);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link`);
  }
  if (metadata.size > maximumJsonBytes)
    throw new Error(`${label} exceeds ${maximumJsonBytes} bytes`);
  return readFile(path);
}

function parseStoredSnapshot(value: unknown): StoredSnapshotManifest {
  const input = object(value, 'snapshot.json');
  requireKeys(
    input,
    ['formatVersion', 'scope', 'snapshotId', 'snapshotUpperSequence', 'pages', 'dataHandling'],
    'snapshot.json',
  );
  if (input['formatVersion'] !== '1.0.0' || !Array.isArray(input['pages'])) {
    throw new Error('snapshot.json must be a version 1.0.0 stored Eval snapshot');
  }
  const scope = object(input['scope'], 'snapshot scope');
  requireKeys(scope, ['targetAdapterId', 'planId', 'instanceId'], 'snapshot scope');
  const handling = object(input['dataHandling'], 'snapshot dataHandling');
  requireKeys(
    handling,
    ['containsPotentiallySensitiveContent', 'credentialsStored', 'warning'],
    'snapshot dataHandling',
  );
  if (
    handling['containsPotentiallySensitiveContent'] !== true ||
    handling['credentialsStored'] !== false ||
    typeof handling['warning'] !== 'string' ||
    handling['warning'].trim() === ''
  ) {
    throw new Error('snapshot.json must declare sensitive handling without stored credentials');
  }
  if (
    typeof input['snapshotId'] !== 'string' ||
    !Number.isSafeInteger(input['snapshotUpperSequence']) ||
    typeof scope['targetAdapterId'] !== 'string' ||
    typeof scope['planId'] !== 'string' ||
    (scope['instanceId'] !== null && typeof scope['instanceId'] !== 'string')
  ) {
    throw new Error('snapshot.json identity and scope are invalid');
  }
  const pages = input['pages'].map((value, index) => {
    const page = object(value, `snapshot page ${index + 1}`);
    requireKeys(page, ['filename', 'exportId', 'contentSha256'], `snapshot page ${index + 1}`);
    if (
      typeof page['filename'] !== 'string' ||
      page['filename'].trim() === '' ||
      typeof page['exportId'] !== 'string' ||
      typeof page['contentSha256'] !== 'string'
    ) {
      throw new Error(`snapshot page ${index + 1} identity is required`);
    }
    return {
      filename: page['filename'],
      exportId: page['exportId'],
      contentSha256: page['contentSha256'],
    };
  });
  if (pages.length === 0 || pages.length > maximumSnapshotPages) {
    throw new Error(`snapshot.json must reference between 1 and ${maximumSnapshotPages} pages`);
  }
  if (new Set(pages.map((page) => page.filename)).size !== pages.length) {
    throw new Error('snapshot.json page filenames must be unique');
  }
  return {
    formatVersion: '1.0.0',
    scope: scope as unknown as StoredSnapshotManifest['scope'],
    snapshotId: input['snapshotId'],
    snapshotUpperSequence: input['snapshotUpperSequence'] as number,
    pages,
  };
}

async function loadSnapshotPages(
  snapshotDirectoryInput: string,
): Promise<ProviderEvalCapturePageInput[]> {
  const snapshotDirectory = resolve(snapshotDirectoryInput);
  const rootMetadata = await lstat(snapshotDirectory);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('--snapshot must be a directory and must not be a symbolic link');
  }
  const physicalRoot = await realpath(snapshotDirectory);
  const manifestBytes = await readRegularFile(
    resolve(snapshotDirectory, 'snapshot.json'),
    'snapshot.json',
  );
  const snapshot = parseStoredSnapshot(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  const pages: ProviderEvalCapturePageInput[] = [];
  let snapshotBytes = 0;
  for (const [index, declared] of snapshot.pages.entries()) {
    if (isAbsolute(declared.filename)) {
      throw new Error(`snapshot page ${index + 1} filename must be relative`);
    }
    const candidate = resolve(snapshotDirectory, declared.filename);
    if (!isWithin(snapshotDirectory, candidate)) {
      throw new Error(`snapshot page ${index + 1} escapes the snapshot directory`);
    }
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`snapshot page ${index + 1} must be a regular file and not a symbolic link`);
    }
    const physicalCandidate = await realpath(candidate);
    if (!isWithin(physicalRoot, physicalCandidate)) {
      throw new Error(`snapshot page ${index + 1} resolves outside the snapshot directory`);
    }
    const bytes = await readRegularFile(candidate, `snapshot page ${index + 1}`);
    snapshotBytes += bytes.byteLength;
    if (snapshotBytes > maximumSnapshotBytes) {
      throw new Error(`snapshot pages exceed ${maximumSnapshotBytes} total bytes`);
    }
    const bundle = currentEvalExportBundleSchema.parse(
      JSON.parse(bytes.toString('utf8')) as unknown,
    );
    if (
      bundle.exportId !== declared.exportId ||
      bundle.integrity.contentSha256 !== declared.contentSha256 ||
      bundle.page.snapshotId !== snapshot.snapshotId ||
      bundle.page.snapshotUpperSequence !== snapshot.snapshotUpperSequence ||
      computeHumanEvalContentSha256(bundle.scope) !== computeHumanEvalContentSha256(snapshot.scope)
    ) {
      throw new Error(`snapshot page ${index + 1} does not match snapshot.json`);
    }
    pages.push({
      artifactId: `eval.${bundle.page.snapshotId}.page.${String(index + 1).padStart(4, '0')}`,
      uri: `local-eval-snapshot://${encodeURIComponent(declared.filename)}`,
      bytes,
      bundle,
    });
  }
  return pages;
}

function nullable(value: string | undefined): string | null {
  return value === undefined || value === 'none' ? null : value;
}

export function parseEvalManifestCliOptions(arguments_: readonly string[]): EvalManifestCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('Eval manifest arguments must use --name value pairs');
    }
    if (values.has(name)) throw new Error(`Duplicate Eval manifest argument ${name}`);
    values.set(name, value);
  }
  const allowed = new Set([
    '--suite',
    '--snapshot',
    '--case',
    '--request',
    '--run',
    '--replicate',
    '--parent-run',
    '--recorder-name',
    '--recorder-version',
    '--vendor-request',
    '--operating-line-version',
    '--source-commit',
    '--host-execution',
    '--host-report',
    '--host-project',
    '--rendered-image',
    '--out-root',
    '--out',
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown Eval manifest argument ${name}`);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.trim() === '') {
      throw new Error(`Missing required Eval manifest argument ${name}`);
    }
    return value;
  };
  const replicateIndex = Number(required('--replicate'));
  if (!Number.isSafeInteger(replicateIndex) || replicateIndex < 1) {
    throw new Error('--replicate must be a positive integer');
  }
  const sourceCommit = nullable(required('--source-commit'));
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('--source-commit must be 40 lowercase hexadecimal characters or none');
  }
  const hostInputs = [
    values.get('--host-execution'),
    values.get('--host-report'),
    values.get('--host-project'),
    values.get('--rendered-image'),
  ];
  if (
    hostInputs.some((value) => value !== undefined) &&
    hostInputs.some((value) => value === undefined)
  ) {
    throw new Error(
      '--host-execution, --host-report, --host-project, and --rendered-image must be provided together as one quartet',
    );
  }
  if (
    hostInputs.some(
      (value) => value !== undefined && (value.trim() === '' || value.trim() === 'none'),
    )
  ) {
    throw new Error('Runtime host manifest arguments must be non-empty');
  }
  return {
    suitePath: required('--suite'),
    snapshotDirectory: required('--snapshot'),
    caseId: required('--case'),
    generationRequestId: required('--request'),
    runId: required('--run'),
    replicateIndex,
    parentRunId: nullable(values.get('--parent-run')),
    recorderName: required('--recorder-name'),
    recorderVersion: required('--recorder-version'),
    vendorRequestId: nullable(values.get('--vendor-request')),
    operatingLineVersion: required('--operating-line-version'),
    sourceCommit,
    hostExecutionId: nullable(values.get('--host-execution')),
    terminalHostReportId: nullable(values.get('--host-report')),
    hostProjectPath: nullable(values.get('--host-project')),
    renderedImagePath: nullable(values.get('--rendered-image')),
    outputRoot: required('--out-root'),
    outputPath: required('--out'),
  };
}

export async function writeEvalCaptureManifestAtomicExclusive(
  outputPathInput: string,
  manifest: EvalCaptureManifestV1,
  outputRootInput: string,
): Promise<void> {
  const outputPath = resolve(outputPathInput);
  const outputRoot = resolve(outputRootInput);
  const rootMetadata = await lstat(outputRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('--out-root must be an existing directory and must not be a symbolic link');
  }
  await preparePrivateHumanEvalDirectory(outputRoot, outputRoot);
  await writeHumanEvalFileAtomicExclusive(
    outputPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    outputRoot,
  );
}

export async function runEvalManifestCli(
  arguments_: readonly string[],
): Promise<EvalCaptureManifestV1> {
  const options = parseEvalManifestCliOptions(arguments_);
  const outputRoot = resolve(options.outputRoot);
  const outputPath = resolve(options.outputPath);
  if (!isWithin(outputRoot, outputPath)) {
    throw new Error('--out escapes its configured root');
  }
  const suiteBytes = await readRegularFile(options.suitePath, '--suite');
  const suite = humanEvalSuiteSchema.parse(JSON.parse(suiteBytes.toString('utf8')) as unknown);
  const exportPages = await loadSnapshotPages(options.snapshotDirectory);
  const coreManifest = buildProviderEvalCaptureManifestTemplate({
    suite,
    exportPages,
    caseId: options.caseId,
    generationRequestId: options.generationRequestId,
    runId: options.runId,
    replicateIndex: options.replicateIndex,
    parentRunId: options.parentRunId,
    environment: {
      operatingLineVersion: options.operatingLineVersion,
      sourceCommit: options.sourceCommit,
    },
    provenance: {
      recorderName: options.recorderName,
      recorderVersion: options.recorderVersion,
      vendorRequestId: options.vendorRequestId,
      rawProviderResponseStored: false,
      privateReasoningStored: false,
      credentialsStored: false,
    },
    dataHandling: localDataHandling,
  });
  const commonManifest = {
    formatVersion: '1.0.0',
    suiteId: coreManifest.suiteId,
    suiteVersion: coreManifest.suiteVersion,
    caseId: coreManifest.caseId,
    generationRequestId: coreManifest.generationRequestId,
    runId: coreManifest.runId,
    replicateIndex: coreManifest.replicateIndex,
    parentRunId: coreManifest.parentRunId,
    profile: coreManifest.profile,
    generationSettings: coreManifest.generationSettings,
    reproducibility: coreManifest.reproducibility,
    treatmentAttestation: {
      evidenceClass: 'runtime_attested',
      assertion: 'profile_and_settings_match_runtime_evidence',
    },
    provenance: {
      recorderName: coreManifest.provenance.recorderName,
      recorderVersion: coreManifest.provenance.recorderVersion,
      vendorRequestId: coreManifest.provenance.vendorRequestId,
    },
    environment: {
      operatingLineVersion: coreManifest.environment.operatingLineVersion,
      sourceCommit: coreManifest.environment.sourceCommit,
    },
  };
  let manifest: EvalCaptureManifestV1;
  if (
    options.hostExecutionId === null ||
    options.terminalHostReportId === null ||
    options.hostProjectPath === null ||
    options.renderedImagePath === null
  ) {
    manifest = { ...commonManifest, captureMode: 'provider_only' };
  } else {
    const authorized = resolveAuthorizedHostCapture({
      suite,
      manifest: coreManifest,
      pages: exportPages.map((page) => page.bundle as CurrentEvalExportBundle),
      hostExecutionId: options.hostExecutionId,
      terminalHostReportId: options.terminalHostReportId,
    });
    const files = await readLocalHostArtifactFiles({
      root: dirname(outputPath),
      hostProjectPath: options.hostProjectPath,
      renderedImagePath: options.renderedImagePath,
    });
    const attestation = verifyRuntimeHostArtifactFiles({ authorized, files });
    assertAvailableHostArtifactIds(
      authorized.run,
      attestation.hostProject.artifactId,
      attestation.renderedImage.artifactId,
      exportPages.map(
        (_, index) => `eval.${coreManifest.runId}.page.${String(index + 1).padStart(4, '0')}`,
      ),
    );
    manifest = {
      ...commonManifest,
      captureMode: 'host_execution_with_runtime_attested_artifacts',
      hostExecutionId: options.hostExecutionId,
      terminalHostReportId: options.terminalHostReportId,
      hostProject: {
        artifactId: attestation.hostProject.artifactId,
        path: options.hostProjectPath,
      },
      renderedImage: {
        artifactId: attestation.renderedImage.artifactId,
        path: options.renderedImagePath,
      },
    };
  }
  await writeEvalCaptureManifestAtomicExclusive(options.outputPath, manifest, options.outputRoot);
  return manifest;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = await runEvalManifestCli(process.argv.slice(2));
    console.log(
      JSON.stringify(
        {
          created: true,
          captureMode: manifest.captureMode,
          caseId: manifest.caseId,
          generationRequestId: manifest.generationRequestId,
          runId: manifest.runId,
          treatmentEvidence: 'runtime_attested',
          credentialsStored: false,
          providerCredentialsRequired: false,
          providerCallsEnabled: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
