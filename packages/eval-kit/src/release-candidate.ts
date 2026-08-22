import {
  humanEvalReleaseCandidateManifestSchema,
  type HumanEvalReleaseCandidateManifest,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import { HumanEvalDatasetError, type ValidatedHumanEvalDataset } from './dataset.js';
import {
  computeHumanEvalCaseSha256,
  computeHumanEvalContentSha256,
  computeHumanEvalRecordSha256,
  createHumanEvalIntegrity,
} from './integrity.js';
import { isArtifactVerifiedDataset } from './verification.js';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const comparison = compareText(left[index] ?? '', right[index] ?? '');
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function runtimeAttestationReference(run: ProviderEvalRun) {
  const attestation = run.runtimeAttestation;
  if (attestation === null) {
    throw new HumanEvalDatasetError('Human Eval release candidate requires runtime evidence', [
      `Released run ${run.runId} has no runtime attestation`,
    ]);
  }
  if (attestation.evidenceClass === 'runtime_attested_provider_output') {
    return {
      evidenceClass: attestation.evidenceClass,
      treatmentSha256: attestation.treatment.treatmentSha256,
      outputSha256: attestation.outputSha256,
    } as const;
  }
  return {
    evidenceClass: attestation.evidenceClass,
    treatmentSha256: attestation.treatmentSha256,
    outputSha256: null,
  } as const;
}

export function validateHumanEvalReleaseCandidateManifest(
  input: unknown,
): HumanEvalReleaseCandidateManifest {
  let manifest: HumanEvalReleaseCandidateManifest;
  try {
    manifest = humanEvalReleaseCandidateManifestSchema.parse(input);
  } catch (error) {
    throw new HumanEvalDatasetError('Human Eval release candidate parsing failed', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const actual = computeHumanEvalRecordSha256(manifest);
  if (actual !== manifest.integrity.contentSha256) {
    throw new HumanEvalDatasetError('Human Eval release candidate integrity failed', [
      `Release candidate integrity mismatch: expected ${manifest.integrity.contentSha256}, got ${actual}`,
    ]);
  }
  return manifest;
}

export function buildHumanEvalReleaseCandidateManifest(
  dataset: ValidatedHumanEvalDataset,
): HumanEvalReleaseCandidateManifest {
  const issues: string[] = [];
  if (!isArtifactVerifiedDataset(dataset)) {
    issues.push(
      'Load the dataset through loadHumanEvalDatasetDirectory before building a release candidate',
    );
  }
  if (dataset.suite.status !== 'released') {
    issues.push(
      `Human Eval suite ${dataset.suite.suiteId}@${dataset.suite.suiteVersion} must have released status`,
    );
  }
  if (dataset.runs.some((run) => run.sourceKind !== 'live_provider_invocation')) {
    issues.push('Human Eval release candidates cannot include synthetic runs');
  }
  for (const run of dataset.runs) {
    if (run.runtimeAttestation === null) {
      issues.push(`Released run ${run.runId} has no runtime attestation`);
    } else if (
      run.outcome.status === 'completed' &&
      run.runtimeAttestation.evidenceClass !== 'runtime_attested_provider_output'
    ) {
      issues.push(`Released run ${run.runId} has no runtime-attested Provider output`);
    }
  }
  if (issues.length > 0) {
    throw new HumanEvalDatasetError('Human Eval release candidate is not eligible', issues);
  }

  const supersededBy = new Map<string, string>();
  for (const annotation of dataset.annotations) {
    if (annotation.supersedesAnnotationId !== null) {
      supersededBy.set(annotation.supersedesAnnotationId, annotation.annotationId);
    }
  }

  const cases = dataset.suite.cases
    .map((evalCase) => ({
      caseId: evalCase.id,
      contentSha256: computeHumanEvalCaseSha256(evalCase),
    }))
    .sort((left, right) => compareText(left.caseId, right.caseId));
  const runs = dataset.runs
    .map((run) => ({
      runId: run.runId,
      contentSha256: run.integrity.contentSha256,
      caseId: run.caseRef.caseId,
      sourceKind: run.sourceKind,
      outcome: run.outcome.status,
      conditionSha256: run.comparability.conditionSha256,
      treatmentSha256: run.comparability.treatmentSha256,
      runtimeAttestation: runtimeAttestationReference(run),
    }))
    .sort((left, right) => compareTuple([left.caseId, left.runId], [right.caseId, right.runId]));
  const annotations = dataset.annotations
    .map((annotation) => {
      const supersededByAnnotationId = supersededBy.get(annotation.annotationId) ?? null;
      return {
        annotationId: annotation.annotationId,
        contentSha256: annotation.integrity.contentSha256,
        runId: annotation.runId,
        reviewerPseudonym: annotation.reviewer.pseudonym,
        status: supersededByAnnotationId === null ? ('current' as const) : ('superseded' as const),
        supersededByAnnotationId,
      };
    })
    .sort((left, right) =>
      compareTuple(
        [left.runId, left.reviewerPseudonym, left.annotationId],
        [right.runId, right.reviewerPseudonym, right.annotationId],
      ),
    );
  const adjudications = dataset.adjudications
    .map((adjudication) => ({
      adjudicationId: adjudication.adjudicationId,
      contentSha256: adjudication.integrity.contentSha256,
      runId: adjudication.runId,
      annotationRefs: [...adjudication.annotationRefs].sort((left, right) =>
        compareText(left.annotationId, right.annotationId),
      ),
    }))
    .sort((left, right) =>
      compareTuple([left.runId, left.adjudicationId], [right.runId, right.adjudicationId]),
    );
  const blindSignoffs = dataset.blindSignoffs
    .map((signoff) => ({
      runId: signoff.runId,
      runContentSha256: signoff.runContentSha256,
      contentSha256: signoff.integrity.contentSha256,
      projectionContentSha256: signoff.projectionContentSha256,
      renderedArtifacts: signoff.renderedArtifacts
        .map((artifact) => ({
          artifactId: artifact.artifactId,
          contentSha256: artifact.contentSha256,
        }))
        .sort((left, right) => compareText(left.artifactId, right.artifactId)),
    }))
    .sort((left, right) => compareText(left.runId, right.runId));
  const artifacts = [
    ...dataset.suite.cases.flatMap((evalCase) =>
      evalCase.references.map((artifact) => ({
        ownerKind: 'case' as const,
        ownerId: evalCase.id,
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        contentSha256: artifact.contentSha256,
      })),
    ),
    ...dataset.runs.flatMap((run) =>
      run.artifacts.map((artifact) => ({
        ownerKind: 'run' as const,
        ownerId: run.runId,
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        contentSha256: artifact.contentSha256,
      })),
    ),
  ].sort((left, right) =>
    compareTuple(
      [left.ownerKind, left.ownerId, left.artifactId],
      [right.ownerKind, right.ownerId, right.artifactId],
    ),
  );
  const currentAnnotationCount = annotations.filter(
    (annotation) => annotation.status === 'current',
  ).length;
  const completedRunCount = runs.filter((run) => run.outcome === 'completed').length;
  const caseArtifactCount = artifacts.filter((artifact) => artifact.ownerKind === 'case').length;
  const content = {
    formatVersion: '1.0.0' as const,
    kind: 'human_eval_release_candidate' as const,
    suite: {
      suiteId: dataset.suite.suiteId,
      suiteVersion: dataset.suite.suiteVersion,
      contentSha256: dataset.suite.integrity.contentSha256,
      status: dataset.suite.status,
      licenseId: dataset.suite.licenseId,
    },
    policy: dataset.suite.policy,
    dataHandling: {
      contentSha256: computeHumanEvalContentSha256(dataset.suite.dataHandling),
      redaction: dataset.suite.dataHandling.redaction,
      containsPotentiallySensitiveContent:
        dataset.suite.dataHandling.containsPotentiallySensitiveContent,
      permittedUses: [...dataset.suite.dataHandling.permittedUses].sort(compareText),
      trainingUse: dataset.suite.dataHandling.trainingUse,
      publicRelease: dataset.suite.dataHandling.publicRelease,
    },
    cases,
    runs,
    annotations,
    adjudications,
    blindSignoffs,
    artifacts,
    inventory: {
      caseCount: cases.length,
      runCount: runs.length,
      completedRunCount,
      failedRunCount: runs.length - completedRunCount,
      annotationCount: annotations.length,
      currentAnnotationCount,
      supersededAnnotationCount: annotations.length - currentAnnotationCount,
      adjudicationCount: adjudications.length,
      blindSignoffCount: blindSignoffs.length,
      artifactCount: artifacts.length,
      caseArtifactCount,
      runArtifactCount: artifacts.length - caseArtifactCount,
    },
  };
  return validateHumanEvalReleaseCandidateManifest({
    ...content,
    integrity: createHumanEvalIntegrity(content),
  });
}
