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

    expect(catalog.catalogVersion).toBe('1.18.0');
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
      '1.12.0',
      '1.13.0',
      '1.14.0',
      '1.15.0',
      '1.16.0',
      '1.17.0',
      '1.18.0',
    ]);
    expect(
      recipeFor(blenderInteractionCatalogs.at(-2)!, 'blender.mesh.create_cylinder')
        .procedureMaterialization,
    ).toBeUndefined();

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
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
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
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
      },
    });
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
      shortcut: {
        availability: 'unavailable',
        reason: 'No verified shortcut procedure is available.',
      },
      mcp: {
        availability: 'unavailable',
        reason: 'No approved action-level MCP tool is available.',
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
    const materializedActionNames = new Set([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
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
