import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  armatureLeafOperationIds,
  bevelModifierLeafOperationIds,
  editBevelLeafOperationIds,
  editExtrudeRegionLeafOperationIds,
  editInsetLeafOperationIds,
  editTriangulateLeafOperationIds,
  editPokeLeafOperationIds,
  lightTrailsLeafOperationIds,
  materialPaletteLeafOperationIds,
  mirrorLeafOperationIds,
  poseAnimationLeafOperationIds,
  singleMaterialLeafOperationIds,
  skinWeightsLeafOperationIds,
  solidifyLeafOperationIds,
  subdivisionSurfaceLeafOperationIds,
} from '@operatingline/protocol';

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
    expect(blenderInteractionCatalog.catalogVersion).toBe('1.69.0');
    const uvSphereMenu = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    )?.procedureMaterialization?.menu;
    if (
      uvSphereMenu?.availability !== 'available' ||
      uvSphereMenu.parameterBinding !== 'ordered_parameter_operations'
    ) {
      throw new Error('Expected UV Sphere ordered menu');
    }
    expect(uvSphereMenu.proofExecution).toMatchObject({
      executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      targetProfile: 'factory_layout_three_object_ui_scale_2',
      nativeUndoDepth: 8,
      proofArguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    });
    expect(uvSphereMenu.controlOperations.operations[2]).toMatchObject({
      id: 'control.object_name',
      target: { kind: 'control', hostId: 'PROPERTIES.object.name' },
      path: ['Properties', 'Object', 'Name'],
    });
    const availableMcpRecipes = blenderInteractionCatalog.recipes.filter(
      (recipe) =>
        recipe.procedureMaterialization?.mcp.availability === 'available' &&
        recipe.procedureMaterialization.mcp.source === 'catalog.action_level_mcp',
    );
    expect(availableMcpRecipes.map((recipe) => recipe.actionName)).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
      'blender.mesh.edit_subdivide',
      'blender.lookdev.create_light_trails_scene',
    ]);
    const uvSphereMcp = availableMcpRecipes[0]?.procedureMaterialization?.mcp;
    for (const recipe of availableMcpRecipes) {
      expect(recipe.procedureMaterialization?.mcp).toEqual(uvSphereMcp);
    }
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
      mcp: {
        availability: 'available',
        source: 'catalog.operation_level_mcp',
        semanticBinding: 'ordered_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        serverName: 'operating-line',
        toolName: 'operatingline.blender.modifier.subdivision-surface.execute-next',
        authorization: 'accepted_replay_next_step',
        resultBinding: 'companion_leaf_operation_progress',
        operations: expect.any(Array),
      },
    });
    expect(
      subdivisionSurface?.procedureMaterialization?.mcp.operations.map(
        (operation) => operation.sourceOperationId,
      ),
    ).toEqual(subdivisionSurfaceLeafOperationIds);
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
      mcp: { availability: 'available' },
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
      mcp: { availability: 'available' },
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
      mcp: {
        availability: 'available',
        source: 'catalog.action_level_mcp',
        toolName: 'operatingline.blender.action.execute',
      },
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
      mcp: { availability: 'available' },
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
        value: 'Exactly the factory Cube is active and selected',
      },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'modal_state', label: 'Modal UI', value: 'None' },
      { kind: 'scene_state', label: 'Object Identity', value: 'Cube' },
      {
        kind: 'scene_state',
        label: 'Initial Topology',
        value: '8 vertices, 12 edges, 6 polygons',
      },
      {
        kind: 'scene_state',
        label: 'Mesh Elements',
        value: 'All target mesh elements are visible',
      },
      { kind: 'scene_state', label: 'Mesh Data Users', value: '1' },
      { kind: 'scene_state', label: 'Scene Mesh Datablocks', value: '1' },
      { kind: 'scene_state', label: 'Modifiers', value: 'None' },
      { kind: 'scene_state', label: 'Shape Keys', value: 'None' },
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
        availability: 'available',
        toolName: 'operatingline.blender.action.execute',
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
        availability: 'available',
        toolName: 'operatingline.blender.action.execute',
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
        availability: 'available',
        source: 'catalog.action_level_mcp',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
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
        availability: 'available',
        source: 'catalog.action_level_mcp',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
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
        availability: 'available',
        source: 'catalog.action_level_mcp',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
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
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.27.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== 'blender.modifier.add_mirror',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.27.0 and changes only the ActionCatalog binding in 1.28.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.27.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '65c21d16fbe4daaee9a149117aecccfbfa5a0f8e3022378c1b77775296d88449',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.28.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.28.0 and changes only the ActionCatalog binding in 1.29.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.28.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '6129cdcc05316de93191327173d0317bb8dd9172aa033bfd38a55ad054448bb8',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.29.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.29.0 and changes only the ActionCatalog binding in 1.30.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.29.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '6463810d4ffaf0145e11748a642ae1190c6e16f55928ccf9ff556f3f0123b8ff',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.30.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.30.0 and changes only the ActionCatalog binding in 1.31.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.30.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'a8fcf2441ac6448db9d086155aee0d2c52c611b9100064e99e3b0caf37d73231',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.31.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.31.0 and changes only the ActionCatalog binding in 1.32.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.31.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'f1e8a04f577fdba050bb35ee7c3dc962b9d07208aab0c4e0b000bd6d7e50f624',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.32.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.32.0 before catalog-grounded semantic projections', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.32.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'ad65a899d677486dfff62645e1bb10749d8d1715f38419059f60b470bf6f78a0',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenUvSphere = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    );
    const activeUvSphere = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    );
    expect(frozenUvSphere?.procedureMaterialization?.semantic).toBeUndefined();
    expect(activeUvSphere?.procedureMaterialization?.semantic).toMatchObject({
      source: 'catalog.semantic_parameter_projections',
    });
  });

  it('freezes InteractionCatalog 1.33.0 before action-level MCP materialization', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.33.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'ca5a8ac2b7772408ae34f3767dc14aa6ea093dabb8c6062eef30af227d320980',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenUvSphere = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    );
    const activeUvSphere = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    );
    expect(frozenUvSphere?.procedureMaterialization?.mcp).toMatchObject({
      availability: 'unavailable',
    });
    expect(activeUvSphere?.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      toolName: 'operatingline.blender.action.execute',
      authorization: 'accepted_replay_next_step',
    });
  });

  it('freezes InteractionCatalog 1.34.0 before expanding action-level MCP materialization', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.34.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '38a01825bc709f4db0df18dcc822c02596bb6001d536092880b562ba27791796',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    expect(frozen.catalogVersion).toBe('1.34.0');
    expect(
      frozen.recipes
        .filter((recipe) => recipe.procedureMaterialization?.mcp.availability === 'available')
        .map((recipe) => recipe.actionName),
    ).toEqual(['blender.mesh.create_uv_sphere']);
    expect(
      blenderInteractionCatalog.recipes
        .filter(
          (recipe) =>
            recipe.procedureMaterialization?.mcp.availability === 'available' &&
            recipe.procedureMaterialization.mcp.source === 'catalog.action_level_mcp',
        )
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
      'blender.mesh.edit_subdivide',
      'blender.lookdev.create_light_trails_scene',
    ]);
  });

  it('freezes InteractionCatalog 1.35.0 and changes only Torus MCP materialization in 1.36.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.35.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '0b2a1216412bef2db3ce23baa56758f6ffa4e8023b1ec0dafbd65a935f0391f6',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.36.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    expect(frozen.catalogVersion).toBe('1.35.0');
    expect(
      frozen.recipes
        .filter((recipe) => recipe.procedureMaterialization?.mcp.availability === 'available')
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
    ]);
    const frozenTorusMcp = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_torus',
    )?.procedureMaterialization?.mcp;
    const activeTorus = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_torus',
    );
    if (activeTorus?.procedureMaterialization === undefined) {
      throw new Error('Expected active Torus procedure materialization');
    }
    expect(activeTorus.procedureMaterialization.mcp).toEqual(
      active.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere')
        ?.procedureMaterialization?.mcp,
    );
    active.catalogVersion = frozen.catalogVersion;
    activeTorus.procedureMaterialization.mcp = frozenTorusMcp!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.36.0 and changes only Cone MCP materialization in 1.37.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.36.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '24050fafa64d05b7339a2af3e4a0b5d6d90f6b76f3be8cf55dbc342653b4b763',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.37.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    expect(frozen.catalogVersion).toBe('1.36.0');
    expect(
      frozen.recipes
        .filter((recipe) => recipe.procedureMaterialization?.mcp.availability === 'available')
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_torus',
    ]);
    const frozenConeMcp = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_cone',
    )?.procedureMaterialization?.mcp;
    const activeCone = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_cone',
    );
    if (activeCone?.procedureMaterialization === undefined) {
      throw new Error('Expected active Cone procedure materialization');
    }
    expect(activeCone.procedureMaterialization.mcp).toEqual(
      active.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere')
        ?.procedureMaterialization?.mcp,
    );
    active.catalogVersion = frozen.catalogVersion;
    activeCone.procedureMaterialization.mcp = frozenConeMcp!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.37.0 and changes only Cylinder MCP materialization in 1.38.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.37.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '452b43732706b44795e99fbb029a810dd3c97ee666fc2e28c093f72c361340ab',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.40.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    expect(frozen.catalogVersion).toBe('1.37.0');
    expect(
      frozen.recipes
        .filter((recipe) => recipe.procedureMaterialization?.mcp.availability === 'available')
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_torus',
    ]);
    const frozenCylinderMcp = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_cylinder',
    )?.procedureMaterialization?.mcp;
    const activeCylinder = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_cylinder',
    );
    if (activeCylinder?.procedureMaterialization === undefined) {
      throw new Error('Expected active Cylinder procedure materialization');
    }
    expect(activeCylinder.procedureMaterialization.mcp).toEqual(
      active.recipes.find((recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere')
        ?.procedureMaterialization?.mcp,
    );
    active.catalogVersion = frozen.catalogVersion;
    activeCylinder.procedureMaterialization.mcp = frozenCylinderMcp!;
    const activeMirror = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    const frozenMirror = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    if (
      activeMirror?.procedureMaterialization === undefined ||
      frozenMirror?.procedureMaterialization === undefined
    ) {
      throw new Error('Expected Mirror procedure materialization');
    }
    activeMirror.procedureMaterialization.mcp = frozenMirror.procedureMaterialization.mcp;
    const activeSubdivisionShortcut = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    )?.procedureMaterialization?.shortcut;
    if (activeSubdivisionShortcut?.availability !== 'available') {
      throw new Error('Expected Subdivision Surface shortcut');
    }
    delete activeSubdivisionShortcut.proofExecution;
    const frozenSelection = activeSubdivisionShortcut.preconditions.find(
      (precondition) => precondition.kind === 'selection',
    );
    if (frozenSelection === undefined) throw new Error('Expected selection precondition');
    frozenSelection.value = 'Exactly one accepted target Mesh object is active and selected';
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.38.0 and adds only the Subdivision Surface shortcut proof declaration in 1.39.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.38.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '37517dadb822d18dd9fb9e5d86546f04499531e540d9200507de12e781bc703f',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.40.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenShortcut = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    )?.procedureMaterialization?.shortcut;
    const activeShortcut = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    )?.procedureMaterialization?.shortcut;
    if (
      activeShortcut?.availability !== 'available' ||
      frozenShortcut?.availability !== 'available'
    ) {
      throw new Error('Expected Subdivision Surface shortcut');
    }
    expect(frozenShortcut.proofExecution).toBeUndefined();
    expect(activeShortcut).toMatchObject({
      projection: 'candidate_only',
      proofExecution: {
        executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
        targetProfile: 'factory_cube_8_12_6',
        managedActionExecuted: false,
        managedReceiptCreated: false,
        osHidInput: false,
      },
    });
    active.catalogVersion = frozen.catalogVersion;
    const activeMirror = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    const frozenMirror = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    if (
      activeMirror?.procedureMaterialization === undefined ||
      frozenMirror?.procedureMaterialization === undefined
    ) {
      throw new Error('Expected Mirror procedure materialization');
    }
    activeMirror.procedureMaterialization.mcp = frozenMirror.procedureMaterialization.mcp;
    delete activeShortcut.proofExecution;
    const activeSelection = activeShortcut.preconditions.find(
      (precondition) => precondition.kind === 'selection',
    );
    if (activeSelection === undefined) throw new Error('Expected selection precondition');
    activeSelection.value = 'Exactly one accepted target Mesh object is active and selected';
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.39.0 and changes only Mirror MCP authorization in 1.40.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.39.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '52c40792822383da01e9763cbb06b59f4be4a7d6a1724d6a5d42c7107500cfb4',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.40.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenMirror = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    const activeMirror = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    if (
      frozenMirror?.procedureMaterialization === undefined ||
      activeMirror?.procedureMaterialization === undefined
    ) {
      throw new Error('Expected Mirror procedure materialization');
    }
    expect(frozenMirror.procedureMaterialization.mcp).toEqual({
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
    });
    expect(activeMirror.procedureMaterialization.mcp).toEqual({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'accepted_action_arguments',
      serverName: 'operating-line',
      toolName: 'operatingline.blender.action.execute',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_state_report',
    });
    active.catalogVersion = frozen.catalogVersion;
    activeMirror.procedureMaterialization.mcp = frozenMirror.procedureMaterialization.mcp;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.40.0 and adds only the exact UV Sphere menu proof in 1.41.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.40.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'a880342d7820f75af2de053b64d40ffd752dda09492273ef03510a8e77ac111d',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.41.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const activeMenu = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    )?.procedureMaterialization?.menu;
    const frozenMenu = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.create_uv_sphere',
    )?.procedureMaterialization?.menu;
    if (
      activeMenu?.availability !== 'available' ||
      activeMenu.parameterBinding !== 'ordered_parameter_operations' ||
      frozenMenu?.availability !== 'available' ||
      frozenMenu.parameterBinding !== 'ordered_parameter_operations'
    ) {
      throw new Error('Expected UV Sphere ordered menu materialization');
    }
    expect(frozenMenu.proofExecution).toBeUndefined();
    expect(activeMenu.proofExecution).toMatchObject({
      executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      nativeUndoDepth: 8,
    });
    active.catalogVersion = frozen.catalogVersion;
    const activeSolidify = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_solidify',
    );
    if (activeSolidify === undefined) throw new Error('Expected Solidify recipe');
    delete activeSolidify.procedureMaterialization;
    delete activeMenu.proofExecution;
    const activeName = activeMenu.controlOperations.operations[2]!;
    const frozenName = frozenMenu.controlOperations.operations[2]!;
    activeName.target = structuredClone(frozenName.target);
    activeName.path = [...frozenName.path];
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.41.0 and adds only Solidify action-level MCP in 1.42.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.41.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'c7fc9b7db6c9391a6d82e62cd569e36986af21d0ddf5583249e6644421ef356f',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.42.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenSolidify = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_solidify',
    );
    const activeSolidify = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_solidify',
    );
    expect(frozenSolidify?.procedureMaterialization).toBeUndefined();
    expect(activeSolidify?.procedureMaterialization).toEqual({
      menu: {
        availability: 'unavailable',
        reason: expect.stringContaining('managed modifier identity'),
      },
      shortcut: {
        availability: 'unavailable',
        reason: expect.stringContaining('accepted Solidify parameters'),
      },
      mcp: {
        availability: 'available',
        source: 'catalog.action_level_mcp',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'accepted_action_arguments',
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
        resultBinding: 'companion_state_report',
      },
    });
    active.catalogVersion = frozen.catalogVersion;
    delete activeSolidify!.procedureMaterialization;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.42.0 and promotes only the nine managed actions in 1.43.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.42.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7cc79687c9b8e4de7c62461471b0fbed3fe11b1ec609b2278f4a8c28cb52c1de',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.43.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '9dbf1a507b6bb2dc3f5b13fbc7fbe53acf3fdd8756908d5de6d2643f40964a72',
    );
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const promotedActions = [
      'blender.mesh.edit_subdivide',
      'blender.mesh.edit_triangulate',
      'blender.mesh.edit_extrude_region',
      'blender.mesh.edit_bevel_edges',
      'blender.mesh.edit_inset_faces',
      'blender.mesh.edit_poke_faces',
      'blender.rig.create_armature',
      'blender.rig.bind_skin_weights',
      'blender.animation.create_pose_keyframes',
    ] as const;

    expect(frozen.catalogVersion).toBe('1.42.0');
    for (const actionName of promotedActions) {
      const frozenRecipe = frozen.recipes.find((recipe) => recipe.actionName === actionName);
      const activeRecipe = active.recipes.find((recipe) => recipe.actionName === actionName);
      if (frozenRecipe === undefined || activeRecipe === undefined) {
        throw new Error(`Expected promoted recipe ${actionName}`);
      }
      expect(activeRecipe.procedureMaterialization?.mcp).toEqual({
        availability: 'available',
        source: 'catalog.action_level_mcp',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'accepted_action_arguments',
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
        resultBinding: 'companion_state_report',
      });

      if (frozenRecipe.procedureMaterialization === undefined) {
        delete activeRecipe.procedureMaterialization;
      } else {
        activeRecipe.procedureMaterialization!.mcp = structuredClone(
          frozenRecipe.procedureMaterialization.mcp,
        );
      }
    }

    active.catalogVersion = frozen.catalogVersion;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.43.0 and adds only the exact Edit Subdivide shortcut proof in 1.44.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.43.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '9dbf1a507b6bb2dc3f5b13fbc7fbe53acf3fdd8756908d5de6d2643f40964a72',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.44.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenShortcut = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
    )?.procedureMaterialization?.shortcut;
    const activeShortcut = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
    )?.procedureMaterialization?.shortcut;
    if (
      frozenShortcut?.availability !== 'available' ||
      activeShortcut?.availability !== 'available'
    ) {
      throw new Error('Expected Edit Subdivide shortcut materialization');
    }

    expect(frozenShortcut.proofExecution).toBeUndefined();
    expect(activeShortcut.proofExecution).toEqual({
      executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
      targetProfile: 'factory_cube_single_user_mesh_8_12_6',
      executionBoundary: 'blender_window_event_simulate',
      osHidInput: false,
      managedActionExecuted: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      authorization: 'accepted_replay_next_step',
      transport: 'event_simulate',
      hostVersions: ['4.5.3', '5.1.1'],
      operationIds: [
        'shortcut.enter_edit_mode',
        'shortcut.select_all_mesh_elements',
        'shortcut.search_subdivide',
        'shortcut.execute_subdivide',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_number_of_cuts',
        'shortcut.set_smoothness',
        'shortcut.close_adjust_last_operation',
        'shortcut.return_to_object_mode',
      ],
      strongObservationKind: 'mesh_edit_subdivide_shortcut_ready',
      nativeUndoCheckpointRequired: true,
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
    });
    expect(activeShortcut.preconditions).toEqual([
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      {
        kind: 'selection',
        label: 'Active Target',
        value: 'Exactly the factory Cube is active and selected',
      },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'modal_state', label: 'Modal UI', value: 'None' },
      { kind: 'scene_state', label: 'Object Identity', value: 'Cube' },
      {
        kind: 'scene_state',
        label: 'Initial Topology',
        value: '8 vertices, 12 edges, 6 polygons',
      },
      {
        kind: 'scene_state',
        label: 'Mesh Elements',
        value: 'All target mesh elements are visible',
      },
      { kind: 'scene_state', label: 'Mesh Data Users', value: '1' },
      { kind: 'scene_state', label: 'Scene Mesh Datablocks', value: '1' },
      { kind: 'scene_state', label: 'Modifiers', value: 'None' },
      { kind: 'scene_state', label: 'Shape Keys', value: 'None' },
      { kind: 'scene_state', label: 'UI Language', value: 'English' },
    ]);

    active.catalogVersion = frozen.catalogVersion;
    delete activeShortcut.proofExecution;
    activeShortcut.preconditions.splice(
      0,
      activeShortcut.preconditions.length,
      ...structuredClone(frozenShortcut.preconditions),
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.44.0 and adds only the light trails recipe in 1.45.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.44.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'fee9f3d2ec26f97c368f9fdb4df13f51fbe88855c759797f847fb5609831079f',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.45.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const lightTrails = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    if (lightTrails === undefined) throw new Error('Expected light trails interaction recipe');

    expect(lightTrails.guidance).toMatchObject({
      kind: 'semantic_path',
      steps: [
        { order: 1, intent: 'navigate' },
        { order: 2, intent: 'execute' },
        { order: 3, intent: 'configure' },
        { order: 4, intent: 'verify' },
      ],
    });
    expect(lightTrails.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: {
        availability: 'available',
        source: 'catalog.action_level_mcp',
        parameterBinding: 'accepted_action_arguments',
      },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter(
      (recipe) => recipe.actionName !== lightTrails.actionName,
    );
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.45.0 and adds only the light-trails look-development recipe in 1.46.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.45.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '921e66d86da823a2b18c8787baec5dd0948dec8f4969de55185987675f2876ea',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.46.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const lookdev = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.lookdev.create_light_trails_scene',
    );
    if (lookdev === undefined) throw new Error('Expected light-trails look-development recipe');

    expect(lookdev.guidance).toMatchObject({
      kind: 'semantic_path',
      steps: [
        { order: 1, intent: 'navigate' },
        { order: 2, intent: 'configure' },
        { order: 3, intent: 'configure' },
        { order: 4, intent: 'configure' },
        { order: 5, intent: 'configure' },
        { order: 6, intent: 'configure' },
        { order: 7, intent: 'verify' },
      ],
    });
    expect(lookdev.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: {
        availability: 'available',
        source: 'catalog.action_level_mcp',
        parameterBinding: 'accepted_action_arguments',
      },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes = active.recipes.filter((recipe) => recipe.actionName !== lookdev.actionName);
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.46.0 and only expands Transform Geometry guidance in 1.47.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.46.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '02623483bbdb0d68cfbd4cf3d47f95fbcada5a8175c9a4f32ca98cb7a923b98a',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.47.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const transformIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_transform',
    );
    if (transformIndex < 0) throw new Error('Expected Transform Geometry recipe');
    const transform = active.recipes[transformIndex]!;

    expect(transform.guidance).toMatchObject({
      kind: 'semantic_path',
      steps: [
        {
          id: 'semantic.preflight_transform_geometry_resources',
          order: 1,
          label: 'Validate Transform Geometry Preconditions',
          intent: 'verify',
          target: {
            kind: 'semantic',
            hostId: 'operatingline.blender.transform_geometry_resource_preflight',
          },
        },
        { id: 'semantic.new_geometry_modifier', order: 2, intent: 'execute' },
        { id: 'node.group_input', order: 3, intent: 'execute' },
        { id: 'node.transform_geometry', order: 4, intent: 'execute' },
        { id: 'node.group_output', order: 5, intent: 'execute' },
        {
          id: 'semantic.connect_group_input_geometry_to_transform',
          order: 6,
          intent: 'execute',
          target: {
            connection: {
              fromNode: 'NodeGroupInput',
              fromSocket: 'Geometry',
              toNode: 'GeometryNodeTransform',
              toSocket: 'Geometry',
            },
          },
        },
        {
          id: 'semantic.connect_transform_geometry_to_group_output',
          order: 7,
          intent: 'execute',
          target: {
            connection: {
              fromNode: 'GeometryNodeTransform',
              fromSocket: 'Geometry',
              toNode: 'NodeGroupOutput',
              toSocket: 'Geometry',
            },
          },
        },
        { id: 'semantic.verify_node_links', order: 8, intent: 'verify' },
      ],
    });
    expect(transform.procedureMaterialization).toMatchObject({
      semantic: {
        source: 'catalog.semantic_parameter_projections',
        projections: [
          {
            semanticAction: 'node.transform_geometry',
            actionArgument: 'translation',
            transform: 'identity',
          },
          {
            semanticAction: 'node.transform_geometry',
            actionArgument: 'rotation',
            transform: 'identity',
          },
          {
            semanticAction: 'node.transform_geometry',
            actionArgument: 'scale',
            transform: 'identity',
          },
        ],
        omittedActionArguments: [
          { argumentName: 'targetId' },
          { argumentName: 'modifierId' },
          { argumentName: 'modifierName' },
          { argumentName: 'nodeGroupId' },
          { argumentName: 'nodeGroupName' },
        ],
      },
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: { availability: 'unavailable' },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[transformIndex] = frozen.recipes[transformIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.47.0 and only enables Subdivision Surface action-level MCP in 1.48.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.47.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '9a2c9ff9e641f07bf4e44572e92f4a4783062872868e90bc434e27f9b44a65d2',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/interaction-catalog-1.48.0.json'), 'utf8'),
    ) as typeof blenderInteractionCatalog;
    const frozenSubdivision = frozen.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    );
    const activeSubdivision = active.recipes.find(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    );
    if (
      frozenSubdivision?.procedureMaterialization === undefined ||
      activeSubdivision?.procedureMaterialization === undefined
    ) {
      throw new Error('Expected Subdivision Surface procedure materialization');
    }

    expect(frozenSubdivision.procedureMaterialization.mcp).toEqual({
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
    });
    expect(activeSubdivision.procedureMaterialization.mcp).toEqual({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'accepted_action_arguments',
      serverName: 'operating-line',
      toolName: 'operatingline.blender.action.execute',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_state_report',
    });

    active.catalogVersion = frozen.catalogVersion;
    activeSubdivision.procedureMaterialization.mcp = frozenSubdivision.procedureMaterialization.mcp;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.48.0 and only enables exact Transform Geometry operation-level MCP in 1.49.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.48.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '2503b21804352dda57f71ca144288276eca21ff2c6925b4b930b0292234e3b61',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.49.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      'a306bc09ece08e06368f234265577f445e07b37179ac41d1a66e9440571d1fca',
    );
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const transformIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_transform',
    );
    if (transformIndex < 0) throw new Error('Expected Transform Geometry recipe');
    const transform = active.recipes[transformIndex]!;
    const mcp = transform.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected operation-level Transform Geometry MCP materialization');
    }

    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual([
      'semantic.preflight_transform_geometry_resources',
      'semantic.new_geometry_modifier',
      'node.group_input',
      'node.transform_geometry',
      'projection.semantic.transform_geometry.translation',
      'projection.semantic.transform_geometry.rotation',
      'projection.semantic.transform_geometry.scale',
      'node.group_output',
      'semantic.connect_group_input_geometry_to_transform',
      'semantic.connect_transform_geometry_to_group_output',
      'semantic.verify_node_links',
    ]);
    expect(mcp.operations.flatMap((operation) => operation.parameters)).toHaveLength(8);
    expect(mcp.toolName).toBe('operatingline.blender.geometry-nodes.transform.execute-next');
    expect(transform.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[transformIndex] = frozen.recipes[transformIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.49.0 and adds only the Subdivide menu candidate in 1.50.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.49.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'a306bc09ece08e06368f234265577f445e07b37179ac41d1a66e9440571d1fca',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.50.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '2b2fa8821ce7cdf20c5e7f67dfc488818ca4c29558998fe9a1bd5df9fdc01f03',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
    );
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_subdivide',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Subdivide recipe');

    expect(frozen.recipes[frozenIndex]?.procedureMaterialization?.menuCandidate).toBeUndefined();
    expect(active.recipes[activeIndex]?.procedureMaterialization?.menuCandidate).toMatchObject({
      projection: 'candidate_only',
      equivalence: 'not_equivalent_to_managed_action',
      executionAuthority: 'none',
      nativeEvidence: {
        kind: 'bounded_blender_ui_probe',
        executorId: 'blender.mesh_edit_subdivide_candidate_menu_f9.event_simulate.v1',
        hostVersions: ['4.5.3', '5.1.1'],
        managedActionExecuted: false,
        managedReceiptCreated: false,
        managedReplacementMeshCreated: false,
        nativeMutationKind: 'in_place_edit_mesh_subdivide',
        nativeUndoCheckpointRequired: true,
        nativeUndoDepth: 4,
        nativeRedoDepth: 4,
      },
      operations: expect.arrayContaining([
        expect.objectContaining({ id: 'candidate.set_number_of_cuts' }),
        expect.objectContaining({ id: 'candidate.set_smoothness' }),
      ]),
    });
    expect(active.description).toBe(
      'Version-tested host interaction recipes, non-executable menu candidates, and explicit semantic fallbacks for every Blender ActionCatalog 1.24.0 action.',
    );

    active.catalogVersion = frozen.catalogVersion;
    active.description = frozen.description;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.50.0 and expands only named-node Light Trails guidance in 1.51.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.50.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '2b2fa8821ce7cdf20c5e7f67dfc488818ca4c29558998fe9a1bd5df9fdc01f03',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.51.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '1085553ae473a5c4287b2cf0bdb86bda113db794bdb13e5894898aab8f36c547',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Light Trails recipe');

    const lightTrails = active.recipes[activeIndex]!;
    expect(lightTrails.guidance.steps).toHaveLength(23);
    expect(
      lightTrails.guidance.steps
        .filter((step) => step.target.kind === 'node')
        .map((step) => step.target.hostId),
    ).toHaveLength(20);
    expect(
      lightTrails.guidance.steps
        .filter((step) => step.target.kind === 'node')
        .every((step) => step.target.hostId.startsWith('node-name:OperatingLine ')),
    ).toBe(true);
    expect(lightTrails.procedureMaterialization?.semantic?.projections).toHaveLength(12);
    expect(lightTrails.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: { availability: 'available', source: 'catalog.action_level_mcp' },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.51.0 and expands only pose values in 1.52.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.51.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '1085553ae473a5c4287b2cf0bdb86bda113db794bdb13e5894898aab8f36c547',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.52.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '132225dd95006d790a6725fe54710a3b8ac435077a4a3838e67358889b67594c',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected pose recipe');

    const pose = active.recipes[activeIndex]!;
    expect(pose.guidance.steps).toHaveLength(8);
    expect(pose.procedureMaterialization?.semantic?.projections).toEqual([
      expect.objectContaining({
        semanticAction: 'semantic.create_pose_action',
        actionArgument: 'actionName',
        transform: 'identity',
      }),
      expect.objectContaining({
        semanticAction: 'operator.insert_keyframe',
        actionArgument: 'keyframes',
        transform: 'json_identity',
      }),
      expect.objectContaining({
        semanticAction: 'control.pose_interpolation',
        actionArgument: 'interpolation',
        transform: 'identity',
      }),
      expect.objectContaining({
        semanticAction: 'control.pose_extrapolation',
        actionArgument: 'extrapolation',
        transform: 'identity',
      }),
    ]);
    expect(pose.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: { availability: 'available', source: 'catalog.action_level_mcp' },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.52.0 and adds the complete Light Trails link/control rail in 1.53.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.52.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '132225dd95006d790a6725fe54710a3b8ac435077a4a3838e67358889b67594c',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.53.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '6e94b150caf3c71bcd6033445ca7ae6e74378ef60e05bd9e83c608474814a342',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Light Trails recipe');

    const lightTrails = active.recipes[activeIndex]!;
    expect(lightTrails.guidance.steps).toHaveLength(42);
    expect(
      lightTrails.guidance.steps.filter((step) => step.target.connection !== undefined),
    ).toHaveLength(19);
    expect(lightTrails.procedureMaterialization?.semantic?.projections).toHaveLength(12);
    expect(lightTrails.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      shortcut: { availability: 'unavailable' },
      mcp: { availability: 'available', source: 'catalog.action_level_mcp' },
    });

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.53.0 and binds axis-angle pose guidance in 1.54.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.53.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '6e94b150caf3c71bcd6033445ca7ae6e74378ef60e05bd9e83c608474814a342',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.54.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '85e0ffab9c4ed2cd5aed31926cfa19ac7dc65b1119960b85572f04571b890261',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected pose recipe');

    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.54.0 and binds Light Trails to the exact 54-step MCP rail in 1.55.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.54.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '85e0ffab9c4ed2cd5aed31926cfa19ac7dc65b1119960b85572f04571b890261',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.55.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '90257a71462f58dd6bac5d6b898d7cb553f8fac8c682d8f39797a9a883d5879c',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_light_trails',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Light Trails recipe');

    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Light Trails operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      lightTrailsLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      lightTrailsLeafOperationIds.map((_, index) => {
        const parameters: Record<number, string[]> = {
          0: ['targetId', 'modifierId', 'modifierName', 'nodeGroupId', 'nodeGroupName'],
          4: ['tileLength'],
          6: ['pointsPerTrail'],
          8: ['trailCount'],
          9: ['trailSpacing'],
          14: ['noiseScale'],
          15: ['noiseDetail'],
          16: ['noiseRoughness'],
          17: ['noiseSeed'],
          20: ['height'],
          26: ['profileSides'],
          27: ['profileRadius'],
          30: ['tileRepeatCount'],
        };
        return parameters[index] ?? [];
      }),
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.55.0 and binds Pose Animation to the exact 12-step MCP rail in 1.56.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.55.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '90257a71462f58dd6bac5d6b898d7cb553f8fac8c682d8f39797a9a883d5879c',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.56.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '6cddec2ab02e0ba37a584fcc1e428f967ab0f3c7ce60e57bab1c63154356140a',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.animation.create_pose_keyframes',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Pose Animation recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Pose Animation operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.animation.pose-keyframes.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      poseAnimationLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      poseAnimationLeafOperationIds.map((_, index) => {
        const parameters: Record<number, string[]> = {
          0: ['actionId', 'armatureId'],
          4: ['actionName'],
          6: ['keyframes'],
          8: ['interpolation'],
          10: ['extrapolation'],
        };
        return parameters[index] ?? [];
      }),
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.56.0 and binds Armature to the exact nine-step MCP rail in 1.57.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.56.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '6cddec2ab02e0ba37a584fcc1e428f967ab0f3c7ce60e57bab1c63154356140a',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.57.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      'fa5eb0e2998c5a6d319ad263d47438500a052f0818681297c9cfb1e9ccd4ace2',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.rig.create_armature',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.rig.create_armature',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Armature recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Armature operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.rig.armature.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      armatureLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [
        ['armatureId', 'collectionId'],
        [],
        ['objectName'],
        ['dataName'],
        [],
        ['bones'],
        [],
        ['bindings'],
        [],
      ],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.57.0 and binds Skin Weights to the exact nine-step MCP rail in 1.58.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.57.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'fa5eb0e2998c5a6d319ad263d47438500a052f0818681297c9cfb1e9ccd4ace2',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.58.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '7540e60b068d93c4a29c6d9457dc742b1584cbbd4fd887c4822750a48ff57bc0',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.rig.bind_skin_weights',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.rig.bind_skin_weights',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Skin Weights recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Skin Weights operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.rig.skin-weights.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      skinWeightsLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [
        ['targetId', 'armatureId', 'modifierId'],
        [],
        [],
        [],
        ['weights'],
        [],
        ['preserveVolume'],
        ['modifierName'],
        [],
      ],
    );
    expect(active.recipes[activeIndex]!.guidance.steps.at(-1)).toMatchObject({
      id: 'semantic.verify_skin_weights',
      order: 6,
      intent: 'verify',
    });

    active.catalogVersion = frozen.catalogVersion;
    active.actionCatalogVersion = frozen.actionCatalogVersion;
    active.description = frozen.description;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.58.0 and binds Solidify to the exact four-step MCP rail in 1.59.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.58.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7540e60b068d93c4a29c6d9457dc742b1584cbbd4fd887c4822750a48ff57bc0',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.59.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '27a047e645650e6e08c03a54f2ae90aa9a3a9ca5fcf6e7db76b28510932839fe',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_solidify',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_solidify',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Solidify recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Solidify operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.modifier.solidify.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      solidifyLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'modifierId'], [], [], ['modifierName', 'thickness', 'offset']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.59.0 and binds Mirror to the exact seven-step MCP rail in 1.60.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.59.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '27a047e645650e6e08c03a54f2ae90aa9a3a9ca5fcf6e7db76b28510932839fe',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.60.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '41cc0159fa1452f5c0726f7a8dfc75d3c8ed0a5de3ff270110cc509632948f05',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_mirror',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Mirror recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Mirror operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.modifier.mirror.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      mirrorLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'modifierId'], [], [], [], [], [], ['modifierName', 'axis']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.60.0 and binds Subdivision Surface to the exact four-step MCP rail in 1.61.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.60.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '41cc0159fa1452f5c0726f7a8dfc75d3c8ed0a5de3ff270110cc509632948f05',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.61.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '4798ecc7d1943e23d1daa514d2ad952d3e64bdca034e80b0367fc98b439b7e89',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_subdivision_surface',
    );
    if (activeIndex < 0 || frozenIndex < 0) {
      throw new Error('Expected Subdivision Surface recipe');
    }

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Subdivision Surface operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.modifier.subdivision-surface.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      subdivisionSurfaceLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'modifierId'], [], [], ['modifierName', 'viewportLevel']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.61.0 and binds Edit Bevel to the exact six-step MCP rail in 1.62.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.61.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '4798ecc7d1943e23d1daa514d2ad952d3e64bdca034e80b0367fc98b439b7e89',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.62.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      'd2b9cc77ac455c07aafc03855c24e19e9c346bbc81cff27ff44cade9162d4318',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_bevel_edges',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_bevel_edges',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Edit Bevel recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Edit Bevel operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.mesh.edit-bevel-edges.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editBevelLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [
        ['targetId', 'resultMeshId'],
        [],
        [],
        [],
        ['width', 'segments', 'profile'],
        ['resultMeshName'],
      ],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.62.0 and binds Edit Inset to the exact six-step MCP rail in 1.63.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.62.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'd2b9cc77ac455c07aafc03855c24e19e9c346bbc81cff27ff44cade9162d4318',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.63.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '2b134289684480886c8c2ea1c46075895540f06611768f122a91c250cd5e2b3e',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_inset_faces',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_inset_faces',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Edit Inset recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Edit Inset operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.mesh.edit-inset-faces.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editInsetLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'resultMeshId'], [], [], [], ['thickness', 'depth'], ['resultMeshName']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.63.0 and binds Edit Poke to the exact six-step MCP rail in 1.64.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.63.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '2b134289684480886c8c2ea1c46075895540f06611768f122a91c250cd5e2b3e',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.64.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '3876ef634380c67831cc841bb0f89e5ef9be0ab1f6e135b69f53770ccf72996b',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_poke_faces',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_poke_faces',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Edit Poke recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Edit Poke operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.mesh.edit-poke-faces.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editPokeLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'resultMeshId'], [], [], [], ['offset'], ['resultMeshName']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.64.0 and binds Edit Triangulate to the exact six-step MCP rail in 1.65.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.64.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '3876ef634380c67831cc841bb0f89e5ef9be0ab1f6e135b69f53770ccf72996b',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.65.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      'cc94229cf1b1fe62ae024de6f9e08bcb2ff48077c309da38391772979c2803cb',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_triangulate',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_triangulate',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Edit Triangulate recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Edit Triangulate operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.mesh.edit-triangulate.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editTriangulateLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'resultMeshId'], [], [], [], [], ['resultMeshName']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.65.0 and binds Extrude Region to the exact six-step MCP rail in 1.66.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.65.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'cc94229cf1b1fe62ae024de6f9e08bcb2ff48077c309da38391772979c2803cb',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.66.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '40cf1b6e1818afe9517b33b6184b21f059dd61260e93d0fbe30f46859debaa18',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_extrude_region',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.mesh.edit_extrude_region',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Extrude Region recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.action_level_mcp',
      toolName: 'operatingline.blender.action.execute',
    });
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Extrude Region operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.mesh.edit-extrude-region.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editExtrudeRegionLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [
        ['targetId', 'resultMeshId'],
        [],
        [],
        ['polygonIndices'],
        ['translation'],
        ['resultMeshName'],
      ],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.66.0 and binds Bevel Modifier to the exact four-step MCP rail in 1.67.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.66.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '40cf1b6e1818afe9517b33b6184b21f059dd61260e93d0fbe30f46859debaa18',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.67.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      'a52420815a7ff61e442674301542326bc9e7c41d3b6dc1f0481db8ca4e7b4024',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_bevel',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.modifier.add_bevel',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Bevel Modifier recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toBeUndefined();
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Bevel Modifier operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.modifier.bevel.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      bevelModifierLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['targetId', 'modifierId'], [], [], ['modifierName', 'width', 'segments', 'angleLimit']],
    );

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.67.0 and binds Single Material to the exact four-step MCP rail in 1.68.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.67.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'a52420815a7ff61e442674301542326bc9e7c41d3b6dc1f0481db8ca4e7b4024',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.68.0.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '688b8a3e0fd6942b3372559a61a99ce037fa9e73acc1e8c2af0fdd0733ee3313',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.material.create_and_assign',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.material.create_and_assign',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Single Material recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toBeUndefined();
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Single Material operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.material.single.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      singleMaterialLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [['materialId'], [], [], ['materialName', 'baseColor', 'roughness', 'metallic', 'targets']],
    );
    expect(mcp.operations[3]!.parameters.map((parameter) => parameter.source.transform)).toEqual([
      'identity',
      'json_identity',
      'identity',
      'identity',
      'json_identity',
    ]);

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
    expect(active).toEqual(frozen);
  });

  it('freezes InteractionCatalog 1.68.0 and binds Material Palette to the exact four-step MCP rail in 1.69.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.68.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '688b8a3e0fd6942b3372559a61a99ce037fa9e73acc1e8c2af0fdd0733ee3313',
    );
    const activeBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog.json'),
    );
    expect(createHash('sha256').update(activeBytes).digest('hex')).toBe(
      '7a61ec921f1a61c884f515e3bba5e164a6e9d8686226031fd373f928574d4107',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const active = JSON.parse(activeBytes.toString('utf8')) as typeof blenderInteractionCatalog;
    const frozenIndex = frozen.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.material.create_palette_and_assign',
    );
    const activeIndex = active.recipes.findIndex(
      (recipe) => recipe.actionName === 'blender.material.create_palette_and_assign',
    );
    if (activeIndex < 0 || frozenIndex < 0) throw new Error('Expected Material Palette recipe');

    expect(frozen.recipes[frozenIndex]!.procedureMaterialization?.mcp).toBeUndefined();
    const mcp = active.recipes[activeIndex]!.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Material Palette operation-level MCP');
    }
    expect(mcp).toMatchObject({
      semanticBinding: 'ordered_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      toolName: 'operatingline.blender.material.palette.execute-next',
      authorization: 'accepted_replay_next_step',
      resultBinding: 'companion_leaf_operation_progress',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      materialPaletteLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.parameters.map(({ name }) => name))).toEqual(
      [[], [], ['materials'], []],
    );
    expect(mcp.operations[2]!.parameters.map((parameter) => parameter.source.transform)).toEqual([
      'json_identity',
    ]);

    active.catalogVersion = frozen.catalogVersion;
    active.recipes[activeIndex] = frozen.recipes[frozenIndex]!;
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
