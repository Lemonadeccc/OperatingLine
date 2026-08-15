"""Foreground Blender proof for managed Mirror Modifier native Undo/Redo recovery."""

from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_native_undo_mirror_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_native_undo_mirror_e2e.operating_line.application import (  # noqa: E402
    DemoSession,
)
from operating_line_native_undo_mirror_e2e.operating_line.application.session import (  # noqa: E402
    ModifierState,
)
from operating_line_native_undo_mirror_e2e.operating_line.domain import (  # noqa: E402
    load_task_tree_data,
)
from operating_line_native_undo_mirror_e2e.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    native_history_error,
    resolve_resource,
)
from operating_line_native_undo_mirror_e2e.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    mesh_content_signature,
)


OBJECT_NAME = "OperatingLine.NativeUndoMirrorCube"
MODIFIER_NAME = "OperatingLine.NativeUndoMirror.Mirror"
MODIFIER_ID = "native_mirror.cube.modifier"


def _step(
    step_id: str,
    order: int,
    action: dict | None,
    *,
    depends_on: list[str] | None = None,
) -> dict:
    return {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": action,
    }


PLAN = {
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "native_mirror.cube",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "native_mirror.cube",
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "native_mirror.modifier",
            2,
            {
                "adapterId": "blender",
                "name": "blender.modifier.add_mirror",
                "arguments": {
                    "targetId": "native_mirror.cube",
                    "modifierId": MODIFIER_ID,
                    "modifierName": MODIFIER_NAME,
                    "axis": "X",
                },
            },
            depends_on=["native_mirror.cube"],
        ),
    ],
}


def _history_override():
    window = bpy.context.window_manager.windows[0]
    area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
    region = next(region for region in area.regions if region.type == "WINDOW")
    return bpy.context.temp_override(window=window, area=area, region=region)


def _undo() -> None:
    with _history_override():
        assert bpy.ops.ed.undo() == {"FINISHED"}


def _redo() -> None:
    with _history_override():
        assert bpy.ops.ed.redo() == {"FINISHED"}


def _push(message: str) -> None:
    with _history_override():
        assert bpy.ops.ed.undo_push(message=message) == {"FINISHED"}


def _modifier_state(session: DemoSession) -> ModifierState:
    states = tuple(
        mutation.after
        for mutation in session.receipts["native_mirror.modifier"].mutations
        if isinstance(mutation.after, ModifierState)
        and mutation.after.logical_id == MODIFIER_ID
    )
    assert len(states) == 1
    return states[0]


def _assert_mirror(target: bpy.types.Object) -> bpy.types.MirrorModifier:
    modifier = target.modifiers.get(MODIFIER_NAME)
    assert modifier is not None and modifier.type == "MIRROR"
    assert tuple(modifier.use_axis) == (True, False, False)
    assert tuple(modifier.use_bisect_axis) == (False, False, False)
    assert tuple(modifier.use_bisect_flip_axis) == (False, False, False)
    assert modifier.use_clip is False
    assert modifier.use_mirror_merge is True
    assert math.isclose(modifier.merge_threshold, 0.001, abs_tol=1e-6)
    assert math.isclose(modifier.bisect_threshold, 0.001, abs_tol=1e-6)
    assert modifier.mirror_object is None
    assert modifier.use_mirror_vertex_groups is True
    assert modifier.use_mirror_u is False
    assert modifier.use_mirror_v is False
    assert modifier.use_mirror_udim is False
    assert math.isclose(modifier.offset_u, 0.0, abs_tol=1e-6)
    assert math.isclose(modifier.offset_v, 0.0, abs_tol=1e-6)
    assert math.isclose(modifier.mirror_offset_u, 0.0, abs_tol=1e-6)
    assert math.isclose(modifier.mirror_offset_v, 0.0, abs_tol=1e-6)
    assert modifier.show_viewport is True
    assert modifier.show_render is True
    assert modifier.show_in_editmode is True
    assert modifier.show_on_cage is False
    if hasattr(modifier, "use_apply_on_spline"):
        assert modifier.use_apply_on_spline is False
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    assert (len(evaluated.vertices), len(evaluated.edges), len(evaluated.polygons)) == (
        16,
        24,
        12,
    )
    return modifier


def run() -> None:
    extension.register()
    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root, action_registry(root), plan_id="native-undo-mirror-e2e", revision=1
    )
    extension.operating_line.replace_session(session)

    _push("OperatingLine native Mirror Undo baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine native Mirror Undo after Start")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Mirror Undo after Cube")
    target = bpy.data.objects[OBJECT_NAME]
    source_identity = next(
        identity
        for identity in session.receipts["native_mirror.cube"].created
        if identity.logical_id == "native_mirror.cube.mesh"
    )
    assert resolve_resource(source_identity) is target.data
    source_signature = mesh_content_signature(target.data)
    source_pointer = target.data.as_pointer()
    mesh_count = len(bpy.data.meshes)

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Mirror Undo after Mirror")
    assert session.active_index == 1
    target = bpy.data.objects[OBJECT_NAME]
    modifier = _assert_mirror(target)
    state = _modifier_state(session)
    assert state.pointer == modifier.as_pointer()
    assert state.stack_index == 0
    assert target.data.as_pointer() == source_pointer
    assert mesh_content_signature(target.data) == source_signature
    assert len(bpy.data.meshes) == mesh_count

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 0
    assert "native_mirror.modifier" not in session.receipts
    target = bpy.data.objects[OBJECT_NAME]
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert target.data.as_pointer() == source_pointer
    assert mesh_content_signature(target.data) == source_signature
    assert len(bpy.data.meshes) == mesh_count

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 1
    target = bpy.data.objects[OBJECT_NAME]
    modifier = _assert_mirror(target)
    rebound_state = _modifier_state(session)
    assert rebound_state.pointer == modifier.as_pointer()
    assert rebound_state.stack_index == 0
    assert target.data.as_pointer() == source_pointer
    assert mesh_content_signature(target.data) == source_signature
    assert len(bpy.data.meshes) == mesh_count

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert session.active_index == 0
    target = bpy.data.objects[OBJECT_NAME]
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert target.data.as_pointer() == source_pointer
    assert mesh_content_signature(target.data) == source_signature
    assert len(bpy.data.meshes) == mesh_count

    print(
        "OperatingLine Mirror Modifier native Undo round trip passed",
        bpy.app.version_string,
        flush=True,
    )
    extension.unregister()
    bpy.ops.wm.quit_blender()


def guarded_run() -> None:
    try:
        run()
    except BaseException:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)


bpy.app.timers.register(guarded_run, first_interval=1.0)
