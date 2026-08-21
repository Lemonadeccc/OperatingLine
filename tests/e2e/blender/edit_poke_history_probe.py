"""Foreground stop-gate proof for one-step native Poke Faces Undo/Redo."""

from __future__ import annotations

import json
import os
import traceback
from hashlib import sha256
from pathlib import Path
from typing import Callable

import bmesh
import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_EDIT_POKE_HISTORY_RESULT"])
SCENARIO = os.environ["OPERATINGLINE_EDIT_POKE_HISTORY_SCENARIO"]
SCENARIOS = {
    "undo_tab_redo",
    "undo_twice_tab_redo",
    "checkpoint_roundtrip",
    "object_four_step_roundtrip",
    "object_ed_push_roundtrip",
    "edit_ed_push_roundtrip",
    "edit_post_push_roundtrip",
    "edit_grouped_operator_roundtrip",
}
assert SCENARIO in SCENARIOS
EDIT_MODE_SCENARIOS = {
    "edit_ed_push_roundtrip",
    "edit_post_push_roundtrip",
    "edit_grouped_operator_roundtrip",
}
window = bpy.context.window
assert window is not None
area = next(candidate for candidate in window.screen.areas if candidate.type == "VIEW_3D")
region = next(candidate for candidate in area.regions if candidate.type == "WINDOW")
space = area.spaces.active
center_x = area.x + area.width // 2
center_y = area.y + area.height // 2
ui_scale = bpy.context.preferences.system.ui_scale
offset_point = (center_x + round(210 * ui_scale), center_y - round(50 * ui_scale))

snapshots: dict[str, dict[str, object]] = {}


class OPERATINGLINE_OT_poke_baseline_checkpoint(bpy.types.Operator):
    bl_idname = "operating_line.poke_baseline_checkpoint"
    bl_label = "OperatingLine Poke Baseline Checkpoint"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, _context):
        return {"FINISHED"}


bpy.utils.register_class(OPERATINGLINE_OT_poke_baseline_checkpoint)


class OPERATINGLINE_OT_grouped_poke(bpy.types.Operator):
    bl_idname = "operating_line.grouped_poke"
    bl_label = "OperatingLine Grouped Poke"
    bl_options = {"REGISTER", "UNDO", "UNDO_GROUPED"}

    def execute(self, _context):
        result = bpy.ops.mesh.poke(
            offset=0.2,
            use_relative_offset=False,
            center_mode="MEDIAN_WEIGHTED",
        )
        return result


bpy.utils.register_class(OPERATINGLINE_OT_grouped_poke)


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def rounded(value: float) -> float:
    normalized = round(float(value), 9)
    return 0.0 if normalized == -0.0 else normalized


def canonical_cycle(indices: tuple[int, ...]) -> list[int]:
    if not indices:
        return []
    candidates: list[tuple[int, ...]] = []
    for oriented in (indices, tuple(reversed(indices))):
        candidates.extend(oriented[index:] + oriented[:index] for index in range(len(oriented)))
    return list(min(candidates))


def mesh_state(mesh: bpy.types.Mesh) -> tuple[dict[str, object], dict[str, list[int]], str]:
    if bpy.context.mode == "EDIT_MESH":
        edit_mesh = bmesh.from_edit_mesh(mesh)
        edit_mesh.verts.ensure_lookup_table()
        edit_mesh.edges.ensure_lookup_table()
        edit_mesh.faces.ensure_lookup_table()
        edit_mesh.verts.index_update()
        edit_mesh.edges.index_update()
        edit_mesh.faces.index_update()
        content = {
            "vertices": [
                [rounded(component) for component in vertex.co]
                for vertex in edit_mesh.verts
            ],
            "edges": sorted(
                sorted((int(edge.verts[0].index), int(edge.verts[1].index)))
                for edge in edit_mesh.edges
            ),
            "polygons": sorted(
                canonical_cycle(tuple(int(vertex.index) for vertex in face.verts))
                for face in edit_mesh.faces
            ),
        }
        selection = {
            "vertices": [vertex.index for vertex in edit_mesh.verts if vertex.select],
            "edges": [edge.index for edge in edit_mesh.edges if edge.select],
            "polygons": [face.index for face in edit_mesh.faces if face.select],
        }
        return content, selection, "live_bmesh"

    content = {
        "vertices": [[rounded(component) for component in vertex.co] for vertex in mesh.vertices],
        "edges": sorted(
            sorted((int(edge.vertices[0]), int(edge.vertices[1]))) for edge in mesh.edges
        ),
        "polygons": sorted(
            canonical_cycle(tuple(int(index) for index in polygon.vertices))
            for polygon in mesh.polygons
        ),
    }
    selection = {
        "vertices": [vertex.index for vertex in mesh.vertices if vertex.select],
        "edges": [edge.index for edge in mesh.edges if edge.select],
        "polygons": [polygon.index for polygon in mesh.polygons if polygon.select],
    }
    return content, selection, "object_mesh"


def scene_fingerprint() -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    mesh = active.data
    content, selection, mesh_source = mesh_state(mesh)
    canonical_content = json.dumps(content, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return {
        "mode": bpy.context.mode,
        "activeObject": active.name,
        "selectedObjects": sorted(candidate.name for candidate in bpy.context.selected_objects),
        "objectIdentity": {
            "name": active.name,
            "type": active.type,
            "meshName": mesh.name,
        },
        "runtimePointers": {
            "object": active.as_pointer(),
            "mesh": mesh.as_pointer(),
        },
        "meshSource": mesh_source,
        "transform": {
            "location": [rounded(value) for value in active.location],
            "rotationMode": active.rotation_mode,
            "rotationEuler": [rounded(value) for value in active.rotation_euler],
            "scale": [rounded(value) for value in active.scale],
        },
        "topology": {
            "vertices": len(content["vertices"]),
            "edges": len(content["edges"]),
            "polygons": len(content["polygons"]),
        },
        "selection": selection,
        "meshContent": content,
        "meshContentSha256": sha256(canonical_content).hexdigest(),
        "meshDatablockCount": len(bpy.data.meshes),
    }


def comparable(fingerprint: dict[str, object]) -> dict[str, object]:
    return {
        key: value
        for key, value in fingerprint.items()
        if key not in {"runtimePointers", "meshSource"}
    }


def capture(label: str) -> None:
    snapshots[label] = scene_fingerprint()


def push_baseline_checkpoint() -> None:
    assert bpy.context.mode == "OBJECT"
    if SCENARIO == "object_ed_push_roundtrip":
        assert bpy.ops.ed.undo_push(message="OperatingLine Object baseline") == {"FINISHED"}
    else:
        assert bpy.ops.operating_line.poke_baseline_checkpoint() == {"FINISHED"}


def push_edit_checkpoint(message: str) -> None:
    assert bpy.context.mode == "EDIT_MESH"
    assert bpy.ops.ed.undo_push(message=message) == {"FINISHED"}


def execute_grouped_poke() -> None:
    assert bpy.context.mode == "EDIT_MESH"
    assert bpy.ops.operating_line.grouped_poke() == {"FINISHED"}


def capture_factory_baseline() -> None:
    capture("factoryBaseline")
    if SCENARIO not in EDIT_MODE_SCENARIOS:
        capture("baseline")


def simulate(
    event_type: str,
    value: str = "PRESS",
    *,
    unicode: str = "",
    ctrl: bool = False,
    shift: bool = False,
    x: int | None = None,
    y: int | None = None,
) -> None:
    event: dict[str, object] = {
        "type": event_type,
        "value": value,
        "x": center_x if x is None else x,
        "y": center_y if y is None else y,
        "ctrl": ctrl,
        "shift": shift,
    }
    if unicode:
        event["unicode"] = unicode
    window.event_simulate(**event)


def finish() -> None:
    factory_baseline = snapshots["factoryBaseline"]
    baseline = snapshots["baseline"]
    final = snapshots["final"]
    fixture_checks = {
        "baselineIsFactoryCube": (
            factory_baseline["mode"] == "OBJECT"
            and factory_baseline["topology"] == {"vertices": 8, "edges": 12, "polygons": 6}
            and factory_baseline["meshDatablockCount"] == 1
        ),
        "finalIsPokedCube": (
            final["mode"] == ("EDIT_MESH" if SCENARIO in EDIT_MODE_SCENARIOS else "OBJECT")
            and final["topology"] == {"vertices": 14, "edges": 36, "polygons": 24}
            and len(final["selection"]["polygons"]) == 24
            and final["meshDatablockCount"] == factory_baseline["meshDatablockCount"]
        ),
    }
    invariant_checks = {
        "objectIdentityRemainsStable": all(
            snapshot["objectIdentity"] == baseline["objectIdentity"]
            and snapshot["activeObject"] == baseline["activeObject"]
            and snapshot["selectedObjects"] == baseline["selectedObjects"]
            and snapshot["transform"] == baseline["transform"]
            for snapshot in snapshots.values()
        ),
        "runtimePointersRemainStable": all(
            snapshot["runtimePointers"] == baseline["runtimePointers"]
            for snapshot in snapshots.values()
        ),
        "meshDatablockCountRemainsStable": all(
            snapshot["meshDatablockCount"] == baseline["meshDatablockCount"]
            for snapshot in snapshots.values()
        ),
    }

    if SCENARIO == "undo_tab_redo":
        expected_hashes = {
            "afterUndo": final["meshContentSha256"],
            "afterTab": baseline["meshContentSha256"],
            "afterRedo": final["meshContentSha256"],
        }
        scenario_checks = {
            "undoLeavesLiveFinal": (
                snapshots["afterUndo"]["mode"] == "EDIT_MESH"
                and snapshots["afterUndo"]["meshSource"] == "live_bmesh"
                and snapshots["afterUndo"]["meshContentSha256"] == final["meshContentSha256"]
            ),
            "tabRestoresObjectBaseline": comparable(snapshots["afterTab"]) == comparable(baseline),
            "redoRestoresObjectFinal": comparable(snapshots["afterRedo"]) == comparable(final),
        }
        sequence = ["CTRL+Z", "TAB", "CTRL+SHIFT+Z"]
    elif SCENARIO == "undo_twice_tab_redo":
        expected_hashes = {
            "afterUndo1": final["meshContentSha256"],
            "afterUndo2": baseline["meshContentSha256"],
            "afterTab": baseline["meshContentSha256"],
            "afterRedo": final["meshContentSha256"],
        }
        scenario_checks = {
            "firstUndoLeavesLiveFinal": (
                snapshots["afterUndo1"]["mode"] == "EDIT_MESH"
                and snapshots["afterUndo1"]["meshSource"] == "live_bmesh"
                and snapshots["afterUndo1"]["meshContentSha256"] == final["meshContentSha256"]
            ),
            "secondUndoRestoresLiveBaseline": (
                snapshots["afterUndo2"]["mode"] == "EDIT_MESH"
                and snapshots["afterUndo2"]["meshSource"] == "live_bmesh"
                and snapshots["afterUndo2"]["meshContentSha256"] == baseline["meshContentSha256"]
            ),
            "tabRestoresObjectBaseline": comparable(snapshots["afterTab"]) == comparable(baseline),
            "redoRestoresObjectFinal": comparable(snapshots["afterRedo"]) == comparable(final),
        }
        sequence = ["CTRL+Z", "CTRL+Z", "TAB", "CTRL+SHIFT+Z"]
    elif SCENARIO in {"checkpoint_roundtrip", "object_ed_push_roundtrip"}:
        expected_hashes = {
            "afterUndo1": final["meshContentSha256"],
            "afterUndo2": baseline["meshContentSha256"],
            "afterUndo3": baseline["meshContentSha256"],
            "afterRedo1": baseline["meshContentSha256"],
            "afterRedo2": final["meshContentSha256"],
            "afterRedo3": final["meshContentSha256"],
        }
        scenario_checks = {
            "firstUndoLeavesLiveFinal": (
                snapshots["afterUndo1"]["mode"] == "EDIT_MESH"
                and snapshots["afterUndo1"]["meshContentSha256"] == final["meshContentSha256"]
            ),
            "secondUndoRestoresLiveBaseline": (
                snapshots["afterUndo2"]["mode"] == "EDIT_MESH"
                and snapshots["afterUndo2"]["meshContentSha256"] == baseline["meshContentSha256"]
            ),
            "thirdUndoRestoresObjectBaseline": (
                comparable(snapshots["afterUndo3"]) == comparable(baseline)
            ),
            "firstRedoRestoresLiveBaseline": (
                snapshots["afterRedo1"]["mode"] == "EDIT_MESH"
                and snapshots["afterRedo1"]["meshContentSha256"] == baseline["meshContentSha256"]
            ),
            "secondRedoRestoresLiveFinal": (
                snapshots["afterRedo2"]["mode"] == "EDIT_MESH"
                and snapshots["afterRedo2"]["meshContentSha256"] == final["meshContentSha256"]
            ),
            "thirdRedoRestoresObjectFinal": (
                comparable(snapshots["afterRedo3"]) == comparable(final)
            ),
        }
        sequence = ["CHECKPOINT", "CTRL+Z x3", "CTRL+SHIFT+Z x3"]
    elif SCENARIO == "object_four_step_roundtrip":
        expected_hashes = {
            "afterUndo1": final["meshContentSha256"],
            "afterUndo2": baseline["meshContentSha256"],
            "afterUndo3": baseline["meshContentSha256"],
            "afterUndo4": baseline["meshContentSha256"],
            "afterRedo1": baseline["meshContentSha256"],
            "afterRedo2": baseline["meshContentSha256"],
            "afterRedo3": final["meshContentSha256"],
            "afterRedo4": final["meshContentSha256"],
        }
        scenario_checks = {
            "fourthUndoRestoresObjectBaseline": (
                comparable(snapshots["afterUndo4"]) == comparable(baseline)
            ),
            "fourthRedoRestoresObjectFinal": (
                comparable(snapshots["afterRedo4"]) == comparable(final)
            ),
        }
        sequence = ["CHECKPOINT", "CTRL+Z x4", "CTRL+SHIFT+Z x4"]
    elif SCENARIO in {"edit_ed_push_roundtrip", "edit_grouped_operator_roundtrip"}:
        expected_hashes = {
            "afterUndo": baseline["meshContentSha256"],
            "afterRedo": final["meshContentSha256"],
        }
        scenario_checks = {
            "undoRestoresLiveEditBaseline": (
                comparable(snapshots["afterUndo"]) == comparable(baseline)
            ),
            "redoRestoresLiveEditFinal": comparable(snapshots["afterRedo"]) == comparable(final),
        }
        sequence = (
            ["EDIT_BASELINE", "UNDO_GROUPED_POKE", "CTRL+Z", "CTRL+SHIFT+Z"]
            if SCENARIO == "edit_grouped_operator_roundtrip"
            else ["EDIT_BASELINE", "ED_UNDO_PUSH", "POKE", "CTRL+Z", "CTRL+SHIFT+Z"]
        )
    else:
        expected_hashes = {
            "afterUndo1": final["meshContentSha256"],
            "afterUndo2": baseline["meshContentSha256"],
            "afterRedo1": final["meshContentSha256"],
            "afterRedo2": final["meshContentSha256"],
        }
        scenario_checks = {
            "secondUndoRestoresLiveEditBaseline": (
                comparable(snapshots["afterUndo2"]) == comparable(baseline)
            ),
            "secondRedoRestoresLiveEditFinal": (
                comparable(snapshots["afterRedo2"]) == comparable(final)
            ),
        }
        sequence = ["EDIT_BASELINE", "POKE", "ED_UNDO_PUSH", "CTRL+Z x2", "CTRL+SHIFT+Z x2"]

    invariant_checks["meshHashesMatchExpectedStates"] = all(
        snapshots[label]["meshContentSha256"] == expected_hash
        for label, expected_hash in expected_hashes.items()
    )
    candidate_passed = (
        all(fixture_checks.values())
        and all(invariant_checks.values())
        and all(scenario_checks.values())
    )
    failed_checks = [
        name
        for group in (fixture_checks, invariant_checks, scenario_checks)
        for name, passed in group.items()
        if not passed
    ]
    result = {
        "ok": True,
        "scenario": SCENARIO,
        "candidateGate": "passed" if candidate_passed else "failed",
        "blenderVersion": bpy.app.version_string,
        "checks": {
            "fixture": fixture_checks,
            "invariants": invariant_checks,
            "scenario": scenario_checks,
        },
        "sequence": sequence,
        "failedChecks": failed_checks,
        "snapshots": snapshots,
        "historyEvents": sequence,
    }
    write_result(result)
    prefix = "CANDIDATE_PASS" if candidate_passed else "CANDIDATE_FAILED"
    print(
        f"EDIT_POKE_HISTORY {prefix} "
        + json.dumps(
            {
                "blenderVersion": result["blenderVersion"],
                "scenario": result["scenario"],
                "candidateGate": result["candidateGate"],
                "failedChecks": result["failedChecks"],
                "checks": result["checks"],
            },
            sort_keys=True,
        ),
        flush=True,
    )
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
    shift: bool = False,
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
                shift=shift,
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
    shift: bool = False,
) -> None:
    add_event(label + ":press", event_type, delay=0.04, ctrl=ctrl, shift=shift)
    add_event(label + ":release", event_type, "RELEASE", delay=delay, ctrl=ctrl, shift=shift)


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


add_event("dismiss splash", "ESC", delay=0.15)
add_event("anchor cursor", "MOUSEMOVE", "NOTHING", delay=0.15)
steps.append(("capture factory baseline", 0.1, capture_factory_baseline))
if SCENARIO not in EDIT_MODE_SCENARIOS:
    steps.append(("push native baseline checkpoint", 0.1, push_baseline_checkpoint))
add_press_release("enter edit mode", "TAB", delay=0.3)
add_press_release("face select mode", "THREE", delay=0.2)
add_press_release("select all", "A", delay=0.2)
if SCENARIO in EDIT_MODE_SCENARIOS:
    steps.append(("capture live Edit baseline", 0.1, lambda: capture("baseline")))
if SCENARIO == "edit_ed_push_roundtrip":
    steps.append(
        (
            "push live Edit baseline",
            0.1,
            lambda: push_edit_checkpoint("OperatingLine Edit baseline"),
        )
    )
if SCENARIO == "edit_grouped_operator_roundtrip":
    steps.append(("execute UNDO_GROUPED Poke", 0.5, execute_grouped_poke))
else:
    add_press_release("open operator search", "F3", delay=0.3)
    add_text("search poke faces", "poke faces")
    add_press_release("execute search result", "RET", delay=0.6)
    add_press_release("open redo panel", "F9", delay=0.6)
    add_double_click("edit offset", offset_point)
    add_event("select offset text", "A", ctrl=True, delay=0.08)
    add_text("type offset", "0.2")
    add_press_release("confirm offset", "RET", delay=0.5)
    add_press_release("close redo panel", "RET", delay=0.5)
if SCENARIO not in EDIT_MODE_SCENARIOS:
    add_press_release("return to object mode", "TAB", delay=0.5)
steps.append(("capture final", 0.1, lambda: capture("final")))
if SCENARIO == "edit_post_push_roundtrip":
    steps.append(
        (
            "push live Edit final",
            0.1,
            lambda: push_edit_checkpoint("OperatingLine Edit final"),
        )
    )

if SCENARIO == "undo_tab_redo":
    add_press_release("undo exit edit mode", "Z", delay=0.8, ctrl=True)
    steps.append(("capture after Undo", 0.1, lambda: capture("afterUndo")))
    add_press_release("tab after Undo", "TAB", delay=0.5)
    steps.append(("capture after TAB", 0.1, lambda: capture("afterTab")))
    add_press_release("redo after TAB", "Z", delay=0.8, ctrl=True, shift=True)
    steps.append(("capture after Redo", 0.1, lambda: capture("afterRedo")))
elif SCENARIO == "undo_twice_tab_redo":
    add_press_release("undo exit edit mode", "Z", delay=0.8, ctrl=True)
    steps.append(("capture after first Undo", 0.1, lambda: capture("afterUndo1")))
    add_press_release("undo poke", "Z", delay=0.8, ctrl=True)
    steps.append(("capture after second Undo", 0.1, lambda: capture("afterUndo2")))
    add_press_release("tab after two Undos", "TAB", delay=0.5)
    steps.append(("capture after TAB", 0.1, lambda: capture("afterTab")))
    add_press_release("redo after TAB", "Z", delay=0.8, ctrl=True, shift=True)
    steps.append(("capture after Redo", 0.1, lambda: capture("afterRedo")))
elif SCENARIO in {"checkpoint_roundtrip", "object_ed_push_roundtrip"}:
    for index in range(1, 4):
        add_press_release(f"checkpoint Undo {index}", "Z", delay=0.8, ctrl=True)
        steps.append(
            (
                f"capture after Undo {index}",
                0.1,
                lambda index=index: capture(f"afterUndo{index}"),
            )
        )
    for index in range(1, 4):
        add_press_release(f"checkpoint Redo {index}", "Z", delay=0.8, ctrl=True, shift=True)
        steps.append(
            (
                f"capture after Redo {index}",
                0.1,
                lambda index=index: capture(f"afterRedo{index}"),
            )
        )
elif SCENARIO == "object_four_step_roundtrip":
    for index in range(1, 5):
        add_press_release(f"four-step Undo {index}", "Z", delay=0.8, ctrl=True)
        steps.append(
            (f"capture after Undo {index}", 0.1, lambda index=index: capture(f"afterUndo{index}"))
        )
    for index in range(1, 5):
        add_press_release(f"four-step Redo {index}", "Z", delay=0.8, ctrl=True, shift=True)
        steps.append(
            (f"capture after Redo {index}", 0.1, lambda index=index: capture(f"afterRedo{index}"))
        )
elif SCENARIO in {"edit_ed_push_roundtrip", "edit_grouped_operator_roundtrip"}:
    add_press_release("undo Edit Poke", "Z", delay=0.8, ctrl=True)
    steps.append(("capture after Edit Undo", 0.1, lambda: capture("afterUndo")))
    add_press_release("redo Edit Poke", "Z", delay=0.8, ctrl=True, shift=True)
    steps.append(("capture after Edit Redo", 0.1, lambda: capture("afterRedo")))
else:
    for index in range(1, 3):
        add_press_release(f"post-push Undo {index}", "Z", delay=0.8, ctrl=True)
        steps.append(
            (f"capture after Undo {index}", 0.1, lambda index=index: capture(f"afterUndo{index}"))
        )
    for index in range(1, 3):
        add_press_release(f"post-push Redo {index}", "Z", delay=0.8, ctrl=True, shift=True)
        steps.append(
            (f"capture after Redo {index}", 0.1, lambda index=index: capture(f"afterRedo{index}"))
        )
steps.append(("verify stop gate", 0.1, finish))


def advance() -> float | None:
    if not steps:
        return None
    label, delay, action = steps.pop(0)
    print(f"EDIT_POKE_HISTORY step={label}", flush=True)
    try:
        with bpy.context.temp_override(window=window, area=area, region=region, space_data=space):
            action()
    except BaseException as error:
        failure = {
            "ok": False,
            "boundedGate": "failed",
            "blenderVersion": bpy.app.version_string,
            "failedStep": label,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "snapshots": snapshots,
        }
        write_result(failure)
        print("EDIT_POKE_HISTORY FAIL " + json.dumps(failure, sort_keys=True), flush=True)
        os._exit(1)
    return delay


bpy.app.timers.register(advance, first_interval=1.0)
