import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringCandidateTreeSchema,
  validateProcedureTree,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';

import {
  deriveSegmentFrameParameter,
  materializeProcedureAuthoringCandidate,
  projectProcedureTreeCatalogParameters,
  validateProcedureTreeParameterProjectionCatalog,
} from '../../../services/orchestrator/src/procedure-authoring-materialization.js';

function candidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
  actionCatalog: ActionCatalog = blenderActionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = interactionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged menu title',
        reason: 'Forged menu reason',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged shortcut title',
        reason: 'Forged shortcut reason',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.forged.track`,
        availability: 'unavailable',
        title: 'Forged MCP title',
        reason: 'Forged MCP reason',
        modality: 'mcp',
      },
    ];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function icosphereCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Icosphere candidate leaf');
  leaf.action = {
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
  leaf.title = 'Create and configure one detailed Icosphere';
  leaf.intent = 'Create a named Icosphere with exact subdivisions, radius, and location.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_icosphere',
    description: 'Create one detailed Icosphere.',
    parameters: { subdivisions: 3, radius: 1.75 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place the Icosphere at its exact world location.',
    parameters: { location: [-1.25, 2.5, 0.75] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Icosphere object.',
    parameters: { name: 'OperatingLine.IcosphereDetail' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [-1.25, 2.5, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_ico_sphere_add',
      menuPath: ['Add', 'Mesh', 'Ico Sphere'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.icosphere.detail' },
  };
  return tree;
}

function subdivideCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
  actionCatalog: ActionCatalog = blenderActionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog, actionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Subdivide candidate leaf');
  leaf.action = {
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
  leaf.title = 'Subdivide the accepted Cube in Edit Mode';
  leaf.intent = 'Subdivide every visible edge with two cuts and 0.25 smoothing.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'subdivide_mesh',
    description: 'Subdivide every visible edge of the accepted Cube.',
    parameters: { cuts: 2, smooth: 0.25 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Subdivided' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.subdivide' },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.cube.subdivided.mesh' },
  };
  return tree;
}

function subdivisionSurfaceCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
  actionCatalog: ActionCatalog = blenderActionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog, actionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Subdivision Surface candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_subdivision_surface',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
      viewportLevel: 3,
    },
  };
  leaf.title = 'Add a bounded Subdivision Surface modifier';
  leaf.intent = 'Add a managed Subdivision Surface modifier with viewport level three.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'add_subdivision_surface_modifier',
    description: 'Add one Subdivision Surface modifier to the accepted Cube.',
    parameters: { viewportLevel: 3 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Track the managed modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
    },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.subdivision_surface',
    },
  ];
  leaf.expectedObservations[0] = {
    kind: 'modifier_ready',
    parameters: { modifierId: 'tutorial.cube.subdivision_surface' },
  };
  return tree;
}

function mirrorCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Mirror candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_mirror',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.mirror',
      modifierName: 'OperatingLine.Cube.Mirror',
      axis: 'Y',
    },
  };
  leaf.title = 'Add a bounded Mirror modifier';
  leaf.intent = 'Add a managed Mirror modifier on the local Y axis.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'add_mirror_modifier',
    description: 'Add one Mirror modifier to the accepted Cube.',
    parameters: { axis: 'Y' },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Object Mode modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Track the managed Mirror modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.mirror',
      modifierName: 'OperatingLine.Cube.Mirror',
    },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.mirror',
    },
  ];
  leaf.expectedObservations[0] = {
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

function editBevelCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Edit Mode Bevel candidate leaf');
  leaf.action = {
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
  leaf.title = 'Bevel every edge of the accepted Cube in Edit Mode';
  leaf.intent = 'Bevel every Cube edge with exact width, segments, and profile.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'bevel_mesh_edges',
    description: 'Bevel every edge of the accepted Cube.',
    parameters: { width: 0.2, segments: 3, profile: 0.6 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Beveled' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.bevel' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'mesh_edges_beveled',
    parameters: { resourceId: 'tutorial.cube.beveled.mesh' },
  };
  return tree;
}

function editInsetCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Edit Mode Inset candidate leaf');
  leaf.action = {
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
  leaf.title = 'Inset every face of the accepted Cube individually in Edit Mode';
  leaf.intent = 'Inset every Cube face individually with exact thickness and depth.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'inset_mesh_faces',
    description: 'Inset every face of the accepted Cube individually.',
    parameters: { thickness: 0.2, depth: 0.1, individual: true },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Inset' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.inset' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'mesh_faces_inset',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.inset.mesh',
    },
  };
  return tree;
}

function editPokeCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Edit Mode Poke candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_poke_faces',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.poked.mesh',
      resultMeshName: 'OperatingLine.Cube.Poked',
      offset: 0.2,
    },
  };
  leaf.title = 'Poke every face of the accepted Cube in Edit Mode';
  leaf.intent = 'Poke every Cube face with the exact offset.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'poke_mesh_faces',
    description: 'Poke every face of the accepted Cube.',
    parameters: { offset: 0.2 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Poked' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.poke' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'mesh_faces_poked',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.poked.mesh',
    },
  };
  return tree;
}

function cubeCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Cube candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.create_cube',
    arguments: {
      resourceId: 'tutorial.cube.body',
      objectName: 'OperatingLine.CubeBody',
      size: 2.5,
      location: [-1, 2, 0.5],
    },
  };
  leaf.title = 'Create and configure one Cube body';
  leaf.intent = 'Create a named Cube with exact size and location.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_cube',
    description: 'Create one Cube body.',
    parameters: { size: 2.5 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place the Cube at its exact world location.',
    parameters: { location: [-1, 2, 0.5] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Cube object.',
    parameters: { name: 'OperatingLine.CubeBody' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [-1, 2, 0.5] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cube_add',
      menuPath: ['Add', 'Mesh', 'Cube'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.cube.body' },
  };
  return tree;
}

function planeCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Plane candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.create_plane',
    arguments: {
      resourceId: 'tutorial.plane.ground',
      objectName: 'OperatingLine.GroundPlane',
      size: 12.5,
      location: [0, 0, -1.25],
    },
  };
  leaf.title = 'Create and configure one ground Plane';
  leaf.intent = 'Create a named ground Plane with exact size and location.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_plane',
    description: 'Create one ground Plane.',
    parameters: { size: 12.5 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place the Plane at its exact world location.',
    parameters: { location: [0, 0, -1.25] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Plane object.',
    parameters: { name: 'OperatingLine.GroundPlane' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [0, 0, -1.25] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_plane_add',
      menuPath: ['Add', 'Mesh', 'Plane'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.plane.ground' },
  };
  return tree;
}

function coneCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Cone candidate leaf');
  leaf.action = {
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
  leaf.title = 'Create and configure one detailed Cone';
  leaf.intent = 'Create a named Cone between exact endpoints with exact endpoint radii.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_cone',
    description: 'Create one detailed Cone.',
    parameters: { radiusStart: 1.25, radiusEnd: 0.25 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place and orient the Cone between its exact endpoints.',
    parameters: { start: [1, 2, 3], end: [4, 6, 3] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Cone object.',
    parameters: { name: 'OperatingLine.DetailCone' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [2.5, 4, 3] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cone_add',
      menuPath: ['Add', 'Mesh', 'Cone'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.cone.detail' },
  };
  return tree;
}

function cylinderCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Cylinder candidate leaf');
  leaf.action = {
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
  leaf.title = 'Create and configure one detailed Cylinder';
  leaf.intent = 'Create a named Cylinder between exact endpoints with an exact radius.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_cylinder',
    description: 'Create one detailed Cylinder.',
    parameters: { radius: 0.75 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place and orient the Cylinder between its exact endpoints.',
    parameters: { start: [1, 2, 3], end: [4, 6, 3] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Cylinder object.',
    parameters: { name: 'OperatingLine.DetailCylinder' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [2.5, 4, 3] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cylinder_add',
      menuPath: ['Add', 'Mesh', 'Cylinder'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.cylinder.detail' },
  };
  return tree;
}

function torusCandidate(
  interactionCatalog: InteractionCatalog = blenderInteractionCatalog,
): ProcedureAuthoringCandidateTree {
  const tree = candidate(interactionCatalog);
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Torus candidate leaf');
  leaf.action = {
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
  leaf.title = 'Create and configure one detailed Torus';
  leaf.intent = 'Create a named Torus with exact segments, radii, and location.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_torus',
    description: 'Create one detailed Torus.',
    parameters: {
      majorSegments: 48,
      minorSegments: 12,
      majorRadius: 2.25,
      minorRadius: 0.4,
    },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Place the Torus at its exact world location.',
    parameters: { location: [1.5, -2, 0.75] },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Rename the Torus object.',
    parameters: { name: 'OperatingLine.DetailTorus' },
  };
  leaf.anchors = [
    { kind: 'world_position', position: [1.5, -2, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_torus_add',
      menuPath: ['Add', 'Mesh', 'Torus'],
    },
  ];
  leaf.expectedObservations[0] = {
    ...leaf.expectedObservations[0]!,
    parameters: { resourceId: 'tutorial.torus.detail' },
  };
  return tree;
}

function orderedMenu(catalog: InteractionCatalog) {
  const menu = catalog.recipes[0]!.procedureMaterialization?.menu;
  if (
    menu?.availability !== 'available' ||
    menu.parameterBinding !== 'ordered_parameter_operations'
  ) {
    throw new Error('Expected ordered parameter operations fixture');
  }
  return menu;
}

function orderedShortcut(catalog: InteractionCatalog) {
  const shortcut = catalog.recipes[0]!.procedureMaterialization?.shortcut;
  if (shortcut?.availability !== 'available') {
    throw new Error('Expected ordered shortcut operations fixture');
  }
  return shortcut;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

describe('procedure authoring materialization', () => {
  it('derives canonical finite segment-frame parameters and rejects malformed segments', () => {
    expect(deriveSegmentFrameParameter([1, 2, 3], [4, 6, 3], 'distance')).toBe(5);
    expect(deriveSegmentFrameParameter([1, 2, 3], [4, 6, 3], 'midpoint')).toEqual([2.5, 4, 3]);
    expect(deriveSegmentFrameParameter([1, 2, 3], [4, 6, 3], 'rotation_euler_xyz_align_z')).toEqual(
      [0, Math.PI / 2, Math.atan2(4, 3)],
    );
    expect(
      deriveSegmentFrameParameter([-0, -0, -0], [0, 0, 2], 'rotation_euler_xyz_align_z'),
    ).toEqual([0, 0, 0]);
    expect(deriveSegmentFrameParameter([-0, -0, -0], [0, 0, 2], 'midpoint')).toEqual([0, 0, 1]);
    expect(deriveSegmentFrameParameter([0, 0, 2], [0, 0, 0], 'rotation_euler_xyz_align_z')).toEqual(
      [0, Math.PI, 0],
    );

    for (const malformed of [null, [0, 0], [0, 0, 0, 0], [0, 'x', 0]]) {
      expect(() => deriveSegmentFrameParameter(malformed, [0, 0, 1], 'distance')).toThrow(
        'Segment frame start must be a finite numeric vector3',
      );
      expect(() => deriveSegmentFrameParameter([0, 0, 1], malformed, 'distance')).toThrow(
        'Segment frame end must be a finite numeric vector3',
      );
    }
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => deriveSegmentFrameParameter([0, 0, nonFinite], [0, 0, 1], 'distance')).toThrow(
        'Segment frame start must be a finite numeric vector3',
      );
      expect(() => deriveSegmentFrameParameter([0, 0, 1], [0, nonFinite, 0], 'distance')).toThrow(
        'Segment frame end must be a finite numeric vector3',
      );
    }
    expect(() => deriveSegmentFrameParameter([1, 2, 3], [1, 2, 3], 'distance')).toThrow(
      'Segment frame requires distinct finite endpoints with nonzero distance',
    );
    expect(() =>
      deriveSegmentFrameParameter([Number.MAX_VALUE, 0, 0], [-Number.MAX_VALUE, 0, 0], 'distance'),
    ).toThrow('Segment frame requires distinct finite endpoints with nonzero distance');
    expect(() =>
      deriveSegmentFrameParameter(
        [Number.MAX_VALUE, 0, 0],
        [Number.MAX_VALUE / 2, 0, 0],
        'midpoint',
      ),
    ).toThrow('Segment frame midpoint component must be finite');
    expect(() =>
      deriveSegmentFrameParameter(
        [0, 0, 0],
        [0, 0, 1],
        'unsupported' as 'rotation_euler_xyz_align_z',
      ),
    ).toThrow('Unsupported segment frame output: unsupported');
  });

  it('materializes the exact declared UV sphere native path and preserves candidate validation', () => {
    const input = candidate();
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    expect(result.formatVersion).toBe('1.2.0');
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    expect(leaf?.kind).toBe('leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');

    expect(leaf.validation).toEqual({
      status: 'candidate',
      validatedHostVersions: [],
      notes: input.nodes.find((node) => node.kind === 'leaf')?.validation.notes,
    });
    expect(leaf.menuTracks).toHaveLength(1);
    expect(leaf.menuTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native',
      availability: 'available',
      title: 'Add one UV sphere from the 3D Viewport',
      modality: 'menu',
    });
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    expect(track.preconditions).toEqual(
      blenderInteractionCatalog.recipes[0]?.guidance.kind === 'native_path'
        ? blenderInteractionCatalog.recipes[0].guidance.preconditions
        : [],
    );
    expect(
      track.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.uv_sphere',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        parameters: { radius: 1 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [0.32, -0.86, 2.14] },
      },
      {
        id: 'control.scale',
        order: 6,
        path: ['Sidebar', 'Item', 'Transform', 'Scale'],
        parameters: { value: [0.12, 0.12, 0.12] },
      },
      {
        id: 'control.object_name',
        order: 7,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.EyeLeft' },
      },
    ]);
    expect(
      track.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action?.arguments['resourceId']).toBe('snowman.eye.left');
    expect(result.coverage).toEqual([
      {
        leafId: 'snowman.head.eyes.left',
        recipeId: 'blender.mesh.create_uv_sphere.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.shortcut',
      title: 'Add one UV sphere from the 3D Viewport shortcut projection',
      modality: 'shortcut',
      preconditions: orderedShortcut(blenderInteractionCatalog).preconditions,
    });
    expect(
      shortcutTrack.operations.map(({ id, order, keyMode, keys, selectionPath, parameters }) => ({
        id,
        order,
        keyMode,
        keys,
        selectionPath,
        parameters,
      })),
    ).toEqual([
      {
        id: 'shortcut.add_uv_sphere',
        order: 1,
        keyMode: 'chord',
        keys: ['SHIFT', 'A'],
        selectionPath: ['Mesh', 'UV Sphere'],
        parameters: { radius: 1, location: [0, 0, 0] },
      },
      {
        id: 'shortcut.move_x',
        order: 2,
        keyMode: 'sequence',
        keys: ['G', 'X'],
        selectionPath: undefined,
        parameters: { value: 0.32, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.move_y',
        order: 3,
        keyMode: 'sequence',
        keys: ['G', 'Y'],
        selectionPath: undefined,
        parameters: { value: -0.86, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.move_z',
        order: 4,
        keyMode: 'sequence',
        keys: ['G', 'Z'],
        selectionPath: undefined,
        parameters: { value: 2.14, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.scale',
        order: 5,
        keyMode: 'sequence',
        keys: ['S'],
        selectionPath: undefined,
        parameters: { value: 0.12, confirm: 'ENTER' },
      },
      {
        id: 'shortcut.rename',
        order: 6,
        keyMode: 'sequence',
        keys: ['F2'],
        selectionPath: undefined,
        parameters: { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
      },
    ]);
    expect(
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.mcpTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.mcp',
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
      modality: 'mcp',
    });
    expect(leaf.parameterProjection).toMatchObject({
      formatVersion: '1.0.0',
      provenance: {
        kind: 'interaction_catalog_materialization',
        interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        recipeId: 'blender.mesh.create_uv_sphere.native',
      },
      arguments: [
        {
          actionArgument: 'location',
          disposition: 'projected',
          bindingIds: [
            'binding.menu.control.location.value',
            'binding.semantic.projection.semantic.transform.location',
            'binding.shortcut.shortcut.move_x.value',
            'binding.shortcut.shortcut.move_y.value',
            'binding.shortcut.shortcut.move_z.value',
          ],
        },
        {
          actionArgument: 'objectName',
          disposition: 'projected',
          bindingIds: [
            'binding.menu.control.object_name.value',
            'binding.semantic.projection.semantic.rename.name',
            'binding.shortcut.shortcut.rename.text',
          ],
        },
        {
          actionArgument: 'radius',
          disposition: 'projected',
          bindingIds: [
            'binding.menu.control.scale.value',
            'binding.semantic.projection.semantic.transform.scale',
            'binding.shortcut.shortcut.scale.value',
          ],
        },
        {
          actionArgument: 'resourceId',
          disposition: 'omitted',
          bindingIds: [],
          reason: 'The logical resource identifier has no semantic UI representation.',
        },
      ],
    });
    expect(
      leaf.parameterProjection?.bindings.map((binding) => ({
        id: binding.id,
        actionArgument: binding.actionArgument,
        transform: binding.transform,
        modality: binding.target.modality,
        trackId: 'trackId' in binding.target ? binding.target.trackId : undefined,
        operationId: binding.target.operationId,
        path: binding.target.path,
      })),
    ).toEqual([
      {
        id: 'binding.semantic.projection.semantic.transform.location',
        actionArgument: 'location',
        transform: 'identity',
        modality: 'semantic',
        trackId: undefined,
        operationId: 'semantic.transform',
        path: [{ kind: 'field', name: 'location' }],
      },
      {
        id: 'binding.semantic.projection.semantic.transform.scale',
        actionArgument: 'radius',
        transform: 'uniform_vector3',
        modality: 'semantic',
        trackId: undefined,
        operationId: 'semantic.transform',
        path: [{ kind: 'field', name: 'scale' }],
      },
      {
        id: 'binding.semantic.projection.semantic.rename.name',
        actionArgument: 'objectName',
        transform: 'identity',
        modality: 'semantic',
        trackId: undefined,
        operationId: 'semantic.rename',
        path: [{ kind: 'field', name: 'name' }],
      },
      {
        id: 'binding.menu.control.location.value',
        actionArgument: 'location',
        transform: 'identity',
        modality: 'menu',
        trackId: 'blender.mesh.create_uv_sphere.native',
        operationId: 'control.location',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.menu.control.scale.value',
        actionArgument: 'radius',
        transform: 'uniform_vector3',
        modality: 'menu',
        trackId: 'blender.mesh.create_uv_sphere.native',
        operationId: 'control.scale',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.menu.control.object_name.value',
        actionArgument: 'objectName',
        transform: 'identity',
        modality: 'menu',
        trackId: 'blender.mesh.create_uv_sphere.native',
        operationId: 'control.object_name',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.shortcut.shortcut.move_x.value',
        actionArgument: 'location',
        transform: 'vector3_x',
        modality: 'shortcut',
        trackId: 'blender.mesh.create_uv_sphere.native.shortcut',
        operationId: 'shortcut.move_x',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.shortcut.shortcut.move_y.value',
        actionArgument: 'location',
        transform: 'vector3_y',
        modality: 'shortcut',
        trackId: 'blender.mesh.create_uv_sphere.native.shortcut',
        operationId: 'shortcut.move_y',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.shortcut.shortcut.move_z.value',
        actionArgument: 'location',
        transform: 'vector3_z',
        modality: 'shortcut',
        trackId: 'blender.mesh.create_uv_sphere.native.shortcut',
        operationId: 'shortcut.move_z',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.shortcut.shortcut.scale.value',
        actionArgument: 'radius',
        transform: 'identity',
        modality: 'shortcut',
        trackId: 'blender.mesh.create_uv_sphere.native.shortcut',
        operationId: 'shortcut.scale',
        path: [{ kind: 'field', name: 'value' }],
      },
      {
        id: 'binding.shortcut.shortcut.rename.text',
        actionArgument: 'objectName',
        transform: 'identity',
        modality: 'shortcut',
        trackId: 'blender.mesh.create_uv_sphere.native.shortcut',
        operationId: 'shortcut.rename',
        path: [{ kind: 'field', name: 'text' }],
      },
    ]);
  });

  it('projects edited UV Sphere Action arguments through exact catalog bindings', () => {
    const materialized = materializeProcedureAuthoringCandidate(
      candidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    ).tree;
    const stale = structuredClone(materialized);
    const staleLeaf = stale.nodes.find((node) => node.kind === 'leaf');
    if (staleLeaf?.kind !== 'leaf' || staleLeaf.action === null) {
      throw new Error('expected projected UV Sphere leaf');
    }
    staleLeaf.action.arguments['location'] = [4, 5, 6];
    staleLeaf.action.arguments['radius'] = 0.5;
    staleLeaf.action.arguments['objectName'] = 'OperatingLine.ProjectedEye';

    expect(() => validateProcedureTree(stale)).toThrow(
      'does not match its action argument projection',
    );
    expect(() =>
      validateProcedureTreeParameterProjectionCatalog(stale, blenderInteractionCatalog),
    ).not.toThrow();

    const projected = projectProcedureTreeCatalogParameters(stale, blenderInteractionCatalog);
    const leaf = projected.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected projected UV Sphere leaf');
    expect(leaf.semanticOperations.map((operation) => operation.parameters)).toEqual([
      { radius: 1 },
      { location: [4, 5, 6], scale: [0.5, 0.5, 0.5] },
      { name: 'OperatingLine.ProjectedEye' },
    ]);
    const menu = leaf.menuTracks[0];
    const shortcut = leaf.shortcutTracks[0];
    if (menu?.availability !== 'available' || shortcut?.availability !== 'available') {
      throw new Error('expected available projected tracks');
    }
    expect(menu.operations.slice(4).map((operation) => operation.parameters)).toEqual([
      { value: [4, 5, 6] },
      { value: [0.5, 0.5, 0.5] },
      { value: 'OperatingLine.ProjectedEye' },
    ]);
    expect(shortcut.operations.map((operation) => operation.parameters)).toEqual([
      { radius: 1, location: [0, 0, 0] },
      { value: 4, confirm: 'ENTER' },
      { value: 5, confirm: 'ENTER' },
      { value: 6, confirm: 'ENTER' },
      { value: 0.5, confirm: 'ENTER' },
      { text: 'OperatingLine.ProjectedEye', confirm: 'ENTER' },
    ]);
    expect(() => validateProcedureTree(projected)).not.toThrow();
    expect(staleLeaf.semanticOperations[1]!.parameters).toEqual({
      location: [0.32, -0.86, 2.14],
      scale: [0.12, 0.12, 0.12],
    });
  });

  it('rejects projection provenance, version, and installed recipe tampering', () => {
    const materialized = materializeProcedureAuthoringCandidate(
      candidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    ).tree;

    const forgedReceipt = structuredClone(materialized);
    const forgedLeaf = forgedReceipt.nodes.find((node) => node.kind === 'leaf');
    if (forgedLeaf?.kind !== 'leaf' || forgedLeaf.parameterProjection === undefined) {
      throw new Error('expected projected UV Sphere leaf');
    }
    forgedLeaf.parameterProjection.provenance.recipeId = 'blender.mesh.create_cube.native';
    expect(() =>
      validateProcedureTreeParameterProjectionCatalog(forgedReceipt, blenderInteractionCatalog),
    ).toThrow('does not match its InteractionCatalog recipe');

    const bindingTamperCases: readonly [
      string,
      (binding: NonNullable<typeof forgedLeaf.parameterProjection>['bindings'][number]) => void,
    ][] = [
      ['binding ID', (binding) => (binding.id = 'binding.forged')],
      ['operation ID', (binding) => (binding.target.operationId = 'semantic.forged')],
      [
        'target path',
        (binding) => {
          binding.target.path = [{ kind: 'field', name: 'forged' }];
        },
      ],
    ];
    for (const [label, mutate] of bindingTamperCases) {
      const tampered = structuredClone(materialized);
      const tamperedLeaf = tampered.nodes.find((node) => node.kind === 'leaf');
      if (tamperedLeaf?.kind !== 'leaf' || tamperedLeaf.parameterProjection === undefined) {
        throw new Error('expected projected UV Sphere leaf');
      }
      mutate(tamperedLeaf.parameterProjection.bindings[0]!);
      expect(
        () => validateProcedureTreeParameterProjectionCatalog(tampered, blenderInteractionCatalog),
        label,
      ).toThrow('does not match its InteractionCatalog recipe');
    }

    const wrongVersion = structuredClone(materialized);
    wrongVersion.interactionCatalogVersion = '999.0.0';
    expect(() =>
      validateProcedureTreeParameterProjectionCatalog(wrongVersion, blenderInteractionCatalog),
    ).toThrow('InteractionCatalog binding mismatch');

    const tamperedCatalog = structuredClone(blenderInteractionCatalog);
    const recipe = tamperedCatalog.recipes.find(
      (candidateRecipe) => candidateRecipe.id === 'blender.mesh.create_uv_sphere.native',
    );
    const projection = recipe?.procedureMaterialization?.semantic?.projections.find(
      (candidateProjection) => candidateProjection.id === 'projection.semantic.transform.scale',
    );
    if (projection === undefined) throw new Error('expected UV Sphere semantic projection');
    projection.transform = 'divide_by_two';
    expect(() =>
      validateProcedureTreeParameterProjectionCatalog(materialized, tamperedCatalog),
    ).toThrow('does not match its InteractionCatalog recipe');
  });

  it('materializes the exact Icosphere ordered menu and F9 shortcut without inventing MCP support', () => {
    const input = icosphereCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Icosphere leaf');
    }

    expect(result.formatVersion).toBe('1.3.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_icosphere.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Icosphere menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_icosphere.native',
      title: 'Add one Icosphere from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.icosphere',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Ico Sphere'],
        parameters: { subdivisions: 3, radius: 1.75 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [-1.25, 2.5, 0.75] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.IcosphereDetail' },
      },
    ]);
    expect(
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.icosphere.detail',
      objectName: 'OperatingLine.IcosphereDetail',
      subdivisions: 3,
      radius: 1.75,
      location: [-1.25, 2.5, 0.75],
    });
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available Icosphere shortcut track');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.create_icosphere.native.shortcut',
      modality: 'shortcut',
    });
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(shortcutTrack.preconditions).toContainEqual({
      kind: 'scene_state',
      label: 'Transform Orientation',
      value: 'GLOBAL',
    });
    expect(
      shortcutTrack.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      { kind: 'key_input', id: 'shortcut.add_icosphere', order: 1, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 2,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_subdivisions',
        order: 3,
        parameters: { value: 3 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_radius',
        order: 4,
        parameters: { value: 1.75 },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 5,
        parameters: {},
      },
      { kind: 'key_input', id: 'shortcut.move_x', order: 6, parameters: { value: -1.25 } },
      { kind: 'key_input', id: 'shortcut.move_y', order: 7, parameters: { value: 2.5 } },
      { kind: 'key_input', id: 'shortcut.move_z', order: 8, parameters: { value: 0.75 } },
      {
        kind: 'key_input',
        id: 'shortcut.rename',
        order: 9,
        parameters: { value: 'OperatingLine.IcosphereDetail' },
      },
    ]);
    expect(shortcutTrack.operations[0]).toMatchObject({
      kind: 'key_input',
      keyMode: 'chord',
      keys: ['SHIFT', 'A'],
      selectionPath: ['Mesh', 'Ico Sphere'],
    });
    expect(shortcutTrack.operations[1]).toMatchObject({
      kind: 'key_input',
      keys: ['F9'],
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: 'shortcut.add_icosphere',
        expectedOperatorId: 'mesh.primitive_ico_sphere_add',
      },
    });
    expect(shortcutTrack.operations[2]).toMatchObject({
      kind: 'operator_property_update',
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: {
        kind: 'control',
        hostId: 'mesh.primitive_ico_sphere_add.subdivisions',
      },
      path: ['Adjust Last Operation', 'Subdivisions'],
    });
    expect(shortcutTrack.operations[3]).toMatchObject({
      kind: 'operator_property_update',
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.primitive_ico_sphere_add.radius' },
      path: ['Adjust Last Operation', 'Radius'],
    });
    expect(shortcutTrack.operations[4]).toMatchObject({
      kind: 'key_input',
      keys: ['ENTER'],
      closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
    });
    expect(
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Edit Mode Subdivide candidate shortcut and preserves managed IDs only on the action', () => {
    const input = subdivideCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Subdivide leaf');
    }

    expect(result.formatVersion).toBe('1.3.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_subdivide.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.action.arguments).toEqual({
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.subdivided.mesh',
      resultMeshName: 'OperatingLine.Cube.Subdivided',
      cuts: 2,
      smooth: 0.25,
    });
    expect(leaf.menuTracks).toEqual([
      expect.objectContaining({
        id: 'blender.mesh.edit_subdivide.semantic.menu',
        availability: 'unavailable',
        modality: 'menu',
        reason:
          "The managed action copies and tags a replacement mesh before swapping the object link, so Blender's in-place Edit Mode menu path is not an equivalent executable menu track.",
      }),
    ]);
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available Subdivide shortcut track');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.edit_subdivide.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcutTrack.preconditions).toHaveLength(9);
    expect(shortcutTrack.preconditions).toContainEqual({
      kind: 'mode',
      label: 'Mode',
      value: 'OBJECT',
    });
    expect(shortcutTrack.preconditions).toContainEqual({
      kind: 'selection',
      label: 'Active Target',
      value: 'Exactly one accepted target Mesh object is active and selected',
    });
    expect(
      shortcutTrack.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      { kind: 'key_input', id: 'shortcut.enter_edit_mode', order: 1, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.select_all_mesh_elements',
        order: 2,
        parameters: {},
      },
      {
        kind: 'key_input',
        id: 'shortcut.search_subdivide',
        order: 3,
        parameters: { query: 'subdivide' },
      },
      { kind: 'key_input', id: 'shortcut.execute_subdivide', order: 4, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 5,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_number_of_cuts',
        order: 6,
        parameters: { value: 2 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_smoothness',
        order: 7,
        parameters: { value: 0.25 },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 8,
        parameters: {},
      },
      {
        kind: 'key_input',
        id: 'shortcut.return_to_object_mode',
        order: 9,
        parameters: {},
      },
    ]);
    expect(shortcutTrack.operations[0]).toMatchObject({ keys: ['TAB'] });
    expect(shortcutTrack.operations[1]).toMatchObject({ keys: ['A'] });
    expect(shortcutTrack.operations[2]).toMatchObject({
      keys: ['F3'],
      selectionPath: ['Subdivide'],
    });
    expect(shortcutTrack.operations[3]).toMatchObject({ keys: ['ENTER'] });
    expect(shortcutTrack.operations[4]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: 'shortcut.execute_subdivide',
        expectedOperatorId: 'mesh.subdivide',
      },
    });
    expect(shortcutTrack.operations[5]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.subdivide.number_cuts' },
      path: ['Adjust Last Operation', 'Number of Cuts'],
    });
    expect(shortcutTrack.operations[6]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.subdivide.smoothness' },
      path: ['Adjust Last Operation', 'Smoothness'],
    });
    expect(shortcutTrack.operations[7]).toMatchObject({
      keys: ['ENTER'],
      closesSurfaceOperationId: 'shortcut.open_adjust_last_operation',
    });
    expect(shortcutTrack.operations[8]).toMatchObject({ keys: ['TAB'] });
    expect(
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toEqual(expect.arrayContaining(['targetId', 'resultMeshId', 'resultMeshName']));
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('preserves the exact Mirror observation while keeping every host track unavailable', () => {
    const input = mirrorCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Mirror leaf');

    expect(result.formatVersion).toBe('1.0.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.modifier.add_mirror.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
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
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('managed modifier identity'),
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('Shift+A'),
    });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'No approved action-level MCP tool is available.',
    });
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
  });

  it('preserves the InteractionCatalog 1.21 Subdivide fallback with no invented executable track', () => {
    const historicalCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.21.0',
    );
    if (historicalCatalog === undefined) {
      throw new Error('expected immutable InteractionCatalog 1.21.0');
    }
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === historicalCatalog.actionCatalogVersion,
    );
    if (historicalActionCatalog === undefined) {
      throw new Error('expected immutable ActionCatalog for InteractionCatalog 1.21.0');
    }

    const result = materializeProcedureAuthoringCandidate(
      subdivideCandidate(historicalCatalog, historicalActionCatalog),
      historicalActionCatalog,
      historicalCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected historical Subdivide leaf');

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_subdivide.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'The InteractionCatalog recipe does not declare menu materialization.',
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'The InteractionCatalog recipe does not declare shortcut materialization.',
    });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'The InteractionCatalog recipe does not declare MCP materialization.',
    });
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
  });

  it('materializes the exact frozen IC1.23 Subdivision Surface shortcut against AC1.13', () => {
    const historicalInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.23.0',
    );
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.13.0',
    );
    if (historicalInteractionCatalog === undefined || historicalActionCatalog === undefined) {
      throw new Error('expected immutable IC1.23 and AC1.13 catalogs');
    }
    expect(historicalInteractionCatalog.actionCatalogVersion).toBe(
      historicalActionCatalog.catalogVersion,
    );
    const input = subdivisionSurfaceCandidate(
      historicalInteractionCatalog,
      historicalActionCatalog,
    );
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      historicalActionCatalog,
      historicalInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Subdivision Surface leaf');
    }

    expect(result.formatVersion).toBe('1.3.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.modifier.add_subdivision_surface.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.action.arguments).toEqual({
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
      viewportLevel: 3,
    });
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'menu',
      reason:
        'The native modifier UI does not encode the managed modifier identity and name, receipt-tracked stack contract, bounded projected topology, observation, or compensating rollback state.',
    });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'mcp',
      reason: 'No approved action-level MCP tool is available.',
    });
    const shortcut = leaf.shortcutTracks[0];
    if (shortcut?.availability !== 'available') {
      throw new Error('expected available Subdivision Surface shortcut track');
    }
    expect(shortcut).toMatchObject({
      id: 'blender.modifier.add_subdivision_surface.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcut.preconditions).toHaveLength(9);
    expect(
      shortcut.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      {
        kind: 'key_input',
        id: 'shortcut.add_subdivision_surface_level_one',
        order: 1,
        parameters: { level: 1, relative: false, ensure_modifier: true },
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 2,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_viewport_level',
        order: 3,
        parameters: { value: 3 },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 4,
        parameters: {},
      },
    ]);
    expect(shortcut.operations[0]).toMatchObject({
      keyMode: 'chord',
      keys: ['CTRL', '1'],
    });
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
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
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
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Edit Mode Bevel F9 shortcut without projecting managed IDs', () => {
    const input = editBevelCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Edit Mode Bevel leaf');
    }

    expect(result.formatVersion).toBe('1.3.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_bevel_edges.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.action.arguments).toEqual({
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.beveled.mesh',
      resultMeshName: 'OperatingLine.Cube.Beveled',
      width: 0.2,
      segments: 3,
      profile: 0.6,
    });
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'menu',
      reason:
        "The managed action copies and tags a replacement mesh before swapping the object link, so Blender's in-place Edit Mode menu path is not an equivalent identity or transaction track.",
    });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'mcp',
      reason: 'No approved action-level MCP tool is available.',
    });
    const shortcut = leaf.shortcutTracks[0];
    if (shortcut?.availability !== 'available') {
      throw new Error('expected available Edit Mode Bevel shortcut track');
    }
    expect(shortcut).toMatchObject({
      id: 'blender.mesh.edit_bevel_edges.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcut.preconditions).toHaveLength(10);
    expect(
      shortcut.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      { kind: 'key_input', id: 'shortcut.enter_edit_mode', order: 1, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_edge_mode', order: 2, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_all_edges', order: 3, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.bevel_edges',
        order: 4,
        parameters: {
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
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 5,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_bevel_width',
        order: 6,
        parameters: { value: 0.2 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_bevel_segments',
        order: 7,
        parameters: { value: 3 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_bevel_profile',
        order: 8,
        parameters: { value: 0.6 },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 9,
        parameters: {},
      },
      {
        kind: 'key_input',
        id: 'shortcut.return_to_object_mode',
        order: 10,
        parameters: {},
      },
    ]);
    expect(shortcut.operations[0]).toMatchObject({ keys: ['TAB'] });
    expect(shortcut.operations[1]).toMatchObject({ keys: ['2'] });
    expect(shortcut.operations[2]).toMatchObject({ keys: ['A'] });
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
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.bevel.offset' },
      path: ['Adjust Last Operation', 'Width'],
    });
    expect(shortcut.operations[6]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.bevel.segments' },
      path: ['Adjust Last Operation', 'Segments'],
    });
    expect(shortcut.operations[7]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
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
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Edit Mode Inset F9 shortcut without projecting managed IDs', () => {
    const input = editInsetCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Edit Mode Inset leaf');
    }

    expect(result.formatVersion).toBe('1.3.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_inset_faces.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
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
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'menu',
      reason:
        "The managed action copies and tags a replacement mesh before swapping the object link, so Blender's in-place Edit Mode menu path is not an equivalent identity or transaction track.",
    });
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'mcp',
      reason: 'No approved action-level MCP tool is available.',
    });
    const shortcut = leaf.shortcutTracks[0];
    if (shortcut?.availability !== 'available') {
      throw new Error('expected available Edit Mode Inset shortcut track');
    }
    expect(shortcut).toMatchObject({
      id: 'blender.mesh.edit_inset_faces.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcut.preconditions).toHaveLength(10);
    expect(
      shortcut.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      { kind: 'key_input', id: 'shortcut.enter_edit_mode', order: 1, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_face_mode', order: 2, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_all_faces', order: 3, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.inset_faces',
        order: 4,
        parameters: {
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
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 5,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_inset_thickness',
        order: 6,
        parameters: { value: 0.2 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_inset_depth',
        order: 7,
        parameters: { value: 0.1 },
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_inset_individual',
        order: 8,
        parameters: { value: true },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 9,
        parameters: {},
      },
      {
        kind: 'key_input',
        id: 'shortcut.return_to_object_mode',
        order: 10,
        parameters: {},
      },
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
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.inset.thickness' },
      path: ['Adjust Last Operation', 'Thickness'],
    });
    expect(shortcut.operations[6]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
      target: { kind: 'control', hostId: 'mesh.inset.depth' },
      path: ['Adjust Last Operation', 'Depth'],
    });
    expect(shortcut.operations[7]).toMatchObject({
      surfaceOperationId: 'shortcut.open_adjust_last_operation',
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
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Edit Mode Poke Faces search/F9 shortcut', () => {
    const input = editPokeCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Edit Mode Poke leaf');
    }

    expect(result).toMatchObject({ formatVersion: '1.3.0' });
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_poke_faces.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
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
      throw new Error('expected available Edit Mode Poke shortcut track');
    }
    expect(shortcut).toMatchObject({
      id: 'blender.mesh.edit_poke_faces.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcut.preconditions).toHaveLength(11);
    expect(
      shortcut.operations.map(({ kind, id, order, parameters }) => ({
        kind,
        id,
        order,
        parameters,
      })),
    ).toEqual([
      { kind: 'key_input', id: 'shortcut.enter_edit_mode', order: 1, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_face_mode', order: 2, parameters: {} },
      { kind: 'key_input', id: 'shortcut.select_all_faces', order: 3, parameters: {} },
      {
        kind: 'key_input',
        id: 'shortcut.open_operator_search',
        order: 4,
        parameters: { query: 'poke faces' },
      },
      {
        kind: 'key_input',
        id: 'shortcut.execute_poke_faces',
        order: 5,
        parameters: {
          offset: 0,
          use_relative_offset: false,
          center_mode: 'MEDIAN_WEIGHTED',
        },
      },
      {
        kind: 'key_input',
        id: 'shortcut.open_adjust_last_operation',
        order: 6,
        parameters: {},
      },
      {
        kind: 'operator_property_update',
        id: 'shortcut.set_poke_offset',
        order: 7,
        parameters: { value: 0.2 },
      },
      {
        kind: 'key_input',
        id: 'shortcut.close_adjust_last_operation',
        order: 8,
        parameters: {},
      },
      {
        kind: 'key_input',
        id: 'shortcut.return_to_object_mode',
        order: 9,
        parameters: {},
      },
    ]);
    expect(shortcut.operations[0]).toMatchObject({ keys: ['TAB'] });
    expect(shortcut.operations[1]).toMatchObject({ keys: ['3'] });
    expect(shortcut.operations[2]).toMatchObject({ keys: ['A'] });
    expect(shortcut.operations[3]).toMatchObject({
      keys: ['F3'],
      selectionPath: ['Poke Faces'],
    });
    expect(shortcut.operations[4]).toMatchObject({ keys: ['ENTER'] });
    expect(shortcut.operations[5]).toMatchObject({
      keys: ['F9'],
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
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
    const shortcutParameterNames = shortcut.operations.flatMap((operation) =>
      Object.keys(operation.parameters),
    );
    for (const managedArgument of ['targetId', 'resultMeshId', 'resultMeshName']) {
      expect(shortcutParameterNames).not.toContain(managedArgument);
    }
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Cube ordered menu and candidate shortcut without inventing MCP support', () => {
    const input = cubeCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Cube leaf');
    }

    expect(result.formatVersion).toBe('1.2.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cube.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Cube menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_cube.native',
      title: 'Add one cube from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.cube',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Cube'],
        parameters: { size: 2.5 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [-1, 2, 0.5] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.CubeBody' },
      },
    ]);
    expect(
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.cube.body',
      objectName: 'OperatingLine.CubeBody',
      size: 2.5,
      location: [-1, 2, 0.5],
    });
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available Cube shortcut track');
    }
    const cubeRecipe = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.id === 'blender.mesh.create_cube.native',
    );
    if (cubeRecipe?.procedureMaterialization?.shortcut?.availability !== 'available') {
      throw new Error('expected catalog-grounded Cube shortcut fixture');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.create_cube.native.shortcut',
      title: 'Add one cube from the 3D Viewport shortcut projection',
      modality: 'shortcut',
      preconditions: cubeRecipe.procedureMaterialization.shortcut.preconditions,
    });
    expect(
      shortcutTrack.operations.map(({ id, order, keyMode, keys, selectionPath, parameters }) => ({
        id,
        order,
        keyMode,
        keys,
        selectionPath,
        parameters,
      })),
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
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Plane ordered menu and candidate shortcut without inventing MCP support', () => {
    const input = planeCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Plane leaf');
    }

    expect(result.formatVersion).toBe('1.2.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_plane.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Plane menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_plane.native',
      title: 'Add one plane from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.plane',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Plane'],
        parameters: { size: 12.5 },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [0, 0, -1.25] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.GroundPlane' },
      },
    ]);
    expect(
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.plane.ground',
      objectName: 'OperatingLine.GroundPlane',
      size: 12.5,
      location: [0, 0, -1.25],
    });
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available Plane shortcut track');
    }
    const planeRecipe = blenderInteractionCatalog.recipes.find(
      (recipe) => recipe.id === 'blender.mesh.create_plane.native',
    );
    if (planeRecipe?.procedureMaterialization?.shortcut?.availability !== 'available') {
      throw new Error('expected catalog-grounded Plane shortcut fixture');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.create_plane.native.shortcut',
      title: 'Add one plane from the 3D Viewport shortcut projection',
      modality: 'shortcut',
      preconditions: planeRecipe.procedureMaterialization.shortcut.preconditions,
    });
    expect(
      shortcutTrack.operations.map(({ id, order, keyMode, keys, selectionPath, parameters }) => ({
        id,
        order,
        keyMode,
        keys,
        selectionPath,
        parameters,
      })),
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
      shortcutTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Torus ordered menu without inventing shortcut or MCP support', () => {
    const input = torusCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Torus leaf');
    }

    expect(result.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_torus.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Torus menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_torus.native',
      title: 'Add one torus from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.torus',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Torus'],
        parameters: {
          major_segments: 48,
          minor_segments: 12,
          mode: 'MAJOR_MINOR',
          major_radius: 2.25,
          minor_radius: 0.4,
        },
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [1.5, -2, 0.75] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.DetailTorus' },
      },
    ]);
    expect(
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.torus.detail',
      objectName: 'OperatingLine.DetailTorus',
      majorSegments: 48,
      minorSegments: 12,
      majorRadius: 2.25,
      minorRadius: 0.4,
      location: [1.5, -2, 0.75],
    });
    expect(leaf.shortcutTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'shortcut',
        reason: 'No verified shortcut procedure is available.',
      }),
    ]);
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact derived Cone segment frame without inventing shortcut or MCP support', () => {
    const input = coneCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Cone leaf');
    }

    expect(result.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cone.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Cone menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_cone.native',
      title: 'Add one cone from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.cone',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Cone'],
        parameters: {
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
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [2.5, 4, 3] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.DetailCone' },
      },
    ]);
    expect(Object.keys(menuTrack.operations[3]!.parameters)).toEqual([
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
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.cone.detail',
      objectName: 'OperatingLine.DetailCone',
      radiusStart: 1.25,
      radiusEnd: 0.25,
      start: [1, 2, 3],
      end: [4, 6, 3],
    });
    expect(leaf.shortcutTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'shortcut',
        reason: 'No verified shortcut procedure is available.',
      }),
    ]);
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact derived Cylinder segment frame without inventing shortcut or MCP support', () => {
    const input = cylinderCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Cylinder leaf');
    }

    expect(result.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cylinder.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
    const menuTrack = leaf.menuTracks[0];
    if (menuTrack?.availability !== 'available') {
      throw new Error('expected available Cylinder menu track');
    }
    expect(menuTrack).toMatchObject({
      id: 'blender.mesh.create_cylinder.native',
      title: 'Add one cylinder from the 3D Viewport',
      modality: 'menu',
    });
    expect(
      menuTrack.operations.map(({ id, order, path, parameters }) => ({
        id,
        order,
        path,
        parameters,
      })),
    ).toEqual([
      { id: 'workspace.layout', order: 1, path: ['Layout'], parameters: {} },
      { id: 'menu.add', order: 2, path: ['Layout', 'Add'], parameters: {} },
      { id: 'menu.mesh', order: 3, path: ['Layout', 'Add', 'Mesh'], parameters: {} },
      {
        id: 'operator.cylinder',
        order: 4,
        path: ['Layout', 'Add', 'Mesh', 'Cylinder'],
        parameters: {
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
      },
      {
        id: 'control.location',
        order: 5,
        path: ['Sidebar', 'Item', 'Transform', 'Location'],
        parameters: { value: [2.5, 4, 3] },
      },
      {
        id: 'control.object_name',
        order: 6,
        path: ['Outliner', 'Object Name'],
        parameters: { value: 'OperatingLine.DetailCylinder' },
      },
    ]);
    expect(Object.keys(menuTrack.operations[3]!.parameters)).toEqual([
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
      menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toContain('resourceId');
    expect(leaf.action.arguments).toEqual({
      resourceId: 'tutorial.cylinder.detail',
      objectName: 'OperatingLine.DetailCylinder',
      radius: 0.75,
      start: [1, 2, 3],
      end: [4, 6, 3],
    });
    expect(leaf.shortcutTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'shortcut',
        reason: 'No verified shortcut procedure is available.',
      }),
    ]);
    expect(leaf.mcpTracks).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        modality: 'mcp',
        reason: 'No approved action-level MCP tool is available.',
      }),
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('preserves the exact 1.10 legacy materialization algorithm and result version', () => {
    const legacyCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.10.0',
    );
    if (legacyCatalog === undefined) throw new Error('expected InteractionCatalog 1.10.0');
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === legacyCatalog.actionCatalogVersion,
    );
    if (historicalActionCatalog === undefined) throw new Error('expected historical ActionCatalog');

    const result = materializeProcedureAuthoringCandidate(
      candidate(legacyCatalog, historicalActionCatalog),
      historicalActionCatalog,
      legacyCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected legacy leaf');
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected legacy menu track');

    expect(result.formatVersion).toBe('1.0.0');
    expect(track.operations).toHaveLength(4);
    expect(track.operations.at(-1)?.parameters).toEqual(leaf.action.arguments);
  });

  it('preserves the exact 1.11 ordered-menu result without shortcut materialization', () => {
    const orderedMenuCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.11.0',
    );
    if (orderedMenuCatalog === undefined) throw new Error('expected InteractionCatalog 1.11.0');
    const historicalActionCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === orderedMenuCatalog.actionCatalogVersion,
    );
    if (historicalActionCatalog === undefined) throw new Error('expected historical ActionCatalog');

    const result = materializeProcedureAuthoringCandidate(
      candidate(orderedMenuCatalog, historicalActionCatalog),
      historicalActionCatalog,
      orderedMenuCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected ordered menu leaf');

    expect(result.formatVersion).toBe('1.1.0');
    expect(leaf.menuTracks[0]).toMatchObject({ availability: 'available' });
    if (leaf.menuTracks[0]?.availability !== 'available') {
      throw new Error('expected ordered menu track');
    }
    expect(leaf.menuTracks[0].operations).toHaveLength(7);
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'No versioned shortcut recipe is available.',
    });
  });

  it('materializes a declared shortcut when the menu channel is unavailable', () => {
    const shortcutOnlyCatalog = structuredClone(blenderInteractionCatalog);
    const materialization = shortcutOnlyCatalog.recipes[0]!.procedureMaterialization;
    if (materialization === undefined) throw new Error('expected procedure materialization');
    materialization.menu = {
      availability: 'unavailable',
      reason: 'No native menu projection is available.',
    };

    const result = materializeProcedureAuthoringCandidate(
      candidate(shortcutOnlyCatalog),
      blenderActionCatalog,
      shortcutOnlyCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected shortcut-only leaf');

    expect(result.formatVersion).toBe('1.2.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: shortcutOnlyCatalog.recipes[0]!.id,
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'unavailable',
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'No native menu projection is available.',
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'available',
      modality: 'shortcut',
    });
  });

  it('uses result format 1.0.0 when a latest-catalog tree has only actionless leaves', () => {
    const input = candidate();
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.action = null;
    delete leaf.observationPolicy;

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(result.formatVersion).toBe('1.0.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: null,
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'unavailable',
      },
    ]);
  });

  it('uses result format 1.2.0 when a shortcut leaf is mixed with an actionless leaf', () => {
    const input = candidate();
    const orderedLeaf = input.nodes.find((node) => node.kind === 'leaf');
    if (orderedLeaf?.kind !== 'leaf') throw new Error('expected leaf');
    const actionlessLeaf = structuredClone(orderedLeaf);
    actionlessLeaf.id = 'snowman.head.eyes.annotation';
    actionlessLeaf.order = 2;
    actionlessLeaf.title = 'Describe eye placement';
    actionlessLeaf.intent = 'Keep a non-executable teaching note beside the ordered action.';
    actionlessLeaf.action = null;
    delete actionlessLeaf.observationPolicy;
    input.nodes.push(actionlessLeaf);

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(result.formatVersion).toBe('1.2.0');
    expect(
      result.coverage.map(({ leafId, recipeId, menu }) => ({ leafId, recipeId, menu })),
    ).toEqual([
      {
        leafId: orderedLeaf.id,
        recipeId: 'blender.mesh.create_uv_sphere.native',
        menu: 'materialized',
      },
      { leafId: actionlessLeaf.id, recipeId: null, menu: 'unavailable' },
    ]);
  });

  it('aligns every native operation to semantic and stable de-duplicated evidence order', () => {
    const input = candidate();
    input.evidence.push({
      id: 'evidence.extra',
      sourceId: input.sources[0]!.id,
      locator: { kind: 'whole_source' },
      description: 'Additional grounded evidence.',
      confidence: 1,
    });
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.semanticOperations[0]!.evidenceRefs = ['evidence.prompt', 'evidence.extra'];
    leaf.semanticOperations[1]!.evidenceRefs = ['evidence.extra'];

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const outputLeaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (outputLeaf?.kind !== 'leaf') throw new Error('expected leaf');
    const track = outputLeaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    for (const operation of track.operations) {
      expect(operation.semanticRefs).toEqual([
        'semantic.create',
        'semantic.transform',
        'semantic.rename',
      ]);
      expect(operation.evidenceRefs).toEqual(['evidence.prompt', 'evidence.extra']);
    }
    const shortcutTrack = outputLeaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    for (const operation of shortcutTrack.operations) {
      expect(operation.semanticRefs).toEqual([
        'semantic.create',
        'semantic.transform',
        'semantic.rename',
      ]);
      expect(operation.evidenceRefs).toEqual(['evidence.prompt', 'evidence.extra']);
    }
  });

  it('derives ordered control values only from validated action arguments', () => {
    const input = candidate();
    const leaf = input.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');
    leaf.semanticOperations[1]!.parameters = {
      location: [999, 999, 999],
      scale: [999, 999, 999],
    };
    leaf.semanticOperations[2]!.parameters = { name: 'Forged.Name' };

    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const outputLeaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (outputLeaf?.kind !== 'leaf') throw new Error('expected output leaf');
    const track = outputLeaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');

    expect(track.operations.slice(4).map((operation) => operation.parameters)).toEqual([
      { value: [0.32, -0.86, 2.14] },
      { value: [0.12, 0.12, 0.12] },
      { value: 'OperatingLine.EyeLeft' },
    ]);
    const shortcutTrack = outputLeaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available shortcut track');
    }
    expect(shortcutTrack.operations.map((operation) => operation.parameters)).toEqual([
      { radius: 1, location: [0, 0, 0] },
      { value: 0.32, confirm: 'ENTER' },
      { value: -0.86, confirm: 'ENTER' },
      { value: 2.14, confirm: 'ENTER' },
      { value: 0.12, confirm: 'ENTER' },
      { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
    ]);
  });

  it('materializes portable names as own parameters without inherited-object collisions', () => {
    const interactionCatalog = structuredClone(blenderInteractionCatalog);
    orderedMenu(interactionCatalog).operatorParameters[0]!.name = 'toString';

    const result = materializeProcedureAuthoringCandidate(
      candidate(interactionCatalog),
      blenderActionCatalog,
      interactionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected output leaf');
    const track = leaf.menuTracks[0];
    if (track?.availability !== 'available') throw new Error('expected available menu track');
    const parameters = track.operations[3]!.parameters;

    expect(Object.hasOwn(parameters, 'toString')).toBe(true);
    expect(parameters['toString']).toBe(1);
  });

  it('is deterministic, hashes canonical snapshots, and never mutates inputs', () => {
    const input = candidate();
    const actionCatalog = structuredClone(blenderActionCatalog);
    const interactionCatalog = structuredClone(blenderInteractionCatalog);
    const snapshots = structuredClone({ input, actionCatalog, interactionCatalog });

    const first = materializeProcedureAuthoringCandidate(input, actionCatalog, interactionCatalog);
    const second = materializeProcedureAuthoringCandidate(input, actionCatalog, interactionCatalog);

    expect(first).toEqual(second);
    expect(first.inputTreeContentSha256).toBe(sha256(input));
    expect(first.outputTreeContentSha256).toBe(sha256(first.tree));
    expect(first.interactionCatalogContentSha256).toBe(sha256(interactionCatalog));
    expect({ input, actionCatalog, interactionCatalog }).toEqual(snapshots);
    expect(first.tree).not.toBe(input);
  });

  it('keeps every track unavailable when the recipe has no declaration', () => {
    const interactionCatalog = structuredClone(blenderInteractionCatalog) as InteractionCatalog;
    delete interactionCatalog.recipes[0]!.procedureMaterialization;

    const result = materializeProcedureAuthoringCandidate(
      candidate(),
      blenderActionCatalog,
      interactionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected leaf');

    expect(result.coverage[0]).toEqual({
      leafId: leaf.id,
      recipeId: interactionCatalog.recipes[0]!.id,
      menu: 'unavailable',
      shortcut: 'unavailable',
      mcp: 'unavailable',
    });
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: 'The InteractionCatalog recipe does not declare menu materialization.',
    });
    expect(leaf.menuTracks[0]).not.toMatchObject({
      id: `${leaf.id}.forged.track`,
      reason: 'Forged menu reason',
    });
  });

  it('fails closed on catalog binding mismatches and invalid action arguments', () => {
    const mismatched = candidate();
    mismatched.interactionCatalogVersion = '999.0.0';
    expect(() =>
      materializeProcedureAuthoringCandidate(
        mismatched,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow('catalog binding mismatch');

    const invalidArguments = candidate();
    const leaf = invalidArguments.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('expected action leaf');
    leaf.action.arguments['radius'] = 'not-a-number';
    expect(() =>
      materializeProcedureAuthoringCandidate(
        invalidArguments,
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow('action arguments violate blender.mesh.create_uv_sphere');
  });
});
