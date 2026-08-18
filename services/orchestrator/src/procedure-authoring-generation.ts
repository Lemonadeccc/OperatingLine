import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringGenerateRequestSchema,
  procedureAuthoringGenerationCompletedEventSchema,
  procedureAuthoringGenerationFailedEventSchema,
  procedureAuthoringGenerationFormatVersion,
  procedureAuthoringGenerationRequestedEventSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringPromptPacketSchema,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringGenerateRequest,
  type ProcedureAuthoringGenerationResult,
  type ProcedureAuthoringPromptPacket,
  type ProcedureAuthoringPromptRequest,
  type ProcedureAuthoringValidationResult,
} from '@operatingline/protocol';

import {
  createPlannerProviderRuntimeOutputAttestation,
  snapshotPlannerProviderRuntimeTreatment,
} from './planner-provider-attestation.js';
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
import type { PlannerProviderRegistry } from './planner-provider-registry.js';
import { validateProcedureAuthoringCandidate } from './procedure-authoring-prompt.js';

export const procedureAuthoringGenerationEvidenceEventTypes = [
  'procedure.authoring.provider.generation.requested',
  'procedure.authoring.provider.generation.completed',
  'procedure.authoring.provider.generation.failed',
] as const;

export interface ProcedureAuthoringGenerationCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly invocationManager?: PlannerProviderInvocationManager;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (
    request: ProcedureAuthoringPromptRequest,
  ) => ProcedureAuthoringPromptPacket;
  readonly validateCandidate: (
    packet: ProcedureAuthoringPromptPacket,
    tree: ProcedureAuthoringCandidateTree,
  ) => ProcedureAuthoringValidationResult;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface ProcedureAuthoringGenerationCoordinator {
  generate(request: ProcedureAuthoringGenerateRequest): Promise<ProcedureAuthoringGenerationResult>;
  completedResult(requestId: string): ProcedureAuthoringGenerationResult | null;
  close(): Promise<void>;
}

export function restoreProcedureAuthoringProviderInvocations(
  events: readonly StoredExecutionEvent[],
): RestoredPlannerProviderInvocation[] {
  const restored: RestoredPlannerProviderInvocation[] = [];
  for (const event of events) {
    if (event.eventType === 'procedure.authoring.provider.generation.requested') {
      const payload = procedureAuthoringGenerationRequestedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'procedure_authoring',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'procedure.authoring.provider.generation.failed') {
      const payload = procedureAuthoringGenerationFailedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.requestId,
        operation: 'procedure_authoring',
        fingerprint: payload.requestFingerprint,
      });
    } else if (event.eventType === 'procedure.authoring.provider.generation.completed') {
      const payload = procedureAuthoringGenerationCompletedEventSchema.parse(event.payload);
      restored.push({
        requestId: payload.request.requestId,
        operation: 'procedure_authoring',
        fingerprint: payload.requestFingerprint,
        result: payload.result,
      });
    }
  }
  return restored;
}

function requestToPrompt(
  request: ProcedureAuthoringGenerateRequest,
): ProcedureAuthoringPromptRequest {
  return {
    targetAdapterId: request.targetAdapterId,
    ...(request.actionCatalogVersion === undefined
      ? {}
      : { actionCatalogVersion: request.actionCatalogVersion }),
    ...(request.interactionCatalogVersion === undefined
      ? {}
      : { interactionCatalogVersion: request.interactionCatalogVersion }),
    goal: request.goal,
    treeId: request.treeId,
    revision: request.revision,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  };
}

function parseProviderOutput(output: unknown): ProcedureAuthoringCandidateTree {
  const parsed = procedureAuthoringCandidateTreeSchema.safeParse(
    sanitizePlannerProviderOutput(output),
  );
  if (!parsed.success) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Planner provider output violates the strict Procedure authoring candidate contract',
      'new_request_id',
    );
  }
  return parsed.data;
}

function canonicalPacketPrompt(packet: ProcedureAuthoringPromptPacket): string {
  return Buffer.from(canonicalizeProtocolJsonValue(packet)).toString('utf8');
}

export function createProcedureAuthoringGenerationCoordinator(
  options: ProcedureAuthoringGenerationCoordinatorOptions,
): ProcedureAuthoringGenerationCoordinator {
  const invocationManager =
    options.invocationManager ??
    createPlannerProviderInvocationManager({
      registry: options.registry,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      restoredInvocations: restoreProcedureAuthoringProviderInvocations(options.existingEvents),
    });

  const appendEvidence = (
    event: ExecutionEventInput,
    retryMode: 'same_request_id' | 'new_request_id',
  ) => {
    try {
      options.appendEvent(event);
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_persistence_failed',
        'Procedure authoring generation evidence could not be persisted',
        retryMode,
      );
    }
  };

  const generateAttempt = async (
    request: ProcedureAuthoringGenerateRequest,
    requestFingerprint: string,
    attemptContext: PlannerProviderAttemptContext,
  ): Promise<ProcedureAuthoringGenerationResult> => {
    let packet: ProcedureAuthoringPromptPacket | null = null;
    const startedAt = Date.now();
    let requestRecorded = false;
    try {
      try {
        packet = procedureAuthoringPromptPacketSchema.parse(
          options.buildPacket(requestToPrompt(request)),
        );
      } catch {
        throw new PlannerGenerationRuntimeError(
          'planner_catalog_invalid',
          'Procedure authoring packet could not be built from the requested catalogs',
          'same_request_id',
        );
      }

      const packetContext = packet.context;
      const runtimeTreatment = snapshotPlannerProviderRuntimeTreatment(
        attemptContext.registered.provider,
        attemptContext.registered.descriptor,
        'procedure_authoring',
      );
      const requestedPayload = procedureAuthoringGenerationRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint,
        providerId: attemptContext.registered.descriptor.id,
        providerVersion: attemptContext.registered.descriptor.version,
        targetAdapterId: packetContext.catalogBinding.adapterId,
        actionCatalogVersion: packetContext.catalogBinding.actionCatalog.catalogVersion,
        interactionCatalogVersion: packetContext.catalogBinding.interactionCatalog.catalogVersion,
        treeId: packetContext.requestedTreeId,
        revision: packetContext.recommendedRevision,
        packetContentSha256: packet.integrity.contentSha256,
        packetFormatVersion: packet.formatVersion,
        ...(runtimeTreatment === undefined ? {} : { runtimeTreatment }),
        occurredAt: new Date().toISOString(),
      });
      appendEvidence(
        {
          id: `procedure-authoring-generation-requested:${request.requestId}`,
          eventType: 'procedure.authoring.provider.generation.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      attemptContext.markAttempted();
      requestRecorded = true;

      const rawOutput = await attemptContext.invoke((provider, signal) => {
        if (provider.authorProcedure === undefined) {
          throw new PlannerGenerationRuntimeError(
            'planner_procedure_authoring_not_supported',
            `Planner provider ${request.providerId} does not support Procedure authoring`,
            'same_request_id',
          );
        }
        return provider.authorProcedure({
          requestId: request.requestId,
          packet: structuredClone(packet!),
          renderedPrompt: canonicalPacketPrompt(packet!),
          signal,
        });
      });
      const tree = parseProviderOutput(rawOutput);
      try {
        validateProcedureAuthoringCandidate(packet, tree);
      } catch {
        throw new PlannerGenerationRuntimeError(
          'planner_identity_mismatch',
          'Planner provider output changed immutable Procedure authoring packet fields',
          'new_request_id',
        );
      }

      let validation: ProcedureAuthoringValidationResult;
      try {
        validation = options.validateCandidate(packet, tree);
      } catch {
        throw new PlannerGenerationRuntimeError(
          'planner_output_invalid',
          'Generated ProcedureTree failed deterministic authoring and compilation validation',
          'new_request_id',
        );
      }

      const generatedAt = new Date().toISOString();
      const result = procedureAuthoringGenerationResultSchema.parse({
        formatVersion: procedureAuthoringGenerationFormatVersion,
        generationId: randomUUID(),
        requestId: request.requestId,
        provider: {
          id: attemptContext.registered.descriptor.id,
          version: attemptContext.registered.descriptor.version,
        },
        packet,
        tree,
        validation,
        sideEffects: {
          modelCalled: true,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        generatedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      const runtimeAttestation = createPlannerProviderRuntimeOutputAttestation({
        operation: 'procedure_authoring',
        requestId: request.requestId,
        requestFingerprint,
        packet,
        output: tree,
        treatment: runtimeTreatment,
        occurredAt: generatedAt,
      });
      const completedPayload = procedureAuthoringGenerationCompletedEventSchema.parse({
        request,
        requestFingerprint,
        result,
        ...(runtimeAttestation === undefined ? {} : { runtimeAttestation }),
      });
      appendEvidence(
        {
          id: `procedure-authoring-generation-completed:${request.requestId}`,
          eventType: 'procedure.authoring.provider.generation.completed',
          payload: completedPayload,
        },
        'new_request_id',
      );
      return result;
    } catch (error) {
      const safeError = safePlannerRuntimeError(error);
      if (requestRecorded && packet !== null) {
        const packetContext = packet.context;
        const failedPayload = procedureAuthoringGenerationFailedEventSchema.parse({
          requestId: request.requestId,
          requestFingerprint,
          providerId: attemptContext.registered.descriptor.id,
          providerVersion: attemptContext.registered.descriptor.version,
          targetAdapterId: packetContext.catalogBinding.adapterId,
          actionCatalogVersion: packetContext.catalogBinding.actionCatalog.catalogVersion,
          interactionCatalogVersion: packetContext.catalogBinding.interactionCatalog.catalogVersion,
          treeId: packetContext.requestedTreeId,
          revision: packetContext.recommendedRevision,
          packetContentSha256: packet.integrity.contentSha256,
          error: safeError.code,
          durationMs: Math.max(0, Date.now() - startedAt),
          occurredAt: new Date().toISOString(),
        });
        appendEvidence(
          {
            id: `procedure-authoring-generation-failed:${request.requestId}`,
            eventType: 'procedure.authoring.provider.generation.failed',
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
      const request = procedureAuthoringGenerateRequestSchema.parse(requestInput);
      const requestFingerprint = plannerProviderRequestFingerprint(request);
      const result = await invocationManager.execute({
        requestId: request.requestId,
        operation: 'procedure_authoring',
        fingerprint: requestFingerprint,
        providerId: request.providerId,
        planKey: [request.targetAdapterId, request.treeId],
        requiresReplan: false,
        requiresProcedureAuthoring: true,
        attempt: (attemptContext) => generateAttempt(request, requestFingerprint, attemptContext),
      });
      return procedureAuthoringGenerationResultSchema.parse(result);
    },
    completedResult: (requestId) => {
      const result = invocationManager.completedResult(requestId, 'procedure_authoring');
      return result === null ? null : procedureAuthoringGenerationResultSchema.parse(result);
    },
    close: () => invocationManager.close(),
  };
}
