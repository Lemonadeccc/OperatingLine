import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseProcedureTree,
  procedureTreeSchema,
  stableProcedureLeafOrder,
  validateProcedureTree,
  type ProcedureTree,
} from '@operatingline/protocol';

function readFixture(): ProcedureTree {
  return parseProcedureTree(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  );
}

describe('procedure tree protocol', () => {
  it('keeps concrete values at the exact semantic, menu, and shortcut operation', () => {
    const tree = readFixture();
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    expect(leaf?.kind).toBe('leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');

    expect(leaf.semanticOperations.map((operation) => operation.semanticAction)).toEqual([
      'create_uv_sphere',
      'set_object_transform',
      'rename_object',
    ]);
    const menu = leaf.menuTracks[0]!;
    const shortcut = leaf.shortcutTracks[0]!;
    expect(menu.availability).toBe('available');
    expect(shortcut.availability).toBe('available');
    if (menu.availability !== 'available' || shortcut.availability !== 'available') {
      throw new Error('Expected available interaction tracks');
    }
    expect(
      menu.operations.find((operation) => operation.id === 'menu.location')?.parameters,
    ).toEqual({ value: [0.32, -0.86, 2.14] });
    expect(menu.operations.find((operation) => operation.id === 'menu.rename')?.parameters).toEqual(
      { value: 'OperatingLine.EyeLeft' },
    );
    expect(
      shortcut.operations.find((operation) => operation.id === 'shortcut.move_z')?.parameters,
    ).toEqual({ value: 2.14, confirm: 'ENTER' });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'mcp',
    });
  });

  it('accepts an MCP call that covers several semantic operations with concrete arguments', () => {
    const tree = structuredClone(readFixture());
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    leaf.mcpTracks = [
      {
        id: 'mcp.blender.create_eye',
        availability: 'available',
        title: 'Blender MCP eye creation',
        modality: 'mcp',
        preconditions: [{ kind: 'mode', label: 'Mode', value: 'OBJECT' }],
        operations: [
          {
            id: 'mcp.create_eye',
            order: 1,
            semanticRefs: ['semantic.create', 'semantic.transform', 'semantic.rename'],
            description: 'Create the named eye with its final transform.',
            evidenceRefs: ['evidence.prompt'],
            serverName: 'blender',
            toolName: 'create_uv_sphere',
            arguments: {
              name: 'OperatingLine.EyeLeft',
              location: [0.32, -0.86, 2.14],
              scale: [0.12, 0.12, 0.12],
            },
            resultBinding: 'left_eye',
          },
        ],
      },
    ];

    expect(() => validateProcedureTree(tree)).not.toThrow();
  });

  it('concatenates leaves in dependency-safe presentation order', () => {
    const tree = structuredClone(readFixture());
    const first = tree.nodes.find((node) => node.kind === 'leaf');
    if (first?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const second = structuredClone(first);
    second.id = 'snowman.head.eyes.right';
    second.order = 2;
    second.dependsOn = [first.id];
    second.title = '创建并调整右眼球体';
    tree.nodes.push(second);

    expect(stableProcedureLeafOrder(tree).map((leaf) => leaf.id)).toEqual([
      'snowman.head.eyes.left',
      'snowman.head.eyes.right',
    ]);
  });

  it('rejects broken semantic alignment, ordering, hierarchy, and evidence provenance', () => {
    const missingSemantic = structuredClone(readFixture());
    const missingSemanticLeaf = missingSemantic.nodes.find((node) => node.kind === 'leaf');
    if (missingSemanticLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const menu = missingSemanticLeaf.menuTracks[0]!;
    if (menu.availability !== 'available') throw new Error('Expected menu track');
    menu.operations = menu.operations.filter(
      (operation) => !operation.semanticRefs.includes('semantic.rename'),
    );
    expect(() => validateProcedureTree(missingSemantic)).toThrow(
      'does not cover semantic operations',
    );

    const noncontiguous = structuredClone(readFixture());
    const noncontiguousLeaf = noncontiguous.nodes.find((node) => node.kind === 'leaf');
    if (noncontiguousLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const shortcut = noncontiguousLeaf.shortcutTracks[0]!;
    if (shortcut.availability !== 'available') throw new Error('Expected shortcut track');
    shortcut.operations[1]!.order = 9;
    expect(() => validateProcedureTree(noncontiguous)).toThrow('orders must be contiguous from 1');

    const leafParent = structuredClone(readFixture());
    leafParent.nodes[1]!.parentId = 'snowman.head.eyes.left';
    expect(() => validateProcedureTree(leafParent)).toThrow('cannot contain child');

    const unknownEvidence = structuredClone(readFixture());
    const unknownEvidenceLeaf = unknownEvidence.nodes.find((node) => node.kind === 'leaf');
    if (unknownEvidenceLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    unknownEvidenceLeaf.semanticOperations[0]!.evidenceRefs = ['evidence.missing'];
    expect(() => validateProcedureTree(unknownEvidence)).toThrow('unknown evidence');

    const wrongAdapter = structuredClone(readFixture());
    const wrongAdapterLeaf = wrongAdapter.nodes.find((node) => node.kind === 'leaf');
    if (wrongAdapterLeaf?.kind !== 'leaf' || wrongAdapterLeaf.action === null) {
      throw new Error('Expected executable procedure leaf');
    }
    wrongAdapterLeaf.action.adapterId = 'other-host';
    expect(() => validateProcedureTree(wrongAdapter)).toThrow('does not match blender');
  });

  it('emits a strict language-neutral JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/procedure-tree.schema.json'), 'utf8'),
    ) as {
      additionalProperties?: boolean;
      properties?: { nodes?: { items?: { oneOf?: Array<{ additionalProperties?: boolean }> } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.nodes?.items?.oneOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ additionalProperties: false })]),
    );

    const extra = { ...readFixture(), unexpected: true };
    expect(procedureTreeSchema.safeParse(extra).success).toBe(false);
  });
});
