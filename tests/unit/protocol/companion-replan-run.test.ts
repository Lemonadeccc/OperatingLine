import { randomUUID } from 'node:crypto';

import {
  companionReplanRunContractVersion,
  companionReplanRunCreateRequestSchema,
  companionReplanRunErrorSchema,
  companionReplanRunSchema,
  companionReplanRunStatusRequestSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

function createRequest() {
  return {
    generationRequestId: randomUUID(),
    revisionRequestId: randomUUID(),
    providerId: 'fake-planner',
    providerVersion: '0.1.0',
    targetAdapterId: 'blender',
    targetInstanceId: randomUUID(),
    authorization: {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'ProviderCallAuthorization',
      authorityId: randomUUID(),
      issuer: 'operator',
      notBefore: '2026-08-05T11:00:00.000Z',
      expiresAt: '2026-08-05T13:00:00.000Z',
      provider: { providerId: 'fake-planner', descriptorVersion: '0.1.0', model: 'fake-v1' },
      operation: 'semantic_replan_generation',
      generationRequestSha256: 'a'.repeat(64),
      disclosedDataSha256: 'b'.repeat(64),
      maximumCallCount: 1,
      signature: {
        signerId: 'operator',
        keyId: 'key-1',
        algorithm: 'ed25519',
        signature: 'A'.repeat(86),
        signedAt: '2026-08-05T11:00:00.000Z',
      },
    },
  } as const;
}

function status(statusValue: string) {
  const request = createRequest();
  return {
    contractVersion: companionReplanRunContractVersion,
    generationRequestId: request.generationRequestId,
    revisionRequestId: request.revisionRequestId,
    targetAdapterId: request.targetAdapterId,
    targetInstanceId: request.targetInstanceId,
    provider: {
      id: request.providerId,
      version: request.providerVersion,
      displayName: 'Fake Planner',
    },
    status: statusValue,
    terminal: false,
    sceneChanged: false,
    proposalId: null,
    error: null,
    needsRevision: null,
    updatedAt: '2026-08-05T12:00:01.000Z',
  };
}

describe('companion replan run protocol', () => {
  it('accepts an explicit signed single-use Provider authorization', () => {
    const request = createRequest();

    expect(companionReplanRunCreateRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects the legacy boolean self-attestation and wrong operations', () => {
    const request = createRequest();

    expect(
      companionReplanRunCreateRequestSchema.safeParse({
        ...request,
        authorization: {
          disclosureVersion: '1.0.0',
          dataHandlingAcknowledged: true,
          possibleChargesAcknowledged: true,
          proposalCreationAcknowledged: true,
          authorizedAt: '2026-08-05T12:00:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(
      companionReplanRunCreateRequestSchema.safeParse({
        ...request,
        authorization: {
          ...request.authorization,
          operation: 'planning_generation',
        },
      }).success,
    ).toBe(false);
    expect(
      companionReplanRunCreateRequestSchema.safeParse({
        ...request,
        authorization: { ...request.authorization, ambientConsent: true },
      }).success,
    ).toBe(false);
    expect(
      companionReplanRunCreateRequestSchema.safeParse({ ...request, unexpected: true }).success,
    ).toBe(false);
  });

  it('requires an exact generation request identity for status lookup', () => {
    const generationRequestId = randomUUID();

    expect(companionReplanRunStatusRequestSchema.parse({ generationRequestId })).toEqual({
      generationRequestId,
    });
    expect(
      companionReplanRunStatusRequestSchema.safeParse({ generationRequestId, providerId: 'x' })
        .success,
    ).toBe(false);
  });

  it('keeps queued and generating runs non-terminal and scene-safe', () => {
    for (const state of ['queued', 'generating']) {
      expect(companionReplanRunSchema.safeParse(status(state)).success).toBe(true);
      expect(companionReplanRunSchema.safeParse({ ...status(state), terminal: true }).success).toBe(
        false,
      );
      expect(
        companionReplanRunSchema.safeParse({ ...status(state), sceneChanged: true }).success,
      ).toBe(false);
    }
  });

  it('requires proposal identity only for the proposal-created terminal state', () => {
    const proposalCreated = {
      ...status('proposal_created'),
      terminal: true,
      proposalId: randomUUID(),
    };

    expect(companionReplanRunSchema.safeParse(proposalCreated).success).toBe(true);
    expect(
      companionReplanRunSchema.safeParse({ ...proposalCreated, proposalId: null }).success,
    ).toBe(false);
    expect(
      companionReplanRunSchema.safeParse({
        ...status('needs_revision'),
        terminal: true,
        proposalId: randomUUID(),
        needsRevision: {
          planning: { errorCount: 0, warningCount: 0, findings: [] },
          locality: { valid: false, findings: [] },
          planDiffAvailable: false,
        },
      }).success,
    ).toBe(false);
  });

  it('requires bounded evidence only for the needs-revision terminal state', () => {
    const needsRevision = {
      ...status('needs_revision'),
      terminal: true,
      needsRevision: {
        planning: { errorCount: 0, warningCount: 0, findings: [] },
        locality: {
          valid: false,
          findings: [
            {
              code: 'no_local_change',
              message: 'The generated plan did not change the referenced subtree.',
              stepIds: ['snowman.model.head'],
            },
          ],
        },
        planDiffAvailable: false,
      },
    };

    expect(companionReplanRunSchema.safeParse(needsRevision).success).toBe(true);
    expect(
      companionReplanRunSchema.safeParse({ ...needsRevision, needsRevision: null }).success,
    ).toBe(false);
    expect(
      companionReplanRunSchema.safeParse({
        ...needsRevision,
        needsRevision: {
          ...needsRevision.needsRevision,
          planning: {
            ...needsRevision.needsRevision.planning,
            errorCount: 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      companionReplanRunSchema.safeParse({
        ...needsRevision,
        needsRevision: {
          ...needsRevision.needsRevision,
          locality: { ...needsRevision.needsRevision.locality, valid: true },
        },
      }).success,
    ).toBe(false);
    expect(
      companionReplanRunSchema.safeParse({
        ...status('queued'),
        needsRevision: needsRevision.needsRevision,
      }).success,
    ).toBe(false);
  });

  it('requires a strict safe error for failed and interrupted terminal states', () => {
    const error = companionReplanRunErrorSchema.parse({
      code: 'planner_provider_failed',
      retryMode: 'new_request_id',
      message: 'Planner provider failed before a proposal was created',
    });

    for (const state of ['failed', 'interrupted']) {
      expect(
        companionReplanRunSchema.safeParse({
          ...status(state),
          terminal: true,
          error,
        }).success,
      ).toBe(true);
      expect(
        companionReplanRunSchema.safeParse({
          ...status(state),
          terminal: true,
          error: null,
        }).success,
      ).toBe(false);
    }
    expect(companionReplanRunErrorSchema.safeParse({ ...error, stack: 'secret' }).success).toBe(
      false,
    );
    expect(
      companionReplanRunSchema.safeParse({
        ...status('failed'),
        terminal: true,
        error: { ...error, retryMode: 'same_request_id' },
      }).success,
    ).toBe(false);
  });
});
