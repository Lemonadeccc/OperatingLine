import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyProcedureTreeEditorMutationPolicy } from '@operatingline/orchestrator';
import {
  parseProcedureTree,
  type ProcedureLeafNode,
  type ProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

function fixture(): ProcedureTree {
  return parseProcedureTree(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  );
}

function leaf(tree: ProcedureTree): ProcedureLeafNode {
  const result = tree.nodes.find((node) => node.kind === 'leaf');
  if (result?.kind !== 'leaf') throw new Error('Expected ProcedureTree leaf');
  return result;
}

function safeDraftLeaf(template: ProcedureLeafNode, id: string): ProcedureLeafNode {
  const draft = structuredClone(template);
  draft.id = id;
  draft.action = null;
  draft.semanticOperations = [
    {
      id: 'semantic.11111111-1111-4111-8111-111111111111',
      order: 1,
      semanticAction: 'create_uv_sphere',
      description: 'Draft semantic operation awaiting trusted materialization.',
      parameters: {},
      evidenceRefs: [],
    },
  ];
  draft.menuTracks = [
    {
      id: 'menu.track.33333333-3333-4333-8333-333333333333',
      availability: 'unavailable',
      title: 'MENU unavailable',
      reason: 'Draft track awaiting trusted materialization.',
      modality: 'menu',
    },
  ];
  draft.shortcutTracks = [
    {
      id: 'shortcut.track.44444444-4444-4444-8444-444444444444',
      availability: 'unavailable',
      title: 'SHORTCUT unavailable',
      reason: 'Draft track awaiting trusted materialization.',
      modality: 'shortcut',
    },
  ];
  draft.mcpTracks = [
    {
      id: 'mcp.track.55555555-5555-4555-8555-555555555555',
      availability: 'unavailable',
      title: 'MCP unavailable',
      reason: 'Draft track awaiting trusted materialization.',
      modality: 'mcp',
    },
  ];
  draft.anchors = [];
  draft.expectedObservations = [];
  delete draft.observationPolicy;
  draft.rollback = { mode: 'checkpoint_restore', checkpointRequired: true };
  draft.validation = { status: 'candidate', validatedHostVersions: [], notes: [] };
  delete draft.parameterProjection;
  return draft;
}

describe('ProcedureTree editor mutation policy', () => {
  it('allows authored content changes and normalizes an affected verified leaf', () => {
    const base = fixture();
    leaf(base).validation = {
      status: 'verified',
      validatedHostVersions: ['5.1.0'],
      notes: ['Verified before editing'],
    };
    const candidate = structuredClone(base);
    candidate.revision = 2;
    candidate.title = 'Updated procedure title';
    const edited = leaf(candidate);
    edited.title = 'Updated leaf title';
    edited.parentId = 'snowman.head';
    edited.semanticOperations[0]!.description = 'Updated semantic description';
    const menu = edited.menuTracks[0];
    if (menu?.availability !== 'available') throw new Error('Expected available menu track');
    menu.operations[0]!.description = 'Updated menu description';

    expect(applyProcedureTreeEditorMutationPolicy(base, candidate)).toMatchObject({
      title: 'Updated procedure title',
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: edited.id,
          validation: {
            status: 'candidate',
            validatedHostVersions: [],
            notes: ['Verified before editing'],
          },
        }),
      ]),
    });
  });

  it('allows only explicitly projected Action arguments to change', () => {
    const base = fixture();
    const selected = leaf(base);
    selected.parameterProjection = {
      formatVersion: '1.0.0',
      provenance: {
        kind: 'interaction_catalog_materialization',
        interactionCatalogVersion: base.interactionCatalogVersion,
        recipeId: 'recipe.radius',
      },
      arguments: Object.keys(selected.action!.arguments)
        .sort()
        .map((actionArgument) =>
          actionArgument === 'radius'
            ? {
                actionArgument,
                disposition: 'projected' as const,
                bindingIds: ['binding.semantic.radius'],
              }
            : {
                actionArgument,
                disposition: 'omitted' as const,
                bindingIds: [],
                reason: `${actionArgument} is intentionally omitted`,
              },
        ),
      bindings: [
        {
          id: 'binding.semantic.radius',
          actionArgument: 'radius',
          transform: 'identity',
          target: {
            modality: 'semantic',
            operationId: 'semantic.create',
            path: [{ kind: 'field', name: 'radius' }],
          },
        },
      ],
    };

    const projected = structuredClone(base);
    leaf(projected).action!.arguments['radius'] = 0.2;
    expect(() => applyProcedureTreeEditorMutationPolicy(base, projected)).not.toThrow();

    const omitted = structuredClone(base);
    leaf(omitted).action!.arguments['resourceId'] = 'forged.resource';
    expect(() => applyProcedureTreeEditorMutationPolicy(base, omitted)).toThrow(/resourceId/);

    const added = structuredClone(base);
    leaf(added).action!.arguments['forged'] = 1;
    expect(() => applyProcedureTreeEditorMutationPolicy(base, added)).toThrow(/action.arguments/);

    const legacyBase = fixture();
    const legacyCandidate = structuredClone(legacyBase);
    leaf(legacyCandidate).action!.arguments['radius'] = 0.2;
    expect(() => applyProcedureTreeEditorMutationPolicy(legacyBase, legacyCandidate)).toThrow(
      /radius/,
    );
  });

  it('rejects direct edits to existing representation parameter surfaces', () => {
    const cases: readonly [string, (node: ProcedureLeafNode) => void][] = [
      [
        'semantic parameters',
        (node) => {
          node.semanticOperations[0]!.parameters['radius'] = 0.2;
        },
      ],
      [
        'menu parameters',
        (node) => {
          const track = node.menuTracks.find((candidate) => candidate.availability === 'available');
          if (track?.availability !== 'available') throw new Error('Expected menu track');
          const operation = track.operations.find(
            (candidate) => Object.keys(candidate.parameters).length > 0,
          );
          if (operation === undefined) throw new Error('Expected parameterized menu operation');
          operation.parameters['radius'] = 0.2;
        },
      ],
      [
        'shortcut parameters',
        (node) => {
          const track = node.shortcutTracks.find(
            (candidate) => candidate.availability === 'available',
          );
          if (track?.availability !== 'available') throw new Error('Expected shortcut track');
          const operation = track.operations.find(
            (candidate) => Object.keys(candidate.parameters).length > 0,
          );
          if (operation === undefined) throw new Error('Expected parameterized shortcut operation');
          operation.parameters['radius'] = 0.2;
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const base = fixture();
      const candidate = structuredClone(base);
      mutate(leaf(candidate));
      expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate), label).toThrow(
        /parameters/,
      );
    }

    const base = fixture();
    leaf(base).mcpTracks = [
      {
        id: 'mcp.bound',
        availability: 'available',
        title: 'Bound MCP operation',
        modality: 'mcp',
        preconditions: [],
        operations: [
          {
            id: 'mcp.execute',
            order: 1,
            semanticRefs: ['semantic.create'],
            description: 'Execute bound action',
            evidenceRefs: ['evidence.prompt'],
            serverName: 'operatingline',
            toolName: 'execute_action',
            arguments: { radius: 0.12 },
          },
        ],
      },
    ];
    const candidate = structuredClone(base);
    const track = leaf(candidate).mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('Expected MCP track');
    track.operations[0]!.arguments['radius'] = 0.2;
    expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate)).toThrow(/arguments/);
  });

  it('downgrades descendant leaves when an ancestor group is renamed or reparented', () => {
    const base = fixture();
    leaf(base).validation = {
      status: 'verified',
      validatedHostVersions: ['5.1.0'],
      notes: ['Verified ancestor path'],
    };
    const candidate = structuredClone(base);
    const ancestor = candidate.nodes.find((node) => node.id === 'snowman.head.eyes')!;
    ancestor.title = 'Reorganized eye construction';
    ancestor.parentId = 'snowman';

    expect(leaf(applyProcedureTreeEditorMutationPolicy(base, candidate)).validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: ['Verified ancestor path'],
    });
  });

  it('downgrades a verified leaf moved beneath a newly identified replacement group', () => {
    const base = fixture();
    leaf(base).validation = {
      status: 'verified',
      validatedHostVersions: ['5.1.0'],
      notes: ['Verified before group replacement'],
    };
    const candidate = structuredClone(base);
    const replaced = candidate.nodes.find((node) => node.id === 'snowman.head.eyes');
    if (replaced?.kind !== 'group') throw new Error('Expected eye group');
    candidate.nodes = candidate.nodes.filter((node) => node.id !== replaced.id);
    const replacement = structuredClone(replaced);
    replacement.id = 'snowman.head.eyes.replacement';
    candidate.nodes.push(replacement);
    leaf(candidate).parentId = replacement.id;

    expect(leaf(applyProcedureTreeEditorMutationPolicy(base, candidate)).validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: ['Verified before group replacement'],
    });
  });

  it('rejects root, rights, action, validation, and executable provenance forgery', () => {
    const cases: readonly [string, (tree: ProcedureTree) => void][] = [
      ['adapterId', (tree) => (tree.adapterId = 'forged-adapter')],
      ['rootNodeId', (tree) => (tree.rootNodeId = 'snowman.head')],
      ['sources', (tree) => (tree.sources[0]!.text = 'Forged source rights')],
      ['action name', (tree) => (leaf(tree).action!.name = 'blender.mesh.delete')],
      ['action removal', (tree) => (leaf(tree).action = null)],
      ['anchors', (tree) => leaf(tree).anchors.splice(0, 1)],
      ['observations', (tree) => leaf(tree).expectedObservations.splice(0, 1)],
      ['validation', (tree) => (leaf(tree).validation.status = 'verified')],
      [
        'parameter projection',
        (tree) =>
          (leaf(tree).parameterProjection = {
            formatVersion: '1.0.0',
            provenance: {
              kind: 'interaction_catalog_materialization',
              interactionCatalogVersion: tree.interactionCatalogVersion,
              recipeId: 'forged.recipe',
            },
            arguments: [],
            bindings: [],
          }),
      ],
      [
        'semantic action',
        (tree) => (leaf(tree).semanticOperations[0]!.semanticAction = 'delete_everything'),
      ],
      [
        'menu target',
        (tree) => {
          const track = leaf(tree).menuTracks[0];
          if (track?.availability !== 'available') throw new Error('Expected menu track');
          track.operations[0]!.target.hostId = 'forged.operator';
        },
      ],
      [
        'shortcut keys',
        (tree) => {
          const track = leaf(tree).shortcutTracks[0];
          if (track?.availability !== 'available') throw new Error('Expected shortcut track');
          track.operations[0]!.keys = ['CTRL', 'ALT', 'DELETE'];
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const base = fixture();
      const candidate = structuredClone(base);
      candidate.revision = 2;
      mutate(candidate);
      expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate), label).toThrow(
        /cannot mutate protected field/,
      );
    }
  });

  it('allows only non-executable safe drafts under new leaf IDs', () => {
    const base = fixture();
    const safeCandidate = structuredClone(base);
    safeCandidate.nodes.push(safeDraftLeaf(leaf(base), 'snowman.head.eyes.draft'));
    expect(() => applyProcedureTreeEditorMutationPolicy(base, safeCandidate)).not.toThrow();

    const executableCandidate = structuredClone(base);
    const forgedExecutable = structuredClone(leaf(base));
    forgedExecutable.id = 'snowman.head.eyes.forged';
    forgedExecutable.action!.name = 'blender.mesh.delete_everything';
    forgedExecutable.semanticOperations[0]!.semanticAction = 'delete_everything';
    executableCandidate.nodes = executableCandidate.nodes.filter(
      (node) => node.id !== leaf(base).id,
    );
    executableCandidate.nodes.push(forgedExecutable);
    expect(() => applyProcedureTreeEditorMutationPolicy(base, executableCandidate)).toThrow(
      /nodes\[id="snowman\.head\.eyes\.forged"\]\.action/,
    );

    const invalidDraft = structuredClone(base);
    const draftWithProvenance = safeDraftLeaf(leaf(base), 'snowman.head.eyes.provenance');
    draftWithProvenance.anchors = structuredClone(leaf(base).anchors);
    invalidDraft.nodes.push(draftWithProvenance);
    expect(() => applyProcedureTreeEditorMutationPolicy(base, invalidDraft)).toThrow(/anchors/);
  });

  it('rejects changing an existing MCP server or tool binding', () => {
    const base = fixture();
    leaf(base).mcpTracks = [
      {
        id: 'mcp.bound',
        availability: 'available',
        title: 'Bound MCP operation',
        modality: 'mcp',
        preconditions: [],
        operations: [
          {
            id: 'mcp.execute',
            order: 1,
            semanticRefs: ['semantic.create'],
            description: 'Execute bound action',
            evidenceRefs: ['evidence.prompt'],
            serverName: 'operatingline',
            toolName: 'execute_action',
            arguments: {},
          },
        ],
      },
    ];
    const candidate = structuredClone(base);
    const track = leaf(candidate).mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('Expected MCP track');
    track.operations[0]!.toolName = 'forged_tool';
    expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate)).toThrow(/toolName/);
  });

  it('rejects laundering protected operations through new stable IDs on an existing leaf', () => {
    const cases: readonly [string, (node: ProcedureLeafNode) => void][] = [
      [
        'semantic operation',
        (node) => {
          node.semanticOperations[0]!.id = 'semantic.forged';
        },
      ],
      [
        'menu operation',
        (node) => {
          const track = node.menuTracks.find((candidate) => candidate.availability === 'available');
          if (track?.availability !== 'available') throw new Error('Expected menu track');
          track.operations[0]!.id = 'menu.forged';
        },
      ],
      [
        'shortcut operation',
        (node) => {
          const track = node.shortcutTracks.find(
            (candidate) => candidate.availability === 'available',
          );
          if (track?.availability !== 'available') throw new Error('Expected shortcut track');
          track.operations[0]!.id = 'shortcut.forged';
        },
      ],
      [
        'MCP operation',
        (node) => {
          node.mcpTracks = [
            {
              id: 'mcp.bound',
              availability: 'available',
              title: 'Bound MCP operation',
              modality: 'mcp',
              preconditions: [],
              operations: [
                {
                  id: 'mcp.forged',
                  order: 1,
                  semanticRefs: ['semantic.create'],
                  description: 'Execute bound action',
                  evidenceRefs: ['evidence.prompt'],
                  serverName: 'forged-server',
                  toolName: 'forged-tool',
                  arguments: { forged: true },
                },
              ],
            },
          ];
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const base = fixture();
      if (label === 'MCP operation') {
        const selected = leaf(base);
        selected.mcpTracks = [
          {
            id: 'mcp.bound',
            availability: 'available',
            title: 'Bound MCP operation',
            modality: 'mcp',
            preconditions: [],
            operations: [
              {
                id: 'mcp.execute',
                order: 1,
                semanticRefs: ['semantic.create'],
                description: 'Execute bound action',
                evidenceRefs: ['evidence.prompt'],
                serverName: 'operatingline',
                toolName: 'execute_action',
                arguments: {},
              },
            ],
          },
        ];
      }
      const candidate = structuredClone(base);
      mutate(leaf(candidate));
      expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate), label).toThrow(
        /cannot mutate protected field.*\[id=.*forged.*\]/,
      );
    }
  });

  it('rejects laundering representation tracks through new stable IDs', () => {
    const cases: readonly [string, 'menuTracks' | 'shortcutTracks' | 'mcpTracks'][] = [
      ['menu track', 'menuTracks'],
      ['shortcut track', 'shortcutTracks'],
      ['MCP track', 'mcpTracks'],
    ];
    for (const [label, collection] of cases) {
      const base = fixture();
      if (collection === 'mcpTracks') {
        leaf(base).mcpTracks = [
          {
            id: 'mcp.bound',
            availability: 'unavailable',
            title: 'MCP unavailable',
            modality: 'mcp',
            reason: 'Not materialized',
          },
        ];
      }
      const candidate = structuredClone(base);
      leaf(candidate)[collection][0]!.id = `${collection}.forged`;
      expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate), label).toThrow(
        /cannot mutate protected field.*\[id=.*forged.*\]/,
      );
    }
  });

  it('continues to allow deletion and reordering of existing stable IDs', () => {
    const base = fixture();
    const candidate = structuredClone(base);
    const selected = leaf(candidate);
    selected.semanticOperations = selected.semanticOperations.slice(0, 2).reverse();
    const menu = selected.menuTracks.find((track) => track.availability === 'available');
    if (menu?.availability !== 'available') throw new Error('Expected menu track');
    menu.operations = menu.operations.slice(0, -1).reverse();
    selected.shortcutTracks = [];

    expect(() => applyProcedureTreeEditorMutationPolicy(base, candidate)).not.toThrow();

    const deletedLeaf = structuredClone(base);
    deletedLeaf.nodes = deletedLeaf.nodes.filter((node) => node.id !== leaf(base).id);
    expect(() => applyProcedureTreeEditorMutationPolicy(base, deletedLeaf)).not.toThrow();
  });
});
