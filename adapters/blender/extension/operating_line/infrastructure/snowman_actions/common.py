"""Shared ownership, identity, validation, and rollback primitives."""

from collections.abc import Iterable, Mapping
import hashlib
import math
import os
from pathlib import Path
import re
import tempfile
from dataclasses import fields, is_dataclass, replace
from typing import Any
import uuid

import bpy
from mathutils import Matrix

from ...application import ActionReceipt
from ...application.session import (
    ArtifactIdentity,
    DataBlockReference,
    MaterialSurfaceState,
    ModifierState,
    MutationRecord,
    ParentIdentity,
    PoseBoneState,
    ResourceIdentity,
    SkinWeightsState,
    VertexGroupState,
)

COLLECTION_LOGICAL_ID = "snowman.collection"
COLLECTION_NAME = "OperatingLine Generated"
OWNER_KEY = "operating_line_owner"
OWNER_VALUE = "operating_line_blender_v1"
ACTION_KEY = "operating_line_action"
STEP_KEY = "operating_line_step_id"
ROLLBACK_TOKEN_KEY = "operating_line_rollback_token"
LOGICAL_ID_KEY = "operating_line_resource_id"
OWNED_KEY = "operating_line_action_owned"
LOGICAL_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*")


class ActionAtomicityError(RuntimeError):
    """An action failed and its partial Blender mutation could not be rolled back."""


_ACTION_HOST_STATE_RESTORED_PROOF = object()


def attest_action_host_state_restored(error: Exception) -> None:
    """Attach a process-local proof while preserving the original exception type."""

    error._operating_line_host_state_restored = (  # type: ignore[attr-defined]
        _ACTION_HOST_STATE_RESTORED_PROOF
    )


def action_host_state_restored(error: Exception) -> bool:
    return (
        getattr(error, "_operating_line_host_state_restored", None)
        is _ACTION_HOST_STATE_RESTORED_PROOF
    )


def new_receipt_id() -> str:
    return str(uuid.uuid4())


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_keys(
    value: Mapping[str, Any],
    required: set[str],
    allowed: set[str],
    label: str,
) -> None:
    missing = required - value.keys()
    unknown = value.keys() - allowed
    if missing:
        raise ValueError(f"{label} is missing: {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"{label} has unsupported fields: {', '.join(sorted(unknown))}")


def text(value: Any, label: str, *, prefix: str | None = None) -> str:
    if not isinstance(value, str) or not value or len(value) > 180:
        raise ValueError(f"{label} must be a non-empty string")
    if prefix is not None and not value.startswith(prefix):
        raise ValueError(f"{label} must start with {prefix}")
    return value


def logical_id(value: Any, label: str) -> str:
    result = text(value, label)
    if LOGICAL_ID_PATTERN.fullmatch(result) is None:
        raise ValueError(f"{label} must be a portable logical resource ID")
    return result


def number(
    value: Any,
    label: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    result = float(value)
    if (
        not math.isfinite(result)
        or (minimum is not None and result < minimum)
        or (maximum is not None and result > maximum)
    ):
        raise ValueError(f"{label} is outside the supported range")
    return result


def integer(
    value: Any,
    label: str,
    *,
    minimum: int = 1,
    maximum: int = 16384,
) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be an integer in [{minimum}, {maximum}]")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise ValueError(f"{label} must be an integer in [{minimum}, {maximum}]")
    result = int(value)
    if not minimum <= result <= maximum:
        raise ValueError(f"{label} must be an integer in [{minimum}, {maximum}]")
    return result


def vector(
    value: Any,
    label: str,
    length: int,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{label} must contain {length} numbers")
    return tuple(number(item, label, minimum=minimum, maximum=maximum) for item in value)


def validate_adapter(adapter_id: str, action_name: str) -> None:
    if adapter_id != "blender":
        raise ValueError(f"Unsupported adapter for Blender action: {adapter_id}")
    if action_name not in ALLOWED_ACTIONS:
        raise ValueError(f"Unsupported Blender action: {action_name}")


ALLOWED_ACTIONS = frozenset(
    {
        "blender.mesh.create_uv_sphere",
        "blender.mesh.create_icosphere",
        "blender.mesh.create_cube",
        "blender.mesh.create_cone",
        "blender.mesh.create_cylinder",
        "blender.mesh.create_torus",
        "blender.mesh.create_primitive_batch",
        "blender.mesh.create_plane",
        "blender.mesh.edit_subdivide",
        "blender.mesh.edit_triangulate",
        "blender.mesh.edit_extrude_region",
        "blender.mesh.edit_bevel_edges",
        "blender.mesh.edit_inset_faces",
        "blender.mesh.edit_poke_faces",
        "blender.modifier.add_bevel",
        "blender.modifier.add_mirror",
        "blender.modifier.add_solidify",
        "blender.modifier.add_subdivision_surface",
        "blender.geometry_nodes.create_transform",
        "blender.geometry_nodes.create_light_trails",
        "blender.lookdev.create_light_trails_scene",
        "blender.material.create_and_assign",
        "blender.material.create_palette_and_assign",
        "blender.rig.create_armature",
        "blender.rig.bind_skin_weights",
        "blender.animation.create_pose_keyframes",
        "blender.render_scene.create",
        "blender.render_rig.create",
        "blender.render.execute_preview",
        # Compatibility with the original bundled plan.
        "snowman.body_lower",
        "snowman.body_upper",
        "snowman.head",
    }
)


def parent_identity(resource: Any) -> ParentIdentity:
    if isinstance(resource, bpy.types.Scene):
        return ParentIdentity("SCENE", resource.session_uid)
    if isinstance(resource, bpy.types.Collection):
        return ParentIdentity("COLLECTION", resource.session_uid)
    raise TypeError(f"Unsupported Collection parent type: {type(resource).__name__}")


def _collection_parent_links(
    collection: bpy.types.Collection,
) -> tuple[ParentIdentity, ...]:
    collection_uid = collection.session_uid
    links = [
        parent_identity(scene)
        for scene in bpy.data.scenes
        if any(
            child.session_uid == collection_uid
            for child in scene.collection.children
        )
    ]
    links.extend(
        parent_identity(parent)
        for parent in bpy.data.collections
        if any(
            child.session_uid == collection_uid for child in parent.children
        )
    )
    return tuple(
        sorted(links, key=lambda item: (item.resource_type, item.session_uid))
    )


def _resource_type(resource: Any) -> str:
    resource_type = next(
        (
            kind
            for kind, blender_type in (
                ("OBJECT", bpy.types.Object),
                ("MESH", bpy.types.Mesh),
                ("MATERIAL", bpy.types.Material),
                ("COLLECTION", bpy.types.Collection),
                ("SCENE", bpy.types.Scene),
                ("WORLD", bpy.types.World),
                ("LIGHT", bpy.types.Light),
                ("CAMERA", bpy.types.Camera),
                ("ARMATURE", bpy.types.Armature),
                ("ACTION", bpy.types.Action),
                ("NODE_GROUP", bpy.types.NodeTree),
            )
            if isinstance(resource, blender_type)
        ),
        "",
    )
    if not resource_type:
        raise TypeError(f"Unsupported Blender resource type: {type(resource).__name__}")
    return resource_type


def tag_resource(
    resource: Any,
    logical_id: str,
    receipt_id: str,
    step_id: str,
    action_name: str,
) -> ResourceIdentity:
    # Resolve every identity field before the first custom-property write.  A
    # caller using journal_created_resource can then delete a just-created ID if
    # any subsequent tag write fails, without leaving a partially owned block.
    resource_type = _resource_type(resource)
    display_name = resource.name
    pointer = resource.as_pointer()
    session_uid = resource.session_uid
    resource[OWNED_KEY] = True
    resource[OWNER_KEY] = OWNER_VALUE
    resource[ACTION_KEY] = action_name
    resource[STEP_KEY] = step_id
    resource[ROLLBACK_TOKEN_KEY] = receipt_id
    resource[LOGICAL_ID_KEY] = logical_id
    return ResourceIdentity(
        resource_type=resource_type,
        logical_id=logical_id,
        display_name=display_name,
        pointer=pointer,
        session_uid=session_uid,
        receipt_token=receipt_id,
        step_id=step_id,
        action_name=action_name,
    )


def _remove_unjournaled_resource(resource: Any, resource_type: str) -> None:
    """Delete a newly created Blender ID before it can escape unjournaled."""

    if resource_type == "OBJECT":
        bpy.data.objects.remove(resource, do_unlink=True)
    elif resource_type == "MESH":
        bpy.data.meshes.remove(resource)
    elif resource_type == "MATERIAL":
        bpy.data.materials.remove(resource)
    elif resource_type == "COLLECTION":
        bpy.data.collections.remove(resource)
    elif resource_type == "SCENE":
        bpy.data.scenes.remove(resource)
    elif resource_type == "WORLD":
        bpy.data.worlds.remove(resource)
    elif resource_type == "LIGHT":
        bpy.data.lights.remove(resource)
    elif resource_type == "CAMERA":
        bpy.data.cameras.remove(resource)
    elif resource_type == "ARMATURE":
        bpy.data.armatures.remove(resource)
    elif resource_type == "ACTION":
        bpy.data.actions.remove(resource)
    elif resource_type == "NODE_GROUP":
        bpy.data.node_groups.remove(resource)
    else:  # pragma: no cover - _resource_type defines the closed set
        raise TypeError(f"Unsupported Blender resource type: {resource_type}")


def journal_created_resource(
    created: list[ResourceIdentity],
    resource: Any,
    logical_id: str,
    receipt_id: str,
    step_id: str,
    action_name: str,
) -> ResourceIdentity:
    """Atomically tag and journal a newly created Blender data-block.

    The data-block is removed if identity capture, custom-property tagging, or
    journal insertion fails.  This closes the otherwise untracked interval
    between ``bpy.data.*.new`` and ``created.append``.
    """

    resource_type: str | None = None
    try:
        resource_type = _resource_type(resource)
        identity = tag_resource(
            resource,
            logical_id,
            receipt_id,
            step_id,
            action_name,
        )
        created.append(identity)
    except Exception:
        try:
            resource_type = resource_type or _resource_type(resource)
            _remove_unjournaled_resource(resource, resource_type)
        except Exception as cleanup_error:
            raise ActionAtomicityError(
                f"{action_name} could not journal or remove a newly created "
                f"Blender resource: {logical_id}"
            ) from cleanup_error
        raise
    return identity


def reference_data_block(resource: Any) -> DataBlockReference:
    """Freeze an unowned Blender ID reference across native Undo reconstruction."""
    resource_type = next(
        (
            kind
            for kind, blender_type in (
                ("OBJECT", bpy.types.Object),
                ("MESH", bpy.types.Mesh),
                ("MATERIAL", bpy.types.Material),
                ("COLLECTION", bpy.types.Collection),
                ("SCENE", bpy.types.Scene),
                ("WORLD", bpy.types.World),
                ("LIGHT", bpy.types.Light),
                ("CAMERA", bpy.types.Camera),
                ("ARMATURE", bpy.types.Armature),
                ("ACTION", bpy.types.Action),
                ("NODE_GROUP", bpy.types.NodeTree),
            )
            if isinstance(resource, blender_type)
        ),
        "",
    )
    if not resource_type:
        raise TypeError(f"Unsupported Blender data-block type: {type(resource).__name__}")
    return DataBlockReference(
        resource_type=resource_type,
        display_name=resource.name,
        pointer=resource.as_pointer(),
        session_uid=resource.session_uid,
    )


_MODIFIER_PRESENTATION_PROPERTIES = frozenset(
    {
        "is_active",
        "name",
        "rna_type",
        "show_expanded",
        "show_group_selector",
        "use_pin_to_last",
    }
)


def _freeze_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    try:
        return tuple(_freeze_value(component) for component in value)
    except TypeError:
        return repr(value)


def _writable_scalar_properties(
    value: Any, *, excluded: frozenset[str]
) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    for property_definition in value.bl_rna.properties:
        name = property_definition.identifier
        if (
            property_definition.is_readonly
            or property_definition.type not in {"BOOLEAN", "ENUM", "FLOAT", "INT", "STRING"}
            or name in excluded
            or name.startswith("open_")
        ):
            continue
        properties[name] = _freeze_value(getattr(value, name))
    return properties


def snapshot_modifier(
    owner: bpy.types.Object,
    modifier: Any,
    logical_id: str,
    receipt_id: str,
    step_id: str,
    action_name: str,
    properties: Mapping[str, Any],
) -> ModifierState:
    """Snapshot an action-owned modifier, which is not a Blender ID."""
    stack_index = next(
        (
            index
            for index, candidate in enumerate(owner.modifiers)
            if candidate.as_pointer() == modifier.as_pointer()
        ),
        -1,
    )
    if stack_index < 0:
        raise RuntimeError(f"Modifier is not attached to {owner.name}: {modifier.name}")
    tracked_properties = _writable_scalar_properties(
        modifier,
        excluded=_MODIFIER_PRESENTATION_PROPERTIES,
    )
    tracked_properties.update(properties)
    return ModifierState(
        logical_id=logical_id,
        display_name=modifier.name,
        modifier_type=modifier.type,
        pointer=modifier.as_pointer(),
        stack_index=stack_index,
        receipt_token=receipt_id,
        step_id=step_id,
        action_name=action_name,
        properties=tuple(sorted(tracked_properties.items())),
    )


def find_owned_modifier(
    receipts: Mapping[str, ActionReceipt], logical_id: str
) -> tuple[bpy.types.Object, Any] | None:
    for receipt in receipts.values():
        for mutation in receipt.mutations:
            state = mutation.after
            if not isinstance(state, ModifierState) or state.logical_id != logical_id:
                continue
            target = resolve_resource(mutation.resource)
            if not isinstance(target, bpy.types.Object):
                return None
            modifier = _modifier_at_pointer(target, state.pointer)
            if modifier is None or not _modifier_matches_state(target, state):
                return None
            return target, modifier
    return None


def _vertex_group_assignments(
    target: bpy.types.Object,
    group_index: int,
) -> tuple[tuple[int, float], ...]:
    assignments: list[tuple[int, float]] = []
    for vertex in target.data.vertices:
        membership = next(
            (item for item in vertex.groups if item.group == group_index),
            None,
        )
        if membership is not None:
            assignments.append((vertex.index, float(membership.weight)))
    return tuple(assignments)


def snapshot_skin_weights(
    target: bpy.types.Object,
    groups: Iterable[Any],
    logical_id: str,
    receipt_id: str,
    step_id: str,
    action_name: str,
) -> SkinWeightsState:
    """Snapshot action-created vertex groups without relying on RNA pointers."""
    states = tuple(
        VertexGroupState(
            display_name=group.name,
            stack_index=group.index,
            lock_weight=bool(group.lock_weight),
            assignments=_vertex_group_assignments(target, group.index),
        )
        for group in groups
    )
    if not states:
        raise RuntimeError("Skin binding must create at least one vertex group")
    return SkinWeightsState(
        logical_id=logical_id,
        receipt_token=receipt_id,
        step_id=step_id,
        action_name=action_name,
        vertex_count=len(target.data.vertices),
        groups=states,
    )


def skin_weights_state_matches(
    target: bpy.types.Object,
    state: SkinWeightsState,
) -> bool:
    """Compare current vertex groups to an exact bounded weight snapshot."""
    if target.type != "MESH" or len(target.data.vertices) != state.vertex_count:
        return False
    for expected in state.groups:
        if not 0 <= expected.stack_index < len(target.vertex_groups):
            return False
        group = target.vertex_groups[expected.stack_index]
        if (
            group.name != expected.display_name
            or bool(group.lock_weight) != expected.lock_weight
            or _vertex_group_assignments(target, group.index) != expected.assignments
        ):
            return False
    return True


def find_owned_skin_weights(
    receipts: Mapping[str, ActionReceipt], logical_id: str
) -> tuple[bpy.types.Object, SkinWeightsState] | None:
    for receipt in receipts.values():
        for mutation in receipt.mutations:
            state = mutation.after
            if not isinstance(state, SkinWeightsState) or state.logical_id != logical_id:
                continue
            target = resolve_resource(mutation.resource)
            if not isinstance(target, bpy.types.Object):
                return None
            if not skin_weights_state_matches(target, state):
                return None
            return target, state
    return None


def ensure_modifier_id_available(
    receipts: Mapping[str, ActionReceipt], logical_id: str
) -> None:
    if any(
        isinstance(mutation.after, ModifierState)
        and mutation.after.logical_id == logical_id
        for receipt in receipts.values()
        for mutation in receipt.mutations
    ):
        raise RuntimeError(f"Logical modifier already exists: {logical_id}")


def mesh_content_signature(mesh: bpy.types.Mesh) -> tuple[Any, ...]:
    """Capture bounded mesh content so compensation fails closed after edits."""
    attributes = tuple(
        sorted(
            (
                attribute.name,
                attribute.data_type,
                attribute.domain,
                tuple(
                    _freeze_value(
                        next(
                            getattr(item, field)
                            for field in (
                                "value",
                                "vector",
                                "color",
                                "byte_color",
                                "quaternion",
                                "matrix",
                            )
                            if hasattr(item, field)
                        )
                    )
                    for item in attribute.data
                ),
            )
            for attribute in mesh.attributes
            if not attribute.name.startswith(".select_")
        )
    )
    vertex_groups = tuple(
        tuple(sorted((int(group.group), float(group.weight)) for group in vertex.groups))
        for vertex in mesh.vertices
    )
    shape_keys = (
        None
        if mesh.shape_keys is None
        else (
            mesh.shape_keys.session_uid,
            tuple(
                (
                    block.name,
                    tuple(tuple(float(component) for component in item.co) for item in block.data),
                )
                for block in mesh.shape_keys.key_blocks
            ),
        )
    )
    return (
        tuple(tuple(float(component) for component in vertex.co) for vertex in mesh.vertices),
        tuple(tuple(int(index) for index in edge.vertices) for edge in mesh.edges),
        tuple(
            (
                tuple(int(index) for index in polygon.vertices),
                int(polygon.material_index),
                bool(polygon.use_smooth),
            )
            for polygon in mesh.polygons
        ),
        attributes,
        vertex_groups,
        shape_keys,
    )


def _socket_default_value(socket: Any) -> Any:
    if not hasattr(socket, "default_value"):
        return None
    value = socket.default_value
    if isinstance(value, (bool, int, float, str)):
        return value
    try:
        return tuple(float(component) for component in value)
    except (TypeError, ValueError):
        return repr(value)


def node_tree_signature(node_group: bpy.types.NodeTree) -> tuple[Any, ...]:
    """Capture the first-slice Geometry Nodes graph and public interface."""
    interface = tuple(
        (
            item.item_type,
            item.name,
            getattr(item, "in_out", None),
            getattr(item, "socket_type", None),
            getattr(item, "description", None),
            getattr(item, "hide_value", None),
            getattr(item, "attribute_domain", None),
            getattr(item, "default_attribute_name", None),
        )
        for item in node_group.interface.items_tree
    )
    nodes = tuple(
        sorted(
            (
                node.name,
                node.bl_idname,
                node.label,
                bool(node.mute),
                bool(node.hide),
                tuple(float(component) for component in node.location),
                float(node.width),
                tuple(
                    (socket.identifier, _socket_default_value(socket))
                    for socket in node.inputs
                ),
            )
            for node in node_group.nodes
        )
    )
    links = tuple(
        sorted(
            (
                link.from_node.name,
                link.from_socket.identifier,
                link.to_node.name,
                link.to_socket.identifier,
            )
            for link in node_group.links
        )
    )
    return interface, nodes, links


_NODE_PRESENTATION_PROPERTIES = frozenset(
    {
        "bl_idname",
        "bl_label",
        "bl_static_type",
        "color",
        "dimensions",
        "draw_buttons_ext",
        "height",
        "hide",
        "label",
        "location",
        "name",
        "parent",
        "rna_type",
        "select",
        "show_options",
        "show_preview",
        "show_texture",
        "use_custom_color",
        "width",
        "width_hidden",
    }
)


def node_tree_semantic_signature(node_group: bpy.types.NodeTree) -> tuple[Any, ...]:
    """Capture graph semantics for newer bounded node recipes.

    The original signature remains stable for existing receipts. New recipes use
    this versioned mutation attribute so enum modes such as Math.operation and
    node output defaults are also protected without invalidating old sessions.
    """
    base = node_tree_signature(node_group)
    semantics = tuple(
        sorted(
            (
                node.name,
                tuple(
                    sorted(
                        _writable_scalar_properties(
                            node,
                            excluded=_NODE_PRESENTATION_PROPERTIES,
                        ).items()
                    )
                ),
                tuple(
                    (socket.identifier, _socket_default_value(socket))
                    for socket in node.outputs
                ),
            )
            for node in node_group.nodes
        )
    )
    return base, semantics


def embedded_node_tree_semantic_signature(resource: Any) -> tuple[Any, ...]:
    """Capture the semantic node tree embedded in an owned ID datablock.

    Materials, worlds, and scenes own their shader/compositor trees rather than
    exposing those trees as independently removable Blender IDs.  New bounded
    recipes use this signature to make later graph edits fail closed during
    receipt integrity checks and compensation.
    """
    node_tree = getattr(resource, "node_tree", None)
    if not isinstance(node_tree, bpy.types.NodeTree):
        raise TypeError(
            f"Resource has no embedded node tree: {type(resource).__name__}"
        )
    return node_tree_semantic_signature(node_tree)


def _material_principled_surface(
    material: bpy.types.Material,
) -> tuple[Any, Any, Any, Any]:
    if not material.use_nodes or not isinstance(material.node_tree, bpy.types.NodeTree):
        raise RuntimeError(f"Material has no enabled node tree: {material.name}")
    principled_nodes = tuple(
        node
        for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeBsdfPrincipled"
    )
    output_nodes = tuple(
        node
        for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
    )
    if len(principled_nodes) != 1 or len(output_nodes) != 1:
        raise RuntimeError(
            "Material surface must contain exactly one Principled BSDF and "
            f"one Material Output node: {material.name}"
        )
    principled = principled_nodes[0]
    sockets = []
    for identifier in ("Base Color", "Roughness", "Metallic"):
        matches = tuple(
            socket for socket in principled.inputs if socket.identifier == identifier
        )
        if len(matches) != 1:
            raise RuntimeError(
                f"Material Principled input is unavailable: {material.name}.{identifier}"
            )
        sockets.append(matches[0])
    return principled, sockets[0], sockets[1], sockets[2]


def snapshot_material_surface(material: bpy.types.Material) -> MaterialSurfaceState:
    """Capture the bounded material and Principled values owned by one action."""

    _principled, base_color, roughness, metallic = _material_principled_surface(
        material
    )
    return MaterialSurfaceState(
        display_name=material.name,
        use_nodes=bool(material.use_nodes),
        diffuse_color=tuple(float(channel) for channel in material.diffuse_color),
        roughness=float(material.roughness),
        metallic=float(material.metallic),
        principled_base_color=tuple(
            float(channel) for channel in base_color.default_value
        ),
        principled_roughness=float(roughness.default_value),
        principled_metallic=float(metallic.default_value),
        node_tree_signature=embedded_node_tree_semantic_signature(material),
    )


def restore_material_surface(
    material: bpy.types.Material, state: MaterialSurfaceState
) -> None:
    """Restore a previously captured bounded material surface state."""

    material.name = state.display_name
    material.use_nodes = state.use_nodes
    _principled, base_color, roughness, metallic = _material_principled_surface(
        material
    )
    material.diffuse_color = state.diffuse_color
    material.roughness = state.roughness
    material.metallic = state.metallic
    base_color.default_value = state.principled_base_color
    roughness.default_value = state.principled_roughness
    metallic.default_value = state.principled_metallic
    if snapshot_material_surface(material) != state:
        raise RuntimeError(f"Material surface restore changed: {material.name}")


_RESOURCE_COLLECTIONS = {
    "OBJECT": lambda: bpy.data.objects,
    "MESH": lambda: bpy.data.meshes,
    "MATERIAL": lambda: bpy.data.materials,
    "COLLECTION": lambda: bpy.data.collections,
    "SCENE": lambda: bpy.data.scenes,
    "WORLD": lambda: bpy.data.worlds,
    "LIGHT": lambda: bpy.data.lights,
    "CAMERA": lambda: bpy.data.cameras,
    "ARMATURE": lambda: bpy.data.armatures,
    "ACTION": lambda: bpy.data.actions,
    "NODE_GROUP": lambda: bpy.data.node_groups,
}


def resolve_resource(identity: ResourceIdentity) -> Any | None:
    resource = _resource_at_pointer(identity)
    if resource is None:
        return None
    if (
        resource.get(OWNER_KEY) == OWNER_VALUE
        and resource.get(ROLLBACK_TOKEN_KEY) == identity.receipt_token
        and resource.get(LOGICAL_ID_KEY) == identity.logical_id
        and (not identity.step_id or resource.get(STEP_KEY) == identity.step_id)
        and (not identity.action_name or resource.get(ACTION_KEY) == identity.action_name)
    ):
        return resource
    return None


def _data_block_at_identity(
    identity: ResourceIdentity | DataBlockReference,
) -> Any | None:
    collection_factory = _RESOURCE_COLLECTIONS.get(identity.resource_type)
    if collection_factory is None:
        return None
    resources = tuple(collection_factory())
    for resource in resources:
        if resource.session_uid == identity.session_uid:
            return resource
    for resource in resources:
        if resource.as_pointer() == identity.pointer:
            return resource
    return None


def _resource_at_pointer(identity: ResourceIdentity) -> Any | None:
    return _data_block_at_identity(identity)


def resolve_data_block(reference: DataBlockReference) -> Any | None:
    collection_factory = _RESOURCE_COLLECTIONS.get(reference.resource_type)
    if collection_factory is None:
        return None
    resources = tuple(collection_factory())
    for resource in resources:
        if resource.session_uid == reference.session_uid:
            return resource
    return None


def _rebind_value(value: Any) -> Any:
    if isinstance(value, ResourceIdentity):
        resource = resolve_resource(value)
        if resource is None:
            raise RuntimeError(
                f"Native history resource is unavailable: {value.logical_id}"
            )
        return replace(
            value,
            display_name=resource.name,
            pointer=resource.as_pointer(),
            session_uid=resource.session_uid,
        )
    if isinstance(value, DataBlockReference):
        resource = resolve_data_block(value)
        if resource is None:
            raise RuntimeError(
                f"Native history data-block is unavailable: {value.display_name}"
            )
        return replace(
            value,
            display_name=resource.name,
            pointer=resource.as_pointer(),
            session_uid=resource.session_uid,
        )
    if isinstance(value, tuple):
        return tuple(_rebind_value(item) for item in value)
    if isinstance(value, list):
        return [_rebind_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _rebind_value(item) for key, item in value.items()}
    return value


def _rebind_modifier_state(target: bpy.types.Object, state: ModifierState) -> ModifierState:
    if not 0 <= state.stack_index < len(target.modifiers):
        raise RuntimeError(f"Native history modifier is unavailable: {state.logical_id}")
    candidate = target.modifiers[state.stack_index]
    rebound_properties = tuple(
        (name, _rebind_value(value)) for name, value in state.properties
    )
    rebound = replace(
        state,
        pointer=candidate.as_pointer(),
        properties=rebound_properties,
    )
    if not _modifier_matches_state(target, rebound):
        raise RuntimeError(f"Native history modifier changed: {state.logical_id}")
    return rebound


def rebind_receipts_after_native_restore(
    receipts: Mapping[str, ActionReceipt],
) -> dict[str, ActionReceipt]:
    """Rebind RNA pointers after Blender reconstructs IDs during Undo/Redo."""
    rebound_receipts: dict[str, ActionReceipt] = {}
    for step_id, receipt in receipts.items():
        created = tuple(_rebind_value(identity) for identity in receipt.created)
        mutations: list[MutationRecord] = []
        for mutation in receipt.mutations:
            resource_identity = _rebind_value(mutation.resource)
            before = _rebind_value(mutation.before)
            after = _rebind_value(mutation.after)
            if isinstance(after, ModifierState):
                target = resolve_resource(resource_identity)
                if not isinstance(target, bpy.types.Object):
                    raise RuntimeError(
                        f"Native history modifier owner is unavailable: {after.logical_id}"
                    )
                after = _rebind_modifier_state(target, after)
            if isinstance(before, ModifierState):
                target = resolve_resource(resource_identity)
                if not isinstance(target, bpy.types.Object):
                    raise RuntimeError(
                        f"Native history modifier owner is unavailable: {before.logical_id}"
                    )
                before = _rebind_modifier_state(target, before)
            mutations.append(
                MutationRecord(resource_identity, mutation.attribute, before, after)
            )
        rebound_receipts[step_id] = replace(
            receipt,
            created=created,
            mutations=tuple(mutations),
            anchor=(
                _rebind_value(receipt.anchor)
                if receipt.anchor is not None
                else None
            ),
        )
    return rebound_receipts


def build_resource_registry(
    receipts: Mapping[str, ActionReceipt] | Iterable[ActionReceipt],
) -> dict[str, ResourceIdentity]:
    values = receipts.values() if isinstance(receipts, Mapping) else receipts
    registry: dict[str, ResourceIdentity] = {}
    for receipt in values:
        for resource in receipt.created:
            if resolve_resource(resource) is not None:
                if resource.logical_id in registry:
                    raise RuntimeError(
                        f"Duplicate logical resource identity: {resource.logical_id}"
                    )
                registry[resource.logical_id] = resource
    return registry


def resolve_receipt_anchor(receipt: ActionReceipt) -> bpy.types.Object | None:
    if receipt.anchor is None or receipt.anchor.resource_type != "OBJECT":
        return None
    resource = resolve_resource(receipt.anchor)
    return resource if isinstance(resource, bpy.types.Object) else None


def find_artifact(
    receipts: Mapping[str, ActionReceipt] | Iterable[ActionReceipt],
    logical_id: str,
) -> ArtifactIdentity | None:
    values = receipts.values() if isinstance(receipts, Mapping) else receipts
    for receipt in reversed(tuple(values)):
        for artifact in receipt.artifacts:
            if artifact.logical_id == logical_id:
                return artifact
    return None


def owned_resource(
    registry: Mapping[str, ResourceIdentity],
    logical_id: str,
    expected_type: str,
) -> tuple[ResourceIdentity, Any]:
    identity = registry.get(logical_id)
    if identity is None or identity.resource_type != expected_type:
        raise ValueError(f"Unknown owned {expected_type.lower()} resource: {logical_id}")
    resource = resolve_resource(identity)
    if resource is None:
        raise RuntimeError(f"Owned resource is no longer available: {logical_id}")
    return identity, resource


def ensure_name_available(collection: Any, name: str, label: str) -> None:
    """Read-only action preflight for a Blender data-block name.

    Every action call site invokes this before its first host mutation.  That
    invariant lets the operator cancel without creating a quarantine checkpoint
    when the requested name already exists.
    """

    if collection.get(name) is not None:
        error = RuntimeError(f"Cannot replace existing {label}: {name}")
        attest_action_host_state_restored(error)
        raise error


def ensure_logical_ids_available(
    registry: Mapping[str, ResourceIdentity],
    logical_ids: Iterable[str],
) -> None:
    """Reject duplicate, derived, or previously owned logical resource IDs."""
    requested = tuple(logical_ids)
    if len(set(requested)) != len(requested):
        raise ValueError("Created logical resource IDs must be unique")
    for logical_id in requested:
        if logical_id in registry:
            raise RuntimeError(f"Logical resource already exists: {logical_id}")


def ensure_collection_contents_tracked(
    collection: bpy.types.Collection,
    registry: Mapping[str, ResourceIdentity],
) -> None:
    """Reject user or copied resources before an owned collection is rendered."""
    tracked_object_pointers = {
        resource.as_pointer()
        for identity in registry.values()
        if identity.resource_type == "OBJECT"
        for resource in (resolve_resource(identity),)
        if isinstance(resource, bpy.types.Object)
    }
    if collection.children or any(
        obj.as_pointer() not in tracked_object_pointers
        for obj in collection.all_objects
    ):
        raise RuntimeError(
            "OperatingLine collection contains an untracked object or child collection"
        )


def _same_value(current: Any, expected: Any) -> bool:
    if isinstance(expected, ResourceIdentity):
        resolved = resolve_resource(expected)
        return current is resolved
    if isinstance(expected, DataBlockReference):
        return current is resolve_data_block(expected)
    if isinstance(expected, tuple):
        return tuple(current) == expected
    return current == expected


def _resolve_stored(value: Any) -> Any:
    if isinstance(value, ResourceIdentity):
        return resolve_resource(value)
    if isinstance(value, DataBlockReference):
        return resolve_data_block(value)
    return value


def _matrix_rows(value: Any) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(float(component) for component in row) for row in value)


def action_fcurves(action: bpy.types.Action) -> tuple[Any, ...]:
    """Return Action FCurves across Blender's legacy and layered APIs."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return tuple(legacy)
    curves: list[Any] = []
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in getattr(strip, "channelbags", ()):
                curves.extend(channelbag.fcurves)
    return tuple(curves)


def action_keyframe_signature(action: bpy.types.Action) -> tuple[Any, ...]:
    """Capture the bounded curve content so later edits block compensation."""
    curves = []
    for curve in action_fcurves(action):
        points = tuple(
            (
                tuple(float(value) for value in point.co),
                point.interpolation,
                point.easing,
                point.handle_left_type,
                tuple(float(value) for value in point.handle_left),
                point.handle_right_type,
                tuple(float(value) for value in point.handle_right),
                point.type,
            )
            for point in curve.keyframe_points
        )
        curves.append(
            (
                curve.data_path,
                curve.array_index,
                curve.extrapolation,
                curve.mute,
                curve.group.name if curve.group is not None else None,
                tuple(modifier.type for modifier in curve.modifiers),
                points,
            )
        )
    return tuple(sorted(curves, key=lambda item: (item[0], item[1])))


def _bone_parent_matches(target: bpy.types.Object, recorded: Any) -> bool:
    if not isinstance(recorded, tuple) or len(recorded) != 5:
        return False
    parent, parent_type, parent_bone, parent_inverse, matrix_basis = recorded
    return (
        _same_value(target.parent, parent)
        and target.parent_type == parent_type
        and target.parent_bone == parent_bone
        and _matrix_rows(target.matrix_parent_inverse) == parent_inverse
        and _matrix_rows(target.matrix_basis) == matrix_basis
    )


def _animation_action_matches(target: bpy.types.Object, recorded: Any) -> bool:
    animation_data = target.animation_data
    if isinstance(recorded, ResourceIdentity):
        return (
            animation_data is not None
            and animation_data.action is resolve_resource(recorded)
        )
    if not isinstance(recorded, tuple) or len(recorded) != 2:
        return False
    had_animation_data, action = recorded
    return (
        (animation_data is not None) is had_animation_data
        and (
            animation_data.action if animation_data is not None else None
        ) is _resolve_stored(action)
    )


def _pose_bone_matches(
    target: bpy.types.Object,
    attribute: str,
    recorded: Any,
) -> bool:
    bone_name = attribute.partition(":")[2]
    pose_bone = target.pose.bones.get(bone_name) if target.pose is not None else None
    if pose_bone is None:
        return False
    if isinstance(recorded, ResourceIdentity):
        return _animation_action_matches(target, recorded)
    if not isinstance(recorded, PoseBoneState):
        return False
    return (
        pose_bone.rotation_mode == recorded.rotation_mode
        and tuple(float(value) for value in pose_bone.location)
        == recorded.location
        and tuple(float(value) for value in pose_bone.rotation_euler)
        == recorded.rotation_euler
        and tuple(float(value) for value in pose_bone.rotation_quaternion)
        == recorded.rotation_quaternion
        and tuple(float(value) for value in pose_bone.rotation_axis_angle)
        == recorded.rotation_axis_angle
        and tuple(float(value) for value in pose_bone.scale) == recorded.scale
    )


def _armature_bone_deform_matches(target: Any, attribute: str, recorded: Any) -> bool:
    bone_name = attribute.partition(":")[2]
    bone = target.bones.get(bone_name) if isinstance(target, bpy.types.Armature) else None
    return bone is not None and isinstance(recorded, bool) and bone.use_deform is recorded


def _skin_weights_matches_value(mutation: MutationRecord, recorded: Any) -> bool:
    target = resolve_resource(mutation.resource)
    if not isinstance(target, bpy.types.Object) or target.type != "MESH":
        return False
    state = mutation.after
    if not isinstance(state, SkinWeightsState):
        return False
    if recorded is None:
        return all(target.vertex_groups.get(group.display_name) is None for group in state.groups)
    return isinstance(recorded, SkinWeightsState) and skin_weights_state_matches(
        target, recorded
    )


def _modifier_at_pointer(target: bpy.types.Object, pointer: int) -> Any | None:
    return next(
        (modifier for modifier in target.modifiers if modifier.as_pointer() == pointer),
        None,
    )


def _modifier_property_matches(modifier: Any, name: str, expected: Any) -> bool:
    current = modifier
    for part in name.split("."):
        current = getattr(current, part)
    return _same_value(current, expected)


def _modifier_matches_state(target: bpy.types.Object, state: ModifierState) -> bool:
    modifier = _modifier_at_pointer(target, state.pointer)
    return bool(
        modifier is not None
        and state.stack_index < len(target.modifiers)
        and target.modifiers[state.stack_index].as_pointer() == state.pointer
        and modifier.name == state.display_name
        and modifier.type == state.modifier_type
        and all(
            _modifier_property_matches(modifier, name, expected)
            for name, expected in state.properties
        )
    )


def _modifier_matches_value(mutation: MutationRecord, recorded: Any) -> bool:
    target = resolve_resource(mutation.resource)
    if not isinstance(target, bpy.types.Object):
        return False
    after = mutation.after
    if recorded is None:
        if not isinstance(after, ModifierState):
            return False
        return _modifier_at_pointer(target, after.pointer) is None
    return isinstance(recorded, ModifierState) and _modifier_matches_state(
        target, recorded
    )


def _mutation_matches_value(mutation: MutationRecord, recorded: Any) -> bool:
    target = resolve_resource(mutation.resource)
    if target is None:
        return False
    if mutation.attribute.startswith("skin_weights:"):
        return _skin_weights_matches_value(mutation, recorded)
    if mutation.attribute.startswith("modifier:"):
        return _modifier_matches_value(mutation, recorded)
    if mutation.attribute.startswith("armature_bone_use_deform:"):
        return _armature_bone_deform_matches(target, mutation.attribute, recorded)
    if mutation.attribute == "material_surface":
        return bool(
            isinstance(target, bpy.types.Material)
            and isinstance(recorded, MaterialSurfaceState)
            and snapshot_material_surface(target) == recorded
        )
    if mutation.attribute == "mesh_content":
        return (
            isinstance(target, bpy.types.Mesh)
            and recorded is not None
            and mesh_content_signature(target) == recorded
        )
    if mutation.attribute == "node_tree_signature":
        return (
            isinstance(target, bpy.types.NodeTree)
            and recorded is not None
            and node_tree_signature(target) == recorded
        )
    if mutation.attribute == "node_tree_semantic_signature_v2":
        return (
            isinstance(target, bpy.types.NodeTree)
            and recorded is not None
            and node_tree_semantic_signature(target) == recorded
        )
    if mutation.attribute == "embedded_node_tree_semantic_signature_v1":
        node_tree = getattr(target, "node_tree", None)
        return (
            isinstance(node_tree, bpy.types.NodeTree)
            and recorded is not None
            and node_tree_semantic_signature(node_tree) == recorded
        )
    if mutation.attribute == "collection_children":
        current = tuple(target.collection.children)
        expected = tuple(_resolve_stored(item) for item in recorded)
        return current == expected
    if mutation.attribute == "users_collection":
        current = tuple(target.users_collection)
        expected = tuple(_resolve_stored(item) for item in recorded)
        return current == expected
    if mutation.attribute == "material_slots":
        current = tuple(slot.material for slot in target.material_slots)
        expected = tuple(_resolve_stored(item) for item in recorded)
        return current == expected
    if mutation.attribute == "bone_parent":
        return _bone_parent_matches(target, recorded)
    if mutation.attribute == "animation_action":
        return _animation_action_matches(target, recorded)
    if mutation.attribute.startswith("pose_bone_state:"):
        return _pose_bone_matches(target, mutation.attribute, recorded)
    if mutation.attribute == "action_keyframes":
        return (
            isinstance(target, bpy.types.Action)
            and recorded is not None
            and action_keyframe_signature(target) == recorded
        )
    owner = target
    parts = mutation.attribute.split(".")
    for part in parts[:-1]:
        owner = getattr(owner, part)
    return _same_value(getattr(owner, parts[-1]), recorded)


def _mutation_matches_after(mutation: MutationRecord) -> bool:
    return _mutation_matches_value(mutation, mutation.after)


def _mutation_matches_before(mutation: MutationRecord) -> bool:
    raw_target = _resource_at_pointer(mutation.resource)
    if raw_target is None:
        return True
    return _mutation_matches_value(mutation, mutation.before)


def _restore_mutation(mutation: MutationRecord) -> None:
    target = resolve_resource(mutation.resource)
    if target is None:
        raise RuntimeError(
            f"Mutation target is unavailable: {mutation.resource.logical_id}"
        )
    if mutation.attribute.startswith("skin_weights:"):
        if mutation.before is not None or not isinstance(
            mutation.after, SkinWeightsState
        ):
            raise RuntimeError("Only action-created skin weights can be restored")
        if not isinstance(target, bpy.types.Object) or target.type != "MESH":
            raise RuntimeError("Skin weight mutation target is not a mesh object")
        for expected in sorted(
            mutation.after.groups,
            key=lambda item: item.stack_index,
            reverse=True,
        ):
            if not 0 <= expected.stack_index < len(target.vertex_groups):
                raise RuntimeError(
                    f"Vertex group is unavailable: {expected.display_name}"
                )
            group = target.vertex_groups[expected.stack_index]
            if group.name != expected.display_name:
                raise RuntimeError(f"Vertex group changed: {expected.display_name}")
            target.vertex_groups.remove(group)
        return
    if mutation.attribute.startswith("modifier:"):
        if mutation.before is not None or not isinstance(
            mutation.after, ModifierState
        ):
            raise RuntimeError("Only action-created modifiers can be restored")
        if not isinstance(target, bpy.types.Object):
            raise RuntimeError("Modifier mutation target is not an object")
        modifier = _modifier_at_pointer(target, mutation.after.pointer)
        if modifier is not None:
            target.modifiers.remove(modifier)
        return
    if mutation.attribute.startswith("armature_bone_use_deform:"):
        if not isinstance(target, bpy.types.Armature):
            raise RuntimeError("Bone deform mutation target is not armature data")
        bone_name = mutation.attribute.partition(":")[2]
        bone = target.bones.get(bone_name)
        if bone is None:
            raise RuntimeError(f"Armature bone is unavailable: {bone_name}")
        bone.use_deform = mutation.before
        return
    if mutation.attribute == "material_surface":
        if mutation.before is None:
            return
        if not isinstance(target, bpy.types.Material) or not isinstance(
            mutation.before, MaterialSurfaceState
        ):
            raise RuntimeError("Material surface mutation state is invalid")
        restore_material_surface(target, mutation.before)
        return
    if mutation.attribute in {
        "mesh_content",
        "node_tree_signature",
        "node_tree_semantic_signature_v2",
        "embedded_node_tree_semantic_signature_v1",
    }:
        return
    if mutation.attribute == "collection_children":
        for child in tuple(target.collection.children):
            target.collection.children.unlink(child)
        for identity in mutation.before:
            collection = _resolve_stored(identity)
            if collection is None:
                raise RuntimeError(
                    "Collection mutation dependency is unavailable: "
                    f"{mutation.resource.logical_id}"
                )
            target.collection.children.link(collection)
        return
    if mutation.attribute == "users_collection":
        for collection in tuple(target.users_collection):
            collection.objects.unlink(target)
        for identity in mutation.before:
            collection = _resolve_stored(identity)
            if collection is None:
                raise RuntimeError(
                    "Object collection dependency is unavailable: "
                    f"{mutation.resource.logical_id}"
                )
            collection.objects.link(target)
        return
    if mutation.attribute == "material_slots":
        target.data.materials.clear()
        for material in mutation.before:
            resolved = _resolve_stored(material)
            if resolved is not None:
                target.data.materials.append(resolved)
        return
    if mutation.attribute == "bone_parent":
        parent, parent_type, parent_bone, parent_inverse, matrix_basis = (
            mutation.before
        )
        target.parent = _resolve_stored(parent)
        target.parent_type = parent_type
        target.parent_bone = parent_bone
        target.matrix_parent_inverse = Matrix(parent_inverse)
        target.matrix_basis = Matrix(matrix_basis)
        return
    if mutation.attribute == "animation_action":
        had_animation_data, action = mutation.before
        animation_data = target.animation_data_create()
        animation_data.action = _resolve_stored(action)
        if not had_animation_data:
            target.animation_data_clear()
        return
    if mutation.attribute.startswith("pose_bone_state:"):
        bone_name = mutation.attribute.partition(":")[2]
        pose_bone = target.pose.bones.get(bone_name)
        if pose_bone is None:
            raise RuntimeError(f"Pose bone is unavailable: {bone_name}")
        if not isinstance(mutation.before, PoseBoneState):
            raise RuntimeError(f"Pose bone state is invalid: {bone_name}")
        pose_bone.rotation_mode = mutation.before.rotation_mode
        pose_bone.location = mutation.before.location
        pose_bone.rotation_euler = mutation.before.rotation_euler
        pose_bone.rotation_quaternion = mutation.before.rotation_quaternion
        pose_bone.rotation_axis_angle = mutation.before.rotation_axis_angle
        pose_bone.scale = mutation.before.scale
        return
    if mutation.attribute == "action_keyframes":
        return
    owner = target
    parts = mutation.attribute.split(".")
    for part in parts[:-1]:
        owner = getattr(owner, part)
    setattr(owner, parts[-1], _resolve_stored(mutation.before))


def ensure_receipts_intact(receipts: Mapping[str, ActionReceipt]) -> None:
    """Fail closed unless each tracked attribute matches its latest managed write."""
    terminal_mutations: dict[tuple[str, str, str], MutationRecord] = {}
    for receipt in receipts.values():
        for identity in receipt.created:
            if resolve_resource(identity) is None:
                raise RuntimeError(
                    f"Completed resource is no longer available: {identity.logical_id}"
                )
        for mutation in receipt.mutations:
            terminal_mutations[
                (
                    mutation.resource.resource_type,
                    mutation.resource.logical_id,
                    mutation.attribute,
                )
            ] = mutation
        for artifact in receipt.artifacts:
            path = Path(artifact.path)
            if (
                not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != artifact.sha256
            ):
                raise RuntimeError(
                    f"Completed artifact is no longer available: {artifact.logical_id}"
                )
    for mutation in terminal_mutations.values():
        if not _mutation_matches_after(mutation):
            raise RuntimeError(
                "Completed resource was modified: "
                f"{mutation.resource.logical_id}.{mutation.attribute}"
            )


def _created_objects(receipt: ActionReceipt) -> tuple[bpy.types.Object, ...]:
    return tuple(
        resource
        for identity in receipt.created
        if identity.resource_type == "OBJECT"
        for resource in (resolve_resource(identity),)
        if isinstance(resource, bpy.types.Object)
    )


def _parent_link_resource(identity: ParentIdentity) -> Any | None:
    resources = (
        bpy.data.scenes
        if identity.resource_type == "SCENE"
        else bpy.data.collections
        if identity.resource_type == "COLLECTION"
        else ()
    )
    return next(
        (
            resource
            for resource in resources
            if resource.session_uid == identity.session_uid
        ),
        None,
    )


def _stored_id_resources(value: Any) -> tuple[Any, ...]:
    if isinstance(value, ResourceIdentity):
        resource = resolve_resource(value)
        return () if resource is None else (resource,)
    if isinstance(value, DataBlockReference):
        resource = resolve_data_block(value)
        return () if resource is None else (resource,)
    if isinstance(value, (tuple, list)):
        return tuple(
            resource
            for item in value
            for resource in _stored_id_resources(item)
        )
    if isinstance(value, dict):
        return tuple(
            resource
            for item in value.values()
            for resource in _stored_id_resources(item)
        )
    if is_dataclass(value):
        return tuple(
            resource
            for field in fields(value)
            for resource in _stored_id_resources(getattr(value, field.name))
        )
    return ()


def _layer_collection_reference_count(
    layer_collection: Any,
    target: bpy.types.Collection,
) -> int:
    count = int(layer_collection.collection is target)
    return count + sum(
        _layer_collection_reference_count(child, target)
        for child in layer_collection.children
    )


def _scene_layer_reference_count(scene: bpy.types.Scene, target: Any) -> int:
    """Count derived ViewLayer references included by ``ID.user_of_id``."""

    if isinstance(target, bpy.types.Object):
        target_pointer = target.as_pointer()
        return sum(
            any(
                candidate is not None
                and candidate.as_pointer() == target_pointer
                for candidate in view_layer.objects
            )
            for view_layer in scene.view_layers
        )
    if isinstance(target, bpy.types.Collection):
        return sum(
            _layer_collection_reference_count(view_layer.layer_collection, target)
            for view_layer in scene.view_layers
        )
    return 0


def _expected_created_resource_user_counts(
    receipt: ActionReceipt,
    resolved_created: tuple[tuple[ResourceIdentity, Any], ...],
) -> dict[int, dict[int, int]]:
    """Count every receipt-authorized reference for each surviving owner ID."""

    expected = {
        resource.as_pointer(): {}
        for _identity, resource in resolved_created
    }

    def allow(created_resource: Any, user: Any | None, count: int = 1) -> None:
        if user is None or count <= 0 or not hasattr(user, "as_pointer"):
            return
        users = expected.get(created_resource.as_pointer())
        if users is None:
            return
        pointer = user.as_pointer()
        users[pointer] = users.get(pointer, 0) + count

    for identity, resource in resolved_created:
        for parent_identity_value in identity.parent_links:
            parent = _parent_link_resource(parent_identity_value)
            allow(resource, parent)

    for mutation in receipt.mutations:
        # Only a relation still in its recorded after-state can authorize an
        # owner edge.  In particular, before-values never grant authority.
        if not _mutation_matches_after(mutation):
            continue
        owner = resolve_resource(mutation.resource)
        if owner is None:
            continue
        after_resources = _stored_id_resources(mutation.after)
        if mutation.attribute == "users_collection":
            if owner.as_pointer() not in expected:
                continue
            for collection in after_resources:
                if not isinstance(collection, bpy.types.Collection):
                    continue
                allow(owner, collection)
            continue
        if mutation.attribute == "material_slots":
            if not isinstance(owner, bpy.types.Object):
                continue
            for resource in after_resources:
                if isinstance(resource, bpy.types.Material):
                    allow(resource, owner.data)
            continue
        if mutation.attribute.startswith("modifier:"):
            for resource in after_resources:
                if isinstance(resource, bpy.types.NodeTree):
                    allow(resource, owner)
            continue
        allowed_types = {
            "data": (
                bpy.types.Mesh,
                bpy.types.Light,
                bpy.types.Camera,
                bpy.types.Armature,
            ),
            "camera": (bpy.types.Object,),
            "animation_action": (bpy.types.Action,),
            "bone_parent": (bpy.types.Object,),
            "collection_children": (bpy.types.Collection,),
            "world": (bpy.types.World,),
            "compositing_node_group": (bpy.types.NodeTree,),
        }.get(mutation.attribute, ())
        for resource in after_resources:
            if allowed_types and isinstance(resource, allowed_types):
                allow(resource, owner)
    for _identity, resource in resolved_created:
        if not isinstance(resource, (bpy.types.Object, bpy.types.Collection)):
            continue
        for scene in bpy.data.scenes:
            allow(resource, scene, _scene_layer_reference_count(scene, resource))
    return expected


def _preflight_created_resource_id_users(receipt: ActionReceipt) -> None:
    """Reject ID users outside the receipt before Blender can unlink them.

    ``bpy.data.*.remove`` may rewrite arbitrary RNA pointers owned by another
    data-block.  Blender's ID user map catches those references even when they
    live inside nodes, constraints, parenting, or other nested RNA structures.
    Type-specific checks below still validate the exact expected relation and
    user count for managed users.
    """

    resolved_created = tuple(
        (identity, resource)
        for identity in receipt.created
        for resource in (resolve_resource(identity),)
        if resource is not None
    )
    if not resolved_created:
        return
    created_pointers = {
        resource.as_pointer() for _identity, resource in resolved_created
    }

    # Building Blender's ID user map synchronizes lazily-created ViewLayer
    # bases for newly linked objects.  Derive the expected Scene counts only
    # after that synchronization, otherwise a fresh light or camera can appear
    # in ``user_map`` while still being absent from ``view_layer.objects``.
    user_map = bpy.data.user_map(
        subset=tuple(resource for _identity, resource in resolved_created)
    )
    expected_user_counts = _expected_created_resource_user_counts(
        receipt,
        resolved_created,
    )
    for identity, resource in resolved_created:
        expected = expected_user_counts[resource.as_pointer()]
        actual_users = tuple(
            user
            for user in user_map.get(resource, ())
            if user.as_pointer() not in created_pointers
        )
        external_users = tuple(
            user for user in actual_users if user.as_pointer() not in expected
        )
        if not external_users:
            mismatched_users = tuple(
                user
                for user in actual_users
                if user.user_of_id(resource) != expected[user.as_pointer()]
            )
            if not mismatched_users:
                continue
            user = min(
                mismatched_users,
                key=lambda candidate: (type(candidate).__name__, candidate.name),
            )
            raise RuntimeError(
                "Cannot rollback resource with untracked references: "
                f"{identity.logical_id} ({type(user).__name__}:{user.name}; "
                f"expected {expected[user.as_pointer()]}, "
                f"found {user.user_of_id(resource)})"
            )
        external = min(external_users, key=lambda user: (type(user).__name__, user.name))
        raise RuntimeError(
            "Cannot rollback externally referenced resource: "
            f"{identity.logical_id} ({type(external).__name__}:{external.name})"
        )


def _preflight_created_resources(
    receipt: ActionReceipt,
    *,
    allow_incomplete: bool = False,
) -> None:
    created_objects = _created_objects(receipt)
    created_object_pointers = {obj.as_pointer() for obj in created_objects}
    mutation_target_pointers = {
        target.as_pointer()
        for mutation in receipt.mutations
        for target in (resolve_resource(mutation.resource),)
        if isinstance(target, bpy.types.Object)
    }
    created_scenes = {
        scene.as_pointer()
        for identity in receipt.created
        if identity.resource_type == "SCENE"
        for scene in (resolve_resource(identity),)
        if isinstance(scene, bpy.types.Scene)
    }

    for identity in receipt.created:
        raw = _resource_at_pointer(identity)
        if raw is None:
            continue
        resource = resolve_resource(identity)
        if resource is None:
            raise RuntimeError(
                f"Cannot rollback modified resource identity: {identity.logical_id}"
            )
        if identity.resource_type == "OBJECT":
            if any(
                collection.get(OWNER_KEY) != OWNER_VALUE
                for collection in resource.users_collection
            ):
                raise RuntimeError(
                    f"Cannot rollback externally linked object: {identity.logical_id}"
                )
            if resource.data is not None and not any(
                data_identity.resource_type
                in {"MESH", "LIGHT", "CAMERA", "ARMATURE"}
                and resolve_resource(data_identity) is resource.data
                for data_identity in receipt.created
            ):
                raise RuntimeError(
                    f"Cannot rollback object with replaced data: {identity.logical_id}"
                )
        elif identity.resource_type in {"MESH", "LIGHT", "CAMERA", "ARMATURE"}:
            internal_users = sum(
                obj.data is resource
                for obj in bpy.data.objects
                if obj.as_pointer() in created_object_pointers
                or obj.as_pointer() in mutation_target_pointers
            )
            if resource.users != internal_users:
                raise RuntimeError(
                    f"Cannot rollback externally used data: {identity.logical_id}"
                )
        elif identity.resource_type == "NODE_GROUP":
            modifier_users = {
                obj.as_pointer()
                for obj in bpy.data.objects
                for modifier in obj.modifiers
                if modifier.type == "NODES"
                and getattr(modifier, "node_group", None) is resource
            }
            compositor_scene_users = {
                scene.as_pointer()
                for scene in bpy.data.scenes
                if getattr(scene, "compositing_node_group", None) is resource
            }
            internal_user_count = len(modifier_users) + len(compositor_scene_users)
            if (
                not modifier_users.issubset(mutation_target_pointers)
                or not compositor_scene_users.issubset(created_scenes)
                or resource.users != internal_user_count
            ):
                raise RuntimeError(
                    f"Cannot rollback externally used node group: {identity.logical_id}"
                )
        elif identity.resource_type == "ACTION":
            action_users = {
                obj.as_pointer()
                for obj in bpy.data.objects
                if obj.animation_data is not None
                and obj.animation_data.action is resource
            }
            if not action_users.issubset(mutation_target_pointers):
                raise RuntimeError(
                    f"Cannot rollback externally used action: {identity.logical_id}"
                )
            if resource.users != len(action_users):
                raise RuntimeError(
                    f"Cannot rollback externally used action: {identity.logical_id}"
                )
        elif identity.resource_type == "MATERIAL":
            internal_users = 0
            for obj in bpy.data.objects:
                uses_material = any(
                    slot.material is resource for slot in obj.material_slots
                )
                if not uses_material:
                    continue
                if obj.as_pointer() not in mutation_target_pointers:
                    raise RuntimeError(
                        f"Cannot rollback externally used material: {identity.logical_id}"
                    )
                internal_users += 1
            if resource.users != internal_users:
                raise RuntimeError(
                    f"Cannot rollback externally used material: {identity.logical_id}"
                )
        elif identity.resource_type == "WORLD":
            world_scenes = {
                scene.as_pointer()
                for scene in bpy.data.scenes
                if scene.world is resource
            }
            scene_links_are_internal = (
                world_scenes.issubset(created_scenes)
                if allow_incomplete
                else world_scenes == created_scenes
            )
            if not scene_links_are_internal or resource.users != len(world_scenes):
                raise RuntimeError(
                    f"Cannot rollback externally used world: {identity.logical_id}"
                )
        elif identity.resource_type == "COLLECTION":
            if resource.children or any(
                obj.as_pointer() not in created_object_pointers
                for obj in resource.all_objects
            ):
                raise RuntimeError(
                    f"Cannot rollback collection with external contents: {identity.logical_id}"
                )
            actual_parent_links = _collection_parent_links(resource)
            expected_parent_links = set(identity.parent_links)
            parent_links_are_expected = (
                set(actual_parent_links).issubset(expected_parent_links)
                if allow_incomplete
                else set(actual_parent_links) == expected_parent_links
            )
            if (
                not parent_links_are_expected
                or resource.users != len(actual_parent_links)
            ):
                raise RuntimeError(
                    f"Cannot rollback externally linked collection: {identity.logical_id}"
                )
        elif identity.resource_type == "SCENE":
            if len(bpy.data.scenes) <= 1:
                raise RuntimeError("Cannot rollback the only Blender scene")
            if resource.collection.objects or any(
                collection.get(OWNER_KEY) != OWNER_VALUE
                for collection in resource.collection.children
            ):
                raise RuntimeError(
                    f"Cannot rollback scene with external contents: {identity.logical_id}"
                )
    _preflight_created_resource_id_users(receipt)


def _remove_resource(identity: ResourceIdentity) -> None:
    resource = resolve_resource(identity)
    if resource is None:
        return
    if identity.resource_type == "OBJECT":
        bpy.data.objects.remove(resource, do_unlink=True)
    elif identity.resource_type == "MESH":
        bpy.data.meshes.remove(resource)
    elif identity.resource_type == "MATERIAL":
        bpy.data.materials.remove(resource)
    elif identity.resource_type == "LIGHT":
        bpy.data.lights.remove(resource)
    elif identity.resource_type == "CAMERA":
        bpy.data.cameras.remove(resource)
    elif identity.resource_type == "ARMATURE":
        bpy.data.armatures.remove(resource)
    elif identity.resource_type == "ACTION":
        bpy.data.actions.remove(resource)
    elif identity.resource_type == "NODE_GROUP":
        bpy.data.node_groups.remove(resource)
    elif identity.resource_type == "COLLECTION":
        bpy.data.collections.remove(resource)
    elif identity.resource_type == "WORLD":
        bpy.data.worlds.remove(resource)
    elif identity.resource_type == "SCENE":
        bpy.data.scenes.remove(resource)


def _preflight_rollback_receipt(
    receipt: ActionReceipt,
    *,
    allow_incomplete: bool,
) -> list[MutationRecord]:
    mutations_to_restore: list[MutationRecord] = []
    for mutation in receipt.mutations:
        if _mutation_matches_after(mutation):
            mutations_to_restore.append(mutation)
            continue
        if _mutation_matches_before(mutation):
            continue
        logical_attribute = f"{mutation.resource.logical_id}.{mutation.attribute}"
        raise RuntimeError(f"Cannot rollback modified resource: {logical_attribute}")
    for artifact in receipt.artifacts:
        path = Path(artifact.path)
        if (
            path.is_file()
            and hashlib.sha256(path.read_bytes()).hexdigest() != artifact.sha256
        ):
            raise RuntimeError(f"Cannot rollback modified artifact: {artifact.logical_id}")
    _preflight_created_resources(receipt, allow_incomplete=allow_incomplete)
    return mutations_to_restore


def _apply_rollback_receipt(
    receipt: ActionReceipt,
    mutations_to_restore: list[MutationRecord],
) -> None:
    for mutation in reversed(mutations_to_restore):
        _restore_mutation(mutation)
    for artifact in reversed(receipt.artifacts):
        path = Path(artifact.path)
        if not path.is_file():
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() == artifact.sha256:
            path.unlink()
    deletion_priority = {
        "OBJECT": 0,
        "SCENE": 0,
        "MESH": 1,
        "MATERIAL": 1,
        "LIGHT": 1,
        "CAMERA": 1,
        "ARMATURE": 1,
        "ACTION": 1,
        "NODE_GROUP": 1,
        "WORLD": 1,
        "COLLECTION": 2,
    }
    ordered = sorted(
        reversed(receipt.created),
        key=lambda item: deletion_priority.get(item.resource_type, 1),
    )
    for resource in ordered:
        _remove_resource(resource)
    remaining = [
        identity.logical_id
        for identity in receipt.created
        if _resource_at_pointer(identity) is not None
    ]
    if remaining:
        raise RuntimeError(
            f"Rollback left owned resources behind: {', '.join(remaining)}"
        )


def rollback_receipt(
    receipt: ActionReceipt,
    *,
    allow_incomplete: bool = False,
) -> None:
    try:
        mutations_to_restore = _preflight_rollback_receipt(
            receipt,
            allow_incomplete=allow_incomplete,
        )
    except Exception as error:
        # No restore/delete has started, so the caller's Blender state is still
        # exactly the state from before this rollback attempt.
        attest_action_host_state_restored(error)
        raise
    try:
        _apply_rollback_receipt(receipt, mutations_to_restore)
    except ActionAtomicityError:
        raise
    except Exception as error:
        raise ActionAtomicityError(
            f"{receipt.action_name} rollback failed after mutation began"
        ) from error


def make_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    created: list[ResourceIdentity],
    mutations: list[MutationRecord],
    artifacts: list[ArtifactIdentity],
    anchor: ResourceIdentity | None,
) -> ActionReceipt:
    return ActionReceipt(
        receipt_id=receipt_id,
        step_id=step_id,
        action_name=action_name,
        created=tuple(created),
        mutations=tuple(mutations),
        artifacts=tuple(artifacts),
        anchor=anchor,
    )


def rollback_partial(
    receipt_id: str,
    step_id: str,
    action_name: str,
    created: list[ResourceIdentity],
    mutations: list[MutationRecord],
    artifacts: list[ArtifactIdentity],
) -> None:
    receipt = make_receipt(
        receipt_id,
        step_id,
        action_name,
        created,
        mutations,
        artifacts,
        None,
    )
    try:
        rollback_receipt(receipt, allow_incomplete=True)
    except Exception as error:
        raise ActionAtomicityError(
            f"{action_name} failed and partial Blender rollback failed"
        ) from error


def render_output_root() -> Path:
    configured = os.environ.get("OPERATINGLINE_RENDER_OUTPUT_DIR")
    if configured:
        root = Path(configured).expanduser().resolve()
    else:
        root = Path(tempfile.gettempdir()).resolve() / "operating-line" / "renders"
    root.mkdir(parents=True, exist_ok=True)
    if not root.is_dir():
        raise RuntimeError("OperatingLine render output root is not a directory")
    return root
