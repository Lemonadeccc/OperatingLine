import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeProcedureTreeThreeWayMerge, diffProcedureTrees } from '@operatingline/orchestrator';
import {
  parseProcedureTree,
  type ProcedureLeafNode,
  type ProcedureTree,
} from '@operatingline/protocol';

import { resolveProcedureTreeMergeConflicts } from '../../../services/orchestrator/src/procedure-tree-editor.js';

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

describe('procedure tree editor diff', () => {
  it('reports nested parameter changes by stable node id and ignores revision allocation', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.revision = 2;
    leaf(after).action!.arguments['radius'] = 0.2;

    expect(diffProcedureTrees(before, after)).toMatchObject([
      {
        operation: 'replace',
        path: '$.nodes[id="snowman.head.eyes.left"].action.arguments.radius',
        before: 0.12,
        after: 0.2,
      },
    ]);
  });

  it('diffs alternative tracks and operations without replacing the containing arrays', () => {
    const before = fixture();
    const after = structuredClone(before);
    const edited = leaf(after);
    edited.menuTracks[0]!.title = '菜单精修轨迹';
    if (edited.shortcutTracks[0]!.availability !== 'available') {
      throw new Error('Expected available shortcut track');
    }
    edited.shortcutTracks[0]!.operations[0]!.description = 'Use the exact shortcut alias.';

    expect(diffProcedureTrees(before, after).map((entry) => entry.path)).toEqual([
      '$.nodes[id="snowman.head.eyes.left"].menuTracks[id="menu.layout.default"].title',
      '$.nodes[id="snowman.head.eyes.left"].shortcutTracks[id="shortcut.blender.default"].operations[id="shortcut.add_sphere"].description',
    ]);
  });

  it('rejects unsafe object keys before emitting a stable diff path', () => {
    const before = fixture();
    const after = structuredClone(before);
    Object.defineProperty(leaf(after).action!.arguments, 'constructor', {
      configurable: true,
      enumerable: true,
      value: 'unsafe',
      writable: true,
    });

    expect(() => diffProcedureTrees(before, after)).toThrow(
      'stable path contains unsafe field constructor',
    );
  });
});

describe('procedure tree editor three-way merge', () => {
  it('combines independent node metadata and action parameter edits', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    target.revision = 2;
    source.revision = 3;
    leaf(target).title = '创建并调整主眼球体';
    leaf(source).action!.arguments['radius'] = 0.2;

    const result = computeProcedureTreeThreeWayMerge(ancestor, target, source, 4);

    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.tree.revision).toBe(4);
    expect(leaf(result.tree).title).toBe('创建并调整主眼球体');
    expect(leaf(result.tree).action!.arguments['radius']).toBe(0.2);
  });

  it('combines independent edits to different alternative tracks', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(target).menuTracks[0]!.title = 'Menu branch';
    leaf(source).shortcutTracks[0]!.title = 'Shortcut branch';

    const result = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);

    expect(result.conflicts).toEqual([]);
    expect(leaf(result.tree).menuTracks[0]!.title).toBe('Menu branch');
    expect(leaf(result.tree).shortcutTracks[0]!.title).toBe('Shortcut branch');
  });

  it('fails closed when both branches change the same parameter differently', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(target).action!.arguments['radius'] = 0.2;
    leaf(source).action!.arguments['radius'] = 0.3;

    const result = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);

    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        path: '$.nodes[id="snowman.head.eyes.left"].action.arguments.radius',
        message: expect.stringContaining('differently'),
      }),
    );
  });

  it('deterministically applies target, source, base, custom, and absent resolutions', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(target).action!.arguments['radius'] = 0.2;
    leaf(source).action!.arguments['radius'] = 0.3;
    const merge = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);
    const conflict = merge.conflicts[0]!;
    const radius = (value: ProcedureTree) => leaf(value).action!.arguments['radius'];
    const resolve = (value: { present: false } | { present: true; value: unknown }) =>
      resolveProcedureTreeMergeConflicts(merge, [{ conflict, value }]);

    expect(radius(resolve(conflict.target))).toBe(0.2);
    expect(radius(resolve(conflict.source))).toBe(0.3);
    expect(radius(resolve(conflict.mergeBase))).toBe(0.12);
    expect(radius(resolve({ present: true, value: 0.4 }))).toBe(0.4);
    expect(radius(resolve({ present: false }))).toBeUndefined();
  });

  it('rejects prototype-bearing resolution paths in the merge core', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(target).title = 'Target title';
    leaf(source).title = 'Source title';
    const merge = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);
    const conflict = merge.conflicts[0]!;
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const unsafeConflict = {
        ...conflict,
        stablePath: [{ kind: 'field' as const, name }],
      };
      expect(() =>
        resolveProcedureTreeMergeConflicts(merge, [
          { conflict: unsafeConflict, value: { present: true, value: {} } },
        ]),
      ).toThrow('unsafe field');
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects unsafe object keys before generating merge paths', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    Object.defineProperty(leaf(source).action!.arguments, 'constructor', {
      configurable: true,
      enumerable: true,
      value: 'unsafe',
      writable: true,
    });

    expect(() => computeProcedureTreeThreeWayMerge(ancestor, target, source, 2)).toThrow(
      'stable path contains unsafe field constructor',
    );
  });

  it('reports delete-vs-edit conflicts for stable-id collections', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    const leafId = leaf(ancestor).id;
    target.nodes = target.nodes.filter((node) => node.id !== leafId);
    leaf(source).title = 'Edited while another branch deletes';

    const result = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);

    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        path: `$.nodes[id="${leafId}"]`,
        message: expect.stringContaining('Delete and edit'),
      }),
    );
  });

  it('treats unkeyed arrays atomically', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(target).dependsOn = ['target.dependency'];
    leaf(source).dependsOn = ['source.dependency'];

    const result = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);

    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        path: '$.nodes[id="snowman.head.eyes.left"].dependsOn',
        message: expect.stringContaining('differently'),
      }),
    );
  });

  it('rejects identity drift and detects empty source contribution', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    source.adapterId = 'other-adapter';

    const conflicting = computeProcedureTreeThreeWayMerge(ancestor, target, source, 2);
    expect(conflicting.conflicts.map((entry) => entry.path)).toContain('adapterId');
    const identityConflict = conflicting.conflicts.find((entry) => entry.path === 'adapterId')!;
    expect(() =>
      resolveProcedureTreeMergeConflicts(conflicting, [
        { conflict: identityConflict, value: identityConflict.source },
      ]),
    ).toThrow(/cannot change identity field/);
    expect(() =>
      resolveProcedureTreeMergeConflicts(conflicting, [
        { conflict: identityConflict, value: { present: false } },
      ]),
    ).toThrow(/cannot change identity field/);
    expect(() =>
      resolveProcedureTreeMergeConflicts(conflicting, [
        {
          conflict: identityConflict,
          value: identityConflict.target,
          choice: 'custom',
        },
      ]),
    ).toThrow(/cannot select custom/);
    expect(
      resolveProcedureTreeMergeConflicts(conflicting, [
        { conflict: identityConflict, value: identityConflict.target },
      ]).adapterId,
    ).toBe(target.adapterId);

    const unchanged = computeProcedureTreeThreeWayMerge(ancestor, target, ancestor, 2);
    expect(unchanged.conflicts).toEqual([]);
    expect(unchanged.changed).toBe(false);
  });

  it('does not treat stable-id collection representation order as a semantic change', () => {
    const ancestor = fixture();
    const target = structuredClone(ancestor);
    const source = structuredClone(ancestor);
    leaf(source).menuTracks[0]!.operations.reverse();

    expect(diffProcedureTrees(target, source)).toEqual([]);
    expect(computeProcedureTreeThreeWayMerge(ancestor, target, source, 2)).toMatchObject({
      conflicts: [],
      changed: false,
    });
  });
});
