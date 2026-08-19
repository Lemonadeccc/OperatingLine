import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import { createOpenAIResponsesPlannerProvider } from '@operatingline/openai-planner-provider';
import {
  createDefaultYouTubeOAuthCredentialStore,
  createProcedureTutorialMediaRuntimeFromEnvironment,
  createYouTubeDataApiCaptionSource,
  createYouTubeOAuthAccessTokenProvider,
  startRuntime,
} from '@operatingline/orchestrator';

import { loadOpenAIRuntimeConfig } from './config.js';

const logger = pino({ name: 'operating-line-openai-runtime' });
const config = loadOpenAIRuntimeConfig(process.env);
mkdirSync(dirname(config.databasePath), { recursive: true });

const plannerProvider = createOpenAIResponsesPlannerProvider({
  apiKey: config.apiKey,
  model: config.model,
});
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
  plannerProviders: [plannerProvider],
  ...(youtubeCaptionSource === undefined ? {} : { youtubeCaptionSource }),
  tutorialMediaRuntime,
  companionLeases: { allowLegacyCompanions: config.allowLegacyCompanions },
  port: config.port,
});

logger.info(
  {
    mcpEndpoint: runtime.mcpEndpoint,
    plannerProviderId: plannerProvider.descriptor.id,
    plannerProviderVersion: plannerProvider.descriptor.version,
    youtubeCaptionSourceConfigured: youtubeCaptionSource !== undefined,
    tutorialMediaAvailability: tutorialMediaRuntime.capabilities.availability,
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
