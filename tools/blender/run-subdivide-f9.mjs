import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/subdivide_f9_round_trip.py');
const actionBounds = {
  numberCuts: { minimum: 1, maximum: 8 },
  smoothness: { minimum: 0, maximum: 1 },
};
const representativeActionArguments = [
  { numberCuts: 1, smoothness: 0 },
  { numberCuts: 2, smoothness: 0.5 },
  { numberCuts: 8, smoothness: 1 },
];

function validateActionArguments(actionArguments) {
  if (
    !Number.isInteger(actionArguments.numberCuts) ||
    actionArguments.numberCuts < actionBounds.numberCuts.minimum ||
    actionArguments.numberCuts > actionBounds.numberCuts.maximum
  ) {
    throw new RangeError('Subdivide numberCuts must be an integer from 1 through 8');
  }
  if (
    !Number.isFinite(actionArguments.smoothness) ||
    actionArguments.smoothness < actionBounds.smoothness.minimum ||
    actionArguments.smoothness > actionBounds.smoothness.maximum
  ) {
    throw new RangeError('Subdivide smoothness must be a finite number from 0 through 1');
  }
  return actionArguments;
}

function expectedTopology(numberCuts) {
  const subdivisionsPerEdge = numberCuts + 1;
  return {
    vertices: 6 * subdivisionsPerEdge ** 2 + 2,
    edges: 12 * subdivisionsPerEdge ** 2,
    polygons: 6 * subdivisionsPerEdge ** 2,
  };
}

assert.throws(() => validateActionArguments({ numberCuts: 0, smoothness: 0 }), RangeError);
assert.throws(() => validateActionArguments({ numberCuts: 9, smoothness: 0 }), RangeError);
assert.throws(() => validateActionArguments({ numberCuts: 1.5, smoothness: 0 }), RangeError);
assert.throws(() => validateActionArguments({ numberCuts: 1, smoothness: -0.01 }), RangeError);
assert.throws(() => validateActionArguments({ numberCuts: 1, smoothness: 1.01 }), RangeError);
assert.throws(() => validateActionArguments({ numberCuts: 1, smoothness: NaN }), RangeError);

const testRuns = requireBlenderBinaries().flatMap((blender) => {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  return representativeActionArguments.map((actionArguments) => ({
    actionArguments: validateActionArguments(actionArguments),
    blender,
    firstLine,
  }));
});

for (const { actionArguments, blender, firstLine } of testRuns) {
  const topology = expectedTopology(actionArguments.numberCuts);
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-subdivide-f9-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(
    `Testing Subdivide F9 UI round trip with ${firstLine} ` +
      `cuts=${actionArguments.numberCuts} smooth=${actionArguments.smoothness}`,
  );
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
          OPERATINGLINE_SUBDIVIDE_F9_NUMBER_CUTS: String(actionArguments.numberCuts),
          OPERATINGLINE_SUBDIVIDE_F9_SMOOTHNESS: String(actionArguments.smoothness),
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
    const history = payload.historySnapshots;
    const nativeHistory = payload.nativeHistory;
    const validSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const expectedHistoryLabels = [
      'applied',
      'undo-1',
      'undo-2',
      'undo-3',
      'undo-4',
      'redo-1',
      'redo-2',
      'redo-3',
      'redo-4',
    ];
    const historyIdentityVerified =
      Array.isArray(history) &&
      history.every(
        (snapshot) =>
          snapshot.activeObjectName === 'Cube' &&
          snapshot.objectPointer === payload.objectPointerBefore &&
          snapshot.meshDataPointer === payload.meshDataPointerBefore &&
          snapshot.meshDatablockCount === payload.meshDatablockCountBefore &&
          validSha256(snapshot.geometrySha256) &&
          validSha256(snapshot.stateSha256),
      );
    const undoEvents = nativeHistory?.eventEvidence?.undo;
    const redoEvents = nativeHistory?.eventEvidence?.redo;
    const expectedHistoryEvents = (events, shift) =>
      Array.isArray(events) &&
      events.length === 8 &&
      events.every(
        (event, index) =>
          event.type === 'Z' &&
          event.value === (index % 2 === 0 ? 'PRESS' : 'RELEASE') &&
          event.ctrl === true &&
          event.shift === shift,
      );
    if (
      payload.operatorId !== 'MESH_OT_subdivide' ||
      payload.properties?.number_cuts !== actionArguments.numberCuts ||
      payload.properties?.smoothness !== actionArguments.smoothness ||
      payload.requestedProperties?.number_cuts !== actionArguments.numberCuts ||
      payload.requestedProperties?.smoothness !== actionArguments.smoothness ||
      payload.topology?.vertices !== topology.vertices ||
      payload.topology?.edges !== topology.edges ||
      payload.topology?.polygons !== topology.polygons ||
      payload.objectName !== 'Cube' ||
      payload.mode !== 'OBJECT' ||
      !Number.isSafeInteger(payload.objectPointerBefore) ||
      payload.objectPointerBefore <= 0 ||
      payload.objectPointerAfter !== payload.objectPointerBefore ||
      !Number.isSafeInteger(payload.meshDataPointerBefore) ||
      payload.meshDataPointerBefore <= 0 ||
      payload.meshDataPointerAfter !== payload.meshDataPointerBefore ||
      !Number.isInteger(payload.meshDatablockCountBefore) ||
      payload.meshDatablockCountBefore <= 0 ||
      payload.meshDatablockCountAfter !== payload.meshDatablockCountBefore ||
      payload.nativeInPlaceMutationVerified !== true ||
      payload.popupCloseEventSent !== true ||
      !Array.isArray(history) ||
      history.length !== 9 ||
      history.map((snapshot) => snapshot.label).join('|') !== expectedHistoryLabels.join('|') ||
      historyIdentityVerified !== true ||
      history[0]?.mode !== 'OBJECT' ||
      history[0]?.topology?.vertices !== topology.vertices ||
      history[0]?.topology?.edges !== topology.edges ||
      history[0]?.topology?.polygons !== topology.polygons ||
      history[1]?.label !== 'undo-1' ||
      history[1]?.mode !== 'EDIT_MESH' ||
      history[1]?.topology?.vertices !== 8 ||
      history[1]?.topology?.edges !== 12 ||
      history[1]?.topology?.polygons !== 6 ||
      history[1]?.geometrySha256 === history[0]?.geometrySha256 ||
      history[4]?.mode !== 'OBJECT' ||
      history[4]?.selectedObjectNames?.join('|') !== 'Cube' ||
      history[4]?.sceneObjects?.map((entry) => `${entry.name}:${entry.type}`).join('|') !==
        'Camera:CAMERA|Cube:MESH|Light:LIGHT' ||
      history[4]?.topology?.vertices !== 8 ||
      history[4]?.topology?.edges !== 12 ||
      history[4]?.topology?.polygons !== 6 ||
      history[8]?.mode !== 'OBJECT' ||
      history[8]?.topology?.vertices !== topology.vertices ||
      history[8]?.topology?.edges !== topology.edges ||
      history[8]?.topology?.polygons !== topology.polygons ||
      history[8]?.stateSha256 !== history[0]?.stateSha256 ||
      nativeHistory?.availability !== 'verified' ||
      nativeHistory?.boundary !== 'full_procedure_native_undo_redo' ||
      nativeHistory?.undoDepth !== 4 ||
      nativeHistory?.redoDepth !== 4 ||
      nativeHistory?.undoShortcut !== 'CTRL+Z' ||
      nativeHistory?.redoShortcut !== 'CTRL+SHIFT+Z' ||
      expectedHistoryEvents(undoEvents, false) !== true ||
      expectedHistoryEvents(redoEvents, true) !== true ||
      nativeHistory?.factoryCubeGeometryRestored !== true ||
      nativeHistory?.factoryStartupStateRestored !== true ||
      nativeHistory?.parameterizedGeometryRestored !== true ||
      nativeHistory?.factoryStartupStateSha256 !== history[4]?.stateSha256 ||
      nativeHistory?.baselineStateSha256 !== history[4]?.stateSha256 ||
      nativeHistory?.appliedStateSha256 !== history[0]?.stateSha256 ||
      nativeHistory?.finalStateSha256 !== history[8]?.stateSha256 ||
      nativeHistory?.parameterEvidence?.operatorId !== 'MESH_OT_subdivide' ||
      nativeHistory?.parameterEvidence?.properties?.number_cuts !== actionArguments.numberCuts ||
      nativeHistory?.parameterEvidence?.properties?.smoothness !== actionArguments.smoothness ||
      nativeHistory?.parameterEvidence?.redoGeometrySha256 !== history[8]?.geometrySha256 ||
      nativeHistory?.meshIdentityUnchanged !== true ||
      nativeHistory?.meshDatablockCountUnchanged !== true
    ) {
      throw new Error(
        `Blender returned an invalid Subdivide F9 UI result: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
