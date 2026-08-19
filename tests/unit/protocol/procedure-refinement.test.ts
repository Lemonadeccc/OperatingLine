import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  plannerGenerationErrorCodeSchema,
  procedureRefinementConfidenceThreshold,
  procedureRefinementCreateRequestSchema,
  procedureRefinementDialogueCompletedEventSchema,
  procedureRefinementDialogueFailedEventSchema,
  procedureRefinementDialogueProviderResultSchema,
  procedureRefinementDialogueRequestedEventSchema,
  procedureRefinementGenerationCompletedEventSchema,
  procedureRefinementGenerationFailedEventSchema,
  procedureRefinementGenerationRequestedEventSchema,
  procedureRefinementLocalityReportSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementReviewedEventSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureRefinementSemanticContextReceiptRequestSchema,
  procedureRefinementScopeSchema,
  type ProcedureTree,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const sha = (character: string) => character.repeat(64);
const baseTree = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
) as ProcedureTree;
const leafId = baseTree.nodes.find((node) => node.kind === 'leaf')!.id;
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
  description: 'Provider-neutral procedure refinement test fixture.',
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

const providerDisclosure = {
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
} as const;

const rules = {
  completeTreeRequired: true,
  topLevelIdentityMutable: false,
  outsideScopeMutable: false,
  scopeRootAttachmentMutable: false,
  descendantMoves: 'within_same_normalized_root',
  newNodes: 'within_normalized_roots',
  newCrossScopeDependencies: false,
  changedLeafInteractionTracks: 'unavailable',
  noOpAllowed: false,
} as const;

const scope = {
  policyVersion: '1.0.0',
  requestedRootIds: [baseTree.rootNodeId, leafId],
  normalizedRootIds: [baseTree.rootNodeId],
  rules,
} as const;

function createRequest() {
  return {
    formatVersion: '1.0.0',
    runId: randomUUID(),
    dialogueRequestId: randomUUID(),
    refinementRequestId: randomUUID(),
    baseTree: storedBaseTree,
    targetRevision: baseTree.revision + 1,
    requestedScopeRootIds: [baseTree.rootNodeId, leafId],
    semanticContext: {
      status: 'completed',
      requestId: randomUUID(),
      retrievalId: randomUUID(),
      resultContentSha256: sha('f'),
      completedEventContentSha256: sha('0'),
      completedAt: '2026-08-19T08:00:30Z',
    },
    instruction: 'Make the eye slightly larger without changing unrelated steps.',
    history: [
      { role: 'user', message: 'Explain the current eye step.' },
      { role: 'assistant', message: 'It creates, positions, and renames a sphere.' },
    ],
    providerDisclosure,
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
      confirmedAt: '2026-08-19T08:01:00Z',
    },
  } as const;
}

function targetTree(): ProcedureTree {
  const target = structuredClone(baseTree);
  target.revision += 1;
  const leaf = target.nodes.find((node) => node.id === leafId)!;
  leaf.title = `${leaf.title} refined`;
  return target;
}

const binding = {
  runRequestContentSha256: sha('1'),
  baseTreeContentSha256: sha('a'),
  targetTreeContentSha256: sha('2'),
  scopeContentSha256: sha('3'),
  semanticContextContentSha256: sha('4'),
  assistantMessageContentSha256: sha('7'),
  refinementPacketContentSha256: sha('8'),
  providerOutputContentSha256: sha('5'),
  localityReportContentSha256: sha('6'),
} as const;

function localityReport() {
  return {
    policyVersion: '1.0.0',
    baseTree: { id: baseTree.id, revision: baseTree.revision },
    targetTree: { id: baseTree.id, revision: baseTree.revision + 1 },
    requestedRootIds: scope.requestedRootIds,
    normalizedRootIds: scope.normalizedRootIds,
    rules,
    findings: [],
    totalFindingCount: 0,
    changedNodeIds: [leafId],
    changedLeafIds: [leafId],
    newLeafIds: [],
    deletedLeafIds: [],
    unchangedLeafIds: [],
    valid: true,
  } as const;
}

function providerResult(runId: string, refinementRequestId: string) {
  const target = targetTree();
  return {
    formatVersion: '1.0.0',
    runId,
    refinementRequestId,
    treeId: target.id,
    targetRevision: target.revision,
    packetContentSha256: binding.refinementPacketContentSha256,
    providerOutputContentSha256: binding.providerOutputContentSha256,
    targetTreeContentSha256: binding.targetTreeContentSha256,
    targetTree: target,
  } as const;
}

describe('procedure refinement protocol', () => {
  it('exposes a distinct safe capability error for unsupported refinement providers', () => {
    expect(
      plannerGenerationErrorCodeSchema.parse('planner_procedure_refinement_not_supported'),
    ).toBe('planner_procedure_refinement_not_supported');
  });

  it('binds one explicit two-call authorization to a stored tree and completed semantic context', () => {
    const request = createRequest();
    expect(procedureRefinementCreateRequestSchema.parse(request)).toEqual(request);
    expect(
      procedureRefinementSemanticContextReceiptRequestSchema.parse({
        formatVersion: '1.0.0',
        requestId: request.semanticContext.requestId,
      }),
    ).toEqual({
      formatVersion: '1.0.0',
      requestId: request.semanticContext.requestId,
    });
    expect(procedureRefinementSemanticContextBindingSchema.parse(request.semanticContext)).toEqual(
      request.semanticContext,
    );
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        refinementRequestId: request.dialogueRequestId,
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        dialogueRequestId: request.semanticContext.requestId,
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        targetRevision: request.targetRevision + 1,
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        requestedScopeRootIds: ['missing.node'],
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        authorization: { ...request.authorization, authorizedProviderCallLimit: 3 },
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementCreateRequestSchema.safeParse({
        ...request,
        authorization: {
          ...request.authorization,
          confirmedAt: '2026-08-19T08:00:00Z',
        },
      }).success,
    ).toBe(false);
  });

  it('allows ancestor/descendant requests while exposing a non-overlapping normalized scope', () => {
    expect(procedureRefinementScopeSchema.parse(scope)).toEqual(scope);
    expect(
      procedureRefinementScopeSchema.safeParse({
        ...scope,
        normalizedRootIds: ['not.requested'],
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementScopeSchema.safeParse({
        ...scope,
        requestedRootIds: [leafId, leafId],
      }).success,
    ).toBe(false);
  });

  it('enforces the fixed semantic threshold and bounded non-empty dialogue output', () => {
    expect(
      procedureRefinementDialogueProviderResultSchema.safeParse({
        assistantMessage: 'I can answer without changing the tree.',
        decision: { kind: 'answer', confidence: 0.79, threshold: 0.8 },
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementDialogueProviderResultSchema.safeParse({
        assistantMessage: 'I will conservatively avoid changing the tree.',
        decision: { kind: 'answer', confidence: null, threshold: 0.8 },
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementDialogueProviderResultSchema.safeParse({
        assistantMessage: 'I will prepare a scoped tree revision.',
        decision: {
          kind: 'refine',
          confidence: procedureRefinementConfidenceThreshold,
          threshold: procedureRefinementConfidenceThreshold,
        },
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementDialogueProviderResultSchema.safeParse({
        assistantMessage: 'Wrong side of threshold.',
        decision: { kind: 'answer', confidence: 0.8, threshold: 0.8 },
      }).success,
    ).toBe(false);
  });

  it('requires disjoint locality classifications and findings exactly when invalid', () => {
    const report = localityReport();
    expect(procedureRefinementLocalityReportSchema.parse(report)).toEqual(report);
    expect(
      procedureRefinementLocalityReportSchema.safeParse({
        ...report,
        unchangedLeafIds: [leafId],
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementLocalityReportSchema.safeParse({
        ...report,
        valid: false,
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementLocalityReportSchema.safeParse({
        ...report,
        targetTree: { id: report.targetTree.id, revision: report.baseTree.revision },
        findings: [
          {
            code: 'target_revision_invalid',
            message: 'Target revision must advance by exactly one.',
            nodeIds: [],
          },
        ],
        totalFindingCount: 1,
        valid: false,
      }).success,
    ).toBe(true);
  });

  it('binds store review to every exact preview hash and keeps discard confirmation-free', () => {
    const request = createRequest();
    const store = {
      formatVersion: '1.0.0',
      runId: request.runId,
      reviewId: randomUUID(),
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
      reviewedAt: '2026-08-19T08:02:00Z',
    } as const;
    expect(procedureRefinementReviewRequestSchema.parse(store)).toEqual(store);
    expect(
      procedureRefinementReviewRequestSchema.safeParse({
        ...store,
        decision: {
          ...store.decision,
          confirmations: {
            ...store.decision.confirmations,
            exactScopeReviewed: false,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementReviewRequestSchema.safeParse({
        ...store,
        decision: { kind: 'discard' },
      }).success,
    ).toBe(true);
  });

  it('persists strict dialogue and generation evidence without retaining invalid raw output', () => {
    const request = createRequest();
    const provider = providerDescriptor;
    const dialogueScope = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_dialogue',
      runId: request.runId,
      requestId: request.dialogueRequestId,
      requestFingerprint: sha('1'),
      providerId: provider.id,
      providerVersion: provider.version,
      packetContentSha256: sha('2'),
      treatmentContentSha256: providerDisclosure.dialogueRuntimeTreatment.treatmentContentSha256,
    } as const;
    expect(
      procedureRefinementDialogueRequestedEventSchema.safeParse({
        ...dialogueScope,
        occurredAt: '2026-08-19T08:01:01Z',
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementDialogueRequestedEventSchema.safeParse({
        ...dialogueScope,
        requestId: request.runId,
        occurredAt: '2026-08-19T08:01:01Z',
      }).success,
    ).toBe(false);
    const dialogueResult = {
      assistantMessage: 'I prepared a local refinement.',
      decision: { kind: 'refine', confidence: 0.9, threshold: 0.8 },
    } as const;
    expect(
      procedureRefinementDialogueCompletedEventSchema.safeParse({
        ...dialogueScope,
        resultContentSha256: sha('3'),
        result: dialogueResult,
        durationMs: 120,
        occurredAt: '2026-08-19T08:01:02Z',
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementDialogueFailedEventSchema.safeParse({
        ...dialogueScope,
        error: { code: 'provider_call_failed', message: 'Safe failure.', retryable: true },
        durationMs: 120,
        occurredAt: '2026-08-19T08:01:02Z',
      }).success,
    ).toBe(true);

    const generationScope = {
      ...dialogueScope,
      operation: 'procedure_refinement',
      requestId: request.refinementRequestId,
      packetContentSha256: binding.refinementPacketContentSha256,
      treatmentContentSha256: providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
    } as const;
    expect(
      procedureRefinementGenerationRequestedEventSchema.safeParse({
        ...generationScope,
        occurredAt: '2026-08-19T08:01:03Z',
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementGenerationCompletedEventSchema.safeParse({
        ...generationScope,
        outcome: {
          kind: 'valid',
          providerResult: providerResult(request.runId, request.refinementRequestId),
        },
        durationMs: 240,
        occurredAt: '2026-08-19T08:01:04Z',
      }).success,
    ).toBe(true);
    const invalid = {
      ...generationScope,
      outcome: {
        kind: 'invalid',
        providerOutputContentSha256: sha('9'),
        safeMessage: 'Provider output did not satisfy the Procedure contract.',
      },
      durationMs: 240,
      occurredAt: '2026-08-19T08:01:04Z',
    } as const;
    expect(procedureRefinementGenerationCompletedEventSchema.safeParse(invalid).success).toBe(true);
    expect(
      procedureRefinementGenerationCompletedEventSchema.safeParse({
        ...invalid,
        outcome: { ...invalid.outcome, rawProviderPayload: { secret: 'must not persist' } },
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementGenerationFailedEventSchema.safeParse({
        ...generationScope,
        error: { code: 'provider_call_failed', message: 'Safe failure.', retryable: false },
        durationMs: 240,
        occurredAt: '2026-08-19T08:01:04Z',
      }).success,
    ).toBe(true);
  });

  it('binds reviewed evidence to the complete request, preview, and final side effect', () => {
    const request = createRequest();
    const reviewRequest = {
      formatVersion: '1.0.0',
      runId: request.runId,
      reviewId: randomUUID(),
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
      reviewedAt: '2026-08-19T08:04:00Z',
    } as const;
    const event = {
      formatVersion: '1.0.0',
      operation: 'procedure_refinement_review',
      runId: request.runId,
      reviewId: reviewRequest.reviewId,
      requestFingerprint: sha('0'),
      providerId: providerDescriptor.id,
      providerVersion: providerDescriptor.version,
      packetContentSha256: binding.refinementPacketContentSha256,
      treatmentContentSha256: providerDisclosure.refinementRuntimeTreatment.treatmentContentSha256,
      previewBinding: binding,
      reviewRequest,
      finalStatus: 'completed',
      procedureStored: true,
      durationMs: 10,
      occurredAt: '2026-08-19T08:04:01Z',
    } as const;
    expect(procedureRefinementReviewedEventSchema.safeParse(event).success).toBe(true);
    expect(
      procedureRefinementReviewedEventSchema.safeParse({
        ...event,
        finalStatus: 'discarded',
      }).success,
    ).toBe(false);
  });

  it('exposes cumulative streaming state and stores only a reviewed completed target', () => {
    const request = createRequest();
    const queued = {
      formatVersion: '1.0.0',
      runId: request.runId,
      dialogueRequestId: request.dialogueRequestId,
      refinementRequestId: request.refinementRequestId,
      baseTree: storedBaseTree,
      targetRevision: baseTree.revision + 1,
      scope,
      semanticContext: request.semanticContext,
      providerDisclosure,
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
      updatedAt: '2026-08-19T08:03:00Z',
    } as const;
    expect(procedureRefinementRunStatusSchema.safeParse(queued).success).toBe(true);
    expect(
      procedureRefinementRunStatusSchema.safeParse({
        ...queued,
        status: 'streaming',
        assistantMessage: 'A cumulative streamed answer.',
        assistantMessageRevision: 2,
      }).success,
    ).toBe(true);

    const target = targetTree();
    const preview = {
      targetTree: target,
      providerResult: providerResult(request.runId, request.refinementRequestId),
      localityReport: localityReport(),
      binding,
      reviewReadyAt: '2026-08-19T08:02:59Z',
    };
    const awaiting = {
      ...queued,
      status: 'awaiting_review',
      assistantMessage: 'I prepared a scoped revision for review.',
      assistantMessageRevision: 3,
      semanticDecision: { kind: 'refine', confidence: 0.91, threshold: 0.8 },
      preview,
    } as const;
    expect(procedureRefinementRunStatusSchema.safeParse(awaiting).success).toBe(true);
    const rawProviderTarget = structuredClone(preview.providerResult.targetTree);
    rawProviderTarget.nodes.find((node) => node.id === leafId)!.title += ' before sanitization';
    expect(
      procedureRefinementRunStatusSchema.safeParse({
        ...awaiting,
        preview: {
          ...preview,
          providerResult: {
            ...preview.providerResult,
            targetTree: rawProviderTarget,
            targetTreeContentSha256: sha('f'),
          },
        },
      }).success,
    ).toBe(true);
    expect(
      procedureRefinementRunStatusSchema.safeParse({
        ...awaiting,
        preview: {
          ...preview,
          providerResult: {
            ...preview.providerResult,
            packetContentSha256: sha('0'),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      procedureRefinementRunStatusSchema.safeParse({
        ...awaiting,
        sideEffects: { ...awaiting.sideEffects, procedureStored: true },
      }).success,
    ).toBe(false);

    const completed = {
      ...awaiting,
      status: 'completed',
      terminal: true,
      review: { reviewId: randomUUID(), decision: 'store', reviewedAt: '2026-08-19T08:04:00Z' },
      storedTree: {
        sequence: 2,
        tree: target,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: binding.targetTreeContentSha256,
        },
        storedAt: '2026-08-19T08:04:01Z',
      },
      sideEffects: { ...awaiting.sideEffects, procedureStored: true },
    } as const;
    expect(procedureRefinementRunStatusSchema.safeParse(completed).success).toBe(true);
    expect(
      procedureRefinementRunStatusSchema.safeParse({
        ...completed,
        review: { ...completed.review, decision: 'discard' },
      }).success,
    ).toBe(false);
  });
});
