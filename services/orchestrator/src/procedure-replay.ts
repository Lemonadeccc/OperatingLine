import {
  canonicalizeProtocolJsonValue,
  computeProcedureLeafReplayAttestationContentSha256,
  computeProcedureLeafReplayBindingContentSha256,
  protocolJsonValueCanonicalization,
  procedureLeafReplayActionNameSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayFormatVersion,
  procedureLeafReplayObservationSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type GuideProposal,
  type GuideProposalDecision,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafReplayActionName,
  type ProcedureLeafReplayAttestation,
  type ProcedureLeafReplayBinding,
  type ProcedureLeafReplayProposalRequest,
} from '@operatingline/protocol';
import type { StoredManagedReplayReceipt } from '@operatingline/persistence';

import { satisfiesStableVersionRange } from './stable-version-ranges.js';

const replayActionContracts = {
  'blender.mesh.create_uv_sphere': {
    observationKind: 'uv_sphere_ready',
    dimensionMatchDetailKey: 'radiusMatches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
    expectedTopology: () => ({ vertexCount: 482, edgeCount: 992, faceCount: 512 }),
  },
  'blender.mesh.create_icosphere': {
    observationKind: 'icosphere_ready',
    dimensionMatchDetailKey: 'radiusMatches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      subdivisions: actionArguments['subdivisions'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
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
    dimensionMatchDetailKey: 'sizeMatches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    expectedTopology: () => ({ vertexCount: 8, edgeCount: 12, faceCount: 6 }),
  },
  'blender.mesh.create_plane': {
    observationKind: 'plane_ready',
    dimensionMatchDetailKey: 'sizeMatches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    expectedTopology: () => ({ vertexCount: 4, edgeCount: 4, faceCount: 1 }),
  },
  'blender.mesh.create_torus': {
    observationKind: 'torus_ready',
    dimensionMatchDetailKey: 'geometryMatches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      majorSegments: actionArguments['majorSegments'],
      minorSegments: actionArguments['minorSegments'],
      majorRadius: actionArguments['majorRadius'],
      minorRadius: actionArguments['minorRadius'],
      location: actionArguments['location'],
    }),
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
} as const satisfies Record<
  ProcedureLeafReplayActionName,
  {
    readonly observationKind: string;
    readonly dimensionMatchDetailKey: string;
    readonly expectedParameters: (
      actionArguments: Record<string, unknown>,
    ) => Record<string, unknown>;
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
    leaf.observationPolicy.failureStrategy !== 'rollback_step' ||
    leaf.rollback.mode !== 'compensating_action'
  ) {
    throw new ProcedureLeafReplayError(
      'Managed leaf replay requires a rollback_step success gate and compensating action',
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
  if (
    coverage.length !== 1 ||
    leafCoverage?.leafId !== leaf.id ||
    leafCoverage.menu !== 'materialized' ||
    !shortcutCoverageValid ||
    leafCoverage.mcp !== 'unavailable' ||
    leafCoverage.recipeId === null
  ) {
    throw new ProcedureLeafReplayError(
      'Replay leaf requires one catalog-grounded menu, an explicit shortcut state, and unavailable MCP',
    );
  }
  if (
    leaf.menuTracks.length !== 1 ||
    leaf.menuTracks[0]?.availability !== 'available' ||
    leaf.shortcutTracks.length !== 1 ||
    leaf.shortcutTracks[0]?.availability !==
      (leafCoverage.shortcut === 'materialized' ? 'available' : 'unavailable') ||
    leaf.mcpTracks.length !== 1 ||
    leaf.mcpTracks[0]?.availability !== 'unavailable'
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
  const actionContract = replayActionContracts[binding.actionName];
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
  const expectedDimensions =
    binding.actionName === 'blender.mesh.create_torus'
      ? [expectedParameters?.['majorRadius'], expectedParameters?.['minorRadius']]
      : [
          expectedParameters?.[
            binding.actionName === 'blender.mesh.create_uv_sphere' ||
            binding.actionName === 'blender.mesh.create_icosphere'
              ? 'radius'
              : 'size'
          ],
        ];
  const expectedSubdivisions = expectedParameters?.['subdivisions'];
  const expectedMajorSegments = expectedParameters?.['majorSegments'];
  const expectedMinorSegments = expectedParameters?.['minorSegments'];
  const expectedLocation = expectedParameters?.['location'];
  const expectedLocationX = Array.isArray(expectedLocation) ? expectedLocation[0] : undefined;
  const expectedLocationY = Array.isArray(expectedLocation) ? expectedLocation[1] : undefined;
  const expectedLocationZ = Array.isArray(expectedLocation) ? expectedLocation[2] : undefined;
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
    actionContract.dimensionMatchDetailKey,
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
    typeof expectedResourceId !== 'string' ||
    typeof expectedObjectName !== 'string' ||
    expectedDimensions.some(
      (dimension) => typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0,
    ) ||
    !Array.isArray(expectedLocation) ||
    expectedLocation.length !== 3 ||
    typeof expectedLocationX !== 'number' ||
    !Number.isFinite(expectedLocationX) ||
    typeof expectedLocationY !== 'number' ||
    !Number.isFinite(expectedLocationY) ||
    typeof expectedLocationZ !== 'number' ||
    !Number.isFinite(expectedLocationZ) ||
    (binding.actionName === 'blender.mesh.create_icosphere' &&
      (typeof expectedSubdivisions !== 'number' ||
        !Number.isInteger(expectedSubdivisions) ||
        expectedSubdivisions < 1 ||
        expectedSubdivisions > 5)) ||
    (binding.actionName === 'blender.mesh.create_torus' &&
      (typeof expectedMajorSegments !== 'number' ||
        !Number.isInteger(expectedMajorSegments) ||
        expectedMajorSegments < 3 ||
        expectedMajorSegments > 128 ||
        typeof expectedMinorSegments !== 'number' ||
        !Number.isInteger(expectedMinorSegments) ||
        expectedMinorSegments < 3 ||
        expectedMinorSegments > 64)) ||
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
  const attestedObservation = procedureLeafReplayObservationSchema.parse({
    kind: actionContract.observationKind,
    satisfied: true,
    details: structuredClone(observation.details),
  });
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
      mcpTrack: 'unavailable',
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
