import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeHumanEvalContentSha256 } from '@operatingline/eval-kit';
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
});
