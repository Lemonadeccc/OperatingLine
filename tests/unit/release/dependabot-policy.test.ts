import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

interface DependabotUpdate {
  readonly 'package-ecosystem'?: unknown;
  readonly groups?: unknown;
  readonly ignore?: unknown;
  readonly labels?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

describe('Dependabot policy', () => {
  it('groups compatible npm updates and defers the known-incompatible TypeScript major', async () => {
    const source = await readFile(resolve(repositoryRoot, '.github/dependabot.yml'), 'utf8');
    const config = record(parse(source));
    expect(config.version).toBe(2);
    expect(config.updates).toBeInstanceOf(Array);

    const updates = config.updates as DependabotUpdate[];
    const npm = updates.find((update) => update['package-ecosystem'] === 'npm');
    expect(npm).toBeDefined();
    expect(npm?.labels).toBeUndefined();

    const groups = record(npm?.groups);
    expect(record(groups['development-dependencies'])).toMatchObject({
      'dependency-type': 'development',
      'update-types': ['minor', 'patch'],
    });
    expect(record(groups['production-dependencies'])).toMatchObject({
      'dependency-type': 'production',
      'update-types': ['minor', 'patch'],
    });
    expect(npm?.ignore).toEqual([
      {
        'dependency-name': 'typescript',
        'update-types': ['version-update:semver-major'],
      },
    ]);
  });

  it('uses Dependabot-managed default labels for every ecosystem', async () => {
    const source = await readFile(resolve(repositoryRoot, '.github/dependabot.yml'), 'utf8');
    const config = record(parse(source));
    const updates = config.updates as DependabotUpdate[];

    expect(updates).toHaveLength(2);
    expect(updates.every((update) => update.labels === undefined)).toBe(true);
  });
});
