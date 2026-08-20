import {
  canonicalizeProtocolJsonValue,
  computeProcedureLeafReplayAttestationContentSha256,
  computeProcedureLeafReplayBindingContentSha256,
  computeProcedureLeafReplayCurrentStateVerificationContentSha256,
  computeProcedureLeafReplayFailureRecoveryAttestationContentSha256,
  computeProcedureLeafReplayObservationContentSha256,
  protocolJsonValueCanonicalization,
  procedureLeafReplayActionNameSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayFormatVersion,
  procedureLeafReplayObservationSchema,
  procedureLeafReplayCurrentStateVerificationSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type CompanionProcedureReplayCurrentStateRequest,
  type GuideProposal,
  type GuideProposalDecision,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafReplayActionName,
  type ProcedureLeafReplayAttestation,
  type ProcedureLeafReplayBinding,
  type ProcedureLeafReplayCurrentStateVerification,
  type ProcedureLeafReplayFailureRecoveryAttestation,
  type ProcedureLeafReplayProposalRequest,
} from '@operatingline/protocol';
import type { StoredManagedReplayReceipt } from '@operatingline/persistence';

import { satisfiesStableVersionRange } from './stable-version-ranges.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVector3(value: unknown, bounded = false): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        isFiniteNumber(component) && (!bounded || (component >= -1000 && component <= 1000)),
    )
  );
}

function hasReplayIdentity(parameters: Record<string, unknown>): boolean {
  return (
    typeof parameters['resourceId'] === 'string' &&
    parameters['resourceId'].length > 0 &&
    typeof parameters['objectName'] === 'string' &&
    parameters['objectName'].length > 0
  );
}

function segmentEndpointsDiffer(parameters: Record<string, unknown>): boolean {
  const start = parameters['start'];
  const end = parameters['end'];
  return (
    isFiniteVector3(start, true) &&
    isFiniteVector3(end, true) &&
    start.some((component, index) => component !== end[index])
  );
}

const replayActionContracts = {
  'blender.mesh.create_uv_sphere': {
    observationKind: 'uv_sphere_ready',
    geometryMatchDetailKeys: ['radiusMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 482, edgeCount: 992, faceCount: 512 }),
  },
  'blender.mesh.create_icosphere': {
    observationKind: 'icosphere_ready',
    geometryMatchDetailKeys: ['radiusMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      subdivisions: actionArguments['subdivisions'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['subdivisions']) &&
      Number.isInteger(parameters['subdivisions']) &&
      parameters['subdivisions'] >= 1 &&
      parameters['subdivisions'] <= 5 &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const subdivisions = actionArguments['subdivisions'];
      if (
        typeof subdivisions !== 'number' ||
        !Number.isInteger(subdivisions) ||
        subdivisions < 1 ||
        subdivisions > 5
      ) {
        return null;
      }
      const scale = 4 ** (subdivisions - 1);
      return {
        vertexCount: 10 * scale + 2,
        edgeCount: 30 * scale,
        faceCount: 20 * scale,
      };
    },
  },
  'blender.mesh.create_cube': {
    observationKind: 'cube_ready',
    geometryMatchDetailKeys: ['sizeMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['size']) &&
      parameters['size'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 8, edgeCount: 12, faceCount: 6 }),
  },
  'blender.mesh.create_plane': {
    observationKind: 'plane_ready',
    geometryMatchDetailKeys: ['sizeMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['size']) &&
      parameters['size'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 4, edgeCount: 4, faceCount: 1 }),
  },
  'blender.mesh.create_torus': {
    observationKind: 'torus_ready',
    geometryMatchDetailKeys: ['geometryMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      majorSegments: actionArguments['majorSegments'],
      minorSegments: actionArguments['minorSegments'],
      majorRadius: actionArguments['majorRadius'],
      minorRadius: actionArguments['minorRadius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['majorSegments']) &&
      Number.isInteger(parameters['majorSegments']) &&
      parameters['majorSegments'] >= 3 &&
      parameters['majorSegments'] <= 128 &&
      isFiniteNumber(parameters['minorSegments']) &&
      Number.isInteger(parameters['minorSegments']) &&
      parameters['minorSegments'] >= 3 &&
      parameters['minorSegments'] <= 64 &&
      isFiniteNumber(parameters['majorRadius']) &&
      parameters['majorRadius'] > 0 &&
      isFiniteNumber(parameters['minorRadius']) &&
      parameters['minorRadius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const majorSegments = actionArguments['majorSegments'];
      const minorSegments = actionArguments['minorSegments'];
      if (
        typeof majorSegments !== 'number' ||
        !Number.isInteger(majorSegments) ||
        majorSegments < 3 ||
        majorSegments > 128 ||
        typeof minorSegments !== 'number' ||
        !Number.isInteger(minorSegments) ||
        minorSegments < 3 ||
        minorSegments > 64
      ) {
        return null;
      }
      const vertexCount = majorSegments * minorSegments;
      return { vertexCount, edgeCount: vertexCount * 2, faceCount: vertexCount };
    },
  },
  'blender.mesh.create_cone': {
    observationKind: 'cone_ready',
    geometryMatchDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radiusStart: actionArguments['radiusStart'],
      radiusEnd: actionArguments['radiusEnd'],
      start: actionArguments['start'],
      end: actionArguments['end'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radiusStart']) &&
      parameters['radiusStart'] >= 0 &&
      parameters['radiusStart'] <= 1000 &&
      isFiniteNumber(parameters['radiusEnd']) &&
      parameters['radiusEnd'] >= 0 &&
      parameters['radiusEnd'] <= 1000 &&
      (parameters['radiusStart'] > 0 || parameters['radiusEnd'] > 0) &&
      segmentEndpointsDiffer(parameters),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const radiusStart = actionArguments['radiusStart'];
      const radiusEnd = actionArguments['radiusEnd'];
      if (!isFiniteNumber(radiusStart) || !isFiniteNumber(radiusEnd)) return null;
      return radiusStart === 0 || radiusEnd === 0
        ? { vertexCount: 33, edgeCount: 64, faceCount: 33 }
        : { vertexCount: 64, edgeCount: 96, faceCount: 34 };
    },
  },
  'blender.mesh.create_cylinder': {
    observationKind: 'cylinder_ready',
    geometryMatchDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radius: actionArguments['radius'],
      start: actionArguments['start'],
      end: actionArguments['end'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] >= 0.0001 &&
      parameters['radius'] <= 1000 &&
      segmentEndpointsDiffer(parameters),
    expectedTopology: () => ({ vertexCount: 64, edgeCount: 96, faceCount: 34 }),
  },
} as const satisfies Record<
  ProcedureLeafReplayActionName,
  {
    readonly observationKind: string;
    readonly geometryMatchDetailKeys: readonly string[];
    readonly expectedParameters: (
      actionArguments: Record<string, unknown>,
    ) => Record<string, unknown>;
    readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    readonly expectedTopology: (actionArguments: Record<string, unknown>) => {
      readonly vertexCount: number;
      readonly edgeCount: number;
      readonly faceCount: number;
    } | null;
  }
>;

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

export interface PreparedProcedureLeafReplay {
  readonly actionName: ProcedureLeafReplayActionName;
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
  const parsedActionName = procedureLeafReplayActionNameSchema.safeParse(leaf.action.name);
  if (!parsedActionName.success || leaf.action.adapterId !== 'blender') {
    throw new ProcedureLeafReplayError(`Managed leaf replay does not support ${leaf.action.name}`);
  }
  const actionName = parsedActionName.data;
  const actionContract = replayActionContracts[actionName];

  const executablePlanSteps = materialization.compilation.plan.steps.filter(
    (step) => step.action !== null,
  );
  const planStep = executablePlanSteps[0];
  if (
    executablePlanSteps.length !== 1 ||
    planStep?.id !== leaf.id ||
    planStep.action?.name !== actionName ||
    !sameCanonicalValue(planStep.action.arguments, leaf.action.arguments)
  ) {
    throw new ProcedureLeafReplayError(
      'Replay compilation must preserve the single materialized leaf action exactly',
    );
  }

  if (
    leaf.observationPolicy?.mode !== 'success_gate' ||
    !['rollback_step', 'retain_for_repair'].includes(leaf.observationPolicy.failureStrategy) ||
    leaf.rollback.mode !== 'compensating_action'
  ) {
    throw new ProcedureLeafReplayError(
      'Managed leaf replay requires a rollback_step or retain_for_repair success gate and compensating action',
    );
  }
  const expectedObservationParameters = actionContract.expectedParameters(leaf.action.arguments);
  if (
    leaf.expectedObservations.length !== 1 ||
    leaf.expectedObservations[0]?.kind !== actionContract.observationKind ||
    !sameCanonicalValue(leaf.expectedObservations[0].parameters, expectedObservationParameters)
  ) {
    throw new ProcedureLeafReplayError(
      `Managed ${actionName} replay requires one exact ${actionContract.observationKind} success gate`,
    );
  }

  const coverage = materialization.coverage;
  const leafCoverage = coverage[0];
  const shortcutCoverageValid =
    leafCoverage?.shortcut === 'materialized' || leafCoverage?.shortcut === 'unavailable';
  const expectedMcpTrackAvailability =
    leafCoverage?.mcp === 'materialized'
      ? 'available'
      : leafCoverage?.mcp === 'unavailable'
        ? 'unavailable'
        : null;
  if (
    coverage.length !== 1 ||
    leafCoverage?.leafId !== leaf.id ||
    leafCoverage.menu !== 'materialized' ||
    !shortcutCoverageValid ||
    expectedMcpTrackAvailability === null ||
    leafCoverage.recipeId === null
  ) {
    throw new ProcedureLeafReplayError(
      'Replay leaf requires catalog-grounded menu/shortcut/MCP coverage for its managed action',
    );
  }
  if (
    leaf.menuTracks.length !== 1 ||
    leaf.menuTracks[0]?.availability !== 'available' ||
    leaf.shortcutTracks.length !== 1 ||
    leaf.shortcutTracks[0]?.availability !==
      (leafCoverage.shortcut === 'materialized' ? 'available' : 'unavailable') ||
    leaf.mcpTracks.length !== 1 ||
    leaf.mcpTracks[0]?.availability !== expectedMcpTrackAvailability
  ) {
    throw new ProcedureLeafReplayError(
      'Replay materialization tracks do not match the bounded catalog-grounding contract',
    );
  }

  const actionEntry = actionCatalog.actions.find((entry) => entry.name === actionName);
  if (!actionEntry?.supportedObservationKinds.includes(actionContract.observationKind)) {
    throw new ProcedureLeafReplayError(
      `ActionCatalog ${actionCatalog.catalogVersion} does not support ${actionContract.observationKind}`,
    );
  }
  const phases = (actionCatalog.planningPhases ?? []).filter((phase) =>
    phase.actionNames.includes(actionName),
  );
  const capabilities = (actionCatalog.semanticCapabilities ?? []).filter((capability) =>
    capability.actionNames.includes(actionName),
  );
  if (phases.length !== 1 || capabilities.length !== 1) {
    throw new ProcedureLeafReplayError(
      'Replay action must have one unambiguous planning phase and semantic capability',
    );
  }

  return {
    actionName,
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
  readonly actionName: ProcedureLeafReplayActionName;
  readonly createdAt: string;
}): ProcedureLeafReplayBinding {
  const leafCoverage = input.materialization.coverage.find(
    (entry) => entry.leafId === input.request.leafId,
  );
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
      shortcutTrack:
        leafCoverage?.shortcut === 'materialized' ? 'candidate_not_executed' : 'unavailable',
      mcpTrack:
        leafCoverage?.mcp === 'materialized' ? 'catalog_grounded_not_executed' : 'unavailable',
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

function strongReplayObservation(
  binding: ProcedureLeafReplayBinding,
  report: CompanionStateReport,
) {
  const actionContract = replayActionContracts[binding.actionName];
  const expectedStep = binding.proposal.plan.steps.find((step) => step.id === binding.leafId);
  const expectedObservation = expectedStep?.expectedObservations[0];
  const observation = report.observations[0];
  const expectedParameters = expectedObservation?.parameters;
  const expectedResourceId = expectedParameters?.['resourceId'];
  const expectedObjectName = expectedParameters?.['objectName'];
  const meshContentSha256 = observation?.details['meshContentSha256'];
  const expectedTopology =
    expectedParameters === undefined ? null : actionContract.expectedTopology(expectedParameters);
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
    ...actionContract.geometryMatchDetailKeys,
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
    expectedObservation?.kind !== actionContract.observationKind ||
    report.observations.length !== 1 ||
    observation?.kind !== actionContract.observationKind ||
    observation.satisfied !== true ||
    Object.keys(observation.details).length !== strongDetailKeys.size ||
    Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
    observation.details['supported'] !== true ||
    !sameCanonicalValue(observation.details['parameters'], expectedObservation.parameters) ||
    expectedParameters === undefined ||
    !actionContract.parametersValid(expectedParameters) ||
    typeof expectedResourceId !== 'string' ||
    typeof expectedObjectName !== 'string' ||
    expectedTopology === null ||
    observation.details['resourceId'] !== expectedResourceId ||
    observation.details['objectName'] !== expectedObjectName ||
    observation.details['meshId'] !== `${expectedResourceId}.mesh` ||
    observation.details['collectionId'] !== 'snowman.collection' ||
    strongBooleanDetailKeys.some((key) => observation.details[key] !== true) ||
    observation.details['vertexCount'] !== expectedTopology.vertexCount ||
    observation.details['edgeCount'] !== expectedTopology.edgeCount ||
    observation.details['faceCount'] !== expectedTopology.faceCount ||
    typeof meshContentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(meshContentSha256)
  ) {
    throw new ProcedureLeafReplayError(
      `Companion report lacks the exact satisfied ${actionContract.observationKind} observation`,
      409,
    );
  }
  return procedureLeafReplayObservationSchema.parse({
    kind: actionContract.observationKind,
    satisfied: true,
    details: structuredClone(observation.details),
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
  const replayStep = proposal.plan.steps.find((step) => step.id === binding.leafId);
  const retryPolicy =
    replayStep?.observationPolicy?.mode === 'success_gate'
      ? replayStep.observationPolicy.retryPolicy
      : undefined;
  const retryEvidence = report.observationRetry;
  if (
    retryEvidence !== undefined &&
    (retryPolicy?.mode !== 'automatic_bounded' ||
      retryEvidence.mode !== retryPolicy.mode ||
      retryEvidence.maxAttempts !== retryPolicy.maxAttempts)
  ) {
    throw new ProcedureLeafReplayError(
      'Companion retry success evidence does not match the accepted replay policy',
      409,
    );
  }
  const nativeUndoCheckpoint = report.nativeUndoCheckpoint;
  if (
    nativeUndoCheckpoint === undefined ||
    nativeUndoCheckpoint.operation !== 'next' ||
    nativeUndoCheckpoint.session.receiptStepIds.length !== 1 ||
    nativeUndoCheckpoint.session.receiptStepIds[0] !== binding.leafId
  ) {
    throw new ProcedureLeafReplayError(
      'Companion report does not prove a current native Undo checkpoint for the replay step',
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

  const attestedObservation = strongReplayObservation(binding, report);
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
  const content: Omit<ProcedureLeafReplayAttestation, 'integrity'> = {
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
        name: binding.actionName,
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
      shortcutTrack: binding.claims.shortcutTrack,
      mcpTrack: binding.claims.mcpTrack,
      nativeUndoCheckpoint: 'companion_reported_current_at_report',
      currentHostStateAfterReport: 'not_verified',
    },
    attestedAt: input.attestedAt,
  };
  return procedureLeafReplayAttestationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayAttestationContentSha256(content),
    },
  });
}

export function buildProcedureLeafReplayFailureRecoveryAttestation(input: {
  readonly binding: ProcedureLeafReplayBinding;
  readonly decision: GuideProposalDecision;
  readonly failureReport: CompanionStateReport;
  readonly recoveryReport: CompanionStateReport | null;
  readonly proposalReceipt: StoredManagedReplayReceipt;
  readonly decisionReceipt: StoredManagedReplayReceipt;
  readonly failureReportReceipt: StoredManagedReplayReceipt;
  readonly recoveryReportReceipt: StoredManagedReplayReceipt | null;
  readonly attestationId: string;
  readonly attestedAt: string;
}): ProcedureLeafReplayFailureRecoveryAttestation {
  const {
    binding,
    decision,
    failureReport,
    recoveryReport,
    proposalReceipt,
    decisionReceipt,
    failureReportReceipt,
    recoveryReportReceipt,
  } = input;
  const proposal = binding.proposal;
  const leaf = binding.materialization.tree.nodes.find((node) => node.id === binding.leafId);
  const observationPolicy = leaf?.kind === 'leaf' ? leaf.observationPolicy : undefined;
  const failureStrategy =
    observationPolicy?.mode === 'success_gate' ? observationPolicy.failureStrategy : undefined;
  const retryPolicy =
    observationPolicy?.mode === 'success_gate' ? observationPolicy.retryPolicy : undefined;
  if (
    decision.proposalId !== proposal.proposalId ||
    decision.decision !== 'accepted' ||
    decision.adapterId !== proposal.targetAdapterId ||
    decision.instanceId !== binding.targetInstanceId ||
    (failureStrategy !== 'rollback_step' && failureStrategy !== 'retain_for_repair')
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation requires the exact accepted replay decision and gate policy',
      409,
    );
  }
  const executionFingerprint = decisionReceipt.sessionFingerprintSha256;
  const recoveryFingerprint = recoveryReportReceipt?.sessionFingerprintSha256 ?? null;
  const recoveryReceiptsMatch =
    recoveryReport === null
      ? recoveryReportReceipt === null
      : recoveryReportReceipt !== null &&
        recoveryReportReceipt.subjectType === 'companion_state_report' &&
        recoveryReportReceipt.subjectId === recoveryReport.reportId &&
        recoveryReportReceipt.authentication === 'negotiated_companion_lease' &&
        recoveryReportReceipt.adapterId === proposal.targetAdapterId &&
        recoveryReportReceipt.instanceId === binding.targetInstanceId &&
        recoveryFingerprint !== null &&
        failureReportReceipt.sequence < recoveryReportReceipt.sequence &&
        Date.parse(failureReportReceipt.receivedAt) <= Date.parse(recoveryReportReceipt.receivedAt);
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
    executionFingerprint === null ||
    failureReportReceipt.subjectType !== 'companion_state_report' ||
    failureReportReceipt.subjectId !== failureReport.reportId ||
    failureReportReceipt.authentication !== 'negotiated_companion_lease' ||
    failureReportReceipt.adapterId !== proposal.targetAdapterId ||
    failureReportReceipt.instanceId !== binding.targetInstanceId ||
    failureReportReceipt.sessionFingerprintSha256 !== executionFingerprint ||
    proposalReceipt.sequence >= decisionReceipt.sequence ||
    decisionReceipt.sequence >= failureReportReceipt.sequence ||
    Date.parse(proposalReceipt.receivedAt) > Date.parse(decisionReceipt.receivedAt) ||
    Date.parse(decisionReceipt.receivedAt) > Date.parse(failureReportReceipt.receivedAt) ||
    !recoveryReceiptsMatch
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation requires an ordered authenticated receipt chain',
      409,
    );
  }
  if (
    failureReport.protocolVersion !== proposal.protocolVersion ||
    failureReport.adapterId !== proposal.targetAdapterId ||
    failureReport.instanceId !== binding.targetInstanceId ||
    failureReport.plan?.id !== proposal.plan.id ||
    failureReport.plan.revision !== proposal.plan.revision ||
    failureReport.planContentSha256 !== binding.planContentSha256 ||
    failureReport.executionId === null ||
    failureReport.transition !== 'step_observation_failed' ||
    failureReport.stepId !== binding.leafId ||
    failureReport.completedStepIds.length !== 0 ||
    failureReport.observationGate === undefined ||
    failureReport.observationGate === null ||
    failureReport.observationGate.status === 'recovered' ||
    failureReport.observationGate.stepId !== binding.leafId ||
    failureReport.observationGate.failureStrategy !== failureStrategy ||
    failureReport.artifactAttestation !== null ||
    failureReport.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Failure report does not prove the exact managed replay observation failure',
      409,
    );
  }
  const expectedStep = proposal.plan.steps.find((step) => step.id === binding.leafId);
  const expectedObservation = expectedStep?.expectedObservations[0];
  const failedObservation = failureReport.observations[0];
  const actionContract = replayActionContracts[binding.actionName];
  if (
    expectedStep?.action?.name !== binding.actionName ||
    expectedStep.expectedObservations.length !== 1 ||
    expectedObservation?.kind !== actionContract.observationKind ||
    failureReport.observations.length !== 1 ||
    failedObservation?.kind !== actionContract.observationKind ||
    failedObservation.satisfied !== false ||
    failedObservation.details['supported'] !== true ||
    !sameCanonicalValue(failedObservation.details['parameters'], expectedObservation.parameters)
  ) {
    throw new ProcedureLeafReplayError(
      `Failure report lacks the exact unsatisfied ${actionContract.observationKind} observation`,
      409,
    );
  }
  const failureGate = failureReport.observationGate;
  const automaticRollback = failureGate.status === 'failed_rolled_back';
  const retryEvidence = failureGate.retry;
  if (
    automaticRollback &&
    (retryPolicy === undefined
      ? retryEvidence !== undefined
      : retryEvidence?.mode !== 'automatic_bounded' ||
        retryEvidence.disposition !== 'exhausted' ||
        retryEvidence.attempt !== retryPolicy.maxAttempts ||
        retryEvidence.maxAttempts !== retryPolicy.maxAttempts ||
        retryEvidence.remainingAttempts !== 0)
  ) {
    throw new ProcedureLeafReplayError(
      'Terminal rollback retry evidence does not match the accepted replay policy',
      409,
    );
  }
  const failureCheckpoint = failureReport.nativeUndoCheckpoint;
  if (
    automaticRollback
      ? failureStrategy !== 'rollback_step' ||
        failureReport.phase !== 'running' ||
        failureReport.activeStepId !== null ||
        failureCheckpoint !== undefined ||
        recoveryReport !== null
      : failureReport.phase !== 'blocked' ||
        failureReport.activeStepId !== binding.leafId ||
        failureCheckpoint === undefined ||
        failureCheckpoint.operation !== 'next' ||
        failureCheckpoint.session.receiptStepIds.length !== 1 ||
        failureCheckpoint.session.receiptStepIds[0] !== binding.leafId ||
        recoveryReport === null
  ) {
    throw new ProcedureLeafReplayError(
      'Failure report does not match an automatic rollback or checkpointed repair path',
      409,
    );
  }
  if (
    !satisfiesStableVersionRange(
      failureReport.hostVersion,
      binding.materialization.tree.hostVersionRange,
      'Replay host version',
    )
  ) {
    throw new ProcedureLeafReplayError(
      `Host version ${failureReport.hostVersion} is outside the replay tree hostVersionRange`,
      409,
    );
  }

  let recoveredObservation: ReturnType<typeof strongReplayObservation> | null = null;
  if (recoveryReport !== null) {
    if (
      recoveryReport.protocolVersion !== proposal.protocolVersion ||
      recoveryReport.adapterId !== failureReport.adapterId ||
      recoveryReport.instanceId !== failureReport.instanceId ||
      recoveryReport.hostVersion !== failureReport.hostVersion ||
      recoveryReport.companionVersion !== failureReport.companionVersion ||
      recoveryReport.plan?.id !== proposal.plan.id ||
      recoveryReport.plan.revision !== proposal.plan.revision ||
      recoveryReport.planContentSha256 !== binding.planContentSha256 ||
      recoveryReport.executionId !== failureReport.executionId ||
      recoveryReport.phase !== 'completed' ||
      recoveryReport.activeStepId !== binding.leafId ||
      recoveryReport.completedStepIds.length !== 1 ||
      recoveryReport.completedStepIds[0] !== binding.leafId ||
      recoveryReport.transition !== 'observation_recovered' ||
      recoveryReport.stepId !== binding.leafId ||
      recoveryReport.observationGate === undefined ||
      recoveryReport.observationGate === null ||
      recoveryReport.observationGate.status !== 'recovered' ||
      recoveryReport.observationGate.stepId !== binding.leafId ||
      recoveryReport.observationGate.failureStrategy !== failureStrategy ||
      recoveryReport.artifactAttestation !== null ||
      recoveryReport.nativeUndoCheckpoint === undefined ||
      recoveryReport.nativeUndoCheckpoint.operation !== 'recheck' ||
      recoveryReport.nativeUndoCheckpoint.session.receiptStepIds.length !== 1 ||
      recoveryReport.nativeUndoCheckpoint.session.receiptStepIds[0] !== binding.leafId ||
      recoveryReport.error !== null ||
      Date.parse(recoveryReport.occurredAt) < Date.parse(failureReport.occurredAt)
    ) {
      throw new ProcedureLeafReplayError(
        'Recovery report does not prove the exact repaired replay execution',
        409,
      );
    }
    recoveredObservation = strongReplayObservation(binding, recoveryReport);
  }
  const finalReport = recoveryReport ?? failureReport;
  const finalReceipt = recoveryReportReceipt ?? failureReportReceipt;
  if (
    Date.parse(decision.occurredAt) > Date.parse(failureReport.occurredAt) ||
    Date.parse(finalReport.occurredAt) > Date.parse(input.attestedAt) ||
    Date.parse(finalReceipt.receivedAt) > Date.parse(input.attestedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation predates its companion evidence',
      409,
    );
  }
  const attestedDecision = {
    ...decision,
    adapterId: 'blender' as const,
    decision: 'accepted' as const,
  };
  const attestedFailureReport = {
    ...failureReport,
    protocolVersion: '1.5.0' as const,
    adapterId: 'blender' as const,
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256: binding.planContentSha256,
    executionId: failureReport.executionId,
    phase: failureReport.phase as 'running' | 'blocked',
    completedStepIds: [] as [],
    transition: 'step_observation_failed' as const,
    stepId: binding.leafId,
    observations: [
      {
        kind: failedObservation.kind,
        satisfied: false as const,
        details: structuredClone(failedObservation.details),
      },
    ],
    observationGate: {
      ...structuredClone(failureGate),
      status: failureGate.status as 'failed_rolled_back' | 'repair_required' | 'rollback_failed',
    },
    artifactAttestation: null,
    error: null,
  };
  const attestedRecoveryReport =
    recoveryReport === null || recoveredObservation === null
      ? null
      : {
          ...recoveryReport,
          protocolVersion: '1.5.0' as const,
          adapterId: 'blender' as const,
          plan: { id: proposal.plan.id, revision: proposal.plan.revision },
          planContentSha256: binding.planContentSha256,
          executionId: failureReport.executionId,
          phase: 'completed' as const,
          activeStepId: binding.leafId,
          completedStepIds: [binding.leafId] as [string],
          transition: 'observation_recovered' as const,
          stepId: binding.leafId,
          observations: [recoveredObservation] as [typeof recoveredObservation],
          observationGate: {
            ...structuredClone(recoveryReport.observationGate!),
            status: 'recovered' as const,
          },
          artifactAttestation: null,
          nativeUndoCheckpoint: recoveryReport.nativeUndoCheckpoint!,
          error: null,
        };
  const content: Omit<ProcedureLeafReplayFailureRecoveryAttestation, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: binding.replayId,
    attestationId: input.attestationId,
    decision: attestedDecision,
    failureReport: attestedFailureReport,
    recoveryReport: attestedRecoveryReport,
    evidenceClass: 'companion_reported_managed_action_failure_recovery',
    outcome: automaticRollback ? 'automatically_rolled_back' : 'recovered_after_repair',
    provenance: {
      authentication: 'negotiated_companion_lease',
      executionSessionFingerprintSha256: executionFingerprint,
      recoverySessionFingerprintSha256: recoveryFingerprint,
      proposalReceipt: {
        sequence: proposalReceipt.sequence,
        receivedAt: proposalReceipt.receivedAt,
      },
      decisionReceipt: {
        sequence: decisionReceipt.sequence,
        receivedAt: decisionReceipt.receivedAt,
      },
      failureReportReceipt: {
        sequence: failureReportReceipt.sequence,
        receivedAt: failureReportReceipt.receivedAt,
      },
      recoveryReportReceipt:
        recoveryReportReceipt === null
          ? null
          : {
              sequence: recoveryReportReceipt.sequence,
              receivedAt: recoveryReportReceipt.receivedAt,
            },
    },
    bindingContentSha256: binding.integrity.contentSha256,
    execution: {
      host: {
        adapterId: 'blender',
        instanceId: failureReport.instanceId,
        version: failureReport.hostVersion,
      },
      companion: { version: failureReport.companionVersion },
      plan: {
        id: failureReport.plan.id,
        revision: failureReport.plan.revision,
        contentSha256: failureReport.planContentSha256,
      },
      execution: { id: failureReport.executionId },
      step: { id: binding.leafId },
      action: { adapterId: 'blender', name: binding.actionName },
      occurredAt: failureReport.occurredAt,
    },
    verificationScope: {
      managedActionAttempt: 'observation_failed',
      rollbackOutcome:
        failureGate.status === 'failed_rolled_back'
          ? 'companion_reported_succeeded'
          : failureGate.status === 'rollback_failed'
            ? 'companion_reported_failed'
            : 'not_requested',
      recoveryOutcome: automaticRollback ? 'not_required' : 'companion_reported_verified',
      menuTrack: 'catalog_grounded_not_executed',
      shortcutTrack: binding.claims.shortcutTrack,
      mcpTrack: binding.claims.mcpTrack,
      failureNativeUndoCheckpoint:
        failureCheckpoint === undefined
          ? 'not_verified_at_failure_report'
          : 'companion_reported_current_at_failure_report',
      terminalNativeUndoCheckpoint: automaticRollback
        ? 'not_applicable_no_retained_step'
        : 'companion_reported_current_at_recovery_report',
      currentHostStateAfterReport: 'not_verified',
    },
    attestedAt: input.attestedAt,
  };
  return procedureLeafReplayFailureRecoveryAttestationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(content),
    },
  });
}

export function buildProcedureLeafReplayCurrentStateRequest(input: {
  readonly attestation:
    ProcedureLeafReplayAttestation | ProcedureLeafReplayFailureRecoveryAttestation;
  readonly verificationId: string;
  readonly requestedAt: string;
}): CompanionProcedureReplayCurrentStateRequest {
  const { attestation } = input;
  const directSuccess = 'successGate' in attestation;
  const observation = directSuccess
    ? attestation.successGate.observations[0]
    : attestation.recoveryReport?.observations[0];
  const checkpointBacked = directSuccess
    ? attestation.verificationScope.nativeUndoCheckpoint === 'companion_reported_current_at_report'
    : attestation.outcome === 'recovered_after_repair' &&
      attestation.recoveryReport !== null &&
      attestation.verificationScope.terminalNativeUndoCheckpoint ===
        'companion_reported_current_at_recovery_report';
  if (
    !checkpointBacked ||
    attestation.verificationScope.currentHostStateAfterReport !== 'not_verified' ||
    observation === undefined
  ) {
    throw new ProcedureLeafReplayError(
      'Current-state verification requires a checkpoint-backed replay attestation',
      409,
    );
  }
  return {
    formatVersion: procedureLeafReplayFormatVersion,
    verificationId: input.verificationId,
    replayId: attestation.replayId,
    attestationId: attestation.attestationId,
    attestationContentSha256: attestation.integrity.contentSha256,
    target: {
      adapterId: 'blender',
      instanceId: attestation.execution.host.instanceId,
    },
    plan: {
      id: attestation.execution.plan.id,
      revision: attestation.execution.plan.revision,
    },
    planContentSha256: attestation.execution.plan.contentSha256,
    executionId: attestation.execution.execution.id,
    stepId: attestation.execution.step.id,
    expectedObservation: {
      kind: observation.kind,
      contentSha256: computeProcedureLeafReplayObservationContentSha256(observation),
    },
    requestedAt: input.requestedAt,
  };
}

export function buildProcedureLeafReplayCurrentStateVerification(input: {
  readonly attestation:
    ProcedureLeafReplayAttestation | ProcedureLeafReplayFailureRecoveryAttestation;
  readonly request: CompanionProcedureReplayCurrentStateRequest;
  readonly report: CompanionStateReport;
  readonly reportReceipt: StoredManagedReplayReceipt;
  readonly recordedAt: string;
}): ProcedureLeafReplayCurrentStateVerification {
  const { attestation, request, report, reportReceipt } = input;
  const baselineObservation =
    'successGate' in attestation
      ? attestation.successGate.observations[0]
      : attestation.recoveryReport?.observations[0];
  const expectedRequest = buildProcedureLeafReplayCurrentStateRequest({
    attestation,
    verificationId: request.verificationId,
    requestedAt: request.requestedAt,
  });
  if (!sameCanonicalValue(request, expectedRequest)) {
    throw new ProcedureLeafReplayError(
      'Current-state request does not match its replay attestation',
      409,
    );
  }
  if (
    report.protocolVersion !== '1.5.0' ||
    report.transition !== 'current_state_rechecked' ||
    report.procedureReplayCurrentStateRequest === undefined ||
    !sameCanonicalValue(report.procedureReplayCurrentStateRequest, request) ||
    report.adapterId !== request.target.adapterId ||
    report.instanceId !== request.target.instanceId ||
    reportReceipt.subjectType !== 'companion_state_report' ||
    reportReceipt.subjectId !== report.reportId ||
    reportReceipt.authentication !== 'negotiated_companion_lease' ||
    reportReceipt.adapterId !== request.target.adapterId ||
    reportReceipt.instanceId !== request.target.instanceId ||
    reportReceipt.sessionFingerprintSha256 === null ||
    Date.parse(reportReceipt.receivedAt) < Date.parse(request.requestedAt) ||
    Date.parse(input.recordedAt) < Date.parse(reportReceipt.receivedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Current-state report lacks the exact authenticated verification request chain',
      409,
    );
  }

  const sessionMatches =
    report.plan?.id === request.plan.id &&
    report.plan?.revision === request.plan.revision &&
    report.planContentSha256 === request.planContentSha256 &&
    report.executionId === request.executionId;
  const stepMatches =
    report.phase === 'completed' &&
    report.activeStepId === request.stepId &&
    report.stepId === request.stepId &&
    report.completedStepIds.length === 1 &&
    report.completedStepIds[0] === request.stepId &&
    report.observationGate === null &&
    report.artifactAttestation === null &&
    report.error === null;
  const observation = report.observations[0];
  const observationMatches =
    report.observations.length === 1 &&
    observation?.kind === request.expectedObservation.kind &&
    observation?.satisfied === true &&
    baselineObservation !== undefined &&
    sameCanonicalValue(observation, baselineObservation);
  const checkpoint = report.nativeUndoCheckpoint;
  const checkpointMatches =
    checkpoint !== undefined &&
    checkpoint.session.plan.id === request.plan.id &&
    checkpoint.session.plan.revision === request.plan.revision &&
    checkpoint.session.planContentSha256 === request.planContentSha256 &&
    checkpoint.session.executionId === request.executionId &&
    checkpoint.session.activeStepId === request.stepId &&
    checkpoint.session.completedStepIds.length === 1 &&
    checkpoint.session.completedStepIds[0] === request.stepId &&
    checkpoint.session.receiptStepIds.length === 1 &&
    checkpoint.session.receiptStepIds[0] === request.stepId;
  const reason = !sessionMatches
    ? 'session_identity_mismatch'
    : !stepMatches
      ? 'step_state_mismatch'
      : !observationMatches
        ? 'observation_mismatch'
        : !checkpointMatches
          ? 'native_undo_checkpoint_mismatch'
          : 'verified';
  const verified = reason === 'verified';
  const content: Omit<ProcedureLeafReplayCurrentStateVerification, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    verificationId: request.verificationId,
    replayId: request.replayId,
    attestationId: request.attestationId,
    attestationContentSha256: request.attestationContentSha256,
    evidenceClass: 'companion_reported_managed_action_current_state',
    request,
    report: {
      ...report,
      protocolVersion: '1.5.0',
      adapterId: 'blender',
      transition: 'current_state_rechecked',
      procedureReplayCurrentStateRequest: request,
      artifactAttestation: null,
    },
    outcome: verified ? 'verified' : 'not_verified',
    reason,
    provenance: {
      authentication: 'negotiated_companion_lease',
      sessionFingerprintSha256: reportReceipt.sessionFingerprintSha256,
      reportReceipt: {
        sequence: reportReceipt.sequence,
        receivedAt: reportReceipt.receivedAt,
      },
    },
    verificationScope: {
      managedActionCurrentState: verified ? 'verified_at_report' : 'not_verified_at_report',
      nativeUndoCheckpoint: checkpointMatches
        ? 'companion_reported_current_at_report'
        : 'not_verified_at_report',
      currentHostStateAfterReport: 'not_verified',
    },
    recordedAt: input.recordedAt,
  };
  return procedureLeafReplayCurrentStateVerificationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayCurrentStateVerificationContentSha256(content),
    },
  });
}
