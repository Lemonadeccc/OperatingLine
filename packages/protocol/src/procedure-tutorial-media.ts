import { z } from 'zod';

import { procedureAuthoringYoutubeVideoIdSchema } from './procedure-authoring.js';

export const procedureTutorialMediaFormatVersion = '1.0.0' as const;
export const procedureTutorialMediaFormatVersionSchema = z.literal(
  procedureTutorialMediaFormatVersion,
);

export const procedureTutorialMediaStageSchema = z.enum([
  'download',
  'probe',
  'audio',
  'asr',
  'frames',
  'ocr',
  'segmentation',
]);
export type ProcedureTutorialMediaStage = z.infer<typeof procedureTutorialMediaStageSchema>;

const stages = procedureTutorialMediaStageSchema.options;
const stageIndex = new Map(stages.map((stage, index) => [stage, index]));
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueAuthorizationReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const localeSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/);
const millisecondsSchema = z.number().int().nonnegative().max(86_400_000);
const confidenceSchema = z.number().min(0).max(1);
export const procedureTutorialMediaArtifactMaxCount = 500 as const;
export const procedureTutorialMediaAsrSegmentMaxCount = 2_000 as const;
export const procedureTutorialMediaFrameMaxCount = 120 as const;
export const procedureTutorialMediaVisualCandidateMaxCount = 20_000 as const;
export const procedureTutorialMediaSemanticSegmentMaxCount = 2_000 as const;

function requireUniqueStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `${label} must be unique`,
      });
    }
    seen.add(value);
  }
}

const completeStageListSchema = z.tuple([
  z.literal('download'),
  z.literal('probe'),
  z.literal('audio'),
  z.literal('asr'),
  z.literal('frames'),
  z.literal('ocr'),
  z.literal('segmentation'),
]);
const completedStageListSchema = z.union([
  z.tuple([]),
  z.tuple([z.literal('download')]),
  z.tuple([z.literal('download'), z.literal('probe')]),
  z.tuple([z.literal('download'), z.literal('probe'), z.literal('audio')]),
  z.tuple([z.literal('download'), z.literal('probe'), z.literal('audio'), z.literal('asr')]),
  z.tuple([
    z.literal('download'),
    z.literal('probe'),
    z.literal('audio'),
    z.literal('asr'),
    z.literal('frames'),
  ]),
  z.tuple([
    z.literal('download'),
    z.literal('probe'),
    z.literal('audio'),
    z.literal('asr'),
    z.literal('frames'),
    z.literal('ocr'),
  ]),
]);

const authorizationAttestationSchema = z.strictObject({
  reference: opaqueAuthorizationReferenceSchema,
  confirmedAt: z.iso.datetime({ offset: true }),
});

export const procedureTutorialMediaAnalysisRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaFormatVersionSchema,
    requestId: z.uuid(),
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    analysisProfile: z.literal('youtube_tutorial_evidence_v1'),
    locale: localeSchema,
    analysisWindow: z.strictObject({
      startMs: millisecondsSchema,
      endMs: millisecondsSchema.positive(),
    }),
    requestedStages: completeStageListSchema,
    rightsAuthorization: z.discriminatedUnion('basis', [
      z.strictObject({
        basis: z.literal('rights_holder_permission'),
        ...authorizationAttestationSchema.shape,
      }),
      z.strictObject({
        basis: z.literal('license_verified'),
        ...authorizationAttestationSchema.shape,
      }),
      z.strictObject({
        basis: z.literal('public_domain_verified'),
        ...authorizationAttestationSchema.shape,
      }),
    ]),
    platformDownloadAuthorization: z.strictObject({
      basis: z.literal('youtube_written_approval'),
      ...authorizationAttestationSchema.shape,
    }),
    approvals: z.strictObject({
      networkAccessApproved: z.literal(true),
      mediaDownloadApproved: z.literal(true),
      retentionApproved: z.literal(true),
    }),
  })
  .superRefine((request, context) => {
    if (request.analysisWindow.endMs <= request.analysisWindow.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['analysisWindow', 'endMs'],
        message: 'Analysis window end must be greater than its start',
      });
    }
    if (request.rightsAuthorization.reference === request.platformDownloadAuthorization.reference) {
      context.addIssue({
        code: 'custom',
        path: ['platformDownloadAuthorization', 'reference'],
        message: 'Rights and platform authorization references must be distinct',
      });
    }
  });
export type ProcedureTutorialMediaAnalysisRequest = z.infer<
  typeof procedureTutorialMediaAnalysisRequestSchema
>;

export const procedureTutorialMediaArtifactRoleSchema = z.enum([
  'source_video',
  'audio_track',
  'evidence_frame',
  'asr_transcript',
  'ocr_observations',
  'analysis_manifest',
]);
export const procedureTutorialMediaTypeSchema = z.enum([
  'video/mp4',
  'audio/wav',
  'image/png',
  'application/json',
]);

export const procedureTutorialMediaArtifactRefSchema = z
  .strictObject({
    uri: z.string().regex(/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/),
    role: procedureTutorialMediaArtifactRoleSchema,
    mediaType: procedureTutorialMediaTypeSchema,
    sha256: sha256Schema,
    bytes: z.number().int().positive().max(100_000_000_000),
    sourceSha256: sha256Schema.optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((artifact, context) => {
    if (artifact.uri !== `operatingline-media://sha256/${artifact.sha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['uri'],
        message: 'Artifact URI hash must equal sha256',
      });
    }
    const allowedMediaTypes: Record<
      z.infer<typeof procedureTutorialMediaArtifactRoleSchema>,
      readonly string[]
    > = {
      source_video: ['video/mp4'],
      audio_track: ['audio/wav'],
      evidence_frame: ['image/png'],
      asr_transcript: ['application/json'],
      ocr_observations: ['application/json'],
      analysis_manifest: ['application/json'],
    };
    if (!allowedMediaTypes[artifact.role].includes(artifact.mediaType)) {
      context.addIssue({
        code: 'custom',
        path: ['mediaType'],
        message: 'Artifact media type is incompatible with its role',
      });
    }
    if (artifact.role !== 'source_video' && artifact.sourceSha256 === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSha256'],
        message: 'Derived artifacts must bind to the source media hash',
      });
    }
    if (artifact.role === 'source_video' && artifact.sourceSha256 !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSha256'],
        message: 'Source video cannot declare a source hash',
      });
    }
  });
export type ProcedureTutorialMediaArtifactRef = z.infer<
  typeof procedureTutorialMediaArtifactRefSchema
>;

export const procedureTutorialMediaToolProvenanceSchema = z.strictObject({
  toolId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  toolVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
  invocationContractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  executableSha256: sha256Schema,
  versionOutputSha256: sha256Schema,
  normalizedInvocationSha256: sha256Schema,
  configurationSha256: sha256Schema,
  environmentPolicy: z.enum([
    'network_download_only',
    'local_media_processing_no_network',
    'local_inference_no_network',
  ]),
  modelSha256: sha256Schema.optional(),
});

export const procedureTutorialMediaProbeSchema = z
  .strictObject({
    sourceArtifactUri: procedureTutorialMediaArtifactRefSchema.shape.uri,
    container: z.enum(['mp4']),
    durationMs: millisecondsSchema.positive(),
    video: z.strictObject({
      codec: z.enum(['h264', 'hevc', 'vp9', 'av1']),
      width: z.number().int().positive().max(16_384),
      height: z.number().int().positive().max(16_384),
      frameRate: z.number().positive().max(1_000),
      frameCount: z.number().int().positive().max(100_000_000),
    }),
    audio: z
      .strictObject({
        codec: z.enum(['aac', 'opus', 'mp3']),
        channels: z.number().int().min(1).max(32),
        sampleRateHz: z.number().int().min(8_000).max(384_000),
      })
      .nullable(),
  })
  .superRefine((probe, context) => {
    const expectedFrames = (probe.durationMs / 1_000) * probe.video.frameRate;
    const tolerance = Math.max(2, expectedFrames * 0.02);
    if (Math.abs(probe.video.frameCount - expectedFrames) > tolerance) {
      context.addIssue({
        code: 'custom',
        path: ['video', 'frameCount'],
        message: 'Frame count must agree with duration and frame rate within two percent',
      });
    }
  });

export const procedureTutorialMediaAsrSegmentSchema = z
  .strictObject({
    segmentId: z.uuid(),
    order: z.number().int().positive(),
    startMs: millisecondsSchema,
    endMs: millisecondsSchema.positive(),
    text: z.string().min(1).max(20_000).regex(/\S/),
    locale: localeSchema,
    confidence: confidenceSchema.nullable(),
    metrics: z.strictObject({
      averageLogProbability: z.number().min(-100).max(0).nullable(),
      noSpeechProbability: confidenceSchema.nullable(),
      compressionRatio: z.number().nonnegative().max(100).nullable(),
    }),
  })
  .superRefine((segment, context) => {
    if (segment.endMs <= segment.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['endMs'],
        message: 'ASR segment end must follow start',
      });
    }
  });

export const procedureTutorialMediaFrameSchema = z.strictObject({
  frameId: z.uuid(),
  order: z.number().int().positive(),
  timestampMs: millisecondsSchema,
  artifact: procedureTutorialMediaArtifactRefSchema,
});

const normalizedBoundsSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .superRefine((bounds, context) => {
    if (bounds.x + bounds.width > 1) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'Bounds must fit horizontally',
      });
    }
    if (bounds.y + bounds.height > 1) {
      context.addIssue({ code: 'custom', path: ['height'], message: 'Bounds must fit vertically' });
    }
  });

const visualCandidateCommonShape = {
  candidateId: z.uuid(),
  frameId: z.uuid(),
  bounds: normalizedBoundsSchema,
  confidence: confidenceSchema,
} as const;

export const procedureTutorialMediaOcrCandidateSchema = z.strictObject({
  ...visualCandidateCommonShape,
  text: z.string().min(1).max(4_096).regex(/\S/),
  locale: localeSchema.nullable(),
});

export const procedureTutorialMediaUiCandidateSchema = z.strictObject({
  ...visualCandidateCommonShape,
  role: z.enum(['menu', 'menu_item', 'button', 'field', 'panel', 'workspace', 'dialog']),
  label: z.string().min(1).max(1_024).regex(/\S/),
});

export const procedureTutorialMediaShortcutCandidateSchema = z.strictObject({
  candidateId: z.uuid(),
  frameId: z.uuid(),
  timestampMs: millisecondsSchema,
  keys: z
    .array(
      z
        .string()
        .min(1)
        .max(32)
        .regex(/^[A-Za-z0-9][A-Za-z0-9 _+-]*$/),
    )
    .min(1)
    .max(8)
    .superRefine((keys, context) =>
      requireUniqueStrings(
        keys.map((key) => key.toLowerCase()),
        context,
        [],
        'Shortcut keys',
      ),
    ),
  confidence: confidenceSchema,
});

export const procedureTutorialMediaEvidenceReferenceSchema = z.strictObject({
  artifactUri: procedureTutorialMediaArtifactRefSchema.shape.uri,
  frameId: z.uuid().optional(),
  timestampMs: millisecondsSchema,
});

export const procedureTutorialMediaSemanticSegmentSchema = z
  .strictObject({
    segmentId: z.uuid(),
    order: z.number().int().positive(),
    startMs: millisecondsSchema,
    endMs: millisecondsSchema.positive(),
    canonicalDescription: z.string().min(1).max(4_096).regex(/\S/),
    confidence: confidenceSchema,
    asrSegmentIds: z.array(z.uuid()).max(1_000),
    ocrCandidateIds: z.array(z.uuid()).max(1_000),
    uiCandidateIds: z.array(z.uuid()).max(1_000),
    shortcutCandidateIds: z.array(z.uuid()).max(1_000),
    evidence: z.array(procedureTutorialMediaEvidenceReferenceSchema).min(1).max(2_000),
  })
  .superRefine((segment, context) => {
    if (segment.endMs <= segment.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['endMs'],
        message: 'Semantic segment end must follow start',
      });
    }
    for (const key of [
      'asrSegmentIds',
      'ocrCandidateIds',
      'uiCandidateIds',
      'shortcutCandidateIds',
    ] as const) {
      requireUniqueStrings(segment[key], context, [key], `${key} references`);
    }
    requireUniqueStrings(
      segment.evidence.map(
        (item) => `${item.artifactUri}:${item.frameId ?? ''}:${item.timestampMs}`,
      ),
      context,
      ['evidence'],
      'Semantic evidence references',
    );
  });

export const procedureTutorialMediaSideEffectsSchema = z.strictObject({
  networkFetched: z.literal(true),
  mediaDownloaded: z.literal(true),
  audioDerived: z.literal(true),
  framesDerived: z.literal(true),
  localAsrModelRun: z.literal(true),
  localOcrRun: z.literal(true),
  providerCalled: z.literal(false),
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});

export const procedureTutorialMediaManifestIntegritySchema = z.strictObject({
  manifestArtifactUri: procedureTutorialMediaArtifactRefSchema.shape.uri,
  manifestSha256: sha256Schema,
  artifactCount: z.number().int().positive().max(procedureTutorialMediaArtifactMaxCount),
  rootSha256: sha256Schema,
  generatedAt: z.iso.datetime({ offset: true }),
});

export const procedureTutorialMediaAnalysisResultSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaFormatVersionSchema,
    requestId: z.uuid(),
    jobId: z.uuid(),
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    analysisProfile: z.literal('youtube_tutorial_evidence_v1'),
    locale: localeSchema,
    analysisWindow: z.strictObject({
      startMs: millisecondsSchema,
      endMs: millisecondsSchema.positive(),
    }),
    completedStages: completeStageListSchema,
    artifacts: z
      .array(procedureTutorialMediaArtifactRefSchema)
      .min(1)
      .max(procedureTutorialMediaArtifactMaxCount),
    tools: z.array(procedureTutorialMediaToolProvenanceSchema).min(1).max(128),
    probe: procedureTutorialMediaProbeSchema,
    asrSegments: z
      .array(procedureTutorialMediaAsrSegmentSchema)
      .max(procedureTutorialMediaAsrSegmentMaxCount),
    frames: z
      .array(procedureTutorialMediaFrameSchema)
      .min(1)
      .max(procedureTutorialMediaFrameMaxCount),
    ocrCandidates: z
      .array(procedureTutorialMediaOcrCandidateSchema)
      .max(procedureTutorialMediaVisualCandidateMaxCount),
    uiCandidates: z
      .array(procedureTutorialMediaUiCandidateSchema)
      .max(procedureTutorialMediaVisualCandidateMaxCount),
    shortcutCandidates: z
      .array(procedureTutorialMediaShortcutCandidateSchema)
      .max(procedureTutorialMediaVisualCandidateMaxCount),
    semanticSegments: z
      .array(procedureTutorialMediaSemanticSegmentSchema)
      .max(procedureTutorialMediaSemanticSegmentMaxCount),
    segmentation: z.strictObject({
      algorithmId: z.literal('operatingline.deterministic_tutorial_segmentation'),
      algorithmVersion: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
      inputSha256: sha256Schema,
      outputSha256: sha256Schema,
    }),
    sideEffects: procedureTutorialMediaSideEffectsSchema,
    manifestIntegrity: procedureTutorialMediaManifestIntegritySchema,
    completedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((result, context) => {
    if (result.requestId === result.jobId) {
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Service-generated job id must differ from the client request id',
      });
    }
    if (result.analysisWindow.endMs <= result.analysisWindow.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['analysisWindow', 'endMs'],
        message: 'Analysis window end must follow start',
      });
    }
    const artifactByUri = new Map(result.artifacts.map((artifact) => [artifact.uri, artifact]));
    requireUniqueStrings(
      result.artifacts.map((artifact) => artifact.uri),
      context,
      ['artifacts'],
      'Artifact URIs',
    );
    requireUniqueStrings(
      result.tools.map((tool) => tool.toolId),
      context,
      ['tools'],
      'Tool ids',
    );
    const sourceArtifacts = result.artifacts.filter((artifact) => artifact.role === 'source_video');
    if (sourceArtifacts.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Exactly one source video artifact is required',
      });
    }
    for (const role of [
      'audio_track',
      'asr_transcript',
      'ocr_observations',
      'analysis_manifest',
    ] as const) {
      if (result.artifacts.filter((artifact) => artifact.role === role).length !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts'],
          message: `Exactly one ${role} artifact is required`,
        });
      }
    }
    if (
      result.artifacts.filter((artifact) => artifact.role === 'evidence_frame').length !==
      result.frames.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Evidence-frame artifact count must equal frame record count',
      });
    }
    const sourceHash = sourceArtifacts[0]?.sha256;
    if (
      result.completedStages.length !== stages.length ||
      result.completedStages.some((stage, index) => stage !== stages[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedStages'],
        message: 'Analysis results require the complete canonical media pipeline',
      });
    }
    for (const [index, artifact] of result.artifacts.entries()) {
      if (artifact.role !== 'source_video' && artifact.sourceSha256 !== sourceHash) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'sourceSha256'],
          message: 'Derived artifact must bind to the declared source video',
        });
      }
      if (Date.parse(artifact.createdAt) > Date.parse(result.completedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'createdAt'],
          message: 'Artifact creation cannot follow analysis completion',
        });
      }
    }
    const requireUniqueIds = <Value extends { readonly order: number }>(
      values: readonly Value[],
      idOf: (value: Value) => string,
      path: string,
    ) => {
      requireUniqueStrings(values.map(idOf), context, [path], `${path} ids`);
      for (const [index, value] of values.entries()) {
        if (value.order !== index + 1) {
          context.addIssue({
            code: 'custom',
            path: [path, index, 'order'],
            message: `${path} order must be contiguous and one-based`,
          });
        }
      }
    };
    requireUniqueIds(result.asrSegments, (value) => value.segmentId, 'asrSegments');
    requireUniqueIds(result.frames, (value) => value.frameId, 'frames');
    requireUniqueIds(result.semanticSegments, (value) => value.segmentId, 'semanticSegments');
    const frameIds = new Set(result.frames.map((frame) => frame.frameId));
    const asrIds = new Set(result.asrSegments.map((segment) => segment.segmentId));
    const ocrIds = new Set(result.ocrCandidates.map((candidate) => candidate.candidateId));
    const uiIds = new Set(result.uiCandidates.map((candidate) => candidate.candidateId));
    const shortcutIds = new Set(
      result.shortcutCandidates.map((candidate) => candidate.candidateId),
    );
    requireUniqueStrings([...ocrIds], context, ['ocrCandidates'], 'OCR candidate ids');
    requireUniqueStrings([...uiIds], context, ['uiCandidates'], 'UI candidate ids');
    requireUniqueStrings(
      [...shortcutIds],
      context,
      ['shortcutCandidates'],
      'Shortcut candidate ids',
    );
    requireUniqueStrings(
      [
        ...result.asrSegments.map((segment) => segment.segmentId),
        ...result.frames.map((frame) => frame.frameId),
        ...result.ocrCandidates.map((candidate) => candidate.candidateId),
        ...result.uiCandidates.map((candidate) => candidate.candidateId),
        ...result.shortcutCandidates.map((candidate) => candidate.candidateId),
        ...result.semanticSegments.map((segment) => segment.segmentId),
      ],
      context,
      [],
      'All analysis record ids',
    );
    for (const [index, frame] of result.frames.entries()) {
      if (
        frame.timestampMs < result.analysisWindow.startMs ||
        frame.timestampMs > result.analysisWindow.endMs
      ) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'timestampMs'],
          message: 'Frame timestamp must be inside the analysis window',
        });
      }
      const declaredArtifact = artifactByUri.get(frame.artifact.uri);
      if (
        frame.artifact.role !== 'evidence_frame' ||
        declaredArtifact === undefined ||
        declaredArtifact.sha256 !== frame.artifact.sha256 ||
        declaredArtifact.bytes !== frame.artifact.bytes ||
        declaredArtifact.mediaType !== frame.artifact.mediaType
      ) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'artifact'],
          message: 'Frame must reference a declared evidence-frame artifact',
        });
      }
      if (index > 0 && frame.timestampMs <= result.frames[index - 1]!.timestampMs) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'timestampMs'],
          message: 'Frame timestamps must be strictly increasing',
        });
      }
    }
    const checkVisualCandidates = (
      values: readonly { frameId: string; candidateId: string }[],
      path: string,
    ) => {
      requireUniqueStrings(
        values.map((value) => value.candidateId),
        context,
        [path],
        `${path} ids`,
      );
      for (const [index, value] of values.entries()) {
        if (!frameIds.has(value.frameId))
          context.addIssue({
            code: 'custom',
            path: [path, index, 'frameId'],
            message: 'Candidate must reference a declared frame',
          });
      }
    };
    checkVisualCandidates(result.ocrCandidates, 'ocrCandidates');
    checkVisualCandidates(result.uiCandidates, 'uiCandidates');
    checkVisualCandidates(result.shortcutCandidates, 'shortcutCandidates');
    const frameById = new Map(result.frames.map((frame) => [frame.frameId, frame]));
    for (const [index, candidate] of result.shortcutCandidates.entries()) {
      if (frameById.get(candidate.frameId)?.timestampMs !== candidate.timestampMs) {
        context.addIssue({
          code: 'custom',
          path: ['shortcutCandidates', index, 'timestampMs'],
          message: 'Shortcut timestamp must equal its evidence frame timestamp',
        });
      }
    }
    for (const [index, segment] of result.asrSegments.entries()) {
      if (
        segment.startMs < result.analysisWindow.startMs ||
        segment.endMs > result.analysisWindow.endMs ||
        (index > 0 && segment.startMs < result.asrSegments[index - 1]!.endMs)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['asrSegments', index],
          message: 'ASR segments must be ordered inside the analysis window',
        });
      }
    }
    for (const [index, segment] of result.semanticSegments.entries()) {
      if (
        segment.startMs < result.analysisWindow.startMs ||
        segment.endMs > result.analysisWindow.endMs ||
        (index > 0 && segment.startMs < result.semanticSegments[index - 1]!.endMs)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['semanticSegments', index],
          message: 'Semantic segments must be non-overlapping and inside the analysis window',
        });
      }
      const referenceGroups = [
        ['asrSegmentIds', segment.asrSegmentIds, asrIds],
        ['ocrCandidateIds', segment.ocrCandidateIds, ocrIds],
        ['uiCandidateIds', segment.uiCandidateIds, uiIds],
        ['shortcutCandidateIds', segment.shortcutCandidateIds, shortcutIds],
      ] as const;
      for (const [key, ids, available] of referenceGroups) {
        for (const id of ids)
          if (!available.has(id))
            context.addIssue({
              code: 'custom',
              path: ['semanticSegments', index, key],
              message: `${key} must reference declared candidates`,
            });
      }
      for (const [evidenceIndex, evidence] of segment.evidence.entries()) {
        const evidenceFrame =
          evidence.frameId === undefined ? undefined : frameById.get(evidence.frameId);
        if (
          !artifactByUri.has(evidence.artifactUri) ||
          (evidence.frameId !== undefined && evidenceFrame === undefined) ||
          (evidenceFrame !== undefined &&
            (evidenceFrame.artifact.uri !== evidence.artifactUri ||
              evidenceFrame.timestampMs !== evidence.timestampMs)) ||
          evidence.timestampMs < segment.startMs ||
          evidence.timestampMs > segment.endMs
        ) {
          context.addIssue({
            code: 'custom',
            path: ['semanticSegments', index, 'evidence', evidenceIndex],
            message:
              'Evidence must reference declared artifacts and fall inside its semantic segment',
          });
        }
      }
    }
    const manifestArtifact = artifactByUri.get(result.manifestIntegrity.manifestArtifactUri);
    if (
      manifestArtifact?.role !== 'analysis_manifest' ||
      manifestArtifact.sha256 !== result.manifestIntegrity.manifestSha256 ||
      result.manifestIntegrity.artifactCount !== result.artifacts.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['manifestIntegrity'],
        message:
          'Manifest integrity must bind to the declared manifest artifact and artifact count',
      });
    }
    if (Date.parse(result.manifestIntegrity.generatedAt) > Date.parse(result.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['manifestIntegrity', 'generatedAt'],
        message: 'Manifest generation cannot follow analysis completion',
      });
    }
    if (result.probe.sourceArtifactUri !== sourceArtifacts[0]?.uri) {
      context.addIssue({
        code: 'custom',
        path: ['probe', 'sourceArtifactUri'],
        message: 'Probe must reference the declared source video',
      });
    }
    if (result.probe.audio === null) {
      context.addIssue({
        code: 'custom',
        path: ['probe', 'audio'],
        message: 'Completed ASR analysis requires a detected audio stream',
      });
    }
    if (
      !result.tools.some(
        (tool) =>
          tool.environmentPolicy === 'local_inference_no_network' && tool.modelSha256 !== undefined,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'Completed ASR analysis requires model-bound local inference provenance',
      });
    }
    if (result.probe.durationMs < result.analysisWindow.endMs) {
      context.addIssue({
        code: 'custom',
        path: ['probe', 'durationMs'],
        message: 'Probe duration must cover the analysis window',
      });
    }
  });
export type ProcedureTutorialMediaAnalysisResult = z.infer<
  typeof procedureTutorialMediaAnalysisResultSchema
>;

export const procedureTutorialMediaJobErrorCodeSchema = z.enum([
  'authorization_required',
  'authorization_expired',
  'download_rejected',
  'source_unavailable',
  'quota_exceeded',
  'unsupported_locale',
  'deadline_exceeded',
  'unsupported_media',
  'probe_failed',
  'audio_failed',
  'asr_failed',
  'frame_extraction_failed',
  'ocr_failed',
  'segmentation_failed',
  'integrity_failed',
  'cancelled',
  'internal_error',
]);
export const procedureTutorialMediaJobErrorSchema = z.strictObject({
  code: procedureTutorialMediaJobErrorCodeSchema,
  message: z.string().min(1).max(1_000).regex(/\S/),
  retryable: z.boolean(),
  stage: procedureTutorialMediaStageSchema.nullable(),
});

const jobStatusCommonShape = {
  formatVersion: procedureTutorialMediaFormatVersionSchema,
  requestId: z.uuid(),
  jobId: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
} as const;

export const procedureTutorialMediaJobStatusSchema = z
  .discriminatedUnion('status', [
    z
      .strictObject({
        ...jobStatusCommonShape,
        status: z.literal('accepted'),
        acceptedAt: z.iso.datetime({ offset: true }),
      })
      .superRefine((status, context) => {
        if (Date.parse(status.updatedAt) < Date.parse(status.acceptedAt)) {
          context.addIssue({
            code: 'custom',
            path: ['updatedAt'],
            message: 'Status update cannot precede acceptance',
          });
        }
      }),
    z
      .strictObject({
        ...jobStatusCommonShape,
        status: z.literal('running'),
        currentStage: procedureTutorialMediaStageSchema,
        completedStages: completedStageListSchema,
        progress: z.number().min(0).max(1),
        startedAt: z.iso.datetime({ offset: true }),
      })
      .superRefine((status, context) => {
        if (
          status.completedStages.some(
            (stage) => stageIndex.get(stage)! >= stageIndex.get(status.currentStage)!,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['completedStages'],
            message: 'Completed stages must precede the current stage',
          });
        }
        if (Date.parse(status.updatedAt) < Date.parse(status.startedAt))
          context.addIssue({
            code: 'custom',
            path: ['updatedAt'],
            message: 'Update time must not precede start time',
          });
      }),
    z
      .strictObject({
        ...jobStatusCommonShape,
        status: z.literal('recovery_required'),
        recoveryId: z.uuid(),
        retryFromStage: z.literal('download'),
        completedStages: z.tuple([]),
        error: procedureTutorialMediaJobErrorSchema,
      })
      .superRefine((status, context) => {
        if (!status.error.retryable)
          context.addIssue({
            code: 'custom',
            path: ['error', 'retryable'],
            message: 'Recovery-required errors must be retryable',
          });
      }),
    z
      .strictObject({
        ...jobStatusCommonShape,
        status: z.literal('completed'),
        result: procedureTutorialMediaAnalysisResultSchema,
      })
      .superRefine((status, context) => {
        if (status.requestId !== status.result.requestId || status.jobId !== status.result.jobId) {
          context.addIssue({
            code: 'custom',
            path: ['result'],
            message: 'Completed result must belong to the status request and job',
          });
        }
        if (Date.parse(status.updatedAt) < Date.parse(status.result.completedAt)) {
          context.addIssue({
            code: 'custom',
            path: ['updatedAt'],
            message: 'Status update cannot precede result completion',
          });
        }
      }),
    z
      .strictObject({
        ...jobStatusCommonShape,
        status: z.literal('failed'),
        completedStages: completedStageListSchema,
        error: procedureTutorialMediaJobErrorSchema,
        failedAt: z.iso.datetime({ offset: true }),
      })
      .superRefine((status, context) => {
        if (status.error.retryable)
          context.addIssue({
            code: 'custom',
            path: ['error', 'retryable'],
            message: 'Terminal failed errors cannot be retryable',
          });
        if (Date.parse(status.failedAt) > Date.parse(status.updatedAt))
          context.addIssue({
            code: 'custom',
            path: ['failedAt'],
            message: 'Failure time cannot follow update time',
          });
        if (
          status.error.stage !== null &&
          status.completedStages.some(
            (stage) => stageIndex.get(stage)! >= stageIndex.get(status.error.stage!)!,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['completedStages'],
            message: 'Completed stages must precede the failed stage',
          });
        }
      }),
  ])
  .superRefine((status, context) => {
    if (status.requestId === status.jobId) {
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Service-generated job id must differ from the client request id',
      });
    }
    if (
      status.status === 'recovery_required' &&
      (status.recoveryId === status.requestId || status.recoveryId === status.jobId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryId'],
        message: 'Recovery id must be unique within the job lifecycle',
      });
    }
  });
export type ProcedureTutorialMediaJobStatus = z.infer<typeof procedureTutorialMediaJobStatusSchema>;

export const procedureTutorialMediaJobStatusRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaFormatVersionSchema,
    requestId: z.uuid(),
    jobId: z.uuid(),
  })
  .superRefine((request, context) => {
    if (request.requestId === request.jobId) {
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Service-generated job id must differ from the client request id',
      });
    }
  });
export type ProcedureTutorialMediaJobStatusRequest = z.infer<
  typeof procedureTutorialMediaJobStatusRequestSchema
>;

export const procedureTutorialMediaResumeRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaFormatVersionSchema,
    requestId: z.uuid(),
    jobId: z.uuid(),
    recoveryId: z.uuid(),
    retryFromStage: z.literal('download'),
    approvals: z.strictObject({
      networkAccessApproved: z.literal(true),
      mediaDownloadApproved: z.literal(true),
      retentionApproved: z.literal(true),
    }),
  })
  .superRefine((request, context) => {
    if (new Set([request.requestId, request.jobId, request.recoveryId]).size !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryId'],
        message: 'Resume request, job, and recovery ids must be distinct',
      });
    }
  });
export type ProcedureTutorialMediaResumeRequest = z.infer<
  typeof procedureTutorialMediaResumeRequestSchema
>;

const procedureTutorialMediaCapabilitiesCommonShape = {
  formatVersion: procedureTutorialMediaFormatVersionSchema,
  serviceId: z.literal('operatingline.youtube_tutorial_media'),
  serviceVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
} as const;

export const procedureTutorialMediaCapabilitiesSchema = z
  .discriminatedUnion('availability', [
    z.strictObject({
      ...procedureTutorialMediaCapabilitiesCommonShape,
      availability: z.literal('unavailable'),
      unavailableReasons: z
        .array(
          z.enum([
            'not_configured',
            'tool_missing',
            'model_missing',
            'authorization_registry_missing',
            'unsupported_platform',
            'preflight_failed',
          ]),
        )
        .min(1)
        .max(6),
    }),
    z.strictObject({
      ...procedureTutorialMediaCapabilitiesCommonShape,
      availability: z.literal('available'),
      analysisProfiles: z.array(z.literal('youtube_tutorial_evidence_v1')).length(1),
      supportedLocales: z.array(localeSchema).min(1).max(1_000),
      stages: completeStageListSchema,
      artifactMediaTypes: z
        .array(procedureTutorialMediaTypeSchema)
        .length(procedureTutorialMediaTypeSchema.options.length),
      limits: z.strictObject({
        maxVideoDurationMs: millisecondsSchema.positive(),
        maxAnalysisWindowMs: millisecondsSchema.positive(),
        maxJobRuntimeMs: millisecondsSchema.positive(),
        maxFrames: z.number().int().positive().max(procedureTutorialMediaFrameMaxCount),
        maxConcurrentJobs: z.number().int().positive().max(1_000),
      }),
      features: z.strictObject({
        contentAddressedArtifacts: z.literal(true),
        resumableJobs: z.literal(false),
        explicitFullRestartAfterFailure: z.literal(true),
        deterministicSegmentation: z.literal(true),
        credentialFreePublicProtocol: z.literal(true),
        ocrTextCandidates: z.literal(true),
        shortcutCandidates: z.literal(true),
        uiElementRecognition: z.literal(false),
      }),
    }),
  ])
  .superRefine((capabilities, context) => {
    if (capabilities.availability === 'unavailable') return;
    if (capabilities.stages.some((stage, index) => stage !== stages[index])) {
      context.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Capability stages must use the complete canonical order',
      });
    }
    if (
      capabilities.artifactMediaTypes.some(
        (mediaType, index) => mediaType !== procedureTutorialMediaTypeSchema.options[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['artifactMediaTypes'],
        message: 'Capability media types must use the complete canonical order',
      });
    }
    requireUniqueStrings(
      capabilities.supportedLocales.map((locale) => locale.toLowerCase()),
      context,
      ['supportedLocales'],
      'Supported locales',
    );
  });
export type ProcedureTutorialMediaCapabilities = z.infer<
  typeof procedureTutorialMediaCapabilitiesSchema
>;
