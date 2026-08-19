import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  procedureRefinementCreateRequestSchema,
  procedureRefinementProviderDisclosureListSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalResultSchema,
  procedureTreeSchema,
  procedureTreeStoreResultSchema,
  type ProcedureRefinementProviderDisclosureList,
} from '@operatingline/protocol';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import { afterEach, describe, expect, it, vi } from 'vitest';

const accessToken = 'procedure-refinement-runtime-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

interface McpToolResponse {
  result?: {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ text?: string }>;
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

const refinementDescriptor = {
  contractVersion: '1.0.0',
  id: 'procedure-refinement-runtime-provider',
  version: '1.0.0',
  displayName: 'Procedure refinement runtime provider',
  description: 'Deterministic local provider for the public refinement workflow test.',
  availability: { available: true },
  limits: { maxConcurrency: 2 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

function refinementProvider() {
  const embedProcedure = vi.fn(async ({ documents }: { documents: readonly string[] }) => ({
    vectors: documents.map(() => [1, 0]),
  }));
  const procedureRefinementDialogue = vi.fn<
    NonNullable<PlannerProvider['procedureRefinementDialogue']>
  >(async ({ emit }) => {
    emit({ type: 'assistant_text_delta', delta: 'I can refine ' });
    emit({ type: 'assistant_text_delta', delta: 'the selected eye.' });
    return {
      assistantMessage: 'I can refine the selected eye.',
      decision: { kind: 'refine', confidence: 0.9, threshold: 0.8 },
    };
  });
  const refineProcedure = vi.fn<NonNullable<PlannerProvider['refineProcedure']>>(
    async ({ packet }) => {
      const target = structuredClone(packet.context.baseTree.tree);
      target.revision = packet.context.targetRevision;
      const leaf = target.nodes.find((node) => node.id === 'snowman.head.eyes.left');
      if (leaf === undefined) throw new Error('Expected the selected eye leaf');
      leaf.title = `${leaf.title}（语义精修）`;
      return target;
    },
  );
  const provider: PlannerProvider = {
    descriptor: refinementDescriptor,
    generate: vi.fn(async () => ({})),
    embedProcedure,
    procedureRefinementDialogue,
    refineProcedure,
    describeRuntimeTreatment: vi.fn((operation) => ({
      profile: {
        descriptor: refinementDescriptor,
        vendor: 'Local test',
        implementation: {
          name: 'procedure-refinement-runtime-provider',
          version: '1.0.0',
        },
        model: {
          requested: `${operation}-fixture`,
          resolvedRevision: 'fixture-v1',
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
        publicStatement: 'The local integration-test provider has no provider charge.',
      },
    })),
  };
  return { provider, embedProcedure, procedureRefinementDialogue, refineProcedure };
}

function verifiedProcedureTree() {
  const input = structuredClone(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  ) as Record<string, unknown>;
  for (const node of input['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    node['validation'] = {
      status: 'verified',
      validatedHostVersions: ['4.5.0'],
      notes: ['Verified public refinement workflow fixture.'],
    };
  }
  return procedureTreeSchema.parse(input);
}

async function waitForRunStatus(runtime: RunningRuntime, runId: string, expected: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${runtime.baseUrl}/api/v1/procedure/refinement/runs/${runId}?formatVersion=1.0.0`,
      { headers },
    );
    if (response.status === 200) {
      const status = procedureRefinementRunStatusSchema.parse(await response.json());
      if (status.status === expected) return status;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error(`Procedure refinement run did not reach ${expected}`);
}

describe('Procedure refinement runtime API', () => {
  let runtime: RunningRuntime | undefined;

  afterEach(async () => {
    await runtime?.stop();
    runtime = undefined;
  });

  it('exposes consistent no-provider HTTP and MCP capability disclosure', async () => {
    runtime = await startRuntime({ databasePath: ':memory:', accessToken });

    const response = await fetch(`${runtime.baseUrl}/api/v1/procedure/refinement/providers`, {
      headers,
    });
    expect(response.status).toBe(200);
    const httpDisclosure = procedureRefinementProviderDisclosureListSchema.parse(
      await response.json(),
    );
    expect(httpDisclosure).toEqual({
      formatVersion: '1.0.0',
      refinementAvailable: false,
      providers: [],
    } satisfies ProcedureRefinementProviderDisclosureList);

    const mcpDisclosure = await callMcpTool(
      runtime,
      1,
      'operatingline.procedure.refinement.providers.list',
      {},
    );
    expect(mcpDisclosure.result?.isError).not.toBe(true);
    expect(mcpDisclosure.result?.structuredContent).toEqual(httpDisclosure);
  });

  it('strictly parses HTTP and MCP run/status/review inputs', async () => {
    runtime = await startRuntime({ databasePath: ':memory:', accessToken });
    const runId = randomUUID();
    const semanticRequestId = randomUUID();

    const invalidCreate = await fetch(`${runtime.baseUrl}/api/v1/procedure/refinement/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, unexpected: true }),
    });
    expect(invalidCreate.status).toBe(400);
    expect(await invalidCreate.json()).toMatchObject({
      error: 'invalid_procedure_refinement_create_request',
      requestId: null,
    });

    const missingReceipt = await fetch(
      `${runtime.baseUrl}/api/v1/procedure/refinement/semantic-context/${semanticRequestId}?formatVersion=1.0.0`,
      { headers },
    );
    expect(missingReceipt.status).toBe(404);
    expect(await missingReceipt.json()).toEqual({
      error: 'procedure_refinement_semantic_context_receipt_not_found',
      requestId: semanticRequestId,
    });

    const shadowedReceipt = await fetch(
      `${runtime.baseUrl}/api/v1/procedure/refinement/semantic-context/${semanticRequestId}?formatVersion=1.0.0&requestId=${randomUUID()}`,
      { headers },
    );
    expect(shadowedReceipt.status).toBe(400);

    const missingStatus = await fetch(
      `${runtime.baseUrl}/api/v1/procedure/refinement/runs/${runId}?formatVersion=1.0.0`,
      { headers },
    );
    expect(missingStatus.status).toBe(404);
    expect(await missingStatus.json()).toEqual({
      error: 'procedure_refinement_run_not_found',
      runId,
    });

    const shadowedStatus = await fetch(
      `${runtime.baseUrl}/api/v1/procedure/refinement/runs/${runId}?formatVersion=1.0.0&runId=${randomUUID()}`,
      { headers },
    );
    expect(shadowedStatus.status).toBe(400);

    const invalidReview = await fetch(`${runtime.baseUrl}/api/v1/procedure/refinement/reviews`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, unexpected: true }),
    });
    expect(invalidReview.status).toBe(400);
    expect(await invalidReview.json()).toMatchObject({
      error: 'invalid_procedure_refinement_review_request',
    });

    for (const [id, name, argumentsValue, expectedError] of [
      [
        2,
        'operatingline.procedure.refinement.semantic-context.get',
        { requestId: semanticRequestId, unexpected: true },
        'invalid_procedure_refinement_semantic_context_receipt_request',
      ],
      [
        3,
        'operatingline.procedure.refinement.run.create',
        { runId },
        'invalid_procedure_refinement_create_request',
      ],
      [
        4,
        'operatingline.procedure.refinement.run.status',
        { runId, unexpected: true },
        'invalid_procedure_refinement_status_request',
      ],
      [
        5,
        'operatingline.procedure.refinement.run.review',
        { runId },
        'invalid_procedure_refinement_review_request',
      ],
    ] as const) {
      const result = await callMcpTool(runtime, id, name, argumentsValue);
      expect(result.result?.isError).toBe(true);
      expect(JSON.parse(result.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        error: expectedError,
      });
    }

    const missingMcpReceipt = await callMcpTool(
      runtime,
      6,
      'operatingline.procedure.refinement.semantic-context.get',
      { formatVersion: '1.0.0', requestId: semanticRequestId },
    );
    expect(missingMcpReceipt.result?.isError).toBe(true);
    expect(JSON.parse(missingMcpReceipt.result?.content?.[0]?.text ?? '{}')).toEqual({
      error: 'procedure_refinement_semantic_context_receipt_not_found',
      requestId: semanticRequestId,
    });
  });

  it('runs search, receipt, streamed refinement, exact review, storage, and restart over HTTP and MCP', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-refinement-runtime-'));
    const databasePath = join(directory, 'state.db');
    const tree = verifiedProcedureTree();
    const actionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === tree.actionCatalogVersion,
    );
    const interactionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === tree.interactionCatalogVersion,
    );
    if (actionCatalog === undefined || interactionCatalog === undefined) {
      throw new Error('Expected immutable Blender catalog snapshots for the Procedure fixture');
    }
    const { provider, embedProcedure, procedureRefinementDialogue, refineProcedure } =
      refinementProvider();

    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [actionCatalog],
        interactionCatalogs: [interactionCatalog],
        plannerProviders: [provider],
      });

      const storeResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree }),
      });
      expect(storeResponse.status).toBe(200);
      const stored = procedureTreeStoreResultSchema.parse(await storeResponse.json()).record;

      const semanticProvidersResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/semantic/providers`,
        { headers },
      );
      expect(semanticProvidersResponse.status).toBe(200);
      const semanticDisclosure = procedureSemanticRetrievalProviderDisclosureListSchema.parse(
        await semanticProvidersResponse.json(),
      ).providers[0]!;
      const semanticRequest = procedureSemanticRetrievalRequestSchema.parse({
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        query: 'Make the left eye step slightly larger.',
        providerDisclosure: semanticDisclosure,
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
          confirmedAt: new Date(Date.now() - 1_000).toISOString(),
        },
      });
      const semanticResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/semantic/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(semanticRequest),
      });
      expect(semanticResponse.status).toBe(200);
      const semanticResult = procedureSemanticRetrievalResultSchema.parse(
        await semanticResponse.json(),
      );
      expect(semanticResult.hits).toHaveLength(1);

      const receiptMcp = await callMcpTool(
        runtime,
        30,
        'operatingline.procedure.refinement.semantic-context.get',
        { formatVersion: '1.0.0', requestId: semanticRequest.requestId },
      );
      expect(receiptMcp.result?.isError).not.toBe(true);
      const semanticContext = procedureRefinementSemanticContextBindingSchema.parse(
        receiptMcp.result?.structuredContent,
      );

      const refinementProvidersResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/refinement/providers`,
        { headers },
      );
      expect(refinementProvidersResponse.status).toBe(200);
      const refinementDisclosure = procedureRefinementProviderDisclosureListSchema.parse(
        await refinementProvidersResponse.json(),
      ).providers[0]!;
      const createRequest = procedureRefinementCreateRequestSchema.parse({
        formatVersion: '1.0.0',
        runId: randomUUID(),
        dialogueRequestId: randomUUID(),
        refinementRequestId: randomUUID(),
        baseTree: stored,
        targetRevision: stored.tree.revision + 1,
        requestedScopeRootIds: ['snowman.head.eyes.left'],
        semanticContext,
        instruction: 'Make the selected eye step slightly larger.',
        history: [],
        providerDisclosure: refinementDisclosure,
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
          providerInputPolicy: refinementDisclosure.inputPolicy,
          confirmedAt: new Date().toISOString(),
        },
      });
      const createResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/refinement/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(createRequest),
      });
      expect(createResponse.status).toBe(202);
      procedureRefinementRunStatusSchema.parse(await createResponse.json());

      const duplicateCreate = await callMcpTool(
        runtime,
        31,
        'operatingline.procedure.refinement.run.create',
        createRequest,
      );
      if (duplicateCreate.result?.isError === true) {
        throw new Error(duplicateCreate.result.content?.[0]?.text ?? 'Duplicate create failed');
      }
      procedureRefinementRunStatusSchema.parse(duplicateCreate.result?.structuredContent);

      const awaitingReview = await waitForRunStatus(
        runtime,
        createRequest.runId,
        'awaiting_review',
      );
      expect(awaitingReview).toMatchObject({
        terminal: false,
        assistantMessage: 'I can refine the selected eye.',
        semanticDecision: { kind: 'refine', confidence: 0.9, threshold: 0.8 },
        sideEffects: {
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });
      expect(awaitingReview.preview?.providerResult.targetTree).not.toEqual(
        awaitingReview.preview?.targetTree,
      );

      const statusMcp = await callMcpTool(
        runtime,
        32,
        'operatingline.procedure.refinement.run.status',
        { formatVersion: '1.0.0', runId: createRequest.runId },
      );
      expect(statusMcp.result?.structuredContent).toEqual(awaitingReview);

      const reviewRequest = procedureRefinementReviewRequestSchema.parse({
        formatVersion: '1.0.0',
        runId: createRequest.runId,
        reviewId: randomUUID(),
        binding: awaitingReview.preview!.binding,
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
        reviewedAt: new Date(
          Math.max(Date.now(), Date.parse(awaitingReview.preview!.reviewReadyAt)),
        ).toISOString(),
      });
      const reviewedMcp = await callMcpTool(
        runtime,
        33,
        'operatingline.procedure.refinement.run.review',
        reviewRequest,
      );
      if (reviewedMcp.result?.isError === true) {
        throw new Error(reviewedMcp.result.content?.[0]?.text ?? 'Refinement review failed');
      }
      const completed = procedureRefinementRunStatusSchema.parse(
        reviewedMcp.result?.structuredContent,
      );
      expect(completed).toMatchObject({
        status: 'completed',
        terminal: true,
        storedTree: { tree: { revision: stored.tree.revision + 1 } },
        sideEffects: {
          procedureStored: true,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });

      const duplicateReview = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/refinement/reviews`,
        { method: 'POST', headers, body: JSON.stringify(reviewRequest) },
      );
      expect(duplicateReview.status).toBe(200);
      expect(procedureRefinementRunStatusSchema.parse(await duplicateReview.json())).toEqual(
        completed,
      );

      expect(embedProcedure).toHaveBeenCalledTimes(1);
      expect(procedureRefinementDialogue).toHaveBeenCalledTimes(1);
      expect(refineProcedure).toHaveBeenCalledTimes(1);

      await runtime.stop();
      runtime = undefined;
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [actionCatalog],
        interactionCatalogs: [interactionCatalog],
        plannerProviders: [provider],
      });
      const restored = await waitForRunStatus(runtime, createRequest.runId, 'completed');
      expect(restored).toEqual(completed);
      const restoredReceipt = await callMcpTool(
        runtime,
        34,
        'operatingline.procedure.refinement.semantic-context.get',
        { formatVersion: '1.0.0', requestId: semanticRequest.requestId },
      );
      expect(restoredReceipt.result?.structuredContent).toEqual(semanticContext);
      expect(embedProcedure).toHaveBeenCalledTimes(1);
      expect(procedureRefinementDialogue).toHaveBeenCalledTimes(1);
      expect(refineProcedure).toHaveBeenCalledTimes(1);
    } finally {
      await runtime?.stop();
      runtime = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
