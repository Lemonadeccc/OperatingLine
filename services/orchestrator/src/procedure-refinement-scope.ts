import { isDeepStrictEqual } from 'node:util';

import {
  parseProcedureTree,
  procedureRefinementLocalityReportSchema,
  procedureRefinementScopePolicyVersion,
  procedureRefinementScopeSchema,
  stableProcedureLeafOrder,
  type ProcedureLeafNode,
  type ProcedureNode,
  type ProcedureRefinementLocalityReport,
  type ProcedureRefinementScope,
  type ProcedureTree,
} from '@operatingline/protocol';

type ProcedureRefinementLocalityFindingCode =
  ProcedureRefinementLocalityReport['findings'][number]['code'];

export interface ProcedureRefinementScopeEvaluation {
  readonly scope: ProcedureRefinementScope;
  readonly locality: ProcedureRefinementLocalityReport;
  readonly targetTree: ProcedureTree;
}

const maximumLocalityFindings = 256;

const immutableTreeFields = [
  'formatVersion',
  'id',
  'title',
  'adapterId',
  'actionCatalogVersion',
  'interactionCatalogVersion',
  'hostVersionRange',
  'rootNodeId',
  'sources',
  'evidence',
] as const satisfies readonly (keyof ProcedureTree)[];

function nodeMap(tree: ProcedureTree): ReadonlyMap<string, ProcedureNode> {
  return new Map(tree.nodes.map((node) => [node.id, node] as const));
}

function ancestorIds(nodeId: string, nodes: ReadonlyMap<string, ProcedureNode>): readonly string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>([nodeId]);
  let parentId = nodes.get(nodeId)?.parentId ?? null;
  while (parentId !== null && !visited.has(parentId)) {
    ancestors.push(parentId);
    visited.add(parentId);
    parentId = nodes.get(parentId)?.parentId ?? null;
  }
  return ancestors;
}

function normalizeScopeRoots(
  requestedRootIds: readonly string[],
  baseNodes: ReadonlyMap<string, ProcedureNode>,
): readonly string[] {
  const requested = new Set(requestedRootIds);
  return requestedRootIds.filter(
    (nodeId) => !ancestorIds(nodeId, baseNodes).some((ancestorId) => requested.has(ancestorId)),
  );
}

function owningScopeRoot(
  nodeId: string,
  nodes: ReadonlyMap<string, ProcedureNode>,
  normalizedRoots: ReadonlySet<string>,
): string | null {
  if (normalizedRoots.has(nodeId)) return nodeId;
  return ancestorIds(nodeId, nodes).find((ancestorId) => normalizedRoots.has(ancestorId)) ?? null;
}

function meaningfulLeafProjection(leaf: ProcedureLeafNode): object {
  const { validation, menuTracks, shortcutTracks, mcpTracks, ...meaningful } = leaf;
  void validation;
  void menuTracks;
  void shortcutTracks;
  void mcpTracks;
  return meaningful;
}

function unavailableMenuTracks(
  tracks: ProcedureLeafNode['menuTracks'],
): ProcedureLeafNode['menuTracks'] {
  return tracks.map((track) => ({
    id: track.id,
    availability: 'unavailable' as const,
    title: track.title,
    reason: 'This refined leaf requires separate interaction-catalog materialization.',
    modality: 'menu',
  }));
}

function unavailableShortcutTracks(
  tracks: ProcedureLeafNode['shortcutTracks'],
): ProcedureLeafNode['shortcutTracks'] {
  return tracks.map((track) => ({
    id: track.id,
    availability: 'unavailable' as const,
    title: track.title,
    reason: 'This refined leaf requires separate interaction-catalog materialization.',
    modality: 'shortcut',
  }));
}

function unavailableMcpTracks(
  tracks: ProcedureLeafNode['mcpTracks'],
): ProcedureLeafNode['mcpTracks'] {
  return tracks.map((track) => ({
    id: track.id,
    availability: 'unavailable' as const,
    title: track.title,
    reason: 'This refined leaf requires separate interaction-catalog materialization.',
    modality: 'mcp',
  }));
}

function sanitizeChangedLeaf(leaf: ProcedureLeafNode): ProcedureLeafNode {
  return {
    ...leaf,
    menuTracks: unavailableMenuTracks(leaf.menuTracks),
    shortcutTracks: unavailableShortcutTracks(leaf.shortcutTracks),
    mcpTracks: unavailableMcpTracks(leaf.mcpTracks),
    validation: {
      status: 'candidate',
      validatedHostVersions: [],
      notes: [],
    },
  };
}

function semanticTreeProjection(tree: ProcedureTree, revision: number): ProcedureTree {
  return {
    ...tree,
    revision,
    nodes: [...tree.nodes].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  };
}

export function createProcedureRefinementScope(
  baseTreeInput: ProcedureTree,
  requestedScopeRootIds: readonly string[],
): ProcedureRefinementScope {
  const baseTree = parseProcedureTree(baseTreeInput);
  if (requestedScopeRootIds.length < 1 || requestedScopeRootIds.length > 8) {
    throw new Error('Procedure refinement requires between one and eight scope roots');
  }
  if (new Set(requestedScopeRootIds).size !== requestedScopeRootIds.length) {
    throw new Error('Procedure refinement scope roots must be unique');
  }
  const baseNodes = nodeMap(baseTree);
  for (const rootId of requestedScopeRootIds) {
    if (!baseNodes.has(rootId)) {
      throw new Error(`Procedure refinement scope root ${rootId} does not exist in the base tree`);
    }
  }
  return procedureRefinementScopeSchema.parse({
    policyVersion: procedureRefinementScopePolicyVersion,
    requestedRootIds: [...requestedScopeRootIds],
    normalizedRootIds: [...normalizeScopeRoots(requestedScopeRootIds, baseNodes)],
    rules: {
      completeTreeRequired: true,
      topLevelIdentityMutable: false,
      outsideScopeMutable: false,
      scopeRootAttachmentMutable: false,
      descendantMoves: 'within_same_normalized_root',
      newNodes: 'within_normalized_roots',
      newCrossScopeDependencies: false,
      changedLeafInteractionTracks: 'unavailable',
      noOpAllowed: false,
    },
  });
}

export function evaluateProcedureRefinementScope(
  baseTreeInput: ProcedureTree,
  targetTreeInput: unknown,
  requestedScopeRootIds: readonly string[],
): ProcedureRefinementScopeEvaluation {
  const baseTree = parseProcedureTree(baseTreeInput);
  const rawTargetTree = parseProcedureTree(targetTreeInput);
  const scope = createProcedureRefinementScope(baseTree, requestedScopeRootIds);
  const findings: ProcedureRefinementLocalityReport['findings'][number][] = [];
  const findingKeys = new Set<string>();
  let totalFindingCount = 0;
  const addFinding = (
    code: ProcedureRefinementLocalityFindingCode,
    message: string,
    nodeIds: readonly string[] = [],
  ): void => {
    const normalizedNodeIds = [...new Set(nodeIds)].sort();
    const key = `${code}\u0000${normalizedNodeIds.join('\u0000')}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    totalFindingCount += 1;
    if (totalFindingCount <= maximumLocalityFindings) {
      findings.push({ code, message, nodeIds: normalizedNodeIds });
      return;
    }
    if (totalFindingCount === maximumLocalityFindings + 1) {
      findings[maximumLocalityFindings - 1] = {
        code: 'findings_truncated',
        message:
          'Additional deterministic locality findings were omitted from this bounded report.',
        nodeIds: [],
      };
    }
  };

  if (rawTargetTree.revision !== baseTree.revision + 1) {
    addFinding(
      'target_revision_invalid',
      `Target revision must be exactly ${baseTree.revision + 1}.`,
    );
  }
  for (const field of immutableTreeFields) {
    if (!isDeepStrictEqual(rawTargetTree[field], baseTree[field])) {
      addFinding(
        'immutable_tree_field_changed',
        `Procedure refinement cannot change immutable tree field ${field}.`,
      );
    }
  }

  const baseNodes = nodeMap(baseTree);
  const rawTargetNodes = nodeMap(rawTargetTree);
  const normalizedRoots = new Set(scope.normalizedRootIds);
  const baseOwners = new Map<string, string>();
  for (const nodeId of baseNodes.keys()) {
    const owner = owningScopeRoot(nodeId, baseNodes, normalizedRoots);
    if (owner !== null) baseOwners.set(nodeId, owner);
  }

  for (const rootId of scope.normalizedRootIds) {
    const before = baseNodes.get(rootId)!;
    const after = rawTargetNodes.get(rootId);
    if (after === undefined) {
      addFinding(
        'scope_root_missing',
        `Procedure refinement scope root ${rootId} must remain in the complete target tree.`,
        [rootId],
      );
      continue;
    }
    if (before.parentId !== after.parentId || before.order !== after.order) {
      addFinding(
        'scope_root_attachment_changed',
        `Procedure refinement scope root ${rootId} cannot change parent or order.`,
        [rootId],
      );
    }
  }

  for (const [nodeId, before] of baseNodes) {
    const after = rawTargetNodes.get(nodeId);
    const owner = baseOwners.get(nodeId);
    if (owner === undefined) {
      if (after === undefined || !isDeepStrictEqual(before, after)) {
        addFinding(
          'node_changed_outside_scope',
          `Procedure node ${nodeId} is outside every selected subtree and must remain exact.`,
          [nodeId],
        );
      }
      continue;
    }
    if (after === undefined) continue;
    if (before.kind !== after.kind) {
      addFinding(
        'node_kind_changed',
        `Existing Procedure node ${nodeId} cannot change kind during refinement.`,
        [nodeId],
      );
    }
    const targetOwner = owningScopeRoot(nodeId, rawTargetNodes, normalizedRoots);
    if (targetOwner !== owner) {
      addFinding(
        'node_moved_across_scope',
        `Procedure node ${nodeId} cannot move outside normalized scope root ${owner}.`,
        [nodeId, owner, ...(targetOwner === null ? [] : [targetOwner])],
      );
    }
  }

  for (const [nodeId, after] of rawTargetNodes) {
    if (baseNodes.has(nodeId)) continue;
    const owner = owningScopeRoot(nodeId, rawTargetNodes, normalizedRoots);
    if (owner === null) {
      addFinding(
        'node_added_outside_scope',
        `New Procedure node ${nodeId} must be attached inside a selected subtree.`,
        [nodeId],
      );
      continue;
    }
    void after;
  }

  for (const [nodeId, after] of rawTargetNodes) {
    const owner = owningScopeRoot(nodeId, rawTargetNodes, normalizedRoots);
    if (owner === null) continue;
    const before = baseNodes.get(nodeId);
    const priorDependencies = new Set(before?.dependsOn ?? []);
    for (const dependencyId of after.dependsOn) {
      if (priorDependencies.has(dependencyId)) continue;
      const dependencyOwner = owningScopeRoot(dependencyId, rawTargetNodes, normalizedRoots);
      if (dependencyOwner !== owner) {
        addFinding(
          'dependency_added_across_scope',
          `Procedure node ${nodeId} cannot add dependency ${dependencyId} across a scope boundary.`,
          [nodeId, dependencyId, owner, ...(dependencyOwner === null ? [] : [dependencyOwner])],
        );
      }
    }
  }

  const changedNodeIds: string[] = [];
  const changedLeafIds: string[] = [];
  const newLeafIds: string[] = [];
  const deletedLeafIds: string[] = [];
  const unchangedLeafIds: string[] = [];
  const sanitizedNodes = rawTargetTree.nodes.map((node): ProcedureNode => {
    const before = baseNodes.get(node.id);
    if (node.kind !== 'leaf') {
      if (before === undefined || !isDeepStrictEqual(before, node)) changedNodeIds.push(node.id);
      return node;
    }
    if (
      before?.kind === 'leaf' &&
      isDeepStrictEqual(meaningfulLeafProjection(before), meaningfulLeafProjection(node))
    ) {
      unchangedLeafIds.push(node.id);
      return structuredClone(before);
    }
    changedNodeIds.push(node.id);
    if (before === undefined) newLeafIds.push(node.id);
    else changedLeafIds.push(node.id);
    return sanitizeChangedLeaf(node);
  });
  for (const before of baseTree.nodes) {
    if (rawTargetNodes.has(before.id)) continue;
    changedNodeIds.push(before.id);
    if (before.kind === 'leaf') deletedLeafIds.push(before.id);
  }

  const targetTree = (() => {
    try {
      const parsed = parseProcedureTree({ ...rawTargetTree, nodes: sanitizedNodes });
      stableProcedureLeafOrder(parsed);
      return parsed;
    } catch (error) {
      throw new Error(
        `Sanitized Procedure refinement target is invalid: ${
          error instanceof Error ? error.message : 'unknown validation error'
        }`,
        { cause: error },
      );
    }
  })();

  if (
    isDeepStrictEqual(
      semanticTreeProjection(targetTree, baseTree.revision),
      semanticTreeProjection(baseTree, baseTree.revision),
    )
  ) {
    addFinding(
      'no_local_change',
      'Procedure refinement must make at least one meaningful in-scope change.',
    );
  }

  const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();
  const locality = procedureRefinementLocalityReportSchema.parse({
    policyVersion: procedureRefinementScopePolicyVersion,
    baseTree: { id: baseTree.id, revision: baseTree.revision },
    targetTree: { id: targetTree.id, revision: targetTree.revision },
    requestedRootIds: scope.requestedRootIds,
    normalizedRootIds: scope.normalizedRootIds,
    rules: scope.rules,
    valid: totalFindingCount === 0,
    findings,
    totalFindingCount,
    changedNodeIds: sortedUnique(changedNodeIds),
    changedLeafIds: sortedUnique(changedLeafIds),
    newLeafIds: sortedUnique(newLeafIds),
    deletedLeafIds: sortedUnique(deletedLeafIds),
    unchangedLeafIds: sortedUnique(unchangedLeafIds),
  });
  return { scope, locality, targetTree };
}
