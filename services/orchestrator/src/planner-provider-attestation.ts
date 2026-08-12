import { createHash } from 'node:crypto';

import type {
  PlannerProvider,
  PlannerProviderRuntimeOperation,
} from '@operatingline/planner-provider-sdk';
import {
  plannerProviderRuntimeOutputAttestationSchema,
  plannerProviderRuntimeTreatmentAttestationSchema,
  plannerProviderRuntimeTreatmentSchema,
  type PlannerProviderDescriptor,
  type PlannerProviderRuntimeOutputAttestation,
  type PlannerProviderRuntimeTreatmentAttestation,
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
  operation: PlannerProviderRuntimeOperation,
): PlannerProviderRuntimeTreatmentAttestation | undefined {
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
  return plannerProviderRuntimeTreatmentAttestationSchema.parse({
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_treatment',
    operation,
    treatment: treatment.data,
    treatmentSha256: computePlannerProviderAttestationSha256(treatment.data),
  });
}

export function createPlannerProviderRuntimeOutputAttestation(input: {
  readonly operation: PlannerProviderRuntimeOperation;
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly packet: unknown;
  readonly output: unknown;
  readonly treatment: PlannerProviderRuntimeTreatmentAttestation | undefined;
  readonly occurredAt: string;
}): PlannerProviderRuntimeOutputAttestation | undefined {
  if (input.treatment === undefined) return undefined;
  return plannerProviderRuntimeOutputAttestationSchema.parse({
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_output',
    operation: input.operation,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
    packetSha256: computePlannerProviderAttestationSha256(input.packet),
    outputSha256: computePlannerProviderAttestationSha256(input.output),
    treatment: input.treatment,
    occurredAt: input.occurredAt,
  });
}
