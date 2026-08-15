import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/edit_bevel_f9_round_trip.py');

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
    'offset_type',
    'offset',
    'segments',
    'profile',
    'affect',
    'clamp_overlap',
    'loop_slide',
    'mark_seam',
    'mark_sharp',
    'material',
    'harden_normals',
    'face_strength_mode',
    'miter_outer',
    'miter_inner',
    'spread',
    'vmesh_method',
    'release_confirm',
  ];
  if ('profile_type' in properties) expectedKeys.push('profile_type');
  return (
    Object.keys(properties).length === expectedKeys.length &&
    expectedKeys.every((key) => key in properties) &&
    properties.offset_type === 'OFFSET' &&
    (!('profile_type' in properties) || properties.profile_type === 'SUPERELLIPSE') &&
    properties.affect === 'EDGES' &&
    properties.clamp_overlap === false &&
    properties.loop_slide === true &&
    properties.mark_seam === false &&
    properties.mark_sharp === false &&
    properties.material === -1 &&
    properties.harden_normals === false &&
    properties.face_strength_mode === 'NONE' &&
    properties.miter_inner === 'SHARP' &&
    properties.miter_outer === 'SHARP' &&
    near(properties.spread, 0.1) &&
    properties.vmesh_method === 'ADJ' &&
    properties.release_confirm === false &&
    near(properties.offset, final ? 0.2 : 0) &&
    properties.segments === (final ? 3 : 1) &&
    near(properties.profile, final ? 0.6 : 0.5)
  );
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-edit-bevel-f9-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing Edit Mode Bevel F9 UI round trip with ${firstLine}`);
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
          OPERATINGLINE_EDIT_BEVEL_F9_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
      },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Blender Edit Mode Bevel F9 test failed with exit code ${result.status ?? 1}`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Blender exited without a readable Edit Mode Bevel F9 result: ${error.message}`,
        { cause: error },
      );
    }

    if (
      payload.ok !== true ||
      payload.operatorId !== 'MESH_OT_bevel' ||
      !validOperatorProperties(payload.sourceProperties, { final: false }) ||
      !validOperatorProperties(payload.finalProperties, { final: true }) ||
      !sameRecord(payload.initialEdgeSelection, { selected: 12, total: 12 }) ||
      !sameRecord(payload.finalEdgeSelection, { selected: 192, total: 192 }) ||
      !sameRecord(payload.topology, { vertices: 96, edges: 192, polygons: 98 }) ||
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
        `Blender returned an invalid Edit Mode Bevel F9 result: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
