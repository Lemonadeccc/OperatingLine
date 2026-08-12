import { resolve } from 'node:path';

import {
  buildHumanEvalCollectionWorklist,
  loadHumanEvalDatasetDirectory,
} from '@operatingline/eval-kit';

export interface EvalCheckCliOptions {
  readonly datasetDirectory: string;
  readonly includeWorklist: boolean;
}

export function parseEvalCheckCliOptions(arguments_: readonly string[]): EvalCheckCliOptions {
  let datasetDirectory: string | undefined;
  let includeWorklist = false;
  for (const argument of arguments_) {
    if (argument === '--worklist') {
      if (includeWorklist) throw new Error('Duplicate Eval check argument --worklist');
      includeWorklist = true;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(`Unknown Eval check argument ${argument}`);
    if (datasetDirectory !== undefined) {
      throw new Error('Eval check accepts at most one dataset directory');
    }
    datasetDirectory = argument;
  }
  return {
    datasetDirectory: resolve(datasetDirectory ?? 'protocol/fixtures/v1/eval/blender-core'),
    includeWorklist,
  };
}

export async function runEvalCheckCli(arguments_: readonly string[]) {
  const options = parseEvalCheckCliOptions(arguments_);
  const dataset = await loadHumanEvalDatasetDirectory(options.datasetDirectory, {
    artifactRoots: { repo: resolve('.') },
  });
  return {
    valid: true as const,
    suiteId: dataset.suite.suiteId,
    suiteVersion: dataset.suite.suiteVersion,
    status: dataset.suite.status,
    caseCount: dataset.suite.cases.length,
    runCount: dataset.runs.length,
    blindSignoffCount: dataset.blindSignoffs.length,
    annotationCount: dataset.annotations.length,
    adjudicationCount: dataset.adjudications.length,
    numericScoring: false as const,
    providerRanking: false as const,
    ...(options.includeWorklist ? { worklist: buildHumanEvalCollectionWorklist(dataset) } : {}),
  };
}
