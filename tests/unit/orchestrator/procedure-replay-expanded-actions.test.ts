import type {
  CompanionStateReport,
  ProcedureLeafReplayActionName,
  ProcedureLeafReplayBinding,
} from '@operatingline/protocol';
import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { describe, expect, it } from 'vitest';

import {
  prepareProcedureLeafReplay,
  validateStrongProcedureLeafReplayObservation,
} from '../../../services/orchestrator/src/procedure-replay.js';

const digest = 'a'.repeat(64);

const lightTrailsNodeTypes = [
  'GeometryNodeCurvePrimitiveCircle',
  'GeometryNodeCurvePrimitiveLine',
  'GeometryNodeCurveToMesh',
  'GeometryNodeInputPosition',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeJoinGeometry',
  'GeometryNodeMeshLine',
  'GeometryNodeMeshLine',
  'GeometryNodeRealizeInstances',
  'GeometryNodeRealizeInstances',
  'GeometryNodeResampleCurve',
  'GeometryNodeSetPosition',
  'GeometryNodeTransform',
  'NodeGroupInput',
  'NodeGroupOutput',
  'ShaderNodeCombineXYZ',
  'ShaderNodeMath',
  'ShaderNodeMath',
  'ShaderNodeTexNoise',
];

const transformGeometryNodeTypes = ['GeometryNodeTransform', 'NodeGroupInput', 'NodeGroupOutput'];

const lightTrailsInterface = [
  ['INPUT', 'NodeSocketGeometry', 'Geometry'],
  ['OUTPUT', 'NodeSocketGeometry', 'Geometry'],
];

const lightTrailsLinks = [
  ['OperatingLine Center Noise', 'Value', 'OperatingLine Scale Height', 'Value'],
  ['OperatingLine Curve To Mesh', 'Mesh', 'OperatingLine Tile Instances', 'Instance'],
  ['OperatingLine Displace Trails', 'Geometry', 'OperatingLine Mirror Half Tile', 'Geometry'],
  ['OperatingLine Displace Trails', 'Geometry', 'OperatingLine Mirrored Tile', 'Geometry'],
  ['OperatingLine Half Tile Line', 'Curve', 'OperatingLine Trail Resolution', 'Curve'],
  ['OperatingLine Loop Tiles', 'Mesh', 'OperatingLine Tile Instances', 'Points'],
  ['OperatingLine Mirror Half Tile', 'Geometry', 'OperatingLine Mirrored Tile', 'Geometry'],
  ['OperatingLine Mirrored Tile', 'Geometry', 'OperatingLine Curve To Mesh', 'Curve'],
  ['OperatingLine Realize Tiles', 'Geometry', 'OperatingLine Output', 'GROUP_OUTPUT_GEOMETRY'],
  ['OperatingLine Realize Trails', 'Geometry', 'OperatingLine Displace Trails', 'Geometry'],
  ['OperatingLine Scale Height', 'Value', 'OperatingLine Z Offset', 'Z'],
  ['OperatingLine Terrain Noise', 'Fac', 'OperatingLine Center Noise', 'Value'],
  ['OperatingLine Tile Instances', 'Instances', 'OperatingLine Realize Tiles', 'Geometry'],
  ['OperatingLine Trail Instances', 'Instances', 'OperatingLine Realize Trails', 'Geometry'],
  ['OperatingLine Trail Position', 'Position', 'OperatingLine Terrain Noise', 'Vector'],
  ['OperatingLine Trail Profile', 'Curve', 'OperatingLine Curve To Mesh', 'Profile Curve'],
  ['OperatingLine Trail Resolution', 'Curve', 'OperatingLine Trail Instances', 'Instance'],
  ['OperatingLine Trail Rows', 'Mesh', 'OperatingLine Trail Instances', 'Points'],
  ['OperatingLine Z Offset', 'Vector', 'OperatingLine Displace Trails', 'Offset'],
];

function validateObservation(input: {
  actionName: ProcedureLeafReplayActionName;
  observationKind: string;
  parameters: Record<string, unknown>;
  details: Record<string, unknown>;
  actionArguments?: Record<string, unknown>;
}) {
  const binding = {
    actionName: input.actionName,
    leafId: 'tutorial.leaf',
    proposal: {
      plan: {
        steps: [
          {
            id: 'tutorial.leaf',
            action: {
              name: input.actionName,
              ...(input.actionArguments === undefined ? {} : { arguments: input.actionArguments }),
            },
            expectedObservations: [{ kind: input.observationKind, parameters: input.parameters }],
          },
        ],
      },
    },
  } as ProcedureLeafReplayBinding;
  const report = {
    observations: [
      {
        kind: input.observationKind,
        satisfied: true,
        details: input.details,
      },
    ],
  } as CompanionStateReport;
  const observations = validateStrongProcedureLeafReplayObservation(binding, report);
  return observations.length === 1 ? observations[0]! : observations;
}

function replacementDetails(
  parameters: Record<string, unknown>,
  counts: {
    sourceVertexCount: number;
    sourceEdgeCount: number;
    sourceFaceCount: number;
    vertexCount: number;
    edgeCount: number;
    faceCount: number;
  },
) {
  return {
    parameters,
    supported: true,
    targetId: 'tutorial.mesh',
    resultMeshId: 'tutorial.mesh.result',
    parametersValid: true,
    replayParametersValid: true,
    assigned: true,
    receiptMatches: true,
    contentIntact: true,
    sourceContentIntact: true,
    withinLimits: true,
    resultNameMatches: true,
    ...counts,
    sourceMeshContentSha256: digest,
    resultMeshContentSha256: digest,
    receiptContentSha256: digest,
    actionArgumentsSha256: digest,
    topologyMatches: true,
    attestationContentSha256: digest,
  };
}

const editCases = [
  {
    actionName: 'blender.mesh.edit_subdivide',
    observationKind: 'mesh_topology_matches',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Subdivided',
      cuts: 2,
      smooth: 0.25,
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 26,
      edgeCount: 36,
      faceCount: 24,
    },
    invariant: { topologyGrew: true },
  },
  {
    actionName: 'blender.mesh.edit_triangulate',
    observationKind: 'mesh_triangulated',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Triangulated',
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 8,
      edgeCount: 18,
      faceCount: 12,
    },
    invariant: {
      nonempty: true,
      allTriangles: true,
      sourceLoopCount: 24,
      expectedVertexCount: 8,
      expectedEdgeCount: 18,
      expectedFaceCount: 12,
    },
  },
  {
    actionName: 'blender.mesh.edit_extrude_region',
    observationKind: 'mesh_region_extruded',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Extruded',
      polygonIndices: [1],
      translation: [0, 0, 1],
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 12,
      edgeCount: 20,
      faceCount: 10,
    },
    invariant: {
      topologyGrew: true,
      selectedFaceCount: 1,
      selectedEdgeCount: 4,
      selectedVertexCount: 4,
      boundaryEdgeCount: 4,
      expectedVertexCount: 12,
      expectedEdgeCount: 20,
      expectedFaceCount: 10,
    },
  },
  {
    actionName: 'blender.mesh.edit_bevel_edges',
    observationKind: 'mesh_edges_beveled',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Bevelled',
      width: 0.1,
      segments: 3,
      profile: 0.5,
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 16,
      edgeCount: 24,
      faceCount: 12,
    },
    invariant: { topologyGrew: true },
  },
  {
    actionName: 'blender.mesh.edit_inset_faces',
    observationKind: 'mesh_faces_inset',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Inset',
      thickness: 0.1,
      depth: 0,
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 32,
      edgeCount: 60,
      faceCount: 30,
    },
    invariant: {
      resultNondegenerate: true,
      sourceLoopCount: 24,
      expectedVertexCount: 32,
      expectedEdgeCount: 60,
      expectedFaceCount: 30,
    },
  },
  {
    actionName: 'blender.mesh.edit_poke_faces',
    observationKind: 'mesh_faces_poked',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Poked',
      offset: 0,
    },
    counts: {
      sourceVertexCount: 8,
      sourceEdgeCount: 12,
      sourceFaceCount: 6,
      vertexCount: 14,
      edgeCount: 36,
      faceCount: 24,
    },
    invariant: {
      resultContentIntact: true,
      allTriangles: true,
      resultNondegenerate: true,
      sourceLoopCount: 24,
      expectedVertexCount: 14,
      expectedEdgeCount: 36,
      expectedFaceCount: 24,
    },
  },
] as const satisfies readonly {
  actionName: ProcedureLeafReplayActionName;
  observationKind: string;
  parameters: Record<string, unknown>;
  counts: {
    sourceVertexCount: number;
    sourceEdgeCount: number;
    sourceFaceCount: number;
    vertexCount: number;
    edgeCount: number;
    faceCount: number;
  };
  invariant: Record<string, unknown>;
}[];

describe('expanded managed replay observation validation', () => {
  it.each(editCases)('accepts $actionName with its exact replacement-mesh proof', (fixture) => {
    const details = {
      ...replacementDetails(fixture.parameters, fixture.counts),
      ...fixture.invariant,
    };
    expect(
      validateObservation({
        actionName: fixture.actionName,
        observationKind: fixture.observationKind,
        parameters: fixture.parameters,
        details,
      }),
    ).toEqual({ kind: fixture.observationKind, satisfied: true, details });
  });

  it('rejects a claimed growth proof when one topology dimension did not grow', () => {
    const fixture = editCases[0];
    const details = {
      ...replacementDetails(fixture.parameters, {
        ...fixture.counts,
        vertexCount: fixture.counts.sourceVertexCount,
      }),
      ...fixture.invariant,
    };
    expect(() =>
      validateObservation({
        actionName: fixture.actionName,
        observationKind: fixture.observationKind,
        parameters: fixture.parameters,
        details,
      }),
    ).toThrow(/exact satisfied managed/);
  });

  it('rejects inset counts that do not derive from the source loop count', () => {
    const fixture = editCases[4];
    const details = {
      ...replacementDetails(fixture.parameters, {
        ...fixture.counts,
        vertexCount: 31,
      }),
      ...fixture.invariant,
      expectedVertexCount: 31,
    };
    expect(() =>
      validateObservation({
        actionName: fixture.actionName,
        observationKind: fixture.observationKind,
        parameters: fixture.parameters,
        details,
      }),
    ).toThrow(/exact satisfied managed/);
  });

  it('rejects triangulate counts that do not derive from the source loop count', () => {
    const fixture = editCases[1];
    const details = {
      ...replacementDetails(fixture.parameters, {
        ...fixture.counts,
        edgeCount: 19,
        faceCount: 13,
      }),
      ...fixture.invariant,
      sourceLoopCount: 24,
      expectedEdgeCount: 19,
      expectedFaceCount: 13,
    };
    expect(() =>
      validateObservation({
        actionName: fixture.actionName,
        observationKind: fixture.observationKind,
        parameters: fixture.parameters,
        details,
      }),
    ).toThrow(/exact satisfied managed/);
  });

  it('rejects Extrude Region counts that do not derive from the selected-region topology', () => {
    const fixture = editCases[2];
    const details = {
      ...replacementDetails(fixture.parameters, {
        ...fixture.counts,
        edgeCount: 21,
      }),
      ...fixture.invariant,
      expectedEdgeCount: 21,
    };
    expect(() =>
      validateObservation({
        actionName: fixture.actionName,
        observationKind: fixture.observationKind,
        parameters: fixture.parameters,
        details,
      }),
    ).toThrow(/exact satisfied managed/);
  });

  it('accepts armature, skin-weight, and pose proofs and rejects correlated tampering', () => {
    const armatureParameters = {
      armatureId: 'tutorial.rig',
      objectName: 'OperatingLine.Rig',
      dataName: 'OperatingLine.RigData',
      collectionId: 'snowman.collection',
      bones: [
        {
          boneName: 'OperatingLine.Root',
          head: [0, 0, 0],
          tail: [0, 0, 1],
          parentName: null,
        },
      ],
      bindings: [{ targetId: 'tutorial.body', boneName: 'OperatingLine.Root' }],
    };
    const armatureDetails = {
      parameters: armatureParameters,
      supported: true,
      armatureId: 'tutorial.rig',
      boneNames: ['OperatingLine.Root'],
      availableBoneNames: ['OperatingLine.Root'],
      boundTargetIds: ['tutorial.body'],
      parametersValid: true,
      receiptMatches: true,
      ownershipMatches: true,
      bonesMatch: true,
      bindingsMatch: true,
      actionArgumentsSha256: digest,
      armatureContentSha256: digest,
      receiptContentSha256: digest,
      attestationContentSha256: digest,
    };
    expect(
      validateObservation({
        actionName: 'blender.rig.create_armature',
        observationKind: 'armature_ready',
        parameters: armatureParameters,
        details: armatureDetails,
      }).kind,
    ).toBe('armature_ready');

    const skinParameters = {
      targetId: 'tutorial.body',
      armatureId: 'tutorial.rig',
      modifierId: 'tutorial.body.armature',
      modifierName: 'OperatingLine.Armature',
      preserveVolume: true,
      weights: [
        {
          vertexIndex: 0,
          influences: [{ boneName: 'OperatingLine.Root', weight: 1 }],
        },
      ],
    };
    const skinDetails = {
      parameters: skinParameters,
      supported: true,
      targetId: 'tutorial.body',
      armatureId: 'tutorial.rig',
      modifierId: 'tutorial.body.armature',
      boneNames: ['OperatingLine.Root'],
      deformBoneNames: ['OperatingLine.Root'],
      vertexCount: 1,
      parametersValid: true,
      receiptMatches: true,
      ownershipMatches: true,
      assignmentMatches: true,
      modifierMatches: true,
      meshContentIntact: true,
      preserveVolumeMatches: true,
      actionArgumentsSha256: digest,
      weightsContentSha256: digest,
      modifierContentSha256: digest,
      receiptContentSha256: digest,
      attestationContentSha256: digest,
    };
    expect(
      validateObservation({
        actionName: 'blender.rig.bind_skin_weights',
        observationKind: 'skin_weights_ready',
        parameters: skinParameters,
        details: skinDetails,
      }).kind,
    ).toBe('skin_weights_ready');

    const poseParameters = {
      actionId: 'tutorial.wave',
      actionName: 'OperatingLine.Wave',
      armatureId: 'tutorial.rig',
      interpolation: 'BEZIER',
      extrapolation: 'CONSTANT',
      keyframes: [
        {
          frame: 1,
          poses: [{ boneName: 'OperatingLine.Root', rotationQuaternion: [1, 0, 0, 0] }],
        },
        {
          frame: 20,
          poses: [
            {
              boneName: 'OperatingLine.Root',
              rotationQuaternion: [0.968912421710645, 0, 0.247403959254523, 0],
            },
          ],
        },
      ],
    };
    const poseDetails = {
      parameters: poseParameters,
      supported: true,
      armatureId: 'tutorial.rig',
      actionId: 'tutorial.wave',
      parametersValid: true,
      receiptMatches: true,
      ownershipMatches: true,
      assigned: true,
      frameRange: [1, 20],
      expectedFrameRange: [1, 20],
      curveCount: 4,
      expectedCurveCount: 4,
      curvesMatch: true,
      valuesMatch: true,
      interpolationMatches: true,
      extrapolationMatches: true,
      actionContentIntact: true,
      actionArgumentsSha256: digest,
      actionContentSha256: digest,
      receiptContentSha256: digest,
      attestationContentSha256: digest,
    };
    expect(
      validateObservation({
        actionName: 'blender.animation.create_pose_keyframes',
        observationKind: 'pose_animation_ready',
        parameters: poseParameters,
        details: poseDetails,
      }).kind,
    ).toBe('pose_animation_ready');

    const axisAngleParameters = {
      ...poseParameters,
      keyframes: [
        {
          frame: 1,
          poses: [{ boneName: 'OperatingLine.Axis', rotationAxisAngle: [0, 0, 0, 1] }],
        },
        {
          frame: 20,
          poses: [{ boneName: 'OperatingLine.Axis', rotationAxisAngle: [0.6, 1, 0, 0] }],
        },
      ],
    };
    const axisAngleDetails = { ...poseDetails, parameters: axisAngleParameters };
    expect(
      validateObservation({
        actionName: 'blender.animation.create_pose_keyframes',
        observationKind: 'pose_animation_ready',
        parameters: axisAngleParameters,
        details: axisAngleDetails,
      }).kind,
    ).toBe('pose_animation_ready');

    const invalidAxisAngleParameters = structuredClone(axisAngleParameters);
    invalidAxisAngleParameters.keyframes[1]!.poses[0]!.rotationAxisAngle = [0.6, 0.5, 0, 0];
    expect(() =>
      validateObservation({
        actionName: 'blender.animation.create_pose_keyframes',
        observationKind: 'pose_animation_ready',
        parameters: invalidAxisAngleParameters,
        details: { ...axisAngleDetails, parameters: invalidAxisAngleParameters },
      }),
    ).toThrow();

    const invalidQuaternionParameters = structuredClone(poseParameters);
    invalidQuaternionParameters.keyframes[0]!.poses[0]!.rotationQuaternion = [0.5, 0, 0, 0];
    expect(() =>
      validateObservation({
        actionName: 'blender.animation.create_pose_keyframes',
        observationKind: 'pose_animation_ready',
        parameters: invalidQuaternionParameters,
        details: { ...poseDetails, parameters: invalidQuaternionParameters },
      }),
    ).toThrow();

    const mixedChannelParameters = structuredClone(poseParameters) as {
      keyframes: Array<{ poses: Array<Record<string, unknown>> }>;
    };
    delete mixedChannelParameters.keyframes[1]!.poses[0]!['rotationQuaternion'];
    mixedChannelParameters.keyframes[1]!.poses[0]!['rotationEuler'] = [0, 0.5, 0];
    expect(() =>
      validateObservation({
        actionName: 'blender.animation.create_pose_keyframes',
        observationKind: 'pose_animation_ready',
        parameters: mixedChannelParameters,
        details: { ...poseDetails, parameters: mixedChannelParameters },
      }),
    ).toThrow();

    for (const [actionName, observationKind, parameters, details] of [
      [
        'blender.rig.create_armature',
        'armature_ready',
        armatureParameters,
        { ...armatureDetails, boundTargetIds: ['tutorial.wrong'] },
      ],
      [
        'blender.rig.bind_skin_weights',
        'skin_weights_ready',
        skinParameters,
        { ...skinDetails, deformBoneNames: [] },
      ],
      [
        'blender.animation.create_pose_keyframes',
        'pose_animation_ready',
        poseParameters,
        { ...poseDetails, curveCount: 8, expectedCurveCount: 8 },
      ],
    ] as const) {
      expect(() =>
        validateObservation({ actionName, observationKind, parameters, details }),
      ).toThrow();
    }
  });

  it('accepts only the fixed no-bake light-trails replay proof', () => {
    const semanticParameters = {
      trailCount: 77,
      pointsPerTrail: 300,
      tileLength: 20,
      trailSpacing: 0.08,
      noiseScale: 1.5,
      noiseDetail: 2,
      noiseRoughness: 0.5,
      noiseSeed: 965,
      height: 1.5,
      profileSides: 4,
      profileRadius: 0.012,
      tileRepeatCount: 3,
    };
    const parameters = {
      targetId: 'tutorial.light_trails',
      modifierId: 'tutorial.light_trails.modifier',
      modifierName: 'OperatingLine.LightTrails',
      nodeGroupId: 'tutorial.light_trails.nodes',
      nodeGroupName: 'OperatingLine.LightTrailsNodes',
      ...semanticParameters,
      nodeTypes: lightTrailsNodeTypes,
    };
    const details = {
      parameters,
      supported: true,
      targetId: parameters.targetId,
      modifierId: parameters.modifierId,
      modifierName: parameters.modifierName,
      nodeGroupId: parameters.nodeGroupId,
      nodeGroupName: parameters.nodeGroupName,
      nodeTypes: lightTrailsNodeTypes,
      interfaceSignature: lightTrailsInterface,
      interfaceMatches: true,
      linkTopology: lightTrailsLinks,
      linkTopologyMatches: true,
      forbiddenNodeTypes: [],
      bakeCount: 0,
      bakeDirectory: '',
      semanticSignatureMatches: true,
      fixedSemanticsMatch: true,
      resolvedParameters: semanticParameters,
      semanticParametersMatch: true,
      evaluatedVertexCount: 554_400,
      expectedEvaluatedVertexCount: 554_400,
      evaluatedVertexCountMatches: true,
      evaluatedEdgeCount: 147_840,
      evaluatedPolygonCount: 73_920,
      evaluatedFinite: true,
    };

    expect(
      validateObservation({
        actionName: 'blender.geometry_nodes.create_light_trails',
        observationKind: 'light_trails_ready',
        parameters,
        details,
      }),
    ).toEqual({ kind: 'light_trails_ready', satisfied: true, details });

    for (const weakDetails of [
      { ...details, forbiddenNodeTypes: ['GeometryNodeBake'] },
      { ...details, bakeCount: 1 },
      { ...details, linkTopology: lightTrailsLinks.slice(0, -1) },
      { ...details, resolvedParameters: { ...semanticParameters, trailCount: 76 } },
      { ...details, evaluatedVertexCount: 554_399 },
    ]) {
      expect(() =>
        validateObservation({
          actionName: 'blender.geometry_nodes.create_light_trails',
          observationKind: 'light_trails_ready',
          parameters,
          details: weakDetails,
        }),
      ).toThrow(/exact satisfied managed light-trails/);
    }
  });

  it('projects accepted light-trails action arguments into the complete success gate', () => {
    const actionArguments = {
      targetId: 'tutorial.light_trails',
      modifierId: 'tutorial.light_trails.modifier',
      modifierName: 'OperatingLine.LightTrails',
      nodeGroupId: 'tutorial.light_trails.nodes',
      nodeGroupName: 'OperatingLine.LightTrailsNodes',
      trailCount: 77,
      pointsPerTrail: 300,
      tileLength: 20,
      trailSpacing: 0.08,
      noiseScale: 1.5,
      noiseDetail: 2,
      noiseRoughness: 0.5,
      noiseSeed: 965,
      height: 1.5,
      profileSides: 4,
      profileRadius: 0.012,
      tileRepeatCount: 3,
    };
    const expectedParameters = { ...actionArguments, nodeTypes: lightTrailsNodeTypes };
    const leaf = {
      id: 'tutorial.light_trails.leaf',
      kind: 'leaf',
      action: {
        adapterId: 'blender',
        name: 'blender.geometry_nodes.create_light_trails',
        arguments: actionArguments,
      },
      expectedObservations: [{ kind: 'light_trails_ready', parameters: expectedParameters }],
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action' },
      menuTracks: [{ availability: 'unavailable' }],
      shortcutTracks: [{ availability: 'unavailable' }],
      mcpTracks: [{ availability: 'available' }],
    };
    const materialization = {
      catalogBinding: { adapterId: 'blender', actionCatalogVersion: '1.23.0' },
      tree: { nodes: [leaf] },
      compilation: {
        plan: {
          steps: [
            {
              id: leaf.id,
              action: leaf.action,
              expectedObservations: leaf.expectedObservations,
            },
          ],
        },
      },
      coverage: [
        {
          leafId: leaf.id,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'materialized',
          recipeId: 'blender.geometry_nodes.create_light_trails.semantic',
        },
      ],
    };
    const request = {
      leafId: leaf.id,
      packet: { context: { goalProvenance: { source: { text: 'Create light trails' } } } },
    };
    const actionCatalog = blenderActionCatalogs.find(
      (candidate) => candidate.catalogVersion === '1.23.0',
    )!;

    expect(
      prepareProcedureLeafReplay(
        request as never,
        materialization as never,
        actionCatalog as never,
      ),
    ).toMatchObject({
      actionName: 'blender.geometry_nodes.create_light_trails',
      recipeId: 'blender.geometry_nodes.create_light_trails.semantic',
    });

    const weakMaterialization = structuredClone(materialization);
    const weakLeaf = weakMaterialization.tree.nodes[0]!;
    weakLeaf.expectedObservations[0]!.parameters = actionArguments as typeof expectedParameters;
    weakMaterialization.compilation.plan.steps[0]!.expectedObservations =
      weakLeaf.expectedObservations;
    expect(() =>
      prepareProcedureLeafReplay(
        request as never,
        weakMaterialization as never,
        actionCatalog as never,
      ),
    ).toThrow(/one exact light_trails_ready success gate/);
  });

  it('accepts only the exact Transform Geometry node proof exposed by geometry_nodes_ready', () => {
    const parameters = {
      targetId: 'tutorial.transform.target',
      modifierId: 'tutorial.transform.modifier',
      nodeGroupId: 'tutorial.transform.nodes',
      nodeTypes: transformGeometryNodeTypes,
    };
    const details = {
      parameters,
      supported: true,
      targetId: parameters.targetId,
      modifierId: parameters.modifierId,
      nodeGroupId: parameters.nodeGroupId,
      nodeTypes: transformGeometryNodeTypes,
    };

    expect(
      validateObservation({
        actionName: 'blender.geometry_nodes.create_transform',
        observationKind: 'geometry_nodes_ready',
        parameters,
        details,
      }),
    ).toEqual({ kind: 'geometry_nodes_ready', satisfied: true, details });

    for (const weakDetails of [
      { ...details, nodeTypes: transformGeometryNodeTypes.slice(0, -1) },
      { ...details, modifierId: 'attacker.modifier' },
      { ...details, linksMatch: true },
      { ...details, supported: false },
    ]) {
      expect(() =>
        validateObservation({
          actionName: 'blender.geometry_nodes.create_transform',
          observationKind: 'geometry_nodes_ready',
          parameters,
          details: weakDetails,
        }),
      ).toThrow(/exact satisfied managed Transform Geometry|exact satisfied geometry_nodes_ready/);
    }
  });

  it('prepares Transform Geometry only from the exact semantic recipe and ActionCatalog arguments', () => {
    const actionArguments = {
      targetId: 'tutorial.transform.target',
      modifierId: 'tutorial.transform.modifier',
      modifierName: 'OperatingLine.Transform Modifier',
      nodeGroupId: 'tutorial.transform.nodes',
      nodeGroupName: 'OperatingLine.Transform Nodes',
      translation: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1.5, 2, 2.5],
    };
    const expectedParameters = {
      targetId: actionArguments.targetId,
      modifierId: actionArguments.modifierId,
      nodeGroupId: actionArguments.nodeGroupId,
      nodeTypes: transformGeometryNodeTypes,
    };
    const leaf = {
      id: 'tutorial.transform.leaf',
      kind: 'leaf',
      action: {
        adapterId: 'blender',
        name: 'blender.geometry_nodes.create_transform',
        arguments: actionArguments,
      },
      expectedObservations: [{ kind: 'geometry_nodes_ready', parameters: expectedParameters }],
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action' },
      menuTracks: [{ availability: 'unavailable' }],
      shortcutTracks: [{ availability: 'unavailable' }],
      mcpTracks: [{ availability: 'available' }],
    };
    const materialization = {
      catalogBinding: { adapterId: 'blender', actionCatalogVersion: '1.24.0' },
      tree: { nodes: [leaf] },
      compilation: {
        plan: {
          steps: [
            {
              id: leaf.id,
              action: leaf.action,
              expectedObservations: leaf.expectedObservations,
            },
          ],
        },
      },
      coverage: [
        {
          leafId: leaf.id,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'materialized',
          recipeId: 'blender.geometry_nodes.create_transform.semantic',
        },
      ],
    };
    const request = {
      leafId: leaf.id,
      packet: { context: { goalProvenance: { source: { text: 'Create Transform Geometry' } } } },
    };
    const vector3Schema = (minimum: number, maximum: number) => ({
      type: 'array',
      items: { type: 'number', minimum, maximum },
      minItems: 3,
      maxItems: 3,
    });
    const actionCatalog = {
      adapterId: 'blender',
      catalogVersion: '1.24.0',
      actions: [
        {
          name: 'blender.geometry_nodes.create_transform',
          supportedObservationKinds: ['geometry_nodes_ready'],
          argumentsSchema: {
            type: 'object',
            required: [
              'targetId',
              'modifierId',
              'modifierName',
              'nodeGroupId',
              'nodeGroupName',
              'translation',
              'rotation',
              'scale',
            ],
            properties: {
              targetId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
              modifierId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
              modifierName: { type: 'string', pattern: '^OperatingLine\\.', maxLength: 180 },
              nodeGroupId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
              nodeGroupName: { type: 'string', pattern: '^OperatingLine\\.', maxLength: 180 },
              translation: vector3Schema(-1000, 1000),
              rotation: vector3Schema(-2 * Math.PI, 2 * Math.PI),
              scale: vector3Schema(0.0001, 1000),
            },
            additionalProperties: false,
          },
        },
      ],
      planningPhases: [
        { id: 'geometry', actionNames: ['blender.geometry_nodes.create_transform'] },
      ],
      semanticCapabilities: [
        {
          id: 'geometry_nodes.transform',
          actionNames: ['blender.geometry_nodes.create_transform'],
        },
      ],
    };

    expect(
      prepareProcedureLeafReplay(
        request as never,
        materialization as never,
        actionCatalog as never,
      ),
    ).toMatchObject({
      actionName: 'blender.geometry_nodes.create_transform',
      recipeId: 'blender.geometry_nodes.create_transform.semantic',
    });

    const wrongRecipe = structuredClone(materialization);
    wrongRecipe.coverage[0]!.recipeId = 'blender.geometry_nodes.create_transform.attacker';
    expect(() =>
      prepareProcedureLeafReplay(request as never, wrongRecipe as never, actionCatalog as never),
    ).toThrow(/exact operation-level semantic recipe/);

    const invalidArguments = structuredClone(materialization);
    invalidArguments.tree.nodes[0]!.action.arguments.scale = [0, 2, 2.5];
    invalidArguments.compilation.plan.steps[0]!.action.arguments.scale = [0, 2, 2.5];
    expect(() =>
      prepareProcedureLeafReplay(
        request as never,
        invalidArguments as never,
        actionCatalog as never,
      ),
    ).toThrow(/arguments violate the installed ActionCatalog/);
  });

  it('projects and finalizes only the exact managed Subdivision Surface contract', () => {
    const actionArguments = {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
      viewportLevel: 2,
    };
    const expectedParameters = {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierType: 'SUBSURF',
      levels: 2,
      renderLevels: 2,
      subdivisionType: 'CATMULL_CLARK',
      quality: 3,
      showOnlyControlEdges: true,
      useCreases: true,
      useLimitSurface: true,
      boundarySmooth: 'ALL',
      uvSmooth: 'PRESERVE_BOUNDARIES',
      useCustomNormals: false,
      showViewport: true,
      showRender: true,
      showInEditMode: true,
      showOnCage: false,
    };
    const leaf = {
      id: 'tutorial.subdivision_surface.leaf',
      kind: 'leaf',
      action: {
        adapterId: 'blender',
        name: 'blender.modifier.add_subdivision_surface',
        arguments: actionArguments,
      },
      expectedObservations: [{ kind: 'modifier_ready', parameters: expectedParameters }],
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action' },
      menuTracks: [{ availability: 'unavailable' }],
      shortcutTracks: [{ availability: 'available' }],
      mcpTracks: [{ availability: 'available' }],
    };
    const materialization = {
      catalogBinding: { adapterId: 'blender', actionCatalogVersion: '1.23.0' },
      tree: { nodes: [leaf] },
      compilation: {
        plan: {
          steps: [
            {
              id: leaf.id,
              action: leaf.action,
              expectedObservations: leaf.expectedObservations,
            },
          ],
        },
      },
      coverage: [
        {
          leafId: leaf.id,
          menu: 'unavailable',
          shortcut: 'materialized',
          mcp: 'materialized',
          recipeId: 'blender.modifier.add_subdivision_surface.semantic',
        },
      ],
    };
    const request = {
      leafId: leaf.id,
      packet: {
        context: { goalProvenance: { source: { text: 'Add Subdivision Surface' } } },
      },
    };
    const actionCatalog = {
      adapterId: 'blender',
      catalogVersion: '1.23.0',
      actions: [
        {
          name: 'blender.modifier.add_subdivision_surface',
          supportedObservationKinds: ['modifier_ready'],
          argumentsSchema: {
            type: 'object',
            required: ['targetId', 'modifierId', 'modifierName', 'viewportLevel'],
            properties: {
              targetId: {
                type: 'string',
                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
              },
              modifierId: {
                type: 'string',
                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
              },
              modifierName: {
                type: 'string',
                pattern: '^OperatingLine\\.',
                maxLength: 180,
              },
              viewportLevel: {
                type: 'integer',
                minimum: 1,
                maximum: 3,
              },
            },
            additionalProperties: false,
          },
        },
      ],
      planningPhases: [
        {
          id: 'modifiers',
          actionNames: ['blender.modifier.add_subdivision_surface'],
        },
      ],
      semanticCapabilities: [
        {
          id: 'modifier.subdivision_surface',
          actionNames: ['blender.modifier.add_subdivision_surface'],
        },
      ],
    };

    expect(
      prepareProcedureLeafReplay(
        request as never,
        materialization as never,
        actionCatalog as never,
      ),
    ).toMatchObject({
      actionName: 'blender.modifier.add_subdivision_surface',
      recipeId: 'blender.modifier.add_subdivision_surface.semantic',
    });

    const details = {
      parameters: expectedParameters,
      supported: true,
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierType: 'SUBSURF',
      propertiesMatch: true,
      sourceContentIntact: true,
      evaluatedVertexCount: 98,
      evaluatedEdgeCount: 192,
      evaluatedFaceCount: 96,
      evaluatedFinite: true,
      evaluatedWithinLimits: true,
    };
    expect(
      validateObservation({
        actionName: 'blender.modifier.add_subdivision_surface',
        observationKind: 'modifier_ready',
        parameters: expectedParameters,
        details,
      }).kind,
    ).toBe('modifier_ready');

    const wrongProposal = structuredClone(materialization);
    wrongProposal.tree.nodes[0]!.expectedObservations[0]!.parameters = {
      ...expectedParameters,
      levels: 3,
    };
    wrongProposal.compilation.plan.steps[0]!.expectedObservations =
      wrongProposal.tree.nodes[0]!.expectedObservations;
    expect(() =>
      prepareProcedureLeafReplay(request as never, wrongProposal as never, actionCatalog as never),
    ).toThrow(/one exact modifier_ready success gate/);

    for (const weakDetails of [
      { ...details, propertiesMatch: false },
      { ...details, sourceContentIntact: false },
      { ...details, evaluatedVertexCount: 8193 },
      { ...details, evaluatedFinite: false },
      { ...details, evaluatedWithinLimits: false },
      { ...details, renderLevels: 2 },
      { ...details, modifierType: 'SOLIDIFY' },
      Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'evaluatedFaceCount')),
    ]) {
      expect(() =>
        validateObservation({
          actionName: 'blender.modifier.add_subdivision_surface',
          observationKind: 'modifier_ready',
          parameters: expectedParameters,
          details: weakDetails,
        }),
      ).toThrow(/exact satisfied managed Subdivision Surface/);
    }
  });

  it('projects and finalizes only the exact managed Single Material contract', () => {
    const actionArguments = {
      materialId: 'tutorial.material.snow',
      materialName: 'OperatingLine.Snow',
      targets: ['tutorial.head', 'tutorial.body'],
      baseColor: [0.82, 0.9, 1, 1],
      roughness: 0.35,
      metallic: 0.1,
    };
    const expectedParameters = {
      materialId: actionArguments.materialId,
      targets: actionArguments.targets,
    };
    const leaf = {
      id: 'tutorial.material.leaf',
      kind: 'leaf',
      action: {
        adapterId: 'blender',
        name: 'blender.material.create_and_assign',
        arguments: actionArguments,
      },
      expectedObservations: [{ kind: 'material_assigned', parameters: expectedParameters }],
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action' },
      menuTracks: [{ availability: 'unavailable' }],
      shortcutTracks: [{ availability: 'unavailable' }],
      mcpTracks: [{ availability: 'available' }],
    };
    const actionCatalog = blenderActionCatalogs.find(
      (candidate) => candidate.catalogVersion === '1.27.0',
    )!;
    const materialization = {
      catalogBinding: {
        adapterId: 'blender',
        actionCatalogVersion: actionCatalog.catalogVersion,
      },
      tree: { nodes: [leaf] },
      compilation: {
        plan: {
          steps: [
            {
              id: leaf.id,
              action: leaf.action,
              expectedObservations: leaf.expectedObservations,
            },
          ],
        },
      },
      coverage: [
        {
          leafId: leaf.id,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'materialized',
          recipeId: 'blender.material.create_and_assign.semantic',
        },
      ],
    };
    const request = {
      leafId: leaf.id,
      packet: {
        context: { goalProvenance: { source: { text: 'Create one snow material' } } },
      },
    };

    expect(
      prepareProcedureLeafReplay(
        request as never,
        materialization as never,
        actionCatalog as never,
      ),
    ).toMatchObject({
      actionName: 'blender.material.create_and_assign',
      recipeId: 'blender.material.create_and_assign.semantic',
      planning: {
        requiredPhaseIds: ['materials'],
        capabilityCoverage: {
          requirements: [
            {
              coverage: [
                {
                  capabilityId: 'appearance.principled_palette',
                  stepIds: [leaf.id],
                },
              ],
            },
          ],
        },
      },
    });

    const details = {
      parameters: expectedParameters,
      supported: true,
      materialId: actionArguments.materialId,
      materialName: actionArguments.materialName,
      targetIds: actionArguments.targets,
      assignedTargetIds: actionArguments.targets,
      useNodes: true,
      principledNodeCount: 1,
      outputNodeCount: 1,
      baseColor: actionArguments.baseColor,
      roughness: actionArguments.roughness,
      metallic: actionArguments.metallic,
      receiptMatches: true,
      ownershipMatches: true,
      materialSurfaceMatches: true,
      assignmentsMatch: true,
      sourceContentIntact: true,
    };
    expect(
      validateObservation({
        actionName: 'blender.material.create_and_assign',
        observationKind: 'material_assigned',
        parameters: expectedParameters,
        actionArguments,
        details,
      }),
    ).toEqual({ kind: 'material_assigned', satisfied: true, details });

    const wrongProposal = structuredClone(materialization);
    wrongProposal.tree.nodes[0]!.expectedObservations[0]!.parameters = {
      materialId: actionArguments.materialId,
      targets: [...actionArguments.targets].reverse(),
    };
    wrongProposal.compilation.plan.steps[0]!.expectedObservations =
      wrongProposal.tree.nodes[0]!.expectedObservations;
    expect(() =>
      prepareProcedureLeafReplay(request as never, wrongProposal as never, actionCatalog as never),
    ).toThrow(/one exact material_assigned success gate/);

    for (const weakDetails of [
      { ...details, materialName: 'OperatingLine.Attacker' },
      { ...details, targetIds: [...actionArguments.targets].reverse() },
      { ...details, assignedTargetIds: [...actionArguments.targets].reverse() },
      { ...details, baseColor: [0.81, 0.9, 1, 1] },
      { ...details, roughness: 0.36 },
      { ...details, metallic: 0.11 },
      { ...details, principledNodeCount: 2 },
      { ...details, assignmentsMatch: false },
      Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'receiptMatches')),
    ]) {
      expect(() =>
        validateObservation({
          actionName: 'blender.material.create_and_assign',
          observationKind: 'material_assigned',
          parameters: expectedParameters,
          actionArguments,
          details: weakDetails,
        }),
      ).toThrow(/exact satisfied managed Single Material/);
    }
  });

  it('projects and validates the exact ordered multi-observation Material Palette contract', () => {
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
    const expectedObservations = materials.map((material) => ({
      kind: 'material_assigned',
      parameters: {
        materialId: material.materialId,
        targets: [material.targets[0]!],
      },
    }));
    const leaf = {
      id: 'tutorial.material-palette.leaf',
      kind: 'leaf',
      action: {
        adapterId: 'blender',
        name: 'blender.material.create_palette_and_assign',
        arguments: { materials },
      },
      expectedObservations,
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action' },
      menuTracks: [{ availability: 'unavailable' }],
      shortcutTracks: [{ availability: 'unavailable' }],
      mcpTracks: [{ availability: 'available' }],
    };
    const actionCatalog = blenderActionCatalogs.find(
      (candidate) => candidate.catalogVersion === '1.27.0',
    )!;
    const materialization = {
      catalogBinding: {
        adapterId: 'blender',
        actionCatalogVersion: actionCatalog.catalogVersion,
      },
      tree: { nodes: [leaf] },
      compilation: {
        plan: {
          steps: [
            {
              id: leaf.id,
              action: leaf.action,
              expectedObservations: leaf.expectedObservations,
            },
          ],
        },
      },
      coverage: [
        {
          leafId: leaf.id,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'materialized',
          recipeId: 'blender.material.create_palette_and_assign.semantic',
        },
      ],
    };
    const request = {
      leafId: leaf.id,
      packet: {
        context: { goalProvenance: { source: { text: 'Create an ordered material palette' } } },
      },
    };

    expect(
      prepareProcedureLeafReplay(
        request as never,
        materialization as never,
        actionCatalog as never,
      ),
    ).toMatchObject({
      actionName: 'blender.material.create_palette_and_assign',
      recipeId: 'blender.material.create_palette_and_assign.semantic',
      planning: {
        requiredPhaseIds: ['materials'],
        capabilityCoverage: {
          requirements: [
            {
              coverage: [
                {
                  capabilityId: 'appearance.principled_palette',
                  stepIds: [leaf.id],
                },
              ],
            },
          ],
        },
      },
    });

    const details = materials.map((material, index) => ({
      parameters: expectedObservations[index]!.parameters,
      supported: true,
      materialId: material.materialId,
      materialName: material.materialName,
      targetIds: expectedObservations[index]!.parameters.targets,
      assignedTargetIds: expectedObservations[index]!.parameters.targets,
      useNodes: true,
      principledNodeCount: 1,
      outputNodeCount: 1,
      baseColor: material.baseColor,
      roughness: material.roughness,
      metallic: material.metallic,
      receiptMatches: true,
      ownershipMatches: true,
      materialSurfaceMatches: true,
      assignmentsMatch: true,
      sourceContentIntact: true,
    }));
    const binding = {
      actionName: 'blender.material.create_palette_and_assign',
      leafId: leaf.id,
      proposal: { plan: { steps: [{ ...leaf }] } },
    } as ProcedureLeafReplayBinding;
    const report = {
      observations: details.map((detail) => ({
        kind: 'material_assigned',
        satisfied: true,
        details: detail,
      })),
    } as CompanionStateReport;
    expect(validateStrongProcedureLeafReplayObservation(binding, report)).toEqual(
      report.observations,
    );

    for (const wrongExpected of [
      expectedObservations.toReversed(),
      expectedObservations.map((observation, index) =>
        index === 1
          ? {
              ...observation,
              parameters: {
                ...observation.parameters,
                targets: [materials[0]!.targets[0]!],
              },
            }
          : observation,
      ),
    ]) {
      const wrongProposal = structuredClone(materialization);
      wrongProposal.tree.nodes[0]!.expectedObservations = wrongExpected;
      wrongProposal.compilation.plan.steps[0]!.expectedObservations = wrongExpected;
      expect(() =>
        prepareProcedureLeafReplay(
          request as never,
          wrongProposal as never,
          actionCatalog as never,
        ),
      ).toThrow(/one ordered material_assigned success gate per palette entry/);
    }

    for (const wrongReport of [
      { ...report, observations: report.observations.toReversed() },
      {
        ...report,
        observations: report.observations.map((observation, index) =>
          index === 1
            ? {
                ...observation,
                details: { ...observation.details, roughness: 0.25 },
              }
            : observation,
        ),
      },
    ]) {
      expect(() =>
        validateStrongProcedureLeafReplayObservation(binding, wrongReport as CompanionStateReport),
      ).toThrow(/exact ordered managed Material Palette/);
    }
  });
});
