"""Owned armature binding and bounded pose-keyframe actions."""

from collections.abc import Mapping
from dataclasses import dataclass
import math
from typing import Any

import bpy
from mathutils import Vector

from ...application import ActionReceipt
from ...application.session import MutationRecord, PoseBoneState, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    COLLECTION_LOGICAL_ID,
    action_fcurves,
    action_keyframe_signature,
    build_resource_registry,
    ensure_collection_contents_tracked,
    ensure_logical_ids_available,
    ensure_modifier_id_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    logical_id,
    make_receipt,
    new_receipt_id,
    number,
    owned_resource,
    require_keys,
    require_object,
    rollback_partial,
    snapshot_modifier,
    snapshot_skin_weights,
    tag_resource,
    text,
    vector,
)

MAX_BONES = 32
MAX_BINDINGS = 64
MAX_KEYFRAMES = 64
MAX_FRAME = 100_000
MAX_WEIGHT_VERTICES = 8192
MAX_INFLUENCES = 8


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
class InfluenceDefinition:
    bone_name: str
    weight: float


@dataclass(frozen=True, slots=True)
class VertexWeightDefinition:
    vertex_index: int
    influences: tuple[InfluenceDefinition, ...]


@dataclass(frozen=True, slots=True)
class SkinWeightsDefinition:
    target_id: str
    armature_id: str
    modifier_id: str
    modifier_name: str
    preserve_volume: bool
    weights: tuple[VertexWeightDefinition, ...]


@dataclass(frozen=True, slots=True)
class PoseDefinition:
    bone_name: str
    rotation_euler: tuple[float, float, float]
    location: tuple[float, float, float] | None
    scale: tuple[float, float, float] | None


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
    interpolation: str
    extrapolation: str


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


def _influence(raw: Mapping[str, Any], label: str) -> InfluenceDefinition:
    fields = {"boneName", "weight"}
    require_keys(raw, fields, fields, label)
    return InfluenceDefinition(
        bone_name=text(
            raw["boneName"],
            f"{label}.boneName",
            prefix="OperatingLine.",
        ),
        weight=number(
            raw["weight"],
            f"{label}.weight",
            minimum=0.000001,
            maximum=1.0,
        ),
    )


def _vertex_weight(raw: Mapping[str, Any], label: str) -> VertexWeightDefinition:
    fields = {"vertexIndex", "influences"}
    require_keys(raw, fields, fields, label)
    raw_influences = raw["influences"]
    if (
        not isinstance(raw_influences, list)
        or not 1 <= len(raw_influences) <= MAX_INFLUENCES
    ):
        raise ValueError(
            f"{label}.influences must contain 1 to {MAX_INFLUENCES} definitions"
        )
    influences = tuple(
        _influence(
            require_object(item, f"{label}.influences[{index}]"),
            f"{label}.influences[{index}]",
        )
        for index, item in enumerate(raw_influences)
    )
    names = [influence.bone_name for influence in influences]
    if len(set(names)) != len(names):
        raise ValueError(f"{label}.influences boneName values must be unique")
    total = sum(influence.weight for influence in influences)
    if not math.isclose(total, 1.0, abs_tol=1e-6):
        raise ValueError(f"{label}.influences weights must sum to 1")
    return VertexWeightDefinition(
        vertex_index=integer(
            raw["vertexIndex"],
            f"{label}.vertexIndex",
            minimum=0,
            maximum=MAX_WEIGHT_VERTICES - 1,
        ),
        influences=influences,
    )


def validate_skin_weights(arguments: Mapping[str, Any]) -> SkinWeightsDefinition:
    fields = {
        "targetId",
        "armatureId",
        "modifierId",
        "modifierName",
        "preserveVolume",
        "weights",
    }
    require_keys(arguments, fields, fields, "arguments")
    raw_weights = arguments["weights"]
    if (
        not isinstance(raw_weights, list)
        or not 1 <= len(raw_weights) <= MAX_WEIGHT_VERTICES
    ):
        raise ValueError(
            "arguments.weights must contain 1 to "
            f"{MAX_WEIGHT_VERTICES} definitions"
        )
    weights = tuple(
        _vertex_weight(
            require_object(item, f"arguments.weights[{index}]"),
            f"arguments.weights[{index}]",
        )
        for index, item in enumerate(raw_weights)
    )
    vertex_indices = [item.vertex_index for item in weights]
    if len(set(vertex_indices)) != len(vertex_indices):
        raise ValueError("arguments.weights vertexIndex values must be unique")
    preserve_volume = arguments["preserveVolume"]
    if not isinstance(preserve_volume, bool):
        raise ValueError("arguments.preserveVolume must be a boolean")
    return SkinWeightsDefinition(
        target_id=logical_id(arguments["targetId"], "arguments.targetId"),
        armature_id=logical_id(arguments["armatureId"], "arguments.armatureId"),
        modifier_id=logical_id(arguments["modifierId"], "arguments.modifierId"),
        modifier_name=text(
            arguments["modifierName"],
            "arguments.modifierName",
            prefix="OperatingLine.",
        ),
        preserve_volume=preserve_volume,
        weights=weights,
    )


def _pose(raw: Mapping[str, Any], label: str) -> PoseDefinition:
    required = {"boneName", "rotationEuler"}
    allowed = required | {"location", "scale"}
    require_keys(raw, required, allowed, label)
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
        location=(
            vector(
                raw["location"],
                f"{label}.location",
                3,
                minimum=-1000.0,
                maximum=1000.0,
            )
            if "location" in raw
            else None
        ),
        scale=(
            vector(
                raw["scale"],
                f"{label}.scale",
                3,
                minimum=0.0001,
                maximum=1000.0,
            )
            if "scale" in raw
            else None
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
    required = {"actionId", "actionName", "armatureId", "keyframes"}
    allowed = required | {"interpolation", "extrapolation"}
    require_keys(arguments, required, allowed, "arguments")
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
    interpolation = arguments.get("interpolation", "BEZIER")
    if not isinstance(interpolation, str) or interpolation not in {
        "BEZIER",
        "LINEAR",
        "CONSTANT",
    }:
        raise ValueError(
            "arguments.interpolation must be BEZIER, LINEAR, or CONSTANT"
        )
    extrapolation = arguments.get("extrapolation", "CONSTANT")
    if not isinstance(extrapolation, str) or extrapolation not in {
        "CONSTANT",
        "LINEAR",
    }:
        raise ValueError("arguments.extrapolation must be CONSTANT or LINEAR")
    definition = PoseAnimationDefinition(
        logical_id=logical_id(arguments["actionId"], "arguments.actionId"),
        name=text(
            arguments["actionName"],
            "arguments.actionName",
            prefix="OperatingLine.",
        ),
        armature_id=logical_id(arguments["armatureId"], "arguments.armatureId"),
        keyframes=keyframes,
        interpolation=interpolation,
        extrapolation=extrapolation,
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


def _add_vertex_weight(group: Any, vertex_index: int, weight: float) -> None:
    group.add((vertex_index,), weight, "REPLACE")


def execute_skin_weights(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: SkinWeightsDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    target_identity, target = owned_resource(registry, definition.target_id, "OBJECT")
    if not isinstance(target, bpy.types.Object) or target.type != "MESH":
        raise ValueError(f"Skin target is not an owned mesh: {definition.target_id}")
    armature_identity, armature = owned_resource(
        registry,
        definition.armature_id,
        "OBJECT",
    )
    if not isinstance(armature, bpy.types.Object) or armature.type != "ARMATURE":
        raise ValueError(
            f"Skin armature is not an owned armature: {definition.armature_id}"
        )
    armature_data_identity, armature_data = owned_resource(
        registry,
        f"{definition.armature_id}.data",
        "ARMATURE",
    )
    if armature.data is not armature_data:
        raise RuntimeError("Skin armature data identity is inconsistent")
    if target.parent is not None:
        raise RuntimeError("Skin target must be unparented")
    if any(modifier.type == "ARMATURE" for modifier in target.modifiers):
        raise RuntimeError("Skin target already has an Armature modifier")
    ensure_modifier_id_available(receipts, definition.modifier_id)
    if target.modifiers.get(definition.modifier_name) is not None:
        raise RuntimeError(
            f"Cannot replace existing modifier: {definition.modifier_name}"
        )

    vertex_count = len(target.data.vertices)
    if vertex_count > MAX_WEIGHT_VERTICES:
        raise RuntimeError(
            f"Skin target exceeds the {MAX_WEIGHT_VERTICES} vertex limit"
        )
    actual_indices = {item.vertex_index for item in definition.weights}
    expected_indices = set(range(vertex_count))
    if actual_indices != expected_indices:
        raise ValueError("Skin weights must cover every target vertex exactly once")
    bone_names = tuple(
        dict.fromkeys(
            influence.bone_name
            for item in definition.weights
            for influence in item.influences
        )
    )
    bones: dict[str, Any] = {}
    for bone_name in bone_names:
        bone = armature.data.bones.get(bone_name)
        if bone is None:
            raise ValueError(f"Skin weights reference unknown bone: {bone_name}")
        if target.vertex_groups.get(bone_name) is not None:
            raise RuntimeError(f"Cannot replace existing vertex group: {bone_name}")
        bones[bone_name] = bone

    receipt_id = new_receipt_id()
    mutations: list[MutationRecord] = []
    created_groups: list[Any] = []
    skin_state_recorded = False
    modifier = None
    modifier_recorded = False
    try:
        for bone_name in bone_names:
            bone = bones[bone_name]
            before = bool(bone.use_deform)
            bone.use_deform = True
            mutations.append(
                MutationRecord(
                    armature_data_identity,
                    f"armature_bone_use_deform:{bone_name}",
                    before,
                    True,
                )
            )

        groups = {
            bone_name: target.vertex_groups.new(name=bone_name)
            for bone_name in bone_names
        }
        created_groups.extend(groups.values())
        for item in definition.weights:
            for influence in item.influences:
                _add_vertex_weight(
                    groups[influence.bone_name],
                    item.vertex_index,
                    influence.weight,
                )
        skin_state = snapshot_skin_weights(
            target,
            created_groups,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"skin_weights:{definition.modifier_id}",
                None,
                skin_state,
            )
        )
        skin_state_recorded = True

        modifier = target.modifiers.new(definition.modifier_name, "ARMATURE")
        modifier.object = armature
        modifier.use_vertex_groups = True
        modifier.use_bone_envelopes = False
        modifier.use_deform_preserve_volume = definition.preserve_volume
        modifier_state = snapshot_modifier(
            target,
            modifier,
            definition.modifier_id,
            receipt_id,
            step_id,
            action.name,
            {"object": armature_identity},
        )
        mutations.append(
            MutationRecord(
                target_identity,
                f"modifier:{definition.modifier_id}",
                None,
                modifier_state,
            )
        )
        modifier_recorded = True
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
        if modifier is not None and not modifier_recorded:
            target.modifiers.remove(modifier)
        if not skin_state_recorded:
            for group in reversed(created_groups):
                current = target.vertex_groups.get(group.name)
                if current is not None:
                    target.vertex_groups.remove(current)
        rollback_partial(receipt_id, step_id, action.name, [], mutations, [])
        raise


def _pose_state(pose_bone: Any) -> PoseBoneState:
    return PoseBoneState(
        rotation_mode=pose_bone.rotation_mode,
        location=tuple(float(value) for value in pose_bone.location),
        rotation_euler=tuple(float(value) for value in pose_bone.rotation_euler),
        scale=tuple(float(value) for value in pose_bone.scale),
    )


def _insert_pose_keyframe(
    pose_bone: Any,
    frame: int,
    bone_name: str,
    data_path: str = "rotation_euler",
) -> bool:
    return bool(
        pose_bone.keyframe_insert(
            data_path=data_path,
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
                if pose.location is not None:
                    pose_bone.location = pose.location
                    if not _insert_pose_keyframe(
                        pose_bone,
                        keyframe.frame,
                        pose.bone_name,
                        "location",
                    ):
                        raise RuntimeError(
                            "Blender rejected location keyframe "
                            f"{keyframe.frame} for {pose.bone_name}"
                        )
                if pose.scale is not None:
                    pose_bone.scale = pose.scale
                    if not _insert_pose_keyframe(
                        pose_bone,
                        keyframe.frame,
                        pose.bone_name,
                        "scale",
                    ):
                        raise RuntimeError(
                            "Blender rejected scale keyframe "
                            f"{keyframe.frame} for {pose.bone_name}"
                        )
        for curve in action_fcurves(animation):
            curve.extrapolation = definition.extrapolation
            for point in curve.keyframe_points:
                point.interpolation = definition.interpolation
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
