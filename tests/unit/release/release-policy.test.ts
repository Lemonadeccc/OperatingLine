import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discoverPhaseZeroManifestCandidates,
  loadPhaseZeroReleasePolicyInput,
  type PhaseZeroReleasePolicyInput,
  validatePhaseZeroReleasePolicy,
} from '../../../tools/release/policy.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

function cloneInput(input: PhaseZeroReleasePolicyInput): PhaseZeroReleasePolicyInput {
  return structuredClone(input);
}

describe('Phase 0 release policy', () => {
  it('accepts the checked-in private version-PR configuration', async () => {
    const input = await loadPhaseZeroReleasePolicyInput(repositoryRoot);

    expect(validatePhaseZeroReleasePolicy(input)).toEqual([]);
    expect(input.manifests).toHaveLength(18);
  });

  it('rejects a missing or additional manifest before Changesets can see it', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const missing = { ...input, manifests: input.manifests.slice(1) };
    const additional = {
      ...input,
      manifests: [
        ...input.manifests,
        {
          path: 'adapters/_future/catalog/package.json',
          manifest: { name: '@operatingline/future-catalog', private: true },
          symbolicLink: false,
        },
      ],
    };

    expect(validatePhaseZeroReleasePolicy(missing)).toContain(
      'package manifest paths must match the audited Phase 0 allowlist',
    );
    expect(validatePhaseZeroReleasePolicy(additional)).toContain(
      'package manifest paths must match the audited Phase 0 allowlist',
    );
  });

  it('rejects a workspace package reached through a symbolic link', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const manifest = input.manifests[0];
    expect(manifest).toBeDefined();
    Object.assign(manifest as object, { symbolicLink: true });

    expect(validatePhaseZeroReleasePolicy(input)).toContain(
      `${manifest?.path ?? 'manifest'} must not be reached through a symbolic link`,
    );
  });

  it('discovers underscored adapters and reports package-directory symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operating-line-release-policy-'));
    await Promise.all([
      mkdir(join(root, 'packages', 'real'), { recursive: true }),
      mkdir(join(root, 'services'), { recursive: true }),
      mkdir(join(root, 'adapters', '_future', 'catalog'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'package.json'), '{}', 'utf8'),
      writeFile(join(root, 'packages', 'real', 'package.json'), '{}', 'utf8'),
      writeFile(join(root, 'adapters', '_future', 'catalog', 'package.json'), '{}', 'utf8'),
      symlink('real', join(root, 'packages', 'linked')),
    ]);

    await expect(discoverPhaseZeroManifestCandidates(root)).resolves.toEqual(
      expect.arrayContaining([
        {
          path: 'adapters/_future/catalog/package.json',
          symbolicLink: false,
        },
        { path: 'packages/linked/package.json', symbolicLink: true },
      ]),
    );
  });

  it('rejects a package that becomes publishable before the policy is upgraded', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const manifest = input.manifests[1]?.manifest;
    expect(manifest).toBeTypeOf('object');
    Object.assign(manifest as object, {
      private: false,
      publishConfig: { access: 'public' },
    });

    expect(validatePhaseZeroReleasePolicy(input)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must remain private in Phase 0'),
        expect.stringContaining('must not declare publishConfig in Phase 0'),
      ]),
    );
  });

  it('rejects tagging private packages', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const config = input.config as { privatePackages: { tag: boolean } };
    config.privatePackages.tag = true;

    expect(validatePhaseZeroReleasePolicy(input)).toContain(
      'private packages may be versioned but must never be tagged',
    );
  });

  it('rejects unreviewed Changesets configuration keys', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    Object.assign(input.config as object, { snapshot: { useCalculatedVersion: true } });

    expect(validatePhaseZeroReleasePolicy(input)).toContain(
      'Changesets configuration must contain only the audited Phase 0 keys',
    );
  });

  it.each([
    ['id-token: write', 'OIDC write permission'],
    ['NODE_AUTH_TOKEN: secret', 'registry token'],
    ['token: ${{ secrets.RELEASE_TOKEN }}', 'repository or environment secret'],
    ['uses: changesets/action/publish@deadbeef', 'Changesets publish action'],
    ['uses: changesets/action/select-mode@deadbeef', 'artifact-uploading Changesets mode action'],
    ['publish-script: pnpm release', 'Changesets publish script'],
    ['run: pnpm changeset publish', 'Changesets publish command'],
    ['create-github-releases: true', 'GitHub Release creation'],
    ['uses: actions/upload-artifact@deadbeef', 'artifact upload'],
  ])('rejects publication capability %s', async (fragment, description) => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = { ...input, workflow: `${input.workflow}\n# ${fragment}\n` };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      `release workflow must not contain ${description}`,
    );
  });

  it('requires every version pull request update to return to draft', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace('pr-draft: always', 'pr-draft: create'),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'version job must end with the pinned intent-gated Changesets action without publishing',
    );
  });

  it('requires non-empty release intent before running the Changesets action', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace(
        "if: steps.intent.outputs.has-release-entries == 'true'",
        'if: always()',
      ),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'version job must end with the pinned intent-gated Changesets action without publishing',
    );
  });

  it('does not allow package-script aliases in the write-permission job', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow
        .replace('pnpm exec tsx tools/release/check-policy.ts', 'pnpm release:check')
        .replace('pnpm exec changeset status', 'pnpm changeset status'),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toEqual(
      expect.arrayContaining([
        'version must invoke the release policy directly before Changesets',
        'version must detect non-empty release intent locally without package-script aliases',
      ]),
    );
  });

  it('disables dependency lifecycle scripts in the write-permission job', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace(' --ignore-scripts', ''),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'version install step must use the frozen lockfile without lifecycle scripts',
    );
  });

  it('keeps release preparation inert while main is unprotected', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace('if: github.ref_protected == true', 'if: always()'),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'version job must remain inert until main is protected',
    );
  });

  it('requires CI when the draft version PR is marked ready', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      ciWorkflow: input.ciWorkflow.replace(', ready_for_review', ''),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'CI must run when a maintainer marks the draft version PR ready for review',
    );
  });

  it('rejects an additional workflow job even when it has no explicit permissions', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace(
        '\n  version:',
        '\n  unexpected:\n    runs-on: ubuntu-latest\n    steps: []\n\n  version:',
      ),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'release workflow must contain only the guarded version job',
    );
  });

  it('rejects unreviewed workflow-level defaults or environment variables', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const unsafe = {
      ...input,
      workflow: input.workflow.replace(
        '\npermissions: {}',
        '\nenv:\n  SAFE: false\n\npermissions: {}',
      ),
    };

    expect(validatePhaseZeroReleasePolicy(unsafe)).toContain(
      'release workflow must contain only the audited top-level keys',
    );
  });

  it('rejects workspace boundary expansion until it is audited', async () => {
    const input = cloneInput(await loadPhaseZeroReleasePolicyInput(repositoryRoot));
    const workspace = input.workspace as { packages: string[] };
    workspace.packages.push('experimental/*');

    expect(validatePhaseZeroReleasePolicy(input)).toContain(
      'pnpm workspace package patterns must match the audited Phase 0 boundary',
    );
  });
});
