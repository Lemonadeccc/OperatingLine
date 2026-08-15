"""Foreground UI proof for editing Subdivide properties through Blender's F9 panel."""

from __future__ import annotations

import json
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVIDE_F9_RESULT"])

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None
assert initial_active.name == "Cube"
assert initial_active.type == "MESH"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)

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


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert captured_operator_id == "MESH_OT_subdivide"
    assert captured_properties == {"number_cuts": 2, "smoothness": 0.25}
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
    assert topology == {"vertices": 56, "edges": 108, "polygons": 54}

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
) -> None:
    add_event(label + ":press", event_type, delay=0.04, x=x, y=y)
    add_event(label + ":release", event_type, "RELEASE", delay=delay, x=x, y=y)


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
add_text("type number of cuts", "2")
add_press_release("confirm number of cuts", "RET", delay=0.5)
add_double_click("edit smoothness", smoothness_point)
add_event("select smoothness text", "A", ctrl=True, delay=0.08)
add_text("type smoothness", "0.25")
add_press_release("confirm smoothness", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture subdivide operator", 0.1, capture_subdivide_operator))
add_press_release("return to object mode", "TAB", delay=0.5)
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
