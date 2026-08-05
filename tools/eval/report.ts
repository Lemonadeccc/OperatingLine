import { resolve } from 'node:path';

import {
  buildHumanEvalComparisonReport,
  loadHumanEvalDatasetDirectory,
} from '@operatingline/eval-kit';

const directory = resolve(process.argv[2] ?? 'protocol/fixtures/v1/eval/blender-core');
const dataset = await loadHumanEvalDatasetDirectory(directory, {
  artifactRoots: { repo: resolve('.') },
});
const report = buildHumanEvalComparisonReport(dataset, {
  generatedAt: new Date().toISOString(),
});

console.log(JSON.stringify(report, null, 2));
