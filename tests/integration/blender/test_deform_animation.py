"""Real Blender coverage for explicit skin weights and pose transform clips."""

from copy import deepcopy
import importlib.util
import math
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_deform_animation_extension",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_deform_animation_extension.operating_line.application import (  # noqa: E402
    DemoSession,
)
from operating_line_deform_animation_extension.operating_line.domain import (  # noqa: E402
    load_task_tree_data,
)
from operating_line_deform_animation_extension.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    build_resource_registry,
    resolve_resource,
)
from operating_line_deform_animation_extension.operating_line.infrastructure.observations import (  # noqa: E402
    evaluate_observations,
)
from operating_line_deform_animation_extension.operating_line.infrastructure.snowman_actions import (  # noqa: E402
    rigging as rigging_actions,
)
from operating_line_deform_animation_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    OWNER_KEY,
    OWNER_VALUE,
    action_fcurves,
    ensure_receipts_intact,
)


ROOT_BONE = "OperatingLine.DeformRoot"
TIP_BONE = "OperatingLine.DeformTip"
AXIS_BONE = "OperatingLine.DeformAxis"


def step(
    step_id: str,
    order: int,
    action_name: str | None,
    arguments: dict | None = None,
) -> dict:
    return {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": [] if order <= 1 else [PLAN_STEPS[order - 1]],
        "title": step_id,
        "action": (
            None
            if action_name is None
            else {
                "adapterId": "blender",
                "name": action_name,
                "arguments": arguments,
            }
        ),
    }


PLAN_STEPS = (
    "root",
    "deform.geometry.target",
    "deform.geometry.control",
    "deform.rig",
    "deform.skin",
    "deform.animation",
)


WEIGHTS = [
    {"vertexIndex": 0, "influences": [{"boneName": ROOT_BONE, "weight": 1.0}]},
    {"vertexIndex": 1, "influences": [{"boneName": ROOT_BONE, "weight": 1.0}]},
    {
        "vertexIndex": 2,
        "influences": [
            {"boneName": ROOT_BONE, "weight": 0.75},
            {"boneName": TIP_BONE, "weight": 0.25},
        ],
    },
    {
        "vertexIndex": 3,
        "influences": [
            {"boneName": ROOT_BONE, "weight": 0.75},
            {"boneName": TIP_BONE, "weight": 0.25},
        ],
    },
    {
        "vertexIndex": 4,
        "influences": [
            {"boneName": ROOT_BONE, "weight": 0.25},
            {"boneName": TIP_BONE, "weight": 0.25},
            {"boneName": AXIS_BONE, "weight": 0.5},
        ],
    },
    {
        "vertexIndex": 5,
        "influences": [
            {"boneName": ROOT_BONE, "weight": 0.25},
            {"boneName": TIP_BONE, "weight": 0.25},
            {"boneName": AXIS_BONE, "weight": 0.5},
        ],
    },
    {"vertexIndex": 6, "influences": [{"boneName": AXIS_BONE, "weight": 1.0}]},
    {"vertexIndex": 7, "influences": [{"boneName": AXIS_BONE, "weight": 1.0}]},
]


ARMATURE_ARGUMENTS = {
    "armatureId": "deform.armature",
    "objectName": "OperatingLine.Rig.Deform",
    "dataName": "OperatingLine.Rig.DeformData",
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
    "bindings": [{"targetId": "deform.control", "boneName": ROOT_BONE}],
}


SKIN_ARGUMENTS = {
    "targetId": "deform.target",
    "armatureId": "deform.armature",
    "modifierId": "deform.skin.modifier",
    "modifierName": "OperatingLine.DeformArmature",
    "preserveVolume": True,
    "weights": WEIGHTS,
}


ANIMATION_ARGUMENTS = {
    "actionId": "deform.animation.action",
    "actionName": "OperatingLine.Action.DeformWave",
    "armatureId": "deform.armature",
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
                    "rotationEuler": [0.0, 0.0, 0.15],
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
                    "scale": [1.0, 1.15, 1.0],
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


def plan() -> dict:
    return {
        "rootStepId": "root",
        "steps": [
            step("root", 0, None),
            step(
                "deform.geometry.target",
                1,
                "blender.mesh.create_cube",
                {
                    "resourceId": "deform.target",
                    "objectName": "OperatingLine.DeformTarget",
                    "size": 2.0,
                    "location": [0.0, 0.0, 1.0],
                },
            ),
            step(
                "deform.geometry.control",
                2,
                "blender.mesh.create_cube",
                {
                    "resourceId": "deform.control",
                    "objectName": "OperatingLine.DeformControl",
                    "size": 0.25,
                    "location": [-2.0, 0.0, 0.0],
                },
            ),
            step(
                "deform.rig",
                3,
                "blender.rig.create_armature",
                ARMATURE_ARGUMENTS,
            ),
            step(
                "deform.skin",
                4,
                "blender.rig.bind_skin_weights",
                SKIN_ARGUMENTS,
            ),
            step(
                "deform.animation",
                5,
                "blender.animation.create_pose_keyframes",
                ANIMATION_ARGUMENTS,
            ),
        ],
    }


def evaluated_coordinates(target: bpy.types.Object) -> tuple[tuple[float, float, float], ...]:
    dependency_graph = bpy.context.evaluated_depsgraph_get()
    evaluated = target.evaluated_get(dependency_graph)
    mesh = evaluated.to_mesh()
    try:
        return tuple(tuple(float(value) for value in vertex.co) for vertex in mesh.vertices)
    finally:
        evaluated.to_mesh_clear()


def owned_resources() -> list[object]:
    collections = (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.collections,
        bpy.data.armatures,
        bpy.data.actions,
    )
    return [
        resource
        for resources in collections
        for resource in resources
        if resource.get(OWNER_KEY) == OWNER_VALUE
    ]


def assert_validation_boundaries() -> None:
    assert rigging_actions.validate_skin_weights(SKIN_ARGUMENTS).preserve_volume is True
    assert (
        rigging_actions.validate_pose_animation(ANIMATION_ARGUMENTS).interpolation
        == "LINEAR"
    )
    duplicate = {**SKIN_ARGUMENTS, "weights": [*WEIGHTS, WEIGHTS[0]]}
    invalid_sum = {
        **SKIN_ARGUMENTS,
        "weights": [
            {
                **WEIGHTS[2],
                "influences": [
                    {"boneName": ROOT_BONE, "weight": 0.5},
                    {"boneName": TIP_BONE, "weight": 0.25},
                ],
            },
            *WEIGHTS[3:],
        ],
    }
    for arguments, message in (
        (duplicate, "vertexIndex values must be unique"),
        (invalid_sum, "weights must sum to 1"),
    ):
        try:
            rigging_actions.validate_skin_weights(arguments)
        except ValueError as error:
            assert message in str(error)
        else:
            raise AssertionError(f"Invalid skin arguments should fail: {message}")
    try:
        rigging_actions.validate_pose_animation(
            {**ANIMATION_ARGUMENTS, "interpolation": []}
        )
    except ValueError as error:
        assert "arguments.interpolation" in str(error)
    else:
        raise AssertionError("Non-string interpolation must fail cleanly")
    invalid_pose_cases = []
    both = deepcopy(ANIMATION_ARGUMENTS)
    both["keyframes"][0]["poses"][1]["rotationEuler"] = [0.0, 0.0, 0.0]
    invalid_pose_cases.append((both, "exactly one"))
    neither = deepcopy(ANIMATION_ARGUMENTS)
    del neither["keyframes"][0]["poses"][1]["rotationQuaternion"]
    invalid_pose_cases.append((neither, "exactly one"))
    nonunit = deepcopy(ANIMATION_ARGUMENTS)
    nonunit["keyframes"][0]["poses"][1]["rotationQuaternion"] = [
        0.5,
        0.0,
        0.0,
        0.0,
    ]
    invalid_pose_cases.append((nonunit, "unit length"))
    mixed = deepcopy(ANIMATION_ARGUMENTS)
    mixed_tip = mixed["keyframes"][1]["poses"][1]
    del mixed_tip["rotationQuaternion"]
    mixed_tip["rotationEuler"] = [0.0, 0.6, 0.0]
    invalid_pose_cases.append((mixed, "cannot mix rotation channels"))
    nonunit_axis = deepcopy(ANIMATION_ARGUMENTS)
    nonunit_axis["keyframes"][1]["poses"][2]["rotationAxisAngle"] = [
        0.5,
        0.0,
        0.5,
        0.0,
    ]
    invalid_pose_cases.append((nonunit_axis, "axis must have unit length"))
    mixed_axis = deepcopy(ANIMATION_ARGUMENTS)
    mixed_axis_pose = mixed_axis["keyframes"][1]["poses"][2]
    del mixed_axis_pose["rotationAxisAngle"]
    mixed_axis_pose["rotationQuaternion"] = [1.0, 0.0, 0.0, 0.0]
    invalid_pose_cases.append((mixed_axis, "cannot mix rotation channels"))
    for arguments, message in invalid_pose_cases:
        try:
            rigging_actions.validate_pose_animation(arguments)
        except ValueError as error:
            assert message in str(error)
        else:
            raise AssertionError(f"Invalid pose arguments should fail: {message}")


def main() -> None:
    assert_validation_boundaries()
    root = load_task_tree_data(plan())
    session = DemoSession(root, action_registry(root))
    session.start()
    for expected_id in PLAN_STEPS[1:3]:
        assert session.next().id == expected_id

    registry = build_resource_registry(session.receipts)
    target = resolve_resource(registry["deform.target"])
    control = resolve_resource(registry["deform.control"])
    assert target.type == "MESH" and control.type == "MESH"

    # Fail after all parent fields were assigned but before the mutation record
    # could capture its after-state.  execute_armature must restore every parent
    # field locally and remove its newly created armature IDs.
    original_parent_state = rigging_actions._parent_state
    bpy.context.view_layer.update()
    control_parent_before = control.parent
    control_parent_type_before = control.parent_type
    control_parent_bone_before = control.parent_bone
    control_world_before = control.matrix_world.copy()
    control_parent_inverse_before = control.matrix_parent_inverse.copy()
    control_basis_before = control.matrix_basis.copy()

    def fail_after_parent_write(obj, parent):
        if parent is not None:
            raise RuntimeError("Injected parent after-state failure")
        return original_parent_state(obj, parent)

    rigging_actions._parent_state = fail_after_parent_write
    try:
        try:
            session.next()
        except RuntimeError as error:
            assert "Injected parent after-state failure" in str(error)
        else:
            raise AssertionError("Unjournaled parent mutation failure must propagate")
    finally:
        rigging_actions._parent_state = original_parent_state
    assert session.active_step.id == "deform.geometry.control"
    assert control.parent is control_parent_before
    assert control.parent_type == control_parent_type_before
    assert control.parent_bone == control_parent_bone_before
    assert rigging_actions._matrix_rows(
        control.matrix_world
    ) == rigging_actions._matrix_rows(control_world_before)
    assert rigging_actions._matrix_rows(
        control.matrix_parent_inverse
    ) == rigging_actions._matrix_rows(control_parent_inverse_before)
    assert rigging_actions._matrix_rows(control.matrix_basis) == rigging_actions._matrix_rows(
        control_basis_before
    )
    assert bpy.data.objects.get(ARMATURE_ARGUMENTS["objectName"]) is None
    assert bpy.data.armatures.get(ARMATURE_ARGUMENTS["dataName"]) is None

    assert session.next().id == "deform.rig"
    registry = build_resource_registry(session.receipts)
    armature = resolve_resource(registry["deform.armature"])
    assert target.type == "MESH" and armature.type == "ARMATURE"
    assert all(not bone.use_deform for bone in armature.data.bones)
    armature_observation = evaluate_observations(
        ({"kind": "armature_ready", "parameters": ARMATURE_ARGUMENTS},),
        session.receipts,
    )[0]
    assert armature_observation["satisfied"] is True, armature_observation
    assert armature_observation["details"]["attestationContentSha256"] is not None
    assert evaluate_observations(
        (
            {
                "kind": "armature_ready",
                "parameters": {**ARMATURE_ARGUMENTS, "unexpected": True},
            },
        ),
        session.receipts,
    )[0]["satisfied"] is False
    original_armature_name = armature.name
    armature.name = "OperatingLine.Rig.Tampered"
    assert evaluate_observations(
        ({"kind": "armature_ready", "parameters": ARMATURE_ARGUMENTS},),
        session.receipts,
    )[0]["satisfied"] is False
    armature.name = original_armature_name

    # The managed parent link makes control a legitimate mutation target, but
    # that must not authorize a second, untracked reference from the same ID.
    # Removing the armature while this user constraint exists would silently
    # clear constraint.target even though the receipt never recorded it.
    external_constraint = control.constraints.new(type="COPY_LOCATION")
    external_constraint.name = "OperatingLine.ExternalArmatureReference"
    external_constraint.target = armature
    managed_parent = control.parent
    try:
        session.back()
    except RuntimeError as error:
        assert "untracked" in str(error).lower() or "reference" in str(error).lower()
    else:
        raise AssertionError(
            "An untracked constraint reference on a managed parent target must block rollback"
        )
    assert session.active_step.id == "deform.rig"
    assert control.parent is managed_parent is armature
    assert external_constraint.target is armature
    control.constraints.remove(external_constraint)

    incomplete = rigging_actions.validate_skin_weights(
        {**SKIN_ARGUMENTS, "weights": WEIGHTS[:-1]}
    )
    try:
        rigging_actions.execute_skin_weights(
            "deform.skin",
            session.find_node("deform.skin").action,
            session.receipts,
            incomplete,
        )
    except ValueError as error:
        assert "cover every target vertex exactly once" in str(error)
    else:
        raise AssertionError("Incomplete vertex coverage must fail before mutation")
    assert not target.vertex_groups and not target.modifiers
    assert all(not bone.use_deform for bone in armature.data.bones)

    original_new_vertex_group = rigging_actions._new_vertex_group
    group_creation_calls = [0]

    def fail_second_group_creation(target_object, bone_name):
        group_creation_calls[0] += 1
        if group_creation_calls[0] == 2:
            raise RuntimeError("Injected vertex group creation failure")
        return original_new_vertex_group(target_object, bone_name)

    rigging_actions._new_vertex_group = fail_second_group_creation
    try:
        try:
            session.next()
        except RuntimeError as error:
            assert "Injected vertex group creation failure" in str(error)
        else:
            raise AssertionError("Partial vertex group creation failure must propagate")
    finally:
        rigging_actions._new_vertex_group = original_new_vertex_group
    assert session.active_step.id == "deform.rig"
    assert not target.vertex_groups and not target.modifiers
    assert all(not bone.use_deform for bone in armature.data.bones)

    original_add_weight = rigging_actions._add_vertex_weight
    calls = [0]

    def fail_second_weight(group, vertex_index, weight):
        calls[0] += 1
        if calls[0] == 2:
            raise RuntimeError("Injected skin weight failure")
        original_add_weight(group, vertex_index, weight)

    rigging_actions._add_vertex_weight = fail_second_weight
    try:
        try:
            session.next()
        except RuntimeError as error:
            assert "Injected skin weight failure" in str(error)
        else:
            raise AssertionError("Partial skin weight failure must propagate")
    finally:
        rigging_actions._add_vertex_weight = original_add_weight
    assert session.active_step.id == "deform.rig"
    assert not target.vertex_groups and not target.modifiers
    assert all(not bone.use_deform for bone in armature.data.bones)

    assert session.next().id == "deform.skin"
    assert tuple(group.name for group in target.vertex_groups) == (
        ROOT_BONE,
        TIP_BONE,
        AXIS_BONE,
    )
    modifier = target.modifiers.get(SKIN_ARGUMENTS["modifierName"])
    assert modifier is not None and modifier.type == "ARMATURE"
    assert modifier.object is armature and modifier.use_vertex_groups
    assert not modifier.use_bone_envelopes and modifier.use_deform_preserve_volume
    assert all(
        armature.data.bones[name].use_deform
        for name in (ROOT_BONE, TIP_BONE, AXIS_BONE)
    )
    skin_receipt = session.receipts["deform.skin"]
    assert any(
        mutation.attribute == "mesh_content" for mutation in skin_receipt.mutations
    )
    ensure_receipts_intact(session.receipts)
    skin_observation = evaluate_observations(
        (
            {
                "kind": "skin_weights_ready",
                "parameters": SKIN_ARGUMENTS,
            },
        ),
        session.receipts,
    )[0]
    assert skin_observation["satisfied"] is True, skin_observation
    assert skin_observation["details"]["attestationContentSha256"] is not None
    assert evaluate_observations(
        (
            {
                "kind": "skin_weights_ready",
                "parameters": {**SKIN_ARGUMENTS, "unexpected": True},
            },
        ),
        session.receipts,
    )[0]["satisfied"] is False
    target.vertex_groups[TIP_BONE].add((0,), 0.5, "REPLACE")
    assert evaluate_observations(
        ({"kind": "skin_weights_ready", "parameters": SKIN_ARGUMENTS},),
        session.receipts,
    )[0]["satisfied"] is False
    target.vertex_groups[TIP_BONE].remove((0,))
    invalid_skin_observation = evaluate_observations(
        (
            {
                "kind": "skin_weights_ready",
                "parameters": {
                    "targetId": "deform.target",
                    "armatureId": "deform.armature",
                    "modifierId": "deform.skin.modifier",
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "preserveVolume": "true",
                },
            },
        ),
        session.receipts,
    )[0]
    assert invalid_skin_observation["satisfied"] is False

    before_animation_pose = {
        bone_name: rigging_actions._pose_state(armature.pose.bones[bone_name])
        for bone_name in (ROOT_BONE, TIP_BONE, AXIS_BONE)
    }
    original_insert_pose_keyframe = rigging_actions._insert_pose_keyframe

    def fail_axis_angle_keyframe(pose_bone, frame, bone_name, data_path="rotation_euler"):
        if data_path == "rotation_axis_angle" and frame == 10:
            return False
        return original_insert_pose_keyframe(pose_bone, frame, bone_name, data_path)

    rigging_actions._insert_pose_keyframe = fail_axis_angle_keyframe
    try:
        try:
            session.next()
        except RuntimeError as error:
            assert "Blender rejected keyframe 10" in str(error)
        else:
            raise AssertionError("Partial axis-angle animation failure must propagate")
    finally:
        rigging_actions._insert_pose_keyframe = original_insert_pose_keyframe
    assert session.active_step.id == "deform.skin"
    assert bpy.data.actions.get(ANIMATION_ARGUMENTS["actionName"]) is None
    assert {
        bone_name: rigging_actions._pose_state(armature.pose.bones[bone_name])
        for bone_name in (ROOT_BONE, TIP_BONE, AXIS_BONE)
    } == before_animation_pose

    assert session.next().id == "deform.animation"
    animation = resolve_resource(
        build_resource_registry(session.receipts)["deform.animation.action"]
    )
    curves = action_fcurves(animation)
    assert len(curves) == 29
    assert armature.pose.bones[ROOT_BONE].rotation_mode == "XYZ"
    assert armature.pose.bones[TIP_BONE].rotation_mode == "QUATERNION"
    assert armature.pose.bones[AXIS_BONE].rotation_mode == "AXIS_ANGLE"
    assert {
        curve.array_index
        for curve in curves
        if curve.data_path == armature.pose.bones[TIP_BONE].path_from_id(
            "rotation_quaternion"
        )
    } == {0, 1, 2, 3}
    assert {
        curve.array_index
        for curve in curves
        if curve.data_path == armature.pose.bones[ROOT_BONE].path_from_id(
            "rotation_euler"
        )
    } == {0, 1, 2}
    assert {
        curve.array_index
        for curve in curves
        if curve.data_path == armature.pose.bones[AXIS_BONE].path_from_id(
            "rotation_axis_angle"
        )
    } == {0, 1, 2, 3}
    assert all(curve.extrapolation == "LINEAR" for curve in curves)
    assert all(
        point.interpolation == "LINEAR"
        for curve in curves
        for point in curve.keyframe_points
    )
    animation_observation = evaluate_observations(
        (
            {
                "kind": "pose_animation_ready",
                "parameters": ANIMATION_ARGUMENTS,
            },
        ),
        session.receipts,
    )[0]
    assert animation_observation["satisfied"] is True, animation_observation
    assert animation_observation["details"]["attestationContentSha256"] is not None
    assert evaluate_observations(
        (
            {
                "kind": "pose_animation_ready",
                "parameters": {**ANIMATION_ARGUMENTS, "unexpected": True},
            },
        ),
        session.receipts,
    )[0]["satisfied"] is False
    first_curve = curves[0]
    original_key_value = float(first_curve.keyframe_points[0].co[1])
    first_curve.keyframe_points[0].co[1] += 0.125
    assert evaluate_observations(
        ({"kind": "pose_animation_ready", "parameters": ANIMATION_ARGUMENTS},),
        session.receipts,
    )[0]["satisfied"] is False
    first_curve.keyframe_points[0].co[1] = original_key_value
    invalid_animation_observation = evaluate_observations(
        (
            {
                "kind": "pose_animation_ready",
                "parameters": {
                    "armatureId": "deform.armature",
                    "actionId": "deform.animation.action",
                    "frames": [1, 10, 20],
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "channels": ["rotation_euler", "rotation_quaternion"],
                },
            },
        ),
        session.receipts,
    )[0]
    assert invalid_animation_observation["satisfied"] is False
    invalid_interpolation_observation = evaluate_observations(
        (
            {
                "kind": "pose_animation_ready",
                "parameters": {
                    "armatureId": "deform.armature",
                    "actionId": "deform.animation.action",
                    "frames": [1, 10, 20],
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "channels": ["location", "rotation_euler", "scale"],
                    "interpolation": [],
                },
            },
        ),
        session.receipts,
    )[0]
    assert invalid_interpolation_observation["satisfied"] is False

    original_frame = bpy.context.scene.frame_current
    bpy.context.scene.frame_set(1)
    rest = evaluated_coordinates(target)
    bpy.context.scene.frame_set(10)
    deformed = evaluated_coordinates(target)
    assert any(
        not math.isclose(left, right, abs_tol=1e-6)
        for rest_vertex, deformed_vertex in zip(rest, deformed)
        for left, right in zip(rest_vertex, deformed_vertex)
    )
    bpy.context.scene.frame_set(20)
    returned = evaluated_coordinates(target)
    assert all(
        math.isclose(left, right, abs_tol=1e-6)
        for rest_vertex, returned_vertex in zip(rest, returned)
        for left, right in zip(rest_vertex, returned_vertex)
    )
    bpy.context.scene.frame_set(original_frame)

    assert session.back().id == "deform.animation"
    assert bpy.data.actions.get(ANIMATION_ARGUMENTS["actionName"]) is None
    assert {
        bone_name: rigging_actions._pose_state(armature.pose.bones[bone_name])
        for bone_name in (ROOT_BONE, TIP_BONE, AXIS_BONE)
    } == before_animation_pose
    tip_group = target.vertex_groups[TIP_BONE]
    tip_group.add((0,), 0.5, "REPLACE")
    try:
        session.back()
    except RuntimeError as error:
        assert "skin_weights:deform.skin.modifier" in str(error)
    else:
        raise AssertionError("Edited weights must block compensation")
    assert session.active_step.id == "deform.skin"
    tip_group.remove((0,))
    assert session.back().id == "deform.skin"
    assert not target.vertex_groups and not target.modifiers
    assert all(not bone.use_deform for bone in armature.data.bones)

    session.reset()
    assert session.active_index == -1 and not session.receipts
    assert owned_resources() == []
    print(
        "OperatingLine deform animation test passed: normalized weights, "
        "29 mixed Euler/quaternion/axis-angle transform curves, real deformation, "
        "conflict-safe rollback"
    )


if __name__ == "__main__":
    main()
