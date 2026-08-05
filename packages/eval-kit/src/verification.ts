import type { ValidatedHumanEvalDataset } from './dataset.js';
import { computeHumanEvalContentSha256 } from './integrity.js';

const artifactVerifiedDatasets = new WeakMap<ValidatedHumanEvalDataset, string>();

function datasetEvidenceFingerprint(dataset: ValidatedHumanEvalDataset): string {
  return computeHumanEvalContentSha256({
    suite: dataset.suite,
    runs: dataset.runs,
    annotations: dataset.annotations,
    adjudications: dataset.adjudications,
  });
}

export function markArtifactVerifiedDataset<T extends ValidatedHumanEvalDataset>(dataset: T): T {
  artifactVerifiedDatasets.set(dataset, datasetEvidenceFingerprint(dataset));
  return dataset;
}

export function isArtifactVerifiedDataset(dataset: ValidatedHumanEvalDataset): boolean {
  return artifactVerifiedDatasets.get(dataset) === datasetEvidenceFingerprint(dataset);
}
