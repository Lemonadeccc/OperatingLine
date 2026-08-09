import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { recoverStaleHumanEvalDatasetWriteLock } from '@operatingline/eval-kit';

function parseDatasetDirectory(arguments_: readonly string[]): string {
  if (arguments_.length !== 2 || arguments_[0] !== '--dataset' || !arguments_[1]?.trim()) {
    throw new Error('Usage: recover-lock --dataset <directory>');
  }
  return resolve(arguments_[1]);
}

export async function runEvalLockRecoveryCli(arguments_: readonly string[]): Promise<boolean> {
  return recoverStaleHumanEvalDatasetWriteLock(parseDatasetDirectory(arguments_));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const recovered = await runEvalLockRecoveryCli(process.argv.slice(2));
    console.log(JSON.stringify({ recovered, providerCallsEnabled: false }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
