import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/uv_sphere_menu_control_driver_round_trip.py');
const operationIds = [
  'workspace.layout',
  'menu.add',
  'menu.mesh',
  'operator.uv_sphere',
  'control.location',
  'control.scale',
  'control.object_name',
];
const expectedArguments = {
  resourceId: 'proof.uv_sphere.eye',
  objectName: 'OperatingLine.TutorialEye',
  radius: 1.5,
  location: [1.25, -2, 0.75],
};
const expectedOperationSummaries = [
  {
    operationId: 'workspace.layout',
    status: 'precondition_verified',
    path: ['Layout'],
    parameters: {},
  },
  {
    operationId: 'menu.add',
    status: 'control_executed',
    path: ['Layout', 'Add'],
    parameters: {},
  },
  {
    operationId: 'menu.mesh',
    status: 'control_executed',
    path: ['Layout', 'Add', 'Mesh'],
    parameters: {},
  },
  {
    operationId: 'operator.uv_sphere',
    status: 'control_executed',
    path: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
    parameters: { radius: 1 },
  },
  {
    operationId: 'control.location',
    status: 'control_executed',
    path: ['Sidebar', 'Item', 'Transform', 'Location'],
    parameters: { value: expectedArguments.location },
  },
  {
    operationId: 'control.scale',
    status: 'control_executed',
    path: ['Sidebar', 'Item', 'Transform', 'Scale'],
    parameters: { value: [1.5, 1.5, 1.5] },
  },
  {
    operationId: 'control.object_name',
    status: 'control_executed',
    path: ['Properties', 'Object', 'Name'],
    parameters: { value: expectedArguments.objectName },
  },
];
const historyLabels = [
  'final',
  ...Array.from({ length: 8 }, (_, index) => `undo-${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `redo-${index + 1}`),
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validate(payload, expectedHostVersion) {
  const finalState = payload.finalState;
  const history = payload.historySnapshots;
  if (
    payload.ok !== true ||
    payload.proofFormatVersion !== '1.0.0' ||
    payload.executorId !== 'blender.uv_sphere_menu_controls.event_simulate.v1' ||
    payload.targetProfile !== 'factory_layout_three_object_ui_scale_2' ||
    payload.executionBoundary !== 'blender_window_event_simulate' ||
    payload.transport !== 'event_simulate' ||
    payload.osHidInput !== false ||
    payload.managedActionExecuted !== false ||
    payload.managedReceiptCreated !== false ||
    payload.authorization !== 'accepted_replay_next_step' ||
    payload.hostVersion !== expectedHostVersion ||
    payload.uiScale !== 2 ||
    !same(payload.operationIds, operationIds) ||
    !same(payload.operationSummaries, expectedOperationSummaries) ||
    payload.acceptedAction?.name !== 'blender.mesh.create_uv_sphere' ||
    !same(payload.acceptedAction?.arguments, expectedArguments) ||
    payload.sourceOperator?.id !== 'MESH_OT_primitive_uv_sphere_add' ||
    payload.sourceOperator?.segments !== 32 ||
    payload.sourceOperator?.ringCount !== 16 ||
    payload.sourceOperator?.radius !== 1 ||
    !same(payload.sourceOperator?.location, [0, 0, 0]) ||
    finalState?.objectName !== expectedArguments.objectName ||
    finalState?.objectType !== 'MESH' ||
    !same(finalState?.location, expectedArguments.location) ||
    !same(finalState?.scale, [1.5, 1.5, 1.5]) ||
    !same(finalState?.meshTopology, { edges: 992, polygons: 512, vertices: 482 }) ||
    !sha256(finalState?.meshSha256) ||
    payload.eventSimulateCount !== 146 ||
    !sha256(payload.eventSequenceSha256) ||
    payload.nativeUndoDepth !== 8 ||
    payload.strongObservationKind !== 'uv_sphere_menu_controls_ready' ||
    payload.nativeUndoCheckpointRequired !== true ||
    !Array.isArray(history) ||
    !same(
      history.map((snapshot) => snapshot.label),
      historyLabels,
    ) ||
    !sha256(payload.baselineSceneFingerprintSha256) ||
    !sha256(payload.finalSceneFingerprintSha256) ||
    payload.restoredSceneFingerprintSha256 !== payload.baselineSceneFingerprintSha256 ||
    payload.reappliedSceneFingerprintSha256 !== payload.finalSceneFingerprintSha256 ||
    history[8]?.sceneFingerprintSha256 !== payload.baselineSceneFingerprintSha256 ||
    history.at(-1)?.sceneFingerprintSha256 !== payload.finalSceneFingerprintSha256 ||
    history[8]?.proofObjectName !== null ||
    history[8]?.activeObject !== 'Cube' ||
    history.at(-1)?.proofObjectName !== expectedArguments.objectName ||
    payload.menuControlExecutionVerified !== true ||
    payload.strongCurrentStateVerified !== true ||
    payload.nativeUndoCheckpointVerified !== true
  ) {
    throw new Error(
      `Blender returned an invalid UV Sphere menu-control proof: ${JSON.stringify(payload)}`,
    );
  }
}

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const expectedHostVersion = firstLine.includes('4.5.3') ? '4.5.3' : '5.1.1';
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-uv-sphere-menu-'));
  const resultPath = join(outputDirectory, 'result.json');

  console.log(`Testing UV Sphere menu controls with ${firstLine}`);
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
          OPERATINGLINE_UV_SPHERE_MENU_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 90_000,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Blender UV Sphere menu-control test failed with exit code ${result.status ?? 1}`,
      );
    }
    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Blender exited without a readable UV Sphere menu-control result: ${error.message}`,
        { cause: error },
      );
    }
    validate(payload, expectedHostVersion);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
