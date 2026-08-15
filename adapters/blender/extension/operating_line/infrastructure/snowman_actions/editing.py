"""Bounded mesh-edit, modifier, and Geometry Nodes actions."""

from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite, pi
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
MAX_SUBSURF_VERTICES = 8192
MAX_SUBSURF_EDGES = 16384
MAX_SUBSURF_POLYGONS = 8192
MAX_TRIANGULATE_VERTICES = 8192
MAX_TRIANGULATE_EDGES = 16384
MAX_TRIANGULATE_POLYGONS = 8192
MAX_EXTRUDE_VERTICES = 8192
MAX_EXTRUDE_EDGES = 16384
MAX_EXTRUDE_POLYGONS = 8192
MAX_EXTRUDE_SELECTED_POLYGONS = 256
MIN_EXTRUDE_TRANSLATION = 0.0001
MAX_EXTRUDE_TRANSLATION = 1000.0
MAX_EDIT_BEVEL_VERTICES = 8192
MAX_EDIT_BEVEL_EDGES = 16384
MAX_EDIT_BEVEL_POLYGONS = 8192
MAX_EDIT_INSET_VERTICES = 8192
MAX_EDIT_INSET_EDGES = 16384
MAX_EDIT_INSET_POLYGONS = 8192
MAX_EDIT_POKE_VERTICES = 8192
MAX_EDIT_POKE_EDGES = 16384
MAX_EDIT_POKE_POLYGONS = 8192
MAX_MIRROR_VERTICES = 8192
MAX_MIRROR_EDGES = 16384
MAX_MIRROR_POLYGONS = 8192


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
class ExtrudeRegionDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    polygon_indices: tuple[int, ...]
    translation: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class EditBevelEdgesDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    width: float
    segments: int
    profile: float


@dataclass(frozen=True, slots=True)
class EditInsetFacesDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    thickness: float
    depth: float


@dataclass(frozen=True, slots=True)
class EditPokeFacesDefinition:
    target_id: str
    result_mesh_id: str
    result_mesh_name: str
    offset: float


@dataclass(frozen=True, slots=True)
class BevelModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    width: float
    segments: int
    angle_limit: float


@dataclass(frozen=True, slots=True)
class MirrorModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    axis: str


@dataclass(frozen=True, slots=True)
class SolidifyModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    thickness: float
    offset: float


@dataclass(frozen=True, slots=True)
class SubdivisionSurfaceModifierDefinition:
    target_id: str
    modifier_id: str
    modifier_name: str
    viewport_level: int


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


def _normalized_squared_vector_length(
    value: tuple[float, ...], bound: float
) -> float:
    if bound == 0.0:
        return float("inf") if any(component != 0.0 for component in value) else 0.0
    squared_length = 0.0
    for component in value:
        normalized_component = component / bound
        squared_length += normalized_component * normalized_component
    return squared_length


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


def validate_extrude_region(arguments: Mapping[str, Any]) -> ExtrudeRegionDefinition:
    fields = {
        "targetId",
        "resultMeshId",
        "resultMeshName",
        "polygonIndices",
        "translation",
    }
    require_keys(arguments, fields, fields, "arguments")
    raw_polygon_indices = arguments["polygonIndices"]
    if (
        not isinstance(raw_polygon_indices, list)
        or not 1 <= len(raw_polygon_indices) <= MAX_EXTRUDE_SELECTED_POLYGONS
    ):
        raise ValueError(
            "arguments.polygonIndices must contain between 1 and "
            f"{MAX_EXTRUDE_SELECTED_POLYGONS} indices"
        )
    polygon_indices = tuple(
        integer(
            item,
            f"arguments.polygonIndices[{index}]",
            minimum=0,
            maximum=MAX_EXTRUDE_POLYGONS - 1,
        )
        for index, item in enumerate(raw_polygon_indices)
    )
    if len(set(polygon_indices)) != len(polygon_indices):
        raise ValueError("arguments.polygonIndices must not repeat indices")
    translation = vector(
        arguments["translation"],
        "arguments.translation",
        3,
        minimum=-MAX_EXTRUDE_TRANSLATION,
        maximum=MAX_EXTRUDE_TRANSLATION,
    )
    if not (
        _normalized_squared_vector_length(translation, MIN_EXTRUDE_TRANSLATION)
        >= 1.0
        and _normalized_squared_vector_length(translation, MAX_EXTRUDE_TRANSLATION)
        <= 1.0
    ):
        raise ValueError(
            "arguments.translation length must be in "
            f"[{MIN_EXTRUDE_TRANSLATION}, {MAX_EXTRUDE_TRANSLATION}]"
        )
    return ExtrudeRegionDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
            prefix="OperatingLine.",
        ),
        polygon_indices=tuple(sorted(polygon_indices)),
        translation=translation,
    )


def validate_edit_bevel_edges(
    arguments: Mapping[str, Any],
) -> EditBevelEdgesDefinition:
    fields = {
        "targetId",
        "resultMeshId",
        "resultMeshName",
        "width",
        "segments",
        "profile",
    }
    require_keys(arguments, fields, fields, "arguments")
    return EditBevelEdgesDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
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
        profile=number(
            arguments["profile"],
            "arguments.profile",
            minimum=0.0,
            maximum=1.0,
        ),
    )


def validate_edit_inset_faces(
    arguments: Mapping[str, Any],
) -> EditInsetFacesDefinition:
    fields = {
        "targetId",
        "resultMeshId",
        "resultMeshName",
        "thickness",
        "depth",
    }
    require_keys(arguments, fields, fields, "arguments")
    return EditInsetFacesDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
            prefix="OperatingLine.",
        ),
        thickness=number(
            arguments["thickness"],
            "arguments.thickness",
            minimum=0.0001,
            maximum=100.0,
        ),
        depth=number(
            arguments["depth"],
            "arguments.depth",
            minimum=-100.0,
            maximum=100.0,
        ),
    )


def validate_edit_poke_faces(
    arguments: Mapping[str, Any],
) -> EditPokeFacesDefinition:
    fields = {"targetId", "resultMeshId", "resultMeshName", "offset"}
    require_keys(arguments, fields, fields, "arguments")
    return EditPokeFacesDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        result_mesh_id=logical_id(
            arguments["resultMeshId"], "arguments.resultMeshId"
        ),
        result_mesh_name=text(
            arguments["resultMeshName"],
            "arguments.resultMeshName",
            prefix="OperatingLine.",
        ),
        offset=number(
            arguments["offset"],
            "arguments.offset",
            minimum=-100.0,
            maximum=100.0,
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


def validate_mirror(arguments: Mapping[str, Any]) -> MirrorModifierDefinition:
    fields = {"targetId", "modifierId", "modifierName", "axis"}
    require_keys(arguments, fields, fields, "arguments")
    axis = arguments["axis"]
    if not isinstance(axis, str) or axis not in {"X", "Y", "Z"}:
        raise ValueError("arguments.axis must be one of X, Y, or Z")
    return MirrorModifierDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        axis=axis,
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


def validate_subdivision_surface(
    arguments: Mapping[str, Any],
) -> SubdivisionSurfaceModifierDefinition:
    fields = {"targetId", "modifierId", "modifierName", "viewportLevel"}
    require_keys(arguments, fields, fields, "arguments")
    return SubdivisionSurfaceModifierDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        viewport_level=integer(
            arguments["viewportLevel"],
            "arguments.viewportLevel",
            minimum=1,
            maximum=3,
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


def _ensure_subdivision_surface_input_is_bounded(
    receipts: Mapping[str, ActionReceipt],
    target: bpy.types.Object,
    level: int,
) -> None:
    tracked_pointers = _tracked_modifier_pointers(receipts, target)
    untracked = tuple(
        modifier.name
        for modifier in target.modifiers
        if modifier.as_pointer() not in tracked_pointers
    )
    if untracked:
        raise RuntimeError(
            "Subdivision Surface target has untracked existing modifiers: "
            + ", ".join(untracked)
        )
    existing_subdivision = tuple(
        modifier.name for modifier in target.modifiers if modifier.type == "SUBSURF"
    )
    if existing_subdivision:
        raise RuntimeError(
            "Subdivision Surface target already has a SUBSURF modifier: "
            + ", ".join(existing_subdivision)
        )

    limits = (
        MAX_SUBSURF_VERTICES,
        MAX_SUBSURF_EDGES,
        MAX_SUBSURF_POLYGONS,
    )

    def ensure_bounded(topology: tuple[int, int, int], label: str) -> None:
        if any(actual > limit for actual, limit in zip(topology, limits)):
            raise ValueError(
                f"Subdivision Surface {label} exceeds the supported topology limits: "
                f"vertices <= {MAX_SUBSURF_VERTICES}, "
                f"edges <= {MAX_SUBSURF_EDGES}, "
                f"polygons <= {MAX_SUBSURF_POLYGONS}"
            )

    source_topology = (
        len(target.data.vertices),
        len(target.data.edges),
        len(target.data.polygons),
    )
    ensure_bounded(source_topology, "target")

    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        evaluated_topology = (
            len(evaluated_mesh.vertices),
            len(evaluated_mesh.edges),
            len(evaluated_mesh.polygons),
        )
        ensure_bounded(evaluated_topology, "evaluated input")
        loop_count = sum(len(polygon.vertices) for polygon in evaluated_mesh.polygons)
    finally:
        evaluated.to_mesh_clear()

    vertices, edges, polygons = evaluated_topology
    for projected_level in range(1, level + 1):
        vertices, edges, polygons = (
            vertices + edges + polygons,
            edges * 2 + loop_count,
            loop_count,
        )
        ensure_bounded(
            (vertices, edges, polygons),
            f"projected level {projected_level} output",
        )
        loop_count = polygons * 4


def _ensure_mirror_input_is_bounded(
    receipts: Mapping[str, ActionReceipt], target: bpy.types.Object
) -> tuple[int, int, int]:
    if target.mode != "OBJECT":
        raise RuntimeError("Mirror target must be in Object Mode")
    if target.data.shape_keys is not None:
        raise RuntimeError("Mirror target must not have shape keys")

    tracked_pointers = _tracked_modifier_pointers(receipts, target)
    untracked = tuple(
        modifier.name
        for modifier in target.modifiers
        if modifier.as_pointer() not in tracked_pointers
    )
    if untracked:
        raise RuntimeError(
            "Mirror target has untracked existing modifiers: " + ", ".join(untracked)
        )
    existing_mirror = tuple(
        modifier.name for modifier in target.modifiers if modifier.type == "MIRROR"
    )
    if existing_mirror:
        raise RuntimeError(
            "Mirror target already has a MIRROR modifier: "
            + ", ".join(existing_mirror)
        )

    limits = (MAX_MIRROR_VERTICES, MAX_MIRROR_EDGES, MAX_MIRROR_POLYGONS)

    def ensure_geometry(mesh: bpy.types.Mesh, label: str) -> tuple[int, int, int]:
        topology = (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
        if not all(topology):
            raise ValueError(f"Mirror {label} topology must be nonempty")
        if any(
            not isfinite(component)
            for vertex in mesh.vertices
            for component in vertex.co
        ):
            raise ValueError(f"Mirror {label} vertices must be finite")
        if any(actual > limit for actual, limit in zip(topology, limits)):
            raise ValueError(
                f"Mirror {label} exceeds the supported topology limits: "
                f"vertices <= {MAX_MIRROR_VERTICES}, "
                f"edges <= {MAX_MIRROR_EDGES}, "
                f"polygons <= {MAX_MIRROR_POLYGONS}"
            )
        return topology

    ensure_geometry(target.data, "target")
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        evaluated_topology = ensure_geometry(evaluated_mesh, "evaluated input")
    finally:
        evaluated.to_mesh_clear()
    projected = tuple(value * 2 for value in evaluated_topology)
    if any(actual > limit for actual, limit in zip(projected, limits)):
        raise ValueError(
            "Mirror projected output exceeds the supported topology limits: "
            f"vertices <= {MAX_MIRROR_VERTICES}, "
            f"edges <= {MAX_MIRROR_EDGES}, "
            f"polygons <= {MAX_MIRROR_POLYGONS}"
        )
    return projected


def _ensure_mirror_evaluated_output_is_bounded(
    target: bpy.types.Object,
    projected_topology: tuple[int, int, int],
) -> None:
    limits = (MAX_MIRROR_VERTICES, MAX_MIRROR_EDGES, MAX_MIRROR_POLYGONS)
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        topology = (
            len(evaluated_mesh.vertices),
            len(evaluated_mesh.edges),
            len(evaluated_mesh.polygons),
        )
        if not all(topology):
            raise RuntimeError("Mirror evaluated output topology must be nonempty")
        if any(
            not isfinite(component)
            for vertex in evaluated_mesh.vertices
            for component in vertex.co
        ):
            raise RuntimeError("Mirror evaluated output vertices must be finite")
        if any(actual > limit for actual, limit in zip(topology, limits)):
            raise RuntimeError("Mirror evaluated output exceeds topology limits")
        if any(
            actual > projected
            for actual, projected in zip(topology, projected_topology)
        ):
            raise RuntimeError("Mirror evaluated output exceeds its projection")
    finally:
        evaluated.to_mesh_clear()


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


def _ensure_extrude_topology_is_bounded(
    topology: tuple[int, int, int], label: str
) -> None:
    limits = (
        MAX_EXTRUDE_VERTICES,
        MAX_EXTRUDE_EDGES,
        MAX_EXTRUDE_POLYGONS,
    )
    if any(actual > limit for actual, limit in zip(topology, limits)):
        raise ValueError(
            f"Extrude Region {label} exceeds the supported topology limits: "
            f"vertices <= {MAX_EXTRUDE_VERTICES}, "
            f"edges <= {MAX_EXTRUDE_EDGES}, "
            f"polygons <= {MAX_EXTRUDE_POLYGONS}"
        )


def _ensure_edit_bevel_topology_is_bounded(
    topology: tuple[int, int, int], label: str
) -> None:
    limits = (
        MAX_EDIT_BEVEL_VERTICES,
        MAX_EDIT_BEVEL_EDGES,
        MAX_EDIT_BEVEL_POLYGONS,
    )
    if any(actual > limit for actual, limit in zip(topology, limits)):
        raise ValueError(
            f"Edit Bevel {label} exceeds the supported topology limits: "
            f"vertices <= {MAX_EDIT_BEVEL_VERTICES}, "
            f"edges <= {MAX_EDIT_BEVEL_EDGES}, "
            f"polygons <= {MAX_EDIT_BEVEL_POLYGONS}"
        )


def _ensure_edit_inset_topology_is_bounded(
    topology: tuple[int, int, int], label: str
) -> None:
    limits = (
        MAX_EDIT_INSET_VERTICES,
        MAX_EDIT_INSET_EDGES,
        MAX_EDIT_INSET_POLYGONS,
    )
    if any(actual > limit for actual, limit in zip(topology, limits)):
        raise ValueError(
            f"Edit Inset {label} exceeds the supported topology limits: "
            f"vertices <= {MAX_EDIT_INSET_VERTICES}, "
            f"edges <= {MAX_EDIT_INSET_EDGES}, "
            f"polygons <= {MAX_EDIT_INSET_POLYGONS}"
        )


def _ensure_edit_poke_topology_is_bounded(
    topology: tuple[int, int, int], label: str
) -> None:
    limits = (
        MAX_EDIT_POKE_VERTICES,
        MAX_EDIT_POKE_EDGES,
        MAX_EDIT_POKE_POLYGONS,
    )
    if any(actual > limit for actual, limit in zip(topology, limits)):
        raise ValueError(
            f"Edit Poke {label} exceeds the supported topology limits: "
            f"vertices <= {MAX_EDIT_POKE_VERTICES}, "
            f"edges <= {MAX_EDIT_POKE_EDGES}, "
            f"polygons <= {MAX_EDIT_POKE_POLYGONS}"
        )


def _validate_edit_inset_source(
    mesh: bpy.types.Mesh,
) -> tuple[tuple[int, int, int], int]:
    topology = (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
    _ensure_edit_inset_topology_is_bounded(topology, "source")
    if not all(topology):
        raise ValueError("Edit Inset target topology must be nonempty")
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        if any(len(edge.link_faces) != 2 for edge in bm.edges):
            raise ValueError(
                "Edit Inset target must have exactly two adjacent faces per edge"
            )
        if any(
            not isfinite(area) or area <= 0.0
            for area in (face.calc_area() for face in bm.faces)
        ):
            raise ValueError("Edit Inset target faces must have finite positive area")
        loop_count = sum(len(face.verts) for face in bm.faces)
    finally:
        bm.free()
    return topology, loop_count


def _validate_edit_poke_source(
    mesh: bpy.types.Mesh,
) -> tuple[tuple[int, int, int], int]:
    topology = (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
    _ensure_edit_poke_topology_is_bounded(topology, "source")
    if not all(topology):
        raise ValueError("Edit Poke target topology must be nonempty")
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        if any(len(edge.link_faces) != 2 for edge in bm.edges):
            raise ValueError(
                "Edit Poke target must have exactly two adjacent faces per edge"
            )
        if any(not vert.is_manifold for vert in bm.verts):
            raise ValueError(
                "Edit Poke target vertices must each form one manifold face fan"
            )
        if any(
            not isfinite(area) or area <= 0.0
            for area in (face.calc_area() for face in bm.faces)
        ):
            raise ValueError("Edit Poke target faces must have finite positive area")
        loop_count = sum(len(face.verts) for face in bm.faces)
    finally:
        bm.free()
    return topology, loop_count


def _edit_inset_result_is_finite_and_nondegenerate(
    bm: bmesh.types.BMesh,
) -> bool:
    return bool(
        bm.verts
        and bm.edges
        and bm.faces
        and all(isfinite(component) for vert in bm.verts for component in vert.co)
        and all(
            isfinite(length) and length > 0.0
            for length in (edge.calc_length() for edge in bm.edges)
        )
        and all(
            isfinite(area) and area > 0.0
            for area in (face.calc_area() for face in bm.faces)
        )
    )


def _edit_poke_result_is_finite_and_nondegenerate(
    bm: bmesh.types.BMesh,
) -> bool:
    return bool(
        bm.verts
        and bm.edges
        and bm.faces
        and all(isfinite(component) for vert in bm.verts for component in vert.co)
        and all(
            isfinite(length) and length > 0.0
            for length in (edge.calc_length() for edge in bm.edges)
        )
        and all(
            isfinite(area) and area > 0.0
            for area in (face.calc_area() for face in bm.faces)
        )
    )


def execute_edit_inset_faces(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: EditInsetFacesDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    if target.mode != "OBJECT":
        raise RuntimeError("Edit Inset target must be in Object Mode")
    if target.modifiers:
        raise RuntimeError("Edit Inset target must not have modifiers")
    if target.data.shape_keys is not None:
        raise RuntimeError("Edit Inset target must not have shape keys")
    source_topology, loop_count = _validate_edit_inset_source(target.data)
    source_mesh_content = mesh_content_signature(target.data)
    predicted_topology = (
        source_topology[0] + loop_count,
        source_topology[1] + 2 * loop_count,
        source_topology[2] + loop_count,
    )
    _ensure_edit_inset_topology_is_bounded(predicted_topology, "result")
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
            bmesh.ops.inset_individual(
                bm,
                faces=tuple(bm.faces),
                thickness=definition.thickness,
                depth=definition.depth,
                use_even_offset=True,
                use_interpolate=True,
                use_relative_offset=False,
            )
            bm.normal_update()
            actual_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
            if actual_topology != predicted_topology:
                raise RuntimeError(
                    "Edit Inset topology does not match the supported exact formula"
                )
            if not _edit_inset_result_is_finite_and_nondegenerate(bm):
                raise RuntimeError("Edit Inset produced degenerate or non-finite geometry")
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        converted_topology = (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        _ensure_edit_inset_topology_is_bounded(converted_topology, "actual result")
        if converted_topology != predicted_topology:
            raise RuntimeError("Edit Inset topology changed during mesh conversion")
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
                source_mesh_identity,
                "mesh_content",
                source_mesh_content,
                source_mesh_content,
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


def execute_edit_poke_faces(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: EditPokeFacesDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    if target.mode != "OBJECT":
        raise RuntimeError("Edit Poke target must be in Object Mode")
    if target.modifiers:
        raise RuntimeError("Edit Poke target must not have modifiers")
    if target.data.shape_keys is not None:
        raise RuntimeError("Edit Poke target must not have shape keys")
    source_topology, loop_count = _validate_edit_poke_source(target.data)
    source_mesh_content = mesh_content_signature(target.data)
    predicted_topology = (
        source_topology[0] + source_topology[2],
        source_topology[1] + loop_count,
        loop_count,
    )
    _ensure_edit_poke_topology_is_bounded(predicted_topology, "result")
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
            bmesh.ops.poke(
                bm,
                faces=tuple(bm.faces),
                offset=definition.offset,
                center_mode="MEAN_WEIGHTED",
                use_relative_offset=False,
            )
            bm.normal_update()
            actual_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
            if actual_topology != predicted_topology:
                raise RuntimeError(
                    "Edit Poke topology does not match the supported exact formula"
                )
            if any(len(face.verts) != 3 for face in bm.faces):
                raise RuntimeError("Edit Poke did not produce only triangle faces")
            if not _edit_poke_result_is_finite_and_nondegenerate(bm):
                raise RuntimeError("Edit Poke produced degenerate or non-finite geometry")
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        converted_topology = (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        _ensure_edit_poke_topology_is_bounded(converted_topology, "actual result")
        if converted_topology != predicted_topology:
            raise RuntimeError("Edit Poke topology changed during mesh conversion")
        if any(len(face.vertices) != 3 for face in result_mesh.polygons):
            raise RuntimeError("Edit Poke mesh conversion produced non-triangle faces")
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
                source_mesh_identity,
                "mesh_content",
                source_mesh_content,
                source_mesh_content,
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


def execute_edit_bevel_edges(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: EditBevelEdgesDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    if target.mode != "OBJECT":
        raise RuntimeError("Edit Bevel target must be in Object Mode")
    if target.modifiers:
        raise RuntimeError("Edit Bevel target must not have modifiers")
    if target.data.shape_keys is not None:
        raise RuntimeError("Edit Bevel target must not have shape keys")
    source_topology = _validate_edit_bevel_source(target.data)
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
            if any(len(edge.link_faces) != 2 for edge in bm.edges):
                raise ValueError(
                    "Edit Bevel target must have exactly two adjacent faces per edge"
                )
            bmesh.ops.bevel(
                bm,
                geom=tuple(bm.edges),
                offset_type="OFFSET",
                offset=definition.width,
                segments=definition.segments,
                profile=definition.profile,
                affect="EDGES",
                clamp_overlap=False,
                loop_slide=True,
                mark_seam=False,
                mark_sharp=False,
                material=-1,
                harden_normals=False,
                face_strength_mode="NONE",
                miter_outer="SHARP",
                miter_inner="SHARP",
                spread=0.1,
                vmesh_method="ADJ",
            )
            bm.normal_update()
            predicted_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
            _ensure_edit_bevel_topology_is_bounded(predicted_topology, "result")
            if not all(
                result_count > source_count
                for result_count, source_count in zip(
                    predicted_topology, source_topology
                )
            ):
                raise RuntimeError("Edit Bevel did not grow the mesh topology")
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        actual_topology = (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        _ensure_edit_bevel_topology_is_bounded(actual_topology, "actual result")
        if actual_topology != predicted_topology:
            raise RuntimeError("Edit Bevel topology changed during mesh conversion")
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


def _mesh_has_two_faces_per_edge(mesh: bpy.types.Mesh) -> bool:
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        return all(len(edge.link_faces) == 2 for edge in bm.edges)
    finally:
        bm.free()


def _validate_edit_bevel_source(
    mesh: bpy.types.Mesh,
) -> tuple[int, int, int]:
    topology = (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
    _ensure_edit_bevel_topology_is_bounded(topology, "source")
    if not all(topology):
        raise ValueError("Edit Bevel target topology must be nonempty")
    if not _mesh_has_two_faces_per_edge(mesh):
        raise ValueError(
            "Edit Bevel target must have exactly two adjacent faces per edge"
        )
    return topology


def _extrude_region_geometry(
    bm: bmesh.types.BMesh,
    polygon_indices: tuple[int, ...],
) -> tuple[
    tuple[bmesh.types.BMFace, ...],
    tuple[bmesh.types.BMEdge, ...],
    tuple[bmesh.types.BMVert, ...],
]:
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    if polygon_indices[-1] >= len(bm.faces):
        raise ValueError(
            "Extrude Region polygon index is outside the target mesh: "
            f"{polygon_indices[-1]} >= {len(bm.faces)}"
        )
    faces = tuple(bm.faces[index] for index in polygon_indices)
    face_set = set(faces)
    visited = {faces[0]}
    frontier = [faces[0]]
    while frontier:
        current = frontier.pop()
        for edge in current.edges:
            for neighbor in edge.link_faces:
                if neighbor in face_set and neighbor not in visited:
                    visited.add(neighbor)
                    frontier.append(neighbor)
    if len(visited) != len(faces):
        raise ValueError("Extrude Region polygons must form one edge-connected region")

    edges = tuple(
        sorted(
            {edge for face in faces for edge in face.edges},
            key=lambda edge: edge.index,
        )
    )
    if any(len(edge.link_faces) > 2 for edge in edges):
        raise ValueError("Extrude Region does not support non-manifold selected edges")
    boundary_edges = tuple(
        edge
        for edge in edges
        if sum(linked_face in face_set for linked_face in edge.link_faces) == 1
    )
    if not boundary_edges:
        raise ValueError("Extrude Region polygons must have a boundary edge")
    vertices = tuple(
        sorted(
            {vertex for face in faces for vertex in face.verts},
            key=lambda vertex: vertex.index,
        )
    )
    return faces, edges, vertices


def _canonicalize_extrude_sequences(
    bm: bmesh.types.BMesh,
    extruded_vertices: tuple[bmesh.types.BMVert, ...],
    source_index_layer: Any,
) -> None:
    new_vertices = set(extruded_vertices)
    vertex_order = sorted(
        tuple(bm.verts),
        key=lambda vertex: (
            1 if vertex in new_vertices else 0,
            vertex[source_index_layer],
        ),
    )
    vertex_keys = tuple(
        (
            1 if vertex in new_vertices else 0,
            vertex[source_index_layer],
        )
        for vertex in vertex_order
    )
    if len(set(vertex_keys)) != len(vertex_keys):
        raise RuntimeError("Extrude Region produced ambiguous vertex provenance")
    vertex_rank = {vertex: rank for rank, vertex in enumerate(vertex_order)}
    bm.verts.sort(key=lambda vertex: vertex_rank[vertex])
    bm.verts.index_update()

    edge_order = sorted(
        tuple(bm.edges),
        key=lambda edge: tuple(sorted(vertex.index for vertex in edge.verts)),
    )
    edge_keys = tuple(
        tuple(sorted(vertex.index for vertex in edge.verts)) for edge in edge_order
    )
    if len(set(edge_keys)) != len(edge_keys):
        raise RuntimeError("Extrude Region produced ambiguous edge connectivity")
    edge_rank = {edge: rank for rank, edge in enumerate(edge_order)}
    bm.edges.sort(key=lambda edge: edge_rank[edge])
    bm.edges.index_update()

    face_order = sorted(
        tuple(bm.faces),
        key=lambda face: tuple(sorted(vertex.index for vertex in face.verts)),
    )
    face_keys = tuple(
        tuple(sorted(vertex.index for vertex in face.verts)) for face in face_order
    )
    if len(set(face_keys)) != len(face_keys):
        raise RuntimeError("Extrude Region produced ambiguous face connectivity")
    face_rank = {face: rank for rank, face in enumerate(face_order)}
    bm.faces.sort(key=lambda face: face_rank[face])
    bm.faces.index_update()


def execute_extrude_region(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: ExtrudeRegionDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, source_mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    if target.mode != "OBJECT":
        raise RuntimeError("Extrude Region target must be in Object Mode")
    if target.modifiers:
        raise RuntimeError("Extrude Region target must not have modifiers")
    if target.data.shape_keys is not None:
        raise RuntimeError("Extrude Region target must not have shape keys")
    source_topology = (
        len(target.data.vertices),
        len(target.data.edges),
        len(target.data.polygons),
    )
    _ensure_extrude_topology_is_bounded(source_topology, "source")
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
            source_index_layer = bm.verts.layers.int.new(
                "OperatingLine.source_vertex_index"
            )
            bm.verts.index_update()
            for vertex in bm.verts:
                vertex[source_index_layer] = vertex.index + 1
            faces, edges, vertices = _extrude_region_geometry(
                bm, definition.polygon_indices
            )
            selected_source_indices = tuple(
                sorted(vertex[source_index_layer] for vertex in vertices)
            )
            extrusion = bmesh.ops.extrude_face_region(
                bm,
                geom=(*faces, *edges, *vertices),
                use_keep_orig=False,
                use_normal_flip=False,
                use_normal_from_adjacent=False,
            )
            extruded_vertices = tuple(
                item
                for item in extrusion["geom"]
                if isinstance(item, bmesh.types.BMVert)
            )
            if (
                len(extruded_vertices) != len(vertices)
                or len(set(extruded_vertices)) != len(extruded_vertices)
                or tuple(
                    sorted(
                        vertex[source_index_layer]
                        for vertex in extruded_vertices
                    )
                )
                != selected_source_indices
            ):
                raise RuntimeError(
                    "Extrude Region did not preserve the expected vertex provenance"
                )
            bmesh.ops.translate(
                bm,
                verts=extruded_vertices,
                vec=definition.translation,
            )
            _canonicalize_extrude_sequences(
                bm,
                extruded_vertices,
                source_index_layer,
            )
            bm.verts.layers.int.remove(source_index_layer)
            bm.normal_update()
            predicted_topology = (len(bm.verts), len(bm.edges), len(bm.faces))
            _ensure_extrude_topology_is_bounded(predicted_topology, "result")
            if not all(
                result_count > source_count
                for result_count, source_count in zip(
                    predicted_topology, source_topology
                )
            ):
                raise RuntimeError("Extrude Region did not grow the mesh topology")
            bm.to_mesh(result_mesh)
        finally:
            bm.free()
        result_mesh.update()
        actual_topology = (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        _ensure_extrude_topology_is_bounded(actual_topology, "actual result")
        if actual_topology != predicted_topology:
            raise RuntimeError("Extrude Region topology changed during mesh conversion")
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


def execute_mirror(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: MirrorModifierDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    projected_topology = _ensure_mirror_input_is_bounded(receipts, target)
    ensure_modifier_id_available(receipts, definition.modifier_id)
    if target.modifiers.get(definition.modifier_name) is not None:
        raise RuntimeError(
            f"Cannot replace existing modifier: {definition.modifier_name}"
        )
    source_mesh_content = mesh_content_signature(target.data)
    receipt_id = new_receipt_id()
    mutations: list[MutationRecord] = []
    modifier = None
    try:
        modifier = target.modifiers.new(definition.modifier_name, "MIRROR")
        axis_index = {"X": 0, "Y": 1, "Z": 2}[definition.axis]
        modifier.use_axis = tuple(index == axis_index for index in range(3))
        modifier.use_bisect_axis = (False, False, False)
        modifier.use_bisect_flip_axis = (False, False, False)
        modifier.use_clip = False
        modifier.use_mirror_merge = True
        modifier.merge_threshold = 0.001
        modifier.bisect_threshold = 0.001
        modifier.mirror_object = None
        modifier.use_mirror_vertex_groups = True
        modifier.use_mirror_u = False
        modifier.use_mirror_v = False
        modifier.use_mirror_udim = False
        modifier.offset_u = 0.0
        modifier.offset_v = 0.0
        modifier.mirror_offset_u = 0.0
        modifier.mirror_offset_v = 0.0
        modifier.show_viewport = True
        modifier.show_render = True
        modifier.show_in_editmode = True
        modifier.show_on_cage = False
        if hasattr(modifier, "use_apply_on_spline"):
            modifier.use_apply_on_spline = False
        state = snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
            {"mirror_object": None},
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"modifier:{definition.modifier_id}",
                None,
                state,
            )
        )
        mutations.append(
            MutationRecord(
                target_identity,
                "data",
                mesh_identity,
                mesh_identity,
            )
        )
        mutations.append(
            MutationRecord(
                mesh_identity,
                "mesh_content",
                source_mesh_content,
                source_mesh_content,
            )
        )
        _ensure_mirror_evaluated_output_is_bounded(target, projected_topology)
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


def execute_subdivision_surface(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: SubdivisionSurfaceModifierDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target, _mesh_identity = _owned_mesh_target(
        registry, definition.target_id
    )
    _ensure_subdivision_surface_input_is_bounded(
        receipts, target, max(definition.viewport_level, 2)
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
        modifier = target.modifiers.new(definition.modifier_name, "SUBSURF")
        modifier.subdivision_type = "CATMULL_CLARK"
        modifier.levels = definition.viewport_level
        modifier.render_levels = 2
        modifier.quality = 3
        modifier.show_only_control_edges = True
        modifier.use_creases = True
        modifier.use_limit_surface = True
        modifier.boundary_smooth = "ALL"
        modifier.uv_smooth = "PRESERVE_BOUNDARIES"
        modifier.use_custom_normals = False
        modifier.show_viewport = True
        modifier.show_render = True
        modifier.show_in_editmode = True
        modifier.show_on_cage = False
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
