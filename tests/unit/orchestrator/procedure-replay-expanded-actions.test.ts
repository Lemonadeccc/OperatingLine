import type {
  CompanionStateReport,
  ProcedureLeafReplayActionName,
  ProcedureLeafReplayBinding,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validateStrongProcedureLeafReplayObservation } from '../../../services/orchestrator/src/procedure-replay.js';

const digest = 'a'.repeat(64);

function validateObservation(input: {
  actionName: ProcedureLeafReplayActionName;
  observationKind: string;
  parameters: Record<string, unknown>;
  details: Record<string, unknown>;
}) {
  const binding = {
    actionName: input.actionName,
    leafId: 'tutorial.leaf',
    proposal: {
      plan: {
        steps: [
          {
            id: 'tutorial.leaf',
            action: { name: input.actionName },
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
  return validateStrongProcedureLeafReplayObservation(binding, report);
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
    invariant: { nonempty: true, allTriangles: true },
  },
  {
    actionName: 'blender.mesh.edit_extrude_region',
    observationKind: 'mesh_region_extruded',
    parameters: {
      targetId: 'tutorial.mesh',
      resultMeshId: 'tutorial.mesh.result',
      resultMeshName: 'OperatingLine.Extruded',
      polygonIndices: [0, 2],
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
    invariant: { topologyGrew: true },
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
          poses: [{ boneName: 'OperatingLine.Root', rotationEuler: [0, 0, 0] }],
        },
        {
          frame: 20,
          poses: [{ boneName: 'OperatingLine.Root', rotationEuler: [0, 0.5, 0] }],
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
      curveCount: 3,
      expectedCurveCount: 3,
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
        { ...poseDetails, curveCount: 6, expectedCurveCount: 6 },
      ],
    ] as const) {
      expect(() =>
        validateObservation({ actionName, observationKind, parameters, details }),
      ).toThrow();
    }
  });
});
