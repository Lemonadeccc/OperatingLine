import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  computeProtocolCanonicalJsonSha256,
  procedureCompoundCurrentStateSchema,
  verifyProcedureCompoundCurrentStateIntegrity,
} from '@operatingline/protocol';
import { validatePokeCompoundDecisionEvidence } from '../../services/orchestrator/src/procedure-replay.js';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const script = resolve('tests/e2e/blender/poke_compound_native_history.py');
const validatedVersions = new Set();
for (const blender of requireBlenderBinaries()) {
  const directory = mkdtempSync(join(tmpdir(), 'operatingline-poke-compound-'));
  const resultPath = join(directory, 'result.json');
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
        script,
      ],
      {
        env: {
          ...process.env,
          OPERATINGLINE_POKE_COMPOUND_RESULT: resultPath,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error) throw result.error;
    const evidence = JSON.parse(readFileSync(resultPath, 'utf8'));
    if (result.status !== 0 || evidence.ok !== true) {
      throw new Error(`Poke compound native-history proof failed: ${JSON.stringify(evidence)}`);
    }
    const version = String(evidence.blenderVersion).split(' ')[0];
    if (version !== '4.5.3' && version !== '5.1.1') {
      throw new Error(`Unexpected Blender proof version ${evidence.blenderVersion}`);
    }
    validatedVersions.add(version);
    for (const [name, state] of Object.entries(evidence.terminalStates ?? {})) {
      const parsed = procedureCompoundCurrentStateSchema.safeParse(state);
      if (!parsed.success || !verifyProcedureCompoundCurrentStateIntegrity(state)) {
        throw new Error(
          `Blender ${version} emitted invalid ${name} protocol current-state evidence: ${parsed.error}`,
        );
      }
    }
    for (const [name, emitted] of Object.entries(evidence.decisionEvidence ?? {})) {
      try {
        validatePokeCompoundDecisionEvidence({
          transition: name.startsWith('abandon_baseline') ? 'abandon_baseline' : name,
          ...emitted,
        });
        const consumptionSha256 = computeProtocolCanonicalJsonSha256(emitted.consumption);
        if (!emitted.journalDecisionConsumptionSha256s?.includes(consumptionSha256)) {
          throw new Error('consumption hash is absent from the persisted decision journal');
        }
      } catch (error) {
        throw new Error(`Blender ${version} emitted invalid ${name} decision evidence`, {
          cause: error,
        });
      }
    }
    if (
      ![
        'forward',
        'back',
        'redo',
        'unlock_final',
        'abandon_baseline',
        'abandon_baseline_history_lost',
      ].every((name) => evidence.decisionEvidence?.[name] !== undefined)
    ) {
      throw new Error(`Blender ${version} omitted required validated decision evidence`);
    }
    if (
      ![
        'forward',
        'back',
        'redo',
        'unlockFinal',
        'abandonBaseline',
        'abandonAfterHistoryLoss',
      ].every((name) => evidence.terminalStates?.[name] !== undefined)
    ) {
      throw new Error(`Blender ${version} omitted a required terminal release/current state`);
    }
    console.log(
      `POKE_COMPOUND_NATIVE_HISTORY_PASS ${JSON.stringify({ blender, blenderVersion: evidence.blenderVersion, checks: evidence.checks })}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (!validatedVersions.has('4.5.3') || !validatedVersions.has('5.1.1')) {
  throw new Error(
    `Poke proof requires Blender 4.5.3 and 5.1.1; observed ${[...validatedVersions].join(', ')}`,
  );
}
