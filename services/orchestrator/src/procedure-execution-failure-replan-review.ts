import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  actionCatalogSchema,
  canonicalizeProtocolJsonValue,
  guideExecutionTrackOverrideSchema,
  guidePlanSchema,
  guideProposalSchema,
  guideProtocolVersion,
  guideRevisionRequestSchema,
  interactionCatalogSchema,
  validateActionArguments,
  validateActionCatalog,
  validateInteractionCatalog,
  type ActionCatalog,
  type GuidePlan,
  type InteractionCatalog,
} from '@operatingline/protocol';
import { z } from 'zod';

import { computeGuidePlanDiff } from './guide-plan-diff.js';
import {
  guidePlanNodeNumbers,
  validateGuidePlanAgainstActionCatalog,
  validateGuideRevisionRequest,
  validateProposalTarget,
} from './guide-validation.js';
import {
  procedureExecutionFailureProposalSchema,
  procedureExecutionFailureReplanOutcomeSchema,
  type ProcedureExecutionFailureProposal,
  type ProcedureExecutionFailureReplanOutcome,
} from './procedure-execution-failure-replan.js';
import type { ProcedureExecutionProofStrategyBinding } from './procedure-execution-failure-replan-runtime.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.iso.datetime({ offset: true });

export const procedureExecutionFailureReplanReviewPreviewRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type ProcedureExecutionFailureReplanReviewPreviewRequest = z.infer<
  typeof procedureExecutionFailureReplanReviewPreviewRequestSchema
>;

const unavailableReasonSchema = z.enum(['no_proposal', 'stale_current_evidence', 'catalog_drift']);

const acceptanceUnavailableReasonSchema = z.enum([
  'proposal_expired',
  'invalid_parameter_repair',
  'invalid_strategy_switch',
  'legacy_strategy_binding_not_execution_authoritative',
  'semantic_replan_requires_signed_provider_authority',
]);

const trustedStrategyTrackCandidateSchema = z.strictObject({
  semanticLeafId: z.string().trim().min(1).max(256),
  recipeId: z.string().trim().min(1).max(256),
  modality: z.enum(['menu', 'shortcut']),
  trackId: z.string().trim().min(1).max(256),
  verifiedTrackContentSha256: sha256Schema,
  trackContentSha256: sha256Schema,
  proofExecutionContentSha256: sha256Schema,
  observationObligations: z
    .array(
      z.strictObject({
        kind: z.string().trim().min(1).max(256),
        parameters: z.record(z.string(), z.json()),
      }),
    )
    .min(1)
    .max(32),
});

const trustedStrategyBindingSchema = z.strictObject({
  currentTrackId: z.string().trim().min(1).max(256),
  currentTrackContentSha256: sha256Schema,
  candidates: z.array(trustedStrategyTrackCandidateSchema).max(16),
});

const reviewArtifactsSchema = z.strictObject({
  revisedPlan: guidePlanSchema,
  revisionRequest: guideRevisionRequestSchema,
  guideProposal: guideProposalSchema,
});

export const procedureExecutionFailureReplanReviewEvidenceBindingSchema = z.strictObject({
  candidateContentSha256: sha256Schema,
  candidateEventContentSha256: sha256Schema,
  sourceBindingSha256: sha256Schema,
  terminalActionEventContentSha256: sha256Schema,
  replayBindingContentSha256: sha256Schema,
  rollbackAttestationContentSha256: sha256Schema,
  actionCatalogVersion: z.string().trim().min(1),
  actionCatalogContentSha256: sha256Schema,
  interactionCatalogVersion: z.string().trim().min(1),
  interactionCatalogContentSha256: sha256Schema,
  adapterId: z.string().trim().min(1),
  instanceId: z.uuid(),
  failedStepId: z.string().trim().min(1).max(256),
  basePlanId: z.string().trim().min(1),
  basePlanRevision: z.number().int().positive(),
  basePlanContentSha256: sha256Schema,
  strategyTrackBinding: z
    .strictObject({
      currentTrackId: z.string().trim().min(1).max(256),
      currentTrackContentSha256: sha256Schema,
      target: trustedStrategyTrackCandidateSchema.omit({ observationObligations: true }),
    })
    .optional(),
});
export type ProcedureExecutionFailureReplanReviewEvidenceBinding = z.infer<
  typeof procedureExecutionFailureReplanReviewEvidenceBindingSchema
>;

export const procedureExecutionFailureReplanReviewPreviewSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('unavailable'),
    requestId: z.uuid(),
    reason: unavailableReasonSchema,
  }),
  z.strictObject({
    status: z.literal('reviewable'),
    requestId: z.uuid(),
    proposal: procedureExecutionFailureProposalSchema,
    evidenceBinding: procedureExecutionFailureReplanReviewEvidenceBindingSchema,
    reviewBindingSha256: sha256Schema,
    acceptance: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('available'), artifacts: reviewArtifactsSchema }),
      z.strictObject({
        status: z.literal('unavailable'),
        reason: acceptanceUnavailableReasonSchema,
      }),
    ]),
  }),
]);
export type ProcedureExecutionFailureReplanReviewPreview = z.infer<
  typeof procedureExecutionFailureReplanReviewPreviewSchema
>;

export const procedureExecutionFailureReplanReviewRequestSchema = z.strictObject({
  formatVersion: z.literal('1.0.0'),
  requestId: z.uuid(),
  reviewId: z.uuid(),
  proposalId: z.uuid(),
  reviewBindingSha256: sha256Schema,
  decision: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('accept'),
      confirmations: z.strictObject({
        exactCandidateReviewed: z.literal(true),
        exactBasePlanReviewed: z.literal(true),
        noProviderCallAcknowledged: z.literal(true),
        noHostExecutionAcknowledged: z.literal(true),
      }),
    }),
    z.strictObject({
      kind: z.literal('discard'),
      reason: z.string().trim().min(1).max(1_000).optional(),
    }),
  ]),
  reviewedAt: instantSchema,
});
export type ProcedureExecutionFailureReplanReviewRequest = z.infer<
  typeof procedureExecutionFailureReplanReviewRequestSchema
>;

export const procedureExecutionFailureReplanReviewResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('discarded'),
    requestId: z.uuid(),
    reviewId: z.uuid(),
    proposalId: z.uuid(),
    evidenceBinding: procedureExecutionFailureReplanReviewEvidenceBindingSchema,
    reviewBindingSha256: sha256Schema,
    discardedAt: instantSchema,
  }),
  z.strictObject({
    status: z.literal('accepted'),
    requestId: z.uuid(),
    reviewId: z.uuid(),
    proposalId: z.uuid(),
    evidenceBinding: procedureExecutionFailureReplanReviewEvidenceBindingSchema,
    reviewBindingSha256: sha256Schema,
    acceptedAt: instantSchema,
    artifacts: reviewArtifactsSchema,
  }),
]);
export type ProcedureExecutionFailureReplanReviewResult = z.infer<
  typeof procedureExecutionFailureReplanReviewResultSchema
>;

export const procedureExecutionFailureReplanReviewedEventSchema = z
  .strictObject({
    formatVersion: z.literal('1.0.0'),
    operation: z.literal('procedure_execution_failure_replan_review'),
    requestId: z.uuid(),
    reviewId: z.uuid(),
    requestFingerprintSha256: sha256Schema,
    reviewBinding: procedureExecutionFailureReplanReviewEvidenceBindingSchema.safeExtend({
      reviewEvidenceBindingSha256: sha256Schema,
      reviewer: z.strictObject({
        authentication: z.literal('negotiated_companion_lease'),
        sessionFingerprintSha256: sha256Schema,
      }),
    }),
    reviewRequest: procedureExecutionFailureReplanReviewRequestSchema,
    finalStatus: z.enum(['accepted', 'discarded']),
    revisionRequestId: z.uuid().nullable(),
    guideProposalId: z.uuid().nullable(),
    acceptedArtifacts: z
      .strictObject({
        revisionRequestContentSha256: sha256Schema,
        guideProposalContentSha256: sha256Schema,
        executionTrackOverrideContentSha256: sha256Schema.nullable(),
      })
      .optional(),
    proposalCreated: z.boolean(),
    providerCalled: z.literal(false),
    hostExecutionStarted: z.literal(false),
    occurredAt: instantSchema,
  })
  .superRefine((event, context) => {
    const accepted = event.finalStatus === 'accepted';
    if (
      event.requestId !== event.reviewRequest.requestId ||
      event.reviewId !== event.reviewRequest.reviewId ||
      event.reviewBinding.reviewEvidenceBindingSha256 !== event.reviewRequest.reviewBindingSha256 ||
      event.occurredAt !== event.reviewRequest.reviewedAt ||
      accepted !== (event.reviewRequest.decision.kind === 'accept') ||
      accepted !== event.proposalCreated ||
      accepted !== (event.revisionRequestId !== null) ||
      accepted !== (event.guideProposalId !== null) ||
      (!accepted && event.acceptedArtifacts !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Failure replan reviewed event must bind its exact request and side effects',
      });
    }
  });
export type ProcedureExecutionFailureReplanReviewedEvent = z.infer<
  typeof procedureExecutionFailureReplanReviewedEventSchema
>;

export const procedureExecutionFailureReplanReviewStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('pending'),
    preview: procedureExecutionFailureReplanReviewPreviewSchema,
  }),
  z.strictObject({
    state: z.literal('reviewed'),
    review: procedureExecutionFailureReplanReviewedEventSchema,
  }),
]);

export const procedureExecutionFailureReplanReviewCommitResponseSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
  review: procedureExecutionFailureReplanReviewedEventSchema,
});

export interface TrustedProcedureExecutionFailureReplanReviewEvidence {
  readonly currentPlan: GuidePlan;
  readonly failedStepId: string;
  readonly targetAdapterId: string;
  readonly targetInstanceId: string;
  readonly actionCatalog: ActionCatalog;
  readonly interactionCatalog: InteractionCatalog;
  readonly candidateEventContentSha256: string;
  readonly sourceBindingSha256: string;
  readonly terminalActionEventContentSha256: string;
  readonly replayBindingContentSha256: string;
  readonly rollbackAttestationContentSha256: string;
  readonly strategyBinding?: ProcedureExecutionProofStrategyBinding | null;
}

export interface ProcedureExecutionFailureReplanReviewEvidenceResolver {
  resolve(requestId: string): TrustedProcedureExecutionFailureReplanReviewEvidence | null;
}

export interface ProcedureExecutionFailureReplanOutcomeReader {
  get(requestId: string): ProcedureExecutionFailureReplanOutcome | null;
}

export interface ProcedureExecutionFailureReplanReviewCoordinatorOptions {
  readonly outcomes: ProcedureExecutionFailureReplanOutcomeReader;
  readonly trustedEvidence: ProcedureExecutionFailureReplanReviewEvidenceResolver;
  readonly resolveTargetRevision?: (planId: string, baseRevision: number) => number;
  readonly now?: () => string;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function deterministicUuid(namespace: string, value: unknown): string {
  const digest = createHash('sha256')
    .update(namespace)
    .update('\0')
    .update(canonicalizeProtocolJsonValue(value))
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function proposalContent(proposal: ProcedureExecutionFailureProposal): Record<string, unknown> {
  return Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== 'integrity'));
}

function normalizeEvidence(
  input: TrustedProcedureExecutionFailureReplanReviewEvidence | null,
): TrustedProcedureExecutionFailureReplanReviewEvidence | null {
  if (input === null) return null;
  const currentPlan = guidePlanSchema.safeParse(input.currentPlan);
  const actionCatalog = actionCatalogSchema.safeParse(input.actionCatalog);
  const interactionCatalog = interactionCatalogSchema.safeParse(input.interactionCatalog);
  const targetAdapterId = z.string().trim().min(1).safeParse(input.targetAdapterId);
  const targetInstanceId = z.uuid().safeParse(input.targetInstanceId);
  const failedStepId = z.string().trim().min(1).max(256).safeParse(input.failedStepId);
  const evidenceHashes = z
    .strictObject({
      candidateEventContentSha256: sha256Schema,
      sourceBindingSha256: sha256Schema,
      terminalActionEventContentSha256: sha256Schema,
      replayBindingContentSha256: sha256Schema,
      rollbackAttestationContentSha256: sha256Schema,
    })
    .safeParse({
      candidateEventContentSha256: input.candidateEventContentSha256,
      sourceBindingSha256: input.sourceBindingSha256,
      terminalActionEventContentSha256: input.terminalActionEventContentSha256,
      replayBindingContentSha256: input.replayBindingContentSha256,
      rollbackAttestationContentSha256: input.rollbackAttestationContentSha256,
    });
  const strategyBinding = trustedStrategyBindingSchema
    .nullable()
    .safeParse(input.strategyBinding ?? null);
  if (
    !currentPlan.success ||
    !actionCatalog.success ||
    !interactionCatalog.success ||
    !targetAdapterId.success ||
    !targetInstanceId.success ||
    !failedStepId.success ||
    !evidenceHashes.success ||
    !strategyBinding.success
  ) {
    return null;
  }
  try {
    validateProposalTarget(currentPlan.data, targetAdapterId.data);
    validateActionCatalog(actionCatalog.data);
    validateInteractionCatalog(interactionCatalog.data, actionCatalog.data);
    validateGuidePlanAgainstActionCatalog(currentPlan.data, actionCatalog.data);
  } catch {
    return null;
  }
  return {
    currentPlan: currentPlan.data,
    failedStepId: failedStepId.data,
    targetAdapterId: targetAdapterId.data,
    targetInstanceId: targetInstanceId.data,
    actionCatalog: actionCatalog.data,
    interactionCatalog: interactionCatalog.data,
    strategyBinding: strategyBinding.data,
    ...evidenceHashes.data,
  };
}

function parameterArtifactsFor(
  requestId: string,
  proposal: Extract<ProcedureExecutionFailureProposal, { kind: 'parameter_repair' }>,
  evidence: TrustedProcedureExecutionFailureReplanReviewEvidence,
  targetRevision: number,
): z.infer<typeof reviewArtifactsSchema> | null {
  const { currentPlan, actionCatalog, interactionCatalog } = evidence;
  if (
    evidence.targetAdapterId !== actionCatalog.adapterId ||
    interactionCatalog.adapterId !== actionCatalog.adapterId ||
    interactionCatalog.actionCatalogVersion !== actionCatalog.catalogVersion ||
    proposal.catalogs.actionCatalogVersion !== actionCatalog.catalogVersion ||
    proposal.catalogs.interactionCatalogVersion !== interactionCatalog.catalogVersion
  ) {
    return null;
  }
  if (
    proposal.base.planId !== currentPlan.id ||
    proposal.base.revision !== currentPlan.revision ||
    proposal.base.planContentSha256 !== sha256(currentPlan)
  ) {
    return null;
  }
  const actionStep = currentPlan.steps.find((candidate) => candidate.id === evidence.failedStepId);
  if (
    actionStep?.action === null ||
    actionStep?.action === undefined ||
    actionStep.action.name !== proposal.diff.actionName ||
    !Object.prototype.hasOwnProperty.call(actionStep.action.arguments, proposal.diff.argument) ||
    !isDeepStrictEqual(actionStep.action.arguments[proposal.diff.argument], proposal.diff.before)
  ) {
    return null;
  }
  const catalogAction = actionCatalog.actions.find(
    (candidate) => candidate.name === actionStep.action!.name,
  );
  if (catalogAction === undefined) return null;
  const repairedArguments = {
    ...actionStep.action.arguments,
    [proposal.diff.argument]: structuredClone(proposal.diff.after),
  };
  if (validateActionArguments(repairedArguments, catalogAction.argumentsSchema).length > 0) {
    return null;
  }
  const revisedPlanInput = structuredClone(currentPlan);
  if (!Number.isInteger(targetRevision) || targetRevision <= currentPlan.revision) return null;
  revisedPlanInput.revision = targetRevision;
  const revisedStep = revisedPlanInput.steps.find((candidate) => candidate.id === actionStep.id)!;
  revisedStep.action = { ...revisedStep.action!, arguments: repairedArguments };
  revisedStep.expectedObservations = revisedStep.expectedObservations.map((observation) => ({
    ...observation,
    parameters: Object.prototype.hasOwnProperty.call(observation.parameters, proposal.diff.argument)
      ? {
          ...observation.parameters,
          [proposal.diff.argument]: structuredClone(proposal.diff.after),
        }
      : observation.parameters,
  }));
  if (!isDeepStrictEqual(revisedStep.expectedObservations, proposal.observationObligations)) {
    return null;
  }
  const revisedPlan = guidePlanSchema.safeParse(revisedPlanInput);
  if (!revisedPlan.success) return null;
  try {
    validateGuidePlanAgainstActionCatalog(revisedPlan.data, actionCatalog);
  } catch {
    return null;
  }
  const identityBinding = {
    requestId,
    failureProposalId: proposal.proposalId,
    failureProposalContentSha256: proposal.integrity.contentSha256,
    basePlanContentSha256: proposal.base.planContentSha256,
    targetInstanceId: evidence.targetInstanceId,
  };
  const revisionRequestId = deterministicUuid('failure-replan-review-revision', identityBinding);
  const guideProposalId = deterministicUuid('failure-replan-review-proposal', identityBinding);
  const nodeNumber = guidePlanNodeNumbers(currentPlan).get(actionStep.id);
  if (nodeNumber === undefined) return null;
  const revisionRequest = guideRevisionRequestSchema.safeParse({
    protocolVersion: guideProtocolVersion,
    requestId: revisionRequestId,
    adapterId: evidence.targetAdapterId,
    catalogVersion: actionCatalog.catalogVersion,
    instanceId: evidence.targetInstanceId,
    basePlan: currentPlan,
    references: [{ nodeId: actionStep.id, nodeNumber }],
    message: `Apply reviewed failure repair ${proposal.proposalId}.`,
    parameterEdits: [
      {
        nodeId: actionStep.id,
        argumentName: proposal.diff.argument,
        before: proposal.diff.before,
        after: proposal.diff.after,
      },
    ],
    revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
    revisionOperation: { kind: 'revise' as const },
    occurredAt: proposal.proposedAt,
  });
  if (!revisionRequest.success) return null;
  try {
    validateGuideRevisionRequest(revisionRequest.data, actionCatalog);
  } catch {
    return null;
  }
  const guideProposal = guideProposalSchema.safeParse({
    protocolVersion: guideProtocolVersion,
    proposalId: guideProposalId,
    targetAdapterId: evidence.targetAdapterId,
    targetInstanceId: evidence.targetInstanceId,
    plan: revisedPlan.data,
    revisionRequestId,
    revisionThread: revisionRequest.data.revisionThread,
    ...(revisionRequest.data.revisionOperation === undefined
      ? {}
      : { revisionOperation: revisionRequest.data.revisionOperation }),
    planDiff: computeGuidePlanDiff(currentPlan, revisedPlan.data),
    catalogVersion: actionCatalog.catalogVersion,
    proposedAt: proposal.proposedAt,
  });
  if (!guideProposal.success) return null;
  return {
    revisedPlan: revisedPlan.data,
    revisionRequest: revisionRequest.data,
    guideProposal: guideProposal.data,
  };
}

function strategyCandidateFor(
  proposal: Extract<ProcedureExecutionFailureProposal, { kind: 'strategy_switch' }>,
  evidence: TrustedProcedureExecutionFailureReplanReviewEvidence,
) {
  const strategy = evidence.strategyBinding;
  if (strategy === null || strategy === undefined) return null;
  if (strategy.currentTrackId !== proposal.diff.fromTrackId) return null;
  const matches = strategy.candidates.filter(
    (candidate) =>
      candidate.semanticLeafId === proposal.diff.semanticLeafId &&
      candidate.modality === proposal.diff.modality &&
      candidate.trackId === proposal.diff.toTrackId,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function strategyArtifactsFor(
  requestId: string,
  proposal: Extract<ProcedureExecutionFailureProposal, { kind: 'strategy_switch' }>,
  evidence: TrustedProcedureExecutionFailureReplanReviewEvidence,
  targetRevision: number,
): z.infer<typeof reviewArtifactsSchema> | null {
  const { currentPlan, actionCatalog, interactionCatalog } = evidence;
  if (
    (currentPlan.protocolVersion !== '1.6.0' && currentPlan.protocolVersion !== '1.7.0') ||
    evidence.targetAdapterId !== actionCatalog.adapterId ||
    interactionCatalog.adapterId !== actionCatalog.adapterId ||
    interactionCatalog.actionCatalogVersion !== actionCatalog.catalogVersion ||
    proposal.catalogs.actionCatalogVersion !== actionCatalog.catalogVersion ||
    proposal.catalogs.interactionCatalogVersion !== interactionCatalog.catalogVersion ||
    proposal.base.planId !== currentPlan.id ||
    proposal.base.revision !== currentPlan.revision ||
    proposal.base.planContentSha256 !== sha256(currentPlan) ||
    proposal.diff.semanticLeafId !== evidence.failedStepId ||
    proposal.diff.modality === 'mcp'
  ) {
    return null;
  }
  const actionStep = currentPlan.steps.find((candidate) => candidate.id === evidence.failedStepId);
  if (
    actionStep?.action === null ||
    actionStep?.action === undefined ||
    actionStep.executionTrackOverride !== undefined ||
    currentPlan.steps.some((candidate) => candidate.parentId === actionStep.id) ||
    !isDeepStrictEqual(actionStep.expectedObservations, proposal.observationObligations)
  ) {
    return null;
  }
  const candidate = strategyCandidateFor(proposal, evidence);
  const recipe =
    candidate === null
      ? undefined
      : interactionCatalog.recipes.find((entry) => entry.id === candidate.recipeId);
  if (
    candidate === null ||
    recipe === undefined ||
    recipe.actionName !== actionStep.action.name ||
    candidate.verifiedTrackContentSha256 !== proposal.diff.verifiedTrackContentSha256 ||
    !isDeepStrictEqual(candidate.observationObligations, proposal.observationObligations)
  ) {
    return null;
  }
  const executionTrackOverride = guideExecutionTrackOverrideSchema.parse({
    kind: 'interaction_catalog_proof',
    interactionCatalogVersion: interactionCatalog.catalogVersion,
    interactionCatalogContentSha256: sha256(interactionCatalog),
    recipeId: candidate.recipeId,
    modality: candidate.modality,
    trackId: candidate.trackId,
    trackContentSha256: candidate.trackContentSha256,
    proofExecutionContentSha256: candidate.proofExecutionContentSha256,
  });
  if (!Number.isInteger(targetRevision) || targetRevision <= currentPlan.revision) return null;
  const revisedPlanInput = structuredClone(currentPlan);
  revisedPlanInput.revision = targetRevision;
  const revisedStep = revisedPlanInput.steps.find((entry) => entry.id === actionStep.id)!;
  revisedStep.executionTrackOverride = executionTrackOverride;
  const revisedPlan = guidePlanSchema.safeParse(revisedPlanInput);
  if (!revisedPlan.success) return null;
  try {
    validateGuidePlanAgainstActionCatalog(revisedPlan.data, actionCatalog);
  } catch {
    return null;
  }
  const identityBinding = {
    requestId,
    failureProposalId: proposal.proposalId,
    failureProposalContentSha256: proposal.integrity.contentSha256,
    basePlanContentSha256: proposal.base.planContentSha256,
    targetInstanceId: evidence.targetInstanceId,
  };
  const revisionRequestId = deterministicUuid('failure-replan-review-revision', identityBinding);
  const guideProposalId = deterministicUuid('failure-replan-review-proposal', identityBinding);
  const nodeNumber = guidePlanNodeNumbers(currentPlan).get(actionStep.id);
  if (nodeNumber === undefined) return null;
  const revisionRequest = guideRevisionRequestSchema.safeParse({
    protocolVersion: guideProtocolVersion,
    requestId: revisionRequestId,
    adapterId: evidence.targetAdapterId,
    catalogVersion: actionCatalog.catalogVersion,
    instanceId: evidence.targetInstanceId,
    basePlan: currentPlan,
    references: [{ nodeId: actionStep.id, nodeNumber }],
    message: `Apply reviewed failure strategy ${proposal.proposalId}.`,
    executionTrackEdits: [{ nodeId: actionStep.id, before: null, after: executionTrackOverride }],
    revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
    revisionOperation: { kind: 'revise' as const },
    occurredAt: proposal.proposedAt,
  });
  if (!revisionRequest.success) return null;
  try {
    validateGuideRevisionRequest(revisionRequest.data, actionCatalog);
  } catch {
    return null;
  }
  const guideProposal = guideProposalSchema.safeParse({
    protocolVersion: guideProtocolVersion,
    proposalId: guideProposalId,
    targetAdapterId: evidence.targetAdapterId,
    targetInstanceId: evidence.targetInstanceId,
    plan: revisedPlan.data,
    revisionRequestId,
    revisionThread: revisionRequest.data.revisionThread,
    revisionOperation: revisionRequest.data.revisionOperation,
    planDiff: computeGuidePlanDiff(currentPlan, revisedPlan.data),
    catalogVersion: actionCatalog.catalogVersion,
    proposedAt: proposal.proposedAt,
  });
  if (!guideProposal.success) return null;
  return {
    revisedPlan: revisedPlan.data,
    revisionRequest: revisionRequest.data,
    guideProposal: guideProposal.data,
  };
}

function unavailable(
  requestId: string,
  reason: z.infer<typeof unavailableReasonSchema>,
): ProcedureExecutionFailureReplanReviewPreview {
  return { status: 'unavailable', requestId, reason };
}

export function createProcedureExecutionFailureReplanReviewCoordinator(
  options: ProcedureExecutionFailureReplanReviewCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const resolveTargetRevision =
    options.resolveTargetRevision ?? ((_planId: string, baseRevision: number) => baseRevision + 1);

  const preview = (
    requestInput: ProcedureExecutionFailureReplanReviewPreviewRequest,
  ): ProcedureExecutionFailureReplanReviewPreview => {
    const request = procedureExecutionFailureReplanReviewPreviewRequestSchema.parse(requestInput);
    const outcomeInput = options.outcomes.get(request.requestId);
    const outcome = procedureExecutionFailureReplanOutcomeSchema.safeParse(outcomeInput);
    if (!outcome.success || outcome.data.kind === 'no_repair_available') {
      return unavailable(request.requestId, 'no_proposal');
    }
    const proposal = outcome.data.proposal;
    if (proposal.integrity.contentSha256 !== sha256(proposalContent(proposal))) {
      return unavailable(request.requestId, 'no_proposal');
    }
    const evidence = normalizeEvidence(options.trustedEvidence.resolve(request.requestId));
    if (evidence === null) return unavailable(request.requestId, 'stale_current_evidence');
    if (
      proposal.catalogs.actionCatalogVersion !== evidence.actionCatalog.catalogVersion ||
      proposal.catalogs.interactionCatalogVersion !== evidence.interactionCatalog.catalogVersion
    ) {
      return unavailable(request.requestId, 'catalog_drift');
    }
    if (
      proposal.base.planId !== evidence.currentPlan.id ||
      proposal.base.revision !== evidence.currentPlan.revision ||
      proposal.base.planContentSha256 !== sha256(evidence.currentPlan)
    ) {
      return unavailable(request.requestId, 'stale_current_evidence');
    }
    const acceptance =
      Date.parse(proposal.expiresAt) <= Date.parse(now())
        ? ({ status: 'unavailable', reason: 'proposal_expired' } as const)
        : proposal.kind === 'parameter_repair'
          ? (() => {
              const artifacts = parameterArtifactsFor(
                request.requestId,
                proposal,
                evidence,
                resolveTargetRevision(evidence.currentPlan.id, evidence.currentPlan.revision),
              );
              return artifacts === null
                ? ({ status: 'unavailable', reason: 'invalid_parameter_repair' } as const)
                : ({ status: 'available', artifacts } as const);
            })()
          : proposal.kind === 'strategy_switch'
            ? evidence.currentPlan.protocolVersion !== '1.6.0' &&
              evidence.currentPlan.protocolVersion !== '1.7.0'
              ? ({
                  status: 'unavailable',
                  reason: 'legacy_strategy_binding_not_execution_authoritative',
                } as const)
              : (() => {
                  const artifacts = strategyArtifactsFor(
                    request.requestId,
                    proposal,
                    evidence,
                    resolveTargetRevision(evidence.currentPlan.id, evidence.currentPlan.revision),
                  );
                  return artifacts === null
                    ? ({ status: 'unavailable', reason: 'invalid_strategy_switch' } as const)
                    : ({ status: 'available', artifacts } as const);
                })()
            : ({
                status: 'unavailable',
                reason: 'semantic_replan_requires_signed_provider_authority',
              } as const);
    const strategyCandidate =
      proposal.kind === 'strategy_switch' ? strategyCandidateFor(proposal, evidence) : null;
    const evidenceBinding = procedureExecutionFailureReplanReviewEvidenceBindingSchema.parse({
      candidateContentSha256: proposal.integrity.contentSha256,
      candidateEventContentSha256: evidence.candidateEventContentSha256,
      sourceBindingSha256: evidence.sourceBindingSha256,
      terminalActionEventContentSha256: evidence.terminalActionEventContentSha256,
      replayBindingContentSha256: evidence.replayBindingContentSha256,
      rollbackAttestationContentSha256: evidence.rollbackAttestationContentSha256,
      actionCatalogVersion: evidence.actionCatalog.catalogVersion,
      actionCatalogContentSha256: sha256(evidence.actionCatalog),
      interactionCatalogVersion: evidence.interactionCatalog.catalogVersion,
      interactionCatalogContentSha256: sha256(evidence.interactionCatalog),
      adapterId: evidence.targetAdapterId,
      instanceId: evidence.targetInstanceId,
      failedStepId: evidence.failedStepId,
      basePlanId: evidence.currentPlan.id,
      basePlanRevision: evidence.currentPlan.revision,
      basePlanContentSha256: sha256(evidence.currentPlan),
      ...(proposal.kind !== 'strategy_switch' || strategyCandidate === null
        ? {}
        : {
            strategyTrackBinding: {
              currentTrackId: evidence.strategyBinding!.currentTrackId,
              currentTrackContentSha256: evidence.strategyBinding!.currentTrackContentSha256,
              target: {
                semanticLeafId: strategyCandidate.semanticLeafId,
                recipeId: strategyCandidate.recipeId,
                modality: strategyCandidate.modality,
                trackId: strategyCandidate.trackId,
                verifiedTrackContentSha256: strategyCandidate.verifiedTrackContentSha256,
                trackContentSha256: strategyCandidate.trackContentSha256,
                proofExecutionContentSha256: strategyCandidate.proofExecutionContentSha256,
              },
            },
          }),
    });
    const reviewBindingSha256 = sha256({
      request,
      proposal,
      evidenceBinding,
      acceptance,
    });
    return procedureExecutionFailureReplanReviewPreviewSchema.parse({
      status: 'reviewable',
      requestId: request.requestId,
      proposal,
      evidenceBinding,
      reviewBindingSha256,
      acceptance,
    });
  };

  const review = (
    requestInput: ProcedureExecutionFailureReplanReviewRequest,
  ): ProcedureExecutionFailureReplanReviewResult => {
    const request = procedureExecutionFailureReplanReviewRequestSchema.parse(requestInput);
    const currentPreview = preview({ requestId: request.requestId });
    if (currentPreview.status !== 'reviewable') {
      throw new Error(`Failure replan review is unavailable: ${currentPreview.reason}`);
    }
    if (
      currentPreview.proposal.proposalId !== request.proposalId ||
      currentPreview.reviewBindingSha256 !== request.reviewBindingSha256
    ) {
      throw new Error('Failure replan review does not match the exact current preview binding');
    }
    if (
      Date.parse(request.reviewedAt) < Date.parse(currentPreview.proposal.proposedAt) ||
      Date.parse(request.reviewedAt) > Date.parse(now())
    ) {
      throw new Error('Failure replan review timestamp is outside the trusted review window');
    }
    if (request.decision.kind === 'discard') {
      return procedureExecutionFailureReplanReviewResultSchema.parse({
        status: 'discarded',
        requestId: request.requestId,
        reviewId: request.reviewId,
        proposalId: request.proposalId,
        evidenceBinding: currentPreview.evidenceBinding,
        reviewBindingSha256: request.reviewBindingSha256,
        discardedAt: request.reviewedAt,
      });
    }
    if (
      Date.parse(request.reviewedAt) >= Date.parse(currentPreview.proposal.expiresAt) ||
      currentPreview.acceptance.status !== 'available'
    ) {
      const reason =
        currentPreview.acceptance.status === 'unavailable'
          ? currentPreview.acceptance.reason
          : 'proposal_expired';
      throw new Error(`Failure replan candidate cannot be accepted: ${reason}`);
    }
    return procedureExecutionFailureReplanReviewResultSchema.parse({
      status: 'accepted',
      requestId: request.requestId,
      reviewId: request.reviewId,
      proposalId: request.proposalId,
      evidenceBinding: currentPreview.evidenceBinding,
      reviewBindingSha256: request.reviewBindingSha256,
      acceptedAt: request.reviewedAt,
      artifacts: currentPreview.acceptance.artifacts,
    });
  };

  return { preview, review };
}
