import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { createOpenAIResponsesPlannerProvider } from '@operatingline/openai-planner-provider';
import { startRuntime } from '@operatingline/orchestrator';

import { loadOpenAIRuntimeConfig } from './config.js';

const logger = pino({ name: 'operating-line-openai-runtime' });
const config = loadOpenAIRuntimeConfig(process.env);
mkdirSync(dirname(config.databasePath), { recursive: true });

const plannerProvider = createOpenAIResponsesPlannerProvider({
  apiKey: config.apiKey,
  model: config.model,
});
const runtime = await startRuntime({
  databasePath: config.databasePath,
  accessToken: config.accessToken,
  adapters: [],
  actionCatalogs: blenderActionCatalogs,
  plannerProviders: [plannerProvider],
  port: config.port,
});

logger.info(
  {
    mcpEndpoint: runtime.mcpEndpoint,
    plannerProviderId: plannerProvider.descriptor.id,
    plannerProviderVersion: plannerProvider.descriptor.version,
  },
  'opt-in OpenAI runtime ready',
);

let shutdownPromise: Promise<void> | undefined;
const shutdown = (): Promise<void> => {
  shutdownPromise ??= runtime.stop().then(() => {
    logger.info('opt-in OpenAI runtime stopped');
  });
  return shutdownPromise;
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
