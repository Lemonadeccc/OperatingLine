"""Foreground UI proof for editing Subdivide properties through Blender's F9 panel."""

from __future__ import annotations

import hashlib
import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVIDE_F9_RESULT"])
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

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale


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
assert initial_active.name == "Cube"
assert initial_active.type == "MESH"
object_pointer_before = initial_active.as_pointer()
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)
factory_geometry_fingerprint_before = mesh_geometry_fingerprint(initial_active.data)
factory_state_evidence_before = scene_state_evidence(initial_active)

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
    assert active.name == "Cube"

    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before

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
        == factory_geometry_fingerprint_before
    )
    assert {
        key: restored_baseline_snapshot[key]
        for key in factory_state_evidence_before
    } == factory_state_evidence_before
    assert redo_snapshot["mode"] == "OBJECT"
    assert redo_snapshot["topology"] == topology
    assert redo_snapshot["stateSha256"] == applied_snapshot["stateSha256"]
    assert redo_snapshot["geometrySha256"] != restored_baseline_snapshot["geometrySha256"]
    assert all(
        snapshot["activeObjectName"] == "Cube"
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

    result = {
        "ok": True,
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
            "factoryCubeGeometryRestored": True,
            "factoryStartupStateRestored": True,
            "parameterizedGeometryRestored": True,
            "factoryStartupStateSha256": factory_state_evidence_before[
                "stateSha256"
            ],
            "baselineStateSha256": restored_baseline_snapshot["stateSha256"],
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
    }
    write_result(result)
    print("SUBDIVIDE_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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


# Each UI event gets its own main-loop timer turn. Modeling reaches Blender only
# through Window.event_simulate; bpy is used after the popup closes for evidence.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("enter edit mode", "TAB", delay=0.3)
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
            "blenderVersion": bpy.app.version_string,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "numberCutsPoint": number_cuts_point,
            "smoothnessPoint": smoothness_point,
            "historySnapshots": history_snapshots,
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
