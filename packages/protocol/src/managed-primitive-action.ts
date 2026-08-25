import { z } from 'zod';

export const managedPrimitiveActionNames = Object.freeze([
  'blender.mesh.create_uv_sphere',
  'blender.mesh.create_icosphere',
  'blender.mesh.create_cube',
  'blender.mesh.create_plane',
  'blender.mesh.create_torus',
  'blender.mesh.create_cone',
  'blender.mesh.create_cylinder',
] as const);

export const managedPrimitiveActionNameSchema = z.enum(managedPrimitiveActionNames);
export type ManagedPrimitiveActionName = z.infer<typeof managedPrimitiveActionNameSchema>;

export const actionLevelMcpActionNames = Object.freeze([
  ...managedPrimitiveActionNames,
  'blender.mesh.edit_subdivide',
  'blender.mesh.edit_triangulate',
  'blender.mesh.edit_extrude_region',
  'blender.mesh.edit_bevel_edges',
  'blender.mesh.edit_inset_faces',
  'blender.mesh.edit_poke_faces',
  'blender.modifier.add_subdivision_surface',
  'blender.modifier.add_mirror',
  'blender.modifier.add_solidify',
  'blender.geometry_nodes.create_light_trails',
  'blender.lookdev.create_light_trails_scene',
  'blender.rig.create_armature',
  'blender.rig.bind_skin_weights',
  'blender.animation.create_pose_keyframes',
] as const);

export const actionLevelMcpActionNameSchema = z.enum(actionLevelMcpActionNames);
export type ActionLevelMcpActionName = z.infer<typeof actionLevelMcpActionNameSchema>;

export const operationLevelMcpActionNames = Object.freeze([
  'blender.geometry_nodes.create_transform',
  'blender.geometry_nodes.create_light_trails',
  'blender.animation.create_pose_keyframes',
  'blender.rig.create_armature',
  'blender.rig.bind_skin_weights',
  'blender.modifier.add_bevel',
  'blender.material.create_and_assign',
  'blender.material.create_palette_and_assign',
  'blender.modifier.add_solidify',
  'blender.modifier.add_mirror',
  'blender.modifier.add_subdivision_surface',
  'blender.mesh.edit_triangulate',
  'blender.mesh.edit_extrude_region',
  'blender.mesh.edit_bevel_edges',
  'blender.mesh.edit_inset_faces',
  'blender.mesh.edit_poke_faces',
] as const);
export const operationLevelMcpActionNameSchema = z.enum(operationLevelMcpActionNames);
export type OperationLevelMcpActionName = z.infer<typeof operationLevelMcpActionNameSchema>;

export const operationLevelMcpRecipeIdByAction = Object.freeze({
  'blender.geometry_nodes.create_transform': 'blender.geometry_nodes.create_transform.semantic',
  'blender.geometry_nodes.create_light_trails':
    'blender.geometry_nodes.create_light_trails.semantic',
  'blender.animation.create_pose_keyframes': 'blender.animation.create_pose_keyframes.semantic',
  'blender.rig.create_armature': 'blender.rig.create_armature.semantic',
  'blender.rig.bind_skin_weights': 'blender.rig.bind_skin_weights.semantic',
  'blender.modifier.add_bevel': 'blender.modifier.add_bevel.semantic',
  'blender.material.create_and_assign': 'blender.material.create_and_assign.semantic',
  'blender.material.create_palette_and_assign':
    'blender.material.create_palette_and_assign.semantic',
  'blender.modifier.add_solidify': 'blender.modifier.add_solidify.semantic',
  'blender.modifier.add_mirror': 'blender.modifier.add_mirror.semantic',
  'blender.modifier.add_subdivision_surface': 'blender.modifier.add_subdivision_surface.semantic',
  'blender.mesh.edit_triangulate': 'blender.mesh.edit_triangulate.semantic',
  'blender.mesh.edit_extrude_region': 'blender.mesh.edit_extrude_region.semantic',
  'blender.mesh.edit_bevel_edges': 'blender.mesh.edit_bevel_edges.semantic',
  'blender.mesh.edit_inset_faces': 'blender.mesh.edit_inset_faces.semantic',
  'blender.mesh.edit_poke_faces': 'blender.mesh.edit_poke_faces.semantic',
} as const satisfies Record<OperationLevelMcpActionName, string>);

export const procedureReplayActionNames = Object.freeze([
  ...actionLevelMcpActionNames,
  ...operationLevelMcpActionNames,
] as const);
export const procedureReplayActionNameSchema = z.enum(procedureReplayActionNames);
export type ProcedureReplayActionName = z.infer<typeof procedureReplayActionNameSchema>;

export const actionLevelMcpRecipeIdByAction = Object.freeze({
  'blender.mesh.create_uv_sphere': 'blender.mesh.create_uv_sphere.native',
  'blender.mesh.create_icosphere': 'blender.mesh.create_icosphere.native',
  'blender.mesh.create_cube': 'blender.mesh.create_cube.native',
  'blender.mesh.create_plane': 'blender.mesh.create_plane.native',
  'blender.mesh.create_torus': 'blender.mesh.create_torus.native',
  'blender.mesh.create_cone': 'blender.mesh.create_cone.native',
  'blender.mesh.create_cylinder': 'blender.mesh.create_cylinder.native',
  'blender.mesh.edit_subdivide': 'blender.mesh.edit_subdivide.semantic',
  'blender.mesh.edit_triangulate': 'blender.mesh.edit_triangulate.semantic',
  'blender.mesh.edit_extrude_region': 'blender.mesh.edit_extrude_region.semantic',
  'blender.mesh.edit_bevel_edges': 'blender.mesh.edit_bevel_edges.semantic',
  'blender.mesh.edit_inset_faces': 'blender.mesh.edit_inset_faces.semantic',
  'blender.mesh.edit_poke_faces': 'blender.mesh.edit_poke_faces.semantic',
  'blender.modifier.add_subdivision_surface': 'blender.modifier.add_subdivision_surface.semantic',
  'blender.modifier.add_mirror': 'blender.modifier.add_mirror.semantic',
  'blender.modifier.add_solidify': 'blender.modifier.add_solidify.semantic',
  'blender.geometry_nodes.create_light_trails':
    'blender.geometry_nodes.create_light_trails.semantic',
  'blender.lookdev.create_light_trails_scene': 'blender.lookdev.create_light_trails_scene.semantic',
  'blender.rig.create_armature': 'blender.rig.create_armature.semantic',
  'blender.rig.bind_skin_weights': 'blender.rig.bind_skin_weights.semantic',
  'blender.animation.create_pose_keyframes': 'blender.animation.create_pose_keyframes.semantic',
} as const satisfies Record<ActionLevelMcpActionName, string>);
