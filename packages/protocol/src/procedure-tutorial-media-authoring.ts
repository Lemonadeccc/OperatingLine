import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import {
  procedureAuthoringMediaSourceSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
} from './procedure-authoring.js';
import { procedureTutorialMediaEvidenceReferenceSchema } from './procedure-tutorial-media.js';

export const procedureTutorialMediaAuthoringLegacyFormatVersion = '1.0.0' as const;
export const procedureTutorialMediaAuthoringFormatVersion = '1.1.0' as const;
export const procedureTutorialMediaAuthoringLegacyFormatVersionSchema = z.literal(
  procedureTutorialMediaAuthoringLegacyFormatVersion,
);
export const procedureTutorialMediaAuthoringFormatVersionSchema = z.literal(
  procedureTutorialMediaAuthoringFormatVersion,
);

const videoTitleSchema = z.string().min(1).max(500).regex(/\S/);
const videoUriSchema = z.union([
  z
    .string()
    .min(1)
    .max(2_048)
    .regex(/^https:\/\/[^\s]+$/),
  z.string().regex(/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/),
]);
export const procedureTutorialMediaAuthoringVideoSchema = z.strictObject({
  title: videoTitleSchema,
});
export type ProcedureTutorialMediaAuthoringVideo = z.infer<
  typeof procedureTutorialMediaAuthoringVideoSchema
>;

export const procedureTutorialMediaAuthoringLegacyPrepareRequestSchema = z.strictObject({
  formatVersion: procedureTutorialMediaAuthoringLegacyFormatVersionSchema,
  analysisRequestId: z.uuid(),
  analysisJobId: z.uuid(),
  request: procedureAuthoringPromptRequestSchema.omit({ tutorial: true }),
  video: procedureTutorialMediaAuthoringVideoSchema,
});
export const procedureTutorialMediaAuthoringPrepareStartRequestSchema =
  procedureTutorialMediaAuthoringLegacyPrepareRequestSchema
    .extend({
      formatVersion: procedureTutorialMediaAuthoringFormatVersionSchema,
      source: procedureAuthoringMediaSourceSchema,
      video: procedureTutorialMediaAuthoringVideoSchema.extend({ uri: videoUriSchema }),
    })
    .superRefine((request, context) => {
      const expectedUri =
        request.source.kind === 'authorized_youtube_download'
          ? `https://www.youtube.com/watch?v=${request.source.videoId}`
          : `operatingline-media://sha256/${request.source.contentSha256}`;
      if (request.video.uri !== expectedUri) {
        context.addIssue({
          code: 'custom',
          path: ['video', 'uri'],
          message: 'Authoring video URI must explicitly match the declared media source identity',
        });
      }
    });
export type ProcedureTutorialMediaAuthoringPrepareStartRequest = z.infer<
  typeof procedureTutorialMediaAuthoringPrepareStartRequestSchema
>;
export const procedureTutorialMediaAuthoringPrepareRequestSchema = z.union([
  procedureTutorialMediaAuthoringLegacyPrepareRequestSchema,
  procedureTutorialMediaAuthoringPrepareStartRequestSchema,
]);
export type ProcedureTutorialMediaAuthoringPrepareRequest = z.infer<
  typeof procedureTutorialMediaAuthoringPrepareRequestSchema
>;

export const procedureTutorialMediaAuthoringBlockerCodeSchema = z.enum([
  'no_semantic_segments',
  'semantic_segment_order_invalid',
  'semantic_segments_overlap',
  'semantic_segment_grounding_outside_time_range',
  'semantic_segment_has_no_grounding_signal',
]);
export type ProcedureTutorialMediaAuthoringBlockerCode = z.infer<
  typeof procedureTutorialMediaAuthoringBlockerCodeSchema
>;

export const procedureTutorialMediaAuthoringBlockerSchema = z.strictObject({
  code: procedureTutorialMediaAuthoringBlockerCodeSchema,
  message: z.string().min(1).max(1_000).regex(/\S/),
  semanticSegmentIds: z.array(z.uuid()).max(2_000),
});
export type ProcedureTutorialMediaAuthoringBlocker = z.infer<
  typeof procedureTutorialMediaAuthoringBlockerSchema
>;

const coverageRatioSchema = z.number().min(0).max(1);
export const procedureTutorialMediaAuthoringCoverageSchema = z.strictObject({
  asr: coverageRatioSchema,
  frameEvidence: coverageRatioSchema,
  visual: coverageRatioSchema,
  ocr: coverageRatioSchema,
  ui: coverageRatioSchema,
  shortcut: coverageRatioSchema,
});
export type ProcedureTutorialMediaAuthoringCoverage = z.infer<
  typeof procedureTutorialMediaAuthoringCoverageSchema
>;

export const procedureTutorialMediaAuthoringQualityReportSchema = z.strictObject({
  semanticSegmentCount: z.number().int().nonnegative().max(2_000),
  ordered: z.boolean(),
  nonOverlapping: z.boolean(),
  coverage: procedureTutorialMediaAuthoringCoverageSchema,
  blockers: z.array(procedureTutorialMediaAuthoringBlockerSchema).max(5),
});
export type ProcedureTutorialMediaAuthoringQualityReport = z.infer<
  typeof procedureTutorialMediaAuthoringQualityReportSchema
>;

const evidenceBindingShape = {
  promptSegmentOrder: z.number().int().positive().max(2_000),
  semanticSegmentId: z.uuid(),
  startMs: z.number().int().nonnegative().max(86_400_000),
  endMs: z.number().int().positive().max(86_400_000),
  canonicalDescription: z.string().min(1).max(4_096).regex(/\S/),
  asrSegmentIds: z.array(z.uuid()).max(1_000),
  ocrCandidateIds: z.array(z.uuid()).max(1_000),
  uiCandidateIds: z.array(z.uuid()).max(1_000),
  shortcutCandidateIds: z.array(z.uuid()).max(1_000),
  evidence: z.array(procedureTutorialMediaEvidenceReferenceSchema).min(1).max(2_000),
} as const;

const readyEvidenceBindingSchema = z.strictObject({
  ...evidenceBindingShape,
  promptEvidenceId: guideStepIdSchema,
});
const blockedEvidenceBindingSchema = z.strictObject({
  ...evidenceBindingShape,
  promptEvidenceId: z.null(),
});
export const procedureTutorialMediaAuthoringEvidenceBindingSchema = z.union([
  readyEvidenceBindingSchema,
  blockedEvidenceBindingSchema,
]);
export type ProcedureTutorialMediaAuthoringEvidenceBinding = z.infer<
  typeof procedureTutorialMediaAuthoringEvidenceBindingSchema
>;

const sideEffectsSchema = z.strictObject({
  providerCalled: z.literal(false),
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});

const preparationCommonShape = {
  formatVersion: procedureTutorialMediaAuthoringLegacyFormatVersionSchema,
  analysisRequestId: z.uuid(),
  analysisJobId: z.uuid(),
  analysisFingerprint: evalContentSha256Schema,
  fingerprint: evalContentSha256Schema,
  quality: procedureTutorialMediaAuthoringQualityReportSchema,
  sideEffects: sideEffectsSchema,
} as const;

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface MediaEvidenceIdentity {
  readonly artifactUri: string;
  readonly frameId?: string | undefined;
  readonly timestampMs: number;
}

function sameOrderedEvidence(
  left: readonly MediaEvidenceIdentity[],
  right: readonly MediaEvidenceIdentity[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value.artifactUri === right[index]?.artifactUri &&
        value.frameId === right[index]?.frameId &&
        value.timestampMs === right[index]?.timestampMs,
    )
  );
}

export const procedureTutorialMediaAuthoringLegacyPreparationSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      ...preparationCommonShape,
      status: z.literal('ready'),
      evidenceBindings: z.array(readyEvidenceBindingSchema).min(1).max(2_000),
      packet: procedureAuthoringPromptPacketSchema,
    }),
    z.strictObject({
      ...preparationCommonShape,
      status: z.literal('blocked'),
      evidenceBindings: z.array(blockedEvidenceBindingSchema).max(2_000),
      packet: z.null(),
    }),
  ])
  .superRefine((preparation, context) => {
    if (preparation.evidenceBindings.length !== preparation.quality.semanticSegmentCount) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceBindings'],
        message: 'Evidence-binding count must match the analyzed semantic segments',
      });
    }
    for (const [index, binding] of preparation.evidenceBindings.entries()) {
      if (binding.promptSegmentOrder !== index + 1 || binding.endMs <= binding.startMs) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceBindings', index],
          message: 'Evidence bindings must have contiguous order and positive time ranges',
        });
      }
    }
    if (preparation.status === 'ready') {
      if (preparation.quality.blockers.length !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['quality', 'blockers'],
          message: 'Ready media authoring preparation cannot contain blockers',
        });
      }
      const promptSegments = preparation.packet.context.tutorialProvenance?.transcript.segments;
      if (
        promptSegments === undefined ||
        promptSegments.length !== preparation.evidenceBindings.length ||
        preparation.evidenceBindings.some(
          (binding, index) =>
            promptSegments[index]?.id !== binding.promptEvidenceId ||
            promptSegments[index]?.order !== binding.promptSegmentOrder ||
            promptSegments[index]?.locator.startMs !== binding.startMs ||
            promptSegments[index]?.locator.endMs !== binding.endMs,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceBindings'],
          message: 'Ready evidence bindings must match the exact prompt tutorial evidence',
        });
      }
      const localAnalysis =
        preparation.packet.context.tutorialProvenance?.transcript.localMediaAnalysis;
      const localBindingsMatch =
        localAnalysis !== undefined &&
        localAnalysis.semanticBindings.length === preparation.evidenceBindings.length &&
        preparation.evidenceBindings.every((binding, index) => {
          const localBinding = localAnalysis.semanticBindings[index];
          return (
            localBinding !== undefined &&
            localBinding.semanticSegmentId === binding.semanticSegmentId &&
            localBinding.order === binding.promptSegmentOrder &&
            localBinding.promptEvidenceId === binding.promptEvidenceId &&
            localBinding.startMs === binding.startMs &&
            localBinding.endMs === binding.endMs &&
            localBinding.canonicalDescription === binding.canonicalDescription &&
            sameOrderedStrings(localBinding.asrSegmentIds, binding.asrSegmentIds) &&
            sameOrderedStrings(localBinding.ocrCandidateIds, binding.ocrCandidateIds) &&
            sameOrderedStrings(localBinding.uiCandidateIds, binding.uiCandidateIds) &&
            sameOrderedStrings(localBinding.shortcutCandidateIds, binding.shortcutCandidateIds) &&
            sameOrderedEvidence(localBinding.evidence, binding.evidence)
          );
        });
      if (
        localAnalysis === undefined ||
        localAnalysis.analysisRequestId !== preparation.analysisRequestId ||
        localAnalysis.analysisJobId !== preparation.analysisJobId ||
        localAnalysis.analysisFingerprint !== preparation.analysisFingerprint ||
        !localBindingsMatch
      ) {
        context.addIssue({
          code: 'custom',
          path: ['packet', 'context', 'tutorialProvenance', 'transcript', 'localMediaAnalysis'],
          message:
            'Ready packet provenance must bind the exact outer analysis identity and evidence bindings',
        });
      }
    } else if (preparation.quality.blockers.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['quality', 'blockers'],
        message: 'Blocked media authoring preparation requires at least one blocker',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { status: { const: 'ready' } }, required: ['status'] },
        then: {
          properties: {
            quality: {
              properties: { blockers: { maxItems: 0 } },
              required: ['blockers'],
            },
          },
        },
      },
      {
        if: { properties: { status: { const: 'blocked' } }, required: ['status'] },
        then: {
          properties: {
            quality: {
              properties: { blockers: { minItems: 1 } },
              required: ['blockers'],
            },
          },
        },
      },
    ],
  });
export const procedureTutorialMediaAuthoringLegacyReadyPreparationSchema =
  procedureTutorialMediaAuthoringLegacyPreparationSchema.options[0];
const currentPreparationCommon = {
  analysisRequestId: z.uuid(),
  analysisJobId: z.uuid(),
  analysisFingerprint: evalContentSha256Schema,
  fingerprint: evalContentSha256Schema,
  quality: procedureTutorialMediaAuthoringQualityReportSchema,
  sideEffects: sideEffectsSchema,
  formatVersion: procedureTutorialMediaAuthoringFormatVersionSchema,
  source: procedureAuthoringMediaSourceSchema,
} as const;
export const procedureTutorialMediaAuthoringCurrentReadyPreparationSchema = z.strictObject({
  ...currentPreparationCommon,
  status: z.literal('ready'),
  evidenceBindings: z.array(readyEvidenceBindingSchema).min(1).max(2_000),
  packet: procedureAuthoringPromptPacketSchema,
});
const procedureTutorialMediaAuthoringCurrentBlockedPreparationSchema = z.strictObject({
  ...currentPreparationCommon,
  status: z.literal('blocked'),
  evidenceBindings: z.array(blockedEvidenceBindingSchema).max(2_000),
  packet: z.null(),
});
export const procedureTutorialMediaAuthoringCurrentPreparationSchema = z
  .discriminatedUnion('status', [
    procedureTutorialMediaAuthoringCurrentReadyPreparationSchema,
    procedureTutorialMediaAuthoringCurrentBlockedPreparationSchema,
  ])
  .superRefine((preparation, context) => {
    const legacyPreparation = Object.fromEntries(
      Object.entries(preparation).filter(([key]) => key !== 'source'),
    );
    if (
      !procedureTutorialMediaAuthoringLegacyPreparationSchema.safeParse({
        ...legacyPreparation,
        formatVersion: procedureTutorialMediaAuthoringLegacyFormatVersion,
      }).success
    ) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Current preparation must satisfy all persisted authoring invariants',
      });
    }
    if (preparation.status !== 'ready') return;
    const packetSource =
      preparation.packet.context.tutorialProvenance?.transcript.localMediaAnalysis?.source;
    if (
      packetSource === undefined ||
      JSON.stringify(packetSource) !== JSON.stringify(preparation.source)
    ) {
      context.addIssue({
        code: 'custom',
        path: [
          'packet',
          'context',
          'tutorialProvenance',
          'transcript',
          'localMediaAnalysis',
          'source',
        ],
        message: 'Ready packet provenance must retain the exact preparation media source',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { status: { const: 'ready' } }, required: ['status'] },
        then: {
          properties: {
            quality: {
              properties: { blockers: { maxItems: 0 } },
              required: ['blockers'],
            },
          },
        },
      },
      {
        if: { properties: { status: { const: 'blocked' } }, required: ['status'] },
        then: {
          properties: {
            quality: {
              properties: { blockers: { minItems: 1 } },
              required: ['blockers'],
            },
          },
        },
      },
    ],
  });
export type ProcedureTutorialMediaAuthoringCurrentPreparation = z.infer<
  typeof procedureTutorialMediaAuthoringCurrentPreparationSchema
>;
export const procedureTutorialMediaAuthoringPreparationSchema = z.union([
  procedureTutorialMediaAuthoringLegacyPreparationSchema,
  procedureTutorialMediaAuthoringCurrentPreparationSchema,
]);
export type ProcedureTutorialMediaAuthoringPreparation = z.infer<
  typeof procedureTutorialMediaAuthoringPreparationSchema
>;
