import { createHash } from 'node:crypto';

import type { PlannerProvider } from '@operatingline/planner-provider-sdk';

import type {
  PlannerProviderRegistry,
  RegisteredPlannerProvider,
} from './planner-provider-registry.js';
import {
  PlannerGenerationRuntimeError,
  safePlannerRuntimeError,
} from './planner-provider-errors.js';

const defaultProviderTimeoutMs = 60_000;
const maximumProviderTimeoutMs = 120_000;
const maximumProviderOutputBytes = 2 * 1024 * 1024;
const maximumGlobalConcurrency = 4;

export type PlannerProviderOperation = 'initial_plan' | 'local_replan' | 'semantic_dialogue';

interface InvocationIdentity {
  readonly operation: PlannerProviderOperation;
  readonly fingerprint: string;
}

export interface RestoredPlannerProviderInvocation extends InvocationIdentity {
  readonly requestId: string;
  readonly result?: unknown;
}

interface InFlightInvocation extends InvocationIdentity {
  readonly promise: Promise<unknown>;
}

interface CompletedInvocation extends InvocationIdentity {
  readonly result: unknown;
}

export interface PlannerProviderAttemptContext {
  readonly registered: RegisteredPlannerProvider;
  markAttempted(): void;
  invoke(
    call: (provider: PlannerProvider, signal: AbortSignal) => Promise<unknown>,
  ): Promise<unknown>;
}

export interface PlannerProviderInvocationRequest<TResult> extends InvocationIdentity {
  readonly requestId: string;
  readonly providerId: string;
  readonly planKey:
    | readonly [targetAdapterId: string, planId: string]
    | (() => readonly [targetAdapterId: string, planId: string]);
  readonly requiresReplan: boolean;
  readonly requiresDialogue?: boolean;
  readonly attempt: (context: PlannerProviderAttemptContext) => Promise<TResult>;
}

export interface PlannerProviderInvocationManager {
  execute<TResult>(request: PlannerProviderInvocationRequest<TResult>): Promise<TResult>;
  completedResult(
    requestId: string,
    operation: PlannerProviderOperation,
    expectedFingerprint?: string,
  ): unknown | null;
  close(): Promise<void>;
}

export interface PlannerProviderInvocationManagerOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly restoredInvocations?: readonly RestoredPlannerProviderInvocation[];
}

function assertMatchingIdentity(
  requestId: string,
  expected: InvocationIdentity,
  actual: InvocationIdentity,
): void {
  if (expected.operation !== actual.operation || expected.fingerprint !== actual.fingerprint) {
    throw new PlannerGenerationRuntimeError(
      'planner_generation_conflict',
      `Planner generation requestId ${requestId} was reused with different input or operation`,
      'new_request_id',
    );
  }
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

export function plannerProviderRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sanitizePlannerProviderOutput(output: unknown): unknown {
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

export function createPlannerProviderInvocationManager(
  options: PlannerProviderInvocationManagerOptions,
): PlannerProviderInvocationManager {
  const timeoutMs = options.timeoutMs ?? defaultProviderTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > maximumProviderTimeoutMs) {
    throw new Error(
      `Planner provider timeout must be an integer between 100 and ${maximumProviderTimeoutMs}ms`,
    );
  }

  const attempted = new Map<string, InvocationIdentity>();
  const completed = new Map<string, CompletedInvocation>();
  for (const restored of options.restoredInvocations ?? []) {
    const identity = { operation: restored.operation, fingerprint: restored.fingerprint };
    const existing = completed.get(restored.requestId) ?? attempted.get(restored.requestId);
    if (existing !== undefined) {
      assertMatchingIdentity(restored.requestId, existing, identity);
    }
    attempted.set(restored.requestId, identity);
    if (restored.result !== undefined) {
      completed.set(restored.requestId, {
        ...identity,
        result: structuredClone(restored.result),
      });
    }
  }

  const inFlight = new Map<string, InFlightInvocation>();
  const activePlanKeys = new Set<string>();
  const activeProviderCounts = new Map<string, number>();
  const controllers = new Set<AbortController>();
  let globalActiveCount = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const invokeWithTimeout = async (
    registered: RegisteredPlannerProvider,
    controller: AbortController,
    call: (provider: PlannerProvider, signal: AbortSignal) => Promise<unknown>,
  ): Promise<unknown> => {
    let timedOut = false;
    const abortError = (): PlannerGenerationRuntimeError =>
      new PlannerGenerationRuntimeError(
        timedOut ? 'planner_generation_timeout' : 'planner_runtime_stopping',
        timedOut
          ? `Planner provider timed out after ${timeoutMs}ms`
          : 'Planner runtime is stopping',
        'new_request_id',
      );
    if (controller.signal.aborted) {
      throw abortError();
    }
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await Promise.race([
        Promise.resolve().then(() => call(registered.provider, controller.signal)),
        abortPromise,
      ]);
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
  };

  return {
    execute: async <TResult>(request: PlannerProviderInvocationRequest<TResult>) => {
      const identity = { operation: request.operation, fingerprint: request.fingerprint };
      const running = inFlight.get(request.requestId);
      if (running !== undefined) {
        assertMatchingIdentity(request.requestId, running, identity);
        return structuredClone((await running.promise) as TResult);
      }
      const priorResult = completed.get(request.requestId);
      if (priorResult !== undefined) {
        assertMatchingIdentity(request.requestId, priorResult, identity);
        return structuredClone(priorResult.result as TResult);
      }
      const priorAttempt = attempted.get(request.requestId);
      if (priorAttempt !== undefined) {
        assertMatchingIdentity(request.requestId, priorAttempt, identity);
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
      if (request.requiresReplan && typeof registered.provider.replan !== 'function') {
        throw new PlannerGenerationRuntimeError(
          'planner_replan_not_supported',
          `Planner provider ${request.providerId} does not support local replanning`,
          'same_request_id',
        );
      }
      if (request.requiresDialogue && typeof registered.provider.dialogue !== 'function') {
        throw new PlannerGenerationRuntimeError(
          'planner_dialogue_not_supported',
          `Planner provider ${request.providerId} does not support streamed semantic dialogue`,
          'same_request_id',
        );
      }

      let resolvedPlanKey: readonly [targetAdapterId: string, planId: string];
      try {
        resolvedPlanKey =
          typeof request.planKey === 'function' ? request.planKey() : request.planKey;
      } catch (error) {
        throw safePlannerRuntimeError(error);
      }
      const planKey = JSON.stringify(resolvedPlanKey);
      const providerActiveCount = activeProviderCounts.get(request.providerId) ?? 0;
      if (
        globalActiveCount >= maximumGlobalConcurrency ||
        providerActiveCount >= registered.descriptor.limits.maxConcurrency ||
        activePlanKeys.has(planKey)
      ) {
        throw new PlannerGenerationRuntimeError(
          'planner_generation_busy',
          `Planner generation is already at capacity for provider ${request.providerId} or plan ${resolvedPlanKey[1]}`,
          'same_request_id',
        );
      }

      globalActiveCount += 1;
      activeProviderCounts.set(request.providerId, providerActiveCount + 1);
      activePlanKeys.add(planKey);
      const controller = new AbortController();
      controllers.add(controller);
      let markedAttempted = false;
      const promise = Promise.resolve()
        .then(() =>
          request.attempt({
            registered,
            markAttempted: () => {
              attempted.set(request.requestId, identity);
              markedAttempted = true;
            },
            invoke: (call) => invokeWithTimeout(registered, controller, call),
          }),
        )
        .then((result) => {
          if (!markedAttempted) {
            throw new PlannerGenerationRuntimeError(
              'planner_internal_failed',
              'Planner operation completed without durable requested evidence',
              'same_request_id',
            );
          }
          completed.set(request.requestId, {
            ...identity,
            result: structuredClone(result),
          });
          return result;
        })
        .catch((error: unknown) => {
          throw safePlannerRuntimeError(error);
        })
        .finally(() => {
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
        });
      inFlight.set(request.requestId, { ...identity, promise });
      return structuredClone(await promise);
    },
    completedResult: (requestId, operation, expectedFingerprint) => {
      const result = completed.get(requestId);
      if (result === undefined || result.operation !== operation) {
        return null;
      }
      if (expectedFingerprint !== undefined) {
        assertMatchingIdentity(requestId, result, {
          operation,
          fingerprint: expectedFingerprint,
        });
      }
      return structuredClone(result.result);
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
