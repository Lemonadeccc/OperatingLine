import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  companionActionExecutionStatusSchema,
  guidePlanSchema,
  guideRevisionRequestSchema,
  plannerReplanGenerationResultSchema,
  projectGuidePlanForProvider,
  type GuidePlan,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  createProcedureExecutionFailureReplanCoordinator,
  type CanonicalProcedureExecutionFailureEvidence,
  type ProcedureExecutionFailurePolicyEvidenceResolver,
  type ProcedureExecutionFailureReplanRequest,
  type TrustedProcedureExecutionFailureReplanResolution,
} from '../../../services/orchestrator/src/procedure-execution-failure-replan.js';
import { validateGuidePlanAgainstActionCatalog } from '../../../services/orchestrator/src/guide-validation.js';
import {
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
} from '../../../services/orchestrator/src/local-replan-scope.js';
import { evaluatePlanningQuality } from '../../../services/orchestrator/src/planning-quality.js';

const fixturePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function createEventDatabase() {
  const events: StoredExecutionEvent[] = [];
  return {
    events,
    appendEvent(input: ExecutionEventInput): StoredExecutionEvent {
      if (events.some((event) => event.id === input.id)) throw new Error('duplicate event');
      const event = {
        sequence: events.length + 1,
        id: input.id,
        eventType: input.eventType,
        payload: structuredClone(input.payload),
        createdAt: input.createdAt ?? '2026-08-21T10:00:00Z',
      };
      events.push(event);
      return event;
    },
    listExecutionEventsByTypes(types: readonly string[]) {
      return events.filter((event) => types.includes(event.eventType));
    },
  };
}

function failedExecution() {
  const requestId = randomUUID();
  const replayId = randomUUID();
  const deliveryId = randomUUID();
  const target = { adapterId: 'blender' as const, instanceId: randomUUID() };
  const proposalId = randomUUID();
  const plan = { id: fixturePlan.id, revision: fixturePlan.revision };
  const planContentSha256 = contentHash(fixturePlan);
  const executionId = randomUUID();
  const expectedState = { reportId: randomUUID(), sequence: 7 };
  const result = {
    formatVersion: '1.0.0' as const,
    requestId,
    replayId,
    deliveryId,
    target,
    proposalId,
    plan,
    planContentSha256,
    executionId,
    expectedState,
    stepId: 'snowman.model.head',
    status: 'failed' as const,
    report: { reportId: randomUUID(), sequence: 8 },
    error: 'Observation did not match.',
    occurredAt: '2026-08-21T10:00:01Z',
  };
  return companionActionExecutionStatusSchema.parse({
    formatVersion: '1.0.0',
    requestId,
    replayId,
    target,
    proposalId,
    plan,
    planContentSha256,
    executionId,
    expectedState,
    deliveryId,
    dispatchedAt: '2026-08-21T09:59:59Z',
    step: {
      id: 'snowman.model.head',
      parentId: null,
      order: 0,
      dependsOn: [],
      title: 'Create sphere',
      intent: 'Create bounded sphere',
      explanation: 'Create the exact accepted sphere.',
      state: 'ready',
      action: {
        adapterId: 'blender',
        name: 'blender.mesh.create_uv_sphere',
        arguments: {
          resourceId: 'sphere',
          objectName: 'OperatingLine.Sphere',
          radius: 2,
          location: [0, 0, 0],
        },
      },
      anchors: [],
      expectedObservations: [
        { kind: 'uv_sphere_ready', parameters: { objectName: 'OperatingLine.Sphere' } },
      ],
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'native_undo', checkpointRequired: true },
    },
    requestedAt: '2026-08-21T09:59:58Z',
    status: 'failed',
    result,
    updatedAt: result.occurredAt,
  });
}

function canonicalEvidence(): CanonicalProcedureExecutionFailureEvidence {
  const execution = failedExecution();
  const identity = {
    requestId: execution.requestId,
    replayId: execution.replayId,
    executionId: execution.executionId,
    stepId: execution.step.id,
  };
  return {
    execution,
    delivery: {
      formatVersion: execution.formatVersion,
      requestId: execution.requestId,
      replayId: execution.replayId,
      target: execution.target,
      proposalId: execution.proposalId,
      plan: execution.plan,
      planContentSha256: execution.planContentSha256,
      executionId: execution.executionId,
      expectedState: execution.expectedState,
      deliveryId: execution.deliveryId!,
      step: execution.step,
      requestedAt: execution.requestedAt,
      dispatchedAt: execution.dispatchedAt!,
    },
    actionResult: execution.result!,
    report: {
      ...identity,
      reportId: execution.result!.report!.reportId,
      sequence: execution.result!.report!.sequence,
      occurredAt: '2026-08-21T10:00:00.100Z',
      content: { observedObject: 'OperatingLine.Sphere' },
    },
    observationFailures: [
      {
        ...identity,
        kind: 'uv_sphere_ready',
        expected: { objectName: 'OperatingLine.Sphere' },
        actual: { radius: 1.5 },
        occurredAt: '2026-08-21T10:00:00.200Z',
        receipt: {
          ...identity,
          receiptId: randomUUID(),
          occurredAt: '2026-08-21T10:00:00.200Z',
          content: { kind: 'observation' },
        },
      },
    ],
    checkpoint: {
      ...identity,
      state: 'restored',
      occurredAt: '2026-08-21T10:00:00.300Z',
      receipt: {
        ...identity,
        receiptId: randomUUID(),
        occurredAt: '2026-08-21T10:00:00.300Z',
        content: { kind: 'checkpoint' },
      },
    },
    recovery: {
      ...identity,
      state: 'recovered',
      occurredAt: '2026-08-21T10:00:01.100Z',
      receipt: {
        ...identity,
        receiptId: randomUUID(),
        occurredAt: '2026-08-21T10:00:01.100Z',
        content: { kind: 'recovery' },
      },
    },
    attempts: [{ ...identity, attempt: 1, occurredAt: execution.requestedAt }],
  };
}

function failureEnvelopeSha256(evidence: CanonicalProcedureExecutionFailureEvidence): string {
  const execution = evidence.execution;
  return contentHash({
    formatVersion: '1.0.0',
    requestId: execution.requestId,
    replayId: execution.replayId,
    planId: execution.plan.id,
    planRevision: execution.plan.revision,
    planContentSha256: execution.planContentSha256,
    stepId: execution.step.id,
    actionName: execution.step.action!.name,
    actionCatalogVersion: blenderActionCatalog.catalogVersion,
    interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
    attemptCount: evidence.attempts.length,
    failure: 'observation_failed',
    observationFailures: evidence.observationFailures.map((observation) => ({
      kind: observation.kind,
      expected: observation.expected,
      actual: observation.actual,
      receiptSha256: contentHash(observation.receipt),
    })),
    nativeEvidence: {
      checkpointState: evidence.checkpoint.state,
      checkpointReceiptSha256: contentHash(evidence.checkpoint.receipt),
      recoveryState: evidence.recovery.state,
      recoveryReceiptSha256: contentHash(evidence.recovery.receipt),
    },
    receiptHashes: {
      delivery: contentHash(evidence.delivery),
      action: contentHash(evidence.actionResult),
      report: contentHash(evidence.report),
    },
    terminalAt: execution.result!.occurredAt,
  });
}

function strategyPolicy(
  trajectory: readonly unknown[] = [{ action: 'create_uv_sphere', semantic: 'snowman.model.head' }],
) {
  return {
    currentTrackId: 'mcp.primary',
    tracks: [
      {
        semanticLeafId: 'snowman.model.head',
        modality: 'mcp' as const,
        trackId: 'mcp.primary',
        trajectory,
        observationObligations: [
          { kind: 'uv_sphere_ready', parameters: { objectName: 'OperatingLine.Sphere' } },
        ],
      },
      {
        semanticLeafId: 'snowman.model.head',
        modality: 'menu' as const,
        trackId: 'menu.alternate',
        trajectory: [{ action: 'Layout>Add>Mesh>UV Sphere' }],
        observationObligations: [
          { kind: 'uv_sphere_ready', parameters: { objectName: 'OperatingLine.Sphere' } },
        ],
      },
    ],
  };
}

function trustedResolution(
  evidence: CanonicalProcedureExecutionFailureEvidence,
  overrides: Partial<TrustedProcedureExecutionFailureReplanResolution> = {},
): TrustedProcedureExecutionFailureReplanResolution {
  return {
    failureEvidence: evidence,
    actionCatalog: blenderActionCatalog,
    interactionCatalog: blenderInteractionCatalog,
    currentAcceptedRevision: evidence.execution.plan.revision,
    currentPlanContentSha256: evidence.execution.planContentSha256,
    currentActionCatalogVersion: blenderActionCatalog.catalogVersion,
    currentInteractionCatalogVersion: blenderInteractionCatalog.catalogVersion,
    repairableArguments: [{ argument: 'radius', minimum: 0.5, maximum: 3 }],
    parameterRepairCandidates: [
      {
        argument: 'radius',
        value: 1.5,
        observationObligations: [{ kind: 'uv_sphere_ready', parameters: {} }],
      },
    ],
    strategy: strategyPolicy(),
    semanticCandidate: null,
    ...overrides,
  };
}

function trustedResolver(
  resolution: TrustedProcedureExecutionFailureReplanResolution | null,
): ProcedureExecutionFailurePolicyEvidenceResolver {
  return { resolve: () => resolution };
}

function request(
  evidence: CanonicalProcedureExecutionFailureEvidence,
): ProcedureExecutionFailureReplanRequest {
  return { requestId: evidence.execution.requestId };
}

function planWithCandidateMenuProjection(stepId: string): GuidePlan {
  return guidePlanSchema.parse({
    ...fixturePlan,
    protocolVersion: '1.7.0',
    steps: fixturePlan.steps.map((step) =>
      step.id !== stepId
        ? step
        : {
            ...step,
            candidateMenuProjection: {
              projection: 'candidate_only',
              interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
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

function evidenceForPlan(plan: GuidePlan): CanonicalProcedureExecutionFailureEvidence {
  const evidence = canonicalEvidence();
  const planIdentity = { id: plan.id, revision: plan.revision };
  const planContentSha256 = contentHash(plan);
  const actionResult = {
    ...evidence.actionResult,
    plan: planIdentity,
    planContentSha256,
  };
  return {
    ...evidence,
    execution: {
      ...evidence.execution,
      plan: planIdentity,
      planContentSha256,
      result: actionResult,
    },
    delivery: { ...evidence.delivery, plan: planIdentity, planContentSha256 },
    actionResult,
  };
}

function semanticCandidateFor(
  evidence: CanonicalProcedureExecutionFailureEvidence,
  basePlan: GuidePlan,
  modifiedStepId: string,
) {
  const revisionRequestId = randomUUID();
  const revisionRequest = guideRevisionRequestSchema.parse({
    protocolVersion: basePlan.protocolVersion,
    requestId: revisionRequestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: evidence.execution.target.instanceId,
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Repair only the failed head step.',
    revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
    revisionOperation: { kind: 'revise' },
    occurredAt: '2026-08-21T10:00:01.050Z',
  });
  const candidatePlan = structuredClone(projectGuidePlanForProvider(basePlan));
  candidatePlan.revision += 1;
  candidatePlan.steps.find((step) => step.id === modifiedStepId)!.title += ' repaired';
  const planning = {
    goal: revisionRequest.message,
    requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
    capabilityCoverage: {
      policyVersion: 'catalog_capability_coverage_v1' as const,
      requirements: [
        {
          requirementId: 'repair-head',
          statement: 'Repair only the failed head step.',
          coverage: [
            {
              capabilityId: 'geometry.primitive_assembly',
              stepIds: ['snowman.model.head'],
            },
          ],
        },
      ],
    },
  };
  const providerRevisionRequest = guideRevisionRequestSchema.parse({
    ...revisionRequest,
    basePlan: projectGuidePlanForProvider(basePlan),
  });
  const scopeEvaluation = evaluateLocalReplanScope(providerRevisionRequest, candidatePlan);
  const planningQuality = evaluatePlanningQuality(
    {
      targetAdapterId: revisionRequest.adapterId,
      catalogVersion: blenderActionCatalog.catalogVersion,
      ...planning,
      plan: candidatePlan,
    },
    blenderActionCatalog,
    {
      allowedCoverageStepIds: localReplanCoverageStepIds(providerRevisionRequest, candidatePlan),
    },
  );
  const generationRequestId = randomUUID();
  const generationResult = plannerReplanGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: randomUUID(),
    requestId: generationRequestId,
    revisionRequestId,
    targetAdapterId: revisionRequest.adapterId,
    targetInstanceId: revisionRequest.instanceId,
    provider: { id: 'failure-replan-planner', version: '1.0.0' },
    packetFormatVersion: '1.1.0',
    status: 'ready',
    draft: {
      requestId: revisionRequestId,
      catalogVersion: blenderActionCatalog.catalogVersion,
      planning,
      plan: candidatePlan,
    },
    planDiff: scopeEvaluation.planDiff,
    planningQuality,
    locality: scopeEvaluation.locality,
    proposalCreated: false,
    generatedAt: '2026-08-21T10:00:01.200Z',
    durationMs: 100,
  });
  const policyResolution = trustedResolution(evidence, {
    repairableArguments: [],
    parameterRepairCandidates: [],
    strategy: null,
  });
  const exactFailureEnvelopeSha256 = failureEnvelopeSha256(evidence);
  const failureBinding = {
    failureEnvelopeSha256: exactFailureEnvelopeSha256,
    failedStepId: evidence.execution.step.id,
    allowedScopeRootIds: [evidence.execution.step.id],
    deterministicExhaustionSha256: contentHash({
      failureEnvelopeSha256: exactFailureEnvelopeSha256,
      failedStepId: evidence.execution.step.id,
      policySha256: contentHash({
        repairableArguments: policyResolution.repairableArguments,
        parameterRepairCandidates: policyResolution.parameterRepairCandidates,
        strategy: policyResolution.strategy,
      }),
      parameterCandidate: null,
      strategyCandidate: null,
    }),
  };
  const generationResultSha256 = contentHash(generationResult);
  const credentialId = randomUUID();
  const confidenceEvaluation = {
    ...failureBinding,
    generationRequestId,
    revisionRequestId,
    generationResultSha256,
    candidatePlanContentSha256: contentHash(candidatePlan),
    confidence: 0.8,
    evaluatedAt: '2026-08-21T10:00:01.300Z',
  };
  const semanticCandidate = {
    revisionRequest,
    candidatePlan,
    generationResult,
    observationObligations: [{ kind: 'uv_sphere_ready', parameters: {} }],
    generationEvidence: {
      ...failureBinding,
      generationRequestId,
      generationResultSha256,
      generatedAt: generationResult.generatedAt,
    },
    authorizationConsumption: {
      ...failureBinding,
      event: {
        formatVersion: '1.0.0' as const,
        eventId: randomUUID(),
        sequence: 1,
        kind: 'provider_authorization_consumed' as const,
        credentialId,
        singleUseKeySha256: contentHash('single-use'),
        operationId: generationRequestId,
        bindingSha256: contentHash({ generationRequestId, ...failureBinding }),
        consumedAt: '2026-08-21T10:00:01.100Z',
      },
    },
    completedGeneration: {
      ...failureBinding,
      event: {
        formatVersion: '1.0.0' as const,
        eventId: randomUUID(),
        sequence: 2,
        kind: 'provider_call_completed' as const,
        credentialId,
        operationId: generationRequestId,
        durableReceiptSha256: generationResultSha256,
        completedAt: '2026-08-21T10:00:01.250Z',
      },
    },
    confidenceEvaluation: {
      ...confidenceEvaluation,
      receiptSha256: contentHash(confidenceEvaluation),
    },
  };
  return { candidatePlan, policyResolution, semanticCandidate };
}

describe('procedure execution failure replan', () => {
  it('accepts only terminal execution identity and derives immutable policy internally', () => {
    const database = createEventDatabase();
    const evidence = canonicalEvidence();
    const deriveRequest = request(evidence);
    const coordinator = createProcedureExecutionFailureReplanCoordinator({
      database,
      trustedResolver: trustedResolver(trustedResolution(evidence)),
      now: () => '2026-08-21T10:01:00Z',
    });

    const outcome = coordinator.derive(deriveRequest);
    expect(outcome).toMatchObject({
      kind: 'parameter_repair_proposed',
      proposal: { diff: { argument: 'radius', before: 2, after: 1.5 } },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(database.events).toHaveLength(1);
    expect(coordinator.derive(deriveRequest).kind).toBe('parameter_repair_proposed');

    expect(() =>
      coordinator.derive({
        requestId: evidence.execution.requestId,
        deterministicOptionsExhausted: true,
        semanticCandidate: { confidence: 1 },
        actionCatalog: blenderActionCatalog,
      } as unknown as ProcedureExecutionFailureReplanRequest),
    ).toThrow();
  });

  it('fails closed when canonical evidence is missing, identity-mismatched, or reordered', () => {
    const evidence = canonicalEvidence();
    for (const invalid of [
      null,
      {
        ...evidence,
        checkpoint: { ...evidence.checkpoint, requestId: randomUUID() },
      },
      {
        ...evidence,
        recovery: { ...evidence.recovery, occurredAt: '2026-08-21T09:00:00Z' },
      },
      {
        ...evidence,
        attempts: [{ ...evidence.attempts[0]!, occurredAt: '2026-08-21T10:00:02.000Z' }],
      },
    ]) {
      const coordinator = createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(
          invalid === null
            ? null
            : trustedResolution(invalid as CanonicalProcedureExecutionFailureEvidence),
        ),
      });
      expect(coordinator.derive(request(evidence))).toEqual({
        kind: 'no_repair_available',
        reason: 'untrusted_terminal_status',
      });
    }
  });

  it('derives same-leaf strategy switches from registry trajectories, not caller booleans', () => {
    const evidence = canonicalEvidence();
    const resolution = trustedResolution(evidence, {
      repairableArguments: [],
      parameterRepairCandidates: [],
    });
    const coordinator = createProcedureExecutionFailureReplanCoordinator({
      database: createEventDatabase(),
      trustedResolver: trustedResolver(resolution),
    });
    expect(coordinator.derive(request(evidence))).toMatchObject({
      kind: 'strategy_switch_proposed',
      proposal: {
        diff: {
          fromTrackId: 'mcp.primary',
          modality: 'menu',
          toTrackId: 'menu.alternate',
        },
      },
    });

    const mismatched = structuredClone(strategyPolicy());
    mismatched.tracks[1] = { ...mismatched.tracks[1]!, semanticLeafId: 'other.leaf' };
    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(
          trustedResolution(evidence, {
            repairableArguments: [],
            parameterRepairCandidates: [],
            strategy: mismatched,
          }),
        ),
      }).derive(request(evidence)),
    ).toEqual({ kind: 'no_repair_available', reason: 'deterministic_options_exhausted' });

    const unrelatedTracks = structuredClone(strategyPolicy());
    unrelatedTracks.tracks = unrelatedTracks.tracks.map((track) => ({
      ...track,
      semanticLeafId: 'other.leaf',
    }));
    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(
          trustedResolution(evidence, {
            repairableArguments: [],
            parameterRepairCandidates: [],
            strategy: unrelatedTracks,
          }),
        ),
      }).derive(request(evidence)),
    ).toEqual({ kind: 'no_repair_available', reason: 'deterministic_options_exhausted' });
  });

  it('requires semantic candidates to bind trusted authorization, completion, and confidence evidence', () => {
    const evidence = canonicalEvidence();
    const revisionRequestId = randomUUID();
    const revisionRequest = guideRevisionRequestSchema.parse({
      protocolVersion: '1.1.0',
      requestId: revisionRequestId,
      adapterId: 'blender',
      catalogVersion: blenderActionCatalog.catalogVersion,
      instanceId: evidence.execution.target.instanceId,
      basePlan: fixturePlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Repair only the failed head step.',
      revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
      occurredAt: '2026-08-21T10:00:01.050Z',
    });
    const candidatePlan = structuredClone(fixturePlan);
    candidatePlan.revision += 1;
    candidatePlan.steps.find((step) => step.id === 'snowman.model.head')!.title += ' repaired';
    const generationRequestId = randomUUID();
    const credentialId = randomUUID();
    const planning = {
      goal: revisionRequest.message,
      requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1' as const,
        requirements: [
          {
            requirementId: 'repair-head',
            statement: 'Repair only the failed head step.',
            coverage: [
              {
                capabilityId: 'geometry.primitive_assembly',
                stepIds: ['snowman.model.head'],
              },
            ],
          },
        ],
      },
    };
    const planningQuality = evaluatePlanningQuality(
      {
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: blenderActionCatalog.catalogVersion,
        ...planning,
        plan: candidatePlan,
      },
      blenderActionCatalog,
      { allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, candidatePlan) },
    );
    const scopeEvaluation = evaluateLocalReplanScope(revisionRequest, candidatePlan);
    const generationResult = plannerReplanGenerationResultSchema.parse({
      formatVersion: '1.0.0',
      generationId: randomUUID(),
      requestId: generationRequestId,
      revisionRequestId,
      targetAdapterId: revisionRequest.adapterId,
      targetInstanceId: revisionRequest.instanceId,
      provider: { id: 'failure-replan-planner', version: '1.0.0' },
      packetFormatVersion: '1.1.0',
      status: 'ready',
      draft: {
        requestId: revisionRequestId,
        catalogVersion: blenderActionCatalog.catalogVersion,
        planning,
        plan: candidatePlan,
      },
      planDiff: scopeEvaluation.planDiff,
      planningQuality,
      locality: scopeEvaluation.locality,
      proposalCreated: false,
      generatedAt: '2026-08-21T10:00:01.200Z',
      durationMs: 100,
    });
    const generationResultSha256 = contentHash(generationResult);
    const policyResolution = trustedResolution(evidence, {
      repairableArguments: [],
      parameterRepairCandidates: [],
      strategy: null,
    });
    const exactFailureEnvelopeSha256 = failureEnvelopeSha256(evidence);
    const failureBinding = {
      failureEnvelopeSha256: exactFailureEnvelopeSha256,
      failedStepId: evidence.execution.step.id,
      allowedScopeRootIds: [evidence.execution.step.id],
      deterministicExhaustionSha256: contentHash({
        failureEnvelopeSha256: exactFailureEnvelopeSha256,
        failedStepId: evidence.execution.step.id,
        policySha256: contentHash({
          repairableArguments: policyResolution.repairableArguments,
          parameterRepairCandidates: policyResolution.parameterRepairCandidates,
          strategy: policyResolution.strategy,
        }),
        parameterCandidate: null,
        strategyCandidate: null,
      }),
    };
    const confidenceEvaluation = {
      ...failureBinding,
      generationRequestId,
      revisionRequestId,
      generationResultSha256,
      candidatePlanContentSha256: contentHash(candidatePlan),
      confidence: 0.8,
      evaluatedAt: '2026-08-21T10:00:01.300Z',
    };
    const semanticCandidate = {
      revisionRequest,
      candidatePlan,
      generationResult,
      observationObligations: [{ kind: 'uv_sphere_ready', parameters: {} }],
      generationEvidence: {
        ...failureBinding,
        generationRequestId,
        generationResultSha256,
        generatedAt: '2026-08-21T10:00:01.200Z',
      },
      authorizationConsumption: {
        ...failureBinding,
        event: {
          formatVersion: '1.0.0' as const,
          eventId: randomUUID(),
          sequence: 1,
          kind: 'provider_authorization_consumed' as const,
          credentialId,
          singleUseKeySha256: contentHash('single-use'),
          operationId: generationRequestId,
          bindingSha256: contentHash({ generationRequestId, ...failureBinding }),
          consumedAt: '2026-08-21T10:00:01.100Z',
        },
      },
      completedGeneration: {
        ...failureBinding,
        event: {
          formatVersion: '1.0.0' as const,
          eventId: randomUUID(),
          sequence: 2,
          kind: 'provider_call_completed' as const,
          credentialId,
          operationId: generationRequestId,
          durableReceiptSha256: generationResultSha256,
          completedAt: '2026-08-21T10:00:01.250Z',
        },
      },
      confidenceEvaluation: {
        ...confidenceEvaluation,
        receiptSha256: contentHash(confidenceEvaluation),
      },
    };
    const resolution = { ...policyResolution, semanticCandidate };
    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(resolution),
      }).derive(request(evidence)),
    ).toMatchObject({
      kind: 'semantic_replan_proposed',
      proposal: { diff: { confidence: 0.8, localScopeStepIds: ['snowman.model.head'] } },
    });

    const unknownActionPlan = structuredClone(candidatePlan);
    unknownActionPlan.steps.find((step) => step.id === 'snowman.model.head')!.action!.name =
      'blender.unknown_action';
    const unknownActionConfidenceContent = {
      ...confidenceEvaluation,
      candidatePlanContentSha256: contentHash(unknownActionPlan),
    };
    const unknownActionCandidate = {
      ...semanticCandidate,
      candidatePlan: unknownActionPlan,
      confidenceEvaluation: {
        ...unknownActionConfidenceContent,
        receiptSha256: contentHash(unknownActionConfidenceContent),
      },
    };
    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(
          trustedResolution(evidence, {
            repairableArguments: [],
            parameterRepairCandidates: [],
            strategy: null,
            semanticCandidate: unknownActionCandidate,
          }),
        ),
      }).derive(request(evidence)),
    ).toEqual({
      kind: 'no_repair_available',
      reason: 'deterministic_options_exhausted',
    });

    const unrelatedRevisionRequest = guideRevisionRequestSchema.parse({
      ...revisionRequest,
      references: [{ nodeId: 'snowman.model', nodeNumber: '1.2' }],
      message: 'Change the unrelated model subtree.',
    });
    const withReboundGenerationResult = (
      reboundResult: typeof generationResult,
      reboundPlan: GuidePlan = reboundResult.draft.plan,
    ) => {
      const reboundResultSha256 = contentHash(reboundResult);
      const reboundConfidenceContent = {
        ...confidenceEvaluation,
        generationResultSha256: reboundResultSha256,
        candidatePlanContentSha256: contentHash(reboundPlan),
      };
      return {
        ...semanticCandidate,
        candidatePlan: reboundPlan,
        generationResult: reboundResult,
        generationEvidence: {
          ...semanticCandidate.generationEvidence,
          generationResultSha256: reboundResultSha256,
        },
        completedGeneration: {
          ...semanticCandidate.completedGeneration,
          event: {
            ...semanticCandidate.completedGeneration.event,
            durableReceiptSha256: reboundResultSha256,
          },
        },
        confidenceEvaluation: {
          ...reboundConfidenceContent,
          receiptSha256: contentHash(reboundConfidenceContent),
        },
      };
    };
    const forgedGenerationResultSha256 = contentHash('forged-generation-result');
    const forgedResultConfidenceContent = {
      ...semanticCandidate.confidenceEvaluation,
      generationResultSha256: forgedGenerationResultSha256,
    };
    const needsRevisionResult = plannerReplanGenerationResultSchema.parse({
      ...generationResult,
      status: 'needs_revision',
      planDiff: null,
    });
    const needsRevisionResultSha256 = contentHash(needsRevisionResult);
    const needsRevisionConfidenceContent = {
      ...confidenceEvaluation,
      generationResultSha256: needsRevisionResultSha256,
    };
    const changedGoalPlanning = { ...planning, goal: 'A different semantic repair goal.' };
    const changedGoalResult = plannerReplanGenerationResultSchema.parse({
      ...generationResult,
      draft: { ...generationResult.draft, planning: changedGoalPlanning },
      planningQuality: evaluatePlanningQuality(
        {
          targetAdapterId: revisionRequest.adapterId,
          catalogVersion: blenderActionCatalog.catalogVersion,
          ...changedGoalPlanning,
          plan: candidatePlan,
        },
        blenderActionCatalog,
        { allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, candidatePlan) },
      ),
    });
    const protocolMismatchPlan = structuredClone(candidatePlan);
    protocolMismatchPlan.protocolVersion = '1.3.0';
    const protocolMismatchScope = evaluateLocalReplanScope(revisionRequest, protocolMismatchPlan);
    const protocolMismatchResult = plannerReplanGenerationResultSchema.parse({
      ...generationResult,
      draft: { ...generationResult.draft, plan: protocolMismatchPlan },
      planDiff: protocolMismatchScope.planDiff,
      locality: protocolMismatchScope.locality,
      planningQuality: evaluatePlanningQuality(
        {
          targetAdapterId: revisionRequest.adapterId,
          catalogVersion: blenderActionCatalog.catalogVersion,
          ...planning,
          plan: protocolMismatchPlan,
        },
        blenderActionCatalog,
        {
          allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, protocolMismatchPlan),
        },
      ),
    });
    for (const untrusted of [
      withReboundGenerationResult(changedGoalResult),
      withReboundGenerationResult(protocolMismatchResult, protocolMismatchPlan),
      {
        ...semanticCandidate,
        generationEvidence: {
          ...semanticCandidate.generationEvidence,
          generationResultSha256: forgedGenerationResultSha256,
        },
        completedGeneration: {
          ...semanticCandidate.completedGeneration,
          event: {
            ...semanticCandidate.completedGeneration.event,
            durableReceiptSha256: forgedGenerationResultSha256,
          },
        },
        confidenceEvaluation: {
          ...forgedResultConfidenceContent,
          receiptSha256: contentHash(forgedResultConfidenceContent),
        },
      },
      {
        ...semanticCandidate,
        generationResult: needsRevisionResult,
        generationEvidence: {
          ...semanticCandidate.generationEvidence,
          generationResultSha256: needsRevisionResultSha256,
        },
        completedGeneration: {
          ...semanticCandidate.completedGeneration,
          event: {
            ...semanticCandidate.completedGeneration.event,
            durableReceiptSha256: needsRevisionResultSha256,
          },
        },
        confidenceEvaluation: {
          ...needsRevisionConfidenceContent,
          receiptSha256: contentHash(needsRevisionConfidenceContent),
        },
      },
      {
        ...semanticCandidate,
        authorizationConsumption: {
          ...semanticCandidate.authorizationConsumption,
          event: {
            ...semanticCandidate.authorizationConsumption.event,
            consumedAt: '2026-08-21T10:00:00.900Z',
          },
        },
      },
      {
        ...semanticCandidate,
        revisionRequest: unrelatedRevisionRequest,
      },
      {
        ...semanticCandidate,
        generationEvidence: {
          ...semanticCandidate.generationEvidence,
          generationRequestId: randomUUID(),
        },
      },
      {
        ...semanticCandidate,
        generationEvidence: {
          ...semanticCandidate.generationEvidence,
          failureEnvelopeSha256: contentHash('other-envelope'),
        },
      },
      {
        ...semanticCandidate,
        confidenceEvaluation: {
          ...semanticCandidate.confidenceEvaluation,
          failedStepId: 'snowman.model.body_upper',
        },
      },
      {
        ...semanticCandidate,
        authorizationConsumption: {
          ...semanticCandidate.authorizationConsumption,
          event: {
            ...semanticCandidate.authorizationConsumption.event,
            kind: 'blender_decision_consumed' as const,
          },
        },
      },
      {
        ...semanticCandidate,
        completedGeneration: {
          ...semanticCandidate.completedGeneration,
          event: {
            ...semanticCandidate.completedGeneration.event,
            credentialId: randomUUID(),
          },
        },
      },
      {
        ...semanticCandidate,
        completedGeneration: {
          ...semanticCandidate.completedGeneration,
          event: {
            ...semanticCandidate.completedGeneration.event,
            durableReceiptSha256: contentHash('other-generation'),
          },
        },
      },
      {
        ...semanticCandidate,
        confidenceEvaluation: {
          ...semanticCandidate.confidenceEvaluation,
          candidatePlanContentSha256: contentHash('other-plan'),
        },
      },
    ]) {
      expect(
        createProcedureExecutionFailureReplanCoordinator({
          database: createEventDatabase(),
          trustedResolver: trustedResolver(
            trustedResolution(evidence, {
              repairableArguments: [],
              parameterRepairCandidates: [],
              strategy: null,
              semanticCandidate: untrusted,
            }),
          ),
        }).derive(request(evidence)),
      ).toEqual({
        kind: 'no_repair_available',
        reason: 'deterministic_options_exhausted',
      });
    }

    const missingAnchorPlan = structuredClone(candidatePlan);
    missingAnchorPlan.steps.find((step) => step.id === 'snowman.model.head')!.anchors = [];
    expect(() =>
      validateGuidePlanAgainstActionCatalog(missingAnchorPlan, blenderActionCatalog),
    ).not.toThrow();
    const missingAnchorQuality = evaluatePlanningQuality(
      {
        targetAdapterId: revisionRequest.adapterId,
        catalogVersion: blenderActionCatalog.catalogVersion,
        ...planning,
        plan: missingAnchorPlan,
      },
      blenderActionCatalog,
      { allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, missingAnchorPlan) },
    );
    expect(missingAnchorQuality.valid).toBe(false);
    expect(missingAnchorQuality.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'guidance.anchor_missing' })]),
    );
    const missingAnchorScope = evaluateLocalReplanScope(revisionRequest, missingAnchorPlan);
    const forgedValidMissingAnchorResult = plannerReplanGenerationResultSchema.parse({
      ...generationResult,
      draft: { ...generationResult.draft, plan: missingAnchorPlan },
      planDiff: missingAnchorScope.planDiff,
      locality: missingAnchorScope.locality,
    });
    const missingAnchorResultSha256 = contentHash(forgedValidMissingAnchorResult);
    const missingAnchorConfidenceContent = {
      ...confidenceEvaluation,
      generationResultSha256: missingAnchorResultSha256,
      candidatePlanContentSha256: contentHash(missingAnchorPlan),
    };
    const missingAnchorCandidate = {
      ...semanticCandidate,
      candidatePlan: missingAnchorPlan,
      generationResult: forgedValidMissingAnchorResult,
      generationEvidence: {
        ...semanticCandidate.generationEvidence,
        generationResultSha256: missingAnchorResultSha256,
      },
      completedGeneration: {
        ...semanticCandidate.completedGeneration,
        event: {
          ...semanticCandidate.completedGeneration.event,
          durableReceiptSha256: missingAnchorResultSha256,
        },
      },
      confidenceEvaluation: {
        ...missingAnchorConfidenceContent,
        receiptSha256: contentHash(missingAnchorConfidenceContent),
      },
    };
    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver(
          trustedResolution(evidence, {
            repairableArguments: [],
            parameterRepairCandidates: [],
            strategy: null,
            semanticCandidate: missingAnchorCandidate,
          }),
        ),
      }).derive(request(evidence)),
    ).toEqual({
      kind: 'no_repair_available',
      reason: 'deterministic_options_exhausted',
    });
  });

  it('restores an unchanged out-of-scope host candidate after raw Provider evidence validation', () => {
    const basePlan = planWithCandidateMenuProjection('snowman.model.body_lower');
    const evidence = evidenceForPlan(basePlan);
    const fixture = semanticCandidateFor(evidence, basePlan, 'snowman.model.head');
    const canonicalPlan = structuredClone(fixture.candidatePlan) as GuidePlan;
    canonicalPlan.steps.find(
      (step) => step.id === 'snowman.model.body_lower',
    )!.candidateMenuProjection = structuredClone(
      basePlan.steps.find((step) => step.id === 'snowman.model.body_lower')!
        .candidateMenuProjection,
    );

    const outcome = createProcedureExecutionFailureReplanCoordinator({
      database: createEventDatabase(),
      trustedResolver: trustedResolver({
        ...fixture.policyResolution,
        semanticCandidate: fixture.semanticCandidate,
      }),
    }).derive(request(evidence));

    expect(outcome).toMatchObject({
      kind: 'semantic_replan_proposed',
      proposal: {
        diff: {
          candidatePlanContentSha256: contentHash(canonicalPlan),
          localScopeStepIds: ['snowman.model.head'],
        },
      },
    });
    expect(contentHash(canonicalPlan)).not.toBe(contentHash(fixture.candidatePlan));
    expect(fixture.semanticCandidate.confidenceEvaluation.candidatePlanContentSha256).toBe(
      contentHash(fixture.candidatePlan),
    );
  });

  it('does not restore a stale host candidate when the Provider modifies its owning step', () => {
    const basePlan = planWithCandidateMenuProjection('snowman.model.head');
    const evidence = evidenceForPlan(basePlan);
    const fixture = semanticCandidateFor(evidence, basePlan, 'snowman.model.head');

    const outcome = createProcedureExecutionFailureReplanCoordinator({
      database: createEventDatabase(),
      trustedResolver: trustedResolver({
        ...fixture.policyResolution,
        semanticCandidate: fixture.semanticCandidate,
      }),
    }).derive(request(evidence));

    expect(outcome).toMatchObject({
      kind: 'semantic_replan_proposed',
      proposal: {
        diff: { candidatePlanContentSha256: contentHash(fixture.candidatePlan) },
      },
    });
  });

  it('rejects a raw semantic candidate that injects host-owned menu guidance', () => {
    const basePlan = planWithCandidateMenuProjection('snowman.model.body_lower');
    const evidence = evidenceForPlan(basePlan);
    const fixture = semanticCandidateFor(evidence, basePlan, 'snowman.model.head');
    const injectedPlan = structuredClone(fixture.candidatePlan) as GuidePlan;
    injectedPlan.steps.find(
      (step) => step.id === 'snowman.model.body_lower',
    )!.candidateMenuProjection = structuredClone(
      basePlan.steps.find((step) => step.id === 'snowman.model.body_lower')!
        .candidateMenuProjection,
    );
    const confidenceContent = {
      ...fixture.semanticCandidate.confidenceEvaluation,
      candidatePlanContentSha256: contentHash(injectedPlan),
    };
    const injectedCandidate = {
      ...fixture.semanticCandidate,
      candidatePlan: injectedPlan,
      confidenceEvaluation: {
        ...confidenceContent,
        receiptSha256: contentHash({
          failureEnvelopeSha256: confidenceContent.failureEnvelopeSha256,
          failedStepId: confidenceContent.failedStepId,
          allowedScopeRootIds: confidenceContent.allowedScopeRootIds,
          deterministicExhaustionSha256: confidenceContent.deterministicExhaustionSha256,
          generationRequestId: confidenceContent.generationRequestId,
          revisionRequestId: confidenceContent.revisionRequestId,
          generationResultSha256: confidenceContent.generationResultSha256,
          candidatePlanContentSha256: confidenceContent.candidatePlanContentSha256,
          confidence: confidenceContent.confidence,
          evaluatedAt: confidenceContent.evaluatedAt,
        }),
      },
    };

    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver({
          ...fixture.policyResolution,
          semanticCandidate: injectedCandidate,
        }),
      }).derive(request(evidence)),
    ).toEqual({
      kind: 'no_repair_available',
      reason: 'deterministic_options_exhausted',
    });
  });

  it('fails closed for merge candidates without trusted full merge context', () => {
    const basePlan = planWithCandidateMenuProjection('snowman.model.body_lower');
    const evidence = evidenceForPlan(basePlan);
    const fixture = semanticCandidateFor(evidence, basePlan, 'snowman.model.head');
    const mergeCandidate = {
      ...fixture.semanticCandidate,
      revisionRequest: {
        ...fixture.semanticCandidate.revisionRequest,
        revisionThread: {
          threadId: randomUUID(),
          turn: 2,
          parentRequestId: randomUUID(),
        },
        revisionOperation: {
          kind: 'merge' as const,
          sourceThreadId: randomUUID(),
          sourceRequestId: randomUUID(),
        },
      },
    };

    expect(
      createProcedureExecutionFailureReplanCoordinator({
        database: createEventDatabase(),
        trustedResolver: trustedResolver({
          ...fixture.policyResolution,
          semanticCandidate: mergeCandidate,
        }),
      }).derive(request(evidence)),
    ).toEqual({
      kind: 'no_repair_available',
      reason: 'deterministic_options_exhausted',
    });
  });

  it('recovers the identical durable outcome after restart without consulting mutable policy', () => {
    const database = createEventDatabase();
    const evidence = canonicalEvidence();
    const deriveRequest = request(evidence);
    createProcedureExecutionFailureReplanCoordinator({
      database,
      trustedResolver: trustedResolver(trustedResolution(evidence)),
      now: () => '2026-08-21T10:01:00Z',
    }).derive(deriveRequest);
    const restarted = createProcedureExecutionFailureReplanCoordinator({
      database,
      trustedResolver: {
        resolve: () => {
          throw new Error('must not resolve twice');
        },
      },
      now: () => '2026-08-21T10:02:00Z',
    });
    expect(restarted.derive(deriveRequest).kind).toBe('parameter_repair_proposed');
    expect(database.events).toHaveLength(1);
  });

  it('preserves proposal TTL across restart without creating a replacement', () => {
    const database = createEventDatabase();
    const evidence = canonicalEvidence();
    const deriveRequest = request(evidence);
    createProcedureExecutionFailureReplanCoordinator({
      database,
      trustedResolver: trustedResolver(trustedResolution(evidence)),
      now: () => '2026-08-21T10:01:00Z',
    }).derive(deriveRequest);

    const restarted = createProcedureExecutionFailureReplanCoordinator({
      database,
      trustedResolver: { resolve: () => null },
      now: () => '2026-08-21T10:17:00Z',
    });
    expect(restarted.derive(deriveRequest)).toEqual({
      kind: 'no_repair_available',
      reason: 'proposal_expired',
    });
    expect(database.events).toHaveLength(1);
  });
});
