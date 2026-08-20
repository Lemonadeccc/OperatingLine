import { isDeepStrictEqual } from 'node:util';

import type {
  OperatingLineDatabase,
  ProcedureTreeRevisionRef as DatabaseProcedureTreeRevisionRef,
  StoredProcedureTreeBranch as DatabaseStoredProcedureTreeBranch,
  StoredProcedureTreeComment as DatabaseStoredProcedureTreeComment,
  StoredProcedureTreeRevisionCommit as DatabaseStoredProcedureTreeRevisionCommit,
} from '@operatingline/persistence';
import {
  procedureTreeEditorBranchCreateRequestSchema,
  procedureTreeEditorBranchCreateResultSchema,
  procedureTreeEditorBranchGetRequestSchema,
  procedureTreeEditorBranchGetResultSchema,
  procedureTreeEditorBranchHistoryRequestSchema,
  procedureTreeEditorBranchHistoryResultSchema,
  procedureTreeEditorBranchListRequestSchema,
  procedureTreeEditorBranchListResultSchema,
  procedureTreeEditorBranchSchema,
  procedureTreeEditorCommentCreateRequestSchema,
  procedureTreeEditorCommentCreateResultSchema,
  procedureTreeEditorCommentListRequestSchema,
  procedureTreeEditorCommentListResultSchema,
  procedureTreeEditorCommentSchema,
  procedureTreeEditorCommitRequestSchema,
  procedureTreeEditorCommitResultSchema,
  procedureTreeEditorDiffResultSchema,
  procedureTreeEditorEditPreviewRequestSchema,
  procedureTreeEditorEditPreviewResultSchema,
  procedureTreeEditorFormatVersion,
  procedureTreeEditorMergePreviewRequestSchema,
  procedureTreeEditorMergePreviewResultSchema,
  procedureTreeEditorParameterFormRequestSchema,
  procedureTreeEditorParameterFormResultSchema,
  procedureTreeEditorRevisionCommitSchema,
  procedureTreeEditorRevisionRefSchema,
  procedureTreeEditorWorkspaceRequestSchema,
  procedureTreeEditorWorkspaceResultSchema,
  readProcedureParameterPath,
  protocolJsonValueCanonicalization,
  storedProcedureTreeSchema,
  writeProcedureParameterPath,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureLeafNode,
  type ProcedureParameterProjectionTarget,
  type ProcedureProjectedParameterValue,
  type ProcedureTree,
  type ProcedureTreeEditorBranch,
  type ProcedureTreeEditorComment,
  type ProcedureTreeEditorCommentAnchor,
  type ProcedureTreeEditorCommitRequest,
  type ProcedureTreeEditorDiffResult,
  type ProcedureTreeEditorMergePreviewRequest,
  type ProcedureTreeEditorMergeConflictResolution,
  type ProcedureTreeEditorParameterField,
  type ProcedureTreeEditorParameterTarget,
  type ProcedureTreeEditorPreviewBinding,
  type ProcedureTreeEditorRevisionCommit,
  type ProcedureTreeEditorRevisionRef,
  type StoredProcedureTree,
} from '@operatingline/protocol';

import {
  computeProcedureTreeThreeWayMerge,
  diffProcedureTrees,
  resolveProcedureTreeMergeConflicts,
  type ProcedureTreeDiffEntry,
  type ProcedureTreeMergeConflict,
} from './procedure-tree-editor.js';
import { applyProcedureTreeEditorMutationPolicy } from './procedure-tree-editor-mutation-policy.js';
import {
  projectProcedureTreeCatalogParameters,
  validateProcedureTreeParameterProjectionCatalog,
} from './procedure-authoring-materialization.js';

const portableParameterName = /^[A-Za-z][A-Za-z0-9_]*$/;

export type ProcedureTreeEditorErrorCode =
  | 'not_found'
  | 'conflict'
  | 'stale_head'
  | 'empty_diff'
  | 'empty_merge'
  | 'merge_base_unavailable'
  | 'merge_base_ambiguous'
  | 'preview_binding_mismatch'
  | 'validation_failed'
  | 'invalid_cursor';

export class ProcedureTreeEditorError extends Error {
  constructor(
    readonly code: ProcedureTreeEditorErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ProcedureTreeEditorError';
  }
}

type ProcedureTreeEditorDatabase = Pick<
  OperatingLineDatabase,
  | 'createProcedureTreeBranch'
  | 'getProcedureTreeBranch'
  | 'listProcedureTreeBranches'
  | 'getProcedureTreeBranchHead'
  | 'getProcedureTreeRevisionCommit'
  | 'listProcedureTreeRevisionCommits'
  | 'commitProcedureTreeRevision'
  | 'appendProcedureTreeComment'
  | 'getProcedureTreeComment'
  | 'listProcedureTreeComments'
>;

export interface ProcedureTreeEditorCoordinatorOptions {
  readonly database: ProcedureTreeEditorDatabase;
  readonly loadTree: (treeId: string, revision?: number) => StoredProcedureTree | null;
  readonly validateTree: (tree: ProcedureTree) => ProcedureTree;
  readonly computeContentSha256: (input: unknown) => string;
  readonly getActionCatalog: (tree: ProcedureTree) => ActionCatalog;
  readonly getInteractionCatalog: (tree: ProcedureTree) => InteractionCatalog;
}

export interface ProcedureTreeEditorCoordinator {
  createBranch(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorBranchCreateResultSchema.parse>;
  getBranch(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorBranchGetResultSchema.parse> | null;
  listBranches(input: unknown): ReturnType<typeof procedureTreeEditorBranchListResultSchema.parse>;
  workspace(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorWorkspaceResultSchema.parse> | null;
  history(input: unknown): ReturnType<typeof procedureTreeEditorBranchHistoryResultSchema.parse>;
  previewEdit(input: unknown): ReturnType<typeof procedureTreeEditorEditPreviewResultSchema.parse>;
  previewMerge(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorMergePreviewResultSchema.parse>;
  commit(input: unknown): ReturnType<typeof procedureTreeEditorCommitResultSchema.parse>;
  createComment(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorCommentCreateResultSchema.parse>;
  listComments(input: unknown): ReturnType<typeof procedureTreeEditorCommentListResultSchema.parse>;
  parameterForm(
    input: unknown,
  ): ReturnType<typeof procedureTreeEditorParameterFormResultSchema.parse>;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function databaseRef(reference: ProcedureTreeEditorRevisionRef): DatabaseProcedureTreeRevisionRef {
  return { revision: reference.revision, contentSha256: reference.contentSha256 };
}

function publicRef(
  treeId: string,
  reference: DatabaseProcedureTreeRevisionRef,
): ProcedureTreeEditorRevisionRef {
  return procedureTreeEditorRevisionRefSchema.parse({
    treeId,
    revision: reference.revision,
    contentSha256: reference.contentSha256,
  });
}

function storedTreeRef(tree: StoredProcedureTree): ProcedureTreeEditorRevisionRef {
  return procedureTreeEditorRevisionRefSchema.parse({
    treeId: tree.tree.id,
    revision: tree.tree.revision,
    contentSha256: tree.integrity.contentSha256,
  });
}

function requireTree(
  options: ProcedureTreeEditorCoordinatorOptions,
  reference: ProcedureTreeEditorRevisionRef,
  label: string,
): StoredProcedureTree {
  const tree = options.loadTree(reference.treeId, reference.revision);
  if (tree === null || tree.integrity.contentSha256 !== reference.contentSha256) {
    throw new ProcedureTreeEditorError('not_found', `${label} no longer exists exactly`, 404);
  }
  return tree;
}

function requireLatestTree(
  options: ProcedureTreeEditorCoordinatorOptions,
  treeId: string,
  expectedRevision: number,
): StoredProcedureTree {
  const latest = options.loadTree(treeId);
  if (latest === null) {
    throw new ProcedureTreeEditorError('not_found', `ProcedureTree ${treeId} was not found`, 404);
  }
  if (latest.tree.revision !== expectedRevision) {
    throw new ProcedureTreeEditorError(
      'stale_head',
      `ProcedureTree ${treeId} advanced to revision ${latest.tree.revision}`,
      409,
    );
  }
  return latest;
}

function branchFromDatabase(
  options: ProcedureTreeEditorCoordinatorOptions,
  branch: DatabaseStoredProcedureTreeBranch,
): ProcedureTreeEditorBranch {
  const request = procedureTreeEditorBranchCreateRequestSchema.parse(branch.payload);
  const head = options.database.getProcedureTreeBranchHead(branch.treeId, branch.branchId);
  if (head === null) {
    throw new Error(`Stored ProcedureTree branch has no derivable head: ${branch.branchId}`);
  }
  return procedureTreeEditorBranchSchema.parse({
    branchId: branch.branchId,
    treeId: branch.treeId,
    name: request.name,
    createdFrom: publicRef(branch.treeId, branch.createdFrom),
    head: publicRef(branch.treeId, head),
    createdAt: branch.createdAt,
  });
}

function requireBranch(
  options: ProcedureTreeEditorCoordinatorOptions,
  treeId: string,
  branchId: string,
): ProcedureTreeEditorBranch {
  const stored = options.database.getProcedureTreeBranch(treeId, branchId);
  if (stored === null) {
    throw new ProcedureTreeEditorError(
      'not_found',
      `ProcedureTree branch ${branchId} was not found`,
      404,
    );
  }
  return branchFromDatabase(options, stored);
}

function requireBranchHead(
  options: ProcedureTreeEditorCoordinatorOptions,
  treeId: string,
  branchId: string,
  expected: ProcedureTreeEditorRevisionRef,
): ProcedureTreeEditorBranch {
  const branch = requireBranch(options, treeId, branchId);
  if (!canonicalEqual(branch.head, expected)) {
    throw new ProcedureTreeEditorError(
      'stale_head',
      `ProcedureTree branch ${branchId} advanced to revision ${branch.head.revision}`,
      409,
    );
  }
  return branch;
}

function databaseTreeInput(tree: ProcedureTree, contentSha256: string) {
  return {
    treeId: tree.id,
    revision: tree.revision,
    title: tree.title,
    adapterId: tree.adapterId,
    actionCatalogVersion: tree.actionCatalogVersion,
    interactionCatalogVersion: tree.interactionCatalogVersion,
    hostVersionRange: tree.hostVersionRange,
    contentSha256,
    tree,
  };
}

function protocolDiffEntry(entry: ProcedureTreeDiffEntry) {
  const base = {
    stableId: entry.stableId,
    path: entry.stablePath,
    operation: entry.operation,
  } as const;
  if (entry.operation === 'add') return { ...base, after: entry.after };
  if (entry.operation === 'remove') return { ...base, before: entry.before };
  return { ...base, before: entry.before, after: entry.after };
}

function buildDiff(
  options: ProcedureTreeEditorCoordinatorOptions,
  base: ProcedureTreeEditorRevisionRef,
  target: ProcedureTreeEditorRevisionRef,
  before: ProcedureTree,
  after: ProcedureTree,
): ProcedureTreeEditorDiffResult {
  const entries = diffProcedureTrees(before, after).map(protocolDiffEntry);
  const contentSha256 = options.computeContentSha256({ base, target, entries });
  return procedureTreeEditorDiffResultSchema.parse({
    formatVersion: procedureTreeEditorFormatVersion,
    binding: {
      base,
      target,
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256,
    },
    entries,
  });
}

function previewContentSha256(
  options: ProcedureTreeEditorCoordinatorOptions,
  binding: Omit<ProcedureTreeEditorPreviewBinding, 'previewContentSha256'>,
): string {
  return options.computeContentSha256(binding);
}

function validateCandidate(
  options: ProcedureTreeEditorCoordinatorOptions,
  tree: ProcedureTree,
): ProcedureTree {
  try {
    return options.validateTree(tree);
  } catch (error) {
    throw new ProcedureTreeEditorError(
      'validation_failed',
      error instanceof Error ? error.message : 'ProcedureTree validation failed',
      422,
    );
  }
}

function projectionParameterRecord(
  leaf: ProcedureLeafNode,
  target: ProcedureParameterProjectionTarget,
): Record<string, unknown> {
  if (target.modality === 'semantic') {
    const operation = leaf.semanticOperations.find(
      (candidate) => candidate.id === target.operationId,
    );
    if (operation === undefined) {
      throw new Error(`Missing projected semantic operation ${target.operationId}`);
    }
    return operation.parameters;
  }
  if (target.modality === 'menu') {
    const track = leaf.menuTracks.find((candidate) => candidate.id === target.trackId);
    const operation =
      track?.availability === 'available'
        ? track.operations.find((candidate) => candidate.id === target.operationId)
        : undefined;
    if (operation === undefined)
      throw new Error(`Missing projected menu operation ${target.operationId}`);
    return operation.parameters;
  }
  if (target.modality === 'shortcut') {
    const track = leaf.shortcutTracks.find((candidate) => candidate.id === target.trackId);
    const operation =
      track?.availability === 'available'
        ? track.operations.find((candidate) => candidate.id === target.operationId)
        : undefined;
    if (operation === undefined) {
      throw new Error(`Missing projected shortcut operation ${target.operationId}`);
    }
    return operation.parameters;
  }
  const track = leaf.mcpTracks.find((candidate) => candidate.id === target.trackId);
  const operation =
    track?.availability === 'available'
      ? track.operations.find((candidate) => candidate.id === target.operationId)
      : undefined;
  if (operation === undefined)
    throw new Error(`Missing projected MCP operation ${target.operationId}`);
  return operation.arguments;
}

function projectionLeaf(tree: ProcedureTree, leafId: string): ProcedureLeafNode {
  const node = tree.nodes.find((candidate) => candidate.id === leafId);
  if (node?.kind !== 'leaf') throw new Error(`Missing projected leaf ${leafId}`);
  return node;
}

function containsParameterProjection(tree: ProcedureTree): boolean {
  return tree.nodes.some((node) => node.kind === 'leaf' && node.parameterProjection !== undefined);
}

/**
 * Accept an editor draft with the old displayed projection values, or the exact server-projected
 * values returned by an earlier preview. Bound values are removed before the mutation policy runs,
 * so every unbound representation edit still fails closed and commit can recompute the same preview.
 */
function mutationPolicyInputForProjection(
  base: ProcedureTree,
  candidate: ProcedureTree,
  projectedCandidate: ProcedureTree,
): ProcedureTree {
  const policyInput = structuredClone(candidate);
  for (const baseNode of base.nodes) {
    if (baseNode.kind !== 'leaf' || baseNode.parameterProjection === undefined) continue;
    const inputNode = candidate.nodes.find((node) => node.id === baseNode.id);
    if (inputNode === undefined) continue;
    if (inputNode.kind !== 'leaf') {
      throw new Error(`Projected node ${baseNode.id} changed kind`);
    }
    const inputLeaf = inputNode;
    const projectedLeaf = projectionLeaf(projectedCandidate, baseNode.id);
    const policyLeaf = projectionLeaf(policyInput, baseNode.id);
    for (const binding of baseNode.parameterProjection.bindings) {
      const baseValue = readProcedureParameterPath(
        projectionParameterRecord(baseNode, binding.target),
        binding.target.path,
      );
      const inputValue = readProcedureParameterPath(
        projectionParameterRecord(inputLeaf, binding.target),
        binding.target.path,
      );
      const projectedValue = readProcedureParameterPath(
        projectionParameterRecord(projectedLeaf, binding.target),
        binding.target.path,
      );
      if (!canonicalEqual(inputValue, baseValue) && !canonicalEqual(inputValue, projectedValue)) {
        throw new Error(
          `ProcedureTree editor received a non-authoritative projected value at binding ${binding.id}`,
        );
      }
      writeProcedureParameterPath(
        projectionParameterRecord(policyLeaf, binding.target),
        binding.target.path,
        structuredClone(baseValue) as ProcedureProjectedParameterValue,
      );
    }
  }
  return policyInput;
}

function copyNormalizedValidation(source: ProcedureTree, target: ProcedureTree): ProcedureTree {
  const normalized = structuredClone(target);
  const sourceLeaves = new Map(
    source.nodes
      .filter((node): node is ProcedureLeafNode => node.kind === 'leaf')
      .map((node) => [node.id, node]),
  );
  for (const node of normalized.nodes) {
    if (node.kind !== 'leaf') continue;
    const sourceLeaf = sourceLeaves.get(node.id);
    if (sourceLeaf !== undefined) node.validation = structuredClone(sourceLeaf.validation);
  }
  return normalized;
}

function validateCandidateAgainstBase(
  options: ProcedureTreeEditorCoordinatorOptions,
  base: ProcedureTree,
  candidate: ProcedureTree,
  projectionMode: 'project' | 'assert',
): ProcedureTree {
  let authorized: ProcedureTree;
  try {
    if (!containsParameterProjection(base)) {
      authorized = applyProcedureTreeEditorMutationPolicy(base, candidate);
      return validateCandidate(options, authorized);
    }
    const interactionCatalog = options.getInteractionCatalog(base);
    validateProcedureTreeParameterProjectionCatalog(base, interactionCatalog);
    validateProcedureTreeParameterProjectionCatalog(candidate, interactionCatalog);
    const candidateProjection = projectProcedureTreeCatalogParameters(
      candidate,
      interactionCatalog,
    );
    const policyInput = mutationPolicyInputForProjection(base, candidate, candidateProjection);
    const policyResult = applyProcedureTreeEditorMutationPolicy(base, policyInput);
    authorized = copyNormalizedValidation(policyResult, candidate);
    validateProcedureTreeParameterProjectionCatalog(authorized, interactionCatalog);
    const projected = projectProcedureTreeCatalogParameters(authorized, interactionCatalog);
    if (projectionMode === 'assert' && !canonicalEqual(projected, authorized)) {
      throw new Error('ProcedureTree merge candidate contains inconsistent projected parameters');
    }
    authorized = projectionMode === 'project' ? projected : authorized;
  } catch (error) {
    throw new ProcedureTreeEditorError(
      'validation_failed',
      error instanceof Error ? error.message : 'ProcedureTree editor mutation policy failed',
      422,
    );
  }
  return validateCandidate(options, authorized);
}

function editPreview(
  options: ProcedureTreeEditorCoordinatorOptions,
  request: ReturnType<typeof procedureTreeEditorEditPreviewRequestSchema.parse>,
) {
  const branch = requireBranchHead(options, request.base.treeId, request.branchId, request.base);
  requireLatestTree(options, branch.treeId, request.expectedLatestRevision);
  const baseTree = requireTree(options, request.base, 'ProcedureTree edit base');
  const targetTree = validateCandidateAgainstBase(
    options,
    baseTree.tree,
    request.targetTree,
    'project',
  );
  const targetContentSha256 = options.computeContentSha256(targetTree);
  const target = procedureTreeEditorRevisionRefSchema.parse({
    treeId: targetTree.id,
    revision: targetTree.revision,
    contentSha256: targetContentSha256,
  });
  const diff = buildDiff(options, request.base, target, baseTree.tree, targetTree);
  if (diff.entries.length === 0) {
    throw new ProcedureTreeEditorError(
      'empty_diff',
      'ProcedureTree edit does not change content outside revision allocation',
      422,
    );
  }
  const bindingWithoutDigest = {
    operation: 'edit' as const,
    branchId: request.branchId,
    base: request.base,
    expectedLatestRevision: request.expectedLatestRevision,
    target,
    diffContentSha256: diff.binding.contentSha256,
    algorithm: 'sha256' as const,
    canonicalization: protocolJsonValueCanonicalization,
  };
  const binding = {
    ...bindingWithoutDigest,
    previewContentSha256: previewContentSha256(options, bindingWithoutDigest),
  };
  return procedureTreeEditorEditPreviewResultSchema.parse({
    formatVersion: procedureTreeEditorFormatVersion,
    requestId: request.requestId,
    branchId: request.branchId,
    base: request.base,
    expectedLatestRevision: request.expectedLatestRevision,
    targetTree,
    targetIntegrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: targetContentSha256,
    },
    diff,
    binding,
    proposalCreated: false,
    hostExecutionStarted: false,
  });
}

function commitMap(
  treeId: string,
  commit: DatabaseStoredProcedureTreeRevisionCommit,
): ProcedureTreeEditorRevisionCommit {
  return procedureTreeEditorRevisionCommitSchema.parse({
    commitId: commit.requestId,
    requestId: commit.requestId,
    branchId: commit.branchId,
    operation: commit.operation,
    revision: publicRef(treeId, commit.target),
    parent: publicRef(treeId, commit.base),
    source:
      commit.source === null
        ? null
        : { branchId: commit.source.branchId, revision: publicRef(treeId, commit.source) },
    mergeBase: commit.mergeBase === null ? null : publicRef(treeId, commit.mergeBase),
    message: commit.message,
    occurredAt: commit.occurredAt,
  });
}

function graphParents(
  commits: readonly DatabaseStoredProcedureTreeRevisionCommit[],
): ReadonlyMap<number, readonly number[]> {
  return new Map(
    commits.map((commit) => [
      commit.target.revision,
      [commit.base.revision, ...(commit.source === null ? [] : [commit.source.revision])],
    ]),
  );
}

function ancestors(
  revision: number,
  parents: ReadonlyMap<number, readonly number[]>,
): ReadonlySet<number> {
  const result = new Set<number>();
  const visiting = new Set<number>();
  const visit = (candidate: number): void => {
    if (visiting.has(candidate)) {
      throw new Error(`ProcedureTree revision graph contains a cycle at ${candidate}`);
    }
    if (result.has(candidate)) return;
    visiting.add(candidate);
    result.add(candidate);
    for (const parent of parents.get(candidate) ?? []) visit(parent);
    visiting.delete(candidate);
  };
  visit(revision);
  return result;
}

function uniqueMergeBase(
  commits: readonly DatabaseStoredProcedureTreeRevisionCommit[],
  targetRevision: number,
  sourceRevision: number,
): number {
  const parents = graphParents(commits);
  const targetAncestors = ancestors(targetRevision, parents);
  const sourceAncestors = ancestors(sourceRevision, parents);
  const common = [...targetAncestors].filter((revision) => sourceAncestors.has(revision));
  if (common.length === 0) {
    throw new ProcedureTreeEditorError(
      'merge_base_unavailable',
      'ProcedureTree branches do not share a recorded ancestor',
      409,
    );
  }
  const ancestorCache = new Map<number, ReadonlySet<number>>();
  const of = (revision: number) => {
    const cached = ancestorCache.get(revision);
    if (cached !== undefined) return cached;
    const value = ancestors(revision, parents);
    ancestorCache.set(revision, value);
    return value;
  };
  const lowest = common.filter(
    (candidate) => !common.some((other) => other !== candidate && of(other).has(candidate)),
  );
  if (lowest.length !== 1) {
    throw new ProcedureTreeEditorError(
      'merge_base_ambiguous',
      'ProcedureTree branches have multiple lowest common ancestors',
      409,
    );
  }
  return lowest[0]!;
}

function protocolConflict(conflict: ProcedureTreeMergeConflict) {
  return {
    stableId: conflict.stableId,
    path: conflict.stablePath,
    mergeBase: conflict.mergeBase,
    target: conflict.target,
    source: conflict.source,
  };
}

function resolutionValue(resolution: ProcedureTreeEditorMergeConflictResolution) {
  if (resolution.choice === 'custom') return resolution.custom!;
  if (resolution.choice === 'base') return resolution.conflict.mergeBase;
  return resolution.conflict[resolution.choice];
}

function mergePreview(
  options: ProcedureTreeEditorCoordinatorOptions,
  request: ProcedureTreeEditorMergePreviewRequest,
) {
  requireBranchHead(options, request.targetHead.treeId, request.targetBranchId, request.targetHead);
  requireBranchHead(options, request.sourceHead.treeId, request.sourceBranchId, request.sourceHead);
  requireLatestTree(options, request.targetHead.treeId, request.expectedLatestRevision);
  const commits = options.database.listProcedureTreeRevisionCommits(request.targetHead.treeId);
  const mergeBaseRevision = uniqueMergeBase(
    commits,
    request.targetHead.revision,
    request.sourceHead.revision,
  );
  const mergeBaseStored = options.loadTree(request.targetHead.treeId, mergeBaseRevision);
  if (mergeBaseStored === null) {
    throw new ProcedureTreeEditorError(
      'merge_base_unavailable',
      `ProcedureTree merge base revision ${mergeBaseRevision} was not found`,
      409,
    );
  }
  const targetStored = requireTree(options, request.targetHead, 'ProcedureTree merge target');
  const sourceStored = requireTree(options, request.sourceHead, 'ProcedureTree merge source');
  const mergeBase = storedTreeRef(mergeBaseStored);
  const merge = computeProcedureTreeThreeWayMerge(
    mergeBaseStored.tree,
    targetStored.tree,
    sourceStored.tree,
    request.expectedLatestRevision + 1,
  );
  const base = {
    formatVersion: procedureTreeEditorFormatVersion,
    requestId: request.requestId,
    targetBranchId: request.targetBranchId,
    sourceBranchId: request.sourceBranchId,
    targetHead: request.targetHead,
    sourceHead: request.sourceHead,
    mergeBase,
    expectedLatestRevision: request.expectedLatestRevision,
    proposalCreated: false as const,
    hostExecutionStarted: false as const,
  };
  const authoritativeConflicts = merge.conflicts.map(protocolConflict);
  if (merge.conflicts.length > 0 && request.resolutions === undefined) {
    return procedureTreeEditorMergePreviewResultSchema.parse({
      ...base,
      status: 'conflicts',
      conflicts: authoritativeConflicts,
    });
  }
  if (
    (merge.conflicts.length === 0 && request.resolutions !== undefined) ||
    (request.resolutions !== undefined &&
      (request.resolutions.length !== authoritativeConflicts.length ||
        request.resolutions.some(
          (resolution, index) =>
            !canonicalEqual(resolution.conflict, authoritativeConflicts[index]),
        )))
  ) {
    throw new ProcedureTreeEditorError(
      'preview_binding_mismatch',
      'ProcedureTree merge resolutions are incomplete, stale, reordered, or tampered',
      409,
    );
  }
  const mergedTree =
    request.resolutions === undefined
      ? merge.tree
      : (() => {
          try {
            return resolveProcedureTreeMergeConflicts(
              merge,
              request.resolutions.map((resolution, index) => ({
                conflict: merge.conflicts[index]!,
                value: resolutionValue(resolution),
                choice: resolution.choice,
              })),
            );
          } catch (error) {
            throw new ProcedureTreeEditorError(
              'validation_failed',
              error instanceof Error ? error.message : 'ProcedureTree merge resolution failed',
              422,
            );
          }
        })();
  if (diffProcedureTrees(targetStored.tree, mergedTree).length === 0) {
    throw new ProcedureTreeEditorError(
      'empty_merge',
      'ProcedureTree source branch has no contribution to merge',
      422,
    );
  }
  const targetCandidate = validateCandidateAgainstBase(
    options,
    mergeBaseStored.tree,
    mergedTree,
    'assert',
  );
  const targetContentSha256 = options.computeContentSha256(targetCandidate);
  const target = procedureTreeEditorRevisionRefSchema.parse({
    treeId: targetCandidate.id,
    revision: targetCandidate.revision,
    contentSha256: targetContentSha256,
  });
  const diff = buildDiff(options, request.targetHead, target, targetStored.tree, targetCandidate);
  const bindingWithoutDigest = {
    operation: 'merge' as const,
    targetBranchId: request.targetBranchId,
    sourceBranchId: request.sourceBranchId,
    targetHead: request.targetHead,
    sourceHead: request.sourceHead,
    mergeBase,
    expectedLatestRevision: request.expectedLatestRevision,
    target,
    diffContentSha256: diff.binding.contentSha256,
    ...(request.resolutions === undefined ? {} : { resolutions: request.resolutions }),
    algorithm: 'sha256' as const,
    canonicalization: protocolJsonValueCanonicalization,
  };
  const binding = {
    ...bindingWithoutDigest,
    previewContentSha256: previewContentSha256(options, bindingWithoutDigest),
  };
  return procedureTreeEditorMergePreviewResultSchema.parse({
    ...base,
    status: 'ready',
    targetCandidate,
    targetIntegrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: targetContentSha256,
    },
    diff,
    binding,
  });
}

function assertPreviewBinding(
  options: ProcedureTreeEditorCoordinatorOptions,
  request: ProcedureTreeEditorCommitRequest,
): void {
  const binding = request.previewBinding;
  const { previewContentSha256: receivedDigest, ...unsigned } = binding;
  if (previewContentSha256(options, unsigned) !== receivedDigest) {
    throw new ProcedureTreeEditorError(
      'preview_binding_mismatch',
      'ProcedureTree preview binding digest is invalid',
      409,
    );
  }
  if (options.computeContentSha256(request.targetTree) !== request.targetIntegrity.contentSha256) {
    throw new ProcedureTreeEditorError(
      'preview_binding_mismatch',
      'ProcedureTree commit target hash does not match its preview',
      409,
    );
  }
}

function exactPreviewForCommit(
  options: ProcedureTreeEditorCoordinatorOptions,
  request: ProcedureTreeEditorCommitRequest,
): void {
  const binding = request.previewBinding;
  if (binding.operation === 'edit') {
    const preview = editPreview(
      options,
      procedureTreeEditorEditPreviewRequestSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        requestId: request.requestId,
        branchId: request.targetBranchId,
        base: request.expectedHead,
        expectedLatestRevision: binding.expectedLatestRevision,
        targetTree: request.targetTree,
        ...(request.message === undefined ? {} : { message: request.message }),
      }),
    );
    if (!canonicalEqual(preview.binding, binding)) {
      throw new ProcedureTreeEditorError(
        'preview_binding_mismatch',
        'ProcedureTree edit preview is stale or mismatched',
        409,
      );
    }
    return;
  }
  const preview = mergePreview(
    options,
    procedureTreeEditorMergePreviewRequestSchema.parse({
      formatVersion: procedureTreeEditorFormatVersion,
      requestId: request.requestId,
      targetBranchId: binding.targetBranchId,
      sourceBranchId: binding.sourceBranchId,
      targetHead: binding.targetHead,
      sourceHead: binding.sourceHead,
      expectedLatestRevision: binding.expectedLatestRevision,
      ...(binding.resolutions === undefined ? {} : { resolutions: binding.resolutions }),
    }),
  );
  if (
    preview.status !== 'ready' ||
    !canonicalEqual(preview.binding, binding) ||
    !canonicalEqual(preview.targetCandidate, request.targetTree)
  ) {
    throw new ProcedureTreeEditorError(
      'preview_binding_mismatch',
      'ProcedureTree merge preview is stale or mismatched',
      409,
    );
  }
}

function commentFromDatabase(
  comment: DatabaseStoredProcedureTreeComment,
): ProcedureTreeEditorComment {
  const request = procedureTreeEditorCommentCreateRequestSchema.parse(comment.payload);
  return procedureTreeEditorCommentSchema.parse({
    commentId: comment.commentId,
    branchId: comment.branchId,
    revision: publicRef(comment.treeId, comment.tree),
    anchor: request.anchor,
    body: request.body,
    createdAt: comment.occurredAt,
  });
}

function branchContainsRevision(
  options: ProcedureTreeEditorCoordinatorOptions,
  branch: ProcedureTreeEditorBranch,
  revision: number,
): boolean {
  return ancestors(
    branch.head.revision,
    graphParents(options.database.listProcedureTreeRevisionCommits(branch.treeId)),
  ).has(revision);
}

function leafForTarget(
  tree: ProcedureTree,
  target: ProcedureTreeEditorParameterTarget,
): ProcedureLeafNode {
  const node = tree.nodes.find((candidate) => candidate.id === target.nodeId);
  if (node?.kind !== 'leaf') {
    throw new ProcedureTreeEditorError(
      'not_found',
      `ProcedureTree leaf ${target.nodeId} was not found`,
      404,
    );
  }
  return node;
}

function parameterRecord(
  tree: ProcedureTree,
  target: ProcedureTreeEditorParameterTarget,
): { values: Readonly<Record<string, unknown>>; schemas: Readonly<Record<string, unknown>> } {
  const leaf = leafForTarget(tree, target);
  if (target.kind === 'action') {
    if (leaf.action === null) {
      throw new ProcedureTreeEditorError('not_found', `Leaf ${leaf.id} has no action`, 404);
    }
    return { values: leaf.action.arguments, schemas: {} };
  }
  if (target.kind === 'semantic') {
    const operation = leaf.semanticOperations.find(
      (candidate) => candidate.id === target.operationId,
    );
    if (operation === undefined) {
      throw new ProcedureTreeEditorError('not_found', 'Semantic operation was not found', 404);
    }
    return { values: operation.parameters, schemas: {} };
  }
  if (target.kind === 'mcp') {
    const track = leaf.mcpTracks.find((candidate) => candidate.id === target.trackId);
    if (track?.availability !== 'available') {
      throw new ProcedureTreeEditorError('not_found', 'Available MCP track was not found', 404);
    }
    const operation = track.operations.find((candidate) => candidate.id === target.operationId);
    if (operation === undefined) {
      throw new ProcedureTreeEditorError('not_found', 'MCP operation was not found', 404);
    }
    return { values: operation.arguments, schemas: {} };
  }
  const tracks = target.kind === 'menu' ? leaf.menuTracks : leaf.shortcutTracks;
  const track = tracks.find((candidate) => candidate.id === target.trackId);
  if (track?.availability !== 'available') {
    throw new ProcedureTreeEditorError(
      'not_found',
      'Available interaction track was not found',
      404,
    );
  }
  const operation = track.operations.find((candidate) => candidate.id === target.operationId);
  if (operation === undefined) {
    throw new ProcedureTreeEditorError('not_found', 'Interaction operation was not found', 404);
  }
  return { values: operation.parameters, schemas: {} };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteBound(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function hasOnlySchemaKeywords(
  schema: Readonly<Record<string, unknown>>,
  keywords: readonly string[],
): boolean {
  const allowed = new Set(keywords);
  return Object.keys(schema).every((keyword) => allowed.has(keyword));
}

function validOrderedBounds(minimum: unknown, maximum: unknown): boolean {
  const lower = finiteBound(minimum);
  const upper = finiteBound(maximum);
  return (
    (minimum === undefined || lower !== undefined) &&
    (maximum === undefined || upper !== undefined) &&
    (lower === undefined || upper === undefined || lower <= upper)
  );
}

function validOrderedLengths(minimum: unknown, maximum: unknown): boolean {
  const lower = nonnegativeInteger(minimum);
  const upper = nonnegativeInteger(maximum);
  return (
    (minimum === undefined || lower !== undefined) &&
    (maximum === undefined || upper !== undefined) &&
    (lower === undefined || upper === undefined || lower <= upper)
  );
}

function supportedParameterSchema(schemaInput: unknown): boolean {
  if (schemaInput === null || typeof schemaInput !== 'object' || Array.isArray(schemaInput)) {
    return false;
  }
  const schema = schemaInput as Record<string, unknown>;
  if (
    (schema['description'] !== undefined && typeof schema['description'] !== 'string') ||
    !['boolean', 'integer', 'number', 'array', 'string'].includes(String(schema['type']))
  ) {
    return false;
  }
  if (schema['enum'] !== undefined) {
    if (!hasOnlySchemaKeywords(schema, ['description', 'type', 'enum'])) return false;
    const type = schema['type'];
    if (
      !Array.isArray(schema['enum']) ||
      schema['enum'].length < 1 ||
      schema['enum'].length > 100 ||
      schema['enum'].some(
        (value) =>
          (type === 'boolean' && typeof value !== 'boolean') ||
          (type === 'string' && typeof value !== 'string') ||
          (type === 'integer' && !(typeof value === 'number' && Number.isInteger(value))) ||
          (type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) ||
          type === 'array',
      )
    ) {
      return false;
    }
    return (
      new Set(schema['enum'].map((value) => JSON.stringify(value))).size === schema['enum'].length
    );
  }
  if (schema['type'] === 'boolean') {
    return hasOnlySchemaKeywords(schema, ['description', 'type']);
  }
  if (schema['type'] === 'integer' || schema['type'] === 'number') {
    return (
      hasOnlySchemaKeywords(schema, ['description', 'type', 'minimum', 'maximum']) &&
      validOrderedBounds(schema['minimum'], schema['maximum'])
    );
  }
  if (schema['type'] === 'string') {
    if (
      !hasOnlySchemaKeywords(schema, [
        'description',
        'type',
        'pattern',
        'minLength',
        'maxLength',
      ]) ||
      (schema['pattern'] !== undefined && typeof schema['pattern'] !== 'string') ||
      !validOrderedLengths(schema['minLength'], schema['maxLength'])
    ) {
      return false;
    }
    if (typeof schema['pattern'] === 'string') {
      try {
        new RegExp(schema['pattern']);
      } catch {
        return false;
      }
    }
    return true;
  }
  if (
    !hasOnlySchemaKeywords(schema, ['description', 'type', 'minItems', 'maxItems', 'items']) ||
    !validOrderedLengths(schema['minItems'], schema['maxItems']) ||
    schema['minItems'] !== schema['maxItems'] ||
    nonnegativeInteger(schema['minItems']) === undefined ||
    Number(schema['minItems']) < 1 ||
    Number(schema['minItems']) > 4
  ) {
    return false;
  }
  const items = schema['items'];
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return false;
  const itemSchema = items as Record<string, unknown>;
  return (
    hasOnlySchemaKeywords(itemSchema, ['description', 'type', 'minimum', 'maximum']) &&
    ['integer', 'number'].includes(String(itemSchema['type'])) &&
    (itemSchema['description'] === undefined || typeof itemSchema['description'] === 'string') &&
    validOrderedBounds(itemSchema['minimum'], itemSchema['maximum'])
  );
}

function readonlyParameterField(
  name: string,
  value: unknown,
  description: string,
): ProcedureTreeEditorParameterField {
  const base = { name, label: name, description };
  return typeof value === 'string'
    ? { ...base, kind: 'string', editable: false, originalValue: value, value }
    : {
        ...base,
        kind: 'structured',
        editable: false,
        originalValue: value as never,
        value: value as never,
      };
}

function parameterField(
  name: string,
  value: unknown,
  schemaInput: unknown,
  editable: boolean,
): ProcedureTreeEditorParameterField {
  const schema = recordValue(schemaInput);
  const description = typeof schema['description'] === 'string' ? schema['description'] : '';
  if (!editable || !supportedParameterSchema(schemaInput)) {
    return readonlyParameterField(name, value, description);
  }
  const base = { name, label: name, description };
  const enumValues = Array.isArray(schema['enum'])
    ? schema['enum'].filter(
        (candidate) =>
          typeof candidate === 'boolean' ||
          typeof candidate === 'string' ||
          (typeof candidate === 'number' && Number.isFinite(candidate)),
      )
    : [];
  if (enumValues.length > 0 && enumValues.some((candidate) => canonicalEqual(candidate, value))) {
    return {
      ...base,
      kind: 'enum',
      editable: true,
      originalValue: value as never,
      value: value as never,
      enumValues,
    };
  }
  if (typeof value === 'boolean' && schema['type'] === 'boolean') {
    return { ...base, kind: 'boolean', editable: true, originalValue: value, value };
  }
  if (typeof value === 'number' && Number.isInteger(value) && schema['type'] === 'integer') {
    return {
      ...base,
      kind: 'integer',
      editable: true,
      originalValue: value,
      value,
      ...(finiteBound(schema['minimum']) === undefined
        ? {}
        : { minimum: finiteBound(schema['minimum']) }),
      ...(finiteBound(schema['maximum']) === undefined
        ? {}
        : { maximum: finiteBound(schema['maximum']) }),
    };
  }
  if (typeof value === 'number' && Number.isFinite(value) && schema['type'] === 'number') {
    return {
      ...base,
      kind: 'number',
      editable: true,
      originalValue: value,
      value,
      ...(finiteBound(schema['minimum']) === undefined
        ? {}
        : { minimum: finiteBound(schema['minimum']) }),
      ...(finiteBound(schema['maximum']) === undefined
        ? {}
        : { maximum: finiteBound(schema['maximum']) }),
    };
  }
  if (Array.isArray(value) && value.length >= 1 && value.length <= 4) {
    const items = recordValue(schema['items']);
    const numeric = value.every(
      (candidate) => typeof candidate === 'number' && Number.isFinite(candidate),
    );
    const integer = numeric && value.every((candidate) => Number.isInteger(candidate));
    const fixedSchema =
      schema['type'] === 'array' &&
      schema['minItems'] === value.length &&
      schema['maxItems'] === value.length;
    if (numeric && fixedSchema && (items['type'] === 'number' || items['type'] === 'integer')) {
      const bounds = {
        ...(finiteBound(items['minimum']) === undefined
          ? {}
          : { minimum: finiteBound(items['minimum']) }),
        ...(finiteBound(items['maximum']) === undefined
          ? {}
          : { maximum: finiteBound(items['maximum']) }),
      };
      return integer && items['type'] === 'integer'
        ? {
            ...base,
            kind: 'integer_vector',
            editable: true,
            originalValue: value,
            value,
            vectorLength: value.length,
            ...bounds,
          }
        : {
            ...base,
            kind: 'number_vector',
            editable: true,
            originalValue: value,
            value,
            vectorLength: value.length,
            ...bounds,
          };
    }
  }
  if (typeof value === 'string') {
    if (schema['type'] === 'string') {
      return {
        ...base,
        kind: 'string',
        editable: true,
        originalValue: value,
        value,
        ...(typeof schema['pattern'] === 'string' ? { pattern: schema['pattern'] } : {}),
        ...(nonnegativeInteger(schema['minLength']) === undefined
          ? {}
          : { minLength: nonnegativeInteger(schema['minLength']) }),
        ...(nonnegativeInteger(schema['maxLength']) === undefined
          ? {}
          : { maxLength: nonnegativeInteger(schema['maxLength']) }),
      };
    }
    return { ...base, kind: 'string', editable: false, originalValue: value, value };
  }
  return {
    ...base,
    kind: 'structured',
    editable: false,
    originalValue: value as never,
    value: value as never,
  };
}

function validateCommentAnchor(
  tree: ProcedureTree,
  anchor: ProcedureTreeEditorCommentAnchor,
): void {
  if (anchor.kind === 'tree') return;
  const node = tree.nodes.find((candidate) => candidate.id === anchor.nodeId);
  if (node === undefined) {
    throw new ProcedureTreeEditorError(
      'not_found',
      `Comment node ${anchor.nodeId} was not found`,
      404,
    );
  }
  if (anchor.kind === 'node') return;
  if (node.kind !== 'leaf') {
    throw new ProcedureTreeEditorError('not_found', 'Comment track target is not a leaf', 404);
  }
  if (anchor.kind === 'operation' && anchor.modality === 'semantic') {
    if (!node.semanticOperations.some((operation) => operation.id === anchor.operationId)) {
      throw new ProcedureTreeEditorError(
        'not_found',
        'Comment semantic operation was not found',
        404,
      );
    }
    return;
  }
  const modality = anchor.modality;
  const tracks =
    modality === 'menu'
      ? node.menuTracks
      : modality === 'shortcut'
        ? node.shortcutTracks
        : node.mcpTracks;
  const track = tracks.find((candidate) => candidate.id === anchor.trackId);
  if (track === undefined) {
    throw new ProcedureTreeEditorError('not_found', 'Comment track was not found', 404);
  }
  if (anchor.kind === 'track') return;
  if (
    track.availability !== 'available' ||
    !track.operations.some((operation) => operation.id === anchor.operationId)
  ) {
    throw new ProcedureTreeEditorError('not_found', 'Comment operation was not found', 404);
  }
}

export function createProcedureTreeEditorCoordinator(
  options: ProcedureTreeEditorCoordinatorOptions,
): ProcedureTreeEditorCoordinator {
  return {
    createBranch(input) {
      const request = procedureTreeEditorBranchCreateRequestSchema.parse(input);
      requireTree(options, request.createdFrom, 'ProcedureTree branch base');
      const stored = options.database.createProcedureTreeBranch({
        treeId: request.treeId,
        branchId: request.requestId,
        createdFrom: databaseRef(request.createdFrom),
        createdAt: request.occurredAt,
        payload: request,
      });
      if (!('branch' in stored)) {
        throw new ProcedureTreeEditorError(
          stored.result,
          stored.result === 'not_found'
            ? 'ProcedureTree branch base was not found'
            : 'ProcedureTree branch identity conflicts with stored data',
          stored.result === 'not_found' ? 404 : 409,
        );
      }
      return procedureTreeEditorBranchCreateResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        requestId: request.requestId,
        result: stored.result,
        branch: branchFromDatabase(options, stored.branch),
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    },
    getBranch(input) {
      const request = procedureTreeEditorBranchGetRequestSchema.parse(input);
      const branch = options.database.getProcedureTreeBranch(request.treeId, request.branchId);
      return branch === null
        ? null
        : procedureTreeEditorBranchGetResultSchema.parse({
            formatVersion: procedureTreeEditorFormatVersion,
            branch: branchFromDatabase(options, branch),
          });
    },
    listBranches(input) {
      const request = procedureTreeEditorBranchListRequestSchema.parse(input);
      const branches = options.database
        .listProcedureTreeBranches(request.treeId)
        .map((branch) => branchFromDatabase(options, branch));
      const start = (() => {
        if (request.afterBranchId === undefined) return 0;
        const index = branches.findIndex((branch) => branch.branchId === request.afterBranchId);
        if (index < 0) {
          throw new ProcedureTreeEditorError('invalid_cursor', 'Branch cursor was not found', 400);
        }
        return index + 1;
      })();
      const limit = request.limit ?? 50;
      const page = branches.slice(start, start + limit + 1);
      const visible = page.slice(0, limit);
      return procedureTreeEditorBranchListResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        branches: visible,
        nextAfterBranchId: page.length > limit ? (visible.at(-1)?.branchId ?? null) : null,
      });
    },
    workspace(input) {
      const request = procedureTreeEditorWorkspaceRequestSchema.parse(input);
      const stored = options.database.getProcedureTreeBranch(request.treeId, request.branchId);
      if (stored === null) return null;
      const branch = branchFromDatabase(options, stored);
      const tree = requireTree(options, branch.head, 'ProcedureTree branch head');
      return procedureTreeEditorWorkspaceResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        branch,
        tree: tree.tree,
        integrity: tree.integrity,
        commentsAreTreeContent: false,
      });
    },
    history(input) {
      const request = procedureTreeEditorBranchHistoryRequestSchema.parse(input);
      const branch = requireBranch(options, request.treeId, request.branchId);
      const commits = options.database.listProcedureTreeRevisionCommits(
        request.treeId,
        request.branchId,
      );
      const snapshotBelongsToBranch =
        canonicalEqual(branch.createdFrom, request.expectedHead) ||
        commits.some((commit) =>
          canonicalEqual(publicRef(request.treeId, commit.target), request.expectedHead),
        );
      if (!snapshotBelongsToBranch) {
        throw new ProcedureTreeEditorError(
          'invalid_cursor',
          'History snapshot head is not in the requested branch lineage',
          400,
        );
      }
      const afterRevision = request.afterRevision ?? 0;
      const limit = request.limit ?? 50;
      const page = commits
        .filter(
          (commit) =>
            commit.target.revision > afterRevision &&
            commit.target.revision <= request.expectedHead.revision,
        )
        .slice(0, limit + 1);
      const visible = page.slice(0, limit).map((commit) => commitMap(request.treeId, commit));
      return procedureTreeEditorBranchHistoryResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        treeId: request.treeId,
        branchId: request.branchId,
        snapshotHead: request.expectedHead,
        commits: visible,
        nextAfterRevision: page.length > limit ? (visible.at(-1)?.revision.revision ?? null) : null,
      });
    },
    previewEdit(input) {
      return editPreview(options, procedureTreeEditorEditPreviewRequestSchema.parse(input));
    },
    previewMerge(input) {
      return mergePreview(options, procedureTreeEditorMergePreviewRequestSchema.parse(input));
    },
    commit(input) {
      const request = procedureTreeEditorCommitRequestSchema.parse(input);
      assertPreviewBinding(options, request);
      const existing = options.database.getProcedureTreeRevisionCommit(request.requestId);
      const targetTree =
        existing === null ? validateCandidate(options, request.targetTree) : request.targetTree;
      if (existing === null) exactPreviewForCommit(options, request);
      const binding = request.previewBinding;
      const persisted = options.database.commitProcedureTreeRevision({
        requestId: request.requestId,
        branchId: request.targetBranchId,
        operation: request.operation,
        base: databaseRef(request.expectedHead),
        expectedLatestRevision: binding.expectedLatestRevision,
        target: databaseTreeInput(targetTree, request.targetIntegrity.contentSha256),
        ...(binding.operation === 'merge'
          ? {
              source: {
                branchId: binding.sourceBranchId,
                ...databaseRef(binding.sourceHead),
              },
              mergeBase: databaseRef(binding.mergeBase),
            }
          : {}),
        ...(request.message === undefined ? {} : { message: request.message }),
        occurredAt: request.occurredAt,
        payload: request,
      });
      if (!('commit' in persisted)) {
        const statusCode = persisted.result === 'not_found' ? 404 : 409;
        throw new ProcedureTreeEditorError(
          persisted.result,
          `ProcedureTree commit failed: ${persisted.result}`,
          statusCode,
        );
      }
      const branch = requireBranch(options, targetTree.id, request.targetBranchId);
      const commit = commitMap(targetTree.id, persisted.commit);
      return procedureTreeEditorCommitResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        requestId: request.requestId,
        result: persisted.result,
        occurredAt: request.occurredAt,
        operation: request.operation,
        branch,
        commit,
        tree: storedProcedureTreeSchema.parse({
          sequence: persisted.record.sequence,
          tree: persisted.record.tree,
          integrity: {
            algorithm: 'sha256',
            canonicalization: protocolJsonValueCanonicalization,
            contentSha256: persisted.record.contentSha256,
          },
          storedAt: persisted.record.storedAt,
        }).tree,
        integrity: {
          algorithm: 'sha256',
          canonicalization: protocolJsonValueCanonicalization,
          contentSha256: persisted.record.contentSha256,
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    },
    createComment(input) {
      const request = procedureTreeEditorCommentCreateRequestSchema.parse(input);
      const existing = options.database.getProcedureTreeComment(request.requestId);
      if (existing === null) {
        const branch = requireBranch(options, request.revision.treeId, request.branchId);
        if (!branchContainsRevision(options, branch, request.revision.revision)) {
          throw new ProcedureTreeEditorError(
            'not_found',
            'Comment revision is not part of the selected branch',
            404,
          );
        }
        const tree = requireTree(options, request.revision, 'ProcedureTree comment revision');
        validateCommentAnchor(tree.tree, request.anchor);
      }
      const stored = options.database.appendProcedureTreeComment({
        commentId: request.requestId,
        treeId: request.revision.treeId,
        branchId: request.branchId,
        tree: databaseRef(request.revision),
        occurredAt: request.occurredAt,
        payload: request,
      });
      if (!('comment' in stored)) {
        throw new ProcedureTreeEditorError(
          stored.result,
          `ProcedureTree comment failed: ${stored.result}`,
          stored.result === 'not_found' ? 404 : 409,
        );
      }
      return procedureTreeEditorCommentCreateResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        requestId: request.requestId,
        result: stored.result,
        comment: commentFromDatabase(stored.comment),
        commentsAreTreeContent: false,
      });
    },
    listComments(input) {
      const request = procedureTreeEditorCommentListRequestSchema.parse(input);
      const branch = requireBranch(options, request.treeId, request.branchId);
      let afterSequence = 0;
      let cursorFound = request.afterCommentId === undefined;
      const matches: Array<{ sequence: number; comment: ProcedureTreeEditorComment }> = [];
      while (matches.length < (request.limit ?? 50) + 1) {
        const page = options.database.listProcedureTreeComments(
          branch.treeId,
          branch.branchId,
          afterSequence,
          1_000,
        );
        if (page.length === 0) break;
        for (const stored of page) {
          afterSequence = stored.sequence;
          if (!cursorFound) {
            if (stored.commentId === request.afterCommentId) cursorFound = true;
            continue;
          }
          const comment = commentFromDatabase(stored);
          if (
            (request.revision === undefined ||
              canonicalEqual(comment.revision, request.revision)) &&
            (request.anchor === undefined || canonicalEqual(comment.anchor, request.anchor))
          ) {
            matches.push({ sequence: stored.sequence, comment });
          }
          if (matches.length >= (request.limit ?? 50) + 1) break;
        }
        if (page.length < 1_000) break;
      }
      if (!cursorFound) {
        throw new ProcedureTreeEditorError('invalid_cursor', 'Comment cursor was not found', 400);
      }
      const limit = request.limit ?? 50;
      const visible = matches.slice(0, limit).map(({ comment }) => comment);
      return procedureTreeEditorCommentListResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        comments: visible,
        nextAfterCommentId: matches.length > limit ? (visible.at(-1)?.commentId ?? null) : null,
        commentsAreTreeContent: false,
      });
    },
    parameterForm(input) {
      const request = procedureTreeEditorParameterFormRequestSchema.parse(input);
      const branch = requireBranch(options, request.revision.treeId, request.branchId);
      if (!branchContainsRevision(options, branch, request.revision.revision)) {
        throw new ProcedureTreeEditorError(
          'not_found',
          'Parameter form revision is not part of the selected branch',
          404,
        );
      }
      const stored = requireTree(options, request.revision, 'ProcedureTree parameter revision');
      const resolved = parameterRecord(stored.tree, request.target);
      let schemas = resolved.schemas;
      let projectedArguments = new Set<string>();
      if (request.target.kind === 'action') {
        const leaf = leafForTarget(stored.tree, request.target);
        if (leaf.parameterProjection !== undefined) {
          try {
            const interactionCatalog = options.getInteractionCatalog(stored.tree);
            validateProcedureTreeParameterProjectionCatalog(stored.tree, interactionCatalog);
          } catch (error) {
            throw new ProcedureTreeEditorError(
              'validation_failed',
              error instanceof Error
                ? error.message
                : 'ProcedureTree parameter projection authority failed',
              422,
            );
          }
          const action = options
            .getActionCatalog(stored.tree)
            .actions.find((candidate) => candidate.name === leaf.action?.name);
          if (action === undefined) {
            throw new ProcedureTreeEditorError(
              'not_found',
              'Action parameter schema was not found',
              404,
            );
          }
          schemas = recordValue(action.argumentsSchema['properties']);
          projectedArguments = new Set(
            leaf.parameterProjection.arguments
              .filter((coverage) => coverage.disposition === 'projected')
              .map((coverage) => coverage.actionArgument),
          );
        }
      }
      const fields = Object.entries(resolved.values).map(([name, value]) => {
        if (!portableParameterName.test(name)) {
          throw new ProcedureTreeEditorError(
            'validation_failed',
            `Parameter ${name} cannot be represented by the portable form contract`,
            422,
          );
        }
        return parameterField(
          name,
          value,
          schemas[name],
          request.target.kind === 'action' && projectedArguments.has(name),
        );
      });
      return procedureTreeEditorParameterFormResultSchema.parse({
        formatVersion: procedureTreeEditorFormatVersion,
        branchId: request.branchId,
        revision: request.revision,
        target: request.target,
        fields,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    },
  };
}
