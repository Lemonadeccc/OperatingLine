import { z } from 'zod';

import { actionCatalogSchema } from './catalog.js';
import { guideProtocolVersionSchema } from './guide.js';

export const supportedEvalExportFormatVersions = ['1.0.0', '1.1.0'] as const;
export const evalExportFormatVersion = '1.1.0' as const;
export const evalExportFormatVersionSchema = z.enum(supportedEvalExportFormatVersions);
export const currentEvalExportFormatVersionSchema = z.literal(evalExportFormatVersion);

const evalExportRequestBase = {
  targetAdapterId: z.string().trim().min(1).max(180),
  planId: z.string().trim().min(1).max(180),
  instanceId: z.uuid().optional(),
  limit: z.coerce.number().int().positive().max(1_000).default(250),
};

const evalExportFirstPageRequestSchema = z.strictObject({
  ...evalExportRequestBase,
  afterSequence: z.coerce.number().pipe(z.literal(0)).default(0),
  snapshotId: z.never().optional(),
  snapshotUpperSequence: z.never().optional(),
});

const evalExportContinuationRequestSchema = z
  .strictObject({
    ...evalExportRequestBase,
    afterSequence: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    snapshotId: z.uuid(),
    snapshotUpperSequence: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine((request) => request.afterSequence <= request.snapshotUpperSequence, {
    path: ['afterSequence'],
    message: 'afterSequence cannot exceed snapshotUpperSequence',
  });

export const evalExportRequestSchema = z.union([
  evalExportFirstPageRequestSchema,
  evalExportContinuationRequestSchema,
]);
export type EvalExportRequest = z.infer<typeof evalExportRequestSchema>;

export const evalExecutionEventSchema = z.strictObject({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  id: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.unknown(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type EvalExecutionEvent = z.infer<typeof evalExecutionEventSchema>;

const evalCountMapSchema = z.record(z.string().min(1), z.number().int().nonnegative());

const evalExportBundleCommon = {
  protocolVersion: guideProtocolVersionSchema,
  exportId: z.uuid(),
  exportedAt: z.iso.datetime({ offset: true }),
  scope: z.strictObject({
    targetAdapterId: z.string().min(1),
    planId: z.string().min(1),
    instanceId: z.uuid().nullable(),
  }),
  catalogs: z.array(actionCatalogSchema).min(1),
  events: z.array(evalExecutionEventSchema),
  summary: z.strictObject({
    matchedEventCount: z.number().int().nonnegative(),
    eventTypeCounts: evalCountMapSchema,
    transitionCounts: evalCountMapSchema,
    decisionCounts: evalCountMapSchema,
  }),
  dataHandling: z.strictObject({
    redaction: z.literal('none'),
    containsPotentiallySensitiveContent: z.literal(true),
    warning: z.string().min(1),
  }),
  integrity: z.strictObject({
    algorithm: z.literal('sha256'),
    canonicalization: z.literal('operatingline-json-sort-v1'),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
};

/** Historical bundle parser retained so stored 1.0 evidence remains readable. */
export const legacyEvalExportBundleSchema = z.strictObject({
  ...evalExportBundleCommon,
  formatVersion: z.literal('1.0.0'),
  page: z.strictObject({
    afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextAfterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hasMore: z.boolean(),
  }),
});
export type LegacyEvalExportBundle = z.infer<typeof legacyEvalExportBundleSchema>;

/** Current frozen-snapshot bundle emitted by the orchestrator. */
export const currentEvalExportBundleSchema = z.strictObject({
  ...evalExportBundleCommon,
  formatVersion: currentEvalExportFormatVersionSchema,
  page: z.strictObject({
    snapshotId: z.uuid(),
    snapshotUpperSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextAfterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hasMore: z.boolean(),
  }),
});
export type CurrentEvalExportBundle = z.infer<typeof currentEvalExportBundleSchema>;

/** Read schema for both historical and current evidence. */
export const evalExportBundleSchema = z.discriminatedUnion('formatVersion', [
  legacyEvalExportBundleSchema,
  currentEvalExportBundleSchema,
]);
export type EvalExportBundle = z.infer<typeof evalExportBundleSchema>;
