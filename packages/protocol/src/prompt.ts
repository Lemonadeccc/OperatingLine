import { z } from 'zod';

import { actionCatalogSchema, planningContextSchema } from './catalog.js';
import { catalogVersionSchema } from './version.js';

export const planningPromptRequestSchema = z.strictObject({
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema.optional(),
  goal: z.string().trim().min(1).max(10_000),
  planId: z.string().trim().min(1).max(180),
});
export type PlanningPromptRequest = z.infer<typeof planningPromptRequestSchema>;

export const planningPromptContextSchema = planningContextSchema.extend({
  goal: planningPromptRequestSchema.shape.goal,
  requestedPlanId: planningPromptRequestSchema.shape.planId,
  recommendedRevision: planningContextSchema.shape.recommendedRevision.unwrap(),
  catalog: actionCatalogSchema.extend({
    planningPhases: actionCatalogSchema.shape.planningPhases.unwrap(),
  }),
  qualityGate: planningContextSchema.shape.qualityGate.unwrap(),
});
export type PlanningPromptContext = z.infer<typeof planningPromptContextSchema>;

export const planningPromptFormatVersion = '1.0.0' as const;
export const planningPromptPacketSchema = z.strictObject({
  formatVersion: z.literal(planningPromptFormatVersion),
  context: planningPromptContextSchema,
  responseContract: z.strictObject({
    mediaType: z.literal('application/json'),
    schema: z.record(z.string(), z.json()),
  }),
  workflow: z.strictObject({
    evaluateToolName: z.literal('operatingline.planning.evaluate'),
    submitToolName: z.literal('operatingline.guide.propose'),
    instructions: z.array(z.string().min(1)).min(1),
  }),
  renderedPrompt: z.string().min(1),
});
export type PlanningPromptPacket = z.infer<typeof planningPromptPacketSchema>;
