import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guideGoalRequestListSchema } from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

describe('public guide goal JSON Schema', () => {
  it('accepts the same pending-list wire inputs as the Zod boundary', async () => {
    const cases = [
      { value: {}, accepted: true },
      { value: { targetAdapterId: 'canvas', limit: 100 }, accepted: true },
      { value: { limit: 101 }, accepted: false },
      { value: { unknown: true }, accepted: false },
    ] as const;

    for (const contractCase of cases) {
      expect(guideGoalRequestListSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }

    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/guide-goal-request-list.schema.json'), 'utf8'),
    ) as object;
    await validatePublicJsonSchemaCases(schema, cases);
  });
});
