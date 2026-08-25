"""Live Blender proof for the accepted six-step Extrude Region MCP rail."""

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
RESULT_PATH = Path(os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_RESULT"])
FINAL_ACCEPTED_PATH = Path(
    os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_FINAL_ACCEPTED"]
)
PROXY_FAILURE_PATH = Path(
    os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_PROXY_FAILURE"]
)
DIAGNOSTIC_PATH = Path(os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_DIAGNOSTIC"])
RUNTIME_URL = os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_EDIT_EXTRUDE_REGION_LEAF_TIMEOUT", "180"))

CREATOR_LEAF_ID = "snowman.head.eyes.left"
EDIT_EXTRUDE_REGION_LEAF_ID = f"{CREATOR_LEAF_ID}.edit_extrude_region"
TARGET_NAME = "OperatingLine.EyeLeft"
SOURCE_MESH_NAME = f"{TARGET_NAME}.Mesh"
RESULT_MESH_NAME = "OperatingLine.GuidedEditExtrudeRegionResult"

spec = importlib.util.spec_from_file_location(
    "operating_line_edit_extrude_region_leaf_e2e",
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
        f"EDIT_EXTRUDE_REGION_LEAF_OPERATION_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def final_edit_extrude_region_result() -> dict[str, object]:
    target = bpy.data.objects.get(TARGET_NAME)
    assert target is not None and target.type == "MESH", "target mesh missing"
    assert target.mode == "OBJECT", "managed replacement did not remain in Object Mode"
    assert not target.modifiers, "Extrude Region target unexpectedly has modifiers"
    source_mesh = bpy.data.meshes.get(SOURCE_MESH_NAME)
    result_mesh = bpy.data.meshes.get(RESULT_MESH_NAME)
    assert source_mesh is not None, "source mesh missing"
    assert result_mesh is not None and target.data is result_mesh, "result mesh not assigned"
    source_topology = (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    )
    result_topology = (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    )
    assert source_topology == (8, 12, 6), f"source topology mismatch: {source_topology}"
    assert result_topology == (12, 20, 10), f"result topology mismatch: {result_topology}"

    session = operating_line.get_session()
    completed = session.leaf_operation_runs.get(EDIT_EXTRUDE_REGION_LEAF_ID)
    assert completed is not None and completed.status == "completed", "run missing"
    assert len(completed.operation_receipts) == 6, "receipt count mismatch"
    assert session.pending_leaf_operation_run is None, "pending run remained"
    assert session.active_index == 1, f"active index mismatch: {session.active_index}"
    observations = session.success_gate_observation_copy(EDIT_EXTRUDE_REGION_LEAF_ID)
    assert observations is not None and len(observations) == 1, "observation missing"
    observation = observations[0]
    assert observation["kind"] == "mesh_region_extruded", "observation kind mismatch"
    assert observation["satisfied"] is True, "observation unsatisfied"
    details = observation["details"]
    assert details["topologyMatches"] is True, "exact topology proof failed"
    assert details["topologyGrew"] is True, "topology growth proof failed"
    selection_counts = (
        details["selectedFaceCount"],
        details["selectedEdgeCount"],
        details["selectedVertexCount"],
        details["boundaryEdgeCount"],
    )
    assert selection_counts == (1, 4, 4, 4), "selection topology proof failed"
    assert (
        details["expectedVertexCount"],
        details["expectedEdgeCount"],
        details["expectedFaceCount"],
    ) == (12, 20, 10), "expected topology proof failed"
    assert details["sourceContentIntact"] is True, "source proof failed"
    assert details["contentIntact"] is True, "result proof failed"
    assert details["assigned"] is True, "Object data-link proof failed"
    assert details["receiptMatches"] is True, "receipt proof failed"
    assert details["resultNameMatches"] is True, "result name proof failed"
    assert details["withinLimits"] is True, "topology bound proof failed"

    return {
        "status": operating_line.get_companion().status,
        "operationReceiptCount": len(completed.operation_receipts),
        "observationSatisfied": observation["satisfied"],
        "sourceTopology": source_topology,
        "resultTopology": result_topology,
        "topologyMatches": details["topologyMatches"],
        "selectionCounts": selection_counts,
        "expectedTopology": (
            details["expectedVertexCount"],
            details["expectedEdgeCount"],
            details["expectedFaceCount"],
        ),
        "sourceContentIntact": details["sourceContentIntact"],
        "contentIntact": details["contentIntact"],
        "resultNameMatches": details["resultNameMatches"],
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
                "Timed out waiting for six-step Extrude Region completion: "
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
            assert controller.status == f"Leaf {EDIT_EXTRUDE_REGION_LEAF_ID} completed"
            finish(final_edit_extrude_region_result(), ok=True)
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
