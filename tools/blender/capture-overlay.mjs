import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';

const [blender] = requireBlenderBinaries();
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
  { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit' },
);
if (preparation.error) {
  throw preparation.error;
}
if (preparation.status !== 0) {
  process.exit(preparation.status ?? 1);
}

const renderOutputDirectory = mkdtempSync(join(tmpdir(), 'operatingline-visual-render-'));
try {
  const states = [
    'initial',
    'goal-request',
    'revision',
    'revision-collapsed',
    'proposal',
    'provider-disclosure',
    'provider-generating',
    'forward',
    'back',
    'hidden',
    'operator',
  ];
  for (const state of states) {
    const result = spawnSync(
      blender,
      [
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
      ],
      {
        env: {
          ...process.env,
          OPERATINGLINE_RENDER_OUTPUT_DIR: renderOutputDirectory,
          OPERATINGLINE_VISUAL_STATE: state,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: 'inherit',
      },
    );

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(renderOutputDirectory, { recursive: true, force: true });
}
