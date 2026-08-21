import type {
  ProcedureCompoundCurrentState,
  ProcedureCompoundReplay,
  ProcedureCompoundReplayEvidenceResolver,
} from '@operatingline/protocol';
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
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  classifyPokeCompoundHistoryContinuity,
  createPokeCompoundHistoryLockOwnerReader,
  pokeCompoundHistoryLockEventType,
  validatePokeFacesCompoundReplayProof,
  validatePokeCompoundDecisionEvidence,
} from '../../../services/orchestrator/src/procedure-replay.js';

function lockedState(): ProcedureCompoundCurrentState {
  const hash = (character: string) => character.repeat(64);
  return {
    compoundId: '10000000-0000-4000-8000-000000000001',
    replayId: '10000000-0000-4000-8000-000000000002',
    compoundContentSha256: hash('1'),
    historyLockTokenSha256: hash('2'),
    blenderProcessIdentitySha256: hash('3'),
    blenderSessionUid: 'session-1',
    documentFingerprintSha256: hash('4'),
    nativeHistoryMarkerSha256: hash('5'),
    historyHeadSha256: hash('6'),
    objectIdentitySha256: hash('7'),
    meshIdentitySha256: hash('8'),
    objectPointerSha256: hash('9'),
    meshPointerSha256: hash('a'),
    meshDatablockSha256: hash('b'),
    topologySha256: hash('c'),
    selectionSha256: hash('d'),
    stateSha256: hash('e'),
    integritySha256: hash('f'),
    status: 'forward_applied_locked',
    lifecycleState: 'object_final',
    mode: 'OBJECT',
    historyLock: 'held',
    historyContinuity: 'same_live_session',
    nativeHistoryLossRecorded: false,
    inProgressLeafId: null,
    permittedHistoryTransitions: ['back', 'unlock_final'],
  };
}

const h = (character: string) => character.repeat(64);

function trustedForwardProof(): {
  replay: ProcedureCompoundReplay;
  evidence: ProcedureCompoundReplayEvidenceResolver;
} {
  const compoundId = '20000000-0000-4000-8000-000000000001';
  const replayId = '20000000-0000-4000-8000-000000000002';
  const instanceId = '20000000-0000-4000-8000-000000000003';
  const decisionId = '20000000-0000-4000-8000-000000000004';
  const historyLockTokenSha256 = h('b');
  const planContentSha256 = h('f');
  const baselineCandidate = {
    blenderProcessIdentitySha256: h('1'),
    blenderSessionUid: 'session-uid',
    documentFingerprintSha256: h('2'),
    nativeHistoryMarkerSha256: h('3'),
    historyHeadSha256: h('5'),
    objectIdentitySha256: h('4'),
    meshIdentitySha256: h('5'),
    objectPointerSha256: h('6'),
    meshPointerSha256: h('7'),
    meshDatablockSha256: h('8'),
    topologySha256: h('9'),
    selectionSha256: h('a'),
    stateSha256: h('d'),
    contentSha256: h('0'),
  };
  const proof = {
    kind: 'poke_native_checkpoint',
    modeScope: 'edit_middle_only',
    objectModeUndoRedoClaim: false,
    editBaselineIdentitySha256: h('a'),
    editFinalIdentitySha256: h('b'),
    objectPointerSha256: h('6'),
    meshPointerSha256: h('7'),
    meshDatablockSha256: h('8'),
    baselineTopologySha256: h('1'),
    finalTopologySha256: h('2'),
    baselineSelectionSha256: h('3'),
    finalSelectionSha256: h('4'),
    historyHeadBeforeSha256: h('5'),
    historyHeadAfterSha256: h('6'),
    checkpointSha256: h('7'),
    journalHeadSha256: h('8'),
  } as const;
  const decision = {
    formatVersion: '1.0.0',
    decisionId,
    nonce: 'poke_forward_single_use_nonce',
    issuedAt: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T00:05:00.000Z',
    kind: 'BlenderExecutionDecisionReceipt',
    acceptedContentSha256: planContentSha256,
    acceptedContentKind: 'plan',
    replayId,
    target: { adapterId: 'blender', instanceId },
    blenderSessionId: 'session-uid',
    documentFingerprintSha256: h('2'),
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.40.0',
  } as const;
  const compoundContentSha256 = h('0');
  const leaf = (leafId: string, bindingSha256: string) => ({
    leafId,
    bindingSha256,
    compoundContentSha256,
    historyLockTokenSha256,
  });
  const recipe = sealProcedureCompoundRecipe({
    compoundId,
    replayId,
    compoundContentSha256,
    historyLockTokenSha256,
    decisionReceiptId: decisionId,
    decisionReceiptSha256: computeProcedureCompoundDecisionReceiptSha256(decision),
    decisionSingleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    decisionStartStateProjectionSha256: h('c'),
    decisionCurrentStateIntegritySha256: h('d'),
    stateChainSha256s: [h('1'), h('2'), h('3'), h('4')],
    orderedLeafBindingSha256s: [h('c'), h('d'), h('e')],
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
        ...leaf('forward.enter', h('c')),
        order: 1,
        kind: 'enter_edit',
        fromMode: 'OBJECT',
        toMode: 'EDIT_MESH',
        modelChanging: false,
        nativeUndoRedoOperationCount: 0,
        historyObligation: null,
      },
      {
        ...leaf('forward.poke', h('d')),
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
          expectedHistoryHeadBeforeSha256: h('5'),
          expectedCheckpointSha256: null,
        },
      },
      {
        ...leaf('forward.exit', h('e')),
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
  const currentState = sealProcedureCompoundCurrentState(
    {
      compoundId,
      replayId,
      compoundContentSha256: recipe.compoundContentSha256,
      historyLockTokenSha256,
      status: 'forward_applied_locked',
      lifecycleState: 'object_final',
      mode: 'OBJECT',
      historyLock: 'held',
      historyContinuity: 'same_live_session',
      nativeHistoryLossRecorded: false,
      inProgressLeafId: null,
      permittedHistoryTransitions: ['back', 'unlock_final'],
      blenderProcessIdentitySha256: h('1'),
      blenderSessionUid: 'session-uid',
      documentFingerprintSha256: h('2'),
      nativeHistoryMarkerSha256: h('3'),
      historyHeadSha256: h('4'),
      objectIdentitySha256: h('4'),
      meshIdentitySha256: h('5'),
      objectPointerSha256: h('6'),
      meshPointerSha256: h('7'),
      meshDatablockSha256: h('8'),
      topologySha256: h('9'),
      selectionSha256: h('a'),
      stateSha256: recipe.stateChainSha256s[3],
      integritySha256: h('0'),
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
    eventId: '20000000-0000-4000-8000-000000000005',
    sequence: 0,
    kind: 'blender_decision_consumed',
    credentialId: decisionId,
    singleUseKeySha256: computeProcedureCompoundDecisionSingleUseKeySha256(decision),
    operationId: '20000000-0000-4000-8000-000000000006',
    bindingSha256: computeProtocolCanonicalJsonSha256({
      decisionSha256: computeProtocolCanonicalJsonSha256(decision),
      binding: decisionBinding,
    }),
    consumedAt: decision.issuedAt,
  };
  let previousReceiptSha256: string | null = null;
  const typedEvidence = recipe.leaves.map((recipeLeaf, index) => {
    const order = (index + 1) as 1 | 2 | 3;
    const intent = procedureCompoundLeafIntentSchema.parse({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_intent',
      eventId: `20000000-0000-4000-8000-00000000001${order}`,
      compoundId,
      recipeKind: 'forward',
      leafId: recipeLeaf.leafId,
      order,
      historyLockTokenSha256,
      preStateSha256: recipe.stateChainSha256s[index],
      expectedPostStateSha256: recipe.stateChainSha256s[index + 1],
      previousReceiptSha256,
      recordedAt: `2026-08-21T00:00:0${index * 2 + 1}.000Z`,
    });
    const historyProof = index === 1 ? proof : null;
    const attestationCandidate = {
      formatVersion: '1.0.0',
      kind: 'compound_leaf_host_attestation',
      attestationId: `20000000-0000-4000-8000-00000000002${order}`,
      compoundId,
      replayId,
      leafId: recipeLeaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      preStateSha256: recipe.stateChainSha256s[index]!,
      postStateSha256: recipe.stateChainSha256s[index + 1]!,
      historyProof,
      checkpointSha256: index === 1 ? h('7') : null,
      historyHeadSha256: index === 1 ? h('6') : h('c'),
      nativeUndoRedoOperationCount: 0,
      observedAt: `2026-08-21T00:00:0${index * 2 + 2}.000Z`,
      contentSha256: h('0'),
    } as const;
    const hostAttestation = {
      ...attestationCandidate,
      contentSha256: computeProcedureCompoundHostAttestationSha256(attestationCandidate),
    };
    const receipt = sealProcedureCompoundLeafReceipt({
      formatVersion: '1.0.0',
      kind: 'compound_leaf_receipt',
      eventId: `20000000-0000-4000-8000-00000000003${order}`,
      compoundId,
      recipeKind: 'forward',
      leafId: recipeLeaf.leafId,
      order,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      previousReceiptSha256,
      preStateSha256: recipe.stateChainSha256s[index]!,
      postStateSha256: recipe.stateChainSha256s[index + 1]!,
      historyHeadSha256: index === 1 ? h('6') : h('c'),
      nativeUndoRedoOperationCount: 0,
      checkpointSha256: index === 1 ? h('7') : null,
      historyProof,
      hostAttestationSha256: hostAttestation.contentSha256,
      recordedAt: `2026-08-21T00:00:0${index * 2 + 2}.000Z`,
    });
    previousReceiptSha256 = receipt.receiptSha256;
    return {
      intent,
      receipt,
      hostAttestation,
      trustedHostAttestationSha256: hostAttestation.contentSha256,
    };
  });
  const replay = {
    formatVersion: '1.0.0',
    planContentSha256,
    target: decision.target,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
    recipe,
    currentState,
    leafProgress: typedEvidence.map(({ intent, receipt }) => ({
      leafId: intent.leafId,
      intentSha256: computeProcedureCompoundLeafIntentSha256(intent),
      receiptSha256: receipt.receiptSha256,
    })),
  } as ProcedureCompoundReplay;
  return {
    replay,
    evidence: {
      decisionReceipt: decision,
      trustedDecisionConsumptionEvent,
      resolveLeafEvidence: (_leafId, order) => typedEvidence[order - 1]!,
    },
  };
}

describe('Poke Faces compound replay boundary', () => {
  it('accepts a fully bound Forward decision, consumption, intent, receipt, and middle proof', () => {
    const trusted = trustedForwardProof();
    expect(validatePokeFacesCompoundReplayProof(trusted)).toEqual(trusted.replay);
  });

  it('revalidates the host-emitted Forward decision and trusted consumption projection', () => {
    const trusted = trustedForwardProof();
    const receipt = trusted.evidence.decisionReceipt as Record<string, unknown>;
    validatePokeCompoundDecisionEvidence({
      transition: 'forward',
      receipt,
      consumption: trusted.evidence.trustedDecisionConsumptionEvent,
      currentState: trusted.replay.currentState,
      planContentSha256: trusted.replay.planContentSha256,
      target: trusted.replay.target as { adapterId: 'blender'; instanceId: string },
      actionCatalogVersion: trusted.replay.actionCatalogVersion,
      interactionCatalogVersion: trusted.replay.interactionCatalogVersion,
      binding: {
        acceptedContentSha256: trusted.replay.planContentSha256,
        acceptedContentKind: 'plan',
        replayId: trusted.replay.recipe.replayId,
        adapterId: trusted.replay.target.adapterId,
        instanceId: trusted.replay.target.instanceId,
        blenderSessionId: trusted.replay.currentState.blenderSessionUid,
        documentFingerprintSha256: trusted.replay.currentState.documentFingerprintSha256,
        actionCatalogVersion: trusted.replay.actionCatalogVersion,
        interactionCatalogVersion: trusted.replay.interactionCatalogVersion,
      },
    });
    expect(() =>
      validatePokeCompoundDecisionEvidence({
        transition: 'forward',
        receipt,
        consumption: trusted.evidence.trustedDecisionConsumptionEvent,
        currentState: trusted.replay.currentState,
        planContentSha256: h('0'),
        target: trusted.replay.target as { adapterId: 'blender'; instanceId: string },
        actionCatalogVersion: trusted.replay.actionCatalogVersion,
        interactionCatalogVersion: trusted.replay.interactionCatalogVersion,
        binding: {},
      }),
    ).toThrow();
  });

  it('reads one durable compound lock owner and observes its terminal release', () => {
    const trusted = trustedForwardProof();
    const events: Array<{ sequence: number; eventType: string; payload: unknown }> = [
      { sequence: 1, eventType: pokeCompoundHistoryLockEventType, payload: trusted.replay },
    ];
    const reader = createPokeCompoundHistoryLockOwnerReader({
      listExecutionEventsByTypes: (types) =>
        events.filter((event) => types.includes(event.eventType)),
    });
    expect(reader('blender', trusted.replay.target.instanceId)).toBe(
      trusted.replay.recipe.compoundId,
    );
    const released = sealProcedureCompoundCurrentState(
      {
        ...trusted.replay.currentState,
        status: 'unlocked_final',
        lifecycleState: 'object_final',
        mode: 'OBJECT',
        historyLock: 'released',
        inProgressLeafId: null,
        permittedHistoryTransitions: [],
      },
      trusted.replay.recipe,
    );
    events.push({
      sequence: 2,
      eventType: pokeCompoundHistoryLockEventType,
      payload: { ...trusted.replay, currentState: released },
    });
    expect(reader('blender', trusted.replay.target.instanceId)).toBeNull();

    events.push({
      sequence: 3,
      eventType: pokeCompoundHistoryLockEventType,
      payload: { ...trusted.replay, currentState: { malformed: true } },
    });
    expect(reader('blender', trusted.replay.target.instanceId)).toBe(
      trusted.replay.recipe.compoundId,
    );

    events.push({
      sequence: 4,
      eventType: pokeCompoundHistoryLockEventType,
      payload: {
        ...trusted.replay,
        currentState: { ...released, historyHeadSha256: h('f') },
      },
    });
    expect(reader('blender', trusted.replay.target.instanceId)).toBe(
      trusted.replay.recipe.compoundId,
    );
  });

  it('distinguishes same-session restart, conflict, and permanent history loss', () => {
    const recorded = lockedState();
    expect(classifyPokeCompoundHistoryContinuity(recorded, { ...recorded })).toBe(
      'same_live_session',
    );
    expect(
      classifyPokeCompoundHistoryContinuity(recorded, {
        ...recorded,
        historyHeadSha256: '0'.repeat(64),
      }),
    ).toBe('history_conflict');
    expect(classifyPokeCompoundHistoryContinuity(recorded, null)).toBe('history_lost');
    expect(
      classifyPokeCompoundHistoryContinuity(recorded, {
        ...recorded,
        blenderProcessIdentitySha256: '0'.repeat(64),
      }),
    ).toBe('history_lost');
    expect(
      classifyPokeCompoundHistoryContinuity(recorded, {
        ...recorded,
        nativeHistoryMarkerSha256: '0'.repeat(64),
      }),
    ).toBe('history_lost');
    expect(
      classifyPokeCompoundHistoryContinuity(recorded, {
        ...recorded,
        blenderSessionUid: undefined,
      }),
    ).toBe('history_lost');
  });

  it('rejects a monolithic or incomplete replay before making a compound proof claim', () => {
    expect(() =>
      validatePokeFacesCompoundReplayProof({
        replay: {
          formatVersion: '1.0.0',
          target: { adapterId: 'blender' },
          recipe: { kind: 'forward', leaves: [{ kind: 'poke' }] },
        } as unknown as ProcedureCompoundReplay,
        evidence: {
          decisionReceipt: null,
          trustedDecisionConsumptionEvent: null,
          resolveLeafEvidence: () => null,
        },
      }),
    ).toThrow();
  });
});
