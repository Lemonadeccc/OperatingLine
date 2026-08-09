#!/usr/bin/env node

import { loadMcpStdioBridgeConfig, startMcpStdioBridge } from './proxy.js';

async function main(): Promise<void> {
  const handle = await startMcpStdioBridge(loadMcpStdioBridgeConfig(), {
    onError: (message) => process.stderr.write(`${message}\n`),
  });

  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  const name = error instanceof Error && error.name !== '' ? error.name : 'Error';
  process.stderr.write(`OperatingLine MCP bridge failed: ${name}\n`);
  process.exitCode = 1;
});
