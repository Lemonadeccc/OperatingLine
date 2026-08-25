"""Foreground UI proof for editing Subdivide properties through Blender's F9 panel."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import sys
import traceback
from copy import deepcopy
from pathlib import Path
from typing import Callable

import bpy
import bmesh


RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVIDE_F9_RESULT"])
ENTRY_MODE = os.environ.get("OPERATINGLINE_SUBDIVIDE_F9_ENTRY_MODE", "operator-search")
assert ENTRY_MODE in {"operator-search", "candidate-menu"}
NUMBER_CUTS_TEXT = os.environ["OPERATINGLINE_SUBDIVIDE_F9_NUMBER_CUTS"]
SMOOTHNESS_TEXT = os.environ["OPERATINGLINE_SUBDIVIDE_F9_SMOOTHNESS"]
NUMBER_CUTS = int(NUMBER_CUTS_TEXT)
SMOOTHNESS = float(SMOOTHNESS_TEXT)
assert NUMBER_CUTS_TEXT == str(NUMBER_CUTS)
assert 1 <= NUMBER_CUTS <= 8
assert math.isfinite(SMOOTHNESS)
assert 0.0 <= SMOOTHNESS <= 1.0
SUBDIVISIONS_PER_EDGE = NUMBER_CUTS + 1
EXPECTED_TOPOLOGY = {
    "vertices": 6 * SUBDIVISIONS_PER_EDGE**2 + 2,
    "edges": 12 * SUBDIVISIONS_PER_EDGE**2,
    "polygons": 6 * SUBDIVISIONS_PER_EDGE**2,
}

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
INTERACTION_CATALOG_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "interaction-catalog.json"
)
CANDIDATE_ACTION_ARGUMENTS = {
    "targetId": "candidate.factory_cube",
    "resultMeshId": "candidate.factory_cube.subdivided_mesh",
    "resultMeshName": "OperatingLine.CandidateMenuProof.SubdividedMesh",
    "cuts": NUMBER_CUTS,
    "smooth": SMOOTHNESS,
}
CANDIDATE_OPERATION_IDS: tuple[str, ...] = ()
candidate_menu_invocations: list[dict[str, object]] = []
disable_candidate_menu_guidance: Callable[[], None] | None = None
candidate_setup_session = None
candidate_setup_receipt_id: str | None = None

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale


def _candidate_parameter_value(source: dict[str, object]) -> object:
    if source.get("kind") == "literal":
        return deepcopy(source.get("value"))
    if source.get("kind") == "action_argument" and source.get("transform") == "identity":
        argument_name = source.get("argumentName")
        assert isinstance(argument_name, str)
        return deepcopy(CANDIDATE_ACTION_ARGUMENTS[argument_name])
    raise AssertionError(f"Unsupported candidate parameter source: {source!r}")


def enable_candidate_menu_proof() -> tuple[str, ...]:
    """Patch the real menus from one validated, display-only candidate Guide."""

    global candidate_setup_receipt_id, candidate_setup_session
    global disable_candidate_menu_guidance
    spec = importlib.util.spec_from_file_location(
        "operating_line_subdivide_candidate_menu_proof",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)

    from operating_line_subdivide_candidate_menu_proof.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_subdivide_candidate_menu_proof.operating_line.application import (
        DemoSession,
    )
    from operating_line_subdivide_candidate_menu_proof.operating_line.infrastructure import (
        action_registry,
        resolve_resource,
    )
    from operating_line_subdivide_candidate_menu_proof.operating_line.presentation.native_menu_guidance import (
        candidate_menu_snapshot,
        disable_native_menu_guidance,
        enable_native_menu_guidance,
        guided_menu_action_matches,
        native_menu_snapshot,
    )

    catalog = json.loads(INTERACTION_CATALOG_PATH.read_text(encoding="utf-8"))
    recipe = next(
        item
        for item in catalog["recipes"]
        if item["actionName"] == "blender.mesh.edit_subdivide"
    )
    declaration = recipe["procedureMaterialization"]["menuCandidate"]
    assert declaration["executionAuthority"] == "none"
    operations = [
        {
            "id": operation["id"],
            "order": ordinal,
            "semanticRefs": ["semantic.mesh.edit_subdivide"],
            "description": operation["label"],
            "evidenceRefs": [],
            "intent": operation["intent"],
            "target": deepcopy(operation["target"]),
            "path": deepcopy(operation["path"]),
            "parameters": {
                assignment["name"]: _candidate_parameter_value(assignment["source"])
                for assignment in operation["parameters"]
            },
        }
        for ordinal, operation in enumerate(declaration["operations"], start=1)
    ]
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
        **(
            {}
            if "nativeEvidence" not in declaration
            else {"nativeEvidence": deepcopy(declaration["nativeEvidence"])}
        ),
    }
    plan = {
        "protocolVersion": "1.7.0",
        "id": "subdivide-candidate-menu-proof",
        "revision": 1,
        "rootStepId": "candidate.proof",
        "steps": [
            {
                "id": "candidate.proof",
                "parentId": None,
                "order": 0,
                "dependsOn": [],
                "title": "Subdivide candidate proof",
                "action": None,
                "anchors": [],
                "expectedObservations": [],
            },
            {
                "id": "candidate.setup_cube",
                "parentId": "candidate.proof",
                "order": 1,
                "dependsOn": [],
                "title": "Create a receipt-bound target cube",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.create_cube",
                    "arguments": {
                        "resourceId": CANDIDATE_ACTION_ARGUMENTS["targetId"],
                        "objectName": "OperatingLine.CandidateMenuProofCube",
                        "size": 2.0,
                        "location": [0.0, 0.0, 0.0],
                    },
                },
                "anchors": [],
                "expectedObservations": [],
            },
            {
                "id": "candidate.subdivide",
                "parentId": "candidate.proof",
                "order": 2,
                "dependsOn": ["candidate.setup_cube"],
                "title": "Run the native Subdivide candidate",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.edit_subdivide",
                    "arguments": deepcopy(CANDIDATE_ACTION_ARGUMENTS),
                },
                "anchors": [],
                "expectedObservations": [],
                "candidateMenuProjection": projection,
            },
        ],
    }
    root = load_task_tree_data(plan)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id=plan["id"],
        revision=plan["revision"],
        source_plan=plan,
    )
    session.start()
    setup_step = session.next()
    assert setup_step is not None and setup_step.id == "candidate.setup_cube"
    setup_receipt = session.receipt_for_step(setup_step.id)
    assert setup_receipt is not None and len(session.receipts) == 1
    target_identities = tuple(
        identity
        for identity in setup_receipt.created
        if identity.logical_id == CANDIDATE_ACTION_ARGUMENTS["targetId"]
        and identity.resource_type == "OBJECT"
    )
    assert len(target_identities) == 1
    target_object = resolve_resource(target_identities[0])
    assert isinstance(target_object, bpy.types.Object)
    assert target_object.type == "MESH"
    bpy.ops.object.select_all(action="DESELECT")
    target_object.select_set(True)
    bpy.context.view_layer.objects.active = target_object
    assert session.guidance_step is not None
    assert session.guidance_step.id == "candidate.subdivide"
    assert bpy.ops.ed.undo_push(
        message="OperatingLine receipt-bound candidate baseline"
    ) == {"FINISHED"}
    candidate_setup_session = session
    candidate_setup_receipt_id = setup_receipt.receipt_id

    assert enable_native_menu_guidance(lambda: session)
    snapshot = candidate_menu_snapshot()
    assert snapshot is not None and snapshot.candidate_only
    assert not snapshot.managed_equivalent
    assert native_menu_snapshot() is None
    assert not snapshot.accepts("mesh.subdivide")
    assert not guided_menu_action_matches(root.id, "mesh.subdivide")
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    assert operation_ids == tuple(operation["id"] for operation in operations)
    disable_candidate_menu_guidance = disable_native_menu_guidance
    return operation_ids


if ENTRY_MODE == "candidate-menu":
    CANDIDATE_OPERATION_IDS = enable_candidate_menu_proof()


def mesh_geometry_fingerprint(mesh: bpy.types.Mesh) -> str:
    canonical_geometry = {
        "vertices": [
            [round(component, 9) for component in vertex.co]
            for vertex in mesh.vertices
        ],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
    }
    return hashlib.sha256(
        json.dumps(
            canonical_geometry,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def scene_state_evidence(active: bpy.types.Object) -> dict[str, object]:
    topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    canonical_state = {
        "workspace": window.workspace.name,
        "mode": bpy.context.mode,
        "activeObjectName": active.name,
        "selectedObjectNames": sorted(
            selected.name for selected in bpy.context.selected_objects
        ),
        "sceneObjects": sorted(
            [
                {"name": candidate.name, "type": candidate.type}
                for candidate in bpy.context.scene.objects
            ],
            key=lambda candidate: (candidate["name"], candidate["type"]),
        ),
        "transform": {
            "location": [round(component, 9) for component in active.location],
            "rotationEuler": [
                round(component, 9) for component in active.rotation_euler
            ],
            "scale": [round(component, 9) for component in active.scale],
        },
        "topology": topology,
        "geometrySha256": mesh_geometry_fingerprint(active.data),
    }
    return {
        **canonical_state,
        "stateSha256": hashlib.sha256(
            json.dumps(
                canonical_state,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest(),
    }


initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None
expected_object_name = (
    "OperatingLine.CandidateMenuProofCube"
    if ENTRY_MODE == "candidate-menu"
    else "Cube"
)
assert initial_active.name == expected_object_name
assert initial_active.type == "MESH"
assert window.workspace.name == "Layout"
assert bpy.context.selected_objects == [initial_active]
object_pointer_before = initial_active.as_pointer()
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)
if ENTRY_MODE == "candidate-menu":
    for vertex in initial_active.data.vertices:
        vertex.select = False
    initial_active.data.update()
    assert not any(vertex.select for vertex in initial_active.data.vertices)
baseline_geometry_fingerprint_before = mesh_geometry_fingerprint(initial_active.data)
baseline_state_evidence_before = scene_state_evidence(initial_active)

# The F9 popup is anchored at the viewport center. These logical offsets select
# its first two numeric rows at every verified UI scale.
number_cuts_point = (
    center_x + round(210 * ui_scale),
    center_y - round(50 * ui_scale),
)
smoothness_point = (
    center_x + round(210 * ui_scale),
    center_y - round(72.5 * ui_scale),
)

captured_operator_id: str | None = None
captured_properties: dict[str, object] = {}
history_snapshots: list[dict[str, object]] = []
simulated_events: list[dict[str, object]] = []


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def simulate(
    event_type: str,
    value: str = "PRESS",
    *,
    unicode: str = "",
    x: int | None = None,
    y: int | None = None,
    shift: bool = False,
    ctrl: bool = False,
) -> None:
    event: dict[str, object] = {
        "type": event_type,
        "value": value,
        "x": center_x if x is None else x,
        "y": center_y if y is None else y,
        "shift": shift,
        "ctrl": ctrl,
    }
    if unicode:
        event["unicode"] = unicode
    simulated_events.append(
        {
            "type": event_type,
            "value": value,
            "ctrl": ctrl,
            "shift": shift,
        }
    )
    window.event_simulate(**event)


def capture_subdivide_operator() -> None:
    global captured_operator_id, captured_properties

    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "MESH_OT_subdivide"
    ]
    assert candidates, "MESH_OT_subdivide was not present in the operator stack"
    operator = candidates[-1]
    captured_operator_id = operator.bl_idname
    captured_properties = {
        name: getattr(operator.properties, name)
        for name in ("number_cuts", "smoothness")
        if hasattr(operator.properties, name)
    }


def capture_history_snapshot(label: str) -> None:
    active = bpy.context.view_layer.objects.active
    assert active is not None
    assert active.type == "MESH"
    history_snapshots.append(
        {
            "label": label,
            **scene_state_evidence(active),
            "objectPointer": active.as_pointer(),
            "meshDataPointer": active.data.as_pointer(),
            "meshDatablockCount": len(bpy.data.meshes),
        }
    )


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert captured_operator_id == "MESH_OT_subdivide"
    assert captured_properties["number_cuts"] == NUMBER_CUTS
    assert math.isclose(
        captured_properties["smoothness"],
        SMOOTHNESS,
        rel_tol=0.0,
        abs_tol=1e-6,
    )
    assert bpy.context.mode == "OBJECT"
    assert active is not None
    assert active.type == "MESH"
    assert active.name == expected_object_name

    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before
    assert bpy.data.meshes.get(CANDIDATE_ACTION_ARGUMENTS["resultMeshName"]) is None

    topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    assert topology == EXPECTED_TOPOLOGY

    assert [snapshot["label"] for snapshot in history_snapshots] == [
        "applied",
        "undo-1",
        "undo-2",
        "undo-3",
        "undo-4",
        "redo-1",
        "redo-2",
        "redo-3",
        "redo-4",
    ]
    applied_snapshot = history_snapshots[0]
    undo_operation_snapshot = history_snapshots[1]
    restored_baseline_snapshot = history_snapshots[4]
    redo_snapshot = history_snapshots[8]
    assert applied_snapshot["mode"] == "OBJECT"
    assert applied_snapshot["topology"] == topology
    assert undo_operation_snapshot["mode"] == "EDIT_MESH"
    assert undo_operation_snapshot["topology"] == {
        "vertices": 8,
        "edges": 12,
        "polygons": 6,
    }
    assert (
        undo_operation_snapshot["geometrySha256"]
        == baseline_geometry_fingerprint_before
    )
    assert {
        key: restored_baseline_snapshot[key]
        for key in baseline_state_evidence_before
    } == baseline_state_evidence_before
    assert redo_snapshot["mode"] == "OBJECT"
    assert redo_snapshot["topology"] == topology
    assert redo_snapshot["stateSha256"] == applied_snapshot["stateSha256"]
    assert redo_snapshot["geometrySha256"] != restored_baseline_snapshot["geometrySha256"]
    assert all(
        snapshot["activeObjectName"] == expected_object_name
        and snapshot["objectPointer"] == object_pointer_before
        and snapshot["meshDataPointer"] == mesh_data_pointer_before
        and snapshot["meshDatablockCount"] == mesh_datablock_count_before
        for snapshot in history_snapshots
    )
    undo_event_evidence = simulated_events[-16:-8]
    redo_event_evidence = simulated_events[-8:]
    assert len(undo_event_evidence) == 8
    assert len(redo_event_evidence) == 8
    assert all(
        event == {
            "type": "Z",
            "value": "PRESS" if index % 2 == 0 else "RELEASE",
            "ctrl": True,
            "shift": False,
        }
        for index, event in enumerate(undo_event_evidence)
    )
    assert all(
        event == {
            "type": "Z",
            "value": "PRESS" if index % 2 == 0 else "RELEASE",
            "ctrl": True,
            "shift": True,
        }
        for index, event in enumerate(redo_event_evidence)
    )

    candidate_menu_evidence = None
    if ENTRY_MODE == "candidate-menu":
        assert candidate_setup_session is not None
        assert candidate_setup_session.active_index == 0
        assert len(candidate_setup_session.receipts) == 1
        setup_receipt = candidate_setup_session.receipt_for_step(
            "candidate.setup_cube"
        )
        assert setup_receipt is not None
        assert setup_receipt.receipt_id == candidate_setup_receipt_id
        assert candidate_setup_session.receipt_for_step("candidate.subdivide") is None
        assert CANDIDATE_OPERATION_IDS == (
            "candidate.workspace_layout",
            "candidate.use_accepted_active_mesh",
            "candidate.enter_edit_mode",
            "candidate.open_select_menu",
            "candidate.select_all_mesh_elements",
            "candidate.open_edge_menu",
            "candidate.execute_subdivide",
            "candidate.open_adjust_last_operation",
            "candidate.set_number_of_cuts",
            "candidate.set_smoothness",
            "candidate.return_to_object_mode",
        )
        assert candidate_menu_invocations == [
            {
                "operationId": "candidate.open_select_menu",
                "menuName": "VIEW3D_MT_select_edit_mesh",
                "result": ["INTERFACE"],
                "expectedVisibleLabel": "All    05 CANDIDATE ONLY",
            },
            {
                "operationId": "candidate.open_edge_menu",
                "menuName": "VIEW3D_MT_edit_mesh_edges",
                "result": ["INTERFACE"],
                "expectedVisibleLabel": "Subdivide    07 CANDIDATE ONLY",
            },
        ]
        candidate_menu_evidence = {
            "kind": "bounded_blender_ui_probe",
            "executorId": "blender.mesh_edit_subdivide_candidate_menu_f9.event_simulate.v1",
            "hostVersion": ".".join(str(component) for component in bpy.app.version[:3]),
            "managedActionExecuted": False,
            "managedReceiptCreated": False,
            "managedReplacementMeshCreated": False,
            "nativeMutationKind": "in_place_edit_mesh_subdivide",
            "targetBinding": {
                "logicalTargetId": CANDIDATE_ACTION_ARGUMENTS["targetId"],
                "objectName": expected_object_name,
                "setupStepId": "candidate.setup_cube",
                "setupReceiptId": setup_receipt.receipt_id,
                "setupReceiptCountBeforeCandidate": 1,
                "setupReceiptCountAfterCandidate": len(
                    candidate_setup_session.receipts
                ),
                "candidateReceiptCreated": False,
            },
            "operationIds": list(CANDIDATE_OPERATION_IDS),
            "menuInvocations": candidate_menu_invocations,
            "nativeUndoCheckpointRequired": True,
            "nativeUndoDepth": 4,
            "nativeRedoDepth": 4,
        }

    result = {
        "ok": True,
        "entryMode": ENTRY_MODE,
        "blenderVersion": bpy.app.version_string,
        "window": [window.width, window.height],
        "area": [area.x, area.y, area.width, area.height],
        "uiScale": ui_scale,
        "numberCutsPoint": number_cuts_point,
        "smoothnessPoint": smoothness_point,
        "operatorId": captured_operator_id,
        "properties": captured_properties,
        "requestedProperties": {
            "number_cuts": NUMBER_CUTS,
            "smoothness": SMOOTHNESS,
        },
        "topology": topology,
        "objectName": active.name,
        "mode": bpy.context.mode,
        "objectPointerBefore": object_pointer_before,
        "objectPointerAfter": active.as_pointer(),
        "meshDataPointerBefore": mesh_data_pointer_before,
        "meshDataPointerAfter": mesh_data_pointer_after,
        "meshDatablockCountBefore": mesh_datablock_count_before,
        "meshDatablockCountAfter": mesh_datablock_count_after,
        "nativeInPlaceMutationVerified": True,
        "popupCloseEventSent": True,
        "historySnapshots": history_snapshots,
        "nativeHistory": {
            "availability": "verified",
            "boundary": "full_procedure_native_undo_redo",
            "undoDepth": 4,
            "redoDepth": 4,
            "undoShortcut": "CTRL+Z",
            "redoShortcut": "CTRL+SHIFT+Z",
            "eventEvidence": {
                "undo": undo_event_evidence,
                "redo": redo_event_evidence,
            },
            "baselineProfile": (
                "receipt_bound_managed_cube"
                if ENTRY_MODE == "candidate-menu"
                else "factory_startup_cube"
            ),
            "baselineGeometryRestored": True,
            "baselineStateRestored": True,
            "parameterizedGeometryRestored": True,
            "expectedBaselineStateSha256": baseline_state_evidence_before[
                "stateSha256"
            ],
            "restoredBaselineStateSha256": restored_baseline_snapshot[
                "stateSha256"
            ],
            "appliedStateSha256": applied_snapshot["stateSha256"],
            "finalStateSha256": redo_snapshot["stateSha256"],
            "parameterEvidence": {
                "operatorId": captured_operator_id,
                "properties": captured_properties,
                "redoGeometrySha256": redo_snapshot["geometrySha256"],
            },
            "meshIdentityUnchanged": True,
            "meshDatablockCountUnchanged": True,
        },
        "candidateMenuEvidence": candidate_menu_evidence,
    }
    write_result(result)
    print("SUBDIVIDE_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
    if disable_candidate_menu_guidance is not None:
        disable_candidate_menu_guidance()
    bpy.ops.wm.quit_blender()


Step = tuple[str, float, Callable[[], None]]
steps: list[Step] = []


def add_event(
    label: str,
    event_type: str,
    value: str = "PRESS",
    *,
    delay: float = 0.1,
    unicode: str = "",
    x: int | None = None,
    y: int | None = None,
    shift: bool = False,
    ctrl: bool = False,
) -> None:
    steps.append(
        (
            label,
            delay,
            lambda: simulate(
                event_type,
                value,
                unicode=unicode,
                x=x,
                y=y,
                shift=shift,
                ctrl=ctrl,
            ),
        )
    )


def add_press_release(
    label: str,
    event_type: str,
    *,
    delay: float,
    x: int | None = None,
    y: int | None = None,
    shift: bool = False,
    ctrl: bool = False,
) -> None:
    add_event(
        label + ":press",
        event_type,
        delay=0.04,
        x=x,
        y=y,
        shift=shift,
        ctrl=ctrl,
    )
    add_event(
        label + ":release",
        event_type,
        "RELEASE",
        delay=delay,
        x=x,
        y=y,
        shift=shift,
        ctrl=ctrl,
    )


def add_double_click(label: str, point: tuple[int, int]) -> None:
    add_event(label + ":hover", "MOUSEMOVE", "NOTHING", x=point[0], y=point[1])
    for click_index in (1, 2):
        add_event(
            f"{label}:{click_index}:press",
            "LEFTMOUSE",
            delay=0.03,
            x=point[0],
            y=point[1],
        )
        add_event(
            f"{label}:{click_index}:release",
            "LEFTMOUSE",
            "RELEASE",
            delay=0.15 if click_index == 2 else 0.04,
            x=point[0],
            y=point[1],
        )


def add_text(label: str, text: str) -> None:
    event_names = {
        ".": "PERIOD",
        "0": "ZERO",
        "1": "ONE",
        "2": "TWO",
        "3": "THREE",
        "4": "FOUR",
        "5": "FIVE",
        "6": "SIX",
        "7": "SEVEN",
        "8": "EIGHT",
        "9": "NINE",
    }
    for character_index, character in enumerate(text):
        add_event(
            f"{label}:{character_index}:{character}",
            event_names.get(character, character.upper()),
            unicode=character,
            delay=0.04,
        )


def open_candidate_menu(
    operation_id: str,
    menu_name: str,
    expected_visible_label: str,
) -> None:
    assert ENTRY_MODE == "candidate-menu"
    assert bpy.context.mode == "EDIT_MESH"
    window.cursor_warp(area.x + area.width - 24, area.y + area.height - 24)
    result = bpy.ops.wm.call_menu("EXEC_DEFAULT", name=menu_name)
    assert result in ({"INTERFACE"}, {"RUNNING_MODAL"})
    candidate_menu_invocations.append(
        {
            "operationId": operation_id,
            "menuName": menu_name,
            "result": sorted(result),
            "expectedVisibleLabel": expected_visible_label,
        }
    )


def assert_candidate_select_all() -> None:
    assert ENTRY_MODE == "candidate-menu"
    assert bpy.context.mode == "EDIT_MESH"
    edit_mesh = bmesh.from_edit_mesh(initial_active.data)
    assert edit_mesh.verts
    assert all(vertex.select for vertex in edit_mesh.verts)
    assert any(
        operator.bl_idname == "MESH_OT_select_all"
        for operator in bpy.context.window_manager.operators
    )


def assert_candidate_subdivide_applied() -> None:
    assert ENTRY_MODE == "candidate-menu"
    assert bpy.context.mode == "EDIT_MESH"
    edit_mesh = bmesh.from_edit_mesh(initial_active.data)
    assert (len(edit_mesh.verts), len(edit_mesh.edges), len(edit_mesh.faces)) == (
        26,
        48,
        24,
    )
    assert any(
        operator.bl_idname == "MESH_OT_subdivide"
        for operator in bpy.context.window_manager.operators
    )


# Each UI event gets its own main-loop timer turn. Modeling reaches Blender only
# through Window.event_simulate; bpy is used after the popup closes for evidence.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("enter edit mode", "TAB", delay=0.3)
if ENTRY_MODE == "candidate-menu":
    steps.append(
        (
            "open candidate Select menu",
            0.3,
            lambda: open_candidate_menu(
                "candidate.open_select_menu",
                "VIEW3D_MT_select_edit_mesh",
                "All    05 CANDIDATE ONLY",
            ),
        )
    )
    add_press_release("execute candidate Select All", "RET", delay=0.4)
    steps.append(("verify candidate Select All", 0.1, assert_candidate_select_all))
    steps.append(
        (
            "open candidate Edge menu",
            0.3,
            lambda: open_candidate_menu(
                "candidate.open_edge_menu",
                "VIEW3D_MT_edit_mesh_edges",
                "Subdivide    07 CANDIDATE ONLY",
            ),
        )
    )
    add_press_release("execute candidate Subdivide", "RET", delay=0.6)
    steps.append(
        (
            "verify candidate Subdivide",
            0.1,
            assert_candidate_subdivide_applied,
        )
    )
else:
    add_press_release("select all", "A", delay=0.2)
    add_press_release("open operator search", "F3", delay=0.3)
    add_text("search subdivide", "subdivide")
    add_press_release("execute search result", "RET", delay=0.6)
add_press_release("open redo panel", "F9", delay=0.5)

# Do not invoke bpy operators or screenshots while the temporary F9 panel owns UI.
add_double_click("edit number of cuts", number_cuts_point)
add_event("select number of cuts text", "A", ctrl=True, delay=0.08)
add_text("type number of cuts", NUMBER_CUTS_TEXT)
add_press_release("confirm number of cuts", "RET", delay=0.5)
add_double_click("edit smoothness", smoothness_point)
add_event("select smoothness text", "A", ctrl=True, delay=0.08)
add_text("type smoothness", SMOOTHNESS_TEXT)
add_press_release("confirm smoothness", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture subdivide operator", 0.1, capture_subdivide_operator))
add_press_release("return to object mode", "TAB", delay=0.5)
steps.append(
    ("capture applied history state", 0.1, lambda: capture_history_snapshot("applied"))
)
for history_index in range(1, 5):
    add_press_release(f"undo history {history_index}", "Z", ctrl=True, delay=0.5)
    steps.append(
        (
            f"capture undo history {history_index}",
            0.1,
            lambda history_index=history_index: capture_history_snapshot(
                f"undo-{history_index}"
            ),
        )
    )
for history_index in range(1, 5):
    add_press_release(
        f"redo history {history_index}", "Z", ctrl=True, shift=True, delay=0.5
    )
    steps.append(
        (
            f"capture redo history {history_index}",
            0.1,
            lambda history_index=history_index: capture_history_snapshot(
                f"redo-{history_index}"
            ),
        )
    )
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"SUBDIVIDE_F9 step={label}", flush=True)
    try:
        with bpy.context.temp_override(
            window=window,
            area=area,
            region=region,
            space_data=space,
        ):
            action()
    except Exception as error:
        failure = {
            "ok": False,
            "entryMode": ENTRY_MODE,
            "blenderVersion": bpy.app.version_string,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "numberCutsPoint": number_cuts_point,
            "smoothnessPoint": smoothness_point,
            "historySnapshots": history_snapshots,
            "candidateMenuInvocations": candidate_menu_invocations,
        }
        write_result(failure)
        print("SUBDIVIDE_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


print(
    "SUBDIVIDE_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "entryMode": ENTRY_MODE,
            "window": [window.width, window.height],
            "area": [area.x, area.y, area.width, area.height],
            "uiScale": ui_scale,
            "numberCutsPoint": number_cuts_point,
            "smoothnessPoint": smoothness_point,
        },
        sort_keys=True,
    ),
    flush=True,
)
bpy.app.timers.register(advance, first_interval=1.0)
