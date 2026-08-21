import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionMenuControlProofCreateRequestSchema,
  companionMenuControlProofDeliverySchema,
  companionMenuControlProofPollDeliverySchema,
  companionMenuControlProofPollRequestSchema,
  companionMenuControlProofProgressSchema,
  companionMenuControlProofResultSchema,
  companionMenuControlProofStatusSchema,
  computeCompanionMenuControlProofFailureCheckpointContentSha256,
  computeCompanionMenuControlProofOperationReceiptContentSha256,
  computeCompanionMenuControlProofResultContentSha256,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  replay: '22222222-2222-4222-8222-222222222222',
  proof: '33333333-3333-4333-8333-333333333333',
  delivery: '44444444-4444-4444-8444-444444444444',
  instance: '55555555-5555-4555-8555-555555555555',
  proposal: '66666666-6666-4666-8666-666666666666',
  execution: '77777777-7777-4777-8777-777777777777',
  report: '88888888-8888-4888-8888-888888888888',
  binding: '99999999-9999-4999-8999-999999999999',
  decision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lease: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  document: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;
const hash = (digit: string) => digit.repeat(64);
const operationIds = [
  'workspace.layout',
  'menu.add',
  'menu.mesh',
  'operator.uv_sphere',
  'control.location',
  'control.scale',
  'control.object_name',
] as const;
const mutationStages = [
  'uv_sphere_created',
  'location_x_set',
  'location_y_set',
  'location_z_set',
  'scale_x_set',
  'scale_y_set',
  'scale_z_set',
  'object_name_set',
] as const;

function binding() {
  const content = {
    formatVersion: '1.0.0',
    bindingId: ids.binding,
    proposalRecordContentSha256: hash('0'),
    proofId: ids.proof,
    requestId: ids.request,
    replayId: ids.replay,
    target: { adapterId: 'blender', instanceId: ids.instance },
    proposalId: ids.proposal,
    packetContentSha256: hash('1'),
    inputTreeContentSha256: hash('2'),
    outputTreeContentSha256: hash('3'),
    materializationContentSha256: hash('4'),
    proposalContentSha256: hash('5'),
    plan: { id: 'plan.uv-sphere', revision: 1, contentSha256: hash('6') },
    executionId: ids.execution,
    leafId: 'leaf.uv-sphere',
    recipeId: 'blender.mesh.create_uv_sphere.native',
    actionName: 'blender.mesh.create_uv_sphere',
    acceptedAction: {
      adapterId: 'blender',
      name: 'blender.mesh.create_uv_sphere',
      arguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    },
    targetProfile: 'factory_layout_three_object_ui_scale_2',
    acceptedDecision: {
      decisionId: ids.decision,
      proposalId: ids.proposal,
      instanceId: ids.instance,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-22T10:00:00+08:00',
    },
    startState: {
      reportId: ids.report,
      sequence: 7,
      adapterId: 'blender',
      instanceId: ids.instance,
      plan: { id: 'plan.uv-sphere', revision: 1 },
      planContentSha256: hash('6'),
      executionId: ids.execution,
      phase: 'running',
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      stepId: null,
      observationCount: 0,
      nativeUndoCheckpoint: {
        formatVersion: '1.0.0',
        evidenceClass: 'companion_reported_native_undo_checkpoint',
        checkpointId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        previousCheckpointId: null,
        operation: 'start',
        committedAt: '2026-08-22T10:00:01+08:00',
        marker: { key: '_operating_line_native_history_v1', matched: true },
        journal: {
          entryPresent: true,
          snapshotMatchesSession: true,
          artifactsBackedUp: true,
        },
        session: {
          plan: { id: 'plan.uv-sphere', revision: 1 },
          planContentSha256: hash('6'),
          executionId: ids.execution,
          activeStepId: null,
          completedStepIds: [],
          receiptStepIds: [],
        },
      },
      occurredAt: '2026-08-22T10:00:01+08:00',
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['resourceId'],
    },
    materialization: {
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.39.0',
      interactionCatalogContentSha256: hash('7'),
      packetContentSha256: hash('1'),
      inputTreeContentSha256: hash('2'),
      outputTreeContentSha256: hash('3'),
      materializationContentSha256: hash('4'),
      menuTrackContentSha256: hash('8'),
    },
    executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    nativeUndoDepth: 8,
    createdAt: '2026-08-22T10:00:02+08:00',
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofBindingContentSha256(content),
    },
  } as const;
}

function delivery() {
  const accepted = binding();
  return {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    proofId: ids.proof,
    deliveryId: ids.delivery,
    target: accepted.target,
    targetProfile: accepted.targetProfile,
    proposalId: accepted.proposalId,
    proposalRecordContentSha256: accepted.proposalRecordContentSha256,
    proposalContentSha256: accepted.proposalContentSha256,
    plan: accepted.plan,
    executionId: accepted.executionId,
    leafId: accepted.leafId,
    packetContentSha256: accepted.packetContentSha256,
    inputTreeContentSha256: accepted.inputTreeContentSha256,
    outputTreeContentSha256: accepted.outputTreeContentSha256,
    materializationContentSha256: accepted.materializationContentSha256,
    interactionCatalogVersion: accepted.materialization.interactionCatalogVersion,
    interactionCatalogContentSha256: accepted.materialization.interactionCatalogContentSha256,
    menuTrackContentSha256: accepted.materialization.menuTrackContentSha256,
    bindingContentSha256: accepted.integrity.contentSha256,
    binding: accepted,
    executorId: accepted.executorId,
    executionBoundary: accepted.executionBoundary,
    authorization: accepted.authorization,
    transport: accepted.transport,
    operationIds,
    nativeUndoDepth: 8,
    expectedState: { reportId: ids.report, sequence: 7 },
    startCheckpoint: accepted.startState,
    lease: {
      leaseId: ids.lease,
      sessionId: ids.session,
      target: accepted.target,
      documentIncarnationId: ids.document,
      expiresAt: '2026-08-22T10:05:00+08:00',
    },
    requestedAt: '2026-08-22T10:00:03+08:00',
    dispatchedAt: '2026-08-22T10:00:04+08:00',
  } as const;
}

function summaries() {
  return [
    { status: 'precondition_verified', path: ['Layout'] },
    { status: 'control_executed', path: ['Layout', 'Add'] },
    { status: 'control_executed', path: ['Layout', 'Add', 'Mesh'] },
    {
      status: 'control_executed',
      path: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
      radius: 1,
    },
    {
      status: 'control_executed',
      path: ['Sidebar', 'Item', 'Transform', 'Location'],
      value: [1.25, -2, 0.75],
    },
    {
      status: 'control_executed',
      path: ['Sidebar', 'Item', 'Transform', 'Scale'],
      value: [1.5, 1.5, 1.5],
    },
    {
      status: 'control_executed',
      path: ['Properties', 'Object', 'Name'],
      value: 'OperatingLine.TutorialEye',
    },
  ] as const;
}

function receipts() {
  let previousReceiptContentSha256: string | null = null;
  return operationIds.map((operationId, index) => {
    const content = {
      receiptId: `${index + 1}0000000-0000-4000-8000-000000000000`,
      proofId: ids.proof,
      requestId: ids.request,
      deliveryId: ids.delivery,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded',
      summary: summaries()[index]!,
      occurredAt: `2026-08-22T10:00:${10 + index}+08:00`,
    } as const;
    const receipt = {
      ...content,
      contentSha256: computeCompanionMenuControlProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function progress(count = 4) {
  const prefix = receipts().slice(0, count);
  const mutationCount = [0, 0, 0, 1, 4, 7, 8][count - 1]!;
  return {
    ...delivery(),
    status: 'in_progress',
    completedOperationIds: operationIds.slice(0, count),
    operationReceipts: prefix,
    receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
    nativeHistoryCursor: mutationCount,
    completedMutationStages: mutationStages.slice(0, mutationCount),
    occurredAt: '2026-08-22T10:01:00+08:00',
  } as const;
}

function strongObservation() {
  const content = {
    kind: 'uv_sphere_menu_controls_ready',
    satisfied: true,
    observationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    objectName: 'OperatingLine.TutorialEye',
    objectType: 'MESH',
    location: [1.25, -2, 0.75],
    scale: [1.5, 1.5, 1.5],
    meshTopology: { vertices: 482, edges: 992, polygons: 512 },
    meshSha256: hash('9'),
    sceneFingerprintSha256: hash('a'),
    observedAt: '2026-08-22T10:01:01+08:00',
  } as const;
  return { ...content, contentSha256: computeProtocolCanonicalJsonSha256(content) } as const;
}

function result() {
  const allReceipts = receipts();
  const observation = strongObservation();
  return {
    ...delivery(),
    status: 'succeeded',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'succeeded_locked',
      operationSummaries: allReceipts.map((receipt) => ({
        operationId: receipt.operationId,
        summaryContentSha256: computeProtocolCanonicalJsonSha256(receipt.summary),
      })),
      operationReceipts: allReceipts,
      strongObservation: observation,
      nativeUndoCheckpoint: {
        checkpointId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        undoLockId: '12345678-1234-4234-8234-123456789abc',
        nativeUndoDepth: 8,
        nativeHistoryCursor: 8,
        mutationStages,
        baselineSceneFingerprintSha256: hash('b'),
        finalSceneFingerprintSha256: observation.sceneFingerprintSha256,
        restoredSceneFingerprintSha256: hash('b'),
        reappliedSceneFingerprintSha256: observation.sceneFingerprintSha256,
        receiptChainRootSha256: allReceipts[0]!.contentSha256,
        receiptChainHeadSha256: allReceipts.at(-1)!.contentSha256,
        strongObservationContentSha256: observation.contentSha256,
        committedAt: '2026-08-22T10:01:02+08:00',
      },
    },
    error: null,
    occurredAt: '2026-08-22T10:01:03+08:00',
  } as const;
}

function queuedStatus() {
  const delivered = delivery();
  const base = Object.fromEntries(
    Object.entries(delivered).filter(
      ([key]) => !['deliveryId', 'lease', 'dispatchedAt'].includes(key),
    ),
  );
  return { ...base, status: 'queued', updatedAt: '2026-08-22T10:00:03+08:00' } as const;
}

describe('companion menu-control proof protocol', () => {
  it('keeps the caller request opaque and rejects native input injection', () => {
    const request = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      replayId: ids.replay,
      expectedState: { reportId: ids.report, sequence: 7 },
    } as const;
    expect(companionMenuControlProofCreateRequestSchema.parse(request)).toEqual(request);
    for (const key of ['events', 'coordinates', 'operatorId', 'action', 'arguments']) {
      expect(
        companionMenuControlProofCreateRequestSchema.safeParse({ ...request, [key]: [] }).success,
      ).toBe(false);
    }
  });

  it('seals the accepted binding, start checkpoint, lease target, and document session', () => {
    const value = delivery();
    expect(companionMenuControlProofDeliverySchema.parse(value)).toEqual(value);
    expect(companionMenuControlProofPollRequestSchema.parse(value.target)).toEqual(value.target);
    expect(companionMenuControlProofPollDeliverySchema.parse({ request: value })).toEqual({
      request: value,
    });
    const foreign = structuredClone(value);
    foreign.lease.target.instanceId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(companionMenuControlProofDeliverySchema.safeParse(foreign).success).toBe(false);
    const predatesBinding = structuredClone(value);
    predatesBinding.requestedAt = '2026-08-22T10:00:01+08:00';
    expect(companionMenuControlProofDeliverySchema.safeParse(predatesBinding).success).toBe(false);
  });

  it('requires an exact seven-operation hash chain while keeping history cursor independent', () => {
    expect(companionMenuControlProofProgressSchema.parse(progress())).toEqual(progress());
    expect(companionMenuControlProofProgressSchema.parse(progress(7)).nativeHistoryCursor).toBe(8);
    const reordered = structuredClone(progress());
    reordered.operationReceipts.reverse();
    expect(companionMenuControlProofProgressSchema.safeParse(reordered).success).toBe(false);
    const tampered = structuredClone(progress());
    tampered.operationReceipts[1]!.summary.path = ['Layout'] as ['Layout', 'Add'];
    expect(companionMenuControlProofProgressSchema.safeParse(tampered).success).toBe(false);
    const wrongCursor = structuredClone(progress());
    wrongCursor.nativeHistoryCursor = 2;
    expect(companionMenuControlProofProgressSchema.safeParse(wrongCursor).success).toBe(false);
    const predatesBinding = structuredClone(progress());
    predatesBinding.requestedAt = '2026-08-22T10:00:01+08:00';
    expect(companionMenuControlProofProgressSchema.safeParse(predatesBinding).success).toBe(false);
    const lateReceipt = structuredClone(progress());
    lateReceipt.operationReceipts.at(-1)!.occurredAt = '2026-08-22T10:02:00+08:00';
    lateReceipt.operationReceipts.at(-1)!.contentSha256 =
      computeCompanionMenuControlProofOperationReceiptContentSha256(
        lateReceipt.operationReceipts.at(-1)!,
      );
    expect(companionMenuControlProofProgressSchema.safeParse(lateReceipt).success).toBe(false);
    const earlyReceipt = structuredClone(progress(1));
    earlyReceipt.operationReceipts[0]!.occurredAt = '2026-08-22T10:00:03+08:00';
    earlyReceipt.operationReceipts[0]!.contentSha256 =
      computeCompanionMenuControlProofOperationReceiptContentSha256(
        earlyReceipt.operationReceipts[0]!,
      );
    earlyReceipt.receiptChainHeadSha256 = earlyReceipt.operationReceipts[0]!.contentSha256;
    expect(companionMenuControlProofProgressSchema.safeParse(earlyReceipt).success).toBe(false);
  });

  it('requires seven summaries and receipts plus strong observation and depth-eight checkpoint', () => {
    const value = result();
    expect(companionMenuControlProofResultSchema.parse(value)).toEqual(value);
    expect(computeCompanionMenuControlProofResultContentSha256(value)).toMatch(/^[a-f0-9]{64}$/);
    const wrongDepth = structuredClone(value);
    wrongDepth.terminalEvidence.nativeUndoCheckpoint.nativeHistoryCursor = 7 as 8;
    expect(companionMenuControlProofResultSchema.safeParse(wrongDepth).success).toBe(false);
    const tampered = structuredClone(value);
    tampered.terminalEvidence.strongObservation.meshSha256 = hash('f');
    expect(companionMenuControlProofResultSchema.safeParse(tampered).success).toBe(false);
    const lateCheckpoint = structuredClone(value);
    lateCheckpoint.terminalEvidence.nativeUndoCheckpoint.committedAt = '2026-08-22T10:02:00+08:00';
    expect(companionMenuControlProofResultSchema.safeParse(lateCheckpoint).success).toBe(false);
    const unchanged = structuredClone(value);
    unchanged.terminalEvidence.nativeUndoCheckpoint.baselineSceneFingerprintSha256 =
      unchanged.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256;
    unchanged.terminalEvidence.nativeUndoCheckpoint.restoredSceneFingerprintSha256 =
      unchanged.terminalEvidence.nativeUndoCheckpoint.finalSceneFingerprintSha256;
    expect(companionMenuControlProofResultSchema.safeParse(unchanged).success).toBe(false);
    const foreignLease = structuredClone(value);
    foreignLease.lease.target.instanceId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(companionMenuControlProofResultSchema.safeParse(foreignLease).success).toBe(false);
  });

  it('models no-mutation and recovery-required failures without automatic replay', () => {
    const noMutation = {
      ...delivery(),
      status: 'failed_no_mutation',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'failed_no_mutation',
        receiptPrefix: [],
        lastCompletedOperationId: null,
        internalHistoryCursor: 0,
        completedMutationStages: [],
        automaticReplay: false,
      },
      error: 'Menu not available.',
      occurredAt: '2026-08-22T10:01:00+08:00',
    } as const;
    expect(companionMenuControlProofResultSchema.parse(noMutation)).toEqual(noMutation);
    const recovery = {
      ...noMutation,
      status: 'recovery_required',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'recovery_required',
        receiptPrefix: receipts().slice(0, 3),
        lastCompletedOperationId: operationIds[2],
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('c'),
        automaticReplay: false,
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(recovery)).toEqual(recovery);
    expect(
      companionMenuControlProofResultSchema.safeParse({
        ...recovery,
        requiresUndoToUnlock: false,
      }).success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.parse({
        ...delivery(),
        status: 'recovery_required',
        result: recovery,
        updatedAt: '2026-08-22T10:01:01+08:00',
      }).result?.terminalEvidence.kind,
    ).toBe('recovery_required');
    const impossibleRecovery = structuredClone(recovery);
    impossibleRecovery.terminalEvidence.internalHistoryCursor = 2;
    impossibleRecovery.terminalEvidence.completedMutationStages = mutationStages.slice(0, 2);
    expect(companionMenuControlProofResultSchema.safeParse(impossibleRecovery).success).toBe(false);

    const prefix = receipts().slice(0, 4);
    const checkpointContent = {
      formatVersion: '1.0.0',
      checkpointId: '23456789-2345-4234-8234-23456789abcd',
      undoLockId: '3456789a-3456-4345-8345-3456789abcde',
      proofId: ids.proof,
      replayId: ids.replay,
      target: {
        adapterId: 'blender',
        instanceId: ids.instance,
        resourceId: 'proof.uv_sphere.eye',
      },
      internalHistoryCursor: 1,
      completedMutationStages: mutationStages.slice(0, 1),
      baselineSceneFingerprintSha256: hash('b'),
      currentSceneFingerprintSha256: hash('c'),
      receiptChainRootSha256: prefix[0]!.contentSha256,
      receiptChainHeadSha256: prefix.at(-1)!.contentSha256,
      committedAt: '2026-08-22T10:00:30+08:00',
    } as const;
    const checkpointed = {
      ...noMutation,
      status: 'failed_checkpointed',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'failed_checkpointed',
        receiptPrefix: prefix,
        lastCompletedOperationId: operationIds[3],
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('c'),
        automaticReplay: false,
        checkpoint: {
          ...checkpointContent,
          contentSha256:
            computeCompanionMenuControlProofFailureCheckpointContentSha256(checkpointContent),
        },
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(checkpointed)).toEqual(checkpointed);
    const forgedCheckpoint = structuredClone(checkpointed);
    forgedCheckpoint.terminalEvidence.checkpoint.currentSceneFingerprintSha256 = hash('d');
    expect(companionMenuControlProofResultSchema.safeParse(forgedCheckpoint).success).toBe(false);

    const restored = {
      ...noMutation,
      status: 'failed_restored',
      terminalEvidence: {
        kind: 'failed_restored',
        receiptPrefix: prefix,
        lastCompletedOperationId: operationIds[3],
        internalHistoryCursor: 0,
        completedMutationStages: mutationStages.slice(0, 1),
        baselineSceneFingerprintSha256: hash('b'),
        currentSceneFingerprintSha256: hash('b'),
        automaticReplay: false,
      },
    } as const;
    expect(companionMenuControlProofResultSchema.parse(restored)).toEqual(restored);
    const badCheckpoint = {
      ...recovery,
      status: 'failed_checkpointed',
      requiresUndoToUnlock: true,
      terminalEvidence: {
        ...recovery.terminalEvidence,
        kind: 'failed_checkpointed',
        internalHistoryCursor: 0,
        completedMutationStages: [],
      },
    } as const;
    expect(companionMenuControlProofResultSchema.safeParse(badCheckpoint).success).toBe(false);
    const badRestored = {
      ...recovery,
      status: 'failed_restored',
      terminalEvidence: {
        ...recovery.terminalEvidence,
        kind: 'failed_restored',
        internalHistoryCursor: 1,
        completedMutationStages: mutationStages.slice(0, 1),
        currentSceneFingerprintSha256: hash('b'),
      },
    } as const;
    expect(companionMenuControlProofResultSchema.safeParse(badRestored).success).toBe(false);
  });

  it('keeps queued status pre-delivery and mirrors every nested evidence identity', () => {
    const queued = queuedStatus();
    expect(companionMenuControlProofStatusSchema.parse(queued)).toEqual(queued);
    expect(
      companionMenuControlProofStatusSchema.safeParse({ ...queued, deliveryId: ids.delivery })
        .success,
    ).toBe(false);
    expect(
      companionMenuControlProofStatusSchema.safeParse({
        ...queued,
        requestedAt: '2026-08-22T10:00:01+08:00',
      }).success,
    ).toBe(false);
    const invalidDeliveredStatus = {
      ...delivery(),
      requestedAt: '2026-08-22T10:00:01+08:00',
      status: 'dispatched',
      updatedAt: '2026-08-22T10:00:04+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(invalidDeliveredStatus).success).toBe(
      false,
    );

    const nested = structuredClone(progress());
    nested.requestId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const status = {
      ...delivery(),
      status: 'in_progress',
      progress: nested,
      updatedAt: '2026-08-22T10:01:01+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(status).success).toBe(false);

    const terminalStatus = structuredClone({
      ...delivery(),
      status: 'succeeded' as const,
      result: result(),
      updatedAt: '2026-08-22T10:01:04+08:00',
    });
    terminalStatus.menuTrackContentSha256 = hash('f');
    terminalStatus.binding.materialization.menuTrackContentSha256 = hash('f');
    terminalStatus.binding.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(terminalStatus.binding);
    terminalStatus.bindingContentSha256 = terminalStatus.binding.integrity.contentSha256;
    const parsed = companionMenuControlProofStatusSchema.safeParse(terminalStatus);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === 'result')).toBe(true);
    }
    const stale = {
      ...delivery(),
      status: 'in_progress',
      progress: progress(),
      updatedAt: '2026-08-22T10:00:30+08:00',
    } as const;
    expect(companionMenuControlProofStatusSchema.safeParse(stale).success).toBe(false);

    const foreignLease = structuredClone({
      ...delivery(),
      status: 'in_progress' as const,
      progress: progress(),
      updatedAt: '2026-08-22T10:01:01+08:00',
    });
    foreignLease.progress.lease.expiresAt = '2026-08-22T10:06:00+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(foreignLease).success).toBe(false);
    const foreignRequestedAt = structuredClone({
      ...delivery(),
      status: 'in_progress' as const,
      progress: progress(),
      updatedAt: '2026-08-22T10:01:01+08:00',
    });
    foreignRequestedAt.progress.requestedAt = '2026-08-22T10:00:03.500+08:00';
    expect(companionMenuControlProofStatusSchema.safeParse(foreignRequestedAt).success).toBe(false);
  });

  it('publishes strict Draft-7 Fastify/Ajv-compatible public schemas', async () => {
    const cases = [
      [
        'companion-menu-control-proof-create-request.schema.json',
        {
          formatVersion: '1.0.0',
          requestId: ids.request,
          replayId: ids.replay,
          expectedState: { reportId: ids.report, sequence: 7 },
        },
      ],
      ['companion-menu-control-proof-delivery.schema.json', delivery()],
      ['companion-menu-control-proof-progress.schema.json', progress()],
      ['companion-menu-control-proof-result.schema.json', result()],
      ['companion-menu-control-proof-poll-request.schema.json', delivery().target],
      ['companion-menu-control-proof-poll-delivery.schema.json', { request: delivery() }],
      ['companion-menu-control-proof-status-request.schema.json', { requestId: ids.request }],
      ['companion-menu-control-proof-status.schema.json', queuedStatus()],
      ['companion-menu-control-proof-progress-ack.schema.json', { result: 'accepted' }],
      ['companion-menu-control-proof-result-ack.schema.json', { result: 'accepted' }],
    ] as const;
    for (const [filename, valid] of cases) {
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      expect(schema['additionalProperties']).toBe(false);
      if (
        [
          'companion-menu-control-proof-delivery.schema.json',
          'companion-menu-control-proof-progress.schema.json',
          'companion-menu-control-proof-result.schema.json',
          'companion-menu-control-proof-status.schema.json',
        ].includes(filename)
      ) {
        expect(schema['$comment']).toContain('semantic validation gate');
      }
      await validatePublicJsonSchemaCases(schema, [
        { value: valid, accepted: true },
        { value: { ...valid, forbidden: true }, accepted: false },
      ]);
    }
  });
});
