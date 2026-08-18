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
export const supportedProcedureAuthoringPromptFormatVersions = [
  procedureAuthoringPromptLegacyFormatVersion,
  procedureAuthoringPromptTutorialFormatVersion,
  procedureAuthoringPromptDocumentFormatVersion,
  procedureAuthoringPromptAcquisitionFormatVersion,
  procedureAuthoringPromptFormatVersion,
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

export const procedureAuthoringTutorialInputSchema = z
  .strictObject({
    video: procedureAuthoringTutorialVideoInputSchema,
    transcript: z.strictObject({
      origin: z.literal('user_supplied'),
      locale: procedureAuthoringLocaleSchema.optional(),
      segments: z
        .array(procedureAuthoringTutorialTranscriptSegmentSchema)
        .min(1)
        .max(procedureAuthoringTutorialSegmentMaxCount),
    }),
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
    license: procedureAuthoringTutorialLicenseSchema,
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

const procedureAuthoringTutorialProvenanceSchema = z
  .strictObject({
    source: procedureAuthoringTutorialSourceSchema,
    transcript: z.strictObject({
      origin: z.enum(['user_supplied', 'youtube_data_api_v3']),
      locale: procedureAuthoringLocaleSchema.optional(),
      document: procedureAuthoringTutorialTranscriptDocumentSchema.optional(),
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
    if ((tutorial.transcript.origin === 'youtube_data_api_v3') !== (acquisition !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['transcript', 'origin'],
        message: 'YouTube transcript origin and acquisition provenance must be declared together',
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
    ],
  });
export type ProcedureAuthoringPromptContext = z.infer<typeof procedureAuthoringPromptContextSchema>;

const procedureAuthoringPromptVersionJsonSchemaMetadata = {
  allOf: [
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
