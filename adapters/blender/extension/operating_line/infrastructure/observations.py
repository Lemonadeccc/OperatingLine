"""Read-only evaluators for guide-plan observation expectations."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Literal

import bpy
import bmesh
from mathutils import Vector

from ..application.session import ActionReceipt, MaterialSurfaceState
from .snowman_actions.common import (
    COLLECTION_LOGICAL_ID,
    COLLECTION_NAME,
    action_fcurves,
    action_keyframe_signature,
    build_resource_registry,
    embedded_node_tree_semantic_signature,
    find_artifact,
    find_owned_modifier,
    find_owned_skin_weights,
    mesh_content_signature,
    node_tree_semantic_signature,
    resolve_resource,
    snapshot_material_surface,
)
from .snowman_actions.editing import (
    _extrude_region_geometry,
    validate_edit_bevel_edges,
    validate_edit_inset_faces,
    validate_edit_poke_faces,
    validate_extrude_region,
    validate_subdivide,
    validate_triangulate,
)
from .snowman_actions.light_trails_scene import validate_light_trails_scene
from .snowman_actions.rigging import (
    validate_armature,
    validate_pose_animation,
    validate_skin_weights,
)

ObservationResult = tuple[bool, dict[str, Any]]
ObservationEvaluator = Callable[
    [Mapping[str, Any], Mapping[str, ActionReceipt]], ObservationResult
]


def _resource_ids(parameters: Mapping[str, Any]) -> tuple[str, ...]:
    singular = parameters.get("resourceId")
    if isinstance(singular, str) and singular:
        return (singular,)
    for key in ("resourceIds", "logicalIds"):
        values = parameters.get(key)
        if isinstance(values, list) and all(
            isinstance(item, str) and item for item in values
        ):
            return tuple(values)
    return ()


def _object_exists(
    parameters: Mapping[str, Any], _receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    name = parameters.get("name")
    exists = isinstance(name, str) and bpy.data.objects.get(name) is not None
    return exists, {"objectName": name if isinstance(name, str) else None}


def _resource_exists(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    requested = _resource_ids(parameters)
    registry = build_resource_registry(receipts)
    available = [
        logical_id
        for logical_id in requested
        if logical_id in registry and resolve_resource(registry[logical_id]) is not None
    ]
    return bool(requested) and len(available) == len(requested), {
        "resourceIds": list(requested),
        "availableResourceIds": available,
    }


def _mesh_signature_sha256(signature: tuple[Any, ...]) -> str:
    payload = json.dumps(
        signature,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _stable_content_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _identity_proof(identity: Any) -> dict[str, Any] | None:
    if identity is None:
        return None
    return {
        "resourceType": identity.resource_type,
        "logicalId": identity.logical_id,
        "displayName": identity.display_name,
        "receiptToken": identity.receipt_token,
        "stepId": identity.step_id,
        "actionName": identity.action_name,
    }


def _replacement_mesh_proof(
    parameters: Mapping[str, Any],
    receipts: Mapping[str, ActionReceipt],
    action_name: str,
) -> dict[str, Any]:
    target_id = parameters.get("targetId")
    result_mesh_id = parameters.get("resultMeshId")
    legacy_parameters_valid = bool(
        set(parameters) == {"targetId", "resultMeshId"}
        and isinstance(target_id, str)
        and target_id
        and isinstance(result_mesh_id, str)
        and result_mesh_id
    )
    validator = {
        "blender.mesh.edit_subdivide": validate_subdivide,
        "blender.mesh.edit_triangulate": validate_triangulate,
        "blender.mesh.edit_extrude_region": validate_extrude_region,
        "blender.mesh.edit_bevel_edges": validate_edit_bevel_edges,
        "blender.mesh.edit_inset_faces": validate_edit_inset_faces,
        "blender.mesh.edit_poke_faces": validate_edit_poke_faces,
    }[action_name]
    try:
        validator(parameters)
        replay_parameters_valid = True
    except (KeyError, TypeError, ValueError):
        replay_parameters_valid = False
    parameters_valid = legacy_parameters_valid or replay_parameters_valid
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if parameters_valid else None
    result_identity = registry.get(result_mesh_id) if parameters_valid else None
    target = resolve_resource(target_identity) if target_identity is not None else None
    result_mesh = (
        resolve_resource(result_identity) if result_identity is not None else None
    )
    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name == action_name
        and result_identity is not None
        and result_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    data_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "data"
            and mutation.resource == target_identity
            and mutation.after == result_identity
        )
        if receipt is not None
        else ()
    )
    result_content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == result_identity
            and mutation.after is not None
        )
        if receipt is not None
        else ()
    )
    data_mutation = data_mutations[0] if len(data_mutations) == 1 else None
    result_content_mutation = (
        result_content_mutations[0]
        if len(result_content_mutations) == 1
        else None
    )
    source_identity = data_mutation.before if data_mutation is not None else None
    source_mesh = resolve_resource(source_identity) if source_identity is not None else None
    source_receipts = tuple(
        candidate
        for candidate in receipts.values()
        if source_identity is not None and source_identity in candidate.created
    )
    source_receipt = source_receipts[0] if len(source_receipts) == 1 else None
    source_content_mutations = (
        tuple(
            mutation
            for mutation in source_receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == source_identity
            and mutation.after is not None
        )
        if source_receipt is not None
        else ()
    )
    source_counts = (
        (
            len(source_mesh.vertices),
            len(source_mesh.edges),
            len(source_mesh.polygons),
        )
        if isinstance(source_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    result_counts = (
        (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        if isinstance(result_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    source_signature = (
        mesh_content_signature(source_mesh)
        if isinstance(source_mesh, bpy.types.Mesh)
        else None
    )
    result_signature = (
        mesh_content_signature(result_mesh)
        if isinstance(result_mesh, bpy.types.Mesh)
        else None
    )
    assigned = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(result_mesh, bpy.types.Mesh)
        and target.data is result_mesh
    )
    receipt_matches = bool(
        receipt is not None
        and receipt.anchor == target_identity
        and receipt.created == (result_identity,)
        and len(data_mutations) == 1
        and len(result_content_mutations) == 1
        and isinstance(source_mesh, bpy.types.Mesh)
    )
    content_intact = bool(
        result_signature is not None
        and result_content_mutation is not None
        and result_content_mutation.after == result_signature
    )
    source_content_intact = bool(
        source_signature is not None
        and len(source_content_mutations) == 1
        and source_content_mutations[0].after == source_signature
    )
    result_name_matches = bool(
        legacy_parameters_valid
        or (
            replay_parameters_valid
            and isinstance(result_mesh, bpy.types.Mesh)
            and result_mesh.name == parameters.get("resultMeshName")
        )
    )
    within_limits = bool(
        all(source_counts)
        and all(result_counts)
        and source_counts[0] <= 8192
        and source_counts[1] <= 16384
        and source_counts[2] <= 8192
        and result_counts[0] <= 8192
        and result_counts[1] <= 16384
        and result_counts[2] <= 8192
    )
    receipt_proof = (
        {
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "anchor": _identity_proof(receipt.anchor),
            "target": _identity_proof(target_identity),
            "source": _identity_proof(source_identity),
            "result": _identity_proof(result_identity),
            "sourceReceiptId": (
                source_receipt.receipt_id if source_receipt is not None else None
            ),
            "sourceContent": (
                source_content_mutations[0].after
                if len(source_content_mutations) == 1
                else None
            ),
            "resultContent": result_content_mutation.after,
        }
        if receipt_matches and result_content_mutation is not None
        else None
    )
    source_sha256 = (
        _mesh_signature_sha256(source_signature)
        if source_signature is not None
        else None
    )
    result_sha256 = (
        _mesh_signature_sha256(result_signature)
        if result_signature is not None
        else None
    )
    receipt_sha256 = (
        _stable_content_sha256(receipt_proof) if receipt_proof is not None else None
    )
    action_arguments_sha256 = (
        _stable_content_sha256(dict(parameters))
        if replay_parameters_valid
        else None
    )
    return {
        "targetId": target_id if isinstance(target_id, str) else None,
        "resultMeshId": result_mesh_id if isinstance(result_mesh_id, str) else None,
        "parametersValid": parameters_valid,
        "replayParametersValid": replay_parameters_valid,
        "assigned": assigned,
        "receiptMatches": receipt_matches,
        "contentIntact": content_intact,
        "sourceContentIntact": source_content_intact,
        "withinLimits": within_limits,
        "resultNameMatches": result_name_matches,
        "sourceVertexCount": source_counts[0],
        "sourceEdgeCount": source_counts[1],
        "sourceFaceCount": source_counts[2],
        "vertexCount": result_counts[0],
        "edgeCount": result_counts[1],
        "faceCount": result_counts[2],
        "sourceMeshContentSha256": source_sha256,
        "resultMeshContentSha256": result_sha256,
        "receiptContentSha256": receipt_sha256,
        "actionArgumentsSha256": action_arguments_sha256,
        "target": target,
        "sourceMesh": source_mesh,
        "resultMesh": result_mesh,
        "sourceIdentity": source_identity,
        "resultIdentity": result_identity,
        "receipt": receipt,
        "attestationSeed": {
            "actionName": action_name,
            "targetId": target_id,
            "resultMeshId": result_mesh_id,
            "sourceMeshContentSha256": source_sha256,
            "resultMeshContentSha256": result_sha256,
            "receiptContentSha256": receipt_sha256,
            "actionArgumentsSha256": action_arguments_sha256,
            "sourceTopology": list(source_counts),
            "resultTopology": list(result_counts),
        },
    }


def _replacement_mesh_details(
    proof: Mapping[str, Any], invariant: Mapping[str, Any]
) -> dict[str, Any]:
    stable = {
        key: value
        for key, value in proof.items()
        if key
        not in {
            "target",
            "sourceMesh",
            "resultMesh",
            "sourceIdentity",
            "resultIdentity",
            "receipt",
            "attestationSeed",
        }
    }
    attestation_ready = bool(
        proof["replayParametersValid"]
        and proof["assigned"]
        and proof["receiptMatches"]
        and proof["contentIntact"]
        and proof["sourceContentIntact"]
        and proof["withinLimits"]
        and proof["resultNameMatches"]
        and invariant.get("topologyMatches")
    )
    return {
        **stable,
        **invariant,
        "attestationContentSha256": (
            _stable_content_sha256({**proof["attestationSeed"], **invariant})
            if attestation_ready
            else None
        ),
    }


def _replacement_mesh_observation_satisfied(details: Mapping[str, Any]) -> bool:
    return bool(
        details.get("parametersValid")
        and details.get("assigned")
        and details.get("receiptMatches")
        and details.get("contentIntact")
        and details.get("sourceContentIntact")
        and details.get("withinLimits")
        and details.get("resultNameMatches")
        and details.get("topologyMatches")
    )


def _bounded_integer_parameter(
    value: Any,
    *,
    minimum: int,
    maximum: int,
) -> int | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or not float(value).is_integer()
    ):
        return None
    result = int(value)
    return result if minimum <= result <= maximum else None


def _torus_coordinates_match(
    mesh: bpy.types.Mesh,
    major_segments: int,
    minor_segments: int,
    major_radius: float,
    minor_radius: float,
) -> bool:
    if len(mesh.vertices) != major_segments * minor_segments:
        return False
    tolerance = max(1e-6, (major_radius + minor_radius) * 1e-5)
    for vertex_index, vertex in enumerate(mesh.vertices):
        major_index, minor_index = divmod(vertex_index, minor_segments)
        major_angle = math.tau * major_index / major_segments
        minor_angle = math.tau * minor_index / minor_segments
        radial = major_radius + minor_radius * math.cos(minor_angle)
        expected = (
            radial * math.cos(major_angle),
            radial * math.sin(major_angle),
            minor_radius * math.sin(minor_angle),
        )
        if not all(
            math.isclose(
                float(actual),
                target,
                rel_tol=1e-5,
                abs_tol=tolerance,
            )
            for actual, target in zip(vertex.co, expected)
        ):
            return False
    return True


def _bounded_number_parameter(
    value: Any,
    *,
    minimum: float,
    maximum: float,
) -> float | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
    ):
        return None
    result = float(value)
    return result if minimum <= result <= maximum else None


def _finite_vector3_parameter(value: Any) -> tuple[float, float, float] | None:
    if (
        not isinstance(value, list)
        or len(value) != 3
        or any(
            isinstance(component, bool)
            or not isinstance(component, (int, float))
            or not math.isfinite(float(component))
            or not -1000.0 <= float(component) <= 1000.0
            for component in value
        )
    ):
        return None
    return tuple(float(component) for component in value)


def _segment_ring_matches(
    coordinates: list[Vector],
    *,
    z: float,
    radius: float,
    radial_tolerance: float,
    depth_tolerance: float,
) -> bool:
    expected_count = 1 if radius == 0.0 else 32
    if len(coordinates) != expected_count:
        return False
    if radius == 0.0:
        coordinate = coordinates[0]
        return bool(
            math.isclose(float(coordinate.x), 0.0, rel_tol=0.0, abs_tol=radial_tolerance)
            and math.isclose(
                float(coordinate.y), 0.0, rel_tol=0.0, abs_tol=radial_tolerance
            )
            and math.isclose(float(coordinate.z), z, rel_tol=1e-5, abs_tol=depth_tolerance)
        )

    unmatched = list(coordinates)
    for segment_index in range(32):
        angle = math.tau * segment_index / 32
        expected = (
            radius * math.sin(angle),
            radius * math.cos(angle),
            z,
        )
        match_index = next(
            (
                index
                for index, coordinate in enumerate(unmatched)
                if all(
                    math.isclose(
                        float(actual),
                        target,
                        rel_tol=1e-5,
                        abs_tol=radial_tolerance,
                    )
                    for actual, target in (
                        (coordinate.x, expected[0]),
                        (coordinate.y, expected[1]),
                    )
                )
                and math.isclose(
                    float(coordinate.z),
                    expected[2],
                    rel_tol=1e-5,
                    abs_tol=depth_tolerance,
                )
            ),
            None,
        )
        if match_index is None:
            return False
        unmatched.pop(match_index)
    return not unmatched


def _segment_mesh_geometry_matches(
    mesh: bpy.types.Mesh,
    *,
    depth: float,
    radius_start: float,
    radius_end: float,
) -> bool:
    half_depth = depth / 2.0
    radial_tolerance = max(1e-6, radius_start * 1e-5, radius_end * 1e-5)
    depth_tolerance = max(1e-6, depth * 1e-5)
    lower: list[Vector] = []
    upper: list[Vector] = []
    for vertex in mesh.vertices:
        coordinate = vertex.co.copy()
        if abs(float(coordinate.z) + half_depth) <= abs(float(coordinate.z) - half_depth):
            lower.append(coordinate)
        else:
            upper.append(coordinate)
    expected_face_sizes = (
        [3] * 32 + [32]
        if radius_start == 0.0 or radius_end == 0.0
        else [4] * 32 + [32, 32]
    )
    return bool(
        sorted(len(polygon.vertices) for polygon in mesh.polygons)
        == expected_face_sizes
        and _segment_ring_matches(
            lower,
            z=-half_depth,
            radius=radius_start,
            radial_tolerance=radial_tolerance,
            depth_tolerance=depth_tolerance,
        )
        and _segment_ring_matches(
            upper,
            z=half_depth,
            radius=radius_end,
            radial_tolerance=radial_tolerance,
            depth_tolerance=depth_tolerance,
        )
    )


def _single_mesh_primitive_ready(
    parameters: Mapping[str, Any],
    receipts: Mapping[str, ActionReceipt],
    *,
    action_name: str,
    primitive_kind: Literal[
        "uv_sphere", "icosphere", "cube", "plane", "torus", "cone", "cylinder"
    ],
) -> ObservationResult:
    spherical = primitive_kind in {"uv_sphere", "icosphere"}
    subdivisions_required = primitive_kind == "icosphere"
    torus = primitive_kind == "torus"
    segment = primitive_kind in {"cone", "cylinder"}
    cone = primitive_kind == "cone"
    dimension_parameter = (
        None if torus or segment else ("radius" if spherical else "size")
    )
    dimension_detail = (
        "segmentGeometryMatches"
        if segment
        else "geometryMatches"
        if torus
        else ("radiusMatches" if spherical else "sizeMatches")
    )
    allowed_parameters = (
        {
            "resourceId",
            "objectName",
            "majorSegments",
            "minorSegments",
            "majorRadius",
            "minorRadius",
            "location",
        }
        if torus
        else {
            "resourceId",
            "objectName",
            "radiusStart",
            "radiusEnd",
            "start",
            "end",
        }
        if cone
        else {"resourceId", "objectName", "radius", "start", "end"}
        if segment
        else {
            "resourceId",
            "objectName",
            dimension_parameter,
            "location",
        }
    )
    if subdivisions_required:
        allowed_parameters.add("subdivisions")
    resource_id = parameters.get("resourceId")
    object_name = parameters.get("objectName")
    raw_subdivisions = parameters.get("subdivisions")
    raw_major_segments = parameters.get("majorSegments")
    raw_minor_segments = parameters.get("minorSegments")
    raw_major_radius = parameters.get("majorRadius")
    raw_minor_radius = parameters.get("minorRadius")
    raw_radius_start = parameters.get("radiusStart")
    raw_radius_end = parameters.get("radiusEnd")
    raw_segment_radius = parameters.get("radius") if segment else None
    raw_start = parameters.get("start")
    raw_end = parameters.get("end")
    raw_dimension = (
        parameters.get(dimension_parameter)
        if dimension_parameter is not None
        else None
    )
    raw_location = parameters.get("location")
    subdivisions = _bounded_integer_parameter(
        raw_subdivisions,
        minimum=1,
        maximum=5,
    )
    major_segments = _bounded_integer_parameter(
        raw_major_segments,
        minimum=3,
        maximum=128,
    )
    minor_segments = _bounded_integer_parameter(
        raw_minor_segments,
        minimum=3,
        maximum=64,
    )
    major_radius = (
        float(raw_major_radius)
        if not isinstance(raw_major_radius, bool)
        and isinstance(raw_major_radius, (int, float))
        and math.isfinite(float(raw_major_radius))
        and float(raw_major_radius) > 0
        else None
    )
    minor_radius = (
        float(raw_minor_radius)
        if not isinstance(raw_minor_radius, bool)
        and isinstance(raw_minor_radius, (int, float))
        and math.isfinite(float(raw_minor_radius))
        and float(raw_minor_radius) > 0
        else None
    )
    dimension = (
        float(raw_dimension)
        if not isinstance(raw_dimension, bool)
        and isinstance(raw_dimension, (int, float))
        and math.isfinite(float(raw_dimension))
        and float(raw_dimension) > 0
        else None
    )
    radius_start = _bounded_number_parameter(
        raw_radius_start if cone else raw_segment_radius,
        minimum=0.0 if cone else 0.0001,
        maximum=1000.0,
    )
    radius_end = _bounded_number_parameter(
        raw_radius_end if cone else raw_segment_radius,
        minimum=0.0 if cone else 0.0001,
        maximum=1000.0,
    )
    start = _finite_vector3_parameter(raw_start)
    end = _finite_vector3_parameter(raw_end)
    raw_location_vector = _finite_vector3_parameter(raw_location)
    location = (
        tuple((start[index] + end[index]) / 2.0 for index in range(3))
        if segment and start is not None and end is not None
        else raw_location_vector
    )
    segment_parameters_valid = bool(
        segment
        and start is not None
        and end is not None
        and start != end
        and radius_start is not None
        and radius_end is not None
        and (not cone or radius_start > 0.0 or radius_end > 0.0)
    )
    parameters_valid = bool(
        set(parameters) == allowed_parameters
        and isinstance(resource_id, str)
        and resource_id
        and isinstance(object_name, str)
        and object_name
        and (
            segment_parameters_valid
            if segment
            else (not subdivisions_required or subdivisions is not None)
            and (
                major_segments is not None
                and minor_segments is not None
                and major_radius is not None
                and minor_radius is not None
                if torus
                else dimension is not None
            )
            and location is not None
        )
    )

    registry = build_resource_registry(receipts)
    object_identity = registry.get(resource_id) if parameters_valid else None
    mesh_id = f"{resource_id}.mesh" if isinstance(resource_id, str) else None
    mesh_identity = registry.get(mesh_id) if mesh_id is not None else None
    collection_identity = registry.get(COLLECTION_LOGICAL_ID)
    obj = resolve_resource(object_identity) if object_identity is not None else None
    mesh = resolve_resource(mesh_identity) if mesh_identity is not None else None
    collection = (
        resolve_resource(collection_identity)
        if collection_identity is not None
        else None
    )
    object_owned = bool(
        object_identity is not None
        and object_identity.resource_type == "OBJECT"
        and isinstance(obj, bpy.types.Object)
        and obj.type == "MESH"
    )
    mesh_owned = bool(
        mesh_identity is not None
        and mesh_identity.resource_type == "MESH"
        and isinstance(mesh, bpy.types.Mesh)
    )
    collection_owned = bool(
        collection_identity is not None
        and collection_identity.resource_type == "COLLECTION"
        and isinstance(collection, bpy.types.Collection)
        and collection.name == COLLECTION_NAME
    )

    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name == action_name
        and object_identity is not None
        and mesh_identity is not None
        and collection_identity is not None
        and object_identity in receipt.created
        and mesh_identity in receipt.created
        and collection_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    data_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.resource == object_identity and mutation.attribute == "data"
        )
        if receipt is not None
        else ()
    )
    collection_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.resource == object_identity
            and mutation.attribute == "users_collection"
        )
        if receipt is not None
        else ()
    )
    content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.resource == mesh_identity and mutation.attribute == "mesh_content"
        )
        if receipt is not None
        else ()
    )
    data_mutation = data_mutations[0] if len(data_mutations) == 1 else None
    collection_mutation = (
        collection_mutations[0] if len(collection_mutations) == 1 else None
    )
    content_mutation = content_mutations[0] if len(content_mutations) == 1 else None
    receipt_matches = bool(
        receipt is not None
        and receipt.anchor == object_identity
        and len(receipt.created) == 3
        and set(receipt.created)
        == {object_identity, mesh_identity, collection_identity}
        and len(receipt.mutations) == 3
        and data_mutation is not None
        and data_mutation.before is None
        and data_mutation.after == mesh_identity
        and collection_mutation is not None
        and collection_mutation.before == ()
        and collection_mutation.after == (collection_identity,)
        and content_mutation is not None
        and content_mutation.before is None
    )

    object_data_matches = bool(
        object_owned and mesh_owned and isinstance(obj, bpy.types.Object) and obj.data is mesh
    )
    collection_link_matches = bool(
        object_owned
        and collection_owned
        and isinstance(obj, bpy.types.Object)
        and isinstance(collection, bpy.types.Collection)
        and tuple(obj.users_collection) == (collection,)
        and tuple(collection.objects) == (obj,)
        and not collection.children
        and any(
            child is collection for child in bpy.context.scene.collection.children
        )
    )
    name_matches = bool(
        object_owned
        and mesh_owned
        and isinstance(obj, bpy.types.Object)
        and isinstance(mesh, bpy.types.Mesh)
        and obj.name == object_name
        and object_identity is not None
        and object_identity.display_name == object_name
        and mesh.name == f"{object_name}.Mesh"
        and mesh_identity is not None
        and mesh_identity.display_name == f"{object_name}.Mesh"
    )

    tolerance = 1e-6
    location_matches = bool(
        object_owned
        and isinstance(obj, bpy.types.Object)
        and location is not None
        and all(
            math.isclose(float(actual), expected, rel_tol=0.0, abs_tol=tolerance)
            for actual, expected in zip(obj.location, location)
        )
    )
    expected_rotation = (
        (Vector(end) - Vector(start)).to_track_quat("Z", "Y")
        if segment and start is not None and end is not None and start != end
        else None
    )
    rotation_matches = bool(
        object_owned
        and isinstance(obj, bpy.types.Object)
        and (
            obj.rotation_mode == "QUATERNION"
            and expected_rotation is not None
            and math.isclose(
                float(
                    obj.matrix_basis.to_quaternion()
                    .rotation_difference(expected_rotation)
                    .angle
                ),
                0.0,
                rel_tol=0.0,
                abs_tol=tolerance,
            )
            if segment
            else math.isclose(
                float(obj.matrix_basis.to_quaternion().angle),
                0.0,
                rel_tol=0.0,
                abs_tol=tolerance,
            )
        )
    )
    scale_matches = bool(
        object_owned
        and isinstance(obj, bpy.types.Object)
        and all(
            math.isclose(float(component), 1.0, rel_tol=0.0, abs_tol=tolerance)
            for component in obj.scale
        )
        and all(
            math.isclose(float(component), 1.0, rel_tol=0.0, abs_tol=tolerance)
            for component in obj.delta_scale
        )
    )
    transform_isolated = bool(
        object_owned
        and isinstance(obj, bpy.types.Object)
        and obj.parent is None
        and len(obj.constraints) == 0
        and all(
            math.isclose(float(component), 0.0, rel_tol=0.0, abs_tol=tolerance)
            for component in obj.delta_location
        )
    )
    modifiers_absent = bool(
        object_owned and isinstance(obj, bpy.types.Object) and len(obj.modifiers) == 0
    )
    shape_keys_absent = bool(
        mesh_owned
        and isinstance(mesh, bpy.types.Mesh)
        and mesh.shape_keys is None
    )
    materials_absent = bool(
        mesh_owned and isinstance(mesh, bpy.types.Mesh) and len(mesh.materials) == 0
    )

    depth = (
        (Vector(end) - Vector(start)).length
        if segment and start is not None and end is not None
        else None
    )
    endpoint_tolerance = max(1e-6, depth * 1e-5) if depth is not None else 1e-6
    endpoints_match = bool(
        segment
        and object_owned
        and isinstance(obj, bpy.types.Object)
        and start is not None
        and end is not None
        and depth is not None
        and (
            obj.matrix_basis @ Vector((0.0, 0.0, -depth / 2.0)) - Vector(start)
        ).length
        <= endpoint_tolerance
        and (
            obj.matrix_basis @ Vector((0.0, 0.0, depth / 2.0)) - Vector(end)
        ).length
        <= endpoint_tolerance
    )

    counts = (
        (len(mesh.vertices), len(mesh.edges), len(mesh.polygons))
        if isinstance(mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    if segment and radius_start is not None and radius_end is not None:
        expected_counts = (
            (33, 64, 33)
            if cone and (radius_start == 0.0 or radius_end == 0.0)
            else (64, 96, 34)
        )
    elif primitive_kind == "torus" and major_segments is not None and minor_segments is not None:
        vertex_count = major_segments * minor_segments
        expected_counts = (vertex_count, vertex_count * 2, vertex_count)
    elif primitive_kind == "icosphere" and subdivisions is not None:
        subdivision_scale = 4 ** (subdivisions - 1)
        expected_counts = (
            10 * subdivision_scale + 2,
            30 * subdivision_scale,
            20 * subdivision_scale,
        )
    elif primitive_kind == "uv_sphere":
        expected_counts = (482, 992, 512)
    elif primitive_kind == "cube":
        expected_counts = (8, 12, 6)
    else:
        expected_counts = (4, 4, 1)
    topology_matches = counts == expected_counts
    finite_coordinates = bool(
        isinstance(mesh, bpy.types.Mesh)
        and all(
            math.isfinite(float(component))
            for vertex in mesh.vertices
            for component in vertex.co
        )
    )
    if segment:
        dimension_matches = bool(
            isinstance(mesh, bpy.types.Mesh)
            and depth is not None
            and radius_start is not None
            and radius_end is not None
            and _segment_mesh_geometry_matches(
                mesh,
                depth=depth,
                radius_start=radius_start,
                radius_end=radius_end,
            )
        )
    elif primitive_kind == "torus":
        dimension_matches = bool(
            isinstance(mesh, bpy.types.Mesh)
            and major_segments is not None
            and minor_segments is not None
            and major_radius is not None
            and minor_radius is not None
            and _torus_coordinates_match(
                mesh,
                major_segments,
                minor_segments,
                major_radius,
                minor_radius,
            )
        )
    elif spherical:
        dimension_matches = bool(
            isinstance(mesh, bpy.types.Mesh)
            and dimension is not None
            and all(
                math.isclose(
                    math.sqrt(sum(float(component) ** 2 for component in vertex.co)),
                    dimension,
                    rel_tol=1e-5,
                    abs_tol=max(1e-6, dimension * 1e-5),
                )
                for vertex in mesh.vertices
            )
        )
    elif primitive_kind == "cube":
        half_size = dimension / 2.0 if dimension is not None else None
        dimension_matches = bool(
            isinstance(mesh, bpy.types.Mesh)
            and half_size is not None
            and all(
                math.isclose(
                    abs(float(component)),
                    half_size,
                    rel_tol=1e-5,
                    abs_tol=max(1e-6, half_size * 1e-5),
                )
                for vertex in mesh.vertices
                for component in vertex.co
            )
        )
    else:
        half_size = dimension / 2.0 if dimension is not None else None
        dimension_matches = bool(
            isinstance(mesh, bpy.types.Mesh)
            and half_size is not None
            and all(
                math.isclose(
                    abs(float(vertex.co.x)),
                    half_size,
                    rel_tol=1e-5,
                    abs_tol=max(1e-6, half_size * 1e-5),
                )
                and math.isclose(
                    abs(float(vertex.co.y)),
                    half_size,
                    rel_tol=1e-5,
                    abs_tol=max(1e-6, half_size * 1e-5),
                )
                and math.isclose(
                    float(vertex.co.z),
                    0.0,
                    rel_tol=0.0,
                    abs_tol=1e-6,
                )
                for vertex in mesh.vertices
            )
        )
    current_signature = (
        mesh_content_signature(mesh) if isinstance(mesh, bpy.types.Mesh) else None
    )
    content_intact = bool(
        current_signature is not None
        and content_mutation is not None
        and content_mutation.after == current_signature
    )
    mesh_content_sha256 = (
        _mesh_signature_sha256(current_signature)
        if current_signature is not None
        else None
    )

    satisfied = bool(
        parameters_valid
        and object_owned
        and mesh_owned
        and collection_owned
        and receipt_matches
        and object_data_matches
        and collection_link_matches
        and name_matches
        and location_matches
        and rotation_matches
        and scale_matches
        and transform_isolated
        and modifiers_absent
        and shape_keys_absent
        and materials_absent
        and topology_matches
        and finite_coordinates
        and dimension_matches
        and (not segment or endpoints_match)
        and content_intact
    )
    details = {
        "resourceId": resource_id if isinstance(resource_id, str) else None,
        "objectName": object_name if isinstance(object_name, str) else None,
        "meshId": mesh_id,
        "collectionId": COLLECTION_LOGICAL_ID,
        "parametersValid": parameters_valid,
        "objectOwned": object_owned,
        "meshOwned": mesh_owned,
        "collectionOwned": collection_owned,
        "receiptMatches": receipt_matches,
        "objectDataMatches": object_data_matches,
        "collectionLinkMatches": collection_link_matches,
        "nameMatches": name_matches,
        "locationMatches": location_matches,
        "rotationMatches": rotation_matches,
        "scaleMatches": scale_matches,
        "transformIsolated": transform_isolated,
        "modifiersAbsent": modifiers_absent,
        "shapeKeysAbsent": shape_keys_absent,
        "materialsAbsent": materials_absent,
        "contentIntact": content_intact,
        "topologyMatches": topology_matches,
        "finiteCoordinates": finite_coordinates,
        "vertexCount": counts[0],
        "edgeCount": counts[1],
        "faceCount": counts[2],
        "meshContentSha256": mesh_content_sha256,
    }
    details[dimension_detail] = dimension_matches
    if segment:
        details["endpointsMatch"] = endpoints_match
    return satisfied, details


def _uv_sphere_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_uv_sphere",
        primitive_kind="uv_sphere",
    )


def _icosphere_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_icosphere",
        primitive_kind="icosphere",
    )


def _cube_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_cube",
        primitive_kind="cube",
    )


def _plane_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_plane",
        primitive_kind="plane",
    )


def _torus_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_torus",
        primitive_kind="torus",
    )


def _cone_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_cone",
        primitive_kind="cone",
    )


def _cylinder_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _single_mesh_primitive_ready(
        parameters,
        receipts,
        action_name="blender.mesh.create_cylinder",
        primitive_kind="cylinder",
    )


def _material_assigned(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    material_id = parameters.get("materialId")
    targets = parameters.get("targets", parameters.get("targetIds"))
    requested_targets = (
        tuple(targets)
        if isinstance(targets, list)
        and 1 <= len(targets) <= 64
        and all(isinstance(item, str) and item for item in targets)
        and len(set(targets)) == len(targets)
        else ()
    )
    if not isinstance(material_id, str) or not material_id or not requested_targets:
        return False, {
            "materialId": material_id if isinstance(material_id, str) else None,
            "materialName": None,
            "targetIds": list(requested_targets),
            "assignedTargetIds": [],
            "useNodes": False,
            "principledNodeCount": 0,
            "outputNodeCount": 0,
            "baseColor": [],
            "roughness": None,
            "metallic": None,
            "receiptMatches": False,
            "ownershipMatches": False,
            "materialSurfaceMatches": False,
            "assignmentsMatch": False,
            "sourceContentIntact": False,
        }
    registry = build_resource_registry(receipts)
    material_identity = registry.get(material_id)
    material = resolve_resource(material_identity) if material_identity is not None else None
    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name
        in {
            "blender.material.create_and_assign",
            "blender.material.create_palette_and_assign",
        }
        and material_identity is not None
        and material_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    surface_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.resource == material_identity
            and mutation.attribute == "material_surface"
        )
        if receipt is not None
        else ()
    )
    surface_mutation = surface_mutations[0] if len(surface_mutations) == 1 else None
    expected_surface = (
        surface_mutation.after
        if surface_mutation is not None
        and isinstance(surface_mutation.after, MaterialSurfaceState)
        else None
    )
    principled_nodes = (
        tuple(
            node
            for node in material.node_tree.nodes
            if node.bl_idname == "ShaderNodeBsdfPrincipled"
        )
        if isinstance(material, bpy.types.Material)
        and material.use_nodes
        and material.node_tree is not None
        else ()
    )
    output_nodes = (
        tuple(
            node
            for node in material.node_tree.nodes
            if node.bl_idname == "ShaderNodeOutputMaterial"
        )
        if isinstance(material, bpy.types.Material)
        and material.use_nodes
        and material.node_tree is not None
        else ()
    )
    try:
        actual_surface = (
            snapshot_material_surface(material)
            if isinstance(material, bpy.types.Material)
            and len(principled_nodes) == 1
            and len(output_nodes) == 1
            else None
        )
    except RuntimeError:
        actual_surface = None

    def number_matches(actual: float, expected: float) -> bool:
        return math.isclose(
            float(actual), float(expected), rel_tol=1e-6, abs_tol=1e-6
        )
    surface_values_match = bool(
        actual_surface is not None
        and actual_surface.use_nodes
        and all(
            number_matches(actual, expected)
            for actual, expected in zip(
                actual_surface.diffuse_color,
                actual_surface.principled_base_color,
                strict=True,
            )
        )
        and number_matches(
            actual_surface.roughness, actual_surface.principled_roughness
        )
        and number_matches(actual_surface.metallic, actual_surface.principled_metallic)
    )
    material_surface_matches = bool(
        expected_surface is not None
        and actual_surface == expected_surface
        and surface_values_match
    )
    ownership_matches = bool(
        isinstance(material, bpy.types.Material)
        and expected_surface is not None
        and material.name == expected_surface.display_name
        and receipt is not None
        and material_identity is not None
        and material_identity.receipt_token == receipt.receipt_id
        and material_identity.action_name == receipt.action_name
    )
    assignment_records: dict[str, tuple[bool, bool]] = {}
    block_target_order: list[str] = []
    block_structure_matches = False
    surface_index = -1
    block_end = -1
    # A palette receipt concatenates one surface-plus-target block per material,
    # while each Observation may intentionally name only an ordered target subset.
    # Locate and validate the complete block before selecting the requested targets.
    if receipt is not None and surface_mutation is not None:
        surface_index = receipt.mutations.index(surface_mutation)
        block_end = next(
            (
                index
                for index in range(surface_index + 1, len(receipt.mutations))
                if receipt.mutations[index].attribute == "material_surface"
            ),
            len(receipt.mutations),
        )
        block_mutations = receipt.mutations[surface_index + 1 : block_end]
        block_structure_matches = bool(
            block_mutations and len(block_mutations) % 3 == 0
        )
        if block_structure_matches:
            for offset in range(0, len(block_mutations), 3):
                data_guard, mesh_guard, slot_write = block_mutations[offset : offset + 3]
                target_identity = data_guard.resource
                target_id = target_identity.logical_id
                target = resolve_resource(target_identity)
                mesh_identities = (
                    tuple(
                        identity
                        for identity in registry.values()
                        if identity.resource_type == "MESH"
                        and resolve_resource(identity) is target.data
                    )
                    if isinstance(target, bpy.types.Object) and target.type == "MESH"
                    else ()
                )
                mesh_identity = (
                    mesh_identities[0] if len(mesh_identities) == 1 else None
                )
                mesh = (
                    resolve_resource(mesh_identity)
                    if mesh_identity is not None
                    else None
                )
                target_receipt_matches = bool(
                    target_id not in assignment_records
                    and registry.get(target_id) == target_identity
                    and mesh_identity is not None
                    and data_guard.attribute == "data"
                    and data_guard.before == mesh_identity
                    and data_guard.after == mesh_identity
                    and mesh_guard.resource == mesh_identity
                    and mesh_guard.attribute == "mesh_content"
                    and mesh_guard.before == mesh_guard.after
                    and slot_write.resource == target_identity
                    and slot_write.attribute == "material_slots"
                    and slot_write.after == (material_identity,)
                )
                if not target_receipt_matches:
                    block_structure_matches = False
                    break
                current_content_intact = bool(
                    isinstance(mesh, bpy.types.Mesh)
                    and mesh_content_signature(mesh) == mesh_guard.after
                )
                current_assignment_matches = bool(
                    isinstance(target, bpy.types.Object)
                    and target.type == "MESH"
                    and target.data is mesh
                    and isinstance(material, bpy.types.Material)
                    and tuple(slot.material for slot in target.material_slots)
                    == (material,)
                )
                assignment_records[target_id] = (
                    current_content_intact,
                    current_assignment_matches,
                )
                block_target_order.append(target_id)

    assigned: list[str] = []
    source_content_intact = True
    requested_positions: list[int] = []
    for target_id in requested_targets:
        assignment = assignment_records.get(target_id)
        if assignment is None:
            source_content_intact = False
            continue
        current_content_intact, current_assignment_matches = assignment
        source_content_intact = source_content_intact and current_content_intact
        requested_positions.append(block_target_order.index(target_id))
        if current_assignment_matches:
            assigned.append(target_id)
    assignment_receipts_match = bool(
        len(requested_positions) == len(requested_targets)
        and requested_positions == sorted(requested_positions)
    )
    single_receipt_matches = bool(
        receipt is not None
        and receipt.action_name == "blender.material.create_and_assign"
        and receipt.created == (material_identity,)
        and surface_index == 0
        and block_end == len(receipt.mutations)
        and tuple(block_target_order) == requested_targets
        and receipt.anchor == registry.get(requested_targets[0])
    )
    palette_receipt_matches = bool(
        receipt is not None
        and receipt.action_name == "blender.material.create_palette_and_assign"
        and material_identity in receipt.created
        and len({identity.logical_id for identity in receipt.created})
        == len(receipt.created)
        and all(
            identity.resource_type == "MATERIAL"
            and identity.receipt_token == receipt.receipt_id
            and identity.action_name == receipt.action_name
            for identity in receipt.created
        )
        and receipt.anchor is not None
        and receipt.anchor.resource_type == "OBJECT"
    )
    receipt_matches = bool(
        material_identity is not None
        and len(surface_mutations) == 1
        and block_structure_matches
        and assignment_receipts_match
        and (single_receipt_matches or palette_receipt_matches)
    )
    assignments_match = len(assigned) == len(requested_targets)
    satisfied = (
        isinstance(material, bpy.types.Material)
        and receipt_matches
        and ownership_matches
        and material_surface_matches
        and assignments_match
        and source_content_intact
    )
    return satisfied, {
        "materialId": material_id,
        "materialName": material.name if isinstance(material, bpy.types.Material) else None,
        "targetIds": list(requested_targets),
        "assignedTargetIds": assigned,
        "useNodes": bool(material.use_nodes)
        if isinstance(material, bpy.types.Material)
        else False,
        "principledNodeCount": len(principled_nodes),
        "outputNodeCount": len(output_nodes),
        "baseColor": list(actual_surface.principled_base_color)
        if actual_surface is not None
        else [],
        "roughness": actual_surface.principled_roughness
        if actual_surface is not None
        else None,
        "metallic": actual_surface.principled_metallic
        if actual_surface is not None
        else None,
        "receiptMatches": receipt_matches,
        "ownershipMatches": ownership_matches,
        "materialSurfaceMatches": material_surface_matches,
        "assignmentsMatch": assignments_match,
        "sourceContentIntact": source_content_intact,
    }


def _render_scene_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    ids = {
        key: parameters.get(key)
        for key in ("sceneId", "worldId", "collectionId")
    }
    registry = build_resource_registry(receipts)
    identities = {
        key: registry.get(value) if isinstance(value, str) else None
        for key, value in ids.items()
    }
    scene = resolve_resource(identities["sceneId"]) if identities["sceneId"] else None
    world = resolve_resource(identities["worldId"]) if identities["worldId"] else None
    collection = (
        resolve_resource(identities["collectionId"])
        if identities["collectionId"]
        else None
    )
    tracked_object_pointers = {
        resource.as_pointer()
        for identity in registry.values()
        if identity.resource_type == "OBJECT"
        for resource in (resolve_resource(identity),)
        if isinstance(resource, bpy.types.Object)
    }
    contents_tracked = (
        isinstance(collection, bpy.types.Collection)
        and not collection.children
        and all(
            obj.as_pointer() in tracked_object_pointers
            for obj in collection.all_objects
        )
    )
    isolated = (
        isinstance(scene, bpy.types.Scene)
        and isinstance(collection, bpy.types.Collection)
        and tuple(scene.collection.children) == (collection,)
        and contents_tracked
    )
    satisfied = (
        isinstance(scene, bpy.types.Scene)
        and isinstance(world, bpy.types.World)
        and scene.world is world
        and isolated
    )
    return satisfied, {
        "sceneId": ids["sceneId"],
        "worldId": ids["worldId"],
        "collectionId": ids["collectionId"],
        "worldAssigned": isinstance(scene, bpy.types.Scene) and scene.world is world,
        "collectionIsolated": isolated,
        "collectionContentsTracked": contents_tracked,
    }


def _armature_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    try:
        replay_definition = validate_armature(parameters)
    except (KeyError, TypeError, ValueError):
        replay_definition = None
    if replay_definition is None and set(parameters).intersection(
        {"objectName", "dataName", "collectionId", "bones"}
    ):
        armature_id = parameters.get("armatureId")
        return False, {
            "armatureId": armature_id if isinstance(armature_id, str) else None,
            "boneNames": [],
            "availableBoneNames": [],
            "boundTargetIds": [],
            "parametersValid": False,
            "receiptMatches": False,
            "ownershipMatches": False,
            "bonesMatch": False,
            "bindingsMatch": False,
            "actionArgumentsSha256": None,
            "armatureContentSha256": None,
            "receiptContentSha256": None,
            "attestationContentSha256": None,
        }
    if replay_definition is not None:
        registry = build_resource_registry(receipts)
        armature_identity = registry.get(replay_definition.logical_id)
        data_identity = registry.get(f"{replay_definition.logical_id}.data")
        collection_identity = registry.get(replay_definition.collection_id)
        armature = (
            resolve_resource(armature_identity)
            if armature_identity is not None
            else None
        )
        armature_data = (
            resolve_resource(data_identity) if data_identity is not None else None
        )
        collection = (
            resolve_resource(collection_identity)
            if collection_identity is not None
            else None
        )
        matching_receipts = tuple(
            receipt
            for receipt in receipts.values()
            if receipt.action_name == "blender.rig.create_armature"
            and armature_identity is not None
            and armature_identity in receipt.created
        )
        receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
        expected_created = (
            (data_identity, armature_identity)
            if data_identity is not None and armature_identity is not None
            else ()
        )
        collection_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == armature_identity
                and mutation.attribute == "users_collection"
            )
            if receipt is not None
            else ()
        )
        binding_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.attribute == "bone_parent"
            )
            if receipt is not None
            else ()
        )
        receipt_matches = bool(
            receipt is not None
            and receipt.anchor == armature_identity
            and receipt.created == expected_created
            and len(collection_mutations) == 1
            and len(binding_mutations) == len(replay_definition.bindings)
        )
        ownership_matches = bool(
            isinstance(armature, bpy.types.Object)
            and armature.type == "ARMATURE"
            and armature.data is armature_data
            and armature.name == replay_definition.object_name
            and isinstance(armature_data, bpy.types.Armature)
            and armature_data.name == replay_definition.data_name
            and isinstance(collection, bpy.types.Collection)
            and armature.name in collection.objects
            and receipt is not None
            and armature_identity.receipt_token == receipt.receipt_id
            and data_identity.receipt_token == receipt.receipt_id
            and armature_identity.action_name == receipt.action_name
            and data_identity.action_name == receipt.action_name
        )
        actual_bones = (
            tuple(
                {
                    "boneName": bone.name,
                    "head": [float(value) for value in bone.head_local],
                    "tail": [float(value) for value in bone.tail_local],
                    "parentName": bone.parent.name if bone.parent is not None else None,
                }
                for bone in armature_data.bones
            )
            if isinstance(armature_data, bpy.types.Armature)
            else ()
        )
        expected_bones = tuple(
            {
                "boneName": bone.name,
                "head": list(bone.head),
                "tail": list(bone.tail),
                "parentName": bone.parent_name,
            }
            for bone in replay_definition.bones
        )
        bones_match = actual_bones == expected_bones
        bound_target_ids: list[str] = []
        bindings_match = True
        for binding in replay_definition.bindings:
            target_identity = registry.get(binding.target_id)
            target = (
                resolve_resource(target_identity)
                if target_identity is not None
                else None
            )
            matching_mutations = (
                tuple(
                    mutation
                    for mutation in binding_mutations
                    if mutation.resource == target_identity
                )
                if target_identity is not None
                else ()
            )
            matched = bool(
                isinstance(target, bpy.types.Object)
                and target.parent is armature
                and target.parent_type == "BONE"
                and target.parent_bone == binding.bone_name
                and len(matching_mutations) == 1
            )
            bindings_match = bindings_match and matched
            if matched:
                bound_target_ids.append(binding.target_id)
        armature_content = {
            "armatureId": replay_definition.logical_id,
            "objectName": replay_definition.object_name,
            "dataName": replay_definition.data_name,
            "collectionId": replay_definition.collection_id,
            "bones": actual_bones,
            "bindings": [
                {"targetId": binding.target_id, "boneName": binding.bone_name}
                for binding in replay_definition.bindings
            ],
        }
        receipt_content = (
            {
                "receiptId": receipt.receipt_id,
                "stepId": receipt.step_id,
                "actionName": receipt.action_name,
                "anchor": _identity_proof(receipt.anchor),
                "created": [_identity_proof(item) for item in receipt.created],
            }
            if receipt_matches
            else None
        )
        action_arguments_sha256 = _stable_content_sha256(dict(parameters))
        armature_sha256 = _stable_content_sha256(armature_content)
        receipt_sha256 = (
            _stable_content_sha256(receipt_content)
            if receipt_content is not None
            else None
        )
        satisfied = bool(
            receipt_matches
            and ownership_matches
            and bones_match
            and bindings_match
        )
        return satisfied, {
            "armatureId": replay_definition.logical_id,
            "boneNames": [bone.name for bone in replay_definition.bones],
            "availableBoneNames": [item["boneName"] for item in actual_bones],
            "boundTargetIds": bound_target_ids,
            "parametersValid": True,
            "receiptMatches": receipt_matches,
            "ownershipMatches": ownership_matches,
            "bonesMatch": bones_match,
            "bindingsMatch": bindings_match,
            "actionArgumentsSha256": action_arguments_sha256,
            "armatureContentSha256": armature_sha256,
            "receiptContentSha256": receipt_sha256,
            "attestationContentSha256": (
                _stable_content_sha256(
                    {
                        "actionArgumentsSha256": action_arguments_sha256,
                        "armatureContentSha256": armature_sha256,
                        "receiptContentSha256": receipt_sha256,
                    }
                )
                if satisfied
                else None
            ),
        }

    armature_id = parameters.get("armatureId")
    raw_bone_names = parameters.get("boneNames")
    raw_bindings = parameters.get("bindings")
    bone_names = (
        tuple(raw_bone_names)
        if isinstance(raw_bone_names, list)
        and all(isinstance(item, str) and item for item in raw_bone_names)
        else ()
    )
    bindings = (
        tuple(raw_bindings)
        if isinstance(raw_bindings, list)
        and all(
            isinstance(item, dict)
            and isinstance(item.get("targetId"), str)
            and isinstance(item.get("boneName"), str)
            for item in raw_bindings
        )
        else ()
    )
    registry = build_resource_registry(receipts)

    def resolve_id(value: Any) -> Any | None:
        identity = registry.get(value) if isinstance(value, str) else None
        return resolve_resource(identity) if identity is not None else None

    armature = resolve_id(armature_id)
    available_bones = (
        [name for name in bone_names if armature.data.bones.get(name) is not None]
        if isinstance(armature, bpy.types.Object) and armature.type == "ARMATURE"
        else []
    )
    bound_targets: list[str] = []
    if isinstance(armature, bpy.types.Object) and armature.type == "ARMATURE":
        for binding in bindings:
            target = resolve_id(binding["targetId"])
            if (
                isinstance(target, bpy.types.Object)
                and target.parent is armature
                and target.parent_type == "BONE"
                and target.parent_bone == binding["boneName"]
            ):
                bound_targets.append(binding["targetId"])
    satisfied = (
        isinstance(armature, bpy.types.Object)
        and armature.type == "ARMATURE"
        and bool(bone_names)
        and len(available_bones) == len(bone_names)
        and bool(bindings)
        and len(bound_targets) == len(bindings)
    )
    return satisfied, {
        "armatureId": armature_id if isinstance(armature_id, str) else None,
        "boneNames": list(bone_names),
        "availableBoneNames": available_bones,
        "boundTargetIds": bound_targets,
    }


def _pose_animation_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    try:
        replay_definition = validate_pose_animation(parameters)
    except (KeyError, TypeError, ValueError):
        replay_definition = None
    if replay_definition is None and set(parameters).intersection(
        {"actionName", "keyframes"}
    ):
        armature_id = parameters.get("armatureId")
        action_id = parameters.get("actionId")
        return False, {
            "armatureId": armature_id if isinstance(armature_id, str) else None,
            "actionId": action_id if isinstance(action_id, str) else None,
            "parametersValid": False,
            "receiptMatches": False,
            "ownershipMatches": False,
            "assigned": False,
            "frameRange": [],
            "expectedFrameRange": [],
            "curveCount": 0,
            "expectedCurveCount": 0,
            "curvesMatch": False,
            "valuesMatch": False,
            "interpolationMatches": False,
            "extrapolationMatches": False,
            "actionContentIntact": False,
            "actionArgumentsSha256": None,
            "actionContentSha256": None,
            "receiptContentSha256": None,
            "attestationContentSha256": None,
        }
    if replay_definition is not None:
        registry = build_resource_registry(receipts)
        armature_identity = registry.get(replay_definition.armature_id)
        action_identity = registry.get(replay_definition.logical_id)
        armature = (
            resolve_resource(armature_identity)
            if armature_identity is not None
            else None
        )
        animation = (
            resolve_resource(action_identity) if action_identity is not None else None
        )
        matching_receipts = tuple(
            receipt
            for receipt in receipts.values()
            if receipt.action_name == "blender.animation.create_pose_keyframes"
            and action_identity is not None
            and action_identity in receipt.created
        )
        receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
        action_content_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == action_identity
                and mutation.attribute == "action_keyframes"
                and mutation.after is not None
            )
            if receipt is not None
            else ()
        )
        bone_names = tuple(
            dict.fromkeys(
                pose.bone_name
                for keyframe in replay_definition.keyframes
                for pose in keyframe.poses
            )
        )
        pose_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == armature_identity
                and mutation.attribute.startswith("pose_bone_state:")
            )
            if receipt is not None
            else ()
        )
        animation_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == armature_identity
                and mutation.attribute == "animation_action"
                and mutation.after == action_identity
            )
            if receipt is not None
            else ()
        )
        receipt_matches = bool(
            receipt is not None
            and receipt.anchor == armature_identity
            and receipt.created == (action_identity,)
            and len(action_content_mutations) == 1
            and len(animation_mutations) == 1
            and len(pose_mutations) == len(bone_names)
            and {mutation.attribute.removeprefix("pose_bone_state:") for mutation in pose_mutations}
            == set(bone_names)
        )
        ownership_matches = bool(
            isinstance(armature, bpy.types.Object)
            and armature.type == "ARMATURE"
            and isinstance(animation, bpy.types.Action)
            and animation.name == replay_definition.name
            and receipt is not None
            and action_identity.receipt_token == receipt.receipt_id
            and action_identity.action_name == receipt.action_name
        )
        assigned = bool(
            isinstance(armature, bpy.types.Object)
            and armature.animation_data is not None
            and armature.animation_data.action is animation
        )
        expected_curves: dict[tuple[str, int], list[tuple[float, float]]] = {}
        if isinstance(armature, bpy.types.Object) and armature.type == "ARMATURE":
            for keyframe in replay_definition.keyframes:
                for pose in keyframe.poses:
                    pose_bone = armature.pose.bones.get(pose.bone_name)
                    if pose_bone is None:
                        continue
                    for channel, values in (
                        ("rotation_euler", pose.rotation_euler),
                        ("rotation_quaternion", pose.rotation_quaternion),
                        ("rotation_axis_angle", pose.rotation_axis_angle),
                        ("location", pose.location),
                        ("scale", pose.scale),
                    ):
                        if values is None:
                            continue
                        data_path = pose_bone.path_from_id(channel)
                        for index, value in enumerate(values):
                            expected_curves.setdefault((data_path, index), []).append(
                                (float(keyframe.frame), float(value))
                            )
        actual_curves = {
            (curve.data_path, curve.array_index): curve
            for curve in (
                action_fcurves(animation)
                if isinstance(animation, bpy.types.Action)
                else ()
            )
        }
        curves_match = set(actual_curves) == set(expected_curves)
        values_match = curves_match and all(
            len(actual_curves[key].keyframe_points) == len(expected_points)
            and all(
                math.isclose(float(point.co[0]), expected_frame, abs_tol=1e-6)
                and math.isclose(float(point.co[1]), expected_value, abs_tol=1e-6)
                for point, (expected_frame, expected_value) in zip(
                    actual_curves[key].keyframe_points,
                    expected_points,
                )
            )
            for key, expected_points in expected_curves.items()
        )
        interpolation_matches = curves_match and all(
            point.interpolation == replay_definition.interpolation
            for curve in actual_curves.values()
            for point in curve.keyframe_points
        )
        extrapolation_matches = curves_match and all(
            curve.extrapolation == replay_definition.extrapolation
            for curve in actual_curves.values()
        )
        actual_range = (
            tuple(float(value) for value in animation.frame_range)
            if isinstance(animation, bpy.types.Action)
            else ()
        )
        expected_range = (
            float(replay_definition.keyframes[0].frame),
            float(replay_definition.keyframes[-1].frame),
        )
        action_signature = (
            action_keyframe_signature(animation)
            if isinstance(animation, bpy.types.Action)
            else None
        )
        action_content_intact = bool(
            len(action_content_mutations) == 1
            and action_signature == action_content_mutations[0].after
        )
        receipt_content = (
            {
                "receiptId": receipt.receipt_id,
                "stepId": receipt.step_id,
                "actionName": receipt.action_name,
                "anchor": _identity_proof(receipt.anchor),
                "created": [_identity_proof(item) for item in receipt.created],
                "mutationAttributes": sorted(
                    mutation.attribute for mutation in receipt.mutations
                ),
            }
            if receipt_matches
            else None
        )
        action_arguments_sha256 = _stable_content_sha256(dict(parameters))
        action_sha256 = (
            _stable_content_sha256(action_signature)
            if action_signature is not None
            else None
        )
        receipt_sha256 = (
            _stable_content_sha256(receipt_content)
            if receipt_content is not None
            else None
        )
        satisfied = bool(
            receipt_matches
            and ownership_matches
            and assigned
            and curves_match
            and values_match
            and interpolation_matches
            and extrapolation_matches
            and actual_range == expected_range
            and action_content_intact
        )
        return satisfied, {
            "armatureId": replay_definition.armature_id,
            "actionId": replay_definition.logical_id,
            "parametersValid": True,
            "receiptMatches": receipt_matches,
            "ownershipMatches": ownership_matches,
            "assigned": assigned,
            "frameRange": list(actual_range),
            "expectedFrameRange": list(expected_range),
            "curveCount": len(actual_curves),
            "expectedCurveCount": len(expected_curves),
            "curvesMatch": curves_match,
            "valuesMatch": values_match,
            "interpolationMatches": interpolation_matches,
            "extrapolationMatches": extrapolation_matches,
            "actionContentIntact": action_content_intact,
            "actionArgumentsSha256": action_arguments_sha256,
            "actionContentSha256": action_sha256,
            "receiptContentSha256": receipt_sha256,
            "attestationContentSha256": (
                _stable_content_sha256(
                    {
                        "actionArgumentsSha256": action_arguments_sha256,
                        "actionContentSha256": action_sha256,
                        "receiptContentSha256": receipt_sha256,
                    }
                )
                if satisfied
                else None
            ),
        }

    armature_id = parameters.get("armatureId")
    action_id = parameters.get("actionId")
    raw_frames = parameters.get("frames")
    raw_bone_names = parameters.get("boneNames")
    raw_channels = parameters.get("channels")
    frames = (
        tuple(raw_frames)
        if isinstance(raw_frames, list)
        and all(isinstance(item, int) and not isinstance(item, bool) for item in raw_frames)
        else ()
    )
    bone_names = (
        tuple(raw_bone_names)
        if isinstance(raw_bone_names, list)
        and all(isinstance(item, str) and item for item in raw_bone_names)
        else ()
    )
    if raw_channels is None:
        channels = ("rotation_euler",)
    elif (
        isinstance(raw_channels, list)
        and raw_channels
        and all(
            item
            in {
                "location",
                "rotation_euler",
                "rotation_quaternion",
                "rotation_axis_angle",
                "scale",
            }
            for item in raw_channels
        )
        and len(set(raw_channels)) == len(raw_channels)
    ):
        channels = tuple(raw_channels)
    else:
        channels = ()
    registry = build_resource_registry(receipts)

    def resolve_id(value: Any) -> Any | None:
        identity = registry.get(value) if isinstance(value, str) else None
        return resolve_resource(identity) if identity is not None else None

    armature = resolve_id(armature_id)
    animation = resolve_id(action_id)
    assigned = (
        isinstance(armature, bpy.types.Object)
        and armature.type == "ARMATURE"
        and armature.animation_data is not None
        and armature.animation_data.action is animation
    )
    available_bones = (
        [name for name in bone_names if armature.pose.bones.get(name) is not None]
        if isinstance(armature, bpy.types.Object) and armature.type == "ARMATURE"
        else []
    )
    actual_range = (
        tuple(float(value) for value in animation.frame_range)
        if isinstance(animation, bpy.types.Action)
        else ()
    )
    expected_range = (
        (float(min(frames)), float(max(frames))) if len(frames) >= 2 else ()
    )
    curve_frames: dict[tuple[str, int], set[float]] = {}
    if isinstance(animation, bpy.types.Action):
        curve_frames = {
            (curve.data_path, curve.array_index): {
                float(point.co[0]) for point in curve.keyframe_points
            }
            for curve in action_fcurves(animation)
        }
    expected_frames = {float(frame) for frame in frames}
    component_counts = {
        "location": 3,
        "rotation_euler": 3,
        "rotation_quaternion": 4,
        "rotation_axis_angle": 4,
        "scale": 3,
    }
    channels_complete = (
        isinstance(armature, bpy.types.Object)
        and armature.type == "ARMATURE"
        and len(available_bones) == len(bone_names)
        and all(
            curve_frames.get((armature.pose.bones[name].path_from_id(channel), index))
            == expected_frames
            for name in bone_names
            for channel in channels
            for index in range(component_counts[channel])
        )
    )
    curves = action_fcurves(animation) if isinstance(animation, bpy.types.Action) else ()
    expected_interpolation = parameters.get("interpolation")
    interpolation_valid = expected_interpolation is None or (
        isinstance(expected_interpolation, str)
        and expected_interpolation in {"BEZIER", "LINEAR", "CONSTANT"}
    )
    interpolation_matches = interpolation_valid and (
        expected_interpolation is None
        or all(
            point.interpolation == expected_interpolation
            for curve in curves
            for point in curve.keyframe_points
        )
    )
    expected_extrapolation = parameters.get("extrapolation")
    extrapolation_valid = expected_extrapolation is None or (
        isinstance(expected_extrapolation, str)
        and expected_extrapolation in {"CONSTANT", "LINEAR"}
    )
    extrapolation_matches = extrapolation_valid and (
        expected_extrapolation is None
        or all(curve.extrapolation == expected_extrapolation for curve in curves)
    )
    satisfied = (
        isinstance(animation, bpy.types.Action)
        and assigned
        and bool(bone_names)
        and len(available_bones) == len(bone_names)
        and actual_range == expected_range
        and bool(channels)
        and channels_complete
        and interpolation_matches
        and extrapolation_matches
    )
    return satisfied, {
        "armatureId": armature_id if isinstance(armature_id, str) else None,
        "actionId": action_id if isinstance(action_id, str) else None,
        "assigned": assigned,
        "frameRange": list(actual_range),
        "expectedFrameRange": list(expected_range),
        "availableBoneNames": available_bones,
        "channels": list(channels),
        "channelsComplete": channels_complete,
        "interpolationValid": interpolation_valid,
        "interpolationMatches": interpolation_matches,
        "extrapolationValid": extrapolation_valid,
        "extrapolationMatches": extrapolation_matches,
    }


def _skin_weights_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    try:
        replay_definition = validate_skin_weights(parameters)
    except (KeyError, TypeError, ValueError):
        replay_definition = None
    if replay_definition is None and set(parameters).intersection(
        {"modifierName", "weights"}
    ):
        target_id = parameters.get("targetId")
        armature_id = parameters.get("armatureId")
        modifier_id = parameters.get("modifierId")
        return False, {
            "targetId": target_id if isinstance(target_id, str) else None,
            "armatureId": armature_id if isinstance(armature_id, str) else None,
            "modifierId": modifier_id if isinstance(modifier_id, str) else None,
            "boneNames": [],
            "deformBoneNames": [],
            "vertexCount": None,
            "parametersValid": False,
            "receiptMatches": False,
            "ownershipMatches": False,
            "assignmentMatches": False,
            "modifierMatches": False,
            "meshContentIntact": False,
            "preserveVolumeMatches": False,
            "actionArgumentsSha256": None,
            "weightsContentSha256": None,
            "modifierContentSha256": None,
            "receiptContentSha256": None,
            "attestationContentSha256": None,
        }
    if replay_definition is not None:
        registry = build_resource_registry(receipts)
        target_identity = registry.get(replay_definition.target_id)
        armature_identity = registry.get(replay_definition.armature_id)
        target = (
            resolve_resource(target_identity) if target_identity is not None else None
        )
        armature = (
            resolve_resource(armature_identity)
            if armature_identity is not None
            else None
        )
        matching_receipts = tuple(
            receipt
            for receipt in receipts.values()
            if receipt.action_name == "blender.rig.bind_skin_weights"
            and receipt.anchor == target_identity
        )
        receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
        skin_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == target_identity
                and mutation.attribute
                == f"skin_weights:{replay_definition.modifier_id}"
            )
            if receipt is not None
            else ()
        )
        modifier_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.resource == target_identity
                and mutation.attribute == f"modifier:{replay_definition.modifier_id}"
            )
            if receipt is not None
            else ()
        )
        mesh_content_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.attribute == "mesh_content"
                and mutation.after is not None
            )
            if receipt is not None
            else ()
        )
        receipt_matches = bool(
            receipt is not None
            and receipt.created == ()
            and len(skin_mutations) == 1
            and len(modifier_mutations) == 1
            and len(mesh_content_mutations) == 1
        )
        found_weights = find_owned_skin_weights(receipts, replay_definition.modifier_id)
        weight_owner, weight_state = (
            found_weights if found_weights is not None else (None, None)
        )
        found_modifier = find_owned_modifier(receipts, replay_definition.modifier_id)
        modifier_owner, modifier = (
            found_modifier if found_modifier is not None else (None, None)
        )
        bone_names = tuple(
            dict.fromkeys(
                influence.bone_name
                for weight in replay_definition.weights
                for influence in weight.influences
            )
        )
        expected_assignments = {
            bone_name: tuple(
                (weight.vertex_index, influence.weight)
                for weight in replay_definition.weights
                for influence in weight.influences
                if influence.bone_name == bone_name
            )
            for bone_name in bone_names
        }
        actual_assignments = (
            {
                group.display_name: tuple(group.assignments)
                for group in weight_state.groups
            }
            if weight_state is not None
            else {}
        )
        assignment_matches = bool(
            weight_state is not None
            and weight_state.vertex_count == len(replay_definition.weights)
            and tuple(actual_assignments) == bone_names
            and actual_assignments == expected_assignments
        )
        deform_bone_names = (
            [
                name
                for name in bone_names
                if armature.data.bones.get(name) is not None
                and armature.data.bones[name].use_deform
            ]
            if isinstance(armature, bpy.types.Object)
            and armature.type == "ARMATURE"
            else []
        )
        ownership_matches = bool(
            isinstance(target, bpy.types.Object)
            and target.type == "MESH"
            and isinstance(armature, bpy.types.Object)
            and armature.type == "ARMATURE"
            and weight_owner is target
            and modifier_owner is target
            and receipt is not None
            and weight_state is not None
            and weight_state.receipt_token == receipt.receipt_id
            and weight_state.action_name == receipt.action_name
        )
        modifier_matches = bool(
            modifier is not None
            and modifier.name == replay_definition.modifier_name
            and modifier.type == "ARMATURE"
            and modifier.object is armature
            and modifier.use_vertex_groups
            and not modifier.use_bone_envelopes
            and modifier.use_deform_preserve_volume
            == replay_definition.preserve_volume
        )
        mesh_content_intact = bool(
            isinstance(target, bpy.types.Object)
            and target.type == "MESH"
            and len(mesh_content_mutations) == 1
            and mesh_content_signature(target.data)
            == mesh_content_mutations[0].after
        )
        weights_content = {
            "vertexCount": (
                weight_state.vertex_count if weight_state is not None else None
            ),
            "groups": [
                {
                    "boneName": bone_name,
                    "assignments": [list(item) for item in assignments],
                }
                for bone_name, assignments in actual_assignments.items()
            ],
        }
        modifier_content = {
            "modifierId": replay_definition.modifier_id,
            "modifierName": (
                modifier.name if modifier is not None else None
            ),
            "armatureId": replay_definition.armature_id,
            "useVertexGroups": bool(
                modifier is not None and modifier.use_vertex_groups
            ),
            "useBoneEnvelopes": bool(
                modifier is not None and modifier.use_bone_envelopes
            ),
            "preserveVolume": bool(
                modifier is not None and modifier.use_deform_preserve_volume
            ),
        }
        receipt_content = (
            {
                "receiptId": receipt.receipt_id,
                "stepId": receipt.step_id,
                "actionName": receipt.action_name,
                "anchor": _identity_proof(receipt.anchor),
                "mutationAttributes": sorted(
                    mutation.attribute for mutation in receipt.mutations
                ),
            }
            if receipt_matches
            else None
        )
        action_arguments_sha256 = _stable_content_sha256(dict(parameters))
        weights_sha256 = _stable_content_sha256(weights_content)
        modifier_sha256 = _stable_content_sha256(modifier_content)
        receipt_sha256 = (
            _stable_content_sha256(receipt_content)
            if receipt_content is not None
            else None
        )
        satisfied = bool(
            receipt_matches
            and ownership_matches
            and assignment_matches
            and modifier_matches
            and mesh_content_intact
            and len(deform_bone_names) == len(bone_names)
        )
        return satisfied, {
            "targetId": replay_definition.target_id,
            "armatureId": replay_definition.armature_id,
            "modifierId": replay_definition.modifier_id,
            "boneNames": list(bone_names),
            "deformBoneNames": deform_bone_names,
            "vertexCount": (
                weight_state.vertex_count if weight_state is not None else None
            ),
            "parametersValid": True,
            "receiptMatches": receipt_matches,
            "ownershipMatches": ownership_matches,
            "assignmentMatches": assignment_matches,
            "modifierMatches": modifier_matches,
            "meshContentIntact": mesh_content_intact,
            "preserveVolumeMatches": modifier_matches,
            "actionArgumentsSha256": action_arguments_sha256,
            "weightsContentSha256": weights_sha256,
            "modifierContentSha256": modifier_sha256,
            "receiptContentSha256": receipt_sha256,
            "attestationContentSha256": (
                _stable_content_sha256(
                    {
                        "actionArgumentsSha256": action_arguments_sha256,
                        "weightsContentSha256": weights_sha256,
                        "modifierContentSha256": modifier_sha256,
                        "receiptContentSha256": receipt_sha256,
                    }
                )
                if satisfied
                else None
            ),
        }

    target_id = parameters.get("targetId")
    armature_id = parameters.get("armatureId")
    modifier_id = parameters.get("modifierId")
    raw_bone_names = parameters.get("boneNames")
    bone_names = (
        tuple(raw_bone_names)
        if isinstance(raw_bone_names, list)
        and raw_bone_names
        and all(isinstance(item, str) and item for item in raw_bone_names)
        else ()
    )
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if isinstance(target_id, str) else None
    armature_identity = (
        registry.get(armature_id) if isinstance(armature_id, str) else None
    )
    target = resolve_resource(target_identity) if target_identity is not None else None
    armature = (
        resolve_resource(armature_identity)
        if armature_identity is not None
        else None
    )
    found_weights = (
        find_owned_skin_weights(receipts, modifier_id)
        if isinstance(modifier_id, str)
        else None
    )
    weight_owner, weight_state = (
        found_weights if found_weights is not None else (None, None)
    )
    found_modifier = (
        find_owned_modifier(receipts, modifier_id)
        if isinstance(modifier_id, str)
        else None
    )
    modifier_owner, modifier = (
        found_modifier if found_modifier is not None else (None, None)
    )
    actual_bone_names = (
        tuple(group.display_name for group in weight_state.groups)
        if weight_state is not None
        else ()
    )
    deform_bones = (
        [
            name
            for name in bone_names
            if armature.data.bones.get(name) is not None
            and armature.data.bones[name].use_deform
        ]
        if isinstance(armature, bpy.types.Object) and armature.type == "ARMATURE"
        else []
    )
    preserve_volume = parameters.get("preserveVolume")
    preserve_volume_valid = preserve_volume is None or isinstance(
        preserve_volume, bool
    )
    preserve_volume_matches = preserve_volume_valid and (
        preserve_volume is None
        or bool(
            modifier is not None
            and modifier.use_deform_preserve_volume == preserve_volume
        )
    )
    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(armature, bpy.types.Object)
        and armature.type == "ARMATURE"
        and weight_owner is target
        and modifier_owner is target
        and modifier is not None
        and modifier.type == "ARMATURE"
        and modifier.object is armature
        and modifier.use_vertex_groups
        and not modifier.use_bone_envelopes
        and bone_names
        and actual_bone_names == bone_names
        and len(deform_bones) == len(bone_names)
        and preserve_volume_matches
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "armatureId": armature_id if isinstance(armature_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "boneNames": list(actual_bone_names),
        "deformBoneNames": deform_bones,
        "vertexCount": weight_state.vertex_count if weight_state is not None else None,
        "preserveVolumeMatches": preserve_volume_matches,
    }


def _render_rig_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    scene_id = parameters.get("sceneId")
    camera_id = parameters.get("cameraId")
    raw_light_ids = parameters.get("lightIds")
    light_ids = (
        tuple(raw_light_ids)
        if isinstance(raw_light_ids, list)
        and all(isinstance(item, str) and item for item in raw_light_ids)
        else ()
    )
    registry = build_resource_registry(receipts)

    def resolve_id(logical_id: Any) -> Any | None:
        identity = registry.get(logical_id) if isinstance(logical_id, str) else None
        return resolve_resource(identity) if identity is not None else None

    scene = resolve_id(scene_id)
    camera = resolve_id(camera_id)
    available_lights: list[str] = []
    for logical_id in light_ids:
        light = resolve_id(logical_id)
        if (
            isinstance(light, bpy.types.Object)
            and light.type == "LIGHT"
            and isinstance(scene, bpy.types.Scene)
            and light.name in scene.objects
        ):
            available_lights.append(logical_id)
    camera_active = (
        isinstance(scene, bpy.types.Scene)
        and isinstance(camera, bpy.types.Object)
        and camera.type == "CAMERA"
        and scene.camera is camera
        and camera.name in scene.objects
    )
    satisfied = camera_active and bool(light_ids) and len(available_lights) == len(light_ids)
    return satisfied, {
        "sceneId": scene_id if isinstance(scene_id, str) else None,
        "cameraId": camera_id if isinstance(camera_id, str) else None,
        "lightIds": list(light_ids),
        "availableLightIds": available_lights,
        "cameraActive": camera_active,
    }


def _render_artifact_exists(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    render_id = parameters.get("renderId")
    artifact = find_artifact(receipts, render_id) if isinstance(render_id, str) else None
    path = Path(artifact.path) if artifact is not None else None
    exists = path is not None and path.is_file()
    digest_matches = False
    if exists and artifact is not None:
        digest_matches = hashlib.sha256(path.read_bytes()).hexdigest() == artifact.sha256
    expected_width = parameters.get("width")
    expected_height = parameters.get("height")
    dimensions_match = artifact is not None
    if isinstance(expected_width, int) and not isinstance(expected_width, bool):
        dimensions_match = dimensions_match and artifact.width == expected_width
    if isinstance(expected_height, int) and not isinstance(expected_height, bool):
        dimensions_match = dimensions_match and artifact.height == expected_height
    expected_format = parameters.get("format")
    format_matches = (
        expected_format is None
        or (
            isinstance(expected_format, str)
            and path is not None
            and path.suffix.lower() == f".{expected_format.lower()}"
        )
    )
    satisfied = bool(exists and digest_matches and dimensions_match and format_matches)
    return satisfied, {
        "renderId": render_id if isinstance(render_id, str) else None,
        "fileName": path.name if path is not None else None,
        "width": artifact.width if artifact is not None else None,
        "height": artifact.height if artifact is not None else None,
        "digestMatches": digest_matches,
        "formatMatches": format_matches,
    }


def _mesh_topology_matches(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    if "resultMeshId" in parameters:
        proof = _replacement_mesh_proof(
            parameters, receipts, "blender.mesh.edit_subdivide"
        )
        topology_grew = all(
            proof[result_key] > proof[source_key]
            for result_key, source_key in (
                ("vertexCount", "sourceVertexCount"),
                ("edgeCount", "sourceEdgeCount"),
                ("faceCount", "sourceFaceCount"),
            )
        )
        details = _replacement_mesh_details(
            proof,
            {"topologyMatches": topology_grew, "topologyGrew": topology_grew},
        )
        return _replacement_mesh_observation_satisfied(details), details

    target_id = parameters.get("targetId")
    registry = build_resource_registry(receipts)
    identity = registry.get(target_id) if isinstance(target_id, str) else None
    target = resolve_resource(identity) if identity is not None else None
    counts = {
        "vertexCount": len(target.data.vertices)
        if isinstance(target, bpy.types.Object) and target.type == "MESH"
        else None,
        "edgeCount": len(target.data.edges)
        if isinstance(target, bpy.types.Object) and target.type == "MESH"
        else None,
        "faceCount": len(target.data.polygons)
        if isinstance(target, bpy.types.Object) and target.type == "MESH"
        else None,
    }
    expected = {
        key: parameters.get(key)
        for key in ("vertexCount", "edgeCount", "faceCount")
    }
    declared = {
        key: value
        for key, value in expected.items()
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
    }
    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and declared
        and all(counts[key] == value for key, value in declared.items())
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        **counts,
        "expectedCounts": declared,
    }


def _mesh_triangulated(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    proof = _replacement_mesh_proof(
        parameters, receipts, "blender.mesh.edit_triangulate"
    )
    source_mesh = proof["sourceMesh"]
    result_mesh = proof["resultMesh"]
    receipt = proof["receipt"]
    source_identity = proof["sourceIdentity"]
    source_topology = (
        proof["sourceVertexCount"],
        proof["sourceEdgeCount"],
        proof["sourceFaceCount"],
    )
    result_topology = (
        proof["vertexCount"],
        proof["edgeCount"],
        proof["faceCount"],
    )
    source_content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == source_identity
            and mutation.before == mutation.after
            and mutation.before is not None
        )
        if receipt is not None
        else ()
    )
    source_content_intact = bool(
        isinstance(source_mesh, bpy.types.Mesh)
        and len(source_content_mutations) == 1
        and mesh_content_signature(source_mesh) == source_content_mutations[0].after
    )
    source_loop_count = (
        sum(len(polygon.vertices) for polygon in source_mesh.polygons)
        if isinstance(source_mesh, bpy.types.Mesh)
        else 0
    )
    expected_topology = (
        source_topology[0],
        source_topology[1] + source_loop_count - 3 * source_topology[2],
        source_loop_count - 2 * source_topology[2],
    )
    topology_matches = bool(
        source_loop_count and result_topology == expected_topology
    )
    nonempty = all(
        proof[key] > 0 for key in ("vertexCount", "edgeCount", "faceCount")
    )
    all_triangles = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and result_mesh.polygons
        and all(len(polygon.vertices) == 3 for polygon in result_mesh.polygons)
    )
    details = _replacement_mesh_details(
        proof,
        {
            "topologyMatches": topology_matches,
            "nonempty": nonempty,
            "allTriangles": all_triangles,
            "sourceContentIntact": source_content_intact,
            "sourceLoopCount": source_loop_count,
            "expectedVertexCount": expected_topology[0],
            "expectedEdgeCount": expected_topology[1],
            "expectedFaceCount": expected_topology[2],
        },
    )
    return bool(
        _replacement_mesh_observation_satisfied(details)
        and topology_matches
        and nonempty
        and all_triangles
        and source_content_intact
    ), details


def _replacement_mesh_grew(
    parameters: Mapping[str, Any],
    receipts: Mapping[str, ActionReceipt],
    action_name: str,
) -> ObservationResult:
    proof = _replacement_mesh_proof(parameters, receipts, action_name)
    topology_grew = all(
        proof[result_key] > proof[source_key]
        for result_key, source_key in (
            ("vertexCount", "sourceVertexCount"),
            ("edgeCount", "sourceEdgeCount"),
            ("faceCount", "sourceFaceCount"),
        )
    )
    details = _replacement_mesh_details(
        proof,
        {"topologyMatches": topology_grew, "topologyGrew": topology_grew},
    )
    return _replacement_mesh_observation_satisfied(details), details


def _mesh_region_extruded(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    if set(parameters) == {"targetId", "resultMeshId"}:
        return _replacement_mesh_grew(
            parameters, receipts, "blender.mesh.edit_extrude_region"
        )
    definition = validate_extrude_region(parameters)
    proof = _replacement_mesh_proof(
        parameters, receipts, "blender.mesh.edit_extrude_region"
    )
    source_mesh = proof["sourceMesh"]
    source_topology = (
        proof["sourceVertexCount"],
        proof["sourceEdgeCount"],
        proof["sourceFaceCount"],
    )
    result_topology = (
        proof["vertexCount"],
        proof["edgeCount"],
        proof["faceCount"],
    )
    selected_counts = (0, 0, 0, 0)
    if isinstance(source_mesh, bpy.types.Mesh):
        bm = bmesh.new()
        try:
            bm.from_mesh(source_mesh)
            faces, edges, vertices = _extrude_region_geometry(
                bm, definition.polygon_indices
            )
            selected_faces = set(faces)
            selected_counts = (
                len(faces),
                len(edges),
                len(vertices),
                sum(
                    1
                    for edge in edges
                    if sum(face in selected_faces for face in edge.link_faces) == 1
                ),
            )
        finally:
            bm.free()
    selected_face_count, selected_edge_count, selected_vertex_count, boundary_edge_count = (
        selected_counts
    )
    expected_topology = (
        source_topology[0] + selected_vertex_count,
        source_topology[1] + selected_edge_count + boundary_edge_count,
        source_topology[2] + boundary_edge_count,
    )
    topology_matches = bool(
        selected_face_count == len(definition.polygon_indices)
        and boundary_edge_count > 0
        and result_topology == expected_topology
    )
    topology_grew = all(
        result_count > source_count
        for result_count, source_count in zip(result_topology, source_topology)
    )
    details = _replacement_mesh_details(
        proof,
        {
            "topologyMatches": topology_matches,
            "topologyGrew": topology_grew,
            "selectedFaceCount": selected_face_count,
            "selectedEdgeCount": selected_edge_count,
            "selectedVertexCount": selected_vertex_count,
            "boundaryEdgeCount": boundary_edge_count,
            "expectedVertexCount": expected_topology[0],
            "expectedEdgeCount": expected_topology[1],
            "expectedFaceCount": expected_topology[2],
        },
    )
    return bool(
        _replacement_mesh_observation_satisfied(details)
        and topology_matches
        and topology_grew
    ), details


def _mesh_edges_beveled(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _replacement_mesh_grew(
        parameters, receipts, "blender.mesh.edit_bevel_edges"
    )


def _mesh_faces_inset(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    replay_proof = _replacement_mesh_proof(
        parameters, receipts, "blender.mesh.edit_inset_faces"
    )
    if set(parameters) != {"targetId", "resultMeshId"}:
        source_mesh = replay_proof["sourceMesh"]
        result_mesh = replay_proof["resultMesh"]
        source_counts = (
            replay_proof["sourceVertexCount"],
            replay_proof["sourceEdgeCount"],
            replay_proof["sourceFaceCount"],
        )
        result_counts = (
            replay_proof["vertexCount"],
            replay_proof["edgeCount"],
            replay_proof["faceCount"],
        )
        loop_count = (
            sum(len(polygon.vertices) for polygon in source_mesh.polygons)
            if isinstance(source_mesh, bpy.types.Mesh)
            else 0
        )
        expected_counts = (
            source_counts[0] + loop_count,
            source_counts[1] + 2 * loop_count,
            source_counts[2] + loop_count,
        )
        topology_matches = bool(loop_count and result_counts == expected_counts)
        result_nondegenerate = bool(
            isinstance(result_mesh, bpy.types.Mesh)
            and all(
                math.isfinite(component)
                for vertex in result_mesh.vertices
                for component in vertex.co
            )
            and all(
                math.isfinite(polygon.area) and polygon.area > 0.0
                for polygon in result_mesh.polygons
            )
        )
        details = _replacement_mesh_details(
            replay_proof,
            {
                "topologyMatches": topology_matches,
                "resultNondegenerate": result_nondegenerate,
                "sourceLoopCount": loop_count,
                "expectedVertexCount": expected_counts[0],
                "expectedEdgeCount": expected_counts[1],
                "expectedFaceCount": expected_counts[2],
            },
        )
        return bool(
            _replacement_mesh_observation_satisfied(details)
            and result_nondegenerate
        ), details

    allowed_parameters = {"targetId", "resultMeshId"}
    target_id = parameters.get("targetId")
    result_mesh_id = parameters.get("resultMeshId")
    parameters_valid = bool(
        set(parameters) == allowed_parameters
        and isinstance(target_id, str)
        and target_id
        and isinstance(result_mesh_id, str)
        and result_mesh_id
    )
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if parameters_valid else None
    result_identity = registry.get(result_mesh_id) if parameters_valid else None
    target = resolve_resource(target_identity) if target_identity is not None else None
    result_mesh = (
        resolve_resource(result_identity) if result_identity is not None else None
    )
    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name == "blender.mesh.edit_inset_faces"
        and result_identity is not None
        and result_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    data_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "data"
            and mutation.resource == target_identity
            and mutation.after == result_identity
        )
        if receipt is not None
        else ()
    )
    content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == result_identity
        )
        if receipt is not None
        else ()
    )
    data_mutation = data_mutations[0] if len(data_mutations) == 1 else None
    content_mutation = (
        content_mutations[0] if len(content_mutations) == 1 else None
    )
    source_mesh = (
        resolve_resource(data_mutation.before)
        if data_mutation is not None and data_mutation.before is not None
        else None
    )
    source_counts = (
        (
            len(source_mesh.vertices),
            len(source_mesh.edges),
            len(source_mesh.polygons),
        )
        if isinstance(source_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    result_counts = (
        (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        if isinstance(result_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    loop_count = (
        sum(len(polygon.vertices) for polygon in source_mesh.polygons)
        if isinstance(source_mesh, bpy.types.Mesh)
        else 0
    )
    expected_counts = (
        source_counts[0] + loop_count,
        source_counts[1] + 2 * loop_count,
        source_counts[2] + loop_count,
    )
    topology_matches = bool(loop_count and result_counts == expected_counts)
    within_limits = bool(
        source_counts[0] <= 8192
        and source_counts[1] <= 16384
        and source_counts[2] <= 8192
        and result_counts[0] <= 8192
        and result_counts[1] <= 16384
        and result_counts[2] <= 8192
    )
    assigned = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(result_mesh, bpy.types.Mesh)
        and target.data is result_mesh
    )
    content_intact = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and content_mutation is not None
        and content_mutation.after is not None
        and mesh_content_signature(result_mesh) == content_mutation.after
    )
    result_nondegenerate = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and all(
            math.isfinite(component)
            for vertex in result_mesh.vertices
            for component in vertex.co
        )
        and all(
            math.isfinite(polygon.area) and polygon.area > 0.0
            for polygon in result_mesh.polygons
        )
    )
    receipt_matches = bool(
        receipt is not None
        and data_mutation is not None
        and content_mutation is not None
        and isinstance(source_mesh, bpy.types.Mesh)
    )
    satisfied = bool(
        parameters_valid
        and assigned
        and receipt_matches
        and topology_matches
        and within_limits
        and content_intact
        and result_nondegenerate
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "resultMeshId": (
            result_mesh_id if isinstance(result_mesh_id, str) else None
        ),
        "parametersValid": parameters_valid,
        "assigned": assigned,
        "receiptMatches": receipt_matches,
        "topologyMatches": topology_matches,
        "withinLimits": within_limits,
        "contentIntact": content_intact,
        "resultNondegenerate": result_nondegenerate,
        "sourceLoopCount": loop_count,
        "sourceVertexCount": source_counts[0],
        "sourceEdgeCount": source_counts[1],
        "sourceFaceCount": source_counts[2],
        "expectedVertexCount": expected_counts[0],
        "expectedEdgeCount": expected_counts[1],
        "expectedFaceCount": expected_counts[2],
        "vertexCount": result_counts[0],
        "edgeCount": result_counts[1],
        "faceCount": result_counts[2],
    }


def _mesh_faces_poked(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    replay_proof = _replacement_mesh_proof(
        parameters, receipts, "blender.mesh.edit_poke_faces"
    )
    if set(parameters) != {"targetId", "resultMeshId"}:
        source_mesh = replay_proof["sourceMesh"]
        result_mesh = replay_proof["resultMesh"]
        receipt = replay_proof["receipt"]
        source_identity = replay_proof["sourceIdentity"]
        source_counts = (
            replay_proof["sourceVertexCount"],
            replay_proof["sourceEdgeCount"],
            replay_proof["sourceFaceCount"],
        )
        result_counts = (
            replay_proof["vertexCount"],
            replay_proof["edgeCount"],
            replay_proof["faceCount"],
        )
        source_content_mutations = (
            tuple(
                mutation
                for mutation in receipt.mutations
                if mutation.attribute == "mesh_content"
                and mutation.resource == source_identity
                and mutation.before == mutation.after
                and mutation.before is not None
            )
            if receipt is not None
            else ()
        )
        source_signature = (
            mesh_content_signature(source_mesh)
            if isinstance(source_mesh, bpy.types.Mesh)
            else None
        )
        source_content_intact = bool(
            len(source_content_mutations) == 1
            and source_signature == source_content_mutations[0].after
        )
        loop_count = (
            sum(len(polygon.vertices) for polygon in source_mesh.polygons)
            if isinstance(source_mesh, bpy.types.Mesh)
            else 0
        )
        expected_counts = (
            source_counts[0] + source_counts[2],
            source_counts[1] + loop_count,
            loop_count,
        )
        topology_matches = bool(loop_count and result_counts == expected_counts)
        all_triangles = bool(
            isinstance(result_mesh, bpy.types.Mesh)
            and result_mesh.polygons
            and all(len(face.vertices) == 3 for face in result_mesh.polygons)
        )
        result_edge_lengths = (
            tuple(
                (
                    result_mesh.vertices[edge.vertices[0]].co
                    - result_mesh.vertices[edge.vertices[1]].co
                ).length
                for edge in result_mesh.edges
            )
            if isinstance(result_mesh, bpy.types.Mesh)
            else ()
        )
        result_nondegenerate = bool(
            isinstance(result_mesh, bpy.types.Mesh)
            and all(
                math.isfinite(component)
                for vertex in result_mesh.vertices
                for component in vertex.co
            )
            and all(
                math.isfinite(length) and length > 0.0
                for length in result_edge_lengths
            )
            and all(
                math.isfinite(face.area) and face.area > 0.0
                for face in result_mesh.polygons
            )
        )
        details = _replacement_mesh_details(
            replay_proof,
            {
                "topologyMatches": topology_matches,
                "sourceContentIntact": source_content_intact,
                "resultContentIntact": replay_proof["contentIntact"],
                "allTriangles": all_triangles,
                "resultNondegenerate": result_nondegenerate,
                "sourceLoopCount": loop_count,
                "expectedVertexCount": expected_counts[0],
                "expectedEdgeCount": expected_counts[1],
                "expectedFaceCount": expected_counts[2],
            },
        )
        return bool(
            _replacement_mesh_observation_satisfied(details)
            and source_content_intact
            and all_triangles
            and result_nondegenerate
        ), details

    allowed_parameters = {"targetId", "resultMeshId"}
    target_id = parameters.get("targetId")
    result_mesh_id = parameters.get("resultMeshId")
    parameters_valid = bool(
        set(parameters) == allowed_parameters
        and isinstance(target_id, str)
        and target_id
        and isinstance(result_mesh_id, str)
        and result_mesh_id
    )
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if parameters_valid else None
    result_identity = registry.get(result_mesh_id) if parameters_valid else None
    target = resolve_resource(target_identity) if target_identity is not None else None
    result_mesh = (
        resolve_resource(result_identity) if result_identity is not None else None
    )
    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name == "blender.mesh.edit_poke_faces"
        and result_identity is not None
        and result_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    data_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "data"
            and mutation.resource == target_identity
            and mutation.after == result_identity
        )
        if receipt is not None
        else ()
    )
    data_mutation = data_mutations[0] if len(data_mutations) == 1 else None
    source_identity = data_mutation.before if data_mutation is not None else None
    source_mesh = resolve_resource(source_identity) if source_identity is not None else None
    source_content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == source_identity
            and mutation.before == mutation.after
            and mutation.before is not None
        )
        if receipt is not None
        else ()
    )
    result_content_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.attribute == "mesh_content"
            and mutation.resource == result_identity
            and mutation.before is None
            and mutation.after is not None
        )
        if receipt is not None
        else ()
    )
    source_content_mutation = (
        source_content_mutations[0] if len(source_content_mutations) == 1 else None
    )
    result_content_mutation = (
        result_content_mutations[0] if len(result_content_mutations) == 1 else None
    )
    source_counts = (
        (
            len(source_mesh.vertices),
            len(source_mesh.edges),
            len(source_mesh.polygons),
        )
        if isinstance(source_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    result_counts = (
        (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        if isinstance(result_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    loop_count = (
        sum(len(polygon.vertices) for polygon in source_mesh.polygons)
        if isinstance(source_mesh, bpy.types.Mesh)
        else 0
    )
    expected_counts = (
        source_counts[0] + source_counts[2],
        source_counts[1] + loop_count,
        loop_count,
    )
    topology_matches = bool(loop_count and result_counts == expected_counts)
    within_limits = bool(
        source_counts[0] <= 8192
        and source_counts[1] <= 16384
        and source_counts[2] <= 8192
        and result_counts[0] <= 8192
        and result_counts[1] <= 16384
        and result_counts[2] <= 8192
    )
    assigned = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(result_mesh, bpy.types.Mesh)
        and target.data is result_mesh
    )
    source_content_intact = bool(
        isinstance(source_mesh, bpy.types.Mesh)
        and source_content_mutation is not None
        and mesh_content_signature(source_mesh) == source_content_mutation.after
    )
    result_content_intact = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and result_content_mutation is not None
        and mesh_content_signature(result_mesh) == result_content_mutation.after
    )
    all_triangles = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and result_mesh.polygons
        and all(len(face.vertices) == 3 for face in result_mesh.polygons)
    )
    result_edge_lengths = (
        tuple(
            (
                result_mesh.vertices[edge.vertices[0]].co
                - result_mesh.vertices[edge.vertices[1]].co
            ).length
            for edge in result_mesh.edges
        )
        if isinstance(result_mesh, bpy.types.Mesh)
        else ()
    )
    result_nondegenerate = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and all(
            math.isfinite(component)
            for vertex in result_mesh.vertices
            for component in vertex.co
        )
        and all(math.isfinite(length) and length > 0.0 for length in result_edge_lengths)
        and all(
            math.isfinite(face.area) and face.area > 0.0
            for face in result_mesh.polygons
        )
    )
    receipt_matches = bool(
        receipt is not None
        and receipt.anchor == target_identity
        and len(data_mutations) == 1
        and source_content_mutation is not None
        and result_content_mutation is not None
        and isinstance(source_mesh, bpy.types.Mesh)
    )
    satisfied = bool(
        parameters_valid
        and assigned
        and receipt_matches
        and topology_matches
        and within_limits
        and source_content_intact
        and result_content_intact
        and all_triangles
        and result_nondegenerate
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "resultMeshId": result_mesh_id if isinstance(result_mesh_id, str) else None,
        "parametersValid": parameters_valid,
        "assigned": assigned,
        "receiptMatches": receipt_matches,
        "topologyMatches": topology_matches,
        "withinLimits": within_limits,
        "sourceContentIntact": source_content_intact,
        "resultContentIntact": result_content_intact,
        "allTriangles": all_triangles,
        "resultNondegenerate": result_nondegenerate,
        "sourceLoopCount": loop_count,
        "sourceVertexCount": source_counts[0],
        "sourceEdgeCount": source_counts[1],
        "sourceFaceCount": source_counts[2],
        "expectedVertexCount": expected_counts[0],
        "expectedEdgeCount": expected_counts[1],
        "expectedFaceCount": expected_counts[2],
        "vertexCount": result_counts[0],
        "edgeCount": result_counts[1],
        "faceCount": result_counts[2],
    }


def _modifier_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    allowed_parameters = {
        "targetId",
        "modifierId",
        "modifierType",
        "width",
        "segments",
        "angleLimit",
        "thickness",
        "offset",
        "useEvenOffset",
        "useRim",
        "useRimOnly",
        "solidifyMode",
        "levels",
        "renderLevels",
        "subdivisionType",
        "quality",
        "showOnlyControlEdges",
        "useCreases",
        "useLimitSurface",
        "boundarySmooth",
        "uvSmooth",
        "useCustomNormals",
        "showViewport",
        "showRender",
        "showInEditMode",
        "showOnCage",
        "axis",
    }
    target_id = parameters.get("targetId")
    modifier_id = parameters.get("modifierId")
    modifier_type = parameters.get("modifierType")
    registry = build_resource_registry(receipts)
    identity = registry.get(target_id) if isinstance(target_id, str) else None
    target = resolve_resource(identity) if identity is not None else None
    found = (
        find_owned_modifier(receipts, modifier_id)
        if isinstance(modifier_id, str)
        else None
    )
    owned_modifier_intact = found is not None
    owner, modifier = found if found is not None else (None, None)
    if found is None and isinstance(modifier_id, str):
        modifier_mutation = next(
            (
                mutation
                for receipt in receipts.values()
                for mutation in receipt.mutations
                if mutation.attribute == f"modifier:{modifier_id}"
            ),
            None,
        )
        raw_owner = (
            resolve_resource(modifier_mutation.resource)
            if modifier_mutation is not None
            else None
        )
        pointer = getattr(
            modifier_mutation.after if modifier_mutation is not None else None,
            "pointer",
            None,
        )
        raw_modifier = (
            next(
                (
                    candidate
                    for candidate in raw_owner.modifiers
                    if candidate.as_pointer() == pointer
                ),
                None,
            )
            if isinstance(raw_owner, bpy.types.Object)
            else None
        )
        if raw_modifier is not None:
            owner, modifier = raw_owner, raw_modifier
    properties_match = not bool(set(parameters).difference(allowed_parameters))
    solidify_parameters = {
        "thickness",
        "offset",
        "solidifyMode",
        "useEvenOffset",
        "useRim",
        "useRimOnly",
    }
    if modifier_type == "BEVEL":
        properties_match = properties_match and frozenset(parameters) in {
            frozenset(
                {
                    "targetId",
                    "modifierId",
                    "modifierType",
                    "width",
                    "segments",
                }
            ),
            frozenset(
                {
                    "targetId",
                    "modifierId",
                    "modifierType",
                    "width",
                    "segments",
                    "angleLimit",
                }
            ),
        }
    if modifier_type == "SOLIDIFY":
        properties_match = properties_match and set(parameters) == {
            "targetId",
            "modifierId",
            "modifierType",
            *solidify_parameters,
        }
    subdivision_surface_parameters = {
        "levels",
        "renderLevels",
        "subdivisionType",
        "quality",
        "showOnlyControlEdges",
        "useCreases",
        "useLimitSurface",
        "boundarySmooth",
        "uvSmooth",
        "useCustomNormals",
        "showViewport",
        "showRender",
        "showInEditMode",
        "showOnCage",
    }
    if modifier_type == "SUBSURF":
        properties_match = properties_match and set(parameters) == {
            "targetId",
            "modifierId",
            "modifierType",
            *subdivision_surface_parameters,
        }
    if modifier_type == "MIRROR":
        properties_match = properties_match and set(parameters) == {
            "targetId",
            "modifierId",
            "modifierType",
            "axis",
        }
    elif "axis" in parameters:
        properties_match = False
    if modifier is not None:
        numeric_properties = {
            "width": "width",
            "angleLimit": "angle_limit",
            "thickness": "thickness",
            "offset": "offset",
        }
        for parameter_name, property_name in numeric_properties.items():
            if parameter_name not in parameters:
                continue
            expected = parameters[parameter_name]
            properties_match = properties_match and (
                isinstance(expected, (int, float))
                and not isinstance(expected, bool)
                and math.isfinite(float(expected))
                and hasattr(modifier, property_name)
                and math.isclose(
                    float(getattr(modifier, property_name)),
                    float(expected),
                    abs_tol=1e-6,
                )
            )
        if "segments" in parameters:
            expected_segments = parameters["segments"]
            properties_match = properties_match and (
                isinstance(expected_segments, int)
                and not isinstance(expected_segments, bool)
                and hasattr(modifier, "segments")
                and int(modifier.segments) == expected_segments
            )
        integer_properties = {
            "levels": "levels",
            "renderLevels": "render_levels",
            "quality": "quality",
        }
        for parameter_name, property_name in integer_properties.items():
            if parameter_name not in parameters:
                continue
            expected = parameters[parameter_name]
            properties_match = properties_match and (
                isinstance(expected, int)
                and not isinstance(expected, bool)
                and hasattr(modifier, property_name)
                and int(getattr(modifier, property_name)) == expected
            )
        boolean_properties = {
            "useEvenOffset": "use_even_offset",
            "useRim": "use_rim",
            "useRimOnly": "use_rim_only",
            "showOnlyControlEdges": "show_only_control_edges",
            "useCreases": "use_creases",
            "useLimitSurface": "use_limit_surface",
            "useCustomNormals": "use_custom_normals",
            "showViewport": "show_viewport",
            "showRender": "show_render",
            "showInEditMode": "show_in_editmode",
            "showOnCage": "show_on_cage",
        }
        for parameter_name, property_name in boolean_properties.items():
            if parameter_name not in parameters:
                continue
            expected = parameters[parameter_name]
            properties_match = properties_match and (
                isinstance(expected, bool)
                and hasattr(modifier, property_name)
                and bool(getattr(modifier, property_name)) is expected
            )
        if "solidifyMode" in parameters:
            expected_mode = parameters["solidifyMode"]
            properties_match = properties_match and (
                isinstance(expected_mode, str)
                and hasattr(modifier, "solidify_mode")
                and str(modifier.solidify_mode) == expected_mode
            )
        if "subdivisionType" in parameters:
            expected_type = parameters["subdivisionType"]
            properties_match = properties_match and (
                isinstance(expected_type, str)
                and hasattr(modifier, "subdivision_type")
                and str(modifier.subdivision_type) == expected_type
            )
        enum_properties = {
            "boundarySmooth": "boundary_smooth",
            "uvSmooth": "uv_smooth",
        }
        for parameter_name, property_name in enum_properties.items():
            if parameter_name not in parameters:
                continue
            expected = parameters[parameter_name]
            properties_match = properties_match and (
                isinstance(expected, str)
                and hasattr(modifier, property_name)
                and str(getattr(modifier, property_name)) == expected
            )
    expected_mirror_axis = parameters.get("axis")
    actual_mirror_axis = None
    mirror_fixed_state_matches = False
    mirror_object_absent = False
    actual_bevel_width = None
    actual_bevel_segments = None
    actual_bevel_angle_limit = None
    actual_bevel_limit_method = None
    bevel_fixed_state_matches = False
    actual_solidify_thickness = None
    actual_solidify_offset = None
    actual_solidify_mode = None
    actual_solidify_even_offset = None
    actual_solidify_rim = None
    actual_solidify_rim_only = None
    solidify_fixed_state_matches = False
    source_content_intact = False
    evaluated_topology = (0, 0, 0)
    evaluated_finite = False
    evaluated_within_limits = False
    if modifier_type in {"BEVEL", "MIRROR", "SOLIDIFY", "SUBSURF"} and modifier is not None:
        owning_receipt = next(
            (
                receipt
                for receipt in receipts.values()
                if any(
                    mutation.attribute == f"modifier:{modifier_id}"
                    and getattr(mutation.after, "pointer", None)
                    == modifier.as_pointer()
                    for mutation in receipt.mutations
                )
            ),
            None,
        )
        if owning_receipt is not None:
            data_guard = next(
                (
                    mutation
                    for mutation in owning_receipt.mutations
                    if mutation.attribute == "data"
                    and mutation.before == mutation.after
                ),
                None,
            )
            source_guard = next(
                (
                    mutation
                    for mutation in owning_receipt.mutations
                    if mutation.attribute == "mesh_content"
                    and mutation.before == mutation.after
                ),
                None,
            )
            source_mesh = (
                resolve_resource(source_guard.resource)
                if source_guard is not None
                else None
            )
            source_content_intact = bool(
                isinstance(source_mesh, bpy.types.Mesh)
                and data_guard is not None
                and resolve_resource(data_guard.after) is source_mesh
                and isinstance(target, bpy.types.Object)
                and target.data is source_mesh
                and mesh_content_signature(source_mesh) == source_guard.after
            )
        if isinstance(target, bpy.types.Object):
            try:
                evaluated = target.evaluated_get(
                    bpy.context.evaluated_depsgraph_get()
                )
                evaluated_mesh = evaluated.to_mesh()
                try:
                    evaluated_topology = (
                        len(evaluated_mesh.vertices),
                        len(evaluated_mesh.edges),
                        len(evaluated_mesh.polygons),
                    )
                    evaluated_finite = bool(
                        all(evaluated_topology)
                        and all(
                            math.isfinite(component)
                            for vertex in evaluated_mesh.vertices
                            for component in vertex.co
                        )
                    )
                    evaluated_within_limits = all(
                        actual <= limit
                        for actual, limit in zip(
                            evaluated_topology, (8192, 16384, 8192)
                        )
                    )
                finally:
                    evaluated.to_mesh_clear()
            except RuntimeError:
                pass
    if modifier_type == "BEVEL" and modifier is not None:
        actual_bevel_width = float(modifier.width)
        actual_bevel_segments = int(modifier.segments)
        actual_bevel_angle_limit = float(modifier.angle_limit)
        actual_bevel_limit_method = str(modifier.limit_method)
        bevel_fixed_state_matches = actual_bevel_limit_method == "ANGLE"
        properties_match = bool(
            properties_match
            and bevel_fixed_state_matches
            and source_content_intact
            and evaluated_finite
            and evaluated_within_limits
        )
    elif modifier_type == "MIRROR" and modifier is not None:
        expected_axis = {
            "X": (True, False, False),
            "Y": (False, True, False),
            "Z": (False, False, True),
        }.get(expected_mirror_axis)
        actual_axis_values = tuple(bool(value) for value in modifier.use_axis)
        actual_mirror_axis = {
            (True, False, False): "X",
            (False, True, False): "Y",
            (False, False, True): "Z",
        }.get(actual_axis_values)
        mirror_object_absent = modifier.mirror_object is None
        mirror_fixed_state_matches = bool(
            expected_axis is not None
            and actual_axis_values == expected_axis
            and tuple(bool(value) for value in modifier.use_bisect_axis)
            == (False, False, False)
            and tuple(bool(value) for value in modifier.use_bisect_flip_axis)
            == (False, False, False)
            and modifier.use_clip is False
            and modifier.use_mirror_merge is True
            and math.isclose(float(modifier.merge_threshold), 0.001, abs_tol=1e-9)
            and math.isclose(float(modifier.bisect_threshold), 0.001, abs_tol=1e-9)
            and mirror_object_absent
            and modifier.use_mirror_vertex_groups is True
            and modifier.use_mirror_u is False
            and modifier.use_mirror_v is False
            and modifier.use_mirror_udim is False
            and math.isclose(float(modifier.offset_u), 0.0, abs_tol=1e-9)
            and math.isclose(float(modifier.offset_v), 0.0, abs_tol=1e-9)
            and math.isclose(float(modifier.mirror_offset_u), 0.0, abs_tol=1e-9)
            and math.isclose(float(modifier.mirror_offset_v), 0.0, abs_tol=1e-9)
            and modifier.show_viewport is True
            and modifier.show_render is True
            and modifier.show_in_editmode is True
            and modifier.show_on_cage is False
            and (
                not hasattr(modifier, "use_apply_on_spline")
                or modifier.use_apply_on_spline is False
            )
        )
        properties_match = bool(
            properties_match
            and mirror_fixed_state_matches
            and source_content_intact
            and evaluated_finite
            and evaluated_within_limits
        )
    elif modifier_type == "SOLIDIFY" and modifier is not None:
        actual_solidify_thickness = float(modifier.thickness)
        actual_solidify_offset = float(modifier.offset)
        actual_solidify_mode = str(modifier.solidify_mode)
        actual_solidify_even_offset = bool(modifier.use_even_offset)
        actual_solidify_rim = bool(modifier.use_rim)
        actual_solidify_rim_only = bool(modifier.use_rim_only)
        solidify_fixed_state_matches = bool(
            actual_solidify_mode == "EXTRUDE"
            and math.isclose(float(modifier.thickness_clamp), 0.0, abs_tol=1e-9)
            and modifier.use_thickness_angle_clamp is False
            and math.isclose(
                float(modifier.thickness_vertex_group), 0.0, abs_tol=1e-9
            )
            and math.isclose(float(modifier.edge_crease_inner), 0.0, abs_tol=1e-9)
            and math.isclose(float(modifier.edge_crease_outer), 0.0, abs_tol=1e-9)
            and math.isclose(float(modifier.edge_crease_rim), 0.0, abs_tol=1e-9)
            and int(modifier.material_offset) == 0
            and int(modifier.material_offset_rim) == 0
            and modifier.vertex_group == ""
            and modifier.shell_vertex_group == ""
            and modifier.rim_vertex_group == ""
            and actual_solidify_even_offset is True
            and actual_solidify_rim is True
            and actual_solidify_rim_only is False
            and modifier.use_quality_normals is False
            and modifier.invert_vertex_group is False
            and modifier.use_flat_faces is False
            and modifier.use_flip_normals is False
            and modifier.nonmanifold_thickness_mode == "CONSTRAINTS"
            and modifier.nonmanifold_boundary_mode == "NONE"
            and math.isclose(
                float(modifier.nonmanifold_merge_threshold), 0.0001, abs_tol=1e-9
            )
            and math.isclose(float(modifier.bevel_convex), 0.0, abs_tol=1e-9)
        )
        properties_match = bool(
            properties_match
            and solidify_fixed_state_matches
            and source_content_intact
            and evaluated_finite
            and evaluated_within_limits
        )
    elif modifier_type == "SUBSURF" and modifier is not None:
        properties_match = bool(
            properties_match
            and source_content_intact
            and evaluated_finite
            and evaluated_within_limits
        )
    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and owner is target
        and modifier is not None
        and owned_modifier_intact
        and isinstance(modifier_type, str)
        and modifier.type == modifier_type
        and properties_match
    )
    details = {
        "targetId": target_id if isinstance(target_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "modifierType": modifier.type if modifier is not None else None,
        "propertiesMatch": properties_match,
    }
    if modifier_type == "MIRROR":
        details.update(
            {
                "axis": actual_mirror_axis,
                "expectedAxis": (
                    expected_mirror_axis
                    if isinstance(expected_mirror_axis, str)
                    else None
                ),
                "mirrorFixedStateMatches": mirror_fixed_state_matches,
                "mirrorObjectAbsent": mirror_object_absent,
                "sourceContentIntact": source_content_intact,
                "evaluatedVertexCount": evaluated_topology[0],
                "evaluatedEdgeCount": evaluated_topology[1],
                "evaluatedFaceCount": evaluated_topology[2],
                "evaluatedFinite": evaluated_finite,
                "evaluatedWithinLimits": evaluated_within_limits,
            }
        )
    elif modifier_type == "BEVEL":
        details.update(
            {
                "width": actual_bevel_width,
                "segments": actual_bevel_segments,
                "angleLimit": actual_bevel_angle_limit,
                "limitMethod": actual_bevel_limit_method,
                "bevelFixedStateMatches": bevel_fixed_state_matches,
                "sourceContentIntact": source_content_intact,
                "evaluatedVertexCount": evaluated_topology[0],
                "evaluatedEdgeCount": evaluated_topology[1],
                "evaluatedFaceCount": evaluated_topology[2],
                "evaluatedFinite": evaluated_finite,
                "evaluatedWithinLimits": evaluated_within_limits,
            }
        )
    elif modifier_type == "SOLIDIFY":
        details.update(
            {
                "thickness": actual_solidify_thickness,
                "offset": actual_solidify_offset,
                "solidifyMode": actual_solidify_mode,
                "useEvenOffset": actual_solidify_even_offset,
                "useRim": actual_solidify_rim,
                "useRimOnly": actual_solidify_rim_only,
                "solidifyFixedStateMatches": solidify_fixed_state_matches,
                "sourceContentIntact": source_content_intact,
                "evaluatedVertexCount": evaluated_topology[0],
                "evaluatedEdgeCount": evaluated_topology[1],
                "evaluatedFaceCount": evaluated_topology[2],
                "evaluatedFinite": evaluated_finite,
                "evaluatedWithinLimits": evaluated_within_limits,
            }
        )
    elif modifier_type == "SUBSURF":
        details.update(
            {
                "sourceContentIntact": source_content_intact,
                "evaluatedVertexCount": evaluated_topology[0],
                "evaluatedEdgeCount": evaluated_topology[1],
                "evaluatedFaceCount": evaluated_topology[2],
                "evaluatedFinite": evaluated_finite,
                "evaluatedWithinLimits": evaluated_within_limits,
            }
        )
    return satisfied, details


def _geometry_nodes_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    target_id = parameters.get("targetId")
    modifier_id = parameters.get("modifierId")
    node_group_id = parameters.get("nodeGroupId")
    raw_node_types = parameters.get("nodeTypes")
    expected_node_types = (
        tuple(raw_node_types)
        if isinstance(raw_node_types, list)
        and raw_node_types
        and all(isinstance(item, str) and item for item in raw_node_types)
        else ()
    )
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if isinstance(target_id, str) else None
    group_identity = (
        registry.get(node_group_id) if isinstance(node_group_id, str) else None
    )
    target = resolve_resource(target_identity) if target_identity is not None else None
    node_group = resolve_resource(group_identity) if group_identity is not None else None
    found = (
        find_owned_modifier(receipts, modifier_id)
        if isinstance(modifier_id, str)
        else None
    )
    owner, modifier = found if found is not None else (None, None)
    actual_node_types = (
        tuple(sorted(node.bl_idname for node in node_group.nodes))
        if isinstance(node_group, bpy.types.NodeTree)
        else ()
    )
    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and owner is target
        and modifier is not None
        and modifier.type == "NODES"
        and isinstance(node_group, bpy.types.NodeTree)
        and modifier.node_group is node_group
        and expected_node_types
        and tuple(sorted(expected_node_types)) == actual_node_types
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "nodeGroupId": node_group_id if isinstance(node_group_id, str) else None,
        "nodeTypes": list(actual_node_types),
    }


def _recursive_geometry_node_types(
    node_group: bpy.types.NodeTree,
    seen: set[int] | None = None,
) -> tuple[str, ...]:
    visited = set() if seen is None else seen
    pointer = node_group.as_pointer()
    if pointer in visited:
        return ()
    visited.add(pointer)
    node_types: list[str] = []
    for node in node_group.nodes:
        node_types.append(node.bl_idname)
        nested = getattr(node, "node_tree", None)
        if isinstance(nested, bpy.types.NodeTree):
            node_types.extend(_recursive_geometry_node_types(nested, visited))
    return tuple(sorted(node_types))


_LIGHT_TRAILS_CANONICAL_NODE_TYPES = tuple(
    sorted(
        (
            "NodeGroupInput",
            "NodeGroupOutput",
            "GeometryNodeCurvePrimitiveLine",
            "GeometryNodeResampleCurve",
            "GeometryNodeMeshLine",
            "GeometryNodeMeshLine",
            "GeometryNodeInstanceOnPoints",
            "GeometryNodeInstanceOnPoints",
            "GeometryNodeRealizeInstances",
            "GeometryNodeRealizeInstances",
            "GeometryNodeInputPosition",
            "ShaderNodeTexNoise",
            "ShaderNodeMath",
            "ShaderNodeMath",
            "ShaderNodeCombineXYZ",
            "GeometryNodeSetPosition",
            "GeometryNodeTransform",
            "GeometryNodeJoinGeometry",
            "GeometryNodeCurvePrimitiveCircle",
            "GeometryNodeCurveToMesh",
        )
    )
)
_LIGHT_TRAILS_CANONICAL_INTERFACE = (
    ("INPUT", "NodeSocketGeometry", "Geometry"),
    ("OUTPUT", "NodeSocketGeometry", "Geometry"),
)
_LIGHT_TRAILS_CANONICAL_LINKS = tuple(
    sorted(
        (
            (
                "OperatingLine Half Tile Line",
                "Curve",
                "OperatingLine Trail Resolution",
                "Curve",
            ),
            (
                "OperatingLine Trail Rows",
                "Mesh",
                "OperatingLine Trail Instances",
                "Points",
            ),
            (
                "OperatingLine Trail Resolution",
                "Curve",
                "OperatingLine Trail Instances",
                "Instance",
            ),
            (
                "OperatingLine Trail Instances",
                "Instances",
                "OperatingLine Realize Trails",
                "Geometry",
            ),
            (
                "OperatingLine Trail Position",
                "Position",
                "OperatingLine Terrain Noise",
                "Vector",
            ),
            (
                "OperatingLine Terrain Noise",
                "Fac",
                "OperatingLine Center Noise",
                "Value",
            ),
            (
                "OperatingLine Center Noise",
                "Value",
                "OperatingLine Scale Height",
                "Value",
            ),
            (
                "OperatingLine Scale Height",
                "Value",
                "OperatingLine Z Offset",
                "Z",
            ),
            (
                "OperatingLine Realize Trails",
                "Geometry",
                "OperatingLine Displace Trails",
                "Geometry",
            ),
            (
                "OperatingLine Z Offset",
                "Vector",
                "OperatingLine Displace Trails",
                "Offset",
            ),
            (
                "OperatingLine Displace Trails",
                "Geometry",
                "OperatingLine Mirror Half Tile",
                "Geometry",
            ),
            (
                "OperatingLine Displace Trails",
                "Geometry",
                "OperatingLine Mirrored Tile",
                "Geometry",
            ),
            (
                "OperatingLine Mirror Half Tile",
                "Geometry",
                "OperatingLine Mirrored Tile",
                "Geometry",
            ),
            (
                "OperatingLine Mirrored Tile",
                "Geometry",
                "OperatingLine Curve To Mesh",
                "Curve",
            ),
            (
                "OperatingLine Trail Profile",
                "Curve",
                "OperatingLine Curve To Mesh",
                "Profile Curve",
            ),
            (
                "OperatingLine Loop Tiles",
                "Mesh",
                "OperatingLine Tile Instances",
                "Points",
            ),
            (
                "OperatingLine Curve To Mesh",
                "Mesh",
                "OperatingLine Tile Instances",
                "Instance",
            ),
            (
                "OperatingLine Tile Instances",
                "Instances",
                "OperatingLine Realize Tiles",
                "Geometry",
            ),
            (
                "OperatingLine Realize Tiles",
                "Geometry",
                "OperatingLine Output",
                "GROUP_OUTPUT_GEOMETRY",
            ),
        )
    )
)


def _light_trails_topology_evidence(
    node_group: bpy.types.NodeTree,
) -> tuple[
    tuple[tuple[str, str, str], ...],
    tuple[tuple[str, str, str, str], ...],
]:
    interface = tuple(
        sorted(
            (
                str(item.in_out),
                str(item.socket_type),
                str(item.name),
            )
            for item in node_group.interface.items_tree
            if item.item_type == "SOCKET"
        )
    )
    output_identifiers = {
        item.identifier
        for item in node_group.interface.items_tree
        if item.item_type == "SOCKET"
        and item.in_out == "OUTPUT"
        and item.socket_type == "NodeSocketGeometry"
        and item.name == "Geometry"
    }
    links = tuple(
        sorted(
            (
                link.from_node.name,
                link.from_socket.identifier,
                link.to_node.name,
                (
                    "GROUP_OUTPUT_GEOMETRY"
                    if link.to_node.name == "OperatingLine Output"
                    and link.to_socket.identifier in output_identifiers
                    else link.to_socket.identifier
                ),
            )
            for link in node_group.links
        )
    )
    return interface, links


def _light_trails_semantic_evidence(
    node_group: bpy.types.NodeTree,
    parameters: Mapping[str, Any],
) -> tuple[dict[str, int | float] | None, bool, bool]:
    """Resolve and independently verify every accepted recipe parameter."""

    def required_node(name: str, bl_idname: str) -> Any:
        node = node_group.nodes.get(name)
        if node is None or node.bl_idname != bl_idname:
            raise ValueError(f"Light-trails node is unavailable: {name}")
        return node

    def input_value(node: Any, identifier: str) -> Any:
        matches = tuple(
            socket for socket in node.inputs if socket.identifier == identifier
        )
        if len(matches) != 1 or not hasattr(matches[0], "default_value"):
            raise ValueError(
                f"Light-trails socket is unavailable: {node.name}.{identifier}"
            )
        return matches[0].default_value

    def scalar(value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Light-trails socket value is not numeric")
        result = float(value)
        if not math.isfinite(result):
            raise ValueError("Light-trails socket value is not finite")
        return result

    def vector(value: Any) -> tuple[float, float, float]:
        result = tuple(float(component) for component in value)
        if len(result) != 3 or not all(math.isfinite(component) for component in result):
            raise ValueError("Light-trails socket vector is invalid")
        return result

    def close(left: float, right: float) -> bool:
        return math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-6)

    def vector_close(
        left: tuple[float, float, float], right: tuple[float, float, float]
    ) -> bool:
        return all(close(actual, expected) for actual, expected in zip(left, right))

    try:
        half_line = required_node(
            "OperatingLine Half Tile Line", "GeometryNodeCurvePrimitiveLine"
        )
        resample = required_node(
            "OperatingLine Trail Resolution", "GeometryNodeResampleCurve"
        )
        trail_points = required_node(
            "OperatingLine Trail Rows", "GeometryNodeMeshLine"
        )
        noise = required_node("OperatingLine Terrain Noise", "ShaderNodeTexNoise")
        center_noise = required_node(
            "OperatingLine Center Noise", "ShaderNodeMath"
        )
        scale_height = required_node(
            "OperatingLine Scale Height", "ShaderNodeMath"
        )
        mirror = required_node(
            "OperatingLine Mirror Half Tile", "GeometryNodeTransform"
        )
        profile = required_node(
            "OperatingLine Trail Profile", "GeometryNodeCurvePrimitiveCircle"
        )
        tile_points = required_node(
            "OperatingLine Loop Tiles", "GeometryNodeMeshLine"
        )

        resolved: dict[str, int | float] = {
            "trailCount": int(input_value(trail_points, "Count")),
            "pointsPerTrail": int(input_value(resample, "Count")),
            "tileLength": scalar(vector(input_value(tile_points, "Offset"))[0]),
            "trailSpacing": scalar(vector(input_value(trail_points, "Offset"))[1]),
            "noiseScale": scalar(input_value(noise, "Scale")),
            "noiseDetail": scalar(input_value(noise, "Detail")),
            "noiseRoughness": scalar(input_value(noise, "Roughness")),
            "noiseSeed": scalar(input_value(noise, "W")),
            "height": scalar(input_value(scale_height, "Value_001")),
            "profileSides": int(input_value(profile, "Resolution")),
            "profileRadius": scalar(input_value(profile, "Radius")),
            "tileRepeatCount": int(input_value(tile_points, "Count")),
        }
        integer_fields = {
            "trailCount",
            "pointsPerTrail",
            "profileSides",
            "tileRepeatCount",
        }
        expected: dict[str, int | float] = {}
        parameters_match = True
        for field, actual in resolved.items():
            value = parameters.get(field)
            if field in integer_fields:
                if isinstance(value, bool) or not isinstance(value, int):
                    return resolved, False, False
                expected[field] = value
                if actual != value:
                    parameters_match = False
            else:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    return resolved, False, False
                numeric = float(value)
                if not math.isfinite(numeric):
                    return resolved, False, False
                expected[field] = numeric
                if not close(float(actual), numeric):
                    parameters_match = False

        tile_length = float(expected["tileLength"])
        trail_count = int(expected["trailCount"])
        trail_spacing = float(expected["trailSpacing"])
        tile_repeat_count = int(expected["tileRepeatCount"])
        resample_mode = getattr(resample, "mode", None)
        if resample_mode is None:
            resample_mode = input_value(resample, "Mode")
        fixed_semantics_match = bool(
            getattr(half_line, "mode", None) == "POINTS"
            and resample_mode in {"COUNT", "Count"}
            and getattr(trail_points, "mode", None) == "OFFSET"
            and getattr(tile_points, "mode", None) == "OFFSET"
            and getattr(profile, "mode", None) == "RADIUS"
            and getattr(noise, "noise_dimensions", None) == "4D"
            and getattr(center_noise, "operation", None) == "SUBTRACT"
            and getattr(scale_height, "operation", None) == "MULTIPLY"
            and vector_close(
                vector(input_value(half_line, "Start")),
                (-tile_length / 2.0, 0.0, 0.0),
            )
            and vector_close(
                vector(input_value(half_line, "End")), (0.0, 0.0, 0.0)
            )
            and vector_close(
                vector(input_value(trail_points, "Start Location")),
                (0.0, -((trail_count - 1) * trail_spacing) / 2.0, 0.0),
            )
            and vector_close(
                vector(input_value(trail_points, "Offset")),
                (0.0, trail_spacing, 0.0),
            )
            and close(scalar(input_value(center_noise, "Value_001")), 0.5)
            and vector_close(
                vector(input_value(mirror, "Scale")), (-1.0, 1.0, 1.0)
            )
            and vector_close(
                vector(input_value(tile_points, "Start Location")),
                (-((tile_repeat_count - 1) * tile_length) / 2.0, 0.0, 0.0),
            )
            and vector_close(
                vector(input_value(tile_points, "Offset")),
                (tile_length, 0.0, 0.0),
            )
        )
        return resolved, parameters_match, fixed_semantics_match
    except (AttributeError, KeyError, TypeError, ValueError):
        return None, False, False


def _light_trails_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    target_id = parameters.get("targetId")
    modifier_id = parameters.get("modifierId")
    node_group_id = parameters.get("nodeGroupId")
    raw_node_types = parameters.get("nodeTypes")
    expected_node_types = (
        tuple(sorted(raw_node_types))
        if isinstance(raw_node_types, list)
        and raw_node_types
        and all(isinstance(item, str) and item for item in raw_node_types)
        else ()
    )
    registry = build_resource_registry(receipts)
    target_identity = registry.get(target_id) if isinstance(target_id, str) else None
    group_identity = (
        registry.get(node_group_id) if isinstance(node_group_id, str) else None
    )
    target = resolve_resource(target_identity) if target_identity is not None else None
    node_group = resolve_resource(group_identity) if group_identity is not None else None
    found = (
        find_owned_modifier(receipts, modifier_id)
        if isinstance(modifier_id, str)
        else None
    )
    owner, modifier = found if found is not None else (None, None)
    actual_node_types = (
        _recursive_geometry_node_types(node_group)
        if isinstance(node_group, bpy.types.NodeTree)
        else ()
    )
    actual_interface, actual_link_topology = (
        _light_trails_topology_evidence(node_group)
        if isinstance(node_group, bpy.types.NodeTree)
        else ((), ())
    )
    interface_matches = actual_interface == _LIGHT_TRAILS_CANONICAL_INTERFACE
    link_topology_matches = actual_link_topology == _LIGHT_TRAILS_CANONICAL_LINKS
    forbidden_node_types = {
        "GeometryNodeBake",
        "GeometryNodeSimulationInput",
        "GeometryNodeSimulationOutput",
    }
    forbidden_found = sorted(forbidden_node_types.intersection(actual_node_types))
    modifier_is_nodes = modifier is not None and modifier.type == "NODES"
    bake_count = len(modifier.bakes) if modifier_is_nodes else -1
    bake_directory = modifier.bake_directory if modifier_is_nodes else None
    resolved_parameters, semantic_parameters_match, fixed_semantics_match = (
        _light_trails_semantic_evidence(node_group, parameters)
        if isinstance(node_group, bpy.types.NodeTree)
        else (None, False, False)
    )
    actual_modifier_name = modifier.name if modifier is not None else None
    actual_node_group_name = (
        node_group.name if isinstance(node_group, bpy.types.NodeTree) else None
    )
    expected_modifier_name = parameters.get("modifierName")
    expected_node_group_name = parameters.get("nodeGroupName")

    expected_signature = next(
        (
            mutation.after
            for receipt in receipts.values()
            for mutation in receipt.mutations
            if mutation.attribute == "node_tree_semantic_signature_v2"
            and group_identity is not None
            and mutation.resource.logical_id == group_identity.logical_id
        ),
        None,
    )
    semantic_signature_matches = bool(
        isinstance(node_group, bpy.types.NodeTree)
        and expected_signature is not None
        and node_tree_semantic_signature(node_group) == expected_signature
    )

    evaluated_vertex_count = 0
    evaluated_edge_count = 0
    evaluated_polygon_count = 0
    evaluated_finite = False
    if isinstance(target, bpy.types.Object):
        evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.data if isinstance(evaluated.data, bpy.types.Mesh) else None
        if mesh is not None:
            evaluated_vertex_count = len(mesh.vertices)
            evaluated_edge_count = len(mesh.edges)
            evaluated_polygon_count = len(mesh.polygons)
            evaluated_finite = all(
                math.isfinite(component)
                for vertex in mesh.vertices
                for component in vertex.co
            )
    expected_evaluated_vertex_count = 0
    if all(
        isinstance(parameters.get(field), int)
        and not isinstance(parameters.get(field), bool)
        for field in (
            "trailCount",
            "pointsPerTrail",
            "profileSides",
            "tileRepeatCount",
        )
    ):
        expected_evaluated_vertex_count = (
            int(parameters["trailCount"])
            * int(parameters["pointsPerTrail"])
            * int(parameters["profileSides"])
            * int(parameters["tileRepeatCount"])
            * 2
        )
    evaluated_vertex_count_matches = (
        0 < expected_evaluated_vertex_count <= 3_000_000
        and evaluated_vertex_count == expected_evaluated_vertex_count
    )

    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and owner is target
        and modifier is not None
        and modifier.type == "NODES"
        and isinstance(node_group, bpy.types.NodeTree)
        and modifier.node_group is node_group
        and isinstance(expected_modifier_name, str)
        and actual_modifier_name == expected_modifier_name
        and isinstance(expected_node_group_name, str)
        and actual_node_group_name == expected_node_group_name
        and expected_node_types
        and expected_node_types == _LIGHT_TRAILS_CANONICAL_NODE_TYPES
        and actual_node_types == _LIGHT_TRAILS_CANONICAL_NODE_TYPES
        and interface_matches
        and link_topology_matches
        and not forbidden_found
        and bake_count == 0
        and bake_directory == ""
        and semantic_signature_matches
        and semantic_parameters_match
        and fixed_semantics_match
        and evaluated_vertex_count_matches
        and 0 < evaluated_edge_count <= 12_000_000
        and 0 < evaluated_polygon_count <= 12_000_000
        and evaluated_finite
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "modifierName": actual_modifier_name,
        "nodeGroupId": node_group_id if isinstance(node_group_id, str) else None,
        "nodeGroupName": actual_node_group_name,
        "nodeTypes": list(actual_node_types),
        "interfaceSignature": [list(item) for item in actual_interface],
        "interfaceMatches": interface_matches,
        "linkTopology": [list(item) for item in actual_link_topology],
        "linkTopologyMatches": link_topology_matches,
        "forbiddenNodeTypes": forbidden_found,
        "bakeCount": bake_count,
        "bakeDirectory": bake_directory,
        "semanticSignatureMatches": semantic_signature_matches,
        "resolvedParameters": resolved_parameters,
        "semanticParametersMatch": semantic_parameters_match,
        "fixedSemanticsMatch": fixed_semantics_match,
        "evaluatedVertexCount": evaluated_vertex_count,
        "expectedEvaluatedVertexCount": expected_evaluated_vertex_count,
        "evaluatedVertexCountMatches": evaluated_vertex_count_matches,
        "evaluatedEdgeCount": evaluated_edge_count,
        "evaluatedPolygonCount": evaluated_polygon_count,
        "evaluatedFinite": evaluated_finite,
    }


_LIGHT_TRAILS_SCENE_ACTION_PARAMETER_KEYS = frozenset(
    {
        "collectionId",
        "trailTargetId",
        "floorTargetId",
        "sceneId",
        "sceneName",
        "worldId",
        "worldName",
        "cameraId",
        "cameraObjectName",
        "cameraDataName",
        "controllerId",
        "controllerObjectName",
        "trailMaterialId",
        "trailMaterialName",
        "floorMaterialId",
        "floorMaterialName",
        "cameraActionId",
        "cameraActionName",
        "frameStart",
        "frameEnd",
        "cameraStart",
        "cameraEnd",
        "cameraTarget",
        "lens",
        "fStop",
        "focusDistance",
        "trailBaseColor",
        "trailGlowColor",
        "trailEmissionStrength",
        "gradientRotationDegrees",
        "gradientStart",
        "glowBandStart",
        "glowBandEnd",
        "gradientEnd",
        "waveScale",
        "floorBaseColor",
        "floorEmissionColor",
        "floorEmissionStrength",
        "floorMetallic",
        "floorVoronoiScale",
        "floorRoughnessMinimum",
        "floorRoughnessMaximum",
        "floorBumpStrength",
        "floorBumpDistance",
    }
)
_LIGHT_TRAILS_SCENE_NODE_PARAMETER_KEYS = frozenset(
    {
        "trailMaterialNodeTypes",
        "floorMaterialNodeTypes",
        "compositorNodeTypes",
    }
)
_LIGHT_TRAILS_SCENE_TRAIL_NODE_TYPES = tuple(
    sorted(
        (
            "ShaderNodeOutputMaterial",
            "ShaderNodeBsdfPrincipled",
            "ShaderNodeTexCoord",
            "ShaderNodeMapping",
            "ShaderNodeTexGradient",
            "ShaderNodeValToRGB",
            "ShaderNodeTexWave",
            "ShaderNodeValToRGB",
            "ShaderNodeMixRGB",
        )
    )
)
_LIGHT_TRAILS_SCENE_FLOOR_NODE_TYPES = tuple(
    sorted(
        (
            "ShaderNodeOutputMaterial",
            "ShaderNodeBsdfPrincipled",
            "ShaderNodeTexCoord",
            "ShaderNodeMapping",
            "ShaderNodeTexVoronoi",
            "ShaderNodeValToRGB",
            "ShaderNodeBump",
            "ShaderNodeValToRGB",
        )
    )
)
_LIGHT_TRAILS_SCENE_COMPOSITOR_NODE_TYPES = tuple(
    sorted(
        (
            "CompositorNodeRLayers",
            "CompositorNodeGlare",
            "CompositorNodeComposite",
        )
    )
)


def _scene_node_types(
    tree: bpy.types.NodeTree | None, *, normalize_compositor_output: bool = False
) -> tuple[str, ...]:
    if tree is None:
        return ()
    node_types = []
    for node in tree.nodes:
        node_type = node.bl_idname
        if normalize_compositor_output and node_type == "NodeGroupOutput":
            node_type = "CompositorNodeComposite"
        node_types.append(node_type)
    return tuple(sorted(node_types))


def _scene_node(tree: bpy.types.NodeTree, name: str, node_type: str) -> Any | None:
    node = tree.nodes.get(name)
    return node if node is not None and node.bl_idname == node_type else None


def _scene_socket(sockets: Any, *names: str) -> Any | None:
    matches = tuple(
        socket
        for socket in sockets
        if socket.identifier in names or socket.name in names
    )
    return matches[0] if len(matches) == 1 else None


def _scene_input(node: Any, *names: str) -> Any | None:
    return _scene_socket(node.inputs, *names) if node is not None else None


def _scene_output(node: Any, *names: str) -> Any | None:
    return _scene_socket(node.outputs, *names) if node is not None else None


def _scene_links(tree: bpy.types.NodeTree) -> set[tuple[str, str, str, str]]:
    def semantic_socket_name(socket: Any) -> str:
        # Blender 5.1 expanded the legacy `Fac` display label to `Factor`
        # without changing the meaning of these shader links.
        return "Fac" if socket.name == "Factor" else socket.name

    return {
        (
            link.from_node.name,
            semantic_socket_name(link.from_socket),
            link.to_node.name,
            semantic_socket_name(link.to_socket),
        )
        for link in tree.links
    }


def _scene_close(actual: Any, expected: float, tolerance: float = 1e-6) -> bool:
    return isinstance(actual, (int, float)) and not isinstance(actual, bool) and math.isclose(
        float(actual), expected, rel_tol=1e-6, abs_tol=tolerance
    )


def _scene_vector_close(actual: Any, expected: tuple[float, ...]) -> bool:
    try:
        values = tuple(float(value) for value in actual)
    except (TypeError, ValueError):
        return False
    return len(values) == len(expected) and all(
        _scene_close(value, expected_value)
        for value, expected_value in zip(values, expected, strict=True)
    )


def _scene_ramp_matches(
    node: Any,
    expected: tuple[tuple[float, tuple[float, float, float, float]], ...],
) -> bool:
    if node is None or not hasattr(node, "color_ramp"):
        return False
    elements = tuple(node.color_ramp.elements)
    return len(elements) == len(expected) and all(
        _scene_close(element.position, position)
        and _scene_vector_close(element.color, color)
        for element, (position, color) in zip(elements, expected, strict=True)
    )


def _embedded_signature_matches(
    receipt: ActionReceipt | None,
    identity: Any,
    resource: Any,
) -> bool:
    expected = tuple(
        mutation.after
        for mutation in (receipt.mutations if receipt is not None else ())
        if mutation.resource == identity
        and mutation.attribute == "embedded_node_tree_semantic_signature_v1"
    )
    return bool(
        len(expected) == 1
        and embedded_node_tree_semantic_signature(resource) == expected[0]
    )


def _node_group_signature_matches(
    receipt: ActionReceipt | None,
    identity: Any,
    tree: bpy.types.NodeTree,
) -> bool:
    expected = tuple(
        mutation.after
        for mutation in (receipt.mutations if receipt is not None else ())
        if mutation.resource == identity
        and mutation.attribute == "node_tree_semantic_signature_v2"
    )
    return bool(len(expected) == 1 and node_tree_semantic_signature(tree) == expected[0])


def _light_trails_scene_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    if set(parameters) != (
        _LIGHT_TRAILS_SCENE_ACTION_PARAMETER_KEYS
        | _LIGHT_TRAILS_SCENE_NODE_PARAMETER_KEYS
    ):
        raise ValueError("Light-trails scene Observation parameters are incomplete")
    action_parameters = {
        key: parameters[key] for key in _LIGHT_TRAILS_SCENE_ACTION_PARAMETER_KEYS
    }
    definition = validate_light_trails_scene(action_parameters)
    expected_trail_node_types = tuple(parameters["trailMaterialNodeTypes"])
    expected_floor_node_types = tuple(parameters["floorMaterialNodeTypes"])
    expected_compositor_node_types = tuple(parameters["compositorNodeTypes"])
    canonical_node_parameters = bool(
        expected_trail_node_types == _LIGHT_TRAILS_SCENE_TRAIL_NODE_TYPES
        and expected_floor_node_types == _LIGHT_TRAILS_SCENE_FLOOR_NODE_TYPES
        and expected_compositor_node_types
        == _LIGHT_TRAILS_SCENE_COMPOSITOR_NODE_TYPES
    )

    registry = build_resource_registry(receipts)

    def identity(logical_id: str) -> Any | None:
        return registry.get(logical_id)

    def resource(logical_id: str) -> Any | None:
        found = identity(logical_id)
        return resolve_resource(found) if found is not None else None

    scene_identity = identity(definition.scene_id)
    world_identity = identity(definition.world_id)
    camera_identity = identity(definition.camera_id)
    camera_data_identity = identity(f"{definition.camera_id}.data")
    trail_material_identity = identity(definition.trail_material_id)
    floor_material_identity = identity(definition.floor_material_id)
    camera_action_identity = identity(definition.camera_action_id)
    compositor_identity = identity(f"{definition.scene_id}.compositor")

    collection = resource(definition.collection_id)
    trail = resource(definition.trail_target_id)
    floor = resource(definition.floor_target_id)
    scene = resource(definition.scene_id)
    world = resource(definition.world_id)
    camera = resource(definition.camera_id)
    camera_data = resource(f"{definition.camera_id}.data")
    controller = resource(definition.controller_id)
    trail_material = resource(definition.trail_material_id)
    floor_material = resource(definition.floor_material_id)
    camera_action = resource(definition.camera_action_id)
    compositor_group = (
        resolve_resource(compositor_identity)
        if compositor_identity is not None
        else None
    )

    matching_receipts = tuple(
        receipt
        for receipt in receipts.values()
        if receipt.action_name == "blender.lookdev.create_light_trails_scene"
        and scene_identity is not None
        and scene_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    expected_created_ids = {
        definition.scene_id,
        definition.world_id,
        f"{definition.camera_id}.data",
        definition.camera_id,
        definition.controller_id,
        definition.trail_material_id,
        definition.floor_material_id,
        definition.camera_action_id,
    }
    actual_created_ids = (
        {item.logical_id for item in receipt.created} if receipt is not None else set()
    )
    receipt_matches = bool(
        receipt is not None
        and receipt.anchor == camera_identity
        and actual_created_ids
        in (
            expected_created_ids,
            expected_created_ids | {f"{definition.scene_id}.compositor"},
        )
        and not receipt.artifacts
    )

    compositor_tree = None
    if isinstance(scene, bpy.types.Scene):
        compositor_tree = getattr(scene, "node_tree", None)
        if compositor_tree is None:
            compositor_tree = getattr(scene, "compositing_node_group", None)

    tracked_object_pointers = {
        obj.as_pointer()
        for item in registry.values()
        if item.resource_type == "OBJECT"
        for obj in (resolve_resource(item),)
        if isinstance(obj, bpy.types.Object)
    }
    collection_matches = bool(
        isinstance(collection, bpy.types.Collection)
        and isinstance(scene, bpy.types.Scene)
        and tuple(scene.collection.children) == (collection,)
        and not collection.children
        and isinstance(trail, bpy.types.Object)
        and isinstance(floor, bpy.types.Object)
        and isinstance(camera, bpy.types.Object)
        and isinstance(controller, bpy.types.Object)
        and all(
            item.name in collection.objects
            for item in (trail, floor, camera, controller)
        )
        and all(
            obj.as_pointer() in tracked_object_pointers
            for obj in collection.all_objects
        )
    )

    world_matches = False
    if isinstance(world, bpy.types.World) and world.node_tree is not None:
        world_background = _scene_node(
            world.node_tree, "OperatingLine Background", "ShaderNodeBackground"
        )
        world_output = _scene_node(
            world.node_tree, "OperatingLine World Output", "ShaderNodeOutputWorld"
        )
        color_socket = _scene_input(world_background, "Color")
        strength_socket = _scene_input(world_background, "Strength")
        world_matches = bool(
            world.name == definition.world_name
            and world.use_nodes
            and isinstance(scene, bpy.types.Scene)
            and scene.world is world
            and _scene_node_types(world.node_tree)
            == tuple(sorted(("ShaderNodeBackground", "ShaderNodeOutputWorld")))
            and _scene_links(world.node_tree)
            == {
                (
                    "OperatingLine Background",
                    "Background",
                    "OperatingLine World Output",
                    "Surface",
                )
            }
            and color_socket is not None
            and _scene_vector_close(color_socket.default_value, (0.0, 0.0, 0.0, 1.0))
            and strength_socket is not None
            and _scene_close(strength_socket.default_value, 0.0)
            and world_output is not None
            and _embedded_signature_matches(receipt, world_identity, world)
        )

    camera_matches = False
    if (
        isinstance(scene, bpy.types.Scene)
        and isinstance(camera, bpy.types.Object)
        and isinstance(camera_data, bpy.types.Camera)
    ):
        expected_rotation = (
            Vector(definition.camera_target) - Vector(definition.camera_start)
        ).to_track_quat("-Z", "Y").to_euler()
        camera_matches = bool(
            camera.name == definition.camera_object_name
            and camera.type == "CAMERA"
            and camera.data is camera_data
            and camera_data_identity is not None
            and camera_data.name == definition.camera_data_name
            and scene.camera is camera
            and _scene_close(camera_data.lens, definition.lens)
            and camera_data.dof.use_dof
            and _scene_close(camera_data.dof.aperture_fstop, definition.f_stop)
            and _scene_close(
                camera_data.dof.focus_distance, definition.focus_distance
            )
            and _scene_vector_close(camera.rotation_euler, tuple(expected_rotation))
        )

    curves = (
        tuple(sorted(action_fcurves(camera_action), key=lambda item: item.array_index))
        if isinstance(camera_action, bpy.types.Action)
        else ()
    )
    camera_keyframe_count = sum(len(curve.keyframe_points) for curve in curves)
    curves_match = len(curves) == 3
    if curves_match:
        for index, curve in enumerate(curves):
            points = tuple(curve.keyframe_points)
            curves_match = bool(
                curves_match
                and curve.data_path == "location"
                and curve.array_index == index
                and curve.extrapolation == "CONSTANT"
                and len(points) == 2
                and _scene_close(points[0].co[0], definition.frame_start)
                and _scene_close(points[0].co[1], definition.camera_start[index])
                and points[0].interpolation == "LINEAR"
                and _scene_close(points[1].co[0], definition.frame_end)
                and _scene_close(points[1].co[1], definition.camera_end[index])
                and points[1].interpolation == "LINEAR"
            )
    action_signature_mutations = (
        tuple(
            mutation
            for mutation in receipt.mutations
            if mutation.resource == camera_action_identity
            and mutation.attribute == "action_keyframes"
        )
        if receipt is not None
        else ()
    )
    animation_matches = bool(
        isinstance(camera, bpy.types.Object)
        and isinstance(camera_action, bpy.types.Action)
        and camera_action.name == definition.camera_action_name
        and camera.animation_data is not None
        and camera.animation_data.action is camera_action
        and camera_keyframe_count == 6
        and curves_match
        and len(action_signature_mutations) == 1
        and action_keyframe_signature(camera_action)
        == action_signature_mutations[0].after
    )

    trail_material_matches = False
    trail_texcoord = None
    if (
        isinstance(trail, bpy.types.Object)
        and isinstance(trail_material, bpy.types.Material)
        and trail_material.node_tree is not None
    ):
        tree = trail_material.node_tree
        trail_texcoord = _scene_node(
            tree, "OperatingLine Trail Coordinates", "ShaderNodeTexCoord"
        )
        mapping = _scene_node(tree, "OperatingLine Trail Mapping", "ShaderNodeMapping")
        gradient = _scene_node(
            tree, "OperatingLine Trail Gradient", "ShaderNodeTexGradient"
        )
        gradient_ramp = _scene_node(
            tree, "OperatingLine Trail Gradient Ramp", "ShaderNodeValToRGB"
        )
        wave = _scene_node(tree, "OperatingLine Trail Wave", "ShaderNodeTexWave")
        wave_ramp = _scene_node(
            tree, "OperatingLine Trail Glow Ramp", "ShaderNodeValToRGB"
        )
        mix = _scene_node(tree, "OperatingLine Trail Bright Band", "ShaderNodeMixRGB")
        principled = _scene_node(
            tree, "OperatingLine Trail Shader", "ShaderNodeBsdfPrincipled"
        )
        output = _scene_node(
            tree, "OperatingLine Trail Output", "ShaderNodeOutputMaterial"
        )
        rotation = _scene_input(mapping, "Rotation")
        wave_scale = _scene_input(wave, "Scale")
        emission_strength = _scene_input(principled, "Emission Strength")
        trail_material_matches = bool(
            trail_material.name == definition.trail_material_name
            and trail_material.use_nodes
            and trail_material.surface_render_method == "BLENDED"
            and tuple(slot.material for slot in trail.material_slots)
            == (trail_material,)
            and _scene_node_types(tree) == _LIGHT_TRAILS_SCENE_TRAIL_NODE_TYPES
            and _scene_links(tree)
            == {
                ("OperatingLine Trail Coordinates", "Object", "OperatingLine Trail Mapping", "Vector"),
                ("OperatingLine Trail Mapping", "Vector", "OperatingLine Trail Gradient", "Vector"),
                ("OperatingLine Trail Gradient", "Fac", "OperatingLine Trail Gradient Ramp", "Fac"),
                ("OperatingLine Trail Mapping", "Vector", "OperatingLine Trail Wave", "Vector"),
                ("OperatingLine Trail Wave", "Color", "OperatingLine Trail Glow Ramp", "Fac"),
                ("OperatingLine Trail Gradient Ramp", "Color", "OperatingLine Trail Bright Band", "Color1"),
                ("OperatingLine Trail Glow Ramp", "Color", "OperatingLine Trail Bright Band", "Fac"),
                ("OperatingLine Trail Bright Band", "Color", "OperatingLine Trail Shader", "Base Color"),
                ("OperatingLine Trail Bright Band", "Color", "OperatingLine Trail Shader", "Emission Color"),
                ("OperatingLine Trail Gradient Ramp", "Alpha", "OperatingLine Trail Shader", "Alpha"),
                ("OperatingLine Trail Shader", "BSDF", "OperatingLine Trail Output", "Surface"),
            }
            and trail_texcoord is not None
            and trail_texcoord.object is controller
            and rotation is not None
            and _scene_close(
                rotation.default_value[2],
                math.radians(definition.gradient_rotation_degrees),
            )
            and getattr(gradient, "gradient_type", None) == "LINEAR"
            and _scene_ramp_matches(
                gradient_ramp,
                (
                    (definition.gradient_start, (0.0, 0.0, 0.0, 0.0)),
                    (definition.gradient_end, definition.trail_base_color),
                ),
            )
            and getattr(wave, "wave_type", None) == "BANDS"
            and getattr(wave, "bands_direction", None) == "X"
            and wave_scale is not None
            and _scene_close(wave_scale.default_value, definition.wave_scale)
            and _scene_ramp_matches(
                wave_ramp,
                (
                    (definition.gradient_start, (0.0, 0.0, 0.0, 1.0)),
                    (definition.glow_band_start, (0.0, 0.0, 0.0, 1.0)),
                    (definition.glow_band_end, (1.0, 1.0, 1.0, 1.0)),
                    (definition.gradient_end, (0.0, 0.0, 0.0, 1.0)),
                ),
            )
            and getattr(mix, "blend_type", None) == "ADD"
            and getattr(mix, "use_clamp", None) is True
            and emission_strength is not None
            and _scene_close(
                emission_strength.default_value,
                definition.trail_emission_strength,
            )
            and output is not None
            and _embedded_signature_matches(
                receipt, trail_material_identity, trail_material
            )
        )

    floor_material_matches = False
    if (
        isinstance(floor, bpy.types.Object)
        and isinstance(floor_material, bpy.types.Material)
        and floor_material.node_tree is not None
    ):
        tree = floor_material.node_tree
        mapping = _scene_node(tree, "OperatingLine Floor Mapping", "ShaderNodeMapping")
        voronoi = _scene_node(
            tree, "OperatingLine Floor Voronoi", "ShaderNodeTexVoronoi"
        )
        roughness_ramp = _scene_node(
            tree, "OperatingLine Floor Roughness Ramp", "ShaderNodeValToRGB"
        )
        bump = _scene_node(tree, "OperatingLine Floor Bump", "ShaderNodeBump")
        emission_ramp = _scene_node(
            tree, "OperatingLine Floor Emission Ramp", "ShaderNodeValToRGB"
        )
        principled = _scene_node(
            tree, "OperatingLine Floor Shader", "ShaderNodeBsdfPrincipled"
        )
        output = _scene_node(
            tree, "OperatingLine Floor Output", "ShaderNodeOutputMaterial"
        )
        voronoi_scale = _scene_input(voronoi, "Scale")
        bump_strength = _scene_input(bump, "Strength")
        bump_distance = _scene_input(bump, "Distance")
        base_color = _scene_input(principled, "Base Color")
        metallic = _scene_input(principled, "Metallic")
        emission_strength = _scene_input(principled, "Emission Strength")
        floor_material_matches = bool(
            floor_material.name == definition.floor_material_name
            and floor_material.use_nodes
            and tuple(slot.material for slot in floor.material_slots)
            == (floor_material,)
            and _scene_node_types(tree) == _LIGHT_TRAILS_SCENE_FLOOR_NODE_TYPES
            and _scene_links(tree)
            == {
                ("OperatingLine Floor Coordinates", "Object", "OperatingLine Floor Mapping", "Vector"),
                ("OperatingLine Floor Mapping", "Vector", "OperatingLine Floor Voronoi", "Vector"),
                ("OperatingLine Floor Voronoi", "Distance", "OperatingLine Floor Roughness Ramp", "Fac"),
                ("OperatingLine Floor Voronoi", "Distance", "OperatingLine Floor Bump", "Height"),
                ("OperatingLine Floor Voronoi", "Distance", "OperatingLine Floor Emission Ramp", "Fac"),
                ("OperatingLine Floor Roughness Ramp", "Color", "OperatingLine Floor Shader", "Roughness"),
                ("OperatingLine Floor Bump", "Normal", "OperatingLine Floor Shader", "Normal"),
                ("OperatingLine Floor Emission Ramp", "Color", "OperatingLine Floor Shader", "Emission Color"),
                ("OperatingLine Floor Shader", "BSDF", "OperatingLine Floor Output", "Surface"),
            }
            and mapping is not None
            and getattr(voronoi, "voronoi_dimensions", None) == "3D"
            and getattr(voronoi, "feature", None) == "F1"
            and voronoi_scale is not None
            and _scene_close(
                voronoi_scale.default_value, definition.floor_voronoi_scale
            )
            and _scene_ramp_matches(
                roughness_ramp,
                (
                    (
                        0.0,
                        (
                            definition.floor_roughness_minimum,
                            definition.floor_roughness_minimum,
                            definition.floor_roughness_minimum,
                            1.0,
                        ),
                    ),
                    (
                        1.0,
                        (
                            definition.floor_roughness_maximum,
                            definition.floor_roughness_maximum,
                            definition.floor_roughness_maximum,
                            1.0,
                        ),
                    ),
                ),
            )
            and bump_strength is not None
            and _scene_close(
                bump_strength.default_value, definition.floor_bump_strength
            )
            and bump_distance is not None
            and _scene_close(
                bump_distance.default_value, definition.floor_bump_distance
            )
            and _scene_ramp_matches(
                emission_ramp,
                (
                    (0.0, (0.0, 0.0, 0.0, 1.0)),
                    (1.0, definition.floor_emission_color),
                ),
            )
            and base_color is not None
            and _scene_vector_close(
                base_color.default_value, definition.floor_base_color
            )
            and metallic is not None
            and _scene_close(metallic.default_value, definition.floor_metallic)
            and emission_strength is not None
            and _scene_close(
                emission_strength.default_value,
                definition.floor_emission_strength,
            )
            and output is not None
            and _embedded_signature_matches(
                receipt, floor_material_identity, floor_material
            )
        )

    controller_matches = bool(
        isinstance(controller, bpy.types.Object)
        and controller.name == definition.controller_object_name
        and controller.type == "EMPTY"
        and controller.empty_display_type == "PLAIN_AXES"
        and controller.parent is camera
        and _scene_vector_close(controller.location, (0.0, 0.0, 0.0))
        and _scene_vector_close(controller.rotation_euler, (0.0, 0.0, 0.0))
        and _scene_vector_close(controller.scale, (1.0, 1.0, 1.0))
        and isinstance(collection, bpy.types.Collection)
        and controller.name in collection.objects
        and trail_texcoord is not None
        and trail_texcoord.object is controller
    )

    compositor_matches = False
    actual_compositor_node_types = _scene_node_types(
        compositor_tree, normalize_compositor_output=True
    )
    if isinstance(compositor_tree, bpy.types.NodeTree):
        raw_output_type = (
            "NodeGroupOutput"
            if compositor_tree.nodes.get("OperatingLine Composite") is not None
            and compositor_tree.nodes["OperatingLine Composite"].bl_idname
            == "NodeGroupOutput"
            else "CompositorNodeComposite"
        )
        expected_links = {
            ("OperatingLine Render Layers", "Image", "OperatingLine Fog Glow", "Image"),
            ("OperatingLine Fog Glow", "Image", "OperatingLine Composite", "Image"),
        }
        glare = compositor_tree.nodes.get("OperatingLine Fog Glow")
        glare_matches = False
        if glare is not None and glare.bl_idname == "CompositorNodeGlare":
            threshold_socket = _scene_input(
                glare, "Highlights Threshold", "Threshold"
            )
            size_socket = _scene_input(glare, "Size")
            threshold_matches = (
                _scene_close(threshold_socket.default_value, 0.8)
                if threshold_socket is not None
                and hasattr(threshold_socket, "default_value")
                else _scene_close(getattr(glare, "threshold", None), 0.8)
            )
            size_matches = (
                _scene_close(size_socket.default_value, 0.7)
                if size_socket is not None and hasattr(size_socket, "default_value")
                else getattr(glare, "size", None) == 7
            )
            if hasattr(glare, "glare_type"):
                glare_matches = bool(
                    glare.glare_type == "FOG_GLOW"
                    and glare.quality == "HIGH"
                    and threshold_matches
                    and size_matches
                )
            else:
                type_socket = _scene_input(glare, "Type")
                quality_socket = _scene_input(glare, "Quality")
                glare_matches = bool(
                    type_socket is not None
                    and type_socket.default_value == "Bloom"
                    and quality_socket is not None
                    and quality_socket.default_value == "High"
                    and threshold_matches
                    and size_matches
                )
        signature_matches = (
            _embedded_signature_matches(receipt, scene_identity, scene)
            if compositor_identity is None
            else bool(
                compositor_tree is compositor_group
                and _node_group_signature_matches(
                    receipt, compositor_identity, compositor_tree
                )
            )
        )
        compositor_matches = bool(
            isinstance(scene, bpy.types.Scene)
            and scene.use_nodes
            and actual_compositor_node_types
            == _LIGHT_TRAILS_SCENE_COMPOSITOR_NODE_TYPES
            and raw_output_type in {"CompositorNodeComposite", "NodeGroupOutput"}
            and _scene_links(compositor_tree) == expected_links
            and glare_matches
            and signature_matches
        )

    forbidden_node_types = {
        "GeometryNodeBake",
        "GeometryNodeSimulationInput",
        "GeometryNodeSimulationOutput",
    }
    relevant_trees = tuple(
        tree
        for tree in (
            getattr(trail_material, "node_tree", None),
            getattr(floor_material, "node_tree", None),
            getattr(world, "node_tree", None),
            compositor_tree,
        )
        if isinstance(tree, bpy.types.NodeTree)
    )
    no_bake_nodes = not any(
        node.bl_idname in forbidden_node_types
        for tree in relevant_trees
        for node in tree.nodes
    )
    if isinstance(trail, bpy.types.Object):
        for modifier in trail.modifiers:
            if modifier.type != "NODES" or modifier.node_group is None:
                continue
            node_types = _recursive_geometry_node_types(modifier.node_group)
            no_bake_nodes = bool(
                no_bake_nodes
                and not forbidden_node_types.intersection(node_types)
                and len(modifier.bakes) == 0
                and modifier.bake_directory == ""
            )

    no_render_artifacts = bool(
        bpy.data.images.get("Render Result") is None
        and all(not item.artifacts for item in receipts.values())
        and all(
            item.action_name != "blender.render.execute_preview"
            for item in receipts.values()
        )
    )
    scene_matches = bool(
        receipt_matches
        and isinstance(scene, bpy.types.Scene)
        and scene.name == definition.scene_name
        and scene.render.engine == "CYCLES"
        and scene.frame_start == definition.frame_start
        and scene.frame_end == definition.frame_end
        and world_matches
        and camera_matches
    )

    satisfied = bool(
        canonical_node_parameters
        and scene_matches
        and collection_matches
        and world_matches
        and camera_matches
        and controller_matches
        and animation_matches
        and trail_material_matches
        and floor_material_matches
        and compositor_matches
        and no_bake_nodes
        and no_render_artifacts
    )
    details = {
        "shape": "managed_light_trails_scene",
        **{
            key: parameters[key]
            for key in (
                "collectionId",
                "trailTargetId",
                "floorTargetId",
                "sceneId",
                "sceneName",
                "worldId",
                "worldName",
                "cameraId",
                "cameraObjectName",
                "cameraDataName",
                "controllerId",
                "controllerObjectName",
                "trailMaterialId",
                "trailMaterialName",
                "floorMaterialId",
                "floorMaterialName",
                "cameraActionId",
                "cameraActionName",
            )
        },
        "sceneMatches": scene_matches,
        "collectionMatches": collection_matches,
        "worldMatches": world_matches,
        "cameraMatches": camera_matches,
        "controllerMatches": controller_matches,
        "animationMatches": animation_matches,
        "trailMaterialMatches": trail_material_matches,
        "floorMaterialMatches": floor_material_matches,
        "compositorMatches": compositor_matches,
        "noBakeNodes": no_bake_nodes,
        "noRenderArtifacts": no_render_artifacts,
        "frameStart": definition.frame_start,
        "frameEnd": definition.frame_end,
        "cameraKeyframeCount": camera_keyframe_count,
        "trailMaterialNodeTypes": list(_scene_node_types(getattr(trail_material, "node_tree", None))),
        "floorMaterialNodeTypes": list(_scene_node_types(getattr(floor_material, "node_tree", None))),
        "compositorNodeTypes": list(actual_compositor_node_types),
    }
    return satisfied, details


OBSERVATION_EVALUATORS: dict[str, ObservationEvaluator] = {
    "object_exists": _object_exists,
    "resource_exists": _resource_exists,
    "uv_sphere_ready": _uv_sphere_ready,
    "icosphere_ready": _icosphere_ready,
    "cube_ready": _cube_ready,
    "plane_ready": _plane_ready,
    "torus_ready": _torus_ready,
    "cone_ready": _cone_ready,
    "cylinder_ready": _cylinder_ready,
    "material_assigned": _material_assigned,
    "armature_ready": _armature_ready,
    "pose_animation_ready": _pose_animation_ready,
    "skin_weights_ready": _skin_weights_ready,
    "render_scene_ready": _render_scene_ready,
    "render_rig_ready": _render_rig_ready,
    "render_artifact_exists": _render_artifact_exists,
    "mesh_topology_matches": _mesh_topology_matches,
    "mesh_triangulated": _mesh_triangulated,
    "mesh_region_extruded": _mesh_region_extruded,
    "mesh_edges_beveled": _mesh_edges_beveled,
    "mesh_faces_inset": _mesh_faces_inset,
    "mesh_faces_poked": _mesh_faces_poked,
    "modifier_ready": _modifier_ready,
    "geometry_nodes_ready": _geometry_nodes_ready,
    "light_trails_ready": _light_trails_ready,
    "light_trails_scene_ready": _light_trails_scene_ready,
}


def evaluate_observations(
    expectations: tuple[dict[str, Any], ...],
    receipts: Mapping[str, ActionReceipt],
) -> list[dict[str, Any]]:
    """Evaluate declared expectations without mutating Blender state."""
    observations: list[dict[str, Any]] = []
    for expectation in expectations:
        kind = expectation.get("kind")
        raw_parameters = expectation.get("parameters")
        parameters = raw_parameters if isinstance(raw_parameters, dict) else {}
        evaluator = OBSERVATION_EVALUATORS.get(kind) if isinstance(kind, str) else None
        if evaluator is None:
            satisfied = False
            details: dict[str, Any] = {"parameters": parameters, "supported": False}
        else:
            try:
                satisfied, details = evaluator(parameters, receipts)
                details = {"parameters": parameters, **details, "supported": True}
            except (
                AttributeError,
                KeyError,
                OSError,
                RuntimeError,
                TypeError,
                ValueError,
            ) as error:
                satisfied = False
                details = {
                    "parameters": parameters,
                    "supported": True,
                    "evaluationError": type(error).__name__,
                }
        observations.append(
            {
                "kind": str(kind),
                "satisfied": bool(satisfied),
                "details": details,
            }
        )
    return observations
