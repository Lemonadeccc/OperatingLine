import { createHash } from 'node:crypto';
import { readFile, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  companionStateReportSchema,
  currentEvalExportBundleSchema,
  humanEvalSuiteSchema,
  type CurrentEvalExportBundle,
  type EvalArtifactReference,
  type HumanEvalDataHandling,
  type HumanEvalSuite,
  type ProviderEvalGenerationSettings,
  type ProviderEvalProfile,
  type ProviderEvalRun,
} from '@operatingline/protocol';
import {
  createProviderEvalRun,
  createProviderEvalRunFromCapture,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  loadHumanEvalDatasetDirectory,
  preparePrivateHumanEvalDirectory,
  withHumanEvalDatasetWriteLock,
  writeHumanEvalFileAtomicExclusive,
  type ProviderEvalCaptureManifestV1,
} from '@operatingline/eval-kit';

export const evalCaptureManifestVersion = '1.0.0' as const;

export interface LocalCaptureArtifactInput {
  readonly artifactId: string;
  /** Relative to the capture manifest directory. */
  readonly path: string;
}

export interface LocalRenderedImageInput extends LocalCaptureArtifactInput {
  readonly frame: number | null;
  readonly renderEngine: string;
  readonly colorManagement: string;
}

interface CaptureManifestCommon {
  readonly formatVersion: typeof evalCaptureManifestVersion;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly caseId: string;
  readonly generationRequestId: string;
  readonly runId: string;
  readonly replicateIndex: number;
  readonly parentRunId: string | null;
  readonly profile: ProviderEvalProfile;
  readonly generationSettings: Omit<ProviderEvalGenerationSettings, 'parametersSha256'>;
  readonly reproducibility: 'not_reproducible';
  readonly treatmentAttestation: {
    readonly evidenceClass: 'operator_attested_not_runtime_verified';
    readonly assertion: 'profile_and_settings_reviewed_no_credentials';
    readonly preparedBy: string;
    readonly reviewedAt: string;
  };
  readonly provenance: Pick<
    ProviderEvalRun['provenance'],
    'recorderName' | 'recorderVersion' | 'vendorRequestId'
  >;
  readonly environment: Pick<
    ProviderEvalRun['environment'],
    'operatingLineVersion' | 'sourceCommit'
  >;
}

export type EvalCaptureManifestV1 = CaptureManifestCommon &
  (
    | {
        readonly captureMode: 'provider_only';
      }
    | {
        readonly captureMode: 'host_execution_with_manual_artifacts';
        readonly hostExecutionId: string;
        readonly hostProject: LocalCaptureArtifactInput;
        readonly renderedImage: LocalRenderedImageInput;
      }
  );

export interface CaptureProviderEvalRunOptions {
  readonly datasetDirectory: string;
  readonly snapshotDirectory: string;
  readonly manifestPath: string;
  readonly repositoryRoot?: string;
}

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

const localDataHandling: HumanEvalDataHandling = {
  redaction: 'none',
  containsPotentiallySensitiveContent: true,
  permittedUses: ['local_eval'],
  trainingUse: 'not_authorized',
  publicRelease: 'not_reviewed',
  warning:
    'Offline capture contains unredacted local evaluation evidence. It is not reviewed for public release and is not authorized for training use.',
};

const maximumSnapshotPageBytes = 32 * 1024 * 1024;
const maximumSnapshotPages = 10_000;
const maximumManifestBytes = 4 * 1024 * 1024;
const maximumLocalArtifactBytes = 512 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

async function confinedFile(
  rootInput: string,
  relativePath: string,
  label: string,
  maximumBytes = maximumLocalArtifactBytes,
): Promise<string> {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const root = resolve(rootInput);
  const candidate = resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${label} escapes its configured root`);
  const [physicalRoot, physicalCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (!isWithin(physicalRoot, physicalCandidate)) {
    throw new Error(`${label} resolves outside its configured root`);
  }
  const metadata = await stat(physicalCandidate);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximumBytes) {
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  }
  return physicalCandidate;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

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

function parseSnapshotManifest(value: unknown): StoredSnapshotManifest {
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
  const dataHandling = object(input['dataHandling'], 'snapshot dataHandling');
  requireKeys(
    dataHandling,
    ['containsPotentiallySensitiveContent', 'credentialsStored', 'warning'],
    'snapshot dataHandling',
  );
  if (
    dataHandling['containsPotentiallySensitiveContent'] !== true ||
    dataHandling['credentialsStored'] !== false ||
    typeof dataHandling['warning'] !== 'string' ||
    dataHandling['warning'].trim() === ''
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
  const pages = input['pages'].map((page, index) => {
    const record = object(page, `snapshot page ${index + 1}`);
    requireKeys(record, ['filename', 'exportId', 'contentSha256'], `snapshot page ${index + 1}`);
    if (
      typeof record['filename'] !== 'string' ||
      typeof record['exportId'] !== 'string' ||
      typeof record['contentSha256'] !== 'string'
    ) {
      throw new Error(`snapshot page ${index + 1} identity is required`);
    }
    return {
      filename: record['filename'],
      exportId: record['exportId'],
      contentSha256: record['contentSha256'],
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

function parseLocalArtifact(value: unknown, label: string, rendered: boolean) {
  const input = object(value, label);
  const allowed = rendered
    ? ['artifactId', 'path', 'frame', 'renderEngine', 'colorManagement']
    : ['artifactId', 'path'];
  requireKeys(input, allowed, label);
  if (typeof input['artifactId'] !== 'string' || typeof input['path'] !== 'string') {
    throw new Error(`${label} artifactId and path are required`);
  }
  if (!rendered) return { artifactId: input['artifactId'], path: input['path'] };
  if (
    (input['frame'] !== null && !Number.isSafeInteger(input['frame'])) ||
    typeof input['renderEngine'] !== 'string' ||
    typeof input['colorManagement'] !== 'string'
  ) {
    throw new Error(`${label} requires frame, renderEngine, and colorManagement`);
  }
  return {
    artifactId: input['artifactId'],
    path: input['path'],
    frame: input['frame'] as number | null,
    renderEngine: input['renderEngine'],
    colorManagement: input['colorManagement'],
  };
}

function parseCaptureManifest(value: unknown): EvalCaptureManifestV1 {
  const input = object(value, 'capture manifest');
  const common = [
    'formatVersion',
    'captureMode',
    'suiteId',
    'suiteVersion',
    'caseId',
    'generationRequestId',
    'runId',
    'replicateIndex',
    'parentRunId',
    'profile',
    'generationSettings',
    'reproducibility',
    'treatmentAttestation',
    'provenance',
    'environment',
  ];
  const hasManualHostArtifacts = input['captureMode'] === 'host_execution_with_manual_artifacts';
  requireKeys(
    input,
    hasManualHostArtifacts
      ? [...common, 'hostExecutionId', 'hostProject', 'renderedImage']
      : common,
    'capture manifest',
  );
  if (input['formatVersion'] !== evalCaptureManifestVersion) {
    throw new Error(`Unsupported Eval capture manifest version ${String(input['formatVersion'])}`);
  }
  if (input['captureMode'] !== 'provider_only' && !hasManualHostArtifacts) {
    throw new Error('captureMode must be provider_only or host_execution_with_manual_artifacts');
  }
  for (const key of ['suiteId', 'suiteVersion', 'caseId', 'generationRequestId', 'runId']) {
    if (typeof input[key] !== 'string') throw new Error(`capture manifest ${key} is required`);
  }
  if (!Number.isInteger(input['replicateIndex']))
    throw new Error('capture manifest replicateIndex is required');
  if (input['reproducibility'] !== 'not_reproducible') {
    throw new Error(
      'offline capture requires reproducibility=not_reproducible until runtime treatment attestation exists',
    );
  }
  const treatmentAttestation = object(
    input['treatmentAttestation'],
    'capture manifest treatmentAttestation',
  );
  requireKeys(
    treatmentAttestation,
    ['evidenceClass', 'assertion', 'preparedBy', 'reviewedAt'],
    'capture manifest treatmentAttestation',
  );
  if (
    treatmentAttestation['evidenceClass'] !== 'operator_attested_not_runtime_verified' ||
    treatmentAttestation['assertion'] !== 'profile_and_settings_reviewed_no_credentials' ||
    typeof treatmentAttestation['preparedBy'] !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(treatmentAttestation['preparedBy']) ||
    typeof treatmentAttestation['reviewedAt'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      treatmentAttestation['reviewedAt'],
    ) ||
    !Number.isFinite(Date.parse(treatmentAttestation['reviewedAt']))
  ) {
    throw new Error('capture manifest treatmentAttestation is invalid');
  }
  const base = {
    formatVersion: evalCaptureManifestVersion,
    suiteId: input['suiteId'] as string,
    suiteVersion: input['suiteVersion'] as string,
    caseId: input['caseId'] as string,
    generationRequestId: input['generationRequestId'] as string,
    runId: input['runId'] as string,
    replicateIndex: input['replicateIndex'] as number,
    parentRunId: input['parentRunId'] as string | null,
    profile: input['profile'] as ProviderEvalProfile,
    generationSettings: input['generationSettings'] as Omit<
      ProviderEvalGenerationSettings,
      'parametersSha256'
    >,
    reproducibility: input['reproducibility'] as 'not_reproducible',
    treatmentAttestation:
      treatmentAttestation as unknown as CaptureManifestCommon['treatmentAttestation'],
    provenance: (() => {
      const provenance = object(input['provenance'], 'capture manifest provenance');
      requireKeys(
        provenance,
        ['recorderName', 'recorderVersion', 'vendorRequestId'],
        'capture manifest provenance',
      );
      return provenance as unknown as CaptureManifestCommon['provenance'];
    })(),
    environment: (() => {
      const environment = object(input['environment'], 'capture manifest environment');
      requireKeys(
        environment,
        ['operatingLineVersion', 'sourceCommit'],
        'capture manifest environment',
      );
      return environment as unknown as CaptureManifestCommon['environment'];
    })(),
  };
  if (!hasManualHostArtifacts) return { ...base, captureMode: 'provider_only' };
  if (typeof input['hostExecutionId'] !== 'string')
    throw new Error('manual host-artifact capture requires hostExecutionId');
  return {
    ...base,
    captureMode: 'host_execution_with_manual_artifacts',
    hostExecutionId: input['hostExecutionId'],
    hostProject: parseLocalArtifact(input['hostProject'], 'hostProject', false),
    renderedImage: parseLocalArtifact(
      input['renderedImage'],
      'renderedImage',
      true,
    ) as LocalRenderedImageInput,
  };
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('renderedImage is not a PNG with an IHDR header');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) throw new Error('renderedImage PNG dimensions must be positive');
  return { width, height };
}

function matchingTerminalHostReports(
  pages: readonly CurrentEvalExportBundle[],
  run: ProviderEvalRun,
  executionId: string,
) {
  if (run.outcome.status !== 'completed' || run.outcome.result.status !== 'ready') return [];
  const plan = run.outcome.result.draft.plan;
  const planContentSha256 = computePlanContentSha256(plan);
  const executableStepIds = plan.steps
    .filter((step) => step.action !== null)
    .map((step) => step.id);
  const firstPage = pages[0]!;
  return pages.flatMap((page) =>
    page.events.flatMap((event) => {
      if (event.eventType !== 'companion.state.reported') return [];
      const parsed = companionStateReportSchema.safeParse(event.payload);
      return parsed.success &&
        parsed.data.executionId === executionId &&
        parsed.data.protocolVersion === firstPage.protocolVersion &&
        parsed.data.adapterId === run.environment.targetAdapterId &&
        parsed.data.instanceId === firstPage.scope.instanceId &&
        parsed.data.plan?.id === plan.id &&
        parsed.data.plan.revision === plan.revision &&
        parsed.data.planContentSha256 === planContentSha256 &&
        parsed.data.phase === 'completed' &&
        parsed.data.transition === 'step_succeeded' &&
        parsed.data.stepId !== null &&
        parsed.data.completedStepIds.length === executableStepIds.length &&
        executableStepIds.every((stepId) => parsed.data.completedStepIds.includes(stepId))
        ? [{ event, report: parsed.data }]
        : [];
    }),
  );
}

async function privateDatasetDirectory(
  datasetDirectory: string,
  relativeDirectory: string,
): Promise<string> {
  const directory = await preparePrivateHumanEvalDirectory(
    resolve(datasetDirectory, relativeDirectory),
    datasetDirectory,
  );
  const [physicalDataset, physicalDirectory] = await Promise.all([
    realpath(datasetDirectory),
    realpath(directory),
  ]);
  if (!isWithin(physicalDataset, physicalDirectory)) {
    throw new Error(`Dataset output directory escapes its configured root: ${relativeDirectory}`);
  }
  return directory;
}

async function copyContentAddressed(
  datasetDirectory: string,
  bytes: Buffer,
  extension: string,
  created: string[],
): Promise<{ uri: string; hash: string }> {
  const hash = sha256(bytes);
  const normalizedExtension = /^\.[a-z0-9]+$/.test(extension.toLowerCase())
    ? extension.toLowerCase()
    : '';
  const filename = `${hash}${normalizedExtension}`;
  const uri = `artifacts/sha256/${filename}`;
  const directory = await privateDatasetDirectory(datasetDirectory, 'artifacts/sha256');
  const path = resolve(directory, filename);
  try {
    await writeHumanEvalFileAtomicExclusive(path, bytes, datasetDirectory);
    created.push(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (sha256(await readFile(path)) !== hash) {
      throw new Error(`Existing artifact ${uri} does not match its content address`, {
        cause: error,
      });
    }
  }
  return { uri, hash };
}

export async function captureProviderEvalRun(
  options: CaptureProviderEvalRunOptions,
): Promise<ProviderEvalRun> {
  const datasetDirectory = resolve(options.datasetDirectory);
  const snapshotDirectory = resolve(options.snapshotDirectory);
  const manifestPath = resolve(options.manifestPath);
  const manifestRoot = dirname(manifestPath);
  const repositoryRoot = resolve(options.repositoryRoot ?? '.');
  const artifactOptions = { artifactRoots: { repo: repositoryRoot } } as const;
  const [suitePath, snapshotManifestPath, captureManifestPath] = await Promise.all([
    confinedFile(datasetDirectory, 'suite.json', 'dataset suite', maximumManifestBytes),
    confinedFile(snapshotDirectory, 'snapshot.json', 'snapshot manifest', maximumManifestBytes),
    confinedFile(manifestRoot, basename(manifestPath), 'manifestPath', maximumManifestBytes),
  ]);
  const [suiteInput, snapshotInput, captureInput] = await Promise.all([
    readJson(suitePath),
    readJson(snapshotManifestPath),
    readJson(captureManifestPath),
  ]);
  const suite = humanEvalSuiteSchema.parse(suiteInput) as HumanEvalSuite;
  const snapshot = parseSnapshotManifest(snapshotInput);
  const manifest = parseCaptureManifest(captureInput);
  const pageInputs = await Promise.all(
    snapshot.pages.map(async (page, index) => {
      const path = await confinedFile(
        snapshotDirectory,
        page.filename,
        `snapshot page ${index + 1}`,
        maximumSnapshotPageBytes,
      );
      const bytes = await readFile(path);
      return {
        path,
        bytes,
        bundle: currentEvalExportBundleSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown),
      };
    }),
  );
  for (const [index, page] of pageInputs.entries()) {
    const declared = snapshot.pages[index]!;
    if (
      page.bundle.exportId !== declared.exportId ||
      page.bundle.integrity.contentSha256 !== declared.contentSha256 ||
      page.bundle.page.snapshotId !== snapshot.snapshotId ||
      page.bundle.page.snapshotUpperSequence !== snapshot.snapshotUpperSequence ||
      computeHumanEvalContentSha256(page.bundle.scope) !==
        computeHumanEvalContentSha256(snapshot.scope)
    ) {
      throw new Error(`snapshot page ${index + 1} does not match snapshot.json`);
    }
  }

  const evalCase = suite.cases.find((candidate) => candidate.id === manifest.caseId);
  const exactCatalog = pageInputs
    .flatMap((page) => page.bundle.catalogs)
    .find(
      (catalog) =>
        evalCase !== undefined &&
        computeHumanEvalContentSha256(catalog) === evalCase.catalogContentSha256,
    );
  if (exactCatalog === undefined)
    throw new Error('snapshot does not contain the exact case catalog');
  const providerOnlyEnvironment: ProviderEvalRun['environment'] = {
    ...manifest.environment,
    protocolVersion: pageInputs[0]!.bundle.protocolVersion,
    targetAdapterId: exactCatalog.adapterId,
    catalogVersion: exactCatalog.catalogVersion,
    adapterVersion: null,
    hostVersion: null,
  };
  return withHumanEvalDatasetWriteLock(datasetDirectory, async () => {
    const currentDataset = await loadHumanEvalDatasetDirectory(datasetDirectory, artifactOptions);
    if (
      currentDataset.suite.integrity.contentSha256 !== suite.integrity.contentSha256 ||
      currentDataset.suite.suiteId !== manifest.suiteId ||
      currentDataset.suite.suiteVersion !== manifest.suiteVersion
    ) {
      throw new Error('capture manifest does not match the current validated dataset suite');
    }
    const created: string[] = [];
    try {
      const treatmentAttestationBytes = Buffer.from(
        `${JSON.stringify(
          {
            formatVersion: '1.0.0',
            ...manifest.treatmentAttestation,
            profile: manifest.profile,
            generationSettings: manifest.generationSettings,
            environment: manifest.environment,
            provenance: manifest.provenance,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const treatmentAttestation = await copyContentAddressed(
        datasetDirectory,
        treatmentAttestationBytes,
        '.json',
        created,
      );
      const treatmentAttestationArtifact: EvalArtifactReference = {
        artifactId: `eval.${manifest.runId}.operator-treatment-attestation`,
        kind: 'provider_output',
        mediaType: 'application/json',
        uri: treatmentAttestation.uri,
        contentSha256: treatmentAttestation.hash,
        metadata: manifest.treatmentAttestation,
      };
      const exportPages = await Promise.all(
        pageInputs.map(async (page, index) => {
          const stored = await copyContentAddressed(datasetDirectory, page.bytes, '.json', created);
          return {
            artifactId: `eval.${manifest.runId}.page.${String(index + 1).padStart(4, '0')}`,
            uri: stored.uri,
            bytes: page.bytes,
            bundle: page.bundle,
          };
        }),
      );
      const baseManifest: ProviderEvalCaptureManifestV1 = {
        formatVersion: '1.0.0',
        suiteId: manifest.suiteId,
        suiteVersion: manifest.suiteVersion,
        caseId: manifest.caseId,
        generationRequestId: manifest.generationRequestId,
        runId: manifest.runId,
        replicateIndex: manifest.replicateIndex,
        parentRunId: manifest.parentRunId,
        profile: manifest.profile,
        environment: providerOnlyEnvironment,
        generationSettings: manifest.generationSettings,
        reproducibility: manifest.reproducibility,
        provenance: {
          ...manifest.provenance,
          rawProviderResponseStored: false,
          privateReasoningStored: false,
          credentialsStored: false,
        },
        dataHandling: localDataHandling,
        exportPages,
        supplementalArtifacts: [treatmentAttestationArtifact],
      };
      let run = createProviderEvalRunFromCapture({ suite, manifest: baseManifest });
      let hostReport: ReturnType<typeof matchingTerminalHostReports>[number] | undefined;
      if (manifest.captureMode === 'host_execution_with_manual_artifacts') {
        const matches = matchingTerminalHostReports(
          pageInputs.map((page) => page.bundle),
          run,
          manifest.hostExecutionId,
        );
        if (matches.length !== 1) {
          throw new Error(
            'manual host-artifact capture requires one unique exact terminal host report for the selected execution',
          );
        }
        hostReport = matches[0]!;
        run = createProviderEvalRunFromCapture({
          suite,
          manifest: {
            ...baseManifest,
            hostExecutionId: manifest.hostExecutionId,
            environment: {
              ...providerOnlyEnvironment,
              adapterVersion: hostReport.report.companionVersion,
              hostVersion: hostReport.report.hostVersion,
            },
          },
        });
        const reservedArtifactIds = new Set(run.artifacts.map((artifact) => artifact.artifactId));
        if (
          manifest.hostProject.artifactId === manifest.renderedImage.artifactId ||
          reservedArtifactIds.has(manifest.hostProject.artifactId) ||
          reservedArtifactIds.has(manifest.renderedImage.artifactId)
        ) {
          throw new Error('manual host artifact ids must be unique');
        }
        const hostSource = run.sourceEvents.filter(
          (event) => event.correlationKind === 'host_execution',
        );
        if (hostSource.length !== 1 || hostSource[0]!.executionId !== manifest.hostExecutionId) {
          throw new Error(
            'manual host-artifact capture did not resolve to one authorized successful host execution',
          );
        }
        const [projectPath, imagePath] = await Promise.all([
          confinedFile(
            manifestRoot,
            manifest.hostProject.path,
            'hostProject.path',
            maximumLocalArtifactBytes,
          ),
          confinedFile(
            manifestRoot,
            manifest.renderedImage.path,
            'renderedImage.path',
            maximumLocalArtifactBytes,
          ),
        ]);
        const [projectBytes, imageBytes] = await Promise.all([
          readFile(projectPath),
          readFile(imagePath),
        ]);
        const project = await copyContentAddressed(
          datasetDirectory,
          projectBytes,
          extname(projectPath),
          created,
        );
        const image = await copyContentAddressed(datasetDirectory, imageBytes, '.png', created);
        const dimensions = pngDimensions(imageBytes);
        const host = hostSource[0]!;
        const manualEvidenceMetadata = {
          evidenceClass: 'manual_artifact_not_runtime_bound',
          warning:
            'The file was supplied by the capture operator and is not hash-attested by the terminal host report.',
          executionId: manifest.hostExecutionId,
          terminalHostReportId: host.reportId,
          terminalHostEventSequence: host.sequence,
          planContentSha256: host.planContentSha256,
        } as const;
        const artifacts: EvalArtifactReference[] = [
          ...run.artifacts,
          {
            artifactId: manifest.hostProject.artifactId,
            kind: 'host_project',
            mediaType: 'application/octet-stream',
            uri: project.uri,
            contentSha256: project.hash,
            metadata: manualEvidenceMetadata,
          },
          {
            artifactId: manifest.renderedImage.artifactId,
            kind: 'manual_review_image',
            mediaType: 'image/png',
            uri: image.uri,
            contentSha256: image.hash,
            metadata: {
              ...manualEvidenceMetadata,
              ...dimensions,
              frame: manifest.renderedImage.frame,
              renderEngine: manifest.renderedImage.renderEngine,
              colorManagement: manifest.renderedImage.colorManagement,
              hostVersion: hostReport.report.hostVersion,
              adapterVersion: hostReport.report.companionVersion,
              hostProjectSha256: project.hash,
            },
          },
        ];
        run = createProviderEvalRun({
          ...run,
          artifacts,
          generationSettings: {
            normalizedParameters: run.generationSettings.normalizedParameters,
            seed: run.generationSettings.seed,
            determinism: run.generationSettings.determinism,
          },
          invocation: run.invocation,
          outcome: run.outcome,
          reproducibility: run.comparability.reproducibility,
        });
      }
      const runsDirectory = await privateDatasetDirectory(datasetDirectory, 'runs');
      const runPath = resolve(runsDirectory, `${run.runId}.run.json`);
      await writeHumanEvalFileAtomicExclusive(
        runPath,
        `${JSON.stringify(run, null, 2)}\n`,
        datasetDirectory,
      );
      created.push(runPath);
      await loadHumanEvalDatasetDirectory(datasetDirectory, artifactOptions);
      return run;
    } catch (error) {
      for (const path of created.reverse()) await rm(path, { force: true });
      throw error;
    }
  });
}

function parseCli(arguments_: readonly string[]): CaptureProviderEvalRunOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !['--dataset', '--snapshot', '--manifest', '--repo-root'].includes(name)
    ) {
      throw new Error(
        'Usage: capture --dataset <directory> --snapshot <directory> --manifest <file> [--repo-root <directory>]',
      );
    }
    if (values.has(name)) throw new Error(`Duplicate Eval capture argument ${name}`);
    values.set(name, value);
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`Missing required Eval capture argument ${name}`);
    return value;
  };
  return {
    datasetDirectory: required('--dataset'),
    snapshotDirectory: required('--snapshot'),
    manifestPath: required('--manifest'),
    ...(values.get('--repo-root') === undefined
      ? {}
      : { repositoryRoot: values.get('--repo-root')! }),
  };
}

export async function runEvalCaptureCli(arguments_: readonly string[]): Promise<ProviderEvalRun> {
  return captureProviderEvalRun(parseCli(arguments_));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = await runEvalCaptureCli(process.argv.slice(2));
    console.log(
      JSON.stringify(
        {
          captured: true,
          runId: run.runId,
          credentialsStored: false,
          providerCredentialsRequired: false,
          providerCallsEnabled: false,
          treatmentEvidence: 'operator_attested_not_runtime_verified',
          releasedComparisonEligible: false,
          providerBlindSignoffRequiredBeforeReview: true,
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
