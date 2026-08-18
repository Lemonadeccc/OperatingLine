import { z } from 'zod';

import { canonicalizeProtocolJsonValue } from './canonical-json-value.js';
import { evalContentSha256Schema } from './eval-common.js';
import {
  plannerGenerationErrorCodeSchema,
  plannerProviderIdSchema,
  plannerProviderRuntimeTreatmentAttestationVersion,
  plannerProviderRuntimeTreatmentSchema,
} from './provider.js';
import {
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringPromptFormatVersionSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringValidationResultSchema,
} from './procedure-authoring.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringGenerationFormatVersion = '1.0.0' as const;
export const procedureAuthoringGenerationFormatVersionSchema = z.literal(
  procedureAuthoringGenerationFormatVersion,
);

export const procedureAuthoringGenerateRequestSchema = procedureAuthoringPromptRequestSchema.extend(
  {
    requestId: z.uuid(),
    providerId: plannerProviderIdSchema,
  },
);
export type ProcedureAuthoringGenerateRequest = z.infer<
  typeof procedureAuthoringGenerateRequestSchema
>;

export const procedureAuthoringGenerationResultSchema = z
  .strictObject({
    formatVersion: procedureAuthoringGenerationFormatVersionSchema,
    generationId: z.uuid(),
    requestId: z.uuid(),
    provider: z.strictObject({
      id: plannerProviderIdSchema,
      version: catalogVersionSchema,
    }),
    packet: procedureAuthoringPromptPacketSchema,
    tree: procedureAuthoringCandidateTreeSchema,
    validation: procedureAuthoringValidationResultSchema,
    sideEffects: z.strictObject({
      modelCalled: z.literal(true),
      procedureStored: z.literal(false),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
    generatedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((result, context) => {
    const packetContext = result.packet.context;
    const compilation = result.validation.compilation;
    if (result.packet.integrity.contentSha256 !== result.validation.packetContentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['validation', 'packetContentSha256'],
        message: 'Procedure generation validation must bind the exact returned packet',
      });
    }
    if (result.packet.formatVersion !== result.validation.formatVersion) {
      context.addIssue({
        code: 'custom',
        path: ['validation', 'formatVersion'],
        message: 'Procedure generation packet and validation versions must match',
      });
    }
    if (
      result.tree.id !== packetContext.requestedTreeId ||
      result.tree.revision !== packetContext.recommendedRevision ||
      result.tree.adapterId !== packetContext.catalogBinding.adapterId ||
      result.tree.actionCatalogVersion !==
        packetContext.catalogBinding.actionCatalog.catalogVersion ||
      result.tree.interactionCatalogVersion !==
        packetContext.catalogBinding.interactionCatalog.catalogVersion ||
      compilation.procedureTreeId !== result.tree.id ||
      compilation.procedureTreeRevision !== result.tree.revision ||
      compilation.adapterId !== result.tree.adapterId ||
      compilation.actionCatalogVersion !== result.tree.actionCatalogVersion ||
      compilation.interactionCatalogVersion !== result.tree.interactionCatalogVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tree'],
        message: 'Procedure generation result identities must match packet and compilation',
      });
    }
  });
export type ProcedureAuthoringGenerationResult = z.infer<
  typeof procedureAuthoringGenerationResultSchema
>;

export const procedureAuthoringProviderRuntimeTreatmentAttestationSchema = z.strictObject({
  formatVersion: z.literal(plannerProviderRuntimeTreatmentAttestationVersion),
  evidenceClass: z.literal('runtime_attested_provider_treatment'),
  operation: z.literal('procedure_authoring'),
  treatment: plannerProviderRuntimeTreatmentSchema,
  treatmentSha256: evalContentSha256Schema,
});
export type ProcedureAuthoringProviderRuntimeTreatmentAttestation = z.infer<
  typeof procedureAuthoringProviderRuntimeTreatmentAttestationSchema
>;

export const procedureAuthoringProviderRuntimeOutputAttestationSchema = z
  .strictObject({
    formatVersion: z.literal(plannerProviderRuntimeTreatmentAttestationVersion),
    evidenceClass: z.literal('runtime_attested_provider_output'),
    operation: z.literal('procedure_authoring'),
    requestId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    packetSha256: evalContentSha256Schema,
    outputSha256: evalContentSha256Schema,
    treatment: procedureAuthoringProviderRuntimeTreatmentAttestationSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((attestation, context) => {
    if (attestation.operation !== attestation.treatment.operation) {
      context.addIssue({
        code: 'custom',
        path: ['treatment', 'operation'],
        message: 'Output and treatment attestations must describe Procedure authoring',
      });
    }
  });
export type ProcedureAuthoringProviderRuntimeOutputAttestation = z.infer<
  typeof procedureAuthoringProviderRuntimeOutputAttestationSchema
>;

const procedureAuthoringGenerationEventScopeSchema = z.strictObject({
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  providerId: plannerProviderIdSchema,
  providerVersion: catalogVersionSchema,
  targetAdapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
  actionCatalogVersion: catalogVersionSchema,
  interactionCatalogVersion: catalogVersionSchema,
  treeId: procedureAuthoringPromptRequestSchema.shape.treeId,
  revision: procedureAuthoringPromptRequestSchema.shape.revision,
  packetContentSha256: evalContentSha256Schema,
});

export const procedureAuthoringGenerationRequestedEventSchema =
  procedureAuthoringGenerationEventScopeSchema.extend({
    packetFormatVersion: procedureAuthoringPromptFormatVersionSchema,
    runtimeTreatment: procedureAuthoringProviderRuntimeTreatmentAttestationSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureAuthoringGenerationRequestedEvent = z.infer<
  typeof procedureAuthoringGenerationRequestedEventSchema
>;

function tutorialRequestMatchesPacket(
  request: z.infer<typeof procedureAuthoringGenerateRequestSchema>,
  packet: z.infer<typeof procedureAuthoringPromptPacketSchema>,
): boolean {
  const tutorial = packet.context.tutorialProvenance;
  if (request.tutorial === undefined || tutorial === undefined) {
    return request.tutorial === undefined && tutorial === undefined;
  }
  const normalizedPacketTutorial = {
    video: {
      uri: tutorial.source.uri,
      title: tutorial.source.title,
      durationMs: tutorial.source.durationMs,
      rightsStatus: tutorial.source.rightsStatus,
      ...(tutorial.source.license === undefined ? {} : { license: tutorial.source.license }),
    },
    transcript: {
      origin: tutorial.transcript.origin,
      ...(tutorial.transcript.locale === undefined ? {} : { locale: tutorial.transcript.locale }),
      segments: tutorial.transcript.segments.map((segment) => ({
        startMs: segment.locator.startMs,
        endMs: segment.locator.endMs,
        text: segment.text,
        confidence: segment.confidence,
      })),
    },
  };
  const packetBytes = canonicalizeProtocolJsonValue(normalizedPacketTutorial);
  const requestBytes = canonicalizeProtocolJsonValue(request.tutorial);
  return (
    packetBytes.byteLength === requestBytes.byteLength &&
    packetBytes.every((byte, index) => byte === requestBytes[index])
  );
}

export const procedureAuthoringGenerationCompletedEventSchema = z
  .strictObject({
    request: procedureAuthoringGenerateRequestSchema,
    requestFingerprint: evalContentSha256Schema,
    result: procedureAuthoringGenerationResultSchema,
    runtimeAttestation: procedureAuthoringProviderRuntimeOutputAttestationSchema.optional(),
  })
  .superRefine((event, context) => {
    const packetContext = event.result.packet.context;
    if (
      event.result.requestId !== event.request.requestId ||
      event.result.provider.id !== event.request.providerId ||
      packetContext.requestedTreeId !== event.request.treeId ||
      packetContext.recommendedRevision !== event.request.revision ||
      packetContext.catalogBinding.adapterId !== event.request.targetAdapterId ||
      packetContext.goalProvenance.source.text !== event.request.goal ||
      !tutorialRequestMatchesPacket(event.request, event.result.packet) ||
      (event.request.actionCatalogVersion !== undefined &&
        packetContext.catalogBinding.actionCatalog.catalogVersion !==
          event.request.actionCatalogVersion) ||
      (event.request.interactionCatalogVersion !== undefined &&
        packetContext.catalogBinding.interactionCatalog.catalogVersion !==
          event.request.interactionCatalogVersion)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed Procedure generation evidence must match its exact request',
      });
    }
    if (
      event.runtimeAttestation !== undefined &&
      (event.runtimeAttestation.operation !== 'procedure_authoring' ||
        event.runtimeAttestation.requestId !== event.request.requestId ||
        event.runtimeAttestation.requestFingerprint !== event.requestFingerprint)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAttestation'],
        message: 'Runtime attestation must match the exact Procedure authoring request',
      });
    }
  });
export type ProcedureAuthoringGenerationCompletedEvent = z.infer<
  typeof procedureAuthoringGenerationCompletedEventSchema
>;

export const procedureAuthoringGenerationFailedEventSchema =
  procedureAuthoringGenerationEventScopeSchema.extend({
    error: plannerGenerationErrorCodeSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.iso.datetime({ offset: true }),
  });
export type ProcedureAuthoringGenerationFailedEvent = z.infer<
  typeof procedureAuthoringGenerationFailedEventSchema
>;
