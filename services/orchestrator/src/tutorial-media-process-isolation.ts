import { createHash } from 'node:crypto';

export const tutorialMediaRecognizerIsolationPolicy =
  'tutorial-media-recognizer-isolation-v1' as const;

export const tutorialMediaRecognizerLimits = Object.freeze({
  maximumFrames: 64,
  wallTimeMs: 180_000,
  processTreeCpuTimeMs: 120_000,
  processTreeRssBytes: 2 * 1_024 * 1_024 * 1_024,
  stdoutBytes: 16 * 1_024 * 1_024,
  stderrBytes: 1 * 1_024 * 1_024,
  maximumCandidates: 4_096,
  maximumLabelBytes: 256,
  terminationAcknowledgementMs: 5_000,
});

export interface RecognizerIsolationCapabilities {
  readonly networkPolicy: 'deny_all';
  readonly filesystemPolicy: 'snapshot_allowlist';
  readonly deniesFilesystemOutsideSnapshotAllowlist: true;
  readonly deniesDeviceAccess: true;
  readonly deniesIpc: true;
  readonly deniesDns: true;
  readonly deniesTcp: true;
  readonly deniesUdp: true;
  readonly deniesIpv4: true;
  readonly deniesIpv6: true;
  readonly deniesLocalNetwork: true;
  readonly containsCompleteDescendantTree: true;
  readonly enforcesWallTimeLimit: true;
  readonly killsProcessTreeOnTermination: true;
  readonly supportsHostAbort: true;
  readonly enforcesProcessTreeCpuLimit: true;
  readonly enforcesProcessTreeRssLimit: true;
  readonly enforcesStdoutLimit: true;
  readonly enforcesStderrLimit: true;
}

export interface RecognizerIsolationAttestationContent {
  readonly formatVersion: '1.0.0';
  readonly backendId: string;
  readonly backendVersion: string;
  readonly backendVersionSha256: string;
  readonly supervisorSha256: string;
  readonly policy: typeof tutorialMediaRecognizerIsolationPolicy;
  readonly policySha256: string;
  readonly capabilities: RecognizerIsolationCapabilities;
  readonly invocationNonce: string;
  readonly executableSha256: string;
  readonly modelSha256: string;
  readonly configSha256: string;
  readonly licenseSha256: string;
  readonly orderedFrameManifestSha256: string;
  readonly snapshotAllowlistSha256: string;
}

export interface RecognizerIsolationAttestation extends RecognizerIsolationAttestationContent {
  readonly attestationSha256: string;
  readonly signature: {
    readonly signerId: string;
    readonly keyId: string;
    readonly algorithm: string;
    readonly value: string;
  };
}

export interface RecognizerIsolationAttestationSignatureVerification {
  readonly content: RecognizerIsolationAttestationContent;
  readonly attestationSha256: string;
  readonly signature: RecognizerIsolationAttestation['signature'];
}

export interface RecognizerIsolationExecution {
  readonly executablePath: string;
  readonly modelPath: string;
  readonly licensePath: string;
  readonly configPath: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly stdin: Uint8Array;
  readonly confinedFramePaths: readonly string[];
  readonly confinedReadPaths: readonly string[];
  readonly limits: typeof tutorialMediaRecognizerLimits;
  readonly policy: typeof tutorialMediaRecognizerIsolationPolicy;
  readonly invocationNonce: string;
  readonly expectedHashes: {
    readonly executableSha256: string;
    readonly modelSha256: string;
    readonly configSha256: string;
    readonly licenseSha256: string;
    readonly orderedFrameManifestSha256: string;
    readonly snapshotAllowlistSha256: string;
  };
  readonly signal?: AbortSignal;
}

export interface RecognizerIsolationExecutionResult {
  readonly exitCode: number;
  readonly terminationReason:
    | 'completed'
    | 'wall_time_limit'
    | 'cpu_limit'
    | 'rss_limit'
    | 'stdout_limit'
    | 'stderr_limit'
    | 'isolation_violation'
    | 'process_failed';
  readonly stdout: Uint8Array;
  readonly stderrBytes: number;
  readonly processTreeCpuTimeMs: number;
  readonly peakProcessTreeRssBytes: number;
  readonly terminationEvidence: RecognizerIsolationTerminationEvidence;
  readonly attestation: RecognizerIsolationAttestation;
}

export interface RecognizerIsolationTerminationEvidence {
  readonly invocationNonce: string;
  readonly reason: RecognizerIsolationExecutionResult['terminationReason'] | 'host_abort';
  readonly processTreeTerminated: true;
  readonly observedAt: string;
}

export interface RecognizerIsolationSupervisor {
  readonly backendId: string;
  readonly backendVersion: string;
  readonly backendVersionSha256: string;
  readonly supervisorSha256: string;
  readonly capabilities: RecognizerIsolationCapabilities | null;
  verifyAttestationSignature(
    verification: RecognizerIsolationAttestationSignatureVerification,
  ): boolean;
  execute(execution: RecognizerIsolationExecution): Promise<RecognizerIsolationExecutionResult>;
  terminate(
    invocationNonce: string,
    reason: 'wall_time_limit' | 'host_abort',
  ): Promise<RecognizerIsolationTerminationEvidence>;
}

export function canonicalRecognitionJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecognitionJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalRecognitionJson(entry)}`)
    .join(',')}}`;
}

export function recognitionSha256(value: unknown): string {
  return createHash('sha256').update(canonicalRecognitionJson(value)).digest('hex');
}

export function isolationPolicySha256(): string {
  return createHash('sha256').update(tutorialMediaRecognizerIsolationPolicy).digest('hex');
}

export function hasRequiredRecognizerIsolation(
  capabilities: RecognizerIsolationCapabilities | null,
): capabilities is RecognizerIsolationCapabilities {
  return (
    capabilities !== null &&
    capabilities.networkPolicy === 'deny_all' &&
    capabilities.filesystemPolicy === 'snapshot_allowlist' &&
    capabilities.deniesFilesystemOutsideSnapshotAllowlist === true &&
    capabilities.deniesDeviceAccess === true &&
    capabilities.deniesIpc === true &&
    capabilities.deniesDns === true &&
    capabilities.deniesTcp === true &&
    capabilities.deniesUdp === true &&
    capabilities.deniesIpv4 === true &&
    capabilities.deniesIpv6 === true &&
    capabilities.deniesLocalNetwork === true &&
    capabilities.containsCompleteDescendantTree === true &&
    capabilities.enforcesWallTimeLimit === true &&
    capabilities.killsProcessTreeOnTermination === true &&
    capabilities.supportsHostAbort === true &&
    capabilities.enforcesProcessTreeCpuLimit === true &&
    capabilities.enforcesProcessTreeRssLimit === true &&
    capabilities.enforcesStdoutLimit === true &&
    capabilities.enforcesStderrLimit === true
  );
}

export function validateIsolationAttestation(
  attestation: RecognizerIsolationAttestation,
  supervisor: RecognizerIsolationSupervisor,
  expected: RecognizerIsolationExecution,
): boolean {
  const { attestationSha256, signature, ...content } = attestation;
  const contentIsValid =
    attestationSha256 === recognitionSha256(content) &&
    attestation.backendId === supervisor.backendId &&
    attestation.backendVersion === supervisor.backendVersion &&
    attestation.backendVersionSha256 === supervisor.backendVersionSha256 &&
    attestation.supervisorSha256 === supervisor.supervisorSha256 &&
    attestation.policy === expected.policy &&
    attestation.policySha256 === isolationPolicySha256() &&
    attestation.invocationNonce === expected.invocationNonce &&
    attestation.executableSha256 === expected.expectedHashes.executableSha256 &&
    attestation.modelSha256 === expected.expectedHashes.modelSha256 &&
    attestation.configSha256 === expected.expectedHashes.configSha256 &&
    attestation.licenseSha256 === expected.expectedHashes.licenseSha256 &&
    attestation.orderedFrameManifestSha256 === expected.expectedHashes.orderedFrameManifestSha256 &&
    attestation.snapshotAllowlistSha256 === expected.expectedHashes.snapshotAllowlistSha256 &&
    hasRequiredRecognizerIsolation(attestation.capabilities);
  if (!contentIsValid) return false;
  try {
    return supervisor.verifyAttestationSignature({
      content,
      attestationSha256,
      signature,
    });
  } catch {
    return false;
  }
}
