import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/mirror_modifier_ui_smoke.py');

function near(actual, expected) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= 1e-6;
}

function validProperties(properties) {
  return (
    properties !== null &&
    typeof properties === 'object' &&
    JSON.stringify(properties.useAxis) === JSON.stringify([true, false, false]) &&
    JSON.stringify(properties.useBisectAxis) === JSON.stringify([false, false, false]) &&
    JSON.stringify(properties.useBisectFlipAxis) === JSON.stringify([false, false, false]) &&
    properties.useClip === false &&
    properties.useMirrorMerge === true &&
    near(properties.mergeThreshold, 0.001) &&
    near(properties.bisectThreshold, 0.001) &&
    properties.mirrorObjectAbsent === true &&
    properties.useMirrorVertexGroups === true &&
    properties.useMirrorU === false &&
    properties.useMirrorV === false &&
    properties.useMirrorUdim === false &&
    near(properties.offsetU, 0) &&
    near(properties.offsetV, 0) &&
    near(properties.mirrorOffsetU, 0) &&
    near(properties.mirrorOffsetV, 0) &&
    properties.showViewport === true &&
    properties.showRender === true &&
    properties.showInEditMode === true &&
    properties.showOnCage === false &&
    properties.useApplyOnSplineExposed === true &&
    properties.useApplyOnSpline === false
  );
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-mirror-ui-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing Mirror Modifier UI smoke with ${firstLine}`);
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
          OPERATINGLINE_MIRROR_UI_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Blender Mirror UI test failed with exit code ${result.status ?? 1}`);
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(`Blender exited without a readable Mirror UI result: ${error.message}`, {
        cause: error,
      });
    }
    if (
      payload.ok !== true ||
      payload.objectName !== 'Cube' ||
      payload.mode !== 'OBJECT' ||
      payload.editor !== 'PROPERTIES' ||
      payload.propertiesContext !== 'MODIFIER' ||
      JSON.stringify(payload.shortcut?.keys) !== JSON.stringify(['SHIFT', 'A']) ||
      payload.shortcut?.query !== 'mirror' ||
      JSON.stringify(payload.selectionPath) !==
        JSON.stringify(['Add Modifier', 'Generate', 'Mirror']) ||
      payload.operatorId !== 'OBJECT_OT_modifier_add' ||
      payload.operatorProperties?.type !== 'MIRROR' ||
      payload.operatorProperties?.use_selected_objects !== false ||
      payload.modifierType !== 'MIRROR' ||
      !validProperties(payload.modifierProperties) ||
      payload.sourceTopology?.vertices !== 8 ||
      payload.sourceTopology?.edges !== 12 ||
      payload.sourceTopology?.polygons !== 6 ||
      payload.evaluatedTopology?.vertices !== 16 ||
      payload.evaluatedTopology?.edges !== 24 ||
      payload.evaluatedTopology?.polygons !== 12 ||
      !Number.isSafeInteger(payload.meshDataPointerBefore) ||
      payload.meshDataPointerBefore <= 0 ||
      payload.meshDataPointerAfter !== payload.meshDataPointerBefore ||
      !Number.isInteger(payload.meshDatablockCountBefore) ||
      payload.meshDatablockCountBefore <= 0 ||
      payload.meshDatablockCountAfter !== payload.meshDatablockCountBefore ||
      !/^[a-f0-9]{64}$/.test(payload.sourceMeshSha256Before) ||
      payload.sourceMeshSha256After !== payload.sourceMeshSha256Before ||
      payload.sourceMeshContentUnchanged !== true ||
      payload.nativeModifierMutationVerified !== true
    ) {
      throw new Error(`Blender returned an invalid Mirror UI result: ${JSON.stringify(payload)}`);
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
