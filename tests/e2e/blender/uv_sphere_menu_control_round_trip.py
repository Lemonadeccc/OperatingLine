"""Foreground proof for ordered UV Sphere menu and control execution."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import traceback
from typing import Callable

import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_UV_SPHERE_MENU_RESULT"])
EXECUTOR_ID = "blender.uv_sphere_menu_controls.event_simulate.v1"
TARGET_PROFILE = "factory_layout_three_object_ui_scale_2"
OPERATION_IDS = [
    "workspace.layout",
    "menu.add",
    "menu.mesh",
    "operator.uv_sphere",
    "control.location",
    "control.scale",
    "control.object_name",
]
EXPECTED_ARGUMENTS = {
    "resourceId": "proof.uv_sphere.eye",
    "objectName": "OperatingLine.TutorialEye",
    "radius": 1.5,
    "location": [1.25, -2.0, 0.75],
}
HISTORY_DEPTH = 8
VERBOSE = os.environ.get("OPERATINGLINE_UV_SPHERE_MENU_VERBOSE") == "1"

window = bpy.context.window
assert window is not None
assert tuple(bpy.app.version) in {(4, 5, 3), (5, 1, 1)}
assert bpy.context.workspace is not None and bpy.context.workspace.name == "Layout"
assert bpy.context.mode == "OBJECT"
assert callable(getattr(window, "event_simulate", None))
assert tuple(getattr(window, "modal_operators", ())) == ()
keyconfig = bpy.context.window_manager.keyconfigs.active
assert keyconfig is not None and keyconfig.name == "Blender"
assert math.isclose(
    float(bpy.context.preferences.system.ui_scale), 2.0, rel_tol=0.0, abs_tol=1e-6
)
assert sorted(bpy.data.objects.keys()) == ["Camera", "Cube", "Light"]
initial_active = bpy.context.view_layer.objects.active
assert initial_active is not None and initial_active.name == "Cube"
assert tuple(bpy.context.selected_objects) == (initial_active,)
assert initial_active.type == "MESH" and len(initial_active.modifiers) == 0
assert (
    len(initial_active.data.vertices),
    len(initial_active.data.edges),
    len(initial_active.data.polygons),
) == (8, 12, 6)
assert tuple(initial_active.location) == (0.0, 0.0, 0.0)
assert tuple(initial_active.rotation_euler) == (0.0, 0.0, 0.0)
assert tuple(initial_active.scale) == (1.0, 1.0, 1.0)
assert tuple(bpy.context.scene.cursor.location) == (0.0, 0.0, 0.0)
assert bpy.context.scene.transform_orientation_slots[0].type == "GLOBAL"

view_areas = tuple(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
outliner_areas = tuple(
    candidate for candidate in window.screen.areas if candidate.type == "OUTLINER"
)
properties_areas = tuple(
    candidate for candidate in window.screen.areas if candidate.type == "PROPERTIES"
)
assert len(view_areas) == len(outliner_areas) == len(properties_areas) == 1
area = view_areas[0]
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
ui_scale = bpy.context.preferences.system.ui_scale

header = next(candidate for candidate in area.regions if candidate.type == "HEADER")
add_point = (
    area.x + round(262 * ui_scale),
    header.y + header.height // 2,
)
mesh_point = (
    add_point[0] + round(60 * ui_scale),
    header.y - round(8 * ui_scale),
)
uv_sphere_point = (
    add_point[0] + round(215 * ui_scale),
    header.y - round(69 * ui_scale),
)


def mesh_sha256(mesh: bpy.types.Mesh) -> str:
    payload = {
        "vertices": [list(vertex.co) for vertex in mesh.vertices],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
    }
    return hashlib.sha256(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def scene_snapshot() -> dict[str, object]:
    return {
        "activeObject": (
            None
            if bpy.context.view_layer.objects.active is None
            else bpy.context.view_layer.objects.active.name
        ),
        "selectedObjects": sorted(candidate.name for candidate in bpy.context.selected_objects),
        "objects": [
            {
                "name": candidate.name,
                "type": candidate.type,
                "location": list(candidate.location),
                "rotation": list(candidate.rotation_euler),
                "scale": list(candidate.scale),
                "mesh": (
                    None
                    if candidate.type != "MESH"
                    else {
                        "vertices": len(candidate.data.vertices),
                        "edges": len(candidate.data.edges),
                        "polygons": len(candidate.data.polygons),
                        "sha256": mesh_sha256(candidate.data),
                    }
                ),
            }
            for candidate in sorted(bpy.data.objects, key=lambda item: item.name)
        ],
    }


def snapshot_sha256(snapshot: dict[str, object]) -> str:
    return hashlib.sha256(
        json.dumps(snapshot, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


baseline_snapshot = scene_snapshot()
baseline_scene_fingerprint_sha256 = snapshot_sha256(baseline_snapshot)
baseline_cube_pointer = initial_active.as_pointer()
baseline_cube_mesh_pointer = initial_active.data.as_pointer()
baseline_cube_mesh_sha256 = mesh_sha256(initial_active.data)
event_receipts: list[dict[str, object]] = []
current_step_label = "preflight"
source_operator: dict[str, object] | None = None


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def simulate(
    event_type: str,
    value: str = "PRESS",
    *,
    x: int,
    y: int,
    unicode: str = "",
    ctrl: bool = False,
    shift: bool = False,
) -> None:
    event: dict[str, object] = {
        "type": event_type,
        "value": value,
        "x": x,
        "y": y,
        "ctrl": ctrl,
        "shift": shift,
    }
    if unicode:
        event["unicode"] = unicode
    event_receipts.append(
        {
            "index": len(event_receipts) + 1,
            "step": current_step_label,
            "type": event_type,
            "value": value,
            "x": x,
            "y": y,
            "ctrl": ctrl,
            "shift": shift,
            "unicode": unicode,
        }
    )
    window.event_simulate(**event)


def capture_source_operator() -> None:
    global source_operator

    active = bpy.context.view_layer.objects.active
    assert active is not None and active.name == "Sphere" and active.type == "MESH"
    candidates = [
        candidate
        for candidate in bpy.context.window_manager.operators
        if candidate.bl_idname == "MESH_OT_primitive_uv_sphere_add"
    ]
    assert candidates
    operator = candidates[-1]
    source_operator = {
        "id": operator.bl_idname,
        "segments": int(operator.properties.segments),
        "ringCount": int(operator.properties.ring_count),
        "radius": float(operator.properties.radius),
        "location": list(operator.properties.location),
    }
    assert source_operator == {
        "id": "MESH_OT_primitive_uv_sphere_add",
        "segments": 32,
        "ringCount": 16,
        "radius": 1.0,
        "location": [0.0, 0.0, 0.0],
    }


steps: list[tuple[str, float, Callable[[], None]]] = [
    (
        "dismiss splash press",
        0.04,
        lambda: simulate("ESC", x=add_point[0], y=add_point[1]),
    ),
    (
        "dismiss splash release",
        0.15,
        lambda: simulate("ESC", "RELEASE", x=add_point[0], y=add_point[1]),
    ),
    (
        "hover add",
        0.15,
        lambda: simulate("MOUSEMOVE", "NOTHING", x=add_point[0], y=add_point[1]),
    ),
    ("press add", 0.04, lambda: simulate("LEFTMOUSE", x=add_point[0], y=add_point[1])),
    (
        "move within add",
        0.04,
        lambda: simulate(
            "MOUSEMOVE", "NOTHING", x=add_point[0] + 1, y=add_point[1]
        ),
    ),
    (
        "release add",
        0.3,
        lambda: simulate(
            "LEFTMOUSE", "RELEASE", x=add_point[0] + 1, y=add_point[1]
        ),
    ),
    (
        "hover first menu row",
        0.2,
        lambda: simulate(
            "MOUSEMOVE",
            "NOTHING",
            x=mesh_point[0],
            y=mesh_point[1],
        ),
    ),
    (
        "settle mesh hover",
        0.2,
        lambda: simulate(
            "MOUSEMOVE",
            "NOTHING",
            x=mesh_point[0] + 1,
            y=mesh_point[1],
        ),
    ),
    (
        "open mesh submenu press",
        0.5,
        lambda: simulate("RIGHT_ARROW", x=add_point[0], y=add_point[1]),
    ),
    (
        "hover uv sphere",
        0.15,
        lambda: simulate(
            "MOUSEMOVE",
            "NOTHING",
            x=uv_sphere_point[0],
            y=uv_sphere_point[1],
        ),
    ),
    (
        "press uv sphere",
        0.04,
        lambda: simulate(
            "LEFTMOUSE", x=uv_sphere_point[0], y=uv_sphere_point[1]
        ),
    ),
    (
        "move within uv sphere",
        0.04,
        lambda: simulate(
            "MOUSEMOVE",
            "NOTHING",
            x=uv_sphere_point[0] + 1,
            y=uv_sphere_point[1],
        ),
    ),
    (
        "release uv sphere",
        0.8,
        lambda: simulate(
            "LEFTMOUSE",
            "RELEASE",
            x=uv_sphere_point[0] + 1,
            y=uv_sphere_point[1],
        ),
    ),
    ("capture source operator", 0.1, capture_source_operator),
    (
        "open sidebar press",
        0.04,
        lambda: simulate(
            "N",
            x=area.x + area.width // 2,
            y=area.y + area.height // 2,
        ),
    ),
    (
        "open sidebar release",
        0.6,
        lambda: simulate(
            "N",
            "RELEASE",
            x=area.x + area.width // 2,
            y=area.y + area.height // 2,
        ),
    ),
]


def transform_control_point(group: str, component_index: int) -> tuple[int, int]:
    ui_region = next(candidate for candidate in area.regions if candidate.type == "UI")
    assert ui_region.width >= round(250 * ui_scale)
    base_offset = 91 if group == "location" else 276
    return (
        ui_region.x + round(138 * ui_scale),
        header.y - round((base_offset + component_index * 20) * ui_scale),
    )


def properties_object_name_point() -> tuple[int, int]:
    properties = next(
        candidate for candidate in window.screen.areas if candidate.type == "PROPERTIES"
    )
    properties_window = next(
        candidate for candidate in properties.regions if candidate.type == "WINDOW"
    )
    properties_header = next(
        candidate for candidate in properties.regions if candidate.type == "HEADER"
    )
    assert properties.spaces.active.context == "OBJECT"
    assert properties_window.width >= round(180 * ui_scale)
    return (
        properties_window.x + round(115 * ui_scale),
        properties_header.y - round(53 * ui_scale),
    )


PointFactory = Callable[[], tuple[int, int]]


def add_control_event(
    label: str,
    event_type: str,
    *,
    point: PointFactory,
    value: str = "PRESS",
    delay: float = 0.04,
    unicode: str = "",
    ctrl: bool = False,
    shift: bool = False,
) -> None:
    def dispatch() -> None:
        x, y = point()
        simulate(
            event_type,
            value,
            x=x,
            y=y,
            unicode=unicode,
            ctrl=ctrl,
            shift=shift,
        )

    steps.append((label, delay, dispatch))


def add_numeric_control_edit(
    label: str,
    point: PointFactory,
    text: str,
) -> None:
    add_control_event(label + ":hover", "MOUSEMOVE", point=point, value="NOTHING")
    for click_index in (1, 2):
        add_control_event(
            f"{label}:click-{click_index}:press",
            "LEFTMOUSE",
            point=point,
            delay=0.03,
        )
        add_control_event(
            f"{label}:click-{click_index}:release",
            "LEFTMOUSE",
            point=point,
            value="RELEASE",
            delay=0.12 if click_index == 2 else 0.04,
        )
    add_control_event(label + ":select-all", "A", point=point, ctrl=True, delay=0.08)
    key_names = {
        "-": "MINUS",
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
        add_control_event(
            f"{label}:text-{character_index}:{character}",
            key_names[character],
            point=point,
            unicode=character,
        )
    add_control_event(label + ":confirm:press", "RET", point=point)
    add_control_event(
        label + ":confirm:release",
        "RET",
        point=point,
        value="RELEASE",
        delay=0.2,
    )


def add_text_control_edit(label: str, point: PointFactory, text: str) -> None:
    add_control_event(label + ":hover", "MOUSEMOVE", point=point, value="NOTHING")
    for click_index in (1,):
        add_control_event(
            f"{label}:click-{click_index}:press",
            "LEFTMOUSE",
            point=point,
            delay=0.03,
        )
        add_control_event(
            f"{label}:click-{click_index}:release",
            "LEFTMOUSE",
            point=point,
            value="RELEASE",
            delay=0.12,
        )
    add_control_event(label + ":select-all", "A", point=point, ctrl=True, delay=0.08)
    key_names = {".": "PERIOD", "-": "MINUS"}
    for character_index, character in enumerate(text):
        add_control_event(
            f"{label}:text-{character_index}:{character}",
            key_names.get(character, character.upper()),
            point=point,
            unicode=character,
        )
    add_control_event(label + ":confirm:press", "RET", point=point)
    add_control_event(
        label + ":confirm:release",
        "RET",
        point=point,
        value="RELEASE",
        delay=0.4,
    )


for component_index, text in enumerate(("1.25", "-2", "0.75")):
    add_numeric_control_edit(
        f"set location {component_index}",
        lambda component_index=component_index: transform_control_point(
            "location", component_index
        ),
        text,
    )

for component_index in range(3):
    add_numeric_control_edit(
        f"set scale {component_index}",
        lambda component_index=component_index: transform_control_point(
            "scale", component_index
        ),
        "1.5",
    )

add_text_control_edit(
    "rename object",
    properties_object_name_point,
    EXPECTED_ARGUMENTS["objectName"],
)

history_snapshots: list[dict[str, object]] = []
final_snapshot: dict[str, object] | None = None


def record_history_snapshot(label: str) -> None:
    proof_object = bpy.data.objects.get(EXPECTED_ARGUMENTS["objectName"]) or bpy.data.objects.get(
        "Sphere"
    )
    history_snapshots.append(
        {
            "label": label,
            "objectNames": sorted(bpy.data.objects.keys()),
            "activeObject": (
                None
                if bpy.context.view_layer.objects.active is None
                else bpy.context.view_layer.objects.active.name
            ),
            "proofObjectName": None if proof_object is None else proof_object.name,
            "proofObjectLocation": (
                None if proof_object is None else list(proof_object.location)
            ),
            "proofObjectScale": None if proof_object is None else list(proof_object.scale),
            "proofMeshTopology": (
                None
                if proof_object is None
                else {
                    "vertices": len(proof_object.data.vertices),
                    "edges": len(proof_object.data.edges),
                    "polygons": len(proof_object.data.polygons),
                }
            ),
            "sceneFingerprintSha256": snapshot_sha256(scene_snapshot()),
        }
    )


def capture_final_state() -> None:
    global final_snapshot

    active = bpy.context.view_layer.objects.active
    assert active is not None
    assert active.name == EXPECTED_ARGUMENTS["objectName"]
    assert active.type == "MESH"
    assert list(active.location) == EXPECTED_ARGUMENTS["location"]
    assert list(active.scale) == [EXPECTED_ARGUMENTS["radius"]] * 3
    assert len(active.modifiers) == 0
    assert (
        len(active.data.vertices),
        len(active.data.edges),
        len(active.data.polygons),
    ) == (482, 992, 512)
    assert source_operator is not None
    final_snapshot = scene_snapshot()
    record_history_snapshot("final")


def viewport_center_point() -> tuple[int, int]:
    return area.x + area.width // 2, area.y + area.height // 2


steps.append(("record final state", 0.1, capture_final_state))
add_control_event(
    "anchor viewport for history",
    "MOUSEMOVE",
    point=viewport_center_point,
    value="NOTHING",
    delay=0.15,
)
for history_index in range(1, HISTORY_DEPTH + 1):
    add_control_event(
        f"native undo {history_index}:press",
        "Z",
        point=viewport_center_point,
        ctrl=True,
    )
    add_control_event(
        f"native undo {history_index}:release",
        "Z",
        point=viewport_center_point,
        value="RELEASE",
        ctrl=True,
        delay=0.6,
    )
    steps.append(
        (
            f"record undo {history_index}",
            0.05,
            lambda history_index=history_index: record_history_snapshot(
                f"undo-{history_index}"
            ),
        )
    )

for history_index in range(1, HISTORY_DEPTH + 1):
    add_control_event(
        f"native redo {history_index}:press",
        "Z",
        point=viewport_center_point,
        ctrl=True,
        shift=True,
    )
    add_control_event(
        f"native redo {history_index}:release",
        "Z",
        point=viewport_center_point,
        value="RELEASE",
        ctrl=True,
        shift=True,
        delay=0.6,
    )
    steps.append(
        (
            f"record redo {history_index}",
            0.05,
            lambda history_index=history_index: record_history_snapshot(
                f"redo-{history_index}"
            ),
        )
    )


def validate_history_snapshots() -> None:
    assert final_snapshot is not None
    expected = [
        (
            "final",
            EXPECTED_ARGUMENTS["objectName"],
            EXPECTED_ARGUMENTS["location"],
            [EXPECTED_ARGUMENTS["radius"]] * 3,
        ),
        ("undo-1", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.5, 1.5]),
        ("undo-2", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.5, 1.0]),
        ("undo-3", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.0, 1.0]),
        ("undo-4", "Sphere", EXPECTED_ARGUMENTS["location"], [1.0, 1.0, 1.0]),
        ("undo-5", "Sphere", [1.25, -2.0, 0.0], [1.0, 1.0, 1.0]),
        ("undo-6", "Sphere", [1.25, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("undo-7", "Sphere", [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("undo-8", None, None, None),
        ("redo-1", "Sphere", [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("redo-2", "Sphere", [1.25, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("redo-3", "Sphere", [1.25, -2.0, 0.0], [1.0, 1.0, 1.0]),
        ("redo-4", "Sphere", EXPECTED_ARGUMENTS["location"], [1.0, 1.0, 1.0]),
        ("redo-5", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.0, 1.0]),
        ("redo-6", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.5, 1.0]),
        ("redo-7", "Sphere", EXPECTED_ARGUMENTS["location"], [1.5, 1.5, 1.5]),
        (
            "redo-8",
            EXPECTED_ARGUMENTS["objectName"],
            EXPECTED_ARGUMENTS["location"],
            [EXPECTED_ARGUMENTS["radius"]] * 3,
        ),
    ]
    assert len(history_snapshots) == len(expected)
    for snapshot, (label, name, location, scale) in zip(
        history_snapshots, expected, strict=True
    ):
        assert snapshot["label"] == label
        assert snapshot["proofObjectName"] == name
        assert snapshot["proofObjectLocation"] == location
        assert snapshot["proofObjectScale"] == scale
        assert snapshot["proofMeshTopology"] == (
            None if name is None else {"vertices": 482, "edges": 992, "polygons": 512}
        )
    baseline = history_snapshots[HISTORY_DEPTH]
    reapplied = history_snapshots[-1]
    assert baseline["activeObject"] == "Cube"
    assert baseline["objectNames"] == ["Camera", "Cube", "Light"]
    assert baseline["sceneFingerprintSha256"] == baseline_scene_fingerprint_sha256
    assert reapplied["sceneFingerprintSha256"] == snapshot_sha256(final_snapshot)


def finish() -> None:
    validate_history_snapshots()
    assert final_snapshot is not None
    assert source_operator is not None
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.name == EXPECTED_ARGUMENTS["objectName"]
    assert list(active.location) == EXPECTED_ARGUMENTS["location"]
    assert list(active.scale) == [EXPECTED_ARGUMENTS["radius"]] * 3
    assert sorted(bpy.data.objects.keys()) == [
        "Camera",
        "Cube",
        "Light",
        EXPECTED_ARGUMENTS["objectName"],
    ]
    cube = bpy.data.objects["Cube"]
    assert cube.as_pointer() == baseline_cube_pointer
    assert cube.data.as_pointer() == baseline_cube_mesh_pointer
    assert mesh_sha256(cube.data) == baseline_cube_mesh_sha256
    assert len(bpy.data.meshes) == 2
    final_scene_fingerprint_sha256 = snapshot_sha256(scene_snapshot())
    assert final_scene_fingerprint_sha256 == snapshot_sha256(final_snapshot)
    event_sequence_sha256 = hashlib.sha256(
        json.dumps(event_receipts, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()
    payload = {
        "ok": True,
        "proofFormatVersion": "1.0.0",
        "executorId": EXECUTOR_ID,
        "targetProfile": TARGET_PROFILE,
        "executionBoundary": "blender_window_event_simulate",
        "transport": "event_simulate",
        "osHidInput": False,
        "managedActionExecuted": False,
        "managedReceiptCreated": False,
        "authorization": "accepted_replay_next_step",
        "blenderVersion": bpy.app.version_string,
        "hostVersion": ".".join(str(value) for value in bpy.app.version),
        "window": [window.width, window.height],
        "area": [area.x, area.y, area.width, area.height],
        "header": [header.x, header.y, header.width, header.height],
        "uiScale": ui_scale,
        "addPoint": add_point,
        "meshPoint": mesh_point,
        "uvSpherePoint": uv_sphere_point,
        "operationIds": OPERATION_IDS,
        "acceptedAction": {
            "name": "blender.mesh.create_uv_sphere",
            "arguments": EXPECTED_ARGUMENTS,
        },
        "operationReceipts": [
            {
                "operationId": "workspace.layout",
                "status": "precondition_verified",
                "path": ["Layout"],
                "parameters": {},
            },
            {
                "operationId": "menu.add",
                "status": "control_executed",
                "path": ["Layout", "Add"],
                "parameters": {},
            },
            {
                "operationId": "menu.mesh",
                "status": "control_executed",
                "path": ["Layout", "Add", "Mesh"],
                "parameters": {},
            },
            {
                "operationId": "operator.uv_sphere",
                "status": "control_executed",
                "path": ["Layout", "Add", "Mesh", "UV Sphere"],
                "parameters": {"radius": 1},
            },
            {
                "operationId": "control.location",
                "status": "control_executed",
                "path": ["Sidebar", "Item", "Transform", "Location"],
                "parameters": {"value": EXPECTED_ARGUMENTS["location"]},
            },
            {
                "operationId": "control.scale",
                "status": "control_executed",
                "path": ["Sidebar", "Item", "Transform", "Scale"],
                "parameters": {"value": [EXPECTED_ARGUMENTS["radius"]] * 3},
            },
            {
                "operationId": "control.object_name",
                "status": "control_executed",
                "path": ["Properties", "Object", "Name"],
                "parameters": {"value": EXPECTED_ARGUMENTS["objectName"]},
            },
        ],
        "sourceOperator": source_operator,
        "finalState": {
            "objectName": active.name,
            "objectType": active.type,
            "location": list(active.location),
            "scale": list(active.scale),
            "meshTopology": {
                "vertices": len(active.data.vertices),
                "edges": len(active.data.edges),
                "polygons": len(active.data.polygons),
            },
            "meshSha256": mesh_sha256(active.data),
        },
        "eventSimulateCount": len(event_receipts),
        "eventSequenceSha256": event_sequence_sha256,
        "nativeUndoDepth": HISTORY_DEPTH,
        "strongObservationKind": "uv_sphere_menu_controls_ready",
        "nativeUndoCheckpointRequired": True,
        "historySnapshots": history_snapshots,
        "baselineSceneFingerprintSha256": baseline_scene_fingerprint_sha256,
        "finalSceneFingerprintSha256": final_scene_fingerprint_sha256,
        "restoredSceneFingerprintSha256": history_snapshots[HISTORY_DEPTH][
            "sceneFingerprintSha256"
        ],
        "reappliedSceneFingerprintSha256": history_snapshots[-1][
            "sceneFingerprintSha256"
        ],
        "menuControlExecutionVerified": True,
        "strongCurrentStateVerified": True,
        "nativeUndoCheckpointVerified": True,
    }
    write_result(payload)
    print(
        "UV_SPHERE_MENU_CONTROL PASS "
        + json.dumps(
            {
                "hostVersion": payload["hostVersion"],
                "eventSimulateCount": payload["eventSimulateCount"],
                "baselineSceneFingerprintSha256": payload[
                    "baselineSceneFingerprintSha256"
                ],
                "finalSceneFingerprintSha256": payload[
                    "finalSceneFingerprintSha256"
                ],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


steps.append(("finish", 0.1, finish))


def advance() -> float | None:
    global current_step_label

    if not steps:
        return None
    label, delay, action = steps.pop(0)
    current_step_label = label
    if VERBOSE:
        print(f"UV_SPHERE_MENU_CONTROL step={label}", flush=True)
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
            "proofFormatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "eventSimulateCount": len(event_receipts),
            "historySnapshots": history_snapshots,
        }
        write_result(failure)
        print("UV_SPHERE_MENU_CONTROL FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


bpy.app.timers.register(advance, first_interval=1.0)
