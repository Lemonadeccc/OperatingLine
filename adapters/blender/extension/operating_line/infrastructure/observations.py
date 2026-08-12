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
    channels_complete = (
        isinstance(armature, bpy.types.Object)
        and armature.type == "ARMATURE"
        and len(available_bones) == len(bone_names)
        and all(
            curve_frames.get((armature.pose.bones[name].path_from_id("rotation_euler"), index))
            == expected_frames
            for name in bone_names
            for index in range(3)
        )
    )
    satisfied = (
        isinstance(animation, bpy.types.Action)
        and assigned
        and bool(bone_names)
        and len(available_bones) == len(bone_names)
        and actual_range == expected_range
        and channels_complete
    )
    return satisfied, {
        "armatureId": armature_id if isinstance(armature_id, str) else None,
        "actionId": action_id if isinstance(action_id, str) else None,
        "assigned": assigned,
        "frameRange": list(actual_range),
        "expectedFrameRange": list(expected_range),
        "availableBoneNames": available_bones,
        "channelsComplete": channels_complete,
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


def _modifier_ready(
    parameters: Mapping[str, Any], receipts: Mapping[str, ActionReceipt]
) -> ObservationResult:
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
    owner, modifier = found if found is not None else (None, None)
    properties_match = True
    if modifier is not None:
        if isinstance(parameters.get("width"), (int, float)) and not isinstance(
            parameters["width"], bool
        ):
            properties_match = properties_match and math.isclose(
                float(modifier.width), float(parameters["width"]), abs_tol=1e-6
            )
        if isinstance(parameters.get("segments"), int) and not isinstance(
            parameters["segments"], bool
        ):
            properties_match = properties_match and (
                int(modifier.segments) == parameters["segments"]
            )
    satisfied = bool(
        isinstance(target, bpy.types.Object)
        and owner is target
        and modifier is not None
        and isinstance(modifier_type, str)
        and modifier.type == modifier_type
        and properties_match
    )
    return satisfied, {
        "targetId": target_id if isinstance(target_id, str) else None,
        "modifierId": modifier_id if isinstance(modifier_id, str) else None,
        "modifierType": modifier.type if modifier is not None else None,
        "propertiesMatch": properties_match,
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
    "render_scene_ready": _render_scene_ready,
    "render_rig_ready": _render_rig_ready,
    "render_artifact_exists": _render_artifact_exists,
    "mesh_topology_matches": _mesh_topology_matches,
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
