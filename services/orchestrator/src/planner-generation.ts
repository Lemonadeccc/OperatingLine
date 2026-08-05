import { createHash, randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
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
  type PlannerGenerationError,
  type PlannerGenerationErrorCode,
  type PlannerGenerationRetryMode,
  type PlannerGenerationResult,
  type PlanningPromptPacket,
  type PlanningPromptRequest,
  type PlanningProposalDraft,
  type PlanningQualityReport,
} from '@operatingline/protocol';

import type { PlannerProviderRegistry } from './planner-provider-registry.js';

const defaultProviderTimeoutMs = 60_000;
const maximumProviderTimeoutMs = 120_000;
const maximumProviderOutputBytes = 2 * 1024 * 1024;
const maximumGlobalConcurrency = 4;

export const plannerGenerationEvidenceEventTypes = [
  'planning.provider.generation.requested',
  'planning.provider.generation.completed',
  'planning.provider.generation.failed',
] as const;

export interface PlannerGenerationCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (request: PlanningPromptRequest) => PlanningPromptPacket;
  readonly evaluateDraft: (
    packet: PlanningPromptPacket,
    draft: PlanningProposalDraft,
  ) => PlanningQualityReport;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface PlannerGenerationCoordinator {
  generate(request: PlannerGenerateRequest): Promise<PlannerGenerationResult>;
  close(): Promise<void>;
}

export class PlannerGenerationRuntimeError extends Error {
  readonly code: PlannerGenerationErrorCode;
  readonly retryMode: PlannerGenerationRetryMode;

  constructor(
    code: PlannerGenerationErrorCode,
    message: string,
    retryMode: PlannerGenerationRetryMode = 'never',
  ) {
    super(message);
    this.name = 'PlannerGenerationRuntimeError';
    this.code = code;
    this.retryMode = retryMode;
  }
}

interface InFlightGeneration {
  readonly fingerprint: string;
  readonly promise: Promise<PlannerGenerationResult>;
}

interface CompletedGeneration {
  readonly fingerprint: string;
  readonly result: PlannerGenerationResult;
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return candidate;
  };
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) {
    throw new Error('Planner generation request must be JSON serializable');
  }
  return serialized;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requestToPrompt(request: PlannerGenerateRequest): PlanningPromptRequest {
  return {
    targetAdapterId: request.targetAdapterId,
    ...(request.catalogVersion === undefined ? {} : { catalogVersion: request.catalogVersion }),
    goal: request.goal,
    planId: request.planId,
  };
}

function assertMatchingFingerprint(requestId: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new PlannerGenerationRuntimeError(
      'planner_generation_conflict',
      `Planner generation requestId ${requestId} was reused with different input`,
      'new_request_id',
    );
  }
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

function sanitizeProviderOutput(output: unknown): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output is not JSON serializable',
      'new_request_id',
    );
  }
  if (serialized === undefined) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output is not a JSON value',
      'new_request_id',
    );
  }
  if (Buffer.byteLength(serialized, 'utf8') > maximumProviderOutputBytes) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      `Planner provider output exceeds ${maximumProviderOutputBytes} bytes`,
      'new_request_id',
    );
  }
  return JSON.parse(serialized) as unknown;
}

function parseProviderOutput(output: unknown): PlanningProposalDraft {
  const parsed = planningProposalDraftSchema.safeParse(sanitizeProviderOutput(output));
  if (!parsed.success) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output violates the strict PlanningProposalDraft contract',
      'new_request_id',
    );
  }
  return parsed.data;
}

async function invokeProvider(
  provider: PlannerProvider,
  requestId: string,
  packet: PlanningPromptPacket,
  controller: AbortController,
  timeoutMs: number,
): Promise<unknown> {
  let timedOut = false;
  const abortError = (): PlannerGenerationRuntimeError =>
    new PlannerGenerationRuntimeError(
      timedOut ? 'planner_generation_timeout' : 'planner_runtime_stopping',
      timedOut ? `Planner provider timed out after ${timeoutMs}ms` : 'Planner runtime is stopping',
      'new_request_id',
    );
  if (controller.signal.aborted) {
    throw abortError();
  }
  const abortPromise = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        reject(abortError());
      },
      { once: true },
    );
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const providerPromise = Promise.resolve().then(() =>
    provider.generate({
      requestId,
      packet: structuredClone(packet),
      signal: controller.signal,
    }),
  );
  try {
    return await Promise.race([providerPromise, abortPromise]);
  } catch (error) {
    if (error instanceof PlannerGenerationRuntimeError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw abortError();
    }
    throw new PlannerGenerationRuntimeError(
      'planner_provider_failed',
      'Planner provider failed without a safe public error',
      'new_request_id',
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeRuntimeError(error: unknown): PlannerGenerationRuntimeError {
  return error instanceof PlannerGenerationRuntimeError
    ? error
    : new PlannerGenerationRuntimeError(
        'planner_internal_failed',
        'Planner generation failed inside the core runtime',
        'new_request_id',
      );
}

export function plannerGenerationErrorResponse(
  error: unknown,
  requestId: string | null,
): PlannerGenerationError {
  const safeError = safeRuntimeError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}

export function plannerGenerationHttpStatus(error: unknown): number {
  const code = safeRuntimeError(error).code;
  switch (code) {
    case 'planner_invalid_request':
      return 400;
    case 'planner_provider_not_found':
      return 404;
    case 'planner_generation_conflict':
    case 'planner_generation_already_attempted':
      return 409;
    case 'planner_generation_busy':
      return 429;
    case 'planner_provider_unavailable':
    case 'planner_runtime_stopping':
      return 503;
    case 'planner_generation_timeout':
      return 504;
    case 'planner_provider_failed':
      return 502;
    case 'planner_output_invalid':
    case 'planner_identity_mismatch':
    case 'planner_catalog_invalid':
      return 422;
    case 'planner_persistence_failed':
    case 'planner_internal_failed':
      return 500;
  }
}

export function createPlannerGenerationCoordinator(
  options: PlannerGenerationCoordinatorOptions,
): PlannerGenerationCoordinator {
  const timeoutMs = options.timeoutMs ?? defaultProviderTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > maximumProviderTimeoutMs) {
    throw new Error(
      `Planner provider timeout must be an integer between 100 and ${maximumProviderTimeoutMs}ms`,
    );
  }

  const completed = new Map<string, CompletedGeneration>();
  const attempted = new Map<string, string>();
  for (const event of options.existingEvents) {
    if (event.eventType === 'planning.provider.generation.requested') {
      const payload = plannerGenerationRequestedEventSchema.parse(event.payload);
      attempted.set(payload.requestId, payload.requestFingerprint);
    } else if (event.eventType === 'planning.provider.generation.failed') {
      const payload = plannerGenerationFailedEventSchema.parse(event.payload);
      attempted.set(payload.requestId, payload.requestFingerprint);
    } else if (event.eventType === 'planning.provider.generation.completed') {
      const payload = plannerGenerationCompletedEventSchema.parse(event.payload);
      attempted.set(payload.request.requestId, payload.requestFingerprint);
      completed.set(payload.request.requestId, {
        fingerprint: payload.requestFingerprint,
        result: payload.result,
      });
    }
  }

  const inFlight = new Map<string, InFlightGeneration>();
  const activePlanKeys = new Set<string>();
  const activeProviderCounts = new Map<string, number>();
  const controllers = new Set<AbortController>();
  let globalActiveCount = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;

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
    registered: NonNullable<ReturnType<PlannerProviderRegistry['find']>>,
    controller: AbortController,
  ): Promise<PlannerGenerationResult> => {
    let packet: PlanningPromptPacket | null = null;
    const startedAt = Date.now();
    let requestRecorded = false;
    try {
      const promptRequest = requestToPrompt(request);
      try {
        packet = planningPromptPacketSchema.parse(options.buildPacket(promptRequest));
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
          payload: { request: promptRequest, context: packet.context },
        },
        'same_request_id',
      );
      appendEvidence(
        {
          id: randomUUID(),
          eventType: 'planning.prompt.generated',
          payload: { request: promptRequest, packet },
        },
        'same_request_id',
      );
      const requestedPayload = plannerGenerationRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint,
        providerId: registered.descriptor.id,
        providerVersion: registered.descriptor.version,
        targetAdapterId: packet.context.targetAdapterId,
        catalogVersion: packet.context.catalog.catalogVersion,
        planId: packet.context.requestedPlanId,
        packetFormatVersion: packet.formatVersion,
        occurredAt: new Date().toISOString(),
      });
      appendEvidence(
        {
          id: `planning-generation-requested:${request.requestId}`,
          eventType: 'planning.provider.generation.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      attempted.set(request.requestId, requestFingerprint);
      requestRecorded = true;

      const rawOutput = await invokeProvider(
        registered.provider,
        request.requestId,
        packet,
        controller,
        timeoutMs,
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
            plan: draft.plan,
            report: planningQuality,
          },
        },
        'new_request_id',
      );
      const result = plannerGenerationResultSchema.parse({
        formatVersion: plannerGenerationFormatVersion,
        generationId: randomUUID(),
        requestId: request.requestId,
        provider: {
          id: registered.descriptor.id,
          version: registered.descriptor.version,
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
      });
      appendEvidence(
        {
          id: `planning-generation-completed:${request.requestId}`,
          eventType: 'planning.provider.generation.completed',
          payload: completedPayload,
        },
        'new_request_id',
      );
      completed.set(request.requestId, {
        fingerprint: requestFingerprint,
        result: structuredClone(result),
      });
      return result;
    } catch (error) {
      const safeError = safeRuntimeError(error);
      if (requestRecorded && packet !== null) {
        const failedPayload = plannerGenerationFailedEventSchema.parse({
          requestId: request.requestId,
          requestFingerprint,
          providerId: registered.descriptor.id,
          providerVersion: registered.descriptor.version,
          targetAdapterId: packet.context.targetAdapterId,
          catalogVersion: packet.context.catalog.catalogVersion,
          planId: packet.context.requestedPlanId,
          error: safeError.code,
          durationMs: Math.max(0, Date.now() - startedAt),
          occurredAt: new Date().toISOString(),
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

  return {
    generate: async (requestInput) => {
      const request = plannerGenerateRequestSchema.parse(requestInput);
      const requestFingerprint = fingerprint(request);
      const running = inFlight.get(request.requestId);
      if (running !== undefined) {
        assertMatchingFingerprint(request.requestId, running.fingerprint, requestFingerprint);
        return structuredClone(await running.promise);
      }
      const priorResult = completed.get(request.requestId);
      if (priorResult !== undefined) {
        assertMatchingFingerprint(request.requestId, priorResult.fingerprint, requestFingerprint);
        return structuredClone(priorResult.result);
      }
      const priorAttempt = attempted.get(request.requestId);
      if (priorAttempt !== undefined) {
        assertMatchingFingerprint(request.requestId, priorAttempt, requestFingerprint);
        throw new PlannerGenerationRuntimeError(
          'planner_generation_already_attempted',
          `Planner generation request ${request.requestId} already reached a terminal or uncertain state; use a new requestId for an explicit retry`,
          'new_request_id',
        );
      }
      if (closing) {
        throw new PlannerGenerationRuntimeError(
          'planner_runtime_stopping',
          'Planner runtime is stopping',
          'same_request_id',
        );
      }

      const registered = options.registry.find(request.providerId);
      if (registered === null) {
        throw new PlannerGenerationRuntimeError(
          'planner_provider_not_found',
          `Planner provider ${request.providerId} is not registered`,
          'same_request_id',
        );
      }
      if (!registered.descriptor.availability.available) {
        throw new PlannerGenerationRuntimeError(
          'planner_provider_unavailable',
          `Planner provider ${request.providerId} is unavailable: ${registered.descriptor.availability.reason}`,
          'same_request_id',
        );
      }

      const planKey = JSON.stringify([request.targetAdapterId, request.planId]);
      const providerActiveCount = activeProviderCounts.get(request.providerId) ?? 0;
      if (
        globalActiveCount >= maximumGlobalConcurrency ||
        providerActiveCount >= registered.descriptor.limits.maxConcurrency ||
        activePlanKeys.has(planKey)
      ) {
        throw new PlannerGenerationRuntimeError(
          'planner_generation_busy',
          `Planner generation is already at capacity for provider ${request.providerId} or plan ${request.planId}`,
          'same_request_id',
        );
      }

      globalActiveCount += 1;
      activeProviderCounts.set(request.providerId, providerActiveCount + 1);
      activePlanKeys.add(planKey);
      const controller = new AbortController();
      controllers.add(controller);
      const promise = generateAttempt(request, requestFingerprint, registered, controller).finally(
        () => {
          controllers.delete(controller);
          inFlight.delete(request.requestId);
          activePlanKeys.delete(planKey);
          globalActiveCount -= 1;
          const remaining = (activeProviderCounts.get(request.providerId) ?? 1) - 1;
          if (remaining === 0) {
            activeProviderCounts.delete(request.providerId);
          } else {
            activeProviderCounts.set(request.providerId, remaining);
          }
        },
      );
      inFlight.set(request.requestId, { fingerprint: requestFingerprint, promise });
      return structuredClone(await promise);
    },
    close: () => {
      closePromise ??= (async () => {
        closing = true;
        const pending = [...inFlight.values()].map(({ promise }) => promise);
        for (const controller of controllers) {
          controller.abort();
        }
        await Promise.allSettled(pending);
        await options.registry.close();
      })();
      return closePromise;
    },
  };
}
