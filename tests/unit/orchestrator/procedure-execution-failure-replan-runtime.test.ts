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
} as const;
const requestedAt = '2026-08-21T09:59:58Z';
const dispatchedAt = '2026-08-21T09:59:59Z';
const occurredAt = '2026-08-21T10:00:00Z';
const attestedAt = '2026-08-21T10:00:01Z';

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
  options: { readonly proofBackedStrategy?: boolean } = {},
): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    const action = node['action'] as
      { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (action?.name === 'blender.mesh.create_uv_sphere' && action.arguments !== undefined) {
      if (options.proofBackedStrategy === true) {
        action.arguments = {
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
    readonly actionCatalog?: typeof blenderActionCatalog;
  } = {},
) {
  const tree = candidate(options);
  const actionCatalog = options.actionCatalog ?? blenderActionCatalog;
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
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
  const binding = buildProcedureLeafReplayBinding({
    request,
    materialization,
    proposal,
    planContentSha256,
    recipeId: materialization.coverage[0]!.recipeId,
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
      failureReportReceipt: { sequence: 3, receivedAt: occurredAt },
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
    activeStepId: null,
    completedStepIds: [],
    transition: 'walkthrough_started',
    stepId: null,
    observations: [],
    observationGate: null,
    artifactAttestation: null,
    nativeUndoCheckpoint: {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: randomUUID(),
      previousCheckpointId: null,
      operation: 'start',
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
        activeStepId: null,
        completedStepIds: [],
        receiptStepIds: [],
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
