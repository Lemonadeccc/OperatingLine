import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
  procedureSemanticRetrievalRequestSchema,
  procedureTreeSchema,
  type ProcedureSemanticRetrievalRequest,
  type ProcedureTree,
  type ProcedureTreeSummary,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it, vi } from 'vitest';

import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import { snapshotPlannerProviderRuntimeTreatment } from '../../../services/orchestrator/src/planner-provider-attestation.js';
import {
  createProcedureSemanticRetrievalCoordinator,
  restoreProcedureSemanticRetrievalInvocations,
} from '../../../services/orchestrator/src/procedure-semantic-retrieval.js';

const descriptor = {
  contractVersion: '1.0.0',
  id: 'test-embedder',
  version: '1.0.0',
  displayName: 'Test embedder',
  description: 'Embeds bounded Procedure leaf documents for deterministic tests.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

const baseRequest: ProcedureSemanticRetrievalRequest =
  procedureSemanticRetrievalRequestSchema.parse({
    formatVersion: '1.0.0',
    requestId: 'd5b32a62-8f0c-4d42-aeac-ef7f0c73a38d',
    query: 'create a precisely positioned eye sphere',
    providerDisclosure: {
      providerDescriptor: descriptor,
      runtimeTreatment: snapshotPlannerProviderRuntimeTreatment(
        provider([]),
        descriptor,
        'procedure_embedding',
      ),
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
      confirmedAt: '2026-08-19T00:00:00.000Z',
    },
  });

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function tree(
  revision = 1,
  status: 'candidate' | 'verified' | 'rejected' = 'verified',
): ProcedureTree {
  const value = structuredClone(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  ) as Record<string, unknown>;
  value['revision'] = revision;
  for (const node of value['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    node['validation'] = {
      status,
      validatedHostVersions: status === 'verified' ? ['4.5.0'] : [],
      notes: [`${status} test leaf`],
    };
  }
  return procedureTreeSchema.parse(value);
}

function record(value: ProcedureTree, sequence = value.revision): StoredProcedureTree {
  return {
    sequence,
    tree: value,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: sha256(value),
    },
    storedAt: `2026-08-1${Math.min(9, value.revision)}T00:00:00.000Z`,
  };
}

function summary(value: StoredProcedureTree): ProcedureTreeSummary {
  return {
    sequence: value.sequence,
    treeId: value.tree.id,
    revision: value.tree.revision,
    title: value.tree.title,
    adapterId: value.tree.adapterId,
    actionCatalogVersion: value.tree.actionCatalogVersion,
    interactionCatalogVersion: value.tree.interactionCatalogVersion,
    hostVersionRange: value.tree.hostVersionRange,
    integrity: value.integrity,
    storedAt: value.storedAt,
  };
}

function provider(vectors: readonly (readonly number[])[]): PlannerProvider {
  return {
    descriptor,
    generate: vi.fn(async () => ({})),
    embedProcedure: vi.fn(async () => ({ vectors })),
    describeRuntimeTreatment: vi.fn(() => ({
      profile: {
        descriptor,
        vendor: 'Local test',
        implementation: { name: 'test-embedder', version: '1.0.0' },
        model: {
          requested: 'deterministic-test-vector',
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
        normalizedParameters: { dimensions: 2 },
        seed: null,
        determinism: 'deterministic',
      },
      costPolicy: {
        possibleProviderCost: false,
        basis: 'no_provider_cost',
        publicStatement: 'The in-memory test embedder has no provider charge.',
      },
    })),
  };
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt:
      event.createdAt ??
      ((event.payload as { occurredAt?: unknown }).occurredAt as string | undefined) ??
      '2026-08-19T00:00:00.000Z',
  }));
}

function setup(input: {
  readonly provider: PlannerProvider;
  readonly records?: readonly StoredProcedureTree[];
  readonly existingEvents?: readonly StoredExecutionEvent[];
  readonly summaries?: readonly ProcedureTreeSummary[];
}) {
  const records = input.records ?? [record(tree())];
  const byIdentity = new Map(
    records.map((entry) => [`${entry.tree.id}@${entry.tree.revision}`, entry]),
  );
  const events: ExecutionEventInput[] = [];
  const coordinator = createProcedureSemanticRetrievalCoordinator({
    registry: createPlannerProviderRegistry([input.provider]),
    existingEvents: input.existingEvents ?? [],
    listProcedureTrees: () => input.summaries ?? records.map(summary),
    getProcedureTree: (treeId, revision) => byIdentity.get(`${treeId}@${revision}`) ?? null,
    appendEvent: (event) => {
      events.push(event);
      return {
        sequence: (input.existingEvents?.at(-1)?.sequence ?? 0) + events.length,
        id: event.id,
        eventType: event.eventType,
        payload: structuredClone(event.payload),
        createdAt: event.createdAt ?? '2026-08-19T01:00:00.000Z',
      };
    },
    now: () => new Date('2026-08-19T01:00:00.000Z'),
  });
  return { coordinator, events };
}

describe('Procedure semantic retrieval coordinator', () => {
  it('embeds one stable latest-revision corpus batch and returns vector-free ranked hits', async () => {
    const old = record(tree(1), 1);
    const latest = record(tree(2), 2);
    const selectedProvider = provider([
      [1, 0],
      [0.8, 0.2],
    ]);
    const { coordinator, events } = setup({ provider: selectedProvider, records: [latest, old] });

    const result = await coordinator.search(baseRequest);
    const repeated = await coordinator.search(baseRequest);

    expect(repeated).toEqual(result);
    expect(selectedProvider.embedProcedure).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(selectedProvider.embedProcedure!).mock.calls[0]![0].documents;
    expect(batch).toHaveLength(2);
    expect(batch[0]).toBe(baseRequest.query);
    expect(batch[1]).toContain('snowman.eye.left.procedure');
    expect(batch[1]).toContain('menu');
    expect(batch[1]).not.toContain('用户对左眼球体的自然语言要求');
    expect(batch[1]).not.toContain('制作雪人的头部');
    expect(result).toMatchObject({
      effectiveFilters: { validationStatus: 'verified' },
      corpus: { documentCount: 1, vectorDimension: 2 },
      hits: [{ rank: 1, tree: { revision: 2 }, cosineSimilarity: expect.any(Number) }],
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    expect(JSON.stringify(result)).not.toContain('"vectors":');
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.semantic.retrieval.requested',
      'procedure.semantic.retrieval.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain(baseRequest.query);
    expect(JSON.stringify(events)).not.toContain('"vectors"');
  });

  it('restores a completed result without replaying Provider work', async () => {
    const firstProvider = provider([
      [1, 0],
      [1, 0],
    ]);
    const first = setup({ provider: firstProvider });
    const expected = await first.coordinator.search(baseRequest);
    const restartedProvider = provider([]);
    const restarted = setup({
      provider: restartedProvider,
      existingEvents: stored(first.events),
    });

    await expect(restarted.coordinator.search(baseRequest)).resolves.toEqual(expected);
    expect(restartedProvider.embedProcedure).not.toHaveBeenCalled();
    expect(restarted.coordinator.completedResult(baseRequest.requestId)).toEqual(expected);
  });

  it('exposes immutable persisted completion evidence after append and restart', async () => {
    const first = setup({
      provider: provider([
        [1, 0],
        [1, 0],
      ]),
    });
    const expectedResult = await first.coordinator.search(baseRequest);
    const completedEvent = first.events[1]!;
    const liveEvidence = first.coordinator.completedEvidence(baseRequest.requestId);

    expect(liveEvidence).toEqual({
      id: `procedure-semantic-retrieval-completed:${baseRequest.requestId}`,
      sequence: 2,
      createdAt: '2026-08-19T01:00:00.000Z',
      occurredAt: expectedResult.completedAt,
      requestId: baseRequest.requestId,
      retrievalId: expectedResult.retrievalId,
      resultContentSha256: sha256(expectedResult),
      eventContentSha256: sha256(completedEvent.payload),
      result: expectedResult,
    });
    expect(Object.isFrozen(liveEvidence)).toBe(true);
    expect(Object.isFrozen(liveEvidence!.result)).toBe(true);
    expect(Object.isFrozen(liveEvidence!.result.hits)).toBe(true);

    const restarted = setup({
      provider: provider([]),
      existingEvents: stored(first.events),
    });
    const restoredEvidence = restarted.coordinator.completedEvidence(baseRequest.requestId);
    expect(restoredEvidence).toEqual(liveEvidence);
    expect(restoredEvidence).not.toBe(liveEvidence);
    expect(restoredEvidence!.result).not.toBe(liveEvidence!.result);
  });

  it('returns no completion evidence for missing, requested-only, or failed retrievals', async () => {
    const missing = setup({ provider: provider([]) });
    expect(missing.coordinator.completedEvidence(baseRequest.requestId)).toBeNull();

    const requestedOnly = setup({
      provider: provider([
        [1, 0],
        [1, 0],
      ]),
    });
    await requestedOnly.coordinator.search(baseRequest);
    const restartedRequested = setup({
      provider: provider([]),
      existingEvents: stored([requestedOnly.events[0]!]),
    });
    expect(restartedRequested.coordinator.completedEvidence(baseRequest.requestId)).toBeNull();

    const failed = setup({
      provider: provider([
        [1, 0],
        [0, 0],
      ]),
    });
    await expect(failed.coordinator.search(baseRequest)).rejects.toMatchObject({
      code: 'planner_output_invalid',
    });
    expect(failed.coordinator.completedEvidence(baseRequest.requestId)).toBeNull();
    const restartedFailed = setup({
      provider: provider([]),
      existingEvents: stored(failed.events),
    });
    expect(restartedFailed.coordinator.completedEvidence(baseRequest.requestId)).toBeNull();
  });

  it('rejects tampered completed evidence before exposing it', async () => {
    const first = setup({
      provider: provider([
        [1, 0],
        [1, 0],
      ]),
    });
    await first.coordinator.search(baseRequest);
    const evidence = stored(first.events);
    const tampered = structuredClone(evidence[1]!);
    ((tampered.payload as Record<string, unknown>)['result'] as Record<string, unknown>)[
      'durationMs'
    ] = 123;

    expect(() =>
      setup({ provider: provider([]), existingEvents: [evidence[0]!, tampered] }),
    ).toThrow('integrity');
  });

  it('uses protocol-stable code-unit identity ordering for equal cosine scores', async () => {
    const records = ['semantic.tie.a', 'semantic.tie-A', 'semantic.tie.A'].map((id, index) => {
      const value = structuredClone(tree());
      value.id = id;
      return record(value, index + 1);
    });
    const attempt = setup({
      provider: provider([
        [1, 0],
        [1, 0],
        [1, 0],
        [1, 0],
      ]),
      records,
    });

    const result = await attempt.coordinator.search({
      ...baseRequest,
      requestId: 'e71e9160-1a31-429a-9b61-ad64d73785fa',
    });

    expect(result.hits.map((hit) => hit.tree.treeId)).toEqual([
      'semantic.tie-A',
      'semantic.tie.A',
      'semantic.tie.a',
    ]);
  });

  it('persists a failed terminal attempt for invalid embeddings and never auto-replays it', async () => {
    const invalidProvider = provider([
      [1, 0],
      [0, 0],
    ]);
    const first = setup({ provider: invalidProvider });
    await expect(first.coordinator.search(baseRequest)).rejects.toMatchObject({
      code: 'planner_output_invalid',
    });
    expect(first.events.map((event) => event.eventType)).toEqual([
      'procedure.semantic.retrieval.requested',
      'procedure.semantic.retrieval.failed',
    ]);

    const restartedProvider = provider([
      [1, 0],
      [1, 0],
    ]);
    const restarted = setup({
      provider: restartedProvider,
      existingEvents: stored(first.events),
    });
    await expect(restarted.coordinator.search(baseRequest)).rejects.toMatchObject({
      code: 'planner_generation_already_attempted',
    });
    expect(restartedProvider.embedProcedure).not.toHaveBeenCalled();
  });

  it('fails closed before evidence or Provider work for future authorization and corrupt storage', async () => {
    const selectedProvider = provider([
      [1, 0],
      [1, 0],
    ]);
    const future = setup({ provider: selectedProvider });
    await expect(
      future.coordinator.search({
        ...baseRequest,
        requestId: '24a544b4-2354-4637-b85e-7dc256beb054',
        authorization: {
          ...baseRequest.authorization,
          confirmedAt: '2026-08-20T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'planner_invalid_request' });
    expect(future.events).toEqual([]);

    const storedTree = record(tree());
    const duplicate = setup({
      provider: selectedProvider,
      records: [storedTree],
      summaries: [summary(storedTree), summary(storedTree)],
    });
    await expect(
      duplicate.coordinator.search({
        ...baseRequest,
        requestId: '5d13f9c7-2398-462f-baca-33d5e4741198',
      }),
    ).rejects.toMatchObject({ code: 'planner_catalog_invalid' });
    expect(duplicate.events).toEqual([]);
    expect(selectedProvider.embedProcedure).not.toHaveBeenCalled();
  });

  it.each([
    {
      vectors: [
        [1, Number.NaN],
        [1, 0],
      ],
      label: 'non-finite',
    },
    { vectors: [[1], [1, 0]], label: 'mixed dimensions' },
    { vectors: [[1, 0]], label: 'wrong vector count' },
  ])('rejects $label vector output', async ({ vectors }) => {
    const attempt = setup({ provider: provider(vectors) });
    await expect(
      attempt.coordinator.search({
        ...baseRequest,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'planner_output_invalid' });
  });

  it('rejects extra Provider output fields and reports empty top-k context truthfully', async () => {
    const extra = provider([
      [1, 0],
      [1, 0],
    ]);
    extra.embedProcedure = vi.fn(async () => ({
      vectors: [
        [1, 0],
        [1, 0],
      ],
      model: 'hidden',
    })) as never;
    await expect(
      setup({ provider: extra }).coordinator.search({
        ...baseRequest,
        requestId: 'bf58e09b-0590-4480-a471-d44679569b70',
      }),
    ).rejects.toMatchObject({ code: 'planner_output_invalid' });

    const noMatch = setup({
      provider: provider([
        [1, 0],
        [-1, 0],
      ]),
    });
    await expect(
      noMatch.coordinator.search({
        ...baseRequest,
        requestId: '362e6d90-ff6b-450a-9e9f-1cd6a6ac2fa6',
        retrieval: { topK: 5, minScore: 0 },
      }),
    ).resolves.toMatchObject({ hits: [], ragContextProduced: false });
  });

  it('fails closed instead of truncating oversized documents or corpora', async () => {
    const oversizedTree = structuredClone(tree());
    const leaf = oversizedTree.nodes.find((node) => node.kind === 'leaf')!;
    leaf.intent = 'x'.repeat(40_000);
    const oversized = setup({
      provider: provider([]),
      records: [record(oversizedTree)],
    });
    await expect(
      oversized.coordinator.search({
        ...baseRequest,
        requestId: '56d37102-d7de-4b45-a8e2-3791f55c6110',
      }),
    ).rejects.toMatchObject({ code: 'planner_catalog_invalid' });
    expect(oversized.events).toEqual([]);

    const records = Array.from({ length: 257 }, (_, index) => {
      const value = structuredClone(tree());
      value.id = `semantic.corpus.tree.${String(index).padStart(3, '0')}`;
      return record(value, index + 1);
    });
    const oversizedCorpus = setup({ provider: provider([]), records });
    await expect(
      oversizedCorpus.coordinator.search({
        ...baseRequest,
        requestId: 'de98723d-d715-4819-919c-622ed7172539',
      }),
    ).rejects.toMatchObject({ code: 'planner_catalog_invalid' });
    expect(oversizedCorpus.events).toEqual([]);
  });

  it('rejects malformed lifecycle evidence during restore', async () => {
    const first = setup({
      provider: provider([
        [1, 0],
        [1, 0],
      ]),
    });
    await first.coordinator.search(baseRequest);
    const evidence = stored(first.events);
    const completed = evidence[1]!;
    const corruptPayload = structuredClone(completed.payload) as Record<string, unknown>;
    corruptPayload['resultContentSha256'] = '0'.repeat(64);

    expect(() =>
      restoreProcedureSemanticRetrievalInvocations([
        evidence[0]!,
        { ...completed, payload: corruptPayload },
      ]),
    ).toThrow('integrity');
    expect(() => restoreProcedureSemanticRetrievalInvocations([completed])).toThrow(
      'no requested marker',
    );
    expect(() =>
      restoreProcedureSemanticRetrievalInvocations([
        evidence[0]!,
        { ...evidence[0]!, sequence: 2 },
      ]),
    ).toThrow('Duplicate');
    expect(() =>
      restoreProcedureSemanticRetrievalInvocations([
        { ...completed, sequence: 1 },
        { ...evidence[0]!, sequence: 2 },
      ]),
    ).toThrow('must precede terminal evidence');

    const corruptParameters = structuredClone(evidence[0]!);
    (
      (
        (corruptParameters.payload as Record<string, unknown>)['runtimeTreatment'] as Record<
          string,
          unknown
        >
      )['treatment'] as Record<string, unknown>
    )['generationSettings'] = {
      ...(
        (
          (corruptParameters.payload as Record<string, unknown>)['runtimeTreatment'] as Record<
            string,
            unknown
          >
        )['treatment'] as Record<string, unknown>
      )['generationSettings'],
      parametersSha256: '0'.repeat(64),
    };
    expect(() => restoreProcedureSemanticRetrievalInvocations([corruptParameters])).toThrow(
      'parameter digest',
    );

    const corruptTreatment = structuredClone(evidence[0]!);
    (
      (corruptTreatment.payload as Record<string, unknown>)['runtimeTreatment'] as Record<
        string,
        unknown
      >
    )['treatmentContentSha256'] = '0'.repeat(64);
    expect(() => restoreProcedureSemanticRetrievalInvocations([corruptTreatment])).toThrow(
      'treatment digest',
    );

    const corruptProvider = structuredClone(evidence[0]!);
    (corruptProvider.payload as Record<string, unknown>)['providerDescriptorContentSha256'] =
      '0'.repeat(64);
    expect(() => restoreProcedureSemanticRetrievalInvocations([corruptProvider])).toThrow(
      'provider evidence identity',
    );
  });
});
