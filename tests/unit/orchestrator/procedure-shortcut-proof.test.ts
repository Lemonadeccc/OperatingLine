import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  compileProcedureTreeToGuidePlan,
  computeProcedureShortcutProofBindingContentSha256,
  computeProcedureShortcutProofProposalRecordContentSha256,
  guideProposalDecisionSchema,
  guideProposalSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureShortcutProofBindingSchema,
  procedureShortcutProofProposalRecordSchema,
  type ActionCatalog,
  type CompanionStateReport,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureShortcutProofProposalRequest,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import {
  buildProcedureShortcutProofBinding,
  buildProcedureShortcutProofProposalRecord,
  prepareProcedureShortcutProofProposal,
  ProcedureShortcutProofError,
} from '../../../services/orchestrator/src/procedure-shortcut-proof.js';

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
  tree['id'] = 'tutorial.modifier.subdivision';
  tree['revision'] = 1;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;

  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('expected fixture leaf');
  leaf['id'] = 'tutorial.modifier.subdivision';
  leaf['parentId'] = null;
  leaf['order'] = 1;
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.modifier.add_subdivision_surface',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
      viewportLevel: 3,
    },
  };
  leaf['semanticOperations'] = [
    {
      id: 'semantic.add_subdivision_surface',
      order: 1,
      semanticAction: 'add_subdivision_surface_modifier',
      description: 'Add one Subdivision Surface modifier at viewport level three.',
      parameters: { viewportLevel: 3 },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  leaf['menuTracks'] = [
    {
      id: 'tutorial.modifier.subdivision.menu.pending',
      availability: 'unavailable',
      title: 'Menu grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'menu',
    },
  ];
  leaf['shortcutTracks'] = [
    {
      id: 'tutorial.modifier.subdivision.shortcut.pending',
      availability: 'unavailable',
      title: 'Shortcut grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'shortcut',
    },
  ];
  leaf['mcpTracks'] = [
    {
      id: 'tutorial.modifier.subdivision.mcp.pending',
      availability: 'unavailable',
      title: 'MCP grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'mcp',
    },
  ];
  leaf['anchors'] = [{ kind: 'object', objectName: 'Cube' }];
  leaf['expectedObservations'] = [
    {
      kind: 'modifier_ready',
      parameters: { modifierId: 'tutorial.cube.subdivision_surface' },
    },
  ];
  leaf['validation'] = { status: 'candidate', validatedHostVersions: [], notes: [] };
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
      goal: 'Add a Subdivision Surface modifier to the factory Cube at viewport level three.',
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
  const request: ProcedureShortcutProofProposalRequest = {
    formatVersion: '1.0.0',
    replayId: ids.replay,
    targetInstanceId: ids.instance,
    leafId: 'tutorial.modifier.subdivision',
    replayMode: 'native_shortcut_proof',
    packet,
    tree,
  };
  const prepared = prepareProcedureShortcutProofProposal(
    request,
    materialization,
    blenderActionCatalog,
  );
  const proposal = guideProposalSchema.parse({
    protocolVersion: '1.5.0',
    proposalId: ids.proposal,
    targetAdapterId: 'blender',
    targetInstanceId: ids.instance,
    plan: materialization.compilation.plan,
    planDiff: null,
    catalogVersion: blenderActionCatalog.catalogVersion,
    proposedAt: '2026-08-20T10:00:00Z',
  });
  const planContentSha256 = sha256(proposal.plan);
  const record = buildProcedureShortcutProofProposalRecord({
    recordId: ids.record,
    request,
    materialization,
    proposal,
    planContentSha256,
    shortcutTrackContentSha256: prepared.shortcutTrackContentSha256,
    createdAt: '2026-08-20T10:00:01Z',
  });
  const decision = guideProposalDecisionSchema.parse({
    protocolVersion: '1.5.0',
    decisionId: ids.decision,
    proposalId: proposal.proposalId,
    adapterId: 'blender',
    instanceId: ids.instance,
    decision: 'accepted',
    occurredAt: '2026-08-20T10:00:02Z',
  });
  const currentState: CompanionStateReport = {
    protocolVersion: '1.5.0',
    reportId: ids.report,
    sequence: 7,
    adapterId: 'blender',
    instanceId: ids.instance,
    companionVersion: '0.1.0',
    hostVersion: '5.1.1',
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256,
    executionId: ids.execution,
    phase: 'running',
    activeStepId: null,
    completedStepIds: [],
    transition: 'walkthrough_started',
    stepId: null,
    observations: [],
    observationGate: null,
    error: null,
    occurredAt: '2026-08-20T10:00:03Z',
  };
  return { request, materialization, prepared, proposal, record, decision, currentState };
}

function mutateMaterialization(
  mutation: (value: ProcedureAuthoringMaterializationResult) => void,
): ProcedureAuthoringMaterializationResult {
  const value = structuredClone(fixture().materialization);
  mutation(value);
  return value;
}

describe('procedure shortcut proof service', () => {
  it('prepares the exact catalog-authorized Subdivision Surface shortcut proof', () => {
    const value = fixture();

    expect(value.prepared).toEqual({
      actionName: 'blender.modifier.add_subdivision_surface',
      recipeId: 'blender.modifier.add_subdivision_surface.semantic',
      targetId: 'tutorial.cube',
      shortcutTrackContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      planning: {
        goal: value.request.packet.context.goalProvenance.source.text,
        requiredPhaseIds: expect.any(Array),
        capabilityCoverage: expect.objectContaining({
          policyVersion: 'catalog_capability_coverage_v1',
        }),
      },
    });
  });

  it('builds a canonically integrity-bound proposal record', () => {
    const { record } = fixture();
    expect(procedureShortcutProofProposalRecordSchema.parse(record)).toEqual(record);
    expect(record.integrity.contentSha256).toBe(
      computeProcedureShortcutProofProposalRecordContentSha256(record),
    );
  });

  it('does not allow proposal-record construction to bypass the fixed target identity', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected leaf action');
      leaf.action.arguments['targetId'] = 'tutorial.other';
    });

    expect(() =>
      buildProcedureShortcutProofProposalRecord({
        recordId: ids.record,
        request: base.request,
        materialization,
        proposal: base.proposal,
        planContentSha256: sha256(base.proposal.plan),
        shortcutTrackContentSha256: base.prepared.shortcutTrackContentSha256,
        createdAt: '2026-08-20T10:00:01Z',
      }),
    ).toThrowError(/exact factory Cube catalog authority/);
  });

  it('builds an accepted binding while declaring the managed arguments omitted by native input', () => {
    const { record, decision, currentState } = fixture();
    const binding = buildProcedureShortcutProofBinding({
      bindingId: ids.binding,
      proofId: ids.proof,
      requestId: ids.request,
      record,
      decision,
      currentState,
      createdAt: '2026-08-20T10:00:04Z',
    });
    expect(procedureShortcutProofBindingSchema.parse(binding)).toEqual(binding);
    expect(binding.proofScope).toEqual({
      managedActionResult: 'not_executed',
      managedIdentityVerified: false,
      managedReceiptCreated: false,
      omittedAcceptedArguments: ['modifierId', 'modifierName'],
    });
    expect(binding.acceptedAction.arguments).toEqual(
      record.materialization.compilation.plan.steps[0]!.action?.arguments,
    );
    expect(binding.integrity.contentSha256).toBe(
      computeProcedureShortcutProofBindingContentSha256(binding),
    );
  });

  it('rejects an action with an unapproved argument', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected leaf action');
      leaf.action.arguments['renderLevel'] = 3;
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/exact bounded Subdivision Surface action/);
  });

  it('rejects an action other than Subdivision Surface', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected leaf action');
      leaf.action.name = 'blender.modifier.add_mirror';
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/exact bounded Subdivision Surface action/);
  });

  it('rejects a logical target other than the factory Cube binding', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected leaf action');
      leaf.action.arguments['targetId'] = 'tutorial.other';
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/exact bounded Subdivision Surface action/);
  });

  it.each([
    ['modifier id', 'modifierId', 'tutorial.cube.other_modifier'],
    ['modifier name', 'modifierName', 'Subdivision'],
  ])('rejects a non-fixed %s', (_, field, value) => {
    const base = fixture();
    const materialization = mutateMaterialization((candidateValue) => {
      const leaf = candidateValue.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('expected leaf action');
      }
      leaf.action.arguments[field] = value;
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/exact bounded Subdivision Surface action/);
  });

  it('rejects a semantic object anchor that does not identify the factory Cube', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
      leaf.anchors = [{ kind: 'object', objectName: 'OperatingLine.Cube' }];
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/factory Cube object anchor/);
  });

  it('rejects ambiguous object anchors even when one names the factory Cube', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
      leaf.anchors = [...leaf.anchors, { kind: 'object', objectName: 'Another Cube' }];
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/factory Cube object anchor/);
  });

  it('rejects a target profile outside the factory Cube proof boundary', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.shortcutTracks[0]?.availability !== 'available') {
        throw new Error('expected shortcut track');
      }
      leaf.shortcutTracks[0].proofExecution = {
        ...leaf.shortcutTracks[0].proofExecution!,
        targetProfile: 'forged_profile' as 'factory_cube_8_12_6',
      };
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/factory Cube shortcut proof track/);
  });

  it('rejects a shortcut track whose availability is not materialized', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
      leaf.shortcutTracks = [
        {
          id: 'tutorial.modifier.subdivision.shortcut.unavailable',
          availability: 'unavailable',
          title: 'Shortcut unavailable',
          reason: 'Native shortcut authority was removed.',
          modality: 'shortcut',
        },
      ];
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/factory Cube shortcut proof track/);
  });

  it('rejects reordered shortcut operations', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      const leaf = value.tree.nodes[0];
      if (leaf?.kind !== 'leaf' || leaf.shortcutTracks[0]?.availability !== 'available') {
        throw new Error('expected shortcut track');
      }
      const operations = leaf.shortcutTracks[0].operations;
      [operations[0], operations[1]] = [operations[1]!, operations[0]!];
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/factory Cube shortcut proof track/);
  });

  it('rejects a materialization bound to a different ActionCatalog', () => {
    const base = fixture();
    const materialization = mutateMaterialization((value) => {
      value.catalogBinding.actionCatalogVersion = '1.0.0';
    });

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, materialization, blenderActionCatalog),
    ).toThrowError(/does not match the installed Blender ActionCatalog/);
  });

  it('rejects an ActionCatalog missing the Subdivision Surface action', () => {
    const base = fixture();
    const catalog = {
      ...structuredClone(blenderActionCatalog),
      actions: blenderActionCatalog.actions.filter(
        (action) => action.name !== 'blender.modifier.add_subdivision_surface',
      ),
    } as ActionCatalog;

    expect(() =>
      prepareProcedureShortcutProofProposal(base.request, base.materialization, catalog),
    ).toThrowError(/one ActionCatalog action, planning phase, and capability/);
  });

  it('rejects a decision that was not accepted', () => {
    const { record, decision, currentState } = fixture();

    expect(() =>
      buildProcedureShortcutProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision: { ...decision, decision: 'rejected' },
        currentState,
        createdAt: '2026-08-20T10:00:04Z',
      }),
    ).toThrowError(ProcedureShortcutProofError);
  });

  it('rejects a current state for a different active plan', () => {
    const { record, decision, currentState } = fixture();

    expect(() =>
      buildProcedureShortcutProofBinding({
        bindingId: ids.binding,
        proofId: ids.proof,
        requestId: ids.request,
        record,
        decision,
        currentState: { ...currentState, planContentSha256: '0'.repeat(64) },
        createdAt: '2026-08-20T10:00:04Z',
      }),
    ).toThrowError(/active accepted proposal execution/);
  });

  it('rejects canonical proposal-record content tampering', () => {
    const { record } = fixture();
    const tampered = structuredClone(record);
    tampered.createdAt = '2026-08-20T10:00:05Z';

    expect(procedureShortcutProofProposalRecordSchema.safeParse(tampered).success).toBe(false);
  });
});
