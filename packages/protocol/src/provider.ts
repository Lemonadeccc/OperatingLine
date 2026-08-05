import { z } from 'zod';

import { guideStepIdSchema } from './guide.js';
import { planningProposalDraftSchema, planningQualityReportSchema } from './planning.js';
import { planningPromptFormatVersion, planningPromptRequestSchema } from './prompt.js';
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

export const plannerGenerationResultSchema = z
  .strictObject({
    formatVersion: plannerGenerationFormatVersionSchema,
    generationId: z.uuid(),
    requestId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
    }),
    packetFormatVersion: z.literal(planningPromptFormatVersion),
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
    if (
      quality.targetAdapterId !== draft.targetAdapterId ||
      quality.catalogVersion !== draft.catalogVersion ||
      quality.goal !== draft.planning.goal ||
      quality.plan.id !== draft.plan.id ||
      quality.plan.revision !== draft.plan.revision ||
      !phaseIdsMatch
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
  });
export type PlannerGenerationResult = z.infer<typeof plannerGenerationResultSchema>;

export const plannerGenerationErrorCodeSchema = z.enum([
  'planner_invalid_request',
  'planner_provider_not_found',
  'planner_provider_unavailable',
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
});

export const plannerGenerationRequestedEventSchema = plannerGenerationEventScopeSchema.extend({
  packetFormatVersion: z.literal(planningPromptFormatVersion),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlannerGenerationRequestedEvent = z.infer<typeof plannerGenerationRequestedEventSchema>;

export const plannerGenerationCompletedEventSchema = z
  .strictObject({
    request: plannerGenerateRequestSchema,
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    targetAdapterId: z.string().trim().min(1).max(180),
    catalogVersion: catalogVersionSchema,
    planId: z.string().trim().min(1).max(180),
    result: plannerGenerationResultSchema,
  })
  .superRefine((event, context) => {
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
  });
export type PlannerGenerationCompletedEvent = z.infer<typeof plannerGenerationCompletedEventSchema>;

export const plannerGenerationFailedEventSchema = plannerGenerationEventScopeSchema.extend({
  error: plannerGenerationErrorCodeSchema,
  durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlannerGenerationFailedEvent = z.infer<typeof plannerGenerationFailedEventSchema>;
