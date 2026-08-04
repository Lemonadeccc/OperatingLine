import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { guideProposalSchema } from './proposal.js';

export const companionGuideRequestSchema = z
  .strictObject({
    adapterId: z.string().min(1),
    instanceId: z.uuid(),
    knownPlanId: z.string().min(1).optional(),
    knownRevision: z.coerce.number().int().positive().optional(),
    knownProposalId: z.uuid().optional(),
  })
  .meta({
    dependentRequired: {
      knownPlanId: ['knownRevision'],
      knownRevision: ['knownPlanId'],
    },
  })
  .superRefine((request, context) => {
    if ((request.knownPlanId === undefined) !== (request.knownRevision === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'knownPlanId and knownRevision must be provided together',
      });
    }
  });
export type CompanionGuideRequest = z.infer<typeof companionGuideRequestSchema>;

export const companionGuideDeliverySchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  plan: guidePlanSchema.nullable(),
  proposal: guideProposalSchema.nullable(),
});
export type CompanionGuideDelivery = z.infer<typeof companionGuideDeliverySchema>;

export const companionPhaseSchema = z.enum(['idle', 'ready', 'running', 'completed', 'error']);
export type CompanionPhase = z.infer<typeof companionPhaseSchema>;

export const companionTransitionSchema = z.enum([
  'connected',
  'plan_loaded',
  'walkthrough_started',
  'step_succeeded',
  'step_rolled_back',
  'error',
]);
export type CompanionTransition = z.infer<typeof companionTransitionSchema>;

export const companionObservationSchema = z.strictObject({
  kind: z.string().min(1),
  satisfied: z.boolean(),
  details: z.record(z.string(), z.unknown()),
});
export type CompanionObservation = z.infer<typeof companionObservationSchema>;

const companionPlanReferenceSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});

export const companionStateReportSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    reportId: z.uuid(),
    sequence: z.number().int().positive(),
    adapterId: z.string().min(1),
    instanceId: z.uuid(),
    companionVersion: z.string().min(1),
    hostVersion: z.string().min(1),
    plan: companionPlanReferenceSchema.nullable(),
    phase: companionPhaseSchema,
    activeStepId: guideStepIdSchema.nullable(),
    completedStepIds: z
      .array(guideStepIdSchema)
      .meta({ uniqueItems: true })
      .refine((stepIds) => new Set(stepIds).size === stepIds.length, {
        message: 'completedStepIds must contain unique step ids',
      }),
    transition: companionTransitionSchema,
    stepId: guideStepIdSchema.nullable(),
    observations: z.array(companionObservationSchema),
    error: z.string().min(1).nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            transition: { enum: ['step_succeeded', 'step_rolled_back'] },
          },
        },
        then: { properties: { stepId: { type: 'string' } } },
      },
      {
        if: { properties: { transition: { const: 'error' } } },
        then: { properties: { error: { type: 'string' } } },
      },
      {
        if: { properties: { phase: { const: 'error' } } },
        then: { properties: { error: { type: 'string' } } },
      },
      {
        if: { properties: { error: { type: 'string' } } },
        then: {
          anyOf: [
            { properties: { transition: { const: 'error' } } },
            { properties: { phase: { const: 'error' } } },
          ],
        },
      },
      {
        if: { properties: { phase: { enum: ['ready', 'running', 'completed'] } } },
        then: { properties: { plan: { type: 'object' } } },
      },
      {
        if: {
          properties: {
            transition: {
              enum: ['plan_loaded', 'walkthrough_started', 'step_succeeded', 'step_rolled_back'],
            },
          },
        },
        then: { properties: { plan: { type: 'object' } } },
      },
      {
        if: { properties: { activeStepId: { type: 'string' } } },
        then: { properties: { plan: { type: 'object' } } },
      },
    ],
  })
  .superRefine((report, context) => {
    if (
      (report.transition === 'step_succeeded' || report.transition === 'step_rolled_back') &&
      report.stepId === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stepId'],
        message: `${report.transition} requires stepId`,
      });
    }
    if ((report.transition === 'error' || report.phase === 'error') && report.error === null) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'error transition and phase require an error message',
      });
    }
    if (report.transition !== 'error' && report.phase !== 'error' && report.error !== null) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'error details are only valid for an error transition or phase',
      });
    }
    if (
      (report.phase === 'ready' || report.phase === 'running' || report.phase === 'completed') &&
      report.plan === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['plan'],
        message: 'non-idle companion phases require a plan reference',
      });
    }
    if (
      report.transition !== 'connected' &&
      report.transition !== 'error' &&
      report.plan === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['plan'],
        message: `${report.transition} requires a plan reference`,
      });
    }
    if (report.activeStepId !== null && report.plan === null) {
      context.addIssue({
        code: 'custom',
        path: ['activeStepId'],
        message: 'activeStepId requires a plan reference',
      });
    }
  });
export type CompanionStateReport = z.infer<typeof companionStateReportSchema>;
