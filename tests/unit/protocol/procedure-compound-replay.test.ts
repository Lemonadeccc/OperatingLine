import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  procedureCompoundCurrentStateSchema,
  computeProcedureCompoundLeafIntentSha256,
  computeProcedureCompoundDecisionReceiptSha256,
  computeProcedureCompoundDecisionSingleUseKeySha256,
  computeProcedureCompoundDecisionStartStateProjectionSha256,
  computeProcedureCompoundHostAttestationSha256,
  computeProcedureCompoundRecordedBaselineSha256,
  computeProcedureCompoundTerminalObservationSha256,
  computeProtocolCanonicalJsonSha256,
  procedureCompoundLeafIntentSchema,
  procedureCompoundLeafReceiptSchema,
  sealProcedureCompoundCurrentState,
  sealProcedureCompoundLeafReceipt,
  sealProcedureCompoundRecipe,
  verifyProcedureCompoundLeafReceipt,
  verifyProcedureCompoundCurrentStateIntegrity,
  verifyProcedureCompoundRecipeIntegrity,
  verifyProcedureCompoundReplayIntegrity,
  verifyProcedureCompoundTransition,
  procedureCompoundReplaySchema,
  procedureCompoundRecipeSchema,
  type ProcedureCompoundRecipeKind,
} from '@operatingline/protocol';

const h = (character: string) => character.repeat(64);

function historyProof(kind: 'poke_native_checkpoint' | 'native_undo_once' | 'native_redo_once') {
  return {
    kind,
    modeScope: 'edit_middle_only',
    objectModeUndoRedoClaim: false,
    editBaselineIdentitySha256: h('a'),
    editFinalIdentitySha256: h('b'),
    objectPointerSha256: h('c'),
    meshPointerSha256: h('d'),
    meshDatablockSha256: h('e'),
    baselineTopologySha256: h('1'),
    finalTopologySha256: h('2'),
    baselineSelectionSha256: h('3'),
    finalSelectionSha256: h('4'),
    historyHeadBeforeSha256: h('5'),
    historyHeadAfterSha256: h('6'),
    checkpointSha256: h('7'),
    journalHeadSha256: h('8'),
  } as const;
}

function historyObligation(
  kind: 'poke_native_checkpoint' | 'native_undo_once' | 'native_redo_once',
) {
  return {
    kind,
    modeScope: 'edit_middle_only',
    objectModeUndoRedoClaim: false,
    expectedHistoryHeadBeforeSha256: h('5'),
    expectedCheckpointSha256: kind === 'poke_native_checkpoint' ? null : h('7'),
  } as const;
}

function recipe(kind: ProcedureCompoundRecipeKind) {
  const compoundId = randomUUID();
  const replayId = randomUUID();
  const compoundContentSha256 = h('a');
  const historyLockTokenSha256 = h('b');
  const baselineCandidate = {
    blenderProcessIdentitySha256: h('1'),
    blenderSessionUid: 'session-uid',
    documentFingerprintSha256: h('2'),
    nativeHistoryMarkerSha256: h('3'),
    historyHeadSha256: h('4'),
    objectIdentitySha256: h('5'),
    meshIdentitySha256: h('6'),
    objectPointerSha256: h('7'),
    meshPointerSha256: h('8'),
    meshDatablockSha256: h('9'),
    topologySha256: h('a'),
    selectionSha256: h('b'),
    stateSha256: h('4'),
    contentSha256: h('0'),
  };
  const common = {
    compoundId,
    replayId,
    compoundContentSha256,
    historyLockTokenSha256,
    decisionReceiptId: randomUUID(),
    decisionReceiptSha256: h('9'),
    decisionSingleUseKeySha256: h('0'),
    decisionStartStateProjectionSha256: h('d'),
    stateChainSha256s: [h('1'), h('2'), h('3'), h('4')],
    orderedLeafBindingSha256s: [h('c'), h('d'), h('e')],
    objectModeUndoRedoTransactionProven: false,
    decisionCurrentStateIntegritySha256: h('c'),
    recordedObjectBaseline: {
      ...baselineCandidate,
      contentSha256: computeProcedureCompoundRecordedBaselineSha256(baselineCandidate),
    },
  } as const;
  const leafCommon = (bindingSha256: string) => ({
    bindingSha256,
    compoundContentSha256,
    historyLockTokenSha256,
  });
  const enter = {
    ...leafCommon(h('c')),
    leafId: `${kind}.enter`,
    order: 1,
    kind: 'enter_edit',
    fromMode: 'OBJECT',
    toMode: 'EDIT_MESH',
    modelChanging: false,
    nativeUndoRedoOperationCount: 0,
    historyObligation: null,
  } as const;
  const exit = {
    ...leafCommon(h('e')),
    leafId: `${kind}.exit`,
    order: 3,
    kind: 'exit_edit',
    fromMode: 'EDIT_MESH',
    toMode: 'OBJECT',
    modelChanging: false,
    nativeUndoRedoOperationCount: 0,
    historyObligation: null,
  } as const;
  if (kind === 'forward') {
    return {
      ...common,
      kind,
      decisionKind: 'BlenderExecutionDecisionReceipt',
      expectedStartStatus: 'intent_recorded',
      expectedTerminalStatus: 'forward_applied_locked',
      leaves: [
        enter,
        {
          ...leafCommon(h('d')),
          leafId: 'forward.poke',
          order: 2,
          kind: 'poke',
          fromMode: 'EDIT_MESH',
          toMode: 'EDIT_MESH',
          modelChanging: true,
          nativeUndoRedoOperationCount: 0,
          historyObligation: historyObligation('poke_native_checkpoint'),
        },
        exit,
      ],
    } as const;
  }
  const isBack = kind === 'back';
  return {
    ...common,
    kind,
    decisionKind: 'BlenderHistoryTransitionDecisionReceipt',
    decisionTransition: kind,
    expectedStartStatus: isBack ? 'forward_applied_locked' : 'restored_locked',
    expectedTerminalStatus: isBack ? 'restored_locked' : 'reapplied_locked',
    leaves: [
      enter,
      {
        ...leafCommon(h('d')),
        leafId: `${kind}.history`,
        order: 2,
        kind: isBack ? 'native_undo_once' : 'native_redo_once',
        fromMode: 'EDIT_MESH',
        toMode: 'EDIT_MESH',
        modelChanging: true,
        nativeUndoRedoOperationCount: 1,
        historyObligation: historyObligation(isBack ? 'native_undo_once' : 'native_redo_once'),
      },
      exit,
    ],
  } as const;
}

function replay(kind: ProcedureCompoundRecipeKind) {
  const selectedRecipe = recipe(kind);
  const status =
    kind === 'forward'
      ? 'forward_applied_locked'
      : kind === 'back'
        ? 'restored_locked'
        : 'reapplied_locked';
  const lifecycleState = kind === 'back' ? 'object_baseline' : 'object_final';
  const permittedHistoryTransitions =
    kind === 'back' ? ['redo', 'abandon_baseline'] : ['back', 'unlock_final'];
  return {
    formatVersion: '1.0.0',
    planContentSha256: h('f'),
    target: { adapterId: 'blender', instanceId: randomUUID() },
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.40.0',
    recipe: selectedRecipe,
    currentState: {
      compoundId: selectedRecipe.compoundId,
      replayId: selectedRecipe.replayId,
      compoundContentSha256: selectedRecipe.compoundContentSha256,
      historyLockTokenSha256: selectedRecipe.historyLockTokenSha256,
      status,
      lifecycleState,
      mode: 'OBJECT',
      historyLock: 'held',
      historyContinuity: 'same_live_session',
      nativeHistoryLossRecorded: false,
      inProgressLeafId: null,
      permittedHistoryTransitions,
      blenderProcessIdentitySha256: h('1'),
      blenderSessionUid: 'session-uid',
      documentFingerprintSha256: h('2'),
      nativeHistoryMarkerSha256: h('3'),
      historyHeadSha256: h('4'),
      objectIdentitySha256: h('5'),
      meshIdentitySha256: h('6'),
      objectPointerSha256: h('7'),
      meshPointerSha256: h('8'),
      meshDatablockSha256: h('9'),
      topologySha256: h('a'),
      selectionSha256: h('b'),
      stateSha256: selectedRecipe.stateChainSha256s[3],
      integritySha256: h('c'),
    },
    leafProgress: selectedRecipe.leaves.map((leaf, index) => ({
      leafId: leaf.leafId,
      intentSha256: h(String(index + 1)),
      receiptSha256: h(String(index + 4)),
    })),
  };
}

function sealedTransitionReplay(kind: ProcedureCompoundRecipeKind) {
  const value = replay(kind);
  const sealedRecipe = sealProcedureCompoundRecipe(value.recipe);
  const currentState = sealProcedureCompoundCurrentState(
    {
      ...value.currentState,
      compoundId: sealedRecipe.compoundId,
      replayId: sealedRecipe.replayId,
      compoundContentSha256: sealedRecipe.compoundContentSha256,
      historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
    },
    sealedRecipe,
  );
  return { ...value, recipe: sealedRecipe, currentState };
}

function terminalTransitionEvidence(
  replayValue: ReturnType<typeof replay>,
  previous: ReturnType<typeof replay>['currentState'],
  next: ReturnType<typeof replay>['currentState'],
  transition: 'unlock_final' | 'abandon_baseline',
) {
  const operationId = randomUUID();
  const observationCandidate = {
    kind: transition === 'unlock_final' ? 'fresh_object_final' : 'fresh_object_baseline',
    observedAt: '2026-08-21T00:00:01.000Z',
    blenderProcessIdentitySha256: next.blenderProcessIdentitySha256,
    blenderSessionUid: next.blenderSessionUid,
    documentFingerprintSha256: next.documentFingerprintSha256,
    nativeHistoryMarkerSha256: next.nativeHistoryMarkerSha256,
    historyHeadSha256: next.historyHeadSha256,
    objectIdentitySha256: next.objectIdentitySha256,
    meshIdentitySha256: next.meshIdentitySha256,
    objectPointerSha256: next.objectPointerSha256,
    meshPointerSha256: next.meshPointerSha256,
    meshDatablockSha256: next.meshDatablockSha256,
    topologySha256: next.topologySha256,
    selectionSha256: next.selectionSha256,
    stateSha256: next.stateSha256,
    contentSha256: h('0'),
  } as const;
  const observation = {
    ...observationCandidate,
    contentSha256: computeProcedureCompoundTerminalObservationSha256(observationCandidate),
  };
  const decision = {
    formatVersion: '1.0.0',
    decisionId: randomUUID(),
    nonce: 'terminal_nonce_1234',
    issuedAt: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T00:05:00.000Z',
    kind: 'BlenderHistoryTransitionDecisionReceipt',
    transition,
    compoundId: replayValue.recipe.compoundId,
    replayId: replayValue.recipe.replayId,
    target: replayValue.target,
    blenderProcessIdentitySha256: previous.blenderProcessIdentitySha256,
    blenderSessionUid: previous.blenderSessionUid,
    documentFingerprintSha256: previous.documentFingerprintSha256,
    compoundContentSha256: replayValue.recipe.compoundContentSha256,
    historyLockTokenSha256: replayValue.recipe.historyLockTokenSha256,
    currentStateSha256: previous.integritySha256,
    expectedHistoryHeadSha256: previous.historyHeadSha256,
    expectedStatus: previous.status,
    terminalObservationSha256: observation.contentSha256,
    nativeHistoryLossRecorded: previous.nativeHistoryLossRecorded,
    actionCatalogVersion: replayValue.actionCatalogVersion,
    interactionCatalogVersion: replayValue.interactionCatalogVersion,
  } as const;
  const binding = {
    compoundId: decision.compoundId,
    replayId: decision.replayId,
    adapterId: decision.target.adapterId,
    instanceId: decision.target.instanceId,
    blenderProcessIdentitySha256: decision.blenderProcessIdentitySha256,
    blenderSessionUid: decision.blenderSessionUid,
    documentFingerprintSha256: decision.documentFingerprintSha256,
    compoundContentSha256: decision.compoundContentSha256,
    historyLockTokenSha256: decision.historyLockTokenSha256,
    currentStateSha256: decision.currentStateSha256,
    expectedHistoryHeadSha256: decision.expectedHistoryHeadSha256,
    transition: decision.transition,
    expectedStatus: decision.expectedStatus,
    terminalObservationSha256: decision.terminalObservationSha256,
    nativeHistoryLossRecorded: decision.nativeHistoryLossRecorded,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
  };
  const event = {
    formatVersion: '1.0.0',
    kind: 'compound_transition',
    eventId: randomUUID(),
    sequence: 4,
    compoundId: replayValue.recipe.compoundId,
    authorizationOperationId: operationId,
    previousEventSha256: h('c'),
    previous: {
      status: previous.status,
      inProgressLeafId: previous.inProgressLeafId,
      historyHeadSha256: previous.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: null,
    },
    next: {
      status: next.status,
      inProgressLeafId: next.inProgressLeafId,
      historyHeadSha256: next.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: observation.contentSha256,
    },
    observedFreshBaseline: transition === 'abandon_baseline',
    observedFreshFinal: transition === 'unlock_final',
    recordedAt: '2026-08-21T00:00:02.000Z',
  } as const;
  const consumption = {
    formatVersion: '1.0.0',
    eventId: randomUUID(),
    sequence: 0,
    kind: 'blender_history_transition_consumed',
    credentialId: decision.decisionId,
    singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    operationId,
    bindingSha256: computeProtocolCanonicalJsonSha256({
      decisionSha256: computeProtocolCanonicalJsonSha256(decision),
      binding,
    }),
    consumedAt: decision.issuedAt,
  } as const;
  return {
    event,
    context: {
      compoundId: replayValue.recipe.compoundId,
      previousCheckpointSha256: null,
      nextCheckpointSha256: null,
      previousTerminalObservationSha256: null,
      nextTerminalObservationSha256: observation.contentSha256,
      trustedPreviousEventSequence: 3,
      trustedPreviousEventSha256: h('c'),
      replay: replayValue,
      transitionDecisionReceipt: decision,
      trustedConsumptionEvent: consumption,
      terminalObservation: observation,
      replayEvidenceResolver: null,
    },
  };
}

function lockedHistoryTransitionEvidence(kind: 'back' | 'redo') {
  const raw = replay(kind);
  const previousStatus = kind === 'back' ? 'forward_applied_locked' : 'restored_locked';
  const decisionNonce = `${kind}_history_nonce_1`;
  const previousCandidate = procedureCompoundCurrentStateSchema.parse({
    ...raw.currentState,
    status: previousStatus,
    lifecycleState: kind === 'back' ? 'object_final' : 'object_baseline',
    mode: 'OBJECT',
    historyLock: 'held',
    historyContinuity: 'same_live_session',
    nativeHistoryLossRecorded: false,
    inProgressLeafId: null,
    permittedHistoryTransitions:
      kind === 'back' ? ['back', 'unlock_final'] : ['redo', 'abandon_baseline'],
    stateSha256: raw.recipe.stateChainSha256s[0],
  });
  let sealedRecipe = sealProcedureCompoundRecipe({
    ...raw.recipe,
    decisionSingleUseKeySha256: computeProtocolCanonicalJsonSha256({ nonce: decisionNonce }),
    decisionStartStateProjectionSha256:
      computeProcedureCompoundDecisionStartStateProjectionSha256(previousCandidate),
  });
  const previous = sealProcedureCompoundCurrentState(previousCandidate, sealedRecipe);
  sealedRecipe = sealProcedureCompoundRecipe({
    ...sealedRecipe,
    decisionCurrentStateIntegritySha256: previous.integritySha256,
  });
  const next = sealProcedureCompoundCurrentState(
    {
      ...raw.currentState,
      stateSha256: sealedRecipe.stateChainSha256s[3],
    },
    sealedRecipe,
  );
  const decision = {
    formatVersion: '1.0.0',
    decisionId: sealedRecipe.decisionReceiptId,
    nonce: decisionNonce,
    issuedAt: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T00:05:00.000Z',
    kind: 'BlenderHistoryTransitionDecisionReceipt',
    transition: kind,
    compoundId: sealedRecipe.compoundId,
    replayId: sealedRecipe.replayId,
    target: raw.target,
    blenderProcessIdentitySha256: previous.blenderProcessIdentitySha256,
    blenderSessionUid: previous.blenderSessionUid,
    documentFingerprintSha256: previous.documentFingerprintSha256,
    compoundContentSha256: sealedRecipe.compoundContentSha256,
    historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
    currentStateSha256: previous.integritySha256,
    expectedHistoryHeadSha256:
      sealedRecipe.leaves[1].historyObligation.expectedHistoryHeadBeforeSha256,
    expectedStatus: previous.status,
    terminalObservationSha256: null,
    nativeHistoryLossRecorded: false,
    actionCatalogVersion: raw.actionCatalogVersion,
    interactionCatalogVersion: raw.interactionCatalogVersion,
  } as const;
  sealedRecipe = sealProcedureCompoundRecipe({
    ...sealedRecipe,
    decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
    decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
  });
  const operationId = randomUUID();
  const decisionBinding = {
    compoundId: decision.compoundId,
    replayId: decision.replayId,
    adapterId: decision.target.adapterId,
    instanceId: decision.target.instanceId,
    blenderProcessIdentitySha256: decision.blenderProcessIdentitySha256,
    blenderSessionUid: decision.blenderSessionUid,
    documentFingerprintSha256: decision.documentFingerprintSha256,
    compoundContentSha256: decision.compoundContentSha256,
    historyLockTokenSha256: decision.historyLockTokenSha256,
    currentStateSha256: decision.currentStateSha256,
    expectedHistoryHeadSha256: decision.expectedHistoryHeadSha256,
    transition: decision.transition,
    expectedStatus: decision.expectedStatus,
    terminalObservationSha256: null,
    nativeHistoryLossRecorded: false,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
  };
  const trustedDecisionConsumptionEvent = {
    formatVersion: '1.0.0',
    eventId: randomUUID(),
    sequence: 0,
    kind: 'blender_history_transition_consumed',
    credentialId: decision.decisionId,
    singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    operationId,
    bindingSha256: computeProtocolCanonicalJsonSha256({
      decisionSha256: computeProtocolCanonicalJsonSha256(decision),
      binding: decisionBinding,
    }),
    consumedAt: decision.issuedAt,
  } as const;
  let previousReceiptSha256: string | null = null;
  const evidence = sealedRecipe.leaves.map((leaf, index) => {
    const order = (index + 1) as 1 | 2 | 3;
    const intent = procedureCompoundLeafIntentSchema.parse({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_intent',
      eventId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      recipeKind: kind,
      leafId: leaf.leafId,
      order,
      historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
      preStateSha256: sealedRecipe.stateChainSha256s[index],
      expectedPostStateSha256: sealedRecipe.stateChainSha256s[index + 1],
      previousReceiptSha256,
      recordedAt: `2026-08-21T00:00:0${String(index * 2 + 1)}.000Z`,
    });
    const proof =
      index === 1 ? historyProof(kind === 'back' ? 'native_undo_once' : 'native_redo_once') : null;
    const attestationCandidate = {
      formatVersion: '1.0.0',
      kind: 'compound_leaf_host_attestation',
      attestationId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      replayId: sealedRecipe.replayId,
      leafId: leaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      preStateSha256: sealedRecipe.stateChainSha256s[index]!,
      postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
      historyProof: proof,
      checkpointSha256: index === 1 ? h('7') : null,
      historyHeadSha256: index === 1 ? h('6') : h('c'),
      nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
      observedAt: `2026-08-21T00:00:0${String(index * 2 + 2)}.000Z`,
      contentSha256: h('0'),
    } as const;
    const hostAttestation = {
      ...attestationCandidate,
      contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
    };
    const receipt = sealProcedureCompoundLeafReceipt({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_receipt',
      eventId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      recipeKind: kind,
      leafId: leaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      previousReceiptSha256,
      preStateSha256: sealedRecipe.stateChainSha256s[index]!,
      postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
      historyHeadSha256: attestationCandidate.historyHeadSha256,
      nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
      checkpointSha256: attestationCandidate.checkpointSha256,
      historyProof: proof,
      hostAttestationSha256: hostAttestation.contentSha256,
      recordedAt: attestationCandidate.observedAt,
    });
    previousReceiptSha256 = receipt.receiptSha256;
    return {
      intent,
      receipt,
      hostAttestation,
      trustedHostAttestationSha256: hostAttestation.contentSha256,
    };
  });
  const trustedReplay = {
    ...raw,
    recipe: sealedRecipe,
    currentState: next,
    leafProgress: evidence.map(({ intent, receipt }) => ({
      leafId: intent.leafId,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      receiptSha256: receipt.receiptSha256,
    })),
  };
  const resolver = {
    decisionReceipt: decision,
    trustedDecisionConsumptionEvent,
    resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) => evidence[order - 1]!,
  };
  const event = {
    formatVersion: '1.0.0',
    kind: 'compound_transition',
    eventId: randomUUID(),
    sequence: 2,
    compoundId: sealedRecipe.compoundId,
    authorizationOperationId: operationId,
    previousEventSha256: h('a'),
    previous: {
      status: previous.status,
      inProgressLeafId: null,
      historyHeadSha256: previous.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: null,
    },
    next: {
      status: next.status,
      inProgressLeafId: null,
      historyHeadSha256: next.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: next.integritySha256,
    },
    observedFreshBaseline: false,
    observedFreshFinal: false,
    recordedAt: '2026-08-21T00:00:07.000Z',
  } as const;
  const context = {
    compoundId: sealedRecipe.compoundId,
    previousCheckpointSha256: null,
    nextCheckpointSha256: null,
    previousTerminalObservationSha256: null,
    nextTerminalObservationSha256: next.integritySha256,
    trustedPreviousEventSequence: 1,
    trustedPreviousEventSha256: h('a'),
    replay: trustedReplay,
    transitionDecisionReceipt: null,
    trustedConsumptionEvent: null,
    terminalObservation: null,
    replayEvidenceResolver: resolver,
  };
  return { previous, next, event, context, resolver, evidence, trustedReplay };
}

function forwardCompletionEvidence() {
  const raw = replay('forward');
  const decisionNonce = 'forward_completion_nonce_1';
  const previousCandidate = procedureCompoundCurrentStateSchema.parse({
    ...raw.currentState,
    status: 'intent_recorded',
    lifecycleState: 'object_baseline',
    mode: 'OBJECT',
    historyLock: 'held',
    historyContinuity: 'same_live_session',
    nativeHistoryLossRecorded: false,
    inProgressLeafId: null,
    permittedHistoryTransitions: [],
    stateSha256: raw.recipe.stateChainSha256s[0],
  });
  const decision = {
    formatVersion: '1.0.0',
    decisionId: raw.recipe.decisionReceiptId,
    nonce: decisionNonce,
    issuedAt: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T00:05:00.000Z',
    kind: 'BlenderExecutionDecisionReceipt',
    acceptedContentSha256: raw.planContentSha256,
    acceptedContentKind: 'plan',
    replayId: raw.recipe.replayId,
    target: raw.target,
    blenderSessionId: previousCandidate.blenderSessionUid,
    documentFingerprintSha256: previousCandidate.documentFingerprintSha256,
    actionCatalogVersion: raw.actionCatalogVersion,
    interactionCatalogVersion: raw.interactionCatalogVersion,
  } as const;
  let sealedRecipe = sealProcedureCompoundRecipe({
    ...raw.recipe,
    decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
    decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    decisionStartStateProjectionSha256:
      computeProcedureCompoundDecisionStartStateProjectionSha256(previousCandidate),
  });
  const previous = sealProcedureCompoundCurrentState(previousCandidate, sealedRecipe);
  sealedRecipe = sealProcedureCompoundRecipe({
    ...sealedRecipe,
    decisionCurrentStateIntegritySha256: previous.integritySha256,
  });
  const next = sealProcedureCompoundCurrentState(raw.currentState, sealedRecipe);
  sealedRecipe = sealProcedureCompoundRecipe({
    ...sealedRecipe,
    decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
    decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
  });
  const operationId = randomUUID();
  const decisionBinding = {
    acceptedContentSha256: decision.acceptedContentSha256,
    acceptedContentKind: decision.acceptedContentKind,
    replayId: decision.replayId,
    adapterId: decision.target.adapterId,
    instanceId: decision.target.instanceId,
    blenderSessionId: decision.blenderSessionId,
    documentFingerprintSha256: decision.documentFingerprintSha256,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
  };
  const trustedDecisionConsumptionEvent = {
    formatVersion: '1.0.0',
    eventId: randomUUID(),
    sequence: 0,
    kind: 'blender_decision_consumed',
    credentialId: decision.decisionId,
    singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    operationId,
    bindingSha256: computeProtocolCanonicalJsonSha256({
      decisionSha256: computeProtocolCanonicalJsonSha256(decision),
      binding: decisionBinding,
    }),
    consumedAt: decision.issuedAt,
  } as const;
  let previousReceiptSha256: string | null = null;
  const evidence = sealedRecipe.leaves.map((leaf, index) => {
    const order = (index + 1) as 1 | 2 | 3;
    const intent = procedureCompoundLeafIntentSchema.parse({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_intent',
      eventId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      recipeKind: 'forward',
      leafId: leaf.leafId,
      order,
      historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
      preStateSha256: sealedRecipe.stateChainSha256s[index],
      expectedPostStateSha256: sealedRecipe.stateChainSha256s[index + 1],
      previousReceiptSha256,
      recordedAt: `2026-08-21T00:00:0${String(index * 2 + 1)}.000Z`,
    });
    const proof = index === 1 ? historyProof('poke_native_checkpoint') : null;
    const attestationCandidate = {
      formatVersion: '1.0.0',
      kind: 'compound_leaf_host_attestation',
      attestationId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      replayId: sealedRecipe.replayId,
      leafId: leaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      preStateSha256: sealedRecipe.stateChainSha256s[index]!,
      postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
      historyProof: proof,
      checkpointSha256: index === 1 ? h('7') : null,
      historyHeadSha256: index === 1 ? h('6') : h('c'),
      nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
      observedAt: `2026-08-21T00:00:0${String(index * 2 + 2)}.000Z`,
      contentSha256: h('0'),
    } as const;
    const hostAttestation = {
      ...attestationCandidate,
      contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
    };
    const receipt = sealProcedureCompoundLeafReceipt({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_receipt',
      eventId: randomUUID(),
      compoundId: sealedRecipe.compoundId,
      recipeKind: 'forward',
      leafId: leaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      previousReceiptSha256,
      preStateSha256: sealedRecipe.stateChainSha256s[index]!,
      postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
      historyHeadSha256: attestationCandidate.historyHeadSha256,
      nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
      checkpointSha256: attestationCandidate.checkpointSha256,
      historyProof: proof,
      hostAttestationSha256: hostAttestation.contentSha256,
      recordedAt: attestationCandidate.observedAt,
    });
    previousReceiptSha256 = receipt.receiptSha256;
    return {
      intent,
      receipt,
      hostAttestation,
      trustedHostAttestationSha256: hostAttestation.contentSha256,
    };
  });
  const trustedReplay = {
    ...raw,
    recipe: sealedRecipe,
    currentState: next,
    leafProgress: evidence.map(({ intent, receipt }) => ({
      leafId: intent.leafId,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      receiptSha256: receipt.receiptSha256,
    })),
  };
  const resolver = {
    decisionReceipt: decision,
    trustedDecisionConsumptionEvent,
    resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) => evidence[order - 1]!,
  };
  const event = {
    formatVersion: '1.0.0',
    kind: 'compound_transition',
    eventId: randomUUID(),
    sequence: 2,
    compoundId: sealedRecipe.compoundId,
    authorizationOperationId: operationId,
    previousEventSha256: h('a'),
    previous: {
      status: previous.status,
      inProgressLeafId: null,
      historyHeadSha256: previous.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: null,
    },
    next: {
      status: next.status,
      inProgressLeafId: null,
      historyHeadSha256: next.historyHeadSha256,
      checkpointSha256: null,
      terminalObservationSha256: next.integritySha256,
    },
    observedFreshBaseline: false,
    observedFreshFinal: false,
    recordedAt: '2026-08-21T00:00:07.000Z',
  } as const;
  const context = {
    compoundId: sealedRecipe.compoundId,
    previousCheckpointSha256: null,
    nextCheckpointSha256: null,
    previousTerminalObservationSha256: null,
    nextTerminalObservationSha256: next.integritySha256,
    trustedPreviousEventSequence: 1,
    trustedPreviousEventSha256: h('a'),
    replay: trustedReplay,
    transitionDecisionReceipt: null,
    trustedConsumptionEvent: null,
    terminalObservation: null,
    replayEvidenceResolver: resolver,
  };
  return { previous, next, event, context, resolver, evidence, trustedReplay };
}

describe('three-leaf compound replay protocol', () => {
  it.each(['forward', 'back', 'redo'] as const)(
    'accepts the exact %s recipe with one decision and three ordered leaves',
    (kind) => {
      expect(procedureCompoundReplaySchema.parse(replay(kind)).recipe.kind).toBe(kind);
    },
  );

  it('rejects missing, reordered, duplicated, or non-continuous leaves', () => {
    const valid = recipe('forward');
    expect(() =>
      procedureCompoundRecipeSchema.parse({ ...valid, leaves: valid.leaves.slice(0, 2) }),
    ).toThrow();
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...valid,
        leaves: [valid.leaves[1], valid.leaves[0], valid.leaves[2]],
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...valid,
        leaves: [
          valid.leaves[0],
          { ...valid.leaves[1], leafId: valid.leaves[0].leafId },
          valid.leaves[2],
        ],
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...valid,
        stateChainSha256s: valid.stateChainSha256s.slice(0, 3),
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...valid,
        leaves: [
          valid.leaves[0],
          { ...valid.leaves[1], historyProof: historyProof('poke_native_checkpoint') },
          valid.leaves[2],
        ],
      }),
    ).toThrow();
  });

  it('domain-separates and verifies recipe and leaf binding hashes', () => {
    const sealed = sealProcedureCompoundRecipe(recipe('back'));
    expect(verifyProcedureCompoundRecipeIntegrity(sealed)).toBe(true);
    expect(
      verifyProcedureCompoundRecipeIntegrity({
        ...sealed,
        decisionStartStateProjectionSha256: h('e'),
      }),
    ).toBe(false);
    expect(
      sealProcedureCompoundRecipe({
        ...sealed,
        decisionStartStateProjectionSha256: h('e'),
      }).compoundContentSha256,
    ).not.toBe(sealed.compoundContentSha256);
    const substituted = {
      ...sealed,
      compoundContentSha256: h('f'),
      orderedLeafBindingSha256s: [h('e'), h('e'), h('e')],
      leaves: sealed.leaves.map((leaf) => ({
        ...leaf,
        compoundContentSha256: h('f'),
        bindingSha256: h('e'),
      })),
    };
    expect(procedureCompoundRecipeSchema.safeParse(substituted).success).toBe(true);
    expect(verifyProcedureCompoundRecipeIntegrity(substituted)).toBe(false);

    const sealedForward = sealProcedureCompoundRecipe(recipe('forward'));
    expect(
      sealProcedureCompoundRecipe({
        ...sealedForward,
        decisionReceiptSha256: h('f'),
      }).compoundContentSha256,
    ).not.toBe(sealedForward.compoundContentSha256);
    expect(
      sealProcedureCompoundRecipe({
        ...sealedForward,
        decisionSingleUseKeySha256: h('f'),
      }).compoundContentSha256,
    ).not.toBe(sealedForward.compoundContentSha256);
  });

  it('verifies the canonical current-state hash instead of trusting a substituted hash', () => {
    const valid = replay('forward');
    const sealedState = sealProcedureCompoundCurrentState(valid.currentState, valid.recipe);
    expect(verifyProcedureCompoundCurrentStateIntegrity(sealedState)).toBe(true);
    expect(
      verifyProcedureCompoundCurrentStateIntegrity({ ...sealedState, topologySha256: h('f') }),
    ).toBe(false);
    const alternateRecipe = procedureCompoundRecipeSchema.parse({
      ...valid.recipe,
      compoundContentSha256: h('e'),
      stateChainSha256s: [h('e'), ...valid.recipe.stateChainSha256s.slice(1)],
      leaves: valid.recipe.leaves.map((leaf) => ({
        ...leaf,
        compoundContentSha256: h('e'),
      })),
    });
    expect(sealProcedureCompoundRecipe(alternateRecipe).compoundContentSha256).not.toBe(
      sealProcedureCompoundRecipe(valid.recipe).compoundContentSha256,
    );
  });

  it('requires typed decision and chained typed leaf evidence at the replay trust boundary', () => {
    const base = replay('forward');
    const decision = {
      formatVersion: '1.0.0',
      decisionId: base.recipe.decisionReceiptId,
      nonce: 'compound_nonce_1234',
      issuedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      kind: 'BlenderExecutionDecisionReceipt',
      acceptedContentSha256: base.planContentSha256,
      acceptedContentKind: 'plan',
      replayId: base.recipe.replayId,
      target: base.target,
      blenderSessionId: base.currentState.blenderSessionUid,
      documentFingerprintSha256: base.currentState.documentFingerprintSha256,
      actionCatalogVersion: base.actionCatalogVersion,
      interactionCatalogVersion: base.interactionCatalogVersion,
    } as const;
    const sealedRecipe = sealProcedureCompoundRecipe({
      ...base.recipe,
      decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
      decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    });
    const sealedState = sealProcedureCompoundCurrentState(
      {
        ...base.currentState,
        compoundId: sealedRecipe.compoundId,
        replayId: sealedRecipe.replayId,
        compoundContentSha256: sealedRecipe.compoundContentSha256,
        historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
      },
      sealedRecipe,
    );
    const decisionBinding = {
      acceptedContentSha256: decision.acceptedContentSha256,
      acceptedContentKind: decision.acceptedContentKind,
      replayId: decision.replayId,
      adapterId: decision.target.adapterId,
      instanceId: decision.target.instanceId,
      blenderSessionId: decision.blenderSessionId,
      documentFingerprintSha256: decision.documentFingerprintSha256,
      actionCatalogVersion: decision.actionCatalogVersion,
      interactionCatalogVersion: decision.interactionCatalogVersion,
    };
    const trustedDecisionConsumptionEvent = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      sequence: 0,
      kind: 'blender_decision_consumed',
      credentialId: decision.decisionId,
      singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
      operationId: randomUUID(),
      bindingSha256: computeProtocolCanonicalJsonSha256({
        decisionSha256: computeProtocolCanonicalJsonSha256(decision),
        binding: decisionBinding,
      }),
      consumedAt: decision.issuedAt,
    } as const;

    let previousReceiptSha256: string | null = null;
    const typedEvidence = sealedRecipe.leaves.map((leaf, index) => {
      const order = (index + 1) as 1 | 2 | 3;
      const intent = procedureCompoundLeafIntentSchema.parse({
        formatVersion: '1.0.0',
        kind: 'compound_leaf_intent',
        eventId: randomUUID(),
        compoundId: sealedRecipe.compoundId,
        recipeKind: 'forward',
        leafId: leaf.leafId,
        order,
        historyLockTokenSha256: sealedRecipe.historyLockTokenSha256,
        preStateSha256: sealedRecipe.stateChainSha256s[index],
        expectedPostStateSha256: sealedRecipe.stateChainSha256s[index + 1],
        previousReceiptSha256,
        recordedAt: `2026-08-21T00:00:0${String(index * 2 + 1)}.000Z`,
      });
      const proof = index === 1 ? historyProof('poke_native_checkpoint') : null;
      const attestationCandidate = {
        formatVersion: '1.0.0',
        kind: 'compound_leaf_host_attestation',
        attestationId: randomUUID(),
        compoundId: sealedRecipe.compoundId,
        replayId: sealedRecipe.replayId,
        leafId: leaf.leafId,
        order,
        intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
        preStateSha256: sealedRecipe.stateChainSha256s[index]!,
        postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
        historyProof: proof,
        checkpointSha256: index === 1 ? h('7') : null,
        historyHeadSha256: index === 1 ? h('6') : h('c'),
        nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
        observedAt: `2026-08-21T00:00:0${String(index * 2 + 2)}.000Z`,
        contentSha256: h('0'),
      } as const;
      const hostAttestation = {
        ...attestationCandidate,
        contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
      };
      const receipt = sealProcedureCompoundLeafReceipt({
        formatVersion: '1.0.0',
        kind: 'compound_leaf_receipt',
        eventId: randomUUID(),
        compoundId: sealedRecipe.compoundId,
        recipeKind: 'forward',
        leafId: leaf.leafId,
        order,
        intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
        previousReceiptSha256,
        preStateSha256: sealedRecipe.stateChainSha256s[index]!,
        postStateSha256: sealedRecipe.stateChainSha256s[index + 1]!,
        historyHeadSha256: index === 1 ? h('6') : h('c'),
        nativeUndoRedoOperationCount: leaf.nativeUndoRedoOperationCount,
        checkpointSha256: index === 1 ? h('7') : null,
        historyProof: proof,
        hostAttestationSha256: hostAttestation.contentSha256,
        recordedAt: `2026-08-21T00:00:0${String(index * 2 + 2)}.000Z`,
      });
      previousReceiptSha256 = receipt.receiptSha256;
      return {
        intent,
        receipt,
        hostAttestation,
        trustedHostAttestationSha256: hostAttestation.contentSha256,
      };
    });
    const trustedReplay = {
      ...base,
      recipe: sealedRecipe,
      currentState: sealedState,
      leafProgress: typedEvidence.map(({ intent, receipt }) => ({
        leafId: intent.leafId,
        intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
        receiptSha256: receipt.receiptSha256,
      })),
    };
    const resolver = {
      decisionReceipt: decision,
      trustedDecisionConsumptionEvent,
      resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) => typedEvidence[order - 1]!,
    };
    expect(verifyProcedureCompoundReplayIntegrity(trustedReplay, resolver)).toBe(true);
    expect(
      verifyProcedureCompoundReplayIntegrity(trustedReplay, {
        ...resolver,
        resolveLeafEvidence: () => null,
      }),
    ).toBe(false);
    const wrongSessionDecision = { ...decision, blenderSessionId: 'another-session' };
    const wrongSessionBinding = {
      ...decisionBinding,
      blenderSessionId: wrongSessionDecision.blenderSessionId,
    };
    const wrongSessionConsumption = {
      ...trustedDecisionConsumptionEvent,
      bindingSha256: computeProtocolCanonicalJsonSha256({
        decisionSha256: computeProtocolCanonicalJsonSha256(wrongSessionDecision),
        binding: wrongSessionBinding,
      }),
    };
    const wrongSessionReplay = {
      ...trustedReplay,
      recipe: sealProcedureCompoundRecipe({
        ...trustedReplay.recipe,
        decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(wrongSessionDecision),
      }),
    };
    expect(
      verifyProcedureCompoundReplayIntegrity(wrongSessionReplay, {
        ...resolver,
        decisionReceipt: wrongSessionDecision,
        trustedDecisionConsumptionEvent: wrongSessionConsumption,
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundReplayIntegrity(
        {
          ...trustedReplay,
          recipe: { ...trustedReplay.recipe, decisionSingleUseKeySha256: h('e') },
        },
        resolver,
      ),
    ).toBe(false);
    expect(
      verifyProcedureCompoundReplayIntegrity(trustedReplay, {
        ...resolver,
        decisionReceipt: { ...decision, acceptedContentSha256: h('e') },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundReplayIntegrity(trustedReplay, {
        ...resolver,
        trustedDecisionConsumptionEvent: {
          ...trustedDecisionConsumptionEvent,
          kind: 'blender_history_transition_consumed',
        },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundReplayIntegrity(
        {
          ...trustedReplay,
          leafProgress: trustedReplay.leafProgress.map((progress, index) =>
            index === 1 ? { ...progress, receiptSha256: h('f') } : progress,
          ),
        },
        resolver,
      ),
    ).toBe(false);

    const recoveryState = sealProcedureCompoundCurrentState(
      procedureCompoundCurrentStateSchema.parse({
        ...trustedReplay.currentState,
        status: 'recovery_required',
        lifecycleState: 'unknown',
        mode: 'UNKNOWN',
        historyLock: 'held',
        historyContinuity: 'same_live_session',
        nativeHistoryLossRecorded: false,
        inProgressLeafId: sealedRecipe.leaves[2].leafId,
        permittedHistoryTransitions: [],
      }),
      sealedRecipe,
    );
    const partialReplay = {
      ...trustedReplay,
      currentState: recoveryState,
      leafProgress: trustedReplay.leafProgress.map((progress, index) =>
        index === 2 ? { ...progress, receiptSha256: null } : progress,
      ),
    };
    const partialResolver = {
      ...resolver,
      resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) =>
        order === 3
          ? {
              intent: typedEvidence[2]!.intent,
              receipt: null,
              hostAttestation: null,
              trustedHostAttestationSha256: null,
            }
          : typedEvidence[order - 1]!,
    };
    expect(verifyProcedureCompoundReplayIntegrity(partialReplay, partialResolver)).toBe(true);
    expect(
      procedureCompoundReplaySchema.safeParse({
        ...partialReplay,
        currentState: sealProcedureCompoundCurrentState(
          {
            ...partialReplay.currentState,
            inProgressLeafId: sealedRecipe.leaves[0].leafId,
          },
          sealedRecipe,
        ),
      }).success,
    ).toBe(false);
    expect(
      procedureCompoundReplaySchema.safeParse({
        ...partialReplay,
        currentState: trustedReplay.currentState,
      }).success,
    ).toBe(false);
    expect(
      verifyProcedureCompoundReplayIntegrity(partialReplay, {
        ...partialResolver,
        resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) =>
          order === 3 ? typedEvidence[2]! : typedEvidence[order - 1]!,
      }),
    ).toBe(false);
  });

  it('binds a Back receipt to exactly one native operation and the middle-leaf checkpoint', () => {
    const sealed = sealProcedureCompoundRecipe(recipe('back'));
    const middle = sealed.leaves[1];
    const intent = procedureCompoundLeafIntentSchema.parse({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_intent',
      eventId: randomUUID(),
      compoundId: sealed.compoundId,
      recipeKind: 'back',
      leafId: middle.leafId,
      order: 2,
      historyLockTokenSha256: sealed.historyLockTokenSha256,
      preStateSha256: sealed.stateChainSha256s[1],
      expectedPostStateSha256: sealed.stateChainSha256s[2],
      previousReceiptSha256: h('1'),
      recordedAt: '2026-08-21T00:00:00.000Z',
    });
    const proof = historyProof('native_undo_once');
    const attestationCandidate = {
      formatVersion: '1.0.0',
      kind: 'compound_leaf_host_attestation',
      attestationId: randomUUID(),
      compoundId: sealed.compoundId,
      replayId: sealed.replayId,
      leafId: middle.leafId,
      order: 2,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      preStateSha256: sealed.stateChainSha256s[1],
      postStateSha256: sealed.stateChainSha256s[2],
      historyProof: proof,
      checkpointSha256: h('7'),
      historyHeadSha256: h('6'),
      nativeUndoRedoOperationCount: 1,
      observedAt: '2026-08-21T00:00:01.000Z',
      contentSha256: h('0'),
    } as const;
    const hostAttestation = {
      ...attestationCandidate,
      contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
    };
    const boundReceipt = sealProcedureCompoundLeafReceipt({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_receipt',
      eventId: randomUUID(),
      compoundId: sealed.compoundId,
      recipeKind: 'back',
      leafId: middle.leafId,
      order: 2,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      previousReceiptSha256: h('1'),
      preStateSha256: sealed.stateChainSha256s[1],
      postStateSha256: sealed.stateChainSha256s[2],
      historyHeadSha256: h('6'),
      nativeUndoRedoOperationCount: 1,
      checkpointSha256: h('7'),
      historyProof: proof,
      hostAttestationSha256: hostAttestation.contentSha256,
      recordedAt: '2026-08-21T00:00:01.000Z',
    });
    expect(
      verifyProcedureCompoundLeafReceipt(
        boundReceipt,
        intent,
        sealed,
        hostAttestation,
        hostAttestation.contentSha256,
      ),
    ).toBe(true);
    const wrongCheckpoint = sealProcedureCompoundLeafReceipt({
      ...boundReceipt,
      checkpointSha256: h('f'),
    });
    expect(
      verifyProcedureCompoundLeafReceipt(
        wrongCheckpoint,
        intent,
        sealed,
        hostAttestation,
        hostAttestation.contentSha256,
      ),
    ).toBe(false);
    const tamperedProofReceipt = sealProcedureCompoundLeafReceipt({
      ...boundReceipt,
      historyHeadSha256: h('e'),
      historyProof: { ...proof, historyHeadAfterSha256: h('e') },
    });
    expect(
      verifyProcedureCompoundLeafReceipt(
        tamperedProofReceipt,
        intent,
        sealed,
        hostAttestation,
        hostAttestation.contentSha256,
      ),
    ).toBe(false);
    const wrongHistoryHead = sealProcedureCompoundLeafReceipt({
      ...boundReceipt,
      historyHeadSha256: h('f'),
    });
    expect(
      verifyProcedureCompoundLeafReceipt(
        wrongHistoryHead,
        intent,
        sealed,
        hostAttestation,
        hostAttestation.contentSha256,
      ),
    ).toBe(false);
    expect(
      procedureCompoundLeafReceiptSchema.safeParse({ ...boundReceipt, order: 1 }).success,
    ).toBe(false);
  });

  it('rejects Object-mode history claims and zero/two Undo operations', () => {
    const forward = recipe('forward');
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...forward,
        objectModeUndoRedoTransactionProven: true,
      }),
    ).toThrow();
    const back = recipe('back');
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...back,
        leaves: [
          back.leaves[0],
          { ...back.leaves[1], nativeUndoRedoOperationCount: 0 },
          back.leaves[2],
        ],
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundRecipeSchema.parse({
        ...back,
        leaves: [
          back.leaves[0],
          { ...back.leaves[1], nativeUndoRedoOperationCount: 2 },
          back.leaves[2],
        ],
      }),
    ).toThrow();
  });

  it('rejects compound, leaf-binding, lock, and current-state hash substitution', () => {
    const valid = replay('forward');
    expect(() =>
      procedureCompoundReplaySchema.parse({
        ...valid,
        recipe: { ...valid.recipe, orderedLeafBindingSha256s: [h('f'), h('d'), h('e')] },
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundReplaySchema.parse({
        ...valid,
        recipe: {
          ...valid.recipe,
          leaves: [
            valid.recipe.leaves[0],
            { ...valid.recipe.leaves[1], historyLockTokenSha256: h('f') },
            valid.recipe.leaves[2],
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundReplaySchema.parse({
        ...valid,
        currentState: { ...valid.currentState, stateSha256: h('f') },
      }),
    ).toThrow();
    const first = sealedTransitionReplay('forward');
    const second = sealedTransitionReplay('forward');
    expect(
      procedureCompoundReplaySchema.safeParse({ ...first, currentState: second.currentState })
        .success,
    ).toBe(false);
  });

  it.each(['back', 'redo'] as const)(
    'requires the complete consumed %s replay evidence for locked history completion',
    (kind) => {
      const trusted = lockedHistoryTransitionEvidence(kind);
      expect(
        verifyProcedureCompoundTransition(
          trusted.previous,
          trusted.next,
          trusted.event,
          trusted.context,
        ),
      ).toBe(true);
      expect(
        verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
          ...trusted.context,
          replayEvidenceResolver: null,
        }),
      ).toBe(false);
      expect(
        verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
          ...trusted.context,
          replayEvidenceResolver: {
            ...trusted.resolver,
            trustedDecisionConsumptionEvent: {
              ...trusted.resolver.trustedDecisionConsumptionEvent,
              kind: 'blender_decision_consumed',
            },
          },
        }),
      ).toBe(false);
      expect(
        verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
          ...trusted.context,
          replayEvidenceResolver: {
            ...trusted.resolver,
            resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) => {
              const item = trusted.evidence[order - 1]!;
              return order === 2
                ? {
                    ...item,
                    hostAttestation: {
                      ...item.hostAttestation,
                      topologySha256: h('e'),
                    },
                  }
                : item;
            },
          },
        }),
      ).toBe(false);
      const transplanted = lockedHistoryTransitionEvidence(kind);
      expect(
        verifyProcedureCompoundTransition(
          transplanted.previous,
          trusted.next,
          trusted.event,
          trusted.context,
        ),
      ).toBe(false);
      const substitutedPrevious = sealProcedureCompoundCurrentState(
        { ...trusted.previous, topologySha256: h('e') },
        trusted.trustedReplay.recipe,
      );
      expect(
        computeProcedureCompoundDecisionStartStateProjectionSha256(substitutedPrevious),
      ).not.toBe(trusted.trustedReplay.recipe.decisionStartStateProjectionSha256);
      expect(
        verifyProcedureCompoundTransition(
          substitutedPrevious,
          trusted.next,
          trusted.event,
          trusted.context,
        ),
      ).toBe(false);
    },
  );

  it('requires complete consumed Forward replay evidence for locked completion', () => {
    const trusted = forwardCompletionEvidence();
    expect(
      verifyProcedureCompoundTransition(
        trusted.previous,
        trusted.next,
        trusted.event,
        trusted.context,
      ),
    ).toBe(true);
    expect(
      verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
        ...trusted.context,
        replayEvidenceResolver: null,
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
        ...trusted.context,
        replayEvidenceResolver: {
          ...trusted.resolver,
          decisionReceipt: null,
        },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
        ...trusted.context,
        replayEvidenceResolver: {
          ...trusted.resolver,
          trustedDecisionConsumptionEvent: null,
        },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(trusted.previous, trusted.next, trusted.event, {
        ...trusted.context,
        replayEvidenceResolver: {
          ...trusted.resolver,
          resolveLeafEvidence: (_leafId: string, order: 1 | 2 | 3) => {
            const item = trusted.evidence[order - 1]!;
            return order === 2
              ? {
                  ...item,
                  hostAttestation: null,
                }
              : item;
          },
        },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(
        trusted.previous,
        trusted.next,
        { ...trusted.event, authorizationOperationId: randomUUID() },
        trusted.context,
      ),
    ).toBe(false);
    const substitutedPrevious = sealProcedureCompoundCurrentState(
      { ...trusted.previous, topologySha256: h('e') },
      trusted.trustedReplay.recipe,
    );
    expect(
      computeProcedureCompoundDecisionStartStateProjectionSha256(substitutedPrevious),
    ).not.toBe(trusted.trustedReplay.recipe.decisionStartStateProjectionSha256);
    expect(
      verifyProcedureCompoundTransition(
        substitutedPrevious,
        trusted.next,
        trusted.event,
        trusted.context,
      ),
    ).toBe(false);
  });

  it('makes history_lost permanent and permits only observed-baseline abandon', () => {
    const valid = sealedTransitionReplay('forward');
    const lost = sealProcedureCompoundCurrentState(
      procedureCompoundCurrentStateSchema.parse({
        ...valid.currentState,
        status: 'history_lost',
        lifecycleState: 'unknown',
        mode: 'UNKNOWN',
        historyLock: 'quarantined',
        historyContinuity: 'lost_permanently',
        nativeHistoryLossRecorded: true,
        permittedHistoryTransitions: ['abandon_baseline'],
      }),
      valid.recipe,
    );
    expect(procedureCompoundCurrentStateSchema.parse(lost).status).toBe('history_lost');
    expect(() =>
      procedureCompoundCurrentStateSchema.parse({
        ...lost,
        permittedHistoryTransitions: ['back', 'unlock_final'],
      }),
    ).toThrow();
    expect(() =>
      procedureCompoundCurrentStateSchema.parse({ ...lost, historyLock: 'released' }),
    ).toThrow();

    const abandoned = sealProcedureCompoundCurrentState(
      procedureCompoundCurrentStateSchema.parse({
        ...lost,
        status: 'abandoned_baseline',
        lifecycleState: 'object_baseline',
        mode: 'OBJECT',
        historyLock: 'released',
        permittedHistoryTransitions: [],
      }),
      valid.recipe,
    );
    const { event, context } = terminalTransitionEvidence(
      valid,
      lost,
      abandoned,
      'abandon_baseline',
    );
    expect(verifyProcedureCompoundTransition(lost, abandoned, event, context)).toBe(true);
    expect(
      verifyProcedureCompoundTransition(lost, abandoned, event, {
        ...context,
        trustedConsumptionEvent: {
          ...(context.trustedConsumptionEvent as object),
          operationId: randomUUID(),
        },
      }),
    ).toBe(false);
    const driftedLostAbandon = sealProcedureCompoundCurrentState(
      {
        ...abandoned,
        topologySha256: h('e'),
      },
      valid.recipe,
    );
    const driftedLostEvidence = terminalTransitionEvidence(
      valid,
      lost,
      driftedLostAbandon,
      'abandon_baseline',
    );
    expect(
      verifyProcedureCompoundTransition(
        lost,
        driftedLostAbandon,
        driftedLostEvidence.event,
        driftedLostEvidence.context,
      ),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(lost, abandoned, event, {
        ...context,
        terminalObservation: {
          ...(context.terminalObservation as object),
          topologySha256: h('e'),
        },
      }),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(
        lost,
        abandoned,
        { ...event, observedFreshBaseline: false },
        context,
      ),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(lost, abandoned, { ...event, sequence: 5 }, context),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(
        lost,
        { ...abandoned, status: 'unlocked_final' },
        event,
        context,
      ),
    ).toBe(false);

    const finalReplay = sealedTransitionReplay('forward');
    const finalLocked = finalReplay.currentState;
    const unlocked = sealProcedureCompoundCurrentState(
      procedureCompoundCurrentStateSchema.parse({
        ...finalLocked,
        status: 'unlocked_final',
        historyLock: 'released',
        permittedHistoryTransitions: [],
      }),
      finalReplay.recipe,
    );
    const { event: unlockEvent, context: unlockContext } = terminalTransitionEvidence(
      finalReplay,
      finalLocked,
      unlocked,
      'unlock_final',
    );
    expect(
      verifyProcedureCompoundTransition(finalLocked, unlocked, unlockEvent, unlockContext),
    ).toBe(true);
    expect(
      verifyProcedureCompoundTransition(
        finalLocked,
        unlocked,
        { ...unlockEvent, observedFreshFinal: false },
        unlockContext,
      ),
    ).toBe(false);
    const markerDriftUnlock = sealProcedureCompoundCurrentState(
      {
        ...unlocked,
        nativeHistoryMarkerSha256: h('e'),
      },
      finalReplay.recipe,
    );
    const markerDriftEvidence = terminalTransitionEvidence(
      finalReplay,
      finalLocked,
      markerDriftUnlock,
      'unlock_final',
    );
    expect(
      verifyProcedureCompoundTransition(
        finalLocked,
        markerDriftUnlock,
        markerDriftEvidence.event,
        markerDriftEvidence.context,
      ),
    ).toBe(false);
    const driftedUnlock = sealProcedureCompoundCurrentState(
      {
        ...unlocked,
        selectionSha256: h('e'),
      },
      finalReplay.recipe,
    );
    const driftedUnlockEvidence = terminalTransitionEvidence(
      finalReplay,
      finalLocked,
      driftedUnlock,
      'unlock_final',
    );
    expect(
      verifyProcedureCompoundTransition(
        finalLocked,
        driftedUnlock,
        driftedUnlockEvidence.event,
        driftedUnlockEvidence.context,
      ),
    ).toBe(false);

    const restoredReplay = sealedTransitionReplay('back');
    const restored = restoredReplay.currentState;
    const abandonedLive = sealProcedureCompoundCurrentState(
      procedureCompoundCurrentStateSchema.parse({
        ...restored,
        status: 'abandoned_baseline',
        historyLock: 'released',
        permittedHistoryTransitions: [],
      }),
      restoredReplay.recipe,
    );
    const { event: liveEvent, context: liveContext } = terminalTransitionEvidence(
      restoredReplay,
      restored,
      abandonedLive,
      'abandon_baseline',
    );
    expect(verifyProcedureCompoundTransition(restored, abandonedLive, liveEvent, liveContext)).toBe(
      true,
    );
    const driftedLiveAbandon = sealProcedureCompoundCurrentState(
      {
        ...abandonedLive,
        objectPointerSha256: h('e'),
      },
      restoredReplay.recipe,
    );
    const driftedLiveEvidence = terminalTransitionEvidence(
      restoredReplay,
      restored,
      driftedLiveAbandon,
      'abandon_baseline',
    );
    expect(
      verifyProcedureCompoundTransition(
        restored,
        driftedLiveAbandon,
        driftedLiveEvidence.event,
        driftedLiveEvidence.context,
      ),
    ).toBe(false);
    expect(
      verifyProcedureCompoundTransition(
        restored,
        abandonedLive,
        { ...liveEvent, observedFreshBaseline: false },
        liveContext,
      ),
    ).toBe(false);
  });
});
