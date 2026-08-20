import { z } from 'zod';

import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import { evalContentSha256Schema } from './eval-common.js';
import { procedureAuthoringGenerationResultSchema } from './procedure-authoring-provider.js';
import { procedureAuthoringMaterializationResultSchema } from './procedure-materialization.js';
import { procedureTreeStoreResultSchema } from './procedure-tree.js';
import { procedureTutorialYoutubeImportCurrentRequestSchema } from './procedure-tutorial-youtube.js';
import { plannerProviderDescriptorSchema } from './provider.js';
import { catalogVersionSchema } from './version.js';

export const procedureTutorialAuthoringRunFormatVersion = '1.0.0' as const;
export const procedureTutorialAuthoringRunFormatVersionSchema = z.literal(
  procedureTutorialAuthoringRunFormatVersion,
);

export const procedureTutorialAuthoringStageValues = [
  'caption_import',
  'provider_generation',
  'materialization',
  'storage',
] as const;
export const procedureTutorialAuthoringStageSchema = z.enum(procedureTutorialAuthoringStageValues);
export type ProcedureTutorialAuthoringStage = z.infer<typeof procedureTutorialAuthoringStageSchema>;

const timestampSchema = z.iso.datetime({ offset: true });
const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const authorizedProviderDescriptorSchema = plannerProviderDescriptorSchema.extend({
  availability: z.strictObject({ available: z.literal(true) }),
});

export const procedureTutorialAuthoringRunCreateRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    source: z.strictObject({
      kind: z.literal('selected_youtube_caption'),
      captionImport: procedureTutorialYoutubeImportCurrentRequestSchema,
    }),
    provider: z.strictObject({
      generationRequestId: z.uuid(),
      authorization: z.strictObject({
        providerDescriptor: authorizedProviderDescriptorSchema,
        explicitlyConfirmedByUser: z.literal(true),
        dataHandlingAcknowledged: z.literal(true),
        possibleProviderCostAcknowledged: z.literal(true),
        confirmedAt: timestampSchema,
      }),
    }),
  })
  .superRefine((request, context) => {
    const ids = [
      request.requestId,
      request.source.captionImport.requestId,
      request.source.captionImport.selectionRequestId,
      request.provider.generationRequestId,
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['requestId'],
        message:
          'Authoring, caption-import, selection, and generation request ids must be distinct',
      });
    }
  });
export type ProcedureTutorialAuthoringRunCreateRequest = z.infer<
  typeof procedureTutorialAuthoringRunCreateRequestSchema
>;

const runIdentityShape = {
  formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
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
      message: 'Service-generated run id must differ from the create-request id',
    });
  }
}

export const procedureTutorialAuthoringRunStatusRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    runId: z.uuid(),
  })
  .superRefine((request, context) => validateRunIdentity(request, context));
export type ProcedureTutorialAuthoringRunStatusRequest = z.infer<
  typeof procedureTutorialAuthoringRunStatusRequestSchema
>;

const storeConfirmationSchema = z.strictObject({
  exactPacketReviewed: z.literal(true),
  exactCandidateTreeReviewed: z.literal(true),
  exactMaterializedTreeReviewed: z.literal(true),
});

const reviewStoreDecisionSchema = z.strictObject({
  decision: z.literal('store'),
  packetContentSha256: evalContentSha256Schema,
  candidateTreeContentSha256: evalContentSha256Schema,
  materializedTreeContentSha256: evalContentSha256Schema,
  confirmations: storeConfirmationSchema,
});

const reviewDiscardDecisionSchema = z.strictObject({
  decision: z.literal('discard'),
  reason: z.string().min(1).max(1_000).regex(/\S/).optional(),
});

export const procedureTutorialAuthoringReviewRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    runId: z.uuid(),
    reviewId: z.uuid(),
    review: z.discriminatedUnion('decision', [
      reviewStoreDecisionSchema,
      reviewDiscardDecisionSchema,
    ]),
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
export type ProcedureTutorialAuthoringReviewRequest = z.infer<
  typeof procedureTutorialAuthoringReviewRequestSchema
>;

export const procedureTutorialAuthoringResumeRequestSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
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
export type ProcedureTutorialAuthoringResumeRequest = z.infer<
  typeof procedureTutorialAuthoringResumeRequestSchema
>;

const materializationOptions = procedureAuthoringMaterializationResultSchema.options;
export const procedureTutorialAuthoringMaterializationSummarySchema = z.discriminatedUnion(
  'formatVersion',
  [
    materializationOptions[0].omit({ tree: true, compilation: true }),
    materializationOptions[1].omit({ tree: true, compilation: true }),
    materializationOptions[2].omit({ tree: true, compilation: true }),
    materializationOptions[3].omit({ tree: true, compilation: true }),
    materializationOptions[4].omit({ tree: true, compilation: true }),
  ],
);
export type ProcedureTutorialAuthoringMaterializationSummary = z.infer<
  typeof procedureTutorialAuthoringMaterializationSummarySchema
>;

const bindingContentShape = {
  formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  runId: z.uuid(),
  source: z.strictObject({
    kind: z.literal('selected_youtube_caption'),
    captionImportRequestId: z.uuid(),
    captionImportRequestFingerprint: evalContentSha256Schema,
    selectionRequestId: z.uuid(),
    selectionRequestFingerprint: evalContentSha256Schema,
    videoId: z.string().min(1).max(64).regex(/^\S+$/),
    captionTrackId: z.string().min(1).max(256).regex(/^\S+$/),
    packetContentSha256: evalContentSha256Schema,
  }),
  generation: z.strictObject({
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    generationId: z.uuid(),
    providerId: providerIdSchema,
    providerVersion: catalogVersionSchema,
    providerDescriptorContentSha256: evalContentSha256Schema,
    completedEventId: z.string().min(1).max(512).regex(/^\S+$/),
    completedEventContentSha256: evalContentSha256Schema,
    runtimeAttestationContentSha256: evalContentSha256Schema.optional(),
    candidateTreeContentSha256: evalContentSha256Schema,
  }),
  materialization: procedureTutorialAuthoringMaterializationSummarySchema,
  review: z.strictObject({
    requestId: z.uuid(),
    reviewId: z.uuid(),
    packetContentSha256: evalContentSha256Schema,
    candidateTreeContentSha256: evalContentSha256Schema,
    materializedTreeContentSha256: evalContentSha256Schema,
    reviewedAt: timestampSchema,
  }),
  storage: z.strictObject({
    treeId: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: evalContentSha256Schema,
  }),
} as const;

function bindingContent(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integrity'));
}

const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      words[index] =
        (words[index - 16]! +
          (rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)) +
          words[index - 7]! +
          (rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const temporary1 =
        (h! +
          (rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          sha256RoundConstants[index]! +
          words[index]!) >>>
        0;
      const temporary2 =
        ((rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22)) +
          ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>>
        0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function computeProcedureTutorialAuthoringBindingContentSha256(
  value: Record<string, unknown>,
): string {
  return sha256Hex(canonicalizeProtocolJsonValue(bindingContent(value)));
}

export const procedureTutorialAuthoringBindingSchema = z
  .strictObject({
    ...bindingContentShape,
    integrity: z.strictObject({
      algorithm: z.literal('sha256'),
      canonicalization: z.literal(protocolJsonValueCanonicalization),
      contentSha256: evalContentSha256Schema,
    }),
  })
  .superRefine((binding, context) => {
    const independentIds = [
      binding.runId,
      binding.source.captionImportRequestId,
      binding.source.selectionRequestId,
      binding.generation.requestId,
      binding.generation.generationId,
      binding.review.reviewId,
    ];
    if (
      binding.review.requestId !== binding.requestId ||
      new Set(independentIds).size !== independentIds.length ||
      independentIds.includes(binding.requestId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message:
          'Binding review request id must equal the workflow request id and independent lifecycle ids must be distinct',
      });
    }
    if (
      binding.source.packetContentSha256 !== binding.materialization.packetContentSha256 ||
      binding.source.packetContentSha256 !== binding.review.packetContentSha256 ||
      binding.generation.candidateTreeContentSha256 !==
        binding.materialization.inputTreeContentSha256 ||
      binding.generation.candidateTreeContentSha256 !== binding.review.candidateTreeContentSha256 ||
      binding.materialization.outputTreeContentSha256 !==
        binding.review.materializedTreeContentSha256 ||
      binding.materialization.outputTreeContentSha256 !== binding.storage.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'Binding packet, candidate, materialized, review, and storage hashes must agree',
      });
    }
    if (binding.materialization.catalogBinding.adapterId === '' || binding.storage.treeId === '') {
      context.addIssue({
        code: 'custom',
        path: ['storage'],
        message: 'Storage identity is required',
      });
    }
    if (
      binding.integrity.contentSha256 !==
      computeProcedureTutorialAuthoringBindingContentSha256(binding)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Tutorial authoring binding integrity must match its canonical content',
      });
    }
  });
export type ProcedureTutorialAuthoringBinding = z.infer<
  typeof procedureTutorialAuthoringBindingSchema
>;

export const procedureTutorialAuthoringResultSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    runId: z.uuid(),
    binding: procedureTutorialAuthoringBindingSchema,
    storage: procedureTreeStoreResultSchema,
    sideEffects: z.strictObject({
      captionNetworkFetched: z.literal(true),
      captionContentDownloaded: z.literal(true),
      providerCalled: z.literal(true),
      procedureStored: z.literal(true),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
    completedAt: timestampSchema,
  })
  .superRefine((result, context) => {
    const record = result.storage.record;
    if (
      result.requestId !== result.binding.requestId ||
      result.requestFingerprint !== result.binding.requestFingerprint ||
      result.runId !== result.binding.runId ||
      record.tree.id !== result.binding.storage.treeId ||
      record.tree.revision !== result.binding.storage.revision ||
      record.integrity.contentSha256 !== result.binding.storage.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Completed result must bind its exact request, run, and stored Procedure tree',
      });
    }
    if (Date.parse(record.storedAt) > Date.parse(result.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Completion cannot precede storage',
      });
    }
  });
export type ProcedureTutorialAuthoringResult = z.infer<
  typeof procedureTutorialAuthoringResultSchema
>;

export const procedureTutorialAuthoringRunErrorSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_]+$/),
  message: z.string().min(1).max(1_000).regex(/\S/),
  retryable: z.boolean(),
  stage: procedureTutorialAuthoringStageSchema,
});
export type ProcedureTutorialAuthoringRunError = z.infer<
  typeof procedureTutorialAuthoringRunErrorSchema
>;

const statusCommonShape = { ...runIdentityShape, updatedAt: timestampSchema } as const;
const emptyCompletedStagesSchema = z.tuple([]);
const oneCompletedStageSchema = z.tuple([z.literal('caption_import')]);
const twoCompletedStagesSchema = z.tuple([
  z.literal('caption_import'),
  z.literal('provider_generation'),
]);
const threeCompletedStagesSchema = z.tuple([
  z.literal('caption_import'),
  z.literal('provider_generation'),
  z.literal('materialization'),
]);
const allCompletedStagesSchema = z.tuple([
  z.literal('caption_import'),
  z.literal('provider_generation'),
  z.literal('materialization'),
  z.literal('storage'),
]);

const captionImportFailureSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(false),
  stage: z.literal('caption_import'),
});
const providerGenerationFailureSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(false),
  stage: z.literal('provider_generation'),
});
const materializationFailureSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(false),
  stage: z.literal('materialization'),
});
const storageFailureSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(false),
  stage: z.literal('storage'),
});
const materializationRecoveryErrorSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(true),
  stage: z.literal('materialization'),
});
const storageRecoveryErrorSchema = procedureTutorialAuthoringRunErrorSchema.safeExtend({
  retryable: z.literal(true),
  stage: z.literal('storage'),
});

function hasCanonicalCompletedStagePrefix(
  completedStages: readonly ProcedureTutorialAuthoringStage[],
): boolean {
  return completedStages.every(
    (stage, index) => stage === procedureTutorialAuthoringStageValues[index],
  );
}

const acceptedStatusSchema = z.strictObject({
  ...statusCommonShape,
  status: z.literal('accepted'),
  completedStages: emptyCompletedStagesSchema,
  acceptedAt: timestampSchema,
});
const runningStatusSchema = z.discriminatedUnion('currentStage', [
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('running'),
    currentStage: z.literal('caption_import'),
    completedStages: emptyCompletedStagesSchema,
    startedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('running'),
    currentStage: z.literal('provider_generation'),
    completedStages: oneCompletedStageSchema,
    startedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('running'),
    currentStage: z.literal('materialization'),
    completedStages: twoCompletedStagesSchema,
    startedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('running'),
    currentStage: z.literal('storage'),
    completedStages: threeCompletedStagesSchema,
    startedAt: timestampSchema,
  }),
]);
const awaitingReviewStatusSchema = z.strictObject({
  ...statusCommonShape,
  status: z.literal('awaiting_review'),
  completedStages: threeCompletedStagesSchema,
  reviewId: z.uuid(),
  preview: z.strictObject({
    generation: procedureAuthoringGenerationResultSchema,
    materialization: procedureAuthoringMaterializationResultSchema,
  }),
  awaitingReviewSince: timestampSchema,
});
const recoveryRequiredStatusSchema = z.discriminatedUnion('retryFromStage', [
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('recovery_required'),
    recoveryId: z.uuid(),
    retryFromStage: z.literal('materialization'),
    completedStages: twoCompletedStagesSchema,
    error: materializationRecoveryErrorSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('recovery_required'),
    recoveryId: z.uuid(),
    retryFromStage: z.literal('storage'),
    completedStages: threeCompletedStagesSchema,
    error: storageRecoveryErrorSchema,
  }),
]);
const completedStatusSchema = z.strictObject({
  ...statusCommonShape,
  status: z.literal('completed'),
  completedStages: allCompletedStagesSchema,
  result: procedureTutorialAuthoringResultSchema,
});
const discardedStatusSchema = z.strictObject({
  ...statusCommonShape,
  status: z.literal('discarded'),
  completedStages: threeCompletedStagesSchema,
  reviewId: z.uuid(),
  discardedAt: timestampSchema,
});
const failedStatusSchema = z.union([
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('failed'),
    completedStages: emptyCompletedStagesSchema,
    error: captionImportFailureSchema,
    failedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('failed'),
    completedStages: oneCompletedStageSchema,
    error: providerGenerationFailureSchema,
    failedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('failed'),
    completedStages: twoCompletedStagesSchema,
    error: materializationFailureSchema,
    failedAt: timestampSchema,
  }),
  z.strictObject({
    ...statusCommonShape,
    status: z.literal('failed'),
    completedStages: threeCompletedStagesSchema,
    error: storageFailureSchema,
    failedAt: timestampSchema,
  }),
]);

export const procedureTutorialAuthoringRunStatusSchema = z
  .union([
    acceptedStatusSchema,
    runningStatusSchema,
    awaitingReviewStatusSchema,
    recoveryRequiredStatusSchema,
    completedStatusSchema,
    discardedStatusSchema,
    failedStatusSchema,
  ])
  .superRefine((status, context) => {
    validateRunIdentity(status, context);
    if (!hasCanonicalCompletedStagePrefix(status.completedStages)) {
      context.addIssue({
        code: 'custom',
        path: ['completedStages'],
        message: 'Completed stages must be a canonical prefix of the authoring pipeline',
      });
    }
    if (status.status === 'awaiting_review') {
      const generation = status.preview.generation;
      const materialization = status.preview.materialization;
      if (
        generation.requestId === status.requestId ||
        generation.requestId === status.runId ||
        generation.packet.integrity.contentSha256 !== materialization.packetContentSha256 ||
        generation.validation.packetContentSha256 !== materialization.packetContentSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['preview'],
          message: 'Review preview identities and hashes must be coherently bound',
        });
      }
    }
    if (
      status.status === 'recovery_required' &&
      (status.error.stage !== status.retryFromStage || !status.error.retryable)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error', 'stage'],
        message: 'Recovery error stage must equal retryFromStage',
      });
    }
    if (status.status === 'failed') {
      const stageIndex = procedureTutorialAuthoringStageValues.indexOf(status.error.stage);
      if (status.error.retryable || status.completedStages.length !== stageIndex) {
        context.addIssue({
          code: 'custom',
          path: ['completedStages'],
          message:
            'Failed status requires a non-retryable error and the canonical prefix before its stage',
        });
      }
    }
    if (
      status.status === 'completed' &&
      (status.result.requestId !== status.requestId ||
        status.result.requestFingerprint !== status.requestFingerprint ||
        status.result.runId !== status.runId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Completed status result must belong to the exact run',
      });
    }
  });
export type ProcedureTutorialAuthoringRunStatus = z.infer<
  typeof procedureTutorialAuthoringRunStatusSchema
>;

const eventScopeShape = { ...runIdentityShape, occurredAt: timestampSchema } as const;
export const procedureTutorialAuthoringRequestedEventSchema = z
  .strictObject({
    ...eventScopeShape,
    request: procedureTutorialAuthoringRunCreateRequestSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (event.request.requestId !== event.requestId || event.runId === event.requestId) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Requested event must bind the exact workflow request and distinct run',
      });
    }
  });
export const procedureTutorialAuthoringStageEventSchema = z
  .strictObject({
    ...eventScopeShape,
    stage: procedureTutorialAuthoringStageSchema,
    state: z.enum(['started', 'completed']),
  })
  .superRefine((event, context) => validateRunIdentity(event, context));
export const procedureTutorialAuthoringReviewRequiredEventSchema = z
  .strictObject({
    ...eventScopeShape,
    reviewId: z.uuid(),
    generation: procedureAuthoringGenerationResultSchema,
    materialization: procedureAuthoringMaterializationResultSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (
      event.reviewId === event.requestId ||
      event.reviewId === event.runId ||
      event.generation.packet.integrity.contentSha256 !==
        event.materialization.packetContentSha256 ||
      event.generation.validation.packetContentSha256 !== event.materialization.packetContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'Review-required event must bind the exact generated packet and review id',
      });
    }
  });
export const procedureTutorialAuthoringReviewedEventSchema = z
  .strictObject({
    ...eventScopeShape,
    review: procedureTutorialAuthoringReviewRequestSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (
      event.review.requestId !== event.requestId ||
      event.review.runId !== event.runId ||
      event.review.reviewedAt !== event.occurredAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Reviewed event must bind the exact workflow, run, and review timestamp',
      });
    }
  });
export const procedureTutorialAuthoringRecoveryRequiredEventSchema = z
  .strictObject({
    ...eventScopeShape,
    recoveryId: z.uuid(),
    retryFromStage: z.enum(['materialization', 'storage']),
    error: procedureTutorialAuthoringRunErrorSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (
      event.error.stage !== event.retryFromStage ||
      !event.error.retryable ||
      [event.requestId, event.runId].includes(event.recoveryId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Recovery-required event must bind a distinct recovery id and retryable stage',
      });
    }
  });
export const procedureTutorialAuthoringResumedEventSchema = z
  .strictObject({
    ...eventScopeShape,
    resume: procedureTutorialAuthoringResumeRequestSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (event.resume.requestId !== event.requestId || event.resume.runId !== event.runId) {
      context.addIssue({
        code: 'custom',
        path: ['resume'],
        message: 'Resumed event must bind the exact workflow and run',
      });
    }
  });
export const procedureTutorialAuthoringFailedEventSchema = z
  .union([
    z.strictObject({
      ...eventScopeShape,
      completedStages: emptyCompletedStagesSchema,
      error: captionImportFailureSchema,
    }),
    z.strictObject({
      ...eventScopeShape,
      completedStages: oneCompletedStageSchema,
      error: providerGenerationFailureSchema,
    }),
    z.strictObject({
      ...eventScopeShape,
      completedStages: twoCompletedStagesSchema,
      error: materializationFailureSchema,
    }),
    z.strictObject({
      ...eventScopeShape,
      completedStages: threeCompletedStagesSchema,
      error: storageFailureSchema,
    }),
  ])
  .superRefine((event, context) => validateRunIdentity(event, context));
export const procedureTutorialAuthoringDiscardedEventSchema = z
  .strictObject({
    ...eventScopeShape,
    review: procedureTutorialAuthoringReviewRequestSchema,
    discardedAt: timestampSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (
      event.review.requestId !== event.requestId ||
      event.review.runId !== event.runId ||
      event.review.review.decision !== 'discard' ||
      event.review.reviewedAt !== event.occurredAt ||
      event.discardedAt !== event.occurredAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Discarded event must bind the exact discard review and timestamp',
      });
    }
  });
export const procedureTutorialAuthoringCompletedEventSchema = z
  .strictObject({
    formatVersion: procedureTutorialAuthoringRunFormatVersionSchema,
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    runId: z.uuid(),
    binding: procedureTutorialAuthoringBindingSchema,
    completedAt: timestampSchema,
  })
  .superRefine((event, context) => {
    validateRunIdentity(event, context);
    if (
      event.requestId !== event.binding.requestId ||
      event.requestFingerprint !== event.binding.requestFingerprint ||
      event.runId !== event.binding.runId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Completed event must persist the exact request, run, and binding',
      });
    }
  });

export type ProcedureTutorialAuthoringRequestedEvent = z.infer<
  typeof procedureTutorialAuthoringRequestedEventSchema
>;
export type ProcedureTutorialAuthoringStageEvent = z.infer<
  typeof procedureTutorialAuthoringStageEventSchema
>;
export type ProcedureTutorialAuthoringReviewRequiredEvent = z.infer<
  typeof procedureTutorialAuthoringReviewRequiredEventSchema
>;
export type ProcedureTutorialAuthoringReviewedEvent = z.infer<
  typeof procedureTutorialAuthoringReviewedEventSchema
>;
export type ProcedureTutorialAuthoringRecoveryRequiredEvent = z.infer<
  typeof procedureTutorialAuthoringRecoveryRequiredEventSchema
>;
export type ProcedureTutorialAuthoringResumedEvent = z.infer<
  typeof procedureTutorialAuthoringResumedEventSchema
>;
export type ProcedureTutorialAuthoringFailedEvent = z.infer<
  typeof procedureTutorialAuthoringFailedEventSchema
>;
export type ProcedureTutorialAuthoringDiscardedEvent = z.infer<
  typeof procedureTutorialAuthoringDiscardedEventSchema
>;
export type ProcedureTutorialAuthoringCompletedEvent = z.infer<
  typeof procedureTutorialAuthoringCompletedEventSchema
>;
