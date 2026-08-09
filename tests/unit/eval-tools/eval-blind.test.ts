import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProviderEvalRun, loadHumanEvalDatasetDirectory } from '@operatingline/eval-kit';
import type { ProviderEvalRun } from '@operatingline/protocol';

import {
  createProviderBlindSignoff,
  runProviderBlindSignoffCli,
} from '../../../tools/eval/blind.js';
import {
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

function withPlanTitle(run: ProviderEvalRun, title: string): ProviderEvalRun {
  if (run.outcome.status !== 'completed') throw new Error('Expected a completed fixture run');
  const base = withoutKey(withoutKey(run, 'integrity'), 'comparability');
  const invocation = withoutKey(run.invocation, 'packetSha256');
  const generationSettings = withoutKey(run.generationSettings, 'parametersSha256');
  const outcome = withoutKey(run.outcome, 'resultSha256');
  return createProviderEvalRun({
    ...base,
    invocation,
    generationSettings,
    outcome: {
      ...outcome,
      result: {
        ...outcome.result,
        draft: {
          ...outcome.result.draft,
          plan: { ...outcome.result.draft.plan, title },
        },
      },
    },
    reproducibility: run.comparability.reproducibility,
  });
}

function withManualReviewImage(run: ProviderEvalRun, contentSha256: string): ProviderEvalRun {
  if (run.outcome.status !== 'completed') throw new Error('Expected a completed fixture run');
  const base = withoutKey(withoutKey(run, 'integrity'), 'comparability');
  return createProviderEvalRun({
    ...base,
    invocation: withoutKey(run.invocation, 'packetSha256'),
    generationSettings: withoutKey(run.generationSettings, 'parametersSha256'),
    outcome: withoutKey(run.outcome, 'resultSha256'),
    artifacts: [
      {
        artifactId: 'render.preview',
        kind: 'manual_review_image',
        mediaType: 'image/png',
        uri: `artifacts/sha256/${contentSha256}.png`,
        contentSha256,
        metadata: { evidenceClass: 'manual_artifact_not_runtime_bound' },
      },
    ],
    reproducibility: run.comparability.reproducibility,
  });
}

async function setup(runTransform?: (run: ProviderEvalRun) => ProviderEvalRun) {
  const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-blind-'));
  temporaryDirectories.push(directory);
  const suite = buildHumanEvalSuiteFixture();
  const original = buildProviderEvalRunFixture(suite);
  const run = runTransform?.(original) ?? original;
  await mkdir(join(directory, 'runs'));
  await writeFile(join(directory, 'suite.json'), JSON.stringify(suite));
  await writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run));
  return { directory, suite, run };
}

describe('Provider-blind preparation command', () => {
  it('seals one private sidecar for the exact verified review surface', async () => {
    const { directory, run } = await setup();
    const signoff = await createProviderBlindSignoff({
      datasetDirectory: directory,
      runId: run.runId,
      preparedBy: 'blind.preparer',
      supplementalAliases: ['ChatGPT'],
      reviewedImageContentSha256: [],
      assertion: 'no_provider_identity_visible',
      now: () => new Date('2026-08-09T00:00:00.000Z'),
    });
    const path = join(directory, 'blind-signoffs', `${run.runId}.provider-blind.json`);

    expect(signoff).toMatchObject({
      runId: run.runId,
      supplementalAliases: ['ChatGPT'],
      assertion: 'no_provider_identity_visible',
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      integrity: { contentSha256: signoff.integrity.contentSha256 },
    });
    expect((await loadHumanEvalDatasetDirectory(directory)).blindSignoffs).toHaveLength(1);
    if (process.platform !== 'win32') {
      expect((await stat(join(directory, 'blind-signoffs'))).mode & 0o777).toBe(0o700);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await expect(
      createProviderBlindSignoff({
        datasetDirectory: directory,
        runId: run.runId,
        preparedBy: 'another.preparer',
        supplementalAliases: [],
        reviewedImageContentSha256: [],
        assertion: 'no_provider_identity_visible',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('refuses to sign a surface containing a declared Provider alias', async () => {
    const { directory, run } = await setup((source) => withPlanTitle(source, 'Made by CHATGPT'));
    await expect(
      createProviderBlindSignoff({
        datasetDirectory: directory,
        runId: run.runId,
        preparedBy: 'blind.preparer',
        supplementalAliases: ['ChatGPT'],
        reviewedImageContentSha256: [],
        assertion: 'no_provider_identity_visible',
      }),
    ).rejects.toThrow(/identity marker/);
    await expect(stat(join(directory, 'blind-signoffs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires an explicit human assertion in the CLI', async () => {
    const { directory, run } = await setup();
    const aliasesPath = join(directory, 'aliases.json');
    await writeFile(aliasesPath, '[]');
    await expect(
      runProviderBlindSignoffCli([
        '--dataset',
        directory,
        '--run',
        run.runId,
        '--prepared-by',
        'blind.preparer',
        '--aliases',
        aliasesPath,
        '--assert',
        'yes',
      ]),
    ).rejects.toThrow(/exactly no_provider_identity_visible/);
  });

  it('requires a hash-bound visible-pixel review for every rendered image', async () => {
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const imageHash = createHash('sha256').update(imageBytes).digest('hex');
    const { directory, run } = await setup((source) => withManualReviewImage(source, imageHash));
    const artifactDirectory = join(directory, 'artifacts', 'sha256');
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(join(artifactDirectory, `${imageHash}.png`), imageBytes);

    const options = {
      datasetDirectory: directory,
      runId: run.runId,
      preparedBy: 'blind.preparer',
      supplementalAliases: [] as readonly string[],
      assertion: 'no_provider_identity_visible' as const,
    };
    await expect(
      createProviderBlindSignoff({ ...options, reviewedImageContentSha256: [] }),
    ).rejects.toThrow(/every exact rendered image SHA-256/);
    await expect(
      createProviderBlindSignoff({
        ...options,
        reviewedImageContentSha256: ['f'.repeat(64)],
      }),
    ).rejects.toThrow(/every exact rendered image SHA-256/);

    const aliasesPath = join(directory, 'aliases.json');
    await writeFile(aliasesPath, '[]');
    const signoff = await runProviderBlindSignoffCli([
      '--dataset',
      directory,
      '--run',
      run.runId,
      '--prepared-by',
      'blind.preparer',
      '--aliases',
      aliasesPath,
      '--assert',
      'no_provider_identity_visible',
      '--reviewed-image-sha256',
      imageHash,
    ]);
    expect(signoff.renderedArtifacts).toEqual([
      {
        artifactId: 'render.preview',
        mediaType: 'image/png',
        contentSha256: imageHash,
        visiblePixelsReviewed: true,
      },
    ]);
  });
});
