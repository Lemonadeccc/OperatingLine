import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import {
  openOperatingLineDatabase,
  type ProcedureTreeRevisionCommitInput,
} from '@operatingline/persistence';

function treeRecord(revision: number) {
  const tree = {
    formatVersion: '1.0.0',
    id: 'editor.procedure',
    revision,
    title: `Editor revision ${revision}`,
    adapterId: 'blender',
    actionCatalogVersion: '1.0.0',
    interactionCatalogVersion: '1.0.0',
    hostVersionRange: '>=4.3.0 <5.0.0',
    rootNodeId: 'root',
    sources: [],
    evidence: [],
    nodes: [],
  };
  return {
    treeId: tree.id,
    revision,
    title: tree.title,
    adapterId: tree.adapterId,
    actionCatalogVersion: tree.actionCatalogVersion,
    interactionCatalogVersion: tree.interactionCatalogVersion,
    hostVersionRange: tree.hostVersionRange,
    contentSha256: String(revision % 10).repeat(64),
    tree,
  };
}

function commit(
  requestId: string,
  branchId: string,
  baseRevision: number,
  targetRevision: number,
): ProcedureTreeRevisionCommitInput {
  return {
    requestId,
    branchId,
    operation: 'edit',
    base: { revision: baseRevision, contentSha256: String(baseRevision % 10).repeat(64) },
    expectedLatestRevision: targetRevision - 1,
    target: treeRecord(targetRevision),
    message: `revision ${targetRevision}`,
    occurredAt: `2026-08-19T00:00:0${targetRevision}.000Z`,
    payload: { requestId, branchId, targetRevision },
  };
}

function commitFromWorker(path: string, input: ProcedureTreeRevisionCommitInput): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        import('@operatingline/persistence').then(({ openOperatingLineDatabase }) => {
          const database = openOperatingLineDatabase(workerData.path);
          try {
            parentPort.postMessage(database.commitProcedureTreeRevision(workerData.input).result);
          } finally {
            database.close();
          }
        }).catch((error) => parentPort.postMessage({ error: String(error) }));
      `,
      { eval: true, workerData: { path, input } },
    );
    worker.once('message', (result: unknown) => {
      if (typeof result === 'object' && result !== null && 'error' in result) {
        reject(new Error(String((result as { error: unknown }).error)));
      } else {
        resolve(String(result));
      }
    });
    worker.once('error', reject);
  });
}

describe('ProcedureTree editor persistence', () => {
  it('bootstraps branches from untracked revisions and derives globally monotonic branch heads', () => {
    const database = openOperatingLineDatabase(':memory:');
    expect(database.recordProcedureTree(treeRecord(1))).toMatchObject({ result: 'accepted' });
    const main = {
      treeId: 'editor.procedure',
      branchId: 'main',
      createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
      createdAt: '2026-08-19T00:00:00.000Z',
      payload: { branchId: 'main' },
    };
    const feature = { ...main, branchId: 'feature', payload: { branchId: 'feature' } };
    expect(database.createProcedureTreeBranch(main)).toMatchObject({ result: 'accepted' });
    expect(database.createProcedureTreeBranch(main)).toMatchObject({ result: 'duplicate' });
    expect(database.createProcedureTreeBranch({ ...main, payload: { poisoned: true } })).toEqual({
      result: 'conflict',
    });
    expect(database.createProcedureTreeBranch(feature)).toMatchObject({ result: 'accepted' });

    expect(database.commitProcedureTreeRevision(commit('r2', 'main', 1, 2))).toMatchObject({
      result: 'accepted',
    });
    expect(database.commitProcedureTreeRevision(commit('r3', 'feature', 1, 3))).toMatchObject({
      result: 'accepted',
    });
    expect(database.getProcedureTreeBranchHead('editor.procedure', 'main')).toEqual({
      revision: 2,
      contentSha256: '2'.repeat(64),
    });
    expect(database.getProcedureTreeBranchHead('editor.procedure', 'feature')).toEqual({
      revision: 3,
      contentSha256: '3'.repeat(64),
    });
    expect(
      database.commitProcedureTreeRevision({
        ...commit('r4', 'main', 2, 4),
        operation: 'merge',
        source: { branchId: 'feature', revision: 3, contentSha256: '3'.repeat(64) },
        mergeBase: { revision: 1, contentSha256: '1'.repeat(64) },
      }),
    ).toMatchObject({ result: 'accepted' });
    expect(database.getProcedureTreeBranchHead('editor.procedure', 'main')?.revision).toBe(4);
    expect(database.listProcedureTreeRevisionCommits('editor.procedure')).toHaveLength(3);
    database.close();
  });

  it('distinguishes exact retries, poisoning, and stale target, branch, and source heads', () => {
    const database = openOperatingLineDatabase(':memory:');
    database.recordProcedureTree(treeRecord(1));
    for (const branchId of ['main', 'feature']) {
      database.createProcedureTreeBranch({
        treeId: 'editor.procedure',
        branchId,
        createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
        createdAt: '2026-08-19T00:00:00.000Z',
        payload: { branchId },
      });
    }
    const revisionTwo = commit('r2', 'main', 1, 2);
    expect(database.commitProcedureTreeRevision(revisionTwo)).toMatchObject({ result: 'accepted' });
    expect(database.commitProcedureTreeRevision(revisionTwo)).toMatchObject({
      result: 'duplicate',
    });
    expect(
      database.commitProcedureTreeRevision({ ...revisionTwo, message: 'poisoned retry' }),
    ).toEqual({ result: 'conflict' });
    expect(database.commitProcedureTreeRevision(commit('stale-global', 'feature', 1, 2))).toEqual({
      result: 'stale_head',
    });
    expect(
      database.commitProcedureTreeRevision({
        ...commit('stale-branch', 'main', 1, 3),
        expectedLatestRevision: 2,
      }),
    ).toEqual({ result: 'stale_head' });
    const merge: ProcedureTreeRevisionCommitInput = {
      ...commit('stale-source', 'main', 2, 3),
      operation: 'merge',
      source: { branchId: 'feature', revision: 2, contentSha256: '2'.repeat(64) },
      mergeBase: { revision: 1, contentSha256: '1'.repeat(64) },
    };
    expect(database.commitProcedureTreeRevision(merge)).toEqual({ result: 'stale_head' });
    database.close();
  });

  it('rolls back the tree, commit, and branch head when the commit audit event fails', () => {
    const database = openOperatingLineDatabase(':memory:');
    database.recordProcedureTree(treeRecord(1));
    database.createProcedureTreeBranch({
      treeId: 'editor.procedure',
      branchId: 'main',
      createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
      createdAt: '2026-08-19T00:00:00.000Z',
      payload: {},
    });
    database.appendEvent({
      id: 'procedure-tree-commit:r2',
      eventType: 'poisoned',
      payload: {},
      createdAt: '2026-08-19T00:00:01.000Z',
    });
    expect(() => database.commitProcedureTreeRevision(commit('r2', 'main', 1, 2))).toThrow();
    expect(database.getProcedureTree('editor.procedure', 2)).toBeNull();
    expect(database.getProcedureTreeRevisionCommit('r2')).toBeNull();
    expect(database.getProcedureTreeBranchHead('editor.procedure', 'main')?.revision).toBe(1);
    database.close();
  });

  it('appends exact comments with cursors and survives reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-editor-store-'));
    const path = join(directory, 'state.db');
    try {
      const database = openOperatingLineDatabase(path);
      database.recordProcedureTree(treeRecord(1));
      database.createProcedureTreeBranch({
        treeId: 'editor.procedure',
        branchId: 'main',
        createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
        createdAt: '2026-08-19T00:00:00.000Z',
        payload: {},
      });
      const first = {
        commentId: 'comment-1',
        treeId: 'editor.procedure',
        branchId: 'main',
        tree: { revision: 1, contentSha256: '1'.repeat(64) },
        occurredAt: '2026-08-19T00:00:01.000Z',
        payload: { body: 'first' },
      };
      const accepted = database.appendProcedureTreeComment(first);
      expect(accepted).toMatchObject({ result: 'accepted' });
      expect(database.getProcedureTreeComment('comment-1')).toMatchObject(first);
      expect(database.getProcedureTreeComment('missing')).toBeNull();
      expect(database.appendProcedureTreeComment(first)).toMatchObject({ result: 'duplicate' });
      expect(
        database.appendProcedureTreeComment({ ...first, payload: { body: 'poison' } }),
      ).toEqual({
        result: 'conflict',
      });
      expect(
        database.appendProcedureTreeComment({
          ...first,
          commentId: 'bad-hash',
          tree: { ...first.tree, contentSha256: 'a'.repeat(64) },
        }),
      ).toEqual({ result: 'not_found' });
      database.appendProcedureTreeComment({
        ...first,
        commentId: 'comment-2',
        payload: { body: 'second' },
      });
      const page = database.listProcedureTreeComments('editor.procedure', 'main', 0, 1);
      expect(page).toHaveLength(1);
      expect(
        database.listProcedureTreeComments('editor.procedure', 'main', page[0]!.sequence, 10),
      ).toHaveLength(1);
      database.close();

      const reopened = openOperatingLineDatabase(path);
      expect(reopened.listProcedureTreeBranches('editor.procedure')).toHaveLength(1);
      expect(reopened.listProcedureTreeComments('editor.procedure', 'main', 0, 10)).toHaveLength(2);
      expect(reopened.getProcedureTreeComment('comment-1')).toMatchObject(first);
      expect(reopened.appendProcedureTreeComment(first)).toMatchObject({ result: 'duplicate' });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restricts comments to the branch lineage and admits merged source ancestry', () => {
    const database = openOperatingLineDatabase(':memory:');
    database.recordProcedureTree(treeRecord(1));
    for (const branchId of ['main', 'feature']) {
      database.createProcedureTreeBranch({
        treeId: 'editor.procedure',
        branchId,
        createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
        createdAt: '2026-08-19T00:00:00.000Z',
        payload: { branchId },
      });
    }
    expect(
      database.commitProcedureTreeRevision(commit('feature-r2', 'feature', 1, 2)),
    ).toMatchObject({ result: 'accepted' });
    expect(
      database.commitProcedureTreeRevision(commit('feature-r3', 'feature', 2, 3)),
    ).toMatchObject({ result: 'accepted' });

    const comment = (commentId: string, revision: number) => ({
      commentId,
      treeId: 'editor.procedure',
      branchId: 'main',
      tree: { revision, contentSha256: String(revision).repeat(64) },
      occurredAt: '2026-08-19T00:00:04.000Z',
      payload: { commentId },
    });
    expect(database.appendProcedureTreeComment(comment('before-merge', 2))).toEqual({
      result: 'not_found',
    });

    expect(
      database.commitProcedureTreeRevision({
        ...commit('main-r4', 'main', 1, 4),
        operation: 'merge',
        expectedLatestRevision: 3,
        source: { branchId: 'feature', revision: 3, contentSha256: '3'.repeat(64) },
        mergeBase: { revision: 1, contentSha256: '1'.repeat(64) },
      }),
    ).toMatchObject({ result: 'accepted' });
    expect(database.appendProcedureTreeComment(comment('source-head', 3))).toMatchObject({
      result: 'accepted',
    });
    expect(database.appendProcedureTreeComment(comment('source-ancestor', 2))).toMatchObject({
      result: 'accepted',
    });
    expect(database.appendProcedureTreeComment(comment('source-ancestor', 2))).toMatchObject({
      result: 'duplicate',
    });
    database.createProcedureTreeBranch({
      treeId: 'editor.procedure',
      branchId: 'forked-after-feature',
      createdFrom: { revision: 3, contentSha256: '3'.repeat(64) },
      createdAt: '2026-08-19T00:00:05.000Z',
      payload: { branchId: 'forked-after-feature' },
    });
    expect(
      database.appendProcedureTreeComment({
        ...comment('fork-inherited-ancestor', 2),
        branchId: 'forked-after-feature',
      }),
    ).toMatchObject({ result: 'accepted' });
    database.close();
  });

  it('serializes concurrent stale global-head commits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-editor-race-'));
    const path = join(directory, 'state.db');
    try {
      const database = openOperatingLineDatabase(path);
      database.recordProcedureTree(treeRecord(1));
      for (const branchId of ['main', 'feature']) {
        database.createProcedureTreeBranch({
          treeId: 'editor.procedure',
          branchId,
          createdFrom: { revision: 1, contentSha256: '1'.repeat(64) },
          createdAt: '2026-08-19T00:00:00.000Z',
          payload: { branchId },
        });
      }
      database.close();
      const results = await Promise.all([
        commitFromWorker(path, commit('race-main', 'main', 1, 2)),
        commitFromWorker(path, commit('race-feature', 'feature', 1, 2)),
      ]);
      expect(results.sort()).toEqual(['accepted', 'stale_head']);
      const reopened = openOperatingLineDatabase(path);
      expect(reopened.listProcedureTreeRevisionCommits('editor.procedure')).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
