import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const [blender] = requireBlenderBinaries();
const artifactDirectory = resolve('artifacts/blender');
const baseFile = resolve(artifactDirectory, 'visual-smoke-empty.blend');
const captureScript = resolve('tests/e2e/blender/capture_overlay.py');
mkdirSync(artifactDirectory, { recursive: true });

const prepareCode = [
  'import bpy',
  "bpy.ops.object.select_all(action='SELECT')",
  'bpy.ops.object.delete(use_global=False)',
  `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(baseFile)})`,
].join('; ');
const preparation = spawnSync(
  blender,
  ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', prepareCode],
  { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit' },
);
if (preparation.error) {
  throw preparation.error;
}
if (preparation.status !== 0) {
  process.exit(preparation.status ?? 1);
}

const result = spawnSync(
  blender,
  [
    baseFile,
    '--window-geometry',
    '80',
    '80',
    '1280',
    '800',
    '--python-exit-code',
    '1',
    '--python',
    captureScript,
  ],
  { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
