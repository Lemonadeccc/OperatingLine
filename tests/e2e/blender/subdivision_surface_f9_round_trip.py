"""Foreground UI proof for setting Subdivision Surface viewport levels through F9."""

from __future__ import annotations

import json
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_F9_RESULT"])
TARGET_LEVEL = int(os.environ["OPERATINGLINE_SUBDIVISION_SURFACE_VIEWPORT_LEVEL"])
assert TARGET_LEVEL in {1, 2, 3}

EXPECTED_TOPOLOGY = {
    1: {"vertices": 26, "edges": 48, "polygons": 24},
    2: {"vertices": 98, "edges": 192, "polygons": 96},
    3: {"vertices": 386, "edges": 768, "polygons": 384},
}
EXPECTED_MODIFIER_FLAGS = {
    "subdivision_type": "CATMULL_CLARK",
    "quality": 3,
    "show_viewport": True,
    "show_render": True,
    "show_in_editmode": True,
    "show_on_cage": False,
    "show_only_control_edges": True,
    "use_limit_surface": True,
    "use_creases": True,
    "use_custom_normals": False,
    "boundary_smooth": "ALL",
    "uv_smooth": "PRESERVE_BOUNDARIES",
}

window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale
level_point = (
    center_x + round(210 * ui_scale),
    center_y - round(50 * ui_scale),
)

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None
assert initial_active.name == "Cube"
assert initial_active.type == "MESH"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)

captured_operator_id: str | None = None
captured_operator_properties: dict[str, object] = {}
source_operator_properties: dict[str, object] = {}
source_modifier_levels: dict[str, int] = {}


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
    ctrl: bool = False,
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


def capture_operator() -> None:
    global captured_operator_id, captured_operator_properties

    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "OBJECT_OT_subdivision_set"
    ]
    assert candidates, "OBJECT_OT_subdivision_set was not present in the operator stack"
    operator = candidates[-1]
    captured_operator_id = operator.bl_idname
    captured_operator_properties = {
        name: getattr(operator.properties, name)
        for name in ("level", "relative", "ensure_modifier")
        if hasattr(operator.properties, name)
    }


def capture_source_operation() -> None:
    global source_operator_properties, source_modifier_levels

    candidates = [
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "OBJECT_OT_subdivision_set"
    ]
    assert candidates
    operator = candidates[-1]
    source_operator_properties = {
        name: getattr(operator.properties, name)
        for name in ("level", "relative", "ensure_modifier")
        if hasattr(operator.properties, name)
    }
    assert source_operator_properties == {
        "level": 1,
        "relative": False,
        "ensure_modifier": True,
    }

    active = bpy.context.view_layer.objects.active
    assert active is not None
    modifiers = [modifier for modifier in active.modifiers if modifier.type == "SUBSURF"]
    assert len(modifiers) == 1
    source_modifier_levels = {
        "levels": modifiers[0].levels,
        "render_levels": modifiers[0].render_levels,
    }
    assert source_modifier_levels == {"levels": 1, "render_levels": 2}


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert captured_operator_id == "OBJECT_OT_subdivision_set"
    assert captured_operator_properties == {
        "level": TARGET_LEVEL,
        "relative": False,
        "ensure_modifier": True,
    }
    assert bpy.context.mode == "OBJECT"
    assert active is not None
    assert active.type == "MESH"
    assert active.name == "Cube"

    modifiers = [modifier for modifier in active.modifiers if modifier.type == "SUBSURF"]
    assert len(modifiers) == 1
    modifier = modifiers[0]
    modifier_flags = {
        name: getattr(modifier, name) for name in EXPECTED_MODIFIER_FLAGS
    }
    assert modifier.levels == TARGET_LEVEL
    assert modifier.render_levels == 2
    assert modifier_flags == EXPECTED_MODIFIER_FLAGS

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_object = active.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_object.to_mesh()
    try:
        evaluated_topology = {
            "vertices": len(evaluated_mesh.vertices),
            "edges": len(evaluated_mesh.edges),
            "polygons": len(evaluated_mesh.polygons),
        }
    finally:
        evaluated_object.to_mesh_clear()
    assert evaluated_topology == EXPECTED_TOPOLOGY[TARGET_LEVEL]

    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "viewportLevel": TARGET_LEVEL,
        "renderLevel": modifier.render_levels,
        "operatorId": captured_operator_id,
        "sourceOperatorProperties": source_operator_properties,
        "sourceModifierLevels": source_modifier_levels,
        "operatorProperties": captured_operator_properties,
        "subsurfModifierCount": len(modifiers),
        "modifierName": modifier.name,
        "modifierFlags": modifier_flags,
        "meshDataPointerBefore": mesh_data_pointer_before,
        "meshDataPointerAfter": mesh_data_pointer_after,
        "meshDatablockCountBefore": mesh_datablock_count_before,
        "meshDatablockCountAfter": mesh_datablock_count_after,
        "evaluatedTopology": evaluated_topology,
        "objectName": active.name,
        "mode": bpy.context.mode,
        "levelPoint": level_point,
        "uiScale": ui_scale,
        "popupCloseEventSent": True,
    }
    write_result(result)
    print("SUBDIVISION_SURFACE_F9 PASS " + json.dumps(result, sort_keys=True), flush=True)
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
    ctrl: bool = False,
) -> None:
    add_event(label + ":press", event_type, delay=0.04, x=x, y=y, ctrl=ctrl)
    add_event(
        label + ":release",
        event_type,
        "RELEASE",
        delay=delay,
        x=x,
        y=y,
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


event_name_for_level = {1: "ONE", 2: "TWO", 3: "THREE"}

# Each input is dispatched on its own timer turn. Ctrl+1 creates the modifier;
# F9 then edits the registered operator's viewport level without replacing Mesh.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
add_press_release("set subdivision level one", "ONE", ctrl=True, delay=0.7)
steps.append(("capture source operation", 0.1, capture_source_operation))
add_press_release("open redo panel", "F9", delay=0.5)
add_double_click("edit viewport level", level_point)
add_event("select viewport level text", "A", ctrl=True, delay=0.08)
add_event(
    "type viewport level",
    event_name_for_level[TARGET_LEVEL],
    unicode=str(TARGET_LEVEL),
    delay=0.08,
)
add_press_release("confirm viewport level", "RET", delay=0.5)
add_press_release("close redo panel", "RET", delay=0.5)
steps.append(("capture subdivision operator", 0.1, capture_operator))
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"SUBDIVISION_SURFACE_F9 step={label}", flush=True)
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
            "viewportLevel": TARGET_LEVEL,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
        write_result(failure)
        print("SUBDIVISION_SURFACE_F9 FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


print(
    "SUBDIVISION_SURFACE_F9 start "
    + json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "viewportLevel": TARGET_LEVEL,
            "levelPoint": level_point,
            "uiScale": ui_scale,
        },
        sort_keys=True,
    ),
    flush=True,
)
bpy.app.timers.register(advance, first_interval=1.0)
