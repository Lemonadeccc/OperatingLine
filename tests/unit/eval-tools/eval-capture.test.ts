import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  contentWithoutIntegrity,
  HumanEvalDatasetBusyError,
  HumanEvalDatasetError,
  loadHumanEvalDatasetDirectory,
  sealHumanEvalSuite,
  validateHumanEvalDataset,
} from '@operatingline/eval-kit';
import type {
  CurrentEvalExportBundle,
  EvalExecutionEvent,
  ProviderEvalRun,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { captureProviderEvalRun, type EvalCaptureManifestV1 } from '../../../tools/eval/capture.js';
import {
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

function events(source: ProviderEvalRun): EvalExecutionEvent[] {
  if (source.invocation.operation !== 'initial_plan' || source.outcome.status !== 'completed') {
    throw new Error('Expected completed initial plan fixture');
  }
  const request = source.invocation.request;
  const requestFingerprint = computeHumanEvalContentSha256(request);
  return [
    {
      sequence: 1,
      id: 'capture.prompt',
      eventType: 'planning.prompt.generated',
      payload: {
        request: {
          targetAdapterId: request.targetAdapterId,
          catalogVersion: request.catalogVersion,
          goal: request.goal,
          planId: request.planId,
        },
        packet: source.invocation.packet,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 2,
      id: 'capture.requested',
      eventType: 'planning.provider.generation.requested',
      payload: {
        requestId: request.requestId,
        requestFingerprint,
        providerId: source.profile.descriptor.id,
        providerVersion: source.profile.descriptor.version,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        packetFormatVersion: source.invocation.packet.formatVersion,
        occurredAt: source.timing.startedAt,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 3,
      id: 'capture.completed',
      eventType: 'planning.provider.generation.completed',
      payload: {
        request,
        requestFingerprint,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        result: source.outcome.result,
      },
      createdAt: source.timing.completedAt,
    },
  ];
}

function bundle(
  source: ProviderEvalRun,
  capturedEvents: readonly EvalExecutionEvent[],
): CurrentEvalExportBundle {
  if (source.invocation.operation !== 'initial_plan') throw new Error('Expected initial fixture');
  const hostPayload = capturedEvents.find(
    (event) => event.eventType === 'companion.state.reported',
  )?.payload;
  const instanceId =
    hostPayload !== null &&
    typeof hostPayload === 'object' &&
    !Array.isArray(hostPayload) &&
    typeof (hostPayload as Record<string, unknown>)['instanceId'] === 'string'
      ? (hostPayload as Record<string, string>)['instanceId']!
      : null;
  const content = {
    protocolVersion: source.environment.protocolVersion,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: source.environment.targetAdapterId,
      planId: source.invocation.packet.context.requestedPlanId,
      instanceId,
    },
    catalogs: [source.invocation.packet.context.catalog],
    events: [...capturedEvents],
    page: {
      snapshotId: '42000000-0000-4000-8000-000000000001',
      snapshotUpperSequence: capturedEvents.at(-1)!.sequence,
      afterSequence: 0,
      nextAfterSequence: capturedEvents.at(-1)!.sequence,
      hasMore: false,
    },
    summary: {
      matchedEventCount: capturedEvents.length,
      eventTypeCounts: capturedEvents.reduce<Record<string, number>>((counts, event) => {
        counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
        return counts;
      }, {}),
      transitionCounts: capturedEvents.reduce<Record<string, number>>((counts, event) => {
        if (
          event.eventType === 'companion.state.reported' &&
          event.payload !== null &&
          typeof event.payload === 'object' &&
          !Array.isArray(event.payload)
        ) {
          const transition = (event.payload as Record<string, unknown>)['transition'];
          if (typeof transition === 'string') counts[transition] = (counts[transition] ?? 0) + 1;
        }
        return counts;
      }, {}),
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Local test capture.',
    },
  };
  return {
    ...content,
    exportId: '42000000-0000-4000-8000-000000000002',
    exportedAt: source.timing.completedAt,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

async function setupWorkspace(options: { readonly repoReference?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-capture-'));
  const datasetDirectory = join(root, 'dataset');
  const snapshotDirectory = join(root, 'snapshot');
  const inputDirectory = join(root, 'input');
  const repositoryRoot = join(root, 'repo');
  await Promise.all([
    mkdir(datasetDirectory),
    mkdir(snapshotDirectory),
    mkdir(inputDirectory),
    mkdir(repositoryRoot),
  ]);
  let suite = buildHumanEvalSuiteFixture();
  if (options.repoReference === true) {
    const referenceBytes = Buffer.from('{"reference":true}\n');
    await writeFile(join(repositoryRoot, 'reference.json'), referenceBytes);
    const suiteContent = contentWithoutIntegrity(suite);
    suite = sealHumanEvalSuite({
      ...suiteContent,
      cases: suite.cases.map((evalCase, index) =>
        index === 0
          ? {
              ...evalCase,
              references: [
                ...evalCase.references,
                {
                  artifactId: 'capture.reference',
                  kind: 'other' as const,
                  mediaType: 'application/json',
                  uri: 'repo://reference.json',
                  contentSha256: createHash('sha256').update(referenceBytes).digest('hex'),
                  metadata: {},
                },
              ],
            }
          : evalCase,
      ),
    });
  }
  const source = buildProviderEvalRunFixture(suite);
  const page = bundle(source, events(source));
  const snapshotManifest = {
    formatVersion: '1.0.0',
    scope: page.scope,
    snapshotId: page.page.snapshotId,
    snapshotUpperSequence: page.page.snapshotUpperSequence,
    pages: [
      {
        filename: 'page.json',
        exportId: page.exportId,
        contentSha256: page.integrity.contentSha256,
      },
    ],
    dataHandling: {
      containsPotentiallySensitiveContent: true,
      credentialsStored: false,
      warning: 'Local test snapshot.',
    },
  };
  await Promise.all([
    writeFile(join(datasetDirectory, 'suite.json'), JSON.stringify(suite)),
    writeFile(join(snapshotDirectory, 'page.json'), JSON.stringify(page)),
    writeFile(join(snapshotDirectory, 'snapshot.json'), JSON.stringify(snapshotManifest)),
  ]);
  const manifest: EvalCaptureManifestV1 = {
    formatVersion: '1.0.0',
    captureMode: 'provider_only',
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    caseId: suite.cases[0]!.id,
    generationRequestId: source.invocation.request.requestId,
    runId: '42000000-0000-4000-8000-000000000010',
    replicateIndex: 1,
    parentRunId: null,
    profile: source.profile,
    generationSettings: {
      normalizedParameters: source.generationSettings.normalizedParameters,
      seed: source.generationSettings.seed,
      determinism: source.generationSettings.determinism,
    },
    reproducibility: 'not_reproducible',
    treatmentAttestation: {
      evidenceClass: 'operator_attested_not_runtime_verified',
      assertion: 'profile_and_settings_reviewed_no_credentials',
      preparedBy: 'capture.preparer',
      reviewedAt: '2026-08-09T00:00:00.000Z',
    },
    provenance: {
      recorderName: 'offline-capture-cli-test',
      recorderVersion: source.provenance.recorderVersion,
      vendorRequestId: source.provenance.vendorRequestId,
    },
    environment: {
      operatingLineVersion: source.environment.operatingLineVersion,
      sourceCommit: source.environment.sourceCommit,
    },
  };
  const manifestPath = join(inputDirectory, 'capture.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return {
    root,
    datasetDirectory,
    snapshotDirectory,
    inputDirectory,
    repositoryRoot,
    manifestPath,
    manifest,
    suite,
    source,
    snapshotManifest,
  };
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

describe('offline Human Eval capture CLI', () => {
  it('captures provider-only evidence into content-addressed artifacts with fixed local handling', async () => {
    const workspace = await setupWorkspace();
    try {
      const run = await captureProviderEvalRun(workspace);
      expect(run.sourceEvents.every((event) => event.correlationKind === 'provider_request')).toBe(
        true,
      );
      expect(run.environment).toMatchObject({ adapterVersion: null, hostVersion: null });
      expect(run.dataHandling).toEqual(
        expect.objectContaining({
          permittedUses: ['local_eval'],
          publicRelease: 'not_reviewed',
          trainingUse: 'not_authorized',
        }),
      );
      expect(run.artifacts).toHaveLength(2);
      expect(run.artifacts[0]!.uri).toMatch(/^artifacts\/sha256\/[a-f0-9]{64}\.json$/);
      expect(run.artifacts.find((artifact) => artifact.kind === 'provider_output')).toMatchObject({
        metadata: { evidenceClass: 'operator_attested_not_runtime_verified' },
      });
      expect(run.comparability.reproducibility).toBe('not_reproducible');
      const releasedSuite = sealHumanEvalSuite({
        ...contentWithoutIntegrity(workspace.suite),
        status: 'released',
      });
      try {
        validateHumanEvalDataset({ suite: releasedSuite, runs: [run] });
        throw new Error('Expected operator-attested treatment to block released status');
      } catch (error) {
        expect(error).toBeInstanceOf(HumanEvalDatasetError);
        expect((error as HumanEvalDatasetError).issues).toContainEqual(
          expect.stringContaining('runtime-attested Provider profile'),
        );
      }
      await expect(
        readFile(join(workspace.datasetDirectory, run.artifacts[0]!.uri)),
      ).resolves.toBeInstanceOf(Buffer);
      await expect(
        readFile(join(workspace.datasetDirectory, 'runs', `${run.runId}.run.json`), 'utf8'),
      ).resolves.toContain(run.runId);
      if (process.platform !== 'win32') {
        expect((await stat(join(workspace.datasetDirectory, 'runs'))).mode & 0o777).toBe(0o700);
        expect(
          (await stat(join(workspace.datasetDirectory, run.artifacts[0]!.uri))).mode & 0o777,
        ).toBe(0o600);
      }
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects path escape and rolls back content-addressed files after late validation fails', async () => {
    const workspace = await setupWorkspace();
    try {
      await writeFile(
        join(workspace.snapshotDirectory, 'snapshot.json'),
        JSON.stringify({
          ...workspace.snapshotManifest,
          pages: [
            {
              ...workspace.snapshotManifest.pages[0],
              filename: '../input/capture.json',
            },
          ],
        }),
      );
      await expect(captureProviderEvalRun(workspace)).rejects.toThrow(
        /escapes its configured root/,
      );
      if (process.platform !== 'win32') {
        await symlink(
          join(workspace.inputDirectory, 'capture.json'),
          join(workspace.snapshotDirectory, 'linked-page.json'),
        );
        await writeFile(
          join(workspace.snapshotDirectory, 'snapshot.json'),
          JSON.stringify({
            ...workspace.snapshotManifest,
            pages: [
              {
                ...workspace.snapshotManifest.pages[0],
                filename: 'linked-page.json',
              },
            ],
          }),
        );
        await expect(captureProviderEvalRun(workspace)).rejects.toThrow(
          /resolves outside its configured root/,
        );
      }

      const fresh = await setupWorkspace();
      try {
        await writeFile(
          fresh.manifestPath,
          JSON.stringify({
            ...fresh.manifest,
            profile: {
              ...fresh.manifest.profile,
              descriptor: { ...fresh.manifest.profile.descriptor, displayName: '' },
            },
          }),
        );
        await expect(captureProviderEvalRun(fresh)).rejects.toThrow();
        await expect(directoryEntries(join(fresh.datasetDirectory, 'runs'))).resolves.toEqual([]);
        await expect(
          directoryEntries(join(fresh.datasetDirectory, 'artifacts', 'sha256')),
        ).resolves.toEqual([]);
      } finally {
        await rm(fresh.root, { recursive: true, force: true });
      }
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('never overwrites an existing run', async () => {
    const workspace = await setupWorkspace();
    try {
      await captureProviderEvalRun(workspace);
      await expect(captureProviderEvalRun(workspace)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(
        (
          await readFile(
            join(workspace.datasetDirectory, 'runs', `${workspace.manifest.runId}.run.json`),
            'utf8',
          )
        ).length,
      ).toBeGreaterThan(0);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects corrupt bytes pre-seeded at a content-addressed artifact path', async () => {
    const workspace = await setupWorkspace();
    try {
      const pageBytes = await readFile(join(workspace.snapshotDirectory, 'page.json'));
      const hash = createHash('sha256').update(pageBytes).digest('hex');
      const artifactDirectory = join(workspace.datasetDirectory, 'artifacts', 'sha256');
      await mkdir(artifactDirectory, { recursive: true });
      const corruptPath = join(artifactDirectory, `${hash}.json`);
      await writeFile(corruptPath, 'corrupt bytes');

      await expect(captureProviderEvalRun(workspace)).rejects.toThrow(
        /does not match its content address/,
      );
      await expect(readFile(corruptPath, 'utf8')).resolves.toBe('corrupt bytes');
      await expect(directoryEntries(join(workspace.datasetDirectory, 'runs'))).resolves.toEqual([]);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent captures into one coherent run without leaving a lock ticket', async () => {
    const workspace = await setupWorkspace();
    try {
      const results = await Promise.allSettled([
        captureProviderEvalRun(workspace),
        captureProviderEvalRun(workspace),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled.length).toBeLessThanOrEqual(1);
      for (const result of rejected) {
        expect(
          result.reason instanceof HumanEvalDatasetBusyError || result.reason.code === 'EEXIST',
        ).toBe(true);
      }
      if (fulfilled.length === 0) {
        expect(rejected.every((result) => result.reason instanceof HumanEvalDatasetBusyError)).toBe(
          true,
        );
        await captureProviderEvalRun(workspace);
      }
      expect(await directoryEntries(join(workspace.datasetDirectory, 'runs'))).toHaveLength(1);
      const dataset = await loadHumanEvalDatasetDirectory(workspace.datasetDirectory);
      expect(dataset.runs).toHaveLength(1);
      await expect(
        directoryEntries(join(workspace.datasetDirectory, '.human-eval-write.lock')),
      ).resolves.toEqual([]);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('uses the configured repository root for suite reference artifacts', async () => {
    const workspace = await setupWorkspace({ repoReference: true });
    try {
      await expect(captureProviderEvalRun(workspace)).resolves.toMatchObject({
        runId: workspace.manifest.runId,
      });
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('keeps manual project and PNG bytes visibly separate from an authorized host execution', async () => {
    const workspace = await setupWorkspace();
    try {
      if (workspace.source.outcome.status !== 'completed')
        throw new Error('Expected completed fixture');
      const captured = events(workspace.source);
      const plan = workspace.source.outcome.result.draft.plan;
      const planHash = computePlanContentSha256(plan);
      const executionId = '42000000-0000-4000-8000-000000000020';
      const instanceId = '42000000-0000-4000-8000-000000000021';
      const reportId = '42000000-0000-4000-8000-000000000022';
      const executableStepIds = plan.steps
        .filter((step) => step.action !== null)
        .map((step) => step.id);
      const finalStepId = executableStepIds.at(-1)!;
      captured.push(
        {
          sequence: 4,
          id: 'capture.published',
          eventType: 'guide.plan.published',
          payload: { plan },
          createdAt: '2026-08-05T00:00:01.500Z',
        },
        {
          sequence: 5,
          id: 'capture.host.running',
          eventType: 'companion.state.reported',
          payload: {
            protocolVersion: workspace.source.environment.protocolVersion,
            reportId: '42000000-0000-4000-8000-000000000023',
            sequence: 1,
            adapterId: workspace.source.environment.targetAdapterId,
            instanceId,
            companionVersion: workspace.source.environment.adapterVersion,
            hostVersion: workspace.source.environment.hostVersion,
            plan: { id: plan.id, revision: plan.revision },
            planContentSha256: planHash,
            executionId,
            phase: 'running',
            activeStepId: executableStepIds[0]!,
            completedStepIds: [executableStepIds[0]!],
            transition: 'step_succeeded',
            stepId: executableStepIds[0]!,
            observations: [],
            error: null,
            occurredAt: '2026-08-05T00:00:01.750Z',
          },
          createdAt: '2026-08-05T00:00:01.750Z',
        },
        {
          sequence: 6,
          id: 'capture.host.completed',
          eventType: 'companion.state.reported',
          payload: {
            protocolVersion: workspace.source.environment.protocolVersion,
            reportId,
            sequence: 2,
            adapterId: workspace.source.environment.targetAdapterId,
            instanceId,
            companionVersion: workspace.source.environment.adapterVersion,
            hostVersion: workspace.source.environment.hostVersion,
            plan: { id: plan.id, revision: plan.revision },
            planContentSha256: planHash,
            executionId,
            phase: 'completed',
            activeStepId: finalStepId,
            completedStepIds: executableStepIds,
            transition: 'step_succeeded',
            stepId: finalStepId,
            observations: [],
            error: null,
            occurredAt: '2026-08-05T00:00:02.000Z',
          },
          createdAt: '2026-08-05T00:00:02.000Z',
        },
      );
      const page = bundle(workspace.source, captured);
      await Promise.all([
        writeFile(join(workspace.snapshotDirectory, 'page.json'), JSON.stringify(page)),
        writeFile(
          join(workspace.snapshotDirectory, 'snapshot.json'),
          JSON.stringify({
            ...workspace.snapshotManifest,
            scope: page.scope,
            snapshotId: page.page.snapshotId,
            snapshotUpperSequence: page.page.snapshotUpperSequence,
            pages: [
              {
                filename: 'page.json',
                exportId: page.exportId,
                contentSha256: page.integrity.contentSha256,
              },
            ],
          }),
        ),
      ]);
      const onePixelPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      await Promise.all([
        writeFile(join(workspace.inputDirectory, 'project.bin'), 'exact project bytes'),
        writeFile(join(workspace.inputDirectory, 'render.png'), onePixelPng),
      ]);
      const manifest: EvalCaptureManifestV1 = {
        ...workspace.manifest,
        captureMode: 'host_execution_with_manual_artifacts',
        hostExecutionId: executionId,
        hostProject: { artifactId: 'host.project', path: 'project.bin' },
        renderedImage: {
          artifactId: 'host.render',
          path: 'render.png',
          frame: 1,
          renderEngine: 'TEST',
          colorManagement: 'test',
        },
      };
      await writeFile(workspace.manifestPath, JSON.stringify(manifest));

      const run = await captureProviderEvalRun(workspace);

      expect(
        run.sourceEvents.filter((event) => event.correlationKind === 'host_execution'),
      ).toHaveLength(1);
      expect(run.environment).toMatchObject({
        adapterVersion: workspace.source.environment.adapterVersion,
        hostVersion: workspace.source.environment.hostVersion,
      });
      expect(
        run.artifacts.find((artifact) => artifact.kind === 'manual_review_image'),
      ).toMatchObject({
        uri: expect.stringMatching(/^artifacts\/sha256\/[a-f0-9]{64}\.png$/),
        metadata: {
          evidenceClass: 'manual_artifact_not_runtime_bound',
          width: 1,
          height: 1,
          executionId,
          terminalHostReportId: reportId,
          planContentSha256: planHash,
        },
      });
      expect(
        run.artifacts.find((artifact) => artifact.kind === 'manual_review_image')
          ?.visualEnvironment,
      ).toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });
});
