import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const testFiles = [
  resolve('tests/integration/blender/test_extension.py'),
  resolve('tests/integration/blender/test_renderable_snowman.py'),
];
syncBlenderExtensionResources();

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  console.log(`Testing ${firstLine}`);

  for (const testFile of testFiles) {
    const renderOutputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-render-test-'));
    try {
      const result = spawnSync(
        blender,
        ['--background', '--factory-startup', '--python-exit-code', '1', '--python', testFile],
        {
          env: {
            ...process.env,
            OPERATINGLINE_RENDER_OUTPUT_DIR: renderOutputDirectory,
            PYTHONDONTWRITEBYTECODE: '1',
          },
          stdio: 'inherit',
        },
      );
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(
          `Blender integration failed for ${testFile} with exit code ${result.status ?? 1}`,
        );
      }
    } finally {
      rmSync(renderOutputDirectory, { recursive: true, force: true });
    }
  }
}
