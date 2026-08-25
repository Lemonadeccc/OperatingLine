"""Operation-level execution for the bounded Pose Animation guide leaf."""

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


POSE_ANIMATION_ACTION = "blender.animation.create_pose_keyframes"
POSE_ANIMATION_OPERATION_IDS = (
    "workspace.animation",
    "editor.action",
    "mode.pose",
    "semantic.create_pose_action",
    "projection.semantic.pose_animation.action_name",
    "operator.insert_keyframe",
    "projection.semantic.pose_animation.keyframes",
    "control.pose_interpolation",
    "projection.semantic.pose_animation.interpolation",
    "control.pose_extrapolation",
    "projection.semantic.pose_animation.extrapolation",
    "semantic.verify_pose_animation",
)
POSE_ANIMATION_MUTATING_ORDINALS = frozenset({4, 5, 7, 9, 11})

_INTERPOLATION_MARKER = "_operatingline_pose_interpolation_applied"
_EXTRAPOLATION_MARKER = "_operatingline_pose_extrapolation_applied"
_DEFAULT_INTERPOLATION = "BEZIER"
_DEFAULT_EXTRAPOLATION = "CONSTANT"
_POSE_ANIMATION_EXECUTE_TOOL = (
    "operatingline.blender.animation.pose-keyframes.execute-next"
)


def _dependencies() -> SimpleNamespace:
    from ..application.session import MutationRecord, PoseBoneState
    from .snowman_actions.common import (
        action_fcurves,
        action_keyframe_signature,
        build_resource_registry,
        ensure_logical_ids_available,
        ensure_name_available,
        ensure_receipts_intact,
        journal_created_resource,
        make_receipt,
        owned_resource,
        rebind_receipts_after_native_restore,
        resolve_resource,
        rollback_partial,
        rollback_receipt,
    )

    return SimpleNamespace(
        MutationRecord=MutationRecord,
        PoseBoneState=PoseBoneState,
        action_fcurves=action_fcurves,
        action_keyframe_signature=action_keyframe_signature,
        build_resource_registry=build_resource_registry,
        ensure_logical_ids_available=ensure_logical_ids_available,
        ensure_name_available=ensure_name_available,
        ensure_receipts_intact=ensure_receipts_intact,
        journal_created_resource=journal_created_resource,
        make_receipt=make_receipt,
        owned_resource=owned_resource,
        rebind_receipts_after_native_restore=rebind_receipts_after_native_restore,
        resolve_resource=resolve_resource,
        rollback_partial=rollback_partial,
        rollback_receipt=rollback_receipt,
    )


def _bpy() -> Any:
    import bpy

    return bpy


def _digest(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def _definition_fingerprint(definition: Any) -> str:
    return _digest(
        (
            definition.logical_id,
            definition.name,
            definition.armature_id,
            definition.keyframes,
            definition.interpolation,
            definition.extrapolation,
        )
    )


def _bone_names(definition: Any) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            pose.bone_name
            for keyframe in definition.keyframes
            for pose in keyframe.poses
        )
    )


def _pose_state(pose_bone: Any, deps: Any) -> Any:
    return deps.PoseBoneState(
        rotation_mode=pose_bone.rotation_mode,
        location=tuple(float(value) for value in pose_bone.location),
        rotation_euler=tuple(float(value) for value in pose_bone.rotation_euler),
        rotation_quaternion=tuple(
            float(value) for value in pose_bone.rotation_quaternion
        ),
        rotation_axis_angle=tuple(
            float(value) for value in pose_bone.rotation_axis_angle
        ),
        scale=tuple(float(value) for value in pose_bone.scale),
    )


def _states_close(actual: Any, expected: Any) -> bool:
    return (
        actual.rotation_mode == expected.rotation_mode
        and all(
            math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-6)
            for actual_values, expected_values in (
                (actual.location, expected.location),
                (actual.rotation_euler, expected.rotation_euler),
                (actual.rotation_quaternion, expected.rotation_quaternion),
                (actual.rotation_axis_angle, expected.rotation_axis_angle),
                (actual.scale, expected.scale),
            )
            for left, right in zip(actual_values, expected_values, strict=True)
        )
    )


def _owned_armature(
    receipts: Mapping[str, Any], definition: Any, deps: Any
) -> tuple[Any, Any]:
    registry = deps.build_resource_registry(receipts)
    identity, armature = deps.owned_resource(
        registry, definition.armature_id, "OBJECT"
    )
    if getattr(armature, "type", None) != "ARMATURE":
        raise ValueError(
            f"Animation target is not an owned armature: {definition.armature_id}"
        )
    return identity, armature


def _pose_bones(armature: Any, definition: Any) -> dict[str, Any]:
    bones: dict[str, Any] = {}
    for bone_name in _bone_names(definition):
        bone = armature.pose.bones.get(bone_name)
        if bone is None:
            raise ValueError(f"Animation references unknown pose bone: {bone_name}")
        bones[bone_name] = bone
    return bones


def _pending_name(receipt_id: str) -> str:
    return f"OperatingLine.PendingPose.{receipt_id[:8]}"


def _empty_receipt(
    receipt_id: str,
    step_id: str,
    action_name: str,
    armature_identity: Any,
    deps: Any,
) -> Any:
    return deps.make_receipt(
        receipt_id, step_id, action_name, [], [], [], armature_identity
    )


def _action_identity(receipt: Any, definition: Any) -> Any:
    matches = tuple(
        identity
        for identity in receipt.created
        if identity.resource_type == "ACTION"
        and identity.logical_id == definition.logical_id
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Pose receipt must own exactly one Action")
    return matches[0]


def _action_mutation(receipt: Any) -> Any:
    matches = tuple(
        mutation
        for mutation in receipt.mutations
        if mutation.attribute == "action_keyframes"
    )
    if len(matches) != 1:
        raise RuntimeError("Partial Pose receipt must contain one keyframe mutation")
    return matches[0]


def _current_action(receipt: Any, armature: Any, definition: Any, deps: Any) -> Any:
    identity = _action_identity(receipt, definition)
    action = deps.resolve_resource(identity)
    animation_data = armature.animation_data
    if action is None or animation_data is None or animation_data.action is not action:
        raise RuntimeError("Partial Pose Action binding changed")
    return action


def _replace_action_identity(receipt: Any, old: Any, new: Any, deps: Any) -> Any:
    def rebound(value: Any) -> Any:
        return new if value == old else value

    return replace(
        receipt,
        created=tuple(rebound(identity) for identity in receipt.created),
        mutations=tuple(
            deps.MutationRecord(
                rebound(mutation.resource),
                mutation.attribute,
                rebound(mutation.before),
                rebound(mutation.after),
            )
            for mutation in receipt.mutations
        ),
        anchor=rebound(receipt.anchor),
    )


def _replace_action_signature(receipt: Any, action: Any, deps: Any) -> Any:
    mutation = _action_mutation(receipt)
    replacement = deps.MutationRecord(
        mutation.resource,
        mutation.attribute,
        mutation.before,
        deps.action_keyframe_signature(action),
    )
    return replace(
        receipt,
        mutations=tuple(
            replacement if candidate is mutation else candidate
            for candidate in receipt.mutations
        ),
    )


def _preflight(
    armature: Any,
    receipts: Mapping[str, Any],
    definition: Any,
    receipt_id: str,
    deps: Any,
) -> None:
    deps.ensure_receipts_intact(receipts)
    deps.ensure_logical_ids_available(
        deps.build_resource_registry(receipts), (definition.logical_id,)
    )
    deps.ensure_name_available(_bpy().data.actions, definition.name, "action")
    deps.ensure_name_available(
        _bpy().data.actions, _pending_name(receipt_id), "pending action"
    )
    animation_data = armature.animation_data
    if animation_data is not None and (
        animation_data.action is not None
        or len(animation_data.nla_tracks) != 0
        or len(animation_data.drivers) != 0
    ):
        raise RuntimeError("Owned armature already has animation data")
    _pose_bones(armature, definition)


def _before_pose_states(receipt: Any) -> dict[str, Any]:
    return {
        mutation.attribute.partition(":")[2]: mutation.before
        for mutation in receipt.mutations
        if mutation.attribute.startswith("pose_bone_state:")
    }


def _expected_pose_states(receipt: Any, definition: Any) -> dict[str, Any]:
    states = dict(_before_pose_states(receipt))
    for keyframe in definition.keyframes:
        for pose in keyframe.poses:
            state = states[pose.bone_name]
            if pose.rotation_euler is not None:
                state = replace(
                    state,
                    rotation_mode="XYZ",
                    rotation_euler=tuple(pose.rotation_euler),
                )
            elif pose.rotation_quaternion is not None:
                state = replace(
                    state,
                    rotation_mode="QUATERNION",
                    rotation_quaternion=tuple(pose.rotation_quaternion),
                )
            else:
                state = replace(
                    state,
                    rotation_mode="AXIS_ANGLE",
                    rotation_axis_angle=tuple(pose.rotation_axis_angle),
                )
            if pose.location is not None:
                state = replace(state, location=tuple(pose.location))
            if pose.scale is not None:
                state = replace(state, scale=tuple(pose.scale))
            states[pose.bone_name] = state
    return states


def _curve_expectations(
    armature: Any, definition: Any
) -> dict[tuple[str, int], list[tuple[float, float]]]:
    expected: dict[tuple[str, int], list[tuple[float, float]]] = {}
    bones = _pose_bones(armature, definition)
    for keyframe in definition.keyframes:
        for pose in keyframe.poses:
            bone = bones[pose.bone_name]
            prefix = bone.path_from_id()
            if pose.rotation_euler is not None:
                channel = "rotation_euler"
                values = pose.rotation_euler
            elif pose.rotation_quaternion is not None:
                channel = "rotation_quaternion"
                values = pose.rotation_quaternion
            else:
                channel = "rotation_axis_angle"
                values = pose.rotation_axis_angle
            for index, value in enumerate(values):
                expected.setdefault((f"{prefix}.{channel}", index), []).append(
                    (float(keyframe.frame), float(value))
                )
            for channel, values in (
                ("location", pose.location),
                ("scale", pose.scale),
            ):
                if values is None:
                    continue
                for index, value in enumerate(values):
                    expected.setdefault((f"{prefix}.{channel}", index), []).append(
                        (float(keyframe.frame), float(value))
                    )
    return expected


def _validate_curves(
    action: Any,
    armature: Any,
    definition: Any,
    *,
    interpolation: str,
    extrapolation: str,
    deps: Any,
) -> None:
    expected = _curve_expectations(armature, definition)
    actual = {
        (curve.data_path, int(curve.array_index)): curve
        for curve in deps.action_fcurves(action)
    }
    if set(actual) != set(expected):
        raise RuntimeError("Pose Action FCurve channels changed")
    for identity, expected_points in expected.items():
        curve = actual[identity]
        points = tuple(curve.keyframe_points)
        if len(points) != len(expected_points) or curve.extrapolation != extrapolation:
            raise RuntimeError("Pose Action curve shape changed")
        for point, (frame, value) in zip(points, expected_points, strict=True):
            if (
                not math.isclose(float(point.co[0]), frame, abs_tol=1e-5)
                or not math.isclose(float(point.co[1]), value, abs_tol=1e-5)
                or point.interpolation != interpolation
            ):
                raise RuntimeError("Pose Action keyframe value changed")


def _expected_pose_curve_order(definition: Any) -> tuple[tuple[str, str, int], ...]:
    order = []
    seen = set()
    for keyframe in definition.keyframes:
        for pose in keyframe.poses:
            if pose.rotation_euler is not None:
                channels = [("rotation_euler", pose.rotation_euler)]
            elif pose.rotation_quaternion is not None:
                channels = [("rotation_quaternion", pose.rotation_quaternion)]
            else:
                channels = [("rotation_axis_angle", pose.rotation_axis_angle)]
            if pose.location is not None:
                channels.append(("location", pose.location))
            if pose.scale is not None:
                channels.append(("scale", pose.scale))
            for data_path, values in channels:
                for component_index in range(len(values)):
                    target = (pose.bone_name, data_path, component_index)
                    if target not in seen:
                        seen.add(target)
                        order.append(target)
    return tuple(order)


def _ordered_pose_curves(
    action: Any, definition: Any, deps: Any
) -> tuple[tuple[str, str, Any], ...]:
    curves_by_target = {}
    for curve in deps.action_fcurves(action):
        bone_name = curve.group.name if curve.group is not None else None
        data_path = next(
            (
                candidate
                for candidate in (
                    "rotation_euler",
                    "rotation_quaternion",
                    "rotation_axis_angle",
                    "location",
                    "scale",
                )
                if curve.data_path.endswith(f".{candidate}")
            ),
            None,
        )
        if not isinstance(bone_name, str) or not bone_name or data_path is None:
            raise RuntimeError("Pose Action FCurve lacks its bounded bone/channel target")
        target = (bone_name, data_path, int(curve.array_index))
        if target in curves_by_target:
            raise RuntimeError("Pose Action contains a duplicate bounded FCurve")
        curves_by_target[target] = curve
    expected_order = _expected_pose_curve_order(definition)
    if set(curves_by_target) != set(expected_order):
        raise RuntimeError("Pose Action FCurve target order cannot be reconstructed")
    return tuple(
        (bone_name, data_path, curves_by_target[target])
        for target in expected_order
        for bone_name, data_path, _component_index in (target,)
    )


def _apply_interpolation(
    action: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    writes = []
    order = 0
    for bone_name, data_path, curve in _ordered_pose_curves(action, definition, deps):
        for point in sorted(curve.keyframe_points, key=lambda item: float(item.co[0])):
            before = point.interpolation
            if before != _DEFAULT_INTERPOLATION:
                raise RuntimeError("Pose keyframe interpolation baseline changed")
            point.interpolation = definition.interpolation
            if point.interpolation != definition.interpolation:
                raise RuntimeError("Pose keyframe interpolation write was not observed")
            order += 1
            frame = float(point.co[0])
            writes.append(
                {
                    "order": order,
                    "executionMethod": "blender_rna_keyframe_interpolation_write",
                    "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                    "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[8],
                    "semanticAction": POSE_ANIMATION_OPERATION_IDS[8],
                    "actionArgument": "interpolation",
                    "mutationKind": "keyframe_interpolation_write",
                    "armatureId": definition.armature_id,
                    "actionId": definition.logical_id,
                    "actionName": action.name,
                    "boneName": bone_name,
                    "dataPath": data_path,
                    "componentIndex": int(curve.array_index),
                    "frame": int(round(frame)),
                    "beforeValue": before,
                    "acceptedValue": definition.interpolation,
                    "observedValue": point.interpolation,
                    "observedPointValue": float(point.co[1]),
                    "uiPath": [
                        "Animation",
                        action.name,
                        bone_name,
                        data_path,
                        f"Component {int(curve.array_index)}",
                        f"Frame {int(round(frame))}",
                        "Interpolation",
                    ],
                }
            )
    return tuple(writes)


def _apply_extrapolation(
    action: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    writes = []
    for order, (bone_name, data_path, curve) in enumerate(
        _ordered_pose_curves(action, definition, deps), start=1
    ):
        before = curve.extrapolation
        if before != _DEFAULT_EXTRAPOLATION:
            raise RuntimeError("Pose FCurve extrapolation baseline changed")
        curve.extrapolation = definition.extrapolation
        if curve.extrapolation != definition.extrapolation:
            raise RuntimeError("Pose FCurve extrapolation write was not observed")
        writes.append(
            {
                "order": order,
                "executionMethod": "blender_rna_fcurve_extrapolation_write",
                "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[10],
                "semanticAction": POSE_ANIMATION_OPERATION_IDS[10],
                "actionArgument": "extrapolation",
                "mutationKind": "fcurve_extrapolation_write",
                "armatureId": definition.armature_id,
                "actionId": definition.logical_id,
                "actionName": action.name,
                "boneName": bone_name,
                "dataPath": data_path,
                "componentIndex": int(curve.array_index),
                "beforeValue": before,
                "acceptedValue": definition.extrapolation,
                "observedValue": curve.extrapolation,
                "keyframePointCount": len(curve.keyframe_points),
                "uiPath": [
                    "Animation",
                    action.name,
                    bone_name,
                    data_path,
                    f"Component {int(curve.array_index)}",
                    "Extrapolation",
                ],
            }
        )
    return tuple(writes)


def _fingerprint(armature: Any, action: Any | None, definition: Any, deps: Any) -> str:
    bones = _pose_bones(armature, definition)
    action_state = None
    if action is not None:
        action_state = (
            action.name,
            deps.action_keyframe_signature(action),
            action.get(_INTERPOLATION_MARKER),
            action.get(_EXTRAPOLATION_MARKER),
        )
    return _digest(
        (
            definition.armature_id,
            action_state,
            tuple(
                (name, _pose_state(bones[name], deps))
                for name in sorted(bones)
            ),
        )
    )


def _base_action_absent(armature: Any, definition: Any) -> bool:
    animation_data = armature.animation_data
    assigned = animation_data.action if animation_data is not None else None
    return assigned is None and _bpy().data.actions.get(definition.name) is None


def _validate_stage(
    armature: Any,
    receipt: Any,
    definition: Any,
    completed_operations: tuple[int, ...],
    deps: Any,
) -> Any | None:
    stage = completed_operations[-1] if completed_operations else 0
    bones = _pose_bones(armature, definition)
    if stage < 4:
        if receipt.created or receipt.mutations or not _base_action_absent(
            armature, definition
        ):
            raise RuntimeError("Pose preflight stage contains an Action mutation")
        return None

    action = _current_action(receipt, armature, definition, deps)
    expected_name = _pending_name(receipt.receipt_id) if stage == 4 else definition.name
    if action.name != expected_name:
        raise RuntimeError("Pose Action name changed")
    signature = deps.action_keyframe_signature(action)
    if stage < 7:
        if signature:
            raise RuntimeError("Pose Action contains premature keyframes")
        expected_states = _before_pose_states(receipt)
    else:
        interpolation = (
            definition.interpolation if stage >= 9 else _DEFAULT_INTERPOLATION
        )
        extrapolation = (
            definition.extrapolation if stage >= 11 else _DEFAULT_EXTRAPOLATION
        )
        _validate_curves(
            action,
            armature,
            definition,
            interpolation=interpolation,
            extrapolation=extrapolation,
            deps=deps,
        )
        expected_states = _expected_pose_states(receipt, definition)
    for bone_name, expected in expected_states.items():
        if not _states_close(_pose_state(bones[bone_name], deps), expected):
            raise RuntimeError(f"Pose bone state changed: {bone_name}")
    if (action.get(_INTERPOLATION_MARKER) is not None) is (stage < 9):
        raise RuntimeError("Pose interpolation operation marker changed")
    if stage >= 9 and action.get(_INTERPOLATION_MARKER) != definition.interpolation:
        raise RuntimeError("Pose interpolation operation marker changed")
    if (action.get(_EXTRAPOLATION_MARKER) is not None) is (stage < 11):
        raise RuntimeError("Pose extrapolation operation marker changed")
    if stage >= 11 and action.get(_EXTRAPOLATION_MARKER) != definition.extrapolation:
        raise RuntimeError("Pose extrapolation operation marker changed")
    if _action_mutation(receipt).after != signature:
        raise RuntimeError("Pose partial receipt signature changed")
    return action


def _create_action(
    receipt: Any,
    armature: Any,
    definition: Any,
    deps: Any,
) -> tuple[Any, Any, tuple[dict[str, Any], ...]]:
    bones = _pose_bones(armature, definition)
    created: list[Any] = []
    mutations: list[Any] = []
    animation_data = armature.animation_data
    had_animation_data = animation_data is not None
    before_pose = {name: _pose_state(bone, deps) for name, bone in bones.items()}
    try:
        action = _bpy().data.actions.new(_pending_name(receipt.receipt_id))
        identity = deps.journal_created_resource(
            created,
            action,
            definition.logical_id,
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
        )
        armature.animation_data_create().action = action
        if (
            action.name != _pending_name(receipt.receipt_id)
            or action.bl_rna.identifier != "Action"
            or armature.animation_data.action is not action
        ):
            raise RuntimeError("Pose Action creation or armature binding was not observed")
        for name in bones:
            mutations.append(
                deps.MutationRecord(
                    receipt.anchor,
                    f"pose_bone_state:{name}",
                    before_pose[name],
                    identity,
                )
            )
        mutations.append(
            deps.MutationRecord(
                receipt.anchor,
                "animation_action",
                (had_animation_data, None),
                identity,
            )
        )
        mutations.append(
            deps.MutationRecord(
                identity,
                "action_keyframes",
                None,
                deps.action_keyframe_signature(action),
            )
        )
        updated_receipt = deps.make_receipt(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
            receipt.anchor,
        )
        pending_name = action.name
        resource_mutations = (
            {
                "order": 1,
                "executionMethod": "blender_rna_action_create",
                "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[3],
                "semanticAction": POSE_ANIMATION_OPERATION_IDS[3],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "action_create",
                "armatureId": definition.armature_id,
                "actionId": definition.logical_id,
                "pendingActionName": pending_name,
                "resourceType": action.bl_rna.identifier,
                "observedResource": True,
                "uiPath": ["Animation", pending_name],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_armature_action_bind",
                "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[3],
                "semanticAction": POSE_ANIMATION_OPERATION_IDS[3],
                "valueSource": "managed_receipt_identity",
                "mutationKind": "armature_action_bind",
                "armatureId": definition.armature_id,
                "actionId": definition.logical_id,
                "pendingActionName": pending_name,
                "observedBinding": True,
                "uiPath": [
                    "Animation",
                    definition.armature_id,
                    "Action",
                    pending_name,
                ],
            },
        )
        return updated_receipt, action, resource_mutations
    except Exception:
        deps.rollback_partial(
            receipt.receipt_id,
            receipt.step_id,
            receipt.action_name,
            created,
            mutations,
            [],
        )
        raise


def _rename_action(
    receipt: Any, action: Any, definition: Any, name: str, deps: Any
) -> Any:
    old_identity = _action_identity(receipt, definition)
    action.name = name
    new_identity = replace(old_identity, display_name=action.name)
    return _replace_action_identity(receipt, old_identity, new_identity, deps)


def _restore_pose_states(receipt: Any, armature: Any) -> None:
    for bone_name, state in _before_pose_states(receipt).items():
        bone = armature.pose.bones.get(bone_name)
        if bone is None:
            raise RuntimeError(f"Pose bone is unavailable: {bone_name}")
        bone.rotation_mode = state.rotation_mode
        bone.location = state.location
        bone.rotation_euler = state.rotation_euler
        bone.rotation_quaternion = state.rotation_quaternion
        bone.rotation_axis_angle = state.rotation_axis_angle
        bone.scale = state.scale


def _reset_empty_action(
    receipt: Any, armature: Any, definition: Any, deps: Any
) -> tuple[Any, Any]:
    old_identity = _action_identity(receipt, definition)
    old_action = _current_action(receipt, armature, definition, deps)
    _restore_pose_states(receipt, armature)
    armature.animation_data.action = None
    _bpy().data.actions.remove(old_action)
    replacement = _bpy().data.actions.new(definition.name)
    created: list[Any] = []
    new_identity = deps.journal_created_resource(
        created,
        replacement,
        definition.logical_id,
        receipt.receipt_id,
        receipt.step_id,
        receipt.action_name,
    )
    armature.animation_data.action = replacement
    rebound = _replace_action_identity(receipt, old_identity, new_identity, deps)
    rebound = _replace_action_signature(rebound, replacement, deps)
    return rebound, replacement


def _observed_keyframe_points(
    *,
    action: Any,
    bone: Any,
    data_path: str,
    frame: int,
    accepted_values: tuple[float, ...],
    deps: Any,
) -> tuple[dict[str, Any], ...]:
    curve_data_path = f"{bone.path_from_id()}.{data_path}"
    curves = {
        int(curve.array_index): curve
        for curve in deps.action_fcurves(action)
        if curve.data_path == curve_data_path
    }
    if set(curves) != set(range(len(accepted_values))):
        raise RuntimeError(
            f"Pose keyframe insertion did not create every {data_path} component"
        )
    observed = []
    for component_index, accepted_value in enumerate(accepted_values):
        matching_points = tuple(
            point
            for point in curves[component_index].keyframe_points
            if math.isclose(float(point.co[0]), float(frame), abs_tol=1e-5)
        )
        if len(matching_points) != 1:
            raise RuntimeError(
                f"Pose keyframe insertion did not create one point at frame {frame}"
            )
        point = matching_points[0]
        observed_value = float(point.co[1])
        if not math.isclose(
            observed_value,
            float(accepted_value),
            rel_tol=1e-6,
            abs_tol=1e-6,
        ):
            raise RuntimeError("Pose keyframe insertion changed the accepted value")
        observed.append(
            {
                "componentIndex": component_index,
                "acceptedValue": float(accepted_value),
                "observedFrame": float(point.co[0]),
                "observedValue": observed_value,
            }
        )
    return tuple(observed)


def _insert_keyframes(
    armature: Any, action: Any, definition: Any, deps: Any
) -> tuple[dict[str, Any], ...]:
    bones = _pose_bones(armature, definition)
    insertions = []
    order = 0
    for frame_order, keyframe in enumerate(definition.keyframes, start=1):
        for pose_order, pose in enumerate(keyframe.poses, start=1):
            bone = bones[pose.bone_name]
            if pose.rotation_euler is not None:
                path = "rotation_euler"
                rotation_values = pose.rotation_euler
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = pose.rotation_euler
            elif pose.rotation_quaternion is not None:
                path = "rotation_quaternion"
                rotation_values = pose.rotation_quaternion
                bone.rotation_mode = "QUATERNION"
                bone.rotation_quaternion = pose.rotation_quaternion
            else:
                path = "rotation_axis_angle"
                rotation_values = pose.rotation_axis_angle
                bone.rotation_mode = "AXIS_ANGLE"
                bone.rotation_axis_angle = pose.rotation_axis_angle
            channels = [(path, rotation_values)]
            if pose.location is not None:
                bone.location = pose.location
                channels.append(("location", pose.location))
            if pose.scale is not None:
                bone.scale = pose.scale
                channels.append(("scale", pose.scale))
            for channel_order, (channel, values) in enumerate(channels, start=1):
                if not bone.keyframe_insert(
                    data_path=channel,
                    frame=keyframe.frame,
                    group=pose.bone_name,
                ):
                    raise RuntimeError(
                        f"Blender rejected {channel} keyframe {keyframe.frame} "
                        f"for {pose.bone_name}"
                    )
                order += 1
                accepted_values = tuple(float(value) for value in values)
                insertions.append(
                    {
                        "order": order,
                        "frameOrder": frame_order,
                        "poseOrder": pose_order,
                        "channelOrder": channel_order,
                        "executionMethod": "blender_rna_pose_bone_keyframe_insert",
                        "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                        "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[6],
                        "semanticAction": POSE_ANIMATION_OPERATION_IDS[6],
                        "actionArgument": "keyframes",
                        "armatureId": definition.armature_id,
                        "actionId": definition.logical_id,
                        "actionName": action.name,
                        "frame": int(keyframe.frame),
                        "boneName": pose.bone_name,
                        "dataPath": channel,
                        "acceptedValues": list(accepted_values),
                        "observedPoints": list(
                            _observed_keyframe_points(
                                action=action,
                                bone=bone,
                                data_path=channel,
                                frame=keyframe.frame,
                                accepted_values=accepted_values,
                                deps=deps,
                            )
                        ),
                        "observedInserted": True,
                        "uiPath": [
                            "Animation",
                            action.name,
                            pose.bone_name,
                            channel,
                            f"Frame {keyframe.frame}",
                        ],
                    }
                )
    return tuple(insertions)


def _observation(
    *,
    ordinal: int,
    direction: str,
    receipt: Any,
    before: str,
    after: str,
    action: Any | None,
    definition: Any,
    completed: tuple[int, ...],
    deps: Any,
    rna_keyframe_insertions: tuple[dict[str, Any], ...] = (),
    rna_animation_property_writes: tuple[dict[str, Any], ...] = (),
    rna_action_resource_mutations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    curves = () if action is None else deps.action_fcurves(action)
    return {
        "kind": "guided_pose_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": direction,
            "operationOrdinal": ordinal,
            "operationId": POSE_ANIMATION_OPERATION_IDS[ordinal - 1],
            "mutating": ordinal in POSE_ANIMATION_MUTATING_ORDINALS,
            "receiptId": receipt.receipt_id,
            "stepId": receipt.step_id,
            "actionName": receipt.action_name,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(completed),
                "preconditionsValidated": ordinal == 1,
                "completeAnimation": ordinal == len(POSE_ANIMATION_OPERATION_IDS),
                "stage": min(ordinal, 11),
                "armatureId": definition.armature_id,
                "actionId": definition.logical_id if ordinal >= 4 else None,
                "actionNameApplied": ordinal >= 5,
                "resolvedActionName": definition.name if ordinal >= 5 else None,
                "curveCount": len(curves),
                "keyframePointCount": sum(
                    len(curve.keyframe_points) for curve in curves
                ),
                "interpolationApplied": ordinal >= 9,
                "extrapolationApplied": ordinal >= 11,
                "rnaKeyframeInsertions": list(rna_keyframe_insertions),
                "rnaAnimationPropertyWrites": list(
                    rna_animation_property_writes
                ),
                "rnaActionResourceMutations": list(
                    rna_action_resource_mutations
                ),
            },
        },
    }


def resume_pose_animation_transaction(
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
    if receipt is None or not isinstance(fingerprint, str) or len(fingerprint) != 64:
        raise ValueError("A resumed Pose transaction requires its receipt and fingerprint")
    return GuidedGeometryTransaction(
        receipt,
        completed_operations,
        fingerprint,
        _definition_fingerprint(definition),
    )


def _validate_transaction(
    transaction: GuidedGeometryTransaction,
    receipt_id: str,
    step_id: str,
    action_name: str,
    completed_operations: tuple[int, ...],
    receipts: Mapping[str, Any],
    definition: Any,
    deps: Any,
) -> tuple[Any, Any | None]:
    if (
        transaction.completed_operations != completed_operations
        or transaction.definition_fingerprint != _definition_fingerprint(definition)
        or transaction.receipt.receipt_id != receipt_id
        or transaction.receipt.step_id != step_id
        or transaction.receipt.action_name != action_name
    ):
        raise RuntimeError("Guided Pose transaction binding changed")
    deps.ensure_receipts_intact(receipts)
    _identity, armature = _owned_armature(receipts, definition, deps)
    action = _validate_stage(
        armature, transaction.receipt, definition, completed_operations, deps
    )
    if _fingerprint(armature, action, definition, deps) != transaction.fingerprint:
        raise RuntimeError("Guided Pose transaction fingerprint changed")
    return armature, action


def verify_pose_animation_stage(
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
    deps = _dependencies()
    rebound_receipts = receipts
    rebound_partial = partial_receipt
    if rebind_after_native_restore:
        rebound_receipts = deps.rebind_receipts_after_native_restore(receipts)
        if partial_receipt is not None:
            rebound_partial = deps.rebind_receipts_after_native_restore(
                {"guided-partial": partial_receipt}
            )["guided-partial"]
    _identity, armature = _owned_armature(rebound_receipts, definition, deps)
    receipt_required = any(
        ordinal in POSE_ANIMATION_MUTATING_ORDINALS
        for ordinal in completed_operations
    )
    if not receipt_required:
        if rebound_partial is not None or not _base_action_absent(armature, definition):
            raise RuntimeError("Pose pre-mutation stage changed")
        action = None
    else:
        if rebound_partial is None:
            raise RuntimeError("Pose partial receipt is unavailable")
        transaction = GuidedGeometryTransaction(
            rebound_partial,
            completed_operations,
            expected_fingerprint,
            _definition_fingerprint(definition),
        )
        _armature, action = _validate_transaction(
            transaction,
            receipt_id,
            step_id,
            action_name,
            completed_operations,
            rebound_receipts,
            definition,
            deps,
        )
    if _fingerprint(armature, action, definition, deps) != expected_fingerprint:
        raise RuntimeError("Pose stage fingerprint changed")
    return True


def execute_pose_animation_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction | None = None,
) -> GuidedGeometryOperationResult:
    if action_name != POSE_ANIMATION_ACTION:
        raise ValueError(f"Unsupported guided Pose action: {action_name}")
    if not 1 <= operation_ordinal <= len(POSE_ANIMATION_OPERATION_IDS):
        raise ValueError("operation_ordinal must be in [1, 12]")
    deps = _dependencies()
    expected_completed = tuple(range(1, operation_ordinal))
    if transaction is None:
        if operation_ordinal != 1:
            raise RuntimeError("Guided Pose operation 01 must start the transaction")
        armature_identity, armature = _owned_armature(receipts, definition, deps)
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, armature_identity, deps
        )
        action = None
        before = _fingerprint(armature, None, definition, deps)
    else:
        armature, action = _validate_transaction(
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
    rna_keyframe_insertions: tuple[dict[str, Any], ...] = ()
    rna_animation_property_writes: tuple[dict[str, Any], ...] = ()
    rna_action_resource_mutations: tuple[dict[str, Any], ...] = ()

    try:
        if operation_ordinal == 1:
            _preflight(armature, receipts, definition, receipt_id, deps)
        elif operation_ordinal in {2, 3, 6, 8, 10, 12}:
            _validate_stage(armature, receipt, definition, expected_completed, deps)
        elif operation_ordinal == 4:
            _preflight(armature, receipts, definition, receipt_id, deps)
            receipt, action, rna_action_resource_mutations = _create_action(
                receipt, armature, definition, deps
            )
        elif operation_ordinal == 5:
            deps.ensure_name_available(_bpy().data.actions, definition.name, "action")
            before_name = action.name
            receipt = _rename_action(
                receipt, action, definition, definition.name, deps
            )
            if action.name != definition.name:
                raise RuntimeError("Pose Action name write was not observed")
            rna_action_resource_mutations = (
                {
                    "order": 1,
                    "executionMethod": "blender_rna_action_name_write",
                    "mcpTool": _POSE_ANIMATION_EXECUTE_TOOL,
                    "sourceOperationId": POSE_ANIMATION_OPERATION_IDS[4],
                    "semanticAction": POSE_ANIMATION_OPERATION_IDS[4],
                    "actionArgument": "actionName",
                    "mutationKind": "action_name_write",
                    "armatureId": definition.armature_id,
                    "actionId": definition.logical_id,
                    "beforeName": before_name,
                    "acceptedName": definition.name,
                    "observedName": action.name,
                    "uiPath": ["Animation", action.name, "Name"],
                },
            )
        elif operation_ordinal == 7:
            try:
                rna_keyframe_insertions = _insert_keyframes(
                    armature, action, definition, deps
                )
                receipt = _replace_action_signature(receipt, action, deps)
            except Exception:
                receipt, action = _reset_empty_action(
                    receipt, armature, definition, deps
                )
                raise
        elif operation_ordinal == 9:
            rna_animation_property_writes = _apply_interpolation(
                action, definition, deps
            )
            action[_INTERPOLATION_MARKER] = definition.interpolation
            receipt = _replace_action_signature(receipt, action, deps)
        elif operation_ordinal == 11:
            rna_animation_property_writes = _apply_extrapolation(
                action, definition, deps
            )
            action[_EXTRAPOLATION_MARKER] = definition.extrapolation
            receipt = _replace_action_signature(receipt, action, deps)
        completed = (*expected_completed, operation_ordinal)
        action = _validate_stage(armature, receipt, definition, completed, deps)
    except GuidedGeometryAtomicityError:
        raise
    except Exception as error:
        try:
            if operation_ordinal == 4 and receipt.created:
                deps.rollback_receipt(receipt, allow_incomplete=True)
            elif operation_ordinal == 5 and action is not None:
                receipt = _rename_action(
                    receipt,
                    action,
                    definition,
                    _pending_name(receipt_id),
                    deps,
                )
            elif operation_ordinal == 9 and action is not None:
                for curve in deps.action_fcurves(action):
                    for point in curve.keyframe_points:
                        point.interpolation = _DEFAULT_INTERPOLATION
                if _INTERPOLATION_MARKER in action:
                    del action[_INTERPOLATION_MARKER]
                receipt = _replace_action_signature(receipt, action, deps)
            elif operation_ordinal == 11 and action is not None:
                for curve in deps.action_fcurves(action):
                    curve.extrapolation = _DEFAULT_EXTRAPOLATION
                if _EXTRAPOLATION_MARKER in action:
                    del action[_EXTRAPOLATION_MARKER]
                receipt = _replace_action_signature(receipt, action, deps)
            _validate_stage(
                armature, receipt, definition, expected_completed, deps
            )
            restored_action = (
                None
                if operation_ordinal == 4
                else _validate_stage(
                    armature, receipt, definition, expected_completed, deps
                )
            )
            if _fingerprint(armature, restored_action, definition, deps) != before:
                raise RuntimeError("Pose compensation fingerprint changed")
        except Exception as recovery_error:
            raise GuidedGeometryAtomicityError(
                f"Guided Pose forward operation {operation_ordinal:02d} failed and rollback failed"
            ) from recovery_error
        raise error

    after = _fingerprint(armature, action, definition, deps)
    completed = (*expected_completed, operation_ordinal)
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, _definition_fingerprint(definition)
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            ordinal=operation_ordinal,
            direction="forward",
            receipt=receipt,
            before=before,
            after=after,
            action=action,
            definition=definition,
            completed=completed,
            deps=deps,
            rna_keyframe_insertions=rna_keyframe_insertions,
            rna_animation_property_writes=rna_animation_property_writes,
            rna_action_resource_mutations=rna_action_resource_mutations,
        ),
        before,
        after,
    )


def inverse_pose_animation_operation(
    *,
    operation_ordinal: int,
    receipt_id: str,
    step_id: str,
    action_name: str,
    receipts: Mapping[str, Any],
    definition: Any,
    transaction: GuidedGeometryTransaction,
) -> GuidedGeometryOperationResult:
    if action_name != POSE_ANIMATION_ACTION:
        raise ValueError(f"Unsupported guided Pose action: {action_name}")
    if (
        not transaction.completed_operations
        or transaction.completed_operations[-1] != operation_ordinal
    ):
        raise RuntimeError("Guided Pose inverse must target the latest operation")
    deps = _dependencies()
    armature, action = _validate_transaction(
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
    if operation_ordinal == 11:
        for curve in deps.action_fcurves(action):
            curve.extrapolation = _DEFAULT_EXTRAPOLATION
        del action[_EXTRAPOLATION_MARKER]
        receipt = _replace_action_signature(receipt, action, deps)
    elif operation_ordinal == 9:
        for curve in deps.action_fcurves(action):
            for point in curve.keyframe_points:
                point.interpolation = _DEFAULT_INTERPOLATION
        del action[_INTERPOLATION_MARKER]
        receipt = _replace_action_signature(receipt, action, deps)
    elif operation_ordinal == 7:
        receipt, action = _reset_empty_action(receipt, armature, definition, deps)
    elif operation_ordinal == 5:
        receipt = _rename_action(
            receipt,
            action,
            definition,
            _pending_name(receipt_id),
            deps,
        )
    elif operation_ordinal == 4:
        deps.rollback_receipt(receipt, allow_incomplete=True)
        receipt = _empty_receipt(
            receipt_id, step_id, action_name, transaction.receipt.anchor, deps
        )
        action = None
    completed = transaction.completed_operations[:-1]
    action = _validate_stage(armature, receipt, definition, completed, deps)
    after = _fingerprint(armature, action, definition, deps)
    result_transaction = GuidedGeometryTransaction(
        receipt, completed, after, transaction.definition_fingerprint
    )
    return GuidedGeometryOperationResult(
        result_transaction,
        _observation(
            ordinal=operation_ordinal,
            direction="inverse",
            receipt=receipt,
            before=before,
            after=after,
            action=action,
            definition=definition,
            completed=completed,
            deps=deps,
        ),
        before,
        after,
    )


__all__ = (
    "POSE_ANIMATION_ACTION",
    "POSE_ANIMATION_MUTATING_ORDINALS",
    "POSE_ANIMATION_OPERATION_IDS",
    "execute_pose_animation_operation",
    "inverse_pose_animation_operation",
    "resume_pose_animation_transaction",
    "verify_pose_animation_stage",
)
