"""Foreground UI proof for editing Icosphere properties through Blender's F9 panel."""

from __future__ import annotations

import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_F9_RESULT"])

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active

center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale

# These are logical UI offsets from the VIEW_3D center. Blender's UI scale of 2.0
# maps them to the verified local offsets (+420, -100) and (+420, -145).
subdivisions_point = (
    center_x + round(210 * ui_scale),
    center_y - round(50 * ui_scale),
)
radius_point = (
    center_x + round(210 * ui_scale),
    center_y - round(72.5 * ui_scale),
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


def last_operator() -> tuple[str | None, dict[str, object]]:
    if not bpy.context.window_manager.operators:
        return None, {}
    operator = bpy.context.window_manager.operators[-1]
    properties = {
        name: getattr(operator.properties, name)
        for name in ("subdivisions", "radius")
        if hasattr(operator.properties, name)
    }
    return operator.bl_idname, properties


def finish() -> None:
    operator_id, properties = last_operator()
    active = bpy.context.view_layer.objects.active

    assert operator_id == "MESH_OT_primitive_ico_sphere_add"
    assert properties == {"subdivisions": 3, "radius": 2.5}
    assert active is not None
    assert active.type == "MESH"
    assert active.name == "Icosphere"
    assert len(active.data.vertices) == 162

    radii = [vertex.co.length for vertex in active.data.vertices]
    assert radii
    assert max(abs(radius - 2.5) for radius in radii) < 1e-5

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "window": [window.width, window.height],
        "uiScale": ui_scale,
        "operatorId": operator_id,
        "properties": properties,
        "objectName": active.name,
        "vertexCount": len(active.data.vertices),
        "radiusMin": min(radii),
        "radiusMax": max(radii),
        "popupCloseEventSent": True,
    }
    write_result(result)
    print("ICOSPHERE_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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


# Every entry is dispatched on its own main-loop timer turn. Menu navigation uses
# press-only events, while operator invocation and F9 use complete key strokes.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_event("open add menu", "A", shift=True, delay=0.2)
add_event("select mesh", "DOWN_ARROW", delay=0.15)
add_event("open mesh submenu", "RIGHT_ARROW", delay=0.15)
for item_index in range(1, 5):
    add_event(f"select mesh item {item_index}", "DOWN_ARROW", delay=0.08)
add_press_release("invoke icosphere", "RET", delay=0.5)
add_press_release("open redo panel", "F9", delay=0.5)

# Do not call bpy.ops or screenshot APIs while the temporary F9 panel is open.
add_double_click("edit subdivisions", subdivisions_point)
add_event("select subdivisions text", "A", ctrl=True, delay=0.08)
add_event("type subdivisions", "THREE", unicode="3", delay=0.08)
add_press_release("confirm subdivisions", "RET", delay=0.5)
add_double_click("edit radius", radius_point)
add_event("select radius text", "A", ctrl=True, delay=0.08)
add_event("type radius integer", "TWO", unicode="2", delay=0.05)
add_event("type radius decimal", "PERIOD", unicode=".", delay=0.05)
add_event("type radius fraction", "FIVE", unicode="5", delay=0.08)
add_press_release("confirm radius", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"ICOSPHERE_F9 step={label}", flush=True)
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
        }
        write_result(failure)
        print("ICOSPHERE_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        # An immediate process exit avoids invoking a Blender operator while a
        # temporary popup may still own the UI event loop.
        os._exit(1)
    return delay


print(
    "ICOSPHERE_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "window": [window.width, window.height],
            "area": [area.x, area.y, area.width, area.height],
            "uiScale": ui_scale,
            "subdivisionsPoint": subdivisions_point,
            "radiusPoint": radius_point,
        },
        sort_keys=True,
    ),
    flush=True,
)
bpy.app.timers.register(advance, first_interval=1.0)
