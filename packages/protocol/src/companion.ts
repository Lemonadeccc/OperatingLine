import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { guideProposalSchema } from './proposal.js';

const companionContentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const companionPlanReferenceSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});

export const companionProcedureReplayCurrentStateRequestSchema = z.strictObject({
  formatVersion: z.literal('1.0.0'),
  verificationId: z.uuid(),
  replayId: z.uuid(),
  attestationId: z.uuid(),
  attestationContentSha256: companionContentSha256Schema,
  target: z.strictObject({
    adapterId: z.literal('blender'),
    instanceId: z.uuid(),
  }),
  plan: companionPlanReferenceSchema,
  planContentSha256: companionContentSha256Schema,
  executionId: z.uuid(),
  stepId: guideStepIdSchema,
  expectedObservation: z.strictObject({
    kind: z.string().min(1),
    contentSha256: companionContentSha256Schema,
  }),
  requestedAt: z.iso.datetime({ offset: true }),
});
export type CompanionProcedureReplayCurrentStateRequest = z.infer<
  typeof companionProcedureReplayCurrentStateRequestSchema
>;

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
    procedureReplayCurrentStateRequest: companionProcedureReplayCurrentStateRequestSchema
      .nullable()
      .optional(),
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
      {
        if: {
          properties: { procedureReplayCurrentStateRequest: { type: 'object' } },
          required: ['procedureReplayCurrentStateRequest'],
        },
        then: { properties: { protocolVersion: { const: '1.5.0' } } },
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
    if (
      delivery.procedureReplayCurrentStateRequest != null &&
      delivery.protocolVersion !== '1.5.0'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['procedureReplayCurrentStateRequest'],
        message: 'Replay current-state requests require Guide protocol 1.5',
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
  'current_state_rechecked',
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

export const companionArtifactAttestationSchema = z
  .strictObject({
    formatVersion: z.literal('1.0.0'),
    evidenceClass: z.literal('runtime_attested_host_artifacts'),
    planContentSha256: companionContentSha256Schema,
    executionId: z.uuid(),
    hostProject: z.strictObject({
      artifactId: guideStepIdSchema,
      kind: z.literal('host_project'),
      mediaType: z.literal('application/x-blender'),
      contentSha256: companionContentSha256Schema,
    }),
    renderedImage: z.strictObject({
      artifactId: guideStepIdSchema,
      kind: z.literal('rendered_image'),
      mediaType: z.literal('image/png'),
      contentSha256: companionContentSha256Schema,
      width: z.number().int().positive().max(65_536),
      height: z.number().int().positive().max(65_536),
      frame: z.number().int().safe().nullable(),
      renderEngine: z.string().trim().min(1).max(180),
      colorManagement: z.string().trim().min(1).max(500),
      hostProjectSha256: companionContentSha256Schema,
    }),
  })
  .superRefine((attestation, context) => {
    if (attestation.renderedImage.hostProjectSha256 !== attestation.hostProject.contentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['renderedImage', 'hostProjectSha256'],
        message: 'Rendered image must reference the exact attested host project',
      });
    }
    if (attestation.hostProject.artifactId === attestation.renderedImage.artifactId) {
      context.addIssue({
        code: 'custom',
        path: ['renderedImage', 'artifactId'],
        message: 'Host artifact ids must be unique',
      });
    }
  });
export type CompanionArtifactAttestation = z.infer<typeof companionArtifactAttestationSchema>;

const companionNativeUndoCheckpointOperationSchema = z.enum(['start', 'next', 'recheck', 'back']);

export const companionNativeUndoCheckpointSchema = z
  .strictObject({
    formatVersion: z.literal('1.0.0'),
    evidenceClass: z.literal('companion_reported_native_undo_checkpoint'),
    checkpointId: z.uuid(),
    previousCheckpointId: z.uuid().nullable(),
    operation: companionNativeUndoCheckpointOperationSchema,
    committedAt: z.iso.datetime({ offset: true }),
    marker: z.strictObject({
      key: z.literal('_operating_line_native_history_v1'),
      matched: z.literal(true),
    }),
    journal: z.strictObject({
      entryPresent: z.literal(true),
      snapshotMatchesSession: z.literal(true),
      artifactsBackedUp: z.literal(true),
    }),
    session: z.strictObject({
      plan: companionPlanReferenceSchema,
      planContentSha256: companionContentSha256Schema,
      executionId: z.uuid(),
      activeStepId: guideStepIdSchema.nullable(),
      completedStepIds: z
        .array(guideStepIdSchema)
        .meta({ uniqueItems: true })
        .refine((stepIds) => new Set(stepIds).size === stepIds.length, {
          message: 'Native Undo completedStepIds must contain unique step ids',
        }),
      receiptStepIds: z
        .array(guideStepIdSchema)
        .meta({ uniqueItems: true })
        .refine((stepIds) => new Set(stepIds).size === stepIds.length, {
          message: 'Native Undo receiptStepIds must contain unique step ids',
        }),
    }),
  })
  .superRefine((checkpoint, context) => {
    const completedStepIds = new Set(checkpoint.session.completedStepIds);
    if (checkpoint.session.receiptStepIds.some((stepId) => !completedStepIds.has(stepId))) {
      context.addIssue({
        code: 'custom',
        path: ['session', 'receiptStepIds'],
        message: 'Native Undo receipts must belong to completed steps',
      });
    }
  });
export type CompanionNativeUndoCheckpoint = z.infer<typeof companionNativeUndoCheckpointSchema>;

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
    artifactAttestation: companionArtifactAttestationSchema.nullable().optional(),
    nativeUndoCheckpoint: companionNativeUndoCheckpointSchema.optional(),
    procedureReplayCurrentStateRequest:
      companionProcedureReplayCurrentStateRequestSchema.optional(),
    error: z.string().min(1).nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { transition: { const: 'current_state_rechecked' } },
          required: ['transition'],
        },
        then: { required: ['procedureReplayCurrentStateRequest'] },
        else: { not: { required: ['procedureReplayCurrentStateRequest'] } },
      },
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
          properties: {
            protocolVersion: { enum: ['1.2.0', '1.3.0', '1.4.0', '1.5.0'] },
          },
          required: ['protocolVersion'],
        },
        then: { required: ['observationGate'] },
        else: { not: { required: ['observationGate'] } },
      },
      {
        if: {
          properties: { protocolVersion: { const: '1.5.0' } },
          required: ['protocolVersion'],
        },
        then: { required: ['artifactAttestation'] },
        else: { not: { required: ['artifactAttestation'] } },
      },
      {
        if: {
          properties: { artifactAttestation: { type: 'object' } },
          required: ['artifactAttestation'],
        },
        then: {
          properties: {
            phase: { enum: ['completed', 'error'] },
            executionId: { type: 'string' },
            planContentSha256: { type: 'string' },
          },
        },
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
      report.transition !== 'current_state_rechecked' &&
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
    if (
      (report.protocolVersion === '1.2.0' ||
        report.protocolVersion === '1.3.0' ||
        report.protocolVersion === '1.4.0' ||
        report.protocolVersion === '1.5.0') &&
      report.observationGate === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate'],
        message: 'Protocol 1.2+ reports require an explicit observationGate field',
      });
    }
    if (
      report.protocolVersion !== '1.2.0' &&
      report.protocolVersion !== '1.3.0' &&
      report.protocolVersion !== '1.4.0' &&
      report.protocolVersion !== '1.5.0' &&
      report.observationGate !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationGate'],
        message: 'Observation gate reports require protocol 1.2+',
      });
    }
    if (report.protocolVersion === '1.5.0' && report.artifactAttestation === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['artifactAttestation'],
        message: 'Protocol 1.5 reports require an explicit artifactAttestation field',
      });
    }
    if (report.protocolVersion !== '1.5.0' && report.artifactAttestation !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['artifactAttestation'],
        message: 'Artifact attestation reports require protocol 1.5',
      });
    }
    const currentStateRequest = report.procedureReplayCurrentStateRequest;
    if (
      report.transition === 'current_state_rechecked' &&
      (report.protocolVersion !== '1.5.0' || currentStateRequest === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['procedureReplayCurrentStateRequest'],
        message: 'Current-state rechecks require a protocol 1.5 replay verification request',
      });
    }
    if (report.transition !== 'current_state_rechecked' && currentStateRequest !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['procedureReplayCurrentStateRequest'],
        message: 'Replay current-state requests are only valid on current_state_rechecked',
      });
    }
    if (report.artifactAttestation !== undefined && report.artifactAttestation !== null) {
      if (
        (report.phase !== 'completed' && report.phase !== 'error') ||
        report.executionId === null ||
        report.planContentSha256 === null ||
        report.artifactAttestation.executionId !== report.executionId ||
        report.artifactAttestation.planContentSha256 !== report.planContentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['artifactAttestation'],
          message: 'Artifact attestation requires and must match a terminal execution',
        });
      }
    }
    const nativeUndoCheckpoint = report.nativeUndoCheckpoint;
    if (nativeUndoCheckpoint !== undefined) {
      let expectedOperation: 'start' | 'next' | 'recheck' | 'back' | undefined;
      switch (report.transition) {
        case 'walkthrough_started':
          expectedOperation = 'start';
          break;
        case 'step_succeeded':
          expectedOperation = 'next';
          break;
        case 'observation_recovered':
          expectedOperation = 'recheck';
          break;
        case 'step_rolled_back':
          expectedOperation = 'back';
          break;
        default:
          expectedOperation = undefined;
      }
      if (
        (report.transition !== 'current_state_rechecked' && expectedOperation === undefined) ||
        (expectedOperation !== undefined && nativeUndoCheckpoint.operation !== expectedOperation)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nativeUndoCheckpoint', 'operation'],
          message: 'Native Undo checkpoint operation must match the reported transition',
        });
      }
      if (
        report.plan === null ||
        report.planContentSha256 === null ||
        report.executionId === null ||
        nativeUndoCheckpoint.session.plan.id !== report.plan.id ||
        nativeUndoCheckpoint.session.plan.revision !== report.plan.revision ||
        nativeUndoCheckpoint.session.planContentSha256 !== report.planContentSha256 ||
        nativeUndoCheckpoint.session.executionId !== report.executionId ||
        nativeUndoCheckpoint.session.activeStepId !== report.activeStepId ||
        nativeUndoCheckpoint.session.completedStepIds.length !== report.completedStepIds.length ||
        nativeUndoCheckpoint.session.completedStepIds.some(
          (stepId, index) => stepId !== report.completedStepIds[index],
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nativeUndoCheckpoint', 'session'],
          message: 'Native Undo checkpoint must bind the exact reported session state',
        });
      }
      if (Date.parse(nativeUndoCheckpoint.committedAt) > Date.parse(report.occurredAt)) {
        context.addIssue({
          code: 'custom',
          path: ['nativeUndoCheckpoint', 'committedAt'],
          message: 'Native Undo checkpoint cannot postdate its companion report',
        });
      }
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
