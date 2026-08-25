"""Live Blender proof for the accepted four-step Single Material MCP rail."""

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
RESULT_PATH = Path(os.environ["OPERATINGLINE_MATERIAL_LEAF_RESULT"])
FINAL_ACCEPTED_PATH = Path(
    os.environ["OPERATINGLINE_MATERIAL_LEAF_FINAL_ACCEPTED"]
)
PROXY_FAILURE_PATH = Path(
    os.environ["OPERATINGLINE_MATERIAL_LEAF_PROXY_FAILURE"]
)
DIAGNOSTIC_PATH = Path(os.environ["OPERATINGLINE_MATERIAL_LEAF_DIAGNOSTIC"])
RUNTIME_URL = os.environ["OPERATINGLINE_MATERIAL_LEAF_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_MATERIAL_LEAF_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_MATERIAL_LEAF_TIMEOUT", "180"))

CREATOR_LEAF_IDS = (
    "snowman.head.eyes.left",
    "snowman.head.eyes.right",
)
MATERIAL_LEAF_ID = "snowman.materials.snow"
TARGET_NAMES = ("OperatingLine.EyeLeft", "OperatingLine.EyeRight")
MATERIAL_NAME = "OperatingLine.GuidedMaterial"
BASE_COLOR = (0.82, 0.9, 1.0, 1.0)
ROUGHNESS = 0.35
METALLIC = 0.1

spec = importlib.util.spec_from_file_location(
    "operating_line_material_leaf_e2e",
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
creator_completed = False


def finish(payload: dict[str, object], *, ok: bool) -> None:
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"MATERIAL_LEAF_OPERATION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def final_material_result() -> dict[str, object]:
    material = bpy.data.materials.get(MATERIAL_NAME)
    assert material is not None, "material missing"
    assert material.use_nodes is True, "Use Nodes mismatch"
    assert all(
        abs(float(actual) - expected) <= 1e-6
        for actual, expected in zip(material.diffuse_color, BASE_COLOR, strict=True)
    ), "material base color mismatch"
    assert abs(float(material.roughness) - ROUGHNESS) <= 1e-6, (
        "material roughness mismatch"
    )
    assert abs(float(material.metallic) - METALLIC) <= 1e-6, (
        "material metallic mismatch"
    )
    principled_nodes = tuple(
        node
        for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeBsdfPrincipled"
    )
    output_nodes = tuple(
        node
        for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
    )
    assert len(principled_nodes) == 1, "Principled node count mismatch"
    assert len(output_nodes) == 1, "Material Output node count mismatch"
    principled = principled_nodes[0]
    assert all(
        abs(float(actual) - expected) <= 1e-6
        for actual, expected in zip(
            principled.inputs["Base Color"].default_value,
            BASE_COLOR,
            strict=True,
        )
    ), "Principled base color mismatch"
    assert (
        abs(float(principled.inputs["Roughness"].default_value) - ROUGHNESS)
        <= 1e-6
    ), "Principled roughness mismatch"
    assert (
        abs(float(principled.inputs["Metallic"].default_value) - METALLIC)
        <= 1e-6
    ), "Principled metallic mismatch"
    targets = tuple(bpy.data.objects.get(name) for name in TARGET_NAMES)
    assert all(target is not None and target.type == "MESH" for target in targets), (
        "target mesh missing"
    )
    assert all(
        len(target.material_slots) == 1
        and target.material_slots[0].material is material
        for target in targets
        if target is not None
    ), "ordered target assignment mismatch"

    session = operating_line.get_session()
    completed = session.leaf_operation_runs.get(MATERIAL_LEAF_ID)
    assert completed is not None and completed.status == "completed", "run missing"
    assert len(completed.operation_receipts) == 4, "receipt count mismatch"
    assert session.pending_leaf_operation_run is None, "pending run remained"
    assert session.active_index == 2, f"active index mismatch: {session.active_index}"
    observations = session.success_gate_observation_copy(MATERIAL_LEAF_ID)
    assert observations is not None and len(observations) == 1, "observation missing"
    observation = observations[0]
    assert observation["kind"] == "material_assigned", "observation kind mismatch"
    assert observation["satisfied"] is True, "observation unsatisfied"
    details = observation["details"]
    assert details["receiptMatches"] is True, "receipt proof failed"
    assert details["ownershipMatches"] is True, "ownership proof failed"
    assert details["materialSurfaceMatches"] is True, "surface proof failed"
    assert details["assignmentsMatch"] is True, "assignment proof failed"
    assert details["sourceContentIntact"] is True, "source proof failed"
    assert details["targetIds"] == ["snowman.eye.left", "snowman.eye.right"]
    assert details["assignedTargetIds"] == details["targetIds"]

    return {
        "status": operating_line.get_companion().status,
        "materialCount": sum(
            candidate.name == MATERIAL_NAME for candidate in bpy.data.materials
        ),
        "assignedTargetCount": len(targets),
        "operationReceiptCount": len(completed.operation_receipts),
        "observationSatisfied": observation["satisfied"],
        "materialSurfaceMatches": details["materialSurfaceMatches"],
        "assignmentsMatch": details["assignmentsMatch"],
        "hostVersion": bpy.app.version_string,
    }


def monitor() -> float | None:
    global accepted, creator_completed, walkthrough_started
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
                "Timed out waiting for four-step Single Material completion: "
                f"status={controller.status!r}, error={controller.error!r}, "
                f"accepted={accepted}, started={walkthrough_started}, "
                f"creatorCompleted={creator_completed}, diagnostic={diagnostic}"
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
        if (
            walkthrough_started
            and not creator_completed
            and session.active_index < len(CREATOR_LEAF_IDS) - 1
        ):
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Creator leaf execution failed: {controller.error}")
            creator_completed = session.active_index >= len(CREATOR_LEAF_IDS) - 1
        if FINAL_ACCEPTED_PATH.exists():
            marker = json.loads(FINAL_ACCEPTED_PATH.read_text(encoding="utf-8"))
            assert marker["status"] == "succeeded"
            finish(final_material_result(), ok=True)
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
