"""Real-Blender proof for the 12-step Pose Animation executor."""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path
import struct
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"

CONTROL_ID = "guided.pose.control"
ARMATURE_ID = "guided.pose.armature"
ACTION_ID = "guided.pose.action"
ACTION_NAME = "OperatingLine.GuidedPoseAction"
ROOT_BONE = "OperatingLine.GuidedRoot"
TIP_BONE = "OperatingLine.GuidedTip"
AXIS_BONE = "OperatingLine.GuidedAxis"
STEP_ID = "guided.pose.animation"

ARMATURE_ARGUMENTS = {
    "armatureId": ARMATURE_ID,
    "objectName": "OperatingLine.GuidedPoseRig",
    "dataName": "OperatingLine.GuidedPoseRigData",
    "collectionId": "snowman.collection",
    "bones": [
        {
            "boneName": ROOT_BONE,
            "head": [0.0, 0.0, 0.0],
            "tail": [0.0, 0.0, 1.0],
            "parentName": None,
        },
        {
            "boneName": TIP_BONE,
            "head": [0.0, 0.0, 1.0],
            "tail": [0.0, 0.0, 2.0],
            "parentName": ROOT_BONE,
        },
        {
            "boneName": AXIS_BONE,
            "head": [0.0, 0.0, 2.0],
            "tail": [0.0, 0.0, 3.0],
            "parentName": TIP_BONE,
        },
    ],
    "bindings": [{"targetId": CONTROL_ID, "boneName": ROOT_BONE}],
}

ANIMATION_ARGUMENTS = {
    "actionId": ACTION_ID,
    "actionName": ACTION_NAME,
    "armatureId": ARMATURE_ID,
    "interpolation": "LINEAR",
    "extrapolation": "LINEAR",
    "keyframes": [
        {
            "frame": 1,
            "poses": [
                {
                    "boneName": ROOT_BONE,
                    "rotationEuler": [0.0, 0.0, 0.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
                {
                    "boneName": TIP_BONE,
                    "rotationQuaternion": [1.0, 0.0, 0.0, 0.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
                {
                    "boneName": AXIS_BONE,
                    "rotationAxisAngle": [0.0, 0.0, 0.0, 1.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
            ],
        },
        {
            "frame": 10,
            "poses": [
                {
                    "boneName": ROOT_BONE,
                    "rotationEuler": [0.0, 0.0, 0.2],
                    "location": [0.1, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
                {
                    "boneName": TIP_BONE,
                    "rotationQuaternion": [
                        math.cos(0.3),
                        0.0,
                        math.sin(0.3),
                        0.0,
                    ],
                    "location": [0.0, 0.15, 0.0],
                    "scale": [1.0, 1.1, 1.0],
                },
                {
                    "boneName": AXIS_BONE,
                    "rotationAxisAngle": [0.5, 0.0, 0.0, 1.0],
                    "location": [0.0, 0.0, 0.1],
                    "scale": [1.1, 1.0, 1.0],
                },
            ],
        },
        {
            "frame": 20,
            "poses": [
                {
                    "boneName": ROOT_BONE,
                    "rotationEuler": [0.0, 0.0, 0.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
                {
                    "boneName": TIP_BONE,
                    "rotationQuaternion": [1.0, 0.0, 0.0, 0.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
                {
                    "boneName": AXIS_BONE,
                    "rotationAxisAngle": [0.0, 0.0, 0.0, 1.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                },
            ],
        },
    ],
}


def _float32(value: float) -> float:
    return struct.unpack("f", struct.pack("f", float(value)))[0]


def _expected_rna_keyframe_insertions(ordinal: int) -> list[dict]:
    if ordinal != 7:
        return []
    insertions = []
    order = 0
    for frame_order, keyframe in enumerate(
        ANIMATION_ARGUMENTS["keyframes"], start=1
    ):
        for pose_order, pose in enumerate(keyframe["poses"], start=1):
            if "rotationEuler" in pose:
                rotation_path = "rotation_euler"
                rotation_values = pose["rotationEuler"]
            elif "rotationQuaternion" in pose:
                rotation_path = "rotation_quaternion"
                rotation_values = pose["rotationQuaternion"]
            else:
                rotation_path = "rotation_axis_angle"
                rotation_values = pose["rotationAxisAngle"]
            channels = [(rotation_path, rotation_values)]
            if "location" in pose:
                channels.append(("location", pose["location"]))
            if "scale" in pose:
                channels.append(("scale", pose["scale"]))
            for channel_order, (data_path, values) in enumerate(
                channels, start=1
            ):
                order += 1
                insertions.append(
                    {
                        "order": order,
                        "frameOrder": frame_order,
                        "poseOrder": pose_order,
                        "channelOrder": channel_order,
                        "executionMethod": "blender_rna_pose_bone_keyframe_insert",
                        "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                        "sourceOperationId": "projection.semantic.pose_animation.keyframes",
                        "semanticAction": "projection.semantic.pose_animation.keyframes",
                        "actionArgument": "keyframes",
                        "armatureId": ARMATURE_ID,
                        "actionId": ACTION_ID,
                        "actionName": ACTION_NAME,
                        "frame": keyframe["frame"],
                        "boneName": pose["boneName"],
                        "dataPath": data_path,
                        "acceptedValues": [float(value) for value in values],
                        "observedPoints": [
                            {
                                "componentIndex": component_index,
                                "acceptedValue": float(value),
                                "observedFrame": float(keyframe["frame"]),
                                "observedValue": _float32(value),
                            }
                            for component_index, value in enumerate(values)
                        ],
                        "observedInserted": True,
                        "uiPath": [
                            "Animation",
                            ACTION_NAME,
                            pose["boneName"],
                            data_path,
                            f"Frame {keyframe['frame']}",
                        ],
                    }
                )
    return insertions


def _expected_pose_curves() -> dict[tuple[str, str, int], list[tuple[int, float]]]:
    curves: dict[tuple[str, str, int], list[tuple[int, float]]] = {}
    for keyframe in ANIMATION_ARGUMENTS["keyframes"]:
        for pose in keyframe["poses"]:
            if "rotationEuler" in pose:
                rotation_path = "rotation_euler"
                rotation_values = pose["rotationEuler"]
            elif "rotationQuaternion" in pose:
                rotation_path = "rotation_quaternion"
                rotation_values = pose["rotationQuaternion"]
            else:
                rotation_path = "rotation_axis_angle"
                rotation_values = pose["rotationAxisAngle"]
            channels = [(rotation_path, rotation_values)]
            if "location" in pose:
                channels.append(("location", pose["location"]))
            if "scale" in pose:
                channels.append(("scale", pose["scale"]))
            for data_path, values in channels:
                for component_index, value in enumerate(values):
                    curves.setdefault(
                        (pose["boneName"], data_path, component_index), []
                    ).append((keyframe["frame"], float(value)))
    return curves


def _expected_rna_animation_property_writes(ordinal: int) -> list[dict]:
    if ordinal not in {9, 11}:
        return []
    writes = []
    curves = _expected_pose_curves()
    for (bone_name, data_path, component_index), points in curves.items():
        if ordinal == 9:
            for frame, value in points:
                writes.append(
                    {
                        "order": len(writes) + 1,
                        "executionMethod": "blender_rna_keyframe_interpolation_write",
                        "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                        "sourceOperationId": "projection.semantic.pose_animation.interpolation",
                        "semanticAction": "projection.semantic.pose_animation.interpolation",
                        "actionArgument": "interpolation",
                        "mutationKind": "keyframe_interpolation_write",
                        "armatureId": ARMATURE_ID,
                        "actionId": ACTION_ID,
                        "actionName": ACTION_NAME,
                        "boneName": bone_name,
                        "dataPath": data_path,
                        "componentIndex": component_index,
                        "frame": frame,
                        "beforeValue": "BEZIER",
                        "acceptedValue": ANIMATION_ARGUMENTS["interpolation"],
                        "observedValue": ANIMATION_ARGUMENTS["interpolation"],
                        "observedPointValue": _float32(value),
                        "uiPath": [
                            "Animation",
                            ACTION_NAME,
                            bone_name,
                            data_path,
                            f"Component {component_index}",
                            f"Frame {frame}",
                            "Interpolation",
                        ],
                    }
                )
        else:
            writes.append(
                {
                    "order": len(writes) + 1,
                    "executionMethod": "blender_rna_fcurve_extrapolation_write",
                    "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                    "sourceOperationId": "projection.semantic.pose_animation.extrapolation",
                    "semanticAction": "projection.semantic.pose_animation.extrapolation",
                    "actionArgument": "extrapolation",
                    "mutationKind": "fcurve_extrapolation_write",
                    "armatureId": ARMATURE_ID,
                    "actionId": ACTION_ID,
                    "actionName": ACTION_NAME,
                    "boneName": bone_name,
                    "dataPath": data_path,
                    "componentIndex": component_index,
                    "beforeValue": "CONSTANT",
                    "acceptedValue": ANIMATION_ARGUMENTS["extrapolation"],
                    "observedValue": ANIMATION_ARGUMENTS["extrapolation"],
                    "keyframePointCount": len(points),
                    "uiPath": [
                        "Animation",
                        ACTION_NAME,
                        bone_name,
                        data_path,
                        f"Component {component_index}",
                        "Extrapolation",
                    ],
                }
            )
    return writes


def _expected_rna_action_resource_mutations(
    ordinal: int, receipt_id: str
) -> list[dict]:
    pending_name = f"OperatingLine.PendingPose.{receipt_id[:8]}"
    if ordinal == 4:
        return [
            {
                "order": 1,
                "executionMethod": "blender_rna_action_create",
                "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                "sourceOperationId": "semantic.create_pose_action",
                "semanticAction": "semantic.create_pose_action",
                "valueSource": "managed_receipt_identity",
                "mutationKind": "action_create",
                "armatureId": ARMATURE_ID,
                "actionId": ACTION_ID,
                "pendingActionName": pending_name,
                "resourceType": "Action",
                "observedResource": True,
                "uiPath": ["Animation", pending_name],
            },
            {
                "order": 2,
                "executionMethod": "blender_rna_armature_action_bind",
                "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                "sourceOperationId": "semantic.create_pose_action",
                "semanticAction": "semantic.create_pose_action",
                "valueSource": "managed_receipt_identity",
                "mutationKind": "armature_action_bind",
                "armatureId": ARMATURE_ID,
                "actionId": ACTION_ID,
                "pendingActionName": pending_name,
                "observedBinding": True,
                "uiPath": ["Animation", ARMATURE_ID, "Action", pending_name],
            },
        ]
    if ordinal == 5:
        return [
            {
                "order": 1,
                "executionMethod": "blender_rna_action_name_write",
                "mcpTool": "operatingline.blender.animation.pose-keyframes.execute-next",
                "sourceOperationId": "projection.semantic.pose_animation.action_name",
                "semanticAction": "projection.semantic.pose_animation.action_name",
                "actionArgument": "actionName",
                "mutationKind": "action_name_write",
                "armatureId": ARMATURE_ID,
                "actionId": ACTION_ID,
                "beforeName": pending_name,
                "acceptedName": ACTION_NAME,
                "observedName": ACTION_NAME,
                "uiPath": ["Animation", ACTION_NAME, "Name"],
            }
        ]
    return []


def _step(
    step_id: str,
    order: int,
    action: dict | None,
    *,
    depends_on: list[str] | None = None,
    expected_observations: list[dict] | None = None,
) -> dict:
    result = {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": action,
    }
    if expected_observations is not None:
        result["expectedObservations"] = expected_observations
        result["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
    return result


PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "guided.pose.control",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": CONTROL_ID,
                    "objectName": "OperatingLine.GuidedPoseControl",
                    "size": 0.25,
                    "location": [-2.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "guided.pose.rig",
            2,
            {
                "adapterId": "blender",
                "name": "blender.rig.create_armature",
                "arguments": ARMATURE_ARGUMENTS,
            },
            depends_on=["guided.pose.control"],
        ),
        _step(
            STEP_ID,
            3,
            {
                "adapterId": "blender",
                "name": "blender.animation.create_pose_keyframes",
                "arguments": ANIMATION_ARGUMENTS,
            },
            depends_on=["guided.pose.rig"],
            expected_observations=[
                {
                    "kind": "pose_animation_ready",
                    "parameters": ANIMATION_ARGUMENTS,
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_pose_integration",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _record(session, step, run, operation_ids, ordinal, result):
    return session.record_leaf_operation(
        step,
        run_id=run.run_id,
        operation_id=operation_ids[ordinal - 1],
        ordinal=ordinal,
        before_sha256=result.before_fingerprint,
        after_sha256=result.after_fingerprint,
        observation=result.observation,
        partial_action_receipt=None if ordinal < 4 else result.receipt,
    )


def _execute_all(session, step, snapshot, definition, operations):
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 13):
        result = operations.execute_pose_animation_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        run = _record(session, step, run, operation_ids, ordinal, result)
        mutating = ordinal in operations.POSE_ANIMATION_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        evidence = result.observation["details"]["evidence"]
        assert evidence["rnaKeyframeInsertions"] == (
            _expected_rna_keyframe_insertions(ordinal)
        )
        assert evidence["rnaAnimationPropertyWrites"] == (
            _expected_rna_animation_property_writes(ordinal)
        )
        assert evidence["rnaActionResourceMutations"] == (
            _expected_rna_action_resource_mutations(
                ordinal, result.receipt.receipt_id
            )
        )
        if ordinal == 7:
            assert len(evidence["rnaKeyframeInsertions"]) == 27
            assert (
                sum(
                    len(insertion["observedPoints"])
                    for insertion in evidence["rnaKeyframeInsertions"]
                )
                == 87
            )
        if ordinal == 9:
            assert len(evidence["rnaAnimationPropertyWrites"]) == 87
        if ordinal == 11:
            assert len(evidence["rnaAnimationPropertyWrites"]) == 29
        assert operations.verify_pose_animation_stage(
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=run.partial_action_receipt,
        )
        if ordinal in {5, 7, 9, 11, 12}:
            inverse = operations.inverse_pose_animation_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = inverse.transaction
            run = session.rewind_leaf_operation(
                step,
                run_id=run.run_id,
                operation_id=operation_ids[ordinal - 1],
                ordinal=ordinal,
                partial_action_receipt=inverse.receipt,
            )
            replay = operations.execute_pose_animation_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = replay.transaction
            run = _record(session, step, run, operation_ids, ordinal, replay)
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_pose_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_pose_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_pose_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_pose_integration.operating_line.infrastructure import (
        guided_pose_animation_operations as operations,
    )
    from operating_line_guided_pose_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_pose_integration.operating_line.infrastructure.snowman_actions.common import (
        action_fcurves,
    )
    from operating_line_guided_pose_integration.operating_line.infrastructure.snowman_actions.rigging import (
        validate_pose_animation,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-pose-animation-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "guided.pose.control"
    assert session.next().id == "guided.pose.rig"
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.animation.create_pose_keyframes.semantic"
    assert snapshot.catalog_version == "1.69.0"
    assert tuple(
        operation.operation_id for operation in snapshot.operations
    ) == operations.POSE_ANIMATION_OPERATION_IDS
    definition = validate_pose_animation(step.action.arguments)

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    action = bpy.data.actions[ACTION_NAME]
    curves = action_fcurves(action)
    assert len(curves) == 29
    assert sum(len(curve.keyframe_points) for curve in curves) == 87
    assert all(curve.extrapolation == "LINEAR" for curve in curves)
    assert all(
        point.interpolation == "LINEAR"
        for curve in curves
        for point in curve.keyframe_points
    )

    for ordinal in range(12, 0, -1):
        inverse = operations.inverse_pose_animation_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = inverse.transaction
        run = session.rewind_leaf_operation(
            step,
            run_id=run.run_id,
            operation_id=operation_ids[ordinal - 1],
            ordinal=ordinal,
            partial_action_receipt=(None if ordinal <= 4 else inverse.receipt),
        )
        if ordinal == 1:
            break
    assert transaction.completed_operations == ()
    assert bpy.data.actions.get(ACTION_NAME) is None
    assert session.pending_leaf_operation_run is None

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 12
    assert session.receipts[step.id] == partial_receipt
    observations = session.success_gate_observation_copy(step.id)
    assert observations is not None and observations[0]["satisfied"] is True
    assert observations[0]["kind"] == "pose_animation_ready"
    assert observations[0]["details"]["curveCount"] == 29

    assert session.back() is step
    assert bpy.data.actions.get(ACTION_NAME) is None
    print(
        "OperatingLine guided Pose proof passed: "
        "12 forward + 12 inverse + replay + completion",
        bpy.app.version_string,
        flush=True,
    )


try:
    main()
except BaseException:
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    raise
