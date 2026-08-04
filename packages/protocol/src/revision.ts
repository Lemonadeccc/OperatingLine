import { z } from 'zod';

import {
  guideNodeNumberSchema,
  guidePlanSchema,
  guideProtocolVersionSchema,
  guideStepIdSchema,
} from './guide.js';
import { planningIntentSchema } from './planning.js';
import { catalogVersionSchema } from './version.js';

export const guideNodeReferenceSchema = z.strictObject({
  nodeId: guideStepIdSchema,
  nodeNumber: guideNodeNumberSchema,
});
export type GuideNodeReference = z.infer<typeof guideNodeReferenceSchema>;

export const guideRevisionThreadSchema = z
  .strictObject({
    threadId: z.uuid(),
    turn: z.number().int().positive(),
    parentRequestId: z.uuid().nullable(),
  })
  .superRefine((thread, context) => {
    if (thread.turn === 1 && thread.parentRequestId !== null) {
      context.addIssue({ code: 'custom', message: 'The first revision turn cannot have a parent' });
    }
    if (thread.turn > 1 && thread.parentRequestId === null) {
      context.addIssue({ code: 'custom', message: 'A continued revision turn requires a parent' });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { turn: { const: 1 } }, required: ['turn'] },
        then: { properties: { parentRequestId: { type: 'null' } } },
      },
      {
        if: { properties: { turn: { minimum: 2 } }, required: ['turn'] },
        then: { properties: { parentRequestId: { type: 'string', format: 'uuid' } } },
      },
    ],
  });
export type GuideRevisionThread = z.infer<typeof guideRevisionThreadSchema>;

export const guideRevisionRequestSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    requestId: z.uuid(),
    adapterId: z.string().min(1),
    catalogVersion: catalogVersionSchema,
    instanceId: z.uuid(),
    basePlan: guidePlanSchema,
    references: z.array(guideNodeReferenceSchema).min(1).max(8),
    message: z.string().trim().min(1).max(4_000),
    revisionThread: guideRevisionThreadSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((request, context) => {
    const thread = request.revisionThread;
    if (request.protocolVersion === '1.1.0' && thread === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Protocol 1.1 revision requests require revisionThread',
      });
      return;
    }
    if (thread?.turn === 1 && thread.threadId !== request.requestId) {
      context.addIssue({
        code: 'custom',
        message: 'The first revision turn must use requestId as threadId',
      });
    }
    if (thread?.parentRequestId === request.requestId) {
      context.addIssue({ code: 'custom', message: 'A revision request cannot parent itself' });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { protocolVersion: { const: '1.1.0' } },
          required: ['protocolVersion'],
        },
        then: { required: ['revisionThread'] },
      },
    ],
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
  planning: planningIntentSchema.optional(),
  plan: guidePlanSchema,
});
export type GuideReplanSubmission = z.infer<typeof guideReplanSubmissionSchema>;
