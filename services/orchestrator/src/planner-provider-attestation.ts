import { createHash } from 'node:crypto';

import {
  plannerProviderProcedureEmbeddingMaximumDocuments,
  type PlannerProvider,
  type PlannerProviderRuntimeOperation,
} from '@operatingline/planner-provider-sdk';
import {
  plannerProviderRuntimeOutputAttestationSchema,
  plannerProviderRuntimeTreatmentAttestationSchema,
  plannerProviderRuntimeTreatmentSchema,
  procedureAuthoringProviderRuntimeOutputAttestationSchema,
  procedureAuthoringProviderRuntimeTreatmentAttestationSchema,
  procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema,
  procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
  type PlannerProviderDescriptor,
  type PlannerProviderRuntimeOutputAttestation,
  type PlannerProviderRuntimeTreatmentAttestation,
  type ProcedureAuthoringProviderRuntimeOutputAttestation,
  type ProcedureAuthoringProviderRuntimeTreatmentAttestation,
  type ProcedureSemanticRetrievalProviderRuntimeOutputAttestation,
  type ProcedureSemanticRetrievalProviderRuntimeTreatmentAttestation,
} from '@operatingline/protocol';

import { PlannerGenerationRuntimeError } from './planner-provider-errors.js';

function normalizeJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Cyclic JSON value');
    ancestors.add(value);
    try {
      return value.map((entry) => normalizeJson(entry, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (value !== null && typeof value === 'object') {
    if (ancestors.has(value)) throw new TypeError('Cyclic JSON value');
    ancestors.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalizeJson(entry, ancestors)]),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  return value;
}

export function computePlannerProviderAttestationSha256(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(normalizeJson(value));
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      'Planner runtime treatment is not JSON serializable',
      'same_request_id',
    );
  }
  return createHash('sha256').update(serialized).digest('hex');
}

export function snapshotPlannerProviderRuntimeTreatment(
  provider: PlannerProvider,
  descriptor: PlannerProviderDescriptor,
  operation: 'initial_plan' | 'local_replan',
): PlannerProviderRuntimeTreatmentAttestation | undefined;
export function snapshotPlannerProviderRuntimeTreatment(
  provider: PlannerProvider,
  descriptor: PlannerProviderDescriptor,
  operation: 'procedure_authoring',
): ProcedureAuthoringProviderRuntimeTreatmentAttestation | undefined;
export function snapshotPlannerProviderRuntimeTreatment(
  provider: PlannerProvider,
  descriptor: PlannerProviderDescriptor,
  operation: 'procedure_embedding',
): ProcedureSemanticRetrievalProviderRuntimeTreatmentAttestation | undefined;
export function snapshotPlannerProviderRuntimeTreatment(
  provider: PlannerProvider,
  descriptor: PlannerProviderDescriptor,
  operation: PlannerProviderRuntimeOperation,
):
  | PlannerProviderRuntimeTreatmentAttestation
  | ProcedureAuthoringProviderRuntimeTreatmentAttestation
  | ProcedureSemanticRetrievalProviderRuntimeTreatmentAttestation
  | undefined {
  if (provider.describeRuntimeTreatment === undefined) return undefined;
  let described: ReturnType<NonNullable<PlannerProvider['describeRuntimeTreatment']>>;
  try {
    described = structuredClone(provider.describeRuntimeTreatment(operation));
  } catch {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      'Planner runtime treatment could not be described safely',
      'same_request_id',
    );
  }
  const treatment = plannerProviderRuntimeTreatmentSchema.safeParse({
    profile: described.profile,
    generationSettings: {
      ...described.generationSettings,
      parametersSha256: computePlannerProviderAttestationSha256(
        described.generationSettings.normalizedParameters,
      ),
    },
  });
  if (
    !treatment.success ||
    computePlannerProviderAttestationSha256(treatment.data.profile.descriptor) !==
      computePlannerProviderAttestationSha256(descriptor)
  ) {
    throw new PlannerGenerationRuntimeError(
      'planner_identity_mismatch',
      'Planner runtime treatment does not match its registered provider identity',
      'same_request_id',
    );
  }
  const attestation = {
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_treatment',
    operation,
    treatment: treatment.data,
    treatmentSha256: computePlannerProviderAttestationSha256(treatment.data),
  };
  if (operation === 'procedure_embedding') {
    if (described.costPolicy === undefined) {
      throw new PlannerGenerationRuntimeError(
        'planner_identity_mismatch',
        'Procedure embedding provider did not disclose its cost policy',
        'same_request_id',
      );
    }
    const content = {
      formatVersion: '1.0.0',
      evidenceClass: 'runtime_attested_provider_treatment',
      operation,
      treatment: treatment.data,
      costPolicy: described.costPolicy,
      inputPolicy: {
        documentFormat: 'procedure_leaf_embedding_document_v1',
        maximumDocumentCount: plannerProviderProcedureEmbeddingMaximumDocuments - 1,
        sourceEvidenceContentIncluded: false,
        vectorsPersistedInProtocol: false,
      },
    } as const;
    return procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema.parse({
      ...content,
      treatmentContentSha256: computePlannerProviderAttestationSha256(content),
    });
  }
  return operation === 'procedure_authoring'
    ? procedureAuthoringProviderRuntimeTreatmentAttestationSchema.parse(attestation)
    : plannerProviderRuntimeTreatmentAttestationSchema.parse(attestation);
}

interface RuntimeOutputAttestationInput<
  TOperation extends PlannerProviderRuntimeOperation,
  TTreatment,
> {
  readonly operation: TOperation;
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly packet: unknown;
  readonly output: unknown;
  readonly treatment: TTreatment | undefined;
  readonly occurredAt: string;
}

interface ProcedureEmbeddingRuntimeOutputAttestationInput {
  readonly operation: 'procedure_embedding';
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly queryContentSha256: string;
  readonly corpusContentSha256: string;
  readonly inputBatch: unknown;
  readonly output: unknown;
  readonly treatment: ProcedureSemanticRetrievalProviderRuntimeTreatmentAttestation | undefined;
  readonly occurredAt: string;
}

export function createPlannerProviderRuntimeOutputAttestation(
  input: RuntimeOutputAttestationInput<
    'initial_plan' | 'local_replan',
    PlannerProviderRuntimeTreatmentAttestation
  >,
): PlannerProviderRuntimeOutputAttestation | undefined;
export function createPlannerProviderRuntimeOutputAttestation(
  input: RuntimeOutputAttestationInput<
    'procedure_authoring',
    ProcedureAuthoringProviderRuntimeTreatmentAttestation
  >,
): ProcedureAuthoringProviderRuntimeOutputAttestation | undefined;
export function createPlannerProviderRuntimeOutputAttestation(
  input: ProcedureEmbeddingRuntimeOutputAttestationInput,
): ProcedureSemanticRetrievalProviderRuntimeOutputAttestation | undefined;
export function createPlannerProviderRuntimeOutputAttestation(
  input:
    | RuntimeOutputAttestationInput<
        Exclude<PlannerProviderRuntimeOperation, 'procedure_embedding'>,
        | PlannerProviderRuntimeTreatmentAttestation
        | ProcedureAuthoringProviderRuntimeTreatmentAttestation
      >
    | ProcedureEmbeddingRuntimeOutputAttestationInput,
):
  | PlannerProviderRuntimeOutputAttestation
  | ProcedureAuthoringProviderRuntimeOutputAttestation
  | ProcedureSemanticRetrievalProviderRuntimeOutputAttestation
  | undefined {
  if (input.treatment === undefined) return undefined;
  if (input.operation === 'procedure_embedding') {
    return procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema.parse({
      formatVersion: '1.0.0',
      evidenceClass: 'runtime_attested_provider_output',
      operation: input.operation,
      requestId: input.requestId,
      requestFingerprint: input.requestFingerprint,
      queryContentSha256: input.queryContentSha256,
      corpusContentSha256: input.corpusContentSha256,
      inputBatchContentSha256: computePlannerProviderAttestationSha256(input.inputBatch),
      outputContentSha256: computePlannerProviderAttestationSha256(input.output),
      treatment: input.treatment,
      occurredAt: input.occurredAt,
    });
  }
  const attestation = {
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_output',
    operation: input.operation,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
    packetSha256: computePlannerProviderAttestationSha256(input.packet),
    outputSha256: computePlannerProviderAttestationSha256(input.output),
    treatment: input.treatment,
    occurredAt: input.occurredAt,
  };
  return input.operation === 'procedure_authoring'
    ? procedureAuthoringProviderRuntimeOutputAttestationSchema.parse(attestation)
    : plannerProviderRuntimeOutputAttestationSchema.parse(attestation);
}
