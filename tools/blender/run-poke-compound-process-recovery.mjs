import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  procedureCompoundCurrentStateSchema,
  verifyProcedureCompoundCurrentStateIntegrity,
} from '@operatingline/protocol';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const script = resolve('tests/e2e/blender/poke_compound_process_recovery.py');
const phases = [
  { name: 'seed-crash', expectedExitCode: 23, factoryStartup: true },
  { name: 'recover', expectedExitCode: 0, factoryStartup: false },
  { name: 'reload-quarantine', expectedExitCode: 0, factoryStartup: false },
];
const validatedVersions = new Set();

function validateCurrentState(state, phase) {
  const parsed = procedureCompoundCurrentStateSchema.safeParse(state);
  assert.equal(parsed.success, true, `${phase} emitted invalid current-state protocol evidence`);
  assert.equal(
    verifyProcedureCompoundCurrentStateIntegrity(state),
    true,
    `${phase} emitted current-state evidence with invalid integrity`,
  );
}

for (const blender of requireBlenderBinaries()) {
  const directory = mkdtempSync(join(tmpdir(), 'operatingline-poke-process-recovery-'));
  const blendPath = join(directory, 'poke-recovery.blend');
  const evidenceByPhase = new Map();
  try {
    for (const phase of phases) {
      const resultPath = join(directory, `${phase.name}.json`);
      const args = phase.factoryStartup ? ['--factory-startup'] : [blendPath];
      args.push('--background', '--python-exit-code', '1', '--python', script);
      const result = spawnSync(blender, args, {
        env: {
          ...process.env,
          OPERATINGLINE_POKE_PROCESS_PHASE: phase.name,
          OPERATINGLINE_POKE_PROCESS_BLEND: blendPath,
          OPERATINGLINE_POKE_PROCESS_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        encoding: 'utf8',
        timeout: 30_000,
        killSignal: 'SIGKILL',
      });
      if (result.error) throw result.error;
      assert.equal(
        result.status,
        phase.expectedExitCode,
        `${phase.name} exited unexpectedly:\n${result.stdout}\n${result.stderr}`,
      );
      const evidence = JSON.parse(readFileSync(resultPath, 'utf8'));
      assert.equal(evidence.ok, true);
      assert.equal(evidence.phase, phase.name);
      assert.equal(evidence.markerPersisted, true);
      assert.match(evidence.processIdentitySha256, /^[a-f0-9]{64}$/);
      assert.match(evidence.documentFingerprintSha256, /^[a-f0-9]{64}$/);
      validateCurrentState(evidence.currentState, phase.name);
      evidenceByPhase.set(phase.name, evidence);
    }

    const seed = evidenceByPhase.get('seed-crash');
    const recovered = evidenceByPhase.get('recover');
    const reloaded = evidenceByPhase.get('reload-quarantine');
    assert.ok(seed && recovered && reloaded);
    assert.equal(seed.currentState.status, 'recovery_required');
    assert.equal(seed.currentState.inProgressLeafId, 'poke.forward.enter_edit');
    assert.equal(seed.simulatedCrashExitCode, 23);
    assert.ok(seed.blendBytes > 10_000);
    assert.ok(statSync(blendPath).size > 10_000);
    assert.equal(recovered.beforeStatus, 'recovery_required');
    assert.equal(recovered.classification, 'history_lost');
    assert.equal(reloaded.beforeStatus, 'history_lost');
    assert.equal(reloaded.classification, 'history_lost');
    assert.equal(reloaded.autoResumeRejected, true);
    for (const evidence of [recovered, reloaded]) {
      assert.equal(evidence.currentState.status, 'history_lost');
      assert.equal(evidence.currentState.historyLock, 'quarantined');
      assert.equal(evidence.currentState.historyContinuity, 'lost_permanently');
      assert.equal(evidence.currentState.nativeHistoryLossRecorded, true);
      assert.deepEqual(evidence.currentState.permittedHistoryTransitions, ['abandon_baseline']);
    }
    assert.equal(
      new Set([seed, recovered, reloaded].map((evidence) => evidence.processIdentitySha256)).size,
      3,
    );
    assert.equal(
      new Set([seed, recovered, reloaded].map((evidence) => evidence.documentFingerprintSha256))
        .size,
      1,
    );
    const version = String(reloaded.blenderVersion).split(' ')[0];
    assert.ok(version === '4.5.3' || version === '5.1.1');
    validatedVersions.add(version);
    console.log(
      `POKE_COMPOUND_PROCESS_RECOVERY_PASS ${JSON.stringify({ blenderVersion: reloaded.blenderVersion, phases: phases.map(({ name }) => name) })}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

assert.deepEqual(validatedVersions, new Set(['4.5.3', '5.1.1']));
