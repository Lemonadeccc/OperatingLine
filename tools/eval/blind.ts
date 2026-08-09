import { readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertProviderIdentityAbsent,
  buildProviderBlindReviewSurface,
  computeProviderBlindReviewSurfaceSha256,
  deriveProviderIdentityMarkers,
  loadHumanEvalDatasetDirectory,
  providerBlindRenderedArtifacts,
  sealProviderBlindSignoffV1,
  withHumanEvalDatasetWriteLock,
  writeHumanEvalFileAtomicExclusive,
  type ProviderBlindSignoffV1,
} from '@operatingline/eval-kit';

const maximumAliasFileBytes = 64 * 1024;

export interface CreateProviderBlindSignoffOptions {
  readonly datasetDirectory: string;
  readonly repositoryRoot?: string;
  readonly runId: string;
  readonly preparedBy: string;
  readonly supplementalAliases: readonly string[];
  readonly reviewedImageContentSha256: readonly string[];
  readonly assertion: 'no_provider_identity_visible';
  readonly now?: () => Date;
}

export async function createProviderBlindSignoff(
  options: CreateProviderBlindSignoffOptions,
): Promise<ProviderBlindSignoffV1> {
  if (options.assertion !== 'no_provider_identity_visible') {
    throw new Error(
      'Provider-blind preparation requires the exact no_provider_identity_visible assertion',
    );
  }
  const datasetDirectory = resolve(options.datasetDirectory);
  const artifactOptions = {
    artifactRoots: { repo: resolve(options.repositoryRoot ?? '.') },
  } as const;
  return withHumanEvalDatasetWriteLock(datasetDirectory, async () => {
    const dataset = await loadHumanEvalDatasetDirectory(datasetDirectory, artifactOptions);
    const run = dataset.runsById.get(options.runId);
    if (run === undefined) throw new Error('Provider-blind preparation references an unknown run');
    if (dataset.blindSignoffsByRunId.has(run.runId)) {
      throw new Error('Provider-blind sign-off already exists and cannot be overwritten');
    }
    const surface = buildProviderBlindReviewSurface(dataset.suite, run);
    const markers = deriveProviderIdentityMarkers(run.profile, options.supplementalAliases);
    assertProviderIdentityAbsent(surface, markers);
    const renderedArtifacts = providerBlindRenderedArtifacts(run);
    const expectedImageHashes = renderedArtifacts.map((artifact) => artifact.contentSha256).sort();
    const reviewedImageHashes = [...options.reviewedImageContentSha256].sort();
    if (
      reviewedImageHashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
      new Set(reviewedImageHashes).size !== reviewedImageHashes.length ||
      reviewedImageHashes.length !== expectedImageHashes.length ||
      reviewedImageHashes.some((hash, index) => hash !== expectedImageHashes[index])
    ) {
      throw new Error(
        'Provider-blind preparation must attest every exact rendered image SHA-256 after inspecting its visible pixels',
      );
    }
    const signoff = sealProviderBlindSignoffV1({
      formatVersion: '1.0.0',
      runId: run.runId,
      runContentSha256: run.integrity.contentSha256,
      projectionVersion: '1.0.0',
      projectionContentSha256: computeProviderBlindReviewSurfaceSha256(dataset.suite, run),
      renderedArtifacts,
      supplementalAliases: options.supplementalAliases,
      aliasesReviewedComplete: true,
      assertion: 'no_provider_identity_visible',
      preparedBy: options.preparedBy,
      reviewedAt: (options.now ?? (() => new Date()))().toISOString(),
    });
    const path = resolve(datasetDirectory, 'blind-signoffs', `${run.runId}.provider-blind.json`);
    await writeHumanEvalFileAtomicExclusive(
      path,
      `${JSON.stringify(signoff, null, 2)}\n`,
      datasetDirectory,
    );
    try {
      await loadHumanEvalDatasetDirectory(datasetDirectory, artifactOptions);
      return signoff;
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  });
}

async function readAliases(pathInput: string): Promise<readonly string[]> {
  const path = resolve(pathInput);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maximumAliasFileBytes) {
    throw new Error(
      `Provider alias file must be a regular file up to ${maximumAliasFileBytes} bytes`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Provider alias file must contain valid JSON');
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('Provider alias file must contain a JSON array of strings');
  }
  return value;
}

interface BlindCliOptions {
  readonly datasetDirectory: string;
  readonly repositoryRoot?: string;
  readonly runId: string;
  readonly preparedBy: string;
  readonly aliasesPath: string;
  readonly assertion: string;
  readonly reviewedImageContentSha256: readonly string[];
}

function parseCli(arguments_: readonly string[]): BlindCliOptions {
  const values = new Map<string, string>();
  const reviewedImageContentSha256: string[] = [];
  const allowed = new Set([
    '--dataset',
    '--repo-root',
    '--run',
    '--prepared-by',
    '--aliases',
    '--assert',
    '--reviewed-image-sha256',
  ]);
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !allowed.has(name)) {
      throw new Error(
        'Usage: blind --dataset <directory> --run <uuid> --prepared-by <pseudonym> --aliases <json-file> --assert no_provider_identity_visible [--reviewed-image-sha256 <sha256> ...] [--repo-root <directory>]',
      );
    }
    if (name === '--reviewed-image-sha256') {
      reviewedImageContentSha256.push(value);
      continue;
    }
    if (values.has(name)) throw new Error(`Duplicate Provider-blind argument ${name}`);
    values.set(name, value);
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`Missing required Provider-blind argument ${name}`);
    return value;
  };
  return {
    datasetDirectory: required('--dataset'),
    runId: required('--run'),
    preparedBy: required('--prepared-by'),
    aliasesPath: required('--aliases'),
    assertion: required('--assert'),
    reviewedImageContentSha256,
    ...(values.get('--repo-root') === undefined
      ? {}
      : { repositoryRoot: values.get('--repo-root')! }),
  };
}

export async function runProviderBlindSignoffCli(
  arguments_: readonly string[],
): Promise<ProviderBlindSignoffV1> {
  const options = parseCli(arguments_);
  if (options.assertion !== 'no_provider_identity_visible') {
    throw new Error('--assert must be exactly no_provider_identity_visible');
  }
  return createProviderBlindSignoff({
    datasetDirectory: options.datasetDirectory,
    ...(options.repositoryRoot === undefined ? {} : { repositoryRoot: options.repositoryRoot }),
    runId: options.runId,
    preparedBy: options.preparedBy,
    supplementalAliases: await readAliases(options.aliasesPath),
    reviewedImageContentSha256: options.reviewedImageContentSha256,
    assertion: options.assertion,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const signoff = await runProviderBlindSignoffCli(process.argv.slice(2));
    console.log(
      JSON.stringify(
        {
          signed: true,
          runId: signoff.runId,
          signoffContentSha256: signoff.integrity.contentSha256,
          renderedArtifactCount: signoff.renderedArtifacts.length,
          providerCredentialsRequired: false,
          providerCallsEnabled: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
