import { z } from 'zod';

import { evalContentSha256Schema } from './eval-common.js';
import {
  procedureRefinementCreateRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
} from './procedure-refinement.js';
import {
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalResultSchema,
} from './procedure-semantic-retrieval.js';
import { storedProcedureTreeSchema } from './procedure-tree.js';
import {
  procedureZeroBaselineGenerateRequestSchema,
  procedureZeroBaselineResultSchema,
} from './procedure-zero-baseline.js';

export const procedureZeroBaselineRefinementFormatVersion = '1.0.0' as const;
export const procedureZeroBaselineRefinementFormatVersionSchema = z.literal(
  procedureZeroBaselineRefinementFormatVersion,
);

const timestampSchema = z.iso.datetime({ offset: true });
const commonRequestShape = {
  formatVersion: procedureZeroBaselineRefinementFormatVersionSchema,
  workflowId: z.uuid(),
} as const;

export const procedureZeroBaselineRefinementCreateRequestSchema = z
  .strictObject({
    ...commonRequestShape,
    generationRequest: procedureZeroBaselineGenerateRequestSchema,
    authorization: z.strictObject({
      explicitlyConfirmedByUser: z.literal(true),
      candidateOnlyUntilExactReviewAcknowledged: z.literal(true),
      noHostExecutionAcknowledged: z.literal(true),
      confirmedAt: timestampSchema,
    }),
  })
  .superRefine((request, context) => {
    if (request.workflowId === request.generationRequest.requestId) {
      context.addIssue({
        code: 'custom',
        path: ['workflowId'],
        message: 'Workflow and generation request identities must differ',
      });
    }
    if (
      Date.parse(request.authorization.confirmedAt) <
      Date.parse(request.generationRequest.authorization.confirmedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'confirmedAt'],
        message: 'Workflow authorization must not predate generation authorization',
      });
    }
  });
export type ProcedureZeroBaselineRefinementCreateRequest = z.infer<
  typeof procedureZeroBaselineRefinementCreateRequestSchema
>;

// Kept as the public v1 entry-point name used by the schema generator.
export const procedureZeroBaselineRefinementRequestSchema =
  procedureZeroBaselineRefinementCreateRequestSchema;
export type ProcedureZeroBaselineRefinementRequest = ProcedureZeroBaselineRefinementCreateRequest;

export const procedureZeroBaselineReviewBindingSchema = z.strictObject({
  workflowRequestContentSha256: evalContentSha256Schema,
  generationRequestContentSha256: evalContentSha256Schema,
  baselineResultContentSha256: evalContentSha256Schema,
  candidateTreeContentSha256: evalContentSha256Schema,
});
export type ProcedureZeroBaselineReviewBinding = z.infer<
  typeof procedureZeroBaselineReviewBindingSchema
>;

export const procedureZeroBaselineStorageBindingSchema = z.strictObject({
  treeId: z.string().trim().min(1),
  revision: z.literal(1),
  contentSha256: evalContentSha256Schema,
  storedAt: timestampSchema,
});
export type ProcedureZeroBaselineStorageBinding = z.infer<
  typeof procedureZeroBaselineStorageBindingSchema
>;

export const procedureZeroBaselineReviewRequestSchema = z
  .strictObject({
    ...commonRequestShape,
    reviewId: z.uuid(),
    binding: procedureZeroBaselineReviewBindingSchema,
    decision: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('store'),
        confirmations: z.strictObject({
          exactCandidateTreeReviewed: z.literal(true),
          exactCatalogBindingReviewed: z.literal(true),
          candidateOnlyAndNoHostExecutionAcknowledged: z.literal(true),
        }),
      }),
      z.strictObject({
        kind: z.literal('discard'),
        reason: z.string().trim().min(1).max(1_000).regex(/\S/).optional(),
      }),
    ]),
    reviewedAt: timestampSchema,
  })
  .superRefine((request, context) => {
    if (request.workflowId === request.reviewId) {
      context.addIssue({
        code: 'custom',
        path: ['reviewId'],
        message: 'Review and workflow identities must differ',
      });
    }
  });
export type ProcedureZeroBaselineReviewRequest = z.infer<
  typeof procedureZeroBaselineReviewRequestSchema
>;

export const procedureZeroBaselineSemanticStartRequestSchema = z
  .strictObject({
    ...commonRequestShape,
    request: procedureSemanticRetrievalRequestSchema,
  })
  .superRefine((request, context) => {
    if (request.workflowId === request.request.requestId) {
      context.addIssue({
        code: 'custom',
        path: ['request', 'requestId'],
        message: 'Semantic request and workflow identities must differ',
      });
    }
  });
export type ProcedureZeroBaselineSemanticStartRequest = z.infer<
  typeof procedureZeroBaselineSemanticStartRequestSchema
>;

export const procedureZeroBaselineRefinementStartRequestSchema = z
  .strictObject({
    ...commonRequestShape,
    request: procedureRefinementCreateRequestSchema,
  })
  .superRefine((request, context) => {
    const identities = [
      request.workflowId,
      request.request.semanticContext.requestId,
      request.request.runId,
      request.request.dialogueRequestId,
      request.request.refinementRequestId,
    ];
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Workflow, semantic, run, dialogue, and refinement identities must differ',
      });
    }
  });
export type ProcedureZeroBaselineRefinementStartRequest = z.infer<
  typeof procedureZeroBaselineRefinementStartRequestSchema
>;

export const procedureZeroBaselineRefinementStatusRequestSchema = z.strictObject({
  ...commonRequestShape,
});
export type ProcedureZeroBaselineRefinementStatusRequest = z.infer<
  typeof procedureZeroBaselineRefinementStatusRequestSchema
>;

const baselineReviewSchema = z.strictObject({
  reviewId: z.uuid(),
  decision: z.enum(['store', 'discard']),
  reviewedAt: timestampSchema,
});

export const procedureZeroBaselineSemanticFailureSchema = z.strictObject({
  requestId: z.uuid(),
  requestContentSha256: evalContentSha256Schema,
  error: z.strictObject({
    code: z.string().trim().min(1).max(200).regex(/\S/),
    message: z.string().trim().min(1).max(1_000).regex(/\S/),
    retryable: z.literal(false),
  }),
  failedAt: timestampSchema,
});
export type ProcedureZeroBaselineSemanticFailure = z.infer<
  typeof procedureZeroBaselineSemanticFailureSchema
>;

export const procedureZeroBaselineRefinementStatusSchema = z
  .strictObject({
    formatVersion: procedureZeroBaselineRefinementFormatVersionSchema,
    workflowId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    createRequest: procedureZeroBaselineRefinementCreateRequestSchema,
    phase: z.enum([
      'generating',
      'awaiting_baseline_review',
      'baseline_discarded',
      'awaiting_semantic',
      'semantic_retrieving',
      'semantic_failed',
      'awaiting_refinement',
      'refinement',
    ]),
    terminal: z.boolean(),
    baseline: procedureZeroBaselineResultSchema.nullable(),
    baselineReviewBinding: procedureZeroBaselineReviewBindingSchema.nullable(),
    baselineReview: baselineReviewSchema.nullable(),
    storedBaseline: storedProcedureTreeSchema.nullable(),
    semanticRetrieval: procedureSemanticRetrievalResultSchema.nullable(),
    semanticContext: procedureRefinementSemanticContextBindingSchema.nullable(),
    semanticFailure: procedureZeroBaselineSemanticFailureSchema.nullable(),
    refinement: procedureRefinementRunStatusSchema.nullable(),
    sideEffects: z.strictObject({
      procedureStored: z.boolean(),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
    updatedAt: timestampSchema,
  })
  .superRefine((status, context) => {
    const identities = [
      status.workflowId,
      status.createRequest.generationRequest.requestId,
      ...(status.baseline === null ? [] : [status.baseline.generation.generationId]),
      ...(status.baselineReview === null ? [] : [status.baselineReview.reviewId]),
      ...(status.semanticRetrieval === null ? [] : [status.semanticRetrieval.requestId]),
      ...(status.semanticFailure === null ? [] : [status.semanticFailure.requestId]),
      ...(status.refinement === null
        ? []
        : [
            status.refinement.runId,
            status.refinement.dialogueRequestId,
            status.refinement.refinementRequestId,
          ]),
    ];
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: 'custom',
        message: 'Known workflow lifecycle identities must all differ',
      });
    }
    if ((status.baseline !== null) !== (status.baselineReviewBinding !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['baselineReviewBinding'],
        message: 'Baseline and its exact review binding must appear together',
      });
    }
    if ((status.semanticRetrieval !== null) !== (status.semanticContext !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['semanticContext'],
        message: 'Semantic result and its exact completion receipt must appear together',
      });
    }
    const hasBaseline = status.baseline !== null && status.baselineReviewBinding !== null;
    const hasStoredBaseline = status.storedBaseline !== null;
    const hasSemantic = status.semanticRetrieval !== null && status.semanticContext !== null;
    if ((status.phase !== 'generating') !== hasBaseline) {
      context.addIssue({ code: 'custom', path: ['baseline'], message: 'Phase must bind baseline' });
    }
    if (status.sideEffects.procedureStored !== hasStoredBaseline) {
      context.addIssue({
        code: 'custom',
        path: ['sideEffects', 'procedureStored'],
        message: 'Storage side effect must match the stored baseline',
      });
    }
    if (
      [
        'awaiting_semantic',
        'semantic_retrieving',
        'semantic_failed',
        'awaiting_refinement',
        'refinement',
      ].includes(status.phase) !== hasStoredBaseline
    ) {
      context.addIssue({
        code: 'custom',
        path: ['storedBaseline'],
        message: 'Only a reviewed stored baseline may enter semantic/refinement phases',
      });
    }
    if (status.phase === 'baseline_discarded' && status.baselineReview?.decision !== 'discard') {
      context.addIssue({
        code: 'custom',
        path: ['baselineReview'],
        message: 'Discard is required',
      });
    }
    if (
      ['generating', 'awaiting_baseline_review'].includes(status.phase) !==
      (status.baselineReview === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineReview'],
        message: 'Baseline review presence must match the workflow phase',
      });
    }
    if (
      [
        'awaiting_semantic',
        'semantic_retrieving',
        'semantic_failed',
        'awaiting_refinement',
        'refinement',
      ].includes(status.phase) &&
      status.baselineReview?.decision !== 'store'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineReview'],
        message: 'Semantic and refinement phases require an exact store review',
      });
    }
    if (['awaiting_refinement', 'refinement'].includes(status.phase) !== hasSemantic) {
      context.addIssue({
        code: 'custom',
        path: ['semanticContext'],
        message: 'Refinement phases require exact nonempty semantic context',
      });
    }
    if ((status.phase === 'semantic_failed') !== (status.semanticFailure !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['semanticFailure'],
        message: 'Semantic failure evidence presence must match the failed phase',
      });
    }
    if ((status.phase === 'refinement') !== (status.refinement !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['refinement'],
        message: 'Refinement phase must project the native coordinator status',
      });
    }
    const expectedTerminal =
      status.phase === 'baseline_discarded' ||
      status.phase === 'semantic_failed' ||
      (status.phase === 'refinement' && status.refinement?.terminal === true);
    if (status.terminal !== expectedTerminal) {
      context.addIssue({ code: 'custom', path: ['terminal'], message: 'Terminal state mismatch' });
    }
  });
export type ProcedureZeroBaselineRefinementStatus = z.infer<
  typeof procedureZeroBaselineRefinementStatusSchema
>;

const eventBaseShape = {
  formatVersion: procedureZeroBaselineRefinementFormatVersionSchema,
  workflowId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  occurredAt: timestampSchema,
} as const;
const noSideEffectsSchema = z.strictObject({
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
const storedBaselineSideEffectsSchema = z.strictObject({
  procedureStored: z.literal(true),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});

export const procedureZeroBaselineWorkflowCreatedEventSchema = z.strictObject({
  ...eventBaseShape,
  request: procedureZeroBaselineRefinementCreateRequestSchema,
  sideEffects: noSideEffectsSchema,
});

export const procedureZeroBaselineReadyForReviewEventSchema = z.strictObject({
  ...eventBaseShape,
  baseline: procedureZeroBaselineResultSchema,
  binding: procedureZeroBaselineReviewBindingSchema,
  sideEffects: noSideEffectsSchema,
});

export const procedureZeroBaselineReviewedEventSchema = z
  .strictObject({
    ...eventBaseShape,
    reviewRequest: procedureZeroBaselineReviewRequestSchema,
    finalStatus: z.enum(['stored', 'discarded']),
    storageBinding: procedureZeroBaselineStorageBindingSchema.nullable(),
    sideEffects: z.union([noSideEffectsSchema, storedBaselineSideEffectsSchema]),
  })
  .superRefine((event, context) => {
    const store = event.reviewRequest.decision.kind === 'store';
    if (
      event.finalStatus !== (store ? 'stored' : 'discarded') ||
      (event.storageBinding !== null) !== store ||
      event.sideEffects.procedureStored !== store
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Baseline review event must bind its exact storage side effect',
      });
    }
  });

export const procedureZeroBaselineSemanticStartedEventSchema = z.strictObject({
  ...eventBaseShape,
  request: procedureSemanticRetrievalRequestSchema,
  requestContentSha256: evalContentSha256Schema,
  storedBaselineContentSha256: evalContentSha256Schema,
  sideEffects: storedBaselineSideEffectsSchema,
});

export const procedureZeroBaselineSemanticReadyEventSchema = z
  .strictObject({
    ...eventBaseShape,
    result: procedureSemanticRetrievalResultSchema,
    semanticContext: procedureRefinementSemanticContextBindingSchema,
    sideEffects: storedBaselineSideEffectsSchema,
  })
  .superRefine((event, context) => {
    if (
      event.result.hits.length === 0 ||
      event.semanticContext.requestId !== event.result.requestId ||
      event.semanticContext.retrievalId !== event.result.retrievalId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Semantic-ready event requires exact nonempty retrieval context',
      });
    }
  });

export const procedureZeroBaselineSemanticFailedEventSchema = z.strictObject({
  ...eventBaseShape,
  failure: procedureZeroBaselineSemanticFailureSchema,
  sideEffects: storedBaselineSideEffectsSchema,
});

export const procedureZeroBaselineNativeRefinementStartedEventSchema = z.strictObject({
  ...eventBaseShape,
  request: procedureRefinementCreateRequestSchema,
  requestContentSha256: evalContentSha256Schema,
  sideEffects: storedBaselineSideEffectsSchema,
});
