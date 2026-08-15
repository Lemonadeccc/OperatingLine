import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { procedureOperationSearchRequestSchema } from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

describe('public procedure operation search JSON Schema', () => {
  it('matches the strict selector and revision dependency boundary', async () => {
    const cases = [
      { value: {}, accepted: false },
      { value: { limit: 10 }, accepted: false },
      { value: { revision: 1 }, accepted: false },
      { value: { revision: 1, modality: 'semantic' }, accepted: false },
      {
        value: { treeId: 'snowman.eye.left.procedure', revision: 1 },
        accepted: true,
      },
      {
        value: {
          modality: 'menu',
          menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
          limit: 10,
        },
        accepted: true,
      },
      {
        value: {
          operationKind: 'operator_property_update',
          targetHostId: 'mesh.primitive_ico_sphere_add.subdivisions',
          interactionPath: ['Adjust Last Operation', 'Subdivisions'],
          surfaceOperationId: 'shortcut.open_adjust_last',
        },
        accepted: true,
      },
      { value: { operationKind: 'property_update' }, accepted: false },
      { value: { interactionPath: [] }, accepted: false },
    ] as const;

    for (const contractCase of cases) {
      expect(procedureOperationSearchRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }

    const schema = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1/procedure-operation-search-request.schema.json'),
        'utf8',
      ),
    ) as object;
    await validatePublicJsonSchemaCases(schema, cases);
  });
});
