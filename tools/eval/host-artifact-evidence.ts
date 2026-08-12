import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  companionStateReportSchema,
  type CompanionArtifactAttestation,
  type CompanionStateReport,
  type CurrentEvalExportBundle,
  type EvalExecutionEvent,
  type HumanEvalSuite,
  type ProviderEvalRun,
} from '@operatingline/protocol';
import {
  computeHumanEvalContentSha256,
  createProviderEvalRunFromCapture,
  type ProviderEvalCaptureManifestV1,
} from '@operatingline/eval-kit';

export const maximumLocalArtifactBytes = 512 * 1024 * 1024;

export interface ConfinedRegularFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export interface LocalHostArtifactFiles {
  readonly projectPath: string;
  readonly imagePath: string;
  readonly projectBytes: Buffer;
  readonly imageBytes: Buffer;
  readonly projectSha256: string;
  readonly imageSha256: string;
  readonly dimensions: { readonly width: number; readonly height: number };
}

type HostSourceEvent = Extract<
  ProviderEvalRun['sourceEvents'][number],
  { readonly correlationKind: 'host_execution' }
>;

export interface AuthorizedHostCapture {
  readonly run: ProviderEvalRun;
  readonly event: EvalExecutionEvent;
  readonly report: CompanionStateReport;
  readonly sourceEvent: HostSourceEvent;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

async function readBoundedFile(
  path: string,
  root: string,
  physicalRoot: string,
  rootDevice: bigint,
  rootInode: bigint,
  label: string,
  maximumBytes: number,
): Promise<Buffer> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error(`${label} is not a regular file`);
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(`${label} exceeds ${maximumBytes} bytes`);
    }

    const assertStillConfined = async (): Promise<void> => {
      const [currentRoot, currentPath] = await Promise.all([realpath(root), realpath(path)]);
      if (currentRoot !== physicalRoot || !isWithin(currentRoot, currentPath)) {
        throw new Error(`${label} changed or resolves outside its configured root`);
      }
      const [currentRootMetadata, currentPathMetadata] = await Promise.all([
        stat(currentRoot, { bigint: true }),
        stat(currentPath, { bigint: true }),
      ]);
      if (
        currentRootMetadata.dev !== rootDevice ||
        currentRootMetadata.ino !== rootInode ||
        currentPathMetadata.dev !== before.dev ||
        currentPathMetadata.ino !== before.ino
      ) {
        throw new Error(`${label} changed while it was being read`);
      }
    };
    await assertStillConfined();

    const bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) {
        throw new Error(`${label} changed while it was being read`);
      }
      offset += read.bytesRead;
    }
    const probe = Buffer.allocUnsafe(1);
    if ((await handle.read(probe, 0, 1, offset)).bytesRead !== 0) {
      throw new Error(`${label} changed or exceeds ${maximumBytes} bytes`);
    }
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    await assertStillConfined();
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readConfinedRegularFile(
  rootInput: string,
  relativePath: string,
  label: string,
  maximumBytes = maximumLocalArtifactBytes,
): Promise<ConfinedRegularFile> {
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
  const rootMetadata = await stat(physicalRoot, { bigint: true });
  if (!rootMetadata.isDirectory()) throw new Error(`${label} root is not a directory`);
  return {
    path: physicalCandidate,
    bytes: await readBoundedFile(
      physicalCandidate,
      root,
      physicalRoot,
      rootMetadata.dev,
      rootMetadata.ino,
      label,
      maximumBytes,
    ),
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

function exactHostReport(
  pages: readonly CurrentEvalExportBundle[],
  executionId: string,
  reportId: string,
): { readonly event: EvalExecutionEvent; readonly report: CompanionStateReport } {
  const matches = pages.flatMap((page) =>
    page.events.flatMap((event) => {
      if (event.eventType !== 'companion.state.reported') return [];
      const parsed = companionStateReportSchema.safeParse(event.payload);
      return parsed.success &&
        parsed.data.executionId === executionId &&
        parsed.data.reportId === reportId
        ? [{ event, report: parsed.data }]
        : [];
    }),
  );
  if (matches.length !== 1) {
    throw new Error(
      'host-artifact capture requires one unique exact terminal host report for the selected execution',
    );
  }
  return matches[0]!;
}

/**
 * Resolves an exact report selector, then delegates all plan, authorization, and terminal-state
 * checks to the canonical frozen-capture validator.
 */
export function resolveAuthorizedHostCapture(input: {
  readonly suite: HumanEvalSuite;
  readonly manifest: ProviderEvalCaptureManifestV1;
  readonly pages: readonly CurrentEvalExportBundle[];
  readonly hostExecutionId: string;
  readonly terminalHostReportId: string;
}): AuthorizedHostCapture {
  const selected = exactHostReport(input.pages, input.hostExecutionId, input.terminalHostReportId);
  const run = createProviderEvalRunFromCapture({
    suite: input.suite,
    manifest: {
      ...input.manifest,
      hostExecutionId: input.hostExecutionId,
      terminalHostReportId: input.terminalHostReportId,
      environment: {
        ...input.manifest.environment,
        adapterVersion: selected.report.companionVersion,
        hostVersion: selected.report.hostVersion,
      },
    },
  });
  const sources = run.sourceEvents.filter(
    (event) =>
      event.correlationKind === 'host_execution' &&
      event.executionId === input.hostExecutionId &&
      event.reportId === input.terminalHostReportId &&
      event.sequence === selected.event.sequence &&
      event.eventId === selected.event.id &&
      event.payloadSha256 === computeHumanEvalContentSha256(selected.event.payload),
  );
  if (sources.length !== 1) {
    throw new Error(
      'host-artifact capture did not resolve to one authorized successful host execution',
    );
  }
  return {
    run,
    event: selected.event,
    report: selected.report,
    sourceEvent: sources[0] as HostSourceEvent,
  };
}

export async function readLocalHostArtifactFiles(input: {
  readonly root: string;
  readonly hostProjectPath: string;
  readonly renderedImagePath: string;
}): Promise<LocalHostArtifactFiles> {
  const [projectPath, imagePath] = await Promise.all([
    readConfinedRegularFile(input.root, input.hostProjectPath, 'hostProject.path'),
    readConfinedRegularFile(input.root, input.renderedImagePath, 'renderedImage.path'),
  ]);
  return {
    projectPath: projectPath.path,
    imagePath: imagePath.path,
    projectBytes: projectPath.bytes,
    imageBytes: imagePath.bytes,
    projectSha256: sha256(projectPath.bytes),
    imageSha256: sha256(imagePath.bytes),
    dimensions: pngDimensions(imagePath.bytes),
  };
}

export function assertAvailableHostArtifactIds(
  run: ProviderEvalRun,
  hostProjectArtifactId: string,
  renderedImageArtifactId: string,
  additionalReservedArtifactIds: readonly string[] = [],
): void {
  const reserved = new Set([
    ...run.artifacts.map((artifact) => artifact.artifactId),
    ...additionalReservedArtifactIds,
  ]);
  if (
    hostProjectArtifactId === renderedImageArtifactId ||
    reserved.has(hostProjectArtifactId) ||
    reserved.has(renderedImageArtifactId)
  ) {
    throw new Error('host artifact ids must be unique');
  }
}

export function verifyRuntimeHostArtifactFiles(input: {
  readonly authorized: AuthorizedHostCapture;
  readonly files: LocalHostArtifactFiles;
  readonly expectedHostProjectArtifactId?: string;
  readonly expectedRenderedImageArtifactId?: string;
}): CompanionArtifactAttestation {
  const { report, sourceEvent } = input.authorized;
  const attestation = report.artifactAttestation;
  if (
    attestation === undefined ||
    attestation === null ||
    attestation.executionId !== sourceEvent.executionId ||
    attestation.planContentSha256 !== sourceEvent.planContentSha256 ||
    (input.expectedHostProjectArtifactId !== undefined &&
      attestation.hostProject.artifactId !== input.expectedHostProjectArtifactId) ||
    (input.expectedRenderedImageArtifactId !== undefined &&
      attestation.renderedImage.artifactId !== input.expectedRenderedImageArtifactId) ||
    attestation.hostProject.contentSha256 !== input.files.projectSha256 ||
    attestation.renderedImage.contentSha256 !== input.files.imageSha256 ||
    attestation.renderedImage.width !== input.files.dimensions.width ||
    attestation.renderedImage.height !== input.files.dimensions.height ||
    attestation.renderedImage.hostProjectSha256 !== input.files.projectSha256
  ) {
    throw new Error(
      'runtime host-artifact capture files do not match the terminal host attestation',
    );
  }
  return attestation;
}
