import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  createClaudeCodeCliPlannerProvider,
  createCodexCliPlannerProvider,
} from '@operatingline/cli-planner-provider';
import {
  createDefaultYouTubeOAuthCredentialStore,
  createProcedureTutorialMediaRuntimeFromEnvironment,
  createYouTubeDataApiCaptionSource,
  createYouTubeOAuthAccessTokenProvider,
  startRuntime,
} from '@operatingline/orchestrator';

import { loadCliRuntimeConfig } from './config.js';

const logger = pino({ name: 'operating-line-cli-runtime' });
const config = loadCliRuntimeConfig(process.env);
mkdirSync(dirname(config.databasePath), { recursive: true });

const plannerProviders = [
  createCodexCliPlannerProvider(config.codex),
  createClaudeCodeCliPlannerProvider(config.claude),
];
const youtubeOAuthAccessTokenProvider =
  config.youtubeOAuthClientId === undefined
    ? undefined
    : createYouTubeOAuthAccessTokenProvider({
        clientId: config.youtubeOAuthClientId,
        credentialStore: createDefaultYouTubeOAuthCredentialStore(),
      });
const youtubeCaptionSource =
  youtubeOAuthAccessTokenProvider === undefined
    ? config.youtubeAccessToken === undefined
      ? undefined
      : createYouTubeDataApiCaptionSource({ accessToken: config.youtubeAccessToken })
    : createYouTubeDataApiCaptionSource({ accessTokenProvider: youtubeOAuthAccessTokenProvider });
const tutorialMediaRuntime = await createProcedureTutorialMediaRuntimeFromEnvironment(process.env);
const runtime = await startRuntime({
  databasePath: config.databasePath,
  accessToken: config.accessToken,
  adapters: [],
  actionCatalogs: blenderActionCatalogs,
  interactionCatalogs: blenderInteractionCatalogs,
  plannerProviders,
  plannerProviderTimeoutMs: config.plannerProviderTimeoutMs,
  ...(youtubeCaptionSource === undefined ? {} : { youtubeCaptionSource }),
  tutorialMediaRuntime,
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
    youtubeCaptionSourceConfigured: youtubeCaptionSource !== undefined,
    tutorialMediaAvailability: tutorialMediaRuntime.capabilities.availability,
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
