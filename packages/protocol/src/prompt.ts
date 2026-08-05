import { z } from 'zod';

import {
  actionCatalogJsonSchemaMetadata,
  actionCatalogSchema,
  planningContextJsonSchemaMetadata,
  planningContextSchema,
} from './catalog.js';
import { catalogVersionSchema } from './version.js';

export const planningPromptRequestSchema = z.strictObject({
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema.optional(),
  goal: z.string().trim().min(1).max(10_000),
  planId: z.string().trim().min(1).max(180),
});
export type PlanningPromptRequest = z.infer<typeof planningPromptRequestSchema>;

export const planningPromptContextSchema = planningContextSchema
  .safeExtend({
    goal: planningPromptRequestSchema.shape.goal,
    requestedPlanId: planningPromptRequestSchema.shape.planId,
    recommendedRevision: planningContextSchema.shape.recommendedRevision.unwrap(),
    catalog: actionCatalogSchema
      .extend({
        planningPhases: actionCatalogSchema.shape.planningPhases.unwrap(),
      })
      .meta(actionCatalogJsonSchemaMetadata),
    qualityGate: planningContextSchema.shape.qualityGate.unwrap(),
  })
  .meta(planningContextJsonSchemaMetadata);
export type PlanningPromptContext = z.infer<typeof planningPromptContextSchema>;

export const supportedPlanningPromptFormatVersions = ['1.0.0', '1.1.0'] as const;
export const planningPromptFormatVersion = '1.1.0' as const;
export const planningPromptFormatVersionSchema = z.enum(supportedPlanningPromptFormatVersions);
const planningPromptPacketJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: {
          context: {
            type: 'object',
            properties: {
              catalog: { type: 'object', required: ['semanticCapabilities'] },
            },
            required: ['catalog'],
          },
        },
        required: ['context'],
      },
      then: { type: 'object', properties: { formatVersion: { const: '1.1.0' } } },
      else: { type: 'object', properties: { formatVersion: { const: '1.0.0' } } },
    },
  ],
} as const;

export const planningPromptPacketSchema = z
  .strictObject({
    formatVersion: planningPromptFormatVersionSchema,
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
  })
  .superRefine((packet, context) => {
    const expectedFormatVersion =
      packet.context.catalog.semanticCapabilities === undefined
        ? '1.0.0'
        : planningPromptFormatVersion;
    if (packet.formatVersion !== expectedFormatVersion) {
      context.addIssue({
        code: 'custom',
        path: ['formatVersion'],
        message: 'Planning packet format must be 1.1.0 if and only if semantic capabilities exist',
      });
    }
  })
  .meta(planningPromptPacketJsonSchemaMetadata);
export type PlanningPromptPacket = z.infer<typeof planningPromptPacketSchema>;
