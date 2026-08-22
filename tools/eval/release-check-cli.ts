import { resolve } from 'node:path';

import {
  HumanEvalDatasetError,
  buildHumanEvalReleaseCandidateManifest,
  loadHumanEvalDatasetDirectory,
} from '@operatingline/eval-kit';

export interface EvalReleaseCheckCliOptions {
  readonly datasetDirectory: string;
  readonly repoRoot: string;
}

export interface EvalReleaseCheckSuccess {
  readonly formatVersion: '1.0.0';
  readonly releaseEligible: true;
  readonly releasePerformed: false;
  readonly trainingUse: 'not_authorized';
  readonly releaseCandidateManifestSha256: string;
  readonly manifest: ReturnType<typeof buildHumanEvalReleaseCandidateManifest>;
}

export interface EvalReleaseCheckFailure {
  readonly formatVersion: '1.0.0';
  readonly releaseEligible: false;
  readonly releasePerformed: false;
  readonly trainingUse: 'not_authorized';
  readonly releaseCandidateManifestSha256: null;
  readonly manifest: null;
  readonly issues: readonly string[];
}

export type EvalReleaseCheckResult = EvalReleaseCheckSuccess | EvalReleaseCheckFailure;

export function parseEvalReleaseCheckCliOptions(
  arguments_: readonly string[],
): EvalReleaseCheckCliOptions {
  let datasetDirectory: string | undefined;
  let repoRoot: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === '--repo-root') {
      if (repoRoot !== undefined) {
        throw new Error('Duplicate Eval release check argument --repo-root');
      }
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Eval release check argument --repo-root requires a directory');
      }
      repoRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown Eval release check argument ${argument}`);
    }
    if (datasetDirectory !== undefined) {
      throw new Error('Eval release check accepts at most one dataset directory');
    }
    datasetDirectory = resolve(argument);
  }

  const resolvedRepoRoot = repoRoot ?? resolve('.');
  return {
    datasetDirectory:
      datasetDirectory ?? resolve(resolvedRepoRoot, 'protocol/fixtures/v1/eval/blender-core'),
    repoRoot: resolvedRepoRoot,
  };
}

export async function runEvalReleaseCheckCli(
  arguments_: readonly string[],
): Promise<EvalReleaseCheckResult> {
  const options = parseEvalReleaseCheckCliOptions(arguments_);
  try {
    const dataset = await loadHumanEvalDatasetDirectory(options.datasetDirectory, {
      artifactRoots: { repo: options.repoRoot },
    });
    const manifest = buildHumanEvalReleaseCandidateManifest(dataset);
    return {
      formatVersion: '1.0.0',
      releaseEligible: true,
      releasePerformed: false,
      trainingUse: 'not_authorized',
      releaseCandidateManifestSha256: manifest.integrity.contentSha256,
      manifest,
    };
  } catch (error) {
    if (!(error instanceof HumanEvalDatasetError)) throw error;
    return {
      formatVersion: '1.0.0',
      releaseEligible: false,
      releasePerformed: false,
      trainingUse: 'not_authorized',
      releaseCandidateManifestSha256: null,
      manifest: null,
      issues: [...error.issues].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    };
  }
}
