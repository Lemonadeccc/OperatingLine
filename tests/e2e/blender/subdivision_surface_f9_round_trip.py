"""Foreground proof for the production Subdivision Surface shortcut driver."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path
import sys

import bpy


sys.dont_write_bytecode = True
RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_F9_RESULT"])
TARGET_LEVEL = int(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_VIEWPORT_LEVEL"])
FIXTURE_IDENTITY = {
    "proof_id": "00000000-0000-4000-8000-000000000021",
    "request_id": "00000000-0000-4000-8000-000000000022",
    "delivery_id": "00000000-0000-4000-8000-000000000023",
    "binding_content_sha256": "b" * 64,
}
REPO_ROOT = Path(__file__).resolve().parents[3]
DRIVER_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
    / "infrastructure"
    / "shortcut_proof.py"
)
spec = importlib.util.spec_from_file_location(
    "operating_line_subdivision_surface_shortcut_proof_e2e",
    DRIVER_PATH,
)
assert spec is not None and spec.loader is not None
shortcut_proof = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shortcut_proof
spec.loader.exec_module(shortcut_proof)


def canonical_factory_cube_from_scene_snapshot(
    snapshot: dict[str, object],
) -> dict[str, object]:
    mesh = snapshot["mesh"]
    return {
        "transform": snapshot["transform"],
        "geometry": {
            key: mesh[key]
            for key in (
                "vertices",
                "edgeEndpoints",
                "quadFaces",
                "shapeKeys",
                "hasCustomNormals",
                "subdivisionAttributes",
            )
        },
    }


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def fail(payload: dict[str, object]) -> None:
    write_result(payload)
    print("SUBDIVISION_SURFACE_F9 FAIL " + json.dumps(payload, sort_keys=True), flush=True)
    os._exit(1)


def complete(payload: dict[str, object]) -> None:
    receipts = payload["operationReceipts"]
    preflight = payload["preflight"]
    observation = payload["observation"]
    native_history = payload["nativeHistory"]
    baseline_snapshot = payload["baselineSceneSnapshot"]
    final_snapshot = payload["finalSceneSnapshot"]
    assert isinstance(receipts, list) and len(receipts) == 4
    assert shortcut_proof.verify_operation_receipt_chain(receipts)
    assert payload == {
        **payload,
        "ok": True,
        "executorId": shortcut_proof.EXECUTOR_ID,
        "evidenceClass": "blender_event_simulation",
        "osHidInput": False,
        "managedActionResult": "not_executed",
        "managedIdentityVerified": False,
        "operationReceiptChainVerified": True,
    }
    assert [receipt["operationId"] for receipt in receipts] == list(
        shortcut_proof.OPERATION_IDS
    )
    assert all(
        receipt["proofId"] == FIXTURE_IDENTITY["proof_id"]
        and receipt["requestId"] == FIXTURE_IDENTITY["request_id"]
        and receipt["deliveryId"] == FIXTURE_IDENTITY["delivery_id"]
        and receipt["bindingContentSha256"]
        == FIXTURE_IDENTITY["binding_content_sha256"]
        for receipt in receipts
    )
    assert [len(receipt["eventEvidence"]) for receipt in receipts] == [2, 2, 9, 2]
    assert preflight == {
        "satisfied": True,
        "targetProfile": "factory_cube_8_12_6",
        "authorizationHookVerified": True,
        "blenderVersionSupported": True,
        "splashDisabled": True,
        "workspace": "Layout",
        "areaType": "VIEW_3D",
        "regionType": "WINDOW",
        "keymap": "Blender",
        "eventSimulateCapability": "callable",
        "modalOperatorCount": 0,
        "objectName": "Cube",
        "objectPointer": observation["objectPointer"],
        "meshPointer": observation["meshPointer"],
        "meshDatablockCount": observation["meshDatablockCount"],
        "mode": "OBJECT",
        "selectedObjectCount": 1,
        "modifierCount": 0,
        "topology": {"vertices": 8, "edges": 12, "polygons": 6},
    }
    assert payload["mutationStarted"] is True
    assert payload["targetProfile"] == "factory_cube_8_12_6"
    assert payload["lastCompletedOperation"] == shortcut_proof.OPERATION_IDS[-1]
    assert payload["requiresUndoToUnlock"] is True
    assert (
        shortcut_proof.compute_shortcut_scene_fingerprint_sha256(baseline_snapshot)
        == payload["baselineSceneFingerprintSha256"]
        == native_history["undoObservation"]["sceneFingerprintSha256"]
    )
    assert (
        shortcut_proof.compute_shortcut_scene_fingerprint_sha256(final_snapshot)
        == payload["finalSceneFingerprintSha256"]
        == observation["sceneFingerprintSha256"]
        == native_history["redoObservation"]["sceneFingerprintSha256"]
    )
    assert "pointer" not in json.dumps(baseline_snapshot).lower()
    assert "pointer" not in json.dumps(final_snapshot).lower()
    shortcut_proof.validate_factory_cube_canonical_snapshot(
        canonical_factory_cube_from_scene_snapshot(baseline_snapshot)
    )
    shortcut_proof.validate_factory_cube_canonical_snapshot(
        canonical_factory_cube_from_scene_snapshot(final_snapshot)
    )
    assert baseline_snapshot["transform"] == final_snapshot["transform"]
    assert {
        key: baseline_snapshot["mesh"][key]
        for key in (
            "vertices",
            "edgeEndpoints",
            "quadFaces",
            "shapeKeys",
            "hasCustomNormals",
            "subdivisionAttributes",
        )
    } == {
        key: final_snapshot["mesh"][key]
        for key in (
            "vertices",
            "edgeEndpoints",
            "quadFaces",
            "shapeKeys",
            "hasCustomNormals",
            "subdivisionAttributes",
        )
    }
    assert baseline_snapshot["modifiers"] == []
    assert len(final_snapshot["modifiers"]) == 1
    assert final_snapshot["modifiers"][0]["type"] == "SUBSURF"
    assert final_snapshot["modifiers"][0]["levels"] == TARGET_LEVEL
    anchor = payload["contextAnchorEventEvidence"]
    assert anchor["type"] == "MOUSEMOVE" and anchor["value"] == "NOTHING"
    assert anchor["ctrl"] is False and anchor["shift"] is False
    assert anchor["point"]["role"] == "viewport_center"
    assert all(
        event["type"] != "ESC"
        for receipt in receipts
        for event in receipt["eventEvidence"]
    )
    assert [event["type"] for event in receipts[0]["eventEvidence"]] == [
        "ONE",
        "ONE",
    ]
    assert all(event["ctrl"] is True for event in receipts[0]["eventEvidence"])
    assert [event["type"] for event in receipts[1]["eventEvidence"]] == ["F9", "F9"]
    assert [event["type"] for event in receipts[2]["eventEvidence"]] == [
        "MOUSEMOVE",
        "LEFTMOUSE",
        "LEFTMOUSE",
        "LEFTMOUSE",
        "LEFTMOUSE",
        "A",
        {1: "ONE", 2: "TWO", 3: "THREE"}[TARGET_LEVEL],
        "RET",
        "RET",
    ]
    assert [event["type"] for event in receipts[3]["eventEvidence"]] == ["RET", "RET"]
    assert isinstance(observation, dict)
    assert observation["satisfied"] is True
    assert observation["viewportLevel"] == TARGET_LEVEL
    assert observation["objectIdentityUnchanged"] is True
    assert observation["meshIdentityUnchanged"] is True
    assert observation["meshDatablockCountUnchanged"] is True
    assert observation["modeUnchanged"] is True
    assert isinstance(observation["observedAt"], str) and observation["observedAt"]
    assert isinstance(native_history, dict)
    assert native_history["availability"] == "verified"
    assert native_history["boundary"] == "single_native_undo_redo"
    assert [event["type"] for event in native_history["eventEvidence"]["undo"]] == [
        "Z",
        "Z",
    ]
    assert all(event["ctrl"] is True for event in native_history["eventEvidence"]["undo"])
    assert all(
        event["ctrl"] is True and event["shift"] is True
        for event in native_history["eventEvidence"]["redo"]
    )
    assert native_history["undoObservation"]["subsurfModifierCount"] == 0
    assert native_history["redoObservation"]["viewportLevel"] == TARGET_LEVEL
    write_result(payload)
    print("SUBDIVISION_SURFACE_F9 PASS " + json.dumps(payload, sort_keys=True), flush=True)
    bpy.ops.wm.quit_blender()


print(
    "SUBDIVISION_SURFACE_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "executorId": shortcut_proof.EXECUTOR_ID,
            "viewportLevel": TARGET_LEVEL,
        },
        sort_keys=True,
    ),
    flush=True,
)
factory_cube_snapshot = shortcut_proof.build_factory_cube_canonical_snapshot(
    bpy.context.view_layer.objects.active
)
shortcut_proof.validate_factory_cube_canonical_snapshot(factory_cube_snapshot)
tampered_factory_cube_snapshot = copy.deepcopy(factory_cube_snapshot)
tampered_factory_cube_snapshot["geometry"]["vertices"][0][0] = -0.5
try:
    shortcut_proof.validate_factory_cube_canonical_snapshot(
        tampered_factory_cube_snapshot
    )
except RuntimeError as error:
    assert "canonical factory Cube vertices" in str(error)
else:
    raise AssertionError("Factory Cube validation accepted non-canonical geometry")
factory_mesh = bpy.context.view_layer.objects.active.data
crease_attribute = factory_mesh.attributes.new(
    name="crease_edge",
    type="FLOAT",
    domain="EDGE",
)
crease_attribute.data[0].value = 1.0
try:
    shortcut_proof.validate_factory_cube_canonical_snapshot(
        shortcut_proof.build_factory_cube_canonical_snapshot(
            bpy.context.view_layer.objects.active
        )
    )
except RuntimeError as error:
    assert "default factory Cube subdivision attributes" in str(error)
else:
    raise AssertionError("Factory Cube validation accepted a non-zero edge crease")
finally:
    factory_mesh.attributes.remove(crease_attribute)
shortcut_proof.validate_factory_cube_canonical_snapshot(
    shortcut_proof.build_factory_cube_canonical_snapshot(
        bpy.context.view_layer.objects.active
    )
)
driver = shortcut_proof.SubdivisionSurfaceF9ShortcutProof(
    TARGET_LEVEL,
    **FIXTURE_IDENTITY,
)
driver.start(
    preflight_hook=lambda: True,
    on_complete=complete,
    on_failure=fail,
)
