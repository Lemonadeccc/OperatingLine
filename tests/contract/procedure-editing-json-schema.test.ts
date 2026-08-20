import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const schemaNames = [
  'branch-create-request',
  'branch-create-result',
  'branch-get-request',
  'branch-get-result',
  'branch-list-request',
  'branch-list-result',
  'workspace-request',
  'workspace-result',
  'diff-result',
  'edit-preview-request',
  'edit-preview-result',
  'merge-preview-request',
  'merge-preview-result',
  'commit-request',
  'commit-result',
  'revision-commit',
  'branch-history-request',
  'branch-history-result',
  'comment-create-request',
  'comment-create-result',
  'comment-list-request',
  'comment-list-result',
  'parameter-form-request',
  'parameter-form-result',
] as const;

function publicSchema(name: (typeof schemaNames)[number]): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve('protocol/schemas/v1', `procedure-tree-editor-${name}.schema.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

describe('public ProcedureTree Editor JSON Schemas', () => {
  it('publishes every request/result at the exact 1.0.0 boundary', () => {
    for (const name of schemaNames) {
      const schema = publicSchema(name);
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/procedure-tree-editor-${name}.json`,
      );
      const serialized = JSON.stringify(schema);
      if (name !== 'revision-commit') {
        expect(serialized).toContain('"formatVersion"');
        expect(serialized).toContain('"const":"1.0.0"');
      }
      expect(serialized).toContain('"additionalProperties":false');
    }
  });

  it('rejects unknown fields, invalid UUIDs, cursor overflow, and bad discriminants through AJV', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    await validatePublicJsonSchemaCases(publicSchema('branch-get-request'), [
      { value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId }, accepted: true },
      {
        value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId, extra: true },
        accepted: false,
      },
      {
        value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId: 'not-a-uuid' },
        accepted: false,
      },
    ]);
    await validatePublicJsonSchemaCases(publicSchema('comment-list-request'), [
      {
        value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId, limit: 100 },
        accepted: true,
      },
      {
        value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId, limit: 101 },
        accepted: false,
      },
      { value: { formatVersion: '1.0.0', branchId, limit: 100 }, accepted: false },
    ]);
    await validatePublicJsonSchemaCases(publicSchema('branch-history-request'), [
      {
        value: {
          formatVersion: '1.0.0',
          treeId: 'tree.one',
          branchId,
          expectedHead: {
            treeId: 'tree.one',
            revision: 2,
            contentSha256: 'a'.repeat(64),
          },
          afterRevision: 1,
          limit: 100,
        },
        accepted: true,
      },
      {
        value: { formatVersion: '1.0.0', treeId: 'tree.one', branchId, limit: 100 },
        accepted: false,
      },
    ]);
    await validatePublicJsonSchemaCases(publicSchema('parameter-form-result'), [
      {
        value: {
          formatVersion: '1.0.0',
          branchId,
          revision: { treeId: 'tree.one', revision: 1, contentSha256: 'a'.repeat(64) },
          target: { kind: 'action', nodeId: 'node.one' },
          fields: [
            {
              name: 'size',
              label: 'Size',
              description: '',
              kind: 'number',
              editable: true,
              originalValue: 1,
              value: 2,
            },
          ],
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        accepted: true,
      },
      {
        value: {
          formatVersion: '1.0.0',
          branchId,
          revision: { treeId: 'tree.one', revision: 1, contentSha256: 'a'.repeat(64) },
          target: { kind: 'action', nodeId: 'node.one' },
          fields: [
            {
              name: 'objectName',
              label: 'Object name',
              description: '',
              kind: 'string',
              editable: true,
              originalValue: 'Eye.L',
              value: 'Eye.R',
              pattern: '^Eye\\.[LR]$',
              minLength: 5,
              maxLength: 8,
            },
          ],
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        accepted: true,
      },
      {
        value: {
          formatVersion: '1.0.0',
          branchId,
          revision: { treeId: 'tree.one', revision: 1, contentSha256: 'a'.repeat(64) },
          target: { kind: 'action', nodeId: 'node.one', trackId: 'forbidden' },
          fields: [],
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        accepted: false,
      },
    ]);
  });

  it('publishes operation-sensitive commit lineage and binding contracts', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    const sourceBranchId = '22222222-2222-4222-8222-222222222222';
    const requestId = '33333333-3333-4333-8333-333333333333';
    const occurredAt = '2026-08-19T10:00:00+08:00';
    const ref = (revision: number, digit: string) => ({
      treeId: 'tree.one',
      revision,
      contentSha256: digit.repeat(64),
    });
    const mergeCommit = {
      commitId: requestId,
      requestId,
      branchId,
      operation: 'merge',
      revision: ref(4, 'd'),
      parent: ref(2, 'b'),
      source: { branchId: sourceBranchId, revision: ref(3, 'c') },
      mergeBase: ref(1, 'a'),
      message: null,
      occurredAt,
    };
    await validatePublicJsonSchemaCases(publicSchema('revision-commit'), [
      { value: mergeCommit, accepted: true },
      { value: { ...mergeCommit, source: ref(3, 'c') }, accepted: false },
      { value: { ...mergeCommit, operation: 'edit' }, accepted: false },
      {
        value: { ...mergeCommit, operation: 'merge', source: null, mergeBase: null },
        accepted: false,
      },
    ]);

    const tree = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
    ) as Record<string, unknown>;
    tree['revision'] = 2;
    const editBinding = {
      operation: 'edit',
      branchId,
      base: ref(1, 'a'),
      expectedLatestRevision: 1,
      target: ref(2, 'b'),
      diffContentSha256: 'c'.repeat(64),
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      previewContentSha256: 'd'.repeat(64),
    };
    const commit = {
      formatVersion: '1.0.0',
      requestId,
      occurredAt,
      operation: 'edit',
      targetBranchId: branchId,
      expectedHead: ref(1, 'a'),
      previewBinding: editBinding,
      targetTree: tree,
      targetIntegrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: 'b'.repeat(64),
      },
      proposalCreated: false,
      hostExecutionStarted: false,
    };
    await validatePublicJsonSchemaCases(publicSchema('commit-request'), [
      { value: commit, accepted: true },
      { value: { ...commit, operation: 'merge' }, accepted: false },
    ]);
  });

  it('publishes exact merge conflict resolution choices including absence', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    const sourceBranchId = '22222222-2222-4222-8222-222222222222';
    const requestId = '33333333-3333-4333-8333-333333333333';
    const ref = (revision: number, digit: string) => ({
      treeId: 'tree.one',
      revision,
      contentSha256: digit.repeat(64),
    });
    const conflict = {
      stableId: 'node.one',
      path: [{ kind: 'field', name: 'title' }],
      mergeBase: { present: true, value: 'Base' },
      target: { present: true, value: 'Target' },
      source: { present: false },
    };
    const request = {
      formatVersion: '1.0.0',
      requestId,
      targetBranchId: branchId,
      sourceBranchId,
      targetHead: ref(2, 'b'),
      sourceHead: ref(3, 'c'),
      expectedLatestRevision: 3,
      resolutions: [{ conflict, choice: 'custom', custom: { present: false } }],
    };
    await validatePublicJsonSchemaCases(publicSchema('merge-preview-request'), [
      { value: request, accepted: true },
      {
        value: {
          ...request,
          resolutions: [{ conflict, choice: 'source', custom: { present: false } }],
        },
        accepted: false,
      },
      {
        value: { ...request, resolutions: [{ conflict, choice: 'custom' }] },
        accepted: false,
      },
    ]);
  });

  it('publishes tree-scoped comment filters and parameter constraint metadata', () => {
    const comments = JSON.stringify(publicSchema('comment-list-request'));
    expect(comments).toContain('"treeId"');
    expect(comments).toContain('"revision"');
    expect(comments).toContain('"anchor"');

    const parameters = JSON.stringify(publicSchema('parameter-form-result'));
    expect(parameters).toContain('"minimum"');
    expect(parameters).toContain('"maximum"');
    expect(parameters).toContain('"pattern"');
    expect(parameters).toContain('"minLength"');
    expect(parameters).toContain('"maxLength"');
  });
});
