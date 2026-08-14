import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  interactionCatalogSchema,
  validateInteractionCatalog,
  type InteractionCatalog,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

function orderedMenu(catalog: InteractionCatalog) {
  const menu = catalog.recipes[0]!.procedureMaterialization?.menu;
  if (
    menu?.availability !== 'available' ||
    menu.parameterBinding !== 'ordered_parameter_operations'
  ) {
    throw new Error('Expected ordered parameter operations fixture');
  }
  return menu;
}

describe('interaction catalog protocol', () => {
  it('covers every Blender action with a native path or explicit semantic fallback', () => {
    const catalog = interactionCatalogSchema.parse(blenderInteractionCatalog);

    expect(catalog.catalogVersion).toBe('1.11.0');
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
    ).toHaveLength(15);
    expect(
      blenderInteractionCatalogs.map((versionedCatalog) => versionedCatalog.catalogVersion),
    ).toEqual([
      '1.0.0',
      '1.1.0',
      '1.2.0',
      '1.3.0',
      '1.4.0',
      '1.5.0',
      '1.6.0',
      '1.7.0',
      '1.8.0',
      '1.9.0',
      '1.10.0',
      '1.11.0',
    ]);

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
    expect(sphere.procedureMaterialization).toMatchObject({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [{ name: 'radius', source: { kind: 'literal', value: 1 } }],
        controlOperations: {
          insertAfterStepId: 'operator.uv_sphere',
          operations: [
            {
              id: 'control.location',
              target: { kind: 'control', hostId: 'VIEW3D_PT_item.transform.location' },
              path: ['Sidebar', 'Item', 'Transform', 'Location'],
              parameters: [
                {
                  name: 'value',
                  source: {
                    kind: 'action_argument',
                    argumentName: 'location',
                    transform: 'identity',
                  },
                },
              ],
            },
            {
              id: 'control.scale',
              parameters: [
                {
                  name: 'value',
                  source: {
                    kind: 'action_argument',
                    argumentName: 'radius',
                    transform: 'uniform_vector3',
                  },
                },
              ],
            },
            {
              id: 'control.object_name',
              parameters: [
                {
                  name: 'value',
                  source: {
                    kind: 'action_argument',
                    argumentName: 'objectName',
                    transform: 'identity',
                  },
                },
              ],
            },
          ],
        },
        omittedActionArguments: [
          {
            argumentName: 'resourceId',
            reason: 'The logical resource identifier has no user-facing Blender control.',
          },
        ],
      },
      shortcut: {
        availability: 'unavailable',
        reason: 'No versioned shortcut recipe is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    expect(blenderInteractionCatalogs.at(-2)!.recipes[0]!.procedureMaterialization?.menu).toEqual({
      availability: 'available',
      source: 'guidance.native_path',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'accepted_action_arguments',
    });
    expect(catalog.recipes.slice(1)).toSatisfy((recipes) =>
      recipes.every((recipe) => recipe.procedureMaterialization === undefined),
    );
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

    const semanticMaterialization = structuredClone(blenderInteractionCatalog);
    semanticMaterialization.recipes[0]!.guidance = structuredClone(
      semanticMaterialization.recipes.find((recipe) => recipe.guidance.kind === 'semantic_path')!
        .guidance,
    );
    expect(() => validateInteractionCatalog(semanticMaterialization, blenderActionCatalog)).toThrow(
      'available menu materialization requires native_path guidance',
    );

    const unsupportedMenuTarget = structuredClone(blenderInteractionCatalog);
    unsupportedMenuTarget.recipes[0]!.guidance.steps[0]!.target = {
      kind: 'panel',
      hostId: 'VIEW3D_PT_example',
    };
    expect(() => validateInteractionCatalog(unsupportedMenuTarget, blenderActionCatalog)).toThrow(
      'available menu materialization cannot represent panel targets',
    );

    const wrongInsertion = structuredClone(blenderInteractionCatalog);
    orderedMenu(wrongInsertion).controlOperations.insertAfterStepId = 'menu.mesh';
    expect(() => validateInteractionCatalog(wrongInsertion, blenderActionCatalog)).toThrow(
      'must be inserted after its execution step',
    );

    const conflictingControlId = structuredClone(blenderInteractionCatalog);
    orderedMenu(conflictingControlId).controlOperations.operations[0]!.id = 'menu.add';
    expect(() => validateInteractionCatalog(conflictingControlId, blenderActionCatalog)).toThrow(
      'control id menu.add conflicts',
    );

    const conflictingControlLabel = structuredClone(blenderInteractionCatalog);
    orderedMenu(conflictingControlLabel).controlOperations.operations[0]!.label = 'Add';
    expect(() => validateInteractionCatalog(conflictingControlLabel, blenderActionCatalog)).toThrow(
      'control label Add conflicts',
    );

    const duplicateParameter = structuredClone(blenderInteractionCatalog);
    const duplicateParameterMenu = orderedMenu(duplicateParameter);
    duplicateParameterMenu.operatorParameters.push(
      structuredClone(duplicateParameterMenu.operatorParameters[0]!),
    );
    expect(() => validateInteractionCatalog(duplicateParameter, blenderActionCatalog)).toThrow(
      'duplicate parameter radius',
    );

    for (const unsafeName of ['__proto__', 'prototype', 'constructor']) {
      const unsafeParameter = structuredClone(blenderInteractionCatalog);
      orderedMenu(unsafeParameter).operatorParameters[0]!.name = unsafeName;
      expect(() => validateInteractionCatalog(unsafeParameter, blenderActionCatalog)).toThrow(
        `unsafe parameter name ${unsafeName}`,
      );
    }

    const unknownArgument = structuredClone(blenderInteractionCatalog);
    const unknownSource =
      orderedMenu(unknownArgument).controlOperations.operations[0]!.parameters[0]!.source;
    if (unknownSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    unknownSource.argumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownArgument, blenderActionCatalog)).toThrow(
      'unknown action argument missing',
    );

    const invalidUniformVector = structuredClone(blenderInteractionCatalog);
    const invalidUniformSource =
      orderedMenu(invalidUniformVector).controlOperations.operations[0]!.parameters[0]!.source;
    if (invalidUniformSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    invalidUniformSource.transform = 'uniform_vector3';
    expect(() => validateInteractionCatalog(invalidUniformVector, blenderActionCatalog)).toThrow(
      'uniform_vector3 requires numeric action argument location',
    );

    const duplicateMapping = structuredClone(blenderInteractionCatalog);
    const duplicateMappingSource =
      orderedMenu(duplicateMapping).controlOperations.operations[2]!.parameters[0]!.source;
    if (duplicateMappingSource.kind !== 'action_argument') {
      throw new Error('Expected action argument fixture');
    }
    duplicateMappingSource.argumentName = 'radius';
    expect(() => validateInteractionCatalog(duplicateMapping, blenderActionCatalog)).toThrow(
      'maps action argument radius more than once',
    );

    const mappedAndOmitted = structuredClone(blenderInteractionCatalog);
    orderedMenu(mappedAndOmitted).omittedActionArguments[0]!.argumentName = 'radius';
    expect(() => validateInteractionCatalog(mappedAndOmitted, blenderActionCatalog)).toThrow(
      'cannot be both mapped and omitted',
    );

    const unknownOmission = structuredClone(blenderInteractionCatalog);
    orderedMenu(unknownOmission).omittedActionArguments[0]!.argumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownOmission, blenderActionCatalog)).toThrow(
      'omits unknown action argument missing',
    );

    const duplicateOmission = structuredClone(blenderInteractionCatalog);
    const duplicateOmissionMenu = orderedMenu(duplicateOmission);
    duplicateOmissionMenu.omittedActionArguments.push(
      structuredClone(duplicateOmissionMenu.omittedActionArguments[0]!),
    );
    expect(() => validateInteractionCatalog(duplicateOmission, blenderActionCatalog)).toThrow(
      'omits action argument resourceId more than once',
    );

    const uncoveredArgument = structuredClone(blenderInteractionCatalog);
    orderedMenu(uncoveredArgument).omittedActionArguments = [];
    expect(() => validateInteractionCatalog(uncoveredArgument, blenderActionCatalog)).toThrow(
      'leaves action arguments unmapped: resourceId',
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

  it('keeps ordered parameter operations exact in Zod and public JSON Schema', async () => {
    const emptyControls = structuredClone(blenderInteractionCatalog);
    orderedMenu(emptyControls).controlOperations.operations = [];
    const emptyParameters = structuredClone(blenderInteractionCatalog);
    orderedMenu(emptyParameters).controlOperations.operations[0]!.parameters = [];
    const extraField = structuredClone(blenderInteractionCatalog) as unknown as Record<
      string,
      unknown
    >;
    const extraRecipes = extraField['recipes'] as Array<Record<string, unknown>>;
    const extraMaterialization = extraRecipes[0]!['procedureMaterialization'] as Record<
      string,
      unknown
    >;
    const extraMenu = extraMaterialization['menu'] as Record<string, unknown>;
    extraMenu['expression'] = 'radius * 3';
    const frozen = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.10.0',
    );
    if (frozen === undefined) throw new Error('Expected frozen InteractionCatalog 1.10.0');

    const unsafeParameterNames = ['__proto__', 'prototype', 'constructor', 'not portable'].map(
      (name) => {
        const catalog = structuredClone(blenderInteractionCatalog);
        orderedMenu(catalog).operatorParameters[0]!.name = name;
        return catalog;
      },
    );

    const cases = [
      { value: blenderInteractionCatalog, accepted: true },
      { value: frozen, accepted: true },
      { value: emptyControls, accepted: false },
      { value: emptyParameters, accepted: false },
      { value: extraField, accepted: false },
      ...unsafeParameterNames.map((value) => ({ value, accepted: false as const })),
    ] as const;
    for (const contractCase of cases) {
      expect(interactionCatalogSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(resolve('protocol/schemas/v1/interaction-catalog.schema.json'), 'utf8'),
      ) as object,
      cases,
    );
  });
});
