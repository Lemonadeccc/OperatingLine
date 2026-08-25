import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const unitTestDirectory = resolve('tests/unit/blender');
const testFiles = [
  resolve('tests/integration/blender/test_extension.py'),
  resolve('tests/integration/blender/test_guided_light_trails_operations.py'),
  resolve('tests/integration/blender/test_guided_pose_animation_operations.py'),
  resolve('tests/integration/blender/test_guided_armature_operations.py'),
  resolve('tests/integration/blender/test_guided_skin_weights_operations.py'),
  resolve('tests/integration/blender/test_guided_solidify_operations.py'),
  resolve('tests/integration/blender/test_guided_bevel_modifier_operations.py'),
  resolve('tests/integration/blender/test_guided_single_material_operations.py'),
  resolve('tests/integration/blender/test_guided_material_palette_operations.py'),
  resolve('tests/integration/blender/test_guided_subdivision_surface_operations.py'),
  resolve('tests/integration/blender/test_guided_edit_bevel_operations.py'),
  resolve('tests/integration/blender/test_guided_edit_inset_operations.py'),
  resolve('tests/integration/blender/test_guided_edit_triangulate_operations.py'),
  resolve('tests/integration/blender/test_guided_edit_extrude_region_operations.py'),
  resolve('tests/integration/blender/test_guided_edit_poke_operations.py'),
  resolve('tests/integration/blender/test_guided_mirror_operations.py'),
  resolve('tests/integration/blender/test_renderable_snowman.py'),
  resolve('tests/integration/blender/test_deform_animation.py'),
  resolve('tests/integration/blender/test_planning_benchmark.py'),
];
syncBlenderExtensionResources();

const python = process.env.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const unitResult = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', unitTestDirectory, '-p', 'test_*.py', '-v'],
  {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'inherit',
  },
);
if (unitResult.error) {
  throw unitResult.error;
}
if (unitResult.status !== 0) {
  throw new Error(`Blender unit tests failed with exit code ${unitResult.status ?? 1}`);
}

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
