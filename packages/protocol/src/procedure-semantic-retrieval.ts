import { z } from 'zod';

import { canonicalizeProtocolJsonValue } from './canonical-json-value.js';
import { evalContentSha256Schema } from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import {
  procedureLeafNodeSchema,
  procedureTreeSummarySchema,
  procedureValidationSchema,
} from './procedure-tree.js';
import {
  plannerProviderDescriptorSchema,
  plannerProviderCostPolicySchema,
  plannerProviderIdSchema,
  plannerProviderRuntimeTreatmentSchema,
} from './provider.js';
import { catalogVersionSchema } from './version.js';

export const procedureSemanticRetrievalFormatVersion = '1.0.0' as const;
export const procedureSemanticRetrievalFormatVersionSchema = z.literal(
  procedureSemanticRetrievalFormatVersion,
);

const timestampSchema = z.iso.datetime({ offset: true });
const availableProviderDescriptorSchema = plannerProviderDescriptorSchema.extend({
  availability: z.strictObject({ available: z.literal(true) }),
});

export const procedureSemanticRetrievalFiltersSchema = z.strictObject({
  adapterId: z.string().trim().min(1).max(256).optional(),
  actionCatalogVersion: catalogVersionSchema.optional(),
  interactionCatalogVersion: catalogVersionSchema.optional(),
  validationStatus: procedureValidationSchema.shape.status.optional(),
});
export type ProcedureSemanticRetrievalFilters = z.infer<
  typeof procedureSemanticRetrievalFiltersSchema
>;

export const procedureSemanticRetrievalEffectiveFiltersSchema = z.strictObject({
  adapterId: z.string().trim().min(1).max(256).optional(),
  actionCatalogVersion: catalogVersionSchema.optional(),
  interactionCatalogVersion: catalogVersionSchema.optional(),
  validationStatus: procedureValidationSchema.shape.status,
});
export type ProcedureSemanticRetrievalEffectiveFilters = z.infer<
  typeof procedureSemanticRetrievalEffectiveFiltersSchema
>;

export const procedureSemanticRetrievalCorpusSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^\S(?:.*\S)?$/),
  version: catalogVersionSchema,
  contentSha256: evalContentSha256Schema,
  documentCount: z.number().int().min(1).max(256),
  vectorDimension: z.number().int().min(1).max(4_096),
});
export type ProcedureSemanticRetrievalCorpus = z.infer<
  typeof procedureSemanticRetrievalCorpusSchema
>;

export const procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema = z.strictObject({
  formatVersion: procedureSemanticRetrievalFormatVersionSchema,
  evidenceClass: z.literal('runtime_attested_provider_treatment'),
  operation: z.literal('procedure_embedding'),
  treatment: plannerProviderRuntimeTreatmentSchema,
  costPolicy: plannerProviderCostPolicySchema,
  inputPolicy: z.strictObject({
    documentFormat: z.literal('procedure_leaf_embedding_document_v1'),
    maximumDocumentCount: z.number().int().min(1).max(256),
    sourceEvidenceContentIncluded: z.literal(false),
    vectorsPersistedInProtocol: z.literal(false),
  }),
  treatmentContentSha256: evalContentSha256Schema,
});
export type ProcedureSemanticRetrievalProviderRuntimeTreatmentAttestation = z.infer<
  typeof procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema
>;

export const procedureSemanticRetrievalProviderDisclosureSchema = z
  .strictObject({
    providerDescriptor: plannerProviderDescriptorSchema,
    runtimeTreatment: procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
  })
  .superRefine((disclosure, context) => {
    if (
      !sameProtocolValue(
        disclosure.providerDescriptor,
        disclosure.runtimeTreatment.treatment.profile.descriptor,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeTreatment', 'treatment', 'profile', 'descriptor'],
        message: 'Provider disclosure descriptor must match the runtime treatment profile',
      });
    }
  });
export type ProcedureSemanticRetrievalProviderDisclosure = z.infer<
  typeof procedureSemanticRetrievalProviderDisclosureSchema
>;

export const procedureSemanticRetrievalProviderDisclosureListSchema = z
  .strictObject({
    formatVersion: procedureSemanticRetrievalFormatVersionSchema,
    semanticRetrievalAvailable: z.boolean(),
    providers: z
      .array(procedureSemanticRetrievalProviderDisclosureSchema)
      .meta({ uniqueItems: true }),
  })
  .superRefine((value, context) => {
    const providerIds = value.providers.map((provider) => provider.providerDescriptor.id);
    if (new Set(providerIds).size !== providerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'Procedure semantic retrieval provider ids must be unique',
      });
    }
    const hasAvailableProvider = value.providers.some(
      (provider) => provider.providerDescriptor.availability.available,
    );
    if (value.semanticRetrievalAvailable !== hasAvailableProvider) {
      context.addIssue({
        code: 'custom',
        path: ['semanticRetrievalAvailable'],
        message: 'semanticRetrievalAvailable must match the provider availability list',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            providers: {
              contains: {
                type: 'object',
                properties: {
                  providerDescriptor: {
                    type: 'object',
                    properties: {
                      availability: {
                        type: 'object',
                        properties: { available: { const: true } },
                        required: ['available'],
                      },
                    },
                    required: ['availability'],
                  },
                },
                required: ['providerDescriptor'],
              },
            },
          },
          required: ['providers'],
        },
        then: {
          properties: { semanticRetrievalAvailable: { const: true } },
          required: ['semanticRetrievalAvailable'],
        },
        else: {
          properties: { semanticRetrievalAvailable: { const: false } },
          required: ['semanticRetrievalAvailable'],
        },
      },
    ],
  });
export type ProcedureSemanticRetrievalProviderDisclosureList = z.infer<
  typeof procedureSemanticRetrievalProviderDisclosureListSchema
>;

export const procedureSemanticRetrievalRequestSchema = z
  .strictObject({
    formatVersion: procedureSemanticRetrievalFormatVersionSchema,
    requestId: z.uuid(),
    query: z.string().trim().min(1).max(10_000).regex(/\S/),
    providerDisclosure: z.strictObject({
      providerDescriptor: availableProviderDescriptorSchema,
      runtimeTreatment: procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
    }),
    filters: procedureSemanticRetrievalFiltersSchema.optional(),
    retrieval: z.strictObject({
      topK: z.number().int().min(1).max(100),
      minScore: z.number().min(-1).max(1),
    }),
    authorization: z.strictObject({
      explicitlyConfirmedByUser: z.literal(true),
      dataHandlingAcknowledged: z.literal(true),
      possibleProviderCostAcknowledged: z.literal(true),
      disclosure: z.strictObject({
        providerDescriptorDisclosed: z.literal(true),
        embeddingModelAndRuntimeTreatmentDisclosed: z.literal(true),
        costPolicyDisclosed: z.literal(true),
        querySentToProvider: z.literal(true),
        boundedLeafDocumentSentToProvider: z.literal(true),
        sourceEvidenceContentSentToProvider: z.literal(false),
        documentFormat: z.literal('procedure_leaf_embedding_document_v1'),
      }),
      confirmedAt: timestampSchema,
    }),
  })
  .superRefine((request, context) => {
    if (
      !sameProtocolValue(
        request.providerDisclosure.providerDescriptor,
        request.providerDisclosure.runtimeTreatment.treatment.profile.descriptor,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['providerDisclosure', 'runtimeTreatment', 'treatment', 'profile', 'descriptor'],
        message:
          'Authorized provider descriptor must match the disclosed runtime treatment profile',
      });
    }
  });
export type ProcedureSemanticRetrievalRequest = z.infer<
  typeof procedureSemanticRetrievalRequestSchema
>;

export const procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema = z
  .strictObject({
    formatVersion: procedureSemanticRetrievalFormatVersionSchema,
    evidenceClass: z.literal('runtime_attested_provider_output'),
    operation: z.literal('procedure_embedding'),
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    queryContentSha256: evalContentSha256Schema,
    corpusContentSha256: evalContentSha256Schema,
    inputBatchContentSha256: evalContentSha256Schema,
    outputContentSha256: evalContentSha256Schema,
    treatment: procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
    occurredAt: timestampSchema,
  })
  .superRefine((attestation, context) => {
    if (attestation.operation !== attestation.treatment.operation) {
      context.addIssue({
        code: 'custom',
        path: ['treatment', 'operation'],
        message: 'Embedding output and treatment attestations must describe the same operation',
      });
    }
  });
export type ProcedureSemanticRetrievalProviderRuntimeOutputAttestation = z.infer<
  typeof procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema
>;

export const procedureSemanticRetrievalEmbeddingEvidenceSchema = z
  .strictObject({
    providerDescriptor: availableProviderDescriptorSchema,
    providerDescriptorContentSha256: evalContentSha256Schema,
    model: plannerProviderRuntimeTreatmentSchema.shape.profile.shape.model,
    runtimeEvidence: procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema,
  })
  .superRefine((embedding, context) => {
    const profile = embedding.runtimeEvidence.treatment.treatment.profile;
    if (
      !sameProtocolValue(embedding.providerDescriptor, profile.descriptor) ||
      !sameProtocolValue(embedding.model, profile.model)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeEvidence', 'treatment', 'profile'],
        message: 'Embedding runtime evidence must match the disclosed provider and model',
      });
    }
  });
export type ProcedureSemanticRetrievalEmbeddingEvidence = z.infer<
  typeof procedureSemanticRetrievalEmbeddingEvidenceSchema
>;

export const procedureSemanticRetrievalNodePathItemSchema = z.strictObject({
  id: guideStepIdSchema,
  kind: z.enum(['group', 'leaf']),
  order: z.number().int().positive(),
  title: z.string().min(1),
});

export const procedureSemanticRetrievalHitSchema = z
  .strictObject({
    rank: z.number().int().min(1).max(256),
    tree: procedureTreeSummarySchema,
    nodePath: z.array(procedureSemanticRetrievalNodePathItemSchema).min(1),
    leaf: procedureLeafNodeSchema,
    documentContentSha256: evalContentSha256Schema,
    cosineSimilarity: z.number().min(-1).max(1),
  })
  .superRefine((hit, context) => {
    const finalPathItem = hit.nodePath.at(-1)!;
    if (
      finalPathItem.kind !== 'leaf' ||
      finalPathItem.id !== hit.leaf.id ||
      finalPathItem.title !== hit.leaf.title
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nodePath'],
        message: 'Semantic retrieval node path must terminate at the returned leaf',
      });
    }
    if (hit.leaf.action !== null && hit.leaf.action.adapterId !== hit.tree.adapterId) {
      context.addIssue({
        code: 'custom',
        path: ['leaf', 'action', 'adapterId'],
        message: 'Semantic retrieval leaf action must match the stored tree adapter',
      });
    }
  });
export type ProcedureSemanticRetrievalHit = z.infer<typeof procedureSemanticRetrievalHitSchema>;

export const procedureSemanticRetrievalResultSchema = z
  .strictObject({
    formatVersion: procedureSemanticRetrievalFormatVersionSchema,
    retrievalId: z.uuid(),
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    queryContentSha256: evalContentSha256Schema,
    effectiveFilters: procedureSemanticRetrievalEffectiveFiltersSchema,
    retrieval: procedureSemanticRetrievalRequestSchema.shape.retrieval,
    corpus: procedureSemanticRetrievalCorpusSchema,
    embedding: procedureSemanticRetrievalEmbeddingEvidenceSchema,
    hits: z.array(procedureSemanticRetrievalHitSchema).max(100),
    matching: z.literal('embedding_cosine_similarity'),
    embeddingProviderCalled: z.literal(true),
    semanticRecallPerformed: z.literal(true),
    similarityScoreProduced: z.literal(true),
    ragContextProduced: z.boolean(),
    procedureStored: z.literal(false),
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
    completedAt: timestampSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((result, context) => {
    if (result.retrievalId === result.requestId) {
      context.addIssue({
        code: 'custom',
        path: ['retrievalId'],
        message: 'Service-generated retrieval id must differ from the request id',
      });
    }
    if (result.ragContextProduced !== result.hits.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['ragContextProduced'],
        message: 'RAG context production must match whether retrieval produced any hits',
      });
    }
    if (result.corpus.documentCount < result.hits.length) {
      context.addIssue({
        code: 'custom',
        path: ['corpus', 'documentCount'],
        message: 'Semantic retrieval corpus must contain every returned leaf document',
      });
    }
    if (
      result.corpus.documentCount >
      result.embedding.runtimeEvidence.treatment.inputPolicy.maximumDocumentCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['embedding', 'runtimeEvidence', 'treatment', 'inputPolicy'],
        message: 'Embedding treatment input policy must cover the complete retrieval corpus',
      });
    }
    if (
      result.hits.some(
        (hit) =>
          (result.effectiveFilters.adapterId !== undefined &&
            hit.tree.adapterId !== result.effectiveFilters.adapterId) ||
          (result.effectiveFilters.actionCatalogVersion !== undefined &&
            hit.tree.actionCatalogVersion !== result.effectiveFilters.actionCatalogVersion) ||
          (result.effectiveFilters.interactionCatalogVersion !== undefined &&
            hit.tree.interactionCatalogVersion !==
              result.effectiveFilters.interactionCatalogVersion) ||
          hit.leaf.validation.status !== result.effectiveFilters.validationStatus,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hits'],
        message: 'Semantic retrieval hits must satisfy every effective corpus filter',
      });
    }
    const ranks = result.hits.map((hit) => hit.rank);
    const expectedRanks = result.hits.map((_, index) => index + 1);
    if (ranks.some((rank, index) => rank !== expectedRanks[index])) {
      context.addIssue({
        code: 'custom',
        path: ['hits'],
        message: 'Semantic retrieval hit ranks must be unique and contiguous from one',
      });
    }
    const documents = result.hits.map((hit) => hit.documentContentSha256);
    if (new Set(documents).size !== documents.length) {
      context.addIssue({
        code: 'custom',
        path: ['hits'],
        message: 'Semantic retrieval hits must identify unique leaf documents',
      });
    }
    if (
      result.hits.some(
        (hit, index) =>
          index > 0 && hit.cosineSimilarity > result.hits[index - 1]!.cosineSimilarity,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hits'],
        message: 'Semantic retrieval hits must be ordered by descending cosine similarity',
      });
    }
    const runtime = result.embedding.runtimeEvidence;
    if (
      runtime.requestId !== result.requestId ||
      runtime.requestFingerprint !== result.requestFingerprint ||
      runtime.queryContentSha256 !== result.queryContentSha256 ||
      runtime.corpusContentSha256 !== result.corpus.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['embedding', 'runtimeEvidence'],
        message: 'Embedding runtime evidence must bind the request, query, and corpus',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { hits: { minItems: 1 } }, required: ['hits'] },
        then: {
          properties: { ragContextProduced: { const: true } },
          required: ['ragContextProduced'],
        },
        else: {
          properties: { ragContextProduced: { const: false } },
          required: ['ragContextProduced'],
        },
      },
    ],
  });
export type ProcedureSemanticRetrievalResult = z.infer<
  typeof procedureSemanticRetrievalResultSchema
>;

const procedureSemanticRetrievalEvidenceScopeSchema = z.strictObject({
  formatVersion: procedureSemanticRetrievalFormatVersionSchema,
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  queryContentSha256: evalContentSha256Schema,
  providerId: plannerProviderIdSchema,
  providerVersion: catalogVersionSchema,
  providerDescriptor: availableProviderDescriptorSchema,
  providerDescriptorContentSha256: evalContentSha256Schema,
  corpusContentSha256: evalContentSha256Schema,
  inputBatchContentSha256: evalContentSha256Schema,
  effectiveFilters: procedureSemanticRetrievalEffectiveFiltersSchema,
  retrieval: procedureSemanticRetrievalRequestSchema.shape.retrieval,
  authorizationContentSha256: evalContentSha256Schema,
  runtimeTreatment: procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
});

export const procedureSemanticRetrievalRequestedEventSchema =
  procedureSemanticRetrievalEvidenceScopeSchema.extend({
    occurredAt: timestampSchema,
  });
export type ProcedureSemanticRetrievalRequestedEvent = z.infer<
  typeof procedureSemanticRetrievalRequestedEventSchema
>;

export const procedureSemanticRetrievalCompletedEventSchema = z
  .strictObject({
    ...procedureSemanticRetrievalEvidenceScopeSchema.shape,
    resultContentSha256: evalContentSha256Schema,
    result: procedureSemanticRetrievalResultSchema,
    occurredAt: timestampSchema,
  })
  .superRefine((event, context) => {
    const result = event.result;
    if (
      result.requestId !== event.requestId ||
      result.requestFingerprint !== event.requestFingerprint ||
      result.queryContentSha256 !== event.queryContentSha256 ||
      result.corpus.contentSha256 !== event.corpusContentSha256 ||
      result.embedding.providerDescriptor.id !== event.providerId ||
      result.embedding.providerDescriptor.version !== event.providerVersion ||
      !sameProtocolValue(result.embedding.providerDescriptor, event.providerDescriptor) ||
      result.embedding.providerDescriptorContentSha256 !== event.providerDescriptorContentSha256 ||
      result.embedding.runtimeEvidence.inputBatchContentSha256 !== event.inputBatchContentSha256 ||
      !sameProtocolValue(result.embedding.runtimeEvidence.treatment, event.runtimeTreatment) ||
      result.retrieval.topK !== event.retrieval.topK ||
      result.retrieval.minScore !== event.retrieval.minScore ||
      !sameProtocolValue(result.effectiveFilters, event.effectiveFilters) ||
      result.hits.length > event.retrieval.topK ||
      result.hits.some((hit) => hit.cosineSimilarity < event.retrieval.minScore) ||
      result.completedAt !== event.occurredAt
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed semantic retrieval evidence must bind the exact request and result',
      });
    }
  });
export type ProcedureSemanticRetrievalCompletedEvent = z.infer<
  typeof procedureSemanticRetrievalCompletedEventSchema
>;

export const procedureSemanticRetrievalErrorCodeSchema = z.enum([
  'semantic_retrieval_provider_not_found',
  'semantic_retrieval_provider_unavailable',
  'semantic_retrieval_not_supported',
  'semantic_retrieval_corpus_unavailable',
  'semantic_retrieval_embedding_failed',
  'semantic_retrieval_output_invalid',
  'semantic_retrieval_conflict',
  'semantic_retrieval_already_attempted',
  'semantic_retrieval_persistence_failed',
  'semantic_retrieval_internal_failed',
]);
export type ProcedureSemanticRetrievalErrorCode = z.infer<
  typeof procedureSemanticRetrievalErrorCodeSchema
>;

export const procedureSemanticRetrievalFailedEventSchema =
  procedureSemanticRetrievalEvidenceScopeSchema.extend({
    error: z.strictObject({
      code: procedureSemanticRetrievalErrorCodeSchema,
      message: z.string().min(1).max(1_000).regex(/\S/),
      retryable: z.boolean(),
    }),
    occurredAt: timestampSchema,
  });
export type ProcedureSemanticRetrievalFailedEvent = z.infer<
  typeof procedureSemanticRetrievalFailedEventSchema
>;

function sameProtocolValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}
