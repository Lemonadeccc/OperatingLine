import { z } from 'zod';

import {
  authoritySignedContent,
  authorityValidationReceiptSchema,
  datasetReleaseAuthorizationSchema,
} from './authority.js';
import {
  computeProtocolCanonicalJsonSha256,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import {
  evalArtifactReferenceSchema,
  evalContentSha256Schema,
  humanEvalFormatVersionSchema,
  humanEvalIntegritySchema,
} from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

const releaseCandidateArtifactKindSchema = evalArtifactReferenceSchema.shape.kind;

const releaseCandidateCaseSchema = z.strictObject({
  caseId: guideStepIdSchema,
  contentSha256: evalContentSha256Schema,
});

const releaseCandidateRuntimeAttestationSchema = z
  .strictObject({
    evidenceClass: z.enum([
      'runtime_attested_provider_treatment',
      'runtime_attested_provider_output',
    ]),
    treatmentSha256: evalContentSha256Schema,
    outputSha256: evalContentSha256Schema.nullable(),
  })
  .superRefine((attestation, context) => {
    if (
      (attestation.evidenceClass === 'runtime_attested_provider_output') !==
      (attestation.outputSha256 !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outputSha256'],
        message: 'Runtime output evidence must bind exactly one output hash',
      });
    }
  });

const releaseCandidateRunSchema = z
  .strictObject({
    runId: z.uuid(),
    contentSha256: evalContentSha256Schema,
    caseId: guideStepIdSchema,
    sourceKind: z.literal('live_provider_invocation'),
    outcome: z.enum(['completed', 'failed']),
    conditionSha256: evalContentSha256Schema,
    treatmentSha256: evalContentSha256Schema,
    runtimeAttestation: releaseCandidateRuntimeAttestationSchema,
  })
  .superRefine((run, context) => {
    const expectedEvidenceClass =
      run.outcome === 'completed'
        ? 'runtime_attested_provider_output'
        : 'runtime_attested_provider_treatment';
    if (run.runtimeAttestation.evidenceClass !== expectedEvidenceClass) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAttestation', 'evidenceClass'],
        message: `${run.outcome} runs require ${expectedEvidenceClass} evidence`,
      });
    }
    if (run.runtimeAttestation.treatmentSha256 !== run.treatmentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAttestation', 'treatmentSha256'],
        message: 'Runtime treatment evidence must match the released treatment hash',
      });
    }
  });

const releaseCandidateAnnotationSchema = z
  .strictObject({
    annotationId: z.uuid(),
    contentSha256: evalContentSha256Schema,
    runId: z.uuid(),
    reviewerPseudonym: guideStepIdSchema,
    status: z.enum(['current', 'superseded']),
    supersededByAnnotationId: z.uuid().nullable(),
  })
  .superRefine((annotation, context) => {
    if ((annotation.status === 'current') !== (annotation.supersededByAnnotationId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['supersededByAnnotationId'],
        message:
          'Current annotations cannot be superseded and superseded annotations must name a successor',
      });
    }
    if (annotation.supersededByAnnotationId === annotation.annotationId) {
      context.addIssue({
        code: 'custom',
        path: ['supersededByAnnotationId'],
        message: 'An annotation cannot supersede itself',
      });
    }
  });

const releaseCandidateAnnotationReferenceSchema = z.strictObject({
  annotationId: z.uuid(),
  annotationContentSha256: evalContentSha256Schema,
});

const releaseCandidateAdjudicationSchema = z.strictObject({
  adjudicationId: z.uuid(),
  contentSha256: evalContentSha256Schema,
  runId: z.uuid(),
  annotationRefs: z.array(releaseCandidateAnnotationReferenceSchema).min(2).max(10),
});

const releaseCandidateBlindSignoffSchema = z.strictObject({
  runId: z.uuid(),
  runContentSha256: evalContentSha256Schema,
  contentSha256: evalContentSha256Schema,
  projectionContentSha256: evalContentSha256Schema,
  renderedArtifacts: z
    .array(
      z.strictObject({
        artifactId: guideStepIdSchema,
        contentSha256: evalContentSha256Schema,
      }),
    )
    .max(64),
});

const releaseCandidateArtifactSchema = z.strictObject({
  ownerKind: z.enum(['case', 'run']),
  ownerId: z.string().min(1),
  artifactId: guideStepIdSchema,
  kind: releaseCandidateArtifactKindSchema,
  mediaType: z.string().trim().min(1).max(180),
  contentSha256: evalContentSha256Schema,
});

const releaseCandidateInventorySchema = z.strictObject({
  caseCount: z.number().int().nonnegative().max(1_000),
  runCount: z.number().int().nonnegative().max(1_000_000),
  completedRunCount: z.number().int().nonnegative().max(1_000_000),
  failedRunCount: z.number().int().nonnegative().max(1_000_000),
  annotationCount: z.number().int().nonnegative().max(10_000_000),
  currentAnnotationCount: z.number().int().nonnegative().max(10_000_000),
  supersededAnnotationCount: z.number().int().nonnegative().max(10_000_000),
  adjudicationCount: z.number().int().nonnegative().max(1_000_000),
  blindSignoffCount: z.number().int().nonnegative().max(1_000_000),
  artifactCount: z.number().int().nonnegative().max(10_000_000),
  caseArtifactCount: z.number().int().nonnegative().max(10_000_000),
  runArtifactCount: z.number().int().nonnegative().max(10_000_000),
});

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? '';
    const rightValue = right[index] ?? '';
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function assertSorted<T>(
  values: readonly T[],
  key: (value: T) => readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  if (
    values.some(
      (value, index) => index > 0 && compareTuple(key(values[index - 1]!), key(value)) > 0,
    )
  ) {
    context.addIssue({ code: 'custom', path, message: `${label} must use deterministic order` });
  }
}

function assertUnique(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: `${label} must be unique` });
  }
}

export const humanEvalReleaseCandidateManifestSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    kind: z.literal('human_eval_release_candidate'),
    suite: z.strictObject({
      suiteId: guideStepIdSchema,
      suiteVersion: catalogVersionSchema,
      contentSha256: evalContentSha256Schema,
      status: z.literal('released'),
      licenseId: z.string().trim().min(1).max(180),
    }),
    policy: z.strictObject({
      numericScoring: z.literal('prohibited'),
      providerRanking: z.literal('prohibited'),
      minimumIndependentAnnotationsPerRun: z.number().int().min(2).max(10),
      minimumDistinctTreatmentsPerCase: z.number().int().min(2).max(20),
      providerIdentityBlinding: z.literal('required'),
      disagreementHandling: z.literal('preserve_and_adjudicate'),
      missingRuns: z.literal('report_as_missing'),
      syntheticRunsInPublishedComparison: z.literal('prohibited'),
    }),
    dataHandling: z.strictObject({
      contentSha256: evalContentSha256Schema,
      redaction: z.enum(['none', 'human_reviewed']),
      containsPotentiallySensitiveContent: z.boolean(),
      permittedUses: z
        .array(z.enum(['local_eval', 'research']))
        .min(1)
        .max(2),
      trainingUse: z.literal('not_authorized'),
      publicRelease: z.literal('reviewed'),
    }),
    cases: z.array(releaseCandidateCaseSchema).min(1).max(1_000),
    runs: z.array(releaseCandidateRunSchema).min(1).max(1_000_000),
    annotations: z.array(releaseCandidateAnnotationSchema).min(1).max(10_000_000),
    adjudications: z.array(releaseCandidateAdjudicationSchema).max(1_000_000),
    blindSignoffs: z.array(releaseCandidateBlindSignoffSchema).min(1).max(1_000_000),
    artifacts: z.array(releaseCandidateArtifactSchema).max(10_000_000),
    inventory: releaseCandidateInventorySchema,
    integrity: humanEvalIntegritySchema,
  })
  .superRefine((manifest, context) => {
    const { cases, runs, annotations, adjudications, blindSignoffs, artifacts } = manifest;
    assertSorted(cases, (entry) => [entry.caseId], context, ['cases'], 'Cases');
    assertSorted(runs, (entry) => [entry.caseId, entry.runId], context, ['runs'], 'Runs');
    assertSorted(
      annotations,
      (entry) => [entry.runId, entry.reviewerPseudonym, entry.annotationId],
      context,
      ['annotations'],
      'Annotations',
    );
    assertSorted(
      adjudications,
      (entry) => [entry.runId, entry.adjudicationId],
      context,
      ['adjudications'],
      'Adjudications',
    );
    assertSorted(
      blindSignoffs,
      (entry) => [entry.runId],
      context,
      ['blindSignoffs'],
      'Blind sign-offs',
    );
    assertSorted(
      artifacts,
      (entry) => [entry.ownerKind, entry.ownerId, entry.artifactId],
      context,
      ['artifacts'],
      'Artifacts',
    );
    assertSorted(
      manifest.dataHandling.permittedUses,
      (entry) => [entry],
      context,
      ['dataHandling', 'permittedUses'],
      'Permitted uses',
    );
    for (const [index, adjudication] of adjudications.entries()) {
      assertSorted(
        adjudication.annotationRefs,
        (entry) => [entry.annotationId],
        context,
        ['adjudications', index, 'annotationRefs'],
        'Adjudication annotation references',
      );
      assertUnique(
        adjudication.annotationRefs.map((entry) => entry.annotationId),
        context,
        ['adjudications', index, 'annotationRefs'],
        'Adjudication annotation reference ids',
      );
    }
    for (const [index, signoff] of blindSignoffs.entries()) {
      assertSorted(
        signoff.renderedArtifacts,
        (entry) => [entry.artifactId],
        context,
        ['blindSignoffs', index, 'renderedArtifacts'],
        'Blind sign-off artifacts',
      );
      assertUnique(
        signoff.renderedArtifacts.map((entry) => entry.artifactId),
        context,
        ['blindSignoffs', index, 'renderedArtifacts'],
        'Blind sign-off artifact ids',
      );
    }

    assertUnique(
      cases.map((entry) => entry.caseId),
      context,
      ['cases'],
      'Case ids',
    );
    assertUnique(
      runs.map((entry) => entry.runId),
      context,
      ['runs'],
      'Run ids',
    );
    assertUnique(
      annotations.map((entry) => entry.annotationId),
      context,
      ['annotations'],
      'Annotation ids',
    );
    assertUnique(
      adjudications.map((entry) => entry.adjudicationId),
      context,
      ['adjudications'],
      'Adjudication ids',
    );
    assertUnique(
      blindSignoffs.map((entry) => entry.runId),
      context,
      ['blindSignoffs'],
      'Blind sign-off run ids',
    );
    assertUnique(
      artifacts.map((entry) => `${entry.ownerKind}\u0000${entry.ownerId}\u0000${entry.artifactId}`),
      context,
      ['artifacts'],
      'Artifact owner/id bindings',
    );
    assertUnique(
      manifest.dataHandling.permittedUses,
      context,
      ['dataHandling', 'permittedUses'],
      'Permitted uses',
    );

    const casesById = new Map(cases.map((entry) => [entry.caseId, entry]));
    const runsById = new Map(runs.map((entry) => [entry.runId, entry]));
    const annotationsById = new Map(annotations.map((entry) => [entry.annotationId, entry]));
    const artifactsByOwner = new Map(
      artifacts.map((entry) => [
        `${entry.ownerKind}\u0000${entry.ownerId}\u0000${entry.artifactId}`,
        entry,
      ]),
    );

    for (const [index, run] of runs.entries()) {
      if (!casesById.has(run.caseId)) {
        context.addIssue({
          code: 'custom',
          path: ['runs', index, 'caseId'],
          message: `Run references unknown case ${run.caseId}`,
        });
      }
      const currentRunAnnotations = annotations.filter(
        (annotation) => annotation.runId === run.runId && annotation.status === 'current',
      );
      const currentReviewerPseudonyms = currentRunAnnotations.map(
        (annotation) => annotation.reviewerPseudonym,
      );
      if (
        new Set(currentReviewerPseudonyms).size !== currentReviewerPseudonyms.length ||
        currentReviewerPseudonyms.length < manifest.policy.minimumIndependentAnnotationsPerRun
      ) {
        context.addIssue({
          code: 'custom',
          path: ['annotations'],
          message: `Run ${run.runId} must bind the required number of independent current reviewers`,
        });
      }
      if (!blindSignoffs.some((signoff) => signoff.runId === run.runId)) {
        context.addIssue({
          code: 'custom',
          path: ['blindSignoffs'],
          message: `Run ${run.runId} requires one provider-blind sign-off`,
        });
      }
    }
    for (const [index, evalCase] of cases.entries()) {
      const treatmentsByCondition = new Map<string, Set<string>>();
      for (const run of runs.filter((entry) => entry.caseId === evalCase.caseId)) {
        const treatments = treatmentsByCondition.get(run.conditionSha256) ?? new Set<string>();
        treatments.add(run.treatmentSha256);
        treatmentsByCondition.set(run.conditionSha256, treatments);
      }
      const maximumDistinctTreatments = Math.max(
        0,
        ...[...treatmentsByCondition.values()].map((treatments) => treatments.size),
      );
      if (maximumDistinctTreatments < manifest.policy.minimumDistinctTreatmentsPerCase) {
        context.addIssue({
          code: 'custom',
          path: ['cases', index],
          message: `Case ${evalCase.caseId} lacks the required distinct treatments under one condition`,
        });
      }
    }
    for (const [index, annotation] of annotations.entries()) {
      if (!runsById.has(annotation.runId)) {
        context.addIssue({
          code: 'custom',
          path: ['annotations', index, 'runId'],
          message: `Annotation references unknown run ${annotation.runId}`,
        });
      }
      if (annotation.supersededByAnnotationId !== null) {
        const successor = annotationsById.get(annotation.supersededByAnnotationId);
        if (
          successor === undefined ||
          successor.runId !== annotation.runId ||
          successor.reviewerPseudonym !== annotation.reviewerPseudonym
        ) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, 'supersededByAnnotationId'],
            message:
              'Superseded annotations must reference a later annotation for the same run and reviewer',
          });
        }
      }
    }
    for (const [index, adjudication] of adjudications.entries()) {
      if (!runsById.has(adjudication.runId)) {
        context.addIssue({
          code: 'custom',
          path: ['adjudications', index, 'runId'],
          message: `Adjudication references unknown run ${adjudication.runId}`,
        });
      }
      for (const [referenceIndex, reference] of adjudication.annotationRefs.entries()) {
        const annotation = annotationsById.get(reference.annotationId);
        if (
          annotation === undefined ||
          annotation.runId !== adjudication.runId ||
          annotation.status !== 'current' ||
          annotation.contentSha256 !== reference.annotationContentSha256
        ) {
          context.addIssue({
            code: 'custom',
            path: ['adjudications', index, 'annotationRefs', referenceIndex],
            message: 'Adjudication references must bind current annotations for the same run',
          });
        }
      }
      const currentRunAnnotationIds = annotations
        .filter(
          (annotation) =>
            annotation.runId === adjudication.runId && annotation.status === 'current',
        )
        .map((annotation) => annotation.annotationId);
      if (
        currentRunAnnotationIds.length !== adjudication.annotationRefs.length ||
        currentRunAnnotationIds.some(
          (annotationId) =>
            !adjudication.annotationRefs.some(
              (reference) => reference.annotationId === annotationId,
            ),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['adjudications', index, 'annotationRefs'],
          message: 'Adjudication must bind every current annotation for its run',
        });
      }
    }
    for (const [index, signoff] of blindSignoffs.entries()) {
      const run = runsById.get(signoff.runId);
      if (run === undefined || run.contentSha256 !== signoff.runContentSha256) {
        context.addIssue({
          code: 'custom',
          path: ['blindSignoffs', index, 'runId'],
          message: 'Blind sign-off must bind an included run and its exact content hash',
        });
      }
      for (const [artifactIndex, artifact] of signoff.renderedArtifacts.entries()) {
        const releasedArtifact = artifactsByOwner.get(
          `run\u0000${signoff.runId}\u0000${artifact.artifactId}`,
        );
        if (
          (releasedArtifact?.kind !== 'rendered_image' &&
            releasedArtifact?.kind !== 'manual_review_image') ||
          releasedArtifact.mediaType !== 'image/png' ||
          releasedArtifact.contentSha256 !== artifact.contentSha256
        ) {
          context.addIssue({
            code: 'custom',
            path: ['blindSignoffs', index, 'renderedArtifacts', artifactIndex],
            message: 'Blind sign-off artifacts must bind included PNG review artifacts',
          });
        }
      }
    }
    for (const [index, artifact] of artifacts.entries()) {
      const knownOwner =
        artifact.ownerKind === 'case'
          ? casesById.has(artifact.ownerId)
          : runsById.has(artifact.ownerId);
      if (!knownOwner) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'ownerId'],
          message: `Artifact references unknown ${artifact.ownerKind} ${artifact.ownerId}`,
        });
      }
    }

    const currentAnnotationCount = annotations.filter((entry) => entry.status === 'current').length;
    const supersededAnnotationCount = annotations.length - currentAnnotationCount;
    const completedRunCount = runs.filter((entry) => entry.outcome === 'completed').length;
    const caseArtifactCount = artifacts.filter((entry) => entry.ownerKind === 'case').length;
    const expectedInventory = {
      caseCount: cases.length,
      runCount: runs.length,
      completedRunCount,
      failedRunCount: runs.length - completedRunCount,
      annotationCount: annotations.length,
      currentAnnotationCount,
      supersededAnnotationCount,
      adjudicationCount: adjudications.length,
      blindSignoffCount: blindSignoffs.length,
      artifactCount: artifacts.length,
      caseArtifactCount,
      runArtifactCount: artifacts.length - caseArtifactCount,
    };
    if (
      Object.entries(expectedInventory).some(
        ([key, value]) => manifest.inventory[key as keyof typeof expectedInventory] !== value,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inventory'],
        message: 'Release candidate inventory must match the exact manifest contents',
      });
    }
  });

export type HumanEvalReleaseCandidateManifest = z.infer<
  typeof humanEvalReleaseCandidateManifestSchema
>;

const humanEvalReleasedManifestIntegritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: evalContentSha256Schema,
});

const humanEvalReleaseProjectionSchema = z.strictObject({
  audience: datasetReleaseAuthorizationSchema.shape.audience,
  license: datasetReleaseAuthorizationSchema.shape.license,
  redactionDecisionSha256: datasetReleaseAuthorizationSchema.shape.redactionDecisionSha256,
  releaseScope: datasetReleaseAuthorizationSchema.shape.releaseScope,
});

const humanEvalReleasedManifestBaseSchema = z.strictObject({
  formatVersion: humanEvalFormatVersionSchema,
  kind: z.literal('human_eval_released_manifest'),
  operationId: z.uuid(),
  releaseCandidate: humanEvalReleaseCandidateManifestSchema,
  authorization: datasetReleaseAuthorizationSchema,
  authorizationContentSha256: evalContentSha256Schema,
  validationReceipt: authorityValidationReceiptSchema,
  validationReceiptSha256: evalContentSha256Schema,
  release: humanEvalReleaseProjectionSchema,
  dataHandling: z.strictObject({
    trainingUse: z.literal('not_authorized'),
  }),
  integrity: humanEvalReleasedManifestIntegritySchema,
});

type HumanEvalReleasedManifestBase = z.infer<typeof humanEvalReleasedManifestBaseSchema>;

/** Hashes every final-release field except the integrity envelope itself. */
export function computeHumanEvalReleasedManifestContentSha256(
  manifest: HumanEvalReleasedManifestBase,
): string {
  return computeProtocolCanonicalJsonSha256(
    Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'integrity')),
  );
}

export const humanEvalReleasedManifestSchema = humanEvalReleasedManifestBaseSchema.superRefine(
  (manifest, context) => {
    const { authorization, releaseCandidate, validationReceipt } = manifest;
    const expectedAuthorizationContentSha256 = computeProtocolCanonicalJsonSha256(
      authoritySignedContent(authorization),
    );
    const expectedValidationReceiptSha256 = computeProtocolCanonicalJsonSha256(validationReceipt);

    if (authorization.releaseCandidateManifestSha256 !== releaseCandidate.integrity.contentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'releaseCandidateManifestSha256'],
        message: 'Release authorization must bind the exact candidate manifest',
      });
    }
    if (authorization.license !== releaseCandidate.suite.licenseId) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'license'],
        message: 'Release authorization license must match the candidate suite license',
      });
    }
    if (manifest.authorizationContentSha256 !== expectedAuthorizationContentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['authorizationContentSha256'],
        message: 'Authorization content hash must bind the complete signed authorization content',
      });
    }
    if (validationReceipt.authorityKind !== 'DatasetReleaseAuthorization') {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'authorityKind'],
        message: 'Final release requires a DatasetReleaseAuthorization receipt',
      });
    }
    if (validationReceipt.authorityId !== authorization.authorityId) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'authorityId'],
        message: 'Validation receipt must bind the embedded authorization id',
      });
    }
    if (validationReceipt.signerId !== authorization.signature.signerId) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'signerId'],
        message: 'Validation receipt signer must match the authorization signer',
      });
    }
    if (validationReceipt.keyId !== authorization.signature.keyId) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'keyId'],
        message: 'Validation receipt key must match the authorization key',
      });
    }
    if (validationReceipt.authorityContentSha256 !== expectedAuthorizationContentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'authorityContentSha256'],
        message: 'Validation receipt must bind the complete signed authorization content',
      });
    }
    if (
      validationReceipt.targetSha256 !== authorization.releaseCandidateManifestSha256 ||
      validationReceipt.targetSha256 !== releaseCandidate.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'targetSha256'],
        message: 'Validation receipt must target the exact authorized candidate manifest',
      });
    }
    if (validationReceipt.sideEffect !== 'dataset_release') {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'sideEffect'],
        message: 'Validation receipt must authorize the dataset_release side effect',
      });
    }
    const validatedAt = Date.parse(validationReceipt.validatedAt);
    if (
      validatedAt < Date.parse(authorization.notBefore) ||
      validatedAt >= Date.parse(authorization.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceipt', 'validatedAt'],
        message: 'Validation receipt must be issued inside the authorization validity window',
      });
    }
    if (
      manifest.release.audience !== authorization.audience ||
      manifest.release.license !== authorization.license ||
      manifest.release.redactionDecisionSha256 !== authorization.redactionDecisionSha256 ||
      manifest.release.releaseScope !== authorization.releaseScope
    ) {
      context.addIssue({
        code: 'custom',
        path: ['release'],
        message: 'Release projection must exactly match the embedded authorization',
      });
    }
    if (manifest.validationReceiptSha256 !== expectedValidationReceiptSha256) {
      context.addIssue({
        code: 'custom',
        path: ['validationReceiptSha256'],
        message: 'Validation receipt hash must bind the complete receipt',
      });
    }
    if (
      manifest.integrity.contentSha256 !== computeHumanEvalReleasedManifestContentSha256(manifest)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Released manifest integrity must bind every final-release field',
      });
    }
  },
);
export type HumanEvalReleasedManifest = z.infer<typeof humanEvalReleasedManifestSchema>;

export const humanEvalReleaseRequestSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    operationId: z.uuid(),
    releaseCandidate: humanEvalReleaseCandidateManifestSchema,
    authorization: datasetReleaseAuthorizationSchema,
  })
  .superRefine((request, context) => {
    // Structural parsing can only bind the authorization to the candidate's declared integrity
    // hash. The release coordinator must run the eval-kit integrity validator before live
    // authority verification; this schema does not claim to recompute that legacy JSON hash.
    if (
      request.authorization.releaseCandidateManifestSha256 !==
      request.releaseCandidate.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'releaseCandidateManifestSha256'],
        message: 'Release authorization must bind the exact candidate manifest',
      });
    }
    if (request.authorization.license !== request.releaseCandidate.suite.licenseId) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'license'],
        message: 'Release authorization license must match the candidate suite license',
      });
    }
  });
export type HumanEvalReleaseRequest = z.infer<typeof humanEvalReleaseRequestSchema>;

export const humanEvalReleaseResponseSchema = z
  .strictObject({
    formatVersion: humanEvalFormatVersionSchema,
    operationId: z.uuid(),
    status: z.enum(['created', 'already_completed']),
    releasedManifestSha256: evalContentSha256Schema,
    releasedManifest: humanEvalReleasedManifestSchema,
  })
  .superRefine((response, context) => {
    if (response.operationId !== response.releasedManifest.operationId) {
      context.addIssue({
        code: 'custom',
        path: ['releasedManifest', 'operationId'],
        message: 'Release response must bind the requested operation id',
      });
    }
    if (response.releasedManifestSha256 !== response.releasedManifest.integrity.contentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['releasedManifestSha256'],
        message: 'Release response hash must bind the exact durable released manifest',
      });
    }
  });
export type HumanEvalReleaseResponse = z.infer<typeof humanEvalReleaseResponseSchema>;
