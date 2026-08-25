import {
  companionPokeCompoundCreateRequestSchema,
  companionPokeCompoundDeliverySchema,
  companionPokeCompoundRecoveryAckSchema,
  companionPokeCompoundResultSchema,
  computeCompanionPokeCompoundDeliveryContentSha256,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { createPokeCompoundTransportFixture } from '../../support/poke-compound-fixture.js';

describe('Companion Poke compound protocol', () => {
  it('binds one immutable delivery to the complete initial replay and terminal proof', () => {
    const fixture = createPokeCompoundTransportFixture();
    expect(companionPokeCompoundCreateRequestSchema.parse(fixture.request)).toEqual(
      fixture.request,
    );
    const content = {
      formatVersion: '1.0.0' as const,
      requestId: fixture.request.requestId,
      deliveryId: '73000000-0000-4000-8000-000000000001',
      target: fixture.request.replay.target,
      replayId: fixture.request.replay.recipe.replayId,
      compoundId: fixture.request.replay.recipe.compoundId,
      compoundContentSha256: fixture.request.replay.recipe.compoundContentSha256,
      historyLockTokenSha256: fixture.request.replay.recipe.historyLockTokenSha256,
      replay: fixture.request.replay,
      decisionReceipt: fixture.request.decisionReceipt,
      trustedDecisionConsumptionEvent: fixture.request.trustedDecisionConsumptionEvent,
      requestedAt: '2026-08-24T00:00:10.000Z',
      dispatchedAt: '2026-08-24T00:00:11.000Z',
    };
    const delivery = companionPokeCompoundDeliverySchema.parse({
      ...content,
      deliveryContentSha256: computeCompanionPokeCompoundDeliveryContentSha256(content),
    });
    const result = companionPokeCompoundResultSchema.parse({
      formatVersion: '1.0.0',
      requestId: delivery.requestId,
      deliveryId: delivery.deliveryId,
      deliveryContentSha256: delivery.deliveryContentSha256,
      target: delivery.target,
      replayId: delivery.replayId,
      compoundId: delivery.compoundId,
      compoundContentSha256: delivery.compoundContentSha256,
      historyLockTokenSha256: delivery.historyLockTokenSha256,
      status: 'succeeded',
      replay: fixture.terminalReplay,
      terminalEvidence: fixture.terminalEvidence,
      observedCurrentState: null,
      error: null,
      occurredAt: '2026-08-24T00:00:20.000Z',
    });
    expect(result.status).toBe('succeeded');
    expect(() =>
      companionPokeCompoundDeliverySchema.parse({
        ...delivery,
        compoundContentSha256: '0'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      companionPokeCompoundResultSchema.parse({
        ...result,
        terminalEvidence: null,
      }),
    ).toThrow();
  });

  it('allows recovery only through a retained terminal result or a quarantined history proof', () => {
    const fixture = createPokeCompoundTransportFixture();
    const content = {
      formatVersion: '1.0.0' as const,
      requestId: fixture.request.requestId,
      deliveryId: '73000000-0000-4000-8000-000000000002',
      target: fixture.request.replay.target,
      replayId: fixture.request.replay.recipe.replayId,
      compoundId: fixture.request.replay.recipe.compoundId,
      compoundContentSha256: fixture.request.replay.recipe.compoundContentSha256,
      historyLockTokenSha256: fixture.request.replay.recipe.historyLockTokenSha256,
      replay: fixture.request.replay,
      decisionReceipt: fixture.request.decisionReceipt,
      trustedDecisionConsumptionEvent: fixture.request.trustedDecisionConsumptionEvent,
      requestedAt: '2026-08-24T00:01:00.000Z',
      dispatchedAt: '2026-08-24T00:01:01.000Z',
    };
    const delivery = companionPokeCompoundDeliverySchema.parse({
      ...content,
      deliveryContentSha256: computeCompanionPokeCompoundDeliveryContentSha256(content),
    });
    const challenge = {
      formatVersion: '1.0.0' as const,
      recoveryId: '73000000-0000-4000-8000-000000000003',
      originalDelivery: delivery,
      replacementSessionFingerprintSha256: 'a'.repeat(64),
      replacementDocumentAuthoritySha256: 'b'.repeat(64),
      requestedAt: '2026-08-24T00:01:10.000Z',
    };
    const terminalResult = companionPokeCompoundResultSchema.parse({
      formatVersion: '1.0.0',
      requestId: delivery.requestId,
      deliveryId: delivery.deliveryId,
      deliveryContentSha256: delivery.deliveryContentSha256,
      target: delivery.target,
      replayId: delivery.replayId,
      compoundId: delivery.compoundId,
      compoundContentSha256: delivery.compoundContentSha256,
      historyLockTokenSha256: delivery.historyLockTokenSha256,
      status: 'succeeded',
      replay: fixture.terminalReplay,
      terminalEvidence: fixture.terminalEvidence,
      observedCurrentState: null,
      error: null,
      occurredAt: '2026-08-24T00:01:09.000Z',
    });
    expect(
      companionPokeCompoundRecoveryAckSchema.parse({
        formatVersion: '1.0.0',
        recoveryId: challenge.recoveryId,
        challenge,
        outcome: 'terminal_result',
        terminalResult,
        observedCurrentState: null,
        automaticReplay: false,
        retainsTargetLock: true,
        occurredAt: '2026-08-24T00:01:11.000Z',
      }).outcome,
    ).toBe('terminal_result');
    expect(() =>
      companionPokeCompoundRecoveryAckSchema.parse({
        formatVersion: '1.0.0',
        recoveryId: challenge.recoveryId,
        challenge,
        outcome: 'terminal_result',
        terminalResult,
        observedCurrentState: null,
        automaticReplay: true,
        retainsTargetLock: true,
        occurredAt: '2026-08-24T00:01:11.000Z',
      }),
    ).toThrow();
  });
});
