import {
  currentEvalExportBundleSchema,
  findPlannerProviderCredentialLikeParameterPath,
  humanEvalSuiteSchema,
  plannerGenerationCompletedEventSchema,
  plannerGenerationRequestedEventSchema,
  plannerReplanCompletedEventSchema,
  plannerReplanRequestedEventSchema,
  type EvalExecutionEvent,
  type HumanEvalDataHandling,
  type HumanEvalSuite,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import {
  createProviderEvalRunFromCapture,
  providerEvalCaptureManifestVersion,
  type ProviderEvalCaptureManifestV1,
  type ProviderEvalCapturePageInput,
} from './capture.js';
import { computeHumanEvalContentSha256 } from './integrity.js';

export interface ProviderEvalCaptureManifestTemplateInput {
  readonly suite: HumanEvalSuite;
  readonly exportPages: readonly ProviderEvalCapturePageInput[];
  readonly caseId: string;
  readonly generationRequestId: string;
  readonly runId: string;
  readonly replicateIndex: number;
  readonly parentRunId: string | null;
  readonly environment: Pick<
    ProviderEvalRun['environment'],
    'operatingLineVersion' | 'sourceCommit'
  >;
  readonly provenance: ProviderEvalRun['provenance'];
  readonly dataHandling: HumanEvalDataHandling;
}

function templateError(message: string): Error {
  return new Error(`Provider Eval capture manifest template rejected: ${message}`);
}

function readBundle(page: ProviderEvalCapturePageInput) {
  if (page.bytes === undefined && page.bundle === undefined) {
    throw templateError(`Eval export ${page.artifactId} must provide bytes or a parsed bundle`);
  }
  if (page.bytes !== undefined) {
    try {
      const json = Buffer.from(page.bytes).toString('utf8');
      return currentEvalExportBundleSchema.parse(JSON.parse(json) as unknown);
    } catch (error) {
      throw templateError(
        `Eval export ${page.artifactId} bytes are not a current JSON export bundle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return currentEvalExportBundleSchema.parse(page.bundle);
}

function eventRequestId(event: EvalExecutionEvent): string | null {
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload['requestId'] === 'string') return payload['requestId'];
  for (const key of ['request', 'result', 'error']) {
    const nested = payload[key];
    if (
      nested !== null &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      typeof (nested as Record<string, unknown>)['requestId'] === 'string'
    ) {
      return (nested as Record<string, string>)['requestId'] ?? null;
    }
  }
  return null;
}

function runtimeNormalizedParameters(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const runtimeTreatment = (payload as Record<string, unknown>)['runtimeTreatment'];
  if (
    runtimeTreatment === null ||
    typeof runtimeTreatment !== 'object' ||
    Array.isArray(runtimeTreatment)
  ) {
    return undefined;
  }
  const treatment = (runtimeTreatment as Record<string, unknown>)['treatment'];
  if (treatment === null || typeof treatment !== 'object' || Array.isArray(treatment)) {
    return undefined;
  }
  const generationSettings = (treatment as Record<string, unknown>)['generationSettings'];
  if (
    generationSettings === null ||
    typeof generationSettings !== 'object' ||
    Array.isArray(generationSettings)
  ) {
    return undefined;
  }
  return (generationSettings as Record<string, unknown>)['normalizedParameters'];
}

/**
 * Derives a capture manifest from frozen evidence without performing a provider call or reading
 * credentials. Human-authored provenance, handling, and run identity remain explicit inputs.
 */
export function buildProviderEvalCaptureManifestTemplate(
  input: ProviderEvalCaptureManifestTemplateInput,
): ProviderEvalCaptureManifestV1 {
  const suite = humanEvalSuiteSchema.parse(input.suite);
  const evalCase = suite.cases.find((candidate) => candidate.id === input.caseId);
  if (evalCase === undefined) throw templateError(`case ${input.caseId} is not in the suite`);

  const bundles = input.exportPages.map(readBundle);
  const firstBundle = bundles[0];
  if (firstBundle === undefined) throw templateError('at least one Eval export page is required');
  const events = bundles.flatMap((bundle) => bundle.events);
  const operation = evalCase.operation;
  const prefix =
    operation === 'initial_plan' ? 'planning.provider.generation' : 'planning.provider.replan';
  const invocationEvents = events.filter(
    (event) =>
      (event.eventType.startsWith('planning.provider.generation.') ||
        event.eventType.startsWith('planning.provider.replan.')) &&
      eventRequestId(event) === input.generationRequestId,
  );
  const requestedEvents = invocationEvents.filter(
    (event) => event.eventType === `${prefix}.requested`,
  );
  const completedEvents = invocationEvents.filter(
    (event) => event.eventType === `${prefix}.completed`,
  );
  if (
    invocationEvents.length !== 2 ||
    requestedEvents.length !== 1 ||
    completedEvents.length !== 1
  ) {
    throw templateError(
      'expected exactly one requested event and one completed event for the selected case and generationRequestId',
    );
  }

  const credentialPath = findPlannerProviderCredentialLikeParameterPath(
    runtimeNormalizedParameters(requestedEvents[0]!.payload),
  );
  if (credentialPath !== null) {
    throw templateError(
      `runtime-attested normalized parameters contain credential-like key ${credentialPath}`,
    );
  }

  const requested =
    operation === 'initial_plan'
      ? plannerGenerationRequestedEventSchema.parse(requestedEvents[0]!.payload)
      : plannerReplanRequestedEventSchema.parse(requestedEvents[0]!.payload);
  const completed =
    operation === 'initial_plan'
      ? plannerGenerationCompletedEventSchema.parse(completedEvents[0]!.payload)
      : plannerReplanCompletedEventSchema.parse(completedEvents[0]!.payload);
  const runtimeTreatment = requested.runtimeTreatment;
  const runtimeAttestation = completed.runtimeAttestation;
  if (runtimeTreatment === undefined || runtimeAttestation === undefined) {
    throw templateError(
      'selected invocation must contain requested runtime treatment and completed runtime output attestations',
    );
  }
  if (
    runtimeTreatment.operation !== operation ||
    runtimeAttestation.operation !== operation ||
    runtimeAttestation.requestId !== input.generationRequestId ||
    runtimeAttestation.requestFingerprint !== requested.requestFingerprint ||
    runtimeTreatment.treatmentSha256 !==
      computeHumanEvalContentSha256(runtimeTreatment.treatment) ||
    computeHumanEvalContentSha256(runtimeAttestation.treatment) !==
      computeHumanEvalContentSha256(runtimeTreatment)
  ) {
    throw templateError('runtime attestations do not describe one exact selected invocation');
  }

  const { generationSettings, profile } = runtimeTreatment.treatment;
  const manifest: ProviderEvalCaptureManifestV1 = {
    formatVersion: providerEvalCaptureManifestVersion,
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    caseId: evalCase.id,
    generationRequestId: input.generationRequestId,
    runId: input.runId,
    replicateIndex: input.replicateIndex,
    parentRunId: input.parentRunId,
    profile,
    environment: {
      ...input.environment,
      protocolVersion: firstBundle.protocolVersion,
      targetAdapterId: requested.targetAdapterId,
      catalogVersion: requested.catalogVersion,
      adapterVersion: null,
      hostVersion: null,
    },
    generationSettings: {
      normalizedParameters: generationSettings.normalizedParameters,
      seed: generationSettings.seed,
      determinism: generationSettings.determinism,
    },
    reproducibility: 'best_effort',
    provenance: input.provenance,
    dataHandling: input.dataHandling,
    exportPages: input.exportPages,
  };

  // Reuse the full capture validator so no partially checked template can escape this builder.
  createProviderEvalRunFromCapture({ suite, manifest });
  return manifest;
}
