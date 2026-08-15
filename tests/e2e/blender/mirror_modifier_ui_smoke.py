"""Foreground proof for the Properties Modifier Shift+A Mirror alias."""

from __future__ import annotations

import hashlib
import json
import math
import os
import traceback
from pathlib import Path
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_MIRROR_UI_RESULT"])
window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "PROPERTIES")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
space.context = "MODIFIER"
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2

initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None and initial_active.name == "Cube"
mesh_data_pointer_before = initial_active.data.as_pointer()
mesh_datablock_count_before = len(bpy.data.meshes)


def freeze_value(value: object) -> object:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    try:
        return tuple(freeze_value(component) for component in value)
    except TypeError:
        return repr(value)


def mesh_content_signature(mesh: bpy.types.Mesh) -> tuple[object, ...]:
    attributes = tuple(
        sorted(
            (
                attribute.name,
                attribute.data_type,
                attribute.domain,
                tuple(
                    freeze_value(
                        next(
                            getattr(item, field)
                            for field in (
                                "value",
                                "vector",
                                "color",
                                "byte_color",
                                "quaternion",
                                "matrix",
                            )
                            if hasattr(item, field)
                        )
                    )
                    for item in attribute.data
                ),
            )
            for attribute in mesh.attributes
            if not attribute.name.startswith(".select_")
        )
    )
    return (
        tuple(tuple(float(component) for component in vertex.co) for vertex in mesh.vertices),
        tuple(tuple(int(index) for index in edge.vertices) for edge in mesh.edges),
        tuple(
            (
                tuple(int(index) for index in polygon.vertices),
                int(polygon.material_index),
                bool(polygon.use_smooth),
            )
            for polygon in mesh.polygons
        ),
        attributes,
        tuple(
            tuple(sorted((int(group.group), float(group.weight)) for group in vertex.groups))
            for vertex in mesh.vertices
        ),
        None if mesh.shape_keys is None else mesh.shape_keys.session_uid,
    )


source_mesh_signature_before = mesh_content_signature(initial_active.data)
source_mesh_sha256_before = hashlib.sha256(
    repr(source_mesh_signature_before).encode("utf-8")
).hexdigest()


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def simulate(
    event_type: str,
    value: str = "PRESS",
    *,
    unicode: str = "",
    shift: bool = False,
) -> None:
    event: dict[str, object] = {
        "type": event_type,
        "value": value,
        "x": center_x,
        "y": center_y,
        "shift": shift,
    }
    if unicode:
        event["unicode"] = unicode
    window.event_simulate(**event)


def mirror_properties(modifier: bpy.types.MirrorModifier) -> dict[str, object]:
    return {
        "useAxis": list(modifier.use_axis),
        "useBisectAxis": list(modifier.use_bisect_axis),
        "useBisectFlipAxis": list(modifier.use_bisect_flip_axis),
        "useClip": bool(modifier.use_clip),
        "useMirrorMerge": bool(modifier.use_mirror_merge),
        "mergeThreshold": float(modifier.merge_threshold),
        "bisectThreshold": float(modifier.bisect_threshold),
        "mirrorObjectAbsent": modifier.mirror_object is None,
        "useMirrorVertexGroups": bool(modifier.use_mirror_vertex_groups),
        "useMirrorU": bool(modifier.use_mirror_u),
        "useMirrorV": bool(modifier.use_mirror_v),
        "useMirrorUdim": bool(modifier.use_mirror_udim),
        "offsetU": float(modifier.offset_u),
        "offsetV": float(modifier.offset_v),
        "mirrorOffsetU": float(modifier.mirror_offset_u),
        "mirrorOffsetV": float(modifier.mirror_offset_v),
        "showViewport": bool(modifier.show_viewport),
        "showRender": bool(modifier.show_render),
        "showInEditMode": bool(modifier.show_in_editmode),
        "showOnCage": bool(modifier.show_on_cage),
        "useApplyOnSplineExposed": hasattr(modifier, "use_apply_on_spline"),
        "useApplyOnSpline": bool(getattr(modifier, "use_apply_on_spline", False)),
    }


def finish() -> None:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.name == "Cube" and active.type == "MESH"
    assert bpy.context.mode == "OBJECT"
    assert area.type == "PROPERTIES" and space.context == "MODIFIER"
    assert len(active.modifiers) == 1
    modifier = active.modifiers[0]
    assert modifier.type == "MIRROR"
    properties = mirror_properties(modifier)
    expected = {
        "useAxis": [True, False, False],
        "useBisectAxis": [False, False, False],
        "useBisectFlipAxis": [False, False, False],
        "useClip": False,
        "useMirrorMerge": True,
        "mergeThreshold": 0.001,
        "bisectThreshold": 0.001,
        "mirrorObjectAbsent": True,
        "useMirrorVertexGroups": True,
        "useMirrorU": False,
        "useMirrorV": False,
        "useMirrorUdim": False,
        "offsetU": 0.0,
        "offsetV": 0.0,
        "mirrorOffsetU": 0.0,
        "mirrorOffsetV": 0.0,
        "showViewport": True,
        "showRender": True,
        "showInEditMode": True,
        "showOnCage": False,
        "useApplyOnSplineExposed": True,
        "useApplyOnSpline": False,
    }
    for name, value in expected.items():
        actual = properties[name]
        if isinstance(value, float):
            assert isinstance(actual, float) and math.isclose(
                actual, value, rel_tol=0.0, abs_tol=1e-6
            )
        else:
            assert actual == value

    operators = tuple(
        operator
        for operator in bpy.context.window_manager.operators
        if operator.bl_idname == "OBJECT_OT_modifier_add"
    )
    assert operators
    source_operator = operators[-1]
    operator_properties = {
        "type": source_operator.properties.type,
        "use_selected_objects": bool(
            source_operator.properties.use_selected_objects
        ),
    }
    assert operator_properties == {"type": "MIRROR", "use_selected_objects": False}

    source_topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    assert source_topology == {"vertices": 8, "edges": 12, "polygons": 6}
    evaluated = active.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    evaluated_topology = {
        "vertices": len(evaluated.vertices),
        "edges": len(evaluated.edges),
        "polygons": len(evaluated.polygons),
    }
    assert evaluated_topology == {"vertices": 16, "edges": 24, "polygons": 12}
    assert all(
        math.isfinite(component)
        for vertex in evaluated.vertices
        for component in vertex.co
    )

    mesh_data_pointer_after = active.data.as_pointer()
    mesh_datablock_count_after = len(bpy.data.meshes)
    source_mesh_signature_after = mesh_content_signature(active.data)
    source_mesh_sha256_after = hashlib.sha256(
        repr(source_mesh_signature_after).encode("utf-8")
    ).hexdigest()
    assert mesh_data_pointer_after == mesh_data_pointer_before
    assert mesh_datablock_count_after == mesh_datablock_count_before
    assert source_mesh_signature_after == source_mesh_signature_before
    assert source_mesh_sha256_after == source_mesh_sha256_before
    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "objectName": active.name,
        "mode": bpy.context.mode,
        "editor": area.type,
        "propertiesContext": space.context,
        "shortcut": {"keys": ["SHIFT", "A"], "query": "mirror"},
        "selectionPath": ["Add Modifier", "Generate", "Mirror"],
        "operatorId": source_operator.bl_idname,
        "operatorProperties": operator_properties,
        "modifierName": modifier.name,
        "modifierType": modifier.type,
        "modifierProperties": properties,
        "sourceTopology": source_topology,
        "evaluatedTopology": evaluated_topology,
        "meshDataPointerBefore": mesh_data_pointer_before,
        "meshDataPointerAfter": mesh_data_pointer_after,
        "meshDatablockCountBefore": mesh_datablock_count_before,
        "meshDatablockCountAfter": mesh_datablock_count_after,
        "sourceMeshSha256Before": source_mesh_sha256_before,
        "sourceMeshSha256After": source_mesh_sha256_after,
        "sourceMeshContentUnchanged": True,
        "nativeModifierMutationVerified": True,
    }
    write_result(result)
    print("MIRROR_UI PASS " + json.dumps(result, sort_keys=True), flush=True)
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
    shift: bool = False,
) -> None:
    steps.append(
        (
            label,
            delay,
            lambda: simulate(event_type, value, unicode=unicode, shift=shift),
        )
    )


def add_press_release(
    label: str, event_type: str, *, delay: float, shift: bool = False
) -> None:
    add_event(label + ":press", event_type, delay=0.04, shift=shift)
    add_event(
        label + ":release", event_type, "RELEASE", delay=delay, shift=shift
    )


def add_text(label: str, value: str) -> None:
    for index, character in enumerate(value):
        add_event(
            f"{label}:{index}:{character}",
            character.upper(),
            unicode=character,
            delay=0.08,
        )


# Shift+A is scoped to the Properties editor's Modifier context. Typing within
# the real Add Modifier menu filters the Generate entries before Enter selects Mirror.
add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor properties cursor", "MOUSEMOVE", "NOTHING", delay=0.3)
add_press_release("open add modifier", "A", delay=0.6, shift=True)
add_text("filter mirror", "mirror")
add_press_release("select mirror", "RET", delay=0.8)
steps.append(("verify result", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"MIRROR_UI step={label}", flush=True)
    try:
        with bpy.context.temp_override(
            window=window, area=area, region=region, space_data=space
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
        print("MIRROR_UI FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


bpy.app.timers.register(advance, first_interval=1.0)
