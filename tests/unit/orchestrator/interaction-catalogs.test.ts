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
    const historicalActionCatalogVersion = '1.12.0';
    const historical = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.9.0',
    });
    expect(historical.catalogVersion).toBe('1.9.0');
    expect(
      historical.recipes.every((recipe) => recipe.procedureMaterialization === undefined),
    ).toBe(true);

    const frozenLegacy = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.10.0',
    });
    expect(frozenLegacy.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'accepted_action_arguments',
    });
    const frozenOrderedMenu = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.11.0',
    });
    expect(frozenOrderedMenu.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    const frozenShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.12.0',
    });
    expect(frozenShortcut.recipes[0]!.procedureMaterialization?.shortcut).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(frozenShortcut.recipes[1]!.procedureMaterialization).toBeUndefined();
    const frozenIcosphere = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
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
      actionCatalogVersion: historicalActionCatalogVersion,
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
      actionCatalogVersion: historicalActionCatalogVersion,
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
      actionCatalogVersion: historicalActionCatalogVersion,
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
      actionCatalogVersion: historicalActionCatalogVersion,
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
      actionCatalogVersion: historicalActionCatalogVersion,
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
    const frozenCubeShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.19.0',
    });
    expect(
      frozenCubeShortcut.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_cube')
        ?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenCubeShortcut.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_plane')
        ?.procedureMaterialization?.shortcut,
    ).toEqual({
      availability: 'unavailable',
      reason: 'No verified shortcut procedure is available.',
    });
    const frozenPlaneShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.20.0',
    });
    expect(
      frozenPlaneShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_plane',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenPlaneShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
      )?.procedureMaterialization?.shortcut,
    ).toEqual({
      availability: 'unavailable',
      reason: 'No verified shortcut procedure is available.',
    });
    const frozenIcosphereShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.21.0',
    });
    expect(
      frozenIcosphereShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenIcosphereShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
      )?.procedureMaterialization,
    ).toBeUndefined();
    const frozenSubdivideShortcut = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: historicalActionCatalogVersion,
      interactionCatalogVersion: '1.22.0',
    });
    expect(
      frozenSubdivideShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenSubdivideShortcut.recipes.find(
        (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
      ),
    ).toBeUndefined();
    const frozenSubdivisionSurface = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: '1.13.0',
      interactionCatalogVersion: '1.23.0',
    });
    expect(
      frozenSubdivisionSurface.recipes.find(
        (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenSubdivisionSurface.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_bevel_edges',
      ),
    ).toBeUndefined();
    const frozenBevelEdges = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: '1.14.0',
      interactionCatalogVersion: '1.24.0',
    });
    expect(
      frozenBevelEdges.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_bevel_edges',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenBevelEdges.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_inset_faces',
      ),
    ).toBeUndefined();
    const frozenInsetFaces = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: '1.15.0',
      interactionCatalogVersion: '1.25.0',
    });
    expect(
      frozenInsetFaces.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_inset_faces',
      )?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenInsetFaces.recipes.find(
        (recipe) => recipe.actionName === 'blender.mesh.edit_poke_faces',
      ),
    ).toBeUndefined();
    const frozenPokeFaces = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: '1.16.0',
      interactionCatalogVersion: '1.26.0',
    });
    expect(
      frozenPokeFaces.recipes.find((recipe) => recipe.actionName === 'blender.mesh.edit_poke_faces')
        ?.procedureMaterialization?.shortcut,
    ).toMatchObject({ availability: 'available', projection: 'candidate_only' });
    expect(
      frozenPokeFaces.recipes.find((recipe) => recipe.actionName === 'blender.modifier.add_mirror'),
    ).toBeUndefined();
    expect(blenderInteractionCatalog.catalogVersion).toBe('1.27.0');
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
    const subdivisionSurface = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    );
    expect(subdivisionSurface?.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: {
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
      },
      mcp: { availability: 'unavailable' },
    });
    expect(subdivisionSurface?.guidance).toMatchObject({
      kind: 'semantic_path',
      steps: [
        expect.anything(),
        expect.anything(),
        {
          id: 'operator.subdivision_set',
          order: 3,
          label: 'Set Subdivision Level',
          intent: 'execute',
          target: { kind: 'operator', hostId: 'object.subdivision_set' },
        },
        expect.anything(),
      ],
    });
    const subdivisionShortcut = subdivisionSurface?.procedureMaterialization?.shortcut;
    if (subdivisionShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Subdivision Surface shortcut recipe to be available');
    }
    expect(subdivisionShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.add_subdivision_surface_level_one',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_viewport_level',
      'shortcut.close_adjust_last_operation',
    ]);
    expect(subdivisionShortcut.operations[0]).toMatchObject({
      kind: 'key_input',
      keyMode: 'chord',
      keys: ['CTRL', '1'],
      parameters: [
        { name: 'level', source: { kind: 'literal', value: 1 } },
        { name: 'relative', source: { kind: 'literal', value: false } },
        { name: 'ensure_modifier', source: { kind: 'literal', value: true } },
      ],
    });
    expect(subdivisionShortcut.operations[1]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.add_subdivision_surface_level_one',
        expectedOperatorId: 'object.subdivision_set',
      },
    });
    expect(subdivisionShortcut.operations[2]).toMatchObject({
      kind: 'operator_property_update',
      target: { kind: 'control', hostId: 'object.subdivision_set.level' },
      path: ['Adjust Last Operation', 'Level'],
      parameters: [
        {
          name: 'value',
          source: {
            kind: 'action_argument',
            argumentName: 'viewportLevel',
            transform: 'identity',
          },
        },
      ],
    });
    expect(subdivisionShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
    ]);
    const bevelEdges = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.edit_bevel_edges',
    );
    expect(bevelEdges?.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'available', projection: 'candidate_only' },
      mcp: { availability: 'unavailable' },
    });
    const bevelShortcut = bevelEdges?.procedureMaterialization?.shortcut;
    if (bevelShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Bevel Edges shortcut recipe to be available');
    }
    expect(bevelShortcut.operations).toHaveLength(10);
    expect(bevelShortcut.operations[3]).toMatchObject({
      id: 'shortcut.bevel_edges',
      keys: ['CTRL', 'B'],
      parameters: expect.arrayContaining([
        { name: 'offset_type', source: { kind: 'literal', value: 'OFFSET' } },
        { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
      ]),
    });
    expect(bevelShortcut.operations[4]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.bevel_edges',
        expectedOperatorId: 'mesh.bevel',
      },
    });
    expect(bevelShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    const insetFaces = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.edit_inset_faces',
    );
    expect(insetFaces?.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'available', projection: 'candidate_only' },
      mcp: { availability: 'unavailable' },
    });
    const insetShortcut = insetFaces?.procedureMaterialization?.shortcut;
    if (insetShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Inset Faces shortcut recipe to be available');
    }
    expect(insetShortcut.operations).toHaveLength(10);
    expect(insetShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.enter_edit_mode',
      'shortcut.select_face_mode',
      'shortcut.select_all_faces',
      'shortcut.inset_faces',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_inset_thickness',
      'shortcut.set_inset_depth',
      'shortcut.set_inset_individual',
      'shortcut.close_adjust_last_operation',
      'shortcut.return_to_object_mode',
    ]);
    expect(insetShortcut.operations[3]).toMatchObject({
      keys: ['I'],
      parameters: expect.arrayContaining([
        { name: 'use_boundary', source: { kind: 'literal', value: true } },
        { name: 'use_individual', source: { kind: 'literal', value: false } },
        { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
      ]),
    });
    expect(insetShortcut.operations[4]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.inset_faces',
        expectedOperatorId: 'mesh.inset',
      },
    });
    expect(insetShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    if (latestShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Cube shortcut recipe to be available');
    }
    const uvShortcut = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    )?.procedureMaterialization?.shortcut;
    if (uvShortcut?.availability !== 'available') {
      throw new Error('Expected the latest UV Sphere shortcut recipe to remain available');
    }
    const planeShortcut = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_plane',
    )?.procedureMaterialization?.shortcut;
    if (planeShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Plane shortcut recipe to be available');
    }
    expect(planeShortcut.preconditions).toEqual(uvShortcut.preconditions);
    expect(planeShortcut.operations).toEqual([
      {
        id: 'shortcut.add_plane',
        label: 'Add Plane',
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'Plane'],
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
    expect(planeShortcut.omittedActionArguments).toEqual([
      {
        argumentName: 'resourceId',
        reason: 'The logical resource identifier has no user-facing Blender shortcut input.',
      },
    ]);
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
    const icosphereMaterialization = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
    )?.procedureMaterialization;
    expect(icosphereMaterialization).toMatchObject({
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
      shortcut: {
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
      },
      mcp: { availability: 'unavailable' },
    });
    const icosphereShortcut = icosphereMaterialization?.shortcut;
    if (icosphereShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Icosphere shortcut recipe to be available');
    }
    expect(icosphereShortcut.preconditions).toEqual([
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'scene_state', label: '3D Cursor', value: 'World origin' },
      { kind: 'scene_state', label: 'Transform Orientation', value: 'GLOBAL' },
    ]);
    expect(icosphereShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.add_icosphere',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_subdivisions',
      'shortcut.set_radius',
      'shortcut.close_adjust_last_operation',
      'shortcut.move_x',
      'shortcut.move_y',
      'shortcut.move_z',
      'shortcut.rename',
    ]);
    expect(icosphereShortcut.operations).toEqual([
      {
        kind: 'key_input',
        id: 'shortcut.add_icosphere',
        label: 'Add Icosphere',
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'Ico Sphere'],
        parameters: [],
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        label: 'Open Adjust Last Operation',
        keyMode: 'sequence',
        keys: ['F9'],
        parameters: [],
        opensSurface: {
          kind: 'adjust_last_operation',
          hostId: 'screen.redo_last',
          sourceOperationId: 'shortcut.add_icosphere',
          expectedOperatorId: 'mesh.primitive_ico_sphere_add',
        },
      },
      ...(['subdivisions', 'radius'] as const).map((property) => ({
        kind: 'operator_property_update' as const,
        id: `shortcut.set_${property}`,
        label: `Set ${property === 'subdivisions' ? 'Subdivisions' : 'Radius'}`,
        surfaceOperationId: 'shortcut.open_adjust_last_operation',
        target: {
          kind: 'control' as const,
          hostId: `mesh.primitive_ico_sphere_add.${property}`,
        },
        path: ['Adjust Last Operation', property === 'subdivisions' ? 'Subdivisions' : 'Radius'],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument' as const,
              argumentName: property,
              transform: 'identity',
            },
          },
        ],
      })),
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        label: 'Confirm Adjust Last Operation',
        keyMode: 'sequence',
        keys: ['ENTER'],
        parameters: [],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      },
      ...(['X', 'Y', 'Z'] as const).map((axis) => ({
        kind: 'key_input' as const,
        id: `shortcut.move_${axis.toLowerCase()}`,
        label: `Move ${axis}`,
        keyMode: 'sequence' as const,
        keys: ['G', axis, 'VALUE', 'ENTER'],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument' as const,
              argumentName: 'location',
              transform: `vector3_${axis.toLowerCase()}`,
            },
          },
        ],
      })),
      {
        kind: 'key_input',
        id: 'shortcut.rename',
        label: 'Rename',
        keyMode: 'sequence',
        keys: ['F2', 'VALUE', 'ENTER'],
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
    ]);
    expect(icosphereShortcut.omittedActionArguments).toEqual([
      {
        argumentName: 'resourceId',
        reason: 'The logical resource identifier has no user-facing Blender shortcut input.',
      },
    ]);
    const subdivideMaterialization = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
    )?.procedureMaterialization;
    expect(subdivideMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: {
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
      },
      mcp: { availability: 'unavailable' },
    });
    const subdivideShortcut = subdivideMaterialization?.shortcut;
    if (subdivideShortcut?.availability !== 'available') {
      throw new Error('Expected the latest Subdivide shortcut recipe to be available');
    }
    expect(subdivideShortcut.preconditions).toEqual([
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      {
        kind: 'selection',
        label: 'Active Target',
        value: 'Exactly one accepted target Mesh object is active and selected',
      },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'modal_state', label: 'Modal UI', value: 'None' },
      {
        kind: 'scene_state',
        label: 'Mesh Elements',
        value: 'All target mesh elements are visible',
      },
      { kind: 'scene_state', label: 'Mesh Data Users', value: '1' },
      { kind: 'scene_state', label: 'UI Language', value: 'English' },
    ]);
    expect(subdivideShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.enter_edit_mode',
      'shortcut.select_all_mesh_elements',
      'shortcut.search_subdivide',
      'shortcut.execute_subdivide',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_number_of_cuts',
      'shortcut.set_smoothness',
      'shortcut.close_adjust_last_operation',
      'shortcut.return_to_object_mode',
    ]);
    expect(subdivideShortcut.operations[2]).toMatchObject({
      kind: 'key_input',
      keys: ['F3'],
      selectionPath: ['Subdivide'],
      parameters: [{ name: 'query', source: { kind: 'literal', value: 'subdivide' } }],
    });
    expect(subdivideShortcut.operations[4]).toMatchObject({
      kind: 'key_input',
      keys: ['F9'],
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: 'shortcut.execute_subdivide',
        expectedOperatorId: 'mesh.subdivide',
      },
    });
    expect(subdivideShortcut.operations.slice(5, 7)).toEqual([
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_number_of_cuts',
        label: 'Set Number of Cuts',
        surfaceOperationId: 'shortcut.open_adjust_last_operation',
        target: { kind: 'control', hostId: 'mesh.subdivide.number_cuts' },
        path: ['Adjust Last Operation', 'Number of Cuts'],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument',
              argumentName: 'cuts',
              transform: 'identity',
            },
          },
        ],
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_smoothness',
        label: 'Set Smoothness',
        surfaceOperationId: 'shortcut.open_adjust_last_operation',
        target: { kind: 'control', hostId: 'mesh.subdivide.smoothness' },
        path: ['Adjust Last Operation', 'Smoothness'],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument',
              argumentName: 'smooth',
              transform: 'identity',
            },
          },
        ],
      },
    ]);
    expect(subdivideShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
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

  it('keeps the InteractionCatalog 1.19.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.19.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7e1d454fcf36bbf52e76583bd15cb4e95c44791d644df8b8e5c1cf75cd12e1d0',
    );
  });

  it('keeps the InteractionCatalog 1.20.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.20.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '71c16e634e28f2318652495aa0019350c55ed9a4a193c29102a94e995015134d',
    );
  });

  it('keeps the InteractionCatalog 1.21.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.21.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'f1a47b2903f6d15f0a9fef76f9f30e4e399d4bca98c9f9473c3e920c9df6583c',
    );
  });

  it('keeps the InteractionCatalog 1.22.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.22.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'ec46a98ffea8230cb9d6133355b98e02763c4a58878c22631c5b3e08bea6b99e',
    );
  });

  it('changes only the version and Icosphere shortcut after InteractionCatalog 1.20.0', () => {
    const frozen = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.20.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const next = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.21.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenIcosphereShortcut = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_icosphere',
    )?.procedureMaterialization?.shortcut;

    expect({
      ...next,
      catalogVersion: frozen.catalogVersion,
      recipes: next.recipes.map((recipe) =>
        recipe.actionName === 'blender.mesh.create_icosphere'
          ? {
              ...recipe,
              procedureMaterialization: {
                ...recipe.procedureMaterialization,
                shortcut: frozenIcosphereShortcut,
              },
            }
          : recipe,
      ),
    }).toEqual(frozen);
  });

  it('changes only the version and Subdivide shortcut after InteractionCatalog 1.21.0', () => {
    const frozen = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.21.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;

    const next = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.22.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;

    expect({
      ...next,
      catalogVersion: frozen.catalogVersion,
      recipes: next.recipes.map((recipe) => {
        if (recipe.actionName !== 'blender.mesh.edit_subdivide') return recipe;
        const { procedureMaterialization: currentMaterialization, ...historicalRecipe } = recipe;
        if (currentMaterialization === undefined) {
          throw new Error('Expected active Subdivide materialization');
        }
        return historicalRecipe;
      }),
    }).toEqual(frozen);
  });

  it('changes only the catalog binding and Subdivision Surface recipe after 1.22.0', () => {
    const frozen = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.22.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.23.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.modifier.add_subdivision_surface',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.23.0 and changes only the binding and Bevel Edges recipe', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.23.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '6f875d895fc0ea7c8aab9c01c612e9eaf20f3958f7804231e061b2076696b8d5',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.24.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.mesh.edit_bevel_edges',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.24.0 and changes only the binding and Inset Faces recipe', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.24.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '769404cc6f8f7d80f248892320eb857b28ad37d4d7b2e246160a9f7ac116c2f7',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.25.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.mesh.edit_inset_faces',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.25.0 and changes only the binding and Poke Faces recipe', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.25.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'e24008348de4ac90585eb32a4aa5d484bd6cde2aa9cb1d0dbec3fae11d54af88',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.26.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.mesh.edit_poke_faces',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.26.0 and changes only the binding and Mirror recipe', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.26.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '8ea27f1162b32d9d542c8b417a26f14cfb9ed7b8c7fa624af65b143e16c481fc',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = structuredClone(blenderInteractionCatalog);
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.modifier.add_mirror',
    );
    expect(active).toEqual(frozen);
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
