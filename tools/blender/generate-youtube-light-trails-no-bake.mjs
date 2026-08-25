import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const tutorialId = '965bgIUHoxA';
const testFile = resolve('tests/e2e/blender/light_trails_no_bake.py');
const blendPath = resolve(
  process.env.OPERATINGLINE_LIGHT_TRAILS_BLEND_PATH ??
    `artifacts/youtube/${tutorialId}/OperatingLine.LightTrails.EvidenceLimited.NoBake.blend`,
);

const artifactExists = existsSync(blendPath);

const candidates = requireBlenderBinaries().map((binary) => {
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  return {
    binary,
    label: version.stdout?.split('\n')[0] ?? binary,
  };
});
const blender = candidates.find((candidate) => candidate.label.includes('4.5.3'));
if (blender === undefined) {
  throw new Error('The tutorial reproduction requires the installed Blender 4.5.3 binary.');
}

syncBlenderExtensionResources();

function runPhase(phase) {
  const args =
    phase === 'author'
      ? ['--factory-startup', '--background', '--python-exit-code', '1', '--python', testFile]
      : [blendPath, '--background', '--python-exit-code', '1', '--python', testFile];
  const result = spawnSync(blender.binary, args, {
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      OPERATINGLINE_LIGHT_TRAILS_PHASE: phase,
      OPERATINGLINE_LIGHT_TRAILS_PROFILE: 'youtube_965bgIUHoxA',
      OPERATINGLINE_LIGHT_TRAILS_BLEND_PATH: blendPath,
    },
    stdio: 'inherit',
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Tutorial light-trails ${phase} failed with exit code ${result.status ?? 1}`);
  }
}

if (!artifactExists) runPhase('author');
runPhase('verify');
console.log(
  `${artifactExists ? 'Verified existing' : 'Created verified'} no-bake tutorial artifact with ${blender.label}: ${blendPath}`,
);
