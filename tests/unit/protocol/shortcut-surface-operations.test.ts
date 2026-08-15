import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  compileProcedureTreeToGuidePlan,
  interactionCatalogSchema,
  parseProcedureTree,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureTreeSchema,
  validateInteractionCatalog,
  validateProcedureTree,
  type InteractionCatalog,
  type ProcedureTree,
} from '@operatingline/protocol';
import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

function installExtendedIcosphereShortcut(catalog: InteractionCatalog) {
  const recipe = catalog.recipes.find(
    (candidate) => candidate.actionName === 'blender.mesh.create_icosphere',
  );
  if (recipe?.procedureMaterialization === undefined) {
    throw new Error('Expected Icosphere materialization fixture');
  }
  recipe.procedureMaterialization.shortcut = {
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
        kind: 'key_input',
        id: 'shortcut.add_icosphere',
        label: 'Add Icosphere',
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'Ico Sphere'],
        parameters: [{ name: 'location', source: { kind: 'literal', value: [0, 0, 0] } }],
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last',
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
      ...(['subdivisions', 'radius'] as const).map((argumentName) => ({
        kind: 'operator_property_update' as const,
        id: `shortcut.set_${argumentName}`,
        label: `Set ${argumentName}`,
        surfaceOperationId: 'shortcut.open_adjust_last',
        target: {
          kind: 'control' as const,
          hostId: `mesh.primitive_ico_sphere_add.${argumentName}`,
        },
        path: ['Adjust Last Operation', argumentName],
        parameters: [
          {
            name: 'value',
            source: {
              kind: 'action_argument' as const,
              argumentName,
              transform: 'identity' as const,
            },
          },
        ],
      })),
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last',
        label: 'Confirm Adjust Last Operation',
        keyMode: 'sequence',
        keys: ['ENTER'],
        parameters: [],
        closesSurfaceOperationId: 'shortcut.open_adjust_last',
      },
      ...(['x', 'y', 'z'] as const).map((component) => ({
        kind: 'key_input' as const,
        id: `shortcut.move_${component}`,
        label: `Move ${component}`,
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
          { name: 'confirm', source: { kind: 'literal' as const, value: 'ENTER' } },
        ],
      })),
      {
        kind: 'key_input',
        id: 'shortcut.rename',
        label: 'Rename',
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
    ],
    omittedActionArguments: [
      { argumentName: 'resourceId', reason: 'The logical id is not entered in Blender.' },
    ],
  };
  return recipe.procedureMaterialization.shortcut;
}

function extendedCatalog(): InteractionCatalog {
  const catalog = structuredClone(blenderInteractionCatalog);
  installExtendedIcosphereShortcut(catalog);
  return interactionCatalogSchema.parse(catalog);
}

function extendedTree(): ProcedureTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['formatVersion'] = '1.1.0';
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  )!;
  const track = (leaf['shortcutTracks'] as Array<Record<string, unknown>>)[0]!;
  const legacyOperations = track['operations'] as Array<Record<string, unknown>>;
  const normalized = legacyOperations.map((operation) => ({ ...operation, kind: 'key_input' }));
  normalized.splice(
    1,
    0,
    {
      kind: 'key_input',
      id: 'shortcut.open_adjust_last',
      order: 2,
      semanticRefs: ['semantic.create'],
      description: 'Open Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keyMode: 'sequence',
      keys: ['F9'],
      parameters: {},
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: normalized[0]!['id'],
        expectedOperatorId: 'mesh.primitive_uv_sphere_add',
      },
    },
    {
      kind: 'operator_property_update',
      id: 'shortcut.set_radius',
      order: 3,
      semanticRefs: ['semantic.create'],
      description: 'Set Radius.',
      evidenceRefs: ['evidence.prompt'],
      surfaceOperationId: 'shortcut.open_adjust_last',
      target: { kind: 'control', hostId: 'mesh.primitive_uv_sphere_add.radius' },
      path: ['Adjust Last Operation', 'Radius'],
      parameters: { value: 0.12 },
    },
    {
      kind: 'key_input',
      id: 'shortcut.close_adjust_last',
      order: 4,
      semanticRefs: ['semantic.create'],
      description: 'Confirm Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keyMode: 'sequence',
      keys: ['ENTER'],
      parameters: {},
      closesSurfaceOperationId: 'shortcut.open_adjust_last',
    },
  );
  normalized.forEach((operation, index) => {
    operation['order'] = index + 1;
  });
  track['operations'] = normalized;
  return parseProcedureTree(tree);
}

function authoringCandidate(catalog: InteractionCatalog, useIcosphere: boolean) {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = catalog.catalogVersion;
  tree['hostVersionRange'] = catalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    if (useIcosphere) {
      node['action'] = {
        adapterId: 'blender',
        name: 'blender.mesh.create_icosphere',
        arguments: {
          resourceId: 'test.icosphere',
          objectName: 'OperatingLine.TestIcosphere',
          subdivisions: 3,
          radius: 1.75,
          location: [-1.25, 2.5, 0.75],
        },
      };
    }
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.pending`,
        availability: 'unavailable',
        title: 'Pending',
        reason: 'Pending materialization.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.pending`,
        availability: 'unavailable',
        title: 'Pending',
        reason: 'Pending materialization.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.pending`,
        availability: 'unavailable',
        title: 'Pending',
        reason: 'Pending materialization.',
        modality: 'mcp',
      },
    ];
    (node['validation'] as Record<string, unknown>)['status'] = 'candidate';
    (node['validation'] as Record<string, unknown>)['validatedHostVersions'] = [];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

describe('shortcut-led operator property protocol', () => {
  it('accepts a closed F9 property surface while preserving legacy catalog operations', () => {
    expect(() => validateInteractionCatalog(extendedCatalog(), blenderActionCatalog)).not.toThrow();
    expect(() =>
      validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog),
    ).not.toThrow();
  });

  it('fails closed for broken surface references, lifecycle, and duplicate bindings', () => {
    const missingClose = extendedCatalog();
    const missingCloseShortcut = installExtendedIcosphereShortcut(missingClose);
    if (missingCloseShortcut.availability !== 'available') throw new Error('Expected shortcut');
    missingCloseShortcut.operations = missingCloseShortcut.operations.filter(
      (operation) => operation.id !== 'shortcut.close_adjust_last',
    );
    expect(() => validateInteractionCatalog(missingClose, blenderActionCatalog)).toThrow(
      'requires contiguous property updates and an explicit close',
    );

    const wrongOperator = extendedCatalog();
    const wrongOperatorShortcut = installExtendedIcosphereShortcut(wrongOperator);
    if (wrongOperatorShortcut.availability !== 'available') throw new Error('Expected shortcut');
    const opener = wrongOperatorShortcut.operations.find(
      (operation) => 'kind' in operation && operation.opensSurface !== undefined,
    );
    if (opener === undefined || !('kind' in opener) || opener.kind !== 'key_input') {
      throw new Error('Expected opener');
    }
    opener.opensSurface!.expectedOperatorId = 'mesh.wrong_operator';
    expect(() => validateInteractionCatalog(wrongOperator, blenderActionCatalog)).toThrow(
      'must bind the guidance execution operator',
    );

    const duplicate = extendedCatalog();
    const duplicateShortcut = installExtendedIcosphereShortcut(duplicate);
    if (duplicateShortcut.availability !== 'available') throw new Error('Expected shortcut');
    const properties = duplicateShortcut.operations.filter(
      (operation) => 'kind' in operation && operation.kind === 'operator_property_update',
    );
    if (properties.length !== 2 || !('target' in properties[1]!)) throw new Error('Expected props');
    properties[1]!.target.hostId = properties[0]!.target.hostId;
    expect(() => validateInteractionCatalog(duplicate, blenderActionCatalog)).toThrow(
      'repeats property target',
    );

    const foreignOperator = extendedCatalog();
    const foreignShortcut = installExtendedIcosphereShortcut(foreignOperator);
    if (foreignShortcut.availability !== 'available') throw new Error('Expected shortcut');
    const foreignProperty = foreignShortcut.operations.find(
      (operation) => 'kind' in operation && operation.kind === 'operator_property_update',
    );
    if (
      foreignProperty === undefined ||
      !('kind' in foreignProperty) ||
      foreignProperty.kind !== 'operator_property_update'
    ) {
      throw new Error('Expected property');
    }
    foreignProperty.target.hostId = 'mesh.primitive_cube_add.size';
    expect(() => validateInteractionCatalog(foreignOperator, blenderActionCatalog)).toThrow(
      'is outside operator mesh.primitive_ico_sphere_add',
    );
  });

  it('accepts ProcedureTree 1.1 only for a normalized, closed extended shortcut track', () => {
    const tree = extendedTree();
    expect(tree.formatVersion).toBe('1.1.0');

    const legacyVersion = structuredClone(tree);
    legacyVersion.formatVersion = '1.0.0';
    expect(() => validateProcedureTree(legacyVersion)).toThrow(
      'format 1.0.0 cannot contain extended shortcut operations',
    );

    const unnormalized = structuredClone(tree);
    const leaf = unnormalized.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const track = leaf.shortcutTracks[0];
    if (track?.availability !== 'available') throw new Error('Expected track');
    delete (track.operations.at(-1)! as { kind?: string }).kind;
    expect(() => validateProcedureTree(unnormalized)).toThrow(
      'requires normalized key_input shortcut operations',
    );

    const emptyPropertySuffix = structuredClone(tree);
    const suffixLeaf = emptyPropertySuffix.nodes.find((node) => node.kind === 'leaf');
    if (suffixLeaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const suffixTrack = suffixLeaf.shortcutTracks[0];
    if (suffixTrack?.availability !== 'available') throw new Error('Expected track');
    const suffixProperty = suffixTrack.operations.find(
      (operation) => 'kind' in operation && operation.kind === 'operator_property_update',
    );
    if (
      suffixProperty === undefined ||
      !('kind' in suffixProperty) ||
      suffixProperty.kind !== 'operator_property_update'
    ) {
      throw new Error('Expected property');
    }
    suffixProperty.target.hostId = 'mesh.primitive_uv_sphere_add.';
    expect(() => validateProcedureTree(emptyPropertySuffix)).toThrow(
      'is outside operator mesh.primitive_uv_sphere_add',
    );
  });

  it('pairs ProcedureTree versions with shortcut operation shapes in Zod and AJV', async () => {
    const legacy = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
    ) as Record<string, unknown>;
    const extended = extendedTree();
    const typedLegacy = structuredClone(extended);
    typedLegacy.formatVersion = '1.0.0';
    const untypedExtended = structuredClone(legacy);
    untypedExtended['formatVersion'] = '1.1.0';
    const propertylessExtended = structuredClone(extended);
    const leaf = propertylessExtended.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const track = leaf.shortcutTracks[0];
    if (track?.availability !== 'available') throw new Error('Expected shortcut track');
    track.operations = track.operations.filter(
      (operation) => operation.kind !== 'operator_property_update',
    );

    const cases = [
      { value: legacy, accepted: true },
      { value: extended, accepted: true },
      { value: typedLegacy, accepted: false },
      { value: untypedExtended, accepted: false },
      { value: propertylessExtended, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureTreeSchema.safeParse(contractCase.value).success).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(publicSchema('procedure-tree.schema.json'), cases);
  });

  it('emits Result 1.3 and ProcedureTree 1.1 only when property operations are used', async () => {
    const catalog = extendedCatalog();
    const extended = materializeProcedureAuthoringCandidate(
      authoringCandidate(catalog, true),
      blenderActionCatalog,
      catalog,
    );
    expect(extended.formatVersion).toBe('1.3.0');
    expect(extended.tree.formatVersion).toBe('1.1.0');
    const extendedLeaf = extended.tree.nodes.find((node) => node.kind === 'leaf');
    if (extendedLeaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const track = extendedLeaf.shortcutTracks[0];
    if (track?.availability !== 'available') throw new Error('Expected shortcut track');
    expect(track.operations.every((operation) => 'kind' in operation)).toBe(true);
    expect(
      track.operations
        .filter((operation) => 'kind' in operation && operation.kind === 'operator_property_update')
        .map((operation) => operation.parameters),
    ).toEqual([{ value: 3 }, { value: 1.75 }]);

    const legacy = materializeProcedureAuthoringCandidate(
      authoringCandidate(blenderInteractionCatalog, false),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    expect(legacy.formatVersion).toBe('1.2.0');
    expect(legacy.tree.formatVersion).toBe('1.0.0');
    const legacyLeaf = legacy.tree.nodes.find((node) => node.kind === 'leaf');
    if (legacyLeaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const legacyTrack = legacyLeaf.shortcutTracks[0];
    if (legacyTrack?.availability !== 'available') throw new Error('Expected shortcut track');
    expect(legacyTrack.operations.some((operation) => 'kind' in operation)).toBe(false);

    const result13 = {
      formatVersion: '1.3.0',
      packetContentSha256: 'a'.repeat(64),
      inputTreeContentSha256: extended.inputTreeContentSha256,
      outputTreeContentSha256: extended.outputTreeContentSha256,
      catalogBinding: {
        adapterId: catalog.adapterId,
        actionCatalogVersion: catalog.actionCatalogVersion,
        interactionCatalogVersion: catalog.catalogVersion,
        interactionCatalogContentSha256: extended.interactionCatalogContentSha256,
      },
      coverage: extended.coverage,
      validation: {
        packetIntegrity: 'validated',
        installedCatalogBinding: 'validated',
        authoringCandidateContract: 'validated',
        procedureCompilation: 'validated',
        interactionGrounding: 'validated_against_installed_interaction_catalog',
      },
      tree: extended.tree,
      compilation: {
        formatVersion: extended.tree.formatVersion,
        procedureTreeId: extended.tree.id,
        procedureTreeRevision: extended.tree.revision,
        adapterId: extended.tree.adapterId,
        actionCatalogVersion: extended.tree.actionCatalogVersion,
        interactionCatalogVersion: extended.tree.interactionCatalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: compileProcedureTreeToGuidePlan(extended.tree),
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;
    expect(procedureAuthoringMaterializationResultSchema.safeParse(result13).success).toBe(true);
    const mismatchedLegacyResult = { ...result13, formatVersion: '1.2.0' } as const;
    const propertylessResult = structuredClone(result13);
    const propertylessLeaf = propertylessResult.tree.nodes.find((node) => node.kind === 'leaf');
    if (propertylessLeaf?.kind !== 'leaf') throw new Error('Expected leaf');
    const propertylessTrack = propertylessLeaf.shortcutTracks[0];
    if (propertylessTrack?.availability !== 'available') throw new Error('Expected track');
    propertylessTrack.operations = propertylessTrack.operations.filter(
      (operation) => operation.kind !== 'operator_property_update',
    );
    const cases = [
      { value: result13, accepted: true },
      { value: mismatchedLegacyResult, accepted: false },
      { value: propertylessResult, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(
        procedureAuthoringMaterializationResultSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-materialization-result.schema.json'),
      cases,
    );
  });
});
