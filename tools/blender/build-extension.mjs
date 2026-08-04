import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const [blender] = requireBlenderBinaries();
syncBlenderExtensionResources();
const sourceDirectory = resolve('adapters/blender/extension');
const outputDirectory = resolve('artifacts/blender');
mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  blender,
  [
    '--command',
    'extension',
    'build',
    '--source-dir',
    sourceDirectory,
    '--output-dir',
    outputDirectory,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
