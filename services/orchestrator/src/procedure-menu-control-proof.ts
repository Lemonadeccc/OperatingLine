import {
  computeProtocolCanonicalJsonSha256,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProcedureMenuControlProofProposalRecordContentSha256,
  actionCatalogSchema,
  companionStateReportSchema,
  guideProposalDecisionSchema,
  interactionCatalogSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureMenuControlProofBindingSchema,
  procedureMenuControlProofFormatVersion,
  procedureMenuControlProofProposalRecordSchema,
  procedureMenuControlProofProposalRequestSchema,
  protocolJsonValueCanonicalization,
  uvSphereMenuControlProofOperationIds,
  type ActionCatalog,
  type CompanionStateReport,
  type GuideProposal,
  type GuideProposalDecision,
  type InteractionCatalog,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureMenuControlProofBinding,
  type ProcedureMenuControlProofProposalRecord,
  type ProcedureMenuControlProofProposalRequest,
} from '@operatingline/protocol';

const actionName = 'blender.mesh.create_uv_sphere' as const;
const recipeId = 'blender.mesh.create_uv_sphere.native' as const;
const targetProfile = 'factory_layout_three_object_ui_scale_2' as const;
const executorId = 'blender.uv_sphere_menu_controls.event_simulate.v1' as const;
const exactArguments = {
  resourceId: 'proof.uv_sphere.eye',
  objectName: 'OperatingLine.TutorialEye',
  radius: 1.5,
  location: [1.25, -2, 0.75],
} as const;

export class ProcedureMenuControlProofError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = 'ProcedureMenuControlProofError';
  }
}

function canonicalSha256(value: unknown): string {
  return computeProtocolCanonicalJsonSha256(value);
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

export const sameProcedureMenuControlProofValue = sameCanonicalValue;

export interface PreparedProcedureMenuControlProofProposal {
  readonly actionName: typeof actionName;
  readonly recipeId: typeof recipeId;
  readonly planning: PlanningIntent;
  readonly menuTrackContentSha256: string;
}

export function prepareProcedureMenuControlProofProposal(
  request: ProcedureMenuControlProofProposalRequest,
  materialization: ProcedureAuthoringMaterializationResult,
  actionCatalog: ActionCatalog,
  interactionCatalog: InteractionCatalog,
): PreparedProcedureMenuControlProofProposal {
  if (!procedureMenuControlProofProposalRequestSchema.safeParse(request).success) {
    throw new ProcedureMenuControlProofError('Menu-control proof requires a valid exact request');
  }
  if (!procedureAuthoringMaterializationResultSchema.safeParse(materialization).success) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof requires a valid exact materialization result',
    );
  }
  const actionCatalogResult = actionCatalogSchema.safeParse(actionCatalog);
  const interactionCatalogResult = interactionCatalogSchema.safeParse(interactionCatalog);
  if (!actionCatalogResult.success || !interactionCatalogResult.success) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof requires valid installed Blender catalogs',
    );
  }
  const installedActionCatalog = actionCatalogResult.data;
  const installedInteractionCatalog = interactionCatalogResult.data;
  const { integrity: packetIntegrity, ...packetContent } = request.packet;
  if (
    materialization.catalogBinding.adapterId !== 'blender' ||
    materialization.catalogBinding.adapterId !== installedActionCatalog.adapterId ||
    materialization.catalogBinding.adapterId !== installedInteractionCatalog.adapterId ||
    materialization.catalogBinding.actionCatalogVersion !== installedActionCatalog.catalogVersion ||
    materialization.catalogBinding.interactionCatalogVersion !==
      installedInteractionCatalog.catalogVersion ||
    materialization.catalogBinding.interactionCatalogContentSha256 !==
      canonicalSha256(installedInteractionCatalog) ||
    request.tree.adapterId !== materialization.catalogBinding.adapterId ||
    request.tree.actionCatalogVersion !== materialization.catalogBinding.actionCatalogVersion ||
    request.tree.interactionCatalogVersion !==
      materialization.catalogBinding.interactionCatalogVersion ||
    canonicalSha256(packetContent) !== packetIntegrity.contentSha256 ||
    packetIntegrity.contentSha256 !== materialization.packetContentSha256 ||
    canonicalSha256(request.tree) !== materialization.inputTreeContentSha256 ||
    materialization.validation.installedCatalogBinding !== 'validated'
  ) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof materialization does not match the installed Blender catalogs',
    );
  }

  const leaves = materialization.tree.nodes.filter((node) => node.kind === 'leaf');
  const leaf = leaves[0];
  if (leaves.length !== 1 || leaf?.kind !== 'leaf' || leaf.id !== request.leafId) {
    throw new ProcedureMenuControlProofError(
      'Native menu-control proof requires exactly one materialized leaf matching leafId',
    );
  }
  const exactAction = { adapterId: 'blender', name: actionName, arguments: exactArguments };
  if (leaf.action === null || !sameCanonicalValue(leaf.action, exactAction)) {
    throw new ProcedureMenuControlProofError(
      'Native menu-control proof supports only the exact bounded tutorial-eye UV Sphere action',
    );
  }

  const executableSteps = materialization.compilation.plan.steps.filter(
    (step) => step.action !== null,
  );
  const planStep = executableSteps[0];
  if (
    executableSteps.length !== 1 ||
    planStep?.id !== leaf.id ||
    !sameCanonicalValue(planStep.action, exactAction)
  ) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof compilation must preserve the exact single accepted leaf action',
    );
  }

  const coverage = materialization.coverage[0];
  const menu = leaf.menuTracks[0];
  if (
    materialization.coverage.length !== 1 ||
    coverage?.leafId !== leaf.id ||
    coverage.recipeId !== recipeId ||
    coverage.menu !== 'materialized' ||
    leaf.menuTracks.length !== 1 ||
    menu?.availability !== 'available' ||
    menu.proofExecution === undefined ||
    menu.proofExecution.executorId !== executorId ||
    menu.proofExecution.targetProfile !== targetProfile ||
    menu.proofExecution.executionBoundary !== 'blender_window_event_simulate' ||
    menu.proofExecution.authorization !== 'accepted_replay_next_step' ||
    menu.proofExecution.transport !== 'event_simulate' ||
    menu.proofExecution.managedActionExecuted !== false ||
    menu.proofExecution.managedReceiptCreated !== false ||
    menu.proofExecution.nativeUndoDepth !== 8 ||
    !sameCanonicalValue(menu.proofExecution.proofArguments, exactArguments) ||
    menu.operations.length !== uvSphereMenuControlProofOperationIds.length ||
    menu.proofExecution.operationIds.length !== uvSphereMenuControlProofOperationIds.length ||
    menu.operations.some(
      (operation, index) => operation.id !== uvSphereMenuControlProofOperationIds[index],
    ) ||
    menu.proofExecution.operationIds.some(
      (operationId, index) => operationId !== uvSphereMenuControlProofOperationIds[index],
    ) ||
    menu.operations.some((operation) =>
      Object.prototype.hasOwnProperty.call(operation.parameters, 'resourceId'),
    )
  ) {
    throw new ProcedureMenuControlProofError(
      'Materialization lacks the exact catalog-authorized UV Sphere menu-control proof track',
    );
  }

  const actionEntries = installedActionCatalog.actions.filter((entry) => entry.name === actionName);
  const phases = (installedActionCatalog.planningPhases ?? []).filter((phase) =>
    phase.actionNames.includes(actionName),
  );
  const capabilities = (installedActionCatalog.semanticCapabilities ?? []).filter((capability) =>
    capability.actionNames.includes(actionName),
  );
  if (actionEntries.length !== 1 || phases.length !== 1 || capabilities.length !== 1) {
    throw new ProcedureMenuControlProofError(
      'UV Sphere must have one ActionCatalog action, planning phase, and semantic capability',
    );
  }

  return {
    actionName,
    recipeId,
    menuTrackContentSha256: canonicalSha256(menu),
    planning: {
      goal: request.packet.context.goalProvenance.source.text,
      requiredPhaseIds: [phases[0]!.id],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: `${leaf.id}.menu_control_proof_requirement`,
            statement: request.packet.context.goalProvenance.source.text,
            coverage: [{ capabilityId: capabilities[0]!.id, stepIds: [leaf.id] }],
          },
        ],
      },
    },
  };
}

export function buildProcedureMenuControlProofProposalRecord(input: {
  readonly recordId: string;
  readonly request: ProcedureMenuControlProofProposalRequest;
  readonly materialization: ProcedureAuthoringMaterializationResult;
  readonly proposal: GuideProposal;
  readonly actionCatalog: ActionCatalog;
  readonly interactionCatalog: InteractionCatalog;
  readonly createdAt: string;
}): ProcedureMenuControlProofProposalRecord {
  const prepared = prepareProcedureMenuControlProofProposal(
    input.request,
    input.materialization,
    input.actionCatalog,
    input.interactionCatalog,
  );
  const leaf = input.materialization.tree.nodes.find(
    (node) => node.kind === 'leaf' && node.id === input.request.leafId,
  );
  const menu = leaf?.kind === 'leaf' ? leaf.menuTracks[0] : undefined;
  const exactAction = { adapterId: 'blender', name: actionName, arguments: exactArguments };
  if (
    leaf?.kind !== 'leaf' ||
    leaf.action === null ||
    !sameCanonicalValue(leaf.action, exactAction) ||
    menu?.availability !== 'available' ||
    menu.proofExecution === undefined ||
    menu.proofExecution.executorId !== executorId ||
    menu.proofExecution.targetProfile !== targetProfile ||
    prepared.menuTrackContentSha256 !== canonicalSha256(menu)
  ) {
    throw new ProcedureMenuControlProofError(
      'Cannot bind a menu-control proof proposal without the exact UV Sphere catalog authority',
    );
  }

  const content: Omit<ProcedureMenuControlProofProposalRecord, 'integrity'> = {
    formatVersion: procedureMenuControlProofFormatVersion,
    recordId: input.recordId,
    replayId: input.request.replayId,
    request: input.request,
    materialization: input.materialization,
    proposal: input.proposal,
    packetContentSha256: input.request.packet.integrity.contentSha256,
    inputTreeContentSha256: canonicalSha256(input.request.tree),
    outputTreeContentSha256: canonicalSha256(input.materialization.tree),
    materializationContentSha256: canonicalSha256(input.materialization),
    proposalContentSha256: canonicalSha256(input.proposal),
    planContentSha256: canonicalSha256(input.proposal.plan),
    interactionCatalogContentSha256:
      input.materialization.catalogBinding.interactionCatalogContentSha256,
    leafId: input.request.leafId,
    recipeId,
    actionName,
    menuTrackContentSha256: prepared.menuTrackContentSha256,
    proofExecution: menu.proofExecution,
    claims: {
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
    },
    createdAt: input.createdAt,
  };
  return procedureMenuControlProofProposalRecordSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofProposalRecordContentSha256(content),
    },
  });
}

/**
 * Seal the accepted content and native Start checkpoint.
 *
 * The runtime caller must additionally prove that the decision and state report
 * are the latest authenticated, monotonically ordered receipts before delivery.
 */
export function buildProcedureMenuControlProofBinding(input: {
  readonly bindingId: string;
  readonly proofId: string;
  readonly requestId: string;
  readonly record: ProcedureMenuControlProofProposalRecord;
  readonly decision: GuideProposalDecision;
  readonly currentState: CompanionStateReport;
  readonly createdAt: string;
}): ProcedureMenuControlProofBinding {
  const recordResult = procedureMenuControlProofProposalRecordSchema.safeParse(input.record);
  const decisionResult = guideProposalDecisionSchema.safeParse(input.decision);
  const currentStateResult = companionStateReportSchema.safeParse(input.currentState);
  if (!recordResult.success || !decisionResult.success || !currentStateResult.success) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof record, decision, or current state is invalid',
    );
  }
  const record = recordResult.data;
  const decision = decisionResult.data;
  const currentState = currentStateResult.data;
  const startCheckpoint = currentState.nativeUndoCheckpoint;
  const leaf = record.materialization.tree.nodes.find(
    (node) => node.kind === 'leaf' && node.id === record.leafId,
  );
  const exactAction = { adapterId: 'blender', name: actionName, arguments: exactArguments };
  if (
    leaf?.kind !== 'leaf' ||
    leaf.action === null ||
    !sameCanonicalValue(leaf.action, exactAction)
  ) {
    throw new ProcedureMenuControlProofError('Menu-control proof proposal leaf is unavailable');
  }
  if (
    decision.decision !== 'accepted' ||
    decision.proposalId !== record.proposal.proposalId ||
    decision.adapterId !== 'blender' ||
    decision.instanceId !== record.request.targetInstanceId
  ) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof binding requires the exact accepted in-host decision',
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
    throw new ProcedureMenuControlProofError(
      'Menu-control proof binding requires the active accepted proposal execution',
      409,
    );
  }
  if (
    currentState.phase !== 'running' ||
    currentState.activeStepId !== null ||
    currentState.completedStepIds.length !== 0 ||
    currentState.transition !== 'walkthrough_started' ||
    currentState.stepId !== null ||
    currentState.observations.length !== 0 ||
    (currentState.observationGate !== undefined && currentState.observationGate !== null) ||
    currentState.observationRetry !== undefined ||
    (currentState.artifactAttestation !== undefined && currentState.artifactAttestation !== null) ||
    currentState.error !== null ||
    startCheckpoint?.operation !== 'start' ||
    startCheckpoint.previousCheckpointId !== null ||
    startCheckpoint.session.plan.id !== record.proposal.plan.id ||
    startCheckpoint.session.plan.revision !== record.proposal.plan.revision ||
    startCheckpoint.session.planContentSha256 !== record.planContentSha256 ||
    startCheckpoint.session.executionId !== currentState.executionId ||
    startCheckpoint.session.activeStepId !== null ||
    startCheckpoint.session.completedStepIds.length !== 0 ||
    startCheckpoint.session.receiptStepIds.length !== 0
  ) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof binding requires the pristine walkthrough start state',
      409,
    );
  }
  const decisionTime = Date.parse(decision.occurredAt);
  const checkpointTime = Date.parse(startCheckpoint.committedAt);
  const startTime = Date.parse(currentState.occurredAt);
  const createdTime = Date.parse(input.createdAt);
  if (decisionTime > checkpointTime || checkpointTime > startTime || startTime > createdTime) {
    throw new ProcedureMenuControlProofError(
      'Menu-control proof binding timestamps must satisfy decision <= checkpoint <= start <= created',
      409,
    );
  }

  const content: Omit<ProcedureMenuControlProofBinding, 'integrity'> = {
    formatVersion: procedureMenuControlProofFormatVersion,
    bindingId: input.bindingId,
    proposalRecordContentSha256: record.integrity.contentSha256,
    proofId: input.proofId,
    requestId: input.requestId,
    replayId: record.replayId,
    target: { adapterId: 'blender', instanceId: record.request.targetInstanceId },
    proposalId: record.proposal.proposalId,
    packetContentSha256: record.packetContentSha256,
    inputTreeContentSha256: record.inputTreeContentSha256,
    outputTreeContentSha256: record.outputTreeContentSha256,
    materializationContentSha256: record.materializationContentSha256,
    proposalContentSha256: record.proposalContentSha256,
    plan: {
      id: record.proposal.plan.id,
      revision: record.proposal.plan.revision,
      contentSha256: record.planContentSha256,
    },
    executionId: currentState.executionId,
    leafId: record.leafId,
    recipeId,
    actionName,
    acceptedAction: {
      adapterId: 'blender',
      name: actionName,
      arguments: {
        resourceId: exactArguments.resourceId,
        objectName: exactArguments.objectName,
        radius: exactArguments.radius,
        location: [...exactArguments.location],
      },
    },
    targetProfile,
    acceptedDecision: {
      decisionId: decision.decisionId,
      proposalId: decision.proposalId,
      instanceId: decision.instanceId,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: decision.occurredAt,
    },
    startState: {
      reportId: currentState.reportId,
      sequence: currentState.sequence,
      adapterId: 'blender',
      instanceId: currentState.instanceId,
      plan: { id: currentState.plan.id, revision: currentState.plan.revision },
      planContentSha256: currentState.planContentSha256,
      executionId: currentState.executionId,
      phase: 'running',
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      stepId: null,
      observationCount: 0,
      nativeUndoCheckpoint: {
        ...startCheckpoint,
        previousCheckpointId: null,
        operation: 'start',
        session: {
          ...startCheckpoint.session,
          activeStepId: null,
          completedStepIds: [],
          receiptStepIds: [],
        },
      },
      occurredAt: currentState.occurredAt,
    },
    proofScope: {
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['resourceId'],
    },
    materialization: {
      actionCatalogVersion: record.materialization.catalogBinding.actionCatalogVersion,
      interactionCatalogVersion: record.materialization.catalogBinding.interactionCatalogVersion,
      interactionCatalogContentSha256: record.interactionCatalogContentSha256,
      packetContentSha256: record.packetContentSha256,
      inputTreeContentSha256: record.inputTreeContentSha256,
      outputTreeContentSha256: record.outputTreeContentSha256,
      materializationContentSha256: record.materializationContentSha256,
      menuTrackContentSha256: record.menuTrackContentSha256,
    },
    executorId,
    executionBoundary: record.proofExecution.executionBoundary,
    authorization: record.proofExecution.authorization,
    transport: record.proofExecution.transport,
    operationIds: [...uvSphereMenuControlProofOperationIds],
    nativeUndoDepth: 8,
    createdAt: input.createdAt,
  };
  return procedureMenuControlProofBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofBindingContentSha256(content),
    },
  });
}
