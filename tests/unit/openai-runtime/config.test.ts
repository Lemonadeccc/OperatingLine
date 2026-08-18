import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadOpenAIRuntimeConfig } from '../../../services/openai-runtime/src/config.js';

const requiredEnvironment = {
  OPERATINGLINE_ACCESS_TOKEN: 'local-access-token-value',
  OPENAI_API_KEY: 'test-secret-key',
  OPERATINGLINE_OPENAI_MODEL: 'explicit-model-id',
};

describe('opt-in OpenAI runtime configuration', () => {
  it('requires explicit credentials and model selection', () => {
    expect(loadOpenAIRuntimeConfig(requiredEnvironment)).toEqual({
      accessToken: 'local-access-token-value',
      allowLegacyCompanions: true,
      apiKey: 'test-secret-key',
      databasePath: resolve('.data/operating-line-openai.db'),
      model: 'explicit-model-id',
      port: 0,
    });

    for (const missing of [
      'OPERATINGLINE_ACCESS_TOKEN',
      'OPENAI_API_KEY',
      'OPERATINGLINE_OPENAI_MODEL',
    ] as const) {
      expect(() =>
        loadOpenAIRuntimeConfig({ ...requiredEnvironment, [missing]: undefined }),
      ).toThrow(missing);
    }
  });

  it('validates the local port before starting the runtime', () => {
    expect(
      loadOpenAIRuntimeConfig({
        ...requiredEnvironment,
        OPERATINGLINE_DATABASE_PATH: 'tmp/provider.db',
        OPERATINGLINE_ALLOW_LEGACY_COMPANIONS: 'false',
        OPERATINGLINE_PORT: '9876',
      }),
    ).toMatchObject({
      databasePath: resolve('tmp/provider.db'),
      allowLegacyCompanions: false,
      port: 9876,
    });

    for (const port of ['-1', '1.5', '65536', 'not-a-port']) {
      expect(() =>
        loadOpenAIRuntimeConfig({ ...requiredEnvironment, OPERATINGLINE_PORT: port }),
      ).toThrow('OPERATINGLINE_PORT');
    }

    for (const value of ['TRUE', 'False', ' false ', '0', '']) {
      expect(() =>
        loadOpenAIRuntimeConfig({
          ...requiredEnvironment,
          OPERATINGLINE_ALLOW_LEGACY_COMPANIONS: value,
        }),
      ).toThrow('OPERATINGLINE_ALLOW_LEGACY_COMPANIONS');
    }
  });

  it('accepts an optional pre-authorized YouTube OAuth token without normalizing it', () => {
    expect(
      loadOpenAIRuntimeConfig({
        ...requiredEnvironment,
        OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN: 'youtube-oauth-token',
      }),
    ).toMatchObject({ youtubeAccessToken: 'youtube-oauth-token' });
    for (const token of [' token', 'token ', 'token\nvalue']) {
      expect(() =>
        loadOpenAIRuntimeConfig({
          ...requiredEnvironment,
          OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN: token,
        }),
      ).toThrow('OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN');
    }
  });
});
