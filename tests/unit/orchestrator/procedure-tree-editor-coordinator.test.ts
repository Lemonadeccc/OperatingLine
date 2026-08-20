import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  createProcedureTreeEditorCoordinator,
  type ProcedureTreeEditorError,
} from '@operatingline/orchestrator';
import {
  canonicalizeProtocolJsonValue,
  parseProcedureTree,
  protocolJsonValueCanonicalization,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureLeafNode,
  type ProcedureTree,
  type ProcedureTreeEditorEditPreviewResult,
  type ProcedureTreeEditorRevisionRef,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { afterEach, describe, expect, it } from 'vitest';

const occurredAt = '2026-08-19T09:00:00.000Z';

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function fixture(): ProcedureTree {
  return parseProcedureTree(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  );
}

function leaf(tree: ProcedureTree): ProcedureLeafNode {
  const value = tree.nodes.find((node) => node.kind === 'leaf');
  if (value?.kind !== 'leaf') throw new Error('Expected ProcedureTree leaf');
  return value;
}

function safeDraftLeaf(template: ProcedureLeafNode, id: string, order: number): ProcedureLeafNode {
  const draft = structuredClone(template);
  draft.id = id;
  draft.order = order;
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

function revisionRef(tree: ProcedureTree): ProcedureTreeEditorRevisionRef {
  return { treeId: tree.id, revision: tree.revision, contentSha256: hash(tree) };
}

function catalog(tree: ProcedureTree): ActionCatalog {
  const result = blenderActionCatalogs.find(
    (candidate) => candidate.catalogVersion === tree.actionCatalogVersion,
  );
  if (result === undefined) throw new Error('Fixture action catalog was not installed');
  return result;
}

function interactionCatalog(tree: ProcedureTree): InteractionCatalog {
  const result = blenderInteractionCatalogs.find(
    (candidate) =>
      candidate.adapterId === tree.adapterId &&
      candidate.actionCatalogVersion === tree.actionCatalogVersion &&
      candidate.catalogVersion === tree.interactionCatalogVersion,
  );
  if (result === undefined) throw new Error('Fixture interaction catalog was not installed');
  return result;
}

function projectedRadiusCatalog(tree: ProcedureTree): InteractionCatalog {
  const action = leaf(tree).action!;
  const omissions = Object.keys(action.arguments)
    .filter((name) => name !== 'radius' && name !== 'location')
    .map((argumentName) => ({ argumentName, reason: `${argumentName} is intentionally omitted` }));
  return {
    catalogVersion: tree.interactionCatalogVersion,
    adapterId: tree.adapterId,
    actionCatalogVersion: tree.actionCatalogVersion,
    hostVersionRange: tree.hostVersionRange,
    recipes: [
      {
        id: 'recipe.radius',
        actionName: action.name,
        procedureMaterialization: {
          semantic: {
            source: 'catalog.semantic_parameter_projections',
            projections: [
              {
                id: 'radius',
                semanticAction: 'create_uv_sphere',
                path: [{ kind: 'field', name: 'radius' }],
                actionArgument: 'radius',
                transform: 'identity',
              },
              {
                id: 'location',
                semanticAction: 'set_object_transform',
                path: [{ kind: 'field', name: 'location' }],
                actionArgument: 'location',
                transform: 'identity',
              },
            ],
            omittedActionArguments: omissions,
          },
          menu: { availability: 'unavailable' },
          shortcut: { availability: 'unavailable' },
          mcp: { availability: 'unavailable' },
        },
      },
    ],
  } as InteractionCatalog;
}

function installRadiusProjection(tree: ProcedureTree): void {
  const selected = leaf(tree);
  selected.parameterProjection = {
    formatVersion: '1.0.0',
    provenance: {
      kind: 'interaction_catalog_materialization',
      interactionCatalogVersion: tree.interactionCatalogVersion,
      recipeId: 'recipe.radius',
    },
    arguments: Object.keys(selected.action!.arguments)
      .sort()
      .map((actionArgument) =>
        actionArgument === 'radius' || actionArgument === 'location'
          ? {
              actionArgument,
              disposition: 'projected' as const,
              bindingIds: [`binding.semantic.${actionArgument}`],
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
      {
        id: 'binding.semantic.location',
        actionArgument: 'location',
        transform: 'identity',
        target: {
          modality: 'semantic',
          operationId: 'semantic.transform',
          path: [{ kind: 'field', name: 'location' }],
        },
      },
    ],
  };
}

function configureProjectedEditorTree(tree: ProcedureTree): void {
  installRadiusProjection(tree);
  const selected = leaf(tree);
  selected.semanticOperations[0]!.parameters['radius'] = selected.action!.arguments['radius'];
}

function setup(
  configureBase?: (tree: ProcedureTree) => void,
  resolveInteractionCatalog: (tree: ProcedureTree) => InteractionCatalog = interactionCatalog,
  resolveActionCatalog: (tree: ProcedureTree) => ActionCatalog = catalog,
) {
  const database = openOperatingLineDatabase(':memory:');
  const validation = { reject: false };
  const base = fixture();
  leaf(base).mcpTracks.push({
    id: 'mcp.test.action',
    availability: 'available',
    title: 'Test action-level MCP track',
    modality: 'mcp',
    preconditions: [],
    operations: [
      {
        id: 'mcp.test.create_eye',
        order: 1,
        semanticRefs: ['semantic.create', 'semantic.transform', 'semantic.rename'],
        description: 'Create the eye through an action-level MCP call.',
        evidenceRefs: [],
        serverName: 'operatingline',
        toolName: 'execute_action',
        arguments: { radius: 0.12, location: [0.32, -0.86, 2.14] },
      },
    ],
  });
  configureBase?.(base);
  const contentSha256 = hash(base);
  database.recordProcedureTree({
    treeId: base.id,
    revision: base.revision,
    title: base.title,
    adapterId: base.adapterId,
    actionCatalogVersion: base.actionCatalogVersion,
    interactionCatalogVersion: base.interactionCatalogVersion,
    hostVersionRange: base.hostVersionRange,
    contentSha256,
    tree: base,
  });
  const loadTree = (treeId: string, revision?: number): StoredProcedureTree | null => {
    const record = database.getProcedureTree(treeId, revision);
    if (record === null) return null;
    const tree = parseProcedureTree(record.tree);
    return {
      sequence: record.sequence,
      tree,
      integrity: {
        algorithm: 'sha256',
        canonicalization: protocolJsonValueCanonicalization,
        contentSha256: record.contentSha256,
      },
      storedAt: record.storedAt,
    };
  };
  const coordinator = createProcedureTreeEditorCoordinator({
    database,
    loadTree,
    validateTree: (tree) => {
      if (validation.reject) throw new Error('New validator rejects historical candidates');
      return parseProcedureTree(tree);
    },
    computeContentSha256: hash,
    getActionCatalog: resolveActionCatalog,
    getInteractionCatalog: resolveInteractionCatalog,
  });
  return { base, coordinator, database, validation };
}

type Setup = ReturnType<typeof setup>;
const databases: Setup['database'][] = [];

function trackedSetup(
  configureBase?: (tree: ProcedureTree) => void,
  resolveInteractionCatalog?: (tree: ProcedureTree) => InteractionCatalog,
  resolveActionCatalog?: (tree: ProcedureTree) => ActionCatalog,
): Setup {
  const result = setup(configureBase, resolveInteractionCatalog, resolveActionCatalog);
  databases.push(result.database);
  return result;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createBranch(
  setupResult: Setup,
  name: string,
  createdFrom = revisionRef(setupResult.base),
) {
  return setupResult.coordinator.createBranch({
    formatVersion: '1.0.0',
    requestId: randomUUID(),
    treeId: setupResult.base.id,
    name,
    createdFrom,
    occurredAt,
  }).branch;
}

function editPreview(
  setupResult: Setup,
  branchId: string,
  base: ProcedureTreeEditorRevisionRef,
  expectedLatestRevision: number,
  mutate: (tree: ProcedureTree) => void,
): ProcedureTreeEditorEditPreviewResult {
  const targetTree = structuredClone(
    setupResult.coordinator.workspace({
      formatVersion: '1.0.0',
      treeId: base.treeId,
      branchId,
    })!.tree,
  );
  targetTree.revision = expectedLatestRevision + 1;
  mutate(targetTree);
  return setupResult.coordinator.previewEdit({
    formatVersion: '1.0.0',
    requestId: randomUUID(),
    branchId,
    base,
    expectedLatestRevision,
    targetTree,
    message: 'Edit ProcedureTree',
  });
}

function commitEdit(
  setupResult: Setup,
  branchId: string,
  preview: ProcedureTreeEditorEditPreviewResult,
  requestId = randomUUID(),
) {
  const request = {
    formatVersion: '1.0.0' as const,
    requestId,
    occurredAt,
    operation: 'edit' as const,
    targetBranchId: branchId,
    expectedHead: preview.base,
    previewBinding: preview.binding,
    targetTree: preview.targetTree,
    targetIntegrity: preview.targetIntegrity,
    message: 'Edit ProcedureTree',
    proposalCreated: false as const,
    hostExecutionStarted: false as const,
  };
  return { request, result: setupResult.coordinator.commit(request) };
}

describe('ProcedureTree editor coordinator', () => {
  it('rejects forged protected mutations and normalizes edited verified leaves', () => {
    const verified = trackedSetup((tree) => {
      leaf(tree).validation = {
        status: 'verified',
        validatedHostVersions: ['5.1.0'],
        notes: ['Verified before local editing'],
      };
    });
    const branch = createBranch(verified, 'Main');
    const normalized = editPreview(verified, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'Edited verified leaf';
    });
    expect(leaf(normalized.targetTree).validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: ['Verified before local editing'],
    });

    const candidate = structuredClone(normalized.targetTree);
    candidate.revision = 2;
    candidate.sources[0] = { ...candidate.sources[0]!, text: 'Forged source provenance' };
    expect(() =>
      verified.coordinator.previewEdit({
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        branchId: branch.branchId,
        base: branch.head,
        expectedLatestRevision: 1,
        targetTree: candidate,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );
  });

  it('rejects stable-ID laundering across semantic, menu, shortcut, and MCP operations', () => {
    const cases: readonly [string, (node: ProcedureLeafNode) => void][] = [
      [
        'semantic',
        (node) => {
          node.semanticOperations[0]!.id = 'semantic.forged';
          for (const track of [...node.menuTracks, ...node.shortcutTracks, ...node.mcpTracks]) {
            if (track.availability !== 'available') continue;
            for (const operation of track.operations) {
              operation.semanticRefs = operation.semanticRefs.map((reference) =>
                reference === 'semantic.create' ? 'semantic.forged' : reference,
              );
            }
          }
        },
      ],
      [
        'menu',
        (node) => {
          const track = node.menuTracks.find((candidate) => candidate.availability === 'available');
          if (track?.availability !== 'available') throw new Error('Expected menu track');
          track.operations[0]!.id = 'menu.forged';
          track.operations[0]!.target.hostId = 'forged.operator';
        },
      ],
      [
        'shortcut',
        (node) => {
          const track = node.shortcutTracks.find(
            (candidate) => candidate.availability === 'available',
          );
          if (track?.availability !== 'available') throw new Error('Expected shortcut track');
          track.operations[0]!.id = 'shortcut.forged';
          track.operations[0]!.keys = ['CTRL', 'ALT', 'DELETE'];
        },
      ],
      [
        'MCP',
        (node) => {
          const track = node.mcpTracks.find((candidate) => candidate.availability === 'available');
          if (track?.availability !== 'available') throw new Error('Expected MCP track');
          track.operations[0]!.id = 'mcp.forged';
          track.operations[0]!.serverName = 'forged-server';
          track.operations[0]!.toolName = 'forged-tool';
          track.operations[0]!.arguments = { forged: true };
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const setupResult = trackedSetup();
      const branch = createBranch(setupResult, `${label} laundering`);
      expect(() =>
        editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => mutate(leaf(tree))),
      ).toThrowError(
        expect.objectContaining<Partial<ProcedureTreeEditorError>>({
          code: 'validation_failed',
          statusCode: 422,
        }),
      );
    }
  });

  it('rejects executable leaf laundering but accepts and commits a configured UI-shaped draft', () => {
    const setupResult = trackedSetup();
    const forgedBranch = createBranch(setupResult, 'Forged replacement leaf');
    expect(() =>
      editPreview(setupResult, forgedBranch.branchId, forgedBranch.head, 1, (tree) => {
        const original = leaf(tree);
        const forged = structuredClone(original);
        forged.id = 'snowman.head.eyes.forged';
        forged.action!.name = 'blender.mesh.delete_everything';
        forged.semanticOperations[0]!.semanticAction = 'delete_everything';
        const menu = forged.menuTracks.find((track) => track.availability === 'available');
        if (menu?.availability !== 'available') throw new Error('Expected menu track');
        menu.operations[0]!.target.hostId = 'forged.operator';
        tree.nodes = tree.nodes.filter((node) => node.id !== original.id);
        tree.nodes.push(forged);
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );

    const draftBranch = createBranch(setupResult, 'Safe draft leaf');
    const preview = editPreview(setupResult, draftBranch.branchId, draftBranch.head, 1, (tree) => {
      tree.nodes.push(safeDraftLeaf(leaf(tree), 'snowman.head.eyes.draft', 2));
    });
    const draft = preview.targetTree.nodes.find((node) => node.id === 'snowman.head.eyes.draft');
    expect(draft).toMatchObject({
      kind: 'leaf',
      action: null,
      validation: { status: 'candidate' },
    });
    expect(commitEdit(setupResult, draftBranch.branchId, preview).result).toMatchObject({
      result: 'accepted',
    });
  });

  it('creates a durable branch workspace and commits an exact idempotent edit', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Main');
    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'Create and adjust the reviewed eye sphere';
    });

    expect(preview.diff.entries).toEqual([
      expect.objectContaining({
        operation: 'replace',
        after: 'Create and adjust the reviewed eye sphere',
      }),
    ]);
    const committed = commitEdit(setupResult, branch.branchId, preview);
    expect(committed.result).toMatchObject({ result: 'accepted', operation: 'edit' });
    expect(setupResult.coordinator.commit(committed.request)).toMatchObject({
      result: 'duplicate',
    });
    expect(
      setupResult.coordinator.workspace({
        formatVersion: '1.0.0',
        treeId: setupResult.base.id,
        branchId: branch.branchId,
      }),
    ).toMatchObject({
      branch: { head: { revision: 2 } },
      tree: { revision: 2 },
      commentsAreTreeContent: false,
    });
    expect(
      setupResult.coordinator.history({
        formatVersion: '1.0.0',
        treeId: setupResult.base.id,
        branchId: branch.branchId,
        expectedHead: committed.result.branch.head,
      }).commits,
    ).toHaveLength(1);
  });

  it('keeps paginating an exact history snapshot after the branch advances', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Main');
    const firstPreview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'First history revision';
    });
    const first = commitEdit(setupResult, branch.branchId, firstPreview).result;
    const secondPreview = editPreview(
      setupResult,
      branch.branchId,
      first.branch.head,
      2,
      (tree) => {
        leaf(tree).title = 'Second history revision';
      },
    );
    const second = commitEdit(setupResult, branch.branchId, secondPreview).result;
    const snapshotHead = second.branch.head;
    const thirdPreview = editPreview(setupResult, branch.branchId, snapshotHead, 3, (tree) => {
      leaf(tree).title = 'Concurrent later revision';
    });
    commitEdit(setupResult, branch.branchId, thirdPreview);

    const firstPage = setupResult.coordinator.history({
      formatVersion: '1.0.0',
      treeId: setupResult.base.id,
      branchId: branch.branchId,
      expectedHead: snapshotHead,
      limit: 1,
    });
    expect(firstPage).toMatchObject({
      snapshotHead,
      commits: [{ revision: { revision: 2 } }],
      nextAfterRevision: 2,
    });
    const secondPage = setupResult.coordinator.history({
      formatVersion: '1.0.0',
      treeId: setupResult.base.id,
      branchId: branch.branchId,
      expectedHead: snapshotHead,
      afterRevision: firstPage.nextAfterRevision!,
      limit: 1,
    });
    expect(secondPage).toMatchObject({
      snapshotHead,
      commits: [{ revision: { revision: 3 } }],
      nextAfterRevision: null,
    });
    expect([...firstPage.commits, ...secondPage.commits]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ revision: { revision: 4 } })]),
    );
    expect(() =>
      setupResult.coordinator.history({
        formatVersion: '1.0.0',
        treeId: setupResult.base.id,
        branchId: branch.branchId,
        expectedHead: { ...snapshotHead, contentSha256: '0'.repeat(64) },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({ code: 'invalid_cursor' }),
    );
  });

  it('keeps exact retries idempotent after validation rules change', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Main');
    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'Historically accepted candidate';
    });
    const committed = commitEdit(setupResult, branch.branchId, preview);
    setupResult.validation.reject = true;

    expect(setupResult.coordinator.commit(committed.request)).toMatchObject({
      result: 'duplicate',
    });
    expect(() =>
      setupResult.coordinator.commit({ ...committed.request, message: 'Poisoned retry' }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({ code: 'conflict' }),
    );
  });

  it('rejects a preview after another branch consumes the global revision', () => {
    const setupResult = trackedSetup();
    const main = createBranch(setupResult, 'Main');
    const feature = createBranch(setupResult, 'Feature');
    const mainPreview = editPreview(setupResult, main.branchId, main.head, 1, (tree) => {
      leaf(tree).title = 'Main branch';
    });
    const stalePreview = editPreview(setupResult, feature.branchId, feature.head, 1, (tree) => {
      leaf(tree).title = 'Feature branch';
    });
    commitEdit(setupResult, main.branchId, mainPreview);

    expect(() => commitEdit(setupResult, feature.branchId, stalePreview)).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({ code: 'stale_head' }),
    );
  });

  it('merges independent branch edits through their unique common ancestor', () => {
    const setupResult = trackedSetup();
    const main = createBranch(setupResult, 'Main');
    const feature = createBranch(setupResult, 'Feature');
    const mainCommit = commitEdit(
      setupResult,
      main.branchId,
      editPreview(setupResult, main.branchId, main.head, 1, (tree) => {
        leaf(tree).title = 'Main branch title';
      }),
    ).result;
    const featureCommit = commitEdit(
      setupResult,
      feature.branchId,
      editPreview(setupResult, feature.branchId, feature.head, 2, (tree) => {
        tree.title = 'Feature branch procedure title';
      }),
    ).result;

    const preview = setupResult.coordinator.previewMerge({
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      targetBranchId: main.branchId,
      sourceBranchId: feature.branchId,
      targetHead: mainCommit.branch.head,
      sourceHead: featureCommit.branch.head,
      expectedLatestRevision: 3,
    });
    expect(preview.status).toBe('ready');
    if (preview.status !== 'ready') throw new Error('Expected ready merge');
    expect(preview.mergeBase.revision).toBe(1);
    expect(leaf(preview.targetCandidate)).toMatchObject({
      title: 'Main branch title',
    });
    expect(preview.targetCandidate.title).toBe('Feature branch procedure title');

    const committed = setupResult.coordinator.commit({
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      occurredAt,
      operation: 'merge',
      targetBranchId: main.branchId,
      expectedHead: preview.targetHead,
      previewBinding: preview.binding,
      targetTree: preview.targetCandidate,
      targetIntegrity: preview.targetIntegrity,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    expect(committed).toMatchObject({
      result: 'accepted',
      branch: { head: { revision: 4 } },
      commit: {
        source: { branchId: feature.branchId, revision: { revision: 3 } },
        mergeBase: { revision: 1 },
      },
    });
  });

  it('resolves an exact complete conflict preview and commits source lineage', () => {
    const setupResult = trackedSetup();
    const main = createBranch(setupResult, 'Main');
    const feature = createBranch(setupResult, 'Feature');
    const mainCommit = commitEdit(
      setupResult,
      main.branchId,
      editPreview(setupResult, main.branchId, main.head, 1, (tree) => {
        leaf(tree).title = 'Target title';
        leaf(tree).intent = 'Target intent';
      }),
    ).result;
    const featureCommit = commitEdit(
      setupResult,
      feature.branchId,
      editPreview(setupResult, feature.branchId, feature.head, 2, (tree) => {
        leaf(tree).title = 'Source title';
        leaf(tree).intent = 'Source intent';
      }),
    ).result;

    const request = {
      formatVersion: '1.0.0' as const,
      requestId: randomUUID(),
      targetBranchId: main.branchId,
      sourceBranchId: feature.branchId,
      targetHead: mainCommit.branch.head,
      sourceHead: featureCommit.branch.head,
      expectedLatestRevision: 3,
    };
    const conflicts = setupResult.coordinator.previewMerge(request);
    expect(conflicts).toMatchObject({
      status: 'conflicts',
      conflicts: expect.arrayContaining([
        expect.objectContaining({
          target: { present: true, value: 'Target intent' },
          source: { present: true, value: 'Source intent' },
        }),
      ]),
    });
    if (conflicts.status !== 'conflicts') throw new Error('Expected merge conflicts');
    expect(conflicts.proposalCreated).toBe(false);
    expect(conflicts.hostExecutionStarted).toBe(false);

    expect(() =>
      setupResult.coordinator.previewMerge({
        ...request,
        resolutions: [{ conflict: conflicts.conflicts[0]!, choice: 'source' }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'preview_binding_mismatch',
      }),
    );
    const tampered = structuredClone(conflicts.conflicts);
    tampered[0]!.source = { present: true, value: 999 };
    expect(() =>
      setupResult.coordinator.previewMerge({
        ...request,
        resolutions: tampered.map((conflict) => ({ conflict, choice: 'source' as const })),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'preview_binding_mismatch',
      }),
    );

    const preview = setupResult.coordinator.previewMerge({
      ...request,
      resolutions: conflicts.conflicts.map((conflict) => ({
        conflict,
        choice:
          conflict.target.present && conflict.target.value === 'Target intent'
            ? ('source' as const)
            : ('target' as const),
      })),
    });
    if (preview.status !== 'ready') throw new Error('Expected resolved merge preview');
    expect(leaf(preview.targetCandidate)).toMatchObject({
      title: 'Target title',
      intent: 'Source intent',
    });
    const committed = setupResult.coordinator.commit({
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      occurredAt,
      operation: 'merge',
      targetBranchId: main.branchId,
      expectedHead: preview.targetHead,
      previewBinding: preview.binding,
      targetTree: preview.targetCandidate,
      targetIntegrity: preview.targetIntegrity,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    expect(committed).toMatchObject({
      result: 'accepted',
      proposalCreated: false,
      hostExecutionStarted: false,
      commit: {
        source: { branchId: feature.branchId, revision: { revision: 3 } },
        mergeBase: { revision: 1 },
      },
    });
  });

  it('stores branch-scoped comments outside tree content and validates anchors', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Main');
    const before = setupResult.coordinator.workspace({
      formatVersion: '1.0.0',
      treeId: setupResult.base.id,
      branchId: branch.branchId,
    })!;
    const request = {
      formatVersion: '1.0.0' as const,
      requestId: randomUUID(),
      branchId: branch.branchId,
      revision: branch.head,
      anchor: {
        kind: 'node' as const,
        treeId: setupResult.base.id,
        nodeId: leaf(setupResult.base).id,
      },
      body: 'Increase the eye radius after review.',
      occurredAt,
    };
    expect(setupResult.coordinator.createComment(request)).toMatchObject({ result: 'accepted' });
    expect(setupResult.coordinator.createComment(request)).toMatchObject({ result: 'duplicate' });
    expect(
      setupResult.coordinator.listComments({
        formatVersion: '1.0.0',
        treeId: setupResult.base.id,
        branchId: branch.branchId,
        revision: branch.head,
      }).comments,
    ).toEqual([expect.objectContaining({ body: request.body, anchor: request.anchor })]);
    const after = setupResult.coordinator.workspace({
      formatVersion: '1.0.0',
      treeId: setupResult.base.id,
      branchId: branch.branchId,
    })!;
    expect(after.integrity.contentSha256).toBe(before.integrity.contentSha256);
    expect(after.tree).toEqual(before.tree);
  });

  it('keeps legacy and non-Action parameter forms read-only', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Main');
    const selectedLeaf = leaf(setupResult.base);
    const action = setupResult.coordinator.parameterForm({
      formatVersion: '1.0.0',
      branchId: branch.branchId,
      revision: branch.head,
      target: { kind: 'action', nodeId: selectedLeaf.id },
    });
    expect(action.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'radius', editable: false }),
        expect.objectContaining({ name: 'location', editable: false }),
        expect.objectContaining({ name: 'objectName', editable: false }),
      ]),
    );

    const menuTrack = selectedLeaf.menuTracks.find((track) => track.availability === 'available')!;
    const menuOperation = menuTrack.operations.find(
      (operation) => Object.keys(operation.parameters).length > 0,
    )!;
    expect(
      setupResult.coordinator.parameterForm({
        formatVersion: '1.0.0',
        branchId: branch.branchId,
        revision: branch.head,
        target: {
          kind: 'menu',
          nodeId: selectedLeaf.id,
          trackId: menuTrack.id,
          operationId: menuOperation.id,
        },
      }).fields,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ editable: false })]));

    const mcpTrack = selectedLeaf.mcpTracks.find((track) => track.availability === 'available')!;
    const mcpOperation = mcpTrack.operations[0]!;
    expect(
      setupResult.coordinator.parameterForm({
        formatVersion: '1.0.0',
        branchId: branch.branchId,
        revision: branch.head,
        target: {
          kind: 'mcp',
          nodeId: selectedLeaf.id,
          trackId: mcpTrack.id,
          operationId: mcpOperation.id,
        },
      }).fields,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ editable: false })]));
  });

  it('projects catalog-authorized Action edits and recomputes the same commit preview', () => {
    const setupResult = trackedSetup(configureProjectedEditorTree, projectedRadiusCatalog);
    const branch = createBranch(setupResult, 'Projected edits');
    const selected = leaf(setupResult.base);
    const actionForm = setupResult.coordinator.parameterForm({
      formatVersion: '1.0.0',
      branchId: branch.branchId,
      revision: branch.head,
      target: { kind: 'action', nodeId: selected.id },
    });
    expect(actionForm.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'radius', kind: 'number', editable: true }),
        expect.objectContaining({ name: 'location', kind: 'number_vector', editable: true }),
        expect.objectContaining({ name: 'objectName', editable: false }),
        expect.objectContaining({ name: 'resourceId', editable: false }),
      ]),
    );
    const semanticForm = setupResult.coordinator.parameterForm({
      formatVersion: '1.0.0',
      branchId: branch.branchId,
      revision: branch.head,
      target: { kind: 'semantic', nodeId: selected.id, operationId: 'semantic.create' },
    });
    expect(semanticForm.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ editable: false })]),
    );

    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).action!.arguments['radius'] = 0.2;
      leaf(tree).action!.arguments['location'] = [1, 2, 3];
    });
    expect(leaf(preview.targetTree).semanticOperations[0]!.parameters['radius']).toBe(0.2);
    expect(leaf(preview.targetTree).semanticOperations[1]!.parameters['location']).toEqual([
      1, 2, 3,
    ]);
    const committed = commitEdit(setupResult, branch.branchId, preview);
    expect(committed.result).toMatchObject({
      result: 'accepted',
      branch: { head: { revision: 2 } },
    });
    expect(setupResult.coordinator.commit(committed.request)).toMatchObject({
      result: 'duplicate',
    });
  });

  it('rejects commit targets and receipts changed after preview, even with recomputed public hashes', () => {
    const setupResult = trackedSetup();
    const branch = createBranch(setupResult, 'Commit binding');
    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'Previewed title';
    });
    const original = {
      formatVersion: '1.0.0' as const,
      requestId: randomUUID(),
      occurredAt,
      operation: 'edit' as const,
      targetBranchId: branch.branchId,
      expectedHead: preview.base,
      previewBinding: preview.binding,
      targetTree: preview.targetTree,
      targetIntegrity: preview.targetIntegrity,
      message: 'Edit ProcedureTree',
      proposalCreated: false as const,
      hostExecutionStarted: false as const,
    };

    const changedTarget = structuredClone(original);
    leaf(changedTarget.targetTree).title = 'Changed after preview';
    changedTarget.targetIntegrity.contentSha256 = hash(changedTarget.targetTree);
    changedTarget.previewBinding.target.contentSha256 = changedTarget.targetIntegrity.contentSha256;
    const { previewContentSha256: _oldTargetDigest, ...changedTargetUnsigned } =
      changedTarget.previewBinding;
    void _oldTargetDigest;
    changedTarget.previewBinding.previewContentSha256 = hash(changedTargetUnsigned);
    expect(() => setupResult.coordinator.commit(changedTarget)).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'preview_binding_mismatch',
        statusCode: 409,
      }),
    );

    const changedDiff = structuredClone(original);
    changedDiff.previewBinding.diffContentSha256 = 'a'.repeat(64);
    const { previewContentSha256: _oldDiffDigest, ...changedDiffUnsigned } =
      changedDiff.previewBinding;
    void _oldDiffDigest;
    changedDiff.previewBinding.previewContentSha256 = hash(changedDiffUnsigned);
    expect(() => setupResult.coordinator.commit(changedDiff)).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'preview_binding_mismatch',
        statusCode: 409,
      }),
    );

    const changedDigest = structuredClone(original);
    changedDigest.previewBinding.previewContentSha256 = 'b'.repeat(64);
    expect(() => setupResult.coordinator.commit(changedDigest)).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'preview_binding_mismatch',
        statusCode: 409,
      }),
    );
  });

  it('rejects legacy Action edits and forged bound or unbound representation values', () => {
    const legacy = trackedSetup();
    const legacyBranch = createBranch(legacy, 'Legacy readonly');
    expect(() =>
      editPreview(legacy, legacyBranch.branchId, legacyBranch.head, 1, (tree) => {
        leaf(tree).action!.arguments['radius'] = 0.2;
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );

    const projected = trackedSetup(configureProjectedEditorTree, projectedRadiusCatalog);
    const projectedBranch = createBranch(projected, 'Projection authority');
    expect(() =>
      editPreview(projected, projectedBranch.branchId, projectedBranch.head, 1, (tree) => {
        leaf(tree).action!.arguments['radius'] = 0.2;
        leaf(tree).semanticOperations[0]!.parameters['radius'] = 999;
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );
    expect(() =>
      editPreview(projected, projectedBranch.branchId, projectedBranch.head, 1, (tree) => {
        leaf(tree).semanticOperations[1]!.parameters['scale'] = [9, 9, 9];
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );
  });

  it('keeps projectionless legacy editing and forms available without an InteractionCatalog', () => {
    const setupResult = trackedSetup(undefined, () => {
      throw new Error('Historical InteractionCatalog is intentionally unavailable');
    });
    const branch = createBranch(setupResult, 'Catalog-free legacy');
    const form = setupResult.coordinator.parameterForm({
      formatVersion: '1.0.0',
      branchId: branch.branchId,
      revision: branch.head,
      target: { kind: 'action', nodeId: leaf(setupResult.base).id },
    });
    expect(form.fields.every((field) => !field.editable)).toBe(true);
    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      leaf(tree).title = 'Legacy title edited without the historical interaction catalog';
    });
    expect(leaf(preview.targetTree).title).toContain('without the historical');
    expect(commitEdit(setupResult, branch.branchId, preview).result).toMatchObject({
      result: 'accepted',
    });
  });

  it('allows a catalog-projected leaf to be deleted when its parent keeps another child', () => {
    const setupResult = trackedSetup((tree) => {
      configureProjectedEditorTree(tree);
      const selected = leaf(tree);
      const sibling = structuredClone(selected);
      sibling.id = 'snowman.head.eyes.reference';
      sibling.order = 2;
      sibling.action = null;
      delete sibling.observationPolicy;
      delete sibling.parameterProjection;
      sibling.validation = { status: 'candidate', validatedHostVersions: [], notes: [] };
      tree.nodes.push(sibling);
    }, projectedRadiusCatalog);
    const branch = createBranch(setupResult, 'Delete projected leaf');
    const projectedLeafId = leaf(setupResult.base).id;
    const preview = editPreview(setupResult, branch.branchId, branch.head, 1, (tree) => {
      tree.nodes = tree.nodes.filter((node) => node.id !== projectedLeafId);
      const sibling = tree.nodes.find((node) => node.id === 'snowman.head.eyes.reference');
      if (sibling === undefined) throw new Error('Expected retained sibling');
      sibling.order = 1;
    });
    expect(preview.targetTree.nodes.some((node) => node.id === projectedLeafId)).toBe(false);
    expect(commitEdit(setupResult, branch.branchId, preview).result).toMatchObject({
      result: 'accepted',
    });
  });

  it('rejects mixed projection conflict choices and accepts a consistent merge', () => {
    const setupResult = trackedSetup(configureProjectedEditorTree, projectedRadiusCatalog);
    const main = createBranch(setupResult, 'Projection target');
    const feature = createBranch(setupResult, 'Projection source');
    const mainCommit = commitEdit(
      setupResult,
      main.branchId,
      editPreview(setupResult, main.branchId, main.head, 1, (tree) => {
        leaf(tree).action!.arguments['radius'] = 0.2;
      }),
    ).result;
    const featureCommit = commitEdit(
      setupResult,
      feature.branchId,
      editPreview(setupResult, feature.branchId, feature.head, 2, (tree) => {
        leaf(tree).action!.arguments['radius'] = 0.3;
      }),
    ).result;
    const request = {
      formatVersion: '1.0.0' as const,
      requestId: randomUUID(),
      targetBranchId: main.branchId,
      sourceBranchId: feature.branchId,
      targetHead: mainCommit.branch.head,
      sourceHead: featureCommit.branch.head,
      expectedLatestRevision: 3,
    };
    const conflicts = setupResult.coordinator.previewMerge(request);
    if (conflicts.status !== 'conflicts') throw new Error('Expected projection conflicts');
    const actionConflict = conflicts.conflicts.find((conflict) =>
      conflict.path.some((segment) => segment.kind === 'field' && segment.name === 'arguments'),
    );
    const semanticConflict = conflicts.conflicts.find((conflict) =>
      conflict.path.some((segment) => segment.kind === 'field' && segment.name === 'parameters'),
    );
    if (actionConflict === undefined || semanticConflict === undefined) {
      throw new Error('Expected Action and semantic projection conflicts');
    }
    expect(() =>
      setupResult.coordinator.previewMerge({
        ...request,
        resolutions: conflicts.conflicts.map((conflict) => ({
          conflict,
          choice: conflict === actionConflict ? ('source' as const) : ('target' as const),
        })),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTreeEditorError>>({
        code: 'validation_failed',
        statusCode: 422,
      }),
    );

    const preview = setupResult.coordinator.previewMerge({
      ...request,
      resolutions: conflicts.conflicts.map((conflict) => ({
        conflict,
        choice: 'source' as const,
      })),
    });
    if (preview.status !== 'ready') throw new Error('Expected consistent projection merge');
    expect(leaf(preview.targetCandidate).action!.arguments['radius']).toBe(0.3);
    expect(leaf(preview.targetCandidate).semanticOperations[0]!.parameters['radius']).toBe(0.3);
    expect(
      setupResult.coordinator.commit({
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        occurredAt,
        operation: 'merge',
        targetBranchId: main.branchId,
        expectedHead: preview.targetHead,
        previewBinding: preview.binding,
        targetTree: preview.targetCandidate,
        targetIntegrity: preview.targetIntegrity,
        proposalCreated: false,
        hostExecutionStarted: false,
      }),
    ).toMatchObject({ result: 'accepted', branch: { head: { revision: 4 } } });
  });

  it.each([
    ['const', 'radius', { type: 'number', const: 0.12 }],
    ['exclusiveMinimum', 'radius', { type: 'number', exclusiveMinimum: 0 }],
    ['oneOf', 'radius', { type: 'number', oneOf: [{ minimum: 0 }] }],
    ['anyOf', 'radius', { type: 'number', anyOf: [{ minimum: 0 }] }],
    ['custom keyword', 'radius', { type: 'number', operatingLineConstraint: true }],
    [
      'unsupported array item constraint',
      'location',
      {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'number', exclusiveMinimum: -1_000 },
      },
    ],
  ])('fails closed for %s Action schemas', (_label, fieldName, unsupportedSchema) => {
    const setupResult = trackedSetup(
      configureProjectedEditorTree,
      projectedRadiusCatalog,
      (tree) => {
        const result = structuredClone(catalog(tree));
        const action = result.actions.find(
          (candidate) => candidate.name === leaf(tree).action?.name,
        );
        if (action === undefined) throw new Error('Expected Action schema');
        const properties = action.argumentsSchema['properties'] as Record<string, unknown>;
        properties[fieldName] = unsupportedSchema;
        return result;
      },
    );
    const branch = createBranch(setupResult, `Unsupported ${_label}`);
    const form = setupResult.coordinator.parameterForm({
      formatVersion: '1.0.0',
      branchId: branch.branchId,
      revision: branch.head,
      target: { kind: 'action', nodeId: leaf(setupResult.base).id },
    });
    expect(form.fields.find((field) => field.name === fieldName)).toMatchObject({
      editable: false,
    });
  });
});
