import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  companionActionExecutionDeliverySchema,
  companionActionExecutionStatusSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  validateActionArguments,
  type ActionCatalog,
  type CompanionActionExecutionStatus,
  type ProcedureLeafNode,
  type ProcedureLeafReplayFailureRecoveryAttestation,
} from '@operatingline/protocol';
import { z } from 'zod';

import type { ActionCatalogRegistry } from './action-catalogs.js';
import type { InteractionCatalogRegistry } from './interaction-catalogs.js';
import type {
  CanonicalProcedureExecutionFailureEvidence,
  ProcedureExecutionFailurePolicyEvidenceResolver,
  ProcedureExecutionStrategyTrack,
  TrustedProcedureExecutionFailureReplanResolution,
} from './procedure-execution-failure-replan.js';

const terminalEventType = 'blender.action-execution.completed' as const;
const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;
const storedActionExecutionEventSchema = z.strictObject({
  execution: companionActionExecutionStatusSchema,
  sessionFingerprintSha256: contentSha256Schema,
});
type StoredActionExecutionEvent = z.infer<typeof storedActionExecutionEventSchema>;

type RuntimeDatabase = Pick<
  OperatingLineDatabase,
  'getProcedureLeafReplay' | 'getProcedureLeafReplayAttestation' | 'listExecutionEventsByTypes'
>;

export interface ProcedureExecutionFailureReplanRuntimeResolver extends ProcedureExecutionFailurePolicyEvidenceResolver {
  findRequestIdForAttestation(
    attestation: ProcedureLeafReplayFailureRecoveryAttestation,
  ): string | null;
  listResolvableRequestIds(): readonly string[];
}

export interface ProcedureExecutionProofTrackBinding {
  readonly semanticLeafId: string;
  readonly recipeId: string;
  readonly modality: 'menu' | 'shortcut';
  readonly trackId: string;
  /** Hash of the strategy wrapper committed by the failure-replan candidate. */
  readonly verifiedTrackContentSha256: string;
  /** Hash of the exact materialized ProcedureTrack stored in the replay binding. */
  readonly trackContentSha256: string;
  readonly proofExecutionContentSha256: string;
  readonly observationObligations: readonly {
    readonly kind: string;
    readonly parameters: Readonly<Record<string, JsonValue>>;
  }[];
}

export interface ProcedureExecutionProofStrategyBinding {
  readonly currentTrackId: string;
  readonly currentTrackContentSha256: string;
  readonly candidates: readonly ProcedureExecutionProofTrackBinding[];
}

export interface ProcedureExecutionFailureReplanRuntimeResolverOptions {
  readonly database: RuntimeDatabase;
  readonly actionCatalogRegistry: Pick<ActionCatalogRegistry, 'get'>;
  readonly interactionCatalogRegistry: Pick<InteractionCatalogRegistry, 'get'>;
  readonly resolveCurrentAcceptedPlan: (
    adapterId: 'blender',
    instanceId: string,
  ) => {
    readonly id: string;
    readonly revision: number;
    readonly contentSha256: string;
  } | null;
}

function jsonValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function uuidFromEvidence(namespace: string, value: unknown): string {
  const digest = createHash('sha256')
    .update(namespace)
    .update('\0')
    .update(canonicalizeProtocolJsonValue(value))
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function contentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function isIdentityArgument(argument: string): boolean {
  const normalized = argument
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/-/gu, '_')
    .toLowerCase();
  return normalized.split('_').some((part) => part === 'id' || part === 'name');
}

function terminalExecutions(database: RuntimeDatabase): StoredActionExecutionEvent[] {
  const byRequest = new Map<string, StoredActionExecutionEvent>();
  const ambiguousRequests = new Set<string>();
  for (const event of database.listExecutionEventsByTypes([terminalEventType])) {
    const parsed = storedActionExecutionEventSchema.safeParse(event.payload);
    if (!parsed.success) continue;
    const execution = parsed.data.execution;
    if (execution.status !== 'failed' && execution.status !== 'rejected') continue;
    if (byRequest.has(execution.requestId) || ambiguousRequests.has(execution.requestId)) {
      // A request must have exactly one durable completed event. Treat duplicates as ambiguity.
      byRequest.delete(execution.requestId);
      ambiguousRequests.add(execution.requestId);
      continue;
    }
    byRequest.set(execution.requestId, parsed.data);
  }
  return [...byRequest.values()];
}

function executionMatchesAttestation(
  execution: CompanionActionExecutionStatus,
  sessionFingerprintSha256: string,
  attestation: ProcedureLeafReplayFailureRecoveryAttestation,
): boolean {
  return (
    execution.status === 'failed' &&
    execution.result?.status === 'failed' &&
    execution.replayId === attestation.replayId &&
    execution.executionId === attestation.execution.execution.id &&
    execution.target.adapterId === attestation.execution.host.adapterId &&
    execution.target.instanceId === attestation.execution.host.instanceId &&
    execution.plan.id === attestation.execution.plan.id &&
    execution.plan.revision === attestation.execution.plan.revision &&
    execution.planContentSha256 === attestation.execution.plan.contentSha256 &&
    execution.step.id === attestation.execution.step.id &&
    execution.step.action?.adapterId === attestation.execution.action.adapterId &&
    execution.step.action.name === attestation.execution.action.name &&
    sessionFingerprintSha256 === attestation.provenance.executionSessionFingerprintSha256 &&
    execution.result.report?.reportId === attestation.failureReport.reportId &&
    execution.result.report.sequence === attestation.failureReport.sequence &&
    Date.parse(attestation.failureReport.occurredAt) <= Date.parse(execution.result.occurredAt)
  );
}

function executionAttestationMatchKey({
  execution,
  sessionFingerprintSha256,
}: StoredActionExecutionEvent): string | null {
  const report = execution.result?.report;
  if (
    execution.status !== 'failed' ||
    execution.result?.status !== 'failed' ||
    report === null ||
    report === undefined
  ) {
    return null;
  }
  return JSON.stringify([
    execution.replayId,
    execution.executionId,
    execution.target.adapterId,
    execution.target.instanceId,
    execution.plan.id,
    execution.plan.revision,
    execution.planContentSha256,
    execution.step.id,
    execution.step.action?.adapterId,
    execution.step.action?.name,
    sessionFingerprintSha256,
    report.reportId,
    report.sequence,
  ]);
}

function attestationMatchKey(attestation: ProcedureLeafReplayFailureRecoveryAttestation): string {
  return JSON.stringify([
    attestation.replayId,
    attestation.execution.execution.id,
    attestation.execution.host.adapterId,
    attestation.execution.host.instanceId,
    attestation.execution.plan.id,
    attestation.execution.plan.revision,
    attestation.execution.plan.contentSha256,
    attestation.execution.step.id,
    attestation.execution.action.adapterId,
    attestation.execution.action.name,
    attestation.provenance.executionSessionFingerprintSha256,
    attestation.failureReport.reportId,
    attestation.failureReport.sequence,
  ]);
}

function observationObligations(leaf: ProcedureLeafNode) {
  return leaf.expectedObservations.map((observation) => ({
    kind: observation.kind,
    parameters: jsonValueSchema
      .pipe(z.record(z.string(), jsonValueSchema))
      .parse(jsonValue(observation.parameters)),
  }));
}

function repairPolicy(
  actionCatalog: ActionCatalog,
  leaf: ProcedureLeafNode,
): Pick<
  TrustedProcedureExecutionFailureReplanResolution,
  'repairableArguments' | 'parameterRepairCandidates'
> {
  const action = actionCatalog.actions.find((candidate) => candidate.name === leaf.action?.name);
  if (action === undefined || leaf.action === null) {
    return { repairableArguments: [], parameterRepairCandidates: [] };
  }
  const properties = action.argumentsSchema.properties as Record<string, unknown>;
  const obligations = observationObligations(leaf);
  const repairableArguments: Array<{
    argument: string;
    minimum?: number;
    maximum?: number;
    allowedValues?: JsonValue[];
  }> = [];
  const parameterRepairCandidates: Array<{
    argument: string;
    value: JsonValue;
    observationObligations: typeof obligations;
  }> = [];

  for (const argument of Object.keys(leaf.action.arguments).sort()) {
    if (isIdentityArgument(argument)) continue;
    const schema = properties[argument];
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) continue;
    const property = schema as Record<string, unknown>;
    const before = leaf.action.arguments[argument];
    const values: unknown[] = [];
    if (Array.isArray(property['enum']) && property['enum'].length > 1) {
      const allowedValues = property['enum'].map(jsonValue);
      repairableArguments.push({ argument, allowedValues });
      values.push(...allowedValues.filter((value) => !isDeepStrictEqual(value, before)));
    } else if (
      (property['type'] === 'number' || property['type'] === 'integer') &&
      typeof before === 'number' &&
      Number.isFinite(before)
    ) {
      const minimum = typeof property['minimum'] === 'number' ? property['minimum'] : undefined;
      const maximum = typeof property['maximum'] === 'number' ? property['maximum'] : undefined;
      repairableArguments.push({
        argument,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      });
      const scaled = before === 0 ? [-1, 1] : [before * 0.5, before * 1.5];
      for (let value of scaled) {
        if (property['type'] === 'integer') value = Math.round(value);
        if (minimum !== undefined) value = Math.max(minimum, value);
        if (maximum !== undefined) value = Math.min(maximum, value);
        if (!values.some((candidate) => isDeepStrictEqual(candidate, value))) values.push(value);
      }
    }
    for (const value of values) {
      if (isDeepStrictEqual(value, before)) continue;
      const nextArguments = { ...leaf.action.arguments, [argument]: value };
      if (validateActionArguments(nextArguments, action.argumentsSchema).length !== 0) continue;
      let projected = false;
      const repairedObligations = obligations.map((obligation) => {
        if (!Object.hasOwn(obligation.parameters, argument)) return obligation;
        projected = true;
        return {
          ...obligation,
          parameters: { ...obligation.parameters, [argument]: jsonValue(value) },
        };
      });
      if (!projected) continue;
      parameterRepairCandidates.push({
        argument,
        value: jsonValue(value),
        observationObligations: repairedObligations,
      });
    }
  }
  return { repairableArguments, parameterRepairCandidates };
}

function strategyTracksForLeaf(leaf: ProcedureLeafNode) {
  const availableMcp = leaf.mcpTracks.filter((track) => track.availability === 'available');
  if (availableMcp.length !== 1) return null;
  const current = availableMcp[0]!;
  const obligations = observationObligations(leaf);
  const currentStrategy: ProcedureExecutionStrategyTrack = {
    semanticLeafId: leaf.id,
    modality: 'mcp',
    trackId: current.id,
    trajectory: current.operations.map(jsonValue),
    observationObligations: obligations,
  };
  const candidates: Array<{
    strategy: ProcedureExecutionStrategyTrack;
    trackContentSha256: string;
    proofExecutionContentSha256: string;
  }> = [];
  for (const track of [...leaf.menuTracks, ...leaf.shortcutTracks]) {
    if (track.availability !== 'available' || track.proofExecution === undefined) continue;
    candidates.push({
      strategy: {
        semanticLeafId: leaf.id,
        modality: track.modality,
        trackId: track.id,
        trajectory: track.operations.map(jsonValue),
        observationObligations: obligations,
      },
      trackContentSha256: contentSha256(track),
      proofExecutionContentSha256: contentSha256(track.proofExecution),
    });
  }
  return { current, currentStrategy, candidates };
}

function strategyForLeaf(
  leaf: ProcedureLeafNode,
): TrustedProcedureExecutionFailureReplanResolution['strategy'] {
  const resolved = strategyTracksForLeaf(leaf);
  if (resolved === null) return null;
  return {
    currentTrackId: resolved.current.id,
    tracks: [resolved.currentStrategy, ...resolved.candidates.map(({ strategy }) => strategy)],
  };
}

/**
 * Derive immutable proof-track hashes from the exact materialized replay leaf.
 * These hashes are review authority only; they do not grant execution authority.
 */
export function procedureExecutionProofStrategyBindingForLeaf(
  leaf: ProcedureLeafNode,
  recipeId: string,
): ProcedureExecutionProofStrategyBinding | null {
  const resolved = strategyTracksForLeaf(leaf);
  if (resolved === null) return null;
  return {
    currentTrackId: resolved.current.id,
    currentTrackContentSha256: contentSha256(resolved.current),
    candidates: resolved.candidates.map(
      ({ strategy, trackContentSha256, proofExecutionContentSha256 }) => ({
        semanticLeafId: leaf.id,
        recipeId,
        modality: strategy.modality as 'menu' | 'shortcut',
        trackId: strategy.trackId,
        verifiedTrackContentSha256: contentSha256(strategy),
        trackContentSha256,
        proofExecutionContentSha256,
        observationObligations: strategy.observationObligations,
      }),
    ),
  };
}

function canonicalFailureEvidence(
  execution: CompanionActionExecutionStatus,
  attestation: ProcedureLeafReplayFailureRecoveryAttestation,
): CanonicalProcedureExecutionFailureEvidence | null {
  if (
    execution.deliveryId === undefined ||
    execution.dispatchedAt === undefined ||
    execution.result === undefined ||
    execution.result.report === null
  ) {
    return null;
  }
  const identity = {
    requestId: execution.requestId,
    replayId: execution.replayId,
    executionId: execution.executionId,
    stepId: execution.step.id,
  };
  const delivery = companionActionExecutionDeliverySchema.safeParse({
    formatVersion: execution.formatVersion,
    requestId: execution.requestId,
    replayId: execution.replayId,
    target: execution.target,
    proposalId: execution.proposalId,
    plan: execution.plan,
    planContentSha256: execution.planContentSha256,
    executionId: execution.executionId,
    expectedState: execution.expectedState,
    deliveryId: execution.deliveryId,
    step: execution.step,
    requestedAt: execution.requestedAt,
    dispatchedAt: execution.dispatchedAt,
  });
  if (!delivery.success) return null;
  const reportReceipt = {
    ...identity,
    receiptId: uuidFromEvidence('failure-report-receipt', {
      identity,
      attestationId: attestation.attestationId,
      reportId: attestation.failureReport.reportId,
      receipt: attestation.provenance.failureReportReceipt,
    }),
    occurredAt: attestation.failureReport.occurredAt,
    content: jsonValue(attestation.provenance.failureReportReceipt),
  };
  const observations = attestation.failureReport.observations.map((observation, index) => {
    const expected = execution.step.expectedObservations.find(
      (candidate) => candidate.kind === observation.kind,
    );
    return {
      ...identity,
      kind: observation.kind,
      expected: jsonValueSchema
        .pipe(z.record(z.string(), jsonValueSchema))
        .parse(jsonValue(expected?.parameters ?? {})),
      actual: jsonValueSchema
        .pipe(z.record(z.string(), jsonValueSchema))
        .parse(jsonValue(observation.details)),
      occurredAt: attestation.failureReport.occurredAt,
      receipt: {
        ...identity,
        receiptId: uuidFromEvidence(`failure-observation-${index}`, {
          identity,
          attestationId: attestation.attestationId,
          reportId: attestation.failureReport.reportId,
          observation,
        }),
        occurredAt: attestation.failureReport.occurredAt,
        content: jsonValue(observation),
      },
    };
  });
  const attemptCount = attestation.failureReport.observationGate.retry?.attempt ?? 1;
  return {
    execution,
    delivery: delivery.data,
    actionResult: execution.result,
    report: {
      ...identity,
      reportId: attestation.failureReport.reportId,
      sequence: attestation.failureReport.sequence,
      occurredAt: attestation.failureReport.occurredAt,
      content: jsonValue(attestation.failureReport),
    },
    observationFailures: observations,
    checkpoint: {
      ...identity,
      state: 'restored',
      occurredAt: attestation.failureReport.occurredAt,
      receipt: reportReceipt,
    },
    recovery: {
      ...identity,
      state: 'not_required',
      occurredAt:
        Date.parse(attestation.attestedAt) >= Date.parse(execution.result.occurredAt)
          ? attestation.attestedAt
          : execution.result.occurredAt,
      receipt: null,
    },
    attempts: Array.from({ length: attemptCount }, (_, index) => ({
      ...identity,
      attempt: index + 1,
      occurredAt: index === 0 ? execution.requestedAt : attestation.failureReport.occurredAt,
    })),
  };
}

export function createProcedureExecutionFailureReplanRuntimeResolver(
  options: ProcedureExecutionFailureReplanRuntimeResolverOptions,
): ProcedureExecutionFailureReplanRuntimeResolver {
  const matchingExecutions = (
    attestation: ProcedureLeafReplayFailureRecoveryAttestation,
    storedExecutions: readonly StoredActionExecutionEvent[],
  ) =>
    storedExecutions.filter(({ execution, sessionFingerprintSha256 }) =>
      executionMatchesAttestation(execution, sessionFingerprintSha256, attestation),
    );

  const findRequestIdForAttestation = (
    input: ProcedureLeafReplayFailureRecoveryAttestation,
  ): string | null => {
    const parsed = procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(input);
    if (!parsed.success || parsed.data.outcome !== 'automatically_rolled_back') return null;
    const matches = matchingExecutions(parsed.data, terminalExecutions(options.database));
    return matches.length === 1 ? matches[0]!.execution.requestId : null;
  };

  const resolveStoredExecution = ({
    execution,
    sessionFingerprintSha256,
  }: StoredActionExecutionEvent): TrustedProcedureExecutionFailureReplanResolution | null => {
    const bindingResult = procedureLeafReplayBindingSchema.safeParse(
      options.database.getProcedureLeafReplay(execution.replayId),
    );
    const attestationResult = procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(
      options.database.getProcedureLeafReplayAttestation(execution.replayId),
    );
    if (!bindingResult.success || !attestationResult.success) return null;
    const binding = bindingResult.data;
    const attestation = attestationResult.data;
    if (
      attestation.outcome !== 'automatically_rolled_back' ||
      attestation.bindingContentSha256 !== binding.integrity.contentSha256 ||
      !executionMatchesAttestation(execution, sessionFingerprintSha256, attestation) ||
      binding.replayId !== execution.replayId ||
      binding.leafId !== execution.step.id ||
      binding.planContentSha256 !== execution.planContentSha256 ||
      binding.proposal.proposalId !== execution.proposalId
    ) {
      return null;
    }
    const currentAcceptedPlan = options.resolveCurrentAcceptedPlan(
      execution.target.adapterId,
      execution.target.instanceId,
    );
    if (currentAcceptedPlan === null || currentAcceptedPlan.id !== execution.plan.id) {
      return null;
    }
    const leaf = binding.materialization.tree.nodes.find((node) => node.id === binding.leafId);
    if (
      leaf?.kind !== 'leaf' ||
      leaf.action === null ||
      !isDeepStrictEqual(leaf.action, execution.step.action)
    ) {
      return null;
    }
    const embeddedAction = binding.request.packet.context.catalogBinding.actionCatalog;
    const embeddedInteraction = binding.request.packet.context.catalogBinding.interactionCatalog;
    let actionCatalog: ActionCatalog;
    let interactionCatalog;
    try {
      actionCatalog = options.actionCatalogRegistry.get({
        targetAdapterId: binding.materialization.tree.adapterId,
        catalogVersion: embeddedAction.catalogVersion,
      });
      interactionCatalog = options.interactionCatalogRegistry.get({
        targetAdapterId: binding.materialization.tree.adapterId,
        actionCatalogVersion: embeddedAction.catalogVersion,
        interactionCatalogVersion: embeddedInteraction.catalogVersion,
      });
    } catch {
      return null;
    }
    if (
      !isDeepStrictEqual(actionCatalog, {
        adapterId: binding.materialization.tree.adapterId,
        ...embeddedAction,
      }) ||
      !isDeepStrictEqual(interactionCatalog, {
        adapterId: binding.materialization.tree.adapterId,
        actionCatalogVersion: embeddedAction.catalogVersion,
        ...embeddedInteraction,
      })
    ) {
      return null;
    }
    const failureEvidence = canonicalFailureEvidence(execution, attestation);
    if (failureEvidence === null) return null;
    const policy = repairPolicy(actionCatalog, leaf);
    return {
      failureEvidence,
      actionCatalog,
      interactionCatalog,
      currentAcceptedRevision: currentAcceptedPlan.revision,
      currentPlanContentSha256: currentAcceptedPlan.contentSha256,
      currentActionCatalogVersion: actionCatalog.catalogVersion,
      currentInteractionCatalogVersion: interactionCatalog.catalogVersion,
      ...policy,
      strategy: strategyForLeaf(leaf),
      semanticCandidate: null,
    };
  };

  const resolve = (requestId: string): TrustedProcedureExecutionFailureReplanResolution | null => {
    const matches = terminalExecutions(options.database).filter(
      ({ execution }) => execution.requestId === requestId,
    );
    return matches.length === 1 ? resolveStoredExecution(matches[0]!) : null;
  };

  const listResolvableRequestIds = (): readonly string[] => {
    const requestIds = new Set<string>();
    const storedExecutions = terminalExecutions(options.database);
    const executionsByAttestationKey = new Map<string, StoredActionExecutionEvent[]>();
    for (const storedExecution of storedExecutions) {
      const key = executionAttestationMatchKey(storedExecution);
      if (key === null) continue;
      const matches = executionsByAttestationKey.get(key) ?? [];
      matches.push(storedExecution);
      executionsByAttestationKey.set(key, matches);
    }
    for (const storedExecution of storedExecutions) {
      const { execution } = storedExecution;
      const attestation = procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(
        options.database.getProcedureLeafReplayAttestation(execution.replayId),
      );
      const indexedMatches = attestation.success
        ? (executionsByAttestationKey.get(attestationMatchKey(attestation.data)) ?? [])
        : [];
      if (
        attestation.success &&
        indexedMatches.length === 1 &&
        executionMatchesAttestation(
          storedExecution.execution,
          storedExecution.sessionFingerprintSha256,
          attestation.data,
        ) &&
        resolveStoredExecution(storedExecution) !== null
      ) {
        requestIds.add(execution.requestId);
      }
    }
    return [...requestIds].sort();
  };

  return { resolve, findRequestIdForAttestation, listResolvableRequestIds };
}
