import type {
  PlanningPromptPacket,
  ProcedureAuthoringPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  createOpenAIResponsesPlannerProvider,
  createOpenAIResponsesPlannerProviderFromEnv,
  OpenAIPlannerProviderError,
  type OpenAIDialogueResponsesRequest,
  type OpenAIEmbeddingsRequest,
  type OpenAIProcedureRefinementDialogueResponsesRequest,
  type OpenAIResponsesClient,
  type OpenAIResponsesRequest,
  type OpenAIResponsesResult,
} from '../../../packages/openai-planner-provider/src/index.js';

const packet = {
  renderedPrompt: 'Return a planning proposal as JSON.',
} as PlanningPromptPacket;
const replanPacket = {
  renderedPrompt: 'Return a complete local replan as JSON.',
} as ReplanningPromptPacket;
const procedurePacket = {} as ProcedureAuthoringPromptPacket;
const dialoguePacket = {
  renderedPrompt: 'Answer and call request_replan only for a clear Plan change.',
} as Parameters<
  NonNullable<ReturnType<typeof createOpenAIResponsesPlannerProvider>['dialogue']>
>[0]['packet'];
const procedureRefinementDialoguePacket = {
  renderedPrompt: 'Discuss the authorized ProcedureTree scope and request refinement if needed.',
} as Parameters<
  NonNullable<
    ReturnType<typeof createOpenAIResponsesPlannerProvider>['procedureRefinementDialogue']
  >
>[0]['packet'];
const procedureRefinementPacket = {
  renderedPrompt: 'Return the complete refined ProcedureTree as JSON.',
} as Parameters<
  NonNullable<ReturnType<typeof createOpenAIResponsesPlannerProvider>['refineProcedure']>
>[0]['packet'];

function makeClient(response: OpenAIResponsesResult): {
  client: OpenAIResponsesClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => response);
  return {
    client: { responses: { create } },
    create,
  };
}

function makeStreamingClient(events: readonly unknown[]): {
  client: OpenAIResponsesClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  }));
  return { client: { responses: { create } }, create };
}

function input(signal = new AbortController().signal) {
  return {
    requestId: 'd9428888-122b-4ad5-a375-7f077f2832fc',
    packet,
    signal,
  };
}

describe('OpenAI Responses planner provider', () => {
  it('exposes Procedure embeddings only with an explicit separate embedding model', async () => {
    const responsesCreate = vi.fn(async () => ({ status: 'completed', output_text: '{}' }));
    const embeddingsCreate = vi.fn(async () => ({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    }));
    const withoutEmbeddings = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client: { responses: { create: responsesCreate } },
    });
    expect(withoutEmbeddings.embedProcedure).toBeUndefined();

    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      embeddingModel: 'text-embedding-3-large',
      client: {
        responses: { create: responsesCreate },
        embeddings: { create: embeddingsCreate },
      },
    });
    const signal = new AbortController().signal;
    await expect(
      provider.embedProcedure?.({
        requestId: 'c9544287-e87b-4729-9062-694d72bd4a2e',
        documents: ['create a sphere', 'scale the selected object'],
        signal,
      }),
    ).resolves.toEqual({
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
    expect(embeddingsCreate).toHaveBeenCalledWith(
      {
        model: 'text-embedding-3-large',
        input: ['create a sphere', 'scale the selected object'],
        encoding_format: 'float',
      } satisfies OpenAIEmbeddingsRequest,
      { signal },
    );
    expect(provider.describeRuntimeTreatment?.('procedure_embedding')).toMatchObject({
      profile: {
        model: { requested: 'text-embedding-3-large' },
        api: { surface: 'embeddings' },
      },
      generationSettings: {
        normalizedParameters: {
          model: 'text-embedding-3-large',
          encoding_format: 'float',
        },
      },
      costPolicy: {
        possibleProviderCost: true,
        basis: 'provider_pricing',
      },
    });
    expect(provider.describeRuntimeTreatment?.('initial_plan')).toMatchObject({
      profile: {
        model: { requested: 'gpt-5.4' },
        api: { surface: 'responses' },
      },
    });
    expect(provider.descriptor.description).toContain(
      'Procedure embeddings use model text-embedding-3-large',
    );
  });

  it('fails closed for invalid, oversized, failed, or aborted embedding requests', async () => {
    const embeddingsCreate = vi.fn(async () => ({ data: [{}] }));
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      embeddingModel: 'text-embedding-3-small',
      client: {
        responses: { create: vi.fn() },
        embeddings: { create: embeddingsCreate },
      },
    });
    const base = {
      requestId: '5f686163-6d7a-4ffb-a705-c665b2573ea3',
      signal: new AbortController().signal,
    };
    await expect(provider.embedProcedure?.({ ...base, documents: [] })).rejects.toThrow(
      'documents must contain 1-257',
    );
    await expect(
      provider.embedProcedure?.({ ...base, documents: Array.from({ length: 258 }, () => 'x') }),
    ).rejects.toThrow('documents must contain 1-257');
    await expect(
      provider.embedProcedure?.({ ...base, documents: ['valid'] }),
    ).rejects.toMatchObject({ code: 'request_failed' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.embedProcedure?.({ ...base, documents: ['valid'], signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'request_aborted' });
    expect(embeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, duplicate, or out-of-range embedding indices', async () => {
    for (const data of [
      [{ index: 0, embedding: [1] }],
      [
        { index: 0, embedding: [1] },
        { index: 0, embedding: [2] },
      ],
      [
        { index: 0, embedding: [1] },
        { index: 2, embedding: [2] },
      ],
    ]) {
      const provider = createOpenAIResponsesPlannerProvider({
        apiKey: 'sk-test-secret',
        model: 'gpt-5.4',
        embeddingModel: 'text-embedding-3-small',
        client: {
          responses: { create: vi.fn() },
          embeddings: { create: vi.fn(async () => ({ data })) },
        },
      });
      await expect(
        provider.embedProcedure?.({
          requestId: '930d9ccd-169a-49e4-8699-c9647eb8f5b2',
          documents: ['first', 'second'],
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'request_failed' });
    }
  });

  it('sends a non-streaming, non-stored JSON-object request and parses output JSON', async () => {
    const { client, create } = makeClient({
      status: 'completed',
      output_text: '{"plan":{"id":"snowman"}}',
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const signal = new AbortController().signal;

    expect(provider.describeRuntimeTreatment?.('initial_plan')).toEqual({
      profile: expect.objectContaining({
        descriptor: provider.descriptor,
        vendor: 'OpenAI',
        implementation: {
          name: '@operatingline/openai-planner-provider',
          version: '0.1.0',
        },
        model: {
          requested: 'gpt-5.4',
          resolvedRevision: null,
          resolution: 'provider_did_not_disclose',
        },
        api: expect.objectContaining({
          surface: 'responses',
          version: 'v1',
          sdkName: 'openai',
          sdkVersion: '7.4.0',
          endpointClass: 'vendor_public',
        }),
      }),
      generationSettings: {
        normalizedParameters: {
          endpoint: {
            origin: 'https://api.openai.com',
            pathSha256:
              'sha256-utf8-v1:2d234c97703ce824eaa4d98fbd2701668ef5e63e46f1574f2ea72e7927b1f57e',
          },
          model: 'gpt-5.4',
          max_output_tokens: 32_768,
          store: false,
          stream: false,
          text: { format: { type: 'json_object' } },
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
    });

    await expect(provider.generate(input(signal))).resolves.toEqual({
      plan: { id: 'snowman' },
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: 'gpt-5.4',
        input: packet.renderedPrompt,
        max_output_tokens: 32_768,
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      } satisfies OpenAIResponsesRequest,
      { signal },
    );
  });

  it('binds custom endpoint recipients into provider identity and exact runtime treatment', () => {
    const first = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      baseURL: 'https://inference-a.example/v1/',
    });
    const second = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      baseURL: 'https://inference-b.example/service/v1',
    });
    const sameOriginDifferentPath = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      baseURL: 'https://inference-a.example/service/v1',
    });
    const sameExplicitIdA = createOpenAIResponsesPlannerProvider({
      id: 'explicit-endpoint-provider',
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      baseURL: 'https://inference-a.example/v1',
    });
    const sameExplicitIdB = createOpenAIResponsesPlannerProvider({
      id: 'explicit-endpoint-provider',
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      baseURL: 'https://inference-b.example/v1',
    });

    expect(first.descriptor.id).not.toBe(second.descriptor.id);
    expect(first.descriptor.id).not.toBe(sameOriginDifferentPath.descriptor.id);
    expect(first.descriptor.id).toContain(
      ':endpoint-sha256-v1-5f6231bd2c6db10f68345665f08f994c5071626b78a96087f2e14f13622087c0',
    );
    expect(first.descriptor.description).toContain('https://inference-a.example');
    expect(first.describeRuntimeTreatment?.('procedure_refinement_dialogue')).toMatchObject({
      profile: { api: { endpointClass: 'self_hosted' } },
      generationSettings: {
        normalizedParameters: {
          endpoint: {
            origin: 'https://inference-a.example',
            pathSha256:
              'sha256-utf8-v1:2d234c97703ce824eaa4d98fbd2701668ef5e63e46f1574f2ea72e7927b1f57e',
          },
        },
      },
    });
    expect(sameExplicitIdA.describeRuntimeTreatment?.('procedure_refinement_dialogue')).not.toEqual(
      sameExplicitIdB.describeRuntimeTreatment?.('procedure_refinement_dialogue'),
    );
    expect(first.describeRuntimeTreatment?.('procedure_refinement_dialogue')).not.toEqual(
      sameOriginDifferentPath.describeRuntimeTreatment?.('procedure_refinement_dialogue'),
    );
  });

  it('rejects unsafe or credential-bearing custom provider endpoints', () => {
    for (const baseURL of [
      'https://user:secret@inference.example/v1',
      'https://inference.example/v1?api_key=secret',
      'https://inference.example/v1#secret',
      'http://inference.example/v1',
      'file:///tmp/provider',
    ]) {
      expect(() =>
        createOpenAIResponsesPlannerProvider({
          apiKey: 'sk-test-secret',
          model: 'gpt-5.4',
          baseURL,
        }),
      ).toThrow(/baseURL/);
    }
    expect(() =>
      createOpenAIResponsesPlannerProvider({
        apiKey: 'sk-test-secret',
        model: 'gpt-5.4',
        baseURL: 'http://127.0.0.1:11434/v1',
      }),
    ).not.toThrow();
  });

  it('uses the exact typed replan prompt and caller abort signal', async () => {
    const { client, create } = makeClient({
      status: 'completed',
      output_text: '{"requestId":"revision-request"}',
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const signal = new AbortController().signal;

    expect(provider.replan).toBeDefined();
    await expect(
      provider.replan?.({
        requestId: '57c52870-1a07-450c-84c0-691083751fab',
        packet: replanPacket,
        signal,
      }),
    ).resolves.toEqual({ requestId: 'revision-request' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: replanPacket.renderedPrompt,
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      }),
      { signal },
    );
  });

  it('uses the exact canonical Procedure packet prompt for explicit authoring', async () => {
    const { client, create } = makeClient({
      status: 'completed',
      output_text: '{"id":"generated.procedure"}',
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const signal = new AbortController().signal;

    expect(provider.authorProcedure).toBeDefined();
    await expect(
      provider.authorProcedure?.({
        requestId: 'ca8148af-c9a1-46aa-9122-fdf006ed8259',
        packet: procedurePacket,
        renderedPrompt: '{"formatVersion":"1.0.0"}',
        signal,
      }),
    ).resolves.toEqual({ id: 'generated.procedure' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: '{"formatVersion":"1.0.0"}',
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      }),
      { signal },
    );
  });

  it('streams assistant text and returns an answer without a replan tool call', async () => {
    const { client, create } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'The current ' },
      { type: 'response.output_text.delta', delta: 'Plan already does that.' },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'The current Plan already does that.' }],
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const emit = vi.fn();
    const signal = new AbortController().signal;

    await expect(
      provider.dialogue?.({
        requestId: '487665f9-297d-4118-9fe9-a13a1ef64bf3',
        packet: dialoguePacket,
        signal,
        emit,
      }),
    ).resolves.toEqual({
      assistantMessage: 'The current Plan already does that.',
      decision: { kind: 'answer' },
    });
    expect(emit.mock.calls).toEqual([
      [{ type: 'assistant_text_delta', delta: 'The current ' }],
      [{ type: 'assistant_text_delta', delta: 'Plan already does that.' }],
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: dialoguePacket.renderedPrompt,
        store: false,
        stream: true,
        parallel_tool_calls: false,
        tool_choice: 'auto',
        tools: [expect.objectContaining({ name: 'request_replan', strict: true })],
      } satisfies Partial<OpenAIDialogueResponsesRequest>),
      { signal },
    );
  });

  it('returns one bounded semantic replan decision from streamed function arguments', async () => {
    const { client } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'I can prepare that change for review.' },
      {
        type: 'response.function_call_arguments.done',
        name: 'request_replan',
        arguments: '{"confidence":0.94}',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'I can prepare that change for review.',
                },
              ],
            },
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: '{"confidence":0.94}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.dialogue?.({
        requestId: '0e914ce4-950c-47b1-9301-3edb81f948db',
        packet: dialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).resolves.toEqual({
      assistantMessage: 'I can prepare that change for review.',
      decision: { kind: 'replan', confidence: 0.94 },
    });
  });

  it('discloses and streams a typed ProcedureTree refinement decision', async () => {
    const { client, create } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'I can refine the selected leaf.' },
      {
        type: 'response.function_call_arguments.done',
        name: 'request_procedure_refinement',
        arguments: '{"confidence":0.93}',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'I can refine the selected leaf.' }],
            },
            {
              type: 'function_call',
              name: 'request_procedure_refinement',
              arguments: '{"confidence":0.93}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const emit = vi.fn();
    const signal = new AbortController().signal;

    expect(provider.procedureRefinementDialogue).toBeDefined();
    expect(provider.refineProcedure).toBeDefined();
    expect(provider.describeRuntimeTreatment?.('procedure_refinement_dialogue')).toMatchObject({
      generationSettings: {
        normalizedParameters: {
          stream: true,
          parallel_tool_calls: false,
          tool_choice: 'auto',
          tools: [{ type: 'function', name: 'request_procedure_refinement', strict: true }],
        },
        seed: null,
        determinism: 'non_deterministic',
      },
    });
    expect(provider.describeRuntimeTreatment?.('procedure_refinement')).toMatchObject({
      generationSettings: {
        normalizedParameters: {
          stream: false,
          text: { format: { type: 'json_object' } },
        },
        determinism: 'non_deterministic',
      },
    });
    await expect(
      provider.procedureRefinementDialogue?.({
        requestId: '0ccca1c9-98b5-40dd-935c-96f193a39e9b',
        packet: procedureRefinementDialoguePacket,
        signal,
        emit,
      }),
    ).resolves.toEqual({
      assistantMessage: 'I can refine the selected leaf.',
      decision: { kind: 'refine', confidence: 0.93, threshold: 0.8 },
    });
    expect(emit).toHaveBeenCalledWith({
      type: 'assistant_text_delta',
      delta: 'I can refine the selected leaf.',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: procedureRefinementDialoguePacket.renderedPrompt,
        stream: true,
        tools: [
          expect.objectContaining({
            name: 'request_procedure_refinement',
            strict: true,
          }),
        ],
      } satisfies Partial<OpenAIProcedureRefinementDialogueResponsesRequest>),
      { signal },
    );
  });

  it('returns a full ProcedureTree JSON value without parsing it as trusted protocol data', async () => {
    const targetTree = { id: 'tutorial.eye', revision: 4, nodes: [] };
    const { client, create } = makeClient({
      status: 'completed',
      output_text: JSON.stringify(targetTree),
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });
    const signal = new AbortController().signal;

    await expect(
      provider.refineProcedure?.({
        requestId: 'b73572af-48d8-4034-b42f-467eaa48b982',
        packet: procedureRefinementPacket,
        signal,
      }),
    ).resolves.toEqual(targetTree);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: procedureRefinementPacket.renderedPrompt,
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      }),
      { signal },
    );
  });

  it('keeps a below-threshold ProcedureTree refinement tool decision as an answer', async () => {
    const { client } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'No scoped change is warranted.' },
      {
        type: 'response.function_call_arguments.done',
        name: 'request_procedure_refinement',
        arguments: '{"confidence":0.4}',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'No scoped change is warranted.' }],
            },
            {
              type: 'function_call',
              name: 'request_procedure_refinement',
              arguments: '{"confidence":0.4}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.procedureRefinementDialogue?.({
        requestId: 'f172b105-91e8-42b6-b15f-bb4195399aa3',
        packet: procedureRefinementDialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).resolves.toEqual({
      assistantMessage: 'No scoped change is warranted.',
      decision: { kind: 'answer', confidence: 0.4, threshold: 0.8 },
    });
  });

  it('rejects unknown ProcedureTree refinement stream events', async () => {
    const { client } = makeStreamingClient([{ type: 'response.unrecognized' }]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.procedureRefinementDialogue?.({
        requestId: '4ddba10a-1219-4fd5-bc54-5b29793b039a',
        packet: procedureRefinementDialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'response_invalid_json' });
  });

  it('rejects malformed or duplicate replan calls without exposing provider payloads', async () => {
    const secret = 'sk-provider-secret';
    const { client } = makeStreamingClient([
      {
        type: 'response.function_call_arguments.done',
        name: 'request_replan',
        arguments: JSON.stringify({ confidence: 0.9, secret }),
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: JSON.stringify({ confidence: 0.9, secret }),
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    const error = await provider
      .dialogue?.({
        requestId: 'db328003-9973-4adf-8df6-f2af48a6bd2f',
        packet: dialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'response_invalid_json' });
    expect(String(error)).not.toContain(secret);
  });

  it('rejects duplicate replan calls in the completed response', async () => {
    const { client } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'Reviewable change.' },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Reviewable change.' }],
            },
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: '{"confidence":0.9}',
            },
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: '{"confidence":0.91}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.dialogue?.({
        requestId: '2bb8a746-1cab-4a0c-bea0-161b291483eb',
        packet: dialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'response_invalid_json' });
  });

  it('rejects final assistant text that does not exactly match the streamed text', async () => {
    const { client } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: 'Reviewable change.' },
      {
        type: 'response.function_call_arguments.done',
        name: 'request_replan',
        arguments: '{"confidence":0.9}',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Different final text.' }],
            },
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: '{"confidence":0.9}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.dialogue?.({
        requestId: '695d3194-ecff-4bf6-ad05-0dab69766c8f',
        packet: dialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'response_invalid_json' });
  });

  it('rejects a whitespace-only streamed replan reply at the provider boundary', async () => {
    const whitespace = ' '.repeat(4_000);
    const { client } = makeStreamingClient([
      { type: 'response.output_text.delta', delta: whitespace },
      {
        type: 'response.function_call_arguments.done',
        name: 'request_replan',
        arguments: '{"confidence":0.9}',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: whitespace }],
            },
            {
              type: 'function_call',
              name: 'request_replan',
              arguments: '{"confidence":0.9}',
            },
          ],
        },
      },
    ]);
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(
      provider.dialogue?.({
        requestId: '948d816b-3acf-4c38-8583-8c5a7520b497',
        packet: dialoguePacket,
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'response_invalid_json' });
  });

  it('rejects refusals without exposing refusal text', async () => {
    const secretRefusal = 'refusal includes sk-sensitive-value';
    const { client } = makeClient({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: secretRefusal }] }],
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    const error = await provider.generate(input()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'response_refused' });
    expect(String(error)).not.toContain(secretRefusal);
  });

  it('rejects incomplete responses without exposing provider details', async () => {
    const { client } = makeClient({
      status: 'incomplete',
      incomplete_details: { reason: 'sensitive-provider-detail' },
    });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    const error = await provider.generate(input()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'response_incomplete' });
    expect(String(error)).not.toContain('sensitive-provider-detail');
  });

  it('rejects non-JSON output', async () => {
    const { client } = makeClient({ status: 'completed', output_text: 'not json' });
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'response_invalid_json',
    });
  });

  it('passes the caller abort signal and sanitizes aborted failures', async () => {
    const controller = new AbortController();
    const create = vi.fn(async () => {
      controller.abort();
      throw new Error('transport failure with sk-test-secret');
    });
    const client: OpenAIResponsesClient = { responses: { create } };
    const provider = createOpenAIResponsesPlannerProvider({
      apiKey: 'sk-test-secret',
      model: 'gpt-5.4',
      client,
    });

    const error = await provider
      .generate(input(controller.signal))
      .catch((caught: unknown) => caught);
    expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
    expect(error).toBeInstanceOf(OpenAIPlannerProviderError);
    expect(error).toMatchObject({ code: 'request_aborted' });
    expect(String(error)).not.toContain('sk-test-secret');
  });

  it('is unavailable without a key and never leaks credentials in its descriptor', async () => {
    const key = 'sk-descriptor-secret';
    const provider = createOpenAIResponsesPlannerProvider({
      model: 'gpt custom/model',
    });
    const configured = createOpenAIResponsesPlannerProvider({
      apiKey: key,
      model: 'gpt-5.4',
      client: makeClient({ status: 'completed', output_text: '{}' }).client,
    });

    expect(provider.descriptor.availability).toEqual({
      available: false,
      reason: 'not_configured',
      message: 'An OpenAI API key is required to use this planner provider.',
    });
    expect(provider.descriptor.id).toBe('openai-responses:gpt_u20_custom_u2f_model');
    expect(
      createOpenAIResponsesPlannerProvider({ model: 'gpt_u20_custom/model' }).descriptor.id,
    ).not.toBe(provider.descriptor.id);
    expect(JSON.stringify(configured.descriptor)).not.toContain(key);
    await expect(provider.generate(input())).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('reads credentials only through the explicit from-env factory', () => {
    const provider = createOpenAIResponsesPlannerProviderFromEnv({
      model: 'gpt-5.4',
      env: { CUSTOM_OPENAI_KEY: 'sk-from-env' },
      apiKeyEnvironmentVariable: 'CUSTOM_OPENAI_KEY',
    });

    expect(provider.descriptor.availability).toEqual({ available: true });
    expect(JSON.stringify(provider.descriptor)).not.toContain('sk-from-env');
  });
});
