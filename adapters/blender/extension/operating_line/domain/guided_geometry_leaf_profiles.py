"""Closed operation-level MCP profiles shared by Blender adapter layers."""

TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION = "blender.geometry_nodes.create_transform"
TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE = (
    "blender.geometry_nodes.create_transform.semantic"
)
TRANSFORM_GEOMETRY_LEAF_OPERATION_TOOL = (
    "operatingline.blender.geometry-nodes.transform.execute-next"
)
TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS = (
    "semantic.preflight_transform_geometry_resources",
    "semantic.new_geometry_modifier",
    "node.group_input",
    "node.transform_geometry",
    "projection.semantic.transform_geometry.translation",
    "projection.semantic.transform_geometry.rotation",
    "projection.semantic.transform_geometry.scale",
    "node.group_output",
    "semantic.connect_group_input_geometry_to_transform",
    "semantic.connect_transform_geometry_to_group_output",
    "semantic.verify_node_links",
)
TRANSFORM_GEOMETRY_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "modifierId", "modifierName", "nodeGroupId", "nodeGroupName"),
    (),
    (),
    (),
    ("translation",),
    ("rotation",),
    ("scale",),
    (),
    (),
    (),
    (),
)

LIGHT_TRAILS_LEAF_OPERATION_ACTION = "blender.geometry_nodes.create_light_trails"
LIGHT_TRAILS_LEAF_OPERATION_RECIPE = (
    "blender.geometry_nodes.create_light_trails.semantic"
)
LIGHT_TRAILS_LEAF_OPERATION_TOOL = (
    "operatingline.blender.geometry-nodes.light-trails.execute-next"
)
LIGHT_TRAILS_LEAF_OPERATION_IDS = (
    "workspace.geometry_nodes",
    "semantic.new_geometry_modifier",
    "node.light_trails.group_input",
    "node.light_trails.half_tile_line",
    "projection.semantic.light_trails.tile_length",
    "node.light_trails.trail_resolution",
    "projection.semantic.light_trails.points_per_trail",
    "node.light_trails.trail_rows",
    "projection.semantic.light_trails.trail_count",
    "projection.semantic.light_trails.trail_spacing",
    "node.light_trails.trail_instances",
    "node.light_trails.realize_trails",
    "node.light_trails.trail_position",
    "node.light_trails.terrain_noise",
    "projection.semantic.light_trails.noise_scale",
    "projection.semantic.light_trails.noise_detail",
    "projection.semantic.light_trails.noise_roughness",
    "projection.semantic.light_trails.noise_seed",
    "node.light_trails.center_noise",
    "node.light_trails.scale_height",
    "projection.semantic.light_trails.height",
    "node.light_trails.z_offset",
    "node.light_trails.displace_trails",
    "node.light_trails.mirror_half_tile",
    "node.light_trails.mirrored_tile",
    "node.light_trails.trail_profile",
    "projection.semantic.light_trails.profile_sides",
    "projection.semantic.light_trails.profile_radius",
    "node.light_trails.curve_to_mesh",
    "node.light_trails.loop_tiles",
    "projection.semantic.light_trails.tile_repeat_count",
    "node.light_trails.tile_instances",
    "node.light_trails.realize_tiles",
    "node.light_trails.group_output",
    "semantic.connect_light_trails.half_line_to_resolution",
    "semantic.connect_light_trails.rows_to_instances",
    "semantic.connect_light_trails.resolution_to_instances",
    "semantic.connect_light_trails.instances_to_realize",
    "semantic.connect_light_trails.position_to_noise",
    "semantic.connect_light_trails.noise_to_center",
    "semantic.connect_light_trails.center_to_height",
    "semantic.connect_light_trails.height_to_offset",
    "semantic.connect_light_trails.realize_to_displace",
    "semantic.connect_light_trails.offset_to_displace",
    "semantic.connect_light_trails.displace_to_mirror",
    "semantic.connect_light_trails.displace_to_join",
    "semantic.connect_light_trails.mirror_to_join",
    "semantic.connect_light_trails.join_to_curve_mesh",
    "semantic.connect_light_trails.profile_to_curve_mesh",
    "semantic.connect_light_trails.tiles_to_instances",
    "semantic.connect_light_trails.mesh_to_instances",
    "semantic.connect_light_trails.instances_to_final_realize",
    "semantic.connect_light_trails.realize_to_output",
    "semantic.verify_no_bake",
)
LIGHT_TRAILS_LEAF_OPERATION_PARAMETER_NAMES = tuple(
    {
        0: ("targetId", "modifierId", "modifierName", "nodeGroupId", "nodeGroupName"),
        4: ("tileLength",),
        6: ("pointsPerTrail",),
        8: ("trailCount",),
        9: ("trailSpacing",),
        14: ("noiseScale",),
        15: ("noiseDetail",),
        16: ("noiseRoughness",),
        17: ("noiseSeed",),
        20: ("height",),
        26: ("profileSides",),
        27: ("profileRadius",),
        30: ("tileRepeatCount",),
    }.get(index, ())
    for index in range(len(LIGHT_TRAILS_LEAF_OPERATION_IDS))
)

POSE_ANIMATION_LEAF_OPERATION_ACTION = "blender.animation.create_pose_keyframes"
POSE_ANIMATION_LEAF_OPERATION_RECIPE = (
    "blender.animation.create_pose_keyframes.semantic"
)
POSE_ANIMATION_LEAF_OPERATION_TOOL = (
    "operatingline.blender.animation.pose-keyframes.execute-next"
)
POSE_ANIMATION_LEAF_OPERATION_IDS = (
    "workspace.animation",
    "editor.action",
    "mode.pose",
    "semantic.create_pose_action",
    "projection.semantic.pose_animation.action_name",
    "operator.insert_keyframe",
    "projection.semantic.pose_animation.keyframes",
    "control.pose_interpolation",
    "projection.semantic.pose_animation.interpolation",
    "control.pose_extrapolation",
    "projection.semantic.pose_animation.extrapolation",
    "semantic.verify_pose_animation",
)
POSE_ANIMATION_LEAF_OPERATION_PARAMETER_NAMES = tuple(
    {
        0: ("actionId", "armatureId"),
        4: ("actionName",),
        6: ("keyframes",),
        8: ("interpolation",),
        10: ("extrapolation",),
    }.get(index, ())
    for index in range(len(POSE_ANIMATION_LEAF_OPERATION_IDS))
)

ARMATURE_LEAF_OPERATION_ACTION = "blender.rig.create_armature"
ARMATURE_LEAF_OPERATION_RECIPE = "blender.rig.create_armature.semantic"
ARMATURE_LEAF_OPERATION_TOOL = "operatingline.blender.rig.armature.execute-next"
ARMATURE_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "menu.add_armature",
    "projection.semantic.armature.object_name",
    "projection.semantic.armature.data_name",
    "mode.edit_bones",
    "projection.semantic.armature.bones",
    "semantic.rigid_parent",
    "projection.semantic.armature.bindings",
    "semantic.verify_armature",
)
ARMATURE_LEAF_OPERATION_PARAMETER_NAMES = tuple(
    {
        0: ("armatureId", "collectionId"),
        2: ("objectName",),
        3: ("dataName",),
        5: ("bones",),
        7: ("bindings",),
    }.get(index, ())
    for index in range(len(ARMATURE_LEAF_OPERATION_IDS))
)

SKIN_WEIGHTS_LEAF_OPERATION_ACTION = "blender.rig.bind_skin_weights"
SKIN_WEIGHTS_LEAF_OPERATION_RECIPE = "blender.rig.bind_skin_weights.semantic"
SKIN_WEIGHTS_LEAF_OPERATION_TOOL = (
    "operatingline.blender.rig.skin-weights.execute-next"
)
SKIN_WEIGHTS_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "panel.object_data",
    "mode.weight_paint",
    "semantic.normalized_weights",
    "projection.semantic.skin_weights.weights",
    "semantic.armature_modifier",
    "projection.semantic.skin_weights.preserve_volume",
    "projection.semantic.skin_weights.modifier_name",
    "semantic.verify_skin_weights",
)
SKIN_WEIGHTS_LEAF_OPERATION_PARAMETER_NAMES = tuple(
    {
        0: ("targetId", "armatureId", "modifierId"),
        4: ("weights",),
        6: ("preserveVolume",),
        7: ("modifierName",),
    }.get(index, ())
    for index in range(len(SKIN_WEIGHTS_LEAF_OPERATION_IDS))
)

SOLIDIFY_LEAF_OPERATION_ACTION = "blender.modifier.add_solidify"
SOLIDIFY_LEAF_OPERATION_RECIPE = "blender.modifier.add_solidify.semantic"
SOLIDIFY_LEAF_OPERATION_TOOL = (
    "operatingline.blender.modifier.solidify.execute-next"
)
SOLIDIFY_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "panel.modifier_properties",
    "control.add_modifier",
    "semantic.solidify_parameters",
)
SOLIDIFY_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "modifierId"),
    (),
    (),
    ("modifierName", "thickness", "offset"),
)

BEVEL_MODIFIER_LEAF_OPERATION_ACTION = "blender.modifier.add_bevel"
BEVEL_MODIFIER_LEAF_OPERATION_RECIPE = "blender.modifier.add_bevel.semantic"
BEVEL_MODIFIER_LEAF_OPERATION_TOOL = (
    "operatingline.blender.modifier.bevel.execute-next"
)
BEVEL_MODIFIER_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "panel.modifier_properties",
    "control.add_modifier",
    "semantic.bevel_parameters",
)
BEVEL_MODIFIER_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "modifierId"),
    (),
    (),
    ("modifierName", "width", "segments", "angleLimit"),
)

SINGLE_MATERIAL_LEAF_OPERATION_ACTION = "blender.material.create_and_assign"
SINGLE_MATERIAL_LEAF_OPERATION_RECIPE = (
    "blender.material.create_and_assign.semantic"
)
SINGLE_MATERIAL_LEAF_OPERATION_TOOL = (
    "operatingline.blender.material.single.execute-next"
)
SINGLE_MATERIAL_LEAF_OPERATION_IDS = (
    "workspace.shading",
    "panel.material_properties",
    "control.new_material",
    "semantic.principled_surface",
)
SINGLE_MATERIAL_LEAF_OPERATION_PARAMETER_NAMES = (
    ("materialId",),
    (),
    (),
    ("materialName", "baseColor", "roughness", "metallic", "targets"),
)

MATERIAL_PALETTE_LEAF_OPERATION_ACTION = (
    "blender.material.create_palette_and_assign"
)
MATERIAL_PALETTE_LEAF_OPERATION_RECIPE = (
    "blender.material.create_palette_and_assign.semantic"
)
MATERIAL_PALETTE_LEAF_OPERATION_TOOL = (
    "operatingline.blender.material.palette.execute-next"
)
MATERIAL_PALETTE_LEAF_OPERATION_IDS = (
    "workspace.shading",
    "panel.material_properties",
    "semantic.palette_entries",
    "semantic.assign_targets",
)
MATERIAL_PALETTE_LEAF_OPERATION_PARAMETER_NAMES = (
    (),
    (),
    ("materials",),
    (),
)

MIRROR_LEAF_OPERATION_ACTION = "blender.modifier.add_mirror"
MIRROR_LEAF_OPERATION_RECIPE = "blender.modifier.add_mirror.semantic"
MIRROR_LEAF_OPERATION_TOOL = "operatingline.blender.modifier.mirror.execute-next"
MIRROR_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "panel.modifier_properties",
    "control.add_modifier",
    "category.generate",
    "modifier.mirror",
    "semantic.mirror_contract",
)
MIRROR_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "modifierId"),
    (),
    (),
    (),
    (),
    (),
    ("modifierName", "axis"),
)

SUBDIVISION_SURFACE_LEAF_OPERATION_ACTION = (
    "blender.modifier.add_subdivision_surface"
)
SUBDIVISION_SURFACE_LEAF_OPERATION_RECIPE = (
    "blender.modifier.add_subdivision_surface.semantic"
)
SUBDIVISION_SURFACE_LEAF_OPERATION_TOOL = (
    "operatingline.blender.modifier.subdivision-surface.execute-next"
)
SUBDIVISION_SURFACE_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "operator.subdivision_set",
    "semantic.subdivision_surface_contract",
)
SUBDIVISION_SURFACE_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "modifierId"),
    (),
    (),
    ("modifierName", "viewportLevel"),
)

EDIT_BEVEL_LEAF_OPERATION_ACTION = "blender.mesh.edit_bevel_edges"
EDIT_BEVEL_LEAF_OPERATION_RECIPE = "blender.mesh.edit_bevel_edges.semantic"
EDIT_BEVEL_LEAF_OPERATION_TOOL = (
    "operatingline.blender.mesh.edit-bevel-edges.execute-next"
)
EDIT_BEVEL_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "menu.edge",
    "operator.bevel_edges",
    "semantic.managed_bevel_edges_contract",
)
EDIT_BEVEL_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "resultMeshId"),
    (),
    (),
    (),
    ("width", "segments", "profile"),
    ("resultMeshName",),
)

EDIT_INSET_LEAF_OPERATION_ACTION = "blender.mesh.edit_inset_faces"
EDIT_INSET_LEAF_OPERATION_RECIPE = "blender.mesh.edit_inset_faces.semantic"
EDIT_INSET_LEAF_OPERATION_TOOL = (
    "operatingline.blender.mesh.edit-inset-faces.execute-next"
)
EDIT_INSET_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "menu.face",
    "operator.inset_faces",
    "semantic.managed_inset_faces_contract",
)
EDIT_INSET_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "resultMeshId"),
    (),
    (),
    (),
    ("thickness", "depth"),
    ("resultMeshName",),
)

EDIT_TRIANGULATE_LEAF_OPERATION_ACTION = "blender.mesh.edit_triangulate"
EDIT_TRIANGULATE_LEAF_OPERATION_RECIPE = "blender.mesh.edit_triangulate.semantic"
EDIT_TRIANGULATE_LEAF_OPERATION_TOOL = (
    "operatingline.blender.mesh.edit-triangulate.execute-next"
)
EDIT_TRIANGULATE_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "menu.face",
    "operator.triangulate_faces",
    "semantic.managed_triangulate_contract",
)
EDIT_TRIANGULATE_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "resultMeshId"),
    (),
    (),
    (),
    (),
    ("resultMeshName",),
)

EDIT_EXTRUDE_REGION_LEAF_OPERATION_ACTION = "blender.mesh.edit_extrude_region"
EDIT_EXTRUDE_REGION_LEAF_OPERATION_RECIPE = (
    "blender.mesh.edit_extrude_region.semantic"
)
EDIT_EXTRUDE_REGION_LEAF_OPERATION_TOOL = (
    "operatingline.blender.mesh.edit-extrude-region.execute-next"
)
EDIT_EXTRUDE_REGION_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "semantic.select_face_region",
    "operator.extrude_region_move",
    "semantic.managed_extrude_region_contract",
)
EDIT_EXTRUDE_REGION_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "resultMeshId"),
    (),
    (),
    ("polygonIndices",),
    ("translation",),
    ("resultMeshName",),
)

EDIT_POKE_LEAF_OPERATION_ACTION = "blender.mesh.edit_poke_faces"
EDIT_POKE_LEAF_OPERATION_RECIPE = "blender.mesh.edit_poke_faces.semantic"
EDIT_POKE_LEAF_OPERATION_TOOL = (
    "operatingline.blender.mesh.edit-poke-faces.execute-next"
)
EDIT_POKE_LEAF_OPERATION_IDS = (
    "workspace.layout",
    "semantic.select_owned_mesh",
    "mode.edit_mesh",
    "menu.face",
    "operator.poke_faces",
    "semantic.managed_poke_faces_contract",
)
EDIT_POKE_LEAF_OPERATION_PARAMETER_NAMES = (
    ("targetId", "resultMeshId"),
    (),
    (),
    (),
    ("offset",),
    ("resultMeshName",),
)

GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES = {
    TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION: (
        TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE,
        TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS,
        TRANSFORM_GEOMETRY_LEAF_OPERATION_PARAMETER_NAMES,
        TRANSFORM_GEOMETRY_LEAF_OPERATION_TOOL,
    ),
    LIGHT_TRAILS_LEAF_OPERATION_ACTION: (
        LIGHT_TRAILS_LEAF_OPERATION_RECIPE,
        LIGHT_TRAILS_LEAF_OPERATION_IDS,
        LIGHT_TRAILS_LEAF_OPERATION_PARAMETER_NAMES,
        LIGHT_TRAILS_LEAF_OPERATION_TOOL,
    ),
    POSE_ANIMATION_LEAF_OPERATION_ACTION: (
        POSE_ANIMATION_LEAF_OPERATION_RECIPE,
        POSE_ANIMATION_LEAF_OPERATION_IDS,
        POSE_ANIMATION_LEAF_OPERATION_PARAMETER_NAMES,
        POSE_ANIMATION_LEAF_OPERATION_TOOL,
    ),
    ARMATURE_LEAF_OPERATION_ACTION: (
        ARMATURE_LEAF_OPERATION_RECIPE,
        ARMATURE_LEAF_OPERATION_IDS,
        ARMATURE_LEAF_OPERATION_PARAMETER_NAMES,
        ARMATURE_LEAF_OPERATION_TOOL,
    ),
    SKIN_WEIGHTS_LEAF_OPERATION_ACTION: (
        SKIN_WEIGHTS_LEAF_OPERATION_RECIPE,
        SKIN_WEIGHTS_LEAF_OPERATION_IDS,
        SKIN_WEIGHTS_LEAF_OPERATION_PARAMETER_NAMES,
        SKIN_WEIGHTS_LEAF_OPERATION_TOOL,
    ),
    SOLIDIFY_LEAF_OPERATION_ACTION: (
        SOLIDIFY_LEAF_OPERATION_RECIPE,
        SOLIDIFY_LEAF_OPERATION_IDS,
        SOLIDIFY_LEAF_OPERATION_PARAMETER_NAMES,
        SOLIDIFY_LEAF_OPERATION_TOOL,
    ),
    BEVEL_MODIFIER_LEAF_OPERATION_ACTION: (
        BEVEL_MODIFIER_LEAF_OPERATION_RECIPE,
        BEVEL_MODIFIER_LEAF_OPERATION_IDS,
        BEVEL_MODIFIER_LEAF_OPERATION_PARAMETER_NAMES,
        BEVEL_MODIFIER_LEAF_OPERATION_TOOL,
    ),
    SINGLE_MATERIAL_LEAF_OPERATION_ACTION: (
        SINGLE_MATERIAL_LEAF_OPERATION_RECIPE,
        SINGLE_MATERIAL_LEAF_OPERATION_IDS,
        SINGLE_MATERIAL_LEAF_OPERATION_PARAMETER_NAMES,
        SINGLE_MATERIAL_LEAF_OPERATION_TOOL,
    ),
    MATERIAL_PALETTE_LEAF_OPERATION_ACTION: (
        MATERIAL_PALETTE_LEAF_OPERATION_RECIPE,
        MATERIAL_PALETTE_LEAF_OPERATION_IDS,
        MATERIAL_PALETTE_LEAF_OPERATION_PARAMETER_NAMES,
        MATERIAL_PALETTE_LEAF_OPERATION_TOOL,
    ),
    MIRROR_LEAF_OPERATION_ACTION: (
        MIRROR_LEAF_OPERATION_RECIPE,
        MIRROR_LEAF_OPERATION_IDS,
        MIRROR_LEAF_OPERATION_PARAMETER_NAMES,
        MIRROR_LEAF_OPERATION_TOOL,
    ),
    SUBDIVISION_SURFACE_LEAF_OPERATION_ACTION: (
        SUBDIVISION_SURFACE_LEAF_OPERATION_RECIPE,
        SUBDIVISION_SURFACE_LEAF_OPERATION_IDS,
        SUBDIVISION_SURFACE_LEAF_OPERATION_PARAMETER_NAMES,
        SUBDIVISION_SURFACE_LEAF_OPERATION_TOOL,
    ),
    EDIT_BEVEL_LEAF_OPERATION_ACTION: (
        EDIT_BEVEL_LEAF_OPERATION_RECIPE,
        EDIT_BEVEL_LEAF_OPERATION_IDS,
        EDIT_BEVEL_LEAF_OPERATION_PARAMETER_NAMES,
        EDIT_BEVEL_LEAF_OPERATION_TOOL,
    ),
    EDIT_INSET_LEAF_OPERATION_ACTION: (
        EDIT_INSET_LEAF_OPERATION_RECIPE,
        EDIT_INSET_LEAF_OPERATION_IDS,
        EDIT_INSET_LEAF_OPERATION_PARAMETER_NAMES,
        EDIT_INSET_LEAF_OPERATION_TOOL,
    ),
    EDIT_TRIANGULATE_LEAF_OPERATION_ACTION: (
        EDIT_TRIANGULATE_LEAF_OPERATION_RECIPE,
        EDIT_TRIANGULATE_LEAF_OPERATION_IDS,
        EDIT_TRIANGULATE_LEAF_OPERATION_PARAMETER_NAMES,
        EDIT_TRIANGULATE_LEAF_OPERATION_TOOL,
    ),
    EDIT_EXTRUDE_REGION_LEAF_OPERATION_ACTION: (
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_RECIPE,
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_IDS,
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_PARAMETER_NAMES,
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_TOOL,
    ),
    EDIT_POKE_LEAF_OPERATION_ACTION: (
        EDIT_POKE_LEAF_OPERATION_RECIPE,
        EDIT_POKE_LEAF_OPERATION_IDS,
        EDIT_POKE_LEAF_OPERATION_PARAMETER_NAMES,
        EDIT_POKE_LEAF_OPERATION_TOOL,
    ),
}

GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES_BY_RECIPE = {
    recipe_id: (action_name, operation_ids, parameter_names, tool_name)
    for action_name, (
        recipe_id,
        operation_ids,
        parameter_names,
        tool_name,
    ) in GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES.items()
}

GUIDED_LEAF_OPERATION_PARAMETER_TRANSFORMS = {
    (
        MATERIAL_PALETTE_LEAF_OPERATION_RECIPE,
        "semantic.palette_entries",
        "materials",
    ): "json_identity",
    (
        SINGLE_MATERIAL_LEAF_OPERATION_RECIPE,
        "semantic.principled_surface",
        "baseColor",
    ): "json_identity",
    (
        SINGLE_MATERIAL_LEAF_OPERATION_RECIPE,
        "semantic.principled_surface",
        "targets",
    ): "json_identity",
    (
        POSE_ANIMATION_LEAF_OPERATION_RECIPE,
        "projection.semantic.pose_animation.keyframes",
        "keyframes",
    ): "json_identity",
    (
        ARMATURE_LEAF_OPERATION_RECIPE,
        "projection.semantic.armature.bones",
        "bones",
    ): "json_identity",
    (
        ARMATURE_LEAF_OPERATION_RECIPE,
        "projection.semantic.armature.bindings",
        "bindings",
    ): "json_identity",
    (
        SKIN_WEIGHTS_LEAF_OPERATION_RECIPE,
        "projection.semantic.skin_weights.weights",
        "weights",
    ): "json_identity",
    (
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_RECIPE,
        "semantic.select_face_region",
        "polygonIndices",
    ): "json_identity",
    (
        EDIT_EXTRUDE_REGION_LEAF_OPERATION_RECIPE,
        "operator.extrude_region_move",
        "translation",
    ): "json_identity",
}

GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES = {
    TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION: (
        "guided_geometry_operation",
        "completeGraph",
        frozenset(range(2, len(TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS))),
    ),
    LIGHT_TRAILS_LEAF_OPERATION_ACTION: (
        "guided_geometry_operation",
        "completeGraph",
        frozenset(range(2, len(LIGHT_TRAILS_LEAF_OPERATION_IDS))),
    ),
    POSE_ANIMATION_LEAF_OPERATION_ACTION: (
        "guided_pose_operation",
        "completeAnimation",
        frozenset({4, 5, 7, 9, 11}),
    ),
    ARMATURE_LEAF_OPERATION_ACTION: (
        "guided_armature_operation",
        "completeArmature",
        frozenset({2, 3, 4, 6, 8}),
    ),
    SKIN_WEIGHTS_LEAF_OPERATION_ACTION: (
        "guided_skin_weights_operation",
        "completeSkinWeights",
        frozenset({5, 7, 8}),
    ),
    SOLIDIFY_LEAF_OPERATION_ACTION: (
        "guided_modifier_operation",
        "completeSolidify",
        frozenset({3, 4}),
    ),
    BEVEL_MODIFIER_LEAF_OPERATION_ACTION: (
        "guided_modifier_operation",
        "completeBevelModifier",
        frozenset({3, 4}),
    ),
    SINGLE_MATERIAL_LEAF_OPERATION_ACTION: (
        "guided_material_operation",
        "completeSingleMaterial",
        frozenset({3, 4}),
    ),
    MATERIAL_PALETTE_LEAF_OPERATION_ACTION: (
        "guided_material_operation",
        "completeMaterialPalette",
        frozenset({4}),
    ),
    MIRROR_LEAF_OPERATION_ACTION: (
        "guided_modifier_operation",
        "completeMirror",
        frozenset({6, 7}),
    ),
    SUBDIVISION_SURFACE_LEAF_OPERATION_ACTION: (
        "guided_modifier_operation",
        "completeSubdivisionSurface",
        frozenset({3, 4}),
    ),
    EDIT_BEVEL_LEAF_OPERATION_ACTION: (
        "guided_edit_mesh_operation",
        "completeEditBevelEdges",
        frozenset({5, 6}),
    ),
    EDIT_INSET_LEAF_OPERATION_ACTION: (
        "guided_edit_mesh_operation",
        "completeEditInsetFaces",
        frozenset({5, 6}),
    ),
    EDIT_TRIANGULATE_LEAF_OPERATION_ACTION: (
        "guided_edit_mesh_operation",
        "completeEditTriangulate",
        frozenset({5, 6}),
    ),
    EDIT_EXTRUDE_REGION_LEAF_OPERATION_ACTION: (
        "guided_edit_mesh_operation",
        "completeEditExtrudeRegion",
        frozenset({5, 6}),
    ),
    EDIT_POKE_LEAF_OPERATION_ACTION: (
        "guided_edit_mesh_operation",
        "completeEditPokeFaces",
        frozenset({5, 6}),
    ),
}


__all__ = (
    "ARMATURE_LEAF_OPERATION_ACTION",
    "ARMATURE_LEAF_OPERATION_IDS",
    "ARMATURE_LEAF_OPERATION_PARAMETER_NAMES",
    "ARMATURE_LEAF_OPERATION_RECIPE",
    "ARMATURE_LEAF_OPERATION_TOOL",
    "BEVEL_MODIFIER_LEAF_OPERATION_ACTION",
    "BEVEL_MODIFIER_LEAF_OPERATION_IDS",
    "BEVEL_MODIFIER_LEAF_OPERATION_PARAMETER_NAMES",
    "BEVEL_MODIFIER_LEAF_OPERATION_RECIPE",
    "BEVEL_MODIFIER_LEAF_OPERATION_TOOL",
    "SINGLE_MATERIAL_LEAF_OPERATION_ACTION",
    "SINGLE_MATERIAL_LEAF_OPERATION_IDS",
    "SINGLE_MATERIAL_LEAF_OPERATION_PARAMETER_NAMES",
    "SINGLE_MATERIAL_LEAF_OPERATION_RECIPE",
    "SINGLE_MATERIAL_LEAF_OPERATION_TOOL",
    "MATERIAL_PALETTE_LEAF_OPERATION_ACTION",
    "MATERIAL_PALETTE_LEAF_OPERATION_IDS",
    "MATERIAL_PALETTE_LEAF_OPERATION_PARAMETER_NAMES",
    "MATERIAL_PALETTE_LEAF_OPERATION_RECIPE",
    "MATERIAL_PALETTE_LEAF_OPERATION_TOOL",
    "EDIT_BEVEL_LEAF_OPERATION_ACTION",
    "EDIT_BEVEL_LEAF_OPERATION_IDS",
    "EDIT_BEVEL_LEAF_OPERATION_PARAMETER_NAMES",
    "EDIT_BEVEL_LEAF_OPERATION_RECIPE",
    "EDIT_BEVEL_LEAF_OPERATION_TOOL",
    "EDIT_EXTRUDE_REGION_LEAF_OPERATION_ACTION",
    "EDIT_EXTRUDE_REGION_LEAF_OPERATION_IDS",
    "EDIT_EXTRUDE_REGION_LEAF_OPERATION_PARAMETER_NAMES",
    "EDIT_EXTRUDE_REGION_LEAF_OPERATION_RECIPE",
    "EDIT_EXTRUDE_REGION_LEAF_OPERATION_TOOL",
    "EDIT_INSET_LEAF_OPERATION_ACTION",
    "EDIT_INSET_LEAF_OPERATION_IDS",
    "EDIT_INSET_LEAF_OPERATION_PARAMETER_NAMES",
    "EDIT_INSET_LEAF_OPERATION_RECIPE",
    "EDIT_INSET_LEAF_OPERATION_TOOL",
    "EDIT_TRIANGULATE_LEAF_OPERATION_ACTION",
    "EDIT_TRIANGULATE_LEAF_OPERATION_IDS",
    "EDIT_TRIANGULATE_LEAF_OPERATION_PARAMETER_NAMES",
    "EDIT_TRIANGULATE_LEAF_OPERATION_RECIPE",
    "EDIT_TRIANGULATE_LEAF_OPERATION_TOOL",
    "EDIT_POKE_LEAF_OPERATION_ACTION",
    "EDIT_POKE_LEAF_OPERATION_IDS",
    "EDIT_POKE_LEAF_OPERATION_PARAMETER_NAMES",
    "EDIT_POKE_LEAF_OPERATION_RECIPE",
    "EDIT_POKE_LEAF_OPERATION_TOOL",
    "GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES",
    "GUIDED_GEOMETRY_LEAF_OPERATION_PROFILES_BY_RECIPE",
    "GUIDED_LEAF_OPERATION_PARAMETER_TRANSFORMS",
    "GUIDED_LEAF_OPERATION_OBSERVATION_PROFILES",
    "LIGHT_TRAILS_LEAF_OPERATION_ACTION",
    "LIGHT_TRAILS_LEAF_OPERATION_IDS",
    "LIGHT_TRAILS_LEAF_OPERATION_PARAMETER_NAMES",
    "LIGHT_TRAILS_LEAF_OPERATION_RECIPE",
    "LIGHT_TRAILS_LEAF_OPERATION_TOOL",
    "MIRROR_LEAF_OPERATION_ACTION",
    "MIRROR_LEAF_OPERATION_IDS",
    "MIRROR_LEAF_OPERATION_PARAMETER_NAMES",
    "MIRROR_LEAF_OPERATION_RECIPE",
    "MIRROR_LEAF_OPERATION_TOOL",
    "POSE_ANIMATION_LEAF_OPERATION_ACTION",
    "POSE_ANIMATION_LEAF_OPERATION_IDS",
    "POSE_ANIMATION_LEAF_OPERATION_PARAMETER_NAMES",
    "POSE_ANIMATION_LEAF_OPERATION_RECIPE",
    "POSE_ANIMATION_LEAF_OPERATION_TOOL",
    "SKIN_WEIGHTS_LEAF_OPERATION_ACTION",
    "SKIN_WEIGHTS_LEAF_OPERATION_IDS",
    "SKIN_WEIGHTS_LEAF_OPERATION_PARAMETER_NAMES",
    "SKIN_WEIGHTS_LEAF_OPERATION_RECIPE",
    "SKIN_WEIGHTS_LEAF_OPERATION_TOOL",
    "SOLIDIFY_LEAF_OPERATION_ACTION",
    "SOLIDIFY_LEAF_OPERATION_IDS",
    "SOLIDIFY_LEAF_OPERATION_PARAMETER_NAMES",
    "SOLIDIFY_LEAF_OPERATION_RECIPE",
    "SOLIDIFY_LEAF_OPERATION_TOOL",
    "SUBDIVISION_SURFACE_LEAF_OPERATION_ACTION",
    "SUBDIVISION_SURFACE_LEAF_OPERATION_IDS",
    "SUBDIVISION_SURFACE_LEAF_OPERATION_PARAMETER_NAMES",
    "SUBDIVISION_SURFACE_LEAF_OPERATION_RECIPE",
    "SUBDIVISION_SURFACE_LEAF_OPERATION_TOOL",
    "TRANSFORM_GEOMETRY_LEAF_OPERATION_ACTION",
    "TRANSFORM_GEOMETRY_LEAF_OPERATION_IDS",
    "TRANSFORM_GEOMETRY_LEAF_OPERATION_PARAMETER_NAMES",
    "TRANSFORM_GEOMETRY_LEAF_OPERATION_RECIPE",
    "TRANSFORM_GEOMETRY_LEAF_OPERATION_TOOL",
)
