import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureTreeSchema,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';
import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import { describe, expect, it, vi } from 'vitest';

const accessToken = 'semantic-retrieval-integration-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

const descriptor = {
  contractVersion: '1.0.0',
  id: 'local-semantic-embedder',
  version: '1.0.0',
  displayName: 'Local semantic embedder',
  description: 'Deterministic local embeddings for runtime integration tests.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const satisfies PlannerProviderDescriptor;

const unsupportedDescriptor = {
  ...descriptor,
  id: 'generation-only-provider',
  displayName: 'Generation-only provider',
} as const satisfies PlannerProviderDescriptor;

function embeddingProvider() {
  const embedProcedure = vi.fn(async ({ documents }: { documents: readonly string[] }) => ({
    vectors: documents.map((document, index) =>
      index === 0 || document.includes('Cube Retrieval Target') ? [1, 0] : [0, 1],
    ),
  }));
  const provider: PlannerProvider = {
    descriptor,
    generate: async () => ({}),
    embedProcedure,
    describeRuntimeTreatment: () => ({
      profile: {
        descriptor,
        vendor: 'Local test',
        implementation: { name: 'local-semantic-embedder', version: '1.0.0' },
        model: {
          requested: 'deterministic-two-axis',
          resolvedRevision: 'fixture-v1',
          resolution: 'resolved',
        },
        api: {
          surface: 'local-fixture',
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
        publicStatement: 'The local integration-test embedder has no provider charge.',
      },
    }),
  };
  return { provider, embedProcedure };
}

const unsupportedProvider: PlannerProvider = {
  descriptor: unsupportedDescriptor,
  generate: async () => ({}),
};

function verifiedTree(input: { readonly id: string; readonly title: string }) {
  const value = structuredClone(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  ) as Record<string, unknown>;
  value['id'] = input.id;
  value['title'] = input.title;
  value['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  for (const node of value['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    node['validation'] = {
      status: 'verified',
      validatedHostVersions: ['4.5.0'],
      notes: ['Verified integration-test leaf.'],
    };
  }
  return procedureTreeSchema.parse(value);
}

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: unknown;
  };
}

async function callMcpTool(
  runtime: RunningRuntime,
  id: number,
  name: string,
  argumentsValue: unknown,
): Promise<McpToolResponse> {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  expect(response.status).toBe(200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice('data: '.length)) as McpToolResponse;
}

function expectNoVectorPayload(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoVectorPayload);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  expect(Object.keys(value)).not.toContain('vectors');
  Object.values(value).forEach(expectNoVectorPayload);
}

describe('Procedure semantic retrieval runtime', () => {
  it('lists embedders and ranks verified leaves over HTTP and MCP without replaying or leaking query text', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-semantic-retrieval-'));
    const databasePath = join(directory, 'state.db');
    const { provider, embedProcedure } = embeddingProvider();
    let runtime: RunningRuntime | undefined;
    const query = `private-cube-query-${randomUUID()}`;

    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [provider, unsupportedProvider],
      });
      for (const tree of [
        verifiedTree({ id: 'semantic.sphere.procedure', title: 'Sphere Retrieval Target' }),
        verifiedTree({ id: 'semantic.cube.procedure', title: 'Cube Retrieval Target' }),
      ]) {
        const stored = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tree }),
        });
        expect(stored.status).toBe(200);
      }

      const httpProviders = await fetch(`${runtime.baseUrl}/api/v1/procedure/semantic/providers`, {
        headers,
      });
      expect(httpProviders.status).toBe(200);
      const providerList = procedureSemanticRetrievalProviderDisclosureListSchema.parse(
        await httpProviders.json(),
      );
      expect(providerList).toMatchObject({
        semanticRetrievalAvailable: true,
        providers: [
          {
            providerDescriptor: { id: descriptor.id },
            runtimeTreatment: {
              costPolicy: { possibleProviderCost: false },
              treatment: { profile: { model: { requested: 'deterministic-two-axis' } } },
            },
          },
        ],
      });
      const providerDisclosure = providerList.providers[0]!;
      const mcpProviders = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.semantic.providers.list',
        {},
      );
      expect(mcpProviders.result?.structuredContent).toMatchObject({
        providers: [{ providerDescriptor: { id: descriptor.id } }],
      });
      expect(embedProcedure).not.toHaveBeenCalled();

      const request = procedureSemanticRetrievalRequestSchema.parse({
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        query,
        providerDisclosure,
        retrieval: { topK: 2, minScore: -1 },
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
          confirmedAt: new Date(Date.now() - 1_000).toISOString(),
        },
      });

      const httpSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/semantic/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      expect(httpSearch.status).toBe(200);
      const firstResult = (await httpSearch.json()) as Record<string, unknown>;
      expect(firstResult).toMatchObject({
        requestId: request.requestId,
        effectiveFilters: { validationStatus: 'verified' },
        matching: 'embedding_cosine_similarity',
        hits: [
          { rank: 1, tree: { treeId: 'semantic.cube.procedure' }, cosineSimilarity: 1 },
          { rank: 2, tree: { treeId: 'semantic.sphere.procedure' }, cosineSimilarity: 0 },
        ],
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expectNoVectorPayload(firstResult);

      const mcpSearch = await callMcpTool(
        runtime,
        2,
        'operatingline.procedure.semantic.search',
        request,
      );
      expect(mcpSearch.result?.isError).not.toBe(true);
      expect(mcpSearch.result?.structuredContent).toEqual(firstResult);
      expect(embedProcedure).toHaveBeenCalledTimes(1);

      const exactSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          semanticAction: 'create_uv_sphere',
          validationStatus: 'verified',
        }),
      });
      expect(exactSearch.status).toBe(200);
      expect(await exactSearch.json()).toMatchObject({
        matching: 'exact_structured_filters',
        similarityScoreProduced: false,
      });

      const sqlite = new DatabaseSync(databasePath, { readOnly: true });
      const evidence = sqlite
        .prepare(
          `SELECT payload FROM execution_events
           WHERE event_type LIKE 'procedure.semantic.retrieval.%'
           ORDER BY sequence`,
        )
        .all() as Array<{ payload: string }>;
      sqlite.close();
      expect(evidence).toHaveLength(2);
      expect(JSON.stringify(evidence)).not.toContain(query);

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [provider, unsupportedProvider],
      });
      const restored = await callMcpTool(
        runtime,
        3,
        'operatingline.procedure.semantic.search',
        request,
      );
      expect(restored.result?.structuredContent).toEqual(firstResult);
      expect(embedProcedure).toHaveBeenCalledTimes(1);

      const drift = await fetch(`${runtime.baseUrl}/api/v1/procedure/semantic/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          requestId: randomUUID(),
          providerDisclosure: {
            providerDescriptor: { ...descriptor, description: 'Drifted disclosure.' },
            runtimeTreatment: {
              ...providerDisclosure.runtimeTreatment,
              treatment: {
                ...providerDisclosure.runtimeTreatment.treatment,
                profile: {
                  ...providerDisclosure.runtimeTreatment.treatment.profile,
                  descriptor: { ...descriptor, description: 'Drifted disclosure.' },
                },
              },
            },
          },
        }),
      });
      expect(drift.status).toBe(422);
      expect(await drift.json()).toMatchObject({ error: 'planner_identity_mismatch' });

      const modelDrift = await fetch(`${runtime.baseUrl}/api/v1/procedure/semantic/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          requestId: randomUUID(),
          providerDisclosure: {
            ...providerDisclosure,
            runtimeTreatment: {
              ...providerDisclosure.runtimeTreatment,
              treatment: {
                ...providerDisclosure.runtimeTreatment.treatment,
                profile: {
                  ...providerDisclosure.runtimeTreatment.treatment.profile,
                  model: {
                    ...providerDisclosure.runtimeTreatment.treatment.profile.model,
                    requested: 'unauthorized-model-drift',
                  },
                },
              },
            },
          },
        }),
      });
      expect(modelDrift.status).toBe(422);
      expect(await modelDrift.json()).toMatchObject({ error: 'planner_identity_mismatch' });
      expect(embedProcedure).toHaveBeenCalledTimes(1);

      const futureAuthorization = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/semantic/search`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...request,
            requestId: randomUUID(),
            authorization: {
              ...request.authorization,
              confirmedAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        },
      );
      expect(futureAuthorization.status).toBe(400);
      expect(await futureAuthorization.json()).toMatchObject({ error: 'planner_invalid_request' });

      const unsupported = await callMcpTool(runtime, 4, 'operatingline.procedure.semantic.search', {
        ...request,
        requestId: randomUUID(),
        providerDisclosure: {
          providerDescriptor: unsupportedDescriptor,
          runtimeTreatment: {
            ...providerDisclosure.runtimeTreatment,
            treatment: {
              ...providerDisclosure.runtimeTreatment.treatment,
              profile: {
                ...providerDisclosure.runtimeTreatment.treatment.profile,
                descriptor: unsupportedDescriptor,
              },
            },
          },
        },
      });
      expect(unsupported.result).toMatchObject({ isError: true });
      expect(JSON.parse(unsupported.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        error: 'planner_procedure_embedding_not_supported',
      });
      expect(embedProcedure).toHaveBeenCalledTimes(1);
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
