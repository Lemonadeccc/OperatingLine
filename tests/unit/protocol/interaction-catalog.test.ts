import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import { interactionCatalogSchema, validateInteractionCatalog } from '@operatingline/protocol';

describe('interaction catalog protocol', () => {
  it('covers every Blender action with a native path or explicit semantic fallback', () => {
    const catalog = interactionCatalogSchema.parse(blenderInteractionCatalog);

    expect(catalog.catalogVersion).toBe('1.8.0');
    expect(catalog.actionCatalogVersion).toBe(blenderActionCatalog.catalogVersion);
    expect(catalog.hostVersionRange).toBe('>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0');
    expect(catalog.recipes.map((recipe) => recipe.actionName)).toEqual(
      blenderActionCatalog.actions.map((action) => action.name),
    );
    expect(
      catalog.recipes
        .filter((recipe) => recipe.guidance.kind === 'native_path')
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
    ]);
    expect(
      catalog.recipes.filter((recipe) => recipe.guidance.kind === 'semantic_path'),
    ).toHaveLength(14);
    expect(
      blenderInteractionCatalogs.map((versionedCatalog) => versionedCatalog.catalogVersion),
    ).toEqual(['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0']);

    const sphere = catalog.recipes[0]!;
    expect(sphere.guidance.steps.map((step) => step.label)).toEqual([
      'Layout',
      'Add',
      'Mesh',
      'UV Sphere',
    ]);
    expect(sphere.guidance).toMatchObject({
      kind: 'native_path',
      execution: {
        stepId: 'operator.uv_sphere',
        operatorId: 'mesh.primitive_uv_sphere_add',
        binding: 'accepted_plan_action',
      },
    });
  });

  it('rejects ambiguous recipes, broken execution bindings, and action coverage drift', () => {
    const duplicate = structuredClone(blenderInteractionCatalog);
    duplicate.recipes.push(structuredClone(duplicate.recipes[0]!));
    expect(() => validateInteractionCatalog(duplicate, blenderActionCatalog)).toThrow(
      'duplicate recipe',
    );

    const brokenExecution = structuredClone(blenderInteractionCatalog);
    const native = brokenExecution.recipes[0]!.guidance;
    if (native.kind !== 'native_path') {
      throw new Error('Expected native fixture recipe');
    }
    native.execution.operatorId = 'mesh.primitive_ico_sphere_add';
    expect(() => validateInteractionCatalog(brokenExecution, blenderActionCatalog)).toThrow(
      'bind its operator target exactly',
    );

    const missing = structuredClone(blenderInteractionCatalog);
    missing.recipes.pop();
    expect(() => validateInteractionCatalog(missing, blenderActionCatalog)).toThrow(
      'action coverage mismatch',
    );
  });

  it('emits a strict language-neutral JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/interaction-catalog.schema.json'), 'utf8'),
    ) as { additionalProperties?: boolean };
    expect(schema.additionalProperties).toBe(false);
  });
});
