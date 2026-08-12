import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeHumanEvalContentSha256, computePlanContentSha256 } from '@operatingline/eval-kit';
import type { CurrentEvalExportBundle, EvalExecutionEvent } from '@operatingline/protocol';

import { captureProviderEvalRun } from '../../../tools/eval/capture.js';
import {
  parseEvalManifestCliOptions,
  runEvalManifestCli,
  writeEvalCaptureManifestAtomicExclusive,
} from '../../../tools/eval/manifest.js';
import type { EvalCaptureManifestV1 } from '../../../tools/eval/capture.js';
import {
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const roots: string[] = [];
const snapshotId = '43000000-0000-4000-8000-000000000001';
const hostExecutionId = '43000000-0000-4000-8000-000000000030';
const hostReportId = '43000000-0000-4000-8000-000000000032';

function argumentsFor(overrides: readonly string[] = []): string[] {
  return [
    '--suite',
    'suite.json',
    '--snapshot',
    'snapshot',
    '--case',
    'case.exact',
    '--request',
    '10000000-0000-4000-8000-000000000001',
    '--run',
    '10000000-0000-4000-8000-000000000002',
    '--replicate',
    '1',
    '--recorder-name',
    'offline-manifest-test',
    '--recorder-version',
    '1.0.0',
    '--operating-line-version',
    '0.1.0',
    '--source-commit',
    'none',
    '--out-root',
    '.',
    '--out',
    'capture.json',
    ...overrides,
  ];
}

function replaceArgument(arguments_: readonly string[], name: string, value: string): string[] {
  const next = [...arguments_];
  const index = next.indexOf(name);
  if (index === -1) throw new Error(`Missing test argument ${name}`);
  next[index + 1] = value;
  return next;
}

const manifest = {
  formatVersion: '1.0.0',
  captureMode: 'provider_only',
  suiteId: 'suite',
  suiteVersion: '1.0.0',
  caseId: 'case.exact',
  generationRequestId: '10000000-0000-4000-8000-000000000001',
  runId: '10000000-0000-4000-8000-000000000002',
  replicateIndex: 1,
  parentRunId: null,
  profile: {},
  generationSettings: {},
  reproducibility: 'best_effort',
  treatmentAttestation: {
    evidenceClass: 'runtime_attested',
    assertion: 'profile_and_settings_match_runtime_evidence',
  },
  provenance: {},
  environment: {},
} as unknown as EvalCaptureManifestV1;

function runtimeAttestedState() {
  const suite = buildHumanEvalSuiteFixture();
  const source = buildProviderEvalRunFixture(suite);
  if (source.invocation.operation !== 'initial_plan' || source.outcome.status !== 'completed') {
    throw new Error('Expected a completed initial-plan fixture');
  }
  const request = source.invocation.request;
  const requestFingerprint = computeHumanEvalContentSha256(request);
  const treatment = { profile: source.profile, generationSettings: source.generationSettings };
  const runtimeTreatment = {
    formatVersion: '1.0.0' as const,
    evidenceClass: 'runtime_attested_provider_treatment' as const,
    operation: 'initial_plan' as const,
    treatment,
    treatmentSha256: computeHumanEvalContentSha256(treatment),
  };
  const events: EvalExecutionEvent[] = [
    {
      sequence: 1,
      id: 'manifest.prompt',
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
      id: 'manifest.requested',
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
        runtimeTreatment,
        occurredAt: source.timing.startedAt,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 3,
      id: 'manifest.completed',
      eventType: 'planning.provider.generation.completed',
      payload: {
        request,
        requestFingerprint,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        result: source.outcome.result,
        runtimeAttestation: {
          formatVersion: '1.0.0',
          evidenceClass: 'runtime_attested_provider_output',
          operation: 'initial_plan',
          requestId: request.requestId,
          requestFingerprint,
          packetSha256: computeHumanEvalContentSha256(source.invocation.packet),
          outputSha256: computeHumanEvalContentSha256(source.outcome.result.draft),
          treatment: runtimeTreatment,
          occurredAt: source.outcome.result.generatedAt,
        },
      },
      createdAt: source.timing.completedAt,
    },
  ];
  const eventTypeCounts: Record<string, number> = {};
  for (const event of events) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
  }
  const content = {
    protocolVersion: source.environment.protocolVersion,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: source.environment.targetAdapterId,
      planId: request.planId,
      instanceId: null,
    },
    catalogs: [source.invocation.packet.context.catalog],
    events,
    page: {
      snapshotId,
      snapshotUpperSequence: 3,
      afterSequence: 0,
      nextAfterSequence: 3,
      hasMore: false,
    },
    summary: {
      matchedEventCount: events.length,
      eventTypeCounts,
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Synthetic frozen export fixture.',
    },
  };
  const page: CurrentEvalExportBundle = {
    ...content,
    exportId: '43000000-0000-4000-8000-000000000002',
    exportedAt: '2026-08-05T00:00:02.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
  return { suite, source, page };
}

function withEvents(
  page: CurrentEvalExportBundle,
  events: readonly EvalExecutionEvent[],
  instanceId: string | null,
): CurrentEvalExportBundle {
  const { exportId, exportedAt } = page;
  const originalContent = {
    protocolVersion: page.protocolVersion,
    formatVersion: page.formatVersion,
    scope: page.scope,
    catalogs: page.catalogs,
    events: page.events,
    page: page.page,
    summary: page.summary,
    dataHandling: page.dataHandling,
  };
  const eventTypeCounts: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  for (const event of events) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
    if (event.eventType === 'companion.state.reported') {
      const transition = event.payload.transition;
      transitionCounts[transition] = (transitionCounts[transition] ?? 0) + 1;
    }
  }
  const content = {
    ...originalContent,
    protocolVersion: '1.5.0',
    scope: { ...page.scope, instanceId },
    events: [...events],
    page: {
      ...page.page,
      snapshotUpperSequence: events.at(-1)!.sequence,
      nextAfterSequence: events.at(-1)!.sequence,
    },
    summary: {
      ...page.summary,
      matchedEventCount: events.length,
      eventTypeCounts,
      transitionCounts,
    },
  };
  return {
    ...content,
    exportId,
    exportedAt,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

async function setupRuntimeAttestedHostManifestWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-host-'));
  roots.push(root);
  const datasetDirectory = join(root, 'dataset');
  const snapshotDirectory = join(root, 'snapshot');
  const inputDirectory = join(root, 'capture-input');
  await Promise.all([mkdir(datasetDirectory), mkdir(snapshotDirectory), mkdir(inputDirectory)]);

  const state = runtimeAttestedState();
  state.source.environment.protocolVersion = '1.5.0';
  if (state.source.outcome.status !== 'completed') throw new Error('Expected completed fixture');
  const plan = state.source.outcome.result.draft.plan;
  const planContentSha256 = computePlanContentSha256(plan);
  const instanceId = '43000000-0000-4000-8000-000000000031';
  const executableStepIds = plan.steps
    .filter((step) => step.action !== null)
    .map((step) => step.id);
  const finalStepId = executableStepIds.at(-1)!;
  const projectBytes = Buffer.from('runtime-attested manifest project bytes');
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const projectSha256 = createHash('sha256').update(projectBytes).digest('hex');
  const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
  const terminalEvent: Extract<
    EvalExecutionEvent,
    { readonly eventType: 'companion.state.reported' }
  > = {
    sequence: 5,
    id: 'manifest.runtime.host.completed',
    eventType: 'companion.state.reported',
    payload: {
      protocolVersion: '1.5.0',
      reportId: hostReportId,
      sequence: 1,
      adapterId: state.source.environment.targetAdapterId,
      instanceId,
      companionVersion: state.source.environment.adapterVersion,
      hostVersion: state.source.environment.hostVersion,
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256,
      executionId: hostExecutionId,
      phase: 'completed',
      activeStepId: finalStepId,
      completedStepIds: executableStepIds,
      transition: 'step_succeeded',
      stepId: finalStepId,
      observations: [],
      observationGate: null,
      artifactAttestation: {
        formatVersion: '1.0.0',
        evidenceClass: 'runtime_attested_host_artifacts',
        planContentSha256,
        executionId: hostExecutionId,
        hostProject: {
          artifactId: `host.project.${hostReportId}`,
          kind: 'host_project',
          mediaType: 'application/x-blender',
          contentSha256: projectSha256,
        },
        renderedImage: {
          artifactId: `host.render.${hostReportId}`,
          kind: 'rendered_image',
          mediaType: 'image/png',
          contentSha256: imageSha256,
          width: 1,
          height: 1,
          frame: 1,
          renderEngine: 'TEST',
          colorManagement: 'test',
          hostProjectSha256: projectSha256,
        },
      },
      error: null,
      occurredAt: '2026-08-05T00:00:02.000Z',
    },
    createdAt: '2026-08-05T00:00:02.000Z',
  };
  const publishedEvent: EvalExecutionEvent = {
    sequence: 4,
    id: 'manifest.runtime.published',
    eventType: 'guide.plan.published',
    payload: { plan },
    createdAt: '2026-08-05T00:00:01.500Z',
  };
  const suitePath = join(datasetDirectory, 'suite.json');
  const pagePath = join(snapshotDirectory, 'page-0001.eval-export.json');
  const outputPath = join(inputDirectory, 'capture.json');

  async function writeSnapshot(hostEvents: readonly EvalExecutionEvent[] = [terminalEvent]) {
    const page = withEvents(
      state.page,
      [...state.page.events, publishedEvent, ...hostEvents],
      instanceId,
    );
    await Promise.all([
      writeFile(pagePath, JSON.stringify(page)),
      writeFile(
        join(snapshotDirectory, 'snapshot.json'),
        JSON.stringify({
          formatVersion: '1.0.0',
          scope: page.scope,
          snapshotId: page.page.snapshotId,
          snapshotUpperSequence: page.page.snapshotUpperSequence,
          pages: [
            {
              filename: 'page-0001.eval-export.json',
              exportId: page.exportId,
              contentSha256: page.integrity.contentSha256,
            },
          ],
          dataHandling: {
            containsPotentiallySensitiveContent: true,
            credentialsStored: false,
            warning: 'Synthetic local snapshot.',
          },
        }),
      ),
    ]);
  }

  await Promise.all([
    writeFile(suitePath, JSON.stringify(state.suite)),
    writeFile(join(inputDirectory, 'project.blend'), projectBytes),
    writeFile(join(inputDirectory, 'render.png'), imageBytes),
  ]);
  await writeSnapshot();

  const cliArguments = [
    '--suite',
    suitePath,
    '--snapshot',
    snapshotDirectory,
    '--case',
    state.suite.cases[0]!.id,
    '--request',
    state.source.invocation.request.requestId,
    '--run',
    '43000000-0000-4000-8000-000000000040',
    '--replicate',
    '1',
    '--recorder-name',
    'offline-host-manifest-e2e',
    '--recorder-version',
    state.source.provenance.recorderVersion,
    '--operating-line-version',
    state.source.environment.operatingLineVersion,
    '--source-commit',
    'none',
    '--host-execution',
    hostExecutionId,
    '--host-report',
    hostReportId,
    '--host-project',
    'project.blend',
    '--rendered-image',
    'render.png',
    '--out-root',
    inputDirectory,
    '--out',
    outputPath,
  ];
  return {
    ...state,
    root,
    datasetDirectory,
    snapshotDirectory,
    inputDirectory,
    outputPath,
    projectSha256,
    imageSha256,
    terminalEvent,
    writeSnapshot,
    cliArguments,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Eval manifest CLI', () => {
  it('requires an explicit case and request and maps explicit null sentinels', () => {
    const parsed = parseEvalManifestCliOptions([
      ...argumentsFor(),
      '--parent-run',
      'none',
      '--vendor-request',
      'none',
    ]);
    expect(parsed.caseId).toBe('case.exact');
    expect(parsed.generationRequestId).toBe('10000000-0000-4000-8000-000000000001');
    expect(parsed.parentRunId).toBeNull();
    expect(parsed.vendorRequestId).toBeNull();
    expect(parsed.sourceCommit).toBeNull();
    expect(parsed.outputRoot).toBe('.');
    expect(() =>
      parseEvalManifestCliOptions(
        argumentsFor().filter(
          (value, index, all) => all[index - 1] !== '--case' && value !== '--case',
        ),
      ),
    ).toThrow(/--case/);
    expect(() =>
      parseEvalManifestCliOptions(
        argumentsFor().filter(
          (value, index, all) => all[index - 1] !== '--request' && value !== '--request',
        ),
      ),
    ).toThrow(/--request/);
  });

  it('rejects unknown, duplicate, malformed, and operator-only treatment options', () => {
    expect(() =>
      parseEvalManifestCliOptions([...argumentsFor(), '--request', 'duplicate']),
    ).toThrow(/Duplicate/);
    expect(() => parseEvalManifestCliOptions([...argumentsFor(), '--token-env', 'SECRET'])).toThrow(
      /Unknown/,
    );
    expect(() =>
      parseEvalManifestCliOptions([...argumentsFor(), '--reproducibility', 'best_effort']),
    ).toThrow(/Unknown/);
    const invalidCommit = argumentsFor().map((value, index, all) =>
      all[index - 1] === '--source-commit' ? 'BAD' : value,
    );
    expect(() => parseEvalManifestCliOptions(invalidCommit)).toThrow(/source-commit/);
  });

  it('requires the runtime host selector and local artifact arguments as one quartet', () => {
    const quartet = [
      '--host-execution',
      hostExecutionId,
      '--host-report',
      hostReportId,
      '--host-project',
      'project.blend',
      '--rendered-image',
      'render.png',
    ];
    for (let omitted = 0; omitted < quartet.length; omitted += 2) {
      expect(() =>
        parseEvalManifestCliOptions([
          ...argumentsFor(),
          ...quartet.filter((_, index) => index !== omitted && index !== omitted + 1),
        ]),
      ).toThrow(/provided together|all four|one quartet/i);
    }
    for (let replaced = 1; replaced < quartet.length; replaced += 2) {
      const withNone = [...quartet];
      withNone[replaced] = 'none';
      expect(() => parseEvalManifestCliOptions([...argumentsFor(), ...withNone])).toThrow(
        /non-empty/i,
      );
    }
  });

  it('writes a complete private file atomically and never overwrites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const output = join(root, 'private', 'capture.json');
    await writeEvalCaptureManifestAtomicExclusive(output, manifest, root);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(manifest);
    expect((await lstat(output)).mode & 0o777).toBe(0o600);
    await expect(
      writeEvalCaptureManifestAtomicExclusive(output, manifest, root),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('does not follow a pre-existing output symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const victim = join(root, 'victim.json');
    const output = join(root, 'capture.json');
    await writeEvalCaptureManifestAtomicExclusive(victim, manifest, root);
    await symlink(victim, output);
    await expect(
      writeEvalCaptureManifestAtomicExclusive(output, manifest, root),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(JSON.parse(await readFile(victim, 'utf8'))).toEqual(manifest);
  });

  it('rejects a symbolic link in the output ancestor chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const privateRoot = join(root, 'private');
    const outside = join(root, 'outside');
    await Promise.all([mkdir(privateRoot), mkdir(outside)]);
    await symlink(outside, join(privateRoot, 'linked'), 'dir');

    await expect(
      writeEvalCaptureManifestAtomicExclusive(
        join(privateRoot, 'linked', 'nested', 'capture.json'),
        manifest,
        privateRoot,
      ),
    ).rejects.toThrow(/non-directory link|resolves outside|escapes/);
    expect(await readdir(outside)).toEqual([]);
  });

  it('requires a physical pre-existing output root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const physicalRoot = join(root, 'physical');
    const linkedRoot = join(root, 'linked');
    await mkdir(physicalRoot);
    await symlink(physicalRoot, linkedRoot, 'dir');

    await expect(
      writeEvalCaptureManifestAtomicExclusive(
        join(linkedRoot, 'capture.json'),
        manifest,
        linkedRoot,
      ),
    ).rejects.toThrow(/--out-root.*symbolic link/);
    await expect(
      writeEvalCaptureManifestAtomicExclusive(
        join(root, 'missing', 'capture.json'),
        manifest,
        join(root, 'missing'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(physicalRoot)).toEqual([]);
  });

  it('rejects an output path outside its explicit output root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const outputRoot = join(root, 'private');
    await mkdir(outputRoot);

    await expect(
      writeEvalCaptureManifestAtomicExclusive(join(root, 'outside.json'), manifest, outputRoot),
    ).rejects.toThrow(/escapes its configured root/);
    await expect(readFile(join(root, 'outside.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a suite symlink before reading snapshot evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const suite = join(root, 'suite.json');
    const suiteLink = join(root, 'suite-link.json');
    await writeFile(suite, '{}');
    await symlink(suite, suiteLink);
    const arguments_ = argumentsFor().map((value, index, all) => {
      if (all[index - 1] === '--suite') return suiteLink;
      if (all[index - 1] === '--snapshot') return join(root, 'missing-snapshot');
      if (all[index - 1] === '--out-root') return root;
      if (all[index - 1] === '--out') return join(root, 'capture.json');
      return value;
    });
    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/symbolic link/);
  });

  it('rejects a symlinked snapshot directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const state = runtimeAttestedState();
    const suitePath = join(root, 'suite.json');
    const snapshotTarget = join(root, 'snapshot-target');
    const snapshotLink = join(root, 'snapshot-link');
    await mkdir(snapshotTarget);
    await Promise.all([
      writeFile(suitePath, JSON.stringify(state.suite)),
      symlink(snapshotTarget, snapshotLink),
    ]);
    const arguments_ = argumentsFor().map((value, index, all) => {
      if (all[index - 1] === '--suite') return suitePath;
      if (all[index - 1] === '--snapshot') return snapshotLink;
      if (all[index - 1] === '--out-root') return root;
      if (all[index - 1] === '--out') return join(root, 'capture.json');
      return value;
    });

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/--snapshot.*symbolic link/);
  });

  it('rejects a symlinked snapshot manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const state = runtimeAttestedState();
    const suitePath = join(root, 'suite.json');
    const snapshotDirectory = join(root, 'snapshot');
    const snapshotTarget = join(root, 'snapshot-target.json');
    await mkdir(snapshotDirectory);
    await Promise.all([
      writeFile(suitePath, JSON.stringify(state.suite)),
      writeFile(snapshotTarget, '{}'),
      symlink(snapshotTarget, join(snapshotDirectory, 'snapshot.json')),
    ]);
    const arguments_ = argumentsFor().map((value, index, all) => {
      if (all[index - 1] === '--suite') return suitePath;
      if (all[index - 1] === '--snapshot') return snapshotDirectory;
      if (all[index - 1] === '--out-root') return root;
      if (all[index - 1] === '--out') return join(root, 'capture.json');
      return value;
    });

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/snapshot\.json.*symbolic link/);
  });

  it('rejects a symlinked snapshot page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const state = runtimeAttestedState();
    const suitePath = join(root, 'suite.json');
    const snapshotDirectory = join(root, 'snapshot');
    const pageTarget = join(root, 'page-target.json');
    await mkdir(snapshotDirectory);
    await Promise.all([
      writeFile(suitePath, JSON.stringify(state.suite)),
      writeFile(pageTarget, JSON.stringify(state.page)),
      symlink(pageTarget, join(snapshotDirectory, 'page.json')),
      writeFile(
        join(snapshotDirectory, 'snapshot.json'),
        JSON.stringify({
          formatVersion: '1.0.0',
          scope: state.page.scope,
          snapshotId: state.page.page.snapshotId,
          snapshotUpperSequence: state.page.page.snapshotUpperSequence,
          pages: [
            {
              filename: 'page.json',
              exportId: state.page.exportId,
              contentSha256: state.page.integrity.contentSha256,
            },
          ],
          dataHandling: {
            containsPotentiallySensitiveContent: true,
            credentialsStored: false,
            warning: 'Synthetic local snapshot.',
          },
        }),
      ),
    ]);
    const arguments_ = argumentsFor().map((value, index, all) => {
      if (all[index - 1] === '--suite') return suitePath;
      if (all[index - 1] === '--snapshot') return snapshotDirectory;
      if (all[index - 1] === '--out-root') return root;
      if (all[index - 1] === '--out') return join(root, 'capture.json');
      return value;
    });

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/snapshot page 1.*symbolic link/);
  });

  it('builds a runtime-attested provider-only manifest that capture accepts end to end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operatingline-eval-manifest-'));
    roots.push(root);
    const datasetDirectory = join(root, 'dataset');
    const snapshotDirectory = join(root, 'snapshot');
    const suitePath = join(datasetDirectory, 'suite.json');
    const pagePath = join(snapshotDirectory, 'page-0001.eval-export.json');
    const outputPath = join(root, 'capture-input', 'capture.json');
    await Promise.all([
      mkdir(datasetDirectory),
      mkdir(snapshotDirectory),
      mkdir(join(root, 'capture-input')),
    ]);
    const state = runtimeAttestedState();
    await Promise.all([
      writeFile(suitePath, JSON.stringify(state.suite)),
      writeFile(pagePath, JSON.stringify(state.page)),
      writeFile(
        join(snapshotDirectory, 'snapshot.json'),
        JSON.stringify({
          formatVersion: '1.0.0',
          scope: state.page.scope,
          snapshotId: state.page.page.snapshotId,
          snapshotUpperSequence: state.page.page.snapshotUpperSequence,
          pages: [
            {
              filename: 'page-0001.eval-export.json',
              exportId: state.page.exportId,
              contentSha256: state.page.integrity.contentSha256,
            },
          ],
          dataHandling: {
            containsPotentiallySensitiveContent: true,
            credentialsStored: false,
            warning: 'Synthetic local snapshot.',
          },
        }),
      ),
    ]);
    const secret = 'provider-token-must-never-be-read-or-written';
    const previousSecret = process.env['OPERATINGLINE_TEST_PROVIDER_TOKEN'];
    process.env['OPERATINGLINE_TEST_PROVIDER_TOKEN'] = secret;
    try {
      const created = await runEvalManifestCli([
        '--suite',
        suitePath,
        '--snapshot',
        snapshotDirectory,
        '--case',
        state.suite.cases[0]!.id,
        '--request',
        state.source.invocation.request.requestId,
        '--run',
        '43000000-0000-4000-8000-000000000003',
        '--replicate',
        '1',
        '--recorder-name',
        'offline-manifest-e2e',
        '--recorder-version',
        state.source.provenance.recorderVersion,
        '--operating-line-version',
        state.source.environment.operatingLineVersion,
        '--source-commit',
        'none',
        '--out-root',
        join(root, 'capture-input'),
        '--out',
        outputPath,
      ]);
      expect(created).toMatchObject({
        captureMode: 'provider_only',
        profile: state.source.profile,
        generationSettings: {
          normalizedParameters: state.source.generationSettings.normalizedParameters,
          seed: state.source.generationSettings.seed,
          determinism: state.source.generationSettings.determinism,
        },
        reproducibility: 'best_effort',
        treatmentAttestation: { evidenceClass: 'runtime_attested' },
      });
      const bytes = await readFile(outputPath, 'utf8');
      expect(bytes).not.toContain(secret);
      expect(bytes).not.toContain('accessToken');
      expect(bytes).not.toContain('apiKey');

      const captured = await captureProviderEvalRun({
        datasetDirectory,
        snapshotDirectory,
        manifestPath: outputPath,
        repositoryRoot: root,
      });
      expect(captured.runId).toBe(created.runId);
      expect(captured.runtimeAttestation?.evidenceClass).toBe('runtime_attested_provider_output');
    } finally {
      if (previousSecret === undefined) delete process.env['OPERATINGLINE_TEST_PROVIDER_TOKEN'];
      else process.env['OPERATINGLINE_TEST_PROVIDER_TOKEN'] = previousSecret;
    }
  });

  it('derives a runtime-attested host manifest that capture accepts end to end', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();

    const created = await runEvalManifestCli(workspace.cliArguments);

    expect(created).toMatchObject({
      captureMode: 'host_execution_with_runtime_attested_artifacts',
      hostExecutionId,
      terminalHostReportId: hostReportId,
      hostProject: {
        artifactId: `host.project.${hostReportId}`,
        path: 'project.blend',
      },
      renderedImage: {
        artifactId: `host.render.${hostReportId}`,
        path: 'render.png',
      },
    });
    const captured = await captureProviderEvalRun({
      datasetDirectory: workspace.datasetDirectory,
      snapshotDirectory: workspace.snapshotDirectory,
      manifestPath: workspace.outputPath,
      repositoryRoot: workspace.root,
    });
    expect(captured.artifacts.find((artifact) => artifact.kind === 'host_project')).toMatchObject({
      artifactId: `host.project.${hostReportId}`,
      contentSha256: workspace.projectSha256,
    });
    expect(captured.artifacts.find((artifact) => artifact.kind === 'rendered_image')).toMatchObject(
      {
        artifactId: `host.render.${hostReportId}`,
        contentSha256: workspace.imageSha256,
        visualEnvironment: {
          executionId: hostExecutionId,
          terminalHostReportId: hostReportId,
        },
      },
    );
  });

  it('selects the exact report id when one execution has multiple terminal reports', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const earlier = structuredClone(workspace.terminalEvent);
    earlier.id = 'manifest.runtime.host.completed.earlier';
    earlier.payload.reportId = '43000000-0000-4000-8000-000000000033';
    earlier.payload.artifactAttestation = null;
    const selected = structuredClone(workspace.terminalEvent);
    selected.sequence = 6;
    selected.id = 'manifest.runtime.host.completed.selected';
    selected.payload.sequence = 2;
    selected.payload.occurredAt = '2026-08-05T00:00:03.000Z';
    selected.createdAt = '2026-08-05T00:00:03.000Z';
    await workspace.writeSnapshot([earlier, selected]);

    const created = await runEvalManifestCli(workspace.cliArguments);

    expect(created).toMatchObject({
      captureMode: 'host_execution_with_runtime_attested_artifacts',
      terminalHostReportId: hostReportId,
      hostProject: { artifactId: `host.project.${hostReportId}` },
      renderedImage: { artifactId: `host.render.${hostReportId}` },
    });
  });

  it('rejects a tampered local host artifact before writing the manifest', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    await writeFile(join(workspace.inputDirectory, 'project.blend'), 'tampered project bytes');

    await expect(runEvalManifestCli(workspace.cliArguments)).rejects.toThrow(
      /attestation|content|hash|match/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an attested host artifact id that collides with the final capture page id', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const terminalEvent = structuredClone(workspace.terminalEvent);
    terminalEvent.payload.artifactAttestation!.hostProject.artifactId =
      'eval.43000000-0000-4000-8000-000000000040.page.0001';
    await workspace.writeSnapshot([terminalEvent]);

    await expect(runEvalManifestCli(workspace.cliArguments)).rejects.toThrow(
      /artifact ids must be unique|artifact id.*collid|reserved artifact/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects duplicate exact terminal reports with different event identities', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const duplicate = structuredClone(workspace.terminalEvent);
    duplicate.sequence = 6;
    duplicate.id = 'manifest.runtime.host.completed.duplicate';
    duplicate.payload.sequence = 2;
    duplicate.payload.occurredAt = '2026-08-05T00:00:03.000Z';
    duplicate.createdAt = '2026-08-05T00:00:03.000Z';
    await workspace.writeSnapshot([workspace.terminalEvent, duplicate]);

    await expect(runEvalManifestCli(workspace.cliArguments)).rejects.toThrow(
      /one unique exact terminal host report/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a selected terminal report without an artifact attestation', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const terminalEvent = structuredClone(workspace.terminalEvent);
    terminalEvent.payload.artifactAttestation = null;
    await workspace.writeSnapshot([terminalEvent]);

    await expect(runEvalManifestCli(workspace.cliArguments)).rejects.toThrow(
      /terminal host attestation|artifact.*attestation|do not match/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects attested PNG dimensions that do not match the selected local image', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const terminalEvent = structuredClone(workspace.terminalEvent);
    terminalEvent.payload.artifactAttestation!.renderedImage.width = 2;
    terminalEvent.payload.artifactAttestation!.renderedImage.height = 2;
    await workspace.writeSnapshot([terminalEvent]);

    await expect(runEvalManifestCli(workspace.cliArguments)).rejects.toThrow(
      /terminal host attestation|dimensions|do not match/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an absolute host project path before writing the manifest', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const arguments_ = replaceArgument(
      workspace.cliArguments,
      '--host-project',
      join(workspace.inputDirectory, 'project.blend'),
    );

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/relative path/i);
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a host project parent-directory escape before writing the manifest', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const arguments_ = replaceArgument(
      workspace.cliArguments,
      '--host-project',
      '../project.blend',
    );

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(/escapes its configured root/i);
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a host project symlink that resolves outside the manifest directory', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const outsideProject = join(workspace.root, 'outside-project.blend');
    const linkedProject = join(workspace.inputDirectory, 'linked-project.blend');
    await writeFile(
      outsideProject,
      await readFile(join(workspace.inputDirectory, 'project.blend')),
    );
    await symlink(outsideProject, linkedProject);
    const arguments_ = replaceArgument(
      workspace.cliArguments,
      '--host-project',
      'linked-project.blend',
    );

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(
      /resolves outside its configured root/i,
    );
    await expect(readFile(workspace.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a manifest output ancestor that physically escapes out-root through a symlink', async () => {
    const workspace = await setupRuntimeAttestedHostManifestWorkspace();
    const outsideDirectory = join(workspace.root, 'outside-output');
    const linkedDirectory = join(workspace.inputDirectory, 'linked-output');
    await mkdir(outsideDirectory);
    await Promise.all([
      writeFile(
        join(outsideDirectory, 'project.blend'),
        await readFile(join(workspace.inputDirectory, 'project.blend')),
      ),
      writeFile(
        join(outsideDirectory, 'render.png'),
        await readFile(join(workspace.inputDirectory, 'render.png')),
      ),
    ]);
    await symlink(outsideDirectory, linkedDirectory, 'dir');
    const escapedOutput = join(linkedDirectory, 'capture.json');
    const arguments_ = replaceArgument(workspace.cliArguments, '--out', escapedOutput);

    await expect(runEvalManifestCli(arguments_)).rejects.toThrow(
      /non-directory link|resolves outside|escapes/i,
    );
    await expect(readFile(escapedOutput, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(outsideDirectory)).toEqual(['project.blend', 'render.png']);
  });
});
