"""Real-Blender proof for the four-step bounded single-material executor."""

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

TARGET_IDS = ("guided.material.target-a", "guided.material.target-b")
TARGET_NAMES = (
    "OperatingLine.GuidedMaterialTargetA",
    "OperatingLine.GuidedMaterialTargetB",
)
MATERIAL_ID = "guided.material.surface"
MATERIAL_NAME = "OperatingLine.GuidedMaterial"
STEP_ID = "guided.material"
ARGUMENTS = {
    "materialId": MATERIAL_ID,
    "materialName": MATERIAL_NAME,
    "targets": list(TARGET_IDS),
    "baseColor": [0.17, 0.31, 0.73, 1.0],
    "roughness": 0.64,
    "metallic": 0.28,
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
        *(
            _step(
                target_id,
                index + 1,
                {
                    "adapterId": "blender",
                    "name": "blender.mesh.create_cube",
                    "arguments": {
                        "resourceId": target_id,
                        "objectName": TARGET_NAMES[index],
                        "size": 2.0,
                        "location": [float(index) * 3.0, 0.0, 0.0],
                    },
                },
                depends_on=[] if index == 0 else [TARGET_IDS[index - 1]],
            )
            for index, target_id in enumerate(TARGET_IDS)
        ),
        _step(
            STEP_ID,
            3,
            {
                "adapterId": "blender",
                "name": "blender.material.create_and_assign",
                "arguments": ARGUMENTS,
            },
            depends_on=list(TARGET_IDS),
            expected_observations=[
                {
                    "kind": "material_assigned",
                    "parameters": {
                        "materialId": MATERIAL_ID,
                        "targets": list(TARGET_IDS),
                    },
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_single_material_integration",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _assert_rna_evidence(result, ordinal: int) -> None:
    mutations = result.observation["details"]["evidence"][
        "rnaMaterialMutations"
    ]
    assert [mutation["order"] for mutation in mutations] == list(
        range(1, len(mutations) + 1)
    )
    if ordinal == 3:
        assert len(mutations) == 2
        assert mutations[0]["mutationKind"] == "material_create"
        assert mutations[0]["resourceType"] == "Material"
        assert mutations[0]["pendingMaterialName"].startswith(
            "OperatingLine.PendingMaterial."
        )
        assert mutations[1]["mutationKind"] == "material_use_nodes_write"
        assert mutations[1]["acceptedValue"] is True
        assert mutations[1]["observedValue"] is True
    elif ordinal == 4:
        assert len(mutations) == 13 + len(TARGET_IDS)
        assert mutations[0]["mutationKind"] == "material_name_write"
        assert mutations[0]["acceptedValue"] == MATERIAL_NAME
        material_controls = mutations[1:7]
        assert all(
            mutation["mutationKind"] == "material_property_write"
            for mutation in material_controls
        )
        principled_controls = mutations[7:13]
        assert all(
            mutation["mutationKind"] == "principled_input_write"
            for mutation in principled_controls
        )
        assignments = mutations[13:]
        assert [mutation["targetId"] for mutation in assignments] == list(
            TARGET_IDS
        )
        assert all(
            mutation["mutationKind"] == "material_slot_replace"
            and mutation["observedAssignment"] is True
            and mutation["sourceContentIntact"] is True
            for mutation in assignments
        )
    else:
        assert not mutations


def _execute_all(receipts, definition, operations):
    receipt_id = "guided-single-material-receipt"
    transaction = None
    results = []
    for ordinal in range(1, 5):
        result = operations.execute_single_material_operation(
            operation_ordinal=ordinal,
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.SINGLE_MATERIAL_ACTION,
            receipts=receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        results.append(result)
        _assert_rna_evidence(result, ordinal)
        mutating = ordinal in operations.SINGLE_MATERIAL_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_single_material_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.SINGLE_MATERIAL_ACTION,
            receipts=receipts,
            definition=definition,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=None if ordinal < 3 else result.receipt,
        )
        if ordinal in {3, 4}:
            inverse = operations.inverse_single_material_operation(
                operation_ordinal=ordinal,
                receipt_id=receipt_id,
                step_id=STEP_ID,
                action_name=operations.SINGLE_MATERIAL_ACTION,
                receipts=receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = inverse.transaction
            replay = operations.execute_single_material_operation(
                operation_ordinal=ordinal,
                receipt_id=receipt_id,
                step_id=STEP_ID,
                action_name=operations.SINGLE_MATERIAL_ACTION,
                receipts=receipts,
                definition=definition,
                transaction=transaction,
            )
            _assert_rna_evidence(replay, ordinal)
            transaction = replay.transaction
            results[-1] = replay
    return receipt_id, transaction, results


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_single_material_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_single_material_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_single_material_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_single_material_integration.operating_line.infrastructure import (
        guided_single_material_operations as operations,
    )
    from operating_line_guided_single_material_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_single_material_integration.operating_line.infrastructure.snowman_actions.material import (
        validate_single,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-single-material-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == TARGET_IDS[0]
    assert session.next().id == TARGET_IDS[1]
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    definition = validate_single(step.action.arguments)[0]

    receipt_id, transaction, results = _execute_all(
        session.receipts, definition, operations
    )
    material = bpy.data.materials[MATERIAL_NAME]
    assert material.use_nodes is True
    assert all(
        math.isclose(actual, expected, abs_tol=1e-6)
        for actual, expected in zip(material.diffuse_color, ARGUMENTS["baseColor"])
    )
    assert math.isclose(material.roughness, ARGUMENTS["roughness"], abs_tol=1e-6)
    assert math.isclose(material.metallic, ARGUMENTS["metallic"], abs_tol=1e-6)
    for target_name in TARGET_NAMES:
        target = bpy.data.objects[target_name]
        assert tuple(slot.material for slot in target.material_slots) == (material,)

    final_receipt = results[-1].receipt
    assert len(final_receipt.created) == 1
    assert len(final_receipt.mutations) == 1 + 3 * len(TARGET_IDS)
    observations = evaluate_observations(
        step.expected_observations,
        {**session.receipts, STEP_ID: final_receipt},
    )
    assert observations[0]["satisfied"] is True

    original_roughness = material.roughness
    material.roughness = original_roughness + 0.1
    try:
        operations.verify_single_material_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.SINGLE_MATERIAL_ACTION,
            receipts=session.receipts,
            definition=definition,
            completed_operations=(1, 2, 3, 4),
            expected_fingerprint=transaction.fingerprint,
            partial_receipt=final_receipt,
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("Material surface tampering must fail closed")
    material.roughness = original_roughness

    target = bpy.data.objects[TARGET_NAMES[0]]
    original_coordinate = target.data.vertices[0].co.copy()
    target.data.vertices[0].co.x += 0.125
    target.data.update()
    try:
        operations.verify_single_material_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.SINGLE_MATERIAL_ACTION,
            receipts=session.receipts,
            definition=definition,
            completed_operations=(1, 2, 3, 4),
            expected_fingerprint=transaction.fingerprint,
            partial_receipt=final_receipt,
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("Material source mesh tampering must fail closed")
    target.data.vertices[0].co = original_coordinate
    target.data.update()

    for ordinal in range(4, 0, -1):
        inverse = operations.inverse_single_material_operation(
            operation_ordinal=ordinal,
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.SINGLE_MATERIAL_ACTION,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = inverse.transaction
    assert transaction.completed_operations == ()
    assert bpy.data.materials.get(MATERIAL_NAME) is None
    assert all(
        len(bpy.data.objects[target_name].material_slots) == 0
        for target_name in TARGET_NAMES
    )

    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.material.create_and_assign.semantic"
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    assert operation_ids == operations.SINGLE_MATERIAL_OPERATION_IDS
    snapshot_parameter_names = tuple(
        tuple(parameter.name for parameter in operation.parameters)
        for operation in snapshot.operations
    )
    assert snapshot_parameter_names == (
        ("materialId",),
        (),
        (),
        ("materialName", "baseColor", "roughness", "metallic", "targets"),
    ), snapshot_parameter_names
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 5):
        result = operations.execute_single_material_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        run = session.record_leaf_operation(
            step,
            run_id=run.run_id,
            operation_id=operation_ids[ordinal - 1],
            ordinal=ordinal,
            before_sha256=result.before_fingerprint,
            after_sha256=result.after_fingerprint,
            observation=result.observation,
            partial_action_receipt=None if ordinal < 3 else result.receipt,
        )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 4
    assert session.receipts[step.id] == partial_receipt
    gate_observations = session.success_gate_observation_copy(step.id)
    assert gate_observations is not None
    assert gate_observations[0]["kind"] == "material_assigned"
    assert gate_observations[0]["satisfied"] is True
    assert session.back() is step
    assert bpy.data.materials.get(MATERIAL_NAME) is None
    print(
        "OperatingLine guided single-material proof passed: "
        "4 forward + 4 inverse + replay + guards + completion",
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
