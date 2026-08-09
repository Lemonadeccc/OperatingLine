import type {
  HumanEvalIntegrity,
  HumanEvalSuite,
  ProviderEvalProfile,
  ProviderEvalRun,
} from '@operatingline/protocol';

import {
  computeHumanEvalContentSha256,
  computeHumanEvalRecordSha256,
  createHumanEvalIntegrity,
} from './integrity.js';

export const providerBlindSignoffFormatVersion = '1.0.0' as const;
export const providerBlindReviewProjectionVersion = '1.0.0' as const;
export const providerBlindSignoffAssertion = 'no_provider_identity_visible' as const;

export interface ProviderBlindRenderedArtifactV1 {
  readonly artifactId: string;
  readonly mediaType: 'image/png';
  readonly contentSha256: string;
  readonly visiblePixelsReviewed: true;
}

export interface ProviderBlindReviewSurfaceV1 {
  readonly projectionVersion: typeof providerBlindReviewProjectionVersion;
  readonly title: string;
  readonly task: string;
  readonly requirements: HumanEvalSuite['cases'][number]['requirements'];
  readonly rubric: HumanEvalSuite['rubric']['criteria'];
  readonly generatedPlan: unknown | null;
  readonly planningQuality: unknown | null;
  readonly evidenceLabels: readonly {
    readonly kind: 'requirement' | 'plan_step' | 'execution_event' | 'artifact' | 'run_output';
    readonly label: string;
    readonly mediaType: string | null;
  }[];
  readonly renderedArtifacts: readonly ProviderBlindRenderedArtifactV1[];
}

export interface ProviderBlindSignoffV1 {
  readonly formatVersion: typeof providerBlindSignoffFormatVersion;
  readonly runId: string;
  readonly runContentSha256: string;
  readonly projectionVersion: typeof providerBlindReviewProjectionVersion;
  readonly projectionContentSha256: string;
  readonly renderedArtifacts: readonly ProviderBlindRenderedArtifactV1[];
  readonly supplementalAliases: readonly string[];
  readonly aliasesReviewedComplete: true;
  readonly assertion: typeof providerBlindSignoffAssertion;
  readonly preparedBy: string;
  readonly reviewedAt: string;
  readonly integrity: HumanEvalIntegrity;
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pseudonymPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const pureVersionPattern = /^v?\d+(?:[._-]\d+)*(?:[-+][a-z0-9.-]+)?$/i;
const offsetDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const genericIdentityMarkers = new Set([
  'api',
  'custom',
  'default',
  'implementation',
  'local',
  'model',
  'none',
  'planner',
  'planning provider',
  'provider',
  'sdk',
  'service',
  'test',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown, max = 2_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isIntegrity(value: unknown): value is HumanEvalIntegrity {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['algorithm', 'canonicalization', 'contentSha256']) &&
    value.algorithm === 'sha256' &&
    value.canonicalization === 'operatingline-json-sort-v1' &&
    typeof value.contentSha256 === 'string' &&
    sha256Pattern.test(value.contentSha256)
  );
}

function parseRenderedArtifact(value: unknown): ProviderBlindRenderedArtifactV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['artifactId', 'mediaType', 'contentSha256', 'visiblePixelsReviewed']) ||
    !isNonEmptyString(value.artifactId, 180) ||
    !pseudonymPattern.test(value.artifactId) ||
    value.mediaType !== 'image/png' ||
    typeof value.contentSha256 !== 'string' ||
    !sha256Pattern.test(value.contentSha256) ||
    value.visiblePixelsReviewed !== true
  ) {
    throw new Error('Provider-blind sign-off rendered artifact is invalid');
  }
  return {
    artifactId: value.artifactId,
    mediaType: value.mediaType,
    contentSha256: value.contentSha256,
    visiblePixelsReviewed: value.visiblePixelsReviewed,
  };
}

export function parseProviderBlindSignoffV1(value: unknown): ProviderBlindSignoffV1 {
  const keys = [
    'formatVersion',
    'runId',
    'runContentSha256',
    'projectionVersion',
    'projectionContentSha256',
    'renderedArtifacts',
    'supplementalAliases',
    'aliasesReviewedComplete',
    'assertion',
    'preparedBy',
    'reviewedAt',
    'integrity',
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error('Provider-blind sign-off must be a strict version 1 record');
  }
  if (
    value.formatVersion !== providerBlindSignoffFormatVersion ||
    typeof value.runId !== 'string' ||
    !runIdPattern.test(value.runId) ||
    typeof value.runContentSha256 !== 'string' ||
    !sha256Pattern.test(value.runContentSha256) ||
    value.projectionVersion !== providerBlindReviewProjectionVersion ||
    typeof value.projectionContentSha256 !== 'string' ||
    !sha256Pattern.test(value.projectionContentSha256) ||
    !Array.isArray(value.renderedArtifacts) ||
    value.renderedArtifacts.length > 64 ||
    !Array.isArray(value.supplementalAliases) ||
    value.supplementalAliases.length > 128 ||
    value.aliasesReviewedComplete !== true ||
    value.assertion !== providerBlindSignoffAssertion ||
    !isNonEmptyString(value.preparedBy, 180) ||
    !pseudonymPattern.test(value.preparedBy) ||
    typeof value.reviewedAt !== 'string' ||
    !offsetDateTimePattern.test(value.reviewedAt) ||
    !Number.isFinite(Date.parse(value.reviewedAt)) ||
    !isIntegrity(value.integrity)
  ) {
    throw new Error('Provider-blind sign-off version 1 fields are invalid');
  }
  const renderedArtifacts = value.renderedArtifacts.map(parseRenderedArtifact);
  if (
    new Set(renderedArtifacts.map((artifact) => artifact.artifactId)).size !==
    renderedArtifacts.length
  ) {
    throw new Error('Provider-blind sign-off rendered artifact ids must be unique');
  }
  const supplementalAliases = value.supplementalAliases.map((alias) => {
    if (!isNonEmptyString(alias, 500)) {
      throw new Error('Provider-blind sign-off supplemental aliases are invalid');
    }
    return alias;
  });
  const normalizedAliases = supplementalAliases.map(normalizeProviderIdentityText);
  if (
    normalizedAliases.some((alias) => alias.length === 0) ||
    new Set(normalizedAliases).size !== normalizedAliases.length
  ) {
    throw new Error('Provider-blind sign-off supplemental aliases must be unique');
  }
  return {
    formatVersion: value.formatVersion,
    runId: value.runId,
    runContentSha256: value.runContentSha256,
    projectionVersion: value.projectionVersion,
    projectionContentSha256: value.projectionContentSha256,
    renderedArtifacts,
    supplementalAliases,
    aliasesReviewedComplete: value.aliasesReviewedComplete,
    assertion: value.assertion,
    preparedBy: value.preparedBy,
    reviewedAt: value.reviewedAt,
    integrity: value.integrity,
  };
}

export function sealProviderBlindSignoffV1(
  content: Omit<ProviderBlindSignoffV1, 'integrity'>,
): ProviderBlindSignoffV1 {
  return parseProviderBlindSignoffV1({ ...content, integrity: createHumanEvalIntegrity(content) });
}

export function normalizeProviderIdentityText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/gu, ' ');
}

function usableDerivedMarker(value: string | null): string[] {
  if (value === null) return [];
  const normalized = normalizeProviderIdentityText(value);
  if (
    normalized.length === 0 ||
    genericIdentityMarkers.has(normalized) ||
    (pureVersionPattern.test(normalized) && normalized !== 'o1' && normalized !== 'o3')
  ) {
    return [];
  }
  if (normalized.length < 3 && normalized !== 'o1' && normalized !== 'o3') return [];
  return [normalized];
}

export function deriveProviderIdentityMarkers(
  profile: ProviderEvalProfile,
  supplementalAliases: readonly string[] = [],
): readonly string[] {
  const descriptor = profile.descriptor;
  const candidates = [
    descriptor.id,
    descriptor.displayName,
    descriptor.description,
    profile.vendor,
    profile.implementation.name,
    profile.model.requested,
    profile.model.resolvedRevision,
    profile.api.surface,
    profile.api.sdkName,
  ];
  return [
    ...new Set([
      ...candidates.flatMap(usableDerivedMarker),
      ...supplementalAliases.map(normalizeProviderIdentityText).filter((alias) => alias.length > 0),
    ]),
  ];
}

export interface ProviderIdentityScanResult {
  readonly hasProviderIdentity: boolean;
}

export function scanProviderIdentity(
  value: unknown,
  markers: readonly string[],
): ProviderIdentityScanResult {
  const textValues: string[] = [];
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string') {
      textValues.push(normalizeProviderIdentityText(entry));
    } else if (Array.isArray(entry)) {
      entry.forEach(visit);
    } else if (isRecord(entry)) {
      for (const [key, nested] of Object.entries(entry)) {
        textValues.push(normalizeProviderIdentityText(key));
        visit(nested);
      }
    }
  };
  visit(value);
  return {
    hasProviderIdentity: markers.some((marker) => {
      const normalizedMarker = normalizeProviderIdentityText(marker);
      return (
        normalizedMarker.length > 0 &&
        textValues.some((textValue) => textValue.includes(normalizedMarker))
      );
    }),
  };
}

export function assertProviderIdentityAbsent(value: unknown, markers: readonly string[]): void {
  if (scanProviderIdentity(value, markers).hasProviderIdentity) {
    throw new Error('Provider identity marker detected in provider-blind content');
  }
}

export function providerBlindRenderedArtifacts(
  run: ProviderEvalRun,
): readonly ProviderBlindRenderedArtifactV1[] {
  return run.artifacts
    .filter(
      (artifact): artifact is typeof artifact & { mediaType: 'image/png' } =>
        (artifact.kind === 'rendered_image' || artifact.kind === 'manual_review_image') &&
        artifact.mediaType === 'image/png',
    )
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      mediaType: artifact.mediaType,
      contentSha256: artifact.contentSha256,
      visiblePixelsReviewed: true as const,
    }));
}

export function buildProviderBlindReviewSurface(
  suite: HumanEvalSuite,
  run: ProviderEvalRun,
): ProviderBlindReviewSurfaceV1 {
  const evalCase = suite.cases.find((candidate) => candidate.id === run.caseRef.caseId);
  if (evalCase === undefined) throw new Error('Cannot build a blind surface for an unknown case');
  const completed = run.outcome.status === 'completed' ? run.outcome.result : null;
  const evidenceLabels: ProviderBlindReviewSurfaceV1['evidenceLabels'][number][] = [];
  for (const requirement of evalCase.requirements) {
    evidenceLabels.push({ kind: 'requirement', label: requirement.statement, mediaType: null });
  }
  if (completed !== null) {
    for (const step of completed.draft.plan.steps) {
      evidenceLabels.push({ kind: 'plan_step', label: step.title, mediaType: null });
    }
    evidenceLabels.push({
      kind: 'run_output',
      label: 'Generated planning result',
      mediaType: 'application/json',
    });
  }
  for (const event of run.sourceEvents.filter(
    (candidate) => candidate.correlationKind === 'host_execution',
  )) {
    void event;
    evidenceLabels.push({
      kind: 'execution_event',
      label: 'Verified host execution event',
      mediaType: 'application/json',
    });
  }
  for (const artifact of run.artifacts.filter(
    (candidate) => candidate.kind !== 'eval_export' && candidate.kind !== 'provider_output',
  )) {
    evidenceLabels.push({
      kind: 'artifact',
      label: `Verified ${artifact.kind.replaceAll('_', ' ')} artifact`,
      mediaType: artifact.mediaType,
    });
  }
  return {
    projectionVersion: providerBlindReviewProjectionVersion,
    title: evalCase.title,
    task:
      run.invocation.operation === 'initial_plan'
        ? run.invocation.packet.context.goal
        : run.invocation.packet.context.revisionRequest.message,
    requirements: evalCase.requirements,
    rubric: evalCase.rubricCriterionIds.map((id) => {
      const criterion = suite.rubric.criteria.find((candidate) => candidate.id === id);
      if (criterion === undefined)
        throw new Error('Cannot build a blind surface with an unknown rubric');
      return criterion;
    }),
    generatedPlan: completed?.draft.plan ?? null,
    planningQuality: completed?.planningQuality ?? null,
    evidenceLabels,
    renderedArtifacts: providerBlindRenderedArtifacts(run),
  };
}

export function computeProviderBlindReviewSurfaceSha256(
  suite: HumanEvalSuite,
  run: ProviderEvalRun,
): string {
  return computeHumanEvalContentSha256(buildProviderBlindReviewSurface(suite, run));
}

export function providerBlindSignoffIntegrityMatches(signoff: ProviderBlindSignoffV1): boolean {
  return signoff.integrity.contentSha256 === computeHumanEvalRecordSha256(signoff);
}
