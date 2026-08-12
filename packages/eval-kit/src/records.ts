import {
  humanEvalAdjudicationSchema,
  humanEvalAnnotationSchema,
  humanEvalSuiteSchema,
  providerEvalRunSchema,
  type HumanEvalAdjudication,
  type HumanEvalAnnotation,
  type HumanEvalSuite,
  type ProviderEvalInvocation,
  type ProviderEvalOutcome,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import {
  computeHumanEvalContentSha256,
  computeProviderEvalConditionSha256,
  computeProviderEvalTreatmentSha256,
  createHumanEvalIntegrity,
} from './integrity.js';

export function sealHumanEvalSuite(content: Omit<HumanEvalSuite, 'integrity'>): HumanEvalSuite {
  return humanEvalSuiteSchema.parse({ ...content, integrity: createHumanEvalIntegrity(content) });
}

export function sealHumanEvalAnnotation(
  content: Omit<HumanEvalAnnotation, 'integrity'>,
): HumanEvalAnnotation {
  return humanEvalAnnotationSchema.parse({
    ...content,
    integrity: createHumanEvalIntegrity(content),
  });
}

export function sealHumanEvalAdjudication(
  content: Omit<HumanEvalAdjudication, 'integrity'>,
): HumanEvalAdjudication {
  return humanEvalAdjudicationSchema.parse({
    ...content,
    integrity: createHumanEvalIntegrity(content),
  });
}

type InitialInvocation = Extract<ProviderEvalInvocation, { operation: 'initial_plan' }>;
type ReplanInvocation = Extract<ProviderEvalInvocation, { operation: 'local_replan' }>;
type CompletedInitialOutcome = Extract<
  ProviderEvalOutcome,
  { status: 'completed'; operation: 'initial_plan' }
>;
type CompletedReplanOutcome = Extract<
  ProviderEvalOutcome,
  { status: 'completed'; operation: 'local_replan' }
>;
type FailedOutcome = Extract<ProviderEvalOutcome, { status: 'failed' }>;

export type ProviderEvalInvocationInput =
  | (Omit<InitialInvocation, 'packetSha256' | 'requestFingerprint' | 'goalProvenance'> & {
      readonly goalProvenance?: InitialInvocation['goalProvenance'];
    })
  | Omit<ReplanInvocation, 'packetSha256' | 'requestFingerprint' | 'goalProvenance'>;

export type ProviderEvalOutcomeInput =
  | Omit<CompletedInitialOutcome, 'resultSha256'>
  | Omit<CompletedReplanOutcome, 'resultSha256'>
  | Omit<FailedOutcome, 'errorSha256'>;

export type ProviderEvalRunInput = Omit<
  ProviderEvalRun,
  | 'invocation'
  | 'generationSettings'
  | 'runtimeAttestation'
  | 'outcome'
  | 'comparability'
  | 'integrity'
> & {
  readonly invocation: ProviderEvalInvocationInput;
  readonly generationSettings: Omit<ProviderEvalRun['generationSettings'], 'parametersSha256'>;
  readonly runtimeAttestation?: ProviderEvalRun['runtimeAttestation'];
  readonly outcome: ProviderEvalOutcomeInput;
  readonly reproducibility: ProviderEvalRun['comparability']['reproducibility'];
};

export function createProviderEvalRun(input: ProviderEvalRunInput): ProviderEvalRun {
  const baseInput = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'reproducibility'),
  );
  const goalProvenance =
    input.invocation.operation === 'initial_plan'
      ? (input.invocation.goalProvenance ?? null)
      : null;
  const invocation = {
    ...input.invocation,
    requestFingerprint: computeHumanEvalContentSha256(
      goalProvenance === null
        ? input.invocation.request
        : { request: input.invocation.request, ...goalProvenance },
    ),
    goalProvenance,
    packetSha256: computeHumanEvalContentSha256(input.invocation.packet),
  } as ProviderEvalInvocation;
  const generationSettings = {
    ...input.generationSettings,
    parametersSha256: computeHumanEvalContentSha256(input.generationSettings.normalizedParameters),
  };
  const outcome =
    input.outcome.status === 'completed'
      ? {
          ...input.outcome,
          resultSha256: computeHumanEvalContentSha256(input.outcome.result),
        }
      : {
          ...input.outcome,
          errorSha256: computeHumanEvalContentSha256(input.outcome.error),
        };
  const provisional = providerEvalRunSchema.parse({
    ...baseInput,
    invocation,
    generationSettings,
    outcome,
    comparability: {
      conditionSha256: '0'.repeat(64),
      treatmentSha256: '0'.repeat(64),
      reproducibility: input.reproducibility,
    },
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: '0'.repeat(64),
    },
  });
  const content = {
    ...provisional,
    comparability: {
      conditionSha256: computeProviderEvalConditionSha256(provisional),
      treatmentSha256: computeProviderEvalTreatmentSha256(provisional),
      reproducibility: input.reproducibility,
    },
  };
  const contentWithoutIntegrity = Object.fromEntries(
    Object.entries(content).filter(([key]) => key !== 'integrity'),
  );
  return providerEvalRunSchema.parse({
    ...contentWithoutIntegrity,
    integrity: createHumanEvalIntegrity(contentWithoutIntegrity),
  });
}
