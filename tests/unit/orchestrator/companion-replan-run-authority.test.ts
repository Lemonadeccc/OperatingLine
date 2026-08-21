import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  authorityRevocationSignedContent,
  authoritySignatureDomainPrefix,
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
  type AuthorityRevocation,
  type GuidePlan,
  type ProviderCallAuthorization,
} from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

import {
  companionReplanDisclosedDataSha256,
  companionReplanGenerationRequestSha256,
  createCompanionReplanRunCoordinator,
} from '../../../services/orchestrator/src/companion-replan-run.js';
import {
  AuthorityConsumptionCoordinator,
  InMemoryAuthorityConsumptionStore,
} from '../../../services/orchestrator/src/authority-consumption.js';
import {
  AuthorityVerifier,
  type AuthorityTrustSource,
  type TrustedAuthoritySignerRegistry,
} from '../../../services/orchestrator/src/authority-verifier.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';

const now = new Date('2026-08-21T12:00:00.000Z');
const primaryKeys = generateKeyPairSync('ed25519');
const wrongKeys = generateKeyPairSync('ed25519');
const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;
const packet = { exact: 'disclosed replanning packet' };

function message(kind: string, content: unknown): Buffer {
  return Buffer.concat([
    Buffer.from(authoritySignatureDomainPrefix(kind as never)),
    Buffer.from(canonicalizeProtocolJsonValue(content)),
  ]);
}

function signedAuthorization(
  input: { generationRequestId: string; revisionRequestId: string },
  overrides: Partial<ProviderCallAuthorization> = {},
  privateKey = primaryKeys.privateKey,
): ProviderCallAuthorization {
  const unsigned = {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'ProviderCallAuthorization',
    authorityId: randomUUID(),
    issuer: 'operator',
    notBefore: '2026-08-21T11:00:00.000Z',
    expiresAt: '2026-08-21T13:00:00.000Z',
    provider: { providerId: 'fake-planner', descriptorVersion: '0.1.0', model: 'fake-v1' },
    operation: 'semantic_replan_generation',
    generationRequestSha256: companionReplanGenerationRequestSha256({
      ...input,
      providerId: 'fake-planner',
    }),
    disclosedDataSha256: companionReplanDisclosedDataSha256(packet),
    maximumCallCount: 1,
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T11:00:00.000Z',
    },
    ...overrides,
  } as ProviderCallAuthorization;
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        message(unsigned.kind, authoritySignedContent(unsigned)),
        privateKey,
      ).toString('base64url'),
    },
  };
}

function signedRevocation(record: ProviderCallAuthorization): AuthorityRevocation {
  const unsigned = {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'AuthorityRevocation',
    revocationId: randomUUID(),
    sequence: 0,
    previousRevocationSha256: null,
    authorityId: record.authorityId,
    authorityContentSha256: createHash('sha256')
      .update(canonicalizeProtocolJsonValue(authoritySignedContent(record)))
      .digest('hex'),
    effectiveAt: '2026-08-21T11:30:00.000Z',
    reason: 'Operator revoked this call.',
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T11:30:00.000Z',
    },
  } as AuthorityRevocation;
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        message(unsigned.kind, authorityRevocationSignedContent(unsigned)),
        primaryKeys.privateKey,
      ).toString('base64url'),
    },
  };
}

function registry(revocations: readonly AuthorityRevocation[]): TrustedAuthoritySignerRegistry {
  return {
    version: 'test-registry-v1',
    revocationLog: {
      length: revocations.length,
      headSha256: createHash('sha256')
        .update(canonicalizeProtocolJsonValue(revocations.length === 0 ? [] : revocations.at(-1)!))
        .digest('hex'),
    },
    signers: [
      {
        signerId: 'operator',
        keyId: 'key-1',
        algorithm: 'ed25519',
        canonicalization: 'operatingline-authority-json-v1',
        publicKeyPem: primaryKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        roles: ['provider_call_authorizer', 'revocation_authorizer'],
      },
    ],
  };
}

function createFixture(input: {
  authorization: ProviderCallAuthorization;
  store?: InMemoryAuthorityConsumptionStore;
  trustSource?: AuthorityTrustSource;
  database?: ReturnType<typeof openOperatingLineDatabase>;
  providerCalls: { value: number };
  proposeCalls: { value: number };
}) {
  const database = input.database ?? openOperatingLineDatabase(':memory:');
  const providerRegistry = createPlannerProviderRegistry([
    new FakePlannerProvider(
      () => {
        throw new Error('not used');
      },
      {
        contractVersion: '1.0.0',
        id: 'fake-planner',
        version: '0.1.0',
        displayName: 'Fake Planner',
        description: 'Authority-gated test Provider.',
        availability: { available: true },
        limits: { maxConcurrency: 1 },
        dataHandling: {
          executionLocation: 'local',
          dataTransmission: 'none',
          credentialManagement: 'provider_managed',
        },
      },
      () => {
        throw new Error('not used');
      },
    ),
  ]);
  const trustSource = input.trustSource ?? {
    readSnapshot: () => ({ registry: registry([]), revocations: [] }),
  };
  const store = input.store ?? new InMemoryAuthorityConsumptionStore();
  const coordinator = createCompanionReplanRunCoordinator({
    database,
    providerRegistry,
    generationCoordinator: {
      generate: async () => {
        throw new Error('authorized generation path required');
      },
      generateAuthorized: async (request, authorize) => {
        authorize({
          request,
          packet: packet as never,
          registered: providerRegistry.findReplanner('fake-planner')!,
          runtimeTreatment: {
            treatment: { profile: { model: { requested: 'fake-v1' } } },
          } as never,
        });
        input.providerCalls.value += 1;
        throw new Error('stop after proving the Provider side-effect gate opened');
      },
      completedResult: () => null,
      close: async () => undefined,
    },
    replanningService: {
      getPrompt: () => packet as never,
      propose: () => {
        input.proposeCalls.value += 1;
        return {} as never;
      },
    },
    authorityConsumptionCoordinator: new AuthorityConsumptionCoordinator(store, {
      now: () => now,
    }),
    liveProviderAuthorityVerifier: new AuthorityVerifier(trustSource, { now: () => now }),
  });
  return { coordinator, database, providerRegistry, store };
}

function recordRevision(
  database: ReturnType<typeof openOperatingLineDatabase>,
  revisionRequestId: string,
  instanceId: string,
) {
  database.recordGuideRevisionRequest({
    protocolVersion: '1.1.0',
    requestId: revisionRequestId,
    adapterId: 'blender',
    catalogVersion: '1.0.0',
    instanceId,
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the referenced snowman head larger.',
    revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
    occurredAt: now.toISOString(),
  });
}

async function waitTerminal(
  coordinator: ReturnType<typeof createCompanionReplanRunCoordinator>,
  generationRequestId: string,
) {
  const deadline = Date.now() + 1_000;
  while (coordinator.get(generationRequestId)?.terminal !== true && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
}

describe('companion replan Provider authority gate', () => {
  it.each(['expired', 'revoked', 'wrong-key', 'wrong-model', 'wrong-disclosure'] as const)(
    'rejects %s authority before the Provider or host proposal side effect',
    async (failure) => {
      const generationRequestId = randomUUID();
      const revisionRequestId = randomUUID();
      const instanceId = randomUUID();
      let authorization = signedAuthorization({ generationRequestId, revisionRequestId });
      let revocations: readonly AuthorityRevocation[] = [];
      if (failure === 'expired') {
        authorization = signedAuthorization(
          { generationRequestId, revisionRequestId },
          {
            notBefore: '2026-08-21T10:00:00.000Z',
            expiresAt: '2026-08-21T11:30:00.000Z',
            signature: {
              ...authorization.signature,
              signedAt: '2026-08-21T10:00:00.000Z',
            },
          },
        );
      } else if (failure === 'wrong-key') {
        authorization = signedAuthorization(
          { generationRequestId, revisionRequestId },
          {},
          wrongKeys.privateKey,
        );
      } else if (failure === 'wrong-model') {
        authorization = signedAuthorization(
          { generationRequestId, revisionRequestId },
          {
            provider: {
              providerId: 'fake-planner',
              descriptorVersion: '0.1.0',
              model: 'different-model',
            },
          },
        );
      } else if (failure === 'wrong-disclosure') {
        authorization = signedAuthorization(
          { generationRequestId, revisionRequestId },
          { disclosedDataSha256: 'f'.repeat(64) },
        );
      } else {
        revocations = [signedRevocation(authorization)];
      }
      const providerCalls = { value: 0 };
      const proposeCalls = { value: 0 };
      const fixture = createFixture({
        authorization,
        providerCalls,
        proposeCalls,
        trustSource: { readSnapshot: () => ({ registry: registry(revocations), revocations }) },
      });
      recordRevision(fixture.database, revisionRequestId, instanceId);
      try {
        fixture.coordinator.create({
          generationRequestId,
          revisionRequestId,
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'blender',
          targetInstanceId: instanceId,
          authorization,
        });
        await waitTerminal(fixture.coordinator, generationRequestId);
        expect(fixture.coordinator.get(generationRequestId)).toMatchObject({
          status: 'failed',
          proposalId: null,
          sceneChanged: false,
        });
        expect(providerCalls.value).toBe(0);
        expect(proposeCalls.value).toBe(0);
      } finally {
        fixture.coordinator.beginClose();
        await fixture.coordinator.close();
        await fixture.providerRegistry.close();
        fixture.database.close();
      }
    },
  );

  it('atomically permits only one concurrent process to consume one authorization', async () => {
    const generationRequestId = randomUUID();
    const revisionRequestId = randomUUID();
    const instanceId = randomUUID();
    const authorization = signedAuthorization({ generationRequestId, revisionRequestId });
    const store = new InMemoryAuthorityConsumptionStore();
    const providerCalls = { value: 0 };
    const proposeCalls = { value: 0 };
    const first = createFixture({ authorization, store, providerCalls, proposeCalls });
    const second = createFixture({ authorization, store, providerCalls, proposeCalls });
    recordRevision(first.database, revisionRequestId, instanceId);
    recordRevision(second.database, revisionRequestId, instanceId);
    const request = {
      generationRequestId,
      revisionRequestId,
      providerId: 'fake-planner',
      providerVersion: '0.1.0',
      targetAdapterId: 'blender',
      targetInstanceId: instanceId,
      authorization,
    } as const;
    try {
      first.coordinator.create(request);
      second.coordinator.create(request);
      await Promise.all([
        waitTerminal(first.coordinator, generationRequestId),
        waitTerminal(second.coordinator, generationRequestId),
      ]);
      expect(providerCalls.value).toBe(1);
      expect(proposeCalls.value).toBe(0);
    } finally {
      first.coordinator.beginClose();
      second.coordinator.beginClose();
      await Promise.all([first.coordinator.close(), second.coordinator.close()]);
      await Promise.all([first.providerRegistry.close(), second.providerRegistry.close()]);
      first.database.close();
      second.database.close();
    }
  });

  it('does not retry a consumed Provider authorization after coordinator restart', async () => {
    const generationRequestId = randomUUID();
    const revisionRequestId = randomUUID();
    const instanceId = randomUUID();
    const authorization = signedAuthorization({ generationRequestId, revisionRequestId });
    const store = new InMemoryAuthorityConsumptionStore();
    const providerCalls = { value: 0 };
    const proposeCalls = { value: 0 };
    const database = openOperatingLineDatabase(':memory:');
    recordRevision(database, revisionRequestId, instanceId);
    const first = createFixture({ authorization, store, database, providerCalls, proposeCalls });
    const request = {
      generationRequestId,
      revisionRequestId,
      providerId: 'fake-planner',
      providerVersion: '0.1.0',
      targetAdapterId: 'blender',
      targetInstanceId: instanceId,
      authorization,
    } as const;
    first.coordinator.create(request);
    await waitTerminal(first.coordinator, generationRequestId);
    first.coordinator.beginClose();
    await first.coordinator.close();
    await first.providerRegistry.close();

    const restarted = createFixture({
      authorization,
      store,
      database,
      providerCalls,
      proposeCalls,
    });
    try {
      expect(restarted.coordinator.create(request)).toMatchObject({ status: 'failed' });
      await new Promise((resolveWait) => setImmediate(resolveWait));
      expect(providerCalls.value).toBe(1);
      expect(proposeCalls.value).toBe(0);
    } finally {
      restarted.coordinator.beginClose();
      await restarted.coordinator.close();
      await restarted.providerRegistry.close();
      database.close();
    }
  });
});
