import {
  createHumanEvalIntegrity,
  computeHumanEvalCaseSha256,
  computeHumanEvalContentSha256,
  computeHumanEvalRubricSha256,
  createProviderEvalRun,
} from '@operatingline/eval-kit';
import { buildPlanningPromptPacket, evaluatePlanningQuality } from '@operatingline/orchestrator';
import {
  humanEvalAnnotationSchema,
  humanEvalSuiteSchema,
  plannerGenerationResultSchema,
  planningContextSchema,
  type HumanEvalAnnotation,
  type HumanEvalSuite,
  type ProviderEvalRun,
} from '@operatingline/protocol';
import { buildSyntheticCanvasDraft, syntheticCanvasActionCatalog } from '@operatingline/test-kit';

const startedAt = '2026-08-05T00:00:00.000Z';
const completedAt = '2026-08-05T00:00:01.000Z';
const requestId = '10000000-0000-4000-8000-000000000001';
const generationId = '10000000-0000-4000-8000-000000000002';
const runId = '10000000-0000-4000-8000-000000000003';

const dataHandling = {
  redaction: 'human_reviewed' as const,
  containsPotentiallySensitiveContent: false,
  permittedUses: ['local_eval' as const],
  trainingUse: 'not_authorized' as const,
  publicRelease: 'reviewed' as const,
  warning: 'Synthetic test data only; training use is not authorized.',
};

export function buildHumanEvalSuiteFixture(): HumanEvalSuite {
  const content = {
    formatVersion: '1.0.0' as const,
    suiteId: 'canvas.core_planning',
    suiteVersion: '1.0.0',
    status: 'collecting' as const,
    title: 'Synthetic canvas human evaluation',
    description: 'Host-neutral fixture for the versioned Human Eval contracts.',
    licenseId: 'Apache-2.0',
    rubric: {
      id: 'canvas.semantic_rubric',
      version: '1.0.0',
      title: 'Canvas semantic review',
      criteria: [
        {
          id: 'goal.decomposition',
          title: 'Goal decomposition',
          dimension: 'goal_decomposition' as const,
          evaluationStage: 'plan' as const,
          question: 'Does the plan create and export the requested canvas?',
          guidance:
            'Inspect the complete provider draft rather than its deterministic status alone.',
          evidenceKinds: ['requirement' as const, 'plan_step' as const, 'run_output' as const],
        },
        {
          id: 'guidance.clarity',
          title: 'Guidance clarity',
          dimension: 'teaching_clarity' as const,
          evaluationStage: 'plan' as const,
          question: 'Does the plan explain the ordered operations clearly?',
          guidance: 'Generic filler is insufficient.',
          evidenceKinds: ['plan_step' as const, 'run_output' as const],
        },
      ],
    },
    policy: {
      numericScoring: 'prohibited' as const,
      providerRanking: 'prohibited' as const,
      minimumIndependentAnnotationsPerRun: 2,
      minimumDistinctTreatmentsPerCase: 2,
      providerIdentityBlinding: 'required' as const,
      disagreementHandling: 'preserve_and_adjudicate' as const,
      missingRuns: 'report_as_missing' as const,
      syntheticRunsInPublishedComparison: 'prohibited' as const,
    },
    cases: [
      {
        id: 'canvas.launch_diagram',
        lineageId: 'canvas.launch_diagram',
        title: 'Launch diagram',
        difficulty: 'basic' as const,
        language: 'en',
        tags: ['diagram', 'svg'],
        requirements: [
          {
            id: 'canvas.create',
            importance: 'must' as const,
            statement: 'Create the requested launch diagram document.',
          },
          {
            id: 'canvas.export',
            importance: 'must' as const,
            statement: 'Export the document as SVG.',
          },
        ],
        rubricCriterionIds: ['goal.decomposition', 'guidance.clarity'],
        catalogContentSha256: computeHumanEvalContentSha256(syntheticCanvasActionCatalog),
        references: [],
        operation: 'initial_plan' as const,
        request: {
          targetAdapterId: 'canvas',
          catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
          goal: 'Create and export a launch diagram as SVG.',
          planId: 'eval-canvas-launch',
        },
      },
    ],
    dataHandling,
  };
  return humanEvalSuiteSchema.parse({ ...content, integrity: createHumanEvalIntegrity(content) });
}

export function buildProviderEvalRunFixture(suite = buildHumanEvalSuiteFixture()): ProviderEvalRun {
  const evalCase = suite.cases[0]!;
  if (evalCase.operation !== 'initial_plan') {
    throw new Error('Expected an initial planning case fixture');
  }
  const context = planningContextSchema.parse({
    protocolVersion: '1.1.0',
    targetAdapterId: 'canvas',
    goal: evalCase.request.goal,
    requestedPlanId: evalCase.request.planId,
    recommendedRevision: 1,
    catalog: syntheticCanvasActionCatalog,
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
      targetAdapterId: 'canvas',
      description: 'Submit the complete candidate for human review.',
    },
    qualityGate: {
      toolName: 'operatingline.planning.evaluate',
      baselineVersion: '1.1.0',
      requiredPhaseSelection: 'planner_declared_from_goal',
      description: 'Evaluate the complete candidate before proposal submission.',
    },
  });
  const packet = buildPlanningPromptPacket(context);
  const draft = buildSyntheticCanvasDraft(packet);
  const planningQuality = evaluatePlanningQuality(
    {
      targetAdapterId: draft.targetAdapterId,
      catalogVersion: draft.catalogVersion,
      goal: draft.planning.goal,
      requiredPhaseIds: draft.planning.requiredPhaseIds,
      capabilityCoverage: draft.planning.capabilityCoverage,
      plan: draft.plan,
    },
    syntheticCanvasActionCatalog,
  );
  const result = plannerGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId,
    requestId,
    provider: { id: 'fixture.canvas_planner', version: '1.0.0' },
    packetFormatVersion: packet.formatVersion,
    status: planningQuality.valid ? 'ready' : 'needs_revision',
    draft,
    planningQuality,
    proposalCreated: false,
    generatedAt: completedAt,
    durationMs: 1_000,
  });
  const normalizedParameters = { maxOutputTokens: 32_768, temperature: 0 };
  return createProviderEvalRun({
    formatVersion: '1.0.0',
    runId,
    caseRef: {
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      caseId: evalCase.id,
      caseContentSha256: computeHumanEvalCaseSha256(evalCase),
    },
    sourceKind: 'synthetic_test_fixture',
    sourceEvidence: { kind: 'synthetic_test_fixture' },
    replicateIndex: 1,
    parentRunId: null,
    profile: {
      descriptor: {
        contractVersion: '1.0.0',
        id: 'fixture.canvas_planner',
        version: '1.0.0',
        displayName: 'Fixture Canvas Planner',
        description: 'Deterministic synthetic planner used only by tests.',
        availability: { available: true },
        limits: { maxConcurrency: 1 },
        dataHandling: {
          executionLocation: 'local',
          dataTransmission: 'none',
          credentialManagement: 'provider_managed',
        },
      },
      vendor: 'OperatingLine tests',
      implementation: { name: 'fixture-canvas-planner', version: '1.0.0' },
      model: {
        requested: 'deterministic-fixture-v1',
        resolvedRevision: 'deterministic-fixture-v1',
        resolution: 'resolved',
      },
      api: {
        surface: 'in-process-test',
        version: '1.0.0',
        sdkName: '@operatingline/test-kit',
        sdkVersion: '0.1.0',
        endpointClass: 'local',
        serviceTier: null,
        region: null,
      },
    },
    environment: {
      operatingLineVersion: '0.1.0',
      sourceCommit: '0'.repeat(40),
      protocolVersion: '1.1.0',
      targetAdapterId: 'canvas',
      catalogVersion: syntheticCanvasActionCatalog.catalogVersion,
      adapterVersion: '1.0.0',
      hostVersion: '1.0.0',
    },
    invocation: {
      operation: 'initial_plan',
      request: {
        requestId,
        providerId: 'fixture.canvas_planner',
        ...evalCase.request,
      },
      packet,
    },
    generationSettings: {
      normalizedParameters,
      seed: 0,
      determinism: 'deterministic',
    },
    timing: { startedAt, completedAt },
    outcome: {
      status: 'completed',
      operation: 'initial_plan',
      result,
    },
    sourceEvents: [],
    artifacts: [],
    reproducibility: 'reproducible',
    provenance: {
      recorderName: '@operatingline/eval-kit-test',
      recorderVersion: '1.0.0',
      vendorRequestId: null,
      rawProviderResponseStored: false,
      privateReasoningStored: false,
      credentialsStored: false,
    },
    dataHandling,
  });
}

export function buildHumanEvalAnnotationFixture(
  suite: HumanEvalSuite,
  run: ProviderEvalRun,
  reviewerPseudonym: string,
  annotationId: string,
  judgment: 'met' | 'partially_met' | 'not_met' = 'met',
): HumanEvalAnnotation {
  const content = {
    formatVersion: '1.0.0' as const,
    annotationId,
    caseRef: run.caseRef,
    runId: run.runId,
    runContentSha256: run.integrity.contentSha256,
    rubric: {
      id: suite.rubric.id,
      version: suite.rubric.version,
      contentSha256: computeHumanEvalRubricSha256(suite.rubric),
    },
    reviewer: {
      pseudonym: reviewerPseudonym,
      qualificationId: 'canvas.review_qualification',
      calibrationVersion: '1.0.0',
      locale: 'en',
    },
    review: {
      providerIdentityVisible: false as const,
      startedAt,
      completedAt,
      recommendation: judgment === 'not_met' ? ('revise' as const) : ('accept' as const),
      judgments: suite.cases[0]!.rubricCriterionIds.map((criterionId) => ({
        criterionId,
        judgment,
        rationale: `The captured plan provides evidence for ${criterionId}.`,
        evidence: [
          {
            kind: 'run_output' as const,
            locator: 'outcome.result.draft',
            contentSha256: run.outcome.status === 'completed' ? run.outcome.resultSha256 : null,
            note: 'Reviewed the strictly parsed provider draft.',
          },
        ],
      })),
    },
    sourceKind: 'human_annotation' as const,
    supersedesAnnotationId: null,
    dataHandling,
  };
  return humanEvalAnnotationSchema.parse({
    ...content,
    integrity: createHumanEvalIntegrity(content),
  });
}
