import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  computeProcedureShortcutProofAttestationContentSha256,
  computeProcedureShortcutProofBindingContentSha256,
  computeCompanionShortcutProofTerminalMarkerContentSha256,
  computeCompanionShortcutProofResultContentSha256,
  computeProcedureShortcutProofNativeObservationContentSha256,
  computeProcedureShortcutProofOperationReceiptContentSha256,
  computeProcedureShortcutProofStrongObservationContentSha256,
  meshEditSubdivideShortcutProofOperationIds,
  procedureShortcutProofBindingSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  BlenderShortcutProofExecutionError,
  createBlenderShortcutProofExecutionCoordinator,
} from '../../../services/orchestrator/src/blender-shortcut-proof-execution.js';

const operationIds = [
  'shortcut.add_subdivision_surface_level_one',
  'shortcut.open_adjust_last_operation',
  'shortcut.set_viewport_level',
  'shortcut.close_adjust_last_operation',
] as const;
const bindings = new Map<string, Record<string, unknown>>();
const dispatchNow = () => '2026-08-20T10:00:01Z';

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) {
        throw new Error(`duplicate event ${input.id}`);
      }
      const stored = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-20T10:00:00Z',
      };
      events.push(stored);
      return stored;
    },
    listExecutionEventsByTypes(eventTypes: readonly string[]): StoredExecutionEvent[] {
      return events.filter((event) => eventTypes.includes(event.eventType));
    },
  };
}

function queuedProof(overrides: Record<string, unknown> = {}) {
  const requestId = randomUUID();
  const replayId = randomUUID();
  const proofId = randomUUID();
  const requestedTarget = overrides.target as
    { adapterId: 'blender'; instanceId: string } | undefined;
  const instanceId = requestedTarget?.instanceId ?? randomUUID();
  const target = requestedTarget ?? { adapterId: 'blender' as const, instanceId };
  const reportId = randomUUID();
  const proposalId = randomUUID();
  const executionId = randomUUID();
  const plan = { id: `procedure-replay.${replayId}`, revision: 1, contentSha256: '2'.repeat(64) };
  const bindingContent = {
    formatVersion: '1.0.0',
    bindingId: randomUUID(),
    proofId,
    requestId,
    replayId,
    target,
    proposalId,
    plan,
    executionId,
    leafId: 'tutorial.modifier.subdivision',
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
      decisionId: randomUUID(),
      proposalId,
      instanceId,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-20T09:59:59Z',
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['modifierId', 'modifierName'],
    },
    proposalRecordContentSha256: '5'.repeat(64),
    materialization: {
      actionCatalogVersion: '1.19.0',
      interactionCatalogVersion: '1.39.0',
      interactionCatalogContentSha256: '3'.repeat(64),
      shortcutTrackContentSha256: '4'.repeat(64),
    },
    executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    startState: { reportId, sequence: 7 },
    createdAt: '2026-08-20T10:00:00Z',
  } as const;
  const binding = {
    ...bindingContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofBindingContentSha256(bindingContent),
    },
  } as const;
  bindings.set(requestId, binding);
  return {
    formatVersion: '1.0.0',
    requestId,
    replayId,
    proofId,
    target,
    targetProfile: 'factory_cube_8_12_6',
    proposalId,
    plan,
    executionId,
    leafId: 'tutorial.modifier.subdivision',
    interactionCatalogVersion: '1.39.0',
    interactionCatalogContentSha256: '3'.repeat(64),
    shortcutTrackContentSha256: '4'.repeat(64),
    bindingContentSha256: binding.integrity.contentSha256,
    binding,
    executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    expectedState: { reportId, sequence: 7 },
    requestedAt: '2026-08-20T10:00:00Z',
    status: 'queued',
    updatedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  } as const;
}

function queuedEditSubdivideProof() {
  const base = queuedProof();
  const bindingContent = {
    formatVersion: '1.0.0',
    bindingId: randomUUID(),
    proofId: base.proofId,
    requestId: base.requestId,
    replayId: base.replayId,
    target: base.target,
    proposalId: base.proposalId,
    plan: base.plan,
    executionId: base.executionId,
    leafId: 'tutorial.mesh.edit_subdivide',
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
    acceptedDecision: base.binding.acceptedDecision,
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      omittedAcceptedArguments: ['targetId', 'resultMeshId', 'resultMeshName'],
    },
    proposalRecordContentSha256: base.binding.proposalRecordContentSha256,
    materialization: {
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.44.0',
      interactionCatalogContentSha256: '6'.repeat(64),
      shortcutTrackContentSha256: '7'.repeat(64),
    },
    executorId: 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds: meshEditSubdivideShortcutProofOperationIds,
    nativeUndoDepth: 4,
    nativeRedoDepth: 4,
    startState: base.binding.startState,
    createdAt: base.binding.createdAt,
  } as const;
  const binding = {
    ...bindingContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofBindingContentSha256(bindingContent),
    },
  } as const;
  bindings.set(base.requestId, binding);
  return {
    ...base,
    targetProfile: binding.targetProfile,
    leafId: binding.leafId,
    interactionCatalogVersion: binding.materialization.interactionCatalogVersion,
    interactionCatalogContentSha256: binding.materialization.interactionCatalogContentSha256,
    shortcutTrackContentSha256: binding.materialization.shortcutTrackContentSha256,
    bindingContentSha256: binding.integrity.contentSha256,
    binding,
    executorId: binding.executorId,
    operationIds: meshEditSubdivideShortcutProofOperationIds,
    nativeUndoDepth: 4,
    nativeRedoDepth: 4,
  } as const;
}

function progressFor(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
  count: number,
) {
  return {
    ...delivery,
    status: 'in_progress',
    completedOperationIds: delivery.operationIds.slice(0, count),
    receiptChainHeadSha256: count.toString(16).repeat(64),
    occurredAt: `2026-08-20T10:00:${String(count + 1).padStart(2, '0')}Z`,
  } as const;
}

function successfulResult(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
) {
  const binding = procedureShortcutProofBindingSchema.parse(bindings.get(delivery.requestId));
  const point = (role: 'viewport_center' | 'level_control') => ({ x: 400, y: 300, role });
  const context = {
    windowId: 'window-1',
    areaType: 'VIEW_3D',
    regionType: 'WINDOW',
    mode: 'OBJECT',
  } as const;
  const event = (
    type: string,
    value: string,
    ctrl = false,
    role: 'viewport_center' | 'level_control' = 'viewport_center',
    unicode?: string,
  ) => ({
    type,
    value,
    ctrl,
    shift: false,
    point: point(role),
    ...(unicode === undefined ? {} : { unicode }),
  });
  let previousReceiptContentSha256: string | null = null;
  const operationReceipts = operationIds.map((operationId, index) => {
    const evidence =
      index === 0
        ? {
            kind: 'key_input',
            context,
            eventEvidence: [event('ONE', 'PRESS', true), event('ONE', 'RELEASE', true)],
            operatorStackBeforeSha256: '1'.repeat(64),
            operatorStackAfterSha256: '2'.repeat(64),
          }
        : index === 1
          ? {
              kind: 'key_input',
              context,
              eventEvidence: [event('F9', 'PRESS'), event('F9', 'RELEASE')],
              operatorStackBeforeSha256: '2'.repeat(64),
              operatorStackAfterSha256: '3'.repeat(64),
              sourceOperationId: operationIds[0],
              sourceOperatorId: 'object.subdivision_set',
            }
          : index === 2
            ? {
                kind: 'operator_property_update',
                surfaceOperationId: operationIds[1],
                surfaceOperatorId: 'object.subdivision_set',
                controlId: 'object.subdivision_set.level',
                oldValue: 1,
                newValue: 2,
                eventEvidence: [
                  event('MOUSEMOVE', 'NOTHING', false, 'level_control'),
                  event('LEFTMOUSE', 'PRESS', false, 'level_control'),
                  event('LEFTMOUSE', 'RELEASE', false, 'level_control'),
                  event('LEFTMOUSE', 'PRESS', false, 'level_control'),
                  event('LEFTMOUSE', 'RELEASE', false, 'level_control'),
                  event('A', 'PRESS', true),
                  event('TWO', 'PRESS', false, 'viewport_center', '2'),
                  event('RET', 'PRESS'),
                  event('RET', 'RELEASE'),
                ],
              }
            : {
                kind: 'key_input',
                context,
                eventEvidence: [event('RET', 'PRESS'), event('RET', 'RELEASE')],
                operatorStackBeforeSha256: '3'.repeat(64),
                operatorStackAfterSha256: '4'.repeat(64),
                surfaceOperationId: operationIds[1],
              };
    const content = {
      receiptId: randomUUID(),
      proofId: delivery.proofId,
      requestId: delivery.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: delivery.bindingContentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: `2026-08-20T10:00:0${index + 2}Z`,
      ...evidence,
    };
    const receipt = {
      ...content,
      contentSha256: computeProcedureShortcutProofOperationReceiptContentSha256(content),
    };
    previousReceiptContentSha256 = receipt.contentSha256;
    return receipt;
  });
  const strongObservationContent = {
    kind: 'subdivision_surface_shortcut_ready',
    satisfied: true,
    observationId: randomUUID(),
    observedAt: '2026-08-20T10:00:06Z',
    targetId: 'tutorial.cube',
    modifierType: 'SUBSURF',
    modifierCount: 1,
    viewportLevel: 2,
    subdivisionType: 'CATMULL_CLARK',
    renderLevels: 2,
    quality: 3,
    modifierStackMatches: true,
    evaluatedTopologyWithinBounds: true,
    sceneFingerprintSha256: 'e'.repeat(64),
  } as const;
  const strongObservation = {
    ...strongObservationContent,
    contentSha256:
      computeProcedureShortcutProofStrongObservationContentSha256(strongObservationContent),
  } as const;
  const attestationContent = {
    formatVersion: '1.0.0',
    attestationId: randomUUID(),
    deliveryId: delivery.deliveryId,
    binding,
    bindingContentSha256: delivery.bindingContentSha256,
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    executor: {
      executorId: delivery.executorId,
      executionBoundary: delivery.executionBoundary,
      transport: delivery.transport,
      osHidInput: false,
    },
    operationReceipts,
    strongObservation,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_shortcut_proof_native_undo_checkpoint',
      checkpointId: randomUUID(),
      proofId: delivery.proofId,
      replayId: delivery.replayId,
      previousCheckpointId: null,
      operation: 'shortcut_proof',
      undoLockId: randomUUID(),
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
      baselineSceneFingerprintSha256: 'd'.repeat(64),
      finalSceneFingerprintSha256: 'e'.repeat(64),
      receiptChainRootSha256: operationReceipts[0]!.contentSha256,
      receiptChainHeadSha256: operationReceipts.at(-1)!.contentSha256,
      strongObservationContentSha256: strongObservation.contentSha256,
      committedAt: '2026-08-20T10:00:07Z',
    },
    attestedAt: '2026-08-20T10:00:08Z',
  } as const;
  const attestation = {
    ...attestationContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofAttestationContentSha256(attestationContent),
    },
  } as const;
  return {
    ...delivery,
    status: 'succeeded',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    requiresUndoToUnlock: true,
    terminalEvidence: { kind: 'succeeded_locked', attestation },
    error: null,
    occurredAt: '2026-08-20T10:00:09Z',
  } as const;
}

function successfulEditSubdivideResult(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
) {
  const binding = procedureShortcutProofBindingSchema.parse(bindings.get(delivery.requestId));
  const point = (role: 'viewport_center' | 'number_cuts_control' | 'smoothness_control') => ({
    x: 400,
    y: 300,
    role,
  });
  const event = (
    type: string,
    value: 'PRESS' | 'RELEASE' | 'NOTHING' = 'PRESS',
    role: 'viewport_center' | 'number_cuts_control' | 'smoothness_control' = 'viewport_center',
    ctrl = false,
    unicode?: string,
  ) => ({
    type,
    value,
    ctrl,
    shift: false,
    point: point(role),
    ...(unicode === undefined ? {} : { unicode }),
  });
  let previousReceiptContentSha256: string | null = null;
  const operationReceipts = meshEditSubdivideShortcutProofOperationIds.map((operationId, index) => {
    const common = {
      receiptId: randomUUID(),
      proofId: delivery.proofId,
      requestId: delivery.requestId,
      deliveryId: delivery.deliveryId,
      bindingContentSha256: delivery.bindingContentSha256,
      operationId,
      order: index + 1,
      previousReceiptContentSha256,
      outcome: 'succeeded' as const,
      occurredAt: `2026-08-20T10:00:${String(index + 2).padStart(2, '0')}Z`,
    };
    const context = {
      windowId: 'window-1',
      areaType: 'VIEW_3D' as const,
      regionType: 'WINDOW' as const,
      mode: (index === 0 ? 'OBJECT' : 'EDIT_MESH') as 'OBJECT' | 'EDIT_MESH',
    };
    const stack = {
      operatorStackBeforeSha256: `${(index + 1).toString(16)}`.repeat(64),
      operatorStackAfterSha256: `${(index + 2).toString(16)}`.repeat(64),
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
          event('MOUSEMOVE', 'NOTHING', role),
          event('LEFTMOUSE', 'PRESS', role),
          event('LEFTMOUSE', 'RELEASE', role),
          event('LEFTMOUSE', 'PRESS', role),
          event('LEFTMOUSE', 'RELEASE', role),
        ],
        selectAllEventEvidence: [event('A', 'PRESS', 'viewport_center', true)],
        textEventEvidence: [...enteredText].map((character) =>
          event(eventType(character), 'PRESS', 'viewport_center', false, character),
        ),
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
              queryEventEvidence: [...'subdivide'].map((character) =>
                event(character.toUpperCase(), 'PRESS', 'viewport_center', false, character),
              ),
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
  const strongObservationContent = {
    kind: 'mesh_edit_subdivide_shortcut_ready',
    satisfied: true,
    observationId: randomUUID(),
    observedAt: '2026-08-20T10:00:12Z',
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
    topologySha256: '6'.repeat(64),
    geometrySha256: '7'.repeat(64),
    sceneFingerprintSha256: '8'.repeat(64),
  } as const;
  const strongObservation = {
    ...strongObservationContent,
    contentSha256:
      computeProcedureShortcutProofStrongObservationContentSha256(strongObservationContent),
  } as const;
  const attestationContent = {
    formatVersion: '1.0.0',
    attestationId: randomUUID(),
    deliveryId: delivery.deliveryId,
    binding,
    bindingContentSha256: delivery.bindingContentSha256,
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    managedReplacementMeshCreated: false,
    nativeMutationKind: 'in_place_edit_mesh_subdivide',
    executor: {
      executorId: delivery.executorId,
      executionBoundary: delivery.executionBoundary,
      transport: delivery.transport,
      osHidInput: false,
    },
    operationReceipts,
    strongObservation,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_shortcut_proof_native_undo_checkpoint',
      checkpointId: randomUUID(),
      proofId: delivery.proofId,
      replayId: delivery.replayId,
      previousCheckpointId: null,
      operation: 'shortcut_proof',
      undoLockId: randomUUID(),
      targetId: 'tutorial.cube',
      executorId: delivery.executorId,
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
        topologySha256: '9'.repeat(64),
        geometrySha256: 'a'.repeat(64),
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
        topologySha256: '6'.repeat(64),
        geometrySha256: '7'.repeat(64),
      },
      baselineSceneFingerprintSha256: 'b'.repeat(64),
      finalSceneFingerprintSha256: '8'.repeat(64),
      receiptChainRootSha256: operationReceipts[0]!.contentSha256,
      receiptChainHeadSha256: operationReceipts.at(-1)!.contentSha256,
      strongObservationContentSha256: strongObservation.contentSha256,
      committedAt: '2026-08-20T10:00:13Z',
    },
    attestedAt: '2026-08-20T10:00:14Z',
  } as const;
  const attestation = {
    ...attestationContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureShortcutProofAttestationContentSha256(attestationContent),
    },
  } as const;
  return {
    ...delivery,
    status: 'succeeded',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    managedReceiptCreated: false,
    managedReplacementMeshCreated: false,
    nativeMutationKind: 'in_place_edit_mesh_subdivide',
    requiresUndoToUnlock: true,
    terminalEvidence: { kind: 'succeeded_locked', attestation },
    error: null,
    occurredAt: '2026-08-20T10:00:15Z',
  } as const;
}

function failedResult(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
) {
  const success = successfulResult(delivery);
  const { attestation } = success.terminalEvidence;
  const receiptPrefix = [attestation.operationReceipts[0]!];
  const baselineSceneFingerprintSha256 = 'd'.repeat(64);
  const currentSceneFingerprintSha256 = 'c'.repeat(64);
  const checkpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_shortcut_proof_failure_checkpoint',
    checkpointId: randomUUID(),
    previousCheckpointId: null,
    operation: 'shortcut_proof_failure',
    undoLockId: randomUUID(),
    proofId: delivery.proofId,
    replayId: delivery.replayId,
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
      sceneFingerprintSha256: baselineSceneFingerprintSha256,
      modifierCount: 0,
    },
    currentState: {
      targetId: 'tutorial.cube',
      sceneFingerprintSha256: currentSceneFingerprintSha256,
      modifierCount: 1,
    },
    receiptPrefixRootSha256: receiptPrefix[0].contentSha256,
    receiptPrefixHeadSha256: receiptPrefix[0].contentSha256,
    lastCompletedOperationId: receiptPrefix[0].operationId,
    committedAt: '2026-08-20T10:00:03Z',
  } as const;
  return {
    ...delivery,
    status: 'failed_checkpointed',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'failed_checkpointed',
      checkpoint,
      receiptPrefix,
      lastCompletedOperationId: receiptPrefix[0].operationId,
      baselineSceneFingerprintSha256,
      currentSceneFingerprintSha256,
      mutationStarted: true,
    },
    error: 'mutation failed after native checkpoint',
    occurredAt: '2026-08-20T10:00:03Z',
  } as const;
}

function nativeUndoObservation(sceneFingerprintSha256: string) {
  const content = {
    satisfied: true as const,
    restorationObservationId: randomUUID(),
    sceneFingerprintSha256,
  };
  return {
    ...content,
    contentSha256: computeProcedureShortcutProofNativeObservationContentSha256(content),
  };
}

function nativeRedoObservation(sceneFingerprintSha256: string) {
  const content = {
    satisfied: true as const,
    redoObservationId: randomUUID(),
    sceneFingerprintSha256,
  };
  return {
    ...content,
    contentSha256: computeProcedureShortcutProofNativeObservationContentSha256(content),
  };
}

function restoredResult(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
  checkpoint: {
    checkpointId: string;
    undoLockId: string;
    baselineSceneFingerprintSha256: string;
    finalSceneFingerprintSha256: string;
  },
  occurredAt: string,
) {
  const editSubdivideIdentity =
    delivery.executorId === 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'
      ? {
          managedReceiptCreated: false as const,
          managedReplacementMeshCreated: false as const,
          nativeMutationKind: 'in_place_edit_mesh_subdivide' as const,
        }
      : {};
  return {
    ...delivery,
    status: 'restored',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    ...editSubdivideIdentity,
    requiresUndoToUnlock: false,
    terminalEvidence: {
      kind: 'restored',
      sourceCheckpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      currentSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      nativeUndoObservation: nativeUndoObservation(checkpoint.baselineSceneFingerprintSha256),
      restoredAt: occurredAt,
    },
    error: null,
    occurredAt,
  } as const;
}

function reappliedResult(
  delivery: NonNullable<
    ReturnType<ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['poll']>
  >,
  checkpoint: {
    checkpointId: string;
    undoLockId: string;
    baselineSceneFingerprintSha256: string;
    finalSceneFingerprintSha256: string;
  },
  occurredAt: string,
) {
  const editSubdivideIdentity =
    delivery.executorId === 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1'
      ? {
          managedReceiptCreated: false as const,
          managedReplacementMeshCreated: false as const,
          nativeMutationKind: 'in_place_edit_mesh_subdivide' as const,
        }
      : {};
  return {
    ...delivery,
    status: 'reapplied_locked',
    managedActionResult: 'not_executed',
    managedIdentityVerified: false,
    ...editSubdivideIdentity,
    requiresUndoToUnlock: true,
    terminalEvidence: {
      kind: 'reapplied_locked',
      sourceCheckpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
      lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      currentSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      nativeRedoObservation: nativeRedoObservation(checkpoint.finalSceneFingerprintSha256),
      reappliedAt: occurredAt,
    },
    error: null,
    occurredAt,
  } as const;
}

function createLockedEditSubdivideHistory() {
  const database = createEventDatabase();
  const originalFingerprint = 'a'.repeat(64);
  const coordinator = createBlenderShortcutProofExecutionCoordinator({
    database,
    now: dispatchNow,
  });
  const queued = queuedEditSubdivideProof();
  coordinator.queue(queued, originalFingerprint);
  const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
  const terminal = successfulEditSubdivideResult(delivery);
  terminal.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
    coordinator.progress(
      {
        ...progressFor(delivery, index + 1),
        receiptChainHeadSha256: receipt.contentSha256,
      },
      originalFingerprint,
    );
  });
  coordinator.complete(terminal, originalFingerprint);
  return { database, delivery, originalFingerprint, queued, terminal } as const;
}

function historyRecoveryAck(
  recovery: NonNullable<
    ReturnType<
      ReturnType<typeof createBlenderShortcutProofExecutionCoordinator>['pollHistoryRecovery']
    >
  >,
  occurredAt = '2026-08-20T10:01:01Z',
) {
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
    currentSceneFingerprintSha256:
      recovery.expectedStatus === 'restored'
        ? recovery.history.baselineSceneFingerprintSha256
        : recovery.history.lockedSceneFingerprintSha256,
    mutationLocked: recovery.expectedStatus !== 'restored',
    occurredAt,
  } as const;
}

describe('Blender shortcut proof execution coordinator', () => {
  it('rejects a shortcut proof while a compound replay owns native history', () => {
    const database = createEventDatabase();
    const compoundId = randomUUID();
    const queued = queuedProof();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      externalHistoryLockOwner: (_adapterId, instanceId) =>
        instanceId === queued.target.instanceId ? compoundId : null,
    });

    expect(() => coordinator.queue(queued, '1'.repeat(64))).toThrowError(
      BlenderShortcutProofExecutionError,
    );
    expect(database.events).toHaveLength(0);
  });

  it('rechecks the external history lock before dispatching an already queued proof', () => {
    const database = createEventDatabase();
    const queued = queuedProof();
    let externalOwner: string | null = null;
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      externalHistoryLockOwner: () => externalOwner,
    });
    const fingerprint = '1'.repeat(64);

    coordinator.queue(queued, fingerprint);
    externalOwner = 'blender.menu-control-proof';
    expect(coordinator.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'queued' });

    externalOwner = null;
    expect(coordinator.poll('blender', queued.target.instanceId, fingerprint)).toMatchObject({
      requestId: queued.requestId,
    });
  });
  it('persists the exact four-operation chain before one authoritative success event', () => {
    const database = createEventDatabase();
    const ids = [randomUUID()];
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: () => ids[0]!,
      now: dispatchNow,
    });
    const queued = queuedProof();
    const fingerprint = 'b'.repeat(64);
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    const result = successfulResult(delivery);
    result.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      coordinator.progress(
        { ...progressFor(delivery, index + 1), receiptChainHeadSha256: receipt.contentSha256 },
        fingerprint,
      );
    });
    expect(coordinator.complete(result, fingerprint)).toBe('accepted');
    expect(coordinator.complete(result, fingerprint)).toBe('duplicate');
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.shortcut-proof.queued',
      'blender.shortcut-proof.dispatched',
      'blender.shortcut-proof.progress-0',
      'blender.shortcut-proof.progress-1',
      'blender.shortcut-proof.progress-2',
      'blender.shortcut-proof.progress-3',
      'blender.shortcut-proof.completed',
    ]);
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'succeeded', result });
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(() =>
      coordinator.queue(queuedProof({ target: queued.target }), fingerprint),
    ).toThrowError(/still owns the target instance/);
    const restored = {
      ...delivery,
      status: 'restored',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'restored',
        sourceCheckpointId: result.terminalEvidence.attestation.nativeUndoCheckpoint.checkpointId,
        undoLockId: result.terminalEvidence.attestation.nativeUndoCheckpoint.undoLockId,
        baselineSceneFingerprintSha256: 'd'.repeat(64),
        lockedSceneFingerprintSha256: 'e'.repeat(64),
        currentSceneFingerprintSha256: 'd'.repeat(64),
        nativeUndoObservation: nativeUndoObservation('d'.repeat(64)),
        restoredAt: '2026-08-20T10:00:10Z',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:10Z',
    } as const;
    expect(() =>
      coordinator.complete(
        {
          ...restored,
          terminalEvidence: {
            ...restored.terminalEvidence,
            lockedSceneFingerprintSha256: 'f'.repeat(64),
          },
        },
        fingerprint,
      ),
    ).toThrowError(/exact retained shortcut proof Undo lock/);
    expect(coordinator.complete(restored, fingerprint)).toBe('accepted');
    expect(coordinator.complete(restored, fingerprint)).toBe('duplicate');
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'restored' });
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    const reapplied = {
      ...delivery,
      status: 'reapplied_locked',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'reapplied_locked',
        sourceCheckpointId: restored.terminalEvidence.sourceCheckpointId,
        undoLockId: restored.terminalEvidence.undoLockId,
        baselineSceneFingerprintSha256: 'd'.repeat(64),
        lockedSceneFingerprintSha256: 'e'.repeat(64),
        currentSceneFingerprintSha256: 'e'.repeat(64),
        nativeRedoObservation: nativeRedoObservation('e'.repeat(64)),
        reappliedAt: '2026-08-20T10:00:11Z',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:11Z',
    } as const;
    expect(() =>
      coordinator.complete(
        {
          ...reapplied,
          terminalEvidence: {
            ...reapplied.terminalEvidence,
            baselineSceneFingerprintSha256: 'c'.repeat(64),
          },
        },
        fingerprint,
      ),
    ).toThrowError(/exact shortcut proof Undo lock/);
    expect(coordinator.complete(reapplied, fingerprint)).toBe('accepted');
    expect(coordinator.complete(reapplied, fingerprint)).toBe('duplicate');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(true);
    expect(() =>
      coordinator.queue(queuedProof({ target: queued.target }), fingerprint),
    ).toThrowError(/still owns the target instance/);
    const restoredAgain = {
      ...restored,
      terminalEvidence: {
        ...restored.terminalEvidence,
        nativeUndoObservation: nativeUndoObservation('d'.repeat(64)),
        restoredAt: '2026-08-20T10:00:12Z',
      },
      occurredAt: '2026-08-20T10:00:12Z',
    } as const;
    expect(coordinator.complete(restoredAgain, fingerprint)).toBe('accepted');
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(coordinator.queue(queuedProof({ target: queued.target }), fingerprint)).toMatchObject({
      status: 'queued',
    });
  });

  it('persists the Edit Subdivide nine-head chain before accepting success', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedEditSubdivideProof();
    const fingerprint = 'a'.repeat(64);
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    const result = successfulEditSubdivideResult(delivery);
    const receipts = result.terminalEvidence.attestation.operationReceipts;
    expect(receipts.map((receipt) => receipt.operationId)).toEqual([
      ...meshEditSubdivideShortcutProofOperationIds,
    ]);
    expect(receipts.map((receipt) => receipt.previousReceiptContentSha256)).toEqual([
      null,
      ...receipts.slice(0, -1).map((receipt) => receipt.contentSha256),
    ]);

    receipts.forEach((receipt, index) => {
      const progress = {
        ...progressFor(delivery, index + 1),
        receiptChainHeadSha256: receipt.contentSha256,
      };
      expect(coordinator.progress(progress, fingerprint)).toBe('accepted');
      expect(coordinator.progress(progress, fingerprint)).toBe('duplicate');
      if (index < receipts.length - 1) {
        expect(() => coordinator.complete(result, fingerprint)).toThrowError(
          /requires all 9 progress receipts/,
        );
      }
    });

    expect(coordinator.complete(result, fingerprint)).toBe('accepted');
    expect(
      database.events.filter((event) => event.eventType === 'blender.shortcut-proof.progressed'),
    ).toHaveLength(9);
    expect(database.events.at(-1)?.payload).toMatchObject({
      progressReceiptChainHeads: receipts.map((receipt) => receipt.contentSha256),
      execution: {
        status: 'succeeded',
        result: {
          terminalEvidence: {
            attestation: {
              operationReceipts: receipts,
            },
          },
        },
      },
    });
    expect(coordinator.get(queued.requestId)).toMatchObject({
      status: 'succeeded',
      result: {
        terminalEvidence: {
          attestation: {
            operationReceipts: receipts,
          },
        },
      },
    });
  });

  it('rejects Edit Subdivide skipped, extra, and cross-profile progress', () => {
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database: createEventDatabase(),
      now: dispatchNow,
    });
    const queued = queuedEditSubdivideProof();
    const fingerprint = 'b'.repeat(64);
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;

    expect(() => coordinator.progress(progressFor(delivery, 2), fingerprint)).toThrowError(
      /next operation/,
    );
    expect(() =>
      coordinator.progress(
        {
          ...progressFor(delivery, 9),
          completedOperationIds: [
            ...delivery.operationIds,
            meshEditSubdivideShortcutProofOperationIds[8],
          ],
        },
        fingerprint,
      ),
    ).toThrowError();
    expect(() =>
      coordinator.progress(
        {
          ...progressFor(delivery, 1),
          executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
        },
        fingerprint,
      ),
    ).toThrowError();
    expect(() =>
      coordinator.progress(
        {
          ...progressFor(delivery, 1),
          targetProfile: 'factory_cube_8_12_6',
        },
        fingerprint,
      ),
    ).toThrowError();
  });

  it('recovers a generic Edit Subdivide progressed event as recovery_required after restart', () => {
    const database = createEventDatabase();
    const queued = queuedEditSubdivideProof();
    const fingerprint = 'c'.repeat(64);
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    first.queue(queued, fingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, fingerprint)!;
    expect(first.progress(progressFor(delivery, 1), fingerprint)).toBe('accepted');
    expect(database.events.at(-1)?.eventType).toBe('blender.shortcut-proof.progressed');

    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(database.events.at(-1)?.eventType).toBe('blender.shortcut-proof.recovery-required');
    expect(database.events.at(-1)?.payload).toMatchObject({
      progressReceiptChainHeads: [progressFor(delivery, 1).receiptChainHeadSha256],
    });
  });

  it('terminal-reconciles Edit Subdivide only when success extends the acknowledged prefix', () => {
    const originalFingerprint = 'd'.repeat(64);
    const replacementFingerprint = 'e'.repeat(64);
    const database = createEventDatabase();
    const queued = queuedEditSubdivideProof();
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    first.queue(queued, originalFingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const result = successfulEditSubdivideResult(delivery);
    const firstHead = result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256;
    first.progress(
      { ...progressFor(delivery, 1), receiptChainHeadSha256: firstHead },
      originalFingerprint,
    );

    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: () => '2026-08-20T10:01:00Z',
    });
    const challenge = restarted.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(challenge.acknowledgedProgressReceiptChainHeads).toEqual([firstHead]);
    const ack = {
      kind: 'native_terminal_reconcile',
      recoveryId: challenge.recoveryId,
      result,
      expectedMarkerContentSha256: computeCompanionShortcutProofTerminalMarkerContentSha256(result),
      currentSceneFingerprintSha256: '8'.repeat(64),
      occurredAt: '2026-08-20T10:01:01Z',
    } as const;
    expect(restarted.reconcileTerminal(ack, replacementFingerprint)).toBe('accepted');
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'succeeded' });
  });

  it('rejects an Edit Subdivide terminal chain that does not extend its acknowledged head', () => {
    const originalFingerprint = 'f'.repeat(64);
    const replacementFingerprint = '1'.repeat(64);
    const database = createEventDatabase();
    const queued = queuedEditSubdivideProof();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: dispatchNow,
    });
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    coordinator.progress(progressFor(delivery, 1), originalFingerprint);
    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: () => '2026-08-20T10:01:00Z',
    });
    const challenge = restarted.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const result = successfulEditSubdivideResult(delivery);
    expect(() =>
      restarted.reconcileTerminal(
        {
          kind: 'native_terminal_reconcile',
          recoveryId: challenge.recoveryId,
          result,
          expectedMarkerContentSha256:
            computeCompanionShortcutProofTerminalMarkerContentSha256(result),
          currentSceneFingerprintSha256: '8'.repeat(64),
          occurredAt: '2026-08-20T10:01:01Z',
        },
        replacementFingerprint,
      ),
    ).toThrowError(/exact server-acknowledged prefix/);
  });

  it('keeps success uncommitted when its single authoritative event cannot be stored', () => {
    const backing = createEventDatabase();
    let rejectCompletion = true;
    const database = {
      ...backing,
      appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
        if (rejectCompletion && input.eventType === 'blender.shortcut-proof.completed') {
          throw new Error('injected completed-event failure');
        }
        return backing.appendEvent(input);
      },
    };
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    const fingerprint = 'b'.repeat(64);
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    const result = successfulResult(delivery);
    result.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      coordinator.progress(
        { ...progressFor(delivery, index + 1), receiptChainHeadSha256: receipt.contentSha256 },
        fingerprint,
      );
    });

    expect(() => coordinator.complete(result, fingerprint)).toThrowError(
      'injected completed-event failure',
    );
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'in_progress' });
    expect(
      database.events.filter((event) => event.eventType === 'blender.shortcut-proof.completed'),
    ).toHaveLength(0);

    rejectCompletion = false;
    expect(coordinator.complete(result, fingerprint)).toBe('accepted');
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'succeeded' });
  });

  it('rejects skipped progress, a broken receipt chain, and premature success', () => {
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database: createEventDatabase(),
      now: dispatchNow,
    });
    const queued = queuedProof();
    const fingerprint = 'c'.repeat(64);
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    expect(() =>
      coordinator.progress(
        { ...progressFor(delivery, 1), occurredAt: '2026-08-20T10:00:00Z' },
        fingerprint,
      ),
    ).toThrowError(/predates its immutable delivery/);
    expect(() => coordinator.progress(progressFor(delivery, 2), fingerprint)).toThrowError(
      /next operation/,
    );
    const result = successfulResult(delivery);
    expect(() => coordinator.complete(result, fingerprint)).toThrowError(/all 4 progress receipts/);
    coordinator.progress(
      {
        ...progressFor(delivery, 1),
        receiptChainHeadSha256:
          result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256,
      },
      fingerprint,
    );
    expect(() =>
      coordinator.progress(
        {
          ...progressFor(delivery, 2),
          receiptChainHeadSha256:
            result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256,
        },
        fingerprint,
      ),
    ).toThrowError(/receipt chain head/);
  });

  it('permits only preflight rejection or a checkpointed post-mutation failure', () => {
    const database = createEventDatabase();
    const fingerprint = 'd'.repeat(64);
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    coordinator.queue(queued, fingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    const rejected = {
      ...delivery,
      status: 'rejected',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: { kind: 'rejected_before_mutation', mutationStarted: false },
      error: 'preflight rejected',
      occurredAt: '2026-08-20T10:00:02Z',
    } as const;
    expect(coordinator.complete(rejected, fingerprint)).toBe('accepted');

    const second = queuedProof();
    coordinator.queue(second, fingerprint);
    const delivery2 = coordinator.poll('blender', second.target.instanceId, fingerprint)!;
    const failed = failedResult(delivery2);
    expect(() => coordinator.complete(failed, fingerprint)).toThrowError(
      /does not match the dispatched progress receipt SHA chain/,
    );
    coordinator.progress(
      {
        ...progressFor(delivery2, 1),
        receiptChainHeadSha256: failed.terminalEvidence.receiptPrefix[0]!.contentSha256,
      },
      fingerprint,
    );
    expect(coordinator.complete(failed, fingerprint)).toBe('accepted');
    expect(database.events.at(-1)?.eventType).toBe('blender.shortcut-proof.failed-checkpointed');
    expect(database.events.at(-1)?.payload).toMatchObject({
      history: {
        checkpointId: failed.terminalEvidence.checkpoint.checkpointId,
        undoLockId: failed.terminalEvidence.checkpoint.undoLockId,
        checkpointKind: 'failure',
        baselineSceneFingerprintSha256: 'd'.repeat(64),
        lockedSceneFingerprintSha256: 'c'.repeat(64),
      },
    });

    const third = queuedProof();
    coordinator.queue(third, fingerprint);
    const delivery3 = coordinator.poll('blender', third.target.instanceId, fingerprint)!;
    const failedEvidence = failedResult(delivery3).terminalEvidence;
    coordinator.progress(
      {
        ...progressFor(delivery3, 1),
        receiptChainHeadSha256: failedEvidence.receiptPrefix[0]!.contentSha256,
      },
      fingerprint,
    );
    const failedRestored = {
      ...delivery3,
      status: 'failed_restored',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'failed_restored',
        receiptPrefix: failedEvidence.receiptPrefix,
        lastCompletedOperationId: failedEvidence.lastCompletedOperationId,
        baselineSceneFingerprintSha256: 'd'.repeat(64),
        currentSceneFingerprintSha256: 'd'.repeat(64),
        nativeUndoObservation: nativeUndoObservation('d'.repeat(64)),
        mutationStarted: true,
      },
      error: 'mutation failed and was restored',
      occurredAt: '2026-08-20T10:00:04Z',
    } as const;
    expect(coordinator.complete(failedRestored, fingerprint)).toBe('accepted');
    expect(coordinator.complete(failedRestored, fingerprint)).toBe('duplicate');
    expect(coordinator.ownsTarget('blender', third.target.instanceId)).toBe(false);
  });

  it('enforces immutable request, target ownership, delivery identity, session, and progress CAS', () => {
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database: createEventDatabase(),
      createId: randomUUID,
      now: dispatchNow,
    });
    const queued = queuedProof();
    const fingerprint = 'e'.repeat(64);
    expect(coordinator.queue(queued, fingerprint)).toMatchObject({ status: 'queued' });
    expect(coordinator.queue(queued, fingerprint)).toMatchObject({ requestId: queued.requestId });
    expect(() =>
      coordinator.queue(queuedProof({ target: queued.target }), fingerprint),
    ).toThrowError(BlenderShortcutProofExecutionError);
    expect(() =>
      coordinator.findForCreate({
        formatVersion: '1.0.0',
        requestId: queued.requestId,
        replayId: randomUUID(),
        expectedState: queued.expectedState,
      }),
    ).toThrowError(/different shortcut proof/);
    const delivery = coordinator.poll('blender', queued.target.instanceId, fingerprint)!;
    expect(() => coordinator.progress(progressFor(delivery, 1), 'f'.repeat(64))).toThrowError(
      /delivery and Companion session/,
    );
    expect(coordinator.progress(progressFor(delivery, 1), fingerprint)).toBe('accepted');
    expect(coordinator.progress(progressFor(delivery, 1), fingerprint)).toBe('duplicate');
  });

  it('never transfers queued authority to a replacement Companion lease', () => {
    const database = createEventDatabase();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: dispatchNow,
    });
    const queued = queuedProof();
    const acceptedLease = 'a'.repeat(64);
    const replacementLease = 'b'.repeat(64);
    coordinator.queue(queued, acceptedLease);

    expect(coordinator.poll('blender', queued.target.instanceId, replacementLease)).toBeNull();
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'recovery_required' });
    expect(coordinator.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(database.events.at(-1)?.payload).toMatchObject({
      sessionFingerprintSha256: acceptedLease,
      phase: 'recovery_required',
    });
    expect(
      coordinator.queue(queuedProof({ target: queued.target }), replacementLease),
    ).toMatchObject({ status: 'queued' });
  });

  it('rejects a persisted delivery replacement after dispatch', () => {
    const database = createEventDatabase();
    const fingerprint = 'a'.repeat(64);
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    first.queue(queued, fingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, fingerprint)!;
    first.progress(progressFor(delivery, 1), fingerprint);

    const progressPayload = database.events.at(-1)!.payload as {
      execution: {
        deliveryId: string;
        progress: { deliveryId: string };
      };
    };
    const replacementDeliveryId = randomUUID();
    progressPayload.execution.deliveryId = replacementDeliveryId;
    progressPayload.execution.progress.deliveryId = replacementDeliveryId;
    expect(() => createBlenderShortcutProofExecutionCoordinator({ database })).toThrowError(
      /changed immutable delivery/,
    );
  });

  it('makes every dispatched or intermediate proof recovery_required after restart', () => {
    for (const withProgress of [false, true]) {
      const database = createEventDatabase();
      const fingerprint = '1'.repeat(64);
      const queued = queuedProof();
      const first = createBlenderShortcutProofExecutionCoordinator({
        database,
        now: dispatchNow,
      });
      first.queue(queued, fingerprint);
      const delivery = first.poll('blender', queued.target.instanceId, fingerprint)!;
      if (withProgress) first.progress(progressFor(delivery, 1), fingerprint);
      const restarted = createBlenderShortcutProofExecutionCoordinator({
        database,
        now: () => '2026-08-20T10:01:00Z',
      });
      expect(restarted.get(queued.requestId)).toMatchObject({ status: 'recovery_required' });
      expect(restarted.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    }
  });

  it('reconciles a native locked result after the result-post crash window without replay', () => {
    const database = createEventDatabase();
    const originalFingerprint = '1'.repeat(64);
    const replacementFingerprint = '2'.repeat(64);
    const queued = queuedProof();
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    first.queue(queued, originalFingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const result = successfulResult(delivery);
    first.progress(
      {
        ...progressFor(delivery, 1),
        receiptChainHeadSha256:
          result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256,
      },
      originalFingerprint,
    );

    const recoveryId = randomUUID();
    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: () => recoveryId,
      now: () => '2026-08-20T10:01:00Z',
    });
    const challenge = restarted.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(challenge).toMatchObject({
      kind: 'native_terminal_reconcile',
      recoveryId,
      deliveryId: delivery.deliveryId,
      acknowledgedProgressReceiptChainHeads: [
        result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256,
      ],
    });
    expect(
      restarted.pollTerminalReconciliation(
        'blender',
        queued.target.instanceId,
        replacementFingerprint,
      ),
    ).toEqual(challenge);

    const ack = {
      kind: 'native_terminal_reconcile',
      recoveryId,
      result,
      expectedMarkerContentSha256: computeCompanionShortcutProofTerminalMarkerContentSha256(result),
      currentSceneFingerprintSha256: 'e'.repeat(64),
      occurredAt: '2026-08-20T10:01:01Z',
    } as const;
    expect(restarted.reconcileTerminal(ack, replacementFingerprint)).toBe('accepted');
    expect(restarted.reconcileTerminal(ack, replacementFingerprint)).toBe('duplicate');
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'succeeded', result });
    expect(database.events.map((event) => event.eventType)).toEqual([
      'blender.shortcut-proof.queued',
      'blender.shortcut-proof.dispatched',
      'blender.shortcut-proof.progress-0',
      'blender.shortcut-proof.recovery-required',
      'blender.shortcut-proof.terminal-reconciliation-offered',
      'blender.shortcut-proof.terminal-reconciled',
    ]);

    const restartedAgain = createBlenderShortcutProofExecutionCoordinator({ database });
    expect(
      restartedAgain.pollTerminalReconciliation(
        'blender',
        queued.target.instanceId,
        replacementFingerprint,
      ),
    ).toBeNull();
    expect(restartedAgain.reconcileTerminal(ack, replacementFingerprint)).toBe('duplicate');
  });

  it('supersedes terminal reconciliation challenges when a newer replacement session polls', () => {
    const database = createEventDatabase();
    const originalFingerprint = '1'.repeat(64);
    const replacementFingerprintB = '2'.repeat(64);
    const replacementFingerprintC = '3'.repeat(64);
    const queued = queuedProof();
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    first.queue(queued, originalFingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const result = successfulResult(delivery);
    first.progress(
      {
        ...progressFor(delivery, 1),
        receiptChainHeadSha256:
          result.terminalEvidence.attestation.operationReceipts[0]!.contentSha256,
      },
      originalFingerprint,
    );

    let currentNow = '2026-08-20T10:01:00Z';
    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => currentNow,
    });
    const challengeB = restarted.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprintB,
    )!;
    expect(
      restarted.pollTerminalReconciliation(
        'blender',
        queued.target.instanceId,
        replacementFingerprintB,
      ),
    ).toEqual(challengeB);

    const restartedWithPendingChallenge = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => currentNow,
    });
    expect(
      restartedWithPendingChallenge.pollTerminalReconciliation(
        'blender',
        queued.target.instanceId,
        replacementFingerprintB,
      ),
    ).toEqual(challengeB);

    currentNow = '2026-08-20T10:02:00Z';
    const challengeC = restartedWithPendingChallenge.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprintC,
    )!;
    expect(challengeC.recoveryId).not.toBe(challengeB.recoveryId);
    expect(
      restartedWithPendingChallenge.pollTerminalReconciliation(
        'blender',
        queued.target.instanceId,
        replacementFingerprintC,
      ),
    ).toEqual(challengeC);
    expect(database.events[0]?.payload).toMatchObject({
      pendingTerminalReconciliation: null,
      pendingTerminalReconciliationSessionFingerprintSha256: null,
    });
    expect(
      database.events
        .filter(
          (event) => event.eventType === 'blender.shortcut-proof.terminal-reconciliation-offered',
        )
        .map((event) => event.payload),
    ).toMatchObject([
      {
        pendingTerminalReconciliation: { recoveryId: challengeB.recoveryId },
        pendingTerminalReconciliationSessionFingerprintSha256: replacementFingerprintB,
      },
      {
        pendingTerminalReconciliation: { recoveryId: challengeC.recoveryId },
        pendingTerminalReconciliationSessionFingerprintSha256: replacementFingerprintC,
      },
    ]);

    const ackFor = (recoveryId: string, occurredAt: string) =>
      ({
        kind: 'native_terminal_reconcile' as const,
        recoveryId,
        result,
        expectedMarkerContentSha256:
          computeCompanionShortcutProofTerminalMarkerContentSha256(result),
        currentSceneFingerprintSha256: 'e'.repeat(64),
        occurredAt,
      }) as const;
    const ackB = ackFor(challengeB.recoveryId, '2026-08-20T10:02:01Z');
    const staleIdFromC = ackFor(challengeB.recoveryId, '2026-08-20T10:02:02Z');
    const ackC = ackFor(challengeC.recoveryId, '2026-08-20T10:02:03Z');

    expect(() =>
      restartedWithPendingChallenge.reconcileTerminal(ackB, replacementFingerprintB),
    ).toThrowError(/replacement Companion session/);
    expect(() =>
      restartedWithPendingChallenge.reconcileTerminal(staleIdFromC, replacementFingerprintC),
    ).toThrowError(/immutable delivery/);
    expect(restartedWithPendingChallenge.reconcileTerminal(ackC, replacementFingerprintC)).toBe(
      'accepted',
    );
    expect(restartedWithPendingChallenge.reconcileTerminal(ackC, replacementFingerprintC)).toBe(
      'duplicate',
    );
    expect(() =>
      restartedWithPendingChallenge.reconcileTerminal(ackB, replacementFingerprintB),
    ).toThrowError(/different terminal result/);

    const restartedAfterAcceptance = createBlenderShortcutProofExecutionCoordinator({ database });
    expect(restartedAfterAcceptance.reconcileTerminal(ackC, replacementFingerprintC)).toBe(
      'duplicate',
    );
  });

  it('fails closed on terminal reconciliation identity, marker, fingerprint, and receipt tampering', () => {
    const database = createEventDatabase();
    const originalFingerprint = '3'.repeat(64);
    const replacementFingerprint = '4'.repeat(64);
    const queued = queuedProof();
    let currentNow = dispatchNow();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: () => currentNow,
    });
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    coordinator.progress(progressFor(delivery, 1), originalFingerprint);
    currentNow = '2026-08-20T10:00:09Z';
    const challenge = coordinator.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const result = successfulResult(delivery);
    const ack = {
      kind: 'native_terminal_reconcile',
      recoveryId: challenge.recoveryId,
      result,
      expectedMarkerContentSha256: computeCompanionShortcutProofTerminalMarkerContentSha256(result),
      currentSceneFingerprintSha256: 'e'.repeat(64),
      occurredAt: '2026-08-20T10:00:10Z',
    } as const;

    expect(() => coordinator.reconcileTerminal(ack, replacementFingerprint)).toThrowError(
      /exact server-acknowledged prefix/,
    );
    expect(() =>
      coordinator.reconcileTerminal({ ...ack, recoveryId: randomUUID() }, replacementFingerprint),
    ).toThrowError(/immutable delivery/);
    expect(() =>
      coordinator.reconcileTerminal(
        { ...ack, expectedMarkerContentSha256: 'f'.repeat(64) },
        replacementFingerprint,
      ),
    ).toThrowError();
    expect(() =>
      coordinator.reconcileTerminal(
        { ...ack, currentSceneFingerprintSha256: 'f'.repeat(64) },
        replacementFingerprint,
      ),
    ).toThrowError();

    const offeredEvent = database.events.at(-1)!;
    (offeredEvent.payload as Record<string, unknown>)[
      'pendingTerminalReconciliationSessionFingerprintSha256'
    ] = null;
    expect(() => createBlenderShortcutProofExecutionCoordinator({ database })).toThrowError(
      /unbound terminal reconciliation session/,
    );
  });

  it('reconciles a failure checkpoint directly from dispatched state', () => {
    const database = createEventDatabase();
    const originalFingerprint = '5'.repeat(64);
    const replacementFingerprint = '6'.repeat(64);
    const queued = queuedProof();
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: randomUUID,
      now: dispatchNow,
    });
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const result = failedResult(delivery);
    const challenge = coordinator.pollTerminalReconciliation(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const ack = {
      kind: 'native_terminal_reconcile',
      recoveryId: challenge.recoveryId,
      result,
      expectedMarkerContentSha256: computeCompanionShortcutProofTerminalMarkerContentSha256(result),
      currentSceneFingerprintSha256: result.terminalEvidence.currentSceneFingerprintSha256,
      occurredAt: '2026-08-20T10:00:10Z',
    } as const;
    expect(coordinator.reconcileTerminal(ack, replacementFingerprint)).toBe('accepted');
    expect(coordinator.get(queued.requestId)).toMatchObject({ status: 'failed_checkpointed' });
  });

  it('keeps succeeded and failed_checkpointed targets locked across restart without replay', () => {
    const fingerprint = '6'.repeat(64);
    const successfulDatabase = createEventDatabase();
    const successful = createBlenderShortcutProofExecutionCoordinator({
      database: successfulDatabase,
      now: dispatchNow,
    });
    const queued = queuedProof();
    successful.queue(queued, fingerprint);
    const delivery = successful.poll('blender', queued.target.instanceId, fingerprint)!;
    const result = successfulResult(delivery);
    result.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      successful.progress(
        {
          ...progressFor(delivery, index + 1),
          receiptChainHeadSha256: receipt.contentSha256,
        },
        fingerprint,
      );
    });
    successful.complete(result, fingerprint);

    const restartedSuccess = createBlenderShortcutProofExecutionCoordinator({
      database: successfulDatabase,
    });
    expect(restartedSuccess.get(queued.requestId)).toMatchObject({ status: 'succeeded' });
    expect(restartedSuccess.poll('blender', queued.target.instanceId, fingerprint)).toBeNull();
    expect(() =>
      restartedSuccess.queue(queuedProof({ target: queued.target }), fingerprint),
    ).toThrowError(/still owns the target instance/);

    const failedDatabase = createEventDatabase();
    const failed = createBlenderShortcutProofExecutionCoordinator({
      database: failedDatabase,
      now: dispatchNow,
    });
    const failedQueued = queuedProof();
    failed.queue(failedQueued, fingerprint);
    const failedDelivery = failed.poll('blender', failedQueued.target.instanceId, fingerprint)!;
    const failedTerminal = failedResult(failedDelivery);
    failed.progress(
      {
        ...progressFor(failedDelivery, 1),
        receiptChainHeadSha256: failedTerminal.terminalEvidence.receiptPrefix[0]!.contentSha256,
      },
      fingerprint,
    );
    failed.complete(failedTerminal, fingerprint);
    const restartedFailure = createBlenderShortcutProofExecutionCoordinator({
      database: failedDatabase,
    });
    expect(restartedFailure.get(failedQueued.requestId)).toMatchObject({
      status: 'failed_checkpointed',
    });
    expect(
      restartedFailure.poll('blender', failedQueued.target.instanceId, fingerprint),
    ).toBeNull();
    expect(() =>
      restartedFailure.queue(queuedProof({ target: failedQueued.target }), fingerprint),
    ).toThrowError(/still owns the target instance/);
  });

  it('retains the original terminal result hash through Undo, Redo, and history rebind', () => {
    const database = createEventDatabase();
    const originalFingerprint = '7'.repeat(64);
    const replacementFingerprint = '8'.repeat(64);
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const terminal = successfulResult(delivery);
    terminal.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      coordinator.progress(
        {
          ...progressFor(delivery, index + 1),
          receiptChainHeadSha256: receipt.contentSha256,
        },
        originalFingerprint,
      );
    });
    coordinator.complete(terminal, originalFingerprint);
    const checkpoint = terminal.terminalEvidence.attestation.nativeUndoCheckpoint;
    const restored = {
      ...delivery,
      status: 'restored',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'restored',
        sourceCheckpointId: checkpoint.checkpointId,
        undoLockId: checkpoint.undoLockId,
        baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
        lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
        currentSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
        nativeUndoObservation: nativeUndoObservation(checkpoint.baselineSceneFingerprintSha256),
        restoredAt: '2026-08-20T10:00:10Z',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:10Z',
    } as const;
    coordinator.complete(restored, originalFingerprint);
    const reapplied = {
      ...delivery,
      status: 'reapplied_locked',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: true,
      terminalEvidence: {
        kind: 'reapplied_locked',
        sourceCheckpointId: checkpoint.checkpointId,
        undoLockId: checkpoint.undoLockId,
        baselineSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
        lockedSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
        currentSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
        nativeRedoObservation: nativeRedoObservation(checkpoint.finalSceneFingerprintSha256),
        reappliedAt: '2026-08-20T10:00:11Z',
      },
      error: null,
      occurredAt: '2026-08-20T10:00:11Z',
    } as const;
    coordinator.complete(reapplied, originalFingerprint);

    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = restarted.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(recovery.history.terminalResultContentSha256).toBe(
      computeCompanionShortcutProofResultContentSha256(terminal),
    );
    expect(recovery.expectedMarkerContentSha256).toBe(
      computeCompanionShortcutProofTerminalMarkerContentSha256(terminal),
    );
  });

  it('rebinds Edit Subdivide v2 history before accepting Undo and Redo transitions', () => {
    const { database, delivery, queued, terminal } = createLockedEditSubdivideHistory();
    const replacementFingerprint = 'b'.repeat(64);
    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = restarted.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(recovery).toMatchObject({
      expectedStatus: 'succeeded',
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
      history: {
        checkpointKind: 'success',
        terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(terminal),
      },
    });
    expect(restarted.recoverHistory(historyRecoveryAck(recovery), replacementFingerprint)).toBe(
      'accepted',
    );

    const checkpoint = terminal.terminalEvidence.attestation.nativeUndoCheckpoint;
    const restored = restoredResult(delivery, checkpoint, '2026-08-20T10:01:02Z');
    expect(restarted.complete(restored, replacementFingerprint)).toBe('accepted');
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'restored' });

    const reapplied = reappliedResult(delivery, checkpoint, '2026-08-20T10:01:03Z');
    expect(restarted.complete(reapplied, replacementFingerprint)).toBe('accepted');
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'reapplied_locked' });
  });

  it('rejects a persisted v1 marker downgrade for Edit Subdivide v2 history', () => {
    const { database } = createLockedEditSubdivideHistory();
    const completed = database.events.find(
      (event) => event.eventType === 'blender.shortcut-proof.completed',
    )!;
    const payload = completed.payload as {
      execution: {
        result: {
          terminalEvidence: {
            attestation: { nativeUndoCheckpoint: { marker: { key: string } } };
          };
        };
      };
    };
    payload.execution.result.terminalEvidence.attestation.nativeUndoCheckpoint.marker.key =
      '_operating_line_shortcut_proof_history_v1';

    expect(() => createBlenderShortcutProofExecutionCoordinator({ database })).toThrowError();
  });

  it('rejects Edit Subdivide history recovery depth values other than 4/4', () => {
    for (const [field, value] of [
      ['nativeUndoDepth', 3],
      ['nativeRedoDepth', 5],
    ] as const) {
      const { database, queued } = createLockedEditSubdivideHistory();
      const recovering = createBlenderShortcutProofExecutionCoordinator({
        database,
        now: () => '2026-08-20T10:01:00Z',
      });
      recovering.pollHistoryRecovery('blender', queued.target.instanceId, 'c'.repeat(64));
      const offered = database.events.at(-1)!.payload as {
        pendingRecovery: Record<string, unknown>;
      };
      offered.pendingRecovery[field] = value;

      expect(() => createBlenderShortcutProofExecutionCoordinator({ database })).toThrowError();
    }
  });

  it('rejects Edit Subdivide history recovery marker and terminal result hash tampering', () => {
    const { database, queued } = createLockedEditSubdivideHistory();
    const replacementFingerprint = 'd'.repeat(64);
    const recovering = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const ack = historyRecoveryAck(recovery);

    expect(() =>
      recovering.recoverHistory(
        { ...ack, expectedMarkerContentSha256: 'e'.repeat(64) },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
    expect(() =>
      recovering.recoverHistory(
        {
          ...ack,
          history: { ...ack.history, terminalResultContentSha256: 'f'.repeat(64) },
        },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
  });

  it('rejects Edit Subdivide history recovery with the wrong checkpoint or Undo lock', () => {
    const { database, queued } = createLockedEditSubdivideHistory();
    const replacementFingerprint = '1'.repeat(64);
    const recovering = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const ack = historyRecoveryAck(recovery);

    expect(() =>
      recovering.recoverHistory(
        { ...ack, history: { ...ack.history, checkpointId: randomUUID() } },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
    expect(() =>
      recovering.recoverHistory(
        { ...ack, history: { ...ack.history, undoLockId: randomUUID() } },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
  });

  it('rejects a non-alternating Edit Subdivide Undo and Redo recovery suffix', () => {
    const { database, delivery, queued, terminal } = createLockedEditSubdivideHistory();
    const replacementFingerprint = '2'.repeat(64);
    const recovering = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const checkpoint = terminal.terminalEvidence.attestation.nativeUndoCheckpoint;
    const firstRestore = restoredResult(delivery, checkpoint, '2026-08-20T10:01:01Z');
    const duplicateRestore = restoredResult(delivery, checkpoint, '2026-08-20T10:01:02Z');

    expect(() =>
      recovering.reconcileHistoryTransitions(
        {
          kind: 'native_history_transition_reconcile',
          recoveryId: recovery.recoveryId,
          results: [firstRestore, duplicateRestore],
          expectedResultContentSha256: recovery.expectedResultContentSha256,
          expectedMarkerContentSha256: recovery.expectedMarkerContentSha256,
          currentSceneFingerprintSha256: checkpoint.baselineSceneFingerprintSha256,
          occurredAt: '2026-08-20T10:01:03Z',
        },
        replacementFingerprint,
      ),
    ).toThrowError(/strictly alternate native Undo and Redo/);
  });

  it('rebinds exact locked native history after coordinator and Companion restart', () => {
    const database = createEventDatabase();
    const originalFingerprint = '6'.repeat(64);
    const replacementFingerprint = '7'.repeat(64);
    const first = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    first.queue(queued, originalFingerprint);
    const delivery = first.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const result = successfulResult(delivery);
    result.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      first.progress(
        {
          ...progressFor(delivery, index + 1),
          receiptChainHeadSha256: receipt.contentSha256,
        },
        originalFingerprint,
      );
    });
    first.complete(result, originalFingerprint);

    const recoveryId = randomUUID();
    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      createId: () => recoveryId,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = restarted.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(recovery).toMatchObject({
      kind: 'native_history_rebind',
      recoveryId,
      requestId: queued.requestId,
      deliveryId: delivery.deliveryId,
      history: {
        checkpointId: result.terminalEvidence.attestation.nativeUndoCheckpoint.checkpointId,
        undoLockId: result.terminalEvidence.attestation.nativeUndoCheckpoint.undoLockId,
        checkpointKind: 'success',
        baselineSceneFingerprintSha256: 'd'.repeat(64),
        lockedSceneFingerprintSha256: 'e'.repeat(64),
        terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(result),
      },
    });
    expect(recovery.expectedMarkerContentSha256).toBe(
      computeCompanionShortcutProofTerminalMarkerContentSha256(result),
    );

    const offeredPayload = database.events.at(-1)!.payload as {
      pendingRecovery: { expectedMarkerContentSha256: string };
    };
    const persistedMarkerContentSha256 = offeredPayload.pendingRecovery.expectedMarkerContentSha256;
    offeredPayload.pendingRecovery.expectedMarkerContentSha256 = 'f'.repeat(64);
    expect(() => createBlenderShortcutProofExecutionCoordinator({ database })).toThrowError(
      /changed recovery authority/,
    );
    offeredPayload.pendingRecovery.expectedMarkerContentSha256 = persistedMarkerContentSha256;

    const restartedWithPendingOffer = createBlenderShortcutProofExecutionCoordinator({ database });
    expect(
      restartedWithPendingOffer.pollHistoryRecovery(
        'blender',
        queued.target.instanceId,
        replacementFingerprint,
      ),
    ).toEqual(recovery);
    const restored = {
      ...delivery,
      status: 'restored',
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      requiresUndoToUnlock: false,
      terminalEvidence: {
        kind: 'restored',
        sourceCheckpointId: recovery.history.checkpointId,
        undoLockId: recovery.history.undoLockId,
        baselineSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
        lockedSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
        currentSceneFingerprintSha256: recovery.history.baselineSceneFingerprintSha256,
        nativeUndoObservation: nativeUndoObservation(
          recovery.history.baselineSceneFingerprintSha256,
        ),
        restoredAt: '2026-08-20T10:01:02Z',
      },
      error: null,
      occurredAt: '2026-08-20T10:01:02Z',
    } as const;
    expect(() => restartedWithPendingOffer.complete(restored, originalFingerprint)).toThrowError(
      /blocked until native history is rebound/,
    );

    const ack = {
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
      occurredAt: '2026-08-20T10:01:01Z',
    } as const;
    expect(() =>
      restartedWithPendingOffer.recoverHistory(
        { ...ack, expectedMarkerContentSha256: 'f'.repeat(64) },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
    expect(() =>
      restartedWithPendingOffer.recoverHistory(
        {
          ...ack,
          history: {
            ...ack.history,
            lockedSceneFingerprintSha256: 'a'.repeat(64),
          },
          currentSceneFingerprintSha256: 'a'.repeat(64),
        },
        replacementFingerprint,
      ),
    ).toThrowError(/does not match its recovery delivery/);
    expect(() => restartedWithPendingOffer.recoverHistory(ack, originalFingerprint)).toThrowError(
      /replacement Companion session/,
    );
    expect(restartedWithPendingOffer.recoverHistory(ack, replacementFingerprint)).toBe('accepted');
    expect(restartedWithPendingOffer.recoverHistory(ack, replacementFingerprint)).toBe('duplicate');

    const restartedAfterRebind = createBlenderShortcutProofExecutionCoordinator({ database });
    expect(
      restartedAfterRebind.pollHistoryRecovery(
        'blender',
        queued.target.instanceId,
        replacementFingerprint,
      ),
    ).toBeNull();
    expect(restartedAfterRebind.complete(restored, replacementFingerprint)).toBe('accepted');
    expect(restartedAfterRebind.ownsTarget('blender', queued.target.instanceId)).toBe(false);
    expect(database.events.map((event) => event.eventType)).toContain(
      'blender.shortcut-proof.history-rebound',
    );
  });

  it('durably reconciles an alternating Undo/Redo outbox suffix from the exact server hash', () => {
    const database = createEventDatabase();
    const originalFingerprint = '1'.repeat(64);
    const replacementFingerprint = '2'.repeat(64);
    const rotatedFingerprint = '3'.repeat(64);
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const terminal = successfulResult(delivery);
    terminal.terminalEvidence.attestation.operationReceipts.forEach((receipt, index) => {
      coordinator.progress(
        {
          ...progressFor(delivery, index + 1),
          receiptChainHeadSha256: receipt.contentSha256,
        },
        originalFingerprint,
      );
    });
    coordinator.complete(terminal, originalFingerprint);
    const checkpoint = terminal.terminalEvidence.attestation.nativeUndoCheckpoint;
    const restoredOne = restoredResult(delivery, checkpoint, '2026-08-20T10:00:10Z');
    const reappliedOne = reappliedResult(delivery, checkpoint, '2026-08-20T10:00:11Z');
    coordinator.complete(restoredOne, originalFingerprint);
    coordinator.complete(reappliedOne, originalFingerprint);

    const recovering = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const staleRecovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    const recovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      rotatedFingerprint,
    )!;
    expect(recovery.recoveryId).not.toBe(staleRecovery.recoveryId);
    expect(recovery).toMatchObject({
      expectedStatus: 'reapplied_locked',
      expectedResultContentSha256: computeCompanionShortcutProofResultContentSha256(reappliedOne),
    });

    const restoredTwo = restoredResult(delivery, checkpoint, '2026-08-20T10:01:01Z');
    const reappliedTwo = reappliedResult(delivery, checkpoint, '2026-08-20T10:01:02Z');
    const ack = {
      kind: 'native_history_transition_reconcile',
      recoveryId: recovery.recoveryId,
      results: [restoredTwo, reappliedTwo],
      expectedResultContentSha256: recovery.expectedResultContentSha256,
      expectedMarkerContentSha256: recovery.expectedMarkerContentSha256,
      currentSceneFingerprintSha256: checkpoint.finalSceneFingerprintSha256,
      occurredAt: '2026-08-20T10:01:03Z',
    } as const;
    expect(() =>
      recovering.reconcileHistoryTransitions(
        { ...ack, recoveryId: staleRecovery.recoveryId },
        replacementFingerprint,
      ),
    ).toThrowError(/do not match the retained history recovery delivery/);
    expect(() =>
      recovering.reconcileHistoryTransitions(
        { ...ack, expectedMarkerContentSha256: 'f'.repeat(64) },
        rotatedFingerprint,
      ),
    ).toThrowError(/do not match the retained history recovery delivery/);
    expect(() =>
      recovering.reconcileHistoryTransitions(
        { ...ack, expectedResultContentSha256: 'f'.repeat(64) },
        rotatedFingerprint,
      ),
    ).toThrowError(/do not match the retained history recovery delivery/);
    expect(recovering.reconcileHistoryTransitions(ack, rotatedFingerprint)).toBe('accepted');
    expect(recovering.reconcileHistoryTransitions(ack, rotatedFingerprint)).toBe('duplicate');
    expect(recovering.get(queued.requestId)).toMatchObject({
      status: 'reapplied_locked',
      result: reappliedTwo,
    });
    expect(database.events.at(-1)?.eventType).toBe(
      'blender.shortcut-proof.history-transition-reconciled',
    );

    const restarted = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:04.500Z',
    });
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'reapplied_locked' });
    expect(restarted.reconcileHistoryTransitions(ack, rotatedFingerprint)).toBe('duplicate');
    const restoredThree = restoredResult(delivery, checkpoint, '2026-08-20T10:01:04Z');
    restarted.complete(restoredThree, rotatedFingerprint);
    const finalFingerprint = '4'.repeat(64);
    const nextQueued = queuedProof({ target: queued.target });
    restarted.queue(nextQueued, finalFingerprint);
    const restoredRecovery = restarted.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      finalFingerprint,
    )!;
    expect(restoredRecovery.expectedStatus).toBe('restored');
    const restoredAck = {
      kind: 'native_history_rebind',
      formatVersion: restoredRecovery.formatVersion,
      requestId: restoredRecovery.requestId,
      replayId: restoredRecovery.replayId,
      proofId: restoredRecovery.proofId,
      deliveryId: restoredRecovery.deliveryId,
      target: restoredRecovery.target,
      bindingContentSha256: restoredRecovery.bindingContentSha256,
      recoveryId: restoredRecovery.recoveryId,
      history: restoredRecovery.history,
      status: 'restored',
      expectedMarkerContentSha256: restoredRecovery.expectedMarkerContentSha256,
      currentSceneFingerprintSha256: restoredRecovery.history.baselineSceneFingerprintSha256,
      mutationLocked: false,
      occurredAt: '2026-08-20T10:01:05Z',
    } as const;
    expect(restarted.recoverHistory(restoredAck, finalFingerprint)).toBe('accepted');
    expect(restarted.get(queued.requestId)).toMatchObject({ status: 'restored' });
    expect(restarted.poll('blender', queued.target.instanceId, finalFingerprint)).toMatchObject({
      requestId: nextQueued.requestId,
    });
  });

  it('reconciles Undo and Redo without promoting a retained failure checkpoint', () => {
    const database = createEventDatabase();
    const originalFingerprint = '5'.repeat(64);
    const replacementFingerprint = '6'.repeat(64);
    const coordinator = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: dispatchNow,
    });
    const queued = queuedProof();
    coordinator.queue(queued, originalFingerprint);
    const delivery = coordinator.poll('blender', queued.target.instanceId, originalFingerprint)!;
    const failed = failedResult(delivery);
    coordinator.progress(
      {
        ...progressFor(delivery, 1),
        receiptChainHeadSha256: failed.terminalEvidence.receiptPrefix[0]!.contentSha256,
      },
      originalFingerprint,
    );
    coordinator.complete(failed, originalFingerprint);
    const recovering = createBlenderShortcutProofExecutionCoordinator({
      database,
      now: () => '2026-08-20T10:01:00Z',
    });
    const recovery = recovering.pollHistoryRecovery(
      'blender',
      queued.target.instanceId,
      replacementFingerprint,
    )!;
    expect(recovery).toMatchObject({
      expectedStatus: 'failed_checkpointed',
      history: { checkpointKind: 'failure' },
    });
    const checkpoint = failed.terminalEvidence.checkpoint;
    const checkpointIdentity = {
      checkpointId: checkpoint.checkpointId,
      undoLockId: checkpoint.undoLockId,
      baselineSceneFingerprintSha256: checkpoint.baselineState.sceneFingerprintSha256,
      finalSceneFingerprintSha256: checkpoint.currentState.sceneFingerprintSha256,
    };
    const restored = restoredResult(delivery, checkpointIdentity, '2026-08-20T10:01:01Z');
    const reapplied = reappliedResult(delivery, checkpointIdentity, '2026-08-20T10:01:02Z');
    const ack = {
      kind: 'native_history_transition_reconcile',
      recoveryId: recovery.recoveryId,
      results: [restored, reapplied],
      expectedResultContentSha256: recovery.expectedResultContentSha256,
      expectedMarkerContentSha256: recovery.expectedMarkerContentSha256,
      currentSceneFingerprintSha256: recovery.history.lockedSceneFingerprintSha256,
      occurredAt: '2026-08-20T10:01:03Z',
    } as const;
    expect(recovering.reconcileHistoryTransitions(ack, replacementFingerprint)).toBe('accepted');
    expect(recovering.get(queued.requestId)).toMatchObject({
      status: 'reapplied_locked',
      result: { status: 'reapplied_locked' },
    });
    const payload = database.events.at(-1)!.payload as {
      history: { checkpointKind: string; terminalResultContentSha256: string };
    };
    expect(payload.history).toEqual({
      ...recovery.history,
      checkpointKind: 'failure',
      terminalResultContentSha256: computeCompanionShortcutProofResultContentSha256(failed),
    });
  });
});
