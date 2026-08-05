import { z } from 'zod';

import {
  plannerGenerationErrorCodeSchema,
  plannerGenerationRetryModeSchema,
  plannerProviderIdSchema,
} from './provider.js';
import { planningQualityFindingSchema } from './planning.js';
import { localReplanFindingSchema } from './replanning-provider.js';
import { catalogVersionSchema } from './version.js';

export const companionReplanRunContractVersion = '1.0.0' as const;
export const companionReplanRunContractVersionSchema = z.literal(companionReplanRunContractVersion);

export const companionReplanRunDisclosureVersion = '1.0.0' as const;
export const companionReplanRunDisclosureVersionSchema = z.literal(
  companionReplanRunDisclosureVersion,
);

export const companionReplanRunCreateRequestSchema = z
  .strictObject({
    generationRequestId: z.uuid(),
    revisionRequestId: z.uuid(),
    providerId: plannerProviderIdSchema,
    providerVersion: catalogVersionSchema,
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    authorization: z.strictObject({
      disclosureVersion: companionReplanRunDisclosureVersionSchema,
      dataHandlingAcknowledged: z.literal(true),
      possibleChargesAcknowledged: z.literal(true),
      proposalCreationAcknowledged: z.literal(true),
      authorizedAt: z.iso.datetime({ offset: true }),
    }),
  })
  .superRefine((request, context) => {
    if (request.generationRequestId === request.revisionRequestId) {
      context.addIssue({
        code: 'custom',
        path: ['generationRequestId'],
        message: 'generationRequestId must differ from revisionRequestId',
      });
    }
  });
export type CompanionReplanRunCreateRequest = z.infer<typeof companionReplanRunCreateRequestSchema>;

export const companionReplanRunStatusRequestSchema = z.strictObject({
  generationRequestId: z.uuid(),
});
export type CompanionReplanRunStatusRequest = z.infer<typeof companionReplanRunStatusRequestSchema>;

export const companionReplanRunStatusSchema = z.enum([
  'queued',
  'generating',
  'needs_revision',
  'proposal_created',
  'failed',
  'interrupted',
]);
export type CompanionReplanRunStatus = z.infer<typeof companionReplanRunStatusSchema>;

export const companionReplanRunErrorSchema = z.strictObject({
  code: plannerGenerationErrorCodeSchema,
  retryMode: plannerGenerationRetryModeSchema,
  message: z.string().trim().min(1).max(500),
});
export type CompanionReplanRunError = z.infer<typeof companionReplanRunErrorSchema>;

export const companionReplanRunNeedsRevisionSchema = z
  .strictObject({
    planning: z.strictObject({
      errorCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative(),
      findings: z.array(planningQualityFindingSchema),
    }),
    locality: z.strictObject({
      valid: z.boolean(),
      findings: z.array(localReplanFindingSchema),
    }),
    planDiffAvailable: z.boolean(),
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
    if (evidence.locality.valid !== (evidence.locality.findings.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['locality', 'valid'],
        message: 'Locality validity must match the deterministic findings',
      });
    }
    if (errorCount === 0 && evidence.locality.valid && evidence.planDiffAvailable) {
      context.addIssue({
        code: 'custom',
        message: 'needsRevision evidence must identify a deterministic blocking condition',
      });
    }
  });
export type CompanionReplanRunNeedsRevision = z.infer<typeof companionReplanRunNeedsRevisionSchema>;

export const companionReplanRunSchema = z
  .strictObject({
    contractVersion: companionReplanRunContractVersionSchema,
    generationRequestId: z.uuid(),
    revisionRequestId: z.uuid(),
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
      displayName: z.string().trim().min(1).max(180),
    }),
    status: companionReplanRunStatusSchema,
    terminal: z.boolean(),
    sceneChanged: z.literal(false),
    proposalId: z.uuid().nullable(),
    error: companionReplanRunErrorSchema.nullable(),
    needsRevision: companionReplanRunNeedsRevisionSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((run, context) => {
    const terminal = !['queued', 'generating'].includes(run.status);
    if (run.terminal !== terminal) {
      context.addIssue({
        code: 'custom',
        path: ['terminal'],
        message: 'terminal must match the replan run status',
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
        message: 'Terminal replan runs cannot retry the same generationRequestId',
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
export type CompanionReplanRun = z.infer<typeof companionReplanRunSchema>;
