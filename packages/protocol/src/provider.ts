import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import { planningProposalDraftSchema, planningQualityReportSchema } from './planning.js';
import { planningPromptFormatVersionSchema, planningPromptRequestSchema } from './prompt.js';
import { catalogVersionSchema } from './version.js';

export const plannerProviderContractVersion = '1.0.0' as const;
export const plannerProviderContractVersionSchema = z.literal(plannerProviderContractVersion);

export const plannerProviderIdSchema = guideStepIdSchema;

export const plannerProviderAvailabilitySchema = z.discriminatedUnion('available', [
  z.strictObject({ available: z.literal(true) }),
  z.strictObject({
    available: z.literal(false),
    reason: z.enum(['not_configured', 'disabled', 'temporarily_unavailable']),
    message: z.string().trim().min(1).max(500),
  }),
]);

export const plannerProviderDataHandlingSchema = z.discriminatedUnion('executionLocation', [
  z.strictObject({
    executionLocation: z.literal('local'),
    dataTransmission: z.literal('none'),
    credentialManagement: z.literal('provider_managed'),
  }),
  z.strictObject({
    executionLocation: z.literal('remote'),
    dataTransmission: z.literal('provider_managed'),
    credentialManagement: z.literal('provider_managed'),
  }),
]);

export const plannerProviderDescriptorSchema = z.strictObject({
  contractVersion: plannerProviderContractVersionSchema,
  id: plannerProviderIdSchema,
  version: catalogVersionSchema,
  displayName: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(1_000),
  availability: plannerProviderAvailabilitySchema,
  limits: z.strictObject({
    maxConcurrency: z.number().int().min(1).max(8),
  }),
  dataHandling: plannerProviderDataHandlingSchema,
});
export type PlannerProviderDescriptor = z.infer<typeof plannerProviderDescriptorSchema>;

export const plannerProviderRuntimeProfileSchema = z
  .strictObject({
    descriptor: plannerProviderDescriptorSchema,
    vendor: z.string().trim().min(1).max(180),
    implementation: z.strictObject({
      name: z.string().trim().min(1).max(180),
      version: catalogVersionSchema,
    }),
    model: z.strictObject({
      requested: z.string().trim().min(1).max(500),
      resolvedRevision: z.string().trim().min(1).max(500).nullable(),
      resolution: z.enum(['resolved', 'provider_did_not_disclose']),
    }),
    api: z.strictObject({
      surface: z.string().trim().min(1).max(180),
      version: z.string().trim().min(1).max(180),
      sdkName: z.string().trim().min(1).max(180),
      sdkVersion: z.string().trim().min(1).max(180),
      endpointClass: z.enum(['vendor_public', 'self_hosted', 'local']),
      serviceTier: z.string().trim().min(1).max(180).nullable(),
      region: z.string().trim().min(1).max(180).nullable(),
    }),
  })
  .superRefine((profile, context) => {
    if ((profile.model.resolution === 'resolved') !== (profile.model.resolvedRevision !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['model', 'resolvedRevision'],
        message: 'Resolved model status must match the resolved revision field',
      });
    }
  });
export type PlannerProviderRuntimeProfile = z.infer<typeof plannerProviderRuntimeProfileSchema>;

const credentialKeyTokens = new Set([
  'auth',
  'authorization',
  'bearer',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'passphrase',
  'passphrases',
  'password',
  'passwords',
  'secret',
  'secrets',
]);

const credentialKeyQualifiers = new Set([
  'access',
  'api',
  'client',
  'encryption',
  'id',
  'oauth',
  'private',
  'provider',
  'refresh',
  'secret',
  'session',
  'signing',
  'vendor',
]);

const compactCredentialKeySuffixes = [
  'accesstoken',
  'accesstokens',
  'apikey',
  'apikeys',
  'authheader',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'clientsecrets',
  'credential',
  'credentials',
  'encryptionkey',
  'idtoken',
  'password',
  'passwords',
  'passphrase',
  'passphrases',
  'privatekey',
  'privatekeys',
  'providertoken',
  'providertokens',
  'refreshtoken',
  'secretaccesskey',
  'secretkey',
  'secretkeys',
  'sessiontoken',
  'sessiontokens',
  'signingkey',
  'signingkeys',
] as const;

const publicTokenMetricSuffixes = new Set([
  'budget',
  'count',
  'counts',
  'estimate',
  'estimates',
  'limit',
  'limits',
  'length',
  'maximum',
  'minimum',
  'rate',
  'usage',
]);

const publicTokenMetricPrefixes = new Set([
  'completion',
  'input',
  'max',
  'maximum',
  'min',
  'minimum',
  'new',
  'output',
  'prompt',
]);

const compactCredentialCompoundPattern =
  /(?:access|api|auth|bearer|client|encryption|id|oauth|private|provider|refresh|secret|session|signing|vendor)(?:key|keys|secret|secrets|token|tokens)/u;

function parameterKeyTokens(key: string): readonly string[] {
  return key
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token !== '');
}

function isCredentialLikeParameterKey(key: string): boolean {
  const tokens = parameterKeyTokens(key);
  const compactKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  if (
    compactKey.endsWith('token') ||
    compactCredentialCompoundPattern.test(compactKey) ||
    compactCredentialKeySuffixes.some((suffix) => compactKey.endsWith(suffix))
  ) {
    return true;
  }
  if (tokens.some((token) => credentialKeyTokens.has(token))) return true;
  const tokenIndex = tokens.findIndex((token) => token === 'token' || token === 'tokens');
  if (tokenIndex >= 0) {
    const prefix = tokens.slice(0, tokenIndex);
    const suffix = tokens.slice(tokenIndex + 1);
    if (prefix.some((token) => credentialKeyQualifiers.has(token))) return true;
    const isPublicMetric =
      (suffix.length > 0 && suffix.every((token) => publicTokenMetricSuffixes.has(token))) ||
      (suffix.length === 0 &&
        prefix.length > 0 &&
        prefix.every((token) => publicTokenMetricPrefixes.has(token)));
    if (!isPublicMetric) return true;
  }
  const keyIndex = tokens.findIndex((token) => token === 'key' || token === 'keys');
  return (
    keyIndex >= 0 && tokens.slice(0, keyIndex).some((token) => credentialKeyQualifiers.has(token))
  );
}

function jsonPointerSegment(value: string | number): string {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * Finds the first parameter path whose name implies credential material. Provider runtime
 * treatments are durable evidence, so credentials must remain provider-managed and absent from
 * this otherwise provider-defined JSON object.
 */
export function findPlannerProviderCredentialLikeParameterPath(
  value: unknown,
  path: readonly (string | number)[] = [],
): string | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findPlannerProviderCredentialLikeParameterPath(entry, [...path, index]);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isCredentialLikeParameterKey(key)) {
      return `/${nextPath.map(jsonPointerSegment).join('/')}`;
    }
    const found = findPlannerProviderCredentialLikeParameterPath(entry, nextPath);
    if (found !== null) return found;
  }
  return null;
}

export const plannerProviderGenerationSettingsSchema = z
  .strictObject({
    normalizedParameters: z.record(z.string().min(1), z.json()),
    parametersSha256: evalContentSha256Schema,
    seed: z.number().int().safe().nullable(),
    determinism: z.enum(['deterministic', 'seeded_best_effort', 'non_deterministic', 'unknown']),
  })
  .superRefine((settings, context) => {
    const credentialPath = findPlannerProviderCredentialLikeParameterPath(
      settings.normalizedParameters,
    );
    if (credentialPath !== null) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedParameters'],
        message: `Normalized parameters must not contain credential-like key ${credentialPath}`,
      });
    }
    if (settings.determinism === 'seeded_best_effort' && settings.seed === null) {
      context.addIssue({
        code: 'custom',
        path: ['seed'],
        message: 'Seeded best-effort generation requires an explicit seed',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { determinism: { const: 'seeded_best_effort' } },
          required: ['determinism'],
        },
        then: { properties: { seed: { type: 'number' } }, required: ['seed'] },
      },
    ],
  });
export type PlannerProviderGenerationSettings = z.infer<
  typeof plannerProviderGenerationSettingsSchema
>;

export const plannerProviderCostPolicySchema = z.discriminatedUnion('possibleProviderCost', [
  z.strictObject({
    possibleProviderCost: z.literal(true),
    basis: z.literal('provider_pricing'),
    publicStatement: z.string().trim().min(1).max(1_000).regex(/\S/),
  }),
  z.strictObject({
    possibleProviderCost: z.literal(false),
    basis: z.literal('no_provider_cost'),
    publicStatement: z.string().trim().min(1).max(1_000).regex(/\S/),
  }),
]);
export type PlannerProviderCostPolicy = z.infer<typeof plannerProviderCostPolicySchema>;

export const plannerProviderRuntimeTreatmentSchema = z.strictObject({
  profile: plannerProviderRuntimeProfileSchema,
  generationSettings: plannerProviderGenerationSettingsSchema,
});
export type PlannerProviderRuntimeTreatment = z.infer<typeof plannerProviderRuntimeTreatmentSchema>;

export const plannerProviderRuntimeTreatmentAttestationVersion = '1.0.0' as const;
export const plannerProviderRuntimeTreatmentAttestationSchema = z.strictObject({
  formatVersion: z.literal(plannerProviderRuntimeTreatmentAttestationVersion),
  evidenceClass: z.literal('runtime_attested_provider_treatment'),
  operation: z.enum(['initial_plan', 'local_replan']),
  treatment: plannerProviderRuntimeTreatmentSchema,
  treatmentSha256: evalContentSha256Schema,
});
export type PlannerProviderRuntimeTreatmentAttestation = z.infer<
  typeof plannerProviderRuntimeTreatmentAttestationSchema
>;

export const plannerProviderRuntimeOutputAttestationSchema = z
  .strictObject({
    formatVersion: z.literal(plannerProviderRuntimeTreatmentAttestationVersion),
    evidenceClass: z.literal('runtime_attested_provider_output'),
    operation: z.enum(['initial_plan', 'local_replan']),
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    packetSha256: evalContentSha256Schema,
    outputSha256: evalContentSha256Schema,
    treatment: plannerProviderRuntimeTreatmentAttestationSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((attestation, context) => {
    if (attestation.operation !== attestation.treatment.operation) {
      context.addIssue({
        code: 'custom',
        path: ['treatment', 'operation'],
        message: 'Output and treatment attestations must describe the same operation',
      });
    }
  });
export type PlannerProviderRuntimeOutputAttestation = z.infer<
  typeof plannerProviderRuntimeOutputAttestationSchema
>;

export const plannerProviderListSchema = z
  .strictObject({
    contractVersion: plannerProviderContractVersionSchema,
    generationAvailable: z.boolean(),
    providers: z.array(plannerProviderDescriptorSchema),
  })
  .superRefine((value, context) => {
    const providerIds = value.providers.map((provider) => provider.id);
    if (new Set(providerIds).size !== providerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'Planner provider ids must be unique',
      });
    }
    const hasAvailableProvider = value.providers.some(
      (provider) => provider.availability.available,
    );
    if (value.generationAvailable !== hasAvailableProvider) {
      context.addIssue({
        code: 'custom',
        path: ['generationAvailable'],
        message: 'generationAvailable must match the provider availability list',
      });
    }
  });
export type PlannerProviderList = z.infer<typeof plannerProviderListSchema>;

export const plannerGenerateRequestSchema = planningPromptRequestSchema.extend({
  requestId: z.uuid(),
  providerId: plannerProviderIdSchema,
});
export type PlannerGenerateRequest = z.infer<typeof plannerGenerateRequestSchema>;

export const plannerGenerationFormatVersion = '1.0.0' as const;
export const plannerGenerationFormatVersionSchema = z.literal(plannerGenerationFormatVersion);

export const plannerGenerationStatusSchema = z.enum(['ready', 'needs_revision']);
export type PlannerGenerationStatus = z.infer<typeof plannerGenerationStatusSchema>;

const plannerGenerationResultJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: { packetFormatVersion: { const: '1.0.0' } },
        required: ['packetFormatVersion'],
      },
      then: {
        type: 'object',
        properties: {
          planningQuality: {
            type: 'object',
            properties: { baselineVersion: { const: '1.0.0' } },
            required: ['baselineVersion'],
          },
        },
      },
      else: {
        type: 'object',
        properties: {
          planningQuality: {
            type: 'object',
            properties: { baselineVersion: { const: '1.1.0' } },
            required: ['baselineVersion'],
          },
        },
      },
    },
    {
      if: {
        type: 'object',
        properties: {
          planningQuality: {
            type: 'object',
            properties: { valid: { const: true } },
            required: ['valid'],
          },
        },
        required: ['planningQuality'],
      },
      then: { type: 'object', properties: { status: { const: 'ready' } } },
      else: { type: 'object', properties: { status: { const: 'needs_revision' } } },
    },
    {
      if: {
        type: 'object',
        properties: {
          packetFormatVersion: { const: '1.1.0' },
          status: { const: 'ready' },
        },
        required: ['packetFormatVersion', 'status'],
      },
      then: {
        type: 'object',
        properties: {
          draft: {
            type: 'object',
            properties: {
              planning: { type: 'object', required: ['capabilityCoverage'] },
            },
            required: ['planning'],
          },
          planningQuality: { type: 'object', required: ['capabilityCoverage'] },
        },
      },
    },
  ],
} as const;

export const plannerGenerationResultSchema = z
  .strictObject({
    formatVersion: plannerGenerationFormatVersionSchema,
    generationId: z.uuid(),
    requestId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
    }),
    packetFormatVersion: planningPromptFormatVersionSchema,
    status: plannerGenerationStatusSchema,
    draft: planningProposalDraftSchema,
    planningQuality: planningQualityReportSchema,
    proposalCreated: z.literal(false),
    generatedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((result, context) => {
    const quality = result.planningQuality;
    const draft = result.draft;
    const phaseIdsMatch =
      quality.requiredPhaseIds.length === draft.planning.requiredPhaseIds.length &&
      quality.requiredPhaseIds.every(
        (phaseId, index) => phaseId === draft.planning.requiredPhaseIds[index],
      );
    const capabilityCoverageMatches =
      quality.baselineVersion === '1.0.0'
        ? quality.capabilityCoverage === undefined
        : JSON.stringify(quality.capabilityCoverage) ===
          JSON.stringify(draft.planning.capabilityCoverage);
    if (result.packetFormatVersion !== quality.baselineVersion) {
      context.addIssue({
        code: 'custom',
        path: ['packetFormatVersion'],
        message: 'Planning packet format version must match the planning quality baseline version',
      });
    }
    if (
      quality.targetAdapterId !== draft.targetAdapterId ||
      quality.catalogVersion !== draft.catalogVersion ||
      quality.goal !== draft.planning.goal ||
      quality.plan.id !== draft.plan.id ||
      quality.plan.revision !== draft.plan.revision ||
      !phaseIdsMatch ||
      !capabilityCoverageMatches
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planningQuality'],
        message: 'Planning quality evidence must describe the exact generated draft',
      });
    }
    if (result.status !== (quality.valid ? 'ready' : 'needs_revision')) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Generation status must match planningQuality.valid',
      });
    }
  })
  .meta(plannerGenerationResultJsonSchemaMetadata);
export type PlannerGenerationResult = z.infer<typeof plannerGenerationResultSchema>;

export const plannerGenerationErrorCodeSchema = z.enum([
  'planner_invalid_request',
  'planner_provider_not_found',
  'planner_provider_unavailable',
  'planner_dialogue_not_supported',
  'planner_procedure_authoring_not_supported',
  'planner_procedure_embedding_not_supported',
  'planner_procedure_refinement_not_supported',
  'planner_replan_not_supported',
  'planner_revision_request_not_found',
  'planner_revision_request_not_pending',
  'planner_revision_thread_stale',
  'planner_replan_generation_stale',
  'planner_replan_submission_invalid',
  'planner_generation_busy',
  'planner_generation_conflict',
  'planner_generation_already_attempted',
  'planner_generation_timeout',
  'planner_runtime_stopping',
  'planner_provider_failed',
  'planner_output_invalid',
  'planner_identity_mismatch',
  'planner_catalog_invalid',
  'planner_persistence_failed',
  'planner_internal_failed',
]);
export type PlannerGenerationErrorCode = z.infer<typeof plannerGenerationErrorCodeSchema>;

export const plannerGenerationRetryModeSchema = z.enum([
  'same_request_id',
  'new_request_id',
  'never',
]);
export type PlannerGenerationRetryMode = z.infer<typeof plannerGenerationRetryModeSchema>;

export const plannerGenerationErrorSchema = z.strictObject({
  error: plannerGenerationErrorCodeSchema,
  requestId: z.uuid().nullable(),
  message: z.string().min(1),
  retryMode: plannerGenerationRetryModeSchema,
});
export type PlannerGenerationError = z.infer<typeof plannerGenerationErrorSchema>;

const plannerGenerationEventScopeSchema = z.strictObject({
  requestId: z.uuid(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  providerId: plannerProviderIdSchema,
  providerVersion: catalogVersionSchema,
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema,
  planId: z.string().trim().min(1).max(180),
  goalRequestId: z.uuid().optional(),
  targetInstanceId: z.uuid().optional(),
});

function requirePairedGoalRunScope(
  event: { goalRequestId?: string | undefined; targetInstanceId?: string | undefined },
  context: z.RefinementCtx,
): void {
  if ((event.goalRequestId === undefined) !== (event.targetInstanceId === undefined)) {
    context.addIssue({
      code: 'custom',
      path: [event.goalRequestId === undefined ? 'goalRequestId' : 'targetInstanceId'],
      message: 'goalRequestId and targetInstanceId must be provided together',
    });
  }
}

export const plannerGenerationRequestedEventSchema = plannerGenerationEventScopeSchema
  .extend({
    packetFormatVersion: planningPromptFormatVersionSchema,
    runtimeTreatment: plannerProviderRuntimeTreatmentAttestationSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine(requirePairedGoalRunScope);
export type PlannerGenerationRequestedEvent = z.infer<typeof plannerGenerationRequestedEventSchema>;

export const plannerGenerationCompletedEventSchema = z
  .strictObject({
    request: plannerGenerateRequestSchema,
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    targetAdapterId: z.string().trim().min(1).max(180),
    catalogVersion: catalogVersionSchema,
    planId: z.string().trim().min(1).max(180),
    goalRequestId: z.uuid().optional(),
    targetInstanceId: z.uuid().optional(),
    result: plannerGenerationResultSchema,
    runtimeAttestation: plannerProviderRuntimeOutputAttestationSchema.optional(),
  })
  .superRefine((event, context) => {
    requirePairedGoalRunScope(event, context);
    if (
      event.result.requestId !== event.request.requestId ||
      event.result.provider.id !== event.request.providerId ||
      event.targetAdapterId !== event.request.targetAdapterId ||
      event.targetAdapterId !== event.result.draft.targetAdapterId ||
      event.result.draft.planning.goal !== event.request.goal ||
      event.planId !== event.request.planId ||
      event.planId !== event.result.draft.plan.id ||
      event.catalogVersion !== event.result.draft.catalogVersion ||
      (event.request.catalogVersion !== undefined &&
        event.catalogVersion !== event.request.catalogVersion)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed generation evidence must match its exact request',
      });
    }
    if (
      event.runtimeAttestation !== undefined &&
      (event.runtimeAttestation.operation !== 'initial_plan' ||
        event.runtimeAttestation.requestId !== event.request.requestId ||
        event.runtimeAttestation.requestFingerprint !== event.requestFingerprint)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAttestation'],
        message: 'Runtime attestation must match the exact initial-plan request',
      });
    }
  });
export type PlannerGenerationCompletedEvent = z.infer<typeof plannerGenerationCompletedEventSchema>;

export const plannerGenerationFailedEventSchema = plannerGenerationEventScopeSchema
  .extend({
    error: plannerGenerationErrorCodeSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine(requirePairedGoalRunScope);
export type PlannerGenerationFailedEvent = z.infer<typeof plannerGenerationFailedEventSchema>;
