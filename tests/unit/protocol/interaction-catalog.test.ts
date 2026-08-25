import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  actionLevelMcpActionNames,
  actionLevelMcpRecipeIdByAction,
  armatureLeafOperationIds,
  editBevelLeafOperationIds,
  editExtrudeRegionLeafOperationIds,
  editTriangulateLeafOperationIds,
  editPokeLeafOperationIds,
  interactionCatalogSchema,
  materialPaletteLeafOperationIds,
  mirrorLeafOperationIds,
  poseAnimationLeafOperationIds,
  singleMaterialLeafOperationIds,
  solidifyLeafOperationIds,
  subdivisionSurfaceLeafOperationIds,
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

function mutableOrderedMenu(catalog: InteractionCatalog) {
  const menu = orderedMenu(catalog);
  delete menu.proofExecution;
  return menu;
}

function recipeFor(catalog: InteractionCatalog, actionName: string) {
  const recipe = catalog.recipes.find((candidate) => candidate.actionName === actionName);
  if (recipe === undefined) throw new Error(`Expected recipe for ${actionName}`);
  return recipe;
}

function installOrderedShortcut(catalog: InteractionCatalog) {
  const materialization = catalog.recipes[0]!.procedureMaterialization;
  if (materialization === undefined) throw new Error('Expected procedure materialization fixture');
  materialization.shortcut = {
    availability: 'available',
    source: 'catalog.ordered_shortcut_operations',
    semanticBinding: 'all_leaf_operations',
    parameterBinding: 'ordered_parameter_operations',
    projection: 'candidate_only',
    preconditions: [
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'scene_state', label: 'Cursor', value: 'World Origin' },
    ],
    operations: [
      {
        id: 'shortcut.add_sphere',
        label: 'Add UV Sphere',
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'UV Sphere'],
        parameters: [
          {
            name: 'radius',
            source: { kind: 'action_argument', argumentName: 'radius', transform: 'identity' },
          },
        ],
      },
      ...(['x', 'y', 'z'] as const).map((component) => ({
        id: `shortcut.move_${component}`,
        label: `Move ${component.toUpperCase()}`,
        keyMode: 'sequence' as const,
        keys: ['G', component.toUpperCase()],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument' as const,
              argumentName: 'location',
              transform: `vector3_${component}` as const,
            },
          },
        ],
      })),
      {
        id: 'shortcut.rename',
        label: 'Rename Object',
        keyMode: 'sequence',
        keys: ['F2'],
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
    omittedActionArguments: [
      {
        argumentName: 'resourceId',
        reason: 'The logical identifier is not entered through a Blender shortcut.',
      },
    ],
  };
  return materialization.shortcut;
}

function installConeSegmentFrame(catalog: InteractionCatalog) {
  const recipe = recipeFor(catalog, 'blender.mesh.create_cone');
  recipe.procedureMaterialization = {
    menu: {
      availability: 'available',
      source: 'guidance.native_path',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      operatorParameters: [
        {
          name: 'radius1',
          source: {
            kind: 'action_argument',
            argumentName: 'radiusStart',
            transform: 'identity',
          },
        },
        {
          name: 'radius2',
          source: {
            kind: 'action_argument',
            argumentName: 'radiusEnd',
            transform: 'identity',
          },
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
      ],
      controlOperations: {
        insertAfterStepId: 'operator.cone',
        operations: [
          {
            id: 'control.location',
            label: 'Location',
            target: { kind: 'control', hostId: 'VIEW3D_PT_item.transform.location' },
            path: ['Sidebar', 'Item', 'Transform', 'Location'],
            parameters: [
              {
                name: 'value',
                source: {
                  kind: 'derived_action_arguments',
                  derivation: 'segment_frame',
                  startArgumentName: 'start',
                  endArgumentName: 'end',
                  output: 'midpoint',
                },
              },
            ],
          },
          {
            id: 'control.rotation',
            label: 'Rotation',
            target: { kind: 'control', hostId: 'VIEW3D_PT_item.transform.rotation_euler' },
            path: ['Sidebar', 'Item', 'Transform', 'Rotation'],
            parameters: [
              {
                name: 'value',
                source: {
                  kind: 'derived_action_arguments',
                  derivation: 'segment_frame',
                  startArgumentName: 'start',
                  endArgumentName: 'end',
                  output: 'rotation_euler_xyz_align_z',
                },
              },
            ],
          },
          {
            id: 'control.object_name',
            label: 'Object Name',
            target: { kind: 'control', hostId: 'OBJECT_PT_transform.name' },
            path: ['Sidebar', 'Item', 'Object Name'],
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
          reason: 'The logical identifier is not entered through Blender controls.',
        },
      ],
    },
    shortcut: {
      availability: 'unavailable',
      reason: 'The segment frame requires ordered numeric parameter operations.',
    },
    mcp: {
      availability: 'unavailable',
      reason: 'MCP projection is not defined by this interaction catalog.',
    },
  };

  return recipe.procedureMaterialization.menu;
}

describe('interaction catalog protocol', () => {
  it('permits action-level MCP only for the exact approved Blender action and recipe pairs', () => {
    for (const actionName of actionLevelMcpActionNames) {
      const catalog = structuredClone(blenderInteractionCatalog);
      catalog.recipes = [structuredClone(recipeFor(blenderInteractionCatalog, actionName))];
      if (
        catalog.recipes[0]!.procedureMaterialization?.mcp.availability !== 'available' ||
        catalog.recipes[0]!.procedureMaterialization.mcp.source !== 'catalog.action_level_mcp'
      ) {
        continue;
      }
      const menu = catalog.recipes[0]!.procedureMaterialization?.menu;
      if (menu?.availability === 'available') delete menu.proofExecution;
      const shortcut = catalog.recipes[0]!.procedureMaterialization?.shortcut;
      if (shortcut?.availability === 'available') delete shortcut.proofExecution;
      expect(() => validateInteractionCatalog(catalog)).not.toThrow();
      const wrongRecipe = structuredClone(catalog);
      wrongRecipe.recipes[0]!.id = actionLevelMcpRecipeIdByAction[actionName].endsWith('.native')
        ? `${actionName}.semantic`
        : `${actionName}.native`;
      expect(() => validateInteractionCatalog(wrongRecipe)).toThrow(
        'action-level MCP is restricted to exact approved Blender recipes',
      );
    }

    const unsupported = structuredClone(blenderInteractionCatalog);
    unsupported.recipes = [
      structuredClone(recipeFor(blenderInteractionCatalog, 'blender.mesh.create_uv_sphere')),
    ];
    const unsupportedMenu = unsupported.recipes[0]!.procedureMaterialization?.menu;
    if (unsupportedMenu?.availability === 'available') delete unsupportedMenu.proofExecution;
    unsupported.recipes[0]!.actionName = 'blender.geometry_nodes.create_transform';
    expect(() => validateInteractionCatalog(unsupported)).toThrow(
      'action-level MCP is restricted to exact approved Blender recipes',
    );
  });

  it('covers every Blender action with a native path or explicit semantic fallback', () => {
    const catalog = interactionCatalogSchema.parse(blenderInteractionCatalog);

    expect(catalog.catalogVersion).toBe('1.69.0');
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
    ).toHaveLength(22);

    const transform = recipeFor(catalog, 'blender.geometry_nodes.create_transform');
    expect(transform.guidance.steps.slice(5, 7).map((step) => step.target.connection)).toEqual([
      {
        fromNode: 'NodeGroupInput',
        fromSocket: 'Geometry',
        toNode: 'GeometryNodeTransform',
        toSocket: 'Geometry',
      },
      {
        fromNode: 'GeometryNodeTransform',
        fromSocket: 'Geometry',
        toNode: 'NodeGroupOutput',
        toSocket: 'Geometry',
      },
    ]);
    const lightTrails = recipeFor(catalog, 'blender.geometry_nodes.create_light_trails');
    const lightTrailConnections = lightTrails.guidance.steps.flatMap((step) =>
      step.target.connection === undefined ? [] : [step.target.connection],
    );
    expect(lightTrails.guidance.steps).toHaveLength(42);
    expect(lightTrailConnections).toHaveLength(19);
    expect(lightTrailConnections[0]).toEqual({
      fromNode: 'node-name:OperatingLine Half Tile Line',
      fromSocket: 'Curve',
      toNode: 'node-name:OperatingLine Trail Resolution',
      toSocket: 'Curve',
    });
    expect(lightTrailConnections.at(-1)).toEqual({
      fromNode: 'node-name:OperatingLine Realize Tiles',
      fromSocket: 'Geometry',
      toNode: 'node-name:OperatingLine Output',
      toSocket: 'Geometry',
    });
    const poseAnimation = recipeFor(catalog, 'blender.animation.create_pose_keyframes');
    expect(poseAnimation.guidance.steps).toHaveLength(8);
    expect(poseAnimation.procedureMaterialization?.semantic?.projections).toMatchObject([
      { actionArgument: 'actionName', transform: 'identity' },
      { actionArgument: 'keyframes', transform: 'json_identity' },
      { actionArgument: 'interpolation', transform: 'identity' },
      { actionArgument: 'extrapolation', transform: 'identity' },
    ]);
    expect(poseAnimation.procedureMaterialization?.semantic?.omittedActionArguments).toEqual([
      expect.objectContaining({ argumentName: 'actionId' }),
      expect.objectContaining({ argumentName: 'armatureId' }),
    ]);
    expect(poseAnimation.procedureMaterialization?.mcp).toMatchObject({
      availability: 'available',
      source: 'catalog.operation_level_mcp',
      toolName: 'operatingline.blender.animation.pose-keyframes.execute-next',
    });
    const poseMcp = poseAnimation.procedureMaterialization?.mcp;
    if (poseMcp?.availability !== 'available' || poseMcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Pose Animation operation-level MCP');
    }
    expect(poseMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      poseAnimationLeafOperationIds,
    );
    const armature = recipeFor(catalog, 'blender.rig.create_armature');
    expect(armature.guidance.steps.map((step) => step.id)).toEqual([
      'workspace.layout',
      'menu.add_armature',
      'mode.edit_bones',
      'semantic.rigid_parent',
      'semantic.verify_armature',
    ]);
    expect(armature.procedureMaterialization?.semantic?.projections).toMatchObject([
      { actionArgument: 'objectName', transform: 'identity' },
      { actionArgument: 'dataName', transform: 'identity' },
      { actionArgument: 'bones', transform: 'json_identity' },
      { actionArgument: 'bindings', transform: 'json_identity' },
    ]);
    expect(armature.procedureMaterialization?.semantic?.omittedActionArguments).toEqual([
      expect.objectContaining({ argumentName: 'armatureId' }),
      expect.objectContaining({ argumentName: 'collectionId' }),
    ]);
    const armatureMcp = armature.procedureMaterialization?.mcp;
    if (
      armatureMcp?.availability !== 'available' ||
      armatureMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Armature operation-level MCP');
    }
    expect(armatureMcp.toolName).toBe('operatingline.blender.rig.armature.execute-next');
    expect(armatureMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      armatureLeafOperationIds,
    );
    expect(
      armatureMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([
      ['armatureId', 'collectionId'],
      [],
      ['objectName'],
      ['dataName'],
      [],
      ['bones'],
      [],
      ['bindings'],
      [],
    ]);
    const solidify = recipeFor(catalog, 'blender.modifier.add_solidify');
    const solidifyMcp = solidify.procedureMaterialization?.mcp;
    if (
      solidifyMcp?.availability !== 'available' ||
      solidifyMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Solidify operation-level MCP');
    }
    expect(solidifyMcp.toolName).toBe('operatingline.blender.modifier.solidify.execute-next');
    expect(solidifyMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      solidifyLeafOperationIds,
    );
    expect(
      solidifyMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([['targetId', 'modifierId'], [], [], ['modifierName', 'thickness', 'offset']]);
    const singleMaterial = recipeFor(catalog, 'blender.material.create_and_assign');
    const singleMaterialMcp = singleMaterial.procedureMaterialization?.mcp;
    if (
      singleMaterialMcp?.availability !== 'available' ||
      singleMaterialMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Single Material operation-level MCP');
    }
    expect(singleMaterialMcp.toolName).toBe('operatingline.blender.material.single.execute-next');
    expect(singleMaterialMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      singleMaterialLeafOperationIds,
    );
    expect(
      singleMaterialMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([
      ['materialId'],
      [],
      [],
      ['materialName', 'baseColor', 'roughness', 'metallic', 'targets'],
    ]);
    const materialPalette = recipeFor(catalog, 'blender.material.create_palette_and_assign');
    const materialPaletteMcp = materialPalette.procedureMaterialization?.mcp;
    if (
      materialPaletteMcp?.availability !== 'available' ||
      materialPaletteMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Material Palette operation-level MCP');
    }
    expect(materialPaletteMcp.toolName).toBe('operatingline.blender.material.palette.execute-next');
    expect(materialPaletteMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      materialPaletteLeafOperationIds,
    );
    expect(
      materialPaletteMcp.operations.map((operation) =>
        operation.parameters.map(({ name }) => name),
      ),
    ).toEqual([[], [], ['materials'], []]);
    expect(materialPaletteMcp.operations[2]!.parameters).toEqual([
      {
        name: 'materials',
        source: {
          kind: 'action_argument',
          argumentName: 'materials',
          transform: 'json_identity',
        },
      },
    ]);
    const mirrorOperationRecipe = recipeFor(catalog, 'blender.modifier.add_mirror');
    const mirrorMcp = mirrorOperationRecipe.procedureMaterialization?.mcp;
    if (
      mirrorMcp?.availability !== 'available' ||
      mirrorMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Mirror operation-level MCP');
    }
    expect(mirrorMcp.toolName).toBe('operatingline.blender.modifier.mirror.execute-next');
    expect(mirrorMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      mirrorLeafOperationIds,
    );
    expect(
      mirrorMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([['targetId', 'modifierId'], [], [], [], [], [], ['modifierName', 'axis']]);
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
      '1.12.0',
      '1.13.0',
      '1.14.0',
      '1.15.0',
      '1.16.0',
      '1.17.0',
      '1.18.0',
      '1.19.0',
      '1.20.0',
      '1.21.0',
      '1.22.0',
      '1.23.0',
      '1.24.0',
      '1.25.0',
      '1.26.0',
      '1.27.0',
      '1.28.0',
      '1.29.0',
      '1.30.0',
      '1.31.0',
      '1.32.0',
      '1.33.0',
      '1.34.0',
      '1.35.0',
      '1.36.0',
      '1.37.0',
      '1.38.0',
      '1.39.0',
      '1.40.0',
      '1.41.0',
      '1.42.0',
      '1.43.0',
      '1.44.0',
      '1.45.0',
      '1.46.0',
      '1.47.0',
      '1.48.0',
      '1.49.0',
      '1.50.0',
      '1.51.0',
      '1.52.0',
      '1.53.0',
      '1.54.0',
      '1.55.0',
      '1.56.0',
      '1.57.0',
      '1.58.0',
      '1.59.0',
      '1.60.0',
      '1.61.0',
      '1.62.0',
      '1.63.0',
      '1.64.0',
      '1.65.0',
      '1.66.0',
      '1.67.0',
      '1.68.0',
      '1.69.0',
    ]);

    const availableMcpRecipes = catalog.recipes.filter(
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
    for (const recipe of availableMcpRecipes) {
      expect(recipe.procedureMaterialization?.mcp).toEqual({
        availability: 'available',
        source: 'catalog.action_level_mcp',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'accepted_action_arguments',
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
        resultBinding: 'companion_state_report',
      });
    }
    expect(
      catalog.recipes
        .filter(
          (recipe) =>
            recipe.procedureMaterialization?.mcp.availability === 'available' &&
            recipe.procedureMaterialization.mcp.source === 'catalog.operation_level_mcp',
        )
        .map((recipe) => recipe.actionName),
    ).toEqual([
      'blender.mesh.edit_triangulate',
      'blender.mesh.edit_extrude_region',
      'blender.mesh.edit_bevel_edges',
      'blender.mesh.edit_inset_faces',
      'blender.mesh.edit_poke_faces',
      'blender.modifier.add_bevel',
      'blender.modifier.add_solidify',
      'blender.modifier.add_subdivision_surface',
      'blender.modifier.add_mirror',
      'blender.geometry_nodes.create_transform',
      'blender.geometry_nodes.create_light_trails',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.rig.create_armature',
      'blender.rig.bind_skin_weights',
      'blender.animation.create_pose_keyframes',
    ]);
    const editTriangulate = recipeFor(catalog, 'blender.mesh.edit_triangulate');
    const editTriangulateMcp = editTriangulate.procedureMaterialization?.mcp;
    if (
      editTriangulateMcp?.availability !== 'available' ||
      editTriangulateMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Edit Triangulate operation-level MCP');
    }
    expect(editTriangulateMcp.toolName).toBe(
      'operatingline.blender.mesh.edit-triangulate.execute-next',
    );
    expect(editTriangulateMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editTriangulateLeafOperationIds,
    );
    expect(
      editTriangulateMcp.operations.map((operation) =>
        operation.parameters.map(({ name }) => name),
      ),
    ).toEqual([['targetId', 'resultMeshId'], [], [], [], [], ['resultMeshName']]);
    const editExtrudeRegion = recipeFor(catalog, 'blender.mesh.edit_extrude_region');
    const editExtrudeRegionMcp = editExtrudeRegion.procedureMaterialization?.mcp;
    if (
      editExtrudeRegionMcp?.availability !== 'available' ||
      editExtrudeRegionMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Extrude Region operation-level MCP');
    }
    expect(editExtrudeRegionMcp.toolName).toBe(
      'operatingline.blender.mesh.edit-extrude-region.execute-next',
    );
    expect(editExtrudeRegionMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editExtrudeRegionLeafOperationIds,
    );
    expect(
      editExtrudeRegionMcp.operations.map((operation) =>
        operation.parameters.map(({ name }) => name),
      ),
    ).toEqual([
      ['targetId', 'resultMeshId'],
      [],
      [],
      ['polygonIndices'],
      ['translation'],
      ['resultMeshName'],
    ]);
    const editBevel = recipeFor(catalog, 'blender.mesh.edit_bevel_edges');
    const editBevelMcp = editBevel.procedureMaterialization?.mcp;
    if (
      editBevelMcp?.availability !== 'available' ||
      editBevelMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected Edit Bevel operation-level MCP');
    }
    expect(editBevelMcp.toolName).toBe('operatingline.blender.mesh.edit-bevel-edges.execute-next');
    expect(editBevelMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editBevelLeafOperationIds,
    );
    expect(
      editBevelMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([
      ['targetId', 'resultMeshId'],
      [],
      [],
      [],
      ['width', 'segments', 'profile'],
      ['resultMeshName'],
    ]);
    expect(
      catalog.recipes
        .filter((recipe) => !availableMcpRecipes.includes(recipe))
        .every(
          (recipe) =>
            recipe.procedureMaterialization?.mcp.availability !== 'available' ||
            recipe.procedureMaterialization.mcp.source === 'catalog.operation_level_mcp',
        ),
    ).toBe(true);
    const frozen117 = blenderInteractionCatalogs.find(
      (versionedCatalog) => versionedCatalog.catalogVersion === '1.17.0',
    );
    if (frozen117 === undefined) throw new Error('Expected frozen InteractionCatalog 1.17.0');
    expect(
      recipeFor(frozen117, 'blender.mesh.create_cylinder').procedureMaterialization,
    ).toBeUndefined();
    const frozen118 = blenderInteractionCatalogs.find(
      (versionedCatalog) => versionedCatalog.catalogVersion === '1.18.0',
    );
    if (frozen118 === undefined) throw new Error('Expected frozen InteractionCatalog 1.18.0');
    expect(
      recipeFor(frozen118, 'blender.mesh.create_cube').procedureMaterialization?.shortcut,
    ).toEqual({
      availability: 'unavailable',
      reason: 'No verified shortcut procedure is available.',
    });
    const frozen119 = blenderInteractionCatalogs.find(
      (versionedCatalog) => versionedCatalog.catalogVersion === '1.19.0',
    );
    if (frozen119 === undefined) throw new Error('Expected frozen InteractionCatalog 1.19.0');
    expect(
      recipeFor(frozen119, 'blender.mesh.create_plane').procedureMaterialization?.shortcut,
    ).toEqual({
      availability: 'unavailable',
      reason: 'No verified shortcut procedure is available.',
    });

    const sphere = recipeFor(catalog, 'blender.mesh.create_uv_sphere');
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
              target: { kind: 'control', hostId: 'PROPERTIES.object.name' },
              path: ['Properties', 'Object', 'Name'],
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
        proofExecution: {
          executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
          targetProfile: 'factory_layout_three_object_ui_scale_2',
          executionBoundary: 'blender_window_event_simulate',
          authorization: 'accepted_replay_next_step',
          transport: 'event_simulate',
          hostVersions: ['4.5.3', '5.1.1'],
          operationIds: [
            'workspace.layout',
            'menu.add',
            'menu.mesh',
            'operator.uv_sphere',
            'control.location',
            'control.scale',
            'control.object_name',
          ],
          strongObservationKind: 'uv_sphere_menu_controls_ready',
          nativeUndoCheckpointRequired: true,
          nativeUndoDepth: 8,
          uiScale: 2,
          proofArguments: {
            resourceId: 'proof.uv_sphere.eye',
            objectName: 'OperatingLine.TutorialEye',
            radius: 1.5,
            location: [1.25, -2, 0.75],
          },
        },
      },
      shortcut: {
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
        operations: expect.arrayContaining([
          expect.objectContaining({
            id: 'shortcut.move_x',
            keyMode: 'sequence',
            keys: ['G', 'X'],
          }),
        ]),
      },
      mcp: {
        availability: 'available',
        source: 'catalog.action_level_mcp',
        toolName: 'operatingline.blender.action.execute',
        authorization: 'accepted_replay_next_step',
      },
    });
    expect(
      blenderInteractionCatalogs.find((versioned) => versioned.catalogVersion === '1.10.0')!
        .recipes[0]!.procedureMaterialization?.menu,
    ).toEqual({
      availability: 'available',
      source: 'guidance.native_path',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'accepted_action_arguments',
    });
    const icosphere = recipeFor(catalog, 'blender.mesh.create_icosphere');
    expect(icosphere.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          {
            name: 'subdivisions',
            source: {
              kind: 'action_argument',
              argumentName: 'subdivisions',
              transform: 'identity',
            },
          },
          {
            name: 'radius',
            source: {
              kind: 'action_argument',
              argumentName: 'radius',
              transform: 'identity',
            },
          },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.icosphere',
          operations: [
            {
              id: 'control.location',
              label: 'Location',
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
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
      shortcut: expect.objectContaining({
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
        preconditions: expect.arrayContaining([
          { kind: 'scene_state', label: 'Transform Orientation', value: 'GLOBAL' },
        ]),
        operations: expect.arrayContaining([
          expect.objectContaining({
            kind: 'key_input',
            id: 'shortcut.open_adjust_last_operation',
            keys: ['F9'],
            opensSurface: {
              kind: 'adjust_last_operation',
              hostId: 'screen.redo_last',
              sourceOperationId: 'shortcut.add_icosphere',
              expectedOperatorId: 'mesh.primitive_ico_sphere_add',
            },
          }),
          expect.objectContaining({
            kind: 'operator_property_update',
            id: 'shortcut.set_subdivisions',
            surfaceOperationId: 'shortcut.open_adjust_last_operation',
          }),
          expect.objectContaining({
            kind: 'operator_property_update',
            id: 'shortcut.set_radius',
            surfaceOperationId: 'shortcut.open_adjust_last_operation',
          }),
          expect.objectContaining({
            kind: 'key_input',
            id: 'shortcut.close_adjust_last_operation',
            closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
          }),
        ]),
        omittedActionArguments: [expect.objectContaining({ argumentName: 'resourceId' })],
      }),
      mcp: expect.objectContaining({
        availability: 'available',
        toolName: 'operatingline.blender.action.execute',
      }),
    });
    const plane = recipeFor(catalog, 'blender.mesh.create_plane');
    expect(plane.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
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
            {
              id: 'control.location',
              label: 'Location',
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
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
      shortcut: expect.objectContaining({
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
        operations: expect.any(Array),
      }),
      mcp: expect.objectContaining({
        availability: 'available',
        toolName: 'operatingline.blender.action.execute',
      }),
    });
    const planeShortcut = plane.procedureMaterialization?.shortcut;
    if (planeShortcut?.availability !== 'available') {
      throw new Error('Expected available Plane shortcut materialization');
    }
    expect(planeShortcut.preconditions).toEqual([
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'scene_state', label: '3D Cursor', value: '[0,0,0]' },
      { kind: 'scene_state', label: 'Transform Orientation', value: 'GLOBAL' },
    ]);
    expect(
      planeShortcut.operations.map((operation) => ({
        id: operation.id,
        keyMode: operation.keyMode,
        keys: operation.keys,
      })),
    ).toEqual([
      { id: 'shortcut.add_plane', keyMode: 'chord', keys: ['SHIFT', 'A'] },
      { id: 'shortcut.move_x', keyMode: 'sequence', keys: ['G', 'X'] },
      { id: 'shortcut.move_y', keyMode: 'sequence', keys: ['G', 'Y'] },
      { id: 'shortcut.move_z', keyMode: 'sequence', keys: ['G', 'Z'] },
      { id: 'shortcut.scale', keyMode: 'sequence', keys: ['S'] },
      { id: 'shortcut.rename', keyMode: 'sequence', keys: ['F2'] },
    ]);
    expect(planeShortcut.operations[0]).toMatchObject({
      selectionPath: ['Mesh', 'Plane'],
      parameters: [
        { name: 'size', source: { kind: 'literal', value: 2 } },
        { name: 'location', source: { kind: 'literal', value: [0, 0, 0] } },
      ],
    });
    expect(planeShortcut.operations.slice(1, 4).map((operation) => operation.parameters)).toEqual([
      [
        {
          name: 'value',
          source: {
            kind: 'action_argument',
            argumentName: 'location',
            transform: 'vector3_x',
          },
        },
        { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
      ],
      [
        {
          name: 'value',
          source: {
            kind: 'action_argument',
            argumentName: 'location',
            transform: 'vector3_y',
          },
        },
        { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
      ],
      [
        {
          name: 'value',
          source: {
            kind: 'action_argument',
            argumentName: 'location',
            transform: 'vector3_z',
          },
        },
        { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
      ],
    ]);
    expect(planeShortcut.operations[4]!.parameters).toEqual([
      {
        name: 'value',
        source: {
          kind: 'action_argument',
          argumentName: 'size',
          transform: 'divide_by_two',
        },
      },
      { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
    ]);
    expect(planeShortcut.operations[5]!.parameters).toEqual([
      {
        name: 'text',
        source: {
          kind: 'action_argument',
          argumentName: 'objectName',
          transform: 'identity',
        },
      },
      { name: 'confirm', source: { kind: 'literal', value: 'ENTER' } },
    ]);
    expect(planeShortcut.omittedActionArguments).toEqual([
      {
        argumentName: 'resourceId',
        reason: 'The logical resource identifier has no user-facing Blender shortcut input.',
      },
    ]);
    const cube = recipeFor(catalog, 'blender.mesh.create_cube');
    expect(cube.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
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
            {
              id: 'control.location',
              label: 'Location',
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
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
      shortcut: expect.objectContaining({
        availability: 'available',
        operations: expect.any(Array),
      }),
      mcp: expect.objectContaining({
        availability: 'available',
        toolName: 'operatingline.blender.action.execute',
      }),
    });
    const cubeShortcut = cube.procedureMaterialization?.shortcut;
    if (cubeShortcut?.availability !== 'available') {
      throw new Error('Expected available Cube shortcut materialization');
    }
    expect(
      cubeShortcut.operations.map((operation) => ({
        id: operation.id,
        keyMode: operation.keyMode,
        keys: operation.keys,
      })),
    ).toEqual([
      { id: 'shortcut.add_cube', keyMode: 'chord', keys: ['SHIFT', 'A'] },
      { id: 'shortcut.move_x', keyMode: 'sequence', keys: ['G', 'X'] },
      { id: 'shortcut.move_y', keyMode: 'sequence', keys: ['G', 'Y'] },
      { id: 'shortcut.move_z', keyMode: 'sequence', keys: ['G', 'Z'] },
      { id: 'shortcut.scale', keyMode: 'sequence', keys: ['S'] },
      { id: 'shortcut.rename', keyMode: 'sequence', keys: ['F2'] },
    ]);
    expect(cubeShortcut.operations[4]!.parameters[0]).toEqual({
      name: 'value',
      source: {
        kind: 'action_argument',
        argumentName: 'size',
        transform: 'divide_by_two',
      },
    });
    const cone = recipeFor(catalog, 'blender.mesh.create_cone');
    expect(cone.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          {
            name: 'vertices',
            source: { kind: 'literal', value: 32 },
          },
          {
            name: 'radius1',
            source: {
              kind: 'action_argument',
              argumentName: 'radiusStart',
              transform: 'identity',
            },
          },
          {
            name: 'radius2',
            source: {
              kind: 'action_argument',
              argumentName: 'radiusEnd',
              transform: 'identity',
            },
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
          {
            name: 'end_fill_type',
            source: { kind: 'literal', value: 'NGON' },
          },
          {
            name: 'calc_uvs',
            source: { kind: 'literal', value: false },
          },
          {
            name: 'enter_editmode',
            source: { kind: 'literal', value: false },
          },
          {
            name: 'align',
            source: { kind: 'literal', value: 'WORLD' },
          },
          {
            name: 'location',
            source: { kind: 'literal', value: [0, 0, 0] },
          },
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
          {
            name: 'scale',
            source: { kind: 'literal', value: [1, 1, 1] },
          },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.cone',
          operations: [
            {
              id: 'control.location',
              label: 'Location',
              target: { kind: 'control', hostId: 'VIEW3D_PT_item.transform.location' },
              path: ['Sidebar', 'Item', 'Transform', 'Location'],
              parameters: [
                {
                  name: 'value',
                  source: {
                    kind: 'derived_action_arguments',
                    derivation: 'segment_frame',
                    startArgumentName: 'start',
                    endArgumentName: 'end',
                    output: 'midpoint',
                  },
                },
              ],
            },
            {
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
        reason: 'No verified shortcut procedure is available.',
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
    const cylinder = recipeFor(catalog, 'blender.mesh.create_cylinder');
    expect(cylinder.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          { name: 'vertices', source: { kind: 'literal', value: 32 } },
          {
            name: 'radius',
            source: {
              kind: 'action_argument',
              argumentName: 'radius',
              transform: 'identity',
            },
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
            {
              id: 'control.location',
              label: 'Location',
              target: { kind: 'control', hostId: 'VIEW3D_PT_item.transform.location' },
              path: ['Sidebar', 'Item', 'Transform', 'Location'],
              parameters: [
                {
                  name: 'value',
                  source: {
                    kind: 'derived_action_arguments',
                    derivation: 'segment_frame',
                    startArgumentName: 'start',
                    endArgumentName: 'end',
                    output: 'midpoint',
                  },
                },
              ],
            },
            {
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
        reason: 'No verified shortcut procedure is available.',
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
    const torus = recipeFor(catalog, 'blender.mesh.create_torus');
    expect(torus.procedureMaterialization).toEqual({
      menu: {
        availability: 'available',
        source: 'guidance.native_path',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        operatorParameters: [
          {
            name: 'major_segments',
            source: {
              kind: 'action_argument',
              argumentName: 'majorSegments',
              transform: 'identity',
            },
          },
          {
            name: 'minor_segments',
            source: {
              kind: 'action_argument',
              argumentName: 'minorSegments',
              transform: 'identity',
            },
          },
          {
            name: 'mode',
            source: {
              kind: 'literal',
              value: 'MAJOR_MINOR',
            },
          },
          {
            name: 'major_radius',
            source: {
              kind: 'action_argument',
              argumentName: 'majorRadius',
              transform: 'identity',
            },
          },
          {
            name: 'minor_radius',
            source: {
              kind: 'action_argument',
              argumentName: 'minorRadius',
              transform: 'identity',
            },
          },
        ],
        controlOperations: {
          insertAfterStepId: 'operator.torus',
          operations: [
            {
              id: 'control.location',
              label: 'Location',
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
              id: 'control.object_name',
              label: 'Object Name',
              target: { kind: 'control', hostId: 'OUTLINER.object.name' },
              path: ['Outliner', 'Object Name'],
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
        reason: 'No verified shortcut procedure is available.',
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
    const subdivide = recipeFor(catalog, 'blender.mesh.edit_subdivide');
    expect(subdivide.guidance.kind).toBe('semantic_path');
    expect(subdivide.procedureMaterialization).toMatchObject({
      menu: { availability: 'unavailable' },
      menuCandidate: {
        source: 'catalog.ordered_menu_candidate_operations',
        projection: 'candidate_only',
        equivalence: 'not_equivalent_to_managed_action',
        executionAuthority: 'none',
      },
      shortcut: {
        availability: 'available',
        source: 'catalog.ordered_shortcut_operations',
        semanticBinding: 'all_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        projection: 'candidate_only',
      },
      mcp: { availability: 'available' },
    });
    const subdivideMenuCandidate = subdivide.procedureMaterialization?.menuCandidate;
    if (subdivideMenuCandidate === undefined) {
      throw new Error('Expected Subdivide menu candidate materialization');
    }
    expect(subdivideMenuCandidate.operations.map((operation) => operation.id)).toEqual([
      'candidate.workspace_layout',
      'candidate.use_accepted_active_mesh',
      'candidate.enter_edit_mode',
      'candidate.open_select_menu',
      'candidate.select_all_mesh_elements',
      'candidate.open_edge_menu',
      'candidate.execute_subdivide',
      'candidate.open_adjust_last_operation',
      'candidate.set_number_of_cuts',
      'candidate.set_smoothness',
      'candidate.return_to_object_mode',
    ]);
    expect(subdivideMenuCandidate.operations.slice(8, 10)).toMatchObject([
      {
        target: { kind: 'control', hostId: 'mesh.subdivide.number_cuts' },
        parameters: [
          {
            name: 'value',
            source: { kind: 'action_argument', argumentName: 'cuts', transform: 'identity' },
          },
        ],
      },
      {
        target: { kind: 'control', hostId: 'mesh.subdivide.smoothness' },
        parameters: [
          {
            name: 'value',
            source: { kind: 'action_argument', argumentName: 'smooth', transform: 'identity' },
          },
        ],
      },
    ]);
    expect(
      subdivideMenuCandidate.omittedActionArguments.map(({ argumentName }) => argumentName),
    ).toEqual(['targetId', 'resultMeshId', 'resultMeshName']);
    const subdivideShortcut = subdivide.procedureMaterialization?.shortcut;
    if (subdivideShortcut?.availability !== 'available') {
      throw new Error('Expected Subdivide shortcut materialization');
    }
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
    expect(subdivideShortcut.operations.slice(5, 7)).toMatchObject([
      {
        kind: 'operator_property_update',
        target: { kind: 'control', hostId: 'mesh.subdivide.number_cuts' },
        parameters: [
          {
            name: 'value',
            source: { kind: 'action_argument', argumentName: 'cuts', transform: 'identity' },
          },
        ],
      },
      {
        kind: 'operator_property_update',
        target: { kind: 'control', hostId: 'mesh.subdivide.smoothness' },
        parameters: [
          {
            name: 'value',
            source: { kind: 'action_argument', argumentName: 'smooth', transform: 'identity' },
          },
        ],
      },
    ]);
    expect(subdivideShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    const subdivisionSurface = recipeFor(catalog, 'blender.modifier.add_subdivision_surface');
    expect(subdivisionSurface.procedureMaterialization).toMatchObject({
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
      },
    });
    const subdivisionSurfaceMcp = subdivisionSurface.procedureMaterialization?.mcp;
    if (
      subdivisionSurfaceMcp?.availability !== 'available' ||
      subdivisionSurfaceMcp.source !== 'catalog.operation_level_mcp'
    ) {
      throw new Error('Expected operation-level Subdivision Surface MCP');
    }
    expect(
      subdivisionSurfaceMcp.operations.map((operation) => operation.sourceOperationId),
    ).toEqual(subdivisionSurfaceLeafOperationIds);
    expect(subdivisionSurface.guidance).toMatchObject({
      kind: 'semantic_path',
      steps: [
        { order: 1, intent: 'navigate', target: { kind: 'workspace', hostId: 'Layout' } },
        {
          order: 2,
          intent: 'configure',
          target: { kind: 'semantic', hostId: 'operatingline.blender.owned_mesh' },
        },
        {
          order: 3,
          intent: 'execute',
          target: { kind: 'operator', hostId: 'object.subdivision_set' },
        },
        {
          order: 4,
          intent: 'configure',
          target: {
            kind: 'semantic',
            hostId: 'operatingline.blender.subdivision_surface_modifier',
          },
        },
      ],
    });
    if (subdivisionSurface.guidance.kind !== 'semantic_path') {
      throw new Error('Expected semantic Subdivision Surface guidance');
    }
    expect(
      subdivisionSurface.guidance.steps.filter(
        (step) => step.intent === 'execute' && step.target.kind === 'operator',
      ),
    ).toHaveLength(1);
    const subdivisionShortcut = subdivisionSurface.procedureMaterialization?.shortcut;
    if (subdivisionShortcut?.availability !== 'available') {
      throw new Error('Expected Subdivision Surface shortcut materialization');
    }
    expect(subdivisionShortcut.preconditions).toEqual([
      { kind: 'workspace', label: 'Workspace', value: 'Layout' },
      { kind: 'editor', label: 'Editor', value: 'VIEW_3D' },
      { kind: 'mode', label: 'Mode', value: 'OBJECT' },
      {
        kind: 'selection',
        label: 'Active Target',
        value:
          'Exactly the unmodified factory Cube (8 vertices, 12 edges, 6 polygons) is active and selected',
      },
      { kind: 'keymap', label: 'Keymap', value: 'Blender' },
      { kind: 'modal_state', label: 'Modal UI', value: 'None' },
      {
        kind: 'scene_state',
        label: 'Modifier Type',
        value: 'No existing SUBSURF modifier',
      },
      {
        kind: 'scene_state',
        label: 'Modifier Stack',
        value: 'Existing modifier stack matches accepted tracked state',
      },
      {
        kind: 'scene_state',
        label: 'Topology Bounds',
        value: 'Evaluated and projected topology are within managed bounds',
      },
    ]);
    expect(subdivisionShortcut.operations).toEqual([
      {
        kind: 'key_input',
        id: 'shortcut.add_subdivision_surface_level_one',
        label: 'Add Subdivision Surface Level One',
        keyMode: 'chord',
        keys: ['CTRL', '1'],
        parameters: [
          { name: 'level', source: { kind: 'literal', value: 1 } },
          { name: 'relative', source: { kind: 'literal', value: false } },
          { name: 'ensure_modifier', source: { kind: 'literal', value: true } },
        ],
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
          sourceOperationId: 'shortcut.add_subdivision_surface_level_one',
          expectedOperatorId: 'object.subdivision_set',
        },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_viewport_level',
        label: 'Set Viewport Level',
        surfaceOperationId: 'shortcut.open_adjust_last_operation',
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
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        label: 'Confirm Adjust Last Operation',
        keyMode: 'sequence',
        keys: ['ENTER'],
        parameters: [],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      },
    ]);
    expect(subdivisionShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
    ]);
    const bevelEdges = recipeFor(catalog, 'blender.mesh.edit_bevel_edges');
    expect(bevelEdges.procedureMaterialization).toMatchObject({
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
    if (bevelEdges.guidance.kind !== 'semantic_path') {
      throw new Error('Expected semantic Bevel Edges guidance');
    }
    expect(
      bevelEdges.guidance.steps.map((step) => [step.intent, step.target.kind, step.target.hostId]),
    ).toEqual([
      ['navigate', 'workspace', 'Layout'],
      ['configure', 'semantic', 'operatingline.blender.owned_mesh'],
      ['navigate', 'mode', 'EDIT_MESH'],
      ['navigate', 'menu', 'VIEW3D_MT_edit_mesh_edges'],
      ['execute', 'operator', 'mesh.bevel'],
      ['configure', 'semantic', 'operatingline.blender.managed_bevel_edges'],
    ]);
    expect(
      bevelEdges.guidance.steps.filter(
        (step) => step.intent === 'execute' && step.target.kind === 'operator',
      ),
    ).toHaveLength(1);
    const bevelShortcut = bevelEdges.procedureMaterialization?.shortcut;
    if (bevelShortcut?.availability !== 'available') {
      throw new Error('Expected Bevel Edges shortcut materialization');
    }
    expect(bevelShortcut.preconditions).toEqual([
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
      { kind: 'scene_state', label: 'Modifiers', value: 'None' },
      { kind: 'scene_state', label: 'Shape Keys', value: 'None' },
      {
        kind: 'scene_state',
        label: 'Closed Manifold',
        value: 'Every target mesh edge belongs to exactly two faces',
      },
      {
        kind: 'scene_state',
        label: 'Topology Bounds',
        value:
          'Source and projected result topology are within 8192 vertices, 16384 edges, and 8192 polygons',
      },
    ]);
    expect(bevelShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.enter_edit_mode',
      'shortcut.select_edge_mode',
      'shortcut.select_all_edges',
      'shortcut.bevel_edges',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_bevel_width',
      'shortcut.set_bevel_segments',
      'shortcut.set_bevel_profile',
      'shortcut.close_adjust_last_operation',
      'shortcut.return_to_object_mode',
    ]);
    const bevelSource = bevelShortcut.operations[3];
    expect(bevelSource).toMatchObject({ kind: 'key_input', keyMode: 'chord', keys: ['CTRL', 'B'] });
    expect(bevelSource?.parameters.map((parameter) => [parameter.name, parameter.source])).toEqual([
      ['offset_type', { kind: 'literal', value: 'OFFSET' }],
      ['offset', { kind: 'literal', value: 0 }],
      ['profile_type', { kind: 'literal', value: 'SUPERELLIPSE' }],
      ['segments', { kind: 'literal', value: 1 }],
      ['profile', { kind: 'literal', value: 0.5 }],
      ['affect', { kind: 'literal', value: 'EDGES' }],
      ['clamp_overlap', { kind: 'literal', value: false }],
      ['loop_slide', { kind: 'literal', value: true }],
      ['mark_seam', { kind: 'literal', value: false }],
      ['mark_sharp', { kind: 'literal', value: false }],
      ['material', { kind: 'literal', value: -1 }],
      ['harden_normals', { kind: 'literal', value: false }],
      ['face_strength_mode', { kind: 'literal', value: 'NONE' }],
      ['miter_outer', { kind: 'literal', value: 'SHARP' }],
      ['miter_inner', { kind: 'literal', value: 'SHARP' }],
      ['spread', { kind: 'literal', value: 0.1 }],
      ['vmesh_method', { kind: 'literal', value: 'ADJ' }],
      ['release_confirm', { kind: 'literal', value: false }],
      ['confirm', { kind: 'literal', value: 'ENTER' }],
    ]);
    expect(bevelShortcut.operations[4]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.bevel_edges',
        expectedOperatorId: 'mesh.bevel',
      },
    });
    expect(
      bevelShortcut.operations.slice(5, 8).map((operation) => ({
        target: operation.target,
        path: operation.path,
        argumentName:
          operation.parameters[0]?.source.kind === 'action_argument'
            ? operation.parameters[0].source.argumentName
            : undefined,
      })),
    ).toEqual([
      {
        target: { kind: 'control', hostId: 'mesh.bevel.offset' },
        path: ['Adjust Last Operation', 'Width'],
        argumentName: 'width',
      },
      {
        target: { kind: 'control', hostId: 'mesh.bevel.segments' },
        path: ['Adjust Last Operation', 'Segments'],
        argumentName: 'segments',
      },
      {
        target: { kind: 'control', hostId: 'mesh.bevel.profile' },
        path: ['Adjust Last Operation', 'Profile Shape'],
        argumentName: 'profile',
      },
    ]);
    expect(bevelShortcut.operations[8]).toMatchObject({
      keys: ['ENTER'],
      closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
    });
    expect(bevelShortcut.operations[9]).toMatchObject({ keys: ['TAB'] });
    expect(bevelShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    const insetFaces = recipeFor(catalog, 'blender.mesh.edit_inset_faces');
    expect(insetFaces.procedureMaterialization).toMatchObject({
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
    if (insetFaces.guidance.kind !== 'semantic_path') {
      throw new Error('Expected semantic Inset Faces guidance');
    }
    expect(
      insetFaces.guidance.steps.map((step) => [step.intent, step.target.kind, step.target.hostId]),
    ).toEqual([
      ['navigate', 'workspace', 'Layout'],
      ['configure', 'semantic', 'operatingline.blender.owned_mesh'],
      ['navigate', 'mode', 'EDIT_MESH'],
      ['navigate', 'menu', 'VIEW3D_MT_edit_mesh_faces'],
      ['execute', 'operator', 'mesh.inset'],
      ['configure', 'semantic', 'operatingline.blender.managed_inset_faces'],
    ]);
    const insetShortcut = insetFaces.procedureMaterialization?.shortcut;
    if (insetShortcut?.availability !== 'available') {
      throw new Error('Expected Inset Faces shortcut materialization');
    }
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
    expect(
      insetShortcut.operations[3]?.parameters.map((parameter) => [
        parameter.name,
        parameter.source,
      ]),
    ).toEqual([
      ['use_boundary', { kind: 'literal', value: true }],
      ['use_even_offset', { kind: 'literal', value: true }],
      ['use_relative_offset', { kind: 'literal', value: false }],
      ['use_edge_rail', { kind: 'literal', value: false }],
      ['thickness', { kind: 'literal', value: 0 }],
      ['depth', { kind: 'literal', value: 0 }],
      ['use_outset', { kind: 'literal', value: false }],
      ['use_select_inset', { kind: 'literal', value: false }],
      ['use_individual', { kind: 'literal', value: false }],
      ['use_interpolate', { kind: 'literal', value: true }],
      ['release_confirm', { kind: 'literal', value: false }],
      ['confirm', { kind: 'literal', value: 'ENTER' }],
    ]);
    expect(insetShortcut.operations[4]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.inset_faces',
        expectedOperatorId: 'mesh.inset',
      },
    });
    expect(insetShortcut.operations.slice(5, 8)).toMatchObject([
      {
        target: { kind: 'control', hostId: 'mesh.inset.thickness' },
        parameters: [
          { source: { kind: 'action_argument', argumentName: 'thickness', transform: 'identity' } },
        ],
      },
      {
        target: { kind: 'control', hostId: 'mesh.inset.depth' },
        parameters: [
          { source: { kind: 'action_argument', argumentName: 'depth', transform: 'identity' } },
        ],
      },
      {
        target: { kind: 'control', hostId: 'mesh.inset.use_individual' },
        parameters: [{ source: { kind: 'literal', value: true } }],
      },
    ]);
    expect(insetShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    const pokeFaces = recipeFor(catalog, 'blender.mesh.edit_poke_faces');
    expect(pokeFaces.procedureMaterialization).toMatchObject({
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
    if (pokeFaces.guidance.kind !== 'semantic_path') {
      throw new Error('Expected semantic Poke Faces guidance');
    }
    expect(
      pokeFaces.guidance.steps.map((step) => [step.intent, step.target.kind, step.target.hostId]),
    ).toEqual([
      ['navigate', 'workspace', 'Layout'],
      ['configure', 'semantic', 'operatingline.blender.owned_mesh'],
      ['navigate', 'mode', 'EDIT_MESH'],
      ['navigate', 'menu', 'VIEW3D_MT_edit_mesh_faces'],
      ['execute', 'operator', 'mesh.poke'],
      ['configure', 'semantic', 'operatingline.blender.managed_poke_faces'],
    ]);
    expect(pokeFaces.guidance.reason).toContain(
      'UI MEDIAN_WEIGHTED center_mode is the literal UI spelling equivalent to the managed BMesh MEAN_WEIGHTED contract',
    );
    const pokeShortcut = pokeFaces.procedureMaterialization?.shortcut;
    if (pokeShortcut?.availability !== 'available') {
      throw new Error('Expected Poke Faces shortcut materialization');
    }
    expect(pokeShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.enter_edit_mode',
      'shortcut.select_face_mode',
      'shortcut.select_all_faces',
      'shortcut.open_operator_search',
      'shortcut.execute_poke_faces',
      'shortcut.open_adjust_last_operation',
      'shortcut.set_poke_offset',
      'shortcut.close_adjust_last_operation',
      'shortcut.return_to_object_mode',
    ]);
    expect(pokeShortcut.operations[3]).toMatchObject({
      keys: ['F3'],
      selectionPath: ['Poke Faces'],
      parameters: [{ name: 'query', source: { kind: 'literal', value: 'poke faces' } }],
    });
    expect(pokeShortcut.operations[4]?.parameters).toEqual([
      { name: 'offset', source: { kind: 'literal', value: 0 } },
      { name: 'use_relative_offset', source: { kind: 'literal', value: false } },
      { name: 'center_mode', source: { kind: 'literal', value: 'MEDIAN_WEIGHTED' } },
    ]);
    expect(pokeShortcut.operations[5]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        sourceOperationId: 'shortcut.execute_poke_faces',
        expectedOperatorId: 'mesh.poke',
      },
    });
    expect(pokeShortcut.operations[6]).toMatchObject({
      target: { kind: 'control', hostId: 'mesh.poke.offset' },
      path: ['Adjust Last Operation', 'Offset'],
      parameters: [
        { source: { kind: 'action_argument', argumentName: 'offset', transform: 'identity' } },
      ],
    });
    expect(pokeShortcut.operations[7]).toMatchObject({
      keys: ['ENTER'],
      closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
    });
    expect(pokeShortcut.operations[8]).toMatchObject({ keys: ['TAB'] });
    expect(pokeShortcut.omittedActionArguments.map((item) => item.argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    const pokeMcp = pokeFaces.procedureMaterialization?.mcp;
    if (pokeMcp?.availability !== 'available' || pokeMcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('Expected Poke Faces operation-level MCP');
    }
    expect(pokeMcp.toolName).toBe('operatingline.blender.mesh.edit-poke-faces.execute-next');
    expect(pokeMcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editPokeLeafOperationIds,
    );
    expect(
      pokeMcp.operations.map((operation) => operation.parameters.map(({ name }) => name)),
    ).toEqual([['targetId', 'resultMeshId'], [], [], [], ['offset'], ['resultMeshName']]);
    const mirror = recipeFor(catalog, 'blender.modifier.add_mirror');
    if (mirror.guidance.kind !== 'semantic_path') {
      throw new Error('Expected semantic Mirror guidance');
    }
    expect(mirror.guidance.steps.map((step) => step.label)).toEqual([
      'Layout',
      'Owned Mesh',
      'Modifiers',
      'Add Modifier',
      'Generate',
      'Mirror',
      'Managed Mirror Contract',
    ]);
    expect(mirror.guidance.steps.map((step) => [step.target.kind, step.target.hostId])).toEqual([
      ['workspace', 'Layout'],
      ['semantic', 'operatingline.blender.owned_mesh'],
      ['panel', 'PROPERTIES_MODIFIER'],
      ['menu', 'OBJECT_MT_modifier_add'],
      ['menu', 'OBJECT_MT_modifier_add_generate'],
      ['operator', 'object.modifier_add'],
      ['semantic', 'operatingline.blender.mirror_modifier'],
    ]);
    expect(mirror.guidance.reason).toContain('type=MIRROR');
    expect(mirror.guidance.manualReference).toBe(
      'https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/mirror.html',
    );
    expect(mirror.procedureMaterialization).toEqual({
      menu: {
        availability: 'unavailable',
        reason: expect.stringContaining('managed modifier identity'),
      },
      shortcut: {
        availability: 'unavailable',
        reason: expect.stringContaining('Shift+A'),
      },
      mcp: {
        availability: 'available',
        source: 'catalog.operation_level_mcp',
        semanticBinding: 'ordered_leaf_operations',
        parameterBinding: 'ordered_parameter_operations',
        serverName: 'operating-line',
        toolName: 'operatingline.blender.modifier.mirror.execute-next',
        authorization: 'accepted_replay_next_step',
        resultBinding: 'companion_leaf_operation_progress',
        operations: mirrorLeafOperationIds.map((sourceOperationId, index) => ({
          sourceOperationId,
          parameters:
            index === 0
              ? [
                  {
                    name: 'targetId',
                    source: {
                      kind: 'action_argument',
                      argumentName: 'targetId',
                      transform: 'identity',
                    },
                  },
                  {
                    name: 'modifierId',
                    source: {
                      kind: 'action_argument',
                      argumentName: 'modifierId',
                      transform: 'identity',
                    },
                  },
                ]
              : index === 6
                ? [
                    {
                      name: 'modifierName',
                      source: {
                        kind: 'action_argument',
                        argumentName: 'modifierName',
                        transform: 'identity',
                      },
                    },
                    {
                      name: 'axis',
                      source: {
                        kind: 'action_argument',
                        argumentName: 'axis',
                        transform: 'identity',
                      },
                    },
                  ]
                : [],
        })),
      },
    });
    const materializedActionNames = new Set([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
      'blender.mesh.edit_subdivide',
      'blender.mesh.edit_triangulate',
      'blender.mesh.edit_extrude_region',
      'blender.mesh.edit_bevel_edges',
      'blender.mesh.edit_inset_faces',
      'blender.mesh.edit_poke_faces',
      'blender.modifier.add_subdivision_surface',
      'blender.modifier.add_solidify',
      'blender.modifier.add_bevel',
      'blender.modifier.add_mirror',
      'blender.geometry_nodes.create_transform',
      'blender.geometry_nodes.create_light_trails',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.lookdev.create_light_trails_scene',
      'blender.rig.create_armature',
      'blender.rig.bind_skin_weights',
      'blender.animation.create_pose_keyframes',
    ]);
    expect(
      catalog.recipes.filter((recipe) => !materializedActionNames.has(recipe.actionName)),
    ).toSatisfy((recipes) =>
      recipes.every((recipe) => recipe.procedureMaterialization === undefined),
    );
  });

  it('rejects partial node connections and connections on non-semantic targets', () => {
    const partial = structuredClone(blenderInteractionCatalog) as unknown as {
      recipes: Array<{
        actionName: string;
        guidance: { steps: Array<{ target: Record<string, unknown> }> };
      }>;
    };
    const partialTransform = partial.recipes.find(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_transform',
    );
    if (partialTransform === undefined) throw new Error('Expected Transform Geometry recipe');
    const partialConnection = partialTransform.guidance.steps[5]!.target.connection as Record<
      string,
      unknown
    >;
    delete partialConnection.toSocket;
    expect(interactionCatalogSchema.safeParse(partial).success).toBe(false);

    const wrongKind = structuredClone(blenderInteractionCatalog) as unknown as {
      recipes: Array<{
        actionName: string;
        guidance: { steps: Array<{ target: Record<string, unknown> }> };
      }>;
    };
    const wrongKindTransform = wrongKind.recipes.find(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_transform',
    );
    if (wrongKindTransform === undefined) throw new Error('Expected Transform Geometry recipe');
    wrongKindTransform.guidance.steps[5]!.target.kind = 'node';
    expect(interactionCatalogSchema.safeParse(wrongKind).success).toBe(false);

    const dangling = structuredClone(blenderInteractionCatalog);
    const danglingTransform = recipeFor(dangling, 'blender.geometry_nodes.create_transform');
    danglingTransform.guidance.steps[5]!.target.connection!.fromNode = 'MissingNode';
    expect(() => validateInteractionCatalog(dangling)).toThrow(
      'fromNode MissingNode must reference exactly one declared node target',
    );

    const wrongIntent = structuredClone(blenderInteractionCatalog);
    const wrongIntentTransform = recipeFor(wrongIntent, 'blender.geometry_nodes.create_transform');
    wrongIntentTransform.guidance.steps[5]!.intent = 'configure';
    expect(() => validateInteractionCatalog(wrongIntent)).toThrow('must use execute intent');

    const duplicateNode = structuredClone(blenderInteractionCatalog);
    const duplicateTransform = recipeFor(duplicateNode, 'blender.geometry_nodes.create_transform');
    duplicateTransform.guidance.steps[2]!.target.hostId = 'GeometryNodeTransform';
    duplicateTransform.guidance.steps[5]!.target.connection!.fromNode = 'GeometryNodeTransform';
    expect(() => validateInteractionCatalog(duplicateNode)).toThrow(
      'must reference exactly one declared node target',
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
    mutableOrderedMenu(wrongInsertion).controlOperations.insertAfterStepId = 'menu.mesh';
    expect(() => validateInteractionCatalog(wrongInsertion, blenderActionCatalog)).toThrow(
      'must be inserted after its execution step',
    );

    const conflictingControlId = structuredClone(blenderInteractionCatalog);
    mutableOrderedMenu(conflictingControlId).controlOperations.operations[0]!.id = 'menu.add';
    expect(() => validateInteractionCatalog(conflictingControlId, blenderActionCatalog)).toThrow(
      'control id menu.add conflicts',
    );

    const conflictingControlLabel = structuredClone(blenderInteractionCatalog);
    mutableOrderedMenu(conflictingControlLabel).controlOperations.operations[0]!.label = 'Add';
    expect(() => validateInteractionCatalog(conflictingControlLabel, blenderActionCatalog)).toThrow(
      'control label Add conflicts',
    );

    const duplicateParameter = structuredClone(blenderInteractionCatalog);
    const duplicateParameterMenu = mutableOrderedMenu(duplicateParameter);
    duplicateParameterMenu.operatorParameters.push(
      structuredClone(duplicateParameterMenu.operatorParameters[0]!),
    );
    expect(() => validateInteractionCatalog(duplicateParameter, blenderActionCatalog)).toThrow(
      'duplicate parameter radius',
    );

    for (const unsafeName of ['__proto__', 'prototype', 'constructor']) {
      const unsafeParameter = structuredClone(blenderInteractionCatalog);
      mutableOrderedMenu(unsafeParameter).operatorParameters[0]!.name = unsafeName;
      expect(() => validateInteractionCatalog(unsafeParameter, blenderActionCatalog)).toThrow(
        `unsafe parameter name ${unsafeName}`,
      );
    }

    const unknownArgument = structuredClone(blenderInteractionCatalog);
    const unknownSource =
      mutableOrderedMenu(unknownArgument).controlOperations.operations[0]!.parameters[0]!.source;
    if (unknownSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    unknownSource.argumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownArgument, blenderActionCatalog)).toThrow(
      'unknown action argument missing',
    );

    const invalidUniformVector = structuredClone(blenderInteractionCatalog);
    const invalidUniformSource =
      mutableOrderedMenu(invalidUniformVector).controlOperations.operations[0]!.parameters[0]!
        .source;
    if (invalidUniformSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    invalidUniformSource.transform = 'uniform_vector3';
    expect(() => validateInteractionCatalog(invalidUniformVector, blenderActionCatalog)).toThrow(
      'uniform_vector3 requires numeric action argument location',
    );

    const invalidHalvedValue = structuredClone(blenderInteractionCatalog);
    const invalidHalvedSource =
      mutableOrderedMenu(invalidHalvedValue).controlOperations.operations[0]!.parameters[0]!.source;
    if (invalidHalvedSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    invalidHalvedSource.transform = 'divide_by_two';
    expect(() => validateInteractionCatalog(invalidHalvedValue, blenderActionCatalog)).toThrow(
      'divide_by_two requires numeric action argument location',
    );

    const duplicateMapping = structuredClone(blenderInteractionCatalog);
    const duplicateMappingSource =
      mutableOrderedMenu(duplicateMapping).controlOperations.operations[2]!.parameters[0]!.source;
    if (duplicateMappingSource.kind !== 'action_argument') {
      throw new Error('Expected action argument fixture');
    }
    duplicateMappingSource.argumentName = 'radius';
    expect(() => validateInteractionCatalog(duplicateMapping, blenderActionCatalog)).toThrow(
      'maps action argument radius more than once',
    );

    const mappedAndOmitted = structuredClone(blenderInteractionCatalog);
    mutableOrderedMenu(mappedAndOmitted).omittedActionArguments[0]!.argumentName = 'radius';
    expect(() => validateInteractionCatalog(mappedAndOmitted, blenderActionCatalog)).toThrow(
      'cannot be both mapped and omitted',
    );

    const unknownOmission = structuredClone(blenderInteractionCatalog);
    mutableOrderedMenu(unknownOmission).omittedActionArguments[0]!.argumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownOmission, blenderActionCatalog)).toThrow(
      'omits unknown action argument missing',
    );

    const duplicateOmission = structuredClone(blenderInteractionCatalog);
    const duplicateOmissionMenu = mutableOrderedMenu(duplicateOmission);
    duplicateOmissionMenu.omittedActionArguments.push(
      structuredClone(duplicateOmissionMenu.omittedActionArguments[0]!),
    );
    expect(() => validateInteractionCatalog(duplicateOmission, blenderActionCatalog)).toThrow(
      'omits action argument resourceId more than once',
    );

    const uncoveredArgument = structuredClone(blenderInteractionCatalog);
    mutableOrderedMenu(uncoveredArgument).omittedActionArguments = [];
    expect(() => validateInteractionCatalog(uncoveredArgument, blenderActionCatalog)).toThrow(
      'leaves action arguments unmapped: resourceId',
    );

    const missing = structuredClone(blenderInteractionCatalog);
    missing.recipes.pop();
    expect(() => validateInteractionCatalog(missing, blenderActionCatalog)).toThrow(
      'action coverage mismatch',
    );
  });

  it('keeps menu candidates catalog-owned, non-executable, ordered, and fully parameter-bound', () => {
    const recipe = recipeFor(blenderInteractionCatalog, 'blender.mesh.edit_subdivide');
    const candidate = recipe.procedureMaterialization?.menuCandidate;
    if (candidate === undefined) throw new Error('Expected Edit Subdivide menu candidate');
    expect(recipe.procedureMaterialization?.menu.availability).toBe('unavailable');
    expect(candidate).toMatchObject({
      projection: 'candidate_only',
      equivalence: 'not_equivalent_to_managed_action',
      executionAuthority: 'none',
    });
    expect(candidate.operations.flatMap((operation) => operation.parameters)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ argumentName: 'targetId' }),
        }),
        expect.objectContaining({
          source: expect.objectContaining({ argumentName: 'resultMeshId' }),
        }),
        expect.objectContaining({
          source: expect.objectContaining({ argumentName: 'resultMeshName' }),
        }),
      ]),
    );

    const elevated = structuredClone(blenderInteractionCatalog) as unknown as Record<
      string,
      unknown
    >;
    const elevatedRecipes = elevated['recipes'] as Array<Record<string, unknown>>;
    const elevatedSubdivide = elevatedRecipes.find(
      (item) => item['actionName'] === 'blender.mesh.edit_subdivide',
    )!;
    const elevatedMaterialization = elevatedSubdivide['procedureMaterialization'] as Record<
      string,
      unknown
    >;
    const elevatedCandidate = elevatedMaterialization['menuCandidate'] as Record<string, unknown>;
    elevatedCandidate['executionAuthority'] = 'accepted_replay_next_step';
    expect(interactionCatalogSchema.safeParse(elevated).success).toBe(false);

    const duplicate = structuredClone(blenderInteractionCatalog);
    const duplicateCandidate = recipeFor(duplicate, 'blender.mesh.edit_subdivide')
      .procedureMaterialization?.menuCandidate;
    if (duplicateCandidate === undefined) throw new Error('Expected menu candidate');
    duplicateCandidate.operations[1]!.id = duplicateCandidate.operations[0]!.id;
    expect(() => validateInteractionCatalog(duplicate, blenderActionCatalog)).toThrow(
      'menu candidate contains duplicate operation id',
    );

    const uncovered = structuredClone(blenderInteractionCatalog);
    const uncoveredCandidate = recipeFor(uncovered, 'blender.mesh.edit_subdivide')
      .procedureMaterialization?.menuCandidate;
    if (uncoveredCandidate === undefined) throw new Error('Expected menu candidate');
    uncoveredCandidate.operations[9]!.parameters = [];
    expect(() => validateInteractionCatalog(uncovered, blenderActionCatalog)).toThrow(
      'menu candidate leaves action arguments unmapped: smooth',
    );

    const evidenceMismatch = structuredClone(blenderInteractionCatalog);
    const evidenceCandidate = recipeFor(evidenceMismatch, 'blender.mesh.edit_subdivide')
      .procedureMaterialization?.menuCandidate;
    if (evidenceCandidate === undefined) throw new Error('Expected menu candidate');
    evidenceCandidate.nativeEvidence = {
      kind: 'bounded_blender_ui_probe',
      executorId: 'blender.mesh_edit_subdivide_menu.event_simulate.v1',
      hostVersions: ['4.5.3', '5.1.1'],
      managedActionExecuted: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      operationIds: evidenceCandidate.operations.slice(1).map(({ id }) => id),
      nativeUndoCheckpointRequired: true,
      nativeUndoDepth: 1,
      nativeRedoDepth: 1,
    };
    expect(() => validateInteractionCatalog(evidenceMismatch, blenderActionCatalog)).toThrow(
      'native evidence must bind every ordered operation exactly',
    );
  });

  it('validates a complete Cone segment-frame derivation', () => {
    const catalog = structuredClone(blenderInteractionCatalog);
    const menu = installConeSegmentFrame(catalog);

    expect(() => validateInteractionCatalog(catalog, blenderActionCatalog)).not.toThrow();
    expect(interactionCatalogSchema.parse(catalog)).toMatchObject({
      recipes: expect.arrayContaining([
        expect.objectContaining({
          actionName: 'blender.mesh.create_cone',
          procedureMaterialization: expect.objectContaining({
            menu: expect.objectContaining({
              operatorParameters: expect.arrayContaining([
                expect.objectContaining({
                  source: {
                    kind: 'derived_action_arguments',
                    derivation: 'segment_frame',
                    startArgumentName: 'start',
                    endArgumentName: 'end',
                    output: 'distance',
                  },
                }),
              ]),
            }),
          }),
        }),
      ]),
    });
    expect(menu.availability).toBe('available');
  });

  it('fails closed for invalid Cone segment-frame derivations', () => {
    const sameEndpoint = structuredClone(blenderInteractionCatalog);
    const sameEndpointSource = installConeSegmentFrame(sameEndpoint).operatorParameters[2]!.source;
    if (sameEndpointSource.kind !== 'derived_action_arguments')
      throw new Error('Expected derivation');
    sameEndpointSource.endArgumentName = 'start';
    expect(() => validateInteractionCatalog(sameEndpoint, blenderActionCatalog)).toThrow(
      'requires distinct start and end action arguments',
    );

    const unknownEndpoint = structuredClone(blenderInteractionCatalog);
    const unknownEndpointSource =
      installConeSegmentFrame(unknownEndpoint).operatorParameters[2]!.source;
    if (unknownEndpointSource.kind !== 'derived_action_arguments')
      throw new Error('Expected derivation');
    unknownEndpointSource.startArgumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownEndpoint, blenderActionCatalog)).toThrow(
      'references unknown action argument missing',
    );

    const nonVectorEndpoint = structuredClone(blenderInteractionCatalog);
    const nonVectorSource =
      installConeSegmentFrame(nonVectorEndpoint).operatorParameters[2]!.source;
    if (nonVectorSource.kind !== 'derived_action_arguments') throw new Error('Expected derivation');
    nonVectorSource.startArgumentName = 'radiusStart';
    expect(() => validateInteractionCatalog(nonVectorEndpoint, blenderActionCatalog)).toThrow(
      'requires fixed three-item numeric array action argument radiusStart',
    );

    const missingOutput = structuredClone(blenderInteractionCatalog);
    const missingOutputMenu = installConeSegmentFrame(missingOutput);
    missingOutputMenu.controlOperations.operations[0]!.parameters[0]!.source = {
      kind: 'literal',
      value: [0, 0, 0],
    };
    expect(() => validateInteractionCatalog(missingOutput, blenderActionCatalog)).toThrow(
      'must map segment_frame outputs distance, midpoint, and rotation_euler_xyz_align_z exactly once; missing: midpoint',
    );

    const duplicateOutput = structuredClone(blenderInteractionCatalog);
    const duplicateOutputSource =
      installConeSegmentFrame(duplicateOutput).controlOperations.operations[1]!.parameters[0]!
        .source;
    if (duplicateOutputSource.kind !== 'derived_action_arguments')
      throw new Error('Expected derivation');
    duplicateOutputSource.output = 'midpoint';
    expect(() => validateInteractionCatalog(duplicateOutput, blenderActionCatalog)).toThrow(
      'maps segment_frame output midpoint more than once',
    );

    const directlyMappedEndpoint = structuredClone(blenderInteractionCatalog);
    installConeSegmentFrame(directlyMappedEndpoint).operatorParameters.push({
      name: 'start',
      source: { kind: 'action_argument', argumentName: 'start', transform: 'identity' },
    });
    expect(() => validateInteractionCatalog(directlyMappedEndpoint, blenderActionCatalog)).toThrow(
      'action argument start cannot be both directly mapped and used in a segment_frame derivation',
    );

    const omittedEndpoint = structuredClone(blenderInteractionCatalog);
    installConeSegmentFrame(omittedEndpoint).omittedActionArguments.push({
      argumentName: 'end',
      reason: 'Invalid overlap.',
    });
    expect(() => validateInteractionCatalog(omittedEndpoint, blenderActionCatalog)).toThrow(
      'action argument end cannot be both mapped and omitted',
    );

    const reversedPair = structuredClone(blenderInteractionCatalog);
    const reversedSource =
      installConeSegmentFrame(reversedPair).controlOperations.operations[0]!.parameters[0]!.source;
    if (reversedSource.kind !== 'derived_action_arguments') throw new Error('Expected derivation');
    reversedSource.startArgumentName = 'end';
    reversedSource.endArgumentName = 'start';
    expect(() => validateInteractionCatalog(reversedPair, blenderActionCatalog)).toThrow(
      'action argument end cannot participate in multiple segment_frame pairs',
    );
  });

  it('emits a strict language-neutral JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/interaction-catalog.schema.json'), 'utf8'),
    ) as { additionalProperties?: boolean };
    expect(schema.additionalProperties).toBe(false);
  });

  it('authorizes native menu-control proof only for the exact UV Sphere recipe and operations', async () => {
    const menu = orderedMenu(blenderInteractionCatalog);
    expect(menu.proofExecution?.operationIds).toEqual([
      'workspace.layout',
      'menu.add',
      'menu.mesh',
      'operator.uv_sphere',
      ...menu.controlOperations.operations.map(({ id }) => id),
    ]);
    expect(menu.proofExecution).toMatchObject({
      executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      targetProfile: 'factory_layout_three_object_ui_scale_2',
      managedActionExecuted: false,
      managedReceiptCreated: false,
      osHidInput: false,
      nativeUndoDepth: 8,
      uiScale: 2,
      proofArguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    });

    const foreign = structuredClone(blenderInteractionCatalog);
    const cubeMenu = recipeFor(foreign, 'blender.mesh.create_cube').procedureMaterialization?.menu;
    if (
      cubeMenu?.availability !== 'available' ||
      cubeMenu.parameterBinding !== 'ordered_parameter_operations'
    ) {
      throw new Error('Expected Cube ordered menu');
    }
    cubeMenu.proofExecution = menu.proofExecution;
    expect(() => validateInteractionCatalog(foreign, blenderActionCatalog)).toThrow(
      'restricted to the exact UV Sphere recipe',
    );

    const mismatched = structuredClone(blenderInteractionCatalog);
    orderedMenu(mismatched).controlOperations.operations[2]!.target.hostId = 'OUTLINER.object.name';
    expect(() => validateInteractionCatalog(mismatched, blenderActionCatalog)).toThrow(
      'requires the exact ordered UI controls',
    );

    const reversedHosts = structuredClone(blenderInteractionCatalog);
    orderedMenu(reversedHosts).proofExecution!.hostVersions = ['5.1.1', '4.5.3'];
    const duplicateHosts = structuredClone(blenderInteractionCatalog);
    orderedMenu(duplicateHosts).proofExecution!.hostVersions = ['5.1.1', '5.1.1'];
    const reorderedOperationIds = structuredClone(blenderInteractionCatalog);
    const reorderedIds = orderedMenu(reorderedOperationIds).proofExecution!.operationIds;
    [reorderedIds[0], reorderedIds[1]] = [reorderedIds[1]!, reorderedIds[0]!];
    const duplicateOperationIds = structuredClone(blenderInteractionCatalog);
    const duplicateIds = orderedMenu(duplicateOperationIds).proofExecution!.operationIds;
    duplicateIds[1] = duplicateIds[0]!;
    const reorderedLocation = structuredClone(blenderInteractionCatalog);
    const reorderedCoordinates =
      orderedMenu(reorderedLocation).proofExecution!.proofArguments.location;
    [reorderedCoordinates[0], reorderedCoordinates[1]] = [
      reorderedCoordinates[1]!,
      reorderedCoordinates[0]!,
    ];
    const duplicateLocation = structuredClone(blenderInteractionCatalog);
    const duplicateCoordinates =
      orderedMenu(duplicateLocation).proofExecution!.proofArguments.location;
    duplicateCoordinates[1] = duplicateCoordinates[0]!;

    const exactArrayForgeries = [
      reversedHosts,
      duplicateHosts,
      reorderedOperationIds,
      duplicateOperationIds,
      reorderedLocation,
      duplicateLocation,
    ];
    for (const forged of exactArrayForgeries) {
      expect(interactionCatalogSchema.safeParse(forged).success).toBe(false);
    }
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(resolve('protocol/schemas/v1/interaction-catalog.schema.json'), 'utf8'),
      ) as object,
      [
        { value: blenderInteractionCatalog, accepted: true },
        ...exactArrayForgeries.map((value) => ({ value, accepted: false as const })),
        { value: foreign, accepted: false },
        { value: mismatched, accepted: false },
      ],
    );
  });

  it('authorizes native shortcut proof execution only through the exact catalog declaration', async () => {
    const recipe = blenderInteractionCatalog.recipes.find(
      (candidate) => candidate.actionName === 'blender.modifier.add_subdivision_surface',
    );
    const shortcut = recipe?.procedureMaterialization?.shortcut;
    if (shortcut?.availability !== 'available') throw new Error('Expected shortcut');
    expect(shortcut.projection).toBe('candidate_only');
    expect(shortcut.proofExecution?.operationIds).toEqual(shortcut.operations.map(({ id }) => id));
    expect(shortcut.proofExecution).toMatchObject({
      executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
      targetProfile: 'factory_cube_8_12_6',
      executionBoundary: 'blender_window_event_simulate',
      authorization: 'accepted_replay_next_step',
      transport: 'event_simulate',
      hostVersions: ['4.5.3', '5.1.1'],
      strongObservationKind: 'subdivision_surface_shortcut_ready',
      nativeUndoCheckpointRequired: true,
    });

    const wrongRecipe = structuredClone(blenderInteractionCatalog);
    const cube = wrongRecipe.recipes.find(
      (candidate) => candidate.actionName === 'blender.mesh.create_cube',
    );
    if (cube?.procedureMaterialization?.shortcut.availability !== 'available') {
      throw new Error('Expected Cube shortcut');
    }
    cube.procedureMaterialization.shortcut.proofExecution = shortcut.proofExecution;
    expect(() => validateInteractionCatalog(wrongRecipe, blenderActionCatalog)).toThrow(
      'restricted to the exact Subdivision Surface recipe',
    );

    const subdivideRecipe = blenderInteractionCatalog.recipes.find(
      (candidate) => candidate.actionName === 'blender.mesh.edit_subdivide',
    );
    const subdivideShortcut = subdivideRecipe?.procedureMaterialization?.shortcut;
    if (subdivideShortcut?.availability !== 'available') {
      throw new Error('Expected Edit Subdivide shortcut');
    }
    expect(subdivideShortcut.projection).toBe('candidate_only');
    expect(subdivideShortcut.proofExecution?.operationIds).toEqual(
      subdivideShortcut.operations.map(({ id }) => id),
    );
    expect(subdivideShortcut.proofExecution).toMatchObject({
      executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
      targetProfile: 'factory_cube_single_user_mesh_8_12_6',
      executionBoundary: 'blender_window_event_simulate',
      osHidInput: false,
      managedActionExecuted: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      hostVersions: ['4.5.3', '5.1.1'],
      strongObservationKind: 'mesh_edit_subdivide_shortcut_ready',
      nativeUndoCheckpointRequired: true,
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
    });
    expect(subdivideRecipe?.procedureMaterialization?.mcp.availability).toBe('available');

    const crossedProfile = structuredClone(blenderInteractionCatalog);
    const crossedShortcut = recipeFor(crossedProfile, 'blender.mesh.edit_subdivide')
      .procedureMaterialization?.shortcut;
    if (
      crossedShortcut?.availability !== 'available' ||
      crossedShortcut.proofExecution === undefined
    ) {
      throw new Error('Expected Edit Subdivide proof');
    }
    Object.assign(crossedShortcut.proofExecution, { targetProfile: 'factory_cube_8_12_6' });
    expect(interactionCatalogSchema.safeParse(crossedProfile).success).toBe(false);
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(resolve('protocol/schemas/v1/interaction-catalog.schema.json'), 'utf8'),
      ) as object,
      [
        { value: blenderInteractionCatalog, accepted: true },
        { value: crossedProfile, accepted: false },
      ],
    );

    const weakenedPreconditions = structuredClone(blenderInteractionCatalog);
    const weakenedShortcut = recipeFor(weakenedPreconditions, 'blender.mesh.edit_subdivide')
      .procedureMaterialization?.shortcut;
    if (weakenedShortcut?.availability !== 'available') {
      throw new Error('Expected Edit Subdivide shortcut');
    }
    weakenedShortcut.preconditions = weakenedShortcut.preconditions.filter(
      ({ label }) => label !== 'Shape Keys',
    );
    expect(() => validateInteractionCatalog(weakenedPreconditions, blenderActionCatalog)).toThrow(
      'requires the exact factory Cube preconditions',
    );
  });

  it('validates ordered shortcut mappings independently from menu mappings', () => {
    const catalog = structuredClone(blenderInteractionCatalog);
    const shortcut = installOrderedShortcut(catalog);
    expect(() => validateInteractionCatalog(catalog, blenderActionCatalog)).not.toThrow();
    expect(shortcut.operations.map((operation) => operation.keyMode)).toEqual([
      'chord',
      'sequence',
      'sequence',
      'sequence',
      'sequence',
    ]);

    const missingPrecondition = structuredClone(catalog);
    const missingPreconditionShortcut = installOrderedShortcut(missingPrecondition);
    missingPreconditionShortcut.preconditions = missingPreconditionShortcut.preconditions.filter(
      (precondition) => precondition.kind !== 'scene_state',
    );
    expect(() => validateInteractionCatalog(missingPrecondition, blenderActionCatalog)).toThrow(
      'shortcut is missing required preconditions: scene_state',
    );

    const duplicateSingletonPrecondition = structuredClone(catalog);
    installOrderedShortcut(duplicateSingletonPrecondition).preconditions.push({
      kind: 'workspace',
      label: 'Alternate workspace',
      value: 'Modeling',
    });
    expect(() =>
      validateInteractionCatalog(duplicateSingletonPrecondition, blenderActionCatalog),
    ).toThrow('shortcut must declare exactly one precondition for: workspace');

    const duplicateLabeledPrecondition = structuredClone(catalog);
    const duplicateLabeledShortcut = installOrderedShortcut(duplicateLabeledPrecondition);
    duplicateLabeledShortcut.preconditions.push(
      structuredClone(
        duplicateLabeledShortcut.preconditions.find(
          (precondition) => precondition.kind === 'scene_state',
        )!,
      ),
    );
    expect(() =>
      validateInteractionCatalog(duplicateLabeledPrecondition, blenderActionCatalog),
    ).toThrow('shortcut contains duplicate precondition scene_state:Cursor');

    const incompleteComponents = structuredClone(catalog);
    const incompleteShortcut = installOrderedShortcut(incompleteComponents);
    incompleteShortcut.operations.splice(3, 1);
    expect(() => validateInteractionCatalog(incompleteComponents, blenderActionCatalog)).toThrow(
      'must map vector3 components x, y, and z exactly once; missing: z',
    );

    const duplicateComponent = structuredClone(catalog);
    const duplicateSource =
      installOrderedShortcut(duplicateComponent).operations[3]!.parameters[0]!.source;
    if (duplicateSource.kind !== 'action_argument') throw new Error('Expected action argument');
    duplicateSource.transform = 'vector3_x';
    expect(() => validateInteractionCatalog(duplicateComponent, blenderActionCatalog)).toThrow(
      'maps action argument location vector3_x more than once',
    );

    const mixedWholeAndComponents = structuredClone(catalog);
    const mixedSource =
      installOrderedShortcut(mixedWholeAndComponents).operations[3]!.parameters[0]!.source;
    if (mixedSource.kind !== 'action_argument') throw new Error('Expected action argument');
    mixedSource.transform = 'identity';
    expect(() => validateInteractionCatalog(mixedWholeAndComponents, blenderActionCatalog)).toThrow(
      'cannot mix whole-value and vector3 component mappings',
    );

    const nonVectorArgument = structuredClone(catalog);
    const nonVectorSource =
      installOrderedShortcut(nonVectorArgument).operations[0]!.parameters[0]!.source;
    if (nonVectorSource.kind !== 'action_argument') throw new Error('Expected action argument');
    nonVectorSource.transform = 'vector3_x';
    expect(() => validateInteractionCatalog(nonVectorArgument, blenderActionCatalog)).toThrow(
      'requires fixed three-item numeric array action argument radius',
    );

    const duplicateOperation = structuredClone(catalog);
    const duplicateOperationShortcut = installOrderedShortcut(duplicateOperation);
    duplicateOperationShortcut.operations[1]!.id = duplicateOperationShortcut.operations[0]!.id;
    expect(() => validateInteractionCatalog(duplicateOperation, blenderActionCatalog)).toThrow(
      'shortcut contains duplicate operation id shortcut.add_sphere',
    );

    const duplicateShortcutParameter = structuredClone(catalog);
    const duplicateShortcutParameterOperation = installOrderedShortcut(duplicateShortcutParameter)
      .operations[0]!;
    duplicateShortcutParameterOperation.parameters.push(
      structuredClone(duplicateShortcutParameterOperation.parameters[0]!),
    );
    expect(() =>
      validateInteractionCatalog(duplicateShortcutParameter, blenderActionCatalog),
    ).toThrow('shortcut operation shortcut.add_sphere contains duplicate parameter radius');

    const mappedAndOmitted = structuredClone(catalog);
    installOrderedShortcut(mappedAndOmitted).omittedActionArguments.push({
      argumentName: 'radius',
      reason: 'Invalid overlap.',
    });
    expect(() => validateInteractionCatalog(mappedAndOmitted, blenderActionCatalog)).toThrow(
      'action argument radius cannot be both mapped and omitted',
    );

    const unknownOmission = structuredClone(catalog);
    installOrderedShortcut(unknownOmission).omittedActionArguments[0]!.argumentName = 'missing';
    expect(() => validateInteractionCatalog(unknownOmission, blenderActionCatalog)).toThrow(
      'omits unknown action argument missing',
    );

    const duplicateOmission = structuredClone(catalog);
    const duplicateOmissionShortcut = installOrderedShortcut(duplicateOmission);
    duplicateOmissionShortcut.omittedActionArguments.push(
      structuredClone(duplicateOmissionShortcut.omittedActionArguments[0]!),
    );
    expect(() => validateInteractionCatalog(duplicateOmission, blenderActionCatalog)).toThrow(
      'omits action argument resourceId more than once',
    );

    const uncoveredArgument = structuredClone(catalog);
    installOrderedShortcut(uncoveredArgument).omittedActionArguments = [];
    expect(() => validateInteractionCatalog(uncoveredArgument, blenderActionCatalog)).toThrow(
      'leaves action arguments unmapped: resourceId',
    );
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

    const emptyShortcutParameters = structuredClone(blenderInteractionCatalog);
    installOrderedShortcut(emptyShortcutParameters).operations[0]!.parameters = [];
    const emptySelectionPath = structuredClone(blenderInteractionCatalog);
    installOrderedShortcut(emptySelectionPath).operations[0]!.selectionPath = [];
    const missingKeyMode = structuredClone(blenderInteractionCatalog) as unknown as Record<
      string,
      unknown
    >;
    const missingKeyModeRecipes = missingKeyMode['recipes'] as Array<Record<string, unknown>>;
    const missingKeyModeMaterialization = missingKeyModeRecipes[0]![
      'procedureMaterialization'
    ] as Record<string, unknown>;
    const missingKeyModeShortcut = missingKeyModeMaterialization['shortcut'] as Record<
      string,
      unknown
    >;
    const missingKeyModeOperations = missingKeyModeShortcut['operations'] as Array<
      Record<string, unknown>
    >;
    delete missingKeyModeOperations[0]!['keyMode'];

    const cases = [
      { value: blenderInteractionCatalog, accepted: true },
      { value: frozen, accepted: true },
      {
        value: (() => {
          const catalog = structuredClone(blenderInteractionCatalog);
          installOrderedShortcut(catalog);
          return catalog;
        })(),
        accepted: true,
      },
      { value: emptyControls, accepted: false },
      { value: emptyParameters, accepted: false },
      { value: emptyShortcutParameters, accepted: false },
      { value: emptySelectionPath, accepted: false },
      { value: missingKeyMode, accepted: false },
      { value: extraField, accepted: false },
      {
        value: (() => {
          const catalog = structuredClone(blenderInteractionCatalog);
          const source =
            mutableOrderedMenu(catalog).controlOperations.operations[0]!.parameters[0]!.source;
          if (source.kind !== 'action_argument')
            throw new Error('Expected action argument fixture');
          source.transform = 'divide_by_two';
          return catalog;
        })(),
        accepted: true,
      },
      {
        value: (() => {
          const catalog = structuredClone(blenderInteractionCatalog) as unknown as Record<
            string,
            unknown
          >;
          const recipes = catalog['recipes'] as Array<Record<string, unknown>>;
          const materialization = recipes[0]!['procedureMaterialization'] as Record<
            string,
            unknown
          >;
          const menu = materialization['menu'] as Record<string, unknown>;
          const operations = (menu['controlOperations'] as Record<string, unknown>)[
            'operations'
          ] as Array<Record<string, unknown>>;
          const parameters = operations[0]!['parameters'] as Array<Record<string, unknown>>;
          const source = parameters[0]!['source'] as Record<string, unknown>;
          source['transform'] = 'divide_by_three';
          return catalog;
        })(),
        accepted: false,
      },
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

  it('rejects unsafe or tampered semantic projection declarations', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const unsafe = structuredClone(blenderInteractionCatalog) as unknown as Record<
        string,
        unknown
      >;
      const recipes = unsafe['recipes'] as Array<Record<string, unknown>>;
      const materialization = recipes[0]!['procedureMaterialization'] as Record<string, unknown>;
      const semantic = materialization['semantic'] as Record<string, unknown>;
      const projections = semantic['projections'] as Array<Record<string, unknown>>;
      projections[0]!['path'] = [{ kind: 'field', name }];
      expect(interactionCatalogSchema.safeParse(unsafe).success).toBe(false);
    }

    const duplicateTarget = structuredClone(blenderInteractionCatalog);
    const duplicateSemantic = duplicateTarget.recipes[0]!.procedureMaterialization?.semantic;
    if (duplicateSemantic === undefined) throw new Error('Expected semantic projection fixture');
    const duplicate = structuredClone(duplicateSemantic.projections[0]!);
    duplicate.id = 'projection.semantic.duplicate_target';
    duplicateSemantic.projections.push(duplicate);
    expect(() => validateInteractionCatalog(duplicateTarget, blenderActionCatalog)).toThrow(
      'repeats semantic parameter target',
    );

    const overlappingTarget = structuredClone(blenderInteractionCatalog);
    const overlapSemantic = overlappingTarget.recipes[0]!.procedureMaterialization?.semantic;
    if (overlapSemantic === undefined) throw new Error('Expected semantic projection fixture');
    const child = structuredClone(overlapSemantic.projections[0]!);
    child.id = 'projection.semantic.overlapping_target';
    child.path = [...child.path, { kind: 'index', index: 0 }];
    overlapSemantic.projections.push(child);
    expect(() => validateInteractionCatalog(overlappingTarget, blenderActionCatalog)).toThrow(
      'overlaps semantic parameter target',
    );

    const invalidTransform = structuredClone(blenderInteractionCatalog);
    const invalidSemantic = invalidTransform.recipes[0]!.procedureMaterialization?.semantic;
    if (invalidSemantic === undefined) throw new Error('Expected semantic projection fixture');
    const scale = invalidSemantic.projections.find(
      (projection) => projection.actionArgument === 'radius',
    );
    if (scale === undefined) throw new Error('Expected radius semantic projection');
    scale.transform = 'vector3_x';
    expect(() => validateInteractionCatalog(invalidTransform, blenderActionCatalog)).toThrow(
      'vector3_x requires fixed three-item numeric array action argument radius',
    );

    const invalidIdentityCatalog = structuredClone(blenderActionCatalog);
    const sphereAction = invalidIdentityCatalog.actions.find(
      (action) => action.name === 'blender.mesh.create_uv_sphere',
    );
    if (sphereAction === undefined) throw new Error('Expected UV Sphere action fixture');
    sphereAction.argumentsSchema.properties['objectName'] = {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 1,
    };
    expect(() =>
      validateInteractionCatalog(blenderInteractionCatalog, invalidIdentityCatalog),
    ).toThrow(
      'semantic identity projection requires a scalar or one-to-four-item numeric array action argument objectName',
    );

    const mappedAndOmitted = structuredClone(blenderInteractionCatalog);
    const overlappingSemantic = mappedAndOmitted.recipes[0]!.procedureMaterialization?.semantic;
    if (overlappingSemantic === undefined) throw new Error('Expected semantic projection fixture');
    overlappingSemantic.omittedActionArguments.push({
      argumentName: 'radius',
      reason: 'Tampered overlap.',
    });
    expect(() => validateInteractionCatalog(mappedAndOmitted, blenderActionCatalog)).toThrow(
      'action argument radius cannot be both mapped and omitted',
    );
  });
});
