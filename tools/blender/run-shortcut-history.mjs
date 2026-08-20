import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/shortcut_history_round_trip.py');

for (const blender of requireBlenderBinaries()) {
  const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
  const firstLine = version.stdout?.split('\n')[0] ?? blender;
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-shortcut-history-'));
  const resultPath = join(outputDirectory, 'result.json');
  console.log(`Testing shortcut native history with ${firstLine}`);
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
          OPERATINGLINE_SHORTCUT_HISTORY_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Blender shortcut history test failed with exit code ${result.status ?? 1}`);
    }
    const payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    if (
      payload.ok !== true ||
      payload.locked !== true ||
      payload.markerRole !== 'journal_association_not_scene_restore_evidence' ||
      payload.markerMatchedAfterRedo !== true ||
      payload.controllerRestartRebound !== true ||
      payload.driverStartCount !== 1 ||
      payload.driverEventSimulateCountAtTerminal !==
        payload.driverEventSimulateCountAfterRecovery ||
      payload.recoveryDidNotReplayInput !== true ||
      payload.recoveryWasIdempotent !== true ||
      payload.terminalResultAcceptedBeforeAckLoss !== true ||
      payload.terminalOutboxMatchesAcceptedResult !== true ||
      payload.deliveryFailureRetainedMarkerAndLock !== true ||
      payload.singleLogicalEntryAfterRecovery !== true ||
      payload.checkpointLineagePreserved !== true ||
      payload.controllerIdentityReused !== true ||
      payload.loadIdentityRotated !== true ||
      payload.markerDidNotDetermineIdentity !== true ||
      payload.instanceIdentitySource !== 'driver_namespace_not_scene_marker' ||
      payload.roundTripCount !== 2 ||
      !Array.isArray(payload.events) ||
      payload.events.length !== 4 ||
      payload.events[0]?.status !== 'restored' ||
      payload.events[1]?.status !== 'reapplied_locked' ||
      payload.events[2]?.status !== 'restored' ||
      payload.events[3]?.status !== 'reapplied_locked'
    ) {
      throw new Error(`Invalid shortcut history result: ${JSON.stringify(payload)}`);
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
