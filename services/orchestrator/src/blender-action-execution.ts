import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionActionExecutionCreateRequestSchema,
  companionActionExecutionDeliverySchema,
  companionActionExecutionResultSchema,
  companionActionExecutionStatusSchema,
  canonicalizeProtocolJsonValue,
  type CompanionActionExecutionCreateRequest,
  type CompanionActionExecutionDelivery,
  type CompanionActionExecutionResult,
  type CompanionActionExecutionStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

const actionExecutionEventTypes = [
  'blender.action-execution.queued',
  'blender.action-execution.dispatched',
  'blender.action-execution.completed',
  'blender.action-execution.recovery-required',
  'blender.action-execution.failure-handoff-completed',
] as const;

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const storedActionExecutionEventSchema = z.strictObject({
  execution: companionActionExecutionStatusSchema,
  sessionFingerprintSha256: contentSha256Schema,
});
const failureHandoffEventSchema = z.strictObject({
  handoffId: z.string().min(1).max(256),
  requestId: z.uuid(),
  executionContentSha256: contentSha256Schema,
  handedOffAt: z.iso.datetime({ offset: true }),
});

type ActionExecutionDatabase = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;

type StoredActionExecution = z.infer<typeof storedActionExecutionEventSchema>;

export class BlenderActionExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlenderActionExecutionError';
  }
}

export interface BlenderActionExecutionCoordinatorOptions {
  readonly database: ActionExecutionDatabase;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly onTerminalFailure?: (handoff: BlenderTerminalFailureHandoff) => Promise<void>;
  readonly externalHistoryLockOwner?: (adapterId: 'blender', instanceId: string) => string | null;
}

export interface BlenderTerminalFailureHandoff {
  readonly handoffId: string;
  readonly requestId: string;
  readonly execution: CompanionActionExecutionStatus;
  readonly executionContentSha256: string;
}

function executionContentSha256(execution: CompanionActionExecutionStatus): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(execution)).digest('hex');
}

function failureHandoffId(execution: CompanionActionExecutionStatus): string {
  return `blender-terminal-failure:${execution.requestId}:${executionContentSha256(execution)}`;
}

function sameCreateRequest(
  execution: CompanionActionExecutionStatus,
  request: CompanionActionExecutionCreateRequest,
): boolean {
  return (
    execution.formatVersion === request.formatVersion &&
    execution.requestId === request.requestId &&
    execution.replayId === request.replayId &&
    isDeepStrictEqual(execution.expectedState, request.expectedState)
  );
}

function sameDeliveryIdentity(
  execution: CompanionActionExecutionStatus,
  result: CompanionActionExecutionResult,
): boolean {
  return (
    execution.formatVersion === result.formatVersion &&
    execution.requestId === result.requestId &&
    execution.replayId === result.replayId &&
    execution.deliveryId === result.deliveryId &&
    isDeepStrictEqual(execution.target, result.target) &&
    execution.proposalId === result.proposalId &&
    isDeepStrictEqual(execution.plan, result.plan) &&
    execution.planContentSha256 === result.planContentSha256 &&
    execution.executionId === result.executionId &&
    isDeepStrictEqual(execution.expectedState, result.expectedState) &&
    execution.step.id === result.stepId
  );
}

function sameImmutableExecution(
  left: CompanionActionExecutionStatus,
  right: CompanionActionExecutionStatus,
): boolean {
  return (
    left.formatVersion === right.formatVersion &&
    left.requestId === right.requestId &&
    left.replayId === right.replayId &&
    isDeepStrictEqual(left.target, right.target) &&
    left.proposalId === right.proposalId &&
    isDeepStrictEqual(left.plan, right.plan) &&
    left.planContentSha256 === right.planContentSha256 &&
    left.executionId === right.executionId &&
    isDeepStrictEqual(left.expectedState, right.expectedState) &&
    isDeepStrictEqual(left.step, right.step) &&
    left.requestedAt === right.requestedAt
  );
}

function assertStoredTransition(
  previous: StoredActionExecution | undefined,
  next: StoredActionExecution,
): void {
  const { execution } = next;
  if (previous === undefined) {
    if (execution.status !== 'queued') {
      throw new Error(`Action execution ${execution.requestId} is missing its queued event`);
    }
    return;
  }
  if (
    !sameImmutableExecution(previous.execution, execution) ||
    (previous.sessionFingerprintSha256 !== next.sessionFingerprintSha256 &&
      `${previous.execution.status}->${execution.status}` !== 'queued->dispatched')
  ) {
    throw new Error(`Action execution ${execution.requestId} changed immutable authority`);
  }
  const transition = `${previous.execution.status}->${execution.status}`;
  if (
    transition !== 'queued->dispatched' &&
    transition !== 'dispatched->succeeded' &&
    transition !== 'dispatched->failed' &&
    transition !== 'dispatched->rejected' &&
    transition !== 'dispatched->recovery_required'
  ) {
    throw new Error(`Action execution ${execution.requestId} has invalid transition ${transition}`);
  }
}

export function createBlenderActionExecutionCoordinator(
  options: BlenderActionExecutionCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const executions = new Map<string, StoredActionExecution>();
  const completedFailureHandoffs = new Set<string>();
  const pendingFailureHandoffs = new Set<string>();
  const inFlightFailureHandoffs = new Set<string>();

  const storedEvents = options.database.listExecutionEventsByTypes(actionExecutionEventTypes);
  for (const event of storedEvents) {
    if (event.eventType === 'blender.action-execution.failure-handoff-completed') continue;
    const parsed = storedActionExecutionEventSchema.parse(event.payload);
    const previous = executions.get(parsed.execution.requestId);
    assertStoredTransition(previous, parsed);
    executions.set(parsed.execution.requestId, parsed);
  }
  for (const event of storedEvents) {
    if (event.eventType !== 'blender.action-execution.failure-handoff-completed') continue;
    const handoff = failureHandoffEventSchema.parse(event.payload);
    const execution = executions.get(handoff.requestId)?.execution;
    if (
      execution === undefined ||
      (execution.status !== 'failed' && execution.status !== 'rejected') ||
      handoff.executionContentSha256 !== executionContentSha256(execution) ||
      handoff.handoffId !== failureHandoffId(execution)
    ) {
      throw new Error(`Action execution ${handoff.requestId} has invalid failure handoff evidence`);
    }
    completedFailureHandoffs.add(handoff.requestId);
  }

  const append = (
    eventType: (typeof actionExecutionEventTypes)[number],
    stored: StoredActionExecution,
  ): CompanionActionExecutionStatus => {
    const parsed = storedActionExecutionEventSchema.parse(stored);
    options.database.appendEvent({
      id: `blender-action-execution:${parsed.execution.requestId}:${parsed.execution.status}`,
      eventType,
      payload: parsed,
      createdAt: parsed.execution.updatedAt,
    });
    executions.set(parsed.execution.requestId, parsed);
    return parsed.execution;
  };

  for (const stored of [...executions.values()]) {
    if (stored.execution.status !== 'dispatched') continue;
    const recoveredAt = now();
    append('blender.action-execution.recovery-required', {
      sessionFingerprintSha256: stored.sessionFingerprintSha256,
      execution: companionActionExecutionStatusSchema.parse({
        ...stored.execution,
        status: 'recovery_required',
        updatedAt: recoveredAt,
      }),
    });
  }
  for (const { execution } of executions.values()) {
    if (
      (execution.status === 'failed' || execution.status === 'rejected') &&
      !completedFailureHandoffs.has(execution.requestId)
    ) {
      pendingFailureHandoffs.add(execution.requestId);
    }
  }

  const handoffTerminalFailure = async (
    execution: CompanionActionExecutionStatus,
  ): Promise<boolean> => {
    if (completedFailureHandoffs.has(execution.requestId)) return true;
    pendingFailureHandoffs.add(execution.requestId);
    if (
      options.onTerminalFailure === undefined ||
      inFlightFailureHandoffs.has(execution.requestId)
    ) {
      return false;
    }
    const executionHash = executionContentSha256(execution);
    const handoffId = failureHandoffId(execution);
    inFlightFailureHandoffs.add(execution.requestId);
    try {
      await options.onTerminalFailure({
        handoffId,
        requestId: execution.requestId,
        execution,
        executionContentSha256: executionHash,
      });
      const handedOffAt = now();
      options.database.appendEvent({
        id: `blender-action-execution:${handoffId}:completed`,
        eventType: 'blender.action-execution.failure-handoff-completed',
        payload: {
          handoffId,
          requestId: execution.requestId,
          executionContentSha256: executionHash,
          handedOffAt,
        },
        createdAt: handedOffAt,
      });
      completedFailureHandoffs.add(execution.requestId);
      pendingFailureHandoffs.delete(execution.requestId);
      return true;
    } catch {
      return false;
    } finally {
      inFlightFailureHandoffs.delete(execution.requestId);
    }
  };

  const retryTerminalFailureHandoffs = async (): Promise<readonly string[]> => {
    for (const requestId of [...pendingFailureHandoffs]) {
      const execution = executions.get(requestId)?.execution;
      if (execution !== undefined) await handoffTerminalFailure(execution);
    }
    return [...pendingFailureHandoffs].sort();
  };

  const get = (requestId: string): CompanionActionExecutionStatus | null =>
    executions.get(requestId)?.execution ?? null;

  const ownsTarget = (adapterId: 'blender', instanceId: string): boolean =>
    [...executions.values()].some(
      ({ execution }) =>
        execution.target.adapterId === adapterId &&
        execution.target.instanceId === instanceId &&
        (execution.status === 'queued' ||
          execution.status === 'dispatched' ||
          execution.status === 'recovery_required'),
    );

  const findForCreate = (
    input: CompanionActionExecutionCreateRequest,
  ): CompanionActionExecutionStatus | null => {
    const request = companionActionExecutionCreateRequestSchema.parse(input);
    const existing = executions.get(request.requestId)?.execution;
    if (existing === undefined) return null;
    if (!sameCreateRequest(existing, request)) {
      throw new BlenderActionExecutionError(
        'action_execution_request_conflict',
        409,
        'The requestId is already bound to a different action execution request',
      );
    }
    return existing;
  };

  const queue = (
    input: CompanionActionExecutionStatus,
    sessionFingerprintSha256: string,
  ): CompanionActionExecutionStatus => {
    const execution = companionActionExecutionStatusSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    if (execution.status !== 'queued') {
      throw new Error('Only a queued action execution can enter the coordinator');
    }
    const existing = findForCreate({
      formatVersion: execution.formatVersion,
      requestId: execution.requestId,
      replayId: execution.replayId,
      expectedState: execution.expectedState,
    });
    if (existing !== null) return existing;

    const externalOwner = options.externalHistoryLockOwner?.(
      execution.target.adapterId,
      execution.target.instanceId,
    );
    if (externalOwner !== undefined && externalOwner !== null) {
      throw new BlenderActionExecutionError(
        'action_execution_history_locked',
        409,
        `Compound replay ${externalOwner} owns the target native history lock`,
      );
    }

    const conflicting = [...executions.values()].find(
      ({ execution: candidate }) =>
        candidate.target.adapterId === execution.target.adapterId &&
        candidate.target.instanceId === execution.target.instanceId &&
        (candidate.status === 'queued' ||
          candidate.status === 'dispatched' ||
          candidate.status === 'recovery_required'),
    );
    if (conflicting !== undefined) {
      throw new BlenderActionExecutionError(
        'action_execution_in_progress',
        409,
        `Action execution ${conflicting.execution.requestId} still owns the target instance`,
      );
    }
    return append('blender.action-execution.queued', {
      execution,
      sessionFingerprintSha256: fingerprint,
    });
  };

  const poll = (
    adapterId: 'blender',
    instanceId: string,
    sessionFingerprintSha256: string,
  ): CompanionActionExecutionDelivery | null => {
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const pending = [...executions.values()]
      .filter(
        ({ execution }) =>
          execution.status === 'queued' &&
          execution.target.adapterId === adapterId &&
          execution.target.instanceId === instanceId,
      )
      .sort(
        (left, right) =>
          left.execution.requestedAt.localeCompare(right.execution.requestedAt) ||
          left.execution.requestId.localeCompare(right.execution.requestId),
      )[0];
    if (pending === undefined) return null;
    const dispatchedAt = now();
    const delivery = companionActionExecutionDeliverySchema.parse({
      formatVersion: pending.execution.formatVersion,
      requestId: pending.execution.requestId,
      replayId: pending.execution.replayId,
      target: pending.execution.target,
      proposalId: pending.execution.proposalId,
      plan: pending.execution.plan,
      planContentSha256: pending.execution.planContentSha256,
      executionId: pending.execution.executionId,
      expectedState: pending.execution.expectedState,
      deliveryId: createId(),
      step: pending.execution.step,
      requestedAt: pending.execution.requestedAt,
      dispatchedAt,
    });
    append('blender.action-execution.dispatched', {
      sessionFingerprintSha256: fingerprint,
      execution: companionActionExecutionStatusSchema.parse({
        ...pending.execution,
        deliveryId: delivery.deliveryId,
        dispatchedAt,
        status: 'dispatched',
        updatedAt: dispatchedAt,
      }),
    });
    return delivery;
  };

  const complete = async (
    input: CompanionActionExecutionResult,
    sessionFingerprintSha256: string,
    validateResult: (
      result: CompanionActionExecutionResult,
      execution: CompanionActionExecutionStatus,
    ) => void,
  ): Promise<'accepted' | 'duplicate'> => {
    const result = companionActionExecutionResultSchema.parse(input);
    const fingerprint = contentSha256Schema.parse(sessionFingerprintSha256);
    const stored = executions.get(result.requestId);
    if (stored === undefined) {
      throw new BlenderActionExecutionError(
        'action_execution_not_found',
        404,
        'The action execution request was not found',
      );
    }
    const terminal =
      stored.execution.status === 'succeeded' ||
      stored.execution.status === 'failed' ||
      stored.execution.status === 'rejected';
    if (terminal) {
      if (
        stored.sessionFingerprintSha256 !== fingerprint ||
        !sameDeliveryIdentity(stored.execution, result)
      ) {
        throw new BlenderActionExecutionError(
          'action_execution_result_identity_mismatch',
          409,
          'The action result does not match its accepted delivery and Companion session',
        );
      }
      if (isDeepStrictEqual(stored.execution.result, result)) {
        if (stored.execution.status === 'failed' || stored.execution.status === 'rejected') {
          await handoffTerminalFailure(stored.execution);
        }
        return 'duplicate';
      }
      throw new BlenderActionExecutionError(
        'action_execution_result_conflict',
        409,
        'The action execution already has a different terminal result',
      );
    }
    if (stored.execution.status !== 'dispatched') {
      throw new BlenderActionExecutionError(
        'action_execution_not_completable',
        409,
        stored.execution.status === 'recovery_required'
          ? 'The dispatched action became indeterminate after restart and cannot be completed automatically'
          : 'The action execution has not been dispatched',
      );
    }
    if (
      stored.sessionFingerprintSha256 !== fingerprint ||
      !sameDeliveryIdentity(stored.execution, result)
    ) {
      throw new BlenderActionExecutionError(
        'action_execution_result_identity_mismatch',
        409,
        'The action result does not match its accepted delivery and Companion session',
      );
    }
    validateResult(result, stored.execution);
    const completedAt = now();
    const completed = append('blender.action-execution.completed', {
      sessionFingerprintSha256: fingerprint,
      execution: companionActionExecutionStatusSchema.parse({
        ...stored.execution,
        status: result.status,
        result,
        updatedAt: completedAt,
      }),
    });
    if (completed.status === 'failed' || completed.status === 'rejected') {
      await handoffTerminalFailure(completed);
    }
    return 'accepted';
  };

  return {
    complete,
    findForCreate,
    get,
    ownsTarget,
    pendingTerminalFailureHandoffs: () => [...pendingFailureHandoffs].sort(),
    poll,
    queue,
    retryTerminalFailureHandoffs,
  };
}

export type BlenderActionExecutionCoordinator = ReturnType<
  typeof createBlenderActionExecutionCoordinator
>;
