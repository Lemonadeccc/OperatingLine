import { resolve } from 'node:path';

import {
  buildHumanEvalCollectionWorklist,
  HumanEvalDatasetBusyError,
  loadHumanEvalDatasetDirectory,
  withHumanEvalDatasetWriteLock,
  type HumanEvalDatasetDirectoryOptions,
  type ValidatedHumanEvalDataset,
} from '@operatingline/eval-kit';

export interface CollectionStatusWorkspaceOpenOptions {
  readonly datasetDirectory: string;
  readonly artifactOptions?: HumanEvalDatasetDirectoryOptions;
}

export interface HumanEvalCollectionStatusDto {
  readonly remainingDistinctTreatments: number;
  readonly pendingSignoffs: number;
  readonly remainingIndependentReviews: number;
  readonly pendingAdjudications: number;
  readonly releaseReadiness: 'not_assessed';
}

export class HumanEvalCollectionStatusBusyError extends Error {
  constructor() {
    super('Human Eval collection status is temporarily unavailable during a write');
    this.name = 'HumanEvalCollectionStatusBusyError';
  }
}

function assertStatusDatasetReady(dataset: ValidatedHumanEvalDataset): ValidatedHumanEvalDataset {
  if (dataset.verificationLevel !== 'artifact_verified') {
    throw new Error('Human Eval collection status requires an artifact-verified dataset');
  }
  if (dataset.suite.status === 'retired') {
    throw new Error('Human Eval collection status is unavailable for a retired suite');
  }
  return dataset;
}

export class HumanEvalCollectionStatusWorkspace {
  static async open(
    options: CollectionStatusWorkspaceOpenOptions,
  ): Promise<HumanEvalCollectionStatusWorkspace> {
    const workspace = new HumanEvalCollectionStatusWorkspace(
      resolve(options.datasetDirectory),
      options.artifactOptions ?? {},
    );
    await workspace.#loadStableDataset();
    return workspace;
  }

  readonly #datasetDirectory: string;
  readonly #artifactOptions: HumanEvalDatasetDirectoryOptions;
  #readTail: Promise<void> = Promise.resolve();

  private constructor(datasetDirectory: string, artifactOptions: HumanEvalDatasetDirectoryOptions) {
    this.#datasetDirectory = datasetDirectory;
    this.#artifactOptions = artifactOptions;
  }

  /** Reloads the dataset so a long-running operator process reports current collection progress. */
  async getCollectionStatus(): Promise<HumanEvalCollectionStatusDto> {
    const read = async (): Promise<HumanEvalCollectionStatusDto> => {
      const worklist = buildHumanEvalCollectionWorklist(await this.#loadStableDataset());
      return {
        remainingDistinctTreatments: worklist.captureStatusByCase.reduce(
          (total, status) => total + status.remainingDistinctTreatments,
          0,
        ),
        pendingSignoffs: worklist.reviewStage.blockedByUnsignedRunIds.length,
        remainingIndependentReviews: worklist.reviews.reduce(
          (total, review) => total + review.remainingIndependentReviewerCount,
          0,
        ),
        pendingAdjudications: worklist.adjudications.length,
        releaseReadiness: 'not_assessed',
      };
    };
    const result = this.#readTail.then(read, read);
    this.#readTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #loadDataset(): Promise<ValidatedHumanEvalDataset> {
    return assertStatusDatasetReady(
      await loadHumanEvalDatasetDirectory(this.#datasetDirectory, this.#artifactOptions),
    );
  }

  async #loadStableDataset(): Promise<ValidatedHumanEvalDataset> {
    try {
      return await withHumanEvalDatasetWriteLock(this.#datasetDirectory, () => this.#loadDataset());
    } catch (error) {
      if (error instanceof HumanEvalDatasetBusyError) {
        throw new HumanEvalCollectionStatusBusyError();
      }
      throw error;
    }
  }
}
