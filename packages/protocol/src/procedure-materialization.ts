import { z } from 'zod';

import { guideStepIdSchema } from './guide.js';
import {
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringPromptPacketSchema,
} from './procedure-authoring.js';
import {
  menuProcedureTrackSchema,
  procedureCompilationResultSchema,
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
  procedureTreeSchema,
} from './procedure-tree.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringMaterializationLegacyFormatVersion = '1.0.0' as const;
export const procedureAuthoringMaterializationFormatVersion = '1.1.0' as const;
export const procedureAuthoringMaterializationFormatVersionSchema = z.enum([
  procedureAuthoringMaterializationLegacyFormatVersion,
  procedureAuthoringMaterializationFormatVersion,
]);

const procedureAuthoringMaterializationContentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const procedureAuthoringUnavailableShortcutTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  availability: z.literal('unavailable'),
  title: z.string().min(1),
  reason: z.string().min(1),
  modality: z.literal('shortcut'),
});

const procedureAuthoringUnavailableMcpTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  availability: z.literal('unavailable'),
  title: z.string().min(1),
  reason: z.string().min(1),
  modality: z.literal('mcp'),
});

const procedureAuthoringMaterializedLeafSchema = procedureLeafNodeSchema.safeExtend({
  menuTracks: z.array(menuProcedureTrackSchema).length(1),
  shortcutTracks: z.array(procedureAuthoringUnavailableShortcutTrackSchema).length(1),
  mcpTracks: z.array(procedureAuthoringUnavailableMcpTrackSchema).length(1),
  validation: procedureLeafNodeSchema.shape.validation.safeExtend({
    status: z.literal('candidate'),
    validatedHostVersions: z.array(catalogVersionSchema).length(0),
  }),
});

const procedureAuthoringMaterializedNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureAuthoringMaterializedLeafSchema,
]);

export const procedureAuthoringMaterializedTreeSchema = procedureTreeSchema.safeExtend({
  nodes: z.array(procedureAuthoringMaterializedNodeSchema).min(1),
});
export type ProcedureAuthoringMaterializedTree = z.infer<
  typeof procedureAuthoringMaterializedTreeSchema
>;

const procedureAuthoringMaterializationCoverageBaseShape = {
  leafId: guideStepIdSchema,
  shortcut: z.literal('unavailable'),
  mcp: z.literal('unavailable'),
} as const;

const procedureAuthoringMaterializationCoverageSchema = z.discriminatedUnion('menu', [
  z.strictObject({
    ...procedureAuthoringMaterializationCoverageBaseShape,
    recipeId: guideStepIdSchema,
    menu: z.literal('materialized'),
  }),
  z.strictObject({
    ...procedureAuthoringMaterializationCoverageBaseShape,
    recipeId: guideStepIdSchema.nullable(),
    menu: z.literal('unavailable'),
  }),
]);

export const procedureAuthoringMaterializationRequestSchema = z.strictObject({
  packet: procedureAuthoringPromptPacketSchema,
  tree: procedureAuthoringCandidateTreeSchema,
});
export type ProcedureAuthoringMaterializationRequest = z.infer<
  typeof procedureAuthoringMaterializationRequestSchema
>;

const procedureAuthoringMaterializationResultShape = {
  packetContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  inputTreeContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  outputTreeContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  catalogBinding: z.strictObject({
    adapterId: z.string().min(1),
    actionCatalogVersion: catalogVersionSchema,
    interactionCatalogVersion: catalogVersionSchema,
    interactionCatalogContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  }),
  coverage: z.array(procedureAuthoringMaterializationCoverageSchema).min(1),
  validation: z.strictObject({
    packetIntegrity: z.literal('validated'),
    installedCatalogBinding: z.literal('validated'),
    authoringCandidateContract: z.literal('validated'),
    procedureCompilation: z.literal('validated'),
    interactionGrounding: z.literal('validated_against_installed_interaction_catalog'),
  }),
  tree: procedureAuthoringMaterializedTreeSchema,
  compilation: procedureCompilationResultSchema,
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
} as const;

export const procedureAuthoringMaterializationResultSchema = z.discriminatedUnion('formatVersion', [
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationLegacyFormatVersion),
    ...procedureAuthoringMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationFormatVersion),
    ...procedureAuthoringMaterializationResultShape,
  }),
]);
export type ProcedureAuthoringMaterializationResult = z.infer<
  typeof procedureAuthoringMaterializationResultSchema
>;
