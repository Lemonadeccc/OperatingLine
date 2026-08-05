import { createHash } from 'node:crypto';

import type {
  HumanEvalCase,
  HumanEvalIntegrity,
  HumanEvalRubric,
  ProviderEvalRun,
} from '@operatingline/protocol';
import { canonicalizeProtocolJsonValue } from '@operatingline/protocol';

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}

export function canonicalizeHumanEvalContent(value: unknown): string {
  const serialized = JSON.stringify(normalizeJson(value));
  if (serialized === undefined) {
    throw new Error('Human Eval content must be JSON serializable');
  }
  return serialized;
}

export function computeHumanEvalContentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeHumanEvalContent(value)).digest('hex');
}

export function computePlanContentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

export function createHumanEvalIntegrity(value: unknown): HumanEvalIntegrity {
  return {
    algorithm: 'sha256',
    canonicalization: 'operatingline-json-sort-v1',
    contentSha256: computeHumanEvalContentSha256(value),
  };
}

export function contentWithoutIntegrity<T extends { integrity: unknown }>(
  record: T,
): Omit<T, 'integrity'> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'integrity')) as Omit<
    T,
    'integrity'
  >;
}

export function computeHumanEvalRecordSha256(record: { integrity: unknown }): string {
  return computeHumanEvalContentSha256(contentWithoutIntegrity(record));
}

export function computeHumanEvalCaseSha256(evalCase: HumanEvalCase): string {
  return computeHumanEvalContentSha256(evalCase);
}

export function computeHumanEvalRubricSha256(rubric: HumanEvalRubric): string {
  return computeHumanEvalContentSha256(rubric);
}

export function providerEvalConditionContent(run: ProviderEvalRun): unknown {
  return {
    caseRef: run.caseRef,
    operation: run.invocation.operation,
    packet: run.invocation.packet,
    environment: {
      operatingLineVersion: run.environment.operatingLineVersion,
      sourceCommit: run.environment.sourceCommit,
      protocolVersion: run.environment.protocolVersion,
      targetAdapterId: run.environment.targetAdapterId,
      catalogVersion: run.environment.catalogVersion,
      adapterVersion: run.environment.adapterVersion,
      hostVersion: run.environment.hostVersion,
    },
  };
}

export function providerEvalTreatmentContent(run: ProviderEvalRun): unknown {
  return {
    profile: run.profile,
    generationSettings: run.generationSettings,
  };
}

export function computeProviderEvalConditionSha256(run: ProviderEvalRun): string {
  return computeHumanEvalContentSha256(providerEvalConditionContent(run));
}

export function computeProviderEvalTreatmentSha256(run: ProviderEvalRun): string {
  return computeHumanEvalContentSha256(providerEvalTreatmentContent(run));
}
