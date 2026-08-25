import { z } from 'zod';

import { canonicalizeProtocolJsonValue } from './canonical-json-value.js';
import {
  armatureLeafOperationIds,
  bevelModifierLeafOperationIds,
  editBevelLeafOperationIds,
  editInsetLeafOperationIds,
  editTriangulateLeafOperationIds,
  editExtrudeRegionLeafOperationIds,
  editPokeLeafOperationIds,
  lightTrailsLeafOperationIds,
  materialPaletteLeafOperationIds,
  singleMaterialLeafOperationIds,
  mirrorLeafOperationIds,
  poseAnimationLeafOperationIds,
  skinWeightsLeafOperationIds,
  solidifyLeafOperationIds,
  subdivisionSurfaceLeafOperationIds,
  transformGeometryLeafOperationIds,
} from './companion-leaf-operation.js';

import { guideStepIdSchema } from './guide.js';
import { shortcutProofExecutionSchema } from './interaction-catalog.js';
import {
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringPromptPacketSchema,
} from './procedure-authoring.js';
import {
  menuProcedureTrackSchema,
  mcpProcedureCallSchema,
  procedurePreconditionSchema,
  procedureCompilationResultSchema,
  procedureGroupNodeSchema,
  procedureLeafNodeSchema,
  procedureNodeSchema,
  procedureTreeExtendedShortcutFormatVersion,
  procedureTreeFormatVersion,
  procedureTreeFormatVersionSchema,
  procedureTreeMenuCandidateFormatVersion,
  procedureTreeSchema,
  extendedShortcutProcedureOperationSchema,
  shortcutProcedureOperationSchema,
} from './procedure-tree.js';
import { catalogVersionSchema } from './version.js';

export const procedureAuthoringMaterializationLegacyFormatVersion = '1.0.0' as const;
export const procedureAuthoringMaterializationOrderedMenuFormatVersion = '1.1.0' as const;
export const procedureAuthoringMaterializationFormatVersion = '1.2.0' as const;
export const procedureAuthoringMaterializationExtendedShortcutFormatVersion = '1.3.0' as const;
export const procedureAuthoringMaterializationMcpFormatVersion = '1.4.0' as const;
export const procedureAuthoringMaterializationOperationMcpFormatVersion = '1.5.0' as const;
export const procedureAuthoringMaterializationMenuCandidateFormatVersion = '1.6.0' as const;
export const procedureAuthoringMaterializationFormatVersionSchema = z.enum([
  procedureAuthoringMaterializationLegacyFormatVersion,
  procedureAuthoringMaterializationOrderedMenuFormatVersion,
  procedureAuthoringMaterializationFormatVersion,
  procedureAuthoringMaterializationExtendedShortcutFormatVersion,
  procedureAuthoringMaterializationMcpFormatVersion,
  procedureAuthoringMaterializationOperationMcpFormatVersion,
  procedureAuthoringMaterializationMenuCandidateFormatVersion,
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

const procedureAuthoringMaterializedMcpCallSchema = mcpProcedureCallSchema
  .omit({ sourceOperationId: true, operationParameters: true })
  .safeExtend({
    serverName: z.literal('operating-line'),
    toolName: z.literal('operatingline.blender.action.execute'),
    arguments: z.strictObject({
      formatVersion: z.literal('1.0.0'),
      requestId: z.literal('$runtime.requestId'),
      replayId: z.literal('$runtime.replayId'),
      expectedState: z.literal('$runtime.expectedState'),
    }),
    argumentSource: z.literal('accepted_leaf_action'),
    actionArguments: z.record(z.string().min(1), z.json()),
    resultBinding: guideStepIdSchema,
  });

const procedureAuthoringMaterializedMcpTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  availability: z.literal('available'),
  title: z.string().min(1),
  preconditions: z.array(procedurePreconditionSchema),
  modality: z.literal('mcp'),
  operations: z.array(procedureAuthoringMaterializedMcpCallSchema).length(1),
});

const operationMcpOperationIdsByTool = {
  'operatingline.blender.geometry-nodes.transform.execute-next': transformGeometryLeafOperationIds,
  'operatingline.blender.geometry-nodes.light-trails.execute-next': lightTrailsLeafOperationIds,
  'operatingline.blender.animation.pose-keyframes.execute-next': poseAnimationLeafOperationIds,
  'operatingline.blender.rig.armature.execute-next': armatureLeafOperationIds,
  'operatingline.blender.rig.skin-weights.execute-next': skinWeightsLeafOperationIds,
  'operatingline.blender.modifier.solidify.execute-next': solidifyLeafOperationIds,
  'operatingline.blender.modifier.bevel.execute-next': bevelModifierLeafOperationIds,
  'operatingline.blender.material.single.execute-next': singleMaterialLeafOperationIds,
  'operatingline.blender.material.palette.execute-next': materialPaletteLeafOperationIds,
  'operatingline.blender.modifier.mirror.execute-next': mirrorLeafOperationIds,
  'operatingline.blender.modifier.subdivision-surface.execute-next':
    subdivisionSurfaceLeafOperationIds,
  'operatingline.blender.mesh.edit-bevel-edges.execute-next': editBevelLeafOperationIds,
  'operatingline.blender.mesh.edit-inset-faces.execute-next': editInsetLeafOperationIds,
  'operatingline.blender.mesh.edit-triangulate.execute-next': editTriangulateLeafOperationIds,
  'operatingline.blender.mesh.edit-extrude-region.execute-next': editExtrudeRegionLeafOperationIds,
  'operatingline.blender.mesh.edit-poke-faces.execute-next': editPokeLeafOperationIds,
} as const;

const procedureAuthoringMaterializedOperationMcpCallSchema = mcpProcedureCallSchema
  .omit({ argumentSource: true, actionArguments: true })
  .safeExtend({
    serverName: z.literal('operating-line'),
    toolName: z.enum([
      'operatingline.blender.geometry-nodes.transform.execute-next',
      'operatingline.blender.geometry-nodes.light-trails.execute-next',
      'operatingline.blender.animation.pose-keyframes.execute-next',
      'operatingline.blender.rig.armature.execute-next',
      'operatingline.blender.rig.skin-weights.execute-next',
      'operatingline.blender.modifier.solidify.execute-next',
      'operatingline.blender.modifier.bevel.execute-next',
      'operatingline.blender.material.single.execute-next',
      'operatingline.blender.material.palette.execute-next',
      'operatingline.blender.modifier.mirror.execute-next',
      'operatingline.blender.modifier.subdivision-surface.execute-next',
      'operatingline.blender.mesh.edit-bevel-edges.execute-next',
      'operatingline.blender.mesh.edit-inset-faces.execute-next',
      'operatingline.blender.mesh.edit-triangulate.execute-next',
      'operatingline.blender.mesh.edit-extrude-region.execute-next',
      'operatingline.blender.mesh.edit-poke-faces.execute-next',
    ]),
    arguments: z.strictObject({
      formatVersion: z.literal('1.0.0'),
      requestId: z.literal('$runtime.requestId'),
      replayId: z.literal('$runtime.replayId'),
      expectedState: z.literal('$runtime.expectedState'),
    }),
    sourceOperationId: guideStepIdSchema,
    operationParameters: z.record(z.string().min(1), z.json()),
    resultBinding: guideStepIdSchema,
  });

const procedureAuthoringMaterializedOperationMcpTrackSchema = z
  .strictObject({
    id: guideStepIdSchema,
    availability: z.literal('available'),
    title: z.string().min(1),
    preconditions: z.array(procedurePreconditionSchema),
    modality: z.literal('mcp'),
    operations: z
      .array(procedureAuthoringMaterializedOperationMcpCallSchema)
      .min(1)
      .max(lightTrailsLeafOperationIds.length),
  })
  .superRefine((track, context) => {
    const expectedOperationIds = operationMcpOperationIdsByTool[track.operations[0]!.toolName];
    if (
      track.operations.length !== expectedOperationIds.length ||
      track.operations.some((operation) => operation.toolName !== track.operations[0]!.toolName)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Operation-level MCP grounding must bind one complete fixed tool profile',
      });
      return;
    }
    for (const [index, expectedId] of expectedOperationIds.entries()) {
      const operation = track.operations[index];
      if (operation?.order !== index + 1 || operation.sourceOperationId !== expectedId) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index],
          message: 'Operation-level MCP grounding must preserve exact source operation order',
        });
      }
    }
  });

function sameCanonicalJsonValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

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
  proofExecution: shortcutProofExecutionSchema.optional(),
});

const procedureAuthoringAvailableExtendedShortcutTrackSchema = z.strictObject({
  id: guideStepIdSchema,
  availability: z.literal('available'),
  title: z.string().min(1),
  preconditions: z.array(procedurePreconditionSchema),
  modality: z.literal('shortcut'),
  operations: z.array(extendedShortcutProcedureOperationSchema).min(1),
  proofExecution: shortcutProofExecutionSchema.optional(),
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
  formatVersion: z.literal(procedureTreeFormatVersion),
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
  formatVersion: z.literal(procedureTreeFormatVersion),
  nodes: z.array(procedureAuthoringShortcutMaterializedNodeSchema).min(1),
});
export type ProcedureAuthoringMaterializedTree = z.infer<
  typeof procedureAuthoringMaterializedTreeSchema
>;

const procedureAuthoringExtendedShortcutMaterializedTrackSchema = z.union([
  procedureAuthoringUnavailableShortcutTrackSchema,
  procedureAuthoringAvailableExtendedShortcutTrackSchema,
]);

const procedureAuthoringExtendedShortcutMaterializedLeafSchema = procedureLeafNodeSchema.safeExtend(
  {
    menuTracks: z.array(menuProcedureTrackSchema).length(1),
    shortcutTracks: z.array(procedureAuthoringExtendedShortcutMaterializedTrackSchema).length(1),
    mcpTracks: z.array(procedureAuthoringUnavailableMcpTrackSchema).length(1),
    validation: procedureLeafNodeSchema.shape.validation.safeExtend({
      status: z.literal('candidate'),
      validatedHostVersions: z.array(catalogVersionSchema).length(0),
    }),
  },
);

export const procedureAuthoringMcpMaterializedTreeSchema = procedureTreeSchema.safeExtend({
  formatVersion: procedureTreeFormatVersionSchema,
  nodes: z
    .array(procedureNodeSchema)
    .min(1)
    .superRefine((nodes, context) => {
      const availableMcpTracks = nodes.flatMap((node) =>
        node.kind === 'leaf'
          ? node.mcpTracks.filter((track) => track.availability === 'available')
          : [],
      );
      if (
        availableMcpTracks.length === 0 ||
        availableMcpTracks.some(
          (track) => !procedureAuthoringMaterializedMcpTrackSchema.safeParse(track).success,
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Materialization result 1.4.0 requires strict action-level MCP tracks',
        });
      }
      for (const node of nodes) {
        if (node.kind !== 'leaf') continue;
        for (const track of node.mcpTracks) {
          if (track.availability !== 'available') continue;
          const operation = track.operations[0];
          if (
            node.action === null ||
            operation === undefined ||
            operation.resultBinding !== `${node.id}.companion_state_report` ||
            !sameCanonicalJsonValue(operation.actionArguments, node.action.arguments)
          ) {
            context.addIssue({
              code: 'custom',
              path: ['nodes'],
              message:
                'Action-level MCP grounding must deep-copy the accepted leaf action arguments and bind its companion state report',
            });
          }
        }
      }
    }),
});
export type ProcedureAuthoringMcpMaterializedTree = z.infer<
  typeof procedureAuthoringMcpMaterializedTreeSchema
>;

export const procedureAuthoringOperationMcpMaterializedTreeSchema = procedureTreeSchema.safeExtend({
  formatVersion: procedureTreeFormatVersionSchema,
  nodes: z
    .array(procedureNodeSchema)
    .min(1)
    .superRefine((nodes, context) => {
      const availableMcpTracks = nodes.flatMap((node) =>
        node.kind === 'leaf'
          ? node.mcpTracks.filter((track) => track.availability === 'available')
          : [],
      );
      const hasOperationTrack = availableMcpTracks.some(
        (track) => procedureAuthoringMaterializedOperationMcpTrackSchema.safeParse(track).success,
      );
      if (
        !hasOperationTrack ||
        availableMcpTracks.some(
          (track) =>
            !procedureAuthoringMaterializedMcpTrackSchema.safeParse(track).success &&
            !procedureAuthoringMaterializedOperationMcpTrackSchema.safeParse(track).success,
        )
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Materialization result 1.5.0 requires strict operation-level MCP tracks and preserves strict action-level MCP tracks',
        });
      }
    }),
});
export type ProcedureAuthoringOperationMcpMaterializedTree = z.infer<
  typeof procedureAuthoringOperationMcpMaterializedTreeSchema
>;

export const procedureAuthoringMenuCandidateMaterializedTreeSchema = procedureTreeSchema
  .safeExtend({ formatVersion: z.literal(procedureTreeMenuCandidateFormatVersion) })
  .superRefine((tree, context) => {
    const candidates = tree.nodes.flatMap((node) =>
      node.kind === 'leaf' ? (node.menuCandidates ?? []) : [],
    );
    if (candidates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'Materialization result 1.6.0 requires at least one menu candidate',
      });
    }
    for (const node of tree.nodes) {
      if (node.kind !== 'leaf') continue;
      for (const track of node.mcpTracks) {
        if (track.availability !== 'available') continue;
        if (
          !procedureAuthoringMaterializedMcpTrackSchema.safeParse(track).success &&
          !procedureAuthoringMaterializedOperationMcpTrackSchema.safeParse(track).success
        ) {
          context.addIssue({
            code: 'custom',
            path: ['nodes'],
            message: 'Menu candidate materialization preserves strict MCP tracks',
          });
        }
      }
    }
  });
export type ProcedureAuthoringMenuCandidateMaterializedTree = z.infer<
  typeof procedureAuthoringMenuCandidateMaterializedTreeSchema
>;

const procedureAuthoringExtendedShortcutMaterializedNodeSchema = z.discriminatedUnion('kind', [
  procedureGroupNodeSchema,
  procedureAuthoringExtendedShortcutMaterializedLeafSchema,
]);

const procedureAuthoringExtendedShortcutMaterializedNodesSchema = z
  .array(procedureAuthoringExtendedShortcutMaterializedNodeSchema)
  .min(1)
  .superRefine((nodes, context) => {
    const hasPropertyUpdate = nodes.some(
      (node) =>
        node.kind === 'leaf' &&
        node.shortcutTracks.some(
          (track) =>
            track.availability === 'available' &&
            track.operations.some((operation) => operation.kind === 'operator_property_update'),
        ),
    );
    if (!hasPropertyUpdate) {
      context.addIssue({
        code: 'custom',
        message:
          'Materialization result 1.3.0 requires an operator_property_update shortcut operation',
      });
    }
  })
  .meta({
    contains: {
      type: 'object',
      properties: {
        kind: { const: 'leaf' },
        shortcutTracks: {
          type: 'array',
          contains: {
            type: 'object',
            properties: {
              availability: { const: 'available' },
              operations: {
                type: 'array',
                contains: {
                  type: 'object',
                  properties: { kind: { const: 'operator_property_update' } },
                  required: ['kind'],
                },
              },
            },
            required: ['availability', 'operations'],
          },
        },
      },
      required: ['kind', 'shortcutTracks'],
    },
  });

export const procedureAuthoringExtendedShortcutMaterializedTreeSchema =
  procedureTreeSchema.safeExtend({
    formatVersion: z.literal(procedureTreeExtendedShortcutFormatVersion),
    nodes: procedureAuthoringExtendedShortcutMaterializedNodesSchema,
  });
export type ProcedureAuthoringExtendedShortcutMaterializedTree = z.infer<
  typeof procedureAuthoringExtendedShortcutMaterializedTreeSchema
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

const procedureAuthoringExtendedShortcutMaterializationCoverageArraySchema = z
  .array(procedureAuthoringShortcutMaterializationCoverageSchema)
  .min(1)
  .superRefine((coverage, context) => {
    if (!coverage.some((entry) => entry.shortcut === 'materialized')) {
      context.addIssue({
        code: 'custom',
        message: 'Materialization result 1.3.0 requires at least one materialized shortcut',
      });
    }
  })
  .meta({ contains: materializedShortcutCoverageJsonSchema });

const procedureAuthoringMcpMaterializationCoverageSchema = z.strictObject({
  leafId: guideStepIdSchema,
  recipeId: guideStepIdSchema,
  menu: z.enum(['materialized', 'unavailable']),
  shortcut: z.enum(['materialized', 'unavailable']),
  mcp: z.literal('materialized'),
});

const procedureAuthoringMcpMaterializationCoverageArraySchema = z
  .array(
    z.union([
      procedureAuthoringMcpMaterializationCoverageSchema,
      procedureAuthoringShortcutMaterializationCoverageSchema,
    ]),
  )
  .min(1)
  .superRefine((coverage, context) => {
    if (!coverage.some((entry) => entry.mcp === 'materialized')) {
      context.addIssue({
        code: 'custom',
        message: 'Materialization result 1.4.0 requires at least one materialized MCP track',
      });
    }
  });

const procedureAuthoringMenuCandidateMaterializationCoverageArraySchema = z
  .array(
    z.union([
      procedureAuthoringMcpMaterializationCoverageSchema,
      procedureAuthoringShortcutMaterializationCoverageSchema,
    ]),
  )
  .min(1);

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

const procedureAuthoringExtendedShortcutMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringExtendedShortcutMaterializationCoverageArraySchema,
  tree: procedureAuthoringExtendedShortcutMaterializedTreeSchema,
} as const;

const procedureAuthoringMcpMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringMcpMaterializationCoverageArraySchema,
  tree: procedureAuthoringMcpMaterializedTreeSchema,
} as const;

const procedureAuthoringOperationMcpMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringMcpMaterializationCoverageArraySchema,
  tree: procedureAuthoringOperationMcpMaterializedTreeSchema,
} as const;

const procedureAuthoringMenuCandidateMaterializationResultShape = {
  ...procedureAuthoringMaterializationResultBaseShape,
  coverage: procedureAuthoringMenuCandidateMaterializationCoverageArraySchema,
  tree: procedureAuthoringMenuCandidateMaterializedTreeSchema,
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
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationExtendedShortcutFormatVersion),
    ...procedureAuthoringExtendedShortcutMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationMcpFormatVersion),
    ...procedureAuthoringMcpMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationOperationMcpFormatVersion),
    ...procedureAuthoringOperationMcpMaterializationResultShape,
  }),
  z.strictObject({
    formatVersion: z.literal(procedureAuthoringMaterializationMenuCandidateFormatVersion),
    ...procedureAuthoringMenuCandidateMaterializationResultShape,
  }),
]);
export type ProcedureAuthoringMaterializationResult = z.infer<
  typeof procedureAuthoringMaterializationResultSchema
>;
