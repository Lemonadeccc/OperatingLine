import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { parse } from 'yaml';

export interface PackageManifestRecord {
  readonly path: string;
  readonly manifest: unknown;
  readonly symbolicLink: boolean;
}

export interface WorkspaceManifestCandidate {
  readonly path: string;
  readonly symbolicLink: boolean;
}

export interface PhaseZeroReleasePolicyInput {
  readonly config: unknown;
  readonly ciWorkflow: string;
  readonly manifests: readonly PackageManifestRecord[];
  readonly workspace: unknown;
  readonly workflow: string;
}

const CHANGESETS_ACTION_SHA = '22ccf9aa43179fe9e27dc62e575971d28cce197c';
const CHECKOUT_ACTION_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const PNPM_ACTION_SHA = 'ff378ebe6b225b0680b81c1ad4498ae0d1d3a5e3';
const SETUP_NODE_ACTION_SHA = '820762786026740c76f36085b0efc47a31fe5020';

const WORKSPACE_PATTERNS = [
  'adapters/*/catalog',
  'adapters/*/bridge',
  'services/*',
  'packages/*',
] as const;

const AUDITED_MANIFESTS = [
  ['adapters/blender/bridge/package.json', '@operatingline/blender-mcp-bridge'],
  ['adapters/blender/catalog/package.json', '@operatingline/blender-action-catalog'],
  ['package.json', 'operating-line'],
  ['packages/adapter-sdk/package.json', '@operatingline/adapter-sdk'],
  ['packages/cli-planner-provider/package.json', '@operatingline/cli-planner-provider'],
  ['packages/client-setup/package.json', '@operatingline/client-setup'],
  ['packages/domain/package.json', '@operatingline/domain'],
  ['packages/eval-kit/package.json', '@operatingline/eval-kit'],
  ['packages/mcp-stdio-bridge/package.json', '@operatingline/mcp-stdio-bridge'],
  ['packages/openai-planner-provider/package.json', '@operatingline/openai-planner-provider'],
  ['packages/persistence/package.json', '@operatingline/persistence'],
  ['packages/planner-provider-sdk/package.json', '@operatingline/planner-provider-sdk'],
  ['packages/protocol/package.json', '@operatingline/protocol'],
  ['packages/test-kit/package.json', '@operatingline/test-kit'],
  ['services/cli-runtime/package.json', '@operatingline/cli-runtime'],
  ['services/eval-review/package.json', '@operatingline/eval-review'],
  ['services/openai-runtime/package.json', '@operatingline/openai-runtime'],
  ['services/orchestrator/package.json', '@operatingline/orchestrator'],
] as const;

const AUDITED_MANIFEST_PATHS = AUDITED_MANIFESTS.map(([path]) => path).sort();
const AUDITED_PACKAGE_NAMES = new Map<string, string>(
  AUDITED_MANIFESTS.map(([path, name]) => [path, name]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function addFailure(failures: string[], condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

function validatePermissions(
  failures: string[],
  value: unknown,
  expected: Readonly<Record<string, string>>,
  context: string,
): void {
  addFailure(
    failures,
    hasExactKeys(value, Object.keys(expected)) &&
      Object.entries(expected).every(([key, permission]) => value[key] === permission),
    `${context} permissions must be exactly ${JSON.stringify(expected)}`,
  );
}

function validateCommonSteps(failures: string[], value: unknown, context: string): void {
  if (!Array.isArray(value) || value.length !== 7) {
    failures.push(`${context} must contain exactly seven allowlisted steps`);
    return;
  }

  const checkout = value[0];
  addFailure(
    failures,
    hasExactKeys(checkout, ['name', 'uses', 'with']) &&
      checkout.uses === `actions/checkout@${CHECKOUT_ACTION_SHA}` &&
      hasExactKeys(checkout.with, ['fetch-depth', 'persist-credentials']) &&
      checkout.with['fetch-depth'] === 0 &&
      checkout.with['persist-credentials'] === false,
    `${context} checkout step must use the pinned action without persisted credentials`,
  );

  const pnpm = value[1];
  addFailure(
    failures,
    hasExactKeys(pnpm, ['name', 'uses', 'with']) &&
      pnpm.uses === `pnpm/action-setup@${PNPM_ACTION_SHA}` &&
      hasExactKeys(pnpm.with, ['version']) &&
      pnpm.with.version === '10.20.0',
    `${context} pnpm setup step must use the pinned repository version`,
  );

  const node = value[2];
  addFailure(
    failures,
    hasExactKeys(node, ['name', 'uses', 'with']) &&
      node.uses === `actions/setup-node@${SETUP_NODE_ACTION_SHA}` &&
      hasExactKeys(node.with, ['cache', 'cache-dependency-path', 'node-version-file']) &&
      node.with['node-version-file'] === '.nvmrc' &&
      node.with.cache === 'pnpm' &&
      node.with['cache-dependency-path'] === 'pnpm-lock.yaml',
    `${context} Node setup step must use the pinned action and repository version`,
  );

  const install = value[3];
  addFailure(
    failures,
    hasExactKeys(install, ['name', 'run']) &&
      install.run === 'pnpm install --frozen-lockfile --ignore-scripts',
    `${context} install step must use the frozen lockfile without lifecycle scripts`,
  );

  const policy = value[4];
  addFailure(
    failures,
    hasExactKeys(policy, ['name', 'run']) &&
      policy.run === 'pnpm exec tsx tools/release/check-policy.ts',
    `${context} must invoke the release policy directly before Changesets`,
  );

  const intent = value[5];
  addFailure(
    failures,
    hasExactKeys(intent, ['id', 'name', 'run']) &&
      intent.id === 'intent' &&
      intent.run ===
        'pnpm exec changeset status --output "$RUNNER_TEMP/changeset-status.json"\n' +
          'pnpm exec tsx tools/release/report-intent.ts "$RUNNER_TEMP/changeset-status.json"\n',
    `${context} must detect non-empty release intent locally without package-script aliases`,
  );
}

function validateCiWorkflow(failures: string[], source: string): void {
  let workflow: unknown;
  try {
    workflow = parse(source) as unknown;
  } catch (error) {
    failures.push(
      `CI workflow must be valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const pullRequest = isRecord(workflow) && isRecord(workflow.on) ? workflow.on.pull_request : null;
  addFailure(
    failures,
    isRecord(pullRequest) &&
      isStringArray(pullRequest.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']),
    'CI must run when a maintainer marks the draft version PR ready for review',
  );
}

function validateReleaseWorkflow(failures: string[], source: string): void {
  let workflow: unknown;
  try {
    workflow = parse(source) as unknown;
  } catch (error) {
    failures.push(
      `release workflow must be valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (!isRecord(workflow)) {
    failures.push('release workflow must contain an object');
    return;
  }

  addFailure(
    failures,
    hasExactKeys(workflow, ['concurrency', 'jobs', 'name', 'on', 'permissions']),
    'release workflow must contain only the audited top-level keys',
  );
  addFailure(
    failures,
    workflow.name === 'Release preparation / 发布准备',
    'release workflow name must remain stable',
  );

  addFailure(
    failures,
    hasExactKeys(workflow.permissions, []),
    'release workflow permissions must be disabled by default',
  );
  addFailure(
    failures,
    hasExactKeys(workflow.on, ['push']) &&
      hasExactKeys(workflow.on.push, ['branches']) &&
      isStringArray(workflow.on.push.branches, ['main']),
    'release workflow must trigger only on pushes to main',
  );
  addFailure(
    failures,
    hasExactKeys(workflow.concurrency, ['cancel-in-progress', 'group']) &&
      workflow.concurrency.group === 'release-preparation-${{ github.ref }}' &&
      workflow.concurrency['cancel-in-progress'] === false,
    'release workflow concurrency must serialize main preparation runs',
  );

  if (!hasExactKeys(workflow.jobs, ['version'])) {
    failures.push('release workflow must contain only the guarded version job');
    return;
  }

  const version = workflow.jobs.version;
  addFailure(
    failures,
    hasExactKeys(version, ['env', 'if', 'name', 'permissions', 'runs-on', 'steps']) &&
      version.if === 'github.ref_protected == true' &&
      version['runs-on'] === 'ubuntu-latest' &&
      hasExactKeys(version.env, ['HUSKY']) &&
      version.env.HUSKY === '0',
    'version job must remain inert until main is protected',
  );
  if (isRecord(version)) {
    validatePermissions(
      failures,
      version.permissions,
      { contents: 'write', 'pull-requests': 'write' },
      'version',
    );
    validateCommonSteps(failures, version.steps, 'version');
    if (Array.isArray(version.steps)) {
      const action = version.steps[6];
      addFailure(
        failures,
        hasExactKeys(action, ['if', 'name', 'uses', 'with']) &&
          action.if === "steps.intent.outputs.has-release-entries == 'true'" &&
          action.uses === `changesets/action@${CHANGESETS_ACTION_SHA}` &&
          hasExactKeys(action.with, [
            'commit-message',
            'create-github-releases',
            'pr-base-branch',
            'pr-draft',
            'pr-title',
            'push-git-tags',
          ]) &&
          action.with['commit-message'] === 'chore(release): version packages' &&
          action.with['pr-title'] === 'chore(release): version packages' &&
          action.with['pr-draft'] === 'always' &&
          action.with['pr-base-branch'] === 'main' &&
          action.with['create-github-releases'] === false &&
          action.with['push-git-tags'] === false,
        'version job must end with the pinned intent-gated Changesets action without publishing',
      );
    }
  }

  const forbiddenPatterns: readonly [RegExp, string][] = [
    [/id-token\s*:\s*write/iu, 'OIDC write permission'],
    [/(?:NPM|NODE_AUTH)_TOKEN/iu, 'registry token'],
    [/\bsecrets\s*\./iu, 'repository or environment secret'],
    [/changesets\/action\/select-mode@/iu, 'artifact-uploading Changesets mode action'],
    [/changesets\/action\/publish@/iu, 'Changesets publish action'],
    [/publish-script\s*:/iu, 'Changesets publish script'],
    [/\b(?:npm|pnpm)\s+publish\b/iu, 'registry publish command'],
    [/\bchangeset\s+publish\b/iu, 'Changesets publish command'],
    [/\bgit\s+tag\b/iu, 'Git tag command'],
    [/\bgh\s+release\b/iu, 'GitHub Release command'],
    [/create-github-releases\s*:\s*true\b/iu, 'GitHub Release creation'],
    [/push-git-tags\s*:\s*true\b/iu, 'Git tag creation'],
    [/actions\/upload-artifact@/iu, 'artifact upload'],
  ];
  for (const [pattern, description] of forbiddenPatterns) {
    addFailure(failures, !pattern.test(source), `release workflow must not contain ${description}`);
  }
}

export function validatePhaseZeroReleasePolicy(input: PhaseZeroReleasePolicyInput): string[] {
  const failures: string[] = [];
  const config = input.config;

  addFailure(failures, isRecord(config), '.changeset/config.json must contain an object');
  if (isRecord(config)) {
    addFailure(
      failures,
      hasExactKeys(config, [
        '$schema',
        'access',
        'baseBranch',
        'bumpVersionsWithWorkspaceProtocolOnly',
        'changelog',
        'commit',
        'fixed',
        'ignore',
        'linked',
        'privatePackages',
        'updateInternalDependencies',
      ]),
      'Changesets configuration must contain only the audited Phase 0 keys',
    );
    addFailure(
      failures,
      config.$schema === 'https://unpkg.com/@changesets/config@4.0.0/schema.json',
      'Changesets configuration schema must remain pinned to version 4.0.0',
    );
    addFailure(
      failures,
      config.changelog === '@changesets/cli/changelog',
      'Changesets must use the repository changelog writer',
    );
    addFailure(failures, config.commit === false, 'Changesets must not create commits locally');
    addFailure(failures, isEmptyArray(config.fixed), 'fixed release groups are not allowed');
    addFailure(failures, isEmptyArray(config.linked), 'linked release groups are not allowed');
    addFailure(failures, config.access === 'restricted', 'Phase 0 access must remain restricted');
    addFailure(failures, config.baseBranch === 'main', 'Changesets baseBranch must be main');
    addFailure(
      failures,
      config.updateInternalDependencies === 'patch',
      'internal dependency updates must use patch releases',
    );
    addFailure(
      failures,
      config.bumpVersionsWithWorkspaceProtocolOnly === true,
      'only workspace-protocol dependency ranges may trigger version bumps',
    );
    addFailure(failures, isEmptyArray(config.ignore), 'Changesets ignore list must remain empty');

    const privatePackages = config.privatePackages;
    addFailure(
      failures,
      isRecord(privatePackages) &&
        privatePackages.version === true &&
        privatePackages.tag === false,
      'private packages may be versioned but must never be tagged',
    );
  }

  addFailure(
    failures,
    isRecord(input.workspace) && isStringArray(input.workspace.packages, WORKSPACE_PATTERNS),
    'pnpm workspace package patterns must match the audited Phase 0 boundary',
  );

  const manifestPaths = input.manifests.map(({ path }) => path).sort();
  addFailure(
    failures,
    isStringArray(manifestPaths, AUDITED_MANIFEST_PATHS),
    'package manifest paths must match the audited Phase 0 allowlist',
  );
  const packageNames = new Set<string>();
  for (const { path, manifest, symbolicLink } of input.manifests) {
    addFailure(failures, !symbolicLink, `${path} must not be reached through a symbolic link`);
    if (!isRecord(manifest)) {
      failures.push(`${path} must contain an object`);
      continue;
    }
    const name = manifest.name;
    addFailure(failures, typeof name === 'string' && name.length > 0, `${path} must have a name`);
    if (typeof name === 'string') {
      addFailure(failures, !packageNames.has(name), `duplicate package name: ${name}`);
      packageNames.add(name);
      addFailure(
        failures,
        AUDITED_PACKAGE_NAMES.get(path) === name,
        `${path} package name must match the audited Phase 0 allowlist`,
      );
    }
    addFailure(failures, manifest.private === true, `${path} must remain private in Phase 0`);
    addFailure(
      failures,
      manifest.publishConfig === undefined,
      `${path} must not declare publishConfig in Phase 0`,
    );
  }

  validateCiWorkflow(failures, input.ciWorkflow);
  validateReleaseWorkflow(failures, input.workflow);

  return failures;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function packageManifestCandidate(
  repositoryRoot: string,
  packageDirectory: string,
  parentSymbolicLink: boolean,
): Promise<WorkspaceManifestCandidate | null> {
  const absolutePath = join(packageDirectory, 'package.json');
  const path = relative(repositoryRoot, absolutePath).split(sep).join('/');
  if (parentSymbolicLink) {
    return { path, symbolicLink: true };
  }

  try {
    const packageJson = await lstat(absolutePath);
    if (!packageJson.isFile() && !packageJson.isSymbolicLink()) {
      return null;
    }
    return { path, symbolicLink: packageJson.isSymbolicLink() };
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function childPackageJsonPaths(
  repositoryRoot: string,
  directory: string,
): Promise<WorkspaceManifestCandidate[]> {
  const rootSymbolicLink = (await lstat(directory)).isSymbolicLink();
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) =>
        packageManifestCandidate(
          repositoryRoot,
          join(directory, entry.name),
          rootSymbolicLink || entry.isSymbolicLink(),
        ),
      ),
  );
  return candidates
    .filter((candidate): candidate is WorkspaceManifestCandidate => candidate !== null)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function adapterPackageJsonPaths(
  repositoryRoot: string,
): Promise<WorkspaceManifestCandidate[]> {
  const adaptersRoot = join(repositoryRoot, 'adapters');
  const rootSymbolicLink = (await lstat(adaptersRoot)).isSymbolicLink();
  const adapters = await readdir(adaptersRoot, { withFileTypes: true });
  const candidates: WorkspaceManifestCandidate[] = [];
  for (const adapter of adapters) {
    if (!adapter.isDirectory() && !adapter.isSymbolicLink()) {
      continue;
    }
    const adapterSymbolicLink = rootSymbolicLink || adapter.isSymbolicLink();
    if (adapterSymbolicLink) {
      for (const packageDirectory of ['bridge', 'catalog']) {
        const candidate = await packageManifestCandidate(
          repositoryRoot,
          join(adaptersRoot, adapter.name, packageDirectory),
          true,
        );
        if (candidate !== null) {
          candidates.push(candidate);
        }
      }
      continue;
    }
    const packageDirectories = await readdir(join(adaptersRoot, adapter.name), {
      withFileTypes: true,
    });
    for (const packageDirectory of packageDirectories) {
      if (
        (packageDirectory.isDirectory() || packageDirectory.isSymbolicLink()) &&
        (packageDirectory.name === 'bridge' || packageDirectory.name === 'catalog')
      ) {
        const candidate = await packageManifestCandidate(
          repositoryRoot,
          join(adaptersRoot, adapter.name, packageDirectory.name),
          packageDirectory.isSymbolicLink(),
        );
        if (candidate !== null) {
          candidates.push(candidate);
        }
      }
    }
  }
  return candidates.sort((left, right) => left.path.localeCompare(right.path));
}

export async function discoverPhaseZeroManifestCandidates(
  repositoryRoot: string,
): Promise<WorkspaceManifestCandidate[]> {
  const rootCandidate = await packageManifestCandidate(repositoryRoot, repositoryRoot, false);
  if (rootCandidate === null) {
    throw new Error('root package.json was not found');
  }
  return [
    rootCandidate,
    ...(await childPackageJsonPaths(repositoryRoot, join(repositoryRoot, 'packages'))),
    ...(await childPackageJsonPaths(repositoryRoot, join(repositoryRoot, 'services'))),
    ...(await adapterPackageJsonPaths(repositoryRoot)),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export async function loadPhaseZeroReleasePolicyInput(
  repositoryRoot: string,
): Promise<PhaseZeroReleasePolicyInput> {
  const manifestCandidates = await discoverPhaseZeroManifestCandidates(repositoryRoot);
  const manifests = await Promise.all(
    manifestCandidates.map(async ({ path, symbolicLink }) => {
      return {
        path,
        manifest: symbolicLink ? null : await readJson(join(repositoryRoot, path)),
        symbolicLink,
      };
    }),
  );
  return {
    ciWorkflow: await readFile(join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
    config: await readJson(join(repositoryRoot, '.changeset', 'config.json')),
    manifests,
    workspace: parse(
      await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
    ) as unknown,
    workflow: await readFile(join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8'),
  };
}
