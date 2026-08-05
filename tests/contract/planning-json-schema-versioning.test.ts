import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it } from 'vitest';

import {
  buildPlanningPromptPacket,
  buildReplanningPromptPacket,
  createLocalReplanScope,
  evaluateLocalReplanScope,
  evaluatePlanningQuality,
  localReplanCoverageStepIds,
} from '@operatingline/orchestrator';
import {
  guideRevisionRequestSchema,
  plannerGenerationResultSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerationResultSchema,
  planningContextSchema,
  type ActionCatalog,
  type PlanningPromptPacket,
} from '@operatingline/protocol';
import {
  buildSyntheticCanvasDraft,
  buildSyntheticCanvasPlan,
  syntheticCanvasActionCatalog,
  syntheticCanvasHistoricalActionCatalog,
} from '@operatingline/test-kit';

import {
  validatePublicJsonSchemaCases,
  type PublicJsonSchemaCase,
} from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const generatedAt = '2026-08-05T00:00:00.000Z';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

async function expectPublicSchema(
  filename: string,
  ...cases: readonly PublicJsonSchemaCase[]
): Promise<void> {
  await validatePublicJsonSchemaCases(publicSchema(filename), cases);
}

function planningContext(catalog: ActionCatalog) {
  return planningContextSchema.parse({
    protocolVersion: '1.1.0',
    targetAdapterId: catalog.adapterId,
    goal: 'Create and export a launch canvas.',
    requestedPlanId: 'schema-canvas',
    recommendedRevision: 1,
    catalog,
    companionStates: [],
    constraints: {
      singleAdapterPlan: true,
      executableActionsMustBeLeaves: true,
      dependenciesMustReferenceExecutableActions: true,
      unknownActionsMustBeRejected: true,
      semanticAnchorsOnly: true,
      immutablePlanRevisions: true,
      humanApprovalRequired: true,
      executionOrder: 'dependsOn_topology_then_order_then_id',
    },
    submission: {
      toolName: 'operatingline.guide.propose',
      targetAdapterId: catalog.adapterId,
      description: 'Submit the complete candidate for review.',
    },
    qualityGate: {
      toolName: 'operatingline.planning.evaluate',
      baselineVersion: catalog.semanticCapabilities === undefined ? '1.0.0' : '1.1.0',
      requiredPhaseSelection: 'planner_declared_from_goal',
      description: 'Evaluate the complete candidate before proposal submission.',
    },
  });
}

function planningPacket(catalog: ActionCatalog): PlanningPromptPacket {
  return buildPlanningPromptPacket(planningContext(catalog));
}

function initialGenerationResult(packet: PlanningPromptPacket) {
  const draft = buildSyntheticCanvasDraft(packet);
  const planningQuality = evaluatePlanningQuality(
    {
      targetAdapterId: draft.targetAdapterId,
      catalogVersion: draft.catalogVersion,
      goal: draft.planning.goal,
      requiredPhaseIds: draft.planning.requiredPhaseIds,
      ...(draft.planning.capabilityCoverage === undefined
        ? {}
        : { capabilityCoverage: draft.planning.capabilityCoverage }),
      plan: draft.plan,
    },
    packet.context.catalog,
  );
  return plannerGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: randomUUID(),
    requestId: randomUUID(),
    provider: { id: 'schema-contract-planner', version: '1.0.0' },
    packetFormatVersion: packet.formatVersion,
    status: planningQuality.valid ? 'ready' : 'needs_revision',
    draft,
    planningQuality,
    proposalCreated: false,
    generatedAt,
    durationMs: 1,
  });
}

describe('public planning JSON Schema version invariants', () => {
  it('enforces capability-aware and historical context/packet versions through AJV', async () => {
    const currentPacket = planningPacket(syntheticCanvasActionCatalog);
    const historicalPacket = planningPacket(syntheticCanvasHistoricalActionCatalog);

    const capabilitiesWithoutPhases = structuredClone(syntheticCanvasActionCatalog);
    delete capabilitiesWithoutPhases.planningPhases;
    await expectPublicSchema(
      'action-catalog.schema.json',
      { value: syntheticCanvasActionCatalog, accepted: true },
      { value: capabilitiesWithoutPhases, accepted: false },
    );

    await expectPublicSchema(
      'planning-context.schema.json',
      {
        value: currentPacket.context,
        accepted: true,
      },
      {
        value: historicalPacket.context,
        accepted: true,
      },
      {
        value: {
          ...currentPacket.context,
          qualityGate: { ...currentPacket.context.qualityGate, baselineVersion: '1.0.0' },
        },
        accepted: false,
      },
      {
        value: {
          ...historicalPacket.context,
          qualityGate: { ...historicalPacket.context.qualityGate, baselineVersion: '1.1.0' },
        },
        accepted: false,
      },
    );

    await expectPublicSchema(
      'planning-prompt-packet.schema.json',
      { value: currentPacket, accepted: true },
      { value: historicalPacket, accepted: true },
      { value: { ...currentPacket, formatVersion: '1.0.0' }, accepted: false },
      { value: { ...historicalPacket, formatVersion: '1.1.0' }, accepted: false },
    );
  });

  it('rejects forged ready generation evidence and accepts deterministic missing coverage', async () => {
    const currentPacket = planningPacket(syntheticCanvasActionCatalog);
    const currentResult = initialGenerationResult(currentPacket);
    const missingDraft = structuredClone(currentResult.draft);
    delete missingDraft.planning.capabilityCoverage;
    const missingQuality = evaluatePlanningQuality(
      {
        targetAdapterId: missingDraft.targetAdapterId,
        catalogVersion: missingDraft.catalogVersion,
        goal: missingDraft.planning.goal,
        requiredPhaseIds: missingDraft.planning.requiredPhaseIds,
        plan: missingDraft.plan,
      },
      currentPacket.context.catalog,
    );
    const missingResult = plannerGenerationResultSchema.parse({
      ...currentResult,
      status: 'needs_revision',
      draft: missingDraft,
      planningQuality: missingQuality,
    });
    const forgedReady = structuredClone(currentResult);
    delete forgedReady.draft.planning.capabilityCoverage;
    delete forgedReady.planningQuality.capabilityCoverage;

    const historicalResult = initialGenerationResult(
      planningPacket(syntheticCanvasHistoricalActionCatalog),
    );
    await expectPublicSchema(
      'planning-quality-report.schema.json',
      { value: currentResult.planningQuality, accepted: true },
      { value: missingQuality, accepted: true },
      { value: forgedReady.planningQuality, accepted: false },
      { value: historicalResult.planningQuality, accepted: true },
    );
    await expectPublicSchema(
      'planner-generation-result.schema.json',
      { value: currentResult, accepted: true },
      { value: missingResult, accepted: true },
      { value: forgedReady, accepted: false },
      { value: { ...currentResult, packetFormatVersion: '1.0.0' }, accepted: false },
      { value: historicalResult, accepted: true },
      { value: { ...historicalResult, packetFormatVersion: '1.1.0' }, accepted: false },
    );
  });

  it('enforces the same versions and ready boundary for local replanning', async () => {
    const basePlan = buildSyntheticCanvasPlan({ id: 'schema-replan' });
    const revisionRequestId = randomUUID();
    const revisionRequest = guideRevisionRequestSchema.parse({
      protocolVersion: '1.1.0',
      requestId: revisionRequestId,
      adapterId: syntheticCanvasActionCatalog.adapterId,
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      instanceId: randomUUID(),
      basePlan,
      references: [{ nodeId: 'schema-replan.compose', nodeNumber: '1.1' }],
      message: 'Make the document creation step easier to understand.',
      revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
      occurredAt: generatedAt,
    });
    const packet = buildReplanningPromptPacket({
      revisionRequest,
      targetRevision: 2,
      catalog: syntheticCanvasActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(revisionRequest),
    });
    const targetPlan = structuredClone(basePlan);
    targetPlan.revision = 2;
    const createStep = targetPlan.steps.find((step) => step.id === 'schema-replan.create');
    if (createStep === undefined) {
      throw new Error('Synthetic canvas fixture is missing its create step');
    }
    createStep.explanation = 'Creates the requested document with a clearer teaching label.';
    const draft = plannerReplanDraftSchema.parse({
      requestId: revisionRequest.requestId,
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      planning: {
        goal: revisionRequest.message,
        requiredPhaseIds: ['compose', 'deliver'],
        capabilityCoverage: {
          policyVersion: 'catalog_capability_coverage_v1',
          requirements: [
            {
              requirementId: 'clearer-create-step',
              statement: 'Make document creation easier to understand.',
              coverage: [
                {
                  capabilityId: 'document.compose',
                  stepIds: ['schema-replan.create'],
                },
              ],
            },
          ],
        },
      },
      plan: targetPlan,
    });
    const planningQuality = evaluatePlanningQuality(
      {
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: draft.catalogVersion,
        goal: draft.planning.goal,
        requiredPhaseIds: draft.planning.requiredPhaseIds,
        capabilityCoverage: draft.planning.capabilityCoverage,
        plan: draft.plan,
      },
      syntheticCanvasActionCatalog,
      { allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, draft.plan) },
    );
    const scopeEvaluation = evaluateLocalReplanScope(revisionRequest, draft.plan);
    const result = plannerReplanGenerationResultSchema.parse({
      formatVersion: '1.0.0',
      generationId: randomUUID(),
      requestId: randomUUID(),
      revisionRequestId: revisionRequest.requestId,
      targetAdapterId: revisionRequest.adapterId,
      targetInstanceId: revisionRequest.instanceId,
      provider: { id: 'schema-contract-planner', version: '1.0.0' },
      packetFormatVersion: packet.formatVersion,
      status: 'ready',
      draft,
      planDiff: scopeEvaluation.planDiff,
      planningQuality,
      locality: scopeEvaluation.locality,
      proposalCreated: false,
      generatedAt,
      durationMs: 1,
    });
    const forgedReady = structuredClone(result);
    delete forgedReady.draft.planning.capabilityCoverage;
    delete forgedReady.planningQuality.capabilityCoverage;

    const historicalRequestId = randomUUID();
    const historicalRevisionRequest = guideRevisionRequestSchema.parse({
      ...revisionRequest,
      requestId: historicalRequestId,
      catalogVersion: syntheticCanvasHistoricalActionCatalog.catalogVersion,
      revisionThread: { threadId: historicalRequestId, turn: 1, parentRequestId: null },
    });
    const historicalPacket = buildReplanningPromptPacket({
      revisionRequest: historicalRevisionRequest,
      targetRevision: 2,
      catalog: syntheticCanvasHistoricalActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(historicalRevisionRequest),
    });
    const historicalDraft = plannerReplanDraftSchema.parse({
      requestId: historicalRevisionRequest.requestId,
      catalogVersion: syntheticCanvasHistoricalActionCatalog.catalogVersion,
      planning: {
        goal: historicalRevisionRequest.message,
        requiredPhaseIds: ['compose', 'deliver'],
      },
      plan: targetPlan,
    });
    const historicalQuality = evaluatePlanningQuality(
      {
        targetAdapterId: historicalRevisionRequest.adapterId,
        catalogVersion: historicalDraft.catalogVersion,
        goal: historicalDraft.planning.goal,
        requiredPhaseIds: historicalDraft.planning.requiredPhaseIds,
        plan: historicalDraft.plan,
      },
      syntheticCanvasHistoricalActionCatalog,
    );
    const historicalScope = evaluateLocalReplanScope(
      historicalRevisionRequest,
      historicalDraft.plan,
    );
    const historicalResult = plannerReplanGenerationResultSchema.parse({
      ...result,
      generationId: randomUUID(),
      requestId: randomUUID(),
      revisionRequestId: historicalRevisionRequest.requestId,
      targetInstanceId: historicalRevisionRequest.instanceId,
      packetFormatVersion: historicalPacket.formatVersion,
      draft: historicalDraft,
      planDiff: historicalScope.planDiff,
      planningQuality: historicalQuality,
      locality: historicalScope.locality,
    });

    await expectPublicSchema(
      'replanning-prompt-packet.schema.json',
      { value: packet, accepted: true },
      { value: { ...packet, formatVersion: '1.0.0' }, accepted: false },
      { value: historicalPacket, accepted: true },
      { value: { ...historicalPacket, formatVersion: '1.1.0' }, accepted: false },
    );
    await expectPublicSchema(
      'planner-replan-generation-result.schema.json',
      { value: result, accepted: true },
      { value: { ...result, packetFormatVersion: '1.0.0' }, accepted: false },
      { value: forgedReady, accepted: false },
      { value: historicalResult, accepted: true },
      { value: { ...historicalResult, packetFormatVersion: '1.1.0' }, accepted: false },
    );
  });
});
