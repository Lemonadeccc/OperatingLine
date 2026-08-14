import { z } from 'zod';

import { guideStepIdSchema } from './guide.js';
import {
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringPromptPacketSchema,
} from './procedure-authoring.js';
import {
  menuProcedureTrackSchema,
  procedurePreconditionSchema,
  procedureCompilationResultSchema,
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
  procedureTreeSchema,
  shortcutProcedureOperationSchema,
} from './procedure-tree.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringMaterializationLegacyFormatVersion = '1.0.0' as const;
export const procedureAuthoringMaterializationOrderedMenuFormatVersion = '1.1.0' as const;
export const procedureAuthoringMaterializationFormatVersion = '1.2.0' as const;
export const procedureAuthoringMaterializationFormatVersionSchema = z.enum([
  procedureAuthoringMaterializationLegacyFormatVersion,
  procedureAuthoringMaterializationOrderedMenuFormatVersion,
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

const procedureAuthoringMaterializedShortcutOperationSchema =
  shortcutProcedureOperationSchema.safeExtend({
    keyMode: z.enum(['chord', 'sequence']),
    selectionPath: z.array(z.string().min(1)).min(1).optional(),
  });

const procedureAuthoringAvailableShortcutTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  availability: z.literal('available'),
  title: z.string().min(1),
  preconditions: z.array(procedurePreconditionSchema),
  modality: z.literal('shortcut'),
  operations: z.array(procedureAuthoringMaterializedShortcutOperationSchema).min(1),
});

const procedureAuthoringMaterializedShortcutTrackSchema = z.union([
  procedureAuthoringUnavailableShortcutTrackSchema,
  procedureAuthoringAvailableShortcutTrackSchema,
]);

const procedureAuthoringMaterializedLeafSchema = procedureLeafNodeSchema.safeExtend({
  menuTracks: z.array(menuProcedureTrackSchema).length(1),
  shortcutTracks: z.array(procedureAuthoringUnavailableShortcutTrackSchema).length(1),
  mcpTracks: z.array(procedureAuthoringUnavailableMcpTrackSchema).length(1),
  validation: procedureLeafNodeSchema.shape.validation.safeExtend({
    status: z.literal('candidate'),
    validatedHostVersions: z.array(catalogVersionSchema).length(0),
  }),
});

const procedureAuthoringShortcutMaterializedLeafSchema = procedureLeafNodeSchema.safeExtend({
  menuTracks: z.array(menuProcedureTrackSchema).length(1),
  shortcutTracks: z.array(procedureAuthoringMaterializedShortcutTrackSchema).length(1),
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

export const procedureAuthoringLegacyMaterializedTreeSchema = procedureTreeSchema.safeExtend({
  nodes: z.array(procedureAuthoringMaterializedNodeSchema).min(1),
});
export type ProcedureAuthoringLegacyMaterializedTree = z.infer<
  typeof procedureAuthoringLegacyMaterializedTreeSchema
>;

const procedureAuthoringShortcutMaterializedNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureAuthoringShortcutMaterializedLeafSchema,
]);

export const procedureAuthoringMaterializedTreeSchema = procedureTreeSchema.safeExtend({
  nodes: z.array(procedureAuthoringShortcutMaterializedNodeSchema).min(1),
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

const materializedMenuCoverageJsonSchema = {
  type: 'object',
  properties: { menu: { const: 'materialized' } },
  required: ['menu'],
} as const;

const procedureAuthoringLegacyMaterializationCoverageArraySchema = z
  .array(procedureAuthoringMaterializationCoverageSchema)
  .min(1);

const procedureAuthoringOrderedMenuMaterializationCoverageArraySchema = z
  .array(procedureAuthoringMaterializationCoverageSchema)
  .min(1)
  .superRefine((coverage, context) => {
    if (!coverage.some((entry) => entry.menu === 'materialized')) {
      context.addIssue({
        code: 'custom',
        message: 'Materialization result 1.1.0 requires at least one materialized menu',
      });
    }
  })
  .meta({ contains: materializedMenuCoverageJsonSchema });

const procedureAuthoringShortcutMaterializationCoverageSchema = z.union([
  z.strictObject({
    leafId: guideStepIdSchema,
    recipeId: guideStepIdSchema,
    menu: z.literal('materialized'),
    shortcut: z.literal('materialized'),
    mcp: z.literal('unavailable'),
  }),
  z.strictObject({
    leafId: guideStepIdSchema,
    recipeId: guideStepIdSchema,
    menu: z.literal('materialized'),
    shortcut: z.literal('unavailable'),
    mcp: z.literal('unavailable'),
  }),
  z.strictObject({
    leafId: guideStepIdSchema,
    recipeId: guideStepIdSchema,
    menu: z.literal('unavailable'),
    shortcut: z.literal('materialized'),
    mcp: z.literal('unavailable'),
  }),
  z.strictObject({
    leafId: guideStepIdSchema,
    recipeId: guideStepIdSchema.nullable(),
    menu: z.literal('unavailable'),
    shortcut: z.literal('unavailable'),
    mcp: z.literal('unavailable'),
  }),
]);

const materializedShortcutCoverageJsonSchema = {
  type: 'object',
  properties: { shortcut: { const: 'materialized' } },
  required: ['shortcut'],
} as const;

const procedureAuthoringShortcutMaterializationCoverageArraySchema = z
  .array(procedureAuthoringShortcutMaterializationCoverageSchema)
  .min(1)
  .superRefine((coverage, context) => {
    if (!coverage.some((entry) => entry.shortcut === 'materialized')) {
      context.addIssue({
        code: 'custom',
        message: 'Materialization result 1.2.0 requires at least one materialized shortcut',
      });
    }
  })
  .meta({ contains: materializedShortcutCoverageJsonSchema });

export const procedureAuthoringMaterializationRequestSchema = z.strictObject({
  packet: procedureAuthoringPromptPacketSchema,
  tree: procedureAuthoringCandidateTreeSchema,
});
export type ProcedureAuthoringMaterializationRequest = z.infer<
  typeof procedureAuthoringMaterializationRequestSchema
>;

const procedureAuthoringMaterializationResultBaseShape = {
  packetContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  inputTreeContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  outputTreeContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  catalogBinding: z.strictObject({
    adapterId: z.string().min(1),
    actionCatalogVersion: catalogVersionSchema,
    interactionCatalogVersion: catalogVersionSchema,
    interactionCatalogContentSha256: procedureAuthoringMaterializationContentSha256Schema,
  }),
  validation: z.strictObject({
    packetIntegrity: z.literal('validated'),
    installedCatalogBinding: z.literal('validated'),
    authoringCandidateContract: z.literal('validated'),
    procedureCompilation: z.literal('validated'),
    interactionGrounding: z.literal('validated_against_installed_interaction_catalog'),
  }),
  compilation: procedureCompilationResultSchema,
  procedureStored: z.literal(false),
  proposalCreated: z.literal(false),
  hostExecutionStarted: z.literal(false),
} as const;

const procedureAuthoringLegacyMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringLegacyMaterializationCoverageArraySchema,
  tree: procedureAuthoringLegacyMaterializedTreeSchema,
} as const;

const procedureAuthoringOrderedMenuMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringOrderedMenuMaterializationCoverageArraySchema,
  tree: procedureAuthoringLegacyMaterializedTreeSchema,
} as const;

const procedureAuthoringShortcutMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringShortcutMaterializationCoverageArraySchema,
  tree: procedureAuthoringMaterializedTreeSchema,
} as const;

export const procedureAuthoringMaterializationResultSchema = z.discriminatedUnion('formatVersion', [
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationLegacyFormatVersion),
    ...procedureAuthoringLegacyMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationOrderedMenuFormatVersion),
    ...procedureAuthoringOrderedMenuMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationFormatVersion),
    ...procedureAuthoringShortcutMaterializationResultShape,
  }),
]);
export type ProcedureAuthoringMaterializationResult = z.infer<
  typeof procedureAuthoringMaterializationResultSchema
>;
