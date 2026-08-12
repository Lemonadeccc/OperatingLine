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

export const guideParameterEditSchema = z.strictObject({
  nodeId: guideStepIdSchema,
  argumentName: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Argument names must use portable ASCII identifiers')
    .max(180),
  before: z.json(),
  after: z.json(),
});
export type GuideParameterEdit = z.infer<typeof guideParameterEditSchema>;

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
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

const guideRevisionSourceSchema = z.strictObject({
  sourceThreadId: z.uuid(),
  sourceRequestId: z.uuid(),
});

export const guideRevisionOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('revise') }),
  guideRevisionSourceSchema.extend({ kind: z.literal('fork') }),
  guideRevisionSourceSchema.extend({ kind: z.literal('merge') }),
]);
export type GuideRevisionOperation = z.infer<typeof guideRevisionOperationSchema>;

export const guideRevisionRequestSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    requestId: z.uuid(),
    adapterId: z.string().min(1),
    catalogVersion: catalogVersionSchema,
    instanceId: z.uuid(),
    basePlan: guidePlanSchema,
    references: z.array(guideNodeReferenceSchema).min(1).max(8),
    message: z.string().trim().max(4_000),
    parameterEdits: z.array(guideParameterEditSchema).min(1).max(64).optional(),
    revisionThread: guideRevisionThreadSchema.optional(),
    revisionOperation: guideRevisionOperationSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((request, context) => {
    const thread = request.revisionThread;
    if (request.protocolVersion !== '1.0.0' && thread === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Protocol 1.1+ revision requests require revisionThread',
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
    if (
      request.protocolVersion !== '1.3.0' &&
      request.protocolVersion !== '1.4.0' &&
      request.protocolVersion !== '1.5.0' &&
      request.parameterEdits !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameterEdits'],
        message: 'Structured parameter edits require guide protocol 1.3+',
      });
    }
    if (
      (request.protocolVersion === '1.4.0' || request.protocolVersion === '1.5.0') &&
      request.revisionOperation === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revisionOperation'],
        message: 'Protocol 1.4+ revision requests require an explicit operation',
      });
    }
    if (
      request.protocolVersion !== '1.4.0' &&
      request.protocolVersion !== '1.5.0' &&
      request.revisionOperation !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revisionOperation'],
        message: 'Explicit revision operations require guide protocol 1.4+',
      });
    }
    const operation = request.revisionOperation;
    if (operation?.kind === 'fork') {
      if (thread?.turn !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['revisionOperation', 'kind'],
          message: 'A fork must start a new revision thread at turn 1',
        });
      }
      if (operation.sourceThreadId === thread?.threadId) {
        context.addIssue({
          code: 'custom',
          path: ['revisionOperation', 'sourceThreadId'],
          message: 'A fork source must be a different revision thread',
        });
      }
    }
    if (operation?.kind === 'merge') {
      if (thread === undefined || thread.turn <= 1) {
        context.addIssue({
          code: 'custom',
          path: ['revisionOperation', 'kind'],
          message: 'A merge must continue an existing target revision thread',
        });
      }
      if (operation.sourceThreadId === thread?.threadId) {
        context.addIssue({
          code: 'custom',
          path: ['revisionOperation', 'sourceThreadId'],
          message: 'A merge source must be a different revision thread',
        });
      }
      if (request.parameterEdits !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['parameterEdits'],
          message: 'A deterministic branch merge cannot include parameter edits',
        });
      }
    }
    if (request.message.length === 0 && request.parameterEdits === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'A revision request requires a message or structured parameter edits',
      });
    }
    const references = new Set(request.references.map((reference) => reference.nodeId));
    const editKeys = new Set<string>();
    for (const [index, edit] of (request.parameterEdits ?? []).entries()) {
      const key = `${edit.nodeId}\u0000${edit.argumentName}`;
      if (editKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['parameterEdits', index],
          message: `Structured parameter edit repeats ${edit.nodeId}.${edit.argumentName}`,
        });
      }
      editKeys.add(key);
      if (!references.has(edit.nodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['parameterEdits', index, 'nodeId'],
          message: 'Structured parameter edits must target directly referenced nodes',
        });
      }
      if (canonicalJson(edit.before) === canonicalJson(edit.after)) {
        context.addIssue({
          code: 'custom',
          path: ['parameterEdits', index, 'after'],
          message: 'Structured parameter edits must change the argument value',
        });
      }
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            protocolVersion: { enum: ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0'] },
          },
          required: ['protocolVersion'],
        },
        then: { required: ['revisionThread'] },
      },
      {
        if: {
          properties: { protocolVersion: { enum: ['1.3.0', '1.4.0', '1.5.0'] } },
          required: ['protocolVersion'],
        },
        then: {
          anyOf: [
            { properties: { message: { minLength: 1 } }, required: ['message'] },
            { required: ['parameterEdits'] },
          ],
        },
        else: {
          properties: { message: { minLength: 1 } },
          not: { required: ['parameterEdits'] },
        },
      },
      {
        if: {
          properties: { protocolVersion: { enum: ['1.4.0', '1.5.0'] } },
          required: ['protocolVersion'],
        },
        then: { required: ['revisionOperation'] },
        else: { not: { required: ['revisionOperation'] } },
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
  generationRequestId: z.uuid().optional(),
  requestId: z.uuid(),
  catalogVersion: catalogVersionSchema,
  planning: planningIntentSchema.optional(),
  plan: guidePlanSchema,
});
export type GuideReplanSubmission = z.infer<typeof guideReplanSubmissionSchema>;
