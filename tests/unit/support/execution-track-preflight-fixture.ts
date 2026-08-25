import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  companionExecutionTrackPreflightBindingSchema,
  companionExecutionTrackPreflightCreateRequestSchema,
  computeProtocolCanonicalJsonSha256,
  guideProtocolVersion,
  guideStepSchema,
  procedureAuthoringCandidateTreeSchema,
  type CompanionExecutionTrackPreflightBinding,
  type CompanionExecutionTrackPreflightCreateRequest,
} from '@operatingline/protocol';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';

export const preflightIds = {
  request: '11111111-1111-4111-8111-111111111111',
  instance: '22222222-2222-4222-8222-222222222222',
  proposal: '33333333-3333-4333-8333-333333333333',
  execution: '44444444-4444-4444-8444-444444444444',
  report: '55555555-5555-4555-8555-555555555555',
  replay: '66666666-6666-4666-8666-666666666666',
  review: '77777777-7777-4777-8777-777777777777',
  lease: '88888888-8888-4888-8888-888888888888',
  session: '99999999-9999-4999-8999-999999999999',
  document: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  delivery: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  decision: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;

function candidate() {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = 'tutorial.execution-track-preflight';
  tree['revision'] = 1;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('expected fixture leaf');
  leaf['id'] = 'tutorial.execution-track-preflight';
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
  leaf['expectedObservations'] = [
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
  leaf['menuTracks'] = [
    {
      id: 'tutorial.execution-track-preflight.menu.pending',
      availability: 'unavailable',
      title: 'Menu grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'menu',
    },
  ];
  leaf['shortcutTracks'] = [
    {
      id: 'tutorial.execution-track-preflight.shortcut.pending',
      availability: 'unavailable',
      title: 'Shortcut grounding pending',
      reason: 'Catalog materialization has not run.',
      modality: 'shortcut',
    },
  ];
  leaf['mcpTracks'] = [
    {
      id: 'tutorial.execution-track-preflight.mcp.pending',
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

export function executionTrackPreflightFixture(): {
  binding: CompanionExecutionTrackPreflightBinding;
  request: CompanionExecutionTrackPreflightCreateRequest;
} {
  const materialized = materializeProcedureAuthoringCandidate(
    candidate(),
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const sourceLeaf = materialized.tree.nodes[0];
  if (sourceLeaf?.kind !== 'leaf') throw new Error('expected materialized leaf');
  const selectedTrack = sourceLeaf.menuTracks[0];
  if (selectedTrack?.availability !== 'available' || selectedTrack.proofExecution === undefined) {
    throw new Error('expected proof-backed menu track');
  }
  const override = {
    kind: 'interaction_catalog_proof' as const,
    interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
    interactionCatalogContentSha256: materialized.interactionCatalogContentSha256,
    recipeId: 'blender.mesh.create_uv_sphere.native',
    modality: 'menu' as const,
    trackId: selectedTrack.id,
    trackContentSha256: computeProtocolCanonicalJsonSha256(selectedTrack),
    proofExecutionContentSha256: computeProtocolCanonicalJsonSha256(selectedTrack.proofExecution),
  };
  const step = guideStepSchema.parse({
    id: sourceLeaf.id,
    parentId: sourceLeaf.parentId,
    order: sourceLeaf.order,
    dependsOn: sourceLeaf.dependsOn,
    title: sourceLeaf.title,
    intent: sourceLeaf.intent,
    explanation: sourceLeaf.intent,
    state: 'ready',
    action: sourceLeaf.action,
    anchors: sourceLeaf.anchors,
    expectedObservations: sourceLeaf.expectedObservations,
    observationPolicy: sourceLeaf.observationPolicy,
    executionTrackOverride: override,
    rollback: sourceLeaf.rollback,
  });
  const content = {
    formatVersion: '1.0.0' as const,
    requestId: preflightIds.request,
    target: { adapterId: 'blender' as const, instanceId: preflightIds.instance },
    proposal: {
      id: preflightIds.proposal,
      contentSha256: '2'.repeat(64),
    },
    plan: {
      protocolVersion: guideProtocolVersion,
      id: 'tutorial.execution-track-preflight',
      revision: 2,
      contentSha256: '3'.repeat(64),
    },
    executionId: preflightIds.execution,
    leafId: sourceLeaf.id,
    override,
    expectedState: { reportId: preflightIds.report, sequence: 7 },
    replayId: preflightIds.replay,
    step,
    review: { id: preflightIds.review, contentSha256: '4'.repeat(64) },
    revision: {
      requestContentSha256: '5'.repeat(64),
      diffContentSha256: '6'.repeat(64),
    },
    replay: { id: preflightIds.replay, bindingContentSha256: '7'.repeat(64) },
    artifacts: {
      procedureTreeContentSha256: computeProtocolCanonicalJsonSha256(materialized.tree),
      sourceLeafContentSha256: computeProtocolCanonicalJsonSha256(sourceLeaf),
    },
    catalogs: {
      action: {
        version: blenderActionCatalog.catalogVersion,
        contentSha256: computeProtocolCanonicalJsonSha256(blenderActionCatalog),
      },
      interaction: {
        version: blenderInteractionCatalog.catalogVersion,
        contentSha256: materialized.interactionCatalogContentSha256,
        recipeId: override.recipeId,
      },
    },
    acceptance: {
      decision: {
        protocolVersion: guideProtocolVersion,
        decisionId: preflightIds.decision,
        proposalId: preflightIds.proposal,
        adapterId: 'blender' as const,
        instanceId: preflightIds.instance,
        decision: 'accepted' as const,
        occurredAt: '2026-08-22T09:59:58Z',
      },
      decisionContentSha256: '',
      receipt: {
        sequence: 42,
        subjectType: 'guide_proposal_decision' as const,
        subjectId: preflightIds.decision,
        authentication: 'negotiated_companion_lease' as const,
        adapterId: 'blender' as const,
        instanceId: preflightIds.instance,
        sessionFingerprintSha256: '8'.repeat(64),
        receivedAt: '2026-08-22T09:59:59Z',
      },
    },
    action: sourceLeaf.action!,
    sourceLeaf,
    selectedTrack,
    requestedAt: '2026-08-22T10:00:00Z',
  };
  content.acceptance.decisionContentSha256 = computeProtocolCanonicalJsonSha256(
    content.acceptance.decision,
  );
  const binding = companionExecutionTrackPreflightBindingSchema.parse({
    ...content,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(content),
  });
  const request = companionExecutionTrackPreflightCreateRequestSchema.parse({
    formatVersion: binding.formatVersion,
    requestId: binding.requestId,
    target: binding.target,
    proposalId: binding.proposal.id,
    plan: binding.plan,
    executionId: binding.executionId,
    leafId: binding.leafId,
    override: binding.override,
    expectedState: binding.expectedState,
  });
  return { binding, request };
}

export function executionTrackPreflightLease() {
  return {
    leaseId: preflightIds.lease,
    sessionId: preflightIds.session,
    target: { adapterId: 'blender' as const, instanceId: preflightIds.instance },
    documentIncarnationId: preflightIds.document,
    expiresAt: '2026-08-22T10:05:00Z',
  } as const;
}
