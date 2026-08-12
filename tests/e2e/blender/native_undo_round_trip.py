"""Foreground Blender proof for native Undo/Redo session synchronization."""

import importlib.util
from hashlib import sha256
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import traceback

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_native_undo_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_native_undo_e2e.operating_line.application import (  # noqa: E402
    DemoSession,
    SessionSnapshot,
)
from operating_line_native_undo_e2e.operating_line.application.session import (  # noqa: E402
    ArtifactIdentity,
    DataBlockReference,
    ModifierState,
)
from operating_line_native_undo_e2e.operating_line.domain import (  # noqa: E402
    load_task_tree_data,
)
from operating_line_native_undo_e2e.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    native_history_error,
    resolve_resource,
)
from operating_line_native_undo_e2e.operating_line.infrastructure.native_history import (  # noqa: E402
    NATIVE_HISTORY_MARKER_KEY,
    NativeHistoryCheckpoint,
    NativeHistoryController,
)
from operating_line_native_undo_e2e.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    resolve_data_block,
)
OBJECT_NAME = "OperatingLine.NativeUndoCube"
BEVEL_NAME = "OperatingLine.NativeUndo.Bevel"
SOLIDIFY_NAME = "OperatingLine.NativeUndo.Solidify"
GEOMETRY_NODES_NAME = "OperatingLine.NativeUndo.GeometryNodes"
USER_OBJECT_NAME = "OperatingLine.NativeUndo.UserObject"
BLUE_MATERIAL_NAME = "OperatingLine.NativeUndo.Blue"
USER_MATERIAL_NAME = "OperatingLine.NativeUndo.UserMaterial"


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
            "native.cube",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "native.cube",
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "native.subdivide",
            2,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "native.cube",
                    "resultMeshId": "native.cube.subdivided_mesh",
                    "resultMeshName": "OperatingLine.NativeUndo.SubdividedMesh",
                    "cuts": 1,
                    "smooth": 0.0,
                },
            },
            depends_on=["native.cube"],
        ),
        _step(
            "native.bevel",
            3,
            {
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "native.cube",
                    "modifierId": "native.cube.bevel",
                    "modifierName": BEVEL_NAME,
                    "width": 0.1,
                    "segments": 3,
                    "angleLimit": 0.5235987755982988,
                },
            },
            depends_on=["native.subdivide"],
        ),
        _step(
            "native.solidify",
            4,
            {
                "adapterId": "blender",
                "name": "blender.modifier.add_solidify",
                "arguments": {
                    "targetId": "native.cube",
                    "modifierId": "native.cube.solidify",
                    "modifierName": SOLIDIFY_NAME,
                    "thickness": 0.2,
                    "offset": 0.0,
                },
            },
            depends_on=["native.bevel"],
        ),
        _step(
            "native.geometry_nodes",
            5,
            {
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_transform",
                "arguments": {
                    "targetId": "native.cube",
                    "modifierId": "native.cube.geometry_nodes",
                    "modifierName": GEOMETRY_NODES_NAME,
                    "nodeGroupId": "native.cube.transform_nodes",
                    "nodeGroupName": "OperatingLine.NativeUndo.TransformNodes",
                    "translation": [0.25, -0.5, 0.75],
                    "rotation": [0.0, 0.0, 0.25],
                    "scale": [1.0, 1.5, 0.5],
                },
            },
            depends_on=["native.solidify"],
        ),
        _step(
            "native.material_blue",
            6,
            {
                "adapterId": "blender",
                "name": "blender.material.create_and_assign",
                "arguments": {
                    "materialId": "native.material.blue",
                    "materialName": BLUE_MATERIAL_NAME,
                    "targets": ["native.cube"],
                    "baseColor": [0.05, 0.15, 0.8, 1.0],
                    "roughness": 0.6,
                    "metallic": 0.0,
                },
            },
            depends_on=["native.geometry_nodes"],
        ),
    ],
}


class OPERATINGLINE_OT_external_undo_probe(bpy.types.Operator):
    bl_idname = "operating_line.external_undo_probe"
    bl_label = "External Undo Probe"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        mesh = bpy.data.meshes.new(f"{USER_OBJECT_NAME}.Mesh")
        obj = bpy.data.objects.new(USER_OBJECT_NAME, mesh)
        context.scene.collection.objects.link(obj)
        return {"FINISHED"}


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


def _modifier_state(session: DemoSession, step_id: str) -> ModifierState:
    receipt = session.receipts[step_id]
    return next(
        mutation.after
        for mutation in receipt.mutations
        if isinstance(mutation.after, ModifierState)
    )


def _artifact(
    path: Path,
    logical_id: str,
    content: bytes,
) -> ArtifactIdentity:
    return ArtifactIdentity(
        logical_id=logical_id,
        path=str(path),
        sha256=sha256(content).hexdigest(),
        width=1,
        height=1,
    )


def _checkpoint(
    checkpoint_id: str,
    artifacts: tuple[ArtifactIdentity, ...],
) -> NativeHistoryCheckpoint:
    return NativeHistoryCheckpoint(
        checkpoint_id=checkpoint_id,
        previous_id=None,
        operation="artifact-test",
        snapshot=SessionSnapshot(None, None, -1, False, None, (), None, None),
        artifacts=artifacts,
    )


def _assert_artifact_transactions() -> None:
    old_content = b"old-native-history-artifact"
    new_content = b"new-native-history-artifact"
    with TemporaryDirectory(prefix="operatingline-native-undo-") as directory:
        path = Path(directory) / "preview.png"
        old_artifact = _artifact(path, "artifact.old", old_content)
        new_artifact = _artifact(path, "artifact.new", new_content)
        controller = NativeHistoryController()
        controller._artifact_blobs = {
            old_artifact.sha256: old_content,
            new_artifact.sha256: new_content,
        }
        empty = _checkpoint("empty", ())
        old = _checkpoint("old", (old_artifact,))
        new = _checkpoint("new", (new_artifact,))

        path.write_bytes(old_content)
        restore_old = controller._apply_artifact_transition(old, empty)
        assert not path.exists()
        restore_old()
        assert path.read_bytes() == old_content

        restore_empty = controller._apply_artifact_transition(old, new)
        assert path.read_bytes() == new_content
        restore_empty()
        assert path.read_bytes() == old_content

        path.write_bytes(b"user-modified-artifact")
        try:
            controller._apply_artifact_transition(old, new)
        except RuntimeError as error:
            assert "modified native Undo artifact" in str(error)
        else:
            raise AssertionError("Modified artifact replacement must fail closed")
        assert path.read_bytes() == b"user-modified-artifact"


def run() -> None:
    _assert_artifact_transactions()
    extension.register()
    bpy.utils.register_class(OPERATINGLINE_OT_external_undo_probe)
    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="native-undo-e2e",
        revision=1,
    )
    extension.operating_line.replace_session(session)

    _push("OperatingLine native Undo baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine native Undo after Start")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Cube")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Subdivide")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Bevel")
    assert session.active_index == 2
    cube = bpy.data.objects[OBJECT_NAME]
    cube_uid = cube.session_uid
    cube_pointer = cube.as_pointer()
    bevel = cube.modifiers[BEVEL_NAME]
    bevel_uidless_pointer = bevel.as_pointer()

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 1
    assert "native.bevel" not in session.receipts
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(BEVEL_NAME) is None
    assert extension.get_companion().last_report["transition"] == "step_rolled_back"

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 2
    cube = bpy.data.objects[OBJECT_NAME]
    bevel = cube.modifiers[BEVEL_NAME]
    assert cube.session_uid == cube_uid
    assert resolve_resource(session.receipts["native.bevel"].anchor) is cube
    assert _modifier_state(session, "native.bevel").pointer == bevel.as_pointer()
    assert cube.as_pointer() != cube_pointer or bevel.as_pointer() != bevel_uidless_pointer
    assert extension.get_companion().last_report["transition"] == "step_succeeded"

    marker = bpy.context.scene[NATIVE_HISTORY_MARKER_KEY]
    report_sequence = extension.get_companion().last_report["sequence"]
    assert bpy.ops.operating_line.external_undo_probe() == {"FINISHED"}
    _push("OperatingLine native Undo external action")
    assert bpy.data.objects.get(USER_OBJECT_NAME) is not None
    _undo()
    assert bpy.data.objects.get(USER_OBJECT_NAME) is None
    assert bpy.context.scene[NATIVE_HISTORY_MARKER_KEY] == marker
    assert session.active_index == 2
    assert extension.get_companion().last_report["sequence"] == report_sequence
    _redo()
    assert bpy.data.objects.get(USER_OBJECT_NAME) is not None
    assert session.active_index == 2
    assert extension.get_companion().last_report["sequence"] == report_sequence

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Solidify")
    assert session.active_index == 3
    cube = bpy.data.objects[OBJECT_NAME]
    solidify = cube.modifiers[SOLIDIFY_NAME]
    solidify_pointer = solidify.as_pointer()
    _undo()
    assert session.active_index == 2
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(SOLIDIFY_NAME) is None
    _redo()
    assert session.active_index == 3
    cube = bpy.data.objects[OBJECT_NAME]
    solidify = cube.modifiers[SOLIDIFY_NAME]
    assert _modifier_state(session, "native.solidify").pointer == solidify.as_pointer()
    assert (
        solidify.as_pointer() != solidify_pointer
        or resolve_resource(session.receipts["native.solidify"].anchor) is cube
    )

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Geometry Nodes")
    assert session.active_index == 4
    cube = bpy.data.objects[OBJECT_NAME]
    geometry_nodes = cube.modifiers[GEOMETRY_NODES_NAME]
    geometry_nodes_pointer = geometry_nodes.as_pointer()
    _undo()
    assert session.active_index == 3
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is None
    _redo()
    assert session.active_index == 4
    cube = bpy.data.objects[OBJECT_NAME]
    geometry_nodes = cube.modifiers[GEOMETRY_NODES_NAME]
    assert _modifier_state(session, "native.geometry_nodes").pointer == (
        geometry_nodes.as_pointer()
    )
    assert (
        geometry_nodes.as_pointer() != geometry_nodes_pointer
        or resolve_resource(session.receipts["native.geometry_nodes"].anchor) is cube
    )

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    _push("OperatingLine native Undo after Back")
    assert session.active_index == 3
    assert cube.modifiers.get(GEOMETRY_NODES_NAME) is None
    _undo()
    assert session.active_index == 4
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is not None
    _redo()
    assert session.active_index == 3
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is None
    assert native_history_error() == ""

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo Geometry Nodes branch")
    user_material = bpy.data.materials.new(USER_MATERIAL_NAME)
    bpy.data.objects[OBJECT_NAME].data.materials.append(user_material)
    _push("OperatingLine native Undo external material")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Blue material")
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME

    _undo()
    assert session.active_index == 4
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    _redo()
    assert session.active_index == 5
    blue_receipt = session.receipts["native.material_blue"]
    before_material = blue_receipt.mutations[0].before[0]
    assert isinstance(before_material, DataBlockReference)
    assert resolve_data_block(before_material).name == USER_MATERIAL_NAME
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    _push("OperatingLine native Undo after material Back")
    assert session.active_index == 4
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    _undo()
    assert session.active_index == 5
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME
    _redo()
    assert session.active_index == 4
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    assert native_history_error() == ""

    print(
        "OperatingLine native Undo round trip passed",
        bpy.app.version_string,
        flush=True,
    )
    bpy.utils.unregister_class(OPERATINGLINE_OT_external_undo_probe)
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
