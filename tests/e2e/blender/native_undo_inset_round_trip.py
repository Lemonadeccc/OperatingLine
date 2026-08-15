"""Foreground Blender proof for Individual Inset native Undo/Redo recovery."""

import importlib.util
import os
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_native_undo_inset_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_native_undo_inset_e2e.operating_line.application import (  # noqa: E402
    DemoSession,
)
from operating_line_native_undo_inset_e2e.operating_line.domain import (  # noqa: E402
    load_task_tree_data,
)
from operating_line_native_undo_inset_e2e.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    native_history_error,
    resolve_resource,
)


OBJECT_NAME = "OperatingLine.NativeUndoInsetCube"
RESULT_MESH_NAME = "OperatingLine.NativeUndoInset.ResultMesh"


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
            "native_inset.cube",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "native_inset.cube",
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "native_inset.faces",
            2,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_inset_faces",
                "arguments": {
                    "targetId": "native_inset.cube",
                    "resultMeshId": "native_inset.cube.inset_mesh",
                    "resultMeshName": RESULT_MESH_NAME,
                    "thickness": 0.2,
                    "depth": 0.1,
                },
            },
            depends_on=["native_inset.cube"],
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


def run() -> None:
    extension.register()
    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="native-undo-inset-e2e",
        revision=1,
    )
    extension.operating_line.replace_session(session)

    _push("OperatingLine native Inset Undo baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine native Inset Undo after Start")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Inset Undo after Cube")
    cube = bpy.data.objects[OBJECT_NAME]
    source_mesh = cube.data
    source_identity = next(
        identity
        for identity in session.receipts["native_inset.cube"].created
        if identity.logical_id == "native_inset.cube.mesh"
    )
    assert resolve_resource(source_identity) is source_mesh

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Inset Undo after Individual Inset")
    assert session.active_index == 1
    cube = bpy.data.objects[OBJECT_NAME]
    result_mesh = cube.data
    result_identity = next(
        identity
        for identity in session.receipts["native_inset.faces"].created
        if identity.logical_id == "native_inset.cube.inset_mesh"
    )
    assert resolve_resource(result_identity) is result_mesh
    assert result_identity.pointer == result_mesh.as_pointer()
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (32, 60, 30)

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 0
    assert "native_inset.faces" not in session.receipts
    cube = bpy.data.objects[OBJECT_NAME]
    restored_source_identity = next(
        identity
        for identity in session.receipts["native_inset.cube"].created
        if identity.logical_id == "native_inset.cube.mesh"
    )
    assert resolve_resource(restored_source_identity) is cube.data
    assert restored_source_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (8, 12, 6)
    assert bpy.data.meshes.get(RESULT_MESH_NAME) is None

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 1
    cube = bpy.data.objects[OBJECT_NAME]
    rebound_identity = next(
        identity
        for identity in session.receipts["native_inset.faces"].created
        if identity.logical_id == "native_inset.cube.inset_mesh"
    )
    assert resolve_resource(rebound_identity) is cube.data
    assert rebound_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (32, 60, 30)

    print(
        "OperatingLine Individual Inset native Undo round trip passed",
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
