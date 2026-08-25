import {
  armatureLeafOperationIds,
  companionLeafOperationArmatureRnaBindingMutationsSchema,
  companionLeafOperationArmatureRnaBoneMutationsSchema,
  companionLeafOperationArmatureRnaResourceMutationsSchema,
  companionLeafOperationSkinRnaModifierMutationsSchema,
  companionLeafOperationSkinRnaWeightMutationsSchema,
  companionLeafOperationSolidifyRnaMutationsSchema,
  companionLeafOperationBevelModifierRnaMutationsSchema,
  companionLeafOperationMaterialPaletteRnaMutationsSchema,
  companionLeafOperationMaterialRnaMutationsSchema,
  companionLeafOperationMirrorRnaMutationsSchema,
  companionLeafOperationSubdivisionSurfaceRnaMutationsSchema,
  companionLeafOperationEditBevelMeshOperationsSchema,
  companionLeafOperationEditInsetMeshOperationsSchema,
  companionLeafOperationEditTriangulateMeshOperationsSchema,
  companionLeafOperationEditExtrudeRegionMeshOperationsSchema,
  companionLeafOperationEditPokeMeshOperationsSchema,
  companionLeafOperationCreateRequestSchema,
  companionLeafOperationDeliverySchema,
  companionLeafOperationProgressSchema,
  companionLeafOperationPoseRnaKeyframeInsertionsSchema,
  companionLeafOperationPoseRnaAnimationPropertyWritesSchema,
  companionLeafOperationPoseRnaActionResourceMutationsSchema,
  companionLeafOperationRecoveryAckSchema,
  companionLeafOperationRecoveryChallengeSchema,
  companionLeafOperationRnaControlWritesSchema,
  companionLeafOperationRnaInitializationWritesSchema,
  companionLeafOperationRnaLinkCreationsSchema,
  companionLeafOperationRnaResourceMutationsSchema,
  companionLeafOperationRnaStructureCreationsSchema,
  companionLeafOperationResultSchema,
  companionLeafOperationStatusSchema,
  computeCompanionLeafOperationBindingSha256,
  bevelModifierLeafOperationIds,
  materialPaletteLeafOperationIds,
  singleMaterialLeafOperationIds,
  lightTrailsLeafOperationIds,
  mirrorLeafOperationIds,
  poseAnimationLeafOperationIds,
  skinWeightsLeafOperationIds,
  solidifyLeafOperationIds,
  subdivisionSurfaceLeafOperationIds,
  editBevelLeafOperationIds,
  editInsetLeafOperationIds,
  editTriangulateLeafOperationIds,
  editExtrudeRegionLeafOperationIds,
  editPokeLeafOperationIds,
  transformGeometryLeafOperationIds,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  replayId: '22222222-2222-4222-8222-222222222222',
  reportId: '33333333-3333-4333-8333-333333333333',
  instanceId: '44444444-4444-4444-8444-444444444444',
  proposalId: '55555555-5555-4555-8555-555555555555',
  executionId: '66666666-6666-4666-8666-666666666666',
  deliveryId: '77777777-7777-4777-8777-777777777777',
  runId: '88888888-8888-4888-8888-888888888888',
  receiptId: '99999999-9999-4999-8999-999999999999',
  finalReportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} as const;

const requestedAt = '2026-08-24T10:00:00.000+08:00';
const dispatchedAt = '2026-08-24T10:00:01.000+08:00';
const occurredAt = '2026-08-24T10:00:02.000+08:00';

function authority(ordinal = 1) {
  const operationParameters =
    ordinal === 5
      ? { translation: [1, 2, 3] }
      : ordinal === 6
        ? { rotation: [0.1, 0.2, 0.3] }
        : ordinal === 7
          ? { scale: [1.5, 1.25, 0.75] }
          : {};
  const base = {
    formatVersion: '1.0.0',
    requestId: ids.requestId,
    replayId: ids.replayId,
    target: { adapterId: 'blender', instanceId: ids.instanceId },
    proposalId: ids.proposalId,
    plan: { id: 'youtube.transform', revision: 2 },
    planContentSha256: '1'.repeat(64),
    executionId: ids.executionId,
    leafId: 'geometry.transform',
    stepId: 'geometry.transform',
    actionName: 'blender.geometry_nodes.create_transform',
    recipeId: 'blender.geometry_nodes.create_transform.semantic',
    catalogVersion: '1.49.0',
    interactionCatalogContentSha256: '2'.repeat(64),
    materializationContentSha256: '3'.repeat(64),
    mcpTrackContentSha256: '4'.repeat(64),
    expectedState: { reportId: ids.reportId, sequence: 7 },
    operationIds: transformGeometryLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: transformGeometryLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function transformRnaControlWrites(ordinal: number) {
  const binding =
    ordinal === 5
      ? {
          actionArgument: 'translation',
          socketIdentifier: 'Translation',
          values: [1, 2, 3],
          defaults: [0, 0, 0],
        }
      : ordinal === 6
        ? {
            actionArgument: 'rotation',
            socketIdentifier: 'Rotation',
            values: [0.1, 0.2, 0.3],
            defaults: [0, 0, 0],
          }
        : ordinal === 7
          ? {
              actionArgument: 'scale',
              socketIdentifier: 'Scale',
              values: [1.5, 1.25, 0.75],
              defaults: [1, 1, 1],
            }
          : undefined;
  if (binding === undefined) return [];
  const labels = ['X', 'Y', 'Z'] as const;
  return labels.map((componentLabel, componentIndex) => ({
    order: componentIndex + 1,
    executionMethod: 'blender_rna_property_write',
    mcpTool: 'operatingline.blender.geometry-nodes.transform.execute-next',
    sourceOperationId: transformGeometryLeafOperationIds[ordinal - 1],
    semanticAction: 'node.transform_geometry',
    actionArgument: binding.actionArgument,
    nodeGroupId: 'geometry.transform.group',
    nodeGroupName: 'OperatingLine.TransformGraph',
    nodeName: 'OperatingLine Transform',
    nodeType: 'GeometryNodeTransform',
    socketIdentifier: binding.socketIdentifier,
    propertyName: 'default_value',
    componentIndex,
    componentLabel,
    beforeValue: binding.defaults[componentIndex],
    acceptedValue: binding.values[componentIndex],
    observedValue: Math.fround(binding.values[componentIndex]!),
    uiPath: [
      'Geometry Nodes',
      'OperatingLine.TransformGraph',
      'OperatingLine Transform',
      binding.socketIdentifier,
      componentLabel,
    ],
  }));
}

const lightTrailsParametersByOrdinal: Readonly<
  Record<number, { readonly actionArgument: string; readonly acceptedValue: number }>
> = {
  5: { actionArgument: 'tileLength', acceptedValue: 12 },
  7: { actionArgument: 'pointsPerTrail', acceptedValue: 48 },
  9: { actionArgument: 'trailCount', acceptedValue: 12 },
  10: { actionArgument: 'trailSpacing', acceptedValue: 0.35 },
  15: { actionArgument: 'noiseScale', acceptedValue: 0.65 },
  16: { actionArgument: 'noiseDetail', acceptedValue: 3.25 },
  17: { actionArgument: 'noiseRoughness', acceptedValue: 0.7 },
  18: { actionArgument: 'noiseSeed', acceptedValue: 2.5 },
  21: { actionArgument: 'height', acceptedValue: 2.8 },
  27: { actionArgument: 'profileSides', acceptedValue: 5 },
  28: { actionArgument: 'profileRadius', acceptedValue: 0.08 },
  31: { actionArgument: 'tileRepeatCount', acceptedValue: 3 },
};

function lightTrailsOperationParameters(ordinal: number): Record<string, number> {
  const parameter = lightTrailsParametersByOrdinal[ordinal];
  return parameter === undefined ? {} : { [parameter.actionArgument]: parameter.acceptedValue };
}

function lightTrailsRnaControlWrites(ordinal: number) {
  type Specification = {
    readonly order: number;
    readonly semanticAction: string;
    readonly actionArgument: string;
    readonly nodeName: string;
    readonly nodeType: string;
    readonly socketIdentifier: string;
    readonly componentIndex: 0 | 1 | 2 | null;
    readonly componentLabel: 'X' | 'Y' | 'Z' | null;
    readonly projection: string;
    readonly beforeValue: number;
    readonly acceptedValue: number;
    readonly projectedValue: number;
  };
  const write = (specification: Specification) => ({
    order: specification.order,
    executionMethod: 'blender_rna_property_write',
    mcpTool: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
    sourceOperationId: lightTrailsLeafOperationIds[ordinal - 1],
    semanticAction: specification.semanticAction,
    actionArgument: specification.actionArgument,
    nodeGroupId: 'geometry.light-trails.group',
    nodeGroupName: 'OperatingLine.LightTrailsNodes',
    nodeName: specification.nodeName,
    nodeType: specification.nodeType,
    socketIdentifier: specification.socketIdentifier,
    propertyName: 'default_value',
    valueKind: specification.componentIndex === null ? 'scalar' : 'vector_component',
    componentIndex: specification.componentIndex,
    componentLabel: specification.componentLabel,
    projection: specification.projection,
    beforeValue: specification.beforeValue,
    acceptedValue: specification.acceptedValue,
    projectedValue: specification.projectedValue,
    observedValue: Math.fround(specification.projectedValue),
    uiPath: [
      'Geometry Nodes',
      'OperatingLine.LightTrailsNodes',
      specification.nodeName,
      specification.socketIdentifier,
      specification.componentLabel ?? 'Value',
    ],
  });

  switch (ordinal) {
    case 5:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.half_tile_line',
          actionArgument: 'tileLength',
          nodeName: 'OperatingLine Half Tile Line',
          nodeType: 'GeometryNodeCurvePrimitiveLine',
          socketIdentifier: 'Start',
          componentIndex: 0,
          componentLabel: 'X',
          projection: 'negative_half_x',
          beforeValue: -0.5,
          acceptedValue: 12,
          projectedValue: -6,
        }),
      ];
    case 7:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.trail_resolution',
          actionArgument: 'pointsPerTrail',
          nodeName: 'OperatingLine Trail Resolution',
          nodeType: 'GeometryNodeResampleCurve',
          socketIdentifier: 'Count',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: 10,
          acceptedValue: 48,
          projectedValue: 48,
        }),
      ];
    case 9:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.trail_rows',
          actionArgument: 'trailCount',
          nodeName: 'OperatingLine Trail Rows',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Count',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: 1,
          acceptedValue: 12,
          projectedValue: 12,
        }),
        write({
          order: 2,
          semanticAction: 'node.light_trails.trail_rows',
          actionArgument: 'trailCount',
          nodeName: 'OperatingLine Trail Rows',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Start Location',
          componentIndex: 1,
          componentLabel: 'Y',
          projection: 'centered_rows_y_from_count',
          beforeValue: 0,
          acceptedValue: 12,
          projectedValue: -5.5,
        }),
      ];
    case 10:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.trail_rows',
          actionArgument: 'trailSpacing',
          nodeName: 'OperatingLine Trail Rows',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Start Location',
          componentIndex: 1,
          componentLabel: 'Y',
          projection: 'centered_rows_y_from_spacing',
          beforeValue: -5.5,
          acceptedValue: 0.35,
          projectedValue: -((12 - 1) * 0.35) / 2,
        }),
        write({
          order: 2,
          semanticAction: 'node.light_trails.trail_rows',
          actionArgument: 'trailSpacing',
          nodeName: 'OperatingLine Trail Rows',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Offset',
          componentIndex: 1,
          componentLabel: 'Y',
          projection: 'identity',
          beforeValue: 1,
          acceptedValue: 0.35,
          projectedValue: 0.35,
        }),
      ];
    case 15:
    case 16:
    case 17:
    case 18: {
      const [actionArgument, socketIdentifier, beforeValue, acceptedValue] = {
        15: ['noiseScale', 'Scale', 1, 0.65],
        16: ['noiseDetail', 'Detail', 2, 3.25],
        17: ['noiseRoughness', 'Roughness', 0.5, 0.7],
        18: ['noiseSeed', 'W', 0, 2.5],
      }[ordinal]!;
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.terrain_noise',
          actionArgument: String(actionArgument),
          nodeName: 'OperatingLine Terrain Noise',
          nodeType: 'ShaderNodeTexNoise',
          socketIdentifier: String(socketIdentifier),
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: Number(beforeValue),
          acceptedValue: Number(acceptedValue),
          projectedValue: Number(acceptedValue),
        }),
      ];
    }
    case 21:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.scale_height',
          actionArgument: 'height',
          nodeName: 'OperatingLine Scale Height',
          nodeType: 'ShaderNodeMath',
          socketIdentifier: 'Value_001',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: 0,
          acceptedValue: 2.8,
          projectedValue: 2.8,
        }),
      ];
    case 27:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.trail_profile',
          actionArgument: 'profileSides',
          nodeName: 'OperatingLine Trail Profile',
          nodeType: 'GeometryNodeCurvePrimitiveCircle',
          socketIdentifier: 'Resolution',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: 3,
          acceptedValue: 5,
          projectedValue: 5,
        }),
      ];
    case 28:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.trail_profile',
          actionArgument: 'profileRadius',
          nodeName: 'OperatingLine Trail Profile',
          nodeType: 'GeometryNodeCurvePrimitiveCircle',
          socketIdentifier: 'Radius',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: Math.fround(0.1),
          acceptedValue: 0.08,
          projectedValue: 0.08,
        }),
      ];
    case 31:
      return [
        write({
          order: 1,
          semanticAction: 'node.light_trails.loop_tiles',
          actionArgument: 'tileRepeatCount',
          nodeName: 'OperatingLine Loop Tiles',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Count',
          componentIndex: null,
          componentLabel: null,
          projection: 'identity',
          beforeValue: 1,
          acceptedValue: 3,
          projectedValue: 3,
        }),
        write({
          order: 2,
          semanticAction: 'node.light_trails.loop_tiles',
          actionArgument: 'tileRepeatCount',
          nodeName: 'OperatingLine Loop Tiles',
          nodeType: 'GeometryNodeMeshLine',
          socketIdentifier: 'Start Location',
          componentIndex: 0,
          componentLabel: 'X',
          projection: 'centered_tiles_x_from_count',
          beforeValue: -0,
          acceptedValue: 3,
          projectedValue: -12,
        }),
      ];
    default:
      return [];
  }
}

function lightTrailsRnaInitializationWrites(ordinal: number) {
  const sourceOperationId = lightTrailsLeafOperationIds[ordinal - 1];
  const write = (specification: {
    order: number;
    nodeName: string;
    nodeType: string;
    targetKind: 'node_property' | 'input_socket';
    socketIdentifier: string | null;
    propertyName: 'mode' | 'noise_dimensions' | 'operation' | 'default_value';
    valueKind: 'enum' | 'scalar' | 'vector_component';
    componentIndex: number | null;
    componentLabel: string | null;
    valueSource: 'catalog_constant' | 'accepted_action_argument';
    actionArgument: 'tileLength' | null;
    assignedValue: string | number;
    uiTarget: string;
    uiComponent: string;
  }) => ({
    order: specification.order,
    executionMethod: 'blender_rna_property_write',
    mcpTool: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
    sourceOperationId,
    semanticAction: sourceOperationId,
    nodeGroupId: 'geometry.light-trails.group',
    nodeGroupName: 'OperatingLine.LightTrailsNodes',
    nodeName: specification.nodeName,
    nodeType: specification.nodeType,
    targetKind: specification.targetKind,
    socketIdentifier: specification.socketIdentifier,
    propertyName: specification.propertyName,
    valueKind: specification.valueKind,
    componentIndex: specification.componentIndex,
    componentLabel: specification.componentLabel,
    valueSource: specification.valueSource,
    actionArgument: specification.actionArgument,
    assignedValue: specification.assignedValue,
    observedValue:
      typeof specification.assignedValue === 'number'
        ? Math.fround(specification.assignedValue)
        : specification.assignedValue,
    uiPath: [
      'Geometry Nodes',
      'OperatingLine.LightTrailsNodes',
      specification.nodeName,
      specification.uiTarget,
      specification.uiComponent,
    ],
  });
  const socket = (
    order: number,
    nodeName: string,
    nodeType: string,
    socketIdentifier: string,
    assignedValue: number,
    componentIndex: number | null,
    componentLabel: string | null,
    actionArgument: 'tileLength' | null = null,
  ) =>
    write({
      order,
      nodeName,
      nodeType,
      targetKind: 'input_socket',
      socketIdentifier,
      propertyName: 'default_value',
      valueKind: componentIndex === null ? 'scalar' : 'vector_component',
      componentIndex,
      componentLabel,
      valueSource: actionArgument === null ? 'catalog_constant' : 'accepted_action_argument',
      actionArgument,
      assignedValue,
      uiTarget: socketIdentifier,
      uiComponent: componentLabel ?? 'Value',
    });
  const nodeProperty = (
    order: number,
    nodeName: string,
    nodeType: string,
    propertyName: 'mode' | 'noise_dimensions' | 'operation',
    assignedValue: string,
    uiComponent: 'Mode' | 'Dimensions' | 'Operation',
  ) =>
    write({
      order,
      nodeName,
      nodeType,
      targetKind: 'node_property',
      socketIdentifier: null,
      propertyName,
      valueKind: 'enum',
      componentIndex: null,
      componentLabel: null,
      valueSource: 'catalog_constant',
      actionArgument: null,
      assignedValue,
      uiTarget: 'Node',
      uiComponent,
    });
  if (ordinal === 4) {
    const nodeName = 'OperatingLine Half Tile Line';
    const nodeType = 'GeometryNodeCurvePrimitiveLine';
    return [
      nodeProperty(1, nodeName, nodeType, 'mode', 'POINTS', 'Mode'),
      ...([-0.5, 0, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 2,
          nodeName,
          nodeType,
          'Start',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
        ),
      ),
      ...([0, 0, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 5,
          nodeName,
          nodeType,
          'End',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
        ),
      ),
    ];
  }
  if (ordinal === 6) {
    return [
      socket(
        1,
        'OperatingLine Trail Resolution',
        'GeometryNodeResampleCurve',
        'Count',
        10,
        null,
        null,
      ),
    ];
  }
  if (ordinal === 8) {
    const nodeName = 'OperatingLine Trail Rows';
    const nodeType = 'GeometryNodeMeshLine';
    return [
      nodeProperty(1, nodeName, nodeType, 'mode', 'OFFSET', 'Mode'),
      socket(2, nodeName, nodeType, 'Count', 1, null, null),
      ...([0, 0, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 3,
          nodeName,
          nodeType,
          'Start Location',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
        ),
      ),
      ...([0, 1, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 6,
          nodeName,
          nodeType,
          'Offset',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
        ),
      ),
    ];
  }
  if (ordinal === 14) {
    const nodeName = 'OperatingLine Terrain Noise';
    const nodeType = 'ShaderNodeTexNoise';
    return [
      nodeProperty(1, nodeName, nodeType, 'noise_dimensions', '4D', 'Dimensions'),
      socket(2, nodeName, nodeType, 'Scale', 1, null, null),
      socket(3, nodeName, nodeType, 'Detail', 2, null, null),
      socket(4, nodeName, nodeType, 'Roughness', 0.5, null, null),
      socket(5, nodeName, nodeType, 'W', 0, null, null),
    ];
  }
  if (ordinal === 19 || ordinal === 20) {
    const centerNoise = ordinal === 19;
    const nodeName = centerNoise ? 'OperatingLine Center Noise' : 'OperatingLine Scale Height';
    const nodeType = 'ShaderNodeMath';
    return [
      nodeProperty(
        1,
        nodeName,
        nodeType,
        'operation',
        centerNoise ? 'SUBTRACT' : 'MULTIPLY',
        'Operation',
      ),
      socket(2, nodeName, nodeType, 'Value_001', centerNoise ? 0.5 : 0, null, null),
    ];
  }
  if (ordinal === 24) {
    return ([-1, 1, 1] as const).map((assignedValue, componentIndex) =>
      socket(
        componentIndex + 1,
        'OperatingLine Mirror Half Tile',
        'GeometryNodeTransform',
        'Scale',
        assignedValue,
        componentIndex,
        (['X', 'Y', 'Z'] as const)[componentIndex]!,
      ),
    );
  }
  if (ordinal === 26) {
    const nodeName = 'OperatingLine Trail Profile';
    const nodeType = 'GeometryNodeCurvePrimitiveCircle';
    return [
      nodeProperty(1, nodeName, nodeType, 'mode', 'RADIUS', 'Mode'),
      socket(2, nodeName, nodeType, 'Resolution', 3, null, null),
      socket(3, nodeName, nodeType, 'Radius', 0.1, null, null),
    ];
  }
  if (ordinal === 30) {
    const nodeName = 'OperatingLine Loop Tiles';
    const nodeType = 'GeometryNodeMeshLine';
    return [
      nodeProperty(1, nodeName, nodeType, 'mode', 'OFFSET', 'Mode'),
      socket(2, nodeName, nodeType, 'Count', 1, null, null),
      ...([0, 0, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 3,
          nodeName,
          nodeType,
          'Start Location',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
        ),
      ),
      ...([12, 0, 0] as const).map((assignedValue, componentIndex) =>
        socket(
          componentIndex + 6,
          nodeName,
          nodeType,
          'Offset',
          assignedValue,
          componentIndex,
          (['X', 'Y', 'Z'] as const)[componentIndex]!,
          componentIndex === 0 ? 'tileLength' : null,
        ),
      ),
    ];
  }
  return [];
}

const lightTrailsStructureTargets = [
  [3, 'OperatingLine Input', 'NodeGroupInput', 'INPUT'],
  [4, 'OperatingLine Half Tile Line', 'GeometryNodeCurvePrimitiveLine', null],
  [6, 'OperatingLine Trail Resolution', 'GeometryNodeResampleCurve', null],
  [8, 'OperatingLine Trail Rows', 'GeometryNodeMeshLine', null],
  [11, 'OperatingLine Trail Instances', 'GeometryNodeInstanceOnPoints', null],
  [12, 'OperatingLine Realize Trails', 'GeometryNodeRealizeInstances', null],
  [13, 'OperatingLine Trail Position', 'GeometryNodeInputPosition', null],
  [14, 'OperatingLine Terrain Noise', 'ShaderNodeTexNoise', null],
  [19, 'OperatingLine Center Noise', 'ShaderNodeMath', null],
  [20, 'OperatingLine Scale Height', 'ShaderNodeMath', null],
  [22, 'OperatingLine Z Offset', 'ShaderNodeCombineXYZ', null],
  [23, 'OperatingLine Displace Trails', 'GeometryNodeSetPosition', null],
  [24, 'OperatingLine Mirror Half Tile', 'GeometryNodeTransform', null],
  [25, 'OperatingLine Mirrored Tile', 'GeometryNodeJoinGeometry', null],
  [26, 'OperatingLine Trail Profile', 'GeometryNodeCurvePrimitiveCircle', null],
  [29, 'OperatingLine Curve To Mesh', 'GeometryNodeCurveToMesh', null],
  [30, 'OperatingLine Loop Tiles', 'GeometryNodeMeshLine', null],
  [32, 'OperatingLine Tile Instances', 'GeometryNodeInstanceOnPoints', null],
  [33, 'OperatingLine Realize Tiles', 'GeometryNodeRealizeInstances', null],
  [34, 'OperatingLine Output', 'NodeGroupOutput', 'OUTPUT'],
] as const;

function lightTrailsRnaStructureCreations(ordinal: number) {
  const target = lightTrailsStructureTargets.find(([targetOrdinal]) => targetOrdinal === ordinal);
  if (target === undefined) return [];
  const [, nodeName, nodeType, interfaceDirection] = target;
  const sourceOperationId = lightTrailsLeafOperationIds[ordinal - 1];
  const common = (order: number, executionMethod: string, structureKind: string) => ({
    order,
    executionMethod,
    mcpTool: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
    sourceOperationId,
    semanticAction: sourceOperationId,
    nodeGroupId: 'geometry.light-trails.group',
    nodeGroupName: 'OperatingLine.LightTrailsNodes',
    structureKind,
  });
  const nodeCreation = {
    ...common(interfaceDirection === null ? 1 : 2, 'blender_rna_node_create', 'node'),
    nodeName,
    nodeType,
    observedNode: true,
    uiPath: ['Geometry Nodes', 'OperatingLine.LightTrailsNodes', 'Nodes', nodeName],
  };
  if (interfaceDirection === null) return [nodeCreation];
  return [
    {
      ...common(1, 'blender_rna_node_group_interface_socket_create', 'interface_socket'),
      interfaceSocketName: 'Geometry',
      interfaceDirection,
      interfaceSocketType: 'NodeSocketGeometry',
      observedInterfaceSocket: true,
      uiPath: [
        'Geometry Nodes',
        'OperatingLine.LightTrailsNodes',
        'Interface',
        interfaceDirection,
        'Geometry',
      ],
    },
    nodeCreation,
  ];
}

function lightTrailsRnaResourceMutations(ordinal: number) {
  if (ordinal !== 2) return [];
  const common = {
    mcpTool: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
    sourceOperationId: 'semantic.new_geometry_modifier',
    semanticAction: 'semantic.new_geometry_modifier',
    targetId: 'eye.left',
  };
  return [
    {
      ...common,
      order: 1,
      executionMethod: 'blender_rna_node_group_create',
      mutationKind: 'node_group_create',
      nodeGroupId: 'geometry.light-trails.group',
      nodeGroupName: 'OperatingLine.LightTrailsNodes',
      nodeTreeType: 'GeometryNodeTree',
      observedResource: true,
      uiPath: ['Geometry Nodes', 'OperatingLine.LightTrailsNodes'],
    },
    {
      ...common,
      order: 2,
      executionMethod: 'blender_rna_modifier_create',
      mutationKind: 'modifier_create',
      modifierId: 'geometry.light-trails.modifier',
      modifierName: 'OperatingLine.LightTrails',
      modifierType: 'NODES',
      observedResource: true,
      uiPath: ['Properties', 'Modifiers', 'OperatingLine.LightTrails'],
    },
    {
      ...common,
      order: 3,
      executionMethod: 'blender_rna_modifier_node_group_bind',
      mutationKind: 'modifier_node_group_bind',
      modifierId: 'geometry.light-trails.modifier',
      modifierName: 'OperatingLine.LightTrails',
      nodeGroupId: 'geometry.light-trails.group',
      nodeGroupName: 'OperatingLine.LightTrailsNodes',
      observedBinding: true,
      uiPath: [
        'Properties',
        'Modifiers',
        'OperatingLine.LightTrails',
        'Node Group',
        'OperatingLine.LightTrailsNodes',
      ],
    },
  ];
}

const lightTrailsLinkTargets = [
  [
    35,
    'OperatingLine Half Tile Line',
    'GeometryNodeCurvePrimitiveLine',
    'Curve',
    'OperatingLine Trail Resolution',
    'GeometryNodeResampleCurve',
    'Curve',
  ],
  [
    36,
    'OperatingLine Trail Rows',
    'GeometryNodeMeshLine',
    'Mesh',
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Points',
  ],
  [
    37,
    'OperatingLine Trail Resolution',
    'GeometryNodeResampleCurve',
    'Curve',
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Instance',
  ],
  [
    38,
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Instances',
    'OperatingLine Realize Trails',
    'GeometryNodeRealizeInstances',
    'Geometry',
  ],
  [
    39,
    'OperatingLine Trail Position',
    'GeometryNodeInputPosition',
    'Position',
    'OperatingLine Terrain Noise',
    'ShaderNodeTexNoise',
    'Vector',
  ],
  [
    40,
    'OperatingLine Terrain Noise',
    'ShaderNodeTexNoise',
    'Fac',
    'OperatingLine Center Noise',
    'ShaderNodeMath',
    'Value',
  ],
  [
    41,
    'OperatingLine Center Noise',
    'ShaderNodeMath',
    'Value',
    'OperatingLine Scale Height',
    'ShaderNodeMath',
    'Value',
  ],
  [
    42,
    'OperatingLine Scale Height',
    'ShaderNodeMath',
    'Value',
    'OperatingLine Z Offset',
    'ShaderNodeCombineXYZ',
    'Z',
  ],
  [
    43,
    'OperatingLine Realize Trails',
    'GeometryNodeRealizeInstances',
    'Geometry',
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
  ],
  [
    44,
    'OperatingLine Z Offset',
    'ShaderNodeCombineXYZ',
    'Vector',
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Offset',
  ],
  [
    45,
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
    'OperatingLine Mirror Half Tile',
    'GeometryNodeTransform',
    'Geometry',
  ],
  [
    46,
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
  ],
  [
    47,
    'OperatingLine Mirror Half Tile',
    'GeometryNodeTransform',
    'Geometry',
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
  ],
  [
    48,
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Curve',
  ],
  [
    49,
    'OperatingLine Trail Profile',
    'GeometryNodeCurvePrimitiveCircle',
    'Curve',
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Profile Curve',
  ],
  [
    50,
    'OperatingLine Loop Tiles',
    'GeometryNodeMeshLine',
    'Mesh',
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Points',
  ],
  [
    51,
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Mesh',
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Instance',
  ],
  [
    52,
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Instances',
    'OperatingLine Realize Tiles',
    'GeometryNodeRealizeInstances',
    'Geometry',
  ],
  [
    53,
    'OperatingLine Realize Tiles',
    'GeometryNodeRealizeInstances',
    'Geometry',
    'OperatingLine Output',
    'NodeGroupOutput',
    'Geometry',
  ],
] as const;

function lightTrailsRnaLinkCreations(ordinal: number) {
  const target = lightTrailsLinkTargets.find(([targetOrdinal]) => targetOrdinal === ordinal);
  if (target === undefined) return [];
  const [
    ,
    fromNodeName,
    fromNodeType,
    fromSocketIdentifier,
    toNodeName,
    toNodeType,
    toSocketIdentifier,
  ] = target;
  const sourceOperationId = lightTrailsLeafOperationIds[ordinal - 1];
  return [
    {
      order: 1,
      executionMethod: 'blender_rna_node_link_create',
      mcpTool: 'operatingline.blender.geometry-nodes.light-trails.execute-next',
      sourceOperationId,
      semanticAction: sourceOperationId,
      nodeGroupId: 'geometry.light-trails.group',
      nodeGroupName: 'OperatingLine.LightTrailsNodes',
      fromNodeName,
      fromNodeType,
      fromSocketIdentifier,
      fromSocketDirection: 'OUTPUT',
      toNodeName,
      toNodeType,
      toSocketIdentifier,
      toSocketDirection: 'INPUT',
      observedLink: true,
      uiPath: [
        'Geometry Nodes',
        'OperatingLine.LightTrailsNodes',
        fromNodeName,
        fromSocketIdentifier,
        toNodeName,
        toSocketIdentifier,
      ],
    },
  ];
}

function delivery(ordinal = 1) {
  return {
    ...authority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function progress(ordinal = 1) {
  const final = ordinal === 11;
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'geometry.transform',
    actionName: 'blender.geometry_nodes.create_transform',
    recipeId: 'blender.geometry_nodes.create_transform.semantic',
    catalogVersion: '1.49.0',
    operationIds: transformGeometryLeafOperationIds,
    completedOperationIds: transformGeometryLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_geometry_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: transformGeometryLeafOperationIds[ordinal - 1]!,
        mutating: ordinal >= 2 && ordinal <= 10,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'geometry.transform',
        actionName: 'blender.geometry_nodes.create_transform',
        recipeId: 'blender.geometry_nodes.create_transform.semantic',
        catalogVersion: '1.49.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: ordinal >= 2 && ordinal <= 10 ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeGraph: final,
          rnaControlWrites: transformRnaControlWrites(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function lightTrailsAuthority(ordinal = 1) {
  const base = {
    ...authority(1),
    plan: { id: 'youtube.light-trails', revision: 3 },
    leafId: 'geometry.light-trails',
    stepId: 'geometry.light-trails',
    actionName: 'blender.geometry_nodes.create_light_trails',
    recipeId: 'blender.geometry_nodes.create_light_trails.semantic',
    catalogVersion: '1.55.0',
    operationIds: lightTrailsLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: lightTrailsLeafOperationIds[ordinal - 1]!,
    operationParameters: lightTrailsOperationParameters(ordinal),
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function lightTrailsDelivery(ordinal = 1) {
  return {
    ...lightTrailsAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function lightTrailsProgress(ordinal = 1) {
  const final = ordinal === lightTrailsLeafOperationIds.length;
  const mutating = ordinal > 1 && !final;
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'geometry.light-trails',
    actionName: 'blender.geometry_nodes.create_light_trails',
    recipeId: 'blender.geometry_nodes.create_light_trails.semantic',
    catalogVersion: '1.55.0',
    operationIds: lightTrailsLeafOperationIds,
    completedOperationIds: lightTrailsLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_geometry_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: lightTrailsLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'geometry.light-trails',
        actionName: 'blender.geometry_nodes.create_light_trails',
        recipeId: 'blender.geometry_nodes.create_light_trails.semantic',
        catalogVersion: '1.55.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeGraph: final,
          rnaControlWrites: lightTrailsRnaControlWrites(ordinal),
          rnaInitializationWrites: lightTrailsRnaInitializationWrites(ordinal),
          rnaLinkCreations: lightTrailsRnaLinkCreations(ordinal),
          rnaStructureCreations: lightTrailsRnaStructureCreations(ordinal),
          rnaResourceMutations: lightTrailsRnaResourceMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function poseAnimationAuthority(ordinal = 1) {
  const base = {
    ...authority(1),
    plan: { id: 'youtube.pose-animation', revision: 4 },
    leafId: 'animation.pose',
    stepId: 'animation.pose',
    actionName: 'blender.animation.create_pose_keyframes',
    recipeId: 'blender.animation.create_pose_keyframes.semantic',
    catalogVersion: '1.56.0',
    operationIds: poseAnimationLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: poseAnimationLeafOperationIds[ordinal - 1]!,
    operationParameters: ordinal === 7 ? { keyframes: poseAnimationKeyframes } : {},
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

const poseAnimationKeyframes = [
  {
    frame: 1,
    poses: [
      {
        boneName: 'OperatingLine.Root',
        rotationEuler: [0, 0, 0.25],
        location: [1, 2, 3],
      },
    ],
  },
  {
    frame: 10,
    poses: [
      {
        boneName: 'OperatingLine.Root',
        rotationEuler: [0, 0, 0.5],
        location: [3, 2, 1],
      },
    ],
  },
] as const;

function poseRnaKeyframeInsertions(ordinal: number) {
  if (ordinal !== 7) return [];
  let order = 0;
  return poseAnimationKeyframes.flatMap((keyframe, frameIndex) =>
    keyframe.poses.flatMap((pose, poseIndex) =>
      [
        { dataPath: 'rotation_euler' as const, values: pose.rotationEuler },
        { dataPath: 'location' as const, values: pose.location },
      ].map(({ dataPath, values }, channelIndex) => {
        order += 1;
        return {
          order,
          frameOrder: frameIndex + 1,
          poseOrder: poseIndex + 1,
          channelOrder: channelIndex + 1,
          executionMethod: 'blender_rna_pose_bone_keyframe_insert',
          mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
          sourceOperationId: 'projection.semantic.pose_animation.keyframes',
          semanticAction: 'projection.semantic.pose_animation.keyframes',
          actionArgument: 'keyframes',
          armatureId: 'rig.armature',
          actionId: 'animation.action',
          actionName: 'OperatingLine.Action',
          frame: keyframe.frame,
          boneName: pose.boneName,
          dataPath,
          acceptedValues: values,
          observedPoints: values.map((value, componentIndex) => ({
            componentIndex,
            acceptedValue: value,
            observedFrame: keyframe.frame,
            observedValue: Math.fround(value),
          })),
          observedInserted: true,
          uiPath: [
            'Animation',
            'OperatingLine.Action',
            pose.boneName,
            dataPath,
            `Frame ${keyframe.frame}`,
          ],
        };
      }),
    ),
  );
}

function poseRnaAnimationPropertyWrites(ordinal: number) {
  if (ordinal !== 9 && ordinal !== 11) return [];
  const curves = new Map<
    string,
    {
      boneName: string;
      dataPath: 'rotation_euler' | 'location';
      componentIndex: number;
      points: Array<{ frame: number; value: number }>;
    }
  >();
  for (const keyframe of poseAnimationKeyframes) {
    for (const pose of keyframe.poses) {
      for (const { dataPath, values } of [
        { dataPath: 'rotation_euler' as const, values: pose.rotationEuler },
        { dataPath: 'location' as const, values: pose.location },
      ]) {
        values.forEach((value, componentIndex) => {
          const key = JSON.stringify([pose.boneName, dataPath, componentIndex]);
          let curve = curves.get(key);
          if (curve === undefined) {
            curve = { boneName: pose.boneName, dataPath, componentIndex, points: [] };
            curves.set(key, curve);
          }
          curve.points.push({ frame: keyframe.frame, value });
        });
      }
    }
  }
  const writes: Array<Record<string, unknown>> = [];
  for (const curve of curves.values()) {
    if (ordinal === 9) {
      for (const point of curve.points) {
        writes.push({
          order: writes.length + 1,
          executionMethod: 'blender_rna_keyframe_interpolation_write',
          mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
          sourceOperationId: 'projection.semantic.pose_animation.interpolation',
          semanticAction: 'projection.semantic.pose_animation.interpolation',
          actionArgument: 'interpolation',
          mutationKind: 'keyframe_interpolation_write',
          armatureId: 'rig.armature',
          actionId: 'animation.action',
          actionName: 'OperatingLine.Action',
          boneName: curve.boneName,
          dataPath: curve.dataPath,
          componentIndex: curve.componentIndex,
          frame: point.frame,
          beforeValue: 'BEZIER',
          acceptedValue: 'LINEAR',
          observedValue: 'LINEAR',
          observedPointValue: Math.fround(point.value),
          uiPath: [
            'Animation',
            'OperatingLine.Action',
            curve.boneName,
            curve.dataPath,
            `Component ${curve.componentIndex}`,
            `Frame ${point.frame}`,
            'Interpolation',
          ],
        });
      }
    } else {
      writes.push({
        order: writes.length + 1,
        executionMethod: 'blender_rna_fcurve_extrapolation_write',
        mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
        sourceOperationId: 'projection.semantic.pose_animation.extrapolation',
        semanticAction: 'projection.semantic.pose_animation.extrapolation',
        actionArgument: 'extrapolation',
        mutationKind: 'fcurve_extrapolation_write',
        armatureId: 'rig.armature',
        actionId: 'animation.action',
        actionName: 'OperatingLine.Action',
        boneName: curve.boneName,
        dataPath: curve.dataPath,
        componentIndex: curve.componentIndex,
        beforeValue: 'CONSTANT',
        acceptedValue: 'LINEAR',
        observedValue: 'LINEAR',
        keyframePointCount: curve.points.length,
        uiPath: [
          'Animation',
          'OperatingLine.Action',
          curve.boneName,
          curve.dataPath,
          `Component ${curve.componentIndex}`,
          'Extrapolation',
        ],
      });
    }
  }
  return writes;
}

function poseRnaActionResourceMutations(ordinal: number) {
  const pendingActionName = 'OperatingLine.PendingPose.99999999';
  if (ordinal === 4) {
    return [
      {
        order: 1,
        executionMethod: 'blender_rna_action_create',
        mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
        sourceOperationId: 'semantic.create_pose_action',
        semanticAction: 'semantic.create_pose_action',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'action_create',
        armatureId: 'rig.armature',
        actionId: 'animation.action',
        pendingActionName,
        resourceType: 'Action',
        observedResource: true,
        uiPath: ['Animation', pendingActionName],
      },
      {
        order: 2,
        executionMethod: 'blender_rna_armature_action_bind',
        mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
        sourceOperationId: 'semantic.create_pose_action',
        semanticAction: 'semantic.create_pose_action',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'armature_action_bind',
        armatureId: 'rig.armature',
        actionId: 'animation.action',
        pendingActionName,
        observedBinding: true,
        uiPath: ['Animation', 'rig.armature', 'Action', pendingActionName],
      },
    ];
  }
  if (ordinal === 5) {
    return [
      {
        order: 1,
        executionMethod: 'blender_rna_action_name_write',
        mcpTool: 'operatingline.blender.animation.pose-keyframes.execute-next',
        sourceOperationId: 'projection.semantic.pose_animation.action_name',
        semanticAction: 'projection.semantic.pose_animation.action_name',
        actionArgument: 'actionName',
        mutationKind: 'action_name_write',
        armatureId: 'rig.armature',
        actionId: 'animation.action',
        beforeName: pendingActionName,
        acceptedName: 'OperatingLine.Action',
        observedName: 'OperatingLine.Action',
        uiPath: ['Animation', 'OperatingLine.Action', 'Name'],
      },
    ];
  }
  return [];
}

function poseAnimationDelivery(ordinal = 1) {
  return {
    ...poseAnimationAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function poseAnimationProgress(ordinal = 1) {
  const final = ordinal === poseAnimationLeafOperationIds.length;
  const mutating = [4, 5, 7, 9, 11].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'animation.pose',
    actionName: 'blender.animation.create_pose_keyframes',
    recipeId: 'blender.animation.create_pose_keyframes.semantic',
    catalogVersion: '1.56.0',
    operationIds: poseAnimationLeafOperationIds,
    completedOperationIds: poseAnimationLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_pose_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: poseAnimationLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'animation.pose',
        actionName: 'blender.animation.create_pose_keyframes',
        recipeId: 'blender.animation.create_pose_keyframes.semantic',
        catalogVersion: '1.56.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeAnimation: final,
          rnaKeyframeInsertions: poseRnaKeyframeInsertions(ordinal),
          rnaAnimationPropertyWrites: poseRnaAnimationPropertyWrites(ordinal),
          rnaActionResourceMutations: poseRnaActionResourceMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function armatureAuthority(ordinal = 1) {
  const operationParameters = (() => {
    if (ordinal === 1) return { armatureId: 'rig.armature', collectionId: 'snowman.collection' };
    if (ordinal === 3) return { objectName: 'OperatingLine.Rig' };
    if (ordinal === 4) return { dataName: 'OperatingLine.RigData' };
    if (ordinal === 6) return { bones: [{ boneName: 'OperatingLine.Root' }] };
    if (ordinal === 8) return { bindings: [{ targetId: 'rig.target' }] };
    return {};
  })();
  const base = {
    ...authority(1),
    plan: { id: 'youtube.armature', revision: 5 },
    leafId: 'rig.armature',
    stepId: 'rig.armature',
    actionName: 'blender.rig.create_armature',
    recipeId: 'blender.rig.create_armature.semantic',
    catalogVersion: '1.57.0',
    operationIds: armatureLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: armatureLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function armatureDelivery(ordinal = 1) {
  return {
    ...armatureAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function armatureRnaResourceMutations(ordinal: number) {
  const pendingObjectName = 'OperatingLine.PendingArmatureObject.99999999';
  const pendingDataName = 'OperatingLine.PendingArmatureData.99999999';
  if (ordinal === 2) {
    return [
      {
        order: 1,
        executionMethod: 'blender_rna_armature_data_create',
        mcpTool: 'operatingline.blender.rig.armature.execute-next',
        sourceOperationId: 'menu.add_armature',
        semanticAction: 'menu.add_armature',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'armature_data_create',
        armatureId: 'rig.armature',
        pendingDataName,
        resourceType: 'Armature',
        observedResource: true,
        uiPath: ['Layout', 'Add', 'Armature', 'Data', pendingDataName],
      },
      {
        order: 2,
        executionMethod: 'blender_rna_armature_object_create',
        mcpTool: 'operatingline.blender.rig.armature.execute-next',
        sourceOperationId: 'menu.add_armature',
        semanticAction: 'menu.add_armature',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'armature_object_create',
        armatureId: 'rig.armature',
        pendingObjectName,
        pendingDataName,
        resourceType: 'Object',
        objectType: 'ARMATURE',
        observedDataBinding: true,
        observedResource: true,
        uiPath: ['Layout', 'Add', 'Armature', 'Object', pendingObjectName],
      },
      {
        order: 3,
        executionMethod: 'blender_rna_collection_object_link',
        mcpTool: 'operatingline.blender.rig.armature.execute-next',
        sourceOperationId: 'menu.add_armature',
        semanticAction: 'menu.add_armature',
        valueSource: 'accepted_action_argument',
        actionArgument: 'collectionId',
        mutationKind: 'collection_object_link',
        armatureId: 'rig.armature',
        collectionId: 'snowman.collection',
        pendingObjectName,
        observedLink: true,
        uiPath: ['Outliner', 'snowman.collection', pendingObjectName],
      },
    ];
  }
  if (ordinal === 3) {
    return [
      {
        order: 1,
        executionMethod: 'blender_rna_object_name_write',
        mcpTool: 'operatingline.blender.rig.armature.execute-next',
        sourceOperationId: 'projection.semantic.armature.object_name',
        semanticAction: 'projection.semantic.armature.object_name',
        valueSource: 'accepted_action_argument',
        actionArgument: 'objectName',
        mutationKind: 'armature_object_name_write',
        armatureId: 'rig.armature',
        beforeName: pendingObjectName,
        acceptedName: 'OperatingLine.Rig',
        observedName: 'OperatingLine.Rig',
        uiPath: ['Layout', 'OperatingLine.Rig', 'Object Properties', 'Name'],
      },
    ];
  }
  if (ordinal === 4) {
    return [
      {
        order: 1,
        executionMethod: 'blender_rna_armature_data_name_write',
        mcpTool: 'operatingline.blender.rig.armature.execute-next',
        sourceOperationId: 'projection.semantic.armature.data_name',
        semanticAction: 'projection.semantic.armature.data_name',
        valueSource: 'accepted_action_argument',
        actionArgument: 'dataName',
        mutationKind: 'armature_data_name_write',
        armatureId: 'rig.armature',
        beforeName: pendingDataName,
        acceptedName: 'OperatingLine.RigData',
        observedName: 'OperatingLine.RigData',
        uiPath: ['Layout', 'OperatingLine.Rig', 'Object Data Properties', 'Name'],
      },
    ];
  }
  return [];
}

function armatureRnaBoneMutations(ordinal: number) {
  if (ordinal !== 6) return [];
  const bones = [
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
  ];
  const mutations: Array<Record<string, unknown>> = bones.map((bone, index) => ({
    order: index + 1,
    boneOrder: index + 1,
    executionMethod: 'blender_rna_edit_bone_create',
    mcpTool: 'operatingline.blender.rig.armature.execute-next',
    sourceOperationId: 'projection.semantic.armature.bones',
    semanticAction: 'projection.semantic.armature.bones',
    valueSource: 'accepted_action_argument',
    actionArgument: 'bones',
    mutationKind: 'edit_bone_create',
    armatureId: 'rig.armature',
    dataName: 'OperatingLine.RigData',
    boneName: bone.boneName,
    acceptedHead: bone.head,
    observedHead: bone.head.map(Math.fround),
    acceptedTail: bone.tail,
    observedTail: bone.tail.map(Math.fround),
    acceptedUseDeform: false,
    observedUseDeform: false,
    observedBone: true,
    uiPath: ['Layout', 'OperatingLine.Rig', 'Edit Mode', 'Bones', bone.boneName],
  }));
  mutations.push({
    order: mutations.length + 1,
    boneOrder: 2,
    executionMethod: 'blender_rna_edit_bone_parent_bind',
    mcpTool: 'operatingline.blender.rig.armature.execute-next',
    sourceOperationId: 'projection.semantic.armature.bones',
    semanticAction: 'projection.semantic.armature.bones',
    valueSource: 'accepted_action_argument',
    actionArgument: 'bones',
    mutationKind: 'edit_bone_parent_bind',
    armatureId: 'rig.armature',
    dataName: 'OperatingLine.RigData',
    boneName: 'OperatingLine.Tip',
    acceptedParentName: 'OperatingLine.Root',
    observedParentName: 'OperatingLine.Root',
    observedBinding: true,
    uiPath: [
      'Layout',
      'OperatingLine.Rig',
      'Edit Mode',
      'Bones',
      'OperatingLine.Tip',
      'Parent',
      'OperatingLine.Root',
    ],
  });
  for (const [index, bone] of bones.entries()) {
    mutations.push({
      order: mutations.length + 1,
      boneOrder: index + 1,
      executionMethod: 'blender_rna_pose_bone_rotation_mode_write',
      mcpTool: 'operatingline.blender.rig.armature.execute-next',
      sourceOperationId: 'projection.semantic.armature.bones',
      semanticAction: 'projection.semantic.armature.bones',
      valueSource: 'catalog_constant',
      actionArgument: null,
      mutationKind: 'pose_bone_rotation_mode_write',
      armatureId: 'rig.armature',
      boneName: bone.boneName,
      acceptedRotationMode: 'XYZ',
      observedRotationMode: 'XYZ',
      uiPath: ['Pose Mode', 'OperatingLine.Rig', 'Bone', bone.boneName, 'Rotation Mode'],
    });
  }
  return mutations;
}

function armatureRnaBindingMutations(ordinal: number) {
  if (ordinal !== 8) return [];
  return [
    {
      order: 1,
      bindingOrder: 1,
      executionMethod: 'blender_rna_object_bone_parent_write',
      mcpTool: 'operatingline.blender.rig.armature.execute-next',
      sourceOperationId: 'projection.semantic.armature.bindings',
      semanticAction: 'projection.semantic.armature.bindings',
      valueSource: 'accepted_action_argument',
      actionArgument: 'bindings',
      mutationKind: 'object_bone_parent_write',
      targetId: 'rig.target',
      armatureId: 'rig.armature',
      boneName: 'OperatingLine.Tip',
      acceptedParentType: 'BONE',
      observedParentType: 'BONE',
      acceptedParentBone: 'OperatingLine.Tip',
      observedParentBone: 'OperatingLine.Tip',
      observedParent: true,
      observedWorldMatrixPreserved: true,
      uiPath: ['Layout', 'rig.target', 'Parent', 'rig.armature', 'Bone', 'OperatingLine.Tip'],
    },
  ];
}

function armatureProgress(ordinal = 1) {
  const final = ordinal === armatureLeafOperationIds.length;
  const mutating = [2, 3, 4, 6, 8].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'rig.armature',
    actionName: 'blender.rig.create_armature',
    recipeId: 'blender.rig.create_armature.semantic',
    catalogVersion: '1.57.0',
    operationIds: armatureLeafOperationIds,
    completedOperationIds: armatureLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_armature_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: armatureLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'rig.armature',
        actionName: 'blender.rig.create_armature',
        recipeId: 'blender.rig.create_armature.semantic',
        catalogVersion: '1.57.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeArmature: final,
          rnaArmatureResourceMutations: armatureRnaResourceMutations(ordinal),
          rnaArmatureBoneMutations: armatureRnaBoneMutations(ordinal),
          rnaArmatureBindingMutations: armatureRnaBindingMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function skinWeightsAuthority(ordinal = 1) {
  const operationParameters = (() => {
    if (ordinal === 1) {
      return {
        targetId: 'skin.target',
        armatureId: 'skin.armature',
        modifierId: 'skin.modifier',
      };
    }
    if (ordinal === 5) {
      return {
        weights: [
          {
            vertexIndex: 0,
            influences: [{ boneName: 'OperatingLine.Root', weight: 1 }],
          },
        ],
      };
    }
    if (ordinal === 7) return { preserveVolume: true };
    if (ordinal === 8) return { modifierName: 'OperatingLine.Skin' };
    return {};
  })();
  const base = {
    ...authority(1),
    plan: { id: 'youtube.skin-weights', revision: 6 },
    leafId: 'rig.skin-weights',
    stepId: 'rig.skin-weights',
    actionName: 'blender.rig.bind_skin_weights',
    recipeId: 'blender.rig.bind_skin_weights.semantic',
    catalogVersion: '1.58.0',
    operationIds: skinWeightsLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: skinWeightsLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function skinWeightsDelivery(ordinal = 1) {
  return {
    ...skinWeightsAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function skinRnaWeightMutations(ordinal: number) {
  if (ordinal !== 5) return [];
  return [
    {
      order: 1,
      boneOrder: 1,
      executionMethod: 'blender_rna_armature_bone_deform_write',
      mcpTool: 'operatingline.blender.rig.skin-weights.execute-next',
      sourceOperationId: 'projection.semantic.skin_weights.weights',
      semanticAction: 'projection.semantic.skin_weights.weights',
      valueSource: 'accepted_action_argument',
      actionArgument: 'weights',
      mutationKind: 'armature_bone_deform_enable',
      targetId: 'skin.target',
      armatureId: 'skin.armature',
      boneName: 'OperatingLine.Root',
      acceptedValue: true,
      observedValue: true,
      uiPath: ['Object Data Properties', 'skin.armature', 'Bones', 'OperatingLine.Root', 'Deform'],
    },
    {
      order: 2,
      groupOrder: 1,
      executionMethod: 'blender_rna_vertex_group_create',
      mcpTool: 'operatingline.blender.rig.skin-weights.execute-next',
      sourceOperationId: 'projection.semantic.skin_weights.weights',
      semanticAction: 'projection.semantic.skin_weights.weights',
      valueSource: 'accepted_action_argument',
      actionArgument: 'weights',
      mutationKind: 'vertex_group_create',
      targetId: 'skin.target',
      armatureId: 'skin.armature',
      boneName: 'OperatingLine.Root',
      groupName: 'OperatingLine.Root',
      resourceType: 'VertexGroup',
      observedResource: true,
      uiPath: ['Object Data Properties', 'skin.target', 'Vertex Groups', 'OperatingLine.Root'],
    },
    {
      order: 3,
      vertexOrder: 1,
      influenceOrder: 1,
      executionMethod: 'blender_rna_vertex_group_weight_replace',
      mcpTool: 'operatingline.blender.rig.skin-weights.execute-next',
      sourceOperationId: 'projection.semantic.skin_weights.weights',
      semanticAction: 'projection.semantic.skin_weights.weights',
      valueSource: 'accepted_action_argument',
      actionArgument: 'weights',
      mutationKind: 'vertex_group_weight_replace',
      targetId: 'skin.target',
      armatureId: 'skin.armature',
      vertexIndex: 0,
      boneName: 'OperatingLine.Root',
      groupName: 'OperatingLine.Root',
      assignmentMode: 'REPLACE',
      acceptedWeight: 1,
      observedWeight: 1,
      observedMembership: true,
      uiPath: ['Weight Paint', 'skin.target', 'Vertex', '0', 'OperatingLine.Root', 'Weight'],
    },
  ];
}

function skinRnaModifierMutations(ordinal: number) {
  const pendingModifierName = 'OperatingLine.PendingSkinModifier.99999999';
  const common = {
    mcpTool: 'operatingline.blender.rig.skin-weights.execute-next',
    targetId: 'skin.target',
    armatureId: 'skin.armature',
    modifierId: 'skin.modifier',
  };
  if (ordinal === 7) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_armature_modifier_create',
        sourceOperationId: 'projection.semantic.skin_weights.preserve_volume',
        semanticAction: 'projection.semantic.skin_weights.preserve_volume',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'armature_modifier_create',
        pendingModifierName,
        resourceType: 'ArmatureModifier',
        modifierType: 'ARMATURE',
        observedResource: true,
        uiPath: ['Properties', 'skin.target', 'Modifiers', pendingModifierName],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_armature_modifier_object_bind',
        sourceOperationId: 'projection.semantic.skin_weights.preserve_volume',
        semanticAction: 'projection.semantic.skin_weights.preserve_volume',
        valueSource: 'accepted_action_argument',
        actionArgument: 'armatureId',
        mutationKind: 'armature_modifier_object_bind',
        pendingModifierName,
        observedBinding: true,
        uiPath: [
          'Properties',
          'skin.target',
          'Modifiers',
          pendingModifierName,
          'Object',
          'skin.armature',
        ],
      },
      ...(
        [
          ['use_vertex_groups', true, 'catalog_constant', null, 'Vertex Groups'],
          ['use_bone_envelopes', false, 'catalog_constant', null, 'Bone Envelopes'],
          [
            'use_deform_preserve_volume',
            true,
            'accepted_action_argument',
            'preserveVolume',
            'Preserve Volume',
          ],
        ] as const
      ).map(([propertyName, acceptedValue, valueSource, actionArgument, uiLabel], index) => ({
        ...common,
        order: index + 3,
        executionMethod: 'blender_rna_armature_modifier_property_write',
        sourceOperationId: 'projection.semantic.skin_weights.preserve_volume',
        semanticAction: 'projection.semantic.skin_weights.preserve_volume',
        valueSource,
        actionArgument,
        mutationKind: 'armature_modifier_property_write',
        pendingModifierName,
        propertyName,
        acceptedValue,
        observedValue: acceptedValue,
        uiPath: ['Properties', 'skin.target', 'Modifiers', pendingModifierName, uiLabel],
      })),
    ];
  }
  if (ordinal === 8) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_modifier_name_write',
        sourceOperationId: 'projection.semantic.skin_weights.modifier_name',
        semanticAction: 'projection.semantic.skin_weights.modifier_name',
        valueSource: 'accepted_action_argument',
        actionArgument: 'modifierName',
        mutationKind: 'armature_modifier_name_write',
        beforeName: pendingModifierName,
        acceptedName: 'OperatingLine.Skin',
        observedName: 'OperatingLine.Skin',
        uiPath: ['Properties', 'skin.target', 'Modifiers', 'OperatingLine.Skin', 'Name'],
      },
    ];
  }
  return [];
}

function skinWeightsProgress(ordinal = 1) {
  const final = ordinal === skinWeightsLeafOperationIds.length;
  const mutating = [5, 7, 8].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'rig.skin-weights',
    actionName: 'blender.rig.bind_skin_weights',
    recipeId: 'blender.rig.bind_skin_weights.semantic',
    catalogVersion: '1.58.0',
    operationIds: skinWeightsLeafOperationIds,
    completedOperationIds: skinWeightsLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_skin_weights_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: skinWeightsLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'rig.skin-weights',
        actionName: 'blender.rig.bind_skin_weights',
        recipeId: 'blender.rig.bind_skin_weights.semantic',
        catalogVersion: '1.58.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeSkinWeights: final,
          rnaSkinWeightMutations: skinRnaWeightMutations(ordinal),
          rnaSkinModifierMutations: skinRnaModifierMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function solidifyAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.shell', modifierId: 'modifier.solidify' }
      : ordinal === 4
        ? { modifierName: 'OperatingLine.Shell', thickness: 0.125, offset: -0.25 }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.solidify', revision: 7 },
    leafId: 'modifier.solidify',
    stepId: 'modifier.solidify',
    actionName: 'blender.modifier.add_solidify',
    recipeId: 'blender.modifier.add_solidify.semantic',
    catalogVersion: '1.59.0',
    operationIds: solidifyLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: solidifyLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function solidifyDelivery(ordinal = 1) {
  return {
    ...solidifyAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

const solidifyPropertySpecs = [
  ['solidify_mode', 'EXTRUDE', 'catalog_constant', null],
  ['thickness', 0.125, 'accepted_action_argument', 'thickness'],
  ['thickness_clamp', 0, 'catalog_constant', null],
  ['use_thickness_angle_clamp', false, 'catalog_constant', null],
  ['thickness_vertex_group', 0, 'catalog_constant', null],
  ['offset', -0.25, 'accepted_action_argument', 'offset'],
  ['edge_crease_inner', 0, 'catalog_constant', null],
  ['edge_crease_outer', 0, 'catalog_constant', null],
  ['edge_crease_rim', 0, 'catalog_constant', null],
  ['material_offset', 0, 'catalog_constant', null],
  ['material_offset_rim', 0, 'catalog_constant', null],
  ['vertex_group', '', 'catalog_constant', null],
  ['shell_vertex_group', '', 'catalog_constant', null],
  ['rim_vertex_group', '', 'catalog_constant', null],
  ['use_even_offset', true, 'catalog_constant', null],
  ['use_rim', true, 'catalog_constant', null],
  ['use_rim_only', false, 'catalog_constant', null],
  ['use_quality_normals', false, 'catalog_constant', null],
  ['invert_vertex_group', false, 'catalog_constant', null],
  ['use_flat_faces', false, 'catalog_constant', null],
  ['use_flip_normals', false, 'catalog_constant', null],
  ['nonmanifold_thickness_mode', 'CONSTRAINTS', 'catalog_constant', null],
  ['nonmanifold_boundary_mode', 'NONE', 'catalog_constant', null],
  ['nonmanifold_merge_threshold', 0.0001, 'catalog_constant', null],
  ['bevel_convex', 0, 'catalog_constant', null],
] as const;

function solidifyRnaMutations(ordinal: number) {
  const pendingModifierName = 'OperatingLine.PendingSolidifyModifier.99999999';
  const common = {
    mcpTool: 'operatingline.blender.modifier.solidify.execute-next',
    targetId: 'mesh.shell',
    modifierId: 'modifier.solidify',
  };
  if (ordinal === 3) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_solidify_modifier_create',
        sourceOperationId: 'control.add_modifier',
        semanticAction: 'control.add_modifier',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'solidify_modifier_create',
        pendingModifierName,
        resourceType: 'SolidifyModifier',
        modifierType: 'SOLIDIFY',
        observedResource: true,
        uiPath: [
          'Properties',
          'mesh.shell',
          'Modifiers',
          'Add Modifier',
          'Generate',
          'Solidify',
          pendingModifierName,
        ],
      },
    ];
  }
  if (ordinal === 4) {
    const modifierName = 'OperatingLine.Shell';
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_modifier_name_write',
        sourceOperationId: 'semantic.solidify_parameters',
        semanticAction: 'semantic.solidify_parameters',
        valueSource: 'accepted_action_argument',
        actionArgument: 'modifierName',
        mutationKind: 'solidify_modifier_name_write',
        beforeName: pendingModifierName,
        acceptedName: modifierName,
        observedName: modifierName,
        uiPath: ['Properties', 'mesh.shell', 'Modifiers', modifierName, 'Name'],
      },
      ...solidifyPropertySpecs.map(
        ([propertyName, acceptedValue, valueSource, actionArgument], index) => ({
          ...common,
          order: index + 2,
          executionMethod: 'blender_rna_solidify_modifier_property_write',
          sourceOperationId: 'semantic.solidify_parameters',
          semanticAction: 'semantic.solidify_parameters',
          valueSource,
          actionArgument,
          mutationKind: 'solidify_modifier_property_write',
          modifierName,
          propertyName,
          acceptedValue,
          observedValue:
            typeof acceptedValue === 'number' ? Math.fround(acceptedValue) : acceptedValue,
          uiPath: ['Properties', 'mesh.shell', 'Modifiers', modifierName, propertyName],
        }),
      ),
    ];
  }
  return [];
}

function solidifyProgress(ordinal = 1) {
  const final = ordinal === solidifyLeafOperationIds.length;
  const mutating = [3, 4].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'modifier.solidify',
    actionName: 'blender.modifier.add_solidify',
    recipeId: 'blender.modifier.add_solidify.semantic',
    catalogVersion: '1.59.0',
    operationIds: solidifyLeafOperationIds,
    completedOperationIds: solidifyLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_modifier_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: solidifyLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'modifier.solidify',
        actionName: 'blender.modifier.add_solidify',
        recipeId: 'blender.modifier.add_solidify.semantic',
        catalogVersion: '1.59.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeSolidify: final,
          rnaSolidifyModifierMutations: solidifyRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function bevelModifierAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.beveled', modifierId: 'modifier.bevel' }
      : ordinal === 4
        ? {
            modifierName: 'OperatingLine.Bevel',
            width: 0.25,
            segments: 3,
            angleLimit: Math.PI / 3,
          }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.bevel-modifier', revision: 12 },
    leafId: 'modifier.bevel',
    stepId: 'modifier.bevel',
    actionName: 'blender.modifier.add_bevel',
    recipeId: 'blender.modifier.add_bevel.semantic',
    catalogVersion: '1.67.0',
    operationIds: bevelModifierLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: bevelModifierLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function bevelModifierDelivery(ordinal = 1) {
  return {
    ...bevelModifierAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

const bevelModifierPropertySpecs = [
  ['width', 0.25, 'accepted_action_argument', 'width'],
  ['segments', 3, 'accepted_action_argument', 'segments'],
  ['limit_method', 'ANGLE', 'catalog_constant', null],
  ['angle_limit', Math.PI / 3, 'accepted_action_argument', 'angleLimit'],
] as const;

function bevelModifierRnaMutations(ordinal: number) {
  const pendingModifierName = 'OperatingLine.PendingBevelModifier.99999999';
  const common = {
    mcpTool: 'operatingline.blender.modifier.bevel.execute-next',
    targetId: 'mesh.beveled',
    modifierId: 'modifier.bevel',
  };
  if (ordinal === 3) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_bevel_modifier_create',
        sourceOperationId: 'control.add_modifier',
        semanticAction: 'control.add_modifier',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'bevel_modifier_create',
        pendingModifierName,
        resourceType: 'BevelModifier',
        modifierType: 'BEVEL',
        observedResource: true,
        uiPath: [
          'Properties',
          'mesh.beveled',
          'Modifiers',
          'Add Modifier',
          'Generate',
          'Bevel',
          pendingModifierName,
        ],
      },
    ];
  }
  if (ordinal === 4) {
    const modifierName = 'OperatingLine.Bevel';
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_modifier_name_write',
        sourceOperationId: 'semantic.bevel_parameters',
        semanticAction: 'semantic.bevel_parameters',
        valueSource: 'accepted_action_argument',
        actionArgument: 'modifierName',
        mutationKind: 'bevel_modifier_name_write',
        beforeName: pendingModifierName,
        acceptedName: modifierName,
        observedName: modifierName,
        uiPath: ['Properties', 'mesh.beveled', 'Modifiers', modifierName, 'Name'],
      },
      ...bevelModifierPropertySpecs.map(
        ([propertyName, acceptedValue, valueSource, actionArgument], index) => ({
          ...common,
          order: index + 2,
          executionMethod: 'blender_rna_bevel_modifier_property_write',
          sourceOperationId: 'semantic.bevel_parameters',
          semanticAction: 'semantic.bevel_parameters',
          valueSource,
          actionArgument,
          mutationKind: 'bevel_modifier_property_write',
          modifierName,
          propertyName,
          acceptedValue,
          observedValue:
            propertyName !== 'segments' && typeof acceptedValue === 'number'
              ? Math.fround(acceptedValue)
              : acceptedValue,
          uiPath: ['Properties', 'mesh.beveled', 'Modifiers', modifierName, propertyName],
        }),
      ),
    ];
  }
  return [];
}

function bevelModifierProgress(ordinal = 1) {
  const final = ordinal === bevelModifierLeafOperationIds.length;
  const mutating = [3, 4].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'modifier.bevel',
    actionName: 'blender.modifier.add_bevel',
    recipeId: 'blender.modifier.add_bevel.semantic',
    catalogVersion: '1.67.0',
    operationIds: bevelModifierLeafOperationIds,
    completedOperationIds: bevelModifierLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_modifier_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: bevelModifierLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'modifier.bevel',
        actionName: 'blender.modifier.add_bevel',
        recipeId: 'blender.modifier.add_bevel.semantic',
        catalogVersion: '1.67.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeBevelModifier: final,
          rnaBevelModifierMutations: bevelModifierRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

const singleMaterialArguments = {
  materialId: 'material.surface',
  materialName: 'OperatingLine.Surface',
  targets: ['mesh.left', 'mesh.right'],
  baseColor: [0.17, 0.31, 0.73, 1],
  roughness: 0.64,
  metallic: 0.28,
} as const;

function singleMaterialAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { materialId: singleMaterialArguments.materialId }
      : ordinal === 4
        ? {
            materialName: singleMaterialArguments.materialName,
            baseColor: singleMaterialArguments.baseColor,
            roughness: singleMaterialArguments.roughness,
            metallic: singleMaterialArguments.metallic,
            targets: singleMaterialArguments.targets,
          }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.single-material', revision: 13 },
    leafId: 'material.surface',
    stepId: 'material.surface',
    actionName: 'blender.material.create_and_assign',
    recipeId: 'blender.material.create_and_assign.semantic',
    catalogVersion: '1.68.0',
    operationIds: singleMaterialLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: singleMaterialLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function singleMaterialDelivery(ordinal = 1) {
  return {
    ...singleMaterialAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function singleMaterialRnaMutations(ordinal: number) {
  const pendingMaterialName = 'OperatingLine.PendingMaterial.99999999';
  const common = {
    mcpTool: 'operatingline.blender.material.single.execute-next',
    materialId: singleMaterialArguments.materialId,
  };
  if (ordinal === 3) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_material_create',
        sourceOperationId: 'control.new_material',
        semanticAction: 'control.new_material',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'material_create',
        pendingMaterialName,
        resourceType: 'Material',
        observedResource: true,
        uiPath: ['Shading', 'Material Properties', 'New', pendingMaterialName],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_material_use_nodes_write',
        sourceOperationId: 'control.new_material',
        semanticAction: 'control.new_material',
        valueSource: 'catalog_constant',
        mutationKind: 'material_use_nodes_write',
        beforeValue: false,
        acceptedValue: true,
        observedValue: true,
        uiPath: ['Shading', 'Material Properties', pendingMaterialName, 'Use Nodes'],
      },
    ];
  }
  if (ordinal !== 4) return [];
  const controls: Array<Record<string, unknown>> = [
    {
      ...common,
      order: 1,
      executionMethod: 'blender_rna_material_name_write',
      sourceOperationId: 'semantic.principled_surface',
      semanticAction: 'semantic.principled_surface',
      valueSource: 'accepted_action_argument',
      actionArgument: 'materialName',
      mutationKind: 'material_name_write',
      materialName: singleMaterialArguments.materialName,
      surface: 'Material',
      propertyName: 'name',
      beforeValue: pendingMaterialName,
      acceptedValue: singleMaterialArguments.materialName,
      observedValue: singleMaterialArguments.materialName,
      uiPath: [
        'Shading',
        'Material Properties',
        singleMaterialArguments.materialName,
        'Material',
        'name',
      ],
    },
  ];
  const appendNumeric = (
    executionMethod: string,
    mutationKind: string,
    surface: string,
    propertyName: string,
    actionArgument: string,
    acceptedValues: readonly number[],
    beforeValues: readonly number[],
    components?: readonly string[],
  ) => {
    acceptedValues.forEach((acceptedValue, index) => {
      const component = components?.[index];
      controls.push({
        ...common,
        order: controls.length + 1,
        executionMethod,
        sourceOperationId: 'semantic.principled_surface',
        semanticAction: 'semantic.principled_surface',
        valueSource: 'accepted_action_argument',
        actionArgument,
        mutationKind,
        materialName: singleMaterialArguments.materialName,
        surface,
        propertyName,
        ...(component === undefined ? {} : { component }),
        beforeValue: beforeValues[index],
        acceptedValue,
        observedValue: Math.fround(acceptedValue),
        uiPath: [
          'Shading',
          'Material Properties',
          singleMaterialArguments.materialName,
          surface,
          propertyName,
          ...(component === undefined ? [] : [component]),
        ],
      });
    });
  };
  appendNumeric(
    'blender_rna_material_property_write',
    'material_property_write',
    'Material',
    'diffuse_color',
    'baseColor',
    singleMaterialArguments.baseColor,
    [0.8, 0.8, 0.8, 1],
    ['R', 'G', 'B', 'A'],
  );
  appendNumeric(
    'blender_rna_material_property_write',
    'material_property_write',
    'Material',
    'roughness',
    'roughness',
    [singleMaterialArguments.roughness],
    [0.5],
  );
  appendNumeric(
    'blender_rna_material_property_write',
    'material_property_write',
    'Material',
    'metallic',
    'metallic',
    [singleMaterialArguments.metallic],
    [0],
  );
  appendNumeric(
    'blender_rna_principled_input_write',
    'principled_input_write',
    'Principled BSDF',
    'Base Color',
    'baseColor',
    singleMaterialArguments.baseColor,
    [0.8, 0.8, 0.8, 1],
    ['R', 'G', 'B', 'A'],
  );
  appendNumeric(
    'blender_rna_principled_input_write',
    'principled_input_write',
    'Principled BSDF',
    'Roughness',
    'roughness',
    [singleMaterialArguments.roughness],
    [0.5],
  );
  appendNumeric(
    'blender_rna_principled_input_write',
    'principled_input_write',
    'Principled BSDF',
    'Metallic',
    'metallic',
    [singleMaterialArguments.metallic],
    [0],
  );
  return [
    ...controls,
    ...singleMaterialArguments.targets.map((targetId, index) => ({
      ...common,
      order: controls.length + index + 1,
      executionMethod: 'blender_rna_material_slot_replace',
      sourceOperationId: 'semantic.principled_surface',
      semanticAction: 'semantic.principled_surface',
      valueSource: 'accepted_action_argument',
      actionArgument: 'targets',
      mutationKind: 'material_slot_replace',
      targetOrder: index + 1,
      targetId,
      beforeSlotCount: index,
      observedSlotCount: 1,
      observedAssignment: true,
      sourceMeshId: `${targetId}.mesh`,
      sourceContentIntact: true,
      uiPath: [
        'Shading',
        'Material Properties',
        targetId,
        'Material Slots',
        singleMaterialArguments.materialName,
      ],
    })),
  ];
}

function singleMaterialProgress(ordinal = 1) {
  const final = ordinal === singleMaterialLeafOperationIds.length;
  const mutating = [3, 4].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'material.surface',
    actionName: 'blender.material.create_and_assign',
    recipeId: 'blender.material.create_and_assign.semantic',
    catalogVersion: '1.68.0',
    operationIds: singleMaterialLeafOperationIds,
    completedOperationIds: singleMaterialLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_material_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: singleMaterialLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'material.surface',
        actionName: 'blender.material.create_and_assign',
        recipeId: 'blender.material.create_and_assign.semantic',
        catalogVersion: '1.68.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeSingleMaterial: final,
          rnaMaterialMutations: singleMaterialRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

const materialPaletteArguments = {
  materials: [
    {
      materialId: 'material.eye',
      materialName: 'OperatingLine.Eye',
      targets: ['mesh.eye.left', 'mesh.eye.right'],
      baseColor: [0.05, 0.08, 0.12, 1],
      roughness: 0.31,
      metallic: 0.17,
    },
    {
      materialId: 'material.body',
      materialName: 'OperatingLine.Body',
      targets: ['mesh.body'],
      baseColor: [0.72, 0.18, 0.09, 1],
      roughness: 0.66,
      metallic: 0.02,
    },
  ],
} as const;

function materialPaletteAuthority(ordinal = 1) {
  const base = {
    ...authority(1),
    plan: { id: 'youtube.material-palette', revision: 14 },
    leafId: 'material.palette',
    stepId: 'material.palette',
    actionName: 'blender.material.create_palette_and_assign',
    recipeId: 'blender.material.create_palette_and_assign.semantic',
    catalogVersion: '1.69.0',
    operationIds: materialPaletteLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: materialPaletteLeafOperationIds[ordinal - 1]!,
    operationParameters: ordinal === 3 ? materialPaletteArguments : {},
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function materialPaletteDelivery(ordinal = 1) {
  return {
    ...materialPaletteAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function materialPaletteRnaMutations(ordinal: number) {
  if (ordinal !== 4) return [];
  const mutations: Array<Record<string, unknown>> = [];
  for (const [materialIndex, definition] of materialPaletteArguments.materials.entries()) {
    const materialOrder = materialIndex + 1;
    const common = {
      mcpTool: 'operatingline.blender.material.palette.execute-next',
      sourceOperationId: 'semantic.assign_targets',
      semanticAction: 'semantic.assign_targets',
      materialOrder,
      materialId: definition.materialId,
      materialName: definition.materialName,
    };
    mutations.push({
      ...common,
      order: mutations.length + 1,
      materialMutationOrder: 1,
      executionMethod: 'blender_rna_material_create',
      valueSource: 'accepted_action_argument',
      actionArgument: 'materials[].materialName',
      mutationKind: 'palette_material_create',
      resourceType: 'Material',
      observedResource: true,
      uiPath: [
        'Shading',
        'Material Properties',
        'Palette',
        materialOrder,
        definition.materialName,
        'New',
      ],
    });
    mutations.push({
      ...common,
      order: mutations.length + 1,
      materialMutationOrder: 2,
      executionMethod: 'blender_rna_material_use_nodes_write',
      valueSource: 'catalog_constant',
      mutationKind: 'palette_material_use_nodes_write',
      beforeValue: false,
      acceptedValue: true,
      observedValue: true,
      uiPath: [
        'Shading',
        'Material Properties',
        'Palette',
        materialOrder,
        definition.materialName,
        'Use Nodes',
      ],
    });
    const controls = [
      ...(['R', 'G', 'B', 'A'] as const).map((component, index) => ({
        executionMethod: 'blender_rna_material_property_write',
        mutationKind: 'palette_material_property_write',
        actionArgument: 'materials[].baseColor',
        surface: 'Material',
        propertyName: 'diffuse_color',
        component,
        acceptedValue: definition.baseColor[index]!,
        beforeValue: index === 3 ? 1 : 0.8,
      })),
      {
        executionMethod: 'blender_rna_material_property_write',
        mutationKind: 'palette_material_property_write',
        actionArgument: 'materials[].roughness',
        surface: 'Material',
        propertyName: 'roughness',
        component: undefined,
        acceptedValue: definition.roughness,
        beforeValue: 0.5,
      },
      {
        executionMethod: 'blender_rna_material_property_write',
        mutationKind: 'palette_material_property_write',
        actionArgument: 'materials[].metallic',
        surface: 'Material',
        propertyName: 'metallic',
        component: undefined,
        acceptedValue: definition.metallic,
        beforeValue: 0,
      },
      ...(['R', 'G', 'B', 'A'] as const).map((component, index) => ({
        executionMethod: 'blender_rna_principled_input_write',
        mutationKind: 'palette_principled_input_write',
        actionArgument: 'materials[].baseColor',
        surface: 'Principled BSDF',
        propertyName: 'Base Color',
        component,
        acceptedValue: definition.baseColor[index]!,
        beforeValue: index === 3 ? 1 : 0.8,
      })),
      {
        executionMethod: 'blender_rna_principled_input_write',
        mutationKind: 'palette_principled_input_write',
        actionArgument: 'materials[].roughness',
        surface: 'Principled BSDF',
        propertyName: 'Roughness',
        component: undefined,
        acceptedValue: definition.roughness,
        beforeValue: 0.5,
      },
      {
        executionMethod: 'blender_rna_principled_input_write',
        mutationKind: 'palette_principled_input_write',
        actionArgument: 'materials[].metallic',
        surface: 'Principled BSDF',
        propertyName: 'Metallic',
        component: undefined,
        acceptedValue: definition.metallic,
        beforeValue: 0,
      },
    ] as const;
    for (const [controlIndex, control] of controls.entries()) {
      mutations.push({
        ...common,
        order: mutations.length + 1,
        materialMutationOrder: controlIndex + 3,
        executionMethod: control.executionMethod,
        valueSource: 'accepted_action_argument',
        actionArgument: control.actionArgument,
        mutationKind: control.mutationKind,
        surface: control.surface,
        propertyName: control.propertyName,
        ...(control.component === undefined ? {} : { component: control.component }),
        beforeValue: control.beforeValue,
        acceptedValue: control.acceptedValue,
        observedValue: Math.fround(control.acceptedValue),
        uiPath: [
          'Shading',
          'Material Properties',
          'Palette',
          materialOrder,
          definition.materialName,
          control.surface,
          control.propertyName,
          ...(control.component === undefined ? [] : [control.component]),
        ],
      });
    }
    for (const [targetIndex, targetId] of definition.targets.entries()) {
      mutations.push({
        ...common,
        order: mutations.length + 1,
        materialMutationOrder: targetIndex + 15,
        executionMethod: 'blender_rna_material_slot_replace',
        valueSource: 'accepted_action_argument',
        actionArgument: 'materials[].targets',
        mutationKind: 'palette_material_slot_replace',
        targetOrder: targetIndex + 1,
        targetId,
        beforeSlotCount: 0,
        observedSlotCount: 1,
        observedAssignment: true,
        sourceMeshId: `${targetId}.mesh`,
        sourceContentIntact: true,
        uiPath: [
          'Shading',
          'Material Properties',
          'Palette',
          materialOrder,
          targetId,
          'Material Slots',
          definition.materialName,
        ],
      });
    }
  }
  return mutations;
}

function materialPaletteProgress(ordinal = 1) {
  const final = ordinal === materialPaletteLeafOperationIds.length;
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'material.palette',
    actionName: 'blender.material.create_palette_and_assign',
    recipeId: 'blender.material.create_palette_and_assign.semantic',
    catalogVersion: '1.69.0',
    operationIds: materialPaletteLeafOperationIds,
    completedOperationIds: materialPaletteLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_material_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: materialPaletteLeafOperationIds[ordinal - 1]!,
        mutating: ordinal === 4,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'material.palette',
        actionName: 'blender.material.create_palette_and_assign',
        recipeId: 'blender.material.create_palette_and_assign.semantic',
        catalogVersion: '1.69.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: ordinal === 4 ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeMaterialPalette: final,
          stage: ordinal,
          materialIds: materialPaletteArguments.materials.map(({ materialId }) => materialId),
          targetIds: materialPaletteArguments.materials.flatMap(({ targets }) => targets),
          paletteEntryCount: materialPaletteArguments.materials.length,
          paletteValidated: ordinal >= 3,
          materialsCreated: ordinal >= 4,
          surfacesConfigured: ordinal >= 4,
          assignmentsApplied: ordinal >= 4,
          resolvedMaterialNames:
            ordinal >= 4
              ? materialPaletteArguments.materials.map(({ materialName }) => materialName)
              : [],
          rnaMaterialPaletteMutations: materialPaletteRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function subdivisionSurfaceAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', modifierId: 'modifier.subdivision-surface' }
      : ordinal === 4
        ? { modifierName: 'OperatingLine.Body.Subdivision', viewportLevel: 2 }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.subdivision-surface', revision: 9 },
    leafId: 'modifier.subdivision-surface',
    stepId: 'modifier.subdivision-surface',
    actionName: 'blender.modifier.add_subdivision_surface',
    recipeId: 'blender.modifier.add_subdivision_surface.semantic',
    catalogVersion: '1.61.0',
    operationIds: subdivisionSurfaceLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: subdivisionSurfaceLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function subdivisionSurfaceDelivery(ordinal = 1) {
  return {
    ...subdivisionSurfaceAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

const subdivisionSurfacePropertySpecs = [
  ['subdivision_type', 'CATMULL_CLARK', 'catalog_constant', null],
  ['levels', 2, 'accepted_action_argument', 'viewportLevel'],
  ['render_levels', 2, 'catalog_constant', null],
  ['quality', 3, 'catalog_constant', null],
  ['show_only_control_edges', true, 'catalog_constant', null],
  ['use_creases', true, 'catalog_constant', null],
  ['use_limit_surface', true, 'catalog_constant', null],
  ['boundary_smooth', 'ALL', 'catalog_constant', null],
  ['uv_smooth', 'PRESERVE_BOUNDARIES', 'catalog_constant', null],
  ['use_custom_normals', false, 'catalog_constant', null],
  ['show_viewport', true, 'catalog_constant', null],
  ['show_render', true, 'catalog_constant', null],
  ['show_in_editmode', true, 'catalog_constant', null],
  ['show_on_cage', false, 'catalog_constant', null],
] as const;

function subdivisionSurfaceRnaMutations(ordinal: number) {
  const pendingModifierName = 'OperatingLine.PendingSubdivisionSurfaceModifier.99999999';
  const common = {
    mcpTool: 'operatingline.blender.modifier.subdivision-surface.execute-next',
    targetId: 'mesh.body',
    modifierId: 'modifier.subdivision-surface',
  };
  if (ordinal === 3) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_subdivision_surface_modifier_create',
        sourceOperationId: 'operator.subdivision_set',
        semanticAction: 'operator.subdivision_set',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'subdivision_surface_modifier_create',
        pendingModifierName,
        resourceType: 'SubsurfModifier',
        modifierType: 'SUBSURF',
        observedResource: true,
        uiPath: ['Layout', 'mesh.body', 'Object', 'Subdivision Set', pendingModifierName],
      },
    ];
  }
  if (ordinal === 4) {
    const modifierName = 'OperatingLine.Body.Subdivision';
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_modifier_name_write',
        sourceOperationId: 'semantic.subdivision_surface_contract',
        semanticAction: 'semantic.subdivision_surface_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'modifierName',
        mutationKind: 'subdivision_surface_modifier_name_write',
        beforeName: pendingModifierName,
        acceptedName: modifierName,
        observedName: modifierName,
        uiPath: ['Properties', 'mesh.body', 'Modifiers', modifierName, 'Name'],
      },
      ...subdivisionSurfacePropertySpecs.map(
        ([propertyName, acceptedValue, valueSource, actionArgument], index) => ({
          ...common,
          order: index + 2,
          executionMethod: 'blender_rna_subdivision_surface_modifier_property_write',
          sourceOperationId: 'semantic.subdivision_surface_contract',
          semanticAction: 'semantic.subdivision_surface_contract',
          valueSource,
          actionArgument,
          mutationKind: 'subdivision_surface_modifier_property_write',
          modifierName,
          propertyName,
          acceptedValue,
          observedValue: acceptedValue,
          uiPath: ['Properties', 'mesh.body', 'Modifiers', modifierName, propertyName],
        }),
      ),
    ];
  }
  return [];
}

function subdivisionSurfaceProgress(ordinal = 1) {
  const final = ordinal === subdivisionSurfaceLeafOperationIds.length;
  const mutating = [3, 4].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'modifier.subdivision-surface',
    actionName: 'blender.modifier.add_subdivision_surface',
    recipeId: 'blender.modifier.add_subdivision_surface.semantic',
    catalogVersion: '1.61.0',
    operationIds: subdivisionSurfaceLeafOperationIds,
    completedOperationIds: subdivisionSurfaceLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_modifier_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: subdivisionSurfaceLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'modifier.subdivision-surface',
        actionName: 'blender.modifier.add_subdivision_surface',
        recipeId: 'blender.modifier.add_subdivision_surface.semantic',
        catalogVersion: '1.61.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeSubdivisionSurface: final,
          rnaSubdivisionSurfaceModifierMutations: subdivisionSurfaceRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function editBevelAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', resultMeshId: 'mesh.body.beveled' }
      : ordinal === 5
        ? { width: 0.2, segments: 3, profile: 0.6 }
        : ordinal === 6
          ? { resultMeshName: 'OperatingLine.Body.Beveled' }
          : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.edit-bevel', revision: 10 },
    leafId: 'mesh.edit-bevel',
    stepId: 'mesh.edit-bevel',
    actionName: 'blender.mesh.edit_bevel_edges',
    recipeId: 'blender.mesh.edit_bevel_edges.semantic',
    catalogVersion: '1.62.0',
    operationIds: editBevelLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: editBevelLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function editBevelDelivery(ordinal = 1) {
  return {
    ...editBevelAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function editBevelMeshOperations(ordinal: number) {
  const common = {
    mcpTool: 'operatingline.blender.mesh.edit-bevel-edges.execute-next',
    targetId: 'mesh.body',
    resultMeshId: 'mesh.body.beveled',
  };
  const pendingResultMeshName = 'OperatingLine.PendingEditBevelMesh.99999999';
  if (ordinal === 5) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_copy',
        sourceOperationId: 'operator.bevel_edges',
        semanticAction: 'operator.bevel_edges',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_bevel_mesh_create',
        pendingResultMeshName,
        resourceType: 'Mesh',
        observedResource: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Edit Bevel Edges',
          'Result Mesh',
          pendingResultMeshName,
        ],
      },
      ...(
        [
          ['width', 'Width', 0.2],
          ['segments', 'Segments', 3],
          ['profile', 'Profile Shape', 0.6],
        ] as const
      ).map(([parameterName, label, value], index) => ({
        ...common,
        order: index + 2,
        executionMethod: 'blender_bmesh_bevel_argument_projection',
        sourceOperationId: 'operator.bevel_edges',
        semanticAction: 'operator.bevel_edges',
        valueSource: 'accepted_action_argument',
        actionArgument: parameterName,
        mutationKind: 'edit_bevel_parameter_projection',
        parameterName,
        acceptedValue: value,
        projectedValue: value,
        uiPath: ['Adjust Last Operation', label],
      })),
      {
        ...common,
        order: 5,
        executionMethod: 'blender_bmesh_ops_bevel',
        sourceOperationId: 'operator.bevel_edges',
        semanticAction: 'operator.bevel_edges',
        valueSource: 'accepted_action_and_catalog_constants',
        mutationKind: 'edit_bevel_mesh_content_write',
        fixedParameters: {
          offsetType: 'OFFSET',
          affect: 'EDGES',
          clampOverlap: false,
          loopSlide: true,
          markSeam: false,
          markSharp: false,
          material: -1,
          hardenNormals: false,
          faceStrengthMode: 'NONE',
          miterOuter: 'SHARP',
          miterInner: 'SHARP',
          spread: 0.1,
          vmeshMethod: 'ADJ',
        },
        sourceTopology: [8, 12, 6],
        resultTopology: [96, 192, 98],
        sourceContentPreserved: true,
        resultContentObserved: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Edit Bevel Edges', 'Apply BMesh Bevel'],
      },
    ];
  }
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_name_write',
        sourceOperationId: 'semantic.managed_bevel_edges_contract',
        semanticAction: 'semantic.managed_bevel_edges_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'resultMeshName',
        mutationKind: 'edit_bevel_mesh_name_write',
        beforeName: pendingResultMeshName,
        acceptedName: 'OperatingLine.Body.Beveled',
        observedName: 'OperatingLine.Body.Beveled',
        uiPath: ['OperatingLine', 'Guided Control', 'Edit Bevel Edges', 'Result Mesh Name'],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_object_data_link_write',
        sourceOperationId: 'semantic.managed_bevel_edges_contract',
        semanticAction: 'semantic.managed_bevel_edges_contract',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_bevel_object_data_link_write',
        sourceMeshLogicalId: 'mesh.body.source',
        resultMeshLogicalId: 'mesh.body.beveled',
        observedLink: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Edit Bevel Edges', 'Object Data Link'],
      },
    ];
  }
  return [];
}

function editBevelProgress(ordinal = 1) {
  const final = ordinal === editBevelLeafOperationIds.length;
  const mutating = [5, 6].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'mesh.edit-bevel',
    actionName: 'blender.mesh.edit_bevel_edges',
    recipeId: 'blender.mesh.edit_bevel_edges.semantic',
    catalogVersion: '1.62.0',
    operationIds: editBevelLeafOperationIds,
    completedOperationIds: editBevelLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_edit_mesh_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: editBevelLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'mesh.edit-bevel',
        actionName: 'blender.mesh.edit_bevel_edges',
        recipeId: 'blender.mesh.edit_bevel_edges.semantic',
        catalogVersion: '1.62.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeEditBevelEdges: final,
          editBevelMeshOperations: editBevelMeshOperations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function editInsetAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', resultMeshId: 'mesh.body.inset' }
      : ordinal === 5
        ? { thickness: 0.2, depth: 0.1 }
        : ordinal === 6
          ? { resultMeshName: 'OperatingLine.Body.Inset' }
          : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.edit-inset', revision: 11 },
    leafId: 'mesh.edit-inset',
    stepId: 'mesh.edit-inset',
    actionName: 'blender.mesh.edit_inset_faces',
    recipeId: 'blender.mesh.edit_inset_faces.semantic',
    catalogVersion: '1.63.0',
    operationIds: editInsetLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: editInsetLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function editInsetDelivery(ordinal = 1) {
  return {
    ...editInsetAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function editInsetMeshOperations(ordinal: number) {
  const common = {
    mcpTool: 'operatingline.blender.mesh.edit-inset-faces.execute-next',
    targetId: 'mesh.body',
    resultMeshId: 'mesh.body.inset',
  };
  const pendingResultMeshName = 'OperatingLine.PendingEditInsetMesh.99999999';
  if (ordinal === 5) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_copy',
        sourceOperationId: 'operator.inset_faces',
        semanticAction: 'operator.inset_faces',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_inset_mesh_create',
        pendingResultMeshName,
        resourceType: 'Mesh',
        observedResource: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Individual Inset Faces',
          'Result Mesh',
          pendingResultMeshName,
        ],
      },
      ...(
        [
          ['thickness', 'Thickness', 0.2],
          ['depth', 'Depth', 0.1],
        ] as const
      ).map(([parameterName, label, value], index) => ({
        ...common,
        order: index + 2,
        executionMethod: 'blender_bmesh_inset_individual_argument_projection',
        sourceOperationId: 'operator.inset_faces',
        semanticAction: 'operator.inset_faces',
        valueSource: 'accepted_action_argument',
        actionArgument: parameterName,
        mutationKind: 'edit_inset_parameter_projection',
        parameterName,
        acceptedValue: value,
        projectedValue: value,
        uiPath: ['Adjust Last Operation', label],
      })),
      {
        ...common,
        order: 4,
        executionMethod: 'blender_bmesh_ops_inset_individual',
        sourceOperationId: 'operator.inset_faces',
        semanticAction: 'operator.inset_faces',
        valueSource: 'accepted_action_and_catalog_constants',
        mutationKind: 'edit_inset_mesh_content_write',
        fixedParameters: {
          useEvenOffset: true,
          useInterpolate: true,
          useRelativeOffset: false,
        },
        sourceTopology: [8, 12, 6],
        sourceLoopCount: 24,
        expectedTopology: [32, 60, 30],
        resultTopology: [32, 60, 30],
        sourceContentPreserved: true,
        resultContentObserved: true,
        resultNondegenerate: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Individual Inset Faces',
          'Apply BMesh Individual Inset',
        ],
      },
    ];
  }
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_name_write',
        sourceOperationId: 'semantic.managed_inset_faces_contract',
        semanticAction: 'semantic.managed_inset_faces_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'resultMeshName',
        mutationKind: 'edit_inset_mesh_name_write',
        beforeName: pendingResultMeshName,
        acceptedName: 'OperatingLine.Body.Inset',
        observedName: 'OperatingLine.Body.Inset',
        uiPath: ['OperatingLine', 'Guided Control', 'Individual Inset Faces', 'Result Mesh Name'],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_object_data_link_write',
        sourceOperationId: 'semantic.managed_inset_faces_contract',
        semanticAction: 'semantic.managed_inset_faces_contract',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_inset_object_data_link_write',
        sourceMeshLogicalId: 'mesh.body.source',
        resultMeshLogicalId: 'mesh.body.inset',
        observedLink: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Individual Inset Faces', 'Object Data Link'],
      },
    ];
  }
  return [];
}

function editInsetProgress(ordinal = 1) {
  const final = ordinal === editInsetLeafOperationIds.length;
  const mutating = [5, 6].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'mesh.edit-inset',
    actionName: 'blender.mesh.edit_inset_faces',
    recipeId: 'blender.mesh.edit_inset_faces.semantic',
    catalogVersion: '1.63.0',
    operationIds: editInsetLeafOperationIds,
    completedOperationIds: editInsetLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_edit_mesh_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: editInsetLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'mesh.edit-inset',
        actionName: 'blender.mesh.edit_inset_faces',
        recipeId: 'blender.mesh.edit_inset_faces.semantic',
        catalogVersion: '1.63.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeEditInsetFaces: final,
          editInsetMeshOperations: editInsetMeshOperations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function editTriangulateAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', resultMeshId: 'mesh.body.triangulated' }
      : ordinal === 6
        ? { resultMeshName: 'OperatingLine.Body.Triangulated' }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.edit-triangulate', revision: 12 },
    leafId: 'mesh.edit-triangulate',
    stepId: 'mesh.edit-triangulate',
    actionName: 'blender.mesh.edit_triangulate',
    recipeId: 'blender.mesh.edit_triangulate.semantic',
    catalogVersion: '1.65.0',
    operationIds: editTriangulateLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: editTriangulateLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function editTriangulateDelivery(ordinal = 1) {
  return {
    ...editTriangulateAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function editTriangulateMeshOperations(ordinal: number) {
  const common = {
    mcpTool: 'operatingline.blender.mesh.edit-triangulate.execute-next',
    targetId: 'mesh.body',
    resultMeshId: 'mesh.body.triangulated',
  };
  const pendingResultMeshName = 'OperatingLine.PendingEditTriangulateMesh.99999999';
  if (ordinal === 5) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_copy',
        sourceOperationId: 'operator.triangulate_faces',
        semanticAction: 'operator.triangulate_faces',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_triangulate_mesh_create',
        pendingResultMeshName,
        resourceType: 'Mesh',
        observedResource: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Triangulate Faces',
          'Result Mesh',
          pendingResultMeshName,
        ],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_bmesh_ops_triangulate',
        sourceOperationId: 'operator.triangulate_faces',
        semanticAction: 'operator.triangulate_faces',
        valueSource: 'managed_source_and_catalog_constants',
        mutationKind: 'edit_triangulate_mesh_content_write',
        fixedParameters: { quadMethod: 'FIXED', ngonMethod: 'EAR_CLIP' },
        sourceTopology: [8, 12, 6],
        sourceLoopCount: 24,
        expectedTopology: [8, 18, 12],
        resultTopology: [8, 18, 12],
        sourceContentPreserved: true,
        resultContentObserved: true,
        allTriangles: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Triangulate Faces',
          'Apply BMesh Triangulate Faces',
        ],
      },
    ];
  }
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_name_write',
        sourceOperationId: 'semantic.managed_triangulate_contract',
        semanticAction: 'semantic.managed_triangulate_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'resultMeshName',
        mutationKind: 'edit_triangulate_mesh_name_write',
        beforeName: pendingResultMeshName,
        acceptedName: 'OperatingLine.Body.Triangulated',
        observedName: 'OperatingLine.Body.Triangulated',
        uiPath: ['OperatingLine', 'Guided Control', 'Triangulate Faces', 'Result Mesh Name'],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_object_data_link_write',
        sourceOperationId: 'semantic.managed_triangulate_contract',
        semanticAction: 'semantic.managed_triangulate_contract',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_triangulate_object_data_link_write',
        sourceMeshLogicalId: 'mesh.body.source',
        resultMeshLogicalId: 'mesh.body.triangulated',
        observedLink: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Triangulate Faces', 'Object Data Link'],
      },
    ];
  }
  return [];
}

function editTriangulateProgress(ordinal = 1) {
  const final = ordinal === editTriangulateLeafOperationIds.length;
  const mutating = [5, 6].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'mesh.edit-triangulate',
    actionName: 'blender.mesh.edit_triangulate',
    recipeId: 'blender.mesh.edit_triangulate.semantic',
    catalogVersion: '1.65.0',
    operationIds: editTriangulateLeafOperationIds,
    completedOperationIds: editTriangulateLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_edit_mesh_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: editTriangulateLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'mesh.edit-triangulate',
        actionName: 'blender.mesh.edit_triangulate',
        recipeId: 'blender.mesh.edit_triangulate.semantic',
        catalogVersion: '1.65.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeEditTriangulate: final,
          editTriangulateMeshOperations: editTriangulateMeshOperations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function editExtrudeRegionAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', resultMeshId: 'mesh.body.extruded' }
      : ordinal === 4
        ? { polygonIndices: [1] }
        : ordinal === 5
          ? { translation: [0, 0, 1] }
          : ordinal === 6
            ? { resultMeshName: 'OperatingLine.Body.Extruded' }
            : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.edit-extrude-region', revision: 13 },
    leafId: 'mesh.edit-extrude-region',
    stepId: 'mesh.edit-extrude-region',
    actionName: 'blender.mesh.edit_extrude_region',
    recipeId: 'blender.mesh.edit_extrude_region.semantic',
    catalogVersion: '1.66.0',
    operationIds: editExtrudeRegionLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: editExtrudeRegionLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function editExtrudeRegionDelivery(ordinal = 1) {
  return {
    ...editExtrudeRegionAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function editExtrudeRegionMeshOperations(ordinal: number) {
  const common = {
    mcpTool: 'operatingline.blender.mesh.edit-extrude-region.execute-next',
    targetId: 'mesh.body',
    resultMeshId: 'mesh.body.extruded',
  };
  const pendingResultMeshName = 'OperatingLine.PendingEditExtrudeRegionMesh.99999999';
  if (ordinal === 4) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_bmesh_region_validation',
        sourceOperationId: 'semantic.select_face_region',
        semanticAction: 'semantic.select_face_region',
        valueSource: 'accepted_action_argument',
        actionArgument: 'polygonIndices',
        mutationKind: 'edit_extrude_region_selection_projection',
        acceptedPolygonIndices: [1],
        observedPolygonIndices: [1],
        sourceTopology: [8, 12, 6],
        selectedFaceCount: 1,
        selectedEdgeCount: 4,
        selectedVertexCount: 4,
        boundaryEdgeCount: 4,
        selectionObserved: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Extrude Region', 'Face Region'],
      },
    ];
  }
  if (ordinal === 5) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_copy',
        sourceOperationId: 'operator.extrude_region_move',
        semanticAction: 'operator.extrude_region_move',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_extrude_region_mesh_create',
        pendingResultMeshName,
        resourceType: 'Mesh',
        observedResource: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Extrude Region',
          'Result Mesh',
          pendingResultMeshName,
        ],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_bmesh_ops_translate',
        sourceOperationId: 'operator.extrude_region_move',
        semanticAction: 'operator.extrude_region_move',
        valueSource: 'accepted_action_argument',
        actionArgument: 'translation',
        mutationKind: 'edit_extrude_region_translation_projection',
        acceptedTranslation: [0, 0, 1],
        observedTranslation: [0, 0, 1],
        translationObserved: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Extrude Region', 'Translation'],
      },
      {
        ...common,
        order: 3,
        executionMethod: 'blender_bmesh_ops_extrude_face_region',
        sourceOperationId: 'operator.extrude_region_move',
        semanticAction: 'operator.extrude_region_move',
        valueSource: 'managed_source_and_accepted_action_arguments',
        mutationKind: 'edit_extrude_region_mesh_content_write',
        sourceTopology: [8, 12, 6],
        selectedFaceCount: 1,
        selectedEdgeCount: 4,
        selectedVertexCount: 4,
        boundaryEdgeCount: 4,
        expectedTopology: [12, 20, 10],
        resultTopology: [12, 20, 10],
        sourceContentPreserved: true,
        resultContentObserved: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Extrude Region',
          'Apply BMesh Extrude Face Region',
        ],
      },
    ];
  }
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_name_write',
        sourceOperationId: 'semantic.managed_extrude_region_contract',
        semanticAction: 'semantic.managed_extrude_region_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'resultMeshName',
        mutationKind: 'edit_extrude_region_mesh_name_write',
        beforeName: pendingResultMeshName,
        acceptedName: 'OperatingLine.Body.Extruded',
        observedName: 'OperatingLine.Body.Extruded',
        uiPath: ['OperatingLine', 'Guided Control', 'Extrude Region', 'Result Mesh Name'],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_object_data_link_write',
        sourceOperationId: 'semantic.managed_extrude_region_contract',
        semanticAction: 'semantic.managed_extrude_region_contract',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_extrude_region_object_data_link_write',
        sourceMeshLogicalId: 'mesh.body.source',
        resultMeshLogicalId: 'mesh.body.extruded',
        observedLink: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Extrude Region', 'Object Data Link'],
      },
    ];
  }
  return [];
}

function editExtrudeRegionProgress(ordinal = 1) {
  const final = ordinal === editExtrudeRegionLeafOperationIds.length;
  const mutating = [5, 6].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'mesh.edit-extrude-region',
    actionName: 'blender.mesh.edit_extrude_region',
    recipeId: 'blender.mesh.edit_extrude_region.semantic',
    catalogVersion: '1.66.0',
    operationIds: editExtrudeRegionLeafOperationIds,
    completedOperationIds: editExtrudeRegionLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_edit_mesh_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: editExtrudeRegionLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'mesh.edit-extrude-region',
        actionName: 'blender.mesh.edit_extrude_region',
        recipeId: 'blender.mesh.edit_extrude_region.semantic',
        catalogVersion: '1.66.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeEditExtrudeRegion: final,
          editExtrudeRegionMeshOperations: editExtrudeRegionMeshOperations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function editPokeAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.body', resultMeshId: 'mesh.body.poked' }
      : ordinal === 5
        ? { offset: 0.2 }
        : ordinal === 6
          ? { resultMeshName: 'OperatingLine.Body.Poked' }
          : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.edit-poke', revision: 12 },
    leafId: 'mesh.edit-poke',
    stepId: 'mesh.edit-poke',
    actionName: 'blender.mesh.edit_poke_faces',
    recipeId: 'blender.mesh.edit_poke_faces.semantic',
    catalogVersion: '1.64.0',
    operationIds: editPokeLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: editPokeLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function editPokeDelivery(ordinal = 1) {
  return {
    ...editPokeAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

function editPokeMeshOperations(ordinal: number) {
  const common = {
    mcpTool: 'operatingline.blender.mesh.edit-poke-faces.execute-next',
    targetId: 'mesh.body',
    resultMeshId: 'mesh.body.poked',
  };
  const pendingResultMeshName = 'OperatingLine.PendingEditPokeMesh.99999999';
  if (ordinal === 5) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_copy',
        sourceOperationId: 'operator.poke_faces',
        semanticAction: 'operator.poke_faces',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_poke_mesh_create',
        pendingResultMeshName,
        resourceType: 'Mesh',
        observedResource: true,
        uiPath: [
          'OperatingLine',
          'Guided Control',
          'Poke Faces',
          'Result Mesh',
          pendingResultMeshName,
        ],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_bmesh_poke_argument_projection',
        sourceOperationId: 'operator.poke_faces',
        semanticAction: 'operator.poke_faces',
        valueSource: 'accepted_action_argument',
        actionArgument: 'offset',
        mutationKind: 'edit_poke_parameter_projection',
        parameterName: 'offset',
        acceptedValue: 0.2,
        projectedValue: 0.2,
        uiPath: ['Adjust Last Operation', 'Offset'],
      },
      {
        ...common,
        order: 3,
        executionMethod: 'blender_bmesh_ops_poke',
        sourceOperationId: 'operator.poke_faces',
        semanticAction: 'operator.poke_faces',
        valueSource: 'accepted_action_and_catalog_constants',
        mutationKind: 'edit_poke_mesh_content_write',
        fixedParameters: { centerMode: 'MEAN_WEIGHTED', useRelativeOffset: false },
        sourceTopology: [8, 12, 6],
        sourceLoopCount: 24,
        expectedTopology: [14, 36, 24],
        resultTopology: [14, 36, 24],
        sourceContentPreserved: true,
        resultContentObserved: true,
        allTriangles: true,
        resultNondegenerate: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Poke Faces', 'Apply BMesh Poke Faces'],
      },
    ];
  }
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mesh_name_write',
        sourceOperationId: 'semantic.managed_poke_faces_contract',
        semanticAction: 'semantic.managed_poke_faces_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'resultMeshName',
        mutationKind: 'edit_poke_mesh_name_write',
        beforeName: pendingResultMeshName,
        acceptedName: 'OperatingLine.Body.Poked',
        observedName: 'OperatingLine.Body.Poked',
        uiPath: ['OperatingLine', 'Guided Control', 'Poke Faces', 'Result Mesh Name'],
      },
      {
        ...common,
        order: 2,
        executionMethod: 'blender_rna_object_data_link_write',
        sourceOperationId: 'semantic.managed_poke_faces_contract',
        semanticAction: 'semantic.managed_poke_faces_contract',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'edit_poke_object_data_link_write',
        sourceMeshLogicalId: 'mesh.body.source',
        resultMeshLogicalId: 'mesh.body.poked',
        observedLink: true,
        uiPath: ['OperatingLine', 'Guided Control', 'Poke Faces', 'Object Data Link'],
      },
    ];
  }
  return [];
}

function editPokeProgress(ordinal = 1) {
  const final = ordinal === editPokeLeafOperationIds.length;
  const mutating = [5, 6].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'mesh.edit-poke',
    actionName: 'blender.mesh.edit_poke_faces',
    recipeId: 'blender.mesh.edit_poke_faces.semantic',
    catalogVersion: '1.64.0',
    operationIds: editPokeLeafOperationIds,
    completedOperationIds: editPokeLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_edit_mesh_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: editPokeLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'mesh.edit-poke',
        actionName: 'blender.mesh.edit_poke_faces',
        recipeId: 'blender.mesh.edit_poke_faces.semantic',
        catalogVersion: '1.64.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeEditPokeFaces: final,
          editPokeMeshOperations: editPokeMeshOperations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

function mirrorAuthority(ordinal = 1) {
  const operationParameters =
    ordinal === 1
      ? { targetId: 'mesh.half-shell', modifierId: 'modifier.mirror' }
      : ordinal === 7
        ? { modifierName: 'OperatingLine.Mirror', axis: 'Y' }
        : {};
  const base = {
    ...authority(1),
    plan: { id: 'youtube.mirror', revision: 8 },
    leafId: 'modifier.mirror',
    stepId: 'modifier.mirror',
    actionName: 'blender.modifier.add_mirror',
    recipeId: 'blender.modifier.add_mirror.semantic',
    catalogVersion: '1.60.0',
    operationIds: mirrorLeafOperationIds,
    operationOrdinal: ordinal,
    sourceOperationId: mirrorLeafOperationIds[ordinal - 1]!,
    operationParameters,
  } as const;
  return {
    ...base,
    operationBindingSha256: computeCompanionLeafOperationBindingSha256(base),
  };
}

function mirrorDelivery(ordinal = 1) {
  return {
    ...mirrorAuthority(ordinal),
    deliveryId: ids.deliveryId,
    requestedAt,
    dispatchedAt,
  } as const;
}

const mirrorPropertySpecs = [
  ['use_axis', 0, 'X', false, 'accepted_action_argument', 'axis'],
  ['use_axis', 1, 'Y', true, 'accepted_action_argument', 'axis'],
  ['use_axis', 2, 'Z', false, 'accepted_action_argument', 'axis'],
  ['use_bisect_axis', 0, 'X', false, 'catalog_constant', null],
  ['use_bisect_axis', 1, 'Y', false, 'catalog_constant', null],
  ['use_bisect_axis', 2, 'Z', false, 'catalog_constant', null],
  ['use_bisect_flip_axis', 0, 'X', false, 'catalog_constant', null],
  ['use_bisect_flip_axis', 1, 'Y', false, 'catalog_constant', null],
  ['use_bisect_flip_axis', 2, 'Z', false, 'catalog_constant', null],
  ['use_clip', null, null, false, 'catalog_constant', null],
  ['use_mirror_merge', null, null, true, 'catalog_constant', null],
  ['merge_threshold', null, null, 0.001, 'catalog_constant', null],
  ['bisect_threshold', null, null, 0.001, 'catalog_constant', null],
  ['mirror_object', null, null, null, 'catalog_constant', null],
  ['use_mirror_vertex_groups', null, null, true, 'catalog_constant', null],
  ['use_mirror_u', null, null, false, 'catalog_constant', null],
  ['use_mirror_v', null, null, false, 'catalog_constant', null],
  ['use_mirror_udim', null, null, false, 'catalog_constant', null],
  ['offset_u', null, null, 0, 'catalog_constant', null],
  ['offset_v', null, null, 0, 'catalog_constant', null],
  ['mirror_offset_u', null, null, 0, 'catalog_constant', null],
  ['mirror_offset_v', null, null, 0, 'catalog_constant', null],
  ['show_viewport', null, null, true, 'catalog_constant', null],
  ['show_render', null, null, true, 'catalog_constant', null],
  ['show_in_editmode', null, null, true, 'catalog_constant', null],
  ['show_on_cage', null, null, false, 'catalog_constant', null],
  ['use_apply_on_spline', null, null, false, 'catalog_constant', null],
] as const;

function mirrorRnaMutations(ordinal: number) {
  const pendingModifierName = 'OperatingLine.PendingMirrorModifier.99999999';
  const common = {
    mcpTool: 'operatingline.blender.modifier.mirror.execute-next',
    targetId: 'mesh.half-shell',
    modifierId: 'modifier.mirror',
  };
  if (ordinal === 6) {
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_mirror_modifier_create',
        sourceOperationId: 'modifier.mirror',
        semanticAction: 'modifier.mirror',
        valueSource: 'managed_receipt_identity',
        mutationKind: 'mirror_modifier_create',
        pendingModifierName,
        resourceType: 'MirrorModifier',
        modifierType: 'MIRROR',
        observedResource: true,
        uiPath: [
          'Properties',
          'mesh.half-shell',
          'Modifiers',
          'Add Modifier',
          'Generate',
          'Mirror',
          pendingModifierName,
        ],
      },
    ];
  }
  if (ordinal === 7) {
    const modifierName = 'OperatingLine.Mirror';
    return [
      {
        ...common,
        order: 1,
        executionMethod: 'blender_rna_modifier_name_write',
        sourceOperationId: 'semantic.mirror_contract',
        semanticAction: 'semantic.mirror_contract',
        valueSource: 'accepted_action_argument',
        actionArgument: 'modifierName',
        mutationKind: 'mirror_modifier_name_write',
        beforeName: pendingModifierName,
        acceptedName: modifierName,
        observedName: modifierName,
        uiPath: ['Properties', 'mesh.half-shell', 'Modifiers', modifierName, 'Name'],
      },
      ...mirrorPropertySpecs.map(
        (
          [
            propertyName,
            componentIndex,
            componentLabel,
            acceptedValue,
            valueSource,
            actionArgument,
          ],
          index,
        ) => ({
          ...common,
          order: index + 2,
          executionMethod: 'blender_rna_mirror_modifier_property_write',
          sourceOperationId: 'semantic.mirror_contract',
          semanticAction: 'semantic.mirror_contract',
          valueSource,
          actionArgument,
          mutationKind: 'mirror_modifier_property_write',
          modifierName,
          propertyName,
          ...(componentIndex === null ? {} : { componentIndex, componentLabel }),
          acceptedValue,
          observedValue:
            typeof acceptedValue === 'number' ? Math.fround(acceptedValue) : acceptedValue,
          uiPath: [
            'Properties',
            'mesh.half-shell',
            'Modifiers',
            modifierName,
            propertyName,
            ...(componentLabel === null ? [] : [componentLabel]),
          ],
        }),
      ),
    ];
  }
  return [];
}

function mirrorProgress(ordinal = 1) {
  const final = ordinal === mirrorLeafOperationIds.length;
  const mutating = [6, 7].includes(ordinal);
  return {
    runId: ids.runId,
    bindingSha256: '5'.repeat(64),
    stepId: 'modifier.mirror',
    actionName: 'blender.modifier.add_mirror',
    recipeId: 'blender.modifier.add_mirror.semantic',
    catalogVersion: '1.60.0',
    operationIds: mirrorLeafOperationIds,
    completedOperationIds: mirrorLeafOperationIds.slice(0, ordinal),
    nextOrdinal: ordinal + 1,
    latestObservation: {
      kind: 'guided_modifier_operation',
      satisfied: true,
      details: {
        status: 'passed',
        direction: 'forward',
        operationOrdinal: ordinal,
        operationId: mirrorLeafOperationIds[ordinal - 1]!,
        mutating,
        receiptId: ids.receiptId,
        runId: ids.runId,
        stepId: 'modifier.mirror',
        actionName: 'blender.modifier.add_mirror',
        recipeId: 'blender.modifier.add_mirror.semantic',
        catalogVersion: '1.60.0',
        beforeFingerprintSha256: '6'.repeat(64),
        afterFingerprintSha256: mutating ? '7'.repeat(64) : '6'.repeat(64),
        evidence: {
          completedOperations: Array.from({ length: ordinal }, (_, index) => index + 1),
          preconditionsValidated: ordinal === 1,
          completeMirror: final,
          rnaMirrorModifierMutations: mirrorRnaMutations(ordinal),
        },
      },
    },
    leafCompleted: final,
    finalReport: final ? { reportId: ids.finalReportId, sequence: 8 } : null,
  } as const;
}

describe('Companion leaf operation protocol', () => {
  it('accepts the exact seven-operation Mirror profile and strict component RNA mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(mirrorDelivery(7))).toEqual(
      mirrorDelivery(7),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6, 7]) {
      expect(companionLeafOperationProgressSchema.parse(mirrorProgress(ordinal))).toEqual(
        mirrorProgress(ordinal),
      );
    }
    expect(companionLeafOperationMirrorRnaMutationsSchema.parse(mirrorRnaMutations(6))).toEqual(
      mirrorRnaMutations(6),
    );
    expect(companionLeafOperationMirrorRnaMutationsSchema.parse(mirrorRnaMutations(7))).toEqual(
      mirrorRnaMutations(7),
    );
    const final = {
      ...mirrorDelivery(7),
      status: 'succeeded',
      progress: mirrorProgress(7),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const create = mirrorRnaMutations(6);
    const configured = mirrorRnaMutations(7);
    for (const invalid of [
      {
        ...mirrorProgress(5),
        latestObservation: {
          ...mirrorProgress(5).latestObservation,
          details: { ...mirrorProgress(5).latestObservation.details, mutating: true },
        },
      },
      {
        ...mirrorProgress(7),
        latestObservation: {
          ...mirrorProgress(7).latestObservation,
          details: {
            ...mirrorProgress(7).latestObservation.details,
            evidence: {
              ...mirrorProgress(7).latestObservation.details.evidence,
              completeMirror: false,
            },
          },
        },
      },
      {
        ...mirrorProgress(6),
        latestObservation: {
          ...mirrorProgress(6).latestObservation,
          details: {
            ...mirrorProgress(6).latestObservation.details,
            evidence: {
              ...mirrorProgress(6).latestObservation.details.evidence,
              rnaMirrorModifierMutations: create.map((mutation) => ({
                ...mutation,
                uiPath: [
                  'Properties',
                  'mesh.forged',
                  'Modifiers',
                  'Add Modifier',
                  'Generate',
                  'Mirror',
                  'OperatingLine.PendingMirrorModifier.99999999',
                ],
              })),
            },
          },
        },
      },
      {
        ...mirrorProgress(7),
        latestObservation: {
          ...mirrorProgress(7).latestObservation,
          details: {
            ...mirrorProgress(7).latestObservation.details,
            evidence: {
              ...mirrorProgress(7).latestObservation.details.evidence,
              rnaMirrorModifierMutations: configured.toReversed(),
            },
          },
        },
      },
      {
        ...mirrorProgress(7),
        latestObservation: {
          ...mirrorProgress(7).latestObservation,
          details: {
            ...mirrorProgress(7).latestObservation.details,
            evidence: {
              ...mirrorProgress(7).latestObservation.details.evidence,
              rnaMirrorModifierMutations: configured.map((mutation, index) =>
                index === 1 || index === 2
                  ? { ...mutation, acceptedValue: true, observedValue: true }
                  : mutation,
              ),
            },
          },
        },
      },
      {
        ...mirrorProgress(7),
        latestObservation: {
          ...mirrorProgress(7).latestObservation,
          details: {
            ...mirrorProgress(7).latestObservation.details,
            evidence: {
              ...mirrorProgress(7).latestObservation.details.evidence,
              rnaMirrorModifierMutations: configured.map((mutation, index) =>
                index === 3 ? { ...mutation, componentLabel: 'X' } : mutation,
              ),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact four-operation Solidify profile and strict RNA mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(solidifyDelivery(4))).toEqual(
      solidifyDelivery(4),
    );
    for (const ordinal of [1, 2, 3, 4]) {
      expect(companionLeafOperationProgressSchema.parse(solidifyProgress(ordinal))).toEqual(
        solidifyProgress(ordinal),
      );
    }
    expect(companionLeafOperationSolidifyRnaMutationsSchema.parse(solidifyRnaMutations(3))).toEqual(
      solidifyRnaMutations(3),
    );
    expect(companionLeafOperationSolidifyRnaMutationsSchema.parse(solidifyRnaMutations(4))).toEqual(
      solidifyRnaMutations(4),
    );
    const final = {
      ...solidifyDelivery(4),
      status: 'succeeded',
      progress: solidifyProgress(4),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const create = solidifyRnaMutations(3);
    const configured = solidifyRnaMutations(4);
    for (const invalid of [
      {
        ...solidifyProgress(2),
        latestObservation: {
          ...solidifyProgress(2).latestObservation,
          details: { ...solidifyProgress(2).latestObservation.details, mutating: true },
        },
      },
      {
        ...solidifyProgress(4),
        latestObservation: {
          ...solidifyProgress(4).latestObservation,
          details: {
            ...solidifyProgress(4).latestObservation.details,
            evidence: {
              ...solidifyProgress(4).latestObservation.details.evidence,
              completeSolidify: false,
            },
          },
        },
      },
      {
        ...solidifyProgress(3),
        latestObservation: {
          ...solidifyProgress(3).latestObservation,
          details: {
            ...solidifyProgress(3).latestObservation.details,
            evidence: {
              ...solidifyProgress(3).latestObservation.details.evidence,
              rnaSolidifyModifierMutations: create.map((mutation) => ({
                ...mutation,
                targetId: 'mesh.forged',
              })),
            },
          },
        },
      },
      {
        ...solidifyProgress(4),
        latestObservation: {
          ...solidifyProgress(4).latestObservation,
          details: {
            ...solidifyProgress(4).latestObservation.details,
            evidence: {
              ...solidifyProgress(4).latestObservation.details.evidence,
              rnaSolidifyModifierMutations: configured.toReversed(),
            },
          },
        },
      },
      {
        ...solidifyProgress(4),
        latestObservation: {
          ...solidifyProgress(4).latestObservation,
          details: {
            ...solidifyProgress(4).latestObservation.details,
            evidence: {
              ...solidifyProgress(4).latestObservation.details.evidence,
              rnaSolidifyModifierMutations: configured.map((mutation, index) =>
                index === 0 ? { ...mutation, observedName: 'OperatingLine.Forged' } : mutation,
              ),
            },
          },
        },
      },
      {
        ...solidifyProgress(4),
        latestObservation: {
          ...solidifyProgress(4).latestObservation,
          details: {
            ...solidifyProgress(4).latestObservation.details,
            evidence: {
              ...solidifyProgress(4).latestObservation.details.evidence,
              rnaSolidifyModifierMutations: configured.map((mutation, index) =>
                index === 2
                  ? { ...mutation, acceptedValue: '0.125', observedValue: '0.125' }
                  : mutation,
              ),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact four-operation Bevel Modifier profile and strict RNA mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(bevelModifierDelivery(4))).toEqual(
      bevelModifierDelivery(4),
    );
    for (const ordinal of [1, 2, 3, 4]) {
      expect(companionLeafOperationProgressSchema.parse(bevelModifierProgress(ordinal))).toEqual(
        bevelModifierProgress(ordinal),
      );
    }
    expect(
      companionLeafOperationBevelModifierRnaMutationsSchema.parse(bevelModifierRnaMutations(3)),
    ).toEqual(bevelModifierRnaMutations(3));
    expect(
      companionLeafOperationBevelModifierRnaMutationsSchema.parse(bevelModifierRnaMutations(4)),
    ).toEqual(bevelModifierRnaMutations(4));
    const final = {
      ...bevelModifierDelivery(4),
      status: 'succeeded',
      progress: bevelModifierProgress(4),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const create = bevelModifierRnaMutations(3);
    const configured = bevelModifierRnaMutations(4);
    for (const invalid of [
      {
        ...bevelModifierProgress(2),
        latestObservation: {
          ...bevelModifierProgress(2).latestObservation,
          details: { ...bevelModifierProgress(2).latestObservation.details, mutating: true },
        },
      },
      {
        ...bevelModifierProgress(4),
        latestObservation: {
          ...bevelModifierProgress(4).latestObservation,
          details: {
            ...bevelModifierProgress(4).latestObservation.details,
            evidence: {
              ...bevelModifierProgress(4).latestObservation.details.evidence,
              completeBevelModifier: false,
            },
          },
        },
      },
      {
        ...bevelModifierProgress(3),
        latestObservation: {
          ...bevelModifierProgress(3).latestObservation,
          details: {
            ...bevelModifierProgress(3).latestObservation.details,
            evidence: {
              ...bevelModifierProgress(3).latestObservation.details.evidence,
              rnaBevelModifierMutations: create.map((mutation) => ({
                ...mutation,
                targetId: 'mesh.forged',
              })),
            },
          },
        },
      },
      {
        ...bevelModifierProgress(4),
        latestObservation: {
          ...bevelModifierProgress(4).latestObservation,
          details: {
            ...bevelModifierProgress(4).latestObservation.details,
            evidence: {
              ...bevelModifierProgress(4).latestObservation.details.evidence,
              rnaBevelModifierMutations: configured.toReversed(),
            },
          },
        },
      },
      {
        ...bevelModifierProgress(4),
        latestObservation: {
          ...bevelModifierProgress(4).latestObservation,
          details: {
            ...bevelModifierProgress(4).latestObservation.details,
            evidence: {
              ...bevelModifierProgress(4).latestObservation.details.evidence,
              rnaBevelModifierMutations: configured.map((mutation, index) =>
                index === 3
                  ? { ...mutation, acceptedValue: 'WEIGHT', observedValue: 'WEIGHT' }
                  : mutation,
              ),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact four-operation material profile and strict RNA mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(singleMaterialDelivery(4))).toEqual(
      singleMaterialDelivery(4),
    );
    for (const ordinal of [1, 2, 3, 4]) {
      expect(companionLeafOperationProgressSchema.parse(singleMaterialProgress(ordinal))).toEqual(
        singleMaterialProgress(ordinal),
      );
    }
    expect(
      companionLeafOperationMaterialRnaMutationsSchema.parse(singleMaterialRnaMutations(3)),
    ).toEqual(singleMaterialRnaMutations(3));
    expect(
      companionLeafOperationMaterialRnaMutationsSchema.parse(singleMaterialRnaMutations(4)),
    ).toEqual(singleMaterialRnaMutations(4));
    const final = {
      ...singleMaterialDelivery(4),
      status: 'succeeded',
      progress: singleMaterialProgress(4),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const created = singleMaterialRnaMutations(3);
    const configured = singleMaterialRnaMutations(4);
    for (const invalid of [
      {
        ...singleMaterialProgress(2),
        latestObservation: {
          ...singleMaterialProgress(2).latestObservation,
          details: { ...singleMaterialProgress(2).latestObservation.details, mutating: true },
        },
      },
      {
        ...singleMaterialProgress(4),
        latestObservation: {
          ...singleMaterialProgress(4).latestObservation,
          details: {
            ...singleMaterialProgress(4).latestObservation.details,
            evidence: {
              ...singleMaterialProgress(4).latestObservation.details.evidence,
              completeSingleMaterial: false,
            },
          },
        },
      },
      {
        ...singleMaterialProgress(3),
        latestObservation: {
          ...singleMaterialProgress(3).latestObservation,
          details: {
            ...singleMaterialProgress(3).latestObservation.details,
            evidence: {
              ...singleMaterialProgress(3).latestObservation.details.evidence,
              rnaMaterialMutations: created.map((mutation, index) =>
                index === 1
                  ? {
                      ...mutation,
                      uiPath: [
                        'Shading',
                        'Material Properties',
                        'OperatingLine.PendingMaterial.forged000',
                        'Use Nodes',
                      ],
                    }
                  : mutation,
              ),
            },
          },
        },
      },
      {
        ...singleMaterialProgress(4),
        latestObservation: {
          ...singleMaterialProgress(4).latestObservation,
          details: {
            ...singleMaterialProgress(4).latestObservation.details,
            evidence: {
              ...singleMaterialProgress(4).latestObservation.details.evidence,
              rnaMaterialMutations: configured.toReversed(),
            },
          },
        },
      },
      {
        ...singleMaterialProgress(4),
        latestObservation: {
          ...singleMaterialProgress(4).latestObservation,
          details: {
            ...singleMaterialProgress(4).latestObservation.details,
            evidence: {
              ...singleMaterialProgress(4).latestObservation.details.evidence,
              rnaMaterialMutations: configured.map((mutation, index) =>
                index === 2 ? { ...mutation, actionArgument: 'roughness' } : mutation,
              ),
            },
          },
        },
      },
      {
        ...singleMaterialProgress(4),
        latestObservation: {
          ...singleMaterialProgress(4).latestObservation,
          details: {
            ...singleMaterialProgress(4).latestObservation.details,
            evidence: {
              ...singleMaterialProgress(4).latestObservation.details.evidence,
              rnaMaterialMutations: configured.map((mutation, index) =>
                index === configured.length - 1 ? { ...mutation, targetOrder: 1 } : mutation,
              ),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact atomic Material Palette profile and rejects reordered or forged evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(materialPaletteDelivery(3))).toEqual(
      materialPaletteDelivery(3),
    );
    for (const ordinal of [1, 2, 3, 4]) {
      expect(companionLeafOperationProgressSchema.parse(materialPaletteProgress(ordinal))).toEqual(
        materialPaletteProgress(ordinal),
      );
    }
    const mutations = materialPaletteRnaMutations(4);
    expect(companionLeafOperationMaterialPaletteRnaMutationsSchema.parse(mutations)).toEqual(
      mutations,
    );
    const final = {
      ...materialPaletteDelivery(4),
      status: 'succeeded',
      progress: materialPaletteProgress(4),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const secondMaterialStart = 14 + materialPaletteArguments.materials[0].targets.length;
    for (const invalidMutations of [
      [...mutations.slice(secondMaterialStart), ...mutations.slice(0, secondMaterialStart)],
      mutations.map((mutation, index) =>
        index === secondMaterialStart
          ? { ...mutation, materialId: materialPaletteArguments.materials[0].materialId }
          : mutation,
      ),
      mutations.map((mutation) =>
        mutation.mutationKind === 'palette_material_slot_replace' &&
        mutation.materialOrder === 1 &&
        mutation.targetOrder === 2
          ? { ...mutation, targetOrder: 1 }
          : mutation,
      ),
      mutations.map((mutation) =>
        mutation.mutationKind === 'palette_material_slot_replace' && mutation.materialOrder === 2
          ? {
              ...mutation,
              targetId: materialPaletteArguments.materials[0].targets[0],
              uiPath: [
                'Shading',
                'Material Properties',
                'Palette',
                2,
                materialPaletteArguments.materials[0].targets[0],
                'Material Slots',
                materialPaletteArguments.materials[1].materialName,
              ],
            }
          : mutation,
      ),
    ]) {
      const invalid = {
        ...materialPaletteProgress(4),
        latestObservation: {
          ...materialPaletteProgress(4).latestObservation,
          details: {
            ...materialPaletteProgress(4).latestObservation.details,
            evidence: {
              ...materialPaletteProgress(4).latestObservation.details.evidence,
              rnaMaterialPaletteMutations: invalidMutations,
            },
          },
        },
      };
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }

    const preMutationForgery = {
      ...materialPaletteProgress(3),
      latestObservation: {
        ...materialPaletteProgress(3).latestObservation,
        details: {
          ...materialPaletteProgress(3).latestObservation.details,
          evidence: {
            ...materialPaletteProgress(3).latestObservation.details.evidence,
            rnaMaterialPaletteMutations: mutations,
          },
        },
      },
    };
    expect(companionLeafOperationProgressSchema.safeParse(preMutationForgery).success).toBe(false);
  });

  it('accepts the exact four-operation Subdivision Surface profile and strict RNA mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(subdivisionSurfaceDelivery(4))).toEqual(
      subdivisionSurfaceDelivery(4),
    );
    for (const ordinal of [1, 2, 3, 4]) {
      expect(
        companionLeafOperationProgressSchema.parse(subdivisionSurfaceProgress(ordinal)),
      ).toEqual(subdivisionSurfaceProgress(ordinal));
    }
    expect(
      companionLeafOperationSubdivisionSurfaceRnaMutationsSchema.parse(
        subdivisionSurfaceRnaMutations(3),
      ),
    ).toEqual(subdivisionSurfaceRnaMutations(3));
    expect(
      companionLeafOperationSubdivisionSurfaceRnaMutationsSchema.parse(
        subdivisionSurfaceRnaMutations(4),
      ),
    ).toEqual(subdivisionSurfaceRnaMutations(4));
    const final = {
      ...subdivisionSurfaceDelivery(4),
      status: 'succeeded',
      progress: subdivisionSurfaceProgress(4),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    const create = subdivisionSurfaceRnaMutations(3);
    const configured = subdivisionSurfaceRnaMutations(4);
    for (const invalid of [
      {
        ...subdivisionSurfaceProgress(2),
        latestObservation: {
          ...subdivisionSurfaceProgress(2).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(2).latestObservation.details,
            mutating: true,
          },
        },
      },
      {
        ...subdivisionSurfaceProgress(4),
        latestObservation: {
          ...subdivisionSurfaceProgress(4).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(4).latestObservation.details,
            evidence: {
              ...subdivisionSurfaceProgress(4).latestObservation.details.evidence,
              completeSubdivisionSurface: false,
            },
          },
        },
      },
      {
        ...subdivisionSurfaceProgress(3),
        latestObservation: {
          ...subdivisionSurfaceProgress(3).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(3).latestObservation.details,
            evidence: {
              ...subdivisionSurfaceProgress(3).latestObservation.details.evidence,
              rnaSubdivisionSurfaceModifierMutations: create.map((mutation) => ({
                ...mutation,
                targetId: 'mesh.forged',
              })),
            },
          },
        },
      },
      {
        ...subdivisionSurfaceProgress(4),
        latestObservation: {
          ...subdivisionSurfaceProgress(4).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(4).latestObservation.details,
            evidence: {
              ...subdivisionSurfaceProgress(4).latestObservation.details.evidence,
              rnaSubdivisionSurfaceModifierMutations: configured.toReversed(),
            },
          },
        },
      },
      {
        ...subdivisionSurfaceProgress(4),
        latestObservation: {
          ...subdivisionSurfaceProgress(4).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(4).latestObservation.details,
            evidence: {
              ...subdivisionSurfaceProgress(4).latestObservation.details.evidence,
              rnaSubdivisionSurfaceModifierMutations: configured.map((mutation, index) =>
                index === 0 ? { ...mutation, observedName: 'OperatingLine.Forged' } : mutation,
              ),
            },
          },
        },
      },
      {
        ...subdivisionSurfaceProgress(4),
        latestObservation: {
          ...subdivisionSurfaceProgress(4).latestObservation,
          details: {
            ...subdivisionSurfaceProgress(4).latestObservation.details,
            evidence: {
              ...subdivisionSurfaceProgress(4).latestObservation.details.evidence,
              rnaSubdivisionSurfaceModifierMutations: configured.map((mutation, index) =>
                index === 2 ? { ...mutation, acceptedValue: 4, observedValue: 4 } : mutation,
              ),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact six-operation Edit Bevel profile and rejects forged mesh evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(editBevelDelivery(6))).toEqual(
      editBevelDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6]) {
      expect(companionLeafOperationProgressSchema.parse(editBevelProgress(ordinal))).toEqual(
        editBevelProgress(ordinal),
      );
    }
    const bevel = editBevelMeshOperations(5);
    const contract = editBevelMeshOperations(6);
    expect(companionLeafOperationEditBevelMeshOperationsSchema.parse(bevel)).toEqual(bevel);
    expect(companionLeafOperationEditBevelMeshOperationsSchema.parse(contract)).toEqual(contract);
    const final = {
      ...editBevelDelivery(6),
      status: 'succeeded',
      progress: editBevelProgress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    for (const invalidOperations of [
      bevel.map((operation) =>
        operation.mutationKind === 'edit_bevel_parameter_projection' && operation.order === 2
          ? { ...operation, parameterName: 'profile' }
          : operation,
      ),
      bevel.map((operation) =>
        operation.mutationKind === 'edit_bevel_mesh_content_write'
          ? { ...operation, resultTopology: [8, 12, 6] }
          : operation,
      ),
      bevel.map((operation) =>
        operation.mutationKind === 'edit_bevel_mesh_content_write'
          ? { ...operation, fixedParameters: { ...operation.fixedParameters, spread: 0.2 } }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_bevel_mesh_name_write'
          ? { ...operation, observedName: 'OperatingLine.Forged' }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_bevel_object_data_link_write'
          ? { ...operation, resultMeshLogicalId: 'mesh.forged' }
          : operation,
      ),
      contract.toReversed(),
    ]) {
      expect(
        companionLeafOperationEditBevelMeshOperationsSchema.safeParse(invalidOperations).success,
      ).toBe(false);
    }

    for (const invalidProgress of [
      {
        ...editBevelProgress(4),
        latestObservation: {
          ...editBevelProgress(4).latestObservation,
          details: { ...editBevelProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...editBevelProgress(6),
        latestObservation: {
          ...editBevelProgress(6).latestObservation,
          details: {
            ...editBevelProgress(6).latestObservation.details,
            evidence: {
              ...editBevelProgress(6).latestObservation.details.evidence,
              completeEditBevelEdges: false,
            },
          },
        },
      },
      {
        ...editBevelProgress(1),
        latestObservation: {
          ...editBevelProgress(1).latestObservation,
          details: {
            ...editBevelProgress(1).latestObservation.details,
            evidence: {
              completedOperations: [1],
              preconditionsValidated: true,
              completeEditBevelEdges: false,
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalidProgress).success).toBe(false);
    }
  });

  it('accepts the exact six-operation Edit Inset profile and rejects forged topology evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(editInsetDelivery(6))).toEqual(
      editInsetDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6]) {
      expect(companionLeafOperationProgressSchema.parse(editInsetProgress(ordinal))).toEqual(
        editInsetProgress(ordinal),
      );
    }
    const inset = editInsetMeshOperations(5);
    const contract = editInsetMeshOperations(6);
    expect(companionLeafOperationEditInsetMeshOperationsSchema.parse(inset)).toEqual(inset);
    expect(companionLeafOperationEditInsetMeshOperationsSchema.parse(contract)).toEqual(contract);
    const final = {
      ...editInsetDelivery(6),
      status: 'succeeded',
      progress: editInsetProgress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    for (const invalidOperations of [
      inset.map((operation) =>
        operation.mutationKind === 'edit_inset_parameter_projection' && operation.order === 2
          ? { ...operation, projectedValue: 0.3 }
          : operation,
      ),
      inset.map((operation) =>
        operation.mutationKind === 'edit_inset_mesh_content_write'
          ? { ...operation, expectedTopology: [31, 60, 30] }
          : operation,
      ),
      inset.map((operation) =>
        operation.mutationKind === 'edit_inset_mesh_content_write'
          ? { ...operation, resultNondegenerate: false }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_inset_mesh_name_write'
          ? { ...operation, observedName: 'OperatingLine.Forged' }
          : operation,
      ),
      contract.toReversed(),
    ]) {
      expect(
        companionLeafOperationEditInsetMeshOperationsSchema.safeParse(invalidOperations).success,
      ).toBe(false);
    }

    for (const invalidProgress of [
      {
        ...editInsetProgress(4),
        latestObservation: {
          ...editInsetProgress(4).latestObservation,
          details: { ...editInsetProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...editInsetProgress(6),
        latestObservation: {
          ...editInsetProgress(6).latestObservation,
          details: {
            ...editInsetProgress(6).latestObservation.details,
            evidence: {
              ...editInsetProgress(6).latestObservation.details.evidence,
              completeEditInsetFaces: false,
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalidProgress).success).toBe(false);
    }
  });

  it('accepts the exact six-operation Edit Triangulate profile and rejects forged topology evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(editTriangulateDelivery(6))).toEqual(
      editTriangulateDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6]) {
      expect(companionLeafOperationProgressSchema.parse(editTriangulateProgress(ordinal))).toEqual(
        editTriangulateProgress(ordinal),
      );
    }
    const triangulate = editTriangulateMeshOperations(5);
    const contract = editTriangulateMeshOperations(6);
    expect(companionLeafOperationEditTriangulateMeshOperationsSchema.parse(triangulate)).toEqual(
      triangulate,
    );
    expect(companionLeafOperationEditTriangulateMeshOperationsSchema.parse(contract)).toEqual(
      contract,
    );
    const final = {
      ...editTriangulateDelivery(6),
      status: 'succeeded',
      progress: editTriangulateProgress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    for (const invalidOperations of [
      triangulate.map((operation) =>
        operation.mutationKind === 'edit_triangulate_mesh_content_write'
          ? { ...operation, expectedTopology: [8, 19, 12] }
          : operation,
      ),
      triangulate.map((operation) =>
        operation.mutationKind === 'edit_triangulate_mesh_content_write'
          ? { ...operation, fixedParameters: { quadMethod: 'BEAUTY', ngonMethod: 'EAR_CLIP' } }
          : operation,
      ),
      triangulate.map((operation) =>
        operation.mutationKind === 'edit_triangulate_mesh_content_write'
          ? { ...operation, allTriangles: false }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_triangulate_mesh_name_write'
          ? { ...operation, observedName: 'OperatingLine.Forged' }
          : operation,
      ),
      contract.toReversed(),
    ]) {
      expect(
        companionLeafOperationEditTriangulateMeshOperationsSchema.safeParse(invalidOperations)
          .success,
      ).toBe(false);
    }

    for (const invalidProgress of [
      {
        ...editTriangulateProgress(4),
        latestObservation: {
          ...editTriangulateProgress(4).latestObservation,
          details: { ...editTriangulateProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...editTriangulateProgress(6),
        latestObservation: {
          ...editTriangulateProgress(6).latestObservation,
          details: {
            ...editTriangulateProgress(6).latestObservation.details,
            evidence: {
              ...editTriangulateProgress(6).latestObservation.details.evidence,
              completeEditTriangulate: false,
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalidProgress).success).toBe(false);
    }
  });

  it('accepts the exact six-operation Extrude Region profile and rejects forged selection, translation, and topology evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(editExtrudeRegionDelivery(6))).toEqual(
      editExtrudeRegionDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6]) {
      expect(
        companionLeafOperationProgressSchema.parse(editExtrudeRegionProgress(ordinal)),
      ).toEqual(editExtrudeRegionProgress(ordinal));
    }
    const selection = editExtrudeRegionMeshOperations(4);
    const extrusion = editExtrudeRegionMeshOperations(5);
    const contract = editExtrudeRegionMeshOperations(6);
    expect(companionLeafOperationEditExtrudeRegionMeshOperationsSchema.parse(selection)).toEqual(
      selection,
    );
    expect(companionLeafOperationEditExtrudeRegionMeshOperationsSchema.parse(extrusion)).toEqual(
      extrusion,
    );
    expect(companionLeafOperationEditExtrudeRegionMeshOperationsSchema.parse(contract)).toEqual(
      contract,
    );
    const final = {
      ...editExtrudeRegionDelivery(6),
      status: 'succeeded',
      progress: editExtrudeRegionProgress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    for (const invalidOperations of [
      selection.map((operation) => ({ ...operation, observedPolygonIndices: [2] })),
      extrusion.map((operation) =>
        operation.mutationKind === 'edit_extrude_region_translation_projection'
          ? { ...operation, observedTranslation: [0, 0, 2] }
          : operation,
      ),
      extrusion.map((operation) =>
        operation.mutationKind === 'edit_extrude_region_mesh_content_write'
          ? { ...operation, expectedTopology: [12, 21, 10] }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_extrude_region_mesh_name_write'
          ? { ...operation, observedName: 'OperatingLine.Forged' }
          : operation,
      ),
      contract.toReversed(),
    ]) {
      expect(
        companionLeafOperationEditExtrudeRegionMeshOperationsSchema.safeParse(invalidOperations)
          .success,
      ).toBe(false);
    }

    for (const invalidProgress of [
      {
        ...editExtrudeRegionProgress(4),
        latestObservation: {
          ...editExtrudeRegionProgress(4).latestObservation,
          details: { ...editExtrudeRegionProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...editExtrudeRegionProgress(6),
        latestObservation: {
          ...editExtrudeRegionProgress(6).latestObservation,
          details: {
            ...editExtrudeRegionProgress(6).latestObservation.details,
            evidence: {
              ...editExtrudeRegionProgress(6).latestObservation.details.evidence,
              completeEditExtrudeRegion: false,
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalidProgress).success).toBe(false);
    }
  });

  it('accepts the exact six-operation Edit Poke profile and rejects forged topology evidence', () => {
    expect(companionLeafOperationDeliverySchema.parse(editPokeDelivery(6))).toEqual(
      editPokeDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 5, 6]) {
      expect(companionLeafOperationProgressSchema.parse(editPokeProgress(ordinal))).toEqual(
        editPokeProgress(ordinal),
      );
    }
    const poke = editPokeMeshOperations(5);
    const contract = editPokeMeshOperations(6);
    expect(companionLeafOperationEditPokeMeshOperationsSchema.parse(poke)).toEqual(poke);
    expect(companionLeafOperationEditPokeMeshOperationsSchema.parse(contract)).toEqual(contract);
    const final = {
      ...editPokeDelivery(6),
      status: 'succeeded',
      progress: editPokeProgress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);

    for (const invalidOperations of [
      poke.map((operation) =>
        operation.mutationKind === 'edit_poke_parameter_projection'
          ? { ...operation, projectedValue: 0.3 }
          : operation,
      ),
      poke.map((operation) =>
        operation.mutationKind === 'edit_poke_mesh_content_write'
          ? { ...operation, expectedTopology: [15, 36, 24] }
          : operation,
      ),
      poke.map((operation) =>
        operation.mutationKind === 'edit_poke_mesh_content_write'
          ? { ...operation, allTriangles: false }
          : operation,
      ),
      poke.map((operation) =>
        operation.mutationKind === 'edit_poke_mesh_content_write'
          ? { ...operation, resultNondegenerate: false }
          : operation,
      ),
      contract.map((operation) =>
        operation.mutationKind === 'edit_poke_mesh_name_write'
          ? { ...operation, observedName: 'OperatingLine.Forged' }
          : operation,
      ),
      contract.toReversed(),
    ]) {
      expect(
        companionLeafOperationEditPokeMeshOperationsSchema.safeParse(invalidOperations).success,
      ).toBe(false);
    }

    for (const invalidProgress of [
      {
        ...editPokeProgress(4),
        latestObservation: {
          ...editPokeProgress(4).latestObservation,
          details: { ...editPokeProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...editPokeProgress(6),
        latestObservation: {
          ...editPokeProgress(6).latestObservation,
          details: {
            ...editPokeProgress(6).latestObservation.details,
            evidence: {
              ...editPokeProgress(6).latestObservation.details.evidence,
              completeEditPokeFaces: false,
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalidProgress).success).toBe(false);
    }
  });

  it('accepts the exact nine-operation Skin Weights profile and sparse mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(skinWeightsDelivery(5))).toEqual(
      skinWeightsDelivery(5),
    );
    for (const ordinal of [1, 2, 4, 5, 7, 8, 9]) {
      expect(companionLeafOperationProgressSchema.parse(skinWeightsProgress(ordinal))).toEqual(
        skinWeightsProgress(ordinal),
      );
    }
    expect(
      companionLeafOperationSkinRnaWeightMutationsSchema.parse(skinRnaWeightMutations(5)),
    ).toEqual(skinRnaWeightMutations(5));
    expect(
      companionLeafOperationSkinRnaModifierMutationsSchema.parse(skinRnaModifierMutations(7)),
    ).toEqual(skinRnaModifierMutations(7));
    expect(
      companionLeafOperationSkinRnaModifierMutationsSchema.parse(skinRnaModifierMutations(8)),
    ).toEqual(skinRnaModifierMutations(8));
    const final = {
      ...skinWeightsDelivery(9),
      status: 'succeeded',
      progress: skinWeightsProgress(9),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);
    for (const invalid of [
      {
        ...skinWeightsProgress(4),
        latestObservation: {
          ...skinWeightsProgress(4).latestObservation,
          details: { ...skinWeightsProgress(4).latestObservation.details, mutating: true },
        },
      },
      {
        ...skinWeightsProgress(9),
        latestObservation: {
          ...skinWeightsProgress(9).latestObservation,
          details: {
            ...skinWeightsProgress(9).latestObservation.details,
            evidence: {
              ...skinWeightsProgress(9).latestObservation.details.evidence,
              completeSkinWeights: false,
            },
          },
        },
      },
      {
        ...skinWeightsProgress(5),
        latestObservation: {
          ...skinWeightsProgress(5).latestObservation,
          details: {
            ...skinWeightsProgress(5).latestObservation.details,
            evidence: {
              ...skinWeightsProgress(5).latestObservation.details.evidence,
              rnaSkinWeightMutations: skinRnaWeightMutations(5).toReversed(),
            },
          },
        },
      },
      {
        ...skinWeightsProgress(5),
        latestObservation: {
          ...skinWeightsProgress(5).latestObservation,
          details: {
            ...skinWeightsProgress(5).latestObservation.details,
            evidence: {
              ...skinWeightsProgress(5).latestObservation.details.evidence,
              rnaSkinWeightMutations: skinRnaWeightMutations(5).map((mutation, index) =>
                index === 2 ? { ...mutation, observedWeight: 0.5 } : mutation,
              ),
            },
          },
        },
      },
      {
        ...skinWeightsProgress(7),
        latestObservation: {
          ...skinWeightsProgress(7).latestObservation,
          details: {
            ...skinWeightsProgress(7).latestObservation.details,
            evidence: {
              ...skinWeightsProgress(7).latestObservation.details.evidence,
              rnaSkinModifierMutations: skinRnaModifierMutations(7).toReversed(),
            },
          },
        },
      },
      {
        ...skinWeightsProgress(8),
        latestObservation: {
          ...skinWeightsProgress(8).latestObservation,
          details: {
            ...skinWeightsProgress(8).latestObservation.details,
            evidence: {
              ...skinWeightsProgress(8).latestObservation.details.evidence,
              rnaSkinModifierMutations: skinRnaModifierMutations(8).map((mutation) => ({
                ...mutation,
                observedName: 'OperatingLine.ForgedSkin',
              })),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact nine-operation Armature profile and sparse mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(armatureDelivery(6))).toEqual(
      armatureDelivery(6),
    );
    for (const ordinal of [1, 2, 3, 4, 6, 8, 9]) {
      expect(companionLeafOperationProgressSchema.parse(armatureProgress(ordinal))).toEqual(
        armatureProgress(ordinal),
      );
    }
    expect(
      companionLeafOperationArmatureRnaResourceMutationsSchema.parse(
        armatureRnaResourceMutations(2),
      ),
    ).toEqual(armatureRnaResourceMutations(2));
    expect(
      companionLeafOperationArmatureRnaBoneMutationsSchema.parse(armatureRnaBoneMutations(6)),
    ).toEqual(armatureRnaBoneMutations(6));
    expect(
      companionLeafOperationArmatureRnaBindingMutationsSchema.parse(armatureRnaBindingMutations(8)),
    ).toEqual(armatureRnaBindingMutations(8));
    const final = {
      ...armatureDelivery(9),
      status: 'succeeded',
      progress: armatureProgress(9),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);
    for (const invalid of [
      {
        ...armatureProgress(5),
        latestObservation: {
          ...armatureProgress(5).latestObservation,
          details: { ...armatureProgress(5).latestObservation.details, mutating: true },
        },
      },
      {
        ...armatureProgress(9),
        latestObservation: {
          ...armatureProgress(9).latestObservation,
          details: {
            ...armatureProgress(9).latestObservation.details,
            evidence: {
              ...armatureProgress(9).latestObservation.details.evidence,
              completeArmature: false,
            },
          },
        },
      },
      {
        ...armatureProgress(2),
        latestObservation: {
          ...armatureProgress(2).latestObservation,
          details: {
            ...armatureProgress(2).latestObservation.details,
            evidence: {
              ...armatureProgress(2).latestObservation.details.evidence,
              rnaArmatureResourceMutations: armatureRnaResourceMutations(2).toReversed(),
            },
          },
        },
      },
      {
        ...armatureProgress(6),
        latestObservation: {
          ...armatureProgress(6).latestObservation,
          details: {
            ...armatureProgress(6).latestObservation.details,
            evidence: {
              ...armatureProgress(6).latestObservation.details.evidence,
              rnaArmatureBoneMutations: armatureRnaBoneMutations(6).toReversed(),
            },
          },
        },
      },
      {
        ...armatureProgress(8),
        latestObservation: {
          ...armatureProgress(8).latestObservation,
          details: {
            ...armatureProgress(8).latestObservation.details,
            evidence: {
              ...armatureProgress(8).latestObservation.details.evidence,
              rnaArmatureBindingMutations: [
                {
                  ...armatureRnaBindingMutations(8)[0],
                  observedParentBone: 'OperatingLine.Root',
                },
              ],
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact 12-operation Pose Animation profile and its sparse mutations', () => {
    expect(companionLeafOperationDeliverySchema.parse(poseAnimationDelivery(7))).toEqual(
      poseAnimationDelivery(7),
    );
    for (const ordinal of [1, 2, 4, 5, 7, 9, 11, 12]) {
      expect(companionLeafOperationProgressSchema.parse(poseAnimationProgress(ordinal))).toEqual(
        poseAnimationProgress(ordinal),
      );
    }
    expect(
      companionLeafOperationPoseRnaKeyframeInsertionsSchema.parse(poseRnaKeyframeInsertions(7)),
    ).toEqual(poseRnaKeyframeInsertions(7));
    expect(
      companionLeafOperationPoseRnaAnimationPropertyWritesSchema.parse(
        poseRnaAnimationPropertyWrites(9),
      ),
    ).toEqual(poseRnaAnimationPropertyWrites(9));
    expect(
      companionLeafOperationPoseRnaAnimationPropertyWritesSchema.parse(
        poseRnaAnimationPropertyWrites(11),
      ),
    ).toEqual(poseRnaAnimationPropertyWrites(11));
    expect(
      companionLeafOperationPoseRnaActionResourceMutationsSchema.parse(
        poseRnaActionResourceMutations(4),
      ),
    ).toEqual(poseRnaActionResourceMutations(4));
    expect(
      companionLeafOperationPoseRnaActionResourceMutationsSchema.parse(
        poseRnaActionResourceMutations(5),
      ),
    ).toEqual(poseRnaActionResourceMutations(5));
    const final = {
      ...poseAnimationDelivery(12),
      status: 'succeeded',
      progress: poseAnimationProgress(12),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);
    for (const invalid of [
      {
        ...poseAnimationProgress(2),
        latestObservation: {
          ...poseAnimationProgress(2).latestObservation,
          details: { ...poseAnimationProgress(2).latestObservation.details, mutating: true },
        },
      },
      {
        ...poseAnimationProgress(4),
        latestObservation: {
          ...poseAnimationProgress(4).latestObservation,
          kind: 'guided_geometry_operation',
        },
      },
      {
        ...poseAnimationProgress(12),
        latestObservation: {
          ...poseAnimationProgress(12).latestObservation,
          details: {
            ...poseAnimationProgress(12).latestObservation.details,
            evidence: {
              ...poseAnimationProgress(12).latestObservation.details.evidence,
              completeAnimation: false,
            },
          },
        },
      },
      {
        ...poseAnimationProgress(7),
        latestObservation: {
          ...poseAnimationProgress(7).latestObservation,
          details: {
            ...poseAnimationProgress(7).latestObservation.details,
            evidence: {
              ...poseAnimationProgress(7).latestObservation.details.evidence,
              rnaKeyframeInsertions: poseRnaKeyframeInsertions(7).toReversed(),
            },
          },
        },
      },
      {
        ...poseAnimationProgress(9),
        latestObservation: {
          ...poseAnimationProgress(9).latestObservation,
          details: {
            ...poseAnimationProgress(9).latestObservation.details,
            evidence: {
              ...poseAnimationProgress(9).latestObservation.details.evidence,
              rnaAnimationPropertyWrites: poseRnaAnimationPropertyWrites(9).toReversed(),
            },
          },
        },
      },
      {
        ...poseAnimationProgress(4),
        latestObservation: {
          ...poseAnimationProgress(4).latestObservation,
          details: {
            ...poseAnimationProgress(4).latestObservation.details,
            evidence: {
              ...poseAnimationProgress(4).latestObservation.details.evidence,
              rnaActionResourceMutations: poseRnaActionResourceMutations(4).toReversed(),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the exact 54-operation Light Trails profile without weakening profile binding', () => {
    expect(companionLeafOperationDeliverySchema.parse(lightTrailsDelivery(5))).toEqual(
      lightTrailsDelivery(5),
    );
    expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(1))).toEqual(
      lightTrailsProgress(1),
    );
    expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(53))).toEqual(
      lightTrailsProgress(53),
    );
    expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(54))).toEqual(
      lightTrailsProgress(54),
    );
    expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(2))).toEqual(
      lightTrailsProgress(2),
    );
    expect(
      companionLeafOperationRnaResourceMutationsSchema.parse(lightTrailsRnaResourceMutations(2)),
    ).toEqual(lightTrailsRnaResourceMutations(2));
    for (const ordinal of [24, 30]) {
      expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(ordinal))).toEqual(
        lightTrailsProgress(ordinal),
      );
      expect(
        companionLeafOperationRnaInitializationWritesSchema.parse(
          lightTrailsRnaInitializationWrites(ordinal),
        ),
      ).toEqual(lightTrailsRnaInitializationWrites(ordinal));
    }
    for (const [ordinal] of lightTrailsStructureTargets) {
      expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(ordinal))).toEqual(
        lightTrailsProgress(ordinal),
      );
      expect(
        companionLeafOperationRnaStructureCreationsSchema.parse(
          lightTrailsRnaStructureCreations(ordinal),
        ),
      ).toEqual(lightTrailsRnaStructureCreations(ordinal));
    }
    for (let ordinal = 35; ordinal <= 53; ordinal += 1) {
      expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(ordinal))).toEqual(
        lightTrailsProgress(ordinal),
      );
      expect(
        companionLeafOperationRnaLinkCreationsSchema.parse(lightTrailsRnaLinkCreations(ordinal)),
      ).toEqual(lightTrailsRnaLinkCreations(ordinal));
    }
    for (const ordinal of [5, 7, 9, 10, 15, 16, 17, 18, 21, 27, 28, 31]) {
      expect(companionLeafOperationDeliverySchema.parse(lightTrailsDelivery(ordinal))).toEqual(
        lightTrailsDelivery(ordinal),
      );
      expect(companionLeafOperationProgressSchema.parse(lightTrailsProgress(ordinal))).toEqual(
        lightTrailsProgress(ordinal),
      );
      const parameterResult = {
        ...lightTrailsDelivery(ordinal),
        status: 'succeeded',
        progress: lightTrailsProgress(ordinal),
        error: null,
        occurredAt,
      } as const;
      expect(companionLeafOperationResultSchema.parse(parameterResult)).toEqual(parameterResult);
    }
    const final = {
      ...lightTrailsDelivery(54),
      status: 'succeeded',
      progress: lightTrailsProgress(54),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);
    for (const invalid of [
      {
        ...lightTrailsDelivery(5),
        recipeId: 'blender.geometry_nodes.create_transform.semantic',
      },
      { ...lightTrailsDelivery(5), operationIds: transformGeometryLeafOperationIds },
      { ...lightTrailsProgress(54), leafCompleted: false },
      { ...lightTrailsProgress(53), finalReport: { reportId: ids.finalReportId, sequence: 8 } },
      {
        ...lightTrailsProgress(9),
        latestObservation: {
          ...lightTrailsProgress(9).latestObservation,
          details: {
            ...lightTrailsProgress(9).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(9).latestObservation.details.evidence,
              rnaControlWrites: lightTrailsRnaControlWrites(9).toReversed(),
            },
          },
        },
      },
      {
        ...lightTrailsProgress(5),
        latestObservation: {
          ...lightTrailsProgress(5).latestObservation,
          details: {
            ...lightTrailsProgress(5).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(5).latestObservation.details.evidence,
              rnaControlWrites: [
                {
                  ...lightTrailsRnaControlWrites(5)[0]!,
                  nodeName: 'OperatingLine Trail Rows',
                  nodeType: 'GeometryNodeMeshLine',
                  socketIdentifier: 'Count',
                  valueKind: 'scalar',
                  componentIndex: null,
                  componentLabel: null,
                  projection: 'identity',
                  uiPath: [
                    'Geometry Nodes',
                    'OperatingLine.LightTrailsNodes',
                    'OperatingLine Trail Rows',
                    'Count',
                    'Value',
                  ],
                },
              ],
            },
          },
        },
      },
      {
        ...lightTrailsProgress(24),
        latestObservation: {
          ...lightTrailsProgress(24).latestObservation,
          details: {
            ...lightTrailsProgress(24).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(24).latestObservation.details.evidence,
              rnaInitializationWrites: lightTrailsRnaInitializationWrites(24).slice(0, 2),
            },
          },
        },
      },
      {
        ...lightTrailsProgress(2),
        latestObservation: {
          ...lightTrailsProgress(2).latestObservation,
          details: {
            ...lightTrailsProgress(2).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(2).latestObservation.details.evidence,
              rnaResourceMutations: lightTrailsRnaResourceMutations(2).toReversed(),
            },
          },
        },
      },
      {
        ...lightTrailsProgress(30),
        latestObservation: {
          ...lightTrailsProgress(30).latestObservation,
          details: {
            ...lightTrailsProgress(30).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(30).latestObservation.details.evidence,
              rnaInitializationWrites: lightTrailsRnaInitializationWrites(30).toReversed(),
            },
          },
        },
      },
      {
        ...lightTrailsProgress(35),
        latestObservation: {
          ...lightTrailsProgress(35).latestObservation,
          details: {
            ...lightTrailsProgress(35).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(35).latestObservation.details.evidence,
              rnaLinkCreations: [],
            },
          },
        },
      },
      {
        ...lightTrailsProgress(53),
        latestObservation: {
          ...lightTrailsProgress(53).latestObservation,
          details: {
            ...lightTrailsProgress(53).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(53).latestObservation.details.evidence,
              rnaLinkCreations: [
                {
                  ...lightTrailsRnaLinkCreations(53)[0]!,
                  toNodeName: 'OperatingLine Trail Resolution',
                },
              ],
            },
          },
        },
      },
      {
        ...lightTrailsProgress(3),
        latestObservation: {
          ...lightTrailsProgress(3).latestObservation,
          details: {
            ...lightTrailsProgress(3).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(3).latestObservation.details.evidence,
              rnaStructureCreations: lightTrailsRnaStructureCreations(3).toReversed(),
            },
          },
        },
      },
      {
        ...lightTrailsProgress(24),
        latestObservation: {
          ...lightTrailsProgress(24).latestObservation,
          details: {
            ...lightTrailsProgress(24).latestObservation.details,
            evidence: {
              ...lightTrailsProgress(24).latestObservation.details.evidence,
              rnaStructureCreations: [
                {
                  ...lightTrailsRnaStructureCreations(24)[0]!,
                  nodeType: 'GeometryNodeJoinGeometry',
                },
              ],
            },
          },
        },
      },
    ]) {
      const schema =
        'deliveryId' in invalid
          ? companionLeafOperationDeliverySchema
          : companionLeafOperationProgressSchema;
      expect(schema.safeParse(invalid).success).toBe(false);
    }
    const forgedParameterResult = structuredClone({
      ...lightTrailsDelivery(10),
      status: 'succeeded' as const,
      progress: lightTrailsProgress(10),
      error: null,
      occurredAt,
    });
    forgedParameterResult.progress.latestObservation.details.evidence.rnaControlWrites[0]!.acceptedValue = 0.5;
    expect(companionLeafOperationResultSchema.safeParse(forgedParameterResult).success).toBe(false);
  });

  it('accepts only the four-field public create request', () => {
    const request = {
      formatVersion: '1.0.0',
      requestId: ids.requestId,
      replayId: ids.replayId,
      expectedState: { reportId: ids.reportId, sequence: 7 },
    } as const;
    expect(companionLeafOperationCreateRequestSchema.parse(request)).toEqual(request);
    for (const hostile of [
      { ...request, operationOrdinal: 7 },
      { ...request, sourceOperationId: transformGeometryLeafOperationIds[6] },
      { ...request, operationParameters: { python: 'bpy.ops.wm.quit_blender()' } },
      { ...request, actionName: 'blender.mesh.create_cube' },
    ]) {
      expect(companionLeafOperationCreateRequestSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it('binds a delivery to the exact ordinal, operation id, parameters, and authority hashes', () => {
    expect(companionLeafOperationDeliverySchema.parse(delivery(5))).toEqual(delivery(5));
    for (const hostile of [
      { ...delivery(5), sourceOperationId: transformGeometryLeafOperationIds[6] },
      { ...delivery(5), operationOrdinal: 6 },
      { ...delivery(5), operationParameters: { scale: [9, 9, 9] } },
      { ...delivery(5), operationBindingSha256: 'f'.repeat(64) },
      { ...delivery(5), leafId: 'attacker.leaf' },
      { ...delivery(5), python: 'exec(payload)' },
    ]) {
      expect(companionLeafOperationDeliverySchema.safeParse(hostile).success).toBe(false);
    }
  });

  it('accepts strict partial progress for 01-10 and final-report progress only for 11', () => {
    expect(companionLeafOperationProgressSchema.parse(progress(1))).toEqual(progress(1));
    expect(companionLeafOperationProgressSchema.parse(progress(10))).toEqual(progress(10));
    expect(companionLeafOperationProgressSchema.parse(progress(11))).toEqual(progress(11));
    expect(
      companionLeafOperationRnaControlWritesSchema.safeParse(
        transformRnaControlWrites(5).slice(0, 2),
      ).success,
    ).toBe(false);
    expect(
      companionLeafOperationRnaControlWritesSchema.safeParse(
        lightTrailsRnaControlWrites(9).slice(0, 1),
      ).success,
    ).toBe(false);
    for (const invalid of [
      { ...progress(4), completedOperationIds: [transformGeometryLeafOperationIds[1]] },
      { ...progress(4), nextOrdinal: 4 },
      { ...progress(4), leafCompleted: true },
      { ...progress(4), finalReport: { reportId: ids.finalReportId, sequence: 8 } },
      { ...progress(11), finalReport: null },
      {
        ...progress(4),
        latestObservation: {
          ...progress(4).latestObservation,
          details: { ...progress(4).latestObservation.details, operationOrdinal: 3 },
        },
      },
      {
        ...progress(4),
        latestObservation: {
          ...progress(4).latestObservation,
          details: {
            ...progress(4).latestObservation.details,
            beforeFingerprintSha256: 'NOT-A-HASH',
          },
        },
      },
      {
        ...progress(6),
        latestObservation: {
          ...progress(6).latestObservation,
          details: {
            ...progress(6).latestObservation.details,
            evidence: {
              ...progress(6).latestObservation.details.evidence,
              rnaControlWrites: transformRnaControlWrites(6).toReversed(),
            },
          },
        },
      },
      {
        ...progress(8),
        latestObservation: {
          ...progress(8).latestObservation,
          details: {
            ...progress(8).latestObservation.details,
            evidence: {
              ...progress(8).latestObservation.details.evidence,
              rnaControlWrites: transformRnaControlWrites(7),
            },
          },
        },
      },
    ]) {
      expect(companionLeafOperationProgressSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires success progress and makes failed/rejected results evidence-free', () => {
    const succeeded = {
      ...delivery(1),
      status: 'succeeded',
      progress: progress(1),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(succeeded)).toEqual(succeeded);
    const final = {
      ...delivery(11),
      status: 'succeeded',
      progress: progress(11),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(final)).toEqual(final);
    const parameterResult = {
      ...delivery(6),
      status: 'succeeded',
      progress: progress(6),
      error: null,
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(parameterResult)).toEqual(parameterResult);
    const forgedParameterResult = structuredClone(parameterResult);
    forgedParameterResult.progress.latestObservation.details.evidence.rnaControlWrites[0]!.acceptedValue = 9;
    forgedParameterResult.progress.latestObservation.details.evidence.rnaControlWrites[0]!.observedValue = 9;
    expect(companionLeafOperationResultSchema.safeParse(forgedParameterResult).success).toBe(false);
    expect(
      companionLeafOperationResultSchema.safeParse({
        ...final,
        progress: { ...progress(11), finalReport: { reportId: ids.reportId, sequence: 7 } },
      }).success,
    ).toBe(false);
    for (const status of ['failed', 'rejected'] as const) {
      expect(
        companionLeafOperationResultSchema.parse({
          ...delivery(1),
          status,
          progress: null,
          error: `${status} safely`,
          occurredAt,
        }),
      ).toMatchObject({ status, progress: null });
    }
    expect(
      companionLeafOperationResultSchema.safeParse({ ...succeeded, status: 'failed' }).success,
    ).toBe(false);
  });

  it('accepts only explicit non-replaying recovery-required signals', () => {
    const signal = {
      ...delivery(2),
      status: 'recovery_required',
      progress: null,
      error: 'Native Undo outcome is indeterminate.',
      recoveryReason: {
        kind: 'native_undo_outcome_indeterminate',
        nativeUndoGuard: {
          expectedRestoredCheckpointId: ids.finalReportId,
          recoveryTokenSha256: 'b'.repeat(64),
        },
        requiresExplicitRecovery: true,
        automaticReplay: false,
      },
      occurredAt,
    } as const;
    expect(companionLeafOperationResultSchema.parse(signal)).toEqual(signal);
    for (const invalid of [
      { ...signal, progress: progress(2) },
      { ...signal, recoveryReason: undefined },
      { ...signal, recoveryReason: { ...signal.recoveryReason, automaticReplay: true } },
      { ...signal, status: 'failed' },
    ]) {
      expect(companionLeafOperationResultSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires terminal status to mirror the complete delivered identity', () => {
    const result = {
      ...delivery(1),
      status: 'succeeded',
      progress: progress(1),
      error: null,
      occurredAt,
    } as const;
    const status = {
      ...authority(1),
      deliveryId: ids.deliveryId,
      requestedAt,
      dispatchedAt,
      status: 'succeeded',
      result,
      updatedAt: occurredAt,
    } as const;
    expect(companionLeafOperationStatusSchema.parse(status)).toEqual(status);
    expect(
      companionLeafOperationStatusSchema.safeParse({
        ...status,
        result: { ...result, materializationContentSha256: 'a'.repeat(64) },
      }).success,
    ).toBe(false);
  });

  it('binds pre-dispatch authority expiration to a queued request without delivery or result', () => {
    const expired = {
      ...authority(1),
      requestedAt,
      status: 'pre_dispatch_authority_expired',
      preDispatchAuthorityExpirationEvidence: {
        source: 'document_authority_drift',
        requestId: ids.requestId,
        operationBindingSha256: authority(1).operationBindingSha256,
        target: authority(1).target,
        priorStatus: 'queued',
        detectedAt: occurredAt,
        resolution: 'pre_dispatch_authority_expired',
        retainsTargetLock: false,
        automaticReplay: false,
      },
      updatedAt: occurredAt,
    } as const;
    expect(companionLeafOperationStatusSchema.parse(expired)).toEqual(expired);
    for (const invalid of [
      { ...expired, deliveryId: ids.deliveryId, dispatchedAt },
      { ...expired, preDispatchAuthorityExpirationEvidence: undefined },
      {
        ...expired,
        preDispatchAuthorityExpirationEvidence: {
          ...expired.preDispatchAuthorityExpirationEvidence,
          requestId: ids.replayId,
        },
      },
      { ...expired, updatedAt: requestedAt },
    ]) {
      expect(companionLeafOperationStatusSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('binds recovery challenge and acknowledgement to delivery, prefix, and checkpoint proof', () => {
    const authorizedCheckpointId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const recoveryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const challenge = {
      formatVersion: '1.0.0',
      recoveryId,
      originalDelivery: delivery(1),
      originalSessionFingerprintSha256: '8'.repeat(64),
      replacementSessionFingerprintSha256: '9'.repeat(64),
      expectedState: authority(1).expectedState,
      acceptedPrefix: {
        completedOperationIds: [],
        runId: null,
        bindingSha256: null,
        receiptId: null,
        nextOrdinal: 1,
        latestFingerprintSha256: null,
      },
      authorityProof: {
        reportId: ids.reportId,
        sequence: 7,
        authorizedStartCheckpointId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      nativeUndoGuard: {
        expectedRestoredCheckpointId: authorizedCheckpointId,
        recoveryTokenSha256: 'd'.repeat(64),
      },
      mode: 'read_only_reconcile',
      automaticReplay: false,
      requestedAt: occurredAt,
    } as const;
    expect(companionLeafOperationRecoveryChallengeSchema.parse(challenge)).toEqual(challenge);
    const ack = {
      formatVersion: '1.0.0',
      challenge,
      recoveryId,
      requestId: ids.requestId,
      originalDeliveryId: ids.deliveryId,
      replacementSessionFingerprintSha256: '9'.repeat(64),
      outcome: 'prefix_restored',
      evidence: {
        kind: 'prefix_restored',
        expectedState: authority(1).expectedState,
        leafRun: challenge.acceptedPrefix,
        currentCheckpoint: {
          reportId: ids.reportId,
          sequence: 7,
          checkpointId: authorizedCheckpointId,
          previousCheckpointId: null,
          operation: 'start',
          sceneFingerprintSha256: null,
          markerMatched: true,
          sessionSnapshotMatches: true,
          stageVerified: true,
          observedAt: '2026-08-24T10:00:03.000+08:00',
        },
        restoration: 'native_undo_restored',
        nativeUndoWitness: {
          sourceCheckpointId: ids.finalReportId,
          restoredCheckpointId: authorizedCheckpointId,
          recoveryTokenSha256: 'd'.repeat(64),
          restoredAt: '2026-08-24T10:00:03.000+08:00',
          probeSatisfied: true,
        },
      },
      retainsTargetLock: false,
      automaticReplay: false,
      occurredAt: '2026-08-24T10:00:04.000+08:00',
    } as const;
    expect(companionLeafOperationRecoveryAckSchema.parse(ack)).toEqual(ack);
    expect(
      companionLeafOperationRecoveryAckSchema.safeParse({
        ...ack,
        evidence: {
          ...ack.evidence,
          currentCheckpoint: {
            ...ack.evidence.currentCheckpoint,
            checkpointId: ids.finalReportId,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      companionLeafOperationRecoveryChallengeSchema.safeParse({
        ...challenge,
        replacementSessionFingerprintSha256: challenge.originalSessionFingerprintSha256,
      }).success,
    ).toBe(false);

    const appliedChallenge = { ...challenge, nativeUndoGuard: null } as const;
    const terminalResult = {
      ...delivery(1),
      status: 'succeeded',
      progress: progress(1),
      error: null,
      occurredAt: '2026-08-24T10:00:03.000+08:00',
    } as const;
    const operationApplied = {
      formatVersion: '1.0.0',
      challenge: appliedChallenge,
      recoveryId,
      requestId: ids.requestId,
      originalDeliveryId: ids.deliveryId,
      replacementSessionFingerprintSha256: '9'.repeat(64),
      outcome: 'operation_applied',
      evidence: {
        kind: 'operation_applied',
        terminalResult,
        currentCheckpoint: {
          reportId: ids.reportId,
          sequence: 7,
          checkpointId: ids.finalReportId,
          previousCheckpointId: authorizedCheckpointId,
          operation: 'leaf_operation',
          sceneFingerprintSha256:
            terminalResult.progress.latestObservation.details.afterFingerprintSha256,
          markerMatched: true,
          sessionSnapshotMatches: true,
          stageVerified: true,
          observedAt: '2026-08-24T10:00:04.000+08:00',
        },
      },
      retainsTargetLock: false,
      automaticReplay: false,
      occurredAt: '2026-08-24T10:00:05.000+08:00',
    } as const;
    expect(companionLeafOperationRecoveryAckSchema.parse(operationApplied)).toEqual(
      operationApplied,
    );
    for (const invalid of [
      { ...operationApplied, challenge },
      { ...operationApplied, retainsTargetLock: true },
      {
        ...operationApplied,
        evidence: {
          ...operationApplied.evidence,
          terminalResult: { ...terminalResult, deliveryId: ids.runId },
        },
      },
      {
        ...operationApplied,
        evidence: {
          ...operationApplied.evidence,
          currentCheckpoint: {
            ...operationApplied.evidence.currentCheckpoint,
            sceneFingerprintSha256: 'f'.repeat(64),
          },
        },
      },
    ]) {
      expect(companionLeafOperationRecoveryAckSchema.safeParse(invalid).success).toBe(false);
    }

    const retired = {
      formatVersion: '1.0.0',
      challenge: appliedChallenge,
      recoveryId,
      requestId: ids.requestId,
      originalDeliveryId: ids.deliveryId,
      replacementSessionFingerprintSha256: '9'.repeat(64),
      outcome: 'document_incarnation_retired',
      evidence: {
        kind: 'document_incarnation_retired',
        reason: 'runtime_recovery_evidence_lost',
        mutationOutcome: 'indeterminate',
        requiresFreshDocumentIncarnation: true,
      },
      retainsTargetLock: false,
      automaticReplay: false,
      occurredAt: '2026-08-24T10:00:05.000+08:00',
    } as const;
    expect(companionLeafOperationRecoveryAckSchema.parse(retired)).toEqual(retired);
    expect(
      companionLeafOperationRecoveryAckSchema.parse({
        ...retired,
        challenge,
        evidence: {
          ...retired.evidence,
          reason: 'native_undo_witness_lost_after_reload',
        },
      }),
    ).toMatchObject({ outcome: 'document_incarnation_retired' });
    for (const invalid of [
      { ...retired, retainsTargetLock: true },
      {
        ...retired,
        evidence: { ...retired.evidence, mutationOutcome: 'restored' },
      },
      {
        ...retired,
        evidence: { ...retired.evidence, requiresFreshDocumentIncarnation: false },
      },
      {
        ...retired,
        challenge,
      },
      {
        ...retired,
        challenge: appliedChallenge,
        evidence: {
          ...retired.evidence,
          reason: 'native_undo_witness_lost_after_reload',
        },
      },
    ]) {
      expect(companionLeafOperationRecoveryAckSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
