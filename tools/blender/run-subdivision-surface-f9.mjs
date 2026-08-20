import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
const executorId = 'blender.subdivision_surface_f9.event_simulate.v1';
const operationIds = [
  'shortcut.add_subdivision_surface_level_one',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_viewport_level',
  'shortcut.close_adjust_last_operation',
];
const fixtureIdentity = {
  proofId: '00000000-0000-4000-8000-000000000021',
  requestId: '00000000-0000-4000-8000-000000000022',
  deliveryId: '00000000-0000-4000-8000-000000000023',
  bindingContentSha256: 'b'.repeat(64),
};

function lengthDelimited(value) {
  return Buffer.concat([Buffer.from(`${value.length}:`, 'ascii'), value]);
}

function canonicalProtocolValue(value, ancestors = new Set()) {
  if (value === null) return Buffer.from('n', 'ascii');
  if (value === false) return Buffer.from('f', 'ascii');
  if (value === true) return Buffer.from('t', 'ascii');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical protocol numbers must be finite');
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
    return Buffer.from(`d${bytes.toString('hex')}`, 'ascii');
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from(`s${bytes.length}:`, 'ascii'), bytes]);
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new Error('Value is not a canonical protocol JSON value');
  }
  if (ancestors.has(value)) throw new Error('Canonical protocol values must not contain cycles');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Buffer.concat([
        Buffer.from(`a${value.length}:`, 'ascii'),
        ...value.map((item) => lengthDelimited(canonicalProtocolValue(item, ancestors))),
      ]);
    }
    const entries = Object.entries(value).sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
    );
    return Buffer.concat([
      Buffer.from(`o${entries.length}:`, 'ascii'),
      ...entries.flatMap(([key, item]) => [
        lengthDelimited(canonicalProtocolValue(key, ancestors)),
        lengthDelimited(canonicalProtocolValue(item, ancestors)),
      ]),
    ]);
  } finally {
    ancestors.delete(value);
  }
}

function validReceiptChain(receipts) {
  if (!Array.isArray(receipts) || receipts.length !== operationIds.length) return false;
  let previousReceiptSha256 = null;
  return receipts.every((receipt, operationIndex) => {
    if (receipt === null || typeof receipt !== 'object') return false;
    const { contentSha256, ...body } = receipt;
    const computed = createHash('sha256').update(canonicalProtocolValue(body)).digest('hex');
    const valid =
      body.order === operationIndex + 1 &&
      body.operationId === operationIds[operationIndex] &&
      body.proofId === fixtureIdentity.proofId &&
      body.requestId === fixtureIdentity.requestId &&
      body.deliveryId === fixtureIdentity.deliveryId &&
      body.bindingContentSha256 === fixtureIdentity.bindingContentSha256 &&
      body.previousReceiptContentSha256 === previousReceiptSha256 &&
      body.outcome === 'succeeded' &&
      contentSha256 === computed;
    previousReceiptSha256 = contentSha256;
    return valid;
  });
}

function validHashedObservation(observation) {
  if (observation === null || typeof observation !== 'object') return false;
  const { contentSha256, ...body } = observation;
  return (
    typeof body.sceneFingerprintSha256 === 'string' &&
    contentSha256 === createHash('sha256').update(canonicalProtocolValue(body)).digest('hex')
  );
}

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
          '--python-expr',
          'import bpy; bpy.context.preferences.view.show_splash = False',
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
      const observation = payload.observation;
      const preflight = payload.preflight;
      const nativeHistory = payload.nativeHistory;
      const receipts = payload.operationReceipts;
      const baselineSnapshot = payload.baselineSceneSnapshot;
      const finalSnapshot = payload.finalSceneSnapshot;
      const baselineFingerprint = createHash('sha256')
        .update(canonicalProtocolValue(baselineSnapshot))
        .digest('hex');
      const finalFingerprint = createHash('sha256')
        .update(canonicalProtocolValue(finalSnapshot))
        .digest('hex');
      if (
        payload.ok !== true ||
        payload.executorId !== executorId ||
        payload.evidenceClass !== 'blender_event_simulation' ||
        payload.osHidInput !== false ||
        payload.managedActionResult !== 'not_executed' ||
        payload.managedIdentityVerified !== false ||
        payload.targetLevel !== viewportLevel ||
        payload.targetProfile !== 'factory_cube_8_12_6' ||
        payload.mutationStarted !== true ||
        payload.lastCompletedOperation !== operationIds.at(-1) ||
        payload.requiresUndoToUnlock !== true ||
        payload.baselineSceneFingerprintSha256 !== baselineFingerprint ||
        payload.finalSceneFingerprintSha256 !== finalFingerprint ||
        JSON.stringify(baselineSnapshot).toLowerCase().includes('pointer') ||
        JSON.stringify(finalSnapshot).toLowerCase().includes('pointer') ||
        !Array.isArray(baselineSnapshot?.modifiers) ||
        baselineSnapshot.modifiers.length !== 0 ||
        finalSnapshot?.modifiers?.length !== 1 ||
        finalSnapshot.modifiers[0]?.type !== 'SUBSURF' ||
        finalSnapshot.modifiers[0]?.levels !== viewportLevel ||
        payload.operationReceiptChainVerified !== true ||
        !validReceiptChain(receipts) ||
        receipts.some((receipt, index) => receipt.eventEvidence.length !== [2, 2, 9, 2][index]) ||
        receipts.some((receipt) => receipt.eventEvidence.some((event) => event.type === 'ESC')) ||
        receipts[0].eventEvidence.some((event) => event.type !== 'ONE' || event.ctrl !== true) ||
        receipts[1].eventEvidence.some((event) => event.type !== 'F9') ||
        receipts[2].eventEvidence.map((event) => event.type).join(',') !==
          `MOUSEMOVE,LEFTMOUSE,LEFTMOUSE,LEFTMOUSE,LEFTMOUSE,A,${['', 'ONE', 'TWO', 'THREE'][viewportLevel]},RET,RET` ||
        receipts[3].eventEvidence.some((event) => event.type !== 'RET') ||
        preflight?.satisfied !== true ||
        preflight.targetProfile !== 'factory_cube_8_12_6' ||
        preflight.authorizationHookVerified !== true ||
        preflight.blenderVersionSupported !== true ||
        preflight.splashDisabled !== true ||
        preflight.workspace !== 'Layout' ||
        preflight.areaType !== 'VIEW_3D' ||
        preflight.regionType !== 'WINDOW' ||
        preflight.keymap !== 'Blender' ||
        preflight.eventSimulateCapability !== 'callable' ||
        preflight.modalOperatorCount !== 0 ||
        preflight.objectName !== 'Cube' ||
        preflight.objectPointer !== observation?.objectPointer ||
        preflight.meshPointer !== observation?.meshPointer ||
        preflight.meshDatablockCount !== observation?.meshDatablockCount ||
        preflight.mode !== 'OBJECT' ||
        preflight.selectedObjectCount !== 1 ||
        preflight.modifierCount !== 0 ||
        !sameRecord(preflight.topology, { vertices: 8, edges: 12, polygons: 6 }) ||
        observation?.kind !== 'subdivision_surface_shortcut_ready' ||
        typeof observation.observedAt !== 'string' ||
        observation.observedAt.length === 0 ||
        observation.satisfied !== true ||
        observation.sceneFingerprintSha256 !== finalFingerprint ||
        observation.objectName !== 'Cube' ||
        observation.mode !== 'OBJECT' ||
        observation.operatorId !== 'OBJECT_OT_subdivision_set' ||
        !sameRecord(observation.operatorProperties, expectedOperatorProperties) ||
        observation.subsurfModifierCount !== 1 ||
        observation.modifierCount !== 1 ||
        observation.modifierName !== 'Subdivision' ||
        observation.viewportLevel !== viewportLevel ||
        observation.renderLevel !== 2 ||
        !sameRecord(observation.modifierFlags, expectedModifierFlags) ||
        !sameRecord(observation.evaluatedTopology, expectedTopology[viewportLevel]) ||
        !Number.isSafeInteger(observation.objectPointer) ||
        observation.objectPointer <= 0 ||
        !Number.isSafeInteger(observation.meshPointer) ||
        observation.meshPointer <= 0 ||
        !Number.isSafeInteger(observation.modifierPointer) ||
        observation.modifierPointer <= 0 ||
        !Number.isInteger(observation.meshDatablockCount) ||
        observation.meshDatablockCount <= 0 ||
        observation.objectIdentityUnchanged !== true ||
        observation.meshIdentityUnchanged !== true ||
        observation.meshDatablockCountUnchanged !== true ||
        observation.modeUnchanged !== true ||
        nativeHistory?.availability !== 'verified' ||
        nativeHistory.boundary !== 'single_native_undo_redo' ||
        nativeHistory.eventEvidence?.undo?.some(
          (event) => event.type !== 'Z' || event.ctrl !== true || event.shift !== false,
        ) ||
        nativeHistory.eventEvidence?.redo?.some(
          (event) => event.type !== 'Z' || event.ctrl !== true || event.shift !== true,
        ) ||
        nativeHistory.undoObservation?.subsurfModifierCount !== 0 ||
        nativeHistory.undoObservation?.objectPointer !== observation.objectPointer ||
        nativeHistory.undoObservation?.meshPointer !== observation.meshPointer ||
        nativeHistory.undoObservation?.meshDatablockCount !== observation.meshDatablockCount ||
        nativeHistory.undoObservation?.mode !== 'OBJECT' ||
        nativeHistory.undoObservation?.sceneFingerprintSha256 !== baselineFingerprint ||
        !validHashedObservation(nativeHistory.undoObservation) ||
        nativeHistory.redoObservation?.satisfied !== true ||
        nativeHistory.redoObservation?.viewportLevel !== viewportLevel ||
        nativeHistory.redoObservation?.objectPointer !== observation.objectPointer ||
        nativeHistory.redoObservation?.meshPointer !== observation.meshPointer ||
        nativeHistory.redoObservation?.meshDatablockCount !== observation.meshDatablockCount ||
        nativeHistory.redoObservation?.mode !== 'OBJECT' ||
        nativeHistory.redoObservation?.subsurfModifierCount !== 1 ||
        nativeHistory.redoObservation?.objectIdentityUnchanged !== true ||
        nativeHistory.redoObservation?.meshIdentityUnchanged !== true ||
        nativeHistory.redoObservation?.meshDatablockCountUnchanged !== true ||
        nativeHistory.redoObservation?.modeUnchanged !== true ||
        nativeHistory.redoObservation?.operatorPropertiesEvidence !== 'operation_receipt' ||
        nativeHistory.redoObservation?.sceneFingerprintSha256 !== finalFingerprint ||
        !validHashedObservation(nativeHistory.redoObservation) ||
        !sameRecord(nativeHistory.redoObservation?.modifierFlags, expectedModifierFlags) ||
        !sameRecord(
          nativeHistory.redoObservation?.evaluatedTopology,
          expectedTopology[viewportLevel],
        )
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
