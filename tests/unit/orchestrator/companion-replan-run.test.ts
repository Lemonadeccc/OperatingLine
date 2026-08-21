import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
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
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function authorization(input: {
  generationRequestId: string;
  revisionRequestId: string;
}): ProviderCallAuthorization {
  return {
    formatVersion: '1.0.0',
    canonicalization: 'operatingline-authority-json-v1',
    kind: 'ProviderCallAuthorization',
    authorityId: randomUUID(),
    issuer: 'operator',
    notBefore: '2026-08-21T00:00:00.000Z',
    expiresAt: '2099-08-21T00:00:00.000Z',
    provider: { providerId: 'fake-planner', descriptorVersion: '0.1.0', model: 'fake-v1' },
    operation: 'semantic_replan_generation',
    generationRequestSha256: companionReplanGenerationRequestSha256({
      ...input,
      providerId: 'fake-planner',
    }),
    disclosedDataSha256: companionReplanDisclosedDataSha256({}),
    maximumCallCount: 1,
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T00:00:00.000Z',
    },
  };
}

describe('companion replan run coordinator', () => {
  it.each(['generationRequestId', 'revisionRequestId'] as const)(
    'rejects a completed generation with a mismatched %s before propose',
    async (mismatch) => {
      const database = openOperatingLineDatabase(':memory:');
      const instanceId = randomUUID();
      const revisionRequestId = randomUUID();
      const generationRequestId = randomUUID();
      database.recordGuideRevisionRequest({
        protocolVersion: '1.1.0',
        requestId: revisionRequestId,
        adapterId: 'blender',
        catalogVersion: '1.0.0',
        instanceId,
        basePlan,
        references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
        message: 'Make the referenced snowman head larger.',
        revisionThread: {
          threadId: revisionRequestId,
          turn: 1,
          parentRequestId: null,
        },
        occurredAt: new Date().toISOString(),
      });
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
            description: 'Identity mismatch fixture.',
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
      let proposeCalls = 0;
      const coordinator = createCompanionReplanRunCoordinator({
        database,
        providerRegistry,
        generationCoordinator: {
          generate: async () => {
            throw new Error('authorized path required');
          },
          generateAuthorized: async (request, authorizeProviderCall) => {
            authorizeProviderCall({
              request,
              packet: {} as never,
              registered: providerRegistry.findReplanner('fake-planner')!,
              runtimeTreatment: {
                treatment: { profile: { model: { requested: 'fake-v1' } } },
              } as never,
            });
            return {
              requestId: mismatch === 'generationRequestId' ? randomUUID() : generationRequestId,
              revisionRequestId:
                mismatch === 'revisionRequestId' ? randomUUID() : revisionRequestId,
              provider: { id: 'fake-planner', version: '0.1.0' },
              targetAdapterId: 'blender',
              targetInstanceId: instanceId,
            } as never;
          },
          completedResult: () => null,
          close: async () => undefined,
        },
        replanningService: {
          getPrompt: () => ({}) as never,
          propose: () => {
            proposeCalls += 1;
            return {} as never;
          },
        },
        authorityConsumptionCoordinator: new AuthorityConsumptionCoordinator(
          new InMemoryAuthorityConsumptionStore(),
        ),
        liveProviderAuthorityVerifier: {
          verify: ({ record, targetSha256 }) => {
            const parsed = record as ProviderCallAuthorization;
            return {
              formatVersion: '1.0.0',
              receiptId: randomUUID(),
              authorityKind: parsed.kind,
              authorityId: parsed.authorityId,
              authorityContentSha256: createHash('sha256')
                .update(canonicalizeProtocolJsonValue(authoritySignedContent(parsed)))
                .digest('hex'),
              signerId: parsed.signature.signerId,
              keyId: parsed.signature.keyId,
              registryVersion: 'test-v1',
              validatedAt: new Date().toISOString(),
              revocationLogHeadSha256: '0'.repeat(64),
              targetSha256,
              sideEffect: 'provider_call',
            };
          },
        },
      });
      try {
        coordinator.create({
          generationRequestId,
          revisionRequestId,
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'blender',
          targetInstanceId: instanceId,
          authorization: authorization({ generationRequestId, revisionRequestId }),
        });
        const deadline = Date.now() + 1_000;
        while (coordinator.get(generationRequestId)?.terminal !== true && Date.now() < deadline) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 5));
        }
        expect(coordinator.get(generationRequestId)).toMatchObject({
          status: 'failed',
          proposalId: null,
          sceneChanged: false,
        });
        expect(proposeCalls).toBe(0);
      } finally {
        coordinator.beginClose();
        await coordinator.close();
        await providerRegistry.close();
        database.close();
      }
    },
  );
});
