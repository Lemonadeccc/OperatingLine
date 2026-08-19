import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProcedureTree, type ProcedureTree } from '@operatingline/protocol';

import {
  createProcedureRefinementScope,
  evaluateProcedureRefinementScope,
} from '../../../services/orchestrator/src/procedure-refinement-scope.js';

function fixture(): ProcedureTree {
  return parseProcedureTree(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  );
}

function target(base: ProcedureTree): ProcedureTree {
  return structuredClone({ ...base, revision: base.revision + 1 });
}

function leaf(tree: ProcedureTree) {
  const value = tree.nodes.find((node) => node.id === 'snowman.head.eyes.left');
  if (value?.kind !== 'leaf') throw new Error('Expected the snowman eye leaf fixture');
  return value;
}

function multiScopeFixture(): ProcedureTree {
  const tree = structuredClone(fixture());
  const leftEye = leaf(tree);
  tree.nodes.push(
    {
      ...structuredClone(leftEye),
      id: 'snowman.head.eyes.right',
      parentId: 'snowman.head.eyes',
      order: 2,
      title: 'Create and adjust the right eye sphere',
    },
    {
      id: 'snowman.body',
      parentId: 'snowman',
      order: 2,
      dependsOn: [],
      title: 'Create the body',
      intent: 'Create the snowman body.',
      kind: 'group',
    },
    {
      ...structuredClone(leftEye),
      id: 'snowman.body.core',
      parentId: 'snowman.body',
      order: 1,
      title: 'Create the body sphere',
    },
  );
  return parseProcedureTree(tree);
}

function findLeaf(tree: ProcedureTree, id: string) {
  const value = tree.nodes.find((node) => node.id === id);
  if (value?.kind !== 'leaf') throw new Error(`Expected leaf ${id}`);
  return value;
}

describe('Procedure refinement scope', () => {
  it('normalizes descendant roots under an explicitly selected ancestor', () => {
    const base = fixture();

    expect(
      createProcedureRefinementScope(base, [
        'snowman.head',
        'snowman.head.eyes',
        'snowman.head.eyes.left',
      ]).normalizedRootIds,
    ).toEqual(['snowman.head']);
  });

  it('rejects duplicate, missing, and unbounded scope roots before provider work', () => {
    const base = fixture();

    expect(() => createProcedureRefinementScope(base, ['snowman.head', 'snowman.head'])).toThrow(
      /unique/,
    );
    expect(() => createProcedureRefinementScope(base, ['missing'])).toThrow(/does not exist/);
    expect(() => createProcedureRefinementScope(base, [])).toThrow(/between one and eight/);
  });

  it('accepts a meaningful local leaf change and strips unverified interaction tracks', () => {
    const base = fixture();
    const candidate = target(base);
    const candidateLeaf = leaf(candidate);
    candidateLeaf.title = 'Create and place the refined left eye';
    candidateLeaf.intent = 'Create a smaller left eye and place it precisely.';

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes.left']);
    const refinedLeaf = leaf(result.targetTree);

    expect(result.locality.valid).toBe(true);
    expect(result.locality.changedLeafIds).toEqual(['snowman.head.eyes.left']);
    expect(refinedLeaf.validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: [],
    });
    expect(
      [...refinedLeaf.menuTracks, ...refinedLeaf.shortcutTracks, ...refinedLeaf.mcpTracks].every(
        (track) => track.availability === 'unavailable',
      ),
    ).toBe(true);
  });

  it('restores unchanged leaf validation and tracks before detecting a revision-only no-op', () => {
    const base = fixture();
    const candidate = target(base);
    const candidateLeaf = leaf(candidate);
    candidateLeaf.validation = {
      status: 'candidate',
      validatedHostVersions: [],
      notes: ['Provider-only validation edit must not count as a semantic change.'],
    };
    candidateLeaf.menuTracks = candidateLeaf.menuTracks.map((track) => ({
      id: track.id,
      availability: 'unavailable',
      title: track.title,
      reason: 'Provider-only track edit must not count as a semantic change.',
      modality: 'menu',
    }));

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes.left']);

    expect(result.locality.valid).toBe(false);
    expect(result.locality.findings.map((finding) => finding.code)).toContain('no_local_change');
    expect(leaf(result.targetTree)).toEqual(leaf(base));
    expect(result.locality.unchangedLeafIds).toEqual(['snowman.head.eyes.left']);
  });

  it('reports immutable fields, outside edits, and scope-root attachment changes', () => {
    const base = fixture();
    const candidate = target(base);
    candidate.title = 'Changed top-level title';
    const outsideGroup = candidate.nodes.find((node) => node.id === 'snowman.head');
    if (outsideGroup === undefined) throw new Error('Expected head group');
    outsideGroup.intent = 'Changed outside the selected leaf.';
    const candidateLeaf = leaf(candidate);
    candidateLeaf.order = 2;
    candidate.nodes.push({
      ...structuredClone(candidateLeaf),
      id: 'snowman.head.eyes.sibling',
      order: 1,
      title: 'Keep the original group structurally valid',
    });

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes.left']);
    const codes = result.locality.findings.map((finding) => finding.code);

    expect(result.locality.valid).toBe(false);
    expect(codes).toEqual(
      expect.arrayContaining([
        'immutable_tree_field_changed',
        'node_changed_outside_scope',
        'scope_root_attachment_changed',
      ]),
    );
  });

  it('requires the target revision to advance exactly once', () => {
    const base = fixture();
    const candidate = target(base);
    candidate.revision += 1;
    leaf(candidate).title = 'Refined eye';

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes.left']);

    expect(result.locality.findings.map((finding) => finding.code)).toContain(
      'target_revision_invalid',
    );
  });

  it('rejects moving an existing descendant between normalized scope roots', () => {
    const base = multiScopeFixture();
    const candidate = target(base);
    findLeaf(candidate, 'snowman.head.eyes.left').parentId = 'snowman.body';
    findLeaf(candidate, 'snowman.head.eyes.left').order = 2;
    findLeaf(candidate, 'snowman.head.eyes.right').order = 1;

    const result = evaluateProcedureRefinementScope(base, candidate, [
      'snowman.head.eyes',
      'snowman.body',
    ]);

    expect(result.locality.findings.map((finding) => finding.code)).toContain(
      'node_moved_across_scope',
    );
  });

  it('rejects a new node attached outside every normalized scope root', () => {
    const base = multiScopeFixture();
    const candidate = target(base);
    candidate.nodes.push({
      ...structuredClone(findLeaf(candidate, 'snowman.head.eyes.left')),
      id: 'snowman.accessory',
      parentId: 'snowman',
      order: 3,
      title: 'Create an unauthorized accessory',
    });

    const result = evaluateProcedureRefinementScope(base, candidate, [
      'snowman.head.eyes',
      'snowman.body',
    ]);

    expect(result.locality.findings.map((finding) => finding.code)).toContain(
      'node_added_outside_scope',
    );
  });

  it('rejects a new dependency edge across normalized scope roots', () => {
    const base = multiScopeFixture();
    const candidate = target(base);
    findLeaf(candidate, 'snowman.head.eyes.left').dependsOn = ['snowman.body.core'];

    const result = evaluateProcedureRefinementScope(base, candidate, [
      'snowman.head.eyes',
      'snowman.body',
    ]);

    expect(result.locality.findings.map((finding) => finding.code)).toContain(
      'dependency_added_across_scope',
    );
  });

  it('classifies an in-scope leaf deletion as a meaningful local change', () => {
    const base = multiScopeFixture();
    const candidate = target(base);
    candidate.nodes = candidate.nodes.filter((node) => node.id !== 'snowman.head.eyes.left');
    findLeaf(candidate, 'snowman.head.eyes.right').order = 1;

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes']);

    expect(result.locality.valid).toBe(true);
    expect(result.locality.deletedLeafIds).toEqual(['snowman.head.eyes.left']);
    expect(result.locality.changedNodeIds).toContain('snowman.head.eyes.left');
  });

  it('preserves an unchanged sibling leaf exactly while sanitizing a changed leaf', () => {
    const base = multiScopeFixture();
    const candidate = target(base);
    findLeaf(candidate, 'snowman.head.eyes.left').title = 'Create a larger left eye';
    const rightCandidate = findLeaf(candidate, 'snowman.head.eyes.right');
    rightCandidate.validation = {
      status: 'candidate',
      validatedHostVersions: [],
      notes: ['Untrusted provider-only edit.'],
    };

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes']);

    expect(findLeaf(result.targetTree, 'snowman.head.eyes.right')).toEqual(
      findLeaf(base, 'snowman.head.eyes.right'),
    );
    expect(result.locality.unchangedLeafIds).toContain('snowman.head.eyes.right');
  });

  it('treats node-array storage reordering as a semantic no-op', () => {
    const base = fixture();
    const candidate = target(base);
    candidate.nodes.reverse();

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head']);

    expect(result.locality.valid).toBe(false);
    expect(result.locality.changedNodeIds).toEqual([]);
    expect(result.locality.findings.map((finding) => finding.code)).toContain('no_local_change');
  });

  it('returns bounded deterministic evidence when locality findings exceed the public limit', () => {
    const expanded = fixture();
    const template = structuredClone(leaf(expanded));
    for (let index = 1; index <= 260; index += 1) {
      expanded.nodes.push({
        ...structuredClone(template),
        id: `snowman.head.eyes.extra.${String(index).padStart(3, '0')}`,
        order: index + 1,
        title: `Extra eye ${index}`,
      });
    }
    const base = parseProcedureTree(expanded);
    const candidate = target(base);
    for (const node of candidate.nodes) {
      if (node.kind === 'leaf' && node.id.includes('.extra.')) {
        node.title = `${node.title} changed outside scope`;
      }
    }

    const result = evaluateProcedureRefinementScope(base, candidate, ['snowman.head.eyes.left']);

    expect(result.locality.valid).toBe(false);
    expect(result.locality.totalFindingCount).toBe(260);
    expect(result.locality.findings).toHaveLength(256);
    expect(result.locality.findings.at(-1)?.code).toBe('findings_truncated');
  });
});
