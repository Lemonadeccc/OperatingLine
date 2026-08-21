import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  companionStateReportSchema,
  compileProcedureTreeToGuidePlan,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProcedureMenuControlProofProposalRecordContentSha256,
  guideProposalDecisionSchema,
  guideProposalSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureMenuControlProofBindingSchema,
  procedureMenuControlProofProposalRecordSchema,
  procedureMenuControlProofProposalRequestSchema,
  uvSphereMenuControlProofOperationIds,
  type ActionCatalog,
  type CompanionStateReport,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringMaterializationResult,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import {
  buildProcedureMenuControlProofBinding,
  buildProcedureMenuControlProofProposalRecord,
  prepareProcedureMenuControlProofProposal,
  ProcedureMenuControlProofError,
} from '../../../services/orchestrator/src/procedure-menu-control-proof.js';

const ids = {
  replay: '11111111-1111-4111-8111-111111111111',
  instance: '22222222-2222-4222-8222-222222222222',
  record: '33333333-3333-4333-8333-333333333333',
  proposal: '44444444-4444-4444-8444-444444444444',
  decision: '55555555-5555-4555-8555-555555555555',
  execution: '66666666-6666-4666-8666-666666666666',
  report: '77777777-7777-4777-8777-777777777777',
  binding: '88888888-8888-4888-8888-888888888888',
  proof: '99999999-9999-4999-8999-999999999999',
  request: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function candidate(): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = 'tutorial.uv-sphere-proof';
  tree['revision'] = 1;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('expected fixture leaf');
  leaf['id'] = 'tutorial.uv-sphere-proof';
  leaf['parentId'] = null;
  leaf['order'] = 1;
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_uv_sphere',
    arguments: {
      resourceId: 'proof.uv_sphere.eye',
      objectName: 'OperatingLine.TutorialEye',
      radius: 1.5,
      location: [1.25, -2, 0.75],
    },
  };
  leaf['menuTracks'] = [
    {
      id: 'tutorial.uv-sphere-proof.menu.pending',
      availability: 'unavailable',
      title: 'Menu grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'menu',
    },
  ];
  leaf['shortcutTracks'] = [
    {
      id: 'tutorial.uv-sphere-proof.shortcut.pending',
      availability: 'unavailable',
      title: 'Shortcut grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'shortcut',
    },
  ];
  leaf['mcpTracks'] = [
    {
      id: 'tutorial.uv-sphere-proof.mcp.pending',
      availability: 'unavailable',
      title: 'MCP grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'mcp',
    },
  ];
  tree['rootNodeId'] = leaf['id'];
  tree['nodes'] = [leaf];
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function fixture() {
  const tree = candidate();
  const packet = buildProcedureAuthoringPromptPacket(
    {
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      goal: 'Create the exact tutorial eye UV sphere using Blender menu controls.',
      treeId: tree.id,
      revision: tree.revision,
      locale: 'en',
    },
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const grounded = materializeProcedureAuthoringCandidate(
    tree,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const { interactionCatalogContentSha256, ...materialized } = grounded;
  const materialization = procedureAuthoringMaterializationResultSchema.parse({
    ...materialized,
    packetContentSha256: packet.integrity.contentSha256,
    catalogBinding: {
      adapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      interactionCatalogContentSha256,
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
      plan: compileProcedureTreeToGuidePlan(grounded.tree),
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  });
  const request = procedureMenuControlProofProposalRequestSchema.parse({
    formatVersion: '1.0.0',
    replayId: ids.replay,
    targetInstanceId: ids.instance,
    leafId: tree.rootNodeId,
    replayMode: 'native_menu_control_proof',
    packet,
    tree,
  });
  const prepared = prepareProcedureMenuControlProofProposal(
    request,
    materialization,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const proposal = guideProposalSchema.parse({
    protocolVersion: '1.5.0',
    proposalId: ids.proposal,
    targetAdapterId: 'blender',
    targetInstanceId: ids.instance,
    plan: materialization.compilation.plan,
    planDiff: null,
    catalogVersion: blenderActionCatalog.catalogVersion,
    proposedAt: '2026-08-22T10:00:00+08:00',
  });
  const record = buildProcedureMenuControlProofProposalRecord({
    recordId: ids.record,
    request,
    materialization,
    proposal,
    actionCatalog: blenderActionCatalog,
    interactionCatalog: blenderInteractionCatalog,
    createdAt: '2026-08-22T10:00:01+08:00',
  });
  const decision = guideProposalDecisionSchema.parse({
    protocolVersion: '1.5.0',
    decisionId: ids.decision,
    proposalId: proposal.proposalId,
    adapterId: 'blender',
    instanceId: ids.instance,
    decision: 'accepted',
    occurredAt: '2026-08-22T10:00:02+08:00',
  });
  const currentState = companionStateReportSchema.parse({
    protocolVersion: '1.5.0',
    reportId: ids.report,
    sequence: 7,
    adapterId: 'blender',
    instanceId: ids.instance,
    companionVersion: '0.1.0',
    hostVersion: '5.1.1',
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256: record.planContentSha256,
    executionId: ids.execution,
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
      checkpointId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      previousCheckpointId: null,
      operation: 'start',
      committedAt: '2026-08-22T10:00:03+08:00',
      marker: { key: '_operating_line_native_history_v1', matched: true },
      journal: {
        entryPresent: true,
        snapshotMatchesSession: true,
        artifactsBackedUp: true,
      },
      session: {
        plan: { id: proposal.plan.id, revision: proposal.plan.revision },
        planContentSha256: record.planContentSha256,
        executionId: ids.execution,
        activeStepId: null,
        completedStepIds: [],
        receiptStepIds: [],
      },
    },
    error: null,
    occurredAt: '2026-08-22T10:00:03+08:00',
  });
  return { request, materialization, prepared, proposal, record, decision, currentState };
}

function mutateMaterialization(
  mutation: (value: ProcedureAuthoringMaterializationResult) => void,
): ProcedureAuthoringMaterializationResult {
  const value = structuredClone(fixture().materialization);
  mutation(value);
  return value;
}

describe('procedure menu-control proof service', () => {
  it('prepares the exact catalog-authorized UV Sphere menu-control proof', () => {
    const value = fixture();
    expect(value.prepared).toEqual({
      actionName: 'blender.mesh.create_uv_sphere',
      recipeId: 'blender.mesh.create_uv_sphere.native',
      menuTrackContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      planning: {
        goal: value.request.packet.context.goalProvenance.source.text,
        requiredPhaseIds: ['geometry'],
        capabilityCoverage: {
          policyVersion: 'catalog_capability_coverage_v1',
          requirements: [
            {
              requirementId: 'tutorial.uv-sphere-proof.menu_control_proof_requirement',
              statement: value.request.packet.context.goalProvenance.source.text,
              coverage: [
                {
                  capabilityId: 'geometry.primitive_assembly',
                  stepIds: ['tutorial.uv-sphere-proof'],
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('builds a record bound to every canonical input and pending non-managed claims', () => {
    const { record, prepared } = fixture();
    expect(procedureMenuControlProofProposalRecordSchema.parse(record)).toEqual(record);
    expect(record.integrity.contentSha256).toBe(
      computeProcedureMenuControlProofProposalRecordContentSha256(record),
    );
    expect(record.materializationContentSha256).toBe(sha256(record.materialization));
    expect(record.proposalContentSha256).toBe(sha256(record.proposal));
    expect(record.packetContentSha256).toBe(record.request.packet.integrity.contentSha256);
    expect(record.inputTreeContentSha256).toBe(sha256(record.request.tree));
    expect(record.outputTreeContentSha256).toBe(sha256(record.materialization.tree));
    expect(record.planContentSha256).toBe(sha256(record.proposal.plan));
    expect(record.interactionCatalogContentSha256).toBe(
      record.materialization.catalogBinding.interactionCatalogContentSha256,
    );
    expect(record.menuTrackContentSha256).toBe(prepared.menuTrackContentSha256);
    expect(record.claims).toEqual({
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
    });
  });

  it('builds the exact accepted binding at the pristine walkthrough start CAS', () => {
    const { record, decision, currentState } = fixture();
    const binding = buildProcedureMenuControlProofBinding({
      bindingId: ids.binding,
      proofId: ids.proof,
      requestId: ids.request,
      record,
      decision,
      currentState,
      createdAt: '2026-08-22T10:00:04+08:00',
    });
    expect(procedureMenuControlProofBindingSchema.parse(binding)).toEqual(binding);
    expect(binding.operationIds).toEqual(uvSphereMenuControlProofOperationIds);
    expect(binding.nativeUndoDepth).toBe(8);
    expect(binding.proofScope).toEqual({
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['resourceId'],
    });
    expect(binding.startState).toMatchObject({
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      observationCount: 0,
      nativeUndoCheckpoint: {
        operation: 'start',
        previousCheckpointId: null,
      },
    });
    expect(binding.integrity.contentSha256).toBe(
      computeProcedureMenuControlProofBindingContentSha256(binding),
    );
  });

  it.each([
    [
      'foreign action',
      (value: ProcedureAuthoringMaterializationResult) => {
        const leaf = value.tree.nodes[0];
        if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected action');
        leaf.action.name = 'blender.mesh.create_icosphere';
      },
    ],
    [
      'foreign argument',
      (value: ProcedureAuthoringMaterializationResult) => {
        const leaf = value.tree.nodes[0];
        if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected action');
        leaf.action.arguments['radius'] = 2;
      },
    ],
    [
      'foreign menu order',
      (value: ProcedureAuthoringMaterializationResult) => {
        const leaf = value.tree.nodes[0];
        if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
          throw new Error('expected menu');
        }
        leaf.menuTracks[0].operations.reverse();
      },
    ],
    [
      'foreign executor',
      (value: ProcedureAuthoringMaterializationResult) => {
        const leaf = value.tree.nodes[0];
        if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
          throw new Error('expected menu');
        }
        Object.assign(leaf.menuTracks[0].proofExecution!, { executorId: 'foreign.executor' });
      },
    ],
  ])('rejects a %s substitution during preparation', (_, mutate) => {
    const base = fixture();
    const materialization = mutateMaterialization(mutate);
    expect(() =>
      prepareProcedureMenuControlProofProposal(
        base.request,
        materialization,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrowError(ProcedureMenuControlProofError);
  });

  it('reruns exact preparation inside the record builder and rejects substituted authority', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
        throw new Error('expected menu');
      }
      Object.assign(leaf.menuTracks[0].proofExecution!, { nativeUndoDepth: 7 });
    });
    expect(() =>
      buildProcedureMenuControlProofProposalRecord({
        recordId: ids.record,
        request: base.request,
        materialization,
        proposal: base.proposal,
        actionCatalog: blenderActionCatalog,
        interactionCatalog: blenderInteractionCatalog,
        createdAt: '2026-08-22T10:00:01+08:00',
      }),
    ).toThrowError(ProcedureMenuControlProofError);

    const catalog = {
      ...structuredClone(blenderActionCatalog),
      semanticCapabilities: blenderActionCatalog.semanticCapabilities?.filter(
        (capability) => !capability.actionNames.includes('blender.mesh.create_uv_sphere'),
      ),
    } as ActionCatalog;
    expect(() =>
      prepareProcedureMenuControlProofProposal(
        base.request,
        base.materialization,
        catalog,
        blenderInteractionCatalog,
      ),
    ).toThrowError(/one ActionCatalog action, planning phase, and semantic capability/);

    const foreignInteractionCatalog = {
      ...structuredClone(blenderInteractionCatalog),
      title: 'Foreign catalog content under a reused version',
    };
    expect(() =>
      prepareProcedureMenuControlProofProposal(
        base.request,
        base.materialization,
        blenderActionCatalog,
        foreignInteractionCatalog,
      ),
    ).toThrowError(/does not match the installed Blender catalogs/);
  });

  it('rejects a prompt packet changed after its integrity digest was issued', () => {
    const base = fixture();
    const request = structuredClone(base.request);
    request.packet.context.goalProvenance.source.text = 'Tampered after authorization.';

    expect(() =>
      prepareProcedureMenuControlProofProposal(
        request,
        base.materialization,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrowError(/does not match the installed Blender catalogs/);

    expect(() =>
      buildProcedureMenuControlProofProposalRecord({
        recordId: ids.record,
        request,
        materialization: base.materialization,
        proposal: base.proposal,
        actionCatalog: blenderActionCatalog,
        interactionCatalog: blenderInteractionCatalog,
        createdAt: '2026-08-22T10:00:01+08:00',
      }),
    ).toThrowError(/does not match the installed Blender catalogs/);
  });

  it('rejects a proposal substituted after exact preparation', () => {
    const base = fixture();
    const proposal = structuredClone(base.proposal);
    proposal.targetInstanceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    expect(() =>
      buildProcedureMenuControlProofProposalRecord({
        recordId: ids.record,
        request: base.request,
        materialization: base.materialization,
        proposal,
        actionCatalog: blenderActionCatalog,
        interactionCatalog: blenderInteractionCatalog,
        createdAt: '2026-08-22T10:00:01+08:00',
      }),
    ).toThrow();

    const materialization = structuredClone(base.materialization);
    materialization.outputTreeContentSha256 = 'f'.repeat(64);
    expect(() =>
      buildProcedureMenuControlProofProposalRecord({
        recordId: ids.record,
        request: base.request,
        materialization,
        proposal: base.proposal,
        actionCatalog: blenderActionCatalog,
        interactionCatalog: blenderInteractionCatalog,
        createdAt: '2026-08-22T10:00:01+08:00',
      }),
    ).toThrow();
  });

  it.each([
    ['rejected decision', { decision: 'rejected' }],
    ['foreign decision proposal', { proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
  ])('rejects a %s substitution', (_, decisionPatch) => {
    const { record, decision, currentState } = fixture();
    expect(() =>
      buildProcedureMenuControlProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision: { ...decision, ...decisionPatch },
        currentState,
        createdAt: '2026-08-22T10:00:04+08:00',
      }),
    ).toThrowError(/exact accepted in-host decision/);
  });

  it.each([
    ['active step', { activeStepId: 'tutorial.uv-sphere-proof' }],
    ['completed step', { completedStepIds: ['tutorial.uv-sphere-proof'] }],
    ['foreign transition', { transition: 'step_started', stepId: 'tutorial.uv-sphere-proof' }],
    ['historical observation', { observations: [{ kind: 'uv_sphere_ready', parameters: {} }] }],
    ['missing native start checkpoint', { nativeUndoCheckpoint: undefined }],
    [
      'foreign native checkpoint operation',
      {
        nativeUndoCheckpoint: {
          ...fixture().currentState.nativeUndoCheckpoint!,
          operation: 'next',
          previousCheckpointId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      },
    ],
  ])('rejects a non-pristine start state with %s', (_, statePatch) => {
    const { record, decision, currentState } = fixture();
    expect(() =>
      buildProcedureMenuControlProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision,
        currentState: { ...currentState, ...statePatch } as CompanionStateReport,
        createdAt: '2026-08-22T10:00:04+08:00',
      }),
    ).toThrowError(ProcedureMenuControlProofError);
  });

  it('rejects plan hash and temporal substitutions', () => {
    const { record, decision, currentState } = fixture();
    const foreignPlanState = structuredClone(currentState);
    foreignPlanState.planContentSha256 = 'f'.repeat(64);
    foreignPlanState.nativeUndoCheckpoint!.session.planContentSha256 = 'f'.repeat(64);
    expect(() =>
      buildProcedureMenuControlProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision,
        currentState: foreignPlanState,
        createdAt: '2026-08-22T10:00:04+08:00',
      }),
    ).toThrowError(/active accepted proposal execution/);
    expect(() =>
      buildProcedureMenuControlProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision: { ...decision, occurredAt: '2026-08-22T10:00:04+08:00' },
        currentState,
        createdAt: '2026-08-22T10:00:05+08:00',
      }),
    ).toThrowError(/decision <= checkpoint <= start <= created/);
  });

  it('rejects canonical proposal-record tampering before binding', () => {
    const { record, decision, currentState } = fixture();
    const tampered = structuredClone(record);
    tampered.packetContentSha256 = 'f'.repeat(64);
    expect(() =>
      buildProcedureMenuControlProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record: tampered,
        decision,
        currentState,
        createdAt: '2026-08-22T10:00:04+08:00',
      }),
    ).toThrowError(/record, decision, or current state is invalid/);
  });
});
