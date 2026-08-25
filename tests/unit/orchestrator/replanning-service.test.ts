import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  guidePlanSchema,
  guideProposalSchema,
  guideRevisionRequestSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerationResultSchema,
  projectGuidePlanForProvider,
  type GuidePlan,
  type PlannerReplanDraft,
  type PlannerReplanGenerationResult,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { createActionCatalogRegistry } from '../../../services/orchestrator/src/action-catalogs.js';
import { computeGuidePlanDiff } from '../../../services/orchestrator/src/guide-plan-diff.js';
import {
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
} from '../../../services/orchestrator/src/local-replan-scope.js';
import { PlannerGenerationRuntimeError } from '../../../services/orchestrator/src/planner-provider-errors.js';
import { evaluatePlanningQuality } from '../../../services/orchestrator/src/planning-quality.js';
import { createReplanningService } from '../../../services/orchestrator/src/replanning-service.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;
const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
const capabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'larger-head',
      statement: 'Make the referenced snowman head larger.',
      coverage: [{ capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] }],
    },
  ],
};

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

function planWithCandidateMenuProjection(stepId: string): GuidePlan {
  return guidePlanSchema.parse({
    ...basePlan,
    protocolVersion: '1.7.0',
    steps: basePlan.steps.map((step) =>
      step.id !== stepId
        ? step
        : {
            ...step,
            candidateMenuProjection: {
              projection: 'candidate_only',
              interactionCatalogVersion: '1.50.0',
              id: `${stepId}.edit_subdivide_candidate`,
              modality: 'menu',
              equivalence: 'not_equivalent_to_managed_action',
              executionAuthority: 'none',
              title: 'Edit Subdivide candidate',
              reason: 'Keep a bounded host-owned native-menu candidate.',
              preconditions: [{ kind: 'mode', label: 'Mode', value: 'Edit Mode' }],
              operations: [
                {
                  id: `${stepId}.edit_subdivide_candidate.open`,
                  order: 1,
                  semanticRefs: [stepId],
                  description: 'Open Edit > Subdivide.',
                  evidenceRefs: [],
                  intent: 'navigate',
                  target: { kind: 'menu_item', hostId: 'mesh.subdivide' },
                  path: ['Edit', 'Subdivide'],
                  parameters: {},
                },
              ],
              omittedActionArguments: [],
            },
          },
    ),
  });
}

function candidateRevisionRequest(candidateStepId: string) {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.7.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: randomUUID(),
    basePlan: planWithCandidateMenuProjection(candidateStepId),
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the referenced head larger.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    revisionOperation: { kind: 'revise' },
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
}

function generatedDraftFor(
  request: ReturnType<typeof candidateRevisionRequest>,
): PlannerReplanDraft {
  const plan = structuredClone(projectGuidePlanForProvider(request.basePlan));
  plan.revision += 1;
  const head = plan.steps.find((step) => step.id === 'snowman.model.head');
  if (head === undefined) throw new Error('Snowman fixture is missing its head step');
  head.title = 'Create a larger snowman head';
  return plannerReplanDraftSchema.parse({
    requestId: request.requestId,
    catalogVersion: request.catalogVersion,
    planning: { goal: request.message, requiredPhaseIds, capabilityCoverage },
    plan,
  });
}

function completedGenerationFor(
  request: ReturnType<typeof candidateRevisionRequest>,
  draft: PlannerReplanDraft,
): PlannerReplanGenerationResult {
  const providerRequest = {
    ...request,
    basePlan: projectGuidePlanForProvider(request.basePlan),
  };
  const scopeEvaluation = evaluateLocalReplanScope(providerRequest, draft.plan);
  const planningQuality = evaluatePlanningQuality(
    {
      targetAdapterId: request.adapterId,
      catalogVersion: draft.catalogVersion,
      goal: draft.planning.goal,
      requiredPhaseIds: draft.planning.requiredPhaseIds,
      capabilityCoverage: draft.planning.capabilityCoverage,
      plan: draft.plan,
    },
    blenderActionCatalog,
  );
  return plannerReplanGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: randomUUID(),
    requestId: randomUUID(),
    revisionRequestId: request.requestId,
    targetAdapterId: request.adapterId,
    targetInstanceId: request.instanceId,
    provider: { id: 'fake-planner', version: '0.1.0' },
    packetFormatVersion: '1.1.0',
    status: 'ready',
    draft,
    planDiff: scopeEvaluation.planDiff,
    planningQuality,
    locality: scopeEvaluation.locality,
    proposalCreated: false,
    generatedAt: '2026-08-05T00:00:01.000Z',
    durationMs: 1,
  });
}

function generatedProposalHarness(candidateStepId: string) {
  const request = candidateRevisionRequest(candidateStepId);
  const draft = generatedDraftFor(request);
  const generation = completedGenerationFor(request, draft);
  const database = openOperatingLineDatabase(':memory:');
  let createdPlan: GuidePlan | null = null;
  let proposalCreationCount = 0;
  const service = createReplanningService({
    database,
    actionCatalogRegistry: createActionCatalogRegistry([blenderActionCatalog]),
    listCompanionStates: () => [],
    resolveTargetRevision: (_planId, baseRevision) => baseRevision + 1,
    completedGeneration: (requestId) => (requestId === generation.requestId ? generation : null),
    createProposal: (input) => {
      proposalCreationCount += 1;
      createdPlan = structuredClone(input.plan);
      const planningQuality = evaluatePlanningQuality(
        {
          targetAdapterId: input.targetAdapterId,
          catalogVersion: input.catalogVersion,
          goal: input.planning?.goal,
          requiredPhaseIds: input.planning?.requiredPhaseIds ?? [],
          ...(input.planning?.capabilityCoverage === undefined
            ? {}
            : { capabilityCoverage: input.planning.capabilityCoverage }),
          plan: input.plan,
        },
        blenderActionCatalog,
        { allowedCoverageStepIds: localReplanCoverageStepIds(request, input.plan) },
      );
      const proposal = guideProposalSchema.parse({
        protocolVersion: input.plan.protocolVersion,
        proposalId: randomUUID(),
        targetAdapterId: input.targetAdapterId,
        targetInstanceId: input.targetInstanceId,
        plan: input.plan,
        revisionRequestId: request.requestId,
        revisionThread: request.revisionThread,
        revisionOperation: request.revisionOperation,
        planDiff: computeGuidePlanDiff(request.basePlan, input.plan),
        catalogVersion: input.catalogVersion,
        proposedAt: '2026-08-05T00:00:02.000Z',
      });
      database.recordGuideReplanProposal(
        proposal,
        request.requestId,
        input.replan.generationRequestId,
      );
      return { proposal, planningQuality };
    },
  });
  expect(database.recordGuideRevisionRequest(request)).toBe('accepted');
  return {
    database,
    service,
    request,
    draft,
    generation,
    createdPlan: () => createdPlan,
    proposalCreationCount: () => proposalCreationCount,
  };
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

  it('restores an unchanged host-owned candidate after exact Provider draft verification', () => {
    const harness = generatedProposalHarness('snowman.model.body_lower');

    harness.service.propose({
      ...harness.draft,
      generationRequestId: harness.generation.requestId,
    });

    expect(JSON.stringify(harness.draft)).not.toContain('candidateMenuProjection');
    expect(
      harness.createdPlan()?.steps.find((step) => step.id === 'snowman.model.body_lower')
        ?.candidateMenuProjection,
    ).toMatchObject({ executionAuthority: 'none' });
    harness.database.close();
  });

  it('does not restore a stale candidate onto a Provider-modified step', () => {
    const harness = generatedProposalHarness('snowman.model.head');

    harness.service.propose({
      ...harness.draft,
      generationRequestId: harness.generation.requestId,
    });

    expect(
      harness.createdPlan()?.steps.find((step) => step.id === 'snowman.model.head')
        ?.candidateMenuProjection,
    ).toBeUndefined();
    harness.database.close();
  });

  it('rejects candidate injection before host-owned restoration', async () => {
    const harness = generatedProposalHarness('snowman.model.body_lower');
    const forgedPlan = structuredClone(harness.draft.plan) as GuidePlan;
    const forgedStep = forgedPlan.steps.find((step) => step.id === 'snowman.model.body_lower');
    const trustedStep = harness.request.basePlan.steps.find(
      (step) => step.id === 'snowman.model.body_lower',
    );
    if (forgedStep === undefined || trustedStep?.candidateMenuProjection === undefined) {
      throw new Error('Candidate fixture is incomplete');
    }
    forgedStep.candidateMenuProjection = structuredClone(trustedStep.candidateMenuProjection);

    await expectRuntimeError(
      () =>
        harness.service.propose({
          ...harness.draft,
          plan: forgedPlan,
          generationRequestId: harness.generation.requestId,
        }),
      'planner_identity_mismatch',
    );
    expect(harness.createdPlan()).toBeNull();
    harness.database.close();
  });

  it('treats the same raw generated draft as an idempotent canonical duplicate', () => {
    const harness = generatedProposalHarness('snowman.model.body_lower');
    const submission = {
      ...harness.draft,
      generationRequestId: harness.generation.requestId,
    };

    const first = harness.service.propose(submission);
    const duplicate = harness.service.propose(submission);

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      proposalId: first.proposalId,
      revision: first.revision,
    });
    expect(harness.proposalCreationCount()).toBe(1);
    expect(
      harness.createdPlan()?.steps.find((step) => step.id === 'snowman.model.body_lower')
        ?.candidateMenuProjection,
    ).toMatchObject({ executionAuthority: 'none' });
    harness.database.close();
  });
});
