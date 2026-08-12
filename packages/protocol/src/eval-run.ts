import { z } from 'zod';

import {
  evalArtifactReferenceSchema,
  evalContentSha256Schema,
  humanEvalCaseReferenceSchema,
  humanEvalDataHandlingSchema,
  humanEvalFormatVersionSchema,
  humanEvalIntegritySchema,
} from './eval-common.js';
import { guideProtocolVersionSchema } from './guide.js';
import { planningPromptPacketSchema } from './prompt.js';
import {
  plannerGenerateRequestSchema,
  plannerProviderGenerationSettingsSchema,
  plannerGenerationErrorSchema,
  plannerGenerationResultSchema,
  plannerProviderRuntimeOutputAttestationSchema,
  plannerProviderRuntimeProfileSchema,
  plannerProviderRuntimeTreatmentAttestationSchema,
} from './provider.js';
import {
  plannerReplanGenerateRequestSchema,
  plannerReplanGenerationResultSchema,
  replanningPromptPacketSchema,
} from './replanning-provider.js';
import { catalogVersionSchema } from './version.js';

export const providerEvalSourceKindSchema = z.enum([
  'live_provider_invocation',
  'synthetic_test_fixture',
]);
export type ProviderEvalSourceKind = z.infer<typeof providerEvalSourceKindSchema>;

export const providerEvalSourceEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('synthetic_test_fixture') }),
  z.strictObject({
    kind: z.literal('eval_export_snapshot'),
    snapshotId: z.uuid(),
    snapshotUpperSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    evalExportArtifactIds: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/))
      .min(1)
      .max(1_000)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({ code: 'custom', message: 'Eval export artifact ids must be unique' });
        }
      })
      .meta({ uniqueItems: true }),
  }),
]);
export type ProviderEvalSourceEvidence = z.infer<typeof providerEvalSourceEvidenceSchema>;

export const providerEvalProfileSchema = plannerProviderRuntimeProfileSchema;
export type ProviderEvalProfile = z.infer<typeof providerEvalProfileSchema>;

export const providerEvalEnvironmentSchema = z.strictObject({
  operatingLineVersion: catalogVersionSchema,
  sourceCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  protocolVersion: guideProtocolVersionSchema,
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema,
  adapterVersion: catalogVersionSchema.nullable(),
  hostVersion: z.string().trim().min(1).max(180).nullable(),
});
export type ProviderEvalEnvironment = z.infer<typeof providerEvalEnvironmentSchema>;

export const providerEvalGenerationSettingsSchema = plannerProviderGenerationSettingsSchema;
export type ProviderEvalGenerationSettings = z.infer<typeof providerEvalGenerationSettingsSchema>;

const providerEvalSourceEventCommon = {
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  eventId: z.string().trim().min(1).max(180),
  eventType: z.string().trim().min(1).max(180),
  payloadSha256: evalContentSha256Schema,
};

export const providerEvalSourceEventSchema = z.discriminatedUnion('correlationKind', [
  z.strictObject({
    ...providerEvalSourceEventCommon,
    correlationKind: z.literal('provider_request'),
    requestId: z.uuid(),
  }),
  z.strictObject({
    ...providerEvalSourceEventCommon,
    correlationKind: z.literal('host_execution'),
    planId: z.string().trim().min(1).max(180),
    planContentSha256: evalContentSha256Schema,
    instanceId: z.uuid().nullable(),
    executionId: z.uuid().nullable(),
    reportId: z.uuid(),
  }),
]);
export type ProviderEvalSourceEvent = z.infer<typeof providerEvalSourceEventSchema>;

const providerEvalInitialInvocationSchema = z.strictObject({
  operation: z.literal('initial_plan'),
  request: plannerGenerateRequestSchema,
  requestFingerprint: evalContentSha256Schema,
  goalProvenance: z
    .strictObject({
      goalRequestId: z.uuid(),
      targetInstanceId: z.uuid(),
    })
    .nullable(),
  packet: planningPromptPacketSchema,
  packetSha256: evalContentSha256Schema,
});

const providerEvalReplanInvocationSchema = z.strictObject({
  operation: z.literal('local_replan'),
  request: plannerReplanGenerateRequestSchema,
  requestFingerprint: evalContentSha256Schema,
  goalProvenance: z.null(),
  packet: replanningPromptPacketSchema,
  packetSha256: evalContentSha256Schema,
});

export const providerEvalInvocationSchema = z.discriminatedUnion('operation', [
  providerEvalInitialInvocationSchema,
  providerEvalReplanInvocationSchema,
]);
export type ProviderEvalInvocation = z.infer<typeof providerEvalInvocationSchema>;

const providerEvalCompletedOutcomeSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    status: z.literal('completed'),
    operation: z.literal('initial_plan'),
    result: plannerGenerationResultSchema,
    resultSha256: evalContentSha256Schema,
  }),
  z.strictObject({
    status: z.literal('completed'),
    operation: z.literal('local_replan'),
    result: plannerReplanGenerationResultSchema,
    resultSha256: evalContentSha256Schema,
  }),
]);

const providerEvalFailedOutcomeSchema = z.strictObject({
  status: z.literal('failed'),
  operation: z.enum(['initial_plan', 'local_replan']),
  error: plannerGenerationErrorSchema,
  errorSha256: evalContentSha256Schema,
});

export const providerEvalOutcomeSchema = z.union([
  providerEvalCompletedOutcomeSchema,
  providerEvalFailedOutcomeSchema,
]);
export type ProviderEvalOutcome = z.infer<typeof providerEvalOutcomeSchema>;

export const providerEvalRunSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    runId: z.uuid(),
    caseRef: humanEvalCaseReferenceSchema,
    sourceKind: providerEvalSourceKindSchema,
    sourceEvidence: providerEvalSourceEvidenceSchema,
    replicateIndex: z.number().int().positive().max(1_000),
    parentRunId: z.uuid().nullable(),
    profile: providerEvalProfileSchema,
    environment: providerEvalEnvironmentSchema,
    invocation: providerEvalInvocationSchema,
    generationSettings: providerEvalGenerationSettingsSchema,
    runtimeAttestation: z
      .union([
        plannerProviderRuntimeTreatmentAttestationSchema,
        plannerProviderRuntimeOutputAttestationSchema,
      ])
      .nullable()
      .default(null),
    timing: z.strictObject({
      startedAt: z.iso.datetime({ offset: true }),
      completedAt: z.iso.datetime({ offset: true }),
    }),
    outcome: providerEvalOutcomeSchema,
    sourceEvents: z.array(providerEvalSourceEventSchema).max(10_000),
    artifacts: z.array(evalArtifactReferenceSchema).max(64).default([]),
    comparability: z.strictObject({
      conditionSha256: evalContentSha256Schema,
      treatmentSha256: evalContentSha256Schema,
      reproducibility: z.enum(['reproducible', 'best_effort', 'not_reproducible']),
    }),
    provenance: z.strictObject({
      recorderName: z.string().trim().min(1).max(180),
      recorderVersion: catalogVersionSchema,
      vendorRequestId: z.string().trim().min(1).max(500).nullable(),
      rawProviderResponseStored: z.literal(false),
      privateReasoningStored: z.literal(false),
      credentialsStored: z.literal(false),
    }),
    dataHandling: humanEvalDataHandlingSchema,
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((run, context) => {
    const invocation = run.invocation;
    const outcome = run.outcome;
    const provider = run.profile.descriptor;
    if (
      (run.sourceKind === 'live_provider_invocation') !==
      (run.sourceEvidence.kind === 'eval_export_snapshot')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEvidence'],
        message:
          'Live runs require Eval export evidence; synthetic runs require synthetic evidence',
      });
    }
    if (invocation.operation !== outcome.operation) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'operation'],
        message: 'Outcome operation must match the invocation operation',
      });
    }
    if (
      run.runtimeAttestation?.evidenceClass === 'runtime_attested_provider_output' &&
      (outcome.status !== 'completed' ||
        run.runtimeAttestation.operation !== invocation.operation ||
        run.runtimeAttestation.requestId !== invocation.request.requestId ||
        run.runtimeAttestation.requestFingerprint !== invocation.requestFingerprint)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAttestation'],
        message: 'Provider output attestation must match a completed invocation',
      });
    }
    if (invocation.request.providerId !== provider.id) {
      context.addIssue({
        code: 'custom',
        path: ['invocation', 'request', 'providerId'],
        message: 'Invocation provider must match the captured provider descriptor',
      });
    }
    if (invocation.operation === 'initial_plan') {
      const packet = invocation.packet.context;
      if (
        invocation.request.targetAdapterId !== packet.targetAdapterId ||
        invocation.request.goal !== packet.goal ||
        invocation.request.planId !== packet.requestedPlanId ||
        invocation.request.catalogVersion !== packet.catalog.catalogVersion
      ) {
        context.addIssue({
          code: 'custom',
          path: ['invocation'],
          message: 'Initial planning request must match the exact captured packet',
        });
      }
    } else if (
      invocation.request.revisionRequestId !== invocation.packet.context.revisionRequest.requestId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['invocation'],
        message: 'Replan request must match the exact captured revision packet',
      });
    }
    if (
      run.environment.targetAdapterId !== invocation.packet.context.catalog.adapterId ||
      run.environment.catalogVersion !== invocation.packet.context.catalog.catalogVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['environment'],
        message: 'Run environment must match the exact packet catalog',
      });
    }
    if (outcome.status === 'completed') {
      if (
        outcome.result.requestId !== invocation.request.requestId ||
        outcome.result.provider.id !== provider.id ||
        outcome.result.provider.version !== provider.version
      ) {
        context.addIssue({
          code: 'custom',
          path: ['outcome'],
          message: 'Completed result must match the invocation and provider identity',
        });
      }
      if (invocation.operation === 'initial_plan' && outcome.operation === 'initial_plan') {
        const packet = invocation.packet;
        const draft = outcome.result.draft;
        if (
          outcome.result.packetFormatVersion !== packet.formatVersion ||
          draft.targetAdapterId !== packet.context.targetAdapterId ||
          draft.catalogVersion !== packet.context.catalog.catalogVersion ||
          draft.planning.goal !== packet.context.goal ||
          draft.plan.id !== packet.context.requestedPlanId ||
          draft.plan.revision !== packet.context.recommendedRevision
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcome'],
            message: 'Completed initial result must describe the exact captured planning packet',
          });
        }
      } else if (invocation.operation === 'local_replan' && outcome.operation === 'local_replan') {
        const packet = invocation.packet;
        const revision = packet.context.revisionRequest;
        const result = outcome.result;
        if (
          result.packetFormatVersion !== packet.formatVersion ||
          result.revisionRequestId !== revision.requestId ||
          result.targetAdapterId !== revision.adapterId ||
          result.targetInstanceId !== revision.instanceId ||
          result.draft.catalogVersion !== revision.catalogVersion ||
          result.draft.planning?.goal !== revision.message ||
          result.draft.plan.protocolVersion !== revision.basePlan.protocolVersion ||
          result.draft.plan.id !== revision.basePlan.id ||
          result.draft.plan.revision !== packet.context.targetRevision ||
          result.locality.basePlan.id !== revision.basePlan.id ||
          result.locality.basePlan.revision !== revision.basePlan.revision ||
          result.locality.targetPlan.revision !== packet.context.targetRevision ||
          (result.planDiff !== null &&
            (result.planDiff.basePlan.id !== revision.basePlan.id ||
              result.planDiff.basePlan.revision !== revision.basePlan.revision ||
              result.planDiff.targetPlan.revision !== packet.context.targetRevision))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['outcome'],
            message: 'Completed replan result must describe the exact captured revision packet',
          });
        }
      }
    } else if (outcome.error.requestId !== invocation.request.requestId) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'error', 'requestId'],
        message: 'Failed result must preserve the invocation request id',
      });
    }
    if (Date.parse(run.timing.completedAt) < Date.parse(run.timing.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['timing', 'completedAt'],
        message: 'Run completion cannot precede its start',
      });
    }
    if (
      (run.profile.model.resolution === 'resolved') !==
      (run.profile.model.resolvedRevision !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profile', 'model'],
        message: 'Resolved model status must match the resolved revision field',
      });
    }
    const artifactIds = run.artifacts.map((artifact) => artifact.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Run artifact ids must be unique',
      });
    }
    if (run.sourceEvidence.kind === 'eval_export_snapshot') {
      for (const artifactId of run.sourceEvidence.evalExportArtifactIds) {
        const artifact = run.artifacts.find((candidate) => candidate.artifactId === artifactId);
        if (artifact?.kind !== 'eval_export') {
          context.addIssue({
            code: 'custom',
            path: ['sourceEvidence', 'evalExportArtifactIds'],
            message: `Live source artifact ${artifactId} must be a declared Eval export`,
          });
        }
      }
    }
    const hostProjectHashes = new Set(
      run.artifacts
        .filter((artifact) => artifact.kind === 'host_project')
        .map((artifact) => artifact.contentSha256),
    );
    for (const artifact of run.artifacts) {
      if (
        artifact.kind === 'rendered_image' &&
        artifact.visualEnvironment !== undefined &&
        !hostProjectHashes.has(artifact.visualEnvironment.hostProjectSha256)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts'],
          message: `Rendered image ${artifact.artifactId} must reference one declared host project`,
        });
      }
    }
    const eventSequences = run.sourceEvents.map((event) => event.sequence);
    if (new Set(eventSequences).size !== eventSequences.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEvents'],
        message: 'Source event sequences must be unique',
      });
    }
    const eventIds = run.sourceEvents.map((event) => event.eventId);
    if (new Set(eventIds).size !== eventIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEvents'],
        message: 'Source event ids must be unique',
      });
    }
    if (
      run.sourceEvents.some(
        (event, index) => index > 0 && event.sequence <= run.sourceEvents[index - 1]!.sequence,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEvents'],
        message: 'Source events must preserve increasing ledger order',
      });
    }
    const expectedPlanId =
      invocation.operation === 'initial_plan'
        ? invocation.packet.context.requestedPlanId
        : invocation.packet.context.revisionRequest.basePlan.id;
    const expectedInstanceId =
      invocation.operation === 'local_replan'
        ? invocation.packet.context.revisionRequest.instanceId
        : null;
    for (const event of run.sourceEvents) {
      if (
        event.correlationKind === 'provider_request' &&
        event.requestId !== invocation.request.requestId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceEvents'],
          message: 'Provider source events must match the invocation request',
        });
      }
      if (
        event.correlationKind === 'host_execution' &&
        (event.planId !== expectedPlanId ||
          (expectedInstanceId !== null && event.instanceId !== expectedInstanceId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceEvents'],
          message: 'Host source events must match the invocation plan and instance',
        });
      }
    }
    if (run.comparability.reproducibility === 'reproducible') {
      if (
        run.profile.model.resolution !== 'resolved' ||
        run.profile.model.resolvedRevision === null ||
        run.generationSettings.determinism !== 'deterministic' ||
        run.environment.sourceCommit === null ||
        run.environment.adapterVersion === null ||
        run.environment.hostVersion === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['comparability', 'reproducibility'],
          message:
            'Reproducible runs require immutable model, source, adapter, host, and fully deterministic generation identities',
        });
      }
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { sourceKind: { const: 'live_provider_invocation' } },
          required: ['sourceKind'],
        },
        then: {
          properties: {
            sourceEvidence: {
              type: 'object',
              properties: { kind: { const: 'eval_export_snapshot' } },
              required: ['kind'],
            },
          },
        },
        else: {
          properties: {
            sourceEvidence: {
              type: 'object',
              properties: { kind: { const: 'synthetic_test_fixture' } },
              required: ['kind'],
            },
          },
        },
      },
      {
        if: {
          properties: {
            comparability: {
              type: 'object',
              properties: { reproducibility: { const: 'reproducible' } },
              required: ['reproducibility'],
            },
          },
          required: ['comparability'],
        },
        then: {
          properties: {
            profile: {
              type: 'object',
              properties: {
                model: {
                  type: 'object',
                  properties: {
                    resolution: { const: 'resolved' },
                    resolvedRevision: { type: 'string' },
                  },
                  required: ['resolution', 'resolvedRevision'],
                },
              },
              required: ['model'],
            },
            environment: {
              type: 'object',
              properties: {
                sourceCommit: { type: 'string' },
                adapterVersion: { type: 'string' },
                hostVersion: { type: 'string' },
              },
              required: ['sourceCommit', 'adapterVersion', 'hostVersion'],
            },
            generationSettings: {
              type: 'object',
              properties: {
                determinism: { const: 'deterministic' },
              },
              required: ['determinism'],
            },
          },
        },
      },
      {
        if: {
          properties: {
            profile: {
              type: 'object',
              properties: {
                model: {
                  type: 'object',
                  properties: { resolution: { const: 'resolved' } },
                  required: ['resolution'],
                },
              },
              required: ['model'],
            },
          },
          required: ['profile'],
        },
        then: {
          properties: {
            profile: {
              type: 'object',
              properties: {
                model: {
                  type: 'object',
                  properties: { resolvedRevision: { type: 'string' } },
                  required: ['resolvedRevision'],
                },
              },
            },
          },
        },
        else: {
          properties: {
            profile: {
              type: 'object',
              properties: {
                model: {
                  type: 'object',
                  properties: { resolvedRevision: { type: 'null' } },
                  required: ['resolvedRevision'],
                },
              },
            },
          },
        },
      },
    ],
  });
export type ProviderEvalRun = z.infer<typeof providerEvalRunSchema>;
