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
  armatureLeafOperationIds,
  bevelModifierLeafOperationIds,
  canonicalizeProtocolJsonValue,
  editBevelLeafOperationIds,
  editExtrudeRegionLeafOperationIds,
  editInsetLeafOperationIds,
  editTriangulateLeafOperationIds,
  editPokeLeafOperationIds,
  lightTrailsLeafOperationIds,
  materialPaletteLeafOperationIds,
  mirrorLeafOperationIds,
  poseAnimationLeafOperationIds,
  singleMaterialLeafOperationIds,
  solidifyLeafOperationIds,
  skinWeightsLeafOperationIds,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureTreeSchema,
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
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

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

function transformGeometryCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Transform Geometry candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.geometry_nodes.create_transform',
    arguments: {
      targetId: 'tutorial.transform.target',
      modifierId: 'tutorial.transform.modifier',
      modifierName: 'OperatingLine.Transform Modifier',
      nodeGroupId: 'tutorial.transform.node_group',
      nodeGroupName: 'OperatingLine.Transform Geometry',
      translation: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1.5, 2, 2.5],
    },
  };
  leaf.semanticOperations = [
    {
      id: 'semantic.transform_geometry',
      order: 1,
      semanticAction: 'node.transform_geometry',
      description: 'Configure the accepted Transform Geometry values.',
      parameters: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function lightTrailsCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Light Trails candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.geometry_nodes.create_light_trails',
    arguments: {
      targetId: 'tutorial.light_trails.target',
      modifierId: 'tutorial.light_trails.modifier',
      modifierName: 'OperatingLine.Light Trails Modifier',
      nodeGroupId: 'tutorial.light_trails.node_group',
      nodeGroupName: 'OperatingLine.Light Trails',
      trailCount: 9,
      pointsPerTrail: 48,
      tileLength: 12,
      trailSpacing: 0.4,
      noiseScale: 1.75,
      noiseDetail: 3,
      noiseRoughness: 0.55,
      noiseSeed: 8,
      height: 1.2,
      profileSides: 4,
      profileRadius: 0.025,
      tileRepeatCount: 3,
    },
  };
  leaf.title = 'Create a procedural Light Trails graph';
  leaf.intent = 'Build the accepted fixed-topology Light Trails node graph without baking.';
  const semanticParameters: Record<string, Record<string, unknown>> = {
    'node.light_trails.half_tile_line': { tileLength: 0 },
    'node.light_trails.trail_resolution': { pointsPerTrail: 0 },
    'node.light_trails.trail_rows': { trailCount: 0, trailSpacing: 0 },
    'node.light_trails.terrain_noise': {
      noiseScale: 0,
      noiseDetail: 0,
      noiseRoughness: 0,
      noiseSeed: 0,
    },
    'node.light_trails.scale_height': { height: 0 },
    'node.light_trails.trail_profile': { profileSides: 0, profileRadius: 0 },
    'node.light_trails.loop_tiles': { tileRepeatCount: 0 },
  };
  leaf.semanticOperations = Object.entries(semanticParameters).map(
    ([semanticAction, parameters], index) => ({
      id: `semantic.light_trails.${index + 1}`,
      order: index + 1,
      semanticAction,
      description: `Configure ${semanticAction}.`,
      parameters,
      evidenceRefs: ['evidence.prompt'],
    }),
  );
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function poseAnimationCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected pose animation candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.animation.create_pose_keyframes',
    arguments: {
      actionId: 'tutorial.pose.action',
      actionName: 'OperatingLine.PoseAction',
      armatureId: 'tutorial.pose.rig',
      interpolation: 'LINEAR',
      extrapolation: 'CONSTANT',
      keyframes: [
        {
          frame: 1,
          poses: [
            { boneName: 'OperatingLine.Root', rotationEuler: [0, 0, 0] },
            { boneName: 'OperatingLine.Tip', rotationQuaternion: [1, 0, 0, 0] },
          ],
        },
        {
          frame: 20,
          poses: [
            { boneName: 'OperatingLine.Root', rotationEuler: [0, 0.25, 0] },
            {
              boneName: 'OperatingLine.Tip',
              rotationQuaternion: [0.968912421710645, 0, 0.247403959254523, 0],
            },
          ],
        },
      ],
    },
  };
  leaf.semanticOperations = [
    {
      id: 'semantic.pose.create_action',
      order: 1,
      semanticAction: 'semantic.create_pose_action',
      description: 'Create the exact managed Action.',
      parameters: { actionName: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.keyframes',
      order: 2,
      semanticAction: 'operator.insert_keyframe',
      description: 'Insert the exact per-bone transform keyframes.',
      parameters: { keyframes: [] },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.interpolation',
      order: 3,
      semanticAction: 'control.pose_interpolation',
      description: 'Set interpolation on every authored key.',
      parameters: { interpolation: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.extrapolation',
      order: 4,
      semanticAction: 'control.pose_extrapolation',
      description: 'Set extrapolation on every authored curve.',
      parameters: { extrapolation: '' },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function armatureCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected armature candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.rig.create_armature',
    arguments: {
      armatureId: 'tutorial.armature.rig',
      objectName: 'OperatingLine.ArmatureRig',
      dataName: 'OperatingLine.ArmatureRigData',
      collectionId: 'snowman.collection',
      bones: [
        {
          boneName: 'OperatingLine.Root',
          head: [0, 0, 0],
          tail: [0, 0, 1],
          parentName: null,
        },
        {
          boneName: 'OperatingLine.Tip',
          head: [0, 0, 1],
          tail: [0.25, 0, 2],
          parentName: 'OperatingLine.Root',
        },
      ],
      bindings: [{ targetId: 'tutorial.eye.left', boneName: 'OperatingLine.Tip' }],
    },
  };
  leaf.semanticOperations = [
    {
      id: 'semantic.armature.create',
      order: 1,
      semanticAction: 'menu.add_armature',
      description: 'Create and name the accepted armature.',
      parameters: { objectName: '', dataName: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.armature.bones',
      order: 2,
      semanticAction: 'mode.edit_bones',
      description: 'Create the exact ordered bone hierarchy.',
      parameters: { bones: [] },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.armature.bindings',
      order: 3,
      semanticAction: 'semantic.rigid_parent',
      description: 'Bind the accepted targets to their exact bones.',
      parameters: { bindings: [] },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function skinWeightsCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Skin Weights candidate leaf');
  const weights = [
    {
      vertexIndex: 0,
      influences: [{ boneName: 'OperatingLine.Root', weight: 1 }],
    },
    {
      vertexIndex: 1,
      influences: [{ boneName: 'OperatingLine.Tip', weight: 1 }],
    },
  ];
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.rig.bind_skin_weights',
    arguments: {
      targetId: 'tutorial.skin.target',
      armatureId: 'tutorial.skin.rig',
      modifierId: 'tutorial.skin.modifier',
      modifierName: 'OperatingLine.SkinArmature',
      preserveVolume: true,
      weights,
    },
  };
  leaf.semanticOperations = [
    {
      id: 'semantic.skin.weights',
      order: 1,
      semanticAction: 'semantic.normalized_weights',
      description: 'Assign the exact normalized per-vertex weights.',
      parameters: { weights: [] },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.skin.modifier',
      order: 2,
      semanticAction: 'semantic.armature_modifier',
      description: 'Create and name the exact Armature modifier.',
      parameters: { preserveVolume: false, modifierName: '' },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  return procedureAuthoringCandidateTreeSchema.parse(tree);
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

function solidifyCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Solidify candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_solidify',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.solidify',
      modifierName: 'OperatingLine.Cube.Solidify',
      thickness: 0.25,
      offset: -0.5,
    },
  };
  leaf.title = 'Add a bounded Solidify modifier';
  leaf.intent = 'Add a managed Solidify modifier with exact thickness and offset.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'add_solidify_modifier',
    description: 'Add one Solidify modifier to the accepted Cube.',
    parameters: { thickness: 0.25, offset: -0.5 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Object Mode modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Track the managed Solidify modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.solidify',
      modifierName: 'OperatingLine.Cube.Solidify',
    },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.solidify',
    },
  ];
  leaf.expectedObservations[0] = {
    kind: 'modifier_ready',
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.solidify',
      modifierType: 'SOLIDIFY',
      thickness: 0.25,
      offset: -0.5,
      solidifyMode: 'EXTRUDE',
      useEvenOffset: true,
      useRim: true,
      useRimOnly: false,
    },
  };
  return tree;
}

function bevelModifierCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Bevel Modifier candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_bevel',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.bevel',
      modifierName: 'OperatingLine.Cube.Bevel',
      width: 0.25,
      segments: 3,
      angleLimit: Math.PI / 3,
    },
  };
  leaf.title = 'Add a bounded Bevel modifier';
  leaf.intent = 'Add a managed Bevel modifier with exact width, segments, and angle limit.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'add_bevel_modifier',
    description: 'Add one Bevel modifier to the accepted Cube.',
    parameters: { width: 0.25, segments: 3, angleLimit: Math.PI / 3 },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Object Mode modifier target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Track the managed Bevel modifier identity and name.',
    parameters: {
      modifierId: 'tutorial.cube.bevel',
      modifierName: 'OperatingLine.Cube.Bevel',
    },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.bevel',
    },
  ];
  leaf.expectedObservations[0] = {
    kind: 'modifier_ready',
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.bevel',
      modifierType: 'BEVEL',
      width: 0.25,
      segments: 3,
      angleLimit: Math.PI / 3,
    },
  };
  return tree;
}

function singleMaterialCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Single Material candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.material.create_and_assign',
    arguments: {
      materialId: 'tutorial.material.snow',
      materialName: 'OperatingLine.Snow',
      targets: ['tutorial.head', 'tutorial.body'],
      baseColor: [0.82, 0.9, 1, 1],
      roughness: 0.35,
      metallic: 0.1,
    },
  };
  leaf.title = 'Create and assign one bounded material';
  leaf.intent = 'Create one managed Principled surface and assign it to both accepted targets.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_principled_material',
    description: 'Create one owned Principled material.',
    parameters: {
      materialId: 'tutorial.material.snow',
      materialName: 'OperatingLine.Snow',
    },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    semanticAction: 'set_principled_surface',
    description: 'Set the exact accepted surface values.',
    parameters: {
      baseColor: [0.82, 0.9, 1, 1],
      roughness: 0.35,
      metallic: 0.1,
    },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    semanticAction: 'assign_material_targets',
    description: 'Assign the material to both targets in accepted order.',
    parameters: { targets: ['tutorial.head', 'tutorial.body'] },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Head' },
    { kind: 'object', objectName: 'OperatingLine.Body' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'material_assigned',
    parameters: {
      materialId: 'tutorial.material.snow',
      targets: ['tutorial.head', 'tutorial.body'],
    },
  };
  return tree;
}

function materialPaletteCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Material Palette candidate leaf');
  const materials = [
    {
      materialId: 'tutorial.material.eyes',
      materialName: 'OperatingLine.Eyes',
      targets: ['tutorial.eye.left', 'tutorial.eye.right'],
      baseColor: [0.04, 0.08, 0.14, 1],
      roughness: 0.31,
      metallic: 0.17,
    },
    {
      materialId: 'tutorial.material.body',
      materialName: 'OperatingLine.Body',
      targets: ['tutorial.body'],
      baseColor: [0.72, 0.18, 0.09, 1],
      roughness: 0.66,
      metallic: 0.02,
    },
  ];
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.material.create_palette_and_assign',
    arguments: { materials },
  };
  leaf.title = 'Create and assign an ordered material palette';
  leaf.intent = 'Create two managed Principled surfaces and assign each accepted target once.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'create_principled_palette',
    description: 'Create both owned materials in accepted order.',
    parameters: { materials },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    semanticAction: 'set_principled_palette_surfaces',
    description: 'Configure every accepted nested surface value in order.',
    parameters: { materials },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    semanticAction: 'assign_material_palette_targets',
    description: 'Assign globally unique targets in accepted nested order.',
    parameters: { materials },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.EyeLeft' },
    { kind: 'object', objectName: 'OperatingLine.Body' },
  ];
  leaf.expectedObservations = materials.map((material) => ({
    kind: 'material_assigned' as const,
    parameters: {
      materialId: material.materialId,
      targets: [material.targets[0]!],
    },
  }));
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

function editTriangulateCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Edit Mode Triangulate candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_triangulate',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.triangulated.mesh',
      resultMeshName: 'OperatingLine.Cube.Triangulated',
    },
  };
  leaf.title = 'Triangulate every face of the accepted Cube in Edit Mode';
  leaf.intent = 'Triangulate every Cube face with the fixed managed methods.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'triangulate_mesh_faces',
    description: 'Triangulate every face of the accepted Cube.',
    parameters: { quadMethod: 'FIXED', ngonMethod: 'EAR_CLIP' },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Triangulated' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.quads_convert_to_tris' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'mesh_triangulated',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.triangulated.mesh',
    },
  };
  return tree;
}

function editExtrudeRegionCandidate(): ProcedureAuthoringCandidateTree {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('expected Extrude Region candidate leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.edit_extrude_region',
    arguments: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.extruded.mesh',
      resultMeshName: 'OperatingLine.Cube.Extruded',
      polygonIndices: [1],
      translation: [0, 0, 1],
    },
  };
  leaf.title = 'Extrude one accepted Cube face in Edit Mode';
  leaf.intent = 'Extrude Cube face 1 by the exact accepted local-space translation.';
  leaf.semanticOperations[0] = {
    ...leaf.semanticOperations[0]!,
    semanticAction: 'extrude_mesh_face_region',
    description: 'Extrude the accepted connected face region.',
    parameters: { polygonIndices: [1], translation: [0, 0, 1] },
  };
  leaf.semanticOperations[1] = {
    ...leaf.semanticOperations[1]!,
    description: 'Keep the accepted Cube as the active Edit Mode target.',
    parameters: { targetId: 'tutorial.cube' },
  };
  leaf.semanticOperations[2] = {
    ...leaf.semanticOperations[2]!,
    description: 'Name the managed replacement mesh.',
    parameters: { resultMeshName: 'OperatingLine.Cube.Extruded' },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'OperatingLine.Cube' },
    { kind: 'operator', operatorId: 'mesh.extrude_region_move' },
  ];
  leaf.expectedObservations[0] = {
    kind: 'mesh_region_extruded',
    parameters: {
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.extruded.mesh',
      polygonIndices: [1],
      translation: [0, 0, 1],
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
    expect(result.formatVersion).toBe('1.4.0');
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
    expect(track.proofExecution).toBeUndefined();
    const forgedMenuProof = structuredClone(result);
    const forgedMenuLeaf = forgedMenuProof.tree.nodes.find((node) => node.kind === 'leaf');
    const forgedMenu = forgedMenuLeaf?.kind === 'leaf' ? forgedMenuLeaf.menuTracks[0] : undefined;
    if (forgedMenu?.availability !== 'available') {
      throw new Error('expected forged menu track');
    }
    forgedMenu.proofExecution = orderedMenu(blenderInteractionCatalog).proofExecution;
    expect(procedureAuthoringMaterializationResultSchema.safeParse(forgedMenuProof).success).toBe(
      false,
    );
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
        path: ['Properties', 'Object', 'Name'],
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
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    expect(leaf.mcpTracks[0]).toMatchObject({
      id: 'blender.mesh.create_uv_sphere.native.mcp',
      availability: 'available',
      modality: 'mcp',
    });
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') throw new Error('expected available MCP track');
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_uv_sphere.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_uv_sphere as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'snowman.eye.left',
          objectName: 'OperatingLine.EyeLeft',
          location: [0.32, -0.86, 2.14],
          radius: 0.12,
        },
        resultBinding: 'snowman.head.eyes.left.companion_state_report',
      },
    ]);
    const forgedTool = structuredClone(result);
    const forgedToolLeaf = forgedTool.tree.nodes.find((node) => node.kind === 'leaf');
    if (
      forgedToolLeaf?.kind !== 'leaf' ||
      forgedToolLeaf.mcpTracks[0]?.availability !== 'available'
    ) {
      throw new Error('expected forged MCP fixture');
    }
    forgedToolLeaf.mcpTracks[0].operations[0]!.toolName = 'evil.execute_python';
    expect(procedureAuthoringMaterializationResultSchema.safeParse(forgedTool).success).toBe(false);

    const forgedArguments = structuredClone(result);
    const forgedArgumentsLeaf = forgedArguments.tree.nodes.find((node) => node.kind === 'leaf');
    if (
      forgedArgumentsLeaf?.kind !== 'leaf' ||
      forgedArgumentsLeaf.mcpTracks[0]?.availability !== 'available'
    ) {
      throw new Error('expected forged MCP arguments fixture');
    }
    forgedArgumentsLeaf.mcpTracks[0].operations[0]!.actionArguments['radius'] = 99;
    expect(procedureAuthoringMaterializationResultSchema.safeParse(forgedArguments).success).toBe(
      false,
    );
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

  it('materializes UV Sphere menu proof authority only for its exact proven arguments', async () => {
    const input = candidate();
    const inputLeaf = input.nodes.find((node) => node.kind === 'leaf');
    if (inputLeaf?.kind !== 'leaf' || inputLeaf.action === null) {
      throw new Error('expected UV Sphere candidate leaf');
    }
    inputLeaf.action.arguments = {
      resourceId: 'proof.uv_sphere.eye',
      objectName: 'OperatingLine.TutorialEye',
      radius: 1.5,
      location: [1.25, -2, 0.75],
    };
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    const menu = leaf?.kind === 'leaf' ? leaf.menuTracks[0] : undefined;
    if (menu?.availability !== 'available') throw new Error('expected UV Sphere menu track');
    expect(menu.proofExecution).toEqual(orderedMenu(blenderInteractionCatalog).proofExecution);
    expect(menu.proofExecution).toMatchObject({
      executorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      nativeUndoDepth: 8,
      proofArguments: inputLeaf.action.arguments,
    });

    const forgedOrder = structuredClone(result.tree);
    const forgedOrderLeaf = forgedOrder.nodes.find((node) => node.kind === 'leaf');
    const forgedOrderMenu =
      forgedOrderLeaf?.kind === 'leaf' ? forgedOrderLeaf.menuTracks[0] : undefined;
    if (forgedOrderMenu?.availability !== 'available') {
      throw new Error('expected exact menu proof fixture');
    }
    forgedOrderMenu.operations[0]!.order = 4;
    forgedOrderMenu.operations[3]!.order = 1;

    const forgedIntent = structuredClone(result.tree);
    const forgedIntentLeaf = forgedIntent.nodes.find((node) => node.kind === 'leaf');
    const forgedIntentMenu =
      forgedIntentLeaf?.kind === 'leaf' ? forgedIntentLeaf.menuTracks[0] : undefined;
    if (forgedIntentMenu?.availability !== 'available') {
      throw new Error('expected exact menu proof fixture');
    }
    forgedIntentMenu.operations[4]!.intent = 'execute';

    const physicallyReordered = structuredClone(result.tree);
    const physicallyReorderedLeaf = physicallyReordered.nodes.find((node) => node.kind === 'leaf');
    const physicallyReorderedMenu =
      physicallyReorderedLeaf?.kind === 'leaf' ? physicallyReorderedLeaf.menuTracks[0] : undefined;
    if (physicallyReorderedMenu?.availability !== 'available') {
      throw new Error('expected exact menu proof fixture');
    }
    physicallyReorderedMenu.operations.reverse();
    expect(procedureTreeSchema.safeParse(physicallyReordered).success).toBe(true);

    const foreignTrack = structuredClone(result.tree);
    const foreignTrackLeaf = foreignTrack.nodes.find((node) => node.kind === 'leaf');
    const provenTrack =
      foreignTrackLeaf?.kind === 'leaf' ? foreignTrackLeaf.menuTracks[0] : undefined;
    if (foreignTrackLeaf?.kind !== 'leaf' || provenTrack?.availability !== 'available') {
      throw new Error('expected exact menu proof fixture');
    }
    const forgedTrack = structuredClone(provenTrack);
    delete provenTrack.proofExecution;
    forgedTrack.id = 'foreign.menu.track';
    foreignTrackLeaf.menuTracks.push(forgedTrack);

    for (const forged of [forgedOrder, forgedIntent, foreignTrack]) {
      const parsed = procedureTreeSchema.safeParse(forged);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('expected forged menu proof rejection');
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.arrayContaining(['menuTracks', 'proofExecution']),
          }),
        ]),
      );
    }
    await validatePublicJsonSchemaCases(
      JSON.parse(
        readFileSync(resolve('protocol/schemas/v1/procedure-tree.schema.json'), 'utf8'),
      ) as object,
      [
        { value: result.tree, accepted: true },
        { value: physicallyReordered, accepted: true },
        { value: forgedOrder, accepted: false },
        { value: forgedIntent, accepted: false },
        { value: foreignTrack, accepted: false },
      ],
    );
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

  it('materializes the exact Icosphere menu, shortcut, and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_icosphere.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Icosphere MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_icosphere.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_icosphere as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.icosphere.detail',
          objectName: 'OperatingLine.IcosphereDetail',
          subdivisions: 3,
          radius: 1.75,
          location: [-1.25, 2.5, 0.75],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the non-executable Edit Mode Subdivide menu candidate with concrete values', () => {
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

    expect(result.formatVersion).toBe('1.6.0');
    expect(result.tree.formatVersion).toBe('1.2.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_subdivide.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'materialized',
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
    expect(leaf.menuCandidates).toHaveLength(1);
    const menuCandidate = leaf.menuCandidates?.[0];
    if (menuCandidate === undefined) throw new Error('expected Subdivide menu candidate');
    expect(menuCandidate).toMatchObject({
      id: 'blender.mesh.edit_subdivide.semantic.menu-candidate',
      modality: 'menu',
      projection: 'candidate_only',
      equivalence: 'not_equivalent_to_managed_action',
      executionAuthority: 'none',
    });
    expect(menuCandidate.operations.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'candidate.workspace_layout', order: 1 },
      { id: 'candidate.use_accepted_active_mesh', order: 2 },
      { id: 'candidate.enter_edit_mode', order: 3 },
      { id: 'candidate.open_select_menu', order: 4 },
      { id: 'candidate.select_all_mesh_elements', order: 5 },
      { id: 'candidate.open_edge_menu', order: 6 },
      { id: 'candidate.execute_subdivide', order: 7 },
      { id: 'candidate.open_adjust_last_operation', order: 8 },
      { id: 'candidate.set_number_of_cuts', order: 9 },
      { id: 'candidate.set_smoothness', order: 10 },
      { id: 'candidate.return_to_object_mode', order: 11 },
    ]);
    expect(menuCandidate.operations[4]).toMatchObject({
      target: { kind: 'operator', hostId: 'mesh.select_all' },
      path: ['Layout', '3D Viewport Header', 'Select', 'All'],
      parameters: { action: 'SELECT' },
    });
    expect(menuCandidate.operations.slice(8, 10)).toMatchObject([
      {
        target: { kind: 'control', hostId: 'mesh.subdivide.number_cuts' },
        path: ['Adjust Last Operation', 'Number of Cuts'],
        parameters: { value: 2 },
      },
      {
        target: { kind: 'control', hostId: 'mesh.subdivide.smoothness' },
        path: ['Adjust Last Operation', 'Smoothness'],
        parameters: { value: 0.25 },
      },
    ]);
    expect(menuCandidate.omittedActionArguments.map(({ argumentName }) => argumentName)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    expect(menuCandidate.nativeEvidence).toEqual({
      kind: 'bounded_blender_ui_probe',
      executorId: 'blender.mesh_edit_subdivide_candidate_menu_f9.event_simulate.v1',
      hostVersions: ['4.5.3', '5.1.1'],
      managedActionExecuted: false,
      managedReceiptCreated: false,
      managedReplacementMeshCreated: false,
      nativeMutationKind: 'in_place_edit_mesh_subdivide',
      operationIds: menuCandidate.operations.map((operation) => operation.id),
      nativeUndoCheckpointRequired: true,
      nativeUndoDepth: 4,
      nativeRedoDepth: 4,
    });
    expect(
      menuCandidate.operations.flatMap((operation) => Object.keys(operation.parameters)),
    ).not.toEqual(expect.arrayContaining(['targetId', 'resultMeshId', 'resultMeshName']));
    expect(leaf.parameterProjection).toMatchObject({
      formatVersion: '1.1.0',
      bindings: expect.arrayContaining([
        expect.objectContaining({
          actionArgument: 'cuts',
          target: {
            modality: 'menu_candidate',
            trackId: menuCandidate.id,
            operationId: 'candidate.set_number_of_cuts',
            path: [{ kind: 'field', name: 'value' }],
          },
        }),
        expect.objectContaining({
          actionArgument: 'smooth',
          target: {
            modality: 'menu_candidate',
            trackId: menuCandidate.id,
            operationId: 'candidate.set_smoothness',
            path: [{ kind: 'field', name: 'value' }],
          },
        }),
      ]),
    });
    const shortcutTrack = leaf.shortcutTracks[0];
    if (shortcutTrack?.availability !== 'available') {
      throw new Error('expected available Subdivide shortcut track');
    }
    expect(shortcutTrack).toMatchObject({
      id: 'blender.mesh.edit_subdivide.semantic.shortcut',
      modality: 'shortcut',
    });
    expect(shortcutTrack.preconditions).toHaveLength(14);
    expect(shortcutTrack.preconditions).toContainEqual({
      kind: 'mode',
      label: 'Mode',
      value: 'OBJECT',
    });
    expect(shortcutTrack.preconditions).toContainEqual({
      kind: 'selection',
      label: 'Active Target',
      value: 'Exactly the factory Cube is active and selected',
    });
    expect(shortcutTrack.preconditions).toEqual(
      expect.arrayContaining([
        { kind: 'scene_state', label: 'Object Identity', value: 'Cube' },
        {
          kind: 'scene_state',
          label: 'Initial Topology',
          value: '8 vertices, 12 edges, 6 polygons',
        },
        { kind: 'scene_state', label: 'Mesh Data Users', value: '1' },
        { kind: 'scene_state', label: 'Scene Mesh Datablocks', value: '1' },
        { kind: 'scene_state', label: 'Modifiers', value: 'None' },
        { kind: 'scene_state', label: 'Shape Keys', value: 'None' },
      ]),
    );
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
        id: 'blender.mesh.edit_subdivide.semantic.mcp',
        availability: 'available',
        modality: 'mcp',
      }),
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes Mirror as exactly seven ordered fixed-tool MCP operations', () => {
    const input = mirrorCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Mirror leaf');

    expect(result.formatVersion).toBe('1.5.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.modifier.add_mirror.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
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
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Mirror MCP track');
    expect(track).toMatchObject({
      id: 'blender.modifier.add_mirror.semantic.mcp',
      title: 'Add a bounded Mirror modifier operation-level MCP projection',
      preconditions: [],
      modality: 'mcp',
    });
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      mirrorLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.modifier.mirror.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.mirror',
      },
      {},
      {},
      {},
      {},
      {},
      {
        modifierName: 'OperatingLine.Cube.Mirror',
        axis: 'Y',
      },
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
  });

  it('materializes Solidify as exactly four ordered fixed-tool MCP operations', () => {
    const input = solidifyCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Solidify leaf');

    expect(result.formatVersion).toBe('1.5.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.modifier.add_solidify.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.expectedObservations).toEqual([
      {
        kind: 'modifier_ready',
        parameters: {
          targetId: 'tutorial.cube',
          modifierId: 'tutorial.cube.solidify',
          modifierType: 'SOLIDIFY',
          thickness: 0.25,
          offset: -0.5,
          solidifyMode: 'EXTRUDE',
          useEvenOffset: true,
          useRim: true,
          useRimOnly: false,
        },
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('managed modifier identity'),
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('accepted Solidify parameters'),
    });
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Solidify MCP track');
    expect(track).toMatchObject({
      id: 'blender.modifier.add_solidify.semantic.mcp',
      title: 'Add a bounded Solidify modifier operation-level MCP projection',
      preconditions: [],
      modality: 'mcp',
    });
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      solidifyLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.modifier.solidify.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.solidify',
      },
      {},
      {},
      {
        modifierName: 'OperatingLine.Cube.Solidify',
        thickness: 0.25,
        offset: -0.5,
      },
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
  });

  it('materializes Bevel Modifier as exactly four ordered fixed-tool MCP operations', () => {
    const input = bevelModifierCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Bevel Modifier leaf');

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.modifier.add_bevel.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.expectedObservations).toEqual([
      {
        kind: 'modifier_ready',
        parameters: {
          targetId: 'tutorial.cube',
          modifierId: 'tutorial.cube.bevel',
          modifierType: 'BEVEL',
          width: 0.25,
          segments: 3,
          angleLimit: Math.PI / 3,
        },
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('managed modifier identity'),
    });
    expect(leaf.shortcutTracks[0]).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining('accepted Bevel Modifier parameters'),
    });
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Bevel Modifier MCP track');
    expect(track).toMatchObject({
      id: 'blender.modifier.add_bevel.semantic.mcp',
      title: 'Add a bounded Bevel modifier operation-level MCP projection',
      preconditions: [],
      modality: 'mcp',
    });
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      bevelModifierLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.modifier.bevel.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        modifierId: 'tutorial.cube.bevel',
      },
      {},
      {},
      {
        modifierName: 'OperatingLine.Cube.Bevel',
        width: 0.25,
        segments: 3,
        angleLimit: Math.PI / 3,
      },
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
  });

  it('materializes Single Material as exactly four ordered fixed-tool MCP operations', () => {
    const input = singleMaterialCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Single Material leaf');

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.material.create_and_assign.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.expectedObservations).toEqual([
      {
        kind: 'material_assigned',
        parameters: {
          materialId: 'tutorial.material.snow',
          targets: ['tutorial.head', 'tutorial.body'],
        },
      },
    ]);
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Single Material MCP track');
    expect(track).toMatchObject({
      id: 'blender.material.create_and_assign.semantic.mcp',
      title: 'Create and assign one Principled material operation-level MCP projection',
      preconditions: [],
      modality: 'mcp',
    });
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      singleMaterialLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.material.single.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      { materialId: 'tutorial.material.snow' },
      {},
      {},
      {
        materialName: 'OperatingLine.Snow',
        baseColor: [0.82, 0.9, 1, 1],
        roughness: 0.35,
        metallic: 0.1,
        targets: ['tutorial.head', 'tutorial.body'],
      },
    ]);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
  });

  it('materializes Material Palette as one exact nested parameter operation and atomic assignment', () => {
    const input = materialPaletteCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected materialized Material Palette leaf');

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.material.create_palette_and_assign.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.expectedObservations).toEqual(
      inputSnapshot.nodes.find((node) => node.kind === 'leaf')?.expectedObservations,
    );
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Material Palette MCP track');
    expect(track).toMatchObject({
      id: 'blender.material.create_palette_and_assign.semantic.mcp',
      title: 'Create and assign a Principled material palette operation-level MCP projection',
      preconditions: [],
      modality: 'mcp',
    });
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      materialPaletteLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.material.palette.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    const materials = materialPaletteCandidate().nodes.find((node) => node.kind === 'leaf')?.action
      ?.arguments['materials'];
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {},
      {},
      { materials },
      {},
    ]);
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
    expect(shortcut.proofExecution).toBeUndefined();
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

  it('materializes native shortcut proof authority only from active IC1.39', () => {
    const result = materializeProcedureAuthoringCandidate(
      subdivisionSurfaceCandidate(blenderInteractionCatalog, blenderActionCatalog),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.shortcutTracks[0]?.availability !== 'available') {
      throw new Error('expected active Subdivision Surface shortcut');
    }
    expect(leaf.shortcutTracks[0].proofExecution).toMatchObject({
      executorId: 'blender.subdivision_surface_f9.event_simulate.v1',
      targetProfile: 'factory_cube_8_12_6',
      managedActionExecuted: false,
      managedReceiptCreated: false,
    });
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

    expect(result.formatVersion).toBe('1.5.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_bevel_edges.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'materialized',
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
      id: 'blender.mesh.edit_bevel_edges.semantic.mcp',
      availability: 'available',
      modality: 'mcp',
    });
    const mcp = leaf.mcpTracks[0];
    if (mcp?.availability !== 'available') {
      throw new Error('expected available Edit Mode Bevel MCP track');
    }
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editBevelLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      mcp.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.mesh.edit-bevel-edges.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(mcp.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.beveled.mesh',
      },
      {},
      {},
      {},
      { width: 0.2, segments: 3, profile: 0.6 },
      { resultMeshName: 'OperatingLine.Cube.Beveled' },
    ]);
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

    expect(result.formatVersion).toBe('1.5.0');
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_inset_faces.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'materialized',
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
      id: 'blender.mesh.edit_inset_faces.semantic.mcp',
      availability: 'available',
      modality: 'mcp',
    });
    const mcp = leaf.mcpTracks[0];
    if (mcp?.availability !== 'available') {
      throw new Error('expected available Edit Mode Inset MCP track');
    }
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editInsetLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      mcp.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.mesh.edit-inset-faces.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(mcp.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.inset.mesh',
      },
      {},
      {},
      {},
      { thickness: 0.2, depth: 0.1 },
      { resultMeshName: 'OperatingLine.Cube.Inset' },
    ]);
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

  it('materializes the exact six-step Edit Triangulate operation MCP rail', () => {
    const input = editTriangulateCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Edit Mode Triangulate leaf');
    }

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_triangulate.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.action.arguments).toEqual({
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.triangulated.mesh',
      resultMeshName: 'OperatingLine.Cube.Triangulated',
    });
    expect(leaf.expectedObservations).toEqual([
      {
        kind: 'mesh_triangulated',
        parameters: {
          targetId: 'tutorial.cube',
          resultMeshId: 'tutorial.cube.triangulated.mesh',
        },
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
    expect(leaf.shortcutTracks[0]).toMatchObject({ availability: 'unavailable' });
    const mcp = leaf.mcpTracks[0];
    if (mcp?.availability !== 'available') {
      throw new Error('expected available Edit Mode Triangulate MCP track');
    }
    expect(mcp).toMatchObject({
      id: 'blender.mesh.edit_triangulate.semantic.mcp',
      modality: 'mcp',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editTriangulateLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.operationParameters)).toEqual([
      { targetId: 'tutorial.cube', resultMeshId: 'tutorial.cube.triangulated.mesh' },
      {},
      {},
      {},
      {},
      { resultMeshName: 'OperatingLine.Cube.Triangulated' },
    ]);
    expect(
      mcp.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.mesh.edit-triangulate.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState',
      ),
    ).toBe(true);
    expect(leaf.validation).toMatchObject({ status: 'candidate', validatedHostVersions: [] });
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact six-step Extrude Region operation MCP rail with ordered selection and translation parameters', () => {
    const input = editExtrudeRegionCandidate();
    const inputSnapshot = structuredClone(input);
    const result = materializeProcedureAuthoringCandidate(
      input,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected materialized Extrude Region leaf');
    }

    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_extrude_region.semantic',
        menu: 'unavailable',
        shortcut: 'unavailable',
        mcp: 'materialized',
      },
    ]);
    expect(leaf.action.arguments).toEqual({
      targetId: 'tutorial.cube',
      resultMeshId: 'tutorial.cube.extruded.mesh',
      resultMeshName: 'OperatingLine.Cube.Extruded',
      polygonIndices: [1],
      translation: [0, 0, 1],
    });
    expect(leaf.expectedObservations).toEqual([
      {
        kind: 'mesh_region_extruded',
        parameters: {
          targetId: 'tutorial.cube',
          resultMeshId: 'tutorial.cube.extruded.mesh',
          polygonIndices: [1],
          translation: [0, 0, 1],
        },
      },
    ]);
    expect(leaf.menuTracks[0]).toMatchObject({ availability: 'unavailable' });
    expect(leaf.shortcutTracks[0]).toMatchObject({ availability: 'unavailable' });
    const mcp = leaf.mcpTracks[0];
    if (mcp?.availability !== 'available') {
      throw new Error('expected available Extrude Region MCP track');
    }
    expect(mcp).toMatchObject({
      id: 'blender.mesh.edit_extrude_region.semantic.mcp',
      modality: 'mcp',
    });
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editExtrudeRegionLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.operationParameters)).toEqual([
      { targetId: 'tutorial.cube', resultMeshId: 'tutorial.cube.extruded.mesh' },
      {},
      {},
      { polygonIndices: [1] },
      { translation: [0, 0, 1] },
      { resultMeshName: 'OperatingLine.Cube.Extruded' },
    ]);
    expect(
      mcp.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.mesh.edit-extrude-region.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState',
      ),
    ).toBe(true);
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

    expect(result).toMatchObject({ formatVersion: '1.5.0' });
    expect(result.tree.formatVersion).toBe('1.1.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.edit_poke_faces.semantic',
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks[0]).toMatchObject({
      id: 'blender.mesh.edit_poke_faces.semantic.mcp',
      availability: 'available',
      modality: 'mcp',
    });
    const mcp = leaf.mcpTracks[0];
    if (mcp?.availability !== 'available') {
      throw new Error('expected available Edit Mode Poke MCP track');
    }
    expect(mcp.operations.map((operation) => operation.sourceOperationId)).toEqual(
      editPokeLeafOperationIds,
    );
    expect(mcp.operations.map((operation) => operation.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      mcp.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.mesh.edit-poke-faces.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(mcp.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.cube',
        resultMeshId: 'tutorial.cube.poked.mesh',
      },
      {},
      {},
      {},
      { offset: 0.2 },
      { resultMeshName: 'OperatingLine.Cube.Poked' },
    ]);
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

  it('materializes the exact Cube menu, shortcut, and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cube.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Cube MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_cube.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_cube as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.cube.body',
          objectName: 'OperatingLine.CubeBody',
          size: 2.5,
          location: [-1, 2, 0.5],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Plane menu, shortcut, and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_plane.native',
        menu: 'materialized',
        shortcut: 'materialized',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Plane MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_plane.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_plane as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.plane.ground',
          objectName: 'OperatingLine.GroundPlane',
          size: 12.5,
          location: [0, 0, -1.25],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact Torus ordered menu and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_torus.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Torus MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_torus.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_torus as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.torus.detail',
          objectName: 'OperatingLine.DetailTorus',
          majorSegments: 48,
          minorSegments: 12,
          majorRadius: 2.25,
          minorRadius: 0.4,
          location: [1.5, -2, 0.75],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact derived Cone segment frame and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cone.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Cone MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_cone.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_cone as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.cone.detail',
          objectName: 'OperatingLine.DetailCone',
          radiusStart: 1.25,
          radiusEnd: 0.25,
          start: [1, 2, 3],
          end: [4, 6, 3],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
    ]);
    expect(input).toEqual(inputSnapshot);
    expect(result.tree).not.toBe(input);
  });

  it('materializes the exact derived Cylinder segment frame and action-level MCP operation', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: 'blender.mesh.create_cylinder.native',
        menu: 'materialized',
        shortcut: 'unavailable',
        mcp: 'materialized',
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
    expect(leaf.mcpTracks).toHaveLength(1);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') {
      throw new Error('expected available Cylinder MCP track');
    }
    expect(mcpTrack.operations).toEqual([
      {
        id: 'blender.mesh.create_cylinder.native.mcp.execute',
        order: 1,
        semanticRefs: leaf.semanticOperations.map((operation) => operation.id),
        description: 'Execute blender.mesh.create_cylinder as the accepted replay next step',
        evidenceRefs: [
          ...new Set(leaf.semanticOperations.flatMap((operation) => operation.evidenceRefs)),
        ],
        serverName: 'operating-line',
        toolName: 'operatingline.blender.action.execute',
        arguments: {
          formatVersion: '1.0.0',
          requestId: '$runtime.requestId',
          replayId: '$runtime.replayId',
          expectedState: '$runtime.expectedState',
        },
        argumentSource: 'accepted_leaf_action',
        actionArguments: {
          resourceId: 'tutorial.cylinder.detail',
          objectName: 'OperatingLine.DetailCylinder',
          radius: 0.75,
          start: [1, 2, 3],
          end: [4, 6, 3],
        },
        resultBinding: `${leaf.id}.companion_state_report`,
      },
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

    expect(result.formatVersion).toBe('1.4.0');
    expect(result.coverage).toEqual([
      {
        leafId: leaf.id,
        recipeId: shortcutOnlyCatalog.recipes[0]!.id,
        menu: 'unavailable',
        shortcut: 'materialized',
        mcp: 'materialized',
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

  it('uses result format 1.4.0 when an MCP leaf is mixed with an actionless leaf', () => {
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

    expect(result.formatVersion).toBe('1.4.0');
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
    const menu = orderedMenu(interactionCatalog);
    delete menu.proofExecution;
    menu.operatorParameters[0]!.name = 'toString';

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

  it('materializes Transform Geometry as exactly eleven ordered catalog-bound MCP operations', () => {
    const result = materializeProcedureAuthoringCandidate(
      transformGeometryCandidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    expect(result.formatVersion).toBe('1.5.0');
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected Transform Geometry leaf');
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected operation MCP track');

    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual([
      'semantic.preflight_transform_geometry_resources',
      'semantic.new_geometry_modifier',
      'node.group_input',
      'node.transform_geometry',
      'projection.semantic.transform_geometry.translation',
      'projection.semantic.transform_geometry.rotation',
      'projection.semantic.transform_geometry.scale',
      'node.group_output',
      'semantic.connect_group_input_geometry_to_transform',
      'semantic.connect_transform_geometry_to_group_output',
      'semantic.verify_node_links',
    ]);
    expect(track.operations.map((operation) => operation.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.geometry-nodes.transform.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined,
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: 'tutorial.transform.target',
        modifierId: 'tutorial.transform.modifier',
        modifierName: 'OperatingLine.Transform Modifier',
        nodeGroupId: 'tutorial.transform.node_group',
        nodeGroupName: 'OperatingLine.Transform Geometry',
      },
      {},
      {},
      {},
      { translation: [1, 2, 3] },
      { rotation: [0.1, 0.2, 0.3] },
      { scale: [1.5, 2, 2.5] },
      {},
      {},
      {},
      {},
    ]);
    expect(
      track.operations.every((operation) =>
        operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
  });

  it('materializes Light Trails as exactly 54 ordered fixed-tool MCP operations', () => {
    const result = materializeProcedureAuthoringCandidate(
      lightTrailsCandidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('expected Light Trails leaf');
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected operation MCP track');

    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      lightTrailsLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual(
      lightTrailsLeafOperationIds.map((_, index) => index + 1),
    );
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.geometry-nodes.light-trails.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    const expectedParameters: Record<number, Record<string, unknown>> = {
      0: {
        targetId: 'tutorial.light_trails.target',
        modifierId: 'tutorial.light_trails.modifier',
        modifierName: 'OperatingLine.Light Trails Modifier',
        nodeGroupId: 'tutorial.light_trails.node_group',
        nodeGroupName: 'OperatingLine.Light Trails',
      },
      4: { tileLength: 12 },
      6: { pointsPerTrail: 48 },
      8: { trailCount: 9 },
      9: { trailSpacing: 0.4 },
      14: { noiseScale: 1.75 },
      15: { noiseDetail: 3 },
      16: { noiseRoughness: 0.55 },
      17: { noiseSeed: 8 },
      20: { height: 1.2 },
      26: { profileSides: 4 },
      27: { profileRadius: 0.025 },
      30: { tileRepeatCount: 3 },
    };
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual(
      lightTrailsLeafOperationIds.map((_, index) => expectedParameters[index] ?? {}),
    );
  });

  it('materializes exact structured pose keyframes into the visible semantic tree', () => {
    const result = materializeProcedureAuthoringCandidate(
      poseAnimationCandidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected pose animation leaf');
    }

    expect(leaf.semanticOperations.map((operation) => operation.parameters)).toEqual([
      { actionName: 'OperatingLine.PoseAction' },
      { keyframes: leaf.action.arguments['keyframes'] },
      { interpolation: 'LINEAR' },
      { extrapolation: 'CONSTANT' },
    ]);
    expect(
      leaf.parameterProjection?.bindings.map((binding) => ({
        actionArgument: binding.actionArgument,
        transform: binding.transform,
        operationId: binding.target.operationId,
      })),
    ).toEqual([
      {
        actionArgument: 'actionName',
        transform: 'identity',
        operationId: 'semantic.pose.create_action',
      },
      {
        actionArgument: 'keyframes',
        transform: 'json_identity',
        operationId: 'semantic.pose.keyframes',
      },
      {
        actionArgument: 'interpolation',
        transform: 'identity',
        operationId: 'semantic.pose.interpolation',
      },
      {
        actionArgument: 'extrapolation',
        transform: 'identity',
        operationId: 'semantic.pose.extrapolation',
      },
      {
        actionArgument: 'actionId',
        transform: 'identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.01',
      },
      {
        actionArgument: 'armatureId',
        transform: 'identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.01',
      },
      {
        actionArgument: 'actionName',
        transform: 'identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.05',
      },
      {
        actionArgument: 'keyframes',
        transform: 'json_identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.07',
      },
      {
        actionArgument: 'interpolation',
        transform: 'identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.09',
      },
      {
        actionArgument: 'extrapolation',
        transform: 'identity',
        operationId: 'blender.animation.create_pose_keyframes.semantic.mcp.11',
      },
    ]);
    expect(leaf.menuTracks).toEqual([
      expect.objectContaining({ availability: 'unavailable', modality: 'menu' }),
    ]);
    expect(leaf.shortcutTracks).toEqual([
      expect.objectContaining({ availability: 'unavailable', modality: 'shortcut' }),
    ]);
    const mcpTrack = leaf.mcpTracks[0];
    if (mcpTrack?.availability !== 'available') throw new Error('expected pose MCP track');
    expect(mcpTrack.operations).toHaveLength(12);
    expect(mcpTrack.operations.map((operation) => operation.sourceOperationId)).toEqual(
      poseAnimationLeafOperationIds,
    );
    expect(
      mcpTrack.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.animation.pose-keyframes.execute-next',
      ),
    ).toBe(true);
    expect(mcpTrack.operations.map((operation) => operation.operationParameters)).toEqual(
      poseAnimationLeafOperationIds.map((_, index) => {
        const expected: Record<number, Record<string, unknown>> = {
          0: {
            actionId: leaf.action!.arguments['actionId'],
            armatureId: leaf.action!.arguments['armatureId'],
          },
          4: { actionName: leaf.action!.arguments['actionName'] },
          6: { keyframes: leaf.action!.arguments['keyframes'] },
          8: { interpolation: leaf.action!.arguments['interpolation'] },
          10: { extrapolation: leaf.action!.arguments['extrapolation'] },
        };
        return expected[index] ?? {};
      }),
    );
    expect(() => validateProcedureTree(result.tree)).not.toThrow();
  });

  it('materializes Armature as exactly nine ordered fixed-tool MCP operations', () => {
    const result = materializeProcedureAuthoringCandidate(
      armatureCandidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected armature leaf');
    }

    expect(leaf.semanticOperations.map((operation) => operation.parameters)).toEqual([
      {
        objectName: leaf.action.arguments['objectName'],
        dataName: leaf.action.arguments['dataName'],
      },
      { bones: leaf.action.arguments['bones'] },
      { bindings: leaf.action.arguments['bindings'] },
    ]);
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Armature MCP track');
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      armatureLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual(
      armatureLeafOperationIds.map((_, index) => index + 1),
    );
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.rig.armature.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        armatureId: leaf.action.arguments['armatureId'],
        collectionId: leaf.action.arguments['collectionId'],
      },
      {},
      { objectName: leaf.action.arguments['objectName'] },
      { dataName: leaf.action.arguments['dataName'] },
      {},
      { bones: leaf.action.arguments['bones'] },
      {},
      { bindings: leaf.action.arguments['bindings'] },
      {},
    ]);
    expect(() => validateProcedureTree(result.tree)).not.toThrow();
  });

  it('materializes Skin Weights as exactly nine ordered fixed-tool MCP operations', () => {
    const result = materializeProcedureAuthoringCandidate(
      skinWeightsCandidate(),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const leaf = result.tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      throw new Error('expected Skin Weights leaf');
    }

    expect(leaf.semanticOperations.map((operation) => operation.parameters)).toEqual([
      { weights: leaf.action.arguments['weights'] },
      {
        preserveVolume: leaf.action.arguments['preserveVolume'],
        modifierName: leaf.action.arguments['modifierName'],
      },
    ]);
    const track = leaf.mcpTracks[0];
    if (track?.availability !== 'available') throw new Error('expected Skin Weights MCP track');
    expect(track.operations.map((operation) => operation.sourceOperationId)).toEqual(
      skinWeightsLeafOperationIds,
    );
    expect(track.operations.map((operation) => operation.order)).toEqual(
      skinWeightsLeafOperationIds.map((_, index) => index + 1),
    );
    expect(
      track.operations.every(
        (operation) =>
          operation.toolName === 'operatingline.blender.rig.skin-weights.execute-next' &&
          Object.keys(operation.arguments).join(',') ===
            'formatVersion,requestId,replayId,expectedState' &&
          operation.argumentSource === undefined &&
          operation.actionArguments === undefined &&
          operation.resultBinding?.endsWith('.companion_leaf_operation_progress'),
      ),
    ).toBe(true);
    expect(track.operations.map((operation) => operation.operationParameters)).toEqual([
      {
        targetId: leaf.action.arguments['targetId'],
        armatureId: leaf.action.arguments['armatureId'],
        modifierId: leaf.action.arguments['modifierId'],
      },
      {},
      {},
      {},
      { weights: leaf.action.arguments['weights'] },
      {},
      { preserveVolume: leaf.action.arguments['preserveVolume'] },
      { modifierName: leaf.action.arguments['modifierName'] },
      {},
    ]);
    expect(() => validateProcedureTree(result.tree)).not.toThrow();
  });

  it.each([
    ['reordered', (operations: Array<{ sourceOperationId: string }>) => operations.reverse()],
    [
      'duplicate',
      (operations: Array<{ sourceOperationId: string }>) => {
        operations[1]!.sourceOperationId = operations[0]!.sourceOperationId;
      },
    ],
    [
      'tampered source',
      (operations: Array<{ sourceOperationId: string }>) => {
        operations[10]!.sourceOperationId = 'semantic.execute_python';
      },
    ],
  ])('rejects %s Transform Geometry MCP catalog operations', (_label, mutate) => {
    const hostile = structuredClone(blenderInteractionCatalog);
    const transform = hostile.recipes.find(
      (recipe) => recipe.actionName === 'blender.geometry_nodes.create_transform',
    );
    const mcp = transform?.procedureMaterialization?.mcp;
    if (mcp?.availability !== 'available' || mcp.source !== 'catalog.operation_level_mcp') {
      throw new Error('expected operation MCP declaration');
    }
    mutate(mcp.operations);
    expect(() =>
      materializeProcedureAuthoringCandidate(
        transformGeometryCandidate(),
        blenderActionCatalog,
        hostile,
      ),
    ).toThrow('exact ordered Transform Geometry operation contract');
  });
});
