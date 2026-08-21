import { randomUUID } from 'node:crypto';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  CompanionInitialPlanRunRequestError,
  createCompanionInitialPlanRunCoordinator,
} from '../../../services/orchestrator/src/companion-initial-plan-run.js';

describe('legacy companion initial plan coordinator', () => {
  it('rejects boolean self-attestation before every Provider-capable dependency', () => {
    const database = openOperatingLineDatabase(':memory:');
    const providerCall = vi.fn();
    const proposalCall = vi.fn();
    const coordinator = createCompanionInitialPlanRunCoordinator({
      database,
      providerRegistry: { get: providerCall },
      generationCoordinator: { generateForGoal: providerCall },
      createProposal: proposalCall,
    });
    try {
      expect(() =>
        coordinator.create({
          generationRequestId: randomUUID(),
          goalRequestId: randomUUID(),
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'blender',
          targetInstanceId: randomUUID(),
          authorization: {
            disclosureVersion: '1.0.0',
            dataHandlingAcknowledged: true,
            possibleChargesAcknowledged: true,
            proposalCreationAcknowledged: true,
            authorizedAt: new Date().toISOString(),
          },
        }),
      ).toThrowError(CompanionInitialPlanRunRequestError);
      expect(providerCall).not.toHaveBeenCalled();
      expect(proposalCall).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });
});
