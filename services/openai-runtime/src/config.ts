import { resolve } from 'node:path';

export interface OpenAIRuntimeConfig {
  readonly accessToken: string;
  readonly allowLegacyCompanions: boolean;
  readonly apiKey: string;
  readonly databasePath: string;
  readonly model: string;
  readonly port: number;
  readonly youtubeAccessToken?: string;
  readonly youtubeOAuthClientId?: string;
}

function requiredValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the opt-in OpenAI runtime`);
  }
  return value;
}

export function loadOpenAIRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): OpenAIRuntimeConfig {
  const rawPort = environment['OPERATINGLINE_PORT']?.trim() || '0';
  if (!/^\d+$/.test(rawPort)) {
    throw new Error('OPERATINGLINE_PORT must be an integer between 0 and 65535');
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('OPERATINGLINE_PORT must be an integer between 0 and 65535');
  }

  const youtubeAccessToken = optionalSecret(
    environment['OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN'],
    'OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN',
  );
  const youtubeOAuthClientId = optionalYouTubeOAuthClientId(
    environment['OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID'],
  );
  rejectAmbiguousYouTubeOAuthConfiguration(youtubeAccessToken, youtubeOAuthClientId);
  return {
    accessToken: requiredValue(environment, 'OPERATINGLINE_ACCESS_TOKEN'),
    allowLegacyCompanions: strictBoolean(
      environment['OPERATINGLINE_ALLOW_LEGACY_COMPANIONS'],
      'OPERATINGLINE_ALLOW_LEGACY_COMPANIONS',
      true,
    ),
    apiKey: requiredValue(environment, 'OPENAI_API_KEY'),
    databasePath: resolve(
      environment['OPERATINGLINE_DATABASE_PATH']?.trim() || '.data/operating-line-openai.db',
    ),
    model: requiredValue(environment, 'OPERATINGLINE_OPENAI_MODEL'),
    port,
    ...(youtubeAccessToken === undefined ? {} : { youtubeAccessToken }),
    ...(youtubeOAuthClientId === undefined ? {} : { youtubeOAuthClientId }),
  };
}

function optionalYouTubeOAuthClientId(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (
    value.length < 10 ||
    value.length > 1_024 ||
    value.trim() !== value ||
    containsWhitespaceOrControl(value)
  ) {
    throw new Error(
      'OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID must be 10-1024 characters without whitespace or controls',
    );
  }
  return value;
}

function rejectAmbiguousYouTubeOAuthConfiguration(
  accessToken: string | undefined,
  clientId: string | undefined,
): void {
  if (accessToken !== undefined && clientId !== undefined) {
    throw new Error(
      'Set only one of OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID or OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN',
    );
  }
}

function optionalSecret(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (value.length > 8_192 || containsWhitespaceOrControl(value)) {
    throw new Error(`${name} must be at most 8192 characters and contain no whitespace`);
  }
  return value;
}

function containsWhitespaceOrControl(value: string): boolean {
  return (
    /\s/u.test(value) ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
    })
  );
}

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
