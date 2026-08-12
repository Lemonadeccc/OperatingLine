"""Real Blender coverage for explicit skin weights and pose transform clips."""

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
)


ROOT_BONE = "OperatingLine.DeformRoot"
TIP_BONE = "OperatingLine.DeformTip"


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
            {"boneName": TIP_BONE, "weight": 0.75},
        ],
    },
    {
        "vertexIndex": 5,
        "influences": [
            {"boneName": ROOT_BONE, "weight": 0.25},
            {"boneName": TIP_BONE, "weight": 0.75},
        ],
    },
    {"vertexIndex": 6, "influences": [{"boneName": TIP_BONE, "weight": 1.0}]},
    {"vertexIndex": 7, "influences": [{"boneName": TIP_BONE, "weight": 1.0}]},
]


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
                    "rotationEuler": [0.0, 0.0, 0.0],
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
                    "rotationEuler": [0.0, 0.6, 0.0],
                    "location": [0.0, 0.15, 0.0],
                    "scale": [1.0, 1.15, 1.0],
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
                    "rotationEuler": [0.0, 0.0, 0.0],
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
                {
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
                    ],
                    "bindings": [
                        {"targetId": "deform.control", "boneName": ROOT_BONE}
                    ],
                },
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


def main() -> None:
    assert_validation_boundaries()
    root = load_task_tree_data(plan())
    session = DemoSession(root, action_registry(root))
    session.start()
    for expected_id in PLAN_STEPS[1:4]:
        assert session.next().id == expected_id

    registry = build_resource_registry(session.receipts)
    target = resolve_resource(registry["deform.target"])
    armature = resolve_resource(registry["deform.armature"])
    assert target.type == "MESH" and armature.type == "ARMATURE"
    assert all(not bone.use_deform for bone in armature.data.bones)

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
    assert tuple(group.name for group in target.vertex_groups) == (ROOT_BONE, TIP_BONE)
    modifier = target.modifiers.get(SKIN_ARGUMENTS["modifierName"])
    assert modifier is not None and modifier.type == "ARMATURE"
    assert modifier.object is armature and modifier.use_vertex_groups
    assert not modifier.use_bone_envelopes and modifier.use_deform_preserve_volume
    assert all(armature.data.bones[name].use_deform for name in (ROOT_BONE, TIP_BONE))
    skin_observation = evaluate_observations(
        (
            {
                "kind": "skin_weights_ready",
                "parameters": {
                    "targetId": "deform.target",
                    "armatureId": "deform.armature",
                    "modifierId": "deform.skin.modifier",
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "preserveVolume": True,
                },
            },
        ),
        session.receipts,
    )[0]
    assert skin_observation["satisfied"] is True, skin_observation
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

    assert session.next().id == "deform.animation"
    animation = resolve_resource(
        build_resource_registry(session.receipts)["deform.animation.action"]
    )
    curves = action_fcurves(animation)
    assert len(curves) == 18
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
                "parameters": {
                    "armatureId": "deform.armature",
                    "actionId": "deform.animation.action",
                    "frames": [1, 10, 20],
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "channels": ["location", "rotation_euler", "scale"],
                    "interpolation": "LINEAR",
                    "extrapolation": "LINEAR",
                },
            },
        ),
        session.receipts,
    )[0]
    assert animation_observation["satisfied"] is True, animation_observation
    invalid_animation_observation = evaluate_observations(
        (
            {
                "kind": "pose_animation_ready",
                "parameters": {
                    "armatureId": "deform.armature",
                    "actionId": "deform.animation.action",
                    "frames": [1, 10, 20],
                    "boneNames": [ROOT_BONE, TIP_BONE],
                    "channels": ["rotation_euler", "rotation_euler"],
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
        "18 transform curves, real deformation, conflict-safe rollback"
    )


if __name__ == "__main__":
    main()
