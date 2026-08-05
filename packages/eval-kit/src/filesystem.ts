import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import {
  currentEvalExportBundleSchema,
  companionStateReportSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guidePlanSchema,
  plannerGenerationCompletedEventSchema,
  plannerGenerationFailedEventSchema,
  plannerGenerationRequestedEventSchema,
  plannerReplanCompletedEventSchema,
  plannerReplanFailedEventSchema,
  plannerReplanRequestedEventSchema,
  type CurrentEvalExportBundle,
  type CompanionStateReport,
  type EvalArtifactReference,
  type EvalExecutionEvent,
  type HumanEvalCriterionJudgment,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import {
  HumanEvalDatasetError,
  validateHumanEvalDataset,
  type ValidatedHumanEvalDataset,
} from './dataset.js';
import { computeHumanEvalContentSha256, computePlanContentSha256 } from './integrity.js';
import { markArtifactVerifiedDataset } from './verification.js';

export interface HumanEvalDatasetDirectoryOptions {
  /** Explicit roots for artifact URIs such as `repo://protocol/fixtures/example.json`. */
  readonly artifactRoots?: Readonly<Record<string, string>>;
  /** Maximum accepted artifact size in bytes. Defaults to 512 MiB. */
  readonly maxArtifactBytes?: number;
}

interface LoadedArtifact {
  readonly bytes: Buffer;
}

interface EvidenceEvent {
  readonly event: EvalExecutionEvent;
  readonly bundle: CurrentEvalExportBundle;
}

interface LiveRunLedgerEvidence {
  readonly hostReportsBySequence: ReadonlyMap<string, CompanionStateReport>;
  readonly providerTerminalSequence: number | null;
  readonly planAuthorizationSequences: readonly number[];
}

interface VerifiedRunEvidence {
  readonly loadedArtifacts: ReadonlyMap<string, LoadedArtifact>;
  readonly ledger: LiveRunLedgerEvidence;
}

const uriSchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/;
const defaultMaxArtifactBytes = 512 * 1024 * 1024;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function readRecords(directory: string, suffix: string): Promise<unknown[]> {
  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return Promise.all(
    filenames
      .filter((filename) => filename.endsWith(suffix))
      .sort()
      .map((filename) => readJson(resolve(directory, filename))),
  );
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

async function resolveArtifactPath(
  datasetDirectory: string,
  uri: string,
  artifactRoots: Readonly<Record<string, string>>,
): Promise<string> {
  const schemeMatch = uriSchemePattern.exec(uri);
  let configuredRoot: string;
  let artifactPath: string;
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1]!;
    const pathFromRoot = schemeMatch[2]!;
    configuredRoot = artifactRoots[scheme] ?? '';
    if (configuredRoot === '') {
      throw new Error(`URI scheme ${scheme} has no configured artifact root`);
    }
    if (pathFromRoot === '' || isAbsolute(pathFromRoot)) {
      throw new Error(`Artifact URI ${uri} has no safe path within its configured root`);
    }
    artifactPath = resolve(configuredRoot, pathFromRoot);
  } else {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) {
      throw new Error(`Artifact URI ${uri} uses an unsupported URI form`);
    }
    if (isAbsolute(uri)) {
      throw new Error(`Absolute artifact path ${uri} is not allowed`);
    }
    configuredRoot = datasetDirectory;
    artifactPath = resolve(configuredRoot, uri);
  }

  const lexicalRoot = resolve(configuredRoot);
  if (!isWithin(lexicalRoot, artifactPath)) {
    throw new Error(`Artifact URI ${uri} escapes its configured root`);
  }

  const [physicalRoot, physicalArtifact] = await Promise.all([
    realpath(lexicalRoot),
    realpath(artifactPath),
  ]);
  if (!isWithin(physicalRoot, physicalArtifact)) {
    throw new Error(`Artifact URI ${uri} resolves outside its configured root`);
  }
  return physicalArtifact;
}

async function loadArtifact(
  datasetDirectory: string,
  artifact: EvalArtifactReference,
  artifactRoots: Readonly<Record<string, string>>,
  maxArtifactBytes: number,
): Promise<LoadedArtifact> {
  const path = await resolveArtifactPath(datasetDirectory, artifact.uri, artifactRoots);
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new Error(`Artifact URI ${artifact.uri} does not resolve to a regular file`);
  }
  if (metadata.size > maxArtifactBytes) {
    throw new Error(`Artifact URI ${artifact.uri} exceeds the ${maxArtifactBytes} byte size limit`);
  }
  return { bytes: await readFile(path) };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngCrcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = pngCrcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePngDimensions(
  bytes: Buffer,
  maxDecodedBytes: number,
): { readonly width: number; readonly height: number } {
  if (bytes.length < 33 || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('PNG signature is invalid');
  }
  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  let paletteEntries = 0;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error('PNG chunk header is truncated');
    }
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      throw new Error('PNG chunk payload is truncated');
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (pngCrc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error(`PNG chunk ${type} has an invalid CRC`);
    }
    if (!sawHeader && type !== 'IHDR') {
      throw new Error('PNG IHDR must be the first chunk');
    }
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) {
        throw new Error('PNG must contain one 13-byte IHDR');
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const allowedBitDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 ||
        height === 0 ||
        !allowedBitDepths[colorType]?.includes(bitDepth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new Error('PNG IHDR uses unsupported dimensions or encoding');
      }
    } else if (type === 'PLTE') {
      if (sawPalette || sawImageData) {
        throw new Error('PNG PLTE must appear once before IDAT');
      }
      if (colorType === 0 || colorType === 4) {
        throw new Error('Grayscale PNG cannot contain PLTE');
      }
      if (length === 0 || length % 3 !== 0 || length > 256 * 3) {
        throw new Error('PNG PLTE must contain between 1 and 256 complete RGB entries');
      }
      paletteEntries = length / 3;
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) {
        throw new Error('Indexed PNG palette exceeds its bit-depth capacity');
      }
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded) {
        throw new Error('PNG IDAT chunks must be consecutive');
      }
      sawImageData = true;
      imageData.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) {
        throw new Error('PNG IEND must be empty');
      }
      sawEnd = true;
      offset = chunkEnd;
      break;
    } else {
      if (sawImageData) {
        imageDataEnded = true;
      }
      const isCritical = typeBytes[0]! >= 65 && typeBytes[0]! <= 90;
      if (isCritical) {
        throw new Error(`PNG contains unsupported critical chunk ${type}`);
      }
    }
    offset = chunkEnd;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw new Error('PNG is missing required chunks or has trailing bytes');
  }
  if (colorType === 3 && !sawPalette) {
    throw new Error('Indexed PNG requires a palette');
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const)[colorType as 0 | 2 | 3 | 4 | 6];
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedDecodedBytes = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > maxDecodedBytes) {
    throw new Error(`PNG decoded data exceeds the ${maxDecodedBytes} byte size limit`);
  }
  const decoded = inflateSync(Buffer.concat(imageData), {
    maxOutputLength: expectedDecodedBytes + 1,
  });
  if (decoded.length !== expectedDecodedBytes) {
    throw new Error('PNG decoded scanline size does not match IHDR');
  }
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const reconstructedRows: Buffer[] = [];
  const paeth = (left: number, above: number, upperLeft: number): number => {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance
        ? above
        : upperLeft;
  };
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (rowBytes + 1);
    const filter = decoded[rowStart]!;
    if (filter > 4) {
      throw new Error('PNG contains an invalid scanline filter');
    }
    const previous = reconstructedRows[row - 1];
    const reconstructed = Buffer.allocUnsafe(rowBytes);
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = decoded[rowStart + 1 + column]!;
      const left = column >= bytesPerPixel ? reconstructed[column - bytesPerPixel]! : 0;
      const above = previous?.[column] ?? 0;
      const upperLeft =
        previous !== undefined && column >= bytesPerPixel ? previous[column - bytesPerPixel]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      reconstructed[column] = (encoded + predictor) & 0xff;
    }
    reconstructedRows.push(reconstructed);
  }
  if (colorType === 3) {
    for (const row of reconstructedRows) {
      for (let pixel = 0; pixel < width; pixel += 1) {
        const bitOffset = pixel * bitDepth;
        const byte = row[Math.floor(bitOffset / 8)]!;
        const shift = 8 - bitDepth - (bitOffset % 8);
        const paletteIndex = (byte >>> shift) & (2 ** bitDepth - 1);
        if (paletteIndex >= paletteEntries) {
          throw new Error(`Indexed PNG pixel references missing palette entry ${paletteIndex}`);
        }
      }
    }
  }
  return { width, height };
}

function evalExportIntegrityContent(bundle: CurrentEvalExportBundle): unknown {
  return {
    protocolVersion: bundle.protocolVersion,
    formatVersion: bundle.formatVersion,
    scope: bundle.scope,
    catalogs: bundle.catalogs,
    events: bundle.events,
    page: bundle.page,
    summary: bundle.summary,
    dataHandling: bundle.dataHandling,
  };
}

function stringAt(value: unknown, ...path: string[]): string | null {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : null;
}

function recordAt(value: unknown, ...path: string[]): Record<string, unknown> | null {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== null && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : null;
}

function eventRequestId(event: EvalExecutionEvent): string | null {
  return (
    stringAt(event.payload, 'requestId') ??
    stringAt(event.payload, 'request', 'requestId') ??
    stringAt(event.payload, 'result', 'requestId') ??
    stringAt(event.payload, 'error', 'requestId')
  );
}

type SourceEventSummary = ProviderEvalRun['sourceEvents'][number];

function summaryCorrelation(summary: SourceEventSummary):
  | { readonly kind: 'provider_request'; readonly requestId: string }
  | {
      readonly kind: 'host_execution';
      readonly planId: string;
      readonly planContentSha256: string;
      readonly instanceId: string | null;
      readonly executionId: string | null;
      readonly reportId: string;
    }
  | null {
  if (summary.correlationKind === 'provider_request') {
    return { kind: 'provider_request', requestId: summary.requestId };
  }
  if (summary.correlationKind === 'host_execution') {
    return {
      kind: 'host_execution',
      planId: summary.planId,
      planContentSha256: summary.planContentSha256,
      instanceId: summary.instanceId,
      executionId: summary.executionId,
      reportId: summary.reportId,
    };
  }
  return null;
}

function validateProviderEventPayload(
  run: ProviderEvalRun,
  event: EvalExecutionEvent,
  issues: string[],
): void {
  const label = `Run ${run.runId} provider event ${event.id}`;
  const expectedProvider = run.profile.descriptor;
  const reject = (reason: string) => issues.push(`${label} ${reason}`);

  if (run.invocation.operation === 'initial_plan') {
    const request = run.invocation.request;
    const packet = run.invocation.packet;
    const outcome = run.outcome;
    const expectedRequestHash = computeHumanEvalContentSha256(request);
    if (event.eventType === 'planning.provider.generation.requested') {
      const parsed = plannerGenerationRequestedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid requested payload');
        return;
      }
      const payload = parsed.data;
      if (
        payload.requestId !== request.requestId ||
        payload.requestFingerprint !== expectedRequestHash ||
        payload.providerId !== expectedProvider.id ||
        payload.providerVersion !== expectedProvider.version ||
        payload.targetAdapterId !== run.environment.targetAdapterId ||
        payload.catalogVersion !== run.environment.catalogVersion ||
        payload.planId !== packet.context.requestedPlanId ||
        payload.packetFormatVersion !== packet.formatVersion
      ) {
        reject('does not match the exact planning invocation');
      }
      return;
    }
    if (event.eventType === 'planning.provider.generation.completed') {
      const parsed = plannerGenerationCompletedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid completed payload');
        return;
      }
      if (
        outcome.status !== 'completed' ||
        outcome.operation !== 'initial_plan' ||
        parsed.data.requestFingerprint !== expectedRequestHash ||
        computeHumanEvalContentSha256(parsed.data.request) !== expectedRequestHash ||
        computeHumanEvalContentSha256(parsed.data.result) !== outcome.resultSha256
      ) {
        reject('does not match the exact completed run outcome');
      }
      return;
    }
    if (event.eventType === 'planning.provider.generation.failed') {
      const parsed = plannerGenerationFailedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid failed payload');
        return;
      }
      const payload = parsed.data;
      if (
        outcome.status !== 'failed' ||
        payload.requestId !== request.requestId ||
        payload.requestFingerprint !== expectedRequestHash ||
        payload.providerId !== expectedProvider.id ||
        payload.providerVersion !== expectedProvider.version ||
        payload.targetAdapterId !== run.environment.targetAdapterId ||
        payload.catalogVersion !== run.environment.catalogVersion ||
        payload.planId !== packet.context.requestedPlanId ||
        payload.error !== outcome.error.error
      ) {
        reject('does not match the exact failed run outcome');
      }
      return;
    }
  } else {
    const request = run.invocation.request;
    const packet = run.invocation.packet;
    const outcome = run.outcome;
    const expectedRequestHash = computeHumanEvalContentSha256(request);
    const revisionRequest = packet.context.revisionRequest;
    if (event.eventType === 'planning.provider.replan.requested') {
      const parsed = plannerReplanRequestedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid replan requested payload');
        return;
      }
      const payload = parsed.data;
      if (
        payload.requestId !== request.requestId ||
        payload.requestFingerprint !== expectedRequestHash ||
        payload.revisionRequestId !== request.revisionRequestId ||
        payload.providerId !== expectedProvider.id ||
        payload.providerVersion !== expectedProvider.version ||
        payload.targetAdapterId !== run.environment.targetAdapterId ||
        payload.targetInstanceId !== revisionRequest.instanceId ||
        payload.catalogVersion !== run.environment.catalogVersion ||
        payload.planId !== revisionRequest.basePlan.id ||
        payload.baseRevision !== revisionRequest.basePlan.revision ||
        payload.packetFormatVersion !== packet.formatVersion
      ) {
        reject('does not match the exact replanning invocation');
      }
      return;
    }
    if (event.eventType === 'planning.provider.replan.completed') {
      const parsed = plannerReplanCompletedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid replan completed payload');
        return;
      }
      if (
        outcome.status !== 'completed' ||
        outcome.operation !== 'local_replan' ||
        parsed.data.requestFingerprint !== expectedRequestHash ||
        computeHumanEvalContentSha256(parsed.data.request) !== expectedRequestHash ||
        computeHumanEvalContentSha256(parsed.data.result) !== outcome.resultSha256
      ) {
        reject('does not match the exact completed replan outcome');
      }
      return;
    }
    if (event.eventType === 'planning.provider.replan.failed') {
      const parsed = plannerReplanFailedEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        reject('has an invalid replan failed payload');
        return;
      }
      const payload = parsed.data;
      if (
        outcome.status !== 'failed' ||
        payload.requestId !== request.requestId ||
        payload.requestFingerprint !== expectedRequestHash ||
        payload.revisionRequestId !== request.revisionRequestId ||
        payload.providerId !== expectedProvider.id ||
        payload.providerVersion !== expectedProvider.version ||
        payload.targetAdapterId !== run.environment.targetAdapterId ||
        payload.targetInstanceId !== revisionRequest.instanceId ||
        payload.catalogVersion !== run.environment.catalogVersion ||
        payload.planId !== revisionRequest.basePlan.id ||
        payload.baseRevision !== revisionRequest.basePlan.revision ||
        payload.error !== outcome.error.error
      ) {
        reject('does not match the exact failed replan outcome');
      }
      return;
    }
  }
  reject(`uses unexpected event type ${event.eventType}`);
}

function expectedPlanId(run: ProviderEvalRun): string {
  return run.outcome.status === 'completed'
    ? run.outcome.result.draft.plan.id
    : run.invocation.operation === 'initial_plan'
      ? run.invocation.packet.context.requestedPlanId
      : run.invocation.packet.context.revisionRequest.basePlan.id;
}

function expectedPlanRevision(run: ProviderEvalRun): number {
  return run.outcome.status === 'completed'
    ? run.outcome.result.draft.plan.revision
    : run.invocation.operation === 'initial_plan'
      ? run.invocation.packet.context.recommendedRevision
      : run.invocation.packet.context.targetRevision;
}

function expectedPlanContentSha256(run: ProviderEvalRun): string | null {
  return run.outcome.status === 'completed' && run.outcome.result.status === 'ready'
    ? computePlanContentSha256(run.outcome.result.draft.plan)
    : null;
}

function validateLiveEvalExportEvidence(
  run: ProviderEvalRun,
  loadedArtifacts: ReadonlyMap<string, LoadedArtifact>,
  issues: string[],
): LiveRunLedgerEvidence {
  const hostReportsBySequence = new Map<string, CompanionStateReport>();
  if (run.sourceEvidence.kind !== 'eval_export_snapshot') {
    return {
      hostReportsBySequence,
      providerTerminalSequence: null,
      planAuthorizationSequences: [],
    };
  }

  const eventsBySequence = new Map<number, EvidenceEvent>();
  const eventsById = new Map<string, EvidenceEvent>();
  const bundles: CurrentEvalExportBundle[] = [];
  for (const artifactId of run.sourceEvidence.evalExportArtifactIds) {
    const loaded = loadedArtifacts.get(artifactId);
    if (loaded === undefined) {
      continue;
    }
    let bundle: CurrentEvalExportBundle;
    try {
      bundle = currentEvalExportBundleSchema.parse(
        JSON.parse(loaded.bytes.toString('utf8')) as unknown,
      );
    } catch (error) {
      issues.push(
        `Run ${run.runId} Eval export ${artifactId} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    bundles.push(bundle);

    const actualBundleHash = computeHumanEvalContentSha256(evalExportIntegrityContent(bundle));
    if (actualBundleHash !== bundle.integrity.contentSha256) {
      issues.push(
        `Run ${run.runId} Eval export ${artifactId} integrity mismatch: expected ${bundle.integrity.contentSha256}, got ${actualBundleHash}`,
      );
    }
    if (
      bundle.page.snapshotId !== run.sourceEvidence.snapshotId ||
      bundle.page.snapshotUpperSequence !== run.sourceEvidence.snapshotUpperSequence
    ) {
      issues.push(`Run ${run.runId} Eval export ${artifactId} does not match its frozen snapshot`);
    }
    if (
      bundle.protocolVersion !== run.environment.protocolVersion ||
      bundle.scope.targetAdapterId !== run.environment.targetAdapterId ||
      bundle.scope.planId !== expectedPlanId(run) ||
      (run.invocation.operation === 'local_replan' &&
        bundle.scope.instanceId !== run.invocation.packet.context.revisionRequest.instanceId)
    ) {
      issues.push(
        `Run ${run.runId} Eval export ${artifactId} scope does not match its protocol, adapter, plan, and instance`,
      );
    }
    if (
      !bundle.catalogs.some(
        (catalog) =>
          catalog.adapterId === run.environment.targetAdapterId &&
          catalog.catalogVersion === run.environment.catalogVersion &&
          computeHumanEvalContentSha256(catalog) ===
            computeHumanEvalContentSha256(run.invocation.packet.context.catalog),
      )
    ) {
      issues.push(
        `Run ${run.runId} Eval export ${artifactId} does not contain the exact catalog ${run.environment.targetAdapterId}@${run.environment.catalogVersion}`,
      );
    }
    for (const event of bundle.events) {
      const sequenceCollision = eventsBySequence.get(event.sequence);
      if (sequenceCollision !== undefined) {
        issues.push(
          `Run ${run.runId} Eval export artifacts conflict at sequence ${event.sequence}`,
        );
      }
      const idCollision = eventsById.get(event.id);
      if (idCollision !== undefined) {
        issues.push(`Run ${run.runId} Eval export artifacts conflict for event ${event.id}`);
      }
      const evidenceEvent = { event, bundle };
      eventsBySequence.set(event.sequence, evidenceEvent);
      eventsById.set(event.id, evidenceEvent);
    }
  }

  const firstBundle = bundles[0];
  if (firstBundle !== undefined) {
    let expectedAfterSequence = 0;
    let eventCount = 0;
    const expectedScope = computeHumanEvalContentSha256(firstBundle.scope);
    const expectedCatalogs = computeHumanEvalContentSha256(firstBundle.catalogs);
    const expectedSummary = computeHumanEvalContentSha256(firstBundle.summary);
    for (const [index, bundle] of bundles.entries()) {
      const page = bundle.page;
      const lastSequence = bundle.events.at(-1)?.sequence ?? page.afterSequence;
      if (
        computeHumanEvalContentSha256(bundle.scope) !== expectedScope ||
        computeHumanEvalContentSha256(bundle.catalogs) !== expectedCatalogs ||
        computeHumanEvalContentSha256(bundle.summary) !== expectedSummary
      ) {
        issues.push(`Run ${run.runId} Eval export pages do not preserve one frozen view`);
      }
      if (
        page.afterSequence !== expectedAfterSequence ||
        page.nextAfterSequence !== lastSequence ||
        bundle.events.some(
          (event, eventIndex) =>
            event.sequence <= page.afterSequence ||
            event.sequence > page.snapshotUpperSequence ||
            (eventIndex > 0 && event.sequence <= bundle.events[eventIndex - 1]!.sequence),
        ) ||
        (index < bundles.length - 1 && !page.hasMore) ||
        (index === bundles.length - 1 && page.hasMore)
      ) {
        issues.push(`Run ${run.runId} Eval export artifacts do not form one complete page chain`);
      }
      expectedAfterSequence = page.nextAfterSequence;
      eventCount += bundle.events.length;
    }
    if (eventCount !== firstBundle.summary.matchedEventCount) {
      issues.push(
        `Run ${run.runId} Eval export page chain does not contain its complete matched event set`,
      );
    }
  }

  const requestId = run.invocation.request.requestId;
  for (const summary of run.sourceEvents) {
    const evidenceEvent = eventsBySequence.get(summary.sequence);
    const event = evidenceEvent?.event;
    if (
      evidenceEvent === undefined ||
      event === undefined ||
      event.id !== summary.eventId ||
      event.eventType !== summary.eventType ||
      computeHumanEvalContentSha256(event.payload) !== summary.payloadSha256
    ) {
      issues.push(
        `Run ${run.runId} source event ${summary.eventId} does not match its Eval export evidence`,
      );
      continue;
    }
    const correlation = summaryCorrelation(summary);
    if (correlation?.kind === 'provider_request') {
      if (eventRequestId(event) !== requestId || correlation.requestId !== requestId) {
        issues.push(
          `Run ${run.runId} source event ${summary.eventId} is not correlated to its provider request`,
        );
      }
      validateProviderEventPayload(run, event, issues);
    } else if (correlation?.kind === 'host_execution') {
      const hostReport = companionStateReportSchema.safeParse(event.payload);
      if (
        event.eventType !== 'companion.state.reported' ||
        !hostReport.success ||
        hostReport.data.protocolVersion !== run.environment.protocolVersion ||
        hostReport.data.adapterId !== run.environment.targetAdapterId ||
        hostReport.data.plan?.id !== expectedPlanId(run) ||
        hostReport.data.plan?.revision !== expectedPlanRevision(run) ||
        hostReport.data.planContentSha256 !== expectedPlanContentSha256(run) ||
        hostReport.data.planContentSha256 !== correlation.planContentSha256 ||
        hostReport.data.hostVersion !== run.environment.hostVersion ||
        hostReport.data.companionVersion !== run.environment.adapterVersion ||
        hostReport.data.instanceId !== correlation.instanceId ||
        hostReport.data.executionId !== correlation.executionId ||
        hostReport.data.reportId !== correlation.reportId ||
        correlation.planId !== expectedPlanId(run) ||
        correlation.instanceId !== evidenceEvent.bundle.scope.instanceId
      ) {
        issues.push(
          `Run ${run.runId} source event ${summary.eventId} is not correlated to its exact host plan revision, instance, and environment`,
        );
      } else {
        hostReportsBySequence.set(String(summary.sequence), hostReport.data);
      }
    } else {
      issues.push(`Run ${run.runId} source event ${summary.eventId} has no supported correlation`);
    }
  }

  const providerEvents = run.sourceEvents.filter(
    (event) => summaryCorrelation(event)?.kind === 'provider_request',
  );
  const requestedCount = providerEvents.filter((event) =>
    event.eventType.endsWith('.requested'),
  ).length;
  const terminalCount = providerEvents.filter(
    (event) => event.eventType.endsWith('.completed') || event.eventType.endsWith('.failed'),
  ).length;
  if (requestedCount !== 1 || terminalCount !== 1 || providerEvents.length !== 2) {
    issues.push(
      `Run ${run.runId} live evidence must contain exactly one requested event and one terminal event`,
    );
  }

  const providerEventPrefix =
    run.invocation.operation === 'initial_plan'
      ? 'planning.provider.generation'
      : 'planning.provider.replan';
  const rawProviderEvents = [...eventsBySequence.values()]
    .map(({ event }) => event)
    .filter(
      (event) =>
        event.eventType.startsWith(`${providerEventPrefix}.`) &&
        eventRequestId(event) === requestId,
    );
  const rawRequestedCount = rawProviderEvents.filter(
    (event) => event.eventType === `${providerEventPrefix}.requested`,
  ).length;
  const expectedTerminalType = `${providerEventPrefix}.${run.outcome.status}`;
  const rawTerminalCount = rawProviderEvents.filter(
    (event) =>
      event.eventType === `${providerEventPrefix}.completed` ||
      event.eventType === `${providerEventPrefix}.failed`,
  ).length;
  const summarizedProviderEventIds = new Set(providerEvents.map((event) => event.eventId));
  if (
    rawProviderEvents.length !== 2 ||
    rawRequestedCount !== 1 ||
    rawTerminalCount !== 1 ||
    rawProviderEvents.filter((event) => event.eventType === expectedTerminalType).length !== 1 ||
    rawProviderEvents.some((event) => !summarizedProviderEventIds.has(event.id))
  ) {
    issues.push(
      `Run ${run.runId} frozen Eval export must contain exactly the summarized provider request and matching terminal event`,
    );
  }
  const rawTerminal = rawProviderEvents.find((event) => event.eventType === expectedTerminalType);
  const providerTerminalSequence = rawTerminal?.sequence ?? null;
  const planContentSha256 = expectedPlanContentSha256(run);
  const planAuthorizationSequences: number[] = [];
  if (providerTerminalSequence !== null && planContentSha256 !== null) {
    const rawEvents = [...eventsBySequence.values()]
      .map(({ event }) => event)
      .sort((left, right) => left.sequence - right.sequence);
    for (const event of rawEvents) {
      if (event.sequence <= providerTerminalSequence) {
        continue;
      }
      if (event.eventType === 'guide.plan.published') {
        const publishedPlan = guidePlanSchema.safeParse(recordAt(event.payload, 'plan'));
        if (
          publishedPlan.success &&
          computePlanContentSha256(publishedPlan.data) === planContentSha256
        ) {
          planAuthorizationSequences.push(event.sequence);
        }
      }
    }
    const exactProposals: Array<{
      readonly event: EvalExecutionEvent;
      readonly proposal: ReturnType<typeof guideProposalSchema.parse>;
    }> = [];
    for (const event of rawEvents) {
      if (
        event.sequence <= providerTerminalSequence ||
        event.eventType !== 'guide.proposal.created'
      ) {
        continue;
      }
      const proposal = guideProposalSchema.safeParse(event.payload);
      if (
        proposal.success &&
        proposal.data.targetAdapterId === run.environment.targetAdapterId &&
        computePlanContentSha256(proposal.data.plan) === planContentSha256
      ) {
        exactProposals.push({ event, proposal: proposal.data });
      }
    }
    for (const proposal of exactProposals) {
      const accepted = rawEvents.find((event) => {
        if (
          event.sequence <= proposal.event.sequence ||
          event.eventType !== 'guide.proposal.decided'
        ) {
          return false;
        }
        const decision = guideProposalDecisionSchema.safeParse(event.payload);
        return (
          decision.success &&
          decision.data.proposalId === proposal.proposal.proposalId &&
          decision.data.adapterId === run.environment.targetAdapterId &&
          decision.data.decision === 'accepted' &&
          (proposal.proposal.targetInstanceId === undefined ||
            decision.data.instanceId === proposal.proposal.targetInstanceId)
        );
      });
      if (accepted !== undefined) {
        planAuthorizationSequences.push(accepted.sequence);
      }
    }
  }
  return {
    hostReportsBySequence,
    providerTerminalSequence,
    planAuthorizationSequences: [...new Set(planAuthorizationSequences)].sort(
      (left, right) => left - right,
    ),
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isJudgeable(judgment: HumanEvalCriterionJudgment): boolean {
  return judgment.judgment !== 'unable_to_judge' && judgment.judgment !== 'not_applicable';
}

function currentAnnotationsForRun(
  dataset: ValidatedHumanEvalDataset,
  runId: string,
): ValidatedHumanEvalDataset['annotations'] {
  const supersededIds = new Set(
    dataset.annotations.flatMap((annotation) =>
      annotation.supersedesAnnotationId === null ? [] : [annotation.supersedesAnnotationId],
    ),
  );
  return dataset.annotations.filter(
    (annotation) => annotation.runId === runId && !supersededIds.has(annotation.annotationId),
  );
}

function effectiveJudgmentsForRun(
  dataset: ValidatedHumanEvalDataset,
  runId: string,
): readonly HumanEvalCriterionJudgment[] {
  const adjudication = dataset.adjudications.find((candidate) => candidate.runId === runId);
  return adjudication === undefined
    ? currentAnnotationsForRun(dataset, runId).flatMap((annotation) => annotation.review.judgments)
    : adjudication.judgments;
}

function isExactTerminalHostExecution(
  run: ProviderEvalRun,
  ledger: LiveRunLedgerEvidence,
  eventSequence: string,
  judgment: HumanEvalCriterionJudgment['judgment'],
): boolean {
  const report = ledger.hostReportsBySequence.get(eventSequence);
  const ledgerSequence = Number(eventSequence);
  const providerTerminalSequence = ledger.providerTerminalSequence;
  if (
    report === undefined ||
    report.executionId === null ||
    run.outcome.status !== 'completed' ||
    run.outcome.result.status !== 'ready' ||
    providerTerminalSequence === null ||
    !Number.isSafeInteger(ledgerSequence) ||
    ledgerSequence <= providerTerminalSequence ||
    !ledger.planAuthorizationSequences.some(
      (sequence) => sequence > providerTerminalSequence && sequence < ledgerSequence,
    )
  ) {
    return false;
  }
  const executableStepIds = run.outcome.result.draft.plan.steps
    .filter((step) => step.action !== null)
    .map((step) => step.id);
  const completedSuccessfully =
    report.phase === 'completed' &&
    report.transition === 'step_succeeded' &&
    report.stepId !== null &&
    sameStringSet(report.completedStepIds, executableStepIds);
  const failedInHost = report.phase === 'error' && report.transition === 'error';
  return completedSuccessfully || (judgment !== 'met' && failedInHost);
}

function validateReleasedEvidenceClaims(
  dataset: ValidatedHumanEvalDataset,
  evidenceByRun: ReadonlyMap<string, VerifiedRunEvidence>,
  issues: string[],
): void {
  if (dataset.suite.status !== 'released') {
    return;
  }
  const exactStageCoverage = new Set<string>();
  const executionOwners = new Map<string, string>();
  const claimExecution = (executionId: string, runId: string): boolean => {
    const owner = executionOwners.get(executionId);
    if (owner !== undefined && owner !== runId) {
      issues.push(`Released runs ${owner} and ${runId} cannot reuse host execution ${executionId}`);
      return false;
    }
    executionOwners.set(executionId, runId);
    return true;
  };
  for (const run of dataset.runs) {
    const evalCase = dataset.casesById.get(run.caseRef.caseId);
    const verified = evidenceByRun.get(run.runId);
    if (evalCase === undefined || verified === undefined) {
      continue;
    }
    const judgments = effectiveJudgmentsForRun(dataset, run.runId);
    for (const criterionId of evalCase.rubricCriterionIds) {
      const criterion = dataset.suite.rubric.criteria.find(
        (candidate) => candidate.id === criterionId,
      );
      if (criterion === undefined || criterion.evaluationStage === 'plan') {
        continue;
      }
      for (const judgment of judgments.filter(
        (candidate) => candidate.criterionId === criterionId && isJudgeable(candidate),
      )) {
        if (criterion.evaluationStage === 'execution') {
          const exactExecutionEvidence = judgment.evidence.find(
            (evidence) =>
              evidence.kind === 'execution_event' &&
              isExactTerminalHostExecution(
                run,
                verified.ledger,
                evidence.locator,
                judgment.judgment,
              ),
          );
          const exactExecutionReport =
            exactExecutionEvidence === undefined
              ? undefined
              : verified.ledger.hostReportsBySequence.get(exactExecutionEvidence.locator);
          const hasExactExecution =
            exactExecutionReport?.executionId !== null &&
            exactExecutionReport?.executionId !== undefined &&
            claimExecution(exactExecutionReport.executionId, run.runId);
          if (hasExactExecution) {
            exactStageCoverage.add(`${evalCase.id}\u0000${criterionId}`);
          } else {
            issues.push(
              `Released run ${run.runId} judgment for ${criterionId} requires exact terminal host execution evidence`,
            );
          }
        }
        if (criterion.evaluationStage === 'artifact') {
          const exactArtifactEvidence = judgment.evidence.find((evidence) => {
            if (evidence.kind !== 'artifact') {
              return false;
            }
            const artifact = run.artifacts.find(
              (candidate) => candidate.artifactId === evidence.locator,
            );
            if (
              artifact?.kind !== 'rendered_image' ||
              artifact.mediaType !== 'image/png' ||
              artifact.visualEnvironment === undefined
            ) {
              return false;
            }
            const visual = artifact.visualEnvironment;
            const terminalSequence = String(visual.terminalHostEventSequence);
            const terminalReport = verified.ledger.hostReportsBySequence.get(terminalSequence);
            return (
              visual.hostVersion === run.environment.hostVersion &&
              visual.adapterVersion === run.environment.adapterVersion &&
              visual.planContentSha256 === expectedPlanContentSha256(run) &&
              terminalReport?.planContentSha256 === visual.planContentSha256 &&
              terminalReport?.executionId === visual.executionId &&
              terminalReport?.reportId === visual.terminalHostReportId &&
              isExactTerminalHostExecution(
                run,
                verified.ledger,
                terminalSequence,
                judgment.judgment,
              ) &&
              verified.loadedArtifacts.has(artifact.artifactId)
            );
          });
          const exactArtifact =
            exactArtifactEvidence?.kind === 'artifact'
              ? run.artifacts.find(
                  (artifact) => artifact.artifactId === exactArtifactEvidence.locator,
                )
              : undefined;
          const hasExactArtifact =
            exactArtifact?.visualEnvironment !== undefined &&
            claimExecution(exactArtifact.visualEnvironment.executionId, run.runId);
          if (hasExactArtifact) {
            exactStageCoverage.add(`${evalCase.id}\u0000${criterionId}`);
          } else {
            issues.push(
              `Released run ${run.runId} judgment for ${criterionId} requires an exact environment-bound rendered image`,
            );
          }
        }
      }
    }
  }
  for (const evalCase of dataset.suite.cases) {
    for (const criterionId of evalCase.rubricCriterionIds) {
      const criterion = dataset.suite.rubric.criteria.find(
        (candidate) => candidate.id === criterionId,
      );
      if (
        criterion !== undefined &&
        criterion.evaluationStage !== 'plan' &&
        !exactStageCoverage.has(`${evalCase.id}\u0000${criterionId}`)
      ) {
        issues.push(
          `Released case ${evalCase.id} lacks exact ${criterion.evaluationStage} evidence for ${criterionId}`,
        );
      }
    }
  }
}

export async function loadHumanEvalDatasetDirectory(
  directory: string,
  options: HumanEvalDatasetDirectoryOptions = {},
): Promise<ValidatedHumanEvalDataset> {
  const datasetDirectory = resolve(directory);
  const [suite, runs, annotations, adjudications] = await Promise.all([
    readJson(resolve(datasetDirectory, 'suite.json')),
    readRecords(resolve(datasetDirectory, 'runs'), '.run.json'),
    readRecords(resolve(datasetDirectory, 'annotations'), '.annotation.json'),
    readRecords(resolve(datasetDirectory, 'adjudications'), '.adjudication.json'),
  ]);
  const dataset = validateHumanEvalDataset({ suite, runs, annotations, adjudications });
  const issues: string[] = [];
  const artifactRoots = options.artifactRoots ?? {};
  const maxArtifactBytes = options.maxArtifactBytes ?? defaultMaxArtifactBytes;
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0) {
    throw new HumanEvalDatasetError('Human Eval artifact options are invalid', [
      'maxArtifactBytes must be a positive safe integer',
    ]);
  }
  for (const evalCase of dataset.suite.cases) {
    for (const reference of evalCase.references) {
      try {
        const loaded = await loadArtifact(
          datasetDirectory,
          reference,
          artifactRoots,
          maxArtifactBytes,
        );
        const actual = sha256(loaded.bytes);
        if (actual !== reference.contentSha256) {
          issues.push(
            `Case ${evalCase.id} artifact ${reference.artifactId} hash mismatch: expected ${reference.contentSha256}, got ${actual}`,
          );
        }
        if (
          evalCase.operation === 'local_replan' &&
          reference.artifactId === evalCase.basePlan.artifactId
        ) {
          const parsed = guidePlanSchema.safeParse(
            (() => {
              try {
                return JSON.parse(loaded.bytes.toString('utf8')) as unknown;
              } catch {
                return null;
              }
            })(),
          );
          if (!parsed.success) {
            issues.push(
              `Case ${evalCase.id} base Plan artifact ${reference.artifactId} is not a valid GuidePlan`,
            );
          } else if (
            parsed.data.id !== evalCase.basePlan.planId ||
            parsed.data.revision !== evalCase.basePlan.revision ||
            computePlanContentSha256(parsed.data) !== evalCase.basePlan.planContentSha256
          ) {
            issues.push(
              `Case ${evalCase.id} base Plan artifact ${reference.artifactId} does not match its exact immutable base Plan`,
            );
          }
        }
      } catch (error) {
        issues.push(
          `Case ${evalCase.id} artifact ${reference.artifactId} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const evidenceByRun = new Map<string, VerifiedRunEvidence>();
  for (const run of dataset.runs) {
    const loadedArtifacts = new Map<string, LoadedArtifact>();
    for (const artifact of run.artifacts) {
      try {
        const loaded = await loadArtifact(
          datasetDirectory,
          artifact,
          artifactRoots,
          maxArtifactBytes,
        );
        loadedArtifacts.set(artifact.artifactId, loaded);
        const actual = sha256(loaded.bytes);
        if (actual !== artifact.contentSha256) {
          issues.push(
            `Run ${run.runId} artifact ${artifact.artifactId} hash mismatch: expected ${artifact.contentSha256}, got ${actual}`,
          );
        }
        if (artifact.kind === 'rendered_image') {
          const visual = artifact.visualEnvironment;
          if (
            artifact.mediaType !== 'image/png' ||
            visual?.hostVersion !== run.environment.hostVersion ||
            visual.adapterVersion !== run.environment.adapterVersion
          ) {
            issues.push(
              `Run ${run.runId} rendered image ${artifact.artifactId} does not match its exact host and adapter environment`,
            );
          }
          if (artifact.mediaType === 'image/png' && visual !== undefined) {
            try {
              const dimensions = decodePngDimensions(loaded.bytes, maxArtifactBytes);
              if (dimensions.width !== visual.width || dimensions.height !== visual.height) {
                issues.push(
                  `Run ${run.runId} rendered image ${artifact.artifactId} dimensions do not match its visual provenance`,
                );
              }
            } catch (error) {
              issues.push(
                `Run ${run.runId} rendered image ${artifact.artifactId} is not a decodable PNG: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
      } catch (error) {
        issues.push(
          `Run ${run.runId} artifact ${artifact.artifactId} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    evidenceByRun.set(run.runId, {
      loadedArtifacts,
      ledger: validateLiveEvalExportEvidence(run, loadedArtifacts, issues),
    });
  }
  validateReleasedEvidenceClaims(dataset, evidenceByRun, issues);

  if (issues.length > 0) {
    throw new HumanEvalDatasetError('Human Eval artifact validation failed', issues);
  }
  return markArtifactVerifiedDataset({ ...dataset, verificationLevel: 'artifact_verified' });
}
