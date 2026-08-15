"""Foreground Blender proof for managed Poke Faces native Undo/Redo recovery."""

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
    "operating_line_native_undo_poke_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_native_undo_poke_e2e.operating_line.application import DemoSession  # noqa: E402
from operating_line_native_undo_poke_e2e.operating_line.domain import load_task_tree_data  # noqa: E402
from operating_line_native_undo_poke_e2e.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    native_history_error,
    resolve_resource,
)
from operating_line_native_undo_poke_e2e.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    mesh_content_signature,
)


OBJECT_NAME = "OperatingLine.NativeUndoPokeCube"
RESULT_MESH_NAME = "OperatingLine.NativeUndoPoke.ResultMesh"


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
            "native_poke.cube",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "native_poke.cube",
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "native_poke.faces",
            2,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_poke_faces",
                "arguments": {
                    "targetId": "native_poke.cube",
                    "resultMeshId": "native_poke.cube.poked_mesh",
                    "resultMeshName": RESULT_MESH_NAME,
                    "offset": 0.2,
                },
            },
            depends_on=["native_poke.cube"],
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


def _assert_mesh_bounds(mesh: bpy.types.Mesh, minimum: float, maximum: float) -> None:
    coordinates = tuple(
        float(component) for vertex in mesh.vertices for component in vertex.co
    )
    assert math.isclose(min(coordinates), minimum, rel_tol=0.0, abs_tol=1e-6)
    assert math.isclose(max(coordinates), maximum, rel_tol=0.0, abs_tol=1e-6)


def run() -> None:
    extension.register()
    root = load_task_tree_data(PLAN)
    session = DemoSession(root, action_registry(root), plan_id="native-undo-poke-e2e", revision=1)
    extension.operating_line.replace_session(session)

    _push("OperatingLine native Poke Undo baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine native Poke Undo after Start")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Poke Undo after Cube")
    cube = bpy.data.objects[OBJECT_NAME]
    source_identity = next(
        identity
        for identity in session.receipts["native_poke.cube"].created
        if identity.logical_id == "native_poke.cube.mesh"
    )
    assert resolve_resource(source_identity) is cube.data
    source_signature = mesh_content_signature(cube.data)

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Poke Undo after Poke Faces")
    assert session.active_index == 1
    cube = bpy.data.objects[OBJECT_NAME]
    result_identity = next(
        identity
        for identity in session.receipts["native_poke.faces"].created
        if identity.logical_id == "native_poke.cube.poked_mesh"
    )
    assert resolve_resource(result_identity) is cube.data
    assert result_identity.pointer == cube.data.as_pointer()
    assert (len(cube.data.vertices), len(cube.data.edges), len(cube.data.polygons)) == (14, 36, 24)
    _assert_mesh_bounds(cube.data, -1.2, 1.2)
    result_signature = mesh_content_signature(cube.data)

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 0
    assert "native_poke.faces" not in session.receipts
    cube = bpy.data.objects[OBJECT_NAME]
    restored_identity = next(
        identity
        for identity in session.receipts["native_poke.cube"].created
        if identity.logical_id == "native_poke.cube.mesh"
    )
    assert resolve_resource(restored_identity) is cube.data
    assert restored_identity.pointer == cube.data.as_pointer()
    assert (len(cube.data.vertices), len(cube.data.edges), len(cube.data.polygons)) == (8, 12, 6)
    assert mesh_content_signature(cube.data) == source_signature
    assert bpy.data.meshes.get(RESULT_MESH_NAME) is None

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 1
    cube = bpy.data.objects[OBJECT_NAME]
    rebound_identity = next(
        identity
        for identity in session.receipts["native_poke.faces"].created
        if identity.logical_id == "native_poke.cube.poked_mesh"
    )
    assert resolve_resource(rebound_identity) is cube.data
    assert rebound_identity.pointer == cube.data.as_pointer()
    assert (len(cube.data.vertices), len(cube.data.edges), len(cube.data.polygons)) == (14, 36, 24)
    _assert_mesh_bounds(cube.data, -1.2, 1.2)
    assert mesh_content_signature(cube.data) == result_signature

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert session.active_index == 0
    cube = bpy.data.objects[OBJECT_NAME]
    back_identity = next(
        identity
        for identity in session.receipts["native_poke.cube"].created
        if identity.logical_id == "native_poke.cube.mesh"
    )
    assert resolve_resource(back_identity) is cube.data
    assert back_identity.pointer == cube.data.as_pointer()
    assert (len(cube.data.vertices), len(cube.data.edges), len(cube.data.polygons)) == (8, 12, 6)
    assert bpy.data.meshes.get(RESULT_MESH_NAME) is None

    print("OperatingLine Poke Faces native Undo round trip passed", bpy.app.version_string, flush=True)
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
