import { randomUUID } from 'node:crypto';

import { openOperatingLineDatabase } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  CompanionDialogueRunRequestError,
  createCompanionDialogueRunCoordinator,
} from '../../../services/orchestrator/src/companion-dialogue-run.js';

describe('legacy companion dialogue coordinator', () => {
  it('rejects boolean self-attestation before every Provider-capable dependency', () => {
    const database = openOperatingLineDatabase(':memory:');
    const providerCall = vi.fn();
    const coordinator = createCompanionDialogueRunCoordinator({
      database,
      providerRegistry: { get: providerCall },
      invocationManager: { run: providerCall },
      generationCoordinator: { generate: providerCall },
      replanningService: { propose: providerCall },
      revisionRequestService: { record: providerCall },
    });
    try {
      expect(() =>
        coordinator.create({
          dialogueRequestId: randomUUID(),
          replanGenerationRequestId: randomUUID(),
          providerId: 'fake-planner',
          providerVersion: '0.1.0',
          targetAdapterId: 'blender',
          targetInstanceId: randomUUID(),
          revisionRequest: {} as never,
          history: [],
          authorization: {} as never,
        }),
      ).toThrowError(CompanionDialogueRunRequestError);
      expect(providerCall).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });
});
