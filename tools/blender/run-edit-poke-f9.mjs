import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/edit_poke_f9_round_trip.py');

function near(actual, expected) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= 1e-6;
}

function validProperties(properties, offset) {
  return (
    properties !== null &&
    typeof properties === 'object' &&
    Object.keys(properties).length === 3 &&
    near(properties.offset, offset) &&
    properties.use_relative_offset === false &&
    properties.center_mode === 'MEDIAN_WEIGHTED'
  );
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-edit-poke-f9-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing Edit Mode Poke F9 UI round trip with ${firstLine}`);
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
          OPERATINGLINE_EDIT_POKE_F9_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Blender Edit Mode Poke F9 test failed with exit code ${result.status ?? 1}`);
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Blender exited without a readable Edit Mode Poke F9 result: ${error.message}`,
        { cause: error },
      );
    }
    if (
      payload.ok !== true ||
      payload.operatorId !== 'MESH_OT_poke' ||
      !validProperties(payload.sourceProperties, 0) ||
      !validProperties(payload.finalProperties, 0.2) ||
      payload.topology?.vertices !== 14 ||
      payload.topology?.edges !== 36 ||
      payload.topology?.polygons !== 24 ||
      payload.selectedTriangles !== 24 ||
      payload.allFacesTriangle !== true ||
      !near(payload.bounds?.min, -1.2) ||
      !near(payload.bounds?.max, 1.2) ||
      payload.objectName !== 'Cube' ||
      payload.mode !== 'OBJECT' ||
      !Number.isSafeInteger(payload.meshDataPointerBefore) ||
      payload.meshDataPointerBefore <= 0 ||
      payload.meshDataPointerAfter !== payload.meshDataPointerBefore ||
      !Number.isInteger(payload.meshDatablockCountBefore) ||
      payload.meshDatablockCountBefore <= 0 ||
      payload.meshDatablockCountAfter !== payload.meshDatablockCountBefore ||
      payload.nativeInPlaceMutationVerified !== true ||
      payload.popupCloseEventSent !== true
    ) {
      throw new Error(
        `Blender returned an invalid Edit Mode Poke F9 result: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
