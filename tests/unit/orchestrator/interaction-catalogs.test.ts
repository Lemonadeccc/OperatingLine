import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';

import { createActionCatalogRegistry } from '../../../services/orchestrator/src/action-catalogs.js';
import { createInteractionCatalogRegistry } from '../../../services/orchestrator/src/interaction-catalogs.js';

describe('interaction catalog registry', () => {
  it('selects the latest semantic interaction catalog version and supports exact lookup', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    const version100 = structuredClone(blenderInteractionCatalogs[0]!);
    const version110 = structuredClone(version100);
    version110.catalogVersion = '1.10.0';
    const registry = createInteractionCatalogRegistry(
      [version100, version110],
      actionCatalogRegistry,
    );

    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: version100.actionCatalogVersion,
      }).catalogVersion,
    ).toBe('1.10.0');
    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: version100.actionCatalogVersion,
        interactionCatalogVersion: '1.0.0',
      }).catalogVersion,
    ).toBe('1.0.0');
  });

  it('indexes bundled catalogs by their exact action catalog bindings', () => {
    const registry = createInteractionCatalogRegistry(
      blenderInteractionCatalogs,
      createActionCatalogRegistry(blenderActionCatalogs),
    );

    expect(registry.list()).toHaveLength(blenderInteractionCatalogs.length);
    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      }).catalogVersion,
    ).toBe(blenderInteractionCatalog.catalogVersion);
    const historical = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.9.0',
    });
    expect(historical.catalogVersion).toBe('1.9.0');
    expect(
      historical.recipes.every((recipe) => recipe.procedureMaterialization === undefined),
    ).toBe(true);

    const frozenLegacy = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.10.0',
    });
    expect(frozenLegacy.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'accepted_action_arguments',
    });
    const frozenOrderedMenu = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.11.0',
    });
    expect(frozenOrderedMenu.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    const frozenShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.12.0',
    });
    expect(frozenShortcut.recipes[0]!.procedureMaterialization?.shortcut).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(frozenShortcut.recipes[1]!.procedureMaterialization).toBeUndefined();
    const frozenIcosphere = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.13.0',
    });
    expect(
      frozenIcosphere.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
      )?.procedureMaterialization?.menu,
    ).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(
      frozenIcosphere.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cube')
        ?.procedureMaterialization,
    ).toBeUndefined();
    const frozenCube = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.14.0',
    });
    expect(
      frozenCube.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cube')
        ?.procedureMaterialization?.menu,
    ).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(
      frozenCube.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_plane')
        ?.procedureMaterialization,
    ).toBeUndefined();
    const frozenPlane = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.15.0',
    });
    expect(
      frozenPlane.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_plane')
        ?.procedureMaterialization?.menu,
    ).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(
      frozenPlane.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_torus')
        ?.procedureMaterialization,
    ).toBeUndefined();
    const frozenTorus = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.16.0',
    });
    expect(
      frozenTorus.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_torus')
        ?.procedureMaterialization?.menu,
    ).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(
      frozenTorus.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cone')
        ?.procedureMaterialization,
    ).toBeUndefined();
    const frozenCone = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.17.0',
    });
    expect(
      frozenCone.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cone')
        ?.procedureMaterialization?.menu,
    ).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(
      frozenCone.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cylinder')
        ?.procedureMaterialization,
    ).toBeUndefined();
    const frozenUvShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.18.0',
    });
    expect(
      frozenUvShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available' });
    expect(
      frozenUvShortcut.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cube')
        ?.procedureMaterialization?.shortcut,
    ).toEqual({
      availability: 'unavailable',
      reason: 'No verified shortcut procedure is available.',
    });
    expect(blenderInteractionCatalog.catalogVersion).toBe('1.19.0');
    const latestShortcut = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_cube',
    )?.procedureMaterialization?.shortcut;
    expect(latestShortcut).toMatchObject({
      availability: 'available',
      source: 'catalog.ordered_shortcut_operations',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      projection: 'candidate_only',
    });
    if (latestShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Cube shortcut recipe to be available');
    }
    const uvShortcut = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    )?.procedureMaterialization?.shortcut;
    if (uvShortcut?.availability !== 'available') {
      throw new Error('Expected the latest UV Sphere shortcut recipe to remain available');
    }
    expect(latestShortcut.preconditions).toEqual(uvShortcut.preconditions);
    expect(latestShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.add_cube',
      'shortcut.move_x',
      'shortcut.move_y',
      'shortcut.move_z',
      'shortcut.scale',
      'shortcut.rename',
    ]);
    expect(latestShortcut.operations).toEqual([
      {
        id: 'shortcut.add_cube',
        label: 'Add Cube',
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'Cube'],
        parameters: [
          { name: 'size', source: { kind: 'literal', value: 2 } },
          { name: 'location', source: { kind: 'literal', value: [0, 0, 0] } },
        ],
      },
      ...(['X', 'Y', 'Z'] as const).map((axis) => ({
        id: `shortcut.move_${axis.toLowerCase()}`,
        label: `Move ${axis}`,
        keyMode: 'sequence' as const,
        keys: ['G', axis],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument',
              argumentName: 'location',
              transform: `vector3_${axis.toLowerCase()}`,
            },
          },
          { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
        ],
      })),
      {
        id: 'shortcut.scale',
        label: 'Scale',
        keyMode: 'sequence',
        keys: ['S'],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument',
              argumentName: 'size',
              transform: 'divide_by_two',
            },
          },
          { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
        ],
      },
      {
        id: 'shortcut.rename',
        label: 'Rename Object',
        keyMode: 'sequence',
        keys: ['F2'],
        parameters: [
          {
            name: 'text',
            source: {
              kind: 'action_argument',
              argumentName: 'objectName',
              transform: 'identity',
            },
          },
          { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
        ],
      },
    ]);
    expect(latestShortcut.omittedActionArguments).toEqual([
      expect.objectContaining({ argumentName: 'resourceId' }),
    ]);
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          expect.objectContaining({ name: 'subdivisions' }),
          expect.objectContaining({ name: 'radius' }),
        ],
        controlOperations: {
          insertAfterStepId: 'operator.icosphere',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: { availability: 'unavailable' },
      mcp: { availability: 'unavailable' },
    });
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_plane',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          {
            name: 'size',
            source: {
              kind: 'action_argument',
              argumentName: 'size',
              transform: 'identity',
            },
          },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.plane',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_cube',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          {
            name: 'size',
            source: {
              kind: 'action_argument',
              argumentName: 'size',
              transform: 'identity',
            },
          },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.cube',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: {
        availability: 'available',
        projection: 'candidate_only',
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_cone',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          expect.objectContaining({ name: 'vertices' }),
          expect.objectContaining({ name: 'radius1' }),
          expect.objectContaining({ name: 'radius2' }),
          expect.objectContaining({
            name: 'depth',
            source: expect.objectContaining({
              kind: 'derived_action_arguments',
              derivation: 'segment_frame',
              output: 'distance',
            }),
          }),
          expect.objectContaining({ name: 'end_fill_type' }),
          expect.objectContaining({ name: 'calc_uvs' }),
          expect.objectContaining({ name: 'enter_editmode' }),
          expect.objectContaining({ name: 'align' }),
          expect.objectContaining({ name: 'location' }),
          expect.objectContaining({
            name: 'rotation',
            source: expect.objectContaining({
              kind: 'derived_action_arguments',
              derivation: 'segment_frame',
              output: 'rotation_euler_xyz_align_z',
            }),
          }),
          expect.objectContaining({ name: 'scale' }),
        ],
        controlOperations: {
          insertAfterStepId: 'operator.cone',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_cylinder',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          { name: 'vertices', source: { kind: 'literal', value: 32 } },
          {
            name: 'radius',
            source: { kind: 'action_argument', argumentName: 'radius', transform: 'identity' },
          },
          {
            name: 'depth',
            source: {
              kind: 'derived_action_arguments',
              derivation: 'segment_frame',
              startArgumentName: 'start',
              endArgumentName: 'end',
              output: 'distance',
            },
          },
          { name: 'end_fill_type', source: { kind: 'literal', value: 'NGON' } },
          { name: 'calc_uvs', source: { kind: 'literal', value: false } },
          { name: 'enter_editmode', source: { kind: 'literal', value: false } },
          { name: 'align', source: { kind: 'literal', value: 'WORLD' } },
          { name: 'location', source: { kind: 'literal', value: [0, 0, 0] } },
          {
            name: 'rotation',
            source: {
              kind: 'derived_action_arguments',
              derivation: 'segment_frame',
              startArgumentName: 'start',
              endArgumentName: 'end',
              output: 'rotation_euler_xyz_align_z',
            },
          },
          { name: 'scale', source: { kind: 'literal', value: [1, 1, 1] } },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.cylinder',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    expect(
      blenderInteractionCatalog.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_torus',
      )?.procedureMaterialization,
    ).toMatchObject({
      menu: {
        availability: 'available',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          expect.objectContaining({ name: 'major_segments' }),
          expect.objectContaining({ name: 'minor_segments' }),
          expect.objectContaining({
            name: 'mode',
            source: { kind: 'literal', value: 'MAJOR_MINOR' },
          }),
          expect.objectContaining({ name: 'major_radius' }),
          expect.objectContaining({ name: 'minor_radius' }),
        ],
        controlOperations: {
          insertAfterStepId: 'operator.torus',
          operations: [
            expect.objectContaining({ id: 'control.location' }),
            expect.objectContaining({ id: 'control.object_name' }),
          ],
        },
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      },
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
  });

  it('keeps the InteractionCatalog 1.10.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.10.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7341b663fe5b6a6ce096a0aa370fb35b2345f3021a46e515d3e9476a5b630bf4',
    );
  });

  it('keeps the InteractionCatalog 1.11.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.11.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '308cafdaa22bb64a66e98464e841c92916dcea5d4fead9be6689d1d931537880',
    );
  });

  it('keeps the InteractionCatalog 1.12.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.12.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '1e02e7295d1e305887ddf79409e7113e4267ea89a5fd18e44caac5b254731375',
    );
  });

  it('keeps the InteractionCatalog 1.13.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.13.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '1c97dfa118715546eafe3709624469de97edbc22a20102a80c8710f0b46b10dc',
    );
  });

  it('keeps the InteractionCatalog 1.14.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.14.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'bcdd69b9b1f345d6e4c27ff2e316c4d44cb931355ab01f4e7f7a013022439746',
    );
  });

  it('keeps the InteractionCatalog 1.15.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.15.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'a4d799f155eb58cf53d1ccc8689fc4b4b55cc87739ea2d1d54a8f03d1050e0d6',
    );
  });

  it('keeps the InteractionCatalog 1.16.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.16.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '68945039a55f0cfef011d0472383e6f2e4809b181ca6def547cd78ff5660854f',
    );
  });

  it('keeps the InteractionCatalog 1.17.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.17.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7dac53c0ff399a54e91b460b91caf5354824827ad4d801b3fb24e016d665d132',
    );
  });

  it('keeps the InteractionCatalog 1.18.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.18.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'f34350f6dbd3edc53360e933281457ab7d12db29a3a81311eae66470a48ff735',
    );
  });

  it('keeps the latest TypeScript and Blender extension catalogs byte-identical', () => {
    const catalogBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog.json'),
    );
    const extensionBytes = readFileSync(
      resolve('adapters/blender/extension/operating_line/resources/interaction-catalog.json'),
    );

    expect(extensionBytes).toEqual(catalogBytes);
  });

  it('rejects duplicate catalogs and missing action catalog bindings', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    expect(() =>
      createInteractionCatalogRegistry(
        [blenderInteractionCatalog, blenderInteractionCatalog],
        actionCatalogRegistry,
      ),
    ).toThrow('Duplicate interaction catalog');

    const missingBinding = structuredClone(blenderInteractionCatalog);
    missingBinding.actionCatalogVersion = '2.0.0';
    expect(() => createInteractionCatalogRegistry([missingBinding], actionCatalogRegistry)).toThrow(
      'Action catalog blender@2.0.0 is not installed',
    );
  });

  it('rejects interaction catalogs that do not exactly cover the bound action catalog', () => {
    const mismatched = structuredClone(blenderInteractionCatalog);
    mismatched.recipes.pop();

    expect(() =>
      createInteractionCatalogRegistry(
        [mismatched],
        createActionCatalogRegistry(blenderActionCatalogs),
      ),
    ).toThrow('Interaction catalog action coverage mismatch');
  });

  it('rejects interaction catalog host and adapter ranges outside the ActionCatalog', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    const invalidHostRange = structuredClone(blenderInteractionCatalog);
    invalidHostRange.hostVersionRange = '>=9.0.0 <10.0.0';
    expect(() =>
      createInteractionCatalogRegistry([invalidHostRange], actionCatalogRegistry),
    ).toThrow('host range');

    const invalidAdapterRange = structuredClone(blenderInteractionCatalog);
    invalidAdapterRange.adapterVersionRange = '>=9.0.0 <10.0.0';
    expect(() =>
      createInteractionCatalogRegistry([invalidAdapterRange], actionCatalogRegistry),
    ).toThrow('adapter range');
  });

  it('fails closed for unavailable bindings and interaction catalog versions', () => {
    const registry = createInteractionCatalogRegistry(
      [blenderInteractionCatalog],
      createActionCatalogRegistry(blenderActionCatalogs),
    );

    expect(() => registry.get({ targetAdapterId: 'gimp', actionCatalogVersion: '1.0.0' })).toThrow(
      'No interaction catalog is installed',
    );
    expect(() =>
      registry.get({ targetAdapterId: 'blender', actionCatalogVersion: '1.0.0' }),
    ).toThrow('No interaction catalog is installed');
    expect(() =>
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
        interactionCatalogVersion: '2.0.0',
      }),
    ).toThrow('is not installed');
  });
});
