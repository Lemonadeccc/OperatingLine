import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  blenderActionCatalog,
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  materializeProcedureAuthoringCandidate,
  startRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  parseProcedureTree,
  procedureAuthoringCandidateTreeSchema,
  type ProcedureLeafNode,
  type ProcedureTree,
  type ProcedureTreeEditorBranch,
  type ProcedureTreeEditorBranchCreateResult,
  type ProcedureTreeEditorBranchHistoryResult,
  type ProcedureTreeEditorCommentCreateResult,
  type ProcedureTreeEditorCommentListResult,
  type ProcedureTreeEditorCommitResult,
  type ProcedureTreeEditorEditPreviewResult,
  type ProcedureTreeEditorMergePreviewResult,
  type ProcedureTreeEditorParameterFormResult,
  type ProcedureTreeEditorWorkspaceResult,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const accessToken = 'procedure-tree-editor-runtime-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const occurredAt = '2026-08-19T10:00:00.000Z';

function contentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function fixture(): ProcedureTree {
  const input = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  return parseProcedureTree(input);
}

function projectedFixture(): ProcedureTree {
  const input = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  input['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  input['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  input['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  for (const node of input['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.input.${modality}`,
          availability: 'unavailable',
          title: `Unmaterialized ${modality}`,
          reason: 'Awaiting exact InteractionCatalog materialization.',
          modality,
        },
      ];
    }
  }
  const candidate = procedureAuthoringCandidateTreeSchema.parse(input);
  return materializeProcedureAuthoringCandidate(
    candidate,
    blenderActionCatalog,
    blenderInteractionCatalog,
  ).tree;
}

function leaf(tree: ProcedureTree): ProcedureLeafNode {
  const result = tree.nodes.find((node) => node.kind === 'leaf');
  if (result?.kind !== 'leaf') throw new Error('Expected ProcedureTree leaf');
  return result;
}

async function postJson<Result>(
  runtime: RunningRuntime,
  path: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: Result }> {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Result };
}

async function createBranch(
  runtime: RunningRuntime,
  tree: StoredProcedureTree,
  name: string,
): Promise<ProcedureTreeEditorBranch> {
  const response = await postJson<ProcedureTreeEditorBranchCreateResult>(
    runtime,
    '/api/v1/procedure/editor/branches/create',
    {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      treeId: tree.tree.id,
      name,
      createdFrom: {
        treeId: tree.tree.id,
        revision: tree.tree.revision,
        contentSha256: tree.integrity.contentSha256,
      },
      occurredAt,
    },
  );
  expect(response.status).toBe(200);
  return response.body.branch;
}

async function previewEdit(
  runtime: RunningRuntime,
  branch: ProcedureTreeEditorBranch,
  expectedLatestRevision: number,
  mutate: (tree: ProcedureTree) => void,
): Promise<ProcedureTreeEditorEditPreviewResult> {
  const workspace = await postJson<ProcedureTreeEditorWorkspaceResult>(
    runtime,
    '/api/v1/procedure/editor/workspaces/get',
    { formatVersion: '1.0.0', treeId: branch.treeId, branchId: branch.branchId },
  );
  const targetTree = structuredClone(workspace.body.tree);
  targetTree.revision = expectedLatestRevision + 1;
  mutate(targetTree);
  const preview = await postJson<ProcedureTreeEditorEditPreviewResult>(
    runtime,
    '/api/v1/procedure/editor/edits/preview',
    {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      branchId: branch.branchId,
      base: branch.head,
      expectedLatestRevision,
      targetTree,
      message: 'Runtime editor integration change',
    },
  );
  expect(preview.status).toBe(200);
  return preview.body;
}

async function commitEdit(
  runtime: RunningRuntime,
  branch: ProcedureTreeEditorBranch,
  preview: ProcedureTreeEditorEditPreviewResult,
): Promise<ProcedureTreeEditorCommitResult> {
  const response = await postJson<ProcedureTreeEditorCommitResult>(
    runtime,
    '/api/v1/procedure/editor/commits/create',
    {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      occurredAt,
      operation: 'edit',
      targetBranchId: branch.branchId,
      expectedHead: branch.head,
      previewBinding: preview.binding,
      targetTree: preview.targetTree,
      targetIntegrity: preview.targetIntegrity,
      message: 'Runtime editor integration change',
      proposalCreated: false,
      hostExecutionStarted: false,
    },
  );
  expect(response.status).toBe(200);
  return response.body;
}

describe('ProcedureTree editor HTTP runtime', () => {
  it('edits, comments, branches, merges, and restores the visual workspace across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-'));
    const databasePath = join(directory, 'state.db');
    let runtime: RunningRuntime | undefined;
    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      const unauthorized = await fetch(`${runtime.baseUrl}/api/v1/procedure/editor/branches/list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formatVersion: '1.0.0', treeId: fixture().id }),
      });
      expect(unauthorized.status).toBe(401);

      const storedResponse = await postJson<{ record: StoredProcedureTree }>(
        runtime,
        '/api/v1/procedure/store',
        { tree: fixture() },
      );
      expect(storedResponse.status).toBe(200);
      const stored = storedResponse.body.record;
      const main = await createBranch(runtime, stored, 'Main');
      const feature = await createBranch(runtime, stored, 'Feature');

      const branchList = await postJson<{ branches: ProcedureTreeEditorBranch[] }>(
        runtime,
        '/api/v1/procedure/editor/branches/list',
        { formatVersion: '1.0.0', treeId: stored.tree.id },
      );
      expect(branchList.body.branches.map((branch) => branch.name).sort()).toEqual([
        'Feature',
        'Main',
      ]);
      const branchGet = await postJson<{ branch: ProcedureTreeEditorBranch }>(
        runtime,
        '/api/v1/procedure/editor/branches/get',
        {
          formatVersion: '1.0.0',
          treeId: stored.tree.id,
          branchId: main.branchId,
        },
      );
      expect(branchGet.body.branch).toEqual(main);

      const actionForm = await postJson<ProcedureTreeEditorParameterFormResult>(
        runtime,
        '/api/v1/procedure/editor/parameters/form',
        {
          formatVersion: '1.0.0',
          branchId: main.branchId,
          revision: main.head,
          target: { kind: 'action', nodeId: leaf(stored.tree).id },
        },
      );
      expect(actionForm.status).toBe(200);
      expect(actionForm.body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'radius', editable: false }),
          expect.objectContaining({ name: 'objectName', editable: false }),
        ]),
      );

      const mainCommit = await commitEdit(
        runtime,
        main,
        await previewEdit(runtime, main, 1, (tree) => {
          leaf(tree).title = 'Reviewed main-branch eye';
        }),
      );
      const featureCommit = await commitEdit(
        runtime,
        feature,
        await previewEdit(runtime, feature, 2, (tree) => {
          tree.title = 'Feature procedure title';
        }),
      );

      const mergePreview = await postJson<ProcedureTreeEditorMergePreviewResult>(
        runtime,
        '/api/v1/procedure/editor/merges/preview',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          targetBranchId: main.branchId,
          sourceBranchId: feature.branchId,
          targetHead: mainCommit.branch.head,
          sourceHead: featureCommit.branch.head,
          expectedLatestRevision: 3,
        },
      );
      expect(mergePreview.status).toBe(200);
      expect(mergePreview.body.status).toBe('ready');
      if (mergePreview.body.status !== 'ready') throw new Error('Expected ready merge');
      const mergeCommit = await postJson<ProcedureTreeEditorCommitResult>(
        runtime,
        '/api/v1/procedure/editor/commits/create',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          occurredAt,
          operation: 'merge',
          targetBranchId: main.branchId,
          expectedHead: mergePreview.body.targetHead,
          previewBinding: mergePreview.body.binding,
          targetTree: mergePreview.body.targetCandidate,
          targetIntegrity: mergePreview.body.targetIntegrity,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      );
      expect(mergeCommit.body).toMatchObject({
        branch: { head: { revision: 4 } },
        commit: { source: { branchId: feature.branchId, revision: { revision: 3 } } },
      });

      const commentRequest = {
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        branchId: main.branchId,
        revision: mergeCommit.body.branch.head,
        anchor: { kind: 'node', treeId: stored.tree.id, nodeId: leaf(stored.tree).id },
        body: 'The merged eye size is ready for final review.',
        occurredAt,
      };
      const comment = await postJson<ProcedureTreeEditorCommentCreateResult>(
        runtime,
        '/api/v1/procedure/editor/comments/create',
        commentRequest,
      );
      expect(comment.body).toMatchObject({ result: 'accepted', commentsAreTreeContent: false });
      const comments = await postJson<ProcedureTreeEditorCommentListResult>(
        runtime,
        '/api/v1/procedure/editor/comments/list',
        {
          formatVersion: '1.0.0',
          treeId: stored.tree.id,
          branchId: main.branchId,
        },
      );
      expect(comments.body.comments).toEqual([
        expect.objectContaining({ body: commentRequest.body }),
      ]);
      const history = await postJson<ProcedureTreeEditorBranchHistoryResult>(
        runtime,
        '/api/v1/procedure/editor/history/list',
        {
          formatVersion: '1.0.0',
          treeId: stored.tree.id,
          branchId: main.branchId,
          expectedHead: mergeCommit.body.branch.head,
        },
      );
      expect(history.body.snapshotHead).toEqual(mergeCommit.body.branch.head);
      expect(history.body.commits).toHaveLength(2);
      expect(history.body.commits.at(-1)).toMatchObject({
        operation: 'merge',
        source: { branchId: feature.branchId },
      });

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      const restored = await postJson<ProcedureTreeEditorWorkspaceResult>(
        runtime,
        '/api/v1/procedure/editor/workspaces/get',
        { formatVersion: '1.0.0', treeId: stored.tree.id, branchId: main.branchId },
      );
      expect(restored.body).toMatchObject({
        branch: { head: { revision: 4 } },
        tree: { revision: 4 },
        commentsAreTreeContent: false,
      });
      const restoredComments = await postJson<ProcedureTreeEditorCommentListResult>(
        runtime,
        '/api/v1/procedure/editor/comments/list',
        {
          formatVersion: '1.0.0',
          treeId: stored.tree.id,
          branchId: main.branchId,
        },
      );
      expect(restoredComments.body.comments).toHaveLength(1);
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('projects authorized Action parameters through HTTP and rejects direct representation edits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-projection-'));
    const runtime = await startRuntime({
      databasePath: join(directory, 'state.db'),
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const storedResponse = await postJson<{ record: StoredProcedureTree }>(
        runtime,
        '/api/v1/procedure/store',
        { tree: projectedFixture() },
      );
      expect(storedResponse.status).toBe(200);
      const stored = storedResponse.body.record;
      const branch = await createBranch(runtime, stored, 'Projected edits');
      const actionForm = await postJson<ProcedureTreeEditorParameterFormResult>(
        runtime,
        '/api/v1/procedure/editor/parameters/form',
        {
          formatVersion: '1.0.0',
          branchId: branch.branchId,
          revision: branch.head,
          target: { kind: 'action', nodeId: leaf(stored.tree).id },
        },
      );
      expect(actionForm.status).toBe(200);
      expect(actionForm.body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'radius', editable: true }),
          expect.objectContaining({ name: 'location', editable: true }),
          expect.objectContaining({ name: 'objectName', editable: true }),
          expect.objectContaining({ name: 'resourceId', editable: false }),
        ]),
      );

      const preview = await previewEdit(runtime, branch, 1, (tree) => {
        const selected = leaf(tree);
        selected.action!.arguments['radius'] = 0.5;
        selected.action!.arguments['location'] = [4, 5, 6];
        selected.action!.arguments['objectName'] = 'OperatingLine.ProjectedEye';
      });
      const projectedLeaf = leaf(preview.targetTree);
      expect(projectedLeaf.semanticOperations[1]!.parameters).toEqual({
        location: [4, 5, 6],
        scale: [0.5, 0.5, 0.5],
      });
      expect(projectedLeaf.semanticOperations[2]!.parameters).toEqual({
        name: 'OperatingLine.ProjectedEye',
      });
      const menu = projectedLeaf.menuTracks[0];
      const shortcut = projectedLeaf.shortcutTracks[0];
      if (menu?.availability !== 'available' || shortcut?.availability !== 'available') {
        throw new Error('Expected projected menu and shortcut tracks');
      }
      expect(menu.operations.slice(4).map((operation) => operation.parameters)).toEqual([
        { value: [4, 5, 6] },
        { value: [0.5, 0.5, 0.5] },
        { value: 'OperatingLine.ProjectedEye' },
      ]);
      expect(shortcut.operations.slice(1).map((operation) => operation.parameters)).toEqual([
        { value: 4, confirm: 'ENTER' },
        { value: 5, confirm: 'ENTER' },
        { value: 6, confirm: 'ENTER' },
        { value: 0.5, confirm: 'ENTER' },
        { text: 'OperatingLine.ProjectedEye', confirm: 'ENTER' },
      ]);

      const commitRequest = {
        formatVersion: '1.0.0' as const,
        requestId: randomUUID(),
        occurredAt,
        operation: 'edit' as const,
        targetBranchId: branch.branchId,
        expectedHead: branch.head,
        previewBinding: preview.binding,
        targetTree: preview.targetTree,
        targetIntegrity: preview.targetIntegrity,
        message: 'Projected HTTP edit',
        proposalCreated: false as const,
        hostExecutionStarted: false as const,
      };
      const wrongToken = await fetch(`${runtime.baseUrl}/api/v1/procedure/editor/commits/create`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(commitRequest),
      });
      expect(wrongToken.status).toBe(401);
      const committed = await postJson<ProcedureTreeEditorCommitResult>(
        runtime,
        '/api/v1/procedure/editor/commits/create',
        commitRequest,
      );
      expect(committed).toMatchObject({
        status: 200,
        body: { result: 'accepted', branch: { head: { revision: 2 } } },
      });

      const workspace = await postJson<ProcedureTreeEditorWorkspaceResult>(
        runtime,
        '/api/v1/procedure/editor/workspaces/get',
        { formatVersion: '1.0.0', treeId: stored.tree.id, branchId: branch.branchId },
      );
      const forged = structuredClone(workspace.body.tree);
      forged.revision = 3;
      leaf(forged).semanticOperations[1]!.parameters['scale'] = [9, 9, 9];
      const forgedPreview = await postJson<{ error: string }>(
        runtime,
        '/api/v1/procedure/editor/edits/preview',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          branchId: branch.branchId,
          base: committed.body.branch.head,
          expectedLatestRevision: 2,
          targetTree: forged,
        },
      );
      expect(forgedPreview).toMatchObject({
        status: 422,
        body: { error: 'procedure_tree_editor_validation_failed' },
      });
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects forged source provenance through the HTTP edit preview', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-policy-'));
    const runtime = await startRuntime({
      databasePath: join(directory, 'state.db'),
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const stored = await postJson<{ record: StoredProcedureTree }>(
        runtime,
        '/api/v1/procedure/store',
        { tree: fixture() },
      );
      const branch = await createBranch(runtime, stored.body.record, 'Main');
      const targetTree = structuredClone(stored.body.record.tree);
      targetTree.revision = 2;
      const source = targetTree.sources[0];
      if (source?.kind !== 'natural_language') throw new Error('Expected natural-language source');
      source.text = 'Forged source provenance';
      const response = await postJson<{ error: string }>(
        runtime,
        '/api/v1/procedure/editor/edits/preview',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          branchId: branch.branchId,
          base: branch.head,
          expectedLatestRevision: 1,
          targetTree,
        },
      );
      expect(response).toMatchObject({
        status: 422,
        body: { error: 'procedure_tree_editor_validation_failed' },
      });
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns 422 for a forbidden merge identity resolution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-identity-'));
    const databasePath = join(directory, 'state.db');
    const database = openOperatingLineDatabase(databasePath);
    const base = fixture();
    const baseHash = contentSha256(base);
    database.recordProcedureTree({
      treeId: base.id,
      revision: base.revision,
      title: base.title,
      adapterId: base.adapterId,
      actionCatalogVersion: base.actionCatalogVersion,
      interactionCatalogVersion: base.interactionCatalogVersion,
      hostVersionRange: base.hostVersionRange,
      contentSha256: baseHash,
      tree: base,
    });
    const targetBranchId = randomUUID();
    const sourceBranchId = randomUUID();
    for (const [branchId, name] of [
      [targetBranchId, 'Target'],
      [sourceBranchId, 'Source'],
    ] as const) {
      database.createProcedureTreeBranch({
        treeId: base.id,
        branchId,
        createdFrom: { revision: 1, contentSha256: baseHash },
        createdAt: occurredAt,
        payload: {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          treeId: base.id,
          name,
          createdFrom: { treeId: base.id, revision: 1, contentSha256: baseHash },
          occurredAt,
        },
      });
    }
    const revisionInput = (tree: ProcedureTree, hash: string) => ({
      treeId: tree.id,
      revision: tree.revision,
      title: tree.title,
      adapterId: tree.adapterId,
      actionCatalogVersion: tree.actionCatalogVersion,
      interactionCatalogVersion: tree.interactionCatalogVersion,
      hostVersionRange: tree.hostVersionRange,
      contentSha256: hash,
      tree,
    });
    const target = structuredClone(base);
    target.revision = 2;
    const targetHash = contentSha256(target);
    expect(
      database.commitProcedureTreeRevision({
        requestId: randomUUID(),
        branchId: targetBranchId,
        operation: 'edit',
        base: { revision: 1, contentSha256: baseHash },
        expectedLatestRevision: 1,
        target: revisionInput(target, targetHash),
        occurredAt,
        payload: {},
      }),
    ).toMatchObject({ result: 'accepted' });
    const source = structuredClone(base);
    source.revision = 3;
    const storedSourceHash = contentSha256(source);
    expect(
      database.commitProcedureTreeRevision({
        requestId: randomUUID(),
        branchId: sourceBranchId,
        operation: 'edit',
        base: { revision: 1, contentSha256: baseHash },
        expectedLatestRevision: 2,
        target: revisionInput(source, storedSourceHash),
        occurredAt,
        payload: {},
      }),
    ).toMatchObject({ result: 'accepted' });
    database.close();
    source.hostVersionRange = '>=9.0.0 <10.0.0';
    const sourceHash = contentSha256(source);
    const sqlite = new DatabaseSync(databasePath);
    sqlite
      .prepare(
        `UPDATE procedure_trees
         SET host_version_range = ?, content_sha256 = ?, payload = ?
         WHERE tree_id = ? AND revision = 3`,
      )
      .run(source.hostVersionRange, sourceHash, JSON.stringify(source), source.id);
    sqlite
      .prepare(
        `UPDATE procedure_tree_revision_commits
         SET target_content_sha256 = ?
         WHERE tree_id = ? AND target_revision = 3`,
      )
      .run(sourceHash, source.id);
    sqlite.close();

    const runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const request = {
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        targetBranchId,
        sourceBranchId,
        targetHead: { treeId: base.id, revision: 2, contentSha256: targetHash },
        sourceHead: { treeId: base.id, revision: 3, contentSha256: sourceHash },
        expectedLatestRevision: 3,
      };
      const preview = await postJson<ProcedureTreeEditorMergePreviewResult>(
        runtime,
        '/api/v1/procedure/editor/merges/preview',
        request,
      );
      expect(preview.status).toBe(200);
      expect(preview.body.status).toBe('conflicts');
      if (preview.body.status !== 'conflicts') throw new Error('Expected identity conflicts');
      const resolved = await postJson<{ error: string }>(
        runtime,
        '/api/v1/procedure/editor/merges/preview',
        {
          ...request,
          resolutions: preview.body.conflicts.map((conflict) => ({
            conflict,
            choice: 'source',
          })),
        },
      );
      expect(resolved).toMatchObject({
        status: 422,
        body: { error: 'procedure_tree_editor_validation_failed' },
      });
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns 422 when an executable leaf is laundered through a new node ID', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-laundering-'));
    const runtime = await startRuntime({
      databasePath: join(directory, 'state.db'),
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const storedResponse = await postJson<{ record: StoredProcedureTree }>(
        runtime,
        '/api/v1/procedure/store',
        { tree: fixture() },
      );
      expect(storedResponse.status).toBe(200);
      const branch = await createBranch(
        runtime,
        storedResponse.body.record,
        'Laundering rejection',
      );
      const workspace = await postJson<ProcedureTreeEditorWorkspaceResult>(
        runtime,
        '/api/v1/procedure/editor/workspaces/get',
        { formatVersion: '1.0.0', treeId: branch.treeId, branchId: branch.branchId },
      );
      const targetTree = structuredClone(workspace.body.tree);
      targetTree.revision = 2;
      const original = leaf(targetTree);
      const forged = structuredClone(original);
      forged.id = 'snowman.head.eyes.forged';
      forged.action!.name = 'blender.mesh.delete_everything';
      forged.semanticOperations[0]!.semanticAction = 'delete_everything';
      targetTree.nodes = targetTree.nodes.filter((node) => node.id !== original.id);
      targetTree.nodes.push(forged);

      const response = await postJson<{ error: string }>(
        runtime,
        '/api/v1/procedure/editor/edits/preview',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          branchId: branch.branchId,
          base: branch.head,
          expectedLatestRevision: 1,
          targetTree,
          message: 'Attempt executable leaf laundering',
        },
      );
      expect(response).toMatchObject({
        status: 422,
        body: { error: 'procedure_tree_editor_validation_failed' },
      });
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed input and returns sanitized editor errors', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-editor-errors-'));
    const databasePath = join(directory, 'state.db');
    const runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const editor = await fetch(`${runtime.baseUrl}/procedure-editor#token=${accessToken}`);
      expect(editor.status).toBe(200);
      expect(editor.headers.get('cache-control')).toBe('no-store');
      expect(editor.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(editor.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
      const editorHtml = await editor.text();
      expect(editorHtml).toContain('/procedure-editor/app.js');
      expect(editorHtml).not.toContain(accessToken);
      const editorScript = await fetch(`${runtime.baseUrl}/procedure-editor/app.js`);
      expect(editorScript.status).toBe(200);
      expect(editorScript.headers.get('content-type')).toContain('text/javascript');
      expect(editorScript.headers.get('cache-control')).toBe('no-store');
      expect(editorScript.headers.get('content-security-policy')).toBe(
        editor.headers.get('content-security-policy'),
      );
      const editorStyles = await fetch(`${runtime.baseUrl}/procedure-editor/styles.css`);
      expect(editorStyles.status).toBe(200);
      expect(editorStyles.headers.get('content-type')).toContain('text/css');
      expect(editorStyles.headers.get('cache-control')).toBe('no-store');
      expect(editorStyles.headers.get('content-security-policy')).toBe(
        editor.headers.get('content-security-policy'),
      );

      const invalid = await postJson<{ error: string }>(
        runtime,
        '/api/v1/procedure/editor/branches/create',
        { formatVersion: '1.0.0', requestId: 'not-a-uuid' },
      );
      expect(invalid).toMatchObject({
        status: 400,
        body: { error: 'invalid_procedure_tree_editor_request' },
      });
      const missing = await postJson<{ error: string; code?: string }>(
        runtime,
        '/api/v1/procedure/editor/branches/get',
        {
          formatVersion: '1.0.0',
          treeId: 'missing.tree',
          branchId: randomUUID(),
        },
      );
      expect(missing).toMatchObject({
        status: 404,
        body: { error: 'procedure_tree_editor_not_found' },
      });
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
