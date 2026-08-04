export const taskNodeStates = [
  'draft',
  'ready',
  'running',
  'waiting_approval',
  'verifying',
  'succeeded',
  'failed',
  'stale',
  'rolled_back',
] as const;

export type TaskNodeState = (typeof taskNodeStates)[number];

export interface TaskNode {
  id: string;
  parentId: string | null;
  order: number;
  dependsOn: string[];
  title: string;
  intent: string;
  status: TaskNodeState;
}

const transitions: Readonly<Record<TaskNodeState, readonly TaskNodeState[]>> = {
  draft: ['ready'],
  ready: ['running', 'waiting_approval', 'stale'],
  running: ['verifying', 'failed'],
  waiting_approval: ['ready', 'failed'],
  verifying: ['succeeded', 'failed'],
  succeeded: ['stale', 'rolled_back'],
  failed: ['ready', 'rolled_back'],
  stale: ['ready', 'rolled_back'],
  rolled_back: ['ready'],
};

export function canTransitionTaskNode(from: TaskNodeState, to: TaskNodeState): boolean {
  return transitions[from].includes(to);
}

export function transitionTaskNode(node: TaskNode, to: TaskNodeState): TaskNode {
  if (!canTransitionTaskNode(node.status, to)) {
    throw new Error(`Invalid task node transition: ${node.status} -> ${to}`);
  }

  return { ...node, status: to };
}
