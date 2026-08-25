"""Operation-level execution for the bounded no-bake Light Trails guide leaf.

The whole-action executor remains available for atomic MCP replay.  This module
materializes the same final graph as fifty-four strictly ordered local guidance
operations so Blender can expose a truthful 01 -> 54 execution rail with one
native-history checkpoint, observation, and inverse transition per operation.
"""

from __future__ import annotations

from dataclasses import replace
import hashlib
import math
from types import SimpleNamespace
from typing import Any, Mapping

from .guided_geometry_operations import (
    GuidedGeometryAtomicityError,
    GuidedGeometryOperationResult,
    GuidedGeometryTransaction,
)


LIGHT_TRAILS_ACTION = "blender.geometry_nodes.create_light_trails"

LIGHT_TRAILS_OPERATION_IDS = (
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

_NODE_OPERATIONS = {
    3: ("NodeGroupInput", "OperatingLine Input"),
    4: ("GeometryNodeCurvePrimitiveLine", "OperatingLine Half Tile Line"),
    6: ("GeometryNodeResampleCurve", "OperatingLine Trail Resolution"),
    8: ("GeometryNodeMeshLine", "OperatingLine Trail Rows"),
    11: ("GeometryNodeInstanceOnPoints", "OperatingLine Trail Instances"),
    12: ("GeometryNodeRealizeInstances", "OperatingLine Realize Trails"),
    13: ("GeometryNodeInputPosition", "OperatingLine Trail Position"),
    14: ("ShaderNodeTexNoise", "OperatingLine Terrain Noise"),
    19: ("ShaderNodeMath", "OperatingLine Center Noise"),
    20: ("ShaderNodeMath", "OperatingLine Scale Height"),
    22: ("ShaderNodeCombineXYZ", "OperatingLine Z Offset"),
    23: ("GeometryNodeSetPosition", "OperatingLine Displace Trails"),
    24: ("GeometryNodeTransform", "OperatingLine Mirror Half Tile"),
    25: ("GeometryNodeJoinGeometry", "OperatingLine Mirrored Tile"),
    26: ("GeometryNodeCurvePrimitiveCircle", "OperatingLine Trail Profile"),
    29: ("GeometryNodeCurveToMesh", "OperatingLine Curve To Mesh"),
    30: ("GeometryNodeMeshLine", "OperatingLine Loop Tiles"),
    32: ("GeometryNodeInstanceOnPoints", "OperatingLine Tile Instances"),
    33: ("GeometryNodeRealizeInstances", "OperatingLine Realize Tiles"),
    34: ("NodeGroupOutput", "OperatingLine Output"),
}

_LINK_OPERATIONS = {
    35: ("OperatingLine Half Tile Line", "Curve", "OperatingLine Trail Resolution", "Curve"),
    36: ("OperatingLine Trail Rows", "Mesh", "OperatingLine Trail Instances", "Points"),
    37: ("OperatingLine Trail Resolution", "Curve", "OperatingLine Trail Instances", "Instance"),
    38: ("OperatingLine Trail Instances", "Instances", "OperatingLine Realize Trails", "Geometry"),
    39: ("OperatingLine Trail Position", "Position", "OperatingLine Terrain Noise", "Vector"),
    40: ("OperatingLine Terrain Noise", "Fac", "OperatingLine Center Noise", "Value"),
    41: ("OperatingLine Center Noise", "Value", "OperatingLine Scale Height", "Value"),
    42: ("OperatingLine Scale Height", "Value", "OperatingLine Z Offset", "Z"),
    43: ("OperatingLine Realize Trails", "Geometry", "OperatingLine Displace Trails", "Geometry"),
    44: ("OperatingLine Z Offset", "Vector", "OperatingLine Displace Trails", "Offset"),
    45: (
        "OperatingLine Displace Trails",
        "Geometry",
        "OperatingLine Mirror Half Tile",
        "Geometry",
    ),
    46: ("OperatingLine Displace Trails", "Geometry", "OperatingLine Mirrored Tile", "Geometry"),
    47: ("OperatingLine Mirror Half Tile", "Geometry", "OperatingLine Mirrored Tile", "Geometry"),
    48: ("OperatingLine Mirrored Tile", "Geometry", "OperatingLine Curve To Mesh", "Curve"),
    49: ("OperatingLine Trail Profile", "Curve", "OperatingLine Curve To Mesh", "Profile Curve"),
    50: ("OperatingLine Loop Tiles", "Mesh", "OperatingLine Tile Instances", "Points"),
    51: ("OperatingLine Curve To Mesh", "Mesh", "OperatingLine Tile Instances", "Instance"),
    52: ("OperatingLine Tile Instances", "Instances", "OperatingLine Realize Tiles", "Geometry"),
    53: ("OperatingLine Realize Tiles", "Geometry", "OperatingLine Output", "Geometry"),
}

_DEFAULT_TILE_LENGTH = 1.0
_DEFAULT_POINTS_PER_TRAIL = 10
_DEFAULT_TRAIL_COUNT = 1
_DEFAULT_TRAIL_SPACING = 1.0
_DEFAULT_NOISE_SCALE = 1.0
_DEFAULT_NOISE_DETAIL = 2.0
_DEFAULT_NOISE_ROUGHNESS = 0.5
_DEFAULT_NOISE_SEED = 0.0
_DEFAULT_HEIGHT = 0.0
_DEFAULT_PROFILE_SIDES = 3
_DEFAULT_PROFILE_RADIUS = 0.1
_DEFAULT_TILE_REPEAT_COUNT = 1
_LIGHT_TRAILS_EXECUTE_TOOL = (
    "operatingline.blender.geometry-nodes.light-trails.execute-next"
)
_VECTOR_COMPONENT_LABELS = ("X", "Y", "Z")


def _dependencies() -> SimpleNamespace:
    from ..application.session import ModifierState, MutationRecord
    from .snowman_actions.common import (
        build_resource_registry,
        ensure_logical_ids_available,
        ensure_modifier_id_available,
        ensure_name_available,
        ensure_receipts_intact,
        make_receipt,
        node_tree_semantic_signature,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
        snapshot_modifier,
        tag_resource,
    )

    return SimpleNamespace(
        ModifierState=ModifierState,
        MutationRecord=MutationRecord,
        build_resource_registry=build_resource_registry,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_modifier_id_available=ensure_modifier_id_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        make_receipt=make_receipt,
        node_tree_semantic_signature=node_tree_semantic_signature,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
        snapshot_modifier=snapshot_modifier,
        tag_resource=tag_resource,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definition: Any) -> str:
    return _digest(
        (
            definition.target_id,
            definition.modifier_id,
            definition.modifier_name,
            definition.node_group_id,
            definition.node_group_name,
            definition.trail_count,
            definition.points_per_trail,
            definition.tile_length,
            definition.trail_spacing,
            definition.noise_scale,
            definition.noise_detail,
            definition.noise_roughness,
            definition.noise_seed,
            definition.height,
            definition.profile_sides,
            definition.profile_radius,
            definition.tile_repeat_count,
        )
    )


def _socket(sockets: Any, identifier: str) -> Any:
    matches = tuple(
        socket
        for socket in sockets
        if getattr(socket, "identifier", None) == identifier
    )
    if not matches:
        matches = tuple(
            socket
            for socket in sockets
            if getattr(socket, "name", None) == identifier
        )
    if len(matches) != 1:
        raise RuntimeError(
            f"Light Trails socket {identifier!r} must be unique; found {len(matches)}"
        )
    return matches[0]


def _interface_socket(node_group: Any, in_out: str) -> Any:
    matches = tuple(
        item
        for item in node_group.interface.items_tree
        if item.item_type == "SOCKET"
        and item.name == "Geometry"
        and item.in_out == in_out
        and item.socket_type == "NodeSocketGeometry"
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"Light Trails {in_out.lower()} interface socket must be unique; "
            f"found {len(matches)}"
        )
    return matches[0]


def _owned_target(
    receipts: Mapping[str, Any], target_id: str, deps: Any
) -> tuple[Any, Any]:
    registry = deps.build_resource_registry(receipts)
    target_identity, target = deps.owned_resource(registry, target_id, "OBJECT")
    if getattr(target, "type", None) != "MESH":
        raise ValueError(f"Owned target is not a mesh object: {target_id}")
    mesh_is_owned = any(
        identity.resource_type == "MESH"
        and deps.resolve_resource(identity) is target.data
        for identity in registry.values()
    )
    if not mesh_is_owned:
        raise RuntimeError(f"Owned mesh data is unavailable: {target_id}")
    return target_identity, target


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    anchor: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(receipt_id, step_id, action_name, [], [], [], anchor)


def _node_group_identity(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "NODE_GROUP"
        and identity.logical_id == definition.node_group_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must own exactly one Light Trails node group")
    return matches[0]


def _node_tree_mutation(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.resource.logical_id == definition.node_group_id
        and mutation.attribute == "node_tree_semantic_signature_v2"
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must contain one Light Trails node-tree mutation")
    return matches[0]


def _modifier_mutation(receipt: Any, definition: Any, deps: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if isinstance(mutation.after, deps.ModifierState)
        and mutation.after.logical_id == definition.modifier_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial receipt must contain one Light Trails modifier")
    return matches[0]


def _resolve_partial_resources(
    receipt: Any, definition: Any, deps: Any
) -> tuple[Any, Any, Any]:
    node_identity = _node_group_identity(receipt, definition)
    if (
        node_identity.receipt_token != receipt.receipt_id
        or node_identity.step_id != receipt.step_id
        or node_identity.action_name != receipt.action_name
    ):
        raise RuntimeError("Partial Light Trails node-group ownership binding changed")
    node_group = deps.resolve_resource(node_identity)
    if node_group is None:
        raise RuntimeError("Partial Light Trails node group is unavailable")
    modifier_mutation = _modifier_mutation(receipt, definition, deps)
    target = deps.resolve_resource(modifier_mutation.resource)
    if target is None:
        raise RuntimeError("Partial Light Trails modifier owner is unavailable")
    state = modifier_mutation.after
    if (
        state.receipt_token != receipt.receipt_id
        or state.step_id != receipt.step_id
        or state.action_name != receipt.action_name
        or not 0 <= state.stack_index < len(target.modifiers)
    ):
        raise RuntimeError("Partial Light Trails modifier ownership binding changed")
    modifier = target.modifiers[state.stack_index]
    if (
        modifier.as_pointer() != state.pointer
        or modifier.name != definition.modifier_name
        or modifier.type != "NODES"
        or modifier.node_group is not node_group
        or len(modifier.bakes) != 0
        or modifier.bake_directory != ""
    ):
        raise RuntimeError("Partial Light Trails modifier binding changed")
    return target, modifier, node_group


def _stable_identity(resource: Any) -> tuple[str, Any]:
    session_uid = getattr(resource, "session_uid", None)
    if isinstance(session_uid, int) and session_uid > 0:
        return ("session_uid", session_uid)
    return ("test_pointer", resource.as_pointer())


def _fingerprint(target: Any, node_group: Any | None, deps: Any) -> str:
    modifiers = tuple(
        (
            index,
            modifier.name,
            modifier.type,
            (
                _stable_identity(modifier.node_group)
                if getattr(modifier, "node_group", None) is not None
                else None
            ),
            len(getattr(modifier, "bakes", ())),
            getattr(modifier, "bake_directory", None),
        )
        for index, modifier in enumerate(target.modifiers)
    )
    node_state = (
        None if node_group is None else deps.node_tree_semantic_signature(node_group)
    )
    return _digest(
        (
            _stable_identity(target),
            _stable_identity(target.data),
            modifiers,
            node_state,
        )
    )


def _numeric(socket: Any) -> float:
    return float(socket.default_value)


def _numeric_matches(socket: Any, expected: float) -> bool:
    return math.isclose(
        _numeric(socket), float(expected), rel_tol=1e-6, abs_tol=1e-7
    )


def _vector(socket: Any) -> tuple[float, ...]:
    return tuple(float(component) for component in socket.default_value)


def _vector_matches(socket: Any, expected: tuple[float, ...]) -> bool:
    actual = _vector(socket)
    return len(actual) == len(expected) and all(
        math.isclose(component, float(wanted), rel_tol=1e-6, abs_tol=1e-7)
        for component, wanted in zip(actual, expected, strict=True)
    )


def _rows_start(count: int, spacing: float) -> tuple[float, float, float]:
    return (0.0, -((count - 1) * spacing) / 2.0, 0.0)


def _tiles_start(count: int, length: float) -> tuple[float, float, float]:
    return (-((count - 1) * length) / 2.0, 0.0, 0.0)


def _expected_nodes(stage: int) -> dict[str, str]:
    return {
        name: node_type
        for ordinal, (node_type, name) in _NODE_OPERATIONS.items()
        if ordinal <= stage
    }


def _expected_links(stage: int) -> tuple[tuple[str, str, str, str], ...]:
    return tuple(
        sorted(link for ordinal, link in _LINK_OPERATIONS.items() if ordinal <= stage)
    )


def _socket_key(node: Any, socket: Any) -> str:
    if node.bl_idname in {"NodeGroupInput", "NodeGroupOutput"}:
        return socket.name
    return socket.identifier


def _validate_stage(node_group: Any, stage: int, definition: Any) -> None:
    if not 2 <= stage <= 53:
        raise ValueError(f"Light Trails graph stage is outside [2, 53]: {stage}")
    actual_nodes = {node.name: node.bl_idname for node in node_group.nodes}
    if actual_nodes != _expected_nodes(stage):
        raise RuntimeError("Light Trails nodes do not match the guided stage")

    expected_interface = []
    if stage >= 3:
        expected_interface.append(("Geometry", "INPUT", "NodeSocketGeometry"))
    if stage >= 34:
        expected_interface.append(("Geometry", "OUTPUT", "NodeSocketGeometry"))
    actual_interface = sorted(
        (item.name, item.in_out, item.socket_type)
        for item in node_group.interface.items_tree
        if item.item_type == "SOCKET"
    )
    if actual_interface != sorted(expected_interface):
        raise RuntimeError("Light Trails interface does not match the guided stage")

    if stage >= 4:
        half_line = node_group.nodes["OperatingLine Half Tile Line"]
        if half_line.mode != "POINTS":
            raise RuntimeError("Light Trails half-line mode changed")
        expected_start = (
            (-definition.tile_length / 2.0, 0.0, 0.0)
            if stage >= 5
            else (-_DEFAULT_TILE_LENGTH / 2.0, 0.0, 0.0)
        )
        if not _vector_matches(_socket(half_line.inputs, "Start"), expected_start):
            raise RuntimeError("Light Trails tile length no longer matches its stage")
        if not _vector_matches(_socket(half_line.inputs, "End"), (0.0, 0.0, 0.0)):
            raise RuntimeError("Light Trails half-line endpoint changed")
    if stage >= 6:
        resample = node_group.nodes["OperatingLine Trail Resolution"]
        if hasattr(resample, "mode"):
            if resample.mode != "COUNT":
                raise RuntimeError("Light Trails resample mode changed")
        elif getattr(_socket(resample.inputs, "Mode"), "default_value", None) != "Count":
            raise RuntimeError("Light Trails resample mode changed")
        expected_count = (
            definition.points_per_trail if stage >= 7 else _DEFAULT_POINTS_PER_TRAIL
        )
        if not _numeric_matches(_socket(resample.inputs, "Count"), expected_count):
            raise RuntimeError("Light Trails point count no longer matches its stage")
    if stage >= 8:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        if rows.mode != "OFFSET":
            raise RuntimeError("Light Trails row mode changed")
        count = definition.trail_count if stage >= 9 else _DEFAULT_TRAIL_COUNT
        spacing = definition.trail_spacing if stage >= 10 else _DEFAULT_TRAIL_SPACING
        if not _numeric_matches(_socket(rows.inputs, "Count"), count):
            raise RuntimeError("Light Trails trail count no longer matches its stage")
        if not _vector_matches(
            _socket(rows.inputs, "Start Location"), _rows_start(count, spacing)
        ) or not _vector_matches(
            _socket(rows.inputs, "Offset"), (0.0, spacing, 0.0)
        ):
            raise RuntimeError("Light Trails spacing no longer matches its stage")
    if stage >= 14:
        noise = node_group.nodes["OperatingLine Terrain Noise"]
        if noise.noise_dimensions != "4D":
            raise RuntimeError("Light Trails noise dimension changed")
        expected_noise = (
            ("Scale", definition.noise_scale if stage >= 15 else _DEFAULT_NOISE_SCALE),
            ("Detail", definition.noise_detail if stage >= 16 else _DEFAULT_NOISE_DETAIL),
            (
                "Roughness",
                definition.noise_roughness if stage >= 17 else _DEFAULT_NOISE_ROUGHNESS,
            ),
            ("W", definition.noise_seed if stage >= 18 else _DEFAULT_NOISE_SEED),
        )
        if any(
            not _numeric_matches(_socket(noise.inputs, name), value)
            for name, value in expected_noise
        ):
            raise RuntimeError("Light Trails noise values no longer match their stage")
    if stage >= 19:
        center = node_group.nodes["OperatingLine Center Noise"]
        if center.operation != "SUBTRACT" or not _numeric_matches(
            _socket(center.inputs, "Value_001"), 0.5
        ):
            raise RuntimeError("Light Trails center-noise configuration changed")
    if stage >= 20:
        height = node_group.nodes["OperatingLine Scale Height"]
        expected_height = definition.height if stage >= 21 else _DEFAULT_HEIGHT
        if height.operation != "MULTIPLY" or not _numeric_matches(
            _socket(height.inputs, "Value_001"), expected_height
        ):
            raise RuntimeError("Light Trails height no longer matches its stage")
    if stage >= 24 and not _vector_matches(
        _socket(node_group.nodes["OperatingLine Mirror Half Tile"].inputs, "Scale"),
        (-1.0, 1.0, 1.0),
    ):
        raise RuntimeError("Light Trails mirror scale changed")
    if stage >= 26:
        profile = node_group.nodes["OperatingLine Trail Profile"]
        sides = definition.profile_sides if stage >= 27 else _DEFAULT_PROFILE_SIDES
        radius = definition.profile_radius if stage >= 28 else _DEFAULT_PROFILE_RADIUS
        if (
            profile.mode != "RADIUS"
            or not _numeric_matches(_socket(profile.inputs, "Resolution"), sides)
            or not _numeric_matches(_socket(profile.inputs, "Radius"), radius)
        ):
            raise RuntimeError("Light Trails profile no longer matches its stage")
    if stage >= 30:
        tiles = node_group.nodes["OperatingLine Loop Tiles"]
        count = (
            definition.tile_repeat_count
            if stage >= 31
            else _DEFAULT_TILE_REPEAT_COUNT
        )
        if (
            tiles.mode != "OFFSET"
            or not _numeric_matches(_socket(tiles.inputs, "Count"), count)
            or not _vector_matches(
                _socket(tiles.inputs, "Start Location"),
                _tiles_start(count, definition.tile_length),
            )
            or not _vector_matches(
                _socket(tiles.inputs, "Offset"),
                (definition.tile_length, 0.0, 0.0),
            )
        ):
            raise RuntimeError("Light Trails tile repeat values no longer match their stage")

    actual_links = tuple(
        sorted(
            (
                link.from_node.name,
                _socket_key(link.from_node, link.from_socket),
                link.to_node.name,
                _socket_key(link.to_node, link.to_socket),
            )
            for link in node_group.links
        )
    )
    if actual_links != _expected_links(stage):
        raise RuntimeError("Light Trails links do not match the guided stage")
    forbidden = {
        "GeometryNodeBake",
        "GeometryNodeSimulationInput",
        "GeometryNodeSimulationOutput",
    }
    if forbidden.intersection(actual_nodes.values()):
        raise RuntimeError("Light Trails graph contains a bake or simulation node")


def _validate_transaction(
    transaction: GuidedGeometryTransaction,
    receipt_id: str,
    step_id: str,
    action_name: str,
    expected_completed: tuple[int, ...],
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, Any | None]:
    receipt = transaction.receipt
    if (
        receipt.receipt_id != receipt_id
        or receipt.step_id != step_id
        or receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Light Trails transaction receipt binding changed")
    if transaction.completed_operations != expected_completed:
        raise RuntimeError("Guided Light Trails operations must execute in strict order")
    if expected_completed != tuple(range(1, len(expected_completed) + 1)):
        raise RuntimeError("Guided Light Trails history is not a valid prefix")
    if transaction.definition_fingerprint != _definition_fingerprint(definition):
        raise RuntimeError("Guided Light Trails accepted parameters changed mid-transaction")
    deps.ensure_receipts_intact(receipts)
    target_identity, target = _owned_target(receipts, definition.target_id, deps)
    if receipt.anchor != target_identity:
        raise RuntimeError("Guided Light Trails target binding changed")
    node_group = None
    if expected_completed and expected_completed[-1] >= 2:
        if len(receipt.created) != 1 or len(receipt.mutations) != 2 or receipt.artifacts:
            raise RuntimeError("Partial Light Trails receipt has unexpected effects")
        deps.ensure_receipts_intact({"guided-partial": receipt})
        _target, _modifier, node_group = _resolve_partial_resources(
            receipt, definition, deps
        )
        _validate_stage(node_group, min(expected_completed[-1], 53), definition)
    elif receipt.created or receipt.mutations or receipt.artifacts:
        raise RuntimeError("Precondition-only Light Trails receipt must not own effects")
    if _fingerprint(target, node_group, deps) != transaction.fingerprint:
        raise RuntimeError("Guided Light Trails resources changed outside the transaction")
    return target, node_group


def _replace_node_signature(
    receipt: Any, node_group: Any, definition: Any, deps: Any
) -> Any:
    current = _node_tree_mutation(receipt, definition)
    updated = replace(current, after=deps.node_tree_semantic_signature(node_group))
    return replace(
        receipt,
        mutations=tuple(
            updated if mutation is current else mutation for mutation in receipt.mutations
        ),
    )


def _create_base_resources(
    receipt: Any, target: Any, definition: Any, deps: Any
) -> tuple[Any, Any, tuple[dict[str, Any], ...]]:
    created: list[Any] = []
    mutations: list[Any] = []
    modifier = None
    try:
        node_group = _bpy().data.node_groups.new(
            definition.node_group_name, "GeometryNodeTree"
        )
        identity = deps.tag_resource(
            node_group,
            definition.node_group_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        created.append(identity)
        modifier = target.modifiers.new(definition.modifier_name, "NODES")
        modifier.node_group = node_group
        if (
            node_group.name != definition.node_group_name
            or node_group.bl_idname != "GeometryNodeTree"
            or modifier.name != definition.modifier_name
            or modifier.type != "NODES"
            or modifier.node_group is not node_group
        ):
            raise RuntimeError("Light Trails base RNA resources were not observed")
        if len(modifier.bakes) != 0 or modifier.bake_directory != "":
            raise RuntimeError("Light Trails modifier unexpectedly exposes bake state")
        modifier_state = deps.snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            {"node_group": identity},
        )
        mutations.extend(
            (
                deps.MutationRecord(
                    receipt.anchor,
                    f"modifier:{definition.modifier_id}",
                    None,
                    modifier_state,
                ),
                deps.MutationRecord(
                    identity,
                    "node_tree_semantic_signature_v2",
                    None,
                    deps.node_tree_semantic_signature(node_group),
                ),
            )
        )
        source_operation_id = LIGHT_TRAILS_OPERATION_IDS[1]
        common = {
            "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
            "sourceOperationId": source_operation_id,
            "semanticAction": source_operation_id,
            "targetId": definition.target_id,
        }
        resource_mutations = (
            {
                **common,
                "order": 1,
                "executionMethod": "blender_rna_node_group_create",
                "mutationKind": "node_group_create",
                "nodeGroupId": definition.node_group_id,
                "nodeGroupName": node_group.name,
                "nodeTreeType": node_group.bl_idname,
                "observedResource": True,
                "uiPath": ["Geometry Nodes", node_group.name],
            },
            {
                **common,
                "order": 2,
                "executionMethod": "blender_rna_modifier_create",
                "mutationKind": "modifier_create",
                "modifierId": definition.modifier_id,
                "modifierName": modifier.name,
                "modifierType": modifier.type,
                "observedResource": True,
                "uiPath": ["Properties", "Modifiers", modifier.name],
            },
            {
                **common,
                "order": 3,
                "executionMethod": "blender_rna_modifier_node_group_bind",
                "mutationKind": "modifier_node_group_bind",
                "modifierId": definition.modifier_id,
                "modifierName": modifier.name,
                "nodeGroupId": definition.node_group_id,
                "nodeGroupName": node_group.name,
                "observedBinding": True,
                "uiPath": [
                    "Properties",
                    "Modifiers",
                    modifier.name,
                    "Node Group",
                    node_group.name,
                ],
            },
        )
        return (
            replace(receipt, created=tuple(created), mutations=tuple(mutations)),
            node_group,
            resource_mutations,
        )
    except Exception:
        if modifier is not None and not mutations:
            target.modifiers.remove(modifier)
        deps.rollback_partial(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
        )
        raise


def _node_creation_record(
    *,
    order: int,
    operation: int,
    definition: Any,
    node: Any,
) -> dict[str, Any]:
    source_operation_id = LIGHT_TRAILS_OPERATION_IDS[operation - 1]
    return {
        "order": order,
        "executionMethod": "blender_rna_node_create",
        "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
        "sourceOperationId": source_operation_id,
        "semanticAction": source_operation_id,
        "nodeGroupId": definition.node_group_id,
        "nodeGroupName": definition.node_group_name,
        "structureKind": "node",
        "nodeName": node.name,
        "nodeType": node.bl_idname,
        "observedNode": True,
        "uiPath": [
            "Geometry Nodes",
            definition.node_group_name,
            "Nodes",
            node.name,
        ],
    }


def _interface_socket_creation_record(
    *,
    order: int,
    operation: int,
    definition: Any,
    interface: Any,
) -> dict[str, Any]:
    source_operation_id = LIGHT_TRAILS_OPERATION_IDS[operation - 1]
    return {
        "order": order,
        "executionMethod": "blender_rna_node_group_interface_socket_create",
        "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
        "sourceOperationId": source_operation_id,
        "semanticAction": source_operation_id,
        "nodeGroupId": definition.node_group_id,
        "nodeGroupName": definition.node_group_name,
        "structureKind": "interface_socket",
        "interfaceSocketName": interface.name,
        "interfaceDirection": interface.in_out,
        "interfaceSocketType": interface.socket_type,
        "observedInterfaceSocket": True,
        "uiPath": [
            "Geometry Nodes",
            definition.node_group_name,
            "Interface",
            interface.in_out,
            interface.name,
        ],
    }


def _new_node(
    node_group: Any,
    node_type: str,
    name: str,
    configure,
    *,
    operation: int,
    definition: Any,
) -> tuple[Any, tuple[dict[str, Any], ...]]:
    node = node_group.nodes.new(node_type)
    try:
        node.name = name
        configured_writes = configure(node)
    except Exception:
        node_group.nodes.remove(node)
        raise
    return node, (
        _node_creation_record(
            order=1,
            operation=operation,
            definition=definition,
            node=node,
        ),
        *tuple(configured_writes or ()),
    )


def _add_interface_node(
    node_group: Any,
    in_out: str,
    node_type: str,
    name: str,
    *,
    operation: int,
    definition: Any,
) -> tuple[dict[str, Any], ...]:
    interface = None
    node = None
    try:
        interface = node_group.interface.new_socket(
            name="Geometry", in_out=in_out, socket_type="NodeSocketGeometry"
        )
        node = node_group.nodes.new(node_type)
        node.name = name
    except Exception:
        if node is not None:
            node_group.nodes.remove(node)
        if interface is not None:
            node_group.interface.remove(interface)
        raise
    return (
        _interface_socket_creation_record(
            order=1,
            operation=operation,
            definition=definition,
            interface=interface,
        ),
        _node_creation_record(
            order=2,
            operation=operation,
            definition=definition,
            node=node,
        ),
    )


def _set_resample_mode(node: Any) -> None:
    """Apply the reviewed Count mode through the host-version RNA surface."""

    if hasattr(node, "mode"):
        node.mode = "COUNT"
    else:
        _socket(node.inputs, "Mode").default_value = "Count"


def _write_rna_control(
    socket: Any,
    *,
    order: int,
    operation: int,
    definition: Any,
    node: Any,
    semantic_action: str,
    action_argument: str,
    accepted_value: int | float,
    projected_value: int | float,
    projection: str,
    component_index: int | None = None,
) -> dict[str, Any]:
    """Write one scalar or vector component and return exact RNA evidence."""

    if component_index is None:
        before_value = _numeric(socket)
        socket.default_value = projected_value
        observed_value = _numeric(socket)
        component_label = None
        value_kind = "scalar"
        ui_component = "Value"
    else:
        current = _vector(socket)
        before_value = current[component_index]
        socket.default_value[component_index] = projected_value
        observed = _vector(socket)
        expected = list(current)
        expected[component_index] = float(projected_value)
        if len(observed) != len(expected) or not all(
            math.isclose(value, wanted, rel_tol=1e-6, abs_tol=1e-7)
            for value, wanted in zip(observed, expected, strict=True)
        ):
            raise RuntimeError("Light Trails RNA vector component write was not observed")
        observed_value = observed[component_index]
        component_label = _VECTOR_COMPONENT_LABELS[component_index]
        value_kind = "vector_component"
        ui_component = component_label
    if not math.isclose(
        observed_value,
        float(projected_value),
        rel_tol=1e-6,
        abs_tol=1e-7,
    ):
        raise RuntimeError("Light Trails RNA property write was not observed")
    return {
        "order": order,
        "executionMethod": "blender_rna_property_write",
        "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
        "sourceOperationId": LIGHT_TRAILS_OPERATION_IDS[operation - 1],
        "semanticAction": semantic_action,
        "actionArgument": action_argument,
        "nodeGroupId": definition.node_group_id,
        "nodeGroupName": definition.node_group_name,
        "nodeName": node.name,
        "nodeType": node.bl_idname,
        "socketIdentifier": socket.identifier,
        "propertyName": "default_value",
        "valueKind": value_kind,
        "componentIndex": component_index,
        "componentLabel": component_label,
        "projection": projection,
        "beforeValue": before_value,
        "acceptedValue": accepted_value,
        "projectedValue": projected_value,
        "observedValue": observed_value,
        "uiPath": [
            "Geometry Nodes",
            definition.node_group_name,
            node.name,
            socket.identifier,
            ui_component,
        ],
    }


def _initialization_write_record(
    *,
    order: int,
    operation: int,
    definition: Any,
    node: Any,
    target_kind: str,
    socket_identifier: str | None,
    property_name: str,
    value_kind: str,
    component_index: int | None,
    component_label: str | None,
    value_source: str,
    action_argument: str | None,
    assigned_value: str | int | float,
    observed_value: str | float,
    ui_target: str,
    ui_component: str,
) -> dict[str, Any]:
    return {
        "order": order,
        "executionMethod": "blender_rna_property_write",
        "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
        "sourceOperationId": LIGHT_TRAILS_OPERATION_IDS[operation - 1],
        "semanticAction": LIGHT_TRAILS_OPERATION_IDS[operation - 1],
        "nodeGroupId": definition.node_group_id,
        "nodeGroupName": definition.node_group_name,
        "nodeName": node.name,
        "nodeType": node.bl_idname,
        "targetKind": target_kind,
        "socketIdentifier": socket_identifier,
        "propertyName": property_name,
        "valueKind": value_kind,
        "componentIndex": component_index,
        "componentLabel": component_label,
        "valueSource": value_source,
        "actionArgument": action_argument,
        "assignedValue": assigned_value,
        "observedValue": observed_value,
        "uiPath": [
            "Geometry Nodes",
            definition.node_group_name,
            node.name,
            ui_target,
            ui_component,
        ],
    }


def _write_initialization_node_property(
    node: Any,
    *,
    order: int,
    operation: int,
    definition: Any,
    property_name: str,
    assigned_value: str,
    ui_label: str,
) -> dict[str, Any]:
    """Write one fixed enum property while a managed node is initialized."""

    if not hasattr(node, property_name):
        raise RuntimeError(
            f"Light Trails node property is unavailable: {node.name}.{property_name}"
        )
    setattr(node, property_name, assigned_value)
    observed_value = getattr(node, property_name)
    if observed_value != assigned_value:
        raise RuntimeError("Light Trails RNA node-property write was not observed")
    return _initialization_write_record(
        order=order,
        operation=operation,
        definition=definition,
        node=node,
        target_kind="node_property",
        socket_identifier=None,
        property_name=property_name,
        value_kind="enum",
        component_index=None,
        component_label=None,
        value_source="catalog_constant",
        action_argument=None,
        assigned_value=assigned_value,
        observed_value=observed_value,
        ui_target="Node",
        ui_component=ui_label,
    )


def _write_initialization_socket(
    socket: Any,
    *,
    order: int,
    operation: int,
    definition: Any,
    node: Any,
    assigned_value: int | float,
    component_index: int | None = None,
    value_source: str = "catalog_constant",
    action_argument: str | None = None,
) -> dict[str, Any]:
    """Write one fixed or accepted-derived socket value during node creation."""

    if component_index is None:
        socket.default_value = assigned_value
        observed_value = _numeric(socket)
        component_label = None
        value_kind = "scalar"
        ui_component = "Value"
    else:
        current = _vector(socket)
        socket.default_value[component_index] = assigned_value
        observed = _vector(socket)
        expected = list(current)
        expected[component_index] = float(assigned_value)
        if len(observed) != len(expected) or not all(
            math.isclose(value, wanted, rel_tol=1e-6, abs_tol=1e-7)
            for value, wanted in zip(observed, expected, strict=True)
        ):
            raise RuntimeError(
                "Light Trails initialization vector-component write was not observed"
            )
        observed_value = observed[component_index]
        component_label = _VECTOR_COMPONENT_LABELS[component_index]
        value_kind = "vector_component"
        ui_component = component_label
    if not math.isclose(
        observed_value,
        float(assigned_value),
        rel_tol=1e-6,
        abs_tol=1e-7,
    ):
        raise RuntimeError("Light Trails initialization socket write was not observed")
    return _initialization_write_record(
        order=order,
        operation=operation,
        definition=definition,
        node=node,
        target_kind="input_socket",
        socket_identifier=socket.identifier,
        property_name="default_value",
        value_kind=value_kind,
        component_index=component_index,
        component_label=component_label,
        value_source=value_source,
        action_argument=action_argument,
        assigned_value=assigned_value,
        observed_value=observed_value,
        ui_target=socket.identifier,
        ui_component=ui_component,
    )


def _create_link_with_evidence(
    node_group: Any,
    *,
    operation: int,
    definition: Any,
) -> dict[str, Any]:
    """Create one reviewed node link and return its exact RNA endpoint receipt."""

    from_name, from_socket_identifier, to_name, to_socket_identifier = (
        _LINK_OPERATIONS[operation]
    )
    from_node = node_group.nodes[from_name]
    to_node = node_group.nodes[to_name]
    created_link = node_group.links.new(
        _socket(from_node.outputs, from_socket_identifier),
        _socket(to_node.inputs, to_socket_identifier),
    )
    observed_signature = (
        created_link.from_node.name,
        _socket_key(created_link.from_node, created_link.from_socket),
        created_link.to_node.name,
        _socket_key(created_link.to_node, created_link.to_socket),
    )
    expected_signature = (
        from_name,
        from_socket_identifier,
        to_name,
        to_socket_identifier,
    )
    if observed_signature != expected_signature:
        node_group.links.remove(created_link)
        raise RuntimeError("Light Trails RNA node-link creation was not observed")
    source_operation_id = LIGHT_TRAILS_OPERATION_IDS[operation - 1]
    return {
        "order": 1,
        "executionMethod": "blender_rna_node_link_create",
        "mcpTool": _LIGHT_TRAILS_EXECUTE_TOOL,
        "sourceOperationId": source_operation_id,
        "semanticAction": source_operation_id,
        "nodeGroupId": definition.node_group_id,
        "nodeGroupName": definition.node_group_name,
        "fromNodeName": from_node.name,
        "fromNodeType": from_node.bl_idname,
        "fromSocketIdentifier": from_socket_identifier,
        "fromSocketDirection": "OUTPUT",
        "toNodeName": to_node.name,
        "toNodeType": to_node.bl_idname,
        "toSocketIdentifier": to_socket_identifier,
        "toSocketDirection": "INPUT",
        "observedLink": True,
        "uiPath": [
            "Geometry Nodes",
            definition.node_group_name,
            from_node.name,
            from_socket_identifier,
            to_node.name,
            to_socket_identifier,
        ],
    }


def _apply_forward(
    operation: int, node_group: Any, definition: Any
) -> tuple[dict[str, Any], ...]:
    def create_node(node_type: str, name: str, configure) -> tuple[dict[str, Any], ...]:
        _node, writes = _new_node(
            node_group,
            node_type,
            name,
            configure,
            operation=operation,
            definition=definition,
        )
        return writes

    if operation == 3:
        return _add_interface_node(
            node_group,
            "INPUT",
            "NodeGroupInput",
            "OperatingLine Input",
            operation=operation,
            definition=definition,
        )
    elif operation == 4:
        def configure(node):
            start = _socket(node.inputs, "Start")
            end = _socket(node.inputs, "End")
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="mode",
                    assigned_value="POINTS",
                    ui_label="Mode",
                ),
                *(
                    _write_initialization_socket(
                        start,
                        order=component_index + 2,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                    )
                    for component_index, value in enumerate(
                        (-_DEFAULT_TILE_LENGTH / 2.0, 0.0, 0.0)
                    )
                ),
                *(
                    _write_initialization_socket(
                        end,
                        order=component_index + 5,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                    )
                    for component_index, value in enumerate((0.0, 0.0, 0.0))
                ),
            )

        return create_node(
            "GeometryNodeCurvePrimitiveLine",
            "OperatingLine Half Tile Line",
            configure,
        )
    elif operation == 5:
        node = node_group.nodes["OperatingLine Half Tile Line"]
        return (
            _write_rna_control(
                _socket(node.inputs, "Start"),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.half_tile_line",
                action_argument="tileLength",
                accepted_value=definition.tile_length,
                projected_value=-definition.tile_length / 2.0,
                projection="negative_half_x",
                component_index=0,
            ),
        )
    elif operation == 6:
        def configure(node):
            _set_resample_mode(node)
            return (
                _write_initialization_socket(
                    _socket(node.inputs, "Count"),
                    order=1,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_POINTS_PER_TRAIL,
                ),
            )

        return create_node(
            "GeometryNodeResampleCurve",
            "OperatingLine Trail Resolution",
            configure,
        )
    elif operation == 7:
        node = node_group.nodes["OperatingLine Trail Resolution"]
        return (
            _write_rna_control(
                _socket(node.inputs, "Count"),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.trail_resolution",
                action_argument="pointsPerTrail",
                accepted_value=definition.points_per_trail,
                projected_value=definition.points_per_trail,
                projection="identity",
            ),
        )
    elif operation == 8:
        def configure(node):
            start = _socket(node.inputs, "Start Location")
            offset = _socket(node.inputs, "Offset")
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="mode",
                    assigned_value="OFFSET",
                    ui_label="Mode",
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Count"),
                    order=2,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_TRAIL_COUNT,
                ),
                *(
                    _write_initialization_socket(
                        start,
                        order=component_index + 3,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                    )
                    for component_index, value in enumerate(
                        _rows_start(_DEFAULT_TRAIL_COUNT, _DEFAULT_TRAIL_SPACING)
                    )
                ),
                *(
                    _write_initialization_socket(
                        offset,
                        order=component_index + 6,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                    )
                    for component_index, value in enumerate(
                        (0.0, _DEFAULT_TRAIL_SPACING, 0.0)
                    )
                ),
            )

        return create_node(
            "GeometryNodeMeshLine",
            "OperatingLine Trail Rows",
            configure,
        )
    elif operation == 9:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        return (
            _write_rna_control(
                _socket(rows.inputs, "Count"),
                order=1,
                operation=operation,
                definition=definition,
                node=rows,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailCount",
                accepted_value=definition.trail_count,
                projected_value=definition.trail_count,
                projection="identity",
            ),
            _write_rna_control(
                _socket(rows.inputs, "Start Location"),
                order=2,
                operation=operation,
                definition=definition,
                node=rows,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailCount",
                accepted_value=definition.trail_count,
                projected_value=_rows_start(
                    definition.trail_count, _DEFAULT_TRAIL_SPACING
                )[1],
                projection="centered_rows_y_from_count",
                component_index=1,
            ),
        )
    elif operation == 10:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        return (
            _write_rna_control(
                _socket(rows.inputs, "Start Location"),
                order=1,
                operation=operation,
                definition=definition,
                node=rows,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailSpacing",
                accepted_value=definition.trail_spacing,
                projected_value=_rows_start(
                    definition.trail_count, definition.trail_spacing
                )[1],
                projection="centered_rows_y_from_spacing",
                component_index=1,
            ),
            _write_rna_control(
                _socket(rows.inputs, "Offset"),
                order=2,
                operation=operation,
                definition=definition,
                node=rows,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailSpacing",
                accepted_value=definition.trail_spacing,
                projected_value=definition.trail_spacing,
                projection="identity",
                component_index=1,
            ),
        )
    elif operation == 11:
        return create_node(
            "GeometryNodeInstanceOnPoints",
            "OperatingLine Trail Instances",
            lambda _node: None,
        )
    elif operation == 12:
        return create_node(
            "GeometryNodeRealizeInstances",
            "OperatingLine Realize Trails",
            lambda _node: None,
        )
    elif operation == 13:
        return create_node(
            "GeometryNodeInputPosition",
            "OperatingLine Trail Position",
            lambda _node: None,
        )
    elif operation == 14:
        def configure(node):
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="noise_dimensions",
                    assigned_value="4D",
                    ui_label="Dimensions",
                ),
                *(
                    _write_initialization_socket(
                        _socket(node.inputs, socket_identifier),
                        order=order,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                    )
                    for order, (socket_identifier, value) in enumerate(
                        (
                            ("Scale", _DEFAULT_NOISE_SCALE),
                            ("Detail", _DEFAULT_NOISE_DETAIL),
                            ("Roughness", _DEFAULT_NOISE_ROUGHNESS),
                            ("W", _DEFAULT_NOISE_SEED),
                        ),
                        start=2,
                    )
                ),
            )

        return create_node(
            "ShaderNodeTexNoise",
            "OperatingLine Terrain Noise",
            configure,
        )
    elif 15 <= operation <= 18:
        name, action_argument, value = {
            15: ("Scale", "noiseScale", definition.noise_scale),
            16: ("Detail", "noiseDetail", definition.noise_detail),
            17: ("Roughness", "noiseRoughness", definition.noise_roughness),
            18: ("W", "noiseSeed", definition.noise_seed),
        }[operation]
        node = node_group.nodes["OperatingLine Terrain Noise"]
        return (
            _write_rna_control(
                _socket(node.inputs, name),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.terrain_noise",
                action_argument=action_argument,
                accepted_value=value,
                projected_value=value,
                projection="identity",
            ),
        )
    elif operation == 19:
        def configure(node):
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="operation",
                    assigned_value="SUBTRACT",
                    ui_label="Operation",
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Value_001"),
                    order=2,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=0.5,
                ),
            )

        return create_node(
            "ShaderNodeMath",
            "OperatingLine Center Noise",
            configure,
        )
    elif operation == 20:
        def configure(node):
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="operation",
                    assigned_value="MULTIPLY",
                    ui_label="Operation",
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Value_001"),
                    order=2,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_HEIGHT,
                ),
            )

        return create_node(
            "ShaderNodeMath",
            "OperatingLine Scale Height",
            configure,
        )
    elif operation == 21:
        node = node_group.nodes["OperatingLine Scale Height"]
        return (
            _write_rna_control(
                _socket(node.inputs, "Value_001"),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.scale_height",
                action_argument="height",
                accepted_value=definition.height,
                projected_value=definition.height,
                projection="identity",
            ),
        )
    elif operation == 22:
        return create_node(
            "ShaderNodeCombineXYZ", "OperatingLine Z Offset", lambda _node: None
        )
    elif operation == 23:
        return create_node(
            "GeometryNodeSetPosition",
            "OperatingLine Displace Trails",
            lambda _node: None,
        )
    elif operation == 24:
        def configure(node):
            scale = _socket(node.inputs, "Scale")
            return tuple(
                _write_initialization_socket(
                    scale,
                    order=component_index + 1,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=value,
                    component_index=component_index,
                )
                for component_index, value in enumerate((-1.0, 1.0, 1.0))
            )

        return create_node(
            "GeometryNodeTransform",
            "OperatingLine Mirror Half Tile",
            configure,
        )
    elif operation == 25:
        return create_node(
            "GeometryNodeJoinGeometry",
            "OperatingLine Mirrored Tile",
            lambda _node: None,
        )
    elif operation == 26:
        def configure(node):
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="mode",
                    assigned_value="RADIUS",
                    ui_label="Mode",
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Resolution"),
                    order=2,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_PROFILE_SIDES,
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Radius"),
                    order=3,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_PROFILE_RADIUS,
                ),
            )

        return create_node(
            "GeometryNodeCurvePrimitiveCircle",
            "OperatingLine Trail Profile",
            configure,
        )
    elif operation == 27:
        node = node_group.nodes["OperatingLine Trail Profile"]
        return (
            _write_rna_control(
                _socket(node.inputs, "Resolution"),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.trail_profile",
                action_argument="profileSides",
                accepted_value=definition.profile_sides,
                projected_value=definition.profile_sides,
                projection="identity",
            ),
        )
    elif operation == 28:
        node = node_group.nodes["OperatingLine Trail Profile"]
        return (
            _write_rna_control(
                _socket(node.inputs, "Radius"),
                order=1,
                operation=operation,
                definition=definition,
                node=node,
                semantic_action="node.light_trails.trail_profile",
                action_argument="profileRadius",
                accepted_value=definition.profile_radius,
                projected_value=definition.profile_radius,
                projection="identity",
            ),
        )
    elif operation == 29:
        return create_node(
            "GeometryNodeCurveToMesh",
            "OperatingLine Curve To Mesh",
            lambda _node: None,
        )
    elif operation == 30:
        def configure(node):
            start = _socket(node.inputs, "Start Location")
            offset = _socket(node.inputs, "Offset")
            return (
                _write_initialization_node_property(
                    node,
                    order=1,
                    operation=operation,
                    definition=definition,
                    property_name="mode",
                    assigned_value="OFFSET",
                    ui_label="Mode",
                ),
                _write_initialization_socket(
                    _socket(node.inputs, "Count"),
                    order=2,
                    operation=operation,
                    definition=definition,
                    node=node,
                    assigned_value=_DEFAULT_TILE_REPEAT_COUNT,
                ),
                *(
                    _write_initialization_socket(
                        start,
                        order=component_index + 3,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                    )
                    for component_index, value in enumerate(
                        _tiles_start(
                            _DEFAULT_TILE_REPEAT_COUNT, definition.tile_length
                        )
                    )
                ),
                *(
                    _write_initialization_socket(
                        offset,
                        order=component_index + 6,
                        operation=operation,
                        definition=definition,
                        node=node,
                        assigned_value=value,
                        component_index=component_index,
                        value_source=(
                            "accepted_action_argument"
                            if component_index == 0
                            else "catalog_constant"
                        ),
                        action_argument=(
                            "tileLength" if component_index == 0 else None
                        ),
                    )
                    for component_index, value in enumerate(
                        (definition.tile_length, 0.0, 0.0)
                    )
                ),
            )

        return create_node(
            "GeometryNodeMeshLine",
            "OperatingLine Loop Tiles",
            configure,
        )
    elif operation == 31:
        tiles = node_group.nodes["OperatingLine Loop Tiles"]
        return (
            _write_rna_control(
                _socket(tiles.inputs, "Count"),
                order=1,
                operation=operation,
                definition=definition,
                node=tiles,
                semantic_action="node.light_trails.loop_tiles",
                action_argument="tileRepeatCount",
                accepted_value=definition.tile_repeat_count,
                projected_value=definition.tile_repeat_count,
                projection="identity",
            ),
            _write_rna_control(
                _socket(tiles.inputs, "Start Location"),
                order=2,
                operation=operation,
                definition=definition,
                node=tiles,
                semantic_action="node.light_trails.loop_tiles",
                action_argument="tileRepeatCount",
                accepted_value=definition.tile_repeat_count,
                projected_value=_tiles_start(
                    definition.tile_repeat_count, definition.tile_length
                )[0],
                projection="centered_tiles_x_from_count",
                component_index=0,
            ),
        )
    elif operation == 32:
        return create_node(
            "GeometryNodeInstanceOnPoints",
            "OperatingLine Tile Instances",
            lambda _node: None,
        )
    elif operation == 33:
        return create_node(
            "GeometryNodeRealizeInstances",
            "OperatingLine Realize Tiles",
            lambda _node: None,
        )
    elif operation == 34:
        return _add_interface_node(
            node_group,
            "OUTPUT",
            "NodeGroupOutput",
            "OperatingLine Output",
            operation=operation,
            definition=definition,
        )
    elif operation in _LINK_OPERATIONS:
        return (
            _create_link_with_evidence(
                node_group,
                operation=operation,
                definition=definition,
            ),
        )
    return ()


def _remove_link(node_group: Any, link_signature: tuple[str, str, str, str]) -> None:
    matches = tuple(
        link
        for link in node_group.links
        if (
            link.from_node.name,
            _socket_key(link.from_node, link.from_socket),
            link.to_node.name,
            _socket_key(link.to_node, link.to_socket),
        )
        == link_signature
    )
    if len(matches) != 1:
        raise RuntimeError("Expected one guided Light Trails link")
    node_group.links.remove(matches[0])


def _apply_inverse(operation: int, node_group: Any, definition: Any) -> None:
    if operation in _LINK_OPERATIONS:
        _remove_link(node_group, _LINK_OPERATIONS[operation])
    elif operation == 34:
        node_group.nodes.remove(node_group.nodes["OperatingLine Output"])
        node_group.interface.remove(_interface_socket(node_group, "OUTPUT"))
    elif operation in {33, 32, 30, 29, 26, 25, 24, 23, 22, 20, 19, 14, 13, 12, 11, 8, 6, 4}:
        node_group.nodes.remove(node_group.nodes[_NODE_OPERATIONS[operation][1]])
    elif operation == 31:
        tiles = node_group.nodes["OperatingLine Loop Tiles"]
        _socket(tiles.inputs, "Count").default_value = _DEFAULT_TILE_REPEAT_COUNT
        _socket(tiles.inputs, "Start Location").default_value = _tiles_start(
            _DEFAULT_TILE_REPEAT_COUNT, definition.tile_length
        )
    elif operation == 28:
        _socket(
            node_group.nodes["OperatingLine Trail Profile"].inputs, "Radius"
        ).default_value = _DEFAULT_PROFILE_RADIUS
    elif operation == 27:
        _socket(
            node_group.nodes["OperatingLine Trail Profile"].inputs, "Resolution"
        ).default_value = _DEFAULT_PROFILE_SIDES
    elif operation == 21:
        _socket(
            node_group.nodes["OperatingLine Scale Height"].inputs, "Value_001"
        ).default_value = _DEFAULT_HEIGHT
    elif 15 <= operation <= 18:
        name, value = {
            15: ("Scale", _DEFAULT_NOISE_SCALE),
            16: ("Detail", _DEFAULT_NOISE_DETAIL),
            17: ("Roughness", _DEFAULT_NOISE_ROUGHNESS),
            18: ("W", _DEFAULT_NOISE_SEED),
        }[operation]
        _socket(
            node_group.nodes["OperatingLine Terrain Noise"].inputs, name
        ).default_value = value
    elif operation == 10:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        _socket(rows.inputs, "Start Location").default_value = _rows_start(
            definition.trail_count, _DEFAULT_TRAIL_SPACING
        )
        _socket(rows.inputs, "Offset").default_value = (
            0.0,
            _DEFAULT_TRAIL_SPACING,
            0.0,
        )
    elif operation == 9:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        _socket(rows.inputs, "Count").default_value = _DEFAULT_TRAIL_COUNT
        _socket(rows.inputs, "Start Location").default_value = _rows_start(
            _DEFAULT_TRAIL_COUNT, _DEFAULT_TRAIL_SPACING
        )
    elif operation == 7:
        _socket(
            node_group.nodes["OperatingLine Trail Resolution"].inputs, "Count"
        ).default_value = _DEFAULT_POINTS_PER_TRAIL
    elif operation == 5:
        _socket(
            node_group.nodes["OperatingLine Half Tile Line"].inputs, "Start"
        ).default_value = (-_DEFAULT_TILE_LENGTH / 2.0, 0.0, 0.0)
    elif operation == 3:
        node_group.nodes.remove(node_group.nodes["OperatingLine Input"])
        node_group.interface.remove(_interface_socket(node_group, "INPUT"))


def _recover_transition_or_raise(
    *,
    operation: int,
    direction: str,
    target: Any,
    node_group: Any,
    definition: Any,
    deps: Any,
    expected_stage: int,
    expected_fingerprint: str,
    compensate: Any,
    original_error: Exception,
) -> None:
    try:
        _validate_stage(node_group, expected_stage, definition)
        if _fingerprint(target, node_group, deps) == expected_fingerprint:
            return
    except Exception:
        pass
    try:
        compensate(operation, node_group, definition)
        _validate_stage(node_group, expected_stage, definition)
        if _fingerprint(target, node_group, deps) != expected_fingerprint:
            raise RuntimeError("compensation restored a different resource fingerprint")
    except Exception as recovery_error:
        atomicity_error = GuidedGeometryAtomicityError(
            f"Guided Light Trails {direction} operation {operation:02d} failed and "
            "its prior Blender state could not be restored"
        )
        atomicity_error.add_note(f"Original failure: {original_error!r}")
        raise atomicity_error from recovery_error


def _base_resources_absent(target: Any, definition: Any) -> bool:
    node_groups = _bpy().data.node_groups
    group = (
        node_groups.get(definition.node_group_name)
        if hasattr(node_groups, "get")
        else next(
            (
                candidate
                for candidate in node_groups
                if getattr(candidate, "name", None) == definition.node_group_name
            ),
            None,
        )
    )
    return target.modifiers.get(definition.modifier_name) is None and group is None


def _controlled_values(node_group: Any, stage: int) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if stage >= 4:
        values["tileLengthHalfStart"] = _vector(
            _socket(node_group.nodes["OperatingLine Half Tile Line"].inputs, "Start")
        )
    if stage >= 6:
        values["pointsPerTrail"] = int(
            _numeric(
                _socket(
                    node_group.nodes["OperatingLine Trail Resolution"].inputs,
                    "Count",
                )
            )
        )
    if stage >= 8:
        rows = node_group.nodes["OperatingLine Trail Rows"]
        values["trailCount"] = int(_numeric(_socket(rows.inputs, "Count")))
        values["trailSpacingOffset"] = _vector(_socket(rows.inputs, "Offset"))
    if stage >= 14:
        noise = node_group.nodes["OperatingLine Terrain Noise"]
        values.update(
            {
                "noiseScale": _numeric(_socket(noise.inputs, "Scale")),
                "noiseDetail": _numeric(_socket(noise.inputs, "Detail")),
                "noiseRoughness": _numeric(_socket(noise.inputs, "Roughness")),
                "noiseSeed": _numeric(_socket(noise.inputs, "W")),
            }
        )
    if stage >= 20:
        values["height"] = _numeric(
            _socket(node_group.nodes["OperatingLine Scale Height"].inputs, "Value_001")
        )
    if stage >= 26:
        profile = node_group.nodes["OperatingLine Trail Profile"]
        values["profileSides"] = int(
            _numeric(_socket(profile.inputs, "Resolution"))
        )
        values["profileRadius"] = _numeric(_socket(profile.inputs, "Radius"))
    if stage >= 30:
        tiles = node_group.nodes["OperatingLine Loop Tiles"]
        values["tileRepeatCount"] = int(_numeric(_socket(tiles.inputs, "Count")))
        values["tileLengthOffset"] = _vector(_socket(tiles.inputs, "Offset"))
    return values


def _graph_evidence(node_group: Any | None, stage: int) -> dict[str, Any]:
    if node_group is None:
        return {
            "stage": stage,
            "nodes": [],
            "nodeCount": 0,
            "interfaceSockets": [],
            "interfaceSocketCount": 0,
            "linkCount": 0,
            "controlledValues": {},
            "noBakeNodes": True,
        }
    return {
        "stage": stage,
        "nodes": sorted(node.name for node in node_group.nodes),
        "nodeCount": len(node_group.nodes),
        "interfaceSockets": sorted(
            (
                {"name": item.name, "inOut": item.in_out, "socketType": item.socket_type}
                for item in node_group.interface.items_tree
                if item.item_type == "SOCKET"
            ),
            key=lambda item: (item["inOut"], item["name"]),
        ),
        "interfaceSocketCount": sum(
            item.item_type == "SOCKET" for item in node_group.interface.items_tree
        ),
        "linkCount": len(node_group.links),
        "controlledValues": _controlled_values(node_group, stage),
        "noBakeNodes": not {
            "GeometryNodeBake",
            "GeometryNodeSimulationInput",
            "GeometryNodeSimulationOutput",
        }.intersection(node.bl_idname for node in node_group.nodes),
    }


def _observation(
    *,
    operation: int,
    direction: str,
    receipt: Any,
    before_fingerprint: str,
    after_fingerprint: str,
    mutating: bool,
    evidence: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "kind": "guided_geometry_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": operation,
            "operationId": LIGHT_TRAILS_OPERATION_IDS[operation - 1],
            "mutating": mutating,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before_fingerprint,
            "afterFingerprintSha256": after_fingerprint,
            "evidence": dict(evidence),
        },
    }


def resume_light_trails_transaction(
    *,
    receipt: Any,
    completed_operations: tuple[int, ...],
    fingerprint: str,
    definition: Any,
) -> GuidedGeometryTransaction:
    if not completed_operations or completed_operations != tuple(
        range(1, len(completed_operations) + 1)
    ):
        raise ValueError("completed_operations must be a non-empty ordinal prefix")
    if receipt is None:
        raise ValueError("A resumed Light Trails transaction requires a receipt")
    if not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise ValueError("A resumed Light Trails transaction requires a fingerprint")
    return GuidedGeometryTransaction(
        receipt=receipt,
        completed_operations=completed_operations,
        fingerprint=fingerprint,
        definition_fingerprint=_definition_fingerprint(definition),
    )


def verify_light_trails_stage(
    *,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    completed_operations: tuple[int, ...],
    expected_fingerprint: str,
    partial_receipt: Any | None,
    rebind_after_native_restore: bool = False,
) -> bool:
    if completed_operations != tuple(range(1, len(completed_operations) + 1)):
        raise ValueError("completed_operations must be an ordinal prefix")
    if not isinstance(expected_fingerprint, str) or len(expected_fingerprint) != 64:
        raise ValueError("expected_fingerprint must be a SHA-256 digest")
    deps = _dependencies()
    rebound_receipts: Mapping[str, Any] = receipts
    rebound_partial = partial_receipt
    if rebind_after_native_restore:
        rebound_receipts = deps.rebind_receipts_after_native_restore(receipts)
        if partial_receipt is not None:
            rebound_partial = deps.rebind_receipts_after_native_restore(
                {"guided-partial": partial_receipt}
            )["guided-partial"]
    deps.ensure_receipts_intact(rebound_receipts)
    _target_identity, target = _owned_target(
        rebound_receipts, definition.target_id, deps
    )
    if len(completed_operations) <= 1:
        if rebound_partial is not None:
            raise RuntimeError("The pre-mutation Light Trails stage has a partial receipt")
        if not _base_resources_absent(target, definition):
            raise RuntimeError("Guided Light Trails base resources are still present")
        if _fingerprint(target, None, deps) != expected_fingerprint:
            raise RuntimeError("Guided Light Trails pre-mutation fingerprint changed")
        return True
    if rebound_partial is None:
        raise RuntimeError("The guided Light Trails partial receipt is unavailable")
    transaction = GuidedGeometryTransaction(
        receipt=rebound_partial,
        completed_operations=completed_operations,
        fingerprint=expected_fingerprint,
        definition_fingerprint=_definition_fingerprint(definition),
    )
    _validate_transaction(
        transaction,
        receipt_id,
        step_id,
        action_name,
        completed_operations,
        rebound_receipts,
        definition,
        deps,
    )
    return True


def execute_light_trails_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if not isinstance(receipt_id, str) or not receipt_id:
        raise ValueError("receipt_id must be supplied by the caller")
    if action_name != LIGHT_TRAILS_ACTION:
        raise ValueError(f"Unsupported guided Light Trails action: {action_name}")
    if not 1 <= operation_ordinal <= len(LIGHT_TRAILS_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 54]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Light Trails operation 01 must start the transaction")
        deps.ensure_receipts_intact(receipts)
        target_identity, target = _owned_target(receipts, definition.target_id, deps)
        receipt = _empty_receipt(receipt_id, step_id, action_name, target_identity, deps)
        node_group = None
        before = _fingerprint(target, None, deps)
    else:
        target, node_group = _validate_transaction(
            transaction,
            receipt_id,
            step_id,
            action_name,
            expected_completed,
            receipts,
            definition,
            deps,
        )
        receipt = transaction.receipt
        before = transaction.fingerprint

    after = None
    rna_control_writes: tuple[dict[str, Any], ...] = ()
    rna_initialization_writes: tuple[dict[str, Any], ...] = ()
    rna_link_creations: tuple[dict[str, Any], ...] = ()
    rna_structure_creations: tuple[dict[str, Any], ...] = ()
    rna_resource_mutations: tuple[dict[str, Any], ...] = ()
    if operation_ordinal == 1:
        deps.ensure_logical_ids_available(
            deps.build_resource_registry(receipts), (definition.node_group_id,)
        )
        deps.ensure_modifier_id_available(receipts, definition.modifier_id)
        deps.ensure_name_available(
            _bpy().data.node_groups, definition.node_group_name, "node group"
        )
        if target.modifiers.get(definition.modifier_name) is not None:
            raise RuntimeError(
                f"Cannot replace existing modifier: {definition.modifier_name}"
            )
    elif operation_ordinal == 2:
        deps.ensure_logical_ids_available(
            deps.build_resource_registry(receipts), (definition.node_group_id,)
        )
        deps.ensure_modifier_id_available(receipts, definition.modifier_id)
        deps.ensure_name_available(
            _bpy().data.node_groups, definition.node_group_name, "node group"
        )
        if target.modifiers.get(definition.modifier_name) is not None:
            raise RuntimeError(
                f"Cannot replace existing modifier: {definition.modifier_name}"
            )
        base_receipt = receipt
        try:
            receipt, node_group, rna_resource_mutations = _create_base_resources(
                receipt, target, definition, deps
            )
            _validate_stage(node_group, 2, definition)
            after = _fingerprint(target, node_group, deps)
        except GuidedGeometryAtomicityError:
            raise
        except Exception as error:
            if receipt is not base_receipt:
                try:
                    deps.rollback_receipt(receipt, allow_incomplete=True)
                    receipt = base_receipt
                    node_group = None
                except Exception as recovery_error:
                    raise GuidedGeometryAtomicityError(
                        "Guided Light Trails operation 02 failed and rollback failed"
                    ) from recovery_error
            if not _base_resources_absent(target, definition):
                raise GuidedGeometryAtomicityError(
                    "Guided Light Trails operation 02 failed and left base resources"
                ) from error
            if _fingerprint(target, None, deps) != before:
                raise GuidedGeometryAtomicityError(
                    "Guided Light Trails operation 02 failed and changed the target"
                ) from error
            raise
    elif operation_ordinal <= 53:
        try:
            operation_writes = _apply_forward(
                operation_ordinal, node_group, definition
            )
            rna_control_writes = tuple(
                write for write in operation_writes if "acceptedValue" in write
            )
            rna_initialization_writes = tuple(
                write for write in operation_writes if "assignedValue" in write
            )
            rna_link_creations = tuple(
                write for write in operation_writes if "observedLink" in write
            )
            rna_structure_creations = tuple(
                write for write in operation_writes if "structureKind" in write
            )
            if len(operation_writes) != (
                len(rna_control_writes)
                + len(rna_initialization_writes)
                + len(rna_link_creations)
                + len(rna_structure_creations)
            ):
                raise RuntimeError(
                    "Light Trails operation returned unknown execution evidence"
                )
            _validate_stage(node_group, operation_ordinal, definition)
            receipt = _replace_node_signature(receipt, node_group, definition, deps)
            after = _fingerprint(target, node_group, deps)
        except Exception as error:
            _recover_transition_or_raise(
                operation=operation_ordinal,
                direction="forward",
                target=target,
                node_group=node_group,
                definition=definition,
                deps=deps,
                expected_stage=operation_ordinal - 1,
                expected_fingerprint=before,
                compensate=_apply_inverse,
                original_error=error,
            )
            raise
    else:
        _validate_stage(node_group, 53, definition)

    if after is None:
        after = _fingerprint(target, node_group, deps)
    completed = (*expected_completed, operation_ordinal)
    result_transaction = GuidedGeometryTransaction(
        receipt,
        completed,
        after,
        _definition_fingerprint(definition),
    )
    evidence = {
        "completedOperations": list(completed),
        "nodeGroupId": definition.node_group_id if operation_ordinal >= 2 else None,
        "modifierId": definition.modifier_id if operation_ordinal >= 2 else None,
        "completeGraph": operation_ordinal == len(LIGHT_TRAILS_OPERATION_IDS),
        "preconditionsValidated": operation_ordinal == 1,
        "preflightKind": (
            "managed_light_trails_resources" if operation_ordinal == 1 else None
        ),
        "preflightTargetId": definition.target_id if operation_ordinal == 1 else None,
        "rnaControlWrites": list(rna_control_writes),
        "rnaInitializationWrites": list(rna_initialization_writes),
        "rnaLinkCreations": list(rna_link_creations),
        "rnaStructureCreations": list(rna_structure_creations),
        "rnaResourceMutations": list(rna_resource_mutations),
        **_graph_evidence(node_group, min(operation_ordinal, 53)),
    }
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            operation=operation_ordinal,
            direction="forward",
            receipt=receipt,
            before_fingerprint=before,
            after_fingerprint=after,
            mutating=2 <= operation_ordinal <= 53,
            evidence=evidence,
        ),
        before,
        after,
    )


def inverse_light_trails_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if not isinstance(receipt_id, str) or not receipt_id:
        raise ValueError("receipt_id must be supplied by the caller")
    if action_name != LIGHT_TRAILS_ACTION:
        raise ValueError(f"Unsupported guided Light Trails action: {action_name}")
    if not 1 <= operation_ordinal <= len(LIGHT_TRAILS_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 54]")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Light Trails inverse must target the latest operation")
    deps = _dependencies()
    target, node_group = _validate_transaction(
        transaction,
        receipt_id,
        step_id,
        action_name,
        transaction.completed_operations,
        receipts,
        definition,
        deps,
    )
    receipt = transaction.receipt
    before = transaction.fingerprint
    if operation_ordinal == 2:
        try:
            deps.rollback_receipt(receipt, allow_incomplete=True)
        except Exception as error:
            try:
                _validate_stage(node_group, 2, definition)
                unchanged = _fingerprint(target, node_group, deps) == before
            except Exception:
                unchanged = False
            if not unchanged:
                raise GuidedGeometryAtomicityError(
                    "Guided Light Trails inverse operation 02 changed base resources"
                ) from error
            raise
        if not _base_resources_absent(target, definition):
            raise GuidedGeometryAtomicityError(
                "Guided Light Trails inverse operation 02 left base resources"
            )
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, transaction.receipt.anchor, deps
        )
        node_group = None
    elif 3 <= operation_ordinal <= 53:
        try:
            _apply_inverse(operation_ordinal, node_group, definition)
            _validate_stage(node_group, operation_ordinal - 1, definition)
            receipt = _replace_node_signature(receipt, node_group, definition, deps)
        except Exception as error:
            _recover_transition_or_raise(
                operation=operation_ordinal,
                direction="inverse",
                target=target,
                node_group=node_group,
                definition=definition,
                deps=deps,
                expected_stage=operation_ordinal,
                expected_fingerprint=before,
                compensate=_apply_forward,
                original_error=error,
            )
            raise
    elif operation_ordinal not in {1, 54}:
        raise ValueError("operation_ordinal must be in [1, 54]")

    after = _fingerprint(target, node_group, deps)
    completed = transaction.completed_operations[:-1]
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, transaction.definition_fingerprint
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            operation=operation_ordinal,
            direction="inverse",
            receipt=receipt,
            before_fingerprint=before,
            after_fingerprint=after,
            mutating=2 <= operation_ordinal <= 53,
            evidence={
                "completedOperations": list(completed),
                "completeGraph": False,
                "preconditionsValidated": False,
                **_graph_evidence(
                    node_group,
                    min(completed[-1], 53) if completed else 0,
                ),
            },
        ),
        before,
        after,
    )


__all__ = (
    "execute_light_trails_operation",
    "inverse_light_trails_operation",
    "LIGHT_TRAILS_ACTION",
    "LIGHT_TRAILS_OPERATION_IDS",
    "resume_light_trails_transaction",
    "verify_light_trails_stage",
)
