import {
  canonicalizeProtocolJsonValue,
  computeProcedureLeafReplayAttestationContentSha256,
  computeProcedureLeafReplayBindingContentSha256,
  protocolJsonValueCanonicalization,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayFormatVersion,
  type ActionCatalog,
  type CompanionStateReport,
  type GuideProposal,
  type GuideProposalDecision,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafReplayAttestation,
  type ProcedureLeafReplayBinding,
  type ProcedureLeafReplayProposalRequest,
} from '@operatingline/protocol';
import type { StoredManagedReplayReceipt } from '@operatingline/persistence';

import { satisfiesStableVersionRange } from './stable-version-ranges.js';

const replayActionName = 'blender.mesh.create_uv_sphere' as const;
const replayObservationKind = 'uv_sphere_ready' as const;

export class ProcedureLeafReplayError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = 'ProcedureLeafReplayError';
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

export const sameProcedureLeafReplayValue = sameCanonicalValue;

function expectedUvSphereObservationParameters(actionArguments: Record<string, unknown>) {
  return {
    resourceId: actionArguments['resourceId'],
    objectName: actionArguments['objectName'],
    radius: actionArguments['radius'],
    location: actionArguments['location'],
  };
}

export interface PreparedProcedureLeafReplay {
  readonly actionName: typeof replayActionName;
  readonly recipeId: string;
  readonly planning: PlanningIntent;
}

export function prepareProcedureLeafReplay(
  request: ProcedureLeafReplayProposalRequest,
  materialization: ProcedureAuthoringMaterializationResult,
  actionCatalog: ActionCatalog,
): PreparedProcedureLeafReplay {
  if (
    materialization.catalogBinding.adapterId !== actionCatalog.adapterId ||
    materialization.catalogBinding.actionCatalogVersion !== actionCatalog.catalogVersion
  ) {
    throw new ProcedureLeafReplayError(
      'Replay materialization does not match the installed ActionCatalog',
    );
  }

  const leafIds = materialization.tree.nodes.flatMap((node) =>
    node.kind === 'leaf' ? [node.id] : [],
  );
  if (leafIds.length !== 1 || leafIds[0] !== request.leafId) {
    throw new ProcedureLeafReplayError(
      'Managed leaf replay requires exactly one materialized leaf matching leafId',
    );
  }
  const leaf = materialization.tree.nodes.find((node) => node.id === request.leafId);
  if (leaf?.kind !== 'leaf' || leaf.action === null) {
    throw new ProcedureLeafReplayError('Replay leafId does not identify an executable leaf');
  }
  if (leaf.action.name !== replayActionName || leaf.action.adapterId !== 'blender') {
    throw new ProcedureLeafReplayError(
      `Managed leaf replay currently supports only ${replayActionName}`,
    );
  }

  const executablePlanSteps = materialization.compilation.plan.steps.filter(
    (step) => step.action !== null,
  );
  const planStep = executablePlanSteps[0];
  if (
    executablePlanSteps.length !== 1 ||
    planStep?.id !== leaf.id ||
    planStep.action?.name !== replayActionName ||
    !sameCanonicalValue(planStep.action.arguments, leaf.action.arguments)
  ) {
    throw new ProcedureLeafReplayError(
      'Replay compilation must preserve the single materialized leaf action exactly',
    );
  }

  if (
    leaf.observationPolicy?.mode !== 'success_gate' ||
    leaf.observationPolicy.failureStrategy !== 'rollback_step' ||
    leaf.rollback.mode !== 'compensating_action'
  ) {
    throw new ProcedureLeafReplayError(
      'Managed leaf replay requires a rollback_step success gate and compensating action',
    );
  }
  const expectedObservationParameters = expectedUvSphereObservationParameters(
    leaf.action.arguments,
  );
  if (
    leaf.expectedObservations.length !== 1 ||
    leaf.expectedObservations[0]?.kind !== replayObservationKind ||
    !sameCanonicalValue(leaf.expectedObservations[0].parameters, expectedObservationParameters)
  ) {
    throw new ProcedureLeafReplayError(
      `Managed UV Sphere replay requires one exact ${replayObservationKind} success gate`,
    );
  }

  const coverage = materialization.coverage;
  const leafCoverage = coverage[0];
  if (
    coverage.length !== 1 ||
    leafCoverage?.leafId !== leaf.id ||
    leafCoverage.menu !== 'materialized' ||
    leafCoverage.shortcut !== 'materialized' ||
    leafCoverage.mcp !== 'unavailable' ||
    leafCoverage.recipeId === null
  ) {
    throw new ProcedureLeafReplayError(
      'Replay leaf requires one catalog-grounded menu and candidate shortcut recipe with unavailable MCP',
    );
  }
  if (
    leaf.menuTracks.length !== 1 ||
    leaf.menuTracks[0]?.availability !== 'available' ||
    leaf.shortcutTracks.length !== 1 ||
    leaf.shortcutTracks[0]?.availability !== 'available' ||
    leaf.mcpTracks.length !== 1 ||
    leaf.mcpTracks[0]?.availability !== 'unavailable'
  ) {
    throw new ProcedureLeafReplayError(
      'Replay materialization tracks do not match the bounded catalog-grounding contract',
    );
  }

  const actionEntry = actionCatalog.actions.find((entry) => entry.name === replayActionName);
  if (!actionEntry?.supportedObservationKinds.includes(replayObservationKind)) {
    throw new ProcedureLeafReplayError(
      `ActionCatalog ${actionCatalog.catalogVersion} does not support ${replayObservationKind}`,
    );
  }
  const phases = (actionCatalog.planningPhases ?? []).filter((phase) =>
    phase.actionNames.includes(replayActionName),
  );
  const capabilities = (actionCatalog.semanticCapabilities ?? []).filter((capability) =>
    capability.actionNames.includes(replayActionName),
  );
  if (phases.length !== 1 || capabilities.length !== 1) {
    throw new ProcedureLeafReplayError(
      'Replay action must have one unambiguous planning phase and semantic capability',
    );
  }

  return {
    actionName: replayActionName,
    recipeId: leafCoverage.recipeId,
    planning: {
      goal: request.packet.context.goalProvenance.source.text,
      requiredPhaseIds: [phases[0]!.id],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: `${leaf.id}.replay_requirement`,
            statement: request.packet.context.goalProvenance.source.text,
            coverage: [{ capabilityId: capabilities[0]!.id, stepIds: [leaf.id] }],
          },
        ],
      },
    },
  };
}

export function buildProcedureLeafReplayBinding(input: {
  readonly request: ProcedureLeafReplayProposalRequest;
  readonly materialization: ProcedureAuthoringMaterializationResult;
  readonly proposal: GuideProposal;
  readonly planContentSha256: string;
  readonly recipeId: string;
  readonly actionName: string;
  readonly createdAt: string;
}): ProcedureLeafReplayBinding {
  const content: Omit<ProcedureLeafReplayBinding, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: input.request.replayId,
    targetInstanceId: input.request.targetInstanceId,
    leafId: input.request.leafId,
    replayMode: input.request.replayMode,
    request: input.request,
    materialization: input.materialization,
    proposal: input.proposal,
    planContentSha256: input.planContentSha256,
    recipeId: input.recipeId,
    actionName: input.actionName,
    claims: {
      materialization: 'catalog_grounded',
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'pending',
      menuTrack: 'catalog_grounded_not_executed',
      shortcutTrack: 'candidate_not_executed',
      mcpTrack: 'unavailable',
    },
    createdAt: input.createdAt,
  };
  return procedureLeafReplayBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayBindingContentSha256(content),
    },
  });
}

export function buildProcedureLeafReplayAttestation(input: {
  readonly binding: ProcedureLeafReplayBinding;
  readonly decision: GuideProposalDecision;
  readonly report: CompanionStateReport;
  readonly proposalReceipt: StoredManagedReplayReceipt;
  readonly decisionReceipt: StoredManagedReplayReceipt;
  readonly reportReceipt: StoredManagedReplayReceipt;
  readonly attestationId: string;
  readonly attestedAt: string;
}): ProcedureLeafReplayAttestation {
  const { binding, decision, report } = input;
  const proposal = binding.proposal;
  if (
    decision.proposalId !== proposal.proposalId ||
    decision.decision !== 'accepted' ||
    decision.adapterId !== proposal.targetAdapterId ||
    decision.instanceId !== binding.targetInstanceId
  ) {
    throw new ProcedureLeafReplayError(
      'Replay attestation requires the exact accepted proposal decision',
      409,
    );
  }
  const { proposalReceipt, decisionReceipt, reportReceipt } = input;
  if (
    proposalReceipt.subjectType !== 'replay_proposal' ||
    proposalReceipt.subjectId !== proposal.proposalId ||
    proposalReceipt.authentication !== 'orchestrator_internal' ||
    proposalReceipt.adapterId !== proposal.targetAdapterId ||
    proposalReceipt.instanceId !== binding.targetInstanceId ||
    proposalReceipt.sessionFingerprintSha256 !== null ||
    decisionReceipt.subjectType !== 'guide_proposal_decision' ||
    decisionReceipt.subjectId !== decision.decisionId ||
    decisionReceipt.authentication !== 'negotiated_companion_lease' ||
    decisionReceipt.adapterId !== proposal.targetAdapterId ||
    decisionReceipt.instanceId !== binding.targetInstanceId ||
    decisionReceipt.sessionFingerprintSha256 === null ||
    reportReceipt.subjectType !== 'companion_state_report' ||
    reportReceipt.subjectId !== report.reportId ||
    reportReceipt.authentication !== 'negotiated_companion_lease' ||
    reportReceipt.adapterId !== proposal.targetAdapterId ||
    reportReceipt.instanceId !== binding.targetInstanceId ||
    reportReceipt.sessionFingerprintSha256 !== decisionReceipt.sessionFingerprintSha256 ||
    proposalReceipt.sequence >= decisionReceipt.sequence ||
    decisionReceipt.sequence >= reportReceipt.sequence ||
    Date.parse(proposalReceipt.receivedAt) > Date.parse(decisionReceipt.receivedAt) ||
    Date.parse(decisionReceipt.receivedAt) > Date.parse(reportReceipt.receivedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Replay attestation requires one ordered authenticated Companion session receipt chain',
      409,
    );
  }
  if (Date.parse(decision.occurredAt) > Date.parse(report.occurredAt)) {
    throw new ProcedureLeafReplayError('Replay execution report predates proposal acceptance', 409);
  }
  if (
    report.protocolVersion !== proposal.protocolVersion ||
    report.adapterId !== proposal.targetAdapterId ||
    report.instanceId !== binding.targetInstanceId ||
    report.plan?.id !== proposal.plan.id ||
    report.plan.revision !== proposal.plan.revision ||
    report.planContentSha256 !== binding.planContentSha256 ||
    report.executionId === null ||
    report.phase !== 'completed' ||
    report.transition !== 'step_succeeded' ||
    report.stepId !== binding.leafId ||
    report.activeStepId !== binding.leafId ||
    report.completedStepIds.length !== 1 ||
    report.completedStepIds[0] !== binding.leafId ||
    report.observationGate !== null ||
    report.artifactAttestation !== null ||
    report.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Companion report does not prove the exact terminal replay execution',
      409,
    );
  }
  if (
    !satisfiesStableVersionRange(
      report.hostVersion,
      binding.materialization.tree.hostVersionRange,
      'Replay host version',
    )
  ) {
    throw new ProcedureLeafReplayError(
      `Host version ${report.hostVersion} is outside the replay tree hostVersionRange`,
      409,
    );
  }

  const expectedStep = proposal.plan.steps.find((step) => step.id === binding.leafId);
  const expectedObservation = expectedStep?.expectedObservations[0];
  const observation = report.observations[0];
  const expectedParameters = expectedObservation?.parameters;
  const expectedResourceId = expectedParameters?.['resourceId'];
  const expectedObjectName = expectedParameters?.['objectName'];
  const expectedRadius = expectedParameters?.['radius'];
  const expectedLocation = expectedParameters?.['location'];
  const expectedLocationX = Array.isArray(expectedLocation) ? expectedLocation[0] : undefined;
  const expectedLocationY = Array.isArray(expectedLocation) ? expectedLocation[1] : undefined;
  const expectedLocationZ = Array.isArray(expectedLocation) ? expectedLocation[2] : undefined;
  const meshContentSha256 = observation?.details['meshContentSha256'];
  const strongBooleanDetailKeys = [
    'parametersValid',
    'objectOwned',
    'meshOwned',
    'collectionOwned',
    'receiptMatches',
    'objectDataMatches',
    'collectionLinkMatches',
    'nameMatches',
    'locationMatches',
    'rotationMatches',
    'scaleMatches',
    'transformIsolated',
    'modifiersAbsent',
    'shapeKeysAbsent',
    'materialsAbsent',
    'contentIntact',
    'topologyMatches',
    'finiteCoordinates',
    'radiusMatches',
  ] as const;
  const strongDetailKeys = new Set<string>([
    'parameters',
    'supported',
    'resourceId',
    'objectName',
    'meshId',
    'collectionId',
    ...strongBooleanDetailKeys,
    'vertexCount',
    'edgeCount',
    'faceCount',
    'meshContentSha256',
  ]);
  if (
    expectedStep?.action?.name !== binding.actionName ||
    expectedStep.expectedObservations.length !== 1 ||
    expectedObservation?.kind !== replayObservationKind ||
    report.observations.length !== 1 ||
    observation?.kind !== replayObservationKind ||
    observation.satisfied !== true ||
    Object.keys(observation.details).length !== strongDetailKeys.size ||
    Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
    observation.details['supported'] !== true ||
    !sameCanonicalValue(observation.details['parameters'], expectedObservation.parameters) ||
    typeof expectedResourceId !== 'string' ||
    typeof expectedObjectName !== 'string' ||
    typeof expectedRadius !== 'number' ||
    !Number.isFinite(expectedRadius) ||
    expectedRadius <= 0 ||
    !Array.isArray(expectedLocation) ||
    expectedLocation.length !== 3 ||
    typeof expectedLocationX !== 'number' ||
    !Number.isFinite(expectedLocationX) ||
    typeof expectedLocationY !== 'number' ||
    !Number.isFinite(expectedLocationY) ||
    typeof expectedLocationZ !== 'number' ||
    !Number.isFinite(expectedLocationZ) ||
    observation.details['resourceId'] !== expectedResourceId ||
    observation.details['objectName'] !== expectedObjectName ||
    observation.details['meshId'] !== `${expectedResourceId}.mesh` ||
    observation.details['collectionId'] !== 'snowman.collection' ||
    strongBooleanDetailKeys.some((key) => observation.details[key] !== true) ||
    observation.details['vertexCount'] !== 482 ||
    observation.details['edgeCount'] !== 992 ||
    observation.details['faceCount'] !== 512 ||
    typeof meshContentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(meshContentSha256)
  ) {
    throw new ProcedureLeafReplayError(
      `Companion report lacks the exact satisfied ${replayObservationKind} observation`,
      409,
    );
  }
  if (
    Date.parse(report.occurredAt) > Date.parse(input.attestedAt) ||
    Date.parse(reportReceipt.receivedAt) > Date.parse(input.attestedAt)
  ) {
    throw new ProcedureLeafReplayError('Replay attestation predates its companion evidence', 409);
  }

  const sessionFingerprintSha256 = decisionReceipt.sessionFingerprintSha256;
  if (sessionFingerprintSha256 === null) {
    throw new ProcedureLeafReplayError('Replay decision receipt lacks a session fingerprint', 409);
  }
  const attestedDecision = {
    ...decision,
    adapterId: 'blender' as const,
    decision: 'accepted' as const,
  };
  const attestedObservation = {
    kind: replayObservationKind,
    satisfied: true as const,
    details: {
      parameters: {
        resourceId: expectedResourceId,
        objectName: expectedObjectName,
        radius: expectedRadius,
        location: [expectedLocationX, expectedLocationY, expectedLocationZ] as [
          number,
          number,
          number,
        ],
      },
      supported: true as const,
      resourceId: expectedResourceId,
      objectName: expectedObjectName,
      meshId: `${expectedResourceId}.mesh`,
      collectionId: 'snowman.collection' as const,
      parametersValid: true as const,
      objectOwned: true as const,
      meshOwned: true as const,
      collectionOwned: true as const,
      receiptMatches: true as const,
      objectDataMatches: true as const,
      collectionLinkMatches: true as const,
      nameMatches: true as const,
      locationMatches: true as const,
      rotationMatches: true as const,
      scaleMatches: true as const,
      transformIsolated: true as const,
      modifiersAbsent: true as const,
      shapeKeysAbsent: true as const,
      materialsAbsent: true as const,
      contentIntact: true as const,
      topologyMatches: true as const,
      finiteCoordinates: true as const,
      radiusMatches: true as const,
      vertexCount: 482 as const,
      edgeCount: 992 as const,
      faceCount: 512 as const,
      meshContentSha256,
    },
  };
  const attestedReport = {
    ...report,
    adapterId: 'blender' as const,
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256: binding.planContentSha256,
    executionId: report.executionId,
    phase: 'completed' as const,
    activeStepId: binding.leafId,
    completedStepIds: [binding.leafId],
    transition: 'step_succeeded' as const,
    stepId: binding.leafId,
    observations: [attestedObservation],
    observationGate: null,
    artifactAttestation: null,
    error: null,
  };
  const content = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: binding.replayId,
    attestationId: input.attestationId,
    decision: attestedDecision,
    report: attestedReport,
    evidenceClass: 'companion_reported_managed_action_leaf_replay',
    provenance: {
      authentication: 'negotiated_companion_lease',
      sessionFingerprintSha256,
      proposalReceipt: {
        sequence: proposalReceipt.sequence,
        receivedAt: proposalReceipt.receivedAt,
      },
      decisionReceipt: {
        sequence: decisionReceipt.sequence,
        receivedAt: decisionReceipt.receivedAt,
      },
      reportReceipt: {
        sequence: reportReceipt.sequence,
        receivedAt: reportReceipt.receivedAt,
      },
    },
    bindingContentSha256: binding.integrity.contentSha256,
    execution: {
      host: {
        adapterId: 'blender',
        instanceId: report.instanceId,
        version: report.hostVersion,
      },
      companion: { version: report.companionVersion },
      plan: {
        id: report.plan.id,
        revision: report.plan.revision,
        contentSha256: report.planContentSha256,
      },
      execution: { id: report.executionId },
      step: { id: binding.leafId },
      action: {
        adapterId: 'blender',
        name: replayActionName,
      },
      occurredAt: report.occurredAt,
    },
    successGate: {
      observations: [attestedObservation],
      allSatisfied: true,
    },
    verificationScope: {
      managedActionResult: 'verified',
      menuTrack: 'catalog_grounded_not_executed',
      shortcutTrack: 'candidate_not_executed',
      mcpTrack: 'unavailable',
    },
    attestedAt: input.attestedAt,
  } satisfies Omit<ProcedureLeafReplayAttestation, 'integrity'>;
  return procedureLeafReplayAttestationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayAttestationContentSha256(content),
    },
  });
}
