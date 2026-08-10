import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import type { GuidePlan } from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

import { createCompanionReplanRunCoordinator } from '../../../services/orchestrator/src/companion-replan-run.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

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
          generate: async () =>
            ({
              requestId: mismatch === 'generationRequestId' ? randomUUID() : generationRequestId,
              revisionRequestId:
                mismatch === 'revisionRequestId' ? randomUUID() : revisionRequestId,
              provider: { id: 'fake-planner', version: '0.1.0' },
              targetAdapterId: 'blender',
              targetInstanceId: instanceId,
            }) as never,
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
      });
      try {
        coordinator.create({
          generationRequestId,
          revisionRequestId,
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'blender',
          targetInstanceId: instanceId,
          authorization: {
            disclosureVersion: '1.0.0',
            dataHandlingAcknowledged: true,
            possibleChargesAcknowledged: true,
            proposalCreationAcknowledged: true,
            authorizedAt: new Date().toISOString(),
          },
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
