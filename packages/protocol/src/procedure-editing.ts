import { z } from 'zod';

import { protocolJsonValueCanonicalization } from './canonical-json-value.js';
import { guideStepIdSchema } from './guide.js';
import {
  procedureOperationSearchModalitySchema,
  procedureTreeIntegritySchema,
  procedureTreeSchema,
} from './procedure-tree.js';

export const procedureTreeEditorFormatVersion = '1.0.0' as const;
export const procedureTreeEditorFormatVersionSchema = z.literal(procedureTreeEditorFormatVersion);

const editorVersionShape = { formatVersion: procedureTreeEditorFormatVersionSchema } as const;
const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const occurredAtSchema = z.iso.datetime({ offset: true });
const branchNameSchema = z.string().trim().min(1).max(120);
const messageSchema = z.string().trim().min(1).max(4_000);
const cursorLimitSchema = z.number().int().min(1).max(100);

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

export const procedureTreeEditorRevisionRefSchema = z.strictObject({
  treeId: guideStepIdSchema,
  revision: z.number().int().positive(),
  contentSha256: contentSha256Schema,
});
export type ProcedureTreeEditorRevisionRef = z.infer<typeof procedureTreeEditorRevisionRefSchema>;

export const procedureTreeEditorBranchSchema = z
  .strictObject({
    branchId: z.uuid(),
    treeId: guideStepIdSchema,
    name: branchNameSchema,
    createdFrom: procedureTreeEditorRevisionRefSchema,
    head: procedureTreeEditorRevisionRefSchema,
    createdAt: occurredAtSchema,
  })
  .superRefine((branch, context) => {
    if (branch.createdFrom.treeId !== branch.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['createdFrom', 'treeId'],
        message: 'Branch creation reference must belong to the branch tree',
      });
    }
    if (branch.head.treeId !== branch.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['head', 'treeId'],
        message: 'Branch head must belong to the branch tree',
      });
    }
    if (branch.head.revision < branch.createdFrom.revision) {
      context.addIssue({
        code: 'custom',
        path: ['head', 'revision'],
        message: 'Branch head cannot precede its creation reference',
      });
    }
  });
export type ProcedureTreeEditorBranch = z.infer<typeof procedureTreeEditorBranchSchema>;

export const procedureTreeEditorBranchCreateRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    treeId: guideStepIdSchema,
    name: branchNameSchema,
    createdFrom: procedureTreeEditorRevisionRefSchema,
    occurredAt: occurredAtSchema,
  })
  .refine((request) => request.createdFrom.treeId === request.treeId, {
    message: 'Branch creation reference must belong to the requested tree',
    path: ['createdFrom', 'treeId'],
  });
export type ProcedureTreeEditorBranchCreateRequest = z.infer<
  typeof procedureTreeEditorBranchCreateRequestSchema
>;

export const procedureTreeEditorBranchCreateResultSchema = z.strictObject({
  ...editorVersionShape,
  requestId: z.uuid(),
  result: z.enum(['accepted', 'duplicate']),
  branch: procedureTreeEditorBranchSchema,
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureTreeEditorBranchCreateResult = z.infer<
  typeof procedureTreeEditorBranchCreateResultSchema
>;

export const procedureTreeEditorBranchGetRequestSchema = z.strictObject({
  ...editorVersionShape,
  treeId: guideStepIdSchema,
  branchId: z.uuid(),
});
export type ProcedureTreeEditorBranchGetRequest = z.infer<
  typeof procedureTreeEditorBranchGetRequestSchema
>;

export const procedureTreeEditorBranchGetResultSchema = z.strictObject({
  ...editorVersionShape,
  branch: procedureTreeEditorBranchSchema,
});
export type ProcedureTreeEditorBranchGetResult = z.infer<
  typeof procedureTreeEditorBranchGetResultSchema
>;

export const procedureTreeEditorBranchListRequestSchema = z.strictObject({
  ...editorVersionShape,
  treeId: guideStepIdSchema,
  afterBranchId: z.uuid().optional(),
  limit: cursorLimitSchema.optional(),
});
export type ProcedureTreeEditorBranchListRequest = z.infer<
  typeof procedureTreeEditorBranchListRequestSchema
>;

export const procedureTreeEditorBranchListResultSchema = z.strictObject({
  ...editorVersionShape,
  branches: z.array(procedureTreeEditorBranchSchema),
  nextAfterBranchId: z.uuid().nullable(),
});
export type ProcedureTreeEditorBranchListResult = z.infer<
  typeof procedureTreeEditorBranchListResultSchema
>;

export const procedureTreeEditorWorkspaceRequestSchema = z.strictObject({
  ...editorVersionShape,
  treeId: guideStepIdSchema,
  branchId: z.uuid(),
});
export type ProcedureTreeEditorWorkspaceRequest = z.infer<
  typeof procedureTreeEditorWorkspaceRequestSchema
>;

export const procedureTreeEditorWorkspaceResultSchema = z
  .strictObject({
    ...editorVersionShape,
    branch: procedureTreeEditorBranchSchema,
    tree: procedureTreeSchema,
    integrity: procedureTreeIntegritySchema,
    commentsAreTreeContent: z.literal(false),
  })
  .superRefine((workspace, context) => {
    if (workspace.tree.id !== workspace.branch.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['tree', 'id'],
        message: 'Workspace tree must match the branch tree',
      });
    }
    if (workspace.tree.revision !== workspace.branch.head.revision) {
      context.addIssue({
        code: 'custom',
        path: ['tree', 'revision'],
        message: 'Workspace tree must be the exact branch head revision',
      });
    }
    if (workspace.integrity.contentSha256 !== workspace.branch.head.contentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Workspace integrity must match the exact branch head',
      });
    }
  });
export type ProcedureTreeEditorWorkspaceResult = z.infer<
  typeof procedureTreeEditorWorkspaceResultSchema
>;

const stableCollectionSchema = z.enum([
  'sources',
  'evidence',
  'nodes',
  'semanticOperations',
  'menuTracks',
  'shortcutTracks',
  'mcpTracks',
  'operations',
  'anchors',
  'expectedObservations',
]);

const unsafeStablePathFieldNames = new Set(['__proto__', 'constructor', 'prototype']);

export const procedureTreeEditorStablePathSegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('field'),
    name: z
      .string()
      .min(1)
      .max(180)
      .refine((name) => !unsafeStablePathFieldNames.has(name), {
        message: 'Unsafe stable path field',
      }),
  }),
  z.strictObject({
    kind: z.literal('identified'),
    collection: stableCollectionSchema,
    id: guideStepIdSchema,
  }),
]);
export type ProcedureTreeEditorStablePathSegment = z.infer<
  typeof procedureTreeEditorStablePathSegmentSchema
>;

export const procedureTreeEditorStablePathSchema = z
  .array(procedureTreeEditorStablePathSegmentSchema)
  .min(1)
  .max(32);
export type ProcedureTreeEditorStablePath = z.infer<typeof procedureTreeEditorStablePathSchema>;

const diffEntryBaseShape = {
  stableId: guideStepIdSchema,
  path: procedureTreeEditorStablePathSchema,
} as const;

export const procedureTreeEditorDiffEntrySchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...diffEntryBaseShape, operation: z.literal('add'), after: z.json() }),
  z.strictObject({ ...diffEntryBaseShape, operation: z.literal('remove'), before: z.json() }),
  z
    .strictObject({
      ...diffEntryBaseShape,
      operation: z.literal('replace'),
      before: z.json(),
      after: z.json(),
    })
    .refine((entry) => canonicalJson(entry.before) !== canonicalJson(entry.after), {
      message: 'A replace entry must change the exact JSON value',
      path: ['after'],
    }),
]);
export type ProcedureTreeEditorDiffEntry = z.infer<typeof procedureTreeEditorDiffEntrySchema>;

export const procedureTreeEditorDiffBindingSchema = z.strictObject({
  base: procedureTreeEditorRevisionRefSchema,
  target: procedureTreeEditorRevisionRefSchema,
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: contentSha256Schema,
});
export type ProcedureTreeEditorDiffBinding = z.infer<typeof procedureTreeEditorDiffBindingSchema>;

export const procedureTreeEditorDiffResultSchema = z
  .strictObject({
    ...editorVersionShape,
    binding: procedureTreeEditorDiffBindingSchema,
    entries: z.array(procedureTreeEditorDiffEntrySchema).max(10_000),
  })
  .superRefine((diff, context) => {
    if (diff.binding.base.treeId !== diff.binding.target.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['binding', 'target', 'treeId'],
        message: 'Diff references must belong to the same tree',
      });
    }
    const keys = new Set<string>();
    for (const [index, entry] of diff.entries.entries()) {
      const key = canonicalJson(entry.path);
      if (keys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'path'],
          message: 'Diff paths must be unique',
        });
      }
      keys.add(key);
    }
  });
export type ProcedureTreeEditorDiffResult = z.infer<typeof procedureTreeEditorDiffResultSchema>;

const editPreviewCoreSchema = z
  .strictObject({
    branchId: z.uuid(),
    base: procedureTreeEditorRevisionRefSchema,
    expectedLatestRevision: z.number().int().positive(),
    targetTree: procedureTreeSchema,
    message: messageSchema.optional(),
  })
  .superRefine((preview, context) => {
    if (preview.expectedLatestRevision < preview.base.revision) {
      context.addIssue({
        code: 'custom',
        path: ['expectedLatestRevision'],
        message: 'Expected latest revision cannot precede the branch base',
      });
    }
    if (preview.targetTree.id !== preview.base.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree', 'id'],
        message: 'Target tree id must match the base tree id',
      });
    }
    if (preview.targetTree.revision !== preview.expectedLatestRevision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree', 'revision'],
        message: 'Target revision must be expectedLatestRevision + 1',
      });
    }
  });

export const procedureTreeEditorEditPreviewRequestSchema = editPreviewCoreSchema.safeExtend({
  ...editorVersionShape,
  requestId: z.uuid(),
});
export type ProcedureTreeEditorEditPreviewRequest = z.infer<
  typeof procedureTreeEditorEditPreviewRequestSchema
>;

export const procedureTreeEditorEditPreviewBindingSchema = z
  .strictObject({
    operation: z.literal('edit'),
    branchId: z.uuid(),
    base: procedureTreeEditorRevisionRefSchema,
    expectedLatestRevision: z.number().int().positive(),
    target: procedureTreeEditorRevisionRefSchema,
    diffContentSha256: contentSha256Schema,
    algorithm: z.literal('sha256'),
    canonicalization: z.literal(protocolJsonValueCanonicalization),
    previewContentSha256: contentSha256Schema,
  })
  .superRefine((binding, context) => {
    if (
      binding.base.treeId !== binding.target.treeId ||
      binding.target.revision !== binding.expectedLatestRevision + 1 ||
      binding.expectedLatestRevision < binding.base.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Invalid edit preview topology',
      });
    }
  });
export type ProcedureTreeEditorEditPreviewBinding = z.infer<
  typeof procedureTreeEditorEditPreviewBindingSchema
>;

export const procedureTreeEditorEditPreviewResultSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    branchId: z.uuid(),
    base: procedureTreeEditorRevisionRefSchema,
    expectedLatestRevision: z.number().int().positive(),
    targetTree: procedureTreeSchema,
    targetIntegrity: procedureTreeIntegritySchema,
    diff: procedureTreeEditorDiffResultSchema,
    binding: procedureTreeEditorEditPreviewBindingSchema,
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
  })
  .superRefine((preview, context) => {
    if (
      preview.targetTree.id !== preview.base.treeId ||
      preview.targetTree.revision !== preview.expectedLatestRevision + 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree'],
        message: 'Invalid target tree identity',
      });
    }
    const target = preview.binding.target;
    if (
      preview.binding.branchId !== preview.branchId ||
      canonicalJson(preview.binding.base) !== canonicalJson(preview.base) ||
      preview.binding.expectedLatestRevision !== preview.expectedLatestRevision ||
      target.treeId !== preview.targetTree.id ||
      target.revision !== preview.targetTree.revision ||
      target.contentSha256 !== preview.targetIntegrity.contentSha256 ||
      preview.binding.diffContentSha256 !== preview.diff.binding.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Edit preview binding mismatch',
      });
    }
  });
export type ProcedureTreeEditorEditPreviewResult = z.infer<
  typeof procedureTreeEditorEditPreviewResultSchema
>;

export const procedureTreeEditorMergeConflictValueSchema = z.discriminatedUnion('present', [
  z.strictObject({ present: z.literal(true), value: z.json() }),
  z.strictObject({ present: z.literal(false) }),
]);
export type ProcedureTreeEditorMergeConflictValue = z.infer<
  typeof procedureTreeEditorMergeConflictValueSchema
>;

export const procedureTreeEditorMergeConflictSchema = z.strictObject({
  stableId: guideStepIdSchema,
  path: procedureTreeEditorStablePathSchema,
  mergeBase: procedureTreeEditorMergeConflictValueSchema,
  target: procedureTreeEditorMergeConflictValueSchema,
  source: procedureTreeEditorMergeConflictValueSchema,
});
export type ProcedureTreeEditorMergeConflict = z.infer<
  typeof procedureTreeEditorMergeConflictSchema
>;

export const procedureTreeEditorMergeConflictResolutionSchema = z
  .strictObject({
    conflict: procedureTreeEditorMergeConflictSchema,
    choice: z.enum(['target', 'source', 'base', 'custom']),
    custom: procedureTreeEditorMergeConflictValueSchema.optional(),
  })
  .superRefine((resolution, context) => {
    if ((resolution.choice === 'custom') !== (resolution.custom !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['custom'],
        message: 'Custom merge resolutions require exactly one custom operand',
      });
    }
  });
export type ProcedureTreeEditorMergeConflictResolution = z.infer<
  typeof procedureTreeEditorMergeConflictResolutionSchema
>;

export const procedureTreeEditorMergePreviewRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    targetBranchId: z.uuid(),
    sourceBranchId: z.uuid(),
    targetHead: procedureTreeEditorRevisionRefSchema,
    sourceHead: procedureTreeEditorRevisionRefSchema,
    expectedLatestRevision: z.number().int().positive(),
    resolutions: z.array(procedureTreeEditorMergeConflictResolutionSchema).min(1).optional(),
  })
  .superRefine((request, context) => {
    if (request.targetBranchId === request.sourceBranchId) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBranchId'],
        message: 'Merge source and target branches must differ',
      });
    }
    if (request.targetHead.treeId !== request.sourceHead.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['sourceHead', 'treeId'],
        message: 'Merge heads must belong to the same tree',
      });
    }
    if (
      request.expectedLatestRevision < request.targetHead.revision ||
      request.expectedLatestRevision < request.sourceHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedLatestRevision'],
        message: 'Expected latest revision cannot precede either merge head',
      });
    }
  });
export type ProcedureTreeEditorMergePreviewRequest = z.infer<
  typeof procedureTreeEditorMergePreviewRequestSchema
>;

export const procedureTreeEditorMergePreviewBindingSchema = z
  .strictObject({
    operation: z.literal('merge'),
    targetBranchId: z.uuid(),
    sourceBranchId: z.uuid(),
    targetHead: procedureTreeEditorRevisionRefSchema,
    sourceHead: procedureTreeEditorRevisionRefSchema,
    mergeBase: procedureTreeEditorRevisionRefSchema,
    expectedLatestRevision: z.number().int().positive(),
    target: procedureTreeEditorRevisionRefSchema,
    diffContentSha256: contentSha256Schema,
    resolutions: z.array(procedureTreeEditorMergeConflictResolutionSchema).min(1).optional(),
    algorithm: z.literal('sha256'),
    canonicalization: z.literal(protocolJsonValueCanonicalization),
    previewContentSha256: contentSha256Schema,
  })
  .superRefine((binding, context) => {
    const treeId = binding.targetHead.treeId;
    if (
      binding.targetBranchId === binding.sourceBranchId ||
      binding.sourceHead.treeId !== treeId ||
      binding.mergeBase.treeId !== treeId ||
      binding.target.treeId !== treeId ||
      binding.target.revision !== binding.expectedLatestRevision + 1 ||
      binding.expectedLatestRevision < binding.targetHead.revision ||
      binding.expectedLatestRevision < binding.sourceHead.revision ||
      binding.mergeBase.revision > binding.targetHead.revision ||
      binding.mergeBase.revision > binding.sourceHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Invalid merge preview topology',
      });
    }
  });
export type ProcedureTreeEditorMergePreviewBinding = z.infer<
  typeof procedureTreeEditorMergePreviewBindingSchema
>;

const mergePreviewBaseShape = {
  ...editorVersionShape,
  requestId: z.uuid(),
  targetBranchId: z.uuid(),
  sourceBranchId: z.uuid(),
  targetHead: procedureTreeEditorRevisionRefSchema,
  sourceHead: procedureTreeEditorRevisionRefSchema,
  mergeBase: procedureTreeEditorRevisionRefSchema,
  expectedLatestRevision: z.number().int().positive(),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
} as const;

export const procedureTreeEditorMergePreviewResultSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      ...mergePreviewBaseShape,
      status: z.literal('ready'),
      targetCandidate: procedureTreeSchema,
      targetIntegrity: procedureTreeIntegritySchema,
      diff: procedureTreeEditorDiffResultSchema,
      binding: procedureTreeEditorMergePreviewBindingSchema,
    }),
    z.strictObject({
      ...mergePreviewBaseShape,
      status: z.literal('conflicts'),
      conflicts: z.array(procedureTreeEditorMergeConflictSchema).min(1),
    }),
  ])
  .superRefine((preview, context) => {
    if (preview.targetBranchId === preview.sourceBranchId) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBranchId'],
        message: 'Merge branches must differ',
      });
    }
    const treeId = preview.targetHead.treeId;
    if (preview.sourceHead.treeId !== treeId || preview.mergeBase.treeId !== treeId) {
      context.addIssue({
        code: 'custom',
        path: ['mergeBase'],
        message: 'Merge refs must share one tree id',
      });
    }
    if (
      preview.mergeBase.revision > preview.targetHead.revision ||
      preview.mergeBase.revision > preview.sourceHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mergeBase'],
        message: 'Merge base must precede both heads',
      });
    }
    if (
      preview.expectedLatestRevision < preview.targetHead.revision ||
      preview.expectedLatestRevision < preview.sourceHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedLatestRevision'],
        message: 'Invalid latest revision',
      });
    }
    if (preview.status === 'ready') {
      if (
        preview.targetCandidate.id !== treeId ||
        preview.targetCandidate.revision !== preview.expectedLatestRevision + 1
      ) {
        context.addIssue({
          code: 'custom',
          path: ['targetCandidate'],
          message: 'Invalid merge target identity',
        });
      }
      const target = preview.binding.target;
      if (
        preview.binding.targetBranchId !== preview.targetBranchId ||
        preview.binding.sourceBranchId !== preview.sourceBranchId ||
        canonicalJson(preview.binding.targetHead) !== canonicalJson(preview.targetHead) ||
        canonicalJson(preview.binding.sourceHead) !== canonicalJson(preview.sourceHead) ||
        canonicalJson(preview.binding.mergeBase) !== canonicalJson(preview.mergeBase) ||
        preview.binding.expectedLatestRevision !== preview.expectedLatestRevision ||
        target.treeId !== preview.targetCandidate.id ||
        target.revision !== preview.targetCandidate.revision ||
        target.contentSha256 !== preview.targetIntegrity.contentSha256 ||
        preview.binding.diffContentSha256 !== preview.diff.binding.contentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['binding'],
          message: 'Merge preview binding mismatch',
        });
      }
    }
  });
export type ProcedureTreeEditorMergePreviewResult = z.infer<
  typeof procedureTreeEditorMergePreviewResultSchema
>;

export const procedureTreeEditorPreviewBindingSchema = z.discriminatedUnion('operation', [
  procedureTreeEditorEditPreviewBindingSchema,
  procedureTreeEditorMergePreviewBindingSchema,
]);
export type ProcedureTreeEditorPreviewBinding = z.infer<
  typeof procedureTreeEditorPreviewBindingSchema
>;

export const procedureTreeEditorCommitRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    occurredAt: occurredAtSchema,
    operation: z.enum(['edit', 'merge']),
    targetBranchId: z.uuid(),
    expectedHead: procedureTreeEditorRevisionRefSchema,
    previewBinding: procedureTreeEditorPreviewBindingSchema,
    targetTree: procedureTreeSchema,
    targetIntegrity: procedureTreeIntegritySchema,
    message: messageSchema.optional(),
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
  })
  .superRefine((request, context) => {
    if (request.operation !== request.previewBinding.operation) {
      context.addIssue({
        code: 'custom',
        path: ['previewBinding', 'operation'],
        message: 'Operation mismatch',
      });
    }
    const bindingBranchId =
      request.previewBinding.operation === 'edit'
        ? request.previewBinding.branchId
        : request.previewBinding.targetBranchId;
    const bindingHead =
      request.previewBinding.operation === 'edit'
        ? request.previewBinding.base
        : request.previewBinding.targetHead;
    if (
      bindingBranchId !== request.targetBranchId ||
      canonicalJson(bindingHead) !== canonicalJson(request.expectedHead)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['previewBinding'],
        message: 'Commit head binding mismatch',
      });
    }
    const target = request.previewBinding.target;
    if (
      request.targetTree.id !== request.expectedHead.treeId ||
      request.targetTree.id !== target.treeId ||
      request.targetTree.revision !== target.revision ||
      request.targetIntegrity.contentSha256 !== target.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree'],
        message: 'Commit target binding mismatch',
      });
    }
  });
export type ProcedureTreeEditorCommitRequest = z.infer<
  typeof procedureTreeEditorCommitRequestSchema
>;

export const procedureTreeEditorRevisionCommitSchema = z
  .strictObject({
    commitId: z.uuid(),
    requestId: z.uuid(),
    branchId: z.uuid(),
    operation: z.enum(['edit', 'merge']),
    revision: procedureTreeEditorRevisionRefSchema,
    parent: procedureTreeEditorRevisionRefSchema,
    source: z
      .strictObject({
        branchId: z.uuid(),
        revision: procedureTreeEditorRevisionRefSchema,
      })
      .nullable(),
    mergeBase: procedureTreeEditorRevisionRefSchema.nullable(),
    message: messageSchema.nullable(),
    occurredAt: occurredAtSchema,
  })
  .superRefine((commit, context) => {
    const refs = [commit.parent, commit.source?.revision ?? null, commit.mergeBase].filter(
      (reference): reference is ProcedureTreeEditorRevisionRef => reference !== null,
    );
    if (refs.some((reference) => reference.treeId !== commit.revision.treeId)) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Commit lineage must share one tree id',
      });
    }
    if (commit.revision.revision <= commit.parent.revision) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Commit must advance its parent',
      });
    }
    if (commit.operation === 'edit' && (commit.source !== null || commit.mergeBase !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Edit commits have one parent',
      });
    }
    if (commit.operation === 'merge' && (commit.source === null || commit.mergeBase === null)) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Merge commits require source and merge base refs',
      });
    }
    if (
      commit.mergeBase !== null &&
      (commit.mergeBase.revision > commit.parent.revision ||
        (commit.source !== null && commit.mergeBase.revision > commit.source.revision.revision))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mergeBase'],
        message: 'Invalid merge-base lineage',
      });
    }
  });
export type ProcedureTreeEditorRevisionCommit = z.infer<
  typeof procedureTreeEditorRevisionCommitSchema
>;

export const procedureTreeEditorCommitResultSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    result: z.enum(['accepted', 'duplicate']),
    occurredAt: occurredAtSchema,
    operation: z.enum(['edit', 'merge']),
    branch: procedureTreeEditorBranchSchema,
    commit: procedureTreeEditorRevisionCommitSchema,
    tree: procedureTreeSchema,
    integrity: procedureTreeIntegritySchema,
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
  })
  .superRefine((result, context) => {
    if (
      result.operation !== result.commit.operation ||
      result.requestId !== result.commit.requestId ||
      result.commit.branchId !== result.branch.branchId ||
      result.commit.revision.treeId !== result.tree.id ||
      result.commit.revision.revision !== result.tree.revision ||
      result.commit.revision.contentSha256 !== result.integrity.contentSha256 ||
      canonicalJson(result.commit.revision) !== canonicalJson(result.branch.head)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commit'],
        message: 'Committed revision mismatch',
      });
    }
  });
export type ProcedureTreeEditorCommitResult = z.infer<typeof procedureTreeEditorCommitResultSchema>;

export const procedureTreeEditorBranchHistoryRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    treeId: guideStepIdSchema,
    branchId: z.uuid(),
    expectedHead: procedureTreeEditorRevisionRefSchema,
    afterRevision: z.number().int().nonnegative().optional(),
    limit: cursorLimitSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.expectedHead.treeId !== request.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['expectedHead', 'treeId'],
        message: 'History snapshot head must belong to requested tree',
      });
    }
    if (
      request.afterRevision !== undefined &&
      request.afterRevision > request.expectedHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['afterRevision'],
        message: 'History cursor cannot exceed snapshot head',
      });
    }
  });
export type ProcedureTreeEditorBranchHistoryRequest = z.infer<
  typeof procedureTreeEditorBranchHistoryRequestSchema
>;

export const procedureTreeEditorBranchHistoryResultSchema = z
  .strictObject({
    ...editorVersionShape,
    treeId: guideStepIdSchema,
    branchId: z.uuid(),
    snapshotHead: procedureTreeEditorRevisionRefSchema,
    commits: z.array(procedureTreeEditorRevisionCommitSchema),
    nextAfterRevision: z.number().int().positive().nullable(),
  })
  .superRefine((history, context) => {
    if (history.snapshotHead.treeId !== history.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['snapshotHead', 'treeId'],
        message: 'History snapshot head must belong to requested tree',
      });
    }
    if (
      history.nextAfterRevision !== null &&
      history.nextAfterRevision > history.snapshotHead.revision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nextAfterRevision'],
        message: 'History cursor cannot exceed snapshot head',
      });
    }
    const revisions = new Set<number>();
    let previousRevision = 0;
    for (const [index, commit] of history.commits.entries()) {
      if (commit.branchId !== history.branchId || commit.revision.treeId !== history.treeId) {
        context.addIssue({
          code: 'custom',
          path: ['commits', index],
          message: 'Commit is outside requested branch history',
        });
      }
      if (revisions.has(commit.revision.revision)) {
        context.addIssue({
          code: 'custom',
          path: ['commits', index, 'revision'],
          message: 'Revision repeats in branch history',
        });
      }
      if (commit.revision.revision > history.snapshotHead.revision) {
        context.addIssue({
          code: 'custom',
          path: ['commits', index, 'revision'],
          message: 'Commit is newer than history snapshot head',
        });
      }
      if (commit.revision.revision <= previousRevision) {
        context.addIssue({
          code: 'custom',
          path: ['commits', index, 'revision'],
          message: 'Branch history commits must be ordered by ascending revision',
        });
      }
      revisions.add(commit.revision.revision);
      previousRevision = commit.revision.revision;
    }
  });
export type ProcedureTreeEditorBranchHistoryResult = z.infer<
  typeof procedureTreeEditorBranchHistoryResultSchema
>;

export const procedureTreeEditorCommentAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tree'), treeId: guideStepIdSchema }),
  z.strictObject({
    kind: z.literal('node'),
    treeId: guideStepIdSchema,
    nodeId: guideStepIdSchema,
  }),
  z.strictObject({
    kind: z.literal('track'),
    treeId: guideStepIdSchema,
    nodeId: guideStepIdSchema,
    modality: z.enum(['menu', 'shortcut', 'mcp']),
    trackId: guideStepIdSchema,
  }),
  z.strictObject({
    kind: z.literal('operation'),
    treeId: guideStepIdSchema,
    nodeId: guideStepIdSchema,
    modality: procedureOperationSearchModalitySchema,
    trackId: guideStepIdSchema.nullable(),
    operationId: guideStepIdSchema,
  }),
]);
export type ProcedureTreeEditorCommentAnchor = z.infer<
  typeof procedureTreeEditorCommentAnchorSchema
>;

export const procedureTreeEditorCommentSchema = z
  .strictObject({
    commentId: z.uuid(),
    branchId: z.uuid(),
    revision: procedureTreeEditorRevisionRefSchema,
    anchor: procedureTreeEditorCommentAnchorSchema,
    body: z.string().trim().min(1).max(4_000),
    createdAt: occurredAtSchema,
  })
  .superRefine((comment, context) => {
    if (comment.anchor.treeId !== comment.revision.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['anchor', 'treeId'],
        message: 'Comment anchor tree mismatch',
      });
    }
    if (comment.anchor.kind === 'operation') {
      const requiresTrack = comment.anchor.modality !== 'semantic';
      if (requiresTrack !== (comment.anchor.trackId !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['anchor', 'trackId'],
          message: 'Only semantic operations omit a track id',
        });
      }
    }
  });
export type ProcedureTreeEditorComment = z.infer<typeof procedureTreeEditorCommentSchema>;

export const procedureTreeEditorCommentCreateRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    requestId: z.uuid(),
    branchId: z.uuid(),
    revision: procedureTreeEditorRevisionRefSchema,
    anchor: procedureTreeEditorCommentAnchorSchema,
    body: z.string().trim().min(1).max(4_000),
    occurredAt: occurredAtSchema,
  })
  .superRefine((request, context) => {
    if (request.anchor.treeId !== request.revision.treeId) {
      context.addIssue({
        code: 'custom',
        path: ['anchor', 'treeId'],
        message: 'Comment anchor tree mismatch',
      });
    }
    if (request.anchor.kind === 'operation') {
      const requiresTrack = request.anchor.modality !== 'semantic';
      if (requiresTrack !== (request.anchor.trackId !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['anchor', 'trackId'],
          message: 'Only semantic operations omit a track id',
        });
      }
    }
  });
export type ProcedureTreeEditorCommentCreateRequest = z.infer<
  typeof procedureTreeEditorCommentCreateRequestSchema
>;

export const procedureTreeEditorCommentCreateResultSchema = z.strictObject({
  ...editorVersionShape,
  requestId: z.uuid(),
  result: z.enum(['accepted', 'duplicate']),
  comment: procedureTreeEditorCommentSchema,
  commentsAreTreeContent: z.literal(false),
});
export type ProcedureTreeEditorCommentCreateResult = z.infer<
  typeof procedureTreeEditorCommentCreateResultSchema
>;

export const procedureTreeEditorCommentListRequestSchema = z
  .strictObject({
    ...editorVersionShape,
    treeId: guideStepIdSchema,
    branchId: z.uuid(),
    revision: procedureTreeEditorRevisionRefSchema.optional(),
    anchor: procedureTreeEditorCommentAnchorSchema.optional(),
    afterCommentId: z.uuid().optional(),
    limit: cursorLimitSchema.optional(),
  })
  .refine(
    (request) =>
      (request.revision === undefined || request.revision.treeId === request.treeId) &&
      (request.anchor === undefined || request.anchor.treeId === request.treeId),
    { path: ['anchor', 'treeId'], message: 'Comment anchor tree mismatch' },
  );
export type ProcedureTreeEditorCommentListRequest = z.infer<
  typeof procedureTreeEditorCommentListRequestSchema
>;

export const procedureTreeEditorCommentListResultSchema = z.strictObject({
  ...editorVersionShape,
  comments: z.array(procedureTreeEditorCommentSchema),
  nextAfterCommentId: z.uuid().nullable(),
  commentsAreTreeContent: z.literal(false),
});
export type ProcedureTreeEditorCommentListResult = z.infer<
  typeof procedureTreeEditorCommentListResultSchema
>;

export const procedureTreeEditorParameterTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('action'), nodeId: guideStepIdSchema }),
  z.strictObject({
    kind: z.literal('semantic'),
    nodeId: guideStepIdSchema,
    operationId: guideStepIdSchema,
  }),
  z.strictObject({
    kind: z.literal('menu'),
    nodeId: guideStepIdSchema,
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
  }),
  z.strictObject({
    kind: z.literal('shortcut'),
    nodeId: guideStepIdSchema,
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
  }),
  z.strictObject({
    kind: z.literal('mcp'),
    nodeId: guideStepIdSchema,
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
  }),
]);
export type ProcedureTreeEditorParameterTarget = z.infer<
  typeof procedureTreeEditorParameterTargetSchema
>;

const parameterFieldBaseShape = {
  name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .max(180),
  label: z.string().min(1).max(180),
  description: z.string().max(2_000),
} as const;

const editableNumericFieldShape = {
  ...parameterFieldBaseShape,
  editable: z.literal(true),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
} as const;

const editableStringFieldShape = {
  ...parameterFieldBaseShape,
  kind: z.literal('string'),
  editable: z.literal(true),
  originalValue: z.string(),
  value: z.string(),
  pattern: z.string().min(1).max(1_000).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
} as const;

const enumScalarSchema = z.union([z.boolean(), z.number().finite(), z.string()]);

export const procedureTreeEditorParameterFieldSchema = z
  .union([
    z.strictObject({
      ...parameterFieldBaseShape,
      kind: z.literal('boolean'),
      editable: z.literal(true),
      originalValue: z.boolean(),
      value: z.boolean(),
    }),
    z.strictObject({
      ...editableNumericFieldShape,
      kind: z.literal('integer'),
      originalValue: z.number().int(),
      value: z.number().int(),
    }),
    z.strictObject({
      ...editableNumericFieldShape,
      kind: z.literal('number'),
      originalValue: z.number().finite(),
      value: z.number().finite(),
    }),
    z.strictObject({
      ...parameterFieldBaseShape,
      kind: z.literal('enum'),
      editable: z.literal(true),
      originalValue: enumScalarSchema,
      value: enumScalarSchema,
      enumValues: z.array(enumScalarSchema).min(1).max(100),
    }),
    z.strictObject({
      ...editableNumericFieldShape,
      kind: z.literal('integer_vector'),
      originalValue: z.array(z.number().int()).min(1).max(4),
      value: z.array(z.number().int()).min(1).max(4),
      vectorLength: z.number().int().min(1).max(4),
    }),
    z.strictObject({
      ...editableNumericFieldShape,
      kind: z.literal('number_vector'),
      originalValue: z.array(z.number().finite()).min(1).max(4),
      value: z.array(z.number().finite()).min(1).max(4),
      vectorLength: z.number().int().min(1).max(4),
    }),
    z.strictObject(editableStringFieldShape),
    z.strictObject({
      ...parameterFieldBaseShape,
      kind: z.literal('string'),
      editable: z.literal(false),
      originalValue: z.string(),
      value: z.string(),
    }),
    z.strictObject({
      ...parameterFieldBaseShape,
      kind: z.literal('structured'),
      editable: z.literal(false),
      originalValue: z.json(),
      value: z.json(),
    }),
  ])
  .superRefine((field, context) => {
    if (
      'minimum' in field &&
      'maximum' in field &&
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minimum'],
        message: 'Minimum cannot exceed maximum',
      });
    }
    if (field.kind === 'enum') {
      const allowed = new Set(field.enumValues.map(canonicalJson));
      if (
        !allowed.has(canonicalJson(field.originalValue)) ||
        !allowed.has(canonicalJson(field.value))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Enum values must be declared',
        });
      }
    }
    if (field.kind === 'integer_vector' || field.kind === 'number_vector') {
      if (
        field.originalValue.length !== field.vectorLength ||
        field.value.length !== field.vectorLength
      ) {
        context.addIssue({
          code: 'custom',
          path: ['vectorLength'],
          message: 'Vector length must be fixed',
        });
      }
    }
    if (
      field.kind === 'integer' ||
      field.kind === 'number' ||
      field.kind === 'integer_vector' ||
      field.kind === 'number_vector'
    ) {
      const originalValues = Array.isArray(field.originalValue)
        ? field.originalValue
        : [field.originalValue];
      const values = Array.isArray(field.value) ? field.value : [field.value];
      for (const [property, candidates] of [
        ['originalValue', originalValues],
        ['value', values],
      ] as const) {
        for (const [index, candidate] of candidates.entries()) {
          if (field.minimum !== undefined && candidate < field.minimum) {
            context.addIssue({
              code: 'custom',
              path: [property, ...(Array.isArray(field[property]) ? [index] : [])],
              message: 'Numeric value cannot be less than minimum',
            });
          }
          if (field.maximum !== undefined && candidate > field.maximum) {
            context.addIssue({
              code: 'custom',
              path: [property, ...(Array.isArray(field[property]) ? [index] : [])],
              message: 'Numeric value cannot exceed maximum',
            });
          }
        }
      }
    }
    if (field.kind === 'string' && field.editable) {
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        context.addIssue({
          code: 'custom',
          path: ['minLength'],
          message: 'Minimum length cannot exceed maximum length',
        });
      }
      let expression: RegExp | undefined;
      if (field.pattern !== undefined) {
        try {
          expression = new RegExp(field.pattern, 'u');
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['pattern'],
            message: 'Pattern must be a valid ECMAScript regular expression',
          });
        }
      }
      for (const property of ['originalValue', 'value'] as const) {
        const candidate = field[property];
        if (field.minLength !== undefined && [...candidate].length < field.minLength) {
          context.addIssue({
            code: 'custom',
            path: [property],
            message: 'String value cannot be shorter than minLength',
          });
        }
        if (field.maxLength !== undefined && [...candidate].length > field.maxLength) {
          context.addIssue({
            code: 'custom',
            path: [property],
            message: 'String value cannot be longer than maxLength',
          });
        }
        if (expression !== undefined && !expression.test(candidate)) {
          context.addIssue({
            code: 'custom',
            path: [property],
            message: 'String value must match pattern',
          });
        }
      }
    }
    if (
      ((field.kind === 'string' && !field.editable) || field.kind === 'structured') &&
      canonicalJson(field.originalValue) !== canonicalJson(field.value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Read-only fields cannot be changed',
      });
    }
  });
export type ProcedureTreeEditorParameterField = z.infer<
  typeof procedureTreeEditorParameterFieldSchema
>;

export const procedureTreeEditorParameterFormRequestSchema = z.strictObject({
  ...editorVersionShape,
  branchId: z.uuid(),
  revision: procedureTreeEditorRevisionRefSchema,
  target: procedureTreeEditorParameterTargetSchema,
});
export type ProcedureTreeEditorParameterFormRequest = z.infer<
  typeof procedureTreeEditorParameterFormRequestSchema
>;

export const procedureTreeEditorParameterFormResultSchema = z.strictObject({
  ...editorVersionShape,
  branchId: z.uuid(),
  revision: procedureTreeEditorRevisionRefSchema,
  target: procedureTreeEditorParameterTargetSchema,
  fields: z.array(procedureTreeEditorParameterFieldSchema).max(256),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureTreeEditorParameterFormResult = z.infer<
  typeof procedureTreeEditorParameterFormResultSchema
>;
