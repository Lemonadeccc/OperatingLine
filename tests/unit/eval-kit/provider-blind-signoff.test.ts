import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildHumanEvalComparisonReport,
  buildProviderBlindReviewSurface,
  contentWithoutIntegrity,
  createHumanEvalIntegrity,
  deriveProviderIdentityMarkers,
  HumanEvalDatasetError,
  loadHumanEvalDatasetDirectory,
  normalizeProviderIdentityText,
  scanProviderIdentity,
  sealProviderBlindSignoffV1,
  validateHumanEvalDataset,
} from '@operatingline/eval-kit';

import {
  buildHumanEvalAnnotationFixture,
  buildProviderBlindSignoffFixture,
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

function fixture() {
  const suite = buildHumanEvalSuiteFixture();
  const run = buildProviderEvalRunFixture(suite);
  const signoff = buildProviderBlindSignoffFixture(suite, run, {
    supplementalAliases: ['ChatGPT'],
  });
  return { suite, run, signoff };
}

function issues(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HumanEvalDatasetError);
    return (error as HumanEvalDatasetError).issues;
  }
  throw new Error('Expected provider-blind validation to fail');
}

describe('provider-blind sign-off', () => {
  it('builds one session-independent surface and accepts an exact sign-off', () => {
    const { suite, run, signoff } = fixture();
    const annotation = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000001',
    );
    const dataset = validateHumanEvalDataset({
      suite,
      runs: [run],
      annotations: [annotation],
      blindSignoffs: [signoff],
    });

    expect(dataset.blindSignoffsByRunId.get(run.runId)).toEqual(signoff);
    expect(buildProviderBlindReviewSurface(suite, run)).not.toHaveProperty('profile');
  });

  it('requires a sign-off for annotated runs and rejects tampering', () => {
    const { suite, run, signoff } = fixture();
    const annotation = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '20000000-0000-4000-8000-000000000001',
    );
    expect(
      issues(() => validateHumanEvalDataset({ suite, runs: [run], annotations: [annotation] })),
    ).toContainEqual(expect.stringContaining('requires a provider-blind sign-off'));

    const tampered = { ...signoff, projectionContentSha256: 'f'.repeat(64) };
    const tamperIssues = issues(() =>
      validateHumanEvalDataset({
        suite,
        runs: [run],
        annotations: [annotation],
        blindSignoffs: [tampered],
      }),
    );
    expect(tamperIssues).toContainEqual(expect.stringContaining('integrity mismatch'));
    expect(tamperIssues).toContainEqual(expect.stringContaining('projection hash mismatch'));
  });

  it('rejects independently re-sealed sign-offs bound to the wrong run or image set', () => {
    const { suite, run, signoff } = fixture();
    const withoutIntegrity = contentWithoutIntegrity(signoff);
    const wrongRun = sealProviderBlindSignoffV1({
      ...withoutIntegrity,
      runContentSha256: 'a'.repeat(64),
    });
    expect(
      issues(() => validateHumanEvalDataset({ suite, runs: [run], blindSignoffs: [wrongRun] })),
    ).toContainEqual(expect.stringContaining('does not match its exact run evidence'));

    const wrongImages = sealProviderBlindSignoffV1({
      ...withoutIntegrity,
      renderedArtifacts: [
        {
          artifactId: 'unrelated.image',
          mediaType: 'image/png',
          contentSha256: 'b'.repeat(64),
          visiblePixelsReviewed: true,
        },
      ],
    });
    expect(
      issues(() => validateHumanEvalDataset({ suite, runs: [run], blindSignoffs: [wrongImages] })),
    ).toContainEqual(expect.stringContaining('rendered artifact set does not match'));
  });

  it('normalizes NFKC and case, preserves short o1/o3 aliases, and scans supplemental aliases', () => {
    const { run } = fixture();
    const profile = structuredClone(run.profile);
    profile.model.requested = 'Ｏ１';
    profile.model.resolvedRevision = 'O3';
    const markers = deriveProviderIdentityMarkers(profile, ['ChatGPT']);

    expect(normalizeProviderIdentityText('  ＣｈａｔＧＰＴ\n ')).toBe('chatgpt');
    expect(markers).toEqual(expect.arrayContaining(['o1', 'o3', 'chatgpt']));
    expect(scanProviderIdentity(['Used CHATGPT output.'], markers)).toEqual({
      hasProviderIdentity: true,
    });
  });

  it('rejects alias leakage and a reviewer who prepared the blind surface', () => {
    const { suite, run, signoff } = fixture();
    const annotation = structuredClone(
      buildHumanEvalAnnotationFixture(
        suite,
        run,
        'blind.preparer',
        '20000000-0000-4000-8000-000000000001',
      ),
    );
    annotation.review.judgments[0]!.rationale = 'Reviewed with ＣｈａｔＧＰＴ.';
    const content = contentWithoutIntegrity(annotation);
    annotation.integrity = createHumanEvalIntegrity(content);
    const found = issues(() =>
      validateHumanEvalDataset({
        suite,
        runs: [run],
        annotations: [annotation],
        blindSignoffs: [signoff],
      }),
    );

    expect(found).toContainEqual(
      expect.stringContaining('independent from the blind-surface preparer'),
    );
    expect(found).toContainEqual(
      expect.stringContaining('free text contains a provider identity marker'),
    );
    expect(found.join('\n')).not.toContain('chatgpt');
  });

  it('loads provider-blind sidecars and includes them in artifact verification', async () => {
    const { suite, run, signoff } = fixture();
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-provider-blind-'));
    try {
      await Promise.all(
        ['runs', 'annotations', 'adjudications', 'blind-signoffs'].map((name) =>
          mkdir(join(directory, name), { recursive: true }),
        ),
      );
      await Promise.all([
        writeFile(join(directory, 'suite.json'), JSON.stringify(suite)),
        writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run)),
        writeFile(
          join(directory, 'blind-signoffs', `${run.runId}.provider-blind.json`),
          JSON.stringify(signoff),
        ),
      ]);

      const loaded = await loadHumanEvalDatasetDirectory(directory);
      expect(loaded.verificationLevel).toBe('artifact_verified');
      expect(loaded.blindSignoffsByRunId.get(run.runId)).toEqual(signoff);
      (loaded.blindSignoffs[0]!.supplementalAliases as string[]).push('tampered-alias');
      expect(() =>
        buildHumanEvalComparisonReport(loaded, {
          generatedAt: '2026-08-09T12:00:00+08:00',
        }),
      ).toThrow('Published comparison requires verified artifacts');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked record directory outside the dataset', async () => {
    if (process.platform === 'win32') return;
    const { suite, run } = fixture();
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-provider-blind-links-'));
    const outside = await mkdtemp(join(tmpdir(), 'operatingline-provider-blind-outside-'));
    try {
      await writeFile(join(directory, 'suite.json'), JSON.stringify(suite));
      await writeFile(join(outside, `${run.runId}.run.json`), JSON.stringify(run));
      await symlink(outside, join(directory, 'runs'), 'dir');

      await expect(loadHumanEvalDatasetDirectory(directory)).rejects.toThrow(
        /record directory runs must be physical/,
      );
    } finally {
      await Promise.all([
        rm(directory, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});
