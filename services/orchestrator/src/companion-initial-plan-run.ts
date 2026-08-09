import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionInitialPlanRunContractVersion,
  companionInitialPlanRunCreateRequestSchema,
  companionInitialPlanRunSchema,
  guideGoalRequestSchema,
  guideProposalSchema,
  plannerGenerateRequestSchema,
  plannerProviderDescriptorSchema,
  type CompanionInitialPlanRun,
  type CompanionInitialPlanRunCreateRequest,
  type CompanionInitialPlanRunError,
  type CompanionInitialPlanRunNeedsRevision,
  type CompanionInitialPlanRunStatus,
  type GuideGoalRequest,
  type GuidePlan,
  type GuideProposal,
  type PlannerGenerateRequest,
  type PlannerGenerationResult,
  type PlannerProviderDescriptor,
  type PlanningIntent,
} from '@operatingline/protocol';

import type { PlannerGenerationCoordinator } from './planner-generation.js';
import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import { safePlannerRuntimeError } from './planner-provider-errors.js';

interface StoredCompanionInitialPlanRun extends CompanionInitialPlanRun {
  readonly request: CompanionInitialPlanRunCreateRequest;
  readonly goalRequest: GuideGoalRequest;
  readonly authorizedProvider: PlannerProviderDescriptor;
}

export interface InitialPlanProposalInput {
  readonly targetAdapterId: string;
  readonly targetInstanceId: string;
  readonly catalogVersion: string;
  readonly plan: GuidePlan;
  readonly goalRequestId: string;
  readonly goalGenerationRequestId: string;
  readonly planning: PlanningIntent;
}

export class CompanionInitialPlanRunRequestError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code:
    | 'invalid_request'
    | 'goal_request_not_found'
    | 'provider_not_found'
    | 'provider_unavailable'
    | 'provider_binding_mismatch'
    | 'target_binding_mismatch'
    | 'goal_request_not_pending'
    | 'initial_plan_run_conflict'
    | 'proposal_pending'
    | 'runtime_stopping';

  constructor(
    statusCode: CompanionInitialPlanRunRequestError['statusCode'],
    code: CompanionInitialPlanRunRequestError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CompanionInitialPlanRunRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CompanionInitialPlanRunCoordinator {
  create(request: CompanionInitialPlanRunCreateRequest): CompanionInitialPlanRun;
  get(generationRequestId: string): CompanionInitialPlanRun | null;
  beginClose(): void;
  close(): Promise<void>;
}

interface CompanionInitialPlanRunCoordinatorOptions {
  readonly database: OperatingLineDatabase;
  readonly providerRegistry: PlannerProviderRegistry;
  readonly generationCoordinator: PlannerGenerationCoordinator;
  readonly createProposal: (input: InitialPlanProposalInput) => GuideProposal;
}

const safeFailureMessage =
  'The initial plan run failed before a Proposal could be safely created; the host scene was not changed.';
const safeInterruptedMessage =
  'The runtime stopped before this generation completed; it was not retried automatically.';

function publicRun(run: StoredCompanionInitialPlanRun): CompanionInitialPlanRun {
  return companionInitialPlanRunSchema.parse({
    contractVersion: run.contractVersion,
    generationRequestId: run.generationRequestId,
    goalRequestId: run.goalRequestId,
    targetAdapterId: run.targetAdapterId,
    targetInstanceId: run.targetInstanceId,
    provider: run.provider,
    status: run.status,
    terminal: run.terminal,
    sceneChanged: false,
    proposalId: run.proposalId,
    error: run.error,
    needsRevision: run.needsRevision,
    updatedAt: run.updatedAt,
  });
}

function parseStoredRun(input: unknown): StoredCompanionInitialPlanRun {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Stored companion initial plan run is invalid');
  }
  const candidate = input as Record<string, unknown>;
  const parsed = companionInitialPlanRunSchema.parse({
    contractVersion: candidate['contractVersion'],
    generationRequestId: candidate['generationRequestId'],
    goalRequestId: candidate['goalRequestId'],
    targetAdapterId: candidate['targetAdapterId'],
    targetInstanceId: candidate['targetInstanceId'],
    provider: candidate['provider'],
    status: candidate['status'],
    terminal: candidate['terminal'],
    sceneChanged: candidate['sceneChanged'],
    proposalId: candidate['proposalId'],
    error: candidate['error'],
    needsRevision: candidate['needsRevision'],
    updatedAt: candidate['updatedAt'],
  });
  return {
    ...candidate,
    ...parsed,
    request: companionInitialPlanRunCreateRequestSchema.parse(candidate['request']),
    goalRequest: guideGoalRequestSchema.parse(candidate['goalRequest']),
    authorizedProvider: plannerProviderDescriptorSchema.parse(candidate['authorizedProvider']),
  } as StoredCompanionInitialPlanRun;
}

function terminalRun(
  run: StoredCompanionInitialPlanRun,
  status: Exclude<CompanionInitialPlanRunStatus, 'queued' | 'generating'>,
  details: {
    readonly proposalId?: string;
    readonly error?: CompanionInitialPlanRunError;
    readonly needsRevision?: CompanionInitialPlanRunNeedsRevision;
  } = {},
): StoredCompanionInitialPlanRun {
  return {
    ...run,
    status,
    terminal: true,
    proposalId: details.proposalId ?? null,
    error: details.error ?? null,
    needsRevision: details.needsRevision ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function needsRevisionEvidence(
  result: PlannerGenerationResult,
): CompanionInitialPlanRunNeedsRevision {
  return {
    planning: {
      errorCount: result.planningQuality.summary.errorCount,
      warningCount: result.planningQuality.summary.warningCount,
      findings: result.planningQuality.findings,
    },
  };
}

function generationRequest(run: StoredCompanionInitialPlanRun): PlannerGenerateRequest {
  return plannerGenerateRequestSchema.parse({
    requestId: run.generationRequestId,
    providerId: run.provider.id,
    targetAdapterId: run.goalRequest.adapterId,
    catalogVersion: run.goalRequest.catalogVersion,
    goal: run.goalRequest.goal,
    planId: run.goalRequest.planId,
  });
}

function generationMatchesAuthorization(
  run: StoredCompanionInitialPlanRun,
  result: PlannerGenerationResult,
): boolean {
  return (
    result.requestId === run.generationRequestId &&
    result.provider.id === run.provider.id &&
    result.provider.version === run.provider.version &&
    result.draft.targetAdapterId === run.targetAdapterId &&
    result.draft.catalogVersion === run.goalRequest.catalogVersion &&
    result.draft.planning.goal === run.goalRequest.goal &&
    result.draft.plan.id === run.goalRequest.planId
  );
}

function proposalMatchesGeneration(
  run: StoredCompanionInitialPlanRun,
  result: PlannerGenerationResult,
  proposal: GuideProposal,
): boolean {
  return (
    proposal.goalRequestId === run.goalRequestId &&
    proposal.targetAdapterId === run.targetAdapterId &&
    proposal.targetInstanceId === run.targetInstanceId &&
    proposal.catalogVersion === result.draft.catalogVersion &&
    isDeepStrictEqual(proposal.plan, result.draft.plan)
  );
}

export function createCompanionInitialPlanRunCoordinator(
  options: CompanionInitialPlanRunCoordinatorOptions,
): CompanionInitialPlanRunCoordinator {
  let closing = false;
  const tasks = new Set<Promise<void>>();

  const transition = (
    run: StoredCompanionInitialPlanRun,
    expectedStatuses: readonly CompanionInitialPlanRunStatus[],
  ): boolean => options.database.transitionCompanionInitialPlanRun(run, expectedStatuses);

  const failureRun = (
    run: StoredCompanionInitialPlanRun,
    error: unknown,
    forceInterrupted = false,
  ): StoredCompanionInitialPlanRun => {
    const safeError = safePlannerRuntimeError(error);
    const interrupted = forceInterrupted || safeError.code === 'planner_runtime_stopping';
    return terminalRun(run, interrupted ? 'interrupted' : 'failed', {
      error: {
        code: interrupted ? 'planner_runtime_stopping' : safeError.code,
        retryMode: interrupted || safeError.retryMode !== 'never' ? 'new_request_id' : 'never',
        message: interrupted ? safeInterruptedMessage : safeFailureMessage,
      },
    });
  };

  const proposeCompletedResult = (
    run: StoredCompanionInitialPlanRun,
    result: PlannerGenerationResult,
  ): StoredCompanionInitialPlanRun => {
    const existingInput = options.database.getGuideGoalProposalForGeneration(
      run.generationRequestId,
    );
    if (existingInput !== null) {
      const existing = guideProposalSchema.parse(existingInput);
      if (!proposalMatchesGeneration(run, result, existing)) {
        throw new Error('Stored initial-plan proposal does not match its generated draft');
      }
      return terminalRun(run, 'proposal_created', { proposalId: existing.proposalId });
    }
    const proposal = guideProposalSchema.parse(
      options.createProposal({
        targetAdapterId: run.targetAdapterId,
        targetInstanceId: run.targetInstanceId,
        catalogVersion: result.draft.catalogVersion,
        plan: result.draft.plan,
        goalRequestId: run.goalRequestId,
        goalGenerationRequestId: run.generationRequestId,
        planning: result.draft.planning,
      }),
    );
    if (!proposalMatchesGeneration(run, result, proposal)) {
      throw new Error('Created initial-plan proposal does not match its generated draft');
    }
    return terminalRun(run, 'proposal_created', { proposalId: proposal.proposalId });
  };

  const reconcileNonterminalRuns = (): void => {
    for (const input of options.database.listNonterminalCompanionInitialPlanRuns()) {
      const run = parseStoredRun(input);
      try {
        const result = options.generationCoordinator.completedGoalResult(generationRequest(run), {
          goalRequestId: run.goalRequestId,
          targetInstanceId: run.targetInstanceId,
        });
        if (result === null) {
          transition(
            terminalRun(run, 'interrupted', {
              error: {
                code: 'planner_runtime_stopping',
                retryMode: 'new_request_id',
                message: safeInterruptedMessage,
              },
            }),
            ['queued', 'generating'],
          );
          continue;
        }
        if (!generationMatchesAuthorization(run, result)) {
          throw new Error('Completed initial-plan identity does not match its authorization');
        }
        transition(
          result.status === 'needs_revision'
            ? terminalRun(run, 'needs_revision', {
                needsRevision: needsRevisionEvidence(result),
              })
            : proposeCompletedResult(run, result),
          ['queued', 'generating'],
        );
      } catch (error) {
        transition(failureRun(run, error), ['queued', 'generating']);
      }
    }
  };

  // Reconcile only from exact host-goal generation provenance. Never invoke a Provider on restart.
  reconcileNonterminalRuns();

  const execute = async (initial: StoredCompanionInitialPlanRun): Promise<void> => {
    if (closing) {
      return;
    }
    const generating: StoredCompanionInitialPlanRun = {
      ...initial,
      status: 'generating',
      updatedAt: new Date().toISOString(),
    };
    if (!transition(generating, ['queued'])) {
      return;
    }
    try {
      const result = await options.generationCoordinator.generateForGoal(
        generationRequest(generating),
        {
          goalRequestId: generating.goalRequestId,
          targetInstanceId: generating.targetInstanceId,
        },
      );
      if (closing) {
        return;
      }
      if (!generationMatchesAuthorization(generating, result)) {
        throw new Error('Generated initial-plan identity no longer matches its authorization');
      }
      transition(
        result.status === 'needs_revision'
          ? terminalRun(generating, 'needs_revision', {
              needsRevision: needsRevisionEvidence(result),
            })
          : proposeCompletedResult(generating, result),
        ['generating'],
      );
    } catch (error) {
      transition(failureRun(generating, error, closing), ['generating']);
    }
  };

  return {
    create: (requestInput) => {
      if (closing) {
        throw new CompanionInitialPlanRunRequestError(
          503,
          'runtime_stopping',
          'The runtime is stopping and cannot authorize a new initial plan run',
        );
      }
      const request = companionInitialPlanRunCreateRequestSchema.parse(requestInput);
      const existingInput = options.database.getCompanionInitialPlanRun(
        request.generationRequestId,
      );
      if (existingInput !== null) {
        const existing = parseStoredRun(existingInput);
        if (!isDeepStrictEqual(existing.request, request)) {
          throw new CompanionInitialPlanRunRequestError(
            409,
            'initial_plan_run_conflict',
            'generationRequestId is already bound to a different authorization request',
          );
        }
        return publicRun(existing);
      }

      const storedGoalInput = options.database.getGuideGoalRequest(request.goalRequestId);
      if (storedGoalInput === null) {
        throw new CompanionInitialPlanRunRequestError(
          404,
          'goal_request_not_found',
          'The referenced goal request was not found',
        );
      }
      const goalRequest = guideGoalRequestSchema.parse(storedGoalInput);
      if (
        goalRequest.adapterId !== request.targetAdapterId ||
        goalRequest.instanceId !== request.targetInstanceId
      ) {
        throw new CompanionInitialPlanRunRequestError(
          409,
          'target_binding_mismatch',
          'The authorization target does not match the immutable goal request',
        );
      }
      if (options.database.getGuideGoalProposalForRequest(goalRequest.requestId) !== null) {
        throw new CompanionInitialPlanRunRequestError(
          409,
          'goal_request_not_pending',
          'The goal request already has a Proposal and is no longer pending',
        );
      }
      if (
        options.database.getPendingGuideProposal(
          request.targetAdapterId,
          request.targetInstanceId,
        ) !== null
      ) {
        throw new CompanionInitialPlanRunRequestError(
          409,
          'proposal_pending',
          'A Proposal is already awaiting an explicit host decision',
        );
      }

      const registered = options.providerRegistry.find(request.providerId);
      if (registered === null) {
        throw new CompanionInitialPlanRunRequestError(
          404,
          'provider_not_found',
          'The explicitly selected planning provider was not found',
        );
      }
      if (registered.descriptor.version !== request.providerVersion) {
        throw new CompanionInitialPlanRunRequestError(
          409,
          'provider_binding_mismatch',
          'The selected provider descriptor version changed before authorization',
        );
      }
      if (!registered.descriptor.availability.available) {
        throw new CompanionInitialPlanRunRequestError(
          422,
          'provider_unavailable',
          'The explicitly selected planning provider is unavailable',
        );
      }

      const updatedAt = new Date().toISOString();
      const stored: StoredCompanionInitialPlanRun = {
        contractVersion: companionInitialPlanRunContractVersion,
        generationRequestId: request.generationRequestId,
        goalRequestId: request.goalRequestId,
        targetAdapterId: request.targetAdapterId,
        targetInstanceId: request.targetInstanceId,
        provider: {
          id: registered.descriptor.id,
          version: registered.descriptor.version,
          displayName: registered.descriptor.displayName,
        },
        status: 'queued',
        terminal: false,
        sceneChanged: false,
        proposalId: null,
        error: null,
        needsRevision: null,
        updatedAt,
        request,
        goalRequest,
        authorizedProvider: structuredClone(registered.descriptor),
      };
      const recorded = options.database.recordCompanionInitialPlanRun(stored);
      if (recorded !== 'accepted') {
        throw new CompanionInitialPlanRunRequestError(
          409,
          'initial_plan_run_conflict',
          'This host instance no longer owns an available initial planning work slot',
        );
      }
      const task = new Promise<void>((resolve) => {
        setImmediate(() => void execute(stored).then(resolve, resolve));
      });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
      return publicRun(stored);
    },
    get: (generationRequestId) => {
      const stored = options.database.getCompanionInitialPlanRun(generationRequestId);
      return stored === null ? null : publicRun(parseStoredRun(stored));
    },
    beginClose: () => {
      closing = true;
    },
    close: async () => {
      closing = true;
      await Promise.allSettled(tasks);
      reconcileNonterminalRuns();
    },
  };
}
