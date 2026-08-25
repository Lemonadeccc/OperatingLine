import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  type CompanionLeafOperationDelivery,
  type CompanionLeafOperationRecoveryAck,
  type CompanionLeafOperationRecoveryChallenge,
  type CompanionLeafOperationResult,
  type CompanionLeafOperationStatus,
  computeCompanionLeafOperationBindingSha256,
  lightTrailsLeafOperationIds,
  transformGeometryLeafOperationIds,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  BlenderLeafOperationExecutionError,
  continuesAuthorizedLeafOperationCheckpoint,
  createBlenderLeafOperationExecutionCoordinator,
} from '../../../services/orchestrator/src/blender-leaf-operation-execution.js';

const documentAuthority = '9'.repeat(64);

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) throw new Error(`duplicate ${input.id}`);
      const event = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-24T10:00:00Z',
      };
      events.push(event);
      return event;
    },
    listExecutionEventsByTypes(eventTypes: readonly string[]) {
      return events.filter((event) => eventTypes.includes(event.eventType));
    },
  };
}

function queuedOperation(ordinal = 1, overrides: Record<string, unknown> = {}) {
  const authority = {
    formatVersion: '1.0.0',
    requestId: randomUUID(),
    replayId: randomUUID(),
    target: { adapterId: 'blender', instanceId: randomUUID() },
    proposalId: randomUUID(),
    plan: { id: 'procedure-replay.transform', revision: 1 },
    planContentSha256: '1'.repeat(64),
    executionId: randomUUID(),
    leafId: 'geometry.transform',
    stepId: 'geometry.transform',
    actionName: 'blender.geometry_nodes.create_transform',
    recipeId: 'blender.geometry_nodes.create_transform.semantic',
    catalogVersion: '1.49.0',
    interactionCatalogContentSha256: '2'.repeat(64),
    materializationContentSha256: '3'.repeat(64),
    mcpTrackContentSha256: '4'.repeat(64),
    expectedState: { reportId: randomUUID(), sequence: 7 },
    operationIds: transformGeometryLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: transformGeometryLeafOperationIds[ordinal - 1]!,
    operationParameters: {},
  } as const;
  return {
    ...authority,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(authority),
    requestedAt: '2026-08-24T10:00:00Z',
    status: 'queued',
    updatedAt: '2026-08-24T10:00:00Z',
    ...overrides,
  } as const;
}

function withQueuedTarget(
  queued: ReturnType<typeof queuedOperation>,
  target: ReturnType<typeof queuedOperation>['target'],
) {
  const authority = {
    formatVersion: queued.formatVersion,
    requestId: queued.requestId,
    replayId: queued.replayId,
    target,
    proposalId: queued.proposalId,
    plan: queued.plan,
    planContentSha256: queued.planContentSha256,
    executionId: queued.executionId,
    leafId: queued.leafId,
    stepId: queued.stepId,
    actionName: queued.actionName,
    recipeId: queued.recipeId,
    catalogVersion: queued.catalogVersion,
    interactionCatalogContentSha256: queued.interactionCatalogContentSha256,
    materializationContentSha256: queued.materializationContentSha256,
    mcpTrackContentSha256: queued.mcpTrackContentSha256,
    expectedState: queued.expectedState,
    operationIds: queued.operationIds,
    operationOrdinal: queued.operationOrdinal,
    sourceOperationId: queued.sourceOperationId,
    operationParameters: queued.operationParameters,
  } as const;
  return {
    ...authority,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(authority),
    requestedAt: queued.requestedAt,
    status: queued.status,
    updatedAt: queued.updatedAt,
  } as const;
}

function continuingQueued(seed: ReturnType<typeof queuedOperation>, ordinal: number) {
  const authority = {
    formatVersion: seed.formatVersion,
    requestId: randomUUID(),
    replayId: seed.replayId,
    target: seed.target,
    proposalId: seed.proposalId,
    plan: seed.plan,
    planContentSha256: seed.planContentSha256,
    executionId: seed.executionId,
    leafId: seed.leafId,
    stepId: seed.stepId,
    actionName: seed.actionName,
    recipeId: seed.recipeId,
    catalogVersion: seed.catalogVersion,
    interactionCatalogContentSha256: seed.interactionCatalogContentSha256,
    materializationContentSha256: seed.materializationContentSha256,
    mcpTrackContentSha256: seed.mcpTrackContentSha256,
    expectedState: seed.expectedState,
    operationIds: transformGeometryLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: transformGeometryLeafOperationIds[ordinal - 1]!,
    operationParameters: {},
  } as const;
  return {
    ...authority,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(authority),
    requestedAt: '2026-08-24T10:00:00Z',
    status: 'queued',
    updatedAt: '2026-08-24T10:00:00Z',
  } as const;
}

function succeededResult(
  queued: ReturnType<typeof queuedOperation>,
  delivery: CompanionLeafOperationDelivery,
  runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  receiptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
) {
  const ordinal = queued.operationOrdinal;
  const final = ordinal === 11;
  const beforeStage = ordinal <= 2 ? 0 : ordinal - 1;
  const afterStage = ordinal === 1 ? 0 : ordinal === 11 ? 10 : ordinal;
  return {
    ...delivery,
    status: 'succeeded',
    progress: {
      runId,
      bindingSha256: '5'.repeat(64),
      stepId: queued.stepId,
      actionName: queued.actionName,
      recipeId: queued.recipeId,
      catalogVersion: queued.catalogVersion,
      operationIds: transformGeometryLeafOperationIds,
      completedOperationIds: transformGeometryLeafOperationIds.slice(0, ordinal),
      nextOrdinal: ordinal + 1,
      latestObservation: {
        kind: 'guided_geometry_operation',
        satisfied: true,
        details: {
          status: 'passed',
          direction: 'forward',
          operationOrdinal: ordinal,
          operationId: queued.sourceOperationId,
          mutating: ordinal >= 2 && ordinal <= 10,
          receiptId,
          runId: '',
          stepId: queued.stepId,
          actionName: queued.actionName,
          recipeId: queued.recipeId,
          catalogVersion: queued.catalogVersion,
          beforeFingerprintSha256: beforeStage.toString(16).repeat(64),
          afterFingerprintSha256: afterStage.toString(16).repeat(64),
          evidence: {
            completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
            preconditionsValidated: ordinal === 1,
            completeGraph: final,
          },
        },
      },
      leafCompleted: final,
      finalReport: final
        ? { reportId: randomUUID(), sequence: queued.expectedState.sequence + 1 }
        : null,
    },
    error: null,
    occurredAt: '2026-08-24T10:00:03Z',
  } as CompanionLeafOperationResult;
}

function queuedLightTrailsOperation(
  ordinal = 1,
  seed?: CompanionLeafOperationStatus,
): CompanionLeafOperationStatus {
  const authority = {
    formatVersion: '1.0.0' as const,
    requestId: randomUUID(),
    replayId: seed?.replayId ?? randomUUID(),
    target: seed?.target ?? { adapterId: 'blender' as const, instanceId: randomUUID() },
    proposalId: seed?.proposalId ?? randomUUID(),
    plan: seed?.plan ?? { id: 'procedure-replay.light-trails', revision: 1 },
    planContentSha256: seed?.planContentSha256 ?? '1'.repeat(64),
    executionId: seed?.executionId ?? randomUUID(),
    leafId: seed?.leafId ?? 'geometry.light-trails',
    stepId: seed?.stepId ?? 'geometry.light-trails',
    actionName: 'blender.geometry_nodes.create_light_trails' as const,
    recipeId: 'blender.geometry_nodes.create_light_trails.semantic' as const,
    catalogVersion: '1.55.0',
    interactionCatalogContentSha256: seed?.interactionCatalogContentSha256 ?? '2'.repeat(64),
    materializationContentSha256: seed?.materializationContentSha256 ?? '3'.repeat(64),
    mcpTrackContentSha256: seed?.mcpTrackContentSha256 ?? '4'.repeat(64),
    expectedState: seed?.expectedState ?? { reportId: randomUUID(), sequence: 7 },
    operationIds: lightTrailsLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: lightTrailsLeafOperationIds[ordinal - 1]!,
    operationParameters: {},
  };
  return {
    ...authority,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(authority),
    requestedAt: '2026-08-24T10:00:00Z',
    status: 'queued',
    updatedAt: '2026-08-24T10:00:00Z',
  };
}

function succeededLightTrailsResult(
  queued: CompanionLeafOperationStatus,
  delivery: CompanionLeafOperationDelivery,
): CompanionLeafOperationResult {
  const ordinal = queued.operationOrdinal;
  const final = ordinal === lightTrailsLeafOperationIds.length;
  const beforeStage = ordinal <= 2 ? 0 : ordinal - 1;
  const afterStage = ordinal === 1 ? 0 : final ? ordinal - 1 : ordinal;
  const fingerprint = (stage: number) => stage.toString(16).padStart(64, '0');
  return {
    ...delivery,
    status: 'succeeded',
    progress: {
      runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      bindingSha256: '5'.repeat(64),
      stepId: queued.stepId,
      actionName: queued.actionName,
      recipeId: queued.recipeId,
      catalogVersion: queued.catalogVersion,
      operationIds: lightTrailsLeafOperationIds,
      completedOperationIds: lightTrailsLeafOperationIds.slice(0, ordinal),
      nextOrdinal: ordinal + 1,
      latestObservation: {
        kind: 'guided_geometry_operation',
        satisfied: true,
        details: {
          status: 'passed',
          direction: 'forward',
          operationOrdinal: ordinal,
          operationId: queued.sourceOperationId,
          mutating: ordinal >= 2 && !final,
          receiptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          stepId: queued.stepId,
          actionName: queued.actionName,
          recipeId: queued.recipeId,
          catalogVersion: queued.catalogVersion,
          beforeFingerprintSha256: fingerprint(beforeStage),
          afterFingerprintSha256: fingerprint(afterStage),
          evidence: {
            completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
            preconditionsValidated: ordinal === 1,
            completeGraph: final,
          },
        },
      },
      leafCompleted: final,
      finalReport: final
        ? { reportId: randomUUID(), sequence: queued.expectedState.sequence + 1 }
        : null,
    },
    error: null,
    occurredAt: '2026-08-24T10:00:03Z',
  };
}

function storedEnvelope(event: StoredExecutionEvent): {
  execution: CompanionLeafOperationStatus;
  sessionFingerprintSha256: string;
  completionSessionFingerprintSha256?: string;
  documentAuthoritySha256: string;
} {
  return event.payload as {
    execution: CompanionLeafOperationStatus;
    sessionFingerprintSha256: string;
    completionSessionFingerprintSha256?: string;
    documentAuthoritySha256: string;
  };
}

function storedExecution(event: StoredExecutionEvent): CompanionLeafOperationStatus {
  return storedEnvelope(event).execution;
}

function recoverySignal(
  delivery: CompanionLeafOperationDelivery,
  kind:
    | 'operation_outcome_indeterminate'
    | 'native_undo_outcome_indeterminate'
    | 'observation_outcome_indeterminate' = 'operation_outcome_indeterminate',
  occurredAt = '2026-08-24T10:00:02Z',
): CompanionLeafOperationResult {
  return {
    ...delivery,
    status: 'recovery_required',
    progress: null,
    error: 'The delivered operation outcome is indeterminate.',
    recoveryReason: {
      kind,
      ...(kind === 'native_undo_outcome_indeterminate'
        ? {
            nativeUndoGuard: {
              expectedRestoredCheckpointId: null,
              recoveryTokenSha256: 'f'.repeat(64),
            },
          }
        : {}),
      requiresExplicitRecovery: true,
      automaticReplay: false,
    },
    occurredAt,
  };
}

function recoveryAck(
  challenge: CompanionLeafOperationRecoveryChallenge,
  outcome: 'prefix_restored' | 'unresolved_current_state',
  occurredAt = '2026-08-24T10:00:11Z',
): CompanionLeafOperationRecoveryAck {
  if (outcome === 'unresolved_current_state') {
    return {
      formatVersion: '1.0.0',
      challenge,
      recoveryId: challenge.recoveryId,
      requestId: challenge.originalDelivery.requestId,
      originalDeliveryId: challenge.originalDelivery.deliveryId,
      replacementSessionFingerprintSha256: challenge.replacementSessionFingerprintSha256,
      outcome,
      evidence: {
        kind: outcome,
        reason: 'operation_outcome_indeterminate',
        leafRun: null,
        currentCheckpoint: null,
      },
      retainsTargetLock: true,
      automaticReplay: false,
      occurredAt,
    };
  }
  const checkpointId =
    challenge.acceptedPrefix.completedOperationIds.length === 0
      ? challenge.authorityProof.authorizedStartCheckpointId
      : randomUUID();
  const nativeUndoEvidence =
    challenge.nativeUndoGuard === null
      ? { restoration: 'prefix_observed_without_native_undo' as const }
      : {
          restoration: 'native_undo_restored' as const,
          nativeUndoWitness: {
            sourceCheckpointId: randomUUID(),
            restoredCheckpointId: checkpointId,
            recoveryTokenSha256: challenge.nativeUndoGuard.recoveryTokenSha256,
            restoredAt: '2026-08-24T10:00:10Z',
            probeSatisfied: true as const,
          },
        };
  return {
    formatVersion: '1.0.0',
    challenge,
    recoveryId: challenge.recoveryId,
    requestId: challenge.originalDelivery.requestId,
    originalDeliveryId: challenge.originalDelivery.deliveryId,
    replacementSessionFingerprintSha256: challenge.replacementSessionFingerprintSha256,
    outcome,
    evidence: {
      kind: outcome,
      expectedState: challenge.expectedState,
      leafRun: challenge.acceptedPrefix,
      currentCheckpoint: {
        reportId: challenge.expectedState.reportId,
        sequence: challenge.expectedState.sequence,
        checkpointId,
        previousCheckpointId: null,
        operation:
          challenge.acceptedPrefix.completedOperationIds.length === 0
            ? 'start'
            : 'leaf_operation_failure',
        sceneFingerprintSha256: challenge.acceptedPrefix.latestFingerprintSha256,
        markerMatched: true,
        sessionSnapshotMatches: true,
        stageVerified: true,
        observedAt: '2026-08-24T10:00:10Z',
      },
      ...nativeUndoEvidence,
    },
    retainsTargetLock: false,
    automaticReplay: false,
    occurredAt,
  };
}

function operationAppliedAck(
  challenge: CompanionLeafOperationRecoveryChallenge,
  terminalResult: CompanionLeafOperationResult,
): CompanionLeafOperationRecoveryAck {
  return {
    formatVersion: '1.0.0',
    challenge,
    recoveryId: challenge.recoveryId,
    requestId: challenge.originalDelivery.requestId,
    originalDeliveryId: challenge.originalDelivery.deliveryId,
    replacementSessionFingerprintSha256: challenge.replacementSessionFingerprintSha256,
    outcome: 'operation_applied',
    evidence: {
      kind: 'operation_applied',
      terminalResult,
      currentCheckpoint: {
        reportId: challenge.expectedState.reportId,
        sequence: challenge.expectedState.sequence,
        checkpointId: randomUUID(),
        previousCheckpointId: challenge.authorityProof.authorizedStartCheckpointId,
        operation: 'leaf_operation',
        sceneFingerprintSha256:
          terminalResult.progress?.latestObservation.details.afterFingerprintSha256 ?? null,
        markerMatched: true,
        sessionSnapshotMatches: true,
        stageVerified: true,
        observedAt: '2026-08-24T10:00:10Z',
      },
    },
    retainsTargetLock: false,
    automaticReplay: false,
    occurredAt: '2026-08-24T10:00:11Z',
  };
}

function documentIncarnationRetiredAck(
  challenge: CompanionLeafOperationRecoveryChallenge,
): CompanionLeafOperationRecoveryAck {
  return {
    formatVersion: '1.0.0',
    challenge,
    recoveryId: challenge.recoveryId,
    requestId: challenge.originalDelivery.requestId,
    originalDeliveryId: challenge.originalDelivery.deliveryId,
    replacementSessionFingerprintSha256: challenge.replacementSessionFingerprintSha256,
    outcome: 'document_incarnation_retired',
    evidence: {
      kind: 'document_incarnation_retired',
      reason:
        challenge.nativeUndoGuard === null
          ? 'runtime_recovery_evidence_lost'
          : 'native_undo_witness_lost_after_reload',
      mutationOutcome: 'indeterminate',
      requiresFreshDocumentIncarnation: true,
    },
    retainsTargetLock: false,
    automaticReplay: false,
    occurredAt: '2026-08-24T10:00:11Z',
  };
}

describe('Blender leaf operation execution coordinator', () => {
  it('accepts only the checkpoint that directly continues the authorized start', () => {
    const authorized = '11111111-1111-4111-8111-111111111111';
    const final = '33333333-3333-4333-8333-333333333333';
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, final, authorized)).toBe(true);
    expect(
      continuesAuthorizedLeafOperationCheckpoint(authorized, final, authorized, undefined, 11),
    ).toBe(true);
    expect(
      continuesAuthorizedLeafOperationCheckpoint(
        authorized,
        final,
        '22222222-2222-4222-8222-222222222222',
      ),
    ).toBe(false);
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, final, null)).toBe(false);
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, null, authorized)).toBe(false);
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, authorized, authorized)).toBe(
      false,
    );
  });

  it('accepts an exact operation-level checkpoint lineage from the authorized start', () => {
    const authorized = '11111111-1111-4111-8111-111111111111';
    const first = '22222222-2222-4222-8222-222222222222';
    const second = '33333333-3333-4333-8333-333333333333';
    const final = '44444444-4444-4444-8444-444444444444';
    const lineage = [authorized, first, second, final];

    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, final, second, lineage, 3)).toBe(
      true,
    );
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, final, second, lineage, 2)).toBe(
      false,
    );
    expect(
      continuesAuthorizedLeafOperationCheckpoint(
        authorized,
        final,
        second,
        [authorized, first, first, final],
        3,
      ),
    ).toBe(false);
    expect(continuesAuthorizedLeafOperationCheckpoint(authorized, final, first, lineage, 3)).toBe(
      false,
    );
  });

  it('persists queue, dispatch, partial success, duplicate, and conflict at most once', () => {
    const database = createEventDatabase();
    const deliveryId = randomUUID();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      createId: () => deliveryId,
      now: (() => {
        const times = ['2026-08-24T10:00:01Z', '2026-08-24T10:00:04Z'];
        return () => times.shift()!;
      })(),
    });
    const queued = queuedOperation(1);
    const fingerprint = 'a'.repeat(64);
    expect(coordinator.queue(queued, fingerprint, documentAuthority)).toMatchObject({
      status: 'queued',
    });
    expect(
      coordinator.findForCreate({
        formatVersion: queued.formatVersion,
        requestId: queued.requestId,
        replayId: queued.replayId,
        expectedState: queued.expectedState,
      }),
    ).toMatchObject({ requestId: queued.requestId });
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const result = succeededResult(queued, delivery);
    result.progress.latestObservation.details.runId = result.progress.runId;
    expect(coordinator.complete(result, fingerprint, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    expect(coordinator.complete(result, fingerprint, documentAuthority, () => undefined)).toBe(
      'duplicate',
    );
    expect(() =>
      coordinator.complete(
        { ...result, occurredAt: '2026-08-24T10:00:05Z' },
        fingerprint,
        documentAuthority,
        () => undefined,
      ),
    ).toThrow(BlenderLeafOperationExecutionError);
    expect(coordinator.latestSucceededForReplay(queued.replayId)).toMatchObject({
      operationOrdinal: 1,
      status: 'succeeded',
    });
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.leaf-operation.queued',
      'blender.leaf-operation.dispatched',
      'blender.leaf-operation.completed',
    ]);
  });

  it('accepts final operation progress with the next Companion report', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation(1);
    const fingerprint = 'b'.repeat(64);
    let current = queued;
    for (let ordinal = 1; ordinal <= 11; ordinal += 1) {
      if (ordinal > 1) current = continuingQueued(queued, ordinal);
      coordinator.queue(current, fingerprint, documentAuthority);
      const delivery = coordinator.poll(
        'blender',
        current.target.instanceId,
        fingerprint,
        documentAuthority,
      )!;
      const result = succeededResult(current, delivery);
      result.progress.latestObservation.details.runId = result.progress.runId;
      expect(coordinator.complete(result, fingerprint, documentAuthority, () => undefined)).toBe(
        'accepted',
      );
    }
    expect(coordinator.get(current.requestId)?.result?.progress).toMatchObject({
      nextOrdinal: 12,
      leafCompleted: true,
      finalReport: { sequence: 8 },
    });
    expect(coordinator.successfulExecutionsForReplay(queued.replayId)).toHaveLength(11);
    expect(() =>
      coordinator.queue(continuingQueued(queued, 11), fingerprint, documentAuthority),
    ).toThrow(/not the authorized next operation/);
  });

  it('persists the complete Light Trails 54-operation profile under one durable run', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const first = queuedLightTrailsOperation();
    const fingerprint = 'c'.repeat(64);
    let current = first;
    for (let ordinal = 1; ordinal <= lightTrailsLeafOperationIds.length; ordinal += 1) {
      if (ordinal > 1) current = queuedLightTrailsOperation(ordinal, first);
      coordinator.queue(current, fingerprint, documentAuthority);
      const delivery = coordinator.poll(
        'blender',
        current.target.instanceId,
        fingerprint,
        documentAuthority,
      )!;
      expect(delivery.actionName).toBe('blender.geometry_nodes.create_light_trails');
      expect(delivery.sourceOperationId).toBe(lightTrailsLeafOperationIds[ordinal - 1]);
      expect(
        coordinator.complete(
          succeededLightTrailsResult(current, delivery),
          fingerprint,
          documentAuthority,
          () => undefined,
        ),
      ).toBe('accepted');
    }
    expect(coordinator.get(current.requestId)?.result?.progress).toMatchObject({
      nextOrdinal: 55,
      leafCompleted: true,
      finalReport: { sequence: 8 },
    });
    expect(coordinator.successfulExecutionsForReplay(first.replayId)).toHaveLength(54);
    expect(database.events).toHaveLength(162);
  });

  it('allows a new request to retry an ordinal after a failed terminal request', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const failed = queuedOperation();
    const fingerprint = '8'.repeat(64);
    coordinator.queue(failed, fingerprint, documentAuthority);
    const failedDelivery = coordinator.poll(
      'blender',
      failed.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    expect(
      coordinator.complete(
        {
          ...failedDelivery,
          status: 'failed',
          progress: null,
          error: 'Blender mutation was restored.',
          occurredAt: '2026-08-24T10:00:03Z',
        },
        fingerprint,
        documentAuthority,
        () => undefined,
      ),
    ).toBe('accepted');

    const retry = continuingQueued(failed, 1);
    coordinator.queue(retry, fingerprint, documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      retry.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const result = succeededResult(retry, delivery);
    result.progress.latestObservation.details.runId = result.progress.runId;
    expect(coordinator.complete(result, fingerprint, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    expect(coordinator.successfulExecutionsForReplay(failed.replayId)).toHaveLength(1);
  });

  it('allows lease rotation within and between operations only for the same durable document', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    const leaseC = 'c'.repeat(64);
    const otherDocument = 'd'.repeat(64);
    const first = queuedOperation();

    coordinator.queue(first, leaseA, documentAuthority);
    const firstDelivery = coordinator.poll(
      'blender',
      first.target.instanceId,
      leaseB,
      documentAuthority,
    )!;
    const firstResult = succeededResult(first, firstDelivery);
    firstResult.progress!.latestObservation.details.runId = firstResult.progress!.runId;
    expect(coordinator.complete(firstResult, leaseC, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    const firstCompleted = database.events.find(
      (event) =>
        event.eventType === 'blender.leaf-operation.completed' &&
        storedExecution(event).requestId === first.requestId,
    )!;
    expect(storedEnvelope(firstCompleted)).toMatchObject({
      sessionFingerprintSha256: leaseB,
      completionSessionFingerprintSha256: leaseC,
      documentAuthoritySha256: documentAuthority,
    });
    expect(coordinator.complete(firstResult, leaseA, documentAuthority, () => undefined)).toBe(
      'duplicate',
    );
    expect(storedEnvelope(firstCompleted).completionSessionFingerprintSha256).toBe(leaseC);

    const second = continuingQueued(first, 2);
    coordinator.queue(second, leaseB, documentAuthority);
    const secondDelivery = coordinator.poll(
      'blender',
      second.target.instanceId,
      leaseB,
      documentAuthority,
    )!;
    const secondResult = succeededResult(second, secondDelivery);
    secondResult.progress!.latestObservation.details.runId = secondResult.progress!.runId;
    expect(() =>
      coordinator.complete(secondResult, leaseC, otherDocument, () => undefined),
    ).toThrow(/Companion document/);
    expect(coordinator.complete(secondResult, leaseC, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    expect(coordinator.successfulExecutionsForReplay(first.replayId)).toHaveLength(2);
  });

  it('expires queued work atomically when the current document authority drifts', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    const otherDocument = 'd'.repeat(64);

    coordinator.queue(queued, leaseA, documentAuthority);
    expect(coordinator.poll('blender', queued.target.instanceId, leaseB, otherDocument)).toBeNull();
    expect(coordinator.get(queued.requestId)).toMatchObject({
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpirationEvidence: {
        source: 'document_authority_drift',
        priorStatus: 'queued',
        resolution: 'pre_dispatch_authority_expired',
        retainsTargetLock: false,
        automaticReplay: false,
      },
    });
    expect(coordinator.get(queued.requestId)).not.toHaveProperty('deliveryId');
    expect(coordinator.get(queued.requestId)).not.toHaveProperty('result');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(coordinator.listTargetLockOwners()).toEqual([]);
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.leaf-operation.queued',
      'blender.leaf-operation.pre-dispatch-authority-expired',
    ]);

    const restarted = createBlenderLeafOperationExecutionCoordinator({ database });
    expect(restarted.get(queued.requestId)?.status).toBe('pre_dispatch_authority_expired');
    expect(restarted.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(restarted.poll('blender', queued.target.instanceId, leaseB, otherDocument)).toBeNull();
    expect(database.events).toHaveLength(2);

    const replacement = withQueuedTarget(queuedOperation(), queued.target);
    expect(restarted.queue(replacement, leaseB, otherDocument).status).toBe('queued');
  });

  it('reconciles queued authority drift immediately and idempotently at session establishment', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    const otherDocument = 'd'.repeat(64);
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);

    expect(
      coordinator.reconcileDocumentAuthority('blender', queued.target.instanceId, otherDocument),
    ).toEqual([
      expect.objectContaining({
        requestId: queued.requestId,
        status: 'pre_dispatch_authority_expired',
      }),
    ]);
    expect(
      coordinator.reconcileDocumentAuthority('blender', queued.target.instanceId, otherDocument),
    ).toEqual([]);
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(database.events).toHaveLength(2);
  });

  it('keeps the queued lock when durable authority-expiration persistence fails', () => {
    const durable = createEventDatabase();
    const database = {
      ...durable,
      appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
        if (input.eventType === 'blender.leaf-operation.pre-dispatch-authority-expired') {
          throw new Error('durable append failed');
        }
        return durable.appendEvent(input);
      },
    };
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);

    expect(() =>
      coordinator.poll('blender', queued.target.instanceId, 'b'.repeat(64), 'd'.repeat(64)),
    ).toThrow(/durable append failed/);
    expect(coordinator.get(queued.requestId)?.status).toBe('queued');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(durable.events).toHaveLength(1);
  });

  it('moves an indeterminate dispatched operation to recovery_required on restart and never replays it', () => {
    const database = createEventDatabase();
    const queued = queuedOperation();
    const fingerprint = 'c'.repeat(64);
    const first = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    first.queue(queued, fingerprint, documentAuthority);
    const delivery = first.poll(
      'blender',
      queued.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;

    const restarted = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:04Z',
    });
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(
      restarted.poll('blender', queued.target.instanceId, fingerprint, documentAuthority),
    ).toBeNull();
    const result = succeededResult(queued, delivery);
    result.progress.latestObservation.details.runId = result.progress.runId;
    expect(() =>
      restarted.complete(result, fingerprint, documentAuthority, () => undefined),
    ).toThrow(/explicit read-only recovery/);
    expect(restarted.ownsTarget('blender', queued.target.instanceId)).toBe(true);
  });

  it('persists Companion recovery signals and resolves only a validated restored prefix', () => {
    const database = createEventDatabase();
    const times = ['2026-08-24T10:00:01Z', '2026-08-24T10:00:03Z'];
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => times.shift()!,
    });
    const queued = queuedOperation();
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    coordinator.queue(queued, leaseA, documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      leaseA,
      documentAuthority,
    )!;
    const signal = recoverySignal(delivery, 'native_undo_outcome_indeterminate');
    expect(coordinator.complete(signal, leaseA, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    expect(coordinator.complete(signal, leaseA, documentAuthority, () => undefined)).toBe(
      'duplicate',
    );
    expect(coordinator.get(queued.requestId)).toMatchObject({
      status: 'recovery_required',
      recoveryEvidence: {
        source: 'companion_reported',
        reason: 'native_undo_outcome_indeterminate',
        automaticReplay: false,
        retainsTargetLock: true,
      },
    });

    const authorizedStartCheckpointId = randomUUID();
    const challenge = coordinator.issueRecoveryChallenge(
      queued.requestId,
      leaseB,
      documentAuthority,
      {
        reportId: queued.expectedState.reportId,
        sequence: queued.expectedState.sequence,
        authorizedStartCheckpointId,
      },
    );
    expect(challenge).toMatchObject({
      originalDelivery: { deliveryId: delivery.deliveryId },
      originalSessionFingerprintSha256: leaseA,
      replacementSessionFingerprintSha256: leaseB,
      acceptedPrefix: {
        completedOperationIds: [],
        nextOrdinal: 1,
        latestFingerprintSha256: null,
      },
      nativeUndoGuard: {
        expectedRestoredCheckpointId: null,
        recoveryTokenSha256: 'f'.repeat(64),
      },
      automaticReplay: false,
    });
    expect(
      coordinator.pollRecovery('blender', queued.target.instanceId, leaseB, documentAuthority),
    ).toEqual(challenge);
    expect(
      coordinator.pollRecovery('blender', queued.target.instanceId, leaseA, documentAuthority),
    ).toBeNull();
    const ack = recoveryAck(challenge, 'prefix_restored');
    const eventCountBeforeValidation = database.events.length;
    expect(() =>
      coordinator.acknowledgeRecovery(ack, leaseB, documentAuthority, () => {
        throw new Error('live recovery proof rejected');
      }),
    ).toThrow(/live recovery proof rejected/);
    expect(coordinator.get(queued.requestId)?.status).toBe('recovery_required');
    expect(database.events).toHaveLength(eventCountBeforeValidation);
    let validated = false;
    expect(
      coordinator.acknowledgeRecovery(ack, leaseB, documentAuthority, () => {
        validated = true;
      }),
    ).toBe('accepted');
    expect(validated).toBe(true);
    expect(coordinator.get(queued.requestId)?.status).toBe('failed');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(
      coordinator.acknowledgeRecovery(ack, 'c'.repeat(64), documentAuthority, () => undefined),
    ).toBe('duplicate');
  });

  it('keeps unresolved recovery locked, rotates its lease, and rejects stale or cross-document ACKs', () => {
    const database = createEventDatabase();
    const times = ['2026-08-24T10:00:01Z', '2026-08-24T10:00:03Z', '2026-08-24T10:00:05Z'];
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => times.shift()!,
    });
    const queued = queuedOperation();
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    const leaseC = 'c'.repeat(64);
    coordinator.queue(queued, leaseA, documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      leaseA,
      documentAuthority,
    )!;
    coordinator.complete(
      recoverySignal(delivery, 'operation_outcome_indeterminate', '2026-08-24T10:00:04Z'),
      leaseA,
      documentAuthority,
      () => undefined,
    );
    const proof = {
      reportId: queued.expectedState.reportId,
      sequence: queued.expectedState.sequence,
      authorizedStartCheckpointId: randomUUID(),
    } as const;
    const challengeB = coordinator.issueRecoveryChallenge(
      queued.requestId,
      leaseB,
      documentAuthority,
      proof,
    );
    const unresolved = recoveryAck(challengeB, 'unresolved_current_state');
    expect(
      coordinator.acknowledgeRecovery(unresolved, leaseB, documentAuthority, () => undefined),
    ).toBe('accepted');
    expect(
      coordinator.acknowledgeRecovery(unresolved, leaseB, documentAuthority, () => undefined),
    ).toBe('duplicate');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(() =>
      coordinator.issueRecoveryChallenge(queued.requestId, leaseB, documentAuthority, proof),
    ).toThrow(/another replacement lease/);

    const challengeC = coordinator.issueRecoveryChallenge(
      queued.requestId,
      leaseC,
      documentAuthority,
      proof,
    );
    expect(challengeC.recoveryId).not.toBe(challengeB.recoveryId);
    expect(() =>
      coordinator.acknowledgeRecovery(unresolved, leaseB, documentAuthority, () => undefined),
    ).toThrow(/latest recovery challenge/);
    const ackC = recoveryAck(challengeC, 'unresolved_current_state');
    expect(() =>
      coordinator.acknowledgeRecovery(ackC, leaseC, 'd'.repeat(64), () => undefined),
    ).toThrow(/replacement lease and document/);

    const restarted = createBlenderLeafOperationExecutionCoordinator({ database });
    expect(restarted.get(queued.requestId)?.status).toBe('recovery_required');
    expect(
      restarted.pollRecovery('blender', queued.target.instanceId, leaseC, documentAuthority),
    ).toEqual(challengeC);
  });

  it('bounds the durable recovery ledger across more than 32 unresolved lease rotations', () => {
    const database = createEventDatabase();
    let tick = 1;
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => new Date(Date.UTC(2026, 7, 24, 10, 0, tick++)).toISOString(),
    });
    const queued = queuedOperation();
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      'a'.repeat(64),
      documentAuthority,
    )!;
    coordinator.complete(
      recoverySignal(delivery),
      'a'.repeat(64),
      documentAuthority,
      () => undefined,
    );
    const proof = {
      reportId: queued.expectedState.reportId,
      sequence: queued.expectedState.sequence,
      authorizedStartCheckpointId: randomUUID(),
    } as const;
    let latestChallenge: CompanionLeafOperationRecoveryChallenge | undefined;
    let latestAck: CompanionLeafOperationRecoveryAck | undefined;
    let latestLease = '';
    for (let index = 0; index < 40; index += 1) {
      latestLease = (index + 2).toString(16).padStart(64, '0');
      latestChallenge = coordinator.issueRecoveryChallenge(
        queued.requestId,
        latestLease,
        documentAuthority,
        proof,
      );
      const ackAt = new Date(Date.parse(latestChallenge.requestedAt) + 1_000).toISOString();
      latestAck = recoveryAck(latestChallenge, 'unresolved_current_state', ackAt);
      expect(
        coordinator.acknowledgeRecovery(latestAck, latestLease, documentAuthority, () => undefined),
      ).toBe('accepted');
    }
    const lastPayload = database.events.at(-1)!.payload as {
      recoveryChallenges: unknown[];
      recoveryAcks: unknown[];
    };
    expect(lastPayload.recoveryChallenges).toHaveLength(32);
    expect(lastPayload.recoveryAcks).toHaveLength(32);

    const restarted = createBlenderLeafOperationExecutionCoordinator({ database });
    expect(restarted.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(
      restarted.acknowledgeRecovery(latestAck!, latestLease, documentAuthority, () => undefined),
    ).toBe('duplicate');
  });

  it('recovers ordinal N against its durable N-1 prefix without inventing a prior checkpoint id', () => {
    const database = createEventDatabase();
    const times = [
      '2026-08-24T10:00:01Z',
      '2026-08-24T10:00:02Z',
      '2026-08-24T10:00:03Z',
      '2026-08-24T10:00:05Z',
    ];
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => times.shift()!,
    });
    const first = queuedOperation(1);
    coordinator.queue(first, 'a'.repeat(64), documentAuthority);
    const firstDelivery = coordinator.poll(
      'blender',
      first.target.instanceId,
      'a'.repeat(64),
      documentAuthority,
    )!;
    const firstResult = succeededResult(first, firstDelivery);
    firstResult.progress.latestObservation.details.runId = firstResult.progress.runId;
    coordinator.complete(firstResult, 'a'.repeat(64), documentAuthority, () => undefined);

    const second = continuingQueued(first, 2);
    coordinator.queue(second, 'a'.repeat(64), documentAuthority);
    const secondDelivery = coordinator.poll(
      'blender',
      second.target.instanceId,
      'a'.repeat(64),
      documentAuthority,
    )!;
    coordinator.complete(
      recoverySignal(secondDelivery, 'operation_outcome_indeterminate', '2026-08-24T10:00:04Z'),
      'a'.repeat(64),
      documentAuthority,
      () => undefined,
    );
    const authorizedStartCheckpointId = randomUUID();
    const challenge = coordinator.issueRecoveryChallenge(
      second.requestId,
      'b'.repeat(64),
      documentAuthority,
      {
        reportId: second.expectedState.reportId,
        sequence: second.expectedState.sequence,
        authorizedStartCheckpointId,
      },
    );
    expect(challenge.acceptedPrefix).toMatchObject({
      completedOperationIds: [transformGeometryLeafOperationIds[0]],
      nextOrdinal: 2,
      latestFingerprintSha256:
        firstResult.progress.latestObservation.details.afterFingerprintSha256,
    });
    const ack = recoveryAck(challenge, 'prefix_restored');
    expect(ack.evidence.currentCheckpoint?.checkpointId).not.toBe(authorizedStartCheckpointId);
    expect(
      coordinator.acknowledgeRecovery(ack, 'b'.repeat(64), documentAuthority, () => undefined),
    ).toBe('accepted');
    expect(coordinator.get(second.requestId)?.status).toBe('failed');
  });

  it('reconciles an applied operation after its success result was lost', () => {
    const database = createEventDatabase();
    const first = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    const leaseC = 'c'.repeat(64);
    first.queue(queued, leaseA, documentAuthority);
    const delivery = first.poll('blender', queued.target.instanceId, leaseA, documentAuthority)!;
    first.complete(recoverySignal(delivery), leaseA, documentAuthority, () => undefined);

    const restarted = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:03Z',
    });
    const challenge = restarted.issueRecoveryChallenge(
      queued.requestId,
      leaseB,
      documentAuthority,
      {
        reportId: queued.expectedState.reportId,
        sequence: queued.expectedState.sequence,
        authorizedStartCheckpointId: randomUUID(),
      },
    );
    expect(challenge.nativeUndoGuard).toBeNull();
    const terminalResult = succeededResult(queued, delivery);
    terminalResult.progress.latestObservation.details.runId = terminalResult.progress.runId;
    terminalResult.occurredAt = '2026-08-24T10:00:04Z';
    const ack = operationAppliedAck(challenge, terminalResult);
    let validated = false;
    expect(
      restarted.acknowledgeRecovery(ack, leaseB, documentAuthority, () => {
        validated = true;
      }),
    ).toBe('accepted');
    expect(validated).toBe(true);
    expect(restarted.get(queued.requestId)).toMatchObject({
      status: 'succeeded',
      result: { status: 'succeeded', deliveryId: delivery.deliveryId },
    });
    expect(restarted.ownsTarget('blender', queued.target.instanceId)).toBe(false);

    const restartedAgain = createBlenderLeafOperationExecutionCoordinator({ database });
    expect(restartedAgain.get(queued.requestId)?.status).toBe('succeeded');
    expect(
      restartedAgain.acknowledgeRecovery(ack, leaseC, documentAuthority, () => undefined),
    ).toBe('duplicate');
    expect(() =>
      restartedAgain.acknowledgeRecovery(ack, leaseC, 'd'.repeat(64), () => undefined),
    ).toThrow(/replacement lease and document/);
  });

  it('durably retires a reloaded document incarnation and permits only a fresh authority', () => {
    const database = createEventDatabase();
    const queued = queuedOperation();
    const leaseA = 'a'.repeat(64);
    const leaseB = 'b'.repeat(64);
    const leaseC = 'c'.repeat(64);
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:03Z',
    });
    coordinator.queue(queued, leaseA, documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      leaseA,
      documentAuthority,
    )!;
    coordinator.complete(
      recoverySignal(delivery, 'operation_outcome_indeterminate', '2026-08-24T10:00:04Z'),
      leaseA,
      documentAuthority,
      () => undefined,
    );
    const challenge = coordinator.issueRecoveryChallenge(
      queued.requestId,
      leaseB,
      documentAuthority,
      {
        reportId: queued.expectedState.reportId,
        sequence: queued.expectedState.sequence,
        authorizedStartCheckpointId: randomUUID(),
      },
    );
    const ack = documentIncarnationRetiredAck(challenge);
    expect(() =>
      coordinator.acknowledgeRecovery(ack, leaseC, documentAuthority, () => undefined),
    ).toThrow(/exact replacement Companion lease/);
    expect(coordinator.acknowledgeRecovery(ack, leaseB, documentAuthority, () => undefined)).toBe(
      'accepted',
    );
    expect(coordinator.get(queued.requestId)).toMatchObject({
      status: 'failed',
      result: {
        status: 'failed',
        error: expect.stringContaining('document incarnation is retired'),
      },
    });
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(() => coordinator.queue(queued, leaseC, documentAuthority)).toThrowError(
      expect.objectContaining({ code: 'leaf_operation_document_incarnation_retired' }),
    );

    const sameDocumentRequest = withQueuedTarget(queuedOperation(), queued.target);
    expect(() => coordinator.queue(sameDocumentRequest, leaseC, documentAuthority)).toThrowError(
      expect.objectContaining({
        code: 'leaf_operation_document_incarnation_retired',
        statusCode: 409,
      }),
    );

    const restarted = createBlenderLeafOperationExecutionCoordinator({ database });
    expect(restarted.acknowledgeRecovery(ack, leaseC, documentAuthority, () => undefined)).toBe(
      'duplicate',
    );
    expect(() =>
      restarted.acknowledgeRecovery(
        { ...ack, occurredAt: '2026-08-24T10:00:12Z' },
        leaseC,
        documentAuthority,
        () => undefined,
      ),
    ).toThrow(/different acknowledgement/);
    expect(() => restarted.queue(sameDocumentRequest, leaseC, documentAuthority)).toThrow(
      /fresh document incarnation is required/,
    );

    const freshAuthority = 'd'.repeat(64);
    expect(restarted.queue(sameDocumentRequest, leaseC, freshAuthority)).toMatchObject({
      requestId: sameDocumentRequest.requestId,
      status: 'queued',
    });
  });

  it('does not retire the document in memory when durable retirement persistence fails', () => {
    const durable = createEventDatabase();
    const database = {
      ...durable,
      appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
        if (
          input.eventType === 'blender.leaf-operation.completed' &&
          (input.payload as { recoveryAcks?: Array<{ outcome?: string }> }).recoveryAcks?.at(-1)
            ?.outcome === 'document_incarnation_retired'
        ) {
          throw new Error('durable retirement append failed');
        }
        return durable.appendEvent(input);
      },
    };
    const queued = queuedOperation();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:03Z',
    });
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      'a'.repeat(64),
      documentAuthority,
    )!;
    coordinator.complete(
      recoverySignal(delivery, 'operation_outcome_indeterminate', '2026-08-24T10:00:04Z'),
      'a'.repeat(64),
      documentAuthority,
      () => undefined,
    );
    const challenge = coordinator.issueRecoveryChallenge(
      queued.requestId,
      'b'.repeat(64),
      documentAuthority,
      {
        reportId: queued.expectedState.reportId,
        sequence: queued.expectedState.sequence,
        authorizedStartCheckpointId: randomUUID(),
      },
    );

    expect(() =>
      coordinator.acknowledgeRecovery(
        documentIncarnationRetiredAck(challenge),
        'b'.repeat(64),
        documentAuthority,
        () => undefined,
      ),
    ).toThrow(/durable retirement append failed/);
    expect(coordinator.get(queued.requestId)?.status).toBe('recovery_required');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
  });

  it('moves a delivered operation to recovery when session establishment changes document', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);
    coordinator.poll('blender', queued.target.instanceId, 'a'.repeat(64), documentAuthority);

    expect(
      coordinator.reconcileDocumentAuthority('blender', queued.target.instanceId, 'd'.repeat(64)),
    ).toEqual([
      expect.objectContaining({
        status: 'recovery_required',
        recoveryEvidence: expect.objectContaining({
          source: 'document_authority_drift',
          reason: 'document_authority_changed_after_delivery',
          automaticReplay: false,
          retainsTargetLock: true,
        }),
      }),
    ]);
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(
      coordinator.pollRecovery('blender', queued.target.instanceId, 'b'.repeat(64), 'd'.repeat(64)),
    ).toBeNull();
  });

  it('moves a delivered operation to recovery when the Companion session changes in place', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    coordinator.queue(queued, 'a'.repeat(64), documentAuthority);
    coordinator.poll(
      'blender',
      queued.target.instanceId,
      'a'.repeat(64),
      documentAuthority,
      sessionA,
    );

    // A mere lease rotation within the same Companion process does not make
    // the delivered operation indeterminate.
    expect(
      coordinator.poll(
        'blender',
        queued.target.instanceId,
        'b'.repeat(64),
        documentAuthority,
        sessionA,
      ),
    ).toBeNull();
    expect(coordinator.get(queued.requestId)?.status).toBe('dispatched');

    expect(
      coordinator.reconcileDocumentAuthority(
        'blender',
        queued.target.instanceId,
        documentAuthority,
        sessionB,
      ),
    ).toEqual([
      expect.objectContaining({
        status: 'recovery_required',
        recoveryEvidence: expect.objectContaining({
          source: 'session_authority_drift',
          reason: 'companion_session_changed_after_delivery',
          priorStatus: 'dispatched',
          automaticReplay: false,
          retainsTargetLock: true,
        }),
      }),
    ]);
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
  });

  it('enforces target and external history locks', () => {
    const database = createEventDatabase();
    const queued = queuedOperation();
    const fingerprint = 'd'.repeat(64);
    const external = createBlenderLeafOperationExecutionCoordinator({
      database,
      externalHistoryLockOwner: () => 'shortcut-proof',
    });
    expect(() => external.queue(queued, fingerprint, documentAuthority)).toThrow(
      /owns the target instance/,
    );

    const coordinator = createBlenderLeafOperationExecutionCoordinator({ database });
    coordinator.queue(queued, fingerprint, documentAuthority);
    const second = withQueuedTarget(queuedOperation(), queued.target);
    expect(() => coordinator.queue(second, fingerprint, documentAuthority)).toThrow(
      /still owns the target instance/,
    );
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(coordinator.listTargetLockOwners()).toEqual([
      {
        targetKey: `blender:${queued.target.instanceId}`,
        adapterId: 'blender',
        instanceId: queued.target.instanceId,
        requestId: queued.requestId,
        status: 'queued',
      },
    ]);
  });

  it('rejects request conflicts, wrong documents, and failed validation without persisting', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const queued = queuedOperation();
    const fingerprint = 'e'.repeat(64);
    coordinator.queue(queued, fingerprint, documentAuthority);
    expect(() =>
      coordinator.findForCreate({
        formatVersion: '1.0.0',
        requestId: queued.requestId,
        replayId: randomUUID(),
        expectedState: queued.expectedState,
      }),
    ).toThrow(/different leaf operation request/);
    const delivery = coordinator.poll(
      'blender',
      queued.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const result = succeededResult(queued, delivery);
    result.progress.latestObservation.details.runId = result.progress.runId;
    expect(() =>
      coordinator.complete(result, 'f'.repeat(64), '0'.repeat(64), () => undefined),
    ).toThrow(/Companion document/);
    expect(() =>
      coordinator.complete(result, fingerprint, documentAuthority, () => {
        throw new Error('prefix chain mismatch');
      }),
    ).toThrow(/prefix chain mismatch/);
    expect(database.events).toHaveLength(2);
  });

  it('fails startup when durable successful progress has a missing prefix operation', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const first = queuedOperation();
    const fingerprint = '1'.repeat(64);
    coordinator.queue(first, fingerprint, documentAuthority);
    const firstDelivery = coordinator.poll(
      'blender',
      first.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const firstResult = succeededResult(first, firstDelivery);
    firstResult.progress.latestObservation.details.runId = firstResult.progress.runId;
    coordinator.complete(firstResult, fingerprint, documentAuthority, () => undefined);
    const second = continuingQueued(first, 2);
    coordinator.queue(second, fingerprint, documentAuthority);
    const secondDelivery = coordinator.poll(
      'blender',
      second.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const secondResult = succeededResult(second, secondDelivery);
    secondResult.progress.latestObservation.details.runId = secondResult.progress.runId;
    coordinator.complete(secondResult, fingerprint, documentAuthority, () => undefined);

    database.events.splice(
      0,
      database.events.length,
      ...database.events.filter((event) => storedExecution(event).requestId !== first.requestId),
    );
    expect(() => createBlenderLeafOperationExecutionCoordinator({ database })).toThrow(
      /unique contiguous successful prefix/,
    );
  });

  it('fails startup when durable progress changes run identity', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const first = queuedOperation();
    const fingerprint = '2'.repeat(64);
    coordinator.queue(first, fingerprint, documentAuthority);
    const firstDelivery = coordinator.poll(
      'blender',
      first.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const firstResult = succeededResult(first, firstDelivery);
    firstResult.progress.latestObservation.details.runId = firstResult.progress.runId;
    coordinator.complete(firstResult, fingerprint, documentAuthority, () => undefined);
    const second = continuingQueued(first, 2);
    coordinator.queue(second, fingerprint, documentAuthority);
    const secondDelivery = coordinator.poll(
      'blender',
      second.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const secondResult = succeededResult(second, secondDelivery);
    secondResult.progress.latestObservation.details.runId = secondResult.progress.runId;
    coordinator.complete(secondResult, fingerprint, documentAuthority, () => undefined);

    const completed = database.events.find(
      (event) =>
        event.eventType === 'blender.leaf-operation.completed' &&
        storedExecution(event).requestId === second.requestId,
    )!;
    const changedRunId = randomUUID();
    const changedExecution = storedExecution(completed);
    changedExecution.result!.progress!.runId = changedRunId;
    changedExecution.result!.progress!.latestObservation.details.runId = changedRunId;
    expect(() => createBlenderLeafOperationExecutionCoordinator({ database })).toThrow(
      /changed its durable leaf-run identity/,
    );
  });

  it('fails startup when durable progress breaks the Blender fingerprint chain', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderLeafOperationExecutionCoordinator({
      database,
      now: () => '2026-08-24T10:00:01Z',
    });
    const first = queuedOperation();
    const fingerprint = '3'.repeat(64);
    coordinator.queue(first, fingerprint, documentAuthority);
    const firstDelivery = coordinator.poll(
      'blender',
      first.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const firstResult = succeededResult(first, firstDelivery);
    firstResult.progress.latestObservation.details.runId = firstResult.progress.runId;
    coordinator.complete(firstResult, fingerprint, documentAuthority, () => undefined);
    const second = continuingQueued(first, 2);
    coordinator.queue(second, fingerprint, documentAuthority);
    const secondDelivery = coordinator.poll(
      'blender',
      second.target.instanceId,
      fingerprint,
      documentAuthority,
    )!;
    const secondResult = succeededResult(second, secondDelivery);
    secondResult.progress.latestObservation.details.runId = secondResult.progress.runId;
    coordinator.complete(secondResult, fingerprint, documentAuthority, () => undefined);

    const completed = database.events.find(
      (event) =>
        event.eventType === 'blender.leaf-operation.completed' &&
        storedExecution(event).requestId === second.requestId,
    )!;
    storedExecution(completed).result!.progress!.latestObservation.details.beforeFingerprintSha256 =
      'f'.repeat(64);
    expect(() => createBlenderLeafOperationExecutionCoordinator({ database })).toThrow(
      /broke its Blender fingerprint chain/,
    );
  });
});
