import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  compileProcedureTreeToGuidePlan,
  plannerProviderContractVersion,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringValidationResultSchema,
  procedureZeroBaselineGenerateRequestSchema,
  procedureZeroBaselineResultSchema,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringGenerateRequest,
  type ProcedureAuthoringGenerationResult,
  type ProcedureAuthoringPromptPacket,
  type ProcedureZeroBaselineGenerateRequest,
} from '@operatingline/protocol';
import {
  createProcedureZeroBaselineGenerationCoordinator,
  type ProcedureZeroBaselineAuthoringGeneration,
} from '../../../services/orchestrator/src/procedure-zero-baseline-generation.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from '../../../services/orchestrator/src/guide-validation.js';
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

const providerDescriptor = {
  contractVersion: plannerProviderContractVersion,
  id: 'procedure-author',
  version: '1.0.0',
  displayName: 'Procedure author test provider',
  description: 'Returns a deterministic candidate for zero-baseline tests.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

const request = procedureZeroBaselineGenerateRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: '4aec2e23-e7bf-4ccd-bade-e8fd50801bb3',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: '创建一棵有头部、眼睛和鼻子的低多边形雪人。',
  locale: 'zh-CN',
  authorization: {
    providerDescriptor,
    explicitlyConfirmedByUser: true,
    goalAndCatalogContextTransmissionAcknowledged: true,
    possibleProviderCostAcknowledged: true,
    confirmedAt: '2026-08-20T10:00:00+08:00',
  },
});

function candidate(packet: ProcedureAuthoringPromptPacket): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = packet.context.requestedTreeId;
  tree['revision'] = packet.context.recommendedRevision;
  tree['adapterId'] = packet.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  const source = packet.context.goalProvenance.source;
  tree['sources'] = [...(tree['sources'] as unknown[]), source];
  tree['evidence'] = [
    ...(tree['evidence'] as unknown[]),
    { ...packet.context.goalProvenance.evidence, sourceId: source.id },
  ];
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'Zero-baseline candidates cannot invent catalog grounding.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'Zero-baseline candidates cannot invent shortcut verification.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'Zero-baseline candidates cannot invent action-level tools.',
        modality: 'mcp',
      },
    ];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function generationResult(
  input: ProcedureAuthoringGenerateRequest,
): ProcedureAuthoringGenerationResult {
  const packet = buildProcedureAuthoringPromptPacket(
    {
      targetAdapterId: input.targetAdapterId,
      actionCatalogVersion: input.actionCatalogVersion,
      interactionCatalogVersion: input.interactionCatalogVersion,
      goal: input.goal,
      treeId: input.treeId,
      revision: input.revision,
      locale: input.locale,
    },
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const tree = candidate(packet);
  const plan = compileProcedureTreeToGuidePlan(tree);
  validateGuidePlanStructure(plan);
  validateGuidePlanAgainstActionCatalog(plan, blenderActionCatalog);
  const validation = procedureAuthoringValidationResultSchema.parse({
    formatVersion: packet.formatVersion,
    packetContentSha256: packet.integrity.contentSha256,
    validation: {
      packetIntegrity: 'validated',
      installedCatalogBinding: 'validated',
      authoringCandidateContract: 'validated',
      procedureCompilation: 'validated',
    },
    compilation: {
      formatVersion: tree.formatVersion,
      procedureTreeId: tree.id,
      procedureTreeRevision: tree.revision,
      adapterId: tree.adapterId,
      actionCatalogVersion: tree.actionCatalogVersion,
      interactionCatalogVersion: tree.interactionCatalogVersion,
      validation: {
        procedureStructure: 'validated',
        actionCatalogBinding: 'validated',
        hostVersionRange: 'validated_against_action_catalog',
        interactionTracks: 'structural_only',
      },
      plan,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  });
  return procedureAuthoringGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: '8bb4bfa9-a444-42db-aeb6-f905f6cd48c5',
    requestId: input.requestId,
    provider: { id: input.providerId, version: providerDescriptor.version },
    packet,
    tree,
    validation,
    sideEffects: {
      modelCalled: true,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    generatedAt: '2026-08-20T02:00:01.000Z',
    durationMs: 1,
  });
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-20T02:00:00.000Z',
  }));
}

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

function generation(): ProcedureZeroBaselineAuthoringGeneration & {
  generate: ReturnType<typeof vi.fn>;
  completedResult: ReturnType<typeof vi.fn>;
} {
  return {
    generate: vi.fn(async (input: ProcedureAuthoringGenerateRequest) => generationResult(input)),
    completedResult: vi.fn(() => null),
  };
}

function findProviderDescriptor() {
  return structuredClone(providerDescriptor);
}

describe('Procedure zero-baseline generation', () => {
  it('allocates a stable tree, returns candidate-only output, coalesces replay, and restores', async () => {
    const events: ExecutionEventInput[] = [];
    const firstGeneration = generation();
    const coordinator = createProcedureZeroBaselineGenerationCoordinator({
      generation: firstGeneration,
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: (event) => events.push(event),
    });

    const [first, replay] = await Promise.all([
      coordinator.generate(request),
      coordinator.generate(request),
    ]);

    expect(replay).toEqual(first);
    expect(firstGeneration.generate).toHaveBeenCalledTimes(1);
    expect(first.allocation).toEqual({ strategy: 'request_fingerprint_uuid_v8' });
    expect(first.generation.tree.id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(first).toMatchObject({
      retrieval: { status: 'not_used', reason: 'zero_baseline_has_no_existing_tree' },
      outcome: 'candidate_only',
      generation: {
        sideEffects: {
          modelCalled: true,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      },
    });
    expect(procedureZeroBaselineResultSchema.parse(first)).toEqual(first);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-zero-baseline-generate-request.schema.json'),
      [
        { value: request, accepted: true },
        { value: { ...request, requestId: 'not-a-uuid' }, accepted: false },
        { value: { ...request, providerId: providerDescriptor.id }, accepted: false },
        { value: { ...request, treeId: 'caller-must-not-allocate' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-zero-baseline-result.schema.json'),
      [
        { value: first, accepted: true },
        {
          value: {
            ...first,
            generation: {
              ...first.generation,
              sideEffects: { ...first.generation.sideEffects, procedureStored: true },
            },
          },
          accepted: false,
        },
        {
          value: {
            ...first,
            allocation: { ...first.allocation, treeId: first.generation.tree.id },
          },
          accepted: false,
        },
      ],
    );
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.generation.requested',
      'procedure.zero-baseline.generation.completed',
    ]);

    const restartedGeneration = generation();
    const restarted = createProcedureZeroBaselineGenerationCoordinator({
      generation: restartedGeneration,
      findProviderDescriptor: () => null,
      existingEvents: stored(events),
      appendEvent: () => {
        throw new Error('Restored completion must not append duplicate evidence');
      },
    });
    await expect(restarted.generate(request)).resolves.toEqual(first);
    expect(restartedGeneration.generate).not.toHaveBeenCalled();
    expect(restartedGeneration.completedResult).not.toHaveBeenCalled();
    expect(() =>
      createProcedureZeroBaselineGenerationCoordinator({
        generation: restartedGeneration,
        findProviderDescriptor,
        existingEvents: stored(events.slice(1)),
        appendEvent: vi.fn(),
      }),
    ).toThrow(/missing its requested predecessor/);
  });

  it('fails closed on conflicting reuse, downstream failure, and identity drift', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedGeneration = generation();
    const coordinator = createProcedureZeroBaselineGenerationCoordinator({
      generation: selectedGeneration,
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: (event) => events.push(event),
    });
    await coordinator.generate(request);

    const conflict: ProcedureZeroBaselineGenerateRequest = {
      ...request,
      goal: '同一个 requestId 下被篡改的目标',
    };
    await expect(coordinator.generate(conflict)).rejects.toThrow(/reused with different/);
    expect(selectedGeneration.generate).toHaveBeenCalledTimes(1);

    const downstreamError = new Error('downstream generation failed safely');
    const failingEvents: ExecutionEventInput[] = [];
    const failing = createProcedureZeroBaselineGenerationCoordinator({
      generation: {
        generate: vi.fn(async () => Promise.reject(downstreamError)),
        completedResult: vi.fn(() => null),
      },
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: (event) => failingEvents.push(event),
    });
    await expect(
      failing.generate({ ...request, requestId: '69fbd31d-c9bb-413c-8500-bd25162bdc99' }),
    ).rejects.toBe(downstreamError);
    expect(failing.completedResult('69fbd31d-c9bb-413c-8500-bd25162bdc99')).toBeNull();
    expect(failingEvents.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.generation.requested',
    ]);

    const drifting = createProcedureZeroBaselineGenerationCoordinator({
      generation: {
        generate: vi.fn(async (input) => {
          const result = generationResult(input);
          return { ...result, provider: { ...result.provider, version: '9.9.9' } };
        }),
        completedResult: vi.fn(() => null),
      },
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: vi.fn(),
    });
    await expect(
      drifting.generate({ ...request, requestId: '65b08ba5-d806-4f97-8efb-e4052d4a4dbd' }),
    ).rejects.toThrow();
  });

  it('does not replay an indeterminate Provider call after restart', async () => {
    const requestedOnly: ExecutionEventInput[] = [];
    const first = generation();
    first.generate.mockRejectedValueOnce(new Error('process stopped after Provider dispatch'));
    const firstCoordinator = createProcedureZeroBaselineGenerationCoordinator({
      generation: first,
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: (event) => requestedOnly.push(event),
    });
    await expect(firstCoordinator.generate(request)).rejects.toThrow(/process stopped/);
    expect(requestedOnly).toHaveLength(1);

    const restartedGeneration = generation();
    const restarted = createProcedureZeroBaselineGenerationCoordinator({
      generation: restartedGeneration,
      findProviderDescriptor,
      existingEvents: stored(requestedOnly),
      appendEvent: vi.fn(),
    });
    await expect(restarted.generate(request)).rejects.toThrow(/will not be replayed/);
    expect(restartedGeneration.completedResult).toHaveBeenCalledTimes(1);
    expect(restartedGeneration.generate).not.toHaveBeenCalled();
  });

  it('rejects forged, missing, and unavailable runtime Provider disclosures before side effects', async () => {
    const forgedRequest = procedureZeroBaselineGenerateRequestSchema.parse({
      ...request,
      requestId: '881bceec-6309-43a1-b99d-e1dce94de496',
      authorization: {
        ...request.authorization,
        providerDescriptor: {
          ...request.authorization.providerDescriptor,
          dataHandling: {
            executionLocation: 'remote',
            dataTransmission: 'provider_managed',
            credentialManagement: 'provider_managed',
          },
        },
      },
    });
    const unavailableDescriptor = {
      ...providerDescriptor,
      availability: {
        available: false,
        reason: 'disabled',
        message: 'Disabled for this test.',
      },
    } as const;
    const cases = [
      {
        request: forgedRequest,
        resolver: findProviderDescriptor,
        message: /does not match the current runtime descriptor/,
      },
      {
        request: { ...request, requestId: 'd98a7572-4739-4123-b944-302950da33e4' },
        resolver: () => null,
        message: /is not registered/,
      },
      {
        request: { ...request, requestId: '5c5b349d-a42b-451c-b7d2-aeece6d1df44' },
        resolver: () => unavailableDescriptor,
        message: /is unavailable/,
      },
    ] as const;

    for (const testCase of cases) {
      const selectedGeneration = generation();
      const appendEvent = vi.fn();
      const coordinator = createProcedureZeroBaselineGenerationCoordinator({
        generation: selectedGeneration,
        findProviderDescriptor: testCase.resolver,
        existingEvents: [],
        appendEvent,
      });
      await expect(coordinator.generate(testCase.request)).rejects.toThrow(testCase.message);
      expect(appendEvent).not.toHaveBeenCalled();
      expect(selectedGeneration.generate).not.toHaveBeenCalled();
    }
  });

  it('closes the crash gap from underlying completion without a live Provider', async () => {
    const initialEvents: ExecutionEventInput[] = [];
    const initial = createProcedureZeroBaselineGenerationCoordinator({
      generation: generation(),
      findProviderDescriptor,
      existingEvents: [],
      appendEvent: (event) => initialEvents.push(event),
    });
    const first = await initial.generate(request);
    const requestedOnly = stored(initialEvents.slice(0, 1));

    const recoveryEvents: ExecutionEventInput[] = [];
    const recoveredGeneration = generation();
    recoveredGeneration.completedResult.mockReturnValue(first.generation);
    const restarted = createProcedureZeroBaselineGenerationCoordinator({
      generation: recoveredGeneration,
      findProviderDescriptor: () => null,
      existingEvents: requestedOnly,
      appendEvent: (event) => recoveryEvents.push(event),
    });

    await expect(restarted.generate(request)).resolves.toEqual(first);
    expect(recoveredGeneration.completedResult).toHaveBeenCalledOnce();
    expect(recoveredGeneration.generate).not.toHaveBeenCalled();
    expect(recoveryEvents.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.generation.completed',
    ]);

    const driftedGeneration = generation();
    driftedGeneration.completedResult.mockReturnValue({
      ...first.generation,
      provider: { ...first.generation.provider, version: '9.9.9' },
    });
    const appendDriftedEvent = vi.fn();
    const drifted = createProcedureZeroBaselineGenerationCoordinator({
      generation: driftedGeneration,
      findProviderDescriptor: () => null,
      existingEvents: requestedOnly,
      appendEvent: appendDriftedEvent,
    });
    await expect(drifted.generate(request)).rejects.toThrow(
      /changed zero-baseline request identity/,
    );
    expect(driftedGeneration.generate).not.toHaveBeenCalled();
    expect(appendDriftedEvent).not.toHaveBeenCalled();
  });
});
