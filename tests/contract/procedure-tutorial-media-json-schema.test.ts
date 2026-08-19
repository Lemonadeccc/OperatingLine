import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaCapabilitiesSchema,
  procedureTutorialMediaJobStatusRequestSchema,
  procedureTutorialMediaJobStatusSchema,
  procedureTutorialMediaResumeRequestSchema,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const sourceSha256 = 'a'.repeat(64);
const frameSha256 = 'b'.repeat(64);
const manifestSha256 = 'c'.repeat(64);
const requestId = '985b96b3-e597-4ba6-834a-cbd2d1718416';
const jobId = '640a1f82-834c-4825-ae1e-12d6f749aa0f';
const frameId = 'dc8f24f0-96f0-45cf-a38c-de4a1b8a8ba7';
const asrSegmentId = '7ab52d8f-f169-42a7-8f7c-7309b77ee06a';
const ocrCandidateId = 'b4362a77-a7cb-498f-b7da-f8021477d35f';
const uiCandidateId = 'd25c10f8-792f-4f99-b519-ba60d6cf56bc';
const shortcutCandidateId = '5e94919a-21e2-488f-8a37-a92cb7800ab6';
const semanticSegmentId = '3b55472f-af56-4c77-aa2b-a79f7f294781';

const request = {
  formatVersion: '1.0.0',
  requestId,
  videoId: 'dQw4w9WgXcQ',
  analysisProfile: 'youtube_tutorial_evidence_v1',
  locale: 'en-US',
  analysisWindow: { startMs: 0, endMs: 10_000 },
  requestedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  rightsAuthorization: {
    basis: 'rights_holder_permission',
    reference: 'permission-2026-0001',
    confirmedAt: '2026-08-18T08:00:00Z',
  },
  platformDownloadAuthorization: {
    basis: 'youtube_written_approval',
    reference: 'youtube-approval-2026-0001',
    confirmedAt: '2026-08-18T08:01:00Z',
  },
  approvals: {
    networkAccessApproved: true,
    mediaDownloadApproved: true,
    retentionApproved: true,
  },
} as const;

const sourceArtifact = {
  uri: `operatingline-media://sha256/${sourceSha256}`,
  role: 'source_video',
  mediaType: 'video/mp4',
  sha256: sourceSha256,
  bytes: 1_000_000,
  createdAt: '2026-08-18T08:02:00Z',
} as const;
const frameArtifact = {
  uri: `operatingline-media://sha256/${frameSha256}`,
  role: 'evidence_frame',
  mediaType: 'image/png',
  sha256: frameSha256,
  bytes: 10_000,
  sourceSha256,
  createdAt: '2026-08-18T08:03:00Z',
} as const;
const manifestArtifact = {
  uri: `operatingline-media://sha256/${manifestSha256}`,
  role: 'analysis_manifest',
  mediaType: 'application/json',
  sha256: manifestSha256,
  bytes: 20_000,
  sourceSha256,
  createdAt: '2026-08-18T08:04:00Z',
} as const;
const audioArtifact = {
  uri: `operatingline-media://sha256/${'4'.repeat(64)}`,
  role: 'audio_track',
  mediaType: 'audio/wav',
  sha256: '4'.repeat(64),
  bytes: 100_000,
  sourceSha256,
  createdAt: '2026-08-18T08:03:00Z',
} as const;
const asrArtifact = {
  uri: `operatingline-media://sha256/${'5'.repeat(64)}`,
  role: 'asr_transcript',
  mediaType: 'application/json',
  sha256: '5'.repeat(64),
  bytes: 5_000,
  sourceSha256,
  createdAt: '2026-08-18T08:04:00Z',
} as const;
const ocrArtifact = {
  uri: `operatingline-media://sha256/${'6'.repeat(64)}`,
  role: 'ocr_observations',
  mediaType: 'application/json',
  sha256: '6'.repeat(64),
  bytes: 5_000,
  sourceSha256,
  createdAt: '2026-08-18T08:04:00Z',
} as const;

const result = {
  formatVersion: '1.0.0',
  requestId,
  jobId,
  videoId: request.videoId,
  analysisProfile: request.analysisProfile,
  locale: request.locale,
  analysisWindow: request.analysisWindow,
  completedStages: request.requestedStages,
  artifacts: [
    sourceArtifact,
    audioArtifact,
    frameArtifact,
    asrArtifact,
    ocrArtifact,
    manifestArtifact,
  ],
  tools: [
    {
      toolId: 'operatingline.media-analyzer',
      toolVersion: '1.0.0',
      invocationContractVersion: '1.0.0',
      executableSha256: 'd'.repeat(64),
      versionOutputSha256: '2'.repeat(64),
      normalizedInvocationSha256: '3'.repeat(64),
      configurationSha256: 'e'.repeat(64),
      environmentPolicy: 'local_inference_no_network',
      modelSha256: '7'.repeat(64),
    },
  ],
  probe: {
    sourceArtifactUri: sourceArtifact.uri,
    container: 'mp4',
    durationMs: 10_000,
    video: { codec: 'h264', width: 1920, height: 1080, frameRate: 30, frameCount: 300 },
    audio: { codec: 'aac', channels: 2, sampleRateHz: 48_000 },
  },
  asrSegments: [
    {
      segmentId: asrSegmentId,
      order: 1,
      startMs: 1_000,
      endMs: 4_000,
      text: 'Open the Add menu and create a sphere.',
      locale: 'en-US',
      confidence: null,
      metrics: {
        averageLogProbability: null,
        noSpeechProbability: null,
        compressionRatio: null,
      },
    },
  ],
  frames: [{ frameId, order: 1, timestampMs: 2_000, artifact: frameArtifact }],
  ocrCandidates: [
    {
      candidateId: ocrCandidateId,
      frameId,
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      confidence: 0.95,
      text: 'Add',
      locale: 'en-US',
    },
  ],
  uiCandidates: [
    {
      candidateId: uiCandidateId,
      frameId,
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      confidence: 0.9,
      role: 'menu',
      label: 'Add',
    },
  ],
  shortcutCandidates: [
    {
      candidateId: shortcutCandidateId,
      frameId,
      timestampMs: 2_000,
      keys: ['Shift', 'A'],
      confidence: 0.85,
    },
  ],
  semanticSegments: [
    {
      segmentId: semanticSegmentId,
      order: 1,
      startMs: 1_000,
      endMs: 4_000,
      canonicalDescription: 'Open the Add menu and create a sphere.',
      confidence: 0.9,
      asrSegmentIds: [asrSegmentId],
      ocrCandidateIds: [ocrCandidateId],
      uiCandidateIds: [uiCandidateId],
      shortcutCandidateIds: [shortcutCandidateId],
      evidence: [{ artifactUri: frameArtifact.uri, frameId, timestampMs: 2_000 }],
    },
  ],
  segmentation: {
    algorithmId: 'operatingline.deterministic_tutorial_segmentation',
    algorithmVersion: '1.0.0',
    inputSha256: 'f'.repeat(64),
    outputSha256: '0'.repeat(64),
  },
  sideEffects: {
    networkFetched: true,
    mediaDownloaded: true,
    audioDerived: true,
    framesDerived: true,
    localAsrModelRun: true,
    localOcrRun: true,
    providerCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  manifestIntegrity: {
    manifestArtifactUri: manifestArtifact.uri,
    manifestSha256,
    artifactCount: 6,
    rootSha256: '1'.repeat(64),
    generatedAt: '2026-08-18T08:05:00Z',
  },
  completedAt: '2026-08-18T08:06:00Z',
} as const;

const capabilities = {
  formatVersion: '1.0.0',
  serviceId: 'operatingline.youtube_tutorial_media',
  serviceVersion: '1.0.0',
  availability: 'available',
  analysisProfiles: ['youtube_tutorial_evidence_v1'],
  supportedLocales: ['en-US'],
  stages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  artifactMediaTypes: ['video/mp4', 'audio/wav', 'image/png', 'application/json'],
  limits: {
    maxVideoDurationMs: 86_400_000,
    maxAnalysisWindowMs: 14_400_000,
    maxJobRuntimeMs: 7_200_000,
    maxFrames: 120,
    maxConcurrentJobs: 4,
  },
  features: {
    contentAddressedArtifacts: true,
    resumableJobs: false,
    explicitFullRestartAfterFailure: true,
    deterministicSegmentation: true,
    credentialFreePublicProtocol: true,
    ocrTextCandidates: true,
    shortcutCandidates: true,
    uiElementRecognition: false,
  },
} as const;

describe('public tutorial media analysis JSON Schemas', () => {
  it('keeps the request credential-free and requires separate rights and download approvals', async () => {
    const cases = [
      { value: request, accepted: true },
      {
        value: { ...request, approvals: { ...request.approvals, mediaDownloadApproved: false } },
        accepted: false,
      },
      {
        value: {
          ...request,
          platformDownloadAuthorization: {
            ...request.platformDownloadAuthorization,
            basis: 'terms_of_service_assumed',
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          platformDownloadAuthorization: {
            ...request.platformDownloadAuthorization,
            reference: 'https://example.com/approval',
          },
        },
        accepted: false,
      },
      { value: { ...request, url: 'https://youtube.example/watch' }, accepted: false },
      { value: { ...request, path: '/tmp/video.mp4' }, accepted: false },
      { value: { ...request, executable: 'media-tool' }, accepted: false },
      { value: { ...request, argv: ['--download'] }, accepted: false },
      { value: { ...request, accessToken: 'forbidden' }, accepted: false },
      { value: { ...request, cookie: 'forbidden' }, accepted: false },
      { value: { ...request, videoId: '../unsafe' }, accepted: false },
      { value: { ...request, requestedStages: ['download', 'probe'] }, accepted: false },
      {
        value: {
          ...request,
          requestedStages: ['probe', 'download', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          requestedStages: [
            'download',
            'download',
            'audio',
            'asr',
            'frames',
            'ocr',
            'segmentation',
          ],
        },
        accepted: false,
      },
    ] as const;

    for (const contractCase of cases) {
      expect(
        procedureTutorialMediaAnalysisRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-analysis-request.schema.json'),
      cases,
    );
  });

  it('publishes content-addressed result and safe job status contracts', async () => {
    const resultCases = [
      { value: result, accepted: true },
      {
        value: {
          ...result,
          artifacts: [
            { ...sourceArtifact, path: '/tmp/video.mp4' },
            audioArtifact,
            frameArtifact,
            asrArtifact,
            ocrArtifact,
            manifestArtifact,
          ],
        },
        accepted: false,
      },
      {
        value: {
          ...result,
          tools: [{ ...result.tools[0], argv: ['--unsafe'] }],
        },
        accepted: false,
      },
      { value: { ...result, cookie: 'forbidden' }, accepted: false },
      {
        value: {
          ...result,
          completedStages: ['probe', 'download', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of resultCases) {
      expect(procedureTutorialMediaAnalysisResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-analysis-result.schema.json'),
      resultCases,
    );

    const statusCases = [
      {
        value: {
          formatVersion: '1.0.0',
          requestId,
          jobId,
          status: 'completed',
          result,
          updatedAt: result.completedAt,
        },
        accepted: true,
      },
      {
        value: {
          formatVersion: '1.0.0',
          requestId,
          jobId,
          status: 'failed',
          completedStages: ['download'],
          error: {
            code: 'shell_failed',
            message: 'unsafe implementation detail',
            retryable: false,
            stage: 'probe',
          },
          failedAt: '2026-08-18T08:06:00Z',
          updatedAt: '2026-08-18T08:06:00Z',
        },
        accepted: false,
      },
      {
        value: {
          formatVersion: '1.0.0',
          requestId,
          jobId,
          status: 'accepted',
          acceptedAt: '2026-08-18T08:00:00Z',
          updatedAt: '2026-08-18T08:00:00Z',
          token: 'forbidden',
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of statusCases) {
      expect(procedureTutorialMediaJobStatusSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-job-status.schema.json'),
      statusCases,
    );
  });

  it('publishes strict recovery and capability contracts', async () => {
    const statusRequest = {
      formatVersion: '1.0.0',
      requestId,
      jobId,
    } as const;
    const statusRequestCases = [
      { value: statusRequest, accepted: true },
      { value: { ...statusRequest, token: 'forbidden' }, accepted: false },
    ] as const;
    const resume = {
      formatVersion: '1.0.0',
      requestId,
      jobId,
      recoveryId: '8e1ee079-31c8-4ac9-a3a3-cef6eaa406a7',
      retryFromStage: 'download',
      approvals: request.approvals,
    } as const;
    const resumeCases = [
      { value: resume, accepted: true },
      { value: { ...resume, resumeToken: 'forbidden' }, accepted: false },
      { value: { ...resume, retryFromStage: 'asr' }, accepted: false },
      {
        value: { ...resume, approvals: { ...resume.approvals, retentionApproved: false } },
        accepted: false,
      },
    ] as const;
    const capabilityCases = [
      { value: capabilities, accepted: true },
      {
        value: {
          formatVersion: '1.0.0',
          serviceId: 'operatingline.youtube_tutorial_media',
          serviceVersion: '1.0.0',
          availability: 'unavailable',
          unavailableReasons: ['not_configured'],
        },
        accepted: true,
      },
      { value: { ...capabilities, executable: '/usr/bin/ffmpeg' }, accepted: false },
      {
        value: {
          ...capabilities,
          features: { ...capabilities.features, credentialFreePublicProtocol: false },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of statusRequestCases) {
      expect(
        procedureTutorialMediaJobStatusRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    for (const contractCase of resumeCases) {
      expect(procedureTutorialMediaResumeRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    for (const contractCase of capabilityCases) {
      expect(procedureTutorialMediaCapabilitiesSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-job-status-request.schema.json'),
      statusRequestCases,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-resume-request.schema.json'),
      resumeCases,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-capabilities.schema.json'),
      capabilityCases,
    );
  });

  it('enforces cross-record time, coordinate, hash and evidence references in TypeScript', () => {
    expect(
      procedureTutorialMediaJobStatusRequestSchema.safeParse({
        formatVersion: '1.0.0',
        requestId,
        jobId: requestId,
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisRequestSchema.safeParse({
        ...request,
        analysisWindow: { startMs: 5_000, endMs: 5_000 },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisResultSchema.safeParse({
        ...result,
        artifacts: [
          sourceArtifact,
          audioArtifact,
          { ...frameArtifact, uri: `operatingline-media://sha256/${'9'.repeat(64)}` },
          asrArtifact,
          ocrArtifact,
          manifestArtifact,
        ],
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisResultSchema.safeParse({
        ...result,
        uiCandidates: [
          { ...result.uiCandidates[0], bounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } },
        ],
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisResultSchema.safeParse({
        ...result,
        semanticSegments: [
          {
            ...result.semanticSegments[0],
            asrSegmentIds: ['1e341edd-066f-4aaf-997f-a02ec22a3dce'],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
