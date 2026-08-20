import { isDeepStrictEqual } from 'node:util';

import type { ProcedureTree } from '@operatingline/protocol';

const MISSING = Symbol('missing');
type MergeValue = unknown | typeof MISSING;

const stableIdCollectionFields = new Set([
  'sources',
  'evidence',
  'nodes',
  'semanticOperations',
  'menuTracks',
  'shortcutTracks',
  'mcpTracks',
  'operations',
]);
const unsafeStablePathFields = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeStablePathField(field: string): void {
  if (unsafeStablePathFields.has(field)) {
    throw new Error(`ProcedureTree stable path contains unsafe field ${field}`);
  }
}

export type ProcedureTreeEditorStableCollection =
  | 'sources'
  | 'evidence'
  | 'nodes'
  | 'semanticOperations'
  | 'menuTracks'
  | 'shortcutTracks'
  | 'mcpTracks'
  | 'operations';

export type ProcedureTreeEditorStablePathSegment =
  | { readonly kind: 'field'; readonly name: string }
  | {
      readonly kind: 'identified';
      readonly collection: ProcedureTreeEditorStableCollection;
      readonly id: string;
    };

export type ProcedureTreeEditorMergeOperand =
  { readonly present: false } | { readonly present: true; readonly value: unknown };

const procedureTreeMergeIdentityFields = [
  'formatVersion',
  'id',
  'adapterId',
  'actionCatalogVersion',
  'interactionCatalogVersion',
  'hostVersionRange',
] as const satisfies readonly (keyof ProcedureTree)[];

export interface ProcedureTreeDiffEntry {
  readonly operation: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly stableId: string;
  readonly stablePath: readonly ProcedureTreeEditorStablePathSegment[];
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ProcedureTreeMergeConflict {
  readonly path: string;
  readonly stableId: string;
  readonly stablePath: readonly ProcedureTreeEditorStablePathSegment[];
  readonly mergeBase: ProcedureTreeEditorMergeOperand;
  readonly target: ProcedureTreeEditorMergeOperand;
  readonly source: ProcedureTreeEditorMergeOperand;
  readonly message: string;
}

export interface ProcedureTreeThreeWayMerge {
  readonly tree: ProcedureTree;
  readonly conflicts: readonly ProcedureTreeMergeConflict[];
  readonly changed: boolean;
}

export interface ProcedureTreeMergeResolution {
  readonly conflict: ProcedureTreeMergeConflict;
  readonly value: ProcedureTreeEditorMergeOperand;
  readonly choice?: 'target' | 'source' | 'base' | 'custom';
}

function isJsonRecord(value: MergeValue): value is Record<string, unknown> {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue<T extends MergeValue>(value: T): T {
  return value === MISSING ? value : (structuredClone(value) as T);
}

function recordValue(record: Readonly<Record<string, unknown>>, key: string): MergeValue {
  return Object.hasOwn(record, key) ? record[key] : MISSING;
}

function fieldPath(path: string, field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)
    ? `${path}.${field}`
    : `${path}[${JSON.stringify(field)}]`;
}

function itemPath(path: string, id: string): string {
  return `${path}[id=${JSON.stringify(id)}]`;
}

function stableIdMap(value: readonly unknown[]): Map<string, Record<string, unknown>> | null {
  const result = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (!isJsonRecord(item) || typeof item.id !== 'string' || item.id.length === 0) return null;
    if (result.has(item.id)) return null;
    result.set(item.id, item);
  }
  return result;
}

function usesStableIds(field: string | null, values: readonly (readonly unknown[])[]): boolean {
  return (
    field !== null &&
    stableIdCollectionFields.has(field) &&
    values.every((value) => stableIdMap(value) !== null)
  );
}

function pushDiff(
  entries: ProcedureTreeDiffEntry[],
  path: string,
  stablePath: readonly ProcedureTreeEditorStablePathSegment[],
  stableId: string,
  before: MergeValue,
  after: MergeValue,
): void {
  if (before === MISSING) {
    entries.push({
      operation: 'add',
      path,
      stableId,
      stablePath: structuredClone(stablePath),
      after: cloneValue(after),
    });
    return;
  }
  if (after === MISSING) {
    entries.push({
      operation: 'remove',
      path,
      stableId,
      stablePath: structuredClone(stablePath),
      before: cloneValue(before),
    });
    return;
  }
  entries.push({
    operation: 'replace',
    path,
    stableId,
    stablePath: structuredClone(stablePath),
    before: cloneValue(before),
    after: cloneValue(after),
  });
}

function diffValue(
  path: string,
  stablePath: readonly ProcedureTreeEditorStablePathSegment[],
  stableId: string,
  field: string | null,
  before: MergeValue,
  after: MergeValue,
  entries: ProcedureTreeDiffEntry[],
): void {
  if (isDeepStrictEqual(before, after)) return;
  if (isJsonRecord(before) && isJsonRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      if (path === '$' && key === 'revision') continue;
      assertSafeStablePathField(key);
      const childStablePath = stableIdCollectionFields.has(key)
        ? stablePath
        : [...stablePath, { kind: 'field' as const, name: key }];
      diffValue(
        fieldPath(path, key),
        childStablePath,
        stableId,
        key,
        recordValue(before, key),
        recordValue(after, key),
        entries,
      );
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && usesStableIds(field, [before, after])) {
    const beforeById = stableIdMap(before)!;
    const afterById = stableIdMap(after)!;
    const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
    for (const id of [...ids].sort()) {
      diffValue(
        itemPath(path, id),
        [
          ...stablePath,
          {
            kind: 'identified',
            collection: field as ProcedureTreeEditorStableCollection,
            id,
          },
        ],
        id,
        null,
        beforeById.get(id) ?? MISSING,
        afterById.get(id) ?? MISSING,
        entries,
      );
    }
    return;
  }
  pushDiff(entries, path, stablePath, stableId, before, after);
}

/** Produce a deterministic, stable-ID-aware semantic diff without reporting revision allocation. */
export function diffProcedureTrees(
  before: ProcedureTree,
  after: ProcedureTree,
): readonly ProcedureTreeDiffEntry[] {
  const entries: ProcedureTreeDiffEntry[] = [];
  diffValue('$', [], before.id, null, before, after, entries);
  return entries;
}

function mergeStableIdArray(
  path: string,
  stablePath: readonly ProcedureTreeEditorStablePathSegment[],
  field: string,
  ancestor: readonly unknown[],
  target: readonly unknown[],
  source: readonly unknown[],
  conflicts: ProcedureTreeMergeConflict[],
): readonly unknown[] {
  const ancestorById = stableIdMap(ancestor)!;
  const targetById = stableIdMap(target)!;
  const sourceById = stableIdMap(source)!;
  const orderedIds = [
    ...targetById.keys(),
    ...[...sourceById.keys()].filter((id) => !targetById.has(id)),
    ...[...ancestorById.keys()].filter((id) => !targetById.has(id) && !sourceById.has(id)),
  ];
  const merged: unknown[] = [];
  for (const id of orderedIds) {
    const value = mergeValue(
      itemPath(path, id),
      [
        ...stablePath,
        {
          kind: 'identified',
          collection: field as ProcedureTreeEditorStableCollection,
          id,
        },
      ],
      id,
      null,
      ancestorById.get(id) ?? MISSING,
      targetById.get(id) ?? MISSING,
      sourceById.get(id) ?? MISSING,
      conflicts,
    );
    if (value !== MISSING) merged.push(value);
  }
  return merged;
}

function conflict(
  conflicts: ProcedureTreeMergeConflict[],
  path: string,
  stablePath: readonly ProcedureTreeEditorStablePathSegment[],
  stableId: string,
  ancestor: MergeValue,
  target: MergeValue,
  source: MergeValue,
): MergeValue {
  const deletion = target === MISSING || source === MISSING;
  conflicts.push({
    path,
    stableId,
    stablePath: structuredClone(stablePath),
    mergeBase: mergeOperand(ancestor),
    target: mergeOperand(target),
    source: mergeOperand(source),
    message: deletion
      ? `Delete and edit conflict at ${path}`
      : `Target and source changed ${path} differently from their common ancestor`,
  });
  return cloneValue(target === MISSING && source !== MISSING ? source : target);
}

function mergeOperand(value: MergeValue): ProcedureTreeEditorMergeOperand {
  return value === MISSING ? { present: false } : { present: true, value: cloneValue(value) };
}

function mergeValue(
  path: string,
  stablePath: readonly ProcedureTreeEditorStablePathSegment[],
  stableId: string,
  field: string | null,
  ancestor: MergeValue,
  target: MergeValue,
  source: MergeValue,
  conflicts: ProcedureTreeMergeConflict[],
): MergeValue {
  if (isDeepStrictEqual(target, source)) return cloneValue(target);
  if (isDeepStrictEqual(target, ancestor)) return cloneValue(source);
  if (isDeepStrictEqual(source, ancestor)) return cloneValue(target);

  if (isJsonRecord(ancestor) && isJsonRecord(target) && isJsonRecord(source)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(ancestor),
      ...Object.keys(target),
      ...Object.keys(source),
    ]);
    for (const key of [...keys].sort()) {
      assertSafeStablePathField(key);
      const value = mergeValue(
        fieldPath(path, key),
        stableIdCollectionFields.has(key)
          ? stablePath
          : [...stablePath, { kind: 'field' as const, name: key }],
        stableId,
        key,
        recordValue(ancestor, key),
        recordValue(target, key),
        recordValue(source, key),
        conflicts,
      );
      if (value !== MISSING) merged[key] = value;
    }
    return merged;
  }

  if (
    Array.isArray(ancestor) &&
    Array.isArray(target) &&
    Array.isArray(source) &&
    usesStableIds(field, [ancestor, target, source])
  ) {
    return mergeStableIdArray(path, stablePath, field!, ancestor, target, source, conflicts);
  }

  return conflict(conflicts, path, stablePath, stableId, ancestor, target, source);
}

function treeWithRevision(tree: ProcedureTree, revision: number): ProcedureTree {
  return { ...structuredClone(tree), revision };
}

/** Merge two ProcedureTree branch heads by stable IDs and retain explicit conflicts. */
export function computeProcedureTreeThreeWayMerge(
  commonAncestor: ProcedureTree,
  target: ProcedureTree,
  source: ProcedureTree,
  targetRevision: number,
): ProcedureTreeThreeWayMerge {
  const conflicts: ProcedureTreeMergeConflict[] = [];
  for (const field of procedureTreeMergeIdentityFields) {
    const ancestorValue = commonAncestor[field];
    const targetValue = target[field];
    const sourceValue = source[field];
    if (
      !isDeepStrictEqual(ancestorValue, targetValue) ||
      !isDeepStrictEqual(targetValue, sourceValue)
    ) {
      conflicts.push({
        path: field,
        stableId: target.id,
        stablePath: [{ kind: 'field', name: field }],
        mergeBase: { present: true, value: cloneValue(ancestorValue) },
        target: { present: true, value: cloneValue(targetValue) },
        source: { present: true, value: cloneValue(sourceValue) },
        message: `ProcedureTree branch merge cannot change identity field ${field}`,
      });
    }
  }

  const normalizedAncestor = treeWithRevision(commonAncestor, targetRevision);
  const normalizedTarget = treeWithRevision(target, targetRevision);
  const normalizedSource = treeWithRevision(source, targetRevision);
  const merged = mergeValue(
    '$',
    [],
    target.id,
    null,
    normalizedAncestor,
    normalizedTarget,
    normalizedSource,
    conflicts,
  );
  if (!isJsonRecord(merged)) {
    throw new Error('ProcedureTree merge did not produce an object');
  }
  const tree = { ...merged, revision: targetRevision } as ProcedureTree;
  return {
    tree,
    conflicts,
    changed: diffProcedureTrees(target, tree).length > 0,
  };
}

function resolvedOperand(operand: ProcedureTreeEditorMergeOperand): MergeValue {
  return operand.present ? structuredClone(operand.value) : MISSING;
}

function applyResolutionAtPath(
  current: MergeValue,
  path: readonly ProcedureTreeEditorStablePathSegment[],
  value: MergeValue,
): MergeValue {
  if (path.length === 0) return cloneValue(value);
  if (!isJsonRecord(current)) {
    throw new Error('ProcedureTree merge resolution path does not address an object');
  }
  const [segment, ...remaining] = path;
  if (segment!.kind === 'field') {
    assertSafeStablePathField(segment!.name);
    const resolved = applyResolutionAtPath(recordValue(current, segment!.name), remaining, value);
    const result = structuredClone(current);
    if (resolved === MISSING) delete result[segment!.name];
    else result[segment!.name] = resolved;
    return result;
  }
  const collection = current[segment!.collection];
  if (!Array.isArray(collection)) {
    throw new Error('ProcedureTree merge resolution path does not address a collection');
  }
  const index = collection.findIndex((item) => isJsonRecord(item) && item.id === segment!.id);
  const item = index < 0 ? MISSING : collection[index]!;
  const resolved = applyResolutionAtPath(item, remaining, value);
  const result = structuredClone(current);
  const resolvedCollection = structuredClone(collection);
  if (resolved === MISSING) {
    if (index >= 0) resolvedCollection.splice(index, 1);
  } else if (index >= 0) {
    resolvedCollection[index] = resolved;
  } else {
    resolvedCollection.push(resolved);
  }
  result[segment!.collection] = resolvedCollection;
  return result;
}

/** Apply a complete, server-validated set of conflict resolutions to a three-way merge. */
export function resolveProcedureTreeMergeConflicts(
  merge: ProcedureTreeThreeWayMerge,
  resolutions: readonly ProcedureTreeMergeResolution[],
): ProcedureTree {
  let resolved: MergeValue = structuredClone(merge.tree);
  for (const resolution of resolutions) {
    const [identitySegment] = resolution.conflict.stablePath;
    if (
      resolution.conflict.stablePath.length === 1 &&
      identitySegment?.kind === 'field' &&
      procedureTreeMergeIdentityFields.includes(
        identitySegment.name as (typeof procedureTreeMergeIdentityFields)[number],
      )
    ) {
      const value = resolution.value;
      if (resolution.choice !== undefined && !['target', 'base'].includes(resolution.choice)) {
        throw new Error(
          `ProcedureTree merge resolution cannot select ${resolution.choice} for identity field ${identitySegment.name}`,
        );
      }
      const allowed =
        value.present &&
        [resolution.conflict.target, resolution.conflict.mergeBase].some(
          (operand) => operand.present && isDeepStrictEqual(operand.value, value.value),
        );
      if (!allowed) {
        throw new Error(
          `ProcedureTree merge resolution cannot change identity field ${identitySegment.name}`,
        );
      }
    }
    resolved = applyResolutionAtPath(
      resolved,
      resolution.conflict.stablePath,
      resolvedOperand(resolution.value),
    );
  }
  if (!isJsonRecord(resolved)) {
    throw new Error('ProcedureTree merge conflict resolution did not produce an object');
  }
  return { ...resolved, revision: merge.tree.revision } as ProcedureTree;
}
