import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import { procedureAuthoringGenerationResultSchema } from './procedure-authoring-provider.js';
import { procedureAuthoringMaterializationResultSchema } from './procedure-materialization.js';
import { procedureTreeStoreResultSchema } from './procedure-tree.js';
import { computeProcedureTutorialAuthoringBindingContentSha256 } from './procedure-tutorial-authoring-run.js';
import { procedureTutorialMediaAuthoringPreparationSchema } from './procedure-tutorial-media-authoring.js';
import { plannerProviderDescriptorSchema } from './provider.js';

export const procedureTutorialMediaAuthoringRunFormatVersion = '1.0.0' as const;
export const procedureTutorialMediaAuthoringRunFormatVersionSchema = z.literal(
  procedureTutorialMediaAuthoringRunFormatVersion,
);
export const procedureTutorialMediaAuthoringRunStageValues = [
  'provider_generation',
  'materialization',
  'storage',
] as const;
export const procedureTutorialMediaAuthoringRunStageSchema = z.enum(
  procedureTutorialMediaAuthoringRunStageValues,
);
export type ProcedureTutorialMediaAuthoringRunStage = z.infer<
  typeof procedureTutorialMediaAuthoringRunStageSchema
>;

const timestampSchema = z.iso.datetime({ offset: true });
const readyPreparationSchema = procedureTutorialMediaAuthoringPreparationSchema.options[0];
const materializationOptions = procedureAuthoringMaterializationResultSchema.options;
export const procedureTutorialMediaAuthoringMaterializationSummarySchema = z.discriminatedUnion(
  'formatVersion',
  [
    materializationOptions[0].omit({ tree: true, compilation: true }),
    materializationOptions[1].omit({ tree: true, compilation: true }),
    materializationOptions[2].omit({ tree: true, compilation: true }),
    materializationOptions[3].omit({ tree: true, compilation: true }),
    materializationOptions[4].omit({ tree: true, compilation: true }),
  ],
);
export type ProcedureTutorialMediaAuthoringMaterializationSummary = z.infer<
  typeof procedureTutorialMediaAuthoringMaterializationSummarySchema
>;
const authorizedProviderSchema = plannerProviderDescriptorSchema.extend({
  availability: z.strictObject({ available: z.literal(true) }),
});

export const procedureTutorialMediaAuthoringRunCreateRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    preparation: readyPreparationSchema,
    provider: z.strictObject({
      generationRequestId: z.uuid(),
      authorization: z.strictObject({
        providerDescriptor: authorizedProviderSchema,
        explicitlyConfirmedByUser: z.literal(true),
        dataHandlingAcknowledged: z.literal(true),
        possibleProviderCostAcknowledged: z.literal(true),
        confirmedAt: timestampSchema,
      }),
    }),
  })
  .superRefine((value, context) => {
    const ids = [
      value.requestId,
      value.preparation.analysisRequestId,
      value.preparation.analysisJobId,
      value.provider.generationRequestId,
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['requestId'],
        message: 'Run, analysis, job, and generation ids must be distinct',
      });
    }
  });
export type ProcedureTutorialMediaAuthoringRunCreateRequest = z.infer<
  typeof procedureTutorialMediaAuthoringRunCreateRequestSchema
>;

const identityShape = {
  formatVersion: procedureTutorialMediaAuthoringRunFormatVersionSchema,
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  runId: z.uuid(),
} as const;

function validateRunIdentity(
  value: { requestId: string; runId: string },
  context: z.RefinementCtx,
): void {
  if (value.requestId === value.runId) {
    context.addIssue({
      code: 'custom',
      path: ['runId'],
      message: 'Service-generated run id must differ from the request id',
    });
  }
}

export const procedureTutorialMediaAuthoringRunStatusRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    runId: z.uuid(),
  })
  .superRefine((request, context) => validateRunIdentity(request, context));
export type ProcedureTutorialMediaAuthoringRunStatusRequest = z.infer<
  typeof procedureTutorialMediaAuthoringRunStatusRequestSchema
>;

const storeReviewSchema = z.strictObject({
  decision: z.literal('store'),
  preparationFingerprint: evalContentSha256Schema,
  packetContentSha256: evalContentSha256Schema,
  candidateTreeContentSha256: evalContentSha256Schema,
  materializedTreeContentSha256: evalContentSha256Schema,
  confirmations: z.strictObject({
    exactPreparationReviewed: z.literal(true),
    exactPacketReviewed: z.literal(true),
    exactCandidateTreeReviewed: z.literal(true),
    exactMaterializedTreeReviewed: z.literal(true),
  }),
});
const discardReviewSchema = z.strictObject({
  decision: z.literal('discard'),
  reason: z.string().min(1).max(1_000).regex(/\S/).optional(),
});
export const procedureTutorialMediaAuthoringReviewRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    runId: z.uuid(),
    reviewId: z.uuid(),
    review: z.discriminatedUnion('decision', [storeReviewSchema, discardReviewSchema]),
    reviewedAt: timestampSchema,
  })
  .superRefine((request, context) => {
    if (new Set([request.requestId, request.runId, request.reviewId]).size !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['reviewId'],
        message: 'Review request, run, and review ids must be distinct',
      });
    }
  });
export type ProcedureTutorialMediaAuthoringReviewRequest = z.infer<
  typeof procedureTutorialMediaAuthoringReviewRequestSchema
>;

export const procedureTutorialMediaAuthoringResumeRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialMediaAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    runId: z.uuid(),
    recoveryId: z.uuid(),
    retryFromStage: z.enum(['materialization', 'storage']),
  })
  .superRefine((request, context) => {
    if (new Set([request.requestId, request.runId, request.recoveryId]).size !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryId'],
        message: 'Resume request, run, and recovery ids must be distinct',
      });
    }
  });
export type ProcedureTutorialMediaAuthoringResumeRequest = z.infer<
  typeof procedureTutorialMediaAuthoringResumeRequestSchema
>;

export const procedureTutorialMediaAuthoringBindingSchema = z
  .strictObject({
    ...identityShape,
    source: z.strictObject({
      kind: z.literal('verified_media_authoring_preparation'),
      analysisRequestId: z.uuid(),
      analysisJobId: z.uuid(),
      analysisFingerprint: evalContentSha256Schema,
      preparationFingerprint: evalContentSha256Schema,
      packetContentSha256: evalContentSha256Schema,
    }),
    generation: z.strictObject({
      requestId: z.uuid(),
      generationId: z.uuid(),
      providerId: z.string().min(1).max(128),
      providerVersion: z.string().min(1),
      completedEventId: z.string().min(1),
      completedEventContentSha256: evalContentSha256Schema,
      candidateTreeContentSha256: evalContentSha256Schema,
    }),
    materialization: procedureTutorialMediaAuthoringMaterializationSummarySchema,
    review: z.strictObject({
      reviewId: z.uuid(),
      reviewedAt: timestampSchema,
      preparationFingerprint: evalContentSha256Schema,
      packetContentSha256: evalContentSha256Schema,
      candidateTreeContentSha256: evalContentSha256Schema,
      materializedTreeContentSha256: evalContentSha256Schema,
    }),
    storage: z.strictObject({
      treeId: z.string().min(1),
      revision: z.number().int().positive(),
      contentSha256: evalContentSha256Schema,
    }),
    integrity: z.strictObject({
      algorithm: z.literal('sha256'),
      canonicalization: z.literal('operatingline-json-value-v1'),
      contentSha256: evalContentSha256Schema,
    }),
  })
  .superRefine((value, context) => {
    if (
      value.source.preparationFingerprint !== value.review.preparationFingerprint ||
      value.source.packetContentSha256 !== value.review.packetContentSha256 ||
      value.source.packetContentSha256 !== value.materialization.packetContentSha256 ||
      value.generation.candidateTreeContentSha256 !== value.review.candidateTreeContentSha256 ||
      value.generation.candidateTreeContentSha256 !==
        value.materialization.inputTreeContentSha256 ||
      value.materialization.outputTreeContentSha256 !==
        value.review.materializedTreeContentSha256 ||
      value.materialization.outputTreeContentSha256 !== value.storage.contentSha256
    )
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message:
          'Preparation, packet, candidate, materialized, review, and storage hashes must agree',
      });
    if (
      value.integrity.contentSha256 !== computeProcedureTutorialAuthoringBindingContentSha256(value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Media authoring binding integrity must match its canonical content',
      });
    }
  });
export type ProcedureTutorialMediaAuthoringBinding = z.infer<
  typeof procedureTutorialMediaAuthoringBindingSchema
>;

const errorSchema = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  stage: procedureTutorialMediaAuthoringRunStageSchema,
});
const commonStatus = { ...identityShape, updatedAt: timestampSchema } as const;
const previewSchema = z.strictObject({
  preparation: readyPreparationSchema,
  generation: procedureAuthoringGenerationResultSchema,
  materialization: procedureAuthoringMaterializationResultSchema,
});
export const procedureTutorialMediaAuthoringRunStatusSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      ...commonStatus,
      status: z.literal('accepted'),
      completedStages: z.tuple([]),
      acceptedAt: timestampSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('running'),
      currentStage: procedureTutorialMediaAuthoringRunStageSchema,
      completedStages: z.array(procedureTutorialMediaAuthoringRunStageSchema).max(2),
      startedAt: timestampSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('awaiting_review'),
      completedStages: z.tuple([z.literal('provider_generation'), z.literal('materialization')]),
      reviewId: z.uuid(),
      preview: previewSchema,
      awaitingReviewSince: timestampSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('recovery_required'),
      completedStages: z.array(procedureTutorialMediaAuthoringRunStageSchema).max(2),
      recoveryId: z.uuid(),
      retryFromStage: z.enum(['materialization', 'storage']),
      error: errorSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('discarded'),
      completedStages: z.tuple([z.literal('provider_generation'), z.literal('materialization')]),
      reviewId: z.uuid(),
      discardedAt: timestampSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('failed'),
      completedStages: z.array(procedureTutorialMediaAuthoringRunStageSchema).max(2),
      error: errorSchema,
      failedAt: timestampSchema,
    }),
    z.strictObject({
      ...commonStatus,
      status: z.literal('completed'),
      completedStages: z.tuple([
        z.literal('provider_generation'),
        z.literal('materialization'),
        z.literal('storage'),
      ]),
      result: z.strictObject({
        binding: procedureTutorialMediaAuthoringBindingSchema,
        storage: procedureTreeStoreResultSchema,
        sideEffects: z.strictObject({
          providerCalled: z.literal(true),
          procedureStored: z.literal(true),
          proposalCreated: z.literal(false),
          hostExecutionStarted: z.literal(false),
        }),
        completedAt: timestampSchema,
      }),
    }),
  ])
  .superRefine((status, context) => {
    const expected = procedureTutorialMediaAuthoringRunStageValues.slice(
      0,
      status.completedStages.length,
    );
    if (!status.completedStages.every((stage, index) => stage === expected[index])) {
      context.addIssue({
        code: 'custom',
        path: ['completedStages'],
        message: 'Completed stages must be a canonical media authoring prefix',
      });
    }
    if (
      status.status === 'running' &&
      status.currentStage !==
        procedureTutorialMediaAuthoringRunStageValues[status.completedStages.length]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentStage'],
        message: 'Current stage must immediately follow completed stages',
      });
    }
    if (
      status.status === 'recovery_required' &&
      (status.retryFromStage !== status.error.stage || !status.error.retryable)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Recovery error must match the retryable local stage',
      });
    }
    if (status.status === 'completed') {
      const { binding, storage } = status.result;
      if (
        binding.requestId !== status.requestId ||
        binding.requestFingerprint !== status.requestFingerprint ||
        binding.runId !== status.runId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'binding'],
          message: 'Completed media authoring binding must match the outer run identity',
        });
      }
      if (
        storage.record.tree.id !== binding.storage.treeId ||
        storage.record.tree.revision !== binding.storage.revision ||
        storage.record.integrity.contentSha256 !== binding.storage.contentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'storage'],
          message: 'Completed media authoring storage must match the reviewed binding',
        });
      }
    }
  })
  .meta({
    description:
      'Media authoring run status. Runtime parsing additionally binds completed result identity and stored tree integrity to the outer run and exact review binding.',
    $comment:
      'Runtime-only invariants compare requestId, requestFingerprint, runId, tree id/revision, and content hashes across the completed status, binding, and stored record.',
  });
export type ProcedureTutorialMediaAuthoringRunStatus = z.infer<
  typeof procedureTutorialMediaAuthoringRunStatusSchema
>;

const eventScope = { ...identityShape, occurredAt: timestampSchema } as const;
export const procedureTutorialMediaAuthoringRequestedEventSchema = z.strictObject({
  ...eventScope,
  request: procedureTutorialMediaAuthoringRunCreateRequestSchema,
});
export const procedureTutorialMediaAuthoringStageEventSchema = z.strictObject({
  ...eventScope,
  stage: procedureTutorialMediaAuthoringRunStageSchema,
  state: z.enum(['started', 'completed']),
  checkpoint: z
    .union([
      procedureAuthoringGenerationResultSchema,
      procedureAuthoringMaterializationResultSchema,
    ])
    .optional(),
});
export const procedureTutorialMediaAuthoringReviewRequiredEventSchema = z.strictObject({
  ...eventScope,
  reviewId: z.uuid(),
  preparation: readyPreparationSchema,
  generation: procedureAuthoringGenerationResultSchema,
  materialization: procedureAuthoringMaterializationResultSchema,
});
export const procedureTutorialMediaAuthoringReviewedEventSchema = z.strictObject({
  ...eventScope,
  review: procedureTutorialMediaAuthoringReviewRequestSchema,
});
export const procedureTutorialMediaAuthoringRecoveryRequiredEventSchema = z.strictObject({
  ...eventScope,
  recoveryId: z.uuid(),
  retryFromStage: z.enum(['materialization', 'storage']),
  error: errorSchema,
});
export const procedureTutorialMediaAuthoringResumedEventSchema = z.strictObject({
  ...eventScope,
  resume: procedureTutorialMediaAuthoringResumeRequestSchema,
});
export const procedureTutorialMediaAuthoringDiscardedEventSchema = z.strictObject({
  ...eventScope,
  review: procedureTutorialMediaAuthoringReviewRequestSchema,
  discardedAt: timestampSchema,
});
export const procedureTutorialMediaAuthoringFailedEventSchema = z.strictObject({
  ...eventScope,
  completedStages: z.array(procedureTutorialMediaAuthoringRunStageSchema).max(2),
  error: errorSchema,
});
export const procedureTutorialMediaAuthoringCompletedEventSchema = z.strictObject({
  ...eventScope,
  binding: procedureTutorialMediaAuthoringBindingSchema,
  completedAt: timestampSchema,
});
