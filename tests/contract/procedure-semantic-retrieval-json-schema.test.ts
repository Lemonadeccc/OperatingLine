import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  plannerGenerationErrorCodeSchema,
  procedureSemanticRetrievalCompletedEventSchema,
  procedureSemanticRetrievalFailedEventSchema,
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalRequestedEventSchema,
  procedureSemanticRetrievalResultSchema,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const requestId = '11111111-1111-4111-8111-111111111111';
const retrievalId = '22222222-2222-4222-8222-222222222222';
const sha = (value: string) => value.repeat(64);

const providerDescriptor = {
  contractVersion: '1.0.0',
  id: 'embedding.example',
  version: '1.0.0',
  displayName: 'Example Embedding Provider',
  description: 'Provider-neutral embedding contract fixture.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'remote',
    dataTransmission: 'provider_managed',
    credentialManagement: 'provider_managed',
  },
} as const;

const costPolicy = {
  possibleProviderCost: true,
  basis: 'provider_pricing',
  publicStatement: 'Embedding requests may incur charges under the provider pricing terms.',
} as const;

const tree = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
) as {
  id: string;
  revision: number;
  title: string;
  adapterId: string;
  actionCatalogVersion: string;
  interactionCatalogVersion: string;
  hostVersionRange: string;
  nodes: Array<Record<string, unknown>>;
};
const leaf = tree.nodes.find((node) => node['kind'] === 'leaf')!;

const runtimeTreatment = {
  formatVersion: '1.0.0',
  evidenceClass: 'runtime_attested_provider_treatment',
  operation: 'procedure_embedding',
  treatment: {
    profile: {
      descriptor: providerDescriptor,
      vendor: 'Example Vendor',
      implementation: { name: 'example-embedding-adapter', version: '1.0.0' },
      model: {
        requested: 'example-embedding-model',
        resolvedRevision: 'example-embedding-model-2026-08-01',
        resolution: 'resolved',
      },
      api: {
        surface: 'embeddings',
        version: 'v1',
        sdkName: 'example-sdk',
        sdkVersion: '1.0.0',
        endpointClass: 'vendor_public',
        serviceTier: null,
        region: null,
      },
    },
    generationSettings: {
      normalizedParameters: {
        model: 'example-embedding-model',
        encoding_format: 'float',
      },
      parametersSha256: sha('a'),
      seed: null,
      determinism: 'deterministic',
    },
  },
  costPolicy,
  inputPolicy: {
    documentFormat: 'procedure_leaf_embedding_document_v1',
    maximumDocumentCount: 256,
    sourceEvidenceContentIncluded: false,
    vectorsPersistedInProtocol: false,
  },
  treatmentContentSha256: sha('b'),
} as const;

const providerDisclosure = { providerDescriptor, runtimeTreatment } as const;

const request = {
  formatVersion: '1.0.0',
  requestId,
  query: 'Create and position a UV sphere eye.',
  providerDisclosure,
  filters: { validationStatus: 'candidate' },
  retrieval: { topK: 5, minScore: 0.4 },
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
    confirmedAt: '2026-08-19T08:00:00Z',
  },
} as const;

const result = {
  formatVersion: '1.0.0',
  retrievalId,
  requestId,
  requestFingerprint: sha('c'),
  queryContentSha256: sha('d'),
  effectiveFilters: { validationStatus: 'candidate' },
  retrieval: request.retrieval,
  corpus: {
    id: 'stored-procedure-leaves',
    version: '1.0.0',
    contentSha256: sha('e'),
    documentCount: 1,
    vectorDimension: 1_536,
  },
  embedding: {
    providerDescriptor,
    providerDescriptorContentSha256: sha('f'),
    model: runtimeTreatment.treatment.profile.model,
    runtimeEvidence: {
      formatVersion: '1.0.0',
      evidenceClass: 'runtime_attested_provider_output',
      operation: 'procedure_embedding',
      requestId,
      requestFingerprint: sha('c'),
      queryContentSha256: sha('d'),
      corpusContentSha256: sha('e'),
      inputBatchContentSha256: sha('1'),
      outputContentSha256: sha('2'),
      treatment: runtimeTreatment,
      occurredAt: '2026-08-19T08:00:01Z',
    },
  },
  hits: [
    {
      rank: 1,
      tree: {
        sequence: 1,
        treeId: tree.id,
        revision: tree.revision,
        title: tree.title,
        adapterId: tree.adapterId,
        actionCatalogVersion: tree.actionCatalogVersion,
        interactionCatalogVersion: tree.interactionCatalogVersion,
        hostVersionRange: tree.hostVersionRange,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: sha('3'),
        },
        storedAt: '2026-08-18T08:00:00Z',
      },
      nodePath: [
        {
          id: String(leaf['id']),
          kind: 'leaf',
          order: Number(leaf['order']),
          title: String(leaf['title']),
        },
      ],
      leaf,
      documentContentSha256: sha('4'),
      cosineSimilarity: 0.91,
    },
  ],
  matching: 'embedding_cosine_similarity',
  embeddingProviderCalled: true,
  semanticRecallPerformed: true,
  similarityScoreProduced: true,
  ragContextProduced: true,
  procedureStored: false,
  proposalCreated: false,
  hostExecutionStarted: false,
  completedAt: '2026-08-19T08:00:01Z',
  durationMs: 100,
} as const;

describe('public Procedure semantic retrieval JSON Schemas', () => {
  it('lists unique provider disclosures and binds availability to descriptors', async () => {
    const list = {
      formatVersion: '1.0.0',
      semanticRetrievalAvailable: true,
      providers: [providerDisclosure],
    } as const;
    const cases = [
      { value: list, accepted: true },
      { value: { ...list, semanticRetrievalAvailable: false }, accepted: false },
      { value: { ...list, providers: [providerDisclosure, providerDisclosure] }, accepted: false },
      {
        value: {
          ...list,
          providers: [
            {
              ...providerDisclosure,
              runtimeTreatment: {
                ...runtimeTreatment,
                treatment: {
                  ...runtimeTreatment.treatment,
                  profile: {
                    ...runtimeTreatment.treatment.profile,
                    descriptor: { ...providerDescriptor, id: 'different-provider' },
                  },
                },
              },
            },
          ],
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(
        procedureSemanticRetrievalProviderDisclosureListSchema.safeParse(contractCase.value)
          .success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-provider-disclosure-list.schema.json'),
      cases.slice(0, 3),
    );
  });

  it('requires an available provider snapshot and explicit data/cost disclosure', async () => {
    const cases = [
      { value: request, accepted: true },
      { value: { ...request, query: ' '.repeat(5) }, accepted: false },
      { value: { ...request, query: 'x'.repeat(10_001) }, accepted: false },
      {
        value: {
          ...request,
          providerDisclosure: {
            ...providerDisclosure,
            providerDescriptor: {
              ...providerDescriptor,
              availability: {
                available: false,
                reason: 'temporarily_unavailable',
                message: 'Unavailable.',
              },
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          authorization: { ...request.authorization, possibleProviderCostAcknowledged: false },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          authorization: {
            ...request.authorization,
            disclosure: { ...request.authorization.disclosure, costPolicyDisclosed: false },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          providerDisclosure: {
            ...providerDisclosure,
            runtimeTreatment: {
              ...runtimeTreatment,
              costPolicy: { ...costPolicy, publicStatement: '   ' },
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          providerDisclosure: {
            ...providerDisclosure,
            runtimeTreatment: {
              ...runtimeTreatment,
              treatment: {
                ...runtimeTreatment.treatment,
                profile: {
                  ...runtimeTreatment.treatment.profile,
                  descriptor: { ...providerDescriptor, id: 'different-provider' },
                },
              },
            },
          },
        },
        accepted: false,
      },
      { value: { ...request, retrieval: { topK: 101, minScore: 0 } }, accepted: false },
      { value: { ...request, retrieval: { topK: 5, minScore: 1.1 } }, accepted: false },
    ] as const;

    for (const contractCase of cases) {
      expect(procedureSemanticRetrievalRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-request.schema.json'),
      cases.filter((_contractCase, index) => index !== 7),
    );
  });

  it('exposes ranked leaf documents and runtime evidence without vectors', async () => {
    const structuralCases = [
      { value: result, accepted: true },
      {
        value: { ...result, corpus: { ...result.corpus, documentCount: 257 } },
        accepted: false,
      },
      {
        value: { ...result, corpus: { ...result.corpus, vectorDimension: 4_097 } },
        accepted: false,
      },
      {
        value: { ...result, hits: [{ ...result.hits[0], cosineSimilarity: -1.01 }] },
        accepted: false,
      },
      { value: { ...result, vectors: [[0.1, 0.2]] }, accepted: false },
    ] as const;
    for (const contractCase of structuralCases) {
      expect(procedureSemanticRetrievalResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-result.schema.json'),
      structuralCases,
    );

    expect(
      procedureSemanticRetrievalResultSchema.safeParse({
        ...result,
        hits: [],
        ragContextProduced: false,
      }).success,
    ).toBe(true);
    expect(
      procedureSemanticRetrievalResultSchema.safeParse({ ...result, ragContextProduced: false })
        .success,
    ).toBe(false);
    expect(
      procedureSemanticRetrievalResultSchema.safeParse({
        ...result,
        hits: [result.hits[0], { ...result.hits[0], rank: 1 }],
      }).success,
    ).toBe(false);
  });

  it('keeps query text out of evidence and binds the exact corpus, batch, and result', async () => {
    const completed = {
      formatVersion: '1.0.0',
      requestId,
      requestFingerprint: sha('c'),
      queryContentSha256: sha('d'),
      providerId: providerDescriptor.id,
      providerVersion: providerDescriptor.version,
      providerDescriptor,
      providerDescriptorContentSha256: sha('f'),
      corpusContentSha256: sha('e'),
      inputBatchContentSha256: sha('1'),
      effectiveFilters: { validationStatus: 'candidate' },
      retrieval: request.retrieval,
      authorizationContentSha256: sha('5'),
      runtimeTreatment,
      resultContentSha256: sha('6'),
      result,
      occurredAt: result.completedAt,
    } as const;
    expect(procedureSemanticRetrievalCompletedEventSchema.safeParse(completed).success).toBe(true);
    expect('query' in completed).toBe(false);
    expect(
      procedureSemanticRetrievalCompletedEventSchema.safeParse({
        ...completed,
        inputBatchContentSha256: sha('9'),
      }).success,
    ).toBe(false);
    expect(
      procedureSemanticRetrievalCompletedEventSchema.safeParse({
        ...completed,
        providerDescriptor: {
          ...providerDescriptor,
          description: 'A different provider snapshot.',
        },
      }).success,
    ).toBe(false);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-completed-event.schema.json'),
      [
        { value: completed, accepted: true },
        { value: { ...completed, query: request.query }, accepted: false },
      ],
    );

    const { resultContentSha256: _resultHash, result: _result, ...requested } = completed;
    void _resultHash;
    void _result;
    const failed = {
      ...requested,
      error: {
        code: 'semantic_retrieval_embedding_failed',
        message: 'Embedding provider failed.',
        retryable: true,
      },
    } as const;
    expect(procedureSemanticRetrievalRequestedEventSchema.safeParse(requested).success).toBe(true);
    expect(procedureSemanticRetrievalFailedEventSchema.safeParse(failed).success).toBe(true);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-requested-event.schema.json'),
      [
        { value: requested, accepted: true },
        { value: { ...requested, query: request.query }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-semantic-retrieval-failed-event.schema.json'),
      [
        { value: failed, accepted: true },
        {
          value: { ...failed, error: { ...failed.error, code: 'provider_failed' } },
          accepted: false,
        },
      ],
    );
    expect(
      plannerGenerationErrorCodeSchema.safeParse('planner_procedure_embedding_not_supported')
        .success,
    ).toBe(true);
  });
});
