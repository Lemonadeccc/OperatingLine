import { z } from 'zod';

import { guideStepIdSchema, guideStepSchema } from './guide.js';
import {
  managedPrimitiveActionNames,
  managedPrimitiveActionNameSchema,
} from './managed-primitive-action.js';

export const companionActionExecutionFormatVersion = '1.0.0' as const;
export const companionActionExecutionFormatVersionSchema = z.literal(
  companionActionExecutionFormatVersion,
);

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });

const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});

const targetSchema = z.strictObject({
  adapterId: z.literal('blender'),
  instanceId: z.uuid(),
});

const planReferenceSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});

const deliveryIdentityShape = {
  formatVersion: companionActionExecutionFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: planReferenceSchema,
  planContentSha256: contentSha256Schema,
  executionId: z.uuid(),
  expectedState: expectedStateSchema,
} as const;

const managedPrimitiveStepSchema = guideStepSchema.superRefine((step, context) => {
  if (
    step.action?.adapterId !== 'blender' ||
    !managedPrimitiveActionNameSchema.safeParse(step.action.name).success
  ) {
    context.addIssue({
      code: 'custom',
      path: ['action'],
      message: 'Action execution delivery is restricted to managed Blender primitive actions',
    });
  }
});

const managedPrimitiveStepJsonSchemaCondition = {
  properties: {
    step: {
      properties: {
        action: {
          type: 'object',
          properties: {
            adapterId: { const: 'blender' },
            name: { enum: [...managedPrimitiveActionNames] },
          },
          required: ['adapterId', 'name'],
        },
      },
      required: ['action'],
    },
  },
  required: ['step'],
} as const;

export const companionActionExecutionCreateRequestSchema = z.strictObject({
  formatVersion: companionActionExecutionFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  expectedState: expectedStateSchema,
});
export type CompanionActionExecutionCreateRequest = z.infer<
  typeof companionActionExecutionCreateRequestSchema
>;

export const companionActionExecutionStatusRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type CompanionActionExecutionStatusRequest = z.infer<
  typeof companionActionExecutionStatusRequestSchema
>;

export const companionActionExecutionDeliverySchema = z
  .strictObject({
    ...deliveryIdentityShape,
    deliveryId: z.uuid(),
    step: managedPrimitiveStepSchema,
    requestedAt: timestampSchema,
    dispatchedAt: timestampSchema,
  })
  .meta({
    allOf: [managedPrimitiveStepJsonSchemaCondition],
  });
export type CompanionActionExecutionDelivery = z.infer<
  typeof companionActionExecutionDeliverySchema
>;

const executionResultStatusSchema = z.enum(['succeeded', 'failed', 'rejected']);

export const companionActionExecutionResultSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    deliveryId: z.uuid(),
    stepId: guideStepIdSchema,
    status: executionResultStatusSchema,
    report: expectedStateSchema.nullable(),
    error: z.string().min(1).nullable(),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (result.status === 'succeeded' && (result.report === null || result.error !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'A succeeded action execution requires a report and no error',
      });
    }
    if (result.status === 'failed' && (result.report === null || result.error === null)) {
      context.addIssue({
        code: 'custom',
        message: 'A failed action execution requires both a report and an error',
      });
    }
    if (result.status === 'rejected' && (result.report !== null || result.error === null)) {
      context.addIssue({
        code: 'custom',
        message: 'A rejected action execution requires no report and an error',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { status: { const: 'succeeded' } }, required: ['status'] },
        then: {
          properties: { report: { type: 'object' }, error: { type: 'null' } },
        },
      },
      {
        if: { properties: { status: { const: 'failed' } }, required: ['status'] },
        then: {
          properties: { report: { type: 'object' }, error: { type: 'string', minLength: 1 } },
        },
      },
      {
        if: { properties: { status: { const: 'rejected' } }, required: ['status'] },
        then: {
          properties: { report: { type: 'null' }, error: { type: 'string', minLength: 1 } },
        },
      },
    ],
  });
export type CompanionActionExecutionResult = z.infer<typeof companionActionExecutionResultSchema>;

const actionExecutionStatusValueSchema = z.enum([
  'queued',
  'dispatched',
  'succeeded',
  'failed',
  'rejected',
  'recovery_required',
]);

export const companionActionExecutionStatusSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    deliveryId: z.uuid().optional(),
    step: managedPrimitiveStepSchema,
    requestedAt: timestampSchema,
    dispatchedAt: timestampSchema.optional(),
    status: actionExecutionStatusValueSchema,
    result: companionActionExecutionResultSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((execution, context) => {
    const delivered = execution.deliveryId !== undefined && execution.dispatchedAt !== undefined;
    const hasDeliveryEvidence =
      execution.deliveryId !== undefined || execution.dispatchedAt !== undefined;
    const terminal =
      execution.status === 'succeeded' ||
      execution.status === 'failed' ||
      execution.status === 'rejected';

    if (execution.status === 'queued' && (hasDeliveryEvidence || execution.result !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'A queued execution cannot be delivered or final',
      });
      return;
    }
    if (
      (execution.status === 'dispatched' || execution.status === 'recovery_required') &&
      (!delivered || execution.result !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${execution.status} requires delivery evidence and no terminal result`,
      });
      return;
    }
    if (!terminal) return;
    if (
      !delivered ||
      execution.result === undefined ||
      execution.result.status !== execution.status
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'A terminal execution requires matching delivery evidence and result',
      });
      return;
    }

    const result = execution.result;
    const identitiesMatch =
      result.formatVersion === execution.formatVersion &&
      result.requestId === execution.requestId &&
      result.replayId === execution.replayId &&
      result.deliveryId === execution.deliveryId &&
      result.target.adapterId === execution.target.adapterId &&
      result.target.instanceId === execution.target.instanceId &&
      result.proposalId === execution.proposalId &&
      result.plan.id === execution.plan.id &&
      result.plan.revision === execution.plan.revision &&
      result.planContentSha256 === execution.planContentSha256 &&
      result.executionId === execution.executionId &&
      result.expectedState.reportId === execution.expectedState.reportId &&
      result.expectedState.sequence === execution.expectedState.sequence &&
      result.stepId === execution.step.id;
    if (!identitiesMatch) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'The terminal result must mirror the immutable delivery identity',
      });
    }
  })
  .meta({
    allOf: [
      managedPrimitiveStepJsonSchemaCondition,
      {
        if: { properties: { status: { const: 'queued' } }, required: ['status'] },
        then: {
          not: {
            anyOf: [
              { required: ['deliveryId'] },
              { required: ['dispatchedAt'] },
              { required: ['result'] },
            ],
          },
        },
      },
      {
        if: {
          properties: { status: { enum: ['dispatched', 'recovery_required'] } },
          required: ['status'],
        },
        then: {
          required: ['deliveryId', 'dispatchedAt'],
          not: { required: ['result'] },
        },
      },
      ...(['succeeded', 'failed', 'rejected'] as const).map((status) => ({
        if: { properties: { status: { const: status } }, required: ['status'] },
        then: {
          required: ['deliveryId', 'dispatchedAt', 'result'],
          properties: {
            result: {
              properties: { status: { const: status } },
              required: ['status'],
            },
          },
        },
      })),
    ],
  });
export type CompanionActionExecutionStatus = z.infer<typeof companionActionExecutionStatusSchema>;

export const companionActionPollRequestSchema = z.strictObject({
  adapterId: z.literal('blender'),
  instanceId: z.uuid(),
});
export type CompanionActionPollRequest = z.infer<typeof companionActionPollRequestSchema>;

export const companionActionPollDeliverySchema = z.strictObject({
  request: companionActionExecutionDeliverySchema.nullable(),
});
export type CompanionActionPollDelivery = z.infer<typeof companionActionPollDeliverySchema>;

export const companionActionResultAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
export type CompanionActionResultAck = z.infer<typeof companionActionResultAckSchema>;
