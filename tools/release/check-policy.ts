import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPhaseZeroReleasePolicyInput, validatePhaseZeroReleasePolicy } from './policy.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const input = await loadPhaseZeroReleasePolicyInput(repositoryRoot);
const failures = validatePhaseZeroReleasePolicy(input);

if (failures.length > 0) {
  process.stderr.write(`Phase 0 release policy failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Phase 0 release policy passed for ${String(input.manifests.length)} private manifests; publishing remains disabled.\n`,
  );
}
