import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  plannerGenerationFormatVersion,
  plannerReplanCompletedEventSchema,
  plannerReplanDraftSchema,
  plannerReplanFailedEventSchema,
  plannerReplanGenerateRequestSchema,
  plannerReplanGenerationResultSchema,
  plannerReplanRequestedEventSchema,
  replanningPromptPacketSchema,
  type PlannerGenerationRetryMode,
  type PlannerReplanDraft,
  type PlannerReplanGenerateRequest,
  type PlannerReplanGenerationResult,
  type PlanningQualityReport,
  type ReplanningPromptPacket,
  type ReplanningPromptRequest,
} from '@operatingline/protocol';

import { evaluateLocalReplanScope } from './local-replan-scope.js';
import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import {
  createPlannerProviderInvocationManager,
  plannerProviderRequestFingerprint,
  sanitizePlannerProviderOutput,
  type PlannerProviderAttemptContext,
  type PlannerProviderInvocationManager,
  type RestoredPlannerProviderInvocation,
} from './planner-provider-invocation.js';
import {
  PlannerGenerationRuntimeError,
  safePlannerRuntimeError,
} from './planner-provider-errors.js';

export const plannerReplanGenerationEvidenceEventTypes = [
  'planning.provider.replan.requested',
  'planning.provider.replan.completed',
  'planning.provider.replan.failed',
] as const;

export interface PlannerReplanGenerationCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly invocationManager?: PlannerProviderInvocationManager;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (request: ReplanningPromptRequest) => ReplanningPromptPacket;
  readonly evaluateDraft: (
    packet: ReplanningPromptPacket,
    draft: PlannerReplanDraft,
  ) => PlanningQualityReport;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface PlannerReplanGenerationCoordinator {
  generate(request: PlannerReplanGenerateRequest): Promise<PlannerReplanGenerationResult>;
  completedResult(requestId: string): PlannerReplanGenerationResult | null;
  close(): Promise<void>;
}

export function restoreReplanPlannerProviderInvocations(
  events: readonly StoredExecutionEvent[],
): RestoredPlannerProviderInvocation[] {
  const restored: RestoredPlannerProviderInvocation[] = [];
  for (const event of events) {
    if (event.eventType === 'planning.provider.replan.requested') {
      const payload = plannerReplanRequestedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'local_replan',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'planning.provider.replan.failed') {
      const payload = plannerReplanFailedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'local_replan',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'planning.provider.replan.completed') {
      const payload = plannerReplanCompletedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.request.requestId,
        operation: 'local_replan',
        fingerprint: payload.requestFingerprint,
        result: payload.result,
      });
    }
  }
  return restored;
}

function requestToPrompt(request: PlannerReplanGenerateRequest): ReplanningPromptRequest {
  return { revisionRequestId: request.revisionRequestId };
}

function parseProviderOutput(output: unknown): PlannerReplanDraft {
  const parsed = plannerReplanDraftSchema.safeParse(sanitizePlannerProviderOutput(output));
  if (!parsed.success) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output violates the strict PlannerReplanDraft contract',
      'new_request_id',
    );
  }
  return parsed.data;
}

function validateDraftIdentity(packet: ReplanningPromptPacket, draft: PlannerReplanDraft): void {
  const immutableRequest = packet.context.revisionRequest;
  const mismatches: string[] = [];
  if (draft.requestId !== immutableRequest.requestId) {
    mismatches.push('requestId');
  }
  if (draft.catalogVersion !== immutableRequest.catalogVersion) {
    mismatches.push('catalogVersion');
  }
  if (draft.planning.goal !== immutableRequest.message) {
    mismatches.push('planning.goal');
  }
  if (draft.plan.protocolVersion !== immutableRequest.basePlan.protocolVersion) {
    mismatches.push('plan.protocolVersion');
  }
  if (draft.plan.id !== immutableRequest.basePlan.id) {
    mismatches.push('plan.id');
  }
  if (draft.plan.revision !== packet.context.targetRevision) {
    mismatches.push('plan.revision');
  }
  if (mismatches.length > 0) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      `Planner replan output changed immutable packet identity fields: ${mismatches.join(', ')}`,
      'new_request_id',
    );
  }
}

export function createPlannerReplanGenerationCoordinator(
  options: PlannerReplanGenerationCoordinatorOptions,
): PlannerReplanGenerationCoordinator {
  const invocationManager =
    options.invocationManager ??
    createPlannerProviderInvocationManager({
      registry: options.registry,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      restoredInvocations: restoreReplanPlannerProviderInvocations(options.existingEvents),
    });

  const appendEvidence = (
    event: ExecutionEventInput,
    retryMode: PlannerGenerationRetryMode,
  ): void => {
    try {
      options.appendEvent(event);
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_persistence_failed',
        'Planner replan generation evidence could not be persisted',
        retryMode,
      );
    }
  };

  const generateAttempt = async (
    request: PlannerReplanGenerateRequest,
    requestFingerprint: string,
    packet: ReplanningPromptPacket,
    attemptContext: PlannerProviderAttemptContext,
  ): Promise<PlannerReplanGenerationResult> => {
    const startedAt = Date.now();
    let requestRecorded = false;
    const immutableRequest = packet.context.revisionRequest;
    try {
      const promptRequest = requestToPrompt(request);
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.replan.context.generated',
          payload: { request: promptRequest, context: packet.context },
        },
        'same_request_id',
      );
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.replan.prompt.generated',
          payload: { request: promptRequest, packet },
        },
        'same_request_id',
      );
      const requestedPayload = plannerReplanRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint,
        revisionRequestId: request.revisionRequestId,
        providerId: attemptContext.registered.descriptor.id,
        providerVersion: attemptContext.registered.descriptor.version,
        targetAdapterId: immutableRequest.adapterId,
        targetInstanceId: immutableRequest.instanceId,
        catalogVersion: immutableRequest.catalogVersion,
        planId: immutableRequest.basePlan.id,
        baseRevision: immutableRequest.basePlan.revision,
        packetFormatVersion: packet.formatVersion,
        occurredAt: new Date().toISOString(),
      });
      appendEvidence(
        {
          id: `planning-replan-requested:${request.requestId}`,
          eventType: 'planning.provider.replan.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      attemptContext.markAttempted();
      requestRecorded = true;

      const rawOutput = await attemptContext.invoke((provider, signal) => {
        if (provider.replan === undefined) {
          throw new PlannerGenerationRuntimeError(
            'planner_replan_not_supported',
            `Planner provider ${attemptContext.registered.descriptor.id} does not support local replanning`,
            'same_request_id',
          );
        }
        return provider.replan({
          requestId: request.requestId,
          packet: structuredClone(packet),
          signal,
        });
      });
      const draft = parseProviderOutput(rawOutput);
      validateDraftIdentity(packet, draft);
      const scopeEvaluation = evaluateLocalReplanScope(immutableRequest, draft.plan);
      let planningQuality: PlanningQualityReport;
      try {
        planningQuality = options.evaluateDraft(packet, draft);
      } catch (error) {
        if (error instanceof PlannerGenerationRuntimeError) {
          throw error;
        }
        throw new PlannerGenerationRuntimeError(
          'planner_catalog_invalid',
          'Generated replan draft failed deterministic catalog or planning validation',
          'new_request_id',
        );
      }
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.quality.evaluated',
          payload: {
            targetAdapterId: immutableRequest.adapterId,
            targetInstanceId: immutableRequest.instanceId,
            revisionRequestId: immutableRequest.requestId,
            generationRequestId: request.requestId,
            catalogVersion: draft.catalogVersion,
            goal: draft.planning.goal,
            requiredPhaseIds: draft.planning.requiredPhaseIds,
            ...(draft.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: draft.planning.capabilityCoverage }),
            plan: draft.plan,
            report: planningQuality,
          },
        },
        'new_request_id',
      );
      const ready =
        planningQuality.valid &&
        scopeEvaluation.locality.valid &&
        scopeEvaluation.planDiff !== null;
      const result = plannerReplanGenerationResultSchema.parse({
        formatVersion: plannerGenerationFormatVersion,
        generationId: randomUUID(),
        requestId: request.requestId,
        revisionRequestId: request.revisionRequestId,
        targetAdapterId: immutableRequest.adapterId,
        targetInstanceId: immutableRequest.instanceId,
        provider: {
          id: attemptContext.registered.descriptor.id,
          version: attemptContext.registered.descriptor.version,
        },
        packetFormatVersion: packet.formatVersion,
        status: ready ? 'ready' : 'needs_revision',
        draft,
        planDiff: scopeEvaluation.planDiff,
        planningQuality,
        locality: scopeEvaluation.locality,
        proposalCreated: false,
        generatedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      const completedPayload = plannerReplanCompletedEventSchema.parse({
        request,
        requestFingerprint,
        result,
      });
      appendEvidence(
        {
          id: `planning-replan-completed:${request.requestId}`,
          eventType: 'planning.provider.replan.completed',
          payload: completedPayload,
        },
        'new_request_id',
      );
      return result;
    } catch (error) {
      const safeError = safePlannerRuntimeError(error);
      if (requestRecorded) {
        const failedPayload = plannerReplanFailedEventSchema.parse({
          requestId: request.requestId,
          requestFingerprint,
          revisionRequestId: request.revisionRequestId,
          providerId: attemptContext.registered.descriptor.id,
          providerVersion: attemptContext.registered.descriptor.version,
          targetAdapterId: immutableRequest.adapterId,
          targetInstanceId: immutableRequest.instanceId,
          catalogVersion: immutableRequest.catalogVersion,
          planId: immutableRequest.basePlan.id,
          baseRevision: immutableRequest.basePlan.revision,
          error: safeError.code,
          durationMs: Math.max(0, Date.now() - startedAt),
          occurredAt: new Date().toISOString(),
        });
        appendEvidence(
          {
            id: `planning-replan-failed:${request.requestId}`,
            eventType: 'planning.provider.replan.failed',
            payload: failedPayload,
          },
          'new_request_id',
        );
      }
      throw safeError;
    }
  };

  return {
    generate: async (requestInput) => {
      const request = plannerReplanGenerateRequestSchema.parse(requestInput);
      const requestFingerprint = plannerProviderRequestFingerprint(request);
      let packet: ReplanningPromptPacket | null = null;
      const result = await invocationManager.execute({
        requestId: request.requestId,
        operation: 'local_replan',
        fingerprint: requestFingerprint,
        providerId: request.providerId,
        planKey: () => {
          try {
            packet = replanningPromptPacketSchema.parse(
              options.buildPacket(requestToPrompt(request)),
            );
          } catch (error) {
            if (error instanceof PlannerGenerationRuntimeError) {
              throw error;
            }
            throw new PlannerGenerationRuntimeError(
              'planner_catalog_invalid',
              'Replanning Packet could not be built from the immutable host request and catalog',
              'same_request_id',
            );
          }
          return [
            packet.context.revisionRequest.adapterId,
            packet.context.revisionRequest.basePlan.id,
          ];
        },
        requiresReplan: true,
        attempt: (attemptContext) => {
          if (packet === null) {
            throw new PlannerGenerationRuntimeError(
              'planner_internal_failed',
              'Planner replan invocation began without a prepared prompt packet',
              'same_request_id',
            );
          }
          return generateAttempt(request, requestFingerprint, packet, attemptContext);
        },
      });
      return plannerReplanGenerationResultSchema.parse(result);
    },
    completedResult: (requestId) => {
      const result = invocationManager.completedResult(requestId, 'local_replan');
      return result === null ? null : plannerReplanGenerationResultSchema.parse(result);
    },
    close: () => invocationManager.close(),
  };
}
