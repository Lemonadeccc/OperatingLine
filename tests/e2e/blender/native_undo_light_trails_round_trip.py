"""Foreground Blender proof for Light Trails operation-level native Undo/Redo."""

from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_light_trails_native_undo_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_light_trails_native_undo_e2e.operating_line.application import (  # noqa: E402
    DemoSession,
)
from operating_line_light_trails_native_undo_e2e.operating_line.domain import (  # noqa: E402
    load_task_tree_data,
)
from operating_line_light_trails_native_undo_e2e.operating_line.infrastructure import (  # noqa: E402
    LIGHT_TRAILS_OPERATION_IDS,
    action_registry,
    native_history_error,
    native_history_requires_native_undo,
    verify_light_trails_stage,
)
from operating_line_light_trails_native_undo_e2e.operating_line.infrastructure.observations import (  # noqa: E402
    evaluate_observations,
)
from operating_line_light_trails_native_undo_e2e.operating_line.infrastructure.snowman_actions.editing import (  # noqa: E402
    validate_geometry_nodes_light_trails,
)
from operating_line_light_trails_native_undo_e2e.operating_line.presentation.native_menu_guidance import (  # noqa: E402
    focus_next_leaf_operation,
    focus_previous_leaf_operation,
    leaf_guidance_snapshot,
)


TARGET_ID = "native.light_trails.target"
OBJECT_NAME = "OperatingLine.NativeUndo.LightTrails.Target"
MODIFIER_NAME = "OperatingLine.NativeUndo.LightTrails.Modifier"
NODE_GROUP_NAME = "OperatingLine.NativeUndo.LightTrails.NodeGroup"
STEP_ID = "native.light_trails.geometry"
ARGUMENTS = {
    "targetId": TARGET_ID,
    "modifierId": "native.light_trails.modifier",
    "modifierName": MODIFIER_NAME,
    "nodeGroupId": "native.light_trails.node_group",
    "nodeGroupName": NODE_GROUP_NAME,
    "trailCount": 12,
    "pointsPerTrail": 48,
    "tileLength": 20.0,
    "trailSpacing": 0.22,
    "noiseScale": 0.4,
    "noiseDetail": 3.0,
    "noiseRoughness": 0.55,
    "noiseSeed": 7.0,
    "height": 1.8,
    "profileSides": 4,
    "profileRadius": 0.025,
    "tileRepeatCount": 3,
}
EXPECTED_NODE_TYPES = (
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
            "failureStrategy": "retain_for_repair",
        }
    return result


PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "native.light_trails.target",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            STEP_ID,
            2,
            {
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_light_trails",
                "arguments": ARGUMENTS,
            },
            depends_on=["native.light_trails.target"],
            expected_observations=[
                {
                    "kind": "light_trails_ready",
                    "parameters": {
                        **ARGUMENTS,
                        "nodeTypes": list(EXPECTED_NODE_TYPES),
                    },
                }
            ],
        ),
    ],
}


def _history_override():
    window = bpy.context.window_manager.windows[0]
    area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
    region = next(region for region in area.regions if region.type == "WINDOW")
    return bpy.context.temp_override(window=window, area=area, region=region)


def _push(message: str) -> None:
    with _history_override():
        assert bpy.ops.ed.undo_push(message=message) == {"FINISHED"}


def _undo() -> None:
    with _history_override():
        assert bpy.ops.ed.undo() == {"FINISHED"}


def _redo() -> None:
    with _history_override():
        assert bpy.ops.ed.redo() == {"FINISHED"}


def _focus(step, ordinal: int):
    snapshot = leaf_guidance_snapshot(step)
    assert snapshot is not None
    while snapshot.focused_ordinal < ordinal:
        focused = snapshot.focused_operation
        assert focus_next_leaf_operation(
            step,
            focused.operation_id,
            focused.ordinal,
            snapshot.cursor_token,
        )
        snapshot = leaf_guidance_snapshot(step)
        assert snapshot is not None
    while snapshot.focused_ordinal > ordinal:
        focused = snapshot.focused_operation
        assert focus_previous_leaf_operation(
            step,
            focused.operation_id,
            focused.ordinal,
            snapshot.cursor_token,
        )
        snapshot = leaf_guidance_snapshot(step)
        assert snapshot is not None
    assert snapshot.focused_ordinal == ordinal
    return snapshot


def _execute_operation(session: DemoSession, ordinal: int) -> None:
    step = session.guidance_step
    assert step is not None and step.action is not None
    snapshot = _focus(step, ordinal)
    operation = snapshot.focused_operation
    run = session.pending_leaf_operation_run
    run_id = run.run_id if run is not None else ""
    assert bpy.ops.operating_line.execute_guided_geometry_operation(
        step_id=step.id,
        operation_id=operation.operation_id,
        ordinal=operation.ordinal,
        cursor_token=snapshot.cursor_token,
        run_id=run_id,
    ) == {"FINISHED"}
    _push(f"OperatingLine Light Trails operation {ordinal:02d}")


def _assert_pending_stage(session: DemoSession, expected_last: int) -> None:
    run = session.pending_leaf_operation_run
    step = session.guidance_step
    assert run is not None and step is not None
    assert run.next_ordinal == expected_last + 1
    assert tuple(receipt.ordinal for receipt in run.operation_receipts) == tuple(
        range(1, expected_last + 1)
    )
    definition = validate_geometry_nodes_light_trails(step.action.arguments)
    assert verify_light_trails_stage(
        receipt_id=run.leaf_receipt_id,
        step_id=step.id,
        action_name=step.action.name,
        receipts=session.receipts,
        definition=definition,
        completed_operations=tuple(range(1, expected_last + 1)),
        expected_fingerprint=run.operation_receipts[-1].after_sha256,
        partial_receipt=run.partial_action_receipt,
    )


def run() -> None:
    extension.register()
    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="native-undo-light-trails-e2e",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    extension.operating_line.replace_session(session)

    _push("OperatingLine Light Trails baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine Light Trails after Start")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine Light Trails after target")
    assert session.active_index == 0
    assert session.guidance_step.id == STEP_ID
    snapshot = leaf_guidance_snapshot(session.guidance_step)
    assert snapshot is not None
    assert tuple(item.operation_id for item in snapshot.operations) == (
        LIGHT_TRAILS_OPERATION_IDS
    )

    for ordinal in range(1, 16):
        _execute_operation(session, ordinal)
    _assert_pending_stage(session, 15)
    noise = bpy.data.node_groups[NODE_GROUP_NAME].nodes[
        "OperatingLine Terrain Noise"
    ]
    assert math.isclose(
        float(noise.inputs["Scale"].default_value), 0.4, abs_tol=1e-6
    )

    _undo()
    assert native_history_error() == ""
    assert not native_history_requires_native_undo()
    _assert_pending_stage(session, 14)
    noise = bpy.data.node_groups[NODE_GROUP_NAME].nodes[
        "OperatingLine Terrain Noise"
    ]
    assert math.isclose(
        float(noise.inputs["Scale"].default_value), 1.0, abs_tol=1e-6
    )

    _redo()
    assert native_history_error() == ""
    _assert_pending_stage(session, 15)
    noise = bpy.data.node_groups[NODE_GROUP_NAME].nodes[
        "OperatingLine Terrain Noise"
    ]
    assert math.isclose(
        float(noise.inputs["Scale"].default_value), 0.4, abs_tol=1e-6
    )

    for ordinal in range(16, 55):
        _execute_operation(session, ordinal)
    assert session.pending_leaf_operation_run is None
    assert session.active_index == 1
    target = bpy.data.objects[OBJECT_NAME]
    modifier = target.modifiers[MODIFIER_NAME]
    assert len(modifier.node_group.nodes) == 20
    assert len(modifier.node_group.links) == 19
    assert len(modifier.bakes) == 0 and modifier.bake_directory == ""

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 0
    _assert_pending_stage(session, 53)
    assert len(bpy.data.node_groups[NODE_GROUP_NAME].links) == 19

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 1
    assert session.pending_leaf_operation_run is None
    observations = session.success_gate_observation_copy(STEP_ID)
    assert observations is not None and observations[0]["satisfied"] is True

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    _push("OperatingLine Light Trails after Back")
    assert session.active_index == 0
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 1
    target = bpy.data.objects[OBJECT_NAME]
    assert target.modifiers.get(MODIFIER_NAME) is not None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is not None

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 0
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None

    print(
        "OperatingLine Light Trails native Undo proof passed: "
        "operation 15, final verify, and whole-leaf Back",
        bpy.app.version_string,
        flush=True,
    )
    extension.unregister()
    bpy.ops.wm.quit_blender()


def guarded_run() -> None:
    try:
        run()
    except BaseException:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)


bpy.app.timers.register(guarded_run, first_interval=1.0)
