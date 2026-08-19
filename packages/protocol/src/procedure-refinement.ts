import { z } from 'zod';

import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import { evalContentSha256Schema } from './eval-common.js';
import { guideStepIdSchema } from './guide.js';
import { procedureSemanticRetrievalResultSchema } from './procedure-semantic-retrieval.js';
import { procedureTreeSchema, storedProcedureTreeSchema } from './procedure-tree.js';
import {
  plannerProviderCostPolicySchema,
  plannerProviderDescriptorSchema,
  plannerProviderRuntimeTreatmentSchema,
} from './provider.js';

export const procedureRefinementFormatVersion = '1.0.0' as const;
export const procedureRefinementFormatVersionSchema = z.literal(procedureRefinementFormatVersion);
export const procedureRefinementConfidenceThreshold = 0.8 as const;
export const procedureRefinementConfidenceThresholdSchema = z.literal(
  procedureRefinementConfidenceThreshold,
);
export const procedureRefinementMaximumAssistantMessageCharacters = 4_000 as const;
export const procedureRefinementMaximumInstructionCharacters = 10_000 as const;

const timestampSchema = z.iso.datetime({ offset: true });
const availableProviderDescriptorSchema = plannerProviderDescriptorSchema.extend({
  availability: z.strictObject({ available: z.literal(true) }),
});

export const procedureRefinementDialogueHistoryMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  message: z.string().trim().min(1).max(procedureRefinementMaximumAssistantMessageCharacters),
});
export type ProcedureRefinementDialogueHistoryMessage = z.infer<
  typeof procedureRefinementDialogueHistoryMessageSchema
>;

export const procedureRefinementProviderRuntimeTreatmentAttestationSchema = z.strictObject({
  formatVersion: procedureRefinementFormatVersionSchema,
  evidenceClass: z.literal('runtime_attested_provider_treatment'),
  operation: z.enum(['procedure_refinement_dialogue', 'procedure_refinement']),
  treatment: plannerProviderRuntimeTreatmentSchema,
  costPolicy: plannerProviderCostPolicySchema,
  treatmentContentSha256: evalContentSha256Schema,
});
export type ProcedureRefinementProviderRuntimeTreatmentAttestation = z.infer<
  typeof procedureRefinementProviderRuntimeTreatmentAttestationSchema
>;

const procedureRefinementDialogueRuntimeTreatmentAttestationSchema =
  procedureRefinementProviderRuntimeTreatmentAttestationSchema.extend({
    operation: z.literal('procedure_refinement_dialogue'),
  });
const procedureRefinementGenerationRuntimeTreatmentAttestationSchema =
  procedureRefinementProviderRuntimeTreatmentAttestationSchema.extend({
    operation: z.literal('procedure_refinement'),
  });

export const procedureRefinementProviderInputPolicySchema = z.strictObject({
  exactStoredBaseTreeSent: z.literal(true),
  exactSemanticRetrievalResultSent: z.literal(true),
  instructionSent: z.literal(true),
  dialogueHistorySent: z.literal(true),
  credentialsIncludedInTaskPayload: z.literal(false),
});
export type ProcedureRefinementProviderInputPolicy = z.infer<
  typeof procedureRefinementProviderInputPolicySchema
>;

export const procedureRefinementProviderDisclosureSchema = z
  .strictObject({
    providerDescriptor: availableProviderDescriptorSchema,
    dialogueRuntimeTreatment: procedureRefinementDialogueRuntimeTreatmentAttestationSchema,
    refinementRuntimeTreatment: procedureRefinementGenerationRuntimeTreatmentAttestationSchema,
    inputPolicy: procedureRefinementProviderInputPolicySchema,
  })
  .superRefine((disclosure, context) => {
    for (const field of ['dialogueRuntimeTreatment', 'refinementRuntimeTreatment'] as const) {
      if (
        !sameProtocolValue(
          disclosure.providerDescriptor,
          disclosure[field].treatment.profile.descriptor,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: [field, 'treatment', 'profile', 'descriptor'],
          message: 'Provider descriptor must match both exact runtime treatment profiles',
        });
      }
    }
  });
export type ProcedureRefinementProviderDisclosure = z.infer<
  typeof procedureRefinementProviderDisclosureSchema
>;

export const procedureRefinementProviderDisclosureListSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    refinementAvailable: z.boolean(),
    providers: z.array(procedureRefinementProviderDisclosureSchema).meta({ uniqueItems: true }),
  })
  .superRefine((list, context) => {
    const providerIds = list.providers.map((provider) => provider.providerDescriptor.id);
    if (new Set(providerIds).size !== providerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'Provider ids must be unique',
      });
    }
    if (list.refinementAvailable !== list.providers.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['refinementAvailable'],
        message: 'refinementAvailable must match whether an available provider is disclosed',
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { providers: { minItems: 1 } }, required: ['providers'] },
        then: {
          properties: { refinementAvailable: { const: true } },
          required: ['refinementAvailable'],
        },
        else: {
          properties: { refinementAvailable: { const: false } },
          required: ['refinementAvailable'],
        },
      },
    ],
  });
export type ProcedureRefinementProviderDisclosureList = z.infer<
  typeof procedureRefinementProviderDisclosureListSchema
>;

export const procedureRefinementSemanticContextBindingSchema = z.strictObject({
  status: z.literal('completed'),
  requestId: z.uuid(),
  retrievalId: z.uuid(),
  resultContentSha256: evalContentSha256Schema,
  completedEventContentSha256: evalContentSha256Schema,
  completedAt: timestampSchema,
});
export type ProcedureRefinementSemanticContextBinding = z.infer<
  typeof procedureRefinementSemanticContextBindingSchema
>;

export const procedureRefinementSemanticContextReceiptRequestSchema = z.strictObject({
  formatVersion: procedureRefinementFormatVersionSchema,
  requestId: z.uuid(),
});
export type ProcedureRefinementSemanticContextReceiptRequest = z.infer<
  typeof procedureRefinementSemanticContextReceiptRequestSchema
>;

const requestedScopeRootIdsSchema = z
  .array(guideStepIdSchema)
  .min(1)
  .max(8)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Requested scope root ids must be unique' });
    }
  })
  .meta({ uniqueItems: true });

export const procedureRefinementScopePolicyVersion = '1.0.0' as const;

export const procedureRefinementScopeRulesSchema = z.strictObject({
  completeTreeRequired: z.literal(true),
  topLevelIdentityMutable: z.literal(false),
  outsideScopeMutable: z.literal(false),
  scopeRootAttachmentMutable: z.literal(false),
  descendantMoves: z.literal('within_same_normalized_root'),
  newNodes: z.literal('within_normalized_roots'),
  newCrossScopeDependencies: z.literal(false),
  changedLeafInteractionTracks: z.literal('unavailable'),
  noOpAllowed: z.literal(false),
});

export const procedureRefinementScopeFindingSchema = z.strictObject({
  code: z.enum([
    'target_revision_invalid',
    'immutable_tree_field_changed',
    'scope_root_unknown',
    'scope_root_missing',
    'scope_root_attachment_changed',
    'node_changed_outside_scope',
    'node_added_outside_scope',
    'node_moved_across_scope',
    'node_kind_changed',
    'dependency_added_across_scope',
    'no_local_change',
    'findings_truncated',
  ]),
  message: z.string().trim().min(1).max(1_000),
  nodeIds: z.array(guideStepIdSchema).max(256),
});
export type ProcedureRefinementScopeFinding = z.infer<typeof procedureRefinementScopeFindingSchema>;

export const procedureRefinementScopeSchema = z
  .strictObject({
    policyVersion: z.literal(procedureRefinementScopePolicyVersion),
    requestedRootIds: requestedScopeRootIdsSchema,
    normalizedRootIds: z.array(guideStepIdSchema).min(1).max(8).meta({ uniqueItems: true }),
    rules: procedureRefinementScopeRulesSchema,
  })
  .superRefine((scope, context) => {
    if (new Set(scope.normalizedRootIds).size !== scope.normalizedRootIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedRootIds'],
        message: 'Normalized scope root ids must be unique',
      });
    }
    if (scope.normalizedRootIds.some((id) => !scope.requestedRootIds.includes(id))) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedRootIds'],
        message: 'Normalized scope roots must be selected from requested scope roots',
      });
    }
  })
  .meta({
    description:
      'Server-produced normalized scope. Standard JSON Schema validates structure and uniqueness; the protocol parser/runtime additionally enforces that normalizedRootIds is a subset of requestedRootIds.',
    $comment: 'Runtime invariant: normalizedRootIds must be selected from requestedRootIds.',
  });
export type ProcedureRefinementScope = z.infer<typeof procedureRefinementScopeSchema>;

const leafIdSetSchema = z.array(guideStepIdSchema).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Leaf ids must be unique' });
  }
});

export const procedureRefinementLocalityReportSchema = z
  .strictObject({
    policyVersion: z.literal(procedureRefinementScopePolicyVersion),
    baseTree: z.strictObject({ id: guideStepIdSchema, revision: z.number().int().positive() }),
    targetTree: z.strictObject({ id: guideStepIdSchema, revision: z.number().int().positive() }),
    requestedRootIds: requestedScopeRootIdsSchema,
    normalizedRootIds: z.array(guideStepIdSchema).min(1).max(8).meta({ uniqueItems: true }),
    rules: procedureRefinementScopeRulesSchema,
    findings: z.array(procedureRefinementScopeFindingSchema).max(256),
    totalFindingCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    changedNodeIds: leafIdSetSchema,
    changedLeafIds: leafIdSetSchema,
    newLeafIds: leafIdSetSchema,
    deletedLeafIds: leafIdSetSchema,
    unchangedLeafIds: leafIdSetSchema,
    valid: z.boolean(),
  })
  .superRefine((report, context) => {
    const classified = [
      ...report.changedLeafIds,
      ...report.newLeafIds,
      ...report.deletedLeafIds,
      ...report.unchangedLeafIds,
    ];
    if (new Set(classified).size !== classified.length) {
      context.addIssue({
        code: 'custom',
        message: 'A leaf id may appear in exactly one locality classification',
      });
    }
    if (report.valid !== (report.totalFindingCount === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['valid'],
        message: 'Locality validity must match the total finding count',
      });
    }
    const lastFinding = report.findings.at(-1);
    if (report.totalFindingCount < report.findings.length) {
      context.addIssue({
        code: 'custom',
        path: ['totalFindingCount'],
        message: 'Total finding count cannot be smaller than returned findings',
      });
    }
    if (
      report.totalFindingCount > report.findings.length !==
      (lastFinding?.code === 'findings_truncated')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Truncated locality findings require one final findings_truncated marker',
      });
    }
    if (report.valid && report.baseTree.id !== report.targetTree.id) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree', 'id'],
        message: 'Locality report base and target tree ids must match',
      });
    }
    if (report.valid && report.targetTree.revision !== report.baseTree.revision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree', 'revision'],
        message: 'Locality report target revision must be exactly base revision plus one',
      });
    }
    if (report.normalizedRootIds.some((id) => !report.requestedRootIds.includes(id))) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedRootIds'],
        message: 'Normalized roots must be selected from requested roots',
      });
    }
  });
export type ProcedureRefinementLocalityReport = z.infer<
  typeof procedureRefinementLocalityReportSchema
>;

export const procedureRefinementCreateRequestSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    runId: z.uuid(),
    dialogueRequestId: z.uuid(),
    refinementRequestId: z.uuid(),
    baseTree: storedProcedureTreeSchema,
    targetRevision: z.number().int().min(2),
    requestedScopeRootIds: requestedScopeRootIdsSchema,
    semanticContext: procedureRefinementSemanticContextBindingSchema,
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(procedureRefinementMaximumInstructionCharacters)
      .regex(/\S/),
    history: z.array(procedureRefinementDialogueHistoryMessageSchema).max(12),
    providerDisclosure: procedureRefinementProviderDisclosureSchema,
    authorization: z.strictObject({
      explicitlyConfirmedByUser: z.literal(true),
      dataHandlingAcknowledged: z.literal(true),
      possibleProviderCostAcknowledged: z.literal(true),
      authorizedProviderCallLimit: z.literal(2),
      automaticRefinementAcknowledged: z.literal(true),
      noHostExecutionAcknowledged: z.literal(true),
      exactStoredBaseTreeDisclosed: z.literal(true),
      exactSemanticContextDisclosed: z.literal(true),
      dialogueAndRefinementRuntimeTreatmentsDisclosed: z.literal(true),
      providerInputPolicy: procedureRefinementProviderInputPolicySchema,
      confirmedAt: timestampSchema,
    }),
  })
  .superRefine((request, context) => {
    if (
      new Set([
        request.runId,
        request.dialogueRequestId,
        request.refinementRequestId,
        request.semanticContext.requestId,
      ]).size !== 4
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Run, semantic retrieval, dialogue, and refinement request ids must be distinct',
      });
    }
    if (request.targetRevision !== request.baseTree.tree.revision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['targetRevision'],
        message: 'Target revision must be exactly one greater than the stored base revision',
      });
    }
    if (
      new Date(request.authorization.confirmedAt).getTime() <
      new Date(request.semanticContext.completedAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'confirmedAt'],
        message:
          'Procedure refinement authorization must follow the completed semantic context receipt',
      });
    }
    if (
      !sameProtocolValue(
        request.authorization.providerInputPolicy,
        request.providerDisclosure.inputPolicy,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'providerInputPolicy'],
        message: 'Authorized provider input policy must exactly match the disclosed policy',
      });
    }
    const nodeIds = new Set(request.baseTree.tree.nodes.map((node) => node.id));
    for (const [index, rootId] of request.requestedScopeRootIds.entries()) {
      if (!nodeIds.has(rootId)) {
        context.addIssue({
          code: 'custom',
          path: ['requestedScopeRootIds', index],
          message: 'Every requested scope root must exist in the stored base tree',
        });
      }
    }
    validateCompletedHistory(request.history, context, ['history']);
  })
  .meta({
    description:
      'Authorized procedure-refinement request. Standard JSON Schema validates timestamp shape; the protocol parser/runtime additionally enforces that authorization.confirmedAt is not earlier than semanticContext.completedAt.',
    $comment:
      'Runtime invariant: authorization.confirmedAt must be greater than or equal to semanticContext.completedAt.',
  });
export type ProcedureRefinementCreateRequest = z.infer<
  typeof procedureRefinementCreateRequestSchema
>;

export const procedureRefinementDialogueDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('answer'),
    confidence: z.number().min(0).lt(procedureRefinementConfidenceThreshold).nullable(),
    threshold: procedureRefinementConfidenceThresholdSchema,
  }),
  z.strictObject({
    kind: z.literal('refine'),
    confidence: z.number().min(procedureRefinementConfidenceThreshold).max(1),
    threshold: procedureRefinementConfidenceThresholdSchema,
  }),
]);
export type ProcedureRefinementDialogueDecision = z.infer<
  typeof procedureRefinementDialogueDecisionSchema
>;

export const procedureRefinementDialogueProviderResultSchema = z.strictObject({
  assistantMessage: z
    .string()
    .max(procedureRefinementMaximumAssistantMessageCharacters)
    .regex(/\S/),
  decision: procedureRefinementDialogueDecisionSchema,
});
export type ProcedureRefinementDialogueProviderResult = z.infer<
  typeof procedureRefinementDialogueProviderResultSchema
>;

const promptIntegritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: evalContentSha256Schema,
});

const promptContextShape = {
  runId: z.uuid(),
  baseTree: storedProcedureTreeSchema,
  targetRevision: z.number().int().min(2),
  scope: procedureRefinementScopeSchema,
  semanticRetrieval: procedureSemanticRetrievalResultSchema,
  instruction: z.string().trim().min(1).max(procedureRefinementMaximumInstructionCharacters),
  history: z.array(procedureRefinementDialogueHistoryMessageSchema).max(12),
} as const;

export const procedureRefinementDialoguePromptPacketSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    operation: z.literal('procedure_refinement_dialogue'),
    requestId: z.uuid(),
    context: z.strictObject(promptContextShape),
    workflow: z.strictObject({
      refinementToolName: z.literal('request_procedure_refinement'),
      confidenceThreshold: procedureRefinementConfidenceThresholdSchema,
      maximumProviderCalls: z.literal(2),
      instructions: z.array(z.string().trim().min(1)).min(1).max(32),
    }),
    renderedPrompt: z.string().trim().min(1).max(128_000),
    integrity: promptIntegritySchema,
  })
  .superRefine(validatePromptPacket);
export type ProcedureRefinementDialoguePromptPacket = z.infer<
  typeof procedureRefinementDialoguePromptPacketSchema
>;

export const procedureRefinementPromptPacketSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    operation: z.literal('procedure_refinement'),
    requestId: z.uuid(),
    context: z.strictObject({
      ...promptContextShape,
      dialogueResult: procedureRefinementDialogueProviderResultSchema,
    }),
    workflow: z.strictObject({
      responseFormat: z.literal('complete_procedure_tree'),
      localityRules: procedureRefinementScopeRulesSchema,
      changedLeafValidationStatus: z.literal('candidate'),
      changedLeafValidatedHostVersions: z.tuple([]),
      changedLeafInteractionTracks: z.literal('unavailable'),
      proposalCreationAllowed: z.literal(false),
      hostExecutionAllowed: z.literal(false),
      instructions: z.array(z.string().trim().min(1)).min(1).max(32),
    }),
    renderedPrompt: z.string().trim().min(1).max(256_000),
    integrity: promptIntegritySchema,
  })
  .superRefine((packet, context) => {
    validatePromptPacket(packet, context);
    if (packet.context.dialogueResult.decision.kind !== 'refine') {
      context.addIssue({
        code: 'custom',
        path: ['context', 'dialogueResult', 'decision'],
        message: 'A refinement prompt requires a threshold-approved refine decision',
      });
    }
    if (!sameProtocolValue(packet.workflow.localityRules, packet.context.scope.rules)) {
      context.addIssue({
        code: 'custom',
        path: ['workflow', 'localityRules'],
        message: 'Refinement prompt must preserve the normalized scope locality rules',
      });
    }
  });
export type ProcedureRefinementPromptPacket = z.infer<typeof procedureRefinementPromptPacketSchema>;

export const procedureRefinementProviderResultSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    runId: z.uuid(),
    refinementRequestId: z.uuid(),
    treeId: guideStepIdSchema,
    targetRevision: z.number().int().min(2),
    packetContentSha256: evalContentSha256Schema,
    providerOutputContentSha256: evalContentSha256Schema,
    targetTreeContentSha256: evalContentSha256Schema,
    targetTree: procedureTreeSchema,
  })
  .superRefine((result, context) => {
    if (result.runId === result.refinementRequestId) {
      context.addIssue({
        code: 'custom',
        path: ['refinementRequestId'],
        message: 'Refinement provider request id must differ from run id',
      });
    }
    if (
      result.targetTree.id !== result.treeId ||
      result.targetTree.revision !== result.targetRevision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetTree'],
        message: 'Provider target tree must match the bound tree id and target revision',
      });
    }
  })
  .meta({
    description:
      'Parsed provider result before local scope sanitization. The coordinator must recompute targetTreeContentSha256 from this exact targetTree before accepting the result.',
    $comment:
      'Runtime invariant: targetTreeContentSha256 is the canonical SHA-256 of this providerResult.targetTree, not the later sanitized preview target.',
  });
export type ProcedureRefinementProviderResult = z.infer<
  typeof procedureRefinementProviderResultSchema
>;

const procedureRefinementProviderEvidenceScopeShape = {
  formatVersion: procedureRefinementFormatVersionSchema,
  runId: z.uuid(),
  requestId: z.uuid(),
  requestFingerprint: evalContentSha256Schema,
  providerId: plannerProviderDescriptorSchema.shape.id,
  providerVersion: plannerProviderDescriptorSchema.shape.version,
  packetContentSha256: evalContentSha256Schema,
  treatmentContentSha256: evalContentSha256Schema,
} as const;

const procedureRefinementEvidenceFailureSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .regex(/^[a-z0-9_]+$/),
  message: z.string().trim().min(1).max(1_000).regex(/\S/),
  retryable: z.boolean(),
});

function validateProviderEvidenceIds(
  event: { runId: string; requestId: string },
  context: z.RefinementCtx,
): void {
  if (event.runId === event.requestId) {
    context.addIssue({
      code: 'custom',
      path: ['requestId'],
      message: 'Provider request id must differ from run id',
    });
  }
}

export const procedureRefinementDialogueRequestedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement_dialogue'),
    occurredAt: timestampSchema,
  })
  .superRefine(validateProviderEvidenceIds);
export type ProcedureRefinementDialogueRequestedEvent = z.infer<
  typeof procedureRefinementDialogueRequestedEventSchema
>;

export const procedureRefinementDialogueCompletedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement_dialogue'),
    resultContentSha256: evalContentSha256Schema,
    result: procedureRefinementDialogueProviderResultSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: timestampSchema,
  })
  .superRefine(validateProviderEvidenceIds);
export type ProcedureRefinementDialogueCompletedEvent = z.infer<
  typeof procedureRefinementDialogueCompletedEventSchema
>;

export const procedureRefinementDialogueFailedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement_dialogue'),
    error: procedureRefinementEvidenceFailureSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: timestampSchema,
  })
  .superRefine(validateProviderEvidenceIds);
export type ProcedureRefinementDialogueFailedEvent = z.infer<
  typeof procedureRefinementDialogueFailedEventSchema
>;

export const procedureRefinementGenerationRequestedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement'),
    occurredAt: timestampSchema,
  })
  .superRefine(validateProviderEvidenceIds);
export type ProcedureRefinementGenerationRequestedEvent = z.infer<
  typeof procedureRefinementGenerationRequestedEventSchema
>;

export const procedureRefinementGenerationOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('valid'),
    providerResult: procedureRefinementProviderResultSchema,
  }),
  z.strictObject({
    kind: z.literal('invalid'),
    providerOutputContentSha256: evalContentSha256Schema,
    safeMessage: z.string().trim().min(1).max(1_000).regex(/\S/),
  }),
]);
export type ProcedureRefinementGenerationOutcome = z.infer<
  typeof procedureRefinementGenerationOutcomeSchema
>;

export const procedureRefinementGenerationCompletedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement'),
    outcome: procedureRefinementGenerationOutcomeSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: timestampSchema,
  })
  .superRefine((event, context) => {
    validateProviderEvidenceIds(event, context);
    if (
      event.outcome.kind === 'valid' &&
      (event.outcome.providerResult.runId !== event.runId ||
        event.outcome.providerResult.refinementRequestId !== event.requestId ||
        event.outcome.providerResult.packetContentSha256 !== event.packetContentSha256)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'providerResult'],
        message: 'Valid generation evidence must bind the exact run, request, and packet',
      });
    }
  });
export type ProcedureRefinementGenerationCompletedEvent = z.infer<
  typeof procedureRefinementGenerationCompletedEventSchema
>;

export const procedureRefinementGenerationFailedEventSchema = z
  .strictObject({
    ...procedureRefinementProviderEvidenceScopeShape,
    operation: z.literal('procedure_refinement'),
    error: procedureRefinementEvidenceFailureSchema,
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: timestampSchema,
  })
  .superRefine(validateProviderEvidenceIds);
export type ProcedureRefinementGenerationFailedEvent = z.infer<
  typeof procedureRefinementGenerationFailedEventSchema
>;

export const procedureRefinementReviewBindingSchema = z.strictObject({
  runRequestContentSha256: evalContentSha256Schema,
  baseTreeContentSha256: evalContentSha256Schema,
  targetTreeContentSha256: evalContentSha256Schema,
  scopeContentSha256: evalContentSha256Schema,
  semanticContextContentSha256: evalContentSha256Schema,
  assistantMessageContentSha256: evalContentSha256Schema,
  refinementPacketContentSha256: evalContentSha256Schema,
  providerOutputContentSha256: evalContentSha256Schema,
  localityReportContentSha256: evalContentSha256Schema,
});
export type ProcedureRefinementReviewBinding = z.infer<
  typeof procedureRefinementReviewBindingSchema
>;

export const procedureRefinementReviewRequestSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    runId: z.uuid(),
    reviewId: z.uuid(),
    binding: procedureRefinementReviewBindingSchema,
    decision: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('store'),
        confirmations: z.strictObject({
          exactBaseTreeReviewed: z.literal(true),
          exactTargetTreeReviewed: z.literal(true),
          exactScopeReviewed: z.literal(true),
          exactSemanticContextReviewed: z.literal(true),
          exactProviderOutputReviewed: z.literal(true),
          exactLocalityReportReviewed: z.literal(true),
          noHostExecutionAcknowledged: z.literal(true),
        }),
      }),
      z.strictObject({
        kind: z.literal('discard'),
        reason: z.string().trim().min(1).max(1_000).regex(/\S/).optional(),
      }),
    ]),
    reviewedAt: timestampSchema,
  })
  .superRefine((request, context) => {
    if (request.runId === request.reviewId) {
      context.addIssue({
        code: 'custom',
        path: ['reviewId'],
        message: 'Review id must differ from the refinement run id',
      });
    }
  });
export type ProcedureRefinementReviewRequest = z.infer<
  typeof procedureRefinementReviewRequestSchema
>;

export const procedureRefinementReviewedEventSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    operation: z.literal('procedure_refinement_review'),
    runId: z.uuid(),
    reviewId: z.uuid(),
    requestFingerprint: evalContentSha256Schema,
    providerId: plannerProviderDescriptorSchema.shape.id,
    providerVersion: plannerProviderDescriptorSchema.shape.version,
    packetContentSha256: evalContentSha256Schema,
    treatmentContentSha256: evalContentSha256Schema,
    previewBinding: procedureRefinementReviewBindingSchema,
    reviewRequest: procedureRefinementReviewRequestSchema,
    finalStatus: z.enum(['completed', 'discarded']),
    procedureStored: z.boolean(),
    durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    occurredAt: timestampSchema,
  })
  .superRefine((event, context) => {
    const store = event.reviewRequest.decision.kind === 'store';
    if (
      event.reviewRequest.runId !== event.runId ||
      event.reviewRequest.reviewId !== event.reviewId ||
      !sameProtocolValue(event.reviewRequest.binding, event.previewBinding) ||
      event.packetContentSha256 !== event.previewBinding.refinementPacketContentSha256 ||
      event.finalStatus !== (store ? 'completed' : 'discarded') ||
      event.procedureStored !== store ||
      new Date(event.occurredAt).getTime() < new Date(event.reviewRequest.reviewedAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Reviewed evidence must bind the exact request, preview, and final side effect',
      });
    }
  })
  .meta({
    description:
      'Durable review evidence. The runtime additionally enforces that occurredAt is not earlier than the embedded reviewRequest.reviewedAt.',
    $comment: 'Runtime invariant: occurredAt must be greater than or equal to reviewedAt.',
  });
export type ProcedureRefinementReviewedEvent = z.infer<
  typeof procedureRefinementReviewedEventSchema
>;

export const procedureRefinementRunStatusRequestSchema = z.strictObject({
  formatVersion: procedureRefinementFormatVersionSchema,
  runId: z.uuid(),
});
export type ProcedureRefinementRunStatusRequest = z.infer<
  typeof procedureRefinementRunStatusRequestSchema
>;

export const procedureRefinementRunStatusValueSchema = z.enum([
  'queued',
  'streaming',
  'answered',
  'refining',
  'awaiting_review',
  'needs_revision',
  'completed',
  'discarded',
  'failed',
  'interrupted',
]);
export type ProcedureRefinementRunStatusValue = z.infer<
  typeof procedureRefinementRunStatusValueSchema
>;

export const procedureRefinementSafeErrorSchema = z.strictObject({
  code: z.enum([
    'provider_unavailable',
    'provider_call_failed',
    'provider_output_invalid',
    'semantic_context_unavailable',
    'base_tree_conflict',
    'locality_validation_failed',
    'storage_conflict',
    'persistence_failed',
    'interrupted_before_provider_completion',
    'internal_failed',
  ]),
  message: z.string().trim().min(1).max(1_000).regex(/\S/),
  retryable: z.boolean(),
  retryMode: z.literal('new_request_id'),
});

export const procedureRefinementNeedsRevisionSchema = z.strictObject({
  reason: z.enum([
    'provider_output_invalid',
    'locality_validation_failed',
    'procedure_compilation_failed',
    'no_meaningful_change',
  ]),
  message: z.string().trim().min(1).max(1_000).regex(/\S/),
  findings: z.array(procedureRefinementScopeFindingSchema).max(256),
});
export type ProcedureRefinementNeedsRevision = z.infer<
  typeof procedureRefinementNeedsRevisionSchema
>;

const reviewPreviewSchema = z
  .strictObject({
    targetTree: procedureTreeSchema,
    providerResult: procedureRefinementProviderResultSchema,
    localityReport: procedureRefinementLocalityReportSchema,
    binding: procedureRefinementReviewBindingSchema,
    reviewReadyAt: timestampSchema,
  })
  .meta({
    description:
      'Complete review preview. providerResult preserves the exact parsed provider tree, while targetTree is the separately hashed locally sanitized candidate.',
  });

const runStatusJsonSchemaConditions = [
  {
    if: {
      properties: {
        status: {
          enum: ['answered', 'needs_revision', 'completed', 'discarded', 'failed', 'interrupted'],
        },
      },
      required: ['status'],
    },
    then: { properties: { terminal: { const: true } }, required: ['terminal'] },
    else: { properties: { terminal: { const: false } }, required: ['terminal'] },
  },
  {
    if: {
      properties: { status: { enum: ['queued', 'streaming'] } },
      required: ['status'],
    },
    then: { properties: { semanticDecision: { type: 'null' } } },
  },
  {
    if: {
      properties: {
        status: {
          enum: ['refining', 'awaiting_review', 'needs_revision', 'completed', 'discarded'],
        },
      },
      required: ['status'],
    },
    then: {
      properties: {
        semanticDecision: {
          properties: { kind: { const: 'refine' } },
          required: ['kind'],
        },
      },
    },
  },
  {
    if: { properties: { status: { const: 'answered' } }, required: ['status'] },
    then: {
      properties: {
        semanticDecision: {
          properties: { kind: { const: 'answer' } },
          required: ['kind'],
        },
      },
    },
  },
  {
    if: {
      properties: { status: { enum: ['awaiting_review', 'completed', 'discarded'] } },
      required: ['status'],
    },
    then: { properties: { preview: { not: { type: 'null' } } } },
  },
  {
    if: {
      properties: {
        status: { enum: ['queued', 'streaming', 'answered', 'refining', 'needs_revision'] },
      },
      required: ['status'],
    },
    then: { properties: { preview: { type: 'null' } } },
  },
  {
    if: {
      properties: { status: { enum: ['completed', 'discarded'] } },
      required: ['status'],
    },
    then: { properties: { review: { not: { type: 'null' } } } },
  },
  {
    if: {
      properties: {
        status: {
          enum: [
            'queued',
            'streaming',
            'answered',
            'refining',
            'awaiting_review',
            'needs_revision',
          ],
        },
      },
      required: ['status'],
    },
    then: { properties: { review: { type: 'null' } } },
  },
  {
    if: { properties: { status: { const: 'completed' } }, required: ['status'] },
    then: {
      properties: {
        review: {
          properties: { decision: { const: 'store' } },
          required: ['decision'],
        },
        storedTree: { not: { type: 'null' } },
        sideEffects: {
          properties: { procedureStored: { const: true } },
          required: ['procedureStored'],
        },
      },
    },
    else: {
      properties: {
        storedTree: { type: 'null' },
        sideEffects: {
          properties: { procedureStored: { const: false } },
          required: ['procedureStored'],
        },
      },
    },
  },
  {
    if: { properties: { status: { const: 'discarded' } }, required: ['status'] },
    then: {
      properties: {
        review: {
          properties: { decision: { const: 'discard' } },
          required: ['decision'],
        },
      },
    },
  },
  {
    if: { properties: { status: { const: 'needs_revision' } }, required: ['status'] },
    then: { properties: { needsRevision: { not: { type: 'null' } } } },
    else: { properties: { needsRevision: { type: 'null' } } },
  },
  {
    if: {
      properties: { status: { enum: ['failed', 'interrupted'] } },
      required: ['status'],
    },
    then: { properties: { error: { not: { type: 'null' } } } },
    else: { properties: { error: { type: 'null' } } },
  },
] as const;

export const procedureRefinementRunStatusSchema = z
  .strictObject({
    formatVersion: procedureRefinementFormatVersionSchema,
    runId: z.uuid(),
    dialogueRequestId: z.uuid(),
    refinementRequestId: z.uuid(),
    baseTree: storedProcedureTreeSchema,
    targetRevision: z.number().int().min(2),
    scope: procedureRefinementScopeSchema,
    semanticContext: procedureRefinementSemanticContextBindingSchema,
    providerDisclosure: procedureRefinementProviderDisclosureSchema,
    status: procedureRefinementRunStatusValueSchema,
    terminal: z.boolean(),
    assistantMessage: z.string().max(procedureRefinementMaximumAssistantMessageCharacters),
    assistantMessageRevision: z.number().int().nonnegative(),
    semanticDecision: procedureRefinementDialogueDecisionSchema.nullable(),
    preview: reviewPreviewSchema.nullable(),
    review: z
      .strictObject({
        reviewId: z.uuid(),
        decision: z.enum(['store', 'discard']),
        reviewedAt: timestampSchema,
      })
      .nullable(),
    storedTree: storedProcedureTreeSchema.nullable(),
    needsRevision: procedureRefinementNeedsRevisionSchema.nullable(),
    error: procedureRefinementSafeErrorSchema.nullable(),
    sideEffects: z.strictObject({
      procedureStored: z.boolean(),
      proposalCreated: z.literal(false),
      hostExecutionStarted: z.literal(false),
    }),
    updatedAt: timestampSchema,
  })
  .superRefine((run, context) => {
    if (new Set([run.runId, run.dialogueRequestId, run.refinementRequestId]).size !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Run request ids must be distinct',
      });
    }
    if (run.targetRevision !== run.baseTree.tree.revision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['targetRevision'],
        message: 'Target revision must be exactly one greater than the stored base revision',
      });
    }
    const terminalStatuses = new Set([
      'answered',
      'needs_revision',
      'completed',
      'discarded',
      'failed',
      'interrupted',
    ]);
    if (run.terminal !== terminalStatuses.has(run.status)) {
      context.addIssue({
        code: 'custom',
        path: ['terminal'],
        message: 'terminal must match status',
      });
    }
    if ((run.assistantMessage.length === 0) !== (run.assistantMessageRevision === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['assistantMessageRevision'],
        message: 'Cumulative assistant text and durable revision must advance together',
      });
    }
    const decisionRequired = !['queued', 'streaming', 'failed', 'interrupted'].includes(run.status);
    if (decisionRequired && run.semanticDecision === null) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Semantic decision must be present after dialogue classification',
      });
    }
    if (['queued', 'streaming'].includes(run.status) && run.semanticDecision !== null) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Semantic decision is unavailable before dialogue classification',
      });
    }
    if (decisionRequired && run.assistantMessage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['assistantMessage'],
        message: 'Classified refinement runs require a user-facing assistant message',
      });
    }
    if (run.status === 'answered' && run.semanticDecision?.kind !== 'answer') {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Answered runs require answer decision',
      });
    }
    if (
      ['refining', 'awaiting_review', 'needs_revision', 'completed', 'discarded'].includes(
        run.status,
      ) &&
      run.semanticDecision?.kind !== 'refine'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticDecision'],
        message: 'Refinement phases require refine decision',
      });
    }
    const previewRequired = ['awaiting_review', 'completed', 'discarded'].includes(run.status);
    if (previewRequired && run.preview === null) {
      context.addIssue({
        code: 'custom',
        path: ['preview'],
        message: 'Review preview is required exactly for reviewable or reviewed valid targets',
      });
    }
    if (
      ['queued', 'streaming', 'answered', 'refining', 'needs_revision'].includes(run.status) &&
      run.preview !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preview'],
        message: 'Review preview is unavailable before a valid target or for needs_revision',
      });
    }
    if (run.preview !== null) {
      if (
        run.preview.targetTree.id !== run.baseTree.tree.id ||
        run.preview.targetTree.revision !== run.targetRevision ||
        run.preview.providerResult.runId !== run.runId ||
        run.preview.providerResult.refinementRequestId !== run.refinementRequestId ||
        run.preview.providerResult.treeId !== run.baseTree.tree.id ||
        run.preview.providerResult.targetRevision !== run.targetRevision ||
        run.preview.providerResult.packetContentSha256 !==
          run.preview.binding.refinementPacketContentSha256 ||
        run.preview.providerResult.providerOutputContentSha256 !==
          run.preview.binding.providerOutputContentSha256 ||
        !sameProtocolValue(
          run.preview.localityReport.requestedRootIds,
          run.scope.requestedRootIds,
        ) ||
        !sameProtocolValue(
          run.preview.localityReport.normalizedRootIds,
          run.scope.normalizedRootIds,
        ) ||
        !sameProtocolValue(run.preview.localityReport.rules, run.scope.rules) ||
        run.preview.localityReport.baseTree.id !== run.baseTree.tree.id ||
        run.preview.localityReport.baseTree.revision !== run.baseTree.tree.revision ||
        run.preview.localityReport.targetTree.id !== run.preview.targetTree.id ||
        run.preview.localityReport.targetTree.revision !== run.preview.targetTree.revision ||
        !run.preview.localityReport.valid
      ) {
        context.addIssue({
          code: 'custom',
          path: ['preview'],
          message: 'Review preview must contain the valid bound target revision',
        });
      }
      if (new Date(run.preview.reviewReadyAt).getTime() > new Date(run.updatedAt).getTime()) {
        context.addIssue({
          code: 'custom',
          path: ['preview', 'reviewReadyAt'],
          message: 'Review readiness cannot be later than the current run update',
        });
      }
      if (run.preview.binding.baseTreeContentSha256 !== run.baseTree.integrity.contentSha256) {
        context.addIssue({
          code: 'custom',
          path: ['preview', 'binding', 'baseTreeContentSha256'],
          message: 'Review preview must bind the exact stored base tree integrity',
        });
      }
    }
    const reviewed = ['completed', 'discarded'].includes(run.status);
    if (reviewed && run.review === null) {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Review evidence must match reviewed status',
      });
    }
    if (
      ['queued', 'streaming', 'answered', 'refining', 'awaiting_review', 'needs_revision'].includes(
        run.status,
      ) &&
      run.review !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Review evidence is unavailable before review completion',
      });
    }
    if (run.status === 'completed' && run.review?.decision !== 'store') {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Completed runs require a store review',
      });
    }
    if (run.status === 'discarded' && run.review?.decision !== 'discard') {
      context.addIssue({
        code: 'custom',
        path: ['review'],
        message: 'Discarded runs require a discard review',
      });
    }
    if (
      run.preview !== null &&
      run.review !== null &&
      new Date(run.review.reviewedAt).getTime() < new Date(run.preview.reviewReadyAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['review', 'reviewedAt'],
        message: 'A review cannot precede the bound preview readiness time',
      });
    }
    if ((run.status === 'completed') !== (run.storedTree !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['storedTree'],
        message: 'Stored tree is present only for completed runs',
      });
    }
    if (run.storedTree !== null && run.preview !== null) {
      if (!sameProtocolValue(run.storedTree.tree, run.preview.targetTree)) {
        context.addIssue({
          code: 'custom',
          path: ['storedTree'],
          message: 'Stored tree must equal the reviewed target tree',
        });
      }
      if (run.storedTree.integrity.contentSha256 !== run.preview.binding.targetTreeContentSha256) {
        context.addIssue({
          code: 'custom',
          path: ['storedTree', 'integrity', 'contentSha256'],
          message: 'Stored tree integrity must match the exact reviewed target hash',
        });
      }
    }
    if ((run.status === 'needs_revision') !== (run.needsRevision !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['needsRevision'],
        message: 'needsRevision must match status',
      });
    }
    const errored = run.status === 'failed' || run.status === 'interrupted';
    if (errored !== (run.error !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Safe error evidence must match failed status',
      });
    }
    if (run.sideEffects.procedureStored !== (run.status === 'completed')) {
      context.addIssue({
        code: 'custom',
        path: ['sideEffects', 'procedureStored'],
        message: 'Procedure storage occurs only after a completed store review',
      });
    }
  })
  .meta({
    description:
      'Durable Procedure refinement status. The public JSON Schema encodes the core status/terminal, decision, preview, review, stored-tree, revision, error, and storage-side-effect relations; runtime parsing additionally verifies cross-field identity, hashes, values, and timestamps.',
    allOf: runStatusJsonSchemaConditions,
  });
export type ProcedureRefinementRunStatus = z.infer<typeof procedureRefinementRunStatusSchema>;

function validateCompletedHistory(
  history: ReadonlyArray<{ role: 'user' | 'assistant' }>,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  for (const [index, message] of history.entries()) {
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (message.role !== expectedRole) {
      context.addIssue({
        code: 'custom',
        path: [...path, index, 'role'],
        message: `Dialogue history entry ${index + 1} must use role ${expectedRole}`,
      });
    }
  }
  if (history.length > 0 && history.at(-1)?.role !== 'assistant') {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Dialogue history must contain completed user/assistant turns',
    });
  }
}

function validatePromptPacket(
  packet: {
    requestId: string;
    context: {
      runId: string;
      baseTree: z.infer<typeof storedProcedureTreeSchema>;
      targetRevision: number;
      scope: z.infer<typeof procedureRefinementScopeSchema>;
      semanticRetrieval: z.infer<typeof procedureSemanticRetrievalResultSchema>;
      history: ReadonlyArray<{ role: 'user' | 'assistant' }>;
    };
  },
  context: z.RefinementCtx,
): void {
  if (packet.requestId === packet.context.runId) {
    context.addIssue({
      code: 'custom',
      path: ['requestId'],
      message: 'Provider request id must differ from run id',
    });
  }
  if (packet.context.targetRevision !== packet.context.baseTree.tree.revision + 1) {
    context.addIssue({
      code: 'custom',
      path: ['context', 'targetRevision'],
      message: 'Prompt target revision must be exactly base revision plus one',
    });
  }
  if (packet.context.semanticRetrieval.requestId === packet.context.runId) {
    context.addIssue({
      code: 'custom',
      path: ['context', 'semanticRetrieval', 'requestId'],
      message: 'Semantic retrieval and refinement run ids must differ',
    });
  }
  validateCompletedHistory(packet.context.history, context, ['context', 'history']);
}

function sameProtocolValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}
