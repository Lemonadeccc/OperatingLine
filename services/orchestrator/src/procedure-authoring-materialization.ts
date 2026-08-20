import { createHash } from 'node:crypto';

import {
  actionCatalogSchema,
  canonicalizeProtocolJsonValue,
  interactionCatalogSchema,
  parseProcedureTree,
  procedureAuthoringExtendedShortcutMaterializedTreeSchema,
  procedureAuthoringMaterializationExtendedShortcutFormatVersion,
  procedureAuthoringMaterializationMcpFormatVersion,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationFormatVersion,
  procedureAuthoringMaterializationLegacyFormatVersion,
  procedureAuthoringMaterializationOrderedMenuFormatVersion,
  procedureAuthoringMaterializedTreeSchema,
  procedureAuthoringMcpMaterializedTreeSchema,
  procedureParameterProjectionFormatVersion,
  projectProcedureParameter,
  procedureTreeExtendedShortcutFormatVersion,
  procedureTreeFormatVersion,
  stableProcedureLeafOrder,
  validateActionArguments,
  validateActionCatalog,
  validateInteractionCatalog,
  writeProcedureParameterPath,
  type ActionCatalog,
  type InteractionCatalog,
  type MenuProcedureOperation,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringMaterializedTree,
  type ProcedureAuthoringExtendedShortcutMaterializedTree,
  type ProcedureAuthoringMcpMaterializedTree,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafNode,
  type ProcedureParameterBinding,
  type ProcedureParameterProjection,
  type ProcedureParameterProjectionTarget,
  type ProcedureTree,
} from '@operatingline/protocol';

import { isStableVersionRangeSubset } from './stable-version-ranges.js';

type MaterializationCoverage = ProcedureAuthoringMaterializationResult['coverage'];

export interface ProcedureAuthoringMaterialization {
  readonly formatVersion:
    | typeof procedureAuthoringMaterializationLegacyFormatVersion
    | typeof procedureAuthoringMaterializationOrderedMenuFormatVersion
    | typeof procedureAuthoringMaterializationFormatVersion
    | typeof procedureAuthoringMaterializationExtendedShortcutFormatVersion
    | typeof procedureAuthoringMaterializationMcpFormatVersion;
  readonly tree:
    | ProcedureAuthoringMaterializedTree
    | ProcedureAuthoringExtendedShortcutMaterializedTree
    | ProcedureAuthoringMcpMaterializedTree;
  readonly coverage: MaterializationCoverage;
  readonly inputTreeContentSha256: string;
  readonly outputTreeContentSha256: string;
  readonly interactionCatalogContentSha256: string;
}

interface MaterializationParameterAssignment {
  readonly name: string;
  readonly source:
    | {
        readonly kind: 'literal';
        readonly value: MenuProcedureOperation['parameters'][string];
      }
    | {
        readonly kind: 'action_argument';
        readonly argumentName: string;
        readonly transform:
          | 'identity'
          | 'uniform_vector3'
          | 'divide_by_two'
          | 'vector3_x'
          | 'vector3_y'
          | 'vector3_z';
      }
    | {
        readonly kind: 'derived_action_arguments';
        readonly derivation: 'segment_frame';
        readonly startArgumentName: string;
        readonly endArgumentName: string;
        readonly output: 'distance' | 'midpoint' | 'rotation_euler_xyz_align_z';
      };
}

type SegmentFrameOutput = 'distance' | 'midpoint' | 'rotation_euler_xyz_align_z';
type FiniteVector3 = readonly [number, number, number];

function finiteVector3(value: unknown, label: string): FiniteVector3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => typeof component !== 'number' || !Number.isFinite(component))
  ) {
    throw new Error(`${label} must be a finite numeric vector3`);
  }
  return value as unknown as FiniteVector3;
}

function canonicalFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

export function deriveSegmentFrameParameter(
  startValue: unknown,
  endValue: unknown,
  output: SegmentFrameOutput,
): number | [number, number, number] {
  const start = finiteVector3(startValue, 'Segment frame start');
  const end = finiteVector3(endValue, 'Segment frame end');
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const horizontal = Math.hypot(dx, dy);
  const distance = Math.hypot(horizontal, dz);
  if (!Number.isFinite(distance) || distance === 0) {
    throw new Error('Segment frame requires distinct finite endpoints with nonzero distance');
  }

  if (output === 'distance') return canonicalFiniteNumber(distance, 'Segment frame distance');

  const result =
    output === 'midpoint'
      ? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]
      : output === 'rotation_euler_xyz_align_z'
        ? [0, Math.atan2(horizontal, dz), horizontal === 0 ? 0 : Math.atan2(dy, dx)]
        : undefined;
  if (result === undefined) throw new Error(`Unsupported segment frame output: ${String(output)}`);
  return result.map((component) =>
    canonicalFiniteNumber(component, `Segment frame ${output} component`),
  ) as [number, number, number];
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

function materializeParameters(
  assignments: readonly MaterializationParameterAssignment[],
  actionArguments: Readonly<Record<string, MenuProcedureOperation['parameters'][string]>>,
): MenuProcedureOperation['parameters'] {
  const parameters = Object.create(null) as MenuProcedureOperation['parameters'];
  const defineParameter = (
    name: string,
    value: MenuProcedureOperation['parameters'][string],
  ): void => {
    Object.defineProperty(parameters, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  for (const assignment of assignments) {
    const source = assignment.source;
    if (source.kind === 'literal') {
      defineParameter(assignment.name, structuredClone(source.value));
      continue;
    }
    if (source.kind === 'derived_action_arguments') {
      const start = actionArguments[source.startArgumentName];
      const end = actionArguments[source.endArgumentName];
      if (start === undefined || end === undefined) {
        throw new Error(
          `Ordered parameter ${assignment.name} references missing segment frame action arguments ${source.startArgumentName}/${source.endArgumentName}`,
        );
      }
      defineParameter(assignment.name, deriveSegmentFrameParameter(start, end, source.output));
      continue;
    }
    const argument = actionArguments[source.argumentName];
    if (argument === undefined) {
      throw new Error(
        `Ordered parameter ${assignment.name} references missing action argument ${source.argumentName}`,
      );
    }
    if (source.transform === 'identity') {
      defineParameter(assignment.name, structuredClone(argument));
      continue;
    }
    if (source.transform === 'divide_by_two') {
      if (typeof argument !== 'number' || !Number.isFinite(argument)) {
        throw new Error(
          `Ordered parameter ${assignment.name} requires a finite numeric action argument`,
        );
      }
      const value = argument / 2;
      if (!Number.isFinite(value)) {
        throw new Error(`Ordered parameter ${assignment.name} produced a non-finite value`);
      }
      defineParameter(assignment.name, Object.is(value, -0) ? 0 : value);
      continue;
    }
    if (source.transform === 'uniform_vector3') {
      if (typeof argument !== 'number' || !Number.isFinite(argument)) {
        throw new Error(
          `Ordered parameter ${assignment.name} requires a finite numeric action argument`,
        );
      }
      defineParameter(assignment.name, [argument, argument, argument]);
      continue;
    }
    if (
      !Array.isArray(argument) ||
      argument.length !== 3 ||
      argument.some((component) => typeof component !== 'number' || !Number.isFinite(component))
    ) {
      throw new Error(
        `Ordered parameter ${assignment.name} requires a finite numeric vector3 action argument`,
      );
    }
    const componentIndex =
      source.transform === 'vector3_x' ? 0 : source.transform === 'vector3_y' ? 1 : 2;
    defineParameter(assignment.name, argument[componentIndex]!);
  }
  return parameters;
}

function directParameterBinding(
  id: string,
  modality: 'menu' | 'shortcut',
  trackId: string,
  operationId: string,
  assignment: MaterializationParameterAssignment,
): ProcedureParameterBinding | null {
  if (assignment.source.kind === 'literal') return null;
  if (assignment.source.kind === 'derived_action_arguments') {
    throw new Error(
      'Catalog semantic parameter projection does not yet support derived multi-argument interaction parameters',
    );
  }
  return {
    id,
    actionArgument: assignment.source.argumentName,
    transform: assignment.source.transform,
    target: {
      modality,
      trackId,
      operationId,
      path: [{ kind: 'field', name: assignment.name }],
    },
  };
}

function materializeParameterProjection(
  leaf: ProcedureLeafNode,
  recipe: InteractionCatalog['recipes'][number] | undefined,
  interactionCatalogVersion: string,
): ProcedureParameterProjection | undefined {
  const declaration = recipe?.procedureMaterialization;
  const semantic = declaration?.semantic;
  if (
    leaf.action === null ||
    recipe === undefined ||
    declaration === undefined ||
    semantic === undefined
  ) {
    return undefined;
  }

  const bindings: ProcedureParameterBinding[] = [];
  for (const projection of semantic.projections) {
    const operations = leaf.semanticOperations.filter(
      (operation) => operation.semanticAction === projection.semanticAction,
    );
    if (operations.length !== 1) {
      throw new Error(
        `Interaction recipe ${recipe.id} semantic projection ${projection.id} requires exactly one ${projection.semanticAction} operation`,
      );
    }
    bindings.push({
      id: `binding.semantic.${projection.id}`,
      actionArgument: projection.actionArgument,
      transform: projection.transform,
      target: {
        modality: 'semantic',
        operationId: operations[0]!.id,
        path: structuredClone(projection.path),
      },
    });
  }

  const menu = declaration.menu;
  if (menu.availability === 'available') {
    if (menu.parameterBinding === 'accepted_action_arguments') {
      const executionOperationId =
        recipe.guidance.kind === 'native_path' ? recipe.guidance.execution.stepId : undefined;
      if (executionOperationId === undefined) {
        throw new Error(`Interaction recipe ${recipe.id} has no native menu execution operation`);
      }
      for (const actionArgument of Object.keys(leaf.action.arguments).sort()) {
        bindings.push({
          id: `binding.menu.${executionOperationId}.${actionArgument}`,
          actionArgument,
          transform: 'identity',
          target: {
            modality: 'menu',
            trackId: recipe.id,
            operationId: executionOperationId,
            path: [{ kind: 'field', name: actionArgument }],
          },
        });
      }
    } else {
      const assignments = [
        {
          operationId:
            recipe.guidance.kind === 'native_path' ? recipe.guidance.execution.stepId : '',
          parameters: menu.operatorParameters,
        },
        ...menu.controlOperations.operations.map((operation) => ({
          operationId: operation.id,
          parameters: operation.parameters,
        })),
      ];
      for (const operation of assignments) {
        for (const assignment of operation.parameters) {
          const binding = directParameterBinding(
            `binding.menu.${operation.operationId}.${assignment.name}`,
            'menu',
            recipe.id,
            operation.operationId,
            assignment,
          );
          if (binding !== null) bindings.push(binding);
        }
      }
    }
  }

  const shortcut = declaration.shortcut;
  if (shortcut.availability === 'available') {
    const trackId = `${recipe.id}.shortcut`;
    for (const operation of shortcut.operations) {
      for (const assignment of operation.parameters) {
        const binding = directParameterBinding(
          `binding.shortcut.${operation.id}.${assignment.name}`,
          'shortcut',
          trackId,
          operation.id,
          assignment,
        );
        if (binding !== null) bindings.push(binding);
      }
    }
  }

  const bindingIdsByArgument = new Map<string, string[]>();
  for (const binding of bindings) {
    bindingIdsByArgument.set(binding.actionArgument, [
      ...(bindingIdsByArgument.get(binding.actionArgument) ?? []),
      binding.id,
    ]);
  }
  const semanticOmissions = new Map(
    semantic.omittedActionArguments.map((omission) => [omission.argumentName, omission.reason]),
  );
  const argumentsCoverage = Object.keys(leaf.action.arguments)
    .sort()
    .map((actionArgument) => {
      const bindingIds = bindingIdsByArgument.get(actionArgument) ?? [];
      if (bindingIds.length > 0) {
        return {
          actionArgument,
          disposition: 'projected' as const,
          bindingIds: bindingIds.sort(),
        };
      }
      const reason = semanticOmissions.get(actionArgument);
      if (reason === undefined) {
        throw new Error(
          `Interaction recipe ${recipe.id} does not prove complete parameter projection for ${actionArgument}`,
        );
      }
      return {
        actionArgument,
        disposition: 'omitted' as const,
        bindingIds: [],
        reason,
      };
    });

  return {
    formatVersion: procedureParameterProjectionFormatVersion,
    provenance: {
      kind: 'interaction_catalog_materialization',
      interactionCatalogVersion,
      recipeId: recipe.id,
    },
    arguments: argumentsCoverage,
    bindings,
  };
}

function catalogRecipeForLeaf(
  leaf: ProcedureLeafNode,
  interactionCatalog: InteractionCatalog,
): InteractionCatalog['recipes'][number] | undefined {
  if (leaf.action === null) return undefined;
  const recipe = interactionCatalog.recipes.find(
    (candidate) => candidate.actionName === leaf.action?.name,
  );
  if (recipe === undefined) {
    throw new Error(
      `InteractionCatalog ${interactionCatalog.catalogVersion} has no recipe for ${leaf.action.name}`,
    );
  }
  return recipe;
}

function assertProjectionCatalogIdentity(
  tree: ProcedureTree,
  interactionCatalog: InteractionCatalog,
): void {
  if (
    tree.adapterId !== interactionCatalog.adapterId ||
    tree.actionCatalogVersion !== interactionCatalog.actionCatalogVersion ||
    tree.interactionCatalogVersion !== interactionCatalog.catalogVersion ||
    tree.hostVersionRange !== interactionCatalog.hostVersionRange
  ) {
    throw new Error('Procedure parameter projection InteractionCatalog binding mismatch');
  }
}

function assertLeafProjectionAuthority(
  leaf: ProcedureLeafNode,
  interactionCatalog: InteractionCatalog,
): void {
  const expected = materializeParameterProjection(
    leaf,
    catalogRecipeForLeaf(leaf, interactionCatalog),
    interactionCatalog.catalogVersion,
  );
  if (sha256(expected ?? null) !== sha256(leaf.parameterProjection ?? null)) {
    throw new Error(
      `Procedure leaf ${leaf.id} parameter projection does not match its InteractionCatalog recipe`,
    );
  }
}

/** Prove every projection receipt against the exact installed InteractionCatalog recipe. */
export function validateProcedureTreeParameterProjectionCatalog(
  tree: ProcedureTree,
  interactionCatalog: InteractionCatalog,
): void {
  assertProjectionCatalogIdentity(tree, interactionCatalog);
  for (const node of tree.nodes) {
    if (node.kind === 'leaf') assertLeafProjectionAuthority(node, interactionCatalog);
  }
}

function mutableProjectionParameters(
  leaf: ProcedureLeafNode,
  target: ProcedureParameterProjectionTarget,
): Record<string, unknown> {
  if (target.modality === 'semantic') {
    const operation = leaf.semanticOperations.find(
      (candidate) => candidate.id === target.operationId,
    );
    if (operation === undefined)
      throw new Error(`Missing semantic operation ${target.operationId}`);
    return operation.parameters;
  }
  if (target.modality === 'menu') {
    const track = leaf.menuTracks.find((candidate) => candidate.id === target.trackId);
    const operation =
      track?.availability === 'available'
        ? track.operations.find((candidate) => candidate.id === target.operationId)
        : undefined;
    if (operation === undefined) throw new Error(`Missing menu operation ${target.operationId}`);
    return operation.parameters;
  }
  if (target.modality === 'shortcut') {
    const track = leaf.shortcutTracks.find((candidate) => candidate.id === target.trackId);
    const operation =
      track?.availability === 'available'
        ? track.operations.find((candidate) => candidate.id === target.operationId)
        : undefined;
    if (operation === undefined)
      throw new Error(`Missing shortcut operation ${target.operationId}`);
    return operation.parameters;
  }
  const track = leaf.mcpTracks.find((candidate) => candidate.id === target.trackId);
  const operation =
    track?.availability === 'available'
      ? track.operations.find((candidate) => candidate.id === target.operationId)
      : undefined;
  if (operation === undefined) throw new Error(`Missing MCP operation ${target.operationId}`);
  return operation.arguments;
}

/** Apply only catalog-proven action-argument projections to an editor candidate clone. */
export function projectProcedureTreeCatalogParameters(
  tree: ProcedureTree,
  interactionCatalog: InteractionCatalog,
): ProcedureTree {
  assertProjectionCatalogIdentity(tree, interactionCatalog);
  const projected = structuredClone(tree);
  for (const node of projected.nodes) {
    if (node.kind !== 'leaf') continue;
    assertLeafProjectionAuthority(node, interactionCatalog);
    if (node.action === null || node.parameterProjection === undefined) continue;
    for (const binding of node.parameterProjection.bindings) {
      writeProcedureParameterPath(
        mutableProjectionParameters(node, binding.target),
        binding.target.path,
        projectProcedureParameter(node.action.arguments[binding.actionArgument], binding.transform),
      );
    }
  }
  return projected;
}

function materializeSemanticParameters(
  leaf: ProcedureLeafNode,
  recipe: InteractionCatalog['recipes'][number] | undefined,
): ProcedureLeafNode['semanticOperations'] {
  const operations = structuredClone(leaf.semanticOperations);
  const semantic = recipe?.procedureMaterialization?.semantic;
  if (leaf.action === null || recipe === undefined || semantic === undefined) return operations;
  for (const projection of semantic.projections) {
    const matches = operations.filter(
      (operation) => operation.semanticAction === projection.semanticAction,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Interaction recipe ${recipe.id} semantic projection ${projection.id} requires exactly one ${projection.semanticAction} operation`,
      );
    }
    writeProcedureParameterPath(
      matches[0]!.parameters,
      projection.path,
      projectProcedureParameter(
        leaf.action.arguments[projection.actionArgument],
        projection.transform,
      ),
    );
  }
  return operations;
}

function materializeLeaf(
  leaf: ProcedureLeafNode,
  recipe: InteractionCatalog['recipes'][number] | undefined,
  interactionCatalogVersion: string,
  normalizeShortcutOperations: boolean,
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
  const orderedMenuDeclaration =
    declaration?.menu.availability === 'available' &&
    declaration.menu.parameterBinding === 'ordered_parameter_operations'
      ? declaration.menu
      : undefined;
  const shortcutDeclaration =
    declaration?.shortcut.availability === 'available' ? declaration.shortcut : undefined;
  const mcpDeclaration =
    declaration?.mcp.availability === 'available' ? declaration.mcp : undefined;
  const projectedSemanticOperations = materializeSemanticParameters(leaf, recipe);
  const semanticOperations = [...projectedSemanticOperations].sort(
    (left, right) => left.order - right.order,
  );
  const semanticRefs = semanticOperations.map((operation) => operation.id);
  const evidenceRefs = [
    ...new Set(semanticOperations.flatMap((operation) => operation.evidenceRefs)),
  ];

  const menuTracks = menuAvailable
    ? (() => {
        const orderedGuidanceSteps = [...nativeRecipe!.guidance.steps].sort(
          (left, right) => left.order - right.order,
        );
        const actionArguments = leaf.action?.arguments ?? {};
        const guidanceOperations = orderedGuidanceSteps.map((step, index) => ({
          id: step.id,
          order: step.order,
          semanticRefs: [...semanticRefs],
          description: step.label,
          evidenceRefs: [...evidenceRefs],
          intent: step.intent,
          target: menuTarget(step.target),
          path: orderedGuidanceSteps.slice(0, index + 1).map((pathStep) => pathStep.label),
          parameters:
            step.id === nativeRecipe!.guidance.execution.stepId && leaf.action !== null
              ? orderedMenuDeclaration === undefined
                ? structuredClone(leaf.action.arguments)
                : materializeParameters(orderedMenuDeclaration.operatorParameters, actionArguments)
              : {},
        }));
        const controlOperations =
          orderedMenuDeclaration?.controlOperations.operations.map((operation, index) => ({
            id: operation.id,
            order: orderedGuidanceSteps.length + index + 1,
            semanticRefs: [...semanticRefs],
            description: operation.label,
            evidenceRefs: [...evidenceRefs],
            intent: 'configure' as const,
            target: structuredClone(operation.target),
            path: [...operation.path],
            parameters: materializeParameters(operation.parameters, actionArguments),
          })) ?? [];
        return [
          {
            id: nativeRecipe!.recipe.id,
            availability: 'available' as const,
            title: nativeRecipe!.recipe.title,
            preconditions: structuredClone(nativeRecipe!.guidance.preconditions),
            modality: 'menu' as const,
            operations: [...guidanceOperations, ...controlOperations],
          },
        ];
      })()
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

  const shortcutTracks =
    shortcutDeclaration === undefined
      ? [
          unavailableTrack(
            leaf,
            'shortcut',
            recipe,
            declaration?.shortcut.availability === 'unavailable'
              ? declaration.shortcut.reason
              : recipe === undefined
                ? 'No InteractionCatalog recipe is available for this leaf action.'
                : 'The InteractionCatalog recipe does not declare shortcut materialization.',
          ),
        ]
      : [
          {
            id: `${recipe!.id}.shortcut`,
            availability: 'available' as const,
            title: `${recipe!.title} shortcut projection`,
            preconditions: structuredClone(shortcutDeclaration.preconditions),
            modality: 'shortcut' as const,
            ...(shortcutDeclaration.proofExecution === undefined
              ? {}
              : { proofExecution: structuredClone(shortcutDeclaration.proofExecution) }),
            operations: shortcutDeclaration.operations.map((operation, index) => {
              const common = {
                id: operation.id,
                order: index + 1,
                semanticRefs: [...semanticRefs],
                description: operation.label,
                evidenceRefs: [...evidenceRefs],
              };
              if ('kind' in operation && operation.kind === 'operator_property_update') {
                const materializedParameters = materializeParameters(
                  operation.parameters,
                  leaf.action?.arguments ?? {},
                );
                return {
                  ...common,
                  kind: operation.kind,
                  surfaceOperationId: operation.surfaceOperationId,
                  target: structuredClone(operation.target),
                  path: [...operation.path],
                  parameters: { value: materializedParameters['value']! },
                };
              }
              const keyInput = {
                ...common,
                keyMode: operation.keyMode,
                keys: [...operation.keys],
                ...(operation.selectionPath === undefined
                  ? {}
                  : { selectionPath: [...operation.selectionPath] }),
                parameters: materializeParameters(
                  operation.parameters,
                  leaf.action?.arguments ?? {},
                ),
                ...('kind' in operation && operation.opensSurface !== undefined
                  ? { opensSurface: structuredClone(operation.opensSurface) }
                  : {}),
                ...('kind' in operation && operation.closesSurfaceOperationId !== undefined
                  ? { closesSurfaceOperationId: operation.closesSurfaceOperationId }
                  : {}),
              };
              return normalizeShortcutOperations || 'kind' in operation
                ? { ...keyInput, kind: 'key_input' as const }
                : keyInput;
            }),
          },
        ];
  const mcpTracks =
    mcpDeclaration === undefined
      ? [
          unavailableTrack(
            leaf,
            'mcp',
            recipe,
            declaration?.mcp.availability === 'unavailable'
              ? declaration.mcp.reason
              : recipe === undefined
                ? 'No InteractionCatalog recipe is available for this leaf action.'
                : 'The InteractionCatalog recipe does not declare MCP materialization.',
          ),
        ]
      : [
          {
            id: `${recipe!.id}.mcp`,
            availability: 'available' as const,
            title: `${recipe!.title} action-level MCP projection`,
            preconditions: [],
            modality: 'mcp' as const,
            operations: [
              {
                id: `${recipe!.id}.mcp.execute`,
                order: 1,
                semanticRefs: [...semanticRefs],
                description: `Execute ${leaf.action!.name} as the accepted replay next step`,
                evidenceRefs: [...evidenceRefs],
                serverName: mcpDeclaration.serverName,
                toolName: mcpDeclaration.toolName,
                arguments: {
                  formatVersion: '1.0.0',
                  requestId: '$runtime.requestId',
                  replayId: '$runtime.replayId',
                  expectedState: '$runtime.expectedState',
                },
                argumentSource: 'accepted_leaf_action' as const,
                actionArguments: structuredClone(leaf.action!.arguments),
                resultBinding: `${leaf.id}.companion_state_report`,
              },
            ],
          },
        ];

  const baseCoverage: Omit<MaterializationCoverage[number], 'mcp'> = menuAvailable
    ? shortcutDeclaration === undefined
      ? {
          leafId: leaf.id,
          recipeId: recipe!.id,
          menu: 'materialized',
          shortcut: 'unavailable',
        }
      : {
          leafId: leaf.id,
          recipeId: recipe!.id,
          menu: 'materialized',
          shortcut: 'materialized',
        }
    : shortcutDeclaration === undefined
      ? {
          leafId: leaf.id,
          recipeId: recipe?.id ?? null,
          menu: 'unavailable',
          shortcut: 'unavailable',
        }
      : {
          leafId: leaf.id,
          recipeId: recipe!.id,
          menu: 'unavailable',
          shortcut: 'materialized',
        };
  const coverage = {
    ...baseCoverage,
    mcp: mcpDeclaration === undefined ? ('unavailable' as const) : ('materialized' as const),
  } as MaterializationCoverage[number];

  const parameterProjection = materializeParameterProjection(
    { ...leaf, semanticOperations: projectedSemanticOperations },
    recipe,
    interactionCatalogVersion,
  );

  return {
    leaf: {
      ...leaf,
      action: structuredClone(leaf.action),
      semanticOperations: projectedSemanticOperations,
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
      ...(parameterProjection === undefined ? {} : { parameterProjection }),
    },
    coverage,
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
  const usesOrderedParameterOperations = orderedCandidateLeaves.some((leaf) => {
    const recipe = leaf.action === null ? undefined : recipesByAction.get(leaf.action.name);
    return (
      recipe?.procedureMaterialization?.menu.availability === 'available' &&
      recipe.procedureMaterialization.menu.parameterBinding === 'ordered_parameter_operations'
    );
  });
  const usesShortcutMaterialization = orderedCandidateLeaves.some((leaf) => {
    const recipe = leaf.action === null ? undefined : recipesByAction.get(leaf.action.name);
    return recipe?.procedureMaterialization?.shortcut.availability === 'available';
  });
  const usesExtendedShortcutMaterialization = orderedCandidateLeaves.some((leaf) => {
    const recipe = leaf.action === null ? undefined : recipesByAction.get(leaf.action.name);
    return (
      recipe?.procedureMaterialization?.shortcut.availability === 'available' &&
      recipe.procedureMaterialization.shortcut.operations.some(
        (operation) => 'kind' in operation && operation.kind === 'operator_property_update',
      )
    );
  });
  const usesMcpMaterialization = orderedCandidateLeaves.some((leaf) => {
    const recipe = leaf.action === null ? undefined : recipesByAction.get(leaf.action.name);
    return recipe?.procedureMaterialization?.mcp.availability === 'available';
  });
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
    materializedByLeafId.set(
      leaf.id,
      materializeLeaf(
        leaf,
        recipe,
        interactionCatalog.catalogVersion,
        usesExtendedShortcutMaterialization,
      ),
    );
  }

  const parsedTree = parseProcedureTree({
    ...candidate,
    formatVersion: usesExtendedShortcutMaterialization
      ? procedureTreeExtendedShortcutFormatVersion
      : procedureTreeFormatVersion,
    actionCatalogVersion: actionCatalog.catalogVersion,
    interactionCatalogVersion: interactionCatalog.catalogVersion,
    nodes: validatedCandidate.nodes.map((node) =>
      node.kind === 'leaf' ? materializedByLeafId.get(node.id)!.leaf : structuredClone(node),
    ),
  });
  validateProcedureTreeParameterProjectionCatalog(parsedTree, interactionCatalog);
  const tree = usesMcpMaterialization
    ? procedureAuthoringMcpMaterializedTreeSchema.parse(parsedTree)
    : usesExtendedShortcutMaterialization
      ? procedureAuthoringExtendedShortcutMaterializedTreeSchema.parse(parsedTree)
      : procedureAuthoringMaterializedTreeSchema.parse(parsedTree);
  const coverage = stableProcedureLeafOrder(tree).map(
    (leaf) => materializedByLeafId.get(leaf.id)!.coverage,
  );

  return {
    formatVersion: usesMcpMaterialization
      ? procedureAuthoringMaterializationMcpFormatVersion
      : usesExtendedShortcutMaterialization
        ? procedureAuthoringMaterializationExtendedShortcutFormatVersion
        : usesShortcutMaterialization
          ? procedureAuthoringMaterializationFormatVersion
          : usesOrderedParameterOperations
            ? procedureAuthoringMaterializationOrderedMenuFormatVersion
            : procedureAuthoringMaterializationLegacyFormatVersion,
    tree,
    coverage,
    inputTreeContentSha256: sha256(candidate),
    outputTreeContentSha256: sha256(tree),
    interactionCatalogContentSha256: sha256(interactionCatalog),
  };
}
