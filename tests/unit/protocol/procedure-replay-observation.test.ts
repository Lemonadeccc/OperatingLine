import { describe, expect, it } from 'vitest';

import {
  procedureLeafReplayFailedObservationSchema,
  procedureLeafReplayObservationSchema,
} from '@operatingline/protocol';

const mirrorObservation = () => ({
  kind: 'modifier_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.mirror',
      modifierType: 'MIRROR' as const,
      axis: 'Y' as const,
    },
    supported: true as const,
    targetId: 'tutorial.cube',
    modifierId: 'tutorial.cube.mirror',
    modifierType: 'MIRROR' as const,
    propertiesMatch: true as const,
    axis: 'Y' as const,
    expectedAxis: 'Y' as const,
    mirrorFixedStateMatches: true as const,
    mirrorObjectAbsent: true as const,
    sourceContentIntact: true as const,
    evaluatedVertexCount: 16,
    evaluatedEdgeCount: 24,
    evaluatedFaceCount: 10,
    evaluatedFinite: true as const,
    evaluatedWithinLimits: true as const,
  },
});

const bevelModifierObservation = () => ({
  kind: 'modifier_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.bevel',
      modifierType: 'BEVEL' as const,
      width: 0.25,
      segments: 3,
      angleLimit: Math.PI / 3,
    },
    supported: true as const,
    targetId: 'tutorial.cube',
    modifierId: 'tutorial.cube.bevel',
    modifierType: 'BEVEL' as const,
    propertiesMatch: true as const,
    width: 0.25,
    segments: 3,
    angleLimit: Math.PI / 3,
    limitMethod: 'ANGLE' as const,
    bevelFixedStateMatches: true as const,
    sourceContentIntact: true as const,
    evaluatedVertexCount: 48,
    evaluatedEdgeCount: 72,
    evaluatedFaceCount: 26,
    evaluatedFinite: true as const,
    evaluatedWithinLimits: true as const,
  },
});

const singleMaterialObservation = () => ({
  kind: 'material_assigned' as const,
  satisfied: true as const,
  details: {
    parameters: {
      materialId: 'tutorial.surface',
      targets: ['tutorial.left', 'tutorial.right'],
    },
    supported: true as const,
    materialId: 'tutorial.surface',
    materialName: 'OperatingLine.TutorialSurface',
    targetIds: ['tutorial.left', 'tutorial.right'],
    assignedTargetIds: ['tutorial.left', 'tutorial.right'],
    useNodes: true as const,
    principledNodeCount: 1 as const,
    outputNodeCount: 1 as const,
    baseColor: [0.17, 0.31, 0.73, 1],
    roughness: 0.64,
    metallic: 0.28,
    receiptMatches: true as const,
    ownershipMatches: true as const,
    materialSurfaceMatches: true as const,
    assignmentsMatch: true as const,
    sourceContentIntact: true as const,
  },
});

const subdivisionSurfaceObservation = () => ({
  kind: 'modifier_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierType: 'SUBSURF' as const,
      levels: 2,
      renderLevels: 2 as const,
      subdivisionType: 'CATMULL_CLARK' as const,
      quality: 3 as const,
      showOnlyControlEdges: true as const,
      useCreases: true as const,
      useLimitSurface: true as const,
      boundarySmooth: 'ALL' as const,
      uvSmooth: 'PRESERVE_BOUNDARIES' as const,
      useCustomNormals: false as const,
      showViewport: true as const,
      showRender: true as const,
      showInEditMode: true as const,
      showOnCage: false as const,
    },
    supported: true as const,
    targetId: 'tutorial.cube',
    modifierId: 'tutorial.cube.subdivision_surface',
    modifierType: 'SUBSURF' as const,
    propertiesMatch: true as const,
    sourceContentIntact: true as const,
    evaluatedVertexCount: 98,
    evaluatedEdgeCount: 192,
    evaluatedFaceCount: 96,
    evaluatedFinite: true as const,
    evaluatedWithinLimits: true as const,
  },
});

const digest = 'a'.repeat(64);

const replacementDetails = (
  parameters: Record<string, unknown>,
  counts = {
    sourceVertexCount: 8,
    sourceEdgeCount: 12,
    sourceFaceCount: 6,
    vertexCount: 26,
    edgeCount: 36,
    faceCount: 24,
  },
) => ({
  parameters,
  supported: true as const,
  targetId: 'tutorial.mesh',
  resultMeshId: 'tutorial.mesh.result',
  parametersValid: true as const,
  replayParametersValid: true as const,
  assigned: true as const,
  receiptMatches: true as const,
  contentIntact: true as const,
  sourceContentIntact: true as const,
  withinLimits: true as const,
  resultNameMatches: true as const,
  ...counts,
  sourceMeshContentSha256: digest,
  resultMeshContentSha256: digest,
  receiptContentSha256: digest,
  actionArgumentsSha256: digest,
  topologyMatches: true as const,
  attestationContentSha256: digest,
});

const editObservations = () => [
  {
    kind: 'mesh_topology_matches' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails({
        targetId: 'tutorial.mesh',
        resultMeshId: 'tutorial.mesh.result',
        resultMeshName: 'OperatingLine.Subdivided',
        cuts: 2,
        smooth: 0.25,
      }),
      topologyGrew: true as const,
    },
  },
  {
    kind: 'mesh_triangulated' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails(
        {
          targetId: 'tutorial.mesh',
          resultMeshId: 'tutorial.mesh.result',
          resultMeshName: 'OperatingLine.Triangulated',
        },
        {
          sourceVertexCount: 8,
          sourceEdgeCount: 12,
          sourceFaceCount: 6,
          vertexCount: 8,
          edgeCount: 18,
          faceCount: 12,
        },
      ),
      nonempty: true as const,
      allTriangles: true as const,
      sourceLoopCount: 24,
      expectedVertexCount: 8,
      expectedEdgeCount: 18,
      expectedFaceCount: 12,
    },
  },
  {
    kind: 'mesh_region_extruded' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails(
        {
          targetId: 'tutorial.mesh',
          resultMeshId: 'tutorial.mesh.result',
          resultMeshName: 'OperatingLine.Extruded',
          polygonIndices: [1],
          translation: [0, 0, 1],
        },
        {
          sourceVertexCount: 8,
          sourceEdgeCount: 12,
          sourceFaceCount: 6,
          vertexCount: 12,
          edgeCount: 20,
          faceCount: 10,
        },
      ),
      topologyGrew: true as const,
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
    kind: 'mesh_edges_beveled' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails({
        targetId: 'tutorial.mesh',
        resultMeshId: 'tutorial.mesh.result',
        resultMeshName: 'OperatingLine.Bevelled',
        width: 0.1,
        segments: 3,
        profile: 0.5,
      }),
      topologyGrew: true as const,
    },
  },
  {
    kind: 'mesh_faces_inset' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails(
        {
          targetId: 'tutorial.mesh',
          resultMeshId: 'tutorial.mesh.result',
          resultMeshName: 'OperatingLine.Inset',
          thickness: 0.1,
          depth: 0,
        },
        {
          sourceVertexCount: 8,
          sourceEdgeCount: 12,
          sourceFaceCount: 6,
          vertexCount: 32,
          edgeCount: 60,
          faceCount: 30,
        },
      ),
      resultNondegenerate: true as const,
      sourceLoopCount: 24,
      expectedVertexCount: 32,
      expectedEdgeCount: 60,
      expectedFaceCount: 30,
    },
  },
  {
    kind: 'mesh_faces_poked' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails(
        {
          targetId: 'tutorial.mesh',
          resultMeshId: 'tutorial.mesh.result',
          resultMeshName: 'OperatingLine.Poked',
          offset: 0,
        },
        {
          sourceVertexCount: 8,
          sourceEdgeCount: 12,
          sourceFaceCount: 6,
          vertexCount: 14,
          edgeCount: 36,
          faceCount: 24,
        },
      ),
      resultContentIntact: true as const,
      allTriangles: true as const,
      resultNondegenerate: true as const,
      sourceLoopCount: 24,
      expectedVertexCount: 14,
      expectedEdgeCount: 36,
      expectedFaceCount: 24,
    },
  },
];

const armatureObservation = () => ({
  kind: 'armature_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      armatureId: 'tutorial.rig',
      objectName: 'OperatingLine.Rig',
      dataName: 'OperatingLine.RigData',
      collectionId: 'snowman.collection' as const,
      bones: [
        { boneName: 'OperatingLine.Root', head: [0, 0, 0], tail: [0, 0, 1], parentName: null },
        {
          boneName: 'OperatingLine.Head',
          head: [0, 0, 1],
          tail: [0, 0, 2],
          parentName: 'OperatingLine.Root',
        },
      ],
      bindings: [
        { targetId: 'tutorial.body', boneName: 'OperatingLine.Root' },
        { targetId: 'tutorial.head', boneName: 'OperatingLine.Head' },
      ],
    },
    supported: true as const,
    armatureId: 'tutorial.rig',
    boneNames: ['OperatingLine.Root', 'OperatingLine.Head'],
    availableBoneNames: ['OperatingLine.Root', 'OperatingLine.Head'],
    boundTargetIds: ['tutorial.body', 'tutorial.head'],
    parametersValid: true as const,
    receiptMatches: true as const,
    ownershipMatches: true as const,
    bonesMatch: true as const,
    bindingsMatch: true as const,
    actionArgumentsSha256: digest,
    armatureContentSha256: digest,
    receiptContentSha256: digest,
    attestationContentSha256: digest,
  },
});

const skinWeightsObservation = () => ({
  kind: 'skin_weights_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      targetId: 'tutorial.body',
      armatureId: 'tutorial.rig',
      modifierId: 'tutorial.body.armature',
      modifierName: 'OperatingLine.Armature',
      preserveVolume: true,
      weights: [
        { vertexIndex: 0, influences: [{ boneName: 'OperatingLine.Root', weight: 1 }] },
        { vertexIndex: 1, influences: [{ boneName: 'OperatingLine.Head', weight: 1 }] },
      ],
    },
    supported: true as const,
    targetId: 'tutorial.body',
    armatureId: 'tutorial.rig',
    modifierId: 'tutorial.body.armature',
    boneNames: ['OperatingLine.Root', 'OperatingLine.Head'],
    deformBoneNames: ['OperatingLine.Root', 'OperatingLine.Head'],
    vertexCount: 2,
    parametersValid: true as const,
    receiptMatches: true as const,
    ownershipMatches: true as const,
    assignmentMatches: true as const,
    modifierMatches: true as const,
    meshContentIntact: true as const,
    preserveVolumeMatches: true as const,
    actionArgumentsSha256: digest,
    weightsContentSha256: digest,
    modifierContentSha256: digest,
    receiptContentSha256: digest,
    attestationContentSha256: digest,
  },
});

const poseAnimationObservation = () => ({
  kind: 'pose_animation_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      actionId: 'tutorial.wave',
      actionName: 'OperatingLine.Wave',
      armatureId: 'tutorial.rig',
      keyframes: [
        {
          frame: 1,
          poses: [
            { boneName: 'OperatingLine.Root', rotationEuler: [0, 0, 0] },
            { boneName: 'OperatingLine.Head', rotationQuaternion: [1, 0, 0, 0] },
            { boneName: 'OperatingLine.Axis', rotationAxisAngle: [0, 0, 0, 1] },
          ],
        },
        {
          frame: 20,
          poses: [
            { boneName: 'OperatingLine.Root', rotationEuler: [0, 0.25, 0] },
            {
              boneName: 'OperatingLine.Head',
              rotationQuaternion: [0.968912421710645, 0, 0.247403959254523, 0],
              location: [0, 0, 0],
            },
            { boneName: 'OperatingLine.Axis', rotationAxisAngle: [0.6, 1, 0, 0] },
          ],
        },
      ],
      interpolation: 'LINEAR' as const,
      extrapolation: 'CONSTANT' as const,
    },
    supported: true as const,
    armatureId: 'tutorial.rig',
    actionId: 'tutorial.wave',
    parametersValid: true as const,
    receiptMatches: true as const,
    ownershipMatches: true as const,
    assigned: true as const,
    frameRange: [1, 20],
    expectedFrameRange: [1, 20],
    curveCount: 14,
    expectedCurveCount: 14,
    curvesMatch: true as const,
    valuesMatch: true as const,
    interpolationMatches: true as const,
    extrapolationMatches: true as const,
    actionContentIntact: true as const,
    actionArgumentsSha256: digest,
    actionContentSha256: digest,
    receiptContentSha256: digest,
    attestationContentSha256: digest,
  },
});

const lightTrailsNodeTypes = [
  'GeometryNodeCurvePrimitiveLine',
  'GeometryNodeCurvePrimitiveCircle',
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
] as const;
const lightTrailsInterfaceSignature = [
  ['INPUT', 'NodeSocketGeometry', 'Geometry'],
  ['OUTPUT', 'NodeSocketGeometry', 'Geometry'],
] as const;
const lightTrailsLinkTopology = [
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
] as const;

const lightTrailsSemanticParameters = () => ({
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
});

const lightTrailsParameters = () => ({
  targetId: 'tutorial.light_trails',
  modifierId: 'tutorial.light_trails.modifier',
  modifierName: 'OperatingLine.LightTrails',
  nodeGroupId: 'tutorial.light_trails.nodes',
  nodeGroupName: 'OperatingLine.LightTrailsNodes',
  ...lightTrailsSemanticParameters(),
  nodeTypes: [...lightTrailsNodeTypes],
});

const lightTrailsObservation = () => ({
  kind: 'light_trails_ready' as const,
  satisfied: true as const,
  details: {
    parameters: lightTrailsParameters(),
    supported: true as const,
    targetId: 'tutorial.light_trails',
    modifierId: 'tutorial.light_trails.modifier',
    modifierName: 'OperatingLine.LightTrails',
    nodeGroupId: 'tutorial.light_trails.nodes',
    nodeGroupName: 'OperatingLine.LightTrailsNodes',
    nodeTypes: [...lightTrailsNodeTypes],
    interfaceSignature: lightTrailsInterfaceSignature.map((item) => [...item]),
    interfaceMatches: true as const,
    linkTopology: lightTrailsLinkTopology.map((item) => [...item]),
    linkTopologyMatches: true as const,
    forbiddenNodeTypes: [],
    bakeCount: 0 as const,
    bakeDirectory: '' as const,
    semanticSignatureMatches: true as const,
    fixedSemanticsMatch: true as const,
    resolvedParameters: lightTrailsSemanticParameters(),
    semanticParametersMatch: true as const,
    evaluatedVertexCount: 554_400,
    expectedEvaluatedVertexCount: 554_400,
    evaluatedVertexCountMatches: true as const,
    evaluatedEdgeCount: 147_840,
    evaluatedPolygonCount: 73_920,
    evaluatedFinite: true as const,
  },
});

describe('managed Mirror replay observation', () => {
  it('accepts the exact strong modifier-ready contract', () => {
    expect(procedureLeafReplayObservationSchema.parse(mirrorObservation())).toEqual(
      mirrorObservation(),
    );
  });

  it.each(['missing fixed-state proof', 'axis mismatch', 'unbounded topology'] as const)(
    'rejects %s',
    (failure) => {
      const observation: Record<string, unknown> = structuredClone(mirrorObservation());
      const details = observation['details'] as Record<string, unknown>;
      if (failure === 'missing fixed-state proof') delete details['mirrorFixedStateMatches'];
      if (failure === 'axis mismatch') details['axis'] = 'X';
      if (failure === 'unbounded topology') details['evaluatedVertexCount'] = 8193;

      expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
    },
  );
});

describe('managed Bevel Modifier replay observation', () => {
  it('accepts the exact strong modifier-ready contract', () => {
    expect(procedureLeafReplayObservationSchema.parse(bevelModifierObservation())).toEqual(
      bevelModifierObservation(),
    );
  });

  it.each([
    ['parameter mismatch', 'width', 0.5],
    ['wrong fixed method', 'limitMethod', 'WEIGHT'],
    ['missing fixed-state proof', 'bevelFixedStateMatches', undefined],
    ['modified source mesh', 'sourceContentIntact', false],
    ['unbounded topology', 'evaluatedVertexCount', 8193],
  ] as const)('rejects %s', (_failure, field, value) => {
    const observation: Record<string, unknown> = structuredClone(bevelModifierObservation());
    const details = observation['details'] as Record<string, unknown>;
    if (value === undefined) delete details[field];
    else details[field] = value;

    expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
  });
});

describe('managed single-material replay observation', () => {
  it('accepts the exact strong material and ordered assignment contract', () => {
    expect(procedureLeafReplayObservationSchema.parse(singleMaterialObservation())).toEqual(
      singleMaterialObservation(),
    );
  });

  it.each([
    ['wrong material identity', 'materialId', 'tutorial.forged'],
    ['wrong material name', 'materialName', 'TutorialSurface'],
    ['reordered assignments', 'assignedTargetIds', ['tutorial.right', 'tutorial.left']],
    ['missing node surface', 'principledNodeCount', 0],
    ['forged receipt', 'receiptMatches', false],
    ['modified surface', 'materialSurfaceMatches', false],
    ['modified source mesh', 'sourceContentIntact', false],
  ] as const)('rejects %s', (_failure, field, value) => {
    const observation: Record<string, unknown> = structuredClone(singleMaterialObservation());
    const details = observation['details'] as Record<string, unknown>;
    details[field] = value;

    expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
  });
});

describe('managed Subdivision Surface replay observation', () => {
  it('accepts the exact fixed modifier-ready contract', () => {
    expect(procedureLeafReplayObservationSchema.parse(subdivisionSurfaceObservation())).toEqual(
      subdivisionSurfaceObservation(),
    );
  });

  it.each([
    ['wrong modifier type', 'modifierType', 'SOLIDIFY'],
    ['wrong render level', 'renderLevels', 1],
    ['wrong subdivision type', 'subdivisionType', 'SIMPLE'],
    ['wrong fixed flag', 'useLimitSurface', false],
  ] as const)('rejects %s', (_failure, field, value) => {
    const observation: Record<string, unknown> = structuredClone(subdivisionSurfaceObservation());
    const details = observation['details'] as Record<string, unknown>;
    const parameters = details['parameters'] as Record<string, unknown>;
    parameters[field] = value;

    expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
  });

  it.each([
    ['modified source mesh', 'sourceContentIntact', false],
    ['topology limit violation', 'evaluatedVertexCount', 8193],
    ['non-finite evaluated data', 'evaluatedFinite', false],
    ['forged topology proof', 'evaluatedWithinLimits', false],
  ] as const)('rejects %s', (_failure, field, value) => {
    const observation: Record<string, unknown> = structuredClone(subdivisionSurfaceObservation());
    const details = observation['details'] as Record<string, unknown>;
    details[field] = value;

    expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('rejects a missing evaluated detail', () => {
    const observation: Record<string, unknown> = structuredClone(subdivisionSurfaceObservation());
    const details = observation['details'] as Record<string, unknown>;
    delete details['evaluatedFaceCount'];

    expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
  });
});

describe('new managed action replay observations', () => {
  it.each([
    ...editObservations().map((observation) => [observation.kind, observation] as const),
    ['armature_ready', armatureObservation()],
    ['skin_weights_ready', skinWeightsObservation()],
    ['pose_animation_ready', poseAnimationObservation()],
    ['light_trails_ready', lightTrailsObservation()],
  ])('accepts the exact strong %s contract', (_kind, observation) => {
    expect(procedureLeafReplayObservationSchema.parse(observation)).toEqual(observation);
  });

  it.each([
    [
      'missing proof',
      () => {
        const value = editObservations()[0]!;
        delete (value.details as Record<string, unknown>)['receiptMatches'];
        return value;
      },
    ],
    [
      'false invariant',
      () => {
        const value = editObservations()[1]!;
        (value.details as Record<string, unknown>)['allTriangles'] = false;
        return value;
      },
    ],
    [
      'wrong triangulate loop proof',
      () => {
        const value = editObservations()[1]!;
        (value.details as Record<string, unknown>)['sourceLoopCount'] = 25;
        return value;
      },
    ],
    [
      'extra detail',
      () => {
        const value = editObservations()[2]!;
        (value.details as Record<string, unknown>)['legacyProof'] = true;
        return value;
      },
    ],
    [
      'wrong result id',
      () => {
        const value = editObservations()[3]!;
        (value.details as Record<string, unknown>)['resultMeshId'] = 'tutorial.wrong';
        return value;
      },
    ],
    [
      'uppercase hash',
      () => {
        const value = armatureObservation();
        value.details.actionArgumentsSha256 = 'A'.repeat(64);
        return value;
      },
    ],
    [
      'wrong correlated count',
      () => {
        const value = skinWeightsObservation();
        value.details.vertexCount = 3;
        return value;
      },
    ],
    [
      'wrong frame range',
      () => {
        const value = poseAnimationObservation();
        value.details.expectedFrameRange = [1, 21];
        return value;
      },
    ],
    [
      'missing normalized interpolation',
      () => {
        const value = poseAnimationObservation();
        delete (value.details.parameters as Partial<typeof value.details.parameters>).interpolation;
        return value;
      },
    ],
    [
      'non-unit pose quaternion',
      () => {
        const value = structuredClone(poseAnimationObservation()) as {
          details: {
            parameters: {
              keyframes: Array<{ poses: Array<Record<string, unknown>> }>;
            };
          };
        };
        value.details.parameters.keyframes[0]!.poses[1]!['rotationQuaternion'] = [0.5, 0, 0, 0];
        return value;
      },
    ],
    [
      'non-unit pose axis',
      () => {
        const value = structuredClone(poseAnimationObservation()) as {
          details: {
            parameters: {
              keyframes: Array<{ poses: Array<Record<string, unknown>> }>;
            };
          };
        };
        value.details.parameters.keyframes[1]!.poses[2]!['rotationAxisAngle'] = [0.6, 0.5, 0, 0];
        return value;
      },
    ],
    [
      'mixed pose rotation channel',
      () => {
        const value = structuredClone(poseAnimationObservation()) as {
          details: {
            parameters: {
              keyframes: Array<{ poses: Array<Record<string, unknown>> }>;
            };
          };
        };
        const pose = value.details.parameters.keyframes[1]!.poses[1]!;
        delete pose['rotationQuaternion'];
        pose['rotationEuler'] = [0, 0.5, 0];
        return value;
      },
    ],
    [
      'wrong inset topology',
      () => {
        const value = editObservations()[4]!;
        value.details.vertexCount = 31;
        return value;
      },
    ],
    [
      'wrong poke topology',
      () => {
        const value = editObservations()[5]!;
        value.details.expectedFaceCount = 23;
        return value;
      },
    ],
    [
      'light trails with a bake entry',
      () => {
        const value = lightTrailsObservation();
        value.details.bakeCount = 1 as 0;
        return value;
      },
    ],
    [
      'light trails with a forbidden node',
      () => {
        const value = lightTrailsObservation();
        value.details.forbiddenNodeTypes.push('GeometryNodeBake' as never);
        return value;
      },
    ],
    [
      'light trails with an empty evaluated mesh',
      () => {
        const value = lightTrailsObservation();
        value.details.evaluatedVertexCount = 0;
        return value;
      },
    ],
    [
      'light trails with mismatched node types',
      () => {
        const value = lightTrailsObservation();
        value.details.nodeTypes.pop();
        return value;
      },
    ],
    [
      'light trails with Provider-defined non-canonical node types',
      () => {
        const value = lightTrailsObservation();
        value.details.parameters.nodeTypes[0] = 'GeometryNodeSetCurveRadius';
        value.details.nodeTypes[0] = 'GeometryNodeSetCurveRadius';
        return value;
      },
    ],
    [
      'light trails with non-canonical interface topology',
      () => {
        const value = lightTrailsObservation();
        value.details.interfaceSignature.reverse();
        return value;
      },
    ],
    [
      'light trails with a missing canonical link',
      () => {
        const value = lightTrailsObservation();
        value.details.linkTopology.pop();
        return value;
      },
    ],
    [
      'light trails with a hidden Bake node in both claimed node lists',
      () => {
        const value = lightTrailsObservation();
        value.details.parameters.nodeTypes[0] = 'GeometryNodeBake';
        value.details.nodeTypes[0] = 'GeometryNodeBake';
        return value;
      },
    ],
    [
      'light trails with mismatched resolved parameters',
      () => {
        const value = lightTrailsObservation();
        value.details.resolvedParameters.trailSpacing += 0.01;
        return value;
      },
    ],
    [
      'light trails without the full accepted action arguments',
      () => {
        const value = lightTrailsObservation();
        delete (value.details.parameters as Partial<typeof value.details.parameters>).noiseSeed;
        return value;
      },
    ],
    [
      'light trails with unbounded evaluated topology',
      () => {
        const value = lightTrailsObservation();
        value.details.evaluatedEdgeCount = 12_000_001;
        return value;
      },
    ],
    [
      'light trails with a false expected vertex formula',
      () => {
        const value = lightTrailsObservation();
        value.details.expectedEvaluatedVertexCount += 1;
        return value;
      },
    ],
  ] as const)('rejects %s', (_failure, fixture) => {
    expect(procedureLeafReplayObservationSchema.safeParse(fixture()).success).toBe(false);
  });

  it.each([
    editObservations()[0],
    armatureObservation(),
    skinWeightsObservation(),
    poseAnimationObservation(),
  ])('rejects legacy weak parameters for $kind', (observation) => {
    const weak = structuredClone(observation) as {
      details: { parameters: Record<string, unknown> };
    };
    weak.details.parameters =
      observation.kind === 'armature_ready'
        ? { armatureId: 'tutorial.rig', boneNames: ['OperatingLine.Root'], bindings: [] }
        : observation.kind === 'skin_weights_ready'
          ? {
              targetId: 'tutorial.body',
              armatureId: 'tutorial.rig',
              modifierId: 'tutorial.body.armature',
            }
          : observation.kind === 'pose_animation_ready'
            ? { armatureId: 'tutorial.rig', actionId: 'tutorial.wave', frames: [1, 20] }
            : { targetId: 'tutorial.mesh', resultMeshId: 'tutorial.mesh.result' };
    expect(procedureLeafReplayObservationSchema.safeParse(weak).success).toBe(false);
  });
});

describe('managed light-trails replay failure observation', () => {
  it('accepts complete evidence that explains an unsatisfied no-bake gate', () => {
    const observation = lightTrailsObservation();
    const failed = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        nodeTypes: [...observation.details.nodeTypes, 'GeometryNodeBake'],
        forbiddenNodeTypes: ['GeometryNodeBake' as const],
        bakeCount: 1,
        bakeDirectory: '//blendcache_light_trails',
        semanticSignatureMatches: false,
        fixedSemanticsMatch: false,
        resolvedParameters: null,
        semanticParametersMatch: false,
        evaluatedVertexCount: 0,
        evaluatedVertexCountMatches: false,
        evaluatedEdgeCount: 0,
        evaluatedPolygonCount: 0,
        evaluatedFinite: false,
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.parse(failed)).toEqual(failed);
  });

  it('accepts the evaluator-error failure shape emitted by the Blender session', () => {
    const failed = {
      kind: 'light_trails_ready' as const,
      satisfied: false as const,
      details: {
        parameters: lightTrailsParameters(),
        supported: true as const,
        evaluationError: 'RuntimeError',
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.parse(failed)).toEqual(failed);
  });

  it('accepts missing resources and safely bounded out-of-action-range resolved values', () => {
    const observation = lightTrailsObservation();
    const failed = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        modifierName: null,
        nodeGroupName: null,
        interfaceSignature: [],
        interfaceMatches: false,
        linkTopology: [],
        linkTopologyMatches: false,
        fixedSemanticsMatch: false,
        resolvedParameters: {
          ...observation.details.resolvedParameters,
          height: 101,
        },
        semanticParametersMatch: false,
        evaluatedVertexCount: 0,
        evaluatedVertexCountMatches: false,
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.parse(failed)).toEqual(failed);
  });

  it('rejects a semanticParametersMatch boolean inconsistent with resolved values', () => {
    const observation = lightTrailsObservation();
    const failed = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        fixedSemanticsMatch: false,
        semanticParametersMatch: false,
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.safeParse(failed).success).toBe(false);
  });

  it('rejects topology and vertex booleans inconsistent with their evidence', () => {
    const observation = lightTrailsObservation();
    const inconsistentTopology = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        interfaceSignature: [],
        fixedSemanticsMatch: false,
      },
    };
    const inconsistentVertexCount = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        fixedSemanticsMatch: false,
        evaluatedVertexCount: 0,
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.safeParse(inconsistentTopology).success).toBe(
      false,
    );
    expect(
      procedureLeafReplayFailedObservationSchema.safeParse(inconsistentVertexCount).success,
    ).toBe(false);
  });

  it('rejects forbidden-node evidence inconsistent with the observed node types', () => {
    const observation = lightTrailsObservation();
    const failed = {
      ...observation,
      satisfied: false as const,
      details: {
        ...observation.details,
        forbiddenNodeTypes: ['GeometryNodeBake' as const],
        fixedSemanticsMatch: false,
      },
    };

    expect(procedureLeafReplayFailedObservationSchema.safeParse(failed).success).toBe(false);
  });

  it('uses Python-compatible relative and absolute tolerance for resolved parameters', () => {
    const observation = lightTrailsObservation();
    observation.details.resolvedParameters.tileLength += 0.000015;

    expect(procedureLeafReplayObservationSchema.parse(observation)).toEqual(observation);
  });

  it('rejects weak or success-shaped light-trails failure evidence', () => {
    expect(
      procedureLeafReplayFailedObservationSchema.safeParse({
        kind: 'light_trails_ready',
        satisfied: false,
        details: { supported: true },
      }).success,
    ).toBe(false);
    expect(
      procedureLeafReplayFailedObservationSchema.safeParse({
        ...lightTrailsObservation(),
        satisfied: false,
      }).success,
    ).toBe(false);
    const nonCanonical = lightTrailsObservation();
    nonCanonical.details.parameters.nodeTypes[0] = 'GeometryNodeBake';
    expect(
      procedureLeafReplayFailedObservationSchema.safeParse({
        ...nonCanonical,
        satisfied: false,
        details: {
          ...nonCanonical.details,
          fixedSemanticsMatch: false,
        },
      }).success,
    ).toBe(false);
  });
});
