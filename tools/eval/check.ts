import { resolve } from 'node:path';

import { loadHumanEvalDatasetDirectory } from '@operatingline/eval-kit';

const directory = resolve(process.argv[2] ?? 'protocol/fixtures/v1/eval/blender-core');
const dataset = await loadHumanEvalDatasetDirectory(directory, {
  artifactRoots: { repo: resolve('.') },
});

console.log(
  JSON.stringify(
    {
      valid: true,
      suiteId: dataset.suite.suiteId,
      suiteVersion: dataset.suite.suiteVersion,
      status: dataset.suite.status,
      caseCount: dataset.suite.cases.length,
      runCount: dataset.runs.length,
      blindSignoffCount: dataset.blindSignoffs.length,
      annotationCount: dataset.annotations.length,
      adjudicationCount: dataset.adjudications.length,
      numericScoring: false,
      providerRanking: false,
    },
    null,
    2,
  ),
);
