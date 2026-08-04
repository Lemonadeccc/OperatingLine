"""Controlled execution of plan-defined Blender scene mutations."""

from collections.abc import Callable
import math
import uuid

import bmesh
import bpy

from ..application import ActionReceipt
from ..domain import ActionSpec, TaskNode, executable_steps

COLLECTION_NAME = "OperatingLine Snowman"
OWNER_KEY = "operating_line_owner"
OWNER_VALUE = "snowman_demo_v1"
ACTION_KEY = "operating_line_action"
ROLLBACK_TOKEN_KEY = "operating_line_rollback_token"
_ACTION_CATALOG = frozenset(
    {"snowman.body_lower", "snowman.body_upper", "snowman.head"}
)
_managed_collection_pointer: int | None = None


def _managed_collection() -> bpy.types.Collection | None:
    global _managed_collection_pointer
    if _managed_collection_pointer is None:
        return None
    for collection in bpy.data.collections:
        if collection.as_pointer() != _managed_collection_pointer:
            continue
        if collection.get(OWNER_KEY) == OWNER_VALUE:
            return collection
        break
    _managed_collection_pointer = None
    return None


def _collection() -> bpy.types.Collection:
    global _managed_collection_pointer
    collection = _managed_collection()
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION_NAME)
        collection[OWNER_KEY] = OWNER_VALUE
        _managed_collection_pointer = collection.as_pointer()
    if collection.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(collection)
    return collection


def forget_managed_collection() -> None:
    global _managed_collection_pointer
    _managed_collection_pointer = None


def resolve_receipt_object(receipt: ActionReceipt) -> bpy.types.Object | None:
    """Resolve only the exact in-memory object created for a receipt.

    Blender duplicates custom properties, so owner/action/token metadata is not
    unique identity by itself. The RNA pointer prevents a copied user object from
    being selected for rollback; metadata is retained as a second safety check.
    """
    for obj in bpy.data.objects:
        if obj.as_pointer() != receipt.object_pointer:
            continue
        if (
            obj.get(OWNER_KEY) == OWNER_VALUE
            and obj.get(ACTION_KEY) == receipt.action_name
            and obj.get(ROLLBACK_TOKEN_KEY) == receipt.rollback_token
        ):
            return obj
        return None
    return None


def _remove_receipt_object(receipt: ActionReceipt) -> None:
    obj = resolve_receipt_object(receipt)
    if obj is None:
        return
    mesh = obj.data if isinstance(obj.data, bpy.types.Mesh) else None
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)
    _remove_receipt_collection_if_empty(receipt)


def _remove_receipt_collection_if_empty(receipt: ActionReceipt) -> None:
    global _managed_collection_pointer
    for collection in bpy.data.collections:
        if collection.as_pointer() != receipt.collection_pointer:
            continue
        if collection.get(OWNER_KEY) != OWNER_VALUE or collection.objects:
            return
        bpy.data.collections.remove(collection)
        if _managed_collection_pointer == receipt.collection_pointer:
            _managed_collection_pointer = None
        return


def _create_sphere(
    action_name: str,
    name: str,
    radius: float,
    location: tuple[float, float, float],
) -> ActionReceipt:
    existing = bpy.data.objects.get(name)
    if existing is not None:
        raise RuntimeError(f"Cannot replace existing object: {name}")
    rollback_token = uuid.uuid4().hex
    mesh = bpy.data.meshes.new(f"{name}.Mesh")
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(
            bm,
            u_segments=32,
            v_segments=16,
            radius=radius,
        )
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj["operating_line_action_owned"] = True
    obj[OWNER_KEY] = OWNER_VALUE
    obj[ACTION_KEY] = action_name
    obj[ROLLBACK_TOKEN_KEY] = rollback_token
    collection = _collection()
    collection.objects.link(obj)
    return ActionReceipt(
        action_name=action_name,
        display_name=obj.name,
        rollback_token=rollback_token,
        object_pointer=obj.as_pointer(),
        collection_pointer=collection.as_pointer(),
    )


def _sphere_arguments(action: ActionSpec) -> tuple[str, float, tuple[float, float, float]]:
    if action.adapter_id != "blender" or action.name not in _ACTION_CATALOG:
        raise ValueError(f"Unsupported Blender action: {action.name}")
    name = action.arguments.get("objectName")
    radius = action.arguments.get("radius")
    location = action.arguments.get("location")
    if not isinstance(name, str) or not name.startswith("OperatingLine."):
        raise ValueError(f"Invalid objectName for action: {action.name}")
    if isinstance(radius, bool) or not isinstance(radius, (int, float)):
        raise ValueError(f"Invalid radius for action: {action.name}")
    if radius <= 0 or not math.isfinite(radius):
        raise ValueError(f"Invalid radius for action: {action.name}")
    if not isinstance(location, list) or len(location) != 3:
        raise ValueError(f"Invalid location for action: {action.name}")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in location):
        raise ValueError(f"Invalid location for action: {action.name}")
    coordinates = tuple(float(value) for value in location)
    if not all(math.isfinite(value) for value in coordinates):
        raise ValueError(f"Invalid location for action: {action.name}")
    return name, float(radius), coordinates


def action_registry(
    root: TaskNode,
) -> dict[
    str,
    tuple[
        Callable[[], ActionReceipt],
        Callable[[ActionReceipt], None],
    ],
]:
    actions: dict[
        str,
        tuple[
            Callable[[], ActionReceipt],
            Callable[[ActionReceipt], None],
        ],
    ] = {}
    for step in executable_steps(root):
        if step.action is None:
            continue
        action = step.action
        name, radius, location = _sphere_arguments(action)
        if action.name in actions:
            raise ValueError(f"Duplicate action name in plan: {action.name}")
        actions[action.name] = (
            lambda action_name=action.name,
            name=name,
            radius=radius,
            location=location: _create_sphere(
                action_name, name, radius, location
            ),
            _remove_receipt_object,
        )
    return actions
