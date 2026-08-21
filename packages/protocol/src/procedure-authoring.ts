import { z } from 'zod';

import { actionCatalogJsonSchemaMetadata, actionCatalogSchema } from './catalog.js';
import { protocolJsonValueCanonicalization } from './canonical-json-value.js';
import { guideStepIdSchema } from './guide.js';
import { interactionCatalogSchema } from './interaction-catalog.js';
import {
  procedureCompilationResultSchema,
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
  procedureTreeSchema,
  procedureTreeFormatVersion,
} from './procedure-tree.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringPromptLegacyFormatVersion = '1.0.0' as const;
export const procedureAuthoringPromptTutorialFormatVersion = '1.1.0' as const;
export const procedureAuthoringPromptDocumentFormatVersion = '1.2.0' as const;
export const procedureAuthoringPromptAcquisitionFormatVersion = '1.3.0' as const;
export const procedureAuthoringPromptFormatVersion = '1.4.0' as const;
export const procedureAuthoringPromptLegacyMediaAnalysisFormatVersion = '1.5.0' as const;
export const procedureAuthoringPromptMediaAnalysisFormatVersion = '1.6.0' as const;
export const supportedProcedureAuthoringPromptFormatVersions = [
  procedureAuthoringPromptLegacyFormatVersion,
  procedureAuthoringPromptTutorialFormatVersion,
  procedureAuthoringPromptDocumentFormatVersion,
  procedureAuthoringPromptAcquisitionFormatVersion,
  procedureAuthoringPromptFormatVersion,
  procedureAuthoringPromptLegacyMediaAnalysisFormatVersion,
  procedureAuthoringPromptMediaAnalysisFormatVersion,
] as const;
export const procedureAuthoringPromptPacketMaxCanonicalBytes = 262_144 as const;
export const procedureAuthoringTutorialSegmentMaxCount = 2_000 as const;
export const procedureAuthoringTutorialTranscriptDocumentMaxBytes = 262_144 as const;
export const procedureAuthoringPromptFormatVersionSchema = z.enum(
  supportedProcedureAuthoringPromptFormatVersions,
);

const procedureAuthoringLocaleSchema = z.string().min(1).max(64).regex(/^\S+$/);
const procedureAuthoringTutorialUriSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^https:\/\/[^\s]+$/, 'Tutorial video URI must be an HTTPS URL');
const procedureAuthoringLocalMediaUriSchema = z
  .string()
  .regex(/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/);
const procedureAuthoringTutorialTitleSchema = z.string().min(1).max(500).regex(/\S/);
const procedureAuthoringTutorialDurationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const procedureAuthoringTutorialLicenseSchema = z.string().min(1).max(1_000).regex(/\S/);

export const procedureAuthoringTutorialVideoInputSchema = z.discriminatedUnion('rightsStatus', [
  z.strictObject({
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('permission_granted'),
    license: procedureAuthoringTutorialLicenseSchema.optional(),
  }),
  z.strictObject({
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('license_verified'),
    license: procedureAuthoringTutorialLicenseSchema,
  }),
  z.strictObject({
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('public_domain'),
    license: procedureAuthoringTutorialLicenseSchema.optional(),
  }),
]);
export type ProcedureAuthoringTutorialVideoInput = z.infer<
  typeof procedureAuthoringTutorialVideoInputSchema
>;

export const procedureAuthoringTutorialTranscriptSegmentSchema = z.strictObject({
  startMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  text: z.string().min(1).max(4_000).regex(/\S/),
  confidence: z.number().min(0).max(1),
});
export type ProcedureAuthoringTutorialTranscriptSegment = z.infer<
  typeof procedureAuthoringTutorialTranscriptSegmentSchema
>;

export const procedureAuthoringYoutubeVideoIdSchema = z
  .string()
  .length(11)
  .regex(/^[A-Za-z0-9_-]{11}$/);
const procedureAuthoringSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const procedureAuthoringMediaRightsBasisSchema = z.enum([
  'rights_holder_permission',
  'license_verified',
  'public_domain_verified',
]);
export const procedureAuthoringMediaSourceValidationReceiptBindingSchema = z.strictObject({
  authorityId: z
    .string()
    .min(1)
    .max(180)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  receiptContentSha256: procedureAuthoringSha256Schema,
  authorityContentSha256: procedureAuthoringSha256Schema,
});
export const procedureAuthoringMediaRightsValidationReceiptBindingSchema =
  procedureAuthoringMediaSourceValidationReceiptBindingSchema.extend({
    authorityKind: z.literal('media_rights_authority'),
    sideEffect: z.literal('rights_validation'),
  });
export const procedureAuthoringYoutubeDownloadValidationReceiptBindingSchema =
  procedureAuthoringMediaSourceValidationReceiptBindingSchema.extend({
    authorityKind: z.literal('youtube_platform_authority'),
    sideEffect: z.literal('youtube_media_download'),
  });
export const procedureAuthoringLocalImportValidationReceiptBindingSchema =
  procedureAuthoringMediaSourceValidationReceiptBindingSchema.extend({
    authorityKind: z.literal('local_import_authority'),
    sideEffect: z.literal('local_media_import'),
  });

function requireDistinctMediaValidationBindings(
  source: {
    readonly rightsValidation: z.infer<
      typeof procedureAuthoringMediaRightsValidationReceiptBindingSchema
    >;
  } & (
    | {
        readonly platformDownloadValidation: z.infer<
          typeof procedureAuthoringYoutubeDownloadValidationReceiptBindingSchema
        >;
      }
    | {
        readonly importValidation: z.infer<
          typeof procedureAuthoringLocalImportValidationReceiptBindingSchema
        >;
      }
  ),
  context: z.RefinementCtx,
): void {
  const acquisitionValidation =
    'platformDownloadValidation' in source
      ? source.platformDownloadValidation
      : source.importValidation;
  if (
    acquisitionValidation.receiptContentSha256 === source.rightsValidation.receiptContentSha256 ||
    acquisitionValidation.authorityContentSha256 ===
      source.rightsValidation.authorityContentSha256 ||
    acquisitionValidation.authorityId === source.rightsValidation.authorityId
  ) {
    context.addIssue({
      code: 'custom',
      path: [
        'platformDownloadValidation' in source ? 'platformDownloadValidation' : 'importValidation',
      ],
      message: 'Acquisition and rights validation receipts must bind distinct authorities',
    });
  }
}

export const procedureAuthoringAuthorizedYoutubeMediaSourceSchema = z
  .strictObject({
    kind: z.literal('authorized_youtube_download'),
    videoId: procedureAuthoringYoutubeVideoIdSchema,
    sourceIdentitySha256: procedureAuthoringSha256Schema,
    contentSha256: procedureAuthoringSha256Schema,
    rightsBasis: procedureAuthoringMediaRightsBasisSchema,
    rightsValidation: procedureAuthoringMediaRightsValidationReceiptBindingSchema,
    platformDownloadValidation: procedureAuthoringYoutubeDownloadValidationReceiptBindingSchema,
  })
  .superRefine(requireDistinctMediaValidationBindings)
  .meta({
    $comment:
      'Role-specific authorityKind and sideEffect literals prevent receipt substitution in JSON Schema. Runtime Zod parsing additionally requires distinct receipt hashes, authority hashes, and authority ids.',
  });
export const procedureAuthoringUserSuppliedLocalMediaSourceSchema = z
  .strictObject({
    kind: z.literal('user_supplied_local_file'),
    sourceIdentitySha256: procedureAuthoringSha256Schema,
    contentSha256: procedureAuthoringSha256Schema,
    rightsBasis: procedureAuthoringMediaRightsBasisSchema,
    importValidation: procedureAuthoringLocalImportValidationReceiptBindingSchema,
    rightsValidation: procedureAuthoringMediaRightsValidationReceiptBindingSchema,
  })
  .superRefine(requireDistinctMediaValidationBindings)
  .meta({
    $comment:
      'Role-specific authorityKind and sideEffect literals prevent receipt substitution in JSON Schema. Runtime Zod parsing additionally requires distinct receipt hashes, authority hashes, and authority ids.',
  });
export const procedureAuthoringMediaSourceSchema = z.union([
  procedureAuthoringAuthorizedYoutubeMediaSourceSchema,
  procedureAuthoringUserSuppliedLocalMediaSourceSchema,
]);
export type ProcedureAuthoringMediaSource = z.infer<typeof procedureAuthoringMediaSourceSchema>;
export const procedureAuthoringYoutubeCaptionTrackIdSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^\S+$/);
export const procedureAuthoringYoutubeCaptionSelectionReasonCodeSchema = z.enum([
  'recommended_candidate',
  'language_preference',
  'caption_quality_review',
  'accessibility_requirement',
  'workflow_requirement',
  'other',
]);
export const procedureAuthoringYoutubeCaptionSelectionSchema = z
  .strictObject({
    requestId: z.uuid(),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    trackListRequestId: z.uuid(),
    confirmedAt: z.iso.datetime({ offset: true }),
    reasonCode: procedureAuthoringYoutubeCaptionSelectionReasonCodeSchema,
    selectedTrackWasRecommended: z.boolean().nullable(),
    selectedCandidateRank: z.number().int().positive().nullable(),
  })
  .superRefine((selection, context) => {
    if (
      selection.selectedTrackWasRecommended === null &&
      selection.selectedCandidateRank !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectedCandidateRank'],
        message: 'Unranked YouTube caption selections cannot declare a candidate rank',
      });
    }
    if (selection.selectedTrackWasRecommended === true && selection.selectedCandidateRank !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['selectedCandidateRank'],
        message: 'The recommended YouTube caption track must have candidate rank 1',
      });
    }
    if (selection.selectedTrackWasRecommended === false && selection.selectedCandidateRank === 1) {
      context.addIssue({
        code: 'custom',
        path: ['selectedCandidateRank'],
        message: 'A non-recommended YouTube caption track cannot have candidate rank 1',
      });
    }
    if (
      selection.reasonCode === 'recommended_candidate' &&
      selection.selectedTrackWasRecommended !== true
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'A recommended-candidate reason must attest the selected first candidate',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { selectedTrackWasRecommended: { const: null } },
          required: ['selectedTrackWasRecommended'],
        },
        then: { properties: { selectedCandidateRank: { const: null } } },
      },
      {
        if: {
          properties: { selectedTrackWasRecommended: { const: true } },
          required: ['selectedTrackWasRecommended'],
        },
        then: { properties: { selectedCandidateRank: { const: 1 } } },
      },
      {
        if: {
          properties: { selectedTrackWasRecommended: { const: false } },
          required: ['selectedTrackWasRecommended'],
        },
        then: { properties: { selectedCandidateRank: { not: { const: 1 } } } },
      },
      {
        if: {
          properties: { reasonCode: { const: 'recommended_candidate' } },
          required: ['reasonCode'],
        },
        then: {
          properties: {
            selectedTrackWasRecommended: { const: true },
            selectedCandidateRank: { const: 1 },
          },
        },
      },
    ],
  });
export type ProcedureAuthoringYoutubeCaptionSelection = z.infer<
  typeof procedureAuthoringYoutubeCaptionSelectionSchema
>;

export const procedureAuthoringYoutubeCaptionAcquisitionSchema = z.strictObject({
  source: z.literal('youtube_data_api_v3'),
  authorization: z.literal('oauth_video_edit_permission'),
  videoId: procedureAuthoringYoutubeVideoIdSchema,
  captionTrackId: procedureAuthoringYoutubeCaptionTrackIdSchema,
  trackLanguage: procedureAuthoringLocaleSchema,
  trackKind: z.enum(['ASR', 'forced', 'standard']),
  isDraft: z.boolean(),
  isAutoSynced: z.boolean(),
  status: z.literal('serving'),
  lastUpdated: z.iso.datetime({ offset: true }),
  requestedFormat: z.enum(['webvtt', 'srt']),
  selection: procedureAuthoringYoutubeCaptionSelectionSchema.optional(),
});
export type ProcedureAuthoringYoutubeCaptionAcquisition = z.infer<
  typeof procedureAuthoringYoutubeCaptionAcquisitionSchema
>;

export const procedureAuthoringTutorialTranscriptDocumentSchema = z.strictObject({
  format: z.enum(['webvtt', 'srt']),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentBytes: z
    .number()
    .int()
    .positive()
    .max(procedureAuthoringTutorialTranscriptDocumentMaxBytes),
  cueCount: z.number().int().positive().max(procedureAuthoringTutorialSegmentMaxCount),
  normalization: z.literal('operatingline-caption-cues-v1'),
  confidence: z.strictObject({
    origin: z.literal('user_declared_default'),
    value: procedureAuthoringTutorialTranscriptSegmentSchema.shape.confidence,
  }),
  acquisition: procedureAuthoringYoutubeCaptionAcquisitionSchema.optional(),
});
export type ProcedureAuthoringTutorialTranscriptDocument = z.infer<
  typeof procedureAuthoringTutorialTranscriptDocumentSchema
>;

export const procedureAuthoringLocalMediaRightsAuthorizationSchema = z.discriminatedUnion('basis', [
  z.strictObject({
    basis: z.literal('rights_holder_permission'),
    reference: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    confirmedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    basis: z.literal('license_verified'),
    reference: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    confirmedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    basis: z.literal('public_domain_verified'),
    reference: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    confirmedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type ProcedureAuthoringLocalMediaRightsAuthorization = z.infer<
  typeof procedureAuthoringLocalMediaRightsAuthorizationSchema
>;

const sha256Schema = procedureAuthoringSha256Schema;
const localMediaArtifactUriSchema = z
  .string()
  .regex(/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/);
const procedureAuthoringLocalMediaAnalysisSchema = z
  .strictObject({
    analysisRequestId: z.uuid(),
    analysisJobId: z.uuid(),
    analysisFingerprint: sha256Schema,
    source: procedureAuthoringMediaSourceSchema.optional(),
    analysisProfile: z.enum(['youtube_tutorial_evidence_v1', 'local_tutorial_evidence_v1']),
    completedAt: z.iso.datetime({ offset: true }),
    rightsAuthorization: procedureAuthoringLocalMediaRightsAuthorizationSchema.optional(),
    manifest: z.strictObject({
      artifactUri: localMediaArtifactUriSchema,
      sha256: sha256Schema,
      rootSha256: sha256Schema,
      source: procedureAuthoringMediaSourceSchema.optional(),
    }),
    tools: z
      .array(
        z.strictObject({
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
          modelSha256: sha256Schema.optional(),
        }),
      )
      .min(1)
      .max(128),
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
    semanticBindings: z
      .array(
        z.strictObject({
          semanticSegmentId: z.uuid(),
          order: z.number().int().positive().max(procedureAuthoringTutorialSegmentMaxCount),
          promptEvidenceId: guideStepIdSchema,
          startMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          endMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          canonicalDescription: z.string().min(1).max(4_096).regex(/\S/),
          asrSegmentIds: z.array(z.uuid()).max(1_000),
          ocrCandidateIds: z.array(z.uuid()).max(1_000),
          uiCandidateIds: z.array(z.uuid()).max(1_000),
          shortcutCandidateIds: z.array(z.uuid()).max(1_000),
          evidence: z
            .array(
              z.strictObject({
                artifactUri: localMediaArtifactUriSchema,
                frameId: z.uuid().optional(),
                timestampMs: z.number().int().nonnegative().max(86_400_000),
              }),
            )
            .min(1)
            .max(2_000),
        }),
      )
      .min(1)
      .max(procedureAuthoringTutorialSegmentMaxCount),
  })
  .superRefine((analysis, context) => {
    if (analysis.analysisRequestId === analysis.analysisJobId) {
      context.addIssue({
        code: 'custom',
        path: ['analysisJobId'],
        message: 'Local media analysis job id must differ from its request id',
      });
    }
    if ((analysis.source === undefined) === (analysis.rightsAuthorization === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['rightsAuthorization'],
        message:
          'Legacy analysis requires raw rights authorization; current analysis uses only source receipt bindings',
      });
    }
    const expectedAnalysisProfile =
      analysis.source?.kind === 'user_supplied_local_file'
        ? 'local_tutorial_evidence_v1'
        : 'youtube_tutorial_evidence_v1';
    if (analysis.analysisProfile !== expectedAnalysisProfile) {
      context.addIssue({
        code: 'custom',
        path: ['analysisProfile'],
        message: 'Analysis profile must match the exact declared media source kind',
      });
    }
    if (
      analysis.manifest.artifactUri !== `operatingline-media://sha256/${analysis.manifest.sha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'artifactUri'],
        message: 'Local media manifest URI must bind its exact digest',
      });
    }
    if (
      (analysis.source === undefined) !== (analysis.manifest.source === undefined) ||
      (analysis.source !== undefined &&
        JSON.stringify(analysis.source) !== JSON.stringify(analysis.manifest.source))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'source'],
        message: 'Media analysis manifest must retain the exact prompt media source',
      });
    }
    if (!analysis.tools.some((tool) => tool.modelSha256 !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'Local media analysis provenance requires at least one exact model digest',
      });
    }
    if (new Set(analysis.tools.map((tool) => tool.toolId)).size !== analysis.tools.length) {
      context.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'Local media analysis tool ids must be unique',
      });
    }
    if (
      new Set(analysis.semanticBindings.map((binding) => binding.semanticSegmentId)).size !==
        analysis.semanticBindings.length ||
      new Set(analysis.semanticBindings.map((binding) => binding.promptEvidenceId)).size !==
        analysis.semanticBindings.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticBindings'],
        message: 'Local media semantic and prompt evidence ids must be unique',
      });
    }
  });

const procedureAuthoringTutorialTranscriptInputSchema = z.discriminatedUnion('origin', [
  z.strictObject({
    origin: z.literal('user_supplied'),
    locale: procedureAuthoringLocaleSchema.optional(),
    segments: z
      .array(procedureAuthoringTutorialTranscriptSegmentSchema)
      .min(1)
      .max(procedureAuthoringTutorialSegmentMaxCount),
  }),
  z.strictObject({
    origin: z.literal('local_media_analysis'),
    locale: procedureAuthoringLocaleSchema,
    localMediaAnalysis: procedureAuthoringLocalMediaAnalysisSchema,
    segments: z
      .array(procedureAuthoringTutorialTranscriptSegmentSchema)
      .min(1)
      .max(procedureAuthoringTutorialSegmentMaxCount),
  }),
]);

const procedureAuthoringLocalMediaTutorialVideoInputSchema = z.discriminatedUnion('rightsStatus', [
  z.strictObject({
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('permission_granted'),
  }),
  z.strictObject({
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('license_verified'),
  }),
  z.strictObject({
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('public_domain'),
  }),
]);

const procedureAuthoringAuthorizedYoutubeMediaTutorialVideoInputSchema = z.discriminatedUnion(
  'rightsStatus',
  [
    z.strictObject({
      uri: procedureAuthoringTutorialUriSchema,
      title: procedureAuthoringTutorialTitleSchema,
      durationMs: procedureAuthoringTutorialDurationSchema,
      rightsStatus: z.literal('permission_granted'),
      license: z.never().optional(),
    }),
    z.strictObject({
      uri: procedureAuthoringTutorialUriSchema,
      title: procedureAuthoringTutorialTitleSchema,
      durationMs: procedureAuthoringTutorialDurationSchema,
      rightsStatus: z.literal('license_verified'),
      license: z.never().optional(),
    }),
    z.strictObject({
      uri: procedureAuthoringTutorialUriSchema,
      title: procedureAuthoringTutorialTitleSchema,
      durationMs: procedureAuthoringTutorialDurationSchema,
      rightsStatus: z.literal('public_domain'),
      license: z.never().optional(),
    }),
  ],
);

export const procedureAuthoringVerifiedTutorialInputSchema = z
  .union([
    z.strictObject({
      video: procedureAuthoringTutorialVideoInputSchema,
      transcript: procedureAuthoringTutorialTranscriptInputSchema.options[0],
    }),
    z.strictObject({
      video: z.union([
        procedureAuthoringAuthorizedYoutubeMediaTutorialVideoInputSchema,
        procedureAuthoringLocalMediaTutorialVideoInputSchema,
      ]),
      transcript: procedureAuthoringTutorialTranscriptInputSchema.options[1],
    }),
  ])
  .superRefine((tutorial, context) => {
    if (tutorial.transcript.origin === 'local_media_analysis') {
      const mediaSource = tutorial.transcript.localMediaAnalysis.source;
      if (
        mediaSource?.kind === 'authorized_youtube_download' &&
        tutorial.video.uri !== `https://www.youtube.com/watch?v=${mediaSource.videoId}`
      ) {
        context.addIssue({
          code: 'custom',
          path: ['video', 'uri'],
          message: 'Tutorial URI must retain the authorized YouTube source video id',
        });
      }
      if (
        mediaSource?.kind === 'user_supplied_local_file' &&
        tutorial.video.uri !== `operatingline-media://sha256/${mediaSource.contentSha256}`
      ) {
        context.addIssue({
          code: 'custom',
          path: ['video', 'uri'],
          message: 'Tutorial URI must retain the exact local media content hash',
        });
      }
      const rightsBasis =
        tutorial.transcript.localMediaAnalysis.source?.rightsBasis ??
        tutorial.transcript.localMediaAnalysis.rightsAuthorization?.basis;
      const expectedRightsStatus =
        rightsBasis === 'rights_holder_permission'
          ? 'permission_granted'
          : rightsBasis === 'license_verified'
            ? 'license_verified'
            : 'public_domain';
      if (tutorial.video.rightsStatus !== expectedRightsStatus) {
        context.addIssue({
          code: 'custom',
          path: ['video'],
          message:
            'Local media tutorial rights must be derived from analysis authorization without caller-supplied license text',
        });
      }
      if (
        tutorial.transcript.localMediaAnalysis.semanticBindings.length !==
        tutorial.transcript.segments.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'localMediaAnalysis', 'semanticBindings'],
          message: 'Local media semantic bindings must match the normalized transcript segments',
        });
      }
      for (const [
        index,
        binding,
      ] of tutorial.transcript.localMediaAnalysis.semanticBindings.entries()) {
        const segment = tutorial.transcript.segments[index];
        if (
          binding.order !== index + 1 ||
          binding.startMs !== segment?.startMs ||
          binding.endMs !== segment?.endMs
        ) {
          context.addIssue({
            code: 'custom',
            path: ['transcript', 'localMediaAnalysis', 'semanticBindings', index],
            message:
              'Local media semantic binding order and time range must match its transcript segment',
          });
        }
      }
    }
    let previousEndMs = -1;
    for (const [index, segment] of tutorial.transcript.segments.entries()) {
      if (segment.endMs <= segment.startMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'endMs'],
          message: 'Tutorial transcript segment must have a positive time range',
        });
      }
      if (segment.endMs > tutorial.video.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'endMs'],
          message: 'Tutorial transcript segment exceeds the video duration',
        });
      }
      if (segment.startMs < previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'startMs'],
          message: 'Tutorial transcript segments must be ordered and non-overlapping',
        });
      }
      previousEndMs = Math.max(previousEndMs, segment.endMs);
    }
  });

export const procedureAuthoringTutorialInputSchema = z
  .strictObject({
    video: procedureAuthoringTutorialVideoInputSchema,
    transcript: procedureAuthoringTutorialTranscriptInputSchema.options[0],
  })
  .superRefine((tutorial, context) => {
    let previousEndMs = -1;
    for (const [index, segment] of tutorial.transcript.segments.entries()) {
      if (segment.endMs <= segment.startMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'endMs'],
          message: 'Tutorial transcript segment must have a positive time range',
        });
      }
      if (segment.endMs > tutorial.video.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'endMs'],
          message: 'Tutorial transcript segment exceeds the video duration',
        });
      }
      if (segment.startMs < previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'startMs'],
          message: 'Tutorial transcript segments must be ordered and non-overlapping',
        });
      }
      previousEndMs = Math.max(previousEndMs, segment.endMs);
    }
  });
export type ProcedureAuthoringTutorialInput = z.infer<typeof procedureAuthoringTutorialInputSchema>;
export type ProcedureAuthoringVerifiedTutorialInput = z.infer<
  typeof procedureAuthoringVerifiedTutorialInputSchema
>;

export const procedureAuthoringPromptRequestSchema = z.strictObject({
  targetAdapterId: z.string().min(1).max(180).regex(/^\S+$/),
  actionCatalogVersion: catalogVersionSchema.optional(),
  interactionCatalogVersion: catalogVersionSchema.optional(),
  goal: z.string().min(1).max(10_000).regex(/\S/),
  treeId: guideStepIdSchema,
  revision: z.number().int().positive(),
  locale: procedureAuthoringLocaleSchema.optional(),
  tutorial: procedureAuthoringTutorialInputSchema.optional(),
});
export type ProcedureAuthoringPromptRequest = z.infer<typeof procedureAuthoringPromptRequestSchema>;

export const procedureAuthoringVerifiedPromptRequestSchema = z.strictObject({
  ...procedureAuthoringPromptRequestSchema.shape,
  tutorial: procedureAuthoringVerifiedTutorialInputSchema.optional(),
});
export type ProcedureAuthoringVerifiedPromptRequest = z.infer<
  typeof procedureAuthoringVerifiedPromptRequestSchema
>;

const procedureCandidateValidationSchema = procedureLeafNodeSchema.shape.validation.safeExtend({
  status: z.literal('candidate'),
  validatedHostVersions: z.array(catalogVersionSchema).length(0),
});

const procedureCandidateLeafNodeSchema = procedureLeafNodeSchema.safeExtend({
  menuTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('menu'),
      }),
    )
    .min(1),
  shortcutTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('shortcut'),
      }),
    )
    .min(1),
  mcpTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('mcp'),
      }),
    )
    .min(1),
  validation: procedureCandidateValidationSchema,
});

const procedureCandidateNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureCandidateLeafNodeSchema,
]);

export const procedureAuthoringCandidateTreeSchema = procedureTreeSchema.safeExtend({
  formatVersion: z.literal(procedureTreeFormatVersion),
  nodes: z.array(procedureCandidateNodeSchema).min(1),
});
export type ProcedureAuthoringCandidateTree = z.infer<typeof procedureAuthoringCandidateTreeSchema>;

const procedureAuthoringNaturalLanguageSourceSchema = z.strictObject({
  id: guideStepIdSchema,
  kind: z.literal('natural_language'),
  text: procedureAuthoringPromptRequestSchema.shape.goal,
  locale: procedureAuthoringPromptRequestSchema.shape.locale,
});

const procedureAuthoringGoalEvidenceSchema = z.strictObject({
  id: guideStepIdSchema,
  locator: z.strictObject({ kind: z.literal('whole_source') }),
  description: z.string().min(1),
  confidence: z.literal(1),
});

const procedureAuthoringTutorialSourceSchema = z.discriminatedUnion('rightsStatus', [
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('permission_granted'),
    license: procedureAuthoringTutorialLicenseSchema.optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('license_verified'),
    license: procedureAuthoringTutorialLicenseSchema.optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringTutorialUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('public_domain'),
    license: procedureAuthoringTutorialLicenseSchema.optional(),
  }),
]);
const procedureAuthoringLocalMediaTutorialSourceSchema = z.discriminatedUnion('rightsStatus', [
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('permission_granted'),
    license: z.never().optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('license_verified'),
    license: z.never().optional(),
  }),
  z.strictObject({
    id: guideStepIdSchema,
    kind: z.literal('tutorial_video'),
    uri: procedureAuthoringLocalMediaUriSchema,
    title: procedureAuthoringTutorialTitleSchema,
    durationMs: procedureAuthoringTutorialDurationSchema,
    rightsStatus: z.literal('public_domain'),
    license: z.never().optional(),
  }),
]);

const localMediaRightsJsonSchemaConditions = (
  [
    ['rights_holder_permission', 'permission_granted'],
    ['license_verified', 'license_verified'],
    ['public_domain_verified', 'public_domain'],
  ] as const
).map(([basis, rightsStatus]) => ({
  if: {
    properties: {
      transcript: {
        properties: {
          localMediaAnalysis: {
            properties: {
              rightsAuthorization: {
                properties: { basis: { const: basis } },
                required: ['basis'],
              },
            },
            required: ['rightsAuthorization'],
          },
        },
        required: ['localMediaAnalysis'],
      },
    },
    required: ['transcript'],
  },
  then: {
    properties: {
      source: {
        properties: { rightsStatus: { const: rightsStatus } },
        required: ['rightsStatus'],
        not: { required: ['license'] },
      },
    },
    required: ['source'],
  },
}));
const currentLocalMediaRightsJsonSchemaConditions = (
  [
    ['rights_holder_permission', 'permission_granted'],
    ['license_verified', 'license_verified'],
    ['public_domain_verified', 'public_domain'],
  ] as const
).map(([basis, rightsStatus]) => ({
  if: {
    properties: {
      transcript: {
        properties: {
          localMediaAnalysis: {
            properties: {
              source: {
                properties: { rightsBasis: { const: basis } },
                required: ['rightsBasis'],
              },
            },
            required: ['source'],
          },
        },
        required: ['localMediaAnalysis'],
      },
    },
    required: ['transcript'],
  },
  then: {
    properties: {
      source: {
        properties: { rightsStatus: { const: rightsStatus } },
        required: ['rightsStatus'],
        not: { required: ['license'] },
      },
    },
    required: ['source'],
  },
}));

const procedureAuthoringTutorialProvenanceSchema = z
  .strictObject({
    source: z.union([
      procedureAuthoringTutorialSourceSchema,
      procedureAuthoringLocalMediaTutorialSourceSchema,
    ]),
    transcript: z.strictObject({
      origin: z.enum(['user_supplied', 'youtube_data_api_v3', 'local_media_analysis']),
      locale: procedureAuthoringLocaleSchema.optional(),
      document: procedureAuthoringTutorialTranscriptDocumentSchema.optional(),
      localMediaAnalysis: procedureAuthoringLocalMediaAnalysisSchema.optional(),
      segments: z
        .array(
          z.strictObject({
            id: guideStepIdSchema,
            order: z.number().int().positive(),
            locator: z.strictObject({
              kind: z.literal('video_segment'),
              startMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
              endMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            }),
            text: procedureAuthoringTutorialTranscriptSegmentSchema.shape.text,
            confidence: procedureAuthoringTutorialTranscriptSegmentSchema.shape.confidence,
          }),
        )
        .min(1)
        .max(procedureAuthoringTutorialSegmentMaxCount),
    }),
  })
  .superRefine((tutorial, context) => {
    const document = tutorial.transcript.document;
    const acquisition = document?.acquisition;
    const localMediaAnalysis = tutorial.transcript.localMediaAnalysis;
    if ((tutorial.transcript.origin === 'youtube_data_api_v3') !== (acquisition !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['transcript', 'origin'],
        message: 'YouTube transcript origin and acquisition provenance must be declared together',
      });
    }
    if (
      (tutorial.transcript.origin === 'local_media_analysis') !==
      (localMediaAnalysis !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transcript', 'origin'],
        message: 'Local media transcript origin and analysis provenance must be declared together',
      });
    }
    if (localMediaAnalysis !== undefined) {
      if (
        localMediaAnalysis.source?.kind === 'authorized_youtube_download' &&
        tutorial.source.uri !==
          `https://www.youtube.com/watch?v=${localMediaAnalysis.source.videoId}`
      ) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'uri'],
          message: 'Tutorial URI must retain the authorized YouTube source video id',
        });
      }
      if (
        localMediaAnalysis.source?.kind === 'user_supplied_local_file' &&
        tutorial.source.uri !==
          `operatingline-media://sha256/${localMediaAnalysis.source.contentSha256}`
      ) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'uri'],
          message: 'Tutorial URI must retain the exact local media content hash',
        });
      }
      const rightsBasis =
        localMediaAnalysis.source?.rightsBasis ?? localMediaAnalysis.rightsAuthorization?.basis;
      const expectedRightsStatus =
        rightsBasis === 'rights_holder_permission'
          ? 'permission_granted'
          : rightsBasis === 'license_verified'
            ? 'license_verified'
            : 'public_domain';
      if (
        tutorial.source.rightsStatus !== expectedRightsStatus ||
        tutorial.source.license !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['source'],
          message:
            'Local media tutorial rights must match analysis authorization without license text',
        });
      }
      if (tutorial.transcript.locale === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'locale'],
          message: 'Local media transcript provenance requires its analyzed locale',
        });
      }
      if (localMediaAnalysis.semanticBindings.length !== tutorial.transcript.segments.length) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'localMediaAnalysis', 'semanticBindings'],
          message: 'Local media semantic bindings must match prompt tutorial evidence',
        });
      }
      for (const [index, binding] of localMediaAnalysis.semanticBindings.entries()) {
        const segment = tutorial.transcript.segments[index];
        if (
          binding.order !== index + 1 ||
          binding.promptEvidenceId !== segment?.id ||
          binding.startMs !== segment?.locator.startMs ||
          binding.endMs !== segment?.locator.endMs
        ) {
          context.addIssue({
            code: 'custom',
            path: ['transcript', 'localMediaAnalysis', 'semanticBindings', index],
            message: 'Local media semantic bindings must match exact prompt tutorial evidence',
          });
        }
      }
    } else if (
      tutorial.source.rightsStatus === 'license_verified' &&
      tutorial.source.license === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'license'],
        message: 'Licensed tutorial provenance requires license text outside local media analysis',
      });
    }
    if (acquisition !== undefined) {
      if (document?.format !== acquisition.requestedFormat) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'document', 'format'],
          message: 'YouTube caption document format must match the requested download format',
        });
      }
      if (tutorial.transcript.locale !== acquisition.trackLanguage) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'locale'],
          message: 'YouTube caption locale must match the acquired track language',
        });
      }
      if (tutorial.source.uri !== `https://www.youtube.com/watch?v=${acquisition.videoId}`) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'uri'],
          message: 'YouTube tutorial URI must match the acquired video id',
        });
      }
    }
    if (document !== undefined) {
      if (document.cueCount !== tutorial.transcript.segments.length) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'document', 'cueCount'],
          message: 'Tutorial transcript document cue count must match normalized segments',
        });
      }
      for (const [index, segment] of tutorial.transcript.segments.entries()) {
        if (segment.confidence !== document.confidence.value) {
          context.addIssue({
            code: 'custom',
            path: ['transcript', 'segments', index, 'confidence'],
            message: 'Tutorial transcript segment confidence must match the document default',
          });
        }
      }
    }
    const ids = new Set<string>();
    let previousEndMs = -1;
    for (const [index, segment] of tutorial.transcript.segments.entries()) {
      if (ids.has(segment.id)) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'id'],
          message: 'Tutorial transcript segment ids must be unique',
        });
      }
      ids.add(segment.id);
      if (segment.order !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'order'],
          message: 'Tutorial transcript segment order must be contiguous from 1',
        });
      }
      if (segment.locator.endMs <= segment.locator.startMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'locator', 'endMs'],
          message: 'Tutorial transcript segment must have a positive time range',
        });
      }
      if (segment.locator.endMs > tutorial.source.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'locator', 'endMs'],
          message: 'Tutorial transcript segment exceeds the video duration',
        });
      }
      if (segment.locator.startMs < previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'segments', index, 'locator', 'startMs'],
          message: 'Tutorial transcript segments must be ordered and non-overlapping',
        });
      }
      previousEndMs = Math.max(previousEndMs, segment.locator.endMs);
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: {
            transcript: {
              properties: { origin: { const: 'youtube_data_api_v3' } },
              required: ['origin'],
            },
          },
          required: ['transcript'],
        },
        then: {
          properties: {
            transcript: {
              properties: {
                document: { required: ['acquisition'] },
              },
              required: ['document'],
            },
          },
        },
        else: {
          properties: {
            transcript: {
              properties: {
                document: { not: { required: ['acquisition'] } },
              },
            },
          },
        },
      },
      {
        if: {
          properties: {
            transcript: {
              properties: { origin: { const: 'local_media_analysis' } },
              required: ['origin'],
            },
          },
          required: ['transcript'],
        },
        then: {
          properties: {
            transcript: { required: ['localMediaAnalysis'] },
          },
        },
        else: {
          properties: {
            transcript: { not: { required: ['localMediaAnalysis'] } },
          },
        },
      },
      ...localMediaRightsJsonSchemaConditions,
      ...currentLocalMediaRightsJsonSchemaConditions,
    ],
  });

const procedureAuthoringActionCatalogSchema = actionCatalogSchema
  .omit({ adapterId: true })
  .meta(actionCatalogJsonSchemaMetadata);
const procedureAuthoringInteractionCatalogSchema = interactionCatalogSchema.omit({
  adapterId: true,
  actionCatalogVersion: true,
});

export const procedureAuthoringPromptContextSchema = z
  .strictObject({
    requestedTreeId: procedureAuthoringPromptRequestSchema.shape.treeId,
    recommendedRevision: procedureAuthoringPromptRequestSchema.shape.revision,
    goalProvenance: z.strictObject({
      source: procedureAuthoringNaturalLanguageSourceSchema,
      evidence: procedureAuthoringGoalEvidenceSchema,
    }),
    tutorialProvenance: procedureAuthoringTutorialProvenanceSchema.optional(),
    catalogBinding: z.strictObject({
      adapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
      actionCatalog: procedureAuthoringActionCatalogSchema,
      interactionCatalog: procedureAuthoringInteractionCatalogSchema,
    }),
    constraints: z.strictObject({
      allGeneratedLeavesCandidate: z.literal(true),
      validatedHostVersionsEmpty: z.literal(true),
      exactParametersRemainOnSemanticOperations: z.literal(true),
      allInteractionTracksUnavailable: z.literal(true),
      persistenceRequiresExplicitStore: z.literal(true),
      allSemanticOperationsTutorialEvidenceBound: z.literal(true).optional(),
      tutorialTranscriptDocumentBound: z.literal(true).optional(),
      tutorialTranscriptAcquisitionBound: z.literal(true).optional(),
      tutorialTranscriptSelectionBound: z.literal(true).optional(),
      tutorialLocalMediaAnalysisBound: z.literal(true).optional(),
    }),
  })
  .superRefine((context, refinement) => {
    const tutorialPresent = context.tutorialProvenance !== undefined;
    const tutorialBindingRequired =
      context.constraints.allSemanticOperationsTutorialEvidenceBound === true;
    if (tutorialPresent !== tutorialBindingRequired) {
      refinement.addIssue({
        code: 'custom',
        path: ['constraints', 'allSemanticOperationsTutorialEvidenceBound'],
        message: 'Tutorial provenance and tutorial evidence binding must be declared together',
      });
    }
    const documentPresent = context.tutorialProvenance?.transcript.document !== undefined;
    const documentBindingRequired = context.constraints.tutorialTranscriptDocumentBound === true;
    if (documentPresent !== documentBindingRequired) {
      refinement.addIssue({
        code: 'custom',
        path: ['constraints', 'tutorialTranscriptDocumentBound'],
        message: 'Tutorial transcript document provenance and binding must be declared together',
      });
    }
    const acquisitionPresent =
      context.tutorialProvenance?.transcript.document?.acquisition !== undefined;
    const acquisitionBindingRequired =
      context.constraints.tutorialTranscriptAcquisitionBound === true;
    if (acquisitionPresent !== acquisitionBindingRequired) {
      refinement.addIssue({
        code: 'custom',
        path: ['constraints', 'tutorialTranscriptAcquisitionBound'],
        message: 'Tutorial transcript acquisition provenance and binding must be declared together',
      });
    }
    const selectionPresent =
      context.tutorialProvenance?.transcript.document?.acquisition?.selection !== undefined;
    const selectionBindingRequired = context.constraints.tutorialTranscriptSelectionBound === true;
    if (selectionPresent !== selectionBindingRequired) {
      refinement.addIssue({
        code: 'custom',
        path: ['constraints', 'tutorialTranscriptSelectionBound'],
        message: 'Tutorial transcript selection provenance and binding must be declared together',
      });
    }
    const localMediaAnalysisPresent =
      context.tutorialProvenance?.transcript.localMediaAnalysis !== undefined;
    const localMediaAnalysisBindingRequired =
      context.constraints.tutorialLocalMediaAnalysisBound === true;
    if (localMediaAnalysisPresent !== localMediaAnalysisBindingRequired) {
      refinement.addIssue({
        code: 'custom',
        path: ['constraints', 'tutorialLocalMediaAnalysisBound'],
        message: 'Local media analysis provenance and binding must be declared together',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { required: ['tutorialProvenance'] },
        then: {
          properties: {
            constraints: { required: ['allSemanticOperationsTutorialEvidenceBound'] },
          },
        },
        else: {
          properties: {
            constraints: {
              not: { required: ['allSemanticOperationsTutorialEvidenceBound'] },
            },
          },
        },
      },
      {
        if: {
          properties: {
            tutorialProvenance: {
              properties: { transcript: { required: ['document'] } },
              required: ['transcript'],
            },
          },
          required: ['tutorialProvenance'],
        },
        then: {
          properties: {
            constraints: { required: ['tutorialTranscriptDocumentBound'] },
          },
        },
        else: {
          properties: {
            constraints: { not: { required: ['tutorialTranscriptDocumentBound'] } },
          },
        },
      },
      {
        if: {
          properties: {
            tutorialProvenance: {
              properties: {
                transcript: {
                  properties: {
                    document: { required: ['acquisition'] },
                  },
                  required: ['document'],
                },
              },
              required: ['transcript'],
            },
          },
          required: ['tutorialProvenance'],
        },
        then: {
          properties: {
            constraints: { required: ['tutorialTranscriptAcquisitionBound'] },
          },
        },
        else: {
          properties: {
            constraints: { not: { required: ['tutorialTranscriptAcquisitionBound'] } },
          },
        },
      },
      {
        if: {
          properties: {
            tutorialProvenance: {
              properties: {
                transcript: {
                  properties: {
                    document: {
                      properties: {
                        acquisition: { required: ['selection'] },
                      },
                      required: ['acquisition'],
                    },
                  },
                  required: ['document'],
                },
              },
              required: ['transcript'],
            },
          },
          required: ['tutorialProvenance'],
        },
        then: {
          properties: {
            constraints: { required: ['tutorialTranscriptSelectionBound'] },
          },
        },
        else: {
          properties: {
            constraints: { not: { required: ['tutorialTranscriptSelectionBound'] } },
          },
        },
      },
      {
        if: {
          properties: {
            tutorialProvenance: {
              properties: {
                transcript: { required: ['localMediaAnalysis'] },
              },
              required: ['transcript'],
            },
          },
          required: ['tutorialProvenance'],
        },
        then: {
          properties: {
            constraints: { required: ['tutorialLocalMediaAnalysisBound'] },
          },
        },
        else: {
          properties: {
            constraints: { not: { required: ['tutorialLocalMediaAnalysisBound'] } },
          },
        },
      },
    ],
  });
export type ProcedureAuthoringPromptContext = z.infer<typeof procedureAuthoringPromptContextSchema>;

const procedureAuthoringPromptVersionJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        properties: {
          formatVersion: {
            enum: [
              procedureAuthoringPromptLegacyFormatVersion,
              procedureAuthoringPromptTutorialFormatVersion,
              procedureAuthoringPromptDocumentFormatVersion,
              procedureAuthoringPromptAcquisitionFormatVersion,
              procedureAuthoringPromptFormatVersion,
            ],
          },
        },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: {
                  transcript: { not: { required: ['localMediaAnalysis'] } },
                },
                required: ['transcript'],
              },
            },
          },
        },
      },
    },
    {
      if: {
        properties: { formatVersion: { const: procedureAuthoringPromptLegacyFormatVersion } },
        required: ['formatVersion'],
      },
      then: {
        properties: { context: { not: { required: ['tutorialProvenance'] } } },
      },
    },
    {
      if: {
        properties: { formatVersion: { const: procedureAuthoringPromptTutorialFormatVersion } },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: { transcript: { not: { required: ['document'] } } },
                required: ['transcript'],
              },
            },
            required: ['tutorialProvenance'],
          },
        },
      },
    },
    {
      if: {
        properties: {
          formatVersion: { const: procedureAuthoringPromptDocumentFormatVersion },
        },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: {
                  transcript: {
                    properties: { document: { not: { required: ['acquisition'] } } },
                    required: ['document'],
                  },
                },
                required: ['transcript'],
              },
            },
            required: ['tutorialProvenance'],
          },
        },
      },
    },
    {
      if: {
        properties: {
          formatVersion: { const: procedureAuthoringPromptAcquisitionFormatVersion },
        },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: {
                  transcript: {
                    properties: {
                      document: {
                        properties: {
                          acquisition: { not: { required: ['selection'] } },
                        },
                        required: ['acquisition'],
                      },
                    },
                    required: ['document'],
                  },
                },
                required: ['transcript'],
              },
            },
            required: ['tutorialProvenance'],
          },
        },
      },
    },
    {
      if: {
        properties: { formatVersion: { const: procedureAuthoringPromptFormatVersion } },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: {
                  transcript: {
                    properties: {
                      document: {
                        properties: {
                          acquisition: { required: ['selection'] },
                        },
                        required: ['acquisition'],
                      },
                    },
                    required: ['document'],
                  },
                },
                required: ['transcript'],
              },
            },
            required: ['tutorialProvenance'],
          },
        },
      },
    },
    {
      if: {
        properties: {
          formatVersion: { const: procedureAuthoringPromptMediaAnalysisFormatVersion },
        },
        required: ['formatVersion'],
      },
      then: {
        properties: {
          context: {
            properties: {
              tutorialProvenance: {
                properties: {
                  transcript: {
                    properties: {
                      origin: { const: 'local_media_analysis' },
                      localMediaAnalysis: {
                        required: ['source'],
                        properties: { manifest: { required: ['source'] } },
                      },
                    },
                    required: ['origin', 'localMediaAnalysis'],
                  },
                },
                required: ['transcript'],
              },
            },
            required: ['tutorialProvenance'],
          },
        },
      },
    },
  ],
} as const;

export const procedureAuthoringPromptPacketContentSchema = z
  .strictObject({
    formatVersion: procedureAuthoringPromptFormatVersionSchema,
    context: procedureAuthoringPromptContextSchema,
    retrieval: z.strictObject({
      toolName: z.literal('operatingline.procedure.search'),
      matching: z.literal('exact_structured_filters'),
      similarityScoreProduced: z.literal(false),
    }),
    responseContract: z.strictObject({
      mediaType: z.literal('application/json'),
      schema: z.record(z.string(), z.json()),
    }),
    workflow: z.strictObject({
      validationToolName: z.literal('operatingline.procedure.authoring.validate'),
      compileToolName: z.literal('operatingline.procedure.compile'),
      instructions: z.array(z.string().min(1)).min(1),
    }),
    limits: z.strictObject({
      maxCanonicalBytes: z.literal(procedureAuthoringPromptPacketMaxCanonicalBytes),
    }),
    sideEffects: z.strictObject({
      modelCalled: z.literal(false),
      procedureStored: z.literal(false),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
  })
  .superRefine((packet, context) => {
    const tutorial = packet.context.tutorialProvenance;
    const expectedFormat =
      tutorial === undefined
        ? procedureAuthoringPromptLegacyFormatVersion
        : tutorial.transcript.localMediaAnalysis !== undefined
          ? tutorial.transcript.localMediaAnalysis.source === undefined
            ? procedureAuthoringPromptLegacyMediaAnalysisFormatVersion
            : procedureAuthoringPromptMediaAnalysisFormatVersion
          : tutorial.transcript.document === undefined
            ? procedureAuthoringPromptTutorialFormatVersion
            : tutorial.transcript.document.acquisition === undefined
              ? procedureAuthoringPromptDocumentFormatVersion
              : tutorial.transcript.document.acquisition.selection === undefined
                ? procedureAuthoringPromptAcquisitionFormatVersion
                : procedureAuthoringPromptFormatVersion;
    if (packet.formatVersion !== expectedFormat) {
      context.addIssue({
        code: 'custom',
        path: ['formatVersion'],
        message: 'Procedure authoring packet format does not match its tutorial provenance',
      });
    }
  })
  .meta(procedureAuthoringPromptVersionJsonSchemaMetadata);
export type ProcedureAuthoringPromptPacketContent = z.infer<
  typeof procedureAuthoringPromptPacketContentSchema
>;

export const procedureAuthoringPromptPacketSchema = procedureAuthoringPromptPacketContentSchema
  .safeExtend({
    integrity: z.strictObject({
      algorithm: z.literal('sha256'),
      canonicalization: z.literal(protocolJsonValueCanonicalization),
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  })
  .meta(procedureAuthoringPromptVersionJsonSchemaMetadata);
export type ProcedureAuthoringPromptPacket = z.infer<typeof procedureAuthoringPromptPacketSchema>;

export const procedureAuthoringValidationRequestSchema = z.strictObject({
  packet: procedureAuthoringPromptPacketSchema,
  tree: procedureAuthoringCandidateTreeSchema,
});
export type ProcedureAuthoringValidationRequest = z.infer<
  typeof procedureAuthoringValidationRequestSchema
>;

export const procedureAuthoringValidationResultSchema = z.strictObject({
  formatVersion: procedureAuthoringPromptFormatVersionSchema,
  packetContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  validation: z.strictObject({
    packetIntegrity: z.literal('validated'),
    installedCatalogBinding: z.literal('validated'),
    authoringCandidateContract: z.literal('validated'),
    procedureCompilation: z.literal('validated'),
  }),
  compilation: procedureCompilationResultSchema,
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureAuthoringValidationResult = z.infer<
  typeof procedureAuthoringValidationResultSchema
>;
