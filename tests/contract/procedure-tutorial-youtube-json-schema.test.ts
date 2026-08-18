import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListResultSchema,
} from '@operatingline/protocol';

import { buildProcedureTutorialYoutubePromptPacket } from '../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
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

  it('requires exact source identity, explicit network/quota authorization, and no credentials', async () => {
    const cases = [
      { value: request, accepted: true },
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
});
