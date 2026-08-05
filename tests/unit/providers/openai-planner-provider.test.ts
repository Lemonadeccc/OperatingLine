import type { PlanningPromptPacket } from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  createOpenAIResponsesPlannerProvider,
  createOpenAIResponsesPlannerProviderFromEnv,
  OpenAIPlannerProviderError,
  type OpenAIResponsesClient,
  type OpenAIResponsesRequest,
  type OpenAIResponsesResult,
} from '../../../packages/openai-planner-provider/src/index.js';

const packet = {
  renderedPrompt: 'Return a planning proposal as JSON.',
} as PlanningPromptPacket;

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
