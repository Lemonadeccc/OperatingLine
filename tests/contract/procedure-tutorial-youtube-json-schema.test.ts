import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialYoutubeImportCompletedEventSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
  procedureTutorialYoutubeTrackRecommendationResultSchema,
  procedureTutorialYoutubeTrackSelectionRequestSchema,
  procedureTutorialYoutubeTrackSelectionResultSchema,
} from '@operatingline/protocol';

import { buildProcedureTutorialYoutubePromptPacket } from '../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
import { recommendProcedureTutorialYoutubeCaptionTracks } from '../../services/orchestrator/src/procedure-tutorial-youtube-track-recommendation.js';
import { buildProcedureTutorialYoutubeTrackSelection } from '../../services/orchestrator/src/procedure-tutorial-youtube-track-selection.js';
import type { ProcedureTutorialYoutubeCaptionAcquisitionResult } from '../../services/orchestrator/src/youtube-caption-source.js';
import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const request = {
  formatVersion: '1.0.0',
  requestId: '985b96b3-e597-4ba6-834a-cbd2d1718416',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: 'Create an eye from an authorized YouTube caption track.',
  treeId: 'contract.youtube.caption.eye',
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
} as const;

const acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult = {
  video: {
    uri: `https://www.youtube.com/watch?v=${request.youtube.videoId}`,
    title: 'Authorized Blender eye tutorial',
    durationMs: 10_000,
  },
  captionDocument: {
    format: 'srt',
    content: '1\n00:00:01,000 --> 00:00:04,000\nAdd a UV sphere.\n',
    locale: 'en',
    acquisition: {
      source: 'youtube_data_api_v3',
      authorization: 'oauth_video_edit_permission',
      videoId: request.youtube.videoId,
      captionTrackId: request.youtube.captionTrackId,
      trackLanguage: 'en',
      trackKind: 'standard',
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
      lastUpdated: '2026-08-18T08:00:00Z',
      requestedFormat: 'srt',
    },
  },
};

const trackListRequest = {
  formatVersion: '1.0.0',
  requestId: '640a1f82-834c-4825-ae1e-12d6f749aa0f',
  youtube: {
    videoId: 'dQw4w9WgXcQ',
    authorization: {
      networkFetchApproved: true,
      quotaCostAcknowledged: true,
      videoEditPermissionExpected: true,
    },
  },
} as const;

const trackListResult = {
  formatVersion: '1.0.0',
  requestId: trackListRequest.requestId,
  source: 'youtube_data_api_v3',
  authorization: 'oauth_video_edit_permission',
  videoId: trackListRequest.youtube.videoId,
  tracks: [
    {
      captionTrackId: 'caption-track-en',
      lastUpdated: '2026-08-18T08:00:00Z',
      trackKind: 'standard',
      language: 'en',
      name: 'English',
      audioTrackType: 'primary',
      isCC: true,
      isLarge: false,
      isEasyReader: false,
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
    },
  ],
  sideEffects: {
    networkFetched: true,
    quotaOperation: 'youtube.captions.list',
    documentedQuotaUnits: 50,
    captionContentDownloaded: false,
    videoMediaDownloaded: false,
    modelCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  listedAt: '2026-08-18T09:00:00Z',
} as const;

const trackRecommendationRequest = {
  formatVersion: '1.0.0',
  requestId: 'dc8f24f0-96f0-45cf-a38c-de4a1b8a8ba7',
  trackListRequestId: trackListRequest.requestId,
  videoId: trackListRequest.youtube.videoId,
  preferences: {
    preferredLanguages: ['en-US'],
    languageMatching: 'primary_subtag_fallback',
    allowUnlistedLanguages: false,
    trackKindPriority: ['standard', 'ASR'],
    audioTrackTypePriority: ['primary'],
    allowDraftTracks: false,
    preferClosedCaptions: true,
    preferManualSync: true,
    explicitSelectionRequired: true,
  },
} as const;

const trackRecommendationResult = recommendProcedureTutorialYoutubeCaptionTracks(
  procedureTutorialYoutubeTrackRecommendationRequestSchema.parse(trackRecommendationRequest),
  procedureTutorialYoutubeTrackListResultSchema.parse(trackListResult),
);

const trackSelectionRequest = {
  formatVersion: '1.0.0',
  requestId: '7ab52d8f-f169-42a7-8f7c-7309b77ee06a',
  trackListRequestId: trackListRequest.requestId,
  videoId: trackListRequest.youtube.videoId,
  captionTrackId: 'caption-track-en',
  confirmation: {
    explicitlyConfirmedByUser: true,
    reason: {
      reasonCode: 'recommended_candidate',
      note: 'LOCAL_SELECTION_NOTE_MUST_NOT_ENTER_PACKET',
    },
  },
  recommendationPreferences: trackRecommendationRequest.preferences,
} as const;

const trackSelectionResult = buildProcedureTutorialYoutubeTrackSelection(
  procedureTutorialYoutubeTrackSelectionRequestSchema.parse(trackSelectionRequest),
  procedureTutorialYoutubeTrackListResultSchema.parse(trackListResult),
  '2026-08-18T10:00:00Z',
);

const boundRequest = {
  ...request,
  formatVersion: '1.1.0',
  requestId: 'b4362a77-a7cb-498f-b7da-f8021477d35f',
  selectionRequestId: trackSelectionRequest.requestId,
} as const;

describe('public authorized YouTube caption import JSON Schema', () => {
  it('publishes strict caption-track list request and metadata-only result contracts', async () => {
    const requestCases = [
      { value: trackListRequest, accepted: true },
      {
        value: {
          ...trackListRequest,
          youtube: {
            ...trackListRequest.youtube,
            authorization: {
              ...trackListRequest.youtube.authorization,
              quotaCostAcknowledged: false,
            },
          },
        },
        accepted: false,
      },
      { value: { ...trackListRequest, accessToken: 'forbidden' }, accepted: false },
    ] as const;
    const resultCases = [
      { value: trackListResult, accepted: true },
      {
        value: {
          ...trackListResult,
          tracks: [{ ...trackListResult.tracks[0], failureReason: 'processingFailed' }],
        },
        accepted: false,
      },
      {
        value: {
          ...trackListResult,
          sideEffects: { ...trackListResult.sideEffects, captionContentDownloaded: true },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of requestCases) {
      expect(
        procedureTutorialYoutubeTrackListRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    for (const contractCase of resultCases) {
      expect(
        procedureTutorialYoutubeTrackListResultSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-list-request.schema.json'),
      requestCases,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-list-result.schema.json'),
      resultCases,
    );
  });

  it('publishes strict local recommendation contracts without selection or side effects', async () => {
    const requestCases = [
      { value: trackRecommendationRequest, accepted: true },
      {
        value: {
          ...trackRecommendationRequest,
          preferences: {
            ...trackRecommendationRequest.preferences,
            explicitSelectionRequired: false,
          },
        },
        accepted: false,
      },
      { value: { ...trackRecommendationRequest, accessToken: 'forbidden' }, accepted: false },
    ] as const;
    const resultCases = [
      { value: trackRecommendationResult, accepted: true },
      {
        value: {
          ...trackRecommendationResult,
          selection: {
            ...trackRecommendationResult.selection,
            automaticallySelected: true,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...trackRecommendationResult,
          sideEffects: { ...trackRecommendationResult.sideEffects, additionalQuotaUnits: 1 },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of requestCases) {
      expect(
        procedureTutorialYoutubeTrackRecommendationRequestSchema.safeParse(contractCase.value)
          .success,
      ).toBe(contractCase.accepted);
    }
    for (const contractCase of resultCases) {
      expect(
        procedureTutorialYoutubeTrackRecommendationResultSchema.safeParse(contractCase.value)
          .success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-recommendation-request.schema.json'),
      requestCases,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-recommendation-result.schema.json'),
      resultCases,
    );
  });

  it('publishes strict explicit selection and locally persisted receipt contracts', async () => {
    const requestCases = [
      { value: trackSelectionRequest, accepted: true },
      {
        value: {
          ...trackSelectionRequest,
          confirmation: {
            ...trackSelectionRequest.confirmation,
            explicitlyConfirmedByUser: false,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...trackSelectionRequest,
          confirmation: {
            explicitlyConfirmedByUser: true,
            reason: { reasonCode: 'other' },
          },
        },
        accepted: false,
      },
      { value: { ...trackSelectionRequest, oauthAccessToken: 'forbidden' }, accepted: false },
    ] as const;
    const legacyTrackSelectionResult = {
      ...trackSelectionResult,
      formatVersion: '1.0.0',
    } as Record<string, unknown>;
    delete legacyTrackSelectionResult['requestFingerprint'];
    const resultCases = [
      { value: trackSelectionResult, accepted: true },
      { value: legacyTrackSelectionResult, accepted: true },
      {
        value: { ...trackSelectionResult, requestFingerprint: undefined },
        accepted: false,
      },
      {
        value: {
          ...trackSelectionResult,
          sideEffects: {
            ...trackSelectionResult.sideEffects,
            captionTrackSelectionRecorded: false,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...trackSelectionResult,
          sideEffects: { ...trackSelectionResult.sideEffects, networkFetched: true },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of requestCases) {
      expect(
        procedureTutorialYoutubeTrackSelectionRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    for (const contractCase of resultCases) {
      expect(
        procedureTutorialYoutubeTrackSelectionResultSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-selection-request.schema.json'),
      requestCases,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-track-selection-result.schema.json'),
      resultCases,
    );
  });

  it('requires exact source identity, explicit network/quota authorization, and no credentials', async () => {
    const cases = [
      { value: request, accepted: true },
      { value: boundRequest, accepted: true },
      {
        value: { ...request, selectionRequestId: trackSelectionRequest.requestId },
        accepted: false,
      },
      { value: { ...request, formatVersion: '1.1.0' }, accepted: false },
      {
        value: { ...boundRequest, selectionRequestId: 'not-a-uuid' },
        accepted: false,
      },
      { value: { ...boundRequest, formatVersion: '2.0.0' }, accepted: false },
      {
        value: { ...request, youtube: { ...request.youtube, videoId: 'short' } },
        accepted: false,
      },
      {
        value: {
          ...request,
          youtube: {
            ...request.youtube,
            authorization: {
              ...request.youtube.authorization,
              networkFetchApproved: false,
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          youtube: {
            ...request.youtube,
            rightsStatus: 'license_verified',
          },
        },
        accepted: false,
      },
      { value: { ...request, accessToken: 'forbidden' }, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(
        procedureTutorialYoutubeImportRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-youtube-import-request.schema.json'),
      cases,
    );
  });

  it('binds packet 1.3.0 to authorized YouTube acquisition provenance', async () => {
    const packet = buildProcedureTutorialYoutubePromptPacket(
      procedureTutorialYoutubeImportRequestSchema.parse(request),
      acquisition,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const wrongVersion = { ...packet, formatVersion: '1.2.0' };
    const missingAcquisition = structuredClone(packet);
    delete missingAcquisition.context.tutorialProvenance?.transcript.document?.acquisition;
    delete missingAcquisition.context.constraints.tutorialTranscriptAcquisitionBound;
    const wrongOrigin = structuredClone(packet);
    if (wrongOrigin.context.tutorialProvenance !== undefined) {
      wrongOrigin.context.tutorialProvenance.transcript.origin = 'user_supplied';
    }

    const cases = [
      { value: packet, accepted: true },
      { value: wrongVersion, accepted: false },
      { value: missingAcquisition, accepted: false },
      { value: wrongOrigin, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureAuthoringPromptPacketSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-packet.schema.json'),
      cases,
    );
  });

  it('binds packet 1.4.0 to the exact persisted selection without forwarding its note', async () => {
    const packet = buildProcedureTutorialYoutubePromptPacket(
      procedureTutorialYoutubeImportRequestSchema.parse(boundRequest),
      acquisition,
      blenderActionCatalog,
      blenderInteractionCatalog,
      trackSelectionResult,
    );
    expect(packet).toMatchObject({
      formatVersion: '1.4.0',
      context: {
        tutorialProvenance: {
          transcript: {
            document: {
              acquisition: {
                videoId: boundRequest.youtube.videoId,
                captionTrackId: boundRequest.youtube.captionTrackId,
                selection: {
                  requestId: trackSelectionRequest.requestId,
                  requestFingerprint: trackSelectionResult.requestFingerprint,
                  trackListRequestId: trackSelectionRequest.trackListRequestId,
                  confirmedAt: trackSelectionResult.recordedAt,
                  reasonCode: 'recommended_candidate',
                  selectedTrackWasRecommended: true,
                  selectedCandidateRank: 1,
                },
              },
            },
          },
        },
        constraints: { tutorialTranscriptSelectionBound: true },
      },
    });
    expect(JSON.stringify(packet)).not.toContain(trackSelectionRequest.confirmation.reason.note);

    const wrongVersion = { ...packet, formatVersion: '1.3.0' };
    const missingSelection = structuredClone(packet);
    delete missingSelection.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
    delete missingSelection.context.constraints.tutorialTranscriptSelectionBound;
    const legacyPacketWithSelection = buildProcedureTutorialYoutubePromptPacket(
      procedureTutorialYoutubeImportRequestSchema.parse(request),
      acquisition,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const acquisitionSelection =
      packet.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
    if (
      legacyPacketWithSelection.context.tutorialProvenance?.transcript.document?.acquisition !==
        undefined &&
      acquisitionSelection !== undefined
    ) {
      legacyPacketWithSelection.context.tutorialProvenance.transcript.document.acquisition.selection =
        acquisitionSelection;
      legacyPacketWithSelection.context.constraints.tutorialTranscriptSelectionBound = true;
    }
    const recommendedReasonMismatch = structuredClone(packet);
    const recommendedReasonMismatchSelection =
      recommendedReasonMismatch.context.tutorialProvenance?.transcript.document?.acquisition
        ?.selection;
    if (recommendedReasonMismatchSelection !== undefined) {
      recommendedReasonMismatchSelection.selectedTrackWasRecommended = false;
      recommendedReasonMismatchSelection.selectedCandidateRank = 2;
    }
    const recommendedRankMismatch = structuredClone(packet);
    const recommendedRankMismatchSelection =
      recommendedRankMismatch.context.tutorialProvenance?.transcript.document?.acquisition
        ?.selection;
    if (recommendedRankMismatchSelection !== undefined) {
      recommendedRankMismatchSelection.selectedCandidateRank = 2;
    }
    const unrankedWithRank = structuredClone(packet);
    const unrankedWithRankSelection =
      unrankedWithRank.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
    if (unrankedWithRankSelection !== undefined) {
      unrankedWithRankSelection.reasonCode = 'caption_quality_review';
      unrankedWithRankSelection.selectedTrackWasRecommended = null;
      unrankedWithRankSelection.selectedCandidateRank = 2;
    }
    const nonRecommendedRankOne = structuredClone(packet);
    const nonRecommendedRankOneSelection =
      nonRecommendedRankOne.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
    if (nonRecommendedRankOneSelection !== undefined) {
      nonRecommendedRankOneSelection.reasonCode = 'caption_quality_review';
      nonRecommendedRankOneSelection.selectedTrackWasRecommended = false;
      nonRecommendedRankOneSelection.selectedCandidateRank = 1;
    }
    const cases = [
      { value: packet, accepted: true },
      { value: wrongVersion, accepted: false },
      { value: missingSelection, accepted: false },
      { value: legacyPacketWithSelection, accepted: false },
      { value: recommendedReasonMismatch, accepted: false },
      { value: recommendedRankMismatch, accepted: false },
      { value: unrankedWithRank, accepted: false },
      { value: nonRecommendedRankOne, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureAuthoringPromptPacketSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-packet.schema.json'),
      cases,
    );

    const completed = {
      request: boundRequest,
      requestFingerprint: 'b'.repeat(64),
      packet,
      occurredAt: '2026-08-18T10:01:00Z',
    } as const;
    expect(procedureTutorialYoutubeImportCompletedEventSchema.safeParse(completed).success).toBe(
      true,
    );
    expect(
      procedureTutorialYoutubeImportCompletedEventSchema.safeParse({
        ...completed,
        request: { ...boundRequest, selectionRequestId: '2793937a-020d-4a47-a1a0-c080878a34fe' },
      }).success,
    ).toBe(false);
  });
});
