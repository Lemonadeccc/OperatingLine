#!/usr/bin/env node

import { parseClientSetupArguments, setupAiClients } from './setup.js';

async function main(): Promise<void> {
  const options = parseClientSetupArguments(process.argv.slice(2));
  const results = await setupAiClients(options);
  for (const result of results) {
    process.stdout.write(`${result.client}: ${result.status}\n`);
  }
  if (results.every((result) => result.status === 'unavailable')) {
    throw new Error('Neither Codex nor Claude CLI is available on PATH');
  }
  process.stdout.write(
    `Use ${options.tokenEnvironmentName} in every local AI client process before connecting.\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown client setup failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
