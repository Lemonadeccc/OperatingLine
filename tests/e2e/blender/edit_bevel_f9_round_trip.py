"""Foreground UI proof for editing an Edit Mode Bevel through Blender's F9 panel."""

from __future__ import annotations

import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_EDIT_BEVEL_F9_RESULT"])

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale

width_point = (
    center_x + round(210 * ui_scale),
    center_y - round(95 * ui_scale),
)
segments_point = (
    center_x + round(210 * ui_scale),
    center_y - round(117.5 * ui_scale),
)
profile_point = (
    center_x + round(210 * ui_scale),
    center_y - round(140 * ui_scale),
)

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None
assert initial_active.name == "Cube"
assert initial_active.type == "MESH"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)

operator_id: str | None = None
source_properties: dict[str, object] = {}
final_properties: dict[str, object] = {}
initial_edge_selection: dict[str, int] = {}

PROPERTY_NAMES = (
    "offset_type",
    "offset",
    "segments",
    "profile",
    "profile_type",
    "affect",
    "clamp_overlap",
    "loop_slide",
    "mark_seam",
    "mark_sharp",
    "material",
    "harden_normals",
    "face_strength_mode",
    "miter_outer",
    "miter_inner",
    "spread",
    "vmesh_method",
    "release_confirm",
)


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
    ctrl: bool = False,
    x: int | None = None,
    y: int | None = None,
) -> None:
    event: dict[str, object] = {
        "type": event_type,
        "value": value,
        "x": center_x if x is None else x,
        "y": center_y if y is None else y,
        "ctrl": ctrl,
    }
    if unicode:
        event["unicode"] = unicode
    window.event_simulate(**event)


def bevel_operator() -> object:
    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "MESH_OT_bevel"
    ]
    assert candidates, "MESH_OT_bevel was not present in the operator stack"
    return candidates[-1]


def bevel_properties() -> dict[str, object]:
    operator = bevel_operator()
    return {
        name: getattr(operator.properties, name)
        for name in PROPERTY_NAMES
        if hasattr(operator.properties, name)
    }


def capture_edge_selection() -> None:
    global initial_edge_selection
    active = bpy.context.view_layer.objects.active
    assert active is not None
    assert bpy.context.mode == "EDIT_MESH"
    initial_edge_selection = {
        "selected": active.data.total_edge_sel,
        "total": len(active.data.edges),
    }
    assert initial_edge_selection == {"selected": 12, "total": 12}


def capture_source() -> None:
    global operator_id, source_properties
    operator = bevel_operator()
    operator_id = operator.bl_idname
    source_properties = bevel_properties()


def capture_final() -> None:
    global final_properties
    final_properties = bevel_properties()


def assert_float(value: object, expected: float) -> None:
    assert math.isclose(float(value), expected, rel_tol=0.0, abs_tol=1e-6)


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert operator_id == "MESH_OT_bevel"
    assert bpy.context.mode == "OBJECT"
    assert active is not None
    assert active.type == "MESH"
    assert active.name == "Cube"

    expected_defaults: dict[str, object] = {
        "offset_type": "OFFSET",
        "offset": 0.0,
        "segments": 1,
        "profile": 0.5,
        "affect": "EDGES",
        "clamp_overlap": False,
        "loop_slide": True,
        "mark_seam": False,
        "mark_sharp": False,
        "material": -1,
        "harden_normals": False,
        "face_strength_mode": "NONE",
        "miter_outer": "SHARP",
        "miter_inner": "SHARP",
        "spread": 0.1,
        "vmesh_method": "ADJ",
        "release_confirm": False,
    }
    if "profile_type" in source_properties:
        expected_defaults["profile_type"] = "SUPERELLIPSE"
    assert set(source_properties) == set(expected_defaults)
    for key, expected in expected_defaults.items():
        if isinstance(expected, float):
            assert_float(source_properties[key], expected)
        else:
            assert source_properties[key] == expected

    assert set(final_properties) == set(source_properties)
    assert_float(final_properties["offset"], 0.2)
    assert final_properties["segments"] == 3
    assert_float(final_properties["profile"], 0.6)
    for key, source_value in source_properties.items():
        if key not in {"offset", "segments", "profile"}:
            assert final_properties[key] == source_value

    topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    assert topology == {"vertices": 96, "edges": 192, "polygons": 98}
    final_edge_selection = {
        "selected": sum(1 for edge in active.data.edges if edge.select),
        "total": len(active.data.edges),
    }
    assert final_edge_selection == {"selected": 192, "total": 192}

    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "window": [window.width, window.height],
        "area": [area.x, area.y, area.width, area.height],
        "uiScale": ui_scale,
        "widthPoint": width_point,
        "segmentsPoint": segments_point,
        "profilePoint": profile_point,
        "operatorId": operator_id,
        "sourceProperties": source_properties,
        "finalProperties": final_properties,
        "initialEdgeSelection": initial_edge_selection,
        "finalEdgeSelection": final_edge_selection,
        "topology": topology,
        "objectName": active.name,
        "mode": bpy.context.mode,
        "meshDataPointerBefore": mesh_data_pointer_before,
        "meshDataPointerAfter": mesh_data_pointer_after,
        "meshDatablockCountBefore": mesh_datablock_count_before,
        "meshDatablockCountAfter": mesh_datablock_count_after,
        "nativeInPlaceMutationVerified": True,
        "popupCloseEventSent": True,
    }
    write_result(result)
    print("EDIT_BEVEL_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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
    ctrl: bool = False,
    x: int | None = None,
    y: int | None = None,
) -> None:
    steps.append(
        (
            label,
            delay,
            lambda: simulate(
                event_type,
                value,
                unicode=unicode,
                ctrl=ctrl,
                x=x,
                y=y,
            ),
        )
    )


def add_press_release(
    label: str,
    event_type: str,
    *,
    delay: float,
    ctrl: bool = False,
    x: int | None = None,
    y: int | None = None,
) -> None:
    add_event(label + ":press", event_type, delay=0.04, ctrl=ctrl, x=x, y=y)
    add_event(
        label + ":release",
        event_type,
        "RELEASE",
        delay=delay,
        ctrl=ctrl,
        x=x,
        y=y,
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
            event_names[character],
            unicode=character,
            delay=0.04,
        )


# Every modeling input reaches Blender through Window.event_simulate. Evidence is
# captured between modal surfaces or after the F9 popup has been explicitly closed.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("enter edit mode", "TAB", delay=0.3)
add_press_release("edge select mode", "TWO", delay=0.2)
add_press_release("select all", "A", delay=0.2)
steps.append(("capture edge selection", 0.1, capture_edge_selection))
add_press_release("start edge bevel", "B", ctrl=True, delay=0.3)
add_press_release("confirm zero-width bevel", "RET", delay=0.5)
steps.append(("capture source operator", 0.1, capture_source))
add_press_release("open redo panel", "F9", delay=0.8)
add_double_click("edit width", width_point)
add_event("select width text", "A", ctrl=True, delay=0.08)
add_text("type width", "0.2")
add_press_release("confirm width", "RET", delay=0.5)
add_double_click("edit segments", segments_point)
add_event("select segments text", "A", ctrl=True, delay=0.08)
add_text("type segments", "3")
add_press_release("confirm segments", "RET", delay=0.5)
add_double_click("edit profile", profile_point)
add_event("select profile text", "A", ctrl=True, delay=0.08)
add_text("type profile", "0.6")
add_press_release("confirm profile", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture final operator", 0.1, capture_final))
add_press_release("return to object mode", "TAB", delay=0.5)
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"EDIT_BEVEL_F9 step={label}", flush=True)
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
            "widthPoint": width_point,
            "segmentsPoint": segments_point,
            "profilePoint": profile_point,
        }
        write_result(failure)
        print("EDIT_BEVEL_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


print(
    "EDIT_BEVEL_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "window": [window.width, window.height],
            "area": [area.x, area.y, area.width, area.height],
            "uiScale": ui_scale,
            "widthPoint": width_point,
            "segmentsPoint": segments_point,
            "profilePoint": profile_point,
        },
        sort_keys=True,
    ),
    flush=True,
)
bpy.app.timers.register(advance, first_interval=1.0)
