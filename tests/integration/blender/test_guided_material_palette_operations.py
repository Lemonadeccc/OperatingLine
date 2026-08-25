"""Real-Blender proof for the atomic four-step material-palette executor."""

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

TARGET_IDS = (
    "guided.palette.eye-left",
    "guided.palette.eye-right",
    "guided.palette.body",
)
TARGET_NAMES = (
    "OperatingLine.GuidedPaletteEyeLeft",
    "OperatingLine.GuidedPaletteEyeRight",
    "OperatingLine.GuidedPaletteBody",
)
STEP_ID = "guided.material-palette"
ARGUMENTS = {
    "materials": [
        {
            "materialId": "guided.palette.material.eyes",
            "materialName": "OperatingLine.GuidedPaletteEyes",
            "targets": list(TARGET_IDS[:2]),
            "baseColor": [0.04, 0.08, 0.14, 1.0],
            "roughness": 0.31,
            "metallic": 0.17,
        },
        {
            "materialId": "guided.palette.material.body",
            "materialName": "OperatingLine.GuidedPaletteBody",
            "targets": [TARGET_IDS[2]],
            "baseColor": [0.72, 0.18, 0.09, 1.0],
            "roughness": 0.66,
            "metallic": 0.02,
        },
    ]
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
            4,
            {
                "adapterId": "blender",
                "name": "blender.material.create_palette_and_assign",
                "arguments": ARGUMENTS,
            },
            depends_on=list(TARGET_IDS),
            expected_observations=[
                {
                    "kind": "material_assigned",
                    "parameters": {
                        "materialId": ARGUMENTS["materials"][0]["materialId"],
                        "targets": [TARGET_IDS[0]],
                    },
                },
                {
                    "kind": "material_assigned",
                    "parameters": {
                        "materialId": ARGUMENTS["materials"][1]["materialId"],
                        "targets": [TARGET_IDS[2]],
                    },
                },
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_material_palette_integration",
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
        "rnaMaterialPaletteMutations"
    ]
    if ordinal != 4:
        assert not mutations
        return
    expected_count = sum(
        14 + len(definition["targets"])
        for definition in ARGUMENTS["materials"]
    )
    assert len(mutations) == expected_count
    assert [mutation["order"] for mutation in mutations] == list(
        range(1, expected_count + 1)
    )
    cursor = 0
    for material_order, definition in enumerate(ARGUMENTS["materials"], start=1):
        group_size = 14 + len(definition["targets"])
        group = mutations[cursor : cursor + group_size]
        assert [mutation["materialMutationOrder"] for mutation in group] == list(
            range(1, group_size + 1)
        )
        assert all(
            mutation["materialOrder"] == material_order
            and mutation["materialId"] == definition["materialId"]
            and mutation["materialName"] == definition["materialName"]
            for mutation in group
        )
        assert group[0]["mutationKind"] == "palette_material_create"
        assert group[0]["observedResource"] is True
        assert group[1]["mutationKind"] == "palette_material_use_nodes_write"
        assert all(
            mutation["mutationKind"] == "palette_material_property_write"
            for mutation in group[2:8]
        )
        assert all(
            mutation["mutationKind"] == "palette_principled_input_write"
            for mutation in group[8:14]
        )
        assignments = group[14:]
        assert [mutation["targetId"] for mutation in assignments] == definition[
            "targets"
        ]
        assert all(
            mutation["mutationKind"] == "palette_material_slot_replace"
            and mutation["observedAssignment"] is True
            and mutation["sourceContentIntact"] is True
            for mutation in assignments
        )
        cursor += group_size


def _execute_all(receipts, definitions, operations, receipt_id: str):
    transaction = None
    results = []
    for ordinal in range(1, 5):
        result = operations.execute_material_palette_operation(
            operation_ordinal=ordinal,
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.MATERIAL_PALETTE_ACTION,
            receipts=receipts,
            definition=definitions,
            transaction=transaction,
        )
        transaction = result.transaction
        results.append(result)
        _assert_rna_evidence(result, ordinal)
        mutating = ordinal in operations.MATERIAL_PALETTE_MUTATING_ORDINALS
        assert result.observation["details"]["mutating"] is mutating
        assert (result.before_fingerprint != result.after_fingerprint) is mutating
        assert operations.verify_material_palette_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.MATERIAL_PALETTE_ACTION,
            receipts=receipts,
            definition=definitions,
            completed_operations=tuple(range(1, ordinal + 1)),
            expected_fingerprint=result.after_fingerprint,
            partial_receipt=result.receipt if ordinal == 4 else None,
        )
    inverse = operations.inverse_material_palette_operation(
        operation_ordinal=4,
        receipt_id=receipt_id,
        step_id=STEP_ID,
        action_name=operations.MATERIAL_PALETTE_ACTION,
        receipts=receipts,
        definition=definitions,
        transaction=transaction,
    )
    replay = operations.execute_material_palette_operation(
        operation_ordinal=4,
        receipt_id=receipt_id,
        step_id=STEP_ID,
        action_name=operations.MATERIAL_PALETTE_ACTION,
        receipts=receipts,
        definition=definitions,
        transaction=inverse.transaction,
    )
    _assert_rna_evidence(replay, 4)
    results[-1] = replay
    return replay.transaction, results


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_material_palette_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_material_palette_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_material_palette_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_material_palette_integration.operating_line.infrastructure import (
        guided_material_palette_operations as operations,
    )
    from operating_line_guided_material_palette_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_material_palette_integration.operating_line.infrastructure.snowman_actions.material import (
        validate_palette,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-material-palette-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    for target_id in TARGET_IDS:
        assert session.next().id == target_id
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    definitions = validate_palette(step.action.arguments)

    receipt_id = "guided-material-palette-receipt"
    transaction, results = _execute_all(
        session.receipts,
        definitions,
        operations,
        receipt_id,
    )
    for definition in definitions:
        material = bpy.data.materials[definition.name]
        assert material.use_nodes is True
        assert all(
            math.isclose(actual, expected, abs_tol=1e-6)
            for actual, expected in zip(
                material.diffuse_color,
                definition.base_color,
            )
        )
        assert math.isclose(material.roughness, definition.roughness, abs_tol=1e-6)
        assert math.isclose(material.metallic, definition.metallic, abs_tol=1e-6)
        for target_id in definition.targets:
            target_name = TARGET_NAMES[TARGET_IDS.index(target_id)]
            target = bpy.data.objects[target_name]
            assert tuple(target.data.materials) == (material,)

    final_receipt = results[-1].receipt
    assert len(final_receipt.created) == len(definitions)
    assert len(final_receipt.mutations) == sum(
        1 + 3 * len(definition.targets) for definition in definitions
    )
    observations = evaluate_observations(
        step.expected_observations,
        {**session.receipts, STEP_ID: final_receipt},
    )
    assert len(observations) == 2
    assert all(observation["satisfied"] is True for observation in observations)

    material = bpy.data.materials[definitions[1].name]
    original_roughness = material.roughness
    material.roughness = original_roughness + 0.1
    try:
        operations.verify_material_palette_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.MATERIAL_PALETTE_ACTION,
            receipts=session.receipts,
            definition=definitions,
            completed_operations=(1, 2, 3, 4),
            expected_fingerprint=transaction.fingerprint,
            partial_receipt=final_receipt,
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("Palette material surface tampering must fail closed")
    material.roughness = original_roughness

    target = bpy.data.objects[TARGET_NAMES[0]]
    original_coordinate = target.data.vertices[0].co.copy()
    target.data.vertices[0].co.x += 0.125
    target.data.update()
    try:
        operations.verify_material_palette_stage(
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.MATERIAL_PALETTE_ACTION,
            receipts=session.receipts,
            definition=definitions,
            completed_operations=(1, 2, 3, 4),
            expected_fingerprint=transaction.fingerprint,
            partial_receipt=final_receipt,
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("Palette source mesh tampering must fail closed")
    target.data.vertices[0].co = original_coordinate
    target.data.update()

    for ordinal in range(4, 0, -1):
        inverse = operations.inverse_material_palette_operation(
            operation_ordinal=ordinal,
            receipt_id=receipt_id,
            step_id=STEP_ID,
            action_name=operations.MATERIAL_PALETTE_ACTION,
            receipts=session.receipts,
            definition=definitions,
            transaction=transaction,
        )
        transaction = inverse.transaction
    assert transaction.completed_operations == ()
    assert all(bpy.data.materials.get(definition.name) is None for definition in definitions)
    assert all(
        len(bpy.data.objects[target_name].material_slots) == 0
        for target_name in TARGET_NAMES
    )

    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.catalog_version == "1.69.0"
    assert snapshot.recipe_id == "blender.material.create_palette_and_assign.semantic"
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    assert operation_ids == operations.MATERIAL_PALETTE_OPERATION_IDS
    parameter_names = tuple(
        tuple(parameter.name for parameter in operation.parameters)
        for operation in snapshot.operations
    )
    assert parameter_names == ((), (), ("materials",), ())

    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    for ordinal in range(1, 5):
        result = operations.execute_material_palette_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definitions,
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
            partial_action_receipt=result.receipt if ordinal == 4 else None,
        )
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 4
    assert session.receipts[step.id] == partial_receipt
    gate_observations = session.success_gate_observation_copy(step.id)
    assert gate_observations is not None and len(gate_observations) == 2
    assert all(observation["satisfied"] is True for observation in gate_observations)
    assert session.back() is step
    assert all(bpy.data.materials.get(definition.name) is None for definition in definitions)
    print(
        "OperatingLine guided material-palette proof passed: "
        "4 forward + atomic inverse/replay + guards + multi-gate completion",
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
