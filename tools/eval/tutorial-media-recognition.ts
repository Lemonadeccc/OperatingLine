import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  scoreTutorialMediaRecognition,
  type TutorialMediaRecognitionDataset,
  type TutorialMediaRecognitionPredictions,
} from '../../packages/eval-kit/src/tutorial-media-recognition-dataset.js';

const datasetPath = process.argv[2];
const predictionsPath = process.argv[3];
const splitFlag = process.argv[4];
const splitValue = process.argv[5];
if (
  datasetPath === undefined ||
  predictionsPath === undefined ||
  splitFlag !== '--split' ||
  splitValue !== 'held_out' ||
  process.argv.length !== 6
) {
  throw new Error(
    'Usage: tsx tools/eval/tutorial-media-recognition.ts <dataset.json> <predictions.json> --split held_out',
  );
}

const [dataset, predictions] = await Promise.all([
  readFile(resolve(datasetPath), 'utf8').then(
    (value) => JSON.parse(value) as TutorialMediaRecognitionDataset,
  ),
  readFile(resolve(predictionsPath), 'utf8').then(
    (value) => JSON.parse(value) as TutorialMediaRecognitionPredictions,
  ),
]);

if (predictions.provenance === undefined) {
  throw new Error('Release recognition evaluation requires model/config provenance.');
}

process.stdout.write(
  `${JSON.stringify(scoreTutorialMediaRecognition(dataset, predictions), null, 2)}\n`,
);
