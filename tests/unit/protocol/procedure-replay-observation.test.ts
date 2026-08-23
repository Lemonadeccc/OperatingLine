import { describe, expect, it } from 'vitest';

import { procedureLeafReplayObservationSchema } from '@operatingline/protocol';

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
    },
  },
  {
    kind: 'mesh_region_extruded' as const,
    satisfied: true as const,
    details: {
      ...replacementDetails({
        targetId: 'tutorial.mesh',
        resultMeshId: 'tutorial.mesh.result',
        resultMeshName: 'OperatingLine.Extruded',
        polygonIndices: [0, 2],
        translation: [0, 0, 1],
      }),
      topologyGrew: true as const,
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
        { frame: 1, poses: [{ boneName: 'OperatingLine.Head', rotationEuler: [0, 0, 0] }] },
        {
          frame: 20,
          poses: [
            { boneName: 'OperatingLine.Head', rotationEuler: [0, 0.5, 0], location: [0, 0, 0] },
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
    curveCount: 6,
    expectedCurveCount: 6,
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

describe('new managed action replay observations', () => {
  it.each([
    ...editObservations().map((observation) => [observation.kind, observation] as const),
    ['armature_ready', armatureObservation()],
    ['skin_weights_ready', skinWeightsObservation()],
    ['pose_animation_ready', poseAnimationObservation()],
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
