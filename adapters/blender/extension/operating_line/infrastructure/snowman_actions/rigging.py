"""Owned armature binding and bounded pose-keyframe actions."""

from collections.abc import Mapping
from dataclasses import dataclass
import math
from typing import Any

import bpy
from mathutils import Vector

from ...application import ActionReceipt
from ...application.session import MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    COLLECTION_LOGICAL_ID,
    action_keyframe_signature,
    build_resource_registry,
    ensure_collection_contents_tracked,
    ensure_logical_ids_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    logical_id,
    make_receipt,
    new_receipt_id,
    owned_resource,
    require_keys,
    require_object,
    rollback_partial,
    tag_resource,
    text,
    vector,
)

MAX_BONES = 32
MAX_BINDINGS = 64
MAX_KEYFRAMES = 64
MAX_FRAME = 100_000


@dataclass(frozen=True, slots=True)
class BoneDefinition:
    name: str
    head: tuple[float, float, float]
    tail: tuple[float, float, float]
    parent_name: str | None


@dataclass(frozen=True, slots=True)
class BindingDefinition:
    target_id: str
    bone_name: str


@dataclass(frozen=True, slots=True)
class ArmatureDefinition:
    logical_id: str
    object_name: str
    data_name: str
    collection_id: str
    bones: tuple[BoneDefinition, ...]
    bindings: tuple[BindingDefinition, ...]


@dataclass(frozen=True, slots=True)
class PoseDefinition:
    bone_name: str
    rotation_euler: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class KeyframeDefinition:
    frame: int
    poses: tuple[PoseDefinition, ...]


@dataclass(frozen=True, slots=True)
class PoseAnimationDefinition:
    logical_id: str
    name: str
    armature_id: str
    keyframes: tuple[KeyframeDefinition, ...]


def _validate_acyclic_bones(bones: tuple[BoneDefinition, ...]) -> None:
    parent_by_name = {bone.name: bone.parent_name for bone in bones}
    for bone in bones:
        visited = {bone.name}
        parent_name = bone.parent_name
        while parent_name is not None:
            if parent_name not in parent_by_name:
                raise ValueError(
                    f"Bone {bone.name} references unknown parent {parent_name}"
                )
            if parent_name in visited:
                raise ValueError("Armature bone parents must be acyclic")
            visited.add(parent_name)
            parent_name = parent_by_name[parent_name]


def _bone(raw: Mapping[str, Any], label: str) -> BoneDefinition:
    fields = {"boneName", "head", "tail", "parentName"}
    require_keys(raw, fields, fields, label)
    head = vector(raw["head"], f"{label}.head", 3, minimum=-1000.0, maximum=1000.0)
    tail = vector(raw["tail"], f"{label}.tail", 3, minimum=-1000.0, maximum=1000.0)
    if Vector(head) == Vector(tail):
        raise ValueError(f"{label}.head and tail must differ")
    raw_parent = raw["parentName"]
    if raw_parent is not None and not isinstance(raw_parent, str):
        raise ValueError(f"{label}.parentName must be a string or null")
    return BoneDefinition(
        name=text(raw["boneName"], f"{label}.boneName", prefix="OperatingLine."),
        head=head,
        tail=tail,
        parent_name=(
            text(raw_parent, f"{label}.parentName", prefix="OperatingLine.")
            if raw_parent is not None
            else None
        ),
    )


def _binding(raw: Mapping[str, Any], label: str) -> BindingDefinition:
    fields = {"targetId", "boneName"}
    require_keys(raw, fields, fields, label)
    return BindingDefinition(
        target_id=logical_id(raw["targetId"], f"{label}.targetId"),
        bone_name=text(
            raw["boneName"],
            f"{label}.boneName",
            prefix="OperatingLine.",
        ),
    )


def validate_armature(arguments: Mapping[str, Any]) -> ArmatureDefinition:
    fields = {
        "armatureId",
        "objectName",
        "dataName",
        "collectionId",
        "bones",
        "bindings",
    }
    require_keys(arguments, fields, fields, "arguments")
    raw_bones = arguments["bones"]
    if not isinstance(raw_bones, list) or not 1 <= len(raw_bones) <= MAX_BONES:
        raise ValueError(f"arguments.bones must contain 1 to {MAX_BONES} definitions")
    bones = tuple(
        _bone(
            require_object(raw, f"arguments.bones[{index}]"),
            f"arguments.bones[{index}]",
        )
        for index, raw in enumerate(raw_bones)
    )
    bone_names = [bone.name for bone in bones]
    if len(set(bone_names)) != len(bone_names):
        raise ValueError("Armature boneName values must be unique")
    _validate_acyclic_bones(bones)

    raw_bindings = arguments["bindings"]
    if (
        not isinstance(raw_bindings, list)
        or not 1 <= len(raw_bindings) <= MAX_BINDINGS
    ):
        raise ValueError(
            f"arguments.bindings must contain 1 to {MAX_BINDINGS} definitions"
        )
    bindings = tuple(
        _binding(
            require_object(raw, f"arguments.bindings[{index}]"),
            f"arguments.bindings[{index}]",
        )
        for index, raw in enumerate(raw_bindings)
    )
    target_ids = [binding.target_id for binding in bindings]
    if len(set(target_ids)) != len(target_ids):
        raise ValueError("Armature binding targetId values must be unique")
    unknown_bones = {
        binding.bone_name for binding in bindings if binding.bone_name not in bone_names
    }
    if unknown_bones:
        raise ValueError(f"Armature binding references unknown bone: {min(unknown_bones)}")

    collection_id = logical_id(arguments["collectionId"], "arguments.collectionId")
    if collection_id != COLLECTION_LOGICAL_ID:
        raise ValueError(
            f"arguments.collectionId must be {COLLECTION_LOGICAL_ID}"
        )
    definition = ArmatureDefinition(
        logical_id=logical_id(arguments["armatureId"], "arguments.armatureId"),
        object_name=text(
            arguments["objectName"],
            "arguments.objectName",
            prefix="OperatingLine.",
        ),
        data_name=text(
            arguments["dataName"],
            "arguments.dataName",
            prefix="OperatingLine.",
        ),
        collection_id=collection_id,
        bones=bones,
        bindings=bindings,
    )
    created_ids = (definition.logical_id, f"{definition.logical_id}.data")
    ensure_logical_ids_available({}, created_ids)
    overlap = {binding.target_id for binding in bindings}.intersection(created_ids)
    if overlap:
        raise ValueError(
            f"Armature logical ID cannot also be a binding target: {min(overlap)}"
        )
    return definition


def _pose(raw: Mapping[str, Any], label: str) -> PoseDefinition:
    fields = {"boneName", "rotationEuler"}
    require_keys(raw, fields, fields, label)
    return PoseDefinition(
        bone_name=text(
            raw["boneName"],
            f"{label}.boneName",
            prefix="OperatingLine.",
        ),
        rotation_euler=vector(
            raw["rotationEuler"],
            f"{label}.rotationEuler",
            3,
            minimum=-2.0 * math.pi,
            maximum=2.0 * math.pi,
        ),
    )


def _keyframe(raw: Mapping[str, Any], label: str) -> KeyframeDefinition:
    fields = {"frame", "poses"}
    require_keys(raw, fields, fields, label)
    raw_poses = raw["poses"]
    if not isinstance(raw_poses, list) or not 1 <= len(raw_poses) <= MAX_BONES:
        raise ValueError(f"{label}.poses must contain 1 to {MAX_BONES} definitions")
    poses = tuple(
        _pose(
            require_object(raw_pose, f"{label}.poses[{index}]"),
            f"{label}.poses[{index}]",
        )
        for index, raw_pose in enumerate(raw_poses)
    )
    names = [pose.bone_name for pose in poses]
    if len(set(names)) != len(names):
        raise ValueError(f"{label}.poses boneName values must be unique")
    return KeyframeDefinition(
        frame=integer(raw["frame"], f"{label}.frame", maximum=MAX_FRAME),
        poses=poses,
    )


def validate_pose_animation(
    arguments: Mapping[str, Any],
) -> PoseAnimationDefinition:
    fields = {"actionId", "actionName", "armatureId", "keyframes"}
    require_keys(arguments, fields, fields, "arguments")
    raw_keyframes = arguments["keyframes"]
    if (
        not isinstance(raw_keyframes, list)
        or not 2 <= len(raw_keyframes) <= MAX_KEYFRAMES
    ):
        raise ValueError(
            f"arguments.keyframes must contain 2 to {MAX_KEYFRAMES} definitions"
        )
    keyframes = tuple(
        _keyframe(
            require_object(raw, f"arguments.keyframes[{index}]"),
            f"arguments.keyframes[{index}]",
        )
        for index, raw in enumerate(raw_keyframes)
    )
    frames = [keyframe.frame for keyframe in keyframes]
    if any(current <= previous for previous, current in zip(frames, frames[1:])):
        raise ValueError("arguments.keyframes frames must be strictly increasing")
    definition = PoseAnimationDefinition(
        logical_id=logical_id(arguments["actionId"], "arguments.actionId"),
        name=text(
            arguments["actionName"],
            "arguments.actionName",
            prefix="OperatingLine.",
        ),
        armature_id=logical_id(arguments["armatureId"], "arguments.armatureId"),
        keyframes=keyframes,
    )
    if definition.logical_id == definition.armature_id:
        raise ValueError("Action and armature logical IDs must differ")
    return definition


def _matrix_rows(value: Any) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(float(component) for component in row) for row in value)


def _parent_state(
    obj: bpy.types.Object,
    parent: ResourceIdentity | None,
) -> tuple[Any, str, str, tuple[tuple[float, ...], ...], tuple[tuple[float, ...], ...]]:
    return (
        parent,
        obj.parent_type,
        obj.parent_bone,
        _matrix_rows(obj.matrix_parent_inverse),
        _matrix_rows(obj.matrix_basis),
    )


def _object_in_view_layer(obj: bpy.types.Object, view_layer: Any) -> bool:
    return any(candidate.as_pointer() == obj.as_pointer() for candidate in view_layer.objects)


def _create_edit_bones(
    armature: bpy.types.Object,
    bones: tuple[BoneDefinition, ...],
) -> None:
    view_layer = bpy.context.view_layer
    previous_active = view_layer.objects.active
    previous_selected = tuple(bpy.context.selected_objects)
    previous_mode = previous_active.mode if previous_active is not None else "OBJECT"
    try:
        if previous_active is not None and previous_active.mode != "OBJECT":
            if bpy.ops.object.mode_set(mode="OBJECT") != {"FINISHED"}:
                raise RuntimeError("Blender could not leave the current edit mode")
        for selected in tuple(bpy.context.selected_objects):
            selected.select_set(False)
        armature.select_set(True)
        view_layer.objects.active = armature
        if bpy.ops.object.mode_set(mode="EDIT") != {"FINISHED"}:
            raise RuntimeError("Blender could not enter armature edit mode")
        edit_bones: dict[str, Any] = {}
        for definition in bones:
            edit_bone = armature.data.edit_bones.new(definition.name)
            edit_bone.head = definition.head
            edit_bone.tail = definition.tail
            edit_bone.use_deform = False
            edit_bones[definition.name] = edit_bone
        for definition in bones:
            if definition.parent_name is not None:
                edit_bones[definition.name].parent = edit_bones[
                    definition.parent_name
                ]
        if bpy.ops.object.mode_set(mode="OBJECT") != {"FINISHED"}:
            raise RuntimeError("Blender could not leave armature edit mode")
    finally:
        if armature.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for selected in tuple(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in previous_selected:
            if _object_in_view_layer(selected, view_layer):
                selected.select_set(True)
        if previous_active is not None and _object_in_view_layer(
            previous_active, view_layer
        ):
            view_layer.objects.active = previous_active
            if previous_mode != "OBJECT":
                bpy.ops.object.mode_set(mode=previous_mode)
        else:
            view_layer.objects.active = None


def execute_armature(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: ArmatureDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    collection_identity, collection = owned_resource(
        registry,
        definition.collection_id,
        "COLLECTION",
    )
    ensure_collection_contents_tracked(collection, registry)
    created_ids = (definition.logical_id, f"{definition.logical_id}.data")
    ensure_logical_ids_available(registry, created_ids)
    ensure_name_available(bpy.data.objects, definition.object_name, "object")
    ensure_name_available(bpy.data.armatures, definition.data_name, "armature data")
    targets: list[tuple[BindingDefinition, ResourceIdentity, bpy.types.Object]] = []
    for binding in definition.bindings:
        target_identity, target = owned_resource(registry, binding.target_id, "OBJECT")
        if not isinstance(target, bpy.types.Object) or target.type != "MESH":
            raise ValueError(
                f"Armature binding target is not an owned mesh object: {binding.target_id}"
            )
        if target.parent is not None:
            raise RuntimeError(
                f"Armature binding target is already parented: {binding.target_id}"
            )
        targets.append((binding, target_identity, target))

    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        armature_data = bpy.data.armatures.new(definition.data_name)
        data_identity = tag_resource(
            armature_data,
            f"{definition.logical_id}.data",
            receipt_id,
            step_id,
            action.name,
        )
        created.append(data_identity)
        armature = bpy.data.objects.new(definition.object_name, armature_data)
        armature_identity = tag_resource(
            armature,
            definition.logical_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(armature_identity)
        armature.show_in_front = True
        armature.display_type = "WIRE"
        collection.objects.link(armature)
        mutations.append(
            MutationRecord(
                armature_identity,
                "users_collection",
                (),
                (collection_identity,),
            )
        )
        _create_edit_bones(armature, definition.bones)
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = "XYZ"

        for binding, target_identity, target in targets:
            before = _parent_state(target, None)
            world_matrix = target.matrix_world.copy()
            target.parent = armature
            target.parent_type = "BONE"
            target.parent_bone = binding.bone_name
            target.matrix_world = world_matrix
            mutations.append(
                MutationRecord(
                    target_identity,
                    "bone_parent",
                    before,
                    _parent_state(target, armature_identity),
                )
            )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            armature_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise


def _pose_state(pose_bone: Any) -> tuple[str, tuple[float, float, float]]:
    return (
        pose_bone.rotation_mode,
        tuple(float(value) for value in pose_bone.rotation_euler),
    )


def _insert_pose_keyframe(pose_bone: Any, frame: int, bone_name: str) -> bool:
    return bool(
        pose_bone.keyframe_insert(
            data_path="rotation_euler",
            frame=frame,
            group=bone_name,
        )
    )


def execute_pose_animation(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: PoseAnimationDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    armature_identity, armature = owned_resource(
        registry,
        definition.armature_id,
        "OBJECT",
    )
    if not isinstance(armature, bpy.types.Object) or armature.type != "ARMATURE":
        raise ValueError(
            f"Animation target is not an owned armature: {definition.armature_id}"
        )
    ensure_logical_ids_available(registry, (definition.logical_id,))
    ensure_name_available(bpy.data.actions, definition.name, "action")
    animation_data = armature.animation_data
    if animation_data is not None and (
        animation_data.action is not None
        or len(animation_data.nla_tracks) != 0
        or len(animation_data.drivers) != 0
    ):
        raise RuntimeError("Owned armature already has animation data")

    bone_names = tuple(
        dict.fromkeys(
            pose.bone_name
            for keyframe in definition.keyframes
            for pose in keyframe.poses
        )
    )
    pose_bones: dict[str, Any] = {}
    for bone_name in bone_names:
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            raise ValueError(f"Animation references unknown pose bone: {bone_name}")
        pose_bones[bone_name] = pose_bone

    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    had_animation_data = animation_data is not None
    before_pose = {name: _pose_state(pose_bones[name]) for name in bone_names}
    try:
        animation = bpy.data.actions.new(definition.name)
        action_identity = tag_resource(
            animation,
            definition.logical_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(action_identity)
        armature.animation_data_create().action = animation
        for bone_name in bone_names:
            mutations.append(
                MutationRecord(
                    armature_identity,
                    f"pose_bone_state:{bone_name}",
                    before_pose[bone_name],
                    action_identity,
                )
            )
        mutations.append(
            MutationRecord(
                armature_identity,
                "animation_action",
                (had_animation_data, None),
                action_identity,
            )
        )
        for keyframe in definition.keyframes:
            for pose in keyframe.poses:
                pose_bone = pose_bones[pose.bone_name]
                pose_bone.rotation_mode = "XYZ"
                pose_bone.rotation_euler = pose.rotation_euler
                inserted = _insert_pose_keyframe(
                    pose_bone,
                    keyframe.frame,
                    pose.bone_name,
                )
                if not inserted:
                    raise RuntimeError(
                        f"Blender rejected keyframe {keyframe.frame} for {pose.bone_name}"
                    )
        mutations.append(
            MutationRecord(
                action_identity,
                "action_keyframes",
                None,
                action_keyframe_signature(animation),
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            armature_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise
