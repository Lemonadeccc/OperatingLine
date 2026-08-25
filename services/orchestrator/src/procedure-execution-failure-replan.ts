import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  actionCatalogSchema,
  companionActionExecutionDeliverySchema,
  companionActionExecutionResultSchema,
  companionActionExecutionStatusSchema,
  decisionCompletionEventSchema,
  decisionConsumptionEventSchema,
  guidePlanSchema,
  guideRevisionRequestSchema,
  interactionCatalogSchema,
  plannerReplanGenerationResultSchema,
  planningQualityEvaluationRequestSchema,
  projectGuidePlanForProvider,
  semanticReplanConfidenceThreshold,
  validateActionArguments,
  validateActionCatalog,
  validateInteractionCatalog,
  type ActionCatalog,
  type CompanionActionExecutionStatus,
  type DecisionCompletionEvent,
  type DecisionConsumptionEvent,
  type GuidePlan,
  type GuideRevisionRequest,
  type InteractionCatalog,
  type PlannerReplanGenerationResult,
} from '@operatingline/protocol';
import { z } from 'zod';

import {
  validateGuidePlanAgainstActionCatalog,
  validateProposalTarget,
} from './guide-validation.js';
import { evaluateLocalReplanScope, localReplanCoverageStepIds } from './local-replan-scope.js';
import { evaluatePlanningQuality } from './planning-quality.js';
import { restoreHostOwnedCandidateMenuProjections } from './replanning-service.js';

const failureReplanEventType = 'procedure.execution-failure-replan.completed' as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.iso.datetime({ offset: true });
const jsonValueSchema = z.json();

export const procedureExecutionFailureTaxonomySchema = z.enum([
  'action_rejected',
  'action_failed',
  'observation_failed',
  'native_checkpoint_failed',
  'native_recovery_failed',
]);
export type ProcedureExecutionFailureTaxonomy = z.infer<
  typeof procedureExecutionFailureTaxonomySchema
>;

const observationFailureSchema = z.strictObject({
  kind: z.string().trim().min(1).max(180),
  expected: z.record(z.string(), jsonValueSchema),
  actual: z.record(z.string(), jsonValueSchema).nullable(),
  receiptSha256: sha256Schema,
});

const nativeEvidenceSchema = z
  .strictObject({
    checkpointState: z.enum(['unchanged', 'restored', 'not_created', 'failed']),
    checkpointReceiptSha256: sha256Schema.nullable(),
    recoveryState: z.enum(['not_required', 'recovered', 'repair_retained', 'recovery_required']),
    recoveryReceiptSha256: sha256Schema.nullable(),
  })
  .superRefine((evidence, context) => {
    if ((evidence.recoveryState === 'recovered') !== (evidence.recoveryReceiptSha256 !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryReceiptSha256'],
        message: 'Only recovered native state carries a recovery receipt',
      });
    }
  });

export const procedureExecutionFailureEnvelopeSchema = z.strictObject({
  formatVersion: z.literal('1.0.0'),
  requestId: z.uuid(),
  replayId: z.uuid(),
  planId: z.string().trim().min(1).max(256),
  planRevision: z.number().int().positive(),
  planContentSha256: sha256Schema,
  stepId: z.string().trim().min(1).max(256),
  actionName: z.string().trim().min(1).max(256),
  actionCatalogVersion: z.string().trim().min(1).max(64),
  interactionCatalogVersion: z.string().trim().min(1).max(64),
  attemptCount: z.number().int().positive().max(100),
  failure: procedureExecutionFailureTaxonomySchema,
  observationFailures: z.array(observationFailureSchema).max(32),
  nativeEvidence: nativeEvidenceSchema,
  receiptHashes: z.strictObject({
    delivery: sha256Schema,
    action: sha256Schema.nullable(),
    report: sha256Schema.nullable(),
  }),
  terminalAt: instantSchema,
});
export type ProcedureExecutionFailureEnvelope = z.infer<
  typeof procedureExecutionFailureEnvelopeSchema
>;

const observationObligationSchema = z.strictObject({
  kind: z.string().trim().min(1).max(180),
  parameters: z.record(z.string(), jsonValueSchema),
});

const proposalCommonSchema = z.strictObject({
  formatVersion: z.literal('1.0.0'),
  proposalId: z.uuid(),
  status: z.literal('pending'),
  failureEnvelopeSha256: sha256Schema,
  base: z.strictObject({
    planId: z.string().trim().min(1).max(256),
    revision: z.number().int().positive(),
    planContentSha256: sha256Schema,
  }),
  catalogs: z.strictObject({
    actionCatalogVersion: z.string().trim().min(1).max(64),
    interactionCatalogVersion: z.string().trim().min(1).max(64),
  }),
  observationObligations: z.array(observationObligationSchema).min(1).max(32),
  proposedAt: instantSchema,
  expiresAt: instantSchema,
});

const parameterRepairProposalSchema = proposalCommonSchema.extend({
  kind: z.literal('parameter_repair'),
  diff: z.strictObject({
    actionName: z.string().trim().min(1).max(256),
    argument: z.string().trim().min(1).max(128),
    before: jsonValueSchema,
    after: jsonValueSchema,
  }),
  integrity: z.strictObject({ algorithm: z.literal('sha256'), contentSha256: sha256Schema }),
});

const strategySwitchProposalSchema = proposalCommonSchema.extend({
  kind: z.literal('strategy_switch'),
  diff: z.strictObject({
    semanticLeafId: z.string().trim().min(1).max(256),
    modality: z.enum(['menu', 'shortcut', 'mcp']),
    fromTrackId: z.string().trim().min(1).max(256),
    toTrackId: z.string().trim().min(1).max(256),
    verifiedTrackContentSha256: sha256Schema,
  }),
  integrity: z.strictObject({ algorithm: z.literal('sha256'), contentSha256: sha256Schema }),
});

const semanticReplanProposalSchema = proposalCommonSchema.extend({
  kind: z.literal('semantic_replan'),
  diff: z.strictObject({
    candidatePlanContentSha256: sha256Schema,
    localScopeStepIds: z.array(z.string().trim().min(1).max(256)).min(1).max(128),
    confidence: z.number().min(semanticReplanConfidenceThreshold).max(1),
    threshold: z.literal(semanticReplanConfidenceThreshold),
  }),
  integrity: z.strictObject({ algorithm: z.literal('sha256'), contentSha256: sha256Schema }),
});

export const procedureExecutionFailureProposalSchema = z.discriminatedUnion('kind', [
  parameterRepairProposalSchema,
  strategySwitchProposalSchema,
  semanticReplanProposalSchema,
]);
export type ProcedureExecutionFailureProposal = z.infer<
  typeof procedureExecutionFailureProposalSchema
>;

const noRepairReasonSchema = z.enum([
  'untrusted_terminal_status',
  'stale_base_revision',
  'catalog_drift',
  'missing_native_evidence',
  'retained_repair_state',
  'recovery_required',
  'proposal_expired',
  'deterministic_options_exhausted',
]);

export type ProcedureExecutionFailureReplanOutcome =
  | { readonly kind: 'no_repair_available'; readonly reason: z.infer<typeof noRepairReasonSchema> }
  | {
      readonly kind: 'parameter_repair_proposed';
      readonly proposal: ProcedureExecutionFailureProposal;
    }
  | {
      readonly kind: 'strategy_switch_proposed';
      readonly proposal: ProcedureExecutionFailureProposal;
    }
  | {
      readonly kind: 'semantic_replan_proposed';
      readonly proposal: ProcedureExecutionFailureProposal;
    };

export const procedureExecutionFailureReplanOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('no_repair_available'), reason: noRepairReasonSchema }),
  z.strictObject({
    kind: z.literal('parameter_repair_proposed'),
    proposal: parameterRepairProposalSchema,
  }),
  z.strictObject({
    kind: z.literal('strategy_switch_proposed'),
    proposal: strategySwitchProposalSchema,
  }),
  z.strictObject({
    kind: z.literal('semantic_replan_proposed'),
    proposal: semanticReplanProposalSchema,
  }),
]);

const parameterRepairCandidateSchema = z.strictObject({
  argument: z.string().trim().min(1).max(128),
  value: jsonValueSchema,
  observationObligations: z.array(observationObligationSchema).min(1).max(32),
});

const repairableArgumentSchema = z.strictObject({
  argument: z.string().trim().min(1).max(128),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  allowedValues: z.array(jsonValueSchema).min(1).max(64).optional(),
});

const strategyTrackSchema = z.strictObject({
  semanticLeafId: z.string().trim().min(1).max(256),
  modality: z.enum(['menu', 'shortcut', 'mcp']),
  trackId: z.string().trim().min(1).max(256),
  trajectory: z.array(jsonValueSchema).min(1).max(128),
  observationObligations: z.array(observationObligationSchema).min(1).max(32),
});

const semanticFailureBindingShape = {
  failureEnvelopeSha256: sha256Schema,
  failedStepId: z.string().trim().min(1).max(256),
  allowedScopeRootIds: z.array(z.string().trim().min(1).max(256)).min(1).max(8),
  deterministicExhaustionSha256: sha256Schema,
} as const;

const semanticGenerationEvidenceSchema = z.strictObject({
  ...semanticFailureBindingShape,
  generationRequestId: z.uuid(),
  generationResultSha256: sha256Schema,
  generatedAt: instantSchema,
});

const semanticAuthorizationConsumptionSchema = z.strictObject({
  ...semanticFailureBindingShape,
  event: decisionConsumptionEventSchema.refine(
    (event) => event.kind === 'provider_authorization_consumed',
    'Semantic replanning requires a Provider authorization-consumption event',
  ),
});

const semanticCompletedGenerationSchema = z.strictObject({
  ...semanticFailureBindingShape,
  event: decisionCompletionEventSchema.refine(
    (event) => event.kind === 'provider_call_completed',
    'Semantic replanning requires a completed Provider generation event',
  ),
});

const semanticConfidenceEvaluationSchema = z.strictObject({
  ...semanticFailureBindingShape,
  generationRequestId: z.uuid(),
  revisionRequestId: z.uuid(),
  generationResultSha256: sha256Schema,
  candidatePlanContentSha256: sha256Schema,
  confidence: z.number().min(0).max(1),
  evaluatedAt: instantSchema,
  receiptSha256: sha256Schema,
});

const trustedSemanticCandidateSchema = z.strictObject({
  revisionRequest: guideRevisionRequestSchema,
  candidatePlan: guidePlanSchema,
  generationResult: plannerReplanGenerationResultSchema,
  observationObligations: z.array(observationObligationSchema).min(1).max(32),
  generationEvidence: semanticGenerationEvidenceSchema,
  authorizationConsumption: semanticAuthorizationConsumptionSchema,
  completedGeneration: semanticCompletedGenerationSchema,
  confidenceEvaluation: semanticConfidenceEvaluationSchema,
});
export type TrustedProcedureExecutionSemanticCandidate = z.infer<
  typeof trustedSemanticCandidateSchema
>;

const canonicalIdentitySchema = z.strictObject({
  requestId: z.uuid(),
  replayId: z.uuid(),
  executionId: z.uuid(),
  stepId: z.string().trim().min(1).max(256),
});

const canonicalReceiptSchema = canonicalIdentitySchema.extend({
  receiptId: z.uuid(),
  occurredAt: instantSchema,
  content: jsonValueSchema,
});

const canonicalReportEvidenceSchema = canonicalIdentitySchema.extend({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
  occurredAt: instantSchema,
  content: jsonValueSchema,
});

const canonicalObservationFailureSchema = canonicalIdentitySchema.extend({
  kind: z.string().trim().min(1).max(180),
  expected: z.record(z.string(), jsonValueSchema),
  actual: z.record(z.string(), jsonValueSchema).nullable(),
  occurredAt: instantSchema,
  receipt: canonicalReceiptSchema,
});

const canonicalNativeCheckpointSchema = canonicalIdentitySchema.extend({
  state: z.enum(['unchanged', 'restored', 'not_created', 'failed']),
  occurredAt: instantSchema,
  receipt: canonicalReceiptSchema.nullable(),
});

const canonicalNativeRecoverySchema = canonicalIdentitySchema.extend({
  state: z.enum(['not_required', 'recovered', 'repair_retained', 'recovery_required']),
  occurredAt: instantSchema,
  receipt: canonicalReceiptSchema.nullable(),
});

const canonicalAttemptSchema = canonicalIdentitySchema.extend({
  attempt: z.number().int().positive().max(100),
  occurredAt: instantSchema,
});

const canonicalFailureEvidenceSchema = z.strictObject({
  execution: companionActionExecutionStatusSchema,
  delivery: companionActionExecutionDeliverySchema,
  actionResult: companionActionExecutionResultSchema,
  report: canonicalReportEvidenceSchema.nullable(),
  observationFailures: z.array(canonicalObservationFailureSchema).max(32),
  checkpoint: canonicalNativeCheckpointSchema,
  recovery: canonicalNativeRecoverySchema,
  attempts: z.array(canonicalAttemptSchema).min(1).max(100),
});

export type CanonicalProcedureExecutionFailureEvidence = z.infer<
  typeof canonicalFailureEvidenceSchema
>;

export interface ProcedureExecutionStrategyTrack {
  readonly modality: 'menu' | 'shortcut' | 'mcp';
  readonly trackId: string;
  readonly semanticLeafId: string;
  readonly trajectory: readonly z.input<typeof jsonValueSchema>[];
  readonly observationObligations: readonly z.input<typeof observationObligationSchema>[];
}

export interface ProcedureExecutionFailureReplanRequest {
  readonly requestId: string;
}

export const procedureExecutionFailureReplanRequestSchema = z.strictObject({
  requestId: z.uuid(),
});

export interface TrustedProcedureExecutionFailureReplanResolution {
  readonly failureEvidence: CanonicalProcedureExecutionFailureEvidence;
  readonly actionCatalog: ActionCatalog;
  readonly interactionCatalog: InteractionCatalog;
  readonly currentAcceptedRevision: number;
  readonly currentPlanContentSha256: string;
  readonly currentActionCatalogVersion: string;
  readonly currentInteractionCatalogVersion: string;
  readonly repairableArguments: readonly z.input<typeof repairableArgumentSchema>[];
  readonly parameterRepairCandidates: readonly z.input<typeof parameterRepairCandidateSchema>[];
  readonly strategy: {
    readonly currentTrackId: string;
    readonly tracks: readonly ProcedureExecutionStrategyTrack[];
  } | null;
  readonly semanticCandidate: TrustedProcedureExecutionSemanticCandidate | null;
}

export interface ProcedureExecutionFailurePolicyEvidenceResolver {
  resolve(requestId: string): TrustedProcedureExecutionFailureReplanResolution | null;
}

export const storedProcedureExecutionFailureReplanSchema = z.strictObject({
  requestSha256: sha256Schema,
  sourceBindingSha256: sha256Schema.optional(),
  envelope: procedureExecutionFailureEnvelopeSchema.nullable(),
  outcome: procedureExecutionFailureReplanOutcomeSchema,
});
export type StoredProcedureExecutionFailureReplan = z.infer<
  typeof storedProcedureExecutionFailureReplanSchema
>;

type FailureReplanDatabase = Pick<
  OperatingLineDatabase,
  'appendEvent' | 'listExecutionEventsByTypes'
>;

export interface ProcedureExecutionFailureReplanCoordinatorOptions {
  readonly database: FailureReplanDatabase;
  readonly trustedResolver: ProcedureExecutionFailurePolicyEvidenceResolver;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly proposalTtlMilliseconds?: number;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateTrustedResolution(
  input: TrustedProcedureExecutionFailureReplanResolution | null,
): TrustedProcedureExecutionFailureReplanResolution | null {
  if (input === null) return null;
  const failureEvidence = canonicalFailureEvidenceSchema.safeParse(input.failureEvidence);
  const actionCatalog = actionCatalogSchema.safeParse(input.actionCatalog);
  const interactionCatalog = interactionCatalogSchema.safeParse(input.interactionCatalog);
  const currentAcceptedRevision = z
    .number()
    .int()
    .positive()
    .safeParse(input.currentAcceptedRevision);
  const currentPlanContentSha256 = sha256Schema.safeParse(input.currentPlanContentSha256);
  const currentActionCatalogVersion = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .safeParse(input.currentActionCatalogVersion);
  const currentInteractionCatalogVersion = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .safeParse(input.currentInteractionCatalogVersion);
  const repairableArguments = repairableArgumentSchema.array().safeParse(input.repairableArguments);
  const parameterRepairCandidates = parameterRepairCandidateSchema
    .array()
    .safeParse(input.parameterRepairCandidates);
  const strategy =
    input.strategy === null
      ? { success: true as const, data: null }
      : z
          .strictObject({
            currentTrackId: z.string().trim().min(1).max(256),
            tracks: strategyTrackSchema.array(),
          })
          .safeParse(input.strategy);
  if (
    !failureEvidence.success ||
    !actionCatalog.success ||
    !interactionCatalog.success ||
    !currentAcceptedRevision.success ||
    !currentPlanContentSha256.success ||
    !currentActionCatalogVersion.success ||
    !currentInteractionCatalogVersion.success ||
    !repairableArguments.success ||
    !parameterRepairCandidates.success ||
    !strategy.success
  ) {
    return null;
  }
  try {
    validateActionCatalog(actionCatalog.data);
    validateInteractionCatalog(interactionCatalog.data, actionCatalog.data);
  } catch {
    return null;
  }
  return deepFreeze({
    failureEvidence: failureEvidence.data,
    actionCatalog: actionCatalog.data,
    interactionCatalog: interactionCatalog.data,
    currentAcceptedRevision: currentAcceptedRevision.data,
    currentPlanContentSha256: currentPlanContentSha256.data,
    currentActionCatalogVersion: currentActionCatalogVersion.data,
    currentInteractionCatalogVersion: currentInteractionCatalogVersion.data,
    repairableArguments: repairableArguments.data,
    parameterRepairCandidates: parameterRepairCandidates.data,
    strategy: strategy.data,
    semanticCandidate: input.semanticCandidate,
  });
}

function proposalWithIntegrity<T extends Record<string, unknown>>(content: T) {
  return deepFreeze({
    ...content,
    integrity: { algorithm: 'sha256' as const, contentSha256: sha256(content) },
  });
}

function proposalContent(proposal: ProcedureExecutionFailureProposal): Record<string, unknown> {
  return Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== 'integrity'));
}

function sameCanonicalIdentity(
  evidence: z.infer<typeof canonicalIdentitySchema>,
  execution: CompanionActionExecutionStatus,
): boolean {
  return (
    evidence.requestId === execution.requestId &&
    evidence.replayId === execution.replayId &&
    evidence.executionId === execution.executionId &&
    evidence.stepId === execution.step.id
  );
}

function normalizeEnvelope(
  request: ProcedureExecutionFailureReplanRequest,
  resolution: TrustedProcedureExecutionFailureReplanResolution | null,
): ProcedureExecutionFailureEnvelope | null {
  const resolved = resolution?.failureEvidence ?? null;
  const parsed = canonicalFailureEvidenceSchema.safeParse(resolved);
  if (!parsed.success) return null;
  const evidence = parsed.data;
  const execution = evidence.execution;
  const actionResult = evidence.actionResult;
  const identities = [
    ...evidence.observationFailures,
    evidence.checkpoint,
    evidence.recovery,
    ...evidence.attempts,
    ...(evidence.report === null ? [] : [evidence.report]),
    ...evidence.observationFailures.map((observation) => observation.receipt),
    ...(evidence.checkpoint.receipt === null ? [] : [evidence.checkpoint.receipt]),
    ...(evidence.recovery.receipt === null ? [] : [evidence.recovery.receipt]),
  ];
  const deliveryMatches =
    evidence.delivery.requestId === execution.requestId &&
    evidence.delivery.replayId === execution.replayId &&
    evidence.delivery.executionId === execution.executionId &&
    evidence.delivery.deliveryId === execution.deliveryId &&
    evidence.delivery.step.id === execution.step.id &&
    evidence.delivery.planContentSha256 === execution.planContentSha256 &&
    isDeepStrictEqual(evidence.delivery.target, execution.target) &&
    isDeepStrictEqual(evidence.delivery.plan, execution.plan) &&
    isDeepStrictEqual(evidence.delivery.expectedState, execution.expectedState);
  const reportMatches =
    (actionResult.report === null && evidence.report === null) ||
    (actionResult.report !== null &&
      evidence.report !== null &&
      evidence.report.reportId === actionResult.report.reportId &&
      evidence.report.sequence === actionResult.report.sequence);
  const attemptsOrdered = evidence.attempts.every(
    (attempt, index) =>
      attempt.attempt === index + 1 &&
      Date.parse(attempt.occurredAt) >= Date.parse(execution.requestedAt) &&
      Date.parse(attempt.occurredAt) <= Date.parse(actionResult.occurredAt) &&
      (index === 0 ||
        Date.parse(evidence.attempts[index - 1]!.occurredAt) <= Date.parse(attempt.occurredAt)),
  );
  const terminalAt = Date.parse(actionResult.occurredAt);
  const dispatchedAt = Date.parse(evidence.delivery.dispatchedAt);
  const evidenceOrdered =
    dispatchedAt <= terminalAt &&
    evidence.observationFailures.every(
      (observation) =>
        Date.parse(observation.occurredAt) >= dispatchedAt &&
        Date.parse(observation.occurredAt) <= terminalAt,
    ) &&
    (evidence.report === null ||
      (Date.parse(evidence.report.occurredAt) >= dispatchedAt &&
        Date.parse(evidence.report.occurredAt) <= terminalAt)) &&
    Date.parse(evidence.checkpoint.occurredAt) >= dispatchedAt &&
    Date.parse(evidence.checkpoint.occurredAt) <= terminalAt &&
    Date.parse(evidence.recovery.occurredAt) >= terminalAt;
  const checkpointReceiptValid =
    (evidence.checkpoint.state === 'not_created' || evidence.checkpoint.state === 'failed') ===
      (evidence.checkpoint.receipt === null) &&
    (evidence.checkpoint.receipt === null ||
      evidence.checkpoint.receipt.occurredAt === evidence.checkpoint.occurredAt);
  const recoveryReceiptValid =
    (evidence.recovery.state === 'recovered') === (evidence.recovery.receipt !== null) &&
    (evidence.recovery.receipt === null ||
      evidence.recovery.receipt.occurredAt === evidence.recovery.occurredAt);
  const observationReceiptsValid = evidence.observationFailures.every(
    (observation) => observation.receipt.occurredAt === observation.occurredAt,
  );
  if (
    request.requestId !== execution.requestId ||
    (execution.status !== 'failed' && execution.status !== 'rejected') ||
    execution.step.action == null ||
    execution.result === undefined ||
    !isDeepStrictEqual(execution.result, actionResult) ||
    !deliveryMatches ||
    !reportMatches ||
    !identities.every((item) => sameCanonicalIdentity(item, execution)) ||
    !attemptsOrdered ||
    !evidenceOrdered ||
    !checkpointReceiptValid ||
    !recoveryReceiptValid ||
    !observationReceiptsValid
  ) {
    return null;
  }
  const failure: ProcedureExecutionFailureTaxonomy =
    execution.status === 'rejected'
      ? 'action_rejected'
      : evidence.recovery.state === 'recovery_required'
        ? 'native_recovery_failed'
        : evidence.checkpoint.state === 'failed'
          ? 'native_checkpoint_failed'
          : evidence.observationFailures.length > 0
            ? 'observation_failed'
            : 'action_failed';
  return procedureExecutionFailureEnvelopeSchema.parse({
    formatVersion: '1.0.0',
    requestId: execution.requestId,
    replayId: execution.replayId,
    planId: execution.plan.id,
    planRevision: execution.plan.revision,
    planContentSha256: execution.planContentSha256,
    stepId: execution.step.id,
    actionName: execution.step.action!.name,
    actionCatalogVersion: resolution!.actionCatalog.catalogVersion,
    interactionCatalogVersion: resolution!.interactionCatalog.catalogVersion,
    attemptCount: evidence.attempts.length,
    failure,
    observationFailures: evidence.observationFailures.map((observation) => ({
      kind: observation.kind,
      expected: observation.expected,
      actual: observation.actual,
      receiptSha256: sha256(observation.receipt),
    })),
    nativeEvidence: {
      checkpointState: evidence.checkpoint.state,
      checkpointReceiptSha256:
        evidence.checkpoint.receipt === null ? null : sha256(evidence.checkpoint.receipt),
      recoveryState: evidence.recovery.state,
      recoveryReceiptSha256:
        evidence.recovery.receipt === null ? null : sha256(evidence.recovery.receipt),
    },
    receiptHashes: {
      delivery: sha256(evidence.delivery),
      action: sha256(actionResult),
      report: evidence.report === null ? null : sha256(evidence.report),
    },
    terminalAt: execution.result.occurredAt,
  });
}

function nativeEvidenceFailure(
  envelope: ProcedureExecutionFailureEnvelope,
): z.infer<typeof noRepairReasonSchema> | null {
  if (
    envelope.nativeEvidence.recoveryState === 'recovery_required' ||
    envelope.nativeEvidence.checkpointState === 'failed'
  ) {
    return 'recovery_required';
  }
  if (envelope.nativeEvidence.recoveryState === 'repair_retained') return 'retained_repair_state';
  if (
    envelope.receiptHashes.action === null ||
    envelope.receiptHashes.report === null ||
    (envelope.nativeEvidence.checkpointState !== 'unchanged' &&
      envelope.nativeEvidence.checkpointState !== 'restored') ||
    envelope.nativeEvidence.checkpointReceiptSha256 === null ||
    (envelope.nativeEvidence.recoveryState === 'recovered' &&
      envelope.nativeEvidence.recoveryReceiptSha256 === null)
  ) {
    return 'missing_native_evidence';
  }
  return null;
}

function validParameterCandidate(
  resolution: TrustedProcedureExecutionFailureReplanResolution,
  execution: CompanionActionExecutionStatus,
): {
  candidate: z.infer<typeof parameterRepairCandidateSchema>;
  before: z.infer<typeof jsonValueSchema>;
} | null {
  const action = execution.step.action!;
  const catalogAction = resolution.actionCatalog.actions.find(
    (entry) => entry.name === action.name,
  );
  if (catalogAction === undefined) return null;
  const declarations = repairableArgumentSchema.array().parse(resolution.repairableArguments);
  const candidates = parameterRepairCandidateSchema
    .array()
    .parse(resolution.parameterRepairCandidates)
    .sort(
      (left, right) =>
        left.argument.localeCompare(right.argument) ||
        String(canonicalizeProtocolJsonValue(left.value)).localeCompare(
          String(canonicalizeProtocolJsonValue(right.value)),
        ),
    );
  for (const candidate of candidates) {
    const declaration = declarations.find((entry) => entry.argument === candidate.argument);
    const before = action.arguments[candidate.argument];
    if (
      declaration === undefined ||
      before === undefined ||
      isDeepStrictEqual(before, candidate.value)
    ) {
      continue;
    }
    if (
      (declaration.allowedValues !== undefined &&
        !declaration.allowedValues.some((value) => isDeepStrictEqual(value, candidate.value))) ||
      (declaration.minimum !== undefined &&
        (typeof candidate.value !== 'number' || candidate.value < declaration.minimum)) ||
      (declaration.maximum !== undefined &&
        (typeof candidate.value !== 'number' || candidate.value > declaration.maximum))
    ) {
      continue;
    }
    const repairedArguments = { ...action.arguments, [candidate.argument]: candidate.value };
    if (validateActionArguments(repairedArguments, catalogAction.argumentsSchema).length === 0) {
      return { candidate, before: jsonValueSchema.parse(before) };
    }
  }
  return null;
}

function validStrategyCandidate(
  resolution: TrustedProcedureExecutionFailureReplanResolution,
  failedStepId: string,
) {
  const resolved = resolution.strategy;
  if (resolved === null) return null;
  const tracks = strategyTrackSchema.array().parse(resolved.tracks);
  const current = tracks.find((track) => track.trackId === resolved.currentTrackId);
  if (current === undefined || current.semanticLeafId !== failedStepId) return null;
  const candidate = tracks
    .filter(
      (track) =>
        track.trackId !== current.trackId && track.semanticLeafId === current.semanticLeafId,
    )
    .sort(
      (left, right) =>
        left.modality.localeCompare(right.modality) || left.trackId.localeCompare(right.trackId),
    )[0];
  return candidate === undefined ? null : { current, candidate };
}

function outcomeFor(
  resolution: TrustedProcedureExecutionFailureReplanResolution | null,
  envelope: ProcedureExecutionFailureEnvelope | null,
  execution: CompanionActionExecutionStatus | null,
  proposedAt: string,
  expiresAt: string,
  createId: () => string,
): ProcedureExecutionFailureReplanOutcome {
  if (resolution === null || envelope === null || execution === null)
    return { kind: 'no_repair_available', reason: 'untrusted_terminal_status' };
  if (
    resolution.currentAcceptedRevision !== envelope.planRevision ||
    resolution.currentPlanContentSha256 !== envelope.planContentSha256
  ) {
    return { kind: 'no_repair_available', reason: 'stale_base_revision' };
  }
  if (
    resolution.actionCatalog.adapterId !== 'blender' ||
    resolution.interactionCatalog.adapterId !== 'blender' ||
    resolution.interactionCatalog.actionCatalogVersion !==
      resolution.actionCatalog.catalogVersion ||
    resolution.currentActionCatalogVersion !== envelope.actionCatalogVersion ||
    resolution.currentInteractionCatalogVersion !== envelope.interactionCatalogVersion
  ) {
    return { kind: 'no_repair_available', reason: 'catalog_drift' };
  }
  const nativeFailure = nativeEvidenceFailure(envelope);
  if (nativeFailure !== null) return { kind: 'no_repair_available', reason: nativeFailure };

  const common = {
    formatVersion: '1.0.0' as const,
    proposalId: createId(),
    status: 'pending' as const,
    failureEnvelopeSha256: sha256(envelope),
    base: {
      planId: envelope.planId,
      revision: envelope.planRevision,
      planContentSha256: envelope.planContentSha256,
    },
    catalogs: {
      actionCatalogVersion: envelope.actionCatalogVersion,
      interactionCatalogVersion: envelope.interactionCatalogVersion,
    },
    proposedAt,
    expiresAt,
  };
  const parameter = validParameterCandidate(resolution, execution);
  if (parameter !== null) {
    const proposal = procedureExecutionFailureProposalSchema.parse(
      proposalWithIntegrity({
        ...common,
        kind: 'parameter_repair' as const,
        diff: {
          actionName: envelope.actionName,
          argument: parameter.candidate.argument,
          before: parameter.before,
          after: parameter.candidate.value,
        },
        observationObligations: parameter.candidate.observationObligations,
      }),
    );
    return deepFreeze({ kind: 'parameter_repair_proposed', proposal });
  }
  const strategy = validStrategyCandidate(resolution, envelope.stepId);
  if (strategy !== null) {
    const proposal = procedureExecutionFailureProposalSchema.parse(
      proposalWithIntegrity({
        ...common,
        kind: 'strategy_switch' as const,
        diff: {
          semanticLeafId: strategy.candidate.semanticLeafId,
          modality: strategy.candidate.modality,
          fromTrackId: strategy.current.trackId,
          toTrackId: strategy.candidate.trackId,
          verifiedTrackContentSha256: sha256(strategy.candidate),
        },
        observationObligations: strategy.candidate.observationObligations,
      }),
    );
    return deepFreeze({ kind: 'strategy_switch_proposed', proposal });
  }
  const failureEnvelopeSha256 = sha256(envelope);
  const allowedScopeRootIds = [envelope.stepId];
  const deterministicExhaustionSha256 = sha256({
    failureEnvelopeSha256,
    failedStepId: envelope.stepId,
    policySha256: sha256({
      repairableArguments: resolution.repairableArguments,
      parameterRepairCandidates: resolution.parameterRepairCandidates,
      strategy: resolution.strategy,
    }),
    parameterCandidate: null,
    strategyCandidate: null,
  });
  if (resolution.semanticCandidate !== null) {
    const semantic = trustedSemanticCandidateSchema.safeParse(resolution.semanticCandidate);
    if (!semantic.success) {
      return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
    }
    const candidate = semantic.data;
    // Failure-replan evidence does not carry the trusted three-way merge context required to
    // restore host-owned projections from an expected merged plan. Using basePlan here would
    // silently attach target-branch guidance to an unverified merge, so merge candidates fail closed.
    if (candidate.revisionRequest.revisionOperation?.kind === 'merge') {
      return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
    }
    const generationResult = candidate.generationResult as PlannerReplanGenerationResult;
    const providerRevisionRequest = guideRevisionRequestSchema.parse({
      ...candidate.revisionRequest,
      basePlan: projectGuidePlanForProvider(candidate.revisionRequest.basePlan),
    });
    let rawLocality: ReturnType<typeof evaluateLocalReplanScope>;
    let rawPlanningQuality: PlannerReplanGenerationResult['planningQuality'];
    try {
      rawLocality = evaluateLocalReplanScope(
        providerRevisionRequest as GuideRevisionRequest,
        candidate.candidatePlan as GuidePlan,
      );
      rawPlanningQuality = evaluatePlanningQuality(
        planningQualityEvaluationRequestSchema.parse({
          targetAdapterId: providerRevisionRequest.adapterId,
          catalogVersion: generationResult.draft.catalogVersion,
          goal: generationResult.draft.planning.goal,
          requiredPhaseIds: generationResult.draft.planning.requiredPhaseIds,
          ...(generationResult.draft.planning.capabilityCoverage === undefined
            ? {}
            : { capabilityCoverage: generationResult.draft.planning.capabilityCoverage }),
          plan: generationResult.draft.plan,
        }),
        resolution.actionCatalog,
        {
          allowedCoverageStepIds: localReplanCoverageStepIds(
            providerRevisionRequest as GuideRevisionRequest,
            generationResult.draft.plan,
          ),
        },
      );
    } catch {
      return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
    }
    const rawEvidencePlanContentSha256 = sha256(candidate.candidatePlan);
    const canonicalGenerationResultSha256 = sha256(generationResult);
    const generation = candidate.generationEvidence;
    const consumption = candidate.authorizationConsumption.event as DecisionConsumptionEvent;
    const completion = candidate.completedGeneration.event as DecisionCompletionEvent;
    const confidence = candidate.confidenceEvaluation;
    const confidenceReceiptSha256 = sha256({
      failureEnvelopeSha256: confidence.failureEnvelopeSha256,
      failedStepId: confidence.failedStepId,
      allowedScopeRootIds: confidence.allowedScopeRootIds,
      deterministicExhaustionSha256: confidence.deterministicExhaustionSha256,
      generationRequestId: confidence.generationRequestId,
      revisionRequestId: confidence.revisionRequestId,
      generationResultSha256: confidence.generationResultSha256,
      candidatePlanContentSha256: confidence.candidatePlanContentSha256,
      confidence: confidence.confidence,
      evaluatedAt: confidence.evaluatedAt,
    });
    const exactFailureBinding = (binding: {
      readonly failureEnvelopeSha256: string;
      readonly failedStepId: string;
      readonly allowedScopeRootIds: readonly string[];
      readonly deterministicExhaustionSha256: string;
    }): boolean =>
      binding.failureEnvelopeSha256 === failureEnvelopeSha256 &&
      binding.failedStepId === envelope.stepId &&
      isDeepStrictEqual(binding.allowedScopeRootIds, allowedScopeRootIds) &&
      binding.deterministicExhaustionSha256 === deterministicExhaustionSha256;
    if (
      exactFailureBinding(generation) &&
      exactFailureBinding(candidate.authorizationConsumption) &&
      exactFailureBinding(candidate.completedGeneration) &&
      exactFailureBinding(confidence) &&
      consumption.kind === 'provider_authorization_consumed' &&
      completion.kind === 'provider_call_completed' &&
      consumption.credentialId === completion.credentialId &&
      consumption.operationId === generation.generationRequestId &&
      completion.operationId === generation.generationRequestId &&
      generationResult.status === 'ready' &&
      generationResult.requestId === generation.generationRequestId &&
      generationResult.revisionRequestId === candidate.revisionRequest.requestId &&
      generationResult.targetAdapterId === execution.target.adapterId &&
      generationResult.targetInstanceId === execution.target.instanceId &&
      generationResult.draft.requestId === candidate.revisionRequest.requestId &&
      generationResult.draft.catalogVersion === resolution.actionCatalog.catalogVersion &&
      generationResult.draft.planning.goal === candidate.revisionRequest.message &&
      generationResult.draft.plan.protocolVersion ===
        candidate.revisionRequest.basePlan.protocolVersion &&
      isDeepStrictEqual(generationResult.draft.plan, candidate.candidatePlan) &&
      generation.generationResultSha256 === canonicalGenerationResultSha256 &&
      generation.generatedAt === generationResult.generatedAt &&
      completion.durableReceiptSha256 === canonicalGenerationResultSha256 &&
      confidence.generationRequestId === generation.generationRequestId &&
      confidence.revisionRequestId === candidate.revisionRequest.requestId &&
      confidence.generationResultSha256 === generation.generationResultSha256 &&
      confidence.candidatePlanContentSha256 === rawEvidencePlanContentSha256 &&
      confidence.receiptSha256 === confidenceReceiptSha256 &&
      Date.parse(consumption.consumedAt) > Date.parse(envelope.terminalAt) &&
      Date.parse(generation.generatedAt) > Date.parse(envelope.terminalAt) &&
      Date.parse(consumption.consumedAt) <= Date.parse(generation.generatedAt) &&
      Date.parse(generation.generatedAt) <= Date.parse(completion.completedAt) &&
      Date.parse(completion.completedAt) <= Date.parse(confidence.evaluatedAt) &&
      candidate.revisionRequest.adapterId === execution.target.adapterId &&
      candidate.revisionRequest.instanceId === execution.target.instanceId &&
      candidate.revisionRequest.catalogVersion === resolution.actionCatalog.catalogVersion &&
      candidate.revisionRequest.basePlan.id === envelope.planId &&
      candidate.revisionRequest.basePlan.revision === envelope.planRevision &&
      sha256(candidate.revisionRequest.basePlan) === envelope.planContentSha256 &&
      candidate.revisionRequest.references.some(
        (reference) => reference.nodeId === envelope.stepId,
      ) &&
      rawLocality.locality.valid &&
      generationResult.locality.valid &&
      isDeepStrictEqual(generationResult.locality, rawLocality.locality) &&
      isDeepStrictEqual(generationResult.planDiff, rawLocality.planDiff) &&
      rawPlanningQuality.valid &&
      isDeepStrictEqual(generationResult.planningQuality, rawPlanningQuality) &&
      isDeepStrictEqual(rawLocality.locality.scopeRootIds, allowedScopeRootIds) &&
      confidence.confidence >= semanticReplanConfidenceThreshold
    ) {
      const canonicalPlan = restoreHostOwnedCandidateMenuProjections(
        generationResult.draft.plan,
        candidate.revisionRequest.basePlan,
      );
      let canonicalLocality: ReturnType<typeof evaluateLocalReplanScope>;
      let canonicalPlanningQuality: PlannerReplanGenerationResult['planningQuality'];
      try {
        validateProposalTarget(canonicalPlan, execution.target.adapterId);
        validateGuidePlanAgainstActionCatalog(canonicalPlan, resolution.actionCatalog);
        canonicalLocality = evaluateLocalReplanScope(
          candidate.revisionRequest as GuideRevisionRequest,
          canonicalPlan,
        );
        canonicalPlanningQuality = evaluatePlanningQuality(
          planningQualityEvaluationRequestSchema.parse({
            targetAdapterId: candidate.revisionRequest.adapterId,
            catalogVersion: generationResult.draft.catalogVersion,
            goal: generationResult.draft.planning.goal,
            requiredPhaseIds: generationResult.draft.planning.requiredPhaseIds,
            ...(generationResult.draft.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: generationResult.draft.planning.capabilityCoverage }),
            plan: canonicalPlan,
          }),
          resolution.actionCatalog,
          {
            allowedCoverageStepIds: localReplanCoverageStepIds(
              candidate.revisionRequest as GuideRevisionRequest,
              canonicalPlan,
            ),
          },
        );
      } catch {
        return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
      }
      if (
        !canonicalLocality.locality.valid ||
        !canonicalPlanningQuality.valid ||
        !isDeepStrictEqual(canonicalLocality.planDiff, generationResult.planDiff) ||
        !isDeepStrictEqual(canonicalLocality.locality, generationResult.locality) ||
        !isDeepStrictEqual(canonicalPlanningQuality, generationResult.planningQuality) ||
        !isDeepStrictEqual(canonicalLocality.locality.scopeRootIds, allowedScopeRootIds)
      ) {
        return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
      }
      const canonicalProposalPlanContentSha256 = sha256(canonicalPlan);
      const proposal = procedureExecutionFailureProposalSchema.parse(
        proposalWithIntegrity({
          ...common,
          kind: 'semantic_replan' as const,
          diff: {
            candidatePlanContentSha256: canonicalProposalPlanContentSha256,
            localScopeStepIds: canonicalLocality.locality.scopeRootIds,
            confidence: confidence.confidence,
            threshold: semanticReplanConfidenceThreshold,
          },
          observationObligations: candidate.observationObligations,
        }),
      );
      return deepFreeze({ kind: 'semantic_replan_proposed', proposal });
    }
  }
  return { kind: 'no_repair_available', reason: 'deterministic_options_exhausted' };
}

export function createProcedureExecutionFailureReplanCoordinator(
  options: ProcedureExecutionFailureReplanCoordinatorOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const ttl = options.proposalTtlMilliseconds ?? 15 * 60 * 1_000;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 15 * 60 * 1_000) {
    throw new Error(
      'Failure replan Proposal TTL must be between one millisecond and fifteen minutes',
    );
  }
  const stored = new Map<string, StoredProcedureExecutionFailureReplan>();
  for (const event of options.database.listExecutionEventsByTypes([failureReplanEventType])) {
    const prefix = 'procedure-execution-failure-replan:';
    if (!event.id.startsWith(prefix)) throw new Error('Stored failure replan event id is invalid');
    const payload = storedProcedureExecutionFailureReplanSchema.parse(event.payload);
    const requestId = event.id.slice(prefix.length);
    if (payload.envelope !== null && payload.envelope.requestId !== requestId) {
      throw new Error('Stored failure replan envelope requestId is invalid');
    }
    if (
      payload.outcome.kind !== 'no_repair_available' &&
      payload.outcome.proposal.integrity.contentSha256 !==
        sha256(proposalContent(payload.outcome.proposal))
    ) {
      throw new Error('Stored failure replan Proposal integrity is invalid');
    }
    stored.set(requestId, deepFreeze(payload));
  }

  const currentOutcome = (
    record: StoredProcedureExecutionFailureReplan,
  ): ProcedureExecutionFailureReplanOutcome =>
    record.outcome.kind !== 'no_repair_available' &&
    Date.parse(record.outcome.proposal.expiresAt) <= Date.parse(now())
      ? { kind: 'no_repair_available', reason: 'proposal_expired' }
      : record.outcome;

  const derive = (
    requestInput: ProcedureExecutionFailureReplanRequest,
  ): ProcedureExecutionFailureReplanOutcome => {
    const request = procedureExecutionFailureReplanRequestSchema.parse(requestInput);
    const requestSha256 = sha256(request);
    const existing = stored.get(request.requestId);
    if (existing !== undefined) {
      if (existing.requestSha256 !== requestSha256) {
        throw new Error(
          `Failure replan request ${request.requestId} is already bound to other evidence`,
        );
      }
      return currentOutcome(existing);
    }
    const resolution = validateTrustedResolution(
      options.trustedResolver.resolve(request.requestId),
    );
    const envelope = normalizeEnvelope(request, resolution);
    const proposedAt = now();
    const outcome = deepFreeze(
      outcomeFor(
        resolution,
        envelope,
        resolution?.failureEvidence.execution ?? null,
        proposedAt,
        new Date(Date.parse(proposedAt) + ttl).toISOString(),
        createId,
      ),
    );
    const payload = deepFreeze(
      storedProcedureExecutionFailureReplanSchema.parse({
        requestSha256,
        sourceBindingSha256: sha256({
          request,
          envelope,
          actionCatalogSha256: resolution === null ? null : sha256(resolution.actionCatalog),
          interactionCatalogSha256:
            resolution === null ? null : sha256(resolution.interactionCatalog),
          repairPolicy:
            resolution === null
              ? null
              : {
                  repairableArguments: resolution.repairableArguments,
                  parameterRepairCandidates: resolution.parameterRepairCandidates,
                  strategy: resolution.strategy,
                },
          semanticCandidateSha256:
            resolution?.semanticCandidate == null ? null : sha256(resolution.semanticCandidate),
        }),
        envelope,
        outcome,
      }),
    );
    options.database.appendEvent({
      id: `procedure-execution-failure-replan:${request.requestId}`,
      eventType: failureReplanEventType,
      payload,
      createdAt: proposedAt,
    });
    stored.set(request.requestId, payload);
    return outcome;
  };

  return {
    derive,
    get: (requestId: string) => {
      const record = stored.get(requestId);
      return record === undefined ? null : currentOutcome(record);
    },
    getRaw: (requestId: string) => stored.get(requestId)?.outcome ?? null,
    getStored: (requestId: string) => stored.get(requestId) ?? null,
  };
}

export type ProcedureExecutionFailureReplanCoordinator = ReturnType<
  typeof createProcedureExecutionFailureReplanCoordinator
>;
