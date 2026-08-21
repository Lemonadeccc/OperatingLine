import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaCapabilitiesSchema,
  procedureTutorialMediaCurrentAnalysisResultSchema,
  procedureTutorialMediaCurrentJobStatusSchema,
  procedureTutorialMediaJobStatusRequestSchema,
  procedureTutorialMediaRecognitionArtifactSchema,
  procedureTutorialMediaResumeRequestSchema,
} from '@operatingline/protocol';
import { procedureTutorialMediaAnalysisStartRequestSchema } from '../../packages/protocol/src/procedure-tutorial-media.js';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(
    readFileSync(
      resolve(process.env['OPERATINGLINE_SCHEMA_DIR'] ?? 'protocol/schemas/v1', filename),
      'utf8',
    ),
  ) as object;
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
const rightsValidation = {
  authorityId: 'rights-authority-fixture',
  authorityKind: 'media_rights_authority',
  sideEffect: 'rights_validation',
  receiptContentSha256: '8'.repeat(64),
  authorityContentSha256: '9'.repeat(64),
} as const;
const youtubeSource = {
  kind: 'authorized_youtube_download',
  videoId: 'dQw4w9WgXcQ',
  sourceIdentitySha256: '1'.repeat(64),
  contentSha256: sourceSha256,
  rightsBasis: 'rights_holder_permission',
  rightsValidation,
  platformDownloadValidation: {
    authorityId: 'youtube-platform-authority-fixture',
    authorityKind: 'youtube_platform_authority',
    sideEffect: 'youtube_media_download',
    receiptContentSha256: '2'.repeat(64),
    authorityContentSha256: '3'.repeat(64),
  },
} as const;
const localSource = {
  kind: 'user_supplied_local_file',
  sourceIdentitySha256: '4'.repeat(64),
  contentSha256: sourceSha256,
  rightsBasis: 'rights_holder_permission',
  importValidation: {
    authorityId: 'local-import-authority-fixture',
    authorityKind: 'local_import_authority',
    sideEffect: 'local_media_import',
    receiptContentSha256: '5'.repeat(64),
    authorityContentSha256: '6'.repeat(64),
  },
  rightsValidation,
} as const;

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

const youtubeStartRequest = {
  formatVersion: '1.1.0',
  requestId,
  source: youtubeSource,
  analysisProfile: 'youtube_tutorial_evidence_v1',
  locale: 'en-US',
  analysisWindow: request.analysisWindow,
  requestedStages: request.requestedStages,
  approvals: request.approvals,
} as const;
const localStartRequest = {
  ...youtubeStartRequest,
  source: localSource,
  analysisProfile: 'local_tutorial_evidence_v1',
  requestedStages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
  approvals: {
    networkAccessApproved: false,
    mediaDownloadApproved: false,
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

const localCapabilities = {
  ...capabilities,
  formatVersion: '1.1.0',
  analysisProfiles: ['local_tutorial_evidence_v1'],
  stages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
} as const;

const recognitionArtifact = {
  formatVersion: '1.0.0',
  artifactKind: 'ui_recognition_observations',
  stage: 'recognition',
  input: {
    frames: [
      {
        frameId,
        frameSha256,
        ocrArtifactSha256: '6'.repeat(64),
        ocrCandidatesSha256: '7'.repeat(64),
        timestampMs: 2_000,
      },
    ],
  },
  observations: {
    uiCandidates: [
      {
        candidateId: uiCandidateId,
        kind: 'menu',
        frameId,
        timestampMs: 2_000,
        label: 'Add',
        normalizedLabel: 'add',
        menuId: 'add',
        controlId: null,
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
        confidence: 0.9,
      },
    ],
    keyCandidates: [
      {
        candidateId: shortcutCandidateId,
        kind: 'key_chord',
        frameId,
        timestampMs: 2_000,
        label: 'Shift A',
        normalizedKeys: ['Shift', 'A'],
        confidence: 0.85,
      },
    ],
  },
  provenance: {
    adapterId: 'fixture-recognizer',
    adapterVersion: '1.0.0',
    modelId: 'fixture-model',
    modelVersion: '1.0.0',
    executableSha256: '1'.repeat(64),
    modelSha256: '2'.repeat(64),
    licenseId: 'Apache-2.0',
    licenseSha256: '3'.repeat(64),
    configSha256: '4'.repeat(64),
    versionOutputSha256: '5'.repeat(64),
    locale: 'en-US',
    platform: 'test',
    isolationBackendId: 'fixture-isolator',
    isolationBackendVersion: '1.0.0',
    isolationBackendVersionSha256: '8'.repeat(64),
    supervisorSha256: '9'.repeat(64),
    isolationPolicySha256: 'a'.repeat(64),
    isolationAttestationSha256: 'b'.repeat(64),
  },
  contentSha256: 'c'.repeat(64),
} as const;

describe('public tutorial media analysis JSON Schemas', () => {
  it('publishes strict structural recognition artifacts and documents runtime semantic gates', async () => {
    const structuralCases = [
      { value: recognitionArtifact, accepted: true },
      { value: { ...recognitionArtifact, token: 'forbidden' }, accepted: false },
      {
        value: {
          ...recognitionArtifact,
          observations: { ...recognitionArtifact.observations, debug: true },
        },
        accepted: false,
      },
      {
        value: {
          ...recognitionArtifact,
          observations: {
            ...recognitionArtifact.observations,
            uiCandidates: [
              { ...recognitionArtifact.observations.uiCandidates[0], confidence: 1.01 },
            ],
          },
        },
        accepted: false,
      },
      {
        value: { ...recognitionArtifact, contentSha256: 'not-a-sha256' },
        accepted: false,
      },
      {
        value: {
          ...recognitionArtifact,
          observations: {
            ...recognitionArtifact.observations,
            keyCandidates: [
              { ...recognitionArtifact.observations.keyCandidates[0], kind: 'keypress' },
            ],
          },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of structuralCases)
      expect(
        procedureTutorialMediaRecognitionArtifactSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    const generatedSchema = publicSchema(
      'procedure-tutorial-media-ui-recognition-artifact.schema.json',
    );
    expect(generatedSchema).toMatchObject({
      $comment: expect.stringContaining('id uniqueness'),
    });
    await validatePublicJsonSchemaCases(generatedSchema, structuralCases);

    const semanticCases = [
      {
        ...recognitionArtifact,
        input: {
          frames: [recognitionArtifact.input.frames[0], recognitionArtifact.input.frames[0]],
        },
      },
      {
        ...recognitionArtifact,
        observations: {
          ...recognitionArtifact.observations,
          keyCandidates: [
            {
              ...recognitionArtifact.observations.keyCandidates[0],
              candidateId: uiCandidateId,
            },
          ],
        },
      },
      {
        ...recognitionArtifact,
        observations: {
          ...recognitionArtifact.observations,
          uiCandidates: [
            { ...recognitionArtifact.observations.uiCandidates[0], frameId: 'missing-frame' },
          ],
        },
      },
      {
        ...recognitionArtifact,
        observations: {
          ...recognitionArtifact.observations,
          uiCandidates: [
            { ...recognitionArtifact.observations.uiCandidates[0], timestampMs: 2_001 },
          ],
        },
      },
    ] as const;
    for (const value of semanticCases)
      expect(procedureTutorialMediaRecognitionArtifactSchema.safeParse(value).success).toBe(false);
    await validatePublicJsonSchemaCases(
      generatedSchema,
      semanticCases.map((value) => ({ value, accepted: true })),
    );
  });

  it('round-trips exact YouTube and local sources and rejects loss or simultaneous claims', () => {
    expect(
      procedureTutorialMediaAnalysisStartRequestSchema.safeParse(youtubeStartRequest).success,
    ).toBe(true);
    expect(
      procedureTutorialMediaAnalysisStartRequestSchema.safeParse(localStartRequest).success,
    ).toBe(true);
    expect(
      procedureTutorialMediaAnalysisStartRequestSchema.safeParse({
        ...youtubeStartRequest,
        formatVersion: '1.0.0',
        source: undefined,
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisStartRequestSchema.safeParse({
        ...localStartRequest,
        source: { ...localSource, videoId: youtubeSource.videoId },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisStartRequestSchema.safeParse({
        ...youtubeStartRequest,
        source: { ...youtubeSource, importValidation: localSource.importValidation },
      }).success,
    ).toBe(false);

    const youtubeResult = {
      ...result,
      formatVersion: '1.1.0',
      source: youtubeSource,
      manifestIntegrity: { ...result.manifestIntegrity, source: youtubeSource },
    } as const;
    const resultWithoutVideoId = Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'videoId'),
    );
    const localResult = {
      ...resultWithoutVideoId,
      formatVersion: '1.1.0',
      source: localSource,
      analysisProfile: 'local_tutorial_evidence_v1',
      completedStages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
      sideEffects: { ...result.sideEffects, networkFetched: false, mediaDownloaded: false },
      manifestIntegrity: { ...result.manifestIntegrity, source: localSource },
    } as const;
    expect(procedureTutorialMediaAnalysisResultSchema.safeParse(youtubeResult).success).toBe(true);
    expect(procedureTutorialMediaAnalysisResultSchema.safeParse(localResult).success).toBe(true);
    expect(
      procedureTutorialMediaAnalysisResultSchema.safeParse({
        ...youtubeResult,
        manifestIntegrity: { ...youtubeResult.manifestIntegrity, source: localSource },
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAnalysisResultSchema.safeParse({
        ...youtubeResult,
        videoId: 'aaaaaaaaaaa',
      }).success,
    ).toBe(false);
  });

  it('keeps the request credential-free and requires separate rights and download approvals', async () => {
    const cases = [
      { value: youtubeStartRequest, accepted: true },
      { value: localStartRequest, accepted: true },
      { value: request, accepted: false },
      {
        value: {
          ...youtubeStartRequest,
          approvals: { ...youtubeStartRequest.approvals, mediaDownloadApproved: false },
        },
        accepted: false,
      },
      {
        value: {
          ...youtubeStartRequest,
          source: {
            ...youtubeSource,
            platformDownloadValidation: youtubeSource.rightsValidation,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...localStartRequest,
          source: {
            ...localSource,
            importValidation: localSource.rightsValidation,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...youtubeStartRequest,
          source: {
            ...youtubeSource,
            platformDownloadValidation: {
              ...youtubeSource.platformDownloadValidation,
              receiptContentSha256: youtubeSource.rightsValidation.receiptContentSha256,
              authorityContentSha256: youtubeSource.rightsValidation.authorityContentSha256,
            },
          },
        },
        accepted: true,
        runtimeAccepted: false,
      },
      {
        value: {
          ...localStartRequest,
          source: {
            ...localSource,
            importValidation: {
              ...localSource.importValidation,
              receiptContentSha256: localSource.rightsValidation.receiptContentSha256,
              authorityContentSha256: localSource.rightsValidation.authorityContentSha256,
            },
          },
        },
        accepted: true,
        runtimeAccepted: false,
      },
      { value: { ...youtubeStartRequest, url: 'https://youtube.example/watch' }, accepted: false },
      { value: { ...youtubeStartRequest, path: '/tmp/video.mp4' }, accepted: false },
      { value: { ...youtubeStartRequest, executable: 'media-tool' }, accepted: false },
      { value: { ...youtubeStartRequest, argv: ['--download'] }, accepted: false },
      { value: { ...youtubeStartRequest, accessToken: 'forbidden' }, accepted: false },
      { value: { ...youtubeStartRequest, cookie: 'forbidden' }, accepted: false },
      {
        value: { ...youtubeStartRequest, requestedStages: ['download', 'probe'] },
        accepted: false,
      },
      {
        value: {
          ...youtubeStartRequest,
          requestedStages: ['probe', 'download', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
        },
        accepted: false,
      },
      {
        value: {
          ...youtubeStartRequest,
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
        procedureTutorialMediaAnalysisStartRequestSchema.safeParse(contractCase.value).success,
      ).toBe(
        'runtimeAccepted' in contractCase ? contractCase.runtimeAccepted : contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-analysis-request.schema.json'),
      cases,
    );
  });

  it('publishes content-addressed result and safe job status contracts', async () => {
    const youtubeResult = {
      ...result,
      formatVersion: '1.1.0',
      source: youtubeSource,
      manifestIntegrity: { ...result.manifestIntegrity, source: youtubeSource },
    } as const;
    const youtubeResultWithoutVideoId = Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'videoId'),
    );
    const localResult = {
      ...youtubeResultWithoutVideoId,
      formatVersion: '1.1.0',
      source: localSource,
      analysisProfile: 'local_tutorial_evidence_v1',
      completedStages: ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
      sideEffects: { ...result.sideEffects, networkFetched: false, mediaDownloaded: false },
      manifestIntegrity: { ...result.manifestIntegrity, source: localSource },
    } as const;
    const resultCases = [
      { value: youtubeResult, accepted: true },
      { value: localResult, accepted: true },
      { value: result, accepted: false },
      {
        value: {
          ...youtubeResult,
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
          ...youtubeResult,
          tools: [{ ...youtubeResult.tools[0], argv: ['--unsafe'] }],
        },
        accepted: false,
      },
      { value: { ...youtubeResult, cookie: 'forbidden' }, accepted: false },
      {
        value: {
          ...youtubeResult,
          completedStages: ['probe', 'download', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
        },
        accepted: false,
      },
      {
        value: {
          ...youtubeResult,
          source: { ...youtubeSource, contentSha256: 'f'.repeat(64) },
        },
        accepted: true,
        runtimeAccepted: false,
      },
      {
        value: {
          ...localResult,
          manifestIntegrity: { ...localResult.manifestIntegrity, source: youtubeSource },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of resultCases) {
      expect(
        procedureTutorialMediaCurrentAnalysisResultSchema.safeParse(contractCase.value).success,
      ).toBe(
        'runtimeAccepted' in contractCase ? contractCase.runtimeAccepted : contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-analysis-result.schema.json'),
      resultCases,
    );

    const statusCases = [
      {
        value: {
          formatVersion: '1.1.0',
          requestId,
          jobId,
          source: youtubeSource,
          status: 'completed',
          result: youtubeResult,
          updatedAt: youtubeResult.completedAt,
        },
        accepted: true,
      },
      {
        value: {
          formatVersion: '1.0.0',
          requestId,
          jobId,
          status: 'completed',
          result,
          updatedAt: result.completedAt,
        },
        accepted: false,
      },
      {
        value: {
          formatVersion: '1.1.0',
          requestId,
          jobId,
          source: localSource,
          status: 'failed',
          completedStages: [],
          error: {
            code: 'source_unavailable',
            message: 'Local import failed.',
            retryable: false,
            stage: 'download',
          },
          failedAt: '2026-08-18T08:06:00Z',
          updatedAt: '2026-08-18T08:06:00Z',
        },
        accepted: false,
      },
      {
        value: {
          formatVersion: '1.1.0',
          requestId,
          jobId,
          source: localSource,
          status: 'recovery_required',
          recoveryId: '8e1ee079-31c8-4ac9-a3a3-cef6eaa406a7',
          retryFromStage: 'import',
          completedStages: [],
          error: {
            code: 'source_unavailable',
            message: 'Local import failed.',
            retryable: false,
            stage: 'download',
          },
          updatedAt: '2026-08-18T08:00:00Z',
        },
        accepted: false,
      },
      {
        value: {
          formatVersion: '1.1.0',
          requestId,
          jobId,
          source: youtubeSource,
          status: 'accepted',
          acceptedAt: '2026-08-18T08:00:00Z',
          updatedAt: '2026-08-18T08:00:00Z',
          token: 'forbidden',
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of statusCases) {
      expect(
        procedureTutorialMediaCurrentJobStatusSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-job-status.schema.json'),
      statusCases,
    );
  });

  it('publishes strict recovery and capability contracts', async () => {
    const statusRequest = {
      formatVersion: '1.1.0',
      requestId,
      jobId,
    } as const;
    const statusRequestCases = [
      { value: statusRequest, accepted: true },
      { value: { ...statusRequest, formatVersion: '1.0.0' }, accepted: false },
      { value: { ...statusRequest, token: 'forbidden' }, accepted: false },
    ] as const;
    const resume = {
      formatVersion: '1.1.0',
      requestId,
      jobId,
      source: youtubeSource,
      recoveryId: '8e1ee079-31c8-4ac9-a3a3-cef6eaa406a7',
      retryFromStage: 'download',
      approvals: request.approvals,
    } as const;
    const resumeCases = [
      { value: resume, accepted: true },
      {
        value: {
          ...resume,
          source: {
            ...youtubeSource,
            platformDownloadValidation: youtubeSource.rightsValidation,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...resume,
          source: localSource,
          retryFromStage: 'import',
          approvals: localStartRequest.approvals,
        },
        accepted: true,
      },
      {
        value: {
          ...resume,
          source: { ...localSource, importValidation: localSource.rightsValidation },
          retryFromStage: 'import',
          approvals: localStartRequest.approvals,
        },
        accepted: false,
      },
      { value: { ...resume, resumeToken: 'forbidden' }, accepted: false },
      { value: { ...resume, retryFromStage: 'asr' }, accepted: false },
      {
        value: { ...resume, approvals: { ...resume.approvals, retentionApproved: false } },
        accepted: false,
      },
    ] as const;
    const capabilityCases = [
      { value: capabilities, accepted: true },
      { value: localCapabilities, accepted: true },
      {
        value: { ...localCapabilities, stages: capabilities.stages },
        accepted: false,
      },
      {
        value: { ...capabilities, analysisProfiles: localCapabilities.analysisProfiles },
        accepted: false,
      },
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
      [
        {
          value: {
            formatVersion: '1.1.0',
            requestId,
            jobId,
            source: youtubeSource,
            recoveryId: resume.recoveryId,
            retryFromStage: 'download',
            approvals: request.approvals,
          },
          accepted: true,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-capabilities.schema.json'),
      capabilityCases,
    );
  });

  it('enforces cross-record time, coordinate, hash and evidence references in TypeScript', () => {
    expect(
      procedureTutorialMediaJobStatusRequestSchema.safeParse({
        formatVersion: '1.1.0',
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
