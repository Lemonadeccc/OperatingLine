import { z } from 'zod';

import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';

export const companionLeafOperationFormatVersion = '1.0.0' as const;
export const companionLeafOperationFormatVersionSchema = z.literal(
  companionLeafOperationFormatVersion,
);

export const transformGeometryLeafOperationActionName =
  'blender.geometry_nodes.create_transform' as const;
export const transformGeometryLeafOperationRecipeId =
  'blender.geometry_nodes.create_transform.semantic' as const;
export const transformGeometryLeafOperationIds = [
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
] as const;

export const lightTrailsLeafOperationActionName =
  'blender.geometry_nodes.create_light_trails' as const;
export const lightTrailsLeafOperationRecipeId =
  'blender.geometry_nodes.create_light_trails.semantic' as const;
export const lightTrailsLeafOperationIds = [
  'workspace.geometry_nodes',
  'semantic.new_geometry_modifier',
  'node.light_trails.group_input',
  'node.light_trails.half_tile_line',
  'projection.semantic.light_trails.tile_length',
  'node.light_trails.trail_resolution',
  'projection.semantic.light_trails.points_per_trail',
  'node.light_trails.trail_rows',
  'projection.semantic.light_trails.trail_count',
  'projection.semantic.light_trails.trail_spacing',
  'node.light_trails.trail_instances',
  'node.light_trails.realize_trails',
  'node.light_trails.trail_position',
  'node.light_trails.terrain_noise',
  'projection.semantic.light_trails.noise_scale',
  'projection.semantic.light_trails.noise_detail',
  'projection.semantic.light_trails.noise_roughness',
  'projection.semantic.light_trails.noise_seed',
  'node.light_trails.center_noise',
  'node.light_trails.scale_height',
  'projection.semantic.light_trails.height',
  'node.light_trails.z_offset',
  'node.light_trails.displace_trails',
  'node.light_trails.mirror_half_tile',
  'node.light_trails.mirrored_tile',
  'node.light_trails.trail_profile',
  'projection.semantic.light_trails.profile_sides',
  'projection.semantic.light_trails.profile_radius',
  'node.light_trails.curve_to_mesh',
  'node.light_trails.loop_tiles',
  'projection.semantic.light_trails.tile_repeat_count',
  'node.light_trails.tile_instances',
  'node.light_trails.realize_tiles',
  'node.light_trails.group_output',
  'semantic.connect_light_trails.half_line_to_resolution',
  'semantic.connect_light_trails.rows_to_instances',
  'semantic.connect_light_trails.resolution_to_instances',
  'semantic.connect_light_trails.instances_to_realize',
  'semantic.connect_light_trails.position_to_noise',
  'semantic.connect_light_trails.noise_to_center',
  'semantic.connect_light_trails.center_to_height',
  'semantic.connect_light_trails.height_to_offset',
  'semantic.connect_light_trails.realize_to_displace',
  'semantic.connect_light_trails.offset_to_displace',
  'semantic.connect_light_trails.displace_to_mirror',
  'semantic.connect_light_trails.displace_to_join',
  'semantic.connect_light_trails.mirror_to_join',
  'semantic.connect_light_trails.join_to_curve_mesh',
  'semantic.connect_light_trails.profile_to_curve_mesh',
  'semantic.connect_light_trails.tiles_to_instances',
  'semantic.connect_light_trails.mesh_to_instances',
  'semantic.connect_light_trails.instances_to_final_realize',
  'semantic.connect_light_trails.realize_to_output',
  'semantic.verify_no_bake',
] as const;

export const poseAnimationLeafOperationActionName =
  'blender.animation.create_pose_keyframes' as const;
export const poseAnimationLeafOperationRecipeId =
  'blender.animation.create_pose_keyframes.semantic' as const;
export const poseAnimationLeafOperationIds = [
  'workspace.animation',
  'editor.action',
  'mode.pose',
  'semantic.create_pose_action',
  'projection.semantic.pose_animation.action_name',
  'operator.insert_keyframe',
  'projection.semantic.pose_animation.keyframes',
  'control.pose_interpolation',
  'projection.semantic.pose_animation.interpolation',
  'control.pose_extrapolation',
  'projection.semantic.pose_animation.extrapolation',
  'semantic.verify_pose_animation',
] as const;

export const armatureLeafOperationActionName = 'blender.rig.create_armature' as const;
export const armatureLeafOperationRecipeId = 'blender.rig.create_armature.semantic' as const;
export const armatureLeafOperationIds = [
  'workspace.layout',
  'menu.add_armature',
  'projection.semantic.armature.object_name',
  'projection.semantic.armature.data_name',
  'mode.edit_bones',
  'projection.semantic.armature.bones',
  'semantic.rigid_parent',
  'projection.semantic.armature.bindings',
  'semantic.verify_armature',
] as const;

export const skinWeightsLeafOperationActionName = 'blender.rig.bind_skin_weights' as const;
export const skinWeightsLeafOperationRecipeId = 'blender.rig.bind_skin_weights.semantic' as const;
export const skinWeightsLeafOperationIds = [
  'workspace.layout',
  'panel.object_data',
  'mode.weight_paint',
  'semantic.normalized_weights',
  'projection.semantic.skin_weights.weights',
  'semantic.armature_modifier',
  'projection.semantic.skin_weights.preserve_volume',
  'projection.semantic.skin_weights.modifier_name',
  'semantic.verify_skin_weights',
] as const;

export const solidifyLeafOperationActionName = 'blender.modifier.add_solidify' as const;
export const solidifyLeafOperationRecipeId = 'blender.modifier.add_solidify.semantic' as const;
export const solidifyLeafOperationIds = [
  'workspace.layout',
  'panel.modifier_properties',
  'control.add_modifier',
  'semantic.solidify_parameters',
] as const;

export const bevelModifierLeafOperationActionName = 'blender.modifier.add_bevel' as const;
export const bevelModifierLeafOperationRecipeId = 'blender.modifier.add_bevel.semantic' as const;
export const bevelModifierLeafOperationIds = [
  'workspace.layout',
  'panel.modifier_properties',
  'control.add_modifier',
  'semantic.bevel_parameters',
] as const;

export const singleMaterialLeafOperationActionName = 'blender.material.create_and_assign' as const;
export const singleMaterialLeafOperationRecipeId =
  'blender.material.create_and_assign.semantic' as const;
export const singleMaterialLeafOperationIds = [
  'workspace.shading',
  'panel.material_properties',
  'control.new_material',
  'semantic.principled_surface',
] as const;

export const materialPaletteLeafOperationActionName =
  'blender.material.create_palette_and_assign' as const;
export const materialPaletteLeafOperationRecipeId =
  'blender.material.create_palette_and_assign.semantic' as const;
export const materialPaletteLeafOperationIds = [
  'workspace.shading',
  'panel.material_properties',
  'semantic.palette_entries',
  'semantic.assign_targets',
] as const;

export const mirrorLeafOperationActionName = 'blender.modifier.add_mirror' as const;
export const mirrorLeafOperationRecipeId = 'blender.modifier.add_mirror.semantic' as const;
export const mirrorLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'panel.modifier_properties',
  'control.add_modifier',
  'category.generate',
  'modifier.mirror',
  'semantic.mirror_contract',
] as const;

export const subdivisionSurfaceLeafOperationActionName =
  'blender.modifier.add_subdivision_surface' as const;
export const subdivisionSurfaceLeafOperationRecipeId =
  'blender.modifier.add_subdivision_surface.semantic' as const;
export const subdivisionSurfaceLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'operator.subdivision_set',
  'semantic.subdivision_surface_contract',
] as const;

export const editBevelLeafOperationActionName = 'blender.mesh.edit_bevel_edges' as const;
export const editBevelLeafOperationRecipeId = 'blender.mesh.edit_bevel_edges.semantic' as const;
export const editBevelLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'mode.edit_mesh',
  'menu.edge',
  'operator.bevel_edges',
  'semantic.managed_bevel_edges_contract',
] as const;

export const editInsetLeafOperationActionName = 'blender.mesh.edit_inset_faces' as const;
export const editInsetLeafOperationRecipeId = 'blender.mesh.edit_inset_faces.semantic' as const;
export const editInsetLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'mode.edit_mesh',
  'menu.face',
  'operator.inset_faces',
  'semantic.managed_inset_faces_contract',
] as const;

export const editTriangulateLeafOperationActionName = 'blender.mesh.edit_triangulate' as const;
export const editTriangulateLeafOperationRecipeId =
  'blender.mesh.edit_triangulate.semantic' as const;
export const editTriangulateLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'mode.edit_mesh',
  'menu.face',
  'operator.triangulate_faces',
  'semantic.managed_triangulate_contract',
] as const;

export const editExtrudeRegionLeafOperationActionName = 'blender.mesh.edit_extrude_region' as const;
export const editExtrudeRegionLeafOperationRecipeId =
  'blender.mesh.edit_extrude_region.semantic' as const;
export const editExtrudeRegionLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'mode.edit_mesh',
  'semantic.select_face_region',
  'operator.extrude_region_move',
  'semantic.managed_extrude_region_contract',
] as const;

export const editPokeLeafOperationActionName = 'blender.mesh.edit_poke_faces' as const;
export const editPokeLeafOperationRecipeId = 'blender.mesh.edit_poke_faces.semantic' as const;
export const editPokeLeafOperationIds = [
  'workspace.layout',
  'semantic.select_owned_mesh',
  'mode.edit_mesh',
  'menu.face',
  'operator.poke_faces',
  'semantic.managed_poke_faces_contract',
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const catalogVersionSchema = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
export const transformGeometryLeafOperationIdsSchema = z.tuple([
  z.literal(transformGeometryLeafOperationIds[0]),
  z.literal(transformGeometryLeafOperationIds[1]),
  z.literal(transformGeometryLeafOperationIds[2]),
  z.literal(transformGeometryLeafOperationIds[3]),
  z.literal(transformGeometryLeafOperationIds[4]),
  z.literal(transformGeometryLeafOperationIds[5]),
  z.literal(transformGeometryLeafOperationIds[6]),
  z.literal(transformGeometryLeafOperationIds[7]),
  z.literal(transformGeometryLeafOperationIds[8]),
  z.literal(transformGeometryLeafOperationIds[9]),
  z.literal(transformGeometryLeafOperationIds[10]),
]);
export const lightTrailsLeafOperationIdsSchema = z.tuple([
  z.literal(lightTrailsLeafOperationIds[0]),
  z.literal(lightTrailsLeafOperationIds[1]),
  z.literal(lightTrailsLeafOperationIds[2]),
  z.literal(lightTrailsLeafOperationIds[3]),
  z.literal(lightTrailsLeafOperationIds[4]),
  z.literal(lightTrailsLeafOperationIds[5]),
  z.literal(lightTrailsLeafOperationIds[6]),
  z.literal(lightTrailsLeafOperationIds[7]),
  z.literal(lightTrailsLeafOperationIds[8]),
  z.literal(lightTrailsLeafOperationIds[9]),
  z.literal(lightTrailsLeafOperationIds[10]),
  z.literal(lightTrailsLeafOperationIds[11]),
  z.literal(lightTrailsLeafOperationIds[12]),
  z.literal(lightTrailsLeafOperationIds[13]),
  z.literal(lightTrailsLeafOperationIds[14]),
  z.literal(lightTrailsLeafOperationIds[15]),
  z.literal(lightTrailsLeafOperationIds[16]),
  z.literal(lightTrailsLeafOperationIds[17]),
  z.literal(lightTrailsLeafOperationIds[18]),
  z.literal(lightTrailsLeafOperationIds[19]),
  z.literal(lightTrailsLeafOperationIds[20]),
  z.literal(lightTrailsLeafOperationIds[21]),
  z.literal(lightTrailsLeafOperationIds[22]),
  z.literal(lightTrailsLeafOperationIds[23]),
  z.literal(lightTrailsLeafOperationIds[24]),
  z.literal(lightTrailsLeafOperationIds[25]),
  z.literal(lightTrailsLeafOperationIds[26]),
  z.literal(lightTrailsLeafOperationIds[27]),
  z.literal(lightTrailsLeafOperationIds[28]),
  z.literal(lightTrailsLeafOperationIds[29]),
  z.literal(lightTrailsLeafOperationIds[30]),
  z.literal(lightTrailsLeafOperationIds[31]),
  z.literal(lightTrailsLeafOperationIds[32]),
  z.literal(lightTrailsLeafOperationIds[33]),
  z.literal(lightTrailsLeafOperationIds[34]),
  z.literal(lightTrailsLeafOperationIds[35]),
  z.literal(lightTrailsLeafOperationIds[36]),
  z.literal(lightTrailsLeafOperationIds[37]),
  z.literal(lightTrailsLeafOperationIds[38]),
  z.literal(lightTrailsLeafOperationIds[39]),
  z.literal(lightTrailsLeafOperationIds[40]),
  z.literal(lightTrailsLeafOperationIds[41]),
  z.literal(lightTrailsLeafOperationIds[42]),
  z.literal(lightTrailsLeafOperationIds[43]),
  z.literal(lightTrailsLeafOperationIds[44]),
  z.literal(lightTrailsLeafOperationIds[45]),
  z.literal(lightTrailsLeafOperationIds[46]),
  z.literal(lightTrailsLeafOperationIds[47]),
  z.literal(lightTrailsLeafOperationIds[48]),
  z.literal(lightTrailsLeafOperationIds[49]),
  z.literal(lightTrailsLeafOperationIds[50]),
  z.literal(lightTrailsLeafOperationIds[51]),
  z.literal(lightTrailsLeafOperationIds[52]),
  z.literal(lightTrailsLeafOperationIds[53]),
]);
export const poseAnimationLeafOperationIdsSchema = z.tuple([
  z.literal(poseAnimationLeafOperationIds[0]),
  z.literal(poseAnimationLeafOperationIds[1]),
  z.literal(poseAnimationLeafOperationIds[2]),
  z.literal(poseAnimationLeafOperationIds[3]),
  z.literal(poseAnimationLeafOperationIds[4]),
  z.literal(poseAnimationLeafOperationIds[5]),
  z.literal(poseAnimationLeafOperationIds[6]),
  z.literal(poseAnimationLeafOperationIds[7]),
  z.literal(poseAnimationLeafOperationIds[8]),
  z.literal(poseAnimationLeafOperationIds[9]),
  z.literal(poseAnimationLeafOperationIds[10]),
  z.literal(poseAnimationLeafOperationIds[11]),
]);
export const armatureLeafOperationIdsSchema = z.tuple([
  z.literal(armatureLeafOperationIds[0]),
  z.literal(armatureLeafOperationIds[1]),
  z.literal(armatureLeafOperationIds[2]),
  z.literal(armatureLeafOperationIds[3]),
  z.literal(armatureLeafOperationIds[4]),
  z.literal(armatureLeafOperationIds[5]),
  z.literal(armatureLeafOperationIds[6]),
  z.literal(armatureLeafOperationIds[7]),
  z.literal(armatureLeafOperationIds[8]),
]);
export const skinWeightsLeafOperationIdsSchema = z.tuple([
  z.literal(skinWeightsLeafOperationIds[0]),
  z.literal(skinWeightsLeafOperationIds[1]),
  z.literal(skinWeightsLeafOperationIds[2]),
  z.literal(skinWeightsLeafOperationIds[3]),
  z.literal(skinWeightsLeafOperationIds[4]),
  z.literal(skinWeightsLeafOperationIds[5]),
  z.literal(skinWeightsLeafOperationIds[6]),
  z.literal(skinWeightsLeafOperationIds[7]),
  z.literal(skinWeightsLeafOperationIds[8]),
]);
export const solidifyLeafOperationIdsSchema = z.tuple([
  z.literal(solidifyLeafOperationIds[0]),
  z.literal(solidifyLeafOperationIds[1]),
  z.literal(solidifyLeafOperationIds[2]),
  z.literal(solidifyLeafOperationIds[3]),
]);
export const bevelModifierLeafOperationIdsSchema = z.tuple([
  z.literal(bevelModifierLeafOperationIds[0]),
  z.literal(bevelModifierLeafOperationIds[1]),
  z.literal(bevelModifierLeafOperationIds[2]),
  z.literal(bevelModifierLeafOperationIds[3]),
]);
export const singleMaterialLeafOperationIdsSchema = z.tuple([
  z.literal(singleMaterialLeafOperationIds[0]),
  z.literal(singleMaterialLeafOperationIds[1]),
  z.literal(singleMaterialLeafOperationIds[2]),
  z.literal(singleMaterialLeafOperationIds[3]),
]);
export const materialPaletteLeafOperationIdsSchema = z.tuple([
  z.literal(materialPaletteLeafOperationIds[0]),
  z.literal(materialPaletteLeafOperationIds[1]),
  z.literal(materialPaletteLeafOperationIds[2]),
  z.literal(materialPaletteLeafOperationIds[3]),
]);
export const mirrorLeafOperationIdsSchema = z.tuple([
  z.literal(mirrorLeafOperationIds[0]),
  z.literal(mirrorLeafOperationIds[1]),
  z.literal(mirrorLeafOperationIds[2]),
  z.literal(mirrorLeafOperationIds[3]),
  z.literal(mirrorLeafOperationIds[4]),
  z.literal(mirrorLeafOperationIds[5]),
  z.literal(mirrorLeafOperationIds[6]),
]);
export const subdivisionSurfaceLeafOperationIdsSchema = z.tuple([
  z.literal(subdivisionSurfaceLeafOperationIds[0]),
  z.literal(subdivisionSurfaceLeafOperationIds[1]),
  z.literal(subdivisionSurfaceLeafOperationIds[2]),
  z.literal(subdivisionSurfaceLeafOperationIds[3]),
]);
export const editBevelLeafOperationIdsSchema = z.tuple([
  z.literal(editBevelLeafOperationIds[0]),
  z.literal(editBevelLeafOperationIds[1]),
  z.literal(editBevelLeafOperationIds[2]),
  z.literal(editBevelLeafOperationIds[3]),
  z.literal(editBevelLeafOperationIds[4]),
  z.literal(editBevelLeafOperationIds[5]),
]);
export const editInsetLeafOperationIdsSchema = z.tuple([
  z.literal(editInsetLeafOperationIds[0]),
  z.literal(editInsetLeafOperationIds[1]),
  z.literal(editInsetLeafOperationIds[2]),
  z.literal(editInsetLeafOperationIds[3]),
  z.literal(editInsetLeafOperationIds[4]),
  z.literal(editInsetLeafOperationIds[5]),
]);
export const editTriangulateLeafOperationIdsSchema = z.tuple([
  z.literal(editTriangulateLeafOperationIds[0]),
  z.literal(editTriangulateLeafOperationIds[1]),
  z.literal(editTriangulateLeafOperationIds[2]),
  z.literal(editTriangulateLeafOperationIds[3]),
  z.literal(editTriangulateLeafOperationIds[4]),
  z.literal(editTriangulateLeafOperationIds[5]),
]);
export const editExtrudeRegionLeafOperationIdsSchema = z.tuple([
  z.literal(editExtrudeRegionLeafOperationIds[0]),
  z.literal(editExtrudeRegionLeafOperationIds[1]),
  z.literal(editExtrudeRegionLeafOperationIds[2]),
  z.literal(editExtrudeRegionLeafOperationIds[3]),
  z.literal(editExtrudeRegionLeafOperationIds[4]),
  z.literal(editExtrudeRegionLeafOperationIds[5]),
]);
export const editPokeLeafOperationIdsSchema = z.tuple([
  z.literal(editPokeLeafOperationIds[0]),
  z.literal(editPokeLeafOperationIds[1]),
  z.literal(editPokeLeafOperationIds[2]),
  z.literal(editPokeLeafOperationIds[3]),
  z.literal(editPokeLeafOperationIds[4]),
  z.literal(editPokeLeafOperationIds[5]),
]);

const leafOperationActionNameSchema = z.enum([
  transformGeometryLeafOperationActionName,
  lightTrailsLeafOperationActionName,
  poseAnimationLeafOperationActionName,
  armatureLeafOperationActionName,
  skinWeightsLeafOperationActionName,
  solidifyLeafOperationActionName,
  bevelModifierLeafOperationActionName,
  singleMaterialLeafOperationActionName,
  materialPaletteLeafOperationActionName,
  mirrorLeafOperationActionName,
  subdivisionSurfaceLeafOperationActionName,
  editBevelLeafOperationActionName,
  editInsetLeafOperationActionName,
  editTriangulateLeafOperationActionName,
  editExtrudeRegionLeafOperationActionName,
  editPokeLeafOperationActionName,
]);
const leafOperationRecipeIdSchema = z.enum([
  transformGeometryLeafOperationRecipeId,
  lightTrailsLeafOperationRecipeId,
  poseAnimationLeafOperationRecipeId,
  armatureLeafOperationRecipeId,
  skinWeightsLeafOperationRecipeId,
  solidifyLeafOperationRecipeId,
  bevelModifierLeafOperationRecipeId,
  singleMaterialLeafOperationRecipeId,
  materialPaletteLeafOperationRecipeId,
  mirrorLeafOperationRecipeId,
  subdivisionSurfaceLeafOperationRecipeId,
  editBevelLeafOperationRecipeId,
  editInsetLeafOperationRecipeId,
  editTriangulateLeafOperationRecipeId,
  editExtrudeRegionLeafOperationRecipeId,
  editPokeLeafOperationRecipeId,
]);
const operationIdSchema = z.enum([
  ...transformGeometryLeafOperationIds,
  ...lightTrailsLeafOperationIds,
  ...poseAnimationLeafOperationIds,
  ...armatureLeafOperationIds,
  ...skinWeightsLeafOperationIds,
  ...solidifyLeafOperationIds,
  ...bevelModifierLeafOperationIds,
  ...singleMaterialLeafOperationIds,
  ...materialPaletteLeafOperationIds,
  ...mirrorLeafOperationIds,
  ...subdivisionSurfaceLeafOperationIds,
  ...editBevelLeafOperationIds,
  ...editInsetLeafOperationIds,
  ...editTriangulateLeafOperationIds,
  ...editExtrudeRegionLeafOperationIds,
  ...editPokeLeafOperationIds,
]);
export const guidedLeafOperationIdsSchema = z.union([
  transformGeometryLeafOperationIdsSchema,
  lightTrailsLeafOperationIdsSchema,
  poseAnimationLeafOperationIdsSchema,
  armatureLeafOperationIdsSchema,
  skinWeightsLeafOperationIdsSchema,
  solidifyLeafOperationIdsSchema,
  bevelModifierLeafOperationIdsSchema,
  singleMaterialLeafOperationIdsSchema,
  materialPaletteLeafOperationIdsSchema,
  mirrorLeafOperationIdsSchema,
  subdivisionSurfaceLeafOperationIdsSchema,
  editBevelLeafOperationIdsSchema,
  editInsetLeafOperationIdsSchema,
  editTriangulateLeafOperationIdsSchema,
  editExtrudeRegionLeafOperationIdsSchema,
  editPokeLeafOperationIdsSchema,
]);
export const guidedGeometryLeafOperationIdsSchema = guidedLeafOperationIdsSchema;

const guidedGeometryLeafOperationProfiles = [
  {
    actionName: transformGeometryLeafOperationActionName,
    recipeId: transformGeometryLeafOperationRecipeId,
    operationIds: transformGeometryLeafOperationIds,
    observationKind: 'guided_geometry_operation',
    completionEvidenceKey: 'completeGraph',
    mutatingOrdinals: Array.from(
      { length: transformGeometryLeafOperationIds.length - 2 },
      (_value, index) => index + 2,
    ),
  },
  {
    actionName: lightTrailsLeafOperationActionName,
    recipeId: lightTrailsLeafOperationRecipeId,
    operationIds: lightTrailsLeafOperationIds,
    observationKind: 'guided_geometry_operation',
    completionEvidenceKey: 'completeGraph',
    mutatingOrdinals: Array.from(
      { length: lightTrailsLeafOperationIds.length - 2 },
      (_value, index) => index + 2,
    ),
  },
  {
    actionName: poseAnimationLeafOperationActionName,
    recipeId: poseAnimationLeafOperationRecipeId,
    operationIds: poseAnimationLeafOperationIds,
    observationKind: 'guided_pose_operation',
    completionEvidenceKey: 'completeAnimation',
    mutatingOrdinals: [4, 5, 7, 9, 11],
  },
  {
    actionName: armatureLeafOperationActionName,
    recipeId: armatureLeafOperationRecipeId,
    operationIds: armatureLeafOperationIds,
    observationKind: 'guided_armature_operation',
    completionEvidenceKey: 'completeArmature',
    mutatingOrdinals: [2, 3, 4, 6, 8],
  },
  {
    actionName: skinWeightsLeafOperationActionName,
    recipeId: skinWeightsLeafOperationRecipeId,
    operationIds: skinWeightsLeafOperationIds,
    observationKind: 'guided_skin_weights_operation',
    completionEvidenceKey: 'completeSkinWeights',
    mutatingOrdinals: [5, 7, 8],
  },
  {
    actionName: solidifyLeafOperationActionName,
    recipeId: solidifyLeafOperationRecipeId,
    operationIds: solidifyLeafOperationIds,
    observationKind: 'guided_modifier_operation',
    completionEvidenceKey: 'completeSolidify',
    mutatingOrdinals: [3, 4],
  },
  {
    actionName: bevelModifierLeafOperationActionName,
    recipeId: bevelModifierLeafOperationRecipeId,
    operationIds: bevelModifierLeafOperationIds,
    observationKind: 'guided_modifier_operation',
    completionEvidenceKey: 'completeBevelModifier',
    mutatingOrdinals: [3, 4],
  },
  {
    actionName: singleMaterialLeafOperationActionName,
    recipeId: singleMaterialLeafOperationRecipeId,
    operationIds: singleMaterialLeafOperationIds,
    observationKind: 'guided_material_operation',
    completionEvidenceKey: 'completeSingleMaterial',
    mutatingOrdinals: [3, 4],
  },
  {
    actionName: materialPaletteLeafOperationActionName,
    recipeId: materialPaletteLeafOperationRecipeId,
    operationIds: materialPaletteLeafOperationIds,
    observationKind: 'guided_material_operation',
    completionEvidenceKey: 'completeMaterialPalette',
    mutatingOrdinals: [4],
  },
  {
    actionName: mirrorLeafOperationActionName,
    recipeId: mirrorLeafOperationRecipeId,
    operationIds: mirrorLeafOperationIds,
    observationKind: 'guided_modifier_operation',
    completionEvidenceKey: 'completeMirror',
    mutatingOrdinals: [6, 7],
  },
  {
    actionName: subdivisionSurfaceLeafOperationActionName,
    recipeId: subdivisionSurfaceLeafOperationRecipeId,
    operationIds: subdivisionSurfaceLeafOperationIds,
    observationKind: 'guided_modifier_operation',
    completionEvidenceKey: 'completeSubdivisionSurface',
    mutatingOrdinals: [3, 4],
  },
  {
    actionName: editBevelLeafOperationActionName,
    recipeId: editBevelLeafOperationRecipeId,
    operationIds: editBevelLeafOperationIds,
    observationKind: 'guided_edit_mesh_operation',
    completionEvidenceKey: 'completeEditBevelEdges',
    mutatingOrdinals: [5, 6],
  },
  {
    actionName: editInsetLeafOperationActionName,
    recipeId: editInsetLeafOperationRecipeId,
    operationIds: editInsetLeafOperationIds,
    observationKind: 'guided_edit_mesh_operation',
    completionEvidenceKey: 'completeEditInsetFaces',
    mutatingOrdinals: [5, 6],
  },
  {
    actionName: editTriangulateLeafOperationActionName,
    recipeId: editTriangulateLeafOperationRecipeId,
    operationIds: editTriangulateLeafOperationIds,
    observationKind: 'guided_edit_mesh_operation',
    completionEvidenceKey: 'completeEditTriangulate',
    mutatingOrdinals: [5, 6],
  },
  {
    actionName: editExtrudeRegionLeafOperationActionName,
    recipeId: editExtrudeRegionLeafOperationRecipeId,
    operationIds: editExtrudeRegionLeafOperationIds,
    observationKind: 'guided_edit_mesh_operation',
    completionEvidenceKey: 'completeEditExtrudeRegion',
    mutatingOrdinals: [5, 6],
  },
  {
    actionName: editPokeLeafOperationActionName,
    recipeId: editPokeLeafOperationRecipeId,
    operationIds: editPokeLeafOperationIds,
    observationKind: 'guided_edit_mesh_operation',
    completionEvidenceKey: 'completeEditPokeFaces',
    mutatingOrdinals: [5, 6],
  },
] as const;

function leafOperationProfile(actionName: string) {
  return guidedGeometryLeafOperationProfiles.find(
    (candidate) => candidate.actionName === actionName,
  );
}

function exactOperationIds(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((operationId, index) => operationId === expected[index])
  );
}

const expectedStateSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
});
const targetSchema = z.strictObject({
  adapterId: z.literal('blender'),
  instanceId: z.uuid(),
});
const planSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});

export const companionLeafOperationCreateRequestSchema = z.strictObject({
  formatVersion: companionLeafOperationFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  expectedState: expectedStateSchema,
});
export type CompanionLeafOperationCreateRequest = z.infer<
  typeof companionLeafOperationCreateRequestSchema
>;

export const companionLeafOperationStatusRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export type CompanionLeafOperationStatusRequest = z.infer<
  typeof companionLeafOperationStatusRequestSchema
>;

const operationAuthorityShape = {
  formatVersion: companionLeafOperationFormatVersionSchema,
  requestId: z.uuid(),
  replayId: z.uuid(),
  target: targetSchema,
  proposalId: z.uuid(),
  plan: planSchema,
  planContentSha256: sha256Schema,
  executionId: z.uuid(),
  leafId: z.string().min(1),
  stepId: z.string().min(1),
  actionName: leafOperationActionNameSchema,
  recipeId: leafOperationRecipeIdSchema,
  catalogVersion: catalogVersionSchema,
  interactionCatalogContentSha256: sha256Schema,
  materializationContentSha256: sha256Schema,
  mcpTrackContentSha256: sha256Schema,
  expectedState: expectedStateSchema,
  operationIds: guidedLeafOperationIdsSchema,
  operationOrdinal: z.number().int().min(1).max(lightTrailsLeafOperationIds.length),
  sourceOperationId: operationIdSchema,
  operationParameters: z.record(z.string().min(1), z.json()),
} as const;

type OperationAuthority = z.infer<z.ZodObject<typeof operationAuthorityShape>>;

export function computeCompanionLeafOperationBindingSha256(operation: {
  readonly [Key in keyof OperationAuthority]: unknown;
}): string {
  const binding = Object.fromEntries(
    Object.keys(operationAuthorityShape).map((key) => [
      key,
      operation[key as keyof OperationAuthority],
    ]),
  );
  return computeProtocolCanonicalJsonSha256(binding);
}

function operationAuthorityIsValid(
  operation: OperationAuthority & {
    readonly operationBindingSha256: string;
  },
): boolean {
  const profile = leafOperationProfile(operation.actionName);
  return (
    profile !== undefined &&
    operation.recipeId === profile.recipeId &&
    exactOperationIds(operation.operationIds, profile.operationIds) &&
    operation.operationOrdinal <= profile.operationIds.length &&
    operation.leafId === operation.stepId &&
    operation.operationIds[operation.operationOrdinal - 1] === operation.sourceOperationId &&
    operation.operationBindingSha256 === computeCompanionLeafOperationBindingSha256(operation)
  );
}

const deliveryIdentityShape = {
  ...operationAuthorityShape,
  operationBindingSha256: sha256Schema,
  deliveryId: z.uuid(),
  requestedAt: timestampSchema,
  dispatchedAt: timestampSchema,
} as const;

export const companionLeafOperationDeliverySchema = z
  .strictObject(deliveryIdentityShape)
  .superRefine((delivery, context) => {
    if (!operationAuthorityIsValid(delivery)) {
      context.addIssue({
        code: 'custom',
        message: 'The leaf operation delivery does not match its immutable operation binding',
      });
    }
    if (Date.parse(delivery.requestedAt) > Date.parse(delivery.dispatchedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['dispatchedAt'],
        message: 'The leaf operation cannot be dispatched before it was requested',
      });
    }
  });
export type CompanionLeafOperationDelivery = z.infer<typeof companionLeafOperationDeliverySchema>;

const transformGeometryRnaControlBinding = {
  Translation: {
    actionArgument: 'translation',
    sourceOperationId: 'projection.semantic.transform_geometry.translation',
  },
  Rotation: {
    actionArgument: 'rotation',
    sourceOperationId: 'projection.semantic.transform_geometry.rotation',
  },
  Scale: {
    actionArgument: 'scale',
    sourceOperationId: 'projection.semantic.transform_geometry.scale',
  },
} as const;
const transformGeometryComponentLabels = ['X', 'Y', 'Z'] as const;

export const companionLeafOperationTransformRnaControlWriteSchema = z
  .strictObject({
    order: z.number().int().min(1).max(3),
    executionMethod: z.literal('blender_rna_property_write'),
    mcpTool: z.literal('operatingline.blender.geometry-nodes.transform.execute-next'),
    sourceOperationId: z.enum([
      'projection.semantic.transform_geometry.translation',
      'projection.semantic.transform_geometry.rotation',
      'projection.semantic.transform_geometry.scale',
    ]),
    semanticAction: z.literal('node.transform_geometry'),
    actionArgument: z.enum(['translation', 'rotation', 'scale']),
    nodeGroupId: z.string().min(1),
    nodeGroupName: z.string().min(1),
    nodeName: z.literal('OperatingLine Transform'),
    nodeType: z.literal('GeometryNodeTransform'),
    socketIdentifier: z.enum(['Translation', 'Rotation', 'Scale']),
    propertyName: z.literal('default_value'),
    componentIndex: z.number().int().min(0).max(2),
    componentLabel: z.enum(transformGeometryComponentLabels),
    beforeValue: z.number().finite(),
    acceptedValue: z.number().finite(),
    observedValue: z.number().finite(),
    uiPath: z.tuple([
      z.literal('Geometry Nodes'),
      z.string().min(1),
      z.literal('OperatingLine Transform'),
      z.enum(['Translation', 'Rotation', 'Scale']),
      z.enum(transformGeometryComponentLabels),
    ]),
  })
  .superRefine((write, context) => {
    const binding = transformGeometryRnaControlBinding[write.socketIdentifier];
    if (
      write.order !== write.componentIndex + 1 ||
      write.componentLabel !== transformGeometryComponentLabels[write.componentIndex] ||
      write.actionArgument !== binding.actionArgument ||
      write.sourceOperationId !== binding.sourceOperationId ||
      write.uiPath[1] !== write.nodeGroupName ||
      write.uiPath[3] !== write.socketIdentifier ||
      write.uiPath[4] !== write.componentLabel
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'An RNA control write must bind its exact operation, socket, component, and UI path',
      });
    }
  });

const lightTrailsRnaControlBinding = {
  tileLength: {
    sourceOperationId: 'projection.semantic.light_trails.tile_length',
    semanticAction: 'node.light_trails.half_tile_line',
  },
  pointsPerTrail: {
    sourceOperationId: 'projection.semantic.light_trails.points_per_trail',
    semanticAction: 'node.light_trails.trail_resolution',
  },
  trailCount: {
    sourceOperationId: 'projection.semantic.light_trails.trail_count',
    semanticAction: 'node.light_trails.trail_rows',
  },
  trailSpacing: {
    sourceOperationId: 'projection.semantic.light_trails.trail_spacing',
    semanticAction: 'node.light_trails.trail_rows',
  },
  noiseScale: {
    sourceOperationId: 'projection.semantic.light_trails.noise_scale',
    semanticAction: 'node.light_trails.terrain_noise',
  },
  noiseDetail: {
    sourceOperationId: 'projection.semantic.light_trails.noise_detail',
    semanticAction: 'node.light_trails.terrain_noise',
  },
  noiseRoughness: {
    sourceOperationId: 'projection.semantic.light_trails.noise_roughness',
    semanticAction: 'node.light_trails.terrain_noise',
  },
  noiseSeed: {
    sourceOperationId: 'projection.semantic.light_trails.noise_seed',
    semanticAction: 'node.light_trails.terrain_noise',
  },
  height: {
    sourceOperationId: 'projection.semantic.light_trails.height',
    semanticAction: 'node.light_trails.scale_height',
  },
  profileSides: {
    sourceOperationId: 'projection.semantic.light_trails.profile_sides',
    semanticAction: 'node.light_trails.trail_profile',
  },
  profileRadius: {
    sourceOperationId: 'projection.semantic.light_trails.profile_radius',
    semanticAction: 'node.light_trails.trail_profile',
  },
  tileRepeatCount: {
    sourceOperationId: 'projection.semantic.light_trails.tile_repeat_count',
    semanticAction: 'node.light_trails.loop_tiles',
  },
} as const;
const lightTrailsActionArguments = Object.keys(lightTrailsRnaControlBinding) as [
  keyof typeof lightTrailsRnaControlBinding,
  ...(keyof typeof lightTrailsRnaControlBinding)[],
];
const lightTrailsRnaControlTargets = {
  tileLength: [
    {
      nodeName: 'OperatingLine Half Tile Line',
      nodeType: 'GeometryNodeCurvePrimitiveLine',
      socketIdentifier: 'Start',
      valueKind: 'vector_component',
      componentIndex: 0,
      componentLabel: 'X',
      projection: 'negative_half_x',
    },
  ],
  pointsPerTrail: [
    {
      nodeName: 'OperatingLine Trail Resolution',
      nodeType: 'GeometryNodeResampleCurve',
      socketIdentifier: 'Count',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  trailCount: [
    {
      nodeName: 'OperatingLine Trail Rows',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Count',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
    {
      nodeName: 'OperatingLine Trail Rows',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Start Location',
      valueKind: 'vector_component',
      componentIndex: 1,
      componentLabel: 'Y',
      projection: 'centered_rows_y_from_count',
    },
  ],
  trailSpacing: [
    {
      nodeName: 'OperatingLine Trail Rows',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Start Location',
      valueKind: 'vector_component',
      componentIndex: 1,
      componentLabel: 'Y',
      projection: 'centered_rows_y_from_spacing',
    },
    {
      nodeName: 'OperatingLine Trail Rows',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Offset',
      valueKind: 'vector_component',
      componentIndex: 1,
      componentLabel: 'Y',
      projection: 'identity',
    },
  ],
  noiseScale: [
    {
      nodeName: 'OperatingLine Terrain Noise',
      nodeType: 'ShaderNodeTexNoise',
      socketIdentifier: 'Scale',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  noiseDetail: [
    {
      nodeName: 'OperatingLine Terrain Noise',
      nodeType: 'ShaderNodeTexNoise',
      socketIdentifier: 'Detail',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  noiseRoughness: [
    {
      nodeName: 'OperatingLine Terrain Noise',
      nodeType: 'ShaderNodeTexNoise',
      socketIdentifier: 'Roughness',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  noiseSeed: [
    {
      nodeName: 'OperatingLine Terrain Noise',
      nodeType: 'ShaderNodeTexNoise',
      socketIdentifier: 'W',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  height: [
    {
      nodeName: 'OperatingLine Scale Height',
      nodeType: 'ShaderNodeMath',
      socketIdentifier: 'Value_001',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  profileSides: [
    {
      nodeName: 'OperatingLine Trail Profile',
      nodeType: 'GeometryNodeCurvePrimitiveCircle',
      socketIdentifier: 'Resolution',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  profileRadius: [
    {
      nodeName: 'OperatingLine Trail Profile',
      nodeType: 'GeometryNodeCurvePrimitiveCircle',
      socketIdentifier: 'Radius',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
  ],
  tileRepeatCount: [
    {
      nodeName: 'OperatingLine Loop Tiles',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Count',
      valueKind: 'scalar',
      componentIndex: null,
      componentLabel: null,
      projection: 'identity',
    },
    {
      nodeName: 'OperatingLine Loop Tiles',
      nodeType: 'GeometryNodeMeshLine',
      socketIdentifier: 'Start Location',
      valueKind: 'vector_component',
      componentIndex: 0,
      componentLabel: 'X',
      projection: 'centered_tiles_x_from_count',
    },
  ],
} as const;
const lightTrailsRnaControlArgumentByOrdinal: Readonly<
  Record<number, keyof typeof lightTrailsRnaControlBinding>
> = {
  5: 'tileLength',
  7: 'pointsPerTrail',
  9: 'trailCount',
  10: 'trailSpacing',
  15: 'noiseScale',
  16: 'noiseDetail',
  17: 'noiseRoughness',
  18: 'noiseSeed',
  21: 'height',
  27: 'profileSides',
  28: 'profileRadius',
  31: 'tileRepeatCount',
};

const lightTrailsRnaInitializationSourceOperationIds = [
  'node.light_trails.half_tile_line',
  'node.light_trails.trail_resolution',
  'node.light_trails.trail_rows',
  'node.light_trails.terrain_noise',
  'node.light_trails.center_noise',
  'node.light_trails.scale_height',
  'node.light_trails.mirror_half_tile',
  'node.light_trails.trail_profile',
  'node.light_trails.loop_tiles',
] as const;
type LightTrailsRnaInitializationSourceOperationId =
  (typeof lightTrailsRnaInitializationSourceOperationIds)[number];
type LightTrailsRnaInitializationTarget = {
  readonly nodeName: string;
  readonly nodeType: string;
  readonly targetKind: 'node_property' | 'input_socket';
  readonly socketIdentifier: string | null;
  readonly propertyName: 'mode' | 'noise_dimensions' | 'operation' | 'default_value';
  readonly valueKind: 'enum' | 'scalar' | 'vector_component';
  readonly componentIndex: 0 | 1 | 2 | null;
  readonly componentLabel: 'X' | 'Y' | 'Z' | null;
  readonly valueSource: 'catalog_constant' | 'accepted_action_argument';
  readonly actionArgument: 'tileLength' | null;
  readonly assignedValue?: string | number;
  readonly uiTarget: string;
  readonly uiComponent: string;
};

const initializationNodePropertyTarget = (
  nodeName: string,
  nodeType: string,
  propertyName: 'mode' | 'noise_dimensions' | 'operation',
  assignedValue: string,
  uiComponent: string,
): LightTrailsRnaInitializationTarget => ({
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

const initializationSocketTarget = (
  nodeName: string,
  nodeType: string,
  socketIdentifier: string,
  assignedValue: number | undefined,
  componentIndex: 0 | 1 | 2 | null = null,
  componentLabel: 'X' | 'Y' | 'Z' | null = null,
  valueSource: 'catalog_constant' | 'accepted_action_argument' = 'catalog_constant',
  actionArgument: 'tileLength' | null = null,
): LightTrailsRnaInitializationTarget => ({
  nodeName,
  nodeType,
  targetKind: 'input_socket',
  socketIdentifier,
  propertyName: 'default_value',
  valueKind: componentIndex === null ? 'scalar' : 'vector_component',
  componentIndex,
  componentLabel,
  valueSource,
  actionArgument,
  ...(assignedValue === undefined ? {} : { assignedValue }),
  uiTarget: socketIdentifier,
  uiComponent: componentLabel ?? 'Value',
});

const lightTrailsRnaInitializationTargetsBySource: Readonly<
  Record<
    LightTrailsRnaInitializationSourceOperationId,
    readonly LightTrailsRnaInitializationTarget[]
  >
> = {
  'node.light_trails.half_tile_line': [
    initializationNodePropertyTarget(
      'OperatingLine Half Tile Line',
      'GeometryNodeCurvePrimitiveLine',
      'mode',
      'POINTS',
      'Mode',
    ),
    ...([-0.5, 0, 0] as const).map((value, componentIndex) =>
      initializationSocketTarget(
        'OperatingLine Half Tile Line',
        'GeometryNodeCurvePrimitiveLine',
        'Start',
        value,
        componentIndex as 0 | 1 | 2,
        transformGeometryComponentLabels[componentIndex],
      ),
    ),
    ...([0, 0, 0] as const).map((value, componentIndex) =>
      initializationSocketTarget(
        'OperatingLine Half Tile Line',
        'GeometryNodeCurvePrimitiveLine',
        'End',
        value,
        componentIndex as 0 | 1 | 2,
        transformGeometryComponentLabels[componentIndex],
      ),
    ),
  ],
  'node.light_trails.trail_resolution': [
    initializationSocketTarget(
      'OperatingLine Trail Resolution',
      'GeometryNodeResampleCurve',
      'Count',
      10,
    ),
  ],
  'node.light_trails.trail_rows': [
    initializationNodePropertyTarget(
      'OperatingLine Trail Rows',
      'GeometryNodeMeshLine',
      'mode',
      'OFFSET',
      'Mode',
    ),
    initializationSocketTarget('OperatingLine Trail Rows', 'GeometryNodeMeshLine', 'Count', 1),
    ...([0, 0, 0] as const).map((value, componentIndex) =>
      initializationSocketTarget(
        'OperatingLine Trail Rows',
        'GeometryNodeMeshLine',
        'Start Location',
        value,
        componentIndex as 0 | 1 | 2,
        transformGeometryComponentLabels[componentIndex],
      ),
    ),
    ...([0, 1, 0] as const).map((value, componentIndex) =>
      initializationSocketTarget(
        'OperatingLine Trail Rows',
        'GeometryNodeMeshLine',
        'Offset',
        value,
        componentIndex as 0 | 1 | 2,
        transformGeometryComponentLabels[componentIndex],
      ),
    ),
  ],
  'node.light_trails.terrain_noise': [
    initializationNodePropertyTarget(
      'OperatingLine Terrain Noise',
      'ShaderNodeTexNoise',
      'noise_dimensions',
      '4D',
      'Dimensions',
    ),
    ...(
      [
        ['Scale', 1],
        ['Detail', 2],
        ['Roughness', 0.5],
        ['W', 0],
      ] as const
    ).map(([socketIdentifier, value]) =>
      initializationSocketTarget(
        'OperatingLine Terrain Noise',
        'ShaderNodeTexNoise',
        socketIdentifier,
        value,
      ),
    ),
  ],
  'node.light_trails.center_noise': [
    initializationNodePropertyTarget(
      'OperatingLine Center Noise',
      'ShaderNodeMath',
      'operation',
      'SUBTRACT',
      'Operation',
    ),
    initializationSocketTarget('OperatingLine Center Noise', 'ShaderNodeMath', 'Value_001', 0.5),
  ],
  'node.light_trails.scale_height': [
    initializationNodePropertyTarget(
      'OperatingLine Scale Height',
      'ShaderNodeMath',
      'operation',
      'MULTIPLY',
      'Operation',
    ),
    initializationSocketTarget('OperatingLine Scale Height', 'ShaderNodeMath', 'Value_001', 0),
  ],
  'node.light_trails.mirror_half_tile': ([-1, 1, 1] as const).map((value, componentIndex) =>
    initializationSocketTarget(
      'OperatingLine Mirror Half Tile',
      'GeometryNodeTransform',
      'Scale',
      value,
      componentIndex as 0 | 1 | 2,
      transformGeometryComponentLabels[componentIndex],
    ),
  ),
  'node.light_trails.trail_profile': [
    initializationNodePropertyTarget(
      'OperatingLine Trail Profile',
      'GeometryNodeCurvePrimitiveCircle',
      'mode',
      'RADIUS',
      'Mode',
    ),
    initializationSocketTarget(
      'OperatingLine Trail Profile',
      'GeometryNodeCurvePrimitiveCircle',
      'Resolution',
      3,
    ),
    initializationSocketTarget(
      'OperatingLine Trail Profile',
      'GeometryNodeCurvePrimitiveCircle',
      'Radius',
      0.1,
    ),
  ],
  'node.light_trails.loop_tiles': [
    initializationNodePropertyTarget(
      'OperatingLine Loop Tiles',
      'GeometryNodeMeshLine',
      'mode',
      'OFFSET',
      'Mode',
    ),
    initializationSocketTarget('OperatingLine Loop Tiles', 'GeometryNodeMeshLine', 'Count', 1),
    ...([0, 0, 0] as const).map((value, componentIndex) =>
      initializationSocketTarget(
        'OperatingLine Loop Tiles',
        'GeometryNodeMeshLine',
        'Start Location',
        value,
        componentIndex as 0 | 1 | 2,
        transformGeometryComponentLabels[componentIndex],
      ),
    ),
    initializationSocketTarget(
      'OperatingLine Loop Tiles',
      'GeometryNodeMeshLine',
      'Offset',
      undefined,
      0,
      'X',
      'accepted_action_argument',
      'tileLength',
    ),
    initializationSocketTarget(
      'OperatingLine Loop Tiles',
      'GeometryNodeMeshLine',
      'Offset',
      0,
      1,
      'Y',
    ),
    initializationSocketTarget(
      'OperatingLine Loop Tiles',
      'GeometryNodeMeshLine',
      'Offset',
      0,
      2,
      'Z',
    ),
  ],
};

function lightTrailsRnaInitializationTargets(
  sourceOperationId: string,
): readonly LightTrailsRnaInitializationTarget[] {
  return lightTrailsRnaInitializationSourceOperationIds.includes(
    sourceOperationId as LightTrailsRnaInitializationSourceOperationId,
  )
    ? lightTrailsRnaInitializationTargetsBySource[
        sourceOperationId as LightTrailsRnaInitializationSourceOperationId
      ]
    : [];
}

const lightTrailsRnaLinkSourceOperationIds = [
  'semantic.connect_light_trails.half_line_to_resolution',
  'semantic.connect_light_trails.rows_to_instances',
  'semantic.connect_light_trails.resolution_to_instances',
  'semantic.connect_light_trails.instances_to_realize',
  'semantic.connect_light_trails.position_to_noise',
  'semantic.connect_light_trails.noise_to_center',
  'semantic.connect_light_trails.center_to_height',
  'semantic.connect_light_trails.height_to_offset',
  'semantic.connect_light_trails.realize_to_displace',
  'semantic.connect_light_trails.offset_to_displace',
  'semantic.connect_light_trails.displace_to_mirror',
  'semantic.connect_light_trails.displace_to_join',
  'semantic.connect_light_trails.mirror_to_join',
  'semantic.connect_light_trails.join_to_curve_mesh',
  'semantic.connect_light_trails.profile_to_curve_mesh',
  'semantic.connect_light_trails.tiles_to_instances',
  'semantic.connect_light_trails.mesh_to_instances',
  'semantic.connect_light_trails.instances_to_final_realize',
  'semantic.connect_light_trails.realize_to_output',
] as const;
type LightTrailsRnaLinkSourceOperationId = (typeof lightTrailsRnaLinkSourceOperationIds)[number];
type LightTrailsRnaLinkTarget = {
  readonly fromNodeName: string;
  readonly fromNodeType: string;
  readonly fromSocketIdentifier: string;
  readonly toNodeName: string;
  readonly toNodeType: string;
  readonly toSocketIdentifier: string;
};

const linkTarget = (
  fromNodeName: string,
  fromNodeType: string,
  fromSocketIdentifier: string,
  toNodeName: string,
  toNodeType: string,
  toSocketIdentifier: string,
): LightTrailsRnaLinkTarget => ({
  fromNodeName,
  fromNodeType,
  fromSocketIdentifier,
  toNodeName,
  toNodeType,
  toSocketIdentifier,
});

const lightTrailsRnaLinkTargetsBySource: Readonly<
  Record<LightTrailsRnaLinkSourceOperationId, LightTrailsRnaLinkTarget>
> = {
  'semantic.connect_light_trails.half_line_to_resolution': linkTarget(
    'OperatingLine Half Tile Line',
    'GeometryNodeCurvePrimitiveLine',
    'Curve',
    'OperatingLine Trail Resolution',
    'GeometryNodeResampleCurve',
    'Curve',
  ),
  'semantic.connect_light_trails.rows_to_instances': linkTarget(
    'OperatingLine Trail Rows',
    'GeometryNodeMeshLine',
    'Mesh',
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Points',
  ),
  'semantic.connect_light_trails.resolution_to_instances': linkTarget(
    'OperatingLine Trail Resolution',
    'GeometryNodeResampleCurve',
    'Curve',
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Instance',
  ),
  'semantic.connect_light_trails.instances_to_realize': linkTarget(
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
    'Instances',
    'OperatingLine Realize Trails',
    'GeometryNodeRealizeInstances',
    'Geometry',
  ),
  'semantic.connect_light_trails.position_to_noise': linkTarget(
    'OperatingLine Trail Position',
    'GeometryNodeInputPosition',
    'Position',
    'OperatingLine Terrain Noise',
    'ShaderNodeTexNoise',
    'Vector',
  ),
  'semantic.connect_light_trails.noise_to_center': linkTarget(
    'OperatingLine Terrain Noise',
    'ShaderNodeTexNoise',
    'Fac',
    'OperatingLine Center Noise',
    'ShaderNodeMath',
    'Value',
  ),
  'semantic.connect_light_trails.center_to_height': linkTarget(
    'OperatingLine Center Noise',
    'ShaderNodeMath',
    'Value',
    'OperatingLine Scale Height',
    'ShaderNodeMath',
    'Value',
  ),
  'semantic.connect_light_trails.height_to_offset': linkTarget(
    'OperatingLine Scale Height',
    'ShaderNodeMath',
    'Value',
    'OperatingLine Z Offset',
    'ShaderNodeCombineXYZ',
    'Z',
  ),
  'semantic.connect_light_trails.realize_to_displace': linkTarget(
    'OperatingLine Realize Trails',
    'GeometryNodeRealizeInstances',
    'Geometry',
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
  ),
  'semantic.connect_light_trails.offset_to_displace': linkTarget(
    'OperatingLine Z Offset',
    'ShaderNodeCombineXYZ',
    'Vector',
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Offset',
  ),
  'semantic.connect_light_trails.displace_to_mirror': linkTarget(
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
    'OperatingLine Mirror Half Tile',
    'GeometryNodeTransform',
    'Geometry',
  ),
  'semantic.connect_light_trails.displace_to_join': linkTarget(
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
    'Geometry',
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
  ),
  'semantic.connect_light_trails.mirror_to_join': linkTarget(
    'OperatingLine Mirror Half Tile',
    'GeometryNodeTransform',
    'Geometry',
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
  ),
  'semantic.connect_light_trails.join_to_curve_mesh': linkTarget(
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
    'Geometry',
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Curve',
  ),
  'semantic.connect_light_trails.profile_to_curve_mesh': linkTarget(
    'OperatingLine Trail Profile',
    'GeometryNodeCurvePrimitiveCircle',
    'Curve',
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Profile Curve',
  ),
  'semantic.connect_light_trails.tiles_to_instances': linkTarget(
    'OperatingLine Loop Tiles',
    'GeometryNodeMeshLine',
    'Mesh',
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Points',
  ),
  'semantic.connect_light_trails.mesh_to_instances': linkTarget(
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
    'Mesh',
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Instance',
  ),
  'semantic.connect_light_trails.instances_to_final_realize': linkTarget(
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
    'Instances',
    'OperatingLine Realize Tiles',
    'GeometryNodeRealizeInstances',
    'Geometry',
  ),
  'semantic.connect_light_trails.realize_to_output': linkTarget(
    'OperatingLine Realize Tiles',
    'GeometryNodeRealizeInstances',
    'Geometry',
    'OperatingLine Output',
    'NodeGroupOutput',
    'Geometry',
  ),
};

function lightTrailsRnaLinkTarget(sourceOperationId: string): LightTrailsRnaLinkTarget | undefined {
  return lightTrailsRnaLinkSourceOperationIds.includes(
    sourceOperationId as LightTrailsRnaLinkSourceOperationId,
  )
    ? lightTrailsRnaLinkTargetsBySource[sourceOperationId as LightTrailsRnaLinkSourceOperationId]
    : undefined;
}

const lightTrailsRnaStructureSourceOperationIds = [
  'node.light_trails.group_input',
  'node.light_trails.half_tile_line',
  'node.light_trails.trail_resolution',
  'node.light_trails.trail_rows',
  'node.light_trails.trail_instances',
  'node.light_trails.realize_trails',
  'node.light_trails.trail_position',
  'node.light_trails.terrain_noise',
  'node.light_trails.center_noise',
  'node.light_trails.scale_height',
  'node.light_trails.z_offset',
  'node.light_trails.displace_trails',
  'node.light_trails.mirror_half_tile',
  'node.light_trails.mirrored_tile',
  'node.light_trails.trail_profile',
  'node.light_trails.curve_to_mesh',
  'node.light_trails.loop_tiles',
  'node.light_trails.tile_instances',
  'node.light_trails.realize_tiles',
  'node.light_trails.group_output',
] as const;
type LightTrailsRnaStructureSourceOperationId =
  (typeof lightTrailsRnaStructureSourceOperationIds)[number];
type LightTrailsRnaStructureTarget =
  | {
      readonly structureKind: 'node';
      readonly nodeName: string;
      readonly nodeType: string;
    }
  | {
      readonly structureKind: 'interface_socket';
      readonly interfaceSocketName: 'Geometry';
      readonly interfaceDirection: 'INPUT' | 'OUTPUT';
      readonly interfaceSocketType: 'NodeSocketGeometry';
    };

const structureTargets = (
  nodeName: string,
  nodeType: string,
  interfaceDirection?: 'INPUT' | 'OUTPUT',
): readonly LightTrailsRnaStructureTarget[] => [
  ...(interfaceDirection === undefined
    ? []
    : [
        {
          structureKind: 'interface_socket' as const,
          interfaceSocketName: 'Geometry' as const,
          interfaceDirection,
          interfaceSocketType: 'NodeSocketGeometry' as const,
        },
      ]),
  { structureKind: 'node', nodeName, nodeType },
];

const lightTrailsRnaStructureTargetsBySource: Readonly<
  Record<LightTrailsRnaStructureSourceOperationId, readonly LightTrailsRnaStructureTarget[]>
> = {
  'node.light_trails.group_input': structureTargets(
    'OperatingLine Input',
    'NodeGroupInput',
    'INPUT',
  ),
  'node.light_trails.half_tile_line': structureTargets(
    'OperatingLine Half Tile Line',
    'GeometryNodeCurvePrimitiveLine',
  ),
  'node.light_trails.trail_resolution': structureTargets(
    'OperatingLine Trail Resolution',
    'GeometryNodeResampleCurve',
  ),
  'node.light_trails.trail_rows': structureTargets(
    'OperatingLine Trail Rows',
    'GeometryNodeMeshLine',
  ),
  'node.light_trails.trail_instances': structureTargets(
    'OperatingLine Trail Instances',
    'GeometryNodeInstanceOnPoints',
  ),
  'node.light_trails.realize_trails': structureTargets(
    'OperatingLine Realize Trails',
    'GeometryNodeRealizeInstances',
  ),
  'node.light_trails.trail_position': structureTargets(
    'OperatingLine Trail Position',
    'GeometryNodeInputPosition',
  ),
  'node.light_trails.terrain_noise': structureTargets(
    'OperatingLine Terrain Noise',
    'ShaderNodeTexNoise',
  ),
  'node.light_trails.center_noise': structureTargets(
    'OperatingLine Center Noise',
    'ShaderNodeMath',
  ),
  'node.light_trails.scale_height': structureTargets(
    'OperatingLine Scale Height',
    'ShaderNodeMath',
  ),
  'node.light_trails.z_offset': structureTargets('OperatingLine Z Offset', 'ShaderNodeCombineXYZ'),
  'node.light_trails.displace_trails': structureTargets(
    'OperatingLine Displace Trails',
    'GeometryNodeSetPosition',
  ),
  'node.light_trails.mirror_half_tile': structureTargets(
    'OperatingLine Mirror Half Tile',
    'GeometryNodeTransform',
  ),
  'node.light_trails.mirrored_tile': structureTargets(
    'OperatingLine Mirrored Tile',
    'GeometryNodeJoinGeometry',
  ),
  'node.light_trails.trail_profile': structureTargets(
    'OperatingLine Trail Profile',
    'GeometryNodeCurvePrimitiveCircle',
  ),
  'node.light_trails.curve_to_mesh': structureTargets(
    'OperatingLine Curve To Mesh',
    'GeometryNodeCurveToMesh',
  ),
  'node.light_trails.loop_tiles': structureTargets(
    'OperatingLine Loop Tiles',
    'GeometryNodeMeshLine',
  ),
  'node.light_trails.tile_instances': structureTargets(
    'OperatingLine Tile Instances',
    'GeometryNodeInstanceOnPoints',
  ),
  'node.light_trails.realize_tiles': structureTargets(
    'OperatingLine Realize Tiles',
    'GeometryNodeRealizeInstances',
  ),
  'node.light_trails.group_output': structureTargets(
    'OperatingLine Output',
    'NodeGroupOutput',
    'OUTPUT',
  ),
};

function lightTrailsRnaStructureTargets(
  sourceOperationId: string,
): readonly LightTrailsRnaStructureTarget[] {
  return lightTrailsRnaStructureSourceOperationIds.includes(
    sourceOperationId as LightTrailsRnaStructureSourceOperationId,
  )
    ? lightTrailsRnaStructureTargetsBySource[
        sourceOperationId as LightTrailsRnaStructureSourceOperationId
      ]
    : [];
}

export const companionLeafOperationLightTrailsRnaControlWriteSchema = z
  .strictObject({
    order: z.number().int().min(1).max(2),
    executionMethod: z.literal('blender_rna_property_write'),
    mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
    sourceOperationId: z.enum([
      'projection.semantic.light_trails.tile_length',
      'projection.semantic.light_trails.points_per_trail',
      'projection.semantic.light_trails.trail_count',
      'projection.semantic.light_trails.trail_spacing',
      'projection.semantic.light_trails.noise_scale',
      'projection.semantic.light_trails.noise_detail',
      'projection.semantic.light_trails.noise_roughness',
      'projection.semantic.light_trails.noise_seed',
      'projection.semantic.light_trails.height',
      'projection.semantic.light_trails.profile_sides',
      'projection.semantic.light_trails.profile_radius',
      'projection.semantic.light_trails.tile_repeat_count',
    ]),
    semanticAction: z.enum([
      'node.light_trails.half_tile_line',
      'node.light_trails.trail_resolution',
      'node.light_trails.trail_rows',
      'node.light_trails.terrain_noise',
      'node.light_trails.scale_height',
      'node.light_trails.trail_profile',
      'node.light_trails.loop_tiles',
    ]),
    actionArgument: z.enum(lightTrailsActionArguments),
    nodeGroupId: z.string().min(1),
    nodeGroupName: z.string().min(1),
    nodeName: z.enum([
      'OperatingLine Half Tile Line',
      'OperatingLine Trail Resolution',
      'OperatingLine Trail Rows',
      'OperatingLine Terrain Noise',
      'OperatingLine Scale Height',
      'OperatingLine Trail Profile',
      'OperatingLine Loop Tiles',
    ]),
    nodeType: z.enum([
      'GeometryNodeCurvePrimitiveLine',
      'GeometryNodeResampleCurve',
      'GeometryNodeMeshLine',
      'ShaderNodeTexNoise',
      'ShaderNodeMath',
      'GeometryNodeCurvePrimitiveCircle',
    ]),
    socketIdentifier: z.enum([
      'Start',
      'Count',
      'Start Location',
      'Offset',
      'Scale',
      'Detail',
      'Roughness',
      'W',
      'Value_001',
      'Resolution',
      'Radius',
    ]),
    propertyName: z.literal('default_value'),
    valueKind: z.enum(['scalar', 'vector_component']),
    componentIndex: z.number().int().min(0).max(2).nullable(),
    componentLabel: z.enum(transformGeometryComponentLabels).nullable(),
    projection: z.enum([
      'identity',
      'negative_half_x',
      'centered_rows_y_from_count',
      'centered_rows_y_from_spacing',
      'centered_tiles_x_from_count',
    ]),
    beforeValue: z.number().finite(),
    acceptedValue: z.number().finite(),
    projectedValue: z.number().finite(),
    observedValue: z.number().finite(),
    uiPath: z.tuple([
      z.literal('Geometry Nodes'),
      z.string().min(1),
      z.string().min(1),
      z.string().min(1),
      z.enum(['Value', ...transformGeometryComponentLabels]),
    ]),
  })
  .superRefine((write, context) => {
    const binding = lightTrailsRnaControlBinding[write.actionArgument];
    const target = lightTrailsRnaControlTargets[write.actionArgument][write.order - 1];
    const scalar = write.valueKind === 'scalar';
    if (
      target === undefined ||
      write.sourceOperationId !== binding.sourceOperationId ||
      write.semanticAction !== binding.semanticAction ||
      write.nodeName !== target?.nodeName ||
      write.nodeType !== target?.nodeType ||
      write.socketIdentifier !== target?.socketIdentifier ||
      write.valueKind !== target?.valueKind ||
      write.componentIndex !== target?.componentIndex ||
      write.componentLabel !== target?.componentLabel ||
      write.projection !== target?.projection ||
      write.uiPath[1] !== write.nodeGroupName ||
      write.uiPath[2] !== write.nodeName ||
      write.uiPath[3] !== write.socketIdentifier ||
      (scalar
        ? write.componentIndex !== null ||
          write.componentLabel !== null ||
          write.uiPath[4] !== 'Value'
        : write.componentIndex === null ||
          write.componentLabel !== transformGeometryComponentLabels[write.componentIndex] ||
          write.uiPath[4] !== write.componentLabel)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A Light Trails RNA write must bind its exact operation, argument, component, and UI path',
      });
    }
  });

export const companionLeafOperationLightTrailsRnaInitializationWriteSchema = z
  .strictObject({
    order: z.number().int().min(1).max(8),
    executionMethod: z.literal('blender_rna_property_write'),
    mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
    sourceOperationId: z.enum(lightTrailsRnaInitializationSourceOperationIds),
    semanticAction: z.enum(lightTrailsRnaInitializationSourceOperationIds),
    nodeGroupId: z.string().min(1),
    nodeGroupName: z.string().min(1),
    nodeName: z.enum([
      'OperatingLine Half Tile Line',
      'OperatingLine Trail Resolution',
      'OperatingLine Trail Rows',
      'OperatingLine Terrain Noise',
      'OperatingLine Center Noise',
      'OperatingLine Scale Height',
      'OperatingLine Mirror Half Tile',
      'OperatingLine Trail Profile',
      'OperatingLine Loop Tiles',
    ]),
    nodeType: z.enum([
      'GeometryNodeCurvePrimitiveLine',
      'GeometryNodeResampleCurve',
      'GeometryNodeMeshLine',
      'ShaderNodeTexNoise',
      'ShaderNodeMath',
      'GeometryNodeTransform',
      'GeometryNodeCurvePrimitiveCircle',
    ]),
    targetKind: z.enum(['node_property', 'input_socket']),
    socketIdentifier: z
      .enum([
        'Start',
        'End',
        'Count',
        'Start Location',
        'Offset',
        'Scale',
        'Detail',
        'Roughness',
        'W',
        'Value_001',
        'Resolution',
        'Radius',
      ])
      .nullable(),
    propertyName: z.enum(['mode', 'noise_dimensions', 'operation', 'default_value']),
    valueKind: z.enum(['enum', 'scalar', 'vector_component']),
    componentIndex: z.number().int().min(0).max(2).nullable(),
    componentLabel: z.enum(transformGeometryComponentLabels).nullable(),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.literal('tileLength').nullable(),
    assignedValue: z.union([z.number().finite(), z.string().min(1)]),
    observedValue: z.union([z.number().finite(), z.string().min(1)]),
    uiPath: z.tuple([
      z.literal('Geometry Nodes'),
      z.string().min(1),
      z.string().min(1),
      z.string().min(1),
      z.enum(['Mode', 'Dimensions', 'Operation', 'Value', 'X', 'Y', 'Z']),
    ]),
  })
  .superRefine((write, context) => {
    const target = lightTrailsRnaInitializationTargets(write.sourceOperationId)[write.order - 1];
    const observedMatchesAssigned =
      typeof write.assignedValue === typeof write.observedValue &&
      (typeof write.assignedValue === 'number' && typeof write.observedValue === 'number'
        ? Math.abs(write.assignedValue - write.observedValue) <=
          Math.max(1e-7, Math.abs(write.assignedValue) * 1e-6)
        : write.assignedValue === write.observedValue);
    if (
      target === undefined ||
      write.semanticAction !== write.sourceOperationId ||
      write.nodeName !== target?.nodeName ||
      write.nodeType !== target?.nodeType ||
      write.targetKind !== target?.targetKind ||
      write.socketIdentifier !== target?.socketIdentifier ||
      write.propertyName !== target?.propertyName ||
      write.valueKind !== target?.valueKind ||
      write.componentIndex !== target?.componentIndex ||
      write.componentLabel !== target?.componentLabel ||
      write.valueSource !== target?.valueSource ||
      write.actionArgument !== target?.actionArgument ||
      (target?.assignedValue !== undefined && write.assignedValue !== target.assignedValue) ||
      !observedMatchesAssigned ||
      write.uiPath[1] !== write.nodeGroupName ||
      write.uiPath[2] !== write.nodeName ||
      write.uiPath[3] !== target?.uiTarget ||
      write.uiPath[4] !== target?.uiComponent
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A Light Trails initialization write must match its exact node property or socket target',
      });
    }
  });
export type CompanionLeafOperationLightTrailsRnaInitializationWrite = z.infer<
  typeof companionLeafOperationLightTrailsRnaInitializationWriteSchema
>;

export const companionLeafOperationLightTrailsRnaLinkCreationSchema = z
  .strictObject({
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_node_link_create'),
    mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
    sourceOperationId: z.enum(lightTrailsRnaLinkSourceOperationIds),
    semanticAction: z.enum(lightTrailsRnaLinkSourceOperationIds),
    nodeGroupId: z.string().min(1),
    nodeGroupName: z.string().min(1),
    fromNodeName: z.string().min(1),
    fromNodeType: z.string().min(1),
    fromSocketIdentifier: z.string().min(1),
    fromSocketDirection: z.literal('OUTPUT'),
    toNodeName: z.string().min(1),
    toNodeType: z.string().min(1),
    toSocketIdentifier: z.string().min(1),
    toSocketDirection: z.literal('INPUT'),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('Geometry Nodes'),
      z.string().min(1),
      z.string().min(1),
      z.string().min(1),
      z.string().min(1),
      z.string().min(1),
    ]),
  })
  .superRefine((creation, context) => {
    const target = lightTrailsRnaLinkTarget(creation.sourceOperationId);
    if (
      target === undefined ||
      creation.semanticAction !== creation.sourceOperationId ||
      creation.fromNodeName !== target.fromNodeName ||
      creation.fromNodeType !== target.fromNodeType ||
      creation.fromSocketIdentifier !== target.fromSocketIdentifier ||
      creation.toNodeName !== target.toNodeName ||
      creation.toNodeType !== target.toNodeType ||
      creation.toSocketIdentifier !== target.toSocketIdentifier ||
      creation.uiPath[1] !== creation.nodeGroupName ||
      creation.uiPath[2] !== creation.fromNodeName ||
      creation.uiPath[3] !== creation.fromSocketIdentifier ||
      creation.uiPath[4] !== creation.toNodeName ||
      creation.uiPath[5] !== creation.toSocketIdentifier
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A Light Trails RNA link creation must match its exact reviewed endpoints',
      });
    }
  });
export type CompanionLeafOperationLightTrailsRnaLinkCreation = z.infer<
  typeof companionLeafOperationLightTrailsRnaLinkCreationSchema
>;

const companionLeafOperationLightTrailsRnaNodeCreationSchema = z.strictObject({
  order: z.number().int().min(1).max(2),
  executionMethod: z.literal('blender_rna_node_create'),
  mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
  sourceOperationId: z.enum(lightTrailsRnaStructureSourceOperationIds),
  semanticAction: z.enum(lightTrailsRnaStructureSourceOperationIds),
  nodeGroupId: z.string().min(1),
  nodeGroupName: z.string().min(1),
  structureKind: z.literal('node'),
  nodeName: z.string().min(1),
  nodeType: z.string().min(1),
  observedNode: z.literal(true),
  uiPath: z.tuple([
    z.literal('Geometry Nodes'),
    z.string().min(1),
    z.literal('Nodes'),
    z.string().min(1),
  ]),
});

const companionLeafOperationLightTrailsRnaInterfaceSocketCreationSchema = z.strictObject({
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_node_group_interface_socket_create'),
  mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
  sourceOperationId: z.enum(lightTrailsRnaStructureSourceOperationIds),
  semanticAction: z.enum(lightTrailsRnaStructureSourceOperationIds),
  nodeGroupId: z.string().min(1),
  nodeGroupName: z.string().min(1),
  structureKind: z.literal('interface_socket'),
  interfaceSocketName: z.literal('Geometry'),
  interfaceDirection: z.enum(['INPUT', 'OUTPUT']),
  interfaceSocketType: z.literal('NodeSocketGeometry'),
  observedInterfaceSocket: z.literal(true),
  uiPath: z.tuple([
    z.literal('Geometry Nodes'),
    z.string().min(1),
    z.literal('Interface'),
    z.enum(['INPUT', 'OUTPUT']),
    z.literal('Geometry'),
  ]),
});

export const companionLeafOperationLightTrailsRnaStructureCreationSchema = z.discriminatedUnion(
  'structureKind',
  [
    companionLeafOperationLightTrailsRnaNodeCreationSchema,
    companionLeafOperationLightTrailsRnaInterfaceSocketCreationSchema,
  ],
);
export type CompanionLeafOperationLightTrailsRnaStructureCreation = z.infer<
  typeof companionLeafOperationLightTrailsRnaStructureCreationSchema
>;

export const companionLeafOperationRnaControlWriteSchema = z.union([
  companionLeafOperationTransformRnaControlWriteSchema,
  companionLeafOperationLightTrailsRnaControlWriteSchema,
]);
export type CompanionLeafOperationRnaControlWrite = z.infer<
  typeof companionLeafOperationRnaControlWriteSchema
>;

export const companionLeafOperationRnaControlWritesSchema = z
  .array(companionLeafOperationRnaControlWriteSchema)
  .max(3)
  .superRefine((writes, context) => {
    const mixedTools = new Set(writes.map((write) => write.mcpTool)).size > 1;
    const transformWrites = writes.filter(
      (write) => write.mcpTool === 'operatingline.blender.geometry-nodes.transform.execute-next',
    );
    const invalidOrder = writes.some((write, index) => write.order !== index + 1);
    const invalidTransformOrder = transformWrites.some(
      (write, index) =>
        write.componentIndex !== index ||
        write.componentLabel !== transformGeometryComponentLabels[index],
    );
    const transformArgument = transformWrites[0]?.actionArgument;
    const invalidTransformSet =
      transformArgument !== undefined &&
      (transformWrites.length !== transformGeometryComponentLabels.length ||
        transformWrites.some((write) => write.actionArgument !== transformArgument));
    const lightTrailsWrites = writes.filter(
      (write) => write.mcpTool === 'operatingline.blender.geometry-nodes.light-trails.execute-next',
    );
    const lightTrailsArgument = lightTrailsWrites[0]?.actionArgument;
    const invalidLightTrailsSet =
      lightTrailsArgument !== undefined &&
      (lightTrailsWrites.length !== lightTrailsRnaControlTargets[lightTrailsArgument].length ||
        lightTrailsWrites.some((write) => write.actionArgument !== lightTrailsArgument));
    if (
      mixedTools ||
      invalidOrder ||
      invalidTransformOrder ||
      invalidTransformSet ||
      invalidLightTrailsSet
    ) {
      context.addIssue({
        code: 'custom',
        message: 'RNA control writes must preserve one executor and exact array order',
      });
    }
  });

export const companionLeafOperationRnaInitializationWritesSchema = z
  .array(companionLeafOperationLightTrailsRnaInitializationWriteSchema)
  .max(8)
  .superRefine((writes, context) => {
    const sourceOperationId = writes[0]?.sourceOperationId;
    const expectedTargets =
      sourceOperationId === undefined ? [] : lightTrailsRnaInitializationTargets(sourceOperationId);
    if (
      (sourceOperationId !== undefined && writes.length !== expectedTargets.length) ||
      writes.some(
        (write, index) =>
          write.order !== index + 1 || write.sourceOperationId !== sourceOperationId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'RNA initialization writes must preserve the exact complete source-operation target set',
      });
    }
  });
export type CompanionLeafOperationRnaInitializationWrites = z.infer<
  typeof companionLeafOperationRnaInitializationWritesSchema
>;

export const companionLeafOperationRnaLinkCreationsSchema = z
  .array(companionLeafOperationLightTrailsRnaLinkCreationSchema)
  .max(1)
  .superRefine((creations, context) => {
    if (creations.some((creation) => creation.order !== 1)) {
      context.addIssue({
        code: 'custom',
        message: 'RNA link creations must preserve the exact one-link operation order',
      });
    }
  });
export type CompanionLeafOperationRnaLinkCreations = z.infer<
  typeof companionLeafOperationRnaLinkCreationsSchema
>;

export const companionLeafOperationRnaStructureCreationsSchema = z
  .array(companionLeafOperationLightTrailsRnaStructureCreationSchema)
  .max(2)
  .superRefine((creations, context) => {
    const sourceOperationId = creations[0]?.sourceOperationId;
    const expectedTargets =
      sourceOperationId === undefined ? [] : lightTrailsRnaStructureTargets(sourceOperationId);
    const invalid =
      (sourceOperationId !== undefined && creations.length !== expectedTargets.length) ||
      creations.some((creation, index) => {
        const target = expectedTargets[index];
        if (
          target === undefined ||
          creation.order !== index + 1 ||
          creation.sourceOperationId !== sourceOperationId ||
          creation.semanticAction !== sourceOperationId ||
          creation.structureKind !== target.structureKind ||
          creation.uiPath[1] !== creation.nodeGroupName
        ) {
          return true;
        }
        return target.structureKind === 'node' && creation.structureKind === 'node'
          ? creation.nodeName !== target.nodeName ||
              creation.nodeType !== target.nodeType ||
              creation.uiPath[3] !== creation.nodeName
          : target.structureKind === 'interface_socket' &&
              creation.structureKind === 'interface_socket'
            ? creation.interfaceSocketName !== target.interfaceSocketName ||
              creation.interfaceDirection !== target.interfaceDirection ||
              creation.interfaceSocketType !== target.interfaceSocketType ||
              creation.uiPath[3] !== creation.interfaceDirection ||
              creation.uiPath[4] !== creation.interfaceSocketName
            : true;
      });
    if (invalid) {
      context.addIssue({
        code: 'custom',
        message: 'RNA structure creations must preserve the exact interface-before-node target set',
      });
    }
  });
export type CompanionLeafOperationRnaStructureCreations = z.infer<
  typeof companionLeafOperationRnaStructureCreationsSchema
>;

const lightTrailsRnaResourceMutationCommon = {
  mcpTool: z.literal('operatingline.blender.geometry-nodes.light-trails.execute-next'),
  sourceOperationId: z.literal('semantic.new_geometry_modifier'),
  semanticAction: z.literal('semantic.new_geometry_modifier'),
  targetId: z.string().min(1),
};

const companionLeafOperationLightTrailsRnaNodeGroupCreationSchema = z.strictObject({
  ...lightTrailsRnaResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_node_group_create'),
  mutationKind: z.literal('node_group_create'),
  nodeGroupId: z.string().min(1),
  nodeGroupName: z.string().min(1),
  nodeTreeType: z.literal('GeometryNodeTree'),
  observedResource: z.literal(true),
  uiPath: z.tuple([z.literal('Geometry Nodes'), z.string().min(1)]),
});

const companionLeafOperationLightTrailsRnaModifierCreationSchema = z.strictObject({
  ...lightTrailsRnaResourceMutationCommon,
  order: z.literal(2),
  executionMethod: z.literal('blender_rna_modifier_create'),
  mutationKind: z.literal('modifier_create'),
  modifierId: z.string().min(1),
  modifierName: z.string().min(1),
  modifierType: z.literal('NODES'),
  observedResource: z.literal(true),
  uiPath: z.tuple([z.literal('Properties'), z.literal('Modifiers'), z.string().min(1)]),
});

const companionLeafOperationLightTrailsRnaModifierNodeGroupBindingSchema = z.strictObject({
  ...lightTrailsRnaResourceMutationCommon,
  order: z.literal(3),
  executionMethod: z.literal('blender_rna_modifier_node_group_bind'),
  mutationKind: z.literal('modifier_node_group_bind'),
  modifierId: z.string().min(1),
  modifierName: z.string().min(1),
  nodeGroupId: z.string().min(1),
  nodeGroupName: z.string().min(1),
  observedBinding: z.literal(true),
  uiPath: z.tuple([
    z.literal('Properties'),
    z.literal('Modifiers'),
    z.string().min(1),
    z.literal('Node Group'),
    z.string().min(1),
  ]),
});

export const companionLeafOperationLightTrailsRnaResourceMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationLightTrailsRnaNodeGroupCreationSchema,
    companionLeafOperationLightTrailsRnaModifierCreationSchema,
    companionLeafOperationLightTrailsRnaModifierNodeGroupBindingSchema,
  ],
);
export type CompanionLeafOperationLightTrailsRnaResourceMutation = z.infer<
  typeof companionLeafOperationLightTrailsRnaResourceMutationSchema
>;

export const companionLeafOperationRnaResourceMutationsSchema = z
  .array(companionLeafOperationLightTrailsRnaResourceMutationSchema)
  .max(3)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const [nodeGroup, modifier, binding] = mutations;
    if (
      mutations.length !== 3 ||
      nodeGroup?.mutationKind !== 'node_group_create' ||
      modifier?.mutationKind !== 'modifier_create' ||
      binding?.mutationKind !== 'modifier_node_group_bind' ||
      nodeGroup.targetId !== modifier.targetId ||
      nodeGroup.targetId !== binding.targetId ||
      nodeGroup.nodeGroupId !== binding.nodeGroupId ||
      nodeGroup.nodeGroupName !== binding.nodeGroupName ||
      modifier.modifierId !== binding.modifierId ||
      modifier.modifierName !== binding.modifierName ||
      nodeGroup.uiPath[1] !== nodeGroup.nodeGroupName ||
      modifier.uiPath[2] !== modifier.modifierName ||
      binding.uiPath[2] !== binding.modifierName ||
      binding.uiPath[4] !== binding.nodeGroupName
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'RNA resource mutations must preserve node-group create, modifier create, then binding order',
      });
    }
  });
export type CompanionLeafOperationRnaResourceMutations = z.infer<
  typeof companionLeafOperationRnaResourceMutationsSchema
>;

const poseAnimationRnaKeyframeDataPathSchema = z.enum([
  'rotation_euler',
  'rotation_quaternion',
  'rotation_axis_angle',
  'location',
  'scale',
]);

const companionLeafOperationPoseRnaKeyframePointSchema = z.strictObject({
  componentIndex: z.number().int().min(0).max(3),
  acceptedValue: z.number().finite(),
  observedFrame: z.number().finite().min(1).max(100_000),
  observedValue: z.number().finite(),
});

export const companionLeafOperationPoseRnaKeyframeInsertionSchema = z
  .strictObject({
    order: z.number().int().min(1).max(6_144),
    frameOrder: z.number().int().min(1).max(64),
    poseOrder: z.number().int().min(1).max(32),
    channelOrder: z.number().int().min(1).max(3),
    executionMethod: z.literal('blender_rna_pose_bone_keyframe_insert'),
    mcpTool: z.literal('operatingline.blender.animation.pose-keyframes.execute-next'),
    sourceOperationId: z.literal('projection.semantic.pose_animation.keyframes'),
    semanticAction: z.literal('projection.semantic.pose_animation.keyframes'),
    actionArgument: z.literal('keyframes'),
    armatureId: z.string().min(1),
    actionId: z.string().min(1),
    actionName: z.string().min(1),
    frame: z.number().int().min(1).max(100_000),
    boneName: z.string().min(1),
    dataPath: poseAnimationRnaKeyframeDataPathSchema,
    acceptedValues: z.array(z.number().finite()).min(3).max(4),
    observedPoints: z.array(companionLeafOperationPoseRnaKeyframePointSchema).min(3).max(4),
    observedInserted: z.literal(true),
    uiPath: z.tuple([
      z.literal('Animation'),
      z.string().min(1),
      z.string().min(1),
      poseAnimationRnaKeyframeDataPathSchema,
      z.string().min(1),
    ]),
  })
  .superRefine((insertion, context) => {
    const expectedComponents =
      insertion.dataPath === 'rotation_quaternion' || insertion.dataPath === 'rotation_axis_angle'
        ? 4
        : 3;
    const pointsMatch = insertion.observedPoints.every(
      (point, index) =>
        point.componentIndex === index &&
        point.acceptedValue === insertion.acceptedValues[index] &&
        point.observedFrame === insertion.frame &&
        Math.abs(point.observedValue - point.acceptedValue) <=
          Math.max(1e-7, Math.abs(point.acceptedValue) * 1e-6),
    );
    if (
      insertion.acceptedValues.length !== expectedComponents ||
      insertion.observedPoints.length !== expectedComponents ||
      !pointsMatch ||
      insertion.uiPath[1] !== insertion.actionName ||
      insertion.uiPath[2] !== insertion.boneName ||
      insertion.uiPath[3] !== insertion.dataPath ||
      insertion.uiPath[4] !== `Frame ${insertion.frame}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pose RNA keyframe insertion must preserve its exact component and UI target',
      });
    }
  });
export type CompanionLeafOperationPoseRnaKeyframeInsertion = z.infer<
  typeof companionLeafOperationPoseRnaKeyframeInsertionSchema
>;

export const companionLeafOperationPoseRnaKeyframeInsertionsSchema = z
  .array(companionLeafOperationPoseRnaKeyframeInsertionSchema)
  .max(6_144)
  .superRefine((insertions, context) => {
    if (insertions.length === 0) return;
    const first = insertions[0]!;
    const invalid = insertions.some((insertion, index) => {
      const previous = insertions[index - 1];
      const ordered =
        index === 0
          ? insertion.frameOrder === 1 && insertion.poseOrder === 1 && insertion.channelOrder === 1
          : insertion.frameOrder === previous!.frameOrder &&
              insertion.poseOrder === previous!.poseOrder
            ? insertion.channelOrder === previous!.channelOrder + 1
            : insertion.frameOrder === previous!.frameOrder
              ? insertion.poseOrder === previous!.poseOrder + 1 && insertion.channelOrder === 1
              : insertion.frameOrder === previous!.frameOrder + 1 &&
                insertion.poseOrder === 1 &&
                insertion.channelOrder === 1;
      return (
        insertion.order !== index + 1 ||
        !ordered ||
        insertion.armatureId !== first.armatureId ||
        insertion.actionId !== first.actionId ||
        insertion.actionName !== first.actionName
      );
    });
    if (invalid) {
      context.addIssue({
        code: 'custom',
        message: 'Pose RNA keyframe insertions must preserve frame, pose, and channel order',
      });
    }
  });
export type CompanionLeafOperationPoseRnaKeyframeInsertions = z.infer<
  typeof companionLeafOperationPoseRnaKeyframeInsertionsSchema
>;

const poseAnimationRnaPropertyWriteCommon = {
  order: z.number().int().min(1).max(20_480),
  mcpTool: z.literal('operatingline.blender.animation.pose-keyframes.execute-next'),
  armatureId: z.string().min(1),
  actionId: z.string().min(1),
  actionName: z.string().min(1),
  boneName: z.string().min(1),
  dataPath: poseAnimationRnaKeyframeDataPathSchema,
  componentIndex: z.number().int().min(0).max(3),
};

function poseAnimationRnaComponentIndexIsValid(dataPath: string, componentIndex: number): boolean {
  return (
    componentIndex <
    (dataPath === 'rotation_quaternion' || dataPath === 'rotation_axis_angle' ? 4 : 3)
  );
}

const companionLeafOperationPoseRnaInterpolationWriteSchema = z
  .strictObject({
    ...poseAnimationRnaPropertyWriteCommon,
    executionMethod: z.literal('blender_rna_keyframe_interpolation_write'),
    sourceOperationId: z.literal('projection.semantic.pose_animation.interpolation'),
    semanticAction: z.literal('projection.semantic.pose_animation.interpolation'),
    actionArgument: z.literal('interpolation'),
    mutationKind: z.literal('keyframe_interpolation_write'),
    frame: z.number().int().min(1).max(100_000),
    beforeValue: z.literal('BEZIER'),
    acceptedValue: z.enum(['BEZIER', 'LINEAR', 'CONSTANT']),
    observedValue: z.enum(['BEZIER', 'LINEAR', 'CONSTANT']),
    observedPointValue: z.number().finite(),
    uiPath: z.tuple([
      z.literal('Animation'),
      z.string().min(1),
      z.string().min(1),
      poseAnimationRnaKeyframeDataPathSchema,
      z.string().min(1),
      z.string().min(1),
      z.literal('Interpolation'),
    ]),
  })
  .superRefine((write, context) => {
    if (
      write.observedValue !== write.acceptedValue ||
      !poseAnimationRnaComponentIndexIsValid(write.dataPath, write.componentIndex) ||
      write.uiPath[1] !== write.actionName ||
      write.uiPath[2] !== write.boneName ||
      write.uiPath[3] !== write.dataPath ||
      write.uiPath[4] !== `Component ${write.componentIndex}` ||
      write.uiPath[5] !== `Frame ${write.frame}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pose interpolation write must preserve its exact point and UI target',
      });
    }
  });

const companionLeafOperationPoseRnaExtrapolationWriteSchema = z
  .strictObject({
    ...poseAnimationRnaPropertyWriteCommon,
    order: z.number().int().min(1).max(320),
    executionMethod: z.literal('blender_rna_fcurve_extrapolation_write'),
    sourceOperationId: z.literal('projection.semantic.pose_animation.extrapolation'),
    semanticAction: z.literal('projection.semantic.pose_animation.extrapolation'),
    actionArgument: z.literal('extrapolation'),
    mutationKind: z.literal('fcurve_extrapolation_write'),
    beforeValue: z.literal('CONSTANT'),
    acceptedValue: z.enum(['CONSTANT', 'LINEAR']),
    observedValue: z.enum(['CONSTANT', 'LINEAR']),
    keyframePointCount: z.number().int().min(1).max(64),
    uiPath: z.tuple([
      z.literal('Animation'),
      z.string().min(1),
      z.string().min(1),
      poseAnimationRnaKeyframeDataPathSchema,
      z.string().min(1),
      z.literal('Extrapolation'),
    ]),
  })
  .superRefine((write, context) => {
    if (
      write.observedValue !== write.acceptedValue ||
      !poseAnimationRnaComponentIndexIsValid(write.dataPath, write.componentIndex) ||
      write.uiPath[1] !== write.actionName ||
      write.uiPath[2] !== write.boneName ||
      write.uiPath[3] !== write.dataPath ||
      write.uiPath[4] !== `Component ${write.componentIndex}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pose extrapolation write must preserve its exact curve and UI target',
      });
    }
  });

export const companionLeafOperationPoseRnaAnimationPropertyWriteSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationPoseRnaInterpolationWriteSchema,
    companionLeafOperationPoseRnaExtrapolationWriteSchema,
  ],
);
export type CompanionLeafOperationPoseRnaAnimationPropertyWrite = z.infer<
  typeof companionLeafOperationPoseRnaAnimationPropertyWriteSchema
>;

export const companionLeafOperationPoseRnaAnimationPropertyWritesSchema = z
  .array(companionLeafOperationPoseRnaAnimationPropertyWriteSchema)
  .max(20_480)
  .superRefine((writes, context) => {
    if (writes.length === 0) return;
    const first = writes[0]!;
    if (
      writes.some(
        (write, index) =>
          write.order !== index + 1 ||
          write.mutationKind !== first.mutationKind ||
          write.armatureId !== first.armatureId ||
          write.actionId !== first.actionId ||
          write.actionName !== first.actionName,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pose animation property writes must preserve one ordered operation target set',
      });
    }
  });
export type CompanionLeafOperationPoseRnaAnimationPropertyWrites = z.infer<
  typeof companionLeafOperationPoseRnaAnimationPropertyWritesSchema
>;

const posePendingActionNameSchema = z.string().regex(/^OperatingLine\.PendingPose\.[0-9a-f]{8}$/);
const poseActionResourceMutationCommon = {
  mcpTool: z.literal('operatingline.blender.animation.pose-keyframes.execute-next'),
  armatureId: z.string().min(1),
  actionId: z.string().min(1),
};

const companionLeafOperationPoseRnaActionCreateSchema = z.strictObject({
  ...poseActionResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_action_create'),
  sourceOperationId: z.literal('semantic.create_pose_action'),
  semanticAction: z.literal('semantic.create_pose_action'),
  valueSource: z.literal('managed_receipt_identity'),
  mutationKind: z.literal('action_create'),
  pendingActionName: posePendingActionNameSchema,
  resourceType: z.literal('Action'),
  observedResource: z.literal(true),
  uiPath: z.tuple([z.literal('Animation'), posePendingActionNameSchema]),
});

const companionLeafOperationPoseRnaActionBindSchema = z.strictObject({
  ...poseActionResourceMutationCommon,
  order: z.literal(2),
  executionMethod: z.literal('blender_rna_armature_action_bind'),
  sourceOperationId: z.literal('semantic.create_pose_action'),
  semanticAction: z.literal('semantic.create_pose_action'),
  valueSource: z.literal('managed_receipt_identity'),
  mutationKind: z.literal('armature_action_bind'),
  pendingActionName: posePendingActionNameSchema,
  observedBinding: z.literal(true),
  uiPath: z.tuple([
    z.literal('Animation'),
    z.string().min(1),
    z.literal('Action'),
    posePendingActionNameSchema,
  ]),
});

const companionLeafOperationPoseRnaActionNameWriteSchema = z.strictObject({
  ...poseActionResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_action_name_write'),
  sourceOperationId: z.literal('projection.semantic.pose_animation.action_name'),
  semanticAction: z.literal('projection.semantic.pose_animation.action_name'),
  actionArgument: z.literal('actionName'),
  mutationKind: z.literal('action_name_write'),
  beforeName: posePendingActionNameSchema,
  acceptedName: z.string().min(1),
  observedName: z.string().min(1),
  uiPath: z.tuple([z.literal('Animation'), z.string().min(1), z.literal('Name')]),
});

export const companionLeafOperationPoseRnaActionResourceMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationPoseRnaActionCreateSchema,
    companionLeafOperationPoseRnaActionBindSchema,
    companionLeafOperationPoseRnaActionNameWriteSchema,
  ],
);
export type CompanionLeafOperationPoseRnaActionResourceMutation = z.infer<
  typeof companionLeafOperationPoseRnaActionResourceMutationSchema
>;

export const companionLeafOperationPoseRnaActionResourceMutationsSchema = z
  .array(companionLeafOperationPoseRnaActionResourceMutationSchema)
  .max(2)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreation =
      mutations.length === 2 &&
      first.mutationKind === 'action_create' &&
      mutations[1]?.mutationKind === 'armature_action_bind' &&
      first.armatureId === mutations[1].armatureId &&
      first.actionId === mutations[1].actionId &&
      first.pendingActionName === mutations[1].pendingActionName &&
      first.uiPath[1] === first.pendingActionName &&
      mutations[1].uiPath[1] === first.armatureId &&
      mutations[1].uiPath[3] === first.pendingActionName;
    const validRename =
      mutations.length === 1 &&
      first.mutationKind === 'action_name_write' &&
      first.acceptedName === first.observedName &&
      first.uiPath[1] === first.observedName;
    if (!validCreation && !validRename) {
      context.addIssue({
        code: 'custom',
        message: 'Pose Action resource mutations must preserve create/bind or rename identity',
      });
    }
  });
export type CompanionLeafOperationPoseRnaActionResourceMutations = z.infer<
  typeof companionLeafOperationPoseRnaActionResourceMutationsSchema
>;

const armaturePendingObjectNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingArmatureObject\.[0-9a-f]{8}$/);
const armaturePendingDataNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingArmatureData\.[0-9a-f]{8}$/);
const armatureRnaResourceMutationCommon = {
  mcpTool: z.literal('operatingline.blender.rig.armature.execute-next'),
  armatureId: z.string().min(1),
};

const companionLeafOperationArmatureRnaDataCreateSchema = z.strictObject({
  ...armatureRnaResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_armature_data_create'),
  sourceOperationId: z.literal('menu.add_armature'),
  semanticAction: z.literal('menu.add_armature'),
  valueSource: z.literal('managed_receipt_identity'),
  mutationKind: z.literal('armature_data_create'),
  pendingDataName: armaturePendingDataNameSchema,
  resourceType: z.literal('Armature'),
  observedResource: z.literal(true),
  uiPath: z.tuple([
    z.literal('Layout'),
    z.literal('Add'),
    z.literal('Armature'),
    z.literal('Data'),
    armaturePendingDataNameSchema,
  ]),
});

const companionLeafOperationArmatureRnaObjectCreateSchema = z.strictObject({
  ...armatureRnaResourceMutationCommon,
  order: z.literal(2),
  executionMethod: z.literal('blender_rna_armature_object_create'),
  sourceOperationId: z.literal('menu.add_armature'),
  semanticAction: z.literal('menu.add_armature'),
  valueSource: z.literal('managed_receipt_identity'),
  mutationKind: z.literal('armature_object_create'),
  pendingObjectName: armaturePendingObjectNameSchema,
  pendingDataName: armaturePendingDataNameSchema,
  resourceType: z.literal('Object'),
  objectType: z.literal('ARMATURE'),
  observedDataBinding: z.literal(true),
  observedResource: z.literal(true),
  uiPath: z.tuple([
    z.literal('Layout'),
    z.literal('Add'),
    z.literal('Armature'),
    z.literal('Object'),
    armaturePendingObjectNameSchema,
  ]),
});

const companionLeafOperationArmatureRnaCollectionLinkSchema = z.strictObject({
  ...armatureRnaResourceMutationCommon,
  order: z.literal(3),
  executionMethod: z.literal('blender_rna_collection_object_link'),
  sourceOperationId: z.literal('menu.add_armature'),
  semanticAction: z.literal('menu.add_armature'),
  valueSource: z.literal('accepted_action_argument'),
  actionArgument: z.literal('collectionId'),
  mutationKind: z.literal('collection_object_link'),
  collectionId: z.string().min(1),
  pendingObjectName: armaturePendingObjectNameSchema,
  observedLink: z.literal(true),
  uiPath: z.tuple([z.literal('Outliner'), z.string().min(1), armaturePendingObjectNameSchema]),
});

const companionLeafOperationArmatureRnaObjectNameWriteSchema = z.strictObject({
  ...armatureRnaResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_object_name_write'),
  sourceOperationId: z.literal('projection.semantic.armature.object_name'),
  semanticAction: z.literal('projection.semantic.armature.object_name'),
  valueSource: z.literal('accepted_action_argument'),
  actionArgument: z.literal('objectName'),
  mutationKind: z.literal('armature_object_name_write'),
  beforeName: armaturePendingObjectNameSchema,
  acceptedName: z.string().min(1),
  observedName: z.string().min(1),
  uiPath: z.tuple([
    z.literal('Layout'),
    z.string().min(1),
    z.literal('Object Properties'),
    z.literal('Name'),
  ]),
});

const companionLeafOperationArmatureRnaDataNameWriteSchema = z.strictObject({
  ...armatureRnaResourceMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_armature_data_name_write'),
  sourceOperationId: z.literal('projection.semantic.armature.data_name'),
  semanticAction: z.literal('projection.semantic.armature.data_name'),
  valueSource: z.literal('accepted_action_argument'),
  actionArgument: z.literal('dataName'),
  mutationKind: z.literal('armature_data_name_write'),
  beforeName: armaturePendingDataNameSchema,
  acceptedName: z.string().min(1),
  observedName: z.string().min(1),
  uiPath: z.tuple([
    z.literal('Layout'),
    z.string().min(1),
    z.literal('Object Data Properties'),
    z.literal('Name'),
  ]),
});

export const companionLeafOperationArmatureRnaResourceMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationArmatureRnaDataCreateSchema,
    companionLeafOperationArmatureRnaObjectCreateSchema,
    companionLeafOperationArmatureRnaCollectionLinkSchema,
    companionLeafOperationArmatureRnaObjectNameWriteSchema,
    companionLeafOperationArmatureRnaDataNameWriteSchema,
  ],
);
export type CompanionLeafOperationArmatureRnaResourceMutation = z.infer<
  typeof companionLeafOperationArmatureRnaResourceMutationSchema
>;

export const companionLeafOperationArmatureRnaResourceMutationsSchema = z
  .array(companionLeafOperationArmatureRnaResourceMutationSchema)
  .max(3)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreation =
      mutations.length === 3 &&
      first.mutationKind === 'armature_data_create' &&
      mutations[1]?.mutationKind === 'armature_object_create' &&
      mutations[2]?.mutationKind === 'collection_object_link' &&
      first.armatureId === mutations[1].armatureId &&
      first.armatureId === mutations[2].armatureId &&
      first.pendingDataName === mutations[1].pendingDataName &&
      first.pendingDataName.slice(-8) === mutations[1].pendingObjectName.slice(-8) &&
      mutations[1].pendingObjectName === mutations[2].pendingObjectName &&
      first.uiPath[4] === first.pendingDataName &&
      mutations[1].uiPath[4] === mutations[1].pendingObjectName &&
      mutations[2].uiPath[1] === mutations[2].collectionId &&
      mutations[2].uiPath[2] === mutations[2].pendingObjectName;
    const validObjectRename =
      mutations.length === 1 &&
      first.mutationKind === 'armature_object_name_write' &&
      first.acceptedName === first.observedName &&
      first.uiPath[1] === first.observedName;
    const validDataRename =
      mutations.length === 1 &&
      first.mutationKind === 'armature_data_name_write' &&
      first.acceptedName === first.observedName;
    if (!validCreation && !validObjectRename && !validDataRename) {
      context.addIssue({
        code: 'custom',
        message: 'Armature resources must preserve create/link or exact rename order',
      });
    }
  });
export type CompanionLeafOperationArmatureRnaResourceMutations = z.infer<
  typeof companionLeafOperationArmatureRnaResourceMutationsSchema
>;

const armatureRnaVectorSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const armatureRnaBoneMutationCommon = {
  order: z.number().int().min(1).max(95),
  boneOrder: z.number().int().min(1).max(32),
  mcpTool: z.literal('operatingline.blender.rig.armature.execute-next'),
  sourceOperationId: z.literal('projection.semantic.armature.bones'),
  semanticAction: z.literal('projection.semantic.armature.bones'),
  armatureId: z.string().min(1),
  boneName: z.string().min(1),
};

function armatureRnaVectorClose(accepted: readonly number[], observed: readonly number[]): boolean {
  return accepted.every(
    (value, index) => Math.abs(value - observed[index]!) <= Math.max(1e-6, Math.abs(value) * 1e-6),
  );
}

const companionLeafOperationArmatureRnaEditBoneCreateSchema = z
  .strictObject({
    ...armatureRnaBoneMutationCommon,
    executionMethod: z.literal('blender_rna_edit_bone_create'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('bones'),
    mutationKind: z.literal('edit_bone_create'),
    dataName: z.string().min(1),
    acceptedHead: armatureRnaVectorSchema,
    observedHead: armatureRnaVectorSchema,
    acceptedTail: armatureRnaVectorSchema,
    observedTail: armatureRnaVectorSchema,
    acceptedUseDeform: z.literal(false),
    observedUseDeform: z.literal(false),
    observedBone: z.literal(true),
    uiPath: z.tuple([
      z.literal('Layout'),
      z.string().min(1),
      z.literal('Edit Mode'),
      z.literal('Bones'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      !armatureRnaVectorClose(mutation.acceptedHead, mutation.observedHead) ||
      !armatureRnaVectorClose(mutation.acceptedTail, mutation.observedTail) ||
      mutation.uiPath[4] !== mutation.boneName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Armature EditBone creation must preserve accepted geometry and UI target',
      });
    }
  });

const companionLeafOperationArmatureRnaEditBoneParentBindSchema = z
  .strictObject({
    ...armatureRnaBoneMutationCommon,
    executionMethod: z.literal('blender_rna_edit_bone_parent_bind'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('bones'),
    mutationKind: z.literal('edit_bone_parent_bind'),
    dataName: z.string().min(1),
    acceptedParentName: z.string().min(1),
    observedParentName: z.string().min(1),
    observedBinding: z.literal(true),
    uiPath: z.tuple([
      z.literal('Layout'),
      z.string().min(1),
      z.literal('Edit Mode'),
      z.literal('Bones'),
      z.string().min(1),
      z.literal('Parent'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedParentName !== mutation.observedParentName ||
      mutation.uiPath[4] !== mutation.boneName ||
      mutation.uiPath[6] !== mutation.observedParentName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Armature EditBone parent binding must preserve the accepted hierarchy',
      });
    }
  });

const companionLeafOperationArmatureRnaPoseBoneRotationModeWriteSchema = z.strictObject({
  ...armatureRnaBoneMutationCommon,
  executionMethod: z.literal('blender_rna_pose_bone_rotation_mode_write'),
  valueSource: z.literal('catalog_constant'),
  actionArgument: z.null(),
  mutationKind: z.literal('pose_bone_rotation_mode_write'),
  acceptedRotationMode: z.literal('XYZ'),
  observedRotationMode: z.literal('XYZ'),
  uiPath: z.tuple([
    z.literal('Pose Mode'),
    z.string().min(1),
    z.literal('Bone'),
    z.string().min(1),
    z.literal('Rotation Mode'),
  ]),
});

export const companionLeafOperationArmatureRnaBoneMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationArmatureRnaEditBoneCreateSchema,
    companionLeafOperationArmatureRnaEditBoneParentBindSchema,
    companionLeafOperationArmatureRnaPoseBoneRotationModeWriteSchema,
  ],
);
export type CompanionLeafOperationArmatureRnaBoneMutation = z.infer<
  typeof companionLeafOperationArmatureRnaBoneMutationSchema
>;

export const companionLeafOperationArmatureRnaBoneMutationsSchema = z
  .array(companionLeafOperationArmatureRnaBoneMutationSchema)
  .max(95)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const creations = mutations.filter((mutation) => mutation.mutationKind === 'edit_bone_create');
    const parents = mutations.filter(
      (mutation) => mutation.mutationKind === 'edit_bone_parent_bind',
    );
    const rotations = mutations.filter(
      (mutation) => mutation.mutationKind === 'pose_bone_rotation_mode_write',
    );
    const creationNames = new Map(creations.map((mutation) => [mutation.boneName, mutation]));
    const dataName = creations[0]?.dataName;
    const objectName = creations[0]?.uiPath[1];
    const phase = (mutation: (typeof mutations)[number]): number =>
      mutation.mutationKind === 'edit_bone_create'
        ? 1
        : mutation.mutationKind === 'edit_bone_parent_bind'
          ? 2
          : 3;
    const invalid =
      creations.length === 0 ||
      creations.length !== rotations.length ||
      new Set(creations.map((mutation) => mutation.boneName)).size !== creations.length ||
      new Set(parents.map((mutation) => mutation.boneName)).size !== parents.length ||
      mutations.some(
        (mutation, index) =>
          mutation.order !== index + 1 ||
          (index > 0 && phase(mutation) < phase(mutations[index - 1]!)) ||
          mutation.armatureId !== mutations[0]!.armatureId,
      ) ||
      creations.some(
        (mutation, index) =>
          mutation.boneOrder !== index + 1 ||
          mutation.dataName !== dataName ||
          mutation.uiPath[1] !== objectName,
      ) ||
      rotations.some(
        (mutation, index) =>
          mutation.boneOrder !== index + 1 ||
          mutation.boneName !== creations[index]?.boneName ||
          mutation.uiPath[1] !== objectName ||
          mutation.uiPath[3] !== mutation.boneName,
      ) ||
      parents.some((mutation) => {
        const child = creationNames.get(mutation.boneName);
        return (
          child === undefined ||
          mutation.boneOrder !== child.boneOrder ||
          mutation.dataName !== dataName ||
          mutation.uiPath[1] !== objectName ||
          !creationNames.has(mutation.acceptedParentName)
        );
      });
    if (invalid) {
      context.addIssue({
        code: 'custom',
        message: 'Armature bone mutations must preserve create, parent, then Pose mode order',
      });
    }
  });
export type CompanionLeafOperationArmatureRnaBoneMutations = z.infer<
  typeof companionLeafOperationArmatureRnaBoneMutationsSchema
>;

export const companionLeafOperationArmatureRnaBindingMutationSchema = z
  .strictObject({
    order: z.number().int().min(1).max(64),
    bindingOrder: z.number().int().min(1).max(64),
    executionMethod: z.literal('blender_rna_object_bone_parent_write'),
    mcpTool: z.literal('operatingline.blender.rig.armature.execute-next'),
    sourceOperationId: z.literal('projection.semantic.armature.bindings'),
    semanticAction: z.literal('projection.semantic.armature.bindings'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('bindings'),
    mutationKind: z.literal('object_bone_parent_write'),
    targetId: z.string().min(1),
    armatureId: z.string().min(1),
    boneName: z.string().min(1),
    acceptedParentType: z.literal('BONE'),
    observedParentType: z.literal('BONE'),
    acceptedParentBone: z.string().min(1),
    observedParentBone: z.string().min(1),
    observedParent: z.literal(true),
    observedWorldMatrixPreserved: z.literal(true),
    uiPath: z.tuple([
      z.literal('Layout'),
      z.string().min(1),
      z.literal('Parent'),
      z.string().min(1),
      z.literal('Bone'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedParentBone !== mutation.observedParentBone ||
      mutation.boneName !== mutation.observedParentBone ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.armatureId ||
      mutation.uiPath[5] !== mutation.boneName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Armature rigid binding must preserve target, armature, bone, and UI path',
      });
    }
  });
export type CompanionLeafOperationArmatureRnaBindingMutation = z.infer<
  typeof companionLeafOperationArmatureRnaBindingMutationSchema
>;

export const companionLeafOperationArmatureRnaBindingMutationsSchema = z
  .array(companionLeafOperationArmatureRnaBindingMutationSchema)
  .max(64)
  .superRefine((mutations, context) => {
    if (
      new Set(mutations.map((mutation) => mutation.targetId)).size !== mutations.length ||
      mutations.some(
        (mutation, index) =>
          mutation.order !== index + 1 ||
          mutation.bindingOrder !== index + 1 ||
          mutation.armatureId !== mutations[0]?.armatureId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Armature rigid bindings must preserve exact accepted array order',
      });
    }
  });
export type CompanionLeafOperationArmatureRnaBindingMutations = z.infer<
  typeof companionLeafOperationArmatureRnaBindingMutationsSchema
>;

const skinRnaWeightMutationCommon = {
  order: z.number().int().min(1).max(65_600),
  mcpTool: z.literal('operatingline.blender.rig.skin-weights.execute-next'),
  sourceOperationId: z.literal('projection.semantic.skin_weights.weights'),
  semanticAction: z.literal('projection.semantic.skin_weights.weights'),
  valueSource: z.literal('accepted_action_argument'),
  actionArgument: z.literal('weights'),
  targetId: z.string().min(1),
  armatureId: z.string().min(1),
  boneName: z.string().min(1),
};

const companionLeafOperationSkinRnaBoneDeformWriteSchema = z.strictObject({
  ...skinRnaWeightMutationCommon,
  boneOrder: z.number().int().min(1).max(32),
  executionMethod: z.literal('blender_rna_armature_bone_deform_write'),
  mutationKind: z.literal('armature_bone_deform_enable'),
  acceptedValue: z.literal(true),
  observedValue: z.literal(true),
  uiPath: z.tuple([
    z.literal('Object Data Properties'),
    z.string().min(1),
    z.literal('Bones'),
    z.string().min(1),
    z.literal('Deform'),
  ]),
});

const companionLeafOperationSkinRnaVertexGroupCreateSchema = z.strictObject({
  ...skinRnaWeightMutationCommon,
  groupOrder: z.number().int().min(1).max(32),
  executionMethod: z.literal('blender_rna_vertex_group_create'),
  mutationKind: z.literal('vertex_group_create'),
  groupName: z.string().min(1),
  resourceType: z.literal('VertexGroup'),
  observedResource: z.literal(true),
  uiPath: z.tuple([
    z.literal('Object Data Properties'),
    z.string().min(1),
    z.literal('Vertex Groups'),
    z.string().min(1),
  ]),
});

const companionLeafOperationSkinRnaVertexWeightReplaceSchema = z
  .strictObject({
    ...skinRnaWeightMutationCommon,
    vertexOrder: z.number().int().min(1).max(8192),
    influenceOrder: z.number().int().min(1).max(8),
    executionMethod: z.literal('blender_rna_vertex_group_weight_replace'),
    mutationKind: z.literal('vertex_group_weight_replace'),
    vertexIndex: z.number().int().min(0).max(8191),
    groupName: z.string().min(1),
    assignmentMode: z.literal('REPLACE'),
    acceptedWeight: z.number().finite().min(0.000001).max(1),
    observedWeight: z.number().finite().min(0.000001).max(1),
    observedMembership: z.literal(true),
    uiPath: z.tuple([
      z.literal('Weight Paint'),
      z.string().min(1),
      z.literal('Vertex'),
      z.string().regex(/^(?:0|[1-9]\d*)$/),
      z.string().min(1),
      z.literal('Weight'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      Math.abs(mutation.acceptedWeight - mutation.observedWeight) >
        Math.max(1e-6, Math.abs(mutation.acceptedWeight) * 1e-6) ||
      mutation.groupName !== mutation.boneName ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== String(mutation.vertexIndex) ||
      mutation.uiPath[4] !== mutation.groupName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Skin weight write must preserve its accepted vertex/group/value and UI target',
      });
    }
  });

export const companionLeafOperationSkinRnaWeightMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationSkinRnaBoneDeformWriteSchema,
    companionLeafOperationSkinRnaVertexGroupCreateSchema,
    companionLeafOperationSkinRnaVertexWeightReplaceSchema,
  ],
);
export type CompanionLeafOperationSkinRnaWeightMutation = z.infer<
  typeof companionLeafOperationSkinRnaWeightMutationSchema
>;

export const companionLeafOperationSkinRnaWeightMutationsSchema = z
  .array(companionLeafOperationSkinRnaWeightMutationSchema)
  .max(65_600)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const deformWrites = mutations.filter(
      (mutation) => mutation.mutationKind === 'armature_bone_deform_enable',
    );
    const groupCreates = mutations.filter(
      (mutation) => mutation.mutationKind === 'vertex_group_create',
    );
    const weightWrites = mutations.filter(
      (mutation) => mutation.mutationKind === 'vertex_group_weight_replace',
    );
    const phase = (mutation: (typeof mutations)[number]): number =>
      mutation.mutationKind === 'armature_bone_deform_enable'
        ? 1
        : mutation.mutationKind === 'vertex_group_create'
          ? 2
          : 3;
    const groupNames = new Set(groupCreates.map((mutation) => mutation.groupName));
    const invalid =
      deformWrites.length === 0 ||
      deformWrites.length !== groupCreates.length ||
      weightWrites.length === 0 ||
      new Set(deformWrites.map((mutation) => mutation.boneName)).size !== deformWrites.length ||
      groupNames.size !== groupCreates.length ||
      mutations.some(
        (mutation, index) =>
          mutation.order !== index + 1 ||
          mutation.targetId !== mutations[0]!.targetId ||
          mutation.armatureId !== mutations[0]!.armatureId ||
          (index > 0 && phase(mutation) < phase(mutations[index - 1]!)),
      ) ||
      deformWrites.some(
        (mutation, index) =>
          mutation.boneOrder !== index + 1 ||
          mutation.uiPath[1] !== mutation.armatureId ||
          mutation.uiPath[3] !== mutation.boneName,
      ) ||
      groupCreates.some(
        (mutation, index) =>
          mutation.groupOrder !== index + 1 ||
          mutation.groupName !== mutation.boneName ||
          mutation.boneName !== deformWrites[index]?.boneName ||
          mutation.uiPath[1] !== mutation.targetId ||
          mutation.uiPath[3] !== mutation.groupName,
      ) ||
      weightWrites.some((mutation, index) => {
        const previous = weightWrites[index - 1];
        return (
          !groupNames.has(mutation.groupName) ||
          mutation.groupName !== mutation.boneName ||
          (previous === undefined
            ? mutation.vertexOrder !== 1 || mutation.influenceOrder !== 1
            : mutation.vertexOrder === previous.vertexOrder
              ? mutation.vertexIndex !== previous.vertexIndex ||
                mutation.influenceOrder !== previous.influenceOrder + 1
              : mutation.vertexOrder !== previous.vertexOrder + 1 || mutation.influenceOrder !== 1)
        );
      });
    if (invalid) {
      context.addIssue({
        code: 'custom',
        message: 'Skin mutations must preserve deform, group-create, then weight-array order',
      });
    }
  });
export type CompanionLeafOperationSkinRnaWeightMutations = z.infer<
  typeof companionLeafOperationSkinRnaWeightMutationsSchema
>;

const skinPendingModifierNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingSkinModifier\.[0-9a-f]{8}$/);
const skinRnaModifierMutationCommon = {
  mcpTool: z.literal('operatingline.blender.rig.skin-weights.execute-next'),
  targetId: z.string().min(1),
  armatureId: z.string().min(1),
  modifierId: z.string().min(1),
};

const companionLeafOperationSkinRnaModifierCreateSchema = z
  .strictObject({
    ...skinRnaModifierMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_armature_modifier_create'),
    sourceOperationId: z.literal('projection.semantic.skin_weights.preserve_volume'),
    semanticAction: z.literal('projection.semantic.skin_weights.preserve_volume'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('armature_modifier_create'),
    pendingModifierName: skinPendingModifierNameSchema,
    resourceType: z.literal('ArmatureModifier'),
    modifierType: z.literal('ARMATURE'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      skinPendingModifierNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.pendingModifierName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Skin Armature Modifier creation must preserve its target and pending UI path',
      });
    }
  });

const companionLeafOperationSkinRnaModifierObjectBindSchema = z
  .strictObject({
    ...skinRnaModifierMutationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_armature_modifier_object_bind'),
    sourceOperationId: z.literal('projection.semantic.skin_weights.preserve_volume'),
    semanticAction: z.literal('projection.semantic.skin_weights.preserve_volume'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('armatureId'),
    mutationKind: z.literal('armature_modifier_object_bind'),
    pendingModifierName: skinPendingModifierNameSchema,
    observedBinding: z.literal(true),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      skinPendingModifierNameSchema,
      z.literal('Object'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.pendingModifierName ||
      mutation.uiPath[5] !== mutation.armatureId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Skin Armature Modifier binding must preserve target, pending name, and armature',
      });
    }
  });

const skinModifierPropertyNameSchema = z.enum([
  'use_vertex_groups',
  'use_bone_envelopes',
  'use_deform_preserve_volume',
]);
const companionLeafOperationSkinRnaModifierPropertyWriteSchema = z
  .strictObject({
    ...skinRnaModifierMutationCommon,
    order: z.number().int().min(3).max(5),
    executionMethod: z.literal('blender_rna_armature_modifier_property_write'),
    sourceOperationId: z.literal('projection.semantic.skin_weights.preserve_volume'),
    semanticAction: z.literal('projection.semantic.skin_weights.preserve_volume'),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.union([z.null(), z.literal('preserveVolume')]),
    mutationKind: z.literal('armature_modifier_property_write'),
    pendingModifierName: skinPendingModifierNameSchema,
    propertyName: skinModifierPropertyNameSchema,
    acceptedValue: z.boolean(),
    observedValue: z.boolean(),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      skinPendingModifierNameSchema,
      z.enum(['Vertex Groups', 'Bone Envelopes', 'Preserve Volume']),
    ]),
  })
  .superRefine((mutation, context) => {
    const expected = {
      use_vertex_groups: {
        order: 3,
        acceptedValue: true,
        valueSource: 'catalog_constant',
        actionArgument: null,
        uiLabel: 'Vertex Groups',
      },
      use_bone_envelopes: {
        order: 4,
        acceptedValue: false,
        valueSource: 'catalog_constant',
        actionArgument: null,
        uiLabel: 'Bone Envelopes',
      },
      use_deform_preserve_volume: {
        order: 5,
        acceptedValue: mutation.acceptedValue,
        valueSource: 'accepted_action_argument',
        actionArgument: 'preserveVolume',
        uiLabel: 'Preserve Volume',
      },
    } as const;
    const target = expected[mutation.propertyName];
    if (
      mutation.order !== target.order ||
      mutation.acceptedValue !== mutation.observedValue ||
      mutation.acceptedValue !== target.acceptedValue ||
      mutation.valueSource !== target.valueSource ||
      mutation.actionArgument !== target.actionArgument ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.pendingModifierName ||
      mutation.uiPath[4] !== target.uiLabel
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Skin Armature Modifier property write must preserve its exact reviewed target',
      });
    }
  });

const companionLeafOperationSkinRnaModifierNameWriteSchema = z.strictObject({
  ...skinRnaModifierMutationCommon,
  order: z.literal(1),
  executionMethod: z.literal('blender_rna_modifier_name_write'),
  sourceOperationId: z.literal('projection.semantic.skin_weights.modifier_name'),
  semanticAction: z.literal('projection.semantic.skin_weights.modifier_name'),
  valueSource: z.literal('accepted_action_argument'),
  actionArgument: z.literal('modifierName'),
  mutationKind: z.literal('armature_modifier_name_write'),
  beforeName: skinPendingModifierNameSchema,
  acceptedName: z.string().min(1),
  observedName: z.string().min(1),
  uiPath: z.tuple([
    z.literal('Properties'),
    z.string().min(1),
    z.literal('Modifiers'),
    z.string().min(1),
    z.literal('Name'),
  ]),
});

export const companionLeafOperationSkinRnaModifierMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationSkinRnaModifierCreateSchema,
    companionLeafOperationSkinRnaModifierObjectBindSchema,
    companionLeafOperationSkinRnaModifierPropertyWriteSchema,
    companionLeafOperationSkinRnaModifierNameWriteSchema,
  ],
);
export type CompanionLeafOperationSkinRnaModifierMutation = z.infer<
  typeof companionLeafOperationSkinRnaModifierMutationSchema
>;

export const companionLeafOperationSkinRnaModifierMutationsSchema = z
  .array(companionLeafOperationSkinRnaModifierMutationSchema)
  .max(5)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreate =
      mutations.length === 5 &&
      first.mutationKind === 'armature_modifier_create' &&
      mutations[1]?.mutationKind === 'armature_modifier_object_bind' &&
      mutations
        .slice(2)
        .every(
          (mutation, index) =>
            mutation.mutationKind === 'armature_modifier_property_write' &&
            mutation.order === index + 3,
        ) &&
      mutations.every(
        (mutation) =>
          mutation.targetId === first.targetId &&
          mutation.armatureId === first.armatureId &&
          mutation.modifierId === first.modifierId,
      ) &&
      first.pendingModifierName === mutations[1].pendingModifierName &&
      mutations
        .slice(2)
        .every(
          (mutation) =>
            mutation.mutationKind === 'armature_modifier_property_write' &&
            mutation.pendingModifierName === first.pendingModifierName,
        );
    const validRename =
      mutations.length === 1 &&
      first.mutationKind === 'armature_modifier_name_write' &&
      first.acceptedName === first.observedName &&
      first.uiPath[1] === first.targetId &&
      first.uiPath[3] === first.observedName;
    if (!validCreate && !validRename) {
      context.addIssue({
        code: 'custom',
        message: 'Skin Modifier mutations must preserve create/configure or exact rename order',
      });
    }
  });
export type CompanionLeafOperationSkinRnaModifierMutations = z.infer<
  typeof companionLeafOperationSkinRnaModifierMutationsSchema
>;

const solidifyPendingModifierNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingSolidifyModifier\.[0-9a-f]{8}$/);
const solidifyRnaMutationCommon = {
  mcpTool: z.literal('operatingline.blender.modifier.solidify.execute-next'),
  targetId: z.string().min(1),
  modifierId: z.string().min(1),
};

const companionLeafOperationSolidifyRnaCreateSchema = z
  .strictObject({
    ...solidifyRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_solidify_modifier_create'),
    sourceOperationId: z.literal('control.add_modifier'),
    semanticAction: z.literal('control.add_modifier'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('solidify_modifier_create'),
    pendingModifierName: solidifyPendingModifierNameSchema,
    resourceType: z.literal('SolidifyModifier'),
    modifierType: z.literal('SOLIDIFY'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.literal('Add Modifier'),
      z.literal('Generate'),
      z.literal('Solidify'),
      solidifyPendingModifierNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[6] !== mutation.pendingModifierName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solidify Modifier creation must preserve its target and pending UI path',
      });
    }
  });

const companionLeafOperationSolidifyRnaNameWriteSchema = z
  .strictObject({
    ...solidifyRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_modifier_name_write'),
    sourceOperationId: z.literal('semantic.solidify_parameters'),
    semanticAction: z.literal('semantic.solidify_parameters'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('modifierName'),
    mutationKind: z.literal('solidify_modifier_name_write'),
    beforeName: solidifyPendingModifierNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.literal('Name'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedName !== mutation.observedName ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.observedName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solidify Modifier name write must preserve its accepted value and UI path',
      });
    }
  });

const solidifyRnaPropertyNames = [
  'solidify_mode',
  'thickness',
  'thickness_clamp',
  'use_thickness_angle_clamp',
  'thickness_vertex_group',
  'offset',
  'edge_crease_inner',
  'edge_crease_outer',
  'edge_crease_rim',
  'material_offset',
  'material_offset_rim',
  'vertex_group',
  'shell_vertex_group',
  'rim_vertex_group',
  'use_even_offset',
  'use_rim',
  'use_rim_only',
  'use_quality_normals',
  'invert_vertex_group',
  'use_flat_faces',
  'use_flip_normals',
  'nonmanifold_thickness_mode',
  'nonmanifold_boundary_mode',
  'nonmanifold_merge_threshold',
  'bevel_convex',
] as const;
type SolidifyRnaPropertyName = (typeof solidifyRnaPropertyNames)[number];
const solidifyRnaPropertyBindings: Readonly<
  Record<
    SolidifyRnaPropertyName,
    {
      readonly valueSource: 'catalog_constant' | 'accepted_action_argument';
      readonly actionArgument: 'thickness' | 'offset' | null;
      readonly constantValue?: boolean | number | string;
    }
  >
> = {
  solidify_mode: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'EXTRUDE',
  },
  thickness: { valueSource: 'accepted_action_argument', actionArgument: 'thickness' },
  thickness_clamp: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  use_thickness_angle_clamp: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  thickness_vertex_group: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  offset: { valueSource: 'accepted_action_argument', actionArgument: 'offset' },
  edge_crease_inner: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  edge_crease_outer: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  edge_crease_rim: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  material_offset: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  material_offset_rim: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  vertex_group: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: '',
  },
  shell_vertex_group: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: '',
  },
  rim_vertex_group: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: '',
  },
  use_even_offset: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  use_rim: { valueSource: 'catalog_constant', actionArgument: null, constantValue: true },
  use_rim_only: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  use_quality_normals: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  invert_vertex_group: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  use_flat_faces: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  use_flip_normals: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  nonmanifold_thickness_mode: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'CONSTRAINTS',
  },
  nonmanifold_boundary_mode: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'NONE',
  },
  nonmanifold_merge_threshold: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0.0001,
  },
  bevel_convex: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
};

const solidifyRnaValueSchema = z.union([z.boolean(), z.number().finite(), z.string()]);
const companionLeafOperationSolidifyRnaPropertyWriteSchema = z
  .strictObject({
    ...solidifyRnaMutationCommon,
    order: z.number().int().min(2).max(26),
    executionMethod: z.literal('blender_rna_solidify_modifier_property_write'),
    sourceOperationId: z.literal('semantic.solidify_parameters'),
    semanticAction: z.literal('semantic.solidify_parameters'),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.union([z.null(), z.literal('thickness'), z.literal('offset')]),
    mutationKind: z.literal('solidify_modifier_property_write'),
    modifierName: z.string().min(1),
    propertyName: z.enum(solidifyRnaPropertyNames),
    acceptedValue: solidifyRnaValueSchema,
    observedValue: solidifyRnaValueSchema,
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.enum(solidifyRnaPropertyNames),
    ]),
  })
  .superRefine((mutation, context) => {
    const propertyIndex = solidifyRnaPropertyNames.indexOf(mutation.propertyName);
    const binding = solidifyRnaPropertyBindings[mutation.propertyName];
    const observedMatches =
      typeof mutation.acceptedValue === typeof mutation.observedValue &&
      (typeof mutation.acceptedValue === 'number' && typeof mutation.observedValue === 'number'
        ? Math.abs(mutation.acceptedValue - mutation.observedValue) <=
          Math.max(1e-6, Math.abs(mutation.acceptedValue) * 1e-6)
        : mutation.acceptedValue === mutation.observedValue);
    const constantMatches =
      binding.constantValue === undefined || mutation.acceptedValue === binding.constantValue;
    const actionValueTypeMatches =
      binding.actionArgument === null ||
      (typeof mutation.acceptedValue === 'number' && typeof mutation.observedValue === 'number');
    if (
      mutation.order !== propertyIndex + 2 ||
      mutation.valueSource !== binding.valueSource ||
      mutation.actionArgument !== binding.actionArgument ||
      !observedMatches ||
      !constantMatches ||
      !actionValueTypeMatches ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.modifierName ||
      mutation.uiPath[4] !== mutation.propertyName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solidify property write must preserve exact order, value source, and UI path',
      });
    }
  });

export const companionLeafOperationSolidifyRnaMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationSolidifyRnaCreateSchema,
    companionLeafOperationSolidifyRnaNameWriteSchema,
    companionLeafOperationSolidifyRnaPropertyWriteSchema,
  ],
);
export type CompanionLeafOperationSolidifyRnaMutation = z.infer<
  typeof companionLeafOperationSolidifyRnaMutationSchema
>;

export const companionLeafOperationSolidifyRnaMutationsSchema = z
  .array(companionLeafOperationSolidifyRnaMutationSchema)
  .max(26)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreate = mutations.length === 1 && first.mutationKind === 'solidify_modifier_create';
    const validConfiguration =
      mutations.length === 26 &&
      first.mutationKind === 'solidify_modifier_name_write' &&
      mutations
        .slice(1)
        .every(
          (mutation, index) =>
            mutation.mutationKind === 'solidify_modifier_property_write' &&
            mutation.order === index + 2 &&
            mutation.propertyName === solidifyRnaPropertyNames[index] &&
            mutation.targetId === first.targetId &&
            mutation.modifierId === first.modifierId &&
            mutation.modifierName === first.observedName,
        );
    if (!validCreate && !validConfiguration) {
      context.addIssue({
        code: 'custom',
        message: 'Solidify mutations must preserve exact create or name/property sequence',
      });
    }
  });
export type CompanionLeafOperationSolidifyRnaMutations = z.infer<
  typeof companionLeafOperationSolidifyRnaMutationsSchema
>;

const bevelModifierPendingNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingBevelModifier\.[0-9a-f]{8}$/);
const bevelModifierRnaMutationCommon = {
  mcpTool: z.literal('operatingline.blender.modifier.bevel.execute-next'),
  targetId: z.string().min(1),
  modifierId: z.string().min(1),
};

const companionLeafOperationBevelModifierRnaCreateSchema = z
  .strictObject({
    ...bevelModifierRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_bevel_modifier_create'),
    sourceOperationId: z.literal('control.add_modifier'),
    semanticAction: z.literal('control.add_modifier'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('bevel_modifier_create'),
    pendingModifierName: bevelModifierPendingNameSchema,
    resourceType: z.literal('BevelModifier'),
    modifierType: z.literal('BEVEL'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.literal('Add Modifier'),
      z.literal('Generate'),
      z.literal('Bevel'),
      bevelModifierPendingNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[6] !== mutation.pendingModifierName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Bevel Modifier creation must preserve its target and pending UI path',
      });
    }
  });

const companionLeafOperationBevelModifierRnaNameWriteSchema = z
  .strictObject({
    ...bevelModifierRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_modifier_name_write'),
    sourceOperationId: z.literal('semantic.bevel_parameters'),
    semanticAction: z.literal('semantic.bevel_parameters'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('modifierName'),
    mutationKind: z.literal('bevel_modifier_name_write'),
    beforeName: bevelModifierPendingNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.literal('Name'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedName !== mutation.observedName ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.observedName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Bevel Modifier name write must preserve its accepted value and UI path',
      });
    }
  });

const bevelModifierRnaPropertyNames = ['width', 'segments', 'limit_method', 'angle_limit'] as const;
type BevelModifierRnaPropertyName = (typeof bevelModifierRnaPropertyNames)[number];
type BevelModifierActionArgument = 'width' | 'segments' | 'angleLimit';
const bevelModifierRnaPropertyBindings: Readonly<
  Record<
    BevelModifierRnaPropertyName,
    {
      readonly valueSource: 'catalog_constant' | 'accepted_action_argument';
      readonly actionArgument: BevelModifierActionArgument | null;
      readonly constantValue?: string;
    }
  >
> = {
  width: { valueSource: 'accepted_action_argument', actionArgument: 'width' },
  segments: { valueSource: 'accepted_action_argument', actionArgument: 'segments' },
  limit_method: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'ANGLE',
  },
  angle_limit: { valueSource: 'accepted_action_argument', actionArgument: 'angleLimit' },
};

const bevelModifierRnaValueSchema = z.union([z.number().finite(), z.string()]);
const companionLeafOperationBevelModifierRnaPropertyWriteSchema = z
  .strictObject({
    ...bevelModifierRnaMutationCommon,
    order: z.number().int().min(2).max(5),
    executionMethod: z.literal('blender_rna_bevel_modifier_property_write'),
    sourceOperationId: z.literal('semantic.bevel_parameters'),
    semanticAction: z.literal('semantic.bevel_parameters'),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.union([
      z.null(),
      z.literal('width'),
      z.literal('segments'),
      z.literal('angleLimit'),
    ]),
    mutationKind: z.literal('bevel_modifier_property_write'),
    modifierName: z.string().min(1),
    propertyName: z.enum(bevelModifierRnaPropertyNames),
    acceptedValue: bevelModifierRnaValueSchema,
    observedValue: bevelModifierRnaValueSchema,
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.enum(bevelModifierRnaPropertyNames),
    ]),
  })
  .superRefine((mutation, context) => {
    const propertyIndex = bevelModifierRnaPropertyNames.indexOf(mutation.propertyName);
    const binding = bevelModifierRnaPropertyBindings[mutation.propertyName];
    const observedMatches =
      typeof mutation.acceptedValue === typeof mutation.observedValue &&
      (typeof mutation.acceptedValue === 'number' && typeof mutation.observedValue === 'number'
        ? Math.abs(mutation.acceptedValue - mutation.observedValue) <=
          Math.max(1e-6, Math.abs(mutation.acceptedValue) * 1e-6)
        : mutation.acceptedValue === mutation.observedValue);
    const constantMatches =
      binding.constantValue === undefined || mutation.acceptedValue === binding.constantValue;
    const actionValueTypeMatches =
      binding.actionArgument === null ||
      (binding.actionArgument === 'segments'
        ? Number.isInteger(mutation.acceptedValue) && Number.isInteger(mutation.observedValue)
        : typeof mutation.acceptedValue === 'number' && typeof mutation.observedValue === 'number');
    if (
      mutation.order !== propertyIndex + 2 ||
      mutation.valueSource !== binding.valueSource ||
      mutation.actionArgument !== binding.actionArgument ||
      !observedMatches ||
      !constantMatches ||
      !actionValueTypeMatches ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.modifierName ||
      mutation.uiPath[4] !== mutation.propertyName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Bevel Modifier property write must preserve exact order and value binding',
      });
    }
  });

export const companionLeafOperationBevelModifierRnaMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationBevelModifierRnaCreateSchema,
    companionLeafOperationBevelModifierRnaNameWriteSchema,
    companionLeafOperationBevelModifierRnaPropertyWriteSchema,
  ],
);
export type CompanionLeafOperationBevelModifierRnaMutation = z.infer<
  typeof companionLeafOperationBevelModifierRnaMutationSchema
>;

export const companionLeafOperationBevelModifierRnaMutationsSchema = z
  .array(companionLeafOperationBevelModifierRnaMutationSchema)
  .max(5)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreate = mutations.length === 1 && first.mutationKind === 'bevel_modifier_create';
    const validConfiguration =
      mutations.length === 5 &&
      first.mutationKind === 'bevel_modifier_name_write' &&
      mutations
        .slice(1)
        .every(
          (mutation, index) =>
            mutation.mutationKind === 'bevel_modifier_property_write' &&
            mutation.order === index + 2 &&
            mutation.propertyName === bevelModifierRnaPropertyNames[index] &&
            mutation.targetId === first.targetId &&
            mutation.modifierId === first.modifierId &&
            mutation.modifierName === first.observedName,
        );
    if (!validCreate && !validConfiguration) {
      context.addIssue({
        code: 'custom',
        message: 'Bevel Modifier mutations must preserve exact create or configuration sequence',
      });
    }
  });
export type CompanionLeafOperationBevelModifierRnaMutations = z.infer<
  typeof companionLeafOperationBevelModifierRnaMutationsSchema
>;

const materialPendingNameSchema = z.string().regex(/^OperatingLine\.PendingMaterial\.[0-9a-f]{8}$/);
const materialRnaMutationCommon = {
  mcpTool: z.literal('operatingline.blender.material.single.execute-next'),
  materialId: z.string().min(1),
};

const companionLeafOperationMaterialRnaCreateSchema = z
  .strictObject({
    ...materialRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_material_create'),
    sourceOperationId: z.literal('control.new_material'),
    semanticAction: z.literal('control.new_material'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('material_create'),
    pendingMaterialName: materialPendingNameSchema,
    resourceType: z.literal('Material'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Shading'),
      z.literal('Material Properties'),
      z.literal('New'),
      materialPendingNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (mutation.uiPath[3] !== mutation.pendingMaterialName) {
      context.addIssue({
        code: 'custom',
        message: 'Material creation must preserve its pending managed identity in the UI path',
      });
    }
  });

const companionLeafOperationMaterialRnaUseNodesWriteSchema = z.strictObject({
  ...materialRnaMutationCommon,
  order: z.literal(2),
  executionMethod: z.literal('blender_rna_material_use_nodes_write'),
  sourceOperationId: z.literal('control.new_material'),
  semanticAction: z.literal('control.new_material'),
  valueSource: z.literal('catalog_constant'),
  mutationKind: z.literal('material_use_nodes_write'),
  beforeValue: z.boolean(),
  acceptedValue: z.literal(true),
  observedValue: z.literal(true),
  uiPath: z.tuple([
    z.literal('Shading'),
    z.literal('Material Properties'),
    materialPendingNameSchema,
    z.literal('Use Nodes'),
  ]),
});

const materialRnaComponentSchema = z.enum(['R', 'G', 'B', 'A']);
const materialRnaNumericValueSchema = z.number().finite();
const materialRnaControlUiPathSchema = z.union([
  z.tuple([
    z.literal('Shading'),
    z.literal('Material Properties'),
    z.string().min(1),
    z.enum(['Material', 'Principled BSDF']),
    z.string().min(1),
  ]),
  z.tuple([
    z.literal('Shading'),
    z.literal('Material Properties'),
    z.string().min(1),
    z.enum(['Material', 'Principled BSDF']),
    z.string().min(1),
    materialRnaComponentSchema,
  ]),
]);

function materialRnaNumberMatches(accepted: number, observed: number): boolean {
  return Math.abs(accepted - observed) <= Math.max(1e-6, Math.abs(accepted) * 1e-6);
}

const companionLeafOperationMaterialRnaNameWriteSchema = z
  .strictObject({
    ...materialRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_material_name_write'),
    sourceOperationId: z.literal('semantic.principled_surface'),
    semanticAction: z.literal('semantic.principled_surface'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('materialName'),
    mutationKind: z.literal('material_name_write'),
    materialName: z.string().min(1),
    surface: z.literal('Material'),
    propertyName: z.literal('name'),
    beforeValue: materialPendingNameSchema,
    acceptedValue: z.string().min(1),
    observedValue: z.string().min(1),
    uiPath: z.tuple([
      z.literal('Shading'),
      z.literal('Material Properties'),
      z.string().min(1),
      z.literal('Material'),
      z.literal('name'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.materialName !== mutation.acceptedValue ||
      mutation.acceptedValue !== mutation.observedValue ||
      mutation.uiPath[2] !== mutation.observedValue
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Material name write must preserve its accepted value and UI path',
      });
    }
  });

const materialRnaPropertyBindings = [
  { propertyName: 'diffuse_color', component: 'R', actionArgument: 'baseColor' },
  { propertyName: 'diffuse_color', component: 'G', actionArgument: 'baseColor' },
  { propertyName: 'diffuse_color', component: 'B', actionArgument: 'baseColor' },
  { propertyName: 'diffuse_color', component: 'A', actionArgument: 'baseColor' },
  { propertyName: 'roughness', component: undefined, actionArgument: 'roughness' },
  { propertyName: 'metallic', component: undefined, actionArgument: 'metallic' },
] as const;

const companionLeafOperationMaterialRnaPropertyWriteSchema = z
  .strictObject({
    ...materialRnaMutationCommon,
    order: z.number().int().min(2).max(7),
    executionMethod: z.literal('blender_rna_material_property_write'),
    sourceOperationId: z.literal('semantic.principled_surface'),
    semanticAction: z.literal('semantic.principled_surface'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum(['baseColor', 'roughness', 'metallic']),
    mutationKind: z.literal('material_property_write'),
    materialName: z.string().min(1),
    surface: z.literal('Material'),
    propertyName: z.enum(['diffuse_color', 'roughness', 'metallic']),
    component: materialRnaComponentSchema.optional(),
    beforeValue: materialRnaNumericValueSchema,
    acceptedValue: materialRnaNumericValueSchema,
    observedValue: materialRnaNumericValueSchema,
    uiPath: materialRnaControlUiPathSchema,
  })
  .superRefine((mutation, context) => {
    const binding = materialRnaPropertyBindings[mutation.order - 2];
    const expectedPathLength = binding?.component === undefined ? 5 : 6;
    if (
      binding === undefined ||
      mutation.propertyName !== binding.propertyName ||
      mutation.component !== binding.component ||
      mutation.actionArgument !== binding.actionArgument ||
      !materialRnaNumberMatches(mutation.acceptedValue, mutation.observedValue) ||
      mutation.uiPath.length !== expectedPathLength ||
      mutation.uiPath[2] !== mutation.materialName ||
      mutation.uiPath[3] !== mutation.surface ||
      mutation.uiPath[4] !== mutation.propertyName ||
      (binding.component !== undefined && mutation.uiPath[5] !== binding.component)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Material property write must preserve exact order, parameter binding, and path',
      });
    }
  });

const materialRnaPrincipledBindings = [
  { propertyName: 'Base Color', component: 'R', actionArgument: 'baseColor' },
  { propertyName: 'Base Color', component: 'G', actionArgument: 'baseColor' },
  { propertyName: 'Base Color', component: 'B', actionArgument: 'baseColor' },
  { propertyName: 'Base Color', component: 'A', actionArgument: 'baseColor' },
  { propertyName: 'Roughness', component: undefined, actionArgument: 'roughness' },
  { propertyName: 'Metallic', component: undefined, actionArgument: 'metallic' },
] as const;

const companionLeafOperationMaterialRnaPrincipledInputWriteSchema = z
  .strictObject({
    ...materialRnaMutationCommon,
    order: z.number().int().min(8).max(13),
    executionMethod: z.literal('blender_rna_principled_input_write'),
    sourceOperationId: z.literal('semantic.principled_surface'),
    semanticAction: z.literal('semantic.principled_surface'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum(['baseColor', 'roughness', 'metallic']),
    mutationKind: z.literal('principled_input_write'),
    materialName: z.string().min(1),
    surface: z.literal('Principled BSDF'),
    propertyName: z.enum(['Base Color', 'Roughness', 'Metallic']),
    component: materialRnaComponentSchema.optional(),
    beforeValue: materialRnaNumericValueSchema,
    acceptedValue: materialRnaNumericValueSchema,
    observedValue: materialRnaNumericValueSchema,
    uiPath: materialRnaControlUiPathSchema,
  })
  .superRefine((mutation, context) => {
    const binding = materialRnaPrincipledBindings[mutation.order - 8];
    const expectedPathLength = binding?.component === undefined ? 5 : 6;
    if (
      binding === undefined ||
      mutation.propertyName !== binding.propertyName ||
      mutation.component !== binding.component ||
      mutation.actionArgument !== binding.actionArgument ||
      !materialRnaNumberMatches(mutation.acceptedValue, mutation.observedValue) ||
      mutation.uiPath.length !== expectedPathLength ||
      mutation.uiPath[2] !== mutation.materialName ||
      mutation.uiPath[3] !== mutation.surface ||
      mutation.uiPath[4] !== mutation.propertyName ||
      (binding.component !== undefined && mutation.uiPath[5] !== binding.component)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Principled input write must preserve exact order, parameter binding, and path',
      });
    }
  });

const companionLeafOperationMaterialRnaSlotReplaceSchema = z
  .strictObject({
    ...materialRnaMutationCommon,
    order: z.number().int().min(14).max(77),
    executionMethod: z.literal('blender_rna_material_slot_replace'),
    sourceOperationId: z.literal('semantic.principled_surface'),
    semanticAction: z.literal('semantic.principled_surface'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('targets'),
    mutationKind: z.literal('material_slot_replace'),
    targetOrder: z.number().int().min(1).max(64),
    targetId: z.string().min(1),
    beforeSlotCount: z.number().int().nonnegative(),
    observedSlotCount: z.literal(1),
    observedAssignment: z.literal(true),
    sourceMeshId: z.string().min(1),
    sourceContentIntact: z.literal(true),
    uiPath: z.tuple([
      z.literal('Shading'),
      z.literal('Material Properties'),
      z.string().min(1),
      z.literal('Material Slots'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (mutation.uiPath[2] !== mutation.targetId) {
      context.addIssue({
        code: 'custom',
        message: 'Material slot replacement must preserve its ordered target UI path',
      });
    }
  });

export const companionLeafOperationMaterialRnaMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationMaterialRnaCreateSchema,
    companionLeafOperationMaterialRnaUseNodesWriteSchema,
    companionLeafOperationMaterialRnaNameWriteSchema,
    companionLeafOperationMaterialRnaPropertyWriteSchema,
    companionLeafOperationMaterialRnaPrincipledInputWriteSchema,
    companionLeafOperationMaterialRnaSlotReplaceSchema,
  ],
);
export type CompanionLeafOperationMaterialRnaMutation = z.infer<
  typeof companionLeafOperationMaterialRnaMutationSchema
>;

export const companionLeafOperationMaterialRnaMutationsSchema = z
  .array(companionLeafOperationMaterialRnaMutationSchema)
  .max(77)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreate =
      mutations.length === 2 &&
      first.mutationKind === 'material_create' &&
      mutations[1]?.mutationKind === 'material_use_nodes_write' &&
      mutations[1].materialId === first.materialId &&
      mutations[1].uiPath[2] === first.pendingMaterialName;
    const configurationPrefix = mutations.slice(0, 13);
    const assignments = mutations.slice(13);
    const validConfiguration =
      mutations.length >= 14 &&
      first.mutationKind === 'material_name_write' &&
      configurationPrefix.every((mutation, index) => {
        if (mutation.order !== index + 1 || mutation.materialId !== first.materialId) return false;
        if (index === 0) return mutation.mutationKind === 'material_name_write';
        if (index <= 6) {
          return (
            mutation.mutationKind === 'material_property_write' &&
            mutation.materialName === first.observedValue
          );
        }
        return (
          mutation.mutationKind === 'principled_input_write' &&
          mutation.materialName === first.observedValue
        );
      }) &&
      assignments.every(
        (mutation, index) =>
          mutation.mutationKind === 'material_slot_replace' &&
          mutation.order === index + 14 &&
          mutation.targetOrder === index + 1 &&
          mutation.materialId === first.materialId &&
          mutation.uiPath[4] === first.observedValue,
      ) &&
      new Set(
        assignments.map((mutation) =>
          mutation.mutationKind === 'material_slot_replace' ? mutation.targetId : '',
        ),
      ).size === assignments.length;
    if (!validCreate && !validConfiguration) {
      context.addIssue({
        code: 'custom',
        message: 'Material mutations must preserve the exact create or configure/assign sequence',
      });
    }
  });
export type CompanionLeafOperationMaterialRnaMutations = z.infer<
  typeof companionLeafOperationMaterialRnaMutationsSchema
>;

const materialPaletteRnaMutationCommon = {
  order: z.number().int().min(1).max(624),
  materialOrder: z.number().int().min(1).max(8),
  materialMutationOrder: z.number().int().min(1).max(78),
  mcpTool: z.literal('operatingline.blender.material.palette.execute-next'),
  sourceOperationId: z.literal('semantic.assign_targets'),
  semanticAction: z.literal('semantic.assign_targets'),
  materialId: z.string().min(1),
  materialName: z.string().min(1),
};

const materialPaletteUiPrefixItems = [
  z.literal('Shading'),
  z.literal('Material Properties'),
  z.literal('Palette'),
  z.number().int().min(1).max(8),
  z.string().min(1),
] as const;

const companionLeafOperationMaterialPaletteRnaCreateSchema = z
  .strictObject({
    ...materialPaletteRnaMutationCommon,
    materialMutationOrder: z.literal(1),
    executionMethod: z.literal('blender_rna_material_create'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('materials[].materialName'),
    mutationKind: z.literal('palette_material_create'),
    resourceType: z.literal('Material'),
    observedResource: z.literal(true),
    uiPath: z.tuple([...materialPaletteUiPrefixItems, z.literal('New')]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[3] !== mutation.materialOrder ||
      mutation.uiPath[4] !== mutation.materialName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Palette material creation must preserve accepted order, name, and UI path',
      });
    }
  });

const companionLeafOperationMaterialPaletteRnaUseNodesSchema = z
  .strictObject({
    ...materialPaletteRnaMutationCommon,
    materialMutationOrder: z.literal(2),
    executionMethod: z.literal('blender_rna_material_use_nodes_write'),
    valueSource: z.literal('catalog_constant'),
    mutationKind: z.literal('palette_material_use_nodes_write'),
    beforeValue: z.boolean(),
    acceptedValue: z.literal(true),
    observedValue: z.literal(true),
    uiPath: z.tuple([...materialPaletteUiPrefixItems, z.literal('Use Nodes')]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[3] !== mutation.materialOrder ||
      mutation.uiPath[4] !== mutation.materialName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Palette Use Nodes write must preserve accepted material order and path',
      });
    }
  });

const materialPaletteRnaPropertyBindings = [
  { propertyName: 'diffuse_color', component: 'R', actionArgument: 'materials[].baseColor' },
  { propertyName: 'diffuse_color', component: 'G', actionArgument: 'materials[].baseColor' },
  { propertyName: 'diffuse_color', component: 'B', actionArgument: 'materials[].baseColor' },
  { propertyName: 'diffuse_color', component: 'A', actionArgument: 'materials[].baseColor' },
  { propertyName: 'roughness', component: undefined, actionArgument: 'materials[].roughness' },
  { propertyName: 'metallic', component: undefined, actionArgument: 'materials[].metallic' },
] as const;

const materialPaletteRnaControlUiPathSchema = z.union([
  z.tuple([
    ...materialPaletteUiPrefixItems,
    z.enum(['Material', 'Principled BSDF']),
    z.string().min(1),
  ]),
  z.tuple([
    ...materialPaletteUiPrefixItems,
    z.enum(['Material', 'Principled BSDF']),
    z.string().min(1),
    materialRnaComponentSchema,
  ]),
]);

const companionLeafOperationMaterialPaletteRnaPropertySchema = z
  .strictObject({
    ...materialPaletteRnaMutationCommon,
    materialMutationOrder: z.number().int().min(3).max(8),
    executionMethod: z.literal('blender_rna_material_property_write'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum([
      'materials[].baseColor',
      'materials[].roughness',
      'materials[].metallic',
    ]),
    mutationKind: z.literal('palette_material_property_write'),
    surface: z.literal('Material'),
    propertyName: z.enum(['diffuse_color', 'roughness', 'metallic']),
    component: materialRnaComponentSchema.optional(),
    beforeValue: materialRnaNumericValueSchema,
    acceptedValue: materialRnaNumericValueSchema,
    observedValue: materialRnaNumericValueSchema,
    uiPath: materialPaletteRnaControlUiPathSchema,
  })
  .superRefine((mutation, context) => {
    const binding = materialPaletteRnaPropertyBindings[mutation.materialMutationOrder - 3];
    if (
      binding === undefined ||
      mutation.propertyName !== binding.propertyName ||
      mutation.component !== binding.component ||
      mutation.actionArgument !== binding.actionArgument ||
      !materialRnaNumberMatches(mutation.acceptedValue, mutation.observedValue) ||
      mutation.uiPath[3] !== mutation.materialOrder ||
      mutation.uiPath[4] !== mutation.materialName ||
      mutation.uiPath[5] !== mutation.surface ||
      mutation.uiPath[6] !== mutation.propertyName ||
      mutation.uiPath[7] !== binding.component
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Palette Material property write must preserve exact nested order and value',
      });
    }
  });

const materialPaletteRnaPrincipledBindings = [
  { propertyName: 'Base Color', component: 'R', actionArgument: 'materials[].baseColor' },
  { propertyName: 'Base Color', component: 'G', actionArgument: 'materials[].baseColor' },
  { propertyName: 'Base Color', component: 'B', actionArgument: 'materials[].baseColor' },
  { propertyName: 'Base Color', component: 'A', actionArgument: 'materials[].baseColor' },
  { propertyName: 'Roughness', component: undefined, actionArgument: 'materials[].roughness' },
  { propertyName: 'Metallic', component: undefined, actionArgument: 'materials[].metallic' },
] as const;

const companionLeafOperationMaterialPaletteRnaPrincipledSchema = z
  .strictObject({
    ...materialPaletteRnaMutationCommon,
    materialMutationOrder: z.number().int().min(9).max(14),
    executionMethod: z.literal('blender_rna_principled_input_write'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum([
      'materials[].baseColor',
      'materials[].roughness',
      'materials[].metallic',
    ]),
    mutationKind: z.literal('palette_principled_input_write'),
    surface: z.literal('Principled BSDF'),
    propertyName: z.enum(['Base Color', 'Roughness', 'Metallic']),
    component: materialRnaComponentSchema.optional(),
    beforeValue: materialRnaNumericValueSchema,
    acceptedValue: materialRnaNumericValueSchema,
    observedValue: materialRnaNumericValueSchema,
    uiPath: materialPaletteRnaControlUiPathSchema,
  })
  .superRefine((mutation, context) => {
    const binding = materialPaletteRnaPrincipledBindings[mutation.materialMutationOrder - 9];
    if (
      binding === undefined ||
      mutation.propertyName !== binding.propertyName ||
      mutation.component !== binding.component ||
      mutation.actionArgument !== binding.actionArgument ||
      !materialRnaNumberMatches(mutation.acceptedValue, mutation.observedValue) ||
      mutation.uiPath[3] !== mutation.materialOrder ||
      mutation.uiPath[4] !== mutation.materialName ||
      mutation.uiPath[5] !== mutation.surface ||
      mutation.uiPath[6] !== mutation.propertyName ||
      mutation.uiPath[7] !== binding.component
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Palette Principled input write must preserve exact nested order and value',
      });
    }
  });

const companionLeafOperationMaterialPaletteRnaSlotSchema = z
  .strictObject({
    ...materialPaletteRnaMutationCommon,
    materialMutationOrder: z.number().int().min(15).max(78),
    executionMethod: z.literal('blender_rna_material_slot_replace'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('materials[].targets'),
    mutationKind: z.literal('palette_material_slot_replace'),
    targetOrder: z.number().int().min(1).max(64),
    targetId: z.string().min(1),
    beforeSlotCount: z.number().int().nonnegative(),
    observedSlotCount: z.literal(1),
    observedAssignment: z.literal(true),
    sourceMeshId: z.string().min(1),
    sourceContentIntact: z.literal(true),
    uiPath: z.tuple([
      z.literal('Shading'),
      z.literal('Material Properties'),
      z.literal('Palette'),
      z.number().int().min(1).max(8),
      z.string().min(1),
      z.literal('Material Slots'),
      z.string().min(1),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.materialMutationOrder !== mutation.targetOrder + 14 ||
      mutation.uiPath[3] !== mutation.materialOrder ||
      mutation.uiPath[4] !== mutation.targetId ||
      mutation.uiPath[6] !== mutation.materialName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Palette slot replacement must preserve exact material and target order',
      });
    }
  });

export const companionLeafOperationMaterialPaletteRnaMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationMaterialPaletteRnaCreateSchema,
    companionLeafOperationMaterialPaletteRnaUseNodesSchema,
    companionLeafOperationMaterialPaletteRnaPropertySchema,
    companionLeafOperationMaterialPaletteRnaPrincipledSchema,
    companionLeafOperationMaterialPaletteRnaSlotSchema,
  ],
);
export type CompanionLeafOperationMaterialPaletteRnaMutation = z.infer<
  typeof companionLeafOperationMaterialPaletteRnaMutationSchema
>;

export const companionLeafOperationMaterialPaletteRnaMutationsSchema = z
  .array(companionLeafOperationMaterialPaletteRnaMutationSchema)
  .max(624)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    if (mutations.some((mutation, index) => mutation.order !== index + 1)) {
      context.addIssue({ code: 'custom', message: 'Palette mutation order must be contiguous' });
      return;
    }
    const materialOrders = [...new Set(mutations.map((mutation) => mutation.materialOrder))];
    const materialIds = new Set<string>();
    const materialNames = new Set<string>();
    const targetIds = new Set<string>();
    for (const [materialIndex, materialOrder] of materialOrders.entries()) {
      const group = mutations.filter((mutation) => mutation.materialOrder === materialOrder);
      const first = group[0];
      if (
        first === undefined ||
        materialOrder !== materialIndex + 1 ||
        group.length < 15 ||
        group.some(
          (mutation, index) =>
            mutation.materialMutationOrder !== index + 1 ||
            mutation.materialId !== first.materialId ||
            mutation.materialName !== first.materialName,
        ) ||
        first.mutationKind !== 'palette_material_create' ||
        group[1]?.mutationKind !== 'palette_material_use_nodes_write' ||
        group
          .slice(2, 8)
          .some((mutation) => mutation.mutationKind !== 'palette_material_property_write') ||
        group
          .slice(8, 14)
          .some((mutation) => mutation.mutationKind !== 'palette_principled_input_write') ||
        group
          .slice(14)
          .some((mutation) => mutation.mutationKind !== 'palette_material_slot_replace') ||
        materialIds.has(first.materialId) ||
        materialNames.has(first.materialName)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Palette mutations must preserve exact ordered material groups',
        });
        return;
      }
      materialIds.add(first.materialId);
      materialNames.add(first.materialName);
      for (const mutation of group.slice(14)) {
        if (mutation.mutationKind !== 'palette_material_slot_replace') continue;
        if (targetIds.has(mutation.targetId)) {
          context.addIssue({
            code: 'custom',
            message: 'Palette target mutation identities must be globally unique',
          });
          return;
        }
        targetIds.add(mutation.targetId);
      }
    }
  });
export type CompanionLeafOperationMaterialPaletteRnaMutations = z.infer<
  typeof companionLeafOperationMaterialPaletteRnaMutationsSchema
>;

const mirrorPendingModifierNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingMirrorModifier\.[0-9a-f]{8}$/);
const mirrorRnaMutationCommon = {
  mcpTool: z.literal('operatingline.blender.modifier.mirror.execute-next'),
  targetId: z.string().min(1),
  modifierId: z.string().min(1),
};

const companionLeafOperationMirrorRnaCreateSchema = z
  .strictObject({
    ...mirrorRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mirror_modifier_create'),
    sourceOperationId: z.literal('modifier.mirror'),
    semanticAction: z.literal('modifier.mirror'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('mirror_modifier_create'),
    pendingModifierName: mirrorPendingModifierNameSchema,
    resourceType: z.literal('MirrorModifier'),
    modifierType: z.literal('MIRROR'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.literal('Add Modifier'),
      z.literal('Generate'),
      z.literal('Mirror'),
      mirrorPendingModifierNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[6] !== mutation.pendingModifierName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Mirror Modifier creation must preserve its target and pending UI path',
      });
    }
  });

const companionLeafOperationMirrorRnaNameWriteSchema = z
  .strictObject({
    ...mirrorRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_modifier_name_write'),
    sourceOperationId: z.literal('semantic.mirror_contract'),
    semanticAction: z.literal('semantic.mirror_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('modifierName'),
    mutationKind: z.literal('mirror_modifier_name_write'),
    beforeName: mirrorPendingModifierNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.literal('Name'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedName !== mutation.observedName ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.observedName
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Mirror Modifier name write must preserve its accepted value and UI path',
      });
    }
  });

const mirrorRnaPropertyNames = [
  'use_axis',
  'use_bisect_axis',
  'use_bisect_flip_axis',
  'use_clip',
  'use_mirror_merge',
  'merge_threshold',
  'bisect_threshold',
  'mirror_object',
  'use_mirror_vertex_groups',
  'use_mirror_u',
  'use_mirror_v',
  'use_mirror_udim',
  'offset_u',
  'offset_v',
  'mirror_offset_u',
  'mirror_offset_v',
  'show_viewport',
  'show_render',
  'show_in_editmode',
  'show_on_cage',
  'use_apply_on_spline',
] as const;
const mirrorRnaPropertyBindings = [
  {
    propertyName: 'use_axis',
    componentIndex: 0,
    componentLabel: 'X',
    valueSource: 'accepted_action_argument',
    actionArgument: 'axis',
  },
  {
    propertyName: 'use_axis',
    componentIndex: 1,
    componentLabel: 'Y',
    valueSource: 'accepted_action_argument',
    actionArgument: 'axis',
  },
  {
    propertyName: 'use_axis',
    componentIndex: 2,
    componentLabel: 'Z',
    valueSource: 'accepted_action_argument',
    actionArgument: 'axis',
  },
  {
    propertyName: 'use_bisect_axis',
    componentIndex: 0,
    componentLabel: 'X',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_bisect_axis',
    componentIndex: 1,
    componentLabel: 'Y',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_bisect_axis',
    componentIndex: 2,
    componentLabel: 'Z',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_bisect_flip_axis',
    componentIndex: 0,
    componentLabel: 'X',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_bisect_flip_axis',
    componentIndex: 1,
    componentLabel: 'Y',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_bisect_flip_axis',
    componentIndex: 2,
    componentLabel: 'Z',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_clip',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_mirror_merge',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  {
    propertyName: 'merge_threshold',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0.001,
  },
  {
    propertyName: 'bisect_threshold',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0.001,
  },
  {
    propertyName: 'mirror_object',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: null,
  },
  {
    propertyName: 'use_mirror_vertex_groups',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  {
    propertyName: 'use_mirror_u',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_mirror_v',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_mirror_udim',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'offset_u',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  {
    propertyName: 'offset_v',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  {
    propertyName: 'mirror_offset_u',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  {
    propertyName: 'mirror_offset_v',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 0,
  },
  {
    propertyName: 'show_viewport',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  {
    propertyName: 'show_render',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  {
    propertyName: 'show_in_editmode',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  {
    propertyName: 'show_on_cage',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  {
    propertyName: 'use_apply_on_spline',
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
] as const;

const mirrorRnaValueSchema = z.union([z.boolean(), z.number().finite(), z.null()]);
const companionLeafOperationMirrorRnaPropertyWriteSchema = z
  .strictObject({
    ...mirrorRnaMutationCommon,
    order: z.number().int().min(2).max(28),
    executionMethod: z.literal('blender_rna_mirror_modifier_property_write'),
    sourceOperationId: z.literal('semantic.mirror_contract'),
    semanticAction: z.literal('semantic.mirror_contract'),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.union([z.null(), z.literal('axis')]),
    mutationKind: z.literal('mirror_modifier_property_write'),
    modifierName: z.string().min(1),
    propertyName: z.enum(mirrorRnaPropertyNames),
    componentIndex: z.number().int().min(0).max(2).optional(),
    componentLabel: z.enum(['X', 'Y', 'Z']).optional(),
    acceptedValue: mirrorRnaValueSchema,
    observedValue: mirrorRnaValueSchema,
    uiPath: z.union([
      z.tuple([
        z.literal('Properties'),
        z.string().min(1),
        z.literal('Modifiers'),
        z.string().min(1),
        z.enum(mirrorRnaPropertyNames),
      ]),
      z.tuple([
        z.literal('Properties'),
        z.string().min(1),
        z.literal('Modifiers'),
        z.string().min(1),
        z.enum(mirrorRnaPropertyNames),
        z.enum(['X', 'Y', 'Z']),
      ]),
    ]),
  })
  .superRefine((mutation, context) => {
    const binding = mirrorRnaPropertyBindings[mutation.order - 2]!;
    const observedMatches =
      typeof mutation.acceptedValue === typeof mutation.observedValue &&
      (typeof mutation.acceptedValue === 'number' && typeof mutation.observedValue === 'number'
        ? Math.abs(mutation.acceptedValue - mutation.observedValue) <=
          Math.max(1e-6, Math.abs(mutation.acceptedValue) * 1e-6)
        : mutation.acceptedValue === mutation.observedValue);
    const expectedComponentIndex = 'componentIndex' in binding ? binding.componentIndex : undefined;
    const expectedComponentLabel = 'componentLabel' in binding ? binding.componentLabel : undefined;
    const constantMatches =
      !('constantValue' in binding) || mutation.acceptedValue === binding.constantValue;
    if (
      mutation.propertyName !== binding.propertyName ||
      mutation.valueSource !== binding.valueSource ||
      mutation.actionArgument !== binding.actionArgument ||
      mutation.componentIndex !== expectedComponentIndex ||
      mutation.componentLabel !== expectedComponentLabel ||
      !observedMatches ||
      !constantMatches ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.modifierName ||
      mutation.uiPath[4] !== mutation.propertyName ||
      mutation.uiPath[5] !== expectedComponentLabel
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Mirror property write must preserve exact order, component, value, and UI path',
      });
    }
  });

export const companionLeafOperationMirrorRnaMutationSchema = z.discriminatedUnion('mutationKind', [
  companionLeafOperationMirrorRnaCreateSchema,
  companionLeafOperationMirrorRnaNameWriteSchema,
  companionLeafOperationMirrorRnaPropertyWriteSchema,
]);
export type CompanionLeafOperationMirrorRnaMutation = z.infer<
  typeof companionLeafOperationMirrorRnaMutationSchema
>;

export const companionLeafOperationMirrorRnaMutationsSchema = z
  .array(companionLeafOperationMirrorRnaMutationSchema)
  .max(28)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const propertyMutations = mutations.slice(1);
    const validCreate = mutations.length === 1 && first.mutationKind === 'mirror_modifier_create';
    const validConfiguration =
      mutations.length === 28 &&
      first.mutationKind === 'mirror_modifier_name_write' &&
      propertyMutations.every(
        (mutation, index) =>
          mutation.mutationKind === 'mirror_modifier_property_write' &&
          mutation.order === index + 2 &&
          mutation.targetId === first.targetId &&
          mutation.modifierId === first.modifierId &&
          mutation.modifierName === first.observedName,
      ) &&
      propertyMutations
        .slice(0, 3)
        .filter(
          (mutation) =>
            mutation.mutationKind === 'mirror_modifier_property_write' &&
            mutation.acceptedValue === true,
        ).length === 1;
    if (!validCreate && !validConfiguration) {
      context.addIssue({
        code: 'custom',
        message: 'Mirror mutations must preserve exact create or name/property sequence',
      });
    }
  });
export type CompanionLeafOperationMirrorRnaMutations = z.infer<
  typeof companionLeafOperationMirrorRnaMutationsSchema
>;

const subdivisionSurfacePendingModifierNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingSubdivisionSurfaceModifier\.[0-9a-f]{8}$/);
const subdivisionSurfaceRnaMutationCommon = {
  mcpTool: z.literal('operatingline.blender.modifier.subdivision-surface.execute-next'),
  targetId: z.string().min(1),
  modifierId: z.string().min(1),
};

const companionLeafOperationSubdivisionSurfaceRnaCreateSchema = z
  .strictObject({
    ...subdivisionSurfaceRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_subdivision_surface_modifier_create'),
    sourceOperationId: z.literal('operator.subdivision_set'),
    semanticAction: z.literal('operator.subdivision_set'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('subdivision_surface_modifier_create'),
    pendingModifierName: subdivisionSurfacePendingModifierNameSchema,
    resourceType: z.literal('SubsurfModifier'),
    modifierType: z.literal('SUBSURF'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('Layout'),
      z.string().min(1),
      z.literal('Object'),
      z.literal('Subdivision Set'),
      subdivisionSurfacePendingModifierNameSchema,
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[4] !== mutation.pendingModifierName
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Subdivision Surface Modifier creation must preserve its target and pending UI path',
      });
    }
  });

const companionLeafOperationSubdivisionSurfaceRnaNameWriteSchema = z
  .strictObject({
    ...subdivisionSurfaceRnaMutationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_modifier_name_write'),
    sourceOperationId: z.literal('semantic.subdivision_surface_contract'),
    semanticAction: z.literal('semantic.subdivision_surface_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('modifierName'),
    mutationKind: z.literal('subdivision_surface_modifier_name_write'),
    beforeName: subdivisionSurfacePendingModifierNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.literal('Name'),
    ]),
  })
  .superRefine((mutation, context) => {
    if (
      mutation.acceptedName !== mutation.observedName ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.observedName
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Subdivision Surface Modifier name write must preserve its accepted value and UI path',
      });
    }
  });

const subdivisionSurfaceRnaPropertyNames = [
  'subdivision_type',
  'levels',
  'render_levels',
  'quality',
  'show_only_control_edges',
  'use_creases',
  'use_limit_surface',
  'boundary_smooth',
  'uv_smooth',
  'use_custom_normals',
  'show_viewport',
  'show_render',
  'show_in_editmode',
  'show_on_cage',
] as const;
type SubdivisionSurfaceRnaPropertyName = (typeof subdivisionSurfaceRnaPropertyNames)[number];
const subdivisionSurfaceRnaPropertyBindings: Readonly<
  Record<
    SubdivisionSurfaceRnaPropertyName,
    {
      readonly valueSource: 'catalog_constant' | 'accepted_action_argument';
      readonly actionArgument: 'viewportLevel' | null;
      readonly constantValue?: boolean | number | string;
    }
  >
> = {
  subdivision_type: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'CATMULL_CLARK',
  },
  levels: { valueSource: 'accepted_action_argument', actionArgument: 'viewportLevel' },
  render_levels: { valueSource: 'catalog_constant', actionArgument: null, constantValue: 2 },
  quality: { valueSource: 'catalog_constant', actionArgument: null, constantValue: 3 },
  show_only_control_edges: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  use_creases: { valueSource: 'catalog_constant', actionArgument: null, constantValue: true },
  use_limit_surface: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  boundary_smooth: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'ALL',
  },
  uv_smooth: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: 'PRESERVE_BOUNDARIES',
  },
  use_custom_normals: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
  show_viewport: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  show_render: { valueSource: 'catalog_constant', actionArgument: null, constantValue: true },
  show_in_editmode: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: true,
  },
  show_on_cage: {
    valueSource: 'catalog_constant',
    actionArgument: null,
    constantValue: false,
  },
};

const subdivisionSurfaceRnaValueSchema = z.union([z.boolean(), z.number().finite(), z.string()]);
const companionLeafOperationSubdivisionSurfaceRnaPropertyWriteSchema = z
  .strictObject({
    ...subdivisionSurfaceRnaMutationCommon,
    order: z.number().int().min(2).max(15),
    executionMethod: z.literal('blender_rna_subdivision_surface_modifier_property_write'),
    sourceOperationId: z.literal('semantic.subdivision_surface_contract'),
    semanticAction: z.literal('semantic.subdivision_surface_contract'),
    valueSource: z.enum(['catalog_constant', 'accepted_action_argument']),
    actionArgument: z.union([z.null(), z.literal('viewportLevel')]),
    mutationKind: z.literal('subdivision_surface_modifier_property_write'),
    modifierName: z.string().min(1),
    propertyName: z.enum(subdivisionSurfaceRnaPropertyNames),
    acceptedValue: subdivisionSurfaceRnaValueSchema,
    observedValue: subdivisionSurfaceRnaValueSchema,
    uiPath: z.tuple([
      z.literal('Properties'),
      z.string().min(1),
      z.literal('Modifiers'),
      z.string().min(1),
      z.enum(subdivisionSurfaceRnaPropertyNames),
    ]),
  })
  .superRefine((mutation, context) => {
    const propertyIndex = subdivisionSurfaceRnaPropertyNames.indexOf(mutation.propertyName);
    const binding = subdivisionSurfaceRnaPropertyBindings[mutation.propertyName];
    const observedMatches =
      typeof mutation.acceptedValue === typeof mutation.observedValue &&
      mutation.acceptedValue === mutation.observedValue;
    const constantMatches =
      binding.constantValue === undefined || mutation.acceptedValue === binding.constantValue;
    const actionValueMatches =
      binding.actionArgument === null ||
      (typeof mutation.acceptedValue === 'number' &&
        Number.isInteger(mutation.acceptedValue) &&
        mutation.acceptedValue >= 1 &&
        mutation.acceptedValue <= 3);
    if (
      mutation.order !== propertyIndex + 2 ||
      mutation.valueSource !== binding.valueSource ||
      mutation.actionArgument !== binding.actionArgument ||
      !observedMatches ||
      !constantMatches ||
      !actionValueMatches ||
      mutation.uiPath[1] !== mutation.targetId ||
      mutation.uiPath[3] !== mutation.modifierName ||
      mutation.uiPath[4] !== mutation.propertyName
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Subdivision Surface property write must preserve exact order, value source, and UI path',
      });
    }
  });

export const companionLeafOperationSubdivisionSurfaceRnaMutationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationSubdivisionSurfaceRnaCreateSchema,
    companionLeafOperationSubdivisionSurfaceRnaNameWriteSchema,
    companionLeafOperationSubdivisionSurfaceRnaPropertyWriteSchema,
  ],
);
export type CompanionLeafOperationSubdivisionSurfaceRnaMutation = z.infer<
  typeof companionLeafOperationSubdivisionSurfaceRnaMutationSchema
>;

export const companionLeafOperationSubdivisionSurfaceRnaMutationsSchema = z
  .array(companionLeafOperationSubdivisionSurfaceRnaMutationSchema)
  .max(15)
  .superRefine((mutations, context) => {
    if (mutations.length === 0) return;
    const first = mutations[0]!;
    const validCreate =
      mutations.length === 1 && first.mutationKind === 'subdivision_surface_modifier_create';
    const validConfiguration =
      mutations.length === 15 &&
      first.mutationKind === 'subdivision_surface_modifier_name_write' &&
      mutations
        .slice(1)
        .every(
          (mutation, index) =>
            mutation.mutationKind === 'subdivision_surface_modifier_property_write' &&
            mutation.order === index + 2 &&
            mutation.propertyName === subdivisionSurfaceRnaPropertyNames[index] &&
            mutation.targetId === first.targetId &&
            mutation.modifierId === first.modifierId &&
            mutation.modifierName === first.observedName,
        );
    if (!validCreate && !validConfiguration) {
      context.addIssue({
        code: 'custom',
        message:
          'Subdivision Surface mutations must preserve exact create or name/property sequence',
      });
    }
  });
export type CompanionLeafOperationSubdivisionSurfaceRnaMutations = z.infer<
  typeof companionLeafOperationSubdivisionSurfaceRnaMutationsSchema
>;

const editBevelPendingResultMeshNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingEditBevelMesh\.[0-9a-f]{8}$/);
const editBevelMeshOperationCommon = {
  mcpTool: z.literal('operatingline.blender.mesh.edit-bevel-edges.execute-next'),
  targetId: z.string().min(1),
  resultMeshId: z.string().min(1),
};

const companionLeafOperationEditBevelMeshCreateSchema = z
  .strictObject({
    ...editBevelMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_copy'),
    sourceOperationId: z.literal('operator.bevel_edges'),
    semanticAction: z.literal('operator.bevel_edges'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_bevel_mesh_create'),
    pendingResultMeshName: editBevelPendingResultMeshNameSchema,
    resourceType: z.literal('Mesh'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Edit Bevel Edges'),
      z.literal('Result Mesh'),
      editBevelPendingResultMeshNameSchema,
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.uiPath[4] !== operation.pendingResultMeshName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel mesh creation must preserve its pending result identity',
      });
    }
  });

const editBevelParameterNames = ['width', 'segments', 'profile'] as const;
const editBevelParameterLabels = ['Width', 'Segments', 'Profile Shape'] as const;
const companionLeafOperationEditBevelParameterProjectionSchema = z
  .strictObject({
    ...editBevelMeshOperationCommon,
    order: z.number().int().min(2).max(4),
    executionMethod: z.literal('blender_bmesh_bevel_argument_projection'),
    sourceOperationId: z.literal('operator.bevel_edges'),
    semanticAction: z.literal('operator.bevel_edges'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum(editBevelParameterNames),
    mutationKind: z.literal('edit_bevel_parameter_projection'),
    parameterName: z.enum(editBevelParameterNames),
    acceptedValue: z.number().finite(),
    projectedValue: z.number().finite(),
    uiPath: z.tuple([z.literal('Adjust Last Operation'), z.enum(editBevelParameterLabels)]),
  })
  .superRefine((operation, context) => {
    const index = operation.order - 2;
    const parameterName = editBevelParameterNames[index];
    const validRange =
      operation.parameterName === 'width'
        ? operation.acceptedValue >= 0.0001 && operation.acceptedValue <= 100
        : operation.parameterName === 'segments'
          ? Number.isInteger(operation.acceptedValue) &&
            operation.acceptedValue >= 1 &&
            operation.acceptedValue <= 16
          : operation.acceptedValue >= 0 && operation.acceptedValue <= 1;
    if (
      operation.parameterName !== parameterName ||
      operation.actionArgument !== parameterName ||
      operation.uiPath[1] !== editBevelParameterLabels[index] ||
      operation.acceptedValue !== operation.projectedValue ||
      !validRange
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel parameter projection must preserve exact order, value, and UI path',
      });
    }
  });

const editBevelTopologySchema = z.tuple([
  z.number().int().nonnegative().max(8192),
  z.number().int().nonnegative().max(16384),
  z.number().int().nonnegative().max(8192),
]);
const companionLeafOperationEditBevelMeshContentWriteSchema = z
  .strictObject({
    ...editBevelMeshOperationCommon,
    order: z.literal(5),
    executionMethod: z.literal('blender_bmesh_ops_bevel'),
    sourceOperationId: z.literal('operator.bevel_edges'),
    semanticAction: z.literal('operator.bevel_edges'),
    valueSource: z.literal('accepted_action_and_catalog_constants'),
    mutationKind: z.literal('edit_bevel_mesh_content_write'),
    fixedParameters: z.strictObject({
      offsetType: z.literal('OFFSET'),
      affect: z.literal('EDGES'),
      clampOverlap: z.literal(false),
      loopSlide: z.literal(true),
      markSeam: z.literal(false),
      markSharp: z.literal(false),
      material: z.literal(-1),
      hardenNormals: z.literal(false),
      faceStrengthMode: z.literal('NONE'),
      miterOuter: z.literal('SHARP'),
      miterInner: z.literal('SHARP'),
      spread: z.literal(0.1),
      vmeshMethod: z.literal('ADJ'),
    }),
    sourceTopology: editBevelTopologySchema,
    resultTopology: editBevelTopologySchema,
    sourceContentPreserved: z.literal(true),
    resultContentObserved: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Edit Bevel Edges'),
      z.literal('Apply BMesh Bevel'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultTopology.some(
        (resultCount, index) => resultCount <= operation.sourceTopology[index]!,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel result topology must grow from the preserved source topology',
      });
    }
  });

const companionLeafOperationEditBevelMeshNameWriteSchema = z
  .strictObject({
    ...editBevelMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_name_write'),
    sourceOperationId: z.literal('semantic.managed_bevel_edges_contract'),
    semanticAction: z.literal('semantic.managed_bevel_edges_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('resultMeshName'),
    mutationKind: z.literal('edit_bevel_mesh_name_write'),
    beforeName: editBevelPendingResultMeshNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Edit Bevel Edges'),
      z.literal('Result Mesh Name'),
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedName !== operation.observedName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel mesh name write must preserve the accepted result name',
      });
    }
  });

const companionLeafOperationEditBevelObjectDataLinkWriteSchema = z
  .strictObject({
    ...editBevelMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_object_data_link_write'),
    sourceOperationId: z.literal('semantic.managed_bevel_edges_contract'),
    semanticAction: z.literal('semantic.managed_bevel_edges_contract'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_bevel_object_data_link_write'),
    sourceMeshLogicalId: z.string().min(1),
    resultMeshLogicalId: z.string().min(1),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Edit Bevel Edges'),
      z.literal('Object Data Link'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultMeshLogicalId !== operation.resultMeshId ||
      operation.sourceMeshLogicalId === operation.resultMeshLogicalId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel data-link write must bind distinct source and accepted result meshes',
      });
    }
  });

export const companionLeafOperationEditBevelMeshOperationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationEditBevelMeshCreateSchema,
    companionLeafOperationEditBevelParameterProjectionSchema,
    companionLeafOperationEditBevelMeshContentWriteSchema,
    companionLeafOperationEditBevelMeshNameWriteSchema,
    companionLeafOperationEditBevelObjectDataLinkWriteSchema,
  ],
);
export type CompanionLeafOperationEditBevelMeshOperation = z.infer<
  typeof companionLeafOperationEditBevelMeshOperationSchema
>;

export const companionLeafOperationEditBevelMeshOperationsSchema = z
  .array(companionLeafOperationEditBevelMeshOperationSchema)
  .max(5)
  .superRefine((operations, context) => {
    if (operations.length === 0) return;
    const first = operations[0]!;
    const sameBinding = operations.every(
      (operation) =>
        operation.targetId === first.targetId && operation.resultMeshId === first.resultMeshId,
    );
    const validBevel =
      operations.length === 5 &&
      first.mutationKind === 'edit_bevel_mesh_create' &&
      operations[1]?.mutationKind === 'edit_bevel_parameter_projection' &&
      operations[2]?.mutationKind === 'edit_bevel_parameter_projection' &&
      operations[3]?.mutationKind === 'edit_bevel_parameter_projection' &&
      operations[4]?.mutationKind === 'edit_bevel_mesh_content_write';
    const validContract =
      operations.length === 2 &&
      first.mutationKind === 'edit_bevel_mesh_name_write' &&
      operations[1]?.mutationKind === 'edit_bevel_object_data_link_write';
    if (!sameBinding || (!validBevel && !validContract)) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Bevel operations must preserve the exact bevel or managed-contract sequence',
      });
    }
  });
export type CompanionLeafOperationEditBevelMeshOperations = z.infer<
  typeof companionLeafOperationEditBevelMeshOperationsSchema
>;

const editInsetPendingResultMeshNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingEditInsetMesh\.[0-9a-f]{8}$/);
const editInsetMeshOperationCommon = {
  mcpTool: z.literal('operatingline.blender.mesh.edit-inset-faces.execute-next'),
  targetId: z.string().min(1),
  resultMeshId: z.string().min(1),
};

const companionLeafOperationEditInsetMeshCreateSchema = z
  .strictObject({
    ...editInsetMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_copy'),
    sourceOperationId: z.literal('operator.inset_faces'),
    semanticAction: z.literal('operator.inset_faces'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_inset_mesh_create'),
    pendingResultMeshName: editInsetPendingResultMeshNameSchema,
    resourceType: z.literal('Mesh'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Individual Inset Faces'),
      z.literal('Result Mesh'),
      editInsetPendingResultMeshNameSchema,
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.uiPath[4] !== operation.pendingResultMeshName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset mesh creation must preserve its pending result identity',
      });
    }
  });

const editInsetParameterNames = ['thickness', 'depth'] as const;
const editInsetParameterLabels = ['Thickness', 'Depth'] as const;
const companionLeafOperationEditInsetParameterProjectionSchema = z
  .strictObject({
    ...editInsetMeshOperationCommon,
    order: z.number().int().min(2).max(3),
    executionMethod: z.literal('blender_bmesh_inset_individual_argument_projection'),
    sourceOperationId: z.literal('operator.inset_faces'),
    semanticAction: z.literal('operator.inset_faces'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.enum(editInsetParameterNames),
    mutationKind: z.literal('edit_inset_parameter_projection'),
    parameterName: z.enum(editInsetParameterNames),
    acceptedValue: z.number().finite(),
    projectedValue: z.number().finite(),
    uiPath: z.tuple([z.literal('Adjust Last Operation'), z.enum(editInsetParameterLabels)]),
  })
  .superRefine((operation, context) => {
    const index = operation.order - 2;
    const parameterName = editInsetParameterNames[index];
    const validRange =
      operation.parameterName === 'thickness'
        ? operation.acceptedValue >= 0.0001 && operation.acceptedValue <= 100
        : operation.acceptedValue >= -100 && operation.acceptedValue <= 100;
    if (
      operation.parameterName !== parameterName ||
      operation.actionArgument !== parameterName ||
      operation.uiPath[1] !== editInsetParameterLabels[index] ||
      operation.acceptedValue !== operation.projectedValue ||
      !validRange
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset parameter projection must preserve exact order, value, and UI path',
      });
    }
  });

const editInsetTopologySchema = z.tuple([
  z.number().int().nonnegative().max(8192),
  z.number().int().nonnegative().max(16384),
  z.number().int().nonnegative().max(8192),
]);
const companionLeafOperationEditInsetMeshContentWriteSchema = z
  .strictObject({
    ...editInsetMeshOperationCommon,
    order: z.literal(4),
    executionMethod: z.literal('blender_bmesh_ops_inset_individual'),
    sourceOperationId: z.literal('operator.inset_faces'),
    semanticAction: z.literal('operator.inset_faces'),
    valueSource: z.literal('accepted_action_and_catalog_constants'),
    mutationKind: z.literal('edit_inset_mesh_content_write'),
    fixedParameters: z.strictObject({
      useEvenOffset: z.literal(true),
      useInterpolate: z.literal(true),
      useRelativeOffset: z.literal(false),
    }),
    sourceTopology: editInsetTopologySchema,
    sourceLoopCount: z.number().int().positive().max(32768),
    expectedTopology: editInsetTopologySchema,
    resultTopology: editInsetTopologySchema,
    sourceContentPreserved: z.literal(true),
    resultContentObserved: z.literal(true),
    resultNondegenerate: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Individual Inset Faces'),
      z.literal('Apply BMesh Individual Inset'),
    ]),
  })
  .superRefine((operation, context) => {
    const expected = [
      operation.sourceTopology[0] + operation.sourceLoopCount,
      operation.sourceTopology[1] + 2 * operation.sourceLoopCount,
      operation.sourceTopology[2] + operation.sourceLoopCount,
    ];
    if (
      operation.expectedTopology.some((count, index) => count !== expected[index]) ||
      operation.resultTopology.some((count, index) => count !== operation.expectedTopology[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset result topology must satisfy the exact loop-count formula',
      });
    }
  });

const companionLeafOperationEditInsetMeshNameWriteSchema = z
  .strictObject({
    ...editInsetMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_name_write'),
    sourceOperationId: z.literal('semantic.managed_inset_faces_contract'),
    semanticAction: z.literal('semantic.managed_inset_faces_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('resultMeshName'),
    mutationKind: z.literal('edit_inset_mesh_name_write'),
    beforeName: editInsetPendingResultMeshNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Individual Inset Faces'),
      z.literal('Result Mesh Name'),
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedName !== operation.observedName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset mesh name write must preserve the accepted result name',
      });
    }
  });

const companionLeafOperationEditInsetObjectDataLinkWriteSchema = z
  .strictObject({
    ...editInsetMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_object_data_link_write'),
    sourceOperationId: z.literal('semantic.managed_inset_faces_contract'),
    semanticAction: z.literal('semantic.managed_inset_faces_contract'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_inset_object_data_link_write'),
    sourceMeshLogicalId: z.string().min(1),
    resultMeshLogicalId: z.string().min(1),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Individual Inset Faces'),
      z.literal('Object Data Link'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultMeshLogicalId !== operation.resultMeshId ||
      operation.sourceMeshLogicalId === operation.resultMeshLogicalId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset data-link write must bind distinct source and accepted result meshes',
      });
    }
  });

export const companionLeafOperationEditInsetMeshOperationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationEditInsetMeshCreateSchema,
    companionLeafOperationEditInsetParameterProjectionSchema,
    companionLeafOperationEditInsetMeshContentWriteSchema,
    companionLeafOperationEditInsetMeshNameWriteSchema,
    companionLeafOperationEditInsetObjectDataLinkWriteSchema,
  ],
);
export type CompanionLeafOperationEditInsetMeshOperation = z.infer<
  typeof companionLeafOperationEditInsetMeshOperationSchema
>;

export const companionLeafOperationEditInsetMeshOperationsSchema = z
  .array(companionLeafOperationEditInsetMeshOperationSchema)
  .max(4)
  .superRefine((operations, context) => {
    if (operations.length === 0) return;
    const first = operations[0]!;
    const sameBinding = operations.every(
      (operation) =>
        operation.targetId === first.targetId && operation.resultMeshId === first.resultMeshId,
    );
    const validInset =
      operations.length === 4 &&
      first.mutationKind === 'edit_inset_mesh_create' &&
      operations[1]?.mutationKind === 'edit_inset_parameter_projection' &&
      operations[2]?.mutationKind === 'edit_inset_parameter_projection' &&
      operations[3]?.mutationKind === 'edit_inset_mesh_content_write';
    const validContract =
      operations.length === 2 &&
      first.mutationKind === 'edit_inset_mesh_name_write' &&
      operations[1]?.mutationKind === 'edit_inset_object_data_link_write';
    if (!sameBinding || (!validInset && !validContract)) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Inset operations must preserve the exact inset or managed-contract sequence',
      });
    }
  });
export type CompanionLeafOperationEditInsetMeshOperations = z.infer<
  typeof companionLeafOperationEditInsetMeshOperationsSchema
>;

const editTriangulatePendingResultMeshNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingEditTriangulateMesh\.[0-9a-f]{8}$/);
const editTriangulateMeshOperationCommon = {
  mcpTool: z.literal('operatingline.blender.mesh.edit-triangulate.execute-next'),
  targetId: z.string().min(1),
  resultMeshId: z.string().min(1),
};

const companionLeafOperationEditTriangulateMeshCreateSchema = z
  .strictObject({
    ...editTriangulateMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_copy'),
    sourceOperationId: z.literal('operator.triangulate_faces'),
    semanticAction: z.literal('operator.triangulate_faces'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_triangulate_mesh_create'),
    pendingResultMeshName: editTriangulatePendingResultMeshNameSchema,
    resourceType: z.literal('Mesh'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Triangulate Faces'),
      z.literal('Result Mesh'),
      editTriangulatePendingResultMeshNameSchema,
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.uiPath[4] !== operation.pendingResultMeshName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Triangulate mesh creation must preserve its pending result identity',
      });
    }
  });

const editTriangulateTopologySchema = z.tuple([
  z.number().int().nonnegative().max(8192),
  z.number().int().nonnegative().max(16384),
  z.number().int().nonnegative().max(8192),
]);
const companionLeafOperationEditTriangulateMeshContentWriteSchema = z
  .strictObject({
    ...editTriangulateMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_bmesh_ops_triangulate'),
    sourceOperationId: z.literal('operator.triangulate_faces'),
    semanticAction: z.literal('operator.triangulate_faces'),
    valueSource: z.literal('managed_source_and_catalog_constants'),
    mutationKind: z.literal('edit_triangulate_mesh_content_write'),
    fixedParameters: z.strictObject({
      quadMethod: z.literal('FIXED'),
      ngonMethod: z.literal('EAR_CLIP'),
    }),
    sourceTopology: editTriangulateTopologySchema,
    sourceLoopCount: z.number().int().positive().max(32768),
    expectedTopology: editTriangulateTopologySchema,
    resultTopology: editTriangulateTopologySchema,
    sourceContentPreserved: z.literal(true),
    resultContentObserved: z.literal(true),
    allTriangles: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Triangulate Faces'),
      z.literal('Apply BMesh Triangulate Faces'),
    ]),
  })
  .superRefine((operation, context) => {
    const expected = [
      operation.sourceTopology[0],
      operation.sourceTopology[1] + operation.sourceLoopCount - 3 * operation.sourceTopology[2],
      operation.sourceLoopCount - 2 * operation.sourceTopology[2],
    ];
    if (
      operation.expectedTopology.some((count, index) => count !== expected[index]) ||
      operation.resultTopology.some((count, index) => count !== operation.expectedTopology[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Triangulate result topology must satisfy the exact face/loop-count formula',
      });
    }
  });

const companionLeafOperationEditTriangulateMeshNameWriteSchema = z
  .strictObject({
    ...editTriangulateMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_name_write'),
    sourceOperationId: z.literal('semantic.managed_triangulate_contract'),
    semanticAction: z.literal('semantic.managed_triangulate_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('resultMeshName'),
    mutationKind: z.literal('edit_triangulate_mesh_name_write'),
    beforeName: editTriangulatePendingResultMeshNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Triangulate Faces'),
      z.literal('Result Mesh Name'),
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedName !== operation.observedName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Triangulate mesh name write must preserve the accepted result name',
      });
    }
  });

const companionLeafOperationEditTriangulateObjectDataLinkWriteSchema = z
  .strictObject({
    ...editTriangulateMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_object_data_link_write'),
    sourceOperationId: z.literal('semantic.managed_triangulate_contract'),
    semanticAction: z.literal('semantic.managed_triangulate_contract'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_triangulate_object_data_link_write'),
    sourceMeshLogicalId: z.string().min(1),
    resultMeshLogicalId: z.string().min(1),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Triangulate Faces'),
      z.literal('Object Data Link'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultMeshLogicalId !== operation.resultMeshId ||
      operation.sourceMeshLogicalId === operation.resultMeshLogicalId
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Edit Triangulate data-link write must bind distinct source and accepted result meshes',
      });
    }
  });

export const companionLeafOperationEditTriangulateMeshOperationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationEditTriangulateMeshCreateSchema,
    companionLeafOperationEditTriangulateMeshContentWriteSchema,
    companionLeafOperationEditTriangulateMeshNameWriteSchema,
    companionLeafOperationEditTriangulateObjectDataLinkWriteSchema,
  ],
);
export type CompanionLeafOperationEditTriangulateMeshOperation = z.infer<
  typeof companionLeafOperationEditTriangulateMeshOperationSchema
>;

export const companionLeafOperationEditTriangulateMeshOperationsSchema = z
  .array(companionLeafOperationEditTriangulateMeshOperationSchema)
  .max(2)
  .superRefine((operations, context) => {
    if (operations.length === 0) return;
    const first = operations[0]!;
    const sameBinding = operations.every(
      (operation) =>
        operation.targetId === first.targetId && operation.resultMeshId === first.resultMeshId,
    );
    const validTriangulate =
      operations.length === 2 &&
      first.mutationKind === 'edit_triangulate_mesh_create' &&
      operations[1]?.mutationKind === 'edit_triangulate_mesh_content_write';
    const validContract =
      operations.length === 2 &&
      first.mutationKind === 'edit_triangulate_mesh_name_write' &&
      operations[1]?.mutationKind === 'edit_triangulate_object_data_link_write';
    if (!sameBinding || (!validTriangulate && !validContract)) {
      context.addIssue({
        code: 'custom',
        message:
          'Edit Triangulate operations must preserve the exact triangulate or managed-contract sequence',
      });
    }
  });
export type CompanionLeafOperationEditTriangulateMeshOperations = z.infer<
  typeof companionLeafOperationEditTriangulateMeshOperationsSchema
>;

const editExtrudeRegionPendingResultMeshNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingEditExtrudeRegionMesh\.[0-9a-f]{8}$/);
const editExtrudeRegionMeshOperationCommon = {
  mcpTool: z.literal('operatingline.blender.mesh.edit-extrude-region.execute-next'),
  targetId: z.string().min(1),
  resultMeshId: z.string().min(1),
};
const editExtrudeRegionTopologySchema = z.tuple([
  z.number().int().nonnegative().max(8192),
  z.number().int().nonnegative().max(16384),
  z.number().int().nonnegative().max(8192),
]);
const editExtrudeRegionPolygonIndicesSchema = z
  .array(z.number().int().min(0).max(8191))
  .min(1)
  .max(256)
  .superRefine((indices, context) => {
    if (new Set(indices).size !== indices.length) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region polygon indices must be unique',
      });
    }
  });
const editExtrudeRegionTranslationSchema = z.tuple([
  z.number().finite().min(-1000).max(1000),
  z.number().finite().min(-1000).max(1000),
  z.number().finite().min(-1000).max(1000),
]);

const companionLeafOperationEditExtrudeRegionSelectionProjectionSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_bmesh_region_validation'),
    sourceOperationId: z.literal('semantic.select_face_region'),
    semanticAction: z.literal('semantic.select_face_region'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('polygonIndices'),
    mutationKind: z.literal('edit_extrude_region_selection_projection'),
    acceptedPolygonIndices: editExtrudeRegionPolygonIndicesSchema,
    observedPolygonIndices: editExtrudeRegionPolygonIndicesSchema,
    sourceTopology: editExtrudeRegionTopologySchema,
    selectedFaceCount: z.number().int().positive().max(256),
    selectedEdgeCount: z.number().int().positive().max(16384),
    selectedVertexCount: z.number().int().positive().max(8192),
    boundaryEdgeCount: z.number().int().positive().max(16384),
    selectionObserved: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Face Region'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.selectedFaceCount !== operation.acceptedPolygonIndices.length ||
      operation.acceptedPolygonIndices.some(
        (index, position) => index !== operation.observedPolygonIndices[position],
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region selection proof must preserve every accepted polygon index',
      });
    }
  });

const companionLeafOperationEditExtrudeRegionMeshCreateSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_copy'),
    sourceOperationId: z.literal('operator.extrude_region_move'),
    semanticAction: z.literal('operator.extrude_region_move'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_extrude_region_mesh_create'),
    pendingResultMeshName: editExtrudeRegionPendingResultMeshNameSchema,
    resourceType: z.literal('Mesh'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Result Mesh'),
      editExtrudeRegionPendingResultMeshNameSchema,
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.uiPath[4] !== operation.pendingResultMeshName) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region mesh creation must preserve its pending result identity',
      });
    }
  });

const companionLeafOperationEditExtrudeRegionTranslationProjectionSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_bmesh_ops_translate'),
    sourceOperationId: z.literal('operator.extrude_region_move'),
    semanticAction: z.literal('operator.extrude_region_move'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('translation'),
    mutationKind: z.literal('edit_extrude_region_translation_projection'),
    acceptedTranslation: editExtrudeRegionTranslationSchema,
    observedTranslation: editExtrudeRegionTranslationSchema,
    translationObserved: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Translation'),
    ]),
  })
  .superRefine((operation, context) => {
    const length = Math.hypot(...operation.acceptedTranslation);
    if (
      length < 0.0001 ||
      length > 1000 ||
      operation.acceptedTranslation.some(
        (component, index) => component !== operation.observedTranslation[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region translation proof must preserve the bounded accepted vector',
      });
    }
  });

const companionLeafOperationEditExtrudeRegionMeshContentWriteSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(3),
    executionMethod: z.literal('blender_bmesh_ops_extrude_face_region'),
    sourceOperationId: z.literal('operator.extrude_region_move'),
    semanticAction: z.literal('operator.extrude_region_move'),
    valueSource: z.literal('managed_source_and_accepted_action_arguments'),
    mutationKind: z.literal('edit_extrude_region_mesh_content_write'),
    sourceTopology: editExtrudeRegionTopologySchema,
    selectedFaceCount: z.number().int().positive().max(256),
    selectedEdgeCount: z.number().int().positive().max(16384),
    selectedVertexCount: z.number().int().positive().max(8192),
    boundaryEdgeCount: z.number().int().positive().max(16384),
    expectedTopology: editExtrudeRegionTopologySchema,
    resultTopology: editExtrudeRegionTopologySchema,
    sourceContentPreserved: z.literal(true),
    resultContentObserved: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Apply BMesh Extrude Face Region'),
    ]),
  })
  .superRefine((operation, context) => {
    const expected = [
      operation.sourceTopology[0] + operation.selectedVertexCount,
      operation.sourceTopology[1] + operation.selectedEdgeCount + operation.boundaryEdgeCount,
      operation.sourceTopology[2] + operation.boundaryEdgeCount,
    ];
    if (
      operation.expectedTopology.some((count, index) => count !== expected[index]) ||
      operation.resultTopology.some((count, index) => count !== operation.expectedTopology[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region result topology must satisfy the exact selected-region formula',
      });
    }
  });

const companionLeafOperationEditExtrudeRegionMeshNameWriteSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_name_write'),
    sourceOperationId: z.literal('semantic.managed_extrude_region_contract'),
    semanticAction: z.literal('semantic.managed_extrude_region_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('resultMeshName'),
    mutationKind: z.literal('edit_extrude_region_mesh_name_write'),
    beforeName: editExtrudeRegionPendingResultMeshNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Result Mesh Name'),
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedName !== operation.observedName) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region mesh name write must preserve the accepted result name',
      });
    }
  });

const companionLeafOperationEditExtrudeRegionObjectDataLinkWriteSchema = z
  .strictObject({
    ...editExtrudeRegionMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_object_data_link_write'),
    sourceOperationId: z.literal('semantic.managed_extrude_region_contract'),
    semanticAction: z.literal('semantic.managed_extrude_region_contract'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_extrude_region_object_data_link_write'),
    sourceMeshLogicalId: z.string().min(1),
    resultMeshLogicalId: z.string().min(1),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Extrude Region'),
      z.literal('Object Data Link'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultMeshLogicalId !== operation.resultMeshId ||
      operation.sourceMeshLogicalId === operation.resultMeshLogicalId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region data-link write must bind distinct source and result meshes',
      });
    }
  });

export const companionLeafOperationEditExtrudeRegionMeshOperationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationEditExtrudeRegionSelectionProjectionSchema,
    companionLeafOperationEditExtrudeRegionMeshCreateSchema,
    companionLeafOperationEditExtrudeRegionTranslationProjectionSchema,
    companionLeafOperationEditExtrudeRegionMeshContentWriteSchema,
    companionLeafOperationEditExtrudeRegionMeshNameWriteSchema,
    companionLeafOperationEditExtrudeRegionObjectDataLinkWriteSchema,
  ],
);
export type CompanionLeafOperationEditExtrudeRegionMeshOperation = z.infer<
  typeof companionLeafOperationEditExtrudeRegionMeshOperationSchema
>;

export const companionLeafOperationEditExtrudeRegionMeshOperationsSchema = z
  .array(companionLeafOperationEditExtrudeRegionMeshOperationSchema)
  .max(3)
  .superRefine((operations, context) => {
    if (operations.length === 0) return;
    const first = operations[0]!;
    const sameBinding = operations.every(
      (operation) =>
        operation.targetId === first.targetId && operation.resultMeshId === first.resultMeshId,
    );
    const validSelection =
      operations.length === 1 && first.mutationKind === 'edit_extrude_region_selection_projection';
    const validExtrude =
      operations.length === 3 &&
      first.mutationKind === 'edit_extrude_region_mesh_create' &&
      operations[1]?.mutationKind === 'edit_extrude_region_translation_projection' &&
      operations[2]?.mutationKind === 'edit_extrude_region_mesh_content_write';
    const validContract =
      operations.length === 2 &&
      first.mutationKind === 'edit_extrude_region_mesh_name_write' &&
      operations[1]?.mutationKind === 'edit_extrude_region_object_data_link_write';
    if (!sameBinding || (!validSelection && !validExtrude && !validContract)) {
      context.addIssue({
        code: 'custom',
        message: 'Extrude Region operations must preserve selection, extrusion, or contract order',
      });
    }
  });
export type CompanionLeafOperationEditExtrudeRegionMeshOperations = z.infer<
  typeof companionLeafOperationEditExtrudeRegionMeshOperationsSchema
>;

const editPokePendingResultMeshNameSchema = z
  .string()
  .regex(/^OperatingLine\.PendingEditPokeMesh\.[0-9a-f]{8}$/);
const editPokeMeshOperationCommon = {
  mcpTool: z.literal('operatingline.blender.mesh.edit-poke-faces.execute-next'),
  targetId: z.string().min(1),
  resultMeshId: z.string().min(1),
};

const companionLeafOperationEditPokeMeshCreateSchema = z
  .strictObject({
    ...editPokeMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_copy'),
    sourceOperationId: z.literal('operator.poke_faces'),
    semanticAction: z.literal('operator.poke_faces'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_poke_mesh_create'),
    pendingResultMeshName: editPokePendingResultMeshNameSchema,
    resourceType: z.literal('Mesh'),
    observedResource: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Poke Faces'),
      z.literal('Result Mesh'),
      editPokePendingResultMeshNameSchema,
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.uiPath[4] !== operation.pendingResultMeshName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke mesh creation must preserve its pending result identity',
      });
    }
  });

const companionLeafOperationEditPokeParameterProjectionSchema = z
  .strictObject({
    ...editPokeMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_bmesh_poke_argument_projection'),
    sourceOperationId: z.literal('operator.poke_faces'),
    semanticAction: z.literal('operator.poke_faces'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('offset'),
    mutationKind: z.literal('edit_poke_parameter_projection'),
    parameterName: z.literal('offset'),
    acceptedValue: z.number().finite().min(-100).max(100),
    projectedValue: z.number().finite(),
    uiPath: z.tuple([z.literal('Adjust Last Operation'), z.literal('Offset')]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedValue !== operation.projectedValue) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke offset projection must preserve the exact accepted value',
      });
    }
  });

const editPokeTopologySchema = z.tuple([
  z.number().int().nonnegative().max(8192),
  z.number().int().nonnegative().max(16384),
  z.number().int().nonnegative().max(8192),
]);
const companionLeafOperationEditPokeMeshContentWriteSchema = z
  .strictObject({
    ...editPokeMeshOperationCommon,
    order: z.literal(3),
    executionMethod: z.literal('blender_bmesh_ops_poke'),
    sourceOperationId: z.literal('operator.poke_faces'),
    semanticAction: z.literal('operator.poke_faces'),
    valueSource: z.literal('accepted_action_and_catalog_constants'),
    mutationKind: z.literal('edit_poke_mesh_content_write'),
    fixedParameters: z.strictObject({
      centerMode: z.literal('MEAN_WEIGHTED'),
      useRelativeOffset: z.literal(false),
    }),
    sourceTopology: editPokeTopologySchema,
    sourceLoopCount: z.number().int().positive().max(32768),
    expectedTopology: editPokeTopologySchema,
    resultTopology: editPokeTopologySchema,
    sourceContentPreserved: z.literal(true),
    resultContentObserved: z.literal(true),
    allTriangles: z.literal(true),
    resultNondegenerate: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Poke Faces'),
      z.literal('Apply BMesh Poke Faces'),
    ]),
  })
  .superRefine((operation, context) => {
    const expected = [
      operation.sourceTopology[0] + operation.sourceTopology[2],
      operation.sourceTopology[1] + operation.sourceLoopCount,
      operation.sourceLoopCount,
    ];
    if (
      operation.expectedTopology.some((count, index) => count !== expected[index]) ||
      operation.resultTopology.some((count, index) => count !== operation.expectedTopology[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke result topology must satisfy the exact face/loop-count formula',
      });
    }
  });

const companionLeafOperationEditPokeMeshNameWriteSchema = z
  .strictObject({
    ...editPokeMeshOperationCommon,
    order: z.literal(1),
    executionMethod: z.literal('blender_rna_mesh_name_write'),
    sourceOperationId: z.literal('semantic.managed_poke_faces_contract'),
    semanticAction: z.literal('semantic.managed_poke_faces_contract'),
    valueSource: z.literal('accepted_action_argument'),
    actionArgument: z.literal('resultMeshName'),
    mutationKind: z.literal('edit_poke_mesh_name_write'),
    beforeName: editPokePendingResultMeshNameSchema,
    acceptedName: z.string().min(1),
    observedName: z.string().min(1),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Poke Faces'),
      z.literal('Result Mesh Name'),
    ]),
  })
  .superRefine((operation, context) => {
    if (operation.acceptedName !== operation.observedName) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke mesh name write must preserve the accepted result name',
      });
    }
  });

const companionLeafOperationEditPokeObjectDataLinkWriteSchema = z
  .strictObject({
    ...editPokeMeshOperationCommon,
    order: z.literal(2),
    executionMethod: z.literal('blender_rna_object_data_link_write'),
    sourceOperationId: z.literal('semantic.managed_poke_faces_contract'),
    semanticAction: z.literal('semantic.managed_poke_faces_contract'),
    valueSource: z.literal('managed_receipt_identity'),
    mutationKind: z.literal('edit_poke_object_data_link_write'),
    sourceMeshLogicalId: z.string().min(1),
    resultMeshLogicalId: z.string().min(1),
    observedLink: z.literal(true),
    uiPath: z.tuple([
      z.literal('OperatingLine'),
      z.literal('Guided Control'),
      z.literal('Poke Faces'),
      z.literal('Object Data Link'),
    ]),
  })
  .superRefine((operation, context) => {
    if (
      operation.resultMeshLogicalId !== operation.resultMeshId ||
      operation.sourceMeshLogicalId === operation.resultMeshLogicalId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke data-link write must bind distinct source and accepted result meshes',
      });
    }
  });

export const companionLeafOperationEditPokeMeshOperationSchema = z.discriminatedUnion(
  'mutationKind',
  [
    companionLeafOperationEditPokeMeshCreateSchema,
    companionLeafOperationEditPokeParameterProjectionSchema,
    companionLeafOperationEditPokeMeshContentWriteSchema,
    companionLeafOperationEditPokeMeshNameWriteSchema,
    companionLeafOperationEditPokeObjectDataLinkWriteSchema,
  ],
);
export type CompanionLeafOperationEditPokeMeshOperation = z.infer<
  typeof companionLeafOperationEditPokeMeshOperationSchema
>;

export const companionLeafOperationEditPokeMeshOperationsSchema = z
  .array(companionLeafOperationEditPokeMeshOperationSchema)
  .max(3)
  .superRefine((operations, context) => {
    if (operations.length === 0) return;
    const first = operations[0]!;
    const sameBinding = operations.every(
      (operation) =>
        operation.targetId === first.targetId && operation.resultMeshId === first.resultMeshId,
    );
    const validPoke =
      operations.length === 3 &&
      first.mutationKind === 'edit_poke_mesh_create' &&
      operations[1]?.mutationKind === 'edit_poke_parameter_projection' &&
      operations[2]?.mutationKind === 'edit_poke_mesh_content_write';
    const validContract =
      operations.length === 2 &&
      first.mutationKind === 'edit_poke_mesh_name_write' &&
      operations[1]?.mutationKind === 'edit_poke_object_data_link_write';
    if (!sameBinding || (!validPoke && !validContract)) {
      context.addIssue({
        code: 'custom',
        message: 'Edit Poke operations must preserve the exact poke or managed-contract sequence',
      });
    }
  });
export type CompanionLeafOperationEditPokeMeshOperations = z.infer<
  typeof companionLeafOperationEditPokeMeshOperationsSchema
>;

const guidedLeafEvidenceSchema = z
  .record(z.string().min(1), z.json())
  .superRefine((evidence, context) => {
    const completed = evidence.completedOperations;
    if (!Array.isArray(completed) || completed.some((ordinal, index) => ordinal !== index + 1)) {
      context.addIssue({
        code: 'custom',
        path: ['completedOperations'],
        message: 'Completed operation ordinals must be an exact prefix starting at one',
      });
    }
    if (typeof evidence.preconditionsValidated !== 'boolean') {
      context.addIssue({
        code: 'custom',
        path: ['preconditionsValidated'],
        message: 'Guided leaf evidence requires precondition proof',
      });
    }
    if (
      evidence.rnaControlWrites !== undefined &&
      !companionLeafOperationRnaControlWritesSchema.safeParse(evidence.rnaControlWrites).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaControlWrites'],
        message: 'RNA control writes must use the strict ordered write contract',
      });
    }
    if (
      evidence.rnaInitializationWrites !== undefined &&
      !companionLeafOperationRnaInitializationWritesSchema.safeParse(
        evidence.rnaInitializationWrites,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaInitializationWrites'],
        message: 'RNA initialization writes must use the strict ordered setup contract',
      });
    }
    if (
      evidence.rnaLinkCreations !== undefined &&
      !companionLeafOperationRnaLinkCreationsSchema.safeParse(evidence.rnaLinkCreations).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaLinkCreations'],
        message: 'RNA link creations must use the strict reviewed endpoint contract',
      });
    }
    if (
      evidence.rnaStructureCreations !== undefined &&
      !companionLeafOperationRnaStructureCreationsSchema.safeParse(evidence.rnaStructureCreations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaStructureCreations'],
        message: 'RNA structure creations must use the strict reviewed node/interface contract',
      });
    }
    if (
      evidence.rnaResourceMutations !== undefined &&
      !companionLeafOperationRnaResourceMutationsSchema.safeParse(evidence.rnaResourceMutations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaResourceMutations'],
        message: 'RNA resource mutations must use the strict reviewed base-resource contract',
      });
    }
    if (
      evidence.rnaKeyframeInsertions !== undefined &&
      !companionLeafOperationPoseRnaKeyframeInsertionsSchema.safeParse(
        evidence.rnaKeyframeInsertions,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaKeyframeInsertions'],
        message: 'RNA keyframe insertions must use the strict ordered Pose contract',
      });
    }
    if (
      evidence.rnaAnimationPropertyWrites !== undefined &&
      !companionLeafOperationPoseRnaAnimationPropertyWritesSchema.safeParse(
        evidence.rnaAnimationPropertyWrites,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaAnimationPropertyWrites'],
        message: 'RNA animation property writes must use the strict ordered Pose contract',
      });
    }
    if (
      evidence.rnaActionResourceMutations !== undefined &&
      !companionLeafOperationPoseRnaActionResourceMutationsSchema.safeParse(
        evidence.rnaActionResourceMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaActionResourceMutations'],
        message: 'RNA Action resource mutations must use the strict ordered Pose contract',
      });
    }
    if (
      evidence.rnaArmatureResourceMutations !== undefined &&
      !companionLeafOperationArmatureRnaResourceMutationsSchema.safeParse(
        evidence.rnaArmatureResourceMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaArmatureResourceMutations'],
        message: 'RNA Armature resources must use the strict create/link/name contract',
      });
    }
    if (
      evidence.rnaArmatureBoneMutations !== undefined &&
      !companionLeafOperationArmatureRnaBoneMutationsSchema.safeParse(
        evidence.rnaArmatureBoneMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaArmatureBoneMutations'],
        message: 'RNA Armature bones must use the strict create/parent/rotation contract',
      });
    }
    if (
      evidence.rnaArmatureBindingMutations !== undefined &&
      !companionLeafOperationArmatureRnaBindingMutationsSchema.safeParse(
        evidence.rnaArmatureBindingMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaArmatureBindingMutations'],
        message: 'RNA Armature bindings must use the strict ordered rigid-parent contract',
      });
    }
    if (
      evidence.rnaSkinWeightMutations !== undefined &&
      !companionLeafOperationSkinRnaWeightMutationsSchema.safeParse(evidence.rnaSkinWeightMutations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaSkinWeightMutations'],
        message: 'RNA Skin weights must use the strict deform/group/weight contract',
      });
    }
    if (
      evidence.rnaSkinModifierMutations !== undefined &&
      !companionLeafOperationSkinRnaModifierMutationsSchema.safeParse(
        evidence.rnaSkinModifierMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaSkinModifierMutations'],
        message: 'RNA Skin modifiers must use the strict create/configure/name contract',
      });
    }
    if (
      evidence.rnaSolidifyModifierMutations !== undefined &&
      !companionLeafOperationSolidifyRnaMutationsSchema.safeParse(
        evidence.rnaSolidifyModifierMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaSolidifyModifierMutations'],
        message: 'RNA Solidify mutations must use the strict create/name/property contract',
      });
    }
    if (
      evidence.rnaBevelModifierMutations !== undefined &&
      !companionLeafOperationBevelModifierRnaMutationsSchema.safeParse(
        evidence.rnaBevelModifierMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaBevelModifierMutations'],
        message: 'RNA Bevel Modifier mutations must use the strict create/name/property contract',
      });
    }
    if (
      evidence.rnaMaterialMutations !== undefined &&
      !companionLeafOperationMaterialRnaMutationsSchema.safeParse(evidence.rnaMaterialMutations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaMaterialMutations'],
        message: 'RNA Material mutations must use the strict create/surface/assignment contract',
      });
    }
    if (
      evidence.rnaMaterialPaletteMutations !== undefined &&
      !companionLeafOperationMaterialPaletteRnaMutationsSchema.safeParse(
        evidence.rnaMaterialPaletteMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaMaterialPaletteMutations'],
        message: 'RNA Material Palette mutations must preserve exact nested material/target order',
      });
    }
    if (
      evidence.rnaMirrorModifierMutations !== undefined &&
      !companionLeafOperationMirrorRnaMutationsSchema.safeParse(evidence.rnaMirrorModifierMutations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaMirrorModifierMutations'],
        message: 'RNA Mirror mutations must use the strict create/name/property contract',
      });
    }
    if (
      evidence.rnaSubdivisionSurfaceModifierMutations !== undefined &&
      !companionLeafOperationSubdivisionSurfaceRnaMutationsSchema.safeParse(
        evidence.rnaSubdivisionSurfaceModifierMutations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rnaSubdivisionSurfaceModifierMutations'],
        message:
          'RNA Subdivision Surface mutations must use the strict create/name/property contract',
      });
    }
    if (
      evidence.editBevelMeshOperations !== undefined &&
      !companionLeafOperationEditBevelMeshOperationsSchema.safeParse(
        evidence.editBevelMeshOperations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editBevelMeshOperations'],
        message: 'Edit Bevel operations must use the strict mesh/parameter/link contract',
      });
    }
    if (
      evidence.editInsetMeshOperations !== undefined &&
      !companionLeafOperationEditInsetMeshOperationsSchema.safeParse(
        evidence.editInsetMeshOperations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editInsetMeshOperations'],
        message: 'Edit Inset operations must use the strict mesh/parameter/topology/link contract',
      });
    }
    if (
      evidence.editTriangulateMeshOperations !== undefined &&
      !companionLeafOperationEditTriangulateMeshOperationsSchema.safeParse(
        evidence.editTriangulateMeshOperations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editTriangulateMeshOperations'],
        message: 'Edit Triangulate operations must use the strict mesh/topology/link contract',
      });
    }
    if (
      evidence.editExtrudeRegionMeshOperations !== undefined &&
      !companionLeafOperationEditExtrudeRegionMeshOperationsSchema.safeParse(
        evidence.editExtrudeRegionMeshOperations,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editExtrudeRegionMeshOperations'],
        message: 'Extrude Region operations must use the strict selection/mesh/topology contract',
      });
    }
    if (
      evidence.editPokeMeshOperations !== undefined &&
      !companionLeafOperationEditPokeMeshOperationsSchema.safeParse(evidence.editPokeMeshOperations)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editPokeMeshOperations'],
        message: 'Edit Poke operations must use the strict mesh/parameter/topology/link contract',
      });
    }
  });

export const companionLeafOperationObservationSchema = z
  .strictObject({
    kind: z.enum([
      'guided_geometry_operation',
      'guided_pose_operation',
      'guided_armature_operation',
      'guided_skin_weights_operation',
      'guided_modifier_operation',
      'guided_material_operation',
      'guided_edit_mesh_operation',
    ]),
    satisfied: z.literal(true),
    details: z.strictObject({
      status: z.literal('passed'),
      direction: z.literal('forward'),
      operationOrdinal: z.number().int().min(1).max(lightTrailsLeafOperationIds.length),
      operationId: operationIdSchema,
      mutating: z.boolean(),
      receiptId: z.uuid(),
      runId: z.uuid(),
      stepId: z.string().min(1),
      actionName: leafOperationActionNameSchema,
      recipeId: leafOperationRecipeIdSchema,
      catalogVersion: catalogVersionSchema,
      beforeFingerprintSha256: sha256Schema,
      afterFingerprintSha256: sha256Schema,
      evidence: guidedLeafEvidenceSchema,
    }),
  })
  .superRefine((observation, context) => {
    const profile = leafOperationProfile(observation.details.actionName);
    if (
      profile === undefined ||
      observation.kind !== profile.observationKind ||
      typeof observation.details.evidence[profile.completionEvidenceKey] !== 'boolean'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The guided observation must match its exact leaf-operation profile',
      });
    }
  });
export type CompanionLeafOperationObservation = z.infer<
  typeof companionLeafOperationObservationSchema
>;

export const companionLeafOperationProgressSchema = z
  .strictObject({
    runId: z.uuid(),
    bindingSha256: sha256Schema,
    stepId: z.string().min(1),
    actionName: leafOperationActionNameSchema,
    recipeId: leafOperationRecipeIdSchema,
    catalogVersion: catalogVersionSchema,
    operationIds: guidedLeafOperationIdsSchema,
    completedOperationIds: z
      .array(operationIdSchema)
      .min(1)
      .max(lightTrailsLeafOperationIds.length),
    nextOrdinal: z
      .number()
      .int()
      .min(2)
      .max(lightTrailsLeafOperationIds.length + 1),
    latestObservation: companionLeafOperationObservationSchema,
    leafCompleted: z.boolean(),
    finalReport: expectedStateSchema.nullable(),
  })
  .superRefine((progress, context) => {
    const profile = leafOperationProfile(progress.actionName);
    const completedCount = progress.completedOperationIds.length;
    const exactPrefix = progress.completedOperationIds.every(
      (operationId, index) => operationId === progress.operationIds[index],
    );
    const observation = progress.latestObservation.details;
    const total = profile?.operationIds.length ?? 0;
    const profileMatches =
      profile !== undefined &&
      progress.recipeId === profile.recipeId &&
      exactOperationIds(progress.operationIds, profile.operationIds);
    const final = profileMatches && completedCount === total;
    const expectedMutating =
      profile?.mutatingOrdinals.some((ordinal) => ordinal === completedCount) ?? false;
    const completionEvidence =
      profile === undefined ? undefined : observation.evidence[profile.completionEvidenceKey];
    const rnaControlWrites = observation.evidence.rnaControlWrites;
    const rnaInitializationWrites = observation.evidence.rnaInitializationWrites;
    const rnaLinkCreations = observation.evidence.rnaLinkCreations;
    const rnaStructureCreations = observation.evidence.rnaStructureCreations;
    const rnaResourceMutations = observation.evidence.rnaResourceMutations;
    const rnaKeyframeInsertions = observation.evidence.rnaKeyframeInsertions;
    const rnaAnimationPropertyWrites = observation.evidence.rnaAnimationPropertyWrites;
    const rnaActionResourceMutations = observation.evidence.rnaActionResourceMutations;
    const rnaArmatureResourceMutations = observation.evidence.rnaArmatureResourceMutations;
    const rnaArmatureBoneMutations = observation.evidence.rnaArmatureBoneMutations;
    const rnaArmatureBindingMutations = observation.evidence.rnaArmatureBindingMutations;
    const rnaSkinWeightMutations = observation.evidence.rnaSkinWeightMutations;
    const rnaSkinModifierMutations = observation.evidence.rnaSkinModifierMutations;
    const rnaSolidifyModifierMutations = observation.evidence.rnaSolidifyModifierMutations;
    const rnaBevelModifierMutations = observation.evidence.rnaBevelModifierMutations;
    const rnaMaterialMutations = observation.evidence.rnaMaterialMutations;
    const rnaMaterialPaletteMutations = observation.evidence.rnaMaterialPaletteMutations;
    const rnaMirrorModifierMutations = observation.evidence.rnaMirrorModifierMutations;
    const rnaSubdivisionSurfaceModifierMutations =
      observation.evidence.rnaSubdivisionSurfaceModifierMutations;
    const editBevelMeshOperations = observation.evidence.editBevelMeshOperations;
    const editInsetMeshOperations = observation.evidence.editInsetMeshOperations;
    const editTriangulateMeshOperations = observation.evidence.editTriangulateMeshOperations;
    const editExtrudeRegionMeshOperations = observation.evidence.editExtrudeRegionMeshOperations;
    const editPokeMeshOperations = observation.evidence.editPokeMeshOperations;
    if (
      !profileMatches ||
      completedCount > total ||
      !exactPrefix ||
      progress.nextOrdinal !== completedCount + 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedOperationIds'],
        message: 'Leaf operation progress must be the exact ordered operation prefix',
      });
    }
    if (progress.actionName === transformGeometryLeafOperationActionName) {
      const parsedWrites = companionLeafOperationRnaControlWritesSchema.safeParse(rnaControlWrites);
      if (
        rnaControlWrites !== undefined &&
        (!parsedWrites.success ||
          parsedWrites.data.length !== (completedCount >= 5 && completedCount <= 7 ? 3 : 0) ||
          parsedWrites.data.some(
            (write) => write.sourceOperationId !== progress.operationIds[completedCount - 1],
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaControlWrites'],
          message: 'Transform Geometry RNA writes must match the exact delivered operation',
        });
      }
      const parsedActionMutations =
        companionLeafOperationPoseRnaActionResourceMutationsSchema.safeParse(
          rnaActionResourceMutations,
        );
      const expectedActionMutationKind =
        completedCount === 4
          ? 'action_create'
          : completedCount === 5
            ? 'action_name_write'
            : undefined;
      if (
        rnaActionResourceMutations !== undefined &&
        (!parsedActionMutations.success ||
          (expectedActionMutationKind === undefined
            ? parsedActionMutations.data.length !== 0
            : parsedActionMutations.data[0]?.mutationKind !== expectedActionMutationKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaActionResourceMutations'],
          message: 'Pose Action resource mutations must match operations 04 and 05 only',
        });
      }
    }
    if (progress.actionName === lightTrailsLeafOperationActionName) {
      const parsedWrites = companionLeafOperationRnaControlWritesSchema.safeParse(rnaControlWrites);
      const expectedArgument = lightTrailsRnaControlArgumentByOrdinal[completedCount];
      const expectedWriteCount =
        expectedArgument === undefined ? 0 : [9, 10, 31].includes(completedCount) ? 2 : 1;
      if (
        rnaControlWrites !== undefined &&
        (!parsedWrites.success ||
          parsedWrites.data.length !== expectedWriteCount ||
          parsedWrites.data.some(
            (write) =>
              write.mcpTool !== 'operatingline.blender.geometry-nodes.light-trails.execute-next' ||
              write.sourceOperationId !== progress.operationIds[completedCount - 1] ||
              write.actionArgument !== expectedArgument,
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaControlWrites'],
          message: 'Light Trails RNA writes must match the exact delivered operation',
        });
      }
      const parsedInitializationWrites =
        companionLeafOperationRnaInitializationWritesSchema.safeParse(rnaInitializationWrites);
      const expectedInitializationTargets = lightTrailsRnaInitializationTargets(
        progress.operationIds[completedCount - 1]!,
      );
      if (
        rnaInitializationWrites !== undefined &&
        (!parsedInitializationWrites.success ||
          parsedInitializationWrites.data.length !== expectedInitializationTargets.length ||
          parsedInitializationWrites.data.some(
            (write) => write.sourceOperationId !== progress.operationIds[completedCount - 1],
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaInitializationWrites'],
          message:
            'Light Trails RNA initialization writes must match the exact delivered node operation',
        });
      }
      const parsedLinkCreations =
        companionLeafOperationRnaLinkCreationsSchema.safeParse(rnaLinkCreations);
      const expectedLinkTarget = lightTrailsRnaLinkTarget(
        progress.operationIds[completedCount - 1]!,
      );
      if (
        rnaLinkCreations !== undefined &&
        (!parsedLinkCreations.success ||
          parsedLinkCreations.data.length !== (expectedLinkTarget === undefined ? 0 : 1) ||
          parsedLinkCreations.data.some(
            (creation) => creation.sourceOperationId !== progress.operationIds[completedCount - 1],
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaLinkCreations'],
          message: 'Light Trails RNA link creation must match the exact delivered connection',
        });
      }
      const parsedStructureCreations =
        companionLeafOperationRnaStructureCreationsSchema.safeParse(rnaStructureCreations);
      const expectedStructureTargets = lightTrailsRnaStructureTargets(
        progress.operationIds[completedCount - 1]!,
      );
      if (
        rnaStructureCreations !== undefined &&
        (!parsedStructureCreations.success ||
          parsedStructureCreations.data.length !== expectedStructureTargets.length ||
          parsedStructureCreations.data.some(
            (creation) => creation.sourceOperationId !== progress.operationIds[completedCount - 1],
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaStructureCreations'],
          message:
            'Light Trails RNA structure creations must match the exact delivered node operation',
        });
      }
      const parsedResourceMutations =
        companionLeafOperationRnaResourceMutationsSchema.safeParse(rnaResourceMutations);
      if (
        rnaResourceMutations !== undefined &&
        (!parsedResourceMutations.success ||
          parsedResourceMutations.data.length !== (completedCount === 2 ? 3 : 0))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaResourceMutations'],
          message:
            'Light Trails RNA resource mutations must match the exact modifier creation operation',
        });
      }
    }
    if (progress.actionName === poseAnimationLeafOperationActionName) {
      const parsedInsertions =
        companionLeafOperationPoseRnaKeyframeInsertionsSchema.safeParse(rnaKeyframeInsertions);
      if (
        rnaKeyframeInsertions !== undefined &&
        (!parsedInsertions.success ||
          (completedCount === 7
            ? parsedInsertions.data.length === 0
            : parsedInsertions.data.length !== 0))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaKeyframeInsertions'],
          message: 'Pose RNA keyframe insertions must match operation 07 only',
        });
      }
      const parsedPropertyWrites =
        companionLeafOperationPoseRnaAnimationPropertyWritesSchema.safeParse(
          rnaAnimationPropertyWrites,
        );
      const expectedMutationKind =
        completedCount === 9
          ? 'keyframe_interpolation_write'
          : completedCount === 11
            ? 'fcurve_extrapolation_write'
            : undefined;
      if (
        rnaAnimationPropertyWrites !== undefined &&
        (!parsedPropertyWrites.success ||
          (expectedMutationKind === undefined
            ? parsedPropertyWrites.data.length !== 0
            : parsedPropertyWrites.data.length === 0 ||
              parsedPropertyWrites.data.some(
                (write) => write.mutationKind !== expectedMutationKind,
              )))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaAnimationPropertyWrites'],
          message: 'Pose animation property writes must match operations 09 and 11 only',
        });
      }
    }
    if (progress.actionName === armatureLeafOperationActionName) {
      const parsedResources = companionLeafOperationArmatureRnaResourceMutationsSchema.safeParse(
        rnaArmatureResourceMutations,
      );
      const expectedResourceKind =
        completedCount === 2
          ? 'armature_data_create'
          : completedCount === 3
            ? 'armature_object_name_write'
            : completedCount === 4
              ? 'armature_data_name_write'
              : undefined;
      if (
        rnaArmatureResourceMutations !== undefined &&
        (!parsedResources.success ||
          (expectedResourceKind === undefined
            ? parsedResources.data.length !== 0
            : parsedResources.data[0]?.mutationKind !== expectedResourceKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaArmatureResourceMutations'],
          message: 'Armature resource mutations must match operations 02, 03, and 04 only',
        });
      }
      const parsedBones =
        companionLeafOperationArmatureRnaBoneMutationsSchema.safeParse(rnaArmatureBoneMutations);
      if (
        rnaArmatureBoneMutations !== undefined &&
        (!parsedBones.success ||
          (completedCount === 6 ? parsedBones.data.length === 0 : parsedBones.data.length !== 0))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaArmatureBoneMutations'],
          message: 'Armature bone mutations must match operation 06 only',
        });
      }
      const parsedBindings = companionLeafOperationArmatureRnaBindingMutationsSchema.safeParse(
        rnaArmatureBindingMutations,
      );
      if (
        rnaArmatureBindingMutations !== undefined &&
        (!parsedBindings.success ||
          (completedCount === 8
            ? parsedBindings.data.length === 0
            : parsedBindings.data.length !== 0))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaArmatureBindingMutations'],
          message: 'Armature rigid binding mutations must match operation 08 only',
        });
      }
    }
    if (progress.actionName === skinWeightsLeafOperationActionName) {
      const parsedWeights =
        companionLeafOperationSkinRnaWeightMutationsSchema.safeParse(rnaSkinWeightMutations);
      if (
        rnaSkinWeightMutations !== undefined &&
        (!parsedWeights.success ||
          (completedCount === 5
            ? parsedWeights.data.length === 0
            : parsedWeights.data.length !== 0))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaSkinWeightMutations'],
          message: 'Skin weight mutations must match operation 05 only',
        });
      }
      const parsedModifiers =
        companionLeafOperationSkinRnaModifierMutationsSchema.safeParse(rnaSkinModifierMutations);
      const expectedModifierKind =
        completedCount === 7
          ? 'armature_modifier_create'
          : completedCount === 8
            ? 'armature_modifier_name_write'
            : undefined;
      const expectedModifierCount = completedCount === 7 ? 5 : completedCount === 8 ? 1 : 0;
      if (
        rnaSkinModifierMutations !== undefined &&
        (!parsedModifiers.success ||
          parsedModifiers.data.length !== expectedModifierCount ||
          (expectedModifierKind !== undefined &&
            parsedModifiers.data[0]?.mutationKind !== expectedModifierKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaSkinModifierMutations'],
          message: 'Skin Modifier mutations must match operations 07 and 08 only',
        });
      }
    }
    if (progress.actionName === solidifyLeafOperationActionName) {
      const parsedMutations = companionLeafOperationSolidifyRnaMutationsSchema.safeParse(
        rnaSolidifyModifierMutations,
      );
      const expectedMutationKind =
        completedCount === 3
          ? 'solidify_modifier_create'
          : completedCount === 4
            ? 'solidify_modifier_name_write'
            : undefined;
      const expectedMutationCount = completedCount === 3 ? 1 : completedCount === 4 ? 26 : 0;
      if (
        rnaSolidifyModifierMutations !== undefined &&
        (!parsedMutations.success ||
          parsedMutations.data.length !== expectedMutationCount ||
          (expectedMutationKind !== undefined &&
            parsedMutations.data[0]?.mutationKind !== expectedMutationKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaSolidifyModifierMutations'],
          message: 'Solidify RNA mutations must match operations 03 and 04 only',
        });
      }
    }
    if (progress.actionName === bevelModifierLeafOperationActionName) {
      const parsedMutations =
        companionLeafOperationBevelModifierRnaMutationsSchema.safeParse(rnaBevelModifierMutations);
      const expectedMutationKind =
        completedCount === 3
          ? 'bevel_modifier_create'
          : completedCount === 4
            ? 'bevel_modifier_name_write'
            : undefined;
      const expectedMutationCount = completedCount === 3 ? 1 : completedCount === 4 ? 5 : 0;
      if (
        rnaBevelModifierMutations !== undefined &&
        (!parsedMutations.success ||
          parsedMutations.data.length !== expectedMutationCount ||
          (expectedMutationKind !== undefined &&
            parsedMutations.data[0]?.mutationKind !== expectedMutationKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaBevelModifierMutations'],
          message: 'Bevel Modifier RNA mutations must match operations 03 and 04 only',
        });
      }
    }
    if (progress.actionName === singleMaterialLeafOperationActionName) {
      const parsedMutations =
        companionLeafOperationMaterialRnaMutationsSchema.safeParse(rnaMaterialMutations);
      const expectedMutationKind =
        completedCount === 3
          ? 'material_create'
          : completedCount === 4
            ? 'material_name_write'
            : undefined;
      const expectedMutationCount =
        completedCount === 3
          ? 2
          : completedCount === 4 && parsedMutations.success
            ? parsedMutations.data.length
            : 0;
      if (
        !parsedMutations.success ||
        parsedMutations.data.length !== expectedMutationCount ||
        (completedCount === 4 &&
          (parsedMutations.data.length < 14 || parsedMutations.data.length > 77)) ||
        (expectedMutationKind !== undefined &&
          parsedMutations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaMaterialMutations'],
          message: 'Material RNA mutations must match operations 03 and 04 only',
        });
      }
    }
    if (progress.actionName === materialPaletteLeafOperationActionName) {
      const parsedMutations = companionLeafOperationMaterialPaletteRnaMutationsSchema.safeParse(
        rnaMaterialPaletteMutations,
      );
      const expectedMutationCount =
        completedCount === 4 && parsedMutations.success ? parsedMutations.data.length : 0;
      if (
        !parsedMutations.success ||
        parsedMutations.data.length !== expectedMutationCount ||
        (completedCount === 4 &&
          (parsedMutations.data.length < 15 || parsedMutations.data.length > 624))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaMaterialPaletteMutations'],
          message: 'Material Palette RNA mutations must exist only on atomic operation 04',
        });
      }
    }
    if (progress.actionName === mirrorLeafOperationActionName) {
      const parsedMutations = companionLeafOperationMirrorRnaMutationsSchema.safeParse(
        rnaMirrorModifierMutations,
      );
      const expectedMutationKind =
        completedCount === 6
          ? 'mirror_modifier_create'
          : completedCount === 7
            ? 'mirror_modifier_name_write'
            : undefined;
      const expectedMutationCount = completedCount === 6 ? 1 : completedCount === 7 ? 28 : 0;
      if (
        rnaMirrorModifierMutations !== undefined &&
        (!parsedMutations.success ||
          parsedMutations.data.length !== expectedMutationCount ||
          (expectedMutationKind !== undefined &&
            parsedMutations.data[0]?.mutationKind !== expectedMutationKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'rnaMirrorModifierMutations'],
          message: 'Mirror RNA mutations must match operations 06 and 07 only',
        });
      }
    }
    if (progress.actionName === subdivisionSurfaceLeafOperationActionName) {
      const parsedMutations = companionLeafOperationSubdivisionSurfaceRnaMutationsSchema.safeParse(
        rnaSubdivisionSurfaceModifierMutations,
      );
      const expectedMutationKind =
        completedCount === 3
          ? 'subdivision_surface_modifier_create'
          : completedCount === 4
            ? 'subdivision_surface_modifier_name_write'
            : undefined;
      const expectedMutationCount = completedCount === 3 ? 1 : completedCount === 4 ? 15 : 0;
      if (
        rnaSubdivisionSurfaceModifierMutations !== undefined &&
        (!parsedMutations.success ||
          parsedMutations.data.length !== expectedMutationCount ||
          (expectedMutationKind !== undefined &&
            parsedMutations.data[0]?.mutationKind !== expectedMutationKind))
      ) {
        context.addIssue({
          code: 'custom',
          path: [
            'latestObservation',
            'details',
            'evidence',
            'rnaSubdivisionSurfaceModifierMutations',
          ],
          message: 'Subdivision Surface RNA mutations must match operations 03 and 04 only',
        });
      }
    }
    if (progress.actionName === editBevelLeafOperationActionName) {
      const parsedOperations =
        companionLeafOperationEditBevelMeshOperationsSchema.safeParse(editBevelMeshOperations);
      const expectedMutationKind =
        completedCount === 5
          ? 'edit_bevel_mesh_create'
          : completedCount === 6
            ? 'edit_bevel_mesh_name_write'
            : undefined;
      const expectedOperationCount = completedCount === 5 ? 5 : completedCount === 6 ? 2 : 0;
      if (
        !parsedOperations.success ||
        parsedOperations.data.length !== expectedOperationCount ||
        (expectedMutationKind !== undefined &&
          parsedOperations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'editBevelMeshOperations'],
          message: 'Edit Bevel evidence must match operations 05 and 06 only',
        });
      }
    }
    if (progress.actionName === editInsetLeafOperationActionName) {
      const parsedOperations =
        companionLeafOperationEditInsetMeshOperationsSchema.safeParse(editInsetMeshOperations);
      const expectedMutationKind =
        completedCount === 5
          ? 'edit_inset_mesh_create'
          : completedCount === 6
            ? 'edit_inset_mesh_name_write'
            : undefined;
      const expectedOperationCount = completedCount === 5 ? 4 : completedCount === 6 ? 2 : 0;
      if (
        !parsedOperations.success ||
        parsedOperations.data.length !== expectedOperationCount ||
        (expectedMutationKind !== undefined &&
          parsedOperations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'editInsetMeshOperations'],
          message: 'Edit Inset evidence must match operations 05 and 06 only',
        });
      }
    }
    if (progress.actionName === editTriangulateLeafOperationActionName) {
      const parsedOperations = companionLeafOperationEditTriangulateMeshOperationsSchema.safeParse(
        editTriangulateMeshOperations,
      );
      const expectedMutationKind =
        completedCount === 5
          ? 'edit_triangulate_mesh_create'
          : completedCount === 6
            ? 'edit_triangulate_mesh_name_write'
            : undefined;
      const expectedOperationCount = completedCount === 5 || completedCount === 6 ? 2 : 0;
      if (
        !parsedOperations.success ||
        parsedOperations.data.length !== expectedOperationCount ||
        (expectedMutationKind !== undefined &&
          parsedOperations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'editTriangulateMeshOperations'],
          message: 'Edit Triangulate evidence must match operations 05 and 06 only',
        });
      }
    }
    if (progress.actionName === editExtrudeRegionLeafOperationActionName) {
      const parsedOperations =
        companionLeafOperationEditExtrudeRegionMeshOperationsSchema.safeParse(
          editExtrudeRegionMeshOperations,
        );
      const expectedMutationKind =
        completedCount === 4
          ? 'edit_extrude_region_selection_projection'
          : completedCount === 5
            ? 'edit_extrude_region_mesh_create'
            : completedCount === 6
              ? 'edit_extrude_region_mesh_name_write'
              : undefined;
      const expectedOperationCount =
        completedCount === 4 ? 1 : completedCount === 5 ? 3 : completedCount === 6 ? 2 : 0;
      if (
        !parsedOperations.success ||
        parsedOperations.data.length !== expectedOperationCount ||
        (expectedMutationKind !== undefined &&
          parsedOperations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'editExtrudeRegionMeshOperations'],
          message: 'Extrude Region evidence must match operations 04, 05, and 06 only',
        });
      }
    }
    if (progress.actionName === editPokeLeafOperationActionName) {
      const parsedOperations =
        companionLeafOperationEditPokeMeshOperationsSchema.safeParse(editPokeMeshOperations);
      const expectedMutationKind =
        completedCount === 5
          ? 'edit_poke_mesh_create'
          : completedCount === 6
            ? 'edit_poke_mesh_name_write'
            : undefined;
      const expectedOperationCount = completedCount === 5 ? 3 : completedCount === 6 ? 2 : 0;
      if (
        !parsedOperations.success ||
        parsedOperations.data.length !== expectedOperationCount ||
        (expectedMutationKind !== undefined &&
          parsedOperations.data[0]?.mutationKind !== expectedMutationKind)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestObservation', 'details', 'evidence', 'editPokeMeshOperations'],
          message: 'Edit Poke evidence must match operations 05 and 06 only',
        });
      }
    }
    if (
      observation.operationOrdinal !== completedCount ||
      observation.operationId !== progress.completedOperationIds[completedCount - 1] ||
      observation.runId !== progress.runId ||
      observation.stepId !== progress.stepId ||
      observation.actionName !== progress.actionName ||
      observation.recipeId !== progress.recipeId ||
      observation.catalogVersion !== progress.catalogVersion ||
      observation.mutating !== expectedMutating ||
      !Array.isArray(observation.evidence.completedOperations) ||
      observation.evidence.completedOperations.length !== completedCount ||
      observation.evidence.preconditionsValidated !== (completedCount === 1) ||
      completionEvidence !== final ||
      (observation.mutating
        ? observation.beforeFingerprintSha256 === observation.afterFingerprintSha256
        : observation.beforeFingerprintSha256 !== observation.afterFingerprintSha256)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latestObservation'],
        message: 'The latest observation must prove the exact completed operation prefix',
      });
    }
    if (
      progress.leafCompleted !== final ||
      (final ? progress.finalReport === null : progress.finalReport !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leafCompleted'],
        message: 'Only the profile final operation may complete the leaf and bind a report',
      });
    }
  });
export type CompanionLeafOperationProgress = z.infer<typeof companionLeafOperationProgressSchema>;

const resultStatusSchema = z.enum(['succeeded', 'failed', 'rejected', 'recovery_required']);
const nativeUndoRecoveryGuardSchema = z.strictObject({
  expectedRestoredCheckpointId: z.uuid().nullable(),
  recoveryTokenSha256: sha256Schema,
});
const companionLeafOperationRecoveryReasonSchema = z
  .strictObject({
    kind: z.enum([
      'operation_outcome_indeterminate',
      'native_undo_outcome_indeterminate',
      'observation_outcome_indeterminate',
    ]),
    nativeUndoGuard: nativeUndoRecoveryGuardSchema.optional(),
    requiresExplicitRecovery: z.literal(true),
    automaticReplay: z.literal(false),
  })
  .superRefine((reason, context) => {
    if (
      (reason.kind === 'native_undo_outcome_indeterminate') !==
      (reason.nativeUndoGuard !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nativeUndoGuard'],
        message: 'Only native Undo recovery requires its exact guard and token',
      });
    }
  });
export const companionLeafOperationResultSchema = z
  .strictObject({
    ...deliveryIdentityShape,
    status: resultStatusSchema,
    progress: companionLeafOperationProgressSchema.nullable(),
    error: z.string().min(1).nullable(),
    recoveryReason: companionLeafOperationRecoveryReasonSchema.optional(),
    occurredAt: timestampSchema,
  })
  .superRefine((result, context) => {
    if (!operationAuthorityIsValid(result)) {
      context.addIssue({
        code: 'custom',
        message: 'The leaf operation result does not match its immutable operation binding',
      });
    }
    if (Date.parse(result.dispatchedAt) > Date.parse(result.occurredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message: 'The leaf operation result cannot precede dispatch',
      });
    }
    if (result.status === 'succeeded') {
      if (result.progress === null || result.error !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A succeeded leaf operation requires progress and no error',
        });
        return;
      }
      const progress = result.progress;
      if (
        progress.stepId !== result.stepId ||
        progress.actionName !== result.actionName ||
        progress.recipeId !== result.recipeId ||
        progress.catalogVersion !== result.catalogVersion ||
        progress.completedOperationIds.length !== result.operationOrdinal ||
        progress.completedOperationIds[result.operationOrdinal - 1] !== result.sourceOperationId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['progress'],
          message: 'Succeeded progress must prove the delivered operation identity',
        });
      }
      const rnaControlWrites = progress.latestObservation.details.evidence.rnaControlWrites;
      if (
        result.actionName === transformGeometryLeafOperationActionName &&
        rnaControlWrites !== undefined
      ) {
        const parsedWrites =
          companionLeafOperationRnaControlWritesSchema.safeParse(rnaControlWrites);
        const expectedArgument =
          result.operationOrdinal === 5
            ? 'translation'
            : result.operationOrdinal === 6
              ? 'rotation'
              : result.operationOrdinal === 7
                ? 'scale'
                : undefined;
        const expectedValues =
          expectedArgument === undefined ? undefined : result.operationParameters[expectedArgument];
        if (
          !parsedWrites.success ||
          (expectedArgument === undefined
            ? parsedWrites.data.length !== 0
            : !Array.isArray(expectedValues) ||
              expectedValues.length !== 3 ||
              parsedWrites.data.length !== 3 ||
              parsedWrites.data.some(
                (write, index) =>
                  write.actionArgument !== expectedArgument ||
                  write.acceptedValue !== expectedValues[index] ||
                  !Number.isFinite(write.observedValue) ||
                  Math.abs(write.observedValue - Number(expectedValues[index])) >
                    Math.max(1e-7, Math.abs(Number(expectedValues[index])) * 1e-6),
              ))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['progress', 'latestObservation', 'details', 'evidence', 'rnaControlWrites'],
            message: 'Succeeded RNA write evidence must match the accepted operation parameters',
          });
        }
      }
      if (
        result.actionName === lightTrailsLeafOperationActionName &&
        rnaControlWrites !== undefined
      ) {
        const parsedWrites =
          companionLeafOperationRnaControlWritesSchema.safeParse(rnaControlWrites);
        const expectedArgument = lightTrailsRnaControlArgumentByOrdinal[result.operationOrdinal];
        const expectedValue =
          expectedArgument === undefined ? undefined : result.operationParameters[expectedArgument];
        if (
          !parsedWrites.success ||
          (expectedArgument === undefined
            ? parsedWrites.data.length !== 0
            : typeof expectedValue !== 'number' ||
              !Number.isFinite(expectedValue) ||
              parsedWrites.data.some(
                (write) =>
                  write.mcpTool !==
                    'operatingline.blender.geometry-nodes.light-trails.execute-next' ||
                  write.actionArgument !== expectedArgument ||
                  write.acceptedValue !== expectedValue ||
                  !('projectedValue' in write) ||
                  Math.abs(write.observedValue - write.projectedValue) >
                    Math.max(1e-7, Math.abs(write.projectedValue) * 1e-6),
              ))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['progress', 'latestObservation', 'details', 'evidence', 'rnaControlWrites'],
            message:
              'Succeeded Light Trails RNA evidence must match the accepted operation parameters',
          });
        }
      }
      const total = leafOperationProfile(result.actionName)?.operationIds.length;
      if (
        result.operationOrdinal === total &&
        (progress.finalReport?.sequence !== result.expectedState.sequence + 1 ||
          progress.finalReport.reportId === result.expectedState.reportId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['progress', 'finalReport'],
          message: 'Final operation progress requires the next Companion state report',
        });
      }
    } else if (result.status === 'recovery_required') {
      if (
        result.progress !== null ||
        result.error === null ||
        result.recoveryReason === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recoveryReason'],
          message:
            'Recovery-required signals require a strict reason, no progress, and a non-empty error',
        });
      }
    } else if (
      result.progress !== null ||
      result.error === null ||
      result.recoveryReason !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A failed or rejected leaf operation requires no progress and a non-empty error',
      });
    }
    if (result.status !== 'recovery_required' && result.recoveryReason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryReason'],
        message: 'Only a recovery-required signal may carry a recovery reason',
      });
    }
  });
export type CompanionLeafOperationResult = z.infer<typeof companionLeafOperationResultSchema>;

const statusValueSchema = z.enum([
  'queued',
  'dispatched',
  'pre_dispatch_authority_expired',
  'succeeded',
  'failed',
  'rejected',
  'recovery_required',
]);

const preDispatchAuthorityExpirationEvidenceSchema = z.strictObject({
  source: z.literal('document_authority_drift'),
  requestId: z.uuid(),
  operationBindingSha256: sha256Schema,
  target: targetSchema,
  priorStatus: z.literal('queued'),
  detectedAt: timestampSchema,
  resolution: z.literal('pre_dispatch_authority_expired'),
  retainsTargetLock: z.literal(false),
  automaticReplay: z.literal(false),
});

const companionLeafOperationRecoveryEvidenceSchema = z.strictObject({
  source: z.enum([
    'companion_reported',
    'coordinator_restart',
    'document_authority_drift',
    'session_authority_drift',
  ]),
  reason: z.enum([
    'operation_outcome_indeterminate',
    'native_undo_outcome_indeterminate',
    'observation_outcome_indeterminate',
    'runtime_restart_after_delivery',
    'document_authority_changed_after_delivery',
    'companion_session_changed_after_delivery',
  ]),
  priorStatus: z.literal('dispatched'),
  detectedAt: timestampSchema,
  requiresExplicitRecovery: z.literal(true),
  automaticReplay: z.literal(false),
  retainsTargetLock: z.literal(true),
});

export const companionLeafOperationStatusSchema = z
  .strictObject({
    ...operationAuthorityShape,
    operationBindingSha256: sha256Schema,
    deliveryId: z.uuid().optional(),
    requestedAt: timestampSchema,
    dispatchedAt: timestampSchema.optional(),
    status: statusValueSchema,
    result: companionLeafOperationResultSchema.optional(),
    preDispatchAuthorityExpirationEvidence: preDispatchAuthorityExpirationEvidenceSchema.optional(),
    recoveryEvidence: companionLeafOperationRecoveryEvidenceSchema.optional(),
    updatedAt: timestampSchema,
  })
  .superRefine((execution, context) => {
    if (!operationAuthorityIsValid(execution)) {
      context.addIssue({
        code: 'custom',
        message: 'The leaf operation status does not match its immutable operation binding',
      });
    }
    const delivered = execution.deliveryId !== undefined && execution.dispatchedAt !== undefined;
    const hasDeliveryEvidence =
      execution.deliveryId !== undefined || execution.dispatchedAt !== undefined;
    const terminal = ['succeeded', 'failed', 'rejected'].includes(execution.status);
    const expirationEvidence = execution.preDispatchAuthorityExpirationEvidence;
    if (
      execution.status === 'queued' &&
      (hasDeliveryEvidence || execution.result !== undefined || expirationEvidence !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A queued operation cannot be delivered or final',
      });
    } else if (execution.status === 'pre_dispatch_authority_expired') {
      const evidenceMatches =
        expirationEvidence !== undefined &&
        expirationEvidence.requestId === execution.requestId &&
        expirationEvidence.operationBindingSha256 === execution.operationBindingSha256 &&
        computeProtocolCanonicalJsonSha256(expirationEvidence.target) ===
          computeProtocolCanonicalJsonSha256(execution.target) &&
        Date.parse(execution.requestedAt) <= Date.parse(expirationEvidence.detectedAt) &&
        execution.updatedAt === expirationEvidence.detectedAt;
      if (hasDeliveryEvidence || execution.result !== undefined || !evidenceMatches) {
        context.addIssue({
          code: 'custom',
          path: ['preDispatchAuthorityExpirationEvidence'],
          message:
            'Pre-dispatch authority expiration requires matching evidence and no delivery or result',
        });
      }
    } else if (
      execution.status === 'dispatched' &&
      (!delivered || execution.result !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${execution.status} requires delivery evidence and no terminal result`,
      });
    } else if (execution.status === 'recovery_required') {
      const evidence = execution.recoveryEvidence;
      const recoveryResult = execution.result;
      const valid =
        delivered &&
        evidence !== undefined &&
        Date.parse(execution.dispatchedAt!) <= Date.parse(evidence.detectedAt) &&
        execution.updatedAt === evidence.detectedAt &&
        ((evidence.source === 'coordinator_restart' &&
          evidence.reason === 'runtime_restart_after_delivery' &&
          recoveryResult === undefined) ||
          (evidence.source === 'document_authority_drift' &&
            evidence.reason === 'document_authority_changed_after_delivery' &&
            recoveryResult === undefined) ||
          (evidence.source === 'session_authority_drift' &&
            evidence.reason === 'companion_session_changed_after_delivery' &&
            recoveryResult === undefined) ||
          (evidence.source === 'companion_reported' &&
            recoveryResult?.status === 'recovery_required' &&
            recoveryResult.recoveryReason?.kind === evidence.reason &&
            recoveryResult.occurredAt === evidence.detectedAt));
      if (!valid) {
        context.addIssue({
          code: 'custom',
          path: ['recoveryEvidence'],
          message: 'Recovery-required status needs exact structured indeterminate evidence',
        });
      }
    } else if (
      terminal &&
      (!delivered || execution.result === undefined || execution.result.status !== execution.status)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'A terminal operation requires matching delivery evidence and result',
      });
    }
    if (execution.status !== 'pre_dispatch_authority_expired' && expirationEvidence !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['preDispatchAuthorityExpirationEvidence'],
        message: 'Only pre-dispatch authority expiration may carry expiration evidence',
      });
    }
    if (execution.status !== 'recovery_required' && execution.recoveryEvidence !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryEvidence'],
        message: 'Only recovery-required status may carry recovery evidence',
      });
    }
    if ((terminal || execution.status === 'recovery_required') && execution.result !== undefined) {
      const result = execution.result;
      const identityMatches = Object.keys(deliveryIdentityShape).every(
        (key) =>
          computeProtocolCanonicalJsonSha256(result[key as keyof typeof result]) ===
          computeProtocolCanonicalJsonSha256(execution[key as keyof typeof execution]),
      );
      if (!identityMatches) {
        context.addIssue({
          code: 'custom',
          path: ['result'],
          message: 'The terminal result must mirror the immutable delivery identity',
        });
      }
    }
  });
export type CompanionLeafOperationStatus = z.infer<typeof companionLeafOperationStatusSchema>;

const recoveryCheckpointProofSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
  checkpointId: z.uuid(),
  previousCheckpointId: z.uuid().nullable(),
  operation: z.enum([
    'start',
    'next',
    'recheck',
    'back',
    'leaf_operation',
    'leaf_operation_failure',
  ]),
  sceneFingerprintSha256: sha256Schema.nullable(),
  markerMatched: z.literal(true),
  sessionSnapshotMatches: z.literal(true),
  stageVerified: z.literal(true),
  observedAt: timestampSchema,
});

export const companionLeafOperationRecoveryAuthorityProofSchema = z.strictObject({
  reportId: z.uuid(),
  sequence: z.number().int().positive(),
  authorizedStartCheckpointId: z.uuid(),
});
export type CompanionLeafOperationRecoveryAuthorityProof = z.infer<
  typeof companionLeafOperationRecoveryAuthorityProofSchema
>;

const acceptedPrefixSchema = z
  .strictObject({
    completedOperationIds: z.array(operationIdSchema).max(lightTrailsLeafOperationIds.length - 1),
    runId: z.uuid().nullable(),
    bindingSha256: sha256Schema.nullable(),
    receiptId: z.uuid().nullable(),
    nextOrdinal: z.number().int().min(1).max(lightTrailsLeafOperationIds.length),
    latestFingerprintSha256: sha256Schema.nullable(),
  })
  .superRefine((prefix, context) => {
    const identity = [prefix.runId, prefix.bindingSha256, prefix.receiptId];
    const allNull = identity.every((value) => value === null);
    const allPresent = identity.every((value) => value !== null);
    if (
      prefix.nextOrdinal !== prefix.completedOperationIds.length + 1 ||
      (prefix.completedOperationIds.length === 0
        ? !allNull || prefix.latestFingerprintSha256 !== null
        : !allPresent || prefix.latestFingerprintSha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Recovery accepted prefix must be an exact, consistently identified prefix',
      });
    }
  });

export const companionLeafOperationRecoveryChallengeSchema = z
  .strictObject({
    formatVersion: companionLeafOperationFormatVersionSchema,
    recoveryId: z.uuid(),
    originalDelivery: companionLeafOperationDeliverySchema,
    originalSessionFingerprintSha256: sha256Schema,
    replacementSessionFingerprintSha256: sha256Schema,
    expectedState: expectedStateSchema,
    acceptedPrefix: acceptedPrefixSchema,
    authorityProof: companionLeafOperationRecoveryAuthorityProofSchema,
    nativeUndoGuard: nativeUndoRecoveryGuardSchema.nullable(),
    mode: z.literal('read_only_reconcile'),
    automaticReplay: z.literal(false),
    requestedAt: timestampSchema,
  })
  .superRefine((challenge, context) => {
    const delivery = challenge.originalDelivery;
    const valid =
      challenge.originalSessionFingerprintSha256 !==
        challenge.replacementSessionFingerprintSha256 &&
      computeProtocolCanonicalJsonSha256(challenge.expectedState) ===
        computeProtocolCanonicalJsonSha256(delivery.expectedState) &&
      challenge.acceptedPrefix.completedOperationIds.length === delivery.operationOrdinal - 1 &&
      exactOperationIds(
        challenge.acceptedPrefix.completedOperationIds,
        delivery.operationIds.slice(0, delivery.operationOrdinal - 1),
      ) &&
      challenge.authorityProof.reportId === delivery.expectedState.reportId &&
      challenge.authorityProof.sequence === delivery.expectedState.sequence &&
      Date.parse(delivery.dispatchedAt) <= Date.parse(challenge.requestedAt) &&
      new Set([challenge.recoveryId, delivery.requestId, delivery.deliveryId]).size === 3;
    if (!valid) {
      context.addIssue({
        code: 'custom',
        message: 'Leaf operation recovery challenge authority is inconsistent',
      });
    }
  });
export type CompanionLeafOperationRecoveryChallenge = z.infer<
  typeof companionLeafOperationRecoveryChallengeSchema
>;

const recoveryAckEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prefix_restored'),
    expectedState: expectedStateSchema,
    leafRun: acceptedPrefixSchema,
    currentCheckpoint: recoveryCheckpointProofSchema,
    restoration: z.enum(['native_undo_restored', 'prefix_observed_without_native_undo']),
    nativeUndoWitness: z
      .strictObject({
        sourceCheckpointId: z.uuid(),
        restoredCheckpointId: z.uuid().nullable(),
        recoveryTokenSha256: sha256Schema,
        restoredAt: timestampSchema,
        probeSatisfied: z.literal(true),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('unresolved_current_state'),
    reason: z.enum([
      'operation_outcome_indeterminate',
      'native_undo_outcome_indeterminate',
      'observation_outcome_indeterminate',
    ]),
    leafRun: acceptedPrefixSchema.nullable(),
    currentCheckpoint: recoveryCheckpointProofSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('operation_applied'),
    terminalResult: companionLeafOperationResultSchema,
    currentCheckpoint: recoveryCheckpointProofSchema,
  }),
  z.strictObject({
    kind: z.literal('document_incarnation_retired'),
    reason: z.enum(['runtime_recovery_evidence_lost', 'native_undo_witness_lost_after_reload']),
    mutationOutcome: z.literal('indeterminate'),
    requiresFreshDocumentIncarnation: z.literal(true),
  }),
]);

export const companionLeafOperationRecoveryAckSchema = z
  .strictObject({
    formatVersion: companionLeafOperationFormatVersionSchema,
    challenge: companionLeafOperationRecoveryChallengeSchema,
    recoveryId: z.uuid(),
    requestId: z.uuid(),
    originalDeliveryId: z.uuid(),
    replacementSessionFingerprintSha256: sha256Schema,
    outcome: z.enum([
      'prefix_restored',
      'unresolved_current_state',
      'operation_applied',
      'document_incarnation_retired',
    ]),
    evidence: recoveryAckEvidenceSchema,
    retainsTargetLock: z.boolean(),
    automaticReplay: z.literal(false),
    occurredAt: timestampSchema,
  })
  .superRefine((ack, context) => {
    const challenge = ack.challenge;
    const checkpoint =
      'currentCheckpoint' in ack.evidence ? ack.evidence.currentCheckpoint : undefined;
    const acknowledgedLeafRun =
      ack.evidence.kind === 'prefix_restored' || ack.evidence.kind === 'unresolved_current_state'
        ? ack.evidence.leafRun
        : undefined;
    const mirrors =
      ack.recoveryId === challenge.recoveryId &&
      ack.requestId === challenge.originalDelivery.requestId &&
      ack.originalDeliveryId === challenge.originalDelivery.deliveryId &&
      ack.replacementSessionFingerprintSha256 === challenge.replacementSessionFingerprintSha256 &&
      ack.outcome === ack.evidence.kind &&
      (acknowledgedLeafRun === undefined ||
        acknowledgedLeafRun === null ||
        computeProtocolCanonicalJsonSha256(acknowledgedLeafRun) ===
          computeProtocolCanonicalJsonSha256(challenge.acceptedPrefix)) &&
      (checkpoint === undefined ||
        checkpoint === null ||
        (Date.parse(challenge.requestedAt) <= Date.parse(checkpoint.observedAt) &&
          Date.parse(checkpoint.observedAt) <= Date.parse(ack.occurredAt)));
    const witness =
      ack.evidence.kind === 'prefix_restored' ? ack.evidence.nativeUndoWitness : undefined;
    const prefixCheckpoint =
      ack.evidence.kind === 'prefix_restored' ? ack.evidence.currentCheckpoint : undefined;
    const nativeUndoMatches =
      ack.evidence.kind === 'prefix_restored' &&
      ((ack.evidence.restoration === 'native_undo_restored' &&
        challenge.nativeUndoGuard !== null &&
        witness !== undefined &&
        (challenge.nativeUndoGuard.expectedRestoredCheckpointId === null ||
          witness.restoredCheckpointId ===
            challenge.nativeUndoGuard.expectedRestoredCheckpointId) &&
        witness.recoveryTokenSha256 === challenge.nativeUndoGuard.recoveryTokenSha256 &&
        prefixCheckpoint !== undefined &&
        prefixCheckpoint !== null &&
        witness.restoredCheckpointId === prefixCheckpoint.checkpointId &&
        Date.parse(witness.restoredAt) <= Date.parse(prefixCheckpoint.observedAt)) ||
        (ack.evidence.restoration === 'prefix_observed_without_native_undo' &&
          challenge.nativeUndoGuard === null &&
          witness === undefined));
    const prefixRestored =
      ack.evidence.kind === 'prefix_restored' &&
      !ack.retainsTargetLock &&
      ack.evidence.leafRun !== null &&
      prefixCheckpoint !== undefined &&
      prefixCheckpoint !== null &&
      nativeUndoMatches &&
      computeProtocolCanonicalJsonSha256(ack.evidence.expectedState) ===
        computeProtocolCanonicalJsonSha256(challenge.expectedState) &&
      prefixCheckpoint.reportId === challenge.expectedState.reportId &&
      prefixCheckpoint.sequence === challenge.expectedState.sequence &&
      (challenge.acceptedPrefix.completedOperationIds.length !== 0 ||
        prefixCheckpoint.checkpointId === challenge.authorityProof.authorizedStartCheckpointId) &&
      (challenge.acceptedPrefix.latestFingerprintSha256 === null
        ? prefixCheckpoint.sceneFingerprintSha256 === null
        : prefixCheckpoint.sceneFingerprintSha256 ===
          challenge.acceptedPrefix.latestFingerprintSha256);
    const unresolved = ack.evidence.kind === 'unresolved_current_state' && ack.retainsTargetLock;
    const appliedResult =
      ack.evidence.kind === 'operation_applied' ? ack.evidence.terminalResult : undefined;
    const appliedCheckpoint =
      ack.evidence.kind === 'operation_applied' ? ack.evidence.currentCheckpoint : undefined;
    const operationAppliedIdentityMatches =
      appliedResult !== undefined &&
      Object.keys(deliveryIdentityShape).every(
        (key) =>
          computeProtocolCanonicalJsonSha256(appliedResult[key as keyof typeof appliedResult]) ===
          computeProtocolCanonicalJsonSha256(
            challenge.originalDelivery[key as keyof typeof challenge.originalDelivery],
          ),
      );
    const operationApplied =
      ack.evidence.kind === 'operation_applied' &&
      !ack.retainsTargetLock &&
      challenge.nativeUndoGuard === null &&
      appliedResult?.status === 'succeeded' &&
      appliedResult.progress !== null &&
      operationAppliedIdentityMatches &&
      appliedCheckpoint !== undefined &&
      appliedCheckpoint.sceneFingerprintSha256 ===
        appliedResult.progress.latestObservation.details.afterFingerprintSha256 &&
      (appliedResult.progress.finalReport === null
        ? appliedCheckpoint.reportId === challenge.expectedState.reportId &&
          appliedCheckpoint.sequence === challenge.expectedState.sequence
        : appliedCheckpoint.reportId === appliedResult.progress.finalReport.reportId &&
          appliedCheckpoint.sequence === appliedResult.progress.finalReport.sequence);
    const documentIncarnationRetired =
      ack.evidence.kind === 'document_incarnation_retired' &&
      !ack.retainsTargetLock &&
      ((ack.evidence.reason === 'runtime_recovery_evidence_lost' &&
        challenge.nativeUndoGuard === null) ||
        (ack.evidence.reason === 'native_undo_witness_lost_after_reload' &&
          challenge.nativeUndoGuard !== null));
    if (
      !mirrors ||
      (!prefixRestored && !unresolved && !operationApplied && !documentIncarnationRetired)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Leaf operation recovery acknowledgement does not match its active challenge',
      });
    }
  });
export type CompanionLeafOperationRecoveryAck = z.infer<
  typeof companionLeafOperationRecoveryAckSchema
>;

export const companionLeafOperationRecoveryPollRequestSchema = targetSchema;
export type CompanionLeafOperationRecoveryPollRequest = z.infer<
  typeof companionLeafOperationRecoveryPollRequestSchema
>;
export const companionLeafOperationRecoveryPollDeliverySchema = z.strictObject({
  request: companionLeafOperationRecoveryChallengeSchema.nullable(),
});
export type CompanionLeafOperationRecoveryPollDelivery = z.infer<
  typeof companionLeafOperationRecoveryPollDeliverySchema
>;
export const companionLeafOperationRecoveryAckResponseSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
export type CompanionLeafOperationRecoveryAckResponse = z.infer<
  typeof companionLeafOperationRecoveryAckResponseSchema
>;

export const companionLeafOperationPollRequestSchema = z.strictObject({
  adapterId: z.literal('blender'),
  instanceId: z.uuid(),
});
export type CompanionLeafOperationPollRequest = z.infer<
  typeof companionLeafOperationPollRequestSchema
>;

export const companionLeafOperationPollDeliverySchema = z.strictObject({
  request: companionLeafOperationDeliverySchema.nullable(),
});
export type CompanionLeafOperationPollDelivery = z.infer<
  typeof companionLeafOperationPollDeliverySchema
>;

export const companionLeafOperationResultAckSchema = z.strictObject({
  result: z.enum(['accepted', 'duplicate']),
});
export type CompanionLeafOperationResultAck = z.infer<typeof companionLeafOperationResultAckSchema>;
