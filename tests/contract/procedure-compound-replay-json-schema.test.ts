import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderHistoryTransitionDecisionReceiptSchema,
  computeProcedureCompoundRecordedBaselineSha256,
  procedureCompoundReplaySchema,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const hash = 'a'.repeat(64);
const readSchema = (name: string): object =>
  JSON.parse(readFileSync(resolve('protocol/schemas/v1', name), 'utf8')) as object;

function compoundReplay() {
  const compoundId = randomUUID();
  const replayId = randomUUID();
  const leaf = (order: 1 | 2 | 3, kind: 'enter_edit' | 'poke' | 'exit_edit') => ({
    leafId: `forward.${kind}`,
    order,
    kind,
    bindingSha256: hash,
    compoundContentSha256: hash,
    historyLockTokenSha256: hash,
    fromMode: order === 1 ? 'OBJECT' : 'EDIT_MESH',
    toMode: order === 3 ? 'OBJECT' : 'EDIT_MESH',
    modelChanging: order === 2,
    nativeUndoRedoOperationCount: 0,
    historyObligation:
      order === 2
        ? {
            kind: 'poke_native_checkpoint',
            modeScope: 'edit_middle_only',
            objectModeUndoRedoClaim: false,
            expectedHistoryHeadBeforeSha256: hash,
            expectedCheckpointSha256: null,
          }
        : null,
  });
  const leaves = [leaf(1, 'enter_edit'), leaf(2, 'poke'), leaf(3, 'exit_edit')];
  const baselineCandidate = {
    blenderProcessIdentitySha256: hash,
    blenderSessionUid: 'session-uid',
    documentFingerprintSha256: hash,
    nativeHistoryMarkerSha256: hash,
    historyHeadSha256: hash,
    objectIdentitySha256: hash,
    meshIdentitySha256: hash,
    objectPointerSha256: hash,
    meshPointerSha256: hash,
    meshDatablockSha256: hash,
    topologySha256: hash,
    selectionSha256: hash,
    stateSha256: hash,
    contentSha256: hash,
  };
  return {
    formatVersion: '1.0.0',
    planContentSha256: hash,
    target: { adapterId: 'blender', instanceId: randomUUID() },
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.40.0',
    recipe: {
      compoundId,
      replayId,
      compoundContentSha256: hash,
      historyLockTokenSha256: hash,
      decisionReceiptId: randomUUID(),
      decisionReceiptSha256: hash,
      decisionSingleUseKeySha256: hash,
      decisionStartStateProjectionSha256: hash,
      stateChainSha256s: [hash, hash, hash, hash],
      orderedLeafBindingSha256s: [hash, hash, hash],
      objectModeUndoRedoTransactionProven: false,
      kind: 'forward',
      decisionKind: 'BlenderExecutionDecisionReceipt',
      expectedStartStatus: 'intent_recorded',
      expectedTerminalStatus: 'forward_applied_locked',
      decisionCurrentStateIntegritySha256: hash,
      recordedObjectBaseline: {
        ...baselineCandidate,
        contentSha256: computeProcedureCompoundRecordedBaselineSha256(baselineCandidate),
      },
      leaves,
    },
    currentState: {
      compoundId,
      replayId,
      compoundContentSha256: hash,
      historyLockTokenSha256: hash,
      status: 'forward_applied_locked',
      lifecycleState: 'object_final',
      mode: 'OBJECT',
      historyLock: 'held',
      historyContinuity: 'same_live_session',
      nativeHistoryLossRecorded: false,
      inProgressLeafId: null,
      permittedHistoryTransitions: ['back', 'unlock_final'],
      blenderProcessIdentitySha256: hash,
      blenderSessionUid: 'session-uid',
      documentFingerprintSha256: hash,
      nativeHistoryMarkerSha256: hash,
      historyHeadSha256: hash,
      objectIdentitySha256: hash,
      meshIdentitySha256: hash,
      objectPointerSha256: hash,
      meshPointerSha256: hash,
      meshDatablockSha256: hash,
      topologySha256: hash,
      selectionSha256: hash,
      stateSha256: hash,
      integritySha256: hash,
    },
    leafProgress: leaves.map((item) => ({
      leafId: item.leafId,
      intentSha256: hash,
      receiptSha256: hash,
    })),
  };
}

describe('compound replay and closed interaction JSON schemas', () => {
  it('round-trips the strict three-leaf compound shape', async () => {
    const replay = compoundReplay();
    const cases = [
      { value: replay, accepted: true },
      { value: { ...replay, authorized: true }, accepted: false },
      {
        value: {
          ...replay,
          recipe: { ...replay.recipe, leaves: replay.recipe.leaves.slice(0, 2) },
        },
        accepted: false,
      },
      {
        value: {
          ...replay,
          recipe: {
            ...replay.recipe,
            leaves: [
              replay.recipe.leaves[0],
              { ...replay.recipe.leaves[1], nativeUndoRedoOperationCount: 2 },
              replay.recipe.leaves[2],
            ],
          },
        },
        accepted: false,
      },
      {
        value: {
          ...replay,
          recipe: {
            ...replay.recipe,
            leaves: [
              replay.recipe.leaves[0],
              { ...replay.recipe.leaves[1], preStateSha256: hash },
              replay.recipe.leaves[2],
            ],
          },
        },
        accepted: false,
      },
      {
        value: {
          ...replay,
          leafProgress: replay.leafProgress.map((progress, index) =>
            index === 1 ? { ...progress, receiptSha256: null } : progress,
          ),
        },
        accepted: false,
      },
      {
        value: {
          ...replay,
          currentState: {
            ...replay.currentState,
            status: 'history_lost',
            lifecycleState: 'unknown',
            mode: 'UNKNOWN',
            historyLock: 'quarantined',
            historyContinuity: 'lost_permanently',
            nativeHistoryLossRecorded: true,
            inProgressLeafId: replay.recipe.leaves[1].leafId,
            permittedHistoryTransitions: ['back', 'unlock_final'],
          },
        },
        accepted: false,
      },
      {
        value: {
          ...replay,
          currentState: {
            ...replay.currentState,
            status: 'recovery_required',
            lifecycleState: 'unknown',
            mode: 'UNKNOWN',
            historyLock: 'released',
            inProgressLeafId: replay.recipe.leaves[1].leafId,
            permittedHistoryTransitions: [],
          },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureCompoundReplaySchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(readSchema('procedure-compound-replay.schema.json'), cases);
  });

  it('routes dynamic compound-binding equality through the semantic validation gate', async () => {
    const replay = compoundReplay();
    const substituted = {
      ...replay,
      currentState: { ...replay.currentState, compoundId: randomUUID() },
    };
    const schema = readSchema('procedure-compound-replay.schema.json') as Record<string, unknown>;
    expect(schema['$comment']).toMatch(/Cross-field compound\/replay/u);
    expect(procedureCompoundReplaySchema.safeParse(substituted).success).toBe(false);
    await validatePublicJsonSchemaCases(schema, [{ value: substituted, accepted: true }]);
  });

  it('round-trips only the seven closed interaction variants', async () => {
    await validatePublicJsonSchemaCases(readSchema('interaction-operation.schema.json'), [
      { value: { kind: 'invoke_menu', menuHostId: 'VIEW3D_MT_edit_mesh_faces' }, accepted: true },
      {
        value: {
          kind: 'set_f9_control',
          expectedOperatorId: 'mesh.inset',
          controlHostId: 'mesh.inset.thickness',
          typedValue: 0.25,
        },
        accepted: true,
      },
      { value: { kind: 'invoke_operator', operatorId: 'mesh.inset' }, accepted: false },
      {
        value: { kind: 'send_shortcut', shortcutId: 'blender.edit.inset', keys: ['I'] },
        accepted: false,
      },
    ]);
  });

  it('publishes the distinct history-transition decision receipt', async () => {
    const decision = {
      formatVersion: '1.0.0',
      decisionId: randomUUID(),
      nonce: 'history_nonce_1234',
      issuedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      kind: 'BlenderHistoryTransitionDecisionReceipt',
      transition: 'back',
      compoundId: randomUUID(),
      replayId: randomUUID(),
      target: { adapterId: 'blender', instanceId: randomUUID() },
      blenderProcessIdentitySha256: hash,
      blenderSessionUid: 'session-uid',
      documentFingerprintSha256: hash,
      compoundContentSha256: hash,
      historyLockTokenSha256: hash,
      currentStateSha256: hash,
      expectedHistoryHeadSha256: hash,
      expectedStatus: 'forward_applied_locked',
      terminalObservationSha256: null,
      nativeHistoryLossRecorded: false,
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.40.0',
    };
    await validatePublicJsonSchemaCases(
      readSchema('blender-history-transition-decision-receipt.schema.json'),
      [
        { value: decision, accepted: true },
        { value: { ...decision, transition: 'redo' }, accepted: false },
        { value: { ...decision, publicKey: 'forbidden' }, accepted: false },
      ],
    );
  });

  it('documents timestamp ordering as a semantic gate beyond structural AJV validation', async () => {
    const schema = readSchema('blender-history-transition-decision-receipt.schema.json') as Record<
      string,
      unknown
    >;
    expect(schema['$comment']).toMatch(/Zod semantic validation gate/u);
    const decision = {
      formatVersion: '1.0.0',
      decisionId: randomUUID(),
      nonce: 'history_nonce_1234',
      issuedAt: '2026-08-21T00:05:00.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      kind: 'BlenderHistoryTransitionDecisionReceipt',
      transition: 'back',
      compoundId: randomUUID(),
      replayId: randomUUID(),
      target: { adapterId: 'blender', instanceId: randomUUID() },
      blenderProcessIdentitySha256: hash,
      blenderSessionUid: 'session-uid',
      documentFingerprintSha256: hash,
      compoundContentSha256: hash,
      historyLockTokenSha256: hash,
      currentStateSha256: hash,
      expectedHistoryHeadSha256: hash,
      expectedStatus: 'forward_applied_locked',
      terminalObservationSha256: null,
      nativeHistoryLossRecorded: false,
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.40.0',
    };
    expect(blenderHistoryTransitionDecisionReceiptSchema.safeParse(decision).success).toBe(false);
    await validatePublicJsonSchemaCases(schema, [{ value: decision, accepted: true }]);
  });
});
