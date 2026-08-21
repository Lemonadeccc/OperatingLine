import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialMediaAuthoringPrepareStartRequestSchema,
  procedureTutorialMediaAuthoringPreparationSchema,
  type ProcedureAuthoringMediaSource,
  type ProcedureTutorialMediaCurrentAnalysisResult,
  type ProcedureTutorialMediaArtifactRef,
} from '@operatingline/protocol';

import { prepareProcedureTutorialMediaAuthoring } from '../../../services/orchestrator/src/procedure-tutorial-media-authoring.js';
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

const completedAt = '2026-08-20T00:00:00.000Z';
const sourceSha256 = '1'.repeat(64);
const mediaSource: ProcedureAuthoringMediaSource = {
  kind: 'authorized_youtube_download',
  videoId: 'abcdefghijk',
  sourceIdentitySha256: '0'.repeat(64),
  contentSha256: sourceSha256,
  rightsBasis: 'rights_holder_permission',
  platformDownloadValidation: {
    authorityId: 'youtube-platform-authority-fixture',
    authorityKind: 'youtube_platform_authority',
    sideEffect: 'youtube_media_download',
    receiptContentSha256: 'a'.repeat(64),
    authorityContentSha256: 'b'.repeat(64),
  },
  rightsValidation: {
    authorityId: 'rights-authority-fixture',
    authorityKind: 'media_rights_authority',
    sideEffect: 'rights_validation',
    receiptContentSha256: 'c'.repeat(64),
    authorityContentSha256: 'd'.repeat(64),
  },
};

function artifact(
  role: ProcedureTutorialMediaArtifactRef['role'],
  mediaType: ProcedureTutorialMediaArtifactRef['mediaType'],
  digit: string,
): ProcedureTutorialMediaArtifactRef {
  const sha256 = digit.repeat(64);
  return {
    uri: `operatingline-media://sha256/${sha256}`,
    role,
    mediaType,
    sha256,
    bytes: 10,
    ...(role === 'source_video' ? {} : { sourceSha256 }),
    createdAt: completedAt,
  };
}

function analysis(): ProcedureTutorialMediaCurrentAnalysisResult {
  const source = artifact('source_video', 'video/mp4', '1');
  const audio = artifact('audio_track', 'audio/wav', '2');
  const frame1 = artifact('evidence_frame', 'image/png', '3');
  const frame2 = artifact('evidence_frame', 'image/png', '4');
  const transcript = artifact('asr_transcript', 'application/json', '5');
  const observations = artifact('ocr_observations', 'application/json', '6');
  const manifest = artifact('analysis_manifest', 'application/json', '7');
  const asr1 = '11111111-1111-4111-8111-111111111111';
  const asr2 = '22222222-2222-4222-8222-222222222222';
  const frameId1 = '33333333-3333-4333-8333-333333333333';
  const frameId2 = '44444444-4444-4444-8444-444444444444';
  const ocrId = '55555555-5555-4555-8555-555555555555';
  const uiId = '66666666-6666-4666-8666-666666666666';
  const shortcutId = '77777777-7777-4777-8777-777777777777';
  return {
    formatVersion: '1.1.0',
    requestId: '88888888-8888-4888-8888-888888888888',
    jobId: '99999999-9999-4999-8999-999999999999',
    videoId: 'abcdefghijk',
    source: mediaSource,
    analysisProfile: 'youtube_tutorial_evidence_v1',
    locale: 'en',
    analysisWindow: { startMs: 0, endMs: 2_000 },
    completedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
    artifacts: [source, audio, frame1, frame2, transcript, observations, manifest],
    tools: [
      {
        toolId: 'fixture.asr',
        toolVersion: '1.0.0',
        invocationContractVersion: '1.0.0',
        executableSha256: '8'.repeat(64),
        versionOutputSha256: '9'.repeat(64),
        normalizedInvocationSha256: 'a'.repeat(64),
        configurationSha256: 'b'.repeat(64),
        environmentPolicy: 'local_inference_no_network',
        modelSha256: 'c'.repeat(64),
      },
    ],
    probe: {
      sourceArtifactUri: source.uri,
      container: 'mp4',
      durationMs: 2_000,
      video: { codec: 'h264', width: 1280, height: 720, frameRate: 30, frameCount: 60 },
      audio: { codec: 'aac', channels: 2, sampleRateHz: 48_000 },
    },
    asrSegments: [
      {
        segmentId: asr1,
        order: 1,
        startMs: 0,
        endMs: 1_000,
        text: 'Add a UV sphere.',
        locale: 'en',
        confidence: 0.95,
        metrics: {
          averageLogProbability: -0.1,
          noSpeechProbability: 0.01,
          compressionRatio: 1,
        },
      },
      {
        segmentId: asr2,
        order: 2,
        startMs: 1_000,
        endMs: 2_000,
        text: 'Move it to the eye position.',
        locale: 'en',
        confidence: 0.9,
        metrics: {
          averageLogProbability: -0.2,
          noSpeechProbability: 0.01,
          compressionRatio: 1,
        },
      },
    ],
    frames: [
      { frameId: frameId1, order: 1, timestampMs: 500, artifact: frame1 },
      { frameId: frameId2, order: 2, timestampMs: 1_500, artifact: frame2 },
    ],
    ocrCandidates: [
      {
        candidateId: ocrId,
        frameId: frameId1,
        bounds: { x: 0, y: 0, width: 0.2, height: 0.1 },
        confidence: 0.8,
        text: 'Add',
        locale: 'en',
      },
    ],
    uiCandidates: [
      {
        candidateId: uiId,
        frameId: frameId1,
        bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
        confidence: 0.8,
        role: 'menu_item',
        label: 'UV Sphere',
      },
    ],
    shortcutCandidates: [
      {
        candidateId: shortcutId,
        frameId: frameId2,
        timestampMs: 1_500,
        keys: ['Shift', 'A'],
        confidence: 0.85,
      },
    ],
    semanticSegments: [
      {
        segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        order: 1,
        startMs: 0,
        endMs: 1_000,
        canonicalDescription: 'Create the eye sphere.',
        confidence: 0.92,
        asrSegmentIds: [asr1],
        ocrCandidateIds: [ocrId],
        uiCandidateIds: [uiId],
        shortcutCandidateIds: [],
        evidence: [{ artifactUri: frame1.uri, frameId: frameId1, timestampMs: 500 }],
      },
      {
        segmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        order: 2,
        startMs: 1_000,
        endMs: 2_000,
        canonicalDescription: 'Move the eye sphere.',
        confidence: 0.88,
        asrSegmentIds: [asr2],
        ocrCandidateIds: [],
        uiCandidateIds: [],
        shortcutCandidateIds: [shortcutId],
        evidence: [{ artifactUri: frame2.uri, frameId: frameId2, timestampMs: 1_500 }],
      },
    ],
    segmentation: {
      algorithmId: 'operatingline.deterministic_tutorial_segmentation',
      algorithmVersion: '1.0.0',
      inputSha256: 'd'.repeat(64),
      outputSha256: 'e'.repeat(64),
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
      manifestArtifactUri: manifest.uri,
      manifestSha256: manifest.sha256,
      artifactCount: 7,
      rootSha256: 'f'.repeat(64),
      generatedAt: completedAt,
      source: mediaSource,
    },
    completedAt,
  };
}

function input(result = analysis()) {
  return {
    analysis: result,
    source: result.source,
    request: {
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      goal: 'Recreate the eye shown in this tutorial.',
      treeId: 'tutorial.media.eye.procedure',
      revision: 1,
      locale: 'en',
    },
    video: {
      title: 'Eye tutorial',
      uri: 'https://www.youtube.com/watch?v=abcdefghijk',
    },
    actionCatalog: blenderActionCatalog,
    interactionCatalog: blenderInteractionCatalog,
    verifyAnalysis: vi.fn(async (value: ProcedureTutorialMediaCurrentAnalysisResult) => value),
  };
}

function publicSchema(filename: string): object {
  return JSON.parse(
    readFileSync(
      resolve(process.env['OPERATINGLINE_SCHEMA_DIR'] ?? 'protocol/schemas/v1', filename),
      'utf8',
    ),
  ) as object;
}

describe('procedure tutorial media authoring preparation', () => {
  it('builds an ordered packet with exact evidence bindings and deterministic quality', async () => {
    const first = await prepareProcedureTutorialMediaAuthoring(input());
    const second = await prepareProcedureTutorialMediaAuthoring(input());

    expect(first.status).toBe('ready');
    expect(first.packet?.formatVersion).toBe('1.6.0');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.quality).toEqual({
      semanticSegmentCount: 2,
      ordered: true,
      nonOverlapping: true,
      coverage: {
        asr: 1,
        frameEvidence: 1,
        visual: 1,
        ocr: 0.5,
        ui: 0.5,
        shortcut: 0.5,
      },
      blockers: [],
    });
    expect(first.evidenceBindings.map((binding) => binding.startMs)).toEqual([0, 1_000]);
    expect(first.evidenceBindings[0]).toMatchObject({
      promptSegmentOrder: 1,
      promptEvidenceId: 'evidence.tutorial.media.eye.procedure.revision.1.tutorial.segment.0001',
      semanticSegmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonicalDescription: 'Create the eye sphere.',
      evidence: [
        {
          frameId: '33333333-3333-4333-8333-333333333333',
          timestampMs: 500,
        },
      ],
    });
    expect(first.packet?.context.tutorialProvenance).toMatchObject({
      source: {
        uri: 'https://www.youtube.com/watch?v=abcdefghijk',
        durationMs: 2_000,
      },
      transcript: {
        origin: 'local_media_analysis',
        localMediaAnalysis: {
          analysisRequestId: '88888888-8888-4888-8888-888888888888',
          analysisJobId: '99999999-9999-4999-8999-999999999999',
          analysisFingerprint: first.analysisFingerprint,
          source: mediaSource,
          manifest: {
            artifactUri: `operatingline-media://sha256/${'7'.repeat(64)}`,
            sha256: '7'.repeat(64),
            rootSha256: 'f'.repeat(64),
            source: mediaSource,
          },
          tools: [
            {
              toolId: 'fixture.asr',
              versionOutputSha256: '9'.repeat(64),
              modelSha256: 'c'.repeat(64),
            },
          ],
          semanticBindings: [
            {
              semanticSegmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              asrSegmentIds: ['11111111-1111-4111-8111-111111111111'],
              ocrCandidateIds: ['55555555-5555-4555-8555-555555555555'],
              uiCandidateIds: ['66666666-6666-4666-8666-666666666666'],
            },
            {
              semanticSegmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              shortcutCandidateIds: ['77777777-7777-4777-8777-777777777777'],
            },
          ],
        },
        segments: [
          { order: 1, text: 'Add a UV sphere.', confidence: 0.92 },
          { order: 2, text: 'Move it to the eye position.', confidence: 0.88 },
        ],
      },
    });
    expect(first.sideEffects).toEqual({
      providerCalled: false,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    });
    const preparedInput = input();
    const publicRequest = {
      formatVersion: '1.1.0',
      analysisRequestId: preparedInput.analysis.requestId,
      analysisJobId: preparedInput.analysis.jobId,
      source: preparedInput.source,
      request: preparedInput.request,
      video: preparedInput.video,
    };
    expect(
      procedureTutorialMediaAuthoringPrepareStartRequestSchema.safeParse(publicRequest).success,
    ).toBe(true);
    expect(
      procedureTutorialMediaAuthoringPrepareStartRequestSchema.safeParse({
        ...publicRequest,
        formatVersion: '1.0.0',
        source: undefined,
      }).success,
    ).toBe(false);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-prepare-request.schema.json'),
      [
        { value: publicRequest, accepted: true },
        {
          value: { ...publicRequest, formatVersion: '1.0.0', source: undefined },
          accepted: false,
        },
        { value: { ...publicRequest, analysisJobId: 'not-a-uuid' }, accepted: false },
        { value: { ...publicRequest, executablePath: '/tmp/forbidden' }, accepted: false },
        {
          value: {
            ...publicRequest,
            video: { ...publicRequest.video, license: 'caller-controlled' },
          },
          accepted: false,
        },
      ],
    );
    const forgedPublicLocalMediaRequest = {
      ...preparedInput.request,
      tutorial: {
        video: {
          uri: first.packet!.context.tutorialProvenance!.source.uri,
          title: first.packet!.context.tutorialProvenance!.source.title,
          durationMs: first.packet!.context.tutorialProvenance!.source.durationMs,
          rightsStatus: first.packet!.context.tutorialProvenance!.source.rightsStatus,
        },
        transcript: {
          origin: 'local_media_analysis',
          locale: 'en',
          localMediaAnalysis:
            first.packet!.context.tutorialProvenance!.transcript.localMediaAnalysis,
          segments: first.packet!.context.tutorialProvenance!.transcript.segments.map(
            (segment) => ({
              startMs: segment.locator.startMs,
              endMs: segment.locator.endMs,
              text: segment.text,
              confidence: segment.confidence,
            }),
          ),
        },
      },
    };
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-request.schema.json'),
      [{ value: forgedPublicLocalMediaRequest, accepted: false }],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-generate-request.schema.json'),
      [
        {
          value: {
            ...forgedPublicLocalMediaRequest,
            requestId: '77777777-7777-4777-8777-777777777777',
            providerId: 'procedure-author',
          },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-media-authoring-preparation.schema.json'),
      [
        { value: first, accepted: true },
        {
          value: {
            ...first,
            evidenceBindings: first.evidenceBindings.map((binding) => ({
              ...binding,
              promptEvidenceId: null,
            })),
          },
          accepted: false,
        },
        {
          value: {
            ...first,
            quality: {
              ...first.quality,
              blockers: [
                {
                  code: 'no_semantic_segments',
                  message: 'invalid ready blocker',
                  semanticSegmentIds: [],
                },
              ],
            },
          },
          accepted: false,
        },
        {
          value: {
            ...first,
            status: 'blocked',
            packet: null,
            evidenceBindings: first.evidenceBindings.map((binding) => ({
              ...binding,
              promptEvidenceId: null,
            })),
            quality: { ...first.quality, blockers: [] },
          },
          accepted: false,
        },
      ],
    );
    const wrongRightsPacket = structuredClone(first.packet!);
    wrongRightsPacket.context.tutorialProvenance!.source.rightsStatus = 'public_domain';
    const callerLicensedPacket = structuredClone(first.packet!);
    Object.assign(callerLicensedPacket.context.tutorialProvenance!.source, {
      license: 'caller-controlled',
    });
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-packet.schema.json'),
      [
        { value: first.packet, accepted: true },
        {
          value: { ...first.packet!, formatVersion: '1.1.0' },
          accepted: false,
        },
        { value: wrongRightsPacket, accepted: false },
        { value: callerLicensedPacket, accepted: false },
      ],
    );
    expect(
      procedureTutorialMediaAuthoringPreparationSchema.safeParse({
        ...first,
        analysisRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }).success,
    ).toBe(false);
    expect(
      procedureTutorialMediaAuthoringPreparationSchema.safeParse({
        ...first,
        evidenceBindings: first.evidenceBindings.map((binding, index) =>
          index === 0 ? { ...binding, asrSegmentIds: [] } : binding,
        ),
      }).success,
    ).toBe(false);
  });

  it('fails closed when artifact verification rejects or substitutes content', async () => {
    const rejected = input();
    rejected.verifyAnalysis.mockRejectedValueOnce(new Error('artifact integrity failed'));
    await expect(prepareProcedureTutorialMediaAuthoring(rejected)).rejects.toThrow(
      'artifact integrity failed',
    );

    const substituted = input();
    substituted.verifyAnalysis.mockImplementationOnce(async (value) => ({
      ...value,
      completedAt: '2026-08-20T00:00:01.000Z',
    }));
    await expect(prepareProcedureTutorialMediaAuthoring(substituted)).rejects.toThrow(
      'different from the input',
    );
  });

  it('derives local-media rights from verified analysis authorization without license text', async () => {
    const licensed = input();
    licensed.source = {
      ...licensed.source,
      rightsBasis: 'license_verified',
    };
    licensed.analysis = {
      ...licensed.analysis,
      source: licensed.source,
      manifestIntegrity: { ...licensed.analysis.manifestIntegrity, source: licensed.source },
    };
    const prepared = await prepareProcedureTutorialMediaAuthoring(licensed);

    expect(prepared.status).toBe('ready');
    expect(prepared.packet?.context.tutorialProvenance).toMatchObject({
      source: { rightsStatus: 'license_verified' },
      transcript: {
        origin: 'local_media_analysis',
        localMediaAnalysis: {
          source: { rightsBasis: 'license_verified' },
        },
      },
    });
    expect(prepared.packet?.context.tutorialProvenance?.source).not.toHaveProperty('license');

    const packet = structuredClone(prepared.packet!);
    packet.context.tutorialProvenance!.transcript.localMediaAnalysis!.semanticBindings[0]!.promptEvidenceId =
      'evidence.wrong';
    expect(procedureAuthoringPromptPacketSchema.safeParse(packet).success).toBe(false);
    const downgraded = structuredClone(prepared.packet!);
    downgraded.formatVersion = '1.1.0';
    expect(procedureAuthoringPromptPacketSchema.safeParse(downgraded).success).toBe(false);

    await expect(
      prepareProcedureTutorialMediaAuthoring({
        ...licensed,
        source: { ...licensed.source, sourceIdentitySha256: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('different from the input');
  });

  it('blocks low-signal segments without constructing a prompt packet', async () => {
    const result = analysis();
    const lowSignal: ProcedureTutorialMediaCurrentAnalysisResult = {
      ...result,
      semanticSegments: result.semanticSegments.map((segment) => ({
        ...segment,
        asrSegmentIds: [],
        ocrCandidateIds: [],
        uiCandidateIds: [],
        shortcutCandidateIds: [],
      })),
    };
    const prepared = await prepareProcedureTutorialMediaAuthoring(input(lowSignal));

    expect(prepared.status).toBe('blocked');
    expect(prepared.packet).toBeNull();
    expect(prepared.evidenceBindings.map((binding) => binding.promptEvidenceId)).toEqual([
      null,
      null,
    ]);
    expect(prepared.quality.coverage).toMatchObject({
      asr: 0,
      frameEvidence: 1,
      visual: 0,
    });
    expect(prepared.quality.blockers).toEqual([
      {
        code: 'semantic_segment_has_no_grounding_signal',
        message: 'A semantic segment has neither ASR nor visual grounding candidates.',
        semanticSegmentIds: [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ],
      },
    ]);
  });

  it('blocks ASR without overlap and visual candidates outside the semantic interval', async () => {
    const result = analysis();
    const crossTimed: ProcedureTutorialMediaCurrentAnalysisResult = {
      ...result,
      semanticSegments: [
        {
          ...result.semanticSegments[0]!,
          asrSegmentIds: [result.asrSegments[1]!.segmentId],
          ocrCandidateIds: [],
          uiCandidateIds: [],
          shortcutCandidateIds: [result.shortcutCandidates[0]!.candidateId],
        },
        {
          ...result.semanticSegments[1]!,
          asrSegmentIds: [result.asrSegments[0]!.segmentId],
          ocrCandidateIds: [result.ocrCandidates[0]!.candidateId],
          uiCandidateIds: [result.uiCandidates[0]!.candidateId],
          shortcutCandidateIds: [],
        },
      ],
    };
    const prepared = await prepareProcedureTutorialMediaAuthoring(input(crossTimed));

    expect(prepared.status).toBe('blocked');
    expect(prepared.quality.coverage).toMatchObject({ asr: 0, visual: 0, ocr: 0, ui: 0 });
    expect(prepared.quality.blockers.map((blocker) => blocker.code)).toEqual([
      'semantic_segment_grounding_outside_time_range',
      'semantic_segment_has_no_grounding_signal',
    ]);
    expect(prepared.quality.blockers[0]?.semanticSegmentIds).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });
});
