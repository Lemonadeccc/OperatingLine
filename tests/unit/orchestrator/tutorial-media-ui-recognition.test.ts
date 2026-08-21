import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProcedureTutorialMediaRecognitionArtifactIntegrity } from '@operatingline/protocol';
import {
  isolationPolicySha256,
  recognitionSha256,
  tutorialMediaRecognizerIsolationPolicy,
  type RecognizerIsolationAttestation,
  type RecognizerIsolationExecution,
  type RecognizerIsolationSupervisor,
} from '../../../services/orchestrator/src/tutorial-media-process-isolation.js';
import {
  runTutorialMediaUiRecognizer,
  type RecognizerIsolationSupervisorDescriptor,
} from '../../../services/orchestrator/src/tutorial-media-ui-recognizer-process.js';
import {
  recognizeTutorialMediaUi,
  tutorialMediaRecognitionStageContract,
} from '../../../services/orchestrator/src/tutorial-media-ui-recognition.js';

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const capabilities = {
  networkPolicy: 'deny_all' as const,
  filesystemPolicy: 'snapshot_allowlist' as const,
  deniesFilesystemOutsideSnapshotAllowlist: true as const,
  deniesDeviceAccess: true as const,
  deniesIpc: true as const,
  deniesDns: true as const,
  deniesTcp: true as const,
  deniesUdp: true as const,
  deniesIpv4: true as const,
  deniesIpv6: true as const,
  deniesLocalNetwork: true as const,
  containsCompleteDescendantTree: true as const,
  enforcesWallTimeLimit: true as const,
  killsProcessTreeOnTermination: true as const,
  supportsHostAbort: true as const,
  enforcesProcessTreeCpuLimit: true as const,
  enforcesProcessTreeRssLimit: true as const,
  enforcesStdoutLimit: true as const,
  enforcesStderrLimit: true as const,
};

function framed(value: unknown): Uint8Array {
  const body = Buffer.from(JSON.stringify(value));
  const result = Buffer.alloc(4 + body.length);
  result.writeUInt32BE(body.length);
  body.copy(result, 4);
  return result;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operatingline-recognizer-'));
  temporaryDirectories.push(directory);
  const files = Object.fromEntries(
    await Promise.all(
      ['executable', 'model', 'license', 'config', 'frame'].map(async (name) => {
        const path = join(directory, name);
        await writeFile(path, name);
        return [name, path];
      }),
    ),
  ) as Record<string, string>;
  const descriptor: RecognizerIsolationSupervisorDescriptor = {
    formatVersion: '1.0.0',
    adapterId: 'fake',
    adapterVersion: '1',
    modelId: 'fake-model',
    modelVersion: '1',
    licenseId: 'Apache-2.0',
    executablePath: files.executable!,
    executableSha256: sha('executable'),
    modelPath: files.model!,
    modelSha256: sha('model'),
    licensePath: files.license!,
    licenseSha256: sha('license'),
    configPath: files.config!,
    configSha256: sha('config'),
    versionOutputSha256: sha('v1'),
    workingDirectory: directory,
    arguments: [],
    locale: 'en-US',
    platform: 'test',
    isolationPolicy: tutorialMediaRecognizerIsolationPolicy,
  };
  const frames = [
    {
      frameId: 'frame',
      framePath: files.frame!,
      frameSha256: sha('frame'),
      ocrArtifactSha256: sha('ocr-artifact'),
      ocrCandidatesSha256: sha('ocr-candidates'),
      timestampMs: 1_000,
    },
  ];
  return { descriptor, frames };
}

function attestation(execution: RecognizerIsolationExecution): RecognizerIsolationAttestation {
  const content = {
    formatVersion: '1.0.0' as const,
    backendId: 'fake-isolator',
    backendVersion: '1',
    backendVersionSha256: sha('backend'),
    supervisorSha256: sha('supervisor'),
    policy: tutorialMediaRecognizerIsolationPolicy,
    policySha256: isolationPolicySha256(),
    capabilities,
    invocationNonce: execution.invocationNonce,
    executableSha256: execution.expectedHashes.executableSha256,
    modelSha256: execution.expectedHashes.modelSha256,
    configSha256: execution.expectedHashes.configSha256,
    licenseSha256: execution.expectedHashes.licenseSha256,
    orderedFrameManifestSha256: execution.expectedHashes.orderedFrameManifestSha256,
    snapshotAllowlistSha256: execution.expectedHashes.snapshotAllowlistSha256,
  };
  return {
    ...content,
    attestationSha256: recognitionSha256(content),
    signature: {
      signerId: 'operator',
      keyId: 'test',
      algorithm: 'test-only',
      value: `signed:${recognitionSha256(content)}`,
    },
  };
}

function supervisor(output: Uint8Array): RecognizerIsolationSupervisor {
  return {
    backendId: 'fake-isolator',
    backendVersion: '1',
    backendVersionSha256: sha('backend'),
    supervisorSha256: sha('supervisor'),
    capabilities,
    verifyAttestationSignature({ attestationSha256, signature }) {
      return (
        signature.signerId === 'operator' &&
        signature.keyId === 'test' &&
        signature.algorithm === 'test-only' &&
        signature.value === `signed:${attestationSha256}`
      );
    },
    async terminate(invocationNonce, reason) {
      return {
        invocationNonce,
        reason,
        processTreeTerminated: true,
        observedAt: new Date().toISOString(),
      };
    },
    async execute(execution) {
      return {
        exitCode: 0,
        terminationReason: 'completed',
        stdout: output,
        stderrBytes: 0,
        processTreeCpuTimeMs: 1,
        peakProcessTreeRssBytes: 1,
        terminationEvidence: {
          invocationNonce: execution.invocationNonce,
          reason: 'completed',
          processTreeTerminated: true,
          observedAt: new Date().toISOString(),
        },
        attestation: attestation(execution),
      };
    },
  };
}

const output = {
  formatVersion: '1.0.0',
  uiCandidates: [
    {
      candidateId: 'ui',
      kind: 'menu',
      frameId: 'frame',
      timestampMs: 1_000,
      label: 'File',
      normalizedLabel: 'file',
      menuId: 'file',
      controlId: null,
      bounds: { x: 0, y: 0, width: 0.25, height: 0.25 },
      confidence: 1,
    },
  ],
  keyCandidates: [
    {
      candidateId: 'key',
      kind: 'key_chord',
      frameId: 'frame',
      timestampMs: 1_000,
      label: 'Ctrl S',
      normalizedKeys: ['Ctrl', 'S'],
      confidence: 1,
    },
  ],
};

describe('tutorial media UI recognition contract', () => {
  it('is a separate OCR-to-segmentation stage and emits a deterministic content-addressed artifact', async () => {
    const input = await fixture();
    const artifact = await recognizeTutorialMediaUi({
      ...input,
      supervisor: supervisor(framed(output)),
    });
    expect(tutorialMediaRecognitionStageContract).toMatchObject({
      predecessor: 'ocr',
      stage: 'recognition',
      successor: 'segmentation',
      artifactKind: 'ui_recognition_observations',
    });
    await expect(
      validateProcedureTutorialMediaRecognitionArtifactIntegrity(artifact),
    ).resolves.toEqual(artifact);
    expect(artifact.input.frames[0]).toMatchObject({
      frameSha256: sha('frame'),
      ocrArtifactSha256: sha('ocr-artifact'),
      ocrCandidatesSha256: sha('ocr-candidates'),
    });
    expect(artifact.provenance).toMatchObject({
      modelSha256: sha('model'),
      licenseSha256: sha('license'),
      configSha256: sha('config'),
      isolationBackendId: 'fake-isolator',
      isolationPolicySha256: isolationPolicySha256(),
    });
  });

  it('does not invoke an unsupported isolation backend and rejects snapshot hash drift', async () => {
    const input = await fixture();
    const execute = vi.fn();
    await expect(
      runTutorialMediaUiRecognizer({
        ...input,
        supervisor: { ...supervisor(framed(output)), capabilities: null, execute },
      }),
    ).rejects.toMatchObject({ code: 'recognizer_unavailable' });
    expect(execute).not.toHaveBeenCalled();
    await writeFile(input.descriptor.modelPath, 'drift');
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: supervisor(framed(output)) }),
    ).rejects.toMatchObject({ code: 'recognizer_unavailable' });
  });

  it('executes only private snapshots and is immune to pathname swaps after copying', async () => {
    const input = await fixture();
    input.descriptor.arguments = [
      input.descriptor.modelPath,
      input.descriptor.licensePath,
      input.descriptor.configPath,
      input.frames[0]!.framePath,
    ];
    let snapshotPaths: string[] = [];
    const isolated = supervisor(framed(output));
    isolated.execute = async (execution) => {
      snapshotPaths = [
        execution.executablePath,
        execution.modelPath,
        execution.licensePath,
        execution.configPath,
        ...execution.confinedFramePaths,
      ];
      expect(snapshotPaths.every((path) => path.startsWith(execution.workingDirectory))).toBe(true);
      expect(execution.arguments).toEqual([
        execution.modelPath,
        execution.licensePath,
        execution.configPath,
        execution.confinedFramePaths[0],
      ]);
      expect(execution.confinedReadPaths).toEqual(snapshotPaths);
      await rename(input.descriptor.modelPath, `${input.descriptor.modelPath}.replaced`);
      await writeFile(input.descriptor.modelPath, 'attacker-model');
      expect(await readFile(execution.modelPath, 'utf8')).toBe('model');
      return {
        exitCode: 0,
        terminationReason: 'completed',
        stdout: framed(output),
        stderrBytes: 0,
        processTreeCpuTimeMs: 1,
        peakProcessTreeRssBytes: 1,
        terminationEvidence: {
          invocationNonce: execution.invocationNonce,
          reason: 'completed',
          processTreeTerminated: true,
          observedAt: new Date().toISOString(),
        },
        attestation: attestation(execution),
      };
    };

    await expect(runTutorialMediaUiRecognizer({ ...input, supervisor: isolated })).resolves.toEqual(
      expect.objectContaining({ formatVersion: '1.0.0' }),
    );
    await expect(Promise.all(snapshotPaths.map((path) => lstat(path)))).rejects.toThrow();
  });

  it('rejects symlinked recognizer inputs before invoking the supervisor', async () => {
    const input = await fixture();
    const link = `${input.descriptor.modelPath}-link`;
    await symlink(input.descriptor.modelPath, link);
    input.descriptor.modelPath = link;
    const isolated = supervisor(framed(output));
    isolated.execute = vi.fn(isolated.execute);
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: isolated }),
    ).rejects.toMatchObject({ code: 'recognizer_unavailable' });
    expect(isolated.execute).not.toHaveBeenCalled();
  });

  it('rejects unmapped absolute descriptor arguments and incomplete confinement capabilities', async () => {
    const input = await fixture();
    input.descriptor.arguments = [join(input.descriptor.workingDirectory, 'host-secret')];
    const isolated = supervisor(framed(output));
    isolated.execute = vi.fn(isolated.execute);
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: isolated }),
    ).rejects.toMatchObject({ code: 'recognizer_unavailable' });
    expect(isolated.execute).not.toHaveBeenCalled();

    const missingDenial = supervisor(framed(output));
    missingDenial.capabilities = {
      ...capabilities,
      deniesIpc: false,
    } as unknown as typeof capabilities;
    await expect(
      runTutorialMediaUiRecognizer({ ...(await fixture()), supervisor: missingDenial }),
    ).rejects.toMatchObject({ code: 'recognizer_unavailable' });
  });

  it('uses a host watchdog to terminate a never-resolving supervisor execution', async () => {
    const input = await fixture();
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const didStart = new Promise<void>((resolve) => {
        started = resolve;
      });
      const terminate = vi.fn(async (invocationNonce: string, reason: 'wall_time_limit') => ({
        invocationNonce,
        reason,
        processTreeTerminated: true as const,
        observedAt: new Date().toISOString(),
      }));
      const isolated = supervisor(framed(output));
      isolated.terminate = terminate;
      isolated.execute = () => {
        started();
        return new Promise(() => undefined);
      };
      const pending = runTutorialMediaUiRecognizer({ ...input, supervisor: isolated });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'recognition_failed' });
      await didStart;
      await vi.advanceTimersByTimeAsync(180_000);
      await rejected;
      expect(terminate).toHaveBeenCalledWith(expect.any(String), 'wall_time_limit');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails within the kill deadline when termination never acknowledges', async () => {
    const input = await fixture();
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const didStart = new Promise<void>((resolve) => {
        started = resolve;
      });
      const isolated = supervisor(framed(output));
      isolated.execute = () => {
        started();
        return new Promise(() => undefined);
      };
      isolated.terminate = () => new Promise(() => undefined);
      const pending = runTutorialMediaUiRecognizer({ ...input, supervisor: isolated });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'recognition_failed' });
      await didStart;
      await vi.advanceTimersByTimeAsync(185_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a completed result that arrives after the wall-time boundary fires', async () => {
    const input = await fixture();
    vi.useFakeTimers();
    try {
      let completeExecution!: (
        result: Awaited<ReturnType<RecognizerIsolationSupervisor['execute']>>,
      ) => void;
      let acknowledgeTermination!: (
        evidence: Awaited<ReturnType<RecognizerIsolationSupervisor['terminate']>>,
      ) => void;
      let capturedExecution: RecognizerIsolationExecution | undefined;
      let started!: () => void;
      const didStart = new Promise<void>((resolve) => {
        started = resolve;
      });
      const isolated = supervisor(framed(output));
      isolated.execute = (execution) =>
        new Promise((resolve) => {
          capturedExecution = execution;
          completeExecution = resolve;
          started();
        });
      isolated.terminate = (invocationNonce, reason) =>
        new Promise((resolve) => {
          acknowledgeTermination = resolve;
          void invocationNonce;
          void reason;
        });

      const pending = runTutorialMediaUiRecognizer({ ...input, supervisor: isolated });
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const rejected = expect(pending).rejects.toMatchObject({ code: 'recognition_failed' });
      await didStart;
      await vi.advanceTimersByTimeAsync(180_000);

      expect(capturedExecution).toBeDefined();
      const execution = capturedExecution!;
      completeExecution({
        exitCode: 0,
        terminationReason: 'completed',
        stdout: framed(output),
        stderrBytes: 0,
        processTreeCpuTimeMs: 1,
        peakProcessTreeRssBytes: 1,
        terminationEvidence: {
          invocationNonce: execution.invocationNonce,
          reason: 'completed',
          processTreeTerminated: true,
          observedAt: new Date().toISOString(),
        },
        attestation: attestation(execution),
      });
      await vi.advanceTimersByTimeAsync(0);

      // The outer call must remain pending until the kill acknowledgement, but the late success
      // is already irrevocably rejected.
      expect(settled).toBe(false);
      acknowledgeTermination({
        invocationNonce: execution.invocationNonce,
        reason: 'wall_time_limit',
        processTreeTerminated: true,
        observedAt: new Date().toISOString(),
      });
      await rejected;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates host abort by terminating the complete recognizer process tree', async () => {
    const input = await fixture();
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const terminate = vi.fn(async (invocationNonce: string, reason: 'host_abort') => ({
      invocationNonce,
      reason,
      processTreeTerminated: true as const,
      observedAt: new Date().toISOString(),
    }));
    const isolated = supervisor(framed(output));
    isolated.terminate = terminate;
    isolated.execute = () => {
      started();
      return new Promise(() => undefined);
    };
    const controller = new AbortController();
    const pending = runTutorialMediaUiRecognizer({
      ...input,
      supervisor: isolated,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'recognition_failed' });
    await didStart;
    controller.abort();
    await rejected;
    expect(terminate).toHaveBeenCalledWith(expect.any(String), 'host_abort');
  });

  it('rejects attestations that do not bind the license and ordered frame manifest', async () => {
    const input = await fixture();
    for (const field of ['licenseSha256', 'orderedFrameManifestSha256'] as const) {
      const isolated = supervisor(framed(output));
      isolated.execute = async (execution) => {
        const forged = { ...attestation(execution), [field]: sha(`wrong-${field}`) };
        const content: Record<string, unknown> = { ...forged };
        delete content.attestationSha256;
        delete content.signature;
        const attestationSha256 = recognitionSha256(content);
        return {
          exitCode: 0,
          terminationReason: 'completed',
          stdout: framed(output),
          stderrBytes: 0,
          processTreeCpuTimeMs: 1,
          peakProcessTreeRssBytes: 1,
          terminationEvidence: {
            invocationNonce: execution.invocationNonce,
            reason: 'completed',
            processTreeTerminated: true,
            observedAt: new Date().toISOString(),
          },
          attestation: {
            ...content,
            attestationSha256,
            signature: {
              signerId: 'operator',
              keyId: 'test',
              algorithm: 'test-only',
              value: `signed:${attestationSha256}`,
            },
          } as unknown as RecognizerIsolationAttestation,
        };
      };
      await expect(
        runTutorialMediaUiRecognizer({ ...input, supervisor: isolated }),
      ).rejects.toMatchObject({ code: 'recognition_failed' });
    }
  });

  it('rejects hostile recognition artifacts even when their content hash is recomputed', async () => {
    const input = await fixture();
    const artifact = await recognizeTutorialMediaUi({
      ...input,
      supervisor: supervisor(framed(output)),
    });
    const rehash = (value: Record<string, unknown>) => {
      const content = { ...value };
      delete content.contentSha256;
      return { ...content, contentSha256: recognitionSha256(content) };
    };
    type MutableArtifact = {
      extra?: boolean;
      observations: {
        uiCandidates: Array<{
          candidateId: string;
          frameId: string;
          bounds: { x: number };
        }>;
        keyCandidates: Array<{ candidateId: string; confidence: number }>;
      };
    };
    const mutations: Array<(value: MutableArtifact) => void> = [
      (value) => {
        value.extra = true;
      },
      (value) => {
        value.observations.keyCandidates[0].candidateId = 'ui';
      },
      (value) => {
        value.observations.uiCandidates[0].frameId = 'missing';
      },
      (value) => {
        value.observations.uiCandidates[0].bounds.x = Number.NaN;
      },
      (value) => {
        value.observations.keyCandidates[0].confidence = Number.POSITIVE_INFINITY;
      },
    ];
    for (const mutate of mutations) {
      const hostile = structuredClone(artifact) as unknown as Record<string, unknown>;
      mutate(hostile as unknown as MutableArtifact);
      await expect(
        validateProcedureTutorialMediaRecognitionArtifactIntegrity(rehash(hostile)),
      ).rejects.toThrow('The UI recognition artifact is invalid.');
    }
  });

  it('rejects forged artifact hashes and hostile recognizer frame identity semantics', async () => {
    const input = await fixture();
    const artifact = await recognizeTutorialMediaUi({
      ...input,
      supervisor: supervisor(framed(output)),
    });
    await expect(
      validateProcedureTutorialMediaRecognitionArtifactIntegrity({
        ...artifact,
        contentSha256: 'f'.repeat(64),
      }),
    ).rejects.toThrow('The UI recognition artifact is invalid.');

    for (const hostileOutput of [
      { ...output, uiCandidates: [{ ...output.uiCandidates[0]!, frameId: 1 }] },
      { ...output, uiCandidates: [{ ...output.uiCandidates[0]!, timestampMs: 999 }] },
      { ...output, uiCandidates: [{ ...output.uiCandidates[0]!, candidateId: 'é'.repeat(129) }] },
    ]) {
      await expect(
        runTutorialMediaUiRecognizer({
          ...input,
          supervisor: supervisor(framed(hostileOutput)),
        }),
      ).rejects.toMatchObject({ code: 'recognition_failed' });
    }
  });

  it.each([
    ['forged signature', { value: 'forged' }],
    ['wrong key', { keyId: 'untrusted' }],
    ['wrong signer', { signerId: 'attacker' }],
  ])('rejects an otherwise valid attestation with a %s', async (_name, signatureOverride) => {
    const input = await fixture();
    const hostile = supervisor(framed(output));
    hostile.execute = async (execution) => {
      const valid = attestation(execution);
      return {
        exitCode: 0,
        terminationReason: 'completed',
        stdout: framed(output),
        stderrBytes: 0,
        processTreeCpuTimeMs: 1,
        peakProcessTreeRssBytes: 1,
        terminationEvidence: {
          invocationNonce: execution.invocationNonce,
          reason: 'completed',
          processTreeTerminated: true,
          observedAt: new Date().toISOString(),
        },
        attestation: {
          ...valid,
          signature: { ...valid.signature, ...signatureOverride },
        },
      };
    };

    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: hostile }),
    ).rejects.toMatchObject({ code: 'recognition_failed' });
  });

  it('rejects malformed, extra, oversized-label, and resource-limit output without OCR fallback', async () => {
    const input = await fixture();
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: supervisor(Buffer.from('{}')) }),
    ).rejects.toMatchObject({ code: 'recognition_failed' });
    await expect(
      runTutorialMediaUiRecognizer({
        ...input,
        supervisor: supervisor(Buffer.concat([framed(output), Buffer.from('extra')])),
      }),
    ).rejects.toMatchObject({ code: 'recognition_failed' });
    const longLabel = {
      ...output,
      uiCandidates: [{ ...output.uiCandidates[0]!, label: 'x'.repeat(257) }],
    };
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: supervisor(framed(longLabel)) }),
    ).rejects.toMatchObject({ code: 'recognition_failed' });
    const limited = supervisor(framed(output));
    limited.execute = async (execution) => ({
      exitCode: 1,
      terminationReason: 'cpu_limit',
      stdout: new Uint8Array(),
      stderrBytes: 0,
      processTreeCpuTimeMs: 120_001,
      peakProcessTreeRssBytes: 1,
      terminationEvidence: {
        invocationNonce: execution.invocationNonce,
        reason: 'cpu_limit',
        processTreeTerminated: true,
        observedAt: new Date().toISOString(),
      },
      attestation: attestation(execution),
    });
    await expect(
      runTutorialMediaUiRecognizer({ ...input, supervisor: limited }),
    ).rejects.toMatchObject({ code: 'recognition_failed' });

    for (const terminationReason of [
      'isolation_violation',
      'rss_limit',
      'stdout_limit',
      'stderr_limit',
    ] as const) {
      const hostile = supervisor(framed(output));
      hostile.execute = async (execution) => ({
        exitCode: 1,
        terminationReason,
        stdout: new Uint8Array(),
        stderrBytes: 0,
        processTreeCpuTimeMs: 1,
        peakProcessTreeRssBytes: 1,
        terminationEvidence: {
          invocationNonce: execution.invocationNonce,
          reason: terminationReason,
          processTreeTerminated: true,
          observedAt: new Date().toISOString(),
        },
        attestation: attestation(execution),
      });
      await expect(
        runTutorialMediaUiRecognizer({ ...input, supervisor: hostile }),
      ).rejects.toMatchObject({ code: 'recognition_failed' });
    }
  });
});
