import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import pino from 'pino';

import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';

import { startRuntime } from './index.js';

const logger = pino({ name: 'operating-line-runtime' });
const databasePath = resolve(process.env.OPERATINGLINE_DATABASE_PATH ?? '.data/operating-line.db');
const accessToken = process.env.OPERATINGLINE_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error('OPERATINGLINE_ACCESS_TOKEN is required for the standalone orchestrator');
}
mkdirSync(dirname(databasePath), { recursive: true });

const runtime = await startRuntime({
  databasePath,
  accessToken,
  adapters: [],
  actionCatalogs: blenderActionCatalogs,
  port: Number(process.env.OPERATINGLINE_PORT ?? 0),
});

logger.info({ mcpEndpoint: runtime.mcpEndpoint }, 'runtime ready');

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  logger.info('runtime stopped');
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
