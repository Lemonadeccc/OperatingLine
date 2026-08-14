import { z } from 'zod';

import { actionCatalogJsonSchemaMetadata, actionCatalogSchema } from './catalog.js';
import { protocolJsonValueCanonicalization } from './canonical-json-value.js';
import { guideStepIdSchema } from './guide.js';
import { interactionCatalogSchema } from './interaction-catalog.js';
import {
  procedureCompilationResultSchema,
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
  procedureTreeSchema,
} from './procedure-tree.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringPromptFormatVersion = '1.0.0' as const;
export const procedureAuthoringPromptPacketMaxCanonicalBytes = 262_144 as const;
export const procedureAuthoringPromptFormatVersionSchema = z.literal(
  procedureAuthoringPromptFormatVersion,
);

export const procedureAuthoringPromptRequestSchema = z.strictObject({
  targetAdapterId: z.string().min(1).max(180).regex(/^\S+$/),
  actionCatalogVersion: catalogVersionSchema.optional(),
  interactionCatalogVersion: catalogVersionSchema.optional(),
  goal: z.string().min(1).max(10_000).regex(/\S/),
  treeId: guideStepIdSchema,
  revision: z.number().int().positive(),
  locale: z.string().min(1).max(64).regex(/^\S+$/).optional(),
});
export type ProcedureAuthoringPromptRequest = z.infer<typeof procedureAuthoringPromptRequestSchema>;

const procedureCandidateValidationSchema = procedureLeafNodeSchema.shape.validation.safeExtend({
  status: z.literal('candidate'),
  validatedHostVersions: z.array(catalogVersionSchema).length(0),
});

const procedureCandidateLeafNodeSchema = procedureLeafNodeSchema.safeExtend({
  menuTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('menu'),
      }),
    )
    .min(1),
  shortcutTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('shortcut'),
      }),
    )
    .min(1),
  mcpTracks: z
    .array(
      z.strictObject({
        id: guideStepIdSchema,
        availability: z.literal('unavailable'),
        title: z.string().min(1),
        reason: z.string().min(1),
        modality: z.literal('mcp'),
      }),
    )
    .min(1),
  validation: procedureCandidateValidationSchema,
});

const procedureCandidateNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureCandidateLeafNodeSchema,
]);

export const procedureAuthoringCandidateTreeSchema = procedureTreeSchema.safeExtend({
  nodes: z.array(procedureCandidateNodeSchema).min(1),
});
export type ProcedureAuthoringCandidateTree = z.infer<typeof procedureAuthoringCandidateTreeSchema>;

const procedureAuthoringNaturalLanguageSourceSchema = z.strictObject({
  id: guideStepIdSchema,
  kind: z.literal('natural_language'),
  text: procedureAuthoringPromptRequestSchema.shape.goal,
  locale: procedureAuthoringPromptRequestSchema.shape.locale,
});

const procedureAuthoringGoalEvidenceSchema = z.strictObject({
  id: guideStepIdSchema,
  locator: z.strictObject({ kind: z.literal('whole_source') }),
  description: z.string().min(1),
  confidence: z.literal(1),
});

const procedureAuthoringActionCatalogSchema = actionCatalogSchema
  .omit({ adapterId: true })
  .meta(actionCatalogJsonSchemaMetadata);
const procedureAuthoringInteractionCatalogSchema = interactionCatalogSchema.omit({
  adapterId: true,
  actionCatalogVersion: true,
});

export const procedureAuthoringPromptContextSchema = z.strictObject({
  requestedTreeId: procedureAuthoringPromptRequestSchema.shape.treeId,
  recommendedRevision: procedureAuthoringPromptRequestSchema.shape.revision,
  goalProvenance: z.strictObject({
    source: procedureAuthoringNaturalLanguageSourceSchema,
    evidence: procedureAuthoringGoalEvidenceSchema,
  }),
  catalogBinding: z.strictObject({
    adapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
    actionCatalog: procedureAuthoringActionCatalogSchema,
    interactionCatalog: procedureAuthoringInteractionCatalogSchema,
  }),
  constraints: z.strictObject({
    allGeneratedLeavesCandidate: z.literal(true),
    validatedHostVersionsEmpty: z.literal(true),
    exactParametersRemainOnSemanticOperations: z.literal(true),
    allInteractionTracksUnavailable: z.literal(true),
    persistenceRequiresExplicitStore: z.literal(true),
  }),
});
export type ProcedureAuthoringPromptContext = z.infer<typeof procedureAuthoringPromptContextSchema>;

export const procedureAuthoringPromptPacketContentSchema = z.strictObject({
  formatVersion: procedureAuthoringPromptFormatVersionSchema,
  context: procedureAuthoringPromptContextSchema,
  retrieval: z.strictObject({
    toolName: z.literal('operatingline.procedure.search'),
    matching: z.literal('exact_structured_filters'),
    similarityScoreProduced: z.literal(false),
  }),
  responseContract: z.strictObject({
    mediaType: z.literal('application/json'),
    schema: z.record(z.string(), z.json()),
  }),
  workflow: z.strictObject({
    validationToolName: z.literal('operatingline.procedure.authoring.validate'),
    compileToolName: z.literal('operatingline.procedure.compile'),
    instructions: z.array(z.string().min(1)).min(1),
  }),
  limits: z.strictObject({
    maxCanonicalBytes: z.literal(procedureAuthoringPromptPacketMaxCanonicalBytes),
  }),
  sideEffects: z.strictObject({
    modelCalled: z.literal(false),
    procedureStored: z.literal(false),
    proposalCreated: z.literal(false),
    hostExecutionStarted: z.literal(false),
  }),
});
export type ProcedureAuthoringPromptPacketContent = z.infer<
  typeof procedureAuthoringPromptPacketContentSchema
>;

export const procedureAuthoringPromptPacketSchema =
  procedureAuthoringPromptPacketContentSchema.safeExtend({
    integrity: z.strictObject({
      algorithm: z.literal('sha256'),
      canonicalization: z.literal(protocolJsonValueCanonicalization),
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  });
export type ProcedureAuthoringPromptPacket = z.infer<typeof procedureAuthoringPromptPacketSchema>;

export const procedureAuthoringValidationRequestSchema = z.strictObject({
  packet: procedureAuthoringPromptPacketSchema,
  tree: procedureAuthoringCandidateTreeSchema,
});
export type ProcedureAuthoringValidationRequest = z.infer<
  typeof procedureAuthoringValidationRequestSchema
>;

export const procedureAuthoringValidationResultSchema = z.strictObject({
  formatVersion: procedureAuthoringPromptFormatVersionSchema,
  packetContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  validation: z.strictObject({
    packetIntegrity: z.literal('validated'),
    installedCatalogBinding: z.literal('validated'),
    authoringCandidateContract: z.literal('validated'),
    procedureCompilation: z.literal('validated'),
  }),
  compilation: procedureCompilationResultSchema,
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
});
export type ProcedureAuthoringValidationResult = z.infer<
  typeof procedureAuthoringValidationResultSchema
>;
