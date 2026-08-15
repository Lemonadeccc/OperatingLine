import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/edit_inset_f9_round_trip.py');

function near(actual, expected) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= 1e-6;
}

function sameRecord(actual, expected) {
  return (
    actual !== null &&
    typeof actual === 'object' &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function validOperatorProperties(properties, { final }) {
  if (properties === null || typeof properties !== 'object') return false;
  const expectedKeys = [
    'use_boundary',
    'use_even_offset',
    'use_relative_offset',
    'use_edge_rail',
    'thickness',
    'depth',
    'use_outset',
    'use_select_inset',
    'use_individual',
    'use_interpolate',
    'release_confirm',
  ];
  return (
    Object.keys(properties).length === expectedKeys.length &&
    expectedKeys.every((key) => key in properties) &&
    properties.use_boundary === true &&
    properties.use_even_offset === true &&
    properties.use_relative_offset === false &&
    properties.use_edge_rail === false &&
    near(properties.thickness, final ? 0.2 : 0) &&
    near(properties.depth, final ? 0.1 : 0) &&
    properties.use_outset === false &&
    properties.use_select_inset === false &&
    properties.use_individual === final &&
    properties.use_interpolate === true &&
    properties.release_confirm === false
  );
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-edit-inset-f9-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing Edit Mode Inset F9 UI round trip with ${firstLine}`);
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
          OPERATINGLINE_EDIT_INSET_F9_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Blender Edit Mode Inset F9 test failed with exit code ${result.status ?? 1}`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Blender exited without a readable Edit Mode Inset F9 result: ${error.message}`,
        { cause: error },
      );
    }

    if (
      payload.ok !== true ||
      payload.operatorId !== 'MESH_OT_inset' ||
      !validOperatorProperties(payload.sourceProperties, { final: false }) ||
      !validOperatorProperties(payload.finalProperties, { final: true }) ||
      !sameRecord(payload.initialFaceSelection, { selected: 6, total: 6 }) ||
      !sameRecord(payload.finalFaceSelection, { selected: 6, total: 30 }) ||
      !sameRecord(payload.topology, { vertices: 32, edges: 60, polygons: 30 }) ||
      payload.allFacesQuad !== true ||
      !near(payload.bounds?.min, -1.1) ||
      !near(payload.bounds?.max, 1.1) ||
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
        `Blender returned an invalid Edit Mode Inset F9 result: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
