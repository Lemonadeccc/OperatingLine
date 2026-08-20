import { isDeepStrictEqual } from 'node:util';

import type { ProcedureLeafNode, ProcedureTree } from '@operatingline/protocol';

const rootIdentityFields = [
  'formatVersion',
  'id',
  'adapterId',
  'actionCatalogVersion',
  'interactionCatalogVersion',
  'hostVersionRange',
  'rootNodeId',
] as const satisfies readonly (keyof ProcedureTree)[];

const protectedLeafFields = [
  'anchors',
  'expectedObservations',
  'observationPolicy',
  'rollback',
  'parameterProjection',
] as const satisfies readonly (keyof ProcedureLeafNode)[];

type JsonRecord = Record<string, unknown>;

const generatedStableIdSuffix =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const generatedSemanticOperationId = new RegExp(`^semantic\\.${generatedStableIdSuffix}$`, 'u');
const generatedTrackIds = {
  menu: new RegExp(`^menu\\.track\\.${generatedStableIdSuffix}$`, 'u'),
  shortcut: new RegExp(`^shortcut\\.track\\.${generatedStableIdSuffix}$`, 'u'),
  mcp: new RegExp(`^mcp\\.track\\.${generatedStableIdSuffix}$`, 'u'),
} as const;

function fail(path: string): never {
  throw new Error(`ProcedureTree editor cannot mutate protected field ${path}`);
}

function assertEqual(left: unknown, right: unknown, path: string): void {
  if (!isDeepStrictEqual(left, right)) fail(path);
}

function record(value: unknown): JsonRecord {
  return value as JsonRecord;
}

function byId(values: readonly unknown[]): ReadonlyMap<string, JsonRecord> {
  return new Map(
    values
      .map(record)
      .filter((value) => typeof value['id'] === 'string')
      .map((value) => [value['id'] as string, value]),
  );
}

function assertIdsSubset(
  base: readonly unknown[],
  candidate: readonly unknown[],
  path: string,
): void {
  const baseIds = new Set(
    base
      .map(record)
      .map((value) => value['id'])
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const candidateValue of candidate.map(record)) {
    const candidateId = candidateValue['id'];
    if (typeof candidateId === 'string' && !baseIds.has(candidateId)) {
      fail(`${path}[id=${JSON.stringify(candidateId)}]`);
    }
  }
}

function assertFields(
  base: JsonRecord,
  candidate: JsonRecord,
  fields: readonly string[],
  path: string,
): void {
  for (const field of fields) assertEqual(base[field], candidate[field], `${path}.${field}`);
}

function assertExistingOperations(
  base: readonly unknown[],
  candidate: readonly unknown[],
  fields: readonly string[],
  path: string,
): void {
  const candidates = byId(candidate);
  for (const baseOperation of base.map(record)) {
    const candidateOperation = candidates.get(baseOperation['id'] as string);
    if (candidateOperation === undefined) continue;
    assertFields(
      baseOperation,
      candidateOperation,
      fields,
      `${path}[id=${JSON.stringify(baseOperation['id'])}]`,
    );
  }
}

function assertExistingTracks(
  base: ProcedureLeafNode,
  candidate: ProcedureLeafNode,
  collection: 'menuTracks' | 'shortcutTracks' | 'mcpTracks',
): void {
  assertIdsSubset(
    base[collection],
    candidate[collection],
    `nodes[id=${JSON.stringify(base.id)}].${collection}`,
  );
  const candidates = byId(candidate[collection]);
  for (const baseTrackValue of base[collection]) {
    const baseTrack = record(baseTrackValue);
    const trackPath = `nodes[id=${JSON.stringify(base.id)}].${collection}[id=${JSON.stringify(baseTrack['id'])}]`;
    const candidateTrack = candidates.get(baseTrack['id'] as string);
    if (candidateTrack === undefined) continue;
    assertFields(
      baseTrack,
      candidateTrack,
      ['availability', 'modality', 'preconditions', 'reason'],
      trackPath,
    );
    const baseOperations = Array.isArray(baseTrack['operations']) ? baseTrack['operations'] : [];
    const candidateOperations = Array.isArray(candidateTrack['operations'])
      ? candidateTrack['operations']
      : [];
    assertIdsSubset(baseOperations, candidateOperations, `${trackPath}.operations`);
    const operationFields =
      collection === 'menuTracks'
        ? ['intent', 'target', 'path', 'semanticRefs', 'evidenceRefs', 'parameters']
        : collection === 'shortcutTracks'
          ? [
              'kind',
              'keys',
              'keyMode',
              'selectionPath',
              'opensSurface',
              'closesSurfaceOperationId',
              'surfaceOperationId',
              'target',
              'path',
              'semanticRefs',
              'evidenceRefs',
              'parameters',
            ]
          : [
              'serverName',
              'toolName',
              'resultBinding',
              'semanticRefs',
              'evidenceRefs',
              'arguments',
            ];
    assertExistingOperations(
      baseOperations,
      candidateOperations,
      operationFields,
      `${trackPath}.operations`,
    );
  }
}

function contentWithoutValidation(leaf: ProcedureLeafNode): unknown {
  const content: Partial<ProcedureLeafNode> = structuredClone(leaf);
  delete content.validation;
  return content;
}

function assertValidationAndNormalize(
  base: ProcedureLeafNode | null,
  candidate: ProcedureLeafNode,
  contextChanged = false,
): void {
  const candidateValidation = candidate.validation;
  if (base === null) {
    if (
      candidateValidation.status !== 'candidate' ||
      candidateValidation.validatedHostVersions.length !== 0
    ) {
      fail(`nodes[id=${JSON.stringify(candidate.id)}].validation`);
    }
    return;
  }
  const changed =
    contextChanged ||
    !isDeepStrictEqual(contentWithoutValidation(base), contentWithoutValidation(candidate));
  if (isDeepStrictEqual(base.validation, candidateValidation)) {
    if (changed && base.validation.status === 'verified') {
      candidate.validation = {
        ...structuredClone(base.validation),
        status: 'candidate',
        validatedHostVersions: [],
      };
    }
    return;
  }
  const explicitSafeDowngrade =
    changed &&
    base.validation.status === 'verified' &&
    candidateValidation.status === 'candidate' &&
    candidateValidation.validatedHostVersions.length === 0 &&
    isDeepStrictEqual(candidateValidation.notes, base.validation.notes);
  if (!explicitSafeDowngrade) fail(`nodes[id=${JSON.stringify(candidate.id)}].validation`);
}

function assertSafeNewLeaf(candidate: ProcedureLeafNode): void {
  const path = `nodes[id=${JSON.stringify(candidate.id)}]`;
  if (candidate.action !== null) fail(`${path}.action`);
  if (candidate.parameterProjection !== undefined) fail(`${path}.parameterProjection`);
  if (candidate.semanticOperations.length !== 1) fail(`${path}.semanticOperations`);
  const semantic = candidate.semanticOperations[0]!;
  if (!generatedSemanticOperationId.test(semantic.id)) fail(`${path}.semanticOperations[0].id`);
  if (semantic.semanticAction.startsWith('draft.semantic.')) {
    fail(`${path}.semanticOperations[0].semanticAction`);
  }
  if (semantic.order !== 1) fail(`${path}.semanticOperations[0].order`);
  if (Object.keys(semantic.parameters).length !== 0) {
    fail(`${path}.semanticOperations[0].parameters`);
  }
  if (semantic.evidenceRefs.length !== 0) fail(`${path}.semanticOperations[0].evidenceRefs`);

  for (const collection of ['menuTracks', 'shortcutTracks', 'mcpTracks'] as const) {
    const modality =
      collection === 'menuTracks' ? 'menu' : collection === 'shortcutTracks' ? 'shortcut' : 'mcp';
    for (const track of candidate[collection]) {
      if (track.availability !== 'unavailable') {
        fail(`${path}.${collection}[id=${JSON.stringify(track.id)}].availability`);
      }
      if (!generatedTrackIds[modality].test(track.id)) {
        fail(`${path}.${collection}[id=${JSON.stringify(track.id)}].id`);
      }
    }
  }
  if (candidate.anchors.length !== 0) fail(`${path}.anchors`);
  if (candidate.expectedObservations.length !== 0) fail(`${path}.expectedObservations`);
  if (candidate.observationPolicy !== undefined) fail(`${path}.observationPolicy`);
  assertEqual(
    candidate.rollback,
    { mode: 'checkpoint_restore', checkpointRequired: true },
    `${path}.rollback`,
  );
}

/** Enforce editor mutation authority and normalize verified leaves invalidated by edits. */
export function applyProcedureTreeEditorMutationPolicy(
  base: ProcedureTree,
  input: ProcedureTree,
): ProcedureTree {
  const candidate = structuredClone(input);
  for (const field of rootIdentityFields) assertEqual(base[field], candidate[field], field);
  assertEqual(base.sources, candidate.sources, 'sources');
  assertEqual(base.evidence, candidate.evidence, 'evidence');

  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const candidateNodes = new Map(candidate.nodes.map((node) => [node.id, node]));
  const changedGroups = new Set(
    base.nodes
      .filter((node) => node.kind === 'group')
      .filter((node) => !isDeepStrictEqual(node, candidateNodes.get(node.id)))
      .map((node) => node.id),
  );
  const hasChangedAncestor = (node: ProcedureLeafNode): boolean => {
    let parentId = node.parentId;
    const visited = new Set<string>();
    while (parentId !== null && !visited.has(parentId)) {
      if (changedGroups.has(parentId)) return true;
      visited.add(parentId);
      parentId = baseNodes.get(parentId)?.parentId ?? null;
    }
    return false;
  };
  for (const candidateNode of candidate.nodes) {
    const baseNode = baseNodes.get(candidateNode.id);
    if (baseNode === undefined) {
      if (candidateNode.kind === 'leaf') {
        assertSafeNewLeaf(candidateNode);
        assertValidationAndNormalize(null, candidateNode);
      }
      continue;
    }
    assertEqual(baseNode.kind, candidateNode.kind, `nodes[id=${JSON.stringify(baseNode.id)}].kind`);
    if (baseNode.kind !== 'leaf' || candidateNode.kind !== 'leaf') continue;
    const leafPath = `nodes[id=${JSON.stringify(baseNode.id)}]`;
    for (const field of protectedLeafFields) {
      assertEqual(baseNode[field], candidateNode[field], `${leafPath}.${field}`);
    }
    if ((baseNode.action === null) !== (candidateNode.action === null)) fail(`${leafPath}.action`);
    if (baseNode.action !== null && candidateNode.action !== null) {
      assertEqual(
        baseNode.action.adapterId,
        candidateNode.action.adapterId,
        `${leafPath}.action.adapterId`,
      );
      assertEqual(baseNode.action.name, candidateNode.action.name, `${leafPath}.action.name`);
      const baseArgumentNames = Object.keys(baseNode.action.arguments).sort();
      const candidateArgumentNames = Object.keys(candidateNode.action.arguments).sort();
      assertEqual(baseArgumentNames, candidateArgumentNames, `${leafPath}.action.arguments`);
      const projectedArguments = new Set(
        (baseNode.parameterProjection?.arguments ?? [])
          .filter((coverage) => coverage.disposition === 'projected')
          .map((coverage) => coverage.actionArgument),
      );
      for (const argumentName of baseArgumentNames) {
        if (
          !projectedArguments.has(argumentName) &&
          !isDeepStrictEqual(
            baseNode.action.arguments[argumentName],
            candidateNode.action.arguments[argumentName],
          )
        ) {
          fail(`${leafPath}.action.arguments.${argumentName}`);
        }
      }
    }
    assertIdsSubset(
      baseNode.semanticOperations,
      candidateNode.semanticOperations,
      `${leafPath}.semanticOperations`,
    );
    assertExistingOperations(
      baseNode.semanticOperations,
      candidateNode.semanticOperations,
      ['semanticAction', 'evidenceRefs', 'parameters'],
      `${leafPath}.semanticOperations`,
    );
    assertExistingTracks(baseNode, candidateNode, 'menuTracks');
    assertExistingTracks(baseNode, candidateNode, 'shortcutTracks');
    assertExistingTracks(baseNode, candidateNode, 'mcpTracks');
    assertValidationAndNormalize(baseNode, candidateNode, hasChangedAncestor(baseNode));
  }
  return candidate;
}
