import type {
  PlannerProvider,
  PlannerProviderGenerateInput,
  PlannerProviderReplanInput,
} from '@operatingline/planner-provider-sdk';
import {
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';
import type { ClientOptions as OpenAISDKClientOptions } from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

const providerVersion = '0.1.0' as const;
const defaultApiKeyEnvironmentVariable = 'OPENAI_API_KEY';
const officialOpenAIBaseURL = 'https://api.openai.com/v1';
export const openAIPlannerMaximumOutputTokens = 32_768 as const;

export interface OpenAIResponsesRequest {
  readonly model: string;
  readonly input: string;
  readonly max_output_tokens: typeof openAIPlannerMaximumOutputTokens;
  readonly store: false;
  readonly stream: false;
  readonly text: {
    readonly format: {
      readonly type: 'json_object';
    };
  };
}

export interface OpenAIResponsesResult {
  readonly status: string;
  readonly output_text?: string;
  readonly output?: readonly unknown[];
  readonly incomplete_details?: {
    readonly reason?: string | null;
  } | null;
}

export interface OpenAIResponsesClient {
  readonly responses: {
    create(
      request: OpenAIResponsesRequest,
      options: { readonly signal: AbortSignal },
    ): Promise<OpenAIResponsesResult>;
  };
}

export interface OpenAIResponsesPlannerProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly id?: string;
  readonly baseURL?: string;
  readonly organization?: string;
  readonly project?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly client?: OpenAIResponsesClient;
}

export interface OpenAIResponsesPlannerProviderFromEnvOptions extends Omit<
  OpenAIResponsesPlannerProviderOptions,
  'apiKey'
> {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly apiKeyEnvironmentVariable?: string;
}

export type OpenAIPlannerProviderErrorCode =
  | 'not_configured'
  | 'request_aborted'
  | 'request_failed'
  | 'response_incomplete'
  | 'response_refused'
  | 'response_invalid_json';

export class OpenAIPlannerProviderError extends Error {
  readonly code: OpenAIPlannerProviderErrorCode;

  constructor(code: OpenAIPlannerProviderErrorCode, message: string) {
    super(message);
    this.name = 'OpenAIPlannerProviderError';
    this.code = code;
  }
}

interface OpenAIClientOptions {
  readonly apiKey: string;
  readonly adminAPIKey: null;
  readonly organization: string | null;
  readonly project: string | null;
  readonly webhookSecret: null;
  readonly baseURL: string;
  readonly maxRetries: 0;
  readonly logLevel: 'off';
  readonly defaultHeaders: Readonly<Record<string, string | null>>;
  readonly fetch?: typeof globalThis.fetch;
}

type OpenAIClientConstructor = new (options: OpenAIClientOptions) => OpenAIResponsesClient;

interface OpenAIModule {
  readonly default?: OpenAIClientConstructor;
  readonly OpenAI?: OpenAIClientConstructor;
}

class OpenAIResponsesPlannerProvider implements PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;

  private client: OpenAIResponsesClient | undefined;
  private readonly options: OpenAIResponsesPlannerProviderOptions;
  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(options: OpenAIResponsesPlannerProviderOptions) {
    this.model = requireNonBlank(options.model, 'model');
    this.apiKey = normalizeOptional(options.apiKey);
    this.client = options.client;
    this.options = options;

    const available = this.apiKey !== undefined;
    this.descriptor = plannerProviderDescriptorSchema.parse({
      contractVersion: plannerProviderContractVersion,
      id: options.id ?? `openai-responses:${encodeProviderIdSegment(this.model)}`,
      version: providerVersion,
      displayName: 'OpenAI Responses Planner',
      description: `OpenAI Responses API planner using model ${this.model}.`,
      availability: available
        ? { available: true }
        : {
            available: false,
            reason: 'not_configured',
            message: 'An OpenAI API key is required to use this planner provider.',
          },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'remote',
        dataTransmission: 'provider_managed',
        credentialManagement: 'provider_managed',
      },
    });
  }

  async generate(input: PlannerProviderGenerateInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  async replan(input: PlannerProviderReplanInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  private async requestJson(renderedPrompt: string, signal: AbortSignal): Promise<unknown> {
    if (this.apiKey === undefined) {
      throw new OpenAIPlannerProviderError(
        'not_configured',
        'The OpenAI planner provider is not configured.',
      );
    }
    if (signal.aborted) {
      throw abortedError();
    }

    let response: OpenAIResponsesResult;
    try {
      const client = await this.getClient();
      const request = {
        model: this.model,
        input: renderedPrompt,
        max_output_tokens: openAIPlannerMaximumOutputTokens,
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      } satisfies OpenAIResponsesRequest;
      request satisfies ResponseCreateParamsNonStreaming;
      response = await client.responses.create(request, { signal });
    } catch {
      if (signal.aborted) {
        throw abortedError();
      }
      throw new OpenAIPlannerProviderError('request_failed', 'The OpenAI planner request failed.');
    }

    if (containsRefusal(response.output)) {
      throw new OpenAIPlannerProviderError(
        'response_refused',
        'The OpenAI planner refused the request.',
      );
    }
    if (response.status === 'incomplete') {
      throw new OpenAIPlannerProviderError(
        'response_incomplete',
        'The OpenAI planner returned an incomplete response.',
      );
    }
    if (response.status !== 'completed') {
      throw new OpenAIPlannerProviderError(
        'request_failed',
        'The OpenAI planner did not complete the request.',
      );
    }

    const outputText = response.output_text ?? collectOutputText(response.output);
    try {
      return JSON.parse(outputText);
    } catch {
      throw new OpenAIPlannerProviderError(
        'response_invalid_json',
        'The OpenAI planner returned invalid JSON.',
      );
    }
  }

  private async getClient(): Promise<OpenAIResponsesClient> {
    if (this.client !== undefined) {
      return this.client;
    }

    const moduleName = 'openai';
    const openAIModule = (await import(moduleName)) as unknown as OpenAIModule;
    const OpenAI = openAIModule.default ?? openAIModule.OpenAI;
    if (OpenAI === undefined) {
      throw new Error('The OpenAI SDK client export is unavailable.');
    }
    const organization = normalizeOptional(this.options.organization) ?? null;
    const project = normalizeOptional(this.options.project) ?? null;
    const clientOptions = {
      apiKey: this.apiKey as string,
      adminAPIKey: null,
      organization,
      project,
      webhookSecret: null,
      baseURL: normalizeOptional(this.options.baseURL) ?? officialOpenAIBaseURL,
      maxRetries: 0,
      logLevel: 'off',
      defaultHeaders: buildExplicitDefaultHeaders(this.apiKey as string, organization, project),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    } satisfies OpenAIClientOptions;
    clientOptions satisfies OpenAISDKClientOptions;
    this.client = new OpenAI(clientOptions);
    return this.client;
  }
}

export function createOpenAIResponsesPlannerProvider(
  options: OpenAIResponsesPlannerProviderOptions,
): PlannerProvider {
  return new OpenAIResponsesPlannerProvider(options);
}

export function createOpenAIResponsesPlannerProviderFromEnv(
  options: OpenAIResponsesPlannerProviderFromEnvOptions,
): PlannerProvider {
  const { env: suppliedEnvironment, apiKeyEnvironmentVariable, ...providerOptions } = options;
  const environmentVariable =
    normalizeOptional(apiKeyEnvironmentVariable) ?? defaultApiKeyEnvironmentVariable;
  const environment = suppliedEnvironment ?? getProcessEnvironment();
  const apiKey = environment[environmentVariable];
  return createOpenAIResponsesPlannerProvider({
    ...providerOptions,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
}

function getProcessEnvironment(): Readonly<Record<string, string | undefined>> {
  const runtime = globalThis as typeof globalThis & {
    readonly process?: {
      readonly env: Readonly<Record<string, string | undefined>>;
    };
  };
  return runtime.process?.env ?? {};
}

function buildExplicitDefaultHeaders(
  apiKey: string,
  organization: string | null,
  project: string | null,
): Readonly<Record<string, string | null>> {
  const headers: Record<string, string | null> = {};
  for (const line of getProcessEnvironment()['OPENAI_CUSTOM_HEADERS']?.split('\n') ?? []) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    if (name.length > 0) {
      headers[name] = null;
    }
  }
  return {
    ...headers,
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'OpenAI-Organization': organization,
    'OpenAI-Project': project,
    'User-Agent': `OperatingLine-OpenAI-Planner/${providerVersion}`,
    'X-Stainless-Retry-Count': '0',
  };
}

function requireNonBlank(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  if (normalized.length > 500) {
    throw new TypeError(`${name} must be at most 500 characters.`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === '' ? undefined : normalized;
}

function encodeProviderIdSegment(value: string): string {
  return Array.from(value, (character) =>
    /^[A-Za-z0-9.:-]$/.test(character)
      ? character
      : `_u${character.codePointAt(0)?.toString(16) ?? '0'}_`,
  ).join('');
}

function containsRefusal(output: readonly unknown[] | undefined): boolean {
  return visitContent(output, (item) => item.type === 'refusal');
}

function collectOutputText(output: readonly unknown[] | undefined): string {
  const texts: string[] = [];
  visitContent(output, (item) => {
    if (item.type === 'output_text' && typeof item.text === 'string') {
      texts.push(item.text);
    }
    return false;
  });
  return texts.join('');
}

function visitContent(
  values: readonly unknown[] | undefined,
  visitor: (value: Record<string, unknown>) => boolean,
): boolean {
  if (values === undefined) {
    return false;
  }
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const item = value as Record<string, unknown>;
    if (visitor(item)) {
      return true;
    }
    if (Array.isArray(item.content) && visitContent(item.content, visitor)) {
      return true;
    }
  }
  return false;
}

function abortedError(): OpenAIPlannerProviderError {
  return new OpenAIPlannerProviderError(
    'request_aborted',
    'The OpenAI planner request was aborted.',
  );
}
