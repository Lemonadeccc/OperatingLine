import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  compileProcedureTreeToGuidePlan,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringValidationResultSchema,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringPromptPacket,
} from '@operatingline/protocol';

import {
  createProcedureAuthoringGenerationCoordinator,
  restoreProcedureAuthoringProviderInvocations,
} from '../../../services/orchestrator/src/procedure-authoring-generation.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from '../../../services/orchestrator/src/guide-validation.js';

const request = {
  requestId: 'bc5ee4ab-cfda-4d78-9628-068544065522',
  providerId: 'procedure-author',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: '制作雪人的头部，并创建、定位、缩放和命名左眼球体。',
  treeId: 'snowman.eye.left.procedure',
  revision: 1,
  locale: 'zh-CN',
} as const;

function buildPacket(): ProcedureAuthoringPromptPacket {
  return buildProcedureAuthoringPromptPacket(
    {
      targetAdapterId: request.targetAdapterId,
      actionCatalogVersion: request.actionCatalogVersion,
      interactionCatalogVersion: request.interactionCatalogVersion,
      goal: request.goal,
      treeId: request.treeId,
      revision: request.revision,
      locale: request.locale,
    },
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
}

function candidate(packet = buildPacket()): ProcedureAuthoringCandidateTree {
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
  const evidence = { ...packet.context.goalProvenance.evidence, sourceId: source.id };
  tree['sources'] = [...(tree['sources'] as unknown[]), source];
  tree['evidence'] = [...(tree['evidence'] as unknown[]), evidence];
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'Provider candidates cannot assert catalog grounding.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'Provider candidates cannot assert shortcut verification.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'Provider candidates cannot invent action-level tools.',
        modality: 'mcp',
      },
    ];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function provider(output: () => unknown): PlannerProvider {
  const descriptor = plannerProviderDescriptorSchema.parse({
    contractVersion: plannerProviderContractVersion,
    id: request.providerId,
    version: '1.0.0',
    displayName: 'Procedure author test provider',
    description: 'Returns a deterministic ProcedureTree candidate for tests.',
    availability: { available: true },
    limits: { maxConcurrency: 1 },
    dataHandling: {
      executionLocation: 'local',
      dataTransmission: 'none',
      credentialManagement: 'provider_managed',
    },
  });
  return {
    descriptor,
    describeRuntimeTreatment: (operation) => ({
      profile: {
        descriptor,
        vendor: 'test',
        implementation: { name: 'procedure-author-test', version: '1.0.0' },
        model: {
          requested: 'deterministic-test',
          resolvedRevision: 'deterministic-test-1',
          resolution: 'resolved',
        },
        api: {
          surface: operation,
          version: '1.0.0',
          sdkName: 'test',
          sdkVersion: '1.0.0',
          endpointClass: 'local',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: { mode: 'deterministic' },
        seed: null,
        determinism: 'deterministic',
      },
    }),
    generate: async () => ({}),
    authorProcedure: vi.fn(async ({ packet, renderedPrompt }) => {
      expect(renderedPrompt).toBe(
        Buffer.from(canonicalizeProtocolJsonValue(packet)).toString('utf8'),
      );
      return output();
    }),
  };
}

function validateCandidate(
  packet: ProcedureAuthoringPromptPacket,
  tree: ProcedureAuthoringCandidateTree,
) {
  const plan = compileProcedureTreeToGuidePlan(tree);
  validateGuidePlanStructure(plan);
  validateGuidePlanAgainstActionCatalog(plan, blenderActionCatalog);
  return procedureAuthoringValidationResultSchema.parse({
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
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-18T00:00:00.000Z',
  }));
}

describe('Procedure authoring provider generation', () => {
  it('calls the explicit capability, validates the candidate, audits it, and is idempotent', async () => {
    const expected = candidate();
    const selectedProvider = provider(() => expected);
    const events: ExecutionEventInput[] = [];
    const registry = createPlannerProviderRegistry([selectedProvider]);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry,
      existingEvents: [],
      buildPacket: () => buildPacket(),
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    expect(registry.listProcedureAuthors()).toMatchObject({
      generationAvailable: true,
      providers: [{ id: request.providerId }],
    });
    const first = await coordinator.generate(request);
    const second = await coordinator.generate(request);

    expect(second).toEqual(first);
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      requestId: request.requestId,
      provider: { id: request.providerId, version: '1.0.0' },
      packet: { context: { requestedTreeId: request.treeId } },
      tree: { id: request.treeId, revision: 1 },
      sideEffects: {
        modelCalled: true,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.authoring.provider.generation.requested',
      'procedure.authoring.provider.generation.completed',
    ]);
    expect(events[0]?.payload).toMatchObject({
      runtimeTreatment: { operation: 'procedure_authoring' },
    });
    expect(events[1]?.payload).toMatchObject({
      runtimeAttestation: {
        operation: 'procedure_authoring',
        treatment: { operation: 'procedure_authoring' },
      },
    });
    expect(restoreProcedureAuthoringProviderInvocations(stored(events))).toMatchObject([
      { operation: 'procedure_authoring' },
      { operation: 'procedure_authoring', result: first },
    ]);
    await coordinator.close();

    const restartedProvider = provider(() => {
      throw new Error('A completed generation must restore without another provider call.');
    });
    const restarted = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([restartedProvider]),
      existingEvents: stored(events),
      buildPacket: () => buildPacket(),
      validateCandidate,
      appendEvent: () => {
        throw new Error('A restored completed generation must not append duplicate evidence.');
      },
    });
    await expect(restarted.generate(request)).resolves.toEqual(first);
    expect(restartedProvider.authorProcedure).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('fails closed on packet identity changes and records one terminal failure', async () => {
    const changed = structuredClone(candidate());
    changed.id = 'different.procedure';
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider(() => changed);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_identity_mismatch',
      retryMode: 'new_request_id',
    });
    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_generation_already_attempted',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.authoring.provider.generation.requested',
      'procedure.authoring.provider.generation.failed',
    ]);
    await coordinator.close();
  });

  it('rejects providers without the explicit Procedure authoring method before any call', async () => {
    const selectedProvider = provider(() => candidate());
    delete (selectedProvider as { authorProcedure?: unknown }).authorProcedure;
    const events: ExecutionEventInput[] = [];
    const registry = createPlannerProviderRegistry([selectedProvider]);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry,
      existingEvents: [],
      buildPacket: () => buildPacket(),
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    expect(registry.listProcedureAuthors()).toMatchObject({
      generationAvailable: false,
      providers: [],
    });
    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_procedure_authoring_not_supported',
      retryMode: 'same_request_id',
    });
    expect(events).toEqual([]);
    await coordinator.close();
  });
});
