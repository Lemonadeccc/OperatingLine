import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  actionCatalogSchema,
  canonicalizeProtocolJsonValue,
  companionActionExecutionStatusSchema,
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionCreateRequestSchema,
  companionExecutionTrackExecutionPollDeliverySchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionRecoveryPollDeliverySchema,
  companionExecutionTrackExecutionResultSchema,
  companionExecutionTrackExecutionStatusSchema,
  compileProcedureTreeToGuidePlan,
  computeProcedureLeafReplayFailureRecoveryAttestationContentSha256,
  guideProposalSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import { createActionCatalogRegistry } from '../../../services/orchestrator/src/action-catalogs.js';
import { createInteractionCatalogRegistry } from '../../../services/orchestrator/src/interaction-catalogs.js';
import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { createProcedureExecutionFailureReplanCoordinator } from '../../../services/orchestrator/src/procedure-execution-failure-replan.js';
import {
  createProcedureExecutionFailureReplanRuntimeResolver,
  procedureExecutionProofStrategyBindingForLeaf,
} from '../../../services/orchestrator/src/procedure-execution-failure-replan-runtime.js';
import { buildProcedureLeafReplayBinding } from '../../../services/orchestrator/src/procedure-replay.js';
import { startRuntime } from '../../../services/orchestrator/src/index.js';
import {
  managedExecutionTrackBaseline,
  managedExecutionTrackBinding,
  managedExecutionTrackFailedTerminalMarker,
  managedExecutionTrackFailureReport,
  managedExecutionTrackFailureResult,
  managedExecutionTrackManagedStart,
  managedExecutionTrackProgressTail,
  managedExecutionTrackRecoveredReport,
  managedExecutionTrackRepairAck,
  managedExecutionTrackStartReport,
  managedExecutionTrackSuccessReport,
  managedExecutionTrackSuccessResult,
  managedExecutionTrackTimeline,
} from '../../support/managed-execution-track-scenario.js';
import {
  executionTrackPreflightFixture,
  preflightIds,
} from '../support/execution-track-preflight-fixture.js';

const ids = {
  replay: '11111111-1111-4111-8111-111111111111',
  instance: '22222222-2222-4222-8222-222222222222',
  proposal: '33333333-3333-4333-8333-333333333333',
  decision: '44444444-4444-4444-8444-444444444444',
  execution: '55555555-5555-4555-8555-555555555555',
  report: '66666666-6666-4666-8666-666666666666',
  attestation: '77777777-7777-4777-8777-777777777777',
  request: '88888888-8888-4888-8888-888888888888',
  delivery: '99999999-9999-4999-8999-999999999999',
  expectedReport: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  startCheckpoint: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;
const requestedAt = '2026-08-21T09:59:58Z';
const dispatchedAt = '2026-08-21T09:59:59Z';
const occurredAt = '2026-08-21T10:00:00Z';
const attestedAt = '2026-08-21T10:00:01Z';
const strategyTargetLeafId = 'snowman.head.eyes.left';
const strategyFirstLeafId = 'snowman.head.eyes.prerequisite';

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function strategyActionCatalog() {
  const catalog = structuredClone(blenderActionCatalog);
  const action = catalog.actions.find(
    (candidateAction) => candidateAction.name === 'blender.mesh.create_uv_sphere',
  );
  if (action === undefined) throw new Error('Expected managed UV Sphere action');
  const radius = (action.argumentsSchema.properties as Record<string, Record<string, unknown>>)[
    'radius'
  ];
  if (radius === undefined) throw new Error('Expected UV Sphere radius schema');
  radius['minimum'] = 1.5;
  radius['maximum'] = 1.5;
  return actionCatalogSchema.parse(catalog);
}

function candidate(
  options: { readonly proofBackedStrategy?: boolean; readonly laterLeaf?: boolean } = {},
): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  const nodes = tree['nodes'] as Array<Record<string, unknown>>;
  if (options.laterLeaf === true) {
    const targetIndex = nodes.findIndex((node) => node['id'] === strategyTargetLeafId);
    const target = nodes[targetIndex];
    if (targetIndex < 0 || target?.['kind'] !== 'leaf') {
      throw new Error('Expected strategy target leaf');
    }
    const first = structuredClone(target);
    first['id'] = strategyFirstLeafId;
    first['order'] = 1;
    first['dependsOn'] = [];
    first['title'] = '创建先决 UV 球体';
    first['intent'] = '先创建一个独立球体以解锁目标叶';
    target['order'] = 2;
    target['dependsOn'] = [strategyFirstLeafId];
    nodes.splice(targetIndex, 0, first);
  }
  for (const node of nodes) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    const action = node['action'] as
      { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (action?.name === 'blender.mesh.create_uv_sphere' && action.arguments !== undefined) {
      if (options.proofBackedStrategy === true) {
        action.arguments =
          leafId === strategyFirstLeafId
            ? {
                resourceId: 'proof.uv_sphere.prerequisite',
                objectName: 'OperatingLine.TutorialPrerequisite',
                radius: 1.5,
                location: [-1.25, -2, 0.75],
              }
            : {
                resourceId: 'proof.uv_sphere.eye',
                objectName: 'OperatingLine.TutorialEye',
                radius: 1.5,
                location: [1.25, -2, 0.75],
              };
      }
      node['expectedObservations'] = [
        {
          kind: 'uv_sphere_ready',
          parameters: {
            resourceId: action.arguments['resourceId'],
            objectName: action.arguments['objectName'],
            radius: action.arguments['radius'],
            location: action.arguments['location'],
          },
        },
      ];
    }
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.${modality}.candidate`,
          availability: 'unavailable',
          title: `${modality} candidate`,
          reason: 'Awaiting deterministic materialization.',
          modality,
        },
      ];
    }
    (node['validation'] as Record<string, unknown>)['status'] = 'candidate';
    (node['validation'] as Record<string, unknown>)['validatedHostVersions'] = [];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function fixture(
  options: {
    readonly proofBackedStrategy?: boolean;
    readonly laterLeaf?: boolean;
    readonly actionCatalog?: typeof blenderActionCatalog;
  } = {},
) {
  const tree = candidate(options);
  const actionCatalog = options.actionCatalog ?? blenderActionCatalog;
  const leaf = tree.nodes.find((node) => node.id === strategyTargetLeafId);
  if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('Expected managed leaf');
  const packet = {
    formatVersion: '1.0.0',
    context: {
      requestedTreeId: tree.id,
      recommendedRevision: tree.revision,
      goalProvenance: {
        source: tree.sources[0]!,
        evidence: {
          id: tree.evidence[0]!.id,
          locator: tree.evidence[0]!.locator,
          description: tree.evidence[0]!.description,
          confidence: tree.evidence[0]!.confidence,
        },
      },
      catalogBinding: {
        adapterId: tree.adapterId,
        actionCatalog: withoutKey(actionCatalog, 'adapterId'),
        interactionCatalog: withoutKey(
          withoutKey(blenderInteractionCatalog, 'adapterId'),
          'actionCatalogVersion',
        ),
      },
      constraints: {
        allGeneratedLeavesCandidate: true,
        validatedHostVersionsEmpty: true,
        exactParametersRemainOnSemanticOperations: true,
        allInteractionTracksUnavailable: true,
        persistenceRequiresExplicitStore: true,
      },
    },
    retrieval: {
      toolName: 'operatingline.procedure.search',
      matching: 'exact_structured_filters',
      similarityScoreProduced: false,
    },
    responseContract: { mediaType: 'application/json', schema: {} },
    workflow: {
      validationToolName: 'operatingline.procedure.authoring.validate',
      compileToolName: 'operatingline.procedure.compile',
      instructions: ['Return one candidate ProcedureTree JSON object.'],
    },
    limits: { maxCanonicalBytes: 262_144 },
    sideEffects: {
      modelCalled: false,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: 'a'.repeat(64),
    },
  } as const;
  const request = {
    formatVersion: '1.0.0',
    replayId: ids.replay,
    targetInstanceId: ids.instance,
    leafId: leaf.id,
    replayMode: 'managed_action',
    packet,
    tree,
  } as const;
  const grounded = materializeProcedureAuthoringCandidate(
    tree,
    actionCatalog,
    blenderInteractionCatalog,
  );
  const plan = compileProcedureTreeToGuidePlan(grounded.tree);
  const planContentSha256 = hash(plan);
  const materialization = {
    ...withoutKey(grounded, 'interactionCatalogContentSha256'),
    packetContentSha256: packet.integrity.contentSha256,
    catalogBinding: {
      adapterId: tree.adapterId,
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      interactionCatalogContentSha256: 'b'.repeat(64),
    },
    validation: {
      packetIntegrity: 'validated',
      installedCatalogBinding: 'validated',
      authoringCandidateContract: 'validated',
      procedureCompilation: 'validated',
      interactionGrounding: 'validated_against_installed_interaction_catalog',
    },
    compilation: {
      formatVersion: grounded.tree.formatVersion,
      procedureTreeId: grounded.tree.id,
      procedureTreeRevision: grounded.tree.revision,
      adapterId: grounded.tree.adapterId,
      actionCatalogVersion: grounded.tree.actionCatalogVersion,
      interactionCatalogVersion: grounded.tree.interactionCatalogVersion,
      validation: {
        procedureStructure: 'validated',
        actionCatalogBinding: 'validated',
        hostVersionRange: 'validated_against_action_catalog',
        interactionTracks: 'structural_only',
      },
      plan,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  } as const;
  const proposal = {
    protocolVersion: '1.5.0',
    proposalId: ids.proposal,
    targetAdapterId: 'blender',
    targetInstanceId: ids.instance,
    plan,
    planDiff: null,
    catalogVersion: actionCatalog.catalogVersion,
    proposedAt: requestedAt,
  } as const;
  const coverage = materialization.coverage.find((entry) => entry.leafId === leaf.id);
  if (coverage?.recipeId === null || coverage?.recipeId === undefined) {
    throw new Error('Expected target leaf materialization coverage');
  }
  const binding = buildProcedureLeafReplayBinding({
    request,
    materialization,
    proposal,
    planContentSha256,
    recipeId: coverage.recipeId,
    actionName: leaf.action.name,
    createdAt: requestedAt,
  });
  const groundedLeaf = binding.materialization.tree.nodes.find(
    (node) => node.id === binding.leafId,
  );
  const step = binding.proposal.plan.steps.find(
    (candidateStep) => candidateStep.id === binding.leafId,
  );
  if (groundedLeaf?.kind !== 'leaf' || groundedLeaf.action === null || step === undefined) {
    throw new Error('Expected grounded leaf and compiled step');
  }
  const startCheckpoint = {
    formatVersion: '1.0.0',
    evidenceClass: 'companion_reported_native_undo_checkpoint',
    checkpointId: ids.startCheckpoint,
    previousCheckpointId: null,
    operation: 'start',
    committedAt: dispatchedAt,
    marker: { key: '_operating_line_native_history_v1', matched: true },
    journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
    session: {
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256,
      executionId: ids.execution,
      activeStepId: null,
      completedStepIds: [],
      receiptStepIds: [],
    },
  } as const;
  const startReport = {
    protocolVersion: '1.5.0',
    reportId: ids.expectedReport,
    sequence: 7,
    adapterId: 'blender',
    instanceId: ids.instance,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: plan.id, revision: plan.revision },
    planContentSha256,
    executionId: ids.execution,
    phase: 'running',
    activeStepId: null,
    completedStepIds: [],
    transition: 'walkthrough_started',
    stepId: null,
    observations: [],
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: startCheckpoint,
    error: null,
    occurredAt: dispatchedAt,
  } as const;
  const failureReport = {
    protocolVersion: '1.5.0',
    reportId: ids.report,
    sequence: 8,
    adapterId: 'blender',
    instanceId: ids.instance,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: plan.id, revision: plan.revision },
    planContentSha256,
    executionId: ids.execution,
    phase: 'running',
    activeStepId: null,
    completedStepIds: [],
    transition: 'step_observation_failed',
    stepId: binding.leafId,
    observations: [
      {
        kind: 'uv_sphere_ready',
        satisfied: false,
        details: { supported: true, contentIntact: false },
      },
    ],
    observationGate: {
      stepId: binding.leafId,
      status: 'failed_rolled_back',
      failureStrategy: 'rollback_step',
      message: 'The managed step failed and was rolled back.',
    },
    artifactAttestation: null,
    error: null,
    occurredAt,
  } as const;
  const attestationContent = {
    formatVersion: '1.0.0',
    replayId: ids.replay,
    attestationId: ids.attestation,
    decision: {
      protocolVersion: '1.5.0',
      decisionId: ids.decision,
      proposalId: ids.proposal,
      adapterId: 'blender',
      instanceId: ids.instance,
      decision: 'accepted',
      occurredAt: dispatchedAt,
    },
    authorization: {
      actionExecutionRequestId: ids.request,
      startState: {
        reportId: startReport.reportId,
        sequence: startReport.sequence,
        reportContentSha256: hash(startReport),
        checkpointId: startCheckpoint.checkpointId,
        checkpointContentSha256: hash(startCheckpoint),
        phase: 'running',
        activeStepId: startReport.activeStepId,
        checkpointOperation: startCheckpoint.operation,
        completedStepIds: startReport.completedStepIds,
        receiptStepIds: startCheckpoint.session.receiptStepIds,
      },
    },
    failureReport,
    recoveryReport: null,
    evidenceClass: 'companion_reported_managed_action_failure_recovery',
    outcome: 'automatically_rolled_back',
    provenance: {
      authentication: 'negotiated_companion_lease',
      executionSessionFingerprintSha256: 'c'.repeat(64),
      recoverySessionFingerprintSha256: null,
      proposalReceipt: { sequence: 1, receivedAt: requestedAt },
      decisionReceipt: { sequence: 2, receivedAt: dispatchedAt },
      startReportReceipt: { sequence: 3, receivedAt: dispatchedAt },
      failureReportReceipt: { sequence: 4, receivedAt: occurredAt },
      recoveryReportReceipt: null,
    },
    bindingContentSha256: binding.integrity.contentSha256,
    execution: {
      host: { adapterId: 'blender', instanceId: ids.instance, version: '4.5.3' },
      companion: { version: '0.1.0' },
      plan: { id: plan.id, revision: plan.revision, contentSha256: planContentSha256 },
      execution: { id: ids.execution },
      step: { id: binding.leafId },
      action: { adapterId: 'blender', name: binding.actionName },
      occurredAt,
    },
    verificationScope: {
      managedActionAttempt: 'observation_failed',
      rollbackOutcome: 'companion_reported_succeeded',
      recoveryOutcome: 'not_required',
      menuTrack: binding.claims.menuTrack,
      shortcutTrack: binding.claims.shortcutTrack,
      mcpTrack: binding.claims.mcpTrack,
      failureNativeUndoCheckpoint: 'not_verified_at_failure_report',
      terminalNativeUndoCheckpoint: 'not_applicable_no_retained_step',
      currentHostStateAfterReport: 'not_verified',
    },
    attestedAt,
  } as const;
  const attestation = procedureLeafReplayFailureRecoveryAttestationSchema.parse({
    ...attestationContent,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256:
        computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(attestationContent),
    },
  });
  const result = {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    deliveryId: ids.delivery,
    target: { adapterId: 'blender', instanceId: ids.instance },
    proposalId: ids.proposal,
    plan: { id: plan.id, revision: plan.revision },
    planContentSha256,
    executionId: ids.execution,
    expectedState: { reportId: ids.expectedReport, sequence: 7 },
    stepId: binding.leafId,
    status: 'failed',
    report: { reportId: ids.report, sequence: 8 },
    error: 'Observation did not match.',
    occurredAt,
  } as const;
  const execution = {
    formatVersion: '1.0.0',
    requestId: ids.request,
    replayId: ids.replay,
    target: result.target,
    proposalId: ids.proposal,
    plan: result.plan,
    planContentSha256,
    executionId: ids.execution,
    expectedState: result.expectedState,
    deliveryId: ids.delivery,
    dispatchedAt,
    step,
    requestedAt,
    status: 'failed',
    result,
    updatedAt: occurredAt,
  } as const;
  return { binding, attestation, execution, groundedLeaf };
}

function companionHello(instanceId: string) {
  return {
    contractVersion: '1.1.0',
    adapterId: 'blender',
    instanceId,
    sessionId: randomUUID(),
    documentIncarnationId: randomUUID(),
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    supportedGuideProtocolVersions: [blenderActionCatalog.protocolVersion, '1.6.0'],
    catalogVersion: blenderActionCatalog.catalogVersion,
    capabilities: {
      presentation: {
        taskTree: 'native',
        viewportOverlay: 'native',
        interactiveAnchors: 'emulated',
      },
      execution: {
        inspect: 'native',
        invokeActions: 'native',
        screenshot: 'native',
        rollbackModes: ['compensating_action', 'native_undo'],
      },
      runtime: {
        dispatch: 'main_thread_serial',
        network: 'native',
        persistentProjectState: 'native',
      },
    },
  };
}

function seedFinalizedFailure(databasePath: string, base: ReturnType<typeof fixture>): void {
  const sessionFingerprintSha256 = 'c'.repeat(64);
  const terminal = companionActionExecutionStatusSchema.parse(base.execution);
  const immutable = {
    formatVersion: terminal.formatVersion,
    requestId: terminal.requestId,
    replayId: terminal.replayId,
    target: terminal.target,
    proposalId: terminal.proposalId,
    plan: terminal.plan,
    planContentSha256: terminal.planContentSha256,
    executionId: terminal.executionId,
    expectedState: terminal.expectedState,
    step: terminal.step,
    requestedAt: terminal.requestedAt,
  } as const;
  const queued = companionActionExecutionStatusSchema.parse({
    ...immutable,
    status: 'queued',
    updatedAt: terminal.requestedAt,
  });
  const dispatched = companionActionExecutionStatusSchema.parse({
    ...immutable,
    deliveryId: terminal.deliveryId,
    dispatchedAt: terminal.dispatchedAt,
    status: 'dispatched',
    updatedAt: terminal.dispatchedAt,
  });
  const database = openOperatingLineDatabase(databasePath);
  try {
    expect(
      database.recordProcedureLeafReplayProposal(base.binding.proposal, {
        replayId: base.binding.replayId,
        proposalId: base.binding.proposal.proposalId,
        treeId: base.binding.materialization.tree.id,
        treeRevision: base.binding.materialization.tree.revision,
        leafId: base.binding.leafId,
        adapterId: base.binding.materialization.tree.adapterId,
        instanceId: base.binding.targetInstanceId,
        bindingContentSha256: base.binding.integrity.contentSha256,
        payload: base.binding,
        createdAt: base.binding.createdAt,
      }),
    ).toBe('accepted');
    expect(
      database.recordGuideProposalDecision(base.attestation.decision, {
        sessionFingerprintSha256,
      }),
    ).toBe('accepted');
    expect(
      database.recordCompanionState(base.attestation.failureReport, {
        sessionFingerprintSha256,
      }),
    ).toBe('accepted');
    expect(
      database.recordProcedureLeafReplayAttestation({
        attestationId: base.attestation.attestationId,
        replayId: base.attestation.replayId,
        reportId: base.attestation.failureReport.reportId,
        evidenceReportIds: [base.attestation.failureReport.reportId],
        executionId: base.attestation.execution.execution.id,
        contentSha256: base.attestation.integrity.contentSha256,
        payload: base.attestation,
        attestedAt: base.attestation.attestedAt,
      }),
    ).toBe('accepted');
    for (const [eventType, execution] of [
      ['blender.action-execution.queued', queued],
      ['blender.action-execution.dispatched', dispatched],
      ['blender.action-execution.completed', terminal],
    ] as const) {
      database.appendEvent({
        id: `strategy:${terminal.requestId}:${execution.status}`,
        eventType,
        payload: { execution, sessionFingerprintSha256 },
        createdAt: execution.updatedAt,
      });
    }
  } finally {
    database.close();
  }
}

async function reviewStrategyProposal(runtime: { readonly baseUrl: string }) {
  const authorization = 'Bearer failure-replan-strategy-token';
  const headers = { authorization, 'content-type': 'application/json' };
  const sessionHello = companionHello(ids.instance);
  const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sessionHello),
  });
  expect(sessionResponse.status).toBe(200);
  const session = (await sessionResponse.json()) as { leaseId: string };
  const leaseHeaders = {
    ...headers,
    'x-operatingline-companion-lease': session.leaseId,
  };
  const failureUrl = new URL('/api/v1/procedure/failure-replan', runtime.baseUrl);
  failureUrl.searchParams.set('requestId', ids.request);
  const failureResponse = await fetch(failureUrl, { headers });
  expect(failureResponse.status).toBe(200);
  await expect(failureResponse.json()).resolves.toMatchObject({
    kind: 'strategy_switch_proposed',
  });

  const reviewUrl = new URL('/api/v1/procedure/failure-replan/review', runtime.baseUrl);
  reviewUrl.searchParams.set('requestId', ids.request);
  const previewResponse = await fetch(reviewUrl, { headers });
  expect(previewResponse.status).toBe(200);
  const preview = (await previewResponse.json()) as {
    state: 'pending';
    preview: {
      proposal: { proposalId: string };
      reviewBindingSha256: string;
      acceptance: {
        status: 'available';
        artifacts: { guideProposal: { proposalId: string } };
      };
    };
  };
  expect(preview).toMatchObject({
    state: 'pending',
    preview: {
      acceptance: {
        status: 'available',
        artifacts: {
          guideProposal: {
            proposalId: expect.any(String),
          },
        },
      },
    },
  });
  const reviewResponse = await fetch(reviewUrl, {
    method: 'POST',
    headers: leaseHeaders,
    body: JSON.stringify({
      formatVersion: '1.0.0',
      requestId: ids.request,
      reviewId: randomUUID(),
      proposalId: preview.preview.proposal.proposalId,
      reviewBindingSha256: preview.preview.reviewBindingSha256,
      decision: {
        kind: 'accept',
        confirmations: {
          exactCandidateReviewed: true,
          exactBasePlanReviewed: true,
          noProviderCallAcknowledged: true,
          noHostExecutionAcknowledged: true,
        },
      },
      reviewedAt: new Date().toISOString(),
    }),
  });
  expect(reviewResponse.status, JSON.stringify(await reviewResponse.clone().json())).toBe(200);
  await expect(reviewResponse.json()).resolves.toMatchObject({
    result: 'accepted',
    review: {
      finalStatus: 'accepted',
      guideProposalId: preview.preview.acceptance.artifacts.guideProposal.proposalId,
      acceptedArtifacts: {
        guideProposalContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        revisionRequestContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        executionTrackOverrideContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    },
  });
  return {
    guideProposalId: preview.preview.acceptance.artifacts.guideProposal.proposalId,
    leaseHeaders,
    sessionHello,
  };
}

async function companionLeaseHeaders(runtime: { readonly baseUrl: string }) {
  const headers = {
    authorization: 'Bearer failure-replan-strategy-token',
    'content-type': 'application/json',
  };
  const response = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify(companionHello(ids.instance)),
  });
  expect(response.status).toBe(200);
  const session = (await response.json()) as { leaseId: string };
  return { ...headers, 'x-operatingline-companion-lease': session.leaseId };
}

async function callMcpTool(
  runtime: { readonly mcpEndpoint: string },
  id: number,
  name: string,
  argumentsValue: unknown,
) {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer failure-replan-strategy-token',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  expect(response.status).toBe(200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  if (dataLine === undefined) throw new Error('Expected one MCP SSE data event');
  return JSON.parse(dataLine.slice('data: '.length)) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: unknown };
  };
}

function acceptedTrackDecision(proposalId: string) {
  return {
    protocolVersion: '1.6.0',
    decisionId: randomUUID(),
    proposalId,
    adapterId: 'blender',
    instanceId: ids.instance,
    decision: 'accepted',
    occurredAt: new Date().toISOString(),
  } as const;
}

async function acceptTrackAndReportReadyState(
  runtime: { readonly baseUrl: string },
  databasePath: string,
  decisionKind: 'accepted' | 'rejected' = 'accepted',
  options: { readonly completedPrefix?: boolean } = {},
) {
  const reviewed = await reviewStrategyProposal(runtime);
  const decision = {
    ...acceptedTrackDecision(reviewed.guideProposalId),
    decision: decisionKind,
  } as const;
  const decisionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
    method: 'POST',
    headers: reviewed.leaseHeaders,
    body: JSON.stringify(decision),
  });
  expect(decisionResponse.status, JSON.stringify(await decisionResponse.clone().json())).toBe(200);

  const database = openOperatingLineDatabase(databasePath);
  let proposal;
  try {
    proposal = guideProposalSchema.parse(database.getGuideProposal(reviewed.guideProposalId));
  } finally {
    database.close();
  }
  const step = proposal.plan.steps.find(
    (candidateStep) => candidateStep.executionTrackOverride !== undefined,
  );
  if (step?.executionTrackOverride === undefined)
    throw new Error('Expected reviewed override step');
  const completedPrefixStep =
    options.completedPrefix === true
      ? proposal.plan.steps.find(
          (candidateStep) =>
            candidateStep.action !== null && step.dependsOn.includes(candidateStep.id),
        )
      : undefined;
  if (options.completedPrefix === true && completedPrefixStep === undefined) {
    throw new Error('Expected completed prerequisite step');
  }
  const completedStepIds =
    completedPrefixStep === undefined ? [] : ([completedPrefixStep.id] as const);
  const activeStepId = completedPrefixStep?.id ?? null;
  const transition = completedPrefixStep === undefined ? 'walkthrough_started' : 'step_succeeded';
  const observations =
    completedPrefixStep === undefined
      ? []
      : [
          {
            kind: completedPrefixStep.expectedObservations[0]!.kind,
            satisfied: true,
            details: completedPrefixStep.expectedObservations[0]!.parameters,
          },
        ];
  const planContentSha256 = hash(proposal.plan);
  const executionId = randomUUID();
  const reportId = randomUUID();
  const reportedAt = new Date().toISOString();
  const report = {
    protocolVersion: '1.6.0',
    reportId,
    sequence: 9,
    adapterId: 'blender',
    instanceId: ids.instance,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256,
    executionId,
    phase: 'running',
    activeStepId,
    completedStepIds,
    transition,
    stepId: activeStepId,
    observations,
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: randomUUID(),
      previousCheckpointId: completedPrefixStep === undefined ? null : randomUUID(),
      operation: completedPrefixStep === undefined ? 'start' : 'next',
      committedAt: reportedAt,
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: {
        entryPresent: true,
        snapshotMatchesSession: true,
        artifactsBackedUp: true,
      },
      session: {
        plan: { id: proposal.plan.id, revision: proposal.plan.revision },
        planContentSha256,
        executionId,
        activeStepId,
        completedStepIds,
        receiptStepIds: completedStepIds,
      },
    },
    error: null,
    occurredAt: reportedAt,
  } as const;
  const stateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
    method: 'POST',
    headers: reviewed.leaseHeaders,
    body: JSON.stringify(report),
  });
  expect(stateResponse.status, JSON.stringify(await stateResponse.clone().json())).toBe(200);
  await expect(stateResponse.json()).resolves.toEqual({ result: 'accepted' });
  return {
    headers: reviewed.leaseHeaders,
    sessionHello: reviewed.sessionHello,
    proposal,
    report,
    completedPrefixStep,
    request: {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      target: { adapterId: 'blender', instanceId: ids.instance },
      proposalId: proposal.proposalId,
      plan: {
        protocolVersion: '1.6.0',
        id: proposal.plan.id,
        revision: proposal.plan.revision,
        contentSha256: planContentSha256,
      },
      executionId,
      leafId: step.id,
      override: step.executionTrackOverride,
      expectedState: { reportId, sequence: report.sequence },
    },
  } as const;
}

function harness(
  overrides: {
    binding?: unknown;
    attestation?: unknown;
    events?: unknown[];
    sessionFingerprintSha256?: string;
    currentAcceptedPlan?: {
      id: string;
      revision: number;
      contentSha256: string;
    } | null;
    actionCatalog?: typeof blenderActionCatalog;
  } = {},
) {
  const base = fixture();
  const getProcedureLeafReplay = vi.fn(() =>
    'binding' in overrides ? overrides.binding : base.binding,
  );
  const getProcedureLeafReplayAttestation = vi.fn(() =>
    'attestation' in overrides ? overrides.attestation : base.attestation,
  );
  const listExecutionEventsByTypes = vi.fn(() =>
    (overrides.events ?? [base.execution]).map((execution, index) => ({
      sequence: index + 1,
      id: `event-${index}`,
      eventType: 'blender.action-execution.completed',
      payload: {
        execution,
        sessionFingerprintSha256: overrides.sessionFingerprintSha256 ?? 'c'.repeat(64),
      },
      createdAt: occurredAt,
    })),
  );
  const actionCatalogRegistry = createActionCatalogRegistry([
    overrides.actionCatalog ?? blenderActionCatalog,
  ]);
  const interactionCatalogRegistry = createInteractionCatalogRegistry(
    [blenderInteractionCatalog],
    actionCatalogRegistry,
  );
  return {
    ...base,
    resolver: createProcedureExecutionFailureReplanRuntimeResolver({
      database: {
        getProcedureLeafReplay,
        getProcedureLeafReplayAttestation,
        listExecutionEventsByTypes,
      },
      actionCatalogRegistry,
      interactionCatalogRegistry,
      resolveCurrentAcceptedPlan: () =>
        'currentAcceptedPlan' in overrides
          ? (overrides.currentAcceptedPlan ?? null)
          : {
              id: base.execution.plan.id,
              revision: base.execution.plan.revision,
              contentSha256: base.execution.planContentSha256,
            },
    }),
    spies: {
      getProcedureLeafReplay,
      getProcedureLeafReplayAttestation,
      listExecutionEventsByTypes,
    },
  };
}

describe('procedure execution failure replan runtime resolver', () => {
  it('resolves exact durable evidence without invoking a provider or host side effect', () => {
    const { resolver, attestation, spies } = harness();
    const resolution = resolver.resolve(ids.request);
    expect(resolution).not.toBeNull();
    expect(resolution).toMatchObject({
      currentPlanContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      semanticCandidate: null,
      failureEvidence: {
        execution: { requestId: ids.request, status: 'failed' },
        checkpoint: { state: 'restored' },
        recovery: { state: 'not_required' },
      },
    });
    expect(resolver.findRequestIdForAttestation(attestation)).toBe(ids.request);
    expect(resolver.listResolvableRequestIds()).toEqual([ids.request]);
    const storedEvents: Array<{
      sequence: number;
      id: string;
      eventType: string;
      payload: unknown;
      createdAt: string;
    }> = [];
    const coordinator = createProcedureExecutionFailureReplanCoordinator({
      database: {
        appendEvent: (event) => {
          const stored = {
            sequence: storedEvents.length + 1,
            id: event.id,
            eventType: event.eventType,
            payload: event.payload,
            createdAt: event.createdAt ?? attestedAt,
          };
          storedEvents.push(stored);
          return stored;
        },
        listExecutionEventsByTypes: (types) =>
          storedEvents.filter((event) => types.includes(event.eventType)),
      },
      trustedResolver: resolver,
      now: () => attestedAt,
      createId: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    expect(coordinator.derive({ requestId: ids.request })).toMatchObject({
      kind: 'parameter_repair_proposed',
      proposal: { diff: { argument: 'radius', after: 0.06 } },
    });
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.payload).toMatchObject({
      sourceBindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(spies.getProcedureLeafReplay).toHaveBeenCalled();
    expect(Object.keys(spies)).toEqual([
      'getProcedureLeafReplay',
      'getProcedureLeafReplayAttestation',
      'listExecutionEventsByTypes',
    ]);
  });

  it('derives deterministic schema-valid candidates and admits only exact proof-backed alternatives', () => {
    const first = harness().resolver.resolve(ids.request)!;
    const second = harness().resolver.resolve(ids.request)!;
    expect(first.parameterRepairCandidates).toEqual(second.parameterRepairCandidates);
    expect(first.parameterRepairCandidates).toContainEqual(
      expect.objectContaining({
        argument: 'radius',
        value: 0.06,
        observationObligations: [
          expect.objectContaining({ parameters: expect.objectContaining({ radius: 0.06 }) }),
        ],
      }),
    );
    expect(first.repairableArguments.map(({ argument }) => argument)).not.toContain('resourceId');
    expect(first.strategy?.tracks[0]).toMatchObject({ modality: 'mcp' });
    expect(first.strategy?.tracks.slice(1).every((track) => track.modality !== 'mcp')).toBe(true);
    expect(first.strategy?.tracks.slice(1)).toEqual([]);
    expect(first.failureEvidence.checkpoint.receipt?.receiptId).toBe(
      second.failureEvidence.checkpoint.receipt?.receiptId,
    );
  });

  it('binds exact materialized proof tracks separately from the strategy wrapper', () => {
    const input = structuredClone(candidate());
    const inputLeaf = input.nodes.find((node) => node.kind === 'leaf');
    if (inputLeaf?.kind !== 'leaf' || inputLeaf.action === null) {
      throw new Error('Expected managed leaf');
    }
    inputLeaf.action.arguments = {
      resourceId: 'proof.uv_sphere.eye',
      objectName: 'OperatingLine.TutorialEye',
      radius: 1.5,
      location: [1.25, -2, 0.75],
    };
    inputLeaf.expectedObservations = [
      {
        kind: 'uv_sphere_ready',
        parameters: {
          resourceId: 'proof.uv_sphere.eye',
          objectName: 'OperatingLine.TutorialEye',
          radius: 1.5,
          location: [1.25, -2, 0.75],
        },
      },
    ];
    const grounded = materializeProcedureAuthoringCandidate(
      procedureAuthoringCandidateTreeSchema.parse(input),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = grounded.tree.nodes.find((node) => node.id === inputLeaf.id);
    const coverage = grounded.coverage.find((entry) => entry.leafId === inputLeaf.id);
    if (leaf?.kind !== 'leaf' || coverage?.recipeId === null || coverage?.recipeId === undefined) {
      throw new Error('Expected exact proof-backed materialization');
    }
    const binding = procedureExecutionProofStrategyBindingForLeaf(leaf, coverage.recipeId);
    const menuTrack = leaf.menuTracks.find(
      (track) => track.availability === 'available' && track.proofExecution !== undefined,
    );
    expect(binding).not.toBeNull();
    expect(binding?.currentTrackId).toBe(
      leaf.mcpTracks.find((track) => track.availability === 'available')?.id,
    );
    expect(binding?.candidates).toEqual([
      expect.objectContaining({
        semanticLeafId: leaf.id,
        recipeId: coverage.recipeId,
        modality: 'menu',
        trackId: menuTrack?.id,
        trackContentSha256: hash(menuTrack),
        proofExecutionContentSha256: hash(
          menuTrack?.availability === 'available' ? menuTrack.proofExecution : undefined,
        ),
        verifiedTrackContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(binding?.candidates[0]?.trackContentSha256).not.toBe(
      binding?.candidates[0]?.verifiedTrackContentSha256,
    );
  });

  it('derives a strategy switch when a proof-backed alternate exists and no parameter repair applies', () => {
    const actionCatalog = strategyActionCatalog();
    const base = fixture({ proofBackedStrategy: true, actionCatalog });
    const runtimeHarness = harness({
      binding: base.binding,
      attestation: base.attestation,
      events: [base.execution],
      actionCatalog,
      currentAcceptedPlan: {
        id: base.execution.plan.id,
        revision: base.execution.plan.revision,
        contentSha256: base.execution.planContentSha256,
      },
    });
    const resolution = runtimeHarness.resolver.resolve(ids.request);
    expect(resolution?.parameterRepairCandidates).toEqual([]);
    expect(resolution?.strategy?.tracks).toEqual([
      expect.objectContaining({ modality: 'mcp' }),
      expect.objectContaining({ modality: 'menu' }),
    ]);

    const storedEvents: Array<{
      sequence: number;
      id: string;
      eventType: string;
      payload: unknown;
      createdAt: string;
    }> = [];
    const coordinator = createProcedureExecutionFailureReplanCoordinator({
      database: {
        appendEvent: (event) => {
          const stored = {
            sequence: storedEvents.length + 1,
            id: event.id,
            eventType: event.eventType,
            payload: event.payload,
            createdAt: event.createdAt ?? attestedAt,
          };
          storedEvents.push(stored);
          return stored;
        },
        listExecutionEventsByTypes: (types) =>
          storedEvents.filter((event) => types.includes(event.eventType)),
      },
      trustedResolver: runtimeHarness.resolver,
      now: () => attestedAt,
      createId: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    expect(coordinator.derive({ requestId: ids.request })).toMatchObject({
      kind: 'strategy_switch_proposed',
      proposal: {
        diff: {
          semanticLeafId: base.binding.leafId,
          modality: 'menu',
          fromTrackId: expect.any(String),
          toTrackId: expect.any(String),
          verifiedTrackContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });
  });

  it('preserves the trusted exhausted retry count in canonical failure evidence', () => {
    const base = fixture();
    const attestationContent = {
      ...withoutKey(base.attestation, 'integrity'),
      failureReport: {
        ...base.attestation.failureReport,
        observationGate: {
          ...base.attestation.failureReport.observationGate,
          retry: {
            mode: 'automatic_bounded',
            attempt: 2,
            maxAttempts: 2,
            remainingAttempts: 0,
            disposition: 'exhausted',
          },
        },
      },
    } as const;
    const attestation = procedureLeafReplayFailureRecoveryAttestationSchema.parse({
      ...attestationContent,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256:
          computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(attestationContent),
      },
    });
    expect(
      harness({ attestation }).resolver.resolve(ids.request)?.failureEvidence.attempts,
    ).toEqual([
      expect.objectContaining({ attempt: 1, occurredAt: requestedAt }),
      expect.objectContaining({ attempt: 2, occurredAt }),
    ]);
  });

  it('fails closed for ambiguity, identity mismatch, non-finalized evidence, and catalog drift', () => {
    const base = fixture();
    const ambiguous = harness({ events: [base.execution, base.execution] }).resolver;
    expect(ambiguous.resolve(ids.request)).toBeNull();
    expect(ambiguous.findRequestIdForAttestation(base.attestation)).toBeNull();

    const wrongSession = harness({ sessionFingerprintSha256: 'd'.repeat(64) }).resolver;
    expect(wrongSession.resolve(ids.request)).toBeNull();
    expect(wrongSession.findRequestIdForAttestation(base.attestation)).toBeNull();
    expect(wrongSession.listResolvableRequestIds()).toEqual([]);

    const newerAcceptedPlan = {
      id: base.execution.plan.id,
      revision: base.execution.plan.revision + 1,
      contentSha256: 'e'.repeat(64),
    };
    expect(
      harness({ currentAcceptedPlan: newerAcceptedPlan }).resolver.resolve(ids.request),
    ).toMatchObject({
      currentAcceptedRevision: newerAcceptedPlan.revision,
      currentPlanContentSha256: newerAcceptedPlan.contentSha256,
    });
    expect(harness({ currentAcceptedPlan: null }).resolver.resolve(ids.request)).toBeNull();

    const mismatchedExecution = {
      ...base.execution,
      executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      result: {
        ...base.execution.result,
        executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    };
    expect(harness({ events: [mismatchedExecution] }).resolver.resolve(ids.request)).toBeNull();
    expect(harness({ attestation: null }).resolver.resolve(ids.request)).toBeNull();

    const driftedCatalog = structuredClone(blenderActionCatalog);
    driftedCatalog.description = `${driftedCatalog.description} drift`;
    const actionCatalogRegistry = createActionCatalogRegistry([driftedCatalog]);
    const driftResolver = createProcedureExecutionFailureReplanRuntimeResolver({
      database: {
        getProcedureLeafReplay: () => base.binding,
        getProcedureLeafReplayAttestation: () => base.attestation,
        listExecutionEventsByTypes: () => [
          {
            sequence: 1,
            id: 'event',
            eventType: 'blender.action-execution.completed',
            payload: { execution: base.execution, sessionFingerprintSha256: 'c'.repeat(64) },
            createdAt: occurredAt,
          },
        ],
      },
      actionCatalogRegistry,
      interactionCatalogRegistry: createInteractionCatalogRegistry(
        [blenderInteractionCatalog],
        actionCatalogRegistry,
      ),
      resolveCurrentAcceptedPlan: () => ({
        id: base.execution.plan.id,
        revision: base.execution.plan.revision,
        contentSha256: base.execution.planContentSha256,
      }),
    });
    expect(driftResolver.resolve(ids.request)).toBeNull();
    expect(driftResolver.listResolvableRequestIds()).toEqual([]);
  });

  it('accepts a proof-backed execution-track proposal only after its durable review chain exists', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-strategy-review-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const reviewed = await reviewStrategyProposal(runtime);
      const decision = acceptedTrackDecision(reviewed.guideProposalId);
      const response = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers: reviewed.leaseHeaders,
        body: JSON.stringify(decision),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ result: 'accepted' });

      const duplicateResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        {
          method: 'POST',
          headers: reviewed.leaseHeaders,
          body: JSON.stringify(decision),
        },
      );
      expect(duplicateResponse.status).toBe(200);
      await expect(duplicateResponse.json()).resolves.toEqual({ result: 'duplicate' });

      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.getGuideProposalDecision(reviewed.guideProposalId, 'blender', ids.instance),
        ).toMatchObject({ decisionId: decision.decisionId, decision: 'accepted' });
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('preflights an accepted reviewed execution track without executing a Blender action', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-preflight-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath);
      const createUrl = `${runtime.baseUrl}/api/v1/companion/execution-track-preflight`;
      const invalidResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify({ ...ready.request, replayBindingContentSha256: 'a'.repeat(64) }),
      });
      expect(invalidResponse.status).toBe(400);
      await expect(invalidResponse.json()).resolves.toMatchObject({
        error: 'invalid_execution_track_preflight_request',
      });
      for (const changedRequest of [
        {
          ...ready.request,
          expectedState: { ...ready.request.expectedState, sequence: 10 },
        },
        { ...ready.request, executionId: randomUUID() },
        { ...ready.request, leafId: 'tutorial.execution-track-preflight.wrong-leaf' },
      ]) {
        const rejected = await fetch(createUrl, {
          method: 'POST',
          headers: ready.headers,
          body: JSON.stringify(changedRequest),
        });
        expect(rejected.status).toBe(409);
      }
      const wrongInstanceId = randomUUID();
      const wrongSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(companionHello(wrongInstanceId)),
      });
      expect(wrongSessionResponse.status).toBe(200);
      const wrongSession = (await wrongSessionResponse.json()) as { leaseId: string };
      const wrongTargetResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
          'x-operatingline-companion-lease': wrongSession.leaseId,
        },
        body: JSON.stringify({
          ...ready.request,
          target: { adapterId: 'blender', instanceId: wrongInstanceId },
        }),
      });
      expect(wrongTargetResponse.status).toBe(409);
      await expect(wrongTargetResponse.json()).resolves.toMatchObject({
        error: 'execution_track_preflight_proposal_target_mismatch',
      });
      const beforeCreate = openOperatingLineDatabase(databasePath);
      try {
        expect(
          beforeCreate.listExecutionEventsByTypes(['blender.execution-track-preflight.queued']),
        ).toHaveLength(0);
      } finally {
        beforeCreate.close();
      }

      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(ready.request),
      });
      expect(createResponse.status, JSON.stringify(await createResponse.clone().json())).toBe(200);
      const queued = (await createResponse.json()) as {
        status: string;
        binding: {
          replayId: string;
          bindingContentSha256: string;
          proposal: { id: string };
          plan: { id: string; revision: number };
          executionId: string;
          leafId: string;
          target: { adapterId: 'blender'; instanceId: string };
        };
      };
      expect(queued).toMatchObject({
        status: 'queued',
        binding: {
          proposal: { id: ready.proposal.proposalId },
          plan: { id: ready.proposal.plan.id, revision: ready.proposal.plan.revision },
          executionId: ready.request.executionId,
          leafId: ready.request.leafId,
        },
      });
      const duplicateResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(ready.request),
      });
      expect(duplicateResponse.status).toBe(200);
      await expect(duplicateResponse.json()).resolves.toEqual(queued);

      const statusUrl = new URL(createUrl);
      statusUrl.searchParams.set('requestId', ready.request.requestId);
      const unauthenticatedStatusResponse = await fetch(statusUrl, {
        headers: { authorization: 'Bearer failure-replan-strategy-token' },
      });
      expect(unauthenticatedStatusResponse.status).toBe(409);
      const queuedStatusResponse = await fetch(statusUrl, { headers: ready.headers });
      expect(queuedStatusResponse.status).toBe(200);
      await expect(queuedStatusResponse.json()).resolves.toMatchObject({ status: 'queued' });

      const pollUrl = new URL(`${createUrl}/poll`);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', ids.instance);
      const pollResponse = await fetch(pollUrl, { headers: ready.headers });
      expect(pollResponse.status, JSON.stringify(await pollResponse.clone().json())).toBe(200);
      const polled = (await pollResponse.json()) as {
        request: {
          deliveryId: string;
          lease: { leaseId: string };
          dispatchedAt: string;
          binding: typeof queued.binding;
        };
      };
      expect(polled.request).toMatchObject({ binding: queued.binding });

      const result = {
        formatVersion: '1.0.0',
        requestId: ready.request.requestId,
        replayId: queued.binding.replayId,
        deliveryId: polled.request.deliveryId,
        bindingContentSha256: queued.binding.bindingContentSha256,
        target: queued.binding.target,
        leaseId: polled.request.lease.leaseId,
        proposalId: queued.binding.proposal.id,
        planId: queued.binding.plan.id,
        planRevision: queued.binding.plan.revision,
        executionId: queued.binding.executionId,
        leafId: queued.binding.leafId,
        status: 'verified_unavailable',
        authorityVerified: true,
        capability: 'preflight_only',
        reasonCode: 'executor_unavailable',
        error: 'No execution-track action executor is installed.',
        occurredAt: new Date().toISOString(),
      } as const;
      const resultResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(result),
      });
      expect(resultResponse.status, JSON.stringify(await resultResponse.clone().json())).toBe(200);
      await expect(resultResponse.json()).resolves.toEqual({ result: 'accepted' });
      const duplicateResultResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(result),
      });
      expect(duplicateResultResponse.status).toBe(200);
      await expect(duplicateResultResponse.json()).resolves.toEqual({ result: 'duplicate' });

      const terminalStatusResponse = await fetch(statusUrl, { headers: ready.headers });
      expect(terminalStatusResponse.status).toBe(200);
      await expect(terminalStatusResponse.json()).resolves.toMatchObject({
        status: 'verified_unavailable',
        result,
      });
      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.listExecutionEventsByTypes([
            'blender.execution-track-preflight.queued',
            'blender.execution-track-preflight.dispatched',
            'blender.execution-track-preflight.completed',
          ]),
        ).toHaveLength(3);
        expect(
          database.listExecutionEventsByTypes(['blender.action-execution.queued']),
        ).toHaveLength(1);
        expect(
          database.listExecutionEventsByTypes(['blender.action-execution.completed']),
        ).toHaveLength(1);
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('authorizes a format 2 execution-track request and persists one canonical queued binding', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-authorize-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath);
      const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
        ...ready.request,
        formatVersion: '2.0.0',
      });
      const beforeExecute = openOperatingLineDatabase(databasePath);
      try {
        expect(beforeExecute.getGuideProposal(request.proposalId)).not.toBeNull();
        expect(beforeExecute.getProcedureExecutionFailureReplanReview(ids.request)).not.toBeNull();
        expect(
          beforeExecute.getGuideProposalDecision(request.proposalId, 'blender', ids.instance),
        ).toMatchObject({ decision: 'accepted' });
        expect(
          beforeExecute.getCompanionStateReport(request.expectedState.reportId),
        ).not.toBeNull();
        expect(
          beforeExecute.getManagedReplayReceipt(
            'companion_state_report',
            request.expectedState.reportId,
          ),
        ).toMatchObject({ authentication: 'negotiated_companion_lease' });
        expect(
          beforeExecute.listExecutionEventsByTypes(['blender.execution-track-execution.queued']),
        ).toHaveLength(0);
      } finally {
        beforeExecute.close();
      }

      const response = await callMcpTool(
        runtime,
        19_001,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(response.result?.isError, response.result?.content?.[0]?.text).not.toBe(true);
      const status = companionExecutionTrackExecutionStatusSchema.parse(
        response.result?.structuredContent,
      );
      const binding = companionExecutionTrackExecutionBindingSchema.parse(status.binding);
      expect(status.status).toBe('queued');
      expect(binding).toMatchObject({
        formatVersion: '2.0.0',
        requestId: request.requestId,
        target: request.target,
        proposalId: request.proposalId,
        plan: request.plan,
        executionId: request.executionId,
        leafId: request.leafId,
        expectedState: request.expectedState,
        preflightBinding: {
          formatVersion: '1.0.0',
          requestId: request.requestId,
          acceptance: {
            decision: { decision: 'accepted' },
            receipt: { authentication: 'negotiated_companion_lease' },
          },
        },
        executor: {
          executorId: 'blender.uv_sphere_menu_proven_managed_commit.v2',
          authorization: 'accepted_replay_next_step',
          automaticReplay: false,
        },
      });
      expect(binding.bindingContentSha256).toBe(hash(withoutKey(binding, 'bindingContentSha256')));

      const afterExecute = openOperatingLineDatabase(databasePath);
      try {
        const queuedEvents = afterExecute.listExecutionEventsByTypes([
          'blender.execution-track-execution.queued',
        ]);
        expect(queuedEvents).toHaveLength(1);
        expect(queuedEvents[0]?.payload).toMatchObject({ status });
      } finally {
        afterExecute.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('executes the accepted later leaf after preserving its completed dependency prefix', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-later-leaf-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(
      databasePath,
      fixture({ proofBackedStrategy: true, laterLeaf: true, actionCatalog }),
    );
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath, 'accepted', {
        completedPrefix: true,
      });
      const firstStep = ready.completedPrefixStep;
      if (firstStep === undefined || ready.report.nativeUndoCheckpoint === undefined) {
        throw new Error('Expected completed prerequisite and its native checkpoint');
      }
      const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
        ...ready.request,
        formatVersion: '2.0.0',
      });
      const targetStep = ready.proposal.plan.steps.find((step) => step.id === request.leafId);
      expect(
        ready.proposal.plan.steps.filter((step) => step.action !== null).map((step) => step.id),
      ).toEqual([firstStep.id, request.leafId]);
      expect(targetStep?.dependsOn).toEqual([firstStep.id]);

      const durableAuthority = openOperatingLineDatabase(databasePath);
      try {
        expect(
          durableAuthority.getProcedureExecutionFailureReplanReview(ids.request),
        ).toMatchObject({ finalStatus: 'accepted' });
        expect(
          durableAuthority.getGuideProposalDecision(request.proposalId, 'blender', ids.instance),
        ).toMatchObject({ decision: 'accepted' });
        expect(
          durableAuthority.getManagedReplayReceipt(
            'companion_state_report',
            request.expectedState.reportId,
          ),
        ).toMatchObject({ authentication: 'negotiated_companion_lease' });
      } finally {
        durableAuthority.close();
      }

      const queuedResponse = await callMcpTool(
        runtime,
        19_010,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(queuedResponse.result?.isError, queuedResponse.result?.content?.[0]?.text).not.toBe(
        true,
      );
      const queued = companionExecutionTrackExecutionStatusSchema.parse(
        queuedResponse.result?.structuredContent,
      );
      const binding = companionExecutionTrackExecutionBindingSchema.parse(queued.binding);
      expect(queued.status).toBe('queued');
      expect(binding.authorizedStartState).toEqual({
        reportContentSha256: hash(ready.report),
        checkpoint: {
          checkpointId: ready.report.nativeUndoCheckpoint.checkpointId,
          previousCheckpointId: ready.report.nativeUndoCheckpoint.previousCheckpointId,
          operation: 'next',
          contentSha256: hash(ready.report.nativeUndoCheckpoint),
        },
        activeStepId: firstStep.id,
        completedStepIds: [firstStep.id],
        receiptStepIds: [firstStep.id],
        successPhase: 'completed',
      });

      const pollUrl = new URL('/api/v1/companion/execution-track-execution', runtime.baseUrl);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', ids.instance);
      const deliveryResponse = await fetch(pollUrl, { headers: ready.headers });
      expect(deliveryResponse.status).toBe(200);
      const delivery = companionExecutionTrackExecutionPollDeliverySchema.parse(
        await deliveryResponse.json(),
      ).request;
      if (delivery === null) throw new Error('Expected later-leaf managed delivery');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

      const timeline = managedExecutionTrackTimeline(delivery.dispatchedAt);
      const baseline = managedExecutionTrackBaseline(
        delivery,
        timeline,
        ready.report.nativeUndoCheckpoint,
      );
      const progressChain = [
        baseline,
        ...managedExecutionTrackProgressTail(delivery, baseline, timeline),
      ];
      expect(progressChain).toHaveLength(6);
      for (const progress of progressChain) {
        const progressResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/execution-track-execution/progress`,
          { method: 'POST', headers: ready.headers, body: JSON.stringify(progress) },
        );
        expect(progressResponse.status, JSON.stringify(await progressResponse.clone().json())).toBe(
          200,
        );
        await expect(progressResponse.json()).resolves.toEqual({ result: 'accepted' });
      }

      const commit = progressChain.at(-1)!;
      const managedStart = managedExecutionTrackManagedStart(delivery, commit, timeline);
      const managedStartResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/managed-start`,
        { method: 'POST', headers: ready.headers, body: JSON.stringify(managedStart) },
      );
      expect(
        managedStartResponse.status,
        JSON.stringify(await managedStartResponse.clone().json()),
      ).toBe(200);
      await expect(managedStartResponse.json()).resolves.toEqual({ result: 'accepted' });

      const successReport = managedExecutionTrackSuccessReport(delivery, baseline, {
        occurredAt: timeline(23),
      });
      expect(successReport.completedStepIds).toEqual([firstStep.id, request.leafId]);
      expect(successReport.nativeUndoCheckpoint?.session.receiptStepIds).toEqual([
        firstStep.id,
        request.leafId,
      ]);
      const reportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(successReport),
      });
      expect(reportResponse.status, JSON.stringify(await reportResponse.clone().json())).toBe(200);
      await expect(reportResponse.json()).resolves.toEqual({ result: 'accepted' });

      const successResult = managedExecutionTrackSuccessResult(
        delivery,
        baseline,
        commit,
        managedStart,
        successReport,
        timeline(24),
      );
      expect(successResult.managedCheckpoint.receiptStepIds).toEqual([
        firstStep.id,
        request.leafId,
      ]);
      const resultResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/result`,
        { method: 'POST', headers: ready.headers, body: JSON.stringify(successResult) },
      );
      expect(resultResponse.status, JSON.stringify(await resultResponse.clone().json())).toBe(200);
      await expect(resultResponse.json()).resolves.toEqual({ result: 'accepted' });

      const terminalResponse = await callMcpTool(
        runtime,
        19_011,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      const terminal = companionExecutionTrackExecutionStatusSchema.parse(
        terminalResponse.result?.structuredContent,
      );
      expect(terminal.status).toBe('succeeded');
      expect(terminal.result).toEqual(successResult);
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('preserves the expected-state receipt authorization failure without queueing', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-authorize-fail-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath);
      const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
        ...ready.request,
        formatVersion: '2.0.0',
        expectedState: { ...ready.request.expectedState, reportId: randomUUID() },
      });
      const response = await callMcpTool(
        runtime,
        19_002,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(response.result?.isError).toBe(true);
      expect(JSON.parse(response.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        error: 'execution_track_execution_expected_receipt_missing',
      });

      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.listExecutionEventsByTypes(['blender.execution-track-execution.queued']),
        ).toHaveLength(0);
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('hard-gates managed success on the exact durable report and preserves terminal replay', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-execution-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const preflight = executionTrackPreflightFixture();
    const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
      ...preflight.request,
      formatVersion: '2.0.0',
    });
    const binding = managedExecutionTrackBinding();
    const documentAuthoritySha256 = createHash('sha256')
      .update('operatingline:blender-menu-control-proof-document-authority:v1\0')
      .update('blender\0')
      .update(`${preflightIds.instance}\0${preflightIds.session}\0${preflightIds.document}`)
      .digest('hex');
    const queuedStatus = companionExecutionTrackExecutionStatusSchema.parse({
      binding,
      status: 'queued',
      updatedAt: binding.requestedAt,
    });
    const seeded = openOperatingLineDatabase(databasePath);
    try {
      seeded.appendEvent({
        id: `blender-execution-track-execution:${request.requestId}:queued`,
        eventType: 'blender.execution-track-execution.queued',
        payload: {
          status: queuedStatus,
          documentAuthoritySha256,
          progressChain: [],
          revision: 1,
        },
        createdAt: queuedStatus.updatedAt,
      });
    } finally {
      seeded.close();
    }
    let runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const hello = {
        ...companionHello(preflightIds.instance),
        sessionId: preflightIds.session,
        documentIncarnationId: preflightIds.document,
      };
      const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(hello),
      });
      expect(sessionResponse.status).toBe(200);
      const session = (await sessionResponse.json()) as { leaseId: string; expiresAt: string };
      const scenarioLease = {
        leaseId: session.leaseId,
        sessionId: preflightIds.session,
        target: binding.target,
        documentIncarnationId: preflightIds.document,
        expiresAt: session.expiresAt,
      };
      const reportSeedDelivery = companionExecutionTrackExecutionPollDeliverySchema.parse({
        request: {
          binding,
          deliveryId: randomUUID(),
          lease: scenarioLease,
          dispatchedAt: new Date().toISOString(),
        },
      }).request;
      if (reportSeedDelivery === null) throw new Error('expected report seed delivery');
      const startReport = managedExecutionTrackStartReport(
        reportSeedDelivery,
        managedExecutionTrackBaseline(
          reportSeedDelivery,
          managedExecutionTrackTimeline(reportSeedDelivery.dispatchedAt),
        ),
      );
      const startReportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
          'x-operatingline-companion-lease': session.leaseId,
        },
        body: JSON.stringify(startReport),
      });
      expect(startReportResponse.status).toBe(200);
      await expect(startReportResponse.json()).resolves.toEqual({ result: 'accepted' });
      const queued = await callMcpTool(
        runtime,
        20_001,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(queued.result?.isError, queued.result?.content?.[0]?.text).not.toBe(true);
      expect(queued.result?.structuredContent).toMatchObject({
        status: 'queued',
        binding: {
          requestId: request.requestId,
          target: request.target,
          proposalId: request.proposalId,
          executionId: request.executionId,
          expectedState: request.expectedState,
          executor: {
            executorId: 'blender.uv_sphere_menu_proven_managed_commit.v2',
            automaticReplay: false,
          },
        },
      });

      const duplicate = await callMcpTool(
        runtime,
        20_002,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(duplicate.result?.structuredContent).toEqual(queued.result?.structuredContent);

      const status = await callMcpTool(
        runtime,
        20_003,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(status.result?.isError).not.toBe(true);
      expect(status.result?.structuredContent).toEqual(queued.result?.structuredContent);

      const pollUrl = new URL('/api/v1/companion/execution-track-execution', runtime.baseUrl);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', preflightIds.instance);
      const leaseHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
        'x-operatingline-companion-lease': session.leaseId,
      };
      const deliveryResponse = await fetch(pollUrl, { headers: leaseHeaders });
      expect(deliveryResponse.status).toBe(200);
      const delivery = companionExecutionTrackExecutionPollDeliverySchema.parse(
        await deliveryResponse.json(),
      ).request;
      if (delivery === null) throw new Error('expected managed delivery');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      const timeline = managedExecutionTrackTimeline(delivery.dispatchedAt);
      const baseline = managedExecutionTrackBaseline(delivery, timeline);
      const progressChain = [
        baseline,
        ...managedExecutionTrackProgressTail(delivery, baseline, timeline),
      ];
      for (const progress of progressChain) {
        const progressResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/execution-track-execution/progress`,
          { method: 'POST', headers: leaseHeaders, body: JSON.stringify(progress) },
        );
        expect(progressResponse.status).toBe(200);
        await expect(progressResponse.json()).resolves.toEqual({ result: 'accepted' });
      }
      const commit = progressChain.at(-1)!;
      const managedStartSubmission = managedExecutionTrackManagedStart(delivery, commit, timeline);
      const managedStartResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/managed-start`,
        {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(managedStartSubmission),
        },
      );
      expect(managedStartResponse.status).toBe(200);
      await expect(managedStartResponse.json()).resolves.toEqual({ result: 'accepted' });
      const inProgress = await callMcpTool(
        runtime,
        20_004,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(inProgress.result?.structuredContent).toMatchObject({
        status: 'managed_action_in_progress',
        deliveryId: delivery.deliveryId,
      });

      const successReport = managedExecutionTrackSuccessReport(delivery, baseline, {
        occurredAt: new Date().toISOString(),
      });
      const missingReportResult = managedExecutionTrackSuccessResult(
        delivery,
        baseline,
        commit,
        managedStartSubmission,
        successReport,
        new Date().toISOString(),
      );
      const missingReportResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/result`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
            'x-operatingline-companion-lease': session.leaseId,
          },
          body: JSON.stringify(missingReportResult),
        },
      );
      expect(missingReportResponse.status).toBe(409);
      await expect(missingReportResponse.json()).resolves.toEqual({
        error: 'execution_track_execution_report_not_current',
        message:
          'Managed result report is not yet the current durable Companion state; retry the same result',
        retryable: true,
      });
      const unchanged = await callMcpTool(
        runtime,
        20_005,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(unchanged.result?.structuredContent).toEqual(inProgress.result?.structuredContent);

      const reportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(successReport),
      });
      expect(reportResponse.status).toBe(200);
      await expect(reportResponse.json()).resolves.toEqual({ result: 'accepted' });

      const acceptedResultResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/result`,
        { method: 'POST', headers: leaseHeaders, body: JSON.stringify(missingReportResult) },
      );
      expect(
        acceptedResultResponse.status,
        JSON.stringify(await acceptedResultResponse.clone().json()),
      ).toBe(200);
      await expect(acceptedResultResponse.json()).resolves.toEqual({ result: 'accepted' });

      const succeeded = await callMcpTool(
        runtime,
        20_006,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(succeeded.result?.structuredContent).toMatchObject({ status: 'succeeded' });

      const newerReport = managedExecutionTrackSuccessReport(delivery, baseline, {
        reportId: randomUUID(),
        sequence: successReport.sequence + 1,
        occurredAt: new Date().toISOString(),
        checkpointId: randomUUID(),
      });
      const newerReportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(newerReport),
      });
      expect(newerReportResponse.status).toBe(200);
      await expect(newerReportResponse.json()).resolves.toEqual({ result: 'accepted' });

      const lostAckResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/result`,
        { method: 'POST', headers: leaseHeaders, body: JSON.stringify(missingReportResult) },
      );
      expect(lostAckResponse.status).toBe(200);
      await expect(lostAckResponse.json()).resolves.toEqual({ result: 'duplicate' });

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-strategy-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      const replayed = await callMcpTool(
        runtime,
        20_007,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(replayed.result?.structuredContent).toEqual(succeeded.result?.structuredContent);
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 20_000);

  it('reconciles a persisted baseline terminal after restart through the replacement-lease POST', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-recovery-post-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const preflight = executionTrackPreflightFixture();
    const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
      ...preflight.request,
      formatVersion: '2.0.0',
    });
    const binding = managedExecutionTrackBinding();
    const documentAuthoritySha256 = createHash('sha256')
      .update('operatingline:blender-menu-control-proof-document-authority:v1\0')
      .update('blender\0')
      .update(`${preflightIds.instance}\0${preflightIds.session}\0${preflightIds.document}`)
      .digest('hex');
    const queuedStatus = companionExecutionTrackExecutionStatusSchema.parse({
      binding,
      status: 'queued',
      updatedAt: binding.requestedAt,
    });
    const seeded = openOperatingLineDatabase(databasePath);
    try {
      seeded.appendEvent({
        id: `blender-execution-track-execution:${request.requestId}:queued`,
        eventType: 'blender.execution-track-execution.queued',
        payload: {
          status: queuedStatus,
          documentAuthoritySha256,
          progressChain: [],
          revision: 1,
        },
        createdAt: queuedStatus.updatedAt,
      });
    } finally {
      seeded.close();
    }

    let runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const hello = {
        ...companionHello(preflightIds.instance),
        sessionId: preflightIds.session,
        documentIncarnationId: preflightIds.document,
      };
      const firstSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(hello),
      });
      expect(firstSessionResponse.status).toBe(200);
      const firstSession = (await firstSessionResponse.json()) as {
        leaseId: string;
        expiresAt: string;
      };
      const firstLease = {
        leaseId: firstSession.leaseId,
        sessionId: preflightIds.session,
        target: binding.target,
        documentIncarnationId: preflightIds.document,
        expiresAt: firstSession.expiresAt,
      };
      const firstHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
        'x-operatingline-companion-lease': firstSession.leaseId,
      };
      const reportSeedDelivery = companionExecutionTrackExecutionPollDeliverySchema.parse({
        request: {
          binding,
          deliveryId: randomUUID(),
          lease: firstLease,
          dispatchedAt: new Date().toISOString(),
        },
      }).request;
      if (reportSeedDelivery === null) throw new Error('expected report seed delivery');
      const startReport = managedExecutionTrackStartReport(
        reportSeedDelivery,
        managedExecutionTrackBaseline(
          reportSeedDelivery,
          managedExecutionTrackTimeline(reportSeedDelivery.dispatchedAt),
        ),
      );
      const startReportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: firstHeaders,
        body: JSON.stringify(startReport),
      });
      expect(startReportResponse.status).toBe(200);
      await expect(startReportResponse.json()).resolves.toEqual({ result: 'accepted' });

      const queued = await callMcpTool(
        runtime,
        20_101,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(queued.result?.isError, queued.result?.content?.[0]?.text).not.toBe(true);
      const pollUrl = new URL('/api/v1/companion/execution-track-execution', runtime.baseUrl);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', preflightIds.instance);
      const deliveryResponse = await fetch(pollUrl, { headers: firstHeaders });
      expect(deliveryResponse.status).toBe(200);
      const delivery = companionExecutionTrackExecutionPollDeliverySchema.parse(
        await deliveryResponse.json(),
      ).request;
      if (delivery === null) throw new Error('expected fail-closed managed delivery');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

      const timeline = managedExecutionTrackTimeline(delivery.dispatchedAt);
      const baseline = managedExecutionTrackBaseline(delivery, timeline);
      const progressResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/progress`,
        { method: 'POST', headers: firstHeaders, body: JSON.stringify(baseline) },
      );
      expect(progressResponse.status).toBe(200);
      await expect(progressResponse.json()).resolves.toEqual({ result: 'accepted' });
      const durableTerminal = companionExecutionTrackExecutionResultSchema.parse({
        formatVersion: '2.0.0',
        requestId: delivery.binding.requestId,
        deliveryId: delivery.deliveryId,
        bindingContentSha256: delivery.binding.bindingContentSha256,
        target: delivery.binding.target,
        leaseId: delivery.lease.leaseId,
        currentLease: delivery.lease,
        proposalId: delivery.binding.proposalId,
        planId: delivery.binding.plan.id,
        planRevision: delivery.binding.plan.revision,
        executionId: delivery.binding.executionId,
        leafId: delivery.binding.leafId,
        occurredAt: timeline(3),
        status: 'failed_no_mutation',
        startCheckpointId: baseline.startCheckpoint.checkpointId,
        baselineAttestationContentSha256: baseline.startAttestation.contentSha256,
        lastProgressContentSha256: baseline.contentSha256,
        error: 'proof/restore executor unavailable; no target mutation was attempted',
      });

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-strategy-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      const replacementSessionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/session`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(hello),
        },
      );
      expect(replacementSessionResponse.status).toBe(200);
      const replacementSession = (await replacementSessionResponse.json()) as {
        leaseId: string;
        expiresAt: string;
      };
      expect(replacementSession.leaseId).not.toBe(firstSession.leaseId);
      const replacementHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
        'x-operatingline-companion-lease': replacementSession.leaseId,
      };
      const recoveryPollUrl = new URL(
        '/api/v1/companion/execution-track-execution/recovery',
        runtime.baseUrl,
      );
      recoveryPollUrl.searchParams.set('adapterId', 'blender');
      recoveryPollUrl.searchParams.set('instanceId', preflightIds.instance);
      const recoveryPollResponse = await fetch(recoveryPollUrl, {
        headers: replacementHeaders,
      });
      expect(recoveryPollResponse.status).toBe(200);
      const recoveryRequest = companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse(
        await recoveryPollResponse.json(),
      ).request;
      if (recoveryRequest === null) throw new Error('expected restart recovery challenge');
      expect(recoveryRequest.replacementLease.leaseId).toBe(replacementSession.leaseId);
      expect(recoveryRequest.acceptedProgress).toEqual(baseline);

      const observedAt = new Date(Date.parse(recoveryRequest.requestedAt) + 1).toISOString();
      const ackOccurredAt = new Date(Date.parse(recoveryRequest.requestedAt) + 2).toISOString();
      const currentStateContent = {
        authentication: 'replacement_lease_recovery_post',
        replacementLeaseId: recoveryRequest.replacementLease.leaseId,
        sessionId: recoveryRequest.replacementLease.sessionId,
        documentIncarnationId: recoveryRequest.replacementLease.documentIncarnationId,
        reportId: baseline.startAttestation.reportId,
        sequence: baseline.startAttestation.sequence,
        sceneFingerprintSha256: baseline.startAttestation.sceneFingerprintSha256,
        ...baseline.startAttestation.identitySnapshot,
        observedAt,
      } as const;
      const currentState = {
        ...currentStateContent,
        contentSha256: hash(currentStateContent),
      };
      const recoveryAck = companionExecutionTrackExecutionRecoveryAckSchema.parse({
        formatVersion: '2.0.0',
        request: recoveryRequest,
        recoveryId: recoveryRequest.recoveryId,
        requestId: recoveryRequest.requestId,
        originalDeliveryId: recoveryRequest.originalDeliveryId,
        bindingContentSha256: recoveryRequest.bindingContentSha256,
        replacementLeaseId: recoveryRequest.replacementLease.leaseId,
        acceptedProgressChainHeadContentSha256:
          recoveryRequest.acceptedProgressChainHeadContentSha256,
        durableReferences: recoveryRequest.durableReferences,
        outcome: 'reconciled',
        evidence: {
          kind: 'baseline_terminal',
          terminalResult: durableTerminal,
          terminalResultContentSha256: hash(durableTerminal),
          progress: baseline,
          currentState,
        },
        retainsTargetLock: false,
        automaticReplay: false,
        occurredAt: ackOccurredAt,
      });
      const missingLeaseResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(recoveryAck),
        },
      );
      expect(missingLeaseResponse.status).toBe(409);
      const originalLeaseResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: firstHeaders,
          body: JSON.stringify(recoveryAck),
        },
      );
      expect(originalLeaseResponse.status).toBe(409);
      const recoveryAckResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(recoveryAck),
        },
      );
      expect(
        recoveryAckResponse.status,
        JSON.stringify(await recoveryAckResponse.clone().json()),
      ).toBe(200);
      await expect(recoveryAckResponse.json()).resolves.toEqual({ result: 'accepted' });

      const duplicateAckResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(recoveryAck),
        },
      );
      expect(duplicateAckResponse.status).toBe(200);
      await expect(duplicateAckResponse.json()).resolves.toEqual({ result: 'duplicate' });
      const terminal = await callMcpTool(
        runtime,
        20_102,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(terminal.result?.structuredContent).toMatchObject({
        status: 'failed_no_mutation',
        result: durableTerminal,
      });

      const rotatedSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(hello),
      });
      expect(rotatedSessionResponse.status).toBe(200);
      const rotatedSession = (await rotatedSessionResponse.json()) as { leaseId: string };
      expect(rotatedSession.leaseId).not.toBe(replacementSession.leaseId);
      const replacedLeaseResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
            'x-operatingline-companion-lease': rotatedSession.leaseId,
          },
          body: JSON.stringify(recoveryAck),
        },
      );
      expect(replacedLeaseResponse.status).toBe(409);

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-strategy-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      const replayed = await callMcpTool(
        runtime,
        20_103,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(replayed.result?.structuredContent).toEqual(terminal.result?.structuredContent);
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it('persists a failed-managed marker before atomically recording its repaired state', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-repair-post-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const preflight = executionTrackPreflightFixture();
    const request = companionExecutionTrackExecutionCreateRequestSchema.parse({
      ...preflight.request,
      formatVersion: '2.0.0',
    });
    const binding = managedExecutionTrackBinding();
    const documentAuthoritySha256 = createHash('sha256')
      .update('operatingline:blender-menu-control-proof-document-authority:v1\0')
      .update('blender\0')
      .update(`${preflightIds.instance}\0${preflightIds.session}\0${preflightIds.document}`)
      .digest('hex');
    const queuedStatus = companionExecutionTrackExecutionStatusSchema.parse({
      binding,
      status: 'queued',
      updatedAt: binding.requestedAt,
    });
    const seeded = openOperatingLineDatabase(databasePath);
    try {
      seeded.appendEvent({
        id: `blender-execution-track-execution:${request.requestId}:queued`,
        eventType: 'blender.execution-track-execution.queued',
        payload: {
          status: queuedStatus,
          documentAuthoritySha256,
          progressChain: [],
          revision: 1,
        },
        createdAt: queuedStatus.updatedAt,
      });
    } finally {
      seeded.close();
    }

    let runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const hello = {
        ...companionHello(preflightIds.instance),
        sessionId: preflightIds.session,
        documentIncarnationId: preflightIds.document,
      };
      const firstSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(hello),
      });
      expect(firstSessionResponse.status).toBe(200);
      const firstSession = (await firstSessionResponse.json()) as {
        leaseId: string;
        expiresAt: string;
      };
      const firstLease = {
        leaseId: firstSession.leaseId,
        sessionId: preflightIds.session,
        target: binding.target,
        documentIncarnationId: preflightIds.document,
        expiresAt: firstSession.expiresAt,
      };
      const firstHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
        'x-operatingline-companion-lease': firstSession.leaseId,
      };
      const reportSeedDelivery = companionExecutionTrackExecutionPollDeliverySchema.parse({
        request: {
          binding,
          deliveryId: randomUUID(),
          lease: firstLease,
          dispatchedAt: new Date().toISOString(),
        },
      }).request;
      if (reportSeedDelivery === null) throw new Error('expected report seed delivery');
      const startReport = managedExecutionTrackStartReport(
        reportSeedDelivery,
        managedExecutionTrackBaseline(
          reportSeedDelivery,
          managedExecutionTrackTimeline(reportSeedDelivery.dispatchedAt),
        ),
      );
      const startReportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: firstHeaders,
        body: JSON.stringify(startReport),
      });
      expect(startReportResponse.status).toBe(200);
      await expect(startReportResponse.json()).resolves.toEqual({ result: 'accepted' });

      const queued = await callMcpTool(
        runtime,
        20_201,
        'operatingline.blender.execution-track.execute',
        request,
      );
      expect(queued.result?.isError, queued.result?.content?.[0]?.text).not.toBe(true);
      const pollUrl = new URL('/api/v1/companion/execution-track-execution', runtime.baseUrl);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', preflightIds.instance);
      const deliveryResponse = await fetch(pollUrl, { headers: firstHeaders });
      expect(deliveryResponse.status).toBe(200);
      const delivery = companionExecutionTrackExecutionPollDeliverySchema.parse(
        await deliveryResponse.json(),
      ).request;
      if (delivery === null) throw new Error('expected failed-managed delivery');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

      const timeline = managedExecutionTrackTimeline(delivery.dispatchedAt);
      const baseline = managedExecutionTrackBaseline(delivery, timeline);
      const progressChain = [
        baseline,
        ...managedExecutionTrackProgressTail(delivery, baseline, timeline),
      ];
      for (const progress of progressChain) {
        const progressResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/execution-track-execution/progress`,
          { method: 'POST', headers: firstHeaders, body: JSON.stringify(progress) },
        );
        expect(progressResponse.status).toBe(200);
        await expect(progressResponse.json()).resolves.toEqual({ result: 'accepted' });
      }
      const commit = progressChain.at(-1)!;
      const managedStart = managedExecutionTrackManagedStart(delivery, commit, timeline);
      const managedStartResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/managed-start`,
        { method: 'POST', headers: firstHeaders, body: JSON.stringify(managedStart) },
      );
      expect(managedStartResponse.status).toBe(200);
      await expect(managedStartResponse.json()).resolves.toEqual({ result: 'accepted' });

      const failureReport = managedExecutionTrackFailureReport(delivery, baseline, {
        occurredAt: timeline(23),
      });
      const failureReportResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: firstHeaders,
        body: JSON.stringify(failureReport),
      });
      expect(failureReportResponse.status).toBe(200);
      await expect(failureReportResponse.json()).resolves.toEqual({ result: 'accepted' });
      const failedResult = managedExecutionTrackFailureResult(
        delivery,
        baseline,
        commit,
        managedStart,
        failureReport,
        timeline(24),
      );
      const failedResultResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/result`,
        { method: 'POST', headers: firstHeaders, body: JSON.stringify(failedResult) },
      );
      expect(
        failedResultResponse.status,
        JSON.stringify(await failedResultResponse.clone().json()),
      ).toBe(200);
      await expect(failedResultResponse.json()).resolves.toEqual({ result: 'accepted' });
      const failedMarker = managedExecutionTrackFailedTerminalMarker(failedResult);

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-strategy-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      const replacementSessionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/session`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(hello),
        },
      );
      expect(replacementSessionResponse.status).toBe(200);
      const replacementSession = (await replacementSessionResponse.json()) as {
        leaseId: string;
      };
      const replacementHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
        'x-operatingline-companion-lease': replacementSession.leaseId,
      };
      const recoveryPollUrl = new URL(
        '/api/v1/companion/execution-track-execution/recovery',
        runtime.baseUrl,
      );
      recoveryPollUrl.searchParams.set('adapterId', 'blender');
      recoveryPollUrl.searchParams.set('instanceId', preflightIds.instance);
      const markerPollResponse = await fetch(recoveryPollUrl, { headers: replacementHeaders });
      expect(markerPollResponse.status).toBe(200);
      const markerRequest = companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse(
        await markerPollResponse.json(),
      ).request;
      if (markerRequest === null) throw new Error('expected terminal marker challenge');
      expect(markerRequest.source).toBe('companion_reported');
      expect(markerRequest.durableReferences.terminalMarkerContentSha256).toBeNull();
      const markerObservedAt = new Date(Date.parse(markerRequest.requestedAt) + 1).toISOString();
      const markerStateContent = {
        authentication: 'replacement_lease_recovery_post',
        replacementLeaseId: markerRequest.replacementLease.leaseId,
        sessionId: markerRequest.replacementLease.sessionId,
        documentIncarnationId: markerRequest.replacementLease.documentIncarnationId,
        reportId: failedResult.managedReport.reportId,
        sequence: failedResult.managedReport.sequence,
        sceneFingerprintSha256: failedMarker.sceneFingerprintSha256,
        viewLayerIdentitySha256: failedMarker.viewLayerIdentitySha256,
        objectIdentitySha256: failedMarker.objectIdentitySha256,
        meshIdentitySha256: failedMarker.meshIdentitySha256,
        collectionIdentitySha256: failedMarker.collectionIdentitySha256,
        sessionUidDomainSha256: failedMarker.sessionUidDomainSha256,
        pointerDomainSha256: failedMarker.pointerDomainSha256,
        linksAndSelectionSha256: failedMarker.linksAndSelectionSha256,
        observedAt: markerObservedAt,
      } as const;
      const markerAck = companionExecutionTrackExecutionRecoveryAckSchema.parse({
        formatVersion: '2.0.0',
        request: markerRequest,
        recoveryId: markerRequest.recoveryId,
        requestId: markerRequest.requestId,
        originalDeliveryId: markerRequest.originalDeliveryId,
        bindingContentSha256: markerRequest.bindingContentSha256,
        replacementLeaseId: markerRequest.replacementLease.leaseId,
        acceptedProgressChainHeadContentSha256:
          markerRequest.acceptedProgressChainHeadContentSha256,
        durableReferences: markerRequest.durableReferences,
        outcome: 'reconciled',
        evidence: {
          kind: 'persisted_managed_terminal',
          terminalResult: failedResult,
          terminalResultContentSha256: hash(failedResult),
          terminalMarker: failedMarker,
          currentState: { ...markerStateContent, contentSha256: hash(markerStateContent) },
        },
        retainsTargetLock: true,
        automaticReplay: false,
        occurredAt: new Date(Date.parse(markerRequest.requestedAt) + 2).toISOString(),
      });
      const markerAckResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(markerAck),
        },
      );
      expect(markerAckResponse.status).toBe(200);
      await expect(markerAckResponse.json()).resolves.toEqual({ result: 'accepted' });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));

      const repairPollResponse = await fetch(recoveryPollUrl, { headers: replacementHeaders });
      expect(repairPollResponse.status).toBe(200);
      const repairRequest = companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse(
        await repairPollResponse.json(),
      ).request;
      if (repairRequest === null) throw new Error('expected managed repair challenge');
      expect(repairRequest.source).toBe('failed_managed_repair');
      expect(repairRequest.durableReferences).toMatchObject({
        terminalResultContentSha256: hash(failedResult),
        terminalMarkerContentSha256: failedMarker.contentSha256,
      });
      const repairRequestedAt = Date.parse(repairRequest.requestedAt);
      const conflictingRecoveredReport = managedExecutionTrackRecoveredReport(
        delivery,
        failedResult,
        {
          reportId: failureReport.reportId,
          checkpointId: randomUUID(),
          checkpointAt: new Date(repairRequestedAt).toISOString(),
          observationAt: new Date(repairRequestedAt + 1).toISOString(),
          reportAt: new Date(repairRequestedAt + 2).toISOString(),
        },
      );
      const conflictingRepairAck = managedExecutionTrackRepairAck(
        repairRequest,
        failedResult,
        failedMarker,
        conflictingRecoveredReport,
        new Date(repairRequestedAt + 4).toISOString(),
      );
      const conflictingRepairResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(conflictingRepairAck),
        },
      );
      expect(conflictingRepairResponse.status).toBe(409);
      await expect(conflictingRepairResponse.json()).resolves.toMatchObject({
        error: 'execution_track_execution_repair_report_not_current',
      });
      const stillLocked = await callMcpTool(
        runtime,
        20_202,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(stillLocked.result?.structuredContent).toMatchObject({
        status: 'failed_managed',
        result: failedResult,
      });

      const recoveredReport = managedExecutionTrackRecoveredReport(delivery, failedResult, {
        checkpointAt: new Date(repairRequestedAt).toISOString(),
        observationAt: new Date(repairRequestedAt + 1).toISOString(),
        reportAt: new Date(repairRequestedAt + 2).toISOString(),
      });
      const repairAck = managedExecutionTrackRepairAck(
        repairRequest,
        failedResult,
        failedMarker,
        recoveredReport,
        new Date(repairRequestedAt + 4).toISOString(),
      );
      const repairAckResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(repairAck),
        },
      );
      expect(repairAckResponse.status, JSON.stringify(await repairAckResponse.clone().json())).toBe(
        200,
      );
      await expect(repairAckResponse.json()).resolves.toEqual({ result: 'accepted' });
      const repaired = await callMcpTool(
        runtime,
        20_203,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(repaired.result?.structuredContent).toMatchObject({
        status: 'failed_managed_repaired',
        result: failedResult,
      });

      const durable = openOperatingLineDatabase(databasePath);
      try {
        expect(durable.getCompanionStateReport(recoveredReport.reportId)).toEqual(recoveredReport);
        expect(
          durable.getManagedReplayReceipt('companion_state_report', recoveredReport.reportId),
        ).toMatchObject({
          authentication: 'negotiated_companion_lease',
          adapterId: binding.target.adapterId,
          instanceId: binding.target.instanceId,
          sessionFingerprintSha256: createHash('sha256')
            .update(replacementSession.leaseId)
            .digest('hex'),
        });
      } finally {
        durable.close();
      }
      const duplicateRepairResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: replacementHeaders,
          body: JSON.stringify(repairAck),
        },
      );
      expect(duplicateRepairResponse.status).toBe(200);
      await expect(duplicateRepairResponse.json()).resolves.toEqual({ result: 'duplicate' });

      const rotatedRepairSessionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/session`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(hello),
        },
      );
      expect(rotatedRepairSessionResponse.status).toBe(200);
      const rotatedRepairSession = (await rotatedRepairSessionResponse.json()) as {
        leaseId: string;
      };
      expect(rotatedRepairSession.leaseId).not.toBe(replacementSession.leaseId);
      const rotatedDuplicateRepairResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
            'x-operatingline-companion-lease': rotatedRepairSession.leaseId,
          },
          body: JSON.stringify(repairAck),
        },
      );
      expect(rotatedDuplicateRepairResponse.status).toBe(200);
      await expect(rotatedDuplicateRepairResponse.json()).resolves.toEqual({
        result: 'duplicate',
      });

      const differentDocumentResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...hello, documentIncarnationId: randomUUID() }),
      });
      expect(differentDocumentResponse.status).toBe(200);
      const differentDocument = (await differentDocumentResponse.json()) as { leaseId: string };
      const wrongDocumentDuplicateResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-execution/recovery`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer failure-replan-strategy-token',
            'content-type': 'application/json',
            'x-operatingline-companion-lease': differentDocument.leaseId,
          },
          body: JSON.stringify(repairAck),
        },
      );
      expect(wrongDocumentDuplicateResponse.status).toBe(409);

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-strategy-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      const replayed = await callMcpTool(
        runtime,
        20_204,
        'operatingline.blender.execution-track.status',
        { requestId: request.requestId },
      );
      expect(replayed.result?.structuredContent).toEqual(repaired.result?.structuredContent);
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not dispatch a queued binding after the target document rotates', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-document-drift-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath);
      const createUrl = `${runtime.baseUrl}/api/v1/companion/execution-track-preflight`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(ready.request),
      });
      expect(createResponse.status).toBe(200);

      const rotatedResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...ready.sessionHello,
          documentIncarnationId: randomUUID(),
        }),
      });
      expect(rotatedResponse.status).toBe(200);
      const rotated = (await rotatedResponse.json()) as { leaseId: string };
      const pollUrl = new URL(`${createUrl}/poll`);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', ids.instance);
      const pollResponse = await fetch(pollUrl, {
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'x-operatingline-companion-lease': rotated.leaseId,
        },
      });
      expect(pollResponse.status).toBe(409);
      await expect(pollResponse.json()).resolves.toMatchObject({
        error: 'execution_track_preflight_document_session_not_current',
      });
      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.listExecutionEventsByTypes(['blender.execution-track-preflight.dispatched']),
        ).toHaveLength(0);
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('revalidates verified authority after dispatch but still records a local rejection', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-result-drift-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath);
      const createUrl = `${runtime.baseUrl}/api/v1/companion/execution-track-preflight`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(ready.request),
      });
      const queued = (await createResponse.json()) as {
        binding: {
          replayId: string;
          bindingContentSha256: string;
          target: { adapterId: 'blender'; instanceId: string };
          proposal: { id: string };
          plan: { id: string; revision: number };
          executionId: string;
          leafId: string;
        };
      };
      const pollUrl = new URL(`${createUrl}/poll`);
      pollUrl.searchParams.set('adapterId', 'blender');
      pollUrl.searchParams.set('instanceId', ids.instance);
      const pollResponse = await fetch(pollUrl, { headers: ready.headers });
      const delivery = (await pollResponse.json()) as {
        request: { deliveryId: string; lease: { leaseId: string } };
      };

      const changedExecutionId = randomUUID();
      const changedAt = new Date().toISOString();
      const changedReport = {
        ...ready.report,
        reportId: randomUUID(),
        sequence: ready.report.sequence + 1,
        executionId: changedExecutionId,
        occurredAt: changedAt,
        nativeUndoCheckpoint: {
          ...ready.report.nativeUndoCheckpoint,
          checkpointId: randomUUID(),
          committedAt: changedAt,
          session: {
            ...ready.report.nativeUndoCheckpoint.session,
            executionId: changedExecutionId,
          },
        },
      };
      const stateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(changedReport),
      });
      expect(stateResponse.status).toBe(200);

      const identity = {
        formatVersion: '1.0.0',
        requestId: ready.request.requestId,
        replayId: queued.binding.replayId,
        deliveryId: delivery.request.deliveryId,
        bindingContentSha256: queued.binding.bindingContentSha256,
        target: queued.binding.target,
        leaseId: delivery.request.lease.leaseId,
        proposalId: queued.binding.proposal.id,
        planId: queued.binding.plan.id,
        planRevision: queued.binding.plan.revision,
        executionId: queued.binding.executionId,
        leafId: queued.binding.leafId,
      } as const;
      const verifiedResult = {
        ...identity,
        status: 'verified_unavailable',
        authorityVerified: true,
        capability: 'preflight_only',
        reasonCode: 'executor_unavailable',
        error: 'No execution-track action executor is installed.',
        occurredAt: new Date().toISOString(),
      } as const;
      const wrongIdentityResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify({ ...verifiedResult, deliveryId: randomUUID() }),
      });
      expect(wrongIdentityResponse.status).toBe(409);
      await expect(wrongIdentityResponse.json()).resolves.not.toMatchObject({
        error: 'execution_track_preflight_verified_authority_changed',
      });
      const wrongLeaseResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: {
          ...ready.headers,
          'x-operatingline-companion-lease': randomUUID(),
        },
        body: JSON.stringify(verifiedResult),
      });
      expect(wrongLeaseResponse.status).toBe(409);
      await expect(wrongLeaseResponse.json()).resolves.not.toMatchObject({
        error: 'execution_track_preflight_verified_authority_changed',
      });
      const verifiedResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(verifiedResult),
      });
      expect(verifiedResponse.status).toBe(409);
      await expect(verifiedResponse.json()).resolves.toMatchObject({
        error: 'execution_track_preflight_verified_authority_changed',
        message: expect.stringContaining('execution_track_preflight_state_changed'),
      });
      const inspectedBeforeReject = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspectedBeforeReject.listExecutionEventsByTypes([
            'blender.execution-track-preflight.completed',
          ]),
        ).toHaveLength(0);
      } finally {
        inspectedBeforeReject.close();
      }

      const rejectedResponse = await fetch(`${createUrl}/result`, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify({
          ...identity,
          status: 'rejected',
          authorityVerified: false,
          capability: 'preflight_only',
          reasonCode: 'authority_invalid',
          error: 'Current execution-track authority changed after dispatch.',
          occurredAt: new Date().toISOString(),
        }),
      });
      expect(rejectedResponse.status, JSON.stringify(await rejectedResponse.clone().json())).toBe(
        200,
      );
      await expect(rejectedResponse.json()).resolves.toEqual({ result: 'accepted' });
      const inspectedAfterReject = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspectedAfterReject.listExecutionEventsByTypes([
            'blender.execution-track-preflight.completed',
          ]),
        ).toHaveLength(1);
      } finally {
        inspectedAfterReject.close();
      }
      const nextRequest = {
        ...ready.request,
        requestId: randomUUID(),
        executionId: changedExecutionId,
        expectedState: {
          reportId: changedReport.reportId,
          sequence: changedReport.sequence,
        },
      };
      const nextResponse = await fetch(createUrl, {
        method: 'POST',
        headers: ready.headers,
        body: JSON.stringify(nextRequest),
      });
      expect(nextResponse.status, JSON.stringify(await nextResponse.clone().json())).toBe(200);
      await expect(nextResponse.json()).resolves.toMatchObject({ status: 'queued' });
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a reviewed track whose Guide proposal decision was rejected without queueing', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-track-unaccepted-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const ready = await acceptTrackAndReportReadyState(runtime, databasePath, 'rejected');
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/companion/execution-track-preflight`,
        {
          method: 'POST',
          headers: ready.headers,
          body: JSON.stringify(ready.request),
        },
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: 'execution_track_preflight_acceptance_missing',
      });
      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.listExecutionEventsByTypes(['blender.execution-track-preflight.queued']),
        ).toHaveLength(0);
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('requires the exact current Guide 1.6 Companion lease before writing an execution-track decision', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-strategy-lease-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const reviewed = await reviewStrategyProposal(runtime);
      const authorizationHeaders = {
        authorization: 'Bearer failure-replan-strategy-token',
        'content-type': 'application/json',
      };

      const noLeaseDecision = acceptedTrackDecision(reviewed.guideProposalId);
      const noLeaseResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers: authorizationHeaders,
        body: JSON.stringify(noLeaseDecision),
      });
      expect(noLeaseResponse.status).toBe(409);
      await expect(noLeaseResponse.json()).resolves.toMatchObject({
        error: 'companion_lease_required',
      });

      const wrongInstanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const wrongSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers: authorizationHeaders,
        body: JSON.stringify(companionHello(wrongInstanceId)),
      });
      expect(wrongSessionResponse.status).toBe(200);
      const wrongSession = (await wrongSessionResponse.json()) as { leaseId: string };
      const wrongInstanceDecision = {
        ...acceptedTrackDecision(reviewed.guideProposalId),
        instanceId: wrongInstanceId,
      };
      const wrongInstanceResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        {
          method: 'POST',
          headers: {
            ...authorizationHeaders,
            'x-operatingline-companion-lease': wrongSession.leaseId,
          },
          body: JSON.stringify(wrongInstanceDecision),
        },
      );
      expect(wrongInstanceResponse.status).toBe(409);
      await expect(wrongInstanceResponse.json()).resolves.toMatchObject({
        error: 'companion_session_identity_mismatch',
      });

      const wrongProtocolDecision = {
        ...acceptedTrackDecision(reviewed.guideProposalId),
        protocolVersion: '1.5.0' as const,
      };
      const wrongProtocolResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        {
          method: 'POST',
          headers: reviewed.leaseHeaders,
          body: JSON.stringify(wrongProtocolDecision),
        },
      );
      expect(wrongProtocolResponse.status).toBe(409);
      await expect(wrongProtocolResponse.json()).resolves.toMatchObject({
        error: 'companion_session_identity_mismatch',
      });

      const database = openOperatingLineDatabase(databasePath);
      try {
        expect(
          database.getGuideProposalDecision(reviewed.guideProposalId, 'blender', ids.instance),
        ).toBeNull();
        expect(
          database.getGuideProposalDecision(reviewed.guideProposalId, 'blender', wrongInstanceId),
        ).toBeNull();
        for (const decisionId of [
          noLeaseDecision.decisionId,
          wrongInstanceDecision.decisionId,
          wrongProtocolDecision.decisionId,
        ]) {
          expect(
            database.getManagedReplayReceipt('guide_proposal_decision', decisionId),
          ).toBeNull();
        }
        expect(
          database
            .listExecutionEventsByTypes(['guide.proposal.decided'])
            .filter((event) =>
              [
                noLeaseDecision.decisionId,
                wrongInstanceDecision.decisionId,
                wrongProtocolDecision.decisionId,
              ].includes((event.payload as { decisionId?: string } | null)?.decisionId ?? ''),
            ),
        ).toHaveLength(0);
      } finally {
        database.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('requires a Companion lease before persisting rejection of an execution-track proposal', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-strategy-reject-lease-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const runtime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const reviewed = await reviewStrategyProposal(runtime);
      const decision = {
        ...acceptedTrackDecision(reviewed.guideProposalId),
        decision: 'rejected' as const,
      };
      const inspectedBefore = openOperatingLineDatabase(databasePath);
      const decisionEventsBefore = inspectedBefore.listExecutionEventsByTypes([
        'guide.proposal.decided',
      ]);
      inspectedBefore.close();

      const response = await fetch(`${runtime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer failure-replan-strategy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(decision),
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: 'companion_lease_required' });

      const inspectedAfter = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspectedAfter.getGuideProposalDecision(
            reviewed.guideProposalId,
            'blender',
            ids.instance,
          ),
        ).toBeNull();
        expect(
          inspectedAfter.getManagedReplayReceipt('guide_proposal_decision', decision.decisionId),
        ).toBeNull();
        expect(inspectedAfter.listExecutionEventsByTypes(['guide.proposal.decided'])).toEqual(
          decisionEventsBefore,
        );
      } finally {
        inspectedAfter.close();
      }
    } finally {
      await runtime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a reviewed execution-track proposal when the current Companion Plan has drifted', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-strategy-plan-drift-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    const base = fixture({ proofBackedStrategy: true, actionCatalog });
    seedFinalizedFailure(databasePath, base);
    const firstRuntime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    const reviewed = await reviewStrategyProposal(firstRuntime);
    await firstRuntime.stop();

    const database = openOperatingLineDatabase(databasePath);
    try {
      expect(
        database.recordCompanionState(
          {
            ...base.attestation.failureReport,
            reportId: randomUUID(),
            sequence: base.attestation.failureReport.sequence + 1,
            plan: {
              id: base.attestation.failureReport.plan.id,
              revision: base.attestation.failureReport.plan.revision + 1,
            },
            planContentSha256: 'f'.repeat(64),
            occurredAt: new Date().toISOString(),
          },
          { sessionFingerprintSha256: 'd'.repeat(64) },
        ),
      ).toBe('accepted');
    } finally {
      database.close();
    }

    const secondRuntime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const headers = await companionLeaseHeaders(secondRuntime);
      const decision = acceptedTrackDecision(reviewed.guideProposalId);
      const response = await fetch(`${secondRuntime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers,
        body: JSON.stringify(decision),
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: 'execution_track_authority_rejected',
        message: 'Execution-track proposal base Plan is no longer current',
      });

      const inspected = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspected.getGuideProposalDecision(reviewed.guideProposalId, 'blender', ids.instance),
        ).toBeNull();
      } finally {
        inspected.close();
      }
    } finally {
      await secondRuntime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a reviewed execution-track proposal when same-version ActionCatalog content drifts', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-strategy-catalog-drift-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const actionCatalog = strategyActionCatalog();
    seedFinalizedFailure(databasePath, fixture({ proofBackedStrategy: true, actionCatalog }));
    const firstRuntime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [actionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    const reviewed = await reviewStrategyProposal(firstRuntime);
    await firstRuntime.stop();

    expect(blenderActionCatalog.catalogVersion).toBe(actionCatalog.catalogVersion);
    expect(hash(blenderActionCatalog)).not.toBe(hash(actionCatalog));
    const secondRuntime = await startRuntime({
      databasePath,
      accessToken: 'failure-replan-strategy-token',
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const headers = await companionLeaseHeaders(secondRuntime);
      const decision = acceptedTrackDecision(reviewed.guideProposalId);
      const response = await fetch(`${secondRuntime.baseUrl}/api/v1/companion/proposal-decision`, {
        method: 'POST',
        headers,
        body: JSON.stringify(decision),
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: 'execution_track_authority_rejected',
        message: 'Execution-track proposal no longer matches its installed action catalog',
      });

      const inspected = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspected.getGuideProposalDecision(reviewed.guideProposalId, 'blender', ids.instance),
        ).toBeNull();
      } finally {
        inspected.close();
      }
    } finally {
      await secondRuntime.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('backfills a finalized safe failure exactly once across runtime restarts', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-failure-replan-'));
    const databasePath = join(temporaryDirectory, 'runtime.sqlite');
    const base = fixture();
    const sessionFingerprintSha256 = 'c'.repeat(64);
    const terminal = companionActionExecutionStatusSchema.parse(base.execution);
    const immutable = {
      formatVersion: terminal.formatVersion,
      requestId: terminal.requestId,
      replayId: terminal.replayId,
      target: terminal.target,
      proposalId: terminal.proposalId,
      plan: terminal.plan,
      planContentSha256: terminal.planContentSha256,
      executionId: terminal.executionId,
      expectedState: terminal.expectedState,
      step: terminal.step,
      requestedAt: terminal.requestedAt,
    } as const;
    const queued = companionActionExecutionStatusSchema.parse({
      ...immutable,
      status: 'queued',
      updatedAt: terminal.requestedAt,
    });
    const dispatched = companionActionExecutionStatusSchema.parse({
      ...immutable,
      deliveryId: terminal.deliveryId,
      dispatchedAt: terminal.dispatchedAt,
      status: 'dispatched',
      updatedAt: terminal.dispatchedAt,
    });
    const database = openOperatingLineDatabase(databasePath);
    try {
      expect(
        database.recordProcedureLeafReplayProposal(base.binding.proposal, {
          replayId: base.binding.replayId,
          proposalId: base.binding.proposal.proposalId,
          treeId: base.binding.materialization.tree.id,
          treeRevision: base.binding.materialization.tree.revision,
          leafId: base.binding.leafId,
          adapterId: base.binding.materialization.tree.adapterId,
          instanceId: base.binding.targetInstanceId,
          bindingContentSha256: base.binding.integrity.contentSha256,
          payload: base.binding,
          createdAt: base.binding.createdAt,
        }),
      ).toBe('accepted');
      expect(
        database.recordCompanionState(base.attestation.failureReport, {
          sessionFingerprintSha256,
        }),
      ).toBe('accepted');
      expect(
        database.recordProcedureLeafReplayAttestation({
          attestationId: base.attestation.attestationId,
          replayId: base.attestation.replayId,
          reportId: base.attestation.failureReport.reportId,
          evidenceReportIds: [base.attestation.failureReport.reportId],
          executionId: base.attestation.execution.execution.id,
          contentSha256: base.attestation.integrity.contentSha256,
          payload: base.attestation,
          attestedAt: base.attestation.attestedAt,
        }),
      ).toBe('accepted');
      for (const [eventType, execution] of [
        ['blender.action-execution.queued', queued],
        ['blender.action-execution.dispatched', dispatched],
        ['blender.action-execution.completed', terminal],
      ] as const) {
        database.appendEvent({
          id: `backfill:${terminal.requestId}:${execution.status}`,
          eventType,
          payload: { execution, sessionFingerprintSha256 },
          createdAt: execution.updatedAt,
        });
      }
      expect(
        database.listExecutionEventsByTypes(['procedure.execution-failure-replan.completed']),
      ).toHaveLength(0);
    } finally {
      database.close();
    }

    const readBackfill = async () => {
      const runtime = await startRuntime({
        databasePath,
        accessToken: 'failure-replan-backfill-token',
        actionCatalogs: [blenderActionCatalog],
        interactionCatalogs: [blenderInteractionCatalog],
      });
      try {
        const url = new URL('/api/v1/procedure/failure-replan', runtime.baseUrl);
        url.searchParams.set('requestId', ids.request);
        const response = await fetch(url, {
          headers: { authorization: 'Bearer failure-replan-backfill-token' },
        });
        expect(response.status).toBe(200);
        return await response.json();
      } finally {
        await runtime.stop();
      }
    };

    try {
      const first = await readBackfill();
      expect(first).toMatchObject({ kind: 'parameter_repair_proposed' });
      await expect(readBackfill()).resolves.toEqual(first);
      const inspected = openOperatingLineDatabase(databasePath);
      try {
        expect(
          inspected.listExecutionEventsByTypes(['procedure.execution-failure-replan.completed']),
        ).toHaveLength(1);
      } finally {
        inspected.close();
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
