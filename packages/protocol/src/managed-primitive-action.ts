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
  'blender.modifier.add_mirror',
  'blender.modifier.add_solidify',
  'blender.rig.create_armature',
  'blender.rig.bind_skin_weights',
  'blender.animation.create_pose_keyframes',
] as const);

export const actionLevelMcpActionNameSchema = z.enum(actionLevelMcpActionNames);
export type ActionLevelMcpActionName = z.infer<typeof actionLevelMcpActionNameSchema>;

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
  'blender.modifier.add_mirror': 'blender.modifier.add_mirror.semantic',
  'blender.modifier.add_solidify': 'blender.modifier.add_solidify.semantic',
  'blender.rig.create_armature': 'blender.rig.create_armature.semantic',
  'blender.rig.bind_skin_weights': 'blender.rig.bind_skin_weights.semantic',
  'blender.animation.create_pose_keyframes': 'blender.animation.create_pose_keyframes.semantic',
} as const satisfies Record<ActionLevelMcpActionName, string>);
