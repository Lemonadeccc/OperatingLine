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
  procedureAuthoringPromptPacketContent,
  startRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
  procedureAuthoringPromptPacketSchema,
  type ProcedureAuthoringPromptPacket,
} from '@operatingline/protocol';

const accessToken = 'procedure-runtime-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

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
        formatVersion: '1.2.0',
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
            mcp: 'unavailable',
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
        location: [9, 9, 9],
        scale: [8, 8, 8],
      });
      expect(materializedLeaf.semanticOperations[2]!.parameters).toEqual({
        name: 'Forged.Semantic.Name',
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
        expect.objectContaining({ availability: 'unavailable', modality: 'mcp' }),
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
        formatVersion: '1.3.0',
        catalogBinding: { interactionCatalogVersion: '1.23.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_icosphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'unavailable',
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
      expect(icosphereLeaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
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
        catalogBinding: { interactionCatalogVersion: '1.23.0' },
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

  it('materializes and structurally compiles the InteractionCatalog 1.23 Subdivision Surface candidate', async () => {
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
          goal: 'Add a managed Subdivision Surface modifier with viewport level three.',
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
      expect(mcp.result?.content?.[0]?.text).toContain('is not contained by blender@1.13.0 range');

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
