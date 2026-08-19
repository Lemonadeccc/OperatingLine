import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  ExecutionEventInput,
  ProcedureRefinementRunExpectedState,
  ProcedureRefinementRunInput,
  StoredExecutionEvent,
} from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  canonicalizeProtocolJsonValue,
  procedureRefinementCreateRequestSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureTreeSchema,
  protocolJsonValueCanonicalization,
  type ProcedureRefinementCreateRequest,
  type ProcedureRefinementReviewRequest,
  type ProcedureSemanticRetrievalRequest,
  type ProcedureTree,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it, vi } from 'vitest';

import { snapshotPlannerProviderRuntimeTreatment } from '../../../services/orchestrator/src/planner-provider-attestation.js';
import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import { buildProcedureRefinementDialoguePromptPacket } from '../../../services/orchestrator/src/procedure-refinement-prompt.js';
import {
  createProcedureRefinementCoordinator,
  restoreProcedureRefinementProviderInvocations,
} from '../../../services/orchestrator/src/procedure-refinement-run.js';
import { createProcedureRefinementScope } from '../../../services/orchestrator/src/procedure-refinement-scope.js';
import { createProcedureSemanticRetrievalCoordinator } from '../../../services/orchestrator/src/procedure-semantic-retrieval.js';

const descriptor = {
  contractVersion: '1.0.0',
  id: 'test-procedure-refinement-run',
  version: '1.0.0',
  displayName: 'Test procedure refinement run',
  description: 'Deterministic in-memory refinement provider.',
  availability: { available: true },
  limits: { maxConcurrency: 2 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function fixtureTree(): ProcedureTree {
  const input = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  for (const node of input['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    node['validation'] = {
      status: 'verified',
      validatedHostVersions: ['4.5.0'],
      notes: ['Verified test fixture.'],
    };
  }
  return procedureTreeSchema.parse(input);
}

function storedTree(tree = fixtureTree()): StoredProcedureTree {
  return {
    sequence: 1,
    tree,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: sha256(tree),
    },
    storedAt: '2026-08-19T08:00:00.000Z',
  };
}

function runtimeTreatment(operation: string) {
  return {
    profile: {
      descriptor,
      vendor: 'Local test',
      implementation: { name: 'test-procedure-refinement-run', version: '1.0.0' },
      model: {
        requested: `${operation}-fixture`,
        resolvedRevision: 'fixture-1',
        resolution: 'resolved' as const,
      },
      api: {
        surface: 'memory',
        version: '1',
        sdkName: 'none',
        sdkVersion: '1.0.0',
        endpointClass: 'local' as const,
        serviceTier: null,
        region: null,
      },
    },
    generationSettings: {
      normalizedParameters: { operation },
      seed: 1,
      determinism: 'deterministic' as const,
    },
    costPolicy: {
      possibleProviderCost: false,
      basis: 'no_provider_cost' as const,
      publicStatement: 'The in-memory provider has no provider charge.',
    },
  };
}

function provider(
  dialogue: PlannerProvider['procedureRefinementDialogue'],
  refine: PlannerProvider['refineProcedure'] = vi.fn(async () => ({})),
): PlannerProvider {
  return {
    descriptor,
    generate: vi.fn(async () => ({})),
    embedProcedure: vi.fn(async ({ documents }) => ({
      vectors: documents.map(() => [1, 0]),
    })),
    describeRuntimeTreatment: vi.fn((operation) => runtimeTreatment(operation)),
    procedureRefinementDialogue: dialogue,
    refineProcedure: refine,
  };
}

class MemoryEvents {
  readonly values: StoredExecutionEvent[] = [];

  append = (input: ExecutionEventInput): StoredExecutionEvent => {
    if (this.values.some((event) => event.id === input.id)) throw new Error('duplicate event');
    const stored = {
      sequence: this.values.length + 1,
      id: input.id,
      eventType: input.eventType,
      payload: structuredClone(input.payload),
      createdAt: input.createdAt ?? '2026-08-19T08:03:00.000Z',
    };
    this.values.push(stored);
    return stored;
  };
}

class MemoryRuns {
  readonly values = new Map<string, ProcedureRefinementRunInput>();

  record = (run: ProcedureRefinementRunInput) => {
    const existing = this.values.get(run.runId);
    if (existing !== undefined)
      return same(existing, run) ? ('duplicate' as const) : ('conflict' as const);
    this.values.set(run.runId, structuredClone(run));
    return 'accepted' as const;
  };

  get = (runId: string): unknown | null => structuredClone(this.values.get(runId) ?? null);

  transition = (
    run: ProcedureRefinementRunInput,
    expected: ProcedureRefinementRunExpectedState,
  ): boolean => {
    const current = this.values.get(run.runId);
    if (
      current === undefined ||
      current.status !== expected.status ||
      current.assistantMessageRevision !== expected.assistantMessageRevision
    ) {
      return false;
    }
    this.values.set(run.runId, structuredClone(run));
    return true;
  };

  active = (): unknown[] =>
    [...this.values.values()]
      .filter((run) => ['queued', 'streaming', 'refining', 'awaiting_review'].includes(run.status))
      .map((run) => structuredClone(run));
}

function same(left: unknown, right: unknown): boolean {
  return sha256(left) === sha256(right);
}

async function semanticEvidence(selectedProvider: PlannerProvider, base: StoredProcedureTree) {
  const events = new MemoryEvents();
  const treatment = snapshotPlannerProviderRuntimeTreatment(
    selectedProvider,
    descriptor,
    'procedure_embedding',
  );
  if (treatment === undefined) throw new Error('missing embedding treatment');
  const request: ProcedureSemanticRetrievalRequest = procedureSemanticRetrievalRequestSchema.parse({
    formatVersion: '1.0.0',
    requestId: randomUUID(),
    query: 'make the left eye larger',
    providerDisclosure: { providerDescriptor: descriptor, runtimeTreatment: treatment },
    retrieval: { topK: 1, minScore: 0 },
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
      confirmedAt: '2026-08-19T08:00:30.000Z',
    },
  });
  const coordinator = createProcedureSemanticRetrievalCoordinator({
    registry: createPlannerProviderRegistry([selectedProvider]),
    existingEvents: [],
    listProcedureTrees: () => [
      {
        sequence: base.sequence,
        treeId: base.tree.id,
        revision: base.tree.revision,
        title: base.tree.title,
        adapterId: base.tree.adapterId,
        actionCatalogVersion: base.tree.actionCatalogVersion,
        interactionCatalogVersion: base.tree.interactionCatalogVersion,
        hostVersionRange: base.tree.hostVersionRange,
        integrity: base.integrity,
        storedAt: base.storedAt,
      },
    ],
    getProcedureTree: () => base,
    appendEvent: events.append,
    now: () => new Date('2026-08-19T08:01:00.000Z'),
  });
  await coordinator.search(request);
  const evidence = coordinator.completedEvidence(request.requestId);
  if (evidence === null) throw new Error('missing semantic evidence');
  return evidence;
}

async function setup(
  selectedProvider: PlannerProvider,
  existingEvents: readonly StoredExecutionEvent[] = [],
  overrides: {
    readonly appendEvent?: (event: ExecutionEventInput) => StoredExecutionEvent;
    readonly compileCandidate?: () => { readonly valid: boolean; readonly message?: string } | void;
    readonly schedule?: (work: () => Promise<void>) => void;
    readonly now?: () => Date;
    readonly transitionRun?: (
      persist: MemoryRuns['transition'],
      run: ProcedureRefinementRunInput,
      expected: ProcedureRefinementRunExpectedState,
    ) => boolean;
  } = {},
) {
  const base = storedTree();
  const semantic = await semanticEvidence(selectedProvider, base);
  const events = new MemoryEvents();
  events.values.push(...structuredClone(existingEvents));
  const runs = new MemoryRuns();
  let clock = Date.parse('2026-08-19T08:03:00.000Z');
  const registry = createPlannerProviderRegistry([selectedProvider]);
  const commit = (
    currentRun: ProcedureRefinementRunInput,
    reviewRequest: ProcedureRefinementReviewRequest,
    reviewedEvent: ExecutionEventInput & { createdAt: string },
    kind: 'store' | 'discard',
  ) => {
    const current = currentRun.statusPayload;
    if (current.preview === null) throw new Error('missing preview');
    const final = procedureRefinementRunStatusSchema.parse({
      ...current,
      status: kind === 'store' ? 'completed' : 'discarded',
      terminal: true,
      review: {
        reviewId: reviewRequest.reviewId,
        decision: kind,
        reviewedAt: reviewRequest.reviewedAt,
      },
      storedTree:
        kind === 'store'
          ? {
              sequence: 2,
              tree: current.preview.targetTree,
              integrity: {
                algorithm: 'sha256',
                canonicalization: protocolJsonValueCanonicalization,
                contentSha256: current.preview.binding.targetTreeContentSha256,
              },
              storedAt: reviewedEvent.createdAt,
            }
          : null,
      sideEffects: { ...current.sideEffects, procedureStored: kind === 'store' },
      updatedAt: reviewedEvent.createdAt,
    });
    runs.values.set(currentRun.runId, {
      ...currentRun,
      status: final.status,
      assistantMessage: final.assistantMessage,
      assistantMessageRevision: final.assistantMessageRevision,
      statusPayload: final,
      updatedAt: final.updatedAt,
    });
    events.append(reviewedEvent);
    return final;
  };
  const coordinator = createProcedureRefinementCoordinator({
    registry,
    existingEvents,
    getLatestProcedureTree: () => base,
    completedSemanticEvidence: () => semantic,
    compileCandidate: overrides.compileCandidate ?? vi.fn(() => ({ valid: true })),
    recordRun: runs.record,
    getRun: runs.get,
    transitionRun:
      overrides.transitionRun === undefined
        ? runs.transition
        : (run, expected) => overrides.transitionRun!(runs.transition, run, expected),
    listActiveRuns: runs.active,
    commitStoreReview: vi.fn(({ currentRun, reviewRequest, reviewedEvent }) =>
      commit(currentRun, reviewRequest, reviewedEvent, 'store'),
    ),
    commitDiscardReview: vi.fn(({ currentRun, reviewRequest, reviewedEvent }) =>
      commit(currentRun, reviewRequest, reviewedEvent, 'discard'),
    ),
    appendEvent: overrides.appendEvent ?? events.append,
    now: overrides.now ?? (() => new Date((clock += 1))),
    ...(overrides.schedule === undefined ? {} : { schedule: overrides.schedule }),
  });
  const disclosure = coordinator.listProviders().providers[0]!;
  const request: ProcedureRefinementCreateRequest = procedureRefinementCreateRequestSchema.parse({
    formatVersion: '1.0.0',
    runId: randomUUID(),
    dialogueRequestId: randomUUID(),
    refinementRequestId: randomUUID(),
    baseTree: base,
    targetRevision: 2,
    requestedScopeRootIds: ['snowman.head.eyes.left'],
    semanticContext: {
      status: 'completed',
      requestId: semantic.requestId,
      retrievalId: semantic.retrievalId,
      resultContentSha256: semantic.resultContentSha256,
      completedEventContentSha256: semantic.eventContentSha256,
      completedAt: semantic.occurredAt,
    },
    instruction: 'Make the left eye larger.',
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
      confirmedAt: '2026-08-19T08:02:00.000Z',
    },
  });
  return { base, coordinator, events, request, runs, semantic };
}

async function waitForStatus(
  coordinator: ReturnType<typeof createProcedureRefinementCoordinator>,
  runId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = coordinator.get(runId);
    if (current?.status === status) return current;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`run did not reach ${status}`);
}

describe('Procedure refinement coordinator', () => {
  it('persists requested evidence before dialogue, flushes cumulative text, and answers below 0.8', async () => {
    const eventReference: { current?: MemoryEvents } = {};
    const runReference: {
      coordinator?: ReturnType<typeof createProcedureRefinementCoordinator>;
      runId?: string;
    } = {};
    const message = `${'a'.repeat(300)} final answer`;
    const dialogue = vi.fn(async ({ emit }) => {
      expect(eventReference.current?.values.at(-1)?.eventType).toBe(
        'procedure.refinement.dialogue.requested',
      );
      emit({ type: 'assistant_text_delta', delta: message.slice(0, 300) });
      await Promise.resolve();
      await Promise.resolve();
      expect(runReference.coordinator?.get(runReference.runId!)?.assistantMessage).toBe(
        message.slice(0, 300),
      );
      emit({ type: 'assistant_text_delta', delta: message.slice(300) });
      return {
        assistantMessage: message,
        decision: { kind: 'answer' as const, confidence: 0.79, threshold: 0.8 as const },
      };
    });
    const selectedProvider = provider(dialogue);
    const setupValue = await setup(selectedProvider);
    eventReference.current = setupValue.events;
    runReference.coordinator = setupValue.coordinator;
    runReference.runId = setupValue.request.runId;

    expect(setupValue.coordinator.create(setupValue.request).status).toBe('queued');
    const result = await waitForStatus(
      setupValue.coordinator,
      setupValue.request.runId,
      'answered',
    );

    expect(result.assistantMessage).toBe(message);
    expect(result.assistantMessageRevision).toBeGreaterThanOrEqual(1);
    expect(result.semanticDecision).toEqual({ kind: 'answer', confidence: 0.79, threshold: 0.8 });
    expect(setupValue.events.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
      'procedure.refinement.dialogue.completed',
    ]);
  });

  it('runs the second at-most-once call and creates a nine-hash locally sanitized preview', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine the selected eye.' });
      return {
        assistantMessage: 'I will refine the selected eye.',
        decision: { kind: 'refine' as const, confidence: 0.8, threshold: 0.8 as const },
      };
    });
    let rawTarget: ProcedureTree;
    const refine = vi.fn(async ({ packet }) => {
      rawTarget = structuredClone(packet.context.baseTree.tree);
      rawTarget.revision = packet.context.targetRevision;
      const leaf = rawTarget.nodes.find((node) => node.id === 'snowman.head.eyes.left');
      if (leaf?.kind !== 'leaf') throw new Error('missing leaf');
      leaf.title = 'Create and enlarge the refined left eye';
      return rawTarget;
    });
    const selectedProvider = provider(dialogue, refine);
    const setupValue = await setup(selectedProvider);

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(
      setupValue.coordinator,
      setupValue.request.runId,
      'awaiting_review',
    );

    expect(setupValue.coordinator.create(setupValue.request)).toEqual(result);
    expect(() =>
      setupValue.coordinator.create({
        ...setupValue.request,
        instruction: 'A conflicting instruction for the same run id.',
      }),
    ).toThrow(/conflicts/);
    expect(dialogue).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledTimes(1);
    expect(result.preview?.providerResult.targetTree).toEqual(rawTarget!);
    const sanitized = result.preview!.targetTree.nodes.find(
      (node) => node.id === 'snowman.head.eyes.left',
    );
    expect(sanitized?.kind === 'leaf' && sanitized.validation.status).toBe('candidate');
    expect(result.preview!.binding.targetTreeContentSha256).toBe(
      sha256(result.preview!.targetTree),
    );
    expect(result.preview!.binding.targetTreeContentSha256).not.toBe(
      result.preview!.providerResult.targetTreeContentSha256,
    );
    expect(Object.keys(result.preview!.binding)).toHaveLength(9);
    expect(Date.parse(result.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(result.preview!.reviewReadyAt),
    );
    expect(result.sideEffects).toEqual({
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    expect(setupValue.events.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
      'procedure.refinement.dialogue.completed',
      'procedure.refinement.generation.requested',
      'procedure.refinement.generation.completed',
    ]);

    expect(() =>
      setupValue.coordinator.review({
        formatVersion: '1.0.0',
        runId: setupValue.request.runId,
        reviewId: randomUUID(),
        binding: { ...result.preview!.binding, targetTreeContentSha256: '0'.repeat(64) },
        decision: { kind: 'discard' },
        reviewedAt: result.preview!.reviewReadyAt,
      }),
    ).toThrow(/bind/);
    expect(() =>
      setupValue.coordinator.review({
        formatVersion: '1.0.0',
        runId: setupValue.request.runId,
        reviewId: randomUUID(),
        binding: result.preview!.binding,
        decision: { kind: 'discard' },
        reviewedAt: new Date(Date.parse(result.preview!.reviewReadyAt) - 1).toISOString(),
      }),
    ).toThrow(/time/);

    const stored = setupValue.coordinator.review({
      formatVersion: '1.0.0',
      runId: setupValue.request.runId,
      reviewId: randomUUID(),
      binding: result.preview!.binding,
      decision: {
        kind: 'store',
        confirmations: {
          exactBaseTreeReviewed: true,
          exactTargetTreeReviewed: true,
          exactScopeReviewed: true,
          exactSemanticContextReviewed: true,
          exactProviderOutputReviewed: true,
          exactLocalityReportReviewed: true,
          noHostExecutionAcknowledged: true,
        },
      },
      reviewedAt: result.preview!.reviewReadyAt,
    });
    expect(stored.status).toBe('completed');
    expect(stored.storedTree?.tree).toEqual(result.preview!.targetTree);
    expect(stored.storedTree?.integrity.contentSha256).toBe(
      result.preview!.binding.targetTreeContentSha256,
    );
  });

  it('requires an exact persisted review request for terminal retries', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine.' });
      return {
        assistantMessage: 'I will refine.',
        decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
      };
    });
    const refine = vi.fn(async ({ packet }) => {
      const target = structuredClone(packet.context.baseTree.tree);
      target.revision = packet.context.targetRevision;
      const leaf = target.nodes.find((node) => node.id === 'snowman.head.eyes.left');
      if (leaf?.kind !== 'leaf') throw new Error('missing leaf');
      leaf.intent = 'Exact review retry candidate.';
      return target;
    });
    const selectedProvider = provider(dialogue, refine);
    const setupValue = await setup(selectedProvider);
    setupValue.coordinator.create(setupValue.request);
    const awaiting = await waitForStatus(
      setupValue.coordinator,
      setupValue.request.runId,
      'awaiting_review',
    );
    const review = procedureRefinementReviewRequestSchema.parse({
      formatVersion: '1.0.0',
      runId: setupValue.request.runId,
      reviewId: randomUUID(),
      binding: awaiting.preview!.binding,
      decision: { kind: 'discard', reason: 'Not the intended shape.' },
      reviewedAt: awaiting.preview!.reviewReadyAt,
    });

    expect(setupValue.coordinator.review(review).status).toBe('discarded');
    const restarted = createProcedureRefinementCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: setupValue.events.values,
      getLatestProcedureTree: () => setupValue.base,
      completedSemanticEvidence: () => setupValue.semantic,
      compileCandidate: () => ({ valid: true }),
      recordRun: setupValue.runs.record,
      getRun: setupValue.runs.get,
      transitionRun: setupValue.runs.transition,
      listActiveRuns: setupValue.runs.active,
      commitStoreReview: () => {
        throw new Error('review must not be recommitted');
      },
      commitDiscardReview: () => {
        throw new Error('review must not be recommitted');
      },
      appendEvent: setupValue.events.append,
      now: () => new Date('2026-08-19T08:06:00.000Z'),
    });
    expect(restarted.review(review).status).toBe('discarded');
    expect(() =>
      restarted.review({
        ...review,
        decision: { kind: 'discard', reason: 'A different reason.' },
      }),
    ).toThrow(/different evidence/);
  });

  it('never calls the provider when requested evidence cannot be persisted', async () => {
    const dialogue = vi.fn(async () => ({
      assistantMessage: 'This must never be returned.',
      decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
    }));
    const setupValue = await setup(provider(dialogue), [], {
      appendEvent: () => {
        throw new Error('durable event store unavailable');
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(setupValue.coordinator, setupValue.request.runId, 'failed');

    expect(dialogue).not.toHaveBeenCalled();
    expect(result.error?.code).toBe('persistence_failed');
  });

  it('does not append dialogue failed evidence when the requested append was not verified', async () => {
    const dialogue = vi.fn(async () => ({
      assistantMessage: 'unreachable',
      decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
    }));
    const persisted = new MemoryEvents();
    let rejectRequested = true;
    const setupValue = await setup(provider(dialogue), [], {
      appendEvent: (event) => {
        if (event.eventType === 'procedure.refinement.dialogue.requested' && rejectRequested) {
          rejectRequested = false;
          throw new Error('one-shot requested append failure');
        }
        return persisted.append(event);
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(setupValue.coordinator, setupValue.request.runId, 'failed');

    expect(result.error?.code).toBe('persistence_failed');
    expect(dialogue).not.toHaveBeenCalled();
    expect(persisted.values).toEqual([]);
  });

  it('does not append generation failed evidence when the requested append was not verified', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine.' });
      return {
        assistantMessage: 'I will refine.',
        decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
      };
    });
    const refine = vi.fn(async () => {
      throw new Error('generation must not start');
    });
    const persisted = new MemoryEvents();
    let rejectRequested = true;
    const setupValue = await setup(provider(dialogue, refine), [], {
      appendEvent: (event) => {
        if (event.eventType === 'procedure.refinement.generation.requested' && rejectRequested) {
          rejectRequested = false;
          throw new Error('one-shot requested append failure');
        }
        return persisted.append(event);
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(setupValue.coordinator, setupValue.request.runId, 'failed');

    expect(result.error?.code).toBe('persistence_failed');
    expect(refine).not.toHaveBeenCalled();
    expect(persisted.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
      'procedure.refinement.dialogue.completed',
    ]);
  });

  it('reports an interrupted persistence gap when dialogue failed evidence cannot be stored', async () => {
    const dialogue = vi.fn(async () => {
      throw new Error('provider dialogue failure');
    });
    const persisted = new MemoryEvents();
    const setupValue = await setup(provider(dialogue), [], {
      appendEvent: (event) => {
        if (event.eventType === 'procedure.refinement.dialogue.failed') {
          throw new Error('failed evidence append unavailable');
        }
        return persisted.append(event);
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(
      setupValue.coordinator,
      setupValue.request.runId,
      'interrupted',
    );

    expect(dialogue).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'persistence_failed', retryable: true });
    expect(persisted.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
    ]);
  });

  it('reports an interrupted persistence gap when generation failed evidence cannot be stored', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine.' });
      return {
        assistantMessage: 'I will refine.',
        decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
      };
    });
    const refine = vi.fn(async () => {
      throw new Error('provider generation failure');
    });
    const persisted = new MemoryEvents();
    const setupValue = await setup(provider(dialogue, refine), [], {
      appendEvent: (event) => {
        if (event.eventType === 'procedure.refinement.generation.failed') {
          throw new Error('failed evidence append unavailable');
        }
        return persisted.append(event);
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(
      setupValue.coordinator,
      setupValue.request.runId,
      'interrupted',
    );

    expect(refine).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'persistence_failed', retryable: true });
    expect(persisted.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
      'procedure.refinement.dialogue.completed',
      'procedure.refinement.generation.requested',
    ]);
  });

  it('durably fails and settles close when the scheduler throws synchronously', async () => {
    const dialogue = vi.fn(async () => ({
      assistantMessage: 'unreachable',
      decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
    }));
    const times = [
      '2026-08-19T08:04:00.000Z',
      '2026-08-19T08:05:00.000Z',
      '2026-08-19T08:03:00.000Z',
    ];
    const setupValue = await setup(provider(dialogue), [], {
      schedule: () => {
        throw new Error('scheduler unavailable');
      },
      now: () => new Date(times.shift() ?? '2026-08-19T08:03:00.000Z'),
    });

    const queued = setupValue.coordinator.create(setupValue.request);
    await setupValue.coordinator.close();
    const result = setupValue.coordinator.get(setupValue.request.runId)!;

    expect(queued.status).toBe('queued');
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ code: 'internal_failed', retryable: false });
    expect(Date.parse(result.updatedAt)).toBeGreaterThanOrEqual(Date.parse(queued.updatedAt));
    expect(dialogue).not.toHaveBeenCalled();
  });

  it('retries a one-shot dialogue failure transition through the scheduler fallback', async () => {
    const dialogue = vi.fn(async () => {
      throw new Error('dialogue failed');
    });
    let rejectFirstFailure = true;
    const setupValue = await setup(provider(dialogue), [], {
      transitionRun: (persist, run, expected) => {
        if (run.status === 'failed' && rejectFirstFailure) {
          rejectFirstFailure = false;
          return false;
        }
        return persist(run, expected);
      },
    });

    setupValue.coordinator.create(setupValue.request);
    await setupValue.coordinator.close();

    expect(setupValue.coordinator.get(setupValue.request.runId)).toMatchObject({
      status: 'failed',
      terminal: true,
    });
    expect(setupValue.runs.active()).toEqual([]);
  });

  it('fails closed on empty, oversized, or cumulatively oversized streamed deltas', async () => {
    for (const deltas of [[''], ['x'.repeat(4_097)], ['x'.repeat(4_000), 'y']] as const) {
      const dialogue = vi.fn(async ({ emit }) => {
        for (const delta of deltas) emit({ type: 'assistant_text_delta', delta });
        return {
          assistantMessage: 'unreachable',
          decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
        };
      });
      const setupValue = await setup(provider(dialogue));
      setupValue.coordinator.create(setupValue.request);
      const result = await waitForStatus(
        setupValue.coordinator,
        setupValue.request.runId,
        'failed',
      );

      expect(result.error?.code).toBe('provider_output_invalid');
      expect(setupValue.events.values.map((event) => event.eventType)).toEqual([
        'procedure.refinement.dialogue.requested',
        'procedure.refinement.dialogue.failed',
      ]);
    }
  });

  it('records failed evidence instead of fabricating completed-invalid evidence when raw output cannot be sanitized', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine safely.' });
      return {
        assistantMessage: 'I will refine safely.',
        decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
      };
    });
    const refine = vi.fn(async () => {
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;
      return cyclic;
    });
    const setupValue = await setup(provider(dialogue, refine));
    setupValue.coordinator.create(setupValue.request);

    const result = await waitForStatus(setupValue.coordinator, setupValue.request.runId, 'failed');
    expect(result.error?.code).toBe('provider_output_invalid');
    expect(setupValue.events.values.map((event) => event.eventType)).toEqual([
      'procedure.refinement.dialogue.requested',
      'procedure.refinement.dialogue.completed',
      'procedure.refinement.generation.requested',
      'procedure.refinement.generation.failed',
    ]);
  });

  it('recovers completed generation evidence through local gates without provider replay', async () => {
    const firstDialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine this leaf.' });
      return {
        assistantMessage: 'I will refine this leaf.',
        decision: { kind: 'refine' as const, confidence: 0.95, threshold: 0.8 as const },
      };
    });
    const firstRefine = vi.fn(async ({ packet }) => {
      const target = structuredClone(packet.context.baseTree.tree);
      target.revision = packet.context.targetRevision;
      const leaf = target.nodes.find((node) => node.id === 'snowman.head.eyes.left');
      if (leaf?.kind !== 'leaf') throw new Error('missing leaf');
      leaf.intent = 'Create a locally recovered larger eye.';
      return target;
    });
    const initial = await setup(provider(firstDialogue, firstRefine));
    initial.coordinator.create(initial.request);
    const awaiting = await waitForStatus(
      initial.coordinator,
      initial.request.runId,
      'awaiting_review',
    );
    const persisted = initial.runs.values.get(initial.request.runId)!;
    const refining = procedureRefinementRunStatusSchema.parse({
      ...awaiting,
      status: 'refining',
      terminal: false,
      preview: null,
    });
    const restartedRuns = new MemoryRuns();
    restartedRuns.record({ ...persisted, status: 'refining', statusPayload: refining });
    const replayDialogue = vi.fn(async () => {
      throw new Error('dialogue replay forbidden');
    });
    const replayRefine = vi.fn(async () => {
      throw new Error('generation replay forbidden');
    });

    const restarted = createProcedureRefinementCoordinator({
      registry: createPlannerProviderRegistry([provider(replayDialogue, replayRefine)]),
      existingEvents: initial.events.values,
      getLatestProcedureTree: () => initial.base,
      completedSemanticEvidence: () => initial.semantic,
      compileCandidate: () => ({ valid: true }),
      recordRun: restartedRuns.record,
      getRun: restartedRuns.get,
      transitionRun: restartedRuns.transition,
      listActiveRuns: restartedRuns.active,
      commitStoreReview: () => {
        throw new Error('review not expected');
      },
      commitDiscardReview: () => {
        throw new Error('review not expected');
      },
      appendEvent: new MemoryEvents().append,
      now: () => new Date('2026-08-19T08:05:00.000Z'),
    });

    expect(restarted.get(initial.request.runId)?.status).toBe('awaiting_review');
    const recovered = restarted.get(initial.request.runId)!;
    expect(recovered.preview!.providerResult.targetTree).not.toEqual(recovered.preview!.targetTree);
    const completedAt = initial.events.values.find(
      (event) => event.eventType === 'procedure.refinement.generation.completed',
    )!.payload as { occurredAt: string };
    expect(Date.parse(recovered.preview!.reviewReadyAt)).toBeGreaterThanOrEqual(
      Date.parse(completedAt.occurredAt),
    );
    expect(replayDialogue).not.toHaveBeenCalled();
    expect(replayRefine).not.toHaveBeenCalled();
  });

  it('recovers dialogue and generation failed evidence without provider replay', async () => {
    for (const failurePhase of ['dialogue', 'generation'] as const) {
      const initialDialogue = vi.fn(async ({ emit }) => {
        if (failurePhase === 'dialogue') throw new Error('dialogue crashed');
        emit({ type: 'assistant_text_delta', delta: 'I will refine.' });
        return {
          assistantMessage: 'I will refine.',
          decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
        };
      });
      const initialRefine = vi.fn(async () => {
        throw new Error('generation crashed');
      });
      const initial = await setup(provider(initialDialogue, initialRefine));
      initial.coordinator.create(initial.request);
      const failed = await waitForStatus(initial.coordinator, initial.request.runId, 'failed');
      const persisted = initial.runs.values.get(initial.request.runId)!;
      const active = procedureRefinementRunStatusSchema.parse({
        ...failed,
        status: failurePhase === 'dialogue' ? 'streaming' : 'refining',
        terminal: false,
        error: null,
      });
      const restartedRuns = new MemoryRuns();
      restartedRuns.record({
        ...persisted,
        status: active.status,
        statusPayload: active,
        updatedAt: active.updatedAt,
      });
      const replayDialogue = vi.fn(async () => {
        throw new Error('dialogue replay forbidden');
      });
      const replayRefine = vi.fn(async () => {
        throw new Error('generation replay forbidden');
      });

      createProcedureRefinementCoordinator({
        registry: createPlannerProviderRegistry([provider(replayDialogue, replayRefine)]),
        existingEvents: initial.events.values,
        getLatestProcedureTree: () => initial.base,
        completedSemanticEvidence: () => initial.semantic,
        compileCandidate: () => ({ valid: true }),
        recordRun: restartedRuns.record,
        getRun: restartedRuns.get,
        transitionRun: restartedRuns.transition,
        listActiveRuns: restartedRuns.active,
        commitStoreReview: () => {
          throw new Error('review not expected');
        },
        commitDiscardReview: () => {
          throw new Error('review not expected');
        },
        appendEvent: new MemoryEvents().append,
        now: () => new Date('2026-08-19T08:05:00.000Z'),
      });

      expect(restartedRuns.values.get(initial.request.runId)?.statusPayload).toMatchObject({
        status: 'failed',
        terminal: true,
        error: { code: failed.error!.code },
      });
      expect(replayDialogue).not.toHaveBeenCalled();
      expect(replayRefine).not.toHaveBeenCalled();
    }
  });

  it('rejects self-consistent tampering in an awaiting-review durable reconstruction', async () => {
    const message = 'I will refine this leaf exactly.';
    const selectedProvider = provider(
      vi.fn(async ({ emit }) => {
        emit({ type: 'assistant_text_delta', delta: message });
        return {
          assistantMessage: message,
          decision: { kind: 'refine' as const, confidence: 0.95, threshold: 0.8 as const },
        };
      }),
      vi.fn(async ({ packet }) => {
        const target = structuredClone(packet.context.baseTree.tree);
        target.revision = packet.context.targetRevision;
        const leaf = target.nodes.find((node) => node.id === 'snowman.head.eyes.left');
        if (leaf?.kind !== 'leaf') throw new Error('missing leaf');
        leaf.intent = 'Tamper-resistant recovered intent.';
        return target;
      }),
    );
    const initial = await setup(selectedProvider);
    initial.coordinator.create(initial.request);
    await waitForStatus(initial.coordinator, initial.request.runId, 'awaiting_review');
    const persisted = initial.runs.values.get(initial.request.runId)!;
    const completed = initial.events.values.find(
      (event) => event.eventType === 'procedure.refinement.generation.completed',
    )!;

    const restart = (status: typeof persisted.statusPayload) => {
      const runs = new MemoryRuns();
      runs.record({
        ...persisted,
        status: status.status,
        assistantMessage: status.assistantMessage,
        assistantMessageRevision: status.assistantMessageRevision,
        statusPayload: status,
        updatedAt: status.updatedAt,
      });
      return () =>
        createProcedureRefinementCoordinator({
          registry: createPlannerProviderRegistry([selectedProvider]),
          existingEvents: initial.events.values,
          getLatestProcedureTree: () => initial.base,
          completedSemanticEvidence: () => initial.semantic,
          compileCandidate: () => ({ valid: true }),
          recordRun: runs.record,
          getRun: runs.get,
          transitionRun: runs.transition,
          listActiveRuns: runs.active,
          commitStoreReview: () => {
            throw new Error('review not expected');
          },
          commitDiscardReview: () => {
            throw new Error('review not expected');
          },
          appendEvent: new MemoryEvents().append,
          now: () => new Date('2026-08-19T08:05:00.000Z'),
        });
    };

    const tamperedMessage = 'Tampered assistant message.';
    const messageStatus = procedureRefinementRunStatusSchema.parse({
      ...persisted.statusPayload,
      assistantMessage: tamperedMessage,
      assistantMessageRevision: persisted.statusPayload.assistantMessageRevision + 1,
      preview: {
        ...persisted.statusPayload.preview!,
        binding: {
          ...persisted.statusPayload.preview!.binding,
          assistantMessageContentSha256: sha256(tamperedMessage),
        },
      },
    });
    expect(restart(messageStatus)).toThrow(/preview conflicts/);

    const decisionStatus = procedureRefinementRunStatusSchema.parse({
      ...persisted.statusPayload,
      semanticDecision: { kind: 'refine', confidence: 0.81, threshold: 0.8 },
    });
    expect(restart(decisionStatus)).toThrow(/preview conflicts/);

    const earlyReviewStatus = procedureRefinementRunStatusSchema.parse({
      ...persisted.statusPayload,
      preview: {
        ...persisted.statusPayload.preview!,
        reviewReadyAt: new Date(
          Date.parse((completed.payload as { occurredAt: string }).occurredAt) - 1,
        ).toISOString(),
      },
    });
    expect(restart(earlyReviewStatus)).toThrow(/preview conflicts/);
  });

  it('durably fails with an internal error when deterministic compilation throws', async () => {
    const dialogue = vi.fn(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: 'I will refine.' });
      return {
        assistantMessage: 'I will refine.',
        decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
      };
    });
    const refine = vi.fn(async ({ packet }) => {
      const target = structuredClone(packet.context.baseTree.tree);
      target.revision = packet.context.targetRevision;
      const leaf = target.nodes.find((node) => node.id === 'snowman.head.eyes.left');
      if (leaf?.kind !== 'leaf') throw new Error('missing leaf');
      leaf.intent = 'Compile this candidate.';
      return target;
    });
    const setupValue = await setup(provider(dialogue, refine), [], {
      compileCandidate: () => {
        throw new Error('compiler crashed');
      },
    });

    setupValue.coordinator.create(setupValue.request);
    const result = await waitForStatus(setupValue.coordinator, setupValue.request.runId, 'failed');

    expect(result.error).toMatchObject({ code: 'internal_failed', retryable: false });
    expect(result.needsRevision).toBeNull();
  });

  it('marks requested-only durable work interrupted on restart without calling a provider', async () => {
    const selectedProvider = provider(
      vi.fn(async () => {
        throw new Error('must not run');
      }),
    );
    const initial = await setup(selectedProvider);
    const status = initial.coordinator.create(initial.request);
    initial.coordinator.beginClose();
    const packet = buildProcedureRefinementDialoguePromptPacket({
      request: initial.request,
      scope: createProcedureRefinementScope(
        initial.request.baseTree.tree,
        initial.request.requestedScopeRootIds,
      ),
      semanticRetrieval: initial.semantic.result,
    });
    const requested = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId: initial.request.runId,
      requestId: initial.request.dialogueRequestId,
      requestFingerprint: plannerProviderRequestFingerprint(packet),
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      packetContentSha256: packet.integrity.contentSha256,
      treatmentContentSha256:
        initial.request.providerDisclosure.dialogueRuntimeTreatment.treatmentContentSha256,
      occurredAt: '2026-08-19T08:03:00.000Z',
    } as const;
    const storedRequested: StoredExecutionEvent = {
      sequence: 1,
      id: `procedure-refinement-dialogue-requested:${initial.request.dialogueRequestId}`,
      eventType: 'procedure.refinement.dialogue.requested',
      payload: requested,
      createdAt: requested.occurredAt,
    };
    const runs = new MemoryRuns();
    runs.record({
      ...initial.runs.values.get(initial.request.runId)!,
      status: status.status,
      statusPayload: status,
    });
    const dialogue = vi.fn(async () => {
      throw new Error('provider replay is forbidden');
    });
    createProcedureRefinementCoordinator({
      registry: createPlannerProviderRegistry([provider(dialogue)]),
      existingEvents: [storedRequested],
      getLatestProcedureTree: () => initial.base,
      completedSemanticEvidence: () => initial.semantic,
      compileCandidate: () => ({ valid: true }),
      recordRun: runs.record,
      getRun: runs.get,
      transitionRun: runs.transition,
      listActiveRuns: runs.active,
      commitStoreReview: () => {
        throw new Error('review not expected');
      },
      commitDiscardReview: () => {
        throw new Error('review not expected');
      },
      appendEvent: new MemoryEvents().append,
      now: () => new Date('2026-08-19T08:04:00.000Z'),
    });

    expect(runs.values.get(initial.request.runId)?.status).toBe('interrupted');
    expect(dialogue).not.toHaveBeenCalled();
  });

  it('rejects terminal provider evidence that precedes its requested evidence', () => {
    const requestId = randomUUID();
    const scope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId: randomUUID(),
      requestId,
      requestFingerprint: '1'.repeat(64),
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      packetContentSha256: '2'.repeat(64),
      treatmentContentSha256: '3'.repeat(64),
    } as const;
    const result = {
      assistantMessage: 'Answer.',
      decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
    };
    const events: StoredExecutionEvent[] = [
      {
        sequence: 1,
        id: `procedure-refinement-dialogue-completed:${requestId}`,
        eventType: 'procedure.refinement.dialogue.completed',
        payload: {
          ...scope,
          result,
          resultContentSha256: sha256(result),
          durationMs: 1,
          occurredAt: '2026-08-19T08:03:01.000Z',
        },
        createdAt: '2026-08-19T08:03:01.000Z',
      },
      {
        sequence: 2,
        id: `procedure-refinement-dialogue-requested:${requestId}`,
        eventType: 'procedure.refinement.dialogue.requested',
        payload: { ...scope, occurredAt: '2026-08-19T08:03:00.000Z' },
        createdAt: '2026-08-19T08:03:00.000Z',
      },
    ];

    expect(() => restoreProcedureRefinementProviderInvocations(events)).toThrow(/order is invalid/);
  });

  it('rejects terminal provider evidence with a different runtime treatment hash', () => {
    const requestId = randomUUID();
    const scope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId: randomUUID(),
      requestId,
      requestFingerprint: '1'.repeat(64),
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      packetContentSha256: '2'.repeat(64),
      treatmentContentSha256: '3'.repeat(64),
    } as const;
    const result = {
      assistantMessage: 'Answer.',
      decision: { kind: 'answer' as const, confidence: null, threshold: 0.8 as const },
    };
    const events: StoredExecutionEvent[] = [
      {
        sequence: 1,
        id: `procedure-refinement-dialogue-requested:${requestId}`,
        eventType: 'procedure.refinement.dialogue.requested',
        payload: { ...scope, occurredAt: '2026-08-19T08:03:00.000Z' },
        createdAt: '2026-08-19T08:03:00.000Z',
      },
      {
        sequence: 2,
        id: `procedure-refinement-dialogue-completed:${requestId}`,
        eventType: 'procedure.refinement.dialogue.completed',
        payload: {
          ...scope,
          treatmentContentSha256: '4'.repeat(64),
          result,
          resultContentSha256: sha256(result),
          durationMs: 1,
          occurredAt: '2026-08-19T08:03:01.000Z',
        },
        createdAt: '2026-08-19T08:03:01.000Z',
      },
    ];

    expect(() => restoreProcedureRefinementProviderInvocations(events)).toThrow(/conflicts/);
  });

  it('rejects regressing evidence occurrence times even when sequences increase', () => {
    const requestId = randomUUID();
    const runId = randomUUID();
    const scope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId,
      requestId,
      requestFingerprint: '1'.repeat(64),
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      packetContentSha256: '2'.repeat(64),
      treatmentContentSha256: '3'.repeat(64),
    } as const;
    const result = {
      assistantMessage: 'Refine.',
      decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
    };
    const events: StoredExecutionEvent[] = [
      {
        sequence: 1,
        id: `procedure-refinement-dialogue-requested:${requestId}`,
        eventType: 'procedure.refinement.dialogue.requested',
        payload: { ...scope, occurredAt: '2026-08-19T08:03:01.000Z' },
        createdAt: '2026-08-19T08:03:01.000Z',
      },
      {
        sequence: 2,
        id: `procedure-refinement-dialogue-completed:${requestId}`,
        eventType: 'procedure.refinement.dialogue.completed',
        payload: {
          ...scope,
          result,
          resultContentSha256: sha256(result),
          durationMs: 1,
          occurredAt: '2026-08-19T08:03:00.000Z',
        },
        createdAt: '2026-08-19T08:03:02.000Z',
      },
    ];

    expect(() => restoreProcedureRefinementProviderInvocations(events)).toThrow(/time is invalid/);
  });

  it('rejects more than one generation request and generation before its refine dialogue', () => {
    const runId = randomUUID();
    const dialogueRequestId = randomUUID();
    const dialogueScope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId,
      requestId: dialogueRequestId,
      requestFingerprint: '1'.repeat(64),
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      packetContentSha256: '2'.repeat(64),
      treatmentContentSha256: '3'.repeat(64),
    } as const;
    const result = {
      assistantMessage: 'Refine.',
      decision: { kind: 'refine' as const, confidence: 0.9, threshold: 0.8 as const },
    };
    const dialogueEvents: StoredExecutionEvent[] = [
      {
        sequence: 1,
        id: `procedure-refinement-dialogue-requested:${dialogueRequestId}`,
        eventType: 'procedure.refinement.dialogue.requested',
        payload: { ...dialogueScope, occurredAt: '2026-08-19T08:03:00.000Z' },
        createdAt: '2026-08-19T08:03:00.000Z',
      },
      {
        sequence: 2,
        id: `procedure-refinement-dialogue-completed:${dialogueRequestId}`,
        eventType: 'procedure.refinement.dialogue.completed',
        payload: {
          ...dialogueScope,
          result,
          resultContentSha256: sha256(result),
          durationMs: 1,
          occurredAt: '2026-08-19T08:03:02.000Z',
        },
        createdAt: '2026-08-19T08:03:02.000Z',
      },
    ];
    const generationEvent = (
      requestId: string,
      sequence: number,
      occurredAt: string,
    ): StoredExecutionEvent => ({
      sequence,
      id: `procedure-refinement-generation-requested:${requestId}`,
      eventType: 'procedure.refinement.generation.requested',
      payload: {
        formatVersion: '1.0.0',
        operation: 'procedure_refinement',
        runId,
        requestId,
        requestFingerprint: '4'.repeat(64),
        providerId: descriptor.id,
        providerVersion: descriptor.version,
        packetContentSha256: '5'.repeat(64),
        treatmentContentSha256: '6'.repeat(64),
        occurredAt,
      },
      createdAt: occurredAt,
    });

    expect(() =>
      restoreProcedureRefinementProviderInvocations([
        ...dialogueEvents,
        generationEvent(randomUUID(), 3, '2026-08-19T08:03:03.000Z'),
        generationEvent(randomUUID(), 4, '2026-08-19T08:03:04.000Z'),
      ]),
    ).toThrow(/Duplicate Procedure refinement generation run/);

    expect(() =>
      restoreProcedureRefinementProviderInvocations([
        ...dialogueEvents,
        generationEvent(randomUUID(), 3, '2026-08-19T08:03:01.000Z'),
      ]),
    ).toThrow(/lacks a preceding completed refine decision/);
  });
});
