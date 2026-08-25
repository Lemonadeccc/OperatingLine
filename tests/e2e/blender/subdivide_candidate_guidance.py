"""Real-Blender smoke proof for the display-only Subdivide menu candidate.

The candidate teaches Blender's native in-place workflow, but it must never be
confused with or execute the managed replacement-mesh action.  Each process
captures one isolated UI state while structured assertions prove the complete
01-11 instruction model and scene immutability.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import traceback
from copy import deepcopy
from pathlib import Path

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
CATALOG_PATH = REPO_ROOT / "adapters" / "blender" / "catalog" / "v1" / "interaction-catalog.json"
STATE = os.environ["OPERATINGLINE_CANDIDATE_GUIDANCE_STATE"]
RESULT_PATH = Path(os.environ["OPERATINGLINE_CANDIDATE_GUIDANCE_RESULT"])
SCREENSHOT_PATH = Path(os.environ["OPERATINGLINE_CANDIDATE_GUIDANCE_SCREENSHOT"])
VALID_STATES = {
    "candidate-overview",
    "candidate-navigation",
    "candidate-select-menu",
    "candidate-edge-menu",
}
if STATE not in VALID_STATES:
    raise ValueError(f"Unknown candidate guidance state: {STATE}")

ACTION_ARGUMENTS = {
    "targetId": "candidate.factory_cube",
    "resultMeshId": "candidate.factory_cube.subdivided_mesh",
    "resultMeshName": "OperatingLine.CandidateGuidance.SubdividedMesh",
    "cuts": 3,
    "smooth": 0.25,
}

spec = importlib.util.spec_from_file_location(
    "operating_line_candidate_guidance_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_candidate_guidance_e2e.operating_line.infrastructure.native_history import (  # noqa: E402
    NATIVE_HISTORY_MARKER_KEY,
    native_history_checkpoint_count,
)
from operating_line_candidate_guidance_e2e.operating_line.presentation.native_menu_guidance import (  # noqa: E402
    candidate_menu_snapshot,
    guided_menu_action_matches,
    interaction_guidance_snapshot,
    native_menu_guidance_enabled,
    native_menu_snapshot,
)


def _write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _parameter_value(source: dict[str, object]) -> object:
    kind = source.get("kind")
    if kind == "literal":
        return deepcopy(source.get("value"))
    if kind == "action_argument" and source.get("transform") == "identity":
        argument_name = source.get("argumentName")
        assert isinstance(argument_name, str)
        return deepcopy(ACTION_ARGUMENTS[argument_name])
    raise AssertionError(f"Unsupported candidate parameter source: {source!r}")


def _candidate_plan() -> tuple[dict[str, object], dict[str, object]]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    recipe = next(
        item
        for item in catalog["recipes"]
        if item["actionName"] == "blender.mesh.edit_subdivide"
    )
    declaration = recipe["procedureMaterialization"]["menuCandidate"]
    native_evidence = declaration["nativeEvidence"]
    assert native_evidence == {
        "kind": "bounded_blender_ui_probe",
        "executorId": "blender.mesh_edit_subdivide_candidate_menu_f9.event_simulate.v1",
        "hostVersions": ["4.5.3", "5.1.1"],
        "managedActionExecuted": False,
        "managedReceiptCreated": False,
        "managedReplacementMeshCreated": False,
        "nativeMutationKind": "in_place_edit_mesh_subdivide",
        "operationIds": [
            operation["id"] for operation in declaration["operations"]
        ],
        "nativeUndoCheckpointRequired": True,
        "nativeUndoDepth": 4,
        "nativeRedoDepth": 4,
    }
    operations = []
    for ordinal, operation in enumerate(declaration["operations"], start=1):
        parameters = {
            assignment["name"]: _parameter_value(assignment["source"])
            for assignment in operation["parameters"]
        }
        operations.append(
            {
                "id": operation["id"],
                "order": ordinal,
                "semanticRefs": ["semantic.mesh.edit_subdivide"],
                "description": operation["label"],
                "evidenceRefs": [],
                "intent": operation["intent"],
                "target": deepcopy(operation["target"]),
                "path": deepcopy(operation["path"]),
                "parameters": parameters,
            }
        )
    projection = {
        "projection": declaration["projection"],
        "interactionCatalogVersion": catalog["catalogVersion"],
        "id": f"{recipe['id']}.menu-candidate",
        "modality": "menu",
        "equivalence": declaration["equivalence"],
        "executionAuthority": declaration["executionAuthority"],
        "title": f"{recipe['title']} menu candidate",
        "reason": declaration["reason"],
        "preconditions": deepcopy(declaration["preconditions"]),
        "operations": operations,
        "omittedActionArguments": deepcopy(declaration["omittedActionArguments"]),
        "nativeEvidence": deepcopy(native_evidence),
    }
    plan = {
        "protocolVersion": "1.7.0",
        "id": "subdivide-candidate-guidance-e2e",
        "revision": 1,
        "rootStepId": "candidate.subdivide",
        "steps": [
            {
                "id": "candidate.subdivide",
                "parentId": None,
                "order": 0,
                "dependsOn": [],
                "title": "Inspect the native Subdivide candidate",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.edit_subdivide",
                    "arguments": deepcopy(ACTION_ARGUMENTS),
                },
                "anchors": [],
                "expectedObservations": [],
                "candidateMenuProjection": projection,
            }
        ],
    }
    return plan, projection


def _mesh_geometry_sha256(mesh: bpy.types.Mesh) -> str:
    geometry = {
        "vertices": [
            [round(component, 9) for component in vertex.co]
            for vertex in mesh.vertices
        ],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
    }
    return hashlib.sha256(
        json.dumps(geometry, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def _scene_evidence() -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    state = {
        "mode": bpy.context.mode,
        "activeObject": active.name,
        "selectedObjects": sorted(item.name for item in bpy.context.selected_objects),
        "sceneObjects": sorted(
            (
                {"name": item.name, "type": item.type}
                for item in bpy.context.scene.objects
            ),
            key=lambda item: (item["name"], item["type"]),
        ),
        "objectPointer": active.as_pointer(),
        "meshPointer": active.data.as_pointer(),
        "meshDatablockCount": len(bpy.data.meshes),
        "topology": {
            "vertices": len(active.data.vertices),
            "edges": len(active.data.edges),
            "polygons": len(active.data.polygons),
        },
        "geometrySha256": _mesh_geometry_sha256(active.data),
        "replacementMeshExists": bpy.data.meshes.get(
            ACTION_ARGUMENTS["resultMeshName"]
        )
        is not None,
        "historyMarker": bpy.context.scene.get(NATIVE_HISTORY_MARKER_KEY),
    }
    state["stateSha256"] = hashlib.sha256(
        json.dumps(state, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()
    return state


def _snapshot_payload(snapshot) -> dict[str, object]:
    return {
        "catalogVersion": snapshot.catalog_version,
        "recipeId": snapshot.recipe_id,
        "title": snapshot.title,
        "candidateOnly": snapshot.candidate_only,
        "managedEquivalent": snapshot.managed_equivalent,
        "nativePath": snapshot.native,
        "focusedOrdinal": snapshot.focused_ordinal,
        "retrySerial": snapshot.retry_serial,
        "operations": [
            {
                "ordinal": operation.ordinal,
                "id": operation.operation_id,
                "label": operation.label,
                "intent": operation.intent,
                "targetKind": operation.target_kind,
                "targetId": operation.target_id,
                "path": list(operation.path),
                "parameters": {
                    parameter.name: parameter.value
                    for parameter in operation.parameters
                },
                "native": operation.native,
                "targetTrust": operation.target_trust.value,
            }
            for operation in snapshot.operations
        ],
    }


def _move_leaf(operator_name: str):
    snapshot = interaction_guidance_snapshot()
    assert snapshot is not None
    focused = snapshot.focused_operation
    operator = getattr(bpy.ops.operating_line, operator_name)
    result = operator(
        step_id=snapshot.step_id,
        operation_id=focused.operation_id,
        ordinal=snapshot.focused_ordinal,
        cursor_token=snapshot.cursor_token,
    )
    assert result == {"FINISHED"}
    updated = interaction_guidance_snapshot()
    assert updated is not None
    return updated


def _focus_ordinal(ordinal: int):
    snapshot = interaction_guidance_snapshot()
    assert snapshot is not None
    while snapshot.focused_ordinal < ordinal:
        snapshot = _move_leaf("leaf_operation_next")
    assert snapshot.focused_ordinal == ordinal
    return snapshot


def _view3d_context():
    window = bpy.context.window
    assert window is not None
    area = next(item for item in window.screen.areas if item.type == "VIEW_3D")
    region = next(item for item in area.regions if item.type == "WINDOW")
    return area, region, area.spaces.active


extension_registered = False
result_payload: dict[str, object] = {}
capture_baseline: dict[str, object] | None = None


def _guard_timer(callback):
    def guarded():
        try:
            return callback()
        except Exception as error:
            traceback.print_exc()
            _write_result(
                {
                    "ok": False,
                    "state": STATE,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            )
            sys.stdout.flush()
            sys.stderr.flush()
            os._exit(1)

    return guarded


def _prepare_capture():
    global capture_baseline
    area, region, space = _view3d_context()
    space.show_region_ui = True
    bpy.context.preferences.view.show_tooltips = False
    bpy.context.window.cursor_warp(area.x + area.width - 20, area.y + area.height - 20)

    menu_name = None
    menu_result = None
    if STATE in {"candidate-select-menu", "candidate-edge-menu"}:
        menu_name = (
            "VIEW3D_MT_select_edit_mesh"
            if STATE == "candidate-select-menu"
            else "VIEW3D_MT_edit_mesh_edges"
        )
        assert bpy.context.mode == "EDIT_MESH"
        capture_baseline = _scene_evidence()
        with bpy.context.temp_override(area=area, region=region, space_data=space):
            menu_result = bpy.ops.wm.call_menu("EXEC_DEFAULT", name=menu_name)
        assert menu_result in ({"INTERFACE"}, {"RUNNING_MODAL"})
    else:
        capture_baseline = _scene_evidence()
        with bpy.context.temp_override(area=area, region=region, space_data=space):
            menu_result = bpy.ops.wm.call_panel(
                "EXEC_DEFAULT",
                name="OPERATINGLINE_PT_sidebar",
                keep_open=True,
            )
        assert menu_result in ({"INTERFACE"}, {"RUNNING_MODAL"})

    result_payload["ui"] = {
        "menuName": menu_name,
        "invocationResult": sorted(menu_result),
        "nativeMenuPatchesEnabled": native_menu_guidance_enabled(),
        "expectedVisibleLabel": {
            "candidate-select-menu": "All    05 CANDIDATE ONLY",
            "candidate-edge-menu": "Subdivide    07 CANDIDATE ONLY",
        }.get(STATE),
    }
    bpy.app.timers.register(_guard_timer(_capture), first_interval=0.5)
    return None


def _dismiss_splash():
    window = bpy.context.window
    assert window is not None
    window.event_simulate(type="ESC", value="PRESS")
    window.event_simulate(type="ESC", value="RELEASE")
    bpy.app.timers.register(_guard_timer(_prepare_capture), first_interval=0.3)
    return None


def _capture():
    assert capture_baseline is not None
    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=2)
    SCREENSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.screen.screenshot(filepath=str(SCREENSHOT_PATH))
    assert SCREENSHOT_PATH.is_file() and SCREENSHOT_PATH.stat().st_size > 10_000

    image = bpy.data.images.load(str(SCREENSHOT_PATH), check_existing=False)
    try:
        image_size = [int(image.size[0]), int(image.size[1])]
    finally:
        bpy.data.images.remove(image)

    after_capture = _scene_evidence()
    assert after_capture == capture_baseline
    session = extension.get_session()
    assert session.active_index == -1
    assert tuple(session.receipts) == ()
    assert native_history_checkpoint_count() == result_payload["history"]["after"]
    assert bpy.data.meshes.get(ACTION_ARGUMENTS["resultMeshName"]) is None

    result_payload["screenshot"] = {
        "bytes": SCREENSHOT_PATH.stat().st_size,
        "size": image_size,
    }
    result_payload["captureStateUnchanged"] = True
    result_payload["ok"] = True
    _write_result(result_payload)
    print(
        f"OperatingLine candidate guidance captured: {STATE} on {bpy.app.version_string}",
        flush=True,
    )
    bpy.app.timers.register(_guard_timer(_cleanup), first_interval=0.25)
    return None


def _cleanup():
    global extension_registered
    if extension_registered:
        extension.unregister()
        extension_registered = False
    bpy.ops.wm.quit_blender()
    return None


def _configure() -> None:
    global extension_registered, result_payload
    extension.register()
    extension_registered = True
    plan, projection = _candidate_plan()
    assert extension.get_companion().install_plan(plan)
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    session = extension.get_session()
    assert session.active_index == -1
    assert tuple(session.receipts) == ()

    snapshot = candidate_menu_snapshot()
    assert snapshot is not None
    assert interaction_guidance_snapshot() is snapshot or interaction_guidance_snapshot() == snapshot
    assert native_menu_snapshot() is None
    assert not snapshot.accepts("mesh.subdivide")
    assert not guided_menu_action_matches(snapshot.step_id, "mesh.subdivide")
    assert snapshot.candidate_only
    assert not snapshot.managed_equivalent
    assert tuple(operation.ordinal for operation in snapshot.operations) == tuple(
        range(1, 12)
    )
    assert tuple(operation.native for operation in snapshot.operations) == (
        False,
        False,
        False,
        True,
        True,
        True,
        True,
        False,
        False,
        False,
        False,
    )
    assert tuple(operation.target_trust.value for operation in snapshot.operations) == (
        "reference_only",
        "reference_only",
        "reference_only",
        "exact_native",
        "exact_native",
        "exact_native",
        "exact_native",
        "reference_only",
        "reference_only",
        "reference_only",
        "reference_only",
    )
    assert snapshot.operations[8].parameters[0].value == ACTION_ARGUMENTS["cuts"]
    assert snapshot.operations[9].parameters[0].value == ACTION_ARGUMENTS["smooth"]
    assert (
        session.guidance_step.candidate_menu_projection.native_evidence
        == projection["nativeEvidence"]
    )

    baseline = _scene_evidence()
    checkpoints_before = native_history_checkpoint_count()
    global_next_result = bpy.ops.operating_line.next()
    assert global_next_result == {"CANCELLED"}
    assert _scene_evidence() == baseline
    assert native_history_checkpoint_count() == checkpoints_before
    assert session.active_index == -1
    assert tuple(session.receipts) == ()

    navigation_trace = [
        {"focusedOrdinal": snapshot.focused_ordinal, "retrySerial": snapshot.retry_serial}
    ]
    if STATE == "candidate-navigation":
        snapshot = _move_leaf("leaf_operation_next")
        navigation_trace.append(
            {"focusedOrdinal": snapshot.focused_ordinal, "retrySerial": snapshot.retry_serial}
        )
        snapshot = _move_leaf("leaf_operation_next")
        navigation_trace.append(
            {"focusedOrdinal": snapshot.focused_ordinal, "retrySerial": snapshot.retry_serial}
        )
        snapshot = _move_leaf("leaf_operation_retry")
        navigation_trace.append(
            {"focusedOrdinal": snapshot.focused_ordinal, "retrySerial": snapshot.retry_serial}
        )
        snapshot = _move_leaf("leaf_operation_back")
        navigation_trace.append(
            {"focusedOrdinal": snapshot.focused_ordinal, "retrySerial": snapshot.retry_serial}
        )
        assert navigation_trace == [
            {"focusedOrdinal": 1, "retrySerial": 0},
            {"focusedOrdinal": 2, "retrySerial": 0},
            {"focusedOrdinal": 3, "retrySerial": 0},
            {"focusedOrdinal": 3, "retrySerial": 1},
            {"focusedOrdinal": 2, "retrySerial": 1},
        ]
    elif STATE == "candidate-select-menu":
        snapshot = _focus_ordinal(5)
    elif STATE == "candidate-edge-menu":
        snapshot = _focus_ordinal(7)

    assert _scene_evidence() == baseline
    assert native_history_checkpoint_count() == checkpoints_before
    assert session.active_index == -1
    assert tuple(session.receipts) == ()

    if STATE in {"candidate-select-menu", "candidate-edge-menu"}:
        area, region, space = _view3d_context()
        with bpy.context.temp_override(area=area, region=region, space_data=space):
            assert bpy.ops.object.mode_set(mode="EDIT") == {"FINISHED"}
        assert bpy.context.mode == "EDIT_MESH"

    result_payload = {
        "ok": False,
        "state": STATE,
        "blenderVersion": bpy.app.version_string,
        "projection": {
            "projection": projection["projection"],
            "equivalence": projection["equivalence"],
            "executionAuthority": projection["executionAuthority"],
            "nativeEvidence": deepcopy(projection["nativeEvidence"]),
        },
        "candidate": _snapshot_payload(snapshot),
        "authority": {
            "nativeMenuSnapshotAbsent": native_menu_snapshot() is None,
            "acceptsSubdivide": snapshot.accepts("mesh.subdivide"),
            "guidedMenuActionMatches": guided_menu_action_matches(
                snapshot.step_id, "mesh.subdivide"
            ),
            "globalNextResult": sorted(global_next_result),
        },
        "history": {
            "before": checkpoints_before,
            "after": native_history_checkpoint_count(),
        },
        "session": {
            "activeIndex": session.active_index,
            "receiptCount": len(session.receipts),
        },
        "navigationTrace": navigation_trace,
        "preCaptureState": _scene_evidence(),
    }
    bpy.app.timers.register(_guard_timer(_dismiss_splash), first_interval=0.5)


try:
    _configure()
except Exception as error:
    traceback.print_exc()
    _write_result(
        {
            "ok": False,
            "state": STATE,
            "error": str(error),
            "traceback": traceback.format_exc(),
        }
    )
    if extension_registered:
        extension.unregister()
    raise
