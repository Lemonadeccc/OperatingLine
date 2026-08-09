import { randomUUID } from 'node:crypto';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import { FakePlannerProvider, syntheticCanvasActionCatalog } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

import { createCompanionInitialPlanRunCoordinator } from '../../../services/orchestrator/src/companion-initial-plan-run.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';

describe('companion initial plan run coordinator', () => {
  it.each(['providerVersion', 'targetAdapterId'] as const)(
    'rejects a completed generation with a mismatched %s before proposal creation',
    async (mismatch) => {
      const database = openOperatingLineDatabase(':memory:');
      const goalRequestId = randomUUID();
      const generationRequestId = randomUUID();
      const instanceId = randomUUID();
      const goalRequest = {
        protocolVersion: '1.1.0' as const,
        requestId: goalRequestId,
        adapterId: 'canvas',
        catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
        instanceId,
        goal: 'Create a small launch diagram.',
        planId: 'launch-diagram',
        occurredAt: new Date().toISOString(),
      };
      database.recordGuideGoalRequest(goalRequest);
      const providerRegistry = createPlannerProviderRegistry([
        new FakePlannerProvider(() => {
          throw new Error('not used');
        }),
      ]);
      let proposalCalls = 0;
      const coordinator = createCompanionInitialPlanRunCoordinator({
        database,
        providerRegistry,
        generationCoordinator: {
          generate: async () => {
            throw new Error('not used');
          },
          generateForGoal: async () =>
            ({
              requestId: generationRequestId,
              provider: {
                id: 'fake-planner',
                version: mismatch === 'providerVersion' ? '9.9.9' : '0.1.0',
              },
              draft: {
                targetAdapterId: mismatch === 'targetAdapterId' ? 'blender' : 'canvas',
                catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
                planning: { goal: goalRequest.goal, requiredPhaseIds: [] },
                plan: { id: goalRequest.planId },
              },
            }) as never,
          completedResult: () => null,
          completedGoalResult: () => null,
          close: async () => undefined,
        },
        createProposal: () => {
          proposalCalls += 1;
          return {} as never;
        },
      });
      try {
        coordinator.create({
          generationRequestId,
          goalRequestId,
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'canvas',
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
        expect(proposalCalls).toBe(0);
      } finally {
        coordinator.beginClose();
        await coordinator.close();
        await providerRegistry.close();
        database.close();
      }
    },
  );
});
