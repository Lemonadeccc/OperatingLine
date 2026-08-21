import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import { procedureAuthoringGenerationResultSchema } from './procedure-authoring-provider.js';
import { procedureAuthoringPromptRequestSchema } from './procedure-authoring.js';
import { plannerProviderDescriptorSchema } from './provider.js';
import { catalogVersionSchema } from './version.js';

export const procedureZeroBaselineFormatVersion = '1.0.0' as const;
export const procedureZeroBaselineFormatVersionSchema = z.literal(
  procedureZeroBaselineFormatVersion,
);

const availableProviderDescriptorSchema = plannerProviderDescriptorSchema.extend({
  availability: z.strictObject({ available: z.literal(true) }),
});

export const procedureZeroBaselineGenerateRequestSchema = z.strictObject({
  formatVersion: procedureZeroBaselineFormatVersionSchema,
  requestId: z.uuid(),
  targetAdapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
  actionCatalogVersion: catalogVersionSchema,
  interactionCatalogVersion: catalogVersionSchema,
  goal: procedureAuthoringPromptRequestSchema.shape.goal,
  locale: procedureAuthoringPromptRequestSchema.shape.locale.unwrap(),
  authorization: z.strictObject({
    providerDescriptor: availableProviderDescriptorSchema,
    explicitlyConfirmedByUser: z.literal(true),
    goalAndCatalogContextTransmissionAcknowledged: z.literal(true),
    possibleProviderCostAcknowledged: z.literal(true),
    confirmedAt: z.iso.datetime({ offset: true }),
  }),
});
export type ProcedureZeroBaselineGenerateRequest = z.infer<
  typeof procedureZeroBaselineGenerateRequestSchema
>;

export const procedureZeroBaselineResultSchema = z.strictObject({
  formatVersion: procedureZeroBaselineFormatVersionSchema,
  requestFingerprint: evalContentSha256Schema,
  allocation: z.strictObject({
    strategy: z.literal('request_fingerprint_uuid_v8'),
  }),
  retrieval: z.strictObject({
    status: z.literal('not_used'),
    reason: z.literal('zero_baseline_has_no_existing_tree'),
  }),
  outcome: z.literal('candidate_only'),
  generation: procedureAuthoringGenerationResultSchema,
});
export type ProcedureZeroBaselineResult = z.infer<typeof procedureZeroBaselineResultSchema>;

export const procedureZeroBaselineRequestedEventSchema = z.strictObject({
  request: procedureZeroBaselineGenerateRequestSchema,
  requestFingerprint: evalContentSha256Schema,
  treeId: z.uuid(),
  revision: z.literal(1),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type ProcedureZeroBaselineRequestedEvent = z.infer<
  typeof procedureZeroBaselineRequestedEventSchema
>;

export const procedureZeroBaselineCompletedEventSchema = z.strictObject({
  result: procedureZeroBaselineResultSchema,
  occurredAt: z.iso.datetime({ offset: true }),
});
export type ProcedureZeroBaselineCompletedEvent = z.infer<
  typeof procedureZeroBaselineCompletedEventSchema
>;
