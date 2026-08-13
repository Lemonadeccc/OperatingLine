import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  createClaudeCodeCliPlannerProvider,
  createCodexCliPlannerProvider,
} from '@operatingline/cli-planner-provider';
import { startRuntime } from '@operatingline/orchestrator';

import { loadCliRuntimeConfig } from './config.js';

const logger = pino({ name: 'operating-line-cli-runtime' });
const config = loadCliRuntimeConfig(process.env);
mkdirSync(dirname(config.databasePath), { recursive: true });

const plannerProviders = [
  createCodexCliPlannerProvider(config.codex),
  createClaudeCodeCliPlannerProvider(config.claude),
];
const runtime = await startRuntime({
  databasePath: config.databasePath,
  accessToken: config.accessToken,
  adapters: [],
  actionCatalogs: blenderActionCatalogs,
  plannerProviders,
  plannerProviderTimeoutMs: config.plannerProviderTimeoutMs,
  companionLeases: { allowLegacyCompanions: config.allowLegacyCompanions },
  port: config.port,
});

logger.info(
  {
    mcpEndpoint: runtime.mcpEndpoint,
    plannerProviders: plannerProviders.map((provider) => ({
      id: provider.descriptor.id,
      version: provider.descriptor.version,
      availability: provider.descriptor.availability,
    })),
  },
  'local AI client runtime ready',
);

let shutdownPromise: Promise<void> | undefined;
const shutdown = (): Promise<void> => {
  shutdownPromise ??= runtime.stop().then(() => {
    logger.info('local AI client runtime stopped');
  });
  return shutdownPromise;
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
