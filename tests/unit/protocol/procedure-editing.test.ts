import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  procedureTreeEditorBranchCreateRequestSchema,
  procedureTreeEditorBranchHistoryRequestSchema,
  procedureTreeEditorBranchHistoryResultSchema,
  procedureTreeEditorBranchSchema,
  procedureTreeEditorCommentCreateRequestSchema,
  procedureTreeEditorCommentListRequestSchema,
  procedureTreeEditorCommitRequestSchema,
  procedureTreeEditorDiffResultSchema,
  procedureTreeEditorEditPreviewRequestSchema,
  procedureTreeEditorMergePreviewResultSchema,
  procedureTreeEditorMergePreviewRequestSchema,
  procedureTreeEditorParameterFieldSchema,
  procedureTreeEditorRevisionCommitSchema,
  procedureTreeEditorStablePathSegmentSchema,
  procedureTreeEditorWorkspaceResultSchema,
  type ProcedureTree,
} from '@operatingline/protocol';

const branchId = '11111111-1111-4111-8111-111111111111';
const sourceBranchId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const occurredAt = '2026-08-19T10:00:00+08:00';
const sha = (digit: string) => digit.repeat(64);

function fixture(): ProcedureTree {
  return JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as ProcedureTree;
}

function revision(treeId: string, number: number, digit: string) {
  return { treeId, revision: number, contentSha256: sha(digit) } as const;
}

describe('procedure tree editor protocol', () => {
  it('binds branch history pages to an exact snapshot head', () => {
    const tree = fixture();
    const snapshotHead = revision(tree.id, 3, 'c');
    const commit = {
      commitId: requestId,
      requestId,
      branchId,
      operation: 'edit',
      revision: revision(tree.id, 2, 'b'),
      parent: revision(tree.id, 1, 'a'),
      source: null,
      mergeBase: null,
      message: null,
      occurredAt,
    } as const;
    expect(
      procedureTreeEditorBranchHistoryRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        expectedHead: snapshotHead,
        afterRevision: 2,
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorBranchHistoryRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        expectedHead: { ...snapshotHead, treeId: 'another.tree' },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorBranchHistoryRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        expectedHead: snapshotHead,
        afterRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorBranchHistoryResultSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        snapshotHead,
        commits: [commit],
        nextAfterRevision: null,
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorBranchHistoryResultSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        snapshotHead: revision(tree.id, 1, 'a'),
        commits: [commit],
        nextAfterRevision: null,
      }).success,
    ).toBe(false);
  });

  it('rejects prototype-bearing stable path fields', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(
        procedureTreeEditorStablePathSegmentSchema.safeParse({ kind: 'field', name }).success,
      ).toBe(false);
    }
    expect(
      procedureTreeEditorStablePathSegmentSchema.safeParse({ kind: 'field', name: 'title' })
        .success,
    ).toBe(true);
  });

  it('requires exact branch and edit-preview tree identity and strict request objects', () => {
    const tree = fixture();
    const base = revision(tree.id, tree.revision, 'a');
    const create = {
      formatVersion: '1.0.0',
      requestId,
      treeId: tree.id,
      name: ' Main ',
      createdFrom: base,
      occurredAt,
    };
    expect(procedureTreeEditorBranchCreateRequestSchema.parse(create).name).toBe('Main');
    expect(
      procedureTreeEditorBranchCreateRequestSchema.safeParse({
        ...create,
        createdFrom: { ...base, treeId: 'another.tree' },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorBranchCreateRequestSchema.safeParse({ ...create, unknown: true }).success,
    ).toBe(false);

    const targetTree = structuredClone(tree);
    const expectedLatestRevision = tree.revision + 2;
    targetTree.revision = expectedLatestRevision + 1;
    const preview = {
      formatVersion: '1.0.0',
      requestId,
      branchId,
      base,
      expectedLatestRevision,
      targetTree,
      message: '  Make the parameter explicit.  ',
    };
    expect(procedureTreeEditorEditPreviewRequestSchema.parse(preview).message).toBe(
      'Make the parameter explicit.',
    );
    expect(
      procedureTreeEditorEditPreviewRequestSchema.safeParse({
        ...preview,
        expectedLatestRevision: expectedLatestRevision + 1,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorEditPreviewRequestSchema.safeParse({
        ...preview,
        targetTree: { ...targetTree, id: 'another.tree' },
      }).success,
    ).toBe(false);
  });

  it('binds branch heads and workspaces to one exact tree revision and hash', () => {
    const tree = fixture();
    const base = revision(tree.id, tree.revision, 'a');
    const branch = {
      branchId,
      treeId: tree.id,
      name: 'main',
      createdFrom: base,
      head: base,
      createdAt: occurredAt,
    };
    expect(procedureTreeEditorBranchSchema.safeParse(branch).success).toBe(true);
    expect(
      procedureTreeEditorBranchSchema.safeParse({
        ...branch,
        head: { ...base, treeId: 'another.tree' },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorBranchSchema.safeParse({
        ...branch,
        head: revision(tree.id, tree.revision - 1, 'b'),
      }).success,
    ).toBe(false);

    expect(
      procedureTreeEditorWorkspaceResultSchema.safeParse({
        formatVersion: '1.0.0',
        branch,
        tree,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: sha('a'),
        },
        commentsAreTreeContent: false,
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorWorkspaceResultSchema.safeParse({
        formatVersion: '1.0.0',
        branch,
        tree: { ...tree, revision: tree.revision + 1 },
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: sha('b'),
        },
        commentsAreTreeContent: false,
      }).success,
    ).toBe(false);
  });

  it('keeps stable diff entries exact and unique', () => {
    const tree = fixture();
    const path = [
      { kind: 'identified', collection: 'nodes', id: tree.nodes[0]!.id },
      { kind: 'field', name: 'title' },
    ] as const;
    const diff = {
      formatVersion: '1.0.0',
      binding: {
        base: revision(tree.id, 1, 'a'),
        target: revision(tree.id, 2, 'b'),
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: sha('c'),
      },
      entries: [
        { stableId: tree.nodes[0]!.id, path, operation: 'replace', before: 'Old', after: 'New' },
      ],
    };
    expect(procedureTreeEditorDiffResultSchema.safeParse(diff).success).toBe(true);
    expect(
      procedureTreeEditorDiffResultSchema.safeParse({
        ...diff,
        entries: [{ ...diff.entries[0], after: 'Old' }],
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorDiffResultSchema.safeParse({
        ...diff,
        entries: [...diff.entries, diff.entries[0]],
      }).success,
    ).toBe(false);
  });

  it('enforces merge ready/conflict discriminants and branch topology', () => {
    const tree = fixture();
    const targetCandidate = structuredClone(tree);
    targetCandidate.revision = 3;
    const common = {
      formatVersion: '1.0.0',
      requestId,
      targetBranchId: branchId,
      sourceBranchId,
      targetHead: revision(tree.id, 2, 'b'),
      sourceHead: revision(tree.id, 4, 'd'),
      mergeBase: revision(tree.id, 1, 'a'),
      expectedLatestRevision: 4,
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;
    const conflict = {
      stableId: tree.nodes[0]!.id,
      path: [{ kind: 'field', name: 'title' }],
      mergeBase: { present: true, value: 'Base' },
      target: { present: false },
      source: { present: true, value: 'Source' },
    } as const;
    expect(
      procedureTreeEditorMergePreviewResultSchema.safeParse({
        ...common,
        status: 'conflicts',
        conflicts: [conflict],
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorMergePreviewResultSchema.safeParse({
        ...common,
        status: 'conflicts',
        conflicts: [],
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorMergePreviewResultSchema.safeParse({
        ...common,
        sourceBranchId: branchId,
        status: 'conflicts',
        conflicts: [conflict],
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorMergePreviewResultSchema.safeParse({
        ...common,
        status: 'ready',
        targetCandidate,
        conflicts: [conflict],
      }).success,
    ).toBe(false);

    const resolutionRequest = {
      formatVersion: '1.0.0',
      requestId,
      targetBranchId: branchId,
      sourceBranchId,
      targetHead: common.targetHead,
      sourceHead: common.sourceHead,
      expectedLatestRevision: common.expectedLatestRevision,
      resolutions: [{ conflict, choice: 'custom', custom: { present: false } }],
    };
    expect(procedureTreeEditorMergePreviewRequestSchema.safeParse(resolutionRequest).success).toBe(
      true,
    );
    expect(
      procedureTreeEditorMergePreviewRequestSchema.safeParse({
        ...resolutionRequest,
        resolutions: [{ conflict, choice: 'source', custom: { present: false } }],
      }).success,
    ).toBe(false);
  });

  it('accepts only valid append-only comment anchor combinations and cursor bounds', () => {
    const tree = fixture();
    const base = revision(tree.id, 1, 'a');
    const comment = {
      formatVersion: '1.0.0',
      requestId,
      branchId,
      revision: base,
      anchor: {
        kind: 'operation',
        treeId: tree.id,
        nodeId: 'snowman.head.eyes.left',
        modality: 'semantic',
        trackId: null,
        operationId: 'semantic.create',
      },
      body: '  Keep this operation deterministic.  ',
      occurredAt,
    } as const;
    expect(procedureTreeEditorCommentCreateRequestSchema.parse(comment).body).toBe(
      'Keep this operation deterministic.',
    );
    expect(
      procedureTreeEditorCommentCreateRequestSchema.safeParse({
        ...comment,
        anchor: { ...comment.anchor, modality: 'menu', trackId: null },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommentCreateRequestSchema.safeParse({
        ...comment,
        anchor: { kind: 'tree', treeId: 'another.tree' },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommentCreateRequestSchema.safeParse({ ...comment, body: ' ' }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommentListRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: 'tree.one',
        branchId,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommentListRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        revision: { ...base, treeId: 'another.tree' },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommentListRequestSchema.safeParse({
        formatVersion: '1.0.0',
        treeId: tree.id,
        branchId,
        anchor: { kind: 'tree', treeId: 'another.tree' },
      }).success,
    ).toBe(false);
  });

  it('enforces authoritative numeric and string constraints while freezing unknown values', () => {
    const base = { name: 'value', label: 'Value', description: '' } as const;
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'number',
        editable: true,
        originalValue: 1,
        value: 2,
        minimum: 0,
        maximum: 3,
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'enum',
        editable: true,
        originalValue: 'A',
        value: 'B',
        enumValues: ['A', 'B'],
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'number_vector',
        editable: true,
        originalValue: [0, 0, 0],
        value: [1, 2],
        vectorLength: 3,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'number',
        editable: true,
        originalValue: 1,
        value: 1,
        minimum: 2,
        maximum: 1,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'number',
        editable: true,
        originalValue: -1,
        value: 4,
        minimum: 0,
        maximum: 3,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'string',
        editable: true,
        originalValue: 'Eye.L',
        value: 'Eye.R',
        pattern: '[',
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'integer_vector',
        editable: true,
        originalValue: [0, 1, 2],
        value: [1, 2, 4],
        minimum: 0,
        maximum: 3,
        vectorLength: 3,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'string',
        editable: true,
        originalValue: 'Eye.L',
        value: 'Eye.R',
        pattern: '^Eye\\.[LR]$',
        minLength: 5,
        maxLength: 8,
      }).success,
    ).toBe(true);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'string',
        editable: true,
        originalValue: 'Eye.L',
        value: 'Head',
        pattern: '^Eye\\.[LR]$',
        minLength: 5,
        maxLength: 8,
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'string',
        editable: false,
        originalValue: 'old',
        value: 'new',
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorParameterFieldSchema.safeParse({
        ...base,
        kind: 'structured',
        editable: false,
        originalValue: { nested: true },
        value: { nested: false },
      }).success,
    ).toBe(false);
  });

  it('preserves the merge source branch identity in revision lineage', () => {
    const tree = fixture();
    const merge = {
      commitId: requestId,
      requestId,
      branchId,
      operation: 'merge',
      revision: revision(tree.id, 4, 'd'),
      parent: revision(tree.id, 2, 'b'),
      source: { branchId: sourceBranchId, revision: revision(tree.id, 3, 'c') },
      mergeBase: revision(tree.id, 1, 'a'),
      message: null,
      occurredAt,
    } as const;
    expect(procedureTreeEditorRevisionCommitSchema.safeParse(merge).success).toBe(true);
    expect(
      procedureTreeEditorRevisionCommitSchema.safeParse({
        ...merge,
        source: revision(tree.id, 3, 'c'),
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorRevisionCommitSchema.safeParse({
        ...merge,
        operation: 'edit',
      }).success,
    ).toBe(false);
  });

  it('binds commits to the exact preview operation, branch head, target tree, and hash', () => {
    const tree = fixture();
    const targetTree = structuredClone(tree);
    targetTree.revision = 2;
    const expectedHead = revision(tree.id, 1, 'a');
    const target = revision(tree.id, 2, 'b');
    const request = {
      formatVersion: '1.0.0',
      requestId,
      occurredAt,
      operation: 'edit',
      targetBranchId: branchId,
      expectedHead,
      previewBinding: {
        operation: 'edit',
        branchId,
        base: expectedHead,
        expectedLatestRevision: 1,
        target,
        diffContentSha256: sha('c'),
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        previewContentSha256: sha('d'),
      },
      targetTree,
      targetIntegrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: sha('b'),
      },
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;
    expect(procedureTreeEditorCommitRequestSchema.safeParse(request).success).toBe(true);
    expect(
      procedureTreeEditorCommitRequestSchema.safeParse({
        ...request,
        targetIntegrity: { ...request.targetIntegrity, contentSha256: sha('e') },
      }).success,
    ).toBe(false);
    expect(
      procedureTreeEditorCommitRequestSchema.safeParse({ ...request, proposalCreated: true })
        .success,
    ).toBe(false);
  });
});
