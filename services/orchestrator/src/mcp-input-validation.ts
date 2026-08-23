import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';

/**
 * Advertise a Zod schema with internal JSON Schema references while retaining
 * the original Zod validator and inferred input/output types.
 *
 * Large MCP lifecycle unions otherwise repeat the same executor-specific
 * branches until a single tools/list frame exceeds common stdio limits.
 */
export function withMcpJsonSchemaReferences<
  TSchema extends z.ZodType<Record<string, unknown>, Record<string, unknown>>,
>(schema: TSchema): StandardSchemaWithJSON<z.input<TSchema>, z.output<TSchema>> {
  const standard = schema['~standard'];
  const inputSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'ref',
  });
  const outputSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'output',
    reused: 'ref',
  });

  return {
    '~standard': {
      version: 1,
      vendor: standard.vendor,
      validate: (value, options) => standard.validate(value, options),
      jsonSchema: {
        input: () => ({ ...inputSchema, type: 'object' }),
        output: () => ({ ...outputSchema, type: 'object' }),
      },
    },
  };
}

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
