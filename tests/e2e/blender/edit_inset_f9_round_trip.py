"""Foreground UI proof for editing an Edit Mode Inset through Blender's F9 panel."""

from __future__ import annotations

import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_EDIT_INSET_F9_RESULT"])

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale

thickness_point = (center_x + round(210 * ui_scale), center_y - round(140 * ui_scale))
depth_point = (center_x + round(210 * ui_scale), center_y - round(162.5 * ui_scale))
individual_point = (center_x + round(132.5 * ui_scale), center_y - round(225 * ui_scale))

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None
assert initial_active.name == "Cube"
assert initial_active.type == "MESH"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)

operator_id: str | None = None
source_properties: dict[str, object] = {}
final_properties: dict[str, object] = {}
initial_face_selection: dict[str, int] = {}

PROPERTY_NAMES = (
    "use_boundary",
    "use_even_offset",
    "use_relative_offset",
    "use_edge_rail",
    "thickness",
    "depth",
    "use_outset",
    "use_select_inset",
    "use_individual",
    "use_interpolate",
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


def inset_operator() -> object:
    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "MESH_OT_inset"
    ]
    assert candidates, "MESH_OT_inset was not present in the operator stack"
    return candidates[-1]


def inset_properties() -> dict[str, object]:
    operator = inset_operator()
    return {name: getattr(operator.properties, name) for name in PROPERTY_NAMES}


def capture_face_selection() -> None:
    global initial_face_selection
    active = bpy.context.view_layer.objects.active
    assert active is not None
    assert bpy.context.mode == "EDIT_MESH"
    initial_face_selection = {
        "selected": active.data.total_face_sel,
        "total": len(active.data.polygons),
    }
    assert initial_face_selection == {"selected": 6, "total": 6}


def capture_source() -> None:
    global operator_id, source_properties
    operator = inset_operator()
    operator_id = operator.bl_idname
    source_properties = inset_properties()


def capture_final() -> None:
    global final_properties
    final_properties = inset_properties()


def assert_float(value: object, expected: float) -> None:
    assert math.isclose(float(value), expected, rel_tol=0.0, abs_tol=1e-6)


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert operator_id == "MESH_OT_inset"
    assert bpy.context.mode == "OBJECT"
    assert active is not None
    assert active.type == "MESH"
    assert active.name == "Cube"

    expected_defaults: dict[str, object] = {
        "use_boundary": True,
        "use_even_offset": True,
        "use_relative_offset": False,
        "use_edge_rail": False,
        "thickness": 0.0,
        "depth": 0.0,
        "use_outset": False,
        "use_select_inset": False,
        "use_individual": False,
        "use_interpolate": True,
        "release_confirm": False,
    }
    assert set(source_properties) == set(expected_defaults)
    for key, expected in expected_defaults.items():
        if isinstance(expected, float):
            assert_float(source_properties[key], expected)
        else:
            assert source_properties[key] == expected

    assert set(final_properties) == set(source_properties)
    assert_float(final_properties["thickness"], 0.2)
    assert_float(final_properties["depth"], 0.1)
    assert final_properties["use_individual"] is True
    for key, source_value in source_properties.items():
        if key not in {"thickness", "depth", "use_individual"}:
            assert final_properties[key] == source_value

    topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    assert topology == {"vertices": 32, "edges": 60, "polygons": 30}
    assert all(len(polygon.vertices) == 4 for polygon in active.data.polygons)
    final_face_selection = {
        "selected": sum(1 for polygon in active.data.polygons if polygon.select),
        "total": len(active.data.polygons),
    }
    assert final_face_selection == {"selected": 6, "total": 30}

    coordinates = [coordinate for vertex in active.data.vertices for coordinate in vertex.co]
    bounds = {"min": min(coordinates), "max": max(coordinates)}
    assert_float(bounds["min"], -1.1)
    assert_float(bounds["max"], 1.1)

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
        "thicknessPoint": thickness_point,
        "depthPoint": depth_point,
        "individualPoint": individual_point,
        "operatorId": operator_id,
        "sourceProperties": source_properties,
        "finalProperties": final_properties,
        "initialFaceSelection": initial_face_selection,
        "finalFaceSelection": final_face_selection,
        "topology": topology,
        "allFacesQuad": True,
        "bounds": bounds,
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
    print("EDIT_INSET_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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
    event_names = {".": "PERIOD", "0": "ZERO", "1": "ONE", "2": "TWO"}
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
add_press_release("face select mode", "THREE", delay=0.2)
add_press_release("select all", "A", delay=0.2)
steps.append(("capture face selection", 0.1, capture_face_selection))
add_press_release("start face inset", "I", delay=0.3)
add_press_release("confirm zero-thickness inset", "RET", delay=0.5)
steps.append(("capture source operator", 0.1, capture_source))
add_press_release("open redo panel", "F9", delay=0.8)
add_double_click("edit thickness", thickness_point)
add_event("select thickness text", "A", ctrl=True, delay=0.08)
add_text("type thickness", "0.2")
add_press_release("confirm thickness", "RET", delay=0.5)
add_double_click("edit depth", depth_point)
add_event("select depth text", "A", ctrl=True, delay=0.08)
add_text("type depth", "0.1")
add_press_release("confirm depth", "RET", delay=0.5)
add_event(
    "hover individual",
    "MOUSEMOVE",
    "NOTHING",
    x=individual_point[0],
    y=individual_point[1],
)
add_press_release(
    "enable individual",
    "LEFTMOUSE",
    delay=0.5,
    x=individual_point[0],
    y=individual_point[1],
)
add_event("leave individual control", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture final operator", 0.1, capture_final))
add_press_release("return to object mode", "TAB", delay=0.5)
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"EDIT_INSET_F9 step={label}", flush=True)
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
            "thicknessPoint": thickness_point,
            "depthPoint": depth_point,
            "individualPoint": individual_point,
        }
        write_result(failure)
        print("EDIT_INSET_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


print(
    "EDIT_INSET_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "window": [window.width, window.height],
            "area": [area.x, area.y, area.width, area.height],
            "uiScale": ui_scale,
            "thicknessPoint": thickness_point,
            "depthPoint": depth_point,
            "individualPoint": individual_point,
        },
        sort_keys=True,
    ),
    flush=True,
)
bpy.app.timers.register(advance, first_interval=1.0)
