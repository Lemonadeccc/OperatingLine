import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  canonicalizeProtocolJsonValue,
  procedureRefinementCreateRequestSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureTreeSchema,
  protocolJsonValueCanonicalization,
  type ProcedureRefinementCreateRequest,
  type ProcedureSemanticRetrievalResult,
  type ProcedureTree,
  type StoredProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it, vi } from 'vitest';

import { snapshotPlannerProviderRuntimeTreatment } from '../../../services/orchestrator/src/planner-provider-attestation.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import {
  buildProcedureRefinementDialoguePromptPacket,
  buildProcedureRefinementPromptPacket,
  validateProcedureRefinementDialoguePromptPacketIntegrity,
  validateProcedureRefinementPromptPacketIntegrity,
} from '../../../services/orchestrator/src/procedure-refinement-prompt.js';
import { createProcedureRefinementScope } from '../../../services/orchestrator/src/procedure-refinement-scope.js';
import { createProcedureSemanticRetrievalCoordinator } from '../../../services/orchestrator/src/procedure-semantic-retrieval.js';

const descriptor = {
  contractVersion: '1.0.0',
  id: 'test-procedure-refiner',
  version: '1.0.0',
  displayName: 'Test procedure refiner',
  description: 'Provides deterministic refinement prompt fixtures.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function provider(): PlannerProvider {
  return {
    descriptor,
    generate: vi.fn(async () => ({})),
    embedProcedure: vi.fn(async ({ documents }) => ({
      vectors: documents.map(() => [1, 0]),
    })),
    describeRuntimeTreatment: vi.fn((operation) => ({
      profile: {
        descriptor,
        vendor: 'Local test',
        implementation: { name: 'test-procedure-refiner', version: '1.0.0' },
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
        publicStatement: 'The in-memory test provider has no provider charge.',
      },
    })),
  };
}

function verifiedTree(): ProcedureTree {
  const input = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  for (const node of input['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    node['validation'] = {
      status: 'verified',
      validatedHostVersions: ['4.5.0'],
      notes: ['Verified fixture leaf.'],
    };
  }
  return procedureTreeSchema.parse(input);
}

function storedTree(tree: ProcedureTree): StoredProcedureTree {
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

async function semanticResult(
  baseTree: StoredProcedureTree,
): Promise<ProcedureSemanticRetrievalResult> {
  const selectedProvider = provider();
  const treatment = snapshotPlannerProviderRuntimeTreatment(
    selectedProvider,
    descriptor,
    'procedure_embedding',
  );
  if (treatment === undefined) throw new Error('Expected embedding runtime treatment');
  const request = procedureSemanticRetrievalRequestSchema.parse({
    formatVersion: '1.0.0',
    requestId: randomUUID(),
    query: 'make the eye larger',
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
        sequence: baseTree.sequence,
        treeId: baseTree.tree.id,
        revision: baseTree.tree.revision,
        title: baseTree.tree.title,
        adapterId: baseTree.tree.adapterId,
        actionCatalogVersion: baseTree.tree.actionCatalogVersion,
        interactionCatalogVersion: baseTree.tree.interactionCatalogVersion,
        hostVersionRange: baseTree.tree.hostVersionRange,
        integrity: baseTree.integrity,
        storedAt: baseTree.storedAt,
      },
    ],
    getProcedureTree: () => baseTree,
    appendEvent: () => undefined,
    now: () => new Date('2026-08-19T08:01:00.000Z'),
  });
  return coordinator.search(request);
}

async function fixture() {
  const baseTree = storedTree(verifiedTree());
  const semanticRetrieval = await semanticResult(baseTree);
  const selectedProvider = provider();
  const dialogueRuntimeTreatment = snapshotPlannerProviderRuntimeTreatment(
    selectedProvider,
    descriptor,
    'procedure_refinement_dialogue',
  );
  const refinementRuntimeTreatment = snapshotPlannerProviderRuntimeTreatment(
    selectedProvider,
    descriptor,
    'procedure_refinement',
  );
  if (dialogueRuntimeTreatment === undefined || refinementRuntimeTreatment === undefined) {
    throw new Error('Expected refinement runtime treatments');
  }
  const request = procedureRefinementCreateRequestSchema.parse({
    formatVersion: '1.0.0',
    runId: randomUUID(),
    dialogueRequestId: randomUUID(),
    refinementRequestId: randomUUID(),
    baseTree,
    targetRevision: baseTree.tree.revision + 1,
    requestedScopeRootIds: ['snowman.head.eyes.left'],
    semanticContext: {
      status: 'completed',
      requestId: semanticRetrieval.requestId,
      retrievalId: semanticRetrieval.retrievalId,
      resultContentSha256: sha256(semanticRetrieval),
      completedEventContentSha256: '0'.repeat(64),
      completedAt: semanticRetrieval.completedAt,
    },
    instruction: 'Make the left eye slightly larger.',
    history: [
      { role: 'user', message: 'Explain the current eye step.' },
      { role: 'assistant', message: 'It creates and positions a sphere.' },
    ],
    providerDisclosure: {
      providerDescriptor: descriptor,
      dialogueRuntimeTreatment,
      refinementRuntimeTreatment,
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
      providerInputPolicy: {
        exactStoredBaseTreeSent: true,
        exactSemanticRetrievalResultSent: true,
        instructionSent: true,
        dialogueHistorySent: true,
        credentialsIncludedInTaskPayload: false,
      },
      confirmedAt: '2026-08-19T08:02:00.000Z',
    },
  });
  return {
    request,
    semanticRetrieval,
    scope: createProcedureRefinementScope(baseTree.tree, request.requestedScopeRootIds),
  };
}

describe('Procedure refinement prompt packets', () => {
  it('binds the dialogue packet to the exact run, request, scope, and semantic receipt', async () => {
    const input = await fixture();

    const packet = buildProcedureRefinementDialoguePromptPacket(input);

    expect(validateProcedureRefinementDialoguePromptPacketIntegrity(packet)).toEqual(packet);
    expect(packet.operation).toBe('procedure_refinement_dialogue');
    expect(packet.requestId).toBe(input.request.dialogueRequestId);
    expect(packet.context.runId).toBe(input.request.runId);
    expect(packet.context.scope).toEqual(input.scope);
    expect(packet.context.semanticRetrieval).toEqual(input.semanticRetrieval);
    expect(packet.workflow).toMatchObject({ confidenceThreshold: 0.8, maximumProviderCalls: 2 });
  });

  it('rejects a dialogue packet after any integrity-bound content is changed', async () => {
    const input = await fixture();
    const packet = buildProcedureRefinementDialoguePromptPacket(input);

    expect(() =>
      validateProcedureRefinementDialoguePromptPacketIntegrity({
        ...packet,
        renderedPrompt: `${packet.renderedPrompt}\ntampered`,
      }),
    ).toThrow(/integrity check failed/);
  });

  it('rejects semantic receipts that do not exactly bind the completed retrieval result', async () => {
    const input = await fixture();
    const request: ProcedureRefinementCreateRequest = {
      ...input.request,
      semanticContext: {
        ...input.request.semanticContext,
        resultContentSha256: 'f'.repeat(64),
      },
    };

    expect(() => buildProcedureRefinementDialoguePromptPacket({ ...input, request })).toThrow(
      /semantic context does not match/,
    );
  });

  it('rejects a completed semantic retrieval result that contains no RAG hits', async () => {
    const input = await fixture();
    const semanticRetrieval = {
      ...input.semanticRetrieval,
      hits: [],
      ragContextProduced: false,
    } satisfies ProcedureSemanticRetrievalResult;
    const request: ProcedureRefinementCreateRequest = {
      ...input.request,
      semanticContext: {
        ...input.request.semanticContext,
        resultContentSha256: sha256(semanticRetrieval),
      },
    };

    expect(() =>
      buildProcedureRefinementDialoguePromptPacket({ ...input, request, semanticRetrieval }),
    ).toThrow(/non-empty semantic context/);
  });

  it('rejects a scope whose ordered roots differ from the authorized request', async () => {
    const input = await fixture();
    const scope = createProcedureRefinementScope(input.request.baseTree.tree, ['snowman.head']);

    expect(() => buildProcedureRefinementDialoguePromptPacket({ ...input, scope })).toThrow(
      /scope does not match/,
    );
  });

  it('builds refinement only for the fixed threshold decision and prohibits side effects', async () => {
    const input = await fixture();
    const packet = buildProcedureRefinementPromptPacket({
      ...input,
      dialogueResult: {
        assistantMessage: 'I can refine the selected eye step.',
        decision: { kind: 'refine', confidence: 0.8, threshold: 0.8 },
      },
    });

    expect(validateProcedureRefinementPromptPacketIntegrity(packet)).toEqual(packet);
    expect(packet.operation).toBe('procedure_refinement');
    expect(packet.requestId).toBe(input.request.refinementRequestId);
    expect(packet.context.dialogueResult.decision).toEqual({
      kind: 'refine',
      confidence: 0.8,
      threshold: 0.8,
    });
    expect(packet.workflow).toMatchObject({
      proposalCreationAllowed: false,
      hostExecutionAllowed: false,
    });
    expect(packet.renderedPrompt).toMatch(
      /Do not create a Proposal, store the target tree, or execute host actions/,
    );
  });

  it('rejects an answer decision before building the second provider packet', async () => {
    const input = await fixture();

    expect(() =>
      buildProcedureRefinementPromptPacket({
        ...input,
        dialogueResult: {
          assistantMessage: 'The current step creates the eye.',
          decision: { kind: 'answer', confidence: 0.79, threshold: 0.8 },
        },
      }),
    ).toThrow(/threshold-approved/);
  });

  it('rejects a refinement packet after the bound target revision is changed', async () => {
    const input = await fixture();
    const packet = buildProcedureRefinementPromptPacket({
      ...input,
      dialogueResult: {
        assistantMessage: 'I can refine the selected eye step.',
        decision: { kind: 'refine', confidence: 0.9, threshold: 0.8 },
      },
    });

    expect(() =>
      validateProcedureRefinementPromptPacketIntegrity({
        ...packet,
        context: { ...packet.context, targetRevision: packet.context.targetRevision + 1 },
      }),
    ).toThrow();
  });
});
