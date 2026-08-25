import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/subdivide_candidate_guidance.py');
const states = [
  'candidate-overview',
  'candidate-navigation',
  'candidate-select-menu',
  'candidate-edge-menu',
];
const expectedIds = [
  'candidate.workspace_layout',
  'candidate.use_accepted_active_mesh',
  'candidate.enter_edit_mode',
  'candidate.open_select_menu',
  'candidate.select_all_mesh_elements',
  'candidate.open_edge_menu',
  'candidate.execute_subdivide',
  'candidate.open_adjust_last_operation',
  'candidate.set_number_of_cuts',
  'candidate.set_smoothness',
  'candidate.return_to_object_mode',
];
const expectedTargets = [
  'Layout',
  'operatingline.blender.accepted_active_mesh',
  'VIEW3D_HT_header.mode',
  'VIEW3D_MT_select_edit_mesh',
  'mesh.select_all',
  'VIEW3D_MT_edit_mesh_edges',
  'mesh.subdivide',
  'screen.redo_last',
  'mesh.subdivide.number_cuts',
  'mesh.subdivide.smoothness',
  'VIEW3D_HT_header.mode',
];
const expectedNative = [false, false, false, true, true, true, true, false, false, false, false];
const expectedTrust = expectedNative.map((native) => (native ? 'exact_native' : 'reference_only'));
const expectedVersions = new Set(['4.5.3', '5.1.1']);
const observedVersions = new Set();

function assertPayload(payload, state, screenshotPath) {
  assert.equal(payload.ok, true);
  assert.equal(payload.state, state);
  const versionMatch = /^(\d+\.\d+\.\d+)/.exec(payload.blenderVersion);
  assert.ok(versionMatch, `Invalid Blender version: ${payload.blenderVersion}`);
  observedVersions.add(versionMatch[1]);

  assert.deepEqual(payload.projection, {
    projection: 'candidate_only',
    equivalence: 'not_equivalent_to_managed_action',
    executionAuthority: 'none',
    nativeEvidence: {
      kind: 'bounded_blender_ui_probe',
      executorId: 'blender.mesh_edit_subdivide_candidate_menu_f9.event_simulate.v1',
      hostVersions: ['4.5.3', '5.1.1'],
      managedActionExecuted: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      operationIds: expectedIds,
      nativeUndoCheckpointRequired: true,
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
    },
  });
  assert.equal(payload.candidate.catalogVersion, '1.50.0');
  assert.equal(payload.candidate.recipeId, 'blender.mesh.edit_subdivide.semantic.menu-candidate');
  assert.equal(payload.candidate.candidateOnly, true);
  assert.equal(payload.candidate.managedEquivalent, false);
  assert.equal(payload.candidate.nativePath, false);
  assert.equal(payload.candidate.operations.length, 11);
  assert.deepEqual(
    payload.candidate.operations.map((operation) => operation.ordinal),
    Array.from({ length: 11 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    payload.candidate.operations.map((operation) => operation.id),
    expectedIds,
  );
  assert.deepEqual(
    payload.candidate.operations.map((operation) => operation.targetId),
    expectedTargets,
  );
  assert.deepEqual(
    payload.candidate.operations.map((operation) => operation.native),
    expectedNative,
  );
  assert.deepEqual(
    payload.candidate.operations.map((operation) => operation.targetTrust),
    expectedTrust,
  );
  assert.deepEqual(payload.candidate.operations[2].parameters, { value: 'EDIT' });
  assert.deepEqual(payload.candidate.operations[4].parameters, { action: 'SELECT' });
  assert.deepEqual(payload.candidate.operations[8].parameters, { value: 3 });
  assert.deepEqual(payload.candidate.operations[9].parameters, { value: 0.25 });
  assert.deepEqual(payload.candidate.operations[10].parameters, { value: 'OBJECT' });

  assert.deepEqual(payload.authority, {
    nativeMenuSnapshotAbsent: true,
    acceptsSubdivide: false,
    guidedMenuActionMatches: false,
    globalNextResult: ['CANCELLED'],
  });
  assert.equal(payload.history.after, payload.history.before);
  assert.equal(payload.session.activeIndex, -1);
  assert.equal(payload.session.receiptCount, 0);
  assert.equal(payload.preCaptureState.replacementMeshExists, false);
  assert.equal(payload.preCaptureState.topology.vertices, 8);
  assert.equal(payload.preCaptureState.topology.edges, 12);
  assert.equal(payload.preCaptureState.topology.polygons, 6);
  assert.match(payload.preCaptureState.geometrySha256, /^[a-f0-9]{64}$/);
  assert.equal(payload.captureStateUnchanged, true);

  if (state === 'candidate-navigation') {
    assert.deepEqual(payload.navigationTrace, [
      { focusedOrdinal: 1, retrySerial: 0 },
      { focusedOrdinal: 2, retrySerial: 0 },
      { focusedOrdinal: 3, retrySerial: 0 },
      { focusedOrdinal: 3, retrySerial: 1 },
      { focusedOrdinal: 2, retrySerial: 1 },
    ]);
  }
  if (state === 'candidate-select-menu') {
    assert.equal(payload.candidate.focusedOrdinal, 5);
    assert.equal(payload.ui.menuName, 'VIEW3D_MT_select_edit_mesh');
    assert.equal(payload.ui.expectedVisibleLabel, 'All    05 CANDIDATE ONLY');
    assert.equal(payload.preCaptureState.mode, 'EDIT_MESH');
  } else if (state === 'candidate-edge-menu') {
    assert.equal(payload.candidate.focusedOrdinal, 7);
    assert.equal(payload.ui.menuName, 'VIEW3D_MT_edit_mesh_edges');
    assert.equal(payload.ui.expectedVisibleLabel, 'Subdivide    07 CANDIDATE ONLY');
    assert.equal(payload.preCaptureState.mode, 'EDIT_MESH');
  } else {
    assert.equal(payload.ui.menuName, null);
    assert.equal(payload.preCaptureState.mode, 'OBJECT');
  }
  assert.equal(payload.ui.nativeMenuPatchesEnabled, true);
  assert.ok(['INTERFACE', 'RUNNING_MODAL'].includes(payload.ui.invocationResult[0]));
  assert.ok(payload.screenshot.bytes > 10_000);
  assert.equal(statSync(screenshotPath).size, payload.screenshot.bytes);
  assert.ok(payload.screenshot.size[0] >= 1_000);
  assert.ok(payload.screenshot.size[1] >= 700);
}

const binaries = requireBlenderBinaries();
for (const blender of binaries) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (version.error) throw version.error;
  if (version.status !== 0) throw new Error(`Could not inspect Blender version for ${blender}`);
  const firstLine = version.stdout?.split('\n')[0] ?? blender;

  for (const state of states) {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-candidate-guidance-'));
    const resultPath = join(outputDirectory, 'result.json');
    const screenshotPath = join(outputDirectory, `${state}.png`);
    console.log(`Testing ${state} with ${firstLine}`);
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
            OPERATINGLINE_CANDIDATE_GUIDANCE_STATE: state,
            OPERATINGLINE_CANDIDATE_GUIDANCE_RESULT: resultPath,
            OPERATINGLINE_CANDIDATE_GUIDANCE_SCREENSHOT: screenshotPath,
            PYTHONDONTWRITEBYTECODE: '1',
          },
          stdio: 'inherit',
          timeout: 60_000,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`${state} failed with Blender exit code ${result.status ?? 1}`);
      }

      let payload;
      try {
        payload = JSON.parse(readFileSync(resultPath, 'utf8'));
      } catch (error) {
        throw new Error(`${state} did not produce a readable result: ${error.message}`, {
          cause: error,
        });
      }
      assertPayload(payload, state, screenshotPath);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}

assert.deepEqual(observedVersions, expectedVersions);
