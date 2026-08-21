import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  canonicalizeProtocolJsonValue,
  compileProcedureTreeToGuidePlan,
  plannerProviderContractVersion,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringValidationResultSchema,
  procedureRefinementCreateRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureTreeSummarySchema,
  protocolJsonValueCanonicalization,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringGenerateRequest,
  type ProcedureAuthoringPromptPacket,
  type ProcedureRefinementCreateRequest,
  type ProcedureTreeSummary,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it, vi } from 'vitest';

import { snapshotPlannerProviderRuntimeTreatment } from '../../../services/orchestrator/src/planner-provider-attestation.js';
import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { createProcedureRefinementScope } from '../../../services/orchestrator/src/procedure-refinement-scope.js';
import { createProcedureSemanticRetrievalCoordinator } from '../../../services/orchestrator/src/procedure-semantic-retrieval.js';
import {
  createProcedureZeroBaselineRefinementCoordinator,
  type ProcedureZeroBaselineRefinementCoordinatorOptions,
} from '../../../services/orchestrator/src/procedure-zero-baseline-refinement.js';
import {
  procedureZeroBaselineRefinementCreateRequestSchema,
  procedureZeroBaselineRefinementStartRequestSchema,
  procedureZeroBaselineReviewRequestSchema,
  procedureZeroBaselineSemanticStartRequestSchema,
} from '../../../packages/protocol/src/procedure-zero-baseline-refinement.js';

const generationDescriptor = {
  contractVersion: plannerProviderContractVersion,
  id: 'zero-baseline-author',
  version: '1.0.0',
  displayName: 'Zero baseline author',
  description: 'Deterministic zero baseline author.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

const refinementDescriptor = {
  ...generationDescriptor,
  id: 'zero-baseline-refiner',
  displayName: 'Zero baseline refiner',
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function provider(descriptor = refinementDescriptor): PlannerProvider {
  return {
    descriptor,
    generate: vi.fn(async () => ({})),
    embedProcedure: vi.fn(async ({ documents }) => ({
      vectors: documents.map(() => [1, 0]),
    })),
    procedureRefinementDialogue: vi.fn(async () => ({})),
    refineProcedure: vi.fn(async () => ({})),
    describeRuntimeTreatment: vi.fn((operation) => ({
      profile: {
        descriptor,
        vendor: 'Local test',
        implementation: { name: 'zero-baseline-workflow-test', version: '1.0.0' },
        model: {
          requested: `${operation}-fixture`,
          resolvedRevision: 'fixture-1',
          resolution: 'resolved',
        },
        api: {
          surface: 'memory',
          version: '1',
          sdkName: 'none',
          sdkVersion: '1.0.0',
          endpointClass: 'local',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: { operation },
        seed: 1,
        determinism: 'deterministic',
      },
      costPolicy: {
        possibleProviderCost: false,
        basis: 'no_provider_cost',
        publicStatement: 'The in-memory Provider has no provider charge.',
      },
    })),
  };
}

function candidate(packet: ProcedureAuthoringPromptPacket): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = packet.context.requestedTreeId;
  tree['revision'] = 1;
  tree['adapterId'] = packet.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  tree['sources'] = [...(tree['sources'] as unknown[]), packet.context.goalProvenance.source];
  tree['evidence'] = [
    ...(tree['evidence'] as unknown[]),
    {
      ...packet.context.goalProvenance.evidence,
      sourceId: packet.context.goalProvenance.source.id,
    },
  ];
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'Zero-baseline candidates cannot invent menu grounding.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'Zero-baseline candidates cannot invent shortcut grounding.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'Zero-baseline candidates cannot invent MCP grounding.',
        modality: 'mcp',
      },
    ];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function generationResult(input: ProcedureAuthoringGenerateRequest) {
  const packet = buildProcedureAuthoringPromptPacket(
    {
      targetAdapterId: input.targetAdapterId,
      actionCatalogVersion: input.actionCatalogVersion,
      interactionCatalogVersion: input.interactionCatalogVersion,
      goal: input.goal,
      treeId: input.treeId,
      revision: 1,
      locale: input.locale,
    },
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const tree = candidate(packet);
  const plan = compileProcedureTreeToGuidePlan(tree);
  const validation = procedureAuthoringValidationResultSchema.parse({
    formatVersion: '1.0.0',
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
    generationId: '30d98484-77b5-4f00-88a8-3c0424c80ba0',
    requestId: input.requestId,
    provider: { id: generationDescriptor.id, version: generationDescriptor.version },
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

const createRequest = procedureZeroBaselineRefinementCreateRequestSchema.parse({
  formatVersion: '1.0.0',
  workflowId: 'a5990693-fc24-45c5-9795-f8d4c25eb733',
  generationRequest: {
    formatVersion: '1.0.0',
    requestId: '69ba2026-507e-4d29-a93c-adfca4daf594',
    targetAdapterId: 'blender',
    actionCatalogVersion: blenderActionCatalog.catalogVersion,
    interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
    goal: 'Create a precise eye sphere.',
    locale: 'en-US',
    authorization: {
      providerDescriptor: generationDescriptor,
      explicitlyConfirmedByUser: true,
      goalAndCatalogContextTransmissionAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      confirmedAt: '2026-08-20T02:00:00.000Z',
    },
  },
  authorization: {
    explicitlyConfirmedByUser: true,
    candidateOnlyUntilExactReviewAcknowledged: true,
    noHostExecutionAcknowledged: true,
    confirmedAt: '2026-08-20T02:00:00.000Z',
  },
});

class MemoryEvents {
  readonly values: StoredExecutionEvent[] = [];

  append = (input: ExecutionEventInput): StoredExecutionEvent => {
    if (this.values.some((event) => event.id === input.id)) throw new Error('duplicate');
    const stored = {
      sequence: this.values.length + 1,
      id: input.id,
      eventType: input.eventType,
      payload: structuredClone(input.payload),
      createdAt:
        input.createdAt ??
        (input.payload as { occurredAt?: string }).occurredAt ??
        '2026-08-20T02:00:06.000Z',
    };
    this.values.push(stored);
    return stored;
  };
}

function summary(stored: StoredProcedureTree): ProcedureTreeSummary {
  return procedureTreeSummarySchema.parse({
    sequence: stored.sequence,
    treeId: stored.tree.id,
    revision: stored.tree.revision,
    title: stored.tree.title,
    adapterId: stored.tree.adapterId,
    actionCatalogVersion: stored.tree.actionCatalogVersion,
    interactionCatalogVersion: stored.tree.interactionCatalogVersion,
    hostVersionRange: stored.tree.hostVersionRange,
    integrity: stored.integrity,
    storedAt: stored.storedAt,
  });
}

async function setup(optionsInput: { invalidSemanticEmbedding?: boolean } = {}) {
  const events = new MemoryEvents();
  let storedBaseline: StoredProcedureTree | null = null;
  const generation = {
    generate: vi.fn(async (request: typeof createRequest.generationRequest) => ({
      formatVersion: '1.0.0' as const,
      requestFingerprint: plannerProviderRequestFingerprint(request),
      allocation: { strategy: 'request_fingerprint_uuid_v8' as const },
      retrieval: {
        status: 'not_used' as const,
        reason: 'zero_baseline_has_no_existing_tree' as const,
      },
      outcome: 'candidate_only' as const,
      generation: generationResult({
        requestId: request.requestId,
        providerId: generationDescriptor.id,
        targetAdapterId: request.targetAdapterId,
        actionCatalogVersion: request.actionCatalogVersion,
        interactionCatalogVersion: request.interactionCatalogVersion,
        goal: request.goal,
        treeId: '27ea1147-4b72-80b5-87c0-2b7fcbb831ca',
        revision: 1,
        locale: request.locale,
      }),
    })),
    completedResult: vi.fn(() => null),
  };
  const embeddingProvider = provider();
  if (optionsInput.invalidSemanticEmbedding) {
    embeddingProvider.embedProcedure = vi.fn(async ({ documents }) => ({
      vectors: documents.map((_, index) => (index === 0 ? [1, 0] : [0, 0])),
    }));
  }
  const semanticEvents = new MemoryEvents();
  const semantic = createProcedureSemanticRetrievalCoordinator({
    registry: createPlannerProviderRegistry([embeddingProvider]),
    existingEvents: [],
    listProcedureTrees: () => (storedBaseline === null ? [] : [summary(storedBaseline)]),
    getProcedureTree: () => storedBaseline,
    appendEvent: semanticEvents.append,
    now: () => new Date('2026-08-20T02:00:06.000Z'),
  });
  const refinementProvider = provider();
  let refinementStatus: ReturnType<typeof procedureRefinementRunStatusSchema.parse> | null = null;
  const refinement = {
    getSemanticContextReceipt: (requestId: string) => {
      const evidence = semantic.completedEvidence(requestId);
      return evidence === null
        ? null
        : {
            status: 'completed' as const,
            requestId: evidence.requestId,
            retrievalId: evidence.retrievalId,
            resultContentSha256: evidence.resultContentSha256,
            completedEventContentSha256: evidence.eventContentSha256,
            completedAt: evidence.occurredAt,
          };
    },
    create: vi.fn((request: ProcedureRefinementCreateRequest) => {
      refinementStatus ??= procedureRefinementRunStatusSchema.parse({
        formatVersion: '1.0.0',
        runId: request.runId,
        dialogueRequestId: request.dialogueRequestId,
        refinementRequestId: request.refinementRequestId,
        baseTree: request.baseTree,
        targetRevision: request.targetRevision,
        scope: createProcedureRefinementScope(request.baseTree.tree, request.requestedScopeRootIds),
        semanticContext: request.semanticContext,
        providerDisclosure: request.providerDisclosure,
        status: 'queued',
        terminal: false,
        assistantMessage: '',
        assistantMessageRevision: 0,
        semanticDecision: null,
        preview: null,
        review: null,
        storedTree: null,
        needsRevision: null,
        error: null,
        sideEffects: {
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        updatedAt: '2026-08-20T02:00:07.000Z',
      });
      return structuredClone(refinementStatus);
    }),
    get: vi.fn(() => structuredClone(refinementStatus)),
  };
  const options: ProcedureZeroBaselineRefinementCoordinatorOptions = {
    generation,
    semanticRetrieval: semantic,
    refinement,
    getProcedureTree: (treeId, revision) =>
      storedBaseline?.tree.id === treeId && storedBaseline.tree.revision === revision
        ? storedBaseline
        : null,
    getLatestProcedureTree: () => storedBaseline,
    storeWithEvidence: ({ tree, evidence }) => {
      storedBaseline = {
        sequence: 1,
        tree: structuredClone(tree),
        integrity: {
          algorithm: 'sha256',
          canonicalization: protocolJsonValueCanonicalization,
          contentSha256: sha256(tree),
        },
        storedAt: evidence.createdAt,
      };
      return { storedTree: storedBaseline, storedEvent: events.append(evidence) };
    },
    existingEvents: [],
    appendEvent: events.append,
    now: () => new Date('2026-08-20T02:00:07.000Z'),
  };
  return {
    options,
    events,
    generation,
    refinement,
    refinementProvider,
    embeddingProvider,
    semanticEvents,
    restartSemantic: () =>
      createProcedureSemanticRetrievalCoordinator({
        registry: createPlannerProviderRegistry([embeddingProvider]),
        existingEvents: semanticEvents.values,
        listProcedureTrees: () => (storedBaseline === null ? [] : [summary(storedBaseline)]),
        getProcedureTree: () => storedBaseline,
        appendEvent: semanticEvents.append,
        now: () => new Date('2026-08-20T02:00:06.000Z'),
      }),
    getStored: () => storedBaseline,
  };
}

function semanticRequestFor(
  storedBaseline: StoredProcedureTree,
  refinementProvider: PlannerProvider,
  requestId = '333d0ca6-d729-4f49-b153-cde1d80cb1ab',
) {
  return procedureSemanticRetrievalRequestSchema.parse({
    formatVersion: '1.0.0',
    requestId,
    query: 'create a precisely positioned eye sphere',
    providerDisclosure: {
      providerDescriptor: refinementDescriptor,
      runtimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        refinementProvider,
        refinementDescriptor,
        'procedure_embedding',
      ),
    },
    filters: {
      adapterId: storedBaseline.tree.adapterId,
      actionCatalogVersion: storedBaseline.tree.actionCatalogVersion,
      interactionCatalogVersion: storedBaseline.tree.interactionCatalogVersion,
      validationStatus: 'candidate',
    },
    retrieval: { topK: 5, minScore: -1 },
    authorization: {
      explicitlyConfirmedByUser: true,
      dataHandlingAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      disclosure: {
        providerDescriptorDisclosed: true,
        embeddingModelAndRuntimeTreatmentDisclosed: true,
        costPolicyDisclosed: true,
        querySentToProvider: true,
        boundedLeafDocumentSentToProvider: true,
        sourceEvidenceContentSentToProvider: false,
        documentFormat: 'procedure_leaf_embedding_document_v1',
      },
      confirmedAt: '2026-08-20T02:00:05.000Z',
    },
  });
}

function nativeRefinementRequestFor(
  storedBaseline: StoredProcedureTree,
  semanticContext: ProcedureRefinementCreateRequest['semanticContext'],
  refinementProvider: PlannerProvider,
) {
  const inputPolicy = {
    exactStoredBaseTreeSent: true,
    exactSemanticRetrievalResultSent: true,
    instructionSent: true,
    dialogueHistorySent: true,
    credentialsIncludedInTaskPayload: false,
  } as const;
  return procedureRefinementCreateRequestSchema.parse({
    formatVersion: '1.0.0',
    runId: '4c942c00-e757-46c8-9c17-1abc35569e82',
    dialogueRequestId: '38220bdb-7196-45a7-bc01-ff1cb8bda46e',
    refinementRequestId: '90cb9a75-09d2-4207-a43a-a9b5e90a510b',
    baseTree: storedBaseline,
    targetRevision: 2,
    requestedScopeRootIds: [storedBaseline.tree.rootNodeId],
    semanticContext,
    instruction: 'Make the selected eye more precise.',
    history: [],
    providerDisclosure: {
      providerDescriptor: refinementDescriptor,
      dialogueRuntimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        refinementProvider,
        refinementDescriptor,
        'procedure_refinement_dialogue',
      ),
      refinementRuntimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        refinementProvider,
        refinementDescriptor,
        'procedure_refinement',
      ),
      inputPolicy,
    },
    authorization: {
      explicitlyConfirmedByUser: true,
      dataHandlingAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      authorizedProviderCallLimit: 2,
      automaticRefinementAcknowledged: true,
      noHostExecutionAcknowledged: true,
      exactStoredBaseTreeDisclosed: true,
      exactSemanticContextDisclosed: true,
      dialogueAndRefinementRuntimeTreatmentsDisclosed: true,
      providerInputPolicy: inputPolicy,
      confirmedAt: '2026-08-20T02:00:07.000Z',
    },
  });
}

async function storeReviewedBaseline(
  fixture: Awaited<ReturnType<typeof setup>>,
  reviewId = 'effed734-0b5a-4ed5-8c45-17466ba8e551',
  options = fixture.options,
) {
  const coordinator = createProcedureZeroBaselineRefinementCoordinator(options);
  const ready = await coordinator.create(createRequest);
  const reviewed = coordinator.review({
    formatVersion: '1.0.0',
    workflowId: createRequest.workflowId,
    reviewId,
    binding: ready.baselineReviewBinding!,
    decision: {
      kind: 'store',
      confirmations: {
        exactCandidateTreeReviewed: true,
        exactCatalogBindingReviewed: true,
        candidateOnlyAndNoHostExecutionAcknowledged: true,
      },
    },
    reviewedAt: '2026-08-20T02:00:07.000Z',
  });
  return { coordinator, reviewed };
}

describe('Procedure zero-baseline staged refinement workflow', () => {
  it.each([
    'procedure.zero-baseline.workflow.created',
    'procedure.zero-baseline.workflow.baseline-ready',
  ] as const)('locks outcome-unknown %s evidence until restart recovery', async (eventType) => {
    const fixture = await setup();
    let failOnce = true;
    const coordinator = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      appendEvent: (event) => {
        const stored = fixture.events.append(event);
        if (failOnce && event.eventType === eventType) {
          failOnce = false;
          throw new Error('committed before response failure');
        }
        return stored;
      },
    });

    await expect(coordinator.create(createRequest)).rejects.toMatchObject({
      code: 'procedure_zero_baseline_persistence_outcome_unknown',
    });
    expect(() => coordinator.get(createRequest.workflowId)).toThrow(
      'persistence outcome is unknown',
    );
    await expect(coordinator.create(createRequest)).rejects.toMatchObject({
      code: 'procedure_zero_baseline_persistence_outcome_unknown',
    });

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    if (eventType === 'procedure.zero-baseline.workflow.created') {
      expect(restarted.get(createRequest.workflowId)?.phase).toBe('generating');
      await expect(restarted.create(createRequest)).resolves.toMatchObject({
        phase: 'awaiting_baseline_review',
      });
    } else {
      expect(restarted.get(createRequest.workflowId)?.phase).toBe('awaiting_baseline_review');
      await expect(restarted.create(createRequest)).resolves.toMatchObject({
        phase: 'awaiting_baseline_review',
      });
    }
    expect(fixture.generation.generate).toHaveBeenCalledTimes(1);
  });

  it('locks an atomic baseline store that committed before throwing and restores from evidence', async () => {
    const fixture = await setup();
    const committedStore = fixture.options.storeWithEvidence;
    const coordinator = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      storeWithEvidence: (input) => {
        committedStore(input);
        throw new Error('commit succeeded but response failed');
      },
    });
    const ready = await coordinator.create(createRequest);
    const storeReview = procedureZeroBaselineReviewRequestSchema.parse({
      formatVersion: '1.0.0',
      workflowId: createRequest.workflowId,
      reviewId: 'effed734-0b5a-4ed5-8c45-17466ba8e551',
      binding: ready.baselineReviewBinding,
      decision: {
        kind: 'store',
        confirmations: {
          exactCandidateTreeReviewed: true,
          exactCatalogBindingReviewed: true,
          candidateOnlyAndNoHostExecutionAcknowledged: true,
        },
      },
      reviewedAt: '2026-08-20T02:00:07.000Z',
    });

    expect(() => coordinator.review(storeReview)).toThrow('persistence outcome is unknown');
    expect(() => coordinator.get(createRequest.workflowId)).toThrow(
      'persistence outcome is unknown',
    );
    expect(() =>
      coordinator.review({
        ...storeReview,
        reviewId: 'fde10a03-37ec-473b-b11d-0dd3ac09db19',
        decision: { kind: 'discard' },
      }),
    ).toThrow('persistence outcome is unknown');
    expect(
      fixture.events.values.filter(
        (event) => event.eventType === 'procedure.zero-baseline.workflow.baseline-reviewed',
      ),
    ).toHaveLength(1);

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)?.phase).toBe('awaiting_semantic');
  });

  it('locks a discard review saved before append threw and forbids a contrary store', async () => {
    const fixture = await setup();
    const live = createProcedureZeroBaselineRefinementCoordinator(fixture.options);
    const ready = await live.create(createRequest);
    let failReviewedOnce = true;
    const coordinator = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
      appendEvent: (event) => {
        const stored = fixture.events.append(event);
        if (
          failReviewedOnce &&
          event.eventType === 'procedure.zero-baseline.workflow.baseline-reviewed'
        ) {
          failReviewedOnce = false;
          throw new Error('discard evidence saved before response failure');
        }
        return stored;
      },
    });
    const discard = procedureZeroBaselineReviewRequestSchema.parse({
      formatVersion: '1.0.0',
      workflowId: createRequest.workflowId,
      reviewId: 'effed734-0b5a-4ed5-8c45-17466ba8e551',
      binding: ready.baselineReviewBinding,
      decision: { kind: 'discard' },
      reviewedAt: '2026-08-20T02:00:07.000Z',
    });

    expect(() => coordinator.review(discard)).toThrow('persistence outcome is unknown');
    expect(() =>
      coordinator.review({
        ...discard,
        reviewId: 'fde10a03-37ec-473b-b11d-0dd3ac09db19',
        decision: {
          kind: 'store',
          confirmations: {
            exactCandidateTreeReviewed: true,
            exactCatalogBindingReviewed: true,
            candidateOnlyAndNoHostExecutionAcknowledged: true,
          },
        },
      }),
    ).toThrow('persistence outcome is unknown');
    expect(fixture.getStored()).toBeNull();

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)?.phase).toBe('baseline_discarded');
  });

  it('requires exact review and storage before nonempty semantic context and native refinement', async () => {
    const fixture = await setup();
    const coordinator = createProcedureZeroBaselineRefinementCoordinator(fixture.options);
    const ready = await coordinator.create(createRequest);

    expect(ready.phase).toBe('awaiting_baseline_review');
    expect(ready.sideEffects.procedureStored).toBe(false);
    expect(fixture.events.values.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.workflow.created',
      'procedure.zero-baseline.workflow.baseline-ready',
    ]);

    const reviewed = coordinator.review(
      procedureZeroBaselineReviewRequestSchema.parse({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        reviewId: 'effed734-0b5a-4ed5-8c45-17466ba8e551',
        binding: ready.baselineReviewBinding,
        decision: {
          kind: 'store',
          confirmations: {
            exactCandidateTreeReviewed: true,
            exactCatalogBindingReviewed: true,
            candidateOnlyAndNoHostExecutionAcknowledged: true,
          },
        },
        reviewedAt: '2026-08-20T02:00:07.000Z',
      }),
    );
    expect(reviewed.phase).toBe('awaiting_semantic');
    expect(reviewed.sideEffects).toEqual({
      procedureStored: true,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    const reviewedEvidence = fixture.events.values[2]!.payload as Record<string, unknown>;
    expect(reviewedEvidence).not.toHaveProperty('storedBaseline');
    expect(reviewedEvidence['storageBinding']).toEqual({
      treeId: reviewed.storedBaseline!.tree.id,
      revision: 1,
      contentSha256: reviewed.storedBaseline!.integrity.contentSha256,
      storedAt: reviewed.storedBaseline!.storedAt,
    });

    const semanticRequest = semanticRequestFor(
      reviewed.storedBaseline!,
      fixture.refinementProvider,
    );
    const grounded = await coordinator.startSemantic(
      procedureZeroBaselineSemanticStartRequestSchema.parse({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: semanticRequest,
      }),
    );
    expect(grounded.phase).toBe('awaiting_refinement');
    expect(grounded.semanticRetrieval!.hits.length).toBeGreaterThan(0);

    const disclosure = {
      providerDescriptor: refinementDescriptor,
      dialogueRuntimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        fixture.refinementProvider,
        refinementDescriptor,
        'procedure_refinement_dialogue',
      ),
      refinementRuntimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        fixture.refinementProvider,
        refinementDescriptor,
        'procedure_refinement',
      ),
      inputPolicy: {
        exactStoredBaseTreeSent: true,
        exactSemanticRetrievalResultSent: true,
        instructionSent: true,
        dialogueHistorySent: true,
        credentialsIncludedInTaskPayload: false,
      },
    };
    const nativeRequest = procedureRefinementCreateRequestSchema.parse({
      formatVersion: '1.0.0',
      runId: '4c942c00-e757-46c8-9c17-1abc35569e82',
      dialogueRequestId: '38220bdb-7196-45a7-bc01-ff1cb8bda46e',
      refinementRequestId: '90cb9a75-09d2-4207-a43a-a9b5e90a510b',
      baseTree: grounded.storedBaseline,
      targetRevision: 2,
      requestedScopeRootIds: [grounded.storedBaseline!.tree.rootNodeId],
      semanticContext: grounded.semanticContext,
      instruction: 'Make the selected eye more precise.',
      history: [],
      providerDisclosure: disclosure,
      authorization: {
        explicitlyConfirmedByUser: true,
        dataHandlingAcknowledged: true,
        possibleProviderCostAcknowledged: true,
        authorizedProviderCallLimit: 2,
        automaticRefinementAcknowledged: true,
        noHostExecutionAcknowledged: true,
        exactStoredBaseTreeDisclosed: true,
        exactSemanticContextDisclosed: true,
        dialogueAndRefinementRuntimeTreatmentsDisclosed: true,
        providerInputPolicy: disclosure.inputPolicy,
        confirmedAt: '2026-08-20T02:00:07.000Z',
      },
    });
    expect(() =>
      coordinator.startRefinement({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: { ...nativeRequest, runId: reviewed.baselineReview!.reviewId },
      }),
    ).toThrow('identities must all differ');
    expect(fixture.refinement.create).not.toHaveBeenCalled();
    const started = coordinator.startRefinement(
      procedureZeroBaselineRefinementStartRequestSchema.parse({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: nativeRequest,
      }),
    );
    expect(started.phase).toBe('refinement');
    expect(started.refinement?.status).toBe('queued');
    expect(fixture.refinement.create).toHaveBeenCalledWith(nativeRequest);
    expect(fixture.events.values.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.workflow.created',
      'procedure.zero-baseline.workflow.baseline-ready',
      'procedure.zero-baseline.workflow.baseline-reviewed',
      'procedure.zero-baseline.workflow.semantic-started',
      'procedure.zero-baseline.workflow.semantic-ready',
      'procedure.zero-baseline.workflow.refinement-started',
    ]);

    await expect(coordinator.create(createRequest)).resolves.toEqual(started);
    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: semanticRequest,
      }),
    ).resolves.toEqual(started);
    expect(
      coordinator.startRefinement({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: nativeRequest,
      }),
    ).toEqual(started);
    expect(fixture.generation.generate).toHaveBeenCalledTimes(1);

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)).toEqual(started);
    expect(() =>
      createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        getProcedureTree: () => null,
        existingEvents: fixture.events.values,
      }),
    ).toThrow('referenced by review evidence is missing');
    await expect(
      restarted.create({
        ...createRequest,
        generationRequest: { ...createRequest.generationRequest, goal: 'conflicting goal' },
      }),
    ).rejects.toThrow('conflicts');
  });

  it('terminally records a durable semantic failure and restores it without replay', async () => {
    const fixture = await setup({ invalidSemanticEmbedding: true });
    const { coordinator, reviewed } = await storeReviewedBaseline(fixture);
    const request = semanticRequestFor(reviewed.storedBaseline!, fixture.refinementProvider);

    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).rejects.toMatchObject({ code: 'planner_output_invalid' });

    const failed = coordinator.get(createRequest.workflowId)!;
    expect(failed).toMatchObject({
      phase: 'semantic_failed',
      terminal: true,
      semanticFailure: {
        requestId: request.requestId,
        error: { code: 'planner_output_invalid', retryable: false },
      },
    });
    expect(fixture.semanticEvents.values.map((event) => event.eventType)).toEqual([
      'procedure.semantic.retrieval.requested',
      'procedure.semantic.retrieval.failed',
    ]);
    expect(fixture.events.values.at(-1)?.eventType).toBe(
      'procedure.zero-baseline.workflow.semantic-failed',
    );

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)).toEqual(failed);
    const tamperedEvents = structuredClone(fixture.events.values);
    const failurePayload = tamperedEvents.at(-1)!.payload as {
      failure: { requestContentSha256: string };
    };
    failurePayload.failure.requestContentSha256 = '0'.repeat(64);
    expect(() =>
      createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        existingEvents: tamperedEvents,
      }),
    ).toThrow('semantic-failed evidence is invalid');
    await expect(
      restarted.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).rejects.toThrow('reviewed stored zero-baseline');
    expect(fixture.semanticEvents.values).toHaveLength(2);
  });

  it('reconciles a durable semantic success after the first ready checkpoint write fails', async () => {
    const fixture = await setup();
    let failReadyOnce = true;
    const appendEvent = vi.fn((event: ExecutionEventInput) => {
      if (failReadyOnce && event.eventType === 'procedure.zero-baseline.workflow.semantic-ready') {
        failReadyOnce = false;
        throw new Error('ready checkpoint unavailable');
      }
      return fixture.events.append(event);
    });
    const liveOptions = { ...fixture.options, appendEvent };
    const { coordinator, reviewed } = await storeReviewedBaseline(
      fixture,
      'effed734-0b5a-4ed5-8c45-17466ba8e551',
      liveOptions,
    );
    const request = semanticRequestFor(reviewed.storedBaseline!, fixture.refinementProvider);

    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).rejects.toMatchObject({
      code: 'procedure_zero_baseline_persistence_outcome_unknown',
    });
    expect(() => coordinator.get(createRequest.workflowId)).toThrow(
      'persistence outcome is unknown',
    );
    expect(fixture.events.values.map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.workflow.created',
      'procedure.zero-baseline.workflow.baseline-ready',
      'procedure.zero-baseline.workflow.baseline-reviewed',
      'procedure.zero-baseline.workflow.semantic-started',
    ]);
    expect(fixture.semanticEvents.values.map((event) => event.eventType)).toEqual([
      'procedure.semantic.retrieval.requested',
      'procedure.semantic.retrieval.completed',
    ]);

    const restartedSemantic = fixture.restartSemantic();
    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      semanticRetrieval: restartedSemantic,
      refinement: {
        ...fixture.options.refinement,
        getSemanticContextReceipt: (requestId) => {
          const evidence = restartedSemantic.completedEvidence(requestId);
          return evidence === null
            ? null
            : {
                status: 'completed',
                requestId: evidence.requestId,
                retrievalId: evidence.retrievalId,
                resultContentSha256: evidence.resultContentSha256,
                completedEventContentSha256: evidence.eventContentSha256,
                completedAt: evidence.occurredAt,
              };
        },
      },
      existingEvents: fixture.events.values,
    });
    const reconciled = await restarted.startSemantic({
      formatVersion: '1.0.0',
      workflowId: createRequest.workflowId,
      request,
    });
    expect(reconciled.phase).toBe('awaiting_refinement');
    expect(fixture.events.values.at(-1)?.eventType).toBe(
      'procedure.zero-baseline.workflow.semantic-ready',
    );
    expect(
      fixture.events.values.some(
        (event) => event.eventType === 'procedure.zero-baseline.workflow.semantic-failed',
      ),
    ).toBe(false);
    expect(fixture.embeddingProvider.embedProcedure).toHaveBeenCalledTimes(1);
  });

  it('does not call the Provider after semantic-started was saved but append threw', async () => {
    const fixture = await setup();
    const { reviewed } = await storeReviewedBaseline(fixture);
    let failStartedOnce = true;
    const coordinator = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
      appendEvent: (event) => {
        const stored = fixture.events.append(event);
        if (
          failStartedOnce &&
          event.eventType === 'procedure.zero-baseline.workflow.semantic-started'
        ) {
          failStartedOnce = false;
          throw new Error('semantic-started saved before response failure');
        }
        return stored;
      },
    });
    const request = semanticRequestFor(reviewed.storedBaseline!, fixture.refinementProvider);

    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).rejects.toMatchObject({
      code: 'procedure_zero_baseline_persistence_outcome_unknown',
    });
    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: { ...request, query: 'must not reach the Provider' },
      }),
    ).rejects.toMatchObject({
      code: 'procedure_zero_baseline_persistence_outcome_unknown',
    });
    expect(fixture.embeddingProvider.embedProcedure).not.toHaveBeenCalled();

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)?.phase).toBe('semantic_retrieving');
    await expect(
      restarted.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).resolves.toMatchObject({ phase: 'awaiting_refinement' });
    expect(fixture.embeddingProvider.embedProcedure).toHaveBeenCalledTimes(1);
  });

  it('restores semantic ready/failed events that were saved before append threw', async () => {
    for (const outcome of ['ready', 'failed'] as const) {
      const fixture = await setup({ invalidSemanticEmbedding: outcome === 'failed' });
      const { reviewed } = await storeReviewedBaseline(fixture);
      let failTerminalOnce = true;
      const coordinator = createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        existingEvents: fixture.events.values,
        appendEvent: (event) => {
          const stored = fixture.events.append(event);
          if (
            failTerminalOnce &&
            event.eventType === `procedure.zero-baseline.workflow.semantic-${outcome}`
          ) {
            failTerminalOnce = false;
            throw new Error(`semantic-${outcome} saved before response failure`);
          }
          return stored;
        },
      });
      const request = semanticRequestFor(reviewed.storedBaseline!, fixture.refinementProvider);

      await expect(
        coordinator.startSemantic({
          formatVersion: '1.0.0',
          workflowId: createRequest.workflowId,
          request,
        }),
      ).rejects.toMatchObject({
        code: 'procedure_zero_baseline_persistence_outcome_unknown',
      });
      expect(() => coordinator.get(createRequest.workflowId)).toThrow(
        'persistence outcome is unknown',
      );

      const restarted = createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        existingEvents: fixture.events.values,
      });
      expect(restarted.get(createRequest.workflowId)?.phase).toBe(
        outcome === 'ready' ? 'awaiting_refinement' : 'semantic_failed',
      );
      expect(fixture.embeddingProvider.embedProcedure).toHaveBeenCalledTimes(1);
    }
  });

  it('does not start native refinement after refinement-started was saved but append threw', async () => {
    const fixture = await setup();
    const { coordinator: live, reviewed } = await storeReviewedBaseline(fixture);
    const semanticRequest = semanticRequestFor(
      reviewed.storedBaseline!,
      fixture.refinementProvider,
    );
    const grounded = await live.startSemantic({
      formatVersion: '1.0.0',
      workflowId: createRequest.workflowId,
      request: semanticRequest,
    });
    const nativeRequest = nativeRefinementRequestFor(
      grounded.storedBaseline!,
      grounded.semanticContext!,
      fixture.refinementProvider,
    );
    let failStartedOnce = true;
    const coordinator = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
      appendEvent: (event) => {
        const stored = fixture.events.append(event);
        if (
          failStartedOnce &&
          event.eventType === 'procedure.zero-baseline.workflow.refinement-started'
        ) {
          failStartedOnce = false;
          throw new Error('refinement-started saved before response failure');
        }
        return stored;
      },
    });

    expect(() =>
      coordinator.startRefinement({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: nativeRequest,
      }),
    ).toThrow('persistence outcome is unknown');
    expect(fixture.refinement.create).not.toHaveBeenCalled();
    expect(() =>
      coordinator.startRefinement({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: nativeRequest,
      }),
    ).toThrow('persistence outcome is unknown');
    expect(fixture.refinement.create).not.toHaveBeenCalled();

    const restarted = createProcedureZeroBaselineRefinementCoordinator({
      ...fixture.options,
      existingEvents: fixture.events.values,
    });
    expect(restarted.get(createRequest.workflowId)?.phase).toBe('refinement');
    expect(fixture.refinement.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a different semantic request that reuses a completed lower request id', async () => {
    const fixture = await setup();
    const { coordinator, reviewed } = await storeReviewedBaseline(fixture);
    const requestA = semanticRequestFor(reviewed.storedBaseline!, fixture.refinementProvider);
    await fixture.options.semanticRetrieval.search(requestA);
    const requestB = procedureSemanticRetrievalRequestSchema.parse({
      ...requestA,
      query: 'a different query must not inherit the completed semantic context',
    });

    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request: requestB,
      }),
    ).rejects.toMatchObject({ code: 'planner_generation_conflict' });

    expect(coordinator.get(createRequest.workflowId)).toMatchObject({
      phase: 'semantic_failed',
      terminal: true,
      semanticRetrieval: null,
      semanticContext: null,
      semanticFailure: {
        requestId: requestB.requestId,
        error: { code: 'planner_generation_conflict', retryable: false },
      },
    });
    expect(fixture.events.values.slice(-2).map((event) => event.eventType)).toEqual([
      'procedure.zero-baseline.workflow.semantic-started',
      'procedure.zero-baseline.workflow.semantic-failed',
    ]);
    expect(fixture.semanticEvents.values.map((event) => event.eventType)).toEqual([
      'procedure.semantic.retrieval.requested',
      'procedure.semantic.retrieval.completed',
    ]);
    expect(fixture.embeddingProvider.embedProcedure).toHaveBeenCalledTimes(1);
  });

  it('rejects known lifecycle ID collisions before storage or semantic provider effects', async () => {
    const fixture = await setup();
    const store = vi.spyOn(fixture.options, 'storeWithEvidence');
    const coordinator = createProcedureZeroBaselineRefinementCoordinator(fixture.options);
    const ready = await coordinator.create(createRequest);

    expect(() =>
      coordinator.review({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        reviewId: ready.baseline!.generation.generationId,
        binding: ready.baselineReviewBinding!,
        decision: {
          kind: 'store',
          confirmations: {
            exactCandidateTreeReviewed: true,
            exactCatalogBindingReviewed: true,
            candidateOnlyAndNoHostExecutionAcknowledged: true,
          },
        },
        reviewedAt: '2026-08-20T02:00:07.000Z',
      }),
    ).toThrow('identities must all differ');
    expect(store).not.toHaveBeenCalled();

    const reviewed = coordinator.review({
      formatVersion: '1.0.0',
      workflowId: createRequest.workflowId,
      reviewId: 'effed734-0b5a-4ed5-8c45-17466ba8e551',
      binding: ready.baselineReviewBinding!,
      decision: {
        kind: 'store',
        confirmations: {
          exactCandidateTreeReviewed: true,
          exactCatalogBindingReviewed: true,
          candidateOnlyAndNoHostExecutionAcknowledged: true,
        },
      },
      reviewedAt: '2026-08-20T02:00:07.000Z',
    });
    const request = semanticRequestFor(
      reviewed.storedBaseline!,
      fixture.refinementProvider,
      reviewed.baselineReview!.reviewId,
    );
    await expect(
      coordinator.startSemantic({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        request,
      }),
    ).rejects.toThrow('identities must all differ');
    expect(fixture.semanticEvents.values).toHaveLength(0);
  });

  it('rejects stale review hashes and out-of-order durable evidence', async () => {
    const fixture = await setup();
    const coordinator = createProcedureZeroBaselineRefinementCoordinator(fixture.options);
    const ready = await coordinator.create(createRequest);
    expect(() =>
      coordinator.review({
        formatVersion: '1.0.0',
        workflowId: createRequest.workflowId,
        reviewId: 'fde10a03-37ec-473b-b11d-0dd3ac09db19',
        binding: { ...ready.baselineReviewBinding!, candidateTreeContentSha256: '0'.repeat(64) },
        decision: { kind: 'discard' },
        reviewedAt: '2026-08-20T02:00:07.000Z',
      }),
    ).toThrow('does not bind');

    const reordered = structuredClone(fixture.events.values);
    reordered[0]!.sequence = 2;
    reordered[1]!.sequence = 1;
    expect(() =>
      createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        existingEvents: reordered,
      }),
    ).toThrow('strictly sequence ordered');

    const timeReversed = structuredClone(fixture.events.values);
    timeReversed[1]!.createdAt = '2026-08-20T02:00:06.000Z';
    (timeReversed[1]!.payload as { occurredAt: string }).occurredAt = '2026-08-20T02:00:06.000Z';
    expect(() =>
      createProcedureZeroBaselineRefinementCoordinator({
        ...fixture.options,
        existingEvents: timeReversed,
      }),
    ).toThrow('time ordering');
  });
});
