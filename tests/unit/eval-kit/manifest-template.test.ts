import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  buildReplanningPromptPacket,
  createLocalReplanScope,
  evaluateLocalReplanScope,
  evaluatePlanningQuality,
  localReplanCoverageStepIds,
} from '@operatingline/orchestrator';
import { describe, expect, it } from 'vitest';

import {
  buildProviderEvalCaptureManifestTemplate,
  computeHumanEvalContentSha256,
} from '@operatingline/eval-kit';
import {
  guidePlanSchema,
  guideRevisionRequestSchema,
  humanEvalSuiteSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerationResultSchema,
  type CurrentEvalExportBundle,
  type EvalExecutionEvent,
} from '@operatingline/protocol';

import {
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const snapshotId = '42000000-0000-4000-8000-000000000001';
const runId = '42000000-0000-4000-8000-000000000002';

function invocationEvents() {
  const suite = buildHumanEvalSuiteFixture();
  const source = buildProviderEvalRunFixture(suite);
  if (source.invocation.operation !== 'initial_plan' || source.outcome.status !== 'completed') {
    throw new Error('Expected a completed initial-plan fixture');
  }
  const request = source.invocation.request;
  const requestFingerprint = computeHumanEvalContentSha256(request);
  const treatment = {
    profile: source.profile,
    generationSettings: source.generationSettings,
  };
  const runtimeTreatment = {
    formatVersion: '1.0.0' as const,
    evidenceClass: 'runtime_attested_provider_treatment' as const,
    operation: 'initial_plan' as const,
    treatment,
    treatmentSha256: computeHumanEvalContentSha256(treatment),
  };
  const events: EvalExecutionEvent[] = [
    {
      sequence: 1,
      id: 'template.prompt',
      eventType: 'planning.prompt.generated',
      payload: {
        request: {
          targetAdapterId: request.targetAdapterId,
          catalogVersion: request.catalogVersion,
          goal: request.goal,
          planId: request.planId,
        },
        packet: source.invocation.packet,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 2,
      id: 'template.requested',
      eventType: 'planning.provider.generation.requested',
      payload: {
        requestId: request.requestId,
        requestFingerprint,
        providerId: source.profile.descriptor.id,
        providerVersion: source.profile.descriptor.version,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        packetFormatVersion: source.invocation.packet.formatVersion,
        runtimeTreatment,
        occurredAt: source.timing.startedAt,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 3,
      id: 'template.completed',
      eventType: 'planning.provider.generation.completed',
      payload: {
        request,
        requestFingerprint,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        result: source.outcome.result,
        runtimeAttestation: {
          formatVersion: '1.0.0',
          evidenceClass: 'runtime_attested_provider_output',
          operation: 'initial_plan',
          requestId: request.requestId,
          requestFingerprint,
          packetSha256: computeHumanEvalContentSha256(source.invocation.packet),
          outputSha256: computeHumanEvalContentSha256(source.outcome.result.draft),
          treatment: runtimeTreatment,
          occurredAt: source.outcome.result.generatedAt,
        },
      },
      createdAt: source.timing.completedAt,
    },
  ];
  return { suite, source, events };
}

function exportBundle(
  state: ReturnType<typeof invocationEvents>,
  events = state.events,
): CurrentEvalExportBundle {
  const eventTypeCounts: Record<string, number> = {};
  for (const event of events) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
  }
  const content = {
    protocolVersion: state.source.environment.protocolVersion,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: state.source.environment.targetAdapterId,
      planId:
        state.source.invocation.operation === 'initial_plan'
          ? state.source.invocation.request.planId
          : 'unreachable',
      instanceId: null,
    },
    catalogs: [state.source.invocation.packet.context.catalog],
    events,
    page: {
      snapshotId,
      snapshotUpperSequence: events.at(-1)?.sequence ?? 0,
      afterSequence: 0,
      nextAfterSequence: events.at(-1)?.sequence ?? 0,
      hasMore: false,
    },
    summary: {
      matchedEventCount: events.length,
      eventTypeCounts,
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Synthetic frozen export fixture.',
    },
  };
  return {
    ...content,
    exportId: '42000000-0000-4000-8000-000000000003',
    exportedAt: '2026-08-05T00:00:02.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

function templateInput(state: ReturnType<typeof invocationEvents>, events = state.events) {
  return {
    suite: state.suite,
    exportPages: [
      {
        artifactId: 'template.page.1',
        uri: 'repo://captures/template-page-1.json',
        bundle: exportBundle(state, events),
      },
    ],
    caseId: state.suite.cases[0]!.id,
    generationRequestId: state.source.invocation.request.requestId,
    runId,
    replicateIndex: 1,
    parentRunId: null,
    environment: {
      operatingLineVersion: state.source.environment.operatingLineVersion,
      sourceCommit: null,
    },
    provenance: {
      ...state.source.provenance,
      recorderName: 'manifest-template-test',
    },
    dataHandling: state.suite.dataHandling,
  };
}

async function localReplanCaptureInput() {
  const suite = humanEvalSuiteSchema.parse(
    JSON.parse(
      await readFile(resolve('protocol/fixtures/v1/eval/blender-core/suite.json'), 'utf8'),
    ) as unknown,
  );
  const evalCase = suite.cases.find(
    (candidate) => candidate.id === 'blender.snowman_rougher_body_replan',
  );
  if (evalCase?.operation !== 'local_replan') throw new Error('Expected public local-replan case');
  const catalog = blenderActionCatalogs.find(
    (candidate) => candidate.catalogVersion === evalCase.catalogVersion,
  );
  if (catalog === undefined) throw new Error('Expected historical Blender catalog');
  const basePlan = guidePlanSchema.parse(
    JSON.parse(
      await readFile(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
    ) as unknown,
  );
  const revisionRequest = guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId: '42000000-0000-4000-8000-000000000010',
    adapterId: evalCase.targetAdapterId,
    catalogVersion: evalCase.catalogVersion,
    instanceId: '42000000-0000-4000-8000-000000000011',
    basePlan,
    references: evalCase.referencedNodeIds.map((nodeId) => ({ nodeId, nodeNumber: '1.4.1' })),
    message: evalCase.revisionMessage,
    revisionThread: {
      threadId: '42000000-0000-4000-8000-000000000010',
      turn: 1,
      parentRequestId: null,
    },
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
  const packet = buildReplanningPromptPacket({
    revisionRequest,
    targetRevision: basePlan.revision + 1,
    catalog,
    companionState: null,
    scope: createLocalReplanScope(revisionRequest),
  });
  const targetPlan = structuredClone(basePlan);
  targetPlan.revision += 1;
  const materialStep = targetPlan.steps.find((step) => step.id === 'snowman.materials.snow');
  if (materialStep?.action === null || materialStep?.action === undefined) {
    throw new Error('Expected snow material action');
  }
  (materialStep.action.arguments as Record<string, unknown>)['roughness'] = 0.92;
  materialStep.explanation =
    'Increase only the snow material roughness while preserving its color.';
  const requiredPhaseIds = catalog.planningPhases?.map((phase) => phase.id) ?? [];
  const capabilityCoverage = {
    policyVersion: 'catalog_capability_coverage_v1' as const,
    requirements: [
      {
        requirementId: 'rougher-snow',
        statement: evalCase.revisionMessage,
        coverage: [
          {
            capabilityId: 'appearance.principled_palette',
            stepIds: ['snowman.materials.snow'],
          },
        ],
      },
    ],
  };
  const draft = plannerReplanDraftSchema.parse({
    requestId: revisionRequest.requestId,
    catalogVersion: catalog.catalogVersion,
    planning: {
      goal: revisionRequest.message,
      requiredPhaseIds,
      capabilityCoverage,
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
    catalog,
    { allowedCoverageStepIds: localReplanCoverageStepIds(revisionRequest, draft.plan) },
  );
  const scopeEvaluation = evaluateLocalReplanScope(revisionRequest, draft.plan);
  const reusable = buildProviderEvalRunFixture();
  const generationRequestId = '42000000-0000-4000-8000-000000000012';
  const request = {
    requestId: generationRequestId,
    revisionRequestId: revisionRequest.requestId,
    providerId: reusable.profile.descriptor.id,
  };
  const requestFingerprint = computeHumanEvalContentSha256(request);
  const result = plannerReplanGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: '42000000-0000-4000-8000-000000000013',
    requestId: generationRequestId,
    revisionRequestId: revisionRequest.requestId,
    targetAdapterId: revisionRequest.adapterId,
    targetInstanceId: revisionRequest.instanceId,
    provider: {
      id: reusable.profile.descriptor.id,
      version: reusable.profile.descriptor.version,
    },
    packetFormatVersion: packet.formatVersion,
    status: 'ready',
    draft,
    planDiff: scopeEvaluation.planDiff,
    planningQuality,
    locality: scopeEvaluation.locality,
    proposalCreated: false,
    generatedAt: '2026-08-05T00:00:01.000Z',
    durationMs: 1_000,
  });
  const treatment = {
    profile: reusable.profile,
    generationSettings: reusable.generationSettings,
  };
  const runtimeTreatment = {
    formatVersion: '1.0.0' as const,
    evidenceClass: 'runtime_attested_provider_treatment' as const,
    operation: 'local_replan' as const,
    treatment,
    treatmentSha256: computeHumanEvalContentSha256(treatment),
  };
  const events: EvalExecutionEvent[] = [
    {
      sequence: 1,
      id: 'template.replan.prompt',
      eventType: 'planning.replan.prompt.generated',
      payload: { request: { revisionRequestId: revisionRequest.requestId }, packet },
      createdAt: revisionRequest.occurredAt,
    },
    {
      sequence: 2,
      id: 'template.replan.requested',
      eventType: 'planning.provider.replan.requested',
      payload: {
        requestId: generationRequestId,
        requestFingerprint,
        revisionRequestId: revisionRequest.requestId,
        providerId: reusable.profile.descriptor.id,
        providerVersion: reusable.profile.descriptor.version,
        targetAdapterId: revisionRequest.adapterId,
        targetInstanceId: revisionRequest.instanceId,
        catalogVersion: revisionRequest.catalogVersion,
        planId: basePlan.id,
        baseRevision: basePlan.revision,
        packetFormatVersion: packet.formatVersion,
        runtimeTreatment,
        occurredAt: revisionRequest.occurredAt,
      },
      createdAt: revisionRequest.occurredAt,
    },
    {
      sequence: 3,
      id: 'template.replan.completed',
      eventType: 'planning.provider.replan.completed',
      payload: {
        request,
        requestFingerprint,
        result,
        runtimeAttestation: {
          formatVersion: '1.0.0',
          evidenceClass: 'runtime_attested_provider_output',
          operation: 'local_replan',
          requestId: generationRequestId,
          requestFingerprint,
          packetSha256: computeHumanEvalContentSha256(packet),
          outputSha256: computeHumanEvalContentSha256(result.draft),
          treatment: runtimeTreatment,
          occurredAt: result.generatedAt,
        },
      },
      createdAt: result.generatedAt,
    },
  ];
  const eventTypeCounts = Object.fromEntries(
    events
      .map((event) => [event.eventType, 1])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const content = {
    protocolVersion: revisionRequest.protocolVersion,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: revisionRequest.adapterId,
      planId: basePlan.id,
      instanceId: revisionRequest.instanceId,
    },
    catalogs: [catalog],
    events,
    page: {
      snapshotId: '42000000-0000-4000-8000-000000000014',
      snapshotUpperSequence: 3,
      afterSequence: 0,
      nextAfterSequence: 3,
      hasMore: false,
    },
    summary: {
      matchedEventCount: events.length,
      eventTypeCounts,
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Synthetic local-replan frozen export fixture.',
    },
  };
  const bundle: CurrentEvalExportBundle = {
    ...content,
    exportId: '42000000-0000-4000-8000-000000000015',
    exportedAt: '2026-08-05T00:00:02.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
  return {
    suite,
    exportPages: [{ artifactId: 'template.replan.page', uri: 'replan.json', bundle }],
    caseId: evalCase.id,
    generationRequestId,
    runId: '42000000-0000-4000-8000-000000000016',
    replicateIndex: 1,
    parentRunId: null,
    environment: { operatingLineVersion: '0.1.0', sourceCommit: null },
    provenance: reusable.provenance,
    dataHandling: suite.dataHandling,
  };
}

describe('buildProviderEvalCaptureManifestTemplate', () => {
  it('derives provider treatment and exact export references from attested evidence', () => {
    const state = invocationEvents();
    const input = templateInput(state);
    const manifest = buildProviderEvalCaptureManifestTemplate(input);

    expect(manifest).toMatchObject({
      caseId: state.suite.cases[0]!.id,
      generationRequestId: state.source.invocation.request.requestId,
      profile: state.source.profile,
      generationSettings: {
        normalizedParameters: state.source.generationSettings.normalizedParameters,
        seed: state.source.generationSettings.seed,
        determinism: state.source.generationSettings.determinism,
      },
      environment: {
        protocolVersion: state.source.environment.protocolVersion,
        targetAdapterId: state.source.environment.targetAdapterId,
        catalogVersion: state.source.environment.catalogVersion,
        adapterVersion: null,
        hostVersion: null,
      },
      reproducibility: 'best_effort',
    });
    expect(manifest.exportPages).toBe(input.exportPages);
    expect(manifest.provenance.credentialsStored).toBe(false);
  });

  it('derives a runtime-attested local replan from the seven-case public suite', async () => {
    const input = await localReplanCaptureInput();
    expect(input.suite.cases).toHaveLength(7);

    const manifest = buildProviderEvalCaptureManifestTemplate(input);

    expect(manifest).toMatchObject({
      caseId: 'blender.snowman_rougher_body_replan',
      generationRequestId: input.generationRequestId,
      profile: buildProviderEvalRunFixture().profile,
      environment: {
        targetAdapterId: 'blender',
        catalogVersion: '1.3.0',
        adapterVersion: null,
        hostVersion: null,
      },
      reproducibility: 'best_effort',
    });
  });

  it.each(['reproducible', 'not_reproducible'] as const)(
    'does not allow an operator override to %s for provider-only evidence',
    (reproducibility) => {
      const state = invocationEvents();
      const input = { ...templateInput(state), reproducibility };

      expect(buildProviderEvalCaptureManifestTemplate(input).reproducibility).toBe('best_effort');
    },
  );

  it('rejects an invocation without both runtime attestations', () => {
    const state = invocationEvents();
    const events = structuredClone(state.events);
    delete (events[1]!.payload as Record<string, unknown>)['runtimeTreatment'];

    expect(() => buildProviderEvalCaptureManifestTemplate(templateInput(state, events))).toThrow(
      /must contain requested runtime treatment and completed runtime output attestations/,
    );
  });

  it('rejects ambiguous requested and completed chains', () => {
    const state = invocationEvents();
    const duplicate = structuredClone(state.events[1]!);
    duplicate.sequence = 3;
    duplicate.id = 'template.requested.duplicate';
    const completed = { ...state.events[2]!, sequence: 4 };
    const events = [state.events[0]!, state.events[1]!, duplicate, completed];

    expect(() => buildProviderEvalCaptureManifestTemplate(templateInput(state, events))).toThrow(
      /exactly one requested event and one completed event/,
    );
  });

  it('rejects mismatched requested and completed runtime attestations', () => {
    const state = invocationEvents();
    const events = structuredClone(state.events);
    const completed = events[2]!.payload as Record<string, unknown>;
    const output = completed['runtimeAttestation'] as Record<string, unknown>;
    output['treatment'] = {
      ...(output['treatment'] as Record<string, unknown>),
      treatmentSha256: '0'.repeat(64),
    };

    expect(() => buildProviderEvalCaptureManifestTemplate(templateInput(state, events))).toThrow(
      /runtime attestations do not describe one exact selected invocation/,
    );
  });

  it.each([
    ['plain token', { token: 'must-not-be-copied' }],
    ['provider token', { providerToken: 'must-not-be-copied' }],
    ['access token value', { accessTokenValue: 'must-not-be-copied' }],
    ['provider token header', { providerTokenHeader: 'must-not-be-copied' }],
    ['access tokens', { accessTokens: ['must-not-be-copied'] }],
    ['provider tokens', { providerTokens: ['must-not-be-copied'] }],
    ['session tokens', { sessionTokens: ['must-not-be-copied'] }],
    ['API key', { 'API-Key': 'must-not-be-copied' }],
    ['secret key', { secretKey: 'must-not-be-copied' }],
    ['private key PEM', { privateKeyPem: 'must-not-be-copied' }],
    ['access key ID', { accessKeyId: 'must-not-be-copied' }],
    ['API keys', { apiKeys: ['must-not-be-copied'] }],
    ['private keys', { privateKeys: ['must-not-be-copied'] }],
    ['client secrets', { clientSecrets: ['must-not-be-copied'] }],
    ['passwords', { passwords: ['must-not-be-copied'] }],
    ['cookies', { cookies: ['must-not-be-copied'] }],
    ['authorization header', { headers: { Authorization: 'must-not-be-copied' } }],
    ['nested session token', { transport: [{ session_token: 'must-not-be-copied' }] }],
    ['AWS secret access key', { aws_secret_access_key: 'must-not-be-copied' }],
  ])('rejects credential-like normalized parameter keys: %s', (_label, normalizedParameters) => {
    const state = invocationEvents();
    const events = structuredClone(state.events);
    const requested = events[1]!.payload as Record<string, unknown>;
    const runtimeTreatment = requested['runtimeTreatment'] as {
      treatment: {
        generationSettings: {
          normalizedParameters: Record<string, unknown>;
          parametersSha256: string;
        };
      };
      treatmentSha256: string;
    };
    runtimeTreatment.treatment.generationSettings.normalizedParameters = normalizedParameters;
    runtimeTreatment.treatment.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
      runtimeTreatment.treatment.generationSettings.normalizedParameters,
    );
    runtimeTreatment.treatmentSha256 = computeHumanEvalContentSha256(runtimeTreatment.treatment);
    const completed = events[2]!.payload as Record<string, unknown>;
    const runtimeAttestation = completed['runtimeAttestation'] as Record<string, unknown>;
    runtimeAttestation['treatment'] = structuredClone(runtimeTreatment);

    expect(() => buildProviderEvalCaptureManifestTemplate(templateInput(state, events))).toThrow(
      /normalized parameters contain credential-like key/,
    );
  });

  it.each([
    ['output-token limit', { maxOutputTokens: 32_768 }],
    ['maximum new tokens', { maxNewTokens: 4_096 }],
    ['token budget', { tokenBudget: 32_768 }],
    ['token usage estimate', { tokenUsageEstimate: 128 }],
    ['secretary mode', { secretaryMode: false }],
  ])('allows noncredential normalized parameter keys: %s', (_label, normalizedParameters) => {
    const state = invocationEvents();
    const events = structuredClone(state.events);
    const requested = events[1]!.payload as Record<string, unknown>;
    const runtimeTreatment = requested['runtimeTreatment'] as {
      treatment: {
        generationSettings: {
          normalizedParameters: Record<string, unknown>;
          parametersSha256: string;
        };
      };
      treatmentSha256: string;
    };
    runtimeTreatment.treatment.generationSettings.normalizedParameters = normalizedParameters;
    runtimeTreatment.treatment.generationSettings.parametersSha256 = computeHumanEvalContentSha256(
      runtimeTreatment.treatment.generationSettings.normalizedParameters,
    );
    runtimeTreatment.treatmentSha256 = computeHumanEvalContentSha256(runtimeTreatment.treatment);
    const completed = events[2]!.payload as Record<string, unknown>;
    const runtimeAttestation = completed['runtimeAttestation'] as Record<string, unknown>;
    runtimeAttestation['treatment'] = structuredClone(runtimeTreatment);

    expect(
      buildProviderEvalCaptureManifestTemplate(templateInput(state, events)).generationSettings
        .normalizedParameters,
    ).toEqual(normalizedParameters);
  });
});
