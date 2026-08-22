import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  decisionLifecycleEventSchema,
  localExecutionDecisionReceiptSchema,
  trainingRunDecisionReceiptSchema,
} from '@operatingline/protocol';

const hash = 'b'.repeat(64);
const common = {
  formatVersion: '1.0.0',
  decisionId: randomUUID(),
  nonce: 'nonce_nonce_nonce_1',
  issuedAt: '2026-08-21T00:00:00.000Z',
  expiresAt: '2026-08-21T00:05:00.000Z',
};

describe('local execution decision receipts', () => {
  it('keeps Blender and training decisions outside external authority kinds', () => {
    const blender = blenderExecutionDecisionReceiptSchema.parse({
      ...common,
      kind: 'BlenderExecutionDecisionReceipt',
      acceptedContentSha256: hash,
      acceptedContentKind: 'proposal',
      replayId: randomUUID(),
      target: { adapterId: 'blender', instanceId: randomUUID() },
      blenderSessionId: 'session',
      documentFingerprintSha256: hash,
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.40.0',
    });
    expect(localExecutionDecisionReceiptSchema.parse(blender).kind).toBe(
      'BlenderExecutionDecisionReceipt',
    );
    expect(
      blenderExecutionDecisionReceiptSchema.safeParse({ ...blender, extra: true }).success,
    ).toBe(false);
  });

  it('binds history transitions to the exact live compound lock and terminal state', () => {
    const transition = blenderHistoryTransitionDecisionReceiptSchema.parse({
      ...common,
      decisionId: randomUUID(),
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
    });
    expect(localExecutionDecisionReceiptSchema.parse(transition).kind).toBe(
      'BlenderHistoryTransitionDecisionReceipt',
    );
    expect(
      blenderHistoryTransitionDecisionReceiptSchema.safeParse({
        ...transition,
        transition: 'redo',
      }).success,
    ).toBe(false);
    expect(
      blenderHistoryTransitionDecisionReceiptSchema.safeParse({
        ...transition,
        transition: 'abandon_baseline',
        expectedStatus: 'history_lost',
        terminalObservationSha256: hash,
        nativeHistoryLossRecorded: true,
      }).success,
    ).toBe(true);
    expect(
      blenderHistoryTransitionDecisionReceiptSchema.safeParse({
        ...transition,
        transition: 'unlock_final',
        terminalObservationSha256: null,
      }).success,
    ).toBe(false);
  });

  it('requires a training-use validation receipt bound to training export', () => {
    const receipt = {
      formatVersion: '1.0.0',
      receiptId: randomUUID(),
      authorityKind: 'TrainingUseAuthorization',
      authorityId: randomUUID(),
      authorityContentSha256: hash,
      signerId: 'signer',
      keyId: 'key',
      registryVersion: 'v1',
      validatedAt: common.issuedAt,
      revocationLogHeadSha256: hash,
      targetSha256: hash,
      sideEffect: 'training_export',
    };
    const decision = trainingRunDecisionReceiptSchema.parse({
      ...common,
      decisionId: randomUUID(),
      kind: 'TrainingRunDecisionReceipt',
      trainingUseValidationReceipt: receipt,
      releasedManifestSha256: hash,
      trainingExportSha256: hash,
      codeSha256: hash,
      configSha256: hash,
      modelFamilySha256: hash,
      runId: randomUUID(),
    });
    expect(decision.trainingUseValidationReceipt.targetSha256).toBe(hash);
    expect(
      trainingRunDecisionReceiptSchema.safeParse({ ...decision, expiresAt: decision.issuedAt })
        .success,
    ).toBe(false);
    expect(
      trainingRunDecisionReceiptSchema.safeParse({
        ...decision,
        trainingUseValidationReceipt: { ...receipt, authorityKind: 'DatasetReleaseAuthorization' },
      }).success,
    ).toBe(false);
  });

  it('records dataset release authorization consumption and final manifest completion', () => {
    const operationId = randomUUID();
    const credentialId = randomUUID();
    expect(
      decisionLifecycleEventSchema.parse({
        formatVersion: '1.0.0',
        eventId: randomUUID(),
        sequence: 4,
        kind: 'dataset_release_authorization_consumed',
        credentialId,
        singleUseKeySha256: hash,
        operationId,
        bindingSha256: hash,
        consumedAt: '2026-08-23T00:01:00.000Z',
      }).kind,
    ).toBe('dataset_release_authorization_consumed');
    expect(
      decisionLifecycleEventSchema.parse({
        formatVersion: '1.0.0',
        eventId: randomUUID(),
        sequence: 5,
        kind: 'dataset_release_completed',
        credentialId,
        operationId,
        durableReceiptSha256: hash,
        completedAt: '2026-08-23T00:01:01.000Z',
      }).kind,
    ).toBe('dataset_release_completed');
  });
});
