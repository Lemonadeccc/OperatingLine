import type {
  PlanningPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  createOpenAIResponsesPlannerProvider,
  createOpenAIResponsesPlannerProviderFromEnv,
  OpenAIPlannerProviderError,
  type OpenAIDialogueResponsesRequest,
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
const dialoguePacket = {
  renderedPrompt: 'Answer and call request_replan only for a clear Plan change.',
} as Parameters<
  NonNullable<ReturnType<typeof createOpenAIResponsesPlannerProvider>['dialogue']>
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
          model: 'gpt-5.4',
          max_output_tokens: 32_768,
          store: false,
          stream: false,
          text: { format: { type: 'json_object' } },
        },
        seed: null,
        determinism: 'non_deterministic',
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
