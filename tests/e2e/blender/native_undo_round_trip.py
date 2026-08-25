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
    GuidedGeometryAtomicityError,
    action_registry,
    native_history_error,
    native_history_requires_native_undo,
    resolve_resource,
)
from operating_line_native_undo_e2e.operating_line.infrastructure.native_history import (  # noqa: E402
    NATIVE_HISTORY_MARKER_KEY,
    NativeHistoryCheckpoint,
    NativeHistoryController,
    _CONTROLLER,
)
from operating_line_native_undo_e2e.operating_line.infrastructure.snowman_actions import (  # noqa: E402
    common as common_actions,
    model as model_actions,
)
from operating_line_native_undo_e2e.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    resolve_data_block,
)
from operating_line_native_undo_e2e.operating_line.presentation.native_menu_guidance import (  # noqa: E402
    focus_next_leaf_operation,
    leaf_guidance_snapshot,
)
from operating_line_native_undo_e2e.operating_line.presentation import (  # noqa: E402
    operators as guided_operators,
)
OBJECT_NAME = "OperatingLine.NativeUndoCube"
BEVEL_NAME = "OperatingLine.NativeUndo.Bevel"
SOLIDIFY_NAME = "OperatingLine.NativeUndo.Solidify"
SUBDIVISION_SURFACE_NAME = "OperatingLine.NativeUndo.SubdivisionSurface"
GEOMETRY_NODES_NAME = "OperatingLine.NativeUndo.GeometryNodes"
USER_OBJECT_NAME = "OperatingLine.NativeUndo.UserObject"
BLUE_MATERIAL_NAME = "OperatingLine.NativeUndo.Blue"
USER_MATERIAL_NAME = "OperatingLine.NativeUndo.UserMaterial"
ABORT_PARTIAL_MESH_NAME = "OperatingLine.NativeUndo.AbortPartialMesh"
ATOMIC_GATE_PARTIAL_MESH_NAME = "OperatingLine.NativeUndo.AtomicGatePartialMesh"
ATOMIC_GATE_EXTERNAL_OBJECT_NAME = "OperatingLine.NativeUndo.AtomicGateExternal"


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
    "protocolVersion": "1.6.0",
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
            "native.triangulate",
            3,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_triangulate",
                "arguments": {
                    "targetId": "native.cube",
                    "resultMeshId": "native.cube.triangulated_mesh",
                    "resultMeshName": "OperatingLine.NativeUndo.TriangulatedMesh",
                },
            },
            depends_on=["native.subdivide"],
        ),
        _step(
            "native.extrude_region",
            4,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_extrude_region",
                "arguments": {
                    "targetId": "native.cube",
                    "resultMeshId": "native.cube.extruded_mesh",
                    "resultMeshName": "OperatingLine.NativeUndo.ExtrudedMesh",
                    "polygonIndices": [0],
                    "translation": [0.0, 0.0, 0.5],
                },
            },
            depends_on=["native.triangulate"],
        ),
        _step(
            "native.edit_bevel_edges",
            5,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_bevel_edges",
                "arguments": {
                    "targetId": "native.cube",
                    "resultMeshId": "native.cube.beveled_mesh",
                    "resultMeshName": "OperatingLine.NativeUndo.BeveledMesh",
                    "width": 0.1,
                    "segments": 1,
                    "profile": 0.5,
                },
            },
            depends_on=["native.extrude_region"],
        ),
        _step(
            "native.bevel",
            6,
            {
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "native.cube",
                    "modifierId": "native.cube.bevel",
                    "modifierName": BEVEL_NAME,
                    "width": 0.1,
                    "segments": 1,
                    "angleLimit": 1.5707963267948966,
                },
            },
            depends_on=["native.edit_bevel_edges"],
        ),
        _step(
            "native.solidify",
            7,
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
            "native.subdivision_surface",
            8,
            {
                "adapterId": "blender",
                "name": "blender.modifier.add_subdivision_surface",
                "arguments": {
                    "targetId": "native.cube",
                    "modifierId": "native.cube.subdivision_surface",
                    "modifierName": SUBDIVISION_SURFACE_NAME,
                    "viewportLevel": 1,
                },
            },
            depends_on=["native.solidify"],
        ),
        _step(
            "native.geometry_nodes",
            9,
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
            depends_on=["native.subdivision_surface"],
        ),
        _step(
            "native.material_blue",
            10,
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

geometry_nodes_step = next(
    step for step in PLAN["steps"] if step["id"] == "native.geometry_nodes"
)
geometry_nodes_step["expectedObservations"] = [
    {"kind": "native_geometry_nodes_complete", "parameters": {}}
]
geometry_nodes_step["observationPolicy"] = {
    "mode": "success_gate",
    "failureStrategy": "rollback_step",
}
material_step = next(
    step for step in PLAN["steps"] if step["id"] == "native.material_blue"
)
material_step["expectedObservations"] = [
    {"kind": "native_material_assignment_complete", "parameters": {}}
]
material_step["observationPolicy"] = {
    "mode": "success_gate",
    "failureStrategy": "rollback_step",
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


def _focus_leaf_operation(step, ordinal: int):
    snapshot = leaf_guidance_snapshot(step)
    assert snapshot is not None
    while snapshot.focused_ordinal < ordinal:
        focused = snapshot.focused_operation
        assert focus_next_leaf_operation(
            step,
            focused.operation_id,
            focused.ordinal,
            snapshot.cursor_token,
        )
        snapshot = leaf_guidance_snapshot(step)
        assert snapshot is not None
    assert snapshot.focused_ordinal == ordinal
    return snapshot


def _execute_guided_geometry_operation(session: DemoSession, ordinal: int) -> None:
    step = session.guidance_step
    assert step is not None and step.action is not None
    snapshot = _focus_leaf_operation(step, ordinal)
    operation = snapshot.focused_operation
    run = session.pending_leaf_operation_run
    run_id = run.run_id if run is not None else ""
    assert bpy.ops.operating_line.execute_guided_geometry_operation(
        step_id=step.id,
        operation_id=operation.operation_id,
        ordinal=operation.ordinal,
        cursor_token=snapshot.cursor_token,
        run_id=run_id,
    ) == {"FINISHED"}


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


def _evaluated_topology(target: bpy.types.Object) -> tuple[int, int, int]:
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        return (
            len(mesh.vertices),
            len(mesh.edges),
            len(mesh.polygons),
        )
    finally:
        evaluated.to_mesh_clear()


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
        snapshot=SessionSnapshot(
            plan_id=None,
            revision=None,
            active_index=-1,
            started=False,
            execution_id=None,
            receipts=(),
            leaf_operation_runs=(),
            observation_gate=None,
            last_success_gate_result=None,
            last_success_gate_retry=None,
        ),
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

    # The shared creation helper must remove an ID when tag_resource fails
    # after a partial custom-property write but before receipt insertion.
    journal_probe_name = "OperatingLine.NativeUndo.JournalProbe"
    journal_probe = bpy.data.meshes.new(journal_probe_name)
    journaled_probe_resources = []
    original_common_tag_resource = common_actions.tag_resource

    def fail_partial_probe_tag(resource, *_args):
        resource["operating_line_fault_injected"] = True
        raise RuntimeError("injected partial journal probe tag")

    common_actions.tag_resource = fail_partial_probe_tag
    try:
        try:
            common_actions.journal_created_resource(
                journaled_probe_resources,
                journal_probe,
                "native.journal_probe.mesh",
                "native-journal-probe-receipt",
                "native.journal_probe",
                "blender.mesh.create_cube",
            )
        except RuntimeError as error:
            assert "injected partial journal probe tag" in str(error)
        else:
            raise AssertionError("Partial resource tagging failure must propagate")
    finally:
        common_actions.tag_resource = original_common_tag_resource
    assert journaled_probe_resources == []
    assert bpy.data.meshes.get(journal_probe_name) is None

    root = load_task_tree_data(PLAN)
    geometry_gate = {"satisfied": True}

    def evaluate_observations(expectations, _receipts):
        return [
            {
                "kind": expectation["kind"],
                "satisfied": geometry_gate["satisfied"],
                "details": {"source": "native-undo-e2e"},
            }
            for expectation in expectations
        ]

    session = DemoSession(
        root,
        action_registry(root),
        plan_id="native-undo-e2e",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    extension.operating_line.replace_session(session)

    _push("OperatingLine native Undo baseline")
    assert bpy.ops.operating_line.start() == {"FINISHED"}
    _push("OperatingLine native Undo after Start")

    # A Blender ID can be created before its receipt identity is journaled.  A
    # failure in the middle of tagging that ID is therefore not proven atomic,
    # even when rollback_partial successfully deletes everything it knows
    # about.  The operator must preserve the residual mesh in an Undo boundary,
    # quarantine further mutation, and unlock only after that exact boundary is
    # undone.
    original_journal_created_resource = model_actions.journal_created_resource

    def fail_mid_mesh_journal(
        created,
        resource,
        logical_id,
        receipt_id,
        step_id,
        action_name,
    ):
        if logical_id != "native.cube.mesh":
            return original_journal_created_resource(
                created,
                resource,
                logical_id,
                receipt_id,
                step_id,
                action_name,
            )
        resource["operating_line_fault_injected"] = True
        raise RuntimeError("injected failure during mesh resource tagging")

    model_actions.journal_created_resource = fail_mid_mesh_journal
    try:
        assert bpy.ops.operating_line.next() == {"FINISHED"}
    finally:
        model_actions.journal_created_resource = original_journal_created_resource
    fault_mesh_name = f"{OBJECT_NAME}.Mesh"
    assert session.active_index == -1
    assert bpy.data.meshes.get(fault_mesh_name) is not None
    assert native_history_requires_native_undo()
    try:
        blocked_result = bpy.ops.operating_line.next()
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result == {"CANCELLED"}

    _push("OperatingLine unjournaled mesh tagging failure boundary")
    _undo()
    assert native_history_error() == ""
    assert not native_history_requires_native_undo()
    assert session.active_index == -1
    assert bpy.data.meshes.get(fault_mesh_name) is None
    _redo()
    try:
        blocked_result = bpy.ops.operating_line.next()
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result in ({"CANCELLED"}, {"FINISHED"})
        # An unlinked orphan is not guaranteed to participate in Blender Redo.
        # If Redo omits it, native history remains at the clean baseline and a
        # fresh cube execution is safe; otherwise the failure checkpoint blocks.
        assert session.active_index in (-1, 0)
    _undo()
    assert not native_history_requires_native_undo()
    assert session.active_index == -1
    assert bpy.data.meshes.get(fault_mesh_name) is None

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Cube")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Subdivide")
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Triangulate")
    assert session.active_index == 2
    cube = bpy.data.objects[OBJECT_NAME]
    triangulated_mesh = cube.data
    assert (
        len(triangulated_mesh.vertices),
        len(triangulated_mesh.edges),
        len(triangulated_mesh.polygons),
    ) == (26, 72, 48)
    assert all(len(polygon.vertices) == 3 for polygon in triangulated_mesh.polygons)

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 1
    cube = bpy.data.objects[OBJECT_NAME]
    subdivided_identity = next(
        identity
        for identity in session.receipts["native.subdivide"].created
        if identity.logical_id == "native.cube.subdivided_mesh"
    )
    assert resolve_resource(subdivided_identity) is cube.data
    assert subdivided_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (26, 48, 24)
    assert "native.triangulate" not in session.receipts

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 2
    cube = bpy.data.objects[OBJECT_NAME]
    triangulated_identity = next(
        identity
        for identity in session.receipts["native.triangulate"].created
        if identity.logical_id == "native.cube.triangulated_mesh"
    )
    assert resolve_resource(triangulated_identity) is cube.data
    assert triangulated_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (26, 72, 48)
    assert all(len(polygon.vertices) == 3 for polygon in cube.data.polygons)

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Extrude Region")
    assert session.active_index == 3
    cube = bpy.data.objects[OBJECT_NAME]
    extruded_identity = next(
        identity
        for identity in session.receipts["native.extrude_region"].created
        if identity.logical_id == "native.cube.extruded_mesh"
    )
    assert resolve_resource(extruded_identity) is cube.data
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (29, 78, 51)

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 2
    assert "native.extrude_region" not in session.receipts
    cube = bpy.data.objects[OBJECT_NAME]
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (26, 72, 48)

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 3
    cube = bpy.data.objects[OBJECT_NAME]
    extruded_identity = next(
        identity
        for identity in session.receipts["native.extrude_region"].created
        if identity.logical_id == "native.cube.extruded_mesh"
    )
    assert resolve_resource(extruded_identity) is cube.data
    assert extruded_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (29, 78, 51)

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Edit Bevel")
    assert session.active_index == 4
    cube = bpy.data.objects[OBJECT_NAME]
    beveled_identity = next(
        identity
        for identity in session.receipts["native.edit_bevel_edges"].created
        if identity.logical_id == "native.cube.beveled_mesh"
    )
    beveled_mesh = cube.data
    beveled_topology = (
        len(beveled_mesh.vertices),
        len(beveled_mesh.edges),
        len(beveled_mesh.polygons),
    )
    assert resolve_resource(beveled_identity) is beveled_mesh
    assert all(
        result_count > source_count
        for result_count, source_count in zip(beveled_topology, (29, 78, 51))
    )

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 3
    assert "native.edit_bevel_edges" not in session.receipts
    cube = bpy.data.objects[OBJECT_NAME]
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == (29, 78, 51)
    assert bpy.data.meshes.get("OperatingLine.NativeUndo.BeveledMesh") is None

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 4
    cube = bpy.data.objects[OBJECT_NAME]
    beveled_identity = next(
        identity
        for identity in session.receipts["native.edit_bevel_edges"].created
        if identity.logical_id == "native.cube.beveled_mesh"
    )
    assert resolve_resource(beveled_identity) is cube.data
    assert beveled_identity.pointer == cube.data.as_pointer()
    assert (
        len(cube.data.vertices),
        len(cube.data.edges),
        len(cube.data.polygons),
    ) == beveled_topology

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Bevel")
    assert session.active_index == 5
    cube = bpy.data.objects[OBJECT_NAME]
    cube_uid = cube.session_uid
    cube_pointer = cube.as_pointer()
    bevel = cube.modifiers[BEVEL_NAME]
    bevel_uidless_pointer = bevel.as_pointer()
    assert all(
        evaluated_count > source_count
        for evaluated_count, source_count in zip(
            _evaluated_topology(cube), beveled_topology
        )
    )

    _undo()
    assert native_history_error() == ""
    assert session.active_index == 4
    assert "native.bevel" not in session.receipts
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(BEVEL_NAME) is None
    assert extension.get_companion().last_report["transition"] == "step_rolled_back"

    _redo()
    assert native_history_error() == ""
    assert session.active_index == 5
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
    assert session.active_index == 5
    assert extension.get_companion().last_report["sequence"] == report_sequence
    _redo()
    assert bpy.data.objects.get(USER_OBJECT_NAME) is not None
    assert session.active_index == 5
    assert extension.get_companion().last_report["sequence"] == report_sequence

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Solidify")
    assert session.active_index == 6
    cube = bpy.data.objects[OBJECT_NAME]
    solidify = cube.modifiers[SOLIDIFY_NAME]
    solidify_pointer = solidify.as_pointer()
    _undo()
    assert session.active_index == 5
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(SOLIDIFY_NAME) is None
    _redo()
    assert session.active_index == 6
    cube = bpy.data.objects[OBJECT_NAME]
    solidify = cube.modifiers[SOLIDIFY_NAME]
    assert _modifier_state(session, "native.solidify").pointer == solidify.as_pointer()
    assert (
        solidify.as_pointer() != solidify_pointer
        or resolve_resource(session.receipts["native.solidify"].anchor) is cube
    )

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Subdivision Surface")
    assert session.active_index == 7
    cube = bpy.data.objects[OBJECT_NAME]
    subdivision_surface = cube.modifiers[SUBDIVISION_SURFACE_NAME]
    subdivision_surface_pointer = subdivision_surface.as_pointer()
    assert subdivision_surface.type == "SUBSURF"
    assert subdivision_surface.levels == 1
    assert subdivision_surface.render_levels == 2
    _undo()
    assert session.active_index == 6
    assert (
        bpy.data.objects[OBJECT_NAME].modifiers.get(SUBDIVISION_SURFACE_NAME) is None
    )
    _redo()
    assert session.active_index == 7
    cube = bpy.data.objects[OBJECT_NAME]
    subdivision_surface = cube.modifiers[SUBDIVISION_SURFACE_NAME]
    assert _modifier_state(
        session, "native.subdivision_surface"
    ).pointer == subdivision_surface.as_pointer()
    assert (
        subdivision_surface.as_pointer() != subdivision_surface_pointer
        or resolve_resource(
            session.receipts["native.subdivision_surface"].anchor
        )
        is cube
    )

    _execute_guided_geometry_operation(session, 1)
    _push("OperatingLine native Undo after guided Geometry operation 01")

    original_execute_geometry_operation = (
        guided_operators.execute_transform_geometry_operation
    )

    def leave_unproven_operation_02(**kwargs):
        result = original_execute_geometry_operation(**kwargs)
        if kwargs["operation_ordinal"] != 2:
            return result
        assert (
            bpy.data.node_groups.get("OperatingLine.NativeUndo.TransformNodes")
            is not None
        ), "operation 02 did not leave the injected host mutation"
        raise GuidedGeometryAtomicityError(
            "injected operation 02 compensation uncertainty"
        )

    guided_operators.execute_transform_geometry_operation = (
        leave_unproven_operation_02
    )
    try:
        step = session.guidance_step
        assert step is not None
        failed_snapshot = _focus_leaf_operation(step, 2)
        failed_operation = failed_snapshot.focused_operation
        run = session.pending_leaf_operation_run
        assert run is not None and run.next_ordinal == 2
        try:
            result = bpy.ops.operating_line.execute_guided_geometry_operation(
                step_id=step.id,
                operation_id=failed_operation.operation_id,
                ordinal=failed_operation.ordinal,
                cursor_token=failed_snapshot.cursor_token,
                run_id=run.run_id,
            )
        except RuntimeError as error:
            assert "native Undo" in str(error)
        else:
            assert result == {"FINISHED"}
    finally:
        guided_operators.execute_transform_geometry_operation = (
            original_execute_geometry_operation
        )
    _push("OperatingLine quarantined guided Geometry operation 02")
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 2
    assert bpy.data.node_groups.get("OperatingLine.NativeUndo.TransformNodes") is not None

    blocked_snapshot = _focus_leaf_operation(session.guidance_step, 2)
    blocked_operation = blocked_snapshot.focused_operation
    try:
        blocked_result = bpy.ops.operating_line.execute_guided_geometry_operation(
            step_id=session.guidance_step.id,
            operation_id=blocked_operation.operation_id,
            ordinal=blocked_operation.ordinal,
            cursor_token=blocked_snapshot.cursor_token,
            run_id=session.pending_leaf_operation_run.run_id,
        )
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result == {"CANCELLED"}

    _undo()
    assert native_history_error() == ""
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 2
    assert bpy.data.node_groups.get("OperatingLine.NativeUndo.TransformNodes") is None
    _redo()
    assert bpy.data.node_groups.get("OperatingLine.NativeUndo.TransformNodes") is not None
    blocked_snapshot = _focus_leaf_operation(session.guidance_step, 2)
    blocked_operation = blocked_snapshot.focused_operation
    try:
        blocked_result = bpy.ops.operating_line.execute_guided_geometry_operation(
            step_id=session.guidance_step.id,
            operation_id=blocked_operation.operation_id,
            ordinal=blocked_operation.ordinal,
            cursor_token=blocked_snapshot.cursor_token,
            run_id=session.pending_leaf_operation_run.run_id,
        )
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result == {"CANCELLED"}
    _undo()
    assert bpy.data.node_groups.get("OperatingLine.NativeUndo.TransformNodes") is None

    for ordinal in range(2, 5):
        _execute_guided_geometry_operation(session, ordinal)
        _push(
            f"OperatingLine native Undo after guided Geometry operation {ordinal:02d}"
        )
    assert session.active_index == 7
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }
    _undo()
    assert native_history_error() == ""
    assert session.active_index == 7
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 4
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {"NodeGroupInput"}
    _redo()
    assert native_history_error() == ""
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }

    step = session.guidance_step
    run = session.pending_leaf_operation_run
    assert step is not None and run is not None and run.next_ordinal == 5
    abort_snapshot = leaf_guidance_snapshot(step)
    assert abort_snapshot is not None
    original_actions = session._actions[step.id]

    def partially_rollback_then_fail(_receipt):
        bpy.data.meshes.new(ABORT_PARTIAL_MESH_NAME)
        assert bpy.data.meshes.get(ABORT_PARTIAL_MESH_NAME) is not None
        raise GuidedGeometryAtomicityError(
            "injected Abort rollback failure after datablock mutation"
        )

    session._actions[step.id] = (original_actions[0], partially_rollback_then_fail)
    try:
        assert bpy.ops.operating_line.abort_guided_geometry_operations(
            step_id=step.id,
            cursor_token=abort_snapshot.cursor_token,
            run_id=run.run_id,
        ) == {"FINISHED"}
    finally:
        session._actions[step.id] = original_actions
    _push("OperatingLine quarantined partial Abort rollback")
    assert native_history_error() == ""
    assert native_history_requires_native_undo()
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    assert bpy.data.meshes.get(ABORT_PARTIAL_MESH_NAME) is not None
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }

    blocked_snapshot = _focus_leaf_operation(step, 5)
    blocked_operation = blocked_snapshot.focused_operation
    try:
        blocked_result = bpy.ops.operating_line.execute_guided_geometry_operation(
            step_id=step.id,
            operation_id=blocked_operation.operation_id,
            ordinal=blocked_operation.ordinal,
            cursor_token=blocked_snapshot.cursor_token,
            run_id=session.pending_leaf_operation_run.run_id,
        )
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result == {"CANCELLED"}

    _undo()
    assert native_history_error() == ""
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    assert bpy.data.meshes.get(ABORT_PARTIAL_MESH_NAME) is None
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }
    _redo()
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    assert bpy.data.meshes.get(ABORT_PARTIAL_MESH_NAME) is not None
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }
    blocked_snapshot = _focus_leaf_operation(step, 5)
    blocked_operation = blocked_snapshot.focused_operation
    try:
        blocked_result = bpy.ops.operating_line.execute_guided_geometry_operation(
            step_id=step.id,
            operation_id=blocked_operation.operation_id,
            ordinal=blocked_operation.ordinal,
            cursor_token=blocked_snapshot.cursor_token,
            run_id=session.pending_leaf_operation_run.run_id,
        )
    except RuntimeError as error:
        assert "native Undo" in str(error)
    else:
        assert blocked_result == {"CANCELLED"}
    _undo()
    assert native_history_error() == ""
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 5
    assert bpy.data.meshes.get(ABORT_PARTIAL_MESH_NAME) is None
    partial_tree = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in partial_tree.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
    }

    for ordinal in range(5, 11):
        _execute_guided_geometry_operation(session, ordinal)
        _push(
            f"OperatingLine native Undo after guided Geometry operation {ordinal:02d}"
        )
    assert session.active_index == 7
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 11
    assert tuple(
        receipt.ordinal
        for receipt in session.pending_leaf_operation_run.operation_receipts
    ) == tuple(range(1, 11))
    complete_prefix = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in complete_prefix.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
        "NodeGroupOutput",
    }
    assert len(complete_prefix.links) == 2

    geometry_gate["satisfied"] = False
    prepared_marker = _CONTROLLER._marker(bpy.context.scene)
    original_marker_reader = _CONTROLLER._marker

    def reject_new_marker(scene):
        actual = original_marker_reader(scene)
        return prepared_marker if actual != prepared_marker else actual

    _CONTROLLER._marker = reject_new_marker
    step = session.guidance_step
    assert step is not None
    failed_snapshot = _focus_leaf_operation(step, 11)
    failed_operation = failed_snapshot.focused_operation
    try:
        try:
            failed_result = bpy.ops.operating_line.execute_guided_geometry_operation(
                step_id=step.id,
                operation_id=failed_operation.operation_id,
                ordinal=failed_operation.ordinal,
                cursor_token=failed_snapshot.cursor_token,
                run_id=session.pending_leaf_operation_run.run_id,
            )
        except RuntimeError as error:
            assert "operation restored" in str(error)
        else:
            assert failed_result == {"CANCELLED"}
    finally:
        del _CONTROLLER._marker
        geometry_gate["satisfied"] = True

    assert native_history_error() == ""
    assert not native_history_requires_native_undo()
    assert original_marker_reader(bpy.context.scene) == prepared_marker
    assert session.active_index == 7
    assert session.observation_gate is None
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 11
    assert tuple(
        receipt.ordinal
        for receipt in session.pending_leaf_operation_run.operation_receipts
    ) == tuple(range(1, 11))
    replayed_prefix = bpy.data.node_groups["OperatingLine.NativeUndo.TransformNodes"]
    assert {node.bl_idname for node in replayed_prefix.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
        "NodeGroupOutput",
    }
    assert len(replayed_prefix.links) == 2

    _execute_guided_geometry_operation(session, 11)
    _push("OperatingLine native Undo after guided Geometry operation 11 retry")
    assert session.active_index == 8
    assert session.pending_leaf_operation_run is None
    cube = bpy.data.objects[OBJECT_NAME]
    geometry_nodes = cube.modifiers[GEOMETRY_NODES_NAME]
    geometry_nodes_pointer = geometry_nodes.as_pointer()
    _undo()
    assert session.active_index == 7
    assert session.pending_leaf_operation_run is not None
    assert session.pending_leaf_operation_run.next_ordinal == 11
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is not None
    _redo()
    assert session.active_index == 8
    assert session.pending_leaf_operation_run is None
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
    assert session.active_index == 7
    assert cube.modifiers.get(GEOMETRY_NODES_NAME) is None
    _undo()
    assert session.active_index == 8
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is not None
    _redo()
    assert session.active_index == 7
    assert bpy.data.objects[OBJECT_NAME].modifiers.get(GEOMETRY_NODES_NAME) is None
    assert native_history_error() == ""

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo Geometry Nodes branch")
    user_material = bpy.data.materials.new(USER_MATERIAL_NAME)
    bpy.data.objects[OBJECT_NAME].data.materials.append(user_material)
    _push("OperatingLine native Undo external material")

    atomic_step = session.guidance_step
    assert atomic_step is not None and atomic_step.id == "native.material_blue"
    original_atomic_actions = session._actions[atomic_step.id]
    prepared_marker = _CONTROLLER._marker(bpy.context.scene)
    original_marker_reader = _CONTROLLER._marker

    def partial_atomic_rollback_then_fail(_receipt):
        bpy.data.meshes.new(ATOMIC_GATE_PARTIAL_MESH_NAME)
        raise RuntimeError("injected atomic success-gate rollback failure")

    def reject_atomic_checkpoint(scene):
        actual = original_marker_reader(scene)
        return prepared_marker if actual != prepared_marker else actual

    geometry_gate["satisfied"] = False
    session._actions[atomic_step.id] = (
        original_atomic_actions[0],
        partial_atomic_rollback_then_fail,
    )
    _CONTROLLER._marker = reject_atomic_checkpoint
    try:
        assert bpy.ops.operating_line.next() == {"FINISHED"}
    finally:
        del _CONTROLLER._marker
        session._actions[atomic_step.id] = original_atomic_actions
        geometry_gate["satisfied"] = True

    assert native_history_requires_native_undo()
    assert "native Undo" in native_history_error()
    assert bpy.data.meshes.get(ATOMIC_GATE_PARTIAL_MESH_NAME) is not None
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME
    assert session.active_index == 8

    _push("OperatingLine unjournaled atomic failure boundary")
    unrelated_mesh = bpy.data.meshes.new(f"{ATOMIC_GATE_EXTERNAL_OBJECT_NAME}.Mesh")
    unrelated_object = bpy.data.objects.new(
        ATOMIC_GATE_EXTERNAL_OBJECT_NAME,
        unrelated_mesh,
    )
    bpy.context.scene.collection.objects.link(unrelated_object)
    _push("OperatingLine unrelated action after unjournaled atomic failure")
    _undo()
    assert native_history_requires_native_undo()
    assert bpy.data.objects.get(ATOMIC_GATE_EXTERNAL_OBJECT_NAME) is None
    assert bpy.data.meshes.get(ATOMIC_GATE_PARTIAL_MESH_NAME) is not None
    _undo()
    assert native_history_error() == ""
    assert not native_history_requires_native_undo()
    assert bpy.data.meshes.get(ATOMIC_GATE_PARTIAL_MESH_NAME) is None
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    assert session.active_index == 8

    _redo()
    assert native_history_requires_native_undo()
    assert "Redo restored" in native_history_error()
    assert bpy.data.meshes.get(ATOMIC_GATE_PARTIAL_MESH_NAME) is not None
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME
    _undo()
    assert native_history_error() == ""
    assert not native_history_requires_native_undo()
    assert bpy.data.meshes.get(ATOMIC_GATE_PARTIAL_MESH_NAME) is None
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME

    assert bpy.ops.operating_line.next() == {"FINISHED"}
    _push("OperatingLine native Undo after Blue material")
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME

    _undo()
    assert session.active_index == 8
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    _redo()
    assert session.active_index == 9
    blue_receipt = session.receipts["native.material_blue"]
    before_material = blue_receipt.mutations[0].before[0]
    assert isinstance(before_material, DataBlockReference)
    assert resolve_data_block(before_material).name == USER_MATERIAL_NAME
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    _push("OperatingLine native Undo after material Back")
    assert session.active_index == 8
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == USER_MATERIAL_NAME
    _undo()
    assert session.active_index == 9
    assert bpy.data.objects[OBJECT_NAME].data.materials[0].name == BLUE_MATERIAL_NAME
    _redo()
    assert session.active_index == 8
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
