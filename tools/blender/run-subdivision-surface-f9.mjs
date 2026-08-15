import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/subdivision_surface_f9_round_trip.py');
const expectedTopology = {
  1: { vertices: 26, edges: 48, polygons: 24 },
  2: { vertices: 98, edges: 192, polygons: 96 },
  3: { vertices: 386, edges: 768, polygons: 384 },
};
const expectedModifierFlags = {
  subdivision_type: 'CATMULL_CLARK',
  quality: 3,
  show_viewport: true,
  show_render: true,
  show_in_editmode: true,
  show_on_cage: false,
  show_only_control_edges: true,
  use_limit_surface: true,
  use_creases: true,
  use_custom_normals: false,
  boundary_smooth: 'ALL',
  uv_smooth: 'PRESERVE_BOUNDARIES',
};

function sameRecord(actual, expected) {
  return (
    actual !== null &&
    typeof actual === 'object' &&
    Object.entries(expected).every(([key, value]) => actual[key] === value) &&
    Object.keys(actual).length === Object.keys(expected).length
  );
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;

  for (const viewportLevel of [1, 2, 3]) {
    const outputDirectory = mkdtempSync(
      join(tmpdir(), `operatingline-subdivision-surface-f9-level-${viewportLevel}-`),
    );
    const resultPath = join(outputDirectory, 'result.json');

    console.log(`Testing Subdivision Surface F9 level ${viewportLevel} with ${firstLine}`);
    try {
      const result = spawnSync(
        blender,
        [
          '--factory-startup',
          '--enable-event-simulate',
          '--window-geometry',
          '80',
          '80',
          '1600',
          '1000',
          '--python-exit-code',
          '1',
          '--python',
          testFile,
        ],
        {
          env: {
            ...process.env,
            OPERATINGLINE_SUBDIVISION_SURFACE_F9_RESULT: resultPath,
            OPERATINGLINE_SUBDIVISION_SURFACE_VIEWPORT_LEVEL: String(viewportLevel),
            PYTHONDONTWRITEBYTECODE: '1',
          },
          stdio: 'inherit',
          timeout: 60_000,
        },
      );

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(
          `Blender Subdivision Surface F9 level ${viewportLevel} failed with exit code ${result.status ?? 1}`,
        );
      }

      let payload;
      try {
        payload = JSON.parse(readFileSync(resultPath, 'utf8'));
      } catch (error) {
        throw new Error(
          `Blender exited without a readable Subdivision Surface F9 result: ${error.message}`,
          { cause: error },
        );
      }

      const expectedOperatorProperties = {
        level: viewportLevel,
        relative: false,
        ensure_modifier: true,
      };
      const expectedSourceOperatorProperties = {
        level: 1,
        relative: false,
        ensure_modifier: true,
      };
      if (
        payload.ok !== true ||
        payload.viewportLevel !== viewportLevel ||
        payload.renderLevel !== 2 ||
        payload.operatorId !== 'OBJECT_OT_subdivision_set' ||
        !sameRecord(payload.sourceOperatorProperties, expectedSourceOperatorProperties) ||
        !sameRecord(payload.sourceModifierLevels, { levels: 1, render_levels: 2 }) ||
        !sameRecord(payload.operatorProperties, expectedOperatorProperties) ||
        payload.subsurfModifierCount !== 1 ||
        payload.modifierName !== 'Subdivision' ||
        !sameRecord(payload.modifierFlags, expectedModifierFlags) ||
        !sameRecord(payload.evaluatedTopology, expectedTopology[viewportLevel]) ||
        !Number.isSafeInteger(payload.meshDataPointerBefore) ||
        payload.meshDataPointerBefore <= 0 ||
        payload.meshDataPointerAfter !== payload.meshDataPointerBefore ||
        !Number.isInteger(payload.meshDatablockCountBefore) ||
        payload.meshDatablockCountBefore <= 0 ||
        payload.meshDatablockCountAfter !== payload.meshDatablockCountBefore ||
        payload.objectName !== 'Cube' ||
        payload.mode !== 'OBJECT' ||
        payload.popupCloseEventSent !== true
      ) {
        throw new Error(
          `Blender returned an invalid Subdivision Surface F9 result: ${JSON.stringify(payload)}`,
        );
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}
