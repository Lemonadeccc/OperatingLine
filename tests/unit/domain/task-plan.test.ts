import { describe, expect, it } from 'vitest';

import {
  stableExecutableOrder,
  stableExecutionOrder,
  validateExecutableTaskPlan,
  validateTaskPlan,
  type TaskNode,
} from '@operatingline/domain';

const nodes: TaskNode[] = [
  {
    id: 'root',
    parentId: null,
    order: 0,
    dependsOn: [],
    title: 'Snowman',
    intent: 'Create a snowman',
    status: 'draft',
  },
  {
    id: 'head',
    parentId: 'root',
    order: 2,
    dependsOn: ['body'],
    title: 'Head',
    intent: 'Create the head',
    status: 'draft',
  },
  {
    id: 'body',
    parentId: 'root',
    order: 1,
    dependsOn: [],
    title: 'Body',
    intent: 'Create the body',
    status: 'draft',
  },
];

describe('task plan', () => {
  it('keeps hierarchy separate from dependency order', () => {
    expect(validateTaskPlan(nodes)).toEqual({ valid: true, errors: [] });
    expect(stableExecutionOrder(nodes).map((node) => node.id)).toEqual(['body', 'head']);
  });

  it('rejects a dependency cycle', () => {
    const cyclic = nodes.map((node) =>
      node.id === 'body' ? { ...node, dependsOn: ['head'] } : node,
    );
    expect(validateTaskPlan(cyclic)).toMatchObject({ valid: false });
  });

  it('rejects hierarchy cycles and forests', () => {
    const hierarchyCycle = nodes.map((node) =>
      node.id === 'root' ? { ...node, parentId: 'body' } : node,
    );
    expect(validateTaskPlan(hierarchyCycle)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.stringContaining('exactly one root'),
        expect.stringContaining('Hierarchy cycle'),
      ]),
    });

    const forest = [
      ...nodes,
      {
        id: 'second-root',
        parentId: null,
        order: 3,
        dependsOn: [],
        title: 'Second root',
        intent: 'Invalid disconnected root',
        status: 'draft' as const,
      },
    ];
    expect(validateTaskPlan(forest)).toMatchObject({ valid: false });
  });

  it('rejects execution dependencies on hierarchy groups', () => {
    const dependsOnGroup = nodes.map((node) =>
      node.id === 'head' ? { ...node, dependsOn: ['root'] } : node,
    );
    expect(validateTaskPlan(dependsOnGroup)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('non-executable group root')]),
    });
  });

  it('topologically orders explicitly executable leaves', () => {
    const reversedDisplayOrder = nodes.map((node) =>
      node.id === 'body'
        ? { ...node, order: 2, dependsOn: ['head'] }
        : node.id === 'head'
          ? { ...node, order: 1, dependsOn: [] }
          : node,
    );
    const executableIds = new Set(['body', 'head']);
    expect(
      stableExecutableOrder(reversedDisplayOrder, executableIds).map((node) => node.id),
    ).toEqual(['head', 'body']);
  });

  it('uses ASCII ordinal ids to break equal-order ties deterministically', () => {
    const tied = nodes.map((node) =>
      node.id === 'head' ? { ...node, order: 1, dependsOn: [] } : node,
    );

    expect(stableExecutionOrder(tied).map((node) => node.id)).toEqual(['body', 'head']);
  });

  it('requires executable steps to be leaves and depend only on executable steps', () => {
    expect(validateExecutableTaskPlan(nodes, new Set(['root', 'body']))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('must be a hierarchy leaf')]),
    });
    expect(validateExecutableTaskPlan(nodes, new Set(['head']))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.stringContaining('depends on non-executable task body'),
      ]),
    });
  });
});
