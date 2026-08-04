import type { TaskNode } from './task-node.js';

export interface TaskPlanValidation {
  valid: boolean;
  errors: string[];
}

export interface ExecutableTaskPlanValidation extends TaskPlanValidation {
  executableIds: ReadonlySet<string>;
}

export function validateTaskPlan(nodes: readonly TaskNode[]): TaskPlanValidation {
  const errors: string[] = [];
  const byId = new Map<string, TaskNode>();

  for (const node of nodes) {
    if (byId.has(node.id)) {
      errors.push(`Duplicate task node id: ${node.id}`);
      continue;
    }
    byId.set(node.id, node);
  }

  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) {
    errors.push(`Task plan must contain exactly one root; found ${roots.length}`);
  }

  const groupIds = new Set(
    nodes.flatMap((node) => (node.parentId === null ? [] : [node.parentId])),
  );

  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      errors.push(`Unknown parent ${node.parentId} for ${node.id}`);
    }
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) {
        errors.push(`Unknown dependency ${dependency} for ${node.id}`);
      }
      if (dependency === node.id) {
        errors.push(`Task node ${node.id} cannot depend on itself`);
      }
      if (groupIds.has(dependency)) {
        errors.push(`Task node ${node.id} cannot depend on non-executable group ${dependency}`);
      }
    }
    if (groupIds.has(node.id) && node.dependsOn.length > 0) {
      errors.push(`Non-executable group ${node.id} cannot declare execution dependencies`);
    }
  }

  const parentVisiting = new Set<string>();
  const parentVisited = new Set<string>();
  const visitParent = (id: string): void => {
    if (parentVisiting.has(id)) {
      errors.push(`Hierarchy cycle includes ${id}`);
      return;
    }
    if (parentVisited.has(id)) {
      return;
    }

    parentVisiting.add(id);
    const parentId = byId.get(id)?.parentId;
    if (parentId !== null && parentId !== undefined && byId.has(parentId)) {
      visitParent(parentId);
    }
    parentVisiting.delete(id);
    parentVisited.add(id);
  };

  for (const id of byId.keys()) {
    visitParent(id);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle includes ${id}`);
      return;
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    const node = byId.get(id);
    for (const dependency of node?.dependsOn ?? []) {
      if (byId.has(dependency)) {
        visit(dependency);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) {
    visit(id);
  }

  return { valid: errors.length === 0, errors };
}

export function stableExecutionOrder(nodes: readonly TaskNode[]): TaskNode[] {
  const groupIds = new Set(
    nodes.flatMap((node) => (node.parentId === null ? [] : [node.parentId])),
  );
  const executableIds = new Set(
    nodes.filter((node) => !groupIds.has(node.id)).map((node) => node.id),
  );
  return stableExecutableOrder(nodes, executableIds);
}

export function validateExecutableTaskPlan(
  nodes: readonly TaskNode[],
  executableIds: ReadonlySet<string>,
): ExecutableTaskPlanValidation {
  const structural = validateTaskPlan(nodes);
  const errors = [...structural.errors];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groupIds = new Set(
    nodes.flatMap((node) => (node.parentId === null ? [] : [node.parentId])),
  );

  for (const executableId of executableIds) {
    const node = byId.get(executableId);
    if (!node) {
      errors.push(`Unknown executable task node: ${executableId}`);
      continue;
    }
    if (groupIds.has(executableId)) {
      errors.push(`Executable task node ${executableId} must be a hierarchy leaf`);
    }
    for (const dependency of node.dependsOn) {
      if (!executableIds.has(dependency)) {
        errors.push(
          `Executable task node ${executableId} depends on non-executable task ${dependency}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, executableIds };
}

export function stableExecutableOrder(
  nodes: readonly TaskNode[],
  executableIds: ReadonlySet<string>,
): TaskNode[] {
  const validation = validateExecutableTaskPlan(nodes, executableIds);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  const completed = new Set<string>();
  const remaining = new Map(
    nodes.filter((node) => executableIds.has(node.id)).map((node) => [node.id, node]),
  );
  const ordered: TaskNode[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => completed.has(dependency)))
      .sort(
        (left, right) =>
          left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );

    if (ready.length === 0) {
      throw new Error('No executable leaf remains');
    }

    const next = ready[0]!;
    ordered.push(next);
    completed.add(next.id);
    remaining.delete(next.id);
  }

  return ordered;
}
