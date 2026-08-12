import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import type { PlannerProviderDialogueTextDelta } from '@operatingline/planner-provider-sdk';
import {
  companionDialogueRunContractVersion,
  companionDialogueRunCreateRequestSchema,
  companionDialogueRunSchema,
  plannerDialogueMaximumMessageCharacters,
  plannerDialogueProviderResultSchema,
  plannerProviderDescriptorSchema,
  semanticReplanConfidenceThreshold,
  type CompanionDialogueRun,
  type CompanionDialogueRunCreateRequest,
  type CompanionDialogueRunStatus,
  type CompanionDialogueSemanticDecision,
  type CompanionReplanRunError,
  type CompanionReplanRunNeedsRevision,
  type PlannerProviderDescriptor,
  type PlannerReplanGenerationResult,
} from '@operatingline/protocol';

import type { GuideRevisionRequestService } from './guide-revision-requests.js';
import type { PlannerProviderInvocationManager } from './planner-provider-invocation.js';
import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import {
  safePlannerRuntimeError,
  PlannerGenerationRuntimeError,
} from './planner-provider-errors.js';
import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import type { PlannerReplanGenerationCoordinator } from './planner-replan-generation.js';
import type { ReplanningService } from './replanning-service.js';
import { buildSemanticDialoguePromptPacket } from './semantic-dialogue-prompt.js';

interface StoredCompanionDialogueRun extends CompanionDialogueRun {
  readonly request: CompanionDialogueRunCreateRequest;
  readonly authorizedProvider: PlannerProviderDescriptor;
}

export class CompanionDialogueRunRequestError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code:
    | 'invalid_request'
    | 'provider_not_found'
    | 'provider_unavailable'
    | 'provider_binding_mismatch'
    | 'target_binding_mismatch'
    | 'revision_request_conflict'
    | 'dialogue_run_conflict'
    | 'proposal_pending'
    | 'runtime_stopping';

  constructor(
    statusCode: CompanionDialogueRunRequestError['statusCode'],
    code: CompanionDialogueRunRequestError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CompanionDialogueRunRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CompanionDialogueRunCoordinator {
  create(request: CompanionDialogueRunCreateRequest): CompanionDialogueRun;
  get(dialogueRequestId: string): CompanionDialogueRun | null;
  beginClose(): void;
  close(): Promise<void>;
}

export interface CompanionDialogueRunCoordinatorOptions {
  readonly database: OperatingLineDatabase;
  readonly providerRegistry: PlannerProviderRegistry;
  readonly invocationManager: PlannerProviderInvocationManager;
  readonly generationCoordinator: PlannerReplanGenerationCoordinator;
  readonly replanningService: ReplanningService;
  readonly revisionRequestService: GuideRevisionRequestService;
}

const maximumDeltaCharacters = 4_096;
const progressFlushCharacters = 256;
const progressFlushIntervalMs = 75;
const safeFailureMessage =
  'The dialogue run failed before a Proposal could be safely created; the host scene was not changed.';
const safeInterruptedMessage =
  'The runtime stopped before this dialogue workflow completed; it was not retried automatically.';

function publicRun(run: StoredCompanionDialogueRun): CompanionDialogueRun {
  return companionDialogueRunSchema.parse({
    contractVersion: run.contractVersion,
    dialogueRequestId: run.dialogueRequestId,
    revisionRequestId: run.revisionRequestId,
    replanGenerationRequestId: run.replanGenerationRequestId,
    targetAdapterId: run.targetAdapterId,
    targetInstanceId: run.targetInstanceId,
    provider: run.provider,
    status: run.status,
    terminal: run.terminal,
    sceneChanged: false,
    assistantMessage: run.assistantMessage,
    assistantMessageRevision: run.assistantMessageRevision,
    semanticDecision: run.semanticDecision,
    revisionRequestRecorded: run.revisionRequestRecorded,
    proposalId: run.proposalId,
    error: run.error,
    needsRevision: run.needsRevision,
    updatedAt: run.updatedAt,
  });
}

function parseStoredRun(input: unknown): StoredCompanionDialogueRun {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Stored companion dialogue run is invalid');
  }
  const candidate = input as Record<string, unknown>;
  const parsed = companionDialogueRunSchema.parse({
    contractVersion: candidate['contractVersion'],
    dialogueRequestId: candidate['dialogueRequestId'],
    revisionRequestId: candidate['revisionRequestId'],
    replanGenerationRequestId: candidate['replanGenerationRequestId'],
    targetAdapterId: candidate['targetAdapterId'],
    targetInstanceId: candidate['targetInstanceId'],
    provider: candidate['provider'],
    status: candidate['status'],
    terminal: candidate['terminal'],
    sceneChanged: candidate['sceneChanged'],
    assistantMessage: candidate['assistantMessage'],
    assistantMessageRevision: candidate['assistantMessageRevision'],
    semanticDecision: candidate['semanticDecision'],
    revisionRequestRecorded: candidate['revisionRequestRecorded'],
    proposalId: candidate['proposalId'],
    error: candidate['error'],
    needsRevision: candidate['needsRevision'],
    updatedAt: candidate['updatedAt'],
  });
  return {
    ...candidate,
    ...parsed,
    request: companionDialogueRunCreateRequestSchema.parse(candidate['request']),
    authorizedProvider: plannerProviderDescriptorSchema.parse(candidate['authorizedProvider']),
  } as StoredCompanionDialogueRun;
}

function terminalRun(
  run: StoredCompanionDialogueRun,
  status: Extract<
    CompanionDialogueRunStatus,
    'answered' | 'needs_revision' | 'proposal_created' | 'failed' | 'interrupted'
  >,
  details: {
    readonly proposalId?: string;
    readonly error?: CompanionReplanRunError;
    readonly needsRevision?: CompanionReplanRunNeedsRevision;
  } = {},
): StoredCompanionDialogueRun {
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
  run: StoredCompanionDialogueRun,
  result: PlannerReplanGenerationResult,
): boolean {
  return (
    result.requestId === run.replanGenerationRequestId &&
    result.revisionRequestId === run.revisionRequestId &&
    result.provider.id === run.provider.id &&
    result.provider.version === run.provider.version &&
    result.targetAdapterId === run.targetAdapterId &&
    result.targetInstanceId === run.targetInstanceId
  );
}

function messageSha256(message: string): string {
  return createHash('sha256').update(message).digest('hex');
}

export function createCompanionDialogueRunCoordinator(
  options: CompanionDialogueRunCoordinatorOptions,
): CompanionDialogueRunCoordinator {
  let closing = false;
  const tasks = new Set<Promise<void>>();

  const transition = (
    run: StoredCompanionDialogueRun,
    expectedStatuses: readonly CompanionDialogueRunStatus[],
  ): boolean => options.database.transitionCompanionDialogueRun(run, expectedStatuses);

  const failureRun = (
    run: StoredCompanionDialogueRun,
    error: unknown,
    forceInterrupted = false,
  ): StoredCompanionDialogueRun => {
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
    run: StoredCompanionDialogueRun,
    result: PlannerReplanGenerationResult,
  ): StoredCompanionDialogueRun => {
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
    for (const input of options.database.listNonterminalCompanionDialogueRuns()) {
      const run = parseStoredRun(input);
      if (run.status !== 'replanning') {
        transition(
          failureRun(
            run,
            new PlannerGenerationRuntimeError(
              'planner_runtime_stopping',
              safeInterruptedMessage,
              'new_request_id',
            ),
            true,
          ),
          [run.status],
        );
        continue;
      }
      const result = options.generationCoordinator.completedResult(run.replanGenerationRequestId);
      if (result === null) {
        transition(
          failureRun(
            run,
            new PlannerGenerationRuntimeError(
              'planner_runtime_stopping',
              safeInterruptedMessage,
              'new_request_id',
            ),
            true,
          ),
          ['replanning'],
        );
        continue;
      }
      try {
        if (!generationMatchesAuthorization(run, result)) {
          throw new Error('Completed semantic replan identity does not match its authorization');
        }
        transition(
          result.status === 'needs_revision'
            ? terminalRun(run, 'needs_revision', {
                needsRevision: needsRevisionEvidence(result),
              })
            : proposeCompletedResult(run, result),
          ['replanning'],
        );
      } catch (error) {
        transition(failureRun(run, error), ['replanning']);
      }
    }
  };

  reconcileNonterminalRuns();

  const runDialogue = async (
    streaming: StoredCompanionDialogueRun,
  ): Promise<ReturnType<typeof plannerDialogueProviderResultSchema.parse>> => {
    const requestFingerprint = plannerProviderRequestFingerprint({
      dialogueRequestId: streaming.dialogueRequestId,
      replanGenerationRequestId: streaming.replanGenerationRequestId,
      providerId: streaming.provider.id,
      providerVersion: streaming.provider.version,
      revisionRequest: streaming.request.revisionRequest,
      history: streaming.request.history,
    });
    const replanning = options.replanningService.buildCandidatePrompt(
      streaming.request.revisionRequest,
    ).context;
    const packet = buildSemanticDialoguePromptPacket({
      replanning,
      history: streaming.request.history,
    });

    return options.invocationManager.execute({
      requestId: streaming.dialogueRequestId,
      operation: 'semantic_dialogue',
      fingerprint: requestFingerprint,
      providerId: streaming.provider.id,
      planKey: [streaming.targetAdapterId, streaming.request.revisionRequest.basePlan.id],
      requiresReplan: true,
      requiresDialogue: true,
      attempt: async (attemptContext) => {
        const startedAt = Date.now();
        let requested = false;
        let current = streaming;
        let assistantMessage = '';
        let pendingText = '';
        let lastFlushAt = Date.now();

        const flush = (): void => {
          if (pendingText.length === 0) {
            return;
          }
          const next: StoredCompanionDialogueRun = {
            ...current,
            assistantMessage,
            assistantMessageRevision: current.assistantMessageRevision + 1,
            updatedAt: new Date().toISOString(),
          };
          if (!transition(next, ['streaming'])) {
            throw new PlannerGenerationRuntimeError(
              'planner_generation_conflict',
              'Dialogue progress no longer matches its durable run state',
              'new_request_id',
            );
          }
          current = next;
          pendingText = '';
          lastFlushAt = Date.now();
        };

        const emit = (event: PlannerProviderDialogueTextDelta): void => {
          if (
            event.type !== 'assistant_text_delta' ||
            typeof event.delta !== 'string' ||
            event.delta.length < 1 ||
            event.delta.length > maximumDeltaCharacters
          ) {
            throw new PlannerGenerationRuntimeError(
              'planner_output_invalid',
              'Planner dialogue emitted an invalid assistant text delta',
              'new_request_id',
            );
          }
          assistantMessage += event.delta;
          pendingText += event.delta;
          if (assistantMessage.length > plannerDialogueMaximumMessageCharacters) {
            throw new PlannerGenerationRuntimeError(
              'planner_output_invalid',
              'Planner dialogue assistant message exceeded the public limit',
              'new_request_id',
            );
          }
          if (
            pendingText.length >= progressFlushCharacters ||
            Date.now() - lastFlushAt >= progressFlushIntervalMs
          ) {
            flush();
          }
        };

        try {
          options.database.appendEvent({
            id: `planning-dialogue-requested:${streaming.dialogueRequestId}`,
            eventType: 'planning.provider.dialogue.requested',
            payload: {
              dialogueRequestId: streaming.dialogueRequestId,
              revisionRequestId: streaming.revisionRequestId,
              replanGenerationRequestId: streaming.replanGenerationRequestId,
              requestFingerprint,
              providerId: streaming.provider.id,
              providerVersion: streaming.provider.version,
              targetAdapterId: streaming.targetAdapterId,
              targetInstanceId: streaming.targetInstanceId,
              planId: streaming.request.revisionRequest.basePlan.id,
              occurredAt: new Date().toISOString(),
            },
          });
          attemptContext.markAttempted();
          requested = true;
          const rawResult = await attemptContext.invoke((provider, signal) => {
            if (provider.dialogue === undefined) {
              throw new PlannerGenerationRuntimeError(
                'planner_dialogue_not_supported',
                `Planner provider ${streaming.provider.id} does not support dialogue`,
                'same_request_id',
              );
            }
            return provider.dialogue({
              requestId: streaming.dialogueRequestId,
              packet: structuredClone(packet),
              signal,
              emit,
            });
          });
          flush();
          const parsedResult = plannerDialogueProviderResultSchema.safeParse(rawResult);
          if (!parsedResult.success) {
            throw new PlannerGenerationRuntimeError(
              'planner_output_invalid',
              'Planner dialogue returned an invalid result',
              'new_request_id',
            );
          }
          const result = parsedResult.data;
          if (result.assistantMessage !== assistantMessage) {
            throw new PlannerGenerationRuntimeError(
              'planner_output_invalid',
              'Planner dialogue result does not match its emitted assistant text',
              'new_request_id',
            );
          }
          options.database.appendEvent({
            id: `planning-dialogue-completed:${streaming.dialogueRequestId}`,
            eventType: 'planning.provider.dialogue.completed',
            payload: {
              dialogueRequestId: streaming.dialogueRequestId,
              revisionRequestId: streaming.revisionRequestId,
              requestFingerprint,
              providerId: streaming.provider.id,
              providerVersion: streaming.provider.version,
              decision: result.decision,
              assistantMessageSha256: messageSha256(result.assistantMessage),
              assistantMessageCharacters: result.assistantMessage.length,
              durationMs: Math.max(0, Date.now() - startedAt),
              occurredAt: new Date().toISOString(),
            },
          });
          return result;
        } catch (error) {
          if (pendingText.length > 0) {
            try {
              flush();
            } catch {
              // Preserve the original failure while the durable run remains fail closed.
            }
          }
          if (requested) {
            const safeError = safePlannerRuntimeError(error);
            options.database.appendEvent({
              id: `planning-dialogue-failed:${streaming.dialogueRequestId}`,
              eventType: 'planning.provider.dialogue.failed',
              payload: {
                dialogueRequestId: streaming.dialogueRequestId,
                revisionRequestId: streaming.revisionRequestId,
                requestFingerprint,
                providerId: streaming.provider.id,
                providerVersion: streaming.provider.version,
                error: safeError.code,
                durationMs: Math.max(0, Date.now() - startedAt),
                occurredAt: new Date().toISOString(),
              },
            });
          }
          throw error;
        }
      },
    });
  };

  const execute = async (initial: StoredCompanionDialogueRun): Promise<void> => {
    if (closing) {
      return;
    }
    const streaming: StoredCompanionDialogueRun = {
      ...initial,
      status: 'streaming',
      updatedAt: new Date().toISOString(),
    };
    if (!transition(streaming, ['queued'])) {
      return;
    }
    try {
      const result = await runDialogue(streaming);
      if (closing) {
        return;
      }
      const storedAfterDialogue = options.database.getCompanionDialogueRun(
        streaming.dialogueRequestId,
      );
      if (storedAfterDialogue === null) {
        throw new Error('Dialogue run disappeared after provider completion');
      }
      const current = parseStoredRun(storedAfterDialogue);
      if (current.status !== 'streaming') {
        throw new Error('Dialogue run left its streaming phase unexpectedly');
      }
      const assistantMessage = result.assistantMessage;
      const classified = current;

      if (
        result.decision.kind === 'answer' ||
        result.decision.confidence < semanticReplanConfidenceThreshold
      ) {
        const semanticDecision: CompanionDialogueSemanticDecision = {
          kind: 'answer',
          replanConfidence: result.decision.kind === 'answer' ? null : result.decision.confidence,
          threshold: semanticReplanConfidenceThreshold,
        };
        transition(
          terminalRun(
            {
              ...classified,
              assistantMessage,
              semanticDecision,
            },
            'answered',
          ),
          ['streaming'],
        );
        return;
      }

      const semanticDecision: CompanionDialogueSemanticDecision = {
        kind: 'replan',
        confidence: result.decision.confidence,
        threshold: semanticReplanConfidenceThreshold,
      };
      options.revisionRequestService.validate(current.request.revisionRequest);
      const replanning: StoredCompanionDialogueRun = {
        ...classified,
        status: 'replanning',
        assistantMessage,
        semanticDecision,
        revisionRequestRecorded: true,
        updatedAt: new Date().toISOString(),
      };
      if (
        !options.database.transitionCompanionDialogueRunWithRevisionRequest(
          replanning,
          current.request.revisionRequest,
          ['streaming'],
        )
      ) {
        throw new PlannerGenerationRuntimeError(
          'planner_generation_conflict',
          'The semantic replan request no longer matches its authorized host context',
          'new_request_id',
        );
      }
      if (closing) {
        return;
      }
      const generated = await options.generationCoordinator.generate({
        requestId: replanning.replanGenerationRequestId,
        revisionRequestId: replanning.revisionRequestId,
        providerId: replanning.provider.id,
      });
      if (closing) {
        return;
      }
      if (!generationMatchesAuthorization(replanning, generated)) {
        throw new Error('Generated semantic replan identity no longer matches its authorization');
      }
      transition(
        generated.status === 'needs_revision'
          ? terminalRun(replanning, 'needs_revision', {
              needsRevision: needsRevisionEvidence(generated),
            })
          : proposeCompletedResult(replanning, generated),
        ['replanning'],
      );
    } catch (error) {
      const stored = options.database.getCompanionDialogueRun(initial.dialogueRequestId);
      if (stored !== null) {
        const current = parseStoredRun(stored);
        if (!current.terminal) {
          transition(failureRun(current, error, closing), [current.status]);
        }
      }
    }
  };

  return {
    create: (requestInput) => {
      if (closing) {
        throw new CompanionDialogueRunRequestError(
          503,
          'runtime_stopping',
          'The runtime is stopping and cannot authorize a new dialogue run',
        );
      }
      const request = companionDialogueRunCreateRequestSchema.parse(requestInput);
      const existingInput = options.database.getCompanionDialogueRun(request.dialogueRequestId);
      if (existingInput !== null) {
        const existing = parseStoredRun(existingInput);
        if (!isDeepStrictEqual(existing.request, request)) {
          throw new CompanionDialogueRunRequestError(
            409,
            'dialogue_run_conflict',
            'dialogueRequestId is already bound to a different authorization request',
          );
        }
        return publicRun(existing);
      }
      if (
        request.revisionRequest.adapterId !== request.targetAdapterId ||
        request.revisionRequest.instanceId !== request.targetInstanceId
      ) {
        throw new CompanionDialogueRunRequestError(
          409,
          'target_binding_mismatch',
          'The authorized target does not match the candidate revision request',
        );
      }
      if (options.database.getGuideRevisionRequest(request.revisionRequest.requestId) !== null) {
        throw new CompanionDialogueRunRequestError(
          409,
          'revision_request_conflict',
          'The candidate revision request id is already durable',
        );
      }
      if (
        options.database.getPendingGuideProposal(
          request.targetAdapterId,
          request.targetInstanceId,
        ) !== null
      ) {
        throw new CompanionDialogueRunRequestError(
          409,
          'proposal_pending',
          'A Proposal is already awaiting an explicit host decision',
        );
      }
      try {
        options.revisionRequestService.validate(request.revisionRequest);
        options.replanningService.buildCandidatePrompt(request.revisionRequest);
      } catch {
        throw new CompanionDialogueRunRequestError(
          422,
          'invalid_request',
          'The candidate revision request cannot bind its immutable host context',
        );
      }
      const registered = options.providerRegistry.findDialogueReplanner(request.providerId);
      if (registered === null) {
        throw new CompanionDialogueRunRequestError(
          404,
          'provider_not_found',
          'The selected provider does not support streamed semantic replanning',
        );
      }
      if (registered.descriptor.version !== request.providerVersion) {
        throw new CompanionDialogueRunRequestError(
          409,
          'provider_binding_mismatch',
          'The selected provider descriptor version changed before authorization',
        );
      }
      if (!registered.descriptor.availability.available) {
        throw new CompanionDialogueRunRequestError(
          422,
          'provider_unavailable',
          'The explicitly selected dialogue provider is unavailable',
        );
      }

      const updatedAt = new Date().toISOString();
      const stored: StoredCompanionDialogueRun = {
        contractVersion: companionDialogueRunContractVersion,
        dialogueRequestId: request.dialogueRequestId,
        revisionRequestId: request.revisionRequest.requestId,
        replanGenerationRequestId: request.replanGenerationRequestId,
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
        assistantMessage: '',
        assistantMessageRevision: 0,
        semanticDecision: null,
        revisionRequestRecorded: false,
        proposalId: null,
        error: null,
        needsRevision: null,
        updatedAt,
        request,
        authorizedProvider: structuredClone(registered.descriptor),
      };
      const recorded = options.database.recordCompanionDialogueRun(stored);
      if (recorded !== 'accepted') {
        throw new CompanionDialogueRunRequestError(
          409,
          'dialogue_run_conflict',
          'This host instance already has conflicting pending work',
        );
      }
      const task = new Promise<void>((resolve) => {
        setImmediate(() => void execute(stored).then(resolve, resolve));
      });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
      return publicRun(stored);
    },
    get: (dialogueRequestId) => {
      const stored = options.database.getCompanionDialogueRun(dialogueRequestId);
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
