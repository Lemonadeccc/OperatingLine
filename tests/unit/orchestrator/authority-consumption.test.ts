import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
  type AuthorityValidationReceipt,
  type BlenderExecutionDecisionReceipt,
  type BlenderHistoryTransitionDecisionReceipt,
  type DecisionConsumptionEvent,
  type ProviderCallAuthorization,
  type TrainingRunDecisionReceipt,
  type TrainingUseAuthorization,
} from '@operatingline/protocol';
import {
  AuthorityConsumptionCoordinator,
  AuthorityConsumptionError,
  InMemoryAuthorityConsumptionStore,
  type AppendOnlyAuthorityConsumptionStore,
  type AuthorityCompletionAppendResult,
  type ProviderCallBinding,
} from '../../../services/orchestrator/src/authority-consumption.js';

const h = (value = 'a') => value.repeat(64);
const now = new Date('2026-08-21T12:00:00.000Z');
const signature = {
  signerId: 'operator',
  keyId: 'key',
  algorithm: 'ed25519' as const,
  signature: 'A'.repeat(86),
  signedAt: '2026-08-21T11:00:00.000Z',
};
const contentHash = (value: unknown) =>
  createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');

function providerAuthorization(
  overrides: Partial<ProviderCallAuthorization> = {},
): ProviderCallAuthorization {
  return {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'ProviderCallAuthorization',
    authorityId: randomUUID(),
    issuer: 'operator',
    notBefore: '2026-08-21T11:00:00.000Z',
    expiresAt: '2026-08-21T13:00:00.000Z',
    provider: { providerId: 'provider', descriptorVersion: '1', model: 'model' },
    operation: 'planning_generation',
    generationRequestSha256: h(),
    disclosedDataSha256: h('b'),
    maximumCallCount: 1,
    signature,
    ...overrides,
  };
}

function providerBinding(
  authorization: ProviderCallAuthorization,
  estimatedCost?: ProviderCallBinding['estimatedCost'],
): ProviderCallBinding {
  return {
    provider: authorization.provider,
    operation: authorization.operation,
    generationRequestSha256: authorization.generationRequestSha256,
    disclosedDataSha256: authorization.disclosedDataSha256,
    ...(estimatedCost ? { estimatedCost } : {}),
  };
}

function receipt(
  record: ProviderCallAuthorization | TrainingUseAuthorization,
  sideEffect: 'provider_call' | 'training_export',
): AuthorityValidationReceipt {
  const targetSha256 =
    record.kind === 'ProviderCallAuthorization'
      ? record.generationRequestSha256
      : record.releasedManifestSha256;
  return {
    formatVersion: '1.0.0',
    receiptId: randomUUID(),
    authorityKind: record.kind,
    authorityId: record.authorityId,
    authorityContentSha256: contentHash(authoritySignedContent(record)),
    signerId: 'operator',
    keyId: 'key',
    registryVersion: 'registry-v1',
    validatedAt: now.toISOString(),
    revocationLogHeadSha256: h('c'),
    targetSha256,
    sideEffect,
  };
}

function blenderDecision(nonce = 'single_use_nonce_123'): BlenderExecutionDecisionReceipt {
  return {
    formatVersion: '1.0.0',
    kind: 'BlenderExecutionDecisionReceipt',
    decisionId: randomUUID(),
    nonce,
    issuedAt: '2026-08-21T11:59:00.000Z',
    expiresAt: '2026-08-21T12:01:00.000Z',
    acceptedContentSha256: h(),
    acceptedContentKind: 'proposal',
    replayId: randomUUID(),
    target: { adapterId: 'blender', instanceId: randomUUID() },
    blenderSessionId: 'session',
    documentFingerprintSha256: h('b'),
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.40.0',
  };
}

function historyTransitionDecision(
  nonce = 'history_nonce_1234',
): BlenderHistoryTransitionDecisionReceipt {
  return {
    formatVersion: '1.0.0',
    kind: 'BlenderHistoryTransitionDecisionReceipt',
    decisionId: randomUUID(),
    nonce,
    issuedAt: '2026-08-21T11:59:00.000Z',
    expiresAt: '2026-08-21T12:01:00.000Z',
    transition: 'back',
    compoundId: randomUUID(),
    replayId: randomUUID(),
    target: { adapterId: 'blender', instanceId: randomUUID() },
    blenderProcessIdentitySha256: h(),
    blenderSessionUid: 'session-uid',
    documentFingerprintSha256: h('b'),
    compoundContentSha256: h('c'),
    historyLockTokenSha256: h('d'),
    currentStateSha256: h('e'),
    expectedHistoryHeadSha256: h('f'),
    expectedStatus: 'forward_applied_locked',
    terminalObservationSha256: null,
    nativeHistoryLossRecorded: false,
    actionCatalogVersion: '1.22.0',
    interactionCatalogVersion: '1.40.0',
  };
}

describe('append-only authority consumption', () => {
  it('enforces global event-id uniqueness in the in-memory store', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const eventId = randomUUID();
    const operationId = randomUUID();
    const first = {
      formatVersion: '1.0.0' as const,
      eventId,
      kind: 'blender_decision_consumed' as const,
      credentialId: randomUUID(),
      singleUseKeySha256: h(),
      operationId,
      bindingSha256: h('b'),
      consumedAt: now.toISOString(),
    };
    expect(store.appendConsumptionIfUnused(first).status).toBe('appended');
    expect(
      store.appendConsumptionIfUnused({
        ...first,
        credentialId: randomUUID(),
        singleUseKeySha256: h('c'),
        operationId: randomUUID(),
      }),
    ).toEqual({ status: 'invalid' });
    expect(
      store.appendCompletionIfInFlight({
        formatVersion: '1.0.0',
        eventId,
        kind: 'blender_execution_completed',
        credentialId: first.credentialId,
        operationId,
        durableReceiptSha256: h('d'),
        completedAt: now.toISOString(),
      }),
    ).toEqual({ status: 'invalid' });
    expect(store.readAll()).toHaveLength(1);
    expect(
      new AuthorityConsumptionCoordinator(store, { now: () => now }).stateFor(first.credentialId),
    ).toBeDefined();
  });

  it('atomically permits one Provider claim and requires live verification', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const authorization = providerAuthorization();
    const liveVerifier = { verify: vi.fn(() => receipt(authorization, 'provider_call')) };
    const operationId = randomUUID();
    const first = new AuthorityConsumptionCoordinator(store, { now: () => now });
    const concurrent = new AuthorityConsumptionCoordinator(store, { now: () => now });
    expect(
      first.consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier,
        operationId,
      }).status,
    ).toBe('started');
    expect(() =>
      concurrent.consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier,
        operationId,
      }),
    ).toThrow(AuthorityConsumptionError);
    expect(liveVerifier.verify).toHaveBeenCalledTimes(2);
  });

  it('binds the exact Provider call and enforces cost ceilings and request-level single use', () => {
    const authorization = providerAuthorization({
      costCeiling: { currency: 'USD', minorUnits: 100 },
    });
    const validBinding = providerBinding(authorization, { currency: 'USD', minorUnits: 100 });
    const withoutEstimatedCost = providerBinding(authorization);
    const invalidBindings: ProviderCallBinding[] = [
      { ...validBinding, provider: { ...validBinding.provider, providerId: 'other' } },
      { ...validBinding, provider: { ...validBinding.provider, descriptorVersion: '2' } },
      { ...validBinding, provider: { ...validBinding.provider, model: 'other' } },
      { ...validBinding, operation: 'semantic_replan_generation' },
      { ...validBinding, generationRequestSha256: h('f') },
      { ...validBinding, disclosedDataSha256: h('e') },
      withoutEstimatedCost,
      { ...validBinding, estimatedCost: { currency: 'EUR', minorUnits: 100 } },
      { ...validBinding, estimatedCost: { currency: 'USD', minorUnits: 101 } },
    ];
    for (const binding of invalidBindings) {
      const liveVerifier = { verify: vi.fn(() => receipt(authorization, 'provider_call')) };
      expect(() =>
        new AuthorityConsumptionCoordinator(new InMemoryAuthorityConsumptionStore(), {
          now: () => now,
        }).consumeProviderAuthorization({
          authorization,
          binding,
          liveVerifier,
          operationId: randomUUID(),
        }),
      ).toThrow(/Provider call binding mismatch/);
      expect(liveVerifier.verify).not.toHaveBeenCalled();
    }

    const store = new InMemoryAuthorityConsumptionStore();
    const verifier = { verify: () => receipt(authorization, 'provider_call') };
    new AuthorityConsumptionCoordinator(store, { now: () => now }).consumeProviderAuthorization({
      authorization,
      binding: validBinding,
      liveVerifier: verifier,
      operationId: randomUUID(),
    });
    const secondAuthorization = providerAuthorization({
      generationRequestSha256: authorization.generationRequestSha256,
    });
    expect(() =>
      new AuthorityConsumptionCoordinator(store, { now: () => now }).consumeProviderAuthorization({
        authorization: secondAuthorization,
        binding: providerBinding(secondAuthorization),
        liveVerifier: { verify: () => receipt(secondAuthorization, 'provider_call') },
        operationId: randomUUID(),
      }),
    ).toThrow(/credential_reused/);
  });

  it('reconstructs only the same Provider operation after restart and never relaunches', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const authorization = providerAuthorization();
    const liveVerifier = { verify: vi.fn(() => receipt(authorization, 'provider_call')) };
    const operationId = randomUUID();
    new AuthorityConsumptionCoordinator(store, { now: () => now }).consumeProviderAuthorization({
      authorization,
      binding: providerBinding(authorization),
      liveVerifier,
      operationId,
    });
    const restarted = new AuthorityConsumptionCoordinator(store, {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      resolveDurableCompletion: () => true,
    });
    expect(
      restarted.consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier,
        operationId,
      }).status,
    ).toBe('reconcile_in_flight');
    expect(liveVerifier.verify).toHaveBeenCalledTimes(1);
    restarted.complete({
      credentialId: authorization.authorityId,
      operationId,
      durableReceiptSha256: h('d'),
    });
    const afterCompletion = new AuthorityConsumptionCoordinator(store, { now: () => now });
    expect(
      afterCompletion.consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier,
        operationId,
      }).status,
    ).toBe('completed');
    expect(() =>
      restarted.consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier,
        operationId: randomUUID(),
      }),
    ).toThrow(/credential_reused/);
  });

  it('requires a trusted lower durable receipt before completion and isolates store snapshots', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const authorization = providerAuthorization();
    const operationId = randomUUID();
    const coordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      resolveDurableCompletion: () => false,
    });
    coordinator.consumeProviderAuthorization({
      authorization,
      binding: providerBinding(authorization),
      liveVerifier: { verify: () => receipt(authorization, 'provider_call') },
      operationId,
    });
    expect(() =>
      coordinator.complete({
        credentialId: authorization.authorityId,
        operationId,
        durableReceiptSha256: h('d'),
      }),
    ).toThrow(/completion_receipt_untrusted/);
    const firstRead = store.readAll();
    const secondRead = store.readAll();
    expect(firstRead[0]).not.toBe(secondRead[0]);
    expect(Object.isFrozen(firstRead[0])).toBe(true);
    expect(() => Object.assign(firstRead[0]!, { bindingSha256: h('f') })).toThrow();
    expect(store.readAll()[0]!.bindingSha256).not.toBe(h('f'));
  });

  it('returns recursively frozen claims and independent reconstructed snapshots', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const authorization = providerAuthorization();
    const operationId = randomUUID();
    const claim = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
    }).consumeProviderAuthorization({
      authorization,
      binding: providerBinding(authorization),
      liveVerifier: { verify: () => receipt(authorization, 'provider_call') },
      operationId,
    });
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.consumption)).toBe(true);

    const restarted = new AuthorityConsumptionCoordinator(store, { now: () => now });
    const first = restarted.stateFor(authorization.authorityId)!;
    const second = restarted.stateFor(authorization.authorityId)!;
    expect(first).not.toBe(second);
    expect(first.consumption).not.toBe(second.consumption);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.consumption)).toBe(true);
    expect(() => Object.assign(first.consumption, { bindingSha256: h('f') })).toThrow();
    expect(restarted.stateFor(authorization.authorityId)!.consumption.bindingSha256).not.toBe(
      h('f'),
    );
  });

  it.each([
    ['missing_consumption', 'not_consumed'],
    ['already_completed', 'already_completed'],
    ['operation_conflict', 'operation_mismatch'],
    ['kind_conflict', 'invalid_event_log'],
    ['invalid', 'invalid_event_log'],
  ] as const)('maps completion store outcome %s to %s', (status, expectedCode) => {
    const consumed = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      sequence: 0,
      kind: 'provider_authorization_consumed',
      credentialId: randomUUID(),
      singleUseKeySha256: h('a'),
      operationId: randomUUID(),
      bindingSha256: h('b'),
      consumedAt: now.toISOString(),
    } satisfies DecisionConsumptionEvent;
    const store: AppendOnlyAuthorityConsumptionStore = {
      readAll: () => [consumed],
      appendConsumptionIfUnused: () => ({ status: 'invalid' }),
      appendCompletionIfInFlight: () => ({ status }) as AuthorityCompletionAppendResult,
    };
    const coordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      resolveDurableCompletion: () => true,
    });
    try {
      coordinator.complete({
        credentialId: consumed.credentialId,
        operationId: consumed.operationId,
        durableReceiptSha256: h('c'),
      });
      throw new Error('Expected completion to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorityConsumptionError);
      expect((error as AuthorityConsumptionError).code).toBe(expectedCode);
    }
  });

  it.each([
    ['credential_duplicate', 'credential_reused'],
    ['single_use_key_duplicate', 'credential_reused'],
    ['invalid', 'invalid_event_log'],
  ] as const)('maps consumption store outcome %s to %s', (status, expectedCode) => {
    const authorization = providerAuthorization();
    const store: AppendOnlyAuthorityConsumptionStore = {
      readAll: () => [],
      appendConsumptionIfUnused: () => ({ status }),
      appendCompletionIfInFlight: () => ({ status: 'invalid' }),
    };
    try {
      new AuthorityConsumptionCoordinator(store, { now: () => now }).consumeProviderAuthorization({
        authorization,
        binding: providerBinding(authorization),
        liveVerifier: { verify: () => receipt(authorization, 'provider_call') },
        operationId: randomUUID(),
      });
      throw new Error('Expected consumption to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorityConsumptionError);
      expect((error as AuthorityConsumptionError).code).toBe(expectedCode);
    }
  });

  it('enforces local decision trust, exact binding, expiry, and nonce-level single use', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const first = blenderDecision();
    const binding = {
      acceptedContentSha256: first.acceptedContentSha256,
      acceptedContentKind: first.acceptedContentKind,
      replayId: first.replayId,
      adapterId: first.target.adapterId,
      instanceId: first.target.instanceId,
      blenderSessionId: first.blenderSessionId,
      documentFingerprintSha256: first.documentFingerprintSha256,
      actionCatalogVersion: first.actionCatalogVersion,
      interactionCatalogVersion: first.interactionCatalogVersion,
    };
    const coordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      isTrustedLocalDecision: () => true,
    });
    const operationId = randomUUID();
    expect(
      coordinator.consumeBlenderDecision({ decision: first, operationId, binding }).status,
    ).toBe('started');
    const replayedNonce = { ...first, decisionId: randomUUID() };
    expect(() =>
      coordinator.consumeBlenderDecision({
        decision: replayedNonce,
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow(AuthorityConsumptionError);
    const restarted = new AuthorityConsumptionCoordinator(store, {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
      isTrustedLocalDecision: vi.fn(() => false),
    });
    expect(restarted.consumeBlenderDecision({ decision: first, operationId, binding }).status).toBe(
      'reconcile_in_flight',
    );
    expect(() =>
      restarted.consumeBlenderDecision({
        decision: replayedNonce,
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow(AuthorityConsumptionError);
    expect(() =>
      new AuthorityConsumptionCoordinator(new InMemoryAuthorityConsumptionStore(), {
        now: () => now,
      }).consumeBlenderDecision({
        decision: blenderDecision(),
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow(/trusted local state/);
  });

  it('rejects Promise and other truthy non-boolean security callback results', () => {
    const decision = blenderDecision();
    const binding = {
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
    const asyncFalse = (async () => false) as unknown as () => boolean;
    const rejectedStore = new InMemoryAuthorityConsumptionStore();
    expect(() =>
      new AuthorityConsumptionCoordinator(rejectedStore, {
        now: () => now,
        isTrustedLocalDecision: asyncFalse,
      }).consumeBlenderDecision({
        decision,
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow(/trusted local state/);
    expect(rejectedStore.readAll()).toHaveLength(0);

    const completionStore = new InMemoryAuthorityConsumptionStore();
    const operationId = randomUUID();
    const coordinator = new AuthorityConsumptionCoordinator(completionStore, {
      now: () => now,
      isTrustedLocalDecision: () => true,
      resolveDurableCompletion: asyncFalse,
    });
    coordinator.consumeBlenderDecision({ decision, operationId, binding });
    expect(() =>
      coordinator.complete({
        credentialId: decision.decisionId,
        operationId,
        durableReceiptSha256: h('f'),
      }),
    ).toThrow(/completion_receipt_untrusted/);
    expect(completionStore.readAll()).toHaveLength(1);
  });

  it('rejects unmodeled fields at every local decision binding gate', () => {
    const blender = blenderDecision();
    const blenderBinding = {
      acceptedContentSha256: blender.acceptedContentSha256,
      acceptedContentKind: blender.acceptedContentKind,
      replayId: blender.replayId,
      adapterId: blender.target.adapterId,
      instanceId: blender.target.instanceId,
      blenderSessionId: blender.blenderSessionId,
      documentFingerprintSha256: blender.documentFingerprintSha256,
      actionCatalogVersion: blender.actionCatalogVersion,
      interactionCatalogVersion: blender.interactionCatalogVersion,
    };
    const blenderStore = new InMemoryAuthorityConsumptionStore();
    expect(() =>
      new AuthorityConsumptionCoordinator(blenderStore, {
        now: () => now,
        isTrustedLocalDecision: () => true,
      }).consumeBlenderDecision({
        decision: blender,
        operationId: randomUUID(),
        binding: {
          ...blenderBinding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
      }),
    ).toThrow();
    expect(blenderStore.readAll()).toHaveLength(0);

    const history = historyTransitionDecision();
    const historyBinding = {
      transition: history.transition,
      compoundId: history.compoundId,
      replayId: history.replayId,
      adapterId: history.target.adapterId,
      instanceId: history.target.instanceId,
      blenderProcessIdentitySha256: history.blenderProcessIdentitySha256,
      blenderSessionUid: history.blenderSessionUid,
      documentFingerprintSha256: history.documentFingerprintSha256,
      compoundContentSha256: history.compoundContentSha256,
      historyLockTokenSha256: history.historyLockTokenSha256,
      currentStateSha256: history.currentStateSha256,
      expectedHistoryHeadSha256: history.expectedHistoryHeadSha256,
      expectedStatus: history.expectedStatus,
      terminalObservationSha256: history.terminalObservationSha256,
      nativeHistoryLossRecorded: history.nativeHistoryLossRecorded,
      actionCatalogVersion: history.actionCatalogVersion,
      interactionCatalogVersion: history.interactionCatalogVersion,
    };
    const historyStore = new InMemoryAuthorityConsumptionStore();
    expect(() =>
      new AuthorityConsumptionCoordinator(historyStore, {
        now: () => now,
        isTrustedLocalDecision: () => true,
        resolveTrustedHistoryTransitionBinding: () => historyBinding,
      }).consumeBlenderHistoryTransitionDecision({
        decision: history,
        operationId: randomUUID(),
        binding: {
          ...historyBinding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
      }),
    ).toThrow();
    expect(historyStore.readAll()).toHaveLength(0);

    const trainingAuthorization: TrainingUseAuthorization = {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'TrainingUseAuthorization',
      authorityId: randomUUID(),
      issuer: 'operator',
      notBefore: '2026-08-21T11:00:00.000Z',
      expiresAt: '2026-08-21T13:00:00.000Z',
      releasedManifestSha256: h(),
      purpose: 'training',
      modelFamily: 'family',
      scope: 'export_and_run',
      signature,
    };
    const trainingValidation = receipt(trainingAuthorization, 'training_export');
    const training: TrainingRunDecisionReceipt = {
      formatVersion: '1.0.0',
      kind: 'TrainingRunDecisionReceipt',
      decisionId: randomUUID(),
      nonce: 'training_unknown_1234',
      issuedAt: '2026-08-21T11:59:00.000Z',
      expiresAt: '2026-08-21T12:01:00.000Z',
      trainingUseValidationReceipt: trainingValidation,
      releasedManifestSha256: trainingAuthorization.releasedManifestSha256,
      trainingExportSha256: h('b'),
      codeSha256: h('c'),
      configSha256: h('d'),
      modelFamilySha256: contentHash(trainingAuthorization.modelFamily),
      runId: randomUUID(),
    };
    const trainingBinding = {
      releasedManifestSha256: training.releasedManifestSha256,
      trainingExportSha256: training.trainingExportSha256,
      codeSha256: training.codeSha256,
      configSha256: training.configSha256,
      modelFamilySha256: training.modelFamilySha256,
      runId: training.runId,
    };
    const trainingStore = new InMemoryAuthorityConsumptionStore();
    expect(() =>
      new AuthorityConsumptionCoordinator(trainingStore, {
        now: () => now,
        isTrustedLocalDecision: () => true,
      }).consumeTrainingDecision({
        decision: training,
        trainingUseAuthorization: trainingAuthorization,
        liveVerifier: { verify: () => trainingValidation },
        operationId: randomUUID(),
        binding: {
          ...trainingBinding,
          unreviewedSideEffect: { python: 'evil' },
        } as never,
      }),
    ).toThrow();
    expect(trainingStore.readAll()).toHaveLength(0);
  });

  it('atomically consumes a distinct history-transition decision and its nonce once', () => {
    const store = new InMemoryAuthorityConsumptionStore();
    const first = historyTransitionDecision();
    const replayedNonce = { ...historyTransitionDecision(first.nonce), decisionId: randomUUID() };
    const bindingFor = (decision: BlenderHistoryTransitionDecisionReceipt) => ({
      transition: decision.transition,
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
      expectedStatus: decision.expectedStatus,
      terminalObservationSha256: decision.terminalObservationSha256,
      nativeHistoryLossRecorded: decision.nativeHistoryLossRecorded,
      actionCatalogVersion: decision.actionCatalogVersion,
      interactionCatalogVersion: decision.interactionCatalogVersion,
    });
    const firstCoordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      isTrustedLocalDecision: () => true,
      resolveTrustedHistoryTransitionBinding: () => bindingFor(first),
    });
    const concurrentCoordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      isTrustedLocalDecision: () => true,
      resolveTrustedHistoryTransitionBinding: () => bindingFor(replayedNonce),
    });
    const operationId = randomUUID();
    expect(
      firstCoordinator.consumeBlenderHistoryTransitionDecision({
        decision: first,
        operationId,
        binding: bindingFor(first),
      }).status,
    ).toBe('started');
    expect(() =>
      concurrentCoordinator.consumeBlenderHistoryTransitionDecision({
        decision: replayedNonce,
        operationId: randomUUID(),
        binding: bindingFor(replayedNonce),
      }),
    ).toThrow(/credential_reused/);
    expect(
      new AuthorityConsumptionCoordinator(store, {
        now: () => new Date('2026-08-22T00:00:00.000Z'),
        isTrustedLocalDecision: () => false,
      }).consumeBlenderHistoryTransitionDecision({
        decision: first,
        operationId,
        binding: bindingFor(first),
      }).status,
    ).toBe('reconcile_in_flight');
    expect(() =>
      new AuthorityConsumptionCoordinator(new InMemoryAuthorityConsumptionStore(), {
        now: () => now,
        isTrustedLocalDecision: () => true,
        resolveTrustedHistoryTransitionBinding: () => bindingFor(first),
      }).consumeBlenderHistoryTransitionDecision({
        decision: first,
        operationId: randomUUID(),
        binding: { ...bindingFor(first), expectedHistoryHeadSha256: h('0') },
      }),
    ).toThrow(AuthorityConsumptionError);
  });

  it('uses one global nonce key across Blender, history, and training decision kinds', () => {
    const nonce = 'shared_local_nonce_123';
    const blender = blenderDecision(nonce);
    const history = historyTransitionDecision(nonce);
    const blenderBinding = {
      acceptedContentSha256: blender.acceptedContentSha256,
      acceptedContentKind: blender.acceptedContentKind,
      replayId: blender.replayId,
      adapterId: blender.target.adapterId,
      instanceId: blender.target.instanceId,
      blenderSessionId: blender.blenderSessionId,
      documentFingerprintSha256: blender.documentFingerprintSha256,
      actionCatalogVersion: blender.actionCatalogVersion,
      interactionCatalogVersion: blender.interactionCatalogVersion,
    };
    const historyBinding = {
      transition: history.transition,
      compoundId: history.compoundId,
      replayId: history.replayId,
      adapterId: history.target.adapterId,
      instanceId: history.target.instanceId,
      blenderProcessIdentitySha256: history.blenderProcessIdentitySha256,
      blenderSessionUid: history.blenderSessionUid,
      documentFingerprintSha256: history.documentFingerprintSha256,
      compoundContentSha256: history.compoundContentSha256,
      historyLockTokenSha256: history.historyLockTokenSha256,
      currentStateSha256: history.currentStateSha256,
      expectedHistoryHeadSha256: history.expectedHistoryHeadSha256,
      expectedStatus: history.expectedStatus,
      terminalObservationSha256: history.terminalObservationSha256,
      nativeHistoryLossRecorded: history.nativeHistoryLossRecorded,
      actionCatalogVersion: history.actionCatalogVersion,
      interactionCatalogVersion: history.interactionCatalogVersion,
    };
    const trainingAuthorization: TrainingUseAuthorization = {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'TrainingUseAuthorization',
      authorityId: randomUUID(),
      issuer: 'operator',
      notBefore: '2026-08-21T11:00:00.000Z',
      expiresAt: '2026-08-21T13:00:00.000Z',
      releasedManifestSha256: h(),
      purpose: 'training',
      modelFamily: 'family',
      scope: 'export_and_run',
      signature,
    };
    const trainingValidation = receipt(trainingAuthorization, 'training_export');
    const training: TrainingRunDecisionReceipt = {
      formatVersion: '1.0.0',
      kind: 'TrainingRunDecisionReceipt',
      decisionId: randomUUID(),
      nonce,
      issuedAt: '2026-08-21T11:59:00.000Z',
      expiresAt: '2026-08-21T12:01:00.000Z',
      trainingUseValidationReceipt: trainingValidation,
      releasedManifestSha256: trainingAuthorization.releasedManifestSha256,
      trainingExportSha256: h('b'),
      codeSha256: h('c'),
      configSha256: h('d'),
      modelFamilySha256: contentHash(trainingAuthorization.modelFamily),
      runId: randomUUID(),
    };
    const trainingBinding = {
      releasedManifestSha256: training.releasedManifestSha256,
      trainingExportSha256: training.trainingExportSha256,
      codeSha256: training.codeSha256,
      configSha256: training.configSha256,
      modelFamilySha256: training.modelFamilySha256,
      runId: training.runId,
    };

    const consume = (
      kind: 'blender' | 'history' | 'training',
      store: InMemoryAuthorityConsumptionStore,
    ) => {
      const coordinator = new AuthorityConsumptionCoordinator(store, {
        now: () => now,
        isTrustedLocalDecision: () => true,
        resolveTrustedHistoryTransitionBinding: () => historyBinding,
      });
      if (kind === 'blender') {
        return coordinator.consumeBlenderDecision({
          decision: blender,
          operationId: randomUUID(),
          binding: blenderBinding,
        });
      }
      if (kind === 'history') {
        return coordinator.consumeBlenderHistoryTransitionDecision({
          decision: history,
          operationId: randomUUID(),
          binding: historyBinding,
        });
      }
      return coordinator.consumeTrainingDecision({
        decision: training,
        trainingUseAuthorization: trainingAuthorization,
        liveVerifier: { verify: () => trainingValidation },
        operationId: randomUUID(),
        binding: trainingBinding,
      });
    };

    const kinds = ['blender', 'history', 'training'] as const;
    for (const firstKind of kinds) {
      for (const secondKind of kinds) {
        if (firstKind === secondKind) continue;
        const store = new InMemoryAuthorityConsumptionStore();
        expect(consume(firstKind, store).status).toBe('started');
        expect(() => consume(secondKind, store)).toThrow(/credential_reused/);
        expect(store.readAll()).toHaveLength(1);
      }
    }
  });

  it('live-revalidates training authority at run start and blocks revoked authority', () => {
    const authorization: TrainingUseAuthorization = {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'TrainingUseAuthorization',
      authorityId: randomUUID(),
      issuer: 'operator',
      notBefore: '2026-08-21T11:00:00.000Z',
      expiresAt: '2026-08-21T13:00:00.000Z',
      releasedManifestSha256: h(),
      purpose: 'training',
      modelFamily: 'family',
      scope: 'export_and_run',
      signature,
    };
    const validation = receipt(authorization, 'training_export');
    const decision: TrainingRunDecisionReceipt = {
      formatVersion: '1.0.0',
      kind: 'TrainingRunDecisionReceipt',
      decisionId: randomUUID(),
      nonce: 'training_nonce_1234',
      issuedAt: '2026-08-21T11:59:00.000Z',
      expiresAt: '2026-08-21T12:01:00.000Z',
      trainingUseValidationReceipt: validation,
      releasedManifestSha256: h(),
      trainingExportSha256: h('b'),
      codeSha256: h('c'),
      configSha256: h('d'),
      modelFamilySha256: contentHash('family'),
      runId: randomUUID(),
    };
    const binding = {
      releasedManifestSha256: decision.releasedManifestSha256,
      trainingExportSha256: decision.trainingExportSha256,
      codeSha256: decision.codeSha256,
      configSha256: decision.configSha256,
      modelFamilySha256: decision.modelFamilySha256,
      runId: decision.runId,
    };
    const store = new InMemoryAuthorityConsumptionStore();
    const coordinator = new AuthorityConsumptionCoordinator(store, {
      now: () => now,
      isTrustedLocalDecision: () => true,
    });
    expect(() =>
      coordinator.consumeTrainingDecision({
        decision,
        trainingUseAuthorization: authorization,
        liveVerifier: {
          verify: () => {
            throw new Error('revoked');
          },
        },
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow('revoked');
    expect(() =>
      coordinator.consumeTrainingDecision({
        decision,
        trainingUseAuthorization: authorization,
        liveVerifier: {
          verify: () => ({
            ...validation,
            receiptId: randomUUID(),
            authorityKind: 'ProviderCallAuthorization',
          }),
        },
        operationId: randomUUID(),
        binding,
      }),
    ).toThrow(/validation_receipt_mismatch/);
    expect(store.readAll()).toHaveLength(0);
    const currentReceipt = {
      ...validation,
      receiptId: randomUUID(),
      registryVersion: 'registry-v2',
      revocationLogHeadSha256: h('f'),
    };
    const operationId = randomUUID();
    expect(
      coordinator.consumeTrainingDecision({
        decision,
        trainingUseAuthorization: authorization,
        liveVerifier: { verify: () => currentReceipt },
        operationId,
        binding,
      }).status,
    ).toBe('started');
    const trustAfterRestart = vi.fn(() => false);
    const liveAfterRestart = vi.fn(() => {
      throw new Error('revoked');
    });
    expect(
      new AuthorityConsumptionCoordinator(store, {
        now: () => new Date('2026-08-22T00:00:00.000Z'),
        isTrustedLocalDecision: trustAfterRestart,
      }).consumeTrainingDecision({
        decision,
        trainingUseAuthorization: authorization,
        liveVerifier: { verify: liveAfterRestart },
        operationId,
        binding,
      }).status,
    ).toBe('reconcile_in_flight');
    expect(trustAfterRestart).not.toHaveBeenCalled();
    expect(liveAfterRestart).not.toHaveBeenCalled();
  });
});
