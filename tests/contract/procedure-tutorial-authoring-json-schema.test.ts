import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeProcedureTutorialAuthoringBindingContentSha256,
  canonicalizeProtocolJsonValue,
  procedureTutorialAuthoringBindingSchema,
  procedureTutorialAuthoringDiscardedEventSchema,
  procedureTutorialAuthoringFailedEventSchema,
  procedureTutorialAuthoringResumeRequestSchema,
  procedureTutorialAuthoringReviewRequestSchema,
  procedureTutorialAuthoringRunCreateRequestSchema,
  procedureTutorialAuthoringRunStatusRequestSchema,
  procedureTutorialAuthoringRunStatusSchema,
  procedureTutorialAuthoringStageEventSchema,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  import: '22222222-2222-4222-8222-222222222222',
  selection: '33333333-3333-4333-8333-333333333333',
  generationRequest: '44444444-4444-4444-8444-444444444444',
  run: '55555555-5555-4555-8555-555555555555',
  generation: '66666666-6666-4666-8666-666666666666',
  reviewRequest: '77777777-7777-4777-8777-777777777777',
  review: '88888888-8888-4888-8888-888888888888',
  recovery: '99999999-9999-4999-8999-999999999999',
} as const;

const providerDescriptor = {
  contractVersion: '1.0.0',
  id: 'provider.example',
  version: '1.0.0',
  displayName: 'Example Provider',
  description: 'Contract-test Procedure authoring provider.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const;

const createRequest = {
  formatVersion: '1.0.0',
  requestId: ids.request,
  source: {
    kind: 'selected_youtube_caption',
    captionImport: {
      formatVersion: '1.1.0',
      requestId: ids.import,
      selectionRequestId: ids.selection,
      targetAdapterId: 'blender',
      actionCatalogVersion: '1.0.0',
      interactionCatalogVersion: '1.0.0',
      goal: 'Create a sphere from the selected tutorial caption.',
      treeId: 'tutorial.sphere',
      revision: 1,
      locale: 'en',
      youtube: {
        videoId: 'dQw4w9WgXcQ',
        captionTrackId: 'caption-track-en',
        requestedFormat: 'srt',
        expectedTrackLanguage: 'en',
        defaultConfidence: 0.9,
        rightsStatus: 'permission_granted',
        authorization: {
          networkFetchApproved: true,
          quotaCostAcknowledged: true,
          videoEditPermissionExpected: true,
        },
      },
    },
  },
  provider: {
    generationRequestId: ids.generationRequest,
    authorization: {
      providerDescriptor,
      explicitlyConfirmedByUser: true,
      dataHandlingAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      confirmedAt: '2026-08-19T08:00:00Z',
    },
  },
} as const;

const packetHash = 'a'.repeat(64);
const candidateHash = 'b'.repeat(64);
const materializedHash = 'c'.repeat(64);

function validBinding() {
  const content = {
    formatVersion: '1.0.0',
    requestId: ids.request,
    requestFingerprint: 'd'.repeat(64),
    runId: ids.run,
    source: {
      kind: 'selected_youtube_caption',
      captionImportRequestId: ids.import,
      captionImportRequestFingerprint: 'e'.repeat(64),
      selectionRequestId: ids.selection,
      selectionRequestFingerprint: 'f'.repeat(64),
      videoId: 'dQw4w9WgXcQ',
      captionTrackId: 'caption-track-en',
      packetContentSha256: packetHash,
    },
    generation: {
      requestId: ids.generationRequest,
      requestFingerprint: '0'.repeat(64),
      generationId: ids.generation,
      providerId: 'provider.example',
      providerVersion: '1.0.0',
      providerDescriptorContentSha256: '2'.repeat(64),
      completedEventId: `procedure-authoring-generation-completed:${ids.generationRequest}`,
      completedEventContentSha256: '3'.repeat(64),
      candidateTreeContentSha256: candidateHash,
    },
    materialization: {
      formatVersion: '1.0.0',
      packetContentSha256: packetHash,
      inputTreeContentSha256: candidateHash,
      outputTreeContentSha256: materializedHash,
      catalogBinding: {
        adapterId: 'blender',
        actionCatalogVersion: '1.0.0',
        interactionCatalogVersion: '1.0.0',
        interactionCatalogContentSha256: '1'.repeat(64),
      },
      coverage: [
        {
          leafId: 'leaf.sphere',
          recipeId: 'recipe.sphere',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ],
      validation: {
        packetIntegrity: 'validated',
        installedCatalogBinding: 'validated',
        authoringCandidateContract: 'validated',
        procedureCompilation: 'validated',
        interactionGrounding: 'validated_against_installed_interaction_catalog',
      },
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    review: {
      requestId: ids.request,
      reviewId: ids.review,
      packetContentSha256: packetHash,
      candidateTreeContentSha256: candidateHash,
      materializedTreeContentSha256: materializedHash,
      reviewedAt: '2026-08-19T08:05:00Z',
    },
    storage: {
      treeId: 'tutorial.sphere',
      revision: 1,
      contentSha256: materializedHash,
    },
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: computeProcedureTutorialAuthoringBindingContentSha256(content),
    },
  } as const;
}

describe('public Procedure tutorial authoring run JSON Schemas', () => {
  it('accepts only the exact selected-caption create request and distinct lifecycle ids', async () => {
    const structuralCases = [
      { value: createRequest, accepted: true },
      { value: { ...createRequest, accessToken: 'forbidden' }, accepted: false },
      {
        value: {
          ...createRequest,
          provider: {
            ...createRequest.provider,
            authorization: {
              ...createRequest.provider.authorization,
              possibleProviderCostAcknowledged: false,
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...createRequest,
          provider: {
            ...createRequest.provider,
            authorization: {
              ...createRequest.provider.authorization,
              providerDescriptor: {
                ...createRequest.provider.authorization.providerDescriptor,
                availability: {
                  available: false,
                  reason: 'temporarily_unavailable',
                  message: 'Unavailable for contract test.',
                },
              },
            },
          },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of structuralCases) {
      expect(
        procedureTutorialAuthoringRunCreateRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    expect(
      procedureTutorialAuthoringRunCreateRequestSchema.safeParse({
        ...createRequest,
        requestId: ids.import,
      }).success,
    ).toBe(false);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-authoring-run-create-request.schema.json'),
      structuralCases,
    );
  });

  it('publishes strict status-query, review, resume, and canonical status shapes', async () => {
    const statusRequest = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: ids.run,
    } as const;
    const reviewRequest = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: ids.run,
      reviewId: ids.review,
      review: {
        decision: 'store',
        packetContentSha256: packetHash,
        candidateTreeContentSha256: candidateHash,
        materializedTreeContentSha256: materializedHash,
        confirmations: {
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: '2026-08-19T08:05:00Z',
    } as const;
    const resumeRequest = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: ids.run,
      recoveryId: ids.recovery,
      retryFromStage: 'storage',
    } as const;
    const accepted = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      requestFingerprint: 'd'.repeat(64),
      runId: ids.run,
      status: 'accepted',
      completedStages: [],
      acceptedAt: '2026-08-19T08:00:01Z',
      updatedAt: '2026-08-19T08:00:01Z',
    } as const;
    const nonCanonicalRunning = {
      ...accepted,
      status: 'running',
      currentStage: 'provider_generation',
      completedStages: ['storage'],
      startedAt: accepted.acceptedAt,
    } as const;

    expect(procedureTutorialAuthoringRunStatusRequestSchema.safeParse(statusRequest).success).toBe(
      true,
    );
    expect(procedureTutorialAuthoringReviewRequestSchema.safeParse(reviewRequest).success).toBe(
      true,
    );
    expect(procedureTutorialAuthoringResumeRequestSchema.safeParse(resumeRequest).success).toBe(
      true,
    );
    expect(procedureTutorialAuthoringRunStatusSchema.safeParse(accepted).success).toBe(true);
    expect(procedureTutorialAuthoringRunStatusSchema.safeParse(nonCanonicalRunning).success).toBe(
      false,
    );

    await Promise.all([
      validatePublicJsonSchemaCases(
        publicSchema('procedure-tutorial-authoring-run-status-request.schema.json'),
        [
          { value: statusRequest, accepted: true },
          { value: { ...statusRequest, extra: true }, accepted: false },
        ],
      ),
      validatePublicJsonSchemaCases(
        publicSchema('procedure-tutorial-authoring-review-request.schema.json'),
        [
          { value: reviewRequest, accepted: true },
          { value: { ...reviewRequest, extra: true }, accepted: false },
        ],
      ),
      validatePublicJsonSchemaCases(
        publicSchema('procedure-tutorial-authoring-resume-request.schema.json'),
        [
          { value: resumeRequest, accepted: true },
          { value: { ...resumeRequest, retryFromStage: 'provider_generation' }, accepted: false },
        ],
      ),
      validatePublicJsonSchemaCases(
        publicSchema('procedure-tutorial-authoring-run-status.schema.json'),
        [
          { value: accepted, accepted: true },
          { value: nonCanonicalRunning, accepted: false },
          {
            value: {
              ...accepted,
              status: 'recovery_required',
              recoveryId: ids.recovery,
              retryFromStage: 'materialization',
              completedStages: ['caption_import', 'provider_generation'],
              error: {
                code: 'authoring_local_recovery_required',
                message: 'Recovery is required.',
                retryable: true,
                stage: 'storage',
              },
            },
            accepted: false,
          },
          { value: { ...accepted, extra: true }, accepted: false },
        ],
      ),
    ]);
  });

  it('rejects lifecycle events whose workflow and run identities collapse', () => {
    const scope = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      requestFingerprint: 'd'.repeat(64),
      runId: ids.request,
      occurredAt: '2026-08-19T08:00:01Z',
    } as const;
    expect(
      procedureTutorialAuthoringStageEventSchema.safeParse({
        ...scope,
        stage: 'caption_import',
        state: 'started',
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialAuthoringFailedEventSchema.safeParse({
        ...scope,
        completedStages: [],
        error: {
          code: 'authoring_stage_failed',
          message: 'The stage failed.',
          retryable: false,
          stage: 'caption_import',
        },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialAuthoringDiscardedEventSchema.safeParse({
        ...scope,
        reviewId: ids.review,
        discardedAt: scope.occurredAt,
      }).success,
    ).toBe(false);
  });

  it('self-binds source, generation, materialization, review, and storage evidence', async () => {
    const binding = validBinding();
    const { integrity: _integrity, ...content } = binding;
    void _integrity;
    expect(binding.integrity.contentSha256).toBe(
      createHash('sha256').update(canonicalizeProtocolJsonValue(content)).digest('hex'),
    );
    expect(procedureTutorialAuthoringBindingSchema.safeParse(binding).success).toBe(true);
    expect(
      procedureTutorialAuthoringBindingSchema.safeParse({
        ...binding,
        storage: { ...binding.storage, contentSha256: '9'.repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialAuthoringBindingSchema.safeParse({
        ...binding,
        source: { ...binding.source, selectionRequestId: ids.import },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialAuthoringBindingSchema.safeParse({
        ...binding,
        review: { ...binding.review, reviewedAt: '2026-08-19T08:06:00Z' },
      }).success,
    ).toBe(false);

    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-authoring-binding.schema.json'),
      [
        { value: binding, accepted: true },
        { value: { ...binding, storageRecord: {} }, accepted: false },
      ],
    );
  });
});
