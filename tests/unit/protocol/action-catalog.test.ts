import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  actionCatalogSchema,
  planningContextSchema,
  validateActionCatalog,
} from '@operatingline/protocol';

describe('action catalog protocol', () => {
  it('validates the versioned Blender allowlist and argument contracts', () => {
    const catalog = actionCatalogSchema.parse(blenderActionCatalog);

    expect(catalog.catalogVersion).toBe('1.0.0');
    expect(catalog.adapterId).toBe('blender');
    expect(catalog.actions.map((action) => action.name)).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_primitive_batch',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.render_scene.create',
      'blender.render_rig.create',
      'blender.render.execute_preview',
    ]);
    expect(
      catalog.actions.find((action) => action.name === 'blender.render.execute_preview')?.safety,
    ).toMatchObject({ sideEffect: 'managed_file_write', fileAccess: 'managed_temp' });
  });

  it('rejects duplicate actions and required argument names absent from properties', () => {
    const duplicate = structuredClone(blenderActionCatalog);
    duplicate.actions.push(structuredClone(duplicate.actions[0]!));
    expect(() => validateActionCatalog(duplicate)).toThrow('duplicate action');

    const unknownRequired = structuredClone(blenderActionCatalog);
    unknownRequired.actions[0]!.argumentsSchema.required?.push('missingProperty');
    expect(() => validateActionCatalog(unknownRequired)).toThrow(
      'requires unknown argument property',
    );
  });

  it('emits strict language-neutral catalog and planning-context schemas', () => {
    for (const filename of ['action-catalog.schema.json', 'planning-context.schema.json']) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }

    expect(
      planningContextSchema.safeParse({
        protocolVersion: '1.0.0',
        targetAdapterId: 'blender',
        goal: null,
        requestedPlanId: null,
        recommendedRevision: null,
        catalog: blenderActionCatalog,
        companionStates: [],
        constraints: {
          singleAdapterPlan: true,
          executableActionsMustBeLeaves: true,
          dependenciesMustReferenceExecutableActions: true,
          unknownActionsMustBeRejected: true,
          semanticAnchorsOnly: true,
          immutablePlanRevisions: true,
          humanApprovalRequired: true,
          executionOrder: 'dependsOn_topology_then_order_then_id',
        },
        submission: {
          toolName: 'operatingline.guide.propose',
          targetAdapterId: 'blender',
          description: 'Submit the complete plan.',
        },
      }).success,
    ).toBe(true);
  });
});
