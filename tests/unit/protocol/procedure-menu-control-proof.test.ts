import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  compileProcedureTreeToGuidePlan,
  computeProcedureMenuControlProofBindingContentSha256,
  computeProcedureMenuControlProofProposalRecordContentSha256,
  computeProtocolCanonicalJsonSha256,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureMenuControlProofBindingSchema,
  procedureMenuControlProofProposalRecordSchema,
  procedureMenuControlProofProposalRequestSchema,
  procedureMenuControlProofProposalResultSchema,
  protocolJsonValueCanonicalization,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

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

const operationIds = [
  'workspace.layout',
  'menu.add',
  'menu.mesh',
  'operator.uv_sphere',
  'control.location',
  'control.scale',
  'control.object_name',
] as const;

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
  const plan = compileProcedureTreeToGuidePlan(grounded.tree);
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
      plan,
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
  const proposal = {
    protocolVersion: '1.5.0',
    proposalId: ids.proposal,
    targetAdapterId: 'blender',
    targetInstanceId: ids.instance,
    plan,
    planDiff: null,
    catalogVersion: blenderActionCatalog.catalogVersion,
    proposedAt: '2026-08-22T10:00:00+08:00',
  } as const;
  const leaf = materialization.tree.nodes[0];
  if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
    throw new Error('expected exact materialized menu proof leaf');
  }
  const menuTrack = leaf.menuTracks[0];
  if (menuTrack.proofExecution === undefined) throw new Error('expected menu proof declaration');
  const content = {
    formatVersion: '1.0.0',
    recordId: ids.record,
    replayId: ids.replay,
    request,
    materialization,
    proposal,
    packetContentSha256: packet.integrity.contentSha256,
    inputTreeContentSha256: materialization.inputTreeContentSha256,
    outputTreeContentSha256: materialization.outputTreeContentSha256,
    materializationContentSha256: computeProtocolCanonicalJsonSha256(materialization),
    proposalContentSha256: computeProtocolCanonicalJsonSha256(proposal),
    planContentSha256: computeProtocolCanonicalJsonSha256(plan),
    interactionCatalogContentSha256,
    leafId: tree.rootNodeId,
    recipeId: 'blender.mesh.create_uv_sphere.native',
    actionName: 'blender.mesh.create_uv_sphere',
    menuTrackContentSha256: computeProtocolCanonicalJsonSha256(menuTrack),
    proofExecution: menuTrack.proofExecution,
    claims: {
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
    },
    createdAt: '2026-08-22T10:00:01+08:00',
  } as const;
  const record = {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofProposalRecordContentSha256(content),
    },
  } as const;
  return { request, record };
}

function binding() {
  const { record } = fixture();
  const content = {
    formatVersion: '1.0.0',
    bindingId: ids.binding,
    proposalRecordContentSha256: record.integrity.contentSha256,
    proofId: ids.proof,
    requestId: ids.request,
    replayId: ids.replay,
    target: { adapterId: 'blender', instanceId: ids.instance },
    proposalId: ids.proposal,
    packetContentSha256: record.packetContentSha256,
    inputTreeContentSha256: record.inputTreeContentSha256,
    outputTreeContentSha256: record.outputTreeContentSha256,
    materializationContentSha256: record.materializationContentSha256,
    proposalContentSha256: record.proposalContentSha256,
    plan: { id: record.proposal.plan.id, revision: 1, contentSha256: record.planContentSha256 },
    executionId: ids.execution,
    leafId: record.leafId,
    recipeId: 'blender.mesh.create_uv_sphere.native',
    actionName: 'blender.mesh.create_uv_sphere',
    acceptedAction: {
      adapterId: 'blender',
      name: 'blender.mesh.create_uv_sphere',
      arguments: {
        resourceId: 'proof.uv_sphere.eye',
        objectName: 'OperatingLine.TutorialEye',
        radius: 1.5,
        location: [1.25, -2, 0.75],
      },
    },
    targetProfile: 'factory_layout_three_object_ui_scale_2',
    acceptedDecision: {
      decisionId: ids.decision,
      proposalId: ids.proposal,
      instanceId: ids.instance,
      adapterId: 'blender',
      decision: 'accepted',
      decidedAt: '2026-08-22T10:00:02+08:00',
    },
    startState: {
      reportId: ids.report,
      sequence: 7,
      adapterId: 'blender',
      instanceId: ids.instance,
      plan: { id: record.proposal.plan.id, revision: 1 },
      planContentSha256: record.planContentSha256,
      executionId: ids.execution,
      phase: 'running',
      activeStepId: null,
      completedStepIds: [],
      transition: 'walkthrough_started',
      stepId: null,
      observationCount: 0,
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
          plan: { id: record.proposal.plan.id, revision: 1 },
          planContentSha256: record.planContentSha256,
          executionId: ids.execution,
          activeStepId: null,
          completedStepIds: [],
          receiptStepIds: [],
        },
      },
      occurredAt: '2026-08-22T10:00:03+08:00',
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
    executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
    executionBoundary: 'blender_window_event_simulate',
    authorization: 'accepted_replay_next_step',
    transport: 'event_simulate',
    operationIds,
    nativeUndoDepth: 8,
    createdAt: '2026-08-22T10:00:04+08:00',
  } as const;
  return {
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureMenuControlProofBindingContentSha256(content),
    },
  } as const;
}

describe('procedure menu-control proof protocol', () => {
  it('accepts only the exact callable proposal and canonical record', () => {
    const { request, record } = fixture();
    expect(procedureMenuControlProofProposalRequestSchema.parse(request)).toEqual(request);
    expect(procedureMenuControlProofProposalRecordSchema.parse(record)).toEqual(record);
    expect(
      procedureMenuControlProofProposalResultSchema.parse({ status: 'accepted', record }),
    ).toEqual({ status: 'accepted', record });
    const leaf = record.materialization.tree.nodes[0];
    if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
      throw new Error('expected menu proof leaf');
    }
    expect(leaf.menuTracks[0].operations.map((operation) => operation.id)).toEqual(operationIds);
    expect(
      leaf.menuTracks[0].operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
  });

  it('binds the exact accepted in-host start without managed action evidence', () => {
    const value = binding();
    expect(procedureMenuControlProofBindingSchema.parse(value)).toEqual(value);
    expect(value.proofScope).toEqual({
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['resourceId'],
    });
    expect(value.operationIds).toHaveLength(7);
    expect(value.nativeUndoDepth).toBe(8);
    expect(value.startState.nativeUndoCheckpoint).toMatchObject({
      operation: 'start',
      previousCheckpointId: null,
    });
  });

  it('rejects no-proof, reordered, foreign, historical, and tampered evidence', () => {
    const noProof = structuredClone(fixture().record);
    const leaf = noProof.materialization.tree.nodes[0];
    if (leaf?.kind !== 'leaf' || leaf.menuTracks[0]?.availability !== 'available') {
      throw new Error('expected menu proof leaf');
    }
    delete leaf.menuTracks[0].proofExecution;
    const reordered = structuredClone(fixture().record);
    const reorderedLeaf = reordered.materialization.tree.nodes[0];
    if (
      reorderedLeaf?.kind !== 'leaf' ||
      reorderedLeaf.menuTracks[0]?.availability !== 'available'
    ) {
      throw new Error('expected menu proof leaf');
    }
    reorderedLeaf.menuTracks[0].operations.reverse();

    const foreign = structuredClone(binding());
    foreign.acceptedDecision.instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    foreign.integrity.contentSha256 = computeProcedureMenuControlProofBindingContentSha256(foreign);

    const historical = structuredClone(binding());
    historical.acceptedDecision.decidedAt = '2026-08-22T10:00:04+08:00';
    historical.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(historical);

    const foreignCheckpoint = structuredClone(binding());
    foreignCheckpoint.startState.nativeUndoCheckpoint.operation = 'next';
    foreignCheckpoint.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(foreignCheckpoint);

    const foreignCheckpointSession = structuredClone(binding());
    foreignCheckpointSession.startState.nativeUndoCheckpoint.session.planContentSha256 = 'e'.repeat(
      64,
    );
    foreignCheckpointSession.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(foreignCheckpointSession);

    const lateCheckpoint = structuredClone(binding());
    lateCheckpoint.startState.nativeUndoCheckpoint.committedAt = '2026-08-22T10:00:03.001+08:00';
    lateCheckpoint.integrity.contentSha256 =
      computeProcedureMenuControlProofBindingContentSha256(lateCheckpoint);

    const tampered = structuredClone(binding());
    tampered.materialization.menuTrackContentSha256 = 'f'.repeat(64);

    const stalePacketIntegrity = structuredClone(fixture().record);
    stalePacketIntegrity.request.packet.context.goalProvenance.source.text =
      'Tampered after the packet digest was issued.';
    stalePacketIntegrity.integrity.contentSha256 =
      computeProcedureMenuControlProofProposalRecordContentSha256(stalePacketIntegrity);

    for (const [schema, value] of [
      [procedureMenuControlProofProposalRecordSchema, noProof],
      [procedureMenuControlProofProposalRecordSchema, reordered],
      [procedureMenuControlProofBindingSchema, foreign],
      [procedureMenuControlProofBindingSchema, historical],
      [procedureMenuControlProofBindingSchema, foreignCheckpoint],
      [procedureMenuControlProofBindingSchema, foreignCheckpointSession],
      [procedureMenuControlProofBindingSchema, lateCheckpoint],
      [procedureMenuControlProofBindingSchema, tampered],
      [procedureMenuControlProofProposalRecordSchema, stalePacketIntegrity],
    ] as const) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it('publishes strict Fastify/Ajv-compatible schemas with request parity', async () => {
    const { request, record } = fixture();
    for (const [filename, valid] of [
      ['procedure-menu-control-proof-proposal-request.schema.json', request],
      ['procedure-menu-control-proof-proposal-record.schema.json', record],
      ['procedure-menu-control-proof-proposal-result.schema.json', { status: 'accepted', record }],
      ['procedure-menu-control-proof-binding.schema.json', binding()],
    ] as const) {
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      expect(schema['additionalProperties']).toBe(false);
      if (filename !== 'procedure-menu-control-proof-proposal-request.schema.json') {
        expect(schema['$comment']).toContain('Zod/service semantic validation gate');
      }
      const cases: Array<{ value: unknown; accepted: boolean }> = [
        { value: valid, accepted: true },
        { value: { ...valid, forbidden: true }, accepted: false },
      ];
      if (filename === 'procedure-menu-control-proof-binding.schema.json') {
        const invalidOperation = structuredClone(binding());
        invalidOperation.startState.nativeUndoCheckpoint.operation = 'next';
        const nonNullPrevious = structuredClone(binding());
        nonNullPrevious.startState.nativeUndoCheckpoint.previousCheckpointId =
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const activeCheckpoint = structuredClone(binding());
        activeCheckpoint.startState.nativeUndoCheckpoint.session.activeStepId =
          activeCheckpoint.leafId;
        const completedCheckpoint = structuredClone(binding());
        completedCheckpoint.startState.nativeUndoCheckpoint.session.completedStepIds = [
          completedCheckpoint.leafId,
        ];
        const receiptedCheckpoint = structuredClone(binding());
        receiptedCheckpoint.startState.nativeUndoCheckpoint.session.receiptStepIds = [
          receiptedCheckpoint.leafId,
        ];
        cases.push(
          { value: invalidOperation, accepted: false },
          { value: nonNullPrevious, accepted: false },
          { value: activeCheckpoint, accepted: false },
          { value: completedCheckpoint, accepted: false },
          { value: receiptedCheckpoint, accepted: false },
        );
      }
      await validatePublicJsonSchemaCases(schema, cases);
    }
  });
});
