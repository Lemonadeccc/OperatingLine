"""OperatingLine-owned controls for bounded guided leaf execution."""

from dataclasses import dataclass
import math
from typing import Any


TRANSFORM_GEOMETRY_RECIPE_ID = "blender.geometry_nodes.create_transform.semantic"
TRANSFORM_GEOMETRY_ACTION_NAME = "blender.geometry_nodes.create_transform"
LIGHT_TRAILS_RECIPE_ID = "blender.geometry_nodes.create_light_trails.semantic"
LIGHT_TRAILS_ACTION_NAME = "blender.geometry_nodes.create_light_trails"
POSE_ANIMATION_RECIPE_ID = "blender.animation.create_pose_keyframes.semantic"
POSE_ANIMATION_ACTION_NAME = "blender.animation.create_pose_keyframes"
ARMATURE_RECIPE_ID = "blender.rig.create_armature.semantic"
ARMATURE_ACTION_NAME = "blender.rig.create_armature"
SKIN_WEIGHTS_RECIPE_ID = "blender.rig.bind_skin_weights.semantic"
SKIN_WEIGHTS_ACTION_NAME = "blender.rig.bind_skin_weights"
SOLIDIFY_RECIPE_ID = "blender.modifier.add_solidify.semantic"
SOLIDIFY_ACTION_NAME = "blender.modifier.add_solidify"
BEVEL_MODIFIER_RECIPE_ID = "blender.modifier.add_bevel.semantic"
BEVEL_MODIFIER_ACTION_NAME = "blender.modifier.add_bevel"
SINGLE_MATERIAL_RECIPE_ID = "blender.material.create_and_assign.semantic"
SINGLE_MATERIAL_ACTION_NAME = "blender.material.create_and_assign"
MATERIAL_PALETTE_RECIPE_ID = (
    "blender.material.create_palette_and_assign.semantic"
)
MATERIAL_PALETTE_ACTION_NAME = "blender.material.create_palette_and_assign"
SUBDIVISION_SURFACE_RECIPE_ID = "blender.modifier.add_subdivision_surface.semantic"
SUBDIVISION_SURFACE_ACTION_NAME = "blender.modifier.add_subdivision_surface"
EDIT_BEVEL_RECIPE_ID = "blender.mesh.edit_bevel_edges.semantic"
EDIT_BEVEL_ACTION_NAME = "blender.mesh.edit_bevel_edges"
EDIT_INSET_RECIPE_ID = "blender.mesh.edit_inset_faces.semantic"
EDIT_INSET_ACTION_NAME = "blender.mesh.edit_inset_faces"
EDIT_TRIANGULATE_RECIPE_ID = "blender.mesh.edit_triangulate.semantic"
EDIT_TRIANGULATE_ACTION_NAME = "blender.mesh.edit_triangulate"
EDIT_EXTRUDE_REGION_RECIPE_ID = "blender.mesh.edit_extrude_region.semantic"
EDIT_EXTRUDE_REGION_ACTION_NAME = "blender.mesh.edit_extrude_region"
EDIT_POKE_RECIPE_ID = "blender.mesh.edit_poke_faces.semantic"
EDIT_POKE_ACTION_NAME = "blender.mesh.edit_poke_faces"
MIRROR_RECIPE_ID = "blender.modifier.add_mirror.semantic"
MIRROR_ACTION_NAME = "blender.modifier.add_mirror"

_REVIEWED_RECIPES = {
    TRANSFORM_GEOMETRY_RECIPE_ID: TRANSFORM_GEOMETRY_ACTION_NAME,
    LIGHT_TRAILS_RECIPE_ID: LIGHT_TRAILS_ACTION_NAME,
    POSE_ANIMATION_RECIPE_ID: POSE_ANIMATION_ACTION_NAME,
    ARMATURE_RECIPE_ID: ARMATURE_ACTION_NAME,
    SKIN_WEIGHTS_RECIPE_ID: SKIN_WEIGHTS_ACTION_NAME,
    SOLIDIFY_RECIPE_ID: SOLIDIFY_ACTION_NAME,
    BEVEL_MODIFIER_RECIPE_ID: BEVEL_MODIFIER_ACTION_NAME,
    SINGLE_MATERIAL_RECIPE_ID: SINGLE_MATERIAL_ACTION_NAME,
    MATERIAL_PALETTE_RECIPE_ID: MATERIAL_PALETTE_ACTION_NAME,
    SUBDIVISION_SURFACE_RECIPE_ID: SUBDIVISION_SURFACE_ACTION_NAME,
    EDIT_BEVEL_RECIPE_ID: EDIT_BEVEL_ACTION_NAME,
    EDIT_INSET_RECIPE_ID: EDIT_INSET_ACTION_NAME,
    EDIT_TRIANGULATE_RECIPE_ID: EDIT_TRIANGULATE_ACTION_NAME,
    EDIT_EXTRUDE_REGION_RECIPE_ID: EDIT_EXTRUDE_REGION_ACTION_NAME,
    EDIT_POKE_RECIPE_ID: EDIT_POKE_ACTION_NAME,
    MIRROR_RECIPE_ID: MIRROR_ACTION_NAME,
}
SOLIDIFY_RNA_PROPERTY_SPECS = (
    ("solidify_mode", "EXTRUDE", None),
    ("thickness", None, "thickness"),
    ("thickness_clamp", 0.0, None),
    ("use_thickness_angle_clamp", False, None),
    ("thickness_vertex_group", 0.0, None),
    ("offset", None, "offset"),
    ("edge_crease_inner", 0.0, None),
    ("edge_crease_outer", 0.0, None),
    ("edge_crease_rim", 0.0, None),
    ("material_offset", 0, None),
    ("material_offset_rim", 0, None),
    ("vertex_group", "", None),
    ("shell_vertex_group", "", None),
    ("rim_vertex_group", "", None),
    ("use_even_offset", True, None),
    ("use_rim", True, None),
    ("use_rim_only", False, None),
    ("use_quality_normals", False, None),
    ("invert_vertex_group", False, None),
    ("use_flat_faces", False, None),
    ("use_flip_normals", False, None),
    ("nonmanifold_thickness_mode", "CONSTRAINTS", None),
    ("nonmanifold_boundary_mode", "NONE", None),
    ("nonmanifold_merge_threshold", 0.0001, None),
    ("bevel_convex", 0.0, None),
)
BEVEL_MODIFIER_RNA_PROPERTY_SPECS = (
    ("width", None, "width"),
    ("segments", None, "segments"),
    ("limit_method", "ANGLE", None),
    ("angle_limit", None, "angleLimit"),
)
SUBDIVISION_SURFACE_RNA_PROPERTY_SPECS = (
    ("subdivision_type", "CATMULL_CLARK", None),
    ("levels", None, "viewportLevel"),
    ("render_levels", 2, None),
    ("quality", 3, None),
    ("show_only_control_edges", True, None),
    ("use_creases", True, None),
    ("use_limit_surface", True, None),
    ("boundary_smooth", "ALL", None),
    ("uv_smooth", "PRESERVE_BOUNDARIES", None),
    ("use_custom_normals", False, None),
    ("show_viewport", True, None),
    ("show_render", True, None),
    ("show_in_editmode", True, None),
    ("show_on_cage", False, None),
)
MIRROR_RNA_PROPERTY_SPECS = (
    ("use_axis", 0, "X", None, "axis"),
    ("use_axis", 1, "Y", None, "axis"),
    ("use_axis", 2, "Z", None, "axis"),
    ("use_bisect_axis", 0, "X", False, None),
    ("use_bisect_axis", 1, "Y", False, None),
    ("use_bisect_axis", 2, "Z", False, None),
    ("use_bisect_flip_axis", 0, "X", False, None),
    ("use_bisect_flip_axis", 1, "Y", False, None),
    ("use_bisect_flip_axis", 2, "Z", False, None),
    ("use_clip", None, None, False, None),
    ("use_mirror_merge", None, None, True, None),
    ("merge_threshold", None, None, 0.001, None),
    ("bisect_threshold", None, None, 0.001, None),
    ("mirror_object", None, None, None, None),
    ("use_mirror_vertex_groups", None, None, True, None),
    ("use_mirror_u", None, None, False, None),
    ("use_mirror_v", None, None, False, None),
    ("use_mirror_udim", None, None, False, None),
    ("offset_u", None, None, 0.0, None),
    ("offset_v", None, None, 0.0, None),
    ("mirror_offset_u", None, None, 0.0, None),
    ("mirror_offset_v", None, None, 0.0, None),
    ("show_viewport", None, None, True, None),
    ("show_render", None, None, True, None),
    ("show_in_editmode", None, None, True, None),
    ("show_on_cage", None, None, False, None),
    ("use_apply_on_spline", None, None, False, None),
)
LIGHT_TRAILS_RNA_WRITE_TARGETS = {
    "tileLength": (
        (
            "OperatingLine Half Tile Line",
            "GeometryNodeCurvePrimitiveLine",
            "Start",
            0,
            "X",
            "negative_half_x",
        ),
    ),
    "pointsPerTrail": (
        (
            "OperatingLine Trail Resolution",
            "GeometryNodeResampleCurve",
            "Count",
            0,
            "Value",
            "identity",
        ),
    ),
    "trailCount": (
        (
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Count",
            0,
            "Value",
            "identity",
        ),
        (
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Start Location",
            1,
            "Y",
            "centered_rows_y_from_count",
        ),
    ),
    "trailSpacing": (
        (
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Start Location",
            1,
            "Y",
            "centered_rows_y_from_spacing",
        ),
        (
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Offset",
            1,
            "Y",
            "identity",
        ),
    ),
    "noiseScale": (
        (
            "OperatingLine Terrain Noise",
            "ShaderNodeTexNoise",
            "Scale",
            0,
            "Value",
            "identity",
        ),
    ),
    "noiseDetail": (
        (
            "OperatingLine Terrain Noise",
            "ShaderNodeTexNoise",
            "Detail",
            0,
            "Value",
            "identity",
        ),
    ),
    "noiseRoughness": (
        (
            "OperatingLine Terrain Noise",
            "ShaderNodeTexNoise",
            "Roughness",
            0,
            "Value",
            "identity",
        ),
    ),
    "noiseSeed": (
        (
            "OperatingLine Terrain Noise",
            "ShaderNodeTexNoise",
            "W",
            0,
            "Value",
            "identity",
        ),
    ),
    "height": (
        (
            "OperatingLine Scale Height",
            "ShaderNodeMath",
            "Value_001",
            0,
            "Value",
            "identity",
        ),
    ),
    "profileSides": (
        (
            "OperatingLine Trail Profile",
            "GeometryNodeCurvePrimitiveCircle",
            "Resolution",
            0,
            "Value",
            "identity",
        ),
    ),
    "profileRadius": (
        (
            "OperatingLine Trail Profile",
            "GeometryNodeCurvePrimitiveCircle",
            "Radius",
            0,
            "Value",
            "identity",
        ),
    ),
    "tileRepeatCount": (
        (
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "Count",
            0,
            "Value",
            "identity",
        ),
        (
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "Start Location",
            0,
            "X",
            "centered_tiles_x_from_count",
        ),
    ),
}


def _initialization_node_property_target(
    node_name: str,
    node_type: str,
    property_name: str,
    assigned_value: str,
    ui_component: str,
) -> tuple[Any, ...]:
    return (
        node_name,
        node_type,
        "node_property",
        None,
        property_name,
        None,
        None,
        "catalog_constant",
        None,
        assigned_value,
        "Node",
        ui_component,
    )


def _initialization_socket_target(
    node_name: str,
    node_type: str,
    socket_identifier: str,
    assigned_value: int | float | None,
    component_index: int | None = None,
    component_label: str | None = None,
    action_argument: str | None = None,
) -> tuple[Any, ...]:
    return (
        node_name,
        node_type,
        "input_socket",
        socket_identifier,
        "default_value",
        component_index,
        component_label,
        (
            "catalog_constant"
            if action_argument is None
            else "accepted_action_argument"
        ),
        action_argument,
        assigned_value,
        socket_identifier,
        component_label or "Value",
    )


def _initialization_vector_targets(
    node_name: str,
    node_type: str,
    socket_identifier: str,
    values: tuple[float, float, float],
    *,
    accepted_argument_index: int | None = None,
    action_argument: str | None = None,
) -> tuple[tuple[Any, ...], ...]:
    return tuple(
        _initialization_socket_target(
            node_name,
            node_type,
            socket_identifier,
            value,
            component_index,
            "XYZ"[component_index],
            (
                action_argument
                if component_index == accepted_argument_index
                else None
            ),
        )
        for component_index, value in enumerate(values)
    )


LIGHT_TRAILS_RNA_INITIALIZATION_TARGETS_BY_OPERATION = {
    "node.light_trails.half_tile_line": (
        _initialization_node_property_target(
            "OperatingLine Half Tile Line",
            "GeometryNodeCurvePrimitiveLine",
            "mode",
            "POINTS",
            "Mode",
        ),
        *_initialization_vector_targets(
            "OperatingLine Half Tile Line",
            "GeometryNodeCurvePrimitiveLine",
            "Start",
            (-0.5, 0.0, 0.0),
        ),
        *_initialization_vector_targets(
            "OperatingLine Half Tile Line",
            "GeometryNodeCurvePrimitiveLine",
            "End",
            (0.0, 0.0, 0.0),
        ),
    ),
    "node.light_trails.trail_resolution": (
        _initialization_socket_target(
            "OperatingLine Trail Resolution",
            "GeometryNodeResampleCurve",
            "Count",
            10,
        ),
    ),
    "node.light_trails.trail_rows": (
        _initialization_node_property_target(
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "mode",
            "OFFSET",
            "Mode",
        ),
        _initialization_socket_target(
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Count",
            1,
        ),
        *_initialization_vector_targets(
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Start Location",
            (0.0, 0.0, 0.0),
        ),
        *_initialization_vector_targets(
            "OperatingLine Trail Rows",
            "GeometryNodeMeshLine",
            "Offset",
            (0.0, 1.0, 0.0),
        ),
    ),
    "node.light_trails.terrain_noise": (
        _initialization_node_property_target(
            "OperatingLine Terrain Noise",
            "ShaderNodeTexNoise",
            "noise_dimensions",
            "4D",
            "Dimensions",
        ),
        *(
            _initialization_socket_target(
                "OperatingLine Terrain Noise",
                "ShaderNodeTexNoise",
                socket_identifier,
                value,
            )
            for socket_identifier, value in (
                ("Scale", 1.0),
                ("Detail", 2.0),
                ("Roughness", 0.5),
                ("W", 0.0),
            )
        ),
    ),
    "node.light_trails.center_noise": (
        _initialization_node_property_target(
            "OperatingLine Center Noise",
            "ShaderNodeMath",
            "operation",
            "SUBTRACT",
            "Operation",
        ),
        _initialization_socket_target(
            "OperatingLine Center Noise",
            "ShaderNodeMath",
            "Value_001",
            0.5,
        ),
    ),
    "node.light_trails.scale_height": (
        _initialization_node_property_target(
            "OperatingLine Scale Height",
            "ShaderNodeMath",
            "operation",
            "MULTIPLY",
            "Operation",
        ),
        _initialization_socket_target(
            "OperatingLine Scale Height",
            "ShaderNodeMath",
            "Value_001",
            0.0,
        ),
    ),
    "node.light_trails.mirror_half_tile": _initialization_vector_targets(
        "OperatingLine Mirror Half Tile",
        "GeometryNodeTransform",
        "Scale",
        (-1.0, 1.0, 1.0),
    ),
    "node.light_trails.trail_profile": (
        _initialization_node_property_target(
            "OperatingLine Trail Profile",
            "GeometryNodeCurvePrimitiveCircle",
            "mode",
            "RADIUS",
            "Mode",
        ),
        _initialization_socket_target(
            "OperatingLine Trail Profile",
            "GeometryNodeCurvePrimitiveCircle",
            "Resolution",
            3,
        ),
        _initialization_socket_target(
            "OperatingLine Trail Profile",
            "GeometryNodeCurvePrimitiveCircle",
            "Radius",
            0.1,
        ),
    ),
    "node.light_trails.loop_tiles": (
        _initialization_node_property_target(
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "mode",
            "OFFSET",
            "Mode",
        ),
        _initialization_socket_target(
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "Count",
            1,
        ),
        *_initialization_vector_targets(
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "Start Location",
            (0.0, 0.0, 0.0),
        ),
        *_initialization_vector_targets(
            "OperatingLine Loop Tiles",
            "GeometryNodeMeshLine",
            "Offset",
            (0.0, 0.0, 0.0),
            accepted_argument_index=0,
            action_argument="tileLength",
        ),
    ),
}


def _structure_targets(
    node_name: str,
    node_type: str,
    interface_direction: str | None = None,
) -> tuple[tuple[str, str | None, str | None, str | None, str | None, str | None], ...]:
    interface = (
        ()
        if interface_direction is None
        else (
            (
                "interface_socket",
                None,
                None,
                "Geometry",
                interface_direction,
                "NodeSocketGeometry",
            ),
        )
    )
    return (
        *interface,
        ("node", node_name, node_type, None, None, None),
    )


LIGHT_TRAILS_RNA_STRUCTURE_TARGETS_BY_OPERATION = {
    "node.light_trails.group_input": _structure_targets(
        "OperatingLine Input", "NodeGroupInput", "INPUT"
    ),
    "node.light_trails.half_tile_line": _structure_targets(
        "OperatingLine Half Tile Line", "GeometryNodeCurvePrimitiveLine"
    ),
    "node.light_trails.trail_resolution": _structure_targets(
        "OperatingLine Trail Resolution", "GeometryNodeResampleCurve"
    ),
    "node.light_trails.trail_rows": _structure_targets(
        "OperatingLine Trail Rows", "GeometryNodeMeshLine"
    ),
    "node.light_trails.trail_instances": _structure_targets(
        "OperatingLine Trail Instances", "GeometryNodeInstanceOnPoints"
    ),
    "node.light_trails.realize_trails": _structure_targets(
        "OperatingLine Realize Trails", "GeometryNodeRealizeInstances"
    ),
    "node.light_trails.trail_position": _structure_targets(
        "OperatingLine Trail Position", "GeometryNodeInputPosition"
    ),
    "node.light_trails.terrain_noise": _structure_targets(
        "OperatingLine Terrain Noise", "ShaderNodeTexNoise"
    ),
    "node.light_trails.center_noise": _structure_targets(
        "OperatingLine Center Noise", "ShaderNodeMath"
    ),
    "node.light_trails.scale_height": _structure_targets(
        "OperatingLine Scale Height", "ShaderNodeMath"
    ),
    "node.light_trails.z_offset": _structure_targets(
        "OperatingLine Z Offset", "ShaderNodeCombineXYZ"
    ),
    "node.light_trails.displace_trails": _structure_targets(
        "OperatingLine Displace Trails", "GeometryNodeSetPosition"
    ),
    "node.light_trails.mirror_half_tile": _structure_targets(
        "OperatingLine Mirror Half Tile", "GeometryNodeTransform"
    ),
    "node.light_trails.mirrored_tile": _structure_targets(
        "OperatingLine Mirrored Tile", "GeometryNodeJoinGeometry"
    ),
    "node.light_trails.trail_profile": _structure_targets(
        "OperatingLine Trail Profile", "GeometryNodeCurvePrimitiveCircle"
    ),
    "node.light_trails.curve_to_mesh": _structure_targets(
        "OperatingLine Curve To Mesh", "GeometryNodeCurveToMesh"
    ),
    "node.light_trails.loop_tiles": _structure_targets(
        "OperatingLine Loop Tiles", "GeometryNodeMeshLine"
    ),
    "node.light_trails.tile_instances": _structure_targets(
        "OperatingLine Tile Instances", "GeometryNodeInstanceOnPoints"
    ),
    "node.light_trails.realize_tiles": _structure_targets(
        "OperatingLine Realize Tiles", "GeometryNodeRealizeInstances"
    ),
    "node.light_trails.group_output": _structure_targets(
        "OperatingLine Output", "NodeGroupOutput", "OUTPUT"
    ),
}


@dataclass(frozen=True, slots=True)
class GuidedVectorControl:
    ordinal: int
    operation_id: str
    label: str
    argument_name: str
    value: tuple[float, float, float]
    display_value: str


@dataclass(frozen=True, slots=True)
class GuidedScalarControl:
    ordinal: int
    operation_id: str
    label: str
    argument_name: str
    value: int | float
    display_value: str
    writes: tuple["GuidedScalarWriteControl", ...]

    @property
    def component_index(self) -> int:
        """Compatibility alias for the first exact RNA write target."""

        return self.writes[0].component_index


@dataclass(frozen=True, slots=True)
class GuidedScalarWriteControl:
    order: int
    node_name: str
    socket_identifier: str
    component_index: int
    component_label: str
    projection: str
    projected_value: float


@dataclass(frozen=True, slots=True)
class GuidedInitializationWriteControl:
    order: int
    node_name: str
    node_type: str
    target_kind: str
    socket_identifier: str | None
    property_name: str
    component_index: int | None
    component_label: str | None
    value_source: str
    action_argument: str | None
    assigned_value: str | int | float
    ui_target: str
    ui_component: str

    @property
    def display_target(self) -> str:
        if self.target_kind == "node_property":
            return f"{self.node_name} · Node.{self.ui_component}"
        return f"{self.node_name} · {self.ui_target}.{self.ui_component}"


@dataclass(frozen=True, slots=True)
class GuidedInitializationControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedInitializationWriteControl, ...]


@dataclass(frozen=True, slots=True)
class GuidedStructureWriteControl:
    order: int
    structure_kind: str
    node_name: str | None
    node_type: str | None
    interface_socket_name: str | None
    interface_direction: str | None
    interface_socket_type: str | None

    @property
    def display_target(self) -> str:
        if self.structure_kind == "node":
            return f"NODE RNA · {self.node_name} ({self.node_type})"
        return (
            f"INTERFACE RNA · {self.interface_direction} "
            f"{self.interface_socket_name} ({self.interface_socket_type})"
        )


@dataclass(frozen=True, slots=True)
class GuidedStructureControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedStructureWriteControl, ...]


@dataclass(frozen=True, slots=True)
class GuidedResourceMutationWriteControl:
    order: int
    label: str


@dataclass(frozen=True, slots=True)
class GuidedResourceMutationControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedResourceMutationWriteControl, ...]
    heading: str = "RESOURCE RNA"


@dataclass(frozen=True, slots=True)
class GuidedKeyframeInsertionWriteControl:
    order: int
    frame_order: int
    pose_order: int
    channel_order: int
    bone_name: str
    data_path: str
    frame: int
    accepted_values: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class GuidedKeyframeInsertionControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedKeyframeInsertionWriteControl, ...]


@dataclass(frozen=True, slots=True)
class GuidedAnimationPropertyWriteControl:
    order: int
    bone_name: str
    data_path: str
    component_index: int
    frame: int | None
    property_name: str
    accepted_value: str


@dataclass(frozen=True, slots=True)
class GuidedAnimationPropertyControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedAnimationPropertyWriteControl, ...]


@dataclass(frozen=True, slots=True)
class GuidedActionResourceMutationWriteControl:
    order: int
    label: str


@dataclass(frozen=True, slots=True)
class GuidedActionResourceMutationControl:
    ordinal: int
    operation_id: str
    label: str
    writes: tuple[GuidedActionResourceMutationWriteControl, ...]


@dataclass(frozen=True, slots=True)
class GuidedConnectionControl:
    ordinal: int
    operation_id: str
    label: str
    connection_text: str


@dataclass(frozen=True, slots=True)
class GuidedValueControl:
    ordinal: int
    operation_id: str
    label: str
    argument_name: str
    display_value: str


@dataclass(frozen=True, slots=True)
class GuidedControlDockModel:
    step_id: str
    recipe_id: str
    action_name: str
    cursor_token: str
    focused_ordinal: int
    focused_operation_id: str
    focused_label: str
    operation_count: int
    execution_next_ordinal: int
    run_id: str
    completed_operations: tuple[tuple[int, str], ...]
    operation_execution_available: bool
    vectors: tuple[GuidedVectorControl, ...]
    scalars: tuple[GuidedScalarControl, ...]
    values: tuple[GuidedValueControl, ...]
    initializations: tuple[GuidedInitializationControl, ...]
    structures: tuple[GuidedStructureControl, ...]
    resources: tuple[GuidedResourceMutationControl, ...]
    keyframe_insertions: tuple[GuidedKeyframeInsertionControl, ...]
    animation_properties: tuple[GuidedAnimationPropertyControl, ...]
    action_resources: tuple[GuidedActionResourceMutationControl, ...]
    connections: tuple[GuidedConnectionControl, ...]


def _vector_control(operation: Any) -> GuidedVectorControl | None:
    parameters = tuple(getattr(operation, "parameters", ()))
    if len(parameters) != 1:
        return None
    parameter = parameters[0]
    value = getattr(parameter, "value", None)
    if (
        not getattr(parameter, "resolved", False)
        or not isinstance(value, (list, tuple))
        or len(value) != 3
        or any(isinstance(component, bool) for component in value)
        or not all(isinstance(component, (int, float)) for component in value)
    ):
        return None
    argument_name = getattr(parameter, "name", "")
    if argument_name not in {"translation", "rotation", "scale"}:
        return None
    return GuidedVectorControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        argument_name=argument_name,
        value=(float(value[0]), float(value[1]), float(value[2])),
        display_value=parameter.display_value,
    )


def _scalar_control(
    operation: Any, action_arguments: Any
) -> GuidedScalarControl | None:
    parameters = tuple(getattr(operation, "parameters", ()))
    if len(parameters) != 1:
        return None
    parameter = parameters[0]
    argument_name = getattr(parameter, "name", "")
    value = getattr(parameter, "value", None)
    targets = LIGHT_TRAILS_RNA_WRITE_TARGETS.get(argument_name)
    if (
        targets is None
        or not getattr(parameter, "resolved", False)
        or isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not isinstance(action_arguments, dict)
    ):
        return None
    accepted_value = float(value)

    def projected_value(projection: str) -> float:
        if projection == "identity":
            return accepted_value
        if projection == "negative_half_x":
            return -accepted_value / 2.0
        if projection == "centered_rows_y_from_count":
            return -((accepted_value - 1.0) * 1.0) / 2.0
        if projection == "centered_rows_y_from_spacing":
            trail_count = action_arguments.get("trailCount")
            if (
                isinstance(trail_count, bool)
                or not isinstance(trail_count, (int, float))
                or not math.isfinite(trail_count)
            ):
                raise ValueError("Accepted Light Trails trailCount is unavailable")
            return -((float(trail_count) - 1.0) * accepted_value) / 2.0
        if projection == "centered_tiles_x_from_count":
            tile_length = action_arguments.get("tileLength")
            if (
                isinstance(tile_length, bool)
                or not isinstance(tile_length, (int, float))
                or not math.isfinite(tile_length)
            ):
                raise ValueError("Accepted Light Trails tileLength is unavailable")
            return -((accepted_value - 1.0) * float(tile_length)) / 2.0
        raise ValueError(f"Unsupported Light Trails projection: {projection}")

    try:
        writes = tuple(
            GuidedScalarWriteControl(
                order=order,
                node_name=node_name,
                socket_identifier=socket_identifier,
                component_index=component_index,
                component_label=component_label,
                projection=projection,
                projected_value=projected_value(projection),
            )
            for order, (
                node_name,
                _node_type,
                socket_identifier,
                component_index,
                component_label,
                projection,
            ) in enumerate(targets, start=1)
        )
    except ValueError:
        return None
    return GuidedScalarControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        argument_name=argument_name,
        value=value,
        display_value=parameter.display_value,
        writes=writes,
    )


def _guided_value_controls(operation: Any) -> tuple[GuidedValueControl, ...]:
    controls = []
    for parameter in tuple(getattr(operation, "parameters", ())):
        argument_name = getattr(parameter, "name", "")
        if (
            argument_name
            not in {
                "actionId",
                "armatureId",
                "actionName",
                "keyframes",
                "interpolation",
                "extrapolation",
                "collectionId",
                "objectName",
                "dataName",
                "bones",
                "bindings",
                "targetId",
                "modifierId",
                "weights",
                "preserveVolume",
                "modifierName",
                "thickness",
                "depth",
                "offset",
                "axis",
                "viewportLevel",
                "resultMeshId",
                "resultMeshName",
                "polygonIndices",
                "translation",
                "width",
                "segments",
                "profile",
                "angleLimit",
                "materialId",
                "materialName",
                "baseColor",
                "roughness",
                "metallic",
                "targets",
                "materials",
            }
            or not getattr(parameter, "resolved", False)
        ):
            continue
        controls.append(
            GuidedValueControl(
                ordinal=operation.ordinal,
                operation_id=operation.operation_id,
                label=operation.label,
                argument_name=argument_name,
                display_value=str(getattr(parameter, "display_value", "")),
            )
        )
    return tuple(controls)


def _initialization_control(
    operation: Any, action_arguments: Any
) -> GuidedInitializationControl | None:
    targets = LIGHT_TRAILS_RNA_INITIALIZATION_TARGETS_BY_OPERATION.get(
        getattr(operation, "operation_id", None)
    )
    if targets is None or not isinstance(action_arguments, dict):
        return None
    writes = []
    for order, target in enumerate(targets, start=1):
        (
            node_name,
            node_type,
            target_kind,
            socket_identifier,
            property_name,
            component_index,
            component_label,
            value_source,
            action_argument,
            constant_value,
            ui_target,
            ui_component,
        ) = target
        assigned_value = (
            action_arguments.get(action_argument)
            if value_source == "accepted_action_argument"
            else constant_value
        )
        if (
            isinstance(assigned_value, bool)
            or not isinstance(assigned_value, (str, int, float))
            or (
                isinstance(assigned_value, (int, float))
                and not math.isfinite(assigned_value)
            )
        ):
            return None
        writes.append(
            GuidedInitializationWriteControl(
                order=order,
                node_name=node_name,
                node_type=node_type,
                target_kind=target_kind,
                socket_identifier=socket_identifier,
                property_name=property_name,
                component_index=component_index,
                component_label=component_label,
                value_source=value_source,
                action_argument=action_argument,
                assigned_value=assigned_value,
                ui_target=ui_target,
                ui_component=ui_component,
            )
        )
    return GuidedInitializationControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=tuple(writes),
    )


def _structure_control(operation: Any) -> GuidedStructureControl | None:
    targets = LIGHT_TRAILS_RNA_STRUCTURE_TARGETS_BY_OPERATION.get(
        getattr(operation, "operation_id", None)
    )
    if targets is None:
        return None
    return GuidedStructureControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=tuple(
            GuidedStructureWriteControl(
                order=order,
                structure_kind=structure_kind,
                node_name=node_name,
                node_type=node_type,
                interface_socket_name=interface_socket_name,
                interface_direction=interface_direction,
                interface_socket_type=interface_socket_type,
            )
            for order, (
                structure_kind,
                node_name,
                node_type,
                interface_socket_name,
                interface_direction,
                interface_socket_type,
            ) in enumerate(targets, start=1)
        ),
    )


def _resource_mutation_control(
    operation: Any, action_arguments: Any
) -> GuidedResourceMutationControl | None:
    if not isinstance(action_arguments, dict):
        return None
    operation_id = getattr(operation, "operation_id", None)
    if operation_id == "semantic.new_geometry_modifier":
        modifier_name = action_arguments.get("modifierName")
        node_group_name = action_arguments.get("nodeGroupName")
        if (
            not isinstance(modifier_name, str)
            or not modifier_name
            or not isinstance(node_group_name, str)
            or not node_group_name
        ):
            return None
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=(
                GuidedResourceMutationWriteControl(
                    1,
                    f"NODE GROUP RNA · {node_group_name} (GeometryNodeTree)",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"MODIFIER RNA · {modifier_name} (NODES)",
                ),
                GuidedResourceMutationWriteControl(
                    3,
                    f"BIND RNA · {modifier_name} → {node_group_name}",
                ),
            ),
        )
    if operation_id in {"control.new_material", "semantic.principled_surface"}:
        material_id = action_arguments.get("materialId")
        material_name = action_arguments.get("materialName")
        if not all(
            isinstance(value, str) and value
            for value in (material_id, material_name)
        ):
            return None
        if operation_id == "control.new_material":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MATERIAL RNA · {material_id} (managed pending)",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    "MATERIAL RNA · use_nodes = On",
                ),
            )
            heading = "MATERIAL RESOURCE RNA"
        else:
            base_color = action_arguments.get("baseColor")
            roughness = action_arguments.get("roughness")
            metallic = action_arguments.get("metallic")
            targets = action_arguments.get("targets")
            if (
                not isinstance(base_color, list)
                or len(base_color) != 4
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or not 0.0 <= float(value) <= 1.0
                    for value in base_color
                )
                or isinstance(roughness, bool)
                or not isinstance(roughness, (int, float))
                or not math.isfinite(roughness)
                or not 0.0 <= float(roughness) <= 1.0
                or isinstance(metallic, bool)
                or not isinstance(metallic, (int, float))
                or not math.isfinite(metallic)
                or not 0.0 <= float(metallic) <= 1.0
                or not isinstance(targets, list)
                or not targets
                or any(not isinstance(target, str) or not target for target in targets)
            ):
                return None
            component_labels = ("R", "G", "B", "A")
            writes_list = [
                GuidedResourceMutationWriteControl(
                    1, f"MATERIAL NAME RNA · managed pending → {material_name}"
                )
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    index + 2,
                    f"MATERIAL RNA · diffuse_color.{component} = {float(base_color[index]):.9g}",
                )
                for index, component in enumerate(component_labels)
            )
            writes_list.extend(
                (
                    GuidedResourceMutationWriteControl(
                        6, f"MATERIAL RNA · roughness = {float(roughness):.9g}"
                    ),
                    GuidedResourceMutationWriteControl(
                        7, f"MATERIAL RNA · metallic = {float(metallic):.9g}"
                    ),
                )
            )
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    index + 8,
                    (
                        "PRINCIPLED RNA · Base Color."
                        f"{component} = {float(base_color[index]):.9g}"
                    ),
                )
                for index, component in enumerate(component_labels)
            )
            writes_list.extend(
                (
                    GuidedResourceMutationWriteControl(
                        12,
                        f"PRINCIPLED RNA · Roughness = {float(roughness):.9g}",
                    ),
                    GuidedResourceMutationWriteControl(
                        13,
                        f"PRINCIPLED RNA · Metallic = {float(metallic):.9g}",
                    ),
                )
            )
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    index + 14,
                    f"MATERIAL SLOT RNA · {target} → {material_id}",
                )
                for index, target in enumerate(targets)
            )
            writes = tuple(writes_list)
            heading = "MATERIAL SURFACE AND ASSIGNMENT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id == "semantic.assign_targets":
        materials = action_arguments.get("materials")
        if not isinstance(materials, list) or not materials:
            return None
        writes_list: list[GuidedResourceMutationWriteControl] = []
        component_labels = ("R", "G", "B", "A")
        for material_order, material in enumerate(materials, start=1):
            if not isinstance(material, dict):
                return None
            material_id = material.get("materialId")
            material_name = material.get("materialName")
            base_color = material.get("baseColor")
            roughness = material.get("roughness")
            metallic = material.get("metallic")
            targets = material.get("targets")
            if (
                not isinstance(material_id, str)
                or not material_id
                or not isinstance(material_name, str)
                or not material_name
                or not isinstance(base_color, list)
                or len(base_color) != 4
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or not 0.0 <= float(value) <= 1.0
                    for value in base_color
                )
                or isinstance(roughness, bool)
                or not isinstance(roughness, (int, float))
                or not math.isfinite(roughness)
                or not 0.0 <= float(roughness) <= 1.0
                or isinstance(metallic, bool)
                or not isinstance(metallic, (int, float))
                or not math.isfinite(metallic)
                or not 0.0 <= float(metallic) <= 1.0
                or not isinstance(targets, list)
                or not targets
                or any(not isinstance(target, str) or not target for target in targets)
            ):
                return None

            def add(label: str) -> None:
                writes_list.append(
                    GuidedResourceMutationWriteControl(
                        len(writes_list) + 1,
                        f"PALETTE {material_order:02d} · {label}",
                    )
                )

            add(f"MATERIAL RNA · {material_id} / {material_name} (create)")
            add("MATERIAL RNA · use_nodes = On")
            for index, component in enumerate(component_labels):
                add(
                    "MATERIAL RNA · diffuse_color."
                    f"{component} = {float(base_color[index]):.9g}"
                )
            add(f"MATERIAL RNA · roughness = {float(roughness):.9g}")
            add(f"MATERIAL RNA · metallic = {float(metallic):.9g}")
            for index, component in enumerate(component_labels):
                add(
                    "PRINCIPLED RNA · Base Color."
                    f"{component} = {float(base_color[index]):.9g}"
                )
            add(f"PRINCIPLED RNA · Roughness = {float(roughness):.9g}")
            add(f"PRINCIPLED RNA · Metallic = {float(metallic):.9g}")
            for target in targets:
                add(f"MATERIAL SLOT RNA · {target} → {material_id}")
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=tuple(writes_list),
            heading="MATERIAL PALETTE RNA",
        )
    if operation_id in {
        "operator.bevel_edges",
        "semantic.managed_bevel_edges_contract",
    }:
        target_id = action_arguments.get("targetId")
        result_mesh_id = action_arguments.get("resultMeshId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, result_mesh_id)
        ):
            return None
        if operation_id == "operator.bevel_edges":
            width = action_arguments.get("width")
            segments = action_arguments.get("segments")
            profile = action_arguments.get("profile")
            if (
                isinstance(width, bool)
                or not isinstance(width, (int, float))
                or not math.isfinite(width)
                or isinstance(segments, bool)
                or not isinstance(segments, int)
                or isinstance(profile, bool)
                or not isinstance(profile, (int, float))
                or not math.isfinite(profile)
            ):
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH RNA · {target_id} → {result_mesh_id} (managed pending copy)",
                ),
                GuidedResourceMutationWriteControl(
                    2, f"BEVEL PARAMETER · width = {float(width):.9g}"
                ),
                GuidedResourceMutationWriteControl(
                    3, f"BEVEL PARAMETER · segments = {segments}"
                ),
                GuidedResourceMutationWriteControl(
                    4, f"BEVEL PARAMETER · profile = {float(profile):.9g}"
                ),
                GuidedResourceMutationWriteControl(
                    5, "BMESH WRITE · selected edges → managed result mesh",
                ),
            )
            heading = "EDIT BEVEL MESH RNA"
        else:
            result_mesh_name = action_arguments.get("resultMeshName")
            if not isinstance(result_mesh_name, str) or not result_mesh_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH NAME RNA · managed pending → {result_mesh_name}",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"OBJECT DATA RNA · {target_id} → {result_mesh_id}",
                ),
            )
            heading = "EDIT BEVEL CONTRACT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "operator.poke_faces",
        "semantic.managed_poke_faces_contract",
    }:
        target_id = action_arguments.get("targetId")
        result_mesh_id = action_arguments.get("resultMeshId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, result_mesh_id)
        ):
            return None
        if operation_id == "operator.poke_faces":
            offset = action_arguments.get("offset")
            if (
                isinstance(offset, bool)
                or not isinstance(offset, (int, float))
                or not math.isfinite(offset)
            ):
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH RNA · {target_id} → {result_mesh_id} (managed pending copy)",
                ),
                GuidedResourceMutationWriteControl(
                    2, f"POKE PARAMETER · offset = {float(offset):.9g}"
                ),
                GuidedResourceMutationWriteControl(
                    3, "BMESH WRITE · all faces → triangle-only poke result mesh",
                ),
            )
            heading = "EDIT POKE MESH RNA"
        else:
            result_mesh_name = action_arguments.get("resultMeshName")
            if not isinstance(result_mesh_name, str) or not result_mesh_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH NAME RNA · managed pending → {result_mesh_name}",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"OBJECT DATA RNA · {target_id} → {result_mesh_id}",
                ),
            )
            heading = "EDIT POKE CONTRACT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "operator.inset_faces",
        "semantic.managed_inset_faces_contract",
    }:
        target_id = action_arguments.get("targetId")
        result_mesh_id = action_arguments.get("resultMeshId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, result_mesh_id)
        ):
            return None
        if operation_id == "operator.inset_faces":
            thickness = action_arguments.get("thickness")
            depth = action_arguments.get("depth")
            if (
                isinstance(thickness, bool)
                or not isinstance(thickness, (int, float))
                or not math.isfinite(thickness)
                or isinstance(depth, bool)
                or not isinstance(depth, (int, float))
                or not math.isfinite(depth)
            ):
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH RNA · {target_id} → {result_mesh_id} (managed pending copy)",
                ),
                GuidedResourceMutationWriteControl(
                    2, f"INSET PARAMETER · thickness = {float(thickness):.9g}"
                ),
                GuidedResourceMutationWriteControl(
                    3, f"INSET PARAMETER · depth = {float(depth):.9g}"
                ),
                GuidedResourceMutationWriteControl(
                    4, "BMESH WRITE · all faces → individual inset result mesh",
                ),
            )
            heading = "EDIT INSET MESH RNA"
        else:
            result_mesh_name = action_arguments.get("resultMeshName")
            if not isinstance(result_mesh_name, str) or not result_mesh_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH NAME RNA · managed pending → {result_mesh_name}",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"OBJECT DATA RNA · {target_id} → {result_mesh_id}",
                ),
            )
            heading = "EDIT INSET CONTRACT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "operator.triangulate_faces",
        "semantic.managed_triangulate_contract",
    }:
        target_id = action_arguments.get("targetId")
        result_mesh_id = action_arguments.get("resultMeshId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, result_mesh_id)
        ):
            return None
        if operation_id == "operator.triangulate_faces":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH RNA · {target_id} → {result_mesh_id} (managed pending copy)",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    "BMESH WRITE · all faces → fixed triangle-only result mesh",
                ),
            )
            heading = "EDIT TRIANGULATE MESH RNA"
        else:
            result_mesh_name = action_arguments.get("resultMeshName")
            if not isinstance(result_mesh_name, str) or not result_mesh_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH NAME RNA · managed pending → {result_mesh_name}",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"OBJECT DATA RNA · {target_id} → {result_mesh_id}",
                ),
            )
            heading = "EDIT TRIANGULATE CONTRACT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "operator.extrude_region_move",
        "semantic.managed_extrude_region_contract",
    }:
        target_id = action_arguments.get("targetId")
        result_mesh_id = action_arguments.get("resultMeshId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, result_mesh_id)
        ):
            return None
        if operation_id == "operator.extrude_region_move":
            polygon_indices = action_arguments.get("polygonIndices")
            translation = action_arguments.get("translation")
            if (
                not isinstance(polygon_indices, list)
                or not polygon_indices
                or any(
                    isinstance(index, bool) or not isinstance(index, int)
                    for index in polygon_indices
                )
                or not isinstance(translation, list)
                or len(translation) != 3
                or any(
                    isinstance(component, bool)
                    or not isinstance(component, (int, float))
                    or not math.isfinite(component)
                    for component in translation
                )
            ):
                return None
            translation_label = ", ".join(
                f"{float(component):.9g}" for component in translation
            )
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH RNA · {target_id} → {result_mesh_id} (managed pending copy)",
                ),
                GuidedResourceMutationWriteControl(
                    2, f"TRANSLATE PARAMETER · [{translation_label}]"
                ),
                GuidedResourceMutationWriteControl(
                    3,
                    "BMESH WRITE · accepted face region → managed extrusion result mesh",
                ),
            )
            heading = "EDIT EXTRUDE REGION MESH RNA"
        else:
            result_mesh_name = action_arguments.get("resultMeshName")
            if not isinstance(result_mesh_name, str) or not result_mesh_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    f"MESH NAME RNA · managed pending → {result_mesh_name}",
                ),
                GuidedResourceMutationWriteControl(
                    2,
                    f"OBJECT DATA RNA · {target_id} → {result_mesh_id}",
                ),
            )
            heading = "EDIT EXTRUDE REGION CONTRACT RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "operator.subdivision_set",
        "semantic.subdivision_surface_contract",
    }:
        target_id = action_arguments.get("targetId")
        modifier_id = action_arguments.get("modifierId")
        if not all(
            isinstance(value, str) and value for value in (target_id, modifier_id)
        ):
            return None
        if operation_id == "operator.subdivision_set":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    (
                        "SUBDIVISION SURFACE MODIFIER RNA · "
                        f"{target_id}/{modifier_id} (SUBSURF; managed pending)"
                    ),
                ),
            )
            heading = "SUBDIVISION SURFACE RESOURCE RNA"
        else:
            modifier_name = action_arguments.get("modifierName")
            viewport_level = action_arguments.get("viewportLevel")
            if (
                not isinstance(modifier_name, str)
                or not modifier_name
                or isinstance(viewport_level, bool)
                or not isinstance(viewport_level, int)
                or not 1 <= viewport_level <= 3
            ):
                return None

            def display_subdivision_surface_value(value: Any) -> str:
                if isinstance(value, bool):
                    return "On" if value else "Off"
                return str(value)

            accepted = {"viewportLevel": viewport_level}
            writes_list = [
                GuidedResourceMutationWriteControl(
                    1, f"MODIFIER NAME RNA · managed pending → {modifier_name}"
                )
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    order,
                    (
                        f"PROPERTY RNA · {property_name} = "
                        f"{display_subdivision_surface_value(value)}"
                    ),
                )
                for order, (property_name, constant, action_argument) in enumerate(
                    SUBDIVISION_SURFACE_RNA_PROPERTY_SPECS, start=2
                )
                for value in (
                    accepted[action_argument]
                    if action_argument is not None
                    else constant,
                )
            )
            writes = tuple(writes_list)
            heading = "SUBDIVISION SURFACE PROPERTY RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {"modifier.mirror", "semantic.mirror_contract"}:
        target_id = action_arguments.get("targetId")
        modifier_id = action_arguments.get("modifierId")
        if not all(
            isinstance(value, str) and value for value in (target_id, modifier_id)
        ):
            return None
        if operation_id == "modifier.mirror":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    (
                        f"MIRROR MODIFIER RNA · {target_id}/{modifier_id} "
                        "(MIRROR; managed pending)"
                    ),
                ),
            )
            heading = "MIRROR RESOURCE RNA"
        else:
            modifier_name = action_arguments.get("modifierName")
            axis = action_arguments.get("axis")
            if (
                not isinstance(modifier_name, str)
                or not modifier_name
                or axis not in {"X", "Y", "Z"}
            ):
                return None

            def display_mirror_value(value: Any) -> str:
                if isinstance(value, bool):
                    return "On" if value else "Off"
                if isinstance(value, float):
                    return f"{value:.9g}"
                if value is None:
                    return "None"
                return str(value)

            axis_index = {"X": 0, "Y": 1, "Z": 2}[axis]
            writes_list = [
                GuidedResourceMutationWriteControl(
                    1, f"MODIFIER NAME RNA · managed pending → {modifier_name}"
                )
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    order,
                    (
                        "PROPERTY RNA · "
                        + property_name
                        + (f"[{component_label}]" if component_label else "")
                        + f" = {display_mirror_value(value)}"
                    ),
                )
                for order, (
                    property_name,
                    component_index,
                    component_label,
                    constant,
                    action_argument,
                ) in enumerate(MIRROR_RNA_PROPERTY_SPECS, start=2)
                for value in (
                    component_index == axis_index
                    if action_argument == "axis"
                    else constant,
                )
            )
            writes = tuple(writes_list)
            heading = "MIRROR PROPERTY RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "control.add_modifier",
        "semantic.bevel_parameters",
    } and all(
        name in action_arguments for name in ("width", "segments", "angleLimit")
    ):
        target_id = action_arguments.get("targetId")
        modifier_id = action_arguments.get("modifierId")
        if not all(
            isinstance(value, str) and value for value in (target_id, modifier_id)
        ):
            return None
        if operation_id == "control.add_modifier":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    (
                        f"BEVEL MODIFIER RNA · {target_id}/{modifier_id} "
                        "(BEVEL; managed pending)"
                    ),
                ),
            )
            heading = "BEVEL MODIFIER RESOURCE RNA"
        else:
            modifier_name = action_arguments.get("modifierName")
            width = action_arguments.get("width")
            segments = action_arguments.get("segments")
            angle_limit = action_arguments.get("angleLimit")
            if (
                not isinstance(modifier_name, str)
                or not modifier_name
                or isinstance(width, bool)
                or not isinstance(width, (int, float))
                or not math.isfinite(width)
                or isinstance(segments, bool)
                or not isinstance(segments, int)
                or isinstance(angle_limit, bool)
                or not isinstance(angle_limit, (int, float))
                or not math.isfinite(angle_limit)
            ):
                return None
            accepted = {
                "width": float(width),
                "segments": segments,
                "angleLimit": float(angle_limit),
            }
            writes_list = [
                GuidedResourceMutationWriteControl(
                    1, f"MODIFIER NAME RNA · managed pending → {modifier_name}"
                )
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    order,
                    f"PROPERTY RNA · {property_name} = {value}",
                )
                for order, (property_name, constant, action_argument) in enumerate(
                    BEVEL_MODIFIER_RNA_PROPERTY_SPECS, start=2
                )
                for value in (
                    accepted[action_argument]
                    if action_argument is not None
                    else constant,
                )
            )
            writes = tuple(writes_list)
            heading = "BEVEL MODIFIER PROPERTY RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "control.add_modifier",
        "semantic.solidify_parameters",
    } and all(name in action_arguments for name in ("thickness", "offset")):
        target_id = action_arguments.get("targetId")
        modifier_id = action_arguments.get("modifierId")
        if not all(
            isinstance(value, str) and value for value in (target_id, modifier_id)
        ):
            return None
        if operation_id == "control.add_modifier":
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    (
                        f"SOLIDIFY MODIFIER RNA · {target_id}/{modifier_id} "
                        "(SOLIDIFY; managed pending)"
                    ),
                ),
            )
            heading = "SOLIDIFY RESOURCE RNA"
        else:
            modifier_name = action_arguments.get("modifierName")
            thickness = action_arguments.get("thickness")
            offset = action_arguments.get("offset")
            if (
                not isinstance(modifier_name, str)
                or not modifier_name
                or isinstance(thickness, bool)
                or not isinstance(thickness, (int, float))
                or not math.isfinite(thickness)
                or isinstance(offset, bool)
                or not isinstance(offset, (int, float))
                or not math.isfinite(offset)
            ):
                return None

            def display_value(value: Any) -> str:
                if isinstance(value, bool):
                    return "On" if value else "Off"
                if isinstance(value, float):
                    return f"{value:.9g}"
                if value == "":
                    return '""'
                return str(value)

            accepted = {"thickness": float(thickness), "offset": float(offset)}
            writes_list = [
                GuidedResourceMutationWriteControl(
                    1, f"MODIFIER NAME RNA · managed pending → {modifier_name}"
                )
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    order,
                    f"PROPERTY RNA · {property_name} = {display_value(value)}",
                )
                for order, (property_name, constant, action_argument) in enumerate(
                    SOLIDIFY_RNA_PROPERTY_SPECS, start=2
                )
                for value in (
                    accepted[action_argument]
                    if action_argument is not None
                    else constant,
                )
            )
            writes = tuple(writes_list)
            heading = "SOLIDIFY PROPERTY RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    if operation_id in {
        "projection.semantic.skin_weights.weights",
        "projection.semantic.skin_weights.preserve_volume",
        "projection.semantic.skin_weights.modifier_name",
    }:
        target_id = action_arguments.get("targetId")
        armature_id = action_arguments.get("armatureId")
        modifier_id = action_arguments.get("modifierId")
        if not all(
            isinstance(value, str) and value
            for value in (target_id, armature_id, modifier_id)
        ):
            return None
        if operation_id == "projection.semantic.skin_weights.weights":
            weights = action_arguments.get("weights")
            if not isinstance(weights, list) or not weights:
                return None
            bone_names: list[str] = []
            assignments: list[tuple[int, str, float]] = []
            for vertex in weights:
                if not isinstance(vertex, dict):
                    return None
                vertex_index = vertex.get("vertexIndex")
                influences = vertex.get("influences")
                if (
                    isinstance(vertex_index, bool)
                    or not isinstance(vertex_index, int)
                    or vertex_index < 0
                    or not isinstance(influences, list)
                    or not influences
                ):
                    return None
                for influence in influences:
                    if not isinstance(influence, dict):
                        return None
                    bone_name = influence.get("boneName")
                    weight = influence.get("weight")
                    if (
                        not isinstance(bone_name, str)
                        or not bone_name
                        or isinstance(weight, bool)
                        or not isinstance(weight, (int, float))
                        or not math.isfinite(weight)
                        or not 0 < weight <= 1
                    ):
                        return None
                    if bone_name not in bone_names:
                        bone_names.append(bone_name)
                    assignments.append((vertex_index, bone_name, float(weight)))
            writes_list = [
                GuidedResourceMutationWriteControl(
                    order,
                    f"BONE DEFORM RNA · {armature_id}/{bone_name} · Deform = On",
                )
                for order, bone_name in enumerate(bone_names, start=1)
            ]
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    f"VERTEX GROUP RNA · {target_id}/{bone_name} (VertexGroup)",
                )
                for bone_name in bone_names
            )
            writes_list.extend(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    (
                        f"WEIGHT RNA · {target_id}[{vertex_index}] → {bone_name} "
                        f"= {weight:.9g} (REPLACE)"
                    ),
                )
                for vertex_index, bone_name, weight in assignments
            )
            writes = tuple(writes_list)
            heading = "SKIN WEIGHT RNA"
        elif operation_id == "projection.semantic.skin_weights.preserve_volume":
            preserve_volume = action_arguments.get("preserveVolume")
            if not isinstance(preserve_volume, bool):
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1,
                    (
                        f"ARMATURE MODIFIER RNA · {target_id}/{modifier_id} "
                        "(ARMATURE; managed pending)"
                    ),
                ),
                GuidedResourceMutationWriteControl(
                    2, f"OBJECT BIND RNA · {modifier_id} → {armature_id}"
                ),
                GuidedResourceMutationWriteControl(
                    3, "PROPERTY RNA · use_vertex_groups = On"
                ),
                GuidedResourceMutationWriteControl(
                    4, "PROPERTY RNA · use_bone_envelopes = Off"
                ),
                GuidedResourceMutationWriteControl(
                    5,
                    "PROPERTY RNA · use_deform_preserve_volume = "
                    + ("On" if preserve_volume else "Off"),
                ),
            )
            heading = "SKIN MODIFIER RNA"
        else:
            modifier_name = action_arguments.get("modifierName")
            if not isinstance(modifier_name, str) or not modifier_name:
                return None
            writes = (
                GuidedResourceMutationWriteControl(
                    1, f"MODIFIER NAME RNA · managed pending → {modifier_name}"
                ),
            )
            heading = "SKIN MODIFIER RNA"
        return GuidedResourceMutationControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            writes=writes,
            heading=heading,
        )
    armature_id = action_arguments.get("armatureId")
    object_name = action_arguments.get("objectName")
    data_name = action_arguments.get("dataName")
    if not all(
        isinstance(value, str) and value
        for value in (armature_id, object_name, data_name)
    ):
        return None
    if operation_id == "menu.add_armature":
        collection_id = action_arguments.get("collectionId")
        if not isinstance(collection_id, str) or not collection_id:
            return None
        writes = (
            GuidedResourceMutationWriteControl(
                1, f"ARMATURE DATA RNA · {armature_id}.data (managed pending)"
            ),
            GuidedResourceMutationWriteControl(
                2, f"OBJECT RNA · {armature_id} → {armature_id}.data"
            ),
            GuidedResourceMutationWriteControl(
                3, f"COLLECTION LINK RNA · {armature_id} → {collection_id}"
            ),
        )
        heading = "ARMATURE RESOURCE RNA"
    elif operation_id == "projection.semantic.armature.object_name":
        writes = (
            GuidedResourceMutationWriteControl(
                1, f"OBJECT NAME RNA · managed pending → {object_name}"
            ),
        )
        heading = "ARMATURE RESOURCE RNA"
    elif operation_id == "projection.semantic.armature.data_name":
        writes = (
            GuidedResourceMutationWriteControl(
                1, f"DATA NAME RNA · managed pending → {data_name}"
            ),
        )
        heading = "ARMATURE RESOURCE RNA"
    elif operation_id == "projection.semantic.armature.bones":
        bones = action_arguments.get("bones")
        if not isinstance(bones, list) or not bones:
            return None
        writes_list: list[GuidedResourceMutationWriteControl] = []
        for bone in bones:
            if not isinstance(bone, dict):
                return None
            bone_name = bone.get("boneName")
            head = bone.get("head")
            tail = bone.get("tail")
            if (
                not isinstance(bone_name, str)
                or not bone_name
                or not isinstance(head, list)
                or not isinstance(tail, list)
                or len(head) != 3
                or len(tail) != 3
                or any(isinstance(value, bool) for value in (*head, *tail))
                or not all(
                    isinstance(value, (int, float)) and math.isfinite(value)
                    for value in (*head, *tail)
                )
            ):
                return None
            head_text = ", ".join(f"{float(value):.9g}" for value in head)
            tail_text = ", ".join(f"{float(value):.9g}" for value in tail)
            writes_list.append(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    f"EDIT BONE RNA · {bone_name} · ({head_text}) → ({tail_text}) · Deform Off",
                )
            )
        for bone in bones:
            parent_name = bone.get("parentName")
            if parent_name is None:
                continue
            bone_name = bone.get("boneName")
            if not isinstance(parent_name, str) or not parent_name:
                return None
            writes_list.append(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    f"PARENT RNA · {bone_name} → {parent_name}",
                )
            )
        for bone in bones:
            writes_list.append(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    f"POSE BONE RNA · {bone['boneName']} · Rotation Mode = XYZ",
                )
            )
        writes = tuple(writes_list)
        heading = "BONE RNA"
    elif operation_id == "projection.semantic.armature.bindings":
        bindings = action_arguments.get("bindings")
        if not isinstance(bindings, list) or not bindings:
            return None
        writes_list = []
        for binding in bindings:
            if not isinstance(binding, dict):
                return None
            target_id = binding.get("targetId")
            bone_name = binding.get("boneName")
            if (
                not isinstance(target_id, str)
                or not target_id
                or not isinstance(bone_name, str)
                or not bone_name
            ):
                return None
            writes_list.append(
                GuidedResourceMutationWriteControl(
                    len(writes_list) + 1,
                    f"RIGID BIND RNA · {target_id} → {armature_id}/{bone_name} · World preserved",
                )
            )
        writes = tuple(writes_list)
        heading = "BINDING RNA"
    else:
        return None
    return GuidedResourceMutationControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=writes,
        heading=heading,
    )


def _keyframe_insertion_control(
    operation: Any, action_arguments: Any
) -> GuidedKeyframeInsertionControl | None:
    if (
        getattr(operation, "operation_id", None)
        != "projection.semantic.pose_animation.keyframes"
        or not isinstance(action_arguments, dict)
    ):
        return None
    keyframes = action_arguments.get("keyframes")
    if not isinstance(keyframes, list):
        return None
    writes = []
    order = 0
    for frame_order, keyframe in enumerate(keyframes, start=1):
        if not isinstance(keyframe, dict):
            return None
        frame = keyframe.get("frame")
        poses = keyframe.get("poses")
        if isinstance(frame, bool) or not isinstance(frame, int) or not isinstance(poses, list):
            return None
        for pose_order, pose in enumerate(poses, start=1):
            if not isinstance(pose, dict):
                return None
            bone_name = pose.get("boneName")
            if not isinstance(bone_name, str) or not bone_name:
                return None
            rotation_channels = tuple(
                (argument_name, data_path, pose.get(argument_name))
                for argument_name, data_path in (
                    ("rotationEuler", "rotation_euler"),
                    ("rotationQuaternion", "rotation_quaternion"),
                    ("rotationAxisAngle", "rotation_axis_angle"),
                )
                if argument_name in pose
            )
            if len(rotation_channels) != 1:
                return None
            channels = [rotation_channels[0]]
            for argument_name in ("location", "scale"):
                if argument_name in pose:
                    channels.append((argument_name, argument_name, pose.get(argument_name)))
            for channel_order, (_argument_name, data_path, values) in enumerate(
                channels, start=1
            ):
                expected_components = (
                    4
                    if data_path in {"rotation_quaternion", "rotation_axis_angle"}
                    else 3
                )
                if (
                    not isinstance(values, list)
                    or len(values) != expected_components
                    or any(isinstance(value, bool) for value in values)
                    or not all(
                        isinstance(value, (int, float)) and math.isfinite(value)
                        for value in values
                    )
                ):
                    return None
                order += 1
                writes.append(
                    GuidedKeyframeInsertionWriteControl(
                        order=order,
                        frame_order=frame_order,
                        pose_order=pose_order,
                        channel_order=channel_order,
                        bone_name=bone_name,
                        data_path=data_path,
                        frame=frame,
                        accepted_values=tuple(float(value) for value in values),
                    )
                )
    if not writes:
        return None
    return GuidedKeyframeInsertionControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=tuple(writes),
    )


def _animation_property_control(
    operation: Any, action_arguments: Any
) -> GuidedAnimationPropertyControl | None:
    operation_id = getattr(operation, "operation_id", None)
    if operation_id not in {
        "projection.semantic.pose_animation.interpolation",
        "projection.semantic.pose_animation.extrapolation",
    } or not isinstance(action_arguments, dict):
        return None
    keyframes = action_arguments.get("keyframes")
    if not isinstance(keyframes, list):
        return None
    curves: dict[tuple[str, str, int], list[int]] = {}
    for keyframe in keyframes:
        if not isinstance(keyframe, dict):
            return None
        frame = keyframe.get("frame")
        poses = keyframe.get("poses")
        if isinstance(frame, bool) or not isinstance(frame, int) or not isinstance(poses, list):
            return None
        for pose in poses:
            if not isinstance(pose, dict):
                return None
            bone_name = pose.get("boneName")
            if not isinstance(bone_name, str) or not bone_name:
                return None
            rotation_channels = tuple(
                (data_path, pose.get(argument_name))
                for argument_name, data_path in (
                    ("rotationEuler", "rotation_euler"),
                    ("rotationQuaternion", "rotation_quaternion"),
                    ("rotationAxisAngle", "rotation_axis_angle"),
                )
                if argument_name in pose
            )
            if len(rotation_channels) != 1:
                return None
            channels = [rotation_channels[0]]
            for argument_name in ("location", "scale"):
                if argument_name in pose:
                    channels.append((argument_name, pose.get(argument_name)))
            for data_path, values in channels:
                expected_components = (
                    4
                    if data_path in {"rotation_quaternion", "rotation_axis_angle"}
                    else 3
                )
                if not isinstance(values, list) or len(values) != expected_components:
                    return None
                for component_index in range(expected_components):
                    curves.setdefault(
                        (bone_name, data_path, component_index), []
                    ).append(frame)
    argument_name = "interpolation" if operation_id.endswith("interpolation") else "extrapolation"
    accepted_value = action_arguments.get(argument_name)
    if not isinstance(accepted_value, str) or not accepted_value:
        return None
    writes = []
    for bone_name, data_path, component_index in curves:
        frames = curves[(bone_name, data_path, component_index)]
        if argument_name == "interpolation":
            for frame in frames:
                writes.append(
                    GuidedAnimationPropertyWriteControl(
                        order=len(writes) + 1,
                        bone_name=bone_name,
                        data_path=data_path,
                        component_index=component_index,
                        frame=frame,
                        property_name="Interpolation",
                        accepted_value=accepted_value,
                    )
                )
        else:
            writes.append(
                GuidedAnimationPropertyWriteControl(
                    order=len(writes) + 1,
                    bone_name=bone_name,
                    data_path=data_path,
                    component_index=component_index,
                    frame=None,
                    property_name="Extrapolation",
                    accepted_value=accepted_value,
                )
            )
    if not writes:
        return None
    return GuidedAnimationPropertyControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=tuple(writes),
    )


def _action_resource_mutation_control(
    operation: Any, action_arguments: Any
) -> GuidedActionResourceMutationControl | None:
    if not isinstance(action_arguments, dict):
        return None
    operation_id = getattr(operation, "operation_id", None)
    armature_id = action_arguments.get("armatureId")
    action_id = action_arguments.get("actionId")
    action_name = action_arguments.get("actionName")
    if (
        not isinstance(armature_id, str)
        or not armature_id
        or not isinstance(action_id, str)
        or not action_id
    ):
        return None
    if operation_id == "semantic.create_pose_action":
        writes = (
            GuidedActionResourceMutationWriteControl(
                1, f"ACTION RNA · {action_id} (managed pending Action)"
            ),
            GuidedActionResourceMutationWriteControl(
                2, f"BIND RNA · {armature_id} → {action_id}"
            ),
        )
    elif operation_id == "projection.semantic.pose_animation.action_name":
        if not isinstance(action_name, str) or not action_name:
            return None
        writes = (
            GuidedActionResourceMutationWriteControl(
                1, f"NAME RNA · managed pending Action → {action_name}"
            ),
        )
    else:
        return None
    return GuidedActionResourceMutationControl(
        ordinal=operation.ordinal,
        operation_id=operation.operation_id,
        label=operation.label,
        writes=writes,
    )


def guided_control_dock_model(
    step: Any,
    snapshot: Any,
    operation_run: Any = None,
) -> GuidedControlDockModel | None:
    """Resolve only reviewed, receipt-bound guided control recipes."""

    action = getattr(step, "action", None)
    recipe_id = getattr(snapshot, "recipe_id", None)
    action_name = getattr(action, "name", None)
    if (
        step is None
        or snapshot is None
        or getattr(snapshot, "step_id", None) != getattr(step, "id", None)
        or action is None
        or _REVIEWED_RECIPES.get(recipe_id) != action_name
    ):
        return None
    operation_execution_available = recipe_id in _REVIEWED_RECIPES
    vectors = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_vector_control(operation),)
            if control is not None
        )
        if recipe_id == TRANSFORM_GEOMETRY_RECIPE_ID
        else ()
    )
    scalars = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_scalar_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id == LIGHT_TRAILS_RECIPE_ID
        else ()
    )
    values = (
        tuple(
            control
            for operation in snapshot.operations
            for control in _guided_value_controls(operation)
        )
        if recipe_id
        in {
            POSE_ANIMATION_RECIPE_ID,
            ARMATURE_RECIPE_ID,
            SKIN_WEIGHTS_RECIPE_ID,
            SOLIDIFY_RECIPE_ID,
            BEVEL_MODIFIER_RECIPE_ID,
            SINGLE_MATERIAL_RECIPE_ID,
            MATERIAL_PALETTE_RECIPE_ID,
            SUBDIVISION_SURFACE_RECIPE_ID,
            EDIT_BEVEL_RECIPE_ID,
            EDIT_INSET_RECIPE_ID,
            EDIT_TRIANGULATE_RECIPE_ID,
            EDIT_EXTRUDE_REGION_RECIPE_ID,
            EDIT_POKE_RECIPE_ID,
            MIRROR_RECIPE_ID,
        }
        else ()
    )
    initializations = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_initialization_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id == LIGHT_TRAILS_RECIPE_ID
        else ()
    )
    structures = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_structure_control(operation),)
            if control is not None
        )
        if recipe_id == LIGHT_TRAILS_RECIPE_ID
        else ()
    )
    resources = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_resource_mutation_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id
        in {
            LIGHT_TRAILS_RECIPE_ID,
            ARMATURE_RECIPE_ID,
            SKIN_WEIGHTS_RECIPE_ID,
            SOLIDIFY_RECIPE_ID,
            BEVEL_MODIFIER_RECIPE_ID,
            SINGLE_MATERIAL_RECIPE_ID,
            MATERIAL_PALETTE_RECIPE_ID,
            SUBDIVISION_SURFACE_RECIPE_ID,
            EDIT_BEVEL_RECIPE_ID,
            EDIT_INSET_RECIPE_ID,
            EDIT_TRIANGULATE_RECIPE_ID,
            EDIT_EXTRUDE_REGION_RECIPE_ID,
            EDIT_POKE_RECIPE_ID,
            MIRROR_RECIPE_ID,
        }
        else ()
    )
    keyframe_insertions = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_keyframe_insertion_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id == POSE_ANIMATION_RECIPE_ID
        else ()
    )
    animation_properties = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_animation_property_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id == POSE_ANIMATION_RECIPE_ID
        else ()
    )
    action_resources = (
        tuple(
            control
            for operation in snapshot.operations
            for control in (_action_resource_mutation_control(operation, action.arguments),)
            if control is not None
        )
        if recipe_id == POSE_ANIMATION_RECIPE_ID
        else ()
    )
    connections = tuple(
        GuidedConnectionControl(
            ordinal=operation.ordinal,
            operation_id=operation.operation_id,
            label=operation.label,
            connection_text=(
                f"{operation.connection.from_node}.{operation.connection.from_socket} → "
                f"{operation.connection.to_node}.{operation.connection.to_socket}"
            ),
        )
        for operation in snapshot.operations
        if getattr(operation, "connection", None) is not None
    )
    if (
        not vectors
        and not scalars
        and not values
        and not initializations
        and not structures
        and not resources
        and not keyframe_insertions
        and not animation_properties
        and not action_resources
        and not connections
    ):
        return None
    completed_operations: tuple[tuple[int, str], ...] = ()
    execution_next_ordinal = 1
    run_id = ""
    if operation_run is not None:
        if (
            not operation_execution_available
            or getattr(operation_run, "status", None) != "in_progress"
            or getattr(operation_run, "step_id", None) != step.id
            or getattr(operation_run, "recipe_id", None) != snapshot.recipe_id
            or tuple(getattr(operation_run, "operation_ids", ()))
            != tuple(operation.operation_id for operation in snapshot.operations)
        ):
            return None
        run_id = operation_run.run_id
        execution_next_ordinal = operation_run.next_ordinal
        completed_operations = tuple(
            (receipt.ordinal, receipt.operation_id)
            for receipt in operation_run.operation_receipts
        )
    focused = getattr(snapshot, "focused_operation", None)
    if focused is None:
        focused = next(
            (
                operation
                for operation in snapshot.operations
                if operation.ordinal == snapshot.focused_ordinal
            ),
            None,
        )
    if focused is None:
        focused = snapshot.operations[0]
    return GuidedControlDockModel(
        step_id=step.id,
        recipe_id=recipe_id,
        action_name=action_name,
        cursor_token=snapshot.cursor_token,
        focused_ordinal=snapshot.focused_ordinal,
        focused_operation_id=focused.operation_id,
        focused_label=focused.label,
        operation_count=len(snapshot.operations),
        execution_next_ordinal=execution_next_ordinal,
        run_id=run_id,
        completed_operations=completed_operations,
        operation_execution_available=operation_execution_available,
        vectors=vectors,
        scalars=scalars,
        values=values,
        initializations=initializations,
        structures=structures,
        resources=resources,
        keyframe_insertions=keyframe_insertions,
        animation_properties=animation_properties,
        action_resources=action_resources,
        connections=connections,
    )


def draw_guided_control_dock(
    layout: Any,
    step: Any,
    snapshot: Any,
    wrap_text,
    *,
    operation_run: Any = None,
    native_targeting_supported: bool = False,
    receipt_available: bool = False,
) -> None:
    """Draw exact OperatingLine controls without claiming native-widget clicks."""

    model = guided_control_dock_model(step, snapshot, operation_run)
    if model is None:
        return
    box = layout.box()
    box.label(text="GUIDED CONTROL · OperatingLine-owned", icon="TOOL_SETTINGS")
    if model.operation_execution_available:
        wrap_text(
            box,
            "Editable values create a revision draft. Operation Execute advances the "
            "accepted leaf one verified instruction at a time.",
            icon="INFO",
        )
        execution = box.box()
        execution.label(
            text=(
                f"EXECUTION NEXT · {model.execution_next_ordinal:02d} / "
                f"{model.operation_count:02d}"
            ),
            icon="PLAY",
        )
        execute_row = execution.row(align=True)
        execute_row.enabled = model.focused_ordinal == model.execution_next_ordinal
        execute = execute_row.operator(
            "operating_line.execute_guided_geometry_operation",
            text=f"Execute {model.focused_ordinal:02d}  {model.focused_label}",
            icon="PLAY",
        )
        execute.step_id = model.step_id
        execute.operation_id = model.focused_operation_id
        execute.ordinal = model.focused_ordinal
        execute.cursor_token = model.cursor_token
        execute.run_id = model.run_id
        if model.completed_operations:
            history = execution.row(align=True)
            last_ordinal, last_operation_id = model.completed_operations[-1]
            back = history.operator(
                "operating_line.undo_guided_geometry_operation",
                text=f"Operation Back {last_ordinal:02d}",
                icon="LOOP_BACK",
            )
            back.step_id = model.step_id
            back.operation_id = last_operation_id
            back.ordinal = last_ordinal
            back.cursor_token = model.cursor_token
            back.run_id = model.run_id
            abort = history.operator(
                "operating_line.abort_guided_geometry_operations",
                text="Abort 01–N",
                icon="CANCEL",
            )
            abort.step_id = model.step_id
            abort.cursor_token = model.cursor_token
            abort.run_id = model.run_id
        if model.focused_ordinal != model.execution_next_ordinal:
            wrap_text(
                execution,
                f"Browse to instruction {model.execution_next_ordinal:02d} before execution",
                icon="LOCKED",
            )
    for control in model.vectors:
        row = box.row(align=True)
        row.label(text=f"{control.ordinal:02d}  {control.argument_name.title()}")
        edit = row.operator(
            "operating_line.edit_guided_geometry_parameter",
            text=control.display_value,
            icon="GREASEPENCIL",
        )
        edit.step_id = model.step_id
        edit.operation_id = control.operation_id
        edit.ordinal = control.ordinal
        edit.cursor_token = model.cursor_token
        for component_index, (axis, accepted_value) in enumerate(
            zip("XYZ", control.value, strict=True)
        ):
            component_row = box.row(align=True)
            component_row.label(
                text=f"{control.ordinal:02d}.{component_index + 1:02d}  {axis}"
            )
            component_row.label(text=f"Accepted {accepted_value:.9g}")
            if native_targeting_supported and receipt_available:
                native_row = component_row.row(align=True)
                native_row.enabled = control.ordinal == model.focused_ordinal
                highlight = native_row.operator(
                    "operating_line.highlight_guided_geometry_parameter",
                    text="EXACT NATIVE",
                    icon="RESTRICT_SELECT_OFF",
                )
                highlight.step_id = model.step_id
                highlight.operation_id = control.operation_id
                highlight.ordinal = control.ordinal
                highlight.cursor_token = model.cursor_token
                highlight.argument_name = control.argument_name
                highlight.component_index = component_index
                highlight.write_order = 1
    for control in model.scalars:
        row = box.row(align=True)
        row.label(text=f"{control.ordinal:02d}  {control.label}")
        edit = row.operator(
            "operating_line.edit_guided_geometry_parameter",
            text=control.display_value,
            icon="GREASEPENCIL",
        )
        edit.step_id = model.step_id
        edit.operation_id = control.operation_id
        edit.ordinal = control.ordinal
        edit.cursor_token = model.cursor_token
        for write in control.writes:
            write_row = box.row(align=True)
            write_row.label(
                text=(
                    f"{control.ordinal:02d}.{write.order:02d}  "
                    f"{write.node_name} · {write.socket_identifier}.{write.component_label}"
                )
            )
            write_row.label(text=f"Applied {write.projected_value:.9g}")
            if native_targeting_supported and receipt_available:
                native_row = write_row.row(align=True)
                native_row.enabled = control.ordinal == model.focused_ordinal
                highlight = native_row.operator(
                    "operating_line.highlight_guided_geometry_parameter",
                    text="EXACT NATIVE",
                    icon="RESTRICT_SELECT_OFF",
                )
                highlight.step_id = model.step_id
                highlight.operation_id = control.operation_id
                highlight.ordinal = control.ordinal
                highlight.cursor_token = model.cursor_token
                highlight.argument_name = control.argument_name
                highlight.component_index = write.component_index
                highlight.write_order = write.order
    for control in model.values:
        value_box = box.box()
        value_box.label(
            text=f"{control.ordinal:02d}  {control.argument_name}",
            icon="KEYFRAME_HLT",
        )
        wrap_text(value_box, control.display_value)
    for control in model.resources:
        if control.ordinal != model.focused_ordinal:
            continue
        resource_box = box.box()
        resource_box.label(
            text=f"{control.ordinal:02d}  {control.heading} · {control.label}",
            icon="RNA",
        )
        for write in control.writes:
            resource_box.label(
                text=f"{control.ordinal:02d}.{write.order:02d}  {write.label}"
            )
    for control in model.keyframe_insertions:
        if control.ordinal != model.focused_ordinal:
            continue
        keyframe_box = box.box()
        keyframe_box.label(
            text=f"{control.ordinal:02d}  KEYFRAME RNA · {control.label}",
            icon="KEYFRAME_HLT",
        )
        for write in control.writes:
            write_row = keyframe_box.row(align=True)
            write_row.label(
                text=(
                    f"{control.ordinal:02d}.{write.order:02d}  {write.bone_name} · "
                    f"{write.data_path} · Frame {write.frame}"
                )
            )
            write_row.label(
                text="Accepted " + ", ".join(f"{value:.9g}" for value in write.accepted_values)
            )
    for control in model.animation_properties:
        if control.ordinal != model.focused_ordinal:
            continue
        property_box = box.box()
        property_box.label(
            text=f"{control.ordinal:02d}  ANIMATION RNA · {control.label}",
            icon="KEYFRAME_HLT",
        )
        for write in control.writes:
            frame = "" if write.frame is None else f" · Frame {write.frame}"
            property_box.label(
                text=(
                    f"{control.ordinal:02d}.{write.order:02d}  {write.bone_name} · "
                    f"{write.data_path}[{write.component_index}]{frame} · "
                    f"{write.property_name} = {write.accepted_value}"
                )
            )
    for control in model.action_resources:
        if control.ordinal != model.focused_ordinal:
            continue
        action_box = box.box()
        action_box.label(
            text=f"{control.ordinal:02d}  ACTION RESOURCE RNA · {control.label}",
            icon="KEYFRAME_HLT",
        )
        for write in control.writes:
            action_box.label(
                text=f"{control.ordinal:02d}.{write.order:02d}  {write.label}"
            )
    for control in model.structures:
        if control.ordinal != model.focused_ordinal:
            continue
        structure_box = box.box()
        structure_box.label(
            text=f"{control.ordinal:02d}  STRUCTURE RNA · {control.label}",
            icon="NODETREE",
        )
        for write in control.writes:
            structure_box.label(
                text=(
                    f"{control.ordinal:02d}.{write.order:02d}  "
                    f"{write.display_target}"
                )
            )
    for control in model.initializations:
        if control.ordinal != model.focused_ordinal:
            continue
        setup_box = box.box()
        setup_box.label(
            text=f"{control.ordinal:02d}  INITIAL RNA · {control.label}",
            icon="NODETREE",
        )
        for write in control.writes:
            write_row = setup_box.row(align=True)
            write_row.label(
                text=f"{control.ordinal:02d}.{write.order:02d}  {write.display_target}"
            )
            assigned = write.assigned_value
            write_row.label(
                text=(
                    f"Assigned {assigned:.9g}"
                    if isinstance(assigned, (int, float))
                    else f"Assigned {assigned}"
                )
            )
    for control in model.connections:
        if (
            not model.operation_execution_available
            and control.ordinal != model.focused_ordinal
        ):
            continue
        row = box.row(align=True)
        if model.operation_execution_available:
            row.enabled = (
                control.ordinal == model.focused_ordinal
                and control.ordinal == model.execution_next_ordinal
            )
            proxy = row.operator(
                "operating_line.execute_guided_geometry_operation",
                text=f"{control.ordinal:02d}  Execute: {control.label}",
                icon="NODETREE",
            )
            proxy.step_id = model.step_id
            proxy.operation_id = control.operation_id
            proxy.ordinal = control.ordinal
            proxy.cursor_token = model.cursor_token
            proxy.run_id = model.run_id
        else:
            row.label(text=f"{control.ordinal:02d}  {control.label}", icon="NODETREE")
        if (
            model.recipe_id == LIGHT_TRAILS_RECIPE_ID
            and 35 <= control.ordinal <= 53
            and control.ordinal == model.focused_ordinal
        ):
            box.label(
                text=(
                    f"{control.ordinal:02d}.01  LINK RNA · "
                    f"{control.connection_text}"
                ),
                icon="NODETREE",
            )
        wrap_text(box, control.connection_text)
    if model.operation_execution_available:
        atomic_row = box.row()
        atomic_row.enabled = not bool(model.run_id)
        execute = atomic_row.operator(
            "operating_line.execute_guided_geometry_leaf",
            text="Execute accepted leaf atomically",
            icon="PLAY",
        )
        execute.step_id = model.step_id
        execute.operation_id = ""
        execute.ordinal = 0
        execute.cursor_token = model.cursor_token
        if model.run_id:
            wrap_text(
                box,
                "Atomic execution is locked until the operation run completes or aborts",
                icon="LOCKED",
            )
    if not native_targeting_supported:
        wrap_text(
            box,
            "EXACT NATIVE unavailable in this Blender; Guided Control remains active",
            icon="INFO",
        )
    elif not receipt_available:
        wrap_text(
            box,
            "EXACT NATIVE activates when recovery keeps this receipt-bound leaf current and its tree is visible",
            icon="INFO",
        )


__all__ = [
    "ARMATURE_ACTION_NAME",
    "ARMATURE_RECIPE_ID",
    "EDIT_BEVEL_ACTION_NAME",
    "EDIT_BEVEL_RECIPE_ID",
    "EDIT_EXTRUDE_REGION_ACTION_NAME",
    "EDIT_EXTRUDE_REGION_RECIPE_ID",
    "EDIT_INSET_ACTION_NAME",
    "EDIT_INSET_RECIPE_ID",
    "EDIT_TRIANGULATE_ACTION_NAME",
    "EDIT_TRIANGULATE_RECIPE_ID",
    "EDIT_POKE_ACTION_NAME",
    "EDIT_POKE_RECIPE_ID",
    "GuidedConnectionControl",
    "GuidedControlDockModel",
    "GuidedAnimationPropertyControl",
    "GuidedAnimationPropertyWriteControl",
    "GuidedActionResourceMutationControl",
    "GuidedActionResourceMutationWriteControl",
    "GuidedInitializationControl",
    "GuidedInitializationWriteControl",
    "GuidedKeyframeInsertionControl",
    "GuidedKeyframeInsertionWriteControl",
    "GuidedScalarControl",
    "GuidedScalarWriteControl",
    "GuidedResourceMutationControl",
    "GuidedResourceMutationWriteControl",
    "GuidedStructureControl",
    "GuidedStructureWriteControl",
    "GuidedVectorControl",
    "GuidedValueControl",
    "BEVEL_MODIFIER_ACTION_NAME",
    "BEVEL_MODIFIER_RECIPE_ID",
    "BEVEL_MODIFIER_RNA_PROPERTY_SPECS",
    "SINGLE_MATERIAL_ACTION_NAME",
    "SINGLE_MATERIAL_RECIPE_ID",
    "MATERIAL_PALETTE_ACTION_NAME",
    "MATERIAL_PALETTE_RECIPE_ID",
    "LIGHT_TRAILS_ACTION_NAME",
    "LIGHT_TRAILS_RECIPE_ID",
    "LIGHT_TRAILS_RNA_INITIALIZATION_TARGETS_BY_OPERATION",
    "LIGHT_TRAILS_RNA_STRUCTURE_TARGETS_BY_OPERATION",
    "LIGHT_TRAILS_RNA_WRITE_TARGETS",
    "MIRROR_ACTION_NAME",
    "MIRROR_RECIPE_ID",
    "MIRROR_RNA_PROPERTY_SPECS",
    "POSE_ANIMATION_ACTION_NAME",
    "POSE_ANIMATION_RECIPE_ID",
    "SKIN_WEIGHTS_ACTION_NAME",
    "SKIN_WEIGHTS_RECIPE_ID",
    "SOLIDIFY_ACTION_NAME",
    "SOLIDIFY_RECIPE_ID",
    "SOLIDIFY_RNA_PROPERTY_SPECS",
    "SUBDIVISION_SURFACE_ACTION_NAME",
    "SUBDIVISION_SURFACE_RECIPE_ID",
    "SUBDIVISION_SURFACE_RNA_PROPERTY_SPECS",
    "TRANSFORM_GEOMETRY_ACTION_NAME",
    "TRANSFORM_GEOMETRY_RECIPE_ID",
    "draw_guided_control_dock",
    "guided_control_dock_model",
]
