import { resolve } from 'node:path';

const maximumPlannerProviderTimeoutMs = 120_000;

export interface CliRuntimeConfig {
  readonly accessToken: string;
  readonly allowLegacyCompanions: boolean;
  readonly databasePath: string;
  readonly port: number;
  readonly plannerProviderTimeoutMs: number;
  readonly youtubeAccessToken?: string;
  readonly youtubeOAuthClientId?: string;
  readonly codex: {
    readonly executable: string;
    readonly model?: string;
  };
  readonly claude: {
    readonly executable: string;
    readonly model?: string;
    readonly maximumBudgetUsd: number;
  };
}

export function loadCliRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): CliRuntimeConfig {
  const accessToken = requiredAccessToken(environment);
  const port = integerInRange(
    environment['OPERATINGLINE_PORT'],
    'OPERATINGLINE_PORT',
    0,
    65_535,
    0,
  );
  const plannerProviderTimeoutMs = integerInRange(
    environment['OPERATINGLINE_PLANNER_TIMEOUT_MS'],
    'OPERATINGLINE_PLANNER_TIMEOUT_MS',
    100,
    maximumPlannerProviderTimeoutMs,
    maximumPlannerProviderTimeoutMs,
  );
  const maximumBudgetUsd = decimalInRange(
    environment['OPERATINGLINE_CLAUDE_MAX_BUDGET_USD'],
    'OPERATINGLINE_CLAUDE_MAX_BUDGET_USD',
    0.01,
    100,
    1,
  );
  const codexModel = optionalValue(environment['OPERATINGLINE_CODEX_MODEL']);
  const claudeModel = optionalValue(environment['OPERATINGLINE_CLAUDE_MODEL']);
  const youtubeAccessToken = optionalSecret(
    environment['OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN'],
    'OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN',
  );
  const youtubeOAuthClientId = optionalYouTubeOAuthClientId(
    environment['OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID'],
  );
  rejectAmbiguousYouTubeOAuthConfiguration(youtubeAccessToken, youtubeOAuthClientId);

  return {
    accessToken,
    allowLegacyCompanions: strictBoolean(
      environment['OPERATINGLINE_ALLOW_LEGACY_COMPANIONS'],
      'OPERATINGLINE_ALLOW_LEGACY_COMPANIONS',
      true,
    ),
    databasePath: resolve(
      environment['OPERATINGLINE_DATABASE_PATH']?.trim() || '.data/operating-line-cli.db',
    ),
    port,
    plannerProviderTimeoutMs,
    ...(youtubeAccessToken === undefined ? {} : { youtubeAccessToken }),
    ...(youtubeOAuthClientId === undefined ? {} : { youtubeOAuthClientId }),
    codex: {
      executable: executableValue(environment['OPERATINGLINE_CODEX_BIN'], 'codex'),
      ...(codexModel === undefined ? {} : { model: codexModel }),
    },
    claude: {
      executable: executableValue(environment['OPERATINGLINE_CLAUDE_BIN'], 'claude'),
      ...(claudeModel === undefined ? {} : { model: claudeModel }),
      maximumBudgetUsd,
    },
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

function requiredAccessToken(environment: Readonly<Record<string, string | undefined>>): string {
  const value = environment['OPERATINGLINE_ACCESS_TOKEN'];
  if (value === undefined || value.length < 16) {
    throw new Error(
      'OPERATINGLINE_ACCESS_TOKEN is required and must contain at least 16 characters',
    );
  }
  if (value.trim() !== value) {
    throw new Error('OPERATINGLINE_ACCESS_TOKEN must not contain surrounding whitespace');
  }
  return value;
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') {
    return undefined;
  }
  if (normalized.length > 500 || normalized.includes('\0')) {
    throw new Error('AI client model values must be at most 500 characters and contain no NUL');
  }
  return normalized;
}

function executableValue(value: string | undefined, fallback: string): string {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (value !== value.trim() || value.length > 4_096 || value.includes('\0')) {
    throw new Error('AI client executable paths must not contain surrounding whitespace or NUL');
  }
  return value;
}

function integerInRange(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const raw = value?.trim() || String(fallback);
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function decimalInRange(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const raw = value?.trim() || String(fallback);
  if (!/^(?:\d+|\d*\.\d+)$/u.test(raw)) {
    throw new Error(`${name} must be a decimal between ${minimum} and ${maximum}`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a decimal between ${minimum} and ${maximum}`);
  }
  return parsed;
}
