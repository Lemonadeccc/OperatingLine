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
  it('covers every Blender action with a native path or explicit semantic fallback', () => {
    const catalog = interactionCatalogSchema.parse(blenderInteractionCatalog);

    expect(catalog.catalogVersion).toBe('1.31.0');
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
    ).toHaveLength(20);
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
    ]);
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
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
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
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
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
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
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
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
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
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
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
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
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
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
    const subdivide = recipeFor(catalog, 'blender.mesh.edit_subdivide');
    expect(subdivide.guidance.kind).toBe('semantic_path');
    expect(subdivide.procedureMaterialization).toMatchObject({
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
      mcp: { availability: 'unavailable' },
    });
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
        value: 'Exactly one accepted target Mesh object is active and selected',
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
      mcp: { availability: 'unavailable' },
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
      mcp: { availability: 'unavailable' },
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
      mcp: { availability: 'unavailable' },
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
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
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
      'blender.mesh.edit_bevel_edges',
      'blender.mesh.edit_inset_faces',
      'blender.mesh.edit_poke_faces',
      'blender.modifier.add_subdivision_surface',
      'blender.modifier.add_mirror',
    ]);
    expect(
      catalog.recipes.filter((recipe) => !materializedActionNames.has(recipe.actionName)),
    ).toSatisfy((recipes) =>
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

    const invalidHalvedValue = structuredClone(blenderInteractionCatalog);
    const invalidHalvedSource =
      orderedMenu(invalidHalvedValue).controlOperations.operations[0]!.parameters[0]!.source;
    if (invalidHalvedSource.kind !== 'action_argument')
      throw new Error('Expected action argument fixture');
    invalidHalvedSource.transform = 'divide_by_two';
    expect(() => validateInteractionCatalog(invalidHalvedValue, blenderActionCatalog)).toThrow(
      'divide_by_two requires numeric action argument location',
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
            orderedMenu(catalog).controlOperations.operations[0]!.parameters[0]!.source;
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
});
