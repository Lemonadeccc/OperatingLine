"""Read-only evaluators for guide-plan observation expectations."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import hashlib
import math
from pathlib import Path
from typing import Any

import bpy

from ..application.session import ActionReceipt
from .snowman_actions.common import (
    action_fcurves,
    build_resource_registry,
    find_artifact,
    find_owned_modifier,
    find_owned_skin_weights,
    mesh_content_signature,
    resolve_resource,
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


def _material_assigned(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    material_id = parameters.get("materialId")
    targets = parameters.get("targets", parameters.get("targetIds"))
    requested_targets = (
        tuple(targets)
        if isinstance(targets, list)
        and all(isinstance(item, str) and item for item in targets)
        else ()
    )
    registry = build_resource_registry(receipts)
    material_identity = registry.get(material_id) if isinstance(material_id, str) else None
    material = resolve_resource(material_identity) if material_identity is not None else None
    assigned: list[str] = []
    if isinstance(material, bpy.types.Material):
        for target_id in requested_targets:
            target_identity = registry.get(target_id)
            target = resolve_resource(target_identity) if target_identity is not None else None
            if isinstance(target, bpy.types.Object) and tuple(
                slot.material for slot in target.material_slots
            ) == (material,):
                assigned.append(target_id)
    satisfied = (
        isinstance(material, bpy.types.Material)
        and bool(requested_targets)
        and len(assigned) == len(requested_targets)
    )
    return satisfied, {
        "materialId": material_id if isinstance(material_id, str) else None,
        "targetIds": list(requested_targets),
        "assignedTargetIds": assigned,
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
            item in {"location", "rotation_euler", "scale"}
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
    component_counts = {"location": 3, "rotation_euler": 3, "scale": 3}
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
    counts = (
        (
            len(result_mesh.vertices),
            len(result_mesh.edges),
            len(result_mesh.polygons),
        )
        if isinstance(result_mesh, bpy.types.Mesh)
        else (0, 0, 0)
    )
    nonempty = all(count > 0 for count in counts)
    all_triangles = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and result_mesh.polygons
        and all(len(polygon.vertices) == 3 for polygon in result_mesh.polygons)
    )
    within_limits = bool(
        counts[0] <= 8192 and counts[1] <= 16384 and counts[2] <= 8192
    )
    assigned = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(result_mesh, bpy.types.Mesh)
        and target.data is result_mesh
    )
    satisfied = bool(
        parameters_valid
        and assigned
        and nonempty
        and all_triangles
        and within_limits
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "resultMeshId": (
            result_mesh_id if isinstance(result_mesh_id, str) else None
        ),
        "parametersValid": parameters_valid,
        "assigned": assigned,
        "nonempty": nonempty,
        "allTriangles": all_triangles,
        "withinLimits": within_limits,
        "vertexCount": counts[0],
        "edgeCount": counts[1],
        "faceCount": counts[2],
    }


def _replacement_mesh_grew(
    parameters: Mapping[str, Any],
    receipts: Mapping[str, ActionReceipt],
    action_name: str,
) -> ObservationResult:
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
        if receipt.action_name == action_name
        and result_identity is not None
        and result_identity in receipt.created
    )
    receipt = matching_receipts[0] if len(matching_receipts) == 1 else None
    data_mutation = (
        next(
            (
                mutation
                for mutation in receipt.mutations
                if mutation.attribute == "data"
                and mutation.resource == target_identity
                and mutation.after == result_identity
            ),
            None,
        )
        if receipt is not None
        else None
    )
    content_mutation = (
        next(
            (
                mutation
                for mutation in receipt.mutations
                if mutation.attribute == "mesh_content"
                and mutation.resource == result_identity
            ),
            None,
        )
        if receipt is not None
        else None
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
    assigned = bool(
        isinstance(target, bpy.types.Object)
        and target.type == "MESH"
        and isinstance(result_mesh, bpy.types.Mesh)
        and target.data is result_mesh
    )
    topology_grew = all(
        result_count > source_count
        for result_count, source_count in zip(result_counts, source_counts)
    )
    within_limits = bool(
        result_counts[0] <= 8192
        and result_counts[1] <= 16384
        and result_counts[2] <= 8192
    )
    content_intact = bool(
        isinstance(result_mesh, bpy.types.Mesh)
        and content_mutation is not None
        and content_mutation.after is not None
        and mesh_content_signature(result_mesh) == content_mutation.after
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
        and topology_grew
        and within_limits
        and content_intact
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "resultMeshId": (
            result_mesh_id if isinstance(result_mesh_id, str) else None
        ),
        "parametersValid": parameters_valid,
        "assigned": assigned,
        "receiptMatches": receipt_matches,
        "topologyGrew": topology_grew,
        "withinLimits": within_limits,
        "contentIntact": content_intact,
        "sourceVertexCount": source_counts[0],
        "sourceEdgeCount": source_counts[1],
        "sourceFaceCount": source_counts[2],
        "vertexCount": result_counts[0],
        "edgeCount": result_counts[1],
        "faceCount": result_counts[2],
    }


def _mesh_region_extruded(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _replacement_mesh_grew(
        parameters, receipts, "blender.mesh.edit_extrude_region"
    )


def _mesh_edges_beveled(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
    return _replacement_mesh_grew(
        parameters, receipts, "blender.mesh.edit_bevel_edges"
    )


def _mesh_faces_inset(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
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
    if modifier_type == "SOLIDIFY":
        properties_match = properties_match and solidify_parameters.issubset(
            parameters
        )
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
        properties_match = (
            properties_match
            and subdivision_surface_parameters.issubset(parameters)
        )
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
    source_content_intact = False
    evaluated_topology = (0, 0, 0)
    evaluated_finite = False
    evaluated_within_limits = False
    if modifier_type == "MIRROR" and modifier is not None:
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
        properties_match = bool(
            properties_match
            and mirror_fixed_state_matches
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
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "modifierType": modifier.type if modifier is not None else None,
        "propertiesMatch": properties_match,
        "axis": actual_mirror_axis,
        "expectedAxis": (
            expected_mirror_axis if isinstance(expected_mirror_axis, str) else None
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


OBSERVATION_EVALUATORS: dict[str, ObservationEvaluator] = {
    "object_exists": _object_exists,
    "resource_exists": _resource_exists,
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
