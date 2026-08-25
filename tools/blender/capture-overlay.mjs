import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const VERSION_TIMEOUT_MS = 10_000;
const PREPARATION_TIMEOUT_MS = 30_000;
const TIMER_FAILURE_TIMEOUT_MS = 10_000;
const CAPTURE_TIMEOUT_MS = 60_000;

const blenderBinaries = requireBlenderBinaries();
const blenderVersions = new Map(
  blenderBinaries.map((candidate) => {
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      killSignal: 'SIGTERM',
      timeout: VERSION_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Could not inspect Blender version for ${candidate}`);
    }
    const match = /^Blender (\d+\.\d+\.\d+)/m.exec(result.stdout ?? '');
    if (!match) throw new Error(`Could not parse Blender version for ${candidate}`);
    return [candidate, match[1]];
  }),
);
const blender =
  blenderBinaries.find((candidate) => blenderVersions.get(candidate) === '4.5.3') ??
  blenderBinaries[0];
const artifactDirectory = resolve('artifacts/blender');
const baseFile = resolve(artifactDirectory, 'visual-smoke-factory.blend');
const captureScript = resolve('tests/e2e/blender/capture_overlay.py');
mkdirSync(artifactDirectory, { recursive: true });

const prepareCode = [
  'import bpy',
  `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(baseFile)})`,
].join('; ');
const preparation = spawnSync(
  blender,
  ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', prepareCode],
  {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    killSignal: 'SIGTERM',
    stdio: 'inherit',
    timeout: PREPARATION_TIMEOUT_MS,
  },
);
if (preparation.error) {
  throw preparation.error;
}
if (preparation.status !== 0) {
  process.exit(preparation.status ?? 1);
}

const captureArguments = [
  baseFile,
  '--enable-event-simulate',
  '--window-geometry',
  '80',
  '80',
  '1600',
  '1000',
  '--python-exit-code',
  '1',
  '--python',
  captureScript,
];

const renderOutputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-visual-render-'));
try {
  const timerFailureProbe = spawnSync(blender, captureArguments, {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPERATINGLINE_RENDER_OUTPUT_DIR: renderOutputDirectory,
      OPERATINGLINE_VISUAL_STATE: 'timer-failure-probe',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    killSignal: 'SIGTERM',
    timeout: TIMER_FAILURE_TIMEOUT_MS,
  });
  if (timerFailureProbe.error) {
    throw new Error(
      `Visual timer failure probe did not exit promptly: ${timerFailureProbe.error.message}`,
      { cause: timerFailureProbe.error },
    );
  }
  if (timerFailureProbe.status !== 1 || timerFailureProbe.signal !== null) {
    throw new Error(
      `Visual timer failure probe must exit with status 1; status=${timerFailureProbe.status}, ` +
        `signal=${timerFailureProbe.signal}, stderr=${timerFailureProbe.stderr ?? ''}`,
    );
  }

  const states = [
    'initial',
    'node-editor',
    'node-editor-geometry',
    'goal-request',
    'revision',
    'revision-collapsed',
    'proposal',
    'initial-provider-disclosure',
    'provider-disclosure',
    'dialogue-disclosure',
    'forward',
    'back',
    'hidden',
    'operator',
    'menu-add',
    'menu-mesh',
    'menu-cube',
    'menu-icosphere',
    'menu-torus',
    'menu-cone',
    'menu-cylinder',
  ];
  const nodeEditorVersions = new Set();
  for (const state of states) {
    const binaries = state === 'node-editor-geometry' ? blenderBinaries : [blender];
    for (const stateBlender of binaries) {
      if (state === 'node-editor-geometry') {
        nodeEditorVersions.add(blenderVersions.get(stateBlender));
      }
      const result = spawnSync(stateBlender, captureArguments, {
        env: {
          ...process.env,
          OPERATINGLINE_RENDER_OUTPUT_DIR: renderOutputDirectory,
          OPERATINGLINE_VISUAL_STATE: state,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        killSignal: 'SIGTERM',
        stdio: 'inherit',
        timeout: CAPTURE_TIMEOUT_MS,
      });

      if (result.error) {
        throw new Error(`Visual state ${state} did not exit promptly: ${result.error.message}`, {
          cause: result.error,
        });
      }
      if (result.signal !== null) {
        throw new Error(`Visual state ${state} exited from signal ${result.signal}`);
      }
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
      }
    }
    if (process.exitCode) break;
  }
  if (!process.exitCode && (!nodeEditorVersions.has('4.5.3') || !nodeEditorVersions.has('5.1.1'))) {
    throw new Error(
      `Node Editor visual proof requires Blender 4.5.3 and 5.1.1; observed ${[
        ...nodeEditorVersions,
      ].join(', ')}`,
    );
  }
} finally {
  rmSync(renderOutputDirectory, { recursive: true, force: true });
}
