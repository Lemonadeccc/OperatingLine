"""Real-Blender proof for the four-step bounded Subdivision Surface executor."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"

TARGET_ID = "guided.subdivision_surface.target"
MODIFIER_ID = "guided.subdivision_surface.modifier"
TARGET_NAME = "OperatingLine.GuidedSubdivisionSurfaceTarget"
MODIFIER_NAME = "OperatingLine.GuidedSubdivisionSurface"
STEP_ID = "guided.subdivision_surface"
ARGUMENTS = {
    "targetId": TARGET_ID,
    "modifierId": MODIFIER_ID,
    "modifierName": MODIFIER_NAME,
    "viewportLevel": 2,
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
                "name": "blender.modifier.add_subdivision_surface",
                "arguments": ARGUMENTS,
            },
            depends_on=[TARGET_ID],
            expected_observations=[
                {
                    "kind": "modifier_ready",
                    "parameters": {
                        "targetId": TARGET_ID,
                        "modifierId": MODIFIER_ID,
                        "modifierType": "SUBSURF",
                        "levels": ARGUMENTS["viewportLevel"],
                        "renderLevels": 2,
                        "subdivisionType": "CATMULL_CLARK",
                        "quality": 3,
                        "showOnlyControlEdges": True,
                        "useCreases": True,
                        "useLimitSurface": True,
                        "boundarySmooth": "ALL",
                        "uvSmooth": "PRESERVE_BOUNDARIES",
                        "useCustomNormals": False,
                        "showViewport": True,
                        "showRender": True,
                        "showInEditMode": True,
                        "showOnCage": False,
                    },
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_subdivision_surface_integration",
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
        partial_action_receipt=None if ordinal < 3 else result.receipt,
    )


def _assert_rna_evidence(result, ordinal: int) -> None:
    mutations = result.observation["details"]["evidence"][
        "rnaSubdivisionSurfaceModifierMutations"
    ]
    assert [mutation["order"] for mutation in mutations] == list(
        range(1, len(mutations) + 1)
    )
    if ordinal == 3:
        assert len(mutations) == 1
        mutation = mutations[0]
        assert mutation["mutationKind"] == "subdivision_surface_modifier_create"
        assert mutation["resourceType"] == "SubsurfModifier"
        assert mutation["modifierType"] == "SUBSURF"
        assert mutation["pendingModifierName"].startswith(
            "OperatingLine.PendingSubdivisionSurfaceModifier."
        )
    elif ordinal == 4:
        assert len(mutations) == 15
        assert mutations[0]["mutationKind"] == "subdivision_surface_modifier_name_write"
        assert mutations[0]["acceptedName"] == MODIFIER_NAME
        property_mutations = mutations[1:]
        assert all(
            mutation["mutationKind"] == "subdivision_surface_modifier_property_write"
            for mutation in property_mutations
        )
        by_name = {
            mutation["propertyName"]: mutation for mutation in property_mutations
        }
        assert by_name["subdivision_type"]["observedValue"] == "CATMULL_CLARK"
        assert by_name["levels"]["observedValue"] == 2
        assert by_name["render_levels"]["observedValue"] == 2
        assert by_name["quality"]["observedValue"] == 3
        assert by_name["show_only_control_edges"]["observedValue"] is True
        assert by_name["use_limit_surface"]["observedValue"] is True
    else:
        assert not mutations


def _execute_all(session, step, snapshot, definition, operations):
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 5):
        result = operations.execute_subdivision_surface_operation(
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
        _assert_rna_evidence(result, ordinal)
        mutating = ordinal in operations.SUBDIVISION_SURFACE_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_subdivision_surface_stage(
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=run.partial_action_receipt,
        )
        if ordinal in {3, 4}:
            inverse = operations.inverse_subdivision_surface_operation(
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
                partial_action_receipt=None if ordinal <= 3 else inverse.receipt,
            )
            replay = operations.execute_subdivision_surface_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            _assert_rna_evidence(replay, ordinal)
            transaction = replay.transaction
            run = _record(session, step, run, operation_ids, ordinal, replay)
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_subdivision_surface_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_subdivision_surface_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_subdivision_surface_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_subdivision_surface_integration.operating_line.infrastructure import (
        guided_subdivision_surface_operations as operations,
    )
    from operating_line_guided_subdivision_surface_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_subdivision_surface_integration.operating_line.infrastructure.snowman_actions.editing import (
        validate_subdivision_surface,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-subdivision-surface-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == TARGET_ID
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.modifier.add_subdivision_surface.semantic"
    assert tuple(
        operation.operation_id for operation in snapshot.operations
    ) == operations.SUBDIVISION_SURFACE_OPERATION_IDS
    definition = validate_subdivision_surface(step.action.arguments)

    run, transaction, operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    target = bpy.data.objects[TARGET_NAME]
    assert len(target.modifiers) == 1
    modifier = target.modifiers[0]
    assert modifier.name == MODIFIER_NAME
    assert modifier.type == "SUBSURF"
    assert modifier.subdivision_type == "CATMULL_CLARK"
    assert modifier.levels == 2
    assert modifier.render_levels == 2
    assert modifier.quality == 3
    assert modifier.show_only_control_edges is True
    assert modifier.use_creases is True
    assert modifier.use_limit_surface is True
    assert modifier.boundary_smooth == "ALL"
    assert modifier.uv_smooth == "PRESERVE_BOUNDARIES"
    assert modifier.use_custom_normals is False

    for ordinal in range(4, 0, -1):
        inverse = operations.inverse_subdivision_surface_operation(
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
            partial_action_receipt=None if ordinal <= 3 else inverse.receipt,
        )
    assert transaction.completed_operations == ()
    assert len(target.modifiers) == 0
    assert session.pending_leaf_operation_run is None

    run, _transaction, _operation_ids = _execute_all(
        session, step, snapshot, definition, operations
    )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 4
    assert session.receipts[step.id] == partial_receipt
    observations = session.success_gate_observation_copy(step.id)
    assert observations is not None and observations[0]["satisfied"] is True
    assert observations[0]["kind"] == "modifier_ready"
    assert observations[0]["details"]["propertiesMatch"] is True
    assert observations[0]["details"]["sourceContentIntact"] is True
    assert observations[0]["details"]["evaluatedWithinLimits"] is True

    assert session.back() is step
    assert len(target.modifiers) == 0
    print(
        "OperatingLine guided Subdivision Surface proof passed: "
        "4 forward + 4 inverse + replay + completion",
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
