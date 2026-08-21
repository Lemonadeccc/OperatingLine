import { createHash } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  plannerProviderDescriptorSchema,
  procedureAuthoringGenerationResultSchema,
  procedureZeroBaselineCompletedEventSchema,
  procedureZeroBaselineFormatVersion,
  procedureZeroBaselineGenerateRequestSchema,
  procedureZeroBaselineRequestedEventSchema,
  procedureZeroBaselineResultSchema,
  type PlannerProviderDescriptor,
  type ProcedureAuthoringGenerateRequest,
  type ProcedureAuthoringGenerationResult,
  type ProcedureZeroBaselineGenerateRequest,
  type ProcedureZeroBaselineResult,
} from '@operatingline/protocol';
import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import { PlannerGenerationRuntimeError } from './planner-provider-errors.js';

export const procedureZeroBaselineEvidenceEventTypes = [
  'procedure.zero-baseline.generation.requested',
  'procedure.zero-baseline.generation.completed',
] as const;

export interface ProcedureZeroBaselineAuthoringGeneration {
  generate(request: ProcedureAuthoringGenerateRequest): Promise<ProcedureAuthoringGenerationResult>;
  completedResult(requestId: string): ProcedureAuthoringGenerationResult | null;
}

export interface ProcedureZeroBaselineGenerationCoordinatorOptions {
  readonly generation: ProcedureZeroBaselineAuthoringGeneration;
  readonly findProviderDescriptor: (providerId: string) => PlannerProviderDescriptor | null;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface ProcedureZeroBaselineGenerationCoordinator {
  generate(request: ProcedureZeroBaselineGenerateRequest): Promise<ProcedureZeroBaselineResult>;
  completedResult(requestId: string): ProcedureZeroBaselineResult | null;
}

interface RequestIdentity {
  readonly fingerprint: string;
  readonly treeId: string;
}

function deterministicTreeId(requestFingerprint: string): string {
  const bytes = Buffer.from(
    createHash('sha256')
      .update('operatingline.procedure.zero-baseline.tree-id.v1\0')
      .update(requestFingerprint)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertIdentity(
  requestId: string,
  expected: RequestIdentity,
  actual: RequestIdentity,
): void {
  if (expected.fingerprint !== actual.fingerprint || expected.treeId !== actual.treeId) {
    throw new PlannerGenerationRuntimeError(
      'planner_generation_conflict',
      `Zero-baseline requestId ${requestId} was reused with different authorized input`,
      'new_request_id',
    );
  }
}

function requestIdentity(request: ProcedureZeroBaselineGenerateRequest): RequestIdentity {
  const fingerprint = plannerProviderRequestFingerprint(request);
  return { fingerprint, treeId: deterministicTreeId(fingerprint) };
}

function sameProtocolValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}

function validateProviderAuthorization(
  request: ProcedureZeroBaselineGenerateRequest,
  findProviderDescriptor: (providerId: string) => PlannerProviderDescriptor | null,
): void {
  const providerId = request.authorization.providerDescriptor.id;
  const descriptorInput = findProviderDescriptor(providerId);
  if (descriptorInput === null) {
    throw new PlannerGenerationRuntimeError(
      'planner_provider_not_found',
      `Planner provider ${providerId} is not registered`,
      'same_request_id',
    );
  }
  const descriptor = plannerProviderDescriptorSchema.parse(descriptorInput);
  if (!descriptor.availability.available) {
    throw new PlannerGenerationRuntimeError(
      'planner_provider_unavailable',
      `Planner provider ${providerId} is unavailable: ${descriptor.availability.reason}`,
      'same_request_id',
    );
  }
  if (!sameProtocolValue(descriptor, request.authorization.providerDescriptor)) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      'The authorized Provider disclosure does not match the current runtime descriptor',
      'new_request_id',
    );
  }
}

function generationRequest(
  request: ProcedureZeroBaselineGenerateRequest,
  treeId: string,
): ProcedureAuthoringGenerateRequest {
  return {
    requestId: request.requestId,
    providerId: request.authorization.providerDescriptor.id,
    targetAdapterId: request.targetAdapterId,
    actionCatalogVersion: request.actionCatalogVersion,
    interactionCatalogVersion: request.interactionCatalogVersion,
    goal: request.goal,
    treeId,
    revision: 1,
    locale: request.locale,
  };
}

function validateGenerationBinding(
  request: ProcedureZeroBaselineGenerateRequest,
  treeId: string,
  generationInput: ProcedureAuthoringGenerationResult,
): ProcedureAuthoringGenerationResult {
  const generation = procedureAuthoringGenerationResultSchema.parse(generationInput);
  const context = generation.packet.context;
  if (
    generation.requestId !== request.requestId ||
    generation.provider.id !== request.authorization.providerDescriptor.id ||
    generation.provider.version !== request.authorization.providerDescriptor.version ||
    context.catalogBinding.adapterId !== request.targetAdapterId ||
    context.catalogBinding.actionCatalog.catalogVersion !== request.actionCatalogVersion ||
    context.catalogBinding.interactionCatalog.catalogVersion !==
      request.interactionCatalogVersion ||
    context.goalProvenance.source.text !== request.goal ||
    context.goalProvenance.source.locale !== request.locale ||
    context.requestedTreeId !== treeId ||
    context.recommendedRevision !== 1
  ) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      'Procedure authoring generation changed zero-baseline request identity',
      'new_request_id',
    );
  }
  return generation;
}

export function createProcedureZeroBaselineGenerationCoordinator(
  options: ProcedureZeroBaselineGenerationCoordinatorOptions,
): ProcedureZeroBaselineGenerationCoordinator {
  const identities = new Map<string, RequestIdentity>();
  const requests = new Map<string, ProcedureZeroBaselineGenerateRequest>();
  const completed = new Map<string, ProcedureZeroBaselineResult>();
  for (const storedEvent of options.existingEvents) {
    if (storedEvent.eventType === 'procedure.zero-baseline.generation.requested') {
      const event = procedureZeroBaselineRequestedEventSchema.parse(storedEvent.payload);
      if (storedEvent.id !== `procedure-zero-baseline-requested:${event.request.requestId}`) {
        throw new Error('Zero-baseline requested evidence identity is invalid');
      }
      const identity = { fingerprint: event.requestFingerprint, treeId: event.treeId };
      assertIdentity(event.request.requestId, requestIdentity(event.request), identity);
      const prior = identities.get(event.request.requestId);
      if (prior !== undefined) assertIdentity(event.request.requestId, prior, identity);
      identities.set(event.request.requestId, identity);
      requests.set(event.request.requestId, event.request);
    } else if (storedEvent.eventType === 'procedure.zero-baseline.generation.completed') {
      const event = procedureZeroBaselineCompletedEventSchema.parse(storedEvent.payload);
      const requestId = event.result.generation.requestId;
      if (
        storedEvent.id !== `procedure-zero-baseline-completed:${requestId}` ||
        completed.has(requestId)
      ) {
        throw new Error('Zero-baseline completed evidence identity is invalid');
      }
      const request = requests.get(requestId);
      if (request === undefined) {
        throw new Error('Zero-baseline completed evidence is missing its requested predecessor');
      }
      const identity = {
        fingerprint: event.result.requestFingerprint,
        treeId: event.result.generation.tree.id,
      };
      assertIdentity(requestId, requestIdentity(request), identity);
      const prior = identities.get(requestId);
      if (prior === undefined) {
        throw new Error('Zero-baseline completed evidence is missing its requested predecessor');
      }
      assertIdentity(requestId, prior, identity);
      validateGenerationBinding(request, identity.treeId, event.result.generation);
      identities.set(requestId, identity);
      completed.set(requestId, event.result);
    }
  }

  const inFlight = new Map<
    string,
    { identity: RequestIdentity; promise: Promise<ProcedureZeroBaselineResult> }
  >();

  const complete = (
    request: ProcedureZeroBaselineGenerateRequest,
    identity: RequestIdentity,
    generationInput: ProcedureAuthoringGenerationResult,
  ): ProcedureZeroBaselineResult => {
    const generation = validateGenerationBinding(request, identity.treeId, generationInput);
    const result = procedureZeroBaselineResultSchema.parse({
      formatVersion: procedureZeroBaselineFormatVersion,
      requestFingerprint: identity.fingerprint,
      allocation: {
        strategy: 'request_fingerprint_uuid_v8',
      },
      retrieval: {
        status: 'not_used',
        reason: 'zero_baseline_has_no_existing_tree',
      },
      outcome: 'candidate_only',
      generation,
    });
    const completedEvent = procedureZeroBaselineCompletedEventSchema.parse({
      result,
      occurredAt: new Date().toISOString(),
    });
    try {
      options.appendEvent({
        id: `procedure-zero-baseline-completed:${request.requestId}`,
        eventType: 'procedure.zero-baseline.generation.completed',
        payload: completedEvent,
      });
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_persistence_failed',
        'Zero-baseline completion evidence could not be persisted',
        'same_request_id',
      );
    }
    completed.set(request.requestId, result);
    return result;
  };

  return {
    generate: async (requestInput) => {
      const request = procedureZeroBaselineGenerateRequestSchema.parse(requestInput);
      const identity = requestIdentity(request);
      const fingerprint = identity.fingerprint;
      const priorIdentity = identities.get(request.requestId);
      if (priorIdentity !== undefined) assertIdentity(request.requestId, priorIdentity, identity);

      const priorResult = completed.get(request.requestId);
      if (priorResult !== undefined) return structuredClone(priorResult);
      const running = inFlight.get(request.requestId);
      if (running !== undefined) {
        assertIdentity(request.requestId, running.identity, identity);
        return structuredClone(await running.promise);
      }

      if (priorIdentity !== undefined) {
        const underlyingCompleted = options.generation.completedResult(request.requestId);
        if (underlyingCompleted !== null) {
          const recovery = Promise.resolve()
            .then(() => complete(request, identity, underlyingCompleted))
            .finally(() => inFlight.delete(request.requestId));
          inFlight.set(request.requestId, { identity, promise: recovery });
          return structuredClone(await recovery);
        }
        throw new PlannerGenerationRuntimeError(
          'planner_generation_already_attempted',
          'Zero-baseline generation has durable requested evidence but no durable Provider completion; the indeterminate Provider call will not be replayed',
          'new_request_id',
        );
      }
      validateProviderAuthorization(request, options.findProviderDescriptor);

      const promise = (async () => {
        if (priorIdentity === undefined) {
          const requestedEvent = procedureZeroBaselineRequestedEventSchema.parse({
            request,
            requestFingerprint: fingerprint,
            treeId: identity.treeId,
            revision: 1,
            occurredAt: new Date().toISOString(),
          });
          try {
            options.appendEvent({
              id: `procedure-zero-baseline-requested:${request.requestId}`,
              eventType: 'procedure.zero-baseline.generation.requested',
              payload: requestedEvent,
            });
          } catch {
            throw new PlannerGenerationRuntimeError(
              'planner_persistence_failed',
              'Zero-baseline allocation evidence could not be persisted',
              'same_request_id',
            );
          }
          identities.set(request.requestId, identity);
          requests.set(request.requestId, request);
        }

        const generation = await options.generation.generate(
          generationRequest(request, identity.treeId),
        );
        return complete(request, identity, generation);
      })().finally(() => inFlight.delete(request.requestId));
      inFlight.set(request.requestId, { identity, promise });
      return structuredClone(await promise);
    },
    completedResult: (requestId) => {
      const result = completed.get(requestId);
      return result === undefined ? null : structuredClone(result);
    },
  };
}
