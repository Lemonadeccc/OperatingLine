import { z } from 'zod';

import {
  plannerGenerationErrorCodeSchema,
  plannerGenerationRetryModeSchema,
  plannerProviderIdSchema,
} from './provider.js';
import { planningQualityFindingSchema } from './planning.js';
import { catalogVersionSchema } from './version.js';

export const companionInitialPlanRunContractVersion = '1.0.0' as const;
export const companionInitialPlanRunContractVersionSchema = z.literal(
  companionInitialPlanRunContractVersion,
);

export const companionInitialPlanRunDisclosureVersion = '1.0.0' as const;
export const companionInitialPlanRunDisclosureVersionSchema = z.literal(
  companionInitialPlanRunDisclosureVersion,
);

export const companionInitialPlanRunCreateRequestSchema = z
  .strictObject({
    generationRequestId: z.uuid(),
    goalRequestId: z.uuid(),
    providerId: plannerProviderIdSchema,
    providerVersion: catalogVersionSchema,
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    authorization: z.strictObject({
      disclosureVersion: companionInitialPlanRunDisclosureVersionSchema,
      dataHandlingAcknowledged: z.literal(true),
      possibleChargesAcknowledged: z.literal(true),
      proposalCreationAcknowledged: z.literal(true),
      authorizedAt: z.iso.datetime({ offset: true }),
    }),
  })
  .superRefine((request, context) => {
    if (request.generationRequestId === request.goalRequestId) {
      context.addIssue({
        code: 'custom',
        path: ['generationRequestId'],
        message: 'generationRequestId must differ from goalRequestId',
      });
    }
  });
export type CompanionInitialPlanRunCreateRequest = z.infer<
  typeof companionInitialPlanRunCreateRequestSchema
>;

export const companionInitialPlanRunStatusRequestSchema = z.strictObject({
  generationRequestId: z.uuid(),
});
export type CompanionInitialPlanRunStatusRequest = z.infer<
  typeof companionInitialPlanRunStatusRequestSchema
>;

export const companionInitialPlanRunStatusSchema = z.enum([
  'queued',
  'generating',
  'needs_revision',
  'proposal_created',
  'failed',
  'interrupted',
]);
export type CompanionInitialPlanRunStatus = z.infer<typeof companionInitialPlanRunStatusSchema>;

export const companionInitialPlanRunErrorSchema = z.strictObject({
  code: plannerGenerationErrorCodeSchema,
  retryMode: plannerGenerationRetryModeSchema,
  message: z.string().trim().min(1).max(500),
});
export type CompanionInitialPlanRunError = z.infer<typeof companionInitialPlanRunErrorSchema>;

export const companionInitialPlanRunNeedsRevisionSchema = z
  .strictObject({
    planning: z.strictObject({
      errorCount: z.number().int().positive(),
      warningCount: z.number().int().nonnegative(),
      findings: z.array(planningQualityFindingSchema).min(1),
    }),
  })
  .superRefine((evidence, context) => {
    const errorCount = evidence.planning.findings.filter(
      (finding) => finding.severity === 'error',
    ).length;
    const warningCount = evidence.planning.findings.length - errorCount;
    if (
      evidence.planning.errorCount !== errorCount ||
      evidence.planning.warningCount !== warningCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planning'],
        message: 'Planning finding counts must match the deterministic findings',
      });
    }
  });
export type CompanionInitialPlanRunNeedsRevision = z.infer<
  typeof companionInitialPlanRunNeedsRevisionSchema
>;

export const companionInitialPlanRunSchema = z
  .strictObject({
    contractVersion: companionInitialPlanRunContractVersionSchema,
    generationRequestId: z.uuid(),
    goalRequestId: z.uuid(),
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
      displayName: z.string().trim().min(1).max(180),
    }),
    status: companionInitialPlanRunStatusSchema,
    terminal: z.boolean(),
    sceneChanged: z.literal(false),
    proposalId: z.uuid().nullable(),
    error: companionInitialPlanRunErrorSchema.nullable(),
    needsRevision: companionInitialPlanRunNeedsRevisionSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((run, context) => {
    const terminal = !['queued', 'generating'].includes(run.status);
    if (run.terminal !== terminal) {
      context.addIssue({
        code: 'custom',
        path: ['terminal'],
        message: 'terminal must match the initial plan run status',
      });
    }
    if ((run.status === 'proposal_created') !== (run.proposalId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['proposalId'],
        message: 'proposalId is required only for proposal_created runs',
      });
    }
    if ((run.status === 'failed' || run.status === 'interrupted') !== (run.error !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'error evidence is required only for failed or interrupted runs',
      });
    }
    if (run.error?.retryMode === 'same_request_id') {
      context.addIssue({
        code: 'custom',
        path: ['error', 'retryMode'],
        message: 'Terminal initial plan runs cannot retry the same generationRequestId',
      });
    }
    if ((run.status === 'needs_revision') !== (run.needsRevision !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['needsRevision'],
        message: 'needsRevision evidence is required only for needs_revision runs',
      });
    }
  });
export type CompanionInitialPlanRun = z.infer<typeof companionInitialPlanRunSchema>;
