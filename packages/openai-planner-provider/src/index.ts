import {
  plannerProviderProcedureEmbeddingMaximumDocumentCharacters,
  plannerProviderProcedureEmbeddingMaximumDocuments,
  type PlannerProvider,
  type PlannerProviderDialogueInput,
  type PlannerProviderGenerateInput,
  type PlannerProviderProcedureEmbeddingInput,
  type PlannerProviderProcedureEmbeddingResult,
  type PlannerProviderProcedureAuthoringInput,
  type PlannerProviderProcedureRefinementDialogueInput,
  type PlannerProviderProcedureRefinementInput,
  type PlannerProviderReplanInput,
  type PlannerProviderRuntimeOperation,
  type PlannerProviderRuntimeTreatmentDescription,
} from '@operatingline/planner-provider-sdk';
import {
  plannerDialogueProviderResultSchema,
  plannerDialogueMaximumMessageCharacters,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  procedureRefinementConfidenceThreshold,
  procedureRefinementDialogueProviderResultSchema,
  procedureRefinementMaximumAssistantMessageCharacters,
  type PlannerDialogueProviderResult,
  type PlannerProviderDescriptor,
  type ProcedureRefinementDialogueProviderResult,
} from '@operatingline/protocol';
import type { ClientOptions as OpenAISDKClientOptions } from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses';

const providerVersion = '0.1.0' as const;
const defaultApiKeyEnvironmentVariable = 'OPENAI_API_KEY';
const officialOpenAIBaseURL = 'https://api.openai.com/v1';
const plannerReplanToolDescription =
  'Request a bounded OperatingLine Plan revision only when the latest user message clearly asks to change the referenced Plan scope. Provide semantic confidence from 0 to 1.';
const procedureRefinementToolDescription =
  'Request a reviewable scoped ProcedureTree refinement only when the user clearly asks to change the authorized ProcedureTree scope. Provide semantic confidence from 0 to 1.';
export const openAIPlannerMaximumOutputTokens = 32_768 as const;
export const openAIProcedureEmbeddingMaximumDocuments =
  plannerProviderProcedureEmbeddingMaximumDocuments;
export const openAIProcedureEmbeddingMaximumDocumentCharacters =
  plannerProviderProcedureEmbeddingMaximumDocumentCharacters;

export interface OpenAIEmbeddingsRequest {
  readonly model: string;
  readonly input: readonly string[];
  readonly encoding_format: 'float';
}

export interface OpenAIEmbeddingsResult {
  readonly data?: readonly {
    readonly embedding?: readonly number[];
    readonly index?: number;
  }[];
}

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

export interface OpenAIProcedureRefinementDialogueResponsesRequest {
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
      readonly name: 'request_procedure_refinement';
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
      request: OpenAIResponsesRequest | ResponseCreateParamsStreaming,
      options: { readonly signal: AbortSignal },
    ): Promise<OpenAIResponsesResult | AsyncIterable<unknown>>;
  };
  readonly embeddings?: {
    create(
      request: OpenAIEmbeddingsRequest,
      options: { readonly signal: AbortSignal },
    ): Promise<OpenAIEmbeddingsResult>;
  };
}

export interface OpenAIResponsesPlannerProviderOptions {
  readonly model: string;
  readonly embeddingModel?: string;
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

interface NormalizedProviderEndpoint {
  readonly baseURL: string;
  readonly origin: string;
  readonly pathSha256: string;
  readonly identitySha256: string;
  readonly official: boolean;
}

class OpenAIResponsesPlannerProvider implements PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  readonly embedProcedure?: NonNullable<PlannerProvider['embedProcedure']>;

  private client: OpenAIResponsesClient | undefined;
  private readonly options: OpenAIResponsesPlannerProviderOptions;
  private readonly model: string;
  private readonly embeddingModel: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly endpoint: NormalizedProviderEndpoint;

  constructor(options: OpenAIResponsesPlannerProviderOptions) {
    this.model = requireNonBlank(options.model, 'model');
    this.embeddingModel = normalizeOptionalModel(options.embeddingModel, 'embeddingModel');
    this.apiKey = normalizeOptional(options.apiKey);
    this.endpoint = normalizeProviderEndpoint(options.baseURL);
    this.client = options.client;
    this.options = options;
    if (this.embeddingModel !== undefined) {
      this.embedProcedure = (input) => this.requestEmbeddings(input);
    }

    const available = this.apiKey !== undefined;
    this.descriptor = plannerProviderDescriptorSchema.parse({
      contractVersion: plannerProviderContractVersion,
      id:
        options.id ??
        `openai-responses:${encodeProviderIdSegment(this.model)}${
          this.endpoint.official ? '' : `:endpoint-sha256-v1-${this.endpoint.identitySha256}`
        }`,
      version: providerVersion,
      displayName: 'OpenAI Responses Planner',
      description: `${
        this.embeddingModel === undefined
          ? `OpenAI Responses API planner using model ${this.model}`
          : `OpenAI Responses API planner using model ${this.model}; Procedure embeddings use model ${this.embeddingModel}`
      }; data recipient origin ${this.endpoint.origin}.`,
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

  async authorProcedure(input: PlannerProviderProcedureAuthoringInput): Promise<unknown> {
    return this.requestJson(input.renderedPrompt, input.signal);
  }

  private async requestEmbeddings(
    input: PlannerProviderProcedureEmbeddingInput,
  ): Promise<PlannerProviderProcedureEmbeddingResult> {
    if (this.embeddingModel === undefined) {
      throw new OpenAIPlannerProviderError(
        'not_configured',
        'The OpenAI planner provider has no embedding model configured.',
      );
    }
    assertEmbeddingDocuments(input.documents);
    if (this.apiKey === undefined) {
      throw new OpenAIPlannerProviderError(
        'not_configured',
        'The OpenAI planner provider is not configured.',
      );
    }
    if (input.signal.aborted) {
      throw abortedError();
    }

    try {
      const client = await this.getClient();
      if (client.embeddings === undefined) {
        throw new Error('The OpenAI embeddings client is unavailable.');
      }
      const request = {
        model: this.embeddingModel,
        input: input.documents,
        encoding_format: 'float',
      } satisfies OpenAIEmbeddingsRequest;
      const response = await client.embeddings.create(request, { signal: input.signal });
      if (!Array.isArray(response.data)) {
        throw new Error('The OpenAI embeddings response has no data array.');
      }
      const ordered = [...response.data].sort(
        (left, right) => (left.index ?? -1) - (right.index ?? -1),
      );
      if (
        ordered.length !== input.documents.length ||
        ordered.some((entry, index) => !Number.isInteger(entry.index) || entry.index !== index)
      ) {
        throw new Error('The OpenAI embeddings response has invalid vector indices.');
      }
      return {
        vectors: ordered.map((entry) => {
          if (!Array.isArray(entry.embedding)) {
            throw new Error('The OpenAI embeddings response contains no vector.');
          }
          return entry.embedding;
        }),
      };
    } catch (error) {
      if (error instanceof OpenAIPlannerProviderError) {
        throw error;
      }
      if (input.signal.aborted) {
        throw abortedError();
      }
      throw new OpenAIPlannerProviderError(
        'request_failed',
        'The OpenAI embedding request failed.',
      );
    }
  }

  describeRuntimeTreatment(
    operation: PlannerProviderRuntimeOperation,
  ): PlannerProviderRuntimeTreatmentDescription {
    const embedding = operation === 'procedure_embedding';
    const streamedDialogue =
      operation === 'procedure_refinement_dialogue' ? 'request_procedure_refinement' : null;
    const requestedModel = embedding ? this.embeddingModel : this.model;
    if (requestedModel === undefined) {
      throw new OpenAIPlannerProviderError(
        'not_configured',
        'The OpenAI planner provider has no embedding model configured.',
      );
    }
    return {
      profile: {
        descriptor: this.descriptor,
        vendor: 'OpenAI',
        implementation: {
          name: '@operatingline/openai-planner-provider',
          version: providerVersion,
        },
        model: {
          requested: requestedModel,
          resolvedRevision: null,
          resolution: 'provider_did_not_disclose',
        },
        api: {
          surface: embedding ? 'embeddings' : 'responses',
          version: 'v1',
          sdkName: 'openai',
          sdkVersion: '7.4.0',
          endpointClass: this.endpoint.official ? 'vendor_public' : 'self_hosted',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: {
          endpoint: {
            origin: this.endpoint.origin,
            pathSha256: `sha256-utf8-v1:${this.endpoint.pathSha256}`,
          },
          ...(embedding
            ? {
                model: requestedModel,
                encoding_format: 'float',
              }
            : streamedDialogue === null
              ? {
                  model: requestedModel,
                  max_output_tokens: openAIPlannerMaximumOutputTokens,
                  store: false,
                  stream: false,
                  text: { format: { type: 'json_object' } },
                }
              : {
                  model: requestedModel,
                  max_output_tokens: openAIPlannerMaximumOutputTokens,
                  store: false,
                  stream: true,
                  parallel_tool_calls: false,
                  tool_choice: 'auto',
                  tools: [buildDialogueTool(streamedDialogue, procedureRefinementToolDescription)],
                }),
        },
        seed: null,
        determinism: 'non_deterministic',
      },
      costPolicy: {
        possibleProviderCost: true,
        basis: 'provider_pricing',
        publicStatement:
          'OpenAI API requests may incur charges under the pricing and billing terms of the configured OpenAI account.',
      },
    };
  }

  async replan(input: PlannerProviderReplanInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  async dialogue(input: PlannerProviderDialogueInput): Promise<PlannerDialogueProviderResult> {
    return this.requestDialogue(input, {
      toolName: 'request_replan',
      toolDescription: plannerReplanToolDescription,
      maximumAssistantMessageCharacters: plannerDialogueMaximumMessageCharacters,
      parseResult: (assistantMessage, toolArguments) =>
        plannerDialogueProviderResultSchema.parse({
          assistantMessage,
          decision:
            toolArguments === null
              ? { kind: 'answer' }
              : { kind: 'replan', confidence: parseDialogueConfidence(toolArguments) },
        }),
    });
  }

  async procedureRefinementDialogue(
    input: PlannerProviderProcedureRefinementDialogueInput,
  ): Promise<ProcedureRefinementDialogueProviderResult> {
    return this.requestDialogue(input, {
      toolName: 'request_procedure_refinement',
      toolDescription: procedureRefinementToolDescription,
      maximumAssistantMessageCharacters: procedureRefinementMaximumAssistantMessageCharacters,
      parseResult: (assistantMessage, toolArguments) => {
        const confidence = toolArguments === null ? null : parseDialogueConfidence(toolArguments);
        return procedureRefinementDialogueProviderResultSchema.parse({
          assistantMessage,
          decision:
            confidence === null || confidence < procedureRefinementConfidenceThreshold
              ? {
                  kind: 'answer',
                  confidence,
                  threshold: procedureRefinementConfidenceThreshold,
                }
              : {
                  kind: 'refine',
                  confidence,
                  threshold: procedureRefinementConfidenceThreshold,
                },
        });
      },
    });
  }

  async refineProcedure(input: PlannerProviderProcedureRefinementInput): Promise<unknown> {
    return this.requestJson(input.packet.renderedPrompt, input.signal);
  }

  private async requestDialogue<Result>(
    input: {
      readonly packet: { readonly renderedPrompt: string };
      readonly signal: AbortSignal;
      readonly emit: PlannerProviderDialogueInput['emit'];
    },
    definition: {
      readonly toolName: 'request_replan' | 'request_procedure_refinement';
      readonly toolDescription: string;
      readonly maximumAssistantMessageCharacters: number;
      readonly parseResult: (assistantMessage: string, toolArguments: string | null) => Result;
    },
  ): Promise<Result> {
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
        tools: [buildDialogueTool(definition.toolName, definition.toolDescription)],
      } satisfies ResponseCreateParamsStreaming;
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
          if (assistantMessage.length > definition.maximumAssistantMessageCharacters) {
            throw invalidDialogueResponse();
          }
          input.emit({ type: 'assistant_text_delta', delta });
        } else if (type === 'response.function_call_arguments.done') {
          if (
            event['name'] !== definition.toolName ||
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
          const finalToolArguments = collectFunctionCallArguments(output, definition.toolName);
          if (toolArguments !== null && finalToolArguments !== toolArguments) {
            throw invalidDialogueResponse();
          }
          toolArguments = finalToolArguments;
          completed = true;
        } else if (typeof type !== 'string' || !isIgnorableDialogueEventType(type)) {
          throw invalidDialogueResponse();
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
      return definition.parseResult(assistantMessage, toolArguments);
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
      baseURL: this.endpoint.baseURL,
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

function normalizeOptionalModel(value: string | undefined, name: string): string | undefined {
  return value === undefined ? undefined : requireNonBlank(value, name);
}

function assertEmbeddingDocuments(documents: readonly string[]): void {
  if (
    documents.length < 1 ||
    documents.length > openAIProcedureEmbeddingMaximumDocuments ||
    documents.some(
      (document) =>
        typeof document !== 'string' ||
        document.length < 1 ||
        document.length > openAIProcedureEmbeddingMaximumDocumentCharacters,
    )
  ) {
    throw new TypeError(
      `documents must contain 1-${openAIProcedureEmbeddingMaximumDocuments} non-empty strings of at most ${openAIProcedureEmbeddingMaximumDocumentCharacters} characters`,
    );
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === '' ? undefined : normalized;
}

function normalizeProviderEndpoint(value: string | undefined): NormalizedProviderEndpoint {
  const candidate = normalizeOptional(value) ?? officialOpenAIBaseURL;
  if (candidate.length > 2_000) {
    throw new TypeError('baseURL must be at most 2000 characters.');
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    throw new TypeError('baseURL must be an absolute HTTP(S) URL.', { cause: error });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('baseURL must not contain embedded credentials.');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError('baseURL must not contain a query string or fragment.');
  }
  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new TypeError('baseURL must use HTTPS, except for an explicit loopback HTTP endpoint.');
  }
  const pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  const baseURL = `${parsed.origin}${pathname}`;
  return {
    baseURL,
    origin: parsed.origin,
    pathSha256: sha256Utf8(pathname),
    identitySha256: sha256Utf8(baseURL),
    official: baseURL === officialOpenAIBaseURL,
  };
}

const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Portable synchronous SHA-256 over normalized UTF-8 endpoint text. */
function sha256Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value.normalize('NFC'));
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choice + sha256RoundConstants[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

function buildDialogueTool(
  name: 'request_replan' | 'request_procedure_refinement',
  description: string,
) {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['confidence'],
      additionalProperties: false,
    },
  } as const;
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

function isIgnorableDialogueEventType(type: string): boolean {
  return new Set([
    'response.created',
    'response.queued',
    'response.in_progress',
    'response.output_item.added',
    'response.output_item.done',
    'response.content_part.added',
    'response.content_part.done',
    'response.output_text.done',
    'response.function_call_arguments.delta',
  ]).has(type);
}

function collectFunctionCallArguments(
  output: unknown,
  expectedToolName: 'request_replan' | 'request_procedure_refinement',
): string | null {
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
      item['name'] !== expectedToolName ||
      typeof item['arguments'] !== 'string' ||
      argumentsValue !== null
    ) {
      throw invalidDialogueResponse();
    }
    argumentsValue = item['arguments'];
  }
  return argumentsValue;
}

function parseDialogueConfidence(argumentsJson: string): number {
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
