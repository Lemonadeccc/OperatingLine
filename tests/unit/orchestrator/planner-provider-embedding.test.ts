import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  computePlannerProviderAttestationSha256,
  createPlannerProviderRuntimeOutputAttestation,
  snapshotPlannerProviderRuntimeTreatment,
} from '../../../services/orchestrator/src/planner-provider-attestation.js';
import { PlannerGenerationRuntimeError } from '../../../services/orchestrator/src/planner-provider-errors.js';
import { createPlannerProviderInvocationManager } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';

function provider(id: string, embed = false, describe = false): PlannerProvider {
  return {
    descriptor: {
      contractVersion: '1.0.0',
      id,
      version: '0.1.0',
      displayName: `Provider ${id}`,
      description: 'A provider used to verify Procedure embedding capability discovery.',
      availability: { available: true },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
    generate: async () => ({}),
    ...(embed
      ? {
          embedProcedure: async () => ({ vectors: [[0.25, 0.75]] }),
        }
      : {}),
    ...(describe
      ? {
          describeRuntimeTreatment: () => ({
            profile: {
              descriptor: provider(id).descriptor,
              vendor: 'Test',
              implementation: { name: 'test-provider', version: '0.1.0' },
              model: {
                requested: 'embedding-model',
                resolvedRevision: null,
                resolution: 'provider_did_not_disclose',
              },
              api: {
                surface: 'embeddings',
                version: 'v1',
                sdkName: 'test-sdk',
                sdkVersion: '1.0.0',
                endpointClass: 'local',
                serviceTier: null,
                region: null,
              },
            },
            generationSettings: {
              normalizedParameters: { model: 'embedding-model' },
              seed: null,
              determinism: 'deterministic',
            },
            costPolicy: {
              possibleProviderCost: false,
              basis: 'no_provider_cost',
              publicStatement: 'This local test provider does not charge for embedding requests.',
            },
          }),
        }
      : {}),
  };
}

describe('Planner Provider Procedure embedding capability', () => {
  it('finds and lists only providers that explicitly expose embedProcedure', () => {
    const embeddingProvider = provider('embedding-provider', true, true);
    const unattestedEmbeddingProvider = provider('unattested-embedding-provider', true);
    const generationOnlyProvider = provider('generation-only-provider');
    const registry = createPlannerProviderRegistry([
      generationOnlyProvider,
      unattestedEmbeddingProvider,
      embeddingProvider,
    ]);

    expect(registry.findProcedureEmbedder('embedding-provider')?.provider).toBe(embeddingProvider);
    expect(registry.findProcedureEmbedder('generation-only-provider')).toBeNull();
    expect(registry.findProcedureEmbedder('unattested-embedding-provider')).toBeNull();
    expect(registry.listProcedureEmbedders()).toMatchObject({
      generationAvailable: true,
      providers: [{ id: 'embedding-provider' }],
    });
  });

  it('rejects an embedding invocation before attempting a provider without the capability', async () => {
    const registry = createPlannerProviderRegistry([provider('generation-only-provider')]);
    const manager = createPlannerProviderInvocationManager({ registry });
    const attempt = vi.fn();

    const error = await manager
      .execute({
        requestId: 'ac572f80-a4ac-4aa3-b2d2-805bcdfbf9f4',
        providerId: 'generation-only-provider',
        operation: 'procedure_embedding',
        fingerprint: 'a'.repeat(64),
        planKey: ['blender', 'procedure-rag-index'],
        requiresReplan: false,
        requiresProcedureEmbedding: true,
        attempt,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlannerGenerationRuntimeError);
    expect(error).toMatchObject({
      code: 'planner_procedure_embedding_not_supported',
      retryMode: 'same_request_id',
    });
    expect(attempt).not.toHaveBeenCalled();
    await manager.close();
  });

  it('attests the embedding model, parameters, bounded input policy, and exact output', () => {
    const embeddingProvider: PlannerProvider = {
      ...provider('embedding-provider', true),
      describeRuntimeTreatment: (operation) => ({
        profile: {
          descriptor: provider('embedding-provider', true).descriptor,
          vendor: 'Test',
          implementation: { name: 'test-embedding-provider', version: '0.1.0' },
          model: {
            requested: operation === 'procedure_embedding' ? 'embedding-model' : 'response-model',
            resolvedRevision: null,
            resolution: 'provider_did_not_disclose',
          },
          api: {
            surface: operation === 'procedure_embedding' ? 'embeddings' : 'responses',
            version: 'v1',
            sdkName: 'test-sdk',
            sdkVersion: '1.0.0',
            endpointClass: 'local',
            serviceTier: null,
            region: null,
          },
        },
        generationSettings: {
          normalizedParameters: {
            model: 'embedding-model',
            encoding_format: 'float',
          },
          seed: null,
          determinism: 'deterministic',
        },
        costPolicy: {
          possibleProviderCost: false,
          basis: 'no_provider_cost',
          publicStatement: 'This local test provider does not charge for embedding requests.',
        },
      }),
    };
    const treatment = snapshotPlannerProviderRuntimeTreatment(
      embeddingProvider,
      embeddingProvider.descriptor,
      'procedure_embedding',
    );
    expect(treatment).toMatchObject({
      operation: 'procedure_embedding',
      treatment: {
        profile: {
          model: { requested: 'embedding-model' },
          api: { surface: 'embeddings' },
        },
        generationSettings: {
          normalizedParameters: {
            model: 'embedding-model',
            encoding_format: 'float',
          },
        },
      },
      inputPolicy: {
        maximumDocumentCount: 256,
        sourceEvidenceContentIncluded: false,
        vectorsPersistedInProtocol: false,
      },
      costPolicy: {
        possibleProviderCost: false,
        basis: 'no_provider_cost',
      },
      treatmentContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const inputBatch = ['query', 'document'];
    const output = {
      vectors: [
        [1, 0],
        [0.5, 0.5],
      ],
    };
    const outputAttestation = createPlannerProviderRuntimeOutputAttestation({
      operation: 'procedure_embedding',
      requestId: 'e7c2be21-366f-46bb-915d-50eaab94c3bf',
      requestFingerprint: '1'.repeat(64),
      queryContentSha256: '2'.repeat(64),
      corpusContentSha256: '3'.repeat(64),
      inputBatch,
      output,
      treatment,
      occurredAt: '2026-08-19T00:00:00.000Z',
    });
    expect(outputAttestation).toMatchObject({
      operation: 'procedure_embedding',
      inputBatchContentSha256: computePlannerProviderAttestationSha256(inputBatch),
      outputContentSha256: computePlannerProviderAttestationSha256(output),
      treatment,
    });
  });
});
