import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { deferMcpInputValidation } from '../../../services/orchestrator/src/mcp-input-validation.js';

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
});
