import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const guideNodeNumberPattern = /^[1-9]\d*(?:\.[1-9]\d*)*$/;
export const guideNodeReferenceSchema = z.strictObject({
  nodeId: guideStepIdSchema,
  nodeNumber: z
    .string()
    .regex(guideNodeNumberPattern, 'Node numbers must use dotted positive integers'),
});
export type GuideNodeReference = z.infer<typeof guideNodeReferenceSchema>;

export const guideRevisionRequestSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  requestId: z.uuid(),
  adapterId: z.string().min(1),
  catalogVersion: catalogVersionSchema,
  instanceId: z.uuid(),
  basePlan: guidePlanSchema,
  references: z.array(guideNodeReferenceSchema).min(1).max(8),
  message: z.string().trim().min(1).max(4_000),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type GuideRevisionRequest = z.infer<typeof guideRevisionRequestSchema>;

export const guideRevisionRequestListSchema = z.strictObject({
  targetAdapterId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type GuideRevisionRequestList = z.infer<typeof guideRevisionRequestListSchema>;

export const guideReplanSubmissionSchema = z.strictObject({
  requestId: z.uuid(),
  catalogVersion: catalogVersionSchema,
  plan: guidePlanSchema,
});
export type GuideReplanSubmission = z.infer<typeof guideReplanSubmissionSchema>;
