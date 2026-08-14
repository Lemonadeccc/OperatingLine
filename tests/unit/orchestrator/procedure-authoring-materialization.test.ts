import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringCandidateTreeSchema,
  type InteractionCatalog,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';

function candidate(): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
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
        parameters: leaf.action?.arguments,
      },
    ]);
    expect(result.coverage).toEqual([
      {
        leafId: 'snowman.head.eyes.left',
        recipeId: 'blender.mesh.create_uv_sphere.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.shortcutTracks).toEqual([
      {
        id: 'blender.mesh.create_uv_sphere.native.shortcut',
        availability: 'unavailable',
        title: 'Add one UV sphere from the 3D Viewport',
        reason: 'No versioned shortcut recipe is available.',
        modality: 'shortcut',
      },
    ]);
    expect(leaf.mcpTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.mcp',
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
      modality: 'mcp',
    });
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
