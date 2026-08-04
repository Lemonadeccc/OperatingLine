import { z } from 'zod';

import { actionCatalogSchema } from './catalog.js';
import { guideProtocolVersionSchema } from './guide.js';

export const evalExportFormatVersion = '1.0.0' as const;
export const evalExportFormatVersionSchema = z.literal(evalExportFormatVersion);

export const evalExportRequestSchema = z.strictObject({
  targetAdapterId: z.string().trim().min(1).max(180),
  planId: z.string().trim().min(1).max(180),
  instanceId: z.uuid().optional(),
  afterSequence: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().positive().max(1_000).default(250),
});
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

export const evalExportBundleSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  formatVersion: evalExportFormatVersionSchema,
  exportId: z.uuid(),
  exportedAt: z.iso.datetime({ offset: true }),
  scope: z.strictObject({
    targetAdapterId: z.string().min(1),
    planId: z.string().min(1),
    instanceId: z.uuid().nullable(),
  }),
  catalogs: z.array(actionCatalogSchema).min(1),
  events: z.array(evalExecutionEventSchema),
  page: z.strictObject({
    afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextAfterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hasMore: z.boolean(),
  }),
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
});
export type EvalExportBundle = z.infer<typeof evalExportBundleSchema>;
