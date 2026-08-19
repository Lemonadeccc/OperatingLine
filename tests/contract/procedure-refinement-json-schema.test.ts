import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  procedureRefinementCreateRequestSchema,
  procedureRefinementDialogueCompletedEventSchema,
  procedureRefinementDialogueFailedEventSchema,
  procedureRefinementDialogueProviderResultSchema,
  procedureRefinementDialogueRequestedEventSchema,
  procedureRefinementGenerationCompletedEventSchema,
  procedureRefinementGenerationFailedEventSchema,
  procedureRefinementGenerationRequestedEventSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementReviewedEventSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureRefinementSemanticContextReceiptRequestSchema,
  procedureRefinementScopeSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const sha = (character: string) => character.repeat(64);
const baseTree = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
) as { revision: number; rootNodeId: string };
const storedBaseTree = {
  sequence: 1,
  tree: baseTree,
  integrity: {
    algorithm: 'sha256',
    canonicalization: 'operatingline-json-value-v1',
    contentSha256: sha('a'),
  },
  storedAt: '2026-08-19T08:00:00Z',
} as const;
const providerDescriptor = {
  contractVersion: '1.0.0',
  id: 'refinement.example',
  version: '1.0.0',
  displayName: 'Example Procedure Refinement Provider',
  description: 'Provider-neutral procedure refinement contract fixture.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'remote',
    dataTransmission: 'provider_managed',
    credentialManagement: 'provider_managed',
  },
} as const;

function runtimeTreatment(operation: 'procedure_refinement_dialogue' | 'procedure_refinement') {
  return {
    formatVersion: '1.0.0',
    evidenceClass: 'runtime_attested_provider_treatment',
    operation,
    treatment: {
      profile: {
        descriptor: providerDescriptor,
        vendor: 'Example Vendor',
        implementation: { name: 'example-refinement-adapter', version: '1.0.0' },
        model: {
          requested: 'example-refinement-model',
          resolvedRevision: null,
          resolution: 'provider_did_not_disclose',
        },
        api: {
          surface: operation,
          version: 'v1',
          sdkName: 'example-sdk',
          sdkVersion: '1.0.0',
          endpointClass: 'vendor_public',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: { model: 'example-refinement-model' },
        parametersSha256: sha(operation === 'procedure_refinement' ? 'b' : 'c'),
        seed: null,
        determinism: 'non_deterministic',
      },
    },
    costPolicy: {
      possibleProviderCost: true,
      basis: 'provider_pricing',
      publicStatement: 'Calls may incur charges under provider pricing.',
    },
    treatmentContentSha256: sha(operation === 'procedure_refinement' ? 'd' : 'e'),
  } as const;
}

const createRequest = {
  formatVersion: '1.0.0',
  runId: '11111111-1111-4111-8111-111111111111',
  dialogueRequestId: '22222222-2222-4222-8222-222222222222',
  refinementRequestId: '33333333-3333-4333-8333-333333333333',
  baseTree: storedBaseTree,
  targetRevision: baseTree.revision + 1,
  requestedScopeRootIds: [baseTree.rootNodeId],
  semanticContext: {
    status: 'completed',
    requestId: '44444444-4444-4444-8444-444444444444',
    retrievalId: '55555555-5555-4555-8555-555555555555',
    resultContentSha256: sha('b'),
    completedEventContentSha256: sha('c'),
    completedAt: '2026-08-19T08:01:00Z',
  },
  instruction: 'Refine the selected root.',
  history: [],
  providerDisclosure: {
    providerDescriptor,
    dialogueRuntimeTreatment: runtimeTreatment('procedure_refinement_dialogue'),
    refinementRuntimeTreatment: runtimeTreatment('procedure_refinement'),
    inputPolicy: {
      exactStoredBaseTreeSent: true,
      exactSemanticRetrievalResultSent: true,
      instructionSent: true,
      dialogueHistorySent: true,
      credentialsIncludedInTaskPayload: false,
    },
  },
  authorization: {
    explicitlyConfirmedByUser: true,
    dataHandlingAcknowledged: true,
    possibleProviderCostAcknowledged: true,
    authorizedProviderCallLimit: 2,
    automaticRefinementAcknowledged: true,
    noHostExecutionAcknowledged: true,
    exactStoredBaseTreeDisclosed: true,
    exactSemanticContextDisclosed: true,
    dialogueAndRefinementRuntimeTreatmentsDisclosed: true,
    providerInputPolicy: {
      exactStoredBaseTreeSent: true,
      exactSemanticRetrievalResultSent: true,
      instructionSent: true,
      dialogueHistorySent: true,
      credentialsIncludedInTaskPayload: false,
    },
    confirmedAt: '2026-08-19T08:02:00Z',
  },
} as const;
const scope = {
  policyVersion: '1.0.0',
  requestedRootIds: ['root', 'root.child'],
  normalizedRootIds: ['root'],
  rules: {
    completeTreeRequired: true,
    topLevelIdentityMutable: false,
    outsideScopeMutable: false,
    scopeRootAttachmentMutable: false,
    descendantMoves: 'within_same_normalized_root',
    newNodes: 'within_normalized_roots',
    newCrossScopeDependencies: false,
    changedLeafInteractionTracks: 'unavailable',
    noOpAllowed: false,
  },
} as const;

const queuedStatus = {
  formatVersion: '1.0.0',
  runId: createRequest.runId,
  dialogueRequestId: createRequest.dialogueRequestId,
  refinementRequestId: createRequest.refinementRequestId,
  baseTree: createRequest.baseTree,
  targetRevision: createRequest.targetRevision,
  scope,
  semanticContext: createRequest.semanticContext,
  providerDisclosure: createRequest.providerDisclosure,
  status: 'queued',
  terminal: false,
  assistantMessage: '',
  assistantMessageRevision: 0,
  semanticDecision: null,
  preview: null,
  review: null,
  storedTree: null,
  needsRevision: null,
  error: null,
  sideEffects: {
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  updatedAt: '2026-08-19T08:02:00Z',
} as const;

const binding = {
  runRequestContentSha256: sha('1'),
  baseTreeContentSha256: sha('2'),
  targetTreeContentSha256: sha('3'),
  scopeContentSha256: sha('4'),
  semanticContextContentSha256: sha('5'),
  assistantMessageContentSha256: sha('6'),
  refinementPacketContentSha256: sha('7'),
  providerOutputContentSha256: sha('8'),
  localityReportContentSha256: sha('9'),
} as const;

describe('public Procedure refinement JSON Schemas', () => {
  it('publishes the strict semantic completion receipt handoff', async () => {
    const requestCases = [
      {
        value: {
          formatVersion: '1.0.0',
          requestId: createRequest.semanticContext.requestId,
        },
        accepted: true,
      },
      {
        value: {
          formatVersion: '1.0.0',
          requestId: createRequest.semanticContext.requestId,
          unexpected: true,
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of requestCases) {
      expect(
        procedureRefinementSemanticContextReceiptRequestSchema.safeParse(contractCase.value)
          .success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-semantic-context-receipt-request.schema.json'),
      requestCases,
    );

    const receiptCases = [
      { value: createRequest.semanticContext, accepted: true },
      {
        value: { ...createRequest.semanticContext, completedEventContentSha256: 'invalid' },
        accepted: false,
      },
    ] as const;
    for (const contractCase of receiptCases) {
      expect(
        procedureRefinementSemanticContextBindingSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-semantic-context-receipt.schema.json'),
      receiptCases,
    );
  });

  it('publishes core run status state-machine relations', async () => {
    const cases = [
      { value: queuedStatus, accepted: true },
      { value: { ...queuedStatus, terminal: true }, accepted: false },
      {
        value: {
          ...queuedStatus,
          status: 'completed',
          terminal: true,
          semanticDecision: { kind: 'refine', confidence: 0.8, threshold: 0.8 },
          sideEffects: { ...queuedStatus.sideEffects, procedureStored: true },
        },
        accepted: false,
      },
      {
        value: {
          ...queuedStatus,
          status: 'failed',
          terminal: true,
        },
        accepted: false,
      },
      {
        value: {
          ...queuedStatus,
          sideEffects: { ...queuedStatus.sideEffects, procedureStored: true },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureRefinementRunStatusSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-run-status.schema.json'),
      cases,
    );
  });

  it('publishes a strict normalized scope contract', async () => {
    const cases = [
      { value: scope, accepted: true },
      { value: { ...scope, unexpected: true }, accepted: false },
      {
        value: {
          ...scope,
          rules: { ...scope.rules, outsideScopeMutable: true },
        },
        accepted: false,
      },
      { value: { ...scope, requestedRootIds: [] }, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureRefinementScopeSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-scope.schema.json'),
      cases,
    );

    const structurallyValidButRelationallyInvalid = {
      ...scope,
      normalizedRootIds: ['not.requested'],
    };
    expect(
      procedureRefinementScopeSchema.safeParse(structurallyValidButRelationallyInvalid).success,
    ).toBe(false);
    await validatePublicJsonSchemaCases(publicSchema('procedure-refinement-scope.schema.json'), [
      { value: structurallyValidButRelationallyInvalid, accepted: true },
    ]);
  });

  it('documents authorization ordering as a runtime-only relation', async () => {
    const schema = publicSchema('procedure-refinement-create-request.schema.json') as Record<
      string,
      unknown
    >;
    expect(schema.description).toContain('authorization.confirmedAt');
    expect(schema.$comment).toContain(
      'authorization.confirmedAt must be greater than or equal to semanticContext.completedAt',
    );

    const staleAuthorization = {
      ...createRequest,
      authorization: {
        ...createRequest.authorization,
        confirmedAt: '2026-08-19T08:00:00Z',
      },
    };
    expect(procedureRefinementCreateRequestSchema.safeParse(staleAuthorization).success).toBe(
      false,
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-create-request.schema.json'),
      [{ value: staleAuthorization, accepted: true }],
    );
  });

  it('publishes the exact 0.8 dialogue decision boundary', async () => {
    const cases = [
      {
        value: {
          assistantMessage: 'No tree change is required.',
          decision: { kind: 'answer', confidence: 0.79, threshold: 0.8 },
        },
        accepted: true,
      },
      {
        value: {
          assistantMessage: 'A scoped refinement is appropriate.',
          decision: { kind: 'refine', confidence: 0.8, threshold: 0.8 },
        },
        accepted: true,
      },
      {
        value: {
          assistantMessage: 'Wrong branch.',
          decision: { kind: 'answer', confidence: 0.8, threshold: 0.8 },
        },
        accepted: false,
      },
      {
        value: {
          assistantMessage: 'Wrong threshold.',
          decision: { kind: 'refine', confidence: 0.79, threshold: 0.8 },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(
        procedureRefinementDialogueProviderResultSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-dialogue-provider-result.schema.json'),
      cases,
    );
  });

  it('publishes exact store confirmations and a bounded discard alternative', async () => {
    const review = {
      formatVersion: '1.0.0',
      runId: '11111111-1111-4111-8111-111111111111',
      reviewId: '22222222-2222-4222-8222-222222222222',
      binding,
      decision: {
        kind: 'store',
        confirmations: {
          exactBaseTreeReviewed: true,
          exactTargetTreeReviewed: true,
          exactScopeReviewed: true,
          exactSemanticContextReviewed: true,
          exactProviderOutputReviewed: true,
          exactLocalityReportReviewed: true,
          noHostExecutionAcknowledged: true,
        },
      },
      reviewedAt: '2026-08-19T08:00:00Z',
    } as const;
    const cases = [
      { value: review, accepted: true },
      { value: { ...review, decision: { kind: 'discard' } }, accepted: true },
      {
        value: {
          ...review,
          decision: {
            ...review.decision,
            confirmations: { ...review.decision.confirmations, exactScopeReviewed: false },
          },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureRefinementReviewRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-review-request.schema.json'),
      cases,
    );
  });

  it('publishes a safe discriminated generation outcome without raw provider payload', async () => {
    const event = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement',
      runId: createRequest.runId,
      requestId: createRequest.refinementRequestId,
      requestFingerprint: sha('a'),
      providerId: providerDescriptor.id,
      providerVersion: providerDescriptor.version,
      packetContentSha256: binding.refinementPacketContentSha256,
      treatmentContentSha256:
        createRequest.providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
      outcome: {
        kind: 'invalid',
        providerOutputContentSha256: binding.providerOutputContentSha256,
        safeMessage: 'Provider output did not satisfy the Procedure contract.',
      },
      durationMs: 5,
      occurredAt: '2026-08-19T08:03:00Z',
    } as const;
    const cases = [
      { value: event, accepted: true },
      {
        value: {
          ...event,
          outcome: { ...event.outcome, rawProviderPayload: { credential: 'forbidden' } },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of cases) {
      expect(
        procedureRefinementGenerationCompletedEventSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-generation-completed-event.schema.json'),
      cases,
    );
  });

  it('publishes strict requested, completed, and failed provider evidence envelopes', async () => {
    const dialogueScope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId: createRequest.runId,
      requestId: createRequest.dialogueRequestId,
      requestFingerprint: sha('0'),
      providerId: providerDescriptor.id,
      providerVersion: providerDescriptor.version,
      packetContentSha256: sha('1'),
      treatmentContentSha256:
        createRequest.providerDisclosure.dialogueRuntimeTreatment.treatmentContentSha256,
    } as const;
    const generationScope = {
      ...dialogueScope,
      operation: 'procedure_refinement',
      requestId: createRequest.refinementRequestId,
      packetContentSha256: binding.refinementPacketContentSha256,
      treatmentContentSha256:
        createRequest.providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
    } as const;
    const cases = [
      {
        runtime: procedureRefinementDialogueRequestedEventSchema,
        filename: 'procedure-refinement-dialogue-requested-event.schema.json',
        value: { ...dialogueScope, occurredAt: '2026-08-19T08:02:01Z' },
      },
      {
        runtime: procedureRefinementDialogueCompletedEventSchema,
        filename: 'procedure-refinement-dialogue-completed-event.schema.json',
        value: {
          ...dialogueScope,
          resultContentSha256: sha('2'),
          result: {
            assistantMessage: 'A refinement is appropriate.',
            decision: { kind: 'refine', confidence: 0.9, threshold: 0.8 },
          },
          durationMs: 5,
          occurredAt: '2026-08-19T08:02:02Z',
        },
      },
      {
        runtime: procedureRefinementDialogueFailedEventSchema,
        filename: 'procedure-refinement-dialogue-failed-event.schema.json',
        value: {
          ...dialogueScope,
          error: { code: 'provider_call_failed', message: 'Safe failure.', retryable: true },
          durationMs: 5,
          occurredAt: '2026-08-19T08:02:02Z',
        },
      },
      {
        runtime: procedureRefinementGenerationRequestedEventSchema,
        filename: 'procedure-refinement-generation-requested-event.schema.json',
        value: { ...generationScope, occurredAt: '2026-08-19T08:02:03Z' },
      },
      {
        runtime: procedureRefinementGenerationFailedEventSchema,
        filename: 'procedure-refinement-generation-failed-event.schema.json',
        value: {
          ...generationScope,
          error: { code: 'provider_call_failed', message: 'Safe failure.', retryable: false },
          durationMs: 5,
          occurredAt: '2026-08-19T08:02:04Z',
        },
      },
    ] as const;
    for (const contractCase of cases) {
      expect(contractCase.runtime.safeParse(contractCase.value).success).toBe(true);
      await validatePublicJsonSchemaCases(publicSchema(contractCase.filename), [
        { value: contractCase.value, accepted: true },
        { value: { ...contractCase.value, unexpected: true }, accepted: false },
      ]);
    }
  });

  it('documents reviewed timestamp ordering as a runtime-only relation', async () => {
    const reviewRequest = {
      formatVersion: '1.0.0',
      runId: createRequest.runId,
      reviewId: '66666666-6666-4666-8666-666666666666',
      binding,
      decision: { kind: 'discard' },
      reviewedAt: '2026-08-19T08:04:00Z',
    } as const;
    const staleEvent = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_review',
      runId: createRequest.runId,
      reviewId: reviewRequest.reviewId,
      requestFingerprint: sha('f'),
      providerId: providerDescriptor.id,
      providerVersion: providerDescriptor.version,
      packetContentSha256: binding.refinementPacketContentSha256,
      treatmentContentSha256:
        createRequest.providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
      previewBinding: binding,
      reviewRequest,
      finalStatus: 'discarded',
      procedureStored: false,
      durationMs: 1,
      occurredAt: '2026-08-19T08:03:59Z',
    } as const;
    expect(procedureRefinementReviewedEventSchema.safeParse(staleEvent).success).toBe(false);
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-refinement-reviewed-event.schema.json'),
      [{ value: staleEvent, accepted: true }],
    );
  });
});
