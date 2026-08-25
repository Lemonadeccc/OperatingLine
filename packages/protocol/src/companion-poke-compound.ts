import { z } from 'zod';

import {
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  decisionConsumptionEventSchema,
} from './execution-decision.js';
import {
  procedureCompoundCurrentStateSchema,
  procedureCompoundHostAttestationSchema,
  procedureCompoundLeafIntentSchema,
  procedureCompoundLeafReceiptSchema,
  procedureCompoundReplaySchema,
} from './procedure-compound-replay.js';
import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';

export const companionPokeCompoundFormatVersion = '1.0.0' as const;
export const companionPokeCompoundFormatVersionSchema = z.literal(
  companionPokeCompoundFormatVersion,
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const targetSchema = z.strictObject({ adapterId: z.literal('blender'), instanceId: z.uuid() });

const decisionReceiptSchema = z.union([
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
]);

export const companionPokeCompoundCreateRequestSchema = z
  .strictObject({
    formatVersion: companionPokeCompoundFormatVersionSchema,
    requestId: z.uuid(),
    replay: procedureCompoundReplaySchema,
    decisionReceipt: decisionReceiptSchema,
    trustedDecisionConsumptionEvent: decisionConsumptionEventSchema,
  })
  .superRefine((request, context) => {
    if (
      request.replay.recipe.replayId !== request.replay.currentState.replayId ||
      request.replay.recipe.replayId !== request.decisionReceipt.replayId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['replay'],
        message: 'Poke compound create request must bind one exact replay',
      });
    }
  });
export type CompanionPokeCompoundCreateRequest = z.infer<
  typeof companionPokeCompoundCreateRequestSchema
>;

const deliveryContentShape = {
  formatVersion: companionPokeCompoundFormatVersionSchema,
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  target: targetSchema,
  replayId: z.uuid(),
  compoundId: z.uuid(),
  compoundContentSha256: sha256Schema,
  historyLockTokenSha256: sha256Schema,
  replay: procedureCompoundReplaySchema,
  decisionReceipt: decisionReceiptSchema,
  trustedDecisionConsumptionEvent: decisionConsumptionEventSchema,
  requestedAt: timestampSchema,
  dispatchedAt: timestampSchema,
} as const;

type DeliveryContent = z.infer<z.ZodObject<typeof deliveryContentShape>>;

export function computeCompanionPokeCompoundDeliveryContentSha256(
  delivery: DeliveryContent,
): string {
  return computeProtocolCanonicalJsonSha256(delivery);
}

export const companionPokeCompoundDeliverySchema = z
  .strictObject({
    ...deliveryContentShape,
    deliveryContentSha256: sha256Schema,
  })
  .superRefine((delivery, context) => {
    const replay = delivery.replay;
    if (
      delivery.target.adapterId !== replay.target.adapterId ||
      delivery.target.instanceId !== replay.target.instanceId ||
      delivery.replayId !== replay.recipe.replayId ||
      delivery.compoundId !== replay.recipe.compoundId ||
      delivery.compoundContentSha256 !== replay.recipe.compoundContentSha256 ||
      delivery.historyLockTokenSha256 !== replay.recipe.historyLockTokenSha256 ||
      Date.parse(delivery.requestedAt) > Date.parse(delivery.dispatchedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Poke compound delivery identity does not match its immutable replay',
      });
    }
    const content = Object.fromEntries(
      Object.keys(deliveryContentShape).map((key) => [key, delivery[key as keyof DeliveryContent]]),
    ) as DeliveryContent;
    if (
      delivery.deliveryContentSha256 !== computeCompanionPokeCompoundDeliveryContentSha256(content)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['deliveryContentSha256'],
        message: 'Poke compound delivery content commitment is invalid',
      });
    }
  });
export type CompanionPokeCompoundDelivery = z.infer<typeof companionPokeCompoundDeliverySchema>;

const leafEvidenceSchema = z.strictObject({
  intent: procedureCompoundLeafIntentSchema,
  receipt: procedureCompoundLeafReceiptSchema,
  hostAttestation: procedureCompoundHostAttestationSchema,
  trustedHostAttestationSha256: sha256Schema,
});

export const companionPokeCompoundTerminalEvidenceSchema = z.strictObject({
  leaves: z.tuple([leafEvidenceSchema, leafEvidenceSchema, leafEvidenceSchema]),
});
export type CompanionPokeCompoundTerminalEvidence = z.infer<
  typeof companionPokeCompoundTerminalEvidenceSchema
>;

const resultIdentityShape = {
  formatVersion: companionPokeCompoundFormatVersionSchema,
  requestId: z.uuid(),
  deliveryId: z.uuid(),
  deliveryContentSha256: sha256Schema,
  target: targetSchema,
  replayId: z.uuid(),
  compoundId: z.uuid(),
  compoundContentSha256: sha256Schema,
  historyLockTokenSha256: sha256Schema,
} as const;

export const companionPokeCompoundResultSchema = z
  .strictObject({
    ...resultIdentityShape,
    status: z.enum(['succeeded', 'rejected', 'recovery_required']),
    replay: procedureCompoundReplaySchema.nullable(),
    terminalEvidence: companionPokeCompoundTerminalEvidenceSchema.nullable(),
    observedCurrentState: procedureCompoundCurrentStateSchema.nullable(),
    error: z.string().min(1).nullable(),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (result.status === 'succeeded') {
      if (
        result.replay === null ||
        result.terminalEvidence === null ||
        result.observedCurrentState !== null ||
        result.error !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Succeeded Poke compound result requires one terminal replay and evidence',
        });
      }
      return;
    }
    if (result.status === 'recovery_required') {
      if (
        result.replay !== null ||
        result.terminalEvidence !== null ||
        result.observedCurrentState === null ||
        result.error === null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Recovery-required Poke compound result requires only observed current state',
        });
      }
      return;
    }
    if (
      result.replay !== null ||
      result.terminalEvidence !== null ||
      result.observedCurrentState !== null ||
      result.error === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Rejected Poke compound result cannot carry replay or host evidence',
      });
    }
  });
export type CompanionPokeCompoundResult = z.infer<typeof companionPokeCompoundResultSchema>;

export const companionPokeCompoundPollRequestSchema = targetSchema;
export type CompanionPokeCompoundPollRequest = z.infer<
  typeof companionPokeCompoundPollRequestSchema
>;

export const companionPokeCompoundPollDeliverySchema = z.strictObject({
  request: companionPokeCompoundDeliverySchema.nullable(),
});

export const companionPokeCompoundResultAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});

export const companionPokeCompoundRecoveryChallengeSchema = z.strictObject({
  formatVersion: companionPokeCompoundFormatVersionSchema,
  recoveryId: z.uuid(),
  originalDelivery: companionPokeCompoundDeliverySchema,
  replacementSessionFingerprintSha256: sha256Schema,
  replacementDocumentAuthoritySha256: sha256Schema,
  requestedAt: timestampSchema,
});
export type CompanionPokeCompoundRecoveryChallenge = z.infer<
  typeof companionPokeCompoundRecoveryChallengeSchema
>;

export const companionPokeCompoundRecoveryPollRequestSchema = targetSchema;
export const companionPokeCompoundRecoveryPollDeliverySchema = z.strictObject({
  request: companionPokeCompoundRecoveryChallengeSchema.nullable(),
});

export const companionPokeCompoundRecoveryAckSchema = z
  .strictObject({
    formatVersion: companionPokeCompoundFormatVersionSchema,
    recoveryId: z.uuid(),
    challenge: companionPokeCompoundRecoveryChallengeSchema,
    outcome: z.enum(['terminal_result', 'history_lost', 'history_conflict']),
    terminalResult: companionPokeCompoundResultSchema.nullable(),
    observedCurrentState: procedureCompoundCurrentStateSchema.nullable(),
    automaticReplay: z.literal(false),
    retainsTargetLock: z.boolean(),
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    if (ack.recoveryId !== ack.challenge.recoveryId) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryId'],
        message: 'Poke compound recovery acknowledgement changed its challenge identity',
      });
    }
    if (ack.outcome === 'terminal_result') {
      if (
        ack.terminalResult?.status !== 'succeeded' ||
        ack.observedCurrentState !== null ||
        ack.retainsTargetLock !== true
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Terminal recovery requires the exact retained success result and lock',
        });
      }
      return;
    }
    const expectedStatus = ack.outcome;
    if (
      ack.terminalResult !== null ||
      ack.observedCurrentState?.status !== expectedStatus ||
      ack.observedCurrentState.historyLock !== 'quarantined' ||
      ack.retainsTargetLock !== true
    ) {
      context.addIssue({
        code: 'custom',
        message: 'History recovery requires one matching quarantined current-state proof',
      });
    }
  });
export type CompanionPokeCompoundRecoveryAck = z.infer<
  typeof companionPokeCompoundRecoveryAckSchema
>;

export const companionPokeCompoundRecoveryAckResponseSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});

export const companionPokeCompoundStatusRequestSchema = z.strictObject({ requestId: z.uuid() });

export const companionPokeCompoundStatusSchema = z.strictObject({
  formatVersion: companionPokeCompoundFormatVersionSchema,
  requestId: z.uuid(),
  target: targetSchema,
  replayId: z.uuid(),
  compoundId: z.uuid(),
  status: z.enum([
    'queued',
    'dispatched',
    'succeeded',
    'rejected',
    'recovery_required',
    'quarantined',
  ]),
  deliveryId: z.uuid().nullable(),
  deliveryContentSha256: sha256Schema.nullable(),
  requestedAt: timestampSchema,
  dispatchedAt: timestampSchema.nullable(),
  result: companionPokeCompoundResultSchema.nullable(),
  currentState: procedureCompoundCurrentStateSchema,
  updatedAt: timestampSchema,
});
export type CompanionPokeCompoundStatus = z.infer<typeof companionPokeCompoundStatusSchema>;
