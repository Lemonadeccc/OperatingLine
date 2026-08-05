import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

/**
 * Keep a tool's advertised JSON Schema while deferring validation to its handler.
 * Use this only when the handler must return a domain-specific structured error
 * instead of the MCP SDK's pre-handler plain-text validation result.
 */
export function deferMcpInputValidation<TInput, TOutput>(
  schema: StandardSchemaWithJSON<TInput, TOutput>,
): StandardSchemaWithJSON<unknown, unknown> {
  const standard = schema['~standard'];
  return {
    '~standard': {
      version: 1,
      vendor: 'operatingline',
      validate: (value: unknown) => ({ value }),
      jsonSchema: standard.jsonSchema,
    },
  };
}
