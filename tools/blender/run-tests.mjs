import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const testFile = resolve('tests/integration/blender/test_extension.py');
syncBlenderExtensionResources();

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  console.log(`Testing ${firstLine}`);

  const result = spawnSync(
    blender,
    ['--background', '--factory-startup', '--python-exit-code', '1', '--python', testFile],
    {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
