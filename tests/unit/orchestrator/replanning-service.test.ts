import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import { guideRevisionRequestSchema, type GuidePlan } from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { createActionCatalogRegistry } from '../../../services/orchestrator/src/action-catalogs.js';
import { PlannerGenerationRuntimeError } from '../../../services/orchestrator/src/planner-provider-errors.js';
import { createReplanningService } from '../../../services/orchestrator/src/replanning-service.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function firstRequest() {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: randomUUID(),
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the referenced head larger.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
}

function createHarness() {
  const database = openOperatingLineDatabase(':memory:');
  const service = createReplanningService({
    database,
    actionCatalogRegistry: createActionCatalogRegistry([blenderActionCatalog]),
    listCompanionStates: () => [],
    resolveTargetRevision: (_planId, baseRevision) => baseRevision + 1,
    completedGeneration: () => null,
    createProposal: () => {
      throw new Error('proposal creation is outside this prompt-state test');
    },
  });
  return { database, service };
}

async function expectRuntimeError(
  operation: () => unknown,
  code: PlannerGenerationRuntimeError['code'],
): Promise<void> {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PlannerGenerationRuntimeError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected replanning runtime error ${code}`);
}

describe('replanning service request state', () => {
  it('distinguishes a missing revision request from a stale thread', async () => {
    const { database, service } = createHarness();
    await expectRuntimeError(
      () => service.getPrompt({ revisionRequestId: randomUUID() }),
      'planner_revision_request_not_found',
    );

    const first = firstRequest();
    const second = guideRevisionRequestSchema.parse({
      ...first,
      requestId: randomUUID(),
      basePlan: { ...basePlan, revision: basePlan.revision + 1 },
      revisionThread: {
        threadId: first.requestId,
        turn: 2,
        parentRequestId: first.requestId,
      },
      occurredAt: '2026-08-05T00:00:01.000Z',
    });
    expect(database.recordGuideRevisionRequest(first)).toBe('accepted');
    expect(database.recordGuideRevisionRequest(second)).toBe('accepted');
    await expectRuntimeError(
      () => service.getPrompt({ revisionRequestId: first.requestId }),
      'planner_revision_thread_stale',
    );
    database.close();
  });

  it('rejects a request that already has a Proposal before building a packet', async () => {
    const { database, service } = createHarness();
    const request = firstRequest();
    expect(database.recordGuideRevisionRequest(request)).toBe('accepted');
    database.recordGuideReplanProposal(
      {
        proposalId: randomUUID(),
        targetAdapterId: request.adapterId,
        targetInstanceId: request.instanceId,
        plan: { id: request.basePlan.id, revision: request.basePlan.revision + 1 },
        proposedAt: '2026-08-05T00:00:02.000Z',
      },
      request.requestId,
    );

    await expectRuntimeError(
      () => service.getPrompt({ revisionRequestId: request.requestId }),
      'planner_revision_request_not_pending',
    );
    database.close();
  });
});
