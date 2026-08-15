import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const testFiles = [
  resolve('tests/e2e/blender/native_undo_round_trip.py'),
  resolve('tests/e2e/blender/native_undo_inset_round_trip.py'),
  resolve('tests/e2e/blender/native_undo_poke_round_trip.py'),
];
syncBlenderExtensionResources();

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  for (const testFile of testFiles) {
    console.log(
      `Testing ${testFile.split('/').at(-1)} with ${version.stdout?.split('\n')[0] ?? blender}`,
    );
    const result = spawnSync(
      blender,
      [
        '--factory-startup',
        '--window-geometry',
        '80',
        '80',
        '1200',
        '800',
        '--python-exit-code',
        '1',
        '--python',
        testFile,
      ],
      {
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`Blender native Undo test failed with exit code ${result.status ?? 1}`);
    }
  }
}
