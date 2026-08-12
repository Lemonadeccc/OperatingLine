"""Bounded mesh-edit, modifier, and Geometry Nodes actions."""

from collections.abc import Mapping
from dataclasses import dataclass
from math import pi
from typing import Any

import bmesh
import bpy

from ...application import ActionReceipt
from ...application.session import MutationRecord, ResourceIdentity
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


@dataclass(frozen=True, slots=True)
class SubdivideDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    cuts: int
    smooth: float


@dataclass(frozen=True, slots=True)
class BevelModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    width: float
    segments: int
    angle_limit: float


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
