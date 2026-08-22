import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  companionActionExecutionStatusSchema,
  compileProcedureTreeToGuidePlan,
  computeProcedureLeafReplayFailureRecoveryAttestationContentSha256,
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
import { createProcedureExecutionFailureReplanRuntimeResolver } from '../../../services/orchestrator/src/procedure-execution-failure-replan-runtime.js';
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

function candidate(): ProcedureAuthoringCandidateTree {
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

function fixture() {
  const tree = candidate();
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
        actionCatalog: withoutKey(blenderActionCatalog, 'adapterId'),
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
    blenderActionCatalog,
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
    catalogVersion: blenderActionCatalog.catalogVersion,
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
  const actionCatalogRegistry = createActionCatalogRegistry([blenderActionCatalog]);
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
