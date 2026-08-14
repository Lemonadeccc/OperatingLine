import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringCandidateTreeSchema,
  type InteractionCatalog,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';

function candidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = interactionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged menu title',
        reason: 'Forged menu reason',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged shortcut title',
        reason: 'Forged shortcut reason',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged MCP title',
        reason: 'Forged MCP reason',
        modality: 'mcp',
      },
    ];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function icosphereCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Icosphere candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.create_icosphere',
    arguments: {
      resourceId: 'tutorial.icosphere.detail',
      objectName: 'OperatingLine.IcosphereDetail',
      subdivisions: 3,
      radius: 1.75,
      location: [-1.25, 2.5, 0.75],
    },
  };
  leaf.title = 'Create and configure one detailed Icosphere';
  leaf.intent = 'Create a named Icosphere with exact subdivisions, radius, and location.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_icosphere',
    description: 'Create one detailed Icosphere.',
    parameters: { subdivisions: 3, radius: 1.75 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place the Icosphere at its exact world location.',
    parameters: { location: [-1.25, 2.5, 0.75] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Icosphere object.',
    parameters: { name: 'OperatingLine.IcosphereDetail' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [-1.25, 2.5, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_ico_sphere_add',
      menuPath: ['Add', 'Mesh', 'Ico Sphere'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.icosphere.detail' },
  };
  return tree;
}

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

function orderedShortcut(catalog: InteractionCatalog) {
  const shortcut = catalog.recipes[0]!.procedureMaterialization?.shortcut;
  if (shortcut?.availability !== 'available') {
    throw new Error('Expected ordered shortcut operations fixture');
  }
  return shortcut;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

describe('procedure authoring materialization', () => {
  it('materializes the exact declared UV sphere native path and preserves candidate validation', () => {
    const input = candidate();
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    expect(result.formatVersion).toBe('1.2.0');
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    expect(leaf?.kind).toBe('leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');

    expect(leaf.validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: input.nodes.find((node) => node.kind === 'leaf')?.validation.notes,
    });
    expect(leaf.menuTracks).toHaveLength(1);
    expect(leaf.menuTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native',
      availability: 'available',
      title: 'Add one UV sphere from the 3D Viewport',
      modality: 'menu',
    });
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    expect(track.preconditions).toEqual(
      blenderInteractionCatalog.recipes[0]?.guidance.kind === 'native_path'
        ? blenderInteractionCatalog.recipes[0].guidance.preconditions
        : [],
    );
    expect(
      track.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.uv_sphere',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        parameters: { radius: 1 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [0.32, -0.86, 2.14] },
      },
      {
        id: 'control.scale',
        order: 6,
        path: ['Sidebar', 'Item', 'Transform', 'Scale'],
        parameters: { value: [0.12, 0.12, 0.12] },
      },
      {
        id: 'control.object_name',
        order: 7,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.EyeLeft' },
      },
    ]);
    expect(
      track.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action?.arguments['resourceId']).toBe('snowman.eye.left');
    expect(result.coverage).toEqual([
      {
        leafId: 'snowman.head.eyes.left',
        recipeId: 'blender.mesh.create_uv_sphere.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.shortcut',
      title: 'Add one UV sphere from the 3D Viewport shortcut projection',
      modality: 'shortcut',
      preconditions: orderedShortcut(blenderInteractionCatalog).preconditions,
    });
    expect(
      shortcutTrack.operations.map(({ id, order, keyMode, keys, selectionPath, parameters }) => ({
        id,
        order,
        keyMode,
        keys,
        selectionPath,
        parameters,
      })),
    ).toEqual([
      {
        id: 'shortcut.add_uv_sphere',
        order: 1,
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'UV Sphere'],
        parameters: { radius: 1, location: [0, 0, 0] },
      },
      {
        id: 'shortcut.move_x',
        order: 2,
        keyMode: 'sequence',
        keys: ['G', 'X'],
        selectionPath: undefined,
        parameters: { value: 0.32, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.move_y',
        order: 3,
        keyMode: 'sequence',
        keys: ['G', 'Y'],
        selectionPath: undefined,
        parameters: { value: -0.86, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.move_z',
        order: 4,
        keyMode: 'sequence',
        keys: ['G', 'Z'],
        selectionPath: undefined,
        parameters: { value: 2.14, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.scale',
        order: 5,
        keyMode: 'sequence',
        keys: ['S'],
        selectionPath: undefined,
        parameters: { value: 0.12, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.rename',
        order: 6,
        keyMode: 'sequence',
        keys: ['F2'],
        selectionPath: undefined,
        parameters: { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
      },
    ]);
    expect(
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.mcpTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.mcp',
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
      modality: 'mcp',
    });
  });

  it('materializes the exact Icosphere ordered menu without inventing shortcut or MCP support', () => {
    const input = icosphereCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Icosphere leaf');
    }

    expect(result.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_icosphere.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Icosphere menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_icosphere.native',
      title: 'Add one Icosphere from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.icosphere',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Ico Sphere'],
        parameters: { subdivisions: 3, radius: 1.75 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [-1.25, 2.5, 0.75] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.IcosphereDetail' },
      },
    ]);
    expect(
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.icosphere.detail',
      objectName: 'OperatingLine.IcosphereDetail',
      subdivisions: 3,
      radius: 1.75,
      location: [-1.25, 2.5, 0.75],
    });
    expect(leaf.shortcutTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'shortcut',
        reason: 'No verified shortcut procedure is available.',
      }),
    ]);
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('preserves the exact 1.10 legacy materialization algorithm and result version', () => {
    const legacyCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.10.0',
    );
    if (legacyCatalog === undefined) throw new Error('expected InteractionCatalog 1.10.0');

    const result = materializeProcedureAuthoringCandidate(
      candidate(legacyCatalog),
      blenderActionCatalog,
      legacyCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected legacy leaf');
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected legacy menu track');

    expect(result.formatVersion).toBe('1.0.0');
    expect(track.operations).toHaveLength(4);
    expect(track.operations.at(-1)?.parameters).toEqual(leaf.action.arguments);
  });

  it('preserves the exact 1.11 ordered-menu result without shortcut materialization', () => {
    const orderedMenuCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.11.0',
    );
    if (orderedMenuCatalog === undefined) throw new Error('expected InteractionCatalog 1.11.0');

    const result = materializeProcedureAuthoringCandidate(
      candidate(orderedMenuCatalog),
      blenderActionCatalog,
      orderedMenuCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected ordered menu leaf');

    expect(result.formatVersion).toBe('1.1.0');
    expect(leaf.menuTracks[0]).toMatchObject({ availability: 'available' });
    if (leaf.menuTracks[0]?.availability !== 'available') {
      throw new Error('expected ordered menu track');
    }
    expect(leaf.menuTracks[0].operations).toHaveLength(7);
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'No versioned shortcut recipe is available.',
    });
  });

  it('materializes a declared shortcut when the menu channel is unavailable', () => {
    const shortcutOnlyCatalog = structuredClone(blenderInteractionCatalog);
    const materialization = shortcutOnlyCatalog.recipes[0]!.procedureMaterialization;
    if (materialization === undefined) throw new Error('expected procedure materialization');
    materialization.menu = {
      availability: 'unavailable',
      reason: 'No native menu projection is available.',
    };

    const result = materializeProcedureAuthoringCandidate(
      candidate(shortcutOnlyCatalog),
      blenderActionCatalog,
      shortcutOnlyCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected shortcut-only leaf');

    expect(result.formatVersion).toBe('1.2.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: shortcutOnlyCatalog.recipes[0]!.id,
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'No native menu projection is available.',
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'available',
      modality: 'shortcut',
    });
  });

  it('uses result format 1.0.0 when a latest-catalog tree has only actionless leaves', () => {
    const input = candidate();
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.action = null;
    delete leaf.observationPolicy;

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(result.formatVersion).toBe('1.0.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: null,
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
  });

  it('uses result format 1.2.0 when a shortcut leaf is mixed with an actionless leaf', () => {
    const input = candidate();
    const orderedLeaf = input.nodes.find((node) => node.kind === 'leaf');
    if (orderedLeaf?.kind !== 'leaf') throw new Error('expected leaf');
    const actionlessLeaf = structuredClone(orderedLeaf);
    actionlessLeaf.id = 'snowman.head.eyes.annotation';
    actionlessLeaf.order = 2;
    actionlessLeaf.title = 'Describe eye placement';
    actionlessLeaf.intent = 'Keep a non-executable teaching note beside the ordered action.';
    actionlessLeaf.action = null;
    delete actionlessLeaf.observationPolicy;
    input.nodes.push(actionlessLeaf);

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(result.formatVersion).toBe('1.2.0');
    expect(
      result.coverage.map(({ leafId, recipeId, menu }) => ({ leafId, recipeId, menu })),
    ).toEqual([
      {
        leafId: orderedLeaf.id,
        recipeId: 'blender.mesh.create_uv_sphere.native',
        menu: 'materialized',
      },
      { leafId: actionlessLeaf.id, recipeId: null, menu: 'unavailable' },
    ]);
  });

  it('aligns every native operation to semantic and stable de-duplicated evidence order', () => {
    const input = candidate();
    input.evidence.push({
      id: 'evidence.extra',
      sourceId: input.sources[0]!.id,
      locator: { kind: 'whole_source' },
      description: 'Additional grounded evidence.',
      confidence: 1,
    });
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.semanticOperations[0]!.evidenceRefs = ['evidence.prompt', 'evidence.extra'];
    leaf.semanticOperations[1]!.evidenceRefs = ['evidence.extra'];

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const outputLeaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (outputLeaf?.kind !== 'leaf') throw new Error('expected leaf');
    const track = outputLeaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    for (const operation of track.operations) {
      expect(operation.semanticRefs).toEqual([
        'semantic.create',
        'semantic.transform',
        'semantic.rename',
      ]);
      expect(operation.evidenceRefs).toEqual(['evidence.prompt', 'evidence.extra']);
    }
    const shortcutTrack = outputLeaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    for (const operation of shortcutTrack.operations) {
      expect(operation.semanticRefs).toEqual([
        'semantic.create',
        'semantic.transform',
        'semantic.rename',
      ]);
      expect(operation.evidenceRefs).toEqual(['evidence.prompt', 'evidence.extra']);
    }
  });

  it('derives ordered control values only from validated action arguments', () => {
    const input = candidate();
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.semanticOperations[1]!.parameters = {
      location: [999, 999, 999],
      scale: [999, 999, 999],
    };
    leaf.semanticOperations[2]!.parameters = { name: 'Forged.Name' };

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const outputLeaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (outputLeaf?.kind !== 'leaf') throw new Error('expected output leaf');
    const track = outputLeaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');

    expect(track.operations.slice(4).map((operation) => operation.parameters)).toEqual([
      { value: [0.32, -0.86, 2.14] },
      { value: [0.12, 0.12, 0.12] },
      { value: 'OperatingLine.EyeLeft' },
    ]);
    const shortcutTrack = outputLeaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    expect(shortcutTrack.operations.map((operation) => operation.parameters)).toEqual([
      { radius: 1, location: [0, 0, 0] },
      { value: 0.32, confirm: 'ENTER' },
      { value: -0.86, confirm: 'ENTER' },
      { value: 2.14, confirm: 'ENTER' },
      { value: 0.12, confirm: 'ENTER' },
      { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
    ]);
  });

  it('materializes portable names as own parameters without inherited-object collisions', () => {
    const interactionCatalog = structuredClone(blenderInteractionCatalog);
    orderedMenu(interactionCatalog).operatorParameters[0]!.name = 'toString';

    const result = materializeProcedureAuthoringCandidate(
      candidate(interactionCatalog),
      blenderActionCatalog,
      interactionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected output leaf');
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    const parameters = track.operations[3]!.parameters;

    expect(Object.hasOwn(parameters, 'toString')).toBe(true);
    expect(parameters['toString']).toBe(1);
  });

  it('is deterministic, hashes canonical snapshots, and never mutates inputs', () => {
    const input = candidate();
    const actionCatalog = structuredClone(blenderActionCatalog);
    const interactionCatalog = structuredClone(blenderInteractionCatalog);
    const snapshots = structuredClone({ input, actionCatalog, interactionCatalog });

    const first = materializeProcedureAuthoringCandidate(input, actionCatalog, interactionCatalog);
    const second = materializeProcedureAuthoringCandidate(input, actionCatalog, interactionCatalog);

    expect(first).toEqual(second);
    expect(first.inputTreeContentSha256).toBe(sha256(input));
    expect(first.outputTreeContentSha256).toBe(sha256(first.tree));
    expect(first.interactionCatalogContentSha256).toBe(sha256(interactionCatalog));
    expect({ input, actionCatalog, interactionCatalog }).toEqual(snapshots);
    expect(first.tree).not.toBe(input);
  });

  it('keeps every track unavailable when the recipe has no declaration', () => {
    const interactionCatalog = structuredClone(blenderInteractionCatalog) as InteractionCatalog;
    delete interactionCatalog.recipes[0]!.procedureMaterialization;

    const result = materializeProcedureAuthoringCandidate(
      candidate(),
      blenderActionCatalog,
      interactionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');

    expect(result.coverage[0]).toEqual({
      leafId: leaf.id,
      recipeId: interactionCatalog.recipes[0]!.id,
      menu: 'unavailable',
      shortcut: 'unavailable',
      mcp: 'unavailable',
    });
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'The InteractionCatalog recipe does not declare menu materialization.',
    });
    expect(leaf.menuTracks[0]).not.toMatchObject({
      id: `${leaf.id}.forged.track`,
      reason: 'Forged menu reason',
    });
  });

  it('fails closed on catalog binding mismatches and invalid action arguments', () => {
    const mismatched = candidate();
    mismatched.interactionCatalogVersion = '999.0.0';
    expect(() =>
      materializeProcedureAuthoringCandidate(
        mismatched,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow('catalog binding mismatch');

    const invalidArguments = candidate();
    const leaf = invalidArguments.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected action leaf');
    leaf.action.arguments['radius'] = 'not-a-number';
    expect(() =>
      materializeProcedureAuthoringCandidate(
        invalidArguments,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow('action arguments violate blender.mesh.create_uv_sphere');
  });
});
