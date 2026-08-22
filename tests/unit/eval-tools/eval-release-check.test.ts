import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseEvalReleaseCheckCliOptions,
  runEvalReleaseCheckCli,
} from '../../../tools/eval/release-check-cli.js';

describe('Eval release check CLI', () => {
  it('defaults to the repository collecting fixture without claiming a release', async () => {
    const result = await runEvalReleaseCheckCli([]);

    expect(result).toEqual({
      formatVersion: '1.0.0',
      releaseEligible: false,
      releasePerformed: false,
      trainingUse: 'not_authorized',
      releaseCandidateManifestSha256: null,
      manifest: null,
      issues: expect.arrayContaining([expect.stringMatching(/released/i)]),
    });
  });

  it('parses one dataset and one explicit repository artifact root', () => {
    expect(parseEvalReleaseCheckCliOptions(['fixtures', '--repo-root', 'repository'])).toEqual({
      datasetDirectory: resolve('fixtures'),
      repoRoot: resolve('repository'),
    });
    expect(parseEvalReleaseCheckCliOptions(['--repo-root', 'repository'])).toEqual({
      datasetDirectory: resolve('repository/protocol/fixtures/v1/eval/blender-core'),
      repoRoot: resolve('repository'),
    });
  });

  it('rejects ambiguous or incomplete arguments', () => {
    expect(() =>
      parseEvalReleaseCheckCliOptions(['--repo-root', 'one', '--repo-root', 'two']),
    ).toThrow(/Duplicate/);
    expect(() => parseEvalReleaseCheckCliOptions(['--repo-root'])).toThrow(/requires a directory/);
    expect(() => parseEvalReleaseCheckCliOptions(['--unknown'])).toThrow(/Unknown/);
    expect(() => parseEvalReleaseCheckCliOptions(['one', 'two'])).toThrow(/at most one/);
  });
});
