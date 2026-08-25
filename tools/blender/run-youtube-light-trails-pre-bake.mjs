import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const testFile = resolve('tests/e2e/blender/youtube_light_trails_pre_bake.py');
const workspace = mkdtempSync(join(tmpdir(), 'operating-line-youtube-light-trails-'));
syncBlenderExtensionResources();

function runPhase(blender, versionLabel, phase, blendPath) {
  console.log(`Testing YouTube light-trails pre-bake project (${phase}) with ${versionLabel}`);
  const args =
    phase === 'author'
      ? ['--factory-startup', '--background', '--python-exit-code', '1', '--python', testFile]
      : [blendPath, '--background', '--python-exit-code', '1', '--python', testFile];
  const result = spawnSync(blender, args, {
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      OPERATINGLINE_YOUTUBE_LIGHT_TRAILS_PHASE: phase,
      OPERATINGLINE_YOUTUBE_LIGHT_TRAILS_BLEND_PATH: blendPath,
    },
    stdio: 'inherit',
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `YouTube light-trails pre-bake ${phase} failed with exit code ${result.status ?? 1}`,
    );
  }
}

try {
  for (const [index, blender] of requireBlenderBinaries().entries()) {
    const version = spawnSync(blender, ['--version'], { encoding: 'utf8' });
    const versionLabel = version.stdout?.split('\n')[0] ?? blender;
    const blendPath = join(workspace, `youtube-light-trails-${index}.blend`);
    runPhase(blender, versionLabel, 'author', blendPath);
    runPhase(blender, versionLabel, 'verify', blendPath);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
