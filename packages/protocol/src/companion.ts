import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { guideProposalSchema } from './proposal.js';

const companionContentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const companionGuideRequestSchema = z
  .strictObject({
    adapterId: z.string().min(1),
    instanceId: z.uuid(),
    knownPlanId: z.string().min(1).optional(),
    knownRevision: z.coerce.number().int().positive().optional(),
    knownPlanContentSha256: companionContentSha256Schema.optional(),
    knownProposalId: z.uuid().optional(),
  })
  .meta({
    dependentRequired: {
      knownPlanId: ['knownRevision', 'knownPlanContentSha256'],
      knownRevision: ['knownPlanId', 'knownPlanContentSha256'],
      knownPlanContentSha256: ['knownPlanId', 'knownRevision'],
    },
  })
  .superRefine((request, context) => {
    const knownPlanFields = [
      request.knownPlanId,
      request.knownRevision,
      request.knownPlanContentSha256,
    ];
    const providedKnownPlanFields = knownPlanFields.filter((value) => value !== undefined).length;
    if (providedKnownPlanFields !== 0 && providedKnownPlanFields !== knownPlanFields.length) {
      context.addIssue({
        code: 'custom',
        message: 'knownPlanId, knownRevision, and knownPlanContentSha256 must be provided together',
      });
    }
  });
export type CompanionGuideRequest = z.infer<typeof companionGuideRequestSchema>;

export const companionGuideDeliverySchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    plan: guidePlanSchema.nullable(),
    planContentSha256: companionContentSha256Schema.nullable(),
    proposal: guideProposalSchema.nullable(),
    proposalPlanContentSha256: companionContentSha256Schema.nullable(),
  })
  .meta({
    allOf: [
      {
        if: { properties: { plan: { type: 'null' } }, required: ['plan'] },
        then: { properties: { planContentSha256: { type: 'null' } } },
        else: { properties: { planContentSha256: { type: 'string' } } },
      },
      {
        if: { properties: { proposal: { type: 'null' } }, required: ['proposal'] },
        then: { properties: { proposalPlanContentSha256: { type: 'null' } } },
        else: { properties: { proposalPlanContentSha256: { type: 'string' } } },
      },
    ],
  })
  .superRefine((delivery, context) => {
    if ((delivery.plan === null) !== (delivery.planContentSha256 === null)) {
      context.addIssue({
        code: 'custom',
        path: ['planContentSha256'],
        message: 'planContentSha256 must be present exactly when plan is present',
      });
    }
    if ((delivery.proposal === null) !== (delivery.proposalPlanContentSha256 === null)) {
      context.addIssue({
        code: 'custom',
        path: ['proposalPlanContentSha256'],
        message: 'proposalPlanContentSha256 must be present exactly when proposal is present',
      });
    }
  });
export type CompanionGuideDelivery = z.infer<typeof companionGuideDeliverySchema>;

export const companionPhaseSchema = z.enum([
  'idle',
  'ready',
  'running',
  'blocked',
  'completed',
  'error',
]);
export type CompanionPhase = z.infer<typeof companionPhaseSchema>;

export const companionTransitionSchema = z.enum([
  'connected',
  'plan_loaded',
  'walkthrough_started',
  'step_succeeded',
  'step_observation_failed',
  'observation_recovered',
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

export const companionObservationGateSchema = z
  .strictObject({
    stepId: guideStepIdSchema,
    status: z.enum(['failed_rolled_back', 'repair_required', 'rollback_failed', 'recovered']),
    failureStrategy: z.enum(['rollback_step', 'retain_for_repair']),
    message: z.string().min(1),
  })
  .superRefine((gate, context) => {
    if (
      (gate.status === 'failed_rolled_back' || gate.status === 'rollback_failed') &&
      gate.failureStrategy !== 'rollback_step'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureStrategy'],
        message: `${gate.status} requires the rollback_step failure strategy`,
      });
    }
    if (gate.status === 'repair_required' && gate.failureStrategy !== 'retain_for_repair') {
      context.addIssue({
        code: 'custom',
        path: ['failureStrategy'],
        message: 'repair_required requires the retain_for_repair failure strategy',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            status: { enum: ['failed_rolled_back', 'rollback_failed'] },
          },
          required: ['status'],
        },
        then: { properties: { failureStrategy: { const: 'rollback_step' } } },
      },
      {
        if: {
          properties: { status: { const: 'repair_required' } },
          required: ['status'],
        },
        then: {
          properties: { failureStrategy: { const: 'retain_for_repair' } },
        },
      },
    ],
  });
export type CompanionObservationGate = z.infer<typeof companionObservationGateSchema>;

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
    planContentSha256: companionContentSha256Schema.nullable(),
    executionId: z.uuid().nullable(),
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
    observationGate: companionObservationGateSchema.nullable().optional(),
    error: z.string().min(1).nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            transition: {
              enum: [
                'step_succeeded',
                'step_observation_failed',
                'observation_recovered',
                'step_rolled_back',
              ],
            },
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
        if: {
          properties: { phase: { enum: ['ready', 'running', 'blocked', 'completed'] } },
        },
        then: {
          properties: {
            plan: { type: 'object' },
            planContentSha256: { type: 'string' },
          },
        },
      },
      {
        if: {
          properties: {
            transition: {
              enum: [
                'plan_loaded',
                'walkthrough_started',
                'step_succeeded',
                'step_observation_failed',
                'observation_recovered',
                'step_rolled_back',
              ],
            },
          },
        },
        then: {
          properties: {
            plan: { type: 'object' },
            planContentSha256: { type: 'string' },
          },
        },
      },
      {
        if: {
          properties: { protocolVersion: { const: '1.2.0' } },
          required: ['protocolVersion'],
        },
        then: { required: ['observationGate'] },
        else: { not: { required: ['observationGate'] } },
      },
      {
        if: { properties: { phase: { const: 'blocked' } }, required: ['phase'] },
        then: {
          required: ['observationGate'],
          properties: {
            observationGate: {
              type: 'object',
              properties: {
                status: { enum: ['repair_required', 'rollback_failed'] },
              },
            },
          },
        },
      },
      {
        if: {
          properties: { transition: { const: 'step_observation_failed' } },
          required: ['transition'],
        },
        then: {
          required: ['observationGate'],
          properties: {
            observationGate: { type: 'object' },
            observations: {
              minItems: 1,
              contains: {
                type: 'object',
                properties: { satisfied: { const: false } },
                required: ['satisfied'],
              },
            },
          },
        },
      },
      {
        if: {
          properties: { transition: { const: 'observation_recovered' } },
          required: ['transition'],
        },
        then: {
          required: ['observationGate'],
          properties: {
            observationGate: {
              type: 'object',
              properties: { status: { const: 'recovered' } },
            },
            observations: {
              minItems: 1,
              items: {
                type: 'object',
                properties: { satisfied: { const: true } },
                required: ['satisfied'],
              },
            },
          },
        },
      },
      {
        if: { properties: { activeStepId: { type: 'string' } } },
        then: { properties: { plan: { type: 'object' } } },
      },
      {
        if: { properties: { plan: { type: 'null' } }, required: ['plan'] },
        then: {
          properties: {
            planContentSha256: { type: 'null' },
            executionId: { type: 'null' },
          },
        },
        else: { properties: { planContentSha256: { type: 'string' } } },
      },
      {
        if: { properties: { executionId: { type: 'string' } } },
        then: {
          properties: {
            plan: { type: 'object' },
            planContentSha256: { type: 'string' },
          },
        },
      },
    ],
  })
  .superRefine((report, context) => {
    if (
      [
        'step_succeeded',
        'step_observation_failed',
        'observation_recovered',
        'step_rolled_back',
      ].includes(report.transition) &&
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
      ['ready', 'running', 'blocked', 'completed'].includes(report.phase) &&
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
    if ((report.plan === null) !== (report.planContentSha256 === null)) {
      context.addIssue({
        code: 'custom',
        path: ['planContentSha256'],
        message: 'planContentSha256 must be present exactly when plan is present',
      });
    }
    if (report.plan === null && report.executionId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'executionId requires a plan reference and planContentSha256',
      });
    }
    if (report.protocolVersion === '1.2.0' && report.observationGate === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate'],
        message: 'Protocol 1.2 reports require an explicit observationGate field',
      });
    }
    if (report.protocolVersion !== '1.2.0' && report.observationGate !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate'],
        message: 'Observation gate reports require protocol 1.2',
      });
    }
    const gate = report.observationGate;
    if (report.phase === 'blocked') {
      if (
        gate === undefined ||
        gate === null ||
        (gate.status !== 'repair_required' && gate.status !== 'rollback_failed')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observationGate'],
          message: 'A blocked phase requires a blocking observation gate',
        });
      }
    } else if (
      gate !== undefined &&
      gate !== null &&
      (gate.status === 'repair_required' || gate.status === 'rollback_failed')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'A blocking observation gate requires the blocked phase',
      });
    }
    if (report.transition === 'step_observation_failed') {
      if (gate === undefined || gate === null || gate.status === 'recovered') {
        context.addIssue({
          code: 'custom',
          path: ['observationGate'],
          message: 'step_observation_failed requires a failed observation gate',
        });
      }
      if (
        report.observations.length === 0 ||
        report.observations.every((observation) => observation.satisfied)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'step_observation_failed requires an unsatisfied observation',
        });
      }
    }
    if (
      gate !== undefined &&
      gate !== null &&
      gate.status === 'failed_rolled_back' &&
      report.transition !== 'step_observation_failed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transition'],
        message: 'failed_rolled_back is only valid on step_observation_failed',
      });
    }
    if (
      gate !== undefined &&
      gate !== null &&
      gate.status === 'recovered' &&
      report.transition !== 'observation_recovered'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transition'],
        message: 'recovered is only valid on observation_recovered',
      });
    }
    if (
      report.transition === 'observation_recovered' &&
      (gate === undefined || gate === null || gate.status !== 'recovered')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate'],
        message: 'observation_recovered requires a recovered observation gate',
      });
    }
    if (
      report.transition === 'observation_recovered' &&
      (report.observations.length === 0 ||
        report.observations.some((observation) => !observation.satisfied))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'observation_recovered requires all observations to be satisfied',
      });
    }
    if (gate !== undefined && gate !== null && gate.stepId !== report.stepId) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate', 'stepId'],
        message: 'Observation gate stepId must match the report stepId',
      });
    }
    if (
      gate !== undefined &&
      gate !== null &&
      (gate.status === 'repair_required' || gate.status === 'rollback_failed')
    ) {
      if (report.activeStepId !== gate.stepId) {
        context.addIssue({
          code: 'custom',
          path: ['activeStepId'],
          message: 'A blocking observation gate must match the active step',
        });
      }
      if (report.completedStepIds.includes(gate.stepId)) {
        context.addIssue({
          code: 'custom',
          path: ['completedStepIds'],
          message: 'A blocked step cannot be reported as completed',
        });
      }
    }
  });
export type CompanionStateReport = z.infer<typeof companionStateReportSchema>;
