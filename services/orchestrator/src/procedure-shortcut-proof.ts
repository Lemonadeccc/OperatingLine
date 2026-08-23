import { createHash } from 'node:crypto';

import {
  canonicalizeProtocolJsonValue,
  computeProcedureShortcutProofBindingContentSha256,
  computeProcedureShortcutProofProposalRecordContentSha256,
  meshEditSubdivideShortcutProofOperationIds,
  procedureShortcutProofBindingSchema,
  procedureShortcutProofFormatVersion,
  procedureShortcutProofProposalRecordSchema,
  protocolJsonValueCanonicalization,
  subdivisionSurfaceShortcutProofOperationIds,
  type ActionCatalog,
  type CompanionStateReport,
  type GuideProposal,
  type GuideProposalDecision,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureShortcutProofBinding,
  type ProcedureShortcutProofProposalRecord,
  type ProcedureShortcutProofProposalRequest,
} from '@operatingline/protocol';

const subdivisionSurfaceActionName = 'blender.modifier.add_subdivision_surface' as const;
const subdivisionSurfaceRecipeId = 'blender.modifier.add_subdivision_surface.semantic' as const;
const subdivisionSurfaceTargetProfile = 'factory_cube_8_12_6' as const;
const meshEditSubdivideActionName = 'blender.mesh.edit_subdivide' as const;
const meshEditSubdivideRecipeId = 'blender.mesh.edit_subdivide.semantic' as const;
const meshEditSubdivideTargetProfile = 'factory_cube_single_user_mesh_8_12_6' as const;
const targetId = 'tutorial.cube' as const;
const modifierId = 'tutorial.cube.subdivision_surface' as const;
const modifierName = 'OperatingLine.Cube.SubdivisionSurface' as const;

function hasExactFactoryCubeObjectAnchor(
  anchors: readonly { readonly kind: string; readonly objectName?: string }[],
): boolean {
  const objectAnchors = anchors.filter((anchor) => anchor.kind === 'object');
  return objectAnchors.length === 1 && objectAnchors[0]?.objectName === 'Cube';
}

function hasExactMeshSubdivideOperatorAnchor(
  anchors: readonly { readonly kind: string; readonly operatorId?: string }[],
): boolean {
  const operatorAnchors = anchors.filter((anchor) => anchor.kind === 'operator');
  return operatorAnchors.length === 1 && operatorAnchors[0]?.operatorId === 'mesh.subdivide';
}

function hasNoOperatorAnchor(anchors: readonly { readonly kind: string }[]): boolean {
  return anchors.every((anchor) => anchor.kind !== 'operator');
}

function isExactSubdivisionSurfaceArguments(
  argumentsValue: Readonly<Record<string, unknown>>,
): boolean {
  return (
    argumentsValue['targetId'] === targetId &&
    argumentsValue['modifierId'] === modifierId &&
    argumentsValue['modifierName'] === modifierName &&
    [1, 2, 3].includes(argumentsValue['viewportLevel'] as number) &&
    sameCanonicalValue(argumentsValue, {
      targetId: argumentsValue['targetId'],
      modifierId: argumentsValue['modifierId'],
      modifierName: argumentsValue['modifierName'],
      viewportLevel: argumentsValue['viewportLevel'],
    })
  );
}

function isExactMeshEditSubdivideArguments(
  argumentsValue: Readonly<Record<string, unknown>>,
): boolean {
  const cuts = argumentsValue['cuts'];
  const smooth = argumentsValue['smooth'];
  return (
    argumentsValue['targetId'] === targetId &&
    typeof argumentsValue['resultMeshId'] === 'string' &&
    argumentsValue['resultMeshId'].length > 0 &&
    typeof argumentsValue['resultMeshName'] === 'string' &&
    argumentsValue['resultMeshName'].length > 0 &&
    typeof cuts === 'number' &&
    Number.isInteger(cuts) &&
    cuts >= 1 &&
    cuts <= 8 &&
    typeof smooth === 'number' &&
    Number.isFinite(smooth) &&
    smooth >= 0 &&
    smooth <= 1 &&
    sameCanonicalValue(argumentsValue, {
      targetId: argumentsValue['targetId'],
      resultMeshId: argumentsValue['resultMeshId'],
      resultMeshName: argumentsValue['resultMeshName'],
      cuts,
      smooth,
    })
  );
}

export class ProcedureShortcutProofError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = 'ProcedureShortcutProofError';
  }
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

export const sameProcedureShortcutProofValue = sameCanonicalValue;

export interface PreparedProcedureShortcutProofProposal {
  readonly actionName: typeof subdivisionSurfaceActionName | typeof meshEditSubdivideActionName;
  readonly recipeId: typeof subdivisionSurfaceRecipeId | typeof meshEditSubdivideRecipeId;
  readonly targetId: typeof targetId;
  readonly planning: PlanningIntent;
  readonly shortcutTrackContentSha256: string;
}

export function prepareProcedureShortcutProofProposal(
  request: ProcedureShortcutProofProposalRequest,
  materialization: ProcedureAuthoringMaterializationResult,
  actionCatalog: ActionCatalog,
): PreparedProcedureShortcutProofProposal {
  if (
    materialization.catalogBinding.adapterId !== 'blender' ||
    materialization.catalogBinding.adapterId !== actionCatalog.adapterId ||
    materialization.catalogBinding.actionCatalogVersion !== actionCatalog.catalogVersion
  ) {
    throw new ProcedureShortcutProofError(
      'Shortcut proof materialization does not match the installed Blender ActionCatalog',
    );
  }

  const leaves = materialization.tree.nodes.filter((node) => node.kind === 'leaf');
  const leaf = leaves[0];
  if (leaves.length !== 1 || leaf?.kind !== 'leaf' || leaf.id !== request.leafId) {
    throw new ProcedureShortcutProofError(
      'Native shortcut proof requires exactly one materialized leaf matching leafId',
    );
  }
  const isSubdivisionSurface =
    leaf.action?.adapterId === 'blender' &&
    leaf.action.name === subdivisionSurfaceActionName &&
    isExactSubdivisionSurfaceArguments(leaf.action.arguments) &&
    hasExactFactoryCubeObjectAnchor(leaf.anchors) &&
    hasNoOperatorAnchor(leaf.anchors);
  const isMeshEditSubdivide =
    leaf.action?.adapterId === 'blender' &&
    leaf.action.name === meshEditSubdivideActionName &&
    isExactMeshEditSubdivideArguments(leaf.action.arguments) &&
    hasExactFactoryCubeObjectAnchor(leaf.anchors) &&
    hasExactMeshSubdivideOperatorAnchor(leaf.anchors);
  if (!isSubdivisionSurface && !isMeshEditSubdivide) {
    throw new ProcedureShortcutProofError(
      'Native shortcut proof supports only an exact bounded catalog-authorized action profile',
    );
  }

  const actionName = isSubdivisionSurface
    ? subdivisionSurfaceActionName
    : meshEditSubdivideActionName;
  const recipeId = isSubdivisionSurface ? subdivisionSurfaceRecipeId : meshEditSubdivideRecipeId;
  const targetProfile = isSubdivisionSurface
    ? subdivisionSurfaceTargetProfile
    : meshEditSubdivideTargetProfile;
  const expectedExecutorId = isSubdivisionSurface
    ? 'blender.subdivision_surface_f9.event_simulate.v1'
    : 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1';
  const expectedOperationIds = isSubdivisionSurface
    ? subdivisionSurfaceShortcutProofOperationIds
    : meshEditSubdivideShortcutProofOperationIds;
  const expectedMcpAvailability = isSubdivisionSurface ? 'unavailable' : 'materialized';
  const expectedMcpTrackAvailability = isSubdivisionSurface ? 'unavailable' : 'available';

  const executableSteps = materialization.compilation.plan.steps.filter(
    (step) => step.action !== null,
  );
  const planStep = executableSteps[0];
  if (
    executableSteps.length !== 1 ||
    planStep?.id !== leaf.id ||
    !sameCanonicalValue(planStep.action, leaf.action)
  ) {
    throw new ProcedureShortcutProofError(
      'Shortcut proof compilation must preserve the exact single accepted leaf action',
    );
  }

  const coverage = materialization.coverage[0];
  const shortcut = leaf.shortcutTracks[0];
  if (
    materialization.coverage.length !== 1 ||
    coverage?.leafId !== leaf.id ||
    coverage.recipeId !== recipeId ||
    coverage.menu !== 'unavailable' ||
    coverage.shortcut !== 'materialized' ||
    coverage.mcp !== expectedMcpAvailability ||
    leaf.menuTracks.length !== 1 ||
    leaf.menuTracks[0]?.availability !== 'unavailable' ||
    leaf.shortcutTracks.length !== 1 ||
    shortcut?.availability !== 'available' ||
    leaf.mcpTracks.length !== 1 ||
    leaf.mcpTracks[0]?.availability !== expectedMcpTrackAvailability ||
    shortcut.proofExecution?.targetProfile !== targetProfile ||
    shortcut.proofExecution.executorId !== expectedExecutorId ||
    shortcut.proofExecution.executionBoundary !== 'blender_window_event_simulate' ||
    shortcut.proofExecution.authorization !== 'accepted_replay_next_step' ||
    shortcut.proofExecution.transport !== 'event_simulate' ||
    shortcut.operations.length !== expectedOperationIds.length ||
    shortcut.proofExecution.operationIds.length !== expectedOperationIds.length ||
    shortcut.operations.some(
      (operation, index) =>
        operation.id !== expectedOperationIds[index] ||
        operation.id !== shortcut.proofExecution?.operationIds[index],
    ) ||
    shortcut.proofExecution.operationIds.some(
      (operationId, index) => operationId !== expectedOperationIds[index],
    )
  ) {
    throw new ProcedureShortcutProofError(
      'Materialization lacks the exact catalog-authorized factory Cube shortcut proof track',
    );
  }

  const actionEntry = actionCatalog.actions.find((entry) => entry.name === actionName);
  const phases = (actionCatalog.planningPhases ?? []).filter((phase) =>
    phase.actionNames.includes(actionName),
  );
  const capabilities = (actionCatalog.semanticCapabilities ?? []).filter((capability) =>
    capability.actionNames.includes(actionName),
  );
  if (actionEntry === undefined || phases.length !== 1 || capabilities.length !== 1) {
    throw new ProcedureShortcutProofError(
      'Shortcut proof action must have one ActionCatalog action, planning phase, and capability',
    );
  }

  return {
    actionName,
    recipeId,
    targetId,
    shortcutTrackContentSha256: canonicalSha256(shortcut),
    planning: {
      goal: request.packet.context.goalProvenance.source.text,
      requiredPhaseIds: [phases[0]!.id],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: `${leaf.id}.shortcut_proof_requirement`,
            statement: request.packet.context.goalProvenance.source.text,
            coverage: [{ capabilityId: capabilities[0]!.id, stepIds: [leaf.id] }],
          },
        ],
      },
    },
  };
}

export function buildProcedureShortcutProofProposalRecord(input: {
  readonly recordId: string;
  readonly request: ProcedureShortcutProofProposalRequest;
  readonly materialization: ProcedureAuthoringMaterializationResult;
  readonly proposal: GuideProposal;
  readonly planContentSha256: string;
  readonly shortcutTrackContentSha256: string;
  readonly createdAt: string;
}): ProcedureShortcutProofProposalRecord {
  const leaf = input.materialization.tree.nodes.find(
    (node) => node.kind === 'leaf' && node.id === input.request.leafId,
  );
  const shortcut = leaf?.kind === 'leaf' ? leaf.shortcutTracks[0] : undefined;
  if (
    leaf?.kind !== 'leaf' ||
    leaf.action?.adapterId !== 'blender' ||
    !hasExactFactoryCubeObjectAnchor(leaf.anchors) ||
    shortcut?.availability !== 'available' ||
    shortcut.proofExecution === undefined ||
    input.shortcutTrackContentSha256 !== canonicalSha256(shortcut)
  ) {
    throw new ProcedureShortcutProofError(
      'Cannot bind a shortcut proof proposal without the exact factory Cube catalog authority',
    );
  }

  const commonContent = {
    formatVersion: procedureShortcutProofFormatVersion,
    recordId: input.recordId,
    replayId: input.request.replayId,
    request: input.request,
    materialization: input.materialization,
    proposal: input.proposal,
    planContentSha256: input.planContentSha256,
    leafId: input.request.leafId,
    shortcutTrackContentSha256: input.shortcutTrackContentSha256,
    claims: {
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'pending',
      managedIdentityVerified: false,
    },
    createdAt: input.createdAt,
  };

  const isSubdivisionSurface =
    leaf.action.name === subdivisionSurfaceActionName &&
    isExactSubdivisionSurfaceArguments(leaf.action.arguments) &&
    hasNoOperatorAnchor(leaf.anchors) &&
    shortcut.proofExecution.executorId === 'blender.subdivision_surface_f9.event_simulate.v1' &&
    shortcut.proofExecution.targetProfile === subdivisionSurfaceTargetProfile;
  const isMeshEditSubdivide =
    leaf.action.name === meshEditSubdivideActionName &&
    isExactMeshEditSubdivideArguments(leaf.action.arguments) &&
    hasExactMeshSubdivideOperatorAnchor(leaf.anchors) &&
    shortcut.proofExecution.executorId === 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1' &&
    shortcut.proofExecution.targetProfile === meshEditSubdivideTargetProfile;
  if (!isSubdivisionSurface && !isMeshEditSubdivide) {
    throw new ProcedureShortcutProofError(
      'Cannot bind a shortcut proof proposal with mismatched action and executor profiles',
    );
  }

  const content = isSubdivisionSurface
    ? {
        ...commonContent,
        recipeId: subdivisionSurfaceRecipeId,
        actionName: subdivisionSurfaceActionName,
        proofExecution: shortcut.proofExecution,
      }
    : {
        ...commonContent,
        recipeId: meshEditSubdivideRecipeId,
        actionName: meshEditSubdivideActionName,
        proofExecution: shortcut.proofExecution,
      };
  return procedureShortcutProofProposalRecordSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureShortcutProofProposalRecordContentSha256(content),
    },
  });
}

export function buildProcedureShortcutProofBinding(input: {
  readonly bindingId: string;
  readonly proofId: string;
  readonly requestId: string;
  readonly record: ProcedureShortcutProofProposalRecord;
  readonly decision: GuideProposalDecision;
  readonly currentState: CompanionStateReport;
  readonly createdAt: string;
}): ProcedureShortcutProofBinding {
  const { record, decision, currentState } = input;
  const leaf = record.materialization.tree.nodes.find(
    (node) => node.kind === 'leaf' && node.id === record.leafId,
  );
  if (
    leaf?.kind !== 'leaf' ||
    leaf.action?.adapterId !== 'blender' ||
    !hasExactFactoryCubeObjectAnchor(leaf.anchors)
  ) {
    throw new ProcedureShortcutProofError('Shortcut proof proposal leaf is unavailable');
  }
  if (
    decision.decision !== 'accepted' ||
    decision.proposalId !== record.proposal.proposalId ||
    decision.adapterId !== 'blender' ||
    decision.instanceId !== record.request.targetInstanceId
  ) {
    throw new ProcedureShortcutProofError(
      'Shortcut proof binding requires the exact accepted in-host decision',
      409,
    );
  }
  if (
    currentState.adapterId !== 'blender' ||
    currentState.instanceId !== record.request.targetInstanceId ||
    currentState.executionId === null ||
    currentState.plan?.id !== record.proposal.plan.id ||
    currentState.plan.revision !== record.proposal.plan.revision ||
    currentState.planContentSha256 !== record.planContentSha256
  ) {
    throw new ProcedureShortcutProofError(
      'Shortcut proof binding requires the active accepted proposal execution',
      409,
    );
  }

  const commonContent = {
    formatVersion: procedureShortcutProofFormatVersion,
    bindingId: input.bindingId,
    proposalRecordContentSha256: record.integrity.contentSha256,
    proofId: input.proofId,
    requestId: input.requestId,
    replayId: record.replayId,
    target: { adapterId: 'blender', instanceId: record.request.targetInstanceId },
    proposalId: record.proposal.proposalId,
    plan: {
      id: record.proposal.plan.id,
      revision: record.proposal.plan.revision,
      contentSha256: record.planContentSha256,
    },
    executionId: currentState.executionId,
    leafId: record.leafId,
    acceptedDecision: {
      decisionId: decision.decisionId,
      proposalId: decision.proposalId,
      instanceId: decision.instanceId,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: decision.occurredAt,
    },
    materialization: {
      actionCatalogVersion: record.materialization.catalogBinding.actionCatalogVersion,
      interactionCatalogVersion: record.materialization.catalogBinding.interactionCatalogVersion,
      interactionCatalogContentSha256:
        record.materialization.catalogBinding.interactionCatalogContentSha256,
      shortcutTrackContentSha256: record.shortcutTrackContentSha256,
    },
    executionBoundary: record.proofExecution.executionBoundary,
    authorization: record.proofExecution.authorization,
    transport: record.proofExecution.transport,
    startState: { reportId: currentState.reportId, sequence: currentState.sequence },
    createdAt: input.createdAt,
  };

  let content: Record<string, unknown>;
  if (record.recipeId === subdivisionSurfaceRecipeId) {
    if (
      record.actionName !== subdivisionSurfaceActionName ||
      record.proofExecution.executorId !== 'blender.subdivision_surface_f9.event_simulate.v1' ||
      leaf.action.name !== subdivisionSurfaceActionName ||
      !isExactSubdivisionSurfaceArguments(leaf.action.arguments) ||
      !hasNoOperatorAnchor(leaf.anchors)
    ) {
      throw new ProcedureShortcutProofError(
        'Subdivision Surface shortcut proof proposal leaf does not match its executor profile',
      );
    }
    content = {
      ...commonContent,
      recipeId: subdivisionSurfaceRecipeId,
      actionName: subdivisionSurfaceActionName,
      acceptedAction: {
        adapterId: 'blender',
        name: subdivisionSurfaceActionName,
        arguments: {
          targetId,
          modifierId,
          modifierName,
          viewportLevel: leaf.action.arguments['viewportLevel'] as number,
        },
      },
      targetProfile: subdivisionSurfaceTargetProfile,
      proofScope: {
        managedActionResult: 'not_executed',
        managedIdentityVerified: false,
        managedReceiptCreated: false,
        omittedAcceptedArguments: ['modifierId', 'modifierName'],
      },
      executorId: record.proofExecution.executorId,
      operationIds: [...subdivisionSurfaceShortcutProofOperationIds],
    };
  } else {
    if (
      record.actionName !== meshEditSubdivideActionName ||
      record.proofExecution.executorId !== 'blender.mesh_edit_subdivide_f3_f9.event_simulate.v1' ||
      leaf.action.name !== meshEditSubdivideActionName ||
      !isExactMeshEditSubdivideArguments(leaf.action.arguments) ||
      !hasExactMeshSubdivideOperatorAnchor(leaf.anchors)
    ) {
      throw new ProcedureShortcutProofError(
        'Edit Mesh Subdivide shortcut proof proposal leaf does not match its executor profile',
      );
    }
    content = {
      ...commonContent,
      recipeId: meshEditSubdivideRecipeId,
      actionName: meshEditSubdivideActionName,
      acceptedAction: {
        adapterId: 'blender',
        name: meshEditSubdivideActionName,
        arguments: {
          targetId,
          resultMeshId: leaf.action.arguments['resultMeshId'] as string,
          resultMeshName: leaf.action.arguments['resultMeshName'] as string,
          cuts: leaf.action.arguments['cuts'] as number,
          smooth: leaf.action.arguments['smooth'] as number,
        },
      },
      targetProfile: meshEditSubdivideTargetProfile,
      proofScope: {
        managedActionResult: 'not_executed',
        managedIdentityVerified: false,
        managedReceiptCreated: false,
        managedReplacementMeshCreated: false,
        nativeMutationKind: 'in_place_edit_mesh_subdivide',
        omittedAcceptedArguments: ['targetId', 'resultMeshId', 'resultMeshName'],
      },
      executorId: record.proofExecution.executorId,
      operationIds: [...meshEditSubdivideShortcutProofOperationIds],
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
    };
  }
  return procedureShortcutProofBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureShortcutProofBindingContentSha256(content),
    },
  });
}
