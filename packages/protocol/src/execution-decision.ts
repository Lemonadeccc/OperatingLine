import { z } from 'zod';

import { authoritySha256Schema, authorityValidationReceiptSchema } from './authority.js';

export const executionDecisionFormatVersion = '1.0.0' as const;
export const executionDecisionFormatVersionSchema = z.literal(executionDecisionFormatVersion);
const instantSchema = z.iso.datetime({ offset: true });
const boundedIdSchema = z.string().trim().min(1).max(256);

const decisionCommonShape = {
  formatVersion: executionDecisionFormatVersionSchema,
  decisionId: z.string().uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  issuedAt: instantSchema,
  expiresAt: instantSchema,
} as const;

function decisionTimeOrdered<T extends z.ZodType>(schema: T): T {
  return schema.superRefine((record, context) => {
    const value = record as { issuedAt: string; expiresAt: string };
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must follow issuance',
      });
    }
    if (Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 15 * 60 * 1_000) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Local execution decisions may be valid for at most fifteen minutes',
      });
    }
  }) as T;
}

export const blenderExecutionDecisionReceiptSchema = decisionTimeOrdered(
  z.strictObject({
    ...decisionCommonShape,
    kind: z.literal('BlenderExecutionDecisionReceipt'),
    acceptedContentSha256: authoritySha256Schema,
    acceptedContentKind: z.enum(['proposal', 'plan']),
    replayId: z.string().uuid(),
    target: z.strictObject({ adapterId: boundedIdSchema, instanceId: z.string().uuid() }),
    blenderSessionId: boundedIdSchema,
    documentFingerprintSha256: authoritySha256Schema,
    actionCatalogVersion: boundedIdSchema,
    interactionCatalogVersion: boundedIdSchema,
  }),
);
export type BlenderExecutionDecisionReceipt = z.infer<typeof blenderExecutionDecisionReceiptSchema>;

export const blenderHistoryTransitionKindSchema = z.enum([
  'back',
  'redo',
  'unlock_final',
  'abandon_baseline',
]);
export type BlenderHistoryTransitionKind = z.infer<typeof blenderHistoryTransitionKindSchema>;

const historyTransitionCommonShape = {
  ...decisionCommonShape,
  kind: z.literal('BlenderHistoryTransitionDecisionReceipt'),
  compoundId: z.uuid(),
  replayId: z.uuid(),
  target: z.strictObject({ adapterId: boundedIdSchema, instanceId: z.uuid() }),
  blenderProcessIdentitySha256: authoritySha256Schema,
  blenderSessionUid: boundedIdSchema,
  documentFingerprintSha256: authoritySha256Schema,
  compoundContentSha256: authoritySha256Schema,
  historyLockTokenSha256: authoritySha256Schema,
  currentStateSha256: authoritySha256Schema,
  expectedHistoryHeadSha256: authoritySha256Schema,
  actionCatalogVersion: boundedIdSchema,
  interactionCatalogVersion: boundedIdSchema,
} as const;

export const blenderHistoryTransitionDecisionReceiptSchema = decisionTimeOrdered(
  z.union([
    z.strictObject({
      ...historyTransitionCommonShape,
      transition: z.literal('back'),
      expectedStatus: z.enum(['forward_applied_locked', 'reapplied_locked']),
      terminalObservationSha256: z.null(),
      nativeHistoryLossRecorded: z.literal(false),
    }),
    z.strictObject({
      ...historyTransitionCommonShape,
      transition: z.literal('redo'),
      expectedStatus: z.literal('restored_locked'),
      terminalObservationSha256: z.null(),
      nativeHistoryLossRecorded: z.literal(false),
    }),
    z.strictObject({
      ...historyTransitionCommonShape,
      transition: z.literal('unlock_final'),
      expectedStatus: z.enum(['forward_applied_locked', 'reapplied_locked']),
      terminalObservationSha256: authoritySha256Schema,
      nativeHistoryLossRecorded: z.literal(false),
    }),
    z.strictObject({
      ...historyTransitionCommonShape,
      transition: z.literal('abandon_baseline'),
      expectedStatus: z.literal('restored_locked'),
      terminalObservationSha256: authoritySha256Schema,
      nativeHistoryLossRecorded: z.literal(false),
    }),
    z.strictObject({
      ...historyTransitionCommonShape,
      transition: z.literal('abandon_baseline'),
      expectedStatus: z.literal('history_lost'),
      terminalObservationSha256: authoritySha256Schema,
      nativeHistoryLossRecorded: z.literal(true),
    }),
  ]),
);
export type BlenderHistoryTransitionDecisionReceipt = z.infer<
  typeof blenderHistoryTransitionDecisionReceiptSchema
>;

export const trainingRunDecisionReceiptSchema = decisionTimeOrdered(
  z.strictObject({
    ...decisionCommonShape,
    kind: z.literal('TrainingRunDecisionReceipt'),
    trainingUseValidationReceipt: authorityValidationReceiptSchema.refine(
      (receipt) =>
        receipt.authorityKind === 'TrainingUseAuthorization' &&
        receipt.sideEffect === 'training_export',
      { message: 'A TrainingUseAuthorization validation receipt is required' },
    ),
    releasedManifestSha256: authoritySha256Schema,
    trainingExportSha256: authoritySha256Schema,
    codeSha256: authoritySha256Schema,
    configSha256: authoritySha256Schema,
    modelFamilySha256: authoritySha256Schema,
    runId: z.string().uuid(),
  }),
);
export type TrainingRunDecisionReceipt = z.infer<typeof trainingRunDecisionReceiptSchema>;

export const localExecutionDecisionReceiptSchema = z.union([
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  trainingRunDecisionReceiptSchema,
]);
export type LocalExecutionDecisionReceipt = z.infer<typeof localExecutionDecisionReceiptSchema>;

export const decisionConsumptionEventSchema = z.strictObject({
  formatVersion: executionDecisionFormatVersionSchema,
  eventId: z.string().uuid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  kind: z.enum([
    'provider_authorization_consumed',
    'blender_decision_consumed',
    'blender_history_transition_consumed',
    'training_decision_consumed',
    'dataset_release_authorization_consumed',
  ]),
  credentialId: z.string().uuid(),
  singleUseKeySha256: authoritySha256Schema,
  operationId: z.string().uuid(),
  bindingSha256: authoritySha256Schema,
  consumedAt: instantSchema,
});
export type DecisionConsumptionEvent = z.infer<typeof decisionConsumptionEventSchema>;

export const decisionCompletionEventSchema = z.strictObject({
  formatVersion: executionDecisionFormatVersionSchema,
  eventId: z.string().uuid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  kind: z.enum([
    'provider_call_completed',
    'blender_execution_completed',
    'blender_history_transition_completed',
    'training_run_completed',
    'dataset_release_completed',
  ]),
  credentialId: z.string().uuid(),
  operationId: z.string().uuid(),
  durableReceiptSha256: authoritySha256Schema,
  completedAt: instantSchema,
});
export type DecisionCompletionEvent = z.infer<typeof decisionCompletionEventSchema>;

export const decisionLifecycleEventSchema = z.union([
  decisionConsumptionEventSchema,
  decisionCompletionEventSchema,
]);
export type DecisionLifecycleEvent = z.infer<typeof decisionLifecycleEventSchema>;
