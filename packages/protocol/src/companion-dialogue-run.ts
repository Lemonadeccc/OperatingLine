import { z } from 'zod';

import {
  companionReplanRunErrorSchema,
  companionReplanRunNeedsRevisionSchema,
} from './companion-replan-run.js';
import { replanningPromptContextSchema } from './replanning-provider.js';
import { guideRevisionRequestSchema } from './revision.js';
import { plannerProviderIdSchema } from './provider.js';
import { catalogVersionSchema } from './version.js';

export const companionDialogueRunContractVersion = '1.0.0' as const;
export const companionDialogueRunContractVersionSchema = z.literal(
  companionDialogueRunContractVersion,
);

export const companionDialogueRunDisclosureVersion = '1.0.0' as const;
export const companionDialogueRunDisclosureVersionSchema = z.literal(
  companionDialogueRunDisclosureVersion,
);

export const semanticReplanConfidenceThreshold = 0.8 as const;
export const semanticReplanConfidenceThresholdSchema = z.literal(semanticReplanConfidenceThreshold);
export const plannerDialogueMaximumMessageCharacters = 4_000 as const;

export const plannerDialogueHistoryMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  message: z.string().trim().min(1).max(plannerDialogueMaximumMessageCharacters),
});
export type PlannerDialogueHistoryMessage = z.infer<typeof plannerDialogueHistoryMessageSchema>;

export const plannerDialogueDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('answer') }),
  z.strictObject({
    kind: z.literal('replan'),
    confidence: z.number().min(0).max(1),
  }),
]);
export type PlannerDialogueDecision = z.infer<typeof plannerDialogueDecisionSchema>;

export const plannerDialogueProviderResultSchema = z
  .strictObject({
    assistantMessage: z.string().max(plannerDialogueMaximumMessageCharacters),
    decision: plannerDialogueDecisionSchema,
  })
  .superRefine((result, context) => {
    if (result.assistantMessage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['assistantMessage'],
        message: 'A dialogue result requires a non-empty assistant message',
      });
    }
  });
export type PlannerDialogueProviderResult = z.infer<typeof plannerDialogueProviderResultSchema>;

export const plannerDialoguePromptFormatVersion = '1.0.0' as const;
export const plannerDialoguePromptFormatVersionSchema = z.literal(
  plannerDialoguePromptFormatVersion,
);

export const plannerDialoguePromptPacketSchema = z.strictObject({
  formatVersion: plannerDialoguePromptFormatVersionSchema,
  operation: z.literal('semantic_replan_dialogue'),
  context: z.strictObject({
    replanning: replanningPromptContextSchema,
    history: z.array(plannerDialogueHistoryMessageSchema).max(12),
  }),
  workflow: z.strictObject({
    replanToolName: z.literal('request_replan'),
    confidenceThreshold: semanticReplanConfidenceThresholdSchema,
    instructions: z.array(z.string().trim().min(1)).min(1),
  }),
  renderedPrompt: z.string().trim().min(1),
});
export type PlannerDialoguePromptPacket = z.infer<typeof plannerDialoguePromptPacketSchema>;

export const companionDialogueRunCreateRequestSchema = z
  .strictObject({
    dialogueRequestId: z.uuid(),
    replanGenerationRequestId: z.uuid(),
    providerId: plannerProviderIdSchema,
    providerVersion: catalogVersionSchema,
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    revisionRequest: guideRevisionRequestSchema,
    history: z.array(plannerDialogueHistoryMessageSchema).max(12),
    authorization: z.strictObject({
      disclosureVersion: companionDialogueRunDisclosureVersionSchema,
      dataHandlingAcknowledged: z.literal(true),
      possibleChargesAcknowledged: z.literal(true),
      authorizedProviderCallLimit: z.literal(2),
      automaticReplanAcknowledged: z.literal(true),
      proposalCreationAcknowledged: z.literal(true),
      authorizedAt: z.iso.datetime({ offset: true }),
    }),
  })
  .superRefine((request, context) => {
    const ids = [
      request.dialogueRequestId,
      request.replanGenerationRequestId,
      request.revisionRequest.requestId,
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['dialogueRequestId'],
        message: 'Dialogue, revision, and replan generation request ids must be distinct',
      });
    }
    if (
      request.revisionRequest.adapterId !== request.targetAdapterId ||
      request.revisionRequest.instanceId !== request.targetInstanceId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revisionRequest'],
        message: 'The candidate revision request must match the authorized host target',
      });
    }
    if (request.revisionRequest.revisionOperation?.kind !== 'revise') {
      context.addIssue({
        code: 'custom',
        path: ['revisionRequest', 'revisionOperation'],
        message: 'Semantic dialogue supports the revise operation only',
      });
    }
    for (const [index, message] of request.history.entries()) {
      const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
      if (message.role !== expectedRole) {
        context.addIssue({
          code: 'custom',
          path: ['history', index, 'role'],
          message: `Dialogue history entry ${index + 1} must use role ${expectedRole}`,
        });
      }
    }
    if (
      request.history.length > 0 &&
      request.history[request.history.length - 1]?.role !== 'assistant'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'Dialogue history must end with an assistant response',
      });
    }
  });
export type CompanionDialogueRunCreateRequest = z.infer<
  typeof companionDialogueRunCreateRequestSchema
>;

export const companionDialogueRunStatusRequestSchema = z.strictObject({
  dialogueRequestId: z.uuid(),
});
export type CompanionDialogueRunStatusRequest = z.infer<
  typeof companionDialogueRunStatusRequestSchema
>;

export const companionDialogueRunStatusSchema = z.enum([
  'queued',
  'streaming',
  'replanning',
  'answered',
  'needs_revision',
  'proposal_created',
  'failed',
  'interrupted',
]);
export type CompanionDialogueRunStatus = z.infer<typeof companionDialogueRunStatusSchema>;

export const companionDialogueSemanticDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('answer'),
    replanConfidence: z.number().min(0).lt(semanticReplanConfidenceThreshold).nullable(),
    threshold: semanticReplanConfidenceThresholdSchema,
  }),
  z.strictObject({
    kind: z.literal('replan'),
    confidence: z.number().min(semanticReplanConfidenceThreshold).max(1),
    threshold: semanticReplanConfidenceThresholdSchema,
  }),
]);
export type CompanionDialogueSemanticDecision = z.infer<
  typeof companionDialogueSemanticDecisionSchema
>;

export const companionDialogueRunSchema = z
  .strictObject({
    contractVersion: companionDialogueRunContractVersionSchema,
    dialogueRequestId: z.uuid(),
    revisionRequestId: z.uuid(),
    replanGenerationRequestId: z.uuid(),
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
      displayName: z.string().trim().min(1).max(180),
    }),
    status: companionDialogueRunStatusSchema,
    terminal: z.boolean(),
    sceneChanged: z.literal(false),
    assistantMessage: z.string().max(plannerDialogueMaximumMessageCharacters),
    assistantMessageRevision: z.number().int().nonnegative(),
    semanticDecision: companionDialogueSemanticDecisionSchema.nullable(),
    revisionRequestRecorded: z.boolean(),
    proposalId: z.uuid().nullable(),
    error: companionReplanRunErrorSchema.nullable(),
    needsRevision: companionReplanRunNeedsRevisionSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((run, context) => {
    const terminal = [
      'answered',
      'needs_revision',
      'proposal_created',
      'failed',
      'interrupted',
    ].includes(run.status);
    if (run.terminal !== terminal) {
      context.addIssue({
        code: 'custom',
        path: ['terminal'],
        message: 'terminal must match the dialogue run status',
      });
    }
    if ((run.status === 'proposal_created') !== (run.proposalId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['proposalId'],
        message: 'proposalId is required only for proposal_created dialogue runs',
      });
    }
    if ((run.status === 'needs_revision') !== (run.needsRevision !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['needsRevision'],
        message: 'needsRevision evidence is required only for needs_revision dialogue runs',
      });
    }
    const failed = run.status === 'failed' || run.status === 'interrupted';
    if (failed !== (run.error !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Safe error evidence is required only for failed or interrupted dialogue runs',
      });
    }
    if (run.error?.retryMode === 'same_request_id') {
      context.addIssue({
        code: 'custom',
        path: ['error', 'retryMode'],
        message: 'Terminal dialogue runs cannot retry the same request id',
      });
    }

    const requiresDecision = [
      'replanning',
      'answered',
      'needs_revision',
      'proposal_created',
    ].includes(run.status);
    if ((run.assistantMessage.length === 0) !== (run.assistantMessageRevision === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['assistantMessageRevision'],
        message: 'Assistant text and its durable revision must advance together',
      });
    }
    if (requiresDecision && run.assistantMessage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['assistantMessage'],
        message: 'Classified dialogue runs require a user-facing assistant message',
      });
    }
    if (requiresDecision && run.semanticDecision === null) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'The dialogue decision is required after semantic classification',
      });
    }
    if (['queued', 'streaming'].includes(run.status) && run.semanticDecision !== null) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'A dialogue decision is not available before semantic classification',
      });
    }
    if (run.status === 'answered' && run.semanticDecision?.kind !== 'answer') {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Answered dialogue runs require an answer decision',
      });
    }
    if (
      ['replanning', 'needs_revision', 'proposal_created'].includes(run.status) &&
      run.semanticDecision?.kind !== 'replan'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Replanning dialogue phases require a threshold-approved replan decision',
      });
    }
    if (
      ['replanning', 'needs_revision', 'proposal_created'].includes(run.status) &&
      !run.revisionRequestRecorded
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revisionRequestRecorded'],
        message: 'Replanning dialogue phases require a durable revision request',
      });
    }
    if (run.status === 'answered' && run.revisionRequestRecorded) {
      context.addIssue({
        code: 'custom',
        path: ['revisionRequestRecorded'],
        message: 'Answer-only dialogue runs must not create revision requests',
      });
    }
  });
export type CompanionDialogueRun = z.infer<typeof companionDialogueRunSchema>;
