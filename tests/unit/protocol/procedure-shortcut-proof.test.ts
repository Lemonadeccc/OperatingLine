import {
  computeProcedureShortcutProofAttestationContentSha256,
  computeProcedureShortcutProofBindingContentSha256,
  computeProcedureShortcutProofOperationReceiptContentSha256,
  computeProcedureShortcutProofStrongObservationContentSha256,
  procedureShortcutProofAttestationSchema,
  procedureShortcutProofBindingSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const ids = {
  proofId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  replayId: '33333333-3333-4333-8333-333333333333',
  reportId: '44444444-4444-4444-8444-444444444444',
  instanceId: '55555555-5555-4555-8555-555555555555',
  bindingId: '66666666-6666-4666-8666-666666666666',
  attestationId: '77777777-7777-4777-8777-777777777777',
  checkpointId: '88888888-8888-4888-8888-888888888888',
  deliveryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

const operationIds = [
  'shortcut.add_subdivision_surface_level_one',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_viewport_level',
  'shortcut.close_adjust_last_operation',
] as const;

function bindingContent() {
  return {
    formatVersion: '1.0.0',
    bindingId: ids.bindingId,
    proposalRecordContentSha256: '0'.repeat(64),
    proofId: ids.proofId,
    requestId: ids.requestId,
    replayId: ids.replayId,
    target: { adapterId: 'blender', instanceId: ids.instanceId },
    proposalId: '99999999-9999-4999-8999-999999999999',
    plan: { id: 'plan.subdivision', revision: 2, contentSha256: '1'.repeat(64) },
    executionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
      decisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      proposalId: '99999999-9999-4999-8999-999999999999',
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
    startState: { reportId: ids.reportId, sequence: 7 },
    createdAt: '2026-08-20T10:00:00.000+08:00',
  } as const;
}

function binding() {
  const content = bindingContent();
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofBindingContentSha256(content),
    },
  } as const;
}

function receipts() {
  let previousReceiptContentSha256: string | null = null;
  return operationIds.map((operationId, index) => {
    const shared = {
      receiptId: `${index + 1}0000000-0000-4000-8000-000000000000`,
      proofId: ids.proofId,
      requestId: ids.requestId,
      deliveryId: ids.deliveryId,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: `2026-08-20T10:00:0${index + 1}.000+08:00`,
    };
    const content =
      index === 2
        ? {
            ...shared,
            kind: 'operator_property_update' as const,
            surfaceOperationId: operationIds[1],
            surfaceOperatorId: 'object.subdivision_set' as const,
            controlId: 'object.subdivision_set.level' as const,
            oldValue: 1,
            newValue: 2,
            eventEvidence: [
              {
                type: 'MOUSEMOVE',
                value: 'NOTHING',
                ctrl: false,
                shift: false,
                point: { x: 610, y: 250, role: 'level_control' },
              },
              {
                type: 'LEFTMOUSE',
                value: 'PRESS',
                ctrl: false,
                shift: false,
                point: { x: 610, y: 250, role: 'level_control' },
              },
              {
                type: 'LEFTMOUSE',
                value: 'RELEASE',
                ctrl: false,
                shift: false,
                point: { x: 610, y: 250, role: 'level_control' },
              },
              {
                type: 'LEFTMOUSE',
                value: 'PRESS',
                ctrl: false,
                shift: false,
                point: { x: 610, y: 250, role: 'level_control' },
              },
              {
                type: 'LEFTMOUSE',
                value: 'RELEASE',
                ctrl: false,
                shift: false,
                point: { x: 610, y: 250, role: 'level_control' },
              },
              {
                type: 'A',
                value: 'PRESS',
                ctrl: true,
                shift: false,
                point: { x: 400, y: 300, role: 'viewport_center' },
              },
              {
                type: 'TWO',
                value: 'PRESS',
                ctrl: false,
                shift: false,
                unicode: '2',
                point: { x: 400, y: 300, role: 'viewport_center' },
              },
              {
                type: 'RET',
                value: 'PRESS',
                ctrl: false,
                shift: false,
                point: { x: 400, y: 300, role: 'viewport_center' },
              },
              {
                type: 'RET',
                value: 'RELEASE',
                ctrl: false,
                shift: false,
                point: { x: 400, y: 300, role: 'viewport_center' },
              },
            ],
          }
        : {
            ...shared,
            kind: 'key_input' as const,
            context: {
              windowId: 'window.main',
              areaType: 'VIEW_3D' as const,
              regionType: 'WINDOW' as const,
              mode: 'OBJECT' as const,
            },
            eventEvidence:
              index === 0
                ? [
                    {
                      type: 'ONE',
                      value: 'PRESS',
                      ctrl: true,
                      shift: false,
                      point: { x: 400, y: 300, role: 'viewport_center' },
                    },
                    {
                      type: 'ONE',
                      value: 'RELEASE',
                      ctrl: true,
                      shift: false,
                      point: { x: 400, y: 300, role: 'viewport_center' },
                    },
                  ]
                : index === 1
                  ? [
                      {
                        type: 'F9',
                        value: 'PRESS',
                        ctrl: false,
                        shift: false,
                        point: { x: 400, y: 300, role: 'viewport_center' },
                      },
                      {
                        type: 'F9',
                        value: 'RELEASE',
                        ctrl: false,
                        shift: false,
                        point: { x: 400, y: 300, role: 'viewport_center' },
                      },
                    ]
                  : [
                      {
                        type: 'RET',
                        value: 'PRESS',
                        ctrl: false,
                        shift: false,
                        point: { x: 400, y: 300, role: 'viewport_center' },
                      },
                      {
                        type: 'RET',
                        value: 'RELEASE',
                        ctrl: false,
                        shift: false,
                        point: { x: 400, y: 300, role: 'viewport_center' },
                      },
                    ],
            operatorStackBeforeSha256: '4'.repeat(64),
            operatorStackAfterSha256: '5'.repeat(64),
            ...(index === 1
              ? {
                  sourceOperationId: operationIds[0],
                  sourceOperatorId: 'object.subdivision_set' as const,
                }
              : {}),
            ...(index === 3 ? { surfaceOperationId: operationIds[1] } : {}),
          };
    const receipt = {
      ...content,
      contentSha256: computeProcedureShortcutProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function attestationContent() {
  const operationReceipts = receipts();
  const strongObservationContent = {
    kind: 'subdivision_surface_shortcut_ready',
    satisfied: true,
    observationId: ids.reportId,
    observedAt: '2026-08-20T10:00:04.500+08:00',
    targetId: 'tutorial.cube',
    modifierType: 'SUBSURF',
    modifierCount: 1,
    viewportLevel: 2,
    subdivisionType: 'CATMULL_CLARK',
    renderLevels: 2,
    quality: 3,
    modifierStackMatches: true,
    evaluatedTopologyWithinBounds: true,
    sceneFingerprintSha256: '6'.repeat(64),
  } as const;
  const strongObservationContentSha256 =
    computeProcedureShortcutProofStrongObservationContentSha256(strongObservationContent);
  return {
    formatVersion: '1.0.0',
    attestationId: ids.attestationId,
    deliveryId: ids.deliveryId,
    binding: binding(),
    bindingContentSha256: binding().integrity.contentSha256,
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    executor: {
      executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
      executionBoundary: 'blender_window_event_simulate',
      transport: 'event_simulate',
      osHidInput: false,
    },
    operationReceipts,
    strongObservation: {
      ...strongObservationContent,
      contentSha256: strongObservationContentSha256,
    },
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_shortcut_proof_native_undo_checkpoint',
      checkpointId: ids.checkpointId,
      proofId: ids.proofId,
      replayId: ids.replayId,
      previousCheckpointId: null,
      operation: 'shortcut_proof',
      undoLockId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      targetId: 'tutorial.cube',
      marker: { key: '_operating_line_shortcut_proof_history_v1', matched: true },
      journal: {
        entryPresent: true,
        baselineSnapshotPresent: true,
        finalSnapshotPresent: true,
        undoRedoRoundTripVerified: true,
        mutationLeaseHeld: true,
      },
      baselineState: {
        targetId: 'tutorial.cube',
        modifierCount: 0,
        activeObjectMode: 'OBJECT',
        selectedObjectCount: 1,
      },
      finalState: {
        targetId: 'tutorial.cube',
        modifierType: 'SUBSURF',
        modifierCount: 1,
        viewportLevel: 2,
      },
      baselineSceneFingerprintSha256: '7'.repeat(64),
      finalSceneFingerprintSha256: '6'.repeat(64),
      receiptChainRootSha256: operationReceipts[0]!.contentSha256,
      receiptChainHeadSha256: operationReceipts.at(-1)!.contentSha256,
      strongObservationContentSha256,
      committedAt: '2026-08-20T10:00:05.000+08:00',
    },
    attestedAt: '2026-08-20T10:00:06.000+08:00',
  } as const;
}

function attestation() {
  const content = attestationContent();
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofAttestationContentSha256(content),
    },
  } as const;
}

describe('procedure shortcut proof protocol', () => {
  it('binds exactly the catalog-authorized Subdivision Surface F9 proof', () => {
    expect(procedureShortcutProofBindingSchema.parse(binding())).toEqual(binding());
    const wrongResourceContent = {
      ...bindingContent(),
      acceptedAction: {
        ...bindingContent().acceptedAction,
        arguments: {
          ...bindingContent().acceptedAction.arguments,
          modifierName: 'Subdivision',
        },
      },
    } as const;
    expect(
      procedureShortcutProofBindingSchema.safeParse({
        ...wrongResourceContent,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: computeProcedureShortcutProofBindingContentSha256(wrongResourceContent),
        },
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...binding(), actionName: 'blender.mesh.create_cube' },
      {
        ...binding(),
        materialization: { ...binding().materialization, interactionCatalogVersion: 'not-semver' },
      },
      { ...binding(), operationIds: operationIds.slice(0, 3) },
      { ...binding(), executorId: 'arbitrary.executor' },
      { ...binding(), python: 'bpy.ops.object.subdivision_set(level=2)' },
    ]) {
      expect(procedureShortcutProofBindingSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires a canonical receipt chain, strong observation, and independent shortcut Undo checkpoint', () => {
    const valid = attestation();
    expect(procedureShortcutProofAttestationSchema.parse(valid)).toEqual(valid);
    const { integrity: originalIntegrity, ...attestationContent } = valid;
    const checkpointBeforeFinalReceiptContent = {
      ...attestationContent,
      nativeUndoCheckpoint: {
        ...attestationContent.nativeUndoCheckpoint,
        committedAt: '2026-08-20T10:00:03.000+08:00',
      },
    };
    const checkpointBeforeFinalReceipt = {
      ...checkpointBeforeFinalReceiptContent,
      integrity: {
        ...originalIntegrity,
        contentSha256: computeProcedureShortcutProofAttestationContentSha256(
          checkpointBeforeFinalReceiptContent,
        ),
      },
    };
    const invalid = [
      { ...valid, managedActionResult: 'succeeded' },
      { ...valid, managedIdentityVerified: true },
      {
        ...valid,
        operationReceipts: valid.operationReceipts.map((receipt, index) =>
          index === 1 ? { ...receipt, previousReceiptContentSha256: 'f'.repeat(64) } : receipt,
        ),
      },
      {
        ...valid,
        operationReceipts: valid.operationReceipts.map((receipt, index) =>
          index === 1 ? { ...receipt, proofId: ids.replayId } : receipt,
        ),
      },
      { ...valid, deliveryId: ids.replayId },
      {
        ...valid,
        strongObservation: { ...valid.strongObservation, satisfied: false },
      },
      {
        ...valid,
        strongObservation: {
          ...valid.strongObservation,
          observedAt: '2026-08-20T10:00:03.000+08:00',
        },
      },
      {
        ...valid,
        nativeUndoCheckpoint: { ...valid.nativeUndoCheckpoint, operation: 'next' },
      },
      checkpointBeforeFinalReceipt,
      { ...valid, rawKeys: ['CTRL', '1'] },
    ];
    for (const candidate of invalid) {
      expect(procedureShortcutProofAttestationSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
