import { describe, expect, it } from 'vitest';

import { transitionTaskNode, type TaskNode } from '@operatingline/domain';

const node: TaskNode = {
  id: 'node-1',
  parentId: null,
  order: 0,
  dependsOn: [],
  title: 'Create snowman',
  intent: 'Create a complete snowman scene',
  status: 'draft',
};

describe('task node state machine', () => {
  it('allows a draft node to become ready', () => {
    expect(transitionTaskNode(node, 'ready').status).toBe('ready');
  });

  it('rejects transitions that skip execution', () => {
    expect(() => transitionTaskNode(node, 'succeeded')).toThrow(
      'Invalid task node transition: draft -> succeeded',
    );
  });
});
