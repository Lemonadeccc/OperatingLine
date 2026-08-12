"""Bounded mesh-edit, modifier, and Geometry Nodes actions."""

from collections.abc import Mapping
from dataclasses import dataclass
from math import pi
from typing import Any

import bmesh
import bpy

from ...application import ActionReceipt
from ...application.session import ModifierState, MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    build_resource_registry,
    ensure_logical_ids_available,
    ensure_modifier_id_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    logical_id,
    make_receipt,
    mesh_content_signature,
    new_receipt_id,
    node_tree_signature,
    number,
    owned_resource,
    require_keys,
    resolve_resource,
    rollback_partial,
    snapshot_modifier,
    tag_resource,
    text,
    vector,
)

MAX_SOLIDIFY_VERTICES = 8192
MAX_SOLIDIFY_EDGES = 16384
MAX_SOLIDIFY_POLYGONS = 8192
MAX_TRIANGULATE_VERTICES = 8192
MAX_TRIANGULATE_EDGES = 16384
MAX_TRIANGULATE_POLYGONS = 8192


@dataclass(frozen=True, slots=True)
class SubdivideDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    cuts: int
    smooth: float


@dataclass(frozen=True, slots=True)
class TriangulateDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str


@dataclass(frozen=True, slots=True)
class BevelModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    width: float
    segments: int
    angle_limit: float


@dataclass(frozen=True, slots=True)
class SolidifyModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    thickness: float
    offset: float


@dataclass(frozen=True, slots=True)
class GeometryNodesTransformDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    node_group_id: str
    node_group_name: str
    translation: tuple[float, float, float]
    rotation: tuple[float, float, float]
    scale: tuple[float, float, float]


def validate_subdivide(arguments: Mapping[str, Any]) -> SubdivideDefinition:
    fields = {"targetId", "resultMeshId", "resultMeshName", "cuts", "smooth"}
    require_keys(arguments, fields, fields, "arguments")
    return SubdivideDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
            prefix="OperatingLine.",
        ),
        cuts=integer(arguments["cuts"], "arguments.cuts", minimum=1, maximum=8),
        smooth=number(
            arguments["smooth"],
            "arguments.smooth",
            minimum=0.0,
            maximum=1.0,
        ),
    )


def validate_triangulate(arguments: Mapping[str, Any]) -> TriangulateDefinition:
    fields = {"targetId", "resultMeshId", "resultMeshName"}
    require_keys(arguments, fields, fields, "arguments")
    return TriangulateDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
            prefix="OperatingLine.",
        ),
    )


def validate_bevel(arguments: Mapping[str, Any]) -> BevelModifierDefinition:
    fields = {
        "targetId",
        "modifierId",
        "modifierName",
        "width",
        "segments",
        "angleLimit",
    }
    require_keys(arguments, fields, fields, "arguments")
    return BevelModifierDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        width=number(
            arguments["width"],
            "arguments.width",
            minimum=0.0001,
            maximum=100.0,
        ),
        segments=integer(
            arguments["segments"],
            "arguments.segments",
            minimum=1,
            maximum=16,
        ),
        angle_limit=number(
            arguments["angleLimit"],
            "arguments.angleLimit",
            minimum=0.0,
            maximum=pi,
        ),
    )


def validate_solidify(arguments: Mapping[str, Any]) -> SolidifyModifierDefinition:
    fields = {
        "targetId",
        "modifierId",
        "modifierName",
        "thickness",
        "offset",
    }
    require_keys(arguments, fields, fields, "arguments")
    return SolidifyModifierDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        thickness=number(
            arguments["thickness"],
            "arguments.thickness",
            minimum=0.0001,
            maximum=100.0,
        ),
        offset=number(
            arguments["offset"],
            "arguments.offset",
            minimum=-1.0,
            maximum=1.0,
        ),
    )


def validate_geometry_nodes_transform(
    arguments: Mapping[str, Any],
) -> GeometryNodesTransformDefinition:
    fields = {
        "targetId",
        "modifierId",
        "modifierName",
        "nodeGroupId",
        "nodeGroupName",
        "translation",
        "rotation",
        "scale",
    }
    require_keys(arguments, fields, fields, "arguments")
    scale = vector(
        arguments["scale"],
        "arguments.scale",
        3,
        minimum=0.0001,
        maximum=1000.0,
    )
    return GeometryNodesTransformDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        node_group_id=logical_id(
            arguments["nodeGroupId"], "arguments.nodeGroupId"
        ),
        node_group_name=text(
            arguments["nodeGroupName"],
            "arguments.nodeGroupName",
            prefix="OperatingLine.",
        ),
        translation=vector(
            arguments["translation"],
            "arguments.translation",
            3,
            minimum=-1000.0,
            maximum=1000.0,
        ),
        rotation=vector(
            arguments["rotation"],
            "arguments.rotation",
            3,
            minimum=-pi * 2.0,
            maximum=pi * 2.0,
        ),
        scale=scale,
    )


def _owned_mesh_target(
    registry: Mapping[str, ResourceIdentity], target_id: str
) -> tuple[ResourceIdentity, bpy.types.Object, ResourceIdentity]:
    target_identity, target = owned_resource(registry, target_id, "OBJECT")
    if not isinstance(target, bpy.types.Object) or target.type != "MESH":
        raise ValueError(f"Owned target is not a mesh object: {target_id}")
    mesh_identity = next(
        (
            identity
            for identity in registry.values()
            if identity.resource_type == "MESH"
            and resolve_resource(identity) is target.data
        ),
        None,
    )
    if mesh_identity is None:
        raise RuntimeError(f"Owned mesh data is unavailable: {target_id}")
    return target_identity, target, mesh_identity


def _tracked_modifier_pointers(
    receipts: Mapping[str, ActionReceipt], target: bpy.types.Object
) -> set[int]:
    return {
        mutation.after.pointer
        for receipt in receipts.values()
        for mutation in receipt.mutations
        if isinstance(mutation.after, ModifierState)
        and resolve_resource(mutation.resource) is target
    }


def _ensure_solidify_input_is_bounded(
    receipts: Mapping[str, ActionReceipt], target: bpy.types.Object
) -> None:
    tracked_pointers = _tracked_modifier_pointers(receipts, target)
    untracked = tuple(
        modifier.name
        for modifier in target.modifiers
        if modifier.as_pointer() not in tracked_pointers
    )
    if untracked:
        raise RuntimeError(
            "Solidify target has untracked existing modifiers: " + ", ".join(untracked)
        )

    source_topology = (
        len(target.data.vertices),
        len(target.data.edges),
        len(target.data.polygons),
    )
    topology_limits = (
        MAX_SOLIDIFY_VERTICES,
        MAX_SOLIDIFY_EDGES,
        MAX_SOLIDIFY_POLYGONS,
    )
    if any(
        actual > limit for actual, limit in zip(source_topology, topology_limits)
    ):
        raise ValueError(
            "Solidify target exceeds the supported topology limits: "
            f"vertices <= {MAX_SOLIDIFY_VERTICES}, "
            f"edges <= {MAX_SOLIDIFY_EDGES}, "
            f"polygons <= {MAX_SOLIDIFY_POLYGONS}"
        )

    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.data
    if not isinstance(evaluated_mesh, bpy.types.Mesh):
        raise RuntimeError("Solidify target did not evaluate to mesh geometry")
    evaluated_topology = (
        len(evaluated_mesh.vertices),
        len(evaluated_mesh.edges),
        len(evaluated_mesh.polygons),
    )
    if any(
        actual > limit for actual, limit in zip(evaluated_topology, topology_limits)
    ):
        raise ValueError(
            "Solidify evaluated input exceeds the supported topology limits: "
            f"vertices <= {MAX_SOLIDIFY_VERTICES}, "
            f"edges <= {MAX_SOLIDIFY_EDGES}, "
            f"polygons <= {MAX_SOLIDIFY_POLYGONS}"
        )


def execute_subdivide(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: SubdivideDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    ensure_logical_ids_available(registry, (definition.result_mesh_id,))
    ensure_name_available(bpy.data.meshes, definition.result_mesh_name, "mesh")
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        result_mesh = target.data.copy()
        result_mesh.name = definition.result_mesh_name
        result_identity = tag_resource(
            result_mesh,
            definition.result_mesh_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(result_identity)
        bm = bmesh.new()
        try:
            bm.from_mesh(result_mesh)
            bmesh.ops.subdivide_edges(
                bm,
                edges=tuple(bm.edges),
                cuts=definition.cuts,
                smooth=definition.smooth,
                use_grid_fill=True,
            )
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        target.data = result_mesh
        mutations.append(
            MutationRecord(
                target_identity,
                "data",
                source_mesh_identity,
                result_identity,
            )
        )
        mutations.append(
            MutationRecord(
                result_identity,
                "mesh_content",
                None,
                mesh_content_signature(result_mesh),
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            target_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise


def _ensure_triangulate_topology_is_bounded(
    topology: tuple[int, int, int], label: str
) -> None:
    limits = (
        MAX_TRIANGULATE_VERTICES,
        MAX_TRIANGULATE_EDGES,
        MAX_TRIANGULATE_POLYGONS,
    )
    if any(actual > limit for actual, limit in zip(topology, limits)):
        raise ValueError(
            f"Triangulate {label} exceeds the supported topology limits: "
            f"vertices <= {MAX_TRIANGULATE_VERTICES}, "
            f"edges <= {MAX_TRIANGULATE_EDGES}, "
            f"polygons <= {MAX_TRIANGULATE_POLYGONS}"
        )


def execute_triangulate(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: TriangulateDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    if target.mode != "OBJECT":
        raise RuntimeError("Triangulate target must be in Object Mode")
    if target.modifiers:
        raise RuntimeError("Triangulate target must not have modifiers")
    if target.data.shape_keys is not None:
        raise RuntimeError("Triangulate target must not have shape keys")
    source_topology = (
        len(target.data.vertices),
        len(target.data.edges),
        len(target.data.polygons),
    )
    _ensure_triangulate_topology_is_bounded(source_topology, "source")
    if not any(len(polygon.vertices) != 3 for polygon in target.data.polygons):
        raise ValueError("Triangulate target must contain at least one non-triangle face")
    ensure_logical_ids_available(registry, (definition.result_mesh_id,))
    ensure_name_available(bpy.data.meshes, definition.result_mesh_name, "mesh")

    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        result_mesh = target.data.copy()
        result_mesh.name = definition.result_mesh_name
        result_identity = tag_resource(
            result_mesh,
            definition.result_mesh_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(result_identity)
        bm = bmesh.new()
        try:
            bm.from_mesh(result_mesh)
            bmesh.ops.triangulate(
                bm,
                faces=tuple(bm.faces),
                quad_method="FIXED",
                ngon_method="EAR_CLIP",
            )
            predicted_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
            _ensure_triangulate_topology_is_bounded(predicted_topology, "result")
            if not bm.faces or any(len(face.verts) != 3 for face in bm.faces):
                raise RuntimeError("Triangulate did not produce only triangle faces")
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        actual_topology = (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        _ensure_triangulate_topology_is_bounded(actual_topology, "actual result")
        if not result_mesh.polygons or any(
            len(polygon.vertices) != 3 for polygon in result_mesh.polygons
        ):
            raise RuntimeError("Triangulate actual result is not fully triangular")
        target.data = result_mesh
        mutations.append(
            MutationRecord(
                target_identity,
                "data",
                source_mesh_identity,
                result_identity,
            )
        )
        mutations.append(
            MutationRecord(
                result_identity,
                "mesh_content",
                None,
                mesh_content_signature(result_mesh),
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            target_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise


def execute_bevel(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: BevelModifierDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, _mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    ensure_modifier_id_available(receipts, definition.modifier_id)
    if target.modifiers.get(definition.modifier_name) is not None:
        raise RuntimeError(
            f"Cannot replace existing modifier: {definition.modifier_name}"
        )
    receipt_id = new_receipt_id()
    mutations: list[MutationRecord] = []
    modifier = None
    try:
        modifier = target.modifiers.new(definition.modifier_name, "BEVEL")
        modifier.width = definition.width
        modifier.segments = definition.segments
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = definition.angle_limit
        state = snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
            {},
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"modifier:{definition.modifier_id}",
                None,
                state,
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            [],
            mutations,
            [],
            target_identity,
        )
    except Exception:
        if modifier is not None and not mutations:
            target.modifiers.remove(modifier)
        rollback_partial(receipt_id, step_id, action.name, [], mutations, [])
        raise


def execute_solidify(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: SolidifyModifierDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, _mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    _ensure_solidify_input_is_bounded(receipts, target)
    ensure_modifier_id_available(receipts, definition.modifier_id)
    if target.modifiers.get(definition.modifier_name) is not None:
        raise RuntimeError(
            f"Cannot replace existing modifier: {definition.modifier_name}"
        )
    receipt_id = new_receipt_id()
    mutations: list[MutationRecord] = []
    modifier = None
    try:
        modifier = target.modifiers.new(definition.modifier_name, "SOLIDIFY")
        modifier.solidify_mode = "EXTRUDE"
        modifier.thickness = definition.thickness
        modifier.thickness_clamp = 0.0
        modifier.use_thickness_angle_clamp = False
        modifier.thickness_vertex_group = 0.0
        modifier.offset = definition.offset
        modifier.edge_crease_inner = 0.0
        modifier.edge_crease_outer = 0.0
        modifier.edge_crease_rim = 0.0
        modifier.material_offset = 0
        modifier.material_offset_rim = 0
        modifier.vertex_group = ""
        modifier.shell_vertex_group = ""
        modifier.rim_vertex_group = ""
        modifier.use_even_offset = True
        modifier.use_rim = True
        modifier.use_rim_only = False
        modifier.use_quality_normals = False
        modifier.invert_vertex_group = False
        modifier.use_flat_faces = False
        modifier.use_flip_normals = False
        modifier.nonmanifold_thickness_mode = "CONSTRAINTS"
        modifier.nonmanifold_boundary_mode = "NONE"
        modifier.nonmanifold_merge_threshold = 0.0001
        modifier.bevel_convex = 0.0
        state = snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
            {},
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"modifier:{definition.modifier_id}",
                None,
                state,
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            [],
            mutations,
            [],
            target_identity,
        )
    except Exception:
        if modifier is not None and not mutations:
            target.modifiers.remove(modifier)
        rollback_partial(receipt_id, step_id, action.name, [], mutations, [])
        raise


def _socket(sockets: Any, identifier: str) -> Any:
    matches = tuple(socket for socket in sockets if socket.identifier == identifier)
    if len(matches) != 1:
        raise RuntimeError(
            f"Geometry Nodes socket {identifier!r} must be unique; found {len(matches)}"
        )
    return matches[0]


def execute_geometry_nodes_transform(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: GeometryNodesTransformDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, _mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    ensure_logical_ids_available(registry, (definition.node_group_id,))
    ensure_modifier_id_available(receipts, definition.modifier_id)
    ensure_name_available(
        bpy.data.node_groups, definition.node_group_name, "node group"
    )
    if target.modifiers.get(definition.modifier_name) is not None:
        raise RuntimeError(
            f"Cannot replace existing modifier: {definition.modifier_name}"
        )
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    modifier = None
    try:
        node_group = bpy.data.node_groups.new(
            definition.node_group_name, "GeometryNodeTree"
        )
        node_group_identity = tag_resource(
            node_group,
            definition.node_group_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(node_group_identity)
        group_input_interface = node_group.interface.new_socket(
            name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry"
        )
        group_output_interface = node_group.interface.new_socket(
            name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry"
        )
        input_node = node_group.nodes.new("NodeGroupInput")
        input_node.name = "OperatingLine Input"
        transform_node = node_group.nodes.new("GeometryNodeTransform")
        transform_node.name = "OperatingLine Transform"
        output_node = node_group.nodes.new("NodeGroupOutput")
        output_node.name = "OperatingLine Output"
        _socket(transform_node.inputs, "Translation").default_value = (
            definition.translation
        )
        _socket(transform_node.inputs, "Rotation").default_value = definition.rotation
        _socket(transform_node.inputs, "Scale").default_value = definition.scale
        node_group.links.new(
            _socket(input_node.outputs, group_input_interface.identifier),
            _socket(transform_node.inputs, "Geometry"),
        )
        node_group.links.new(
            _socket(transform_node.outputs, "Geometry"),
            _socket(output_node.inputs, group_output_interface.identifier),
        )

        modifier = target.modifiers.new(definition.modifier_name, "NODES")
        modifier.node_group = node_group
        modifier_state = snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
            {
                "node_group": node_group_identity,
            },
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"modifier:{definition.modifier_id}",
                None,
                modifier_state,
            )
        )
        mutations.append(
            MutationRecord(
                node_group_identity,
                "node_tree_signature",
                None,
                node_tree_signature(node_group),
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            target_identity,
        )
    except Exception:
        if modifier is not None and not mutations:
            target.modifiers.remove(modifier)
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise
