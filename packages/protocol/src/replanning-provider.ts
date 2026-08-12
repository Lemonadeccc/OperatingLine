import { z } from 'zod';

import { actionCatalogSchema } from './catalog.js';
import { companionStateReportSchema } from './companion.js';
import { guidePlanDiffSchema } from './diff.js';
import { guidePlanSchema, guideStepIdSchema } from './guide.js';
import { planningIntentSchema, planningQualityReportSchema } from './planning.js';
import {
  plannerGenerationErrorCodeSchema,
  plannerGenerationFormatVersionSchema,
  plannerGenerationStatusSchema,
  plannerProviderIdSchema,
} from './provider.js';
import { guideReplanSubmissionSchema, guideRevisionRequestSchema } from './revision.js';
import { catalogVersionSchema } from './version.js';

const uniqueStepIdsSchema = z.array(guideStepIdSchema).superRefine((stepIds, context) => {
  if (new Set(stepIds).size !== stepIds.length) {
    context.addIssue({ code: 'custom', message: 'Step ids must be unique' });
  }
});

export const localReplanScopePolicyVersion = 'referenced_subtrees_v1' as const;
export const localReplanScopeSchema = z
  .strictObject({
    policyVersion: z.literal(localReplanScopePolicyVersion),
    mode: z.literal('referenced_subtrees'),
    referencedRootIds: uniqueStepIdsSchema.min(1).max(8),
    normalizedRootIds: uniqueStepIdsSchema.min(1).max(8),
    rules: z.strictObject({
      completePlanRequired: z.literal(true),
      planTitleMutable: z.literal(false),
      rootStepIdMutable: z.literal(false),
      outsideScopeMutable: z.literal(false),
      referencedRootAttachmentMutable: z.literal(false),
      descendantMoves: z.literal('within_same_normalized_root'),
      newSteps: z.literal('within_normalized_roots'),
      noOpAllowed: z.literal(false),
    }),
  })
  .superRefine((scope, context) => {
    const referenced = new Set(scope.referencedRootIds);
    for (const rootId of scope.normalizedRootIds) {
      if (!referenced.has(rootId)) {
        context.addIssue({
          code: 'custom',
          path: ['normalizedRootIds'],
          message: `Normalized root ${rootId} must come from the referenced roots`,
        });
      }
    }
  });
export type LocalReplanScope = z.infer<typeof localReplanScopeSchema>;

export const replanningPromptRequestSchema = z.strictObject({
  revisionRequestId: z.uuid(),
});
export type ReplanningPromptRequest = z.infer<typeof replanningPromptRequestSchema>;

export const guideRevisionMergeContextSchema = z.strictObject({
  sourceThreadId: z.uuid(),
  sourceRequestId: z.uuid(),
  commonAncestorRequestId: z.uuid(),
  commonAncestorPlan: guidePlanSchema,
  sourcePlan: guidePlanSchema,
  expectedMergedPlan: guidePlanSchema,
});
export type GuideRevisionMergeContext = z.infer<typeof guideRevisionMergeContextSchema>;

export const replanningPromptContextSchema = z
  .strictObject({
    revisionRequest: guideRevisionRequestSchema,
    targetRevision: z.number().int().positive(),
    catalog: actionCatalogSchema,
    companionState: companionStateReportSchema.nullable(),
    scope: localReplanScopeSchema,
    merge: guideRevisionMergeContextSchema.optional(),
  })
  .superRefine((context, refinement) => {
    const request = context.revisionRequest;
    const operation = request.revisionOperation;
    if ((operation?.kind === 'merge') !== (context.merge !== undefined)) {
      refinement.addIssue({
        code: 'custom',
        path: ['merge'],
        message: 'Replanning merge context must be present exactly for a branch merge',
      });
    }
    if (
      operation?.kind === 'merge' &&
      context.merge !== undefined &&
      (context.merge.sourceThreadId !== operation.sourceThreadId ||
        context.merge.sourceRequestId !== operation.sourceRequestId)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['merge'],
        message: 'Replanning merge context must match the immutable merge request',
      });
    }
    if (
      context.catalog.adapterId !== request.adapterId ||
      context.catalog.catalogVersion !== request.catalogVersion
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['catalog'],
        message: 'Replanning catalog must exactly match the immutable revision request',
      });
    }
    if (context.targetRevision <= request.basePlan.revision) {
      refinement.addIssue({
        code: 'custom',
        path: ['targetRevision'],
        message: 'Replanning target revision must be newer than the immutable base plan',
      });
    }
    if (
      context.merge !== undefined &&
      (context.merge.expectedMergedPlan.id !== request.basePlan.id ||
        context.merge.expectedMergedPlan.revision !== context.targetRevision ||
        context.merge.sourcePlan.id !== request.basePlan.id ||
        context.merge.commonAncestorPlan.id !== request.basePlan.id)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['merge'],
        message: 'Merge Plans must share the request Plan id and exact target revision',
      });
    }
    const referencedIds = request.references.map((reference) => reference.nodeId);
    if (
      referencedIds.length !== context.scope.referencedRootIds.length ||
      referencedIds.some((stepId, index) => stepId !== context.scope.referencedRootIds[index])
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['scope', 'referencedRootIds'],
        message: 'Replanning scope roots must preserve the revision request reference order',
      });
    }
    if (
      context.companionState !== null &&
      (context.companionState.adapterId !== request.adapterId ||
        context.companionState.instanceId !== request.instanceId)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['companionState'],
        message: 'Replanning companion state must belong to the exact requesting host instance',
      });
    }
  });
export type ReplanningPromptContext = z.infer<typeof replanningPromptContextSchema>;

export const plannerReplanDraftSchema = guideReplanSubmissionSchema
  .omit({ generationRequestId: true })
  .extend({ planning: planningIntentSchema });
export type PlannerReplanDraft = z.infer<typeof plannerReplanDraftSchema>;

export const supportedReplanningPromptFormatVersions = ['1.0.0', '1.1.0'] as const;
export const replanningPromptFormatVersion = '1.1.0' as const;
export const replanningPromptFormatVersionSchema = z.enum(supportedReplanningPromptFormatVersions);
const replanningPromptPacketJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: {
          context: {
            type: 'object',
            properties: {
              catalog: { type: 'object', required: ['semanticCapabilities'] },
            },
            required: ['catalog'],
          },
        },
        required: ['context'],
      },
      then: { type: 'object', properties: { formatVersion: { const: '1.1.0' } } },
      else: { type: 'object', properties: { formatVersion: { const: '1.0.0' } } },
    },
  ],
} as const;

export const replanningPromptPacketSchema = z
  .strictObject({
    formatVersion: replanningPromptFormatVersionSchema,
    operation: z.literal('local_replan'),
    context: replanningPromptContextSchema,
    responseContract: z.strictObject({
      mediaType: z.literal('application/json'),
      schema: z.record(z.string(), z.json()),
    }),
    workflow: z.strictObject({
      evaluateToolName: z.literal('operatingline.planning.evaluate'),
      submitToolName: z.literal('operatingline.replan.propose'),
      instructions: z.array(z.string().min(1)).min(1),
    }),
    renderedPrompt: z.string().min(1),
  })
  .superRefine((packet, context) => {
    const expectedFormatVersion =
      packet.context.catalog.semanticCapabilities === undefined
        ? '1.0.0'
        : replanningPromptFormatVersion;
    if (packet.formatVersion !== expectedFormatVersion) {
      context.addIssue({
        code: 'custom',
        path: ['formatVersion'],
        message:
          'Replanning packet format must be 1.1.0 if and only if semantic capabilities exist',
      });
    }
  })
  .meta(replanningPromptPacketJsonSchemaMetadata);
export type ReplanningPromptPacket = z.infer<typeof replanningPromptPacketSchema>;

export const localReplanFindingCodeSchema = z.enum([
  'plan_structure_invalid',
  'plan_title_changed',
  'root_step_changed',
  'scope_root_missing',
  'scope_root_attachment_changed',
  'step_changed_outside_scope',
  'step_added_outside_scope',
  'step_moved_across_scope',
  'parameter_edit_not_applied',
  'merge_result_mismatch',
  'no_local_change',
]);
export type LocalReplanFindingCode = z.infer<typeof localReplanFindingCodeSchema>;

export const localReplanFindingSchema = z.strictObject({
  code: localReplanFindingCodeSchema,
  message: z.string().min(1),
  stepIds: uniqueStepIdsSchema,
});
export type LocalReplanFinding = z.infer<typeof localReplanFindingSchema>;

export const localReplanLocalityReportSchema = z
  .strictObject({
    policyVersion: z.literal(localReplanScopePolicyVersion),
    basePlan: z.strictObject({
      id: z.string().min(1),
      revision: z.number().int().positive(),
    }),
    targetPlan: z.strictObject({
      id: z.string().min(1),
      revision: z.number().int().positive(),
    }),
    scopeRootIds: uniqueStepIdsSchema.min(1).max(8),
    valid: z.boolean(),
    findings: z.array(localReplanFindingSchema),
  })
  .superRefine((report, context) => {
    if (report.valid !== (report.findings.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['valid'],
        message: 'Local replanning validity must match the deterministic findings',
      });
    }
  });
export type LocalReplanLocalityReport = z.infer<typeof localReplanLocalityReportSchema>;

export const plannerReplanGenerateRequestSchema = replanningPromptRequestSchema
  .extend({
    requestId: z.uuid(),
    providerId: plannerProviderIdSchema,
  })
  .superRefine((request, context) => {
    if (request.requestId === request.revisionRequestId) {
      context.addIssue({
        code: 'custom',
        path: ['requestId'],
        message: 'Provider generation requestId must differ from the host revisionRequestId',
      });
    }
  });
export type PlannerReplanGenerateRequest = z.infer<typeof plannerReplanGenerateRequestSchema>;

const plannerReplanGenerationResultJsonSchemaMetadata = {
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
        properties: { status: { const: 'ready' } },
        required: ['status'],
      },
      then: {
        type: 'object',
        properties: {
          locality: {
            type: 'object',
            properties: { valid: { const: true } },
            required: ['valid'],
          },
          planDiff: { type: 'object' },
          planningQuality: {
            properties: { valid: { const: true } },
            required: ['valid'],
          },
        },
      },
      else: {
        anyOf: [
          {
            type: 'object',
            properties: {
              locality: {
                type: 'object',
                properties: { valid: { const: false } },
                required: ['valid'],
              },
            },
          },
          { type: 'object', properties: { planDiff: { type: 'null' } } },
          {
            type: 'object',
            properties: {
              planningQuality: {
                type: 'object',
                properties: { valid: { const: false } },
                required: ['valid'],
              },
            },
          },
        ],
      },
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

export const plannerReplanGenerationResultSchema = z
  .strictObject({
    formatVersion: plannerGenerationFormatVersionSchema,
    generationId: z.uuid(),
    requestId: z.uuid(),
    revisionRequestId: z.uuid(),
    targetAdapterId: z.string().trim().min(1).max(180),
    targetInstanceId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
    }),
    packetFormatVersion: replanningPromptFormatVersionSchema,
    status: plannerGenerationStatusSchema,
    draft: plannerReplanDraftSchema,
    planDiff: guidePlanDiffSchema.nullable(),
    planningQuality: planningQualityReportSchema,
    locality: localReplanLocalityReportSchema,
    proposalCreated: z.literal(false),
    generatedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((result, context) => {
    const draft = result.draft;
    const quality = result.planningQuality;
    const locality = result.locality;
    const requiredPhasesMatch =
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
        message:
          'Replanning packet format version must match the planning quality baseline version',
      });
    }
    if (
      draft.requestId !== result.revisionRequestId ||
      quality.targetAdapterId !== result.targetAdapterId ||
      quality.catalogVersion !== draft.catalogVersion ||
      quality.goal !== draft.planning.goal ||
      quality.plan.id !== draft.plan.id ||
      quality.plan.revision !== draft.plan.revision ||
      locality.basePlan.id !== draft.plan.id ||
      locality.targetPlan.id !== draft.plan.id ||
      locality.targetPlan.revision !== draft.plan.revision ||
      !requiredPhasesMatch ||
      !capabilityCoverageMatches
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Replan generation evidence must describe the exact generated draft',
      });
    }
    if (
      result.planDiff !== null &&
      (result.planDiff.basePlan.id !== locality.basePlan.id ||
        result.planDiff.basePlan.revision !== locality.basePlan.revision ||
        result.planDiff.targetPlan.id !== draft.plan.id ||
        result.planDiff.targetPlan.revision !== draft.plan.revision)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planDiff'],
        message: 'Replan diff references must match the locality evidence and generated draft',
      });
    }
    const ready = quality.valid && locality.valid && result.planDiff !== null;
    if (result.status !== (ready ? 'ready' : 'needs_revision')) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Replan status must match quality, locality, and diff validity',
      });
    }
  })
  .meta(plannerReplanGenerationResultJsonSchemaMetadata);
export type PlannerReplanGenerationResult = z.infer<typeof plannerReplanGenerationResultSchema>;

const plannerReplanEventScopeSchema = z.strictObject({
  requestId: z.uuid(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  revisionRequestId: z.uuid(),
  providerId: plannerProviderIdSchema,
  providerVersion: catalogVersionSchema,
  targetAdapterId: z.string().trim().min(1).max(180),
  targetInstanceId: z.uuid(),
  catalogVersion: catalogVersionSchema,
  planId: z.string().trim().min(1).max(180),
  baseRevision: z.number().int().positive(),
});

export const plannerReplanRequestedEventSchema = plannerReplanEventScopeSchema.extend({
  packetFormatVersion: replanningPromptFormatVersionSchema,
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlannerReplanRequestedEvent = z.infer<typeof plannerReplanRequestedEventSchema>;

export const plannerReplanCompletedEventSchema = z
  .strictObject({
    request: plannerReplanGenerateRequestSchema,
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    result: plannerReplanGenerationResultSchema,
  })
  .superRefine((event, context) => {
    if (
      event.result.requestId !== event.request.requestId ||
      event.result.revisionRequestId !== event.request.revisionRequestId ||
      event.result.provider.id !== event.request.providerId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed replan evidence must match its exact provider request',
      });
    }
  });
export type PlannerReplanCompletedEvent = z.infer<typeof plannerReplanCompletedEventSchema>;

export const plannerReplanFailedEventSchema = plannerReplanEventScopeSchema.extend({
  error: plannerGenerationErrorCodeSchema,
  durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlannerReplanFailedEvent = z.infer<typeof plannerReplanFailedEventSchema>;

export const plannerReplanProposedEventSchema = z.strictObject({
  generationRequestId: z.uuid(),
  revisionRequestId: z.uuid(),
  proposalId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlannerReplanProposedEvent = z.infer<typeof plannerReplanProposedEventSchema>;
