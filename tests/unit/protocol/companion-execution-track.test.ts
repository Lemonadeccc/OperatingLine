import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionExecutionTrackPreflightBindingSchema,
  companionExecutionTrackPreflightCreateRequestSchema,
  companionExecutionTrackPreflightDeliverySchema,
  companionExecutionTrackPreflightPollDeliverySchema,
  companionExecutionTrackPreflightPollRequestSchema,
  companionExecutionTrackPreflightResultAckSchema,
  companionExecutionTrackPreflightResultSchema,
  companionExecutionTrackPreflightStatusRequestSchema,
  companionExecutionTrackPreflightStatusSchema,
  computeProtocolCanonicalJsonSha256,
  type CompanionExecutionTrackPreflightBinding,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';
import {
  executionTrackPreflightFixture,
  executionTrackPreflightLease,
  preflightIds,
} from '../support/execution-track-preflight-fixture.js';

function rehashBinding(
  binding: CompanionExecutionTrackPreflightBinding,
  mutation: Record<string, unknown>,
): Record<string, unknown> {
  const content = Object.fromEntries(
    Object.entries(binding).filter(([key]) => key !== 'bindingContentSha256'),
  );
  const mutated = { ...content, ...mutation };
  return {
    ...mutated,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(mutated),
  };
}

function rehashDecisionMutation(
  binding: CompanionExecutionTrackPreflightBinding,
  mutation: Record<string, unknown>,
): Record<string, unknown> {
  const decision = { ...binding.acceptance.decision, ...mutation };
  return rehashBinding(binding, {
    acceptance: {
      ...binding.acceptance,
      decision,
      decisionContentSha256: computeProtocolCanonicalJsonSha256(decision),
    },
  });
}

function deliveryFixture() {
  const { binding } = executionTrackPreflightFixture();
  const lease = executionTrackPreflightLease();
  const delivery = companionExecutionTrackPreflightDeliverySchema.parse({
    binding,
    deliveryId: preflightIds.delivery,
    lease,
    dispatchedAt: '2026-08-22T10:00:01Z',
  });
  const result = companionExecutionTrackPreflightResultSchema.parse({
    formatVersion: binding.formatVersion,
    requestId: binding.requestId,
    replayId: binding.replayId,
    deliveryId: delivery.deliveryId,
    bindingContentSha256: binding.bindingContentSha256,
    target: binding.target,
    leaseId: lease.leaseId,
    proposalId: binding.proposal.id,
    planId: binding.plan.id,
    planRevision: binding.plan.revision,
    executionId: binding.executionId,
    leafId: binding.leafId,
    status: 'verified_unavailable',
    authorityVerified: true,
    capability: 'preflight_only',
    reasonCode: 'executor_unavailable',
    error: 'No mutation-capable execution-track adapter is installed.',
    occurredAt: '2026-08-22T10:00:02Z',
  });
  const status = companionExecutionTrackPreflightStatusSchema.parse({
    binding,
    deliveryId: delivery.deliveryId,
    lease,
    dispatchedAt: delivery.dispatchedAt,
    status: result.status,
    result,
    updatedAt: result.occurredAt,
  });
  return { binding, delivery, lease, result, status };
}

describe('Companion execution-track preflight protocol', () => {
  it('accepts only the strict Companion-known create request', () => {
    const { request } = executionTrackPreflightFixture();
    expect(companionExecutionTrackPreflightCreateRequestSchema.parse(request)).toEqual(request);
    expect(
      companionExecutionTrackPreflightCreateRequestSchema.safeParse({
        ...request,
        plan: { ...request.plan, protocolVersion: '1.7.0' },
      }).success,
    ).toBe(true);
    expect(
      companionExecutionTrackPreflightCreateRequestSchema.safeParse({
        ...request,
        replayId: preflightIds.replay,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackPreflightCreateRequestSchema.safeParse({
        ...request,
        plan: { ...request.plan, protocolVersion: '1.5.0' },
      }).success,
    ).toBe(false);
  });

  it('rejects semantic binding drift after the attacker recomputes the outer hash', () => {
    const { binding } = executionTrackPreflightFixture();
    expect(companionExecutionTrackPreflightBindingSchema.parse(binding)).toEqual(binding);
    const decision17 = { ...binding.acceptance.decision, protocolVersion: '1.7.0' as const };
    expect(
      companionExecutionTrackPreflightBindingSchema.safeParse(
        rehashBinding(binding, {
          plan: { ...binding.plan, protocolVersion: '1.7.0' },
          acceptance: {
            ...binding.acceptance,
            decision: decision17,
            decisionContentSha256: computeProtocolCanonicalJsonSha256(decision17),
          },
        }),
      ).success,
    ).toBe(true);
    for (const forged of [
      { ...binding, bindingContentSha256: 'f'.repeat(64) },
      rehashBinding(binding, {
        replay: { ...binding.replay, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      }),
      rehashDecisionMutation(binding, { decision: 'rejected' }),
      rehashDecisionMutation(binding, {
        proposalId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
      rehashDecisionMutation(binding, {
        instanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
      rehashBinding(binding, {
        acceptance: { ...binding.acceptance, decisionContentSha256: 'f'.repeat(64) },
      }),
      rehashBinding(binding, {
        acceptance: {
          ...binding.acceptance,
          receipt: { ...binding.acceptance.receipt, authentication: 'forged_source' },
        },
      }),
      rehashBinding(binding, {
        acceptance: {
          ...binding.acceptance,
          receipt: {
            ...binding.acceptance.receipt,
            subjectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
        },
      }),
      rehashBinding(binding, {
        acceptance: {
          ...binding.acceptance,
          receipt: {
            ...binding.acceptance.receipt,
            instanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        },
      }),
      rehashBinding(binding, {
        acceptance: {
          ...binding.acceptance,
          receipt: { ...binding.acceptance.receipt, receivedAt: '2026-08-22T09:59:57Z' },
        },
      }),
      rehashBinding(binding, {
        acceptance: {
          ...binding.acceptance,
          receipt: { ...binding.acceptance.receipt, receivedAt: '2026-08-22T10:00:01Z' },
        },
      }),
      rehashBinding(binding, {
        step: {
          ...binding.step,
          action: {
            ...binding.action,
            arguments: { ...binding.action.arguments, radius: 1.75 },
          },
        },
      }),
      rehashBinding(binding, {
        action: {
          ...binding.action,
          arguments: { ...binding.action.arguments, radius: 1.75 },
        },
      }),
      (() => {
        const sourceLeaf = {
          ...binding.sourceLeaf,
          action: {
            ...binding.action,
            arguments: { ...binding.action.arguments, radius: 1.75 },
          },
        };
        return rehashBinding(binding, {
          sourceLeaf,
          artifacts: {
            ...binding.artifacts,
            sourceLeafContentSha256: computeProtocolCanonicalJsonSha256(sourceLeaf),
          },
        });
      })(),
      rehashBinding(binding, {
        sourceLeaf: { ...binding.sourceLeaf, title: 'forged source leaf' },
      }),
      rehashBinding(binding, {
        selectedTrack: { ...binding.selectedTrack, title: 'forged selected track' },
      }),
      rehashBinding(binding, {
        catalogs: {
          ...binding.catalogs,
          interaction: { ...binding.catalogs.interaction, contentSha256: 'f'.repeat(64) },
        },
      }),
      rehashBinding(binding, {
        override: { ...binding.override, trackContentSha256: 'f'.repeat(64) },
      }),
      rehashBinding(binding, {
        override: { ...binding.override, proofExecutionContentSha256: 'f'.repeat(64) },
      }),
    ]) {
      expect(companionExecutionTrackPreflightBindingSchema.safeParse(forged).success).toBe(false);
    }
  });

  it('binds delivery lease chronology and immutable terminal result identity', () => {
    const { binding, delivery, lease, result, status } = deliveryFixture();
    expect(status.result).toEqual(result);
    expect(
      companionExecutionTrackPreflightStatusSchema.parse({
        binding,
        status: 'queued',
        updatedAt: binding.requestedAt,
      }).status,
    ).toBe('queued');
    expect(
      companionExecutionTrackPreflightStatusSchema.parse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        updatedAt: '2026-08-22T10:06:00Z',
      }).status,
    ).toBe('recovery_required');
    expect(
      companionExecutionTrackPreflightStatusSchema.safeParse({
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: result.status,
        result: { ...result, leafId: 'forged.leaf' },
        updatedAt: result.occurredAt,
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...delivery, dispatchedAt: '2026-08-22T09:59:59Z' },
      { ...delivery, dispatchedAt: lease.expiresAt },
      {
        ...delivery,
        lease: {
          ...lease,
          target: {
            ...lease.target,
            instanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          },
        },
      },
    ]) {
      expect(companionExecutionTrackPreflightDeliverySchema.safeParse(invalid).success).toBe(false);
    }
    for (const invalid of [
      {
        binding,
        status: 'queued',
        updatedAt: '2026-08-22T10:00:00.001Z',
      },
      {
        binding,
        deliveryId: delivery.deliveryId,
        lease,
        dispatchedAt: delivery.dispatchedAt,
        status: 'recovery_required',
        updatedAt: '2026-08-22T10:00:00.500Z',
      },
      { ...status, updatedAt: '2026-08-22T10:00:00.500Z' },
      {
        ...status,
        result: { ...result, occurredAt: '2026-08-22T10:00:00.500Z' },
      },
      {
        ...status,
        result: { ...result, occurredAt: lease.expiresAt },
        updatedAt: lease.expiresAt,
      },
      { ...status, updatedAt: lease.expiresAt },
      {
        ...status,
        lease: {
          ...lease,
          target: {
            ...lease.target,
            instanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        },
      },
    ]) {
      expect(companionExecutionTrackPreflightStatusSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      companionExecutionTrackPreflightResultSchema.safeParse({
        ...result,
        authorityVerified: false,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackPreflightResultSchema.safeParse({
        ...result,
        status: 'rejected',
        authorityVerified: false,
      }).success,
    ).toBe(false);
    expect(
      companionExecutionTrackPreflightResultSchema.safeParse({
        ...result,
        status: 'rejected',
        authorityVerified: false,
        reasonCode: 'lease_expired',
      }).success,
    ).toBe(false);
  });

  it('exports every strict public transport schema with the canonical filename and id', async () => {
    const { request } = executionTrackPreflightFixture();
    const { binding, delivery, result, status } = deliveryFixture();
    const cases = [
      ['create-request', request],
      ['binding', binding],
      ['lease', executionTrackPreflightLease()],
      ['delivery', delivery],
      ['result', result],
      ['status-request', { requestId: binding.requestId }],
      ['status', status],
      ['poll-request', binding.target],
      ['poll-delivery', { request: delivery }],
      ['result-ack', { result: 'accepted' }],
    ] as const;
    for (const [kind, value] of cases) {
      const filename = `companion-execution-track-preflight-${kind}.schema.json`;
      const publicSchema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(publicSchema['$id']).toBe(
        `https://operatingline.dev/schema/v1/companion-execution-track-preflight-${kind}.json`,
      );
      await validatePublicJsonSchemaCases(publicSchema, [
        { value, accepted: true },
        { value: { ...value, schemaDrift: true }, accepted: false },
      ]);
    }

    expect(companionExecutionTrackPreflightStatusRequestSchema.parse(cases[5][1])).toEqual(
      cases[5][1],
    );
    expect(companionExecutionTrackPreflightPollRequestSchema.parse(cases[7][1])).toEqual(
      cases[7][1],
    );
    expect(companionExecutionTrackPreflightPollDeliverySchema.parse(cases[8][1])).toEqual(
      cases[8][1],
    );
    expect(companionExecutionTrackPreflightResultAckSchema.parse(cases[9][1])).toEqual(cases[9][1]);
  });
});
