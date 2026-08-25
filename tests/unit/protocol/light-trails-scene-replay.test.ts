import type { CompanionStateReport, ProcedureLeafReplayBinding } from '@operatingline/protocol';
import {
  actionLevelMcpActionNames,
  actionLevelMcpRecipeIdByAction,
  procedureLeafReplayObservationSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validateStrongProcedureLeafReplayObservation } from '../../../services/orchestrator/src/procedure-replay.js';

const trailMaterialNodeTypes = [
  'ShaderNodeBsdfPrincipled',
  'ShaderNodeMapping',
  'ShaderNodeMixRGB',
  'ShaderNodeOutputMaterial',
  'ShaderNodeTexCoord',
  'ShaderNodeTexGradient',
  'ShaderNodeTexWave',
  'ShaderNodeValToRGB',
  'ShaderNodeValToRGB',
];
const floorMaterialNodeTypes = [
  'ShaderNodeBsdfPrincipled',
  'ShaderNodeBump',
  'ShaderNodeMapping',
  'ShaderNodeOutputMaterial',
  'ShaderNodeTexCoord',
  'ShaderNodeTexVoronoi',
  'ShaderNodeValToRGB',
  'ShaderNodeValToRGB',
];
const compositorNodeTypes = [
  'CompositorNodeComposite',
  'CompositorNodeGlare',
  'CompositorNodeRLayers',
];

const parameters = {
  collectionId: 'snowman.collection',
  trailTargetId: 'tutorial.light_trails',
  floorTargetId: 'tutorial.floor',
  sceneId: 'tutorial.scene',
  sceneName: 'OperatingLine.LightTrailsScene',
  worldId: 'tutorial.world',
  worldName: 'OperatingLine.LightTrailsWorld',
  cameraId: 'tutorial.camera',
  cameraObjectName: 'OperatingLine.LightTrailsCamera',
  cameraDataName: 'OperatingLine.LightTrailsCameraData',
  controllerId: 'tutorial.camera_controller',
  controllerObjectName: 'OperatingLine.LightTrailsController',
  trailMaterialId: 'tutorial.trail_material',
  trailMaterialName: 'OperatingLine.LightTrailsMaterial',
  floorMaterialId: 'tutorial.floor_material',
  floorMaterialName: 'OperatingLine.LightTrailsFloorMaterial',
  cameraActionId: 'tutorial.camera_action',
  cameraActionName: 'OperatingLine.LightTrailsCameraAction',
  frameStart: 0,
  frameEnd: 400,
  cameraStart: [0, -10, 2],
  cameraEnd: [0, 10, 2],
  cameraTarget: [0, 0, 1],
  lens: 100,
  fStop: 2.8,
  focusDistance: 10,
  trailBaseColor: [0.005, 0.01, 0.02, 1],
  trailGlowColor: [0.1, 0.5, 1, 1],
  trailEmissionStrength: 30,
  gradientRotationDegrees: 90,
  gradientStart: 0.1,
  glowBandStart: 0.35,
  glowBandEnd: 0.65,
  gradientEnd: 0.9,
  waveScale: 3,
  floorBaseColor: [0.01, 0.015, 0.02, 1],
  floorEmissionColor: [0.02, 0.08, 0.15, 1],
  floorEmissionStrength: 0.25,
  floorMetallic: 0.8,
  floorVoronoiScale: 12,
  floorRoughnessMinimum: 0.2,
  floorRoughnessMaximum: 0.7,
  floorBumpStrength: 0.15,
  floorBumpDistance: 0.1,
  trailMaterialNodeTypes,
  floorMaterialNodeTypes,
  compositorNodeTypes,
};

const details = {
  parameters,
  supported: true,
  shape: 'managed_light_trails_scene',
  collectionId: parameters.collectionId,
  trailTargetId: parameters.trailTargetId,
  floorTargetId: parameters.floorTargetId,
  sceneId: parameters.sceneId,
  sceneName: parameters.sceneName,
  worldId: parameters.worldId,
  worldName: parameters.worldName,
  cameraId: parameters.cameraId,
  cameraObjectName: parameters.cameraObjectName,
  cameraDataName: parameters.cameraDataName,
  controllerId: parameters.controllerId,
  controllerObjectName: parameters.controllerObjectName,
  trailMaterialId: parameters.trailMaterialId,
  trailMaterialName: parameters.trailMaterialName,
  floorMaterialId: parameters.floorMaterialId,
  floorMaterialName: parameters.floorMaterialName,
  cameraActionId: parameters.cameraActionId,
  cameraActionName: parameters.cameraActionName,
  sceneMatches: true,
  collectionMatches: true,
  worldMatches: true,
  cameraMatches: true,
  controllerMatches: true,
  animationMatches: true,
  trailMaterialMatches: true,
  floorMaterialMatches: true,
  compositorMatches: true,
  noBakeNodes: true,
  noRenderArtifacts: true,
  frameStart: parameters.frameStart,
  frameEnd: parameters.frameEnd,
  cameraKeyframeCount: 6,
  trailMaterialNodeTypes,
  floorMaterialNodeTypes,
  compositorNodeTypes,
};

function validate(detailsValue: Record<string, unknown>, parametersValue = parameters) {
  const binding = {
    actionName: 'blender.lookdev.create_light_trails_scene',
    leafId: 'tutorial.lookdev',
    proposal: {
      plan: {
        steps: [
          {
            id: 'tutorial.lookdev',
            action: { name: 'blender.lookdev.create_light_trails_scene' },
            expectedObservations: [
              { kind: 'light_trails_scene_ready', parameters: parametersValue },
            ],
          },
        ],
      },
    },
  } as ProcedureLeafReplayBinding;
  const report = {
    observations: [{ kind: 'light_trails_scene_ready', satisfied: true, details: detailsValue }],
  } as CompanionStateReport;
  const observations = validateStrongProcedureLeafReplayObservation(binding, report);
  if (observations.length !== 1 || observations[0] === undefined) {
    throw new Error('Expected exactly one validated Light Trails Scene observation');
  }
  return observations[0];
}

describe('light-trails scene action-level replay', () => {
  it('registers the bounded action and semantic recipe', () => {
    expect(actionLevelMcpActionNames).toContain('blender.lookdev.create_light_trails_scene');
    expect(actionLevelMcpRecipeIdByAction['blender.lookdev.create_light_trails_scene']).toBe(
      'blender.lookdev.create_light_trails_scene.semantic',
    );
  });

  it('accepts the exact managed scene success proof', () => {
    expect(
      procedureLeafReplayObservationSchema.parse({
        kind: 'light_trails_scene_ready',
        satisfied: true,
        details,
      }),
    ).toEqual({ kind: 'light_trails_scene_ready', satisfied: true, details });
    expect(validate(details).kind).toBe('light_trails_scene_ready');
  });

  it.each([
    ['non-finite scalar', { ...parameters, lens: Number.NaN }],
    ['reversed frame range', { ...parameters, frameStart: 400, frameEnd: 1 }],
    ['stationary camera', { ...parameters, cameraEnd: parameters.cameraStart }],
    ['camera at target', { ...parameters, cameraTarget: parameters.cameraStart }],
    ['same target', { ...parameters, floorTargetId: parameters.trailTargetId }],
    ['same material name', { ...parameters, floorMaterialName: parameters.trailMaterialName }],
    ['unordered gradient', { ...parameters, glowBandStart: 0.7 }],
    [
      'equal floor roughness bounds',
      {
        ...parameters,
        floorRoughnessMaximum: parameters.floorRoughnessMinimum,
      },
    ],
    [
      'wrong node multiset',
      { ...parameters, trailMaterialNodeTypes: trailMaterialNodeTypes.slice(0, -1) },
    ],
  ])('rejects %s replay parameters', (_label, invalidParameters) => {
    expect(() =>
      validate({ ...details, parameters: invalidParameters }, invalidParameters),
    ).toThrow();
  });

  it.each([
    ['failed invariant', { ...details, noBakeNodes: false }],
    ['wrong shape', { ...details, shape: 'managed_light_trails' }],
    ['wrong keyframe count', { ...details, cameraKeyframeCount: 5 }],
    ['wrong identity', { ...details, cameraId: 'tutorial.other_camera' }],
    ['extra weak field', { ...details, approximate: true }],
  ])('rejects a success proof with %s', (_label, invalidDetails) => {
    expect(() => validate(invalidDetails)).toThrow();
  });
});
