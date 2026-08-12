import type {
  PlannerProvider,
  PlannerProviderDialogueInput,
  PlannerProviderGenerateInput,
  PlannerProviderReplanInput,
  PlannerProviderRuntimeOperation,
  PlannerProviderRuntimeTreatmentDescription,
} from '@operatingline/planner-provider-sdk';
import {
  plannerDialogueProviderResultSchema,
  plannerDialogueMaximumMessageCharacters,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  type PlannerDialogueProviderResult,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';
import type { ClientOptions as OpenAISDKClientOptions } from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses';

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

export interface OpenAIDialogueResponsesRequest {
  readonly model: string;
  readonly input: string;
  readonly max_output_tokens: typeof openAIPlannerMaximumOutputTokens;
  readonly store: false;
  readonly stream: true;
  readonly parallel_tool_calls: false;
  readonly tool_choice: 'auto';
  readonly tools: readonly [
    {
      readonly type: 'function';
      readonly name: 'request_replan';
      readonly description: string;
      readonly strict: true;
      readonly parameters: {
        readonly type: 'object';
        readonly properties: {
          readonly confidence: {
            readonly type: 'number';
            readonly minimum: 0;
            readonly maximum: 1;
          };
        };
        readonly required: readonly ['confidence'];
        readonly additionalProperties: false;
      };
    },
  ];
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
      request: OpenAIResponsesRequest | OpenAIDialogueResponsesRequest,
      options: { readonly signal: AbortSignal },
    ): Promise<OpenAIResponsesResult | AsyncIterable<unknown>>;
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

  describeRuntimeTreatment(
    _operation: PlannerProviderRuntimeOperation,
  ): PlannerProviderRuntimeTreatmentDescription {
    const endpoint = normalizeOptional(this.options.baseURL) ?? officialOpenAIBaseURL;
    return {
      profile: {
        descriptor: this.descriptor,
        vendor: 'OpenAI',
        implementation: {
          name: '@operatingline/openai-planner-provider',
          version: providerVersion,
        },
        model: {
          requested: this.model,
          resolvedRevision: null,
          resolution: 'provider_did_not_disclose',
        },
        api: {
          surface: 'responses',
          version: 'v1',
          sdkName: 'openai',
          sdkVersion: '7.4.0',
          endpointClass: endpoint === officialOpenAIBaseURL ? 'vendor_public' : 'self_hosted',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: {
          model: this.model,
          max_output_tokens: openAIPlannerMaximumOutputTokens,
          store: false,
          stream: false,
          text: { format: { type: 'json_object' } },
        },
        seed: null,
        determinism: 'non_deterministic',
      },
    };
  }

  async replan(input: PlannerProviderReplanInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  async dialogue(input: PlannerProviderDialogueInput): Promise<PlannerDialogueProviderResult> {
    if (this.apiKey === undefined) {
      throw new OpenAIPlannerProviderError(
        'not_configured',
        'The OpenAI planner provider is not configured.',
      );
    }
    if (input.signal.aborted) {
      throw abortedError();
    }

    let stream: AsyncIterable<unknown>;
    try {
      const client = await this.getClient();
      const request = {
        model: this.model,
        input: input.packet.renderedPrompt,
        max_output_tokens: openAIPlannerMaximumOutputTokens,
        store: false,
        stream: true,
        parallel_tool_calls: false,
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            name: 'request_replan',
            description:
              'Request a bounded OperatingLine Plan revision only when the latest user message clearly asks to change the referenced Plan scope. Provide semantic confidence from 0 to 1.',
            strict: true,
            parameters: {
              type: 'object',
              properties: {
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['confidence'],
              additionalProperties: false,
            },
          },
        ],
      } satisfies OpenAIDialogueResponsesRequest;
      request satisfies ResponseCreateParamsStreaming;
      const response = await client.responses.create(request, { signal: input.signal });
      if (!isAsyncIterable(response)) {
        throw new Error('The OpenAI dialogue request did not return a stream.');
      }
      stream = response;
    } catch {
      if (input.signal.aborted) {
        throw abortedError();
      }
      throw new OpenAIPlannerProviderError('request_failed', 'The OpenAI dialogue request failed.');
    }

    let assistantMessage = '';
    let toolArguments: string | null = null;
    let completed = false;
    try {
      for await (const rawEvent of stream) {
        if (input.signal.aborted) {
          throw abortedError();
        }
        if (completed) {
          throw invalidDialogueResponse();
        }
        const event = recordValue(rawEvent);
        if (event === null) {
          throw invalidDialogueResponse();
        }
        const type = event['type'];
        if (type === 'response.output_text.delta') {
          const delta = event['delta'];
          if (typeof delta !== 'string' || delta.length === 0) {
            throw invalidDialogueResponse();
          }
          assistantMessage += delta;
          if (assistantMessage.length > plannerDialogueMaximumMessageCharacters) {
            throw invalidDialogueResponse();
          }
          input.emit({ type: 'assistant_text_delta', delta });
        } else if (type === 'response.function_call_arguments.done') {
          if (
            event['name'] !== 'request_replan' ||
            typeof event['arguments'] !== 'string' ||
            toolArguments !== null
          ) {
            throw invalidDialogueResponse();
          }
          toolArguments = event['arguments'];
        } else if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
          throw new OpenAIPlannerProviderError(
            'response_refused',
            'The OpenAI planner refused the request.',
          );
        } else if (type === 'response.incomplete') {
          throw new OpenAIPlannerProviderError(
            'response_incomplete',
            'The OpenAI planner returned an incomplete response.',
          );
        } else if (type === 'response.failed' || type === 'error') {
          throw new OpenAIPlannerProviderError(
            'request_failed',
            'The OpenAI dialogue request failed.',
          );
        } else if (type === 'response.completed') {
          const response = recordValue(event['response']);
          if (response?.['status'] !== 'completed') {
            throw new OpenAIPlannerProviderError(
              'request_failed',
              'The OpenAI dialogue request did not complete.',
            );
          }
          const output = response['output'];
          if (!Array.isArray(output) || containsRefusal(output)) {
            throw invalidDialogueResponse();
          }
          const finalAssistantMessage = collectOutputText(output);
          if (finalAssistantMessage !== assistantMessage) {
            throw invalidDialogueResponse();
          }
          const finalToolArguments = collectFunctionCallArguments(output);
          if (toolArguments !== null && finalToolArguments !== toolArguments) {
            throw invalidDialogueResponse();
          }
          toolArguments = finalToolArguments;
          completed = true;
        }
      }
    } catch (error) {
      if (error instanceof OpenAIPlannerProviderError) {
        throw error;
      }
      if (input.signal.aborted) {
        throw abortedError();
      }
      throw new OpenAIPlannerProviderError('request_failed', 'The OpenAI dialogue request failed.');
    }
    if (!completed) {
      throw new OpenAIPlannerProviderError(
        'response_incomplete',
        'The OpenAI planner returned an incomplete response.',
      );
    }

    try {
      return plannerDialogueProviderResultSchema.parse({
        assistantMessage,
        decision:
          toolArguments === null
            ? { kind: 'answer' }
            : { kind: 'replan', confidence: parseReplanConfidence(toolArguments) },
      });
    } catch {
      throw invalidDialogueResponse();
    }
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
      const result = await client.responses.create(request, { signal });
      if (isAsyncIterable(result)) {
        throw new Error('The OpenAI planning request unexpectedly returned a stream.');
      }
      response = result;
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

function collectFunctionCallArguments(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }
  let argumentsValue: string | null = null;
  for (const value of output) {
    const item = recordValue(value);
    if (item?.['type'] !== 'function_call') {
      continue;
    }
    if (
      item['name'] !== 'request_replan' ||
      typeof item['arguments'] !== 'string' ||
      argumentsValue !== null
    ) {
      throw invalidDialogueResponse();
    }
    argumentsValue = item['arguments'];
  }
  return argumentsValue;
}

function parseReplanConfidence(argumentsJson: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw invalidDialogueResponse();
  }
  const candidate = recordValue(parsed);
  if (
    candidate === null ||
    Object.keys(candidate).length !== 1 ||
    typeof candidate['confidence'] !== 'number' ||
    !Number.isFinite(candidate['confidence']) ||
    candidate['confidence'] < 0 ||
    candidate['confidence'] > 1
  ) {
    throw invalidDialogueResponse();
  }
  return candidate['confidence'];
}

function invalidDialogueResponse(): OpenAIPlannerProviderError {
  return new OpenAIPlannerProviderError(
    'response_invalid_json',
    'The OpenAI planner returned an invalid dialogue result.',
  );
}

function abortedError(): OpenAIPlannerProviderError {
  return new OpenAIPlannerProviderError(
    'request_aborted',
    'The OpenAI planner request was aborted.',
  );
}
