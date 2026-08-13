"""Owned mesh construction without context-sensitive operators."""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from math import cos, sin, tau
from typing import Any

import bmesh
import bpy
from mathutils import Vector

from ...application import ActionReceipt
from ...application.session import MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    COLLECTION_LOGICAL_ID,
    COLLECTION_NAME,
    build_resource_registry,
    ensure_logical_ids_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    logical_id,
    make_receipt,
    mesh_content_signature,
    new_receipt_id,
    number,
    owned_resource,
    parent_identity,
    require_keys,
    require_object,
    rollback_partial,
    tag_resource,
    text,
    vector,
)


@dataclass(frozen=True, slots=True)
class Primitive:
    kind: str
    logical_id: str
    object_name: str
    location: tuple[float, float, float]
    radius: float = 0.0
    radius_start: float = 0.0
    radius_end: float = 0.0
    start: tuple[float, float, float] | None = None
    end: tuple[float, float, float] | None = None
    size: float = 0.0
    subdivisions: int = 0
    major_radius: float = 0.0
    minor_radius: float = 0.0
    major_segments: int = 0
    minor_segments: int = 0


def _sphere(arguments: Mapping[str, Any], label: str) -> Primitive:
    require_keys(
        arguments,
        {"resourceId", "objectName", "radius", "location"},
        {"resourceId", "objectName", "radius", "location", "primitive"},
        label,
    )
    return Primitive(
        kind="uv_sphere",
        logical_id=logical_id(arguments["resourceId"], f"{label}.resourceId"),
        object_name=text(arguments["objectName"], f"{label}.objectName", prefix="OperatingLine."),
        radius=number(
            arguments["radius"],
            f"{label}.radius",
            minimum=0.0001,
            maximum=1000.0,
        ),
        location=vector(
            arguments["location"],
            f"{label}.location",
            3,
            minimum=-1000.0,
            maximum=1000.0,
        ),
    )


def _cone(arguments: Mapping[str, Any], label: str) -> Primitive:
    required = {
        "resourceId",
        "objectName",
        "radiusStart",
        "radiusEnd",
        "start",
        "end",
    }
    require_keys(arguments, required, required | {"primitive"}, label)
    start = vector(
        arguments["start"],
        f"{label}.start",
        3,
        minimum=-1000.0,
        maximum=1000.0,
    )
    end = vector(
        arguments["end"],
        f"{label}.end",
        3,
        minimum=-1000.0,
        maximum=1000.0,
    )
    if Vector(end) == Vector(start):
        raise ValueError(f"{label}.start and end must differ")
    radius_start = number(
        arguments["radiusStart"],
        f"{label}.radiusStart",
        minimum=0.0,
        maximum=1000.0,
    )
    radius_end = number(
        arguments["radiusEnd"],
        f"{label}.radiusEnd",
        minimum=0.0,
        maximum=1000.0,
    )
    if radius_start == 0 and radius_end == 0:
        raise ValueError(f"{label} radii cannot both be zero")
    return Primitive(
        kind="cone",
        logical_id=logical_id(arguments["resourceId"], f"{label}.resourceId"),
        object_name=text(
            arguments["objectName"],
            f"{label}.objectName",
            prefix="OperatingLine.",
        ),
        radius_start=radius_start,
        radius_end=radius_end,
        start=start,
        end=end,
        location=tuple((Vector(start) + Vector(end)) / 2.0),
    )


def _cylinder(arguments: Mapping[str, Any], label: str) -> Primitive:
    required = {"resourceId", "objectName", "radius", "start", "end"}
    require_keys(arguments, required, required | {"primitive"}, label)
    start = vector(
        arguments["start"],
        f"{label}.start",
        3,
        minimum=-1000.0,
        maximum=1000.0,
    )
    end = vector(
        arguments["end"],
        f"{label}.end",
        3,
        minimum=-1000.0,
        maximum=1000.0,
    )
    if Vector(end) == Vector(start):
        raise ValueError(f"{label}.start and end must differ")
    radius = number(
        arguments["radius"],
        f"{label}.radius",
        minimum=0.0001,
        maximum=1000.0,
    )
    return Primitive(
        kind="cylinder",
        logical_id=logical_id(arguments["resourceId"], f"{label}.resourceId"),
        object_name=text(
            arguments["objectName"],
            f"{label}.objectName",
            prefix="OperatingLine.",
        ),
        radius=radius,
        radius_start=radius,
        radius_end=radius,
        start=start,
        end=end,
        location=tuple((Vector(start) + Vector(end)) / 2.0),
    )


def validate_uv_sphere(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    primitives = (_sphere(arguments, "arguments"),)
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_icosphere(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    fields = {"resourceId", "objectName", "subdivisions", "radius", "location"}
    require_keys(arguments, fields, fields, "arguments")
    primitives = (
        Primitive(
            kind="icosphere",
            logical_id=logical_id(arguments["resourceId"], "arguments.resourceId"),
            object_name=text(
                arguments["objectName"],
                "arguments.objectName",
                prefix="OperatingLine.",
            ),
            subdivisions=integer(
                arguments["subdivisions"],
                "arguments.subdivisions",
                minimum=1,
                maximum=5,
            ),
            radius=number(
                arguments["radius"],
                "arguments.radius",
                minimum=0.0001,
                maximum=1000.0,
            ),
            location=vector(
                arguments["location"],
                "arguments.location",
                3,
                minimum=-1000.0,
                maximum=1000.0,
            ),
        ),
    )
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_torus(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    fields = {
        "resourceId",
        "objectName",
        "majorSegments",
        "minorSegments",
        "majorRadius",
        "minorRadius",
        "location",
    }
    require_keys(arguments, fields, fields, "arguments")
    primitives = (
        Primitive(
            kind="torus",
            logical_id=logical_id(arguments["resourceId"], "arguments.resourceId"),
            object_name=text(
                arguments["objectName"],
                "arguments.objectName",
                prefix="OperatingLine.",
            ),
            major_segments=integer(
                arguments["majorSegments"],
                "arguments.majorSegments",
                minimum=3,
                maximum=128,
            ),
            minor_segments=integer(
                arguments["minorSegments"],
                "arguments.minorSegments",
                minimum=3,
                maximum=64,
            ),
            major_radius=number(
                arguments["majorRadius"],
                "arguments.majorRadius",
                minimum=0.0001,
                maximum=1000.0,
            ),
            minor_radius=number(
                arguments["minorRadius"],
                "arguments.minorRadius",
                minimum=0.0001,
                maximum=1000.0,
            ),
            location=vector(
                arguments["location"],
                "arguments.location",
                3,
                minimum=-1000.0,
                maximum=1000.0,
            ),
        ),
    )
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_cone(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    primitives = (_cone(arguments, "arguments"),)
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_cylinder(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    primitives = (_cylinder(arguments, "arguments"),)
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_plane(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    fields = {"resourceId", "objectName", "size", "location"}
    require_keys(arguments, fields, fields, "arguments")
    primitives = (
        Primitive(
            kind="plane",
            logical_id=logical_id(arguments["resourceId"], "arguments.resourceId"),
            object_name=text(
                arguments["objectName"],
                "arguments.objectName",
                prefix="OperatingLine.",
            ),
            size=number(
                arguments["size"],
                "arguments.size",
                minimum=0.0001,
                maximum=1000.0,
            ),
            location=vector(
                arguments["location"],
                "arguments.location",
                3,
                minimum=-1000.0,
                maximum=1000.0,
            ),
        ),
    )
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_cube(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    fields = {"resourceId", "objectName", "size", "location"}
    require_keys(arguments, fields, fields, "arguments")
    primitives = (
        Primitive(
            kind="cube",
            logical_id=logical_id(arguments["resourceId"], "arguments.resourceId"),
            object_name=text(
                arguments["objectName"],
                "arguments.objectName",
                prefix="OperatingLine.",
            ),
            size=number(
                arguments["size"],
                "arguments.size",
                minimum=0.0001,
                maximum=1000.0,
            ),
            location=vector(
                arguments["location"],
                "arguments.location",
                3,
                minimum=-1000.0,
                maximum=1000.0,
            ),
        ),
    )
    ensure_logical_ids_available({}, _created_logical_ids(primitives))
    return primitives


def validate_batch(arguments: Mapping[str, Any]) -> tuple[Primitive, ...]:
    require_keys(arguments, {"items"}, {"items"}, "arguments")
    items = arguments["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 16:
        raise ValueError("arguments.items must contain 1 to 16 primitives")
    primitives: list[Primitive] = []
    for index, raw in enumerate(items):
        label = f"arguments.items[{index}]"
        item = require_object(raw, label)
        kind = item.get("primitive")
        if kind in {"sphere", "uv_sphere"}:
            primitives.append(_sphere(item, label))
            continue
        if kind == "cone":
            primitives.append(_cone(item, label))
            continue
        if kind == "cylinder":
            primitives.append(_cylinder(item, label))
            continue
        raise ValueError(f"{label}.primitive is unsupported")
    logical_ids = [item.logical_id for item in primitives]
    names = [item.object_name for item in primitives]
    if len(set(logical_ids)) != len(logical_ids) or len(set(names)) != len(names):
        raise ValueError("Batch resourceId and objectName values must be unique")
    result = tuple(primitives)
    ensure_logical_ids_available({}, _created_logical_ids(result))
    return result


def _created_logical_ids(primitives: tuple[Primitive, ...]) -> tuple[str, ...]:
    return tuple(
        logical_id
        for primitive in primitives
        for logical_id in (primitive.logical_id, f"{primitive.logical_id}.mesh")
    )


def _validate_available(
    primitives: tuple[Primitive, ...],
    registry: Mapping[str, ResourceIdentity],
) -> None:
    created_ids = list(_created_logical_ids(primitives))
    if COLLECTION_LOGICAL_ID not in registry:
        created_ids.append(COLLECTION_LOGICAL_ID)
    ensure_logical_ids_available(registry, created_ids)
    for primitive in primitives:
        ensure_name_available(bpy.data.objects, primitive.object_name, "object")
        ensure_name_available(bpy.data.meshes, f"{primitive.object_name}.Mesh", "mesh")


def _ensure_collection(
    registry: Mapping[str, ResourceIdentity],
    receipt_id: str,
    step_id: str,
    action_name: str,
    created: list[ResourceIdentity],
) -> tuple[ResourceIdentity, bpy.types.Collection]:
    identity = registry.get(COLLECTION_LOGICAL_ID)
    if identity is not None:
        return owned_resource(registry, COLLECTION_LOGICAL_ID, "COLLECTION")
    ensure_name_available(bpy.data.collections, COLLECTION_NAME, "collection")
    collection = bpy.data.collections.new(COLLECTION_NAME)
    collection_identity = replace(
        tag_resource(
            collection,
            COLLECTION_LOGICAL_ID,
            receipt_id,
            step_id,
            action_name,
        ),
        parent_links=(parent_identity(bpy.context.scene),),
    )
    created.append(collection_identity)
    bpy.context.scene.collection.children.link(collection)
    return collection_identity, collection


def _fill_mesh(mesh: bpy.types.Mesh, primitive: Primitive) -> None:
    bm = bmesh.new()
    try:
        if primitive.kind == "uv_sphere":
            bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=primitive.radius)
        elif primitive.kind == "icosphere":
            bmesh.ops.create_icosphere(
                bm,
                subdivisions=primitive.subdivisions,
                radius=primitive.radius,
            )
        elif primitive.kind == "cube":
            bmesh.ops.create_cube(bm, size=primitive.size)
        elif primitive.kind == "torus":
            rings = []
            for major_index in range(primitive.major_segments):
                major_angle = tau * major_index / primitive.major_segments
                major_cos = cos(major_angle)
                major_sin = sin(major_angle)
                ring = []
                for minor_index in range(primitive.minor_segments):
                    minor_angle = tau * minor_index / primitive.minor_segments
                    radial = primitive.major_radius + primitive.minor_radius * cos(
                        minor_angle
                    )
                    ring.append(
                        bm.verts.new(
                            (
                                radial * major_cos,
                                radial * major_sin,
                                primitive.minor_radius * sin(minor_angle),
                            )
                        )
                    )
                rings.append(ring)
            for major_index, ring in enumerate(rings):
                next_ring = rings[(major_index + 1) % primitive.major_segments]
                for minor_index, vertex in enumerate(ring):
                    next_minor = (minor_index + 1) % primitive.minor_segments
                    bm.faces.new(
                        (
                            vertex,
                            next_ring[minor_index],
                            next_ring[next_minor],
                            ring[next_minor],
                        )
                    )
        elif primitive.kind in {"cone", "cylinder"}:
            assert primitive.start is not None and primitive.end is not None
            depth = (Vector(primitive.end) - Vector(primitive.start)).length
            bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=False,
                segments=32,
                radius1=primitive.radius_start,
                radius2=primitive.radius_end,
                depth=depth,
            )
        elif primitive.kind == "plane":
            half = primitive.size / 2.0
            coordinates = (
                (-half, -half, 0),
                (half, -half, 0),
                (half, half, 0),
                (-half, half, 0),
            )
            vertices = [bm.verts.new(co) for co in coordinates]
            bm.faces.new(vertices)
        else:  # pragma: no cover - validators define the closed primitive set
            raise ValueError(f"Unsupported primitive kind: {primitive.kind}")
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()


def execute_geometry(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    primitives: tuple[Primitive, ...],
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    _validate_available(primitives, registry)
    if COLLECTION_LOGICAL_ID not in registry:
        ensure_name_available(bpy.data.collections, COLLECTION_NAME, "collection")
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        collection_identity, collection = _ensure_collection(
            registry,
            receipt_id,
            step_id,
            action.name,
            created,
        )
        anchor = None
        for primitive in primitives:
            mesh = bpy.data.meshes.new(f"{primitive.object_name}.Mesh")
            mesh_identity = tag_resource(
                mesh,
                f"{primitive.logical_id}.mesh",
                receipt_id,
                step_id,
                action.name,
            )
            created.append(mesh_identity)
            _fill_mesh(mesh, primitive)
            mutations.append(
                MutationRecord(
                    mesh_identity,
                    "mesh_content",
                    None,
                    mesh_content_signature(mesh),
                )
            )
            obj = bpy.data.objects.new(primitive.object_name, mesh)
            object_identity = tag_resource(
                obj,
                primitive.logical_id,
                receipt_id,
                step_id,
                action.name,
            )
            created.append(object_identity)
            mutations.append(
                MutationRecord(
                    object_identity,
                    "data",
                    None,
                    mesh_identity,
                )
            )
            obj.location = primitive.location
            if primitive.kind in {"cone", "cylinder"}:
                assert primitive.start is not None and primitive.end is not None
                obj.rotation_mode = "QUATERNION"
                direction = Vector(primitive.end) - Vector(primitive.start)
                obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
            collection.objects.link(obj)
            mutations.append(
                MutationRecord(
                    object_identity,
                    "users_collection",
                    (),
                    (collection_identity,),
                )
            )
            anchor = anchor or object_identity
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            anchor,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise


def legacy_sphere_arguments(action: ActionSpec) -> dict[str, Any]:
    arguments = dict(action.arguments)
    return {
        "resourceId": action.name,
        "objectName": arguments.get("objectName"),
        "radius": arguments.get("radius"),
        "location": arguments.get("location"),
    }
