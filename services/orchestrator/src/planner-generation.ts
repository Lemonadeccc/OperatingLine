import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  plannerGenerateRequestSchema,
  plannerGenerationCompletedEventSchema,
  plannerGenerationFailedEventSchema,
  plannerGenerationFormatVersion,
  plannerGenerationRequestedEventSchema,
  plannerGenerationResultSchema,
  planningPromptPacketSchema,
  planningProposalDraftSchema,
  type PlannerGenerateRequest,
  type PlannerGenerationResult,
  type PlannerGenerationRetryMode,
  type PlanningPromptPacket,
  type PlanningPromptRequest,
  type PlanningProposalDraft,
  type PlanningQualityReport,
} from '@operatingline/protocol';

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

export {
  PlannerGenerationRuntimeError,
  plannerGenerationErrorResponse,
  plannerGenerationHttpStatus,
} from './planner-provider-errors.js';

export const plannerGenerationEvidenceEventTypes = [
  'planning.provider.generation.requested',
  'planning.provider.generation.completed',
  'planning.provider.generation.failed',
] as const;

export interface PlannerGenerationCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly invocationManager?: PlannerProviderInvocationManager;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (
    request: PlanningPromptRequest,
    provenance?: PlannerGenerationGoalProvenance,
  ) => PlanningPromptPacket;
  readonly evaluateDraft: (
    packet: PlanningPromptPacket,
    draft: PlanningProposalDraft,
  ) => PlanningQualityReport;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface PlannerGenerationGoalProvenance {
  readonly goalRequestId: string;
  readonly targetInstanceId: string;
}

export interface PlannerGenerationCoordinator {
  generate(request: PlannerGenerateRequest): Promise<PlannerGenerationResult>;
  generateForGoal(
    request: PlannerGenerateRequest,
    provenance: PlannerGenerationGoalProvenance,
  ): Promise<PlannerGenerationResult>;
  completedResult(requestId: string): PlannerGenerationResult | null;
  completedGoalResult(
    request: PlannerGenerateRequest,
    provenance: PlannerGenerationGoalProvenance,
  ): PlannerGenerationResult | null;
  close(): Promise<void>;
}

export function restoreInitialPlannerProviderInvocations(
  events: readonly StoredExecutionEvent[],
): RestoredPlannerProviderInvocation[] {
  const restored: RestoredPlannerProviderInvocation[] = [];
  for (const event of events) {
    if (event.eventType === 'planning.provider.generation.requested') {
      const payload = plannerGenerationRequestedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'initial_plan',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'planning.provider.generation.failed') {
      const payload = plannerGenerationFailedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'initial_plan',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'planning.provider.generation.completed') {
      const payload = plannerGenerationCompletedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.request.requestId,
        operation: 'initial_plan',
        fingerprint: payload.requestFingerprint,
        result: payload.result,
      });
    }
  }
  return restored;
}

function requestToPrompt(request: PlannerGenerateRequest): PlanningPromptRequest {
  return {
    targetAdapterId: request.targetAdapterId,
    ...(request.catalogVersion === undefined ? {} : { catalogVersion: request.catalogVersion }),
    goal: request.goal,
    planId: request.planId,
  };
}

function validateDraftIdentity(packet: PlanningPromptPacket, draft: PlanningProposalDraft): void {
  const mismatches: string[] = [];
  if (draft.targetAdapterId !== packet.context.targetAdapterId) {
    mismatches.push('targetAdapterId');
  }
  if (draft.catalogVersion !== packet.context.catalog.catalogVersion) {
    mismatches.push('catalogVersion');
  }
  if (draft.planning.goal !== packet.context.goal) {
    mismatches.push('planning.goal');
  }
  if (draft.plan.protocolVersion !== packet.context.protocolVersion) {
    mismatches.push('plan.protocolVersion');
  }
  if (draft.plan.id !== packet.context.requestedPlanId) {
    mismatches.push('plan.id');
  }
  if (draft.plan.revision !== packet.context.recommendedRevision) {
    mismatches.push('plan.revision');
  }
  if (mismatches.length > 0) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      `Planner provider output changed immutable packet identity fields: ${mismatches.join(', ')}`,
      'new_request_id',
    );
  }
}

function parseProviderOutput(output: unknown): PlanningProposalDraft {
  const parsed = planningProposalDraftSchema.safeParse(sanitizePlannerProviderOutput(output));
  if (!parsed.success) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output violates the strict PlanningProposalDraft contract',
      'new_request_id',
    );
  }
  return parsed.data;
}

export function createPlannerGenerationCoordinator(
  options: PlannerGenerationCoordinatorOptions,
): PlannerGenerationCoordinator {
  const invocationManager =
    options.invocationManager ??
    createPlannerProviderInvocationManager({
      registry: options.registry,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      restoredInvocations: restoreInitialPlannerProviderInvocations(options.existingEvents),
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
        'Planner generation evidence could not be persisted',
        retryMode,
      );
    }
  };

  const generateAttempt = async (
    request: PlannerGenerateRequest,
    requestFingerprint: string,
    attemptContext: PlannerProviderAttemptContext,
    provenance?: PlannerGenerationGoalProvenance,
  ): Promise<PlannerGenerationResult> => {
    let packet: PlanningPromptPacket | null = null;
    const startedAt = Date.now();
    let requestRecorded = false;
    try {
      const promptRequest = requestToPrompt(request);
      try {
        packet = planningPromptPacketSchema.parse(options.buildPacket(promptRequest, provenance));
      } catch (error) {
        if (error instanceof PlannerGenerationRuntimeError) {
          throw error;
        }
        throw new PlannerGenerationRuntimeError(
          'planner_catalog_invalid',
          'Planner Packet could not be built from the requested host catalog',
          'same_request_id',
        );
      }
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.context.generated',
          payload: { request: promptRequest, context: packet.context, ...provenance },
        },
        'same_request_id',
      );
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.prompt.generated',
          payload: { request: promptRequest, packet, ...provenance },
        },
        'same_request_id',
      );
      const requestedPayload = plannerGenerationRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint,
        providerId: attemptContext.registered.descriptor.id,
        providerVersion: attemptContext.registered.descriptor.version,
        targetAdapterId: packet.context.targetAdapterId,
        catalogVersion: packet.context.catalog.catalogVersion,
        planId: packet.context.requestedPlanId,
        packetFormatVersion: packet.formatVersion,
        occurredAt: new Date().toISOString(),
        ...provenance,
      });
      appendEvidence(
        {
          id: `planning-generation-requested:${request.requestId}`,
          eventType: 'planning.provider.generation.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      attemptContext.markAttempted();
      requestRecorded = true;

      const rawOutput = await attemptContext.invoke((provider, signal) =>
        provider.generate({
          requestId: request.requestId,
          packet: structuredClone(packet!),
          signal,
        }),
      );
      const draft = parseProviderOutput(rawOutput);
      validateDraftIdentity(packet, draft);
      let planningQuality: PlanningQualityReport;
      try {
        planningQuality = options.evaluateDraft(packet, draft);
      } catch (error) {
        if (error instanceof PlannerGenerationRuntimeError) {
          throw error;
        }
        throw new PlannerGenerationRuntimeError(
          'planner_catalog_invalid',
          'Generated draft failed deterministic catalog or planning validation',
          'new_request_id',
        );
      }
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.quality.evaluated',
          payload: {
            targetAdapterId: draft.targetAdapterId,
            catalogVersion: draft.catalogVersion,
            goal: draft.planning.goal,
            requiredPhaseIds: draft.planning.requiredPhaseIds,
            ...(draft.planning.capabilityCoverage === undefined
              ? {}
              : { capabilityCoverage: draft.planning.capabilityCoverage }),
            plan: draft.plan,
            report: planningQuality,
            ...provenance,
          },
        },
        'new_request_id',
      );
      const result = plannerGenerationResultSchema.parse({
        formatVersion: plannerGenerationFormatVersion,
        generationId: randomUUID(),
        requestId: request.requestId,
        provider: {
          id: attemptContext.registered.descriptor.id,
          version: attemptContext.registered.descriptor.version,
        },
        packetFormatVersion: packet.formatVersion,
        status: planningQuality.valid ? 'ready' : 'needs_revision',
        draft,
        planningQuality,
        proposalCreated: false,
        generatedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      const completedPayload = plannerGenerationCompletedEventSchema.parse({
        request,
        requestFingerprint,
        targetAdapterId: result.draft.targetAdapterId,
        catalogVersion: result.draft.catalogVersion,
        planId: result.draft.plan.id,
        result,
        ...provenance,
      });
      appendEvidence(
        {
          id: `planning-generation-completed:${request.requestId}`,
          eventType: 'planning.provider.generation.completed',
          payload: completedPayload,
        },
        'new_request_id',
      );
      return result;
    } catch (error) {
      const safeError = safePlannerRuntimeError(error);
      if (requestRecorded && packet !== null) {
        const failedPayload = plannerGenerationFailedEventSchema.parse({
          requestId: request.requestId,
          requestFingerprint,
          providerId: attemptContext.registered.descriptor.id,
          providerVersion: attemptContext.registered.descriptor.version,
          targetAdapterId: packet.context.targetAdapterId,
          catalogVersion: packet.context.catalog.catalogVersion,
          planId: packet.context.requestedPlanId,
          error: safeError.code,
          durationMs: Math.max(0, Date.now() - startedAt),
          occurredAt: new Date().toISOString(),
          ...provenance,
        });
        appendEvidence(
          {
            id: `planning-generation-failed:${request.requestId}`,
            eventType: 'planning.provider.generation.failed',
            payload: failedPayload,
          },
          'new_request_id',
        );
      }
      throw safeError;
    }
  };

  const generate = async (
    requestInput: PlannerGenerateRequest,
    provenance?: PlannerGenerationGoalProvenance,
  ): Promise<PlannerGenerationResult> => {
    const request = plannerGenerateRequestSchema.parse(requestInput);
    const requestFingerprint = plannerProviderRequestFingerprint(
      provenance === undefined ? request : { request, ...provenance },
    );
    const result = await invocationManager.execute({
      requestId: request.requestId,
      operation: 'initial_plan',
      fingerprint: requestFingerprint,
      providerId: request.providerId,
      planKey: [request.targetAdapterId, request.planId],
      requiresReplan: false,
      attempt: (attemptContext) =>
        generateAttempt(request, requestFingerprint, attemptContext, provenance),
    });
    return plannerGenerationResultSchema.parse(result);
  };

  return {
    generate: (requestInput) => generate(requestInput),
    generateForGoal: (requestInput, provenance) => generate(requestInput, provenance),
    completedResult: (requestId) => {
      const result = invocationManager.completedResult(requestId, 'initial_plan');
      return result === null ? null : plannerGenerationResultSchema.parse(result);
    },
    completedGoalResult: (requestInput, provenance) => {
      const request = plannerGenerateRequestSchema.parse(requestInput);
      const requestFingerprint = plannerProviderRequestFingerprint({ request, ...provenance });
      const result = invocationManager.completedResult(
        request.requestId,
        'initial_plan',
        requestFingerprint,
      );
      return result === null ? null : plannerGenerationResultSchema.parse(result);
    },
    close: () => invocationManager.close(),
  };
}
