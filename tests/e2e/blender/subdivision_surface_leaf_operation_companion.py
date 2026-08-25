"""Live Blender proof for the accepted four-step Subdivision Surface MCP rail."""

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
RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_RESULT"])
FINAL_ACCEPTED_PATH = Path(
    os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_FINAL_ACCEPTED"]
)
PROXY_FAILURE_PATH = Path(
    os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_PROXY_FAILURE"]
)
DIAGNOSTIC_PATH = Path(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_DIAGNOSTIC"])
RUNTIME_URL = os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_TIMEOUT", "180"))

CREATOR_LEAF_ID = "snowman.head.eyes.left"
SUBDIVISION_SURFACE_LEAF_ID = f"{CREATOR_LEAF_ID}.subdivision_surface"
TARGET_NAME = "OperatingLine.EyeLeft"
MODIFIER_NAME = "OperatingLine.GuidedSubdivisionSurface"

spec = importlib.util.spec_from_file_location(
    "operating_line_subdivision_surface_leaf_e2e",
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
        f"SUBDIVISION_SURFACE_LEAF_OPERATION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def final_subdivision_surface_result() -> dict[str, object]:
    target = bpy.data.objects.get(TARGET_NAME)
    assert target is not None and target.type == "MESH", "target mesh missing"
    modifier = target.modifiers.get(MODIFIER_NAME)
    assert modifier is not None and modifier.type == "SUBSURF", "modifier missing"
    assert modifier.subdivision_type == "CATMULL_CLARK", "subdivision type mismatch"
    assert modifier.levels == 2, "viewport level mismatch"
    assert modifier.render_levels == 2, "render level mismatch"
    assert modifier.quality == 3, "quality mismatch"
    assert modifier.show_only_control_edges is True, "control-edge mismatch"
    assert modifier.use_creases is True, "creases mismatch"
    assert modifier.use_limit_surface is True, "limit-surface mismatch"
    assert modifier.boundary_smooth == "ALL", "boundary smoothing mismatch"
    assert modifier.uv_smooth == "PRESERVE_BOUNDARIES", "UV smoothing mismatch"
    assert modifier.use_custom_normals is False, "custom normals mismatch"
    assert modifier.show_viewport is True, "viewport visibility mismatch"
    assert modifier.show_render is True, "render visibility mismatch"
    assert modifier.show_in_editmode is True, "Edit Mode visibility mismatch"
    assert modifier.show_on_cage is False, "cage visibility mismatch"

    session = operating_line.get_session()
    completed = session.leaf_operation_runs.get(SUBDIVISION_SURFACE_LEAF_ID)
    assert completed is not None and completed.status == "completed", "run missing"
    assert len(completed.operation_receipts) == 4, "receipt count mismatch"
    assert session.pending_leaf_operation_run is None, "pending run remained"
    assert session.active_index == 1, f"active index mismatch: {session.active_index}"
    observations = session.success_gate_observation_copy(SUBDIVISION_SURFACE_LEAF_ID)
    assert observations is not None and len(observations) == 1, "observation missing"
    observation = observations[0]
    assert observation["kind"] == "modifier_ready", "observation kind mismatch"
    assert observation["satisfied"] is True, "observation unsatisfied"
    details = observation["details"]
    assert details["propertiesMatch"] is True, "properties proof failed"
    assert details["sourceContentIntact"] is True, "source proof failed"
    assert details["evaluatedWithinLimits"] is True, "topology proof failed"

    return {
        "status": operating_line.get_companion().status,
        "modifierCount": len(target.modifiers),
        "operationReceiptCount": len(completed.operation_receipts),
        "observationSatisfied": observation["satisfied"],
        "propertiesMatch": details["propertiesMatch"],
        "sourceContentIntact": details["sourceContentIntact"],
        "evaluatedWithinLimits": details["evaluatedWithinLimits"],
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
                "Timed out waiting for four-step Subdivision Surface completion: "
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
        if walkthrough_started and not creator_completed and session.active_index < 0:
            if bpy.ops.operating_line.next() != {"FINISHED"}:
                raise RuntimeError(f"Creator leaf execution failed: {controller.error}")
            creator_completed = True
        if FINAL_ACCEPTED_PATH.exists():
            marker = json.loads(FINAL_ACCEPTED_PATH.read_text(encoding="utf-8"))
            assert marker["status"] == "succeeded"
            assert controller.status == f"Leaf {SUBDIVISION_SURFACE_LEAF_ID} completed"
            finish(final_subdivision_surface_result(), ok=True)
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
