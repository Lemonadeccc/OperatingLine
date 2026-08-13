import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runIntent(status: unknown): Promise<{ output: string; stdout: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'operating-line-release-intent-'));
  const statusPath = join(directory, 'status.json');
  const outputPath = join(directory, 'github-output');
  await writeFile(statusPath, JSON.stringify(status), 'utf8');
  const result = await execFileAsync(
    'pnpm',
    ['exec', 'tsx', 'tools/release/report-intent.ts', statusPath],
    {
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    },
  );
  return { output: await readFile(outputPath, 'utf8'), stdout: result.stdout };
}

async function runInvalidIntent(
  statusSource: string,
  githubOutput: string | undefined,
): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'operating-line-release-intent-invalid-'));
  const statusPath = join(directory, 'status.json');
  await writeFile(statusPath, statusSource, 'utf8');
  try {
    await execFileAsync('pnpm', ['exec', 'tsx', 'tools/release/report-intent.ts', statusPath], {
      env: { ...process.env, GITHUB_OUTPUT: githubOutput },
    });
  } catch (error) {
    return error;
  }
  throw new Error('report-intent unexpectedly accepted invalid input');
}

describe('release intent reporter', () => {
  it('skips an empty or empty-only changeset plan', async () => {
    const result = await runIntent({ changesets: [{ id: 'docs', releases: [] }], releases: [] });

    expect(result.output).toBe('has-release-entries=false\n');
    expect(result.stdout).toContain('version action will be skipped');
  });

  it('enables versioning when the status includes a release entry', async () => {
    const result = await runIntent({
      changesets: [{ id: 'api', releases: [{ name: '@operatingline/protocol', type: 'minor' }] }],
      releases: [{ name: '@operatingline/protocol', type: 'minor', newVersion: '0.2.0' }],
    });

    expect(result.output).toBe('has-release-entries=true\n');
    expect(result.stdout).toContain('Detected 1 release entries');
  });

  it.each([
    ['invalid JSON', '{', join(tmpdir(), 'operating-line-invalid-json-output')],
    [
      'a missing releases array',
      JSON.stringify({ changesets: [] }),
      join(tmpdir(), 'operating-line-missing-releases-output'),
    ],
    [
      'a non-array releases value',
      JSON.stringify({ releases: true }),
      join(tmpdir(), 'operating-line-invalid-releases-output'),
    ],
    ['a missing GitHub output path', JSON.stringify({ releases: [] }), undefined],
  ])('fails closed for %s', async (_description, statusSource, githubOutput) => {
    await expect(runInvalidIntent(statusSource, githubOutput)).resolves.toMatchObject({ code: 1 });
  });
});
