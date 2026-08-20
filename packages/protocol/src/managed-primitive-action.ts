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
