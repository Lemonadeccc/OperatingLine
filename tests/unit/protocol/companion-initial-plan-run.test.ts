import { randomUUID } from 'node:crypto';

import {
  companionInitialPlanRunContractVersion,
  companionInitialPlanRunCreateRequestSchema,
  companionInitialPlanRunErrorSchema,
  companionInitialPlanRunSchema,
  companionInitialPlanRunStatusRequestSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

function createRequest() {
  return {
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
      authorizedAt: '2026-08-09T12:00:00.000Z',
    },
  } as const;
}

function run(status: string) {
  const request = createRequest();
  return {
    contractVersion: companionInitialPlanRunContractVersion,
    generationRequestId: request.generationRequestId,
    goalRequestId: request.goalRequestId,
    targetAdapterId: request.targetAdapterId,
    targetInstanceId: request.targetInstanceId,
    provider: {
      id: request.providerId,
      version: request.providerVersion,
      displayName: 'Fake Planner',
    },
    status,
    terminal: false,
    sceneChanged: false,
    proposalId: null,
    error: null,
    needsRevision: null,
    updatedAt: '2026-08-09T12:00:01.000Z',
  };
}

describe('companion initial plan run protocol', () => {
  it('binds explicit authorization to the goal, provider, and target', () => {
    const request = createRequest();
    expect(companionInitialPlanRunCreateRequestSchema.parse(request)).toEqual(request);
    expect(
      companionInitialPlanRunCreateRequestSchema.safeParse({
        ...request,
        authorization: { ...request.authorization, dataHandlingAcknowledged: false },
      }).success,
    ).toBe(false);
    expect(
      companionInitialPlanRunCreateRequestSchema.safeParse({
        ...request,
        authorization: { ...request.authorization, disclosureVersion: '0.9.0' },
      }).success,
    ).toBe(false);
    expect(
      companionInitialPlanRunCreateRequestSchema.safeParse({
        ...request,
        generationRequestId: request.goalRequestId,
      }).success,
    ).toBe(false);
    expect(
      companionInitialPlanRunCreateRequestSchema.safeParse({ ...request, ambientConsent: true })
        .success,
    ).toBe(false);
  });

  it('looks up only by the exact generation request id', () => {
    const generationRequestId = randomUUID();
    expect(companionInitialPlanRunStatusRequestSchema.parse({ generationRequestId })).toEqual({
      generationRequestId,
    });
    expect(
      companionInitialPlanRunStatusRequestSchema.safeParse({ generationRequestId, providerId: 'x' })
        .success,
    ).toBe(false);
  });

  it('keeps active runs nonterminal and scene-safe', () => {
    for (const status of ['queued', 'generating']) {
      expect(companionInitialPlanRunSchema.safeParse(run(status)).success).toBe(true);
      expect(
        companionInitialPlanRunSchema.safeParse({ ...run(status), terminal: true }).success,
      ).toBe(false);
      expect(
        companionInitialPlanRunSchema.safeParse({ ...run(status), sceneChanged: true }).success,
      ).toBe(false);
    }
  });

  it('requires planning-only blocking evidence for needs_revision', () => {
    const needsRevision = {
      ...run('needs_revision'),
      terminal: true,
      needsRevision: {
        planning: {
          errorCount: 1,
          warningCount: 0,
          findings: [
            {
              code: 'plan.no_executable_steps',
              severity: 'error',
              message: 'The plan has no executable steps.',
              stepIds: [],
              phaseIds: [],
            },
          ],
        },
      },
    };
    expect(companionInitialPlanRunSchema.safeParse(needsRevision).success).toBe(true);
    expect(
      companionInitialPlanRunSchema.safeParse({
        ...needsRevision,
        needsRevision: {
          ...needsRevision.needsRevision,
          locality: { valid: false, findings: [] },
        },
      }).success,
    ).toBe(false);
    expect(
      companionInitialPlanRunSchema.safeParse({
        ...needsRevision,
        needsRevision: {
          planning: { ...needsRevision.needsRevision.planning, errorCount: 0 },
        },
      }).success,
    ).toBe(false);
  });

  it('requires exclusive proposal and safe error terminal evidence', () => {
    expect(
      companionInitialPlanRunSchema.safeParse({
        ...run('proposal_created'),
        terminal: true,
        proposalId: randomUUID(),
      }).success,
    ).toBe(true);
    const error = companionInitialPlanRunErrorSchema.parse({
      code: 'planner_provider_failed',
      retryMode: 'new_request_id',
      message: 'Planner provider failed before proposal creation',
    });
    for (const status of ['failed', 'interrupted']) {
      expect(
        companionInitialPlanRunSchema.safeParse({ ...run(status), terminal: true, error }).success,
      ).toBe(true);
    }
    expect(
      companionInitialPlanRunSchema.safeParse({
        ...run('failed'),
        terminal: true,
        error: { ...error, retryMode: 'same_request_id' },
      }).success,
    ).toBe(false);
  });
});
