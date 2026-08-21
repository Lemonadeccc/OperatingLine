import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  procedureTutorialMediaAuthoringBindingSchema,
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
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
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
    const statusRequest = {
      formatVersion: '1.0.0',
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
      formatVersion: '1.0.0',
      requestId: statusRequest.requestId,
      requestFingerprint: sha('a'),
      runId: statusRequest.runId,
      status: 'accepted',
      completedStages: [],
      acceptedAt: '2026-08-21T08:00:00Z',
      updatedAt: '2026-08-21T08:00:00Z',
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

    const binding = {
      formatVersion: '1.0.0',
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
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: sha('9'),
      },
    } as const;
    void procedureTutorialMediaAuthoringBindingSchema;

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
        { value: { ...acceptedStatus, completedStages: ['storage'] }, accepted: false },
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
