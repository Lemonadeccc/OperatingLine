import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import pino from 'pino';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';

import { createYouTubeDataApiCaptionSource, startRuntime } from './index.js';

const logger = pino({ name: 'operating-line-runtime' });
const databasePath = resolve(process.env.OPERATINGLINE_DATABASE_PATH ?? '.data/operating-line.db');
const accessToken = process.env.OPERATINGLINE_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error('OPERATINGLINE_ACCESS_TOKEN is required for the standalone orchestrator');
}
const allowLegacyCompanions = strictBoolean(
  process.env.OPERATINGLINE_ALLOW_LEGACY_COMPANIONS,
  'OPERATINGLINE_ALLOW_LEGACY_COMPANIONS',
  true,
);
const youtubeAccessToken = process.env.OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN;
const youtubeCaptionSource =
  youtubeAccessToken === undefined || youtubeAccessToken === ''
    ? undefined
    : createYouTubeDataApiCaptionSource({ accessToken: youtubeAccessToken });
mkdirSync(dirname(databasePath), { recursive: true });

const runtime = await startRuntime({
  databasePath,
  accessToken,
  adapters: [],
  actionCatalogs: blenderActionCatalogs,
  interactionCatalogs: blenderInteractionCatalogs,
  ...(youtubeCaptionSource === undefined ? {} : { youtubeCaptionSource }),
  companionLeases: { allowLegacyCompanions },
  port: Number(process.env.OPERATINGLINE_PORT ?? 0),
});

logger.info(
  {
    mcpEndpoint: runtime.mcpEndpoint,
    youtubeCaptionSourceConfigured: youtubeCaptionSource !== undefined,
  },
  'runtime ready',
);

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  logger.info('runtime stopped');
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

function strictBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${name} must be exactly true or false`);
}
