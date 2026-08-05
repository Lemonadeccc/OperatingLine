import { resolve } from 'node:path';

export interface OpenAIRuntimeConfig {
  readonly accessToken: string;
  readonly apiKey: string;
  readonly databasePath: string;
  readonly model: string;
  readonly port: number;
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

  return {
    accessToken: requiredValue(environment, 'OPERATINGLINE_ACCESS_TOKEN'),
    apiKey: requiredValue(environment, 'OPENAI_API_KEY'),
    databasePath: resolve(
      environment['OPERATINGLINE_DATABASE_PATH']?.trim() || '.data/operating-line-openai.db',
    ),
    model: requiredValue(environment, 'OPERATINGLINE_OPENAI_MODEL'),
    port,
  };
}
