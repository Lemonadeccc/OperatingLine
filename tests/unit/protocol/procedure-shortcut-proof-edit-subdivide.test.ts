import {
  companionShortcutProofDeliverySchema,
  companionShortcutProofProgressSchema,
  computeProcedureShortcutProofAttestationContentSha256,
  computeProcedureShortcutProofBindingContentSha256,
  computeProcedureShortcutProofOperationReceiptContentSha256,
  computeProcedureShortcutProofStrongObservationContentSha256,
  meshEditSubdivideShortcutProofOperationIds,
  procedureShortcutProofAttestationSchema,
  procedureShortcutProofBindingSchema,
  procedureShortcutProofFailureCheckpointSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const h = (value: string) => value.repeat(64);
const ids = {
  binding: '11111111-1111-4111-8111-111111111111',
  proof: '22222222-2222-4222-8222-222222222222',
  request: '33333333-3333-4333-8333-333333333333',
  replay: '44444444-4444-4444-8444-444444444444',
  instance: '55555555-5555-4555-8555-555555555555',
  proposal: '66666666-6666-4666-8666-666666666666',
  execution: '77777777-7777-4777-8777-777777777777',
  report: '88888888-8888-4888-8888-888888888888',
  delivery: '99999999-9999-4999-8999-999999999999',
  attestation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  checkpoint: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  undoLock: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;

function bindingContent() {
  return {
    formatVersion: '1.0.0',
    bindingId: ids.binding,
    proposalRecordContentSha256: h('0'),
    proofId: ids.proof,
    requestId: ids.request,
    replayId: ids.replay,
    target: { adapterId: 'blender', instanceId: ids.instance },
    proposalId: ids.proposal,
    plan: { id: 'plan.edit-subdivide', revision: 1, contentSha256: h('1') },
    executionId: ids.execution,
    leafId: 'leaf.edit_subdivide',
    recipeId: 'blender.mesh.edit_subdivide.semantic',
    actionName: 'blender.mesh.edit_subdivide',
    acceptedAction: {
      adapterId: 'blender',
      name: 'blender.mesh.edit_subdivide',
      arguments: {
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.subdivided_mesh',
        resultMeshName: 'OperatingLine.Cube.Subdivided',
        cuts: 2,
        smooth: 0.25,
      },
    },
    targetProfile: 'factory_cube_single_user_mesh_8_12_6',
    acceptedDecision: {
      decisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      proposalId: ids.proposal,
      instanceId: ids.instance,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-23T09:59:59.000+08:00',
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      omittedAcceptedArguments: ['targetId', 'resultMeshId', 'resultMeshName'],
    },
    materialization: {
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.44.0',
      interactionCatalogContentSha256: h('2'),
      shortcutTrackContentSha256: h('3'),
    },
    executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds: meshEditSubdivideShortcutProofOperationIds,
    nativeUndoDepth: 4,
    nativeRedoDepth: 4,
    startState: { reportId: ids.report, sequence: 9 },
    createdAt: '2026-08-23T10:00:00.000+08:00',
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

const point = { x: 400, y: 300, role: 'viewport_center' } as const;
const event = (type: string, value: 'PRESS' | 'RELEASE' = 'PRESS') => ({
  type,
  value,
  ctrl: false,
  shift: false,
  point,
});

function receipts() {
  let previousReceiptContentSha256: string | null = null;
  return meshEditSubdivideShortcutProofOperationIds.map((operationId, index) => {
    const common = {
      receiptId: `${index + 1}0000000-0000-4000-8000-000000000000`,
      proofId: ids.proof,
      requestId: ids.request,
      deliveryId: ids.delivery,
      bindingContentSha256: binding().integrity.contentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: `2026-08-23T10:00:${String(index + 1).padStart(2, '0')}.000+08:00`,
    };
    const context = {
      windowId: 'window.main',
      areaType: 'VIEW_3D' as const,
      regionType: 'WINDOW' as const,
      mode: (index === 0 ? 'OBJECT' : 'EDIT_MESH') as 'OBJECT' | 'EDIT_MESH',
    };
    const stack = {
      operatorStackBeforeSha256: h('4'),
      operatorStackAfterSha256: h('5'),
    };
    let content: Record<string, unknown>;
    if (index === 5 || index === 6) {
      const numberCuts = index === 5;
      const role = numberCuts ? 'number_cuts_control' : 'smoothness_control';
      const enteredText = numberCuts ? '2' : '0.25';
      const eventType = (character: string) =>
        ({ '0': 'ZERO', '2': 'TWO', '5': 'FIVE', '.': 'PERIOD' })[character]!;
      content = {
        ...common,
        kind: 'operator_property_update',
        context,
        surfaceOperationId: meshEditSubdivideShortcutProofOperationIds[4],
        surfaceOperatorId: 'mesh.subdivide',
        controlId: numberCuts ? 'mesh.subdivide.number_cuts' : 'mesh.subdivide.smoothness',
        newValue: numberCuts ? 2 : 0.25,
        enteredText,
        activationEventEvidence: [
          {
            ...event('MOUSEMOVE', 'PRESS'),
            value: 'NOTHING',
            point: { x: 610, y: numberCuts ? 250 : 280, role },
          },
          ...[1, 2].flatMap(() => [
            {
              ...event('LEFTMOUSE'),
              point: { x: 610, y: numberCuts ? 250 : 280, role },
            },
            {
              ...event('LEFTMOUSE', 'RELEASE'),
              point: { x: 610, y: numberCuts ? 250 : 280, role },
            },
          ]),
        ],
        selectAllEventEvidence: [{ ...event('A'), ctrl: true }],
        textEventEvidence: [...enteredText].map((character) => ({
          ...event(eventType(character)),
          unicode: character,
        })),
        confirmEventEvidence: [event('RET'), event('RET', 'RELEASE')],
      };
    } else {
      const key = ['TAB', 'A', 'F3', 'RET', 'F9', '', '', 'RET', 'TAB'][index]!;
      content = {
        ...common,
        kind: 'key_input',
        context,
        eventEvidence: [event(key), event(key, 'RELEASE')],
        ...stack,
        ...(index === 0 ? { modeBefore: 'OBJECT', modeAfter: 'EDIT_MESH' } : {}),
        ...(index === 1 ? { allVisibleMeshElementsSelected: true } : {}),
        ...(index === 2
          ? {
              query: 'subdivide',
              selectedOperatorId: 'mesh.subdivide',
              queryEventEvidence: [...'subdivide'].map((character) => ({
                ...event(character.toUpperCase()),
                unicode: character,
              })),
            }
          : {}),
        ...(index === 3 ? { executedOperatorId: 'mesh.subdivide' } : {}),
        ...(index === 4
          ? {
              sourceOperationId: meshEditSubdivideShortcutProofOperationIds[3],
              sourceOperatorId: 'mesh.subdivide',
            }
          : {}),
        ...(index === 7
          ? { surfaceOperationId: meshEditSubdivideShortcutProofOperationIds[4] }
          : {}),
        ...(index === 8 ? { modeBefore: 'EDIT_MESH', modeAfter: 'OBJECT' } : {}),
      };
    }
    const receipt = {
      ...content,
      contentSha256: computeProcedureShortcutProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
}

function attestation() {
  const operationReceipts = receipts();
  const observationContent = {
    kind: 'mesh_edit_subdivide_shortcut_ready',
    satisfied: true,
    observationId: ids.report,
    observedAt: '2026-08-23T10:00:10.000+08:00',
    targetId: 'tutorial.cube',
    objectName: 'Cube',
    objectPointer: 1001,
    meshName: 'Cube',
    meshPointer: 2001,
    meshUsers: 1,
    meshDatablockCount: 1,
    sameObjectIdentity: true,
    sameMeshIdentity: true,
    managedReplacementMeshCreated: false,
    modifierCount: 0,
    shapeKeyCount: 0,
    activeObjectMode: 'OBJECT',
    selectedObjectCount: 1,
    operatorId: 'MESH_OT_subdivide',
    cuts: 2,
    smooth: 0.25,
    topology: { vertices: 56, edges: 108, polygons: 54 },
    topologySha256: h('6'),
    geometrySha256: h('7'),
    sceneFingerprintSha256: h('8'),
  } as const;
  const observation = {
    ...observationContent,
    contentSha256: computeProcedureShortcutProofStrongObservationContentSha256(observationContent),
  };
  const content = {
    formatVersion: '1.0.0',
    attestationId: ids.attestation,
    deliveryId: ids.delivery,
    binding: binding(),
    bindingContentSha256: binding().integrity.contentSha256,
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    managedReplacementMeshCreated: false,
    nativeMutationKind: 'in_place_edit_mesh_subdivide',
    executor: {
      executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
      executionBoundary: 'blender_window_event_simulate',
      transport: 'event_simulate',
      osHidInput: false,
    },
    operationReceipts,
    strongObservation: observation,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_shortcut_proof_native_undo_checkpoint',
      checkpointId: ids.checkpoint,
      proofId: ids.proof,
      replayId: ids.replay,
      previousCheckpointId: null,
      operation: 'shortcut_proof',
      undoLockId: ids.undoLock,
      targetId: 'tutorial.cube',
      executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
      marker: { key: '_operating_line_shortcut_proof_history_v2', matched: true },
      journal: {
        entryPresent: true,
        baselineSnapshotPresent: true,
        finalSnapshotPresent: true,
        undoRedoRoundTripVerified: true,
        mutationLeaseHeld: true,
      },
      baselineState: {
        targetId: 'tutorial.cube',
        objectName: 'Cube',
        objectPointer: 1001,
        meshPointer: 2001,
        meshUsers: 1,
        meshDatablockCount: 1,
        modifierCount: 0,
        shapeKeyCount: 0,
        activeObjectMode: 'OBJECT',
        selectedObjectCount: 1,
        topologySha256: h('9'),
        geometrySha256: h('a'),
      },
      finalState: {
        targetId: 'tutorial.cube',
        objectName: 'Cube',
        objectPointer: 1001,
        meshPointer: 2001,
        meshUsers: 1,
        meshDatablockCount: 1,
        modifierCount: 0,
        shapeKeyCount: 0,
        activeObjectMode: 'OBJECT',
        selectedObjectCount: 1,
        cuts: 2,
        smooth: 0.25,
        topologySha256: h('6'),
        geometrySha256: h('7'),
      },
      baselineSceneFingerprintSha256: h('b'),
      finalSceneFingerprintSha256: h('8'),
      receiptChainRootSha256: operationReceipts[0]!.contentSha256,
      receiptChainHeadSha256: operationReceipts.at(-1)!.contentSha256,
      strongObservationContentSha256: observation.contentSha256,
      committedAt: '2026-08-23T10:00:11.000+08:00',
    },
    attestedAt: '2026-08-23T10:00:12.000+08:00',
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofAttestationContentSha256(content),
    },
  } as const;
}

function delivery() {
  return {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    proofId: ids.proof,
    deliveryId: ids.delivery,
    target: { adapterId: 'blender', instanceId: ids.instance },
    targetProfile: 'factory_cube_single_user_mesh_8_12_6',
    proposalId: ids.proposal,
    plan: binding().plan,
    executionId: ids.execution,
    leafId: 'leaf.edit_subdivide',
    interactionCatalogVersion: '1.44.0',
    interactionCatalogContentSha256: h('2'),
    shortcutTrackContentSha256: h('3'),
    bindingContentSha256: binding().integrity.contentSha256,
    binding: binding(),
    executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds: meshEditSubdivideShortcutProofOperationIds,
    nativeUndoDepth: 4,
    nativeRedoDepth: 4,
    expectedState: { reportId: ids.report, sequence: 9 },
    requestedAt: '2026-08-23T10:00:00.000+08:00',
    dispatchedAt: '2026-08-23T10:00:01.000+08:00',
  } as const;
}

function failureCheckpoint() {
  const receipt = receipts()[0]!;
  return {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_shortcut_proof_failure_checkpoint',
    checkpointId: ids.checkpoint,
    previousCheckpointId: null,
    operation: 'shortcut_proof_failure',
    undoLockId: ids.undoLock,
    proofId: ids.proof,
    replayId: ids.replay,
    targetId: 'tutorial.cube',
    executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
    nativeMutationKind: 'in_place_edit_mesh_subdivide',
    nativeUndoDepth: 4,
    nativeRedoDepth: 4,
    marker: { key: '_operating_line_shortcut_proof_history_v2', matched: true },
    journal: {
      entryPresent: true,
      baselineSnapshotPresent: true,
      currentSnapshotPresent: true,
      mutationLeaseHeld: true,
    },
    baselineState: {
      targetId: 'tutorial.cube',
      sceneFingerprintSha256: h('b'),
      objectName: 'Cube',
      objectPointer: 1001,
      meshPointer: 2001,
      meshUsers: 1,
      meshDatablockCount: 1,
      modifierCount: 0,
      shapeKeyCount: 0,
      topologySha256: h('9'),
      geometrySha256: h('a'),
    },
    currentState: {
      targetId: 'tutorial.cube',
      sceneFingerprintSha256: h('8'),
      objectName: 'Cube',
      objectPointer: 1001,
      meshPointer: 2001,
      meshUsers: 1,
      meshDatablockCount: 1,
      modifierCount: 0,
      shapeKeyCount: 0,
      topologySha256: h('6'),
      geometrySha256: h('7'),
    },
    receiptPrefixRootSha256: receipt.contentSha256,
    receiptPrefixHeadSha256: receipt.contentSha256,
    lastCompletedOperationId: receipt.operationId,
    committedAt: '2026-08-23T10:00:05.000+08:00',
  } as const;
}

describe('Edit Subdivide shortcut proof protocol', () => {
  it('binds and attests the exact native in-place nine-operation proof', () => {
    expect(procedureShortcutProofBindingSchema.parse(binding())).toEqual(binding());
    expect(procedureShortcutProofAttestationSchema.parse(attestation())).toEqual(attestation());
  });

  it('rejects cross-profile combinations and drives companion prefixes from the binding', () => {
    expect(companionShortcutProofDeliverySchema.parse(delivery())).toEqual(delivery());
    expect(
      companionShortcutProofDeliverySchema.safeParse({
        ...delivery(),
        targetProfile: 'factory_cube_8_12_6',
      }).success,
    ).toBe(false);
    expect(
      companionShortcutProofProgressSchema.safeParse({
        ...delivery(),
        status: 'in_progress',
        completedOperationIds: meshEditSubdivideShortcutProofOperationIds.slice(0, 5),
        receiptChainHeadSha256: h('c'),
        occurredAt: '2026-08-23T10:00:06.000+08:00',
      }).success,
    ).toBe(true);
    expect(
      companionShortcutProofProgressSchema.safeParse({
        ...delivery(),
        status: 'in_progress',
        completedOperationIds: [meshEditSubdivideShortcutProofOperationIds[1]],
        receiptChainHeadSha256: h('c'),
        occurredAt: '2026-08-23T10:00:06.000+08:00',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-tutorial.cube target binding after its integrity is recomputed', () => {
    const content = {
      ...bindingContent(),
      acceptedAction: {
        ...bindingContent().acceptedAction,
        arguments: {
          ...bindingContent().acceptedAction.arguments,
          targetId: 'tutorial.other',
        },
      },
    } as const;
    const tampered = {
      ...content,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: computeProcedureShortcutProofBindingContentSha256(content),
      },
    } as const;

    expect(procedureShortcutProofBindingSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects success checkpoint mesh count drift after attestation integrity is recomputed', () => {
    const original = attestation();
    const { integrity: _integrity, ...originalContent } = original;
    void _integrity;
    const content = {
      ...originalContent,
      nativeUndoCheckpoint: {
        ...originalContent.nativeUndoCheckpoint,
        baselineState: {
          ...originalContent.nativeUndoCheckpoint.baselineState,
          meshDatablockCount: 2,
        },
      },
    } as const;
    const tampered = {
      ...content,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: computeProcedureShortcutProofAttestationContentSha256(content),
      },
    } as const;

    expect(procedureShortcutProofAttestationSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects failure checkpoint object pointer drift', () => {
    const checkpoint = failureCheckpoint();
    expect(procedureShortcutProofFailureCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);

    expect(
      procedureShortcutProofFailureCheckpointSchema.safeParse({
        ...checkpoint,
        currentState: { ...checkpoint.currentState, objectPointer: 1002 },
      }).success,
    ).toBe(false);
  });
});
