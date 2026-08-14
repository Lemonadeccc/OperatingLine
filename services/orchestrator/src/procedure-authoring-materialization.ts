import { createHash } from 'node:crypto';

import {
  actionCatalogSchema,
  canonicalizeProtocolJsonValue,
  interactionCatalogSchema,
  parseProcedureTree,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializedTreeSchema,
  stableProcedureLeafOrder,
  validateActionArguments,
  validateActionCatalog,
  validateInteractionCatalog,
  type ActionCatalog,
  type InteractionCatalog,
  type MenuProcedureOperation,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringMaterializedTree,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafNode,
  type ProcedureTree,
} from '@operatingline/protocol';

import { isStableVersionRangeSubset } from './stable-version-ranges.js';

type MaterializationCoverage = ProcedureAuthoringMaterializationResult['coverage'];

export interface ProcedureAuthoringMaterialization {
  readonly tree: ProcedureAuthoringMaterializedTree;
  readonly coverage: MaterializationCoverage;
  readonly inputTreeContentSha256: string;
  readonly outputTreeContentSha256: string;
  readonly interactionCatalogContentSha256: string;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function candidateWithDeterministicPlaceholderTracks(
  candidate: ProcedureAuthoringCandidateTree,
): ProcedureTree {
  return parseProcedureTree({
    ...candidate,
    nodes: candidate.nodes.map((node) =>
      node.kind === 'group'
        ? structuredClone(node)
        : {
            ...node,
            menuTracks: [
              unavailableTrack(
                node,
                'menu',
                undefined,
                'Awaiting deterministic catalog materialization.',
              ),
            ],
            shortcutTracks: [
              unavailableTrack(
                node,
                'shortcut',
                undefined,
                'Awaiting deterministic catalog materialization.',
              ),
            ],
            mcpTracks: [
              unavailableTrack(
                node,
                'mcp',
                undefined,
                'Awaiting deterministic catalog materialization.',
              ),
            ],
          },
    ),
  });
}

function unavailableTrack<M extends 'menu' | 'shortcut' | 'mcp'>(
  leaf: ProcedureLeafNode,
  modality: M,
  recipe: InteractionCatalog['recipes'][number] | undefined,
  reason: string,
) {
  return {
    id: recipe === undefined ? `${leaf.id}.${modality}.unavailable` : `${recipe.id}.${modality}`,
    availability: 'unavailable' as const,
    title: recipe?.title ?? `${leaf.title} ${modality} track unavailable`,
    reason,
    modality,
  };
}

function menuTarget(
  target: InteractionCatalog['recipes'][number]['guidance']['steps'][number]['target'],
): MenuProcedureOperation['target'] {
  switch (target.kind) {
    case 'workspace':
    case 'editor':
    case 'mode':
    case 'menu':
    case 'menu_item':
    case 'operator':
    case 'control':
      return { kind: target.kind, hostId: target.hostId };
    default:
      throw new Error(`Native menu materialization cannot represent ${target.kind} targets`);
  }
}

function materializeLeaf(
  leaf: ProcedureLeafNode,
  recipe: InteractionCatalog['recipes'][number] | undefined,
): {
  readonly leaf: ProcedureLeafNode;
  readonly coverage: MaterializationCoverage[number];
} {
  const declaration = recipe?.procedureMaterialization;
  const nativeRecipe =
    recipe !== undefined && recipe.guidance.kind === 'native_path'
      ? { recipe, guidance: recipe.guidance }
      : undefined;
  const menuAvailable =
    declaration?.menu.availability === 'available' && nativeRecipe !== undefined;
  const semanticOperations = [...leaf.semanticOperations].sort(
    (left, right) => left.order - right.order,
  );
  const semanticRefs = semanticOperations.map((operation) => operation.id);
  const evidenceRefs = [
    ...new Set(semanticOperations.flatMap((operation) => operation.evidenceRefs)),
  ];

  const menuTracks = menuAvailable
    ? [
        {
          id: nativeRecipe!.recipe.id,
          availability: 'available' as const,
          title: nativeRecipe!.recipe.title,
          preconditions: structuredClone(nativeRecipe!.guidance.preconditions),
          modality: 'menu' as const,
          operations: [...nativeRecipe!.guidance.steps]
            .sort((left, right) => left.order - right.order)
            .map((step, index, orderedSteps) => ({
              id: step.id,
              order: step.order,
              semanticRefs: [...semanticRefs],
              description: step.label,
              evidenceRefs: [...evidenceRefs],
              intent: step.intent,
              target: menuTarget(step.target),
              path: orderedSteps.slice(0, index + 1).map((pathStep) => pathStep.label),
              parameters:
                step.id === nativeRecipe!.guidance.execution.stepId && leaf.action !== null
                  ? structuredClone(leaf.action.arguments)
                  : {},
            })),
        },
      ]
    : [
        unavailableTrack(
          leaf,
          'menu',
          recipe,
          declaration?.menu.availability === 'unavailable'
            ? declaration.menu.reason
            : recipe === undefined
              ? 'No InteractionCatalog recipe is available for this leaf action.'
              : 'The InteractionCatalog recipe does not declare menu materialization.',
        ),
      ];

  const shortcutTracks = [
    unavailableTrack(
      leaf,
      'shortcut',
      recipe,
      declaration?.shortcut.reason ??
        (recipe === undefined
          ? 'No InteractionCatalog recipe is available for this leaf action.'
          : 'The InteractionCatalog recipe does not declare shortcut materialization.'),
    ),
  ];
  const mcpTracks = [
    unavailableTrack(
      leaf,
      'mcp',
      recipe,
      declaration?.mcp.reason ??
        (recipe === undefined
          ? 'No InteractionCatalog recipe is available for this leaf action.'
          : 'The InteractionCatalog recipe does not declare MCP materialization.'),
    ),
  ];

  return {
    leaf: {
      ...leaf,
      action: structuredClone(leaf.action),
      semanticOperations: structuredClone(leaf.semanticOperations),
      menuTracks,
      shortcutTracks,
      mcpTracks,
      anchors: structuredClone(leaf.anchors),
      expectedObservations: structuredClone(leaf.expectedObservations),
      ...(leaf.observationPolicy === undefined
        ? {}
        : { observationPolicy: structuredClone(leaf.observationPolicy) }),
      rollback: structuredClone(leaf.rollback),
      validation: structuredClone(leaf.validation),
    },
    coverage: menuAvailable
      ? {
          leafId: leaf.id,
          recipeId: nativeRecipe!.recipe.id,
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        }
      : {
          leafId: leaf.id,
          recipeId: recipe?.id ?? null,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
  };
}

/** Deterministically ground a candidate tree from exact installed catalog snapshots. */
export function materializeProcedureAuthoringCandidate(
  treeInput: ProcedureAuthoringCandidateTree,
  actionCatalogInput: ActionCatalog,
  interactionCatalogInput: InteractionCatalog,
): ProcedureAuthoringMaterialization {
  const candidate = procedureAuthoringCandidateTreeSchema.parse(treeInput);
  const actionCatalog = actionCatalogSchema.parse(actionCatalogInput);
  const interactionCatalog = interactionCatalogSchema.parse(interactionCatalogInput);

  validateActionCatalog(actionCatalog);
  validateInteractionCatalog(interactionCatalog, actionCatalog);
  const validatedCandidate = candidateWithDeterministicPlaceholderTracks(candidate);

  if (
    candidate.adapterId !== actionCatalog.adapterId ||
    candidate.adapterId !== interactionCatalog.adapterId ||
    candidate.actionCatalogVersion !== actionCatalog.catalogVersion ||
    candidate.interactionCatalogVersion !== interactionCatalog.catalogVersion ||
    interactionCatalog.actionCatalogVersion !== actionCatalog.catalogVersion
  ) {
    throw new Error('Procedure authoring materialization catalog binding mismatch');
  }
  if (
    candidate.hostVersionRange !== interactionCatalog.hostVersionRange ||
    !isStableVersionRangeSubset(interactionCatalog.hostVersionRange, actionCatalog.hostVersionRange)
  ) {
    throw new Error('Procedure authoring materialization host version binding mismatch');
  }
  if (
    !isStableVersionRangeSubset(
      interactionCatalog.adapterVersionRange,
      actionCatalog.adapterVersionRange,
    )
  ) {
    throw new Error('Procedure authoring materialization adapter version binding mismatch');
  }

  const actionsByName = new Map(actionCatalog.actions.map((action) => [action.name, action]));
  const recipesByAction = new Map(
    interactionCatalog.recipes.map((recipe) => [recipe.actionName, recipe]),
  );
  const orderedCandidateLeaves = stableProcedureLeafOrder(validatedCandidate);
  for (const leaf of orderedCandidateLeaves) {
    if (leaf.action === null) continue;
    const action = actionsByName.get(leaf.action.name);
    if (action === undefined) {
      throw new Error(
        `Procedure leaf ${leaf.id} uses action absent from the installed ActionCatalog`,
      );
    }
    const argumentErrors = validateActionArguments(leaf.action.arguments, action.argumentsSchema);
    if (argumentErrors.length > 0) {
      throw new Error(
        `Procedure leaf ${leaf.id} action arguments violate ${leaf.action.name}: ${argumentErrors.join('; ')}`,
      );
    }
  }

  const materializedByLeafId = new Map<string, ReturnType<typeof materializeLeaf>>();
  for (const leaf of orderedCandidateLeaves) {
    const recipe = leaf.action === null ? undefined : recipesByAction.get(leaf.action.name);
    materializedByLeafId.set(leaf.id, materializeLeaf(leaf, recipe));
  }

  const tree = procedureAuthoringMaterializedTreeSchema.parse(
    parseProcedureTree({
      ...candidate,
      actionCatalogVersion: actionCatalog.catalogVersion,
      interactionCatalogVersion: interactionCatalog.catalogVersion,
      nodes: validatedCandidate.nodes.map((node) =>
        node.kind === 'leaf' ? materializedByLeafId.get(node.id)!.leaf : structuredClone(node),
      ),
    }),
  );
  const coverage = stableProcedureLeafOrder(tree).map(
    (leaf) => materializedByLeafId.get(leaf.id)!.coverage,
  );

  return {
    tree,
    coverage,
    inputTreeContentSha256: sha256(candidate),
    outputTreeContentSha256: sha256(tree),
    interactionCatalogContentSha256: sha256(interactionCatalog),
  };
}
