import { z } from 'zod';

import { rollbackModeSchema } from './adapter.js';
import { protocolJsonValueCanonicalization } from './canonical-json-value.js';
import {
  guidePlanSchema,
  guideProtocolVersion,
  guideStepIdSchema,
  observationExpectationSchema,
  observationPolicySchema,
  semanticAnchorSchema,
  type GuidePlan,
} from './guide.js';
import { catalogVersionSchema, stableVersionRangeSchema } from './version.js';

export const procedureTreeFormatVersion = '1.0.0' as const;
export const procedureTreeFormatVersionSchema = z.literal(procedureTreeFormatVersion);

export const procedureSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: z.string().min(1),
    title: z.string().min(1),
    durationMs: z.number().int().positive().optional(),
    rightsStatus: z.enum(['unknown', 'permission_granted', 'license_verified', 'public_domain']),
    license: z.string().min(1).optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('natural_language'),
    text: z.string().min(1).max(10_000).regex(/\S/),
    locale: z.string().min(1).max(64).regex(/^\S+$/).optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('manual'),
    description: z.string().min(1),
  }),
]);
export type ProcedureSource = z.infer<typeof procedureSourceSchema>;

export const procedureEvidenceLocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('whole_source') }),
  z.strictObject({
    kind: z.literal('video_segment'),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('text_span'),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
  }),
]);
export type ProcedureEvidenceLocator = z.infer<typeof procedureEvidenceLocatorSchema>;

export const procedureEvidenceSchema = z.strictObject({
  id: guideStepIdSchema,
  sourceId: guideStepIdSchema,
  locator: procedureEvidenceLocatorSchema,
  description: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ProcedureEvidence = z.infer<typeof procedureEvidenceSchema>;

export const procedurePreconditionSchema = z.strictObject({
  kind: z.enum([
    'workspace',
    'editor',
    'mode',
    'selection',
    'keymap',
    'modal_state',
    'scene_state',
  ]),
  label: z.string().min(1),
  value: z.string().min(1),
});
export type ProcedurePrecondition = z.infer<typeof procedurePreconditionSchema>;

const procedureOperationBaseShape = {
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  semanticRefs: z.array(guideStepIdSchema).min(1),
  description: z.string().min(1),
  evidenceRefs: z.array(guideStepIdSchema),
} as const;

export const semanticProcedureOperationSchema = z.strictObject({
  id: guideStepIdSchema,
  order: z.number().int().positive(),
  semanticAction: guideStepIdSchema,
  description: z.string().min(1),
  parameters: z.record(z.string().min(1), z.json()),
  evidenceRefs: z.array(guideStepIdSchema),
});
export type SemanticProcedureOperation = z.infer<typeof semanticProcedureOperationSchema>;

export const menuProcedureOperationSchema = z.strictObject({
  ...procedureOperationBaseShape,
  intent: z.enum(['navigate', 'configure', 'execute', 'verify']),
  target: z.strictObject({
    kind: z.enum(['workspace', 'editor', 'mode', 'menu', 'menu_item', 'operator', 'control']),
    hostId: z.string().min(1),
  }),
  path: z.array(z.string().min(1)).min(1),
  parameters: z.record(z.string().min(1), z.json()),
});
export type MenuProcedureOperation = z.infer<typeof menuProcedureOperationSchema>;

export const shortcutProcedureOperationSchema = z.strictObject({
  ...procedureOperationBaseShape,
  keys: z.array(z.string().min(1)).min(1),
  selectionPath: z.array(z.string().min(1)).optional(),
  parameters: z.record(z.string().min(1), z.json()),
});
export type ShortcutProcedureOperation = z.infer<typeof shortcutProcedureOperationSchema>;

export const mcpProcedureCallSchema = z.strictObject({
  ...procedureOperationBaseShape,
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string().min(1), z.json()),
  resultBinding: guideStepIdSchema.optional(),
});
export type McpProcedureCall = z.infer<typeof mcpProcedureCallSchema>;

const unavailableTrackShape = {
  id: guideStepIdSchema,
  availability: z.literal('unavailable'),
  title: z.string().min(1),
  reason: z.string().min(1),
} as const;

const availableTrackShape = {
  id: guideStepIdSchema,
  availability: z.literal('available'),
  title: z.string().min(1),
  preconditions: z.array(procedurePreconditionSchema),
} as const;

export const menuProcedureTrackSchema = z.discriminatedUnion('availability', [
  z.strictObject({
    ...availableTrackShape,
    modality: z.literal('menu'),
    operations: z.array(menuProcedureOperationSchema).min(1),
  }),
  z.strictObject({ ...unavailableTrackShape, modality: z.literal('menu') }),
]);
export type MenuProcedureTrack = z.infer<typeof menuProcedureTrackSchema>;

export const shortcutProcedureTrackSchema = z.discriminatedUnion('availability', [
  z.strictObject({
    ...availableTrackShape,
    modality: z.literal('shortcut'),
    operations: z.array(shortcutProcedureOperationSchema).min(1),
  }),
  z.strictObject({ ...unavailableTrackShape, modality: z.literal('shortcut') }),
]);
export type ShortcutProcedureTrack = z.infer<typeof shortcutProcedureTrackSchema>;

export const mcpProcedureTrackSchema = z.discriminatedUnion('availability', [
  z.strictObject({
    ...availableTrackShape,
    modality: z.literal('mcp'),
    operations: z.array(mcpProcedureCallSchema).min(1),
  }),
  z.strictObject({ ...unavailableTrackShape, modality: z.literal('mcp') }),
]);
export type McpProcedureTrack = z.infer<typeof mcpProcedureTrackSchema>;

export const procedureValidationSchema = z.strictObject({
  status: z.enum(['candidate', 'verified', 'rejected']),
  validatedHostVersions: z.array(catalogVersionSchema),
  notes: z.array(z.string().min(1)),
});
export type ProcedureValidation = z.infer<typeof procedureValidationSchema>;

const procedureNodeBaseShape = {
  id: guideStepIdSchema,
  parentId: guideStepIdSchema.nullable(),
  order: z.number().int().positive(),
  dependsOn: z.array(guideStepIdSchema),
  title: z.string().min(1),
  intent: z.string().min(1),
} as const;

export const procedureGroupNodeSchema = z.strictObject({
  ...procedureNodeBaseShape,
  kind: z.literal('group'),
});
export type ProcedureGroupNode = z.infer<typeof procedureGroupNodeSchema>;

export const procedureLeafNodeSchema = z.strictObject({
  ...procedureNodeBaseShape,
  kind: z.literal('leaf'),
  action: z
    .strictObject({
      adapterId: z.string().min(1),
      name: z.string().min(1),
      arguments: z.record(z.string().min(1), z.json()),
    })
    .nullable(),
  semanticOperations: z.array(semanticProcedureOperationSchema).min(1),
  menuTracks: z.array(menuProcedureTrackSchema).min(1),
  shortcutTracks: z.array(shortcutProcedureTrackSchema).min(1),
  mcpTracks: z.array(mcpProcedureTrackSchema).min(1),
  anchors: z.array(semanticAnchorSchema),
  expectedObservations: z.array(observationExpectationSchema),
  observationPolicy: observationPolicySchema.optional(),
  rollback: z.strictObject({
    mode: rollbackModeSchema,
    checkpointRequired: z.boolean(),
  }),
  validation: procedureValidationSchema,
});
export type ProcedureLeafNode = z.infer<typeof procedureLeafNodeSchema>;

export const procedureNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
]);
export type ProcedureNode = z.infer<typeof procedureNodeSchema>;

export const procedureTreeSchema = z.strictObject({
  formatVersion: procedureTreeFormatVersionSchema,
  id: guideStepIdSchema,
  revision: z.number().int().positive(),
  title: z.string().min(1),
  adapterId: z.string().min(1),
  actionCatalogVersion: catalogVersionSchema,
  interactionCatalogVersion: catalogVersionSchema,
  hostVersionRange: stableVersionRangeSchema,
  rootNodeId: guideStepIdSchema,
  sources: z.array(procedureSourceSchema).min(1),
  evidence: z.array(procedureEvidenceSchema),
  nodes: z.array(procedureNodeSchema).min(1),
});
export type ProcedureTree = z.infer<typeof procedureTreeSchema>;

export const procedureCompilationRequestSchema = z.strictObject({
  tree: procedureTreeSchema,
});
export type ProcedureCompilationRequest = z.infer<typeof procedureCompilationRequestSchema>;

export const procedureTreeRuntimeValidationSchema = z.strictObject({
  procedureStructure: z.literal('validated'),
  actionCatalogBinding: z.literal('validated'),
  hostVersionRange: z.literal('validated_against_action_catalog'),
  interactionTracks: z.literal('structural_only'),
});
export type ProcedureTreeRuntimeValidation = z.infer<typeof procedureTreeRuntimeValidationSchema>;

export const procedureCompilationResultSchema = z.strictObject({
  formatVersion: procedureTreeFormatVersionSchema,
  procedureTreeId: guideStepIdSchema,
  procedureTreeRevision: z.number().int().positive(),
  adapterId: z.string().min(1),
  actionCatalogVersion: catalogVersionSchema,
  interactionCatalogVersion: catalogVersionSchema,
  validation: procedureTreeRuntimeValidationSchema,
  plan: guidePlanSchema,
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureCompilationResult = z.infer<typeof procedureCompilationResultSchema>;

export const procedureTreeIntegritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProcedureTreeIntegrity = z.infer<typeof procedureTreeIntegritySchema>;

export const storedProcedureTreeSchema = z.strictObject({
  sequence: z.number().int().positive(),
  tree: procedureTreeSchema,
  integrity: procedureTreeIntegritySchema,
  storedAt: z.iso.datetime({ offset: true }),
});
export type StoredProcedureTree = z.infer<typeof storedProcedureTreeSchema>;

export const procedureTreeSummarySchema = z.strictObject({
  sequence: z.number().int().positive(),
  treeId: guideStepIdSchema,
  revision: z.number().int().positive(),
  title: z.string().min(1),
  adapterId: z.string().min(1),
  actionCatalogVersion: catalogVersionSchema,
  interactionCatalogVersion: catalogVersionSchema,
  hostVersionRange: stableVersionRangeSchema,
  integrity: procedureTreeIntegritySchema,
  storedAt: z.iso.datetime({ offset: true }),
});
export type ProcedureTreeSummary = z.infer<typeof procedureTreeSummarySchema>;

export const procedureTreeStoreRequestSchema = z.strictObject({
  tree: procedureTreeSchema,
});
export type ProcedureTreeStoreRequest = z.infer<typeof procedureTreeStoreRequestSchema>;

export const procedureTreeStoreResultSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
  record: storedProcedureTreeSchema,
  validation: procedureTreeRuntimeValidationSchema,
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureTreeStoreResult = z.infer<typeof procedureTreeStoreResultSchema>;

export const procedureTreeGetRequestSchema = z.strictObject({
  treeId: guideStepIdSchema,
  revision: z.number().int().positive().optional(),
});
export type ProcedureTreeGetRequest = z.infer<typeof procedureTreeGetRequestSchema>;

export const procedureTreeListRequestSchema = z.strictObject({
  adapterId: z.string().min(1).optional(),
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ProcedureTreeListRequest = z.infer<typeof procedureTreeListRequestSchema>;

export const procedureTreeListResultSchema = z.strictObject({
  procedures: z.array(procedureTreeSummarySchema),
  nextAfterSequence: z.number().int().positive().nullable(),
});
export type ProcedureTreeListResult = z.infer<typeof procedureTreeListResultSchema>;

export const procedureOperationSearchModalitySchema = z.enum([
  'semantic',
  'menu',
  'shortcut',
  'mcp',
]);
export type ProcedureOperationSearchModality = z.infer<
  typeof procedureOperationSearchModalitySchema
>;

const procedureOperationSearchSelectorFields = [
  'treeId',
  'adapterId',
  'leafId',
  'operationId',
  'modality',
  'validationStatus',
  'actionName',
  'semanticAction',
  'menuTargetHostId',
  'menuPath',
  'shortcutKeys',
  'mcpServerName',
  'mcpToolName',
] as const;

export const procedureOperationSearchRequestSchema = z
  .strictObject({
    treeId: guideStepIdSchema.optional(),
    revision: z.number().int().positive().optional(),
    adapterId: z.string().min(1).optional(),
    leafId: guideStepIdSchema.optional(),
    operationId: guideStepIdSchema.optional(),
    modality: procedureOperationSearchModalitySchema.optional(),
    validationStatus: procedureValidationSchema.shape.status.optional(),
    actionName: z.string().min(1).optional(),
    semanticAction: guideStepIdSchema.optional(),
    menuTargetHostId: z.string().min(1).optional(),
    menuPath: z.array(z.string().min(1)).min(1).optional(),
    shortcutKeys: z.array(z.string().min(1)).min(1).optional(),
    mcpServerName: z.string().min(1).optional(),
    mcpToolName: z.string().min(1).optional(),
    afterSequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((request, context) => {
    if (request.revision !== undefined && request.treeId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Procedure operation revision filtering requires treeId',
      });
    }
    if (procedureOperationSearchSelectorFields.every((field) => request[field] === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Procedure operation search requires at least one exact selector',
      });
    }
  })
  .meta({
    anyOf: procedureOperationSearchSelectorFields.map((field) => ({ required: [field] })),
    allOf: [{ if: { required: ['revision'] }, then: { required: ['treeId'] } }],
  });
export type ProcedureOperationSearchRequest = z.infer<typeof procedureOperationSearchRequestSchema>;

const procedureOperationSearchNodePathItemSchema = z.strictObject({
  id: guideStepIdSchema,
  kind: z.enum(['group', 'leaf']),
  order: z.number().int().positive(),
  title: z.string().min(1),
});

const procedureOperationSearchTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  title: z.string().min(1),
  preconditions: z.array(procedurePreconditionSchema),
});

const procedureOperationSearchHitBaseShape = {
  indexSequence: z.number().int().positive(),
  tree: procedureTreeSummarySchema,
  nodePath: z.array(procedureOperationSearchNodePathItemSchema).min(1),
  leafId: guideStepIdSchema,
  leafTitle: z.string().min(1),
  leafIntent: z.string().min(1),
  leafAction: procedureLeafNodeSchema.shape.action,
  leafValidation: procedureValidationSchema,
  semanticActions: z.array(guideStepIdSchema).min(1),
  sources: z.array(procedureSourceSchema),
  evidence: z.array(procedureEvidenceSchema),
} as const;

export const procedureOperationSearchHitSchema = z.discriminatedUnion('modality', [
  z.strictObject({
    ...procedureOperationSearchHitBaseShape,
    modality: z.literal('semantic'),
    track: z.null(),
    operation: semanticProcedureOperationSchema,
  }),
  z.strictObject({
    ...procedureOperationSearchHitBaseShape,
    modality: z.literal('menu'),
    track: procedureOperationSearchTrackSchema,
    operation: menuProcedureOperationSchema,
  }),
  z.strictObject({
    ...procedureOperationSearchHitBaseShape,
    modality: z.literal('shortcut'),
    track: procedureOperationSearchTrackSchema,
    operation: shortcutProcedureOperationSchema,
  }),
  z.strictObject({
    ...procedureOperationSearchHitBaseShape,
    modality: z.literal('mcp'),
    track: procedureOperationSearchTrackSchema,
    operation: mcpProcedureCallSchema,
  }),
]);
export type ProcedureOperationSearchHit = z.infer<typeof procedureOperationSearchHitSchema>;

export const procedureOperationSearchResultSchema = z.strictObject({
  operations: z.array(procedureOperationSearchHitSchema),
  nextAfterSequence: z.number().int().positive().nullable(),
  matching: z.literal('exact_structured_filters'),
  similarityScoreProduced: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureOperationSearchResult = z.infer<typeof procedureOperationSearchResultSchema>;

export const procedureTrackModalities = ['menu', 'shortcut', 'mcp'] as const;
export type ProcedureTrackModality = (typeof procedureTrackModalities)[number];
export type ProcedureTrackOperation =
  MenuProcedureOperation | ShortcutProcedureOperation | McpProcedureCall;
export interface MaterializedProcedureOperation {
  readonly globalOrder: number;
  readonly leafId: string;
  readonly trackId: string;
  readonly modality: ProcedureTrackModality;
  readonly operation: ProcedureTrackOperation;
}

type OrderedItem = Readonly<{ id: string; order: number }>;

function validateOrderedItems(scope: string, items: readonly OrderedItem[]): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`${scope} contains duplicate item ${item.id}`);
    }
    if (orders.has(item.order)) {
      throw new Error(`${scope} contains duplicate order ${item.order}`);
    }
    ids.add(item.id);
    orders.add(item.order);
  }
  const actualOrders = [...orders].sort((left, right) => left - right);
  if (actualOrders.some((order, index) => order !== index + 1)) {
    throw new Error(`${scope} orders must be contiguous from 1`);
  }
}

function validateEvidenceReferences(
  scope: string,
  references: readonly string[],
  evidenceIds: ReadonlySet<string>,
): void {
  if (new Set(references).size !== references.length) {
    throw new Error(`${scope} contains duplicate evidence references`);
  }
  for (const evidenceId of references) {
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(`${scope} references unknown evidence ${evidenceId}`);
    }
  }
}

function validateAvailableTrack(
  leaf: ProcedureLeafNode,
  track: {
    readonly id: string;
    readonly operations: readonly (OrderedItem & {
      semanticRefs: readonly string[];
      evidenceRefs: readonly string[];
    })[];
  },
  semanticIds: ReadonlySet<string>,
  evidenceIds: ReadonlySet<string>,
): void {
  const scope = `Procedure leaf ${leaf.id} track ${track.id}`;
  validateOrderedItems(scope, track.operations);
  const coveredSemanticIds = new Set<string>();
  for (const operation of track.operations) {
    if (new Set(operation.semanticRefs).size !== operation.semanticRefs.length) {
      throw new Error(`${scope} operation ${operation.id} contains duplicate semantic references`);
    }
    for (const semanticId of operation.semanticRefs) {
      if (!semanticIds.has(semanticId)) {
        throw new Error(`${scope} references unknown semantic operation ${semanticId}`);
      }
      coveredSemanticIds.add(semanticId);
    }
    validateEvidenceReferences(
      `${scope} operation ${operation.id}`,
      operation.evidenceRefs,
      evidenceIds,
    );
  }
  const missing = [...semanticIds].filter((semanticId) => !coveredSemanticIds.has(semanticId));
  if (missing.length > 0) {
    throw new Error(`${scope} does not cover semantic operations: ${missing.sort().join(', ')}`);
  }
}

function validateLeaf(leaf: ProcedureLeafNode, evidenceIds: ReadonlySet<string>): void {
  if (leaf.action === null && leaf.observationPolicy !== undefined) {
    throw new Error(`Actionless procedure leaf ${leaf.id} cannot declare an observation policy`);
  }
  if (leaf.observationPolicy?.mode === 'success_gate' && leaf.expectedObservations.length === 0) {
    throw new Error(`Success-gated procedure leaf ${leaf.id} requires an expected observation`);
  }
  validateOrderedItems(`Procedure leaf ${leaf.id} semantic operations`, leaf.semanticOperations);
  const semanticIds = new Set(leaf.semanticOperations.map((operation) => operation.id));
  for (const operation of leaf.semanticOperations) {
    validateEvidenceReferences(
      `Procedure leaf ${leaf.id} semantic operation ${operation.id}`,
      operation.evidenceRefs,
      evidenceIds,
    );
  }

  const trackIds = new Set<string>();
  const tracks = [...leaf.menuTracks, ...leaf.shortcutTracks, ...leaf.mcpTracks];
  for (const track of tracks) {
    if (trackIds.has(track.id)) {
      throw new Error(`Procedure leaf ${leaf.id} contains duplicate track ${track.id}`);
    }
    trackIds.add(track.id);
    if (track.availability === 'available') {
      validateAvailableTrack(leaf, track, semanticIds, evidenceIds);
    }
  }
  if (leaf.validation.status === 'verified' && leaf.validation.validatedHostVersions.length === 0) {
    throw new Error(`Verified procedure leaf ${leaf.id} requires a validated host version`);
  }
}

/** Validate cross-reference, ordering, hierarchy, and modality-alignment invariants. */
export function validateProcedureTree(tree: ProcedureTree): void {
  const sourceById = new Map<string, ProcedureSource>();
  for (const source of tree.sources) {
    if (sourceById.has(source.id)) {
      throw new Error(`Procedure tree ${tree.id} contains duplicate source ${source.id}`);
    }
    sourceById.set(source.id, source);
    if (
      source.kind === 'tutorial_video' &&
      source.rightsStatus === 'license_verified' &&
      source.license === undefined
    ) {
      throw new Error(`Licensed tutorial video source ${source.id} requires a license`);
    }
  }

  const evidenceIds = new Set<string>();
  for (const evidence of tree.evidence) {
    if (evidenceIds.has(evidence.id)) {
      throw new Error(`Procedure tree ${tree.id} contains duplicate evidence ${evidence.id}`);
    }
    evidenceIds.add(evidence.id);
    const source = sourceById.get(evidence.sourceId);
    if (source === undefined) {
      throw new Error(
        `Procedure evidence ${evidence.id} references unknown source ${evidence.sourceId}`,
      );
    }
    if (evidence.locator.kind === 'video_segment') {
      if (source.kind !== 'tutorial_video') {
        throw new Error(`Video evidence ${evidence.id} must reference a tutorial video source`);
      }
      if (evidence.locator.endMs <= evidence.locator.startMs) {
        throw new Error(`Video evidence ${evidence.id} must have a positive time range`);
      }
      if (source.durationMs !== undefined && evidence.locator.endMs > source.durationMs) {
        throw new Error(`Video evidence ${evidence.id} exceeds source duration`);
      }
    }
    if (evidence.locator.kind === 'text_span') {
      if (source.kind !== 'natural_language') {
        throw new Error(`Text evidence ${evidence.id} must reference a natural-language source`);
      }
      if (evidence.locator.endOffset <= evidence.locator.startOffset) {
        throw new Error(`Text evidence ${evidence.id} must have a positive offset range`);
      }
      if (evidence.locator.endOffset > source.text.length) {
        throw new Error(`Text evidence ${evidence.id} exceeds source length`);
      }
    }
  }

  const nodeById = new Map<string, ProcedureNode>();
  for (const node of tree.nodes) {
    if (nodeById.has(node.id)) {
      throw new Error(`Procedure tree ${tree.id} contains duplicate node ${node.id}`);
    }
    nodeById.set(node.id, node);
  }
  const roots = tree.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1 || roots[0]?.id !== tree.rootNodeId) {
    throw new Error(`Procedure tree ${tree.id} must contain exactly its declared root node`);
  }
  if (roots[0].order !== 1) {
    throw new Error(`Procedure tree ${tree.id} root order must be 1`);
  }

  const childrenByParent = new Map<string, ProcedureNode[]>();
  for (const node of tree.nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) {
      throw new Error(`Procedure node ${node.id} contains duplicate dependencies`);
    }
    if (node.kind === 'leaf' && node.action !== null && node.action.adapterId !== tree.adapterId) {
      throw new Error(
        `Procedure leaf ${node.id} action adapter ${node.action.adapterId} does not match ${tree.adapterId}`,
      );
    }
    if (node.parentId !== null) {
      const parent = nodeById.get(node.parentId);
      if (parent === undefined) {
        throw new Error(`Procedure node ${node.id} references unknown parent ${node.parentId}`);
      }
      if (parent.kind === 'leaf') {
        throw new Error(`Procedure leaf ${parent.id} cannot contain child ${node.id}`);
      }
      const children = childrenByParent.get(node.parentId) ?? [];
      children.push(node);
      childrenByParent.set(node.parentId, children);
    }
    if (node.kind === 'group' && node.dependsOn.length > 0) {
      throw new Error(`Procedure group ${node.id} cannot declare execution dependencies`);
    }
  }
  for (const node of tree.nodes) {
    if (node.kind === 'group' && (childrenByParent.get(node.id)?.length ?? 0) === 0) {
      throw new Error(`Procedure group ${node.id} must contain at least one child`);
    }
  }
  for (const [parentId, children] of childrenByParent) {
    validateOrderedItems(`Procedure node ${parentId} children`, children);
  }

  const parentVisiting = new Set<string>();
  const parentVisited = new Set<string>();
  const visitParent = (nodeId: string): void => {
    if (parentVisiting.has(nodeId)) {
      throw new Error(`Procedure hierarchy cycle includes ${nodeId}`);
    }
    if (parentVisited.has(nodeId)) return;
    parentVisiting.add(nodeId);
    const parentId = nodeById.get(nodeId)?.parentId;
    if (parentId !== null && parentId !== undefined) visitParent(parentId);
    parentVisiting.delete(nodeId);
    parentVisited.add(nodeId);
  };
  for (const nodeId of nodeById.keys()) visitParent(nodeId);

  const dependencyVisiting = new Set<string>();
  const dependencyVisited = new Set<string>();
  const visitDependencies = (nodeId: string): void => {
    if (dependencyVisiting.has(nodeId)) {
      throw new Error(`Procedure dependency cycle includes ${nodeId}`);
    }
    if (dependencyVisited.has(nodeId)) return;
    dependencyVisiting.add(nodeId);
    const node = nodeById.get(nodeId)!;
    for (const dependencyId of node.dependsOn) {
      const dependency = nodeById.get(dependencyId);
      if (dependency === undefined) {
        throw new Error(`Procedure node ${node.id} references unknown dependency ${dependencyId}`);
      }
      if (dependency.id === node.id) {
        throw new Error(`Procedure node ${node.id} cannot depend on itself`);
      }
      if (dependency.kind !== 'leaf') {
        throw new Error(`Procedure node ${node.id} cannot depend on group ${dependency.id}`);
      }
      visitDependencies(dependency.id);
    }
    dependencyVisiting.delete(nodeId);
    dependencyVisited.add(nodeId);
  };
  for (const nodeId of nodeById.keys()) visitDependencies(nodeId);

  const reachable = new Set<string>();
  const visitChildren = (nodeId: string): void => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const child of childrenByParent.get(nodeId) ?? []) visitChildren(child.id);
  };
  visitChildren(tree.rootNodeId);
  if (reachable.size !== tree.nodes.length) {
    const disconnected = tree.nodes
      .filter((node) => !reachable.has(node.id))
      .map((node) => node.id)
      .sort();
    throw new Error(
      `Procedure tree ${tree.id} contains disconnected nodes: ${disconnected.join(', ')}`,
    );
  }

  for (const node of tree.nodes) {
    if (node.kind === 'leaf') validateLeaf(node, evidenceIds);
  }
}

/** Parse the public shape and then enforce its graph/alignment invariants. */
export function parseProcedureTree(input: unknown): ProcedureTree {
  const tree = procedureTreeSchema.parse(input);
  validateProcedureTree(tree);
  return tree;
}

/** Compile the editable intermediate tree into the existing human-approved GuidePlan boundary. */
export function compileProcedureTreeToGuidePlan(tree: ProcedureTree): GuidePlan {
  validateProcedureTree(tree);
  return guidePlanSchema.parse({
    protocolVersion: guideProtocolVersion,
    id: tree.id,
    revision: tree.revision,
    title: tree.title,
    rootStepId: tree.rootNodeId,
    steps: tree.nodes.map((node) => {
      const common = {
        id: node.id,
        parentId: node.parentId,
        order: node.order,
        dependsOn: node.dependsOn,
        title: node.title,
        intent: node.intent,
        state: 'draft' as const,
      };
      if (node.kind === 'group') {
        return {
          ...common,
          explanation: node.intent,
          action: null,
          anchors: [],
          expectedObservations: [],
          rollback: { mode: 'checkpoint_restore' as const, checkpointRequired: true },
        };
      }
      return {
        ...common,
        explanation: node.semanticOperations.map((operation) => operation.description).join(' '),
        action: node.action,
        anchors: node.anchors,
        expectedObservations: node.expectedObservations,
        ...(node.observationPolicy === undefined
          ? {}
          : { observationPolicy: node.observationPolicy }),
        rollback: node.rollback,
      };
    }),
  });
}

/** Return executable leaves in dependency-safe, presentation-stable order. */
export function stableProcedureLeafOrder(tree: ProcedureTree): ProcedureLeafNode[] {
  validateProcedureTree(tree);
  const nodeById = new Map(tree.nodes.map((node) => [node.id, node]));
  const pathCache = new Map<string, readonly number[]>();
  const presentationPath = (node: ProcedureNode): readonly number[] => {
    const cached = pathCache.get(node.id);
    if (cached !== undefined) return cached;
    const path =
      node.parentId === null
        ? [node.order]
        : [...presentationPath(nodeById.get(node.parentId)!), node.order];
    pathCache.set(node.id, path);
    return path;
  };
  const comparePresentation = (left: ProcedureLeafNode, right: ProcedureLeafNode): number => {
    const leftPath = presentationPath(left);
    const rightPath = presentationPath(right);
    for (let index = 0; index < Math.max(leftPath.length, rightPath.length); index += 1) {
      const difference = (leftPath[index] ?? -1) - (rightPath[index] ?? -1);
      if (difference !== 0) return difference;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };

  const completed = new Set<string>();
  const remaining = new Map(
    tree.nodes
      .filter((node): node is ProcedureLeafNode => node.kind === 'leaf')
      .map((node) => [node.id, node]),
  );
  const ordered: ProcedureLeafNode[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => completed.has(dependency)))
      .sort(comparePresentation);
    const next = ready[0];
    if (next === undefined) {
      throw new Error(`Procedure tree ${tree.id} has no dependency-ready leaf`);
    }
    ordered.push(next);
    completed.add(next.id);
    remaining.delete(next.id);
  }
  return ordered;
}

function tracksForModality(leaf: ProcedureLeafNode, modality: ProcedureTrackModality) {
  switch (modality) {
    case 'menu':
      return leaf.menuTracks;
    case 'shortcut':
      return leaf.shortcutTracks;
    case 'mcp':
      return leaf.mcpTracks;
  }
}

/** Select and concatenate one available execution track per leaf without executing host actions. */
export function materializeProcedureOperations(
  tree: ProcedureTree,
  modality: ProcedureTrackModality,
  selectedTrackIds: Readonly<Record<string, string>> = {},
): MaterializedProcedureOperation[] {
  const materialized: MaterializedProcedureOperation[] = [];
  for (const leaf of stableProcedureLeafOrder(tree)) {
    const tracks = tracksForModality(leaf, modality);
    const selectedTrackId = selectedTrackIds[leaf.id];
    const candidates =
      selectedTrackId === undefined
        ? tracks.filter((track) => track.availability === 'available')
        : tracks.filter(
            (track) => track.id === selectedTrackId && track.availability === 'available',
          );
    if (candidates.length === 0) {
      const selection = selectedTrackId === undefined ? '' : ` selected as ${selectedTrackId}`;
      throw new Error(`Procedure leaf ${leaf.id} has no available ${modality} track${selection}`);
    }
    if (candidates.length > 1) {
      throw new Error(
        `Procedure leaf ${leaf.id} has ambiguous ${modality} tracks: ${candidates
          .map((track) => track.id)
          .sort()
          .join(', ')}`,
      );
    }
    const track = candidates[0]!;
    if (track.availability !== 'available') {
      throw new Error(`Procedure leaf ${leaf.id} selected an unavailable ${modality} track`);
    }
    for (const operation of [...track.operations].sort((left, right) => left.order - right.order)) {
      materialized.push({
        globalOrder: materialized.length + 1,
        leafId: leaf.id,
        trackId: track.id,
        modality,
        operation,
      });
    }
  }
  return materialized;
}
