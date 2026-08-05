import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  guideProposalSchema,
  guideRevisionRequestSchema,
  plannerReplanDraftSchema,
  plannerReplanProposedEventSchema,
  planningQualityEvaluationRequestSchema,
  type CompanionStateReport,
  type GuidePlan,
  type GuideProposal,
  type GuideReplanSubmission,
  type GuideRevisionRequest,
  type PlanningIntent,
  type PlanningQualityReport,
  type PlannerReplanGenerationResult,
  type ReplanningPromptPacket,
  type ReplanningPromptRequest,
} from '@operatingline/protocol';

import type { ActionCatalogRegistry } from './action-catalogs.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuideRevisionRequest,
  validateProposalTarget,
} from './guide-validation.js';
import {
  createLocalReplanScope,
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
} from './local-replan-scope.js';
import { evaluatePlanningQuality } from './planning-quality.js';
import { PlannerGenerationRuntimeError } from './planner-provider-errors.js';
import { buildReplanningPromptPacket } from './replanning-prompt.js';

export interface ReplanProposalCreationInput {
  readonly targetAdapterId: string;
  readonly targetInstanceId: string;
  readonly catalogVersion: string;
  readonly plan: GuidePlan;
  readonly replan: {
    readonly requestId: string;
    readonly generationRequestId?: string;
    readonly basePlan: GuidePlan;
    readonly revisionThread: NonNullable<GuideRevisionRequest['revisionThread']>;
  };
  readonly planning?: PlanningIntent;
}

export interface ReplanProposalCreationResult {
  readonly proposal: GuideProposal;
  readonly planningQuality: PlanningQualityReport;
}

export interface ReplanningServiceOptions {
  readonly database: OperatingLineDatabase;
  readonly actionCatalogRegistry: Pick<ActionCatalogRegistry, 'get'>;
  readonly listCompanionStates: () => readonly CompanionStateReport[];
  readonly resolveTargetRevision: (planId: string, baseRevision: number) => number;
  readonly completedGeneration: (requestId: string) => PlannerReplanGenerationResult | null;
  readonly createProposal: (input: ReplanProposalCreationInput) => ReplanProposalCreationResult;
}

export interface ReplanProposalResult {
  readonly proposed: true;
  readonly proposalId: string;
  readonly targetAdapterId: string;
  readonly targetInstanceId: string | null;
  readonly planId: string;
  readonly revision: number;
  readonly catalogVersion: string | null;
  readonly revisionRequestId: string | null;
  readonly revisionThread: GuideProposal['revisionThread'] | null;
  readonly planDiff: GuideProposal['planDiff'] | null;
  readonly planningQuality: PlanningQualityReport;
  readonly duplicate: boolean;
}

export interface ReplanningService {
  getPrompt(request: ReplanningPromptRequest, recordEvents?: boolean): ReplanningPromptPacket;
  propose(submission: GuideReplanSubmission): ReplanProposalResult;
}

function proposalResult(
  proposal: GuideProposal,
  planningQuality: PlanningQualityReport,
  duplicate: boolean,
): ReplanProposalResult {
  return {
    proposed: true,
    proposalId: proposal.proposalId,
    targetAdapterId: proposal.targetAdapterId,
    targetInstanceId: proposal.targetInstanceId ?? null,
    planId: proposal.plan.id,
    revision: proposal.plan.revision,
    catalogVersion: proposal.catalogVersion ?? null,
    revisionRequestId: proposal.revisionRequestId ?? null,
    revisionThread: proposal.revisionThread ?? null,
    planDiff: proposal.planDiff ?? null,
    planningQuality,
    duplicate,
  };
}

export function createReplanningService(options: ReplanningServiceOptions): ReplanningService {
  const getStoredRevisionRequest = (revisionRequestId: string): GuideRevisionRequest => {
    const storedRequest = options.database.getGuideRevisionRequest(revisionRequestId);
    if (storedRequest === null) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_request_not_found',
        `Guide revision request ${revisionRequestId} was not found`,
        'never',
      );
    }
    return guideRevisionRequestSchema.parse(storedRequest);
  };

  const getPendingRevisionRequest = (revisionRequestId: string): GuideRevisionRequest => {
    const revisionRequest = getStoredRevisionRequest(revisionRequestId);
    if (options.database.getGuideReplanProposalForRequest(revisionRequestId) !== null) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_request_not_pending',
        `Guide revision request ${revisionRequestId} already has a Proposal`,
        'never',
      );
    }
    if (revisionRequest.revisionThread === undefined) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_thread_stale',
        `Guide revision request ${revisionRequestId} uses the legacy protocol without a revision thread`,
        'never',
      );
    }
    const storedHead = options.database.getGuideRevisionThreadHead(
      revisionRequest.revisionThread.threadId,
    );
    const threadHead = storedHead === null ? null : guideRevisionRequestSchema.parse(storedHead);
    if (threadHead?.requestId !== revisionRequest.requestId) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_thread_stale',
        `Guide revision request ${revisionRequestId} is no longer the current thread head`,
        'never',
      );
    }
    return revisionRequest;
  };

  const getPrompt = (
    request: ReplanningPromptRequest,
    recordEvents = true,
  ): ReplanningPromptPacket => {
    const revisionRequest = getPendingRevisionRequest(request.revisionRequestId);
    let catalog;
    try {
      catalog = options.actionCatalogRegistry.get({
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: revisionRequest.catalogVersion,
      });
      validateGuideRevisionRequest(revisionRequest, catalog);
    } catch (error) {
      if (error instanceof PlannerGenerationRuntimeError) {
        throw error;
      }
      throw new PlannerGenerationRuntimeError(
        'planner_catalog_invalid',
        `Guide revision request ${revisionRequest.requestId} cannot bind its exact ActionCatalog`,
        'same_request_id',
      );
    }
    const companionState =
      options
        .listCompanionStates()
        .find(
          (state) =>
            state.adapterId === revisionRequest.adapterId &&
            state.instanceId === revisionRequest.instanceId,
        ) ?? null;
    const packet = buildReplanningPromptPacket({
      revisionRequest,
      targetRevision: options.resolveTargetRevision(
        revisionRequest.basePlan.id,
        revisionRequest.basePlan.revision,
      ),
      catalog,
      companionState,
      scope: createLocalReplanScope(revisionRequest),
    });
    if (recordEvents) {
      options.database.appendEvent({
        id: randomUUID(),
        eventType: 'planning.replan.context.generated',
        payload: { request, context: packet.context },
      });
      options.database.appendEvent({
        id: randomUUID(),
        eventType: 'planning.replan.prompt.generated',
        payload: { request, packet },
      });
    }
    return packet;
  };

  const propose = (submission: GuideReplanSubmission): ReplanProposalResult => {
    const revisionRequest = getStoredRevisionRequest(submission.requestId);
    if (submission.plan.id !== revisionRequest.basePlan.id) {
      throw new PlannerGenerationRuntimeError(
        'planner_replan_submission_invalid',
        `Replanned guide id ${submission.plan.id} must match base plan ${revisionRequest.basePlan.id}`,
        'never',
      );
    }
    if (submission.plan.revision <= revisionRequest.basePlan.revision) {
      throw new PlannerGenerationRuntimeError(
        'planner_replan_submission_invalid',
        `Replanned guide revision ${submission.plan.revision} must be newer than base revision ${revisionRequest.basePlan.revision}`,
        'never',
      );
    }
    if (submission.catalogVersion !== revisionRequest.catalogVersion) {
      throw new PlannerGenerationRuntimeError(
        'planner_replan_submission_invalid',
        `Replan catalog ${submission.catalogVersion} must match revision request catalog ${revisionRequest.catalogVersion}`,
        'never',
      );
    }
    if (revisionRequest.revisionThread === undefined) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_thread_stale',
        `Guide revision request ${revisionRequest.requestId} uses legacy protocol without a revision thread`,
        'never',
      );
    }
    const existingProposalInput = options.database.getGuideReplanProposalForRequest(
      revisionRequest.requestId,
    );
    if (submission.generationRequestId === undefined && existingProposalInput !== null) {
      throw new PlannerGenerationRuntimeError(
        'planner_revision_request_not_pending',
        `Guide revision request ${revisionRequest.requestId} already has a proposal`,
        'never',
      );
    }

    let submissionCatalog;
    try {
      submissionCatalog = options.actionCatalogRegistry.get({
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: revisionRequest.catalogVersion,
      });
      validateProposalTarget(submission.plan, revisionRequest.adapterId);
      validateGuidePlanAgainstActionCatalog(submission.plan, submissionCatalog);
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_replan_submission_invalid',
        'Replan proposal failed deterministic GuidePlan or ActionCatalog validation',
        'never',
      );
    }
    const submittedQuality = evaluatePlanningQuality(
      planningQualityEvaluationRequestSchema.parse({
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: submission.catalogVersion,
        ...(submission.planning === undefined
          ? {}
          : {
              goal: submission.planning.goal,
              requiredPhaseIds: submission.planning.requiredPhaseIds,
              ...(submission.planning.capabilityCoverage === undefined
                ? {}
                : { capabilityCoverage: submission.planning.capabilityCoverage }),
            }),
        plan: submission.plan,
      }),
      submissionCatalog,
      {
        allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, submission.plan),
      },
    );
    if (!submittedQuality.valid) {
      throw new PlannerGenerationRuntimeError(
        'planner_replan_submission_invalid',
        'Replan proposal failed the deterministic planning-quality baseline',
        'never',
      );
    }

    if (submission.generationRequestId !== undefined) {
      const generated = options.completedGeneration(submission.generationRequestId);
      if (generated === null || generated.status !== 'ready') {
        throw new PlannerGenerationRuntimeError(
          'planner_replan_generation_stale',
          `Ready replan generation ${submission.generationRequestId} was not found`,
          'never',
        );
      }
      const submittedDraft = plannerReplanDraftSchema.safeParse({
        requestId: submission.requestId,
        catalogVersion: submission.catalogVersion,
        planning: submission.planning,
        plan: submission.plan,
      });
      if (
        !submittedDraft.success ||
        !isDeepStrictEqual(submittedDraft.data, generated.draft) ||
        generated.revisionRequestId !== revisionRequest.requestId ||
        generated.targetAdapterId !== revisionRequest.adapterId ||
        generated.targetInstanceId !== revisionRequest.instanceId
      ) {
        throw new PlannerGenerationRuntimeError(
          'planner_identity_mismatch',
          'Generated replan submission must exactly match its canonical completed draft and immutable host request',
          'never',
        );
      }

      if (existingProposalInput !== null) {
        const existingProposal = guideProposalSchema.parse(existingProposalInput);
        const provenanceEvent = options.database.getExecutionEvent(
          `planning-replan-proposed:${submission.generationRequestId}`,
        );
        const provenance =
          provenanceEvent?.eventType === 'planning.provider.replan.proposed'
            ? plannerReplanProposedEventSchema.parse(provenanceEvent.payload)
            : null;
        if (
          provenance?.revisionRequestId !== revisionRequest.requestId ||
          provenance.proposalId !== existingProposal.proposalId ||
          existingProposal.revisionRequestId !== revisionRequest.requestId ||
          existingProposal.targetAdapterId !== revisionRequest.adapterId ||
          existingProposal.targetInstanceId !== revisionRequest.instanceId ||
          existingProposal.catalogVersion !== submission.catalogVersion ||
          !isDeepStrictEqual(existingProposal.plan, submission.plan)
        ) {
          throw new PlannerGenerationRuntimeError(
            'planner_revision_request_not_pending',
            `Guide revision request ${revisionRequest.requestId} already has a different Proposal`,
            'never',
          );
        }
        const catalog = options.actionCatalogRegistry.get({
          targetAdapterId: revisionRequest.adapterId,
          catalogVersion: revisionRequest.catalogVersion,
        });
        const planningQuality = evaluatePlanningQuality(
          planningQualityEvaluationRequestSchema.parse({
            targetAdapterId: revisionRequest.adapterId,
            catalogVersion: submission.catalogVersion,
            goal: submittedDraft.data.planning.goal,
            requiredPhaseIds: submittedDraft.data.planning.requiredPhaseIds,
            ...(submittedDraft.data.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: submittedDraft.data.planning.capabilityCoverage }),
            plan: submission.plan,
          }),
          catalog,
          {
            allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, submission.plan),
          },
        );
        return proposalResult(existingProposal, planningQuality, true);
      }

      const packet = getPrompt({ revisionRequestId: revisionRequest.requestId }, false);
      if (packet.context.targetRevision !== submission.plan.revision) {
        throw new PlannerGenerationRuntimeError(
          'planner_replan_generation_stale',
          `Generated revision ${submission.plan.revision} is stale; current target revision is ${packet.context.targetRevision}`,
          'never',
        );
      }
      const scopeEvaluation = evaluateLocalReplanScope(revisionRequest, submission.plan);
      const planningQuality = evaluatePlanningQuality(
        planningQualityEvaluationRequestSchema.parse({
          targetAdapterId: revisionRequest.adapterId,
          catalogVersion: submission.catalogVersion,
          goal: submittedDraft.data.planning.goal,
          requiredPhaseIds: submittedDraft.data.planning.requiredPhaseIds,
          ...(submittedDraft.data.planning.capabilityCoverage === undefined
            ? {}
            : { capabilityCoverage: submittedDraft.data.planning.capabilityCoverage }),
          plan: submission.plan,
        }),
        packet.context.catalog,
        {
          allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, submission.plan),
        },
      );
      if (
        !scopeEvaluation.locality.valid ||
        scopeEvaluation.planDiff === null ||
        !planningQuality.valid
      ) {
        throw new PlannerGenerationRuntimeError(
          'planner_replan_generation_stale',
          'Generated replan no longer passes deterministic locality and planning-quality gates',
          'never',
        );
      }
    }

    const { proposal, planningQuality } = options.createProposal({
      targetAdapterId: revisionRequest.adapterId,
      targetInstanceId: revisionRequest.instanceId,
      catalogVersion: submission.catalogVersion,
      plan: submission.plan,
      replan: {
        requestId: revisionRequest.requestId,
        ...(submission.generationRequestId === undefined
          ? {}
          : { generationRequestId: submission.generationRequestId }),
        basePlan: revisionRequest.basePlan,
        revisionThread: revisionRequest.revisionThread,
      },
      ...(submission.planning === undefined ? {} : { planning: submission.planning }),
    });
    return proposalResult(proposal, planningQuality, false);
  };

  return { getPrompt, propose };
}
