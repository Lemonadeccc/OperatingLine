"""Foreground UI proof for Edit Mode Poke Faces through search and F9."""

from __future__ import annotations

import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_EDIT_POKE_F9_RESULT"])
window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale
offset_point = (center_x + round(210 * ui_scale), center_y - round(50 * ui_scale))

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None and initial_active.name == "Cube"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)

operator_id: str | None = None
source_properties: dict[str, object] = {}
final_properties: dict[str, object] = {}


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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


def poke_operator() -> object:
    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "MESH_OT_poke"
    ]
    assert candidates, "MESH_OT_poke was not present in the operator stack"
    return candidates[-1]


def properties() -> dict[str, object]:
    operator = poke_operator()
    return {
        name: getattr(operator.properties, name)
        for name in ("offset", "use_relative_offset", "center_mode")
    }


def capture_source() -> None:
    global operator_id, source_properties
    operator_id = poke_operator().bl_idname
    source_properties = properties()


def capture_final() -> None:
    global final_properties
    final_properties = properties()


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert operator_id == "MESH_OT_poke"
    assert source_properties == {
        "offset": 0.0,
        "use_relative_offset": False,
        "center_mode": "MEDIAN_WEIGHTED",
    }
    assert math.isclose(float(final_properties["offset"]), 0.2, rel_tol=0.0, abs_tol=1e-6)
    assert final_properties["use_relative_offset"] is False
    assert final_properties["center_mode"] == "MEDIAN_WEIGHTED"
    assert bpy.context.mode == "OBJECT"
    assert active is not None and active.name == "Cube" and active.type == "MESH"
    topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    assert topology == {"vertices": 14, "edges": 36, "polygons": 24}
    selected_triangles = sum(
        1 for polygon in active.data.polygons if polygon.select and len(polygon.vertices) == 3
    )
    assert selected_triangles == 24
    assert all(len(polygon.vertices) == 3 for polygon in active.data.polygons)
    coordinate_values = [
        component for vertex in active.data.vertices for component in vertex.co
    ]
    bounds = {"min": min(coordinate_values), "max": max(coordinate_values)}
    assert math.isclose(bounds["min"], -1.2, rel_tol=0.0, abs_tol=1e-6)
    assert math.isclose(bounds["max"], 1.2, rel_tol=0.0, abs_tol=1e-6)
    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before
    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "operatorId": operator_id,
        "sourceProperties": source_properties,
        "finalProperties": final_properties,
        "topology": topology,
        "selectedTriangles": selected_triangles,
        "allFacesTriangle": True,
        "bounds": bounds,
        "objectName": active.name,
        "mode": bpy.context.mode,
        "offsetPoint": offset_point,
        "meshDataPointerBefore": mesh_data_pointer_before,
        "meshDataPointerAfter": mesh_data_pointer_after,
        "meshDatablockCountBefore": mesh_datablock_count_before,
        "meshDatablockCountAfter": mesh_datablock_count_after,
        "nativeInPlaceMutationVerified": True,
        "popupCloseEventSent": True,
    }
    write_result(result)
    print("EDIT_POKE_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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
            lambda: simulate(event_type, value, unicode=unicode, ctrl=ctrl, x=x, y=y),
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
    add_event(label + ":release", event_type, "RELEASE", delay=delay, ctrl=ctrl, x=x, y=y)


def add_double_click(label: str, point: tuple[int, int]) -> None:
    add_event(label + ":hover", "MOUSEMOVE", "NOTHING", x=point[0], y=point[1])
    for click_index in (1, 2):
        add_event(f"{label}:{click_index}:press", "LEFTMOUSE", delay=0.03, x=point[0], y=point[1])
        add_event(
            f"{label}:{click_index}:release",
            "LEFTMOUSE",
            "RELEASE",
            delay=0.15 if click_index == 2 else 0.04,
            x=point[0],
            y=point[1],
        )


def add_text(label: str, text: str) -> None:
    event_names = {".": "PERIOD", "0": "ZERO", "1": "ONE", "2": "TWO", " ": "SPACE"}
    for character_index, character in enumerate(text):
        add_event(
            f"{label}:{character_index}:{character}",
            event_names.get(character, character.upper()),
            unicode=character,
            delay=0.04,
        )


# The action has no direct keymap. Every modeling input therefore uses F3 search,
# followed by the Adjust Last Operation panel for the explicit offset value.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("enter edit mode", "TAB", delay=0.3)
add_press_release("face select mode", "THREE", delay=0.2)
add_press_release("select all", "A", delay=0.2)
add_press_release("open operator search", "F3", delay=0.3)
add_text("search poke faces", "poke faces")
add_press_release("execute search result", "RET", delay=0.6)
steps.append(("capture source operator", 0.1, capture_source))
add_press_release("open redo panel", "F9", delay=0.6)
add_double_click("edit offset", offset_point)
add_event("select offset text", "A", ctrl=True, delay=0.08)
add_text("type offset", "0.2")
add_press_release("confirm offset", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture final operator", 0.1, capture_final))
add_press_release("return to object mode", "TAB", delay=0.5)
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"EDIT_POKE_F9 step={label}", flush=True)
    try:
        with bpy.context.temp_override(window=window, area=area, region=region, space_data=space):
            action()
    except Exception as error:
        failure = {
            "ok": False,
            "blenderVersion": bpy.app.version_string,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "offsetPoint": offset_point,
        }
        write_result(failure)
        print("EDIT_POKE_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


bpy.app.timers.register(advance, first_interval=1.0)
