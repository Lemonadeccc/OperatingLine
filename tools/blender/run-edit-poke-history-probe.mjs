import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const testFile = resolve('tests/e2e/blender/edit_poke_history_probe.py');
const args = process.argv.slice(2);
const requestedBinaries = [];
let requestedVersion = null;

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--blender' && args[index + 1]) {
    requestedBinaries.push(resolve(args[index + 1]));
    index += 1;
  } else if (args[index] === '--version' && args[index + 1]) {
    requestedVersion = args[index + 1];
    index += 1;
  } else {
    throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
}

const binaries =
  requestedBinaries.length > 0 ? [...new Set(requestedBinaries)] : requireBlenderBinaries();
for (const blender of binaries) {
  if (!existsSync(blender)) throw new Error(`Blender executable does not exist: ${blender}`);
}

const candidates = binaries
  .map((blender) => {
    const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
    if (version.error) throw version.error;
    if (version.status !== 0) throw new Error(`Unable to inspect Blender version: ${blender}`);
    return { blender, firstLine: version.stdout?.split('\n')[0] ?? blender };
  })
  .filter(({ firstLine }) => requestedVersion === null || firstLine.includes(requestedVersion));

if (candidates.length === 0) {
  throw new Error(`No Blender executable matched requested version ${requestedVersion}`);
}

const scenarios = [
  'undo_tab_redo',
  'undo_twice_tab_redo',
  'checkpoint_roundtrip',
  'object_four_step_roundtrip',
  'object_ed_push_roundtrip',
  'edit_ed_push_roundtrip',
  'edit_post_push_roundtrip',
  'edit_grouped_operator_roundtrip',
];
const fullActionScenarios = new Set([
  'undo_tab_redo',
  'undo_twice_tab_redo',
  'checkpoint_roundtrip',
  'object_four_step_roundtrip',
  'object_ed_push_roundtrip',
]);
const editLeafScenarios = new Set([
  'edit_ed_push_roundtrip',
  'edit_post_push_roundtrip',
  'edit_grouped_operator_roundtrip',
]);
const failures = [];
for (const { blender, firstLine } of candidates) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-edit-poke-history-'));
  const evaluatedCandidates = [];
  let allScenariosExecuted = true;

  console.log(
    `Probing ${scenarios.length} independent bounded Edit Mode Poke Undo/Redo scenarios with ${firstLine}`,
  );
  for (const scenario of scenarios) {
    const resultPath = join(outputDirectory, `${scenario}.json`);
    console.log(`Running ${scenario} with ${firstLine}`);
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
          OPERATINGLINE_EDIT_POKE_HISTORY_RESULT: resultPath,
          OPERATINGLINE_EDIT_POKE_HISTORY_SCENARIO: scenario,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      },
    );

    let payload;
    try {
      payload = JSON.parse(readFileSync(resultPath, 'utf8'));
    } catch (error) {
      allScenariosExecuted = false;
      evaluatedCandidates.push({
        scenario,
        outcome: 'probe_error',
        resultPath,
        error: `No readable evidence: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (result.error || result.status !== 0 || payload.ok !== true) {
      allScenariosExecuted = false;
      evaluatedCandidates.push({
        scenario,
        outcome: 'probe_error',
        resultPath,
        error: result.error?.message ?? `Blender exited with status ${result.status}`,
        evidence: payload,
      });
      continue;
    }

    evaluatedCandidates.push({
      scenario,
      sequence: payload.sequence,
      outcome: payload.candidateGate,
      failedChecks: payload.failedChecks,
      checks: payload.checks,
      snapshots: payload.snapshots,
      resultPath,
    });
  }

  const fullActionGatePassed =
    allScenariosExecuted &&
    evaluatedCandidates.length === scenarios.length &&
    evaluatedCandidates.some(
      (candidate) => fullActionScenarios.has(candidate.scenario) && candidate.outcome === 'passed',
    );
  const editLeafGatePassed =
    allScenariosExecuted &&
    evaluatedCandidates.some(
      (candidate) => editLeafScenarios.has(candidate.scenario) && candidate.outcome === 'passed',
    );
  const aggregate = {
    ok: fullActionGatePassed,
    boundedGate: fullActionGatePassed ? 'passed' : 'failed',
    fullActionGate: fullActionGatePassed ? 'passed' : 'failed',
    editLeafGate: editLeafGatePassed ? 'passed' : 'failed',
    blenderVersion: firstLine,
    allScenariosExecuted,
    evaluatedCandidates,
  };
  const aggregatePath = join(outputDirectory, 'aggregate.json');
  writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(
    `EDIT_POKE_HISTORY_AGGREGATE ${JSON.stringify({
      boundedGate: aggregate.boundedGate,
      fullActionGate: aggregate.fullActionGate,
      editLeafGate: aggregate.editLeafGate,
      blenderVersion: aggregate.blenderVersion,
      allScenariosExecuted: aggregate.allScenariosExecuted,
      outcomes: evaluatedCandidates.map(({ scenario, outcome, failedChecks }) => ({
        scenario,
        outcome,
        failedChecks,
      })),
      aggregatePath,
    })}`,
  );

  if (fullActionGatePassed) {
    rmSync(outputDirectory, { recursive: true, force: true });
    console.log(`Poke native-history stop gate passed with ${firstLine}`);
  } else {
    failures.push({ blender, firstLine, aggregatePath, evaluatedCandidates });
    console.error(
      `Poke native-history stop gate failed; evidence directory retained: ${outputDirectory}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(
    `Poke native-history stop gate failed after executing all independent candidates: ${JSON.stringify(
      failures.map(({ blender, firstLine, aggregatePath, evaluatedCandidates }) => ({
        blender,
        firstLine,
        aggregatePath,
        outcomes: evaluatedCandidates.map(({ scenario, outcome, failedChecks }) => ({
          scenario,
          outcome,
          failedChecks,
        })),
      })),
    )}`,
  );
}
