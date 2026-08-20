import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionShortcutProofCreateRequestSchema,
  companionShortcutProofDeliverySchema,
  companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery,
  companionShortcutProofHistoryTransitionReconciliationAckSchema,
  companionShortcutProofPollDeliverySchema,
  companionShortcutProofPollRequestSchema,
  companionShortcutProofProgressSchema,
  companionShortcutProofProgressAckSchema,
  companionShortcutProofRecoveryAckMatchesDelivery,
  companionShortcutProofRecoveryAckResponseSchema,
  companionShortcutProofRecoveryAckSchema,
  companionShortcutProofRecoveryDeliverySchema,
  companionShortcutProofRecoveryRequestSchema,
  companionShortcutProofResultSchema,
  companionShortcutProofResultAckSchema,
  companionShortcutProofStatusRequestSchema,
  companionShortcutProofStatusSchema,
  companionShortcutProofTerminalReconciliationAckMatchesDelivery,
  companionShortcutProofTerminalReconciliationAckSchema,
  companionShortcutProofTerminalReconciliationDeliverySchema,
  computeCompanionShortcutProofResultContentSha256,
  computeCompanionShortcutProofTerminalMarkerContentSha256,
  computeProcedureShortcutProofBindingContentSha256,
  computeProcedureShortcutProofNativeObservationContentSha256,
  computeProcedureShortcutProofOperationReceiptContentSha256,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  replayId: '22222222-2222-4222-8222-222222222222',
  reportId: '33333333-3333-4333-8333-333333333333',
  instanceId: '44444444-4444-4444-8444-444444444444',
  proofId: '55555555-5555-4555-8555-555555555555',
  deliveryId: '66666666-6666-4666-8666-666666666666',
} as const;

const expectedState = { reportId: ids.reportId, sequence: 4 } as const;
const operationIds = [
  'shortcut.add_subdivision_surface_level_one',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_viewport_level',
  'shortcut.close_adjust_last_operation',
] as const;

function binding() {
  const content = {
    formatVersion: '1.0.0',
    bindingId: '99999999-9999-4999-8999-999999999999',
    proposalRecordContentSha256: '0'.repeat(64),
    proofId: ids.proofId,
    requestId: ids.requestId,
    replayId: ids.replayId,
    target: { adapterId: 'blender', instanceId: ids.instanceId },
    proposalId: '77777777-7777-4777-8777-777777777777',
    plan: { id: 'plan.subdivision', revision: 2, contentSha256: '1'.repeat(64) },
    executionId: '88888888-8888-4888-8888-888888888888',
    leafId: 'leaf.subdivision',
    recipeId: 'blender.modifier.add_subdivision_surface.semantic',
    actionName: 'blender.modifier.add_subdivision_surface',
    acceptedAction: {
      adapterId: 'blender',
      name: 'blender.modifier.add_subdivision_surface',
      arguments: {
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.subdivision_surface',
        modifierName: 'OperatingLine.Cube.SubdivisionSurface',
        viewportLevel: 2,
      },
    },
    targetProfile: 'factory_cube_8_12_6',
    acceptedDecision: {
      decisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      proposalId: '77777777-7777-4777-8777-777777777777',
      instanceId: ids.instanceId,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-20T09:59:59.000+08:00',
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['modifierId', 'modifierName'],
    },
    materialization: {
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.39.0',
      interactionCatalogContentSha256: '2'.repeat(64),
      shortcutTrackContentSha256: '3'.repeat(64),
    },
    executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    startState: expectedState,
    createdAt: '2026-08-20T10:00:00.000+08:00',
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofBindingContentSha256(content),
    },
  } as const;
}

function delivery() {
  const authority = binding();
  return {
    formatVersion: '1.0.0',
    requestId: ids.requestId,
    replayId: ids.replayId,
    proofId: ids.proofId,
    deliveryId: ids.deliveryId,
    target: { adapterId: 'blender', instanceId: ids.instanceId },
    targetProfile: 'factory_cube_8_12_6',
    proposalId: '77777777-7777-4777-8777-777777777777',
    plan: { id: 'plan.subdivision', revision: 2, contentSha256: '1'.repeat(64) },
    executionId: '88888888-8888-4888-8888-888888888888',
    leafId: 'leaf.subdivision',
    interactionCatalogVersion: '1.39.0',
    interactionCatalogContentSha256: '2'.repeat(64),
    shortcutTrackContentSha256: '3'.repeat(64),
    bindingContentSha256: authority.integrity.contentSha256,
    binding: authority,
    executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    expectedState,
    requestedAt: '2026-08-20T10:00:00.000+08:00',
    dispatchedAt: '2026-08-20T10:00:01.000+08:00',
  } as const;
}

function receiptPrefix() {
  let previousReceiptContentSha256: string | null = null;
  const point = { x: 400, y: 300, role: 'viewport_center' } as const;
  const levelPoint = { x: 610, y: 250, role: 'level_control' } as const;
  const event = (
    type: string,
    value: string,
    ctrl: boolean,
    eventPoint: typeof point | typeof levelPoint,
    unicode?: string,
  ) => ({
    type,
    value,
    ctrl,
    shift: false,
    point: eventPoint,
    ...(unicode === undefined ? {} : { unicode }),
  });
  const contents = [
    {
      receiptId: '10000000-0000-4000-8000-000000000000',
      proofId: ids.proofId,
      requestId: ids.requestId,
      deliveryId: ids.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId: operationIds[0],
      order: 1,
      previousReceiptContentSha256,
      outcome: 'succeeded',
      occurredAt: '2026-08-20T10:00:02.000+08:00',
      kind: 'key_input',
      context: {
        windowId: 'window.main',
        areaType: 'VIEW_3D',
        regionType: 'WINDOW',
        mode: 'OBJECT',
      },
      eventEvidence: [event('ONE', 'PRESS', true, point), event('ONE', 'RELEASE', true, point)],
      operatorStackBeforeSha256: '4'.repeat(64),
      operatorStackAfterSha256: '5'.repeat(64),
    },
    {
      receiptId: '20000000-0000-4000-8000-000000000000',
      proofId: ids.proofId,
      requestId: ids.requestId,
      deliveryId: ids.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId: operationIds[1],
      order: 2,
      previousReceiptContentSha256: '',
      outcome: 'succeeded',
      occurredAt: '2026-08-20T10:00:03.000+08:00',
      kind: 'key_input',
      context: {
        windowId: 'window.main',
        areaType: 'VIEW_3D',
        regionType: 'WINDOW',
        mode: 'OBJECT',
      },
      eventEvidence: [event('F9', 'PRESS', false, point), event('F9', 'RELEASE', false, point)],
      operatorStackBeforeSha256: '5'.repeat(64),
      operatorStackAfterSha256: '6'.repeat(64),
      sourceOperationId: operationIds[0],
      sourceOperatorId: 'object.subdivision_set',
    },
    {
      receiptId: '30000000-0000-4000-8000-000000000000',
      proofId: ids.proofId,
      requestId: ids.requestId,
      deliveryId: ids.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId: operationIds[2],
      order: 3,
      previousReceiptContentSha256: '',
      outcome: 'succeeded',
      occurredAt: '2026-08-20T10:00:04.000+08:00',
      kind: 'operator_property_update',
      surfaceOperationId: operationIds[1],
      surfaceOperatorId: 'object.subdivision_set',
      controlId: 'object.subdivision_set.level',
      oldValue: 1,
      newValue: 2,
      eventEvidence: [
        event('MOUSEMOVE', 'NOTHING', false, levelPoint),
        event('LEFTMOUSE', 'PRESS', false, levelPoint),
        event('LEFTMOUSE', 'RELEASE', false, levelPoint),
        event('LEFTMOUSE', 'PRESS', false, levelPoint),
        event('LEFTMOUSE', 'RELEASE', false, levelPoint),
        event('A', 'PRESS', true, point),
        event('TWO', 'PRESS', false, point, '2'),
        event('RET', 'PRESS', false, point),
        event('RET', 'RELEASE', false, point),
      ],
    },
    {
      receiptId: '40000000-0000-4000-8000-000000000000',
      proofId: ids.proofId,
      requestId: ids.requestId,
      deliveryId: ids.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId: operationIds[3],
      order: 4,
      previousReceiptContentSha256: '',
      outcome: 'succeeded',
      occurredAt: '2026-08-20T10:00:04.500+08:00',
      kind: 'key_input',
      context: {
        windowId: 'window.main',
        areaType: 'VIEW_3D',
        regionType: 'WINDOW',
        mode: 'OBJECT',
      },
      eventEvidence: [event('RET', 'PRESS', false, point), event('RET', 'RELEASE', false, point)],
      operatorStackBeforeSha256: '6'.repeat(64),
      operatorStackAfterSha256: '7'.repeat(64),
      surfaceOperationId: operationIds[1],
    },
  ] as const;
  return contents.map((raw) => {
    const content = { ...raw, previousReceiptContentSha256 };
    const receipt = {
      ...content,
      contentSha256: computeProcedureShortcutProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function failedCheckpointResult(prefixLength: 0 | 1 | 2 | 3 | 4) {
  const prefix = receiptPrefix().slice(0, prefixLength);
  const last = prefix.at(-1);
  const baseline = '8'.repeat(64);
  const current = '9'.repeat(64);
  return {
    ...delivery(),
    status: 'failed_checkpointed',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'failed_checkpointed',
      checkpoint: {
        formatVersion: '1.0.0',
        evidenceClass: 'companion_reported_shortcut_proof_failure_checkpoint',
        checkpointId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        previousCheckpointId: null,
        operation: 'shortcut_proof_failure',
        undoLockId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        proofId: ids.proofId,
        replayId: ids.replayId,
        targetId: 'tutorial.cube',
        marker: { key: '_operating_line_shortcut_proof_history_v1', matched: true },
        journal: {
          entryPresent: true,
          baselineSnapshotPresent: true,
          currentSnapshotPresent: true,
          mutationLeaseHeld: true,
        },
        baselineState: {
          targetId: 'tutorial.cube',
          sceneFingerprintSha256: baseline,
          modifierCount: 0,
        },
        currentState: {
          targetId: 'tutorial.cube',
          sceneFingerprintSha256: current,
          modifierCount: prefixLength === 0 ? 0 : 1,
        },
        receiptPrefixRootSha256: prefix[0]?.contentSha256 ?? null,
        receiptPrefixHeadSha256: last?.contentSha256 ?? null,
        lastCompletedOperationId: last?.operationId ?? null,
        committedAt: '2026-08-20T10:00:05.000+08:00',
      },
      receiptPrefix: prefix,
      lastCompletedOperationId: last?.operationId ?? null,
      baselineSceneFingerprintSha256: baseline,
      currentSceneFingerprintSha256: current,
      mutationStarted: true,
    },
    error: 'shortcut proof failed after mutation started',
    occurredAt: '2026-08-20T10:00:06.000+08:00',
  } as const;
}

function nativeUndoObservation(sceneFingerprintSha256: string) {
  const content = {
    satisfied: true,
    restorationObservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sceneFingerprintSha256,
  } as const;
  return {
    ...content,
    contentSha256: computeProcedureShortcutProofNativeObservationContentSha256(content),
  } as const;
}

function nativeRedoObservation(sceneFingerprintSha256: string) {
  const content = {
    satisfied: true,
    redoObservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    sceneFingerprintSha256,
  } as const;
  return {
    ...content,
    contentSha256: computeProcedureShortcutProofNativeObservationContentSha256(content),
  } as const;
}

function recoveryDelivery() {
  return {
    ...delivery(),
    kind: 'native_history_rebind',
    recoveryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    history: {
      checkpointId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      undoLockId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      checkpointKind: 'success',
      baselineSceneFingerprintSha256: '8'.repeat(64),
      lockedSceneFingerprintSha256: '9'.repeat(64),
      terminalResultContentSha256: 'b'.repeat(64),
    },
    expectedStatus: 'succeeded',
    expectedResultContentSha256: 'c'.repeat(64),
    expectedMarkerContentSha256: 'a'.repeat(64),
    recoveryRequestedAt: '2026-08-20T10:00:02.000+08:00',
  } as const;
}

function recoveryAck() {
  const recovery = recoveryDelivery();
  return {
    kind: 'native_history_rebind',
    formatVersion: recovery.formatVersion,
    requestId: recovery.requestId,
    replayId: recovery.replayId,
    proofId: recovery.proofId,
    deliveryId: recovery.deliveryId,
    target: recovery.target,
    bindingContentSha256: recovery.bindingContentSha256,
    recoveryId: recovery.recoveryId,
    history: recovery.history,
    status: recovery.expectedStatus,
    expectedMarkerContentSha256: recovery.expectedMarkerContentSha256,
    currentSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
    mutationLocked: true,
    occurredAt: '2026-08-20T10:00:03.000+08:00',
  } as const;
}

function terminalReconciliationDelivery() {
  return {
    ...delivery(),
    kind: 'native_terminal_reconcile',
    recoveryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    acknowledgedProgressReceiptChainHeads: [],
    recoveryRequestedAt: '2026-08-20T10:00:07.000+08:00',
  } as const;
}

describe('companion shortcut proof protocol', () => {
  it('keeps public create and status lookup strict and opaque', async () => {
    const create = {
      formatVersion: '1.0.0',
      requestId: ids.requestId,
      replayId: ids.replayId,
      expectedState,
    } as const;
    expect(companionShortcutProofCreateRequestSchema.parse(create)).toEqual(create);
    for (const key of ['rawKeys', 'coordinates', 'operatorId', 'python', 'parameters']) {
      expect(
        companionShortcutProofCreateRequestSchema.safeParse({ ...create, [key]: 'forbidden' })
          .success,
      ).toBe(false);
    }
    const publicCreate = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1/companion-shortcut-proof-create-request.schema.json'),
        'utf8',
      ),
    ) as object;
    await validatePublicJsonSchemaCases(publicCreate, [
      { value: create, accepted: true },
      { value: { ...create, rawKeys: ['CTRL', '1'] }, accepted: false },
      { value: { ...create, parameters: { viewportLevel: 2 } }, accepted: false },
      { value: { ...create, python: 'bpy.ops.object.subdivision_set()' }, accepted: false },
    ]);
    expect(companionShortcutProofStatusRequestSchema.parse({ requestId: ids.requestId })).toEqual({
      requestId: ids.requestId,
    });
  });

  it('generates standalone strict public JSON schemas that compile for public validation', async () => {
    for (const filename of [
      'companion-shortcut-proof-create-request.schema.json',
      'companion-shortcut-proof-delivery.schema.json',
      'companion-shortcut-proof-progress.schema.json',
      'companion-shortcut-proof-result.schema.json',
      'companion-shortcut-proof-status-request.schema.json',
      'companion-shortcut-proof-status.schema.json',
      'companion-shortcut-proof-poll-request.schema.json',
      'companion-shortcut-proof-poll-delivery.schema.json',
      'companion-shortcut-proof-progress-ack.schema.json',
      'companion-shortcut-proof-result-ack.schema.json',
      'companion-shortcut-proof-terminal-reconciliation-delivery.schema.json',
      'companion-shortcut-proof-terminal-reconciliation-ack.schema.json',
      'companion-shortcut-proof-recovery-request.schema.json',
      'procedure-shortcut-proof-proposal-request.schema.json',
      'procedure-shortcut-proof-proposal-record.schema.json',
      'procedure-shortcut-proof-proposal-result.schema.json',
      'procedure-shortcut-proof-binding.schema.json',
      'procedure-shortcut-proof-attestation.schema.json',
      'procedure-shortcut-proof-failure-checkpoint.schema.json',
    ]) {
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      if (filename !== 'companion-shortcut-proof-recovery-request.schema.json') {
        expect(schema['additionalProperties']).toBe(false);
      }
      await validatePublicJsonSchemaCases(schema, [{ value: {}, accepted: false }]);
    }
  });

  it('delivers only the catalog-fixed executor and four operations', () => {
    expect(companionShortcutProofDeliverySchema.parse(delivery())).toEqual(delivery());
    for (const invalid of [
      { ...delivery(), executorId: 'other' },
      { ...delivery(), operationIds: operationIds.slice(0, 3) },
      { ...delivery(), osHidInput: true },
    ]) {
      expect(companionShortcutProofDeliverySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('provides strict poll and acknowledgement wrappers for the HTTP transport', () => {
    const poll = { adapterId: 'blender', instanceId: ids.instanceId } as const;
    expect(companionShortcutProofPollRequestSchema.parse(poll)).toEqual(poll);
    expect(companionShortcutProofPollDeliverySchema.parse({ request: delivery() })).toEqual({
      request: delivery(),
    });
    expect(companionShortcutProofPollDeliverySchema.parse({ request: recoveryDelivery() })).toEqual(
      { request: recoveryDelivery() },
    );
    expect(companionShortcutProofPollDeliverySchema.parse({ request: null })).toEqual({
      request: null,
    });
    for (const schema of [
      companionShortcutProofProgressAckSchema,
      companionShortcutProofResultAckSchema,
      companionShortcutProofRecoveryAckResponseSchema,
    ]) {
      expect(schema.parse({ result: 'accepted' })).toEqual({ result: 'accepted' });
      expect(schema.parse({ result: 'duplicate' })).toEqual({ result: 'duplicate' });
      expect(schema.safeParse({ result: 'ignored' }).success).toBe(false);
    }
    expect(
      companionShortcutProofPollRequestSchema.safeParse({ ...poll, extra: true }).success,
    ).toBe(false);
    expect(
      companionShortcutProofPollDeliverySchema.safeParse({ request: null, extra: true }).success,
    ).toBe(false);
  });

  it('strictly rebinds native history to the immutable delivery and locked fingerprint', () => {
    const recovery = recoveryDelivery();
    const ack = recoveryAck();
    expect(companionShortcutProofRecoveryDeliverySchema.parse(recovery)).toEqual(recovery);
    expect(companionShortcutProofRecoveryAckSchema.parse(ack)).toEqual(ack);
    expect(companionShortcutProofRecoveryAckMatchesDelivery(ack, recovery)).toBe(true);
    expect(
      companionShortcutProofRecoveryDeliverySchema.safeParse({
        ...recovery,
        proofId: ids.replayId,
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofRecoveryAckSchema.safeParse({
        ...ack,
        currentSceneFingerprintSha256: ack.history.baselineSceneFingerprintSha256,
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofRecoveryAckMatchesDelivery(
        { ...ack, history: { ...ack.history, checkpointKind: 'failure' } },
        recovery,
      ),
    ).toBe(false);
    expect(
      companionShortcutProofRecoveryAckMatchesDelivery(
        { ...ack, expectedMarkerContentSha256: 'b'.repeat(64) },
        recovery,
      ),
    ).toBe(false);
    expect(
      companionShortcutProofRecoveryAckMatchesDelivery({ ...ack, proofId: ids.replayId }, recovery),
    ).toBe(false);
    const restoredAck = {
      ...ack,
      status: 'restored',
      currentSceneFingerprintSha256: ack.history.baselineSceneFingerprintSha256,
      mutationLocked: false,
    } as const;
    expect(companionShortcutProofRecoveryAckSchema.safeParse(restoredAck).success).toBe(true);
    expect(
      companionShortcutProofRecoveryAckSchema.safeParse({
        ...restoredAck,
        mutationLocked: true,
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofRecoveryAckMatchesDelivery(restoredAck, {
        ...recovery,
        expectedStatus: 'restored',
      }),
    ).toBe(true);
  });

  it('strictly binds and caps durable native history transition reconciliation', () => {
    const recovery = recoveryDelivery();
    const transitionResult = (index: number) => {
      const restored = index % 2 === 0;
      const occurredAt = new Date(Date.parse('2026-08-20T10:01:00Z') + index * 1_000).toISOString();
      return {
        ...delivery(),
        status: restored ? ('restored' as const) : ('reapplied_locked' as const),
        managedActionResult: 'not_executed' as const,
        managedIdentityVerified: false as const,
        requiresUndoToUnlock: !restored,
        terminalEvidence: restored
          ? {
              kind: 'restored' as const,
              sourceCheckpointId: recovery.history.checkpointId,
              undoLockId: recovery.history.undoLockId,
              baselineSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
              lockedSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
              currentSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
              nativeUndoObservation: nativeUndoObservation(
                recovery.history.baselineSceneFingerprintSha256,
              ),
              restoredAt: occurredAt,
            }
          : {
              kind: 'reapplied_locked' as const,
              sourceCheckpointId: recovery.history.checkpointId,
              undoLockId: recovery.history.undoLockId,
              baselineSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
              lockedSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
              currentSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
              nativeRedoObservation: nativeRedoObservation(
                recovery.history.lockedSceneFingerprintSha256,
              ),
              reappliedAt: occurredAt,
            },
        error: null,
        occurredAt,
      } as const;
    };
    const results = Array.from({ length: 32 }, (_, index) => transitionResult(index));
    const ack = {
      kind: 'native_history_transition_reconcile',
      recoveryId: recovery.recoveryId,
      results,
      expectedResultContentSha256: recovery.expectedResultContentSha256,
      expectedMarkerContentSha256: recovery.expectedMarkerContentSha256,
      currentSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
      occurredAt: '2026-08-20T10:02:00Z',
    } as const;
    expect(companionShortcutProofHistoryTransitionReconciliationAckSchema.parse(ack)).toEqual(ack);
    expect(companionShortcutProofRecoveryRequestSchema.parse(ack)).toEqual(ack);
    expect(
      companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery(ack, recovery),
    ).toBe(true);
    expect(
      companionShortcutProofHistoryTransitionReconciliationAckSchema.safeParse({
        ...ack,
        results: [...results, transitionResult(32)],
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofHistoryTransitionReconciliationAckSchema.safeParse({
        ...ack,
        results: [results[0], results[2]],
        currentSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
      }).success,
    ).toBe(false);
    const tampered = {
      ...ack,
      results: [
        {
          ...results[0]!,
          terminalEvidence: {
            ...results[0]!.terminalEvidence,
            sourceCheckpointId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
        },
      ],
      currentSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
    };
    expect(
      companionShortcutProofHistoryTransitionReconciliationAckMatchesDelivery(
        companionShortcutProofHistoryTransitionReconciliationAckSchema.parse(tampered),
        recovery,
      ),
    ).toBe(false);
  });

  it('binds terminal reconciliation to the full locked result and immutable old delivery', () => {
    const recovery = terminalReconciliationDelivery();
    const result = failedCheckpointResult(1);
    const ack = {
      kind: 'native_terminal_reconcile',
      recoveryId: recovery.recoveryId,
      result,
      expectedMarkerContentSha256: computeCompanionShortcutProofTerminalMarkerContentSha256(result),
      currentSceneFingerprintSha256: result.terminalEvidence.currentSceneFingerprintSha256,
      occurredAt: '2026-08-20T10:00:08.000+08:00',
    } as const;
    expect(companionShortcutProofTerminalReconciliationDeliverySchema.parse(recovery)).toEqual(
      recovery,
    );
    expect(companionShortcutProofTerminalReconciliationAckSchema.parse(ack)).toEqual(ack);
    expect(companionShortcutProofTerminalReconciliationAckMatchesDelivery(ack, recovery)).toBe(
      true,
    );
    expect(computeCompanionShortcutProofResultContentSha256(result)).toMatch(/^[a-f0-9]{64}$/);
    expect(
      companionShortcutProofTerminalReconciliationAckSchema.safeParse({
        ...ack,
        expectedMarkerContentSha256: 'f'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofTerminalReconciliationAckSchema.safeParse({
        ...ack,
        currentSceneFingerprintSha256: 'f'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofTerminalReconciliationAckMatchesDelivery(
        { ...ack, recoveryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
        recovery,
      ),
    ).toBe(false);
    expect(
      companionShortcutProofTerminalReconciliationDeliverySchema.safeParse({
        ...recovery,
        acknowledgedProgressReceiptChainHeads: ['a'.repeat(64), 'a'.repeat(64)],
      }).success,
    ).toBe(false);
  });

  it('requires progress to be an exact operation prefix', () => {
    const progress = {
      ...delivery(),
      status: 'in_progress',
      completedOperationIds: operationIds.slice(0, 2),
      receiptChainHeadSha256: 'b'.repeat(64),
      occurredAt: '2026-08-20T10:00:03.000+08:00',
    } as const;
    expect(companionShortcutProofProgressSchema.safeParse(progress).success).toBe(true);
    expect(
      companionShortcutProofProgressSchema.safeParse({
        ...progress,
        completedOperationIds: [operationIds[1]],
      }).success,
    ).toBe(false);
  });

  it('releases an undispatched stale lease without inventing delivery evidence', () => {
    const dispatched = delivery();
    const queued = {
      ...dispatched,
      deliveryId: undefined,
      dispatchedAt: undefined,
      status: 'queued',
      updatedAt: dispatched.requestedAt,
    } as const;
    const recoveryRequired = {
      ...queued,
      status: 'recovery_required',
      updatedAt: '2026-08-20T10:00:01.000+08:00',
    } as const;

    expect(companionShortcutProofStatusSchema.safeParse(queued).success).toBe(true);
    expect(companionShortcutProofStatusSchema.safeParse(recoveryRequired).success).toBe(true);
    expect(
      companionShortcutProofStatusSchema.safeParse({
        ...recoveryRequired,
        deliveryId: ids.deliveryId,
      }).success,
    ).toBe(false);
  });

  it('requires explicit non-managed result claims and consistent terminal status', () => {
    const rejected = {
      ...delivery(),
      status: 'rejected',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: { kind: 'rejected_before_mutation', mutationStarted: false },
      error: 'proof rejected',
      occurredAt: '2026-08-20T10:00:04.000+08:00',
    } as const;
    expect(companionShortcutProofResultSchema.safeParse(rejected).success).toBe(true);
    const failedRestored = {
      ...rejected,
      status: 'failed_restored',
      terminalEvidence: {
        kind: 'failed_restored',
        receiptPrefix: [],
        lastCompletedOperationId: null,
        baselineSceneFingerprintSha256: '4'.repeat(64),
        currentSceneFingerprintSha256: '4'.repeat(64),
        nativeUndoObservation: nativeUndoObservation('4'.repeat(64)),
        mutationStarted: true,
      },
      error: 'post-mutation verification failed after native Undo restored baseline',
    } as const;
    expect(companionShortcutProofResultSchema.safeParse(failedRestored).success).toBe(true);
    const restored = {
      ...rejected,
      status: 'restored',
      terminalEvidence: {
        kind: 'restored',
        sourceCheckpointId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        undoLockId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        baselineSceneFingerprintSha256: '4'.repeat(64),
        lockedSceneFingerprintSha256: '6'.repeat(64),
        currentSceneFingerprintSha256: '4'.repeat(64),
        nativeUndoObservation: nativeUndoObservation('4'.repeat(64)),
        restoredAt: '2026-08-20T10:00:05.000+08:00',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:06.000+08:00',
    } as const;
    expect(companionShortcutProofResultSchema.safeParse(restored).success).toBe(true);
    const reapplied = {
      ...rejected,
      status: 'reapplied_locked',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'reapplied_locked',
        sourceCheckpointId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        undoLockId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        baselineSceneFingerprintSha256: '4'.repeat(64),
        lockedSceneFingerprintSha256: '6'.repeat(64),
        currentSceneFingerprintSha256: '6'.repeat(64),
        nativeRedoObservation: nativeRedoObservation('6'.repeat(64)),
        reappliedAt: '2026-08-20T10:00:05.000+08:00',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:06.000+08:00',
    } as const;
    expect(companionShortcutProofResultSchema.safeParse(reapplied).success).toBe(true);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...failedRestored,
        terminalEvidence: {
          ...failedRestored.terminalEvidence,
          nativeUndoObservation: {
            ...failedRestored.terminalEvidence.nativeUndoObservation,
            sceneFingerprintSha256: '5'.repeat(64),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...restored,
        terminalEvidence: {
          ...restored.terminalEvidence,
          nativeUndoObservation: {
            ...restored.terminalEvidence.nativeUndoObservation,
            contentSha256: '7'.repeat(64),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...reapplied,
        terminalEvidence: {
          ...reapplied.terminalEvidence,
          nativeRedoObservation: {
            ...reapplied.terminalEvidence.nativeRedoObservation,
            contentSha256: '7'.repeat(64),
          },
        },
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...rejected, managedActionResult: 'failed' },
      { ...rejected, managedIdentityVerified: true },
      { ...rejected, error: null },
      { ...rejected, rawKeys: ['CTRL', '1'] },
    ]) {
      expect(companionShortcutProofResultSchema.safeParse(invalid).success).toBe(false);
    }
    const terminal = {
      ...delivery(),
      status: 'rejected',
      progress: undefined,
      result: rejected,
      updatedAt: rejected.occurredAt,
    } as const;
    expect(companionShortcutProofStatusSchema.safeParse(terminal).success).toBe(true);
    expect(
      companionShortcutProofStatusSchema.safeParse({
        ...terminal,
        result: { ...rejected, requestId: ids.replayId },
      }).success,
    ).toBe(false);
  });

  it('accepts failure checkpoints with empty and canonical one-to-four operation prefixes', () => {
    for (const length of [0, 1, 2, 3, 4] as const) {
      expect(
        companionShortcutProofResultSchema.safeParse(failedCheckpointResult(length)).success,
      ).toBe(true);
    }
    const invalid = failedCheckpointResult(3);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...invalid,
        terminalEvidence: {
          ...invalid.terminalEvidence,
          receiptPrefix: invalid.terminalEvidence.receiptPrefix.map((receipt, index) =>
            index === 1 ? { ...receipt, previousReceiptContentSha256: 'f'.repeat(64) } : receipt,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...invalid,
        terminalEvidence: {
          ...invalid.terminalEvidence,
          receiptPrefix: invalid.terminalEvidence.receiptPrefix.map((receipt, index) =>
            index === 1 ? { ...receipt, proofId: ids.replayId } : receipt,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...invalid,
        terminalEvidence: {
          ...invalid.terminalEvidence,
          receiptPrefix: invalid.terminalEvidence.receiptPrefix.map((receipt, index) =>
            index === 1 ? { ...receipt, deliveryId: ids.replayId } : receipt,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofResultSchema.safeParse({
        ...invalid,
        terminalEvidence: {
          ...invalid.terminalEvidence,
          checkpoint: {
            ...invalid.terminalEvidence.checkpoint,
            committedAt: '2026-08-20T10:00:03.000+08:00',
          },
        },
      }).success,
    ).toBe(false);
  });
});
