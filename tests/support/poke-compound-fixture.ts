import {
  computeProcedureCompoundDecisionReceiptSha256,
  computeProcedureCompoundDecisionSingleUseKeySha256,
  computeProcedureCompoundHostAttestationSha256,
  computeProcedureCompoundLeafIntentSha256,
  computeProcedureCompoundRecordedBaselineSha256,
  computeProtocolCanonicalJsonSha256,
  procedureCompoundLeafIntentSchema,
  sealProcedureCompoundCurrentState,
  sealProcedureCompoundLeafReceipt,
  sealProcedureCompoundRecipe,
  type CompanionPokeCompoundCreateRequest,
  type CompanionPokeCompoundTerminalEvidence,
  type ProcedureCompoundReplay,
} from '@operatingline/protocol';

const hash = (character: string) => character.repeat(64);

export interface PokeCompoundTransportFixture {
  readonly request: CompanionPokeCompoundCreateRequest;
  readonly terminalReplay: ProcedureCompoundReplay;
  readonly terminalEvidence: CompanionPokeCompoundTerminalEvidence;
}

export function createPokeCompoundTransportFixture(
  options: {
    readonly instanceId?: string;
    readonly blenderSessionUid?: string;
    readonly requestId?: string;
  } = {},
): PokeCompoundTransportFixture {
  const compoundId = '72000000-0000-4000-8000-000000000001';
  const replayId = '72000000-0000-4000-8000-000000000002';
  const instanceId = options.instanceId ?? '72000000-0000-4000-8000-000000000003';
  const decisionId = '72000000-0000-4000-8000-000000000004';
  const requestId = options.requestId ?? '72000000-0000-4000-8000-000000000005';
  const blenderSessionUid = options.blenderSessionUid ?? 'session-uid';
  const historyLockTokenSha256 = hash('b');
  const planContentSha256 = hash('f');
  const baselineCandidate = {
    blenderProcessIdentitySha256: hash('1'),
    blenderSessionUid,
    documentFingerprintSha256: hash('2'),
    nativeHistoryMarkerSha256: hash('3'),
    historyHeadSha256: hash('5'),
    objectIdentitySha256: hash('4'),
    meshIdentitySha256: hash('5'),
    objectPointerSha256: hash('6'),
    meshPointerSha256: hash('7'),
    meshDatablockSha256: hash('8'),
    topologySha256: hash('9'),
    selectionSha256: hash('a'),
    stateSha256: hash('1'),
    contentSha256: hash('0'),
  };
  const decision = {
    formatVersion: '1.0.0',
    decisionId,
    nonce: 'poke_transport_single_use_nonce',
    issuedAt: '2026-08-24T00:00:00.000Z',
    expiresAt: '2026-08-24T00:05:00.000Z',
    kind: 'BlenderExecutionDecisionReceipt',
    acceptedContentSha256: planContentSha256,
    acceptedContentKind: 'plan',
    replayId,
    target: { adapterId: 'blender', instanceId },
    blenderSessionId: blenderSessionUid,
    documentFingerprintSha256: hash('2'),
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.50.0',
  } as const;
  const recipe = sealProcedureCompoundRecipe({
    compoundId,
    replayId,
    compoundContentSha256: hash('0'),
    historyLockTokenSha256,
    decisionReceiptId: decisionId,
    decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
    decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    decisionStartStateProjectionSha256: hash('c'),
    decisionCurrentStateIntegritySha256: hash('d'),
    stateChainSha256s: [hash('1'), hash('2'), hash('3'), hash('4')],
    orderedLeafBindingSha256s: [hash('c'), hash('d'), hash('e')],
    objectModeUndoRedoTransactionProven: false,
    recordedObjectBaseline: {
      ...baselineCandidate,
      contentSha256: computeProcedureCompoundRecordedBaselineSha256(baselineCandidate),
    },
    kind: 'forward',
    decisionKind: 'BlenderExecutionDecisionReceipt',
    expectedStartStatus: 'intent_recorded',
    expectedTerminalStatus: 'forward_applied_locked',
    leaves: [
      {
        leafId: 'forward.enter',
        bindingSha256: hash('c'),
        compoundContentSha256: hash('0'),
        historyLockTokenSha256,
        order: 1,
        kind: 'enter_edit',
        fromMode: 'OBJECT',
        toMode: 'EDIT_MESH',
        modelChanging: false,
        nativeUndoRedoOperationCount: 0,
        historyObligation: null,
      },
      {
        leafId: 'forward.poke',
        bindingSha256: hash('d'),
        compoundContentSha256: hash('0'),
        historyLockTokenSha256,
        order: 2,
        kind: 'poke',
        fromMode: 'EDIT_MESH',
        toMode: 'EDIT_MESH',
        modelChanging: true,
        nativeUndoRedoOperationCount: 0,
        historyObligation: {
          kind: 'poke_native_checkpoint',
          modeScope: 'edit_middle_only',
          objectModeUndoRedoClaim: false,
          expectedHistoryHeadBeforeSha256: hash('5'),
          expectedCheckpointSha256: null,
        },
      },
      {
        leafId: 'forward.exit',
        bindingSha256: hash('e'),
        compoundContentSha256: hash('0'),
        historyLockTokenSha256,
        order: 3,
        kind: 'exit_edit',
        fromMode: 'EDIT_MESH',
        toMode: 'OBJECT',
        modelChanging: false,
        nativeUndoRedoOperationCount: 0,
        historyObligation: null,
      },
    ],
  } as never);
  const initialCurrentState = sealProcedureCompoundCurrentState(
    {
      compoundId,
      replayId,
      compoundContentSha256: recipe.compoundContentSha256,
      historyLockTokenSha256,
      blenderProcessIdentitySha256: hash('1'),
      blenderSessionUid,
      documentFingerprintSha256: hash('2'),
      nativeHistoryMarkerSha256: hash('3'),
      historyHeadSha256: hash('5'),
      objectIdentitySha256: hash('4'),
      meshIdentitySha256: hash('5'),
      objectPointerSha256: hash('6'),
      meshPointerSha256: hash('7'),
      meshDatablockSha256: hash('8'),
      topologySha256: hash('9'),
      selectionSha256: hash('a'),
      stateSha256: recipe.stateChainSha256s[0],
      integritySha256: hash('0'),
      status: 'intent_recorded',
      lifecycleState: 'object_baseline',
      mode: 'OBJECT',
      historyLock: 'held',
      historyContinuity: 'same_live_session',
      nativeHistoryLossRecorded: false,
      inProgressLeafId: null,
      permittedHistoryTransitions: [],
    },
    recipe,
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
    eventId: '72000000-0000-4000-8000-000000000006',
    sequence: 0,
    kind: 'blender_decision_consumed',
    credentialId: decisionId,
    singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    operationId: '72000000-0000-4000-8000-000000000007',
    bindingSha256: computeProtocolCanonicalJsonSha256({
      decisionSha256: computeProtocolCanonicalJsonSha256(decision),
      binding: decisionBinding,
    }),
    consumedAt: decision.issuedAt,
  } as const;
  const initialReplay: ProcedureCompoundReplay = {
    formatVersion: '1.0.0',
    planContentSha256,
    target: decision.target,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
    recipe,
    currentState: initialCurrentState,
    leafProgress: recipe.leaves.map((leaf) => ({
      leafId: leaf.leafId,
      intentSha256: null,
      receiptSha256: null,
    })) as ProcedureCompoundReplay['leafProgress'],
  };

  let previousReceiptSha256: string | null = null;
  const leaves = recipe.leaves.map((recipeLeaf, index) => {
    const order = (index + 1) as 1 | 2 | 3;
    const intent = procedureCompoundLeafIntentSchema.parse({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_intent',
      eventId: `72000000-0000-4000-8000-00000000001${order}`,
      compoundId,
      recipeKind: 'forward',
      leafId: recipeLeaf.leafId,
      order,
      historyLockTokenSha256,
      preStateSha256: recipe.stateChainSha256s[index],
      expectedPostStateSha256: recipe.stateChainSha256s[index + 1],
      previousReceiptSha256,
      recordedAt: `2026-08-24T00:00:0${index * 2 + 1}.000Z`,
    });
    const historyProof =
      index === 1
        ? {
            kind: 'poke_native_checkpoint' as const,
            modeScope: 'edit_middle_only' as const,
            objectModeUndoRedoClaim: false as const,
            editBaselineIdentitySha256: hash('a'),
            editFinalIdentitySha256: hash('b'),
            objectPointerSha256: hash('6'),
            meshPointerSha256: hash('7'),
            meshDatablockSha256: hash('8'),
            baselineTopologySha256: hash('1'),
            finalTopologySha256: hash('2'),
            baselineSelectionSha256: hash('3'),
            finalSelectionSha256: hash('4'),
            historyHeadBeforeSha256: hash('5'),
            historyHeadAfterSha256: hash('6'),
            checkpointSha256: hash('7'),
            journalHeadSha256: hash('8'),
          }
        : null;
    const attestationCandidate = {
      formatVersion: '1.0.0' as const,
      kind: 'compound_leaf_host_attestation' as const,
      attestationId: `72000000-0000-4000-8000-00000000002${order}`,
      compoundId,
      replayId,
      leafId: recipeLeaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      preStateSha256: recipe.stateChainSha256s[index]!,
      postStateSha256: recipe.stateChainSha256s[index + 1]!,
      historyProof,
      checkpointSha256: index === 1 ? hash('7') : null,
      historyHeadSha256: index === 1 ? hash('6') : hash('c'),
      nativeUndoRedoOperationCount: 0,
      observedAt: `2026-08-24T00:00:0${index * 2 + 2}.000Z`,
      contentSha256: hash('0'),
    };
    const hostAttestation = {
      ...attestationCandidate,
      contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
    };
    const receipt = sealProcedureCompoundLeafReceipt({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_receipt',
      eventId: `72000000-0000-4000-8000-00000000003${order}`,
      compoundId,
      recipeKind: 'forward',
      leafId: recipeLeaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      previousReceiptSha256,
      preStateSha256: recipe.stateChainSha256s[index]!,
      postStateSha256: recipe.stateChainSha256s[index + 1]!,
      historyHeadSha256: index === 1 ? hash('6') : hash('c'),
      nativeUndoRedoOperationCount: 0,
      checkpointSha256: index === 1 ? hash('7') : null,
      historyProof,
      hostAttestationSha256: hostAttestation.contentSha256,
      recordedAt: `2026-08-24T00:00:0${index * 2 + 2}.000Z`,
    });
    previousReceiptSha256 = receipt.receiptSha256;
    return {
      intent,
      receipt,
      hostAttestation,
      trustedHostAttestationSha256: hostAttestation.contentSha256,
    };
  }) as CompanionPokeCompoundTerminalEvidence['leaves'];
  const terminalCurrentState = sealProcedureCompoundCurrentState(
    {
      ...initialCurrentState,
      status: 'forward_applied_locked',
      lifecycleState: 'object_final',
      mode: 'OBJECT',
      historyHeadSha256: hash('c'),
      stateSha256: recipe.stateChainSha256s[3],
      permittedHistoryTransitions: ['back', 'unlock_final'],
    },
    recipe,
  );
  const terminalReplay: ProcedureCompoundReplay = {
    ...initialReplay,
    currentState: terminalCurrentState,
    leafProgress: leaves.map(({ intent, receipt }) => ({
      leafId: intent.leafId,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      receiptSha256: receipt.receiptSha256,
    })) as ProcedureCompoundReplay['leafProgress'],
  };
  return {
    request: {
      formatVersion: '1.0.0',
      requestId,
      replay: initialReplay,
      decisionReceipt: decision,
      trustedDecisionConsumptionEvent,
    },
    terminalReplay,
    terminalEvidence: { leaves },
  };
}
