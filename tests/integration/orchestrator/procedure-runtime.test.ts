import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  buildProcedureAuthoringPromptPacket,
  computeProcedureAuthoringPromptPacketContentSha256,
  computePlanContentSha256,
  procedureAuthoringPromptPacketContent,
  startRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';
import {
  canonicalizeProtocolJsonValue,
  companionActionExecutionStatusSchema,
  companionActionPollDeliverySchema,
  guideProtocolVersion,
  procedureLeafReplayCurrentStateRequestResultSchema,
  procedureLeafReplayCurrentStateStatusResultSchema,
  procedureLeafReplayFailureRecoveryFinalizeResultSchema,
  procedureLeafReplayFinalizeResultSchema,
  procedureLeafReplayProposalResultSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
  procedureAuthoringPromptPacketSchema,
  type ProcedureAuthoringPromptPacket,
} from '@operatingline/protocol';

import { buildProcedureLeafReplayAttestation } from '../../../services/orchestrator/src/procedure-replay.js';

const accessToken = 'procedure-runtime-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

function blenderCompanionHello(instanceId: string) {
  return {
    contractVersion: '1.0.0',
    adapterId: 'blender',
    instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3 LTS',
    supportedGuideProtocolVersions: [blenderActionCatalog.protocolVersion, guideProtocolVersion],
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

function replayNativeUndoCheckpoint(input: {
  readonly planId: string;
  readonly planRevision: number;
  readonly planContentSha256: string;
  readonly executionId: string;
  readonly stepId: string;
  readonly occurredAt: string;
  readonly operation?: 'next' | 'recheck';
  readonly completedStepIds?: readonly string[];
  readonly previousCheckpointId?: string;
}) {
  return {
    formatVersion: '1.0.0' as const,
    evidenceClass: 'companion_reported_native_undo_checkpoint' as const,
    checkpointId: randomUUID(),
    previousCheckpointId: input.previousCheckpointId ?? randomUUID(),
    operation: input.operation ?? ('next' as const),
    committedAt: new Date(Date.parse(input.occurredAt) - 1).toISOString(),
    marker: {
      key: '_operating_line_native_history_v1' as const,
      matched: true as const,
    },
    journal: {
      entryPresent: true as const,
      snapshotMatchesSession: true as const,
      artifactsBackedUp: true as const,
    },
    session: {
      plan: { id: input.planId, revision: input.planRevision },
      planContentSha256: input.planContentSha256,
      executionId: input.executionId,
      activeStepId: input.stepId,
      completedStepIds: input.completedStepIds ?? [input.stepId],
      receiptStepIds: [input.stepId],
    },
  };
}

function strongPrimitiveObservationDetails(input: {
  readonly parameters: Record<string, unknown>;
  readonly topology: {
    readonly vertexCount: number;
    readonly edgeCount: number;
    readonly faceCount: number;
  };
  readonly geometryDetailKeys: readonly string[];
}) {
  const resourceId = input.parameters['resourceId'];
  const objectName = input.parameters['objectName'];
  if (typeof resourceId !== 'string' || typeof objectName !== 'string') {
    throw new Error('Expected managed primitive observation identities');
  }
  return {
    parameters: structuredClone(input.parameters),
    supported: true,
    resourceId,
    objectName,
    meshId: `${resourceId}.mesh`,
    collectionId: 'snowman.collection',
    parametersValid: true,
    objectOwned: true,
    meshOwned: true,
    collectionOwned: true,
    receiptMatches: true,
    objectDataMatches: true,
    collectionLinkMatches: true,
    nameMatches: true,
    locationMatches: true,
    rotationMatches: true,
    scaleMatches: true,
    transformIsolated: true,
    modifiersAbsent: true,
    shapeKeysAbsent: true,
    materialsAbsent: true,
    contentIntact: true,
    topologyMatches: true,
    finiteCoordinates: true,
    ...Object.fromEntries(input.geometryDetailKeys.map((key) => [key, true])),
    ...input.topology,
    meshContentSha256: 'e'.repeat(64),
  };
}

async function waitUntilAfter(isoTimestamp: string): Promise<void> {
  const timestamp = Date.parse(isoTimestamp);
  for (let attempt = 0; attempt < 100 && Date.now() <= timestamp; attempt += 1) {
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  if (Date.now() <= timestamp) {
    throw new Error(`Clock did not advance beyond ${isoTimestamp} within the bounded wait`);
  }
}

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: unknown;
  };
}

async function callMcpTool(
  runtime: RunningRuntime,
  id: number,
  name: string,
  argumentsValue: unknown,
): Promise<McpToolResponse> {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
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
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice('data: '.length)) as McpToolResponse;
}

function procedureFixture(): Record<string, unknown> {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  return tree;
}

function extendedShortcutProcedureFixture(): Record<string, unknown> {
  const tree = procedureFixture();
  tree['formatVersion'] = '1.1.0';
  tree['id'] = 'snowman.eye.shortcut-surface.procedure';
  tree['title'] = 'Snowman eye shortcut surface procedure';
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  const track = (leaf?.['shortcutTracks'] as Array<Record<string, unknown>> | undefined)?.find(
    (candidate) => candidate['availability'] === 'available',
  );
  if (track === undefined) throw new Error('Expected available shortcut track fixture');
  track['operations'] = [
    {
      kind: 'key_input',
      id: 'shortcut.add_sphere',
      order: 1,
      keyMode: 'chord',
      semanticRefs: ['semantic.create'],
      description: 'Add a UV Sphere.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['SHIFT', 'A'],
      selectionPath: ['Mesh', 'UV Sphere'],
      parameters: {},
    },
    {
      kind: 'key_input',
      id: 'shortcut.open_adjust_last',
      order: 2,
      keyMode: 'sequence',
      semanticRefs: ['semantic.create'],
      description: 'Open Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['F9'],
      parameters: {},
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: 'shortcut.add_sphere',
        expectedOperatorId: 'mesh.primitive_uv_sphere_add',
      },
    },
    {
      kind: 'operator_property_update',
      id: 'shortcut.set_segments',
      order: 3,
      semanticRefs: ['semantic.create'],
      description: 'Set Segments.',
      evidenceRefs: ['evidence.prompt'],
      surfaceOperationId: 'shortcut.open_adjust_last',
      target: { kind: 'control', hostId: 'mesh.primitive_uv_sphere_add.segments' },
      path: ['Adjust Last Operation', 'Segments'],
      parameters: { value: 32 },
    },
    {
      kind: 'key_input',
      id: 'shortcut.close_adjust_last',
      order: 4,
      keyMode: 'sequence',
      semanticRefs: ['semantic.create'],
      description: 'Close Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['ENTER'],
      parameters: {},
      closesSurfaceOperationId: 'shortcut.open_adjust_last',
    },
    {
      kind: 'key_input',
      id: 'shortcut.move',
      order: 5,
      keyMode: 'sequence',
      semanticRefs: ['semantic.transform'],
      description: 'Move the sphere.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['G', 'X'],
      parameters: { value: 0.32, confirm: 'ENTER' },
    },
    {
      kind: 'key_input',
      id: 'shortcut.rename',
      order: 6,
      keyMode: 'sequence',
      semanticRefs: ['semantic.rename'],
      description: 'Rename the sphere.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['F2'],
      parameters: { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
    },
  ];
  return tree;
}

function authoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = procedureFixture();
  tree['adapterId'] = packet.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.${modality}.unavailable`,
          availability: 'unavailable',
          title: `${modality} grounding pending`,
          reason: 'A deterministic grounding stage has not materialized this track.',
          modality,
        },
      ];
    }
  }
  const source = packet.context.goalProvenance.source;
  const evidence = { ...packet.context.goalProvenance.evidence, sourceId: source.id };
  (tree['sources'] as Array<Record<string, unknown>>).push(source);
  (tree['evidence'] as Array<Record<string, unknown>>).push(evidence);
  return tree;
}

function replayAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['id'] === 'snowman.head.eyes.left',
  );
  if (leaf === undefined) throw new Error('Expected one UV Sphere replay leaf');
  const action = leaf['action'] as { arguments: Record<string, unknown> };
  leaf['expectedObservations'] = [
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
  return tree;
}

function icosphereAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Icosphere authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_icosphere',
    arguments: {
      resourceId: 'tutorial.icosphere.detail',
      objectName: 'OperatingLine.IcosphereDetail',
      subdivisions: 3,
      radius: 1.75,
      location: [-1.25, 2.5, 0.75],
    },
  };
  leaf['title'] = 'Create and configure one detailed Icosphere';
  leaf['intent'] = 'Create a named Icosphere with exact subdivisions, radius, and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_icosphere',
    description: 'Create one detailed Icosphere.',
    parameters: { subdivisions: 3, radius: 1.75 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Icosphere at its exact world location.',
    parameters: { location: [-1.25, 2.5, 0.75] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Icosphere object.',
    parameters: { name: 'OperatingLine.IcosphereDetail' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [-1.25, 2.5, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_ico_sphere_add',
      menuPath: ['Add', 'Mesh', 'Ico Sphere'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.icosphere.detail' },
  };
  return tree;
}

function icosphereReplayAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = icosphereAuthoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Icosphere replay leaf');
  const action = leaf['action'] as { arguments: Record<string, unknown> };
  leaf['expectedObservations'] = [
    {
      kind: 'icosphere_ready',
      parameters: {
        resourceId: action.arguments['resourceId'],
        objectName: action.arguments['objectName'],
        subdivisions: action.arguments['subdivisions'],
        radius: action.arguments['radius'],
        location: action.arguments['location'],
      },
    },
  ];
  return tree;
}

function subdivideAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Subdivide authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_subdivide',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.subdivided.mesh',
      resultMeshName: 'OperatingLine.Cube.Subdivided',
      cuts: 2,
      smooth: 0.25,
    },
  };
  leaf['title'] = 'Subdivide the accepted Cube in Edit Mode';
  leaf['intent'] = 'Subdivide every visible edge with two cuts and 0.25 smoothing.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'subdivide_mesh',
    description: 'Subdivide every visible edge of the accepted Cube.',
    parameters: { cuts: 2, smooth: 0.25 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Subdivided' },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.subdivide' },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.cube.subdivided.mesh' },
  };
  return tree;
}

function subdivisionSurfaceAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) {
    throw new Error('Expected one Subdivision Surface authoring candidate leaf');
  }
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
  leaf['title'] = 'Add a bounded Subdivision Surface modifier';
  leaf['intent'] = 'Add a managed Subdivision Surface modifier with viewport level three.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'add_subdivision_surface_modifier',
    description: 'Add one Subdivision Surface modifier to the accepted Cube.',
    parameters: { viewportLevel: 3 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Track the managed modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
    },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.subdivision_surface',
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    kind: 'modifier_ready',
    parameters: { modifierId: 'tutorial.cube.subdivision_surface' },
  };
  return tree;
}

function mirrorAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Mirror authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.modifier.add_mirror',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.mirror',
      modifierName: 'OperatingLine.Cube.Mirror',
      axis: 'Y',
    },
  };
  leaf['title'] = 'Add a bounded Mirror modifier';
  leaf['intent'] = 'Add a managed Mirror modifier on the local Y axis.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'add_mirror_modifier',
    description: 'Add one Mirror modifier to the accepted Cube.',
    parameters: { axis: 'Y' },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active Object Mode modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Track the managed Mirror modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.mirror',
      modifierName: 'OperatingLine.Cube.Mirror',
    },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.mirror',
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    kind: 'modifier_ready',
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.mirror',
      modifierType: 'MIRROR',
      axis: 'Y',
    },
  };
  return tree;
}

function editBevelAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Edit Mode Bevel candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_bevel_edges',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.beveled.mesh',
      resultMeshName: 'OperatingLine.Cube.Beveled',
      width: 0.2,
      segments: 3,
      profile: 0.6,
    },
  };
  leaf['title'] = 'Bevel every edge of the accepted Cube in Edit Mode';
  leaf['intent'] = 'Bevel every Cube edge with exact width, segments, and profile.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'bevel_mesh_edges',
    description: 'Bevel every edge of the accepted Cube.',
    parameters: { width: 0.2, segments: 3, profile: 0.6 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Beveled' },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.bevel' },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    kind: 'mesh_edges_beveled',
    parameters: { resourceId: 'tutorial.cube.beveled.mesh' },
  };
  return tree;
}

function editInsetAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Edit Mode Inset candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_inset_faces',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.inset.mesh',
      resultMeshName: 'OperatingLine.Cube.Inset',
      thickness: 0.2,
      depth: 0.1,
    },
  };
  leaf['title'] = 'Inset every face of the accepted Cube individually in Edit Mode';
  leaf['intent'] = 'Inset every Cube face individually with exact thickness and depth.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'inset_mesh_faces',
    description: 'Inset every face of the accepted Cube individually.',
    parameters: { thickness: 0.2, depth: 0.1, individual: true },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Inset' },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.inset' },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    kind: 'mesh_faces_inset',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.inset.mesh',
    },
  };
  return tree;
}

function editPokeAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Edit Mode Poke candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_poke_faces',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.poked.mesh',
      resultMeshName: 'OperatingLine.Cube.Poked',
      offset: 0.2,
    },
  };
  leaf['title'] = 'Poke every face of the accepted Cube in Edit Mode';
  leaf['intent'] = 'Poke every Cube face with the exact offset.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'poke_mesh_faces',
    description: 'Poke every face of the accepted Cube.',
    parameters: { offset: 0.2 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Poked' },
  };
  leaf['anchors'] = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.poke' },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    kind: 'mesh_faces_poked',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.poked.mesh',
    },
  };
  return tree;
}

function cubeAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Cube authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_cube',
    arguments: {
      resourceId: 'tutorial.cube.body',
      objectName: 'OperatingLine.CubeBody',
      size: 2.5,
      location: [-1, 2, 0.5],
    },
  };
  leaf['title'] = 'Create and configure one Cube body';
  leaf['intent'] = 'Create a named Cube with exact size and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_cube',
    description: 'Create one Cube body.',
    parameters: { size: 2.5 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Cube at its exact world location.',
    parameters: { location: [-1, 2, 0.5] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Cube object.',
    parameters: { name: 'OperatingLine.CubeBody' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [-1, 2, 0.5] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cube_add',
      menuPath: ['Add', 'Mesh', 'Cube'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.cube.body' },
  };
  return tree;
}

function planeAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Plane authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_plane',
    arguments: {
      resourceId: 'tutorial.plane.ground',
      objectName: 'OperatingLine.GroundPlane',
      size: 12.5,
      location: [0, 0, -1.25],
    },
  };
  leaf['title'] = 'Create and configure one ground Plane';
  leaf['intent'] = 'Create a named ground Plane with exact size and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_plane',
    description: 'Create one ground Plane.',
    parameters: { size: 12.5 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Plane at its exact world location.',
    parameters: { location: [0, 0, -1.25] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Plane object.',
    parameters: { name: 'OperatingLine.GroundPlane' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [0, 0, -1.25] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_plane_add',
      menuPath: ['Add', 'Mesh', 'Plane'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.plane.ground' },
  };
  return tree;
}

function primitiveReplayAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
  primitive: 'cube' | 'plane' | 'torus' | 'cone' | 'cylinder',
): Record<string, unknown> {
  const tree =
    primitive === 'cube'
      ? cubeAuthoringCandidateFixture(packet)
      : primitive === 'plane'
        ? planeAuthoringCandidateFixture(packet)
        : primitive === 'torus'
          ? torusAuthoringCandidateFixture(packet)
          : primitive === 'cone'
            ? coneAuthoringCandidateFixture(packet)
            : cylinderAuthoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error(`Expected one ${primitive} replay leaf`);
  const action = leaf['action'] as { arguments: Record<string, unknown> };
  const parameters =
    primitive === 'torus'
      ? {
          resourceId: action.arguments['resourceId'],
          objectName: action.arguments['objectName'],
          majorSegments: action.arguments['majorSegments'],
          minorSegments: action.arguments['minorSegments'],
          majorRadius: action.arguments['majorRadius'],
          minorRadius: action.arguments['minorRadius'],
          location: action.arguments['location'],
        }
      : primitive === 'cone'
        ? {
            resourceId: action.arguments['resourceId'],
            objectName: action.arguments['objectName'],
            radiusStart: action.arguments['radiusStart'],
            radiusEnd: action.arguments['radiusEnd'],
            start: action.arguments['start'],
            end: action.arguments['end'],
          }
        : primitive === 'cylinder'
          ? {
              resourceId: action.arguments['resourceId'],
              objectName: action.arguments['objectName'],
              radius: action.arguments['radius'],
              start: action.arguments['start'],
              end: action.arguments['end'],
            }
          : {
              resourceId: action.arguments['resourceId'],
              objectName: action.arguments['objectName'],
              size: action.arguments['size'],
              location: action.arguments['location'],
            };
  leaf['expectedObservations'] = [
    {
      kind:
        primitive === 'cube'
          ? 'cube_ready'
          : primitive === 'plane'
            ? 'plane_ready'
            : primitive === 'torus'
              ? 'torus_ready'
              : primitive === 'cone'
                ? 'cone_ready'
                : 'cylinder_ready',
      parameters,
    },
  ];
  return tree;
}

function torusAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Torus authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_torus',
    arguments: {
      resourceId: 'tutorial.torus.detail',
      objectName: 'OperatingLine.DetailTorus',
      majorSegments: 48,
      minorSegments: 12,
      majorRadius: 2.25,
      minorRadius: 0.4,
      location: [1.5, -2, 0.75],
    },
  };
  leaf['title'] = 'Create and configure one detailed Torus';
  leaf['intent'] = 'Create a named Torus with exact segments, radii, and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_torus',
    description: 'Create one detailed Torus.',
    parameters: {
      majorSegments: 48,
      minorSegments: 12,
      majorRadius: 2.25,
      minorRadius: 0.4,
    },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Torus at its exact world location.',
    parameters: { location: [1.5, -2, 0.75] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Torus object.',
    parameters: { name: 'OperatingLine.DetailTorus' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [1.5, -2, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_torus_add',
      menuPath: ['Add', 'Mesh', 'Torus'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.torus.detail' },
  };
  return tree;
}

function coneAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Cone authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_cone',
    arguments: {
      resourceId: 'tutorial.cone.detail',
      objectName: 'OperatingLine.DetailCone',
      radiusStart: 1.25,
      radiusEnd: 0.25,
      start: [1, 2, 3],
      end: [4, 6, 3],
    },
  };
  leaf['title'] = 'Create and configure one detailed Cone';
  leaf['intent'] = 'Create a named Cone between exact endpoints with exact endpoint radii.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_cone',
    description: 'Create one detailed Cone.',
    parameters: { radiusStart: 1.25, radiusEnd: 0.25 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place and orient the Cone between its exact endpoints.',
    parameters: { start: [1, 2, 3], end: [4, 6, 3] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Cone object.',
    parameters: { name: 'OperatingLine.DetailCone' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [2.5, 4, 3] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cone_add',
      menuPath: ['Add', 'Mesh', 'Cone'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.cone.detail' },
  };
  return tree;
}

function cylinderAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Cylinder authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_cylinder',
    arguments: {
      resourceId: 'tutorial.cylinder.detail',
      objectName: 'OperatingLine.DetailCylinder',
      radius: 0.75,
      start: [1, 2, 3],
      end: [4, 6, 3],
    },
  };
  leaf['title'] = 'Create and configure one detailed Cylinder';
  leaf['intent'] = 'Create a named Cylinder between exact endpoints with an exact radius.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_cylinder',
    description: 'Create one detailed Cylinder.',
    parameters: { radius: 0.75 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place and orient the Cylinder between its exact endpoints.',
    parameters: { start: [1, 2, 3], end: [4, 6, 3] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Cylinder object.',
    parameters: { name: 'OperatingLine.DetailCylinder' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [2.5, 4, 3] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cylinder_add',
      menuPath: ['Add', 'Mesh', 'Cylinder'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.cylinder.detail' },
  };
  return tree;
}

describe('procedure compilation runtime', () => {
  it('builds one provider-neutral candidate authoring packet without side effects', async () => {
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.12.0',
    );
    const unavailableLegacyInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.9.0',
    );
    const legacyMaterializingInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.10.0',
    );
    const orderedMenuInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.11.0',
    );
    const shortcutInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.12.0',
    );
    const icosphereInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.13.0',
    );
    const cubeInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.14.0',
    );
    const planeInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.15.0',
    );
    const torusInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.16.0',
    );
    const coneInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.17.0',
    );
    const cylinderInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.18.0',
    );
    const cubeShortcutInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.19.0',
    );
    const planeShortcutInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.20.0',
    );
    if (unavailableLegacyInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.9.0 snapshot');
    }
    if (historicalActionCatalog === undefined) {
      throw new Error('Expected the immutable Blender ActionCatalog 1.12.0 snapshot');
    }
    if (legacyMaterializingInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.10.0 snapshot');
    }
    if (orderedMenuInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.11.0 snapshot');
    }
    if (shortcutInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.12.0 snapshot');
    }
    if (icosphereInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.13.0 snapshot');
    }
    if (cubeInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.14.0 snapshot');
    }
    if (planeInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.15.0 snapshot');
    }
    if (torusInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.16.0 snapshot');
    }
    if (coneInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.17.0 snapshot');
    }
    if (cylinderInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.18.0 snapshot');
    }
    if (cubeShortcutInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.19.0 snapshot');
    }
    if (planeShortcutInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.20.0 snapshot');
    }
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: [
        unavailableLegacyInteractionCatalog,
        legacyMaterializingInteractionCatalog,
        orderedMenuInteractionCatalog,
        shortcutInteractionCatalog,
        icosphereInteractionCatalog,
        cubeInteractionCatalog,
        planeInteractionCatalog,
        torusInteractionCatalog,
        coneInteractionCatalog,
        cylinderInteractionCatalog,
        cubeShortcutInteractionCatalog,
        planeShortcutInteractionCatalog,
        blenderInteractionCatalog,
      ],
    });
    try {
      const request = {
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        goal: '制作雪人的头部，并创建、定位、缩放和命名左眼球体。',
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        locale: 'zh-CN',
      };
      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.prompt.get', request);
      expect(mcp.result?.isError).not.toBe(true);
      const packet = procedureAuthoringPromptPacketSchema.parse(mcp.result?.structuredContent);
      expect(packet).toMatchObject({
        context: {
          requestedTreeId: request.treeId,
          recommendedRevision: 1,
          goalProvenance: {
            source: {
              id: 'source.snowman.eye.left.procedure.revision.1.goal',
              text: request.goal,
            },
            evidence: {
              id: 'evidence.snowman.eye.left.procedure.revision.1.goal',
            },
          },
          catalogBinding: {
            adapterId: 'blender',
            actionCatalog: { catalogVersion: blenderActionCatalog.catalogVersion },
            interactionCatalog: { catalogVersion: blenderInteractionCatalog.catalogVersion },
          },
          constraints: { allInteractionTracksUnavailable: true },
        },
        retrieval: {
          toolName: 'operatingline.procedure.search',
          matching: 'exact_structured_filters',
          similarityScoreProduced: false,
        },
        workflow: {
          validationToolName: 'operatingline.procedure.authoring.validate',
          compileToolName: 'operatingline.procedure.compile',
        },
        sideEffects: {
          modelCalled: false,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });
      expect(packet).not.toHaveProperty('renderedPrompt');
      expect(JSON.parse(mcp.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        packetContentSha256: packet.integrity.contentSha256,
      });
      expect(packet.integrity.contentSha256).toBe(
        computeProcedureAuthoringPromptPacketContentSha256(
          procedureAuthoringPromptPacketContent(packet),
        ),
      );
      expect(canonicalizeProtocolJsonValue(packet).byteLength).toBeLessThanOrEqual(
        procedureAuthoringPromptPacketMaxCanonicalBytes,
      );

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toEqual(packet);

      const candidate = authoringCandidateFixture(packet);
      const candidateLeaf = (candidate['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['id'] === 'snowman.head.eyes.left',
      );
      if (candidateLeaf === undefined) throw new Error('Expected one authoring candidate leaf');
      const semanticOperations = candidateLeaf['semanticOperations'] as Array<
        Record<string, unknown>
      >;
      semanticOperations[1]!['parameters'] = {
        location: [9, 9, 9],
        scale: [8, 8, 8],
      };
      semanticOperations[2]!['parameters'] = { name: 'Forged.Semantic.Name' };
      const validated = await callMcpTool(
        runtime,
        2,
        'operatingline.procedure.authoring.validate',
        { packet, tree: candidate },
      );
      expect(validated.result?.isError).not.toBe(true);
      const validationResult = JSON.parse(validated.result?.content?.[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      expect(validationResult).toMatchObject({
        packetContentSha256: packet.integrity.contentSha256,
        validation: {
          packetIntegrity: 'validated',
          installedCatalogBinding: 'validated',
          authoringCandidateContract: 'validated',
          procedureCompilation: 'validated',
        },
        compilation: {
          procedureTreeId: request.treeId,
          procedureTreeRevision: 1,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(validated.result?.structuredContent).toEqual(validationResult);

      const httpValidation = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet, tree: candidate }),
      });
      expect(httpValidation.status).toBe(200);
      await expect(httpValidation.json()).resolves.toEqual(validationResult);

      const materializedMcp = await callMcpTool(
        runtime,
        3,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: candidate },
      );
      expect(materializedMcp.result?.isError).not.toBe(true);
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      expect(materialization).toMatchObject({
        formatVersion: '1.4.0',
        packetContentSha256: packet.integrity.contentSha256,
        catalogBinding: {
          adapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_uv_sphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'materialized',
          },
        ],
        validation: {
          packetIntegrity: 'validated',
          installedCatalogBinding: 'validated',
          authoringCandidateContract: 'validated',
          procedureCompilation: 'validated',
          interactionGrounding: 'validated_against_installed_interaction_catalog',
        },
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(materializedMcp.result?.content?.[0]?.text).toBe(JSON.stringify(materialization));
      const materializedLeaf = materialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      expect(materializedLeaf?.kind).toBe('leaf');
      if (materializedLeaf?.kind !== 'leaf' || materializedLeaf.action === null) {
        throw new Error('Expected one materialized executable leaf');
      }
      const menuTrack = materializedLeaf.menuTracks[0]!;
      expect(menuTrack.availability).toBe('available');
      if (menuTrack.availability !== 'available') {
        throw new Error('Expected one catalog-grounded menu track');
      }
      expect(menuTrack.operations.map((operation) => operation.path)).toEqual([
        ['Layout'],
        ['Layout', 'Add'],
        ['Layout', 'Add', 'Mesh'],
        ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        ['Sidebar', 'Item', 'Transform', 'Location'],
        ['Sidebar', 'Item', 'Transform', 'Scale'],
        ['Outliner', 'Object Name'],
      ]);
      expect(menuTrack.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { radius: 1 },
        { value: [0.32, -0.86, 2.14] },
        { value: [0.12, 0.12, 0.12] },
        { value: 'OperatingLine.EyeLeft' },
      ]);
      expect(
        menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(materializedLeaf.action.arguments['resourceId']).toBe('snowman.eye.left');
      expect(materializedLeaf.semanticOperations[1]!.parameters).toEqual({
        location: [0.32, -0.86, 2.14],
        scale: [0.12, 0.12, 0.12],
      });
      expect(materializedLeaf.semanticOperations[2]!.parameters).toEqual({
        name: 'OperatingLine.EyeLeft',
      });
      const shortcutTrack = materializedLeaf.shortcutTracks[0];
      if (shortcutTrack?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded shortcut track');
      }
      expect(
        shortcutTrack.operations.map(({ keyMode, keys, selectionPath, parameters }) => ({
          keyMode,
          keys,
          selectionPath,
          parameters,
        })),
      ).toEqual([
        {
          keyMode: 'chord',
          keys: ['SHIFT', 'A'],
          selectionPath: ['Mesh', 'UV Sphere'],
          parameters: { radius: 1, location: [0, 0, 0] },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'X'],
          selectionPath: undefined,
          parameters: { value: 0.32, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'Y'],
          selectionPath: undefined,
          parameters: { value: -0.86, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'Z'],
          selectionPath: undefined,
          parameters: { value: 2.14, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['S'],
          selectionPath: undefined,
          parameters: { value: 0.12, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['F2'],
          selectionPath: undefined,
          parameters: { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
        },
      ]);
      expect(materializedLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'available',
          modality: 'mcp',
          operations: [
            expect.objectContaining({
              serverName: 'operating-line',
              toolName: 'operatingline.blender.action.execute',
              arguments: {
                formatVersion: '1.0.0',
                requestId: '$runtime.requestId',
                replayId: '$runtime.replayId',
                expectedState: '$runtime.expectedState',
              },
              argumentSource: 'accepted_leaf_action',
              actionArguments: materializedLeaf.action?.arguments,
              resultBinding: 'snowman.head.eyes.left.companion_state_report',
            }),
          ],
        }),
      ]);
      expect(materializedLeaf.validation).toMatchObject({
        status: 'candidate',
        validatedHostVersions: [],
      });

      const httpMaterialization = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: candidate }),
        },
      );
      expect(httpMaterialization.status).toBe(200);
      await expect(httpMaterialization.json()).resolves.toEqual(materialization);

      const icosphereMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 11, 'operatingline.procedure.authoring.materialize', {
            packet,
            tree: icosphereAuthoringCandidateFixture(packet),
          })
        ).result?.structuredContent,
      );
      expect(icosphereMaterialization).toMatchObject({
        formatVersion: '1.4.0',
        catalogBinding: {
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_icosphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'materialized',
          },
        ],
      });
      const icosphereLeaf = icosphereMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (icosphereLeaf?.kind !== 'leaf' || icosphereLeaf.action === null) {
        throw new Error('Expected one materialized Icosphere leaf');
      }
      expect(icosphereMaterialization.tree.formatVersion).toBe('1.1.0');
      const icosphereMenu = icosphereLeaf.menuTracks[0];
      if (icosphereMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Icosphere menu track');
      }
      expect(icosphereMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { subdivisions: 3, radius: 1.75 },
        { value: [-1.25, 2.5, 0.75] },
        { value: 'OperatingLine.IcosphereDetail' },
      ]);
      expect(
        icosphereMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      const icosphereShortcut = icosphereLeaf.shortcutTracks[0];
      if (icosphereShortcut?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Icosphere shortcut track');
      }
      expect(
        icosphereShortcut.operations.map((operation) =>
          operation.kind === 'operator_property_update'
            ? {
                kind: operation.kind,
                id: operation.id,
                order: operation.order,
                surfaceOperationId: operation.surfaceOperationId,
                target: operation.target,
                path: operation.path,
                parameters: operation.parameters,
              }
            : {
                kind: operation.kind,
                id: operation.id,
                order: operation.order,
                keyMode: operation.keyMode,
                keys: operation.keys,
                selectionPath: operation.selectionPath,
                parameters: operation.parameters,
                opensSurface: operation.opensSurface,
                closesSurfaceOperationId: operation.closesSurfaceOperationId,
              },
        ),
      ).toEqual([
        {
          kind: 'key_input',
          id: 'shortcut.add_icosphere',
          order: 1,
          keyMode: 'chord',
          keys: ['SHIFT', 'A'],
          selectionPath: ['Mesh', 'Ico Sphere'],
          parameters: {},
          opensSurface: undefined,
          closesSurfaceOperationId: undefined,
        },
        {
          kind: 'key_input',
          id: 'shortcut.open_adjust_last_operation',
          order: 2,
          keyMode: 'sequence',
          keys: ['F9'],
          selectionPath: undefined,
          parameters: {},
          opensSurface: {
            kind: 'adjust_last_operation',
            hostId: 'screen.redo_last',
            sourceOperationId: 'shortcut.add_icosphere',
            expectedOperatorId: 'mesh.primitive_ico_sphere_add',
          },
          closesSurfaceOperationId: undefined,
        },
        {
          kind: 'operator_property_update',
          id: 'shortcut.set_subdivisions',
          order: 3,
          surfaceOperationId: 'shortcut.open_adjust_last_operation',
          target: {
            kind: 'control',
            hostId: 'mesh.primitive_ico_sphere_add.subdivisions',
          },
          path: ['Adjust Last Operation', 'Subdivisions'],
          parameters: { value: 3 },
        },
        {
          kind: 'operator_property_update',
          id: 'shortcut.set_radius',
          order: 4,
          surfaceOperationId: 'shortcut.open_adjust_last_operation',
          target: { kind: 'control', hostId: 'mesh.primitive_ico_sphere_add.radius' },
          path: ['Adjust Last Operation', 'Radius'],
          parameters: { value: 1.75 },
        },
        {
          kind: 'key_input',
          id: 'shortcut.close_adjust_last_operation',
          order: 5,
          keyMode: 'sequence',
          keys: ['ENTER'],
          selectionPath: undefined,
          parameters: {},
          opensSurface: undefined,
          closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
        },
        ...(['X', 'Y', 'Z'] as const).map((axis, index) => ({
          kind: 'key_input' as const,
          id: `shortcut.move_${axis.toLowerCase()}`,
          order: index + 6,
          keyMode: 'sequence' as const,
          keys: ['G', axis, 'VALUE', 'ENTER'],
          selectionPath: undefined,
          parameters: { value: [-1.25, 2.5, 0.75][index] },
          opensSurface: undefined,
          closesSurfaceOperationId: undefined,
        })),
        {
          kind: 'key_input',
          id: 'shortcut.rename',
          order: 9,
          keyMode: 'sequence',
          keys: ['F2', 'VALUE', 'ENTER'],
          selectionPath: undefined,
          parameters: { value: 'OperatingLine.IcosphereDetail' },
          opensSurface: undefined,
          closesSurfaceOperationId: undefined,
        },
      ]);
      expect(
        icosphereShortcut.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(icosphereLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'available',
          modality: 'mcp',
          operations: [
            expect.objectContaining({
              serverName: 'operating-line',
              toolName: 'operatingline.blender.action.execute',
              arguments: {
                formatVersion: '1.0.0',
                requestId: '$runtime.requestId',
                replayId: '$runtime.replayId',
                expectedState: '$runtime.expectedState',
              },
              argumentSource: 'accepted_leaf_action',
              actionArguments: icosphereLeaf.action.arguments,
              resultBinding: 'snowman.head.eyes.left.companion_state_report',
            }),
          ],
        }),
      ]);
      const icosphereHttpMaterialization = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            packet,
            tree: icosphereAuthoringCandidateFixture(packet),
          }),
        },
      );
      expect(icosphereHttpMaterialization.status).toBe(200);
      await expect(icosphereHttpMaterialization.json()).resolves.toEqual(icosphereMaterialization);

      const cubePrompt = await callMcpTool(runtime, 14, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: cubeInteractionCatalog.catalogVersion,
      });
      const cubePacket = procedureAuthoringPromptPacketSchema.parse(
        cubePrompt.result?.structuredContent,
      );
      const cubeMcp = await callMcpTool(
        runtime,
        18,
        'operatingline.procedure.authoring.materialize',
        { packet: cubePacket, tree: cubeAuthoringCandidateFixture(cubePacket) },
      );
      expect(cubeMcp.result?.isError).not.toBe(true);
      const cubeMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        cubeMcp.result?.structuredContent,
      );
      expect(cubeMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.14.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cube.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const cubeLeaf = cubeMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (cubeLeaf?.kind !== 'leaf' || cubeLeaf.action === null) {
        throw new Error('Expected one materialized Cube leaf');
      }
      const cubeMenu = cubeLeaf.menuTracks[0];
      if (cubeMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Cube menu track');
      }
      expect(cubeMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 2.5 },
        { value: [-1, 2, 0.5] },
        { value: 'OperatingLine.CubeBody' },
      ]);
      expect(
        cubeMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(cubeLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.cube.body',
        objectName: 'OperatingLine.CubeBody',
        size: 2.5,
        location: [-1, 2, 0.5],
      });
      expect(cubeLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(cubeLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(cubeMcp.result?.content?.[0]?.text).toBe(JSON.stringify(cubeMaterialization));
      const cubeHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packet: cubePacket,
          tree: cubeAuthoringCandidateFixture(cubePacket),
        }),
      });
      expect(cubeHttp.status).toBe(200);
      await expect(cubeHttp.json()).resolves.toEqual(cubeMaterialization);

      const historicalPlane = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 19, 'operatingline.procedure.authoring.materialize', {
            packet: cubePacket,
            tree: planeAuthoringCandidateFixture(cubePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalPlane).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.14.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const planePrompt = await callMcpTool(runtime, 20, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: planeInteractionCatalog.catalogVersion,
      });
      const planePacket = procedureAuthoringPromptPacketSchema.parse(
        planePrompt.result?.structuredContent,
      );
      const planeMcp = await callMcpTool(
        runtime,
        21,
        'operatingline.procedure.authoring.materialize',
        { packet: planePacket, tree: planeAuthoringCandidateFixture(planePacket) },
      );
      expect(planeMcp.result?.isError).not.toBe(true);
      const planeMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        planeMcp.result?.structuredContent,
      );
      expect(planeMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.15.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const planeLeaf = planeMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (planeLeaf?.kind !== 'leaf' || planeLeaf.action === null) {
        throw new Error('Expected one materialized Plane leaf');
      }
      const planeMenu = planeLeaf.menuTracks[0];
      if (planeMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Plane menu track');
      }
      expect(planeMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 12.5 },
        { value: [0, 0, -1.25] },
        { value: 'OperatingLine.GroundPlane' },
      ]);
      expect(
        planeMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(planeLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.plane.ground',
        objectName: 'OperatingLine.GroundPlane',
        size: 12.5,
        location: [0, 0, -1.25],
      });
      expect(planeLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(planeLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(planeMcp.result?.content?.[0]?.text).toBe(JSON.stringify(planeMaterialization));
      const planeHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packet: planePacket,
          tree: planeAuthoringCandidateFixture(planePacket),
        }),
      });
      expect(planeHttp.status).toBe(200);
      await expect(planeHttp.json()).resolves.toEqual(planeMaterialization);

      const historicalTorus = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 22, 'operatingline.procedure.authoring.materialize', {
            packet: planePacket,
            tree: torusAuthoringCandidateFixture(planePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalTorus).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.15.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_torus.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const torusPrompt = await callMcpTool(runtime, 23, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: torusInteractionCatalog.catalogVersion,
      });
      const torusPacket = procedureAuthoringPromptPacketSchema.parse(
        torusPrompt.result?.structuredContent,
      );
      const torusMcp = await callMcpTool(
        runtime,
        24,
        'operatingline.procedure.authoring.materialize',
        { packet: torusPacket, tree: torusAuthoringCandidateFixture(torusPacket) },
      );
      expect(torusMcp.result?.isError).not.toBe(true);
      const torusMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        torusMcp.result?.structuredContent,
      );
      expect(torusMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.16.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_torus.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const torusLeaf = torusMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (torusLeaf?.kind !== 'leaf' || torusLeaf.action === null) {
        throw new Error('Expected one materialized Torus leaf');
      }
      const torusMenu = torusLeaf.menuTracks[0];
      if (torusMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Torus menu track');
      }
      expect(torusMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        {
          major_segments: 48,
          minor_segments: 12,
          mode: 'MAJOR_MINOR',
          major_radius: 2.25,
          minor_radius: 0.4,
        },
        { value: [1.5, -2, 0.75] },
        { value: 'OperatingLine.DetailTorus' },
      ]);
      expect(
        torusMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(torusLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.torus.detail',
        objectName: 'OperatingLine.DetailTorus',
        majorSegments: 48,
        minorSegments: 12,
        majorRadius: 2.25,
        minorRadius: 0.4,
        location: [1.5, -2, 0.75],
      });
      expect(torusLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(torusLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(torusMcp.result?.content?.[0]?.text).toBe(JSON.stringify(torusMaterialization));
      const torusHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packet: torusPacket,
          tree: torusAuthoringCandidateFixture(torusPacket),
        }),
      });
      expect(torusHttp.status).toBe(200);
      await expect(torusHttp.json()).resolves.toEqual(torusMaterialization);

      const historicalCone = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 25, 'operatingline.procedure.authoring.materialize', {
            packet: torusPacket,
            tree: coneAuthoringCandidateFixture(torusPacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalCone).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.16.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cone.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const conePrompt = await callMcpTool(runtime, 26, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: coneInteractionCatalog.catalogVersion,
      });
      const conePacket = procedureAuthoringPromptPacketSchema.parse(
        conePrompt.result?.structuredContent,
      );
      const coneMcp = await callMcpTool(
        runtime,
        27,
        'operatingline.procedure.authoring.materialize',
        { packet: conePacket, tree: coneAuthoringCandidateFixture(conePacket) },
      );
      expect(coneMcp.result?.isError).not.toBe(true);
      const coneMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        coneMcp.result?.structuredContent,
      );
      expect(coneMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.17.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cone.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const coneLeaf = coneMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (coneLeaf?.kind !== 'leaf' || coneLeaf.action === null) {
        throw new Error('Expected one materialized Cone leaf');
      }
      const coneMenu = coneLeaf.menuTracks[0];
      if (coneMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Cone menu track');
      }
      expect(coneMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        {
          vertices: 32,
          radius1: 1.25,
          radius2: 0.25,
          depth: 5,
          end_fill_type: 'NGON',
          calc_uvs: false,
          enter_editmode: false,
          align: 'WORLD',
          location: [0, 0, 0],
          rotation: [0, Math.PI / 2, Math.atan2(4, 3)],
          scale: [1, 1, 1],
        },
        { value: [2.5, 4, 3] },
        { value: 'OperatingLine.DetailCone' },
      ]);
      expect(Object.keys(coneMenu.operations[3]!.parameters)).toEqual([
        'vertices',
        'radius1',
        'radius2',
        'depth',
        'end_fill_type',
        'calc_uvs',
        'enter_editmode',
        'align',
        'location',
        'rotation',
        'scale',
      ]);
      expect(
        coneMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(coneLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.cone.detail',
        objectName: 'OperatingLine.DetailCone',
        radiusStart: 1.25,
        radiusEnd: 0.25,
        start: [1, 2, 3],
        end: [4, 6, 3],
      });
      expect(coneLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(coneLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(coneMcp.result?.content?.[0]?.text).toBe(JSON.stringify(coneMaterialization));
      const coneHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packet: conePacket,
          tree: coneAuthoringCandidateFixture(conePacket),
        }),
      });
      expect(coneHttp.status).toBe(200);
      await expect(coneHttp.json()).resolves.toEqual(coneMaterialization);

      const historicalCylinder = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 28, 'operatingline.procedure.authoring.materialize', {
            packet: conePacket,
            tree: cylinderAuthoringCandidateFixture(conePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalCylinder).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.17.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cylinder.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const cylinderPrompt = await callMcpTool(runtime, 30, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: cylinderInteractionCatalog.catalogVersion,
      });
      const cylinderPacket = procedureAuthoringPromptPacketSchema.parse(
        cylinderPrompt.result?.structuredContent,
      );
      const cylinderMcp = await callMcpTool(
        runtime,
        31,
        'operatingline.procedure.authoring.materialize',
        { packet: cylinderPacket, tree: cylinderAuthoringCandidateFixture(cylinderPacket) },
      );
      expect(cylinderMcp.result?.isError).not.toBe(true);
      const cylinderMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        cylinderMcp.result?.structuredContent,
      );
      expect(cylinderMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.18.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cylinder.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const cylinderLeaf = cylinderMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (cylinderLeaf?.kind !== 'leaf' || cylinderLeaf.action === null) {
        throw new Error('Expected one materialized Cylinder leaf');
      }
      const cylinderMenu = cylinderLeaf.menuTracks[0];
      if (cylinderMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Cylinder menu track');
      }
      expect(cylinderMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        {
          vertices: 32,
          radius: 0.75,
          depth: 5,
          end_fill_type: 'NGON',
          calc_uvs: false,
          enter_editmode: false,
          align: 'WORLD',
          location: [0, 0, 0],
          rotation: [0, Math.PI / 2, Math.atan2(4, 3)],
          scale: [1, 1, 1],
        },
        { value: [2.5, 4, 3] },
        { value: 'OperatingLine.DetailCylinder' },
      ]);
      expect(Object.keys(cylinderMenu.operations[3]!.parameters)).toEqual([
        'vertices',
        'radius',
        'depth',
        'end_fill_type',
        'calc_uvs',
        'enter_editmode',
        'align',
        'location',
        'rotation',
        'scale',
      ]);
      expect(
        cylinderMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(cylinderLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.cylinder.detail',
        objectName: 'OperatingLine.DetailCylinder',
        radius: 0.75,
        start: [1, 2, 3],
        end: [4, 6, 3],
      });
      expect(cylinderLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(cylinderLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(cylinderMcp.result?.content?.[0]?.text).toBe(JSON.stringify(cylinderMaterialization));
      const cylinderHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            packet: cylinderPacket,
            tree: cylinderAuthoringCandidateFixture(cylinderPacket),
          }),
        },
      );
      expect(cylinderHttp.status).toBe(200);
      await expect(cylinderHttp.json()).resolves.toEqual(cylinderMaterialization);

      const cubeShortcutPrompt = await callMcpTool(
        runtime,
        32,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: cubeShortcutInteractionCatalog.catalogVersion,
        },
      );
      const cubeShortcutPacket = procedureAuthoringPromptPacketSchema.parse(
        cubeShortcutPrompt.result?.structuredContent,
      );
      const cubeShortcutMcp = await callMcpTool(
        runtime,
        33,
        'operatingline.procedure.authoring.materialize',
        {
          packet: cubeShortcutPacket,
          tree: cubeAuthoringCandidateFixture(cubeShortcutPacket),
        },
      );
      expect(cubeShortcutMcp.result?.isError).not.toBe(true);
      const cubeShortcutMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        cubeShortcutMcp.result?.structuredContent,
      );
      expect(cubeShortcutMaterialization).toMatchObject({
        formatVersion: '1.2.0',
        catalogBinding: { interactionCatalogVersion: '1.19.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cube.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      const cubeShortcutLeaf = cubeShortcutMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (cubeShortcutLeaf?.kind !== 'leaf' || cubeShortcutLeaf.action === null) {
        throw new Error('Expected one InteractionCatalog 1.19 materialized Cube leaf');
      }
      const cubeShortcutMenu = cubeShortcutLeaf.menuTracks[0];
      if (cubeShortcutMenu?.availability !== 'available') {
        throw new Error('Expected one InteractionCatalog 1.19 Cube menu track');
      }
      expect(cubeShortcutMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 2.5 },
        { value: [-1, 2, 0.5] },
        { value: 'OperatingLine.CubeBody' },
      ]);
      const cubeShortcutTrack = cubeShortcutLeaf.shortcutTracks[0];
      if (cubeShortcutTrack?.availability !== 'available') {
        throw new Error('Expected one InteractionCatalog 1.19 Cube shortcut track');
      }
      expect(
        cubeShortcutTrack.operations.map(
          ({ id, order, keyMode, keys, selectionPath, parameters }) => ({
            id,
            order,
            keyMode,
            keys,
            selectionPath,
            parameters,
          }),
        ),
      ).toEqual([
        {
          id: 'shortcut.add_cube',
          order: 1,
          keyMode: 'chord',
          keys: ['SHIFT', 'A'],
          selectionPath: ['Mesh', 'Cube'],
          parameters: { size: 2, location: [0, 0, 0] },
        },
        {
          id: 'shortcut.move_x',
          order: 2,
          keyMode: 'sequence',
          keys: ['G', 'X'],
          selectionPath: undefined,
          parameters: { value: -1, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.move_y',
          order: 3,
          keyMode: 'sequence',
          keys: ['G', 'Y'],
          selectionPath: undefined,
          parameters: { value: 2, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.move_z',
          order: 4,
          keyMode: 'sequence',
          keys: ['G', 'Z'],
          selectionPath: undefined,
          parameters: { value: 0.5, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.scale',
          order: 5,
          keyMode: 'sequence',
          keys: ['S'],
          selectionPath: undefined,
          parameters: { value: 1.25, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.rename',
          order: 6,
          keyMode: 'sequence',
          keys: ['F2'],
          selectionPath: undefined,
          parameters: { text: 'OperatingLine.CubeBody', confirm: 'ENTER' },
        },
      ]);
      expect(
        cubeShortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(cubeShortcutLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(cubeShortcutMcp.result?.content?.[0]?.text).toBe(
        JSON.stringify(cubeShortcutMaterialization),
      );
      const cubeShortcutHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            packet: cubeShortcutPacket,
            tree: cubeAuthoringCandidateFixture(cubeShortcutPacket),
          }),
        },
      );
      expect(cubeShortcutHttp.status).toBe(200);
      await expect(cubeShortcutHttp.json()).resolves.toEqual(cubeShortcutMaterialization);

      const historicalPlaneShortcut = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 34, 'operatingline.procedure.authoring.materialize', {
            packet: cubeShortcutPacket,
            tree: planeAuthoringCandidateFixture(cubeShortcutPacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalPlaneShortcut).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.19.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const planeShortcutPrompt = await callMcpTool(
        runtime,
        35,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: planeShortcutInteractionCatalog.catalogVersion,
        },
      );
      const planeShortcutPacket = procedureAuthoringPromptPacketSchema.parse(
        planeShortcutPrompt.result?.structuredContent,
      );
      const planeShortcutMcp = await callMcpTool(
        runtime,
        36,
        'operatingline.procedure.authoring.materialize',
        {
          packet: planeShortcutPacket,
          tree: planeAuthoringCandidateFixture(planeShortcutPacket),
        },
      );
      expect(planeShortcutMcp.result?.isError).not.toBe(true);
      const planeShortcutMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        planeShortcutMcp.result?.structuredContent,
      );
      expect(planeShortcutMaterialization).toMatchObject({
        formatVersion: '1.2.0',
        catalogBinding: { interactionCatalogVersion: '1.20.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      const planeShortcutLeaf = planeShortcutMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (planeShortcutLeaf?.kind !== 'leaf' || planeShortcutLeaf.action === null) {
        throw new Error('Expected one InteractionCatalog 1.20 materialized Plane leaf');
      }
      const planeShortcutMenu = planeShortcutLeaf.menuTracks[0];
      if (planeShortcutMenu?.availability !== 'available') {
        throw new Error('Expected one InteractionCatalog 1.20 Plane menu track');
      }
      expect(planeShortcutMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 12.5 },
        { value: [0, 0, -1.25] },
        { value: 'OperatingLine.GroundPlane' },
      ]);
      const planeShortcutTrack = planeShortcutLeaf.shortcutTracks[0];
      if (planeShortcutTrack?.availability !== 'available') {
        throw new Error('Expected one InteractionCatalog 1.20 Plane shortcut track');
      }
      expect(
        planeShortcutTrack.operations.map(
          ({ id, order, keyMode, keys, selectionPath, parameters }) => ({
            id,
            order,
            keyMode,
            keys,
            selectionPath,
            parameters,
          }),
        ),
      ).toEqual([
        {
          id: 'shortcut.add_plane',
          order: 1,
          keyMode: 'chord',
          keys: ['SHIFT', 'A'],
          selectionPath: ['Mesh', 'Plane'],
          parameters: { size: 2, location: [0, 0, 0] },
        },
        {
          id: 'shortcut.move_x',
          order: 2,
          keyMode: 'sequence',
          keys: ['G', 'X'],
          selectionPath: undefined,
          parameters: { value: 0, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.move_y',
          order: 3,
          keyMode: 'sequence',
          keys: ['G', 'Y'],
          selectionPath: undefined,
          parameters: { value: 0, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.move_z',
          order: 4,
          keyMode: 'sequence',
          keys: ['G', 'Z'],
          selectionPath: undefined,
          parameters: { value: -1.25, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.scale',
          order: 5,
          keyMode: 'sequence',
          keys: ['S'],
          selectionPath: undefined,
          parameters: { value: 6.25, confirm: 'ENTER' },
        },
        {
          id: 'shortcut.rename',
          order: 6,
          keyMode: 'sequence',
          keys: ['F2'],
          selectionPath: undefined,
          parameters: { text: 'OperatingLine.GroundPlane', confirm: 'ENTER' },
        },
      ]);
      expect(
        planeShortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(planeShortcutLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(planeShortcutMcp.result?.content?.[0]?.text).toBe(
        JSON.stringify(planeShortcutMaterialization),
      );
      const planeShortcutHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            packet: planeShortcutPacket,
            tree: planeAuthoringCandidateFixture(planeShortcutPacket),
          }),
        },
      );
      expect(planeShortcutHttp.status).toBe(200);
      await expect(planeShortcutHttp.json()).resolves.toEqual(planeShortcutMaterialization);

      const frozenIcosphereMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 37, 'operatingline.procedure.authoring.materialize', {
            packet: planeShortcutPacket,
            tree: icosphereAuthoringCandidateFixture(planeShortcutPacket),
          })
        ).result?.structuredContent,
      );
      expect(frozenIcosphereMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.20.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_icosphere.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const icospherePrompt = await callMcpTool(runtime, 15, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: icosphereInteractionCatalog.catalogVersion,
      });
      const icospherePacket = procedureAuthoringPromptPacketSchema.parse(
        icospherePrompt.result?.structuredContent,
      );
      const historicalIcosphere = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 16, 'operatingline.procedure.authoring.materialize', {
            packet: icospherePacket,
            tree: icosphereAuthoringCandidateFixture(icospherePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalIcosphere.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_icosphere.native',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);
      const historicalCube = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 17, 'operatingline.procedure.authoring.materialize', {
            packet: icospherePacket,
            tree: cubeAuthoringCandidateFixture(icospherePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalCube).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.13.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cube.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const rebuiltPacket = buildProcedureAuthoringPromptPacket(
        request,
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      expect(rebuiltPacket).toEqual(packet);

      const procedures = await fetch(`${runtime.baseUrl}/api/v1/procedures`, { headers });
      await expect(procedures.json()).resolves.toEqual({
        procedures: [],
        nextAfterSequence: null,
      });
      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });

      const orderedMenuPrompt = await callMcpTool(
        runtime,
        9,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: orderedMenuInteractionCatalog.catalogVersion,
        },
      );
      const orderedMenuPacket = procedureAuthoringPromptPacketSchema.parse(
        orderedMenuPrompt.result?.structuredContent,
      );
      const orderedMenuMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 10, 'operatingline.procedure.authoring.materialize', {
            packet: orderedMenuPacket,
            tree: authoringCandidateFixture(orderedMenuPacket),
          })
        ).result?.structuredContent,
      );
      expect(orderedMenuMaterialization.formatVersion).toBe('1.1.0');
      expect(orderedMenuMaterialization.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_uv_sphere.native',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);

      const shortcutPrompt = await callMcpTool(runtime, 12, 'operatingline.procedure.prompt.get', {
        ...request,
        actionCatalogVersion: historicalActionCatalog.catalogVersion,
        interactionCatalogVersion: shortcutInteractionCatalog.catalogVersion,
      });
      const shortcutPacket = procedureAuthoringPromptPacketSchema.parse(
        shortcutPrompt.result?.structuredContent,
      );
      const shortcutMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 13, 'operatingline.procedure.authoring.materialize', {
            packet: shortcutPacket,
            tree: authoringCandidateFixture(shortcutPacket),
          })
        ).result?.structuredContent,
      );
      expect(shortcutMaterialization).toMatchObject({
        formatVersion: '1.2.0',
        catalogBinding: { interactionCatalogVersion: '1.12.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_uv_sphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });

      const legacyMaterializingPrompt = await callMcpTool(
        runtime,
        4,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: legacyMaterializingInteractionCatalog.catalogVersion,
        },
      );
      const legacyMaterializingPacket = procedureAuthoringPromptPacketSchema.parse(
        legacyMaterializingPrompt.result?.structuredContent,
      );
      const legacyMaterializingCandidate = authoringCandidateFixture(legacyMaterializingPacket);
      const legacyMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 5, 'operatingline.procedure.authoring.materialize', {
            packet: legacyMaterializingPacket,
            tree: legacyMaterializingCandidate,
          })
        ).result?.structuredContent,
      );
      expect(legacyMaterialization.formatVersion).toBe('1.0.0');
      const legacyMaterializedLeaf = legacyMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (legacyMaterializedLeaf?.kind !== 'leaf' || legacyMaterializedLeaf.action === null) {
        throw new Error('Expected one legacy materialized leaf');
      }
      const legacyMenuTrack = legacyMaterializedLeaf.menuTracks[0];
      if (legacyMenuTrack?.availability !== 'available') {
        throw new Error('Expected one legacy catalog-grounded menu track');
      }
      expect(legacyMenuTrack.operations).toHaveLength(4);
      expect(legacyMenuTrack.operations.at(-1)?.parameters).toEqual(
        legacyMaterializedLeaf.action.arguments,
      );

      const unavailableLegacyPrompt = await callMcpTool(
        runtime,
        6,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: unavailableLegacyInteractionCatalog.catalogVersion,
        },
      );
      const unavailableLegacyPacket = procedureAuthoringPromptPacketSchema.parse(
        unavailableLegacyPrompt.result?.structuredContent,
      );
      const unavailableLegacyCandidate = authoringCandidateFixture(unavailableLegacyPacket);
      const unavailableLegacyMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 7, 'operatingline.procedure.authoring.materialize', {
            packet: unavailableLegacyPacket,
            tree: unavailableLegacyCandidate,
          })
        ).result?.structuredContent,
      );
      expect(unavailableLegacyMaterialization.formatVersion).toBe('1.0.0');
      expect(unavailableLegacyMaterialization.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_uv_sphere.native',
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);

      const unavailable = await callMcpTool(runtime, 8, 'operatingline.procedure.prompt.get', {
        ...request,
        interactionCatalogVersion: '9.9.9',
      });
      expect(unavailable.result).toMatchObject({ isError: true });
      expect(unavailable.result?.content?.[0]?.text).toContain(
        'procedure_authoring_prompt_unavailable',
      );
    } finally {
      await runtime.stop();
    }
  }, 25_000);

  it('materializes and structurally compiles the active InteractionCatalog Subdivide candidate', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Subdivide the accepted Cube with two cuts and 0.25 smoothing.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: subdivideAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(
          materializedMcp.result.content?.[0]?.text ?? 'Subdivide materialization failed',
        );
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Subdivide leaf');
      }

      expect(materialization).toMatchObject({
        formatVersion: '1.3.0',
        catalogBinding: {
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.mesh.edit_subdivide.semantic',
            menu: 'unavailable',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      expect(materialization.tree.formatVersion).toBe('1.1.0');
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.subdivided.mesh',
        resultMeshName: 'OperatingLine.Cube.Subdivided',
        cuts: 2,
        smooth: 0.25,
      });
      expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(leaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const shortcut = leaf.shortcutTracks[0];
      if (shortcut?.availability !== 'available') {
        throw new Error('Expected one materialized Subdivide shortcut');
      }
      expect(shortcut.operations.map((operation) => operation.id)).toEqual([
        'shortcut.enter_edit_mode',
        'shortcut.select_all_mesh_elements',
        'shortcut.search_subdivide',
        'shortcut.execute_subdivide',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_number_of_cuts',
        'shortcut.set_smoothness',
        'shortcut.close_adjust_last_operation',
        'shortcut.return_to_object_mode',
      ]);
      expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        { query: 'subdivide' },
        {},
        {},
        { value: 2 },
        { value: 0.25 },
        {},
        {},
      ]);
      expect(
        shortcut.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toEqual(expect.arrayContaining(['targetId', 'resultMeshId', 'resultMeshName']));
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('keeps the active Mirror procedure structural-only and non-executing', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Mirror the accepted Cube on its local Y axis.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: mirrorAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(
          materializedMcp.result.content?.[0]?.text ?? 'Mirror materialization failed',
        );
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Mirror leaf');
      }
      expect(materialization).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: {
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.modifier.add_mirror.semantic',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.mirror',
        modifierName: 'OperatingLine.Cube.Mirror',
        axis: 'Y',
      });
      expect(leaf.expectedObservations).toEqual([
        {
          kind: 'modifier_ready',
          parameters: {
            targetId: 'tutorial.cube',
            modifierId: 'tutorial.cube.mirror',
            modifierType: 'MIRROR',
            axis: 'Y',
          },
        },
      ]);
      expect(leaf.menuTracks).toEqual([expect.objectContaining({ availability: 'unavailable' })]);
      expect(leaf.shortcutTracks).toEqual([
        expect.objectContaining({ availability: 'unavailable' }),
      ]);
      expect(leaf.mcpTracks).toEqual([expect.objectContaining({ availability: 'unavailable' })]);
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('materializes and structurally compiles the InteractionCatalog 1.23 Subdivision Surface candidate', async () => {
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.13.0',
    );
    const historicalInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.23.0',
    );
    if (historicalActionCatalog === undefined || historicalInteractionCatalog === undefined) {
      throw new Error('Expected immutable AC1.13 and IC1.23 catalogs');
    }
    expect(historicalInteractionCatalog.actionCatalogVersion).toBe(
      historicalActionCatalog.catalogVersion,
    );
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [historicalActionCatalog],
      interactionCatalogs: [historicalInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: historicalActionCatalog.catalogVersion,
          interactionCatalogVersion: historicalInteractionCatalog.catalogVersion,
          goal: 'Add a managed Subdivision Surface modifier with viewport level three.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        historicalActionCatalog,
        historicalInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: subdivisionSurfaceAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(
          materializedMcp.result.content?.[0]?.text ?? 'Subdivision Surface materialization failed',
        );
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Subdivision Surface leaf');
      }

      expect(materialization).toMatchObject({
        formatVersion: '1.3.0',
        catalogBinding: {
          actionCatalogVersion: '1.13.0',
          interactionCatalogVersion: '1.23.0',
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.modifier.add_subdivision_surface.semantic',
            menu: 'unavailable',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      expect(materialization.tree.formatVersion).toBe('1.1.0');
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.subdivision_surface',
        modifierName: 'OperatingLine.Cube.SubdivisionSurface',
        viewportLevel: 3,
      });
      expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(leaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const shortcut = leaf.shortcutTracks[0];
      if (shortcut?.availability !== 'available') {
        throw new Error('Expected one materialized Subdivision Surface shortcut');
      }
      expect(shortcut.operations.map((operation) => operation.id)).toEqual([
        'shortcut.add_subdivision_surface_level_one',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_viewport_level',
        'shortcut.close_adjust_last_operation',
      ]);
      expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
        { level: 1, relative: false, ensure_modifier: true },
        {},
        { value: 3 },
        {},
      ]);
      expect(shortcut.operations[0]).toMatchObject({ keys: ['CTRL', '1'] });
      expect(shortcut.operations[1]).toMatchObject({
        keys: ['F9'],
        opensSurface: {
          kind: 'adjust_last_operation',
          hostId: 'screen.redo_last',
          sourceOperationId: 'shortcut.add_subdivision_surface_level_one',
          expectedOperatorId: 'object.subdivision_set',
        },
      });
      expect(shortcut.operations[2]).toMatchObject({
        target: { kind: 'control', hostId: 'object.subdivision_set.level' },
        path: ['Adjust Last Operation', 'Level'],
      });
      expect(shortcut.operations[3]).toMatchObject({
        keys: ['ENTER'],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      });
      const shortcutParameterNames = shortcut.operations.flatMap((operation) =>
        Object.keys(operation.parameters),
      );
      for (const managedArgument of ['targetId', 'modifierId', 'modifierName']) {
        expect(shortcutParameterNames).not.toContain(managedArgument);
      }
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: '1.13.0',
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('materializes and structurally compiles the active Edit Mode Bevel F9 candidate', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Bevel every Cube edge with width 0.2, three segments, and profile 0.6.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: editBevelAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(
          materializedMcp.result.content?.[0]?.text ?? 'Edit Mode Bevel materialization failed',
        );
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Edit Mode Bevel leaf');
      }

      expect(materialization).toMatchObject({
        formatVersion: '1.3.0',
        catalogBinding: {
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.mesh.edit_bevel_edges.semantic',
            menu: 'unavailable',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      expect(materialization.tree.formatVersion).toBe('1.1.0');
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.beveled.mesh',
        resultMeshName: 'OperatingLine.Cube.Beveled',
        width: 0.2,
        segments: 3,
        profile: 0.6,
      });
      expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(leaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const shortcut = leaf.shortcutTracks[0];
      if (shortcut?.availability !== 'available') {
        throw new Error('Expected one materialized Edit Mode Bevel shortcut');
      }
      expect(shortcut.operations.map((operation) => operation.id)).toEqual([
        'shortcut.enter_edit_mode',
        'shortcut.select_edge_mode',
        'shortcut.select_all_edges',
        'shortcut.bevel_edges',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_bevel_width',
        'shortcut.set_bevel_segments',
        'shortcut.set_bevel_profile',
        'shortcut.close_adjust_last_operation',
        'shortcut.return_to_object_mode',
      ]);
      expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        {
          offset_type: 'OFFSET',
          offset: 0,
          profile_type: 'SUPERELLIPSE',
          segments: 1,
          profile: 0.5,
          affect: 'EDGES',
          clamp_overlap: false,
          loop_slide: true,
          mark_seam: false,
          mark_sharp: false,
          material: -1,
          harden_normals: false,
          face_strength_mode: 'NONE',
          miter_outer: 'SHARP',
          miter_inner: 'SHARP',
          spread: 0.1,
          vmesh_method: 'ADJ',
          release_confirm: false,
          confirm: 'ENTER',
        },
        {},
        { value: 0.2 },
        { value: 3 },
        { value: 0.6 },
        {},
        {},
      ]);
      expect(shortcut.operations[3]).toMatchObject({
        keyMode: 'chord',
        keys: ['CTRL', 'B'],
      });
      expect(shortcut.operations[4]).toMatchObject({
        keys: ['F9'],
        opensSurface: {
          kind: 'adjust_last_operation',
          hostId: 'screen.redo_last',
          sourceOperationId: 'shortcut.bevel_edges',
          expectedOperatorId: 'mesh.bevel',
        },
      });
      expect(shortcut.operations[5]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.bevel.offset' },
        path: ['Adjust Last Operation', 'Width'],
      });
      expect(shortcut.operations[6]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.bevel.segments' },
        path: ['Adjust Last Operation', 'Segments'],
      });
      expect(shortcut.operations[7]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.bevel.profile' },
        path: ['Adjust Last Operation', 'Profile Shape'],
      });
      expect(shortcut.operations[8]).toMatchObject({
        keys: ['ENTER'],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      });
      expect(shortcut.operations[9]).toMatchObject({ keys: ['TAB'] });
      const shortcutParameterNames = shortcut.operations.flatMap((operation) =>
        Object.keys(operation.parameters),
      );
      for (const managedArgument of ['targetId', 'resultMeshId', 'resultMeshName']) {
        expect(shortcutParameterNames).not.toContain(managedArgument);
      }
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('materializes and structurally compiles the active Edit Mode Inset F9 candidate', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Inset every Cube face individually with thickness 0.2 and depth 0.1.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: editInsetAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(
          materializedMcp.result.content?.[0]?.text ?? 'Edit Mode Inset materialization failed',
        );
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Edit Mode Inset leaf');
      }

      expect(materialization).toMatchObject({
        formatVersion: '1.3.0',
        catalogBinding: {
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.mesh.edit_inset_faces.semantic',
            menu: 'unavailable',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      expect(materialization.tree.formatVersion).toBe('1.1.0');
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.inset.mesh',
        resultMeshName: 'OperatingLine.Cube.Inset',
        thickness: 0.2,
        depth: 0.1,
      });
      expect(leaf.expectedObservations).toEqual([
        {
          kind: 'mesh_faces_inset',
          parameters: {
            targetId: 'tutorial.cube',
            resultMeshId: 'tutorial.cube.inset.mesh',
          },
        },
      ]);
      expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(leaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const shortcut = leaf.shortcutTracks[0];
      if (shortcut?.availability !== 'available') {
        throw new Error('Expected one materialized Edit Mode Inset shortcut');
      }
      expect(shortcut.operations.map((operation) => operation.id)).toEqual([
        'shortcut.enter_edit_mode',
        'shortcut.select_face_mode',
        'shortcut.select_all_faces',
        'shortcut.inset_faces',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_inset_thickness',
        'shortcut.set_inset_depth',
        'shortcut.set_inset_individual',
        'shortcut.close_adjust_last_operation',
        'shortcut.return_to_object_mode',
      ]);
      expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        {
          use_boundary: true,
          use_even_offset: true,
          use_relative_offset: false,
          use_edge_rail: false,
          thickness: 0,
          depth: 0,
          use_outset: false,
          use_select_inset: false,
          use_individual: false,
          use_interpolate: true,
          release_confirm: false,
          confirm: 'ENTER',
        },
        {},
        { value: 0.2 },
        { value: 0.1 },
        { value: true },
        {},
        {},
      ]);
      expect(shortcut.operations[0]).toMatchObject({ keys: ['TAB'] });
      expect(shortcut.operations[1]).toMatchObject({ keys: ['3'] });
      expect(shortcut.operations[2]).toMatchObject({ keys: ['A'] });
      expect(shortcut.operations[3]).toMatchObject({ keys: ['I'] });
      expect(shortcut.operations[4]).toMatchObject({
        keys: ['F9'],
        opensSurface: {
          kind: 'adjust_last_operation',
          hostId: 'screen.redo_last',
          sourceOperationId: 'shortcut.inset_faces',
          expectedOperatorId: 'mesh.inset',
        },
      });
      expect(shortcut.operations[5]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.inset.thickness' },
        path: ['Adjust Last Operation', 'Thickness'],
      });
      expect(shortcut.operations[6]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.inset.depth' },
        path: ['Adjust Last Operation', 'Depth'],
      });
      expect(shortcut.operations[7]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.inset.use_individual' },
        path: ['Adjust Last Operation', 'Individual'],
      });
      expect(shortcut.operations[8]).toMatchObject({
        keys: ['ENTER'],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      });
      expect(shortcut.operations[9]).toMatchObject({ keys: ['TAB'] });
      const shortcutParameterNames = shortcut.operations.flatMap((operation) =>
        Object.keys(operation.parameters),
      );
      for (const managedArgument of ['targetId', 'resultMeshId', 'resultMeshName']) {
        expect(shortcutParameterNames).not.toContain(managedArgument);
      }
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('materializes and structurally compiles the active Edit Mode Poke Faces candidate', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const packet = buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: 'Poke every Cube face with offset 0.2.',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const materializedMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: editPokeAuthoringCandidateFixture(packet) },
      );
      if (materializedMcp.result?.isError === true) {
        throw new Error(materializedMcp.result.content?.[0]?.text ?? 'Poke materialization failed');
      }
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      const leaf = materialization.tree.nodes.find((node) => node.kind === 'leaf');
      if (leaf?.kind !== 'leaf' || leaf.action === null) {
        throw new Error('Expected one materialized Edit Mode Poke leaf');
      }

      expect(materialization).toMatchObject({
        formatVersion: '1.3.0',
        catalogBinding: {
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: leaf.id,
            recipeId: 'blender.mesh.edit_poke_faces.semantic',
            menu: 'unavailable',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });
      expect(materialization.tree.formatVersion).toBe('1.1.0');
      expect(leaf.action.arguments).toEqual({
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.poked.mesh',
        resultMeshName: 'OperatingLine.Cube.Poked',
        offset: 0.2,
      });
      expect(leaf.expectedObservations).toEqual([
        {
          kind: 'mesh_faces_poked',
          parameters: {
            targetId: 'tutorial.cube',
            resultMeshId: 'tutorial.cube.poked.mesh',
          },
        },
      ]);
      expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(leaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const shortcut = leaf.shortcutTracks[0];
      if (shortcut?.availability !== 'available') {
        throw new Error('Expected one materialized Edit Mode Poke shortcut');
      }
      expect(shortcut.operations.map((operation) => operation.id)).toEqual([
        'shortcut.enter_edit_mode',
        'shortcut.select_face_mode',
        'shortcut.select_all_faces',
        'shortcut.open_operator_search',
        'shortcut.execute_poke_faces',
        'shortcut.open_adjust_last_operation',
        'shortcut.set_poke_offset',
        'shortcut.close_adjust_last_operation',
        'shortcut.return_to_object_mode',
      ]);
      expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { query: 'poke faces' },
        { offset: 0, use_relative_offset: false, center_mode: 'MEDIAN_WEIGHTED' },
        {},
        { value: 0.2 },
        {},
        {},
      ]);
      expect(shortcut.operations[3]).toMatchObject({
        keys: ['F3'],
        selectionPath: ['Poke Faces'],
      });
      expect(shortcut.operations[4]).toMatchObject({ keys: ['ENTER'] });
      expect(shortcut.operations[5]).toMatchObject({
        keys: ['F9'],
        opensSurface: {
          sourceOperationId: 'shortcut.execute_poke_faces',
          expectedOperatorId: 'mesh.poke',
        },
      });
      expect(shortcut.operations[6]).toMatchObject({
        target: { kind: 'control', hostId: 'mesh.poke.offset' },
        path: ['Adjust Last Operation', 'Offset'],
      });
      expect(shortcut.operations[7]).toMatchObject({
        keys: ['ENTER'],
        closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
      });
      expect(shortcut.operations[8]).toMatchObject({ keys: ['TAB'] });
      expect(
        shortcut.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toEqual(expect.arrayContaining(['targetId', 'resultMeshId', 'resultMeshName']));
      expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });

      const compiledMcp = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: materialization.tree,
      });
      expect(compiledMcp.result?.isError).not.toBe(true);
      expect(compiledMcp.result?.structuredContent).toMatchObject({
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
    } finally {
      await runtime.stop();
    }
  });

  it('rejects tampered, resealed, identity-drifted, and non-candidate authoring input', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const promptRequest = {
        targetAdapterId: 'blender',
        goal: 'Create the left eye sphere.',
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
      };
      const packet = buildProcedureAuthoringPromptPacket(
        promptRequest,
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const candidate = authoringCandidateFixture(packet);

      const badIntegrity = structuredClone(packet);
      badIntegrity.integrity.contentSha256 = '0'.repeat(64);
      const badIntegrityMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.validate',
        { packet: badIntegrity, tree: candidate },
      );
      expect(badIntegrityMcp.result).toMatchObject({ isError: true });
      expect(badIntegrityMcp.result?.content?.[0]?.text).toContain(
        'procedure_authoring_validation_failed',
      );

      const resealed = structuredClone(packet);
      resealed.workflow.instructions = [
        ...resealed.workflow.instructions,
        'A client-added instruction must not become part of the installed packet.',
      ];
      resealed.integrity.contentSha256 = computeProcedureAuthoringPromptPacketContentSha256(
        procedureAuthoringPromptPacketContent(resealed),
      );
      const resealedHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet: resealed, tree: candidate }),
      });
      expect(resealedHttp.status).toBe(422);
      await expect(resealedHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
        message: 'Procedure authoring packet does not match the installed catalog snapshots',
      });
      const resealedMaterializationHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet: resealed, tree: candidate }),
        },
      );
      expect(resealedMaterializationHttp.status).toBe(422);
      await expect(resealedMaterializationHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_materialization_failed',
        message: 'Procedure authoring packet does not match the installed catalog snapshots',
      });

      const changedIdentity = structuredClone(candidate);
      changedIdentity['id'] = 'different.procedure';
      const changedIdentityHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: changedIdentity }),
        },
      );
      expect(changedIdentityHttp.status).toBe(422);
      await expect(changedIdentityHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
      });

      const changedSource = structuredClone(candidate);
      const goalSource = (changedSource['sources'] as Array<Record<string, unknown>>).find(
        (source) => source['id'] === packet.context.goalProvenance.source.id,
      );
      if (goalSource === undefined) throw new Error('Expected packet-bound goal source');
      goalSource['text'] = 'Changed after the packet was built.';
      const changedSourceHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: changedSource }),
        },
      );
      expect(changedSourceHttp.status).toBe(422);

      const compileInvalid = structuredClone(candidate);
      const actionLeaf = (compileInvalid['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['kind'] === 'leaf',
      );
      if (actionLeaf === undefined) throw new Error('Expected action leaf');
      const action = actionLeaf['action'] as Record<string, unknown>;
      action['name'] = 'blender.unknown_action';
      const compileInvalidHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: compileInvalid }),
        },
      );
      expect(compileInvalidHttp.status).toBe(422);
      await expect(compileInvalidHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
      });

      const availableTracks = procedureFixture();
      availableTracks['sources'] = candidate['sources'];
      availableTracks['evidence'] = candidate['evidence'];
      const availableHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet, tree: availableTracks }),
      });
      expect(availableHttp.status).toBe(400);
      await expect(availableHttp.json()).resolves.toMatchObject({
        error: 'invalid_procedure_authoring_validation_request',
      });
      const availableMaterializationHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: availableTracks }),
        },
      );
      expect(availableMaterializationHttp.status).toBe(400);
      await expect(availableMaterializationHttp.json()).resolves.toMatchObject({
        error: 'invalid_procedure_authoring_materialization_request',
      });

      const procedures = await fetch(`${runtime.baseUrl}/api/v1/procedures`, { headers });
      await expect(procedures.json()).resolves.toMatchObject({ procedures: [] });
      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });
    } finally {
      await runtime.stop();
    }
  });

  it('classifies persistence failures as internal without exposing SQLite details', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-failure-'));
    const databasePath = join(directory, 'state.db');
    const runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_procedure_storage
        BEFORE INSERT ON procedure_trees
        BEGIN
          SELECT RAISE(FAIL, 'injected private sqlite detail');
        END;
      `);
      injected.close();

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: procedureFixture() }),
      });
      expect(http.status).toBe(500);
      const httpError = JSON.stringify(await http.json());
      expect(httpError).toContain('procedure_tree_storage_failed');
      expect(httpError).not.toContain('injected private sqlite detail');

      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: procedureFixture(),
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain('procedure_tree_storage_failed');
      expect(mcp.result?.content?.[0]?.text).not.toContain('injected private sqlite detail');
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores immutable revisions and serves exact, latest, and paginated reads across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-runtime-'));
    const databasePath = join(directory, 'state.db');
    let runtime: RunningRuntime | undefined;
    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const revisionOne = procedureFixture();
      const storedMcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: revisionOne,
      });
      expect(storedMcp.result?.isError).not.toBe(true);
      const stored = JSON.parse(storedMcp.result?.content?.[0]?.text ?? '{}') as {
        result?: string;
        record?: {
          sequence?: number;
          tree?: { id?: string; revision?: number };
          integrity?: { contentSha256?: string; canonicalization?: string };
          storedAt?: string;
        };
      };
      expect(stored).toMatchObject({
        result: 'accepted',
        record: {
          tree: { id: 'snowman.eye.left.procedure', revision: 1 },
          integrity: { canonicalization: 'operatingline-json-value-v1' },
        },
        validation: { interactionTracks: 'structural_only' },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(stored.record?.integrity?.contentSha256).toMatch(/^[a-f0-9]{64}$/);

      const duplicate = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionOne }),
      });
      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({
        result: 'duplicate',
        record: {
          sequence: stored.record?.sequence,
          storedAt: stored.record?.storedAt,
          integrity: { contentSha256: stored.record?.integrity?.contentSha256 },
        },
      });

      const revisionThree = procedureFixture();
      revisionThree['revision'] = 3;
      revisionThree['title'] = 'Snowman left eye revision 3';
      const newer = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionThree }),
      });
      expect(newer.status).toBe(200);
      await expect(newer.json()).resolves.toMatchObject({
        result: 'accepted',
        record: { tree: { revision: 3 } },
      });

      const revisionTwo = procedureFixture();
      revisionTwo['revision'] = 2;
      const stale = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionTwo }),
      });
      expect(stale.status).toBe(409);
      await expect(stale.json()).resolves.toMatchObject({
        error: 'procedure_tree_revision_stale',
        result: 'stale',
        latestRevision: 3,
      });

      const conflicting = procedureFixture();
      conflicting['title'] = 'Conflicting immutable revision';
      const conflict = await callMcpTool(runtime, 2, 'operatingline.procedure.store', {
        tree: conflicting,
      });
      expect(conflict.result?.isError).toBe(true);
      expect(conflict.result?.content?.[0]?.text).toContain('procedure_tree_revision_conflict');

      const exact = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=1`,
        { headers },
      );
      expect(exact.status).toBe(200);
      await expect(exact.json()).resolves.toMatchObject({ tree: { revision: 1 } });

      const latest = await callMcpTool(runtime, 3, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
      });
      expect(latest.result?.isError).not.toBe(true);
      expect(JSON.parse(latest.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        tree: { revision: 3 },
      });

      const firstPage = await callMcpTool(runtime, 4, 'operatingline.procedure.list', {
        limit: 1,
      });
      const page = JSON.parse(firstPage.result?.content?.[0]?.text ?? '{}') as {
        procedures?: Array<{ sequence?: number; revision?: number; tree?: unknown }>;
        nextAfterSequence?: number | null;
      };
      expect(page.procedures).toMatchObject([{ revision: 1 }]);
      expect(page.procedures?.[0]).not.toHaveProperty('tree');
      expect(page.nextAfterSequence).toBe(page.procedures?.[0]?.sequence);
      const secondPage = await fetch(
        `${runtime.baseUrl}/api/v1/procedures?afterSequence=${page.nextAfterSequence}&limit=1&adapterId=blender`,
        { headers },
      );
      expect(secondPage.status).toBe(200);
      await expect(secondPage.json()).resolves.toMatchObject({
        procedures: [{ revision: 3 }],
        nextAfterSequence: null,
      });

      const semanticSearch = await callMcpTool(runtime, 5, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        semanticAction: 'create_uv_sphere',
      });
      expect(semanticSearch.result?.isError).not.toBe(true);
      const semanticHits = JSON.parse(semanticSearch.result?.content?.[0]?.text ?? '{}') as {
        operations?: Array<{
          modality?: string;
          semanticActions?: string[];
          tree?: { treeId?: string; revision?: number; integrity?: unknown };
          nodePath?: Array<{ id?: string }>;
          operation?: { id?: string; parameters?: unknown };
          sources?: unknown[];
          evidence?: unknown[];
        }>;
        matching?: string;
        similarityScoreProduced?: boolean;
        hostExecutionStarted?: boolean;
      };
      expect(semanticHits.operations).toHaveLength(6);
      expect(semanticHits.operations?.map((hit) => hit.modality)).toEqual([
        'semantic',
        'menu',
        'menu',
        'menu',
        'menu',
        'shortcut',
      ]);
      expect(semanticHits.operations?.[0]).toMatchObject({
        semanticActions: ['create_uv_sphere'],
        tree: {
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          integrity: { algorithm: 'sha256' },
        },
        nodePath: [
          { id: 'snowman' },
          { id: 'snowman.head' },
          { id: 'snowman.head.eyes' },
          { id: 'snowman.head.eyes.left' },
        ],
        sources: [{ id: 'source.prompt' }],
        evidence: [{ id: 'evidence.prompt' }],
      });
      expect(semanticHits).toMatchObject({
        matching: 'exact_structured_filters',
        similarityScoreProduced: false,
        hostExecutionStarted: false,
      });

      const firstSearchPage = await callMcpTool(runtime, 6, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        semanticAction: 'create_uv_sphere',
        limit: 2,
      });
      const firstSearchPageResult = JSON.parse(
        firstSearchPage.result?.content?.[0]?.text ?? '{}',
      ) as {
        operations?: Array<{ indexSequence?: number }>;
        nextAfterSequence?: number | null;
      };
      expect(firstSearchPageResult.operations).toHaveLength(2);
      expect(firstSearchPageResult.nextAfterSequence).toBe(
        firstSearchPageResult.operations?.[1]?.indexSequence,
      );
      const secondSearchPage = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          semanticAction: 'create_uv_sphere',
          afterSequence: firstSearchPageResult.nextAfterSequence,
          limit: 4,
        }),
      });
      expect(secondSearchPage.status).toBe(200);
      await expect(secondSearchPage.json()).resolves.toMatchObject({
        operations: [{}, {}, {}, {}],
        nextAfterSequence: null,
      });

      const menuSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          modality: 'menu',
          menuTargetHostId: 'mesh.primitive_uv_sphere_add',
          menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        }),
      });
      expect(menuSearch.status).toBe(200);
      await expect(menuSearch.json()).resolves.toMatchObject({
        operations: [
          {
            modality: 'menu',
            operation: {
              id: 'menu.uv_sphere',
              parameters: { radius: 1, location: [0, 0, 0] },
            },
          },
          {
            modality: 'menu',
            operation: {
              id: 'menu.uv_sphere',
              parameters: { radius: 1, location: [0, 0, 0] },
            },
          },
        ],
      });

      const shortcutContextSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationKind: 'shortcut_key_input',
          shortcutKeys: ['SHIFT', 'A'],
          interactionPath: ['Mesh', 'UV Sphere'],
        }),
      });
      expect(shortcutContextSearch.status).toBe(200);
      await expect(shortcutContextSearch.json()).resolves.toMatchObject({
        operations: [
          { modality: 'shortcut', operation: { id: 'shortcut.add_sphere' } },
          { modality: 'shortcut', operation: { id: 'shortcut.add_sphere' } },
        ],
      });

      const unavailableMcpSearch = await callMcpTool(runtime, 6, 'operatingline.procedure.search', {
        modality: 'mcp',
        mcpToolName: 'create_uv_sphere',
      });
      expect(JSON.parse(unavailableMcpSearch.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        operations: [],
        nextAfterSequence: null,
      });

      const invalidSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ limit: 10 }),
      });
      expect(invalidSearch.status).toBe(400);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });
      await runtime.stop();
      runtime = undefined;

      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const restarted = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure`,
        { headers },
      );
      expect(restarted.status).toBe(200);
      await expect(restarted.json()).resolves.toMatchObject({ tree: { revision: 3 } });
      const restartedSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          treeId: 'snowman.eye.left.procedure',
          operationId: 'menu.uv_sphere',
          modality: 'menu',
        }),
      });
      expect(restartedSearch.status).toBe(200);
      await expect(restartedSearch.json()).resolves.toMatchObject({
        operations: [{ tree: { revision: 1 } }, { tree: { revision: 3 } }],
      });

      const extendedStore = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: extendedShortcutProcedureFixture() }),
      });
      const extendedStorePayload = await extendedStore.json();
      expect(extendedStore.status, JSON.stringify(extendedStorePayload)).toBe(200);
      const propertySearch = await callMcpTool(runtime, 7, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.shortcut-surface.procedure',
        operationKind: 'operator_property_update',
        targetHostId: 'mesh.primitive_uv_sphere_add.segments',
        interactionPath: ['Adjust Last Operation', 'Segments'],
        surfaceOperationId: 'shortcut.open_adjust_last',
        expectedOperatorId: 'mesh.primitive_uv_sphere_add',
      });
      expect(propertySearch.result?.isError).not.toBe(true);
      expect(JSON.parse(propertySearch.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        operations: [
          {
            modality: 'shortcut',
            operation: {
              kind: 'operator_property_update',
              id: 'shortcut.set_segments',
              parameters: { value: 32 },
            },
          },
        ],
      });
      const surfaceChainSearch = await callMcpTool(runtime, 8, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.shortcut-surface.procedure',
        surfaceOperationId: 'shortcut.open_adjust_last',
        expectedOperatorId: 'mesh.primitive_uv_sphere_add',
      });
      expect(surfaceChainSearch.result?.isError).not.toBe(true);
      const surfaceChain = JSON.parse(surfaceChainSearch.result?.content?.[0]?.text ?? '{}') as {
        operations?: Array<{ operation?: { id?: string } }>;
      };
      expect(surfaceChain.operations?.map((hit) => hit.operation?.id)).toEqual([
        'shortcut.open_adjust_last',
        'shortcut.set_segments',
        'shortcut.close_adjust_last',
      ]);
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('gates an accepted UV Sphere orchestration result on its exact Start checkpoint chain', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const targetInstanceId = randomUUID();
      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '创建并精确调整一个左眼 UV Sphere。',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          locale: 'zh-CN',
        }),
      });
      expect(promptResponse.status).toBe(200);
      const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
      const replayRequest = {
        formatVersion: '1.0.0',
        replayId: randomUUID(),
        targetInstanceId,
        leafId: 'snowman.head.eyes.left',
        replayMode: 'managed_action',
        packet,
        tree: replayAuthoringCandidateFixture(packet),
      } as const;
      const proposedMcp = await callMcpTool(
        runtime,
        890,
        'operatingline.procedure.replay.propose',
        replayRequest,
      );
      expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
      const proposed = procedureLeafReplayProposalResultSchema.parse(
        proposedMcp.result?.structuredContent,
      );
      expect(proposed.binding).toMatchObject({
        actionName: 'blender.mesh.create_uv_sphere',
        claims: { mcpTrack: 'catalog_grounded_not_executed' },
        materialization: {
          coverage: [expect.objectContaining({ mcp: 'materialized' })],
        },
      });
      const proposal = proposed.binding.proposal;
      const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
      if (step?.action === null || step?.action === undefined) {
        throw new Error('Expected one executable UV Sphere replay step');
      }

      const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
      });
      expect(sessionResponse.status).toBe(200);
      const session = (await sessionResponse.json()) as { leaseId: string };
      const leaseHeaders = {
        ...headers,
        'x-operatingline-companion-lease': session.leaseId,
      };
      const executionId = randomUUID();
      const planContentSha256 = computePlanContentSha256(proposal.plan);
      const prematureStartedAt = new Date(Date.now() - 2_000).toISOString();
      const prematureStartReport = {
        protocolVersion: guideProtocolVersion,
        reportId: randomUUID(),
        sequence: 1,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        companionVersion: '0.1.0',
        hostVersion: '4.5.3 LTS',
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
          committedAt: new Date(Date.parse(prematureStartedAt) - 1).toISOString(),
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
        occurredAt: prematureStartedAt,
      } as const;
      const prematureStateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(prematureStartReport),
      });
      expect(prematureStateResponse.status).toBe(200);

      const decision = {
        protocolVersion: guideProtocolVersion,
        decisionId: randomUUID(),
        proposalId: proposal.proposalId,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        decision: 'accepted',
        occurredAt: new Date(Date.now() - 1_000).toISOString(),
      } as const;
      const decisionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        { method: 'POST', headers: leaseHeaders, body: JSON.stringify(decision) },
      );
      expect(decisionResponse.status).toBe(200);

      const reversedReceiptExecution = await callMcpTool(
        runtime,
        8901,
        'operatingline.blender.action.execute',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          replayId: replayRequest.replayId,
          expectedState: {
            reportId: prematureStartReport.reportId,
            sequence: prematureStartReport.sequence,
          },
        },
      );
      expect(reversedReceiptExecution.result?.isError).toBe(true);
      expect(reversedReceiptExecution.result?.content?.[0]?.text).toContain(
        'action_execution_evidence_order_invalid',
      );

      const startedAt = new Date().toISOString();
      const startReport = {
        ...prematureStartReport,
        reportId: randomUUID(),
        sequence: prematureStartReport.sequence + 1,
        nativeUndoCheckpoint: {
          ...prematureStartReport.nativeUndoCheckpoint,
          checkpointId: randomUUID(),
          previousCheckpointId: prematureStartReport.nativeUndoCheckpoint.checkpointId,
          committedAt: new Date(Date.parse(startedAt) - 1).toISOString(),
        },
        occurredAt: startedAt,
      } as const;
      const startStateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(startReport),
      });
      expect(startStateResponse.status).toBe(200);

      const staleExecution = await callMcpTool(
        runtime,
        891,
        'operatingline.blender.action.execute',
        {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          replayId: replayRequest.replayId,
          expectedState: { reportId: randomUUID(), sequence: 1 },
        },
      );
      expect(staleExecution.result?.isError).toBe(true);
      expect(staleExecution.result?.content?.[0]?.text).toContain('action_execution_state_changed');

      const actionRequest = {
        formatVersion: '1.0.0',
        requestId: randomUUID(),
        replayId: replayRequest.replayId,
        expectedState: { reportId: startReport.reportId, sequence: startReport.sequence },
      } as const;
      const queuedMcp = await callMcpTool(
        runtime,
        892,
        'operatingline.blender.action.execute',
        actionRequest,
      );
      expect(queuedMcp.result?.isError, queuedMcp.result?.content?.[0]?.text).not.toBe(true);
      const queued = companionActionExecutionStatusSchema.parse(
        queuedMcp.result?.structuredContent,
      );
      expect(queued).toMatchObject({
        requestId: actionRequest.requestId,
        replayId: actionRequest.replayId,
        status: 'queued',
        step: { id: replayRequest.leafId, action: step.action },
      });
      const duplicateQueuedMcp = await callMcpTool(
        runtime,
        893,
        'operatingline.blender.action.execute',
        actionRequest,
      );
      expect(
        companionActionExecutionStatusSchema.parse(duplicateQueuedMcp.result?.structuredContent),
      ).toEqual(queued);

      const expectedObservation = step.expectedObservations[0];
      if (expectedObservation === undefined) {
        throw new Error('Expected a success-gated UV Sphere observation');
      }
      const successReportFor = (
        sequence: number,
        occurredAt: string,
        parameters: Record<string, unknown>,
        previousCheckpointId?: string,
      ) => ({
        ...startReport,
        reportId: randomUUID(),
        sequence,
        phase: 'completed' as const,
        activeStepId: replayRequest.leafId,
        completedStepIds: [replayRequest.leafId],
        transition: 'step_succeeded' as const,
        stepId: replayRequest.leafId,
        observations: [
          {
            kind: expectedObservation.kind,
            satisfied: true,
            details: strongPrimitiveObservationDetails({
              parameters,
              topology: { vertexCount: 482, edgeCount: 992, faceCount: 512 },
              geometryDetailKeys: ['radiusMatches'],
            }),
          },
        ],
        nativeUndoCheckpoint: replayNativeUndoCheckpoint({
          planId: proposal.plan.id,
          planRevision: proposal.plan.revision,
          planContentSha256,
          executionId,
          stepId: replayRequest.leafId,
          occurredAt,
          ...(previousCheckpointId === undefined ? {} : { previousCheckpointId }),
        }),
        occurredAt,
      });
      const postState = async (report: ReturnType<typeof successReportFor>) => {
        const response = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(report),
        });
        expect(response.status).toBe(200);
      };

      const preexistingFutureAt = new Date(Date.now() + 60_000).toISOString();
      const preexistingFutureReport = successReportFor(
        startReport.sequence + 1,
        preexistingFutureAt,
        expectedObservation.parameters,
      );
      await postState(preexistingFutureReport);

      const actionPollUrl = new URL('/api/v1/companion/action', runtime.baseUrl);
      actionPollUrl.searchParams.set('adapterId', 'blender');
      actionPollUrl.searchParams.set('instanceId', targetInstanceId);
      const missingPollLease = await fetch(actionPollUrl, { headers });
      expect(missingPollLease.status).toBe(409);
      await expect(missingPollLease.json()).resolves.toMatchObject({
        error: 'companion_lease_required',
      });
      const deliveryResponse = await fetch(actionPollUrl, { headers: leaseHeaders });
      expect(deliveryResponse.status).toBe(200);
      const delivery = companionActionPollDeliverySchema.parse(
        await deliveryResponse.json(),
      ).request;
      expect(delivery).not.toBeNull();
      expect(delivery).toMatchObject({
        requestId: actionRequest.requestId,
        proposalId: proposal.proposalId,
        executionId,
        step,
      });
      const emptyPoll = await fetch(actionPollUrl, { headers: leaseHeaders });
      expect(companionActionPollDeliverySchema.parse(await emptyPoll.json())).toEqual({
        request: null,
      });

      const dispatchedMcp = await callMcpTool(runtime, 894, 'operatingline.blender.action.status', {
        requestId: actionRequest.requestId,
      });
      expect(
        companionActionExecutionStatusSchema.parse(dispatchedMcp.result?.structuredContent),
      ).toMatchObject({ status: 'dispatched', deliveryId: delivery!.deliveryId });

      const actionResultUrl = `${runtime.baseUrl}/api/v1/companion/action-result`;
      const resultFor = (report: { reportId: string; sequence: number }, occurredAt: string) =>
        ({
          formatVersion: '1.0.0',
          requestId: delivery!.requestId,
          replayId: delivery!.replayId,
          deliveryId: delivery!.deliveryId,
          target: delivery!.target,
          proposalId: delivery!.proposalId,
          plan: delivery!.plan,
          planContentSha256: delivery!.planContentSha256,
          executionId: delivery!.executionId,
          expectedState: delivery!.expectedState,
          stepId: delivery!.step.id,
          status: 'succeeded',
          report,
          error: null,
          occurredAt,
        }) as const;
      const postResult = (candidate: ReturnType<typeof resultFor>, withLease = true) =>
        fetch(actionResultUrl, {
          method: 'POST',
          headers: withLease ? leaseHeaders : headers,
          body: JSON.stringify(candidate),
        });

      const preexistingFutureResult = await postResult(
        resultFor(
          {
            reportId: preexistingFutureReport.reportId,
            sequence: preexistingFutureReport.sequence,
          },
          new Date(Date.parse(preexistingFutureAt) + 1).toISOString(),
        ),
      );
      expect(preexistingFutureResult.status).toBe(409);
      await expect(preexistingFutureResult.json()).resolves.toMatchObject({
        error: 'action_execution_evidence_predates_dispatch',
      });

      const afterDispatch = Date.parse(delivery!.dispatchedAt) + 1_000;
      const missingReportResult = resultFor(
        { reportId: randomUUID(), sequence: startReport.sequence + 2 },
        new Date(afterDispatch).toISOString(),
      );
      const missingResultLease = await postResult(missingReportResult, false);
      expect(missingResultLease.status).toBe(409);
      await expect(missingResultLease.json()).resolves.toMatchObject({
        error: 'companion_lease_required',
      });
      const resultBeforeReport = await postResult(missingReportResult);
      expect(resultBeforeReport.status).toBe(409);
      await expect(resultBeforeReport.json()).resolves.toMatchObject({
        error: 'action_execution_report_missing',
      });

      const preDispatchAt = new Date(Date.parse(delivery!.dispatchedAt) - 1_000).toISOString();
      const preDispatchReport = successReportFor(
        startReport.sequence + 2,
        preDispatchAt,
        expectedObservation.parameters,
      );
      await postState(preDispatchReport);
      const preDispatchResult = await postResult(
        resultFor(
          { reportId: preDispatchReport.reportId, sequence: preDispatchReport.sequence },
          new Date(afterDispatch).toISOString(),
        ),
      );
      expect(preDispatchResult.status).toBe(409);
      await expect(preDispatchResult.json()).resolves.toMatchObject({
        error: 'action_execution_evidence_predates_dispatch',
      });

      const wrongObservationAt = new Date(afterDispatch + 1_000).toISOString();
      const wrongObservationReport = successReportFor(
        startReport.sequence + 3,
        wrongObservationAt,
        {
          ...expectedObservation.parameters,
          objectName: 'Wrong.Eye',
        },
      );
      await postState(wrongObservationReport);
      const wrongObservationResult = await postResult(
        resultFor(
          { reportId: wrongObservationReport.reportId, sequence: wrongObservationReport.sequence },
          new Date(afterDispatch + 1_001).toISOString(),
        ),
      );
      expect(wrongObservationResult.status).toBe(409);
      await expect(wrongObservationResult.json()).resolves.toMatchObject({
        error: 'action_execution_observation_mismatch',
      });

      const staleSuccessAt = new Date(afterDispatch + 2_000).toISOString();
      const staleSuccessReport = successReportFor(
        startReport.sequence + 4,
        staleSuccessAt,
        expectedObservation.parameters,
      );
      await postState(staleSuccessReport);
      const driftReport = successReportFor(
        startReport.sequence + 5,
        new Date(afterDispatch + 3_000).toISOString(),
        {
          ...expectedObservation.parameters,
          objectName: 'Drifted.Eye',
        },
      );
      await postState(driftReport);
      const staleResult = await postResult(
        resultFor(
          { reportId: staleSuccessReport.reportId, sequence: staleSuccessReport.sequence },
          new Date(afterDispatch + 3_001).toISOString(),
        ),
      );
      expect(staleResult.status).toBe(409);
      await expect(staleResult.json()).resolves.toMatchObject({
        error: 'action_execution_report_stale',
      });

      const mismatchedCheckpointAt = new Date(afterDispatch + 4_000).toISOString();
      const mismatchedCheckpointReport = successReportFor(
        startReport.sequence + 6,
        mismatchedCheckpointAt,
        expectedObservation.parameters,
      );
      await postState(mismatchedCheckpointReport);
      const mismatchedCheckpointResult = await postResult(
        resultFor(
          {
            reportId: mismatchedCheckpointReport.reportId,
            sequence: mismatchedCheckpointReport.sequence,
          },
          new Date(afterDispatch + 4_001).toISOString(),
        ),
      );
      expect(mismatchedCheckpointResult.status).toBe(409);
      await expect(mismatchedCheckpointResult.json()).resolves.toMatchObject({
        error: 'action_execution_checkpoint_chain_invalid',
      });

      const succeededAt = new Date(afterDispatch + 5_000).toISOString();
      const successReport = successReportFor(
        startReport.sequence + 7,
        succeededAt,
        expectedObservation.parameters,
        startReport.nativeUndoCheckpoint.checkpointId,
      );
      await postState(successReport);
      const result = resultFor(
        { reportId: successReport.reportId, sequence: successReport.sequence },
        new Date(afterDispatch + 5_001).toISOString(),
      );
      const actionResultResponse = await postResult(result);
      expect(actionResultResponse.status).toBe(200);
      await expect(actionResultResponse.json()).resolves.toEqual({ result: 'accepted' });
      const duplicateResultResponse = await postResult(result);
      expect(duplicateResultResponse.status).toBe(200);
      await expect(duplicateResultResponse.json()).resolves.toEqual({ result: 'duplicate' });

      const completedMcp = await callMcpTool(runtime, 895, 'operatingline.blender.action.status', {
        requestId: actionRequest.requestId,
      });
      expect(
        companionActionExecutionStatusSchema.parse(completedMcp.result?.structuredContent),
      ).toMatchObject({ status: 'succeeded', result });
    } finally {
      await runtime.stop();
    }
  });

  it.each([
    {
      catalogVersion: '1.34.0',
      primitive: 'Icosphere',
      goal: '创建一个三级细分、半径 1.75 的 Icosphere。',
      fixture: icosphereReplayAuthoringCandidateFixture,
    },
    {
      catalogVersion: '1.35.0',
      primitive: 'Torus',
      goal: '创建一个分段、半径和位置精确的 Torus。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'torus'),
    },
    {
      catalogVersion: '1.36.0',
      primitive: 'Cone',
      goal: '创建一个端点、半径和方向精确的 Cone。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'cone'),
    },
  ])(
    'rejects a frozen InteractionCatalog $catalogVersion $primitive binding at action execution',
    async ({ catalogVersion, goal, fixture }) => {
      const frozenInteractionCatalog = blenderInteractionCatalogs.find(
        (catalog) => catalog.catalogVersion === catalogVersion,
      );
      if (frozenInteractionCatalog === undefined) {
        throw new Error(
          `Expected the frozen Blender InteractionCatalog ${catalogVersion} snapshot`,
        );
      }
      const runtime = await startRuntime({
        databasePath: ':memory:',
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      try {
        const targetInstanceId = randomUUID();
        const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            targetAdapterId: 'blender',
            actionCatalogVersion: frozenInteractionCatalog.actionCatalogVersion,
            interactionCatalogVersion: frozenInteractionCatalog.catalogVersion,
            goal,
            treeId: 'snowman.eye.left.procedure',
            revision: 1,
            locale: 'zh-CN',
          }),
        });
        expect(promptResponse.status).toBe(200);
        const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
        const tree = fixture(packet);
        const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
          (node) => node['kind'] === 'leaf',
        );
        if (leaf === undefined) throw new Error('Expected one frozen replay leaf');
        const replayRequest = {
          formatVersion: '1.0.0',
          replayId: randomUUID(),
          targetInstanceId,
          leafId: String(leaf['id']),
          replayMode: 'managed_action',
          packet,
          tree,
        } as const;
        const proposedMcp = await callMcpTool(
          runtime,
          8951,
          'operatingline.procedure.replay.propose',
          replayRequest,
        );
        expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
        const proposed = procedureLeafReplayProposalResultSchema.parse(
          proposedMcp.result?.structuredContent,
        );
        expect(proposed.binding.materialization).toMatchObject({
          catalogBinding: { interactionCatalogVersion: catalogVersion },
          coverage: [expect.objectContaining({ mcp: 'unavailable' })],
        });

        const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
          method: 'POST',
          headers,
          body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
        });
        expect(sessionResponse.status).toBe(200);
        const session = (await sessionResponse.json()) as { leaseId: string };
        const leaseHeaders = {
          ...headers,
          'x-operatingline-companion-lease': session.leaseId,
        };
        const proposal = proposed.binding.proposal;
        const decisionResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
          {
            method: 'POST',
            headers: leaseHeaders,
            body: JSON.stringify({
              protocolVersion: guideProtocolVersion,
              decisionId: randomUUID(),
              proposalId: proposal.proposalId,
              adapterId: 'blender',
              instanceId: targetInstanceId,
              decision: 'accepted',
              occurredAt: new Date().toISOString(),
            }),
          },
        );
        expect(decisionResponse.status).toBe(200);

        const executionId = randomUUID();
        const planContentSha256 = computePlanContentSha256(proposal.plan);
        const startedAt = new Date().toISOString();
        const startReport = {
          protocolVersion: guideProtocolVersion,
          reportId: randomUUID(),
          sequence: 1,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          companionVersion: '0.1.0',
          hostVersion: '4.5.3 LTS',
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
            committedAt: startedAt,
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
          occurredAt: startedAt,
        } as const;
        const startResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(startReport),
        });
        expect(startResponse.status).toBe(200);

        const execution = await callMcpTool(runtime, 8952, 'operatingline.blender.action.execute', {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          replayId: replayRequest.replayId,
          expectedState: { reportId: startReport.reportId, sequence: startReport.sequence },
        });
        expect(execution.result?.isError).toBe(true);
        expect(execution.result?.content?.[0]?.text).toContain(
          'Replay binding lacks the exact catalog-grounded managed primitive MCP call',
        );
      } finally {
        await runtime.stop();
      }
    },
  );

  // This table proves the orchestration result gate for each newly authorized primitive.
  // The later topology-attestation cases prove their stronger geometry claims.
  it.each([
    {
      primitive: 'icosphere',
      actionName: 'blender.mesh.create_icosphere',
      goal: '创建一个三级细分、半径 1.75 的 Icosphere。',
      fixture: icosphereReplayAuthoringCandidateFixture,
      topology: { vertexCount: 162, edgeCount: 480, faceCount: 320 },
      geometryDetailKeys: ['radiusMatches'],
    },
    {
      primitive: 'cube',
      actionName: 'blender.mesh.create_cube',
      goal: '创建一个边长 2.5、位置精确的 Cube。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'cube'),
      topology: { vertexCount: 8, edgeCount: 12, faceCount: 6 },
      geometryDetailKeys: ['sizeMatches'],
    },
    {
      primitive: 'plane',
      actionName: 'blender.mesh.create_plane',
      goal: '创建一个边长 12.5、位置精确的 Plane。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'plane'),
      topology: { vertexCount: 4, edgeCount: 4, faceCount: 1 },
      geometryDetailKeys: ['sizeMatches'],
    },
    {
      primitive: 'torus',
      actionName: 'blender.mesh.create_torus',
      goal: '创建一个分段、半径和位置精确的 Torus。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'torus'),
      topology: { vertexCount: 576, edgeCount: 1152, faceCount: 576 },
      geometryDetailKeys: ['geometryMatches'],
    },
    {
      primitive: 'cone',
      actionName: 'blender.mesh.create_cone',
      goal: '创建一个端点、半径和方向精确的 Cone。',
      fixture: (packet: ProcedureAuthoringPromptPacket) =>
        primitiveReplayAuthoringCandidateFixture(packet, 'cone'),
      topology: { vertexCount: 64, edgeCount: 96, faceCount: 34 },
      geometryDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'],
    },
  ])(
    'gates the accepted $primitive orchestration result on its exact action-level MCP and Start checkpoint',
    async ({ primitive, actionName, goal, fixture, topology, geometryDetailKeys }) => {
      const runtime = await startRuntime({
        databasePath: ':memory:',
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      try {
        const targetInstanceId = randomUUID();
        const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            targetAdapterId: 'blender',
            actionCatalogVersion: blenderActionCatalog.catalogVersion,
            interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
            goal,
            treeId: 'snowman.eye.left.procedure',
            revision: 1,
            locale: 'zh-CN',
          }),
        });
        expect(promptResponse.status).toBe(200);
        const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
        const tree = fixture(packet);
        const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
          (node) => node['kind'] === 'leaf',
        );
        if (leaf === undefined) throw new Error(`Expected one ${primitive} replay leaf`);
        const replayRequest = {
          formatVersion: '1.0.0',
          replayId: randomUUID(),
          targetInstanceId,
          leafId: String(leaf['id']),
          replayMode: 'managed_action',
          packet,
          tree,
        } as const;
        const proposedMcp = await callMcpTool(
          runtime,
          896,
          'operatingline.procedure.replay.propose',
          replayRequest,
        );
        expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
        const proposed = procedureLeafReplayProposalResultSchema.parse(
          proposedMcp.result?.structuredContent,
        );
        expect(proposed.binding).toMatchObject({
          actionName,
          claims: { mcpTrack: 'catalog_grounded_not_executed' },
          materialization: {
            formatVersion: '1.4.0',
            coverage: [expect.objectContaining({ mcp: 'materialized' })],
          },
        });
        const proposal = proposed.binding.proposal;
        const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
        const expectedObservation = step?.expectedObservations[0];
        if (
          step?.action === null ||
          step?.action === undefined ||
          expectedObservation === undefined
        ) {
          throw new Error(`Expected one executable ${primitive} replay step`);
        }
        expect(step.action).toEqual({
          adapterId: 'blender',
          name: actionName,
          arguments: leaf['action'] instanceof Object ? leaf['action']['arguments'] : undefined,
        });

        const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
          method: 'POST',
          headers,
          body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
        });
        expect(sessionResponse.status).toBe(200);
        const session = (await sessionResponse.json()) as { leaseId: string };
        const leaseHeaders = {
          ...headers,
          'x-operatingline-companion-lease': session.leaseId,
        };
        const decisionResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
          {
            method: 'POST',
            headers: leaseHeaders,
            body: JSON.stringify({
              protocolVersion: guideProtocolVersion,
              decisionId: randomUUID(),
              proposalId: proposal.proposalId,
              adapterId: 'blender',
              instanceId: targetInstanceId,
              decision: 'accepted',
              occurredAt: new Date().toISOString(),
            }),
          },
        );
        expect(decisionResponse.status).toBe(200);

        const executionId = randomUUID();
        const planContentSha256 = computePlanContentSha256(proposal.plan);
        const startedAt = new Date().toISOString();
        const startReport = {
          protocolVersion: guideProtocolVersion,
          reportId: randomUUID(),
          sequence: 1,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          companionVersion: '0.1.0',
          hostVersion: '4.5.3 LTS',
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
            committedAt: startedAt,
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
          occurredAt: startedAt,
        } as const;
        const startResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(startReport),
        });
        expect(startResponse.status).toBe(200);

        const actionRequest = {
          formatVersion: '1.0.0',
          requestId: randomUUID(),
          replayId: replayRequest.replayId,
          expectedState: { reportId: startReport.reportId, sequence: startReport.sequence },
        } as const;
        const queuedMcp = await callMcpTool(
          runtime,
          897,
          'operatingline.blender.action.execute',
          actionRequest,
        );
        expect(queuedMcp.result?.isError, queuedMcp.result?.content?.[0]?.text).not.toBe(true);
        expect(
          companionActionExecutionStatusSchema.parse(queuedMcp.result?.structuredContent),
        ).toMatchObject({
          requestId: actionRequest.requestId,
          replayId: replayRequest.replayId,
          status: 'queued',
          step,
        });

        const actionPollUrl = new URL('/api/v1/companion/action', runtime.baseUrl);
        actionPollUrl.searchParams.set('adapterId', 'blender');
        actionPollUrl.searchParams.set('instanceId', targetInstanceId);
        const deliveryResponse = await fetch(actionPollUrl, { headers: leaseHeaders });
        expect(deliveryResponse.status).toBe(200);
        const delivery = companionActionPollDeliverySchema.parse(
          await deliveryResponse.json(),
        ).request;
        expect(delivery).not.toBeNull();
        expect(delivery).toMatchObject({
          requestId: actionRequest.requestId,
          replayId: replayRequest.replayId,
          proposalId: proposal.proposalId,
          executionId,
          expectedState: actionRequest.expectedState,
          step: {
            id: replayRequest.leafId,
            action: step.action,
          },
        });

        await waitUntilAfter(delivery!.dispatchedAt);
        const fullObservationDetails = strongPrimitiveObservationDetails({
          parameters: expectedObservation.parameters,
          topology,
          geometryDetailKeys,
        });
        const reportFor = (sequence: number, details: Record<string, unknown>) => {
          const occurredAt = new Date().toISOString();
          return {
            ...startReport,
            reportId: randomUUID(),
            sequence,
            phase: 'completed' as const,
            activeStepId: replayRequest.leafId,
            completedStepIds: [replayRequest.leafId],
            transition: 'step_succeeded' as const,
            stepId: replayRequest.leafId,
            observations: [{ kind: expectedObservation.kind, satisfied: true, details }],
            nativeUndoCheckpoint: replayNativeUndoCheckpoint({
              planId: proposal.plan.id,
              planRevision: proposal.plan.revision,
              planContentSha256,
              executionId,
              stepId: replayRequest.leafId,
              occurredAt,
              operation: 'next',
              previousCheckpointId: startReport.nativeUndoCheckpoint.checkpointId,
            }),
            occurredAt,
          };
        };
        const postState = async (report: ReturnType<typeof reportFor>) => {
          const response = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
            method: 'POST',
            headers: leaseHeaders,
            body: JSON.stringify(report),
          });
          expect(response.status).toBe(200);
        };
        const resultFor = (report: ReturnType<typeof reportFor>) => ({
          formatVersion: '1.0.0',
          requestId: delivery!.requestId,
          replayId: delivery!.replayId,
          deliveryId: delivery!.deliveryId,
          target: delivery!.target,
          proposalId: delivery!.proposalId,
          plan: delivery!.plan,
          planContentSha256: delivery!.planContentSha256,
          executionId: delivery!.executionId,
          expectedState: delivery!.expectedState,
          stepId: delivery!.step.id,
          status: 'succeeded' as const,
          report: { reportId: report.reportId, sequence: report.sequence },
          error: null,
          occurredAt: report.occurredAt,
        });
        const postResult = (report: ReturnType<typeof reportFor>) =>
          fetch(`${runtime.baseUrl}/api/v1/companion/action-result`, {
            method: 'POST',
            headers: leaseHeaders,
            body: JSON.stringify(resultFor(report)),
          });

        let successSequence = startReport.sequence + 1;
        if (primitive === 'torus') {
          const missingGeometryDetails: Record<string, unknown> =
            structuredClone(fullObservationDetails);
          delete missingGeometryDetails['geometryMatches'];
          const missingGeometryReport = reportFor(successSequence++, missingGeometryDetails);
          await postState(missingGeometryReport);
          const missingGeometryResult = await postResult(missingGeometryReport);
          expect(missingGeometryResult.status).toBe(409);
          await expect(missingGeometryResult.json()).resolves.toMatchObject({
            error: 'action_execution_observation_mismatch',
          });
          expect(
            companionActionExecutionStatusSchema.parse(
              (
                await callMcpTool(runtime, 8971, 'operatingline.blender.action.status', {
                  requestId: actionRequest.requestId,
                })
              ).result?.structuredContent,
            ),
          ).toMatchObject({ status: 'dispatched' });

          const wrongTopologyReport = reportFor(successSequence++, {
            ...fullObservationDetails,
            vertexCount: topology.vertexCount + 1,
          });
          await postState(wrongTopologyReport);
          const wrongTopologyResult = await postResult(wrongTopologyReport);
          expect(wrongTopologyResult.status).toBe(409);
          await expect(wrongTopologyResult.json()).resolves.toMatchObject({
            error: 'action_execution_observation_mismatch',
          });
          expect(
            companionActionExecutionStatusSchema.parse(
              (
                await callMcpTool(runtime, 8972, 'operatingline.blender.action.status', {
                  requestId: actionRequest.requestId,
                })
              ).result?.structuredContent,
            ),
          ).toMatchObject({ status: 'dispatched' });
        }

        const successReport = reportFor(successSequence, fullObservationDetails);
        await postState(successReport);
        const result = resultFor(successReport);
        const resultResponse = await postResult(successReport);
        expect(resultResponse.status).toBe(200);
        await expect(resultResponse.json()).resolves.toEqual({ result: 'accepted' });

        const statusMcp = await callMcpTool(runtime, 898, 'operatingline.blender.action.status', {
          requestId: actionRequest.requestId,
        });
        expect(
          companionActionExecutionStatusSchema.parse(statusMcp.result?.structuredContent),
        ).toMatchObject({ status: 'succeeded', result });
      } finally {
        await runtime.stop();
      }
    },
  );

  it('attests only an approved terminal managed UV Sphere replay without upgrading UI tracks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-current-state-replay-'));
    const databasePath = join(directory, 'state.db');
    let runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const targetInstanceId = randomUUID();
      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '制作雪人的头部，并创建、定位、缩放和命名左眼球体。',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          locale: 'zh-CN',
        }),
      });
      expect(promptResponse.status).toBe(200);
      const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
      const weakRequest = {
        formatVersion: '1.0.0',
        replayId: randomUUID(),
        targetInstanceId,
        leafId: 'snowman.head.eyes.left',
        replayMode: 'managed_action',
        packet,
        tree: authoringCandidateFixture(packet),
      };
      const multiLeafTree = replayAuthoringCandidateFixture(packet);
      const replayLeaf = (multiLeafTree['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['id'] === weakRequest.leafId,
      );
      if (replayLeaf === undefined) throw new Error('Expected one replay leaf');
      const manualLeaf = structuredClone(replayLeaf);
      manualLeaf['id'] = 'snowman.head.eyes.manual-check';
      manualLeaf['order'] = 2;
      manualLeaf['action'] = null;
      manualLeaf['expectedObservations'] = [];
      delete manualLeaf['observationPolicy'];
      manualLeaf['rollback'] = { mode: 'checkpoint_restore', checkpointRequired: true };
      (multiLeafTree['nodes'] as Array<Record<string, unknown>>).push(manualLeaf);
      const multiLeafProposal = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...weakRequest, replayId: randomUUID(), tree: multiLeafTree }),
      });
      expect(multiLeafProposal.status).toBe(422);
      await expect(multiLeafProposal.json()).resolves.toMatchObject({
        error: 'procedure_leaf_replay_proposal_failed',
        message: expect.stringContaining('exactly one materialized leaf'),
      });
      const weakProposal = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(weakRequest),
      });
      expect(weakProposal.status).toBe(422);
      await expect(weakProposal.json()).resolves.toMatchObject({
        error: 'procedure_leaf_replay_proposal_failed',
        message: expect.stringContaining('uv_sphere_ready'),
      });

      const replayTree = replayAuthoringCandidateFixture(packet);
      const retryLeaf = (replayTree['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['id'] === weakRequest.leafId,
      );
      if (retryLeaf === undefined) throw new Error('Expected one retry replay leaf');
      retryLeaf['observationPolicy'] = {
        mode: 'success_gate',
        failureStrategy: 'rollback_step',
        retryPolicy: { mode: 'automatic_bounded', maxAttempts: 2 },
      };
      const replayRequest = {
        ...weakRequest,
        replayId: randomUUID(),
        tree: replayTree,
      };
      const proposedMcp = await callMcpTool(
        runtime,
        900,
        'operatingline.procedure.replay.propose',
        replayRequest,
      );
      expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
      const proposed = procedureLeafReplayProposalResultSchema.parse(
        proposedMcp.result?.structuredContent,
      );
      expect(proposed).toMatchObject({
        status: 'accepted',
        binding: {
          replayId: replayRequest.replayId,
          targetInstanceId,
          leafId: replayRequest.leafId,
          request: replayRequest,
          claims: {
            materialization: 'catalog_grounded',
            approval: 'pending',
            hostExecutionStarted: false,
            managedActionResult: 'pending',
            menuTrack: 'catalog_grounded_not_executed',
            shortcutTrack: 'candidate_not_executed',
            mcpTrack: 'catalog_grounded_not_executed',
          },
        },
      });
      const proposal = proposed.binding.proposal;
      expect(proposed.binding.materialization.coverage).toEqual([
        expect.objectContaining({
          leafId: replayRequest.leafId,
          menu: 'materialized',
          shortcut: 'materialized',
          mcp: 'materialized',
        }),
      ]);

      const duplicateProposal = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify(replayRequest),
      });
      expect(duplicateProposal.status).toBe(200);
      await expect(duplicateProposal.json()).resolves.toMatchObject({
        status: 'duplicate',
        binding: { replayId: replayRequest.replayId, proposal },
      });
      const conflictingProposal = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/propose`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...replayRequest, targetInstanceId: randomUUID() }),
        },
      );
      expect(conflictingProposal.status).toBe(409);

      const delivery = await fetch(
        `${runtime.baseUrl}/api/v1/companion/guide?adapterId=blender&instanceId=${targetInstanceId}`,
        { headers },
      );
      expect(delivery.status).toBe(200);
      await expect(delivery.json()).resolves.toMatchObject({
        plan: null,
        proposal: { proposalId: proposal.proposalId, targetInstanceId },
        proposalPlanContentSha256: proposed.binding.planContentSha256,
      });

      const prematureFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replayId: replayRequest.replayId,
          attestationId: randomUUID(),
          reportId: randomUUID(),
        }),
      });
      expect(prematureFinalize.status).toBe(409);

      const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
      if (step?.action === null || step?.action === undefined) {
        throw new Error('Expected replay proposal action step');
      }
      const observationParameters = step.expectedObservations[0]?.parameters;
      const resourceId = observationParameters?.['resourceId'];
      const objectName = observationParameters?.['objectName'];
      if (typeof resourceId !== 'string' || typeof objectName !== 'string') {
        throw new Error('Expected replay observation identities');
      }
      const executionId = randomUUID();
      const report = (sequence: number, hostVersion: string) => {
        const occurredAt = new Date(Date.now() - 1_000 + sequence).toISOString();
        const planContentSha256 = computePlanContentSha256(proposal.plan);
        return {
          protocolVersion: guideProtocolVersion,
          reportId: randomUUID(),
          sequence,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          companionVersion: '0.1.0',
          hostVersion,
          plan: { id: proposal.plan.id, revision: proposal.plan.revision },
          planContentSha256,
          executionId,
          phase: 'completed',
          activeStepId: replayRequest.leafId,
          completedStepIds: [replayRequest.leafId],
          transition: 'step_succeeded',
          stepId: replayRequest.leafId,
          observations: [
            {
              kind: 'uv_sphere_ready',
              satisfied: true,
              details: {
                parameters: observationParameters,
                supported: true,
                resourceId,
                objectName,
                meshId: `${resourceId}.mesh`,
                collectionId: 'snowman.collection',
                parametersValid: true,
                objectOwned: true,
                meshOwned: true,
                collectionOwned: true,
                receiptMatches: true,
                objectDataMatches: true,
                collectionLinkMatches: true,
                nameMatches: true,
                locationMatches: true,
                rotationMatches: true,
                scaleMatches: true,
                transformIsolated: true,
                modifiersAbsent: true,
                shapeKeysAbsent: true,
                materialsAbsent: true,
                contentIntact: true,
                topologyMatches: true,
                finiteCoordinates: true,
                radiusMatches: true,
                vertexCount: 482,
                edgeCount: 992,
                faceCount: 512,
                meshContentSha256: 'a'.repeat(64),
              },
            },
          ],
          observationGate: null,
          artifactAttestation: null,
          nativeUndoCheckpoint: replayNativeUndoCheckpoint({
            planId: proposal.plan.id,
            planRevision: proposal.plan.revision,
            planContentSha256,
            executionId,
            stepId: replayRequest.leafId,
            occurredAt,
          }),
          error: null,
          occurredAt,
        };
      };

      const legacyReport = report(1, '4.5.3 LTS');
      const legacyState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify(legacyReport),
      });
      expect(legacyState.status).toBe(200);

      const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
      });
      expect(sessionResponse.status).toBe(200);
      let session = (await sessionResponse.json()) as { leaseId: string };
      let leaseHeaders = {
        ...headers,
        'x-operatingline-companion-lease': session.leaseId,
      };

      const decision = {
        protocolVersion: guideProtocolVersion,
        decisionId: randomUUID(),
        proposalId: proposal.proposalId,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        decision: 'accepted',
        occurredAt: new Date(Date.now() - 10_000).toISOString(),
      };
      const unauthenticatedDecision = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        { method: 'POST', headers, body: JSON.stringify(decision) },
      );
      expect(unauthenticatedDecision.status).toBe(409);
      await expect(unauthenticatedDecision.json()).resolves.toMatchObject({
        error: 'companion_lease_required',
      });

      const preDecisionReport = report(2, '4.5.3 LTS');
      const unauthenticatedState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify(preDecisionReport),
      });
      expect(unauthenticatedState.status).toBe(409);
      await expect(unauthenticatedState.json()).resolves.toMatchObject({
        error: 'lease_not_current',
      });
      const preDecisionState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(preDecisionReport),
      });
      expect(preDecisionState.status).toBe(200);

      const decisionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        { method: 'POST', headers: leaseHeaders, body: JSON.stringify(decision) },
      );
      expect(decisionResponse.status).toBe(200);
      await expect(decisionResponse.json()).resolves.toEqual({ result: 'accepted' });

      const legacyFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replayId: replayRequest.replayId,
          attestationId: randomUUID(),
          reportId: legacyReport.reportId,
        }),
      });
      expect(legacyFinalize.status).toBe(409);

      const reportBeforeDecisionFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: replayRequest.replayId,
            attestationId: randomUUID(),
            reportId: preDecisionReport.reportId,
          }),
        },
      );
      expect(reportBeforeDecisionFinalize.status).toBe(409);

      const weakReport = report(3, '4.5.3 LTS');
      weakReport.observations[0]!.details = {
        parameters: observationParameters,
        supported: true,
      } as (typeof weakReport.observations)[number]['details'];
      const weakState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(weakReport),
      });
      expect(weakState.status).toBe(200);
      const weakFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replayId: replayRequest.replayId,
          attestationId: randomUUID(),
          reportId: weakReport.reportId,
        }),
      });
      expect(weakFinalize.status).toBe(409);

      const incompatibleReport = report(4, '5.0.0');
      const incompatibleState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(incompatibleReport),
      });
      expect(incompatibleState.status).toBe(409);
      await expect(incompatibleState.json()).resolves.toMatchObject({
        error: 'companion_session_identity_mismatch',
      });

      const mismatchedRetryReport = {
        ...report(5, '4.5.3 LTS'),
        observationRetry: {
          mode: 'automatic_bounded',
          attempts: 2,
          maxAttempts: 3,
          outcome: 'succeeded_after_retry',
        },
      } as const;
      const mismatchedRetryState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(mismatchedRetryReport),
      });
      expect(mismatchedRetryState.status).toBe(200);
      const mismatchedRetryFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: replayRequest.replayId,
            attestationId: randomUUID(),
            reportId: mismatchedRetryReport.reportId,
          }),
        },
      );
      expect(mismatchedRetryFinalize.status).toBe(409);

      const missingCheckpointReport = report(6, '4.5.3 LTS');
      delete (missingCheckpointReport as { nativeUndoCheckpoint?: unknown }).nativeUndoCheckpoint;
      const missingCheckpointState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(missingCheckpointReport),
      });
      expect(missingCheckpointState.status).toBe(200);
      const missingCheckpointFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: replayRequest.replayId,
            attestationId: randomUUID(),
            reportId: missingCheckpointReport.reportId,
          }),
        },
      );
      expect(missingCheckpointFinalize.status).toBe(409);

      const terminalReport = {
        ...report(7, '4.5.3 LTS'),
        observationRetry: {
          mode: 'automatic_bounded',
          attempts: 2,
          maxAttempts: 2,
          outcome: 'succeeded_after_retry',
        },
      } as const;
      const stateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(terminalReport),
      });
      expect(stateResponse.status).toBe(200);
      await expect(stateResponse.json()).resolves.toEqual({ result: 'accepted' });

      const finalizeRequest = {
        replayId: replayRequest.replayId,
        attestationId: randomUUID(),
        reportId: terminalReport.reportId,
      };
      const finalizedResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalizeRequest),
      });
      expect(finalizedResponse.status).toBe(200);
      const finalized = procedureLeafReplayFinalizeResultSchema.parse(
        await finalizedResponse.json(),
      );
      expect(finalized).toMatchObject({
        status: 'accepted',
        attestation: {
          replayId: replayRequest.replayId,
          attestationId: finalizeRequest.attestationId,
          decision,
          report: terminalReport,
          evidenceClass: 'companion_reported_managed_action_leaf_replay',
          provenance: {
            authentication: 'negotiated_companion_lease',
            sessionFingerprintSha256: createHash('sha256').update(session.leaseId).digest('hex'),
          },
          bindingContentSha256: proposed.binding.integrity.contentSha256,
          execution: {
            action: { adapterId: 'blender', name: 'blender.mesh.create_uv_sphere' },
          },
          verificationScope: {
            managedActionResult: 'verified',
            menuTrack: 'catalog_grounded_not_executed',
            shortcutTrack: 'candidate_not_executed',
            mcpTrack: 'catalog_grounded_not_executed',
            nativeUndoCheckpoint: 'companion_reported_current_at_report',
            currentHostStateAfterReport: 'not_verified',
          },
        },
      });
      expect(finalized.attestation.execution).not.toHaveProperty('entryPoint');
      expect(finalized.attestation.provenance.proposalReceipt.sequence).toBeLessThan(
        finalized.attestation.provenance.decisionReceipt.sequence,
      );
      expect(finalized.attestation.provenance.decisionReceipt.sequence).toBeLessThan(
        finalized.attestation.provenance.reportReceipt.sequence,
      );
      const receiptBase = {
        adapterId: 'blender',
        instanceId: targetInstanceId,
      } as const;
      expect(() =>
        buildProcedureLeafReplayAttestation({
          binding: proposed.binding,
          decision: finalized.attestation.decision,
          report: finalized.attestation.report,
          proposalReceipt: {
            ...receiptBase,
            ...finalized.attestation.provenance.proposalReceipt,
            subjectType: 'replay_proposal',
            subjectId: proposal.proposalId,
            authentication: 'orchestrator_internal',
            sessionFingerprintSha256: null,
          },
          decisionReceipt: {
            ...receiptBase,
            ...finalized.attestation.provenance.decisionReceipt,
            subjectType: 'guide_proposal_decision',
            subjectId: decision.decisionId,
            authentication: 'negotiated_companion_lease',
            sessionFingerprintSha256: finalized.attestation.provenance.sessionFingerprintSha256,
          },
          reportReceipt: {
            ...receiptBase,
            ...finalized.attestation.provenance.reportReceipt,
            subjectType: 'companion_state_report',
            subjectId: terminalReport.reportId,
            authentication: 'negotiated_companion_lease',
            sessionFingerprintSha256: 'b'.repeat(64),
          },
          attestationId: randomUUID(),
          attestedAt: new Date().toISOString(),
        }),
      ).toThrow(/ordered authenticated Companion session receipt chain/);

      const requestCurrentState = async (verificationId: string) => {
        const response = await fetch(
          `${runtime.baseUrl}/api/v1/procedure/replay/current-state/request`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ replayId: replayRequest.replayId, verificationId }),
          },
        );
        expect(response.status).toBe(200);
        return procedureLeafReplayCurrentStateRequestResultSchema.parse(await response.json());
      };
      const deliverCurrentStateRequest = async () => {
        const url = new URL('/api/v1/companion/guide', runtime.baseUrl);
        url.searchParams.set('adapterId', 'blender');
        url.searchParams.set('instanceId', targetInstanceId);
        const response = await fetch(url, { headers: leaseHeaders });
        expect(response.status).toBe(200);
        const payload = (await response.json()) as {
          procedureReplayCurrentStateRequest?: unknown;
        };
        return payload.procedureReplayCurrentStateRequest;
      };
      const verificationId = randomUUID();
      const currentStateMcp = await callMcpTool(
        runtime,
        905,
        'operatingline.procedure.replay.current-state.request',
        { replayId: replayRequest.replayId, verificationId },
      );
      expect(currentStateMcp.result?.isError).not.toBe(true);
      const currentStateRequested = procedureLeafReplayCurrentStateRequestResultSchema.parse(
        currentStateMcp.result?.structuredContent,
      );
      expect(currentStateRequested.status).toBe('accepted');
      expect(await requestCurrentState(verificationId)).toMatchObject({ status: 'duplicate' });
      const competingRequest = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state/request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: replayRequest.replayId,
            verificationId: randomUUID(),
          }),
        },
      );
      expect(competingRequest.status).toBe(409);

      await runtime.stop();
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      const pendingStatusResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state?verificationId=${verificationId}`,
        { headers },
      );
      expect(
        procedureLeafReplayCurrentStateStatusResultSchema.parse(await pendingStatusResponse.json()),
      ).toEqual({ status: 'pending', request: currentStateRequested.request });
      const unauthenticatedDeliveryUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      unauthenticatedDeliveryUrl.searchParams.set('adapterId', 'blender');
      unauthenticatedDeliveryUrl.searchParams.set('instanceId', targetInstanceId);
      const unauthenticatedDelivery = await fetch(unauthenticatedDeliveryUrl, { headers });
      expect(unauthenticatedDelivery.status).toBe(200);
      await expect(unauthenticatedDelivery.json()).resolves.not.toHaveProperty(
        'procedureReplayCurrentStateRequest',
      );
      const restartedSessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
      });
      expect(restartedSessionResponse.status).toBe(200);
      session = (await restartedSessionResponse.json()) as { leaseId: string };
      leaseHeaders = {
        ...headers,
        'x-operatingline-companion-lease': session.leaseId,
      };
      expect(await deliverCurrentStateRequest()).toEqual(currentStateRequested.request);
      const currentStateReport = {
        ...terminalReport,
        reportId: randomUUID(),
        sequence: 8,
        transition: 'current_state_rechecked',
        observationRetry: undefined,
        procedureReplayCurrentStateRequest: currentStateRequested.request,
        occurredAt: new Date().toISOString(),
      } as const;
      const currentStateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(currentStateReport),
      });
      expect(currentStateResponse.status).toBe(200);
      const currentStateStatusResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state?verificationId=${verificationId}`,
        { headers },
      );
      expect(currentStateStatusResponse.status).toBe(200);
      const currentStateStatus = procedureLeafReplayCurrentStateStatusResultSchema.parse(
        await currentStateStatusResponse.json(),
      );
      expect(currentStateStatus).toMatchObject({
        status: 'completed',
        verification: {
          outcome: 'verified',
          reason: 'verified',
          verificationScope: {
            managedActionCurrentState: 'verified_at_report',
            nativeUndoCheckpoint: 'companion_reported_current_at_report',
            currentHostStateAfterReport: 'not_verified',
          },
        },
      });
      const currentStateMcpGet = await callMcpTool(
        runtime,
        906,
        'operatingline.procedure.replay.current-state.get',
        { verificationId },
      );
      expect(currentStateMcpGet.result?.isError).not.toBe(true);
      expect(
        procedureLeafReplayCurrentStateStatusResultSchema.parse(
          currentStateMcpGet.result?.structuredContent,
        ),
      ).toEqual(currentStateStatus);
      expect(await requestCurrentState(verificationId)).toMatchObject({ status: 'duplicate' });

      const driftVerificationId = randomUUID();
      const driftRequested = await requestCurrentState(driftVerificationId);
      expect(await deliverCurrentStateRequest()).toEqual(driftRequested.request);
      const driftReport = {
        ...terminalReport,
        reportId: randomUUID(),
        sequence: 9,
        transition: 'current_state_rechecked',
        observationRetry: undefined,
        observations: [
          {
            ...terminalReport.observations[0],
            satisfied: false,
            details: {
              ...terminalReport.observations[0]!.details,
              contentIntact: false,
            },
          },
        ],
        procedureReplayCurrentStateRequest: driftRequested.request,
        occurredAt: new Date().toISOString(),
      } as const;
      const driftResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(driftReport),
      });
      expect(driftResponse.status).toBe(200);
      const driftStatusResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state?verificationId=${driftVerificationId}`,
        { headers },
      );
      const driftStatus = procedureLeafReplayCurrentStateStatusResultSchema.parse(
        await driftStatusResponse.json(),
      );
      expect(driftStatus).toMatchObject({
        status: 'completed',
        verification: {
          outcome: 'not_verified',
          reason: 'observation_mismatch',
          verificationScope: {
            managedActionCurrentState: 'not_verified_at_report',
            nativeUndoCheckpoint: 'companion_reported_current_at_report',
          },
        },
      });

      const duplicateFinalize = await callMcpTool(
        runtime,
        901,
        'operatingline.procedure.replay.finalize',
        finalizeRequest,
      );
      expect(duplicateFinalize.result?.isError).not.toBe(true);
      expect(
        procedureLeafReplayFinalizeResultSchema.parse(duplicateFinalize.result?.structuredContent),
      ).toMatchObject({ status: 'duplicate', attestation: finalized.attestation });
      const conflictingFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...finalizeRequest, attestationId: randomUUID() }),
        },
      );
      expect(conflictingFinalize.status).toBe(409);
      const unknownFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replayId: randomUUID(),
          attestationId: randomUUID(),
          reportId: terminalReport.reportId,
        }),
      });
      expect(unknownFinalize.status).toBe(404);

      const evalUrl = new URL('/api/v1/eval/export', runtime.baseUrl);
      evalUrl.searchParams.set('targetAdapterId', 'blender');
      evalUrl.searchParams.set('planId', proposal.plan.id);
      evalUrl.searchParams.set('instanceId', targetInstanceId);
      const evalResponse = await fetch(evalUrl, { headers });
      expect(evalResponse.status).toBe(200);
      const evalBundle = (await evalResponse.json()) as {
        summary: { eventTypeCounts: Record<string, number> };
        events: Array<{ eventType: string; payload: unknown }>;
      };
      expect(evalBundle.summary.eventTypeCounts).toMatchObject({
        'procedure.leaf-replay.proposed': 1,
        'procedure.leaf-replay.attested': 1,
        'procedure.leaf-replay.current-state.requested': 2,
        'procedure.leaf-replay.current-state.completed': 2,
      });
      expect(
        evalBundle.events.filter((event) => event.eventType.startsWith('procedure.leaf-replay.')),
      ).toEqual([
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.proposed',
          payload: proposed.binding,
        }),
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.attested',
          payload: finalized.attestation,
        }),
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.current-state.requested',
          payload: currentStateRequested.request,
        }),
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.current-state.completed',
        }),
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.current-state.requested',
          payload: driftRequested.request,
        }),
        expect.objectContaining({
          eventType: 'procedure.leaf-replay.current-state.completed',
        }),
      ]);
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('attests automatic rollback and checkpointed repair recovery as exclusive replay outcomes', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const targetInstanceId = randomUUID();
      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '创建一个可验证失败、回退和修复恢复的 UV Sphere。',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          locale: 'zh-CN',
        }),
      });
      const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
      const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
      });
      expect(sessionResponse.status).toBe(200);
      const session = (await sessionResponse.json()) as { leaseId: string };
      const leaseHeaders = {
        ...headers,
        'x-operatingline-companion-lease': session.leaseId,
      };
      let reportSequence = 0;

      const prepareReplay = async (
        failureStrategy: 'rollback_step' | 'retain_for_repair',
        replayPacket: ProcedureAuthoringPromptPacket = packet,
        retryMaxAttempts?: 2 | 3,
      ) => {
        const tree = replayAuthoringCandidateFixture(replayPacket);
        tree['id'] = replayPacket.context.requestedTreeId;
        tree['revision'] = replayPacket.context.recommendedRevision;
        const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
          (node) => node['kind'] === 'leaf',
        );
        if (leaf === undefined) throw new Error('Expected one recovery replay leaf');
        leaf['observationPolicy'] = {
          mode: 'success_gate',
          failureStrategy,
          ...(retryMaxAttempts === undefined
            ? {}
            : {
                retryPolicy: {
                  mode: 'automatic_bounded',
                  maxAttempts: retryMaxAttempts,
                },
              }),
        };
        const replayRequest = {
          formatVersion: '1.0.0' as const,
          replayId: randomUUID(),
          targetInstanceId,
          leafId: String(leaf['id']),
          replayMode: 'managed_action' as const,
          packet: replayPacket,
          tree,
        };
        const proposedResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/propose`, {
          method: 'POST',
          headers,
          body: JSON.stringify(replayRequest),
        });
        const proposedPayload = await proposedResponse.json();
        expect(proposedResponse.status, JSON.stringify(proposedPayload)).toBe(200);
        const proposed = procedureLeafReplayProposalResultSchema.parse(proposedPayload);
        const proposal = proposed.binding.proposal;
        const decision = {
          protocolVersion: guideProtocolVersion,
          decisionId: randomUUID(),
          proposalId: proposal.proposalId,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          decision: 'accepted',
          occurredAt: new Date(Date.now() - 10_000).toISOString(),
        } as const;
        const decisionResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
          { method: 'POST', headers: leaseHeaders, body: JSON.stringify(decision) },
        );
        expect(decisionResponse.status).toBe(200);
        const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
        const parameters = step?.expectedObservations[0]?.parameters;
        const resourceId = parameters?.['resourceId'];
        const objectName = parameters?.['objectName'];
        if (
          step?.action === null ||
          step?.action === undefined ||
          typeof resourceId !== 'string' ||
          typeof objectName !== 'string'
        ) {
          throw new Error('Expected one executable recovery replay step');
        }
        return { replayRequest, proposed, proposal, parameters, resourceId, objectName };
      };

      const strongObservation = (input: {
        parameters: Record<string, unknown>;
        resourceId: string;
        objectName: string;
      }) => ({
        kind: 'uv_sphere_ready' as const,
        satisfied: true as const,
        details: {
          parameters: input.parameters,
          supported: true,
          resourceId: input.resourceId,
          objectName: input.objectName,
          meshId: `${input.resourceId}.mesh`,
          collectionId: 'snowman.collection',
          parametersValid: true,
          objectOwned: true,
          meshOwned: true,
          collectionOwned: true,
          receiptMatches: true,
          objectDataMatches: true,
          collectionLinkMatches: true,
          nameMatches: true,
          locationMatches: true,
          rotationMatches: true,
          scaleMatches: true,
          transformIsolated: true,
          modifiersAbsent: true,
          shapeKeysAbsent: true,
          materialsAbsent: true,
          contentIntact: true,
          topologyMatches: true,
          finiteCoordinates: true,
          radiusMatches: true,
          vertexCount: 482,
          edgeCount: 992,
          faceCount: 512,
          meshContentSha256: 'a'.repeat(64),
        },
      });
      const postState = async (report: Record<string, unknown>) => {
        const response = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(report),
        });
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      };

      const retained = await prepareReplay('retain_for_repair');
      const retainedExecutionId = randomUUID();
      const retainedPlanSha256 = computePlanContentSha256(retained.proposal.plan);
      const failureOccurredAt = new Date().toISOString();
      const retainedFailureReport = {
        protocolVersion: guideProtocolVersion,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        companionVersion: '0.1.0',
        hostVersion: '4.5.3 LTS',
        plan: { id: retained.proposal.plan.id, revision: retained.proposal.plan.revision },
        planContentSha256: retainedPlanSha256,
        executionId: retainedExecutionId,
        phase: 'blocked',
        activeStepId: retained.replayRequest.leafId,
        completedStepIds: [],
        transition: 'step_observation_failed',
        stepId: retained.replayRequest.leafId,
        observations: [
          {
            kind: 'uv_sphere_ready',
            satisfied: false,
            details: {
              parameters: retained.parameters,
              supported: true,
              contentIntact: false,
            },
          },
        ],
        observationGate: {
          stepId: retained.replayRequest.leafId,
          status: 'repair_required',
          failureStrategy: 'retain_for_repair',
          message: 'Repair the retained managed step.',
        },
        artifactAttestation: null,
        nativeUndoCheckpoint: replayNativeUndoCheckpoint({
          planId: retained.proposal.plan.id,
          planRevision: retained.proposal.plan.revision,
          planContentSha256: retainedPlanSha256,
          executionId: retainedExecutionId,
          stepId: retained.replayRequest.leafId,
          occurredAt: failureOccurredAt,
          completedStepIds: [],
        }),
        error: null,
        occurredAt: failureOccurredAt,
      } as const;
      await postState(retainedFailureReport);
      const recoveryOccurredAt = new Date(Date.now() + 1).toISOString();
      const retainedRecoveryReport = {
        ...retainedFailureReport,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        phase: 'completed',
        completedStepIds: [retained.replayRequest.leafId],
        transition: 'observation_recovered',
        observations: [strongObservation(retained)],
        observationGate: {
          ...retainedFailureReport.observationGate,
          status: 'recovered',
          message: 'The repaired managed step passed its Observation.',
        },
        nativeUndoCheckpoint: replayNativeUndoCheckpoint({
          planId: retained.proposal.plan.id,
          planRevision: retained.proposal.plan.revision,
          planContentSha256: retainedPlanSha256,
          executionId: retainedExecutionId,
          stepId: retained.replayRequest.leafId,
          occurredAt: recoveryOccurredAt,
          operation: 'recheck',
        }),
        occurredAt: recoveryOccurredAt,
      } as const;
      await postState(retainedRecoveryReport);
      const retainedFinalizeRequest = {
        replayId: retained.replayRequest.replayId,
        attestationId: randomUUID(),
        failureReportId: retainedFailureReport.reportId,
        recoveryReportId: retainedRecoveryReport.reportId,
      };
      const retainedFinalize = await callMcpTool(
        runtime,
        920,
        'operatingline.procedure.replay.failure-recovery.finalize',
        retainedFinalizeRequest,
      );
      expect(
        retainedFinalize.result?.isError,
        retainedFinalize.result?.content?.[0]?.text,
      ).not.toBe(true);
      const recovered = procedureLeafReplayFailureRecoveryFinalizeResultSchema.parse(
        retainedFinalize.result?.structuredContent,
      );
      expect(recovered).toMatchObject({
        status: 'accepted',
        attestation: {
          outcome: 'recovered_after_repair',
          provenance: {
            executionSessionFingerprintSha256: createHash('sha256')
              .update(session.leaseId)
              .digest('hex'),
            recoverySessionFingerprintSha256: createHash('sha256')
              .update(session.leaseId)
              .digest('hex'),
          },
          verificationScope: {
            rollbackOutcome: 'not_requested',
            recoveryOutcome: 'companion_reported_verified',
            failureNativeUndoCheckpoint: 'companion_reported_current_at_failure_report',
            terminalNativeUndoCheckpoint: 'companion_reported_current_at_recovery_report',
            currentHostStateAfterReport: 'not_verified',
          },
        },
      });
      const conflictingSuccess = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: retained.replayRequest.replayId,
            attestationId: randomUUID(),
            reportId: retainedRecoveryReport.reportId,
          }),
        },
      );
      expect(conflictingSuccess.status).toBe(409);
      const currentStateAfterRecovery = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state/request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: retained.replayRequest.replayId,
            verificationId: randomUUID(),
          }),
        },
      );
      expect(currentStateAfterRecovery.status).toBe(200);
      const recoveredCurrentStateRequest = procedureLeafReplayCurrentStateRequestResultSchema.parse(
        await currentStateAfterRecovery.json(),
      );
      expect(recoveredCurrentStateRequest).toMatchObject({
        status: 'accepted',
        request: {
          replayId: retained.replayRequest.replayId,
          attestationId: recovered.attestation.attestationId,
          expectedObservation: { kind: 'uv_sphere_ready' },
        },
      });
      const recoveredGuideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      recoveredGuideUrl.searchParams.set('adapterId', 'blender');
      recoveredGuideUrl.searchParams.set('instanceId', targetInstanceId);
      const recoveredGuideResponse = await fetch(recoveredGuideUrl, { headers: leaseHeaders });
      expect(recoveredGuideResponse.status).toBe(200);
      const recoveredGuide = (await recoveredGuideResponse.json()) as {
        procedureReplayCurrentStateRequest?: unknown;
      };
      expect(recoveredGuide.procedureReplayCurrentStateRequest).toEqual(
        recoveredCurrentStateRequest.request,
      );
      const recoveredCurrentStateReport = {
        ...retainedRecoveryReport,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        transition: 'current_state_rechecked',
        observationGate: null,
        procedureReplayCurrentStateRequest: recoveredCurrentStateRequest.request,
        occurredAt: new Date().toISOString(),
      } as const;
      await postState(recoveredCurrentStateReport);
      const recoveredCurrentStateStatusResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state?verificationId=${recoveredCurrentStateRequest.request.verificationId}`,
        { headers },
      );
      expect(recoveredCurrentStateStatusResponse.status).toBe(200);
      expect(
        procedureLeafReplayCurrentStateStatusResultSchema.parse(
          await recoveredCurrentStateStatusResponse.json(),
        ),
      ).toMatchObject({
        status: 'completed',
        verification: { outcome: 'verified', reason: 'verified' },
      });

      const rollbackPromptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '创建一个会在 Observation 失败后自动回退的 UV Sphere。',
          treeId: 'snowman.eye.left.procedure',
          revision: 2,
          locale: 'zh-CN',
        }),
      });
      const rollbackPacket = procedureAuthoringPromptPacketSchema.parse(
        await rollbackPromptResponse.json(),
      );
      const rolledBack = await prepareReplay('rollback_step', rollbackPacket);
      const rolledBackExecutionId = randomUUID();
      const rolledBackPlanSha256 = computePlanContentSha256(rolledBack.proposal.plan);
      const rolledBackOccurredAt = new Date().toISOString();
      const rolledBackFailureReport = {
        protocolVersion: guideProtocolVersion,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        companionVersion: '0.1.0',
        hostVersion: '4.5.3 LTS',
        plan: { id: rolledBack.proposal.plan.id, revision: rolledBack.proposal.plan.revision },
        planContentSha256: rolledBackPlanSha256,
        executionId: rolledBackExecutionId,
        phase: 'running',
        activeStepId: null,
        completedStepIds: [],
        transition: 'step_observation_failed',
        stepId: rolledBack.replayRequest.leafId,
        observations: [
          {
            kind: 'uv_sphere_ready',
            satisfied: false,
            details: {
              parameters: rolledBack.parameters,
              supported: true,
              contentIntact: false,
            },
          },
        ],
        observationGate: {
          stepId: rolledBack.replayRequest.leafId,
          status: 'failed_rolled_back',
          failureStrategy: 'rollback_step',
          message: 'The managed step failed and was rolled back.',
        },
        artifactAttestation: null,
        error: null,
        occurredAt: rolledBackOccurredAt,
      } as const;
      await postState(rolledBackFailureReport);
      const rolledBackFinalizeResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/failure-recovery/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: rolledBack.replayRequest.replayId,
            attestationId: randomUUID(),
            failureReportId: rolledBackFailureReport.reportId,
          }),
        },
      );
      expect(rolledBackFinalizeResponse.status).toBe(200);
      const automaticallyRolledBack = procedureLeafReplayFailureRecoveryFinalizeResultSchema.parse(
        await rolledBackFinalizeResponse.json(),
      );
      expect(automaticallyRolledBack).toMatchObject({
        status: 'accepted',
        attestation: {
          outcome: 'automatically_rolled_back',
          recoveryReport: null,
          verificationScope: {
            rollbackOutcome: 'companion_reported_succeeded',
            recoveryOutcome: 'not_required',
            failureNativeUndoCheckpoint: 'not_verified_at_failure_report',
            terminalNativeUndoCheckpoint: 'not_applicable_no_retained_step',
          },
        },
      });
      const duplicateRolledBack = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/failure-recovery/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: rolledBack.replayRequest.replayId,
            attestationId: automaticallyRolledBack.attestation.attestationId,
            failureReportId: rolledBackFailureReport.reportId,
          }),
        },
      );
      expect(duplicateRolledBack.status).toBe(200);
      await expect(duplicateRolledBack.json()).resolves.toMatchObject({ status: 'duplicate' });
      const currentStateAfterRollback = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/current-state/request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: rolledBack.replayRequest.replayId,
            verificationId: randomUUID(),
          }),
        },
      );
      expect(currentStateAfterRollback.status).toBe(409);

      const retryPromptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '最多尝试两次创建 UV Sphere，每次失败后先自动回退。',
          treeId: 'snowman.eye.left.procedure',
          revision: 3,
          locale: 'zh-CN',
        }),
      });
      const retryPacket = procedureAuthoringPromptPacketSchema.parse(
        await retryPromptResponse.json(),
      );
      const retrying = await prepareReplay('rollback_step', retryPacket, 2);
      const retryExecutionId = randomUUID();
      const retryPlanSha256 = computePlanContentSha256(retrying.proposal.plan);
      const retryFailureReport = {
        protocolVersion: guideProtocolVersion,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        companionVersion: '0.1.0',
        hostVersion: '4.5.3 LTS',
        plan: { id: retrying.proposal.plan.id, revision: retrying.proposal.plan.revision },
        planContentSha256: retryPlanSha256,
        executionId: retryExecutionId,
        phase: 'running',
        activeStepId: null,
        completedStepIds: [],
        transition: 'step_observation_failed',
        stepId: retrying.replayRequest.leafId,
        observations: [
          {
            kind: 'uv_sphere_ready',
            satisfied: false,
            details: {
              parameters: retrying.parameters,
              supported: true,
              contentIntact: false,
            },
          },
        ],
        observationGate: {
          stepId: retrying.replayRequest.leafId,
          status: 'retry_scheduled',
          failureStrategy: 'rollback_step',
          message: 'Attempt one failed, rolled back, and scheduled attempt two.',
          retry: {
            mode: 'automatic_bounded',
            attempt: 1,
            maxAttempts: 2,
            remainingAttempts: 1,
            disposition: 'scheduled',
          },
        },
        artifactAttestation: null,
        error: null,
        occurredAt: new Date().toISOString(),
      } as const;
      await postState(retryFailureReport);
      const intermediateFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/failure-recovery/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: retrying.replayRequest.replayId,
            attestationId: randomUUID(),
            failureReportId: retryFailureReport.reportId,
          }),
        },
      );
      expect(intermediateFinalize.status).toBe(409);

      const mismatchedExhaustedReport = {
        ...retryFailureReport,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        observationGate: {
          ...retryFailureReport.observationGate,
          status: 'failed_rolled_back',
          message: 'A report claimed three exhausted attempts.',
          retry: {
            mode: 'automatic_bounded',
            attempt: 3,
            maxAttempts: 3,
            remainingAttempts: 0,
            disposition: 'exhausted',
          },
        },
        occurredAt: new Date().toISOString(),
      } as const;
      await postState(mismatchedExhaustedReport);
      const mismatchedExhaustedFinalize = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/failure-recovery/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: retrying.replayRequest.replayId,
            attestationId: randomUUID(),
            failureReportId: mismatchedExhaustedReport.reportId,
          }),
        },
      );
      expect(mismatchedExhaustedFinalize.status).toBe(409);

      const exhaustedReport = {
        ...retryFailureReport,
        reportId: randomUUID(),
        sequence: ++reportSequence,
        observationGate: {
          ...retryFailureReport.observationGate,
          status: 'failed_rolled_back',
          message: 'Both attempts failed and were rolled back.',
          retry: {
            mode: 'automatic_bounded',
            attempt: 2,
            maxAttempts: 2,
            remainingAttempts: 0,
            disposition: 'exhausted',
          },
        },
        occurredAt: new Date().toISOString(),
      } as const;
      await postState(exhaustedReport);
      const exhaustedFinalizeResponse = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/replay/failure-recovery/finalize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: retrying.replayRequest.replayId,
            attestationId: randomUUID(),
            failureReportId: exhaustedReport.reportId,
          }),
        },
      );
      expect(exhaustedFinalizeResponse.status).toBe(200);
      expect(
        procedureLeafReplayFailureRecoveryFinalizeResultSchema.parse(
          await exhaustedFinalizeResponse.json(),
        ),
      ).toMatchObject({
        status: 'accepted',
        attestation: {
          outcome: 'automatically_rolled_back',
          failureReport: {
            observationGate: {
              status: 'failed_rolled_back',
              retry: {
                attempt: 2,
                maxAttempts: 2,
                remainingAttempts: 0,
                disposition: 'exhausted',
              },
            },
          },
        },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('attests an approved managed Icosphere replay with subdivision-bound topology', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: blenderActionCatalogs,
      interactionCatalogs: blenderInteractionCatalogs,
    });
    try {
      const targetInstanceId = randomUUID();
      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
          goal: '创建一个三级细分、半径 1.75 的 Icosphere。',
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          locale: 'zh-CN',
        }),
      });
      expect(promptResponse.status).toBe(200);
      const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
      const tree = icosphereReplayAuthoringCandidateFixture(packet);
      const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['kind'] === 'leaf',
      );
      if (leaf === undefined) throw new Error('Expected one Icosphere replay leaf');
      const replayRequest = {
        formatVersion: '1.0.0',
        replayId: randomUUID(),
        targetInstanceId,
        leafId: String(leaf['id']),
        replayMode: 'managed_action',
        packet,
        tree,
      };
      const proposedMcp = await callMcpTool(
        runtime,
        902,
        'operatingline.procedure.replay.propose',
        replayRequest,
      );
      expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
      const proposed = procedureLeafReplayProposalResultSchema.parse(
        proposedMcp.result?.structuredContent,
      );
      expect(proposed).toMatchObject({
        status: 'accepted',
        binding: {
          actionName: 'blender.mesh.create_icosphere',
          targetInstanceId,
          leafId: replayRequest.leafId,
          materialization: {
            coverage: [
              expect.objectContaining({
                leafId: replayRequest.leafId,
                menu: 'materialized',
                shortcut: 'materialized',
                mcp: 'materialized',
              }),
            ],
          },
        },
      });

      const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
      });
      expect(sessionResponse.status).toBe(200);
      const session = (await sessionResponse.json()) as { leaseId: string };
      const leaseHeaders = {
        ...headers,
        'x-operatingline-companion-lease': session.leaseId,
      };
      const proposal = proposed.binding.proposal;
      const decision = {
        protocolVersion: guideProtocolVersion,
        decisionId: randomUUID(),
        proposalId: proposal.proposalId,
        adapterId: 'blender',
        instanceId: targetInstanceId,
        decision: 'accepted',
        occurredAt: new Date(Date.now() - 10_000).toISOString(),
      };
      const decisionResponse = await fetch(
        `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
        { method: 'POST', headers: leaseHeaders, body: JSON.stringify(decision) },
      );
      expect(decisionResponse.status).toBe(200);

      const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
      const observationParameters = step?.expectedObservations[0]?.parameters;
      const resourceId = observationParameters?.['resourceId'];
      const objectName = observationParameters?.['objectName'];
      if (typeof resourceId !== 'string' || typeof objectName !== 'string') {
        throw new Error('Expected Icosphere replay observation identities');
      }
      const report = (sequence: number, vertexCount: number) => {
        const occurredAt = new Date(Date.now() - 1_000 + sequence).toISOString();
        const planContentSha256 = computePlanContentSha256(proposal.plan);
        const executionId = randomUUID();
        return {
          protocolVersion: guideProtocolVersion,
          reportId: randomUUID(),
          sequence,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          companionVersion: '0.1.0',
          hostVersion: '4.5.3 LTS',
          plan: { id: proposal.plan.id, revision: proposal.plan.revision },
          planContentSha256,
          executionId,
          phase: 'completed',
          activeStepId: replayRequest.leafId,
          completedStepIds: [replayRequest.leafId],
          transition: 'step_succeeded',
          stepId: replayRequest.leafId,
          observations: [
            {
              kind: 'icosphere_ready',
              satisfied: true,
              details: {
                parameters: observationParameters,
                supported: true,
                resourceId,
                objectName,
                meshId: `${resourceId}.mesh`,
                collectionId: 'snowman.collection',
                parametersValid: true,
                objectOwned: true,
                meshOwned: true,
                collectionOwned: true,
                receiptMatches: true,
                objectDataMatches: true,
                collectionLinkMatches: true,
                nameMatches: true,
                locationMatches: true,
                rotationMatches: true,
                scaleMatches: true,
                transformIsolated: true,
                modifiersAbsent: true,
                shapeKeysAbsent: true,
                materialsAbsent: true,
                contentIntact: true,
                topologyMatches: true,
                finiteCoordinates: true,
                radiusMatches: true,
                vertexCount,
                edgeCount: 480,
                faceCount: 320,
                meshContentSha256: 'c'.repeat(64),
              },
            },
          ],
          observationGate: null,
          artifactAttestation: null,
          nativeUndoCheckpoint: replayNativeUndoCheckpoint({
            planId: proposal.plan.id,
            planRevision: proposal.plan.revision,
            planContentSha256,
            executionId,
            stepId: replayRequest.leafId,
            occurredAt,
          }),
          error: null,
          occurredAt,
        };
      };

      const wrongTopologyReport = report(1, 42);
      const wrongState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(wrongTopologyReport),
      });
      expect(wrongState.status).toBe(200);
      const wrongFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replayId: replayRequest.replayId,
          attestationId: randomUUID(),
          reportId: wrongTopologyReport.reportId,
        }),
      });
      expect(wrongFinalize.status).toBe(409);

      const terminalReport = report(2, 162);
      const stateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
        method: 'POST',
        headers: leaseHeaders,
        body: JSON.stringify(terminalReport),
      });
      expect(stateResponse.status).toBe(200);
      const finalizeRequest = {
        replayId: replayRequest.replayId,
        attestationId: randomUUID(),
        reportId: terminalReport.reportId,
      };
      const finalizedResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalizeRequest),
      });
      expect(finalizedResponse.status).toBe(200);
      const finalized = procedureLeafReplayFinalizeResultSchema.parse(
        await finalizedResponse.json(),
      );
      expect(finalized).toMatchObject({
        status: 'accepted',
        attestation: {
          replayId: replayRequest.replayId,
          execution: {
            action: { adapterId: 'blender', name: 'blender.mesh.create_icosphere' },
          },
          verificationScope: {
            nativeUndoCheckpoint: 'companion_reported_current_at_report',
            currentHostStateAfterReport: 'not_verified',
          },
          successGate: {
            observations: [
              {
                kind: 'icosphere_ready',
                details: {
                  parameters: observationParameters,
                  vertexCount: 162,
                  edgeCount: 480,
                  faceCount: 320,
                },
              },
            ],
            allSatisfied: true,
          },
        },
      });
    } finally {
      await runtime.stop();
    }
  });

  it.each([
    {
      primitive: 'cube' as const,
      actionName: 'blender.mesh.create_cube' as const,
      observationKind: 'cube_ready' as const,
      goal: '创建一个边长 2.5、位置精确的 Cube。',
      topology: { vertexCount: 8, edgeCount: 12, faceCount: 6 },
      geometryDetailKeys: ['sizeMatches'] as const,
      shortcutCoverage: 'materialized' as const,
      mcpCoverage: 'materialized' as const,
    },
    {
      primitive: 'plane' as const,
      actionName: 'blender.mesh.create_plane' as const,
      observationKind: 'plane_ready' as const,
      goal: '创建一个边长 12.5、位置精确的 Plane。',
      topology: { vertexCount: 4, edgeCount: 4, faceCount: 1 },
      geometryDetailKeys: ['sizeMatches'] as const,
      shortcutCoverage: 'materialized' as const,
      mcpCoverage: 'materialized' as const,
    },
    {
      primitive: 'torus' as const,
      actionName: 'blender.mesh.create_torus' as const,
      observationKind: 'torus_ready' as const,
      goal: '创建一个分段、半径和位置精确的 Torus。',
      topology: { vertexCount: 576, edgeCount: 1152, faceCount: 576 },
      geometryDetailKeys: ['geometryMatches'] as const,
      shortcutCoverage: 'unavailable' as const,
      mcpCoverage: 'materialized' as const,
    },
    {
      primitive: 'cone' as const,
      actionName: 'blender.mesh.create_cone' as const,
      observationKind: 'cone_ready' as const,
      goal: '创建一个端点、半径和方向精确的 Cone。',
      topology: { vertexCount: 64, edgeCount: 96, faceCount: 34 },
      geometryDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'] as const,
      shortcutCoverage: 'unavailable' as const,
      mcpCoverage: 'materialized' as const,
    },
    {
      primitive: 'cylinder' as const,
      actionName: 'blender.mesh.create_cylinder' as const,
      observationKind: 'cylinder_ready' as const,
      goal: '创建一个端点、半径和方向精确的 Cylinder。',
      topology: { vertexCount: 64, edgeCount: 96, faceCount: 34 },
      geometryDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'] as const,
      shortcutCoverage: 'unavailable' as const,
      mcpCoverage: 'unavailable' as const,
    },
  ])(
    'attests an approved managed $primitive replay with exact geometry and topology',
    async ({
      primitive,
      actionName,
      observationKind,
      goal,
      topology,
      geometryDetailKeys,
      shortcutCoverage,
      mcpCoverage,
    }) => {
      const runtime = await startRuntime({
        databasePath: ':memory:',
        accessToken,
        actionCatalogs: blenderActionCatalogs,
        interactionCatalogs: blenderInteractionCatalogs,
      });
      try {
        const targetInstanceId = randomUUID();
        const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            targetAdapterId: 'blender',
            actionCatalogVersion: blenderActionCatalog.catalogVersion,
            interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
            goal,
            treeId: 'snowman.eye.left.procedure',
            revision: 1,
            locale: 'zh-CN',
          }),
        });
        expect(promptResponse.status).toBe(200);
        const packet = procedureAuthoringPromptPacketSchema.parse(await promptResponse.json());
        const tree = primitiveReplayAuthoringCandidateFixture(packet, primitive);
        const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
          (node) => node['kind'] === 'leaf',
        );
        if (leaf === undefined) throw new Error(`Expected one ${primitive} replay leaf`);
        const replayRequest = {
          formatVersion: '1.0.0',
          replayId: randomUUID(),
          targetInstanceId,
          leafId: String(leaf['id']),
          replayMode: 'managed_action',
          packet,
          tree,
        };
        const proposedMcp = await callMcpTool(
          runtime,
          903,
          'operatingline.procedure.replay.propose',
          replayRequest,
        );
        expect(proposedMcp.result?.isError, proposedMcp.result?.content?.[0]?.text).not.toBe(true);
        const proposed = procedureLeafReplayProposalResultSchema.parse(
          proposedMcp.result?.structuredContent,
        );
        expect(proposed).toMatchObject({
          status: 'accepted',
          binding: {
            actionName,
            targetInstanceId,
            leafId: replayRequest.leafId,
            claims: {
              shortcutTrack:
                shortcutCoverage === 'materialized' ? 'candidate_not_executed' : 'unavailable',
              mcpTrack:
                mcpCoverage === 'materialized' ? 'catalog_grounded_not_executed' : 'unavailable',
            },
            materialization: {
              coverage: [
                expect.objectContaining({
                  leafId: replayRequest.leafId,
                  menu: 'materialized',
                  shortcut: shortcutCoverage,
                  mcp: mcpCoverage,
                }),
              ],
            },
          },
        });

        const sessionResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/session`, {
          method: 'POST',
          headers,
          body: JSON.stringify(blenderCompanionHello(targetInstanceId)),
        });
        expect(sessionResponse.status).toBe(200);
        const session = (await sessionResponse.json()) as { leaseId: string };
        const leaseHeaders = {
          ...headers,
          'x-operatingline-companion-lease': session.leaseId,
        };
        const proposal = proposed.binding.proposal;
        const decision = {
          protocolVersion: guideProtocolVersion,
          decisionId: randomUUID(),
          proposalId: proposal.proposalId,
          adapterId: 'blender',
          instanceId: targetInstanceId,
          decision: 'accepted',
          occurredAt: new Date(Date.now() - 10_000).toISOString(),
        };
        const decisionResponse = await fetch(
          `${runtime.baseUrl}/api/v1/companion/proposal-decision`,
          { method: 'POST', headers: leaseHeaders, body: JSON.stringify(decision) },
        );
        expect(decisionResponse.status).toBe(200);

        const step = proposal.plan.steps.find((candidate) => candidate.id === replayRequest.leafId);
        const observationParameters = step?.expectedObservations[0]?.parameters;
        const resourceId = observationParameters?.['resourceId'];
        const objectName = observationParameters?.['objectName'];
        if (typeof resourceId !== 'string' || typeof objectName !== 'string') {
          throw new Error(`Expected ${primitive} replay observation identities`);
        }
        const report = (sequence: number, vertexCount: number) => {
          const occurredAt = new Date(Date.now() - 1_000 + sequence).toISOString();
          const planContentSha256 = computePlanContentSha256(proposal.plan);
          const executionId = randomUUID();
          return {
            protocolVersion: guideProtocolVersion,
            reportId: randomUUID(),
            sequence,
            adapterId: 'blender',
            instanceId: targetInstanceId,
            companionVersion: '0.1.0',
            hostVersion: '4.5.3 LTS',
            plan: { id: proposal.plan.id, revision: proposal.plan.revision },
            planContentSha256,
            executionId,
            phase: 'completed',
            activeStepId: replayRequest.leafId,
            completedStepIds: [replayRequest.leafId],
            transition: 'step_succeeded',
            stepId: replayRequest.leafId,
            observations: [
              {
                kind: observationKind,
                satisfied: true,
                details: {
                  parameters: observationParameters,
                  supported: true,
                  resourceId,
                  objectName,
                  meshId: `${resourceId}.mesh`,
                  collectionId: 'snowman.collection',
                  parametersValid: true,
                  objectOwned: true,
                  meshOwned: true,
                  collectionOwned: true,
                  receiptMatches: true,
                  objectDataMatches: true,
                  collectionLinkMatches: true,
                  nameMatches: true,
                  locationMatches: true,
                  rotationMatches: true,
                  scaleMatches: true,
                  transformIsolated: true,
                  modifiersAbsent: true,
                  shapeKeysAbsent: true,
                  materialsAbsent: true,
                  contentIntact: true,
                  topologyMatches: true,
                  finiteCoordinates: true,
                  ...Object.fromEntries(geometryDetailKeys.map((key) => [key, true])),
                  vertexCount,
                  edgeCount: topology.edgeCount,
                  faceCount: topology.faceCount,
                  meshContentSha256: 'd'.repeat(64),
                },
              },
            ],
            observationGate: null,
            artifactAttestation: null,
            nativeUndoCheckpoint: replayNativeUndoCheckpoint({
              planId: proposal.plan.id,
              planRevision: proposal.plan.revision,
              planContentSha256,
              executionId,
              stepId: replayRequest.leafId,
              occurredAt,
            }),
            error: null,
            occurredAt,
          };
        };

        const wrongTopologyReport = report(1, topology.vertexCount + 1);
        const wrongState = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(wrongTopologyReport),
        });
        expect(wrongState.status).toBe(200);
        const wrongFinalize = await fetch(`${runtime.baseUrl}/api/v1/procedure/replay/finalize`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            replayId: replayRequest.replayId,
            attestationId: randomUUID(),
            reportId: wrongTopologyReport.reportId,
          }),
        });
        expect(wrongFinalize.status).toBe(409);

        const terminalReport = report(2, topology.vertexCount);
        const stateResponse = await fetch(`${runtime.baseUrl}/api/v1/companion/state`, {
          method: 'POST',
          headers: leaseHeaders,
          body: JSON.stringify(terminalReport),
        });
        expect(stateResponse.status).toBe(200);
        const finalizedResponse = await fetch(
          `${runtime.baseUrl}/api/v1/procedure/replay/finalize`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              replayId: replayRequest.replayId,
              attestationId: randomUUID(),
              reportId: terminalReport.reportId,
            }),
          },
        );
        expect(finalizedResponse.status).toBe(200);
        const finalized = procedureLeafReplayFinalizeResultSchema.parse(
          await finalizedResponse.json(),
        );
        expect(finalized).toMatchObject({
          status: 'accepted',
          attestation: {
            replayId: replayRequest.replayId,
            execution: { action: { adapterId: 'blender', name: actionName } },
            verificationScope: {
              shortcutTrack:
                shortcutCoverage === 'materialized' ? 'candidate_not_executed' : 'unavailable',
              nativeUndoCheckpoint: 'companion_reported_current_at_report',
              currentHostStateAfterReport: 'not_verified',
            },
            successGate: {
              observations: [
                {
                  kind: observationKind,
                  details: {
                    parameters: observationParameters,
                    ...Object.fromEntries(geometryDetailKeys.map((key) => [key, true])),
                    ...topology,
                  },
                },
              ],
              allSatisfied: true,
            },
          },
        });
      } finally {
        await runtime.stop();
      }
    },
  );

  it('compiles through MCP and HTTP without publishing, proposing, or executing', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const tree = procedureFixture();
      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.compile', { tree });
      expect(mcp.result?.isError).not.toBe(true);
      const result = JSON.parse(mcp.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      expect(result).toMatchObject({
        formatVersion: '1.0.0',
        procedureTreeId: 'snowman.eye.left.procedure',
        adapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: {
          protocolVersion: '1.5.0',
          rootStepId: 'snowman',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(mcp.result?.structuredContent).toEqual(result);

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree }),
      });
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toEqual(result);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      expect(guide.status).toBe(200);
      await expect(guide.json()).resolves.toEqual({ plan: null });
    } finally {
      await runtime.stop();
    }
  });

  it('fails closed for malformed trees and mismatched host-version boundaries', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const malformed = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: { unexpected: true },
      });
      expect(malformed.result).toMatchObject({ isError: true });
      expect(malformed.result?.content?.[0]?.text).toContain(
        'invalid_procedure_compilation_request',
      );

      const mismatched = procedureFixture();
      mismatched['hostVersionRange'] = '>=6.0.0 <6.1.0';
      const mcp = await callMcpTool(runtime, 3, 'operatingline.procedure.compile', {
        tree: mismatched,
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain(
        `is not contained by blender@${blenderActionCatalog.catalogVersion} range`,
      );

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(http.status).toBe(422);
      await expect(http.json()).resolves.toMatchObject({
        error: 'procedure_compilation_failed',
      });

      const rejectedStore = await callMcpTool(runtime, 4, 'operatingline.procedure.store', {
        tree: mismatched,
      });
      expect(rejectedStore.result).toMatchObject({ isError: true });
      expect(rejectedStore.result?.content?.[0]?.text).toContain(
        'procedure_tree_validation_failed',
      );
      const rejectedStoreHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(rejectedStoreHttp.status).toBe(422);
      await expect(rejectedStoreHttp.json()).resolves.toMatchObject({
        error: 'procedure_tree_validation_failed',
      });

      const booleanRevision = await callMcpTool(runtime, 5, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
        revision: true,
      });
      expect(booleanRevision.result).toMatchObject({ isError: true });
      const booleanLimit = await callMcpTool(runtime, 6, 'operatingline.procedure.list', {
        limit: true,
      });
      expect(booleanLimit.result).toMatchObject({ isError: true });
      const invalidHttpRevision = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=true`,
        { headers },
      );
      expect(invalidHttpRevision.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });
});
