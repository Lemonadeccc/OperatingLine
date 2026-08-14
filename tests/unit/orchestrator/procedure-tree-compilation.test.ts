import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from '@operatingline/orchestrator';
import { compileProcedureTreeToGuidePlan, parseProcedureTree } from '@operatingline/protocol';

describe('procedure tree compilation', () => {
  it('produces a structurally valid plan accepted by the pinned Blender ActionCatalog', () => {
    const tree = parseProcedureTree(
      JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
    );
    const plan = compileProcedureTreeToGuidePlan(tree);

    expect(validateGuidePlanStructure(plan)).toBe('blender');
    expect(() => validateGuidePlanAgainstActionCatalog(plan, blenderActionCatalog)).not.toThrow();
  });
});
