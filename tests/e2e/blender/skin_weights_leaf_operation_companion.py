"""Live Blender proof for the accepted 9-step Skin Weights MCP rail."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
import time

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
RESULT_PATH = Path(os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_RESULT"])
FINAL_ACCEPTED_PATH = Path(
    os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_FINAL_ACCEPTED"]
)
PROXY_FAILURE_PATH = Path(
    os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_PROXY_FAILURE"]
)
DIAGNOSTIC_PATH = Path(
    os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_DIAGNOSTIC"]
)
RUNTIME_URL = os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_SKIN_WEIGHTS_LEAF_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(
    os.environ.get("OPERATINGLINE_SKIN_WEIGHTS_LEAF_TIMEOUT", "180")
)

TARGET_LEAF_ID = "snowman.head.eyes.left"
HELPER_LEAF_ID = f"{TARGET_LEAF_ID}.skin-helper"
RIG_LEAF_ID = f"{TARGET_LEAF_ID}.skin-rig"
SKIN_WEIGHTS_LEAF_ID = f"{TARGET_LEAF_ID}.skin-weights"
TARGET_NAME = "OperatingLine.GuidedSkinTarget"
HELPER_NAME = "OperatingLine.GuidedSkinHelper"
RIG_NAME = "OperatingLine.GuidedSkinRig"
MODIFIER_NAME = "OperatingLine.GuidedSkinArmature"
ROOT_BONE = "OperatingLine.GuidedSkinRoot"
TIP_BONE = "OperatingLine.GuidedSkinTip"

spec = importlib.util.spec_from_file_location(
    "operating_line_skin_weights_leaf_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)


started_at = time.monotonic()
accepted = False
walkthrough_started = False
target_completed = False
helper_completed = False
rig_completed = False


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"SKIN_WEIGHTS_LEAF_OPERATION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def final_skin_weights_result() -> dict[str, object]:
    target = bpy.data.objects.get(TARGET_NAME)
    helper = bpy.data.objects.get(HELPER_NAME)
    rig = bpy.data.objects.get(RIG_NAME)
    assert target is not None and target.type == "MESH"
    assert helper is not None and helper.type == "MESH"
    assert rig is not None and rig.type == "ARMATURE"
    assert target.parent is None
    assert helper.parent is rig
    assert helper.parent_type == "BONE"
    assert helper.parent_bone == TIP_BONE
    assert tuple(bone.name for bone in rig.data.bones) == (ROOT_BONE, TIP_BONE)
    assert len(target.data.vertices) == 8
    assert tuple(group.name for group in target.vertex_groups) == (
        ROOT_BONE,
        TIP_BONE,
    )
    group_names = {group.index: group.name for group in target.vertex_groups}
    for vertex in target.data.vertices:
        assert len(vertex.groups) == 1
        assignment = vertex.groups[0]
        expected_bone = ROOT_BONE if vertex.index < 4 else TIP_BONE
        assert group_names[assignment.group] == expected_bone
        assert abs(assignment.weight - 1.0) <= 1e-6
    modifier = target.modifiers.get(MODIFIER_NAME)
    assert modifier is not None and modifier.type == "ARMATURE"
    assert modifier.object is rig
    assert modifier.use_vertex_groups is True
    assert modifier.use_bone_envelopes is False
    assert modifier.use_deform_preserve_volume is True

    session = operating_line.get_session()
    completed = session.leaf_operation_runs.get(SKIN_WEIGHTS_LEAF_ID)
    assert completed is not None and completed.status == "completed"
    assert len(completed.operation_receipts) == 9
    assert session.pending_leaf_operation_run is None
    assert session.active_index == 3
    observations = session.success_gate_observation_copy(SKIN_WEIGHTS_LEAF_ID)
    assert observations is not None and len(observations) == 1
    observation = observations[0]
    assert observation["kind"] == "skin_weights_ready"
    assert observation["satisfied"] is True
    details = observation["details"]
    assert details["parametersValid"] is True
    assert details["receiptMatches"] is True
    assert details["ownershipMatches"] is True
    assert details["assignmentMatches"] is True
    assert details["modifierMatches"] is True
    assert details["meshContentIntact"] is True
    assert details["preserveVolumeMatches"] is True

    return {
        "status": operating_line.get_companion().status,
        "vertexCount": len(target.data.vertices),
        "groupCount": len(target.vertex_groups),
        "modifierCount": len(target.modifiers),
        "operationReceiptCount": len(completed.operation_receipts),
        "observationSatisfied": observation["satisfied"],
        "receiptMatches": details["receiptMatches"],
        "weightsApplied": details["assignmentMatches"],
        "modifierCreated": details["modifierMatches"],
        "hostVersion": bpy.app.version_string,
    }


def monitor() -> float | None:
    global accepted, helper_completed, rig_completed, target_completed, walkthrough_started
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
                "Timed out waiting for 9-step Skin Weights completion: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"accepted={accepted}, started={walkthrough_started}, "
                f"targetCompleted={target_completed}, helperCompleted={helper_completed}, "
                f"rigCompleted={rig_completed}, "
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
        if walkthrough_started and not target_completed and session.active_index < 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Target leaf execution failed: {controller.error}")
            target_completed = True
        elif target_completed and not helper_completed and session.active_index == 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Helper leaf execution failed: {controller.error}")
            helper_completed = True
        elif helper_completed and not rig_completed and session.active_index == 1:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Rig leaf execution failed: {controller.error}")
            rig_completed = True
        if FINAL_ACCEPTED_PATH.exists():
            marker = json.loads(FINAL_ACCEPTED_PATH.read_text(encoding="utf-8"))
            assert marker["status"] == "succeeded"
            assert controller.status == f"Leaf {SKIN_WEIGHTS_LEAF_ID} completed"
            finish(final_skin_weights_result(), ok=True)
            return None
    except Exception as error:
        finish(
            {
                "error": str(error),
                "status": controller.status,
                "controllerError": controller.error,
                "accepted": accepted,
                "walkthroughStarted": walkthrough_started,
                "targetCompleted": target_completed,
                "helperCompleted": helper_completed,
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
