import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  hasRequiredRecognizerIsolation,
  recognitionSha256,
  tutorialMediaRecognizerIsolationPolicy,
  tutorialMediaRecognizerLimits,
  validateIsolationAttestation,
  type RecognizerIsolationAttestation,
  type RecognizerIsolationExecution,
  type RecognizerIsolationExecutionResult,
  type RecognizerIsolationSupervisor,
} from './tutorial-media-process-isolation.js';

const sha256Pattern = /^[a-f0-9]{64}$/u;

export type TutorialMediaUiRecognizerErrorCode =
  'invalid_request' | 'recognizer_unavailable' | 'recognition_failed';

export class TutorialMediaUiRecognizerError extends Error {
  constructor(readonly code: TutorialMediaUiRecognizerErrorCode) {
    super(
      code === 'invalid_request'
        ? 'The UI recognition request is invalid.'
        : code === 'recognizer_unavailable'
          ? 'The configured UI recognizer is unavailable.'
          : 'UI recognition failed.',
    );
    this.name = 'TutorialMediaUiRecognizerError';
  }
}

export interface RecognizerIsolationSupervisorDescriptor {
  readonly formatVersion: '1.0.0';
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly licenseId: string;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly modelPath: string;
  readonly modelSha256: string;
  readonly licensePath: string;
  readonly licenseSha256: string;
  readonly configPath: string;
  readonly configSha256: string;
  readonly versionOutputSha256: string;
  readonly workingDirectory: string;
  readonly arguments: readonly string[];
  readonly locale: string;
  readonly platform: string;
  readonly isolationPolicy: typeof tutorialMediaRecognizerIsolationPolicy;
}

export interface RecognizerFrameInput {
  readonly frameId: string;
  readonly framePath: string;
  readonly frameSha256: string;
  readonly ocrArtifactSha256: string;
  readonly ocrCandidatesSha256: string;
  readonly timestampMs: number;
}

export interface RecognizerUiCandidate {
  readonly candidateId: string;
  readonly kind: 'ui_element' | 'menu' | 'control';
  readonly frameId: string;
  readonly timestampMs: number;
  readonly label: string;
  readonly normalizedLabel: string;
  readonly menuId: string | null;
  readonly controlId: string | null;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly confidence: number;
}

export interface RecognizerKeyCandidate {
  readonly candidateId: string;
  readonly kind: 'key_chord';
  readonly frameId: string;
  readonly timestampMs: number;
  readonly label: string;
  readonly normalizedKeys: readonly string[];
  readonly confidence: number;
}

export interface RecognizerProcessOutput {
  readonly formatVersion: '1.0.0';
  readonly uiCandidates: readonly RecognizerUiCandidate[];
  readonly keyCandidates: readonly RecognizerKeyCandidate[];
}

export interface RecognizerProcessResult extends RecognizerProcessOutput {
  readonly isolationAttestation: RecognizerIsolationAttestation;
}

async function snapshotExactRegularFile(options: {
  readonly sourcePath: string;
  readonly expectedSha256: string;
  readonly snapshotPath: string;
  readonly executable?: boolean;
}): Promise<void> {
  const { sourcePath, expectedSha256, snapshotPath } = options;
  if (
    !isAbsolute(sourcePath) ||
    resolve(sourcePath) !== sourcePath ||
    !sha256Pattern.test(expectedSha256)
  ) {
    throw new TutorialMediaUiRecognizerError('recognizer_unavailable');
  }
  let source;
  let destination;
  try {
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await source.stat();
    if (!before.isFile() || before.nlink !== 1) throw new Error('unsafe');
    destination = await open(
      snapshotPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      options.executable === true ? 0o500 : 0o400,
    );
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          chunk,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten === 0) throw new Error('short write');
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    const after = await source.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      position !== before.size ||
      hash.digest('hex') !== expectedSha256
    )
      throw new Error('drift');
    await destination.sync();
    await destination.close();
    destination = undefined;
    await chmod(snapshotPath, options.executable === true ? 0o500 : 0o400);
  } catch {
    throw new TutorialMediaUiRecognizerError('recognizer_unavailable');
  } finally {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
  }
}

function orderedFrameManifestSha256(frames: readonly RecognizerFrameInput[]): string {
  return recognitionSha256(
    frames.map((frame) => ({
      frameId: frame.frameId,
      frameSha256: frame.frameSha256,
      ocrArtifactSha256: frame.ocrArtifactSha256,
      ocrCandidatesSha256: frame.ocrCandidatesSha256,
      timestampMs: frame.timestampMs,
    })),
  );
}

function validTerminationEvidence(
  evidence: RecognizerIsolationExecutionResult['terminationEvidence'],
  execution: RecognizerIsolationExecution,
  reason: RecognizerIsolationExecutionResult['terminationReason'],
): boolean {
  return (
    evidence.invocationNonce === execution.invocationNonce &&
    evidence.reason === reason &&
    evidence.processTreeTerminated === true &&
    !Number.isNaN(Date.parse(evidence.observedAt))
  );
}

async function executeWithHostWatchdog(
  supervisor: RecognizerIsolationSupervisor,
  execution: RecognizerIsolationExecution,
): Promise<RecognizerIsolationExecutionResult> {
  const terminateWithDeadline = async (reason: 'wall_time_limit' | 'host_abort') => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const evidence = await Promise.race([
        supervisor.terminate(execution.invocationNonce, reason),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Recognizer termination acknowledgement timed out.')),
            execution.limits.terminationAcknowledgementMs,
          );
        }),
      ]);
      if (
        evidence.invocationNonce !== execution.invocationNonce ||
        evidence.reason !== reason ||
        evidence.processTreeTerminated !== true ||
        Number.isNaN(Date.parse(evidence.observedAt))
      )
        throw new Error('Invalid termination evidence.');
      throw new Error(`Recognizer terminated: ${reason}.`);
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
  };
  if (execution.signal?.aborted === true) {
    return terminateWithDeadline('host_abort');
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let termination: Promise<never> | undefined;
  const stop = (reason: 'wall_time_limit' | 'host_abort') => terminateWithDeadline(reason);
  const triggerStop = (
    reason: 'wall_time_limit' | 'host_abort',
    reject: (error: Error) => void,
  ): void => {
    if (termination !== undefined) return;
    termination = stop(reason);
    // Close the success race as soon as the host boundary fires. The caller still awaits the
    // termination acknowledgement below before snapshot cleanup, but a late `completed` result
    // can no longer win while that acknowledgement is pending.
    reject(new Error(`Recognizer host boundary triggered: ${reason}.`));
  };
  const watchdog = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => triggerStop('wall_time_limit', reject), execution.limits.wallTimeMs);
    abortListener = () => triggerStop('host_abort', reject);
    execution.signal?.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([supervisor.execute(execution), watchdog]);
  } catch (error) {
    if (termination !== undefined) {
      return await termination;
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortListener !== undefined) execution.signal?.removeEventListener('abort', abortListener);
  }
}

function encodeFrame(value: unknown): Uint8Array {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

export function decodeRecognizerOutput(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 4 || bytes.byteLength > tutorialMediaRecognizerLimits.stdoutBytes) {
    throw new TutorialMediaUiRecognizerError('recognition_failed');
  }
  const buffer = Buffer.from(bytes);
  const length = buffer.readUInt32BE(0);
  if (length === 0 || length !== buffer.byteLength - 4) {
    throw new TutorialMediaUiRecognizerError('recognition_failed');
  }
  try {
    return JSON.parse(buffer.subarray(4).toString('utf8')) as unknown;
  } catch {
    throw new TutorialMediaUiRecognizerError('recognition_failed');
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    keys
      .slice()
      .sort()
      .every((key, index) => key === actual[index])
  );
}

function finiteUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function label(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= tutorialMediaRecognizerLimits.maximumLabelBytes
  );
}

function normalizedUiLabel(value: string): string {
  return value.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function validNormalizedKeys(value: readonly string[]): boolean {
  const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const modifiers = value.slice(0, -1);
  const key = value.at(-1);
  const modifierIndexes = modifiers.map((modifier) => modifierOrder.indexOf(modifier));
  return (
    key !== undefined &&
    modifierIndexes.every(
      (index, position) => index >= 0 && (position === 0 || index > modifierIndexes[position - 1]!),
    ) &&
    /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Backspace|Delete|Down|End|Enter|Escape|Home|Insert|Left|PageDown|PageUp|Right|Space|Tab|Up)$/u.test(
      key,
    )
  );
}

function validateOutput(
  value: unknown,
  frameTimestamps: ReadonlyMap<string, number>,
): RecognizerProcessOutput {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['formatVersion', 'keyCandidates', 'uiCandidates']) ||
    value.formatVersion !== '1.0.0' ||
    !Array.isArray(value.uiCandidates) ||
    !Array.isArray(value.keyCandidates)
  ) {
    throw new TutorialMediaUiRecognizerError('recognition_failed');
  }
  if (
    value.uiCandidates.length + value.keyCandidates.length >
    tutorialMediaRecognizerLimits.maximumCandidates
  )
    throw new TutorialMediaUiRecognizerError('recognition_failed');
  const ids = new Set<string>();
  const uiCandidates = value.uiCandidates.map((candidate): RecognizerUiCandidate => {
    if (
      !plainObject(candidate) ||
      !exactKeys(candidate, [
        'bounds',
        'candidateId',
        'confidence',
        'controlId',
        'frameId',
        'kind',
        'label',
        'menuId',
        'normalizedLabel',
        'timestampMs',
      ])
    )
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    const bounds = candidate.bounds;
    if (
      !plainObject(bounds) ||
      !exactKeys(bounds, ['height', 'width', 'x', 'y']) ||
      !finiteUnit(bounds.x) ||
      !finiteUnit(bounds.y) ||
      !finiteUnit(bounds.width) ||
      !finiteUnit(bounds.height) ||
      bounds.x + bounds.width > 1 ||
      bounds.y + bounds.height > 1
    )
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    if (
      !label(candidate.candidateId) ||
      ids.has(candidate.candidateId) ||
      typeof candidate.frameId !== 'string' ||
      !frameTimestamps.has(candidate.frameId) ||
      !['ui_element', 'menu', 'control'].includes(candidate.kind as string) ||
      !label(candidate.label) ||
      !label(candidate.normalizedLabel) ||
      candidate.normalizedLabel !== normalizedUiLabel(candidate.label) ||
      !(candidate.menuId === null || label(candidate.menuId)) ||
      !(candidate.controlId === null || label(candidate.controlId)) ||
      typeof candidate.timestampMs !== 'number' ||
      !Number.isSafeInteger(candidate.timestampMs) ||
      candidate.timestampMs < 0 ||
      frameTimestamps.get(candidate.frameId) !== candidate.timestampMs ||
      !finiteUnit(candidate.confidence)
    )
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    ids.add(candidate.candidateId);
    return candidate as unknown as RecognizerUiCandidate;
  });
  const keyCandidates = value.keyCandidates.map((candidate): RecognizerKeyCandidate => {
    if (
      !plainObject(candidate) ||
      !exactKeys(candidate, [
        'candidateId',
        'confidence',
        'frameId',
        'kind',
        'label',
        'normalizedKeys',
        'timestampMs',
      ]) ||
      candidate.kind !== 'key_chord' ||
      !label(candidate.candidateId) ||
      ids.has(candidate.candidateId) ||
      typeof candidate.frameId !== 'string' ||
      !frameTimestamps.has(candidate.frameId) ||
      !label(candidate.label) ||
      !Array.isArray(candidate.normalizedKeys) ||
      candidate.normalizedKeys.length === 0 ||
      candidate.normalizedKeys.length > 8 ||
      !candidate.normalizedKeys.every(label) ||
      !validNormalizedKeys(candidate.normalizedKeys as string[]) ||
      typeof candidate.timestampMs !== 'number' ||
      !Number.isSafeInteger(candidate.timestampMs) ||
      candidate.timestampMs < 0 ||
      frameTimestamps.get(candidate.frameId) !== candidate.timestampMs ||
      !finiteUnit(candidate.confidence)
    )
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    ids.add(candidate.candidateId);
    return candidate as unknown as RecognizerKeyCandidate;
  });
  return { formatVersion: '1.0.0', uiCandidates, keyCandidates };
}

export async function runTutorialMediaUiRecognizer(options: {
  readonly descriptor: RecognizerIsolationSupervisorDescriptor;
  readonly supervisor: RecognizerIsolationSupervisor;
  readonly frames: readonly RecognizerFrameInput[];
  readonly signal?: AbortSignal;
}): Promise<RecognizerProcessResult> {
  const { descriptor, supervisor, frames } = options;
  if (
    descriptor.isolationPolicy !== tutorialMediaRecognizerIsolationPolicy ||
    descriptor.formatVersion !== '1.0.0' ||
    !isAbsolute(descriptor.workingDirectory) ||
    resolve(descriptor.workingDirectory) !== descriptor.workingDirectory ||
    descriptor.arguments.some((argument) => argument.includes('\0')) ||
    [
      descriptor.adapterId,
      descriptor.adapterVersion,
      descriptor.modelId,
      descriptor.modelVersion,
      descriptor.licenseId,
      descriptor.locale,
      descriptor.platform,
    ].some((value) => value.length === 0 || value.includes('\0')) ||
    !sha256Pattern.test(descriptor.versionOutputSha256) ||
    !hasRequiredRecognizerIsolation(supervisor.capabilities)
  )
    throw new TutorialMediaUiRecognizerError('recognizer_unavailable');
  if (frames.length === 0 || frames.length > tutorialMediaRecognizerLimits.maximumFrames)
    throw new TutorialMediaUiRecognizerError('invalid_request');
  const permittedAbsoluteArguments = new Set([
    descriptor.modelPath,
    descriptor.licensePath,
    descriptor.configPath,
    ...frames.map((frame) => frame.framePath),
  ]);
  if (
    descriptor.arguments.some(
      (argument) => isAbsolute(argument) && !permittedAbsoluteArguments.has(argument),
    )
  ) {
    throw new TutorialMediaUiRecognizerError('recognizer_unavailable');
  }
  const frameTimestamps = new Map<string, number>();
  for (const frame of frames) {
    if (
      !label(frame.frameId) ||
      frameTimestamps.has(frame.frameId) ||
      !sha256Pattern.test(frame.frameSha256) ||
      !sha256Pattern.test(frame.ocrArtifactSha256) ||
      !sha256Pattern.test(frame.ocrCandidatesSha256) ||
      !isAbsolute(frame.framePath) ||
      resolve(frame.framePath) !== frame.framePath ||
      !Number.isSafeInteger(frame.timestampMs) ||
      frame.timestampMs < 0
    )
      throw new TutorialMediaUiRecognizerError('invalid_request');
    frameTimestamps.set(frame.frameId, frame.timestampMs);
  }
  const snapshotDirectory = await mkdtemp(join(tmpdir(), 'operatingline-recognizer-snapshot-'));
  try {
    const snapshot = {
      executablePath: join(snapshotDirectory, 'recognizer'),
      modelPath: join(snapshotDirectory, 'model'),
      licensePath: join(snapshotDirectory, 'license'),
      configPath: join(snapshotDirectory, 'config'),
      framePaths: frames.map((_frame, index) =>
        join(snapshotDirectory, `frame-${String(index).padStart(4, '0')}`),
      ),
    };
    await snapshotExactRegularFile({
      sourcePath: descriptor.executablePath,
      expectedSha256: descriptor.executableSha256,
      snapshotPath: snapshot.executablePath,
      executable: true,
    });
    await snapshotExactRegularFile({
      sourcePath: descriptor.modelPath,
      expectedSha256: descriptor.modelSha256,
      snapshotPath: snapshot.modelPath,
    });
    await snapshotExactRegularFile({
      sourcePath: descriptor.licensePath,
      expectedSha256: descriptor.licenseSha256,
      snapshotPath: snapshot.licensePath,
    });
    await snapshotExactRegularFile({
      sourcePath: descriptor.configPath,
      expectedSha256: descriptor.configSha256,
      snapshotPath: snapshot.configPath,
    });
    for (const [index, frame] of frames.entries())
      await snapshotExactRegularFile({
        sourcePath: frame.framePath,
        expectedSha256: frame.frameSha256,
        snapshotPath: snapshot.framePaths[index]!,
      });

    const pathRemapping = new Map([
      [descriptor.executablePath, snapshot.executablePath],
      [descriptor.modelPath, snapshot.modelPath],
      [descriptor.licensePath, snapshot.licensePath],
      [descriptor.configPath, snapshot.configPath],
      ...frames.map((frame, index) => [frame.framePath, snapshot.framePaths[index]!] as const),
    ]);
    const invocationNonce = randomUUID();
    const confinedReadPaths = [
      snapshot.executablePath,
      snapshot.modelPath,
      snapshot.licensePath,
      snapshot.configPath,
      ...snapshot.framePaths,
    ];
    const request = {
      formatVersion: '1.0.0',
      frames: frames.map(({ framePath: _path, ...frame }) => frame),
    };
    const execution: RecognizerIsolationExecution = {
      executablePath: snapshot.executablePath,
      modelPath: snapshot.modelPath,
      licensePath: snapshot.licensePath,
      configPath: snapshot.configPath,
      arguments: descriptor.arguments.map((argument) => pathRemapping.get(argument) ?? argument),
      workingDirectory: snapshotDirectory,
      stdin: encodeFrame(request),
      confinedFramePaths: snapshot.framePaths,
      confinedReadPaths,
      limits: tutorialMediaRecognizerLimits,
      policy: tutorialMediaRecognizerIsolationPolicy,
      invocationNonce,
      expectedHashes: {
        executableSha256: descriptor.executableSha256,
        modelSha256: descriptor.modelSha256,
        configSha256: descriptor.configSha256,
        licenseSha256: descriptor.licenseSha256,
        orderedFrameManifestSha256: orderedFrameManifestSha256(frames),
        snapshotAllowlistSha256: recognitionSha256(confinedReadPaths),
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    let result: RecognizerIsolationExecutionResult;
    try {
      result = await executeWithHostWatchdog(supervisor, execution);
    } catch {
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    }
    if (
      !validateIsolationAttestation(result.attestation, supervisor, execution) ||
      result.exitCode !== 0 ||
      result.terminationReason !== 'completed' ||
      !validTerminationEvidence(result.terminationEvidence, execution, result.terminationReason) ||
      result.stderrBytes > tutorialMediaRecognizerLimits.stderrBytes ||
      result.stdout.byteLength > tutorialMediaRecognizerLimits.stdoutBytes ||
      result.processTreeCpuTimeMs > tutorialMediaRecognizerLimits.processTreeCpuTimeMs ||
      result.peakProcessTreeRssBytes > tutorialMediaRecognizerLimits.processTreeRssBytes
    )
      throw new TutorialMediaUiRecognizerError('recognition_failed');
    return {
      ...validateOutput(decodeRecognizerOutput(result.stdout), frameTimestamps),
      isolationAttestation: result.attestation,
    };
  } finally {
    await rm(snapshotDirectory, { recursive: true, force: true });
  }
}
