"""Live Blender proof for the accepted 12-step Pose Animation MCP rail."""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
RESULT_PATH = Path(os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_RESULT"])
FINAL_ACCEPTED_PATH = Path(
    os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_FINAL_ACCEPTED"]
)
PROXY_FAILURE_PATH = Path(
    os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_PROXY_FAILURE"]
)
DIAGNOSTIC_PATH = Path(
    os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_DIAGNOSTIC"]
)
RUNTIME_URL = os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_POSE_ANIMATION_LEAF_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(
    os.environ.get("OPERATINGLINE_POSE_ANIMATION_LEAF_TIMEOUT", "180")
)

CREATOR_LEAF_ID = "snowman.head.eyes.left"
RIG_LEAF_ID = f"{CREATOR_LEAF_ID}.pose-rig"
POSE_ANIMATION_LEAF_ID = f"{CREATOR_LEAF_ID}.pose-animation"
RIG_NAME = "OperatingLine.GuidedPoseRig"
ACTION_NAME = "OperatingLine.GuidedPoseAction"

spec = importlib.util.spec_from_file_location(
    "operating_line_pose_animation_leaf_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)
action_fcurves = importlib.import_module(
    f"{spec.name}.operating_line.infrastructure.snowman_actions.common"
).action_fcurves


started_at = time.monotonic()
accepted = False
walkthrough_started = False
creator_completed = False
rig_completed = False


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"POSE_ANIMATION_LEAF_OPERATION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def final_animation_result() -> dict[str, object]:
    rig = bpy.data.objects.get(RIG_NAME)
    action = bpy.data.actions.get(ACTION_NAME)
    assert rig is not None and rig.type == "ARMATURE"
    assert action is not None
    assert rig.animation_data is not None and rig.animation_data.action is action
    curves = action_fcurves(action)
    keyframe_point_count = sum(len(curve.keyframe_points) for curve in curves)
    assert len(curves) == 29
    assert keyframe_point_count == 87
    assert all(curve.extrapolation == "LINEAR" for curve in curves)
    assert all(
        point.interpolation == "LINEAR"
        for curve in curves
        for point in curve.keyframe_points
    )

    session = operating_line.get_session()
    completed = session.leaf_operation_runs.get(POSE_ANIMATION_LEAF_ID)
    assert completed is not None and completed.status == "completed"
    assert len(completed.operation_receipts) == 12
    assert session.pending_leaf_operation_run is None
    assert session.active_index == 2
    observations = session.success_gate_observation_copy(POSE_ANIMATION_LEAF_ID)
    assert observations is not None and len(observations) == 1
    observation = observations[0]
    assert observation["kind"] == "pose_animation_ready"
    assert observation["satisfied"] is True
    details = observation["details"]
    assert details["parametersValid"] is True
    assert details["receiptMatches"] is True
    assert details["ownershipMatches"] is True
    assert details["curvesMatch"] is True
    assert details["valuesMatch"] is True
    assert details["actionContentIntact"] is True

    return {
        "status": operating_line.get_companion().status,
        "curveCount": len(curves),
        "keyframePointCount": keyframe_point_count,
        "operationReceiptCount": len(completed.operation_receipts),
        "observationSatisfied": observation["satisfied"],
        "receiptMatches": details["receiptMatches"],
        "actionContentIntact": details["actionContentIntact"],
        "hostVersion": bpy.app.version_string,
    }


def monitor() -> float | None:
    global accepted, creator_completed, rig_completed, walkthrough_started
    controller = operating_line.get_companion()
    try:
        if PROXY_FAILURE_PATH.exists():
            failure = json.loads(PROXY_FAILURE_PATH.read_text(encoding="utf-8"))
            raise RuntimeError(f"Companion proxy failed: {failure['error']}")
        if time.monotonic() - started_at > TIMEOUT_SECONDS:
            diagnostic = (
                DIAGNOSTIC_PATH.read_text(encoding="utf-8")
                if DIAGNOSTIC_PATH.exists()
                else "diagnostic unavailable"
            )
            raise TimeoutError(
                "Timed out waiting for 12-step Pose Animation completion: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"accepted={accepted}, started={walkthrough_started}, "
                f"creatorCompleted={creator_completed}, rigCompleted={rig_completed}, "
                f"diagnostic={diagnostic}"
            )
        if not accepted and controller.proposed_plan is not None:
            if bpy.ops.operating_line.accept_proposal() != {"FINISHED"}:
                raise RuntimeError(f"Proposal acceptance failed: {controller.error}")
            accepted = True
        session = operating_line.get_session()
        if accepted and not walkthrough_started and not session.started:
            if bpy.ops.operating_line.start() != {"FINISHED"}:
                raise RuntimeError(f"Walkthrough start failed: {controller.error}")
            walkthrough_started = True
        if walkthrough_started and not creator_completed and session.active_index < 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Creator leaf execution failed: {controller.error}")
            creator_completed = True
        elif creator_completed and not rig_completed and session.active_index == 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Rig leaf execution failed: {controller.error}")
            rig_completed = True
        if FINAL_ACCEPTED_PATH.exists():
            marker = json.loads(FINAL_ACCEPTED_PATH.read_text(encoding="utf-8"))
            assert marker["status"] == "succeeded"
            assert controller.status == f"Leaf {POSE_ANIMATION_LEAF_ID} completed"
            finish(final_animation_result(), ok=True)
            return None
    except Exception as error:
        finish(
            {
                "error": str(error),
                "status": controller.status,
                "controllerError": controller.error,
                "accepted": accepted,
                "walkthroughStarted": walkthrough_started,
                "creatorCompleted": creator_completed,
                "rigCompleted": rig_completed,
            },
            ok=False,
        )
        return None
    return 0.02


assert bpy.app.online_access is True
operating_line.register()
bpy.context.window_manager.operating_line_runtime_url = RUNTIME_URL
bpy.context.window_manager.operating_line_bearer_token = ACCESS_TOKEN
if bpy.ops.operating_line.connect() != {"FINISHED"}:
    raise RuntimeError("Companion connection failed")
bpy.app.timers.register(monitor, first_interval=0.02)
