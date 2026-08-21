import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeProcedureTutorialAuthoringBindingContentSha256,
  procedureTutorialMediaAuthoringBindingSchema,
  procedureTutorialMediaAuthoringCurrentRunStatusSchema,
  procedureTutorialMediaAuthoringLegacyBindingSchema,
  procedureTutorialMediaAuthoringLegacyRunStatusSchema,
  procedureTutorialMediaAuthoringResumeRequestSchema,
  procedureTutorialMediaAuthoringReviewRequestSchema,
  procedureTutorialMediaAuthoringRunCreateRequestSchema,
  procedureTutorialMediaAuthoringRunStatusRequestSchema,
  procedureTutorialMediaAuthoringRunStatusSchema,
  procedureZeroBaselineRefinementRequestSchema,
  procedureZeroBaselineRefinementStatusSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const sha = (character: string) => character.repeat(64);

function publicSchema(filename: string): object {
  return JSON.parse(
    readFileSync(
      resolve(process.env['OPERATINGLINE_SCHEMA_DIR'] ?? 'protocol/schemas/v1', filename),
      'utf8',
    ),
  ) as object;
}

const descriptor = {
  contractVersion: '1.0.0',
  id: 'provider.example',
  version: '1.0.0',
  displayName: 'Example Provider',
  description: 'Public contract fixture Provider.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'remote',
    dataTransmission: 'provider_managed',
    credentialManagement: 'provider_managed',
  },
} as const;

const zeroRefinementRequest = {
  formatVersion: '1.0.0',
  workflowId: '11111111-1111-4111-8111-111111111111',
  generationRequest: {
    formatVersion: '1.0.0',
    requestId: '44444444-4444-4444-8444-444444444444',
    targetAdapterId: 'blender',
    actionCatalogVersion: '1.0.0',
    interactionCatalogVersion: '1.0.0',
    goal: 'Create and refine a candidate eye.',
    locale: 'en',
    authorization: {
      providerDescriptor: descriptor,
      explicitlyConfirmedByUser: true,
      goalAndCatalogContextTransmissionAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      confirmedAt: '2026-08-21T08:00:00Z',
    },
  },
  authorization: {
    explicitlyConfirmedByUser: true,
    candidateOnlyUntilExactReviewAcknowledged: true,
    noHostExecutionAcknowledged: true,
    confirmedAt: '2026-08-21T08:01:00Z',
  },
} as const;

describe('first-wave B public JSON Schemas', () => {
  it('publishes only strict media-authoring lifecycle request/status boundaries', async () => {
    const mediaSource = {
      kind: 'authorized_youtube_download' as const,
      videoId: 'abcdefghijk',
      sourceIdentitySha256: sha('0'),
      contentSha256: sha('1'),
      rightsBasis: 'rights_holder_permission' as const,
      platformDownloadValidation: {
        authorityId: 'youtube-platform-authority-fixture',
        authorityKind: 'youtube_platform_authority' as const,
        sideEffect: 'youtube_media_download' as const,
        receiptContentSha256: sha('2'),
        authorityContentSha256: sha('3'),
      },
      rightsValidation: {
        authorityId: 'rights-authority-fixture',
        authorityKind: 'media_rights_authority' as const,
        sideEffect: 'rights_validation' as const,
        receiptContentSha256: sha('4'),
        authorityContentSha256: sha('5'),
      },
    };
    const statusRequest = {
      formatVersion: '1.1.0',
      requestId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
    } as const;
    const resumeRequest = {
      ...statusRequest,
      recoveryId: '33333333-3333-4333-8333-333333333333',
      retryFromStage: 'materialization',
    } as const;
    const reviewRequest = {
      ...statusRequest,
      reviewId: '44444444-4444-4444-8444-444444444444',
      review: { decision: 'discard', reason: 'The candidate needs a new run.' },
      reviewedAt: '2026-08-21T08:02:00Z',
    } as const;
    const acceptedStatus = {
      formatVersion: '1.1.0',
      requestId: statusRequest.requestId,
      requestFingerprint: sha('a'),
      runId: statusRequest.runId,
      mediaSource,
      status: 'accepted',
      completedStages: [],
      acceptedAt: '2026-08-21T08:00:00Z',
      updatedAt: '2026-08-21T08:00:00Z',
    } as const;
    const invalidRunningStatus = {
      ...acceptedStatus,
      status: 'running',
      completedStages: [],
      currentStage: 'storage',
      startedAt: acceptedStatus.acceptedAt,
    } as const;
    const invalidRecoveryStatus = {
      ...acceptedStatus,
      status: 'recovery_required',
      completedStages: ['provider_generation'],
      recoveryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      retryFromStage: 'storage',
      error: {
        code: 'storage_failed',
        message: 'Storage failed.',
        retryable: false,
        stage: 'materialization',
      },
    } as const;

    expect(procedureTutorialMediaAuthoringRunStatusRequestSchema.parse(statusRequest)).toEqual(
      statusRequest,
    );
    expect(procedureTutorialMediaAuthoringResumeRequestSchema.parse(resumeRequest)).toEqual(
      resumeRequest,
    );
    expect(procedureTutorialMediaAuthoringReviewRequestSchema.parse(reviewRequest)).toEqual(
      reviewRequest,
    );
    expect(procedureTutorialMediaAuthoringRunStatusSchema.parse(acceptedStatus)).toEqual(
      acceptedStatus,
    );
    expect(
      procedureTutorialMediaAuthoringCurrentRunStatusSchema.safeParse(acceptedStatus).success,
    ).toBe(true);
    expect(
      procedureTutorialMediaAuthoringRunStatusSchema.safeParse(invalidRunningStatus).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAuthoringRunStatusSchema.safeParse(invalidRecoveryStatus).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAuthoringRunStatusRequestSchema.safeParse({
        ...statusRequest,
        runId: statusRequest.requestId,
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAuthoringReviewRequestSchema.safeParse({
        ...reviewRequest,
        reviewId: reviewRequest.runId,
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAuthoringResumeRequestSchema.safeParse({
        ...resumeRequest,
        recoveryId: resumeRequest.requestId,
      }).success,
    ).toBe(false);
    void procedureTutorialMediaAuthoringRunCreateRequestSchema;

    const bindingContent = {
      formatVersion: '1.1.0',
      requestId: statusRequest.requestId,
      requestFingerprint: sha('1'),
      runId: statusRequest.runId,
      source: {
        kind: 'verified_media_authoring_preparation',
        analysisRequestId: '55555555-5555-4555-8555-555555555555',
        analysisJobId: '66666666-6666-4666-8666-666666666666',
        analysisFingerprint: sha('2'),
        preparationFingerprint: sha('3'),
        packetContentSha256: sha('4'),
        mediaSource,
      },
      generation: {
        requestId: '77777777-7777-4777-8777-777777777777',
        generationId: '88888888-8888-4888-8888-888888888888',
        providerId: descriptor.id,
        providerVersion: descriptor.version,
        completedEventId: 'procedure-authoring-generation-completed:fixture',
        completedEventContentSha256: sha('5'),
        candidateTreeContentSha256: sha('6'),
      },
      materialization: {
        formatVersion: '1.0.0',
        packetContentSha256: sha('4'),
        inputTreeContentSha256: sha('6'),
        outputTreeContentSha256: sha('7'),
        catalogBinding: {
          adapterId: 'blender',
          actionCatalogVersion: '1.0.0',
          interactionCatalogVersion: '1.0.0',
          interactionCatalogContentSha256: sha('8'),
        },
        coverage: [
          {
            leafId: 'leaf.eye',
            recipeId: 'recipe.eye',
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
        reviewId: '99999999-9999-4999-8999-999999999999',
        reviewedAt: '2026-08-21T08:02:00Z',
        preparationFingerprint: sha('3'),
        packetContentSha256: sha('4'),
        candidateTreeContentSha256: sha('6'),
        materializedTreeContentSha256: sha('7'),
      },
      storage: { treeId: 'tutorial.eye', revision: 1, contentSha256: sha('7') },
    } as const;
    const binding = {
      ...bindingContent,
      integrity: {
        algorithm: 'sha256' as const,
        canonicalization: 'operatingline-json-value-v1' as const,
        contentSha256: computeProcedureTutorialAuthoringBindingContentSha256(bindingContent),
      },
    } as const;
    expect(procedureTutorialMediaAuthoringBindingSchema.parse(binding)).toEqual(binding);

    const legacyAcceptedStatus = {
      formatVersion: '1.0.0',
      requestId: acceptedStatus.requestId,
      requestFingerprint: acceptedStatus.requestFingerprint,
      runId: acceptedStatus.runId,
      status: acceptedStatus.status,
      completedStages: acceptedStatus.completedStages,
      acceptedAt: acceptedStatus.acceptedAt,
      updatedAt: acceptedStatus.updatedAt,
    } as const;
    const legacyBindingFields = {
      ...bindingContent,
      formatVersion: '1.0.0',
      source: {
        kind: binding.source.kind,
        analysisRequestId: binding.source.analysisRequestId,
        analysisJobId: binding.source.analysisJobId,
        analysisFingerprint: binding.source.analysisFingerprint,
        preparationFingerprint: binding.source.preparationFingerprint,
        packetContentSha256: binding.source.packetContentSha256,
      },
    } as const;
    const legacyBinding = {
      ...legacyBindingFields,
      integrity: {
        algorithm: 'sha256' as const,
        canonicalization: 'operatingline-json-value-v1' as const,
        contentSha256: computeProcedureTutorialAuthoringBindingContentSha256(legacyBindingFields),
      },
    } as const;
    expect(
      procedureTutorialMediaAuthoringLegacyRunStatusSchema.parse(legacyAcceptedStatus),
    ).toEqual(legacyAcceptedStatus);
    expect(procedureTutorialMediaAuthoringLegacyBindingSchema.parse(legacyBinding)).toEqual(
      legacyBinding,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-run-status-request.schema.json'),
      [
        { value: statusRequest, accepted: true },
        { value: { ...statusRequest, stage: 'internal' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-resume-request.schema.json'),
      [
        { value: resumeRequest, accepted: true },
        { value: { ...resumeRequest, retryFromStage: 'provider_generation' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-review-request.schema.json'),
      [
        { value: reviewRequest, accepted: true },
        { value: { ...reviewRequest, providerToken: 'forbidden' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-run-status.schema.json'),
      [
        { value: acceptedStatus, accepted: true },
        { value: legacyAcceptedStatus, accepted: false },
        { value: { ...acceptedStatus, completedStages: ['storage'] }, accepted: false },
        { value: invalidRunningStatus, accepted: false },
        { value: invalidRecoveryStatus, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-binding.schema.json'),
      [
        { value: binding, accepted: true },
        {
          value: { ...binding, storage: { ...binding.storage, revision: 0 } },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-run-create-request.schema.json'),
      [
        { value: {}, accepted: false },
        { value: { formatVersion: '1.0.0', accessToken: 'forbidden' }, accepted: false },
      ],
    );
  });

  it('keeps the legacy zero-baseline request alias on the staged create contract', async () => {
    expect(procedureZeroBaselineRefinementRequestSchema.parse(zeroRefinementRequest)).toEqual(
      zeroRefinementRequest,
    );
    void procedureZeroBaselineRefinementStatusSchema;
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-zero-baseline-refinement-request.schema.json'),
      [
        { value: zeroRefinementRequest, accepted: true },
        {
          value: {
            ...zeroRefinementRequest,
            authorization: {
              ...zeroRefinementRequest.authorization,
              candidateOnlyUntilExactReviewAcknowledged: false,
            },
          },
          accepted: false,
        },
        { value: { ...zeroRefinementRequest, exactCandidateTreeDisclosed: true }, accepted: false },
      ],
    );
    expect(
      procedureZeroBaselineRefinementRequestSchema.safeParse({
        ...zeroRefinementRequest,
        exactCandidateTreeDisclosed: true,
      }).success,
    ).toBe(false);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-zero-baseline-refinement-status.schema.json'),
      [
        { value: {}, accepted: false },
        {
          value: {
            formatVersion: '1.0.0',
            workflowId: zeroRefinementRequest.workflowId,
            procedureStored: true,
          },
          accepted: false,
        },
      ],
    );
  });
});
