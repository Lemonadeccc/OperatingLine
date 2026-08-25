"""Real-Blender proof for the six-step bounded Poke Faces executor."""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"

TARGET_ID = "guided.edit_poke.target"
RESULT_MESH_ID = "guided.edit_poke.result_mesh"
TARGET_NAME = "OperatingLine.GuidedEditPokeTarget"
RESULT_MESH_NAME = "OperatingLine.GuidedEditPokeResult"
STEP_ID = "guided.edit_poke"
ARGUMENTS = {
    "targetId": TARGET_ID,
    "resultMeshId": RESULT_MESH_ID,
    "resultMeshName": RESULT_MESH_NAME,
    "offset": 0.2,
}


def _step(
    step_id: str,
    order: int,
    action: dict | None,
    *,
    depends_on: list[str] | None = None,
    expected_observations: list[dict] | None = None,
) -> dict:
    result = {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": action,
    }
    if expected_observations is not None:
        result["expectedObservations"] = expected_observations
        result["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
    return result


PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            TARGET_ID,
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": TARGET_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            STEP_ID,
            2,
            {
                "adapterId": "blender",
                "name": "blender.mesh.edit_poke_faces",
                "arguments": ARGUMENTS,
            },
            depends_on=[TARGET_ID],
            expected_observations=[
                {
                    "kind": "mesh_faces_poked",
                    "parameters": ARGUMENTS,
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_edit_poke_integration",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _record(session, step, run, operation_ids, ordinal, result):
    return session.record_leaf_operation(
        step,
        run_id=run.run_id,
        operation_id=operation_ids[ordinal - 1],
        ordinal=ordinal,
        before_sha256=result.before_fingerprint,
        after_sha256=result.after_fingerprint,
        observation=result.observation,
        partial_action_receipt=None if ordinal < 5 else result.receipt,
    )


def _assert_operation_evidence(result, ordinal: int) -> None:
    operations = result.observation["details"]["evidence"][
        "editPokeMeshOperations"
    ]
    assert [operation["order"] for operation in operations] == list(
        range(1, len(operations) + 1)
    )
    if ordinal == 5:
        assert len(operations) == 3
        assert operations[0]["mutationKind"] == "edit_poke_mesh_create"
        assert operations[0]["resourceType"] == "Mesh"
        assert operations[0]["pendingResultMeshName"].startswith(
            "OperatingLine.PendingEditPokeMesh."
        )
        by_parameter = {
            operation["parameterName"]: operation
            for operation in operations[1:2]
        }
        assert math.isclose(
            by_parameter["offset"]["projectedValue"], 0.2, abs_tol=1e-9
        )
        content = operations[2]
        assert content["mutationKind"] == "edit_poke_mesh_content_write"
        assert content["fixedParameters"] == {
            "centerMode": "MEAN_WEIGHTED",
            "useRelativeOffset": False,
        }
        assert content["sourceTopology"] == [8, 12, 6]
        assert content["sourceLoopCount"] == 24
        assert content["expectedTopology"] == [14, 36, 24]
        assert content["resultTopology"] == [14, 36, 24]
        assert content["sourceContentPreserved"] is True
        assert content["resultContentObserved"] is True
        assert content["allTriangles"] is True
        assert content["resultNondegenerate"] is True
    elif ordinal == 6:
        assert len(operations) == 2
        assert operations[0]["mutationKind"] == "edit_poke_mesh_name_write"
        assert operations[0]["acceptedName"] == RESULT_MESH_NAME
        assert operations[0]["observedName"] == RESULT_MESH_NAME
        assert (
            operations[1]["mutationKind"]
            == "edit_poke_object_data_link_write"
        )
        assert operations[1]["sourceMeshLogicalId"] == f"{TARGET_ID}.mesh"
        assert operations[1]["resultMeshLogicalId"] == RESULT_MESH_ID
        assert operations[1]["observedLink"] is True
    else:
        assert not operations


def _execute_all(session, step, snapshot, definition, operations):
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 7):
        result = operations.execute_edit_poke_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        run = _record(session, step, run, operation_ids, ordinal, result)
        _assert_operation_evidence(result, ordinal)
        mutating = ordinal in operations.EDIT_POKE_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_edit_poke_stage(
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=run.partial_action_receipt,
        )
        if ordinal in {5, 6}:
            inverse = operations.inverse_edit_poke_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = inverse.transaction
            run = session.rewind_leaf_operation(
                step,
                run_id=run.run_id,
                operation_id=operation_ids[ordinal - 1],
                ordinal=ordinal,
                partial_action_receipt=None if ordinal <= 5 else inverse.receipt,
            )
            replay = operations.execute_edit_poke_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            _assert_operation_evidence(replay, ordinal)
            transaction = replay.transaction
            run = _record(session, step, run, operation_ids, ordinal, replay)
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_edit_poke_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_edit_poke_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_edit_poke_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_edit_poke_integration.operating_line.infrastructure import (
        guided_edit_poke_operations as operations,
    )
    from operating_line_guided_edit_poke_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_edit_poke_integration.operating_line.infrastructure.snowman_actions.editing import (
        validate_edit_poke_faces,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-edit-poke-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == TARGET_ID
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.mesh.edit_poke_faces.semantic"
    assert tuple(
        operation.operation_id for operation in snapshot.operations
    ) == operations.EDIT_POKE_OPERATION_IDS
    definition = validate_edit_poke_faces(step.action.arguments)
    target = bpy.data.objects[TARGET_NAME]
    source_mesh = target.data

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    result_mesh = target.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == RESULT_MESH_NAME
    assert (len(result_mesh.vertices), len(result_mesh.edges), len(result_mesh.polygons)) == (
        14,
        36,
        24,
    )
    assert all(len(polygon.vertices) == 3 for polygon in result_mesh.polygons)
    assert (len(source_mesh.vertices), len(source_mesh.edges), len(source_mesh.polygons)) == (
        8,
        12,
        6,
    )

    for ordinal in range(6, 0, -1):
        inverse = operations.inverse_edit_poke_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = inverse.transaction
        run = session.rewind_leaf_operation(
            step,
            run_id=run.run_id,
            operation_id=operation_ids[ordinal - 1],
            ordinal=ordinal,
            partial_action_receipt=None if ordinal <= 5 else inverse.receipt,
        )
    assert transaction.completed_operations == ()
    assert target.data is source_mesh
    assert bpy.data.meshes.get(RESULT_MESH_NAME) is None
    assert session.pending_leaf_operation_run is None

    run, _transaction, _operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 6
    assert session.receipts[step.id] == partial_receipt
    observations = session.success_gate_observation_copy(step.id)
    assert observations is not None and observations[0]["satisfied"] is True
    assert observations[0]["kind"] == "mesh_faces_poked"
    assert observations[0]["details"]["topologyMatches"] is True
    assert observations[0]["details"]["resultNondegenerate"] is True
    assert observations[0]["details"]["sourceLoopCount"] == 24
    assert observations[0]["details"]["sourceContentIntact"] is True

    assert session.back() is step
    assert target.data is source_mesh
    assert bpy.data.meshes.get(RESULT_MESH_NAME) is None
    print(
        "OperatingLine guided Edit Poke proof passed: "
        "6 forward + 6 inverse + replay + completion",
        bpy.app.version_string,
        flush=True,
    )


try:
    main()
except BaseException:
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    raise
