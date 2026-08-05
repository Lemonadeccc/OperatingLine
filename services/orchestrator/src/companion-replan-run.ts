import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionReplanRunContractVersion,
  companionReplanRunCreateRequestSchema,
  companionReplanRunSchema,
  guideRevisionRequestSchema,
  plannerProviderDescriptorSchema,
  type CompanionReplanRun,
  type CompanionReplanRunCreateRequest,
  type CompanionReplanRunError,
  type CompanionReplanRunNeedsRevision,
  type CompanionReplanRunStatus,
  type PlannerReplanGenerationResult,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';

import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import type { PlannerReplanGenerationCoordinator } from './planner-replan-generation.js';
import { safePlannerRuntimeError } from './planner-provider-errors.js';
import type { ReplanningService } from './replanning-service.js';

interface StoredCompanionReplanRun extends CompanionReplanRun {
  readonly request: CompanionReplanRunCreateRequest;
  readonly authorizedProvider: PlannerProviderDescriptor;
}

export class CompanionReplanRunRequestError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code:
    | 'invalid_request'
    | 'revision_request_not_found'
    | 'provider_not_found'
    | 'provider_unavailable'
    | 'provider_binding_mismatch'
    | 'target_binding_mismatch'
    | 'revision_request_not_pending'
    | 'replan_run_conflict'
    | 'proposal_pending'
    | 'runtime_stopping';

  constructor(
    statusCode: CompanionReplanRunRequestError['statusCode'],
    code: CompanionReplanRunRequestError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CompanionReplanRunRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CompanionReplanRunCoordinator {
  create(request: CompanionReplanRunCreateRequest): CompanionReplanRun;
  get(generationRequestId: string): CompanionReplanRun | null;
  beginClose(): void;
  close(): Promise<void>;
}

interface CompanionReplanRunCoordinatorOptions {
  readonly database: OperatingLineDatabase;
  readonly providerRegistry: PlannerProviderRegistry;
  readonly generationCoordinator: PlannerReplanGenerationCoordinator;
  readonly replanningService: ReplanningService;
}

const safeFailureMessage =
  'The replan run failed before a Proposal could be safely created; the host scene was not changed.';
const safeInterruptedMessage =
  'The runtime stopped before this generation completed; it was not retried automatically.';

function publicRun(run: StoredCompanionReplanRun): CompanionReplanRun {
  return companionReplanRunSchema.parse({
    contractVersion: run.contractVersion,
    generationRequestId: run.generationRequestId,
    revisionRequestId: run.revisionRequestId,
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

function parseStoredRun(input: unknown): StoredCompanionReplanRun {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Stored companion replan run is invalid');
  }
  const candidate = input as Record<string, unknown>;
  const parsed = companionReplanRunSchema.parse({
    contractVersion: candidate['contractVersion'],
    generationRequestId: candidate['generationRequestId'],
    revisionRequestId: candidate['revisionRequestId'],
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
    request: companionReplanRunCreateRequestSchema.parse(candidate['request']),
    authorizedProvider: plannerProviderDescriptorSchema.parse(candidate['authorizedProvider']),
  } as StoredCompanionReplanRun;
}

function terminalRun(
  run: StoredCompanionReplanRun,
  status: Exclude<CompanionReplanRunStatus, 'queued' | 'generating'>,
  details: {
    readonly proposalId?: string;
    readonly error?: CompanionReplanRunError;
    readonly needsRevision?: CompanionReplanRunNeedsRevision;
  } = {},
): StoredCompanionReplanRun {
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
  result: PlannerReplanGenerationResult,
): CompanionReplanRunNeedsRevision {
  return {
    planning: {
      errorCount: result.planningQuality.summary.errorCount,
      warningCount: result.planningQuality.summary.warningCount,
      findings: result.planningQuality.findings,
    },
    locality: {
      valid: result.locality.valid,
      findings: result.locality.findings,
    },
    planDiffAvailable: result.planDiff !== null,
  };
}

function generationMatchesAuthorization(
  run: StoredCompanionReplanRun,
  result: PlannerReplanGenerationResult,
): boolean {
  return (
    result.requestId === run.generationRequestId &&
    result.revisionRequestId === run.revisionRequestId &&
    result.provider.id === run.provider.id &&
    result.provider.version === run.provider.version &&
    result.targetAdapterId === run.targetAdapterId &&
    result.targetInstanceId === run.targetInstanceId
  );
}

export function createCompanionReplanRunCoordinator(
  options: CompanionReplanRunCoordinatorOptions,
): CompanionReplanRunCoordinator {
  let closing = false;
  const tasks = new Set<Promise<void>>();

  const transition = (
    run: StoredCompanionReplanRun,
    expectedStatuses: readonly CompanionReplanRunStatus[],
  ): boolean => options.database.transitionCompanionReplanRun(run, expectedStatuses);

  const failureRun = (
    run: StoredCompanionReplanRun,
    error: unknown,
    forceInterrupted = false,
  ): StoredCompanionReplanRun => {
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
    run: StoredCompanionReplanRun,
    result: PlannerReplanGenerationResult,
  ): StoredCompanionReplanRun => {
    const proposal = options.replanningService.propose({
      generationRequestId: result.requestId,
      requestId: result.revisionRequestId,
      catalogVersion: result.draft.catalogVersion,
      planning: result.draft.planning,
      plan: result.draft.plan,
    });
    return terminalRun(run, 'proposal_created', { proposalId: proposal.proposalId });
  };

  const reconcileNonterminalRuns = (): void => {
    for (const input of options.database.listNonterminalCompanionReplanRuns()) {
      const run = parseStoredRun(input);
      const result = options.generationCoordinator.completedResult(run.generationRequestId);
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
      try {
        if (!generationMatchesAuthorization(run, result)) {
          throw new Error('Completed replan identity does not match its authorization');
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

  // Reconcile only from durable generation/proposal evidence. A completed ready result may
  // finish the already-authorized canonical propose, but never invokes the Provider again.
  reconcileNonterminalRuns();

  const execute = async (initial: StoredCompanionReplanRun): Promise<void> => {
    if (closing) {
      return;
    }
    const generating: StoredCompanionReplanRun = {
      ...initial,
      status: 'generating',
      updatedAt: new Date().toISOString(),
    };
    if (!transition(generating, ['queued'])) {
      return;
    }
    try {
      const result = await options.generationCoordinator.generate({
        requestId: generating.generationRequestId,
        revisionRequestId: generating.revisionRequestId,
        providerId: generating.provider.id,
      });
      if (closing) {
        return;
      }
      if (!generationMatchesAuthorization(generating, result)) {
        throw new Error('Generated replan identity no longer matches its authorization');
      }
      if (result.status === 'needs_revision') {
        transition(
          terminalRun(generating, 'needs_revision', {
            needsRevision: needsRevisionEvidence(result),
          }),
          ['generating'],
        );
        return;
      }
      transition(proposeCompletedResult(generating, result), ['generating']);
    } catch (error) {
      transition(failureRun(generating, error, closing), ['generating']);
    }
  };

  return {
    create: (requestInput) => {
      if (closing) {
        throw new CompanionReplanRunRequestError(
          503,
          'runtime_stopping',
          'The runtime is stopping and cannot authorize a new replan run',
        );
      }
      const request = companionReplanRunCreateRequestSchema.parse(requestInput);
      const existingInput = options.database.getCompanionReplanRun(request.generationRequestId);
      if (existingInput !== null) {
        const existing = parseStoredRun(existingInput);
        if (!isDeepStrictEqual(existing.request, request)) {
          throw new CompanionReplanRunRequestError(
            409,
            'replan_run_conflict',
            'generationRequestId is already bound to a different authorization request',
          );
        }
        return publicRun(existing);
      }

      const storedRevisionInput = options.database.getGuideRevisionRequest(
        request.revisionRequestId,
      );
      if (storedRevisionInput === null) {
        throw new CompanionReplanRunRequestError(
          404,
          'revision_request_not_found',
          'The referenced revision request was not found',
        );
      }
      const revisionRequest = guideRevisionRequestSchema.parse(storedRevisionInput);
      if (
        revisionRequest.adapterId !== request.targetAdapterId ||
        revisionRequest.instanceId !== request.targetInstanceId
      ) {
        throw new CompanionReplanRunRequestError(
          409,
          'target_binding_mismatch',
          'The authorization target does not match the immutable revision request',
        );
      }
      if (
        options.database.getPendingGuideProposal(
          request.targetAdapterId,
          request.targetInstanceId,
        ) !== null
      ) {
        throw new CompanionReplanRunRequestError(
          409,
          'proposal_pending',
          'A Proposal is already awaiting an explicit host decision',
        );
      }
      try {
        options.replanningService.getPrompt(
          { revisionRequestId: request.revisionRequestId },
          false,
        );
      } catch (error) {
        const safeError = safePlannerRuntimeError(error);
        if (
          safeError.code === 'planner_revision_request_not_pending' ||
          safeError.code === 'planner_revision_thread_stale'
        ) {
          throw new CompanionReplanRunRequestError(
            409,
            'revision_request_not_pending',
            'The revision request is no longer the pending revision thread head',
          );
        }
        throw new CompanionReplanRunRequestError(
          422,
          'invalid_request',
          'The revision request cannot bind its immutable planning context',
        );
      }
      const registered = options.providerRegistry.findReplanner(request.providerId);
      if (registered === null) {
        throw new CompanionReplanRunRequestError(
          404,
          'provider_not_found',
          'The explicitly selected replanning provider was not found',
        );
      }
      if (registered.descriptor.version !== request.providerVersion) {
        throw new CompanionReplanRunRequestError(
          409,
          'provider_binding_mismatch',
          'The selected provider descriptor version changed before authorization',
        );
      }
      if (!registered.descriptor.availability.available) {
        throw new CompanionReplanRunRequestError(
          422,
          'provider_unavailable',
          'The explicitly selected replanning provider is unavailable',
        );
      }

      const updatedAt = new Date().toISOString();
      const stored: StoredCompanionReplanRun = {
        contractVersion: companionReplanRunContractVersion,
        generationRequestId: request.generationRequestId,
        revisionRequestId: request.revisionRequestId,
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
        authorizedProvider: structuredClone(registered.descriptor),
      };
      const recorded = options.database.recordCompanionReplanRun(stored);
      if (recorded !== 'accepted') {
        throw new CompanionReplanRunRequestError(
          409,
          'replan_run_conflict',
          'This host instance already has a nonterminal replan run',
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
      const stored = options.database.getCompanionReplanRun(generationRequestId);
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
