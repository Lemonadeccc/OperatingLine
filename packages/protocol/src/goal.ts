import { z } from 'zod';

import { guideProtocolVersion } from './guide.js';
import { planningPromptRequestSchema } from './prompt.js';
import { catalogVersionSchema } from './version.js';

export const guideGoalRequestSchema = z.strictObject({
  protocolVersion: z.enum(['1.1.0', '1.2.0', guideProtocolVersion]),
  requestId: z.uuid(),
  adapterId: planningPromptRequestSchema.shape.targetAdapterId,
  catalogVersion: catalogVersionSchema,
  instanceId: z.uuid(),
  goal: planningPromptRequestSchema.shape.goal,
  planId: planningPromptRequestSchema.shape.planId,
  occurredAt: z.iso.datetime({ offset: true }),
});
export type GuideGoalRequest = z.infer<typeof guideGoalRequestSchema>;

export const guideGoalRequestAcknowledgementSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
  requestId: z.uuid(),
});
export type GuideGoalRequestAcknowledgement = z.infer<typeof guideGoalRequestAcknowledgementSchema>;

export const guideGoalRequestListSchema = z.strictObject({
  targetAdapterId: planningPromptRequestSchema.shape.targetAdapterId.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type GuideGoalRequestList = z.infer<typeof guideGoalRequestListSchema>;

export const guideGoalPromptRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type GuideGoalPromptRequest = z.infer<typeof guideGoalPromptRequestSchema>;
