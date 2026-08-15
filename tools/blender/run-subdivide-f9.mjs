import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/subdivide_f9_round_trip.py');

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-subdivide-f9-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing Subdivide F9 UI round trip with ${firstLine}`);
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
          OPERATINGLINE_SUBDIVIDE_F9_RESULT: resultPath,
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
      throw new Error(`Blender Subdivide F9 test failed with exit code ${result.status ?? 1}`);
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Blender exited without a readable structured Subdivide F9 result: ${error.message}`,
        { cause: error },
      );
    }
    if (payload.ok !== true) {
      throw new Error(`Blender reported a Subdivide F9 UI failure: ${JSON.stringify(payload)}`);
    }
    if (
      payload.operatorId !== 'MESH_OT_subdivide' ||
      payload.properties?.number_cuts !== 2 ||
      payload.properties?.smoothness !== 0.25 ||
      payload.topology?.vertices !== 56 ||
      payload.topology?.edges !== 108 ||
      payload.topology?.polygons !== 54 ||
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
        `Blender returned an invalid Subdivide F9 UI result: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
