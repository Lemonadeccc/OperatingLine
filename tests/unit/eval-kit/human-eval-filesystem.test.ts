import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  HumanEvalDatasetError,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  computeProviderEvalTreatmentSha256,
  contentWithoutIntegrity,
  createHumanEvalIntegrity,
  loadHumanEvalDatasetDirectory,
  sealHumanEvalSuite,
} from '@operatingline/eval-kit';
import type {
  CurrentEvalExportBundle,
  EvalArtifactReference,
  EvalExecutionEvent,
  HumanEvalAnnotation,
  HumanEvalSuite,
  ProviderEvalRun,
} from '@operatingline/protocol';

import {
  buildHumanEvalAnnotationFixture,
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

function bytesSha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const chunk = Buffer.allocUnsafe(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return chunk;
}

function indexedOnePixelPng(palette: Uint8Array, paletteIndex: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 3;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', palette),
    pngChunk('IDAT', deflateSync(Buffer.from([0, paletteIndex]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function resealRun(run: ProviderEvalRun): ProviderEvalRun {
  const content = contentWithoutIntegrity(run);
  return { ...content, integrity: createHumanEvalIntegrity(content) };
}

function resealAnnotation(annotation: HumanEvalAnnotation): HumanEvalAnnotation {
  const content = contentWithoutIntegrity(annotation);
  return { ...content, integrity: createHumanEvalIntegrity(content) };
}

function resealBundle(bundle: CurrentEvalExportBundle): {
  readonly bundle: CurrentEvalExportBundle;
  readonly json: string;
} {
  const { exportId, exportedAt, integrity, ...content } = bundle;
  const sealed: CurrentEvalExportBundle = {
    ...content,
    exportId,
    exportedAt,
    integrity: {
      ...integrity,
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
  return { bundle: sealed, json: JSON.stringify(sealed) };
}

function suiteWithReference(reference: EvalArtifactReference): HumanEvalSuite {
  const content = contentWithoutIntegrity(buildHumanEvalSuiteFixture());
  content.cases[0]!.references = [reference];
  return sealHumanEvalSuite(content);
}

async function writeDataset(
  directory: string,
  suite: HumanEvalSuite,
  runs: readonly ProviderEvalRun[] = [],
  annotations: readonly HumanEvalAnnotation[] = [],
): Promise<void> {
  await writeFile(join(directory, 'suite.json'), JSON.stringify(suite));
  if (runs.length > 0) {
    await mkdir(join(directory, 'runs'), { recursive: true });
    await Promise.all(
      runs.map((run) =>
        writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run)),
      ),
    );
  }
  if (annotations.length > 0) {
    await mkdir(join(directory, 'annotations'), { recursive: true });
    await Promise.all(
      annotations.map((annotation) =>
        writeFile(
          join(directory, 'annotations', `${annotation.annotationId}.annotation.json`),
          JSON.stringify(annotation),
        ),
      ),
    );
  }
}

async function artifactIssues(action: () => Promise<unknown>): Promise<readonly string[]> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HumanEvalDatasetError);
    return (error as HumanEvalDatasetError).issues;
  }
  throw new Error('Expected artifact validation to fail');
}

function buildLiveEvidence(
  sourceRun: ProviderEvalRun,
  events: readonly EvalExecutionEvent[],
  identity: {
    readonly artifactId: string;
    readonly artifactUri: string;
    readonly snapshotId: string;
    readonly exportId: string;
  } = {
    artifactId: 'eval.export',
    artifactUri: 'eval-export.json',
    snapshotId: '30000000-0000-4000-8000-000000000001',
    exportId: '30000000-0000-4000-8000-000000000002',
  },
): { readonly run: ProviderEvalRun; readonly bundleJson: string } {
  const hostInstanceId = events.find(
    (event) => event.eventType === 'companion.state.reported',
  )?.payload;
  const scopedInstanceId =
    hostInstanceId !== null &&
    typeof hostInstanceId === 'object' &&
    !Array.isArray(hostInstanceId) &&
    typeof (hostInstanceId as Record<string, unknown>)['instanceId'] === 'string'
      ? ((hostInstanceId as Record<string, unknown>)['instanceId'] as string)
      : null;
  const exportContent = {
    protocolVersion: '1.1.0' as const,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: sourceRun.environment.targetAdapterId,
      planId:
        sourceRun.invocation.operation === 'initial_plan'
          ? sourceRun.invocation.packet.context.requestedPlanId
          : sourceRun.invocation.packet.context.revisionRequest.basePlan.id,
      instanceId: scopedInstanceId,
    },
    catalogs: [sourceRun.invocation.packet.context.catalog],
    events: [...events],
    page: {
      snapshotId: identity.snapshotId,
      snapshotUpperSequence: events.at(-1)?.sequence ?? 0,
      afterSequence: 0,
      nextAfterSequence: events.at(-1)?.sequence ?? 0,
      hasMore: false,
    },
    summary: {
      matchedEventCount: events.length,
      eventTypeCounts: Object.fromEntries(events.map((event) => [event.eventType, 1])),
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Synthetic live-evidence fixture; review before sharing.',
    },
  };
  const bundle: CurrentEvalExportBundle = {
    ...exportContent,
    exportId: identity.exportId,
    exportedAt: '2026-08-05T00:00:02.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(exportContent),
    },
  };
  const bundleJson = JSON.stringify(bundle);
  const run = resealRun({
    ...sourceRun,
    sourceKind: 'live_provider_invocation',
    sourceEvidence: {
      kind: 'eval_export_snapshot',
      snapshotId: identity.snapshotId,
      snapshotUpperSequence: exportContent.page.snapshotUpperSequence,
      evalExportArtifactIds: [identity.artifactId],
    },
    sourceEvents: events
      .filter(
        (event) =>
          event.eventType.startsWith('planning.provider.') ||
          event.eventType === 'companion.state.reported',
      )
      .map((event) => {
        const common = {
          sequence: event.sequence,
          eventId: event.id,
          eventType: event.eventType,
          payloadSha256: computeHumanEvalContentSha256(event.payload),
        };
        if (event.eventType.startsWith('planning.provider.')) {
          return {
            ...common,
            correlationKind: 'provider_request' as const,
            requestId: sourceRun.invocation.request.requestId,
          };
        }
        const payload = event.payload as Record<string, unknown>;
        const planContentSha256 = payload['planContentSha256'];
        const executionId = payload['executionId'];
        const reportId = payload['reportId'];
        if (
          typeof planContentSha256 !== 'string' ||
          (executionId !== null && typeof executionId !== 'string') ||
          typeof reportId !== 'string'
        ) {
          throw new Error('Expected exact companion report identity');
        }
        return {
          ...common,
          correlationKind: 'host_execution' as const,
          planId: exportContent.scope.planId,
          planContentSha256,
          instanceId: exportContent.scope.instanceId,
          executionId,
          reportId,
        };
      }),
    artifacts: [
      {
        artifactId: identity.artifactId,
        kind: 'eval_export',
        mediaType: 'application/json',
        uri: identity.artifactUri,
        contentSha256: bytesSha256(bundleJson),
        metadata: {},
      },
    ],
  });
  return { run, bundleJson };
}

function buildSyntheticRenderedRun(
  suite: HumanEvalSuite,
  renderedImage: Uint8Array,
  visualOverrides: {
    readonly width?: number;
    readonly height?: number;
    readonly hostVersion?: string;
    readonly adapterVersion?: string;
  } = {},
): { readonly run: ProviderEvalRun; readonly hostProject: string } {
  const sourceRun = buildProviderEvalRunFixture(suite);
  if (
    sourceRun.outcome.status !== 'completed' ||
    sourceRun.environment.hostVersion === null ||
    sourceRun.environment.adapterVersion === null
  ) {
    throw new Error('Expected completed render fixture with exact environment');
  }
  const hostProject = 'synthetic host project';
  const hostProjectSha256 = bytesSha256(hostProject);
  const planContentSha256 = computePlanContentSha256(sourceRun.outcome.result.draft.plan);
  const executionId = '32000000-0000-4000-8000-000000000001';
  const reportId = '32000000-0000-4000-8000-000000000002';
  return {
    hostProject,
    run: resealRun({
      ...sourceRun,
      sourceEvents: [
        {
          sequence: 1,
          eventId: 'synthetic.host.terminal',
          eventType: 'companion.state.reported',
          payloadSha256: 'd'.repeat(64),
          correlationKind: 'host_execution',
          planId: sourceRun.outcome.result.draft.plan.id,
          planContentSha256,
          instanceId: null,
          executionId,
          reportId,
        },
      ],
      artifacts: [
        {
          artifactId: 'host.project',
          kind: 'host_project',
          mediaType: 'application/octet-stream',
          uri: 'host-project.bin',
          contentSha256: hostProjectSha256,
          metadata: {},
        },
        {
          artifactId: 'render.preview',
          kind: 'rendered_image',
          mediaType: 'image/png',
          uri: 'render.png',
          contentSha256: bytesSha256(renderedImage),
          metadata: {},
          visualEnvironment: {
            width: visualOverrides.width ?? 1,
            height: visualOverrides.height ?? 1,
            frame: 1,
            renderEngine: 'TEST_RENDERER',
            colorManagement: 'test',
            hostVersion: visualOverrides.hostVersion ?? sourceRun.environment.hostVersion,
            adapterVersion: visualOverrides.adapterVersion ?? sourceRun.environment.adapterVersion,
            planContentSha256,
            executionId,
            terminalHostReportId: reportId,
            terminalHostEventSequence: 1,
            hostProjectSha256,
          },
        },
      ],
    }),
  };
}

describe('human eval filesystem evidence', () => {
  it('allows only explicitly rooted artifact URIs and rejects lexical path escape', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'operatingline-eval-fs-'));
    const datasetDirectory = join(workspace, 'dataset');
    const artifactRoot = join(workspace, 'artifacts');
    try {
      await Promise.all([mkdir(datasetDirectory), mkdir(artifactRoot)]);
      const content = '{"trusted":true}';
      await writeFile(join(artifactRoot, 'reference.json'), content);
      const reference = {
        artifactId: 'canvas.reference',
        kind: 'planning_benchmark' as const,
        mediaType: 'application/json',
        uri: 'repo://reference.json',
        contentSha256: bytesSha256(content),
        metadata: {},
      };
      await writeDataset(datasetDirectory, suiteWithReference(reference));

      await expect(
        loadHumanEvalDatasetDirectory(datasetDirectory, { artifactRoots: { repo: artifactRoot } }),
      ).resolves.toMatchObject({ verificationLevel: 'artifact_verified' });
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(datasetDirectory))).toEqual(
        expect.arrayContaining([expect.stringContaining('has no configured artifact root')]),
      );

      await writeDataset(
        datasetDirectory,
        suiteWithReference({ ...reference, uri: '../artifacts/reference.json' }),
      );
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(datasetDirectory))).toEqual(
        expect.arrayContaining([expect.stringContaining('escapes its configured root')]),
      );

      await writeDataset(
        datasetDirectory,
        suiteWithReference({ ...reference, uri: join(artifactRoot, 'reference.json') }),
      );
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(datasetDirectory))).toEqual(
        expect.arrayContaining([expect.stringContaining('Absolute artifact path')]),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects artifacts whose symlink target escapes the configured root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'operatingline-eval-symlink-'));
    const datasetDirectory = join(workspace, 'dataset');
    const artifactRoot = join(workspace, 'artifacts');
    try {
      await Promise.all([mkdir(datasetDirectory), mkdir(artifactRoot)]);
      const outsidePath = join(workspace, 'outside.json');
      const content = '{"outside":true}';
      await writeFile(outsidePath, content);
      await symlink(outsidePath, join(artifactRoot, 'linked.json'));
      await writeDataset(
        datasetDirectory,
        suiteWithReference({
          artifactId: 'canvas.reference',
          kind: 'planning_benchmark',
          mediaType: 'application/json',
          uri: 'repo://linked.json',
          contentSha256: bytesSha256(content),
          metadata: {},
        }),
      );

      expect(
        await artifactIssues(() =>
          loadHumanEvalDatasetDirectory(datasetDirectory, {
            artifactRoots: { repo: artifactRoot },
          }),
        ),
      ).toEqual(expect.arrayContaining([expect.stringContaining('resolves outside')]));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('verifies the raw bytes of every run artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-run-artifact-'));
    try {
      const suite = buildHumanEvalSuiteFixture();
      const run = buildProviderEvalRunFixture(suite);
      const tampered = resealRun({
        ...run,
        artifacts: [
          {
            artifactId: 'provider.output',
            kind: 'provider_output',
            mediaType: 'application/json',
            uri: 'provider-output.json',
            contentSha256: 'a'.repeat(64),
            metadata: {},
          },
        ],
      });
      await writeDataset(directory, suite, [tampered]);
      await writeFile(join(directory, 'provider-output.json'), '{}');

      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('artifact provider.output hash mismatch')]),
      );
      expect(
        await artifactIssues(() =>
          loadHumanEvalDatasetDirectory(directory, { maxArtifactBytes: 1 }),
        ),
      ).toEqual(expect.arrayContaining([expect.stringContaining('byte size limit')]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['hostVersion', '999.0.0'],
    ['adapterVersion', '999.0.0'],
  ] as const)(
    'rejects a rendered image whose %s differs from the run environment',
    async (field, value) => {
      const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-render-env-'));
      try {
        const suite = buildHumanEvalSuiteFixture();
        const { run, hostProject } = buildSyntheticRenderedRun(suite, onePixelPng, {
          [field]: value,
        });
        await writeDataset(directory, suite, [run]);
        await Promise.all([
          writeFile(join(directory, 'host-project.bin'), hostProject),
          writeFile(join(directory, 'render.png'), onePixelPng),
        ]);

        expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
          expect.arrayContaining([expect.stringContaining('exact host and adapter environment')]),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ['corrupt bytes', Buffer.from('not a png'), 1, 'not a decodable PNG'],
    ['declared dimensions', onePixelPng, 2, 'dimensions do not match'],
    ['empty indexed palette', indexedOnePixelPng(Buffer.alloc(0), 0), 1, 'complete RGB entries'],
    [
      'partial indexed palette entry',
      indexedOnePixelPng(Buffer.from([0, 0]), 0),
      1,
      'complete RGB entries',
    ],
    [
      'out-of-range indexed pixel',
      indexedOnePixelPng(Buffer.from([0, 0, 0]), 1),
      1,
      'missing palette entry 1',
    ],
  ] as const)('rejects a rendered image with invalid %s', async (_case, bytes, width, issue) => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-render-png-'));
    try {
      const suite = buildHumanEvalSuiteFixture();
      const { run, hostProject } = buildSyntheticRenderedRun(suite, bytes, { width });
      await writeDataset(directory, suite, [run]);
      await Promise.all([
        writeFile(join(directory, 'host-project.bin'), hostProject),
        writeFile(join(directory, 'render.png'), bytes),
      ]);

      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining(issue)]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires exact terminal host evidence without excluding failed provider treatments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-released-host-'));
    try {
      const suiteContent = contentWithoutIntegrity(buildHumanEvalSuiteFixture());
      suiteContent.status = 'released';
      suiteContent.rubric.criteria.push({
        id: 'execution.host_outcome',
        title: 'Host execution outcome',
        dimension: 'execution_outcome',
        evaluationStage: 'execution',
        question: 'Did the exact host execution reach a reviewable terminal state?',
        guidance: 'Use an exact terminal host event from the frozen Eval export.',
        evidenceKinds: ['execution_event', 'run_output'],
      });
      suiteContent.rubric.criteria.push({
        id: 'artifact.visual_alignment',
        title: 'Rendered artifact alignment',
        dimension: 'visual_alignment',
        evaluationStage: 'artifact',
        question: 'Does the exact rendered artifact satisfy the requested goal?',
        guidance: 'Use an environment-bound rendered image.',
        evidenceKinds: ['artifact', 'run_output'],
      });
      suiteContent.cases[0]!.rubricCriterionIds.push(
        'execution.host_outcome',
        'artifact.visual_alignment',
      );
      const suite = sealHumanEvalSuite(suiteContent);
      const firstSource = buildProviderEvalRunFixture(suite);
      if (
        firstSource.invocation.operation !== 'initial_plan' ||
        firstSource.outcome.status !== 'completed' ||
        firstSource.outcome.operation !== 'initial_plan'
      ) {
        throw new Error('Expected completed initial-plan fixture');
      }

      const secondContent = structuredClone(firstSource);
      secondContent.runId = '31000000-0000-4000-8000-000000000010';
      secondContent.invocation.request.requestId = '31000000-0000-4000-8000-000000000011';
      const failedError = {
        error: 'planner_provider_failed' as const,
        requestId: secondContent.invocation.request.requestId,
        message: 'Intentional provider failure retained in the released comparison.',
        retryMode: 'never' as const,
      };
      secondContent.outcome = {
        status: 'failed',
        operation: 'initial_plan',
        error: failedError,
        errorSha256: computeHumanEvalContentSha256(failedError),
      };
      secondContent.generationSettings.normalizedParameters['temperature'] = 0.25;
      secondContent.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
        secondContent.generationSettings.normalizedParameters,
      );
      secondContent.comparability.treatmentSha256 =
        computeProviderEvalTreatmentSha256(secondContent);
      const secondSource = resealRun(secondContent);

      const providerEvents = (run: ProviderEvalRun): EvalExecutionEvent[] => {
        if (run.invocation.operation !== 'initial_plan') {
          throw new Error('Expected initial-plan run');
        }
        const requestFingerprint = computeHumanEvalContentSha256(run.invocation.request);
        const requested: EvalExecutionEvent = {
          sequence: 1,
          id: `${run.runId}.requested`,
          eventType: 'planning.provider.generation.requested',
          payload: {
            requestId: run.invocation.request.requestId,
            requestFingerprint,
            providerId: run.profile.descriptor.id,
            providerVersion: run.profile.descriptor.version,
            targetAdapterId: run.environment.targetAdapterId,
            catalogVersion: run.environment.catalogVersion,
            planId: run.invocation.packet.context.requestedPlanId,
            packetFormatVersion: run.invocation.packet.formatVersion,
            occurredAt: '2026-08-05T00:00:00.000Z',
          },
          createdAt: '2026-08-05T00:00:00.000Z',
        };
        const terminal: EvalExecutionEvent =
          run.outcome.status === 'completed'
            ? {
                sequence: 2,
                id: `${run.runId}.completed`,
                eventType: 'planning.provider.generation.completed',
                payload: {
                  request: run.invocation.request,
                  requestFingerprint,
                  targetAdapterId: run.environment.targetAdapterId,
                  catalogVersion: run.environment.catalogVersion,
                  planId: run.invocation.packet.context.requestedPlanId,
                  result: run.outcome.result,
                },
                createdAt: '2026-08-05T00:00:01.000Z',
              }
            : {
                sequence: 2,
                id: `${run.runId}.failed`,
                eventType: 'planning.provider.generation.failed',
                payload: {
                  requestId: run.invocation.request.requestId,
                  requestFingerprint,
                  providerId: run.profile.descriptor.id,
                  providerVersion: run.profile.descriptor.version,
                  targetAdapterId: run.environment.targetAdapterId,
                  catalogVersion: run.environment.catalogVersion,
                  planId: run.invocation.packet.context.requestedPlanId,
                  error: run.outcome.error.error,
                  durationMs: 1_000,
                  occurredAt: '2026-08-05T00:00:01.000Z',
                },
                createdAt: '2026-08-05T00:00:01.000Z',
              };
        return [requested, terminal];
      };

      const executableStepIds = firstSource.outcome.result.draft.plan.steps
        .filter((step) => step.action !== null)
        .map((step) => step.id);
      const finalStepId = executableStepIds.at(-1);
      if (finalStepId === undefined) {
        throw new Error('Expected at least one executable fixture step');
      }
      const planContentSha256 = computePlanContentSha256(firstSource.outcome.result.draft.plan);
      const executionId = '31000000-0000-4000-8000-000000000019';
      const reportId = '31000000-0000-4000-8000-000000000020';
      const hostInstanceId = '31000000-0000-4000-8000-000000000021';
      const proposalId = '31000000-0000-4000-8000-000000000026';
      const proposalCreated: EvalExecutionEvent = {
        sequence: 3,
        id: `${firstSource.runId}.proposal-created`,
        eventType: 'guide.proposal.created',
        payload: {
          protocolVersion: firstSource.environment.protocolVersion,
          proposalId,
          targetAdapterId: firstSource.environment.targetAdapterId,
          targetInstanceId: hostInstanceId,
          plan: firstSource.outcome.result.draft.plan,
          planDiff: null,
          catalogVersion: firstSource.environment.catalogVersion,
          proposedAt: '2026-08-05T00:00:01.250Z',
        },
        createdAt: '2026-08-05T00:00:01.250Z',
      };
      const proposalAccepted: EvalExecutionEvent = {
        sequence: 4,
        id: `${firstSource.runId}.proposal-accepted`,
        eventType: 'guide.proposal.decided',
        payload: {
          protocolVersion: firstSource.environment.protocolVersion,
          decisionId: '31000000-0000-4000-8000-000000000027',
          proposalId,
          adapterId: firstSource.environment.targetAdapterId,
          instanceId: hostInstanceId,
          decision: 'accepted',
          occurredAt: '2026-08-05T00:00:01.500Z',
        },
        createdAt: '2026-08-05T00:00:01.500Z',
      };
      const completedHostEvent: EvalExecutionEvent = {
        sequence: 5,
        id: `${firstSource.runId}.host-terminal`,
        eventType: 'companion.state.reported',
        payload: {
          protocolVersion: firstSource.environment.protocolVersion,
          reportId,
          sequence: 1,
          adapterId: firstSource.environment.targetAdapterId,
          instanceId: hostInstanceId,
          companionVersion: firstSource.environment.adapterVersion,
          hostVersion: firstSource.environment.hostVersion,
          plan: {
            id: firstSource.outcome.result.draft.plan.id,
            revision: firstSource.outcome.result.draft.plan.revision,
          },
          planContentSha256,
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
      };
      const firstLive = buildLiveEvidence(
        firstSource,
        [...providerEvents(firstSource), proposalCreated, proposalAccepted, completedHostEvent],
        {
          artifactId: 'eval.export.first',
          artifactUri: 'eval-export-first.json',
          snapshotId: '31000000-0000-4000-8000-000000000022',
          exportId: '31000000-0000-4000-8000-000000000023',
        },
      );
      if (
        firstSource.environment.hostVersion === null ||
        firstSource.environment.adapterVersion === null
      ) {
        throw new Error('Expected exact host and adapter fixture versions');
      }
      const hostProjectBytes = 'released host project bytes';
      const renderedImageBytes = onePixelPng;
      const hostProjectSha256 = bytesSha256(hostProjectBytes);
      const firstEvidence = {
        bundleJson: firstLive.bundleJson,
        run: resealRun({
          ...firstLive.run,
          artifacts: [
            ...firstLive.run.artifacts,
            {
              artifactId: 'host.project.first',
              kind: 'host_project',
              mediaType: 'application/octet-stream',
              uri: 'host-project-first.bin',
              contentSha256: hostProjectSha256,
              metadata: {},
            },
            {
              artifactId: 'render.preview.first',
              kind: 'rendered_image',
              mediaType: 'image/png',
              uri: 'render-first.png',
              contentSha256: bytesSha256(renderedImageBytes),
              metadata: {},
              visualEnvironment: {
                width: 1,
                height: 1,
                frame: 1,
                renderEngine: 'TEST_RENDERER',
                colorManagement: 'test',
                hostVersion: firstSource.environment.hostVersion,
                adapterVersion: firstSource.environment.adapterVersion,
                planContentSha256,
                executionId,
                terminalHostReportId: reportId,
                terminalHostEventSequence: 5,
                hostProjectSha256,
              },
            },
          ],
        }),
      };
      const secondLive = buildLiveEvidence(secondSource, providerEvents(secondSource), {
        artifactId: 'eval.export.second',
        artifactUri: 'eval-export-second.json',
        snapshotId: '31000000-0000-4000-8000-000000000024',
        exportId: '31000000-0000-4000-8000-000000000025',
      });

      const annotationsFor = (
        run: ProviderEvalRun,
        judgment: 'met' | 'not_met' | 'unable_to_judge',
        ids: readonly [string, string],
      ): HumanEvalAnnotation[] =>
        ['reviewer.alpha', 'reviewer.beta'].map((reviewer, index) => {
          const annotation = buildHumanEvalAnnotationFixture(suite, run, reviewer, ids[index]!);
          const outcomeSha256 =
            run.outcome.status === 'completed' ? run.outcome.resultSha256 : run.outcome.errorSha256;
          for (const criterionJudgment of annotation.review.judgments) {
            criterionJudgment.evidence = [
              {
                kind: 'run_output',
                locator: run.outcome.status === 'completed' ? 'outcome.result' : 'outcome.error',
                contentSha256: outcomeSha256,
                note: 'Exact parsed provider outcome for this run.',
              },
            ];
          }
          const executionJudgment = annotation.review.judgments.find(
            (candidate) => candidate.criterionId === 'execution.host_outcome',
          )!;
          executionJudgment.judgment = judgment;
          executionJudgment.rationale =
            judgment === 'unable_to_judge'
              ? 'Provider generation failed before host execution, so execution is not judgeable.'
              : 'The exact terminal host report supports this execution judgment.';
          executionJudgment.evidence =
            judgment === 'unable_to_judge'
              ? [
                  {
                    kind: 'run_output',
                    locator: 'outcome.error',
                    contentSha256: outcomeSha256,
                    note: 'Exact provider failure explains why host execution is unavailable.',
                  },
                ]
              : [
                  {
                    kind: 'execution_event',
                    locator: String(
                      run.sourceEvents.find((event) => event.correlationKind === 'host_execution')!
                        .sequence,
                    ),
                    contentSha256: run.sourceEvents.find(
                      (event) => event.correlationKind === 'host_execution',
                    )!.payloadSha256,
                    note: 'Exact terminal host event from the frozen Eval export.',
                  },
                ];
          const artifactJudgment = annotation.review.judgments.find(
            (candidate) => candidate.criterionId === 'artifact.visual_alignment',
          )!;
          artifactJudgment.judgment = judgment;
          artifactJudgment.rationale =
            judgment === 'unable_to_judge'
              ? 'Provider generation failed before a rendered artifact could be produced.'
              : 'The exact environment-bound render supports this visual judgment.';
          artifactJudgment.evidence =
            judgment === 'unable_to_judge'
              ? [
                  {
                    kind: 'run_output',
                    locator: 'outcome.error',
                    contentSha256: outcomeSha256,
                    note: 'Exact provider failure explains why render evidence is unavailable.',
                  },
                ]
              : [
                  {
                    kind: 'artifact',
                    locator: run.artifacts.find((artifact) => artifact.kind === 'rendered_image')!
                      .artifactId,
                    contentSha256: run.artifacts.find(
                      (artifact) => artifact.kind === 'rendered_image',
                    )!.contentSha256,
                    note: 'Exact rendered image with host and adapter provenance.',
                  },
                ];
          annotation.review.recommendation =
            judgment === 'met' ? 'accept' : judgment === 'not_met' ? 'revise' : 'unable_to_judge';
          return resealAnnotation(annotation);
        });

      const failedAnnotations = annotationsFor(secondLive.run, 'unable_to_judge', [
        '31000000-0000-4000-8000-000000000030',
        '31000000-0000-4000-8000-000000000031',
      ]);
      const writeReleasedEvidence = async (
        first: { readonly run: ProviderEvalRun; readonly bundleJson: string },
        firstJudgment: 'met' | 'not_met',
      ): Promise<void> => {
        const firstAnnotations = annotationsFor(first.run, firstJudgment, [
          '31000000-0000-4000-8000-000000000032',
          '31000000-0000-4000-8000-000000000033',
        ]);
        await writeDataset(
          directory,
          suite,
          [first.run, secondLive.run],
          [...firstAnnotations, ...failedAnnotations],
        );
        await Promise.all([
          writeFile(join(directory, 'eval-export-first.json'), first.bundleJson),
          writeFile(join(directory, 'eval-export-second.json'), secondLive.bundleJson),
          writeFile(join(directory, 'host-project-first.bin'), hostProjectBytes),
          writeFile(join(directory, 'render-first.png'), renderedImageBytes),
        ]);
      };

      await writeReleasedEvidence(firstEvidence, 'met');
      await expect(loadHumanEvalDatasetDirectory(directory)).resolves.toMatchObject({
        verificationLevel: 'artifact_verified',
      });

      const mutateFirstBundle = (
        mutate: (bundle: CurrentEvalExportBundle) => void,
      ): { readonly run: ProviderEvalRun; readonly bundleJson: string } => {
        const bundle = JSON.parse(firstEvidence.bundleJson) as CurrentEvalExportBundle;
        mutate(bundle);
        const sealed = resealBundle(bundle);
        return {
          bundleJson: sealed.json,
          run: resealRun({
            ...firstEvidence.run,
            sourceEvents: firstEvidence.run.sourceEvents.map((summary) => {
              const event = sealed.bundle.events.find(
                (candidate) => candidate.id === summary.eventId,
              );
              return event === undefined
                ? summary
                : {
                    ...summary,
                    sequence: event.sequence,
                    payloadSha256: computeHumanEvalContentSha256(event.payload),
                  };
            }),
            artifacts: firstEvidence.run.artifacts.map((artifact) =>
              artifact.kind === 'eval_export'
                ? { ...artifact, contentSha256: bytesSha256(sealed.json) }
                : artifact,
            ),
          }),
        };
      };

      const nonExactProposal = mutateFirstBundle((bundle) => {
        const proposal = bundle.events.find(
          (event) => event.eventType === 'guide.proposal.created',
        );
        if (
          proposal === undefined ||
          proposal.payload === null ||
          typeof proposal.payload !== 'object' ||
          Array.isArray(proposal.payload)
        ) {
          throw new Error('Expected exact proposal event');
        }
        const plan = (proposal.payload as Record<string, unknown>)['plan'] as {
          steps: Array<{ action: null | { arguments: Record<string, unknown> } }>;
        };
        const createStep = plan.steps.find((step) => step.action !== null);
        if (createStep?.action === null || createStep?.action === undefined) {
          throw new Error('Expected proposal action arguments');
        }
        createStep.action.arguments['title'] = 'A different plan with the same structural IDs';
      });
      await writeReleasedEvidence(nonExactProposal, 'met');
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact terminal host execution')]),
      );

      const lateAuthorizationBase = mutateFirstBundle((bundle) => {
        const accepted = bundle.events.find(
          (event) => event.eventType === 'guide.proposal.decided',
        );
        const host = bundle.events.find((event) => event.eventType === 'companion.state.reported');
        if (accepted === undefined || host === undefined) {
          throw new Error('Expected authorization and host terminal events');
        }
        accepted.sequence = 5;
        host.sequence = 4;
        bundle.events.sort((left, right) => left.sequence - right.sequence);
      });
      const lateAuthorization = {
        bundleJson: lateAuthorizationBase.bundleJson,
        run: resealRun({
          ...lateAuthorizationBase.run,
          artifacts: lateAuthorizationBase.run.artifacts.map((artifact) =>
            artifact.kind === 'rendered_image' && artifact.visualEnvironment !== undefined
              ? {
                  ...artifact,
                  visualEnvironment: {
                    ...artifact.visualEnvironment,
                    terminalHostEventSequence: 4,
                  },
                }
              : artifact,
          ),
        }),
      };
      await writeReleasedEvidence(lateAuthorization, 'met');
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact terminal host execution')]),
      );

      const mismatchedRenderEnvironment = {
        bundleJson: firstEvidence.bundleJson,
        run: resealRun({
          ...firstEvidence.run,
          artifacts: firstEvidence.run.artifacts.map((artifact) =>
            artifact.kind === 'rendered_image' && artifact.visualEnvironment !== undefined
              ? {
                  ...artifact,
                  visualEnvironment: {
                    ...artifact.visualEnvironment,
                    hostVersion: '999.0.0',
                  },
                }
              : artifact,
          ),
        }),
      };
      await writeReleasedEvidence(mismatchedRenderEnvironment, 'met');
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact host and adapter environment')]),
      );

      const mutateFirstHostReport = (
        mutate: (payload: Record<string, unknown>) => void,
      ): { readonly run: ProviderEvalRun; readonly bundleJson: string } =>
        mutateFirstBundle((bundle) => {
          const hostEvent = bundle.events.find(
            (event) => event.eventType === 'companion.state.reported',
          )!;
          mutate(hostEvent.payload as Record<string, unknown>);
        });

      const planLoaded = mutateFirstHostReport((payload) => {
        payload['phase'] = 'ready';
        payload['activeStepId'] = null;
        payload['completedStepIds'] = [];
        payload['transition'] = 'plan_loaded';
        payload['stepId'] = null;
      });
      await writeReleasedEvidence(planLoaded, 'met');
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact terminal host execution')]),
      );

      const hostError = mutateFirstHostReport((payload) => {
        payload['phase'] = 'error';
        payload['activeStepId'] = null;
        payload['completedStepIds'] = [];
        payload['transition'] = 'error';
        payload['stepId'] = null;
        payload['error'] = 'Host action failed after the exact plan was accepted.';
      });
      await writeReleasedEvidence(hostError, 'not_met');
      await expect(loadHumanEvalDatasetDirectory(directory)).resolves.toMatchObject({
        verificationLevel: 'artifact_verified',
      });

      const reusedContent = structuredClone(firstSource);
      if (reusedContent.outcome.status !== 'completed') {
        throw new Error('Expected completed treatment fixture');
      }
      reusedContent.runId = '31000000-0000-4000-8000-000000000040';
      reusedContent.invocation.request.requestId = '31000000-0000-4000-8000-000000000041';
      reusedContent.outcome.result.requestId = reusedContent.invocation.request.requestId;
      reusedContent.outcome.result.generationId = '31000000-0000-4000-8000-000000000042';
      const changedActionStep = reusedContent.outcome.result.draft.plan.steps.find(
        (step) => step.action?.name === 'canvas.document.create',
      );
      if (changedActionStep?.action === null || changedActionStep?.action === undefined) {
        throw new Error('Expected mutable action arguments in the second treatment');
      }
      changedActionStep.action.arguments['title'] = 'Distinct provider action arguments';
      reusedContent.outcome.resultSha256 = computeHumanEvalContentSha256(
        reusedContent.outcome.result,
      );
      reusedContent.generationSettings.normalizedParameters['temperature'] = 0.5;
      reusedContent.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
        reusedContent.generationSettings.normalizedParameters,
      );
      reusedContent.comparability.treatmentSha256 =
        computeProviderEvalTreatmentSha256(reusedContent);
      const reusedSource = resealRun(reusedContent);
      if (reusedSource.outcome.status !== 'completed') {
        throw new Error('Expected completed second treatment');
      }
      expect(reusedSource.outcome.result.draft.plan.id).toBe(
        firstSource.outcome.result.draft.plan.id,
      );
      expect(reusedSource.outcome.result.draft.plan.revision).toBe(
        firstSource.outcome.result.draft.plan.revision,
      );
      expect(reusedSource.outcome.result.draft.plan.steps.map((step) => step.id)).toEqual(
        firstSource.outcome.result.draft.plan.steps.map((step) => step.id),
      );
      const reusedPlanContentSha256 = computePlanContentSha256(
        reusedSource.outcome.result.draft.plan,
      );
      expect(reusedPlanContentSha256).not.toBe(planContentSha256);

      const reusedProposalId = '31000000-0000-4000-8000-000000000043';
      const reusedReportId = '31000000-0000-4000-8000-000000000044';
      const reusedProposalCreated: EvalExecutionEvent = {
        sequence: 3,
        id: `${reusedSource.runId}.proposal-created`,
        eventType: 'guide.proposal.created',
        payload: {
          protocolVersion: reusedSource.environment.protocolVersion,
          proposalId: reusedProposalId,
          targetAdapterId: reusedSource.environment.targetAdapterId,
          targetInstanceId: hostInstanceId,
          plan: reusedSource.outcome.result.draft.plan,
          planDiff: null,
          catalogVersion: reusedSource.environment.catalogVersion,
          proposedAt: '2026-08-05T00:00:01.250Z',
        },
        createdAt: '2026-08-05T00:00:01.250Z',
      };
      const reusedProposalAccepted: EvalExecutionEvent = {
        sequence: 4,
        id: `${reusedSource.runId}.proposal-accepted`,
        eventType: 'guide.proposal.decided',
        payload: {
          protocolVersion: reusedSource.environment.protocolVersion,
          decisionId: '31000000-0000-4000-8000-000000000045',
          proposalId: reusedProposalId,
          adapterId: reusedSource.environment.targetAdapterId,
          instanceId: hostInstanceId,
          decision: 'accepted',
          occurredAt: '2026-08-05T00:00:01.500Z',
        },
        createdAt: '2026-08-05T00:00:01.500Z',
      };
      const reusedHostEvent: EvalExecutionEvent = {
        sequence: 5,
        id: `${reusedSource.runId}.host-terminal`,
        eventType: 'companion.state.reported',
        payload: {
          protocolVersion: reusedSource.environment.protocolVersion,
          reportId: reusedReportId,
          sequence: 2,
          adapterId: reusedSource.environment.targetAdapterId,
          instanceId: hostInstanceId,
          companionVersion: reusedSource.environment.adapterVersion,
          hostVersion: reusedSource.environment.hostVersion,
          plan: {
            id: reusedSource.outcome.result.draft.plan.id,
            revision: reusedSource.outcome.result.draft.plan.revision,
          },
          planContentSha256: reusedPlanContentSha256,
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
      };
      const reusedLive = buildLiveEvidence(
        reusedSource,
        [
          ...providerEvents(reusedSource),
          reusedProposalCreated,
          reusedProposalAccepted,
          reusedHostEvent,
        ],
        {
          artifactId: 'eval.export.reused',
          artifactUri: 'eval-export-reused.json',
          snapshotId: '31000000-0000-4000-8000-000000000046',
          exportId: '31000000-0000-4000-8000-000000000047',
        },
      );
      const reusedEvidence = {
        bundleJson: reusedLive.bundleJson,
        run: resealRun({
          ...reusedLive.run,
          artifacts: [
            ...reusedLive.run.artifacts,
            {
              artifactId: 'host.project.reused',
              kind: 'host_project',
              mediaType: 'application/octet-stream',
              uri: 'host-project-first.bin',
              contentSha256: hostProjectSha256,
              metadata: {},
            },
            {
              artifactId: 'render.preview.reused',
              kind: 'rendered_image',
              mediaType: 'image/png',
              uri: 'render-first.png',
              contentSha256: bytesSha256(renderedImageBytes),
              metadata: {},
              visualEnvironment: {
                width: 1,
                height: 1,
                frame: 1,
                renderEngine: 'TEST_RENDERER',
                colorManagement: 'test',
                hostVersion: reusedSource.environment.hostVersion,
                adapterVersion: reusedSource.environment.adapterVersion,
                planContentSha256: reusedPlanContentSha256,
                executionId,
                terminalHostReportId: reusedReportId,
                terminalHostEventSequence: 5,
                hostProjectSha256,
              },
            },
          ],
        }),
      };
      const firstReuseAnnotations = annotationsFor(firstEvidence.run, 'met', [
        '31000000-0000-4000-8000-000000000032',
        '31000000-0000-4000-8000-000000000033',
      ]);
      const reusedAnnotations = annotationsFor(reusedEvidence.run, 'met', [
        '31000000-0000-4000-8000-000000000050',
        '31000000-0000-4000-8000-000000000051',
      ]);
      await writeDataset(
        directory,
        suite,
        [firstEvidence.run, secondLive.run, reusedEvidence.run],
        [...firstReuseAnnotations, ...failedAnnotations, ...reusedAnnotations],
      );
      await Promise.all([
        writeFile(join(directory, 'eval-export-first.json'), firstEvidence.bundleJson),
        writeFile(join(directory, 'eval-export-second.json'), secondLive.bundleJson),
        writeFile(join(directory, 'eval-export-reused.json'), reusedEvidence.bundleJson),
        writeFile(join(directory, 'host-project-first.bin'), hostProjectBytes),
        writeFile(join(directory, 'render-first.png'), renderedImageBytes),
      ]);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('cannot reuse host execution')]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('binds live runs to an intact frozen Eval export and rejects bundle tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-live-export-'));
    try {
      const suite = buildHumanEvalSuiteFixture();
      const sourceRun = buildProviderEvalRunFixture(suite);
      const requestId = sourceRun.invocation.request.requestId;
      const requestFingerprint = computeHumanEvalContentSha256(sourceRun.invocation.request);
      if (
        sourceRun.invocation.operation !== 'initial_plan' ||
        sourceRun.outcome.status !== 'completed' ||
        sourceRun.outcome.operation !== 'initial_plan'
      ) {
        throw new Error('Expected completed initial-plan fixture');
      }
      const planContentSha256 = computePlanContentSha256(sourceRun.outcome.result.draft.plan);
      const events: EvalExecutionEvent[] = [
        {
          sequence: 1,
          id: 'planning-requested',
          eventType: 'planning.provider.generation.requested',
          payload: {
            requestId,
            requestFingerprint,
            providerId: sourceRun.profile.descriptor.id,
            providerVersion: sourceRun.profile.descriptor.version,
            targetAdapterId: sourceRun.environment.targetAdapterId,
            catalogVersion: sourceRun.environment.catalogVersion,
            planId: sourceRun.invocation.packet.context.requestedPlanId,
            packetFormatVersion: sourceRun.invocation.packet.formatVersion,
            occurredAt: '2026-08-05T00:00:00.000Z',
          },
          createdAt: '2026-08-05T00:00:00.000Z',
        },
        {
          sequence: 2,
          id: 'planning-completed',
          eventType: 'planning.provider.generation.completed',
          payload: {
            request: sourceRun.invocation.request,
            requestFingerprint,
            targetAdapterId: sourceRun.environment.targetAdapterId,
            catalogVersion: sourceRun.environment.catalogVersion,
            planId: sourceRun.invocation.packet.context.requestedPlanId,
            result: sourceRun.outcome.result,
          },
          createdAt: '2026-08-05T00:00:01.000Z',
        },
        {
          sequence: 3,
          id: 'host-state',
          eventType: 'companion.state.reported',
          payload: {
            protocolVersion: '1.1.0',
            reportId: '30000000-0000-4000-8000-000000000010',
            sequence: 1,
            adapterId: sourceRun.environment.targetAdapterId,
            instanceId: '30000000-0000-4000-8000-000000000011',
            companionVersion: '1.0.0',
            hostVersion: sourceRun.environment.hostVersion,
            plan: {
              id: sourceRun.invocation.packet.context.requestedPlanId,
              revision: sourceRun.outcome.result.draft.plan.revision,
            },
            planContentSha256,
            executionId: null,
            phase: 'ready',
            activeStepId: null,
            completedStepIds: [],
            transition: 'plan_loaded',
            stepId: null,
            observations: [],
            error: null,
            occurredAt: '2026-08-05T00:00:01.500Z',
          },
          createdAt: '2026-08-05T00:00:01.500Z',
        },
      ];
      const live = buildLiveEvidence(sourceRun, events);
      await writeDataset(directory, suite, [live.run]);
      await writeFile(join(directory, 'eval-export.json'), live.bundleJson);

      await expect(loadHumanEvalDatasetDirectory(directory)).resolves.toBeDefined();

      const earlyHostRun = resealRun({
        ...live.run,
        sourceEvents: live.run.sourceEvents
          .map((event) =>
            event.correlationKind === 'host_execution'
              ? { ...event, sequence: 3 }
              : event.eventType.endsWith('.completed')
                ? { ...event, sequence: 4 }
                : event,
          )
          .sort((left, right) => left.sequence - right.sequence),
      });
      await writeDataset(directory, suite, [earlyHostRun]);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must follow its provider terminal event'),
        ]),
      );

      const hostMismatchRun = resealRun({
        ...live.run,
        sourceEvents: live.run.sourceEvents.map((event) =>
          event.correlationKind === 'host_execution'
            ? { ...event, instanceId: '30000000-0000-4000-8000-000000000099' }
            : event,
        ),
      });
      await writeDataset(directory, suite, [hostMismatchRun]);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact host plan revision')]),
      );

      const expectHostPayloadMutation = async (
        mutate: (payload: Record<string, unknown>) => void,
      ): Promise<readonly string[]> => {
        const bundle = JSON.parse(live.bundleJson) as CurrentEvalExportBundle;
        const hostEvent = bundle.events.find(
          (event) => event.eventType === 'companion.state.reported',
        );
        if (
          hostEvent === undefined ||
          hostEvent.payload === null ||
          typeof hostEvent.payload !== 'object' ||
          Array.isArray(hostEvent.payload)
        ) {
          throw new Error('Expected companion state payload');
        }
        mutate(hostEvent.payload as Record<string, unknown>);
        const sealed = resealBundle(bundle);
        const changedRun = resealRun({
          ...live.run,
          sourceEvents: live.run.sourceEvents.map((event) =>
            event.eventId === hostEvent.id
              ? {
                  ...event,
                  payloadSha256: computeHumanEvalContentSha256(hostEvent.payload),
                }
              : event,
          ),
          artifacts: live.run.artifacts.map((artifact) => ({
            ...artifact,
            contentSha256: bytesSha256(sealed.json),
          })),
        });
        await writeDataset(directory, suite, [changedRun]);
        await writeFile(join(directory, 'eval-export.json'), sealed.json);
        return artifactIssues(() => loadHumanEvalDatasetDirectory(directory));
      };

      expect(
        await expectHostPayloadMutation((payload) => {
          const plan = payload['plan'] as Record<string, unknown>;
          plan['revision'] = sourceRun.outcome.result.draft.plan.revision + 1;
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('exact host plan revision')]));
      expect(
        await expectHostPayloadMutation((payload) => {
          payload['hostVersion'] = '999.0.0';
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('exact host plan revision')]));
      expect(
        await expectHostPayloadMutation((payload) => {
          payload['companionVersion'] = '999.0.0';
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('exact host plan revision')]));

      const wrongFingerprintBundle = JSON.parse(live.bundleJson) as CurrentEvalExportBundle;
      (wrongFingerprintBundle.events[1]!.payload as Record<string, unknown>)['requestFingerprint'] =
        '0'.repeat(64);
      const wrongFingerprint = resealBundle(wrongFingerprintBundle);
      const wrongFingerprintRun = resealRun({
        ...live.run,
        sourceEvents: live.run.sourceEvents.map((event) =>
          event.sequence === 2
            ? {
                ...event,
                payloadSha256: computeHumanEvalContentSha256(
                  wrongFingerprint.bundle.events[1]!.payload,
                ),
              }
            : event,
        ),
        artifacts: live.run.artifacts.map((artifact) => ({
          ...artifact,
          contentSha256: bytesSha256(wrongFingerprint.json),
        })),
      });
      await writeDataset(directory, suite, [wrongFingerprintRun]);
      await writeFile(join(directory, 'eval-export.json'), wrongFingerprint.json);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('exact completed run outcome')]),
      );

      const wrongCatalogBundle = JSON.parse(live.bundleJson) as CurrentEvalExportBundle;
      wrongCatalogBundle.catalogs[0]!.adapterVersionRange = '>=999.0.0';
      const wrongCatalog = resealBundle(wrongCatalogBundle);
      const wrongCatalogRun = resealRun({
        ...live.run,
        artifacts: live.run.artifacts.map((artifact) => ({
          ...artifact,
          contentSha256: bytesSha256(wrongCatalog.json),
        })),
      });
      await writeDataset(directory, suite, [wrongCatalogRun]);
      await writeFile(join(directory, 'eval-export.json'), wrongCatalog.json);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([expect.stringContaining('does not contain the exact catalog')]),
      );

      const conflictingTerminalBundle = JSON.parse(live.bundleJson) as CurrentEvalExportBundle;
      conflictingTerminalBundle.events.push({
        sequence: 4,
        id: 'planning-failed-conflict',
        eventType: 'planning.provider.generation.failed',
        payload: {
          requestId,
          requestFingerprint,
          providerId: sourceRun.profile.descriptor.id,
          providerVersion: sourceRun.profile.descriptor.version,
          targetAdapterId: sourceRun.environment.targetAdapterId,
          catalogVersion: sourceRun.environment.catalogVersion,
          planId: sourceRun.invocation.packet.context.requestedPlanId,
          error: 'planner_provider_failed',
          durationMs: 2_000,
          occurredAt: '2026-08-05T00:00:02.000Z',
        },
        createdAt: '2026-08-05T00:00:02.000Z',
      });
      conflictingTerminalBundle.page.snapshotUpperSequence = 4;
      conflictingTerminalBundle.page.nextAfterSequence = 4;
      conflictingTerminalBundle.summary.matchedEventCount = 4;
      conflictingTerminalBundle.summary.eventTypeCounts['planning.provider.generation.failed'] = 1;
      const conflictingTerminal = resealBundle(conflictingTerminalBundle);
      const conflictingTerminalRun = resealRun({
        ...live.run,
        sourceEvidence: {
          ...live.run.sourceEvidence,
          snapshotUpperSequence: 4,
        },
        artifacts: live.run.artifacts.map((artifact) => ({
          ...artifact,
          contentSha256: bytesSha256(conflictingTerminal.json),
        })),
      });
      await writeDataset(directory, suite, [conflictingTerminalRun]);
      await writeFile(join(directory, 'eval-export.json'), conflictingTerminal.json);
      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('exactly the summarized provider request and matching terminal'),
        ]),
      );

      const tamperedBundle = JSON.parse(live.bundleJson) as CurrentEvalExportBundle;
      tamperedBundle.events[1]!.payload = {
        ...(tamperedBundle.events[1]!.payload as Record<string, unknown>),
        tampered: true,
      };
      const tamperedJson = JSON.stringify(tamperedBundle);
      const tamperedRun = resealRun({
        ...live.run,
        artifacts: live.run.artifacts.map((artifact) => ({
          ...artifact,
          contentSha256: bytesSha256(tamperedJson),
        })),
      });
      await writeDataset(directory, suite, [tamperedRun]);
      await writeFile(join(directory, 'eval-export.json'), tamperedJson);

      expect(await artifactIssues(() => loadHumanEvalDatasetDirectory(directory))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('integrity mismatch'),
          expect.stringContaining('does not match its Eval export evidence'),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
