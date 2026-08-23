import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  deferMcpInputValidation,
  withMcpJsonSchemaReferences,
} from '../../../services/orchestrator/src/mcp-input-validation.js';

describe('deferred MCP input validation', () => {
  it('preserves the advertised schema while passing malformed input to the handler', async () => {
    const strictSchema = z.strictObject({ requestId: z.uuid() });
    const deferred = deferMcpInputValidation(strictSchema);
    const advertised = deferred['~standard'].jsonSchema.input({
      target: 'draft-2020-12',
    });

    expect(advertised).toMatchObject({
      type: 'object',
      required: ['requestId'],
      additionalProperties: false,
    });
    expect(await deferred['~standard'].validate({ secret: 'malformed' })).toEqual({
      value: { secret: 'malformed' },
    });
  });

  it('deduplicates advertised JSON Schema without replacing Zod validation', async () => {
    const shared = z.strictObject({ requestId: z.uuid() });
    const schema = z.strictObject({ primary: shared, secondary: shared });
    const referenced = withMcpJsonSchemaReferences(schema);
    const advertised = referenced['~standard'].jsonSchema.input({
      target: 'draft-2020-12',
    });
    const advertisedOutput = referenced['~standard'].jsonSchema.output({
      target: 'draft-2020-12',
    });

    expect(advertised).toMatchObject({ type: 'object' });
    expect(advertisedOutput).toMatchObject({ type: 'object' });
    expect(JSON.stringify(advertised)).toContain('"$ref"');
    expect(JSON.stringify(advertised).length).toBeLessThan(
      JSON.stringify(z.toJSONSchema(schema, { target: 'draft-2020-12', reused: 'inline' })).length,
    );
    const valid = {
      primary: { requestId: '123e4567-e89b-42d3-a456-426614174000' },
      secondary: { requestId: '123e4567-e89b-42d3-a456-426614174001' },
    };
    expect(await referenced['~standard'].validate(valid)).toEqual({ value: valid });
    expect(
      await referenced['~standard'].validate({
        ...valid,
        secondary: { requestId: 'not-a-uuid' },
      }),
    ).toHaveProperty('issues');
  });
});
